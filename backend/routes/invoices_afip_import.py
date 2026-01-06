from flask import Blueprint, request, jsonify
import json
from urllib.parse import quote

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_company_abbr, add_company_abbr
from routes.customer_utils import ensure_customer_by_tax
from routes.items import process_invoice_item, get_tax_template_map, clear_tax_template_cache
from routes.document_validator import validate_before_create
from utils.http_utils import make_erpnext_request
from utils.comprobante_utils import get_sales_prefix, normalize_afip_currency_code
from utils.logging_utils import log_function_call

invoices_import_bp = Blueprint('invoices_import', __name__)

# Monedas AFIP: normalizar usando shared/afip_codes.json (currency_aliases)
AFIP_CURRENCY_MAP = None  # legacy; do not use


def normalize_afip_currency(afip_currency_symbol):
    """Normaliza el valor de moneda AFIP a un Currency code (sin fallbacks)."""
    return normalize_afip_currency_code(afip_currency_symbol)


def convert_afip_date_to_erpnext(afip_date):
    """Convierte fecha de formato DD/MM/YYYY (AFIP) a YYYY-MM-DD (ERPNext)."""
    if not afip_date:
        from datetime import date
        return str(date.today())

    date_str = str(afip_date).strip()

    # Si ya está en formato YYYY-MM-DD, devolverla tal cual
    if len(date_str) == 10 and date_str[4] == '-' and date_str[7] == '-':
        return date_str

    # Convertir de DD/MM/YYYY a YYYY-MM-DD
    if '/' in date_str:
        parts = date_str.split('/')
        if len(parts) == 3:
            day, month, year = parts[0], parts[1], parts[2]
            return f"{year}-{month.zfill(2)}-{day.zfill(2)}"

    # Si no se puede convertir, usar fecha actual
    from datetime import date
    return str(date.today())


def ensure_afip_service_item(session, headers, company):
    """Crea o busca el item servicio usado para importaciones AFIP."""
    try:
        base_name = "Importación desde AFIP"
        company_abbr = get_company_abbr(session, headers, company)
        item_code = f"{base_name} - {company_abbr}" if company_abbr else base_name

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item/{quote(item_code)}",
            params={"fields": json.dumps(["name"])},
            operation_name="Get AFIP import item"
        )
        if not error and response and response.status_code == 200:
            return item_code

        item_body = {
            "item_code": item_code,
            "item_name": base_name,
            "item_group": "Services",
            "stock_uom": "Unit",
            "is_stock_item": 0,
            "item_type": "Service",
            "custom_company": company,
            "docstatus": 0
        }

        create_resp, create_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item",
            data={"data": item_body},
            operation_name="Create AFIP import item"
        )
        if create_err:
            return item_code
        created = create_resp.json().get("data", {})
        return created.get("name", item_code)
    except Exception as e:
        print(f"--- ensure_afip_service_item error: {e}")
        return None

def build_items_from_afip_row(row, service_code):
    """Construye ítems agrupados por tasa de IVA usando los netos del CSV AFIP."""
    iva_fields = [
        ("neto_iva_0", 0),
        ("neto_no_gravado", 0),
        ("exentas", 0),
        ("otros_tributos", 0),
        ("neto_iva_25", 2.5),
        ("neto_iva_5", 5),
        ("neto_iva_105", 10.5),
        ("neto_iva_21", 21),
        ("neto_iva_27", 27),
    ]

    items = []
    for field_key, iva_rate in iva_fields:
        raw_value = row.get(field_key, 0) or 0
        try:
            amount = float(raw_value)
        except Exception:
            continue
        if amount == 0:
            continue
        items.append({
            "item_code": service_code,
            "description": f"AFIP {iva_rate}% - {row.get('denominacion_receptor', '')}",
            "qty": 1,
            "rate": amount,
            "iva_percent": iva_rate
        })
    return items


def resolve_comprobante_meta(session, headers, codigo_afip, punto_venta):
    """Obtiene tipo_documento y letra desde Tipo Comprobante AFIP y arma naming_series base."""
    tipo_documento = "FAC"
    letra = "A"
    pv = str(punto_venta or "").zfill(5)
    
    # Normalizar código AFIP a 3 dígitos (1 -> 001, 11 -> 011)
    codigo_afip_padded = str(codigo_afip or "").strip().zfill(3)
    
    try:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Tipo Comprobante AFIP/{quote(codigo_afip_padded)}",
            params={"fields": json.dumps(["tipo_documento", "letra"])},
            operation_name="Get AFIP comprobante meta"
        )
        if not err and resp and resp.status_code == 200:
            data = resp.json().get("data", {})
            tipo_documento = data.get("tipo_documento") or tipo_documento
            letra = data.get("letra") or letra
    except Exception as e:
        print(f"--- resolve_comprobante_meta error: {e}")
    sales_prefix = get_sales_prefix(is_electronic=True)
    naming_series = f"{sales_prefix}-{tipo_documento}-{letra}-{pv}-"
    return naming_series, tipo_documento, letra, pv


@invoices_import_bp.route('/api/invoices/import-afip', methods=['POST'])
def import_invoices_from_afip():
    """
    Importa filas de CSV AFIP como Sales Invoices (docstatus 1) usando el item servicio.
    """
    log_function_call("import_invoices_from_afip")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json(silent=True) or {}
    rows = payload.get("invoices") or payload.get("rows") or []
    company = payload.get("company") or get_active_company(user_id)
    prevent_electronic = bool(payload.get("prevent_electronic", True))

    if not company:
        return jsonify({"success": False, "message": "Compañía requerida"}), 400
    if not rows:
        return jsonify({"success": False, "message": "No hay comprobantes para importar"}), 400

    service_code = ensure_afip_service_item(session, headers, company)
    
    # Limpiar caché de tax templates para asegurar datos frescos
    clear_tax_template_cache(company)
    tax_map = get_tax_template_map(session, headers, company, transaction_type='sales')
    
    print(f"--- AFIP Import: tax_map for sales = {tax_map}")

    created = []
    errors = []

    for row in rows:
        try:
            customer_tax = str(row.get("nro_doc_receptor") or "").strip()
            customer_name = row.get("denominacion_receptor") or "Cliente AFIP"
            customer_doc_type = str(row.get("tipo_doc_receptor") or "").strip()
            customer_id = ensure_customer_by_tax(session, headers, customer_tax, customer_name, company, customer_doc_type) if customer_tax else None
            if not customer_id:
                errors.append({"row": row, "error": "No se pudo crear o encontrar el cliente"})
                continue
            # Aplicar abbr al nombre del cliente para mantener consistencia
            company_abbr = get_company_abbr(session, headers, company)
            if company_abbr and customer_id and not customer_id.endswith(f" - {company_abbr}"):
                customer_id = add_company_abbr(customer_id, company_abbr)

            items = build_items_from_afip_row(row, service_code)
            if not items:
                errors.append({"row": row, "error": "Sin líneas con montos"})
                continue

            processed_items = []
            for item in items:
                processed_item = process_invoice_item(
                    item,
                    session,
                    headers,
                    company,
                    tax_map,
                    customer_id,
                    transaction_type='sales'  # Importante: es una factura de venta
                )
                if processed_item:
                    processed_items.append(processed_item)
                else:
                    processed_items = []
                    break

            if not processed_items:
                errors.append({"row": row, "error": "Sin líneas procesadas"})
                continue

            posting_date = convert_afip_date_to_erpnext(row.get("fecha_emision"))
            due_date_raw = convert_afip_date_to_erpnext(row.get("due_date") or row.get("fecha_vencimiento") or row.get("fecha_emision"))

            # Asegurar que due_date no sea anterior a posting_date
            try:
                from datetime import datetime
                pd = datetime.strptime(posting_date, "%Y-%m-%d")
                dd = datetime.strptime(due_date_raw, "%Y-%m-%d")
                due_date = posting_date if dd < pd else due_date_raw
            except Exception:
                due_date = posting_date

            naming_series, tipo_doc, letra, pv_padded = resolve_comprobante_meta(session, headers, row.get("tipo_comprobante"), row.get("punto_venta"))
            numero_desde = str(row.get("numero_desde") or row.get("numero_hasta") or "").strip()
            numero_padded = numero_desde.zfill(8) if numero_desde else ""

            # Construir el nombre completo del documento con el prefijo oficial configurado
            # El naming_series termina sin guión para que sea el nombre fijo
            sales_prefix = get_sales_prefix(is_electronic=True)
            invoice_name_fixed = f"{sales_prefix}-{tipo_doc}-{letra}-{pv_padded}-{numero_padded}" if numero_padded else None

            # VALIDAR DUPLICADOS antes de crear
            if invoice_name_fixed:
                can_create, dup_message, duplicates = validate_before_create(
                    session, headers, "Sales Invoice", invoice_name_fixed
                )
                if not can_create:
                    print(f"--- Duplicate detected: {invoice_name_fixed} - {duplicates}")
                    errors.append({
                        "row": row,
                        "error": f"Factura duplicada: {dup_message}",
                        "duplicates": duplicates
                    })
                    continue

            invoice_payload = {
                "customer": customer_id,
                "company": company,
                "posting_date": posting_date,
                "due_date": due_date,
                "currency": normalize_afip_currency(row.get("moneda")),
                "items": processed_items,
                "punto_de_venta": pv_padded,
                "voucher_type_code": str(row.get("tipo_comprobante") or "").strip(),
                "docstatus": 0,
                "custom_prevent_electronic": prevent_electronic,
                "set_posting_time": 1,
                "posting_time": "00:00:00",
                "naming_series": invoice_name_fixed if invoice_name_fixed else naming_series
            }

            if not invoice_payload.get("currency"):
                errors.append({"row": row, "error": "Moneda requerida (no se pudo resolver desde AFIP)"})
                continue

            # Validar que la moneda exista en ERPNext
            currency_check, currency_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Currency/{quote(invoice_payload['currency'])}",
                params={"fields": json.dumps(["name"])},
                operation_name="Validate Currency (sales AFIP import)",
            )
            if currency_err or not currency_check or currency_check.status_code != 200:
                errors.append({"row": row, "error": f"Moneda no encontrada en ERPNext: {invoice_payload['currency']}"})
                continue
            # Forzar el nombre del documento si tenemos un número específico de AFIP
            if invoice_name_fixed:
                invoice_payload["name"] = invoice_name_fixed
            if numero_padded:
                invoice_payload["invoice_number"] = numero_padded

            insert_resp, insert_err = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Sales Invoice",
                data={"data": invoice_payload},
                operation_name="Create Sales Invoice from AFIP import"
            )

            if insert_err or not insert_resp or insert_resp.status_code not in (200, 201):
                errors.append({"row": row, "error": "Error al crear factura"})
                continue

            invoice_name = insert_resp.json().get("data", {}).get("name")

            submit_resp, submit_err = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                data={"docstatus": 1},
                operation_name="Submit Sales Invoice from AFIP import"
            )
            if submit_err or not submit_resp or submit_resp.status_code not in (200, 202):
                errors.append({"row": row, "error": "Creada pero no se pudo enviar a docstatus 1"})
                continue

            # Validar que el total de la factura coincida con el importe_total del CSV
            expected_total = float(row.get("importe_total") or 0)
            if expected_total > 0:
                # Obtener el total de la factura creada
                invoice_resp, invoice_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                    params={"fields": json.dumps(["grand_total", "rounded_total"])},
                    operation_name="Get created invoice total for validation"
                )
                if not invoice_err and invoice_resp and invoice_resp.status_code == 200:
                    invoice_data = invoice_resp.json().get("data", {})
                    actual_total = float(invoice_data.get("rounded_total") or invoice_data.get("grand_total") or 0)
                    
                    # Permitir una diferencia de hasta 1 peso por redondeos
                    difference = abs(actual_total - expected_total)
                    if difference > 1.0:
                        print(f"--- WARNING: Total mismatch for {invoice_name}: expected {expected_total}, got {actual_total} (diff: {difference})")
                        errors.append({
                            "row": row,
                            "error": f"Factura creada pero el total no coincide: esperado ${expected_total:.2f}, obtenido ${actual_total:.2f} (diferencia: ${difference:.2f})",
                            "invoice_name": invoice_name,
                            "warning": True  # Marcar como advertencia, no error crítico
                        })
                    else:
                        print(f"--- Total validated for {invoice_name}: ${actual_total:.2f}")

            created.append(invoice_name)
        except Exception as e:
            print(f"--- AFIP import error: {e}")
            errors.append({"row": row, "error": str(e)})

    # Separar errores críticos de advertencias
    critical_errors = [e for e in errors if not e.get("warning")]
    warnings = [e for e in errors if e.get("warning")]
    
    return jsonify({
        "success": len(created) > 0 and len(critical_errors) == 0,
        "created": created,
        "errors": critical_errors,
        "warnings": warnings,
        "message": f"Importación completada ({len(created)} creadas, {len(critical_errors)} con errores, {len(warnings)} con advertencias)"
    })
