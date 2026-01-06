from flask import Blueprint, request, jsonify
from datetime import datetime
from urllib.parse import quote
import json

from routes.auth_utils import get_session_with_auth
from routes.general import (
    add_company_abbr,
    remove_company_abbr,
    get_company_abbr,
    get_active_company
)
from utils.http_utils import make_erpnext_request, handle_erpnext_error

sales_orders_bp = Blueprint('sales_orders', __name__)


def _resolve_company_context(session, headers, user_id, explicit_company=None):
    """
    Determines which company the operation should run against and returns
    both the company name and its abbreviation.
    """
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


def _normalize_sales_order(order, company_abbr):
    if not isinstance(order, dict):
        return order
    normalized = dict(order)
    normalized['customer'] = _strip_company_suffix(order.get('customer'), company_abbr)
    normalized['title'] = _strip_company_suffix(order.get('title'), company_abbr)
    normalized['company'] = order.get('company')
    normalized['receiving_date'] = order.get('delivery_date') or order.get('transaction_date')
    normalized['marketplace_reference'] = order.get('po_no')
    normalized['notes'] = order.get('remarks')
    normalized['items'] = _clean_items(order.get('items'), company_abbr)
    normalized['per_billed'] = order.get('per_billed', 0)
    normalized['docstatus'] = order.get('docstatus', 0)
    normalized['status'] = order.get('status')
    normalized['is_fully_billed'] = float(order.get('per_billed') or 0) >= 99.99
    return normalized


def _require_order_payload(payload):
    if not payload:
        raise ValueError('Datos de la orden requeridos')
    order_data = (
        payload.get('sales_order')
        or payload.get('order')
        or payload.get('data')
        or payload
    )
    if not isinstance(order_data, dict):
        raise ValueError('Formato de orden inválido')
    return order_data


def _build_sales_order_payload(order_data, company_abbr, *, docstatus, existing_name=None):
    company = order_data.get('company')
    customer = order_data.get('customer')
    raw_items = order_data.get('items') or []
    # Filtrar filas vacías (por ejemplo, placeholders en el frontend)
    items = [
        item for item in raw_items
        if (item.get('item_code') or '').strip()
    ]
    if not company:
        raise ValueError('La compañía es obligatoria')
    if not customer:
        raise ValueError('El cliente es obligatorio')
    if not items:
        raise ValueError('La orden debe incluir al menos un ítem')

    transaction_date = order_data.get('transaction_date') or datetime.today().strftime('%Y-%m-%d')
    receiving_date = (
        order_data.get('receiving_date')
        or order_data.get('delivery_date')
        or transaction_date
    )

    erp_items = []
    for idx, item in enumerate(items, start=1):
        item_code = item.get('item_code')
        if not item_code:
            raise ValueError('Cada ítem debe tener un código')
        qty = float(item.get('qty') or 0)
        if qty <= 0:
            raise ValueError('Cada ítem debe tener una cantidad mayor a cero')

        # Agregar abreviatura al warehouse si existe
        warehouse = item.get('warehouse')
        if warehouse:
            warehouse = add_company_abbr(warehouse, company_abbr)

        erp_item = {
            'doctype': 'Sales Order Item',
            'item_code': add_company_abbr(item_code, company_abbr),
            'item_name': item.get('item_name') or item.get('description') or item_code,
            'description': item.get('description') or item.get('item_name') or item_code,
            'qty': qty,
            'rate': float(item.get('rate') or 0),
            'schedule_date': item.get('schedule_date') or receiving_date,
            'warehouse': warehouse,
            'uom': item.get('uom') or 'Unit',
            'conversion_factor': float(item.get('conversion_factor') or 1),
            'idx': idx
        }
        # Solo incluir name del item si estamos actualizando una orden existente (no creando nueva)
        if existing_name and item.get('name'):
            erp_item['name'] = item['name']
        erp_items.append(erp_item)

    remarks_segments = []
    if order_data.get('notes'):
        remarks_segments.append(order_data['notes'])
    if order_data.get('shipping_label_note'):
        remarks_segments.append(f"Etiquetas de envío: {order_data['shipping_label_note']}")
    remarks = '\n'.join(remarks_segments) if remarks_segments else None

    payload = {
        'doctype': 'Sales Order',
        'customer': add_company_abbr(customer, company_abbr),
        'company': company,
        'transaction_date': transaction_date,
        'delivery_date': receiving_date,
        'items': erp_items,
        'order_type': order_data.get('order_type') or 'Sales',
        'docstatus': docstatus,
        'po_no': order_data.get('marketplace_reference'),
        'title': add_company_abbr(order_data.get('title') or customer, company_abbr),
        'reserve_stock': 1,  # Reservar stock al crear la orden
    }

    if remarks:
        payload['remarks'] = remarks

    if order_data.get('shipping_contact'):
        payload['contact_display'] = order_data['shipping_contact']

    if existing_name:
        payload['name'] = existing_name

    return payload


def _fetch_sales_order(session, name):
    fields = quote(json.dumps(['*']))
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Sales Order/{quote(name)}?fields={fields}",
        operation_name=f"Get Sales Order {name}"
    )
    if error:
        raise RuntimeError(error.get('message') or 'Error obteniendo orden de venta')
    if response.status_code != 200:
        raise RuntimeError(response.text)
    return response.json().get('data', {})


def _get_orders_count(session, filters):
    payload = {
        'doctype': 'Sales Order',
        'filters': filters
    }
    response, error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.client.get_count",
        data=payload,
        operation_name="Count Sales Orders"
    )
    if error:
        raise RuntimeError(error.get('message') or 'Error obteniendo conteo')
    return response.json().get('message', 0)


@sales_orders_bp.route('/api/sales-orders', methods=['GET', 'POST', 'OPTIONS'])
def collection():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company_param = request.args.get('company')
    company_name, company_abbr = _resolve_company_context(session, headers, user_id, company_param)

    if request.method == 'GET':
        status_filter = request.args.get('status', 'open')
        customer = request.args.get('customer')
        limit = int(request.args.get('limit', 20))
        page = int(request.args.get('page', 1))
        offset = max(0, (page - 1) * limit)

        hide_billed = request.args.get('hide_billed', '1')
        hide_billed_orders = str(hide_billed).lower() not in ('0', 'false', 'no')
        billing_state = request.args.get('billing_state')

        filters = []
        if status_filter == 'open':
            filters.append(['docstatus', '=', 1])
            filters.append(['status', 'not in', ['Completed', 'Closed', 'Cancelled']])
        elif status_filter == 'cancelled':
            filters.append(['docstatus', '=', 2])
        elif status_filter != 'all':
            filters.append(['docstatus', '=', 1])

        if company_name:
            filters.append(['company', '=', company_name])

        if customer:
            if company_abbr:
                filters.append(['customer', '=', add_company_abbr(customer, company_abbr)])
            else:
                filters.append(['customer', '=', customer])

        if billing_state == 'billed_pending_delivery':
            filters.append(['per_billed', '>=', 99.99])
            filters.append(['per_delivered', '<', 99.99])
        elif billing_state == 'billed_delivered':
            filters.append(['per_billed', '>=', 99.99])
            filters.append(['per_delivered', '>=', 99.99])
        elif billing_state == 'not_billed':
            filters.append(['per_billed', '<', 99.99])
        elif hide_billed_orders:
            filters.append(['per_billed', '<', 99.99])

        fields = json.dumps([
            'name',
            'customer',
            'company',
            'transaction_date',
            'delivery_date',
            'status',
            'grand_total',
            'per_delivered',
            'per_billed',
            'docstatus',
            'modified',
            'po_no'
        ])

        params = {
            'fields': fields,
            'filters': json.dumps(filters),
            'limit_page_length': limit,
            'limit_start': offset,
            'order_by': 'modified desc'
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Sales Order",
            params=params,
            operation_name="List Sales Orders"
        )
        if error:
            return handle_erpnext_error(error, 'Error al obtener órdenes de venta')
        if response.status_code != 200:
            return jsonify({'success': False, 'message': response.text}), response.status_code

        try:
            total = _get_orders_count(session, filters)
        except Exception as exc:
            print(f"--- Sales Orders count failed: {exc}")
            total = len(response.json().get('data', []))

        cleaned = [
            _normalize_sales_order(entry, company_abbr)
            for entry in response.json().get('data', [])
        ]

        return jsonify({
            'success': True,
            'orders': cleaned,
            'page': page,
            'page_size': limit,
            'total_count': total
        })

    # POST – create
    try:
        payload = _require_order_payload(request.get_json())
        if not company_name:
            company_name = payload.get('company')
            if company_name:
                company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({'success': False, 'message': 'No se pudo determinar la sigla de la compañía'}), 400

        erp_payload = _build_sales_order_payload(payload, company_abbr, docstatus=0)
        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Sales Order",
            data={'data': erp_payload},
            operation_name="Create Sales Order"
        )
        if create_error:
            return handle_erpnext_error(create_error, 'Error creando orden de venta')

        if create_response.status_code not in (200, 201):
            return jsonify({'success': False, 'message': create_response.text}), create_response.status_code

        created = create_response.json().get('data', {})
        order_name = created.get('name')

        # Utilizar el documento completo devuelto por ERPNext para respetar timestamps
        submit_payload = {'doc': created}
        submit_response, submit_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.submit",
            data=submit_payload,
            operation_name=f"Submit Sales Order {order_name}"
        )
        if submit_error or submit_response.status_code != 200:
            # Intentar limpiar borrador
            make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Sales Order/{quote(order_name)}",
                operation_name="Rollback Sales Order draft"
            )
            if submit_error:
                return handle_erpnext_error(submit_error, 'Error confirmando la orden de venta')
            return jsonify({'success': False, 'message': submit_response.text}), submit_response.status_code

        erp_doc = _fetch_sales_order(session, order_name)
        normalized = _normalize_sales_order(erp_doc, company_abbr)
        return jsonify({'success': True, 'data': normalized}), 201
    except ValueError as validation_error:
        return jsonify({'success': False, 'message': str(validation_error)}), 400
    except Exception as exc:
        print(f"--- Sales Order create failed: {exc}")
        return jsonify({'success': False, 'message': 'Error interno al crear la orden'}), 500


@sales_orders_bp.route('/api/sales-orders/<order_name>', methods=['GET', 'PUT', 'OPTIONS'])
def detail(order_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company_name, company_abbr = _resolve_company_context(session, headers, user_id)

    try:
        if request.method == 'GET':
            erp_doc = _fetch_sales_order(session, order_name)
            if not company_abbr and erp_doc.get('company'):
                company_abbr = get_company_abbr(session, headers, erp_doc['company'])
            normalized = _normalize_sales_order(erp_doc, company_abbr)
            return jsonify({'success': True, 'data': normalized})

        # PUT - Para modificar una orden confirmada, debemos cancelarla y crear una nueva
        payload = _require_order_payload(request.get_json())
        if not payload.get('company'):
            if not company_name:
                return jsonify({'success': False, 'message': 'Debe indicar la compañía'}), 400
            payload['company'] = company_name

        if not company_abbr and payload.get('company'):
            company_abbr = get_company_abbr(session, headers, payload['company'])

        if not company_abbr:
            return jsonify({'success': False, 'message': 'No se pudo obtener la sigla de compañía'}), 400

        # Verificar el estado actual de la orden
        current_order = _fetch_sales_order(session, order_name)
        current_docstatus = current_order.get('docstatus', 0)

        # Si la orden está confirmada (docstatus=1), cancelarla y crear una nueva
        if current_docstatus == 1:
            print(f"--- Sales Order {order_name}: orden confirmada, cancelando para modificar...")
            
            # 1. Cancelar la orden actual con motivo de modificación
            set_value_payload = {
                'doctype': 'Sales Order',
                'name': order_name,
                'fieldname': 'remarks',
                'value': f"Cancelado por modificación. Nueva orden generada."
            }
            make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.set_value",
                data=set_value_payload,
                operation_name=f"Annotate Sales Order {order_name} modification"
            )

            cancel_response, cancel_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.cancel",
                data={'doctype': 'Sales Order', 'name': order_name},
                operation_name=f"Cancel Sales Order {order_name} for modification"
            )
            if cancel_error:
                return handle_erpnext_error(cancel_error, 'Error al cancelar la orden para modificar')
            if cancel_response.status_code != 200:
                return jsonify({'success': False, 'message': f'Error cancelando orden: {cancel_response.text}'}), cancel_response.status_code

            print(f"--- Sales Order {order_name}: orden cancelada, creando nueva...")

            # 2. Crear nueva orden con los datos modificados (sin el nombre anterior)
            erp_payload = _build_sales_order_payload(payload, company_abbr, docstatus=0)
            
            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Sales Order",
                data={'data': erp_payload},
                operation_name="Create Sales Order (from modification)"
            )
            if create_error:
                return handle_erpnext_error(create_error, 'Error creando nueva orden de venta')
            if create_response.status_code not in (200, 201):
                return jsonify({'success': False, 'message': create_response.text}), create_response.status_code

            created = create_response.json().get('data', {})
            new_order_name = created.get('name')

            # 3. Confirmar la nueva orden
            submit_payload = {'doc': created}
            submit_response, submit_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.submit",
                data=submit_payload,
                operation_name=f"Submit Sales Order {new_order_name}"
            )
            if submit_error or submit_response.status_code != 200:
                # Intentar limpiar borrador
                make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Sales Order/{quote(new_order_name)}",
                    operation_name="Rollback Sales Order draft"
                )
                if submit_error:
                    return handle_erpnext_error(submit_error, 'Error confirmando la nueva orden de venta')
                return jsonify({'success': False, 'message': submit_response.text}), submit_response.status_code

            print(f"--- Sales Order: modificación completada. Orden {order_name} cancelada, nueva orden {new_order_name} creada.")

            erp_doc = _fetch_sales_order(session, new_order_name)
            normalized = _normalize_sales_order(erp_doc, company_abbr)
            return jsonify({
                'success': True, 
                'data': normalized,
                'message': f'Orden {order_name} modificada. Nueva orden: {new_order_name}',
                'previous_order': order_name,
                'new_order': new_order_name
            })

        else:
            # Si la orden es borrador (docstatus=0), se puede modificar directamente
            erp_payload = _build_sales_order_payload(
                payload,
                company_abbr,
                docstatus=0,
                existing_name=order_name
            )
            save_response, save_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Sales Order/{quote(order_name)}",
                data={'data': erp_payload},
                operation_name=f"Update Sales Order draft {order_name}"
            )
            if save_error:
                return handle_erpnext_error(save_error, 'Error actualizando orden de venta')
            if save_response.status_code != 200:
                return jsonify({'success': False, 'message': save_response.text}), save_response.status_code

            erp_doc = _fetch_sales_order(session, order_name)
            normalized = _normalize_sales_order(erp_doc, company_abbr)
            return jsonify({'success': True, 'data': normalized})

    except ValueError as validation_error:
        return jsonify({'success': False, 'message': str(validation_error)}), 400
    except Exception as exc:
        print(f"--- Sales Order update failed: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': 'Error interno al procesar la orden'}), 500


@sales_orders_bp.route('/api/sales-orders/<order_name>/cancel', methods=['POST', 'OPTIONS'])
def cancel(order_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    reason = (payload.get('reason') or '').strip()
    if not reason:
        return jsonify({'success': False, 'message': 'Debes indicar el motivo de cancelación'}), 400

    try:
        # Registrar el motivo en remarks antes de cancelar
        set_value_payload = {
            'doctype': 'Sales Order',
            'name': order_name,
            'fieldname': 'remarks',
            'value': f"Cancelado: {reason}"
        }
        make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.set_value",
            data=set_value_payload,
            operation_name=f"Annotate Sales Order {order_name} cancellation reason"
        )

        cancel_response, cancel_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.cancel",
            data={'doctype': 'Sales Order', 'name': order_name},
            operation_name=f"Cancel Sales Order {order_name}"
        )
        if cancel_error:
            return handle_erpnext_error(cancel_error, 'Error al cancelar la orden de venta')
        if cancel_response.status_code != 200:
            return jsonify({'success': False, 'message': cancel_response.text}), cancel_response.status_code

        return jsonify({'success': True, 'message': 'Orden cancelada correctamente'})
    except Exception as exc:
        print(f"--- Sales Order cancel failed: {exc}")
        return jsonify({'success': False, 'message': 'Error interno al cancelar la orden'}), 500


@sales_orders_bp.route('/api/sales-orders/mark-delivered', methods=['POST', 'OPTIONS'])
def mark_delivered():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    order_names = payload.get('orders') or payload.get('order_names') or []
    if not isinstance(order_names, list) or not order_names:
        return jsonify({'success': False, 'message': 'Debes seleccionar al menos una orden'}), 400

    updated = []
    errors = []

    for order_name in order_names:
        if not order_name:
            continue

        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Sales Order/{quote(order_name)}",
            data={
                "delivery_status": "Delivered",
                "status": "Completed",
                "per_delivered": 100,
                "per_picked": 100
            },
            operation_name=f"Mark Sales Order {order_name} Delivered"
        )

        if update_error or not update_response or update_response.status_code not in (200, 202):
            error_message = update_error or (update_response.text if update_response else 'Sin respuesta de ERPNext')
            errors.append({'order': order_name, 'error': str(error_message)})
            continue

        updated.append(order_name)

    if not updated and errors:
        return jsonify({'success': False, 'message': 'No se pudieron actualizar las órdenes seleccionadas', 'errors': errors}), 400

    return jsonify({
        'success': True,
        'updated': updated,
        'errors': errors
    })


@sales_orders_bp.route('/api/sales-orders/metrics', methods=['GET', 'OPTIONS'])
def metrics():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company_param = request.args.get('company')
    company_name, company_abbr = _resolve_company_context(session, headers, user_id, company_param)

    base_filters = []
    if company_name:
        base_filters.append(['company', '=', company_name])

    try:
        open_filters = base_filters + [
            ['docstatus', '=', 1],
            ['status', 'not in', ['Completed', 'Closed', 'Cancelled']]
        ]
        cancelled_filters = base_filters + [['docstatus', '=', 2]]
        today_str = datetime.today().strftime('%Y-%m-%d')
        today_filters = base_filters + [
            ['docstatus', '=', 1],
            ['transaction_date', '=', today_str]
        ]

        open_count = _get_orders_count(session, open_filters)
        cancelled_count = _get_orders_count(session, cancelled_filters)
        today_count = _get_orders_count(session, today_filters)

        params = {
            'fields': json.dumps(['name', 'customer', 'delivery_date', 'status', 'grand_total']),
            'filters': json.dumps(open_filters),
            'limit_page_length': 5,
            'order_by': 'modified desc'
        }
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Sales Order",
            params=params,
            operation_name="Latest Sales Orders for metrics"
        )
        recent_orders = response.json().get('data', []) if not error and response.status_code == 200 else []
        if company_abbr:
            recent_orders = [
                _normalize_sales_order(entry, company_abbr)
                for entry in recent_orders
            ]

        return jsonify({
            'success': True,
            'data': {
                'open': open_count,
                'cancelled': cancelled_count,
                'today': today_count,
                'recent': recent_orders
            }
        })
    except Exception as exc:
        print(f"--- Sales Order metrics failed: {exc}")
        return jsonify({'success': False, 'message': 'No se pudieron obtener las métricas de órdenes'}), 500
