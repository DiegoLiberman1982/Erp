from flask import Blueprint, request, jsonify
import json
import traceback
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar función para obtener sigla de compañía
from routes.general import get_active_company, get_company_abbr, add_company_abbr, get_smart_limit

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para las rutas de grupos
groups_bp = Blueprint('groups', __name__)


@groups_bp.route('/api/supplier-groups', methods=['GET', 'OPTIONS'])
def get_supplier_groups():
    """Obtener lista de grupos de proveedores"""

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    print("\n--- Petición para obtener grupos de proveedores ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company_name = request.args.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400

        # Obtener grupos de proveedores desde ERPNext
        fields = '["name", "supplier_group_name", "parent_supplier_group", "old_parent", "is_group", "custom_company"]'
        # Traer TODOS los grupos sin filtro (ERPNext no filtra bien custom fields en documentos legacy)
        params = {
            "fields": fields,
            "limit_page_length": get_smart_limit(company_name, operation_type='list'),
            "order_by": "supplier_group_name asc"
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Supplier Group",
            params=params,
            operation_name="Get Supplier Groups"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get supplier groups")

        groups = response.json().get('data', [])
        print(f"Grupos totales de ERPNext (antes de filtrar): {len(groups)}")
        
        # FILTRO EN PYTHON: solo grupos con custom_company == company_name (excluye All Supplier Groups y otros legacy)
        groups = [g for g in groups if g.get("custom_company") == company_name]
        print(f"Grupos de proveedores filtrados por company '{company_name}': {len(groups)}")

        return jsonify({
            "success": True,
            "data": groups
        })

    except Exception as e:
        print(f"Error en get_supplier_groups: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@groups_bp.route('/api/supplier-groups', methods=['POST', 'OPTIONS'])
def create_supplier_group():
    """Crear un nuevo grupo de proveedores"""

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    print(f"\n--- Petición para crear grupo de proveedores ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        payload = data.get('data') if isinstance(data, dict) and isinstance(data.get('data'), dict) else data
        print(f"Datos recibidos: {payload}")

        supplier_group_name = (payload.get('supplier_group_name') or '').strip()
        parent_supplier_group = payload.get('parent_supplier_group')
        is_group = payload.get('is_group', 0)
        company_name = payload.get('custom_company') or get_active_company(user_id)

        if not supplier_group_name:
            return jsonify({"success": False, "message": "Se requiere el nombre del grupo"}), 400
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400

        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compania '{company_name}'"}), 400

        canonical_group_name = add_company_abbr(supplier_group_name, company_abbr)

        # Verificar si ya existe un grupo con ese nombre
        check_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Supplier Group",
            params={
                "filters": json.dumps([
                    ["supplier_group_name", "=", canonical_group_name],
                    ["custom_company", "=", company_name]
                ]),
                "fields": '["name"]'
            },
            operation_name="Check Existing Supplier Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to check existing supplier group")

        if check_response.status_code == 200:
            existing_groups = check_response.json().get('data', [])
            if existing_groups:
                return jsonify({"success": False, "message": f"Ya existe un grupo de proveedores con el nombre '{canonical_group_name}'"}), 400

        # Crear el nuevo grupo de proveedores
        group_body = {
            "supplier_group_name": canonical_group_name,
            "parent_supplier_group": parent_supplier_group,
            "is_group": is_group,
            "custom_company": company_name
        }

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Supplier Group",
            data={"data": group_body},
            operation_name="Create Supplier Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to create supplier group")

        created_group = response.json().get('data', {})
        print(f"Grupo de proveedores creado: {created_group.get('name')}")

        return jsonify({
            "success": True,
            "data": created_group
        })

    except Exception as e:
        print(f"Error en create_supplier_group: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@groups_bp.route('/api/customer-groups', methods=['GET', 'OPTIONS'])
def get_customer_groups():
    """Obtener lista de grupos de clientes"""

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    print("\n--- Petición para obtener grupos de clientes ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company_name = request.args.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400

        # Obtener grupos de clientes desde ERPNext
        fields = '["name", "customer_group_name", "parent_customer_group", "old_parent", "is_group", "custom_company"]'
        # Traer TODOS los grupos sin filtro (ERPNext no filtra bien custom fields en documentos legacy)
        params = {
            "fields": fields,
            "limit_page_length": get_smart_limit(company_name, operation_type='list'),
            "order_by": "customer_group_name asc"
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Customer Group",
            params=params,
            operation_name="Get Customer Groups"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get customer groups")

        groups = response.json().get('data', [])
        print(f"Grupos totales de ERPNext (antes de filtrar): {len(groups)}")
        
        # FILTRO EN PYTHON: solo grupos con custom_company == company_name (excluye All Customer Groups y otros legacy)
        groups = [g for g in groups if g.get("custom_company") == company_name]
        print(f"Grupos de clientes filtrados por company '{company_name}': {len(groups)}")

        return jsonify({
            "success": True,
            "data": groups
        })

    except Exception as e:
        print(f"Error en get_customer_groups: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@groups_bp.route('/api/customer-groups', methods=['POST', 'OPTIONS'])
def create_customer_group():
    """Crear un nuevo grupo de clientes"""

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    print(f"\n--- Petición para crear grupo de clientes ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        payload = data.get('data') if isinstance(data, dict) and isinstance(data.get('data'), dict) else data
        print(f"Datos recibidos: {payload}")

        customer_group_name = (payload.get('customer_group_name') or '').strip()
        parent_customer_group = payload.get('parent_customer_group')
        is_group = payload.get('is_group', 0)
        company_name = payload.get('custom_company') or get_active_company(user_id)

        if not customer_group_name:
            return jsonify({"success": False, "message": "Se requiere el nombre del grupo"}), 400
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400

        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compania '{company_name}'"}), 400

        canonical_group_name = add_company_abbr(customer_group_name, company_abbr)

        # Verificar si ya existe un grupo con ese nombre
        check_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Customer Group",
            params={
                "filters": json.dumps([
                    ["customer_group_name", "=", canonical_group_name],
                    ["custom_company", "=", company_name]
                ]),
                "fields": '["name"]'
            },
            operation_name="Check Existing Customer Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to check existing customer group")

        if check_response.status_code == 200:
            existing_groups = check_response.json().get('data', [])
            if existing_groups:
                return jsonify({"success": False, "message": f"Ya existe un grupo de clientes con el nombre '{canonical_group_name}'"}), 400

        # Crear el nuevo grupo de clientes
        group_body = {
            "customer_group_name": canonical_group_name,
            "parent_customer_group": parent_customer_group,
            "is_group": is_group,
            "custom_company": company_name
        }

        if payload.get('default_price_list') is not None:
            group_body['default_price_list'] = payload.get('default_price_list')
        if payload.get('payment_terms') is not None:
            group_body['payment_terms'] = payload.get('payment_terms')

        accounts_payload = payload.get('accounts')
        if isinstance(accounts_payload, list):
            normalized_accounts = []
            for account_entry in accounts_payload:
                if not isinstance(account_entry, dict):
                    continue
                normalized_accounts.append({
                    **account_entry,
                    "parent": canonical_group_name,
                    "company": account_entry.get("company") or company_name
                })
            if normalized_accounts:
                group_body['accounts'] = normalized_accounts

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Customer Group",
            data={"data": group_body},
            operation_name="Create Customer Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to create customer group")

        created_group = response.json().get('data', {})
        print(f"Grupo de clientes creado: {created_group.get('name')}")

        return jsonify({
            "success": True,
            "data": created_group
        })

    except Exception as e:
        print(f"Error en create_customer_group: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

