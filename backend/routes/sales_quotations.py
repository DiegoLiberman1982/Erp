from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta
from urllib.parse import quote
import json

from routes.auth_utils import get_session_with_auth
from routes.general import (
    add_company_abbr,
    remove_company_abbr,
    get_company_abbr,
    get_active_company,
    get_smart_limit
)
from utils.http_utils import make_erpnext_request, handle_erpnext_error

sales_quotations_bp = Blueprint('sales_quotations', __name__)


def _resolve_company_context(session, headers, user_id, explicit_company=None):
    company_name = explicit_company or get_active_company(user_id)
    if not company_name:
        return None, None
    abbr = get_company_abbr(session, headers, company_name)
    return company_name, abbr


def _strip_company_suffix(value, company_abbr):
    if not value or not company_abbr:
        return value
    return remove_company_abbr(value, company_abbr)


def _clean_items(items, company_abbr):
    cleaned = []
    for item in items or []:
        entry = dict(item)
        entry['item_code'] = _strip_company_suffix(entry.get('item_code'), company_abbr)
        entry['warehouse'] = _strip_company_suffix(entry.get('warehouse'), company_abbr)
        cleaned.append(entry)
    return cleaned


def _normalize_quotation(quotation, company_abbr):
    if not isinstance(quotation, dict):
        return quotation
    normalized = dict(quotation)
    normalized['customer'] = _strip_company_suffix(
        quotation.get('party_name') or quotation.get('customer'),
        company_abbr
    )
    normalized['title'] = _strip_company_suffix(quotation.get('title'), company_abbr)
    normalized['company'] = quotation.get('company')
    normalized['transaction_date'] = quotation.get('transaction_date')
    normalized['valid_till'] = quotation.get('valid_till')
    normalized['status'] = quotation.get('status')
    normalized['docstatus'] = quotation.get('docstatus', 0)
    normalized['grand_total'] = quotation.get('grand_total') or quotation.get('base_grand_total')
    normalized['contact_person'] = quotation.get('contact_person')
    normalized['items'] = _clean_items(quotation.get('items'), company_abbr)
    return normalized


def _require_quotation_payload(payload):
    if not payload:
        raise ValueError('Datos del presupuesto requeridos')
    quotation_data = (
        payload.get('sales_quotation')
        or payload.get('quotation')
        or payload.get('data')
        or payload
    )
    if not isinstance(quotation_data, dict):
        raise ValueError('Formato de presupuesto inv\u00e1lido')
    return quotation_data


def _build_quotation_payload(quotation_data, company_abbr, *, docstatus, existing_name=None):
    company = quotation_data.get('company')
    customer = quotation_data.get('customer')
    raw_items = quotation_data.get('items') or []
    items = [item for item in raw_items if (item.get('item_code') or '').strip()]
    if not company:
        raise ValueError('La compa\u00f1\u00eda es obligatoria')
    if not customer:
        raise ValueError('El cliente es obligatorio')
    if not items:
        raise ValueError('El presupuesto debe incluir al menos un \u00edtem')

    transaction_date = quotation_data.get('transaction_date') or datetime.today().strftime('%Y-%m-%d')
    valid_till = quotation_data.get('valid_till')
    if not valid_till:
        valid_till = (datetime.strptime(transaction_date, '%Y-%m-%d') + timedelta(days=15)).strftime('%Y-%m-%d')

    erp_items = []
    for idx, item in enumerate(items, start=1):
        item_code = item.get('item_code')
        if not item_code:
            raise ValueError('Cada \u00edtem debe tener un c\u00f3digo')
        qty = float(item.get('qty') or 0)
        if qty <= 0:
            raise ValueError('Cada \u00edtem debe tener una cantidad mayor a cero')

        erp_item = {
            'doctype': 'Quotation Item',
            'item_code': add_company_abbr(item_code, company_abbr),
            'item_name': item.get('item_name') or item_code,
            'description': item.get('description') or item.get('item_name') or item_code,
            'qty': qty,
            'rate': float(item.get('rate') or 0),
            'uom': item.get('uom') or 'Unit',
            'conversion_factor': float(item.get('conversion_factor') or 1),
            'idx': idx
        }
        if item.get('name'):
            erp_item['name'] = item['name']
        erp_items.append(erp_item)

    payload = {
        'doctype': 'Quotation',
        'quotation_to': 'Customer',
        'party_name': add_company_abbr(customer, company_abbr),
        'customer_name': customer,
        'company': company,
        'transaction_date': transaction_date,
        'valid_till': valid_till,
        'selling_price_list': quotation_data.get('selling_price_list') or quotation_data.get('price_list'),
        'currency': quotation_data.get('currency'),
        'items': erp_items,
        'docstatus': docstatus,
        'title': add_company_abbr(quotation_data.get('title') or customer, company_abbr),
    }

    if quotation_data.get('contact_person'):
        payload['contact_person'] = quotation_data['contact_person']
    if quotation_data.get('remarks'):
        payload['remarks'] = quotation_data['remarks']
    if quotation_data.get('terms'):
        payload['terms'] = quotation_data['terms']

    if existing_name:
        payload['name'] = existing_name

    return payload


def _fetch_quotation(session, name):
    fields = quote(json.dumps([
        '*',
        'items.item_code',
        'items.item_name',
        'items.description',
        'items.qty',
        'items.rate',
        'items.uom',
        'items.name'
    ]))
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Quotation/{quote(name)}?fields={fields}",
        operation_name=f"Get Quotation {name}"
    )
    if error:
        raise RuntimeError(error.get('message') or 'Error obteniendo presupuesto')
    if response.status_code != 200:
        raise RuntimeError(response.text)
    return response.json().get('data', {})


def _get_quotations_count(session, filters):
    payload = {
        'doctype': 'Quotation',
        'filters': filters
    }
    response, error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.client.get_count",
        data=payload,
        operation_name="Count Quotations"
    )
    if error:
        raise RuntimeError(error.get('message') or 'Error obteniendo conteo de presupuestos')
    return response.json().get('message', 0)


@sales_quotations_bp.route('/api/sales-quotations', methods=['GET', 'POST', 'OPTIONS'])
def collection():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company_param = request.args.get('company')
    company, company_abbr = _resolve_company_context(session, headers, user_id, company_param)
    if request.method == 'GET':
        try:
            page = max(1, int(request.args.get('page', 1)))
            limit_param = request.args.get('limit')
            smart_limit = get_smart_limit(company, 'list') if company else 1000
            page_size = max(1, min(int(limit_param) if limit_param else 20, smart_limit))
            filters = []
            customer = request.args.get('customer')
            status = request.args.get('status')
            docstatus = request.args.get('docstatus')

            if company:
                filters.append(['company', '=', company])
            if customer:
                filters.append(['party_name', '=', add_company_abbr(customer, company_abbr) if company_abbr else customer])
                filters.append(['quotation_to', '=', 'Customer'])
            if status:
                filters.append(['status', '=', status])
            if docstatus is not None:
                try:
                    filters.append(['docstatus', '=', int(docstatus)])
                except (TypeError, ValueError):
                    pass

            params = {
                'fields': json.dumps(['name', 'party_name', 'customer_name', 'status', 'docstatus', 'transaction_date', 'valid_till', 'grand_total', 'base_grand_total']),
                'filters': json.dumps(filters),
                'order_by': 'creation desc',
                'limit_start': (page - 1) * page_size,
                'limit_page_length': page_size
            }

            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Quotation",
                params=params,
                operation_name="List Quotations"
            )
            if error:
                return handle_erpnext_error(error, "No se pudieron obtener los presupuestos")
            data = response.json()
            raw_list = data.get('data') or []
            quotations = [_normalize_quotation(q, company_abbr) for q in raw_list]
            total_count = _get_quotations_count(session, filters)

            return jsonify({
                "success": True,
                "quotations": quotations,
                "page": page,
                "page_size": page_size,
                "total_count": total_count
            })
        except Exception as exc:
            print(f"--- Error listing quotations: {exc}")
            return jsonify({"success": False, "message": str(exc)}), 500

    # POST - create quotation
    try:
        payload = request.get_json() or {}
        quotation_data = _require_quotation_payload(payload)
        if not company or not company_abbr:
            return jsonify({"success": False, "message": "Seleccion\u00e1 una compa\u00f1\u00eda antes de crear el presupuesto"}), 400
        erp_payload = _build_quotation_payload(quotation_data, company_abbr, docstatus=quotation_data.get('docstatus', 0))

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Quotation",
            data={"data": erp_payload},
            operation_name="Create Quotation"
        )
        if error:
            return handle_erpnext_error(error, "No se pudo crear el presupuesto")

        data = response.json().get('data', {})
        normalized = _normalize_quotation(data, company_abbr)
        return jsonify({"success": True, "data": normalized})
    except Exception as exc:
        print(f"--- Error creating quotation: {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500


@sales_quotations_bp.route('/api/sales-quotations/<name>', methods=['GET', 'PUT', 'OPTIONS'])
def quotation_detail(name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company_param = request.args.get('company')
    company, company_abbr = _resolve_company_context(session, headers, user_id, company_param)
    if request.method == 'GET':
        try:
            quotation = _fetch_quotation(session, name)
            return jsonify({"success": True, "data": _normalize_quotation(quotation, company_abbr)})
        except Exception as exc:
            print(f"--- Error fetching quotation '{name}': {exc}")
            return jsonify({"success": False, "message": str(exc)}), 500

    try:
        payload = request.get_json() or {}
        quotation_data = _require_quotation_payload(payload)
        if not company_abbr:
            return jsonify({"success": False, "message": "No encontramos la compa\u00f1\u00eda activa para actualizar el presupuesto"}), 400

        target_docstatus = quotation_data.get('docstatus', 0)
        erp_payload = _build_quotation_payload(quotation_data, company_abbr, docstatus=target_docstatus, existing_name=name)

        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Quotation/{quote(name)}",
            data={"data": erp_payload},
            operation_name=f"Update Quotation {name}"
        )
        if error:
            return handle_erpnext_error(error, "No se pudo actualizar el presupuesto")

        data = response.json().get('data', {})
        normalized = _normalize_quotation(data, company_abbr)
        return jsonify({"success": True, "data": normalized})
    except Exception as exc:
        print(f"--- Error updating quotation '{name}': {exc}")
        return jsonify({"success": False, "message": str(exc)}), 500
