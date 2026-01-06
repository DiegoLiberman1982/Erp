from flask import Blueprint, request, jsonify
import traceback
import json
from urllib.parse import quote

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar utilidades de tokens de warehouse
from utils.warehouse_tokens import tokenize_warehouse_name, ensure_warehouse, sanitize_supplier_code
from utils.warehouse_api import fetch_company_warehouses

# Crear el blueprint para las rutas de configuración de warehouses
config_warehouses_bp = Blueprint('config_warehouses', __name__)


@config_warehouses_bp.route('/api/config/warehouses/merged', methods=['GET', 'OPTIONS'])
def get_merged_warehouses():
    """Obtener vista mergeada de warehouses agrupados por base_code con flags de roles y proveedores"""

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        print("--- Obtener warehouses mergeados: error auth")
        return error_response

    print("--- Obtener warehouses mergeados: procesando")

    try:
        company = request.args.get('company')
        if not company:
            return jsonify({
                'success': False,
                'message': 'Parámetro company requerido'
            }), 400

        # Obtener todos los warehouses de la compañía
        # NOTA: Pedimos tanto 'name' (ID interno) como 'warehouse_name' (etiqueta visible)
        response, error = fetch_company_warehouses(
            session=session,
            company=company,
            fields=["name", "warehouse_name"],
            operation_name="Get Warehouses for Merge"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get warehouses for merge")

        warehouses_data = response.json()
        warehouses = warehouses_data.get('data', [])
        
        # Obtener sigla de la compañía para limpiar nombres
        from routes.general import get_company_abbr, remove_company_abbr
        company_abbr = get_company_abbr(session, headers, company)

        # Agrupar por base_code con estructura completa de warehouses anidados
        merged_data = {}

        for warehouse in warehouses:
            full_name = warehouse.get('name', '')
            full_warehouse_name = warehouse.get('warehouse_name', '')
            
            # Tokenizar el nombre para extraer componentes
            tokens = tokenize_warehouse_name(full_name)
            if not tokens:
                # Si no es un nombre tokenizado, saltar
                continue

            base_code = tokens['base_code']
            role = tokens['role']
            supplier_code = tokens['supplier_code']
            
            # Display name sin sigla de compañía
            display_name = remove_company_abbr(full_warehouse_name, company_abbr)

            if base_code not in merged_data:
                merged_data[base_code] = {
                    'base_code': base_code,
                    'has_own': False,
                    'has_con': False,
                    'has_vcon': False,
                    'ownWarehouse': None,
                    'consignationWarehouses': [],  # Lista de CON warehouses completos
                    'vendorConsignationWarehouses': [],  # Lista de VCON warehouses completos
                    'con_suppliers': [],  # Solo códigos para backward compatibility
                    'vcon_suppliers': []  # Solo códigos para backward compatibility
                }

            # Warehouse object común
            warehouse_obj = {
                'name': full_name,  # Internal ERPNext ID
                'warehouse_name': display_name,  # Display label (sin sigla)
                'display_name': display_name,  # Alias para claridad
                'base_code': base_code,
                'role': role,
                'supplier_code': supplier_code
            }

            # Asignar según rol
            if role == 'OWN':
                merged_data[base_code]['has_own'] = True
                merged_data[base_code]['ownWarehouse'] = warehouse_obj
            elif role == 'CON':
                merged_data[base_code]['has_con'] = True
                merged_data[base_code]['consignationWarehouses'].append(warehouse_obj)
                if supplier_code and supplier_code not in merged_data[base_code]['con_suppliers']:
                    merged_data[base_code]['con_suppliers'].append(supplier_code)
            elif role == 'VCON':
                merged_data[base_code]['has_vcon'] = True
                merged_data[base_code]['vendorConsignationWarehouses'].append(warehouse_obj)
                if supplier_code and supplier_code not in merged_data[base_code]['vcon_suppliers']:
                    merged_data[base_code]['vcon_suppliers'].append(supplier_code)

        # Convertir a lista
        merged_list = list(merged_data.values())

        print(f"--- Warehouses mergeados: {len(merged_list)} grupos")

        return jsonify({
            'success': True,
            'data': merged_list
        })

    except Exception as e:
        print("--- Obtener warehouses mergeados: error")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@config_warehouses_bp.route('/api/config/warehouses/ensure', methods=['POST', 'OPTIONS'])
def ensure_warehouse_endpoint():
    """Asegurar que un warehouse tokenizado existe, creándolo si es necesario"""

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        print("--- Ensure warehouse: error auth")
        return error_response

    print("--- Ensure warehouse: procesando")

    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'Datos requeridos'
            }), 400

        company = data.get('company')
        base_code = data.get('base_code')
        role = data.get('role')
        supplier = data.get('supplier')

        if not company or not base_code or not role:
            return jsonify({
                'success': False,
                'message': 'Compañía, base_code y role son requeridos'
            }), 400

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

            print("--- Ensure warehouse: ok")

            return jsonify({
                'success': True,
                'warehouse': {
                    'name': result['name'],
                    'warehouse_name': result['warehouse_name'],
                    'parent_warehouse': result['parent_warehouse']
                },
                'auto_created': result['auto_created']
            })

        except ValueError as ve:
            return jsonify({
                'success': False,
                'message': f'Error en parámetros: {str(ve)}'
            }), 400
        except Exception as e:
            print("--- Ensure warehouse: error")
            traceback.print_exc()
            return jsonify({
                'success': False,
                'message': f'Error al asegurar warehouse: {str(e)}'
            }), 500

    except Exception as e:
        print("--- Ensure warehouse: error general")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500
