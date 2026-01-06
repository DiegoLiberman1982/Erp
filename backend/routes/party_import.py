from flask import Blueprint, request, jsonify
import json
from urllib.parse import quote

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_company_abbr, add_company_abbr
from routes.suppliers import create_supplier_for_company
from utils.http_utils import make_erpnext_request


party_import_bp = Blueprint('party_import', __name__)


def _normalize_tax_id(value):
    if value is None:
        return ""
    return "".join(ch for ch in str(value).strip() if ch.isdigit())


def _map_tax_condition(value):
    raw = (value or "").strip()
    if raw == "No Responsable":
        return "Consumidor Final"
    return raw


def _find_party_by_tax_id(session, doctype, tax_id, company_name):
    tax_id_norm = _normalize_tax_id(tax_id)
    if not tax_id_norm:
        return None, None
    try:
        filters = [["tax_id", "=", tax_id_norm]]
        if company_name:
            filters.append(["custom_company", "=", company_name])
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{quote(doctype)}",
            params={
                "filters": json.dumps(filters),
                "fields": json.dumps(["name", "tax_id"]),
                "limit_page_length": 20,
            },
            operation_name=f"Find {doctype} by tax_id",
        )
        if error or not response or response.status_code != 200:
            return None, error
        data = response.json().get("data", []) or []
        if not data:
            return None, None
        if len(data) == 1:
            return data[0].get("name"), None
        return None, {"success": False, "message": f"Hay más de un {doctype} con el mismo CUIT/DNI en la compañía"}
    except Exception as e:
        return None, {"success": False, "message": str(e)}


def _create_customer_for_company(session, headers, company_name, customer_name, tax_id, custom_condicion_iva=None):
    customer_name_raw = (customer_name or "").strip()
    tax_id_norm = _normalize_tax_id(tax_id)
    if not customer_name_raw:
        return None, "Nombre de cliente requerido"
    if not tax_id_norm:
        return None, "CUIT/DNI requerido"

    company_abbr = get_company_abbr(session, headers, company_name) if company_name else None
    customer_name_scoped = add_company_abbr(customer_name_raw, company_abbr) if company_abbr else customer_name_raw

    payload = {
        "customer_name": customer_name_scoped,
        "tax_id": tax_id_norm,
        "custom_company": company_name,
    }
    mapped_condition = _map_tax_condition(custom_condicion_iva)
    if mapped_condition:
        payload["custom_condicion_iva"] = mapped_condition

    create_resp, create_err = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Customer",
        data={"data": payload},
        operation_name="Bulk import: Create Customer",
    )
    if create_err or not create_resp:
        return None, (create_err or {}).get("message") or "Error creando cliente"
    try:
        created = create_resp.json().get("data", {}) or {}
    except Exception:
        created = {}
    return created.get("name") or customer_name_scoped, None


@party_import_bp.route('/api/import/customers', methods=['POST', 'OPTIONS'])
def import_customers():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    rows = payload.get("rows") or []
    if not isinstance(rows, list) or len(rows) == 0:
        return jsonify({"success": False, "message": "No se proporcionaron filas"}), 400

    company_name = get_active_company(user_id)
    if not company_name:
        return jsonify({"success": False, "message": "No hay compañía activa"}), 400

    results = []
    created = 0
    skipped = 0
    errors = 0

    for idx, row in enumerate(rows):
        row_data = row if isinstance(row, dict) else {}
        customer_name = row_data.get("customer_name") or row_data.get("name") or ""
        tax_id = row_data.get("tax_id") or row_data.get("cuit") or ""
        condicion = row_data.get("custom_condicion_iva") or row_data.get("condicion_iva") or ""

        try:
            existing_name, existing_err = _find_party_by_tax_id(session, "Customer", tax_id, company_name)
            if existing_err:
                errors += 1
                results.append({
                    "row": idx + 1,
                    "status": "error",
                    "message": existing_err.get("message") or "Error verificando cliente",
                })
                continue
            if existing_name:
                skipped += 1
                results.append({
                    "row": idx + 1,
                    "status": "exists",
                    "name": existing_name,
                    "message": "Cliente ya existe",
                })
                continue

            created_name, create_err_msg = _create_customer_for_company(
                session=session,
                headers=headers,
                company_name=company_name,
                customer_name=customer_name,
                tax_id=tax_id,
                custom_condicion_iva=condicion,
            )
            if create_err_msg:
                errors += 1
                results.append({
                    "row": idx + 1,
                    "status": "error",
                    "message": create_err_msg,
                })
            else:
                created += 1
                results.append({
                    "row": idx + 1,
                    "status": "created",
                    "name": created_name,
                    "message": "Cliente creado",
                })
        except Exception as e:
            errors += 1
            results.append({
                "row": idx + 1,
                "status": "error",
                "message": str(e),
            })

    return jsonify({
        "success": True,
        "summary": {"created": created, "exists": skipped, "errors": errors, "total": len(rows)},
        "results": results,
    })


@party_import_bp.route('/api/import/suppliers', methods=['POST', 'OPTIONS'])
def import_suppliers():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    rows = payload.get("rows") or []
    if not isinstance(rows, list) or len(rows) == 0:
        return jsonify({"success": False, "message": "No se proporcionaron filas"}), 400

    company_name = get_active_company(user_id)
    if not company_name:
        return jsonify({"success": False, "message": "No hay compañía activa"}), 400

    results = []
    created = 0
    skipped = 0
    errors = 0

    for idx, row in enumerate(rows):
        row_data = row if isinstance(row, dict) else {}
        supplier_name = row_data.get("supplier_name") or row_data.get("name") or ""
        tax_id = row_data.get("tax_id") or row_data.get("cuit") or ""
        condicion = row_data.get("custom_condicion_iva") or row_data.get("condicion_iva") or ""

        try:
            existing_name, existing_err = _find_party_by_tax_id(session, "Supplier", tax_id, company_name)
            if existing_err:
                errors += 1
                results.append({
                    "row": idx + 1,
                    "status": "error",
                    "message": existing_err.get("message") or "Error verificando proveedor",
                })
                continue
            if existing_name:
                skipped += 1
                results.append({
                    "row": idx + 1,
                    "status": "exists",
                    "name": existing_name,
                    "message": "Proveedor ya existe",
                })
                continue

            created_name, create_err = create_supplier_for_company(
                session=session,
                headers=headers,
                company_name=company_name,
                supplier_name=supplier_name,
                tax_id=tax_id,
                doc_type=None,
                custom_condicion_iva=_map_tax_condition(condicion),
            )
            if create_err or not created_name:
                errors += 1
                results.append({
                    "row": idx + 1,
                    "status": "error",
                    "message": create_err or "Error creando proveedor",
                })
            else:
                created += 1
                results.append({
                    "row": idx + 1,
                    "status": "created",
                    "name": created_name,
                    "message": "Proveedor creado",
                })
        except Exception as e:
            errors += 1
            results.append({
                "row": idx + 1,
                "status": "error",
                "message": str(e),
            })

    return jsonify({
        "success": True,
        "summary": {"created": created, "exists": skipped, "errors": errors, "total": len(rows)},
        "results": results,
    })
