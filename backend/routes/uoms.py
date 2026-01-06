from flask import Blueprint, request, jsonify
import traceback
from routes.auth_utils import get_session_with_auth
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from config import ERPNEXT_URL

uoms_bp = Blueprint('uoms', __name__)

@uoms_bp.route('/api/inventory/uoms', methods=['GET', 'OPTIONS'])
def get_uoms():
    """Obtener lista de unidades de medida (UOM) disponibles"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        params = {
            "fields": '["name", "uom_name", "must_be_whole_number", "enabled"]',
            "filters": '[["enabled", "=", 1]]',
            "limit_page_length": 999,
            "order_by": "uom_name asc"
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/UOM",
            params=params,
            operation_name="Get UOMs"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get UOMs")

        uoms = response.json().get('data', [])

        return jsonify({
            "success": True,
            "data": uoms
        })

    except Exception as e:
        print(f"Error en get_uoms: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@uoms_bp.route('/api/inventory/uoms', methods=['POST', 'OPTIONS'])
def create_uom():
    """Crear una nueva unidad de medida (UOM)"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print(f"\n--- Petición para crear UOM ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        print(f"Datos recibidos: {data}")

        uom_name = data.get('uom_name')
        must_be_whole_number = data.get('must_be_whole_number', 0)
        enabled = data.get('enabled', 1)

        if not uom_name:
            return jsonify({"success": False, "message": "El nombre de la unidad de medida es requerido"}), 400

        # Verificar si ya existe una UOM con ese nombre
        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/UOM",
            params={
                "filters": f'[["uom_name", "=", "{uom_name}"]]',
                "fields": '["name"]'
            },
            operation_name="Check UOM Existence"
        )

        if not check_error and check_response.status_code == 200:
            existing_uoms = check_response.json().get('data', [])
            if existing_uoms:
                return jsonify({"success": False, "message": f"Ya existe una unidad de medida con el nombre '{uom_name}'"}), 400

        # Crear la nueva UOM
        uom_body = {
            "uom_name": uom_name,
            "must_be_whole_number": must_be_whole_number,
            "enabled": enabled
        }

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/UOM",
            data={"data": uom_body},
            operation_name="Create UOM"
        )

        if error:
            return handle_erpnext_error(error, "Failed to create UOM")

        created_uom = response.json().get('data', {})
        print(f"UOM creada: {created_uom.get('name')}")

        return jsonify({
            "success": True,
            "data": created_uom
        })

    except Exception as e:
        print(f"Error en create_uom: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500