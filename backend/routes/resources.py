from flask import Blueprint, request, jsonify
import requests
import json
from config import ERPNEXT_URL, ERPNEXT_HOST
import os
from urllib.parse import quote
from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_company_abbr, add_company_abbr, resolve_customer_name

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

resources_bp = Blueprint('resources', __name__)

@resources_bp.route('/resource/<doctype>', methods=['GET'])
def get_resource(doctype):
    """
    Endpoint genérico para consultar recursos de ERPNext
    Soporta filtros, campos y otros parámetros de consulta
    """
    try:
        # Obtener sesión autenticada
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Construir URL de ERPNext

        # Capturar y reenviar todos los parámetros relevantes
        allowed_params = [
            'fields',
            'filters',
            'or_filters',
            'limit',
            'limit_start',
            'limit_page_length',
            'page',
            'order_by',
            'include_child_tables',
            'with_child_tables',
            'parent',
            'debug'
        ]

        params = {}
        for param_name in allowed_params:
            value = request.args.get(param_name)
            if value is not None:
                params[param_name] = value

        if 'limit' not in params and 'limit_page_length' not in params:
            params['limit'] = '20'

        # INYECTAR custom_company en fields para Customer/Supplier Group
        if doctype in ['Customer Group', 'Supplier Group']:
            if 'fields' in params:
                try:
                    # Parsear fields existentes y agregar custom_company si no está
                    fields_list = json.loads(params['fields'])
                    if 'custom_company' not in fields_list:
                        fields_list.append('custom_company')
                        params['fields'] = json.dumps(fields_list)
                        print(f"[resources.get_resource] Agregado 'custom_company' a fields para {doctype}")
                except (json.JSONDecodeError, TypeError):
                    # Si fields no es JSON válido, dejarlo como está
                    pass

        print(f"[resources.get_resource] Requesting {doctype} with params: {params}")
        print(f"[resources.get_resource] Full URL: /api/resource/{doctype}")

        # Hacer la petición a ERPNext
        try:
            # Asegurarse de codificar el nombre del doctype en la URL (espacios -> %20)
            resp, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/{quote(doctype)}",
                params=params,
                operation_name=f"Get resource '{doctype}'"
            )

            if error:
                print(f"[resources.get_resource] Error: {error}")
                return handle_erpnext_error(error, f"Failed to get resource {doctype}")


            if resp.status_code == 200:
                try:
                    data = resp.json()
                    returned = data.get('data', [])
                    print(f"[resources.get_resource] Received {len(returned)} records for {doctype}")
                    if returned:
                        print(f"[resources.get_resource] First record keys: {list(returned[0].keys()) if isinstance(returned[0], dict) else 'Not a dict'}")
                    
                    # FILTRADO POST-ERPNEXT: Customer Group y Supplier Group deben filtrarse por custom_company
                    if doctype in ['Customer Group', 'Supplier Group']:
                        company_name = get_active_company(user_id)
                        if company_name:
                            original_count = len(returned)
                            # Filtrar solo registros con custom_company == company_name
                            returned = [item for item in returned if item.get('custom_company') == company_name]
                            filtered_count = len(returned)
                            print(f"[resources.get_resource] {doctype} filtrado: {original_count} → {filtered_count} (company: {company_name})")
                            data['data'] = returned
                    
                    return jsonify({
                        'success': True,
                        'data': data.get('data', []),
                        'message': f'Datos de {doctype} obtenidos correctamente'
                    })
                except ValueError as json_error:
                    print(f"[resources.get_resource] JSON parsing error: {json_error}")
                    print(f"[resources.get_resource] Raw response content: {resp.text[:500]}...")
                    return jsonify({
                        'success': False,
                        'message': f'Error al parsear respuesta JSON de {doctype}',
                        'data': []
                    }), 500
            elif resp.status_code == 404:
                # Si el doctype no existe, devolver éxito con lista vacía
                print(f"[resources.get_resource] Doctype {doctype} not found (404)")
                return jsonify({
                    'success': True,
                    'data': [],
                    'message': f'Doctype {doctype} no encontrado, devolviendo lista vacía'
                })
            else:
                print(f"[resources.get_resource] ERPNext error {resp.status_code}: {resp.text}")
                try:
                    error_data = resp.json()
                    error_message = error_data.get('message', 'Error desconocido')
                except:
                    error_message = resp.text[:200] if resp.text else 'Error desconocido'
                
                return jsonify({
                    'success': False,
                    'message': f'Error al consultar {doctype}: {resp.status_code} - {error_message}',
                    'data': []
                }), resp.status_code
                
        except requests.exceptions.Timeout:
            print(f"[resources.get_resource] Timeout error for {doctype}")
            return jsonify({
                'success': False,
                'message': f'Timeout al consultar {doctype}',
                'data': []
            }), 504
        except requests.exceptions.RequestException as req_error:
            print(f"[resources.get_resource] Request error for {doctype}: {req_error}")
            return jsonify({
                'success': False,
                'message': f'Error de conexión al consultar {doctype}: {str(req_error)}',
                'data': []
            }), 500

    except Exception as e:
        print(f"[resources.get_resource] Unexpected error for {doctype}: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}',
            'data': []
        }), 500

@resources_bp.route('/resource/Naming Series', methods=['GET'])
def get_naming_series():
    """
    Endpoint específico para obtener series de numeración
    Intenta diferentes métodos ya que en ERPNext las series pueden estar en diferentes lugares
    """
    try:
        # Obtener sesión autenticada
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Método 1: Intentar obtener de Property Setter (donde se configuran las series)
        try:
            # Extract filters and fields to avoid nested quotes in f-string
            filters = [["property", "=", "naming_series"]]
            fields = ["doc_type", "value"]
            prop_resp, prop_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Property Setter",
                params={
                    # Pasar JSON string, requests hará el encoding correcto
                    "filters": json.dumps(filters),
                    "fields": json.dumps(fields),
                    "limit_page_length": 1000
                },
                operation_name="Get naming series from Property Setter"
            )

            if prop_error:
                print(f"Error getting naming series from Property Setter: {prop_error}")
            elif prop_resp.status_code == 200:
                data = prop_resp.json()
                property_setters = data.get('data', [])

                # Extraer series únicas
                naming_series = set()
                for ps in property_setters:
                    value = ps.get('value', '')
                    if value:
                        # Las series suelen estar separadas por \n
                        series_list = value.split('\n')
                        for series in series_list:
                            series = series.strip()
                            if series and not series.startswith('naming_series'):
                                naming_series.add(series)

                return jsonify({
                    'success': True,
                    'data': [{'name': series} for series in sorted(naming_series)],
                    'message': 'Series de numeración obtenidas de Property Setter'
                })
        except Exception as e:
            print(f"Error getting naming series from Property Setter: {e}")

        # Método 2: Intentar API method específico de ERPNext
        try:
            naming_resp, naming_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/method/frappe.client.get_list",
                params={
                    "doctype": "Naming Series",
                    # pasar fields como JSON string
                    "fields": json.dumps(["name"]) 
                },
                operation_name="Get naming series via API method"
            )

            if naming_error:
                print(f"Error getting naming series via API method: {naming_error}")
            elif naming_resp.status_code == 200:
                data = naming_resp.json()
                return jsonify({
                    'success': True,
                    'data': data.get('message', []),
                    'message': 'Series de numeración obtenidas via API method'
                })
        except Exception as e:
            print(f"Error getting naming series via API method: {e}")

        # Método 3: Si todo falla, devolver lista vacía
        return jsonify({
            'success': True,
            'data': [],
            'message': 'No se pudieron obtener series de numeración, devolviendo lista vacía'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}',
            'data': []
        }), 500

@resources_bp.route('/resource/<doctype>/<name>', methods=['GET'])
def get_resource_by_name(doctype, name):
    """
    Endpoint para consultar un recurso específico por nombre
    """
    try:
        # Obtener sesión autenticada
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        fetch_name = name
        if doctype == "Customer":
            company_name = get_active_company(user_id)
            company_abbr = get_company_abbr(session, headers, company_name) if company_name else None
            if company_abbr:
                fetch_name = resolve_customer_name(name, company_abbr)

        resp, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{doctype}/{quote(fetch_name)}",
            operation_name=f"Get resource '{doctype}/{fetch_name}'"
        )

        if error:
            return handle_erpnext_error(error, f"Failed to get resource {doctype}/{name}")

        if resp.status_code == 200:
            data = resp.json()
            return jsonify({
                'success': True,
                'data': data.get('data', {}),
                'message': f'Recurso {doctype}/{fetch_name} obtenido correctamente'
            })
        else:
            return jsonify({
                'success': False,
                'message': f'Error al consultar {doctype}/{fetch_name}: {resp.status_code}',
                'data': {}
            }), resp.status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}',
            'data': {}
        }), 500

@resources_bp.route('/resource/<doctype>', methods=['POST'])
def create_resource(doctype):
    """
    Endpoint para crear un nuevo recurso en ERPNext
    """
    try:
        # Obtener sesión autenticada
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener datos del request
        request_data = request.get_json()
        print(f"DEBUG: Request data received: {request_data}")
        
        if not request_data or 'data' not in request_data:
            return jsonify({
                'success': False,
                'message': 'Datos requeridos no encontrados en el request'
            }), 400

        # Extraer los datos del documento (ERPNext no espera la clave 'data')
        data_to_send = request_data['data']

        # Normalizar nombres de grupos para Customer Group y Supplier Group con la sigla de la compa��a
        if doctype in ["Customer Group", "Supplier Group"]:
            company_name = data_to_send.get('custom_company') or get_active_company(user_id)
            if not company_name:
                return jsonify({
                    'success': False,
                    'message': 'No se encontro una compania activa configurada para el usuario.'
                }), 400

            company_abbr = get_company_abbr(session, headers, company_name)
            if not company_abbr:
                return jsonify({
                    'success': False,
                    'message': f"No se pudo obtener la abreviatura para la compania '{company_name}'"
                }), 400

            if doctype == "Customer Group":
                original_name = (data_to_send.get('customer_group_name') or '').strip()
                canonical_name = add_company_abbr(original_name, company_abbr)
                if not canonical_name.strip():
                    return jsonify({
                        'success': False,
                        'message': 'Se requiere el nombre del grupo'
                    }), 400
                data_to_send['customer_group_name'] = canonical_name

                accounts_payload = data_to_send.get('accounts')
                if isinstance(accounts_payload, list):
                    normalized_accounts = []
                    for account_entry in accounts_payload:
                        if not isinstance(account_entry, dict):
                            continue
                        normalized_accounts.append({
                            **account_entry,
                            "parent": canonical_name,
                            "company": account_entry.get("company") or company_name
                        })
                    if normalized_accounts:
                        data_to_send['accounts'] = normalized_accounts
            else:  # Supplier Group
                original_name = (data_to_send.get('supplier_group_name') or '').strip()
                canonical_name = add_company_abbr(original_name, company_abbr)
                if not canonical_name.strip():
                    return jsonify({
                        'success': False,
                        'message': 'Se requiere el nombre del grupo'
                    }), 400
                data_to_send['supplier_group_name'] = canonical_name

            data_to_send['custom_company'] = company_name

        print(f"DEBUG: Data to send to ERPNext: {data_to_send}")

        # Hacer la petición POST a ERPNext
        create_resp, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint=f"/api/resource/{doctype}",
            data={"data": data_to_send},
            operation_name=f"Create resource '{doctype}'"
        )

        if create_error:
            print(f"DEBUG: Error creating resource: {create_error}")
            return handle_erpnext_error(create_error, f"Failed to create resource {doctype}")

        print(f"DEBUG: ERPNext response status: {create_resp.status_code}")
        print(f"DEBUG: ERPNext response content: {create_resp.text}")

        if create_resp.status_code in [200, 201]:
            data = create_resp.json()
            return jsonify({
                'success': True,
                'data': data.get('data', {}),
                'message': f'Recurso {doctype} creado correctamente'
            })
        else:
            error_data = create_resp.json() if create_resp.content else {}
            print(f"DEBUG: ERPNext error data: {error_data}")
            return jsonify({
                'success': False,
                'message': f'Error al crear {doctype}: {create_resp.status_code} - {error_data.get("message", "Error desconocido")}',
                'data': error_data
            }), create_resp.status_code

    except Exception as e:
        print(f"DEBUG: Exception in create_resource: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}',
            'data': {}
        }), 500

@resources_bp.route('/resource/<doctype>/<name>', methods=['PUT'])
def update_resource(doctype, name):
    """
    Endpoint para actualizar un recurso existente en ERPNext
    """
    try:
        # Obtener sesión autenticada
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener datos del request
        request_data = request.get_json()

        # Obtener datos del request
        update_resp, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/{doctype}/{quote(name)}",
            data=request_data,
            operation_name=f"Update resource '{doctype}/{name}'"
        )

        if update_error:
            return handle_erpnext_error(update_error, f"Failed to update resource {doctype}/{name}")

        if update_resp.status_code == 200:
            data = update_resp.json()
            return jsonify({
                'success': True,
                'data': data.get('data', {}),
                'message': f'Recurso {doctype}/{name} actualizado correctamente'
            })
        else:
            error_data = update_resp.json() if update_resp.content else {}
            return jsonify({
                'success': False,
                'message': f'Error al actualizar {doctype}/{name}: {update_resp.status_code} - {error_data.get("message", "Error desconocido")}',
                'data': error_data
            }), update_resp.status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}',
            'data': {}
        }), 500

@resources_bp.route('/resource/<doctype>/<name>', methods=['DELETE'])
def delete_resource(doctype, name):
    """
    Endpoint para eliminar un recurso en ERPNext
    """
    try:
        # Obtener sesión autenticada
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response
        
        # Hacer la petición DELETE a ERPNext
        delete_resp, delete_error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/{doctype}/{quote(name)}",
            operation_name=f"Delete resource '{doctype}/{name}'"
        )

        if delete_error:
            return handle_erpnext_error(delete_error, f"Failed to delete resource {doctype}/{name}")

        if delete_resp.status_code == 200:
            return jsonify({
                'success': True,
                'message': f'Recurso {doctype}/{name} eliminado correctamente'
            })
        else:
            error_data = delete_resp.json() if delete_resp.content else {}
            return jsonify({
                'success': False,
                'message': f'Error al eliminar {doctype}/{name}: {delete_resp.status_code} - {error_data.get("message", "Error desconocido")}',
                'data': error_data
            }), delete_resp.status_code

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}',
            'data': {}
        }), 500

@resources_bp.route('/customer-groups', methods=['GET'])
def get_customer_groups():
    """Obtiene la lista de grupos de clientes desde ERPNext"""

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company_name = request.args.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500


        # Obtener grupos de clientes desde ERPNext
        print("Obteniendo grupos de clientes desde ERPNext...")
        fields = ["name", "is_group", "old_parent", "custom_company"]
        fields_str = json.dumps(fields)
        # Traer TODOS los grupos sin filtro (ERPNext no filtra bien custom fields en documentos legacy)
        # Usar endpoint con espacio codificado y dejar que requests maneje el encoding
        groups_resp, groups_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Customer Group",
            params={
                # Pasar la lista JSON como string sin aplicar quote(); requests la codificará correctamente
                "fields": fields_str,
                "limit_page_length": 1000
            },
            operation_name="Get customer groups"
        )

        if groups_error:
            return handle_erpnext_error(groups_error, "Failed to get customer groups")

        if groups_resp.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada o inválida"}), 401
        elif groups_resp.status_code != 200:
            return jsonify({"success": False, "message": f"Error al obtener grupos de clientes: {groups_resp.status_code}"}), groups_resp.status_code

        groups_data = groups_resp.json()
        groups = groups_data.get("data", [])
        print(f"Grupos totales de ERPNext (antes de filtrar): {len(groups)}")

        # FILTRO EN PYTHON: solo grupos con custom_company == company_name (excluye All Customer Groups y otros legacy)
        groups = [group for group in groups if group.get("custom_company") == company_name]
        print(f"Grupos filtrados por company '{company_name}': {len(groups)}")

        # NO FILTRAR POR is_group - necesitamos tanto grupos padre (is_group=1) como hoja (is_group=0)
        # para que los modales puedan mostrar las opciones de "Grupo Padre"

        # Mapear campos de ERPNext a los que espera el frontend
        mapped_groups = []
        for group in groups:
            mapped_group = {
                'customer_group_name': group.get('name', ''),
                'name': group.get('name', ''),  # Mantener también el campo name para compatibilidad
                'is_group': group.get('is_group', 0),
                'parent_customer_group': group.get('old_parent', ''),
            }
            mapped_groups.append(mapped_group)




        return jsonify({"success": True, "data": mapped_groups, "message": "Grupos de clientes obtenidos correctamente"})

    except Exception as e:
        print(f"ERROR GENERAL en get_customer_groups: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@resources_bp.route('/customer-groups', methods=['POST'])
def create_customer_group():
    """Crea un nuevo grupo de clientes en ERPNext"""
    print("\n--- Petición de crear grupo de clientes recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos del grupo a crear
    group_data = request.get_json()
    print(f"Datos del grupo de clientes a crear: {group_data}")

    if not group_data or 'data' not in group_data:
        return jsonify({"success": False, "message": "Datos del grupo no proporcionados"}), 400

    try:
        company_name = request.args.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        data = group_data['data']
        company_name = data.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400

        # Mapear campos del frontend a los que espera ERPNext
        erpnext_data = {
            'name': data.get('customer_group_name', ''),
            'is_group': data.get('is_group', 0),
            'parent_customer_group': data.get('parent_customer_group', ''),
            'custom_company': company_name
        }

        # Validar campos requeridos
        if not erpnext_data.get('name'):
            return jsonify({"success": False, "message": "El nombre del grupo es requerido"}), 400

        # Si no se especifica parent, usar "All Customer Groups"
        if not erpnext_data.get('parent_customer_group'):
            erpnext_data['parent_customer_group'] = 'All Customer Groups'

        print(f"Datos finales del grupo para ERPNext: {erpnext_data}")

        # Crear grupo en ERPNext
        create_response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Customer Group",
            operation_name="Create Customer Group",
            data={"data": erpnext_data}
        )

        if error:
            return handle_erpnext_error(error, "Failed to create customer group")

        return jsonify({
            "success": True,
            "data": create_response.get("data"),
            "message": "Grupo de clientes creado correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en create_customer_group: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@resources_bp.route('/customer-groups/<path:group_name>', methods=['PUT'])
def update_customer_group(group_name):
    """Actualiza un grupo de clientes existente"""
    print(f"\n--- Petición de actualizar grupo de clientes {group_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos a actualizar
    update_data = request.get_json()
    print(f"Datos a actualizar: {update_data}")

    # Manejar tanto {'data': {...}} como {...} directamente
    if 'data' in update_data:
        data = update_data['data']
    else:
        data = update_data

    if not data:
        return jsonify({"success": False, "message": "Datos de actualización no proporcionados"}), 400

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        # Obtener la compañía activa del usuario para las cuentas
        company_name = data.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400

        # Mapear campos del frontend a los que espera ERPNext
        erpnext_data = {
            'name': data.get('customer_group_name', group_name),  # Usar el nombre de la URL si no viene en los datos
            'is_group': data.get('is_group'),
            'parent_customer_group': data.get('parent_customer_group'),
            'default_price_list': data.get('default_price_list'),
            'payment_terms': data.get('payment_terms_template'),
            'custom_company': company_name
        }

        # Agregar cuentas si se proporciona una cuenta
        if data.get('account'):
            erpnext_data['accounts'] = [{
                'doctype': 'Party Account',
                'company': company_name,
                'account': data['account']
            }]

        # Filtrar campos None para no enviarlos
        erpnext_data = {k: v for k, v in erpnext_data.items() if v is not None}

        print(f"Datos finales para actualizar en ERPNext: {erpnext_data}")

        # Actualizar grupo en ERPNext
        update_response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Customer Group/{quote(group_name)}",
            operation_name="Update Customer Group",
            data={"data": erpnext_data}
        )

        if error:
            return handle_erpnext_error(error, "Failed to update customer group")

        return jsonify({
            "success": True,
            "data": update_response.get("data"),
            "message": "Grupo de clientes actualizado correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en update_customer_group: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@resources_bp.route('/customer-groups/<path:group_name>', methods=['DELETE'])
def delete_customer_group(group_name):
    """Elimina un grupo de clientes (solo si no tiene clientes asociados)"""
    print(f"\n--- Petición de eliminar grupo de clientes {group_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company_name = request.args.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        # PRIMERO: Verificar si el grupo tiene clientes asociados
        # Extract filters and fields to avoid nested quotes in f-string
        # Usar params con JSON para evitar percent-encoding que rompe el parsing en ERPNext
        check_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Customer",
            params={
                "filters": json.dumps([["customer_group", "=", group_name]]),
                "fields": json.dumps(["name"]),
                "limit_page_length": 1
            },
            operation_name="Check Associated Customers"
        )

        if error:
            return handle_erpnext_error(error, "Failed to check associated customers")

        customers = check_response.json().get("data", [])
        if customers:
            return jsonify({
                "success": False,
                "message": f"No se puede eliminar el grupo '{group_name}' porque tiene {len(customers)} cliente(s) asociado(s)"
            }), 400

        # SEGUNDO: Verificar si el grupo tiene subgrupos
        # Extract filters and fields to avoid nested quotes in f-string
        subgroup_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Customer Group",
            params={
                "filters": json.dumps([["parent_customer_group", "=", group_name]]),
                "fields": json.dumps(["name"]),
                "limit_page_length": 1
            },
            operation_name="Check Associated Subgroups"
        )

        if error:
            return handle_erpnext_error(error, "Failed to check associated subgroups")

        subgroups = subgroup_response.json().get("data", [])
        if subgroups:
            return jsonify({
                "success": False,
                "message": f"No se puede eliminar el grupo '{group_name}' porque tiene {len(subgroups)} subgrupo(s)"
            }), 400

        # Si no hay clientes ni subgrupos asociados, proceder con la eliminación
        delete_response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Customer Group/{quote(group_name)}",
            operation_name="Delete Customer Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to delete customer group")

        return jsonify({
            "success": True,
            "message": f"Grupo de clientes '{group_name}' eliminado correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en delete_customer_group: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@resources_bp.route('/supplier-groups', methods=['GET'])
def get_supplier_groups():
    """Obtiene la lista de grupos de proveedores desde ERPNext"""
    print("\n--- Petición de obtener grupos de proveedores recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company_name = request.args.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500


        # Obtener grupos de proveedores desde ERPNext
        print("Obteniendo grupos de proveedores desde ERPNext...")
        fields = ["name", "is_group", "old_parent", "custom_company"]
        fields_str = json.dumps(fields)
        # Traer TODOS los grupos sin filtro (ERPNext no filtra bien custom fields en documentos legacy)
        groups_resp, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Supplier Group",
            params={
                "fields": fields_str,
                "limit_page_length": 1000
            },
            operation_name="Fetch Supplier Groups"
        )

        if error:
            return handle_erpnext_error(error, "Failed to fetch supplier groups")

        groups = groups_resp.json().get("data", [])
        print(f"Grupos totales de ERPNext (antes de filtrar): {len(groups)}")

        # FILTRO EN PYTHON: solo grupos con custom_company == company_name (excluye All Supplier Groups y otros legacy)
        groups = [group for group in groups if group.get("custom_company") == company_name]
        print(f"Grupos filtrados por company '{company_name}': {len(groups)}")

        print(f"Grupos crudos de ERPNext para proveedores: {groups}")

        print(f"Grupos de proveedores obtenidos: {len(groups)}")

        # Mapear campos de ERPNext a los que espera el frontend
        mapped_groups = []
        for group in groups:
            mapped_group = {
                'supplier_group_name': group.get('name', ''),
                'name': group.get('name', ''),  # Mantener también el campo name para compatibilidad
                'is_group': group.get('is_group', 0),
                'parent_supplier_group': group.get('old_parent', ''),
            }
            mapped_groups.append(mapped_group)

        print(f"Grupos mapeados para proveedores: {mapped_groups}")

        return jsonify({"success": True, "data": mapped_groups, "message": "Grupos de proveedores obtenidos correctamente"})

    except Exception as e:
        print(f"ERROR GENERAL en get_supplier_groups: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@resources_bp.route('/supplier-groups', methods=['POST'])
def create_supplier_group():
    """Crea un nuevo grupo de proveedores en ERPNext"""
    print("\n--- Petición de crear grupo de proveedores recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos del grupo a crear
    group_data = request.get_json()
    print(f"Datos del grupo de proveedores a crear: {group_data}")

    if not group_data or 'data' not in group_data:
        return jsonify({"success": False, "message": "Datos del grupo no proporcionados"}), 400

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        data = group_data['data']
        company_name = data.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400

        # Mapear campos del frontend a los que espera ERPNext
        erpnext_data = {
            'name': data.get('supplier_group_name', ''),
            'is_group': data.get('is_group', 0),
            'parent_supplier_group': data.get('parent_supplier_group', ''),
            'custom_company': company_name
        }

        # Validar campos requeridos
        if not erpnext_data.get('name'):
            return jsonify({"success": False, "message": "El nombre del grupo es requerido"}), 400



        print(f"Datos finales del grupo para ERPNext: {erpnext_data}")

        # Crear grupo en ERPNext
        create_response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Supplier Group",
            operation_name="Create Supplier Group",
            data={"data": erpnext_data}
        )

        if error:
            return handle_erpnext_error(error, "Failed to create supplier group")

        return jsonify({
            "success": True,
            "data": create_response.get("data"),
            "message": "Grupo de proveedores creado correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en create_supplier_group: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@resources_bp.route('/supplier-groups/<path:group_name>', methods=['PUT'])
def update_supplier_group(group_name):
    """Actualiza un grupo de proveedores existente"""
    print(f"\n--- Petición de actualizar grupo de proveedores {group_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos a actualizar
    update_data = request.get_json()
    print(f"Datos a actualizar: {update_data}")

    # Manejar tanto {'data': {...}} como {...} directamente
    if 'data' in update_data:
        data = update_data['data']
    else:
        data = update_data

    if not data:
        return jsonify({"success": False, "message": "Datos de actualización no proporcionados"}), 400

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        # Obtener la compañía activa del usuario para las cuentas
        company_name = data.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No se encontro una compania activa configurada para el usuario."}), 400

        # Mapear campos del frontend a los que espera ERPNext
        erpnext_data = {
            'name': data.get('supplier_group_name', group_name),  # Usar el nombre de la URL si no viene en los datos
            'is_group': data.get('is_group'),
            'parent_supplier_group': data.get('parent_supplier_group'),
            'default_price_list': data.get('default_price_list'),
            'payment_terms': data.get('payment_terms_template'),
            'custom_company': company_name
        }

        # Agregar cuentas si se proporciona una cuenta
        if data.get('account'):
            erpnext_data['accounts'] = [{
                'account': data.get('account'),
                'company': company_name
            }]

        # Filtrar campos None para no enviarlos
        erpnext_data = {k: v for k, v in erpnext_data.items() if v is not None}

        print(f"Datos finales para actualizar en ERPNext: {erpnext_data}")

        # Actualizar grupo en ERPNext
        update_response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Supplier Group/{quote(group_name)}",
            operation_name="Update Supplier Group",
            data={"data": erpnext_data}
        )

        if error:
            return handle_erpnext_error(error, "Failed to update supplier group")

        return jsonify({
            "success": True,
            "data": update_response.get("data"),
            "message": "Grupo de proveedores actualizado correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en update_supplier_group: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@resources_bp.route('/supplier-groups/<path:group_name>', methods=['DELETE'])
def delete_supplier_group(group_name):
    """Elimina un grupo de proveedores (solo si no tiene proveedores asociados)"""
    print(f"\n--- Petición de eliminar grupo de proveedores {group_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        # PRIMERO: Verificar si el grupo tiene proveedores asociados
        # Extract filters and fields to avoid nested quotes in f-string
        supplier_filters_str = f'["supplier_group","=","{group_name}"]'
        supplier_fields_str = '["name"]'
        check_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Supplier?filters={quote(supplier_filters_str)}&fields={quote(supplier_fields_str)}&limit_page_length=1",
            operation_name="Check Associated Suppliers"
        )

        if error:
            return handle_erpnext_error(error, "Failed to check associated suppliers")

        suppliers = check_response.json().get("data", [])
        if suppliers:
            return jsonify({
                "success": False,
                "message": f"No se puede eliminar el grupo '{group_name}' porque tiene {len(suppliers)} proveedor(es) asociado(s)"
            }), 400

        # SEGUNDO: Verificar si el grupo tiene subgrupos
        # Extract filters and fields to avoid nested quotes in f-string
        supplier_subgroup_filters_str = f'["parent_supplier_group","=","{group_name}"]'
        supplier_subgroup_fields_str = '["name"]'
        subgroup_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Supplier Group",
            params={
                "filters": json.dumps([["parent_supplier_group", "=", group_name]]),
                "fields": json.dumps(["name"]),
                "limit_page_length": 1
            },
            operation_name="Check Associated Supplier Subgroups"
        )

        if error:
            return handle_erpnext_error(error, "Failed to check associated supplier subgroups")

        subgroups = subgroup_response.json().get("data", [])
        if subgroups:
            return jsonify({
                "success": False,
                "message": f"No se puede eliminar el grupo '{group_name}' porque tiene {len(subgroups)} subgrupo(s)"
            }), 400

        # Si no hay proveedores ni subgrupos asociados, proceder con la eliminación
        delete_response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Supplier Group/{quote(group_name)}",
            operation_name="Delete Supplier Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to delete supplier group")

        return jsonify({
            "success": True,
            "message": f"Grupo de proveedores '{group_name}' eliminado correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en delete_supplier_group: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

