from flask import Blueprint, request, jsonify
import json
from datetime import date, datetime, timedelta
import os
from urllib.parse import quote

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_company_abbr, add_company_abbr, get_smart_limit
from routes.items import (
    process_purchase_invoice_item,
    get_tax_template_map,
    clear_tax_template_cache,
)
from routes.purchase_perceptions import build_purchase_perception_taxes, build_purchase_iva_taxes
from routes.suppliers import create_supplier_for_company
from utils.http_utils import make_erpnext_request
from utils.comprobante_utils import get_purchase_prefix, normalize_afip_currency_code
from utils.logging_utils import log_function_call

purchase_invoices_import_bp = Blueprint("purchase_invoices_import", __name__)

_AFIP_CODES_SHARED = None


def _load_afip_codes_shared():
    global _AFIP_CODES_SHARED
    if _AFIP_CODES_SHARED is not None:
        return _AFIP_CODES_SHARED

    shared_path = os.path.normpath(
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "shared", "afip_codes.json")
    )
    with open(shared_path, "r", encoding="utf-8") as handle:
        _AFIP_CODES_SHARED = json.load(handle)
    return _AFIP_CODES_SHARED



def resolve_erpnext_currency_code(session, currency_value, company=None):
    """
    Resolve a Currency code strictly from ERPNext (no hardcoded mappings).
    Accepts either:
    - Currency code (e.g. ARS, USD)
    - Currency symbol (e.g. $)
    """
    if currency_value is None or str(currency_value).strip() == "":
        return None

    raw = str(currency_value).strip()
    code_candidate = normalize_afip_currency_code(raw) or raw.upper()

    # 1) Try direct lookup by code
    resp, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Currency/{quote(code_candidate)}",
        params={"fields": json.dumps(["name", "symbol", "enabled"])},
        operation_name="Resolve Currency by code",
    )
    if not err and resp and resp.status_code == 200:
        data = resp.json().get("data", {}) or {}
        if str(data.get("enabled") or 0) in ("1", "True", "true"):
            return data.get("name") or code_candidate
        return data.get("name") or code_candidate

    # 2) Try lookup by symbol
    filters = [["symbol", "=", raw]]
    limit = get_smart_limit(company, operation_type="search") if company else get_smart_limit("", "search")
    resp, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Currency",
        params={
            "filters": json.dumps(filters),
            "fields": json.dumps(["name", "symbol", "enabled"]),
            "limit_page_length": limit,
        },
        operation_name="Resolve Currency by symbol",
    )
    if not err and resp and resp.status_code == 200:
        rows = resp.json().get("data", []) or []
        if rows:
            return rows[0].get("name")

    # 3) Try lookup by currency_name "like" (strict: only if single match)
    filters = [["currency_name", "like", f"%{raw}%"]]
    resp, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Currency",
        params={
            "filters": json.dumps(filters),
            "fields": json.dumps(["name", "currency_name", "symbol", "enabled"]),
            "limit_page_length": limit,
        },
        operation_name="Resolve Currency by currency_name",
    )
    if not err and resp and resp.status_code == 200:
        rows = resp.json().get("data", []) or []
        if len(rows) == 1:
            return rows[0].get("name")

    return None


def convert_afip_date_to_erpnext(afip_date):
    """Convierte fecha de formato DD/MM/YYYY (AFIP) a YYYY-MM-DD (ERPNext)."""
    if not afip_date:
        return str(date.today())

    date_str = str(afip_date).strip()

    # Si ya está en formato YYYY-MM-DD, devolverla tal cual
    if len(date_str) == 10 and date_str[4] == "-" and date_str[7] == "-":
        return date_str

    # Convertir de DD/MM/YYYY a YYYY-MM-DD
    if "/" in date_str:
        parts = date_str.split("/")
        if len(parts) == 3:
            day, month, year = parts[0], parts[1], parts[2]
            return f"{year}-{month.zfill(2)}-{day.zfill(2)}"

    return str(date.today())


def _safe_float(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def _get_otros_tributos_remaining(row):
    total = _safe_float(row.get("otros_tributos"), default=0.0)
    allocations = row.get("otros_tributos_allocations") or []
    if not allocations:
        return total

    if not isinstance(allocations, list):
        raise ValueError("Formato inválido de otros_tributos_allocations")

    normalized = []
    for a in allocations:
        if not isinstance(a, dict):
            continue
        classification = str(a.get("classification") or "").strip().upper()
        province_code = str(a.get("province_code") or "").strip()
        amount = _safe_float(a.get("total_amount"), default=0.0)
        if not classification and not province_code and amount == 0:
            continue
        normalized.append({"classification": classification, "province_code": province_code, "total_amount": amount})

    valid_classes = {"OTRO", "IIBB", "IVA", "GANANCIAS"}
    if any(a["classification"] not in valid_classes for a in normalized):
        raise ValueError("Clasificación inválida en otros_tributos_allocations")

    for a in normalized:
        if a["total_amount"] < 0:
            raise ValueError("Importe inválido en otros_tributos_allocations")
        if a["classification"] == "IIBB" and a["total_amount"] and not a["province_code"]:
            raise ValueError("Jurisdicción requerida para IIBB en otros_tributos_allocations")

    alloc_sum = sum(a["total_amount"] for a in normalized)
    if abs(alloc_sum - total) > 0.01:
        raise ValueError("La suma de otros_tributos_allocations no coincide con el total")

    remaining = sum(a["total_amount"] for a in normalized if a["classification"] == "OTRO")
    return remaining


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
            operation_name="Get AFIP import item (purchase)",
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
            "docstatus": 0,
        }

        create_resp, create_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item",
            data={"data": item_body},
            operation_name="Create AFIP import item (purchase)",
        )
        if create_err or not create_resp:
            return item_code
        created = create_resp.json().get("data", {})
        return created.get("name", item_code)
    except Exception as e:
        print(f"--- ensure_afip_service_item (purchase) error: {e}")
        return None


def ensure_supplier_by_tax(session, headers, tax_id, name, company, doc_type=None):
    """
    Find a supplier by tax_id, scoped to `company`.
    Returns (Supplier.name, error_message). If not found: (None, None).
    """
    if not tax_id:
        return None, None

    try:
        filters = [["tax_id", "=", tax_id]]
        if company:
            filters.append(["custom_company", "=", company])
        limit = get_smart_limit(company, operation_type="search") if company else get_smart_limit("", "search")
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Supplier",
            params={
                "filters": json.dumps(filters),
                "fields": json.dumps(["name", "supplier_name"]),
                "limit_page_length": limit,
            },
            operation_name="Find supplier by tax_id (AFIP import)",
        )
        if not error and response and response.status_code == 200:
            data = response.json().get("data", [])
            if len(data) == 1:
                return data[0].get("name"), None
            if len(data) > 1:
                return None, "Hay más de un proveedor con el mismo CUIT/DNI en la compañía (no se puede decidir)"
    except Exception as e:
        print(f"--- ensure_supplier_by_tax search error: {e}")
    return None, None


def build_items_from_afip_purchase_row(row, service_code, is_credit_note=False, letra=None, perceptions=None):
    """
    Construye ítems agrupados por tasa de IVA usando los netos del CSV AFIP (compras).
    Para nosotros, todo lo "no gravado/exento/otros" se trata como un único neto 0%.
    """
    rate_fields = [
        ("neto_iva_25", 2.5),
        ("neto_iva_5", 5),
        ("neto_iva_105", 10.5),
        ("neto_iva_21", 21),
        ("neto_iva_27", 27),
    ]

    items = []
    vendor_name = row.get("denominacion_vendedor") or row.get("supplier_name") or ""
    qty_sign = -1 if is_credit_note else 1

    neto_0 = (
        _safe_float(row.get("neto_iva_0"), default=0.0)
        + _safe_float(row.get("neto_no_gravado"), default=0.0)
        + _safe_float(row.get("exentas"), default=0.0)
        + _get_otros_tributos_remaining(row)
    )

    # Monotributo (letra C): a veces AFIP trae solo Importe Total, sin desglose ni IVA.
    # En ese caso tratamos todo como neto 0%.
    if (neto_0 == 0) and str(letra or "").upper() == "C":
        has_other_net = any(_safe_float(row.get(k), default=0.0) != 0 for k, _ in rate_fields)
        has_perceptions = bool(perceptions) if perceptions is not None else bool(row.get("perceptions"))
        if not has_other_net:
            total_only = _safe_float(row.get("importe_total"), default=0.0)
            if total_only != 0:
                # Solo aplicar total-only si no hay percepciones ni otros tributos clasificados como percepciones.
                if not has_perceptions and _safe_float(row.get("otros_tributos"), default=0.0) == _get_otros_tributos_remaining(row):
                    neto_0 = total_only
    if neto_0 != 0:
            items.append(
                {
                    "item_code": service_code,
                    "description": f"AFIP 0% - {vendor_name}".strip(),
                    "qty": qty_sign,
                    "rate": neto_0,
                    "iva_percent": 0,
                }
            )

    for field_key, iva_rate in rate_fields:
        amount = _safe_float(row.get(field_key), default=0.0)
        if amount == 0:
            continue
            items.append(
                {
                    "item_code": service_code,
                    "description": f"AFIP {iva_rate}% - {vendor_name}".strip(),
                    "qty": qty_sign,
                    "rate": amount,
                    "iva_percent": iva_rate,
                }
            )

    return items


def resolve_comprobante_meta(session, headers, codigo_afip, punto_venta):
    """Resuelve tipo_documento y letra desde shared/afip_codes.json (sin fallbacks) y arma naming_series base (compras)."""
    pv = str(punto_venta or "").zfill(5)

    codigo_afip_padded = str(codigo_afip or "").strip().zfill(3)
    shared = _load_afip_codes_shared()
    comprobantes_map = shared.get("comprobantes", {}) or {}
    meta = comprobantes_map.get(codigo_afip_padded)
    if not meta:
        raise ValueError(f"Tipo de comprobante AFIP no mapeado: {codigo_afip_padded}")

    tipo_documento = str(meta.get("tipo") or "").strip().upper()
    letra = str(meta.get("letra") or "").strip().upper()
    if not tipo_documento or not letra:
        raise ValueError(f"Tipo de comprobante AFIP inválido: {codigo_afip_padded}")

    purchase_prefix = get_purchase_prefix()
    naming_series = f"{purchase_prefix}-{tipo_documento}-{letra}-{pv}-"
    return naming_series, tipo_documento, letra, pv


def find_purchase_invoice_duplicates(session, headers, company, supplier, naming_series, expected_total=None):
    """
    Busca facturas de compra existentes (mismo proveedor + mismo comprobante) antes de importar.

    Regla solicitada:
    - Duplicada si: mismo proveedor, mismo número (naming_series) y mismo total.

    Notas:
    - En ERPNext, `name` agrega sufijos (00001, 00002, ...). Por eso comparamos contra `naming_series`.
    - No hacemos fallbacks: si hay múltiples coincidencias o el total difiere, devolvemos todas para decidir.
    """
    if not company or not supplier or not naming_series:
        return [], None

    filters = [
        ["company", "=", company],
        ["supplier", "=", supplier],
        ["naming_series", "=", naming_series],
        ["docstatus", "!=", 2],
    ]

    resp, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Purchase Invoice",
        params={
            "filters": json.dumps(filters),
            "fields": json.dumps(["name", "grand_total", "rounded_total", "docstatus", "posting_date"]),
            "limit_page_length": 50,
        },
        operation_name="Check Purchase Invoice duplicates by naming_series+supplier",
    )
    if err or not resp or resp.status_code != 200:
        return [], "Error verificando duplicados"

    rows = resp.json().get("data", []) or []
    if not rows:
        return [], None

    if expected_total is None:
        return rows, None

    try:
        expected = float(expected_total)
    except Exception:
        return rows, None

    matches = []
    mismatches = []
    for row in rows:
        actual = _safe_float(row.get("rounded_total") or row.get("grand_total") or 0, default=0.0)
        if abs(actual - expected) <= 1.0:
            matches.append(row)
        else:
            mismatches.append(row)

    return matches or rows, None


@purchase_invoices_import_bp.route("/api/purchase-invoices/import-afip", methods=["POST"])
def import_purchase_invoices_from_afip():
    """
    Importa filas de AFIP (CSV/XLSX normalizado por frontend) como Purchase Invoices (docstatus 1).

    Importante:
    - NO se envía `name` al crear el documento (solo `naming_series`), siguiendo el criterio indicado.
    - Se valida duplicados buscando por `supplier` + `naming_series` + total.
    """
    log_function_call("import_purchase_invoices_from_afip")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json(silent=True) or {}
    rows = payload.get("invoices") or payload.get("rows") or []
    company = payload.get("company") or get_active_company(user_id)
    due_days = int(payload.get("due_days") or 0)

    if not company:
        return jsonify({"success": False, "message": "Compañía requerida"}), 400
    if not rows:
        return jsonify({"success": False, "message": "No hay comprobantes para importar"}), 400

    service_code = ensure_afip_service_item(session, headers, company)
    if not service_code:
        return jsonify({"success": False, "message": "No se pudo resolver el ítem de importación AFIP"}), 500

    clear_tax_template_cache(company)
    tax_map = get_tax_template_map(session, headers, company, transaction_type="purchase")

    created = []
    errors = []
    company_abbr = get_company_abbr(session, headers, company)

    for row in rows:
        try:
            vendor_tax = str(row.get("nro_doc_vendedor") or "").strip()
            vendor_name = row.get("denominacion_vendedor") or ""
            vendor_doc_type = str(row.get("tipo_doc_vendedor") or "").strip()

            if not vendor_tax:
                errors.append({"row": row, "error": "CUIT/DNI del proveedor requerido"})
                continue

            supplier_id, supplier_error = ensure_supplier_by_tax(
                session=session,
                headers=headers,
                tax_id=vendor_tax,
                name=vendor_name,
                company=company,
                doc_type=vendor_doc_type,
            )
            if supplier_error:
                errors.append({"row": row, "error": supplier_error})
                continue

            if not supplier_id:
                if not vendor_name or not str(vendor_name).strip():
                    errors.append({"row": row, "error": "Nombre del proveedor requerido para crear proveedor"})
                    continue

                created_supplier, create_err = create_supplier_for_company(
                    session=session,
                    headers=headers,
                    company_name=company,
                    supplier_name=vendor_name,
                    tax_id=vendor_tax,
                    doc_type=vendor_doc_type,
                )
                if create_err or not created_supplier:
                    errors.append({"row": row, "error": create_err or "No se pudo crear el proveedor"})
                    continue

                supplier_id = created_supplier

            try:
                _ns_for_sign, tipo_doc_for_sign, letra_for_sign, pv_padded_for_sign = resolve_comprobante_meta(
                    session, headers, row.get("tipo_comprobante"), row.get("punto_venta")
                )
            except Exception as exc:
                errors.append({"row": row, "error": str(exc)})
                continue

            perceptions = row.get("perceptions") or []
            if perceptions and not isinstance(perceptions, list):
                errors.append({"row": row, "error": "Formato de percepciones inválido"})
                continue

            is_credit_note = str(tipo_doc_for_sign or "").strip().upper().startswith("NC")
            try:
                items = build_items_from_afip_purchase_row(
                    row,
                    service_code,
                    is_credit_note=is_credit_note,
                    letra=letra_for_sign,
                    perceptions=perceptions,
                )
            except Exception as exc:
                errors.append({"row": row, "error": str(exc)})
                continue

            if not items:
                errors.append({"row": row, "error": "Sin líneas con montos"})
                continue

            processed_items = []
            for item in items:
                processed_item = process_purchase_invoice_item(
                    item=item,
                    session=session,
                    headers=headers,
                    company=company,
                    tax_map=tax_map,
                    supplier=supplier_id,
                )
                if processed_item:
                    processed_items.append(processed_item)
                else:
                    processed_items = []
                    break

            if not processed_items:
                errors.append({"row": row, "error": "Sin líneas procesadas"})
                continue

            # perceptions ya validadas arriba; se reutilizan más adelante (taxes)

            posting_date = convert_afip_date_to_erpnext(row.get("fecha_emision"))
            bill_date = posting_date
            due_date = posting_date
            if due_days:
                try:
                    due_date = (datetime.strptime(bill_date, "%Y-%m-%d") + timedelta(days=due_days)).strftime(
                        "%Y-%m-%d"
                    )
                except Exception:
                    due_date = posting_date

            tipo_doc = tipo_doc_for_sign
            letra = letra_for_sign
            pv_padded = pv_padded_for_sign
            numero = str(
                row.get("numero_comprobante")
                or row.get("numero_desde")
                or row.get("numero_hasta")
                or ""
            ).strip()
            numero_padded = numero.zfill(8) if numero else ""

            purchase_prefix = get_purchase_prefix()
            metodo_numeracion = f"{purchase_prefix}-{tipo_doc}-{letra}-{pv_padded}-{numero_padded}" if numero_padded else None

            if not metodo_numeracion:
                errors.append({"row": row, "error": "Número de comprobante requerido para importar"})
                continue

            expected_total = row.get("importe_total")
            dup_rows, dup_err = find_purchase_invoice_duplicates(
                session=session,
                headers=headers,
                company=company,
                supplier=supplier_id,
                naming_series=metodo_numeracion,
                expected_total=expected_total,
            )
            if dup_err:
                errors.append({"row": row, "error": dup_err})
                continue
            if dup_rows:
                errors.append(
                    {
                        "row": row,
                        "error": "Factura duplicada (mismo proveedor + mismo número + mismo total)",
                        "duplicates": dup_rows,
                    }
                )
                continue

            currency_raw = row.get("moneda") or row.get("moneda_original")
            currency = resolve_erpnext_currency_code(session, currency_raw, company=company)
            if not currency:
                errors.append({"row": row, "error": f"Moneda no encontrada en ERPNext: {currency_raw}"})
                continue

            conversion_rate = _safe_float(row.get("tipo_cambio") or row.get("conversion_rate"), default=0.0)
            if conversion_rate <= 0:
                errors.append({"row": row, "error": "Tipo de cambio requerido (debe ser > 0)"})
                continue

            invoice_payload = {
                "supplier": supplier_id,
                "company": company,
                "posting_date": posting_date,
                "bill_date": bill_date,
                "due_date": due_date,
                "currency": currency,
                "conversion_rate": conversion_rate,
                "tax_id": vendor_tax,
                "update_stock": 0,
                "items": processed_items,
                "docstatus": 0,
                "set_posting_time": 1,
                "posting_time": "00:00:00",
                "remarks": "Importado desde AFIP",
                "naming_series": metodo_numeracion,
            }

            if perceptions:
                iva_taxes, iva_errors = build_purchase_iva_taxes(
                    items=items,
                    company=company,
                    company_abbr=company_abbr,
                    session=session,
                )
                if iva_errors:
                    errors.append({"row": row, "error": f"Error construyendo IVA: {', '.join(iva_errors)}"})
                    continue

                perception_taxes, perception_errors = build_purchase_perception_taxes(
                    company=company,
                    perceptions=perceptions,
                    company_abbr=company_abbr,
                    session=session,
                )
                if perception_errors:
                    errors.append({"row": row, "error": f"Error en percepciones: {', '.join(perception_errors)}"})
                    continue

                invoice_payload["taxes"] = (iva_taxes or []) + (perception_taxes or [])

            insert_resp, insert_err = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Purchase Invoice",
                data={"data": invoice_payload},
                operation_name="Create Purchase Invoice from AFIP import",
            )

            if insert_err or not insert_resp or insert_resp.status_code not in (200, 201):
                errors.append({"row": row, "error": "Error al crear factura de compra"})
                continue

            invoice_name = insert_resp.json().get("data", {}).get("name")

            submit_resp, submit_err = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                data={"docstatus": 1},
                operation_name="Submit Purchase Invoice from AFIP import",
            )
            if submit_err or not submit_resp or submit_resp.status_code not in (200, 202):
                errors.append({"row": row, "error": "Creada pero no se pudo enviar a docstatus 1"})
                continue

            expected_total = _safe_float(row.get("importe_total") or 0, default=0.0)
            if expected_total:
                invoice_resp, invoice_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                    params={"fields": json.dumps(["grand_total", "rounded_total"])},
                    operation_name="Get created purchase invoice total for validation",
                )
                if not invoice_err and invoice_resp and invoice_resp.status_code == 200:
                    invoice_data = invoice_resp.json().get("data", {})
                    actual_total = _safe_float(
                        invoice_data.get("rounded_total") or invoice_data.get("grand_total") or 0, default=0.0
                    )
                    difference = abs(actual_total - expected_total)
                    if difference > 1.0:
                        errors.append(
                            {
                                "row": row,
                                "error": (
                                    f"Factura creada pero el total no coincide: "
                                    f"esperado ${expected_total:.2f}, obtenido ${actual_total:.2f} "
                                    f"(diferencia: ${difference:.2f})"
                                ),
                                "invoice_name": invoice_name,
                                "warning": True,
                            }
                        )

            created.append(invoice_name)
        except Exception as e:
            print(f"--- AFIP purchase import error: {e}")
            errors.append({"row": row, "error": str(e)})

    critical_errors = [e for e in errors if not e.get("warning")]
    warnings = [e for e in errors if e.get("warning")]

    return jsonify(
        {
            "success": len(created) > 0 and len(critical_errors) == 0,
            "created": created,
            "errors": critical_errors,
            "warnings": warnings,
            "message": f"Importación completada ({len(created)} creadas, {len(critical_errors)} con errores, {len(warnings)} con advertencias)",
        }
    )
