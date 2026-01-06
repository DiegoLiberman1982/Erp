from flask import Blueprint, request, jsonify
from urllib.parse import quote
import json

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar utilidades generales
from routes.general import get_company_abbr, get_active_company, remove_company_abbr, add_company_abbr, get_smart_limit

# Crear el blueprint para rutas de expense mapping
expense_mapping_bp = Blueprint('expense_mapping', __name__)


@expense_mapping_bp.route('/api/expense-mappings', methods=['GET'])
def get_expense_mappings():
    """Obtener mapeos de cuentas de gastos"""
    print("\n--- Obteniendo mapeos de cuentas de gastos ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No se encontró compañía activa"}), 400
        
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": "No se pudo obtener abreviatura de la compañía"}), 400
        
        # Obtener límite inteligente
        limit = get_smart_limit(company)
        
        # Obtener todos los mapeos
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Expense Account Mapping",
            params={
                "fields": json.dumps(["name", "cuenta_contable", "desde", "hasta", "nombre", "usage_context", "mode_of_payment", "direction", "priority", "company"]),
                "filters": json.dumps([["company", "=", company]]),
                "limit_page_length": limit
            },
            operation_name="Get Expense Mappings"
        )
        
        if error:
            return handle_erpnext_error(error, "Failed to fetch expense mappings")
        
        if response.status_code != 200:
            return jsonify({"success": False, "message": "Error al obtener mapeos"}), response.status_code
        
        data = response.json().get("data", [])
        
        # Obtener account_names para las cuentas
        cuentas_unicas = set()
        for mapping in data:
            cuenta = mapping.get("cuenta_contable", "")
            if cuenta:
                cuentas_unicas.add(cuenta)
        
        account_names = {}
        if cuentas_unicas:
            cuentas_list = list(cuentas_unicas)
            accounts_response, accounts_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Account",
                params={
                    "fields": json.dumps(["name", "account_name"]),
                    "filters": json.dumps([["name", "in", cuentas_list]]),
                    "limit_page_length": len(cuentas_list)
                },
                operation_name="Get Account Names"
            )
            if not accounts_error and accounts_response.status_code == 200:
                accounts_data = accounts_response.json().get("data", [])
                for acc in accounts_data:
                    account_names[acc["name"]] = acc["account_name"]
        
        # Remover abbr de las cuentas para mostrar en frontend
        filtered_data = []
        for mapping in data:
            cuenta = mapping.get("cuenta_contable", "")
            account_name = account_names.get(cuenta, "")
            # Usar account_name si existe, sino remover abbr del name
            display_name = account_name or remove_company_abbr(cuenta, company_abbr)
            mapping["cuenta_contable"] = display_name
            mapping["cuenta_contable_name"] = cuenta  # Guardar el name completo para edición
            filtered_data.append(mapping)
        
        print(f"--- Expense Mappings: found {len(filtered_data)} for company {company}")
        return jsonify({"success": True, "data": filtered_data})
        
    except Exception as e:
        print(f"--- Expense Mappings: error - {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@expense_mapping_bp.route('/api/expense-mappings', methods=['POST'])
def create_expense_mapping():
    """Crear nuevo mapeo de cuenta de gastos"""
    print("\n--- Creando mapeo de cuenta de gastos ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.json
        company = get_active_company(user_id)
        
        if not company:
            return jsonify({"success": False, "message": "No se encontró compañía activa"}), 400
        
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": "No se pudo obtener abreviatura de la compañía"}), 400
        
        # Agregar abbr a la cuenta contable
        cuenta_contable = data.get("cuenta_contable", "")
        if cuenta_contable:
            data["cuenta_contable"] = add_company_abbr(cuenta_contable, company_abbr)
        
        # Agregar company
        data["company"] = company
        
        # Crear el mapeo
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Expense Account Mapping",
            data={"data": data},
            operation_name="Create Expense Mapping"
        )
        
        if error:
            return handle_erpnext_error(error, "Failed to create expense mapping")
        
        if response.status_code not in [200, 201]:
            return jsonify({"success": False, "message": "Error al crear mapeo"}), response.status_code
        
        result = response.json().get("data", {})
        
        # Remover abbr antes de devolver al frontend
        if result.get("cuenta_contable"):
            result["cuenta_contable"] = remove_company_abbr(result["cuenta_contable"], company_abbr)
        
        print("--- Expense Mapping: created successfully")
        return jsonify({"success": True, "data": result})
        
    except Exception as e:
        print(f"--- Expense Mapping: error - {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@expense_mapping_bp.route('/api/expense-mappings/<path:mapping_name>', methods=['GET'])
def get_expense_mapping(mapping_name):
    """Obtener un mapeo específico"""
    print(f"\n--- Obteniendo mapeo: {mapping_name} ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No se encontró compañía activa"}), 400
        
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": "No se pudo obtener abreviatura de la compañía"}), 400
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Expense Account Mapping/{quote(mapping_name)}",
            operation_name=f"Get Expense Mapping {mapping_name}"
        )
        
        if error:
            return handle_erpnext_error(error, f"Failed to fetch expense mapping {mapping_name}")
        
        if response.status_code != 200:
            return jsonify({"success": False, "message": "Error al obtener mapeo"}), response.status_code
        
        result = response.json().get("data", {})
        
        # Remover abbr de la cuenta
        if result.get("cuenta_contable"):
            result["cuenta_contable"] = remove_company_abbr(result["cuenta_contable"], company_abbr)
        
        print(f"--- Expense Mapping: found {mapping_name}")
        return jsonify({"success": True, "data": result})
        
    except Exception as e:
        print(f"--- Expense Mapping: error - {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@expense_mapping_bp.route('/api/expense-mappings/<path:mapping_name>', methods=['PUT'])
def update_expense_mapping(mapping_name):
    """Actualizar mapeo de cuenta de gastos"""
    print(f"\n--- Actualizando mapeo: {mapping_name} ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.json
        company = get_active_company(user_id)
        
        if not company:
            return jsonify({"success": False, "message": "No se encontró compañía activa"}), 400
        
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": "No se pudo obtener abreviatura de la compañía"}), 400
        
        # Agregar abbr a la cuenta contable si está presente
        cuenta_contable = data.get("cuenta_contable", "")
        if cuenta_contable:
            data["cuenta_contable"] = add_company_abbr(cuenta_contable, company_abbr)
        
        # Asegurar company
        data["company"] = company
        
        # Actualizar el mapeo
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Expense Account Mapping/{quote(mapping_name)}",
            data={"data": data},
            operation_name=f"Update Expense Mapping {mapping_name}"
        )
        
        if error:
            return handle_erpnext_error(error, f"Failed to update expense mapping {mapping_name}")
        
        if response.status_code != 200:
            return jsonify({"success": False, "message": "Error al actualizar mapeo"}), response.status_code
        
        result = response.json().get("data", {})
        
        # Remover abbr antes de devolver al frontend
        if result.get("cuenta_contable"):
            result["cuenta_contable"] = remove_company_abbr(result["cuenta_contable"], company_abbr)
        
        print(f"--- Expense Mapping: updated {mapping_name}")
        return jsonify({"success": True, "data": result})
        
    except Exception as e:
        print(f"--- Expense Mapping: error - {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@expense_mapping_bp.route('/api/expense-mappings/<path:mapping_name>', methods=['DELETE'])
def delete_expense_mapping(mapping_name):
    """Eliminar mapeo de cuenta de gastos"""
    print(f"\n--- Eliminando mapeo: {mapping_name} ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Expense Account Mapping/{quote(mapping_name)}",
            operation_name=f"Delete Expense Mapping {mapping_name}"
        )
        
        if error:
            return handle_erpnext_error(error, f"Failed to delete expense mapping {mapping_name}")
        
        if response.status_code not in [200, 202]:
            return jsonify({"success": False, "message": "Error al eliminar mapeo"}), response.status_code
        
        print(f"--- Expense Mapping: deleted {mapping_name}")
        return jsonify({"success": True, "message": "Mapeo eliminado correctamente"})
        
    except Exception as e:
        print(f"--- Expense Mapping: error - {e}")
        return jsonify({"success": False, "message": str(e)}), 500
