from flask import Blueprint, request, jsonify
from urllib.parse import quote

from routes.auth_utils import get_session_with_auth
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Import automation service to trigger recalculations when global rate changes
from services import price_list_automation_service

currency_exchange_bp = Blueprint('currency_exchange', __name__)


@currency_exchange_bp.route('/api/currency-exchange/history', methods=['GET'])
def currency_exchange_history():
    """
    GET /api/currency-exchange/history?currency=XXX&to=YYY&limit=20
    Returns recent Currency Exchange records for a given from_currency and to_currency.
    """
    try:
        from_currency = request.args.get('currency') or request.args.get('from')
        to_currency = request.args.get('to')
        limit = int(request.args.get('limit') or 20)

        if not from_currency:
            return jsonify({'success': False, 'message': 'Se requiere parámetro currency (from)'}), 400
        if not to_currency:
            return jsonify({'success': False, 'message': 'Se requiere parámetro to (moneda destino/base)'}), 400

        filters = [["from_currency", "=", from_currency], ["to_currency", "=", to_currency]]
        import json
        params = {
            'fields': '["name","from_currency","to_currency","exchange_rate","date","for_buying","for_selling"]',
            'filters': json.dumps(filters),
            'order_by': 'date desc',
            'limit': limit
        }

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response[0], error_response[1]

        resp, err = make_erpnext_request(
            session=session,
            method='GET',
            endpoint='/api/resource/Currency Exchange',
            params=params,
            operation_name='Get currency exchange history'
        )

        if err:
            return handle_erpnext_error(err, 'Failed to fetch currency exchange history')

        if resp and resp.status_code == 200:
            data = resp.json().get('data', [])
            return jsonify({'success': True, 'data': data})

        return jsonify({'success': False, 'message': 'Unexpected response from ERPNext'}), 500
    except Exception as e:
        print(f"❌ Error interno en currency_exchange_history: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500



@currency_exchange_bp.route('/api/currency-exchange/latest', methods=['GET'])
def latest_exchange():
    """
    GET /latest?currency=XXX&to=YYY
    Returns the latest Currency Exchange record filtered by from_currency and to_currency.
    """
    try:
        from_currency = request.args.get('currency') or request.args.get('from')
        to_currency = request.args.get('to')

        if not from_currency:
            return jsonify({'success': False, 'message': 'Se requiere parámetro currency (from)'}), 400
        if not to_currency:
            return jsonify({'success': False, 'message': 'Se requiere parámetro to (moneda destino/base)'}), 400

        # Build filters
        filters = [["from_currency", "=", from_currency]]
        filters.append(["to_currency", "=", to_currency])

        import json
        fields = '["name","from_currency","to_currency","exchange_rate","date","creation"]'
        params = {
            'fields': fields,
            'filters': json.dumps(filters),
            'order_by': 'creation desc',
            'limit': 1
        }

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response[0], error_response[1]

        response, error = make_erpnext_request(
            session=session,
            method='GET',
            endpoint='/api/resource/Currency Exchange',
            params=params,
            operation_name='Get latest currency exchange'
        )

        if error:
            return handle_erpnext_error(error, 'Failed to fetch latest currency exchange')

        if response.status_code == 200:
            data = response.json().get('data', [])
            if data:
                latest = data[0]
                return jsonify({'success': True, 'data': latest})
            else:
                return jsonify({'success': False, 'message': f'No hay cotización cargada para {from_currency}/{to_currency}'}), 404

        return jsonify({'success': False, 'message': 'Unexpected response from ERPNext'}), 500

    except Exception as e:
        print(f"❌ Error interno en latest_exchange: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500


@currency_exchange_bp.route('/api/currency-exchange', methods=['POST', 'PUT'])
def upsert_exchange():
    """
    Upsert a Currency Exchange record.
    Expects JSON: { from_currency, to_currency, exchange_rate, date }
    If a record exists for the same from/to and date, it will be updated; otherwise created.
    """
    try:
        payload = request.get_json(force=True) or {}
        from_currency = payload.get('from_currency')
        to_currency = payload.get('to_currency')
        exchange_rate = payload.get('exchange_rate')
        date = payload.get('date')

        if not from_currency or not to_currency or exchange_rate is None or not date:
            return jsonify({'success': False, 'message': 'Missing required fields: from_currency, to_currency, exchange_rate, date'}), 400

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response[0], error_response[1]

        # First, check if a record exists for same from/to and date
        import json
        filters = [["from_currency", "=", from_currency], ["to_currency", "=", to_currency], ["date", "=", date]]
        fields = '["name","exchange_rate","date"]'
        params = {
            'fields': fields,
            'filters': json.dumps(filters),
            'limit': 1
        }

        resp_check, err_check = make_erpnext_request(
            session=session,
            method='GET',
            endpoint='/api/resource/Currency Exchange',
            params=params,
            operation_name='Check existing currency exchange'
        )

        if err_check:
            return handle_erpnext_error(err_check, 'Failed to check existing currency exchange')

        # Prepare data wrapper for ERPNext
        data_wrapper = {
            'from_currency': from_currency,
            'to_currency': to_currency,
            'exchange_rate': exchange_rate,
            'date': date
        }

        # If exists -> update
        if resp_check and resp_check.status_code == 200:
            existing = resp_check.json().get('data', [])
            if existing:
                name = existing[0].get('name')
                endpoint = f"/api/resource/Currency Exchange/{quote(name)}"
                resp_upd, err_upd = make_erpnext_request(
                    session=session,
                    method='PUT',
                    endpoint=endpoint,
                    data={'data': data_wrapper},
                    operation_name='Update currency exchange'
                )
                if err_upd:
                    return handle_erpnext_error(err_upd, 'Failed to update currency exchange')

                # Trigger automation for purchase price lists that use the general exchange rate
                try:
                    automation_result = price_list_automation_service.apply_global_exchange_rate(session, from_currency, exchange_rate)
                except Exception as ae:
                    automation_result = {"success": False, "error": str(ae)}

                return jsonify({'success': True, 'data': resp_upd.json() if resp_upd is not None else {}, 'automation': automation_result})

        # Otherwise create
        resp_create, err_create = make_erpnext_request(
            session=session,
            method='POST',
            endpoint='/api/resource/Currency Exchange',
            data={'data': data_wrapper},
            operation_name='Create currency exchange'
        )

        if err_create:
            # handle 422/duplicate etc via central handler
            return handle_erpnext_error(err_create, 'Failed to create currency exchange')

        # Trigger automation for purchase price lists that use the general exchange rate
        try:
            automation_result = price_list_automation_service.apply_global_exchange_rate(session, from_currency, exchange_rate)
        except Exception as ae:
            automation_result = {"success": False, "error": str(ae)}

        return jsonify({'success': True, 'data': resp_create.json() if resp_create is not None else {}, 'automation': automation_result})

    except Exception as e:
        print(f"❌ Error interno en upsert_exchange: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500


@currency_exchange_bp.route('/api/currency-exchange/<path:name>', methods=['DELETE'])
def delete_exchange(name):
    """
    Delete a specific Currency Exchange by name
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response[0], error_response[1]

        endpoint = f"/api/resource/Currency Exchange/{quote(name)}"
        resp_del, err_del = make_erpnext_request(
            session=session,
            method='DELETE',
            endpoint=endpoint,
            operation_name='Delete currency exchange'
        )

        if err_del:
            return handle_erpnext_error(err_del, 'Failed to delete currency exchange')

        return jsonify({'success': True, 'message': 'Deleted'})

    except Exception as e:
        print(f"❌ Error interno en delete_exchange: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500
