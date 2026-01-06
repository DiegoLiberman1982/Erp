from flask import Blueprint, request, jsonify
import requests
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para las rutas de monedas
currency_bp = Blueprint('currency', __name__)


@currency_bp.route('/api/currencies', methods=['GET'])
def get_currencies():
    """
    Obtener lista de monedas habilitadas desde ERPNext
    """
    try:
        print("🔄 Iniciando obtención de monedas...")

        session, headers, user_id, error_response = get_session_with_auth()

        if error_response:
            print("❌ Error de autenticación")
            return error_response[0], error_response[1]

        print("✅ Autenticación exitosa")

        # Obtener monedas desde ERPNext
        fields = '["name","currency_name","symbol","enabled"]'
        filters = '[["enabled","=","1"]]' 
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Currency",
            params={
                "fields": fields,
                "filters": filters,
                "order_by": "currency_name"
            },
            operation_name="Get currencies"
        )

        if error:
            print("❌ Error obteniendo monedas")
            return handle_erpnext_error(error, "Failed to fetch currencies")

        print(f"📡 Respuesta de ERPNext: {response.status_code}")

        if response.status_code != 200:
            print(f"❌ Error obteniendo monedas: {response.status_code} - {response.text}")
            return jsonify({
                'success': False,
                'message': f'Error al obtener monedas desde ERPNext: {response.status_code}'
            }), 500

        try:
            currencies_data = response.json()
            print(f"📦 Datos obtenidos: {len(currencies_data.get('data', []))} monedas")
        except Exception as json_error:
            print(f"❌ Error parseando JSON: {json_error}")
            print(f"📄 Respuesta cruda: {response.text[:500]}...")
            return jsonify({
                'success': False,
                'message': 'Error al procesar respuesta de ERPNext'
            }), 500

        # Formatear respuesta
        currencies = []
        for currency in currencies_data.get('data', []):
            currencies.append({
                'name': currency.get('name'),
                'currency_name': currency.get('currency_name', currency.get('name')),
                'symbol': currency.get('symbol', ''),
                'enabled': currency.get('enabled', 0)
            })

        print(f"✅ Procesadas {len(currencies)} monedas")

        return jsonify({
            'success': True,
            'data': currencies
        })

    except Exception as e:
        print(f"❌ Error interno obteniendo monedas: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@currency_bp.route('/api/currency/exchange-rate', methods=['GET'])
def get_exchange_rate():
    """
    Obtener el tipo de cambio entre dos monedas
    Parámetros: from (moneda origen), to (moneda destino)
    """
    try:
        print("🔄 Iniciando obtención de exchange rate...")

        from_currency = request.args.get('from')
        to_currency = request.args.get('to')

        if not from_currency or not to_currency:
            return jsonify({
                'success': False,
                'message': 'Se requieren parámetros "from" y "to" para las monedas'
            }), 400
        if from_currency == to_currency:
            return jsonify({
                'success': True,
                'exchange_rate': 1.0,
                'from_currency': from_currency,
                'to_currency': to_currency,
                'date': None
            })

        session, headers, user_id, error_response = get_session_with_auth()

        if error_response:
            print("❌ Error de autenticación")
            return error_response[0], error_response[1]

        print("✅ Autenticación exitosa")

        # Obtener el exchange rate desde ERPNext
        # Primero intentar obtener el rate directo
        fields = '["name","from_currency","to_currency","exchange_rate","date"]'
        filters = f'[["from_currency","=","{from_currency}"],["to_currency","=","{to_currency}"]]'

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Currency Exchange",
            params={
                "fields": fields,
                "filters": filters,
                "order_by": "date desc",
                "limit": 1
            },
            operation_name="Get exchange rate"
        )

        if error:
            print("❌ Error obteniendo exchange rate")
            return handle_erpnext_error(error, "Failed to fetch exchange rate")

        print(f"📡 Respuesta de ERPNext para exchange rate: {response.status_code}")

        if response.status_code == 200:
            try:
                exchange_data = response.json()
                rates = exchange_data.get('data', [])

                if rates:
                    latest_rate = rates[0]
                    raw_rate = latest_rate.get('exchange_rate')
                    print(f"💱 Exchange rate encontrado: {raw_rate}")
                    rate = float(raw_rate) if raw_rate is not None else None
                    if not rate or rate <= 0:
                        return jsonify({
                            'success': False,
                            'message': f'Cotización inválida para {from_currency}/{to_currency}'
                        }), 500

                    return jsonify({
                        'success': True,
                        'exchange_rate': rate,
                        'from_currency': from_currency,
                        'to_currency': to_currency,
                        'date': latest_rate.get('date')
                    })
                else:
                    print(f"⚠️ No se encontró exchange rate directo, intentando inverso...")

                    # Intentar el rate inverso
                    filters_inverse = f'[["from_currency","=","{to_currency}"],["to_currency","=","{from_currency}"]]'

                    response_inverse, error_inverse = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint="/api/resource/Currency Exchange",
                        params={
                            "fields": fields,
                            "filters": filters_inverse,
                            "order_by": "date desc",
                            "limit": 1
                        },
                        operation_name="Get inverse exchange rate"
                    )

                    if error_inverse:
                        print("❌ Error obteniendo exchange rate inverso")
                        # Si hay error en el inverso, se responde sin fallback silencioso
                    elif response_inverse.status_code == 200:
                        exchange_data_inverse = response_inverse.json()
                        rates_inverse = exchange_data_inverse.get('data', [])

                        if rates_inverse:
                            latest_rate_inverse = rates_inverse[0]
                            raw_inverse = latest_rate_inverse.get('exchange_rate')
                            inverse_rate = float(raw_inverse) if raw_inverse is not None else None
                            if not inverse_rate or inverse_rate <= 0:
                                return jsonify({
                                    'success': False,
                                    'message': f'Cotización inversa inválida para {to_currency}/{from_currency}'
                                }), 500
                            direct_rate = 1 / inverse_rate

                            print(f"💱 Exchange rate inverso encontrado: {inverse_rate}, convertido a: {direct_rate}")

                            return jsonify({
                                'success': True,
                                'exchange_rate': direct_rate,
                                'from_currency': from_currency,
                                'to_currency': to_currency,
                                'date': latest_rate_inverse.get('date'),
                                'calculated_from_inverse': True
                            })

            except Exception as json_error:
                print(f"❌ Error parseando JSON de exchange rate: {json_error}")

        # Si no se encuentra ningún rate, devolver error (sin fallbacks silenciosos)
        return jsonify({
            'success': False,
            'message': f'No se encontró exchange rate para {from_currency} a {to_currency}'
        }), 404

    except Exception as e:
        print(f"❌ Error interno obteniendo exchange rate: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500
