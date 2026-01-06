"""
ERPNext Setup Configuration Module

This module provides Flask routes for ERPNext initial setup and configuration.
It orchestrates the setup process by calling functions from specialized modules.

Modules:
- setup_uom.py: Unit of Measure management
- setup_suppliers.py: Supplier groups management
- setup_price_lists.py: Price lists management
- setup_tax_templates.py: Sales tax templates
- setup_item_tax_templates.py: Item tax templates
- setup_company.py: Company initialization
- setup_items.py: Item account assignments
"""

from flask import Blueprint, request, jsonify
import os
import requests
import json
import unicodedata
import traceback
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función centralizada para obtener abreviatura de compañía
from routes.general import get_company_abbr, get_active_company
# Importar función de items.py para grupos de ítems
from routes.items import ensure_item_groups_exist

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar funciones desde los módulos refactorizados
from .setup_uom import ensure_uom_exists
from .setup_price_lists import ensure_price_lists_exist
from .setup_tax_templates import ensure_tax_templates_exist
from .setup_item_tax_templates import check_item_tax_templates, ensure_item_tax_templates_exist_v2
from .setup_iva_accounts import ensure_iva_tax_accounts_exist, get_iva_accounts_map, IVA_RATES
from .setup_company import initialize_company_setup
from .setup_items import get_items, assign_tax_account, remove_tax_account, assign_purchase_account, assign_sales_account, create_tax_template, assign_template_to_item, get_sales_tax_templates, get_item_tax_templates, get_tax_accounts_list
from .setup_custom_fields import create_all_custom_fields, create_account_lock_custom_fields
from .setup_server_scripts import create_account_lock_scripts, list_account_lock_scripts, delete_account_lock_scripts

# Crear el blueprint para las rutas de configuración inicial
setup_bp = Blueprint('setup', __name__)

def ensure_uom_exists(session, headers, user_id):
    """Asegura que exista la unidad de medida básica 'Unit'"""
    print("\n--- Verificando Unidad de Medida 'Unit' ---")

    try:
        # Verificar si existe "Unit" usando make_erpnext_request
        print("Verificando si existe 'Unit'...")
        # Query using JSON-encoded filters (ERPNext expects a list-of-lists)
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/UOM",
            params={
                "filters": json.dumps([["uom_name", "=", "Unit"]]),
                "limit_page_length": 1
            },
            operation_name="Check UOM Unit"
        )

        if err:
            print(f"Error verificando 'Unit': {err}")
            return False

        if resp.status_code == 200:
            data = resp.json()
            if data.get("data"):
                print("'Unit' ya existe")
                return True

        # Crear "Unit"
        print("Creando 'Unit'...")
        uom_data = {
            "uom_name": "Unit",
            "must_be_whole_number": 1
        }
        create_resp, create_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/UOM",
            data={"data": uom_data},
            operation_name="Create UOM Unit"
        )

        if create_err:
            print(f"Error creando 'Unit': {create_err}")
            return False

        if create_resp.status_code == 200:
            print("'Unit' creada exitosamente")
            return True
        else:
            print(f"Error creando 'Unit': {create_resp.status_code} - {create_resp.text}")
            return False

    except Exception as e:
        print(f"Error en ensure_uom_exists: {e}")
        return False

def ensure_price_lists_exist(session, headers, user_id):
    """Asegura que existan las listas de precios necesarias"""
    print("\n--- Verificando Listas de Precios ---")

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa para el usuario {user_id}")
            return False

        print(f"Compañía activa: {company_name}")

        # Listas de precios a crear
        price_lists = [
            {
                "price_list_name": "Venta Estándar ARS",
                "currency": "ARS",
                "selling": 1,
                "buying": 0
            },
            {
                "price_list_name": "Compra Estándar ARS",
                "currency": "ARS",
                "selling": 0,
                "buying": 1
            }
        ]

        created_lists = []
        errors = []

        for price_list in price_lists:
            try:
                # Verificar si la lista de precios ya existe (filtros JSON)
                resp, err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Price List",
                    params={
                        "filters": json.dumps([["price_list_name", "=", price_list["price_list_name"]]]),
                        "limit_page_length": 1
                    },
                    operation_name=f"Check Price List '{price_list['price_list_name']}'"
                )

                if err:
                    error_msg = f"Error verificando lista '{price_list['price_list_name']}': {err}"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                if resp.status_code == 200:
                    check_data = resp.json()
                    if check_data.get("data"):
                        print(f"Lista de precios '{price_list['price_list_name']}' ya existe")
                        created_lists.append({
                            "name": price_list['price_list_name'],
                            "status": "already_exists"
                        })
                        continue

                # Según la configuración actual no queremos crear listas de precios
                # automáticamente durante el setup inicial (se esperan ya creadas).
                # Solo verificamos existencia y en caso de ausencia lo registramos
                # pero no intentamos crear para evitar entradas duplicadas o conflictos.
                print(f"Lista de precios '{price_list['price_list_name']}' no encontrada: saltando creación automática (esperado si ya existe)")
                created_lists.append({
                    "name": price_list['price_list_name'],
                    "status": "missing_skipped"
                })

            except Exception as e:
                error_msg = f"Error procesando lista de precios '{price_list['price_list_name']}': {e}"
                print(error_msg)
                errors.append(error_msg)

        if errors:
            print(f"Se encontraron {len(errors)} errores al crear listas de precios")
            return False

        print(f"Listas de precios procesadas: {len(created_lists)}")
        return True

    except Exception as e:
        print(f"Error en ensure_price_lists_exist: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return False

def ensure_tax_templates_exist(session, headers, user_id):
    """Asegura que existan las plantillas de impuestos necesarias"""
    print("\n--- Verificando Plantillas de Impuestos ---")

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa para el usuario {user_id}")
            return False

        print(f"Compañía activa: {company_name}")

        # Obtener abreviatura de la compañía usando función centralizada
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return False

        # Plantillas de impuestos a crear
        tax_templates = [
            {
                "title": "IVA 21% (Ventas)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                        "rate": 21,
                        "description": "IVA 21%"
                    }
                ]
            },
            {
                "title": "IVA 21% (Compras)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"1.1.4.01.05 - IVA Crédito Fiscal - {company_abbr}",
                        "rate": 21,
                        "description": "IVA 21%"
                    }
                ]
            },
            {
                "title": "IVA 10.5% (Ventas)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                        "rate": 10.5,
                        "description": "IVA 10.5%"
                    }
                ]
            },
            {
                "title": "IVA 10.5% (Compras)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"1.1.4.01.05 - IVA Crédito Fiscal - {company_abbr}",
                        "rate": 10.5,
                        "description": "IVA 10.5%"
                    }
                ]
            },
            {
                "title": "IVA 27% (Ventas)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                        "rate": 27,
                        "description": "IVA 27%"
                    }
                ]
            },
            {
                "title": "IVA 27% (Compras)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"1.1.4.01.05 - IVA Crédito Fiscal - {company_abbr}",
                        "rate": 27,
                        "description": "IVA 27%"
                    }
                ]
            },
            {
                "title": "IVA 0% (Exento)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                        "rate": 0,
                        "description": "IVA Exento"
                    }
                ]
            }
        ]

        created_templates = []
        errors = []

        for template in tax_templates:
            try:
                # Verificar si la plantilla ya existe
                # Verificar si la plantilla ya existe (usar filtros JSON) and use unencoded endpoint
                # Buscar la plantilla por título Y compañía para evitar detectar plantillas de otras compañías
                filters = [["title", "=", template["title"]], ["company", "=", company_name]]
                check_response, check_err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint="/api/resource/Sales Taxes and Charges Template",
                    params={
                        'filters': json.dumps(filters),
                        'limit_page_length': 1
                    },
                    operation_name=f"Check Sales Taxes Template {template['title']} for {company_name}"
                )

                if check_err:
                    error_msg = f"Error verificando plantilla '{template['title']}': {check_err.get('message')}"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                if check_response.status_code == 200:
                    check_data = check_response.json()
                    if check_data.get("data"):
                        print(f"Plantilla '{template['title']}' ya existe")
                        created_templates.append({
                            "title": template['title'],
                            "status": "already_exists"
                        })
                        continue

                # Crear la plantilla
                template_data = {
                    "title": template['title'],
                    "company": company_name,
                    "taxes": template['taxes']
                }

                endpoint = "/api/resource/Sales Taxes and Charges Template"
                create_response, create_err = make_erpnext_request(
                    session=session,
                    method='POST',
                    endpoint=endpoint,
                    data={"data": template_data},
                    operation_name=f"Create Sales Taxes Template {template['title']}"
                )

                if create_err:
                    error_msg = f"Error creando plantilla '{template['title']}': {create_err.get('message')}"
                    print(error_msg)
                    errors.append(error_msg)
                else:
                    if create_response.status_code == 200:
                        print(f"Plantilla '{template['title']}' creada exitosamente")
                        created_templates.append({
                            "title": template['title'],
                            "status": "created"
                        })
                    else:
                        error_msg = f"Error creando plantilla '{template['title']}': {create_response.status_code} - {create_response.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as e:
                error_msg = f"Error procesando plantilla '{template['title']}': {e}"
                print(error_msg)
                errors.append(error_msg)

        if errors:
            print(f"Se encontraron {len(errors)} errores al crear plantillas de impuestos")
            return False

        print(f"Plantillas de impuestos procesadas: {len(created_templates)}")
        return True

    except Exception as e:
        print(f"Error en ensure_tax_templates_exist: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return False

def ensure_item_tax_templates_exist(session, headers, user_id):
    """
    Asegura que existan las plantillas de Item Tax Template necesarias para la compañía.
    
    IMPORTANTE: Requiere que ensure_iva_tax_accounts_exist() se haya ejecutado ANTES
    para tener las cuentas de IVA por tasa creadas.
    
    Crea SOLO 2 plantillas:
    - IVA - {abbr} (Ventas): con child rows para cada tasa, cada una apuntando a su cuenta de Débito Fiscal
    - IVA - {abbr} (Compras): con child rows para cada tasa, cada una apuntando a su cuenta de Crédito Fiscal
    """
    print("\n--- Verificando/Creando Plantillas de Item Tax Template ---")

    # Importar helper para obtener mapa de cuentas IVA
    from .setup_iva_accounts import get_iva_accounts_map, IVA_RATES

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa configurada para el usuario {user_id}")
            return {"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}

        print(f"Compañía activa: {company_name}")

        # Obtener abreviatura de la compañía usando función centralizada
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return {"success": False, "message": "Error obteniendo información de la compañía"}

        # Obtener mapa de cuentas de IVA existentes
        iva_accounts = get_iva_accounts_map(session, headers, company_name, company_abbr)
        
        print(f"Cuentas IVA Débito encontradas: {len(iva_accounts['debito'])}")
        print(f"Cuentas IVA Crédito encontradas: {len(iva_accounts['credito'])}")

        # Verificar que existan las cuentas necesarias
        if not iva_accounts["debito"] or not iva_accounts["credito"]:
            return {
                "success": False, 
                "message": "Faltan cuentas de IVA. Ejecute primero ensure_iva_tax_accounts_exist()"
            }

        # Construir las 2 plantillas de Item Tax Template:
        # 1. Ventas: todas las tasas con sus cuentas de Débito Fiscal
        # 2. Compras: todas las tasas con sus cuentas de Crédito Fiscal
        
        # Child rows para plantilla de VENTAS (usa cuentas de Débito Fiscal)
        ventas_taxes = []
        for rate in IVA_RATES:
            debito_account = iva_accounts["debito"].get(rate)
            if debito_account:
                ventas_taxes.append({
                    "tax_type": debito_account,  # Link a la cuenta de IVA Débito para esta tasa
                    "tax_rate": rate
                })
        
        # Child rows para plantilla de COMPRAS (usa cuentas de Crédito Fiscal)
        compras_taxes = []
        for rate in IVA_RATES:
            credito_account = iva_accounts["credito"].get(rate)
            if credito_account:
                compras_taxes.append({
                    "tax_type": credito_account,  # Link a la cuenta de IVA Crédito para esta tasa
                    "tax_rate": rate
                })

        # Las 2 plantillas a crear
        tax_templates = [
            {
                "name": f"IVA - {company_abbr} (Ventas)",
                "title": "IVA",
                "taxes": ventas_taxes
            },
            {
                "name": f"IVA - {company_abbr} (Compras)",
                "title": "IVA",
                "taxes": compras_taxes
            }
        ]

        created_templates = []
        errors = []

        for template in tax_templates:
            try:
                template_name = template["name"]

                # Verificar si la plantilla ya existe por nombre
                check_response, check_err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint="/api/resource/Item Tax Template",
                    params={
                        'filters': json.dumps([["name", "=", template_name]]),
                        'limit_page_length': 1
                    },
                    operation_name=f"Check Item Tax Template {template_name}"
                )

                if check_err:
                    err = f"Error verificando plantilla '{template_name}': {check_err.get('message')}"
                    print(err)
                    errors.append(err)
                    continue

                if check_response.status_code == 200:
                    check_data = check_response.json()
                    if check_data.get("data"):
                        print(f"Plantilla '{template_name}' ya existe")
                        created_templates.append({
                            "name": template_name,
                            "status": "already_exists"
                        })
                        continue

                # Verificar que las cuentas de impuestos estén asignadas
                valid_taxes = []
                for tax in template["taxes"]:
                    if tax.get("tax_type"):
                        valid_taxes.append(tax)
                    else:
                        print(f"ADVERTENCIA: Cuenta de impuestos no encontrada para una tasa en '{template_name}'")

                if not valid_taxes:
                    error_msg = f"No se pueden crear impuestos válidos para plantilla '{template_name}' - faltan cuentas"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                # Preparar datos de la plantilla
                template_data = {
                    "name": template_name,
                    "title": template["title"],
                    "company": company_name,
                    "taxes": valid_taxes
                }

                # Crear la plantilla
                endpoint = "/api/resource/Item Tax Template"
                create_response, create_err = make_erpnext_request(
                    session=session,
                    method='POST',
                    endpoint=endpoint,
                    data={"data": template_data},
                    operation_name=f"Create Item Tax Template {template_name}"
                )

                if create_err:
                    error_msg = f"Error creando plantilla '{template_name}': {create_err.get('message')}"
                    print(error_msg)
                    errors.append(error_msg)
                else:
                    if create_response.status_code == 200:
                        created_data = create_response.json()
                        print(f"Plantilla '{template_name}' creada exitosamente con {len(valid_taxes)} tasas")
                        created_templates.append({
                            "name": template_name,
                            "status": "created",
                            "taxes_count": len(valid_taxes),
                            "data": created_data.get("data", {})
                        })
                    else:
                        error_msg = f"Error creando plantilla '{template_name}': {create_response.status_code} - {create_response.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as e:
                error_msg = f"Error procesando plantilla '{template_name}': {e}"
                print(error_msg)
                errors.append(error_msg)

        # Respuesta final
        if errors:
            return {
                "success": False,
                "message": f"Se encontraron errores al crear plantillas: {'; '.join(errors)}",
                "templates": created_templates,
                "errors": errors
            }
        else:
            return {
                "success": True,
                "message": f"Plantillas de Item Tax Template procesadas correctamente ({len(created_templates)} plantillas)",
                "templates": created_templates
            }

    except Exception as e:
        print(f"ERROR GENERAL en ensure_item_tax_templates_exist: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return {"success": False, "message": f"Error interno del servidor: {str(e)}"}

@setup_bp.route('/api/setup/check-item-tax-templates', methods=['GET'])
def check_item_tax_templates():
    """Verificar la configuración actual de las plantillas de impuestos para ítems"""
    return check_item_tax_templates()


@setup_bp.route('/api/setup/company-initialization', methods=['POST'])
def initialize_company_setup_route():
    """Inicializa la configuración básica de una nueva empresa"""
    return initialize_company_setup()

@setup_bp.route('/api/setup/status', methods=['GET'])
def get_setup_status():
    """Obtiene el estado de la configuración inicial de la empresa"""
    print("\n--- Verificando estado de configuración ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            return jsonify({"success": False, "message": f"No hay compañía activa para el usuario {user_id}"}), 400

        status = {}

        # Verificar UOM
        try:
            uom_resp, uom_err = make_erpnext_request(
                session=session,
                method='GET',
                endpoint='/api/resource/UOM',
                params={'filters': json.dumps([["uom_name", "=", "Unit"]]), 'limit_page_length': 1},
                operation_name='Status Check UOM'
            )
            if uom_err or not uom_resp:
                status['uom'] = {'exists': False, 'checked': False}
            else:
                status['uom'] = {
                    'exists': uom_resp.status_code == 200 and bool(uom_resp.json().get("data")),
                    'checked': True
                }
        except:
            status['uom'] = {'exists': False, 'checked': False}

        # Verificar plantillas de impuestos
        tax_templates = [
            "IVA 21% (Ventas)",
            "IVA 21% (Compras)",
            "IVA 10.5% (Ventas)",
            "IVA 10.5% (Compras)",
            "IVA 27% (Ventas)",
            "IVA 27% (Compras)",
            "IVA 0% (Exento)"
        ]

        status['tax_templates'] = {}
        for template_name in tax_templates:
            try:
                template_resp, template_err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint='/api/resource/Sales Taxes and Charges Template',
                    params={'filters': json.dumps([["title", "=", template_name]]), 'limit_page_length': 1},
                    operation_name=f'Status Check Tax Template {template_name}'
                )
                if template_err or not template_resp:
                    status['tax_templates'][template_name] = {'exists': False, 'checked': False}
                else:
                    status['tax_templates'][template_name] = {
                        'exists': template_resp.status_code == 200 and bool(template_resp.json().get("data")),
                        'checked': True
                    }
            except:
                status['tax_templates'][template_name] = {'exists': False, 'checked': False}

        # Verificar grupos de ítems
        item_groups = [
            "All Item Groups",
            "Services"
        ]

        status['item_groups'] = {}
        for group_name in item_groups:
            try:
                group_resp, group_err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint='/api/resource/Item Group',
                    params={'filters': json.dumps([["item_group_name", "=", group_name]]), 'limit_page_length': 1},
                    operation_name=f'Status Check Item Group {group_name}'
                )
                if group_err or not group_resp:
                    status['item_groups'][group_name] = {'exists': False, 'checked': False}
                else:
                    status['item_groups'][group_name] = {
                        'exists': group_resp.status_code == 200 and bool(group_resp.json().get("data")),
                        'checked': True
                    }
            except:
                status['item_groups'][group_name] = {'exists': False, 'checked': False}

        # Verificar listas de precios
        price_lists = [
            "Venta Estándar ARS",
            "Compra Estándar ARS"
        ]

        status['price_lists'] = {}
        for list_name in price_lists:
            try:
                list_resp, list_err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint='/api/resource/Price List',
                    params={'filters': json.dumps([["price_list_name", "=", list_name]]), 'limit_page_length': 1},
                    operation_name=f'Status Check Price List {list_name}'
                )
                if list_err or not list_resp:
                    status['price_lists'][list_name] = {'exists': False, 'checked': False}
                else:
                    status['price_lists'][list_name] = {
                        'exists': list_resp.status_code == 200 and bool(list_resp.json().get("data")),
                        'checked': True
                    }
            except:
                status['price_lists'][list_name] = {'exists': False, 'checked': False}

        return jsonify({
            "success": True,
            "data": status,
            "message": "Estado de configuración obtenido correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en get_setup_status: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@setup_bp.route('/api/setup/tax-templates', methods=['GET'])
def get_tax_templates():
    """Obtener plantillas de impuestos"""
    # Delegate to the canonical tax template handler in routes.taxes
    from routes.taxes import get_tax_templates as taxes_get
    return taxes_get()


@setup_bp.route('/api/setup/create-iva-custom-fields', methods=['POST'])
def create_iva_custom_fields_route():
    """Crear los campos custom para IVA por defecto en ventas y compras"""
    return jsonify({"success": False, "message": "Creación de campos custom deshabilitada"}), 501


@setup_bp.route('/api/setup/items', methods=['GET'])
def get_items_route():
    """Obtener ítems para asignar plantillas de impuestos"""
    return get_items()


@setup_bp.route('/api/setup/assign-tax-account', methods=['POST'])
def assign_tax_account_route():
    """Asignar una cuenta como cuenta de impuestos"""
    return assign_tax_account()


@setup_bp.route('/api/setup/remove-tax-account', methods=['POST'])
def remove_tax_account_route():
    """Remover una cuenta de la lista de cuentas de impuestos"""
    return remove_tax_account()


@setup_bp.route('/api/setup/assign-purchase-account', methods=['POST'])
def assign_purchase_account_route():
    """Asignar una cuenta como cuenta de compras"""
    return assign_purchase_account()


@setup_bp.route('/api/setup/assign-sales-account', methods=['POST'])
def assign_sales_account_route():
    """Asignar una cuenta como cuenta de ventas"""
    return assign_sales_account()


@setup_bp.route('/api/setup/create-tax-template', methods=['POST'])
def create_tax_template_route():
    """Crear una plantilla de impuestos para ítems"""
    return create_tax_template()


@setup_bp.route('/api/setup/assign-template-to-item', methods=['POST'])
def assign_template_to_item_route():
    """Asignar una plantilla de impuestos a un ítem"""
    return assign_template_to_item()


@setup_bp.route('/api/setup/sales-tax-templates', methods=['GET'])
def get_sales_tax_templates_route():
    """Obtener plantillas de impuestos de ventas (Sales Taxes and Charges Template) filtradas por compañía"""
    return get_sales_tax_templates()


@setup_bp.route('/api/tax-templates', methods=['GET'])
def get_item_tax_templates_route():
    """Obtener plantillas de impuestos para ítems (Item Tax Template) filtradas por compañía"""
    return get_item_tax_templates()


@setup_bp.route('/api/setup/tax-accounts', methods=['GET'])
def get_tax_accounts_list_route():
    """Obtener todas las cuentas de tipo Tax asignadas a la compañía activa"""
    return get_tax_accounts_list()


@setup_bp.route('/api/setup/create-tax-account', methods=['POST'])
def create_tax_account_route():
    """Crear una cuenta de impuestos en ERPNext"""
    return create_tax_account()


@setup_bp.route('/api/setup/create-reconciliation-custom-fields', methods=['POST'])
def create_reconciliation_custom_fields_route():
    """Crear los campos custom necesarios para la funcionalidad de conciliación"""
    return jsonify({"success": False, "message": "Creación de campos custom deshabilitada"}), 501


@setup_bp.route('/api/setup/create-item-custom-fields', methods=['POST'])
def create_item_custom_fields_route():
    """Crear los campos custom necesarios para Item (tipo de descripción y enlaces)"""
    return jsonify({"success": False, "message": "Creación de campos custom deshabilitada"}), 501


@setup_bp.route('/api/setup/create-company-filter-fields', methods=['POST'])
def create_company_filter_fields_route():
    """Crear los campos custom para filtrar por compañía en doctypes principales"""
    return jsonify({"success": False, "message": "Creación de campos custom deshabilitada"}), 501


@setup_bp.route('/api/setup/create-price-list-custom-fields', methods=['POST'])
def create_price_list_custom_fields_route():
    """Crear los campos custom necesarios para Price List (exchange rate)"""
    return jsonify({"success": False, "message": "Creación de campos custom deshabilitada"}), 501


@setup_bp.route('/api/tax-templates/<path:template_name>', methods=['GET'])
def get_tax_template_detail_route(template_name):
    """Obtener detalle completo de una plantilla de impuesto específica"""
    # Use taxes implementation to keep behavior consistent
    from routes.taxes import get_tax_template_details
    return get_tax_template_details(template_name)


@setup_bp.route('/api/tax-templates/<path:template_name>', methods=['PUT'])
def update_tax_template_route(template_name):
    """Actualizar la cuenta de una plantilla de impuesto específica"""
    from routes.taxes import update_tax_template
    return update_tax_template(template_name)


def create_tax_account():
    """Crear una cuenta de impuestos en ERPNext"""
    # TODO: Implementar la creación de cuentas de impuestos
    return jsonify({"success": False, "message": "Función no implementada aún"}), 501


@setup_bp.route('/api/setup/create-all-custom-fields', methods=['POST'])
def create_all_custom_fields_route():
    """Crear TODOS los campos custom necesarios para el sistema ERP"""
    return create_all_custom_fields()


@setup_bp.route('/api/setup/create-account-lock-fields', methods=['POST'])
def create_account_lock_fields_route():
    """Crear campos custom para bloqueo de períodos en Account"""
    return create_account_lock_custom_fields()


@setup_bp.route('/api/setup/create-account-lock-scripts', methods=['POST'])
def create_account_lock_scripts_route():
    """Crear Server Scripts para bloqueo de cuentas por período"""
    return create_account_lock_scripts()


@setup_bp.route('/api/setup/list-account-lock-scripts', methods=['GET'])
def list_account_lock_scripts_route():
    """Listar todos los Server Scripts de bloqueo de cuentas"""
    return list_account_lock_scripts()


@setup_bp.route('/api/setup/delete-account-lock-scripts', methods=['DELETE'])
def delete_account_lock_scripts_route():
    """Eliminar todos los Server Scripts de bloqueo de cuentas"""
    return delete_account_lock_scripts()
