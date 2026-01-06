"""
Rutas para gestión de Tax Account Map (mapeo de cuentas para percepciones/retenciones).

Endpoints:
- GET /api/tax-account-map: Lista mappings por compañía y tipo
- GET /api/tax-account-map/<name>: Obtiene un mapping específico
- PUT /api/tax-account-map/<name>: Actualiza un mapping
- GET /api/tax-account-map/accounts: Lista cuentas del activo (no grupo) para selects
- GET /api/tax-account-map/liability-accounts: Lista cuentas del pasivo para selects

Tipos de perception_type:
- PERCEPCION_IIBB: Percepciones de Ingresos Brutos (compras)
- RETENCION_IIBB: Retenciones de Ingresos Brutos (ventas)
- PERCEPCION_IVA: Percepciones de IVA (compras)
- RETENCION_IVA: Retenciones de IVA (ventas)
- PERCEPCION_GANANCIAS: Percepciones de Ganancias (compras)
- RETENCION_GANANCIAS: Retenciones de Ganancias (ventas)
"""

from flask import Blueprint, request, jsonify
from urllib.parse import quote
import json

from routes.auth_utils import get_session_with_auth
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from config import ERPNEXT_URL
from routes.general import get_smart_limit

tax_account_map_bp = Blueprint('tax_account_map', __name__)


@tax_account_map_bp.route('/api/tax-account-map', methods=['GET'])
def list_tax_account_maps():
    """
    Lista los Tax Account Map filtrados por compañía y opcionalmente por tipo.
    
    Query params:
    - company: (requerido) nombre de la compañía
    - transaction_type: (opcional) 'purchase' o 'sale'
    - perception_type: (opcional) 'PERCEPCION_IIBB', 'RETENCION_IIBB', 'PERCEPCION_IVA', 'RETENCION_IVA', 'PERCEPCION_GANANCIAS', 'RETENCION_GANANCIAS'
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company = request.args.get('company')
    if not company:
        return jsonify({"success": False, "message": "company es requerido"}), 400

    transaction_type = request.args.get('transaction_type')
    perception_type = request.args.get('perception_type')

    # Construir filtros
    filters = [["company", "=", company]]
    if transaction_type:
        filters.append(["transaction_type", "=", transaction_type])
    if perception_type:
        filters.append(["perception_type", "=", perception_type])

    params = {
        "filters": json.dumps(filters),
        "fields": json.dumps([
            "name", "company", "transaction_type", "perception_type",
            "province_code", "regimen_code", "rate_percent",
            "account", "account_number", "description", "active"
        ]),
        "limit_page_length": get_smart_limit(company)
    }

    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Tax Account Map",
        params=params,
        operation_name="List Tax Account Map"
    )

    if error:
        return handle_erpnext_error(error, "Error listando Tax Account Map")

    if response.status_code != 200:
        return jsonify({"success": False, "message": response.text}), response.status_code

    data = response.json().get("data", [])
    return jsonify({"success": True, "data": data})


@tax_account_map_bp.route('/api/tax-account-map/<path:name>', methods=['GET'])
def get_tax_account_map(name):
    """Obtiene un Tax Account Map específico por nombre."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Tax Account Map/{quote(name, safe='')}",
        operation_name="Get Tax Account Map"
    )

    if error:
        return handle_erpnext_error(error, "Error obteniendo Tax Account Map")

    if response.status_code != 200:
        return jsonify({"success": False, "message": response.text}), response.status_code

    data = response.json().get("data", {})
    return jsonify({"success": True, "data": data})


@tax_account_map_bp.route('/api/tax-account-map/<path:name>', methods=['PUT'])
def update_tax_account_map(name):
    """
    Actualiza un Tax Account Map.
    
    Body JSON:
    - account: nombre completo de la cuenta (Link a Account)
    - account_number: (opcional) número de cuenta
    - active: (opcional) 1 o 0
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    body = request.get_json() or {}
    
    # Solo permitir actualizar ciertos campos
    update_data = {}
    if "account" in body:
        update_data["account"] = body["account"]
    if "account_number" in body:
        update_data["account_number"] = body["account_number"]
    if "active" in body:
        update_data["active"] = body["active"]
    if "description" in body:
        update_data["description"] = body["description"]

    if not update_data:
        return jsonify({"success": False, "message": "No hay datos para actualizar"}), 400

    response, error = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/Tax Account Map/{quote(name, safe='')}",
        data={"data": update_data},
        operation_name="Update Tax Account Map"
    )

    if error:
        return handle_erpnext_error(error, "Error actualizando Tax Account Map")

    if response.status_code not in [200, 202]:
        return jsonify({"success": False, "message": response.text}), response.status_code

    data = response.json().get("data", {})
    return jsonify({"success": True, "data": data, "message": "Tax Account Map actualizado"})


@tax_account_map_bp.route('/api/tax-account-map/accounts', methods=['GET'])
def list_accounts_for_tax_map():
    """
    Lista cuentas del activo que no son grupo, para usar en selects.
    
    Query params:
    - company: (requerido) nombre de la compañía
    - search: (opcional) texto para buscar en nombre o número
    - root_type: (opcional) 'Asset', 'Liability', etc. Por defecto 'Asset'
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company = request.args.get('company')
    if not company:
        return jsonify({"success": False, "message": "company es requerido"}), 400

    search = request.args.get('search', '')
    root_type = request.args.get('root_type', 'Asset')

    # Filtros base: no es grupo y pertenece a la compañía
    filters = [
        ["is_group", "=", 0],
        ["company", "=", company],
        ["root_type", "=", root_type]
    ]

    # Si hay búsqueda, agregar filtro OR en nombre o número
    if search:
        # ERPNext no soporta OR en filters simples, usamos or_filters
        or_filters = [
            ["account_number", "like", f"%{search}%"],
            ["account_name", "like", f"%{search}%"],
            ["name", "like", f"%{search}%"]
        ]
        params = {
            "filters": json.dumps(filters),
            "or_filters": json.dumps(or_filters),
            "fields": json.dumps(["name", "account_name", "account_number", "root_type"]),
            "limit_page_length": 50,
            "order_by": "account_number asc"
        }
    else:
        params = {
            "filters": json.dumps(filters),
            "fields": json.dumps(["name", "account_name", "account_number", "root_type"]),
            "limit_page_length": get_smart_limit(company),
            "order_by": "account_number asc"
        }

    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Account",
        params=params,
        operation_name="List Accounts for Tax Map"
    )

    if error:
        return handle_erpnext_error(error, "Error listando cuentas")

    if response.status_code != 200:
        return jsonify({"success": False, "message": response.text}), response.status_code

    data = response.json().get("data", [])
    return jsonify({"success": True, "data": data})


@tax_account_map_bp.route('/api/tax-account-map/liability-accounts', methods=['GET'])
def list_liability_accounts_for_tax_map():
    """
    Lista cuentas del pasivo que no son grupo, para percepciones de venta (que son pasivo).
    
    Query params:
    - company: (requerido) nombre de la compañía
    - search: (opcional) texto para buscar
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company = request.args.get('company')
    if not company:
        return jsonify({"success": False, "message": "company es requerido"}), 400

    search = request.args.get('search', '')

    filters = [
        ["is_group", "=", 0],
        ["company", "=", company],
        ["root_type", "=", "Liability"]
    ]

    if search:
        or_filters = [
            ["account_number", "like", f"%{search}%"],
            ["account_name", "like", f"%{search}%"],
            ["name", "like", f"%{search}%"]
        ]
        params = {
            "filters": json.dumps(filters),
            "or_filters": json.dumps(or_filters),
            "fields": json.dumps(["name", "account_name", "account_number", "root_type"]),
            "limit_page_length": 50,
            "order_by": "account_number asc"
        }
    else:
        params = {
            "filters": json.dumps(filters),
            "fields": json.dumps(["name", "account_name", "account_number", "root_type"]),
            "limit_page_length": get_smart_limit(company),
            "order_by": "account_number asc"
        }

    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Account",
        params=params,
        operation_name="List Liability Accounts for Tax Map"
    )

    if error:
        return handle_erpnext_error(error, "Error listando cuentas de pasivo")

    if response.status_code != 200:
        return jsonify({"success": False, "message": response.text}), response.status_code

    data = response.json().get("data", [])
    return jsonify({"success": True, "data": data})
