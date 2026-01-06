from flask import Blueprint, request, jsonify
import requests
import json
import traceback
import copy
import os
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Cargar AFIP codes
AFIP_CODES_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'shared', 'afip_codes.json')
with open(AFIP_CODES_PATH, 'r', encoding='utf-8') as f:
    AFIP_CODES = json.load(f)

# Importar funciones de companies.py para evitar duplicación
from routes.companies import load_active_companies

# Importar funciones de items.py para manejo de items
from routes.items import (
    process_invoice_item,
    find_or_create_item_by_description,
    create_item_with_description,
    create_free_item,
    get_tax_template_map,
    get_tax_template_for_rate,
    assign_tax_template_by_rate,
    determine_income_account,
    get_company_defaults
)

# Importar función para obtener cuenta específica del cliente
from routes.customers import get_customer_receivable_account
from routes.suppliers import get_supplier_payable_account
from routes.general import get_active_company, get_company_abbr, add_company_abbr, validate_company_abbr_operation, get_company_default_currency
from routes.supplier_reconciliation import assign_supplier_conciliation, clear_supplier_conciliation

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from utils.conciliation_utils import CONCILIATION_FIELD

# Crear el blueprint para las rutas de notas de crédito y débito
credit_debit_notes_bp = Blueprint('credit_debit_notes', __name__)


def _generate_name_from_afip(data, transaction_type):
    """
    Genera name usando AFIP codes.
    transaction_type: 'sales' o 'purchase'
    """
    invoice_type = data.get('invoice_type', '')
    is_credit = ('credito' in invoice_type.lower() or 'crédito' in invoice_type.lower() or 'credit' in invoice_type.lower())
    is_debit = ('debito' in invoice_type.lower() or 'débito' in invoice_type.lower() or 'debit' in invoice_type.lower())
    
    if is_credit:
        tipo_comprobante = 'NCC'
    elif is_debit:
        tipo_comprobante = 'NDB'
    else:
        # Si no se especifica, asumir NCC para notas de devolución
        tipo_comprobante = 'NCC'
    
    punto_de_venta = str(data.get('punto_de_venta', '') or '').strip()
    invoice_number = str(data.get('invoice_number', '') or '').strip()
    # letter comes from invoice_category (A/B/C/etc.) or voucher_type_code
    letter = str(data.get('invoice_category') or data.get('voucher_type_code') or '').strip().upper() or 'A'

    # Pad punto_de_venta to 5 and invoice_number to 8 (frontend already does this, but be defensive)
    padded_pv = punto_de_venta.zfill(5) if punto_de_venta else '00001'
    padded_num = invoice_number.zfill(8) if invoice_number else '00000001'

    if transaction_type == 'purchase':
        prefix = AFIP_CODES['naming_conventions']['prefixes']['compras']['default']
        sigla = AFIP_CODES['naming_conventions']['siglas'][tipo_comprobante]['compra']
    else:
        prefix = AFIP_CODES['naming_conventions']['prefixes']['ventas']['electronico']
        sigla = AFIP_CODES['naming_conventions']['siglas'][tipo_comprobante]['venta']

    # Return with letter included: PREFIX-SIGLA-LETTER-PV-NUM
    return f"{prefix}-{sigla}-{letter}-{padded_pv}-{padded_num}"


def _derive_naming_series_from_method(method_value):
    """
    Convierte un método de numeración del tipo PC-NCC-A-00001-00000001
    en un naming_series válido para ERPNext (PC-NCC-A-00001-.#########).
    """
    if not method_value or not isinstance(method_value, str):
        return None
    parts = method_value.split('-')
    if len(parts) < 4:
        return None
    prefix = '-'.join(parts[:4])
    return f"{prefix}-.#########"

@credit_debit_notes_bp.route('/api/credit-debit-notes', methods=['POST'])
def create_credit_debit_note():
    """Crear una nueva nota de crédito o débito con referencia a factura original"""
    print("\n--- Creando nueva nota de crédito/débito ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener datos del frontend
    note_data = request.get_json()
    print(f"Datos recibidos: {json.dumps(note_data, indent=2, ensure_ascii=False)}")

    if not note_data or 'data' not in note_data:
        return jsonify({"success": False, "message": "Datos requeridos"}), 400

    data = note_data['data']
    selected_invoice_allocations, selected_allocations_total = _normalize_supplier_invoice_allocations(
        data.get('selected_unpaid_invoices', [])
    )
    print(f"Data extraída: {json.dumps(data, indent=2, ensure_ascii=False)}")
    print(f"invoice_type en data: {data.get('invoice_type', 'NO EXISTE')}")
    print(f"invoice_type type: {type(data.get('invoice_type'))}")

    # Validación básica
    if not data.get('company'):
        return jsonify({"success": False, "message": "Compañía requerida"}), 400
    # return_against es opcional para notas de crédito independientes
    if not data.get('items') or len(data['items']) == 0:
        return jsonify({"success": False, "message": "Al menos un ítem requerido"}), 400
    # Requerir cliente O proveedor dependiendo del flujo
    if not data.get('customer') and not data.get('supplier'):
        return jsonify({"success": False, "message": "Cliente o Proveedor requerido"}), 400

    # Determinar si es nota de crédito o débito basado en el tipo
    invoice_type = data.get('invoice_type', '')
    print(f"Validando invoice_type: '{invoice_type}' (lowercase: '{invoice_type.lower()}')")
    # Buscar tanto con acento como sin acento
    is_credit_note = ('credito' in invoice_type.lower() or 'crédito' in invoice_type.lower() or
                     'credit' in invoice_type.lower())
    is_debit_note = ('debito' in invoice_type.lower() or 'débito' in invoice_type.lower() or
                    'debit' in invoice_type.lower())
    print(f"is_credit_note: {is_credit_note}, is_debit_note: {is_debit_note}")

    if not (is_credit_note or is_debit_note):
        print(f"ERROR: Tipo de comprobante inválido: '{invoice_type}'")
        return jsonify({"success": False, "message": "Tipo de comprobante debe ser nota de crédito o débito"}), 400

    try:
        # Paso 1: Obtener el mapa de templates de impuestos para la compañía
        print("Paso 1: Obteniendo mapa de templates de impuestos...")
        # Si es nota de compra, usar templates de purchase; por defecto sales
        transaction_type = 'purchase' if data.get('supplier') else 'sales'
        tax_map = get_tax_template_map(session, headers, data['company'], transaction_type=transaction_type)
        print(f"Tax map obtenido: {len(tax_map)} templates")
        company_defaults = get_company_defaults(data['company'], session, headers)
        if not company_defaults:
            return jsonify({"success": False, "message": "No se pudieron obtener las cuentas por defecto de la compañía"}), 400

        # Obtener moneda por defecto de la empresa
        default_currency = get_company_default_currency(session, headers, data['company'])

        # Paso 2: Preparar sigla y procesar items (crear items libres si es necesario)
        company_abbr = get_company_abbr(session, headers, data['company'])
        is_purchase_note = True if data.get('supplier') else False

        print("Paso 2: Procesando items...")
        processed_items = []
        has_stock_items = False

        for i, item in enumerate(data['items']):
            print(f"Procesando item {i+1}: {item.get('description', 'Sin descripción')}")
            processed_item = process_invoice_item(item, session, headers, data['company'], tax_map, transaction_type='purchase' if is_purchase_note else 'sales')
            if processed_item and is_purchase_note:
                # Add missing fields for purchase invoice items
                processed_item['uom'] = processed_item.get('uom', 'Unit')
                processed_item['stock_qty'] = processed_item.get('qty', 0)
                processed_item['amount'] = processed_item.get('qty', 0) * processed_item.get('rate', 0)
                processed_item['base_rate'] = processed_item.get('rate', 0)
                processed_item['base_amount'] = processed_item['amount']
                # Change income_account to expense_account for purchase
                if 'income_account' in processed_item:
                    processed_item['expense_account'] = processed_item.pop('income_account')
            if processed_item:
                # Asegurar que el item_code tenga la sigla de la compañía cuando corresponde (notas de compra)
                try:
                    if is_purchase_note and company_abbr:
                        original_code = processed_item.get('item_code', '')
                        if original_code and not original_code.endswith(f" - {company_abbr}"):
                            processed_item['item_code'] = add_company_abbr(original_code, company_abbr)
                            print(f"🏷️ Item code expandido para ERPNext: {processed_item['item_code']}")
                except Exception as e:
                    print(f"⚠️ Error aplicando company_abbr a item: {e}")

                # Verificar si este item es de stock
                item_response, item_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Item/{quote(processed_item['item_code'])}",
                    operation_name=f"Check if item '{processed_item['item_code']}' is stock item"
                )

                if item_error:
                    print(f"Error verificando si item es de stock: {item_error}")
                elif item_response and item_response.status_code == 200:
                    item_data = item_response.json()['data']
                    if item_data.get('is_stock_item') == 1:
                        has_stock_items = True
                        print(f"📦 Item de stock detectado en nota: {processed_item['item_code']}")
                        if not item.get('warehouse') or not item.get('warehouse').strip():
                            # Buscar default_warehouse en item_defaults para la compañía
                            default_warehouse = None
                            for default in item_data.get('item_defaults', []):
                                if default.get('company') == data['company']:
                                    default_warehouse = default.get('default_warehouse')
                                    break
                            if not default_warehouse:
                                default_warehouse = company_defaults.get('default_warehouse')
                            if default_warehouse:
                                item['warehouse'] = default_warehouse
                                print(f"📦 Usando almacén por defecto: {default_warehouse} para ítem {processed_item['item_code']}")
                            else:
                                error_msg = f"El ítem {processed_item['item_code']} es un ítem de stock y requiere un almacén asignado"
                                print(f"❌ {error_msg}")
                                return jsonify({"success": False, "message": error_msg}), 400
                processed_items.append(processed_item)
                print(f"Item {i+1} procesado correctamente")
            else:
                print(f"ERROR: Item {i+1} no pudo ser procesado")
                return jsonify({"success": False, "message": f"Error procesando item {i+1}"}), 400

        # Determinar si la nota debe actualizar el stock
        update_stock = 1 if has_stock_items else 0
        print(f"📊 Configuración update_stock para nota: {update_stock} (has_stock_items: {has_stock_items})")

        print(f"Total items procesados: {len(processed_items)}")

        # Paso 3: Obtener cuentas por defecto de la compañía
        print("Paso 3: Obteniendo cuentas por defecto...")
        print(f"Cuentas por defecto obtenidas: {company_defaults.get('default_receivable_account', 'N/A')}")

        # Paso 4: Construir y crear la nota
        print("Paso 4: Construyendo nota...")
        # Validar y ajustar fechas para evitar error de ERPNext
        posting_date = data.get('posting_date') or data.get('bill_date') or ''
        bill_date_value = data.get('bill_date') or posting_date
        due_date = data.get('due_date', '')

        print(f"Fechas - Posting: {posting_date}, Due: {due_date}")

        # Función auxiliar para ajustar fechas
        def adjust_due_date_if_needed(posting, due):
            if not posting or not due:
                return due
            try:
                from datetime import datetime
                posting_dt = datetime.strptime(posting, '%Y-%m-%d')
                due_dt = datetime.strptime(due, '%Y-%m-%d')
                if due_dt < posting_dt:
                    print(f"ADVERTENCIA: Due date {due} es anterior a posting date {posting}, ajustando a {posting}")
                    return posting  # Si due_date es anterior, usar posting_date
                return due
            except Exception as e:
                print(f"ERROR procesando fechas: {e}")
                return due

        # Ajustar due_date si es necesario
        due_date = adjust_due_date_if_needed(bill_date_value or posting_date, due_date)

        # Determinar cuenta y construir body dependiendo si es nota de venta o compra
        company_abbr = get_company_abbr(session, headers, data['company'])
        is_purchase_note = True if data.get('supplier') else False

        if is_purchase_note:
            # Cuenta por pagar (proveedor específico o compañía por defecto)
            supplier_account = get_supplier_payable_account(data['supplier'], data['company'], session, headers)
            credit_to_account = supplier_account if supplier_account else company_defaults.get('default_payable_account', '')

            print(f"💳 Cuenta por pagar - Proveedor específico: {supplier_account or 'No tiene'}, Compañía por defecto: {company_defaults.get('default_payable_account', 'No configurada')}, Usando: {credit_to_account}")

            # Agregar sigla al supplier para ERPNext si aplica
            erpnext_supplier = data['supplier']
            if company_abbr:
                original_supplier = erpnext_supplier
                erpnext_supplier = add_company_abbr(data['supplier'], company_abbr)
                # Only validate 'add' operation when the original did NOT already contain the suffix
                suffix = f" - {company_abbr}"
                if not original_supplier.endswith(suffix):
                    if not validate_company_abbr_operation(original_supplier, erpnext_supplier, company_abbr, 'add'):
                        print(f"⚠️ Validation failed for supplier name abbreviation: {original_supplier} -> {erpnext_supplier}")
                else:
                    # original already had suffix, no validation needed
                    pass
                print(f"🏷️ Supplier name expanded for ERPNext: {erpnext_supplier}")

            note_body = {
                "supplier": erpnext_supplier,
                "company": data['company'],
                "posting_date": posting_date,
                "bill_date": bill_date_value,
                "due_date": due_date,
                "credit_to": credit_to_account,
                "update_stock": update_stock,
                "items": processed_items,
                "set_posting_time": data.get('set_posting_time', 1),
                "is_return": 1,
            }
        else:
            # Cuenta por cobrar (cliente específico o compañía por defecto)
            customer_account = get_customer_receivable_account(data['customer'], data['company'], session, headers)
            debit_to_account = customer_account if customer_account else company_defaults.get('default_receivable_account', '')
            print(f"💳 Cuenta por cobrar para nota - Cliente específico: {customer_account or 'No tiene'}, Compañía por defecto: {company_defaults.get('default_receivable_account', 'No configurada')}, Usando: {debit_to_account}")

            note_body = {
                "customer": data['customer'],
                "company": data['company'],
                "posting_date": posting_date,
                "bill_date": bill_date_value,
                "due_date": due_date,
                "debit_to": debit_to_account,
                "update_stock": update_stock,
                "items": processed_items,
                "set_posting_time": data.get('set_posting_time', 1),
                "is_return": 1,  # Indica que es una nota de crédito/débito
            }

        # return_against es opcional - solo incluir si existe
        if data.get('return_against'):
            note_body["return_against"] = data['return_against']  # Referencia a la factura original

        # Mostrar campo principal según tipo (customer o supplier)
        principal = note_body.get('customer') if note_body.get('customer') else note_body.get('supplier')
        principal_label = 'customer' if 'customer' in note_body else 'supplier'
        print(f"Campos base de la nota: {principal_label}={principal}, company={note_body['company']}, return_against={note_body.get('return_against', 'N/A')}")

        # Agregar campos opcionales si existen
        optional_fields = ['invoice_number', 'punto_de_venta', 'currency', 'exchange_rate', 'status', 'title', 'invoice_type', 'voucher_type_code', 'invoice_category', 'price_list', 'discount_amount', 'net_gravado', 'net_no_gravado', 'total_iva', 'percepcion_iva', 'percepcion_iibb', 'metodo_numeracion_factura_venta', 'bill_date']
        allowed_status_values = {
            "",
            "Borrador",
            "Retornar",
            "Nota de débito emitida",
            "Validado",
            "Pagado",
            "Pagado parcialmente",
            "Impagado",
            "Atrasado",
            "Cancelado",
            "Transferencia interna"
        }
        for field in optional_fields:
            if field in data and data[field] is not None:
                if field == 'status':
                    status_value = str(data[field]).strip()
                    if status_value not in allowed_status_values:
                        print(f"⚠️ Estado '{status_value}' no permitido por ERPNext. Se omitirá el campo status.")
                        continue
                if field == 'sales_condition':
                    continue
                note_body[field] = data[field]
                print(f"Campo opcional agregado: {field} = {data[field]}")

        if data.get('selected_unpaid_invoices') is not None:
            note_body['selected_unpaid_invoices'] = selected_invoice_allocations
            print(f"?? Registrando {len(selected_invoice_allocations)} facturas seleccionadas para conciliación")

        # Si no se especificó moneda, usar la moneda por defecto de la empresa
        if not data.get('currency'):
            note_body['currency'] = default_currency
            print(f"Moneda por defecto establecida: {default_currency}")

        # Si el frontend indica que la nota está confirmada, setear docstatus=1
        if data.get('status') == 'Confirmada' or data.get('docstatus') == 1:
            note_body['docstatus'] = 1
            print(f"📌 Nota marcada como Confirmada por frontend. Se enviará docstatus=1")

        name = _generate_name_from_afip(data, transaction_type)
        if name:
            note_body['naming_series'] = name
            print(f"✅ Naming series generado: {name}")

        print(f"Nota completa a crear: {json.dumps(note_body, indent=2, ensure_ascii=False)}")

        # El título se guarda en el campo 'description' en ERPNext
        if data.get('title'):
            note_body['description'] = data['title']
            print(f"Título agregado como description: {data['title']}")

        # Verificar si es borrador y tiene nombre temporal sugerido
        is_draft = int(note_body.get('docstatus', 0)) == 0
        temp_name = data.get('temp_name', '').strip()
        
        if is_draft and temp_name:
            print(f"🔍 BORRADOR DE NOTA CON NOMBRE TEMPORAL SUGERIDO: {temp_name}")
            note_body['name'] = temp_name
            note_body['naming_series'] = temp_name
        elif is_draft:
            print(f"🔍 BORRADOR DE NOTA: Usando numeración nativa de ERPNext")
        else:
            print(f"🔍 NOTA CONFIRMADA: Usando numeración estándar")

        print("Enviando request a ERPNext...")
        # Para notas de compra, asegurarnos de que cada ítem tenga assigned warehouse
        if is_purchase_note:
            default_wh = company_defaults.get('default_warehouse') if company_defaults else ''
            if default_wh:
                for it in note_body.get('items', []):
                    if not it.get('warehouse') or not str(it.get('warehouse')).strip():
                        it['warehouse'] = default_wh
                        print(f"📦 Asignando almacén por defecto {default_wh} al ítem {it.get('item_code')}")
            else:
                print("⚠️ No se encontró almacén por defecto en company_defaults; los ítems de compra pueden fallar si no se especifica almacén")
        # Para notas de crédito/débito de devolución, ERPNext espera cantidades negativas
        if note_body.get('is_return'):
            for it in note_body.get('items', []):
                try:
                    qty = float(it.get('qty', 0))
                except Exception:
                    qty = 0
                if qty > 0:
                    it['qty'] = -abs(qty)
                    print(f"↩️ Ajustando qty a negativa para item {it.get('item_code')}: {it['qty']}")
        # Validar que sea purchase (supplier requerido)
        if not is_purchase_note:
            return jsonify({"success": False, "message": "Proveedor requerido para notas de crédito/débito"}), 400
        
        # Elegir endpoint (siempre Purchase Invoice)
        create_endpoint = "/api/resource/Purchase Invoice"
        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint=create_endpoint,
            data={"data": note_body},
            operation_name="Create credit/debit note"
        )

        if create_error:
            error_response = handle_erpnext_error(create_error, "Failed to create credit/debit note")
            if error_response:
                return error_response

        print(f"Response status: {create_response.status_code}")
        print(f"Response headers: {dict(create_response.headers)}")

        if create_response.status_code not in [200, 201]:
            error_msg = create_response.text
            print(f"ERROR creando nota: {error_msg}")
            try:
                error_json = create_response.json()
                print(f"Error JSON detallado: {json.dumps(error_json, indent=2, ensure_ascii=False)}")
            except:
                print(f"Error response no es JSON: {error_msg}")
            return jsonify({"success": False, "message": f"Error al crear la nota: {error_msg}"}), 400

        draft_result = create_response.json()
        note_name = draft_result['data']['name']
        print(f"Nota creada exitosamente: {note_name}")
        should_submit_note = bool(data.get('status') == 'Confirmada' or data.get('docstatus') == 1)
        should_attempt_reconciliation = bool(should_submit_note and is_purchase_note and selected_allocations_total > 0)

        # Si el status es 'Confirmada', confirmar la nota
        if should_submit_note:
            print(f"Confirmando nota: {note_name}")
            submit_endpoint = f"/api/resource/Purchase Invoice/{quote(note_name)}" if is_purchase_note else f"/api/resource/Sales Invoice/{quote(note_name)}"
            submit_response, submit_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=submit_endpoint,
                data={"docstatus": 1},
                operation_name=f"Submit credit/debit note '{note_name}'"
            )

            if submit_error:
                error_response = handle_erpnext_error(submit_error, f"Failed to submit credit/debit note '{note_name}'")
                if error_response:
                    return error_response

            if submit_response.status_code != 200:
                error_msg = submit_response.text
                print(f"Error confirmando nota: {error_msg}")
                return jsonify({"success": False, "message": f"Nota creada pero error al confirmar: {error_msg}"}), 400

            final_result = submit_response.json()
            print(f"Nota confirmada exitosamente: {note_name}")

            reconciliation_result = None
            reconciliation_error = None
            # Intentar conciliación automática si el usuario seleccionó facturas
            if (
                should_attempt_reconciliation
                and final_result.get('data', {}).get('docstatus') == 1
                and selected_invoice_allocations
            ):
                try:
                    documents = [{'voucher_no': note_name, 'doctype': 'Purchase Invoice'}]
                    documents.extend(
                        {'voucher_no': alloc.get('voucher_no'), 'doctype': 'Purchase Invoice'}
                        for alloc in selected_invoice_allocations
                        if alloc.get('voucher_no')
                    )
                    reconciliation_result = assign_supplier_conciliation(
                        session=session,
                        headers=headers,
                        supplier_name=note_body.get('supplier'),
                        company=data['company'],
                        documents=documents
                    )
                except Exception as recon_error:
                    reconciliation_error = str(recon_error)
                    print(f"[supplier_reconciliation] Error conciliando nota '{note_name}': {reconciliation_error}")

            # Si no hay facturas seleccionadas pero viene 'return_against', conciliar con ese comprobante
            if (
                final_result.get('data', {}).get('docstatus') == 1
                and not reconciliation_result
                and data.get('return_against')
            ):
                try:
                    target = str(data.get('return_against') or '').strip()
                    if target:
                        # Obtener conciliación existente del comprobante objetivo (si existe)
                        existing_conc_id = None
                        try:
                            inv_resp, inv_err = make_erpnext_request(
                                session=session,
                                method="GET",
                                endpoint=f"/api/resource/Purchase%20Invoice/{quote(target)}",
                                operation_name=f"Fetch target invoice '{target}' for auto-conciliation"
                            )
                            if not inv_err and inv_resp and inv_resp.status_code == 200:
                                existing_conc_id = inv_resp.json().get('data', {}).get(CONCILIATION_FIELD)
                        except Exception:
                            existing_conc_id = None

                        documents = [
                            {'voucher_no': note_name, 'doctype': 'Purchase Invoice'},
                            {'voucher_no': target, 'doctype': 'Purchase Invoice'}
                        ]
                        reconciliation_result = assign_supplier_conciliation(
                            session=session,
                            headers=headers,
                            supplier_name=note_body.get('supplier'),
                            company=data['company'],
                            documents=documents,
                            conciliation_id=existing_conc_id
                        )
                except Exception as recon_error:
                    reconciliation_error = str(recon_error)
                    print(f"[supplier_reconciliation] Error conciliando nota '{note_name}' con return_against '{data.get('return_against')}': {reconciliation_error}")

            response_payload = {
                "success": True,
                "message": "Nota de crédito/débito creada y confirmada exitosamente",
                "data": final_result['data']
            }
            if reconciliation_result:
                response_payload['reconciliation'] = reconciliation_result
            if reconciliation_error:
                response_payload['reconciliation_error'] = reconciliation_error

            return jsonify(response_payload)
        else:
            # Devolver la nota en borrador
            draft_payload = {
                "success": True,
                "message": "Nota de crédito/débito creada en borrador exitosamente",
                "data": draft_result['data']
            }
            if is_purchase_note and selected_allocations_total > 0:
                draft_payload['warning'] = "La conciliación se aplicará automáticamente cuando confirmes la nota."
            return jsonify(draft_payload)

    except Exception as e:
        print(f"Error creando nota de crédito/débito: {str(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def _to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _sanitize_child_table(child_records):
    sanitized = []
    for idx, record in enumerate(child_records or [], start=1):
        if not isinstance(record, dict):
            continue
        cleaned = copy.deepcopy(record)
        for field in ('name', 'parent', 'parentfield', 'parenttype'):
            cleaned.pop(field, None)
        cleaned['idx'] = idx
        sanitized.append(cleaned)
    return sanitized


def _build_combined_return_invoice(partial_docs, overrides=None):
    overrides = overrides or {}
    base_doc = copy.deepcopy(partial_docs[0])
    for field in ('name', 'amended_from', 'naming_series'):
        base_doc.pop(field, None)

    base_doc['is_return'] = 1
    base_doc['docstatus'] = 0
    base_doc['status'] = 'Draft'
    base_doc['update_stock'] = 0
    base_doc['return_against'] = ''
    base_doc['return_against_list'] = []

    if overrides.get('posting_date'):
        base_doc['posting_date'] = overrides['posting_date']
    if overrides.get('due_date'):
        base_doc['due_date'] = overrides['due_date']

    all_items = []
    all_taxes = []
    all_perceptions = []
    for doc in partial_docs:
        all_items.extend(copy.deepcopy(doc.get('items') or []))
        all_taxes.extend(copy.deepcopy(doc.get('taxes') or []))
        if isinstance(doc.get('perceptions'), list):
            all_perceptions.extend(copy.deepcopy(doc.get('perceptions') or []))

    base_doc['items'] = _sanitize_child_table(all_items)
    base_doc['taxes'] = _sanitize_child_table(all_taxes)
    base_doc['perceptions'] = _sanitize_child_table(all_perceptions)

    total_qty = sum(_to_float(item.get('qty')) for item in base_doc['items'])
    base_doc['total_qty'] = total_qty

    for field in [
        'base_total', 'total', 'base_net_total', 'net_total', 'discount_amount',
        'base_total_taxes_and_charges', 'total_taxes_and_charges',
        'base_grand_total', 'grand_total', 'rounded_total', 'base_rounded_total',
        'outstanding_amount', 'credit_note_total', 'percepcion_iva', 'percepcion_iibb',
        'net_gravado', 'net_no_gravado', 'total_iva'
    ]:
        base_doc[field] = sum(_to_float(doc.get(field)) for doc in partial_docs)

    return base_doc


def _coerce_positive_float(value):
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return 0.0
    return abs(numeric_value)


def _normalize_supplier_invoice_allocations(raw_allocations):
    normalized = []
    total_amount = 0.0

    if isinstance(raw_allocations, str):
        try:
            parsed = json.loads(raw_allocations)
            raw_allocations = parsed if isinstance(parsed, list) else []
        except Exception:
            raw_allocations = []

    if not isinstance(raw_allocations, list):
        return normalized, total_amount

    for entry in raw_allocations:
        if not isinstance(entry, dict):
            continue
        voucher = (entry.get('voucher_no') or entry.get('name') or entry.get('source_name') or '').strip()
        if not voucher:
            continue
        amount_value = entry.get('amount')
        if amount_value in (None, '', 0):
            amount_value = entry.get('allocated_amount') or entry.get('suggested_amount')
        normalized_amount = _coerce_positive_float(amount_value)
        if normalized_amount <= 0:
            continue

        normalized_entry = {
            "voucher_no": voucher,
            "name": voucher,
            "amount": round(normalized_amount, 2),
            "allocated_amount": round(normalized_amount, 2)
        }

        for field in ('currency', 'posting_date', 'return_against', 'source_name'):
            if entry.get(field):
                normalized_entry[field] = entry[field]

        normalized.append(normalized_entry)
        total_amount += normalized_entry['amount']

    return normalized, total_amount




@credit_debit_notes_bp.route('/api/credit-debit-notes/multi-make', methods=['POST'])
def create_multi_credit_note_payload():
    """Generar una nota de credito combinada a partir de multiples facturas de compra o venta."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    purchase_invoices = payload.get('purchase_invoices') or []
    sales_invoices = payload.get('sales_invoices') or []

    if purchase_invoices and sales_invoices:
        return jsonify({
            "success": False,
            "message": "No se puede generar una nota combinada mezclando facturas de compra y de venta."
        }), 400

    transaction_type = 'purchase' if purchase_invoices else 'sales' if sales_invoices else None
    if not transaction_type:
        generic_list = payload.get('invoices') or []
        if not isinstance(generic_list, list) or not generic_list:
            return jsonify({
                "success": False,
                "message": "Debe proporcionar una lista de facturas para generar la nota de credito."
            }), 400
        source_invoices = generic_list
        transaction_type = payload.get('transaction_type') or 'purchase'
    else:
        source_invoices = purchase_invoices if transaction_type == 'purchase' else sales_invoices

    if not isinstance(source_invoices, list) or len(source_invoices) == 0:
        return jsonify({
            "success": False,
            "message": "Debe proporcionar una lista de facturas para generar la nota de credito."
        }), 400

    partial_documents = []
    invoice_summaries = []

    for source_name in source_invoices:
        if not source_name:
            continue

        print(f"--- Multi-make credit note: Generando nota parcial ({transaction_type}) desde {source_name}")
        request_data = {"source_name": source_name}
        if transaction_type == 'purchase':
            endpoint = "/api/method/erpnext.accounts.doctype.purchase_invoice.purchase_invoice.make_debit_note"
            operation_name = f"Create debit note from purchase invoice '{source_name}'"
        else:
            endpoint = "/api/method/erpnext.accounts.doctype.sales_invoice.sales_invoice.make_sales_return"
            operation_name = f"Create credit note from sales invoice '{source_name}'"
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint=endpoint,
            data=request_data,
            operation_name=operation_name
        )

        if error:
            return handle_erpnext_error(error, f"Error generando nota desde {source_name}")

        if response.status_code != 200:
            return jsonify({
                "success": False,
                "message": response.text
            }), response.status_code

        erp_payload = response.json()
        document = erp_payload.get('message')
        if not isinstance(document, dict):
            return jsonify({
                "success": False,
                "message": f"ERPNext devolvio un documento invalido al generar la nota desde {source_name}"
            }), 400

        try:
            print(f"--- Multi-make credit note: payload recibido de ERPNext para {source_name}: {json.dumps(document, ensure_ascii=False)}")
            taxes_preview = document.get('taxes') or []
            if taxes_preview:
                perception_taxes = [
                    tax for tax in taxes_preview
                    if isinstance(tax, dict) and (
                        tax.get('custom_is_perception') in (1, True) or
                        (isinstance(tax.get('account_head'), str) and 'percepcion' in tax.get('account_head', '').lower())
                    )
                ]
                if perception_taxes:
                    print(f"--- Multi-make credit note: percepciones detectadas para {source_name}: {json.dumps(perception_taxes, ensure_ascii=False)}")
        except Exception as log_exc:
            print(f"--- Multi-make credit note: no se pudo registrar el payload de {source_name}: {log_exc}")

        partial_documents.append(document)
        grand_total = _to_float(document.get('grand_total'))
        invoice_summaries.append({
            "source_name": source_name,
            "return_against": document.get('return_against') or source_name,
            "currency": document.get('currency'),
            "posting_date": document.get('posting_date'),
            "suggested_amount": abs(grand_total),
            "partial_credit_note_total": grand_total
        })

    if not partial_documents:
        return jsonify({
            "success": False,
            "message": "No se pudieron generar notas parciales para la combinacion solicitada."
        }), 400

    combined_document = _build_combined_return_invoice(partial_documents, payload)
    combined_total = sum(summary['partial_credit_note_total'] for summary in invoice_summaries)
    combined_document['grand_total'] = combined_total
    combined_document['base_grand_total'] = combined_total
    combined_document['credit_note_total'] = abs(combined_total)

    return jsonify({
        "success": True,
        "data": {
            "combined_document": combined_document,
            "partial_documents": partial_documents,
            "invoice_summaries": invoice_summaries,
            "transaction_type": transaction_type
        }
    })

@credit_debit_notes_bp.route('/api/credit-debit-notes/<note_name>', methods=['PUT'])
def update_credit_debit_note(note_name):
    """Modificar una nota de crédito/débito existente
    
    Si se está confirmando un borrador Y el número cambió:
    1. Crear una nueva nota confirmada con el número correcto
    2. Eliminar el borrador viejo
    """
    print(f"\n--- Modificando nota {note_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    data = request.get_json().get('data', {})
    print(f"Datos de actualización recibidos: {json.dumps(data, indent=2, ensure_ascii=False)}")
    normalized_selected_allocations, selected_allocations_total = _normalize_supplier_invoice_allocations(
        data.get('selected_unpaid_invoices', [])
    )

    company = data.get('company')
    if not company:
        return jsonify({"success": False, "message": "Compañía requerida"}), 400

    existing_note_data = {}
    existing_note_allocations = []
    existing_note_docstatus = None

    existing_note_doctype = "Purchase Invoice" if data.get('supplier') else "Sales Invoice"
    existing_note_operation = "purchase" if data.get('supplier') else "sales"
    existing_note_resp, existing_note_error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/{existing_note_doctype}/{quote(note_name)}",
        operation_name=f"Get existing {existing_note_operation} credit/debit note '{note_name}' before update"
    )
    if not existing_note_error and existing_note_resp and existing_note_resp.status_code == 200:
        existing_note_data = existing_note_resp.json().get('data', {}) or {}
        existing_note_docstatus = existing_note_data.get('docstatus')
        if data.get('supplier'):
            existing_note_allocations, _ = _normalize_supplier_invoice_allocations(
                existing_note_data.get('selected_unpaid_invoices', [])
            )
    else:
        print(
            f"No se pudo obtener la nota '{note_name}' ({existing_note_doctype}) antes de actualizar: "
            f"{existing_note_error or (existing_note_resp.text if existing_note_resp else 'sin respuesta')}"
        )

    # Verificar si se está confirmando (docstatus = 1) un borrador
    is_confirming = data.get('docstatus') == 1
    expected_name_from_method = None
    
    if is_confirming and 'metodo_numeracion_factura_venta' in data:
        # Extraer el nombre esperado del método de numeración
        # Ejemplo: FE-NDC-A-00003-00000001 → FE-NDC-A-00003-0000000100001
        metodo = data['metodo_numeracion_factura_venta']
        expected_name_from_method = metodo.replace('-', '-', 4).replace('-', '-', 1) + '00001'
        # Formato más simple: solo agregar los últimos 5 dígitos
        parts = metodo.split('-')
        if len(parts) >= 5:
            expected_name_from_method = f"{parts[0]}-{parts[1]}-{parts[2]}-{parts[3]}-{parts[4]}00001"
        
        print(f"🔍 Verificando nombre: borrador={note_name}, esperado={expected_name_from_method}")
        
        # Si el nombre no coincide con el esperado, crear nuevo documento
        if note_name != expected_name_from_method and note_name.startswith('ACC-SINV'):
            print(f"⚠️ Nombre del borrador diferente al esperado. Creando nuevo documento confirmado...")
            
            # Eliminar el campo 'name' para que ERPNext genere uno nuevo
            if 'name' in data:
                del data['name']
            
            # Forzar docstatus a 0 primero (crear como borrador)
            data['docstatus'] = 0
            
            try:
                # Obtener el mapa de templates de impuestos
                is_purchase_replace = True if data.get('supplier') else False
                tx_type_replace = 'purchase' if is_purchase_replace else 'sales'
                tax_map = get_tax_template_map(session, headers, company, transaction_type=tx_type_replace)
                
                # Procesar items
                processed_items = []
                for item in data.get('items', []):
                    processed_item = process_invoice_item(item, session, headers, company, tax_map, transaction_type='purchase' if is_purchase_replace else 'sales')
                    if processed_item and is_purchase_replace:
                        # Add missing fields for purchase invoice items
                        processed_item['uom'] = processed_item.get('uom', 'Unit')
                        processed_item['stock_qty'] = processed_item.get('qty', 0)
                        processed_item['amount'] = processed_item.get('qty', 0) * processed_item.get('rate', 0)
                        processed_item['base_rate'] = processed_item.get('rate', 0)
                        processed_item['base_amount'] = processed_item['amount']
                        # Change income_account to expense_account for purchase
                        if 'income_account' in processed_item:
                            processed_item['expense_account'] = processed_item.pop('income_account')
                    if processed_item:
                        processed_items.append(processed_item)
                
                # Derivar naming series de naming_conventions para compras
                import os
                afip_codes_path = os.path.join(os.path.dirname(__file__), '..', '..', 'shared', 'afip_codes.json')
                with open(afip_codes_path, 'r', encoding='utf-8') as f:
                    afip_codes = json.load(f)
                
                prefix = 'PC'  # Para compras, usar PC según convenciones
                
                invoice_type = data.get('invoice_type', '')
                is_credit_note = ('credito' in invoice_type.lower() or 'crédito' in invoice_type.lower() or
                                 'credit' in invoice_type.lower())
                is_debit_note = ('debito' in invoice_type.lower() or 'débito' in invoice_type.lower() or
                                'debit' in invoice_type.lower())
                
                if is_credit_note:
                    sigla = afip_codes['naming_conventions']['siglas']['NCC']['compra']
                elif is_debit_note:
                    sigla = afip_codes['naming_conventions']['siglas']['NDB']['compra']
                
                punto_de_venta = data.get('punto_de_venta')
                if not punto_de_venta:
                    return jsonify({"success": False, "message": "Punto de venta requerido"}), 400
                
                numero = data.get('invoice_number')
                if not numero:
                    return jsonify({"success": False, "message": "Número requerido"}), 400
                
                # Buscar letra en afip_codes por descripción del invoice_type
                letra = None
                for code, info in afip_codes['comprobantes'].items():
                    if info.get('description') == invoice_type:
                        letra = info.get('letra')
                        break
                if not letra:
                    return jsonify({"success": False, "message": "Letra de comprobante no encontrada en afip_codes"}), 400
                
                naming_series = f"{prefix}-{sigla}-{letra}-{punto_de_venta}-.#########"
                print(f"✅ Naming series para nueva nota: {naming_series}")
                
                # Crear body para nuevo documento (Sales o Purchase según flujo)
                if is_purchase_replace:
                    new_body = {
                        "doctype": "Purchase Invoice",
                        "supplier": data.get('supplier'),
                        "company": company,
                        "items": processed_items,
                        "is_return": 1,
                        "docstatus": 0  # Crear como borrador primero
                    }
                else:
                    new_body = {
                        "doctype": "Sales Invoice",
                        "customer": data.get('customer'),
                        "company": company,
                        "items": processed_items,
                        "is_return": 1,
                        "docstatus": 0  # Crear como borrador primero
                    }
                
                # IMPORTANTE: Agregar naming_series PRIMERO si existe
                if naming_series:
                    new_body["naming_series"] = naming_series
                    print(f"✅ Usando naming_series: {naming_series}")
                
                # Agregar campos opcionales
                for field in ['posting_date', 'due_date', 'return_against', 'invoice_number', 'punto_de_venta', 
                             'currency', 'title', 'invoice_type', 'voucher_type_code', 'invoice_category', 
                             'metodo_numeracion_factura_venta', 'price_list', 'discount_amount', 'net_gravado', 
                             'net_no_gravado', 'total_iva', 'percepcion_iva', 'percepcion_iibb']:
                    if field in data and data[field] is not None:
                        new_body[field] = data[field]

                # Para notas de compra, asignar warehouse por defecto a cada ítem si falta
                if is_purchase_replace:
                    try:
                        company_defaults_replace = get_company_defaults(company, session, headers)
                        default_wh_replace = company_defaults_replace.get('default_warehouse') if company_defaults_replace else ''
                        if default_wh_replace:
                            for it in new_body.get('items', []):
                                if not it.get('warehouse') or not str(it.get('warehouse')).strip():
                                    it['warehouse'] = default_wh_replace
                                    print(f"📦 Asignando almacén por defecto {default_wh_replace} al ítem {it.get('item_code')} (reemplazo)")
                        else:
                            print("⚠️ No se encontró almacén por defecto para la compañía al crear reemplazo; los ítems de compra pueden fallar")
                    except Exception as e:
                        print(f"⚠️ Error al obtener company_defaults para reemplazo: {e}")
                # Asegurar cantidades negativas para items en notas de devolución (reemplazo)
                if new_body.get('is_return'):
                    for it in new_body.get('items', []):
                        try:
                            qty = float(it.get('qty', 0))
                        except Exception:
                            qty = 0
                        if qty > 0:
                            it['qty'] = -abs(qty)
                            print(f"↩️ Ajustando qty a negativa para item {it.get('item_code')} (reemplazo): {it['qty']}")

                # Crear nuevo documento
                print(f"📝 Creando nuevo documento con número correcto...")
                print(f"Body: {json.dumps(new_body, indent=2, ensure_ascii=False)}")
                
                create_endpoint = "/api/resource/Purchase Invoice" if is_purchase_replace else "/api/resource/Sales Invoice"
                create_response, create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint=create_endpoint,
                    data=new_body,
                    operation_name="Create replacement credit/debit note"
                )
                
                if create_error:
                    error_response = handle_erpnext_error(create_error, "Failed to create replacement credit/debit note")
                    if error_response:
                        return error_response
                
                if create_response.status_code != 200:
                    print(f"❌ Error creando nuevo documento: {create_response.text}")
                    return jsonify({"success": False, "message": f"Error creando documento: {create_response.text}"}), 400
                
                new_note_name = create_response.json()['data']['name']
                print(f"✅ Nuevo documento creado: {new_note_name}")
                
                # Confirmar el nuevo documento
                print(f"✅ Confirmando nuevo documento...")
                confirm_endpoint = f"/api/resource/Purchase Invoice/{quote(new_note_name)}" if is_purchase_replace else f"/api/resource/Sales Invoice/{quote(new_note_name)}"
                confirm_response, confirm_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=confirm_endpoint,
                    data={"data": {"docstatus": 1}},
                    operation_name=f"Submit replacement credit/debit note '{new_note_name}'"
                )
                
                if confirm_error:
                    error_response = handle_erpnext_error(confirm_error, f"Failed to submit replacement credit/debit note '{new_note_name}'")
                    if error_response:
                        return error_response
                
                if confirm_response.status_code != 200:
                    print(f"❌ Error confirmando nuevo documento: {confirm_response.text}")
                    return jsonify({"success": False, "message": f"Error confirmando documento: {confirm_response.text}"}), 400
                
                # Eliminar el borrador viejo
                print(f"🗑️ Eliminando borrador viejo: {note_name}")
                delete_endpoint = f"/api/resource/Purchase Invoice/{quote(note_name)}" if is_purchase_replace else f"/api/resource/Sales Invoice/{quote(note_name)}"
                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=delete_endpoint,
                    operation_name=f"Delete old draft credit/debit note '{note_name}'"
                )
                
                if delete_error:
                    print(f"⚠️ Error eliminando borrador viejo (continuando): {delete_error}")
                elif delete_response and delete_response.status_code != 202:
                    print(f"⚠️ Error eliminando borrador viejo (continuando): {delete_response.text}")
                
                # Devolver el documento nuevo confirmado
                return jsonify({
                    "success": True,
                    "message": "Nota confirmada exitosamente con número correcto",
                    "data": confirm_response.json()['data'],
                    "replaced": True,
                    "old_name": note_name,
                    "new_name": new_note_name
                })
                
            except Exception as e:
                print(f"❌ Error en proceso de reemplazo: {str(e)}")
                import traceback
                print(f"Traceback: {traceback.format_exc()}")
                return jsonify({"success": False, "message": f"Error reemplazando borrador: {str(e)}"}), 500

    try:
        # Obtener el mapa de templates de impuestos (purchase si viene supplier)
        tx_type_update = 'purchase' if data.get('supplier') else 'sales'
        tax_map = get_tax_template_map(session, headers, company, transaction_type=tx_type_update)

        # Procesar items igual que en la creación
        processed_items = []
        for item in data.get('items', []):
            processed_item = process_invoice_item(item, session, headers, company, tax_map, transaction_type=tx_type_update)
            if processed_item and tx_type_update == 'purchase':
                # Add missing fields for purchase invoice items
                processed_item['uom'] = processed_item.get('uom', 'Unit')
                processed_item['stock_qty'] = processed_item.get('qty', 0)
                processed_item['amount'] = processed_item.get('qty', 0) * processed_item.get('rate', 0)
                processed_item['base_rate'] = processed_item.get('rate', 0)
                processed_item['base_amount'] = processed_item['amount']
                # Change income_account to expense_account for purchase
                if 'income_account' in processed_item:
                    processed_item['expense_account'] = processed_item.pop('income_account')
            if processed_item:
                processed_items.append(processed_item)

        if data.get('supplier'):
            update_body = {
                "supplier": data.get('supplier'),
                "company": company,
                "items": processed_items,
                "is_return": 1,
                "return_against": data.get('return_against'),
                "docstatus": data.get('docstatus', 0),
                "posting_date": data.get('posting_date') or data.get('bill_date') or '',
                "bill_date": data.get('bill_date') or data.get('posting_date') or '',
                "set_posting_time": data.get('set_posting_time', 1)
            }
            if data.get('selected_unpaid_invoices') is not None:
                update_body['selected_unpaid_invoices'] = normalized_selected_allocations
        else:
            update_body = {
                "customer": data.get('customer'),
                "company": company,
                "items": processed_items,
                "is_return": 1,
                "return_against": data.get('return_against'),
                "docstatus": data.get('docstatus', 0),
                "posting_date": data.get('posting_date') or data.get('bill_date') or '',
                "bill_date": data.get('bill_date') or data.get('posting_date') or '',
                "set_posting_time": data.get('set_posting_time', 1)
            }

        # Agregar campos opcionales si existen
        valid_fields = ['posting_date', 'bill_date', 'due_date', 'invoice_number', 'punto_de_venta', 'currency', 'title', 'price_list', 'discount_amount', 'total_iva', 'percepcion_iva', 'percepcion_iibb']
        
        for field in valid_fields:
            if field in data and data[field] is not None:
                update_body[field] = data[field]

        # Copiar price_list_currency de la nota existente si existe
        if existing_note_data and 'price_list_currency' in existing_note_data:
            update_body['price_list_currency'] = existing_note_data['price_list_currency']

        print(f"Actualizando nota: {json.dumps(update_body, indent=2, ensure_ascii=False)}")

        # Si la nota existente está confirmada, crear nueva y cancelar la anterior
        if existing_note_docstatus == 1:
            print(f"⚠️ Nota existente confirmada, creando nueva versión...")
            
            # Preparar body para nueva nota
            new_body = update_body.copy()
            new_body['docstatus'] = 1  # Confirmar la nueva
            
            # Agregar naming_series si viene metodo_numeracion_factura_venta
            if 'metodo_numeracion_factura_venta' in data:
                transaction_type_update = 'purchase' if 'supplier' in data else 'sales'
                name = _generate_name_from_afip(data, transaction_type_update)
                if name:
                    new_body['naming_series'] = name
                    print(f"✅ Naming series para nueva nota: {name}")

            # Preservar conciliación si la nota original tenía un conciliation id
            try:
                orig_conc_id = existing_note_data.get(CONCILIATION_FIELD)
                if orig_conc_id:
                    new_body[CONCILIATION_FIELD] = orig_conc_id
                    print(f"📎 Preservando conciliation id en la nota modificada: {orig_conc_id}")
            except Exception:
                pass
            
            # Asegurar cantidades negativas para items en notas de devolución
            if new_body.get('is_return'):
                for it in new_body.get('items', []):
                    try:
                        qty = float(it.get('qty', 0))
                    except Exception:
                        qty = 0
                    if qty > 0:
                        it['qty'] = -abs(qty)
                        it['stock_qty'] = -abs(it.get('stock_qty', qty))  # También stock_qty
                        print(f"↩️ Ajustando qty a negativa para item {it.get('item_code')} (nueva nota): {it['qty']}")
            
            # Crear nueva nota
            create_endpoint = f"/api/resource/Purchase Invoice" if data.get('supplier') else f"/api/resource/Sales Invoice"
            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint=create_endpoint,
                data={"data": new_body},
                operation_name=f"Create replacement credit/debit note for '{note_name}'"
            )
            
            if create_error:
                error_response = handle_erpnext_error(create_error, f"Failed to create replacement credit/debit note")
                if error_response:
                    return error_response
            
            if create_response.status_code != 200:
                print(f"❌ Error creando nueva nota: {create_response.text}")
                return jsonify({"success": False, "message": f"Error creando nueva nota: {create_response.text}"}), 400
            
            new_note_data = create_response.json()['data']
            new_note_name = new_note_data['name']
            print(f"✅ Nueva nota creada: {new_note_name}")
            
            # Cancelar la nota anterior
            cancel_response, cancel_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.cancel",
                data={"doctype": "Purchase Invoice" if data.get('supplier') else "Sales Invoice", "name": note_name},
                operation_name=f"Cancel old credit/debit note '{note_name}'"
            )
            
            if cancel_error:
                print(f"⚠️ Error cancelando nota anterior (continuando): {cancel_error}")
            elif cancel_response.status_code != 200:
                print(f"⚠️ Error cancelando nota anterior (continuando): {cancel_response.text}")
            else:
                print(f"✅ Nota anterior cancelada: {note_name}")
            
            # Manejar conciliaciones para la nueva nota
            reconciliation_result = None
            reconciliation_error = None
            if data.get('supplier') and normalized_selected_allocations:
                try:
                    documents = [{'voucher_no': new_note_name, 'doctype': 'Purchase Invoice'}]
                    documents.extend(
                        {'voucher_no': alloc.get('voucher_no'), 'doctype': 'Purchase Invoice'}
                        for alloc in normalized_selected_allocations
                        if alloc.get('voucher_no')
                    )
                    reconciliation_result = assign_supplier_conciliation(
                        session=session,
                        headers=headers,
                        supplier_name=data.get('supplier'),
                        company=company,
                        documents=documents
                    )
                except Exception as recon_error:
                    reconciliation_error = str(recon_error)
                    print(f"[supplier_reconciliation] Error conciliando nueva nota '{new_note_name}': {reconciliation_error}")

            # Si no hay facturas seleccionadas pero viene 'return_against', conciliar con ese comprobante
            if data.get('supplier') and not reconciliation_result and data.get('return_against'):
                try:
                    target = str(data.get('return_against') or '').strip()
                    if target:
                        existing_conc_id = None
                        try:
                            inv_resp, inv_err = make_erpnext_request(
                                session=session,
                                method="GET",
                                endpoint=f"/api/resource/Purchase%20Invoice/{quote(target)}",
                                operation_name=f"Fetch target invoice '{target}' for auto-conciliation (update)"
                            )
                            if not inv_err and inv_resp and inv_resp.status_code == 200:
                                existing_conc_id = inv_resp.json().get('data', {}).get(CONCILIATION_FIELD)
                        except Exception:
                            existing_conc_id = None

                        documents = [
                            {'voucher_no': new_note_name, 'doctype': 'Purchase Invoice'},
                            {'voucher_no': target, 'doctype': 'Purchase Invoice'}
                        ]
                        reconciliation_result = assign_supplier_conciliation(
                            session=session,
                            headers=headers,
                            supplier_name=data.get('supplier'),
                            company=company,
                            documents=documents,
                            conciliation_id=existing_conc_id
                        )
                except Exception as recon_error:
                    reconciliation_error = str(recon_error)
                    print(f"[supplier_reconciliation] Error conciliando nueva nota '{new_note_name}' con return_against '{data.get('return_against')}': {reconciliation_error}")
            
            response_payload = {
                "success": True,
                "message": "Nota actualizada exitosamente (creada nueva versión)",
                "data": new_note_data,
                "replaced": True,
                "old_name": note_name,
                "new_name": new_note_name
            }
            if reconciliation_result:
                response_payload['reconciliation'] = reconciliation_result
            if reconciliation_error:
                response_payload['reconciliation_error'] = reconciliation_error
            
            return jsonify(response_payload)
        
        # Si no está confirmada, hacer update normal
        update_endpoint = f"/api/resource/Purchase Invoice/{quote(note_name)}" if data.get('supplier') else f"/api/resource/Sales Invoice/{quote(note_name)}"
        # Antes de actualizar, asegurar cantidades negativas si es nota de devolución
        if update_body.get('is_return'):
            for it in update_body.get('items', []):
                try:
                    qty = float(it.get('qty', 0))
                except Exception:
                    qty = 0
                if qty > 0:
                    it['qty'] = -abs(qty)
                    print(f"↩️ Ajustando qty a negativa para item {it.get('item_code')} (update): {it['qty']}")

        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=update_endpoint,
            data={"data": update_body},
            operation_name=f"Update credit/debit note '{note_name}'"
        )

        if update_error:
            error_response = handle_erpnext_error(update_error, f"Failed to update credit/debit note '{note_name}'")
            if error_response:
                return error_response

        if update_response.status_code != 200:
            error_msg = update_response.text
            print(f"Error actualizando nota: {error_msg}")
            return jsonify({"success": False, "message": f"Error al actualizar la nota: {error_msg}"}), 400

        result = update_response.json()
        print(f"Nota actualizada exitosamente: {note_name}")

        reconciliation_reset = None
        reconciliation_result = None
        reconciliation_error = None
        updated_docstatus = result.get('data', {}).get('docstatus')

        if data.get('supplier') and updated_docstatus == 1:
            if existing_note_docstatus == 1 and existing_note_allocations:
                try:
                    docs_to_clear = [{'voucher_no': note_name, 'doctype': 'Purchase Invoice'}]
                    docs_to_clear.extend(
                        {'voucher_no': alloc.get('voucher_no'), 'doctype': 'Purchase Invoice'}
                        for alloc in existing_note_allocations
                        if alloc.get('voucher_no')
                    )
                    reconciliation_reset = clear_supplier_conciliation(
                        session=session,
                        headers=headers,
                        supplier_name=data.get('supplier'),
                        company=company,
                        documents=docs_to_clear
                    )
                except Exception as reset_error:
                    print(f"[supplier_reconciliation] Error limpiando conciliación previa de '{note_name}': {reset_error}")
            if normalized_selected_allocations:
                try:
                    documents = [{'voucher_no': note_name, 'doctype': 'Purchase Invoice'}]
                    documents.extend(
                        {'voucher_no': alloc.get('voucher_no'), 'doctype': 'Purchase Invoice'}
                        for alloc in normalized_selected_allocations
                        if alloc.get('voucher_no')
                    )
                    reconciliation_result = assign_supplier_conciliation(
                        session=session,
                        headers=headers,
                        supplier_name=data.get('supplier'),
                        company=company,
                        documents=documents
                    )
                except Exception as recon_error:
                    reconciliation_error = str(recon_error)
                    print(f"[supplier_reconciliation] Error conciliando nota '{note_name}' tras actualización: {reconciliation_error}")

        response_payload = {
            "success": True,
            "message": "Nota actualizada exitosamente",
            "data": result['data']
        }
        if reconciliation_reset:
            response_payload['reconciliation_reset'] = reconciliation_reset
        if reconciliation_result:
            response_payload['reconciliation'] = reconciliation_result
        if reconciliation_error:
            response_payload['reconciliation_error'] = reconciliation_error

        return jsonify(response_payload)

    except Exception as e:
        print(f"Error actualizando nota: {str(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@credit_debit_notes_bp.route('/api/credit-debit-notes/<note_name>', methods=['DELETE'])
def delete_credit_debit_note(note_name):
    """Eliminar/cancelar una nota de crédito/débito"""
    print(f"\n--- Eliminando nota {note_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la nota para verificar su estado: intentar Sales Invoice, si no existe intentar Purchase Invoice
        get_response, get_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Sales Invoice/{quote(note_name)}",
            operation_name=f"Get credit/debit note '{note_name}' for deletion"
        )

        if get_error:
            error_response = handle_erpnext_error(get_error, f"Failed to get credit/debit note '{note_name}'")
            if error_response:
                return error_response

        note_data = None
        note_doctype = None
        if get_response and get_response.status_code == 200:
            note_data = get_response.json()['data']
            note_doctype = 'Sales Invoice'
        else:
            # Intentar Purchase Invoice
            get_response2, get_error2 = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Invoice/{quote(note_name)}",
                operation_name=f"Get credit/debit note '{note_name}' for deletion (purchase)"
            )
            if get_error2:
                error_response = handle_erpnext_error(get_error2, f"Failed to get credit/debit note '{note_name}' (purchase)")
                if error_response:
                    return error_response
            if get_response2 and get_response2.status_code == 200:
                note_data = get_response2.json()['data']
                note_doctype = 'Purchase Invoice'

        if not note_data:
            return jsonify({"success": False, "message": "Nota no encontrada"}), 404

        # Si está confirmada, cancelar primero
        if note_data.get('docstatus') == 1:
            cancel_response, cancel_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.cancel",
                data={"doctype": note_doctype, "name": note_name},
                operation_name=f"Cancel credit/debit note '{note_name}'"
            )

            if cancel_error:
                error_response = handle_erpnext_error(cancel_error, f"Failed to cancel credit/debit note '{note_name}'")
                if error_response:
                    return error_response

            if cancel_response.status_code != 200:
                error_msg = cancel_response.text
                return jsonify({"success": False, "message": f"Error al cancelar la nota: {error_msg}"}), 400

        # Ahora eliminar
        delete_response, delete_error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/{note_doctype}/{quote(note_name)}",
            operation_name=f"Delete credit/debit note '{note_name}'"
        )

        if delete_error:
            error_response = handle_erpnext_error(delete_error, f"Failed to delete credit/debit note '{note_name}'")
            if error_response:
                return error_response

        if delete_response.status_code != 200:
            error_msg = delete_response.text
            return jsonify({"success": False, "message": f"Error al eliminar la nota: {error_msg}"}), 400

        print(f"Nota eliminada exitosamente: {note_name}")
        return jsonify({
            "success": True,
            "message": "Nota eliminada exitosamente"
        })

    except Exception as e:
        print(f"Error eliminando nota: {str(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@credit_debit_notes_bp.route('/api/credit-debit-notes/<note_name>', methods=['GET'])
def get_credit_debit_note(note_name):
    """Obtener una nota de crédito/débito específica"""
    print(f"\n--- Obteniendo nota {note_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Intentar obtener como Sales Invoice, si no existe intentar Purchase Invoice
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Sales Invoice/{quote(note_name)}",
            operation_name=f"Get credit/debit note '{note_name}'"
        )

        if error:
            error_response = handle_erpnext_error(error, f"Failed to get credit/debit note '{note_name}'")
            if error_response:
                return error_response

        note_data = None
        if response and response.status_code == 200:
            note_data = response.json()['data']
        else:
            # Intentar Purchase Invoice
            response2, error2 = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Invoice/{quote(note_name)}",
                operation_name=f"Get credit/debit note '{note_name}' (purchase)"
            )
            if error2:
                error_response = handle_erpnext_error(error2, f"Failed to get credit/debit note '{note_name}' (purchase)")
                if error_response:
                    return error_response
            if response2 and response2.status_code == 200:
                note_data = response2.json()['data']

        if not note_data:
            return jsonify({"success": False, "message": "Nota no encontrada"}), 404

        # Verificar que sea una nota de crédito/débito (is_return = 1)
        if not note_data.get('is_return'):
            return jsonify({"success": False, "message": "El documento no es una nota de crédito/débito"}), 400

        # Para la UI: si es una nota de devolución, devolver cantidades y montos en POSITIVO
        try:
            # No modificamos ERPNext, sólo la copia que regresamos al frontend
            display_note = json.loads(json.dumps(note_data))

            # Normalizar items: qty y amount a positivo
            for it in display_note.get('items', []) or []:
                try:
                    if 'qty' in it:
                        q = float(it.get('qty', 0) or 0)
                        if q < 0:
                            it['qty'] = abs(q)
                    if 'amount' in it:
                        a = float(it.get('amount', 0) or 0)
                        if a < 0:
                            it['amount'] = abs(a)
                except Exception:
                    pass

            # Campos resumen que pueden venir negativos: normalizarlos a positivo
            summary_keys = ['discount_amount', 'net_gravado', 'net_no_gravado', 'total_iva', 'percepcion_iva', 'percepcion_iibb', 'credit_note_total', 'grand_total', 'outstanding_amount', 'rounded_total']
            for k in summary_keys:
                if k in display_note:
                    try:
                        v = float(display_note.get(k) or 0)
                        if v < 0:
                            display_note[k] = abs(v)
                    except Exception:
                        pass

            # selected_unpaid_invoices: sus montos deberían mostrarse positivos
            if 'selected_unpaid_invoices' in display_note and isinstance(display_note['selected_unpaid_invoices'], list):
                for u in display_note['selected_unpaid_invoices']:
                    try:
                        amt = float(u.get('amount', 0) or 0)
                        if amt < 0:
                            u['amount'] = abs(amt)
                    except Exception:
                        pass

            print(f"Nota obtenida exitosamente: {note_name} (transformada para UI)")
            return jsonify({
                "success": True,
                "data": display_note
            })
        except Exception as e:
            print(f"Error normalizando nota para UI: {e}")
            return jsonify({"success": True, "data": note_data})

    except Exception as e:
        print(f"Error obteniendo nota: {str(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
