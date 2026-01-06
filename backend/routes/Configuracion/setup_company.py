"""
Setup - Company Initialization
Handles company setup and initialization processes in ERPNext
"""

from flask import jsonify
import json
from urllib.parse import quote
from config import ERPNEXT_URL

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_company_abbr

# Importar funciones de otros módulos de setup
from .setup_uom import ensure_uom_exists
from .setup_groups import setup_all_groups
from .setup_price_lists import ensure_price_lists_exist
from .setup_tax_templates import ensure_tax_templates_exist
from .setup_iva_accounts import ensure_iva_tax_accounts_exist
from .setup_item_tax_templates import ensure_item_tax_templates_exist_v2
from .setup_custom_fields import create_item_tax_template_custom_fields
from .setup_doctype_inflacion import ensure_inflacion_doctype
from services.letterhead_service import ensure_default_letterhead
from routes.system_settings import apply_initial_system_settings
from utils.http_utils import make_erpnext_request

DEFAULT_WAREHOUSES_TO_REMOVE = [
    "Sucursales",
    "Trabajo en Proceso",
    "Productos terminados",
    "Las mercancías en tránsito"
]

EXCHANGE_GAIN_LOSS_ACCOUNT_NUMBER = "5.1.5.04.00"


def apply_initial_stock_settings(session, headers):
    """Habilita reservas de inventario al iniciar la empresa.
    
    NOTA: allow_negative_stock NO se puede habilitar junto con enable_stock_reservation
    según validación de ERPNext, así que solo habilitamos reservas.
    """
    print("Aplicando configuracion inicial de Stock Settings (reservas)...")
    _ = headers  # Parametro reservado para futuros headers custom

    payload = {
        "allow_negative_stock": 0,  # No compatible con stock reservation
        "enable_stock_reservation": 1,
        "allow_partial_reservation": 1
    }

    try:
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint="/api/resource/Stock%20Settings/StockSettings",
            data={"data": payload},
            operation_name="Apply initial Stock Settings"
        )

        if error:
            message = error.get("message", "Error aplicando Stock Settings")
            print(f"Error aplicando Stock Settings: {message}")
            return False, message

        if response and response.status_code in (200, 202):
            print("Stock Settings configurado con reservas habilitadas")
            return True, "Stock Settings actualizado (reservas habilitadas)"

        message = f"Respuesta inesperada de ERPNext: {response.status_code if response else 'sin respuesta'}"
        print(message)
        return False, message

    except Exception as e:
        print(f"Error general al aplicar Stock Settings: {e}")
        return False, str(e)


def assign_exchange_gain_loss_account(session, headers, company_name):
    """Asigna la cuenta de Diferencia de Cambio en Company si existe en el plan de cuentas."""
    _ = headers  # reservado para futuros headers custom
    print("Configurando cuenta de ganancia/pérdida por diferencia de cambio...")

    try:
        # Obtener el valor actual configurado en la compañía
        company_resp, company_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            params={"fields": json.dumps(["exchange_gain_loss_account"])},
            operation_name="Get current exchange gain/loss account"
        )

        if company_err:
            return {
                "success": False,
                "message": f"No se pudo leer la configuración actual de la compañía: {company_err.get('message', company_err)}"
            }

        current_account = None
        if company_resp and company_resp.status_code == 200:
            current_account = (company_resp.json().get("data") or {}).get("exchange_gain_loss_account")

        # Si ya existe una cuenta configurada, no hacer cambios
        if current_account:
            print(f"Cuenta de diferencia de cambio ya configurada: {current_account}")
            return {
                "success": True,
                "message": "La cuenta de diferencia de cambio ya estaba configurada",
                "account": current_account
            }

        # Buscar la cuenta por número en el plan de cuentas
        filters = [
            ["company", "=", company_name],
            ["account_number", "=", EXCHANGE_GAIN_LOSS_ACCOUNT_NUMBER],
            ["is_group", "=", 0]
        ]
        account_resp, account_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Account",
            params={
                "filters": json.dumps(filters),
                "fields": json.dumps(["name", "account_name", "account_number"]),
                "limit_page_length": 1
            },
            operation_name="Find exchange gain/loss account"
        )

        if account_err:
            return {
                "success": False,
                "message": f"No se pudo buscar la cuenta de diferencia de cambio: {account_err.get('message', account_err)}"
            }

        account_data = None
        if account_resp and account_resp.status_code == 200:
            rows = account_resp.json().get("data") or []
            if rows:
                account_data = rows[0]

        if not account_data:
            return {
                "success": False,
                "message": f"No se encontró la cuenta con número {EXCHANGE_GAIN_LOSS_ACCOUNT_NUMBER} en {company_name}",
                "account_number": EXCHANGE_GAIN_LOSS_ACCOUNT_NUMBER
            }

        # Asignar la cuenta encontrada en la compañía
        update_resp, update_err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            data={"data": {"exchange_gain_loss_account": account_data.get("name")}},
            operation_name="Set exchange gain/loss account"
        )

        if update_err:
            return {
                "success": False,
                "message": f"No se pudo asignar la cuenta de diferencia de cambio: {update_err.get('message', update_err)}"
            }

        if not update_resp or update_resp.status_code not in (200, 202):
            return {
                "success": False,
                "message": f"ERPNext no confirmó la asignación de la cuenta: {update_resp.text if update_resp else 'sin respuesta'}"
            }

        assigned_account = account_data.get("name")
        print(f"Cuenta de diferencia de cambio asignada: {assigned_account}")
        return {
            "success": True,
            "message": "Cuenta de diferencia de cambio asignada correctamente",
            "account": assigned_account,
            "account_number": account_data.get("account_number")
        }

    except Exception as e:
        print(f"Error configurando cuenta de diferencia de cambio: {e}")
        return {
            "success": False,
            "message": f"Error interno configurando cuenta de diferencia de cambio: {str(e)}"
        }


def configure_company_default_warehouse(session, headers, company_name):
    """Crea un almacén por defecto basado en la dirección principal y elimina los almacenes iniciales."""
    try:
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return {
                "success": False,
                "message": f"No se pudo obtener la abreviatura de la compañía {company_name}"
            }

        # Buscar la dirección fiscal de la compañía consultando todas las direcciones
        # y filtrando las que están vinculadas a esta compañía con address_type = Billing
        all_addresses_resp, all_addresses_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Address",
            params={
                "filters": json.dumps([
                    ["address_type", "=", "Billing"]
                ]),
                "fields": json.dumps(["name", "address_line1", "address_type"]),
                "limit_page_length": 100
            },
            operation_name="Find Billing addresses"
        )

        if all_addresses_err:
            return {
                "success": False,
                "message": f"Error buscando direcciones: {all_addresses_err.get('message', all_addresses_err)}"
            }

        # Buscar entre las direcciones de tipo Billing cuál está vinculada a esta compañía
        address_docname = None
        address_line1 = None
        
        if all_addresses_resp and all_addresses_resp.status_code == 200:
            addresses = all_addresses_resp.json().get("data", [])
            print(f"Encontradas {len(addresses)} direcciones de tipo Billing")
            
            for addr in addresses:
                addr_name = addr.get("name")
                # Obtener los links de cada dirección para verificar si está vinculada a esta compañía
                addr_detail_resp, addr_detail_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Address/{quote(addr_name)}",
                    params={"fields": json.dumps(["name", "address_line1", "links"])},
                    operation_name=f"Get address details for {addr_name}"
                )
                
                if addr_detail_err or not addr_detail_resp or addr_detail_resp.status_code != 200:
                    continue
                
                addr_data = addr_detail_resp.json().get("data", {})
                links = addr_data.get("links", [])
                
                # Verificar si esta dirección está vinculada a nuestra compañía
                for link in links:
                    if link.get("link_doctype") == "Company" and link.get("link_name") == company_name:
                        address_docname = addr_name
                        address_line1 = addr_data.get("address_line1")
                        print(f"Dirección fiscal encontrada para {company_name}: {address_docname}")
                        break
                
                if address_docname:
                    break

        if not address_docname:
            return {
                "success": False,
                "message": f"No se encontró dirección fiscal (Billing) vinculada a {company_name}. Cree primero una dirección de tipo 'Dirección Fiscal' para la compañía."
            }

        if not address_line1:
            return {
                "success": False,
                "message": f"La dirección {address_docname} no tiene address_line1 definido"
            }
        address_line1 = address_line1.strip()

        warehouse_label = f"ALMACEN {address_line1}"
        existing_resp, existing_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Warehouse",
            params={
                "filters": json.dumps([
                    ["warehouse_name", "=", warehouse_label],
                    ["company", "=", company_name]
                ]),
                "fields": json.dumps(["name", "warehouse_name"]),
                "limit_page_length": 1
            },
            operation_name="Check existing default warehouse for company"
        )

        created_warehouse_name = None
        warehouse_created = False

        if existing_err:
            print(f"Advertencia: no se pudo verificar warehouse existente: {existing_err}")
        elif existing_resp and existing_resp.status_code == 200:
            existing_data = existing_resp.json().get("data", [])
            if existing_data:
                created_warehouse_name = existing_data[0].get("name")
                print(f"Warehouse por defecto ya existe: {created_warehouse_name}")

        if not created_warehouse_name:
            # Try common parent warehouse names in order: English then Spanish
            possible_parent_names = [
                f"All Warehouses - {company_abbr}",
                f"Todos los almacenes - {company_abbr}"
            ]

            parent_warehouse = None
            for candidate in possible_parent_names:
                # Check if candidate exists
                parent_check_resp, parent_check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Warehouse/{quote(candidate)}",
                    operation_name=f"Check parent warehouse '{candidate}'"
                )
                if parent_check_resp and parent_check_resp.status_code == 200:
                    parent_warehouse = candidate
                    break

            # Fallback: try to find any group warehouse for company (localized or custom names)
            if not parent_warehouse:
                group_search_resp, group_search_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Warehouse",
                    params={
                        "fields": json.dumps(["name","warehouse_name","is_group","company"]),
                        "filters": json.dumps([["company","=",company_name],["is_group","=",1]]),
                        "limit_page_length": 1
                    },
                    operation_name=f"Find any group warehouse for company {company_name}"
                )
                if group_search_resp and group_search_resp.status_code == 200:
                    group_items = group_search_resp.json().get("data", [])
                    if group_items:
                        parent_warehouse = group_items[0].get("name")

            warehouse_payload = {
                "warehouse_name": warehouse_label,
                "company": company_name,
                "is_group": 0
            }
            if parent_warehouse:
                warehouse_payload["parent_warehouse"] = parent_warehouse

            create_resp, create_err = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Warehouse",
                data={"data": warehouse_payload},
                operation_name="Create default warehouse from company address"
            )

            if create_err:
                return {
                    "success": False,
                    "message": f"No se pudo crear el almacén por defecto: {create_err.get('message', create_err)}"
                }

            if not create_resp or create_resp.status_code not in (200, 201):
                return {
                    "success": False,
                    "message": f"ERPNext no confirmó la creación del almacén: {create_resp.text if create_resp else 'sin respuesta'}"
                }

            created_warehouse_name = create_resp.json().get("data", {}).get("name") or f"{warehouse_label} - {company_abbr}"
            warehouse_created = True
            print(f"Warehouse creado: {created_warehouse_name}")

        update_resp, update_err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            data={"data": {"custom_default_warehouse": created_warehouse_name}},
            operation_name="Set company default warehouse"
        )

        if update_err:
            return {
                "success": False,
                "message": f"El almacén se creó pero no se pudo asignar a la compañía: {update_err.get('message', update_err)}",
                "created_warehouse": created_warehouse_name
            }

        deleted = []
        delete_errors = []
        for base_name in DEFAULT_WAREHOUSES_TO_REMOVE:
            target_name = f"{base_name} - {company_abbr}"
            if target_name == created_warehouse_name:
                continue

            delete_resp, delete_err = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Warehouse/{quote(target_name)}",
                operation_name=f"Delete initial warehouse '{target_name}'"
            )

            if delete_err:
                if delete_err.get("status_code") == 404:
                    continue
                delete_errors.append(f"{target_name}: {delete_err.get('message', delete_err)}")
            elif delete_resp and delete_resp.status_code in (200, 202):
                deleted.append(target_name)

        message_parts = [f"Almacén por defecto asignado: {created_warehouse_name}"]
        if warehouse_created:
            message_parts.append("creado desde dirección principal")
        if deleted:
            message_parts.append(f"almacenes iniciales eliminados: {', '.join(deleted)}")
        if delete_errors:
            message_parts.append(f"errores al eliminar: {', '.join(delete_errors)}")

        return {
            "success": True,
            "message": ". ".join(message_parts),
            "created_warehouse": created_warehouse_name,
            "deleted": deleted,
            "delete_errors": delete_errors
        }

    except Exception as e:
        print(f"Error configurando almacén por defecto: {e}")
        return {
            "success": False,
            "message": f"Error interno configurando almacén por defecto: {str(e)}"
        }


def initialize_company_setup():
    """Inicializa la configuración básica de una nueva empresa"""
    print("\n--- Inicializando configuración de empresa ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company_name = get_active_company(user_id)
    if not company_name:
        return jsonify({
            "success": False,
            "message": f"No hay compañía activa configurada para el usuario {user_id}"
        }), 400

    try:
        results = {}

        # 0. Configurar warehouse por defecto basado en la dirección de la compañía
        print("Paso 0: Configurando almacén por defecto de compañía...")
        warehouse_setup_result = configure_company_default_warehouse(session, headers, company_name)
        results['default_warehouse'] = {
            'success': warehouse_setup_result.get('success', False),
            'message': warehouse_setup_result.get('message'),
            'created': warehouse_setup_result.get('created_warehouse'),
            'deleted': warehouse_setup_result.get('deleted', [])
        }

        # 1. Crear UOM si no existe
        print("Paso 1: Verificando/Creando Unidad de Medida...")
        uom_success = ensure_uom_exists(session, headers, user_id)
        results['uom'] = {
            'success': uom_success,
            'message': 'Unidad de medida verificada/creada' if uom_success else 'Error con unidad de medida'
        }

        # 2. Configurar grupos de clientes y proveedores con abreviatura de compañía
        print("Paso 2: Configurando Grupos de Clientes y Proveedores...")
        groups_success = setup_all_groups(session, headers, company_name)
        results['customer_supplier_groups'] = {
            'success': groups_success,
            'message': 'Grupos de clientes y proveedores configurados' if groups_success else 'Error con grupos de clientes/proveedores'
        }

        # 3. Crear listas de precios
        print("Paso 3: Verificando/Creando Listas de Precios...")
        price_lists_success = ensure_price_lists_exist(session, headers, user_id)
        results['price_lists'] = {
            'success': price_lists_success,
            'message': 'Listas de precios verificadas/creadas' if price_lists_success else 'Error con listas de precios'
        }

        # 4. Crear plantillas de impuestos para facturas
        print("Paso 4: Verificando/Creando Plantillas de Impuestos...")
        tax_templates_success = ensure_tax_templates_exist(session, headers, user_id)
        results['tax_templates'] = {
            'success': tax_templates_success,
            'message': 'Plantillas de impuestos verificadas/creadas' if tax_templates_success else 'Error con plantillas de impuestos'
        }

        # 5. Crear cuentas de IVA por tasa (ANTES de crear Item Tax Templates)
        print("Paso 5: Verificando/Creando Cuentas de IVA por Tasa...")
        iva_accounts_result = ensure_iva_tax_accounts_exist(session, headers, user_id)
        results['iva_accounts'] = {
            'success': iva_accounts_result.get('success', False),
            'message': iva_accounts_result.get('message', 'Error con cuentas de IVA'),
            'created': iva_accounts_result.get('created_accounts', []),
            'updated': iva_accounts_result.get('updated_accounts', [])
        }

        # 5.5 Crear campo custom_transaction_type en Item Tax Template ANTES de crear los templates
        print("Paso 5.5: Creando campo custom para clasificar Item Tax Templates (Ventas/Compras)...")
        custom_field_result = create_item_tax_template_custom_fields()
        # Manejar Response objects de Flask
        if hasattr(custom_field_result, 'get_json'):
            custom_field_data = custom_field_result.get_json()
        else:
            custom_field_data = custom_field_result
        custom_field_success = custom_field_data.get('success', False) if isinstance(custom_field_data, dict) else False
        results['item_tax_template_custom_field'] = {
            'success': custom_field_success,
            'message': custom_field_data.get('message', 'Error creando campo custom') if isinstance(custom_field_data, dict) else 'Error creando campo custom'
        }

        # 6. Crear plantillas de impuestos para ítems (usa las cuentas creadas en paso 5)
        print("Paso 6: Verificando/Creando Plantillas de Impuestos para Ítems...")
        item_tax_templates_result = ensure_item_tax_templates_exist_v2(session, headers, user_id)
        # ensure_item_tax_templates_exist_v2 retorna un dict con 'success'
        item_tax_templates_success = item_tax_templates_result.get('success', False) if isinstance(item_tax_templates_result, dict) else item_tax_templates_result
        results['item_tax_templates'] = {
            'success': item_tax_templates_success,
            'message': item_tax_templates_result.get('message', 'Plantillas de impuestos para ítems procesadas') if isinstance(item_tax_templates_result, dict) else ('Plantillas de impuestos para ítems verificadas/creadas' if item_tax_templates_success else 'Error con plantillas de impuestos para ítems')
        }

        # 7. Crear letter head por defecto
        print("Paso 7: Configurando membrete (Letter Head) por defecto...")
        letterhead_doc, letterhead_error = ensure_default_letterhead(session, headers, company_name)
        results['letterhead'] = {
            'success': letterhead_error is None,
            'message': 'Letter head verificado/creado' if letterhead_error is None else letterhead_error.get('message', 'Error configurando el letter head')
        }

        # 8. Aplicar configuracion base de System Settings y Global Defaults
        print("Paso 8: Aplicando configuracion base de System Settings y Global Defaults...")
        system_defaults_result = apply_initial_system_settings(session, headers, company_name)
        results['system_settings'] = {
            'success': system_defaults_result.get('success', False),
            'message': system_defaults_result.get('message'),
            'applied': system_defaults_result.get('applied')
        }

        # 9. Crear DocType de indices de inflacion (IPC Argentina)
        print("Paso 9: Configurando DocType de indices de inflacion (IPC Argentina)...")
        inflacion_success = ensure_inflacion_doctype(session, headers, ERPNEXT_URL)
        results['inflacion_indices'] = {
            'success': inflacion_success,
            'message': 'DocType de indices de inflacion verificado' if inflacion_success else 'Error configurando DocType de indices'
        }

        # 10. Configurar Stock Settings (reservas de inventario)
        print("Paso 10: Configurando Stock Settings (reservas de inventario)...")
        stock_settings_success, stock_settings_message = apply_initial_stock_settings(session, headers)
        results['stock_settings'] = {
            'success': stock_settings_success,
            'message': stock_settings_message
        }

        # 11. Configurar cuenta de diferencias de cambio
        print("Paso 11: Configurando cuenta de diferencia de cambio...")
        exchange_account_result = assign_exchange_gain_loss_account(session, headers, company_name)
        results['exchange_gain_loss_account'] = exchange_account_result

        # Verificar resultados
        all_success = all(result['success'] for result in results.values())

        if all_success:
            return jsonify({
                "success": True,
                "message": "Configuración inicial de empresa completada exitosamente",
                "results": results
            })
        else:
            failed_items = [key for key, result in results.items() if not result['success']]
            return jsonify({
                "success": False,
                "message": f"Errores en la configuración inicial: {', '.join(failed_items)}",
                "results": results
            }), 500

    except Exception as e:
        print(f"ERROR GENERAL en initialize_company_setup: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
