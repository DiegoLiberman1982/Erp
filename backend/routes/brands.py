from flask import Blueprint, request, jsonify
import traceback

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para las rutas de brands
brands_bp = Blueprint('brands', __name__)


@brands_bp.route('/api/brands', methods=['GET'])
def get_brands():
    """Obtener lista de marcas disponibles"""
    print("\n--- Petición para obtener marcas ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener marcas
        brands_resp, brands_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Brand",
            params={"fields": '["name", "brand", "description"]', "limit_page_length": 1000},
            operation_name="Get brands"
        )

        if brands_error:
            return handle_erpnext_error(brands_error, "Failed to get brands")

        if brands_resp.status_code != 200:
            print(f"Error obteniendo marcas: {brands_resp.status_code} - {brands_resp.text}")
            return jsonify({"success": False, "message": "Error obteniendo marcas"}), brands_resp.status_code

        brands_data = brands_resp.json().get('data', [])
        print(f"Marcas obtenidas: {len(brands_data)}")

        return jsonify({
            "success": True,
            "data": brands_data
        })

    except Exception as e:
        print(f"Error en get_brands: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@brands_bp.route('/api/brands', methods=['POST'])
def create_brand():
    """Crear una nueva marca"""
    print("\n--- Petición para crear marca ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        print(f"Datos recibidos: {data}")

        # Validar datos requeridos
        if not data.get('brand'):
            return jsonify({"success": False, "message": "Nombre de marca requerido"}), 400

        # Construir el objeto de la marca
        brand_body = {
            "doctype": "Brand",
            "brand": data.get('brand'),
            "description": data.get('description', '')
        }

        # Crear la marca
        create_resp, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Brand",
            data={"data": brand_body},
            operation_name="Create brand"
        )

        if create_error:
            return handle_erpnext_error(create_error, "Failed to create brand")

        if create_resp.status_code not in [200, 201]:
            print(f"Error creando marca: {create_resp.status_code} - {create_resp.text}")
            return jsonify({"success": False, "message": "Error creando marca"}), create_resp.status_code

        created_brand = create_resp.json().get('data', {})
        print(f"Marca creada: {created_brand.get('name')}")

        return jsonify({
            "success": True,
            "data": created_brand
        })

    except Exception as e:
        print(f"Error en create_brand: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500