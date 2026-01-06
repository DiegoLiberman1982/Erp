from flask import Blueprint, jsonify
import importlib.util
import os
import traceback

from routes.auth_utils import get_session_with_auth


afip_lookup_bp = Blueprint("afip_lookup", __name__)


def _load_provider():
    provider_path = os.getenv("AFIP_LOOKUP_PROVIDER_PATH")
    if not provider_path:
        return None

    if not os.path.isfile(provider_path):
        return None

    spec = importlib.util.spec_from_file_location("afip_lookup_provider", provider_path)
    if spec is None or spec.loader is None:
        return None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@afip_lookup_bp.route("/api/afip/afip-data/<cuit>", methods=["GET"])
def get_afip_data(cuit):
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    provider = _load_provider()
    if provider is None or not hasattr(provider, "lookup_afip_data"):
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Funcion por implementar",
                }
            ),
            501,
        )

    try:
        mapped_data = provider.lookup_afip_data(cuit=cuit, user_id=user_id)
        return jsonify({"success": True, "data": mapped_data})
    except Exception as exc:
        print("AFIP lookup provider error:")
        print(traceback.format_exc())
        if os.getenv("AFIP_LOOKUP_DEBUG", "false").lower() == "true":
            return jsonify({"success": False, "message": str(exc)}), 500
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500
