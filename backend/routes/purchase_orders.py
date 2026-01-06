from flask import Blueprint, request, jsonify
from urllib.parse import quote
from datetime import datetime
import json

from routes.auth_utils import get_session_with_auth
from routes.general import add_company_abbr, remove_company_abbr, get_company_abbr, get_company_default_currency
from utils.http_utils import make_erpnext_request, handle_erpnext_error

purchase_orders_bp = Blueprint('purchase_orders', __name__)


def _resolve_full_supplier_name(supplier_name, company_abbr):
    if not supplier_name:
        return supplier_name
    if company_abbr and not supplier_name.endswith(f" - {company_abbr}"):
        return add_company_abbr(supplier_name, company_abbr)
    return supplier_name


def _fetch_supplier_details(session, headers, supplier_name):
    endpoint = f"/api/resource/Supplier/{quote(supplier_name)}?fields=%5B%22name%22,%22supplier_name%22,%22custom_default_price_list%22,%22default_currency%22%5D"
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=endpoint,
        operation_name=f"Fetch supplier '{supplier_name}'"
    )
    if error:
        raise RuntimeError(error.get('message', 'Error fetching supplier'))
    if response.status_code != 200:
        raise RuntimeError(f"Failed to fetch supplier: {response.text}")
    return response.json().get('data', {})


def _fetch_price_from_list(session, headers, price_list, item_code):
    if not price_list or not item_code:
        return None
    filters = json.dumps([
        ["price_list", "=", price_list],
        ["item_code", "=", item_code]
    ])
    params = {
        'fields': json.dumps(["name", "price_list_rate", "currency"]),
        'filters': filters,
        'limit_page_length': 1
    }
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Item Price",
        params=params,
        operation_name=f"Fetch price for {item_code} in {price_list}"
    )
    if error or response.status_code != 200:
        return None
    data = response.json().get('data', [])
    if not data:
        return None
    return data[0]

def _parse_decimal(value, default=None):
    if value is None:
        return default
    if isinstance(value, str):
        cleaned = value.replace(',', '.').strip()
        if cleaned == '':
            return default
        value = cleaned
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_po_item(item, default_schedule, session, headers, price_list, company_abbr, default_warehouse=''):
    item_code = item.get('item_code')
    if not item_code:
        raise ValueError('Cada item debe incluir item_code')

    erp_item_code = add_company_abbr(item_code, company_abbr) if company_abbr else item_code
    qty = float(item.get('qty') or 0)
    if qty <= 0:
        raise ValueError(f"La cantidad para '{item_code}' debe ser mayor a 0")

    rate = item.get('rate')
    if rate in (None, '', 0) and price_list:
        price_data = _fetch_price_from_list(session, headers, price_list, erp_item_code)
        if price_data:
            rate = price_data.get('price_list_rate')

    base_rate = _parse_decimal(rate, 0) or 0
    discount_percentage = _parse_decimal(item.get('discount_percent') or item.get('discount_percentage'), 0) or 0
    explicit_discount_amount = item.get('discount_amount')
    discount_amount = _parse_decimal(explicit_discount_amount, None)
    subtotal = qty * base_rate
    if discount_amount is None or discount_amount == 0:
        if discount_percentage and subtotal:
            discount_amount = subtotal * (discount_percentage / 100)
        else:
            discount_amount = 0
    discount_amount = min(discount_amount, subtotal)
    per_unit_discount = (discount_amount / qty) if qty else 0
    net_rate = max(0, base_rate - per_unit_discount)
    iva_percent = _parse_decimal(item.get('iva_percent'))

    normalized = {
        'item_code': erp_item_code,
        'description': item.get('description'),
        'item_name': item.get('item_name'),
        'qty': qty,
        'uom': item.get('uom') or 'Unit',
        'rate': net_rate,
        'price_list_rate': base_rate,
        'warehouse': item.get('warehouse') or default_warehouse,
        'schedule_date': item.get('schedule_date') or default_schedule,
        'conversion_factor': item.get('conversion_factor', 1),
        'discount_percentage': discount_percentage,
        'discount_amount': discount_amount
    }
    if item.get('item_tax_template'):
        normalized['item_tax_template'] = item.get('item_tax_template')
    if item.get('expense_account'):
        normalized['expense_account'] = item.get('expense_account')
    if iva_percent is not None:
        normalized['iva_percent'] = iva_percent
    return normalized


@purchase_orders_bp.route('/api/purchase-orders', methods=['POST', 'OPTIONS'])
def create_purchase_order():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        supplier = data.get('supplier')
        company = data.get('company')
        items = data.get('items', [])
        requested_docstatus = int(data.get('docstatus') or 0)

        if not supplier:
            return jsonify({'success': False, 'message': 'Debe seleccionar un proveedor'}), 400
        if not company:
            return jsonify({'success': False, 'message': 'La compania es requerida'}), 400
        if not items:
            return jsonify({'success': False, 'message': 'La orden debe incluir items'}), 400

        company_abbr = get_company_abbr(session, headers, company)
        supplier_full = _resolve_full_supplier_name(supplier, company_abbr)

        supplier_doc = _fetch_supplier_details(session, headers, supplier_full)
        price_list = data.get('price_list') or supplier_doc.get('custom_default_price_list')
        
        # Obtener moneda: primero del payload, luego del proveedor, finalmente de la empresa
        currency = data.get('currency') or supplier_doc.get('default_currency')


        # Fetch company's default warehouse
        default_warehouse = ''
        try:
            company_response, company_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Company/{quote(company)}?fields=%5B%22custom_default_warehouse%22%5D",
                operation_name=f"Fetch company '{company}' default warehouse"
            )
            if not company_error and company_response.status_code == 200:
                company_data = company_response.json().get('data', {})
                default_warehouse = company_data.get('custom_default_warehouse', '')
        except Exception as e:
            print(f"Error fetching company default warehouse: {e}")

        transaction_date = data.get('transaction_date') or datetime.now().strftime('%Y-%m-%d')
        schedule_date = data.get('schedule_date') or transaction_date

        po_items = []
        for item in items:
            po_items.append(_normalize_po_item(
                item,
                schedule_date,
                session,
                headers,
                price_list,
                company_abbr,
                default_warehouse
            ))

        payload = {
            'supplier': supplier_full,
            'company': company,
            'transaction_date': transaction_date,
            'schedule_date': schedule_date,
            'currency': currency,
            'buying_price_list': price_list,
            'price_list': price_list,
            'apply_discount_on': data.get('apply_discount_on'),
            'additional_discount_percentage': data.get('additional_discount_percentage'),
            'status': data.get('status') or 'Borrador',
            'title': data.get('description') or supplier_full,
            'remarks': data.get('notes'),
            'sales_condition_type': data.get('sales_condition_type'),
            'docstatus': 0,
            'items': po_items
        }

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Purchase Order",
            data={'data': payload},
            operation_name="Create Purchase Order"
        )

        if error:
            return handle_erpnext_error(error, "Error creando Purchase Order")

        created = response.json().get('data', {})
        order_name = created.get('name')
        if requested_docstatus == 1 and order_name:
            submit_payload = {'doc': created}
            submit_response, submit_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.submit",
                data=submit_payload,
                operation_name=f"Submit Purchase Order '{order_name}'"
            )
            if submit_error or submit_response.status_code != 200:
                make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Purchase Order/{quote(order_name)}",
                    operation_name=f"Rollback Purchase Order '{order_name}' draft"
                )
                if submit_error:
                    return handle_erpnext_error(submit_error, "Error confirmando Purchase Order")
                return jsonify({'success': False, 'message': submit_response.text}), submit_response.status_code
            created = submit_response.json().get('message', created)

        if company_abbr:
            created['supplier'] = remove_company_abbr(created.get('supplier'), company_abbr)
            for item in created.get('items', []):
                item_code = item.get('item_code')
                if item_code:
                    item['item_code'] = remove_company_abbr(item_code, company_abbr)

        return jsonify({'success': True, 'message': 'Orden de compra creada', 'data': created})
    except ValueError as ve:
        return jsonify({'success': False, 'message': str(ve)}), 400
    except Exception as exc:
        print(f"--- Error creating purchase order: {exc}")
        return jsonify({'success': False, 'message': f'Error interno: {str(exc)}'}), 500


@purchase_orders_bp.route('/api/purchase-orders/<po_name>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def handle_purchase_order(po_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        if request.method == 'GET':
            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Order/{quote(po_name)}",
                operation_name=f"Get Purchase Order '{po_name}'"
            )
            if error:
                return handle_erpnext_error(error, f"Error obteniendo Purchase Order '{po_name}'")
            data = response.json().get('data', {})
            company_abbr = get_company_abbr(session, headers, data.get('company'))
            if company_abbr:
                data['supplier'] = remove_company_abbr(data.get('supplier'), company_abbr)
                for item in data.get('items', []):
                    if item.get('item_code'):
                        item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)
            return jsonify({'success': True, 'data': data})

        if request.method == 'PUT':
            payload = request.get_json() or {}
            items = payload.get('items', [])
            po_response, po_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Order/{quote(po_name)}?fields=%5B%22docstatus%22,%22company%22,%22supplier%22,%22buying_price_list%22,%22schedule_date%22%5D",
                operation_name=f"Get Purchase Order '{po_name}' for update"
            )
            if po_error or po_response.status_code != 200:
                return handle_erpnext_error(po_error, "No se pudo obtener la orden") if po_error else (
                    jsonify({'success': False, 'message': 'No se pudo obtener la orden'}), 500
                )
            current_po = po_response.json().get('data', {})
            if current_po.get('docstatus') == 1:
                return jsonify({'success': False, 'message': 'No se puede editar una orden confirmada'}), 400

            company = payload.get('company') or current_po.get('company')
            company_abbr = get_company_abbr(session, headers, company)
            supplier_value = payload.get('supplier') or remove_company_abbr(current_po.get('supplier'), company_abbr)
            supplier_full = _resolve_full_supplier_name(supplier_value, company_abbr)
            price_list = payload.get('price_list') or current_po.get('buying_price_list')
            schedule_date = payload.get('schedule_date') or current_po.get('schedule_date')

            # Fetch company's default warehouse
            default_warehouse = ''
            try:
                company_response, company_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Company/{quote(company)}?fields=%5B%22custom_default_warehouse%22%5D",
                    operation_name=f"Fetch company '{company}' default warehouse"
                )
                if not company_error and company_response.status_code == 200:
                    company_data = company_response.json().get('data', {})
                    default_warehouse = company_data.get('custom_default_warehouse', '')
            except Exception as e:
                print(f"Error fetching company default warehouse: {e}")

            formatted_items = []
            for item in items:
                formatted_items.append(_normalize_po_item(
                    item,
                    schedule_date,
                    session,
                    headers,
                    price_list,
                    company_abbr,
                    default_warehouse
                ))

            update_payload = {
                'supplier': supplier_full,
                'transaction_date': payload.get('transaction_date') or current_po.get('transaction_date'),
                'schedule_date': schedule_date,
                'currency': payload.get('currency'),
                'buying_price_list': price_list,
                'items': formatted_items,
                'status': payload.get('status') or current_po.get('status')
            }

            response, error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Purchase Order/{quote(po_name)}",
                data={'data': update_payload},
                operation_name=f"Update Purchase Order '{po_name}'"
            )
            if error:
                return handle_erpnext_error(error, f"Error actualizando Purchase Order '{po_name}'")

            updated = response.json().get('data', {})
            if company_abbr:
                updated['supplier'] = remove_company_abbr(updated.get('supplier'), company_abbr)
                for item in updated.get('items', []):
                    if item.get('item_code'):
                        item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)

            return jsonify({'success': True, 'data': updated})

        if request.method == 'DELETE':
            po_response, po_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Order/{quote(po_name)}?fields=%5B%22docstatus%22%5D",
                operation_name=f"Get Purchase Order '{po_name}' status"
            )
            if po_error or po_response.status_code != 200:
                return handle_erpnext_error(po_error, "No se pudo obtener la orden") if po_error else (
                    jsonify({'success': False, 'message': 'No se pudo obtener la orden'}), 500
                )
            docstatus = po_response.json().get('data', {}).get('docstatus', 0)

            if docstatus == 0:
                response, error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Purchase Order/{quote(po_name)}",
                    operation_name=f"Delete Purchase Order '{po_name}'"
                )
                if error:
                    return handle_erpnext_error(error, "Error eliminando la orden")
                return jsonify({'success': True, 'message': 'Orden eliminada'})

            if docstatus == 1:
                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.cancel",
                    data={'doctype': 'Purchase Order', 'name': po_name},
                    operation_name=f"Cancel Purchase Order '{po_name}'"
                )
                if cancel_error or cancel_response.status_code != 200:
                    return handle_erpnext_error(cancel_error, "Error cancelando la orden") if cancel_error else (
                        jsonify({'success': False, 'message': cancel_response.text}), cancel_response.status_code
                    )
            return jsonify({'success': True, 'message': 'Orden cancelada'})

            return jsonify({'success': False, 'message': 'Estado no soportado para eliminacion'}), 400
    except ValueError as ve:
        return jsonify({'success': False, 'message': str(ve)}), 400
    except Exception as exc:
        print(f"--- Error handling purchase order '{po_name}': {exc}")
        return jsonify({'success': False, 'message': f'Error interno: {str(exc)}'}), 500


@purchase_orders_bp.route('/api/purchase-orders/<po_name>/cancel', methods=['POST', 'OPTIONS'])
def cancel_purchase_order(po_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    reason = payload.get('reason', 'Cancelado desde frontend')

    try:
        status_response, status_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Order/{quote(po_name)}?fields=%5B%22docstatus%22,%22company%22%5D",
            operation_name=f"Get Purchase Order '{po_name}' status for cancel"
        )
        if status_error or status_response.status_code != 200:
            return handle_erpnext_error(status_error, "No se pudo obtener el estado de la orden") if status_error else (
                jsonify({'success': False, 'message': 'No se pudo obtener el estado de la orden'}), 500
            )

        po_data = status_response.json().get('data', {})
        docstatus = po_data.get('docstatus')
        if docstatus == 2:
            return jsonify({'success': True, 'message': 'La orden ya se encuentra cancelada'})
        if docstatus != 1:
            return jsonify({'success': False, 'message': 'Solo se pueden cancelar ordenes confirmadas'}), 400

        if reason:
            set_value_payload = {
                'doctype': 'Purchase Order',
                'name': po_name,
                'fieldname': 'remarks',
                'value': reason
            }
            make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.set_value",
                data=set_value_payload,
                operation_name=f"Annotate Purchase Order '{po_name}' cancel reason"
            )

        cancel_response, cancel_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.cancel",
            data={'doctype': 'Purchase Order', 'name': po_name},
            operation_name=f"Cancel Purchase Order '{po_name}'"
        )
        if cancel_error or cancel_response.status_code != 200:
            return handle_erpnext_error(cancel_error, "Error cancelando la orden") if cancel_error else (
                jsonify({'success': False, 'message': cancel_response.text}), cancel_response.status_code
            )

        return jsonify({'success': True, 'message': 'Orden cancelada'})
    except Exception as exc:
        print(f"--- Error cancelling purchase order '{po_name}': {exc}")
        return jsonify({'success': False, 'message': 'Error interno al cancelar la orden'}), 500


@purchase_orders_bp.route('/api/suppliers/<supplier_name>/purchase-orders', methods=['GET', 'OPTIONS'])
def list_supplier_purchase_orders(supplier_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 20))
        company_abbr = get_company_abbr(session, headers, company) if company else None
        supplier_full = _resolve_full_supplier_name(supplier_name, company_abbr)
        docstatus_param = request.args.get('docstatus')
        docstatus_filter = None
        if docstatus_param is not None:
            try:
                docstatus_filter = int(docstatus_param)
            except ValueError:
                return jsonify({'success': False, 'message': 'docstatus debe ser numerico'}), 400

        filters = [
            ["supplier", "=", supplier_full]
        ]
        if docstatus_filter is not None:
            # For linking purposes (when docstatus=1 is passed), only include submitted orders (docstatus=1)
            # that are not completed, cancelled, or closed
            if docstatus_filter == 1:
                filters.append(["docstatus", "=", 1])
                filters.append(["status", "not in", ["Completed", "Cancelled", "Closed"]])
            else:
                filters.append(["docstatus", "=", docstatus_filter])

        params = {
            'fields': json.dumps(["name", "transaction_date", "schedule_date", "status", "grand_total", "docstatus"]),
            'filters': json.dumps(filters),
            'limit_start': (page - 1) * page_size,
            'limit_page_length': page_size,
            'order_by': 'transaction_date desc'
        }

        # Get total count without pagination
        total_params = {
            'fields': json.dumps(["count(name) as total"]),
            'filters': json.dumps(filters)
        }

        total_response, total_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Purchase Order",
            params=total_params,
            operation_name=f"Count Purchase Orders for '{supplier_name}'"
        )
        total_count = 0
        if not total_error:
            total_data = total_response.json().get('data', [])
            if total_data:
                total_count = total_data[0].get('total', 0)

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Purchase Order",
            params=params,
            operation_name=f"List Purchase Orders for '{supplier_name}'"
        )
        if error:
            return handle_erpnext_error(error, "Error listando ordenes de compra")

        orders = response.json().get('data', [])
        if company_abbr:
            for order in orders:
                order['supplier'] = remove_company_abbr(order.get('supplier'), company_abbr)

        return jsonify({
            'success': True,
            'purchase_orders': orders,
            'page': page,
            'page_size': page_size,
            'total_count': total_count
        })
    except Exception as exc:
        print(f"--- Error listing supplier purchase orders: {exc}")
        return jsonify({'success': False, 'message': f'Error interno: {str(exc)}'}), 500


@purchase_orders_bp.route('/api/purchase-orders/suggestions', methods=['GET', 'OPTIONS'])
def get_purchase_order_suggestions():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    supplier = request.args.get('supplier')
    company = request.args.get('company')
    if not supplier or not company:
        return jsonify({
            'success': False,
            'message': 'Debe indicar supplier y company para obtener sugerencias'
        }), 400

    try:
        # Placeholder logic: future sections will fetch safety stock & weekly sales averages
        company_abbr = get_company_abbr(session, headers, company)
        supplier_full = _resolve_full_supplier_name(supplier, company_abbr)
        placeholder_items = []
        note = (
            "TODO: incorporar analisis de stock de seguridad y promedio semanal de ventas "
            f"para sugerencias dinamicas (proveedor {supplier_full})."
        )
        company_abbr = get_company_abbr(session, headers, company)
        supplier_full = _resolve_full_supplier_name(supplier, company_abbr)
        return jsonify({
            'success': True,
            'data': {
                'items': placeholder_items,
                'note': note
            }
        })
    except Exception as exc:
        print(f"--- Error fetching PO suggestions: {exc}")
        return jsonify({'success': False, 'message': f'Error interno: {str(exc)}'}), 500
def cancel_purchase_order(po_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        reason = request.json.get('reason', 'Cancelada desde sistema ERP') if request.json else 'Cancelada desde sistema ERP'
        
        # Cancel the purchase order using frappe.client.cancel
        cancel_resp, cancel_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.cancel",
            data=json.dumps({
                "doctype": "Purchase Order",
                "name": po_name
            }),
            operation_name=f"Cancel Purchase Order '{po_name}'"
        )
        
        if cancel_error:
            return handle_erpnext_error(cancel_error, f"Error cancelando orden de compra '{po_name}'")
        
        if cancel_resp.status_code != 200:
            return jsonify({
                'success': False, 
                'message': f'Error cancelando orden de compra: {cancel_resp.text}'
            }), 500

        print(f"--- Purchase Order '{po_name}' cancelled successfully")
        return jsonify({
            'success': True,
            'message': f'Orden de compra {po_name} cancelada exitosamente'
        })
    except Exception as exc:
        print(f"--- Error cancelling purchase order '{po_name}': {exc}")
        return jsonify({'success': False, 'message': f'Error interno: {str(exc)}'}), 500
