from flask import Blueprint, jsonify, request
import json
from urllib.parse import quote

from config import SITE_BASE_URL
from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_smart_limit
from utils.http_utils import make_erpnext_request, handle_erpnext_error

system_settings_bp = Blueprint('system_settings', __name__)

SYSTEM_SETTINGS_FIELDS = [
    "app_name",
    "country",
    "language",
    "time_zone",
    "currency",
    "enable_onboarding",
    "setup_complete",
    "disable_document_sharing",
    "date_format",
    "time_format",
    "number_format",
    "use_number_format_from_currency",
    "first_day_of_the_week",
    "float_precision",
    "currency_precision",
    "rounding_method",
    "apply_strict_user_permissions",
    "allow_older_web_view_links",
    "session_expiry",
    "document_share_key_expiry",
    "deny_multiple_sessions",
    "welcome_email_template",
    "reset_password_template",
]

GLOBAL_DEFAULT_FIELDS = [
    "default_currency",
    "country",
    "default_distance_unit",
]

CHECKBOX_FIELDS = {
    "enable_onboarding",
    "setup_complete",
    "disable_document_sharing",
    "use_number_format_from_currency",
    "apply_strict_user_permissions",
    "allow_older_web_view_links",
    "deny_multiple_sessions",
}


def _normalize_checks(payload: dict) -> dict:
    """Convertir campos de check a 0/1 para ERPNext."""
    normalized = {}
    for key, value in payload.items():
        if key in CHECKBOX_FIELDS:
            normalized[key] = 1 if str(value).lower() in ("1", "true", "yes", "on") else 0
        else:
            normalized[key] = value
    return normalized


def _extract_select_options(meta_fields, target_fields):
    options = {}
    if not meta_fields:
        return options

    for field in meta_fields:
        fname = field.get("fieldname")
        if fname in target_fields and field.get("fieldtype") == "Select":
            raw_options = field.get("options") or ""
            cleaned = [opt.strip() for opt in raw_options.split("\n") if opt.strip()]
            options[fname] = cleaned
    return options


def _map_link_targets(meta_fields):
    link_map = {}
    if not meta_fields:
        return link_map
    for field in meta_fields:
        if field.get("fieldtype") == "Link" and field.get("fieldname"):
            link_map[field["fieldname"]] = field.get("options")
    return link_map


def _fetch_doc_with_fields(session, headers, endpoint, params, operation_name):
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=endpoint,
        params=params,
        operation_name=operation_name
    )
    if error:
        return None, error
    if response.status_code != 200:
        return None, {
            "success": False,
            "message": f"Error {response.status_code}",
            "status_code": response.status_code,
        }
    return response.json().get("data", {}), None


def _fetch_linked_names(session, headers, doctype, company_name, operation_name):
    """Recupera solo el campo name para un doctype enlazado usando el smart limit."""
    limit = get_smart_limit(company_name, "list")
    params = {
        "fields": json.dumps(["name"]),
        "limit_page_length": limit,
    }
    data, error = _fetch_doc_with_fields(
        session,
        headers,
        f"/api/resource/{quote(doctype)}",
        params,
        operation_name,
    )
    if error:
        return []
    records = data if isinstance(data, list) else data.get("data", [])
    if isinstance(records, list):
        return [row.get("name") for row in records if row.get("name")]
    return []


def _load_system_settings(session, headers):
    params = {"fields": json.dumps(SYSTEM_SETTINGS_FIELDS)}
    data, error = _fetch_doc_with_fields(
        session,
        headers,
        f"/api/resource/System Settings/{quote('System Settings')}",
        params,
        "Load System Settings",
    )
    if error:
        return None, error

    for check_field in CHECKBOX_FIELDS:
        if check_field in data:
            data[check_field] = bool(data.get(check_field))
    return data, None


def _load_global_defaults(session, headers):
    params = {"fields": json.dumps(GLOBAL_DEFAULT_FIELDS)}
    data, error = _fetch_doc_with_fields(
        session,
        headers,
        f"/api/resource/Global Defaults/{quote('Global Defaults')}",
        params,
        "Load Global Defaults",
    )
    if error:
        return None, error
    return data, None


def _load_docfield_meta(session, headers, doctype, operation_name):
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/DocType/{quote(doctype)}",
        operation_name=operation_name,
    )
    if error or not response or response.status_code != 200:
        return []
    return response.json().get("data", {}).get("fields", [])


def _fetch_timezones(session, headers):
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/method/frappe.core.doctype.user.user.get_timezones",
        operation_name="Get Timezones",
    )
    if error or not response or response.status_code != 200:
        return []
    payload = response.json()
    if isinstance(payload, dict):
        return payload.get("message", []) or []
    return []


def _fetch_languages(session, headers, company_name):
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/method/frappe.core.doctype.language.language.get_languages",
        operation_name="Get Languages",
    )
    if not error and response and response.status_code == 200:
        payload = response.json().get("message") or []
        if isinstance(payload, list):
            langs = []
            for item in payload:
                if isinstance(item, dict):
                    langs.append(item.get("language_name") or item.get("name"))
                elif isinstance(item, str):
                    langs.append(item)
            return [lang for lang in langs if lang]

    # Fallback: list Language doctype entries
    return _fetch_linked_names(
        session,
        headers,
        "Language",
        company_name,
        "List Languages (fallback)",
    )


def _get_languages_raw(session, headers):
    """Return raw language items from ERPNext get_languages method (if available)

    This helps resolving display labels into language record names/codes (eg. 'es-AR').
    """
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/method/frappe.core.doctype.language.language.get_languages",
        operation_name="Get Languages Raw",
    )
    if error or not response or response.status_code != 200:
        return []
    payload = response.json().get("message") or []
    if isinstance(payload, list):
        return payload
    return []


def _build_options(session, headers, user_id):
    company_name = get_active_company(user_id)
    system_meta_fields = _load_docfield_meta(
        session, headers, "System Settings", "Load System Settings Meta"
    )
    global_meta_fields = _load_docfield_meta(
        session, headers, "Global Defaults", "Load Global Defaults Meta"
    )

    select_field_names = {
        "time_zone",
        "date_format",
        "time_format",
        "number_format",
        "first_day_of_the_week",
        "float_precision",
        "currency_precision",
        "rounding_method",
        "default_distance_unit",
    }

    select_options = {}
    select_options.update(_extract_select_options(system_meta_fields, select_field_names))
    select_options.update(_extract_select_options(global_meta_fields, select_field_names))

    link_targets = {}
    link_targets.update(_map_link_targets(system_meta_fields))
    link_targets.update(_map_link_targets(global_meta_fields))

    options = {
        "time_zones": select_options.get("time_zone") or _fetch_timezones(session, headers),
        "date_formats": select_options.get("date_format", []),
        "time_formats": select_options.get("time_format", []),
        "number_formats": select_options.get("number_format", []),
        "first_day_of_the_week": select_options.get("first_day_of_the_week", []),
        "float_precision": select_options.get("float_precision", []),
        "currency_precision": select_options.get("currency_precision", []),
        "rounding_method": select_options.get("rounding_method", []),
        "distance_units": select_options.get("default_distance_unit", []),
        "languages": _fetch_languages(session, headers, company_name),
        "countries": [],
        "currencies": [],
        "email_templates": [],
    }

    country_doctype = link_targets.get("country", "Country")
    currency_doctype = link_targets.get("currency", "Currency")
    distance_link_doctype = link_targets.get("default_distance_unit")
    email_template_doctype = link_targets.get("welcome_email_template", "Email Template")

    options["countries"] = _fetch_linked_names(
        session,
        headers,
        country_doctype,
        company_name,
        f"List {country_doctype} for System Settings",
    )
    options["currencies"] = _fetch_linked_names(
        session,
        headers,
        currency_doctype,
        company_name,
        f"List {currency_doctype} for System Settings",
    )
    options["email_templates"] = _fetch_linked_names(
        session,
        headers,
        email_template_doctype,
        company_name,
        "List Email Templates",
    )

    if distance_link_doctype:
        options["distance_units"] = _fetch_linked_names(
            session,
            headers,
            distance_link_doctype,
            company_name,
            "List Distance Units",
        ) or options["distance_units"]

    return options


def _update_system_settings(session, headers, payload):
    # Normalize checks and sanitize language entries
    normalized_payload = _normalize_checks(payload)

    # Resolve language display labels into language record name/code when possible
    lang_val = normalized_payload.get("language")
    if lang_val and isinstance(lang_val, str):
        # if already looks like a code such as 'es-AR', keep it
        import re
        if not re.match(r'^[a-z]{2}(-[A-Z]{2})?$', lang_val):
            # attempt to resolve via get_languages raw output
            try:
                raw_langs = _get_languages_raw(session, headers)
                resolved = None
                for item in raw_langs:
                    if isinstance(item, dict):
                        # common properties: value, label, name, language_name
                        if (item.get('label') == lang_val or item.get('language_name') == lang_val or item.get('name') == lang_val):
                            resolved = item.get('value') or item.get('name')
                            break
                    elif isinstance(item, str) and item == lang_val:
                        resolved = item
                        break
                if resolved:
                    normalized_payload['language'] = resolved
            except Exception:
                # If anything fails, keep the original value and allow ERPNext to validate
                pass

    body = {"data": normalized_payload}
    response, error = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/System Settings/{quote('System Settings')}",
        data=body,
        operation_name="Update System Settings",
    )
    if error:
        return handle_erpnext_error(error, "Error actualizando System Settings")
    if response.status_code not in (200, 202):
        return jsonify({"success": False, "message": response.text}), response.status_code
    return None


def _update_global_defaults(session, headers, payload):
    response, error = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/Global Defaults/{quote('Global Defaults')}",
        data={"data": payload},
        operation_name="Update Global Defaults",
    )
    if error:
        return handle_erpnext_error(error, "Error actualizando Global Defaults")
    if response.status_code not in (200, 202):
        return jsonify({"success": False, "message": response.text}), response.status_code
    return None


def _filter_payload(source, allowed_fields):
    return {key: value for key, value in (source or {}).items() if key in allowed_fields}


@system_settings_bp.route('/api/system-settings', methods=['GET'])
def get_system_settings_route():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    system_settings, error = _load_system_settings(session, headers)
    if error:
        return handle_erpnext_error(error, "No se pudieron cargar System Settings")

    global_defaults, error = _load_global_defaults(session, headers)
    if error:
        return handle_erpnext_error(error, "No se pudieron cargar Global Defaults")

    options = _build_options(session, headers, user_id)

    return jsonify({
        "success": True,
        "data": {
            "system_settings": system_settings,
            "global_defaults": global_defaults,
            "options": options,
            "site_base_url": SITE_BASE_URL,
        }
    })


@system_settings_bp.route('/api/system-settings', methods=['POST'])
def update_system_settings_route():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json(silent=True) or {}
    system_payload = _filter_payload(payload.get("system_settings", {}), SYSTEM_SETTINGS_FIELDS)
    global_payload = _filter_payload(payload.get("global_defaults", {}), GLOBAL_DEFAULT_FIELDS)

    if not system_payload and not global_payload:
        return jsonify({"success": False, "message": "No se enviaron datos para actualizar"}), 400

    if system_payload:
        error = _update_system_settings(session, headers, system_payload)
        if error:
            return error

    if global_payload:
        error = _update_global_defaults(session, headers, global_payload)
        if error:
            return error

    updated_settings, _ = _load_system_settings(session, headers)
    updated_defaults, _ = _load_global_defaults(session, headers)

    return jsonify({
        "success": True,
        "message": "Configuraci�n de sistema actualizada",
        "data": {
            "system_settings": updated_settings,
            "global_defaults": updated_defaults,
        }
    })


def apply_initial_system_settings(session, headers, company_name=None):
    """Aplicar valores base al crear/terminar la configuraci�n inicial."""
    # Use language code (name of Language record) instead of human-readable label
    # ERPNext expects the Language 'name' (eg. 'es-AR'), not the display label.
    defaults = {
        "currency": "ARS",
        "country": "Argentina",
        "time_zone": "America/Argentina/Buenos_Aires",
        "language": "es-AR",
        "deny_multiple_sessions": 1,
        "setup_complete": 1,
    }
    if SITE_BASE_URL:
        defaults.setdefault("app_name", SITE_BASE_URL)

    global_defaults = {
        "default_currency": "ARS",
        "country": "Argentina",
    }

    errors = []

    sys_error = _update_system_settings(session, headers, defaults)
    if sys_error:
        errors.append("System Settings")

    glob_error = _update_global_defaults(session, headers, global_defaults)
    if glob_error:
        errors.append("Global Defaults")

    success = not errors
    return {
        "success": success,
        "message": "Valores iniciales aplicados" if success else f"Errores al aplicar: {', '.join(errors)}",
        "applied": {
            "system_settings": defaults,
            "global_defaults": global_defaults,
        }
    }
