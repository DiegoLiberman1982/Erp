from flask import Blueprint, request, jsonify
import requests
import os
import json
from urllib.parse import quote

# Importar configuración
from routes.auth_utils import get_session_with_auth
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company as get_central_active_company

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from routes.system_settings import apply_initial_system_settings

# Crear el blueprint para las rutas de empresas
companies_bp = Blueprint('companies', __name__)

# Archivo para almacenar empresas activas por usuario
ACTIVE_COMPANIES_FILE = os.path.join(os.path.dirname(__file__), '..', 'active_companies.json')

def load_active_companies():
    """Carga las empresas activas desde el archivo JSON"""
    try:
        if os.path.exists(ACTIVE_COMPANIES_FILE):
            with open(ACTIVE_COMPANIES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {"active_companies": {}}
    except Exception as e:
        print(f"Error al cargar empresas activas: {e}")
        return {"active_companies": {}}

def save_active_companies(data):
    """Guarda las empresas activas en el archivo JSON"""
    try:
        with open(ACTIVE_COMPANIES_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error al guardar empresas activas: {e}")
        return False

def remove_company_from_active(user_id, company_name):
    """Remueve una empresa específica de la lista de empresas activas de un usuario"""
    try:
        active_data = load_active_companies()
        active_companies = active_data.get('active_companies', {})

        # Si el usuario tiene esta empresa como activa, removerla
        if user_id in active_companies and active_companies[user_id] == company_name:
            del active_companies[user_id]
            print(f"Empresa '{company_name}' removida de empresas activas para usuario '{user_id}'")

            active_data['active_companies'] = active_companies
            return save_active_companies(active_data)

        return True  # No había nada que remover
    except Exception as e:
        print(f"Error al remover empresa de activas: {e}")
        return False

@companies_bp.route('/api/companies', methods=['GET'])
def get_companies():
    """Obtiene la lista de todas las empresas desde ERPNext"""
    print("🔍 Obteniendo empresas")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

    try:

        # Hacer la petición a ERPNext para obtener todas las empresas
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Company",
            operation_name="Get all companies"
        )

        if error:
            print(f"Error obteniendo empresas: {error}")
            return handle_erpnext_error(error, "Error al obtener empresas")

        # ERPNext devuelve los datos en formato {"data": [...]}
        companies_data = response.json()

        # Extraer información básica de las empresas incluyendo fechas y Fiscal Year
        companies = []
        for company in companies_data.get("data", []):
            company_name = company["name"]
            
            # Buscar el Fiscal Year para esta compañía
            fiscal_year_name = get_fiscal_year_for_company(session, headers, company_name)
            
            companies.append({
                "name": company["name"],
                "creation": company.get("creation"),
                "modified": company.get("modified"),
                "company_name": company.get("company_name"),
                "country": company.get("country"),
                "default_currency": company.get("default_currency"),
                "default_fiscal_year": company.get("default_fiscal_year"),
                "fiscal_year_name": fiscal_year_name
            })

        print(f"Empresas obtenidas: {len(companies)}")

        return jsonify({"success": True, "data": companies})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": "Error al obtener empresas"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@companies_bp.route('/api/companies/<company_name>', methods=['GET'])
def get_company(company_name):
    """Obtiene los datos de una empresa específica desde ERPNext"""
    print(f"🔍 Obteniendo empresa: {company_name}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Build fields list and pass via params to avoid nested quoting
    fields_list = [
        "name",
        "company_name",
        "country",
        "default_currency",
        "default_payable_account",
        "default_expense_account",
        "custom_default_iva_ventas",
        "custom_default_iva_compras",
        "custom_default_warehouse",
        "default_cash_account",
        "round_off_account",
        "exchange_gain_loss_account",
        "abbr"
    ]

    # Hacer la petición usando la utilidad centralizada
    response, error_response = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Company/{quote(company_name)}",
        params={
            'fields': json.dumps(fields_list)
        },
        operation_name=f"Obtener empresa {company_name}"
    )

    # Si hubo error, devolver respuesta de error
    if error_response:
        if error_response['status_code'] == 404:
            return jsonify({"success": False, "message": "Empresa no encontrada"}), 404
        return handle_erpnext_error(error_response, "Error al obtener empresa")

    # ERPNext devuelve los datos de la empresa
    company_data = response.json()
    default_currency = (company_data.get("data", {}) or {}).get("default_currency")
    if not default_currency:
        return jsonify({
            "success": False,
            "message": f"La empresa '{company_name}' no tiene moneda por defecto definida (default_currency)"
        }), 400

    # Buscar el Fiscal Year asociado a esta compañía
    fiscal_year_data = get_fiscal_year_for_company(session, headers, company_name)

    if fiscal_year_data:
        company_data["data"]["fiscal_year"] = fiscal_year_data.get("name")
    else:
        company_data["data"]["fiscal_year"] = None

    print(f"✅ Empresa '{company_name}' obtenida exitosamente")
    return jsonify({"success": True, "data": company_data.get("data", {})})


@companies_bp.route('/api/companies/<company_name>/abbr', methods=['GET'])
def get_company_abbr(company_name):
    """Obtiene solo la abreviatura de una empresa específica desde ERPNext"""
    print(f"🔍 Obteniendo abreviatura de empresa: {company_name}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Solo pedimos el campo abbr
    response, error_response = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Company/{quote(company_name)}",
        params={
            'fields': json.dumps(["abbr"])
        },
        operation_name=f"Obtener abreviatura de {company_name}"
    )

    if error_response:
        if error_response['status_code'] == 404:
            return jsonify({"success": False, "message": "Empresa no encontrada"}), 404
        return handle_erpnext_error(error_response, "Error al obtener abreviatura")

    company_data = response.json()
    abbr = company_data.get("data", {}).get("abbr", "")

    print(f"✅ Abreviatura de empresa '{company_name}': {abbr}")
    return jsonify({"success": True, "abbr": abbr})


@companies_bp.route('/api/companies/<company_name>', methods=['PUT'])
def update_company(company_name):
    """Actualiza los datos de una empresa específica en ERPNext"""
    print(f"\n--- Petición de actualizar empresa '{company_name}' recibida ---")

    # Debug: Mostrar headers y cookies recibidas
    print(f"Headers recibidos: {dict(request.headers)}")
    print(f"Cookies recibidas: {request.cookies}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos a actualizar del body de la petición
    update_data = request.get_json()
    print(f"Datos a actualizar: {update_data}")

    if not update_data or 'data' not in update_data:
        return jsonify({"success": False, "message": "Datos de actualización requeridos"}), 400

    # Filtrar campos que no se pueden editar en ERPNext
    filtered_data = update_data['data'].copy()

    # Campos que no se pueden cambiar una vez establecidos
    non_editable_fields = ['abbr', 'name']  # name es el ID único, abbr es la abreviatura

    # Mapear campos del frontend a campos de ERPNext
    field_mapping = {
        'numeroIIBB': 'custom_ingresos_brutos',
        'inscriptoConvenioMultilateral': 'custom_convenio_multilateral',
        'personeria': 'custom_personeria',
        'condicionIVA': 'custom_condicion_iva',
        'condicionIngresosBrutos': 'custom_condicion_ingresos_brutos',
        'jurisdiccionesIIBB': 'custom_jurisdicciones_iibb',
        'condicionGanancias': 'custom_condicion_ganancias',
        'defaultIvaVentas': 'custom_default_iva_ventas',
        'defaultIvaCompras': 'custom_default_iva_compras',
        'defaultPayableAccount': 'default_payable_account',
        'defaultExpenseAccount': 'default_expense_account',
        'mesCierreContable': 'custom_mes_cierre',
        'default_warehouse': 'custom_default_warehouse',
        'custom_default_warehouse': 'custom_default_warehouse'
    }

    # Transformar campos según el mapeo y formatear fecha de cierre
    mapped_data = {}
    for frontend_field, backend_field in field_mapping.items():
        if frontend_field in filtered_data:
            mapped_data[backend_field] = filtered_data[frontend_field]

    # Agregar campos que no necesitan mapeo
    for field, value in filtered_data.items():
        if field not in field_mapping:
            mapped_data[field] = value

    # Guardar mes de cierre para Fiscal Year si está presente
    mes_cierre = mapped_data.get('custom_mes_cierre')

    # Remover campos no editables
    for field in non_editable_fields:
        if field in mapped_data:
            del mapped_data[field]
            print(f"Campo '{field}' removido de la actualización (no editable)")

    # Si no quedan campos para actualizar
    if not mapped_data:
        return jsonify({"success": False, "message": "No hay campos editables para actualizar"}), 400

    # Reemplazar filtered_data con mapped_data
    filtered_data = mapped_data

    sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')
    print(f"Token SID obtenido: {sid_token}")

    try:
        print(f"Actualizando empresa '{company_name}' en ERPNext...")
        print(f"Usando SID token: {sid_token[:10]}...")
        print(f"Datos filtrados a enviar: {filtered_data}")

        # Hacer la petición PUT a ERPNext para actualizar la empresa
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            data={"data": filtered_data},
            operation_name=f"Update company {company_name}"
        )

        if error:
            print(f"Error actualizando empresa: {error}")
            return handle_erpnext_error(error, "Error al actualizar empresa")

        # ERPNext devuelve los datos actualizados de la empresa
        updated_company_data = response.json()

        print(f"Empresa '{company_name}' actualizada exitosamente")

        # Actualizar Fiscal Year si hay mes de cierre
        if mes_cierre:
            try:
                print("Actualizando Fiscal Year para la empresa...")
                fiscal_year_name = get_or_create_fiscal_year(session, headers, company_name, mes_cierre)
                if fiscal_year_name:
                    assign_fiscal_year_to_company(session, headers, company_name, fiscal_year_name)
                    print("Fiscal Year actualizado exitosamente")
                    
                    # Volver a consultar la compañía para obtener los datos actualizados con el Fiscal Year
                    print("Reconsultando compañía para obtener datos actualizados...")
                    # Build fields list and pass via params to avoid nested quoting
                    updated_fields = [
                        "name",
                        "company_name",
                        "country",
                        "default_currency",
                        "default_payable_account",
                        "default_expense_account",
                        "custom_default_iva_ventas",
                        "custom_default_iva_compras",
                        "custom_default_warehouse",
                        "default_cash_account",
                        "round_off_account",
                        "exchange_gain_loss_account",
                        "abbr"
                    ]
                    updated_response, updated_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Company/{company_name}",
                        params={
                            'fields': json.dumps(updated_fields)
                        },
                        operation_name=f"Reconsult company '{company_name}' after Fiscal Year update"
                    )

                    if updated_error:
                        print(f"Error al reconsultar compañía: {updated_error}")
                    elif updated_response and updated_response.status_code == 200:
                        updated_company_data = updated_response.json()
                        # Agregar el Fiscal Year encontrado a los datos de la compañía
                        fiscal_year_data_found = get_fiscal_year_for_company(session, headers, company_name)
                        if fiscal_year_data_found:
                            updated_company_data["data"]["fiscal_year"] = fiscal_year_data_found.get("name")
                        print(f"Compañía reconsultada exitosamente, fiscal_year: {updated_company_data.get('data', {}).get('fiscal_year')}")
                    else:
                        print(f"Error al reconsultar compañía: {updated_response.status_code if updated_response else 'No response'}")
                else:
                    print("Error al actualizar Fiscal Year")
            except Exception as fiscal_error:
                print(f"Error al actualizar Fiscal Year: {fiscal_error}")
                # No fallar la actualización por error en Fiscal Year

        # Verificar si se enviaron campos de IVA y crear plantillas si es necesario
        iva_fields_present = any(key in filtered_data for key in ['custom_default_iva_ventas', 'custom_default_iva_compras'])
        if iva_fields_present:
            try:
                print("Verificando/creando plantillas de Item Tax Template...")
                from routes.Configuracion.setup import ensure_item_tax_templates_exist_v2 as ensure_item_tax_templates_exist
                tax_templates_result = ensure_item_tax_templates_exist(session, headers, user_id)
                if tax_templates_result.get('success'):
                    print("Plantillas de Item Tax Template verificadas/creadas exitosamente")
                else:
                    print(f"Error al procesar plantillas de Item Tax Template: {tax_templates_result.get('message')}")
            except Exception as tax_error:
                print(f"Error al verificar plantillas de Item Tax Template: {tax_error}")
                # No fallar la actualización por error en plantillas

        return jsonify({"success": True, "data": updated_company_data.get("data", {}), "message": "Empresa actualizada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        try:
            error_detail = err.response.json()
            # Manejar errores específicos de ERPNext
            if 'CannotChangeConstantError' in str(error_detail):
                return jsonify({"success": False, "message": "Algunos campos no se pueden modificar una vez establecidos"}), 400
            return jsonify({"success": False, "message": error_detail.get("message", "Error al actualizar empresa")}), 500
        except:
            return jsonify({"success": False, "message": "Error al actualizar empresa"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@companies_bp.route('/api/companies/<company_name>', methods=['DELETE'])
def delete_company(company_name):
    """Elimina una empresa específica de ERPNext"""
    print(f"\n--- Petición de eliminar empresa '{company_name}' recibida ---")

    # Debug: Mostrar headers y cookies recibidas
    print(f"Headers recibidos: {dict(request.headers)}")
    print(f"Cookies recibidas: {request.cookies}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')
    print(f"Token SID obtenido: {sid_token}")

    try:
        print(f"Eliminando empresa '{company_name}' de ERPNext...")
        print(f"Usando SID token: {sid_token[:10]}...")

        # PRIMERO: Remover la compañía del Fiscal Year si existe
        fiscal_year_name = None
        fiscal_year_data = get_fiscal_year_for_company(session, headers, company_name)
        if fiscal_year_data:
            fiscal_year_name = fiscal_year_data.get('name')
            print(f"Encontrado Fiscal Year '{fiscal_year_name}' para compañía '{company_name}'")
            # Remover la compañía del Fiscal Year
            try:
                from utils.http_utils import make_erpnext_request, handle_erpnext_error

                # Leer el Fiscal Year actual
                fiscal_year_response, fiscal_year_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Fiscal%20Year/{fiscal_year_name}",
                    operation_name=f"Get Fiscal Year '{fiscal_year_name}' for company removal"
                )

                if fiscal_year_error:
                    error_response = handle_erpnext_error(fiscal_year_error, f"Failed to get Fiscal Year '{fiscal_year_name}'")
                    if error_response:
                        print(f"Error al leer Fiscal Year: {fiscal_year_error}")
                        # Continuar de todos modos
                elif fiscal_year_response and fiscal_year_response.status_code == 200:
                    fiscal_year_data = fiscal_year_response.json().get("data", {})
                    companies = fiscal_year_data.get("companies", [])

                    print(f"Fiscal Year tiene {len(companies)} compañías")

                    # Si solo hay una compañía, intentar borrar el Fiscal Year completo
                    if len(companies) == 1:
                        print("Solo hay una compañía, intentando borrar el Fiscal Year completo")
                        delete_fy_response, delete_fy_error = make_erpnext_request(
                            session=session,
                            method="DELETE",
                            endpoint=f"/api/resource/Fiscal%20Year/{fiscal_year_name}",
                            operation_name=f"Delete Fiscal Year '{fiscal_year_name}'"
                        )

                        if delete_fy_error:
                            print(f"Error al borrar Fiscal Year: {delete_fy_error}")
                        elif delete_fy_response and delete_fy_response.status_code in [200, 202]:
                            print(f"Fiscal Year '{fiscal_year_name}' borrado exitosamente")
                        else:
                            print(f"Error al borrar Fiscal Year: {delete_fy_response.text if delete_fy_response else 'No response'}")
                    else:
                        # Si hay múltiples compañías, remover solo esta compañía
                        print("Múltiples compañías, removiendo solo esta compañía")
                        updated_companies = [comp for comp in companies if comp.get("company") != company_name]

                        # Actualizar el Fiscal Year
                        update_response, update_error = make_erpnext_request(
                            session=session,
                            method="PUT",
                            endpoint=f"/api/resource/Fiscal%20Year/{fiscal_year_name}",
                            data={"data": {"companies": updated_companies}},
                            operation_name=f"Remove company from Fiscal Year '{fiscal_year_name}'"
                        )

                        if update_error:
                            print(f"Error al actualizar Fiscal Year: {update_error}")
                            # Si falla, intentar desvincular de la compañía
                            unlink_response, unlink_error = make_erpnext_request(
                                session=session,
                                method="PUT",
                                endpoint=f"/api/resource/Company/{company_name}",
                                data={"data": {"default_fiscal_year": ""}},
                                operation_name=f"Unlink Fiscal Year from company '{company_name}'"
                            )
                            print(f"Intento de desvinculación: {unlink_response.status_code if unlink_response else 'No response'}")
                        elif update_response and update_response.status_code in [200, 201]:
                            print(f"Compañía removida del Fiscal Year '{fiscal_year_name}' exitosamente")
                        else:
                            print(f"Error al actualizar Fiscal Year: {update_response.text if update_response else 'No response'}")
                else:
                    print(f"Error al leer Fiscal Year: {fiscal_year_response.status_code if fiscal_year_response else 'No response'}")
            except Exception as fy_error:
                print(f"Error al manejar Fiscal Year: {fy_error}")
                # Continuar de todos modos con el borrado
        else:
            print(f"No se encontró Fiscal Year para compañía '{company_name}'")

        # SEGUNDO: Eliminar direcciones asociadas a la compañía
        try:
            print(f"Eliminando direcciones asociadas a la compañía '{company_name}'...")

            # Obtener todas las direcciones (solo nombres y títulos primero)
            # Use params to pass fields and pagination
            address_fields_list = ["name", "address_title"]
            addresses_response, addresses_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Address",
                params={
                    'fields': json.dumps(address_fields_list),
                    'limit_page_length': 1000
                },
                operation_name="Get all addresses for company deletion"
            )

            if addresses_error:
                print(f"Error al obtener direcciones: {addresses_error}")
            elif addresses_response and addresses_response.status_code == 200:
                addresses_data = addresses_response.json()
                all_addresses = addresses_data.get("data", [])

                # Filtrar direcciones que estén vinculadas a la compañía (obtener datos completos para links)
                linked_addresses = []
                for address in all_addresses:
                    address_name = address.get("name")
                    
                    # Obtener datos completos de la dirección para acceder a links
                    full_address_response, full_address_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Address/{quote(address_name)}",
                        operation_name=f"Get full address data for '{address_name}'"
                    )
                    
                    if full_address_error:
                        print(f"Error al obtener dirección '{address_name}': {full_address_error}")
                    elif full_address_response and full_address_response.status_code == 200:
                        full_address_data = full_address_response.json().get("data", {})
                        links = full_address_data.get("links", [])
                        
                        if isinstance(links, list):
                            for link in links:
                                if (link.get("link_doctype") == "Company" and
                                    link.get("link_name") == company_name):
                                    linked_addresses.append(full_address_data)
                                    break
                    else:
                        print(f"Error al obtener dirección '{address_name}': {full_address_response.status_code if full_address_response else 'No response'}")

                print(f"Encontradas {len(linked_addresses)} direcciones asociadas")

                # Eliminar cada dirección vinculada
                for address in linked_addresses:
                    address_name = address.get("name")
                    address_title = address.get("address_title", address_name)

                    try:
                        print(f"Eliminando dirección '{address_title}'...")
                        delete_address_response, delete_address_error = make_erpnext_request(
                            session=session,
                            method="DELETE",
                            endpoint=f"/api/resource/Address/{quote(address_name)}",
                            operation_name=f"Delete address '{address_title}'"
                        )

                        if delete_address_error:
                            print(f"Error al eliminar dirección '{address_title}': {delete_address_error}")
                        elif delete_address_response and delete_address_response.status_code in [200, 202]:
                            print(f"Dirección '{address_title}' eliminada exitosamente")
                        else:
                            print(f"Error al eliminar dirección '{address_title}': {delete_address_response.text if delete_address_response else 'No response'}")
                            # Continuar con las demás direcciones

                    except Exception as addr_error:
                        print(f"Error al eliminar dirección '{address_title}': {addr_error}")
                        # Continuar con las demás direcciones

                print(f"Proceso de eliminación de direcciones completado")

            else:
                print(f"Error al obtener direcciones: {addresses_response.status_code if addresses_response else 'No response'}")

        except Exception as addresses_error:
            print(f"Error al manejar direcciones asociadas: {addresses_error}")
            # Continuar de todos modos con el borrado

        # CUARTO: Verificar que la compañía aún existe antes de borrarla
        try:
            check_response, check_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Company/{company_name}",
                operation_name=f"Check if company '{company_name}' still exists"
            )

            if check_error:
                if check_error.get('status_code') == 404:
                    print(f"La compañía '{company_name}' ya no existe o ya fue borrada")
                    return jsonify({"success": True, "message": f"La compañía '{company_name}' ya fue eliminada anteriormente"})
                else:
                    print(f"Error al verificar existencia de compañía: {check_error}")
                    return jsonify({"success": False, "message": "Error al verificar la compañía"}), 500
            elif check_response and check_response.status_code == 404:
                print(f"La compañía '{company_name}' ya no existe o ya fue borrada")
                return jsonify({"success": True, "message": f"La compañía '{company_name}' ya fue eliminada anteriormente"})
            elif check_response and check_response.status_code != 200:
                print(f"Error al verificar existencia de compañía: {check_response.status_code}")
                return jsonify({"success": False, "message": "Error al verificar la compañía"}), 500
            else:
                print(f"Compañía '{company_name}' confirmada como existente")
        except Exception as check_error:
            print(f"Error al verificar compañía: {check_error}")
            # Continuar de todos modos

        # CUARTO: Hacer la petición DELETE a ERPNext para eliminar la empresa
        response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            operation_name=f"Delete company {company_name}"
        )

        if error:
            print(f"Error eliminando empresa: {error}")
            return handle_erpnext_error(error, "Error al eliminar empresa")

        print(f"Empresa '{company_name}' eliminada exitosamente")

        # SEXTO: Remover la empresa del archivo de empresas activas
        remove_success = remove_company_from_active(user_id, company_name)
        if remove_success:
            print(f"Empresa '{company_name}' removida exitosamente del archivo de empresas activas")
        else:
            print(f"Advertencia: No se pudo remover la empresa '{company_name}' del archivo de empresas activas")

        return jsonify({"success": True, "message": f"Empresa '{company_name}' eliminada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        try:
            error_detail = err.response.json()
            return jsonify({"success": False, "message": error_detail.get("message", "Error al eliminar empresa")}), 500
        except:
            return jsonify({"success": False, "message": "Error al eliminar empresa"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500


def create_custom_company_fields(session, headers):
    """Crea los campos custom necesarios para la empresa si no existen"""
    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    custom_fields = [
        {
            "dt": "Company",
            "label": "Ingresos Brutos",
            "fieldname": "custom_ingresos_brutos",
            "fieldtype": "Data",
            "insert_after": "tax_id"
        },
        {
            "dt": "Company",
            "label": "Convenio Multilateral",
            "fieldname": "custom_convenio_multilateral",
            "fieldtype": "Check",
            "insert_after": "custom_ingresos_brutos"
        }
    ]

    for field_data in custom_fields:
        try:
            fieldname = field_data['fieldname']
            dt = field_data['dt']

            # Verificar si el campo ya existe
            # Build filters as JSON and pass via params to avoid encoding issues
            check_filters = [["fieldname", "=", fieldname], ["dt", "=", dt]]
            check_response, check_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Custom%20Field",
                params={
                    'filters': json.dumps(check_filters),
                    'limit_page_length': 1
                },
                operation_name=f"Check if custom field '{fieldname}' exists"
            )

            if check_error:
                error_response = handle_erpnext_error(check_error, f"Failed to check if custom field '{fieldname}' exists")
                if error_response:
                    print(f"Error checking custom field '{fieldname}': {check_error}")
                    continue

            if check_response and check_response.get('data'):
                print(f"Campo custom '{fieldname}' ya existe")
                continue

            print(f"Creando campo custom '{fieldname}'...")

            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom%20Field",
                data={"data": field_data},
                operation_name=f"Create custom field '{fieldname}'"
            )

            if create_error:
                error_response = handle_erpnext_error(create_error, f"Failed to create custom field '{fieldname}'")
                if error_response:
                    print(f"Advertencia al crear campo '{fieldname}': {create_error}")
                    continue

            if create_response and create_response.status_code in [200, 201]:
                print(f"Campo custom '{fieldname}' creado exitosamente")
            else:
                print(f"Advertencia al crear campo '{fieldname}': {create_response.text if create_response else 'No response'}")

        except Exception as e:
            print(f"Error procesando campo custom '{field_data.get('fieldname', 'unknown')}': {e}")
            # Continuar con el siguiente campo
            continue

    return True


@companies_bp.route('/api/companies', methods=['POST'])
def create_company():
    """Crea una nueva empresa en ERPNext"""
    print("\n--- Petición de crear empresa recibida ---")

    # Debug: Mostrar headers y cookies recibidas
    print(f"Headers recibidos: {dict(request.headers)}")
    print(f"Cookies recibidas: {request.cookies}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Asegurar System Settings básicos antes de crear cualquier compañía
    try:
        sys_settings_result = apply_initial_system_settings(session, headers, None)
        if not sys_settings_result.get("success"):
            message = sys_settings_result.get("message", "No se pudieron aplicar System Settings")
            print(f"ERROR: {message}")
            return jsonify({"success": False, "message": message}), 500
        print("System Settings verificados/aplicados antes de crear la compañía")
    except Exception as sys_exc:
        print(f"Error aplicando System Settings iniciales: {sys_exc}")
        return jsonify({"success": False, "message": "Error aplicando System Settings iniciales"}), 500

    # Obtener los datos de la nueva empresa del body de la petición
    company_data = request.get_json()
    print(f"Datos de la nueva empresa: {company_data}")

    if not company_data or 'data' not in company_data:
        return jsonify({"success": False, "message": "Datos de la empresa requeridos"}), 400

    # Extraer datos de warehouse si existen
    warehouse_info = company_data.get('warehouse')
    print(f"Datos de warehouse: {warehouse_info}")

    sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')
    print(f"Token SID obtenido: {sid_token}")

    # Variable para almacenar el nombre del warehouse creado
    created_warehouse_name = None
    pending_warehouse = None

    try:
        from utils.http_utils import make_erpnext_request, handle_erpnext_error

        # PRIMERO: Verificar y crear warehouse type "Transit" si no existe
        print("Verificando existencia del warehouse type 'Transit'...")
        type_response, type_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Warehouse%20Type",
            params={
                'filters': json.dumps([["name", "=", "Transit"]])
            },
            operation_name="Check if warehouse type 'Transit' exists"
        )

        if type_error:
            print(f"Error verificando warehouse type 'Transit': {type_error}")
        elif type_response and type_response.status_code == 200:
            existing_types = type_response.json().get("data", [])
            if not existing_types:
                print("Creando warehouse type 'Transit'...")
                type_create_response, type_create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Warehouse%20Type",
                    data={"data": {"name": "Transit", "warehouse_type_name": "Transit"}},
                    operation_name="Create warehouse type 'Transit'"
                )

                if type_create_error:
                    print(f"Error al crear warehouse type 'Transit': {type_create_error}")
                elif type_create_response and type_create_response.status_code in [200, 201]:
                    print("Warehouse type 'Transit' creado exitosamente")
                else:
                    print(f"Error al crear warehouse type 'Transit': {type_create_response.text if type_create_response else 'No response'}")
            else:
                print("Warehouse type 'Transit' ya existe")

        # SEGUNDO: Verificar y crear Address Template por defecto si no existe
        print("Verificando existencia de Address Template por defecto...")
        template_response, template_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Address%20Template",
            params={
                'filters': json.dumps([["is_default", "=", 1]])
            },
            operation_name="Check if default address template exists"
        )

        if template_error:
            print(f"Error verificando Address Template por defecto: {template_error}")
        elif template_response and template_response.status_code == 200:
            existing_templates = template_response.json().get("data", [])
            if not existing_templates:
                print("Creando Address Template por defecto...")
                template_create_response, template_create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Address%20Template",
                    data={
                        "data": {
                            "country": "Argentina",
                            "is_default": 1,
                            "template": "{{ address_line1 }}<br>{{ city }}<br>{{ state }} {{ pincode }}<br>{{ country }}"
                        }
                    },
                    operation_name="Create default address template"
                )

                if template_create_error:
                    print(f"Error al crear Address Template por defecto: {template_create_error}")
                elif template_create_response and template_create_response.status_code in [200, 201]:
                    print("Address Template por defecto creado exitosamente")
                else:
                    print(f"Error al crear Address Template por defecto: {template_create_response.text if template_create_response else 'No response'}")
            else:
                print("Address Template por defecto ya existe")

        # TERCERO: Manejar warehouse si es necesario
        if warehouse_info:
            try:
                if 'existing_warehouse' in warehouse_info:
                    # Usar warehouse existente - verificar que pertenezca a la empresa
                    warehouse_name = warehouse_info['existing_warehouse']
                    print(f"Verificando warehouse existente '{warehouse_name}' para empresa '{company_data['data']['name']}'...")

                    warehouse_check_response, warehouse_check_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Warehouse/{warehouse_name}",
                        operation_name=f"Check existing warehouse '{warehouse_name}'"
                    )

                    if warehouse_check_error:
                        print(f"Advertencia: No se pudo verificar el warehouse '{warehouse_name}': {warehouse_check_error}")
                    elif warehouse_check_response and warehouse_check_response.status_code == 200:
                        warehouse_data = warehouse_check_response.json().get("data", {})
                        if warehouse_data.get("company") != company_data['data']['name']:
                            print(f"Advertencia: Warehouse '{warehouse_name}' no pertenece a la empresa '{company_data['data']['name']}'")
                        else:
                            print(f"Warehouse '{warehouse_name}' verificado correctamente")
                    else:
                        print(f"Advertencia: No se pudo verificar el warehouse '{warehouse_name}'")

                elif 'name' in warehouse_info:
                    # Guardar información del warehouse para crearlo DESPUÉS de la empresa
                    warehouse_name = warehouse_info['name']
                    warehouse_type = warehouse_info.get('warehouse_type', 'Transit')
                    print(f"Preparando creación de warehouse '{warehouse_name}' tipo '{warehouse_type}' después de crear empresa...")

                    # 1. Crear el tipo de warehouse si no existe
                    type_response, type_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint="/api/resource/Warehouse%20Type",
                        params={
                            'filters': json.dumps([["name", "=", warehouse_type]])
                        },
                        operation_name=f"Check if warehouse type '{warehouse_type}' exists"
                    )

                    if type_error:
                        print(f"Advertencia: Error verificando tipo de warehouse '{warehouse_type}': {type_error}")
                    elif type_response and type_response.status_code == 200:
                        existing_types = type_response.json().get("data", [])
                        if not existing_types:
                            print(f"Creando tipo de warehouse '{warehouse_type}'...")
                            type_create_response, type_create_error = make_erpnext_request(
                                session=session,
                                method="POST",
                                endpoint="/api/resource/Warehouse%20Type",
                                data={"data": {"name": warehouse_type, "warehouse_type_name": warehouse_type}},
                                operation_name=f"Create warehouse type '{warehouse_type}'"
                            )

                            if type_create_error:
                                print(f"Advertencia: No se pudo crear el tipo de warehouse '{warehouse_type}': {type_create_error}")
                            elif type_create_response and type_create_response.status_code not in [200, 201]:
                                print(f"Advertencia: No se pudo crear el tipo de warehouse '{warehouse_type}'")
                            else:
                                print(f"Tipo de warehouse '{warehouse_type}' creado exitosamente")

                    # Guardar información para crear warehouse después
                    pending_warehouse = {
                        'name': warehouse_name,
                        'warehouse_type': warehouse_type
                    }

            except Exception as warehouse_error:
                print(f"Error al manejar warehouse: {warehouse_error}")
                # Continuar con la creación de empresa

        # SEGUNDO: Procesar y mapear los datos de la empresa
        empresa_data = company_data['data'].copy()
        
        # Mapear campos del frontend a campos de ERPNext (usando el mismo mapeo que en actualización)
        field_mapping = {
            'numeroIIBB': 'custom_ingresos_brutos',
            'inscriptoConvenioMultilateral': 'custom_convenio_multilateral',
            'personeria': 'custom_personeria',
            'condicionIVA': 'custom_condicion_iva',
            'condicionIngresosBrutos': 'custom_condicion_ingresos_brutos',
            'jurisdiccionesIIBB': 'custom_jurisdicciones_iibb',
            'condicionGanancias': 'custom_condicion_ganancias',
            'defaultIvaVentas': 'custom_default_iva_ventas',
            'defaultIvaCompras': 'custom_default_iva_compras',
            'mesCierreContable': 'custom_mes_cierre',
            'default_warehouse': 'custom_default_warehouse',
            'custom_default_warehouse': 'custom_default_warehouse'
        }

        # Aplicar el mapeo de campos
        for frontend_field, backend_field in field_mapping.items():
            if frontend_field in empresa_data:
                empresa_data[backend_field] = empresa_data.pop(frontend_field)
        
        # Guardar mes de cierre para Fiscal Year (por defecto diciembre si no se especifica)
        mes_cierre = empresa_data.get('custom_mes_cierre', '12')

        empresa_data.update({
                'country': 'Argentina',
                'language': 'es-AR',
                'default_currency': 'ARS',
                'time_zone': 'America/Argentina/Buenos_Aires',
                'create_chart_of_accounts_based_on': 'Argentina - Chart of Accounts',
                'chart_of_accounts': 'Argentina - Chart of Accounts'
            })
        # Antes de crear la compañía, asegurarnos de que el custom field custom_personeria
        # tenga la opción enviada por el frontend para evitar validaciones en ERPNext.
        try:
            from routes.Configuracion.setup_afip_utils import ensure_custom_field_has_option
            incoming_personeria = empresa_data.get('custom_personeria', '')
            if incoming_personeria:
                ok = ensure_custom_field_has_option(session, headers, 'Company', 'custom_personeria', incoming_personeria, ERPNEXT_URL)
                if not ok:
                    print('No se pudo asegurar custom_personeria antes de crear la compañía, procediendo de todas formas')
                # Always try to fetch and log current Custom Field options for debugging
                try:
                    from utils.http_utils import make_erpnext_request, handle_erpnext_error

                    cf_filters = [["dt", "=", "Company"], ["fieldname", "=", "custom_personeria"]]
                    cf_response, cf_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint="/api/resource/Custom%20Field",
                        params={
                            'filters': json.dumps(cf_filters),
                            'fields': json.dumps(["name", "options"]),
                            'limit_page_length': 1
                        },
                        operation_name="Check current custom_personeria Custom Field options"
                    )

                    if cf_error:
                        print(f'No se pudo consultar Custom Field custom_personeria: {cf_error}')
                    elif cf_response and cf_response.status_code == 200:
                        cf_data = cf_response.json().get('data', [])
                        if cf_data:
                            cf = cf_data[0]
                            print(f"Custom Field 'custom_personeria' actual en ERPNext: name={cf.get('name')}, options=\n{cf.get('options')}\n")
                        else:
                            print('Custom Field custom_personeria no encontrada via query después de ensure call')
                    else:
                        print(f'No se pudo consultar Custom Field custom_personeria: {cf_response.status_code if cf_response else "No response"} - {cf_response.text if cf_response else "No response"}')
                except Exception as e:
                    print(f'Error consultando Custom Field custom_personeria: {e}')
        except Exception as ensure_e:
            print(f"Error asegurando custom_personeria: {ensure_e}")

        print("Creando nueva empresa en ERPNext...")
        print(f"Usando SID token: {sid_token[:10]}...")

        # Hacer la petición POST a ERPNext para crear la empresa
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Company",
            data={"data": empresa_data},
            operation_name="Create company"
        )

        if error:
            status_code = error.get('status_code', 500)
            if status_code == 401:
                return jsonify({"success": False, "message": "Sesión expirada"}), 401
            elif status_code == 403:
                return jsonify({"success": False, "message": "No tienes permisos para crear empresas"}), 403
            elif status_code == 409:
                return jsonify({"success": False, "message": "Ya existe una empresa con ese nombre"}), 409
            else:
                return jsonify({"success": False, "message": error.get('message', 'Error al crear empresa')}), status_code

        # ERPNext devuelve los datos de la empresa creada
        new_company_data = response.json()
        company_name = new_company_data.get("data", {}).get("name")

        print(f"Empresa '{company_name}' creada exitosamente")

        # SEXTO: Crear o actualizar Fiscal Year (siempre se crea uno por defecto)
        try:
            print("Creando Fiscal Year para la empresa...")
            fiscal_year_name = get_or_create_fiscal_year(session, headers, company_name, mes_cierre)
            if fiscal_year_name:
                assign_fiscal_year_to_company(session, headers, company_name, fiscal_year_name)
                print("Fiscal Year creado y asignado exitosamente")
            else:
                print("Error al crear Fiscal Year")
        except Exception as fiscal_error:
            print(f"Error al crear/asignar Fiscal Year: {fiscal_error}")
            # No fallar la creación de empresa por error en Fiscal Year

        # TERCERO: Crear warehouse si estaba pendiente
        if pending_warehouse:
            try:
                print(f"Creando warehouse '{pending_warehouse['name']}' para empresa '{company_name}'...")

                warehouse_create_response, warehouse_create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Warehouse",
                    data={
                        "data": {
                            "warehouse_name": pending_warehouse['name'],
                            "warehouse_type": pending_warehouse['warehouse_type'],
                            "company": company_name,
                            "is_group": 0
                        }
                    },
                    operation_name=f"Create warehouse '{pending_warehouse['name']}' for company '{company_name}'"
                )

                if warehouse_create_error:
                    print(f"Error al crear warehouse '{pending_warehouse['name']}': {warehouse_create_error}")
                elif warehouse_create_response and warehouse_create_response.status_code in [200, 201]:
                    print(f"Warehouse '{pending_warehouse['name']}' creado exitosamente para empresa '{company_name}'")
                    created_warehouse_name = pending_warehouse['name']
                else:
                    print(f"Error al crear warehouse '{pending_warehouse['name']}': {warehouse_create_response.text if warehouse_create_response else 'No response'}")

            except Exception as warehouse_error:
                print(f"Error al crear warehouse pendiente: {warehouse_error}")
                # No fallar la creación de empresa por error en warehouse

        # CUARTO: Crear campos custom necesarios para la empresa
        try:
            print("Creando campos custom para la empresa...")
            # NOTA: Los campos custom se crean UNA SOLA VEZ durante la configuración inicial completa
            # Crear campos básicos de companies.py
            # create_custom_company_fields(session, headers)
            # Crear campos de IVA de setup.py
            # Campos custom deshabilitados según requerimiento del usuario
            print("Campos custom se crean durante la configuración inicial completa")
        except Exception as custom_error:
            print(f"Error al crear campos custom: {custom_error}")
            # No fallar la creación de empresa por error en campos custom

        # QUINTO: Crear grupos de ítems por defecto
        try:
            print("Creando grupos de ítems por defecto...")
            from routes.items import ensure_item_groups_exist
            item_groups_created = ensure_item_groups_exist(session, headers, user_id)
            if item_groups_created:
                print("Grupos de ítems 'All Item Groups' y 'Services' creados o ya existían")
            else:
                print("Error al crear grupos de ítems por defecto")

        except Exception as item_error:
            print(f"Error al crear grupos de ítems: {item_error}")
            # No fallar la creación de empresa por error en grupos de ítems

        # SEXTO: Crear cuentas de impuestos y plantillas
        try:
            print("Creando cuentas de impuestos y plantillas...")
            from routes.taxes import create_tax_accounts_util
            from routes.Configuracion.setup import ensure_item_tax_templates_exist_v2 as ensure_item_tax_templates_exist

            # Crear cuentas de impuestos
            tax_accounts_result = create_tax_accounts_util(session, headers, user_id)
            if tax_accounts_result.get('success'):
                print("Cuentas de impuestos creadas exitosamente")
            else:
                print(f"Error al crear cuentas de impuestos: {tax_accounts_result.get('message')}")

            # Crear plantillas de impuestos
            tax_templates_result = ensure_item_tax_templates_exist(session, headers, user_id)
            if tax_templates_result.get('success'):
                print("Plantillas de Item Tax Template creadas exitosamente")
            else:
                print(f"Error al crear plantillas de impuestos: {tax_templates_result.get('message')}")

        except Exception as tax_error:
            print(f"Error al crear cuentas/plantillas de impuestos: {tax_error}")
            # No fallar la creación de empresa por error en impuestos

        # Reconsultar la compañía para obtener datos actualizados con Fiscal Year
        if mes_cierre:
            try:
                print("Reconsultando compañía para obtener datos actualizados...")
                final_response, final_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Company/{company_name}",
                    operation_name=f"Re-query company '{company_name}' for updated data"
                )

                if final_error:
                    print(f"Error al reconsultar compañía: {final_error}")
                elif final_response and final_response.status_code == 200:
                    new_company_data = final_response.json()
                    print(f"Compañía reconsultada exitosamente, fiscal_year: {new_company_data.get('data', {}).get('default_fiscal_year')}")
                else:
                    print(f"Error al reconsultar compañía: {final_response.status_code if final_response else 'No response'}")
            except Exception as reconsult_error:
                print(f"Error al reconsultar compañía: {reconsult_error}")

        return jsonify({"success": True, "data": new_company_data.get("data", {}), "message": "Empresa creada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        try:
            error_detail = err.response.json()
            return jsonify({"success": False, "message": error_detail.get("message", "Error al crear empresa")}), 500
        except:
            return jsonify({"success": False, "message": "Error al crear empresa"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@companies_bp.route('/api/active-company', methods=['GET'])
def get_active_company():
    """Obtiene la empresa activa del usuario actual"""
    print("🔍 Obteniendo empresa activa")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    print(f"Obteniendo empresa activa para usuario {user_id}")

    try:
        # Obtener la compañía activa del usuario
        user_active_company = get_central_active_company(user_id)

        if user_active_company:
            print(f"Empresa activa encontrada: {user_active_company}")
            
            # Obtener detalles completos de la empresa desde ERPNext
            try:
                from utils.http_utils import make_erpnext_request, handle_erpnext_error

                # Build fields list and pass via params
                fields = [
                    "name",
                    "company_name",
                    "country",
                    "default_currency",
                    "default_payable_account",
                    "default_expense_account",
                    "custom_default_iva_ventas",
                    "custom_default_iva_compras",
                    "custom_default_warehouse",
                    "default_cash_account",
                    "round_off_account",
                    "exchange_gain_loss_account",
                    "abbr"
                ]
                response, error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Company/{quote(user_active_company)}",
                    params={
                        'fields': json.dumps(fields)
                    },
                    operation_name=f"Get company details for '{user_active_company}'"
                )

                if error:
                    print(f"Error obteniendo detalles de empresa: {error}")
                    return handle_erpnext_error(error, "Error al obtener detalles de empresa activa")
                elif response and response.status_code == 200:
                    company_details = response.json().get('data', {})
                    print(f"Detalles de empresa obtenidos: {company_details.get('name')}")
                    if not company_details.get("default_currency"):
                        return jsonify({
                            "success": False,
                            "message": f"La empresa '{user_active_company}' no tiene moneda por defecto definida (default_currency)"
                        }), 400
                    return jsonify({
                        "success": True,
                        "data": {
                            "active_company": user_active_company,
                            "company_details": company_details
                        }
                    })
                else:
                    print(f"Error obteniendo detalles de empresa: {response.status_code if response else 'No response'}")
                    return jsonify({
                        "success": False,
                        "message": "Error al obtener detalles de empresa activa"
                    }), 502
            except Exception as e:
                print(f"Error obteniendo detalles de empresa: {e}")
                return jsonify({
                    "success": False,
                    "message": "Error al obtener detalles de empresa activa"
                }), 500
        else:
            print(f"No hay empresa activa configurada para usuario {user_id}")
            return jsonify({
                "success": True,
                "data": {"active_company": None},
                "message": "No hay empresa activa configurada"
            })

    except Exception as e:
        print(f"Error al obtener empresa activa: {e}")
        return jsonify({"success": False, "message": "Error al obtener empresa activa"}), 500

@companies_bp.route('/api/active-company', methods=['POST'])
def set_active_company():
    """Establece la empresa activa para el usuario actual"""
    print("\n--- Petición de establecer empresa activa recibida ---")

    # Debug: Mostrar headers y cookies recibidas
    print(f"Headers recibidos: {dict(request.headers)}")
    print(f"Cookies recibidas: {request.cookies}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos del body
    data = request.get_json()
    print(f"Datos recibidos: {data}")
    company_name = data.get('company_name') if data else None

    if not company_name:
        return jsonify({"success": False, "message": "Nombre de empresa requerido"}), 400

    print(f"Estableciendo empresa activa '{company_name}' para usuario {user_id}")

    try:
        # Cargar empresas activas actuales (esto incluye todas las secciones del archivo)
        active_data = load_active_companies()
        
        # Asegurarse de que existe la sección active_companies
        if "active_companies" not in active_data:
            active_data["active_companies"] = {}
        
        # Actualizar la empresa activa del usuario (solo esta sección)
        active_data["active_companies"][user_id] = company_name

        # Guardar los cambios preservando todas las secciones
        if save_active_companies(active_data):
            print(f"Empresa activa '{company_name}' establecida para usuario {user_id}")
            return jsonify({
                "success": True,
                "message": f"Empresa '{company_name}' establecida como activa"
            })
        else:
            return jsonify({"success": False, "message": "Error al guardar empresa activa"}), 500

    except Exception as e:
        print(f"Error al establecer empresa activa: {e}")
        return jsonify({"success": False, "message": "Error al establecer empresa activa"}), 500

@companies_bp.route('/api/active-company', methods=['DELETE'])
def clear_active_company():
    """Elimina la empresa activa del usuario actual"""
    print("\n--- Petición de eliminar empresa activa recibida ---")

    # Debug: Mostrar headers y cookies recibidas
    print(f"Headers recibidos: {dict(request.headers)}")
    print(f"Cookies recibidas: {request.cookies}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    print(f"Eliminando empresa activa para usuario {user_id}")

    try:
        # Cargar empresas activas actuales (esto incluye todas las secciones del archivo)
        active_data = load_active_companies()
        
        # Asegurarse de que existe la sección active_companies
        if "active_companies" not in active_data:
            active_data["active_companies"] = {}

        # Eliminar la empresa activa del usuario si existe
        if user_id in active_data["active_companies"]:
            del active_data["active_companies"][user_id]
            if save_active_companies(active_data):
                print(f"Empresa activa eliminada para usuario {user_id}")
                return jsonify({
                    "success": True,
                    "message": "Empresa activa eliminada"
                })
            else:
                return jsonify({"success": False, "message": "Error al eliminar empresa activa"}), 500
        else:
            print(f"No había empresa activa configurada para usuario {user_id}")
            return jsonify({
                "success": True,
                "message": "No había empresa activa configurada"
            })

    except Exception as e:
        print(f"Error al eliminar empresa activa: {e}")
        return jsonify({"success": False, "message": "Error al eliminar empresa activa"}), 500

@companies_bp.route('/api/fiscal-years/<fiscal_year_name>', methods=['GET'])
def get_fiscal_year(fiscal_year_name):
    """Obtiene los datos de un Fiscal Year específico desde ERPNext"""
    print(f"\n--- Petición de obtener Fiscal Year '{fiscal_year_name}' recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    try:
        print(f"Obteniendo Fiscal Year '{fiscal_year_name}' desde ERPNext...")

        # Hacer la petición a ERPNext para obtener el Fiscal Year específico
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Fiscal Year/{fiscal_year_name}",
            operation_name=f"Get Fiscal Year '{fiscal_year_name}'"
        )

        if error:
            error_response = handle_erpnext_error(error, f"Failed to get Fiscal Year '{fiscal_year_name}'")
            if error_response:
                return error_response

        print(f"Respuesta de ERPNext: {response.status_code if response else 'No response'}")

        if response and response.status_code == 404:
            return jsonify({"success": False, "message": "Fiscal Year no encontrado"}), 404

        # ERPNext devuelve los datos del Fiscal Year
        fiscal_year_data = response.json() if response else {}

        print(f"Fiscal Year '{fiscal_year_name}' obtenido exitosamente")

        return jsonify({"success": True, "data": fiscal_year_data.get("data", {})})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": "Error al obtener Fiscal Year"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

@companies_bp.route('/api/companies/<company_name>/fiscal-year', methods=['GET'])
def get_company_fiscal_year(company_name):
    """Obtiene el Fiscal Year asociado a una compañía"""
    print(f"\n--- Petición de obtener Fiscal Year para compañía '{company_name}' ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        fiscal_year_data = get_fiscal_year_for_company(session, headers, company_name)
        if fiscal_year_data:
            print(f"Encontrado Fiscal Year '{fiscal_year_data.get('name')}' para compañía '{company_name}'")
            return jsonify({"success": True, "data": fiscal_year_data})
        else:
            print(f"No se encontró Fiscal Year para compañía '{company_name}'")
            return jsonify({"success": False, "message": "No fiscal year found"}), 404

    except Exception as e:
        print(f"Error obteniendo Fiscal Year para compañía: {e}")
        return jsonify({"success": False, "message": "Error interno"}), 500

def get_or_create_fiscal_year(session, headers, company_name, mes_cierre_contable):
    """Obtiene o crea un Fiscal Year para la compañía basado en el mes de cierre"""
    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    try:
        from datetime import datetime, timedelta

        # Convertir mes de cierre a nombre
        meses = {
            '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio',
            '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
        }

        mes_cierre = mes_cierre_contable.zfill(2) if mes_cierre_contable else '12'
        nombre_mes = meses.get(mes_cierre, 'Diciembre')

        # PRIMERO: Buscar el Fiscal Year más reciente para la compañía
        latest_fiscal_year = get_fiscal_year_for_company(session, headers, company_name)

        if latest_fiscal_year:
            # Si existe un Fiscal Year, crear el siguiente
            latest_end_date_str = latest_fiscal_year.get("year_end_date")
            if latest_end_date_str:
                latest_end_date = datetime.strptime(latest_end_date_str, "%Y-%m-%d").date()
                # El nuevo Fiscal Year comienza al día siguiente
                new_start_date = latest_end_date + timedelta(days=1)
                # El año del nuevo Fiscal Year es el año en que termina
                new_end_year = new_start_date.year if new_start_date.month <= int(mes_cierre) else new_start_date.year + 1
                fiscal_year_name = f"Ejercicio Cierre {nombre_mes} {new_end_year} - {company_name}"
            else:
                # Fallback si no hay fecha de fin
                current_year = datetime.now().year
                fiscal_year_name = f"Ejercicio Cierre {nombre_mes} {current_year} - {company_name}"
        else:
            # Si no existe ningún Fiscal Year, crear uno basado en el año actual
            current_year = datetime.now().year
            fiscal_year_name = f"Ejercicio Cierre {nombre_mes} {current_year} - {company_name}"

        print(f"Buscando Fiscal Year: '{fiscal_year_name}'")

        # PASO 1: Intentar obtener el Fiscal Year existente
        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Fiscal Year/{quote(fiscal_year_name)}",
            operation_name=f"Check if Fiscal Year '{fiscal_year_name}' exists"
        )

        # Normalize handler: prefer explicit response status check. Treat 404 as 'not found' and proceed to create.
        if check_response:
            if check_response.status_code == 200:
                # CASO B: El Fiscal Year ya existe, actualizarlo
                print(f"Fiscal Year '{fiscal_year_name}' ya existe, actualizando...")
                existing_data = check_response.json().get("data", {})
                current_companies = existing_data.get("companies", [])

                # Verificar si la compañía ya está en la lista
                company_exists = any(company.get("company") == company_name for company in current_companies)

                if not company_exists:
                    # Agregar la nueva compañía a la lista
                    current_companies.append({"company": company_name})

                    # Actualizar el Fiscal Year
                    update_data = {
                        "companies": current_companies
                    }

                    update_response, update_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/Fiscal Year/{quote(fiscal_year_name)}",
                        data=update_data,
                        operation_name=f"Update Fiscal Year '{fiscal_year_name}' with new company"
                    )

                    if update_error:
                        error_response = handle_erpnext_error(update_error, f"Failed to update Fiscal Year '{fiscal_year_name}'")
                        if error_response:
                            return None

                    if update_response and update_response.status_code == 200:
                        print(f"Fiscal Year '{fiscal_year_name}' actualizado exitosamente con nueva compañía")
                        return fiscal_year_name
                    else:
                        print(f"Error al actualizar Fiscal Year: {update_response.status_code if update_response else 'No response'} - {update_response.text if update_response else 'No response'}")
                        return None
                else:
                    print(f"Compañía '{company_name}' ya está asociada al Fiscal Year '{fiscal_year_name}'")
                    return fiscal_year_name
            elif check_response.status_code == 404:
                # Not found: proceed to creation
                print(f"Fiscal Year '{fiscal_year_name}' no existe (404), proceder a creación...")
            else:
                # Unexpected response status
                print(f"Error al verificar Fiscal Year: status {check_response.status_code} - {check_response.text}")
                return None
        elif check_error:
            # If helper returned an error object, only treat 404 as 'not found'. Other errors should be handled.
            if check_error.get('status_code') == 404:
                print(f"Fiscal Year '{fiscal_year_name}' no existe (error 404), proceder a creación...")
            else:
                error_response = handle_erpnext_error(check_error, f"Failed to check Fiscal Year '{fiscal_year_name}'")
                if error_response:
                    return None
                # If handler didn't return a response, stop
                return None

        # If we reach here, treat as 'not found' and proceed to creation

            if latest_fiscal_year and latest_fiscal_year.get("year_end_date"):
                # Calcular fechas basadas en el último Fiscal Year
                latest_end_date = datetime.strptime(latest_fiscal_year["year_end_date"], "%Y-%m-%d").date()
                year_start = (latest_end_date + timedelta(days=1)).strftime("%Y-%m-%d")

                # El año de fin es el año en que cae el mes de cierre después del inicio
                start_date = datetime.strptime(year_start, "%Y-%m-%d")
                end_year = start_date.year if start_date.month <= int(mes_cierre) else start_date.year + 1

                # Usar el último día del mes de cierre del año calculado
                if mes_cierre in ['01', '03', '05', '07', '08', '10', '12']:
                    day_end = '31'
                elif mes_cierre == '02':
                    # Para febrero, verificar si es año bisiesto
                    import calendar
                    day_end = '29' if calendar.isleap(end_year) else '28'
                else:
                    day_end = '30'

                year_end = f"{end_year}-{mes_cierre}-{day_end}"
            else:
                # Fallback: crear basado en año actual (lógica original)
                current_year = datetime.now().year
                mes_cierre_int = int(mes_cierre)
                start_month = mes_cierre_int + 1
                if start_month > 12:
                    start_month = 1
                    start_year = current_year
                else:
                    start_year = current_year - 1

                year_start = f"{start_year}-{str(start_month).zfill(2)}-01"

                # Usar el último día del mes de cierre
                if mes_cierre in ['01', '03', '05', '07', '08', '10', '12']:
                    day_end = '31'
                elif mes_cierre == '02':
                    # Para febrero, verificar si es año bisiesto
                    import calendar
                    day_end = '29' if calendar.isleap(current_year) else '28'
                else:
                    day_end = '30'

                year_end = f"{current_year}-{mes_cierre}-{day_end}"

            print(f"Fechas calculadas - Inicio: {year_start}, Fin: {year_end}")

            fiscal_year_data = {
                "name": fiscal_year_name,
                "year": fiscal_year_name,  # Usar el nombre completo para que se muestre correctamente en ERPNext
                "year_start_date": year_start,
                "year_end_date": year_end,
                "companies": [
                    {
                        "company": company_name
                    }
                ]
            }

            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Fiscal Year",
                data=fiscal_year_data,
                operation_name=f"Create Fiscal Year '{fiscal_year_name}'"
            )

            if create_error:
                error_response = handle_erpnext_error(create_error, f"Failed to create Fiscal Year '{fiscal_year_name}'")
                if error_response:
                    return None

            if create_response and create_response.status_code in [200, 201]:
                print(f"Fiscal Year '{fiscal_year_name}' creado exitosamente")
                return fiscal_year_name
            else:
                print(f"Error al crear Fiscal Year: {create_response.status_code if create_response else 'No response'} - {create_response.text if create_response else 'No response'}")
                return None

        else:
            print(f"Error al verificar Fiscal Year: {check_error}")
            return None

    except Exception as e:
        print(f"Error al obtener/crear Fiscal Year: {e}")
        return None

def assign_fiscal_year_to_company(session, headers, company_name, fiscal_year_name):
    """Asigna un Fiscal Year a una compañía"""
    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    try:
        print(f"Asignando Fiscal Year '{fiscal_year_name}' a compañía '{company_name}'")

        # Actualizar la compañía con el Fiscal Year
        update_data = {
            "default_fiscal_year": fiscal_year_name
        }

        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Company/{company_name}",
            data=update_data,
            operation_name=f"Assign Fiscal Year '{fiscal_year_name}' to company '{company_name}'"
        )

        if error:
            error_response = handle_erpnext_error(error, f"Failed to assign Fiscal Year to company '{company_name}'")
            if error_response:
                return False

        if response and response.status_code == 200:
            print(f"Fiscal Year asignado exitosamente a compañía '{company_name}'")
            return True
        else:
            print(f"Error al asignar Fiscal Year: {response.status_code if response else 'No response'} - {response.text if response else 'No response'}")
            return False

    except Exception as e:
        print(f"Error al asignar Fiscal Year: {e}")
        return False

@companies_bp.route('/api/companies/active', methods=['DELETE'])
def delete_active_company():
    """Elimina la empresa activa del usuario actual"""
    print("\n--- Petición de eliminar empresa activa recibida ---")

    # Debug: Mostrar headers y cookies recibidas
    print(f"Headers recibidos: {dict(request.headers)}")
    print(f"Cookies recibidas: {request.cookies}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    print(f"Eliminando empresa activa para usuario {user_id}")

    try:
        # Cargar empresas activas actuales
        active_data = load_active_companies()
        active_companies = active_data.get("active_companies", {})

        # Eliminar la empresa activa del usuario si existe
        if user_id in active_companies:
            del active_companies[user_id]
            active_data["active_companies"] = active_companies
            if save_active_companies(active_data):
                print(f"Empresa activa eliminada para usuario {user_id}")
                return jsonify({
                    "success": True,
                    "message": "Empresa activa eliminada"
                })
            else:
                return jsonify({"success": False, "message": "Error al eliminar empresa activa"}), 500
        else:
            print(f"No había empresa activa configurada para usuario {user_id}")
            return jsonify({
                "success": True,
                "message": "No había empresa activa configurada"
            })

    except Exception as e:
        print(f"Error al eliminar empresa activa: {e}")
        return jsonify({"success": False, "message": "Error al eliminar empresa activa"}), 500

def get_fiscal_year_for_company(session, headers, company_name):
    """Busca el Fiscal Year que contiene a la compañía especificada obteniendo todos y filtrando"""
    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    try:

        # Get all fiscal years
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Fiscal Year",
            params={
                'fields': json.dumps(["name","year","year_start_date","year_end_date","disabled"]),
                'limit_page_length': 999
            },
            operation_name="Get all Fiscal Years"
        )

        if error:
            error_response = handle_erpnext_error(error, "Failed to get all Fiscal Years")
            if error_response:
                return None

        if response and response.status_code != 200:
            print(f"Error en respuesta: {response.text}")
            return None

        if response and response.status_code == 200:
            fiscal_years = response.json().get("data", [])

            # For each fiscal year, get details and check companies
            for fy in fiscal_years:
                fy_name = fy.get("name")

                # Get full details
                detail_response, detail_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Fiscal Year/{fy_name}",
                    operation_name=f"Get Fiscal Year details for '{fy_name}'"
                )

                if detail_error:
                    print(f"Error obteniendo detalles de '{fy_name}': {detail_error}")
                    continue

                if detail_response and detail_response.status_code == 200:
                    fy_detail = detail_response.json().get("data", {})
                    companies = fy_detail.get("companies", [])

                    # Check if company is in the list
                    for company_entry in companies:
                        if company_entry.get("company", "").strip() == company_name.strip():
                            return fy_detail
                else:
                    print(f"Error obteniendo detalles de '{fy_name}': {detail_response.status_code if detail_response else 'No response'}")

        print(f"No se encontró Fiscal Year para compañía '{company_name}'")
        return None

    except Exception as e:
        print(f"Error al buscar Fiscal Year para compañía: {e}")
        return None

def remove_company_from_fiscal_year(session, headers, company_name, fiscal_year_name):
    """Remueve una compañía de un Fiscal Year"""
    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    try:
        print(f"Removiendo compañía '{company_name}' del Fiscal Year '{fiscal_year_name}'...")

        # Leer el Fiscal Year actual
        fiscal_year_response, fiscal_year_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Fiscal%20Year/{fiscal_year_name}",
            operation_name=f"Get Fiscal Year '{fiscal_year_name}' details"
        )

        if fiscal_year_error:
            error_response = handle_erpnext_error(fiscal_year_error, f"Failed to get Fiscal Year '{fiscal_year_name}'")
            if error_response:
                return False

        if not fiscal_year_response or fiscal_year_response.status_code != 200:
            return False

        fiscal_year_data = fiscal_year_response.json().get("data", {})

        # Buscar el campo de compañías (probablemente "companies")
        companies = fiscal_year_data.get("companies", [])

        # Filtrar la compañía a remover
        updated_companies = [comp for comp in companies if comp.get("company") != company_name]

        if len(updated_companies) == len(companies):
            print(f"La compañía '{company_name}' no estaba en el Fiscal Year '{fiscal_year_name}'")
            return True

        # Preparar datos para actualización
        update_data = {
            "companies": updated_companies
        }

        # Actualizar el Fiscal Year
        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Fiscal%20Year/{fiscal_year_name}",
            data={"data": update_data},
            operation_name=f"Remove company '{company_name}' from Fiscal Year '{fiscal_year_name}'"
        )

        if update_error:
            error_response = handle_erpnext_error(update_error, f"Failed to update Fiscal Year '{fiscal_year_name}'")
            if error_response:
                return False

        if update_response and update_response.status_code in [200, 201]:
            print(f"Compañía '{company_name}' removida del Fiscal Year '{fiscal_year_name}' exitosamente")
            return True
        else:
            print(f"Error al actualizar Fiscal Year: {update_response.text if update_response else 'No response'}")
            return False

    except Exception as e:
        print(f"Error al remover compañía del Fiscal Year: {e}")
        return False


@companies_bp.route('/api/accounts-settings', methods=['GET'])
def get_accounts_settings():


    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    try:


        # Hacer la petición a ERPNext para obtener Accounts Settings
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Accounts%20Settings/AccountsSettings",
            operation_name="Get Accounts Settings"
        )

        if error:
            error_response = handle_erpnext_error(error, "Failed to get Accounts Settings")
            if error_response:
                return error_response



        if response and response.status_code == 404:
            return jsonify({"success": False, "message": "Configuración de cuentas no encontrada"}), 404

        # ERPNext devuelve los datos de configuración
        settings_data = response.json() if response else {}

        print("Configuración de cuentas obtenida exitosamente")

        return jsonify({"success": True, "data": settings_data.get("data", {})})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": "Error al obtener configuración de cuentas"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500


@companies_bp.route('/api/accounts-settings', methods=['PUT'])
def update_accounts_settings():
    """Actualiza la configuración de cuentas en ERPNext"""
    print("\n--- Petición de actualizar configuración de cuentas recibida ---")

    # Debug: Mostrar headers y cookies recibidas
    print(f"Headers recibidos: {dict(request.headers)}")
    print(f"Cookies recibidas: {request.cookies}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    # Obtener los datos a actualizar del body de la petición
    update_data = request.get_json()
    print(f"Datos a actualizar: {update_data}")

    if not update_data or 'data' not in update_data:
        return jsonify({"success": False, "message": "Datos de actualización requeridos"}), 400

    # Filtrar campos que no se pueden editar
    filtered_data = update_data['data'].copy()

    sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')
    print(f"Token SID obtenido: {sid_token}")

    try:
        print("Actualizando configuración de cuentas en ERPNext...")
        print(f"Usando SID token: {sid_token[:10]}...")
        print(f"Datos filtrados a enviar: {filtered_data}")

        # Hacer la petición PUT a ERPNext para actualizar Accounts Settings
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint="/api/resource/Accounts%20Settings/AccountsSettings",
            data={'data': filtered_data},
            operation_name="Update Accounts Settings"
        )

        if error:
            error_response = handle_erpnext_error(error, "Failed to update Accounts Settings")
            if error_response:
                return error_response

        if response and response.status_code == 404:
            return jsonify({"success": False, "message": "Configuración de cuentas no encontrada"}), 404
        elif response and response.status_code == 403:
            return jsonify({"success": False, "message": "No tienes permisos para actualizar configuración"}), 403

        # ERPNext devuelve los datos actualizados
        updated_settings_data = response.json() if response else {}

        print("Configuración de cuentas actualizada exitosamente")

        return jsonify({"success": True, "data": updated_settings_data.get("data", {}), "message": "Configuración actualizada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        try:
            error_detail = err.response.json()
            return jsonify({"success": False, "message": error_detail.get("message", "Error al actualizar configuración")}), 500
        except:
            return jsonify({"success": False, "message": "Error al actualizar configuración"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500


@companies_bp.route('/api/user-preferences/inventory-tab', methods=['GET'])
def get_inventory_tab_preference():
    """Obtiene la preferencia de tab de inventario para el usuario y compañía activa"""
    print("\n--- Petición para obtener preferencia de tab de inventario ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener compañía activa
        active_data = load_active_companies()
        company = active_data.get('active_companies', {}).get(user_id)

        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa"}), 400

        # Cargar preferencias
        preferences = active_data.get('inventory_preferences', {})
        user_company_key = f"{user_id}_{company}"
        default_tab = preferences.get(user_company_key, 'services')  # Por defecto: servicios

        print(f"Preferencia de tab para {user_id} en {company}: {default_tab}")

        return jsonify({
            "success": True,
            "data": {
                "default_tab": default_tab,
                "user_id": user_id,
                "company": company
            }
        })

    except Exception as e:
        print(f"Error obteniendo preferencia de tab: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@companies_bp.route('/api/user-preferences/inventory-tab', methods=['POST'])
def set_inventory_tab_preference():
    """Guarda la preferencia de tab de inventario para el usuario y compañía activa"""
    print("\n--- Petición para guardar preferencia de tab de inventario ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        default_tab = data.get('default_tab')

        if not default_tab or default_tab not in ['products', 'services']:
            return jsonify({"success": False, "message": "Tab inválido. Debe ser 'products' o 'services'"}), 400

        # Obtener compañía activa
        active_data = load_active_companies()
        company = active_data.get('active_companies', {}).get(user_id)

        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa"}), 400

        # Guardar preferencia
        if 'inventory_preferences' not in active_data:
            active_data['inventory_preferences'] = {}

        user_company_key = f"{user_id}_{company}"
        active_data['inventory_preferences'][user_company_key] = default_tab

        if save_active_companies(active_data):
            print(f"Preferencia de tab guardada: {user_id} en {company} -> {default_tab}")
            return jsonify({
                "success": True,
                "message": "Preferencia guardada exitosamente",
                "data": {
                    "default_tab": default_tab,
                    "user_id": user_id,
                    "company": company
                }
            })
        else:
            return jsonify({"success": False, "message": "Error al guardar preferencia"}), 500

    except Exception as e:
        print(f"Error guardando preferencia de tab: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@companies_bp.route('/api/stock-settings', methods=['GET'])
def get_stock_settings():
    """Obtiene la configuración de stock actual"""

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    try:
        print("Obteniendo configuración de stock desde ERPNext...")

        # Hacer la petición GET a ERPNext para obtener Stock Settings
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Stock%20Settings/StockSettings",
            operation_name="Get Stock Settings"
        )

        if error:
            error_response = handle_erpnext_error(error, "Failed to get Stock Settings")
            if error_response:
                return error_response

        if response and response.status_code == 404:
            # Si no existe, devolver configuración por defecto
            return jsonify({
                "success": True,
                "data": {
                    "valuation_method": "Moving Average"
                }
            })

        # ERPNext devuelve los datos de configuración
        stock_settings_data = response.json().get("data", {}) if response else {}

        print("Configuración de stock obtenida exitosamente")

        return jsonify({"success": True, "data": stock_settings_data})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": "Error al obtener configuración de stock"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión al obtener configuración de stock"}), 500


@companies_bp.route('/api/stock-settings', methods=['PUT'])
def update_stock_settings():


    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    # Obtener los datos a actualizar del body de la petición
    update_data = request.get_json()
    print(f"Datos a actualizar en stock settings: {update_data}")

    if not update_data or 'data' not in update_data:
        return jsonify({"success": False, "message": "Datos de actualización requeridos"}), 400

    # Extraer los datos
    filtered_data = update_data['data']

    sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')
    print(f"Token SID obtenido: {sid_token}")

    try:
        print(f"Actualizando configuración de stock en ERPNext...")
        print(f"Usando SID token: {sid_token[:10]}...")
        print(f"Datos a enviar: {filtered_data}")

        # Hacer la petición PUT a ERPNext para actualizar Stock Settings
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint="/api/resource/Stock%20Settings/StockSettings",
            data={'data': filtered_data},
            operation_name="Update Stock Settings"
        )

        if error:
            error_response = handle_erpnext_error(error, "Failed to update Stock Settings")
            if error_response:
                return error_response

        # ERPNext devuelve los datos actualizados
        updated_settings_data = response.json() if response else {}

        print("Configuración de stock actualizada exitosamente")

        return jsonify({"success": True, "data": updated_settings_data.get("data", {}), "message": "Configuración de stock actualizada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": "Error al actualizar configuración de stock"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión al actualizar configuración de stock"}), 500


@companies_bp.route('/api/companies/<company_name>/google-sheets', methods=['GET'])
def get_company_google_sheets_config(company_name):
    """Obtiene la configuración de Google Sheets para una compañía específica"""
    print(f"\n--- Petición de obtener configuración Google Sheets para '{company_name}' ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    try:
        print(f"Obteniendo configuración Google Sheets para compañía '{company_name}'...")

        # Hacer la petición a ERPNext para obtener la compañía
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Company/{company_name}",
            operation_name=f"Get Google Sheets config for company '{company_name}'"
        )

        if error:
            error_response = handle_erpnext_error(error, f"Failed to get Google Sheets config for company '{company_name}'")
            if error_response:
                return error_response

        # ERPNext devuelve los datos de la compañía
        company_data = response.json().get("data", {}) if response else {}
        print(f"📋 Datos crudos de ERPNext para '{company_name}':")
        print(f"   - custom_google_sheets_config presente: {company_data.get('custom_google_sheets_config') is not None}")
        print(f"   - custom_gsheets_enabled: {company_data.get('custom_gsheets_enabled')}")
        print(f"   - custom_google_sheets_templates presente: {company_data.get('custom_google_sheets_templates') is not None}")

        # Extraer y parsear la configuración de Google Sheets
        google_sheets_config_json = company_data.get("custom_google_sheets_config")
        google_sheets_client_id = None
        google_sheets_client_secret = None

        if google_sheets_config_json:
            try:
                if isinstance(google_sheets_config_json, str):
                    parsed_config = json.loads(google_sheets_config_json)
                else:
                    parsed_config = google_sheets_config_json

                google_sheets_client_id = parsed_config.get('client_id')
                google_sheets_client_secret = parsed_config.get('client_secret')

                print(f"✅ Configuración parseada exitosamente:")
                print(f"   - client_id presente: {google_sheets_client_id is not None}")
                print(f"   - client_secret presente: {google_sheets_client_secret is not None}")
                print(f"   - authorized: {bool(parsed_config.get('access_token') and parsed_config.get('refresh_token'))}")

            except json.JSONDecodeError as e:
                print(f"❌ Error al parsear custom_google_sheets_config: {e}")
                print(f"   Contenido raw: {repr(google_sheets_config_json)}")

        # Preparar respuesta en el formato que espera el frontend
        google_sheets_config = {
            "google_sheets_client_id": google_sheets_client_id,
            "google_sheets_client_secret": google_sheets_client_secret,
            "gsheets_enabled": company_data.get("custom_gsheets_enabled"),
            "google_sheets_templates": company_data.get("custom_google_sheets_templates"),
            "google_sheets_service_account_email": company_data.get("custom_google_sheets_service_account_email"),
            "custom_google_sheets_config": google_sheets_config_json  # Mantener el JSON completo también
        }

        print(f"📤 Respuesta final para frontend:")
        print(f"   - google_sheets_client_id: {google_sheets_client_id[:20] + '...' if google_sheets_client_id and len(google_sheets_client_id) > 20 else google_sheets_client_id}")
        print(f"   - google_sheets_client_secret: {'Presente' if google_sheets_client_secret else 'None'}")
        print(f"   - gsheets_enabled: {company_data.get('custom_gsheets_enabled')}")

        return jsonify({"success": True, "data": google_sheets_config})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": "Error al obtener configuración Google Sheets"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500


# ================================================================================
# ENDPOINTS PARA BORRADO DE COMPAÑÍA (Transaction Deletion + Delete Company)
# ================================================================================

@companies_bp.route('/api/companies/<company_name>/check-deletion-status', methods=['POST'])
def check_deletion_status(company_name):
    """Verifica si hay un proceso de borrado de transacciones corriendo para la compañía"""
    print(f"\n--- Verificando estado de borrado para '{company_name}' ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Buscar Transaction Deletion Records activos para esta compañía
        # Estados: Draft (0), Queued/Running (1), Completed (2)
        # Nos interesan los que están en docstatus 0 o 1 (no completados)
        tdl_response, tdl_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Transaction Deletion Record",
            params={
                "filters": json.dumps([
                    ["company", "=", company_name],
                    ["docstatus", "in", [0, 1]]  # Draft o Submitted (en cola/corriendo)
                ]),
                "fields": json.dumps(["name", "company", "docstatus", "status", "creation"]),
                "order_by": "creation desc",
                "limit_page_length": 5
            },
            operation_name=f"Check TDL records for '{company_name}'"
        )

        if tdl_error:
            print(f"Error buscando TDL records: {tdl_error}")
            # Fallback: intentar el método original de ERPNext
            response, error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/erpnext.setup.doctype.transaction_deletion_record.transaction_deletion_record.is_deletion_doc_running",
                data={"company": company_name},
                operation_name=f"Check deletion status for '{company_name}'"
            )

            if error:
                return handle_erpnext_error(error, "Error al verificar estado de borrado")

            result = response.json() if response else {}
            message = result.get("message", {})
            is_running = bool(message) and message.get("is_running", False)

            return jsonify({
                "success": True,
                "is_running": is_running,
                "deletion_info": message if is_running else None
            })

        # Procesar resultados de la búsqueda directa
        tdl_records = tdl_response.json().get("data", []) if tdl_response else []
        
        if tdl_records:
            # Hay TDL activos
            active_tdl = tdl_records[0]
            tdl_name = active_tdl.get("name")
            tdl_status = active_tdl.get("status", "Queued")
            docstatus = active_tdl.get("docstatus", 0)
            
            print(f"TDL activo encontrado: {tdl_name} (status: {tdl_status}, docstatus: {docstatus})")

            # Construir URL pública al TDL en ERPNext si se conoce ERPNEXT_URL
            tdl_url = None
            try:
                if ERPNEXT_URL:
                    tdl_url = f"{ERPNEXT_URL.rstrip('/')}/app/transaction-deletion-record/{quote(tdl_name)}"
            except Exception:
                tdl_url = None

            return jsonify({
                "success": True,
                "is_running": True,
                "deletion_info": {
                    "is_running": True,
                    "tdl_name": tdl_name,
                    "tdl_url": tdl_url,
                    "status": tdl_status,
                    "docstatus": docstatus,
                    "message": f"Transaction Deletion Record '{tdl_name}' está en cola/ejecutándose"
                }
            })
        else:
            print(f"No hay TDL activos para '{company_name}'")
            return jsonify({
                "success": True,
                "is_running": False,
                "deletion_info": None
            })

    except Exception as e:
        print(f"Error verificando estado de borrado: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


@companies_bp.route('/api/verify-password', methods=['POST'])
def verify_user_password():
    """Verifica la contraseña del usuario actual"""
    print("\n--- Verificando contraseña de usuario ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    data = request.get_json()
    password = data.get('password')

    if not password:
        return jsonify({"success": False, "message": "Contraseña requerida"}), 400

    try:
        # Llamar al método de ERPNext para verificar la contraseña
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.core.doctype.user.user.verify_password",
            data={"password": password},
            operation_name="Verify user password"
        )

        if error:
            # Si hay error 401 o similar, la contraseña es incorrecta
            if error.get('status_code') in [401, 403, 417]:
                return jsonify({"success": False, "message": "Contraseña incorrecta"}), 401
            print(f"Error verificando contraseña: {error}")
            return handle_erpnext_error(error, "Error al verificar contraseña")

        # Si llegamos aquí, la contraseña es correcta
        print("Contraseña verificada correctamente")
        return jsonify({"success": True, "message": "Contraseña verificada"})

    except Exception as e:
        print(f"Error verificando contraseña: {e}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


@companies_bp.route('/api/companies/<company_name>/delete-transactions', methods=['POST'])
def delete_company_transactions(company_name):
    """Crea una solicitud de borrado de transacciones para la compañía"""
    print(f"\n--- Creando solicitud de borrado de transacciones para '{company_name}' ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Primero buscar TDL activos directamente
        tdl_response, tdl_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Transaction Deletion Record",
            params={
                "filters": json.dumps([
                    ["company", "=", company_name],
                    ["docstatus", "in", [0, 1]]
                ]),
                "fields": json.dumps(["name", "company", "docstatus", "status"]),
                "limit_page_length": 1
            },
            operation_name=f"Check existing TDL for '{company_name}'"
        )

        if not tdl_error and tdl_response:
            existing_tdl = tdl_response.json().get("data", [])
            if existing_tdl:
                tdl_name = existing_tdl[0].get("name")
                tdl_status = existing_tdl[0].get("status", "Queued")
                print(f"TDL existente encontrado: {tdl_name} (status: {tdl_status})")
                return jsonify({
                    "success": False,
                    "already_exists": True,
                    "message": f"Ya existe un proceso de borrado ({tdl_name}) en estado '{tdl_status}' para esta compañía. Espera a que termine o cancélalo desde ERPNext.",
                    "tdl_name": tdl_name,
                    "tdl_status": tdl_status
                }), 409

        # Crear la solicitud de borrado de transacciones
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/erpnext.setup.doctype.company.company.create_transaction_deletion_request",
            data={"company": company_name},
            operation_name=f"Create transaction deletion request for '{company_name}'"
        )

        if error:
            print(f"Error creando solicitud de borrado: {error}")
            
            # Parsear el error para detectar si ya existe un TDL
            response_body = error.get('response_body', '')
            if 'TDL' in response_body or 'ya est' in response_body.lower():
                # Extraer el nombre del TDL del error
                import re
                tdl_match = re.search(r'TDL\d+', response_body)
                tdl_name = tdl_match.group(0) if tdl_match else None
                
                return jsonify({
                    "success": False,
                    "already_exists": True,
                    "message": f"Ya existe un proceso de borrado ({tdl_name or 'activo'}) para esta compañía. Espera a que termine o cancélalo desde ERPNext.",
                    "tdl_name": tdl_name
                }), 409
            
            return handle_erpnext_error(error, "Error al crear solicitud de borrado de transacciones")

        result = response.json() if response else {}
        
        # Parsear el mensaje del servidor para obtener info del TDL creado
        server_messages = result.get("_server_messages", "")
        tdl_name = None
        
        if server_messages:
            try:
                import re
                # Buscar el nombre del TDL en el mensaje (ej: TDL0001)
                match = re.search(r'TDL\d+', server_messages)
                if match:
                    tdl_name = match.group(0)
            except:
                pass

        print(f"Solicitud de borrado de transacciones creada: {tdl_name or 'OK'}")

        return jsonify({
            "success": True,
            "message": f"Solicitud de borrado de transacciones creada{' (' + tdl_name + ')' if tdl_name else ''}. ERPNext procesará esto en segundo plano.",
            "tdl_name": tdl_name,
            "server_response": result
        })

    except Exception as e:
        print(f"Error creando solicitud de borrado: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


@companies_bp.route('/api/companies/<company_name>/check-links', methods=['GET'])
def check_company_links(company_name):
    """Verifica los links residuales de la compañía antes de borrarla"""
    print(f"\n--- Verificando links residuales para '{company_name}' ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener información de la compañía para ver si tiene dependencias
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            operation_name=f"Get company '{company_name}' for link check"
        )

        if error:
            return handle_erpnext_error(error, "Error al obtener información de la compañía")

        # Intentar obtener los links usando el método de Frappe
        links_response, links_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/method/frappe.client.get_count",
            params={
                "doctype": "Company",
                "filters": json.dumps({"name": company_name})
            },
            operation_name=f"Get link count for '{company_name}'"
        )

        # Verificar doctypes comunes que podrían tener referencias
        linked_doctypes = []
        doctypes_to_check = [
            "Sales Invoice", "Purchase Invoice", "Sales Order", "Purchase Order",
            "Quotation", "Delivery Note", "Purchase Receipt", "Stock Entry",
            "Journal Entry", "Payment Entry", "Item", "Customer", "Supplier",
            "Item Group", "Warehouse", "Cost Center", "Account"
        ]

        for doctype in doctypes_to_check:
            try:
                count_response, count_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/method/frappe.client.get_count",
                    params={
                        "doctype": doctype,
                        "filters": json.dumps({"company": company_name})
                    },
                    operation_name=f"Count {doctype} for '{company_name}'"
                )

                if not count_error and count_response:
                    count = count_response.json().get("message", 0)
                    if count > 0:
                        linked_doctypes.append({
                            "doctype": doctype,
                            "count": count
                        })
            except:
                pass

        print(f"Links encontrados para '{company_name}': {len(linked_doctypes)} tipos de documentos")

        return jsonify({
            "success": True,
            "company": company_name,
            "linked_doctypes": linked_doctypes,
            "has_links": len(linked_doctypes) > 0
        })

    except Exception as e:
        print(f"Error verificando links: {e}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


@companies_bp.route('/api/companies/<company_name>/force-delete', methods=['DELETE'])
def force_delete_company(company_name):
    """
    Intenta borrar la compañía. Si falla por links, devuelve información detallada
    de qué documentos están vinculados para que el usuario decida qué hacer.
    """
    print(f"\n--- Intentando borrar compañía '{company_name}' ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Primero remover de Fiscal Year si existe
        fiscal_year_data = get_fiscal_year_for_company(session, headers, company_name)
        if fiscal_year_data:
            fiscal_year_name = fiscal_year_data.get('name')
            print(f"Removiendo compañía de Fiscal Year '{fiscal_year_name}'")
            try:
                remove_company_from_fiscal_year(session, headers, company_name, fiscal_year_name)
            except Exception as fy_err:
                print(f"Error removiendo de Fiscal Year: {fy_err}")

        # Intentar borrar la compañía
        response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            operation_name=f"Force delete company '{company_name}'"
        )

        if error:
            # Parsear el error para obtener información de links
            error_message = error.get('message', '')
            response_body = error.get('response_body', '')
            
            # Intentar extraer información de links del error
            linked_docs = []
            
            try:
                # ERPNext devuelve información de links en el error
                if response_body:
                    error_data = json.loads(response_body) if isinstance(response_body, str) else response_body
                    exc_type = error_data.get('exc_type', '')
                    
                    if 'LinkExistsError' in exc_type or 'linked' in error_message.lower():
                        # Parsear los documentos vinculados del mensaje
                        import re
                        # Buscar patrones como "Item: ITEM001, ITEM002" o similar
                        matches = re.findall(r'(\w+(?:\s\w+)*?):\s*([^\n]+)', error_message)
                        for doctype, items in matches:
                            item_list = [i.strip() for i in items.split(',') if i.strip()]
                            if item_list:
                                linked_docs.append({
                                    "doctype": doctype.strip(),
                                    "items": item_list[:10],  # Limitar a 10 items
                                    "total": len(item_list)
                                })
            except:
                pass

            print(f"Error borrando compañía. Links encontrados: {len(linked_docs)}")

            return jsonify({
                "success": False,
                "message": error_message or "Error al borrar la compañía",
                "has_linked_documents": len(linked_docs) > 0,
                "linked_documents": linked_docs,
                "raw_error": response_body[:1000] if response_body else None
            }), 409

        # Si llegamos aquí, el borrado fue exitoso
        print(f"Compañía '{company_name}' borrada exitosamente")

        # Remover de empresas activas
        remove_company_from_active(user_id, company_name)

        return jsonify({
            "success": True,
            "message": f"Compañía '{company_name}' eliminada correctamente"
        })

    except Exception as e:
        print(f"Error borrando compañía: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


@companies_bp.route('/api/companies/<company_name>/delete-linked-docs', methods=['POST'])
def delete_linked_documents(company_name):
    """
    Borra documentos vinculados a la compañía por tipo de documento.
    Recibe un array de doctypes a borrar.
    """
    print(f"\n--- Borrando documentos vinculados para '{company_name}' ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    data = request.get_json()
    doctypes_to_delete = data.get('doctypes', [])

    if not doctypes_to_delete:
        return jsonify({"success": False, "message": "No se especificaron tipos de documentos a borrar"}), 400

    results = []
    errors = []

    for doctype in doctypes_to_delete:
        print(f"Borrando documentos de tipo '{doctype}' para compañía '{company_name}'...")
        
        try:
            # Obtener lista de documentos de este tipo para la compañía
            list_response, list_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/{quote(doctype)}",
                params={
                    "filters": json.dumps([["company", "=", company_name]]),
                    "fields": json.dumps(["name"]),
                    "limit_page_length": 1000
                },
                operation_name=f"List {doctype} for deletion"
            )

            if list_error:
                errors.append({
                    "doctype": doctype,
                    "error": f"Error listando documentos: {list_error.get('message', 'Unknown error')}"
                })
                continue

            docs = list_response.json().get('data', []) if list_response else []
            deleted_count = 0
            failed_count = 0

            for doc in docs:
                doc_name = doc.get('name')
                try:
                    # Intentar cancelar si está submitted
                    cancel_response, cancel_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/{quote(doctype)}/{quote(doc_name)}",
                        data={"docstatus": 2},
                        operation_name=f"Cancel {doctype} {doc_name}"
                    )

                    # Borrar el documento
                    delete_response, delete_error = make_erpnext_request(
                        session=session,
                        method="DELETE",
                        endpoint=f"/api/resource/{quote(doctype)}/{quote(doc_name)}",
                        operation_name=f"Delete {doctype} {doc_name}"
                    )

                    if not delete_error:
                        deleted_count += 1
                    else:
                        failed_count += 1

                except Exception as doc_err:
                    failed_count += 1

            results.append({
                "doctype": doctype,
                "deleted": deleted_count,
                "failed": failed_count,
                "total": len(docs)
            })

        except Exception as e:
            errors.append({
                "doctype": doctype,
                "error": str(e)
            })

    return jsonify({
        "success": len(errors) == 0,
        "results": results,
        "errors": errors,
        "message": f"Proceso completado. {sum(r['deleted'] for r in results)} documentos eliminados."
    })


@companies_bp.route('/api/transaction-deletions/<tdl_name>', methods=['GET'])
def get_transaction_deletion(tdl_name):
    """Obtiene detalles de un Transaction Deletion Record por nombre (TDL)"""
    print(f"\n--- Obteniendo Transaction Deletion Record: {tdl_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Transaction%20Deletion%20Record/{quote(tdl_name)}",
            operation_name=f"Get Transaction Deletion Record {tdl_name}"
        )

        if error:
            print(f"Error obteniendo TDL {tdl_name}: {error}")
            return handle_erpnext_error(error, f"Error al obtener TDL {tdl_name}")

        data = response.json().get('data', {}) if response else {}

        return jsonify({"success": True, "data": data})

    except Exception as e:
        print(f"Error obteniendo TDL {tdl_name}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


@companies_bp.route('/api/transaction-deletions/<tdl_name>/cancel', methods=['POST'])
def cancel_transaction_deletion(tdl_name):
    """Cancela (frappe.client.cancel) un Transaction Deletion Record dado su nombre"""
    print(f"\n--- Cancelando Transaction Deletion Record: {tdl_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Usar frappe.client.cancel para cancelar el TDL
        cancel_response, cancel_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.cancel",
            data={"doctype": "Transaction Deletion Record", "name": tdl_name},
            operation_name=f"Cancel Transaction Deletion {tdl_name}"
        )

        if cancel_error:
            print(f"Error cancelando TDL {tdl_name}: {cancel_error}")
            return handle_erpnext_error(cancel_error, f"Error al cancelar TDL {tdl_name}")

        msg = cancel_response.json().get('message') if cancel_response else None
        return jsonify({"success": True, "message": msg or f"TDL {tdl_name} cancelado"})

    except Exception as e:
        print(f"Error cancelando TDL {tdl_name}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


# ================================================================================
# FIN DE ENDPOINTS PARA BORRADO DE COMPAÑÍA
# ================================================================================


@companies_bp.route('/api/companies/<company_name>/google-sheets', methods=['PUT'])
def update_company_google_sheets_config(company_name):
    """Actualiza la configuración de Google Sheets para una compañía específica"""
    print(f"\n--- Petición de actualizar configuración Google Sheets para '{company_name}' ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    from utils.http_utils import make_erpnext_request, handle_erpnext_error

    # Obtener los datos a actualizar del body de la petición
    update_data = request.get_json()
    print(f"Datos a actualizar: {update_data}")

    if not update_data or 'data' not in update_data:
        return jsonify({"success": False, "message": "Datos de actualización requeridos"}), 400

    # Extraer datos de Google Sheets
    google_sheets_data = update_data['data']

    # Mapear campos del frontend a campos de ERPNext
    field_mapping = {
        'google_sheets_config': 'custom_google_sheets_config',
        'gsheets_enabled': 'custom_gsheets_enabled',
        'google_sheets_templates': 'custom_google_sheets_templates',
        'google_sheets_service_account_email': 'custom_google_sheets_service_account_email'
    }

    # Aplicar el mapeo de campos
    mapped_data = {}
    for frontend_field, backend_field in field_mapping.items():
        if frontend_field in google_sheets_data:
            mapped_data[backend_field] = google_sheets_data[frontend_field]

    if not mapped_data:
        return jsonify({"success": False, "message": "No hay campos de Google Sheets para actualizar"}), 400

    sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')
    print(f"Token SID obtenido: {sid_token}")

    try:
        print(f"Actualizando configuración Google Sheets para '{company_name}' en ERPNext...")
        print(f"Usando SID token: {sid_token[:10]}...")
        print(f"Datos a enviar: {mapped_data}")

        # Hacer la petición PUT a ERPNext para actualizar la compañía
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Company/{company_name}",
            data={'data': mapped_data},
            operation_name=f"Update Google Sheets config for company '{company_name}'"
        )

        if error:
            error_response = handle_erpnext_error(error, f"Failed to update Google Sheets config for company '{company_name}'")
            if error_response:
                return error_response

        # ERPNext devuelve los datos actualizados de la compañía
        updated_company_data = response.json() if response else {}

        print(f"Configuración Google Sheets actualizada exitosamente para '{company_name}'")

        return jsonify({"success": True, "data": updated_company_data.get("data", {}), "message": "Configuración Google Sheets actualizada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        try:
            error_detail = err.response.json()
            return jsonify({"success": False, "message": error_detail.get("message", "Error al actualizar configuración Google Sheets")}), 500
        except:
            return jsonify({"success": False, "message": "Error al actualizar configuración Google Sheets"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500
