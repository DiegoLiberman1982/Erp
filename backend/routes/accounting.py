from flask import Blueprint, request, jsonify
import os
import requests
import json
from urllib.parse import quote
from collections import defaultdict

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar funciones de companies.py para evitar duplicación
from routes.companies import get_fiscal_year_for_company

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr, get_active_company, get_company_default_currency

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para las rutas de contabilidad
accounting_bp = Blueprint('accounting', __name__)

VOUCHER_DOCTYPE_MAPPING = {
    "Journal Entry": "Journal Entry",
    "Sales Invoice": "Sales Invoice",
    "Purchase Invoice": "Purchase Invoice",
    "Payment Entry": "Payment Entry",
    "Stock Entry": "Stock Entry",
    "Delivery Note": "Delivery Note",
    "Purchase Receipt": "Purchase Receipt",
    "Bank Transaction": "Bank Transaction"
}

FRAPPE_LIST_LIMIT = 1000
VOUCHER_BATCH_SIZE = 200


def _chunk_list(items, chunk_size):
    """Yield chunks of a list to keep payloads bounded."""
    for idx in range(0, len(items), chunk_size):
        yield items[idx:idx + chunk_size]


def fetch_voucher_metadata_batch(session, voucher_map, operation_context):
    """
    Fetch docstatus (and optional title) for many vouchers using frappe.client.get_list.

    Args:
        session: Authenticated ERPNext session.
        voucher_map: dict mapping voucher_type -> iterable of voucher numbers.
        operation_context: String used for logging context.
    """
    if not voucher_map:
        return {}

    voucher_metadata = {}

    for voucher_type, names in voucher_map.items():
        if not voucher_type or not names:
            continue

        doctype = VOUCHER_DOCTYPE_MAPPING.get(voucher_type, voucher_type)
        include_title = voucher_type == "Journal Entry"
        fields = ["name", "docstatus"]
        if include_title:
            fields.append("title")

        name_list = [name for name in set(names) if name]
        if not name_list:
            continue

        for chunk in _chunk_list(name_list, VOUCHER_BATCH_SIZE):
            payload = {
                "doctype": doctype,
                "fields": fields,
                "filters": {
                    "name": ["in", chunk]
                },
                "limit_page_length": FRAPPE_LIST_LIMIT
            }
            response, error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.get_list",
                data=payload,
                operation_name=f"Batch fetch {operation_context} ({doctype})"
            )

            if error or not response or response.status_code != 200:
                print(f"--- Advertencia: no se pudo obtener metadata para {doctype} ({error or response.status_code})")
                continue

            payload_data = response.json() if response else {}
            rows = payload_data.get("message")
            if rows is None:
                rows = payload_data.get("data", [])

            for row in rows:
                name = row.get("name")
                if not name:
                    continue
                docstatus = row.get("docstatus", 1)
                if include_title:
                    title = row.get("title") or f"{voucher_type} {name}"
                else:
                    title = f"{voucher_type} {name}"
                voucher_metadata[name] = {
                    "docstatus": docstatus,
                    "title": title
                }

    return voucher_metadata

def get_latest_fiscal_year(session, headers):
    """Helper function to get the most recent fiscal year"""
    try:
        fields = '["name"]'
        fy_response, fy_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Fiscal%20Year",
            params={
                "fields": fields,
                "order_by": "year_start_date desc",
                "limit_page_length": 1
            },
            operation_name="Get latest fiscal year"
        )

        if fy_error:
            print("--- Año fiscal: error")
            return None

        if fy_response.status_code == 200:
            fy_data = fy_response.json()
            fiscal_years = fy_data.get("data", [])
            if fiscal_years:
                fiscal_year = fiscal_years[0]["name"]
                print("--- Año fiscal: ok")
                return fiscal_year
    except Exception as e:
        print("--- Año fiscal: error")
    return None

@accounting_bp.route('/api/accounts', methods=['GET'])
def get_accounts():
    """Obtiene la lista de cuentas contables desde ERPNext filtradas por compañía activa"""
    print("\n--- Petición de obtener cuentas contables recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener parámetros de búsqueda
    search_query = request.args.get('search', '')
    limit = request.args.get('limit', '1000')
    root_type = request.args.get('root_type', '')  # Nuevo parámetro opcional para filtrar por tipo

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            print("--- Cuentas contables: error")
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        # Obtener la compañía activa del usuario usando el sistema local
        print("--- Cuentas contables: procesando")

        try:
            # Obtener la compañía activa del usuario usando función centralizada
            active_company = get_active_company(user_id)

            if not active_company:
                print("--- Cuentas contables: error")
                return jsonify({"success": False, "message": "No hay empresa activa configurada"}), 400
        except Exception as company_err:
            print("--- Cuentas contables: error")
            return jsonify({"success": False, "message": "Error al obtener configuración de empresa"}), 500

        # Construir los filtros como JSON y luego convertirlos a string para URL
        filters = [["company", "=", active_company]]
        if search_query:
            # Buscar por nombre de cuenta o código
            filters.append(["account_name", "like", f"%{search_query}%"])
        if root_type:
            # Filtrar por tipo de cuenta (Asset, Liability, Income, Expense, Equity)
            filters.append(["root_type", "=", root_type])

        # Convertir filtros a JSON string
        import json
        filters_json = json.dumps(filters)

        # Usar GET con filtros en query parameters
        fields = '["name","account_name","account_number","parent_account","company","root_type","report_type","is_group","account_currency","account_type"]'

        # Hacer la petición GET a ERPNext para obtener las cuentas
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Account",
            params={
                "fields": fields,
                "filters": filters_json,
                "limit_page_length": limit
            },
            operation_name="Get accounts"
        )

        if error:
            print("--- Cuentas contables: error")
            return jsonify({"success": False, "message": f"Error al obtener cuentas contables: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401

        response.raise_for_status()

        accounts_data = response.json()
        accounts = accounts_data.get("data", [])

        print(f"--- Cuentas contables: {len(accounts)} registros")

        return jsonify({"success": True, "data": accounts})

    except requests.exceptions.HTTPError as err:
        print("--- Cuentas contables: error")
        return jsonify({"success": False, "message": "Error al obtener cuentas contables"}), 500
    except Exception as err:
        print("--- Cuentas contables: error")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Cuentas contables: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/cost-centers', methods=['GET'])
def get_cost_centers():
    """Obtiene la lista de centros de costo desde ERPNext filtrados por compañía activa"""
    print("\n--- Petición de obtener centros de costo recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa
        print("--- Centros de costo: procesando")
        active_company = get_active_company(user_id)

        if not active_company:
            return jsonify({"success": False, "message": "No hay una compañía activa seleccionada"}), 400

        # Obtener las siglas de la compañía desde ERPNext
        company_abbr = get_company_abbr(session, headers, active_company)

        # Obtener parámetros de búsqueda
        search_query = request.args.get('search', '').strip()
        limit = request.args.get('limit', '1000')

        # Construir filtros para ERPNext - incluir tanto grupos como centros de costo
        filters = [
            ["company", "=", active_company],
            ["disabled", "=", 0]
        ]

        # Agregar filtro de búsqueda si se proporciona
        if search_query:
            filters.append(["cost_center_name", "like", f"%{search_query}%"])

        # Construir URL con filtros
        fields = '["name","cost_center_name","parent_cost_center","company","is_group"]'
        filters_str = json.dumps(filters)

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Cost%20Center",
            params={
                "fields": fields,
                "filters": filters_str,
                "limit_page_length": limit,
                "order_by": "cost_center_name asc"
            },
            operation_name="Get cost centers"
        )

        if error:
            print("--- Centros de costo: error")
            return jsonify({"success": False, "message": f"Error al obtener centros de costo: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401

        response.raise_for_status()

        cost_centers_data = response.json()
        cost_centers = cost_centers_data.get("data", [])

        # Procesar los centros de costo para agregar formato de display
        processed_cost_centers = []
        for cc in cost_centers:
            processed_cc = cc.copy()
            # Formatear el display name como "Nombre - SIGLAS"
            if cc.get('cost_center_name'):
                processed_cc['display_name'] = f"{cc['cost_center_name']} - {company_abbr}"
            else:
                processed_cc['display_name'] = f"{cc['name']} - {company_abbr}"
            processed_cost_centers.append(processed_cc)

        print(f"--- Centros de costo: {len(processed_cost_centers)} registros")

        return jsonify({"success": True, "data": processed_cost_centers})

    except requests.exceptions.HTTPError as err:
        print("--- Centros de costo: error")
        return jsonify({"success": False, "message": "Error al obtener centros de costo"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500


@accounting_bp.route('/api/cost-centers', methods=['POST'])
def create_cost_center():
    """Crea un nuevo centro de costo en ERPNext"""
    print("\n--- Petición de crear centro de costo recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        cost_center_name = data.get('cost_center_name')
        parent_cost_center = data.get('parent_cost_center', '')
        is_group = data.get('is_group', 0)  # Por defecto crear como centro de costo (no grupo)

        if not cost_center_name:
            return jsonify({"success": False, "message": "El nombre del centro de costo es obligatorio"}), 400

        # Obtener la compañía activa
        print("--- Crear centro de costo: procesando")
        active_company = get_active_company(user_id)

        if not active_company:
            return jsonify({"success": False, "message": "No hay una compañía activa seleccionada"}), 400

        # Preparar datos para crear el centro de costo
        cost_center_data = {
            "doctype": "Cost Center",
            "cost_center_name": cost_center_name,
            "company": active_company,
            "is_group": is_group
        }

        # En ERPNext, todos los centros de costo necesitan un padre
        # Para grupos, usar el nombre de la compañía como centro de costo raíz
        if is_group == 1:
            # Para grupos, usar la compañía como centro de costo padre (debería existir por defecto en ERPNext)
            cost_center_data["parent_cost_center"] = active_company
        else:
            # Para centros individuales, el parent_cost_center es obligatorio
            if not parent_cost_center:
                return jsonify({"success": False, "message": "Los centros de costo individuales deben tener un centro de costo padre"}), 400
            cost_center_data["parent_cost_center"] = parent_cost_center

        # Crear el centro de costo en ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Cost Center",
            data={"data": cost_center_data},
            operation_name="Create cost center"
        )

        if error:
            print("--- Crear centro de costo: error")
            return jsonify({"success": False, "message": f"Error al crear centro de costo: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401

        if response.status_code not in [200, 201]:
            error_text = response.text
            print("--- Crear centro de costo: error")
            return jsonify({"success": False, "message": f"Error al crear centro de costo: {error_text}"}), 500

        response.raise_for_status()

        created_cost_center = response.json().get("data", {})
        print("--- Crear centro de costo: ok")

        return jsonify({"success": True, "data": created_cost_center})

    except requests.exceptions.HTTPError as err:
        print("--- Crear centro de costo: error")
        return jsonify({"success": False, "message": "Error al crear centro de costo"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Crear centro de costo: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500
    except Exception as e:
        print("--- Crear centro de costo: error")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@accounting_bp.route('/api/accounts/<path:account_name>', methods=['GET'])
def get_account(account_name):
    """Obtiene los datos de una cuenta contable específica desde ERPNext"""
    print(f"\n--- Petición de obtener cuenta contable '{account_name}' recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        print("--- Obtener cuenta contable: procesando")

        # Intentar obtener la compañía activa y su sigla para asegurar que la cuenta
        # contable incluya el sufijo de compañía cuando corresponda.
        try:
            active_company = get_active_company(user_id)
        except Exception:
            active_company = None

        company_abbr = None
        if active_company:
            try:
                company_abbr = get_company_abbr(session, headers, active_company)
            except Exception:
                company_abbr = None

        # Necesitamos la sigla de la compañía para construir el nombre completo.
        if not company_abbr:
            print("--- Obtener cuenta contable: company abbr no configurada")
            return jsonify({"success": False, "message": "La sigla (abbr) de la compañía no está configurada"}), 500

        expected_suffix = f" - {company_abbr}"

        # Si la cuenta ya viene con la sigla, la usamos tal cual; si no, la agregamos y consultamos.
        queried_account_name = account_name
        if account_name.endswith(expected_suffix):
            print(f"--- Petición de obtener cuenta contable '{account_name}' (ya incluye sigla) ---")
        else:
            # Concatenar la sigla y consultar con el nombre completo
            queried_account_name = f"{account_name}{expected_suffix}"
            print(f"--- Petición de obtener cuenta contable: la cuenta no incluía sigla; consultando como '{queried_account_name}' ---")

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Account/{quote(queried_account_name)}",
            operation_name=f"Get account '{queried_account_name}'"
        )

        if error:
            print("--- Obtener cuenta contable: error")
            return jsonify({"success": False, "message": f"Error al obtener cuenta contable: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Cuenta contable no encontrada"}), 404

        response.raise_for_status()

        # ERPNext devuelve los datos de la cuenta
        account_data = response.json()

        print("--- Obtener cuenta contable: ok")

        return jsonify({"success": True, "data": account_data.get("data", {})})

    except requests.exceptions.HTTPError as err:
        print("--- Obtener cuenta contable: error")
        return jsonify({"success": False, "message": "Error al obtener cuenta contable"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Obtener cuenta contable: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/accounts/<path:account_name>', methods=['PUT'])
def update_account(account_name):
    """Actualiza los datos de una cuenta contable específica en ERPNext"""
    print(f"\n--- Petición de actualizar cuenta contable '{account_name}' recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos a actualizar del body de la petición
    update_data = request.get_json()

    if not update_data or 'data' not in update_data:
        return jsonify({"success": False, "message": "Datos de actualización requeridos"}), 400

    # Filtrar campos que no se pueden editar en ERPNext
    filtered_data = update_data['data'].copy()

    # Campos que no se pueden cambiar una vez establecidos
    non_editable_fields = ['name']  # name es el ID único, account_name sí se puede editar

    # Remover campos no editables
    for field in non_editable_fields:
        if field in filtered_data:
            del filtered_data[field]

    # Si no quedan campos para actualizar
    if not filtered_data:
        return jsonify({"success": False, "message": "No hay campos válidos para actualizar"}), 400

    try:
        print("--- Actualizar cuenta contable: procesando")

        # Hacer la petición PUT a ERPNext para actualizar la cuenta
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Account/{account_name}",
            data={'data': filtered_data},
            operation_name=f"Update account '{account_name}'"
        )

        if error:
            print("--- Actualizar cuenta contable: error")
            return jsonify({"success": False, "message": f"Error al actualizar cuenta contable: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Cuenta contable no encontrada"}), 404
        elif response.status_code == 403:
            return jsonify({"success": False, "message": "No tienes permisos para actualizar cuentas contables"}), 403

        response.raise_for_status()

        # ERPNext devuelve los datos actualizados de la cuenta
        updated_account_data = response.json()

        print("--- Actualizar cuenta contable: ok")

        return jsonify({"success": True, "data": updated_account_data.get("data", {}), "message": "Cuenta contable actualizada correctamente"})

    except requests.exceptions.HTTPError as err:
        print("--- Actualizar cuenta contable: error")
        try:
            error_detail = err.response.json()
            # Manejar errores específicos de ERPNext
            if 'CannotChangeConstantError' in str(error_detail):
                return jsonify({"success": False, "message": "No se puede cambiar este campo"}), 400
            return jsonify({"success": False, "message": error_detail.get("message", "Error al actualizar cuenta contable")}), 500
        except:
            return jsonify({"success": False, "message": "Error al actualizar cuenta contable"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Actualizar cuenta contable: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/accounts/<path:account_name>', methods=['DELETE'])
def delete_account(account_name):
    """Elimina una cuenta contable específica de ERPNext"""
    print(f"\n--- Petición de eliminar cuenta contable '{account_name}' recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        print("--- Eliminar cuenta contable: procesando")

        # Hacer la petición DELETE a ERPNext para eliminar la cuenta
        response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Account/{account_name}",
            operation_name=f"Delete account '{account_name}'"
        )

        if error:
            print("--- Eliminar cuenta contable: error")
            return jsonify({"success": False, "message": f"Error al eliminar cuenta contable: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Cuenta contable no encontrada"}), 404
        elif response.status_code == 403:
            return jsonify({"success": False, "message": "No tienes permisos para eliminar cuentas contables"}), 403

        response.raise_for_status()

        print("--- Eliminar cuenta contable: ok")

        return jsonify({"success": True, "message": f"Cuenta contable '{account_name}' eliminada correctamente"})

    except requests.exceptions.HTTPError as err:
        print("--- Eliminar cuenta contable: error")
        try:
            error_detail = err.response.json()
            return jsonify({"success": False, "message": error_detail.get("message", "Error al eliminar cuenta contable")}), 500
        except:
            return jsonify({"success": False, "message": "Error al eliminar cuenta contable"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Eliminar cuenta contable: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/accounts', methods=['POST'])
def create_account():
    """Crea una nueva cuenta contable en ERPNext"""
    print("\n--- Petición de crear cuenta contable recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos de la nueva cuenta del body de la petición
    account_data = request.get_json()

    # Extraer datos del campo 'data' si existe
    if 'data' in account_data:
        account_data = account_data['data']

    if not account_data or 'account_name' not in account_data:
        return jsonify({"success": False, "message": "Nombre de cuenta requerido"}), 400

    # Obtener la compañía activa del usuario
    active_company = get_active_company(user_id)

    if not active_company:
        return jsonify({"success": False, "message": "No hay empresa activa configurada"}), 400

    # Resolver moneda (sin hardcode). Si no se provee, usar la moneda por defecto de la empresa activa.
    account_currency = account_data.get("account_currency")
    if not account_currency:
        account_currency = get_company_default_currency(session, headers, active_company)

    if not account_currency:
        return jsonify({"success": False, "message": "La empresa activa no tiene moneda por defecto definida y no se envio account_currency"}), 400

    # Preparar los datos para ERPNext
    erpnext_data = {
        "account_name": account_data["account_name"],
        "account_number": account_data.get("account_number", ""),
        "company": active_company,
        "account_type": account_data.get("account_type", ""),
        "parent_account": account_data.get("parent_account", ""),
        "account_currency": account_currency,
        "description": account_data.get("description", ""),
        "is_group": account_data.get("is_group", 0)
    }

    try:
        print("--- Crear cuenta contable: procesando")

        # Hacer la petición POST a ERPNext para crear la cuenta
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Account",
            data=erpnext_data,
            operation_name="Create account"
        )

        if error:
            print("--- Crear cuenta contable: error")
            return jsonify({"success": False, "message": f"Error al crear cuenta contable: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 403:
            return jsonify({"success": False, "message": "No tienes permisos para crear cuentas contables"}), 403
        elif response.status_code == 409:
            return jsonify({"success": False, "message": "Ya existe una cuenta con ese nombre"}), 409

        response.raise_for_status()

        # ERPNext devuelve los datos de la cuenta creada
        new_account_data = response.json()
        account_name = new_account_data.get("data", {}).get("name")

        print("--- Crear cuenta contable: ok")

        return jsonify({"success": True, "data": new_account_data.get("data", {}), "message": "Cuenta contable creada correctamente"})

    except requests.exceptions.HTTPError as err:
        print("--- Crear cuenta contable: error")
        try:
            error_detail = err.response.json()
            return jsonify({"success": False, "message": error_detail.get("message", "Error al crear cuenta contable")}), 500
        except:
            return jsonify({"success": False, "message": "Error al crear cuenta contable"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Crear cuenta contable: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/journal-entries', methods=['GET'])
def get_journal_entries():
    """Obtiene la lista de asientos de diario desde ERPNext"""
    print("\n--- Petición de obtener asientos de diario recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener parámetros de filtro
    status_filter = request.args.get('status', '')  # 'draft' para borradores
    account_filter = request.args.get('account', '')  # filtro por cuenta específica

    try:
        print("--- Asientos de diario: procesando")

        # Construir filtros
        filters = []
        if status_filter == 'draft':
            filters.append(["docstatus", "=", 0])  # 0 = Draft en ERPNext
        if account_filter:
            # Para filtrar por cuenta, necesitamos buscar en las líneas del asiento
            # Usaremos una consulta más compleja que busque en Journal Entry Account
            pass  # Por ahora, obtendremos todos y filtraremos en el frontend

        # Convertir filtros a JSON string
        import json
        filters_json = json.dumps(filters)

        # Usar GET con filtros en query parameters
        fields = '["name","title","posting_date","company","total_amount","total_amount_currency","voucher_type","remark","docstatus"]'

        # Hacer la petición a ERPNext para obtener los asientos
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Journal%20Entry",
            params={
                "fields": fields,
                "filters": filters_json,
                "limit_page_length": 500
            },
            operation_name="Get journal entries"
        )

        if error:
            print("--- Asientos de diario: error")
            return jsonify({"success": False, "message": f"Error al obtener asientos de diario: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401

        response.raise_for_status()

        journal_entries_data = response.json()
        journal_entries = journal_entries_data.get("data", [])

        # Agregar campo is_draft para compatibilidad con frontend
        for entry in journal_entries:
            docstatus = entry.get("docstatus", 0)
            entry["is_draft"] = docstatus == 0  # 0 = Draft, 1 = Submitted, 2 = Cancelled

        print(f"--- Asientos de diario: {len(journal_entries)} registros")

        return jsonify({"success": True, "data": journal_entries})

    except requests.exceptions.HTTPError as err:
        print("--- Asientos de diario: error")
        return jsonify({"success": False, "message": "Error al obtener asientos de diario"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Asientos de diario: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/journal-entries', methods=['POST'])
def create_journal_entry():
    """Crea un nuevo asiento de diario en ERPNext"""
    print("\n--- Petición de crear asiento de diario recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos del nuevo asiento del body de la petición
    journal_entry_data = request.get_json()

    if not journal_entry_data or 'data' not in journal_entry_data:
        return jsonify({"success": False, "message": "Datos del asiento requeridos"}), 400

    # Verificar si se debe guardar como borrador
    save_as_draft = journal_entry_data.get('save_as_draft', False)

    # Validar que el título sea obligatorio
    title = journal_entry_data['data'].get('title', '').strip()
    if not title:
        return jsonify({"success": False, "message": "El título del asiento es obligatorio"}), 400

    try:
        print("--- Crear asiento de diario: procesando")

        # Hacer la petición POST a ERPNext para crear el asiento
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Journal%20Entry",
            data=journal_entry_data['data'],
            operation_name="Create journal entry"
        )

        if error:
            print("--- Crear asiento de diario: error")
            return jsonify({"success": False, "message": f"Error al crear asiento de diario: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 403:
            return jsonify({"success": False, "message": "No tienes permisos para crear asientos de diario"}), 403
        elif response.status_code == 409:
            return jsonify({"success": False, "message": "Ya existe un asiento con ese nombre"}), 409

        response.raise_for_status()

        # ERPNext devuelve los datos del asiento creado
        new_journal_entry_data = response.json()
        journal_entry_name = new_journal_entry_data.get("data", {}).get("name")

        # Confirmar (submit) el asiento inmediatamente después de crearlo (solo si no es borrador)
        if not save_as_draft:
            submit_response, submit_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Journal%20Entry/{journal_entry_name}",
                data={"docstatus": 1},
                operation_name=f"Submit journal entry '{journal_entry_name}'"
            )

            if submit_error:
                print("--- Error al confirmar asiento de diario")
                return jsonify({"success": True, "data": new_journal_entry_data.get("data", {}), "message": "Asiento de diario creado (pero no se pudo confirmar automáticamente)"})

            if submit_response.status_code == 200:
                print("--- Crear asiento de diario: ok")
                return jsonify({"success": True, "data": new_journal_entry_data.get("data", {}), "message": "Asiento de diario creado y confirmado correctamente"})
            else:
                # No fallar la creación si no se puede confirmar, solo loggear el error
                return jsonify({"success": True, "data": new_journal_entry_data.get("data", {}), "message": "Asiento de diario creado (pero no se pudo confirmar automáticamente)"})
        else:
            print("--- Crear asiento de diario: ok")
            return jsonify({"success": True, "data": new_journal_entry_data.get("data", {}), "message": "Asiento de diario guardado como borrador correctamente"})

    except requests.exceptions.HTTPError as err:
        print("--- Crear asiento de diario: error")
        try:
            error_detail = err.response.json()
            return jsonify({"success": False, "message": error_detail.get("message", "Error al crear asiento de diario")}), 500
        except:
            return jsonify({"success": False, "message": "Error al crear asiento de diario"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Crear asiento de diario: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/journal-entries/<journal_entry_name>', methods=['GET'])
def get_journal_entry(journal_entry_name):
    """Obtiene los datos de un asiento de diario específico desde ERPNext"""
    print(f"\n--- Petición de obtener asiento de diario '{journal_entry_name}' recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        print("--- Obtener asiento de diario: procesando")

        # Hacer la petición a ERPNext para obtener el asiento específico
        # Usar el formato sin fields para obtener el documento completo incluyendo child tables
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Journal%20Entry/{journal_entry_name}",
            operation_name=f"Get journal entry '{journal_entry_name}'"
        )

        if error:
            print("--- Obtener asiento de diario: error")
            return jsonify({"success": False, "message": f"Error al obtener asiento de diario: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Asiento de diario no encontrado"}), 404

        response.raise_for_status()

        # ERPNext devuelve los datos del asiento
        journal_entry_data = response.json()
        
        # Verificar que tenemos las cuentas (child table accounts)
        data = journal_entry_data.get("data", {})
        accounts_count = len(data.get("accounts", []))
        print(f"--- Obtener asiento de diario: {accounts_count} cuentas")

        return jsonify({"success": True, "data": data})

    except requests.exceptions.HTTPError as err:
        print("--- Obtener asiento de diario: error")
        return jsonify({"success": False, "message": "Error al obtener asiento de diario"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Obtener asiento de diario: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/gl-entries', methods=['GET'])
def get_gl_entries():
    """Obtiene los movimientos de cuenta (GL Entries) desde ERPNext"""
    print("\n--- Petición de obtener movimientos de cuenta (GL Entries) recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener parámetros de filtro
    account_filter = request.args.get('account', '')
    limit = request.args.get('limit', '1000')
    include_cancelled = request.args.get('include_cancelled', 'false').lower() == 'true'
    status_filter = request.args.get('status', '')  # 'draft' para borradores, 'cancelled' para cancelados

    try:
        print("--- Movimientos de cuenta: procesando")

        # Construir filtros
        filters = []
        if account_filter:
            filters.append(["account", "=", account_filter])

        # Convertir filtros a JSON string
        import json
        filters_json = json.dumps(filters)

        # Usar GET con filtros en query parameters
        fields = '["posting_date","voucher_no","debit","credit","party","voucher_type","against_voucher","against_voucher_type","remarks"]'

        # Hacer la petición GET a ERPNext para obtener los GL Entries
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/GL%20Entry",
            params={
                "fields": fields,
                "filters": filters_json,
                "limit_page_length": limit,
                "order_by": "posting_date desc"
            },
            operation_name="Get GL entries"
        )

        if error:
            print("--- Movimientos de cuenta: error")
            return jsonify({"success": False, "message": f"Error al obtener movimientos de cuenta: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401

        response.raise_for_status()

        gl_entries_data = response.json()
        gl_entries = gl_entries_data.get("data", [])

        # Obtener títulos y estados de los vouchers en batch

        voucher_map = defaultdict(set)

        for entry in gl_entries:

            voucher_no = entry.get("voucher_no")

            voucher_type = entry.get("voucher_type")

            if voucher_no and voucher_type:

                voucher_map[voucher_type].add(voucher_no)



        voucher_metadata = fetch_voucher_metadata_batch(

            session,

            voucher_map,

            "voucher metadata para GL Entries"

        )



        journal_titles = {}

        cancelled_vouchers = set()

        draft_vouchers = set()



        for voucher_no, meta in voucher_metadata.items():

            docstatus = meta.get("docstatus", 1)

            title = meta.get("title")

            if docstatus == 2:

                cancelled_vouchers.add(voucher_no)

            elif docstatus == 0:

                draft_vouchers.add(voucher_no)

            if title:

                journal_titles[voucher_no] = title



        for entry in gl_entries:

            voucher_no = entry.get("voucher_no")

            voucher_type = entry.get("voucher_type") or "Movimiento"

            if voucher_no and voucher_no not in journal_titles:

                journal_titles[voucher_no] = f"{voucher_type} {voucher_no}".strip()

        filtered_entries = []
        for entry in gl_entries:
            voucher_no = entry.get("voucher_no", "")
            is_cancelled = False
            is_draft = False
            
            if voucher_no:
                if voucher_no in cancelled_vouchers:
                    is_cancelled = True
                elif voucher_no in draft_vouchers:
                    is_draft = True
            
            # Aplicar filtros según parámetros
            should_include = True
            
            if status_filter == 'draft' and not is_draft:
                should_include = False
            elif status_filter == 'cancelled' and not is_cancelled:
                should_include = False
            elif not include_cancelled and is_cancelled:
                should_include = False
            
            if should_include:
                # Agregar título y estados a la entrada
                entry["journal_title"] = journal_titles.get(voucher_no, "")
                entry["is_cancelled"] = is_cancelled
                entry["is_draft"] = is_draft
                # Agregar tipo de movimiento (primeras 3 letras del voucher_type)
                entry["movement_type"] = voucher_type[:3].upper() if voucher_type else ""
                filtered_entries.append(entry)

        print(f"--- Movimientos de cuenta: {len(filtered_entries)} registros")

        return jsonify({"success": True, "data": filtered_entries})

    except requests.exceptions.HTTPError as err:
        print("--- Movimientos de cuenta: error")
        return jsonify({"success": False, "message": "Error al obtener movimientos de cuenta"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Movimientos de cuenta: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/journal-entries/<voucher_no>', methods=['GET'])
def get_journal_entry_by_voucher(voucher_no):
    """Obtiene un Journal Entry específico desde ERPNext"""
    print(f"\n--- Petición de obtener Journal Entry: {voucher_no} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        print("--- Obtener Journal Entry: procesando")

        # Hacer la petición GET a ERPNext para obtener el Journal Entry específico

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Journal%20Entry/{voucher_no}",
            operation_name=f"Get journal entry by voucher '{voucher_no}'"
        )

        if error:
            print("--- Obtener Journal Entry: error")
            return jsonify({"success": False, "message": f"Error al obtener Journal Entry: {error}"}), 500

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Journal Entry no encontrado"}), 404

        response.raise_for_status()

        journal_entry_data = response.json()
        journal_entry = journal_entry_data.get("data", {})

        print("--- Obtener Journal Entry: ok")

        return jsonify({"success": True, "data": journal_entry})

    except requests.exceptions.HTTPError as err:
        print("--- Obtener Journal Entry: error")
        return jsonify({"success": False, "message": "Error al obtener Journal Entry"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Obtener Journal Entry: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/journal-entries/<voucher_no>', methods=['PUT'])
def update_journal_entry(voucher_no):
    """Actualiza un Journal Entry específico en ERPNext"""
    print(f"\n--- Petición de actualizar Journal Entry: {voucher_no} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener los datos del request
        request_data = request.get_json()
        if not request_data or 'data' not in request_data:
            return jsonify({"success": False, "message": "Datos inválidos"}), 400

        journal_entry_data = request_data['data']
        
        # Verificar si se debe guardar como borrador
        save_as_draft = request_data.get('save_as_draft', False)
        
        # Validar que el título sea obligatorio
        title = journal_entry_data.get('title', '').strip()
        if not title:
            return jsonify({"success": False, "message": "El título del asiento es obligatorio"}), 400
            
        # Remover el campo 'name' del payload si existe, ya que se usa en la URL
        if 'name' in journal_entry_data:
            del journal_entry_data['name']
            
        print("--- Actualizar Journal Entry: procesando")

        # Hacer la petición PUT a ERPNext para actualizar el Journal Entry
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Journal%20Entry/{voucher_no}",
            data=journal_entry_data,
            operation_name=f"Update journal entry '{voucher_no}'"
        )

        if error:
            print("--- Actualizar Journal Entry: error")
            return jsonify({"success": False, "message": f"Error al actualizar Journal Entry: {error}"}), 500

        if response.status_code == 200:
            updated_data = response.json()
            
            # Confirmar (submit) el asiento si no es borrador
            if not save_as_draft:
                submit_response, submit_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Journal%20Entry/{voucher_no}",
                    data={"docstatus": 1},
                    operation_name=f"Submit updated journal entry '{voucher_no}'"
                )

                if submit_error:
                    print("--- Error al confirmar asiento de diario actualizado")
                    return jsonify({"success": True, "data": updated_data.get("data", {}), "message": "Asiento de diario actualizado (pero no se pudo confirmar automáticamente)"})

                if submit_response.status_code == 200:
                    print("--- Actualizar Journal Entry: ok")
                    return jsonify({"success": True, "data": updated_data.get("data", {}), "message": "Asiento de diario actualizado y confirmado correctamente"})
                else:
                    # No fallar la actualización si no se puede confirmar, solo loggear el error
                    return jsonify({"success": True, "data": updated_data.get("data", {}), "message": "Asiento de diario actualizado (pero no se pudo confirmar automáticamente)"})
            else:
                print("--- Actualizar Journal Entry: ok")
                return jsonify({"success": True, "data": updated_data.get("data", {}), "message": "Asiento de diario actualizado como borrador correctamente"})
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Journal Entry no encontrado"}), 404
        elif response.status_code == 417:
            # Expectation Failed - usually validation errors
            try:
                error_response = response.json()
                error_detail = error_response.get("message", "")
            except:
                error_detail = response.text
            return jsonify({"success": False, "message": f"Error de validación al actualizar: {error_detail}"}), 400
        else:
            error_detail = ""
            try:
                error_response = response.json()
                error_detail = error_response.get("message", "")
            except:
                error_detail = response.text
            return jsonify({"success": False, "message": f"Error al actualizar: {error_detail}"}), 500

    except requests.exceptions.HTTPError as err:
        print("--- Actualizar Journal Entry: error")
        return jsonify({"success": False, "message": "Error al actualizar Journal Entry"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Actualizar Journal Entry: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@accounting_bp.route('/api/journal-entries/<voucher_no>', methods=['DELETE'])
def delete_journal_entry(voucher_no):
    """Elimina o cancela un Journal Entry según su estado (docstatus)"""
    print(f"\n--- Petición de eliminar/cancelar Journal Entry: {voucher_no} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Primero obtener el Journal Entry para verificar su docstatus
        print("--- Eliminar Journal Entry: procesando")
        get_response, get_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Journal%20Entry/{voucher_no}",
            operation_name=f"Get journal entry status for deletion '{voucher_no}'"
        )
        
        if get_error:
            return jsonify({"success": False, "message": f"Journal Entry no encontrado: {get_error}"}), 404
            
        if get_response.status_code != 200:
            return jsonify({"success": False, "message": "Journal Entry no encontrado"}), 404
            
        journal_data = get_response.json()
        docstatus = journal_data.get("data", {}).get("docstatus", 0)
        
        # Si es borrador (docstatus=0), eliminar directamente
        if docstatus == 0:
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Journal%20Entry/{voucher_no}",
                operation_name=f"Delete draft journal entry '{voucher_no}'"
            )
            
            if delete_error:
                error_detail = delete_error
                return jsonify({"success": False, "message": f"Error al eliminar borrador: {error_detail}"}), 500

            if delete_response.status_code == 202:
                print("--- Eliminar Journal Entry: ok")
                return jsonify({"success": True, "message": "Borrador eliminado exitosamente"})
            else:
                error_detail = delete_response.text
                try:
                    error_response = delete_response.json()
                    error_detail = error_response.get("message", error_detail)
                except:
                    pass
                return jsonify({"success": False, "message": f"Error al eliminar borrador: {error_detail}"}), 500
        
        # Si está confirmado (docstatus=1), cancelar
        elif docstatus == 1:
            payload = {
                "doctype": "Journal Entry",
                "name": voucher_no
            }

            # Hacer la petición POST a frappe.client.cancel
            response, error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.cancel",
                data=payload,
                operation_name=f"Cancel journal entry '{voucher_no}'"
            )

            if error:
                error_detail = error
                return jsonify({"success": False, "message": f"Error al cancelar: {error_detail}"}), 500

            if response.status_code == 200:
                response_data = response.json()
                print("--- Eliminar Journal Entry: ok")
                return jsonify({"success": True, "message": "Journal Entry cancelado exitosamente"})
            elif response.status_code == 404:
                return jsonify({"success": False, "message": "Journal Entry no encontrado"}), 404
            elif response.status_code == 417:
                # Error de expectativa fallida - mostrar respuesta completa
                try:
                    error_data = response.json()
                    error_message = error_data.get("message", "No se puede cancelar el Journal Entry")
                    return jsonify({"success": False, "message": f"Error al cancelar: {error_message}", "details": error_data}), 417
                except:
                    error_text = response.text
                    return jsonify({"success": False, "message": "No se puede cancelar el Journal Entry", "details": error_text}), 417
            else:
                error_detail = response.text
                try:
                    error_response = response.json()
                    error_detail = error_response.get("message", error_detail)
                except:
                    pass
                return jsonify({"success": False, "message": f"Error al cancelar: {error_detail}"}), 500
        
        # Si está cancelado (docstatus=2), no hacer nada
        else:
            return jsonify({"success": False, "message": "El Journal Entry ya está cancelado"}), 400

    except requests.exceptions.HTTPError as err:
        print("--- Eliminar Journal Entry: error")
        return jsonify({"success": False, "message": "Error al cancelar Journal Entry"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Eliminar Journal Entry: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500


@accounting_bp.route('/api/fiscal-years', methods=['GET'])
def get_fiscal_years():
    """Obtiene la lista de años fiscales disponibles desde ERPNext filtrados por compañía activa"""
    print("\n--- Petición de obtener años fiscales recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario
        print("--- Años fiscales: procesando")

        active_company = get_active_company(user_id)
        if not active_company:
            return jsonify({"success": False, "message": "No hay empresa activa configurada"}), 400

        # Primero, obtener los Fiscal Year Company para la compañía activa
        fy_company_payload = {
            "doctype": "Fiscal Year Company",
            "parent": "Fiscal Year",
            "fields": ["name", "parent", "company"],
            "filters": {
                "company": active_company,
                "parenttype": "Fiscal Year",
                "parentfield": "companies"
            },
            "limit_page_length": 1000
        }

        fy_company_response, fy_company_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data=fy_company_payload,
            operation_name="Get Fiscal Year Companies for active company"
        )

        if fy_company_error or not fy_company_response or fy_company_response.status_code != 200:
            print("--- Años fiscales: error obteniendo Fiscal Year Companies")
            return jsonify({"success": False, "message": "Error al obtener años fiscales para la compañía"}), 500

        fy_company_data = fy_company_response.json()
        fy_companies = fy_company_data.get("message", [])
        fiscal_year_names = [fyc["parent"] for fyc in fy_companies if fyc.get("parent")]

        if not fiscal_year_names:
            print("--- Años fiscales: no hay años fiscales para la compañía")
            return jsonify({
                "success": True,
                "data": [],
                "company": active_company,
                "message": "No se encontraron años fiscales para la compañía activa"
            })

        # Ahora, obtener los detalles de los Fiscal Years
        fy_payload = {
            "doctype": "Fiscal Year",
            "fields": ["name", "year", "year_start_date", "year_end_date", "disabled", "is_short_year"],
            "filters": {
                "name": ["in", fiscal_year_names]
            },
            "order_by": "year_start_date desc",
            "limit_page_length": 1000
        }

        fy_response, fy_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data=fy_payload,
            operation_name="Get Fiscal Years details"
        )

        if fy_error or not fy_response or fy_response.status_code != 200:
            print("--- Años fiscales: error obteniendo detalles de Fiscal Years")
            return jsonify({"success": False, "message": "Error al obtener detalles de años fiscales"}), 500

        fy_data = fy_response.json()
        fiscal_years = fy_data.get("message", [])

        print("--- Años fiscales: ok")
        return jsonify({
            "success": True,
            "data": fiscal_years,
            "company": active_company
        })

    except requests.exceptions.HTTPError as err:
        print("--- Años fiscales: error")
        return jsonify({"success": False, "message": "Error al obtener años fiscales"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Años fiscales: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500
    except Exception as e:
        print("--- Años fiscales: error")
        return jsonify({"success": False, "message": str(e)}), 500
    except Exception as e:
        print("--- Años fiscales: error")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@accounting_bp.route('/api/trial-balance', methods=['GET'])
def get_trial_balance():
    """Obtiene el Trial Balance desde ERPNext para mostrar saldos de cuentas"""
    print("\n--- Petición de obtener Trial Balance recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            print("--- Trial Balance: error")
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        # Obtener la compañía activa del usuario
        print("--- Trial Balance: procesando")

        try:
            active_company = get_active_company(user_id)

            if not active_company:
                return jsonify({"success": False, "message": "No hay empresa activa configurada"}), 400

        except Exception as company_err:
            print("--- Trial Balance: error")
            return jsonify({"success": False, "message": "Error al obtener configuración de empresa"}), 500

        # Obtener el año fiscal (del parámetro o usar el más reciente)
        fiscal_year = request.args.get('fiscal_year', '')

        # Si no se especifica año fiscal, obtener el más reciente
        if not fiscal_year:
            fiscal_year = get_latest_fiscal_year(session, headers)
            if not fiscal_year:
                return jsonify({"success": False, "message": "No se pudo determinar el año fiscal"}), 400

        # Llamar al endpoint de ERPNext para obtener el Trial Balance
        # Usar el endpoint directo del reporte en lugar de query_report.run
        fields = json.dumps(["account","debit","credit","voucher_no","voucher_type","posting_date","fiscal_year"])
        filters = json.dumps([["company", "=", active_company]])

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/GL Entry",
            params={
                "fields": fields,
                "filters": filters,
                "limit_page_length": 10000
            },
            operation_name="Get GL entries for trial balance"
        )
        
        if error:
            return handle_erpnext_error(error, "Failed to fetch GL entries for trial balance")

        if response.status_code == 200:
            data = response.json()
            gl_entries = data.get("data", [])

            # Filtrar por año fiscal en el código (más confiable)
            if fiscal_year:
                gl_entries = [entry for entry in gl_entries if entry.get("fiscal_year") == fiscal_year]

            # Obtener estados de los vouchers para excluir cancelados en batch

            voucher_map = defaultdict(set)

            for entry in gl_entries:

                voucher_no = entry.get("voucher_no")

                voucher_type = entry.get("voucher_type")

                if voucher_no and voucher_type:

                    voucher_map[voucher_type].add(voucher_no)



            voucher_metadata = fetch_voucher_metadata_batch(

                session,

                voucher_map,

                "voucher metadata para Trial Balance"

            )



            cancelled_vouchers = {name for name, meta in voucher_metadata.items() if meta.get("docstatus") == 2}

            draft_vouchers = {name for name, meta in voucher_metadata.items() if meta.get("docstatus") == 0}

            # Procesar los datos del GL Entry para calcular saldos
            # EXCLUYENDO movimientos cancelados y borradores
            account_balances = {}
            for entry in gl_entries:
                account = entry.get('account', '')
                debit = entry.get('debit', 0) or 0
                credit = entry.get('credit', 0) or 0
                voucher_no = entry.get('voucher_no', '')
                voucher_type = entry.get('voucher_type', '')

                # Excluir movimientos que estén asociados a vouchers cancelados o borradores
                should_exclude = False
                if voucher_no and voucher_no in cancelled_vouchers:
                    should_exclude = True
                elif voucher_no and voucher_no in draft_vouchers:
                    should_exclude = True

                if account and not should_exclude:
                    if account not in account_balances:
                        account_balances[account] = {
                            'debit': 0,
                            'credit': 0,
                            'balance': 0
                        }

                    account_balances[account]['debit'] += debit
                    account_balances[account]['credit'] += credit
                    account_balances[account]['balance'] = account_balances[account]['debit'] - account_balances[account]['credit']

            print(f"--- Trial Balance: {len(account_balances)} registros")
            return jsonify({
                "success": True,
                "data": account_balances,
                "company": active_company,
                "fiscal_year": fiscal_year
            })

        else:
            print("--- Trial Balance: error")
            return jsonify({"success": False, "message": "Error al obtener Trial Balance desde ERPNext"}), 500

    except requests.exceptions.HTTPError as err:
        print("--- Trial Balance: error")
        return jsonify({"success": False, "message": "Error al obtener Trial Balance"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Trial Balance: error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500
    except Exception as e:
        print("--- Trial Balance: error")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500
