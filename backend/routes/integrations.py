import json
from copy import deepcopy
from datetime import datetime
from urllib.parse import quote

from flask import Blueprint, jsonify, request

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company
from utils.http_utils import make_erpnext_request, handle_erpnext_error

integrations_bp = Blueprint('integrations', __name__)

# Estructura base para almacenar la configuracion de integraciones por compania
DEFAULT_INTEGRATION_SETTINGS = {
    "apiKey": {
        "lastGeneratedAt": None,
        "lastGeneratedBy": None,
        "notes": ""
    },
    "mercadopago": {
        "enabled": False,
        "publicKey": "",
        "accessToken": "",
        "refreshToken": "",
        "userId": "",
        "webhookSecret": "",
        "testMode": True,
        "additionalInfo": "",
        "reportPrefix": "",
        "reportTimezone": "GMT-03",
        "notificationEmails": "",
        "defaultSyncDays": 3,
        "lastSyncAt": None,
        "lastReportId": "",
        "lastSyncRange": None,
        "lastSyncCount": 0,
        "lastSyncStatus": ""
    },
    "gemini": {
        "enabled": False,
        "apiKey": "",
        "projectId": "",
        "model": "",
        "additionalInfo": ""
    }
}


def _normalize_settings(raw_settings):
    """
    Normaliza la estructura del campo custom almacenado en Company.
    Acepta strings JSON, dicts o None y devuelve el objeto fusionado con los defaults.
    """
    base = deepcopy(DEFAULT_INTEGRATION_SETTINGS)
    parsed = {}

    if isinstance(raw_settings, str):
        raw_settings = raw_settings.strip()
        if raw_settings:
            try:
                parsed = json.loads(raw_settings)
            except json.JSONDecodeError:
                print("Integrations settings: JSON invalido en Company, se ignora")
                parsed = {}
    elif isinstance(raw_settings, dict):
        parsed = raw_settings

    if isinstance(parsed, dict):
        for section_key, section_value in parsed.items():
            if isinstance(section_value, dict):
                if section_key not in base:
                    base[section_key] = section_value
                else:
                    base[section_key].update(section_value)
            else:
                base[section_key] = section_value

    return base


def _serialize_settings(settings_obj):
    """Serializa los datos de integraciones para guardarlos en ERPNext."""
    try:
        return json.dumps(settings_obj, ensure_ascii=False)
    except (TypeError, ValueError):
        return json.dumps(DEFAULT_INTEGRATION_SETTINGS)


def _get_active_company_or_error(user_id):
    """Obtiene la compania activa y devuelve (company, error_response)."""
    company = get_active_company(user_id)
    if not company:
        return None, (jsonify({
            "success": False,
            "message": "No hay una compania activa configurada para el usuario actual"
        }), 400)
    return company, None


@integrations_bp.route('/api/integrations/settings', methods=['GET'])
def get_integration_settings():
    """Obtiene la configuracion de integraciones para la compania activa."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company, company_error = _get_active_company_or_error(user_id)
    if company_error:
        return company_error

    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Company/{quote(company)}",
        params={"fields": json.dumps(["name", "custom_integration_settings"])},
        operation_name=f"Get integration settings for {company}"
    )

    if error:
        return handle_erpnext_error(error, "No se pudo obtener la configuracion de integraciones")

    if not response or response.status_code != 200:
        return jsonify({
            "success": False,
            "message": "ERPNext no devolvio datos de la compania solicitada"
        }), response.status_code if response else 502

    company_data = response.json().get("data", {})
    normalized = _normalize_settings(company_data.get("custom_integration_settings"))

    return jsonify({
        "success": True,
        "data": {
            "company": company,
            "settings": normalized
        }
    })


@integrations_bp.route('/api/integrations/settings', methods=['PUT'])
def update_integration_settings():
    """Actualiza la configuracion de integraciones para la compania activa."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company, company_error = _get_active_company_or_error(user_id)
    if company_error:
        return company_error

    payload = request.get_json(silent=True) or {}
    incoming_settings = payload.get("settings")

    if incoming_settings is None or not isinstance(incoming_settings, dict):
        return jsonify({
            "success": False,
            "message": "El cuerpo de la peticion debe incluir un objeto 'settings'"
        }), 400

    normalized = _normalize_settings(incoming_settings)
    serialized_settings = _serialize_settings(normalized)

    print(f"Actualizando integraciones para {company}")
    update_response, update_error = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/Company/{quote(company)}",
        data={"data": {"custom_integration_settings": serialized_settings}},
        operation_name=f"Update integration settings for {company}"
    )

    if update_error:
        return handle_erpnext_error(update_error, "No se pudo guardar la configuracion de integraciones")

    if not update_response or update_response.status_code not in (200, 202):
        return jsonify({
            "success": False,
            "message": "ERPNext no confirmo la actualizacion solicitada"
        }), update_response.status_code if update_response else 502

    return jsonify({
        "success": True,
        "message": "Configuracion de integraciones guardada",
        "data": {
            "company": company,
            "settings": normalized
        }
    })


@integrations_bp.route('/api/integrations/api-key', methods=['POST'])
def generate_api_key():
    """Genera una API Key/Secret directamente desde ERPNext para el usuario autenticado."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json(silent=True) or {}
    target_user = payload.get("user") or user_id

    # Evitar que se envien valores no validos
    if not isinstance(target_user, str) or not target_user.strip():
        target_user = user_id

    print(f"Generando nueva API Key para el usuario {target_user}")
    generate_response, generate_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.core.doctype.user.user.generate_keys",
        data={"user": target_user},
        operation_name="Generate ERPNext API keys"
    )

    if generate_error:
        return handle_erpnext_error(generate_error, "No se pudo generar la API Key")

    if not generate_response or generate_response.status_code != 200:
        return jsonify({
            "success": False,
            "message": "ERPNext no pudo generar la API Key solicitada"
        }), generate_response.status_code if generate_response else 502

    response_json = generate_response.json() if generate_response else {}
    message = response_json.get("message") or {}

    api_key = message.get("api_key")
    api_secret = message.get("api_secret")

    if not api_key or not api_secret:
        return jsonify({
            "success": False,
            "message": "ERPNext no devolvio credenciales validas"
        }), 502

    generated_at = datetime.utcnow().isoformat() + "Z"

    return jsonify({
        "success": True,
        "message": "API Key generada correctamente. Recuerda guardarla en un lugar seguro.",
        "data": {
            "api_key": api_key,
            "api_secret": api_secret,
            "generated_for": target_user,
            "generated_at": generated_at
        }
    })
