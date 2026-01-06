from flask import Blueprint, request, jsonify
import os
import requests
import json
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar funciones de companies.py para evitar duplicación
from routes.companies import load_active_companies

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar función para obtener compañía activa
from routes.general import get_active_company

# Importar función para obtener abreviación de compañía
from routes.general import get_company_abbr, remove_company_abbr, add_company_abbr, resolve_customer_name
from routes.customer_utils import fetch_customer

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para las rutas de ítems
items_bp = Blueprint('items', __name__)

# Cache global para mapas de impuestos por compañía
tax_template_cache = {}

def ensure_item_groups_exist(session, headers, user_id):
    """Asegura que existan los grupos de ítems necesarios para una nueva compañía"""
    print("--- Verificar grupos items: procesando")

    try:
        # Verificar si existe "All Item Groups"
        # Extract filters to avoid nested quotes in f-string
        # Consultar Item Group usando params JSON para 'filters'
        root_response, root_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Group",
            params={
                "filters": json.dumps([["item_group_name", "=", "All Item Groups"]]),
                "limit_page_length": 1
            },
            operation_name="Check All Item Groups existence"
        )
        if root_error:
            return False

        if root_response.status_code == 200:
            root_data = root_response.json()
            if root_data.get("data"):
                print("--- Verificar grupos items: All Item Groups existe")
                root_group_name = root_data["data"][0]["name"]
            else:
                # Crear "All Item Groups"
                root_group_data = {
                    "item_group_name": "All Item Groups",
                    "is_group": 1
                }
                create_root_url = "/api/resource/Item Group"
                create_root_response, create_root_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint=create_root_url,
                    data=root_group_data,
                    operation_name="Create All Item Groups"
                )

                if create_root_error:
                    return False

                created_root = create_root_response.json()
                root_group_name = created_root["data"]["name"]
                print("--- All Item Groups: created")
        else:
            print("--- All Item Groups: error")
            return False

        # Verificar si existe "Services"
        print("--- Services: checking")
        # Extract filters to avoid nested quotes in f-string
        services_response, services_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Group",
            params={
                "filters": json.dumps([["item_group_name", "=", "Services"]]),
                "limit_page_length": 1
            },
            operation_name="Check Services existence"
        )

        if services_error:
            return False

        if services_response.status_code == 200:
            services_data = services_response.json()
            if services_data.get("data"):
                print("--- Services: exists")
            else:
                # Crear "Services"
                print("--- Services: creating")
                services_group_data = {
                    "item_group_name": "Services",
                    "parent_item_group": "All Item Groups",
                    "is_group": 0
                }
                create_services_url = "/api/resource/Item Group"
                create_services_response, create_services_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint=create_services_url,
                    data=services_group_data,
                    operation_name="Create Services group"
                )

                if create_services_error:
                    return False

                created_services = create_services_response.json()
                print("--- Services: created")
        else:
            print("--- Services: error")
            return False

        print("--- Item groups: verified/created")
        return True

    except Exception as e:
        print("--- Item groups: error")
        return False

@items_bp.route('/api/item-groups/ensure', methods=['POST'])
def ensure_item_groups():
    """Endpoint para asegurar que existan los grupos de ítems necesarios"""
    print("--- Ensure item groups: started")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        success = ensure_item_groups_exist(session, headers, user_id)
        if success:
            return jsonify({"success": True, "message": "Grupos de ítems verificados/creados exitosamente"})
        else:
            return jsonify({"success": False, "message": "Error al verificar/crear grupos de ítems"}), 500

    except Exception as e:
        print("--- Item groups: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def _ensure_company_item_code(item_code, item, session, headers, company, company_abbr=None):
    """Ensure the item_code carries the company suffix and exists in ERPNext."""
    if not item_code or not company:
        return item_code

    try:
        if not company_abbr:
            company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return item_code
        suffix = f" - {company_abbr}"
        if item_code.endswith(suffix):
            return item_code
        normalized_code = add_company_abbr(item_code, company_abbr)
        ensure_item_exists(normalized_code, item, session, headers, company)
        return normalized_code
    except Exception as exc:
        print(f"--- Failed to ensure company item code for {item_code}: {exc}")
        return item_code


def process_invoice_item(item, session, headers, company, tax_map=None, customer=None, transaction_type='sales'):
    """
    Procesa un ítem de la factura, busca o crea items según la descripción y tasa de IVA.
    CORREGIDO: Ahora busca items existentes por nombre y tasa de IVA antes de crear nuevos.
    
    Args:
        item: Diccionario con datos del ítem
        session: Sesión HTTP
        headers: Headers de autenticación
        company: Nombre de la compañía
        tax_map: Mapa de templates de impuestos (opcional)
        customer: Cliente para determinar cuenta de ingresos (opcional)
        transaction_type: 'sales' para ventas, 'purchase' para compras
    """
    try:
        print("--- Processing item")
        if not isinstance(item, dict):
            print("--- Item processing: error - invalid format")
            return None
        
        # Obtener la abbreviatura de la compañía para usarla en warehouse y otros campos
        company_abbr = get_company_abbr(session, headers, company) if company else None
            
        processed_item = {
            "qty": item.get('qty', 1),
            "rate": item.get('rate', 0)
        }

        # Si no hay item_code pero hay descripción, buscar item existente por nombre y tasa IVA
        if not item.get('item_code') and item.get('description'):
            print("--- Finding/creating item by description")
            item_code = find_or_create_item_by_description(item, session, headers, company, tax_map, transaction_type=transaction_type)
            if not item_code:
                print("--- Item creation: error")
                return None
            processed_item["item_code"] = item_code
            print("--- Item: created/found")
        # Si no hay item_code ni descripción, es un item libre que debemos crear
        elif not item.get('item_code'):
            print("--- Creating free item")
            item_code = create_free_item(item, session, headers, company)
            if not item_code:
                print("--- Free item creation: error")
                return None
            processed_item["item_code"] = item_code
            print("--- Free item: created")
        else:
            ensured_code = ensure_item_exists(item['item_code'], item, session, headers, company)
            processed_item["item_code"] = ensured_code or item['item_code']
            if ensured_code:
                print(f"--- Using existing item: {processed_item['item_code']}")
            else:
                print("--- Using provided item code without validation")

        # Asignar plantilla de impuestos basada en el IVA que viene del frontend
        if 'iva_percent' in item:
            # CORRECCIÓN CLAVE: Normalizamos el número a un string con formato float ("21" -> "21.0")
            search_key = str(float(item['iva_percent']))
            
            print(f"--- Tax template lookup: iva_percent={item['iva_percent']}, search_key={search_key}")
            
            # Si no se proporcionó tax_map, obtenerlo dinámicamente
            if tax_map is None:
                print(f"--- Tax map is None, fetching for transaction_type={transaction_type}")
                tax_map = get_tax_template_map(session, headers, company, transaction_type=transaction_type)
            
            print(f"--- Tax map available keys: {list(tax_map.keys()) if tax_map else 'None'}")
            
            if search_key in tax_map:
                template_name = tax_map[search_key]
                processed_item["item_tax_template"] = template_name
                print(f"--- Tax template: assigned ({template_name})")
                
                # También asignar la plantilla al ítem en ERPNext
                assign_tax_template_by_rate(processed_item['item_code'], item['iva_percent'], session, headers, company, tax_map, transaction_type=transaction_type)
            else:
                print(f"--- Tax template: not found for rate {search_key} in keys {list(tax_map.keys()) if tax_map else 'None'}")
        elif item.get('item_tax_template'):
            # Si no hay iva_percent pero sí hay item_tax_template, mantener el existente
            processed_item["item_tax_template"] = item['item_tax_template']
            print("--- Tax template: maintained")

        # Determinar cuenta de ingresos
        income_account = determine_income_account({**item, 'customer': customer}, session, headers, company)
        if income_account:
            processed_item["income_account"] = income_account
            print("--- Income account: assigned")
        else:
            print("--- Income account: not determined")

        # Asegurar sufijo de compañía en ítems de compra para ERPNext
        if transaction_type == 'purchase':
            processed_item["item_code"] = _ensure_company_item_code(
                processed_item.get("item_code"),
                item,
                session,
                headers,
                company,
                company_abbr=company_abbr
            )

        # Pasar warehouse si viene en el item original (agregar abbr de compañía si no la tiene)
        if item.get('warehouse'):
            warehouse = item['warehouse']
            # Agregar abbreviatura si no la tiene ya
            if company_abbr and not warehouse.endswith(f" - {company_abbr}"):
                warehouse = add_company_abbr(warehouse, company_abbr)
            processed_item['warehouse'] = warehouse

        # Campos de vinculación con Delivery Note
        if item.get('delivery_note'):
            processed_item['delivery_note'] = item['delivery_note']
        if item.get('dn_detail'):
            processed_item['dn_detail'] = item['dn_detail']

        # Campos de vinculación con Sales Order
        if item.get('sales_order'):
            processed_item['sales_order'] = item['sales_order']
        if item.get('so_detail'):
            processed_item['so_detail'] = item['so_detail']
        # También verificar campos alternativos que pueden venir del frontend
        if item.get('sales_order_item') and not processed_item.get('so_detail'):
            processed_item['so_detail'] = item['sales_order_item']
        if item.get('__source_sales_order') and not processed_item.get('sales_order'):
            processed_item['sales_order'] = item['__source_sales_order']
        if item.get('__source_so_detail') and not processed_item.get('so_detail'):
            processed_item['so_detail'] = item['__source_so_detail']

        print("--- Item processing: completed")
        return processed_item

    except Exception as e:
        print("--- Item processing: error")
        return None
            


def find_or_create_item_by_description(item, session, headers, company, tax_map=None, transaction_type='sales'):
    """
    Busca un item existente por nombre y tasa de IVA, o crea uno nuevo si no existe.
    """
    try:
        description = item.get('description', '').strip()
        iva_percent = item.get('iva_percent', '21')  # Por defecto 21%
        
        if not description:
            print("--- Creating generic item")
            return create_free_item(item, session, headers)
        
        print("--- Searching item by description and IVA")
        
        # Paso 1: Buscar items existentes con el mismo nombre
        # Extract filters to avoid nested quotes in f-string
        filters = [["item_name", "=", description]]
        fields = ["name", "item_name"]
        search_response, search_error = query_items(
            session=session,
            headers=headers,
            filters=filters,
            fields=fields,
            limit_page_length=10,
            operation_name="Search existing items by description"
        )

        if search_error:
            return create_free_item(item, session, headers)
        
        existing_items = search_response.json().get("data", [])
        print(f"--- Items found: {len(existing_items)}")
        
        # Paso 2: Para cada item encontrado, verificar si tiene la misma tasa de IVA
        for existing_item in existing_items:
            item_name = existing_item.get('name')
            print("--- Item found: using existing")
            return item_name
        
        # Paso 3: Si no se encontró ninguno que coincida, crear uno nuevo
        print("--- Creating new item")
        return create_item_with_description(item, session, headers, company, tax_map, transaction_type=transaction_type)
        
    except Exception as e:
        print("--- Item search/create: error")
        return create_free_item(item, session, headers)


def get_iva_rate_from_tax_template(template_name, session, headers):
    """
    Obtiene la tasa de IVA de una plantilla de impuestos.
    """
    try:
        # Obtener detalles de la plantilla de impuestos
        template_response, template_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item Tax Template/{quote(template_name)}",
            operation_name="Get tax template details"
        )

        if template_error:
            return 0
        
        template_data = template_response.json().get("data", {})
        taxes = template_data.get('taxes', [])
        
        # Buscar la tasa de IVA (generalmente es el primer tax con account_type vacío o IVA)
        for tax in taxes:
            if tax.get('tax_type') and 'IVA' in tax.get('tax_type', '').upper():
                return tax.get('tax_rate', 0)
        
        # Si no se encontró específicamente IVA, devolver la primera tasa
        if taxes:
            return taxes[0].get('tax_rate', 0)
        
        return 0
    except Exception as e:
        print("--- IVA rate retrieval: error")
        return 0


def create_item_with_description(item, session, headers, company, tax_map=None, transaction_type='sales'):
    """Crear un nuevo item con descripción específica y asignar template de impuestos"""
    try:
        import datetime
        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        
        # Crear código único basado en la descripción
        description = item.get('description', 'Servicio').strip()
        # Tomar primeras palabras y agregar timestamp para evitar colisiones
        words = description.split()[:3]  # Máximo 3 palabras
        base_name = '-'.join(words).upper()[:20]  # Máximo 20 caracteres
        item_code = f"{base_name}-{timestamp}"
        
        company_abbr = get_company_abbr(session, headers, company) if company else None
        if company_abbr:
            item_code = add_company_abbr(item_code, company_abbr)

        item_body = {
            "item_code": item_code,
            "item_name": description,
            "item_group": "Services",
            "stock_uom": "Unit",
            "is_stock_item": 0,
            "docstatus": 0,  # Marca: item creado automáticamente desde factura (draft)
        }

        print("--- Creating item with description")

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item",
            data={"data": item_body},
            operation_name="Create item with description"
        )

        if error:
            print("--- Item creation: error")
            return None

        # Asignar template de impuestos si se proporcionó (usar transaction_type)
        if 'iva_percent' in item:
            iva_percent = item['iva_percent']
            # If a tax_map was passed and it's a typed map, extract the right one
            if tax_map and isinstance(tax_map, dict) and ('sales' in tax_map or 'purchase' in tax_map):
                map_for_type = tax_map.get(transaction_type, {})
            else:
                # If caller passed simple flat map or None, try fetching map for this transaction_type
                map_for_type = tax_map or get_tax_template_map(session, headers, company, transaction_type=transaction_type)

            search_key = str(float(iva_percent))
            if search_key in map_for_type:
                template_name = map_for_type[search_key]
                assign_tax_template_by_rate(item_code, iva_percent, session, headers, company, map_for_type, transaction_type=transaction_type)
                print("--- Tax template: assigned to new item")

        return item_code
        
    except Exception as e:
        print("--- Item creation with description: error")
        return None


def create_free_item(item, session, headers, company):
    """Crear un nuevo item 'libre' en ERPNext (función legacy)"""
    try:
        import datetime
        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

        item_code = f"SERVICIO-{timestamp}"
        company_abbr = get_company_abbr(session, headers, company) if company else None
        if company_abbr:
            item_code = add_company_abbr(item_code, company_abbr)

        item_body = {
            "item_code": item_code,
            "item_name": item.get('item_name', item.get('description', 'Servicio')),
            "item_group": "Services",
            "stock_uom": "Unit",
            "is_stock_item": 0,
            "docstatus": 0,  # Marca: item creado automáticamente desde factura (draft)
        }

        print("--- Creating free item")

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item",
            data={"data": item_body},
            operation_name="Create free item"
        )

        if error:
            print("--- Free item creation: error")
            return None

        return item_code
    except Exception as e:
        print("--- Free item creation: error")
        return None


def ensure_item_exists(item_code, item, session, headers, company):
    """
    Garantiza que el item exista en ERPNext.
    Si no existe, crea un servicio no stock reutilizando el código solicitado.
    """
    if not item_code:
        return None

    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item/{quote(item_code)}",
            operation_name=f"Check item existence '{item_code}'"
        )
        if not error and response and response.status_code == 200:
            return item_code
    except Exception as check_error:
        print(f"--- Item existence check error for {item_code}: {check_error}")

    description = item.get('item_name') or item.get('description') or item_code
    item_body = {
        "item_code": item_code,
        "item_name": description,
        "item_group": item.get('item_group') or 'Services',
        "stock_uom": item.get('uom') or item.get('stock_uom') or 'Unit',
        "is_stock_item": 0,
        "docstatus": 0
    }

    print(f"--- Creating missing item '{item_code}' como servicio no stock")
    response, error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Item",
        data={"data": item_body},
        operation_name=f"Create missing item '{item_code}'"
    )

    if error or (response and response.status_code not in (200, 201)):
        print(f"--- Failed to create missing item '{item_code}': {error or (response.text if response else 'unknown error')}")
        return item_code

    return item_code


def clear_tax_template_cache(company=None):
    """
    Limpia el caché de templates de impuestos.
    Si se proporciona company, solo limpia ese company.
    Si no, limpia todo el caché.
    """
    global tax_template_cache
    if company:
        if company in tax_template_cache:
            del tax_template_cache[company]
            print(f"--- Tax template cache cleared for company: {company}")
    else:
        tax_template_cache = {}
        print("--- Tax template cache cleared completely")


# Cache para almacenar el mapeo de tasas a cuentas de impuestos
_rate_to_account_cache = {}

def get_iva_account_for_rate(session, headers, company, iva_rate, transaction_type='purchase'):
    """
    Obtiene la cuenta de IVA específica para una tasa dada.
    
    Para compras: busca cuentas tipo "IVA Crédito Fiscal X%"
    Para ventas: busca cuentas tipo "IVA Débito Fiscal X%"
    
    OPTIMIZADO: Usa el caché poblado por get_tax_template_map para evitar llamadas API adicionales.
    
    Returns:
        dict con la estructura {account_head: rate} para usar en item_tax_rate
    """
    try:
        cache_key = f"{company}_{transaction_type}"
        
        # Verificar si ya tenemos el cache poblado por get_tax_template_map
        if cache_key not in _rate_to_account_cache or not _rate_to_account_cache[cache_key]:
            # Forzar la construcción del caché llamando a get_tax_template_map
            # Esto poblará _rate_to_account_cache como efecto secundario
            get_tax_template_map(session, headers, company, transaction_type)
        
        # Buscar la cuenta para la tasa específica
        rate_str = str(float(iva_rate))
        account_head = _rate_to_account_cache.get(cache_key, {}).get(rate_str)
        
        if account_head:
            # IMPORTANTE: Retornar SOLO la cuenta y tasa que corresponde
            # ERPNext usará esto para sobrescribir las tasas del template del item
            return {account_head: float(iva_rate)}
        
        print(f"--- IVA account not found for rate {iva_rate}")
        return None
        
    except Exception as e:
        print(f"--- Error getting IVA account for rate {iva_rate}: {e}")
        return None


def build_item_tax_rate_for_purchase(session, headers, company, iva_rate):
    """
    Construye el JSON de item_tax_rate para una factura de compra.
    
    El formato de ERPNext es: {"account_head": rate}
    donde account_head es el nombre de la cuenta de impuestos
    y rate es la tasa numérica (ej: 21.0)
    
    Returns:
        str: JSON string con el formato {"account_head": rate}
    """
    try:
        rate_info = get_iva_account_for_rate(session, headers, company, iva_rate, 'purchase')
        if rate_info:
            # rate_info ya es un dict {account_head: rate}
            return json.dumps(rate_info)
        return None
    except Exception as e:
        print(f"--- Error building item_tax_rate: {e}")
        return None


def get_tax_template_map(session, headers, company, transaction_type='sales'):
    """
    Obtener el mapa de tasas de IVA a nombres de templates de Item Tax Template.
    
    NOTA: Con la estructura actual existe un template por alícuota y por tipo
    (ventas/compras). Este mapa relaciona cada tasa con el template que corresponde
    para asignarlo en los ítems y documentos.
    
    También almacena el mapeo tasa->cuenta para optimizar get_iva_account_for_rate.
    """
    global _rate_to_account_cache
    
    try:
        if not company:
            print("--- Tax template map: company required")
            return {}

        # Verificar si ya tenemos el mapa en caché
        if company in tax_template_cache:
            cached = tax_template_cache[company]
            if isinstance(cached, dict) and transaction_type in cached:
                print(f"--- Using cached tax template map for {transaction_type}")
                return cached[transaction_type]

        print("--- Searching tax templates")

        # Primero obtenemos la lista de templates
        list_response, list_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Tax Template",
            params={
                "fields": json.dumps(["name", "title"]),
                "filters": json.dumps([["disabled", "=", "0"], ["company", "=", company]])
            },
            operation_name="List tax templates"
        )

        if list_error:
            print(f"--- Tax template list error: {list_error}")
            return {}

        templates = list_response.json().get('data', [])
        print(f"--- Templates found: {len(templates)}")

        # Obtener todos los detalles de templates en una sola llamada
        template_names = [t.get('name') for t in templates if t.get('name')]
        if not template_names:
            print("--- No template names found")
            return {}

        detail_response, detail_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data={
                "doctype": "Item Tax Template Detail",
                "parent": "Item Tax Template",
                "fields": ["name", "parent", "tax_type", "tax_rate"],
                "filters": {
                    "parent": ["in", template_names],
                    "parenttype": "Item Tax Template"
                }
            },
            operation_name="Get all tax template details"
        )

        if detail_error or not detail_response or detail_response.status_code != 200:
            print(f"--- Could not get tax template details: {detail_error}")
            return {}

        all_details = detail_response.json().get('message', [])
        print(f"--- Retrieved {len(all_details)} tax template details")

        # Agrupar detalles por template
        details_by_template = {}
        for detail in all_details:
            parent = detail.get('parent')
            if parent:
                if parent not in details_by_template:
                    details_by_template[parent] = []
                details_by_template[parent].append(detail)

        rate_map_sales = {}
        rate_map_purchase = {}
        # También construir mapeo tasa->cuenta para optimizar get_iva_account_for_rate
        rate_to_account_sales = {}
        rate_to_account_purchase = {}

        for template_doc in templates:
            template_name = template_doc.get('name')
            title = template_doc.get('title') or ''
            
            # Clasificar template como sales/purchase
            is_sales = any(k in template_name.lower() for k in ['ventas', 'sales', 'débito']) or \
                       any(k in title.lower() for k in ['ventas', 'sales', 'débito'])
            is_purchase = any(k in template_name.lower() for k in ['compras', 'purchase', 'crédito']) or \
                          any(k in title.lower() for k in ['compras', 'purchase', 'crédito'])
            
            taxes = details_by_template.get(template_name, [])
            
            print(f"--- Template '{template_name}' has {len(taxes)} tax rates, is_sales={is_sales}, is_purchase={is_purchase}")

            # Mapear cada tasa al nombre del template Y a la cuenta
            for tax in taxes:
                if isinstance(tax, dict) and 'tax_rate' in tax and tax.get('tax_rate') is not None:
                    try:
                        rate = float(tax['tax_rate'])
                        rate_key = str(rate)
                        account_head = tax.get('tax_type')  # La cuenta de impuestos
                        
                        # Con la nueva estructura, un template contiene múltiples tasas
                        # Asignamos el MISMO template a cada tasa
                        if is_purchase and not is_sales:
                            if rate_key not in rate_map_purchase:
                                rate_map_purchase[rate_key] = template_name
                                print(f"--- Mapped purchase rate {rate_key} -> {template_name}")
                            if account_head and rate_key not in rate_to_account_purchase:
                                rate_to_account_purchase[rate_key] = account_head
                        else:
                            # Por defecto es ventas
                            if rate_key not in rate_map_sales:
                                rate_map_sales[rate_key] = template_name
                                print(f"--- Mapped sales rate {rate_key} -> {template_name}")
                            if account_head and rate_key not in rate_to_account_sales:
                                rate_to_account_sales[rate_key] = account_head
                    except Exception as e:
                        print(f"--- Error processing tax rate: {e}")
                        continue

        # Guardar en caché el mapeo template
        tax_template_cache[company] = {
            'sales': rate_map_sales,
            'purchase': rate_map_purchase
        }
        
        # Guardar en caché el mapeo cuenta (para get_iva_account_for_rate)
        _rate_to_account_cache[f"{company}_sales"] = rate_to_account_sales
        _rate_to_account_cache[f"{company}_purchase"] = rate_to_account_purchase
        
        print(f"--- Tax map cached: sales={len(rate_map_sales)} rates, purchase={len(rate_map_purchase)} rates")
        print(f"--- Account map cached: sales={len(rate_to_account_sales)} rates, purchase={len(rate_to_account_purchase)} rates")
        print(f"--- Sales rates: {list(rate_map_sales.keys())}")
        print(f"--- Purchase rates: {list(rate_map_purchase.keys())}")

        print(f"--- Tax map built: sales={len(rate_map_sales)} purchase={len(rate_map_purchase)} rates")
        # Return requested type
        return tax_template_cache[company].get(transaction_type, {})

    except requests.exceptions.RequestException as e:
        print("--- Tax template map: network error")
        return {}
    except Exception as e:
        print("--- Tax template map: critical error")
        return {}


def get_tax_template_for_rate_v2(iva_percent, session, headers, company=None, transaction_type='sales'):
    """Obtener el nombre del template de impuestos para una tasa específica"""
    try:
        rate_to_template_map = get_tax_template_map(session, headers, company, transaction_type)
        # CORRECCIÓN: Normalizar el iva_percent antes de buscar
        search_key = str(float(iva_percent))
        return rate_to_template_map.get(search_key)
    except Exception as e:
        print("--- Tax template retrieval: error")
        return None


def assign_tax_template_by_rate(item_code, iva_percent, session, headers, company=None, rate_to_template_map=None, transaction_type='sales'):
    """Asignar plantilla de impuestos al item basado en el porcentaje de IVA"""
    try:
        # Si no se proporcionó el mapa, obtenerlo dinámicamente
        if rate_to_template_map is None:
            # get map for the requested transaction type
            rate_to_template_map = get_tax_template_map(session, headers, company, transaction_type)
        # support callers that pass the whole typed cache
        elif isinstance(rate_to_template_map, dict) and ('sales' in rate_to_template_map or 'purchase' in rate_to_template_map):
            rate_to_template_map = rate_to_template_map.get(transaction_type, {})

        # CORRECCIÓN: Normalizar el iva_percent antes de buscar
        search_key = str(float(iva_percent))
        
        # Usar mapa dinámico - sin fallback hardcodeado
        if search_key in rate_to_template_map:
            template_name = rate_to_template_map[search_key]
        else:
            template_name = None

        if not template_name:
            print("--- Tax template: not found")
            return

        tax_body = {
            "taxes": [{"item_tax_template": template_name}]
        }

        print("--- Assigning tax template to item")

        # Prepare a smart search order to avoid causing 404s in ERPNext logs.
        # If we have a company and the provided item_code does NOT already include the abbr,
        # try the abbr-appended code first (most likely match), then fall back to the original.
        target_item_code = item_code
        try:
            company_abbr = None
            if company:
                company_abbr = get_company_abbr(session, headers, company)

            search_candidates = [item_code]
            if company_abbr:
                suffix = f" - {company_abbr}"
                # if the provided item_code doesn't end with the abbr, try abbr-appended candidate first
                if not item_code.endswith(suffix):
                    candidate = add_company_abbr(item_code, company_abbr)
                    if candidate != item_code:
                        # try candidate first to avoid 404 noise
                        search_candidates = [candidate, item_code]
                else:
                    # it already contains abbr; keep raw first then try without abbr
                    stripped = remove_company_abbr(item_code, company_abbr)
                    if stripped != item_code:
                        search_candidates = [item_code, stripped]

            # Iterate search_candidates and pick the first that exists
            found = False
            for candidate in search_candidates:
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Item/{quote(candidate)}",
                    operation_name="Check Item existence before assign tax template"
                )
                if not check_err and check_resp and check_resp.status_code == 200:
                    target_item_code = candidate
                    found = True
                    break

            # If none exists we will still attempt with candidate if that is the abbr-appended
            if not found and company_abbr and not item_code.endswith(f" - {company_abbr}"):
                target_item_code = add_company_abbr(item_code, company_abbr)

        except Exception as e:
            # If anything goes wrong during searching, log and proceed with original item_code
            print(f"--- Check Item existence before assign tax template falló: {e}")

        # Get current taxes to avoid overwriting existing ones
        current_taxes = []
        try:
            current_resp, current_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Item/{quote(target_item_code)}",
                operation_name="Get current taxes before assigning"
            )
            if not current_err and current_resp and current_resp.status_code == 200:
                current_item = current_resp.json().get('data', {})
                current_taxes = current_item.get('taxes', [])
        except Exception as e:
            print(f"--- Error getting current taxes: {e}")

        # Check if the template is already assigned
        existing_templates = [tax.get('item_tax_template') for tax in current_taxes if tax.get('item_tax_template')]
        if template_name not in existing_templates:
            current_taxes.append({"item_tax_template": template_name})
            tax_body = {"taxes": current_taxes}
        else:
            print("--- Tax template already assigned")
            return

        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Item/{quote(target_item_code)}",
            data={"data": tax_body},
            operation_name="Assign tax template to item"
        )

        if error:
            print("--- Tax template assignment: error")
        else:
            print("--- Tax template: assigned successfully")

    except Exception as e:
        print("--- Tax template assignment: error")


def _coerce_stock_flag(flag_value, default=1):
    """Normaliza valores booleanos provenientes del importador a 0/1."""
    try:
        if flag_value is None:
            return default
        if isinstance(flag_value, bool):
            return 1 if flag_value else 0
        if isinstance(flag_value, (int, float)):
            return 1 if float(flag_value) != 0 else 0
        normalized = str(flag_value).strip().lower()
        if normalized in ('1', 'true', 'si', 'sí', 'producto', 'product', 'stock'):
            return 1
        if normalized in ('0', 'false', 'no', 'servicio', 'service', 'nostock'):
            return 0
    except Exception:
        pass
    return default


def _append_company_suffix(value, company_abbr):
    """Agrega la abreviatura de la compañía al final si aún no la tiene."""
    if not value:
        return value
    trimmed = str(value).strip()
    if not trimmed or not company_abbr:
        return trimmed
    suffix = f" - {company_abbr}"
    if trimmed.endswith(suffix):
        return trimmed
    return f"{trimmed}{suffix}"


def _normalize_item_group(group_value, company_abbr):
    """Normaliza el item_group agregando la sigla de la compañía e imponiendo mayúsculas."""
    if not group_value:
        return ''
    normalized = str(group_value).strip().upper()
    return _append_company_suffix(normalized, company_abbr)


def _clean_item_payload(payload):
    """Elimina campos con valores None para evitar sobrescribir con null en ERPNext."""
    return {k: v for k, v in payload.items() if v is not None}


def _prepare_item_document(raw_item, company_name, company_abbr):
    """Construye el JSON del Item aplicando las transformaciones necesarias."""
    if not raw_item:
        return None, "Datos del item vacíos"

    item_code = (raw_item.get("item_code") or "").strip()
    if not item_code:
        return None, "Item sin código"

    normalized_code = _append_company_suffix(item_code, company_abbr)
    description = raw_item.get("description") or raw_item.get("item_name") or normalized_code

    item_name = (raw_item.get("item_name") or "").strip()
    if not item_name:
        item_name = description
    normalized_name = _append_company_suffix(item_name, company_abbr)
    if len(normalized_name) > 140:
        return None, "El nombre del item supera el máximo de 140 caracteres"

    item_group = _normalize_item_group(raw_item.get("item_group"), company_abbr)
    if not item_group:
        return None, "Item sin categoría"

    stock_uom = (raw_item.get("stock_uom") or "Unit").strip()
    if not stock_uom:
        return None, "Item sin unidad de medida"

    brand_value = raw_item.get("brand")
    brand = brand_value.strip().upper() if isinstance(brand_value, str) and brand_value.strip() else None

    document = {
        "item_code": normalized_code,
        "item_name": normalized_name,
        "description": description,
        "item_group": item_group,
        "stock_uom": stock_uom,
        "is_stock_item": _coerce_stock_flag(raw_item.get("is_stock_item"), default=1),
        "brand": brand,
        "custom_company": company_name,
        "is_sales_item": _coerce_stock_flag(raw_item.get("is_sales_item"), default=1),
        "is_purchase_item": _coerce_stock_flag(raw_item.get("is_purchase_item"), default=1),
        "valuation_rate": raw_item.get("valuation_rate"),
        "income_account": raw_item.get("income_account") or None,
        "expense_account": raw_item.get("expense_account") or None,
        "valuation_method": raw_item.get("valuation_method") or None,
    }

    # Campos opcionales adicionales (solo si incluyen datos válidos)
    for optional_field in ("item_group_name", "default_supplier", "custom_description_type"):
        if raw_item.get(optional_field):
            document[optional_field] = raw_item.get(optional_field)

    return _clean_item_payload(document), None
def _build_tax_template_lookup(session, headers, company):
    """
    Obtiene las plantillas de impuestos y devuelve un mapa estructurado por tasa.
    
    Retorna un dict con:
    - 'by_rate': { tasa: { 'sales': template_name, 'purchase': template_name } }
    - 'by_name': { nombre/titulo: template_name }
    
    Usa el campo custom_transaction_type para clasificar templates como ventas/compras.
    """
    try:
        # Obtener todos los templates de la compañía
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Tax Template",
            params={
                "fields": json.dumps(["name", "title", "company", "custom_transaction_type"]),
                "filters": json.dumps([["company", "=", company], ["disabled", "=", 0]]),
                "limit_page_length": 500
            },
            operation_name="List Item Tax Templates (bulk import with IVA)"
        )
        if error or not response or response.status_code != 200:
            print(f"--- bulk-import IVA: error listando plantillas: {error}")
            return {'by_rate': {}, 'by_name': {}}
        
        templates_data = response.json().get("data", [])
        if not templates_data:
            return {'by_rate': {}, 'by_name': {}}
        
        by_name = {}
        template_info = {}  # name -> {transaction_type}
        template_names = []
        
        # Recopilar info básica de todos los templates
        for entry in templates_data:
            tpl_name = entry.get("name")
            title = entry.get("title")
            transaction_type = entry.get("custom_transaction_type") or ""
            
            if tpl_name:
                by_name[tpl_name] = tpl_name
                template_names.append(tpl_name)
                template_info[tpl_name] = {'transaction_type': transaction_type}
            if title:
                by_name[title] = tpl_name
        
        # Obtener las tasas de todos los templates usando frappe.client.get_list
        # Esto permite consultar child tables sin problemas de permisos
        by_rate = {}
        
        if template_names:
            batch_size = 50
            for i in range(0, len(template_names), batch_size):
                batch = template_names[i:i + batch_size]
                
                # Usar POST a frappe.client.get_list para evitar PermissionError en child tables
                detail_response, detail_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.get_list",
                    data={
                        "doctype": "Item Tax Template Detail",
                        "parent": "Item Tax Template",
                        "fields": ["parent", "tax_rate"],
                        "filters": [
                            ["parent", "in", batch],
                            ["parenttype", "=", "Item Tax Template"]
                        ],
                        "limit_page_length": 5000
                    },
                    operation_name=f"Bulk fetch Item Tax Template rates (batch {i // batch_size + 1})"
                )
                
                if detail_error or not detail_response or detail_response.status_code != 200:
                    print(f"--- Error en batch {i // batch_size + 1}: {detail_error}")
                    continue
                
                # frappe.client.get_list devuelve en "message", no en "data"
                details = detail_response.json().get('message', [])
                for detail in details:
                    parent = detail.get('parent')
                    tax_rate = detail.get('tax_rate')
                    
                    if parent is None or tax_rate is None:
                        continue
                    
                    try:
                        rate = float(tax_rate)
                        rate_key = str(rate)
                        
                        if rate_key not in by_rate:
                            by_rate[rate_key] = {'sales': None, 'purchase': None}
                        
                        # Clasificar según custom_transaction_type
                        info = template_info.get(parent, {})
                        transaction_type = info.get('transaction_type', '')
                        
                        if transaction_type == "Ventas":
                            by_rate[rate_key]['sales'] = parent
                        elif transaction_type == "Compras":
                            by_rate[rate_key]['purchase'] = parent
                    except (ValueError, TypeError):
                        continue
        
        print(f"--- Tax template lookup built: {len(by_rate)} rates, {len(by_name)} names")
        return {'by_rate': by_rate, 'by_name': by_name}
    except Exception as exc:
        print(f"--- bulk-import IVA: error obteniendo plantillas: {exc}")
        return {'by_rate': {}, 'by_name': {}}

def _build_item_taxes(iva_rate, lookup, company_name):
    """
    Retorna la tabla hija taxes basada en la tasa de IVA provista.
    
    Ahora recibe una tasa (ej: "21", "10.5") en lugar del nombre del template.
    Busca ambos templates (ventas y compras) para esa tasa y los retorna.
    
    Args:
        iva_rate: Tasa de IVA como string (ej: "21", "10.5", "0")
        lookup: Dict con estructura {'by_rate': {...}, 'by_name': {...}}
        company_name: Nombre de la compañía
        
    Returns:
        Lista de taxes con ambos templates (ventas y compras), o [] si no hay rate,
        o None si la tasa no fue encontrada.
    """
    if not iva_rate:
        return []
    
    rate_str = str(iva_rate).strip()
    
    # Intentar normalizar la tasa (convertir a float y luego a string)
    try:
        rate_float = float(rate_str)
        rate_key = str(rate_float)
    except (ValueError, TypeError):
        rate_key = rate_str
    
    by_rate = lookup.get('by_rate', {})
    by_name = lookup.get('by_name', {})
    
    # Primero intentar buscar por tasa
    if rate_key in by_rate:
        rate_templates = by_rate[rate_key]
        taxes = []
        
        sales_template = rate_templates.get('sales')
        if sales_template:
            taxes.append({
                "item_tax_template": sales_template,
                "company": company_name
            })
        
        purchase_template = rate_templates.get('purchase')
        if purchase_template:
            taxes.append({
                "item_tax_template": purchase_template,
                "company": company_name
            })
        
        if taxes:
            return taxes
    
    # Fallback: si viene un nombre de template legacy (para compatibilidad)
    if by_name:
        template_key = by_name.get(rate_str)
        if template_key:
            return [{
                "item_tax_template": template_key,
                "company": company_name
            }]
    
    return None


def _find_existing_item(session, headers, item_code, company_abbr):
    """
    Busca si el item ya existe (probando con y sin sufijo de compañía).
    Devuelve (item_name_resuelto, data) o (None, None).
    """
    if not item_code:
        return None, None

    suffix = f" - {company_abbr}" if company_abbr else ""
    candidates = []
    if company_abbr and suffix and not item_code.endswith(suffix):
        candidates.append(f"{item_code}{suffix}")
    candidates.append(item_code)
    if company_abbr and suffix and item_code.endswith(suffix):
        without = remove_company_abbr(item_code, company_abbr)
        if without != item_code:
            candidates.append(without)

    for candidate in candidates:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item/{quote(candidate)}",
            operation_name=f"Check Item exists ({candidate})"
        )
        if resp and resp.status_code == 200:
            try:
                data = resp.json().get("data", {})
            except Exception:
                data = {}
            return candidate, data
    return None, None


def determine_income_account(item, session, headers, company):
    """Determinar la cuenta de ingresos para el item"""
    try:
        print("--- Determining income account")
        
        # Regla 0: Si el item ya tiene una cuenta de ingresos definida, usarla
        if item.get('income_account'):
            income_account = item['income_account']
            print("--- Income account: using item default")
            return income_account
        
        # NO usar la cuenta específica del frontend (item.get('account')) porque 
        # el frontend envía la cuenta de débito, no la de ingresos
        
        # Regla 1: Obtener cuenta por defecto del cliente desde el campo custom
        customer_name = item.get('customer')
        if customer_name:
            try:
                print("--- Income account: checking customer default")
                customer_data, customer_error, customer_fetch_name = fetch_customer(
                    session=session,
                    headers=headers,
                    customer_name=customer_name,
                    company_name=company,
                    fields=["custom_cuenta_de_ingresos_por_defecto", "accounts"],
                    operation_name=f"Get customer data for income account ({customer_name})",
                )


                if customer_error:
                    print("--- Customer data: error")
                else:
                    # Primero buscar en el campo custom
                    if customer_data.get('custom_cuenta_de_ingresos_por_defecto'):
                        income_account = customer_data['custom_cuenta_de_ingresos_por_defecto']
                        print("--- Income account: found in custom field")
                        return income_account
                    
                    # Fallback: buscar en accounts (para compatibilidad)
                    if 'accounts' in customer_data and customer_data['accounts']:
                        for account_entry in customer_data['accounts']:
                            if account_entry.get('account_type') == 'Income':
                                income_account = account_entry['account']
                                print("--- Income account: found in accounts")
                                return income_account
                    
                    print("--- Income account: not found for customer")
            except Exception as e:
                print("--- Customer account retrieval: error")
        
        # Regla 2: Fallback a cuenta por defecto de la compañía
        print("--- Income account: using company default")
        company_defaults = get_company_defaults(company, session, headers)
        if company_defaults and company_defaults.get('default_income_account'):
            income_account = company_defaults['default_income_account']
            print("--- Income account: company default found")
            return income_account
        else:
            print("--- Company default income account: not found")
        
        # Regla 3: Si no hay cuenta por defecto, buscar una cuenta de ingresos en el plan de cuentas
        print("--- Income account: searching chart of accounts")
        try:
            # Buscar cuentas de ingresos (root type = Income)
            search_filters = f'[[\"company\",\"=\",\"{company}\"],[\"root_type\",\"=\",\"Income\"]]'
            fields_str = '["name","account_name"]'
            accounts_response, accounts_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Account",
                params={
                    "filters": json.dumps([["company","=", company],["root_type","=","Income"]]),
                    "fields": json.dumps(["name","account_name"]),
                    "limit_page_length": 10
                },
                operation_name="Search income accounts in chart of accounts"
            )

            if accounts_error:
                print("--- Income accounts search: error")
            else:
                accounts_data = accounts_response.json()
                if accounts_data.get('data') and len(accounts_data['data']) > 0:
                    # Buscar específicamente la cuenta de ventas de mercadería si existe
                    ventas_mercaderia = None
                    for account in accounts_data['data']:
                        if 'Ventas de mercadería' in account.get('account_name', ''):
                            ventas_mercaderia = account
                            break
                    
                    # Si no se encuentra, usar la primera cuenta de ingresos
                    if not ventas_mercaderia:
                        ventas_mercaderia = accounts_data['data'][0]
                    
                    income_account = ventas_mercaderia['name']
                    print("--- Income account: found in chart of accounts")
                    return income_account
                else:
                    print("--- Income accounts: not found in chart")
        except Exception as e:
            print("--- Income accounts search: error")

        print("--- Income account: could not determine")
        
        # Regla 4: Último recurso - usar cuenta hardcodeada conocida
        print("--- Income account: using hardcoded fallback")
        hardcoded_account = "4.1.1.03.00 - Ventas de mercadería - MS"
        return hardcoded_account
        
        return None

    except Exception as e:
        print("--- Income account determination: error")
        return None


def get_tax_template_for_rate(rate, tax_map):
    """Obtener template de impuestos para una tasa específica"""
    try:
        if not tax_map or not rate:
            return None

        rate_str = str(float(rate))
        return tax_map.get(rate_str)

    except Exception as e:
        print("--- Tax template for rate: error")
        return None


def get_company_defaults(company_name, session, headers):
    """Obtener las cuentas por defecto de la compañía"""
    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            operation_name="Get company defaults"
        )

        if error:
            print("--- Company retrieval: error")
            return None

        company_data = response.json()['data']
        # Some deployments store the default warehouse in 'custom_default_warehouse'
        # while others use 'default_warehouse'. Support both and prefer the custom field
        default_warehouse = company_data.get('custom_default_warehouse') or company_data.get('default_warehouse') or ''
        return {
            "default_receivable_account": company_data.get('default_receivable_account', ''),
            "default_income_account": company_data.get('default_income_account', ''),
            "default_payable_account": company_data.get('default_payable_account', ''),
            "default_expense_account": company_data.get('default_expense_account', ''),
            "default_warehouse": default_warehouse
        }

    except Exception as e:
        print("--- Company defaults retrieval: error")
        return None


def determine_expense_account(item, session, headers, company, supplier=None):
    """
    Determina la cuenta de gastos para un ítem en una factura de compra.
    Similar a determine_income_account pero para compras.
    """
    try:
        # Si el item ya tiene expense_account, usarlo
        if item.get('expense_account'):
            print("--- Using item expense account")
            return item['expense_account']
        
        # Si hay supplier, verificar si tiene default expense account
        if supplier:
            from routes.suppliers import get_supplier_expense_account
            supplier_expense_account = get_supplier_expense_account(supplier, company, session, headers)
            if supplier_expense_account:
                print("--- Using supplier expense account")
                return supplier_expense_account
        
        # Obtener defaults de la compañía
        company_defaults = get_company_defaults(company, session, headers)
        if company_defaults and company_defaults.get('default_expense_account'):
            print("--- Using company default expense account")
            return company_defaults['default_expense_account']
        
        print("--- Expense account: not determined")
        return None
        
    except Exception as e:
        print("--- Expense account determination: error")
        return None


def process_purchase_invoice_item(item, session, headers, company, tax_map=None, supplier=None):
    """
    Procesa un ítem de la factura de compra, similar a process_invoice_item pero para compras.
    Determina expense_account en lugar de income_account.
    
    CAMPOS VÁLIDOS DE ERPNEXT Purchase Invoice Item:
    - item_code, item_name, description, qty, rate, uom
    - discount_percentage, discount_amount
    - expense_account, warehouse, cost_center
    - item_tax_rate (JSON string con cuenta:tasa)
    - purchase_order, po_detail, purchase_receipt, pr_detail
    
    CAMPOS QUE NO SE DEBEN PASAR:
    - iva_percent, account, valuation_rate, item_tax_template, amount
    """
    try:
        print("--- Processing purchase invoice item")
        if not isinstance(item, dict):
            print("--- Purchase item processing: invalid format")
            return None
        
        # Procesar descuento: aceptar ambos nombres (discount_percent o discount_percentage)
        discount_percentage = float(item.get('discount_percent') or item.get('discount_percentage') or 0)
        
        # Calcular discount_amount si hay porcentaje de descuento
        qty = float(item.get('qty', 1) or 1)
        rate = float(item.get('rate', 0) or 0)
        discount_amount = 0
        if discount_percentage > 0 and qty > 0 and rate > 0:
            subtotal = qty * rate
            discount_amount = subtotal * (discount_percentage / 100)
        
        # Guardar iva_percent para uso interno (no se envía a ERPNext)
        iva_percent = item.get('iva_percent', 21)
            
        # Solo campos válidos de ERPNext Purchase Invoice Item
        processed_item = {
            "item_code": item.get('item_code', ''),
            "item_name": item.get('item_name', ''),
            "description": item.get('description', ''),
            "qty": qty,
            "rate": rate,
            "uom": item.get('uom', 'Unit'),
        }
        
        # Agregar descuento solo si hay
        if discount_percentage > 0:
            processed_item["discount_percentage"] = discount_percentage
            processed_item["discount_amount"] = discount_amount

        # Si no hay item_code pero hay descripción, buscar item existente por nombre y tasa IVA
        if not item.get('item_code') and item.get('description'):
            print("--- Finding/creating purchase item by description")
            item_code = find_or_create_item_by_description(item, session, headers, company, tax_map, transaction_type='purchase')
            if not item_code:
                print("--- Purchase item creation: error")
                return None
            processed_item["item_code"] = item_code
            print("--- Purchase item: created/found")
        # Si no hay item_code ni descripción, es un item libre que debemos crear
        elif not item.get('item_code'):
            print("--- Creating free purchase item")
            item_code = create_free_item(item, session, headers, company)
            if not item_code:
                print("--- Free purchase item creation: error")
                return None
            processed_item["item_code"] = item_code
            print("--- Free purchase item: created")
        else:
            processed_item["item_code"] = item['item_code']
            print("--- Using existing purchase item")

        # Asignar impuesto basado en el IVA que viene del frontend
        # IMPORTANTE: Debemos pasar TANTO item_tax_template COMO item_tax_rate
        # - item_tax_template: Para que ERPNext use el template de COMPRAS (no el de ventas del item)
        # - item_tax_rate: Para especificar la cuenta y tasa exacta
        # Si solo pasamos item_tax_rate, ERPNext puede sobrescribirlo con el template por defecto del Item
        if 'iva_percent' in item:
            iva_rate = float(item['iva_percent'])
            
            # Obtener el nombre del template de compras para esta tasa
            if tax_map:
                rate_key = str(iva_rate)
                purchase_template = tax_map.get(rate_key)
                if purchase_template:
                    processed_item["item_tax_template"] = purchase_template
                    print(f"--- Purchase item_tax_template: {purchase_template}")
            
            # Construir item_tax_rate para que ERPNext aplique la cuenta correcta
            item_tax_rate = build_item_tax_rate_for_purchase(session, headers, company, iva_rate)
            if item_tax_rate:
                processed_item["item_tax_rate"] = item_tax_rate
                print(f"--- Purchase item_tax_rate: {item_tax_rate}")
            else:
                print("--- Purchase item_tax_rate: could not build")

        # Determinar cuenta de gastos
        expense_account = determine_expense_account(item, session, headers, company, supplier)
        if expense_account:
            processed_item["expense_account"] = expense_account
            print("--- Expense account: assigned")
        else:
            print("--- Expense account: not determined, trying company default")
            # Si no hay cuenta específica, intentar obtener la cuenta por defecto de gastos de la compañía
            company_defaults = get_company_defaults(company, session, headers)
            if company_defaults and company_defaults.get('default_expense_account'):
                processed_item["expense_account"] = company_defaults['default_expense_account']
                print("--- Company default expense account: assigned")
            else:
                print("--- Expense account: none determined")

        if item.get('purchase_order'):
            processed_item['purchase_order'] = item['purchase_order']
        if item.get('purchase_order_item'):
            processed_item['po_detail'] = item['purchase_order_item']
        if item.get('po_detail'):
            processed_item['po_detail'] = item['po_detail']
        if item.get('purchase_receipt'):
            processed_item['purchase_receipt'] = item['purchase_receipt']
        if item.get('pr_detail'):
            processed_item['pr_detail'] = item['pr_detail']
        
        # Agregar warehouse si existe (para items de stock)
        if item.get('warehouse'):
            processed_item['warehouse'] = item['warehouse']
        
        # Agregar cost_center si existe
        if item.get('cost_center'):
            processed_item['cost_center'] = item['cost_center']

        print("--- Purchase invoice item processed successfully")
        return processed_item

    except Exception as e:
        print("--- Purchase invoice item processing: error")
        return None


def ensure_item_groups_for_import(items, session, headers, company, company_abbr):
    """Asegurar que existan todos los grupos de items necesarios para la importación"""
    print("--- Verificando grupos de items para importación ---")
    
    try:
        # company_abbr ya viene validado desde bulk_import_items
        print(f"--- Usando abreviación de compañía: {company_abbr}")
        
        # Recopilar grupos únicos de los items y aplicar abreviación
        unique_groups_with_abbr = set()
        for item in items:
            if item.get('item_group'):
                group_name = item['item_group'].strip().upper()  # Normalizar a mayúsculas
                if group_name:
                    group_with_abbr = f"{group_name} - {company_abbr}"
                    unique_groups_with_abbr.add(group_with_abbr)
        
        print(f"--- Grupos necesarios con abreviación: {list(unique_groups_with_abbr)}")
        
        if not unique_groups_with_abbr:
            print("--- No hay grupos para verificar")
            return True
        
        # PASO 1: Listar todos los grupos existentes de una vez
        print("--- Listando grupos existentes...")
        existing_groups = set()
        
        # Obtener todos los grupos con paginación
        page_length = 500
        start = 0
        
        while True:
            # Extract fields to avoid nested quotes in f-string
            fields_str = '["item_group_name"]'
            list_response, list_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Item Group",
                params={
                    "fields": json.dumps(["item_group_name"]),
                    "limit_page_length": page_length,
                    "limit_start": start
                },
                operation_name="List existing item groups"
            )
            
            if list_error:
                print(f"--- Error listando grupos: {list_error}")
                return False
            
            data = list_response.json().get("data", [])
            if not data:
                break
            
            for group in data:
                existing_groups.add(group.get('item_group_name'))
            
            start += page_length
            if len(data) < page_length:
                break
        
        print(f"--- Grupos existentes encontrados: {len(existing_groups)}")
        
        # PASO 2: Identificar grupos que faltan
        missing_groups = unique_groups_with_abbr - existing_groups
        print(f"--- Grupos faltantes: {list(missing_groups)}")
        
        if not missing_groups:
            print("--- Todos los grupos ya existen")
            return True
        
        # PASO 3: Asegurar que existe "All Item Groups" con abreviación
        root_group_name = f"All Item Groups - {company_abbr}"
        
        if root_group_name not in existing_groups:
            # Crear "All Item Groups - ABBR"
            root_group_data = {
                "item_group_name": root_group_name,
                "is_group": 1
            }
            create_root_url = "/api/resource/Item Group"
            create_root_response, create_root_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint=create_root_url,
                data=root_group_data,
                operation_name="Create root item group with abbreviation"
            )
            
            if create_root_error:
                print(f"--- Error creando grupo raíz {root_group_name}: {create_root_error}")
                return False
            print(f"--- Grupo raíz creado: {root_group_name}")
        
        # PASO 4: Crear grupos faltantes
        created_groups = []
        for group_name in missing_groups:
            # Crear el grupo
            group_data = {
                "item_group_name": group_name,
                "parent_item_group": root_group_name,
                "is_group": 0
            }
            create_group_url = "/api/resource/Item Group"
            create_group_response, create_group_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint=create_group_url,
                data=group_data,
                operation_name=f"Create item group {group_name}"
            )
            
            if create_group_error:
                print(f"--- Error creando grupo {group_name}: {create_group_error}")
                return False
            created_groups.append(group_name)
            print(f"--- Grupo creado: {group_name}")
        
        if created_groups:
            print(f"--- Grupos creados exitosamente: {created_groups}")
        else:
            print("--- No se crearon nuevos grupos")
        
        return True
        
    except Exception as e:
        print(f"--- Error en ensure_item_groups_for_import: {e}")
        return False


def ensure_brands_for_import(items, session, headers):
    """Asegurar que existan todas las marcas necesarias para la importación"""
    print("--- Verificando marcas para importación ---")
    
    try:
        # Recopilar marcas únicas de los items
        unique_brands = set()
        for item in items:
            if item.get('brand'):
                brand_name = item['brand'].strip().upper()  # Normalizar a mayúsculas
                if brand_name:
                    unique_brands.add(brand_name)
        
        print(f"--- Marcas necesarias: {list(unique_brands)}")
        
        if not unique_brands:
            print("--- No hay marcas para verificar")
            return True
        
        # PASO 1: Listar todas las marcas existentes de una vez
        print("--- Listando marcas existentes...")
        existing_brands = set()
        
        # Obtener todas las marcas con paginación
        page_length = 500
        start = 0
        
        while True:
            # Extract fields to avoid nested quotes in f-string
            fields_str = '["name"]'
            list_response, list_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Brand",
                params={
                    "fields": json.dumps(["name"]),
                    "limit_page_length": page_length,
                    "limit_start": start
                },
                operation_name="List existing brands"
            )
            
            if list_error:
                print(f"--- Error listando marcas: {list_error}")
                return False
            
            data = list_response.json().get("data", [])
            if not data:
                break
            
            for brand in data:
                existing_brands.add(brand.get('name'))
            
            start += page_length
            if len(data) < page_length:
                break
        
        print(f"--- Marcas existentes encontradas: {len(existing_brands)}")
        
        # PASO 2: Identificar marcas que faltan
        missing_brands = unique_brands - existing_brands
        print(f"--- Marcas faltantes: {list(missing_brands)}")
        
        if not missing_brands:
            print("--- Todas las marcas ya existen")
            return True
        
        # PASO 3: Crear marcas faltantes
        created_brands = []
        for brand_name in missing_brands:
            # Crear la marca
            brand_data = {
                "brand": brand_name
            }
            create_brand_url = "/api/resource/Brand"
            create_brand_response, create_brand_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint=create_brand_url,
                data=brand_data,
                operation_name=f"Create brand {brand_name}"
            )
            
            if create_brand_error:
                print(f"--- Error creando marca {brand_name}: {create_brand_error}")
                return False
            created_brands.append(brand_name)
            print(f"--- Marca creada: {brand_name}")
        
        if created_brands:
            print(f"--- Marcas creadas exitosamente: {created_brands}")
        else:
            print("--- No se crearon nuevas marcas")
        
        return True
        
    except Exception as e:
        print(f"--- Error en ensure_brands_for_import: {e}")
        return False


# Almacenamiento temporal de progreso de importaciones de items
items_import_progress = {}


@items_bp.route('/api/inventory/items/bulk-import', methods=['POST'])
def bulk_import_items():
    """Importar múltiples items usando Data Import Tool de ERPNext"""
    print("\n--- Importando items usando Data Import Tool ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        items = data.get('items', [])
        mode = data.get('mode', 'insert')  # 'insert' o 'update'

        # IMPORTANTE: Este endpoint NO debe usarse para modo 'stock'
        # El modo stock tiene sus propios endpoints especializados
        if mode == 'stock':
            print("⚠️ WARNING: bulk-import NO debe usarse para modo stock")
            print("⚠️ Usar endpoints: /bulk-update-valuation-rates y /stock-reconciliation")
            return jsonify({
                "success": False, 
                "message": "Este endpoint no soporta modo stock. Usar endpoints especializados."
            }), 400

        if not items:
            return jsonify({"success": False, "message": "No se proporcionaron items para importar"}), 400

        # Obtener la compañía activa del usuario
        from routes.general import get_active_company
        company = get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

        # Obtener abreviación de la compañía
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": "No se pudo obtener la abreviación de la compañía"}), 400

        # Obtener valuation_method de stock settings
        try:
            stock_response, stock_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Stock%20Settings/StockSettings",
                operation_name="Get stock settings valuation method"
            )

            if stock_error:
                default_valuation_method = "Moving Average"
            else:
                stock_data = stock_response.json().get("data", {})
                default_valuation_method = stock_data.get("valuation_method", "Moving Average")
        except Exception as e:
            print(f"Error obteniendo valuation_method: {e}")
            default_valuation_method = "Moving Average"

        print(f"📦 Items a importar: {len(items)}")
        print(f"🏢 Compañía: {company}")
        print(f"🏷️ Modo: {mode}")
        print(f"💰 Valuation Method: {default_valuation_method}")

        # Asegurar que existan los grupos de items necesarios
        print("--- Verificando grupos de items ---")
        groups_success = ensure_item_groups_for_import(items, session, headers, company, company_abbr)
        if not groups_success:
            return jsonify({"success": False, "message": "Error al verificar/crear grupos de items"}), 500
        print("--- Grupos de items verificados ---")

        # Asegurar que existan las marcas necesarias
        print("--- Verificando marcas de items ---")
        brands_success = ensure_brands_for_import(items, session, headers)
        if not brands_success:
            return jsonify({"success": False, "message": "Error al verificar/crear marcas de items"}), 500
        print("--- Marcas de items verificadas ---")

        # Crear CSV con los datos de items
        import io
        import csv

        output = io.StringIO()
        fieldnames = [
            "Item Code", "Item Name", "Description", "Item Group", "stock_uom", 
            "is_stock_item", "Brand", "custom_company", "valuation_method", "custom_product_links"
        ]

        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        processed_items = []
        for item in items:
            # Aplicar lógica de validaciones y transformaciones
            processed_item = _process_item_for_import(item, company_abbr, company, default_valuation_method)
            if processed_item:
                processed_items.append(processed_item)

        if not processed_items:
            return jsonify({"success": False, "message": "No hay items válidos para importar después de las validaciones"}), 400

        # Escribir items procesados al CSV
        for item in processed_items:
            writer.writerow(item)

        csv_data = output.getvalue()
        print(f"📄 CSV generado con {len(processed_items)} filas válidas")

        # Generar ID único para este proceso
        import uuid
        process_id = str(uuid.uuid4())

        # Inicializar progreso
        items_import_progress[process_id] = {
            "success": True,
            "progress": 0,
            "total": len(processed_items),
            "current_item": "Iniciando importación...",
            "message": f"Importando {len(processed_items)} items...",
            "status": "running"
        }

        # Iniciar procesamiento en un hilo separado
        import threading
        def process_import():
            try:
                _do_bulk_import_csv(session, headers, user_id, process_id, csv_data, mode)
            except Exception as e:
                print(f"Error en procesamiento de importación {process_id}: {e}")
                items_import_progress[process_id] = {
                    "success": False,
                    "progress": 0,
                    "total": len(processed_items),
                    "current_item": "Error en procesamiento",
                    "message": f"Error: {str(e)}",
                    "status": "error"
                }

        thread = threading.Thread(target=process_import)
        thread.daemon = True
        thread.start()

        # Devolver inmediatamente con el process_id
        return jsonify({
            "success": True,
            "process_id": process_id,
            "message": "Importación iniciada",
            "total_items": len(processed_items)
        })

    except Exception as e:
        print(f"Error en bulk_import_items: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@items_bp.route('/api/items/bulk-import-with-iva', methods=['POST'])
def bulk_import_items_with_iva():
    """
    Importa o actualiza items de manera masiva asignando el Item Tax Template (IVA) según la selección del usuario.
    Se espera un payload:
    {
        "items": [
            {
                "item_code": "...",
                "item_name": "...",
                "description": "...",
                "item_group": "...",
                "stock_uom": "...",
                "is_stock_item": 1,
                "iva_template": "IVA 21 MS Ventas - MS"
            }
        ]
    }
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        payload = request.get_json() or {}
        raw_items = payload.get('items') or []
        if not raw_items:
            return jsonify({"success": False, "message": "No se recibieron items para procesar"}), 400

        default_company = payload.get('company') or get_active_company(user_id)
        if not default_company:
            return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

        template_cache = {}
        abbr_cache = {}

        summary = {
            "created": [],
            "updated": [],
            "failed": []
        }

        def get_company_abbr_cached(company_name):
            if company_name not in abbr_cache:
                abbr_cache[company_name] = get_company_abbr(session, headers, company_name)
            return abbr_cache[company_name]

        def get_template_lookup_for_company(company_name):
            if company_name not in template_cache:
                template_cache[company_name] = _build_tax_template_lookup(session, headers, company_name)
            return template_cache[company_name]

        for idx, item in enumerate(raw_items, start=1):
            item_company = item.get('custom_company') or default_company
            try:
                company_abbr = get_company_abbr_cached(item_company)
            except Exception:
                company_abbr = None

            iva_rate = (item.get('iva_template') or '').strip()
            if not iva_rate:
                summary["failed"].append({
                    "index": idx,
                    "item_code": item.get("item_code"),
                    "message": "Falta seleccionar una tasa de IVA"
                })
                continue

            document, error_msg = _prepare_item_document(item, item_company, company_abbr)
            reference_code = item.get("item_code")
            if error_msg:
                summary["failed"].append({
                    "index": idx,
                    "item_code": reference_code,
                    "message": error_msg
                })
                continue

            template_lookup = get_template_lookup_for_company(item_company)
            taxes_rows = _build_item_taxes(iva_rate, template_lookup, item_company)
            if taxes_rows is None:
                summary["failed"].append({
                    "index": idx,
                    "item_code": reference_code,
                    "message": f"No se encontraron templates para la tasa de IVA '{iva_rate}%'"
                })
                continue

            # NO incluir taxes en el document inicial - se actualizarán después
            # document["taxes"] = taxes_rows

            existing_name, existing_data = _find_existing_item(session, headers, document["item_code"], company_abbr)
            item_name_for_taxes = None
            
            if existing_name:
                response, error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Item/{quote(existing_name)}",
                    data={"data": document},
                    operation_name=f"Bulk import IVA - Update Item {existing_name}"
                )
                if error or not response or response.status_code >= 400:
                    message = error.get('message') if error else (response.text if response else 'Error desconocido')
                    summary["failed"].append({
                        "index": idx,
                        "item_code": document["item_code"],
                        "message": f"Error actualizando item: {message}"
                    })
                else:
                    item_name_for_taxes = existing_name
                    summary["updated"].append(document["item_code"])
            else:
                response, error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Item",
                    data={"data": document},
                    operation_name=f"Bulk import IVA - Create Item {document['item_code']}"
                )
                if error or not response or response.status_code >= 400:
                    message = error.get('message') if error else (response.text if response else 'Error desconocido')
                    summary["failed"].append({
                        "index": idx,
                        "item_code": document["item_code"],
                        "message": f"Error creando item: {message}"
                    })
                else:
                    created_name = response.json().get('data', {}).get('name')
                    item_name_for_taxes = created_name
                    summary["created"].append(created_name or document["item_code"])
            
            # Actualizar taxes en una llamada separada (solo si el item se creó/actualizó correctamente)
            if item_name_for_taxes and taxes_rows:
                tax_response, tax_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Item/{quote(item_name_for_taxes)}",
                    data={"data": {"taxes": taxes_rows}},
                    operation_name=f"Bulk import IVA - Update Item Taxes {item_name_for_taxes}"
                )
                if tax_error or not tax_response or tax_response.status_code >= 400:
                    # Log del error pero no falla el item completo
                    tax_msg = tax_error.get('message') if tax_error else (tax_response.text if tax_response else 'Error desconocido')
                    print(f"--- Warning: Error actualizando taxes para {item_name_for_taxes}: {tax_msg}")

        created_count = len(summary["created"])
        updated_count = len(summary["updated"])
        failed_count = len(summary["failed"])
        message = f"Items creados: {created_count}, actualizados: {updated_count}"
        if failed_count:
            message += f", con errores en {failed_count} fila(s)"

        http_status = 200 if failed_count == 0 else 207
        return jsonify({
            "success": failed_count == 0,
            "message": message,
            "created": summary["created"],
            "updated": summary["updated"],
            "failed": summary["failed"]
        }), http_status

    except Exception as e:
        print(f"Error en bulk_import_items_with_iva: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def _process_item_for_import(item, company_abbr, company, default_valuation_method):
    """Procesar un item individual para importación, aplicando validaciones y transformaciones"""
    try:
        # Validaciones básicas
        if not item.get('item_code'):
            print(f"⚠️ Item sin SKU omitido: {item.get('item_name', 'N/A')}")
            return None

        if not item.get('item_name'):
            if item.get('description'):
                # Si hay descripción pero no nombre, usar descripción como nombre
                item['item_name'] = item['description']
                print(f"✓ Nombre asignado desde descripción: {item['item_name']}")
            else:
                print(f"⚠️ Item sin nombre ni descripción omitido: {item.get('item_code', 'N/A')}")
                return None

        # Solo validar item_group si existe (puede no estar presente en modo stock)
        # Si está presente, se validará más adelante

        if not item.get('stock_uom'):
            print(f"⚠️ Item sin UOM omitido: {item.get('item_code', 'N/A')}")
            return None

        # Verificar tipo (is_stock_item) - solo si está presente
        # En modo stock puede no estar presente ya que no se modifica
        if 'is_stock_item' in item and item.get('is_stock_item') is None:
            print(f"⚠️ Item sin tipo omitido: {item.get('item_code', 'N/A')}")
            return None

        # Aplicar abreviación de compañía
        item_code = item['item_code']
        item_name = item['item_name']
        
        # Solo procesar item_group si está presente
        item_group = None
        if item.get('item_group'):
            item_group = item['item_group'].strip().upper()  # Normalizar a mayúsculas

        if company_abbr:
            if f" - {company_abbr}" not in item_code:
                item_code = f"{item_code} - {company_abbr}"
            if item_group and f" - {company_abbr}" not in item_group:
                item_group = f"{item_group} - {company_abbr}"
            if f" - {company_abbr}" not in item_name:
                item_name = f"{item_name} - {company_abbr}"

        # Validar longitud máxima del nombre (140 caracteres)
        if len(item_name) > 140:
            print(f"⚠️ Nombre demasiado largo ({len(item_name)} caracteres, máximo 140): {item_name[:50]}...")
            return None

        # Preparar fila para CSV
        processed_item = {
            "Item Code": item_code,
            "Item Name": item_name,
            "Description": item.get('description', ''),
            "stock_uom": item['stock_uom'],
            "Brand": item.get('brand', '').strip().upper() if item.get('brand') else '',  # Normalizar marca a mayúsculas
            "custom_company": company,
            "valuation_method": item.get('valuation_method', default_valuation_method)
        }
        
        # Agregar item_group solo si está presente
        if item_group:
            processed_item["Item Group"] = item_group
        
        # Agregar is_stock_item solo si está presente en el item original
        if 'is_stock_item' in item:
            processed_item["is_stock_item"] = 1 if item.get('is_stock_item') else 0

        # Agregar custom_product_links si vienen platform/url o custom_product_links
        try:
            if item.get('custom_product_links'):
                cpl = item.get('custom_product_links')
                if isinstance(cpl, (list, dict)):
                    processed_item['custom_product_links'] = json.dumps(cpl)
                else:
                    processed_item['custom_product_links'] = str(cpl)
            else:
                platform = (item.get('platform') or '').strip()
                url = (item.get('url') or '').strip()
                if platform or url:
                    processed_item['custom_product_links'] = json.dumps([{"platform": platform, "url": url}])
        except Exception as exc:
            print(f"Warning: unable to process custom_product_links for item {item.get('item_code')}: {exc}")

        return processed_item

    except Exception as e:
        print(f"Error procesando item: {e}")
        return None


def _do_bulk_import_csv(session, headers, user_id, process_id, csv_data, mode):
    """Función interna que realiza la importación usando Data Import Tool"""

    print(f"🔍 [DEBUG] Iniciando _do_bulk_import_csv con process_id: {process_id}")

    # PASO 1: Subir el CSV como archivo
    print("🚀 Subiendo archivo CSV...")

    files = {
        'file': (f'items_import_{process_id}.csv', csv_data.encode('utf-8'), 'text/csv'),
        'is_private': (None, '0'),
        'folder': (None, 'Home')
    }

    # Crear headers sin Content-Type para multipart/form-data
    upload_headers = {k: v for k, v in headers.items() if k.lower() != 'content-type'}

    try:
        upload_response = session.post(
            f"{ERPNEXT_URL}/api/method/upload_file",
            files=files,
            headers=upload_headers
        )
        print(f"� Respuesta de ERPNext: {upload_response.status_code}")

        if upload_response.status_code >= 400:
            error_msg = f"Error HTTP {upload_response.status_code}"
            try:
                error_detail = upload_response.json()
                if 'message' in error_detail:
                    error_msg = error_detail['message']
                elif '_server_messages' in error_detail:
                    error_msg = "Error del servidor ERPNext"
            except:
                pass
            print(f"❌ Upload CSV File falló: {error_msg}")
            items_import_progress[process_id]["status"] = "error"
            items_import_progress[process_id]["message"] = f"Error subiendo archivo: {error_msg}"
            return

        print("✅ Upload CSV File completada exitosamente")
    except Exception as e:
        print(f"❌ Error de conexión en Upload CSV File: {e}")
        items_import_progress[process_id]["status"] = "error"
        items_import_progress[process_id]["message"] = f"Error de conexión subiendo archivo: {str(e)}"
        return

    upload_result = upload_response.json()
    message_data = upload_result.get('message', {})

    # El file_url puede estar en diferentes lugares según la versión
    file_url = message_data.get('file_url') or message_data.get('file_name')

    if not file_url:
        print(f"❌ No se pudo obtener file_url del upload: {upload_result}")
        items_import_progress[process_id]["status"] = "error"
        items_import_progress[process_id]["message"] = "Error: No se pudo obtener file_url del upload"
        return

    print(f"✅ Archivo subido: {file_url}")

    # PASO 2: Crear el Data Import con el archivo adjunto
    import_type = "Insert New Records" if mode == "insert" else "Update Existing Records"

    import_doc_data = {
        "reference_doctype": "Item",
        "import_type": import_type,
        "submit_after_import": 0,
        "import_file": file_url,
        "mute_emails": 1
    }

    print(f"🔍 [DEBUG] Creando Data Import con import_file: {file_url}")

    create_import_response, create_import_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Data Import",
        data={"data": import_doc_data},
        operation_name="Create Data Import Document"
    )

    if create_import_error:
        error_msg = create_import_error.get('message', 'Error creando Data Import document')
        print(f"❌ Error creando Data Import document: {error_msg}")
        items_import_progress[process_id]["status"] = "error"
        items_import_progress[process_id]["message"] = f"Error creando Data Import document: {error_msg}"
        return

    import_doc = create_import_response.json().get('data', {})
    import_name = import_doc.get('name')
    print(f"✅ Data Import document creado: {import_name}")

    payload_count = import_doc.get('payload_count', 0)
    print(f"🔍 [DEBUG] payload_count: {payload_count}")

    # PASO 3: Iniciar el import
    print("🚀 Iniciando Data Import...")

    import_response, import_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.core.doctype.data_import.data_import.form_start_import",
        data={"data_import": import_name},
        operation_name="Start Data Import"
    )

    if import_error:
        error_msg = import_error.get('message', 'Error en Data Import')
        print(f"❌ Error en Data Import: {error_msg}")
        items_import_progress[process_id]["status"] = "error"
        items_import_progress[process_id]["message"] = f"Error en Data Import: {error_msg}"
        return

    import_result = import_response.json()
    print(f"🔍 [DEBUG] import_result: {import_result}")

    message = import_result.get('message', '')
    print(f"✅ Data Import iniciado: {message}")

    # Actualizar progreso
    items_import_progress[process_id]["status"] = "completed"
    items_import_progress[process_id]["message"] = f"Importación de items iniciada exitosamente. Import ID: {import_name}"
    items_import_progress[process_id]["import_name"] = import_name
    items_import_progress[process_id]["saved"] = payload_count if payload_count > 0 else len(csv_data.split('\n')) - 1
    items_import_progress[process_id]["failed"] = 0

    print(f"✅ Bulk import de items completado con archivo subido")


@items_bp.route('/api/items/<item_code>', methods=['GET', 'OPTIONS'])
def get_item(item_code):
    """Obtener un item específico por su código"""
    print(f"--- Obteniendo item específico: {item_code} ---")

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener compañía del usuario para lógica de abreviaturas
        from routes.general import get_active_company
        company = get_active_company(user_id)
        company_abbr = None
        if company:
            company_abbr = get_company_abbr(session, headers, company)

        # Obtener parámetros de consulta
        fields_param = request.args.get('fields')

        # Parsear campos si se proporcionan
        fields = ["name", "item_name", "item_code", "item_group", "custom_company", "item_defaults", "valuation_rate", "description"]  # campos por defecto incluyendo item_defaults
        if fields_param:
            try:
                # Remover comillas y corchetes si vienen como string JSON
                if fields_param.startswith('[') and fields_param.endswith(']'):
                    fields = json.loads(fields_param)
                else:
                    fields = [f.strip() for f in fields_param.split(',')]
            except:
                # Si falla el parseo, usar campos por defecto
                pass

        # Convertir campos a string para URL
        fields_str = json.dumps(fields)

        # Lógica inteligente para buscar el item:
        # 1. Primero intentar con el código tal como viene (puede ya tener abbr correcta)
        # 2. Si no funciona y tenemos abbr, intentar agregándola
        # 3. Si no funciona y parece tener abbr, intentar removiendo la abbr

        search_codes = [item_code]  # Empezar con el código original

        if company_abbr:
            # Si no tiene abbr, agregar
            if f" - {company_abbr}" not in item_code:
                search_codes.append(f"{item_code} - {company_abbr}")
            # Si tiene abbr, intentar sin ella
            elif f" - {company_abbr}" in item_code:
                search_codes.append(remove_company_abbr(item_code, company_abbr))

        print(f"Buscando item con códigos: {search_codes}")

        item_data = None
        found_code = None

        for search_code in search_codes:
            print(f"Intentando buscar item: {search_code}")
            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Item/{quote(search_code)}",
                params={
                    "fields": fields_str
                },
                operation_name=f"Get specific item with code {search_code}"
            )

            if not error and response.status_code == 200:
                item_data = response.json()
                found_code = search_code
                print(f"Item encontrado con código: {found_code}")
                break
            else:
                print(f"Item {search_code} no encontrado: {response.status_code if response else 'No response'}")

        if not item_data:
            return jsonify({
                "success": False,
                "message": f"Item no encontrado con ninguno de los códigos probados: {search_codes}"
            }), 404

        print(f"--- Item obtenido: {found_code}")

        # Procesar el item encontrado para remover abbr en la respuesta
        item = item_data.get('data', {})
        if item.get('item_code') and company_abbr:
            item['erp_item_code'] = item['item_code']
            item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)
        if item.get('item_group') and company_abbr:
            item['item_group'] = remove_company_abbr(item['item_group'], company_abbr)

        return jsonify({
            "success": True,
            "data": item
        })

    except Exception as e:
        print(f"--- Error en get_item: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@items_bp.route('/api/items', methods=['GET', 'OPTIONS'])
def get_items():
    """Obtener lista de items con filtros opcionales"""
    print("--- Obteniendo items ---")

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener parámetros de consulta
        custom_company = request.args.get('custom_company')
        fields_param = request.args.get('fields')
        limit = request.args.get('limit', 1000, type=int)
        start = request.args.get('limit_start', 0, type=int)

        # Parsear campos si se proporcionan
        fields = ["name", "item_name", "item_group"]  # campos por defecto
        if fields_param:
            try:
                # Remover comillas y corchetes si vienen como string JSON
                if fields_param.startswith('[') and fields_param.endswith(']'):
                    import json
                    fields = json.loads(fields_param)
                else:
                    fields = [f.strip() for f in fields_param.split(',')]
            except:
                # Si falla el parseo, usar campos por defecto
                pass

        # Construir filtros
        filters = []
        if custom_company:
            filters.append(["custom_company", "=", custom_company])

        # Convertir campos a string para URL
        fields_str = json.dumps(fields)

        # Hacer petición a ERPNext usando query_items
        response, error = query_items(
            session=session,
            headers=headers,
            filters=filters,
            fields=fields,
            limit_page_length=limit,
            operation_name="Get items list"
        )

        if error:
            print(f"--- Error obteniendo items: {error}")
            return jsonify({
                "success": False,
                "message": f"Error obteniendo items: {error.get('status_code', 'Unknown')}"
            }), error.get('status_code', 500)

        data = response.json()
        items = data.get('data', [])

        print(f"--- Items obtenidos: {len(items)}")

        # Obtener compañía del usuario para remover abbr
        from routes.general import get_active_company
        company = get_active_company(user_id)
        
        # Remover sigla de compañía si existe
        if company:
            company_abbr = get_company_abbr(session, headers, company)
            if company_abbr:
                for item in items:
                    if item.get('item_code'):
                        item['erp_item_code'] = item['item_code']
                        item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)
                    if item.get('item_group'):
                        item['item_group'] = remove_company_abbr(item['item_group'], company_abbr)

        return jsonify({
            "success": True,
            "data": items,
            "total": len(items)
        })

    except Exception as e:
        print(f"--- Error en get_items: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def query_items(session, headers, filters, fields, limit_page_length=None, order_by=None, or_filters=None, include_child_tables=None, operation_name="Query Items"):
    """
    Función centralizada para consultar items de ERPNext con parámetros flexibles.
    
    Args:
        session: Sesión HTTP autenticada
        headers: Headers de autenticación
        filters: Lista de filtros principales
        fields: Lista de campos a consultar
        limit_page_length: Límite de resultados (opcional)
        order_by: Ordenamiento (opcional)
        or_filters: Filtros OR adicionales (opcional)
        include_child_tables: Tablas hijas a incluir (opcional)
        operation_name: Nombre de la operación para logging
    
    Returns:
        response, error: Tupla con respuesta y error
    """
    params = {
        "fields": json.dumps(fields),
        "filters": json.dumps(filters)
    }
    
    if limit_page_length:
        params["limit_page_length"] = limit_page_length
    if order_by:
        params["order_by"] = order_by
    if or_filters:
        params["or_filters"] = json.dumps(or_filters)
    if include_child_tables:
        params["include_child_tables"] = json.dumps(include_child_tables)
    
    return make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Item",
        operation_name=operation_name,
        params=params
    )


# =============================================================================
# RESOLUCIÓN DE ITEMS PENDIENTES (PEND-)
# =============================================================================

def ensure_single_brand_exists(brand_name, session, headers):
    """
    Verifica si una marca existe, y si no, la crea.
    Retorna True si la marca existe o fue creada exitosamente.
    """
    if not brand_name or not brand_name.strip():
        return True  # No hay marca que verificar
    
    brand_name = brand_name.strip().upper()
    print(f"--- Verificando marca: {brand_name}")
    
    try:
        # Verificar si existe
        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Brand",
            params={
                "filters": json.dumps([["name", "=", brand_name]]),
                "limit_page_length": 1
            },
            operation_name=f"Check brand {brand_name}"
        )
        
        if check_error:
            print(f"--- Error verificando marca: {check_error}")
            return False
        
        data = check_response.json().get("data", [])
        if data:
            print(f"--- Marca ya existe: {brand_name}")
            return True
        
        # Crear la marca
        print(f"--- Creando marca: {brand_name}")
        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Brand",
            data={"brand": brand_name},
            operation_name=f"Create brand {brand_name}"
        )
        
        if create_error:
            print(f"--- Error creando marca: {create_error}")
            return False
        
        print(f"--- Marca creada exitosamente: {brand_name}")
        return True
        
    except Exception as e:
        print(f"--- Error en ensure_single_brand_exists: {e}")
        return False


def ensure_single_item_group_exists(group_name, session, headers, company_abbr):
    """
    Verifica si un grupo de items existe (con abreviatura de empresa), y si no, lo crea.
    Retorna el nombre completo del grupo (con abreviatura) si existe o fue creado.
    """
    if not group_name or not group_name.strip():
        return None
    
    group_name = group_name.strip().upper()
    # Si ya tiene la abreviatura, usarlo tal cual
    if group_name.endswith(f" - {company_abbr}"):
        group_with_abbr = group_name
    else:
        group_with_abbr = f"{group_name} - {company_abbr}"
    
    print(f"--- Verificando grupo de items: {group_with_abbr}")
    
    try:
        # Verificar si existe
        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Group",
            params={
                "filters": json.dumps([["item_group_name", "=", group_with_abbr]]),
                "limit_page_length": 1
            },
            operation_name=f"Check item group {group_with_abbr}"
        )
        
        if check_error:
            print(f"--- Error verificando grupo: {check_error}")
            return None
        
        data = check_response.json().get("data", [])
        if data:
            print(f"--- Grupo ya existe: {group_with_abbr}")
            return group_with_abbr
        
        # Primero asegurar que existe el grupo raíz
        root_group_name = f"All Item Groups - {company_abbr}"
        root_check_response, root_check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Group",
            params={
                "filters": json.dumps([["item_group_name", "=", root_group_name]]),
                "limit_page_length": 1
            },
            operation_name=f"Check root item group {root_group_name}"
        )
        
        if root_check_error:
            print(f"--- Error verificando grupo raíz: {root_check_error}")
            return None
        
        root_data = root_check_response.json().get("data", [])
        if not root_data:
            # Crear el grupo raíz
            print(f"--- Creando grupo raíz: {root_group_name}")
            create_root_response, create_root_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Item Group",
                data={
                    "item_group_name": root_group_name,
                    "is_group": 1
                },
                operation_name=f"Create root item group {root_group_name}"
            )
            
            if create_root_error:
                print(f"--- Error creando grupo raíz: {create_root_error}")
                return None
            print(f"--- Grupo raíz creado: {root_group_name}")
        
        # Crear el grupo
        print(f"--- Creando grupo: {group_with_abbr}")
        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item Group",
            data={
                "item_group_name": group_with_abbr,
                "parent_item_group": root_group_name,
                "is_group": 0
            },
            operation_name=f"Create item group {group_with_abbr}"
        )
        
        if create_error:
            print(f"--- Error creando grupo: {create_error}")
            return None
        
        print(f"--- Grupo creado exitosamente: {group_with_abbr}")
        return group_with_abbr
        
    except Exception as e:
        print(f"--- Error en ensure_single_item_group_exists: {e}")
        return None


def is_pending_item(item_code):
    """
    Verifica si un item es un item pendiente de mapear.
    Los items pendientes tienen el formato: PEND-xxxxxxx - ABBR
    """
    if not item_code:
        return False
    return item_code.strip().upper().startswith('PEND-')


def get_pending_item_group_name(company_abbr):
    """
    Retorna el nombre del grupo de items pendientes para una compañía.
    """
    return f"PENDIENTES DE MAPEAR - {company_abbr}"


@items_bp.route('/api/pending-items/resolve', methods=['POST'])
def resolve_pending_item():
    """
    Resuelve un item pendiente (PEND-xxxxx) creando el item real.
    
    Payload:
    {
        "company": "Company Name",
        "pending_item_code": "PEND-XXXXX - ABBR",  // El código del item pendiente actual
        "mode": "service" | "stock",  // Modo de creación
        "item": {
            "item_code": "NEW-CODE",
            "item_name": "Nombre del item",
            "description": "Descripción",
            "item_group": "Categoría",
            "stock_uom": "Unidad",
            "brand": "Marca" (opcional),
            "is_stock_item": 0 | 1
        },
        "stock": {  // Solo si mode == "stock"
            "warehouse": "Warehouse Name",
            "qty": 10,
            "valuation_rate": 100.00
        }
    }
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "No se recibieron datos"}), 400
        
        company = data.get('company')
        pending_item_code = data.get('pending_item_code')
        mode = data.get('mode')  # 'service' or 'stock'
        item_data = data.get('item', {})
        stock_data = data.get('stock', {})
        
        if not company:
            return jsonify({"success": False, "message": "Company es requerido"}), 400
        if not pending_item_code:
            return jsonify({"success": False, "message": "pending_item_code es requerido"}), 400
        if not mode or mode not in ['service', 'stock']:
            return jsonify({"success": False, "message": "mode debe ser 'service' o 'stock'"}), 400
        if not item_data.get('item_code'):
            return jsonify({"success": False, "message": "item.item_code es requerido"}), 400
        if not item_data.get('item_name'):
            return jsonify({"success": False, "message": "item.item_name es requerido"}), 400
        if not item_data.get('item_group'):
            return jsonify({"success": False, "message": "item.item_group es requerido"}), 400
        
        print(f"--- Resolving pending item: {pending_item_code} -> {item_data.get('item_code')}")
        
        # Obtener abreviatura de la compañía
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": "No se pudo obtener la abreviatura de la compañía"}), 400
        
        # Preparar el nuevo código de item con la abreviatura
        new_item_code = item_data.get('item_code').strip()
        if not new_item_code.endswith(f" - {company_abbr}"):
            new_item_code = f"{new_item_code} - {company_abbr}"
        
        # ========== VERIFICAR/CREAR MARCA ==========
        brand = item_data.get('brand', '').strip()
        if brand:
            brand_ok = ensure_single_brand_exists(brand, session, headers)
            if not brand_ok:
                return jsonify({"success": False, "message": f"Error al verificar/crear la marca: {brand}"}), 500
        
        # ========== VERIFICAR/CREAR GRUPO DE ITEMS ==========
        item_group_input = item_data.get('item_group', '').strip()
        item_group = ensure_single_item_group_exists(item_group_input, session, headers, company_abbr)
        if not item_group:
            return jsonify({"success": False, "message": f"Error al verificar/crear el grupo de items: {item_group_input}"}), 500
        
        # Crear el nuevo item
        is_stock_item = 1 if mode == 'stock' else 0
        
        item_body = {
            "item_code": new_item_code,
            "item_name": item_data.get('item_name', '').strip(),
            "description": item_data.get('description', item_data.get('item_name', '')).strip(),
            "item_group": item_group,
            "stock_uom": item_data.get('stock_uom', 'Unidad'),
            "is_stock_item": is_stock_item,
            "custom_company": company,
            "docstatus": 0
        }
        
        # Agregar marca si se proporcionó
        if item_data.get('brand'):
            item_body['brand'] = item_data.get('brand')
        
        print(f"--- Creating new item: {new_item_code}")
        
        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item",
            data={"data": item_body},
            operation_name="Create resolved item"
        )
        
        if create_error:
            print(f"--- Error creating item: {create_error}")
            return jsonify({"success": False, "message": f"Error al crear el item: {create_error}"}), 500
        
        if create_response.status_code not in [200, 201]:
            error_msg = create_response.text
            print(f"--- Item creation failed: {error_msg}")
            return jsonify({"success": False, "message": f"Error al crear el item: {error_msg}"}), 500
        
        created_item = create_response.json().get('data', {})
        print(f"--- Item created: {created_item.get('name')}")
        
        # Si es modo stock, crear el Stock Entry para el ingreso inicial
        stock_entry_name = None
        if mode == 'stock':
            warehouse = stock_data.get('warehouse')
            qty = float(stock_data.get('qty', 0))
            valuation_rate = float(stock_data.get('valuation_rate', 0))
            
            if not warehouse:
                return jsonify({"success": False, "message": "warehouse es requerido para modo stock"}), 400
            if qty <= 0:
                return jsonify({"success": False, "message": "qty debe ser mayor a 0 para modo stock"}), 400
            if valuation_rate <= 0:
                return jsonify({"success": False, "message": "valuation_rate debe ser mayor a 0 para modo stock"}), 400
            
            print(f"--- Creating Stock Entry for initial stock: {qty} units @ {valuation_rate}")
            
            stock_entry_body = {
                "doctype": "Stock Entry",
                "stock_entry_type": "Material Receipt",
                "company": company,
                "items": [{
                    "item_code": new_item_code,
                    "qty": qty,
                    "basic_rate": valuation_rate,
                    "t_warehouse": warehouse
                }]
            }
            
            stock_response, stock_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Stock Entry",
                data={"data": stock_entry_body},
                operation_name="Create initial Stock Entry"
            )
            
            if stock_error:
                print(f"--- Warning: Stock Entry creation failed: {stock_error}")
                # No fallamos, el item ya fue creado
            elif stock_response.status_code in [200, 201]:
                stock_entry_data = stock_response.json().get('data', {})
                stock_entry_name = stock_entry_data.get('name')
                print(f"--- Stock Entry created: {stock_entry_name}")
                
                # Confirmar el Stock Entry
                submit_response, submit_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Stock Entry/{quote(stock_entry_name)}",
                    data={"data": {"docstatus": 1}},
                    operation_name="Submit Stock Entry"
                )
                
                if submit_error:
                    print(f"--- Warning: Could not submit Stock Entry: {submit_error}")
                else:
                    print(f"--- Stock Entry submitted successfully")
        
        # Ahora eliminar el item pendiente (primero cancelar si está submitted, luego delete)
        print(f"--- Deleting pending item: {pending_item_code}")
        
        # Verificar el estado actual del item pendiente
        pending_check_response, pending_check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item/{quote(pending_item_code)}",
            operation_name="Check pending item status"
        )
        
        if not pending_check_error and pending_check_response.status_code == 200:
            pending_item_data = pending_check_response.json().get('data', {})
            # Si el item existe, eliminarlo
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Item/{quote(pending_item_code)}",
                operation_name="Delete pending item"
            )
            
            if delete_error:
                print(f"--- Warning: Could not delete pending item: {delete_error}")
            else:
                print(f"--- Pending item deleted successfully")
        
        return jsonify({
            "success": True,
            "message": "Item resuelto correctamente",
            "data": {
                "item": created_item,
                "new_item_code": new_item_code,
                "old_item_code": pending_item_code,
                "mode": mode,
                "stock_entry": stock_entry_name
            }
        })
        
    except Exception as e:
        print(f"--- Error resolving pending item: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno: {str(e)}"}), 500
