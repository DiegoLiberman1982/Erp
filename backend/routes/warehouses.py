from flask import Blueprint, request, jsonify
import requests
import datetime
import traceback
import json
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr

# Importar función para remover sigla de compañía
from routes.general import remove_company_abbr

# Importar utilidades de tokens de warehouse
from utils.warehouse_tokens import ensure_warehouse, sanitize_supplier_code, validate_warehouse_name, tokenize_warehouse_name

# Importar helper de query de warehouses
from utils.warehouse_api import fetch_company_warehouses

# Crear el blueprint para las rutas de warehouses
warehouses_bp = Blueprint('warehouses', __name__)


@warehouses_bp.route('/api/inventory/warehouses', methods=['GET', 'OPTIONS'])
def get_warehouses():
    """Obtener lista de warehouses de una compañía"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        print("--- Obtener warehouses: error auth")
        return error_response

    print("--- Obtener warehouses: procesando")

    try:
        company = request.args.get('company')
        include_groups = request.args.get('include_groups', 'false').lower() == 'true'
        if not company or company in ('undefined', 'null', ''):
            return jsonify({
                'success': False,
                'message': 'Parámetro company requerido'
            }), 400

        # Usar filtro nativo de ERPNext por campo "company" (MUCHO MÁS EFICIENTE)
        extra_filters = []
        if not include_groups:
            extra_filters.append(["is_group", "=", 0])

        response, error = fetch_company_warehouses(
            session=session,
            company=company,
            fields=["name","warehouse_name","is_group","parent_warehouse","company","warehouse_type","account","phone_no","email_id","disabled"],
            extra_filters=extra_filters,
            operation_name="Get Warehouses"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get warehouses")

        warehouses_data = response.json()
        warehouses = warehouses_data.get('data', [])


        # Nota: el filtro por disabled/is_group se hace en ERPNext.

        # Obtener sigla de la compañía para removerla de los nombres
        company_abbr = get_company_abbr(session, headers, company)

        # PASO 1: Procesar todos los warehouses e identificar variantes
        formatted_warehouses = []
        variants_by_base = {}  # Map: base_warehouse_name -> [variants]
        
        # Primera pasada: identificar todas las variantes y calcular sus bases
        for warehouse in warehouses:
            full_name = warehouse.get('name', '')
            full_warehouse_name = warehouse.get('warehouse_name', '')
            
            # Detectar si es variante CON/VCON
            if '__CON[' in full_name or '__VCON[' in full_name:
                # Es una variante - calcular el nombre del warehouse base
                if '__CON[' in full_name:
                    base_name = full_name.split('__CON[')[0] + ' - ' + company_abbr
                elif '__VCON[' in full_name:
                    base_name = full_name.split('__VCON[')[0] + ' - ' + company_abbr
                
                # Normalizar para búsqueda case-insensitive
                base_name_normalized = base_name.upper()
                
                if base_name_normalized not in variants_by_base:
                    variants_by_base[base_name_normalized] = []
                
                variants_by_base[base_name_normalized].append(warehouse)
        

        # PASO 2: Procesar TODOS los warehouses y marcar los que tienen consignación
        # Usar un mapa para evitar procesar warehouses duplicados
        processed_warehouses = {}

        for warehouse in warehouses:
            full_name = warehouse.get('name', '')
            full_warehouse_name = warehouse.get('warehouse_name', '')

            # Remover sigla de compañía del warehouse_name para mostrar en frontend
            display_name = remove_company_abbr(full_warehouse_name, company_abbr)

            formatted_warehouse = {
                'name': full_name,
                'warehouse_name': display_name,
                'display_name': display_name,
                'is_group': warehouse.get('is_group', 0),
                'parent_warehouse': warehouse.get('parent_warehouse', ''),
                'company': warehouse.get('company', ''),
                'warehouse_type': warehouse.get('warehouse_type', ''),
                'account': warehouse.get('account', ''),
                'address': warehouse.get('address', ''),
                'city': warehouse.get('city', ''),
                'state': warehouse.get('state', ''),
                'country': warehouse.get('country', ''),
                'phone_no': warehouse.get('phone_no', ''),
                'email_id': warehouse.get('email_id', ''),
                'disabled': warehouse.get('disabled', 0)
            }

            # Verificar si este warehouse es una variante CON/VCON
            is_variant = '__CON[' in full_name or '__VCON[' in full_name

            if is_variant:
                # Es una variante - marcarla y agregar info de rol
                formatted_warehouse['is_consignment_variant'] = True
                if '__CON[' in full_name:
                    formatted_warehouse['role'] = 'CON'
                    start = full_name.index('__CON[') + 6
                    end = full_name.index(']', start)
                    formatted_warehouse['supplier_code'] = full_name[start:end]
                elif '__VCON[' in full_name:
                    formatted_warehouse['role'] = 'VCON'
                    start = full_name.index('__VCON[') + 7
                    end = full_name.index(']', start)
                    formatted_warehouse['supplier_code'] = full_name[start:end]

            else:
                # Es un warehouse base - verificar si tiene variantes
                full_name_normalized = full_name.upper()

                if full_name_normalized in variants_by_base:
                    # Este warehouse tiene variantes CON/VCON
                    variant_list = variants_by_base[full_name_normalized]
                    formatted_warehouse['has_consignment'] = True
                    formatted_warehouse['consignment_count'] = len(variant_list)

                    # Agregar info de las variantes
                    formatted_warehouse['consignment_variants'] = []
                    for variant in variant_list:
                        variant_name = variant.get('name', '')
                        if '__CON[' in variant_name:
                            role = 'CON'
                        elif '__VCON[' in variant_name:
                            role = 'VCON'
                        else:
                            role = 'UNKNOWN'

                        formatted_warehouse['consignment_variants'].append({
                            'name': variant_name,
                            'role': role
                        })

                else:
                    formatted_warehouse['has_consignment'] = False

            processed_warehouses[full_name] = formatted_warehouse

        # Convertir el mapa a lista
        formatted_warehouses = list(processed_warehouses.values())
        

        # Retornar respuesta con la lista de warehouses (ahora incluye indicadores de consignación)
        response_data = {
            'success': True,
            'data': formatted_warehouses  # Lista con TODOS los warehouses + indicadores de consignación
        }
        

        return jsonify(response_data)

    except Exception as e:
        print("--- Obtener warehouses: error")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@warehouses_bp.route('/api/inventory/warehouses', methods=['POST', 'OPTIONS'])
def create_warehouse():
    """Crear un nuevo warehouse"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print("--- Crear warehouse: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'Datos requeridos'
            }), 400

        company = data.get('company')
        if not company:
            return jsonify({
                'success': False,
                'message': 'Compañía es requerida'
            }), 400

        # Verificar si es creación tokenizada (con base_code, role) o manual (warehouse_name)
        base_code = data.get('base_code')
        role = data.get('role')
        supplier = data.get('supplier')

        if base_code and role:
            # Creación tokenizada: usar ensure_warehouse
            print("--- Crear warehouse tokenizado: procesando")

            # Sanitizar supplier si viene
            sanitized_supplier = sanitize_supplier_code(supplier) if supplier else None

            try:
                result = ensure_warehouse(
                    session=session,
                    headers=headers,
                    company=company,
                    base_code=base_code,
                    role=role,
                    supplier_code=sanitized_supplier
                )

                print("--- Crear warehouse tokenizado: ok")

                return jsonify({
                    'success': True,
                    'warehouse': result['name'],
                    'auto_created': result['auto_created']
                })

            except ValueError as ve:
                return jsonify({
                    'success': False,
                    'message': f'Error en parámetros tokenizados: {str(ve)}'
                }), 400
            except Exception as e:
                print("--- Crear warehouse tokenizado: error")
                traceback.print_exc()
                return jsonify({
                    'success': False,
                    'message': f'Error al crear warehouse tokenizado: {str(e)}'
                }), 500

        else:
            # Creación manual: usar warehouse_name
            warehouse_name = data.get('warehouse_name')
            if not warehouse_name:
                return jsonify({
                    'success': False,
                    'message': 'Nombre del warehouse es requerido para creación manual'
                }), 400

            # Verificar si el nombre coincide con la convención tokenizada
            if validate_warehouse_name(warehouse_name):
                return jsonify({
                    'success': False,
                    'message': 'Los nombres tokenizados (<BASE>__<ROL>[<PROV>]) deben crearse usando base_code, role y supplier. Use creación manual solo para nombres libres.'
                }), 400

            print("--- Crear warehouse manual: procesando")

            # Proceder con creación manual como antes
            warehouse_type = data.get('warehouse_type', '')
            is_group = data.get('is_group', 0)
            parent_warehouse = data.get('parent_warehouse', '')
            account = data.get('account', '')
            address = data.get('address', '')
            city = data.get('city', '')
            state = data.get('state', '')
            country = data.get('country', '')
            phone_no = data.get('phone_no', '')
            email_id = data.get('email_id', '')

            # Obtener la sigla de la compañía
            company_abbr = get_company_abbr(session, headers, company)
            if not company_abbr:
                return jsonify({
                    'success': False,
                    'message': f'No se pudo obtener la sigla de la compañía {company}'
                }), 400

            # Generar el nombre del warehouse (warehouse_name - ABBR)
            warehouse_code = f"{warehouse_name} - {company_abbr}"

            # Preparar datos del warehouse
            warehouse_data = {
                'warehouse_name': warehouse_name,
                'company': company,
                'warehouse_type': warehouse_type,
                'is_group': is_group,
                'account': account,
                'address': address,
                'city': city,
                'state': state,
                'country': country,
                'phone_no': phone_no,
                'email_id': email_id
            }

            if parent_warehouse:
                warehouse_data['parent_warehouse'] = parent_warehouse

            # Crear el warehouse
            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Warehouse",
                data={'data': warehouse_data},
                operation_name="Create Warehouse"
            )

            if create_error:
                return handle_erpnext_error(create_error, "Failed to create warehouse")

            created_data = create_response.json()
            warehouse_name_created = created_data.get('data', {}).get('name', warehouse_code)

            print("--- Crear warehouse manual: ok")

            return jsonify({
                'success': True,
                'message': 'Warehouse creado exitosamente',
                'data': {
                    'name': warehouse_name_created,
                    'warehouse_name': warehouse_name,
                    'company': company,
                    'warehouse_type': warehouse_type,
                    'is_group': is_group,
                    'parent_warehouse': parent_warehouse,
                    'account': account,
                    'address': address,
                    'city': city,
                    'state': state,
                    'country': country,
                    'phone_no': phone_no,
                    'email_id': email_id
                }
            })

    except Exception as e:
        print("--- Crear warehouse: error")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@warehouses_bp.route('/api/inventory/warehouses/<warehouse_name>', methods=['PUT', 'OPTIONS'])
def update_warehouse(warehouse_name):
    """Actualizar un warehouse existente"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print("--- Actualizar warehouse: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'Datos requeridos'
            }), 400

        # Preparar datos de actualización
        update_data = {}

        # Campos que se pueden actualizar
        updatable_fields = [
            'warehouse_name', 'warehouse_type', 'is_group', 'parent_warehouse',
            'account', 'address', 'city', 'state', 'country', 'phone_no',
            'email_id', 'disabled'
        ]

        for field in updatable_fields:
            if field in data:
                update_data[field] = data[field]

        # Si se está actualizando el warehouse_name, agregar la sigla de la compañía
        if 'warehouse_name' in update_data:
            # Obtener la compañía del warehouse actual para saber qué sigla usar
            warehouse_response, warehouse_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Warehouse/{quote(warehouse_name)}",
                operation_name="Get Warehouse for Update"
            )

            if not warehouse_error and warehouse_response.status_code == 200:
                warehouse_data = warehouse_response.json().get('data', {})
                company = warehouse_data.get('company')

                if company:
                    # Obtener sigla de la compañía
                    company_abbr = get_company_abbr(session, headers, company)
                    if company_abbr:
                        original_name = update_data['warehouse_name'].strip()
                        # Solo agregar sigla si no está presente
                        if not original_name.endswith(f" - {company_abbr}"):
                            update_data['warehouse_name'] = f"{original_name} - {company_abbr}"
            else:
                print(f"--- Advertencia: No se pudo obtener compañía del warehouse {warehouse_name}")

        if not update_data:
            return jsonify({
                'success': False,
                'message': 'No hay campos para actualizar'
            }), 400

        # Actualizar el warehouse
        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Warehouse/{quote(warehouse_name)}",
            data={'data': update_data},
            operation_name="Update Warehouse"
        )

        if update_error:
            return handle_erpnext_error(update_error, "Failed to update warehouse")

        updated_data = update_response.json()

        print("--- Actualizar warehouse: ok")

        return jsonify({
            'success': True,
            'message': 'Warehouse actualizado exitosamente',
            'data': updated_data.get('data', {})
        })

    except Exception as e:
        print("--- Actualizar warehouse: error")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@warehouses_bp.route('/api/inventory/warehouses/<warehouse_name>', methods=['DELETE', 'OPTIONS'])
def delete_warehouse(warehouse_name):
    """Eliminar un warehouse"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print("--- Eliminar warehouse: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Verificar si el warehouse tiene stock antes de eliminar
        stock_response, stock_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Bin?filters=[[\"warehouse\",\"=\",\"{warehouse_name}\"]]&fields=[\"name\",\"actual_qty\"]",
            operation_name="Check Warehouse Stock"
        )

        if not stock_error and stock_response.status_code == 200:
            stock_data = stock_response.json()
            bins = stock_data.get('data', [])

            # Verificar si hay stock en el warehouse
            has_stock = any(bin.get('actual_qty', 0) > 0 for bin in bins)

            if has_stock:
                return jsonify({
                    'success': False,
                    'message': 'No se puede eliminar el warehouse porque tiene stock'
                }), 400

        # Eliminar el warehouse (si falla por documentos vinculados/movimientos, se deshabilita)
        delete_response, delete_error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Warehouse/{quote(warehouse_name)}",
            operation_name="Delete Warehouse"
        )

        if delete_error:
            disable_response, disable_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Warehouse/{quote(warehouse_name)}",
                data={'data': {'disabled': 1}},
                operation_name="Disable Warehouse (fallback after delete failure)"
            )

            if not disable_error and disable_response and disable_response.status_code in (200, 201):
                print("--- Eliminar warehouse: no se pudo borrar; se deshabilitó")
                return jsonify({
                    'success': True,
                    'message': 'No se pudo eliminar el warehouse (posibles movimientos/documentos vinculados). Se deshabilitó (disabled=1).',
                    'action': 'disabled'
                }), 202

            return handle_erpnext_error(delete_error, "Failed to delete warehouse")

        print("--- Eliminar warehouse: ok")

        return jsonify({
            'success': True,
            'message': 'Warehouse eliminado exitosamente',
            'action': 'deleted'
        })

    except Exception as e:
        print("--- Eliminar warehouse: error")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@warehouses_bp.route('/api/inventory/warehouse-types', methods=['GET', 'OPTIONS'])
def get_warehouse_types():
    """Obtener lista de tipos de warehouse disponibles"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print("--- Obtener tipos warehouse: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Warehouse%20Type?fields=[\"name\"]",
            operation_name="Get Warehouse Types"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get warehouse types")

        types_data = response.json()
        warehouse_types = types_data.get('data', [])

        # Formatear los tipos
        formatted_types = []
        for wtype in warehouse_types:
            type_name = wtype.get('name', '')
            formatted_type = {
                'name': type_name,
                'warehouse_type_name': type_name  # Usar el mismo valor para ambos campos
            }
            formatted_types.append(formatted_type)

        print(f"--- Tipos warehouse: {len(formatted_types)} registros")

        return jsonify({
            'success': True,
            'data': formatted_types
        })

    except Exception as e:
        print("--- Obtener tipos warehouse: error")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@warehouses_bp.route('/api/inventory/warehouse-types', methods=['POST', 'OPTIONS'])
def create_warehouse_type():
    """Crear un tipo de warehouse en ERPNext"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print("--- Crear tipo warehouse: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    warehouse_type_data = request.get_json()
    if not warehouse_type_data or 'data' not in warehouse_type_data:
        return jsonify({"success": False, "message": "Datos del tipo de warehouse requeridos"}), 400

    try:
        # Preparar datos - enviar name y warehouse_type_name
        warehouse_type_name = warehouse_type_data['data']['warehouse_type_name']
        data_to_send = {
            "name": warehouse_type_name,
            "warehouse_type_name": warehouse_type_name
        }

        # Configurar headers para la petición
        request_headers = {**headers, 'Content-Type': 'application/json'}

        # Hacer la petición POST a ERPNext para crear el tipo de warehouse
        create_type_response, create_type_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Warehouse%20Type",
            data=data_to_send,
            operation_name="Create Warehouse Type"
        )

        if create_type_error:
            return handle_erpnext_error(create_type_error, "Failed to create warehouse type")

        new_warehouse_type_data = create_type_response.json()

        print("--- Crear tipo warehouse: ok")

        return jsonify({"success": True, "data": new_warehouse_type_data.get("data", {}), "message": "Tipo de warehouse creado correctamente"})

    except requests.exceptions.HTTPError as err:
        print("--- Crear tipo warehouse: error HTTP")
        try:
            error_detail = err.response.json()
            return jsonify({"success": False, "message": error_detail.get("message", "Error al crear tipo de warehouse")}), 500
        except:
            return jsonify({"success": False, "message": "Error al crear tipo de warehouse"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Crear tipo warehouse: error conexión")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

