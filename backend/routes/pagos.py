from flask import Blueprint, request, jsonify
import requests
import os
import json
import copy
from urllib.parse import quote
from datetime import datetime

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company, get_company_abbr, add_company_abbr

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar módulo de retenciones de venta
from routes.sales_withholdings import build_payment_entry_withholdings, validate_withholdings_list

# Importar utilidades de conciliación
from utils.conciliation_utils import CONCILIATION_FIELD, build_conciliation_groups, DEFAULT_THRESHOLD, generate_conciliation_id
from utils.comprobante_utils import get_payment_prefix

# Crear el blueprint para las rutas de pagos/cobranzas
pagos_bp = Blueprint('pagos', __name__)


def assign_conciliation_if_needed(session, selected_conciliation_ids, assigned_invoices, invoice_doctype):
    if not (selected_conciliation_ids and assigned_invoices):
        return True, None

    conciliation_id = selected_conciliation_ids[0]
    unique_invoices = list(dict.fromkeys(assigned_invoices))
    for invoice_name in unique_invoices:
        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/{invoice_doctype}/{quote(invoice_name)}",
            data={"data": {CONCILIATION_FIELD: conciliation_id}},
            operation_name="Assign Conciliation to Invoice"
        )
        if update_error or update_response.status_code not in (200, 202):
            error_text = update_error or update_response.text
            print(f"--- Asignar conciliación: error al actualizar {invoice_name}", error_text)
            return False, f"No se pudo asignar la conciliación a la factura {invoice_name}"

    return True, None


def handle_payment_conciliation(session, payment_name, invoice_references, invoice_doctype):
    """
    Maneja la conciliación automática entre un pago y sus facturas referenciadas.
    
    Lógica:
    1. Si alguna factura tiene custom_conciliation_id, usar ese ID para todas las facturas y el pago
    2. Si ninguna factura tiene conciliación, crear un nuevo ID y asignarlo a todas
    3. Actualizar el pago con el conciliation_id
    
    Args:
        session: Sesión de requests para ERPNext
        payment_name: Nombre del Payment Entry creado
        invoice_references: Lista de referencias a facturas [{'reference_name': 'FAC-001', ...}]
        invoice_doctype: Tipo de documento de factura (Sales Invoice o Purchase Invoice)
    
    Returns:
        (success: bool, message: str or None)
    """
    if not invoice_references:
        print("--- Conciliación pago: sin facturas referenciadas, no se aplica conciliación")
        return True, None
    
    # Obtener los nombres de las facturas
    invoice_names = [ref.get('reference_name') for ref in invoice_references if ref.get('reference_name')]
    if not invoice_names:
        print("--- Conciliación pago: sin nombres de factura válidos")
        return True, None
    
    print(f"--- Conciliación pago: procesando {len(invoice_names)} facturas")
    
    # Buscar si alguna factura ya tiene conciliation_id
    existing_conciliation_id = None
    invoices_data = {}
    
    for invoice_name in invoice_names:
        inv_resp, inv_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{invoice_doctype}/{quote(invoice_name)}?fields=[\"name\",\"{CONCILIATION_FIELD}\"]",
            operation_name=f"Get Invoice {invoice_name} Conciliation"
        )
        
        if inv_err or not inv_resp or inv_resp.status_code != 200:
            print(f"--- Conciliación pago: error obteniendo factura {invoice_name}")
            continue
        
        inv_data = inv_resp.json().get('data', {})
        invoices_data[invoice_name] = inv_data
        
        current_conc_id = inv_data.get(CONCILIATION_FIELD)
        if current_conc_id:
            existing_conciliation_id = current_conc_id
            print(f"--- Conciliación pago: factura {invoice_name} tiene conciliación {current_conc_id}")
            break  # Usamos el primero que encontremos
    
    # Determinar el conciliation_id a usar
    if existing_conciliation_id:
        conciliation_id = existing_conciliation_id
        print(f"--- Conciliación pago: usando conciliación existente {conciliation_id}")
    else:
        conciliation_id = generate_conciliation_id()
        print(f"--- Conciliación pago: creando nueva conciliación {conciliation_id}")
    
    # Actualizar todas las facturas con el conciliation_id
    for invoice_name in invoice_names:
        inv_data = invoices_data.get(invoice_name, {})
        current_conc_id = inv_data.get(CONCILIATION_FIELD)
        
        # Solo actualizar si no tiene o si es diferente
        if not current_conc_id or current_conc_id != conciliation_id:
            update_resp, update_err = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/{invoice_doctype}/{quote(invoice_name)}",
                data={"data": {CONCILIATION_FIELD: conciliation_id}},
                operation_name=f"Assign Conciliation to Invoice {invoice_name}"
            )
            
            if update_err or update_resp.status_code not in (200, 202):
                error_text = update_err or (update_resp.text if update_resp else "Unknown error")
                print(f"--- Conciliación pago: error actualizando factura {invoice_name}: {error_text}")
                return False, f"No se pudo asignar conciliación a la factura {invoice_name}"
            
            print(f"--- Conciliación pago: factura {invoice_name} actualizada con {conciliation_id}")
    
    # Actualizar el pago con el conciliation_id
    payment_resp, payment_err = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
        data={"data": {CONCILIATION_FIELD: conciliation_id}},
        operation_name=f"Assign Conciliation to Payment {payment_name}"
    )
    
    if payment_err or payment_resp.status_code not in (200, 202):
        error_text = payment_err or (payment_resp.text if payment_resp else "Unknown error")
        print(f"--- Conciliación pago: error actualizando pago {payment_name}: {error_text}")
        return False, f"No se pudo asignar conciliación al pago {payment_name}"
    
    print(f"--- Conciliación pago: pago {payment_name} actualizado con {conciliation_id}")
    return True, None


def create_payment_entry_from_context(context, session):
    payment_data = context['payment_data']
    create_response, create_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Payment Entry",
        data=payment_data,
        operation_name="Create Payment Entry"
    )
    if create_error:
        return {"success": False, "error": create_error}

    result = create_response.json()
    payment_name = result.get('data', {}).get('name')
    return {"success": True, "payment_name": payment_name}


def _sanitize_child_records(child_records):
    sanitized = []
    for idx, record in enumerate(child_records or [], start=1):
        if not isinstance(record, dict):
            continue
        cleaned = copy.deepcopy(record)
        for field in (
            'name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus',
            'parent', 'parentfield', 'parenttype'
        ):
            cleaned.pop(field, None)
        cleaned['idx'] = idx
        sanitized.append(cleaned)
    return sanitized


def _sanitize_payment_entry_for_insert(payment_doc, overrides=None):
    overrides = overrides or {}
    base_doc = copy.deepcopy(payment_doc or {})

    for field in (
        'name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus',
        'status', 'workflow_state', '__onload', '_user_tags', '_comments', '_assign',
        '_liked_by', 'amended_from'
    ):
        base_doc.pop(field, None)

    base_doc['docstatus'] = 0

    for key, value in list(base_doc.items()):
        if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
            base_doc[key] = _sanitize_child_records(value)

    base_doc.update(overrides)
    return base_doc


def _strip_control_fields(payload):
    cleaned = dict(payload or {})
    for key in ('replace_confirmed_payment', 'current_status', 'status', 'docstatus', 'data'):
        cleaned.pop(key, None)
    return cleaned


def build_payment_entry_context(
    data,
    session,
    headers,
    reference_no_override=None,
    naming_series_override=None,
    existing_payment=None
):
    try:
        party_type = (data.get('party_type') or ('Supplier' if data.get('supplier') else 'Customer')).title()
        if party_type not in ('Customer', 'Supplier'):
            party_type = 'Customer'

        party = data.get('party') or data.get('supplier') or data.get('customer')
        if not party:
            return {
                "success": False,
                "message": "Debe especificar el cliente o proveedor asociado al pago"
            }

        payment_type = data.get('payment_type')
        if payment_type not in ('Receive', 'Pay', 'Internal Transfer'):
            payment_type = 'Pay' if party_type == 'Supplier' else 'Receive'

        talonario_response, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Talonario/{data.get('talonario')}",
            operation_name="Get Talonario for Payment"
        )

        if talonario_error or talonario_response.status_code != 200:
            return {
                "success": False,
                "message": "No se pudo obtener el talonario requerido"
            }

        talonario_data = talonario_response.json().get('data', {})
        punto_venta = str(talonario_data.get('punto_de_venta', '00001')).zfill(5)
        numero_inicio = int(talonario_data.get('numero_de_inicio', 1))
        numero_fin = int(talonario_data.get('numero_de_fin', 99999999))

        search_filters = json.dumps([["reference_no", "like", f"{punto_venta}%"]])
        fields = json.dumps(["reference_no"])

        search_response, search_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Payment Entry",
            params={
                "filters": search_filters,
                "fields": fields,
                "order_by": "creation desc",
                "limit": 100
            },
            operation_name="Search Last Payment Number"
        )

        last_number = numero_inicio - 1
        if not search_error and search_response and search_response.status_code == 200:
            payments_data = search_response.json().get('data', [])
            for payment in payments_data:
                ref_no = payment.get('reference_no', '')
                if ref_no.startswith(punto_venta):
                    number_part = ref_no[len(punto_venta):]
                    if number_part.isdigit():
                        payment_number = int(number_part)
                        if payment_number > last_number:
                            last_number = payment_number

        next_number = last_number + 1
        if next_number > numero_fin:
            return {
                "success": False,
                "message": f"Número máximo alcanzado para este talonario: {numero_fin}"
            }

        reference_no = f"{punto_venta}{next_number:08d}"
        payment_prefix = get_payment_prefix(is_sales=(party_type != 'Supplier'), is_electronic=False)
        naming_series_value = f"{payment_prefix}-REC-X-{punto_venta}-{next_number:08d}"

        if reference_no_override:
            reference_no = reference_no_override
        if naming_series_override:
            naming_series_value = naming_series_override

        total_paid = 0
        payment_dates = []
        for method in data.get('payment_methods', []):
            importe = float(method.get('importe', 0))
            total_paid += importe
            fecha_pago = method.get('fecha_pago')
            if fecha_pago:
                payment_dates.append(fecha_pago)

        reference_doctype = "Purchase Invoice" if party_type == 'Supplier' else "Sales Invoice"
        invoice_references = []
        if 'invoices' in data:
            for invoice_name, invoice_data in data['invoices'].items():
                if invoice_data.get('selected'):
                    allocated = float(invoice_data.get('saldo_aplicado', 0))
                    if allocated > 0:
                        invoice_references.append({
                            "reference_doctype": reference_doctype,
                            "reference_name": invoice_name,
                            "allocated_amount": allocated
                        })

        selected_conciliation_ids = data.get('selected_conciliation_ids', [])
        assigned_invoices = data.get('assigned_invoices_for_conciliation', [])

        company_response, company_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Company/{data.get('company')}",
            operation_name="Get Company for Payment"
        )

        company_data = {}
        if not company_error and company_response and company_response.status_code == 200:
            company_data = company_response.json().get('data', {})
        company_abbr = company_data.get('abbr')
        if not company_abbr:
            company_abbr = get_company_abbr(session, headers, data.get('company'))

        if party and company_abbr and party_type in ('Customer', 'Supplier'):
            party = add_company_abbr(party, company_abbr)

        party_account = None
        if party_type == 'Supplier':
            party_account = company_data.get('default_payable_account')
        else:
            party_account = company_data.get('default_receivable_account')

        payment_account = None
        payment_account_currency = None
        mode_of_payment_name = None
        if data.get('payment_methods'):
            first_method = data['payment_methods'][0] or {}
            mode_of_payment_name = first_method.get('medio_pago')
        if not mode_of_payment_name:
            mode_of_payment_name = data.get('mode_of_payment')

        def _try_load_mode_of_payment(mode_name):
            if not mode_name:
                return None, None, None

            mop_response, mop_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Mode of Payment/{quote(mode_name)}",
                operation_name="Get Mode of Payment for Payment"
            )
            if mop_error or not mop_response or mop_response.status_code != 200:
                return None, None, None

            mop_data = mop_response.json().get('data', {}) or {}
            candidate_account = None
            candidate_currency = None
            if mop_data.get('accounts'):
                candidate_account = mop_data['accounts'][0].get('default_account')
                if candidate_account:
                    acc_response, acc_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Account/{quote(candidate_account)}?fields=[\"account_currency\"]",
                        operation_name="Get Account Currency for Payment"
                    )
                    if not acc_error and acc_response and acc_response.status_code == 200:
                        candidate_currency = acc_response.json().get('data', {}).get('account_currency')
            return mop_data, candidate_account, candidate_currency

        mop_data, payment_account, payment_account_currency = _try_load_mode_of_payment(mode_of_payment_name)

        # Workaround: en reemplazo de pagos confirmados, a veces llega un "medio_pago"
        # con el nombre de una cuenta contable; si falla, usar el mode_of_payment real
        # del Payment Entry original.
        if (not mop_data) and existing_payment:
            existing_mode = existing_payment.get('mode_of_payment')
            if existing_mode and existing_mode != mode_of_payment_name:
                mop_data, payment_account, payment_account_currency = _try_load_mode_of_payment(existing_mode)
                if mop_data:
                    mode_of_payment_name = existing_mode

        payment_account_field = "paid_to" if payment_type == "Receive" else "paid_from"
        payment_currency_field = f"{payment_account_field}_account_currency"

        deductions = []
        total_withholdings = 0
        withholdings_data = data.get('withholdings', [])
        if withholdings_data and party_type == 'Customer':
            validation_errors = validate_withholdings_list(withholdings_data)
            if validation_errors:
                return {
                    "success": False,
                    "message": "Errores en retenciones",
                    "errors": validation_errors
                }

            deduction_rows, build_errors = build_payment_entry_withholdings(
                company=data.get('company'),
                customer=party,
                withholdings=withholdings_data,
                references=invoice_references,
                company_abbr=company_abbr
            )

            if build_errors:
                return {
                    "success": False,
                    "message": "Errores construyendo retenciones",
                    "errors": build_errors
                }

            deductions = deduction_rows
            total_withholdings = sum(d.get('amount', 0) for d in deductions)
            print(f"--- Crear pago: total retenciones = {total_withholdings}")

        reference_date = data.get('posting_date')
        if payment_dates:
            reference_date = min(payment_dates)

        # Calcular montos según tipo de pago y moneda de cuenta
        exchange_rate = data.get('exchange_rate')
        
        # Para Receive (cobranza):
        # - paid_amount (impacto en moneda base de la empresa) = monto en moneda extranjera * tasa
        # - received_amount (lo que entra a cuenta destino) = monto en moneda extranjera
        # Para Pay (pago):
        # - paid_amount (lo que sale de cuenta origen) = monto en moneda extranjera
        # - received_amount (impacto en moneda base de la empresa) = monto en moneda extranjera * tasa
        
        company_currency = company_data.get('default_currency') if company_data else None
        if not company_currency:
            return {
                "success": False,
                "message": "La empresa no tiene moneda por defecto definida (default_currency)"
            }

        if not payment_account_currency:
            return {
                "success": False,
                "message": "No se pudo determinar la moneda de la cuenta del medio de pago (account_currency)"
            }

        needs_conversion = payment_account_currency != company_currency
        parsed_exchange_rate = None
        if needs_conversion:
            try:
                parsed_exchange_rate = float(exchange_rate)
            except (TypeError, ValueError):
                parsed_exchange_rate = None
            if not parsed_exchange_rate or parsed_exchange_rate <= 0:
                return {
                    "success": False,
                    "message": f"Cotización inválida o faltante para convertir {payment_account_currency} → {company_currency}"
                }

        if payment_type == "Receive":
            # Cobranza: el cliente paga en moneda base (party_account) y recibimos en la moneda de la cuenta destino (paid_to).
            if needs_conversion:
                paid_amount = total_paid * parsed_exchange_rate  # moneda base (company_currency)
                received_amount = total_paid  # moneda de la cuenta destino (payment_account_currency)
            else:
                paid_amount = total_paid
                received_amount = total_paid
        else:
            # Pago a proveedor: pagamos desde la moneda de la cuenta origen (paid_from) y afecta la moneda base (party_account).
            if needs_conversion:
                paid_amount = total_paid  # moneda de la cuenta origen (payment_account_currency)
                received_amount = total_paid * parsed_exchange_rate  # moneda base (company_currency)
            else:
                paid_amount = total_paid
                received_amount = total_paid

        # Determinar la moneda de la cuenta destino (party_account) para setear
        # correctamente `target_exchange_rate` (ERPNext espera la tasa relativa
        # a la moneda de la cuenta destino / party_account vs moneda de la compañía).
        party_account_currency = None
        if party_account:
            pa_resp, pa_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Account/{quote(party_account)}?fields=[\"account_currency\"]",
                operation_name="Get Party Account Currency"
            )
            if not pa_err and pa_resp and pa_resp.status_code == 200:
                party_account_currency = pa_resp.json().get('data', {}).get('account_currency')

        # Por ahora, no soportamos party_account en moneda distinta a la de la empresa sin una lógica explícita.
        if party_account_currency and party_account_currency != company_currency:
            return {
                "success": False,
                "message": f"Configuración no soportada: party_account en {party_account_currency} y empresa en {company_currency}"
            }

        # target_exchange_rate: si la moneda de la cuenta de pago es la misma que la compañía entonces 1;
        # en caso contrario usamos la tasa provista (payment_account_currency -> company_currency).
        target_exchange_rate = 1 if not needs_conversion else parsed_exchange_rate

        payment_data = {
            "data": {
                "doctype": "Payment Entry",
                "payment_type": payment_type,
                "posting_date": data.get('posting_date'),
                "party_type": party_type,
                "party": party,
                "party_account": party_account,
                "paid_amount": paid_amount,
                "received_amount": received_amount,
                "reference_no": reference_no,
                "reference_date": reference_date,
                "remarks": data.get('description', ''),
                "company": data.get('company'),
                "target_exchange_rate": target_exchange_rate,
                "references": invoice_references,
                "deductions": deductions,
                "mode_of_payment": mode_of_payment_name,
                "docstatus": 1 if data.get('status') == 'Confirmado' else 0
            }
        }

        payment_data["data"][payment_account_field] = payment_account
        payment_data["data"][payment_currency_field] = payment_account_currency
        payment_data["data"]["naming_series"] = naming_series_value

        if selected_conciliation_ids:
            payment_data["data"][CONCILIATION_FIELD] = selected_conciliation_ids[0]

        return {
            "success": True,
            "payment_data": payment_data,
            "selected_conciliation_ids": selected_conciliation_ids,
            "assigned_invoices": assigned_invoices,
            "invoice_doctype": reference_doctype
        }

    except Exception as exc:
        print("--- Preparar pago: error", str(exc))
        return {
            "success": False,
            "message": str(exc)
        }

@pagos_bp.route('/api/pagos/types', methods=['GET'])
def get_pago_types():
    """Obtener tipos de talonarios disponibles para pagos"""
    print("--- Obtener tipos talonarios: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener el tipo de talonario solicitado (por defecto, RECIBOS)
        talonario_type = request.args.get('tipo', 'RECIBOS')
        print(f"--- DEBUG: tipo de talonario solicitado: {talonario_type}")
        print(f"--- DEBUG: user_id: {user_id}")

        # Obtener la compañía activa del usuario
        company = get_active_company(user_id)
        print(f"--- DEBUG: compañía activa obtenida: {company}")
        
        if not company:
            print("--- DEBUG: No se pudo determinar la compañía activa")
            return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

        # Obtener tipos de talonarios que coinciden con el tipo solicitado Y la compañía
        filters = json.dumps([
            ["tipo_de_talonario", "=", talonario_type],
            ["compania", "=", company]
        ])
        fields = json.dumps(["name", "descripcion", "tipo_de_talonario", "punto_de_venta", "numero_de_inicio", "numero_de_fin", "compania"])
        print(f"--- DEBUG: filters: {filters}")
        print(f"--- DEBUG: fields: {fields}")

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params={
                "filters": filters,
                "fields": fields,
                "limit": 100
            },
            operation_name="Get Payment Types"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get payment types")

        data = response.json()
        talonarios = data.get('data', [])

        # Formatear respuesta
        types = []
        for talonario in talonarios:
            types.append({
                "name": talonario.get('name'),
                "descripcion": talonario.get('descripcion'),
                "tipo_de_talonario": talonario.get('tipo_de_talonario'),
                "punto_de_venta": talonario.get('punto_de_venta'),
                "numero_de_inicio": talonario.get('numero_de_inicio'),
                "numero_de_fin": talonario.get('numero_de_fin'),
                "compania": talonario.get('compania')
            })

        print(f"--- Obtener tipos talonarios: encontrados {len(types)} para compañía '{company}'")
        return jsonify({
            "success": True,
            "data": types
        })

    except Exception as e:
        print("--- Obtener tipos talonarios: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos/unpaid-invoices/<party_name>', methods=['GET'])
def get_unpaid_invoices(party_name):
    """Obtener facturas impagas de un cliente o proveedor"""
    print("--- Obtener facturas impagas: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        party_type = request.args.get('party_type', 'Customer') or 'Customer'
        party_type = party_type.title()

        # Obtener la compañía activa del usuario
        company = get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

        # Configurar valores seg�n el tipo de parte
        if party_type == 'Supplier':
            doctype = "Purchase Invoice"
            party_field = "supplier"
        else:
            party_type = 'Customer'
            doctype = "Sales Invoice"
            party_field = "customer"

        # If supplier, ensure party_name includes company abbreviation (e.g. 'FERREMUNDO SRL - ANC')
        if party_type == 'Supplier':
            try:
                company = get_active_company(user_id)
                if company:
                    abbr = get_company_abbr(session, headers, company)
                    if abbr:
                        suffix = f" - {abbr}"
                        if not party_name.endswith(suffix):
                            print(f"--- Adding company abbr to party_name: '{party_name}' -> '{party_name + suffix}'")
                            party_name = party_name + suffix
            except Exception as e:
                print(f"--- Warning: could not append company abbr: {e}")

        # OPTIMIZACIÓN: Obtener facturas Y conciliaciones en UNA SOLA llamada usando fields expandidos
        filters = json.dumps([
            [party_field, "=", party_name], 
            ["outstanding_amount", "!=", 0], 
            ["status", "!=", "Cancelled"],
            ["company", "=", company]  # Filtrar por compañía desde el inicio
        ])
        fields = json.dumps([
            "name", 
            "posting_date", 
            "due_date", 
            "grand_total", 
            "outstanding_amount", 
            "currency", 
            "is_return", 
            CONCILIATION_FIELD
        ])

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{doctype}",
            params={
                "filters": filters,
                "fields": fields,
                "order_by": "posting_date desc",
                "limit": 100
            },
            operation_name="Get Unpaid Invoices with Conciliations"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get unpaid invoices")

        data = response.json()
        invoices = data.get('data', [])

        # Agrupar facturas conciliadas (sin llamadas adicionales)
        groups, balanced_ids = build_conciliation_groups(
            invoices,
            amount_getter=lambda doc: doc.get('outstanding_amount', 0),
            threshold=DEFAULT_THRESHOLD
        )

        # Formatear respuesta
        unpaid_invoices = []

        # IMPORTANTE: Solo procesar grupos NO balanceados, sin hacer llamadas adicionales
        for group_id, group_data in groups.items():
            if group_id in balanced_ids:
                print(f"--- Grupo {group_id}: balanceado (net_amount ≈ 0), no mostrar")
                continue
            net_amount = group_data['net_amount']
            if net_amount > DEFAULT_THRESHOLD:
                # Ya tenemos los documentos del grupo en 'invoices', filtrarlos sin nueva llamada
                group_invoices = [inv for inv in invoices if inv.get(CONCILIATION_FIELD) == group_id]
                
                unpaid_invoices.append({
                    "is_group": True,
                    "group_id": group_id,
                    "total_amount": net_amount,
                    "currency": group_data['documents'][0].get('currency'),
                    "posting_date": max(doc.get('posting_date') for doc in group_data['documents']),
                    "invoices": [
                        {
                            "name": inv.get('name'),
                            "posting_date": inv.get('posting_date'),
                            "due_date": inv.get('due_date'),
                            "grand_total": inv.get('grand_total', 0),
                            "outstanding_amount": inv.get('outstanding_amount', 0),
                            "currency": inv.get('currency'),
                            "is_return": inv.get('is_return', False)
                        } for inv in group_invoices
                    ]
                })

        # Agregar facturas individuales no conciliadas
        for invoice in invoices:
            if not invoice.get(CONCILIATION_FIELD):
                unpaid_invoices.append({
                    "is_group": False,
                    "name": invoice.get('name'),
                    "posting_date": invoice.get('posting_date'),
                    "due_date": invoice.get('due_date'),
                    "grand_total": invoice.get('grand_total', 0),
                    "outstanding_amount": invoice.get('outstanding_amount', 0),
                    "currency": invoice.get('currency')
                })

        return jsonify({
            "success": True,
            "data": unpaid_invoices
        })

    except Exception as e:
        print("--- Obtener facturas impagas: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos/draft-payments/<party_name>', methods=['GET'])
def get_draft_payments(party_name):
    """Obtener pagos en borrador de un cliente o proveedor"""
    print("--- Obtener pagos draft: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        party_type = request.args.get('party_type', 'Customer') or 'Customer'
        party_type = party_type.title()
        payment_type = 'Pay' if party_type == 'Supplier' else 'Receive'

        # Obtener pagos en draft del party
        filters = json.dumps([
            ["party_type", "=", party_type],
            ["party", "=", party_name],
            ["payment_type", "=", payment_type],
            ["docstatus", "=", 0]
        ])
        fields = json.dumps(["name"])

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Payment Entry",
            params={
                "filters": filters,
                "fields": fields,
                "order_by": "posting_date desc",
                "limit": 10
            },
            operation_name="Get Draft Payments"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get draft payments")

        data = response.json()
        payment_names = [p.get('name') for p in data.get('data', [])]

        # Para cada pago, obtener los detalles completos incluyendo referencias
        draft_payments = []
        for payment_name in payment_names:
            payment_response, payment_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                operation_name="Get Payment Details"
            )
            if not payment_error and payment_response.status_code == 200:
                payment_data = payment_response.json().get('data', {})
                draft_payments.append({
                    "name": payment_data.get('name'),
                    "posting_date": payment_data.get('posting_date'),
                    "paid_amount": payment_data.get('paid_amount', 0),
                    "references": payment_data.get('references', [])
                })

        print(f"--- Pagos draft: {len(draft_payments)} registros")
        return jsonify({
            "success": True,
            "data": draft_payments
        })

    except Exception as e:
        print("--- Obtener pagos draft: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos/treasury-accounts', methods=['GET'])
def get_treasury_accounts():
    """Obtener cuentas de tesorería disponibles para medios de pago"""
    print("--- Obtener cuentas tesorería: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener cuentas que son de tipo Asset y están en el grupo de cuentas de tesorería
        # Usaremos un filtro amplio para obtener cuentas bancarias y de caja
        filters = json.dumps([["account_type", "in", ["Bank", "Cash"]], ["is_group", "=", 0]])
        fields = json.dumps(["name", "account_name", "account_type", "account_currency"])

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Account",
            params={
                "filters": filters,
                "fields": fields,
                "order_by": "account_name",
                "limit": 100
            },
            operation_name="Get Treasury Accounts"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get treasury accounts")

        data = response.json()
        accounts = data.get('data', [])

        # Formatear respuesta
        treasury_accounts = []
        for account in accounts:
            treasury_accounts.append({
                "name": account.get('name'),
                "account_name": account.get('account_name'),
                "account_type": account.get('account_type'),
                "account_currency": account.get('account_currency')
            })

        return jsonify({
            "success": True,
            "data": treasury_accounts
        })

    except Exception as e:
        print("--- Obtener cuentas tesorería: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos', methods=['POST'])
def create_pago():
    """Crear un nuevo pago/cobranza"""
    print("--- Crear pago: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()

        # Validar datos requeridos según la nueva estructura del frontend
        required_fields = ['posting_date', 'talonario', 'payment_methods', 'company']
        for field in required_fields:
            if field not in data:
                print("--- Crear pago: error validación")
                return jsonify({"success": False, "message": f"Campo requerido faltante: {field}"}), 400

        context = build_payment_entry_context(data, session, headers)
        if not context['success']:
            response_payload = {
                "success": False,
                "message": context.get('message', 'Error al construir el pago')
            }
            if 'errors' in context:
                response_payload['errors'] = context['errors']
            return jsonify(response_payload), 400

        creation_result = create_payment_entry_from_context(context, session)
        if not creation_result['success']:
            return handle_erpnext_error(creation_result['error'], "Failed to create payment")

        payment_name = creation_result['payment_name']

        # Manejar conciliación automática basada en las facturas referenciadas
        invoice_references = context['payment_data']['data'].get('references', [])
        if invoice_references:
            conc_success, conc_message = handle_payment_conciliation(
                session,
                payment_name,
                invoice_references,
                context['invoice_doctype']
            )
            if not conc_success:
                print(f"--- Crear pago: advertencia en conciliación - {conc_message}")
                # No falla la creación del pago, solo advertencia
        
        # Mantener compatibilidad con conciliación manual (si viene del frontend)
        if context.get('selected_conciliation_ids') and context.get('assigned_invoices'):
            assign_success, assign_message = assign_conciliation_if_needed(
                session,
                context['selected_conciliation_ids'],
                context['assigned_invoices'],
                context['invoice_doctype']
            )
            if not assign_success:
                return jsonify({"success": False, "message": assign_message}), 400

        print("--- Crear pago: ok")
        return jsonify({
            "success": True,
            "message": "Pago creado exitosamente",
            "data": {
                "name": payment_name
            }
        })


    except Exception as e:
        print("--- Crear pago: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos/<payment_name>', methods=['GET'])
def get_pago(payment_name):
    """Obtener detalles de un pago"""
    print("--- Obtener pago: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
            operation_name="Get Payment Details"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get payment details")

        data = response.json()
        payment = data.get('data', {})

        # Mapear status para el frontend
        if payment.get('docstatus') == 1:
            payment['status'] = 'Confirmado'
        elif payment.get('docstatus') == 2:
            payment['status'] = 'Cancelado'
        else:
            payment['status'] = 'Borrador'

        return jsonify({
            "success": True,
            "data": payment
        })

    except Exception as e:
        print("--- Obtener pago: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos/<payment_name>', methods=['PUT'])
def update_pago(payment_name):
    """Actualizar un pago"""
    print("--- Actualizar pago: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json(silent=True) or {}
        payload = data.get('data') if isinstance(data.get('data'), dict) else data
        status = data.get('status') or payload.get('status')
        current_status = data.get('current_status') or payload.get('current_status')
        replace_confirmed_payment = data.get('replace_confirmed_payment') or payload.get('replace_confirmed_payment')

        if replace_confirmed_payment and current_status == 'Confirmado':
            cancel_data = {"docstatus": 2}
            cancel_response, cancel_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                data=cancel_data,
                operation_name="Cancel Payment for Replacement"
            )
            if cancel_error:
                return handle_erpnext_error(cancel_error, "Failed to cancel existing confirmed payment")

            # Obtener el pago existente para usar reference_no y naming_series base
            payment_response, payment_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                operation_name="Get Existing Payment for Replacement"
            )
            if payment_error:
                return handle_erpnext_error(payment_error, "Failed to get existing payment for replacement")

            existing_payment = payment_response.json().get('data', {})
            reference_no_override = existing_payment.get('reference_no')
            naming_series_override = payment_name[:-5]  # Remover los últimos 5 dígitos para versión

            context = build_payment_entry_context(
                payload,
                session,
                headers,
                reference_no_override=reference_no_override,
                naming_series_override=naming_series_override,
                existing_payment=existing_payment
            )
            if not context['success']:
                response_payload = {
                    "success": False,
                    "message": context.get('message', 'Error al construir el pago')
                }
                if 'errors' in context:
                    response_payload['errors'] = context['errors']
                return jsonify(response_payload), 400

            creation_result = create_payment_entry_from_context(context, session)
            if not creation_result['success']:
                return handle_erpnext_error(creation_result['error'], "Failed to replace payment")

            new_payment_name = creation_result['payment_name']

            # Manejar conciliación automática para el nuevo pago
            invoice_references = context['payment_data']['data'].get('references', [])
            if invoice_references:
                conc_success, conc_message = handle_payment_conciliation(
                    session,
                    new_payment_name,
                    invoice_references,
                    context['invoice_doctype']
                )
                if not conc_success:
                    print(f"--- Reemplazar pago: advertencia en conciliación - {conc_message}")
            
            # Mantener compatibilidad con conciliación manual
            if context.get('selected_conciliation_ids') and context.get('assigned_invoices'):
                assign_success, assign_message = assign_conciliation_if_needed(
                    session,
                    context['selected_conciliation_ids'],
                    context['assigned_invoices'],
                    context['invoice_doctype']
                )
                if not assign_success:
                    return jsonify({"success": False, "message": assign_message}), 400

            print("--- Reemplazar pago confirmado: ok")
            return jsonify({
                "success": True,
                "message": "Pago confirmado reemplazado exitosamente",
                "data": {"name": new_payment_name}
            })

        # Obtener el pago actual para conocer docstatus real (evita transiciones inválidas)
        payment_response, payment_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
            operation_name="Get Payment for Update"
        )
        if payment_error:
            return handle_erpnext_error(payment_error, "Failed to get payment for update")

        existing_payment = payment_response.json().get('data', {}) if payment_response else {}
        existing_docstatus = existing_payment.get('docstatus')

        # Si se está confirmando un pago que estaba en borrador, usar PUT con docstatus
        if status == 'Confirmado' and (current_status == 'Borrador' or existing_docstatus == 0):
            # Primero obtener el pago actual para verificar referencias
            payment_response, payment_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                operation_name="Get Payment for Confirmation"
            )
            
            if not payment_error and payment_response and payment_response.status_code == 200:
                payment_data = payment_response.json().get('data', {})
                invoice_references = payment_data.get('references', [])
                party_type = payment_data.get('party_type', 'Customer')
                invoice_doctype = "Purchase Invoice" if party_type == 'Supplier' else "Sales Invoice"
                
                # Manejar conciliación antes de confirmar
                if invoice_references:
                    conc_success, conc_message = handle_payment_conciliation(
                        session,
                        payment_name,
                        invoice_references,
                        invoice_doctype
                    )
                    if not conc_success:
                        print(f"--- Confirmar pago: advertencia en conciliación - {conc_message}")
            
            update_data = {
                "docstatus": 1
            }
            response, error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                data=update_data,
                operation_name="Confirm Payment"
            )
        elif status == 'Cancelado':
            update_data = {
                "docstatus": 2
            }
            response, error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                data=update_data,
                operation_name="Cancel Payment"
            )
        else:
            update_fields = _strip_control_fields(payload)

            # Workaround: ERPNext no permite editar Payment Entry confirmados (docstatus=1).
            # Para "actualizar", creamos uno nuevo con los cambios y cancelamos el anterior.
            if existing_docstatus == 1:
                overrides = {}

                for key in ('posting_date', 'remarks', 'paid_from', 'paid_to'):
                    if key in update_fields:
                        overrides[key] = update_fields.get(key)

                if 'paid_amount' in update_fields:
                    overrides['paid_amount'] = float(update_fields.get('paid_amount') or 0)
                if 'received_amount' in update_fields:
                    overrides['received_amount'] = float(update_fields.get('received_amount') or 0)

                new_payment_doc = _sanitize_payment_entry_for_insert(existing_payment, overrides=overrides)

                create_response, create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Payment Entry",
                    data={"data": new_payment_doc},
                    operation_name="Create Payment Replacement"
                )
                if create_error:
                    return handle_erpnext_error(create_error, "Failed to create replacement payment")

                new_payment_name = (create_response.json().get('data') or {}).get('name')
                if not new_payment_name:
                    return jsonify({"success": False, "message": "No se pudo obtener el identificador del pago nuevo"}), 500

                submit_response, submit_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Payment Entry/{quote(new_payment_name)}",
                    data={"docstatus": 1},
                    operation_name="Submit Replacement Payment"
                )
                if submit_error:
                    return handle_erpnext_error(submit_error, "Failed to submit replacement payment")

                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                    data={"docstatus": 2},
                    operation_name="Cancel Replaced Payment"
                )
                if cancel_error:
                    return handle_erpnext_error(cancel_error, "Failed to cancel replaced payment")

                print("--- Reemplazar pago confirmado (workaround): ok")
                return jsonify({
                    "success": True,
                    "message": "Pago confirmado reemplazado exitosamente",
                    "data": {"name": new_payment_name, "old_name": payment_name}
                })

            # Actualización normal (borrador) - NO tocar docstatus
            update_data = {"data": update_fields}
            response, error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                data=update_data,
                operation_name="Update Payment"
            )

            # Si la actualización incluye referencias nuevas, manejar conciliación
            if not error and response and response.status_code in (200, 202):
                if 'references' in update_fields and update_fields.get('references'):
                    party_type = update_fields.get('party_type', 'Customer')
                    invoice_doctype = "Purchase Invoice" if party_type == 'Supplier' else "Sales Invoice"

                    conc_success, conc_message = handle_payment_conciliation(
                        session,
                        payment_name,
                        update_fields['references'],
                        invoice_doctype
                    )
                    if not conc_success:
                        print(f"--- Actualizar pago: advertencia en conciliación - {conc_message}")

        if error:
            return handle_erpnext_error(error, "Failed to update payment")

        print("--- Actualizar pago: ok")
        return jsonify({
            "success": True,
            "message": "Pago actualizado exitosamente"
        })

    except Exception as e:
        print("--- Actualizar pago: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos/<payment_name>', methods=['DELETE'])
def delete_payment(payment_name):
    """Eliminar/cancelar un pago - borradores se eliminan, confirmados se cancelan"""
    print("--- Payment delete: started")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Primero obtener el estado del pago para saber si es borrador o confirmado
        fields_str = '["docstatus"]'
        payment_response, payment_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}?fields={quote(fields_str)}",
            operation_name="Get Payment Status for Deletion"
        )

        if payment_error:
            return handle_erpnext_error(payment_error, "Failed to get payment status")

        payment_data = payment_response.json()['data']
        docstatus = payment_data.get('docstatus', 0)

        print("--- Payment delete: status checked")

        if docstatus == 0:
            # Es un borrador - usar DELETE directo
            print("--- Payment delete: deleting draft")
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                operation_name="Delete Draft Payment"
            )

            if delete_error:
                return handle_erpnext_error(delete_error, "Failed to delete draft payment")

            print("--- Payment delete: draft deleted successfully")
            return jsonify({
                "success": True,
                "message": "Pago borrador eliminado exitosamente"
            })

        elif docstatus == 1:
            # Está confirmado - usar cancel
            print("--- Payment delete: cancelling submitted payment")
            cancel_response, cancel_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.cancel",
                data={"doctype": "Payment Entry", "name": payment_name},
                operation_name="Cancel Payment Entry"
            )

            if cancel_error:
                return handle_erpnext_error(cancel_error, "Failed to cancel payment")

            print("--- Payment delete: payment cancelled successfully")
            return jsonify({
                "success": True,
                "message": "Pago cancelado exitosamente"
            })

        else:
            print(f"--- Payment delete: invalid docstatus {docstatus}")
            return jsonify({
                "success": False,
                "message": f"No se puede eliminar el pago con docstatus {docstatus}"
            }), 400

    except Exception as e:
        print("--- Payment delete: error")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos/search-payments', methods=['GET'])
def search_payments():
    """Buscar pagos existentes por filtros"""
    print("--- Buscar pagos: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        raw_filters = request.args.get('filters', None)
        limit = request.args.get('limit', '10')

        # Validar y preparar filtros: si no vienen, no enviar el parámetro "filters" a ERPNext
        params = {
            "fields": json.dumps(["reference_no"]),
            "order_by": "creation desc",
            "limit": limit
        }

        if raw_filters:
            # Intentar parsear para validar que sea JSON válido (ERPNext espera un JSON string)
            try:
                parsed = json.loads(raw_filters)
                params["filters"] = json.dumps(parsed)
            except Exception:
                print("--- Buscar pagos: filtro inválido JSON", raw_filters)
                return jsonify({"success": False, "message": "Parámetro 'filters' inválido. Debe ser un JSON válido."}), 400

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Payment Entry",
            params=params,
            operation_name="Search Payments"
        )

        if error:
            return handle_erpnext_error(error, "Failed to search payments")

        data = response.json()

        return jsonify({
            "success": True,
            "data": data.get('data', [])
        })

    except Exception as e:
        print("--- Buscar pagos: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/pagos/customer-payments', methods=['GET'])
def get_customer_payments():
    """Obtiene los pagos/cobranzas de un cliente específico"""
    print("--- Obtener pagos cliente: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        customer_name = request.args.get('customer')
        status_filter = request.args.get('status', 'all')  # 'all', 'Draft', etc.
        limit = request.args.get('limit', 20)

        if not customer_name:
            return jsonify({"success": False, "message": "Nombre del cliente requerido"}), 400

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        # Construir filtros para Payment Entry
        filters = [
            ["party_type", "=", "Customer"],
            ["party", "=", customer_name],
            ["company", "=", company_name]
        ]

        if status_filter != 'all':
            filters.append(["docstatus", "=", 0 if status_filter == 'Draft' else 1])  # 0 = Draft, 1 = Submitted

        filters_json = json.dumps(filters)
        fields_json = json.dumps(["name", "posting_date", "paid_amount", "received_amount", "reference_no", "remarks", "docstatus", "status"])

        payments_response, payments_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Payment Entry",
            params={
                "filters": filters_json,
                "fields": fields_json,
                "order_by": "creation desc",
                "limit_page_length": limit
            },
            operation_name="Get Customer Payments"
        )

        if payments_error:
            return handle_erpnext_error(payments_error, "Failed to get customer payments")

        payments_data = payments_response.json()
        payments = payments_data.get("data", [])

        # Procesar los pagos para agregar campos adicionales
        for payment in payments:
            payment['doctype'] = 'Payment Entry'
            payment['status'] = 'Draft' if payment.get('docstatus') == 0 else 'Submitted'
            payment['outstanding_amount'] = 0  # Los pagos no tienen outstanding amount

        print(f"--- Pagos cliente: {len(payments)} registros")
        return jsonify({"success": True, "data": payments, "message": "Pagos obtenidos correctamente"})

    except Exception as e:
        print("--- Obtener pagos cliente: error")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@pagos_bp.route('/api/payments/bulk-removal', methods=['POST'])
def bulk_remove_payment_entries():
    """
    Permite eliminar o cancelar masivamente Payment Entries.
    docstatus 0 -> DELETE, docstatus 1 -> cancel (docstatus 2)
    """
    payload = request.get_json() or {}
    payments = payload.get('payments')

    if not payments or not isinstance(payments, list):
        return jsonify({"success": False, "message": "Debe proporcionar la lista de pagos a procesar"}), 400

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    summary = {"deleted": 0, "cancelled": 0, "failed": 0}
    results = []

    def resolve_docstatus(payment_name, provided_status=None):
        if provided_status is not None:
            return provided_status

        fields_str = '["docstatus"]'
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}?fields={quote(fields_str)}",
            operation_name=f"Get docstatus for '{payment_name}' (bulk removal)"
        )
        if error:
            raise RuntimeError(f"Error obteniendo docstatus: {error}")
        if response.status_code != 200:
            raise RuntimeError(f"Error obteniendo docstatus: {response.text}")
        data = response.json().get('data', {})
        return data.get('docstatus', 0)

    for entry in payments:
        payment_name = entry.get('name') if isinstance(entry, dict) else entry
        provided_status = entry.get('docstatus') if isinstance(entry, dict) else None

        if not payment_name:
            summary["failed"] += 1
            results.append({
                "name": payment_name,
                "success": False,
                "message": "Nombre de pago inválido"
            })
            continue

        try:
            docstatus = resolve_docstatus(payment_name, provided_status)

            if docstatus == 0:
                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                    operation_name=f"Delete draft payment entry '{payment_name}' (bulk)"
                )
                if delete_error:
                    raise RuntimeError(delete_error)
                if delete_response.status_code not in [200, 202, 204]:
                    raise RuntimeError(delete_response.text)

                summary["deleted"] += 1
                results.append({
                    "name": payment_name,
                    "success": True,
                    "action": "deleted"
                })

            elif docstatus == 1:
                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.cancel",
                    data={"doctype": "Payment Entry", "name": payment_name},
                    operation_name=f"Cancel payment entry '{payment_name}' (bulk)"
                )
                if cancel_error:
                    raise RuntimeError(cancel_error)
                if cancel_response.status_code != 200:
                    raise RuntimeError(cancel_response.text)

                summary["cancelled"] += 1
                results.append({
                    "name": payment_name,
                    "success": True,
                    "action": "cancelled"
                })
            else:
                summary["failed"] += 1
                results.append({
                    "name": payment_name,
                    "success": False,
                    "message": f"Docstatus {docstatus} no soportado para eliminación masiva"
                })

        except Exception as exc:
            summary["failed"] += 1
            results.append({
                "name": payment_name,
                "success": False,
                "message": str(exc)
            })

    success = summary["failed"] == 0
    message = (
        f"Procesados {len(payments)} pagos "
        f"(eliminados: {summary['deleted']}, cancelados: {summary['cancelled']}, con error: {summary['failed']})"
    )
    status_code = 200 if success else (207 if summary["deleted"] or summary["cancelled"] else 400)

    return jsonify({
        "success": success,
        "message": message,
        "summary": summary,
        "results": results
    }), status_code
