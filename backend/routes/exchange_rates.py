from datetime import datetime
import logging

from flask import Blueprint, jsonify, request

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_company_default_currency
from utils.http_utils import make_erpnext_request, handle_erpnext_error

exchange_rates_bp = Blueprint("exchange_rates", __name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _resolve_company_base_currency(session, headers, user_id):
    active_company = get_active_company(user_id)
    if not active_company:
        return None, (jsonify({"success": False, "message": "No hay una compania activa seleccionada"}), 400)

    default_currency = get_company_default_currency(session, headers, active_company)
    if not default_currency:
        return None, (jsonify({"success": False, "message": "La empresa activa no tiene moneda por defecto definida"}), 400)

    return str(default_currency).strip().upper(), None


@exchange_rates_bp.route("/api/exchange-rates/<currency>/<date>", methods=["GET"])
def get_exchange_rate_for_date(currency, date):
    """
    Obtiene el tipo de cambio desde ERPNext para una moneda y fecha especifica.

    Requiere `to` como moneda destino/base.
    """
    to_currency = request.args.get("to")
    if not to_currency:
        return jsonify({"success": False, "message": "Se requiere parametro to (moneda destino/base)"}), 400

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        if currency.upper() == to_currency.upper():
            return jsonify(
                {
                    "success": True,
                    "rate": 1,
                    "from_currency": currency,
                    "to_currency": to_currency,
                    "date": date,
                }
            )

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Currency Exchange",
            params={
                "filters": f'[["from_currency","=","{currency}"],["to_currency","=","{to_currency}"],["date","<=","{date}"]]',
                "fields": '["exchange_rate","date"]',
                "limit_page_length": 1,
                "order_by": "date desc, creation desc",
            },
            operation_name=f"Get exchange rate for {currency}",
        )

        if error:
            return handle_erpnext_error(error, f"Error fetching exchange rate for {currency}")

        if response.status_code != 200:
            return jsonify({"success": False, "message": f"Error querying exchange rate: {response.status_code}"}), 500

        data = response.json().get("data", []) or []
        if not data:
            return jsonify(
                {
                    "success": False,
                    "message": f"No hay cotizacion cargada para {currency}/{to_currency} al {date}",
                }
            ), 404

        raw_rate = data[0].get("exchange_rate")
        rate = float(raw_rate) if raw_rate is not None else None
        if not rate or rate <= 0:
            return jsonify({"success": False, "message": f"Cotizacion invalida para {currency}/{to_currency}"}), 500

        return jsonify(
            {
                "success": True,
                "rate": rate,
                "from_currency": currency,
                "to_currency": to_currency,
                "date": data[0].get("date", date),
            }
        )

    except Exception as e:
        logger.error(f"Error fetching exchange rate: {str(e)}")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@exchange_rates_bp.route("/api/cotizaciones/<moneda>", methods=["GET"])
def get_exchange_rate(moneda):
    """
    Obtiene la cotizacion mas reciente desde ERPNext (Currency Exchange) para una moneda
    respecto a la moneda base (moneda por defecto de la empresa activa).
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        to_currency, err = _resolve_company_base_currency(session, headers, user_id)
        if err:
            return err

        from_currency = str(moneda or "").strip().upper()
        if not from_currency:
            return jsonify({"success": False, "message": "Moneda requerida"}), 400

        if from_currency == to_currency:
            return jsonify(
                {
                    "success": True,
                    "data": {
                        "from_currency": from_currency,
                        "to_currency": to_currency,
                        "exchange_rate": 1.0,
                        "date": datetime.utcnow().strftime("%Y-%m-%d"),
                    },
                }
            )

        today = datetime.utcnow().strftime("%Y-%m-%d")
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Currency Exchange",
            params={
                "filters": f'[["from_currency","=","{from_currency}"],["to_currency","=","{to_currency}"],["date","<=","{today}"]]',
                "fields": '["name","from_currency","to_currency","exchange_rate","date"]',
                "limit_page_length": 1,
                "order_by": "date desc, creation desc",
            },
            operation_name=f"Get latest exchange rate {from_currency}->{to_currency}",
        )

        if error:
            return handle_erpnext_error(error, f"Error fetching exchange rate for {from_currency}")

        if response.status_code != 200:
            return jsonify({"success": False, "message": f"Error querying exchange rate: {response.status_code}"}), 500

        rows = response.json().get("data", []) or []
        if not rows:
            return jsonify(
                {
                    "success": False,
                    "message": f"No hay cotizacion cargada para {from_currency}/{to_currency}",
                }
            ), 404

        row = rows[0] or {}
        raw_rate = row.get("exchange_rate")
        rate = float(raw_rate) if raw_rate is not None else None
        if not rate or rate <= 0:
            return jsonify(
                {
                    "success": False,
                    "message": f"Cotizacion invalida para {from_currency}/{to_currency}",
                }
            ), 500

        return jsonify(
            {
                "success": True,
                "data": {
                    "name": row.get("name"),
                    "from_currency": row.get("from_currency"),
                    "to_currency": row.get("to_currency"),
                    "exchange_rate": rate,
                    "date": row.get("date"),
                },
            }
        )

    except Exception as e:
        logger.error(f"Error interno al procesar cotizacion: {str(e)}")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@exchange_rates_bp.route("/api/cotizaciones", methods=["GET"])
def get_all_exchange_rates():
    """
    Obtiene las cotizaciones mas recientes cargadas en ERPNext (Currency Exchange) para
    la moneda base (moneda por defecto de la empresa activa).
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        to_currency, err = _resolve_company_base_currency(session, headers, user_id)
        if err:
            return err

        today = datetime.utcnow().strftime("%Y-%m-%d")
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Currency Exchange",
            params={
                "filters": f'[["to_currency","=","{to_currency}"],["date","<=","{today}"]]',
                "fields": '["name","from_currency","to_currency","exchange_rate","date"]',
                "order_by": "date desc, creation desc",
                "limit_page_length": 1000,
            },
            operation_name=f"Get exchange rates to {to_currency}",
        )

        if error:
            return handle_erpnext_error(error, "Error fetching exchange rates")

        if response.status_code != 200:
            return jsonify({"success": False, "message": f"Error querying exchange rates: {response.status_code}"}), 500

        rows = response.json().get("data", []) or []
        latest_by_from = {}
        for row in rows:
            from_currency = str(row.get("from_currency") or "").strip().upper()
            if not from_currency or from_currency == to_currency or from_currency in latest_by_from:
                continue

            raw_rate = row.get("exchange_rate")
            rate = float(raw_rate) if raw_rate is not None else None
            if not rate or rate <= 0:
                continue

            latest_by_from[from_currency] = {
                "name": row.get("name"),
                "from_currency": from_currency,
                "to_currency": to_currency,
                "exchange_rate": rate,
                "date": row.get("date"),
            }

        data = [latest_by_from[k] for k in sorted(latest_by_from.keys())]
        return jsonify({"success": True, "data": data})

    except Exception as e:
        logger.error(f"Error al obtener todas las cotizaciones: {str(e)}")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

