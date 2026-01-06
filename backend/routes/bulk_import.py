from flask import Blueprint, request, jsonify
import json
import traceback
import datetime
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr

# Importar función para actualizar conteo de items
from routes.general import update_company_item_count

# Crear el blueprint para las rutas de importación masiva
bulk_import_bp = Blueprint('bulk_import', __name__)

@bulk_import_bp.route('/api/inventory/items/bulk-import', methods=['POST'])
def bulk_import_items():
    """Importar múltiples items de inventario a la vez"""
    print("\n--- Petición para importar items en masa ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        items_to_import = data.get('items', [])
        mode = data.get('mode', 'insert')  # 'insert' o 'update'

        if not items_to_import:
            return jsonify({"success": False, "message": "No se proporcionaron items para importar"}), 400

        print(f"Items a procesar: {len(items_to_import)}, Modo: {mode}")

        # Normalizar platform/url a custom_product_links para compatibilidad
        for item in items_to_import:
            try:
                if not item.get('custom_product_links'):
                    platform = (item.get('platform') or '').strip()
                    url = (item.get('url') or '').strip()
                    if platform or url:
                        item['custom_product_links'] = [{ 'platform': platform, 'url': url }]
            except Exception:
                # ignore mapping errors
                pass

        results = []
        imported_count = 0
        failed_count = 0
        processed_companies = set()  # Para rastrear compañías que tuvieron items importados exitosamente
        company_default_warehouse_cache = {}

        # Primero, detectar y crear marcas nuevas
        unique_brands = set()
        for item_data in items_to_import:
            if item_data.get('brand') and item_data['brand'].strip():
                unique_brands.add(item_data['brand'].strip())

        # Verificar qué marcas ya existen
        existing_brands = set()
        if unique_brands:
            try:
                # Obtener todas las marcas existentes
                brands_response, error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Brand",
                    operation_name="Fetch Brands",
                    params={"fields": '["name"]', "limit_page_length": 1000}
                )
                if error:
                    print(f"Error obteniendo marcas existentes: {error}")
                elif brands_response.status_code == 200:
                    brands_data = brands_response.json()
                    existing_brands = set(brand['name'] for brand in brands_data.get('data', []))
                    print(f"Marcas existentes encontradas: {len(existing_brands)}")
            except Exception as e:
                print(f"Error obteniendo marcas existentes: {e}")

        # Crear marcas nuevas
        new_brands = unique_brands - existing_brands
        if new_brands:
            print(f"Creando {len(new_brands)} marca(s) nueva(s): {', '.join(new_brands)}")

            for brand_name in new_brands:
                try:
                    brand_data = {
                        "doctype": "Brand",
                        "brand": brand_name,
                        "description": f"Marca creada automáticamente durante importación"
                    }

                    brand_response, error = make_erpnext_request(
                        session=session,
                        method="POST",
                        endpoint="/api/resource/Brand",
                        operation_name="Create Brand",
                        data={"data": brand_data}
                    )
                    if error:
                        print(f"Error creando marca '{brand_name}': {error}")
                    elif brand_response.status_code in [200, 201]:
                        print(f"✓ Marca '{brand_name}' creada exitosamente")
                    else:
                        print(f"⚠️ Error creando marca '{brand_name}': {brand_response.status_code}")

                except Exception as e:
                    print(f"Error creando marca '{brand_name}': {e}")

        # Segundo: detectar y crear item_groups nuevos
        unique_item_groups = set()
        for item_data in items_to_import:
            if item_data.get('item_group') and item_data['item_group'].strip():
                unique_item_groups.add(item_data['item_group'].strip())

        # Verificar qué item_groups ya existen para la compañía
        existing_item_groups = set()
        company_for_groups = None

        # Obtener la compañía del primer item que la tenga
        for item_data in items_to_import:
            company_for_groups = item_data.get('custom_company') or item_data.get('company')
            if company_for_groups:
                break

        if unique_item_groups and company_for_groups:
            try:
                # Obtener item_groups existentes filtrados por compañía específica
                groups_response, error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Item Group",
                    operation_name="Fetch Item Groups",
                    params={
                        "fields": '["name", "item_group_name", "custom_company"]',
                        "filters": f'[["custom_company", "=", "{company_for_groups}"]]',
                        "limit_page_length": 1000
                    }
                )
                if error:
                    print(f"Error obteniendo grupos de items existentes: {error}")
                elif groups_response.status_code == 200:
                    groups_data = groups_response.json()
                    existing_item_groups = set(group['item_group_name'] for group in groups_data.get('data', []))
                    print(f"Grupos de items existentes para compañía '{company_for_groups}': {len(existing_item_groups)}")
            except Exception as e:
                print(f"Error obteniendo grupos de items existentes: {e}")

        # Crear item_groups nuevos con sigla de compañía
        new_item_groups = unique_item_groups - existing_item_groups
        if new_item_groups:
            print(f"Creando {len(new_item_groups)} grupo(s) de item(s) nuevo(s) para compañía '{company_for_groups}': {', '.join(new_item_groups)}")

            for group_name in new_item_groups:
                try:
                    # Obtener sigla de la compañía desde ERPNext
                    company_abbr = get_company_abbr(session, headers, company_for_groups)
                    if not company_abbr:
                        print(f"⚠️ No se pudo obtener sigla para compañía '{company_for_groups}', omitiendo grupo '{group_name}'")
                        continue

                    # Crear nombre con sigla de compañía para evitar conflictos
                    full_group_name = f"{group_name} - {company_abbr}"

                    group_data = {
                        "item_group_name": full_group_name,
                        "parent_item_group": "All Item Groups",
                        "is_group": 0,
                        "custom_company": company_for_groups
                    }

                    group_response, error = make_erpnext_request(
                        session=session,
                        method="POST",
                        endpoint="/api/resource/Item Group",
                        operation_name="Create Item Group",
                        data={"data": group_data}
                    )
                    if error:
                        print(f"Error creando grupo '{full_group_name}': {error}")
                        continue
                    elif group_response.status_code in [200, 201]:
                        created_group = group_response.json().get('data', {})
                        print(f"✓ Grupo '{full_group_name}' creado exitosamente")

                        # Actualizar el item_data para usar el nombre completo del grupo
                        for item_data in items_to_import:
                            if item_data.get('item_group') == group_name:
                                item_data['item_group'] = full_group_name
                    else:
                        # If duplicate (409), try to fetch the existing group and normalize
                        if group_response.status_code == 409:
                            print(f"⚠️ Duplicate when creating grupo '{full_group_name}' (409). Intentando obtener el grupo existente...")
                            try:
                                # First try exact match by item_group_name
                                fetch_resp, error = make_erpnext_request(
                                    session=session,
                                    method="GET",
                                    endpoint="/api/resource/Item%20Group",
                                    operation_name="Fetch Item Group Exact Match",
                                    params={
                                        "fields": '["name","item_group_name","custom_company"]',
                                        "filters": f'[ ["item_group_name","=","{full_group_name}"], ["custom_company","=","{company_for_groups}"] ]',
                                        "limit_page_length": 1
                                    }
                                )
                                if error:
                                    print(f"Error consultando grupo existente tras 409 para '{full_group_name}': {error}")
                                elif fetch_resp.status_code == 200:
                                    fetch_data = fetch_resp.json().get('data', [])
                                    if fetch_data:
                                        existing = fetch_data[0]
                                        canonical_name = existing.get('name') or existing.get('item_group_name')
                                        print(f"✓ Grupo existente encontrado por nombre exacto: {canonical_name}")
                                        for item_data in items_to_import:
                                            if item_data.get('item_group') == group_name:
                                                item_data['item_group'] = canonical_name
                                        continue

                                # If not found by exact, try a looser search: item_group_name startswith group_name
                                fetch_resp2, error = make_erpnext_request(
                                    session=session,
                                    method="GET",
                                    endpoint="/api/resource/Item%20Group",
                                    operation_name="Fetch Item Group Loose Match",
                                    params={
                                        "fields": '["name","item_group_name","custom_company"]',
                                        "filters": f'[ ["item_group_name","like","{group_name}%"], ["custom_company","=","{company_for_groups}"] ]',
                                        "limit_page_length": 50
                                    }
                                )
                                if error:
                                    print(f"Error consultando grupo existente tras 409 para '{full_group_name}': {error}")
                                elif fetch_resp2.status_code == 200:
                                    candidates = fetch_resp2.json().get('data', [])
                                    # pick candidate where base matches (before ' - ')
                                    selected = None
                                    for c in candidates:
                                        ig = (c.get('item_group_name') or c.get('name') or '')
                                        base = ig.split(' - ')[0].strip().lower()
                                        if base == group_name.strip().lower():
                                            selected = c
                                            break
                                    if not selected and candidates:
                                        selected = candidates[0]

                                    if selected:
                                        canonical_name = selected.get('name') or selected.get('item_group_name')
                                        print(f"✓ Grupo existente encontrado por búsqueda: {canonical_name}")
                                        for item_data in items_to_import:
                                            if item_data.get('item_group') == group_name:
                                                item_data['item_group'] = canonical_name
                                        continue

                                print(f"⚠️ No se pudo localizar el grupo existente para '{full_group_name}' tras 409; items seguirán con '{group_name}' y podrán fallar al crear.")
                            except Exception as fetch_e:
                                print(f"Error consultando grupo existente tras 409 para '{full_group_name}': {fetch_e}")
                        else:
                            print(f"⚠️ Error creando grupo '{full_group_name}': {group_response.status_code} - {group_response.text}")

                except Exception as e:
                    print(f"Error creando grupo '{group_name}': {e}")

        # Procesar cada item
        for idx, item_data in enumerate(items_to_import):
            # Inicializar variables para este item
            opening_stock_to_reconcile = None
            valuation_rate_to_reconcile = None

            try:
                # Validar datos requeridos
                if not item_data.get('item_code'):
                    results.append({
                        "index": idx + 1,
                        "item_code": item_data.get('item_code', 'N/A'),
                        "success": False,
                        "error": "Código de item requerido"
                    })
                    failed_count += 1
                    continue

                if not item_data.get('item_name'):
                    results.append({
                        "index": idx + 1,
                        "item_code": item_data.get('item_code', 'N/A'),
                        "success": False,
                        "error": "Nombre de item requerido"
                    })
                    failed_count += 1
                    continue

                # Construir el objeto del item
                is_stock_item = item_data.get('is_stock_item', 0)

                # Agregar sigla de compañía al item_code si no la tiene ya
                original_item_code = item_data.get('item_code')
                company = item_data.get('custom_company') or item_data.get('company')
                if company and original_item_code:
                    # Obtener sigla de la compañía desde ERPNext
                    company_abbr = get_company_abbr(session, headers, company)
                    if company_abbr and f" - {company_abbr}" not in original_item_code:
                        final_item_code = f"{original_item_code} - {company_abbr}"
                    else:
                        final_item_code = original_item_code
                else:
                    final_item_code = original_item_code

                # Agregar sigla de compañía al item_group si no la tiene ya
                original_item_group = item_data.get('item_group', 'Services')
                final_item_group = original_item_group
                if company and company_abbr and original_item_group and f" - {company_abbr}" not in original_item_group:
                    final_item_group = f"{original_item_group} - {company_abbr}"

                item_body = {
                    "item_code": final_item_code,
                    "item_name": item_data.get('item_name'),
                    "item_group": final_item_group,
                    "stock_uom": item_data.get('stock_uom', 'Unit'),
                    "is_stock_item": is_stock_item,
                    "description": item_data.get('description', ''),
                    "standard_rate": item_data.get('standard_rate', 0),
                    "valuation_rate": item_data.get('valuation_rate', 0),
                    # Campos adicionales
                    "is_sales_item": item_data.get('is_sales_item', 1),
                    "is_purchase_item": item_data.get('is_purchase_item', 1),
                    "grant_commission": item_data.get('grant_commission', 0),
                    "min_order_qty": item_data.get('min_order_qty', 0),
                    "safety_stock": item_data.get('safety_stock', 0),
                    "lead_time_days": item_data.get('lead_time_days', 0),
                    "max_discount": item_data.get('max_discount', 0),
                }

                # Todos los items quedan en borrador inicialmente
                item_body["docstatus"] = 0
                item_body["allow_negative_stock"] = 1  # Permitir stock negativo para todos

                # Campos custom
                item_body["custom_description_type"] = item_data.get('custom_description_type', 'Plain Text')
                
                # Asignar tax templates si se proporciona iva_template
                iva_template = item_data.get('iva_template')
                if iva_template:
                    item_body["item_tax_template"] = iva_template
                    item_body["purchase_item_tax_template"] = iva_template  # Asumir mismo template para ventas y compras
                
                # custom_product_links se actualiza después para todos los items

                # Agregar campos opcionales si tienen valor
                opening_stock_value = item_data.get('opening_stock')
                if opening_stock_value is not None and opening_stock_value > 0:
                    # ERPNext requiere valuation_rate cuando hay opening_stock
                    # Usar valuation_rate si existe, sino standard_rate como fallback
                    valuation_rate = item_data.get('valuation_rate', 0)
                    standard_rate = item_data.get('standard_rate', 0)

                    if valuation_rate > 0:
                        item_body['valuation_rate'] = valuation_rate
                        item_body['opening_stock'] = opening_stock_value
                        print(f"✓ Item {final_item_code}: opening_stock={opening_stock_value} con valuation_rate={valuation_rate}")
                    elif standard_rate > 0:
                        item_body['valuation_rate'] = standard_rate
                        item_body['opening_stock'] = opening_stock_value
                        print(f"✓ Item {final_item_code}: opening_stock={opening_stock_value} usando standard_rate={standard_rate} como valuation_rate")
                    else:
                        print(f"⚠️ Item {final_item_code}: opening_stock omitido (no hay valuation_rate ni standard_rate válido)")

                if item_data.get('brand'):
                    item_body['brand'] = item_data.get('brand')

                if item_data.get('category'):
                    item_body['custom_category'] = item_data.get('category')

                # Agregar configuraciones por defecto si se proporcionaron
                company = item_data.get('custom_company') or item_data.get('company')
                if company:
                    item_body['custom_company'] = company

                # Configurar item_defaults si hay opening_stock, cuentas específicas o default_warehouse
                needs_defaults = bool(item_data.get('expense_account') or item_data.get('income_account') or item_data.get('default_warehouse'))
                has_opening_stock = item_data.get('opening_stock') and item_data.get('opening_stock') > 0

                if needs_defaults or has_opening_stock:
                    # Determinar el almacén por defecto
                    default_warehouse = item_data.get('default_warehouse', '')

                    # Si hay opening_stock, intentar usar primero el almacén por defecto de la compañía
                    if has_opening_stock and not default_warehouse and company:
                        cached_default = company_default_warehouse_cache.get(company)
                        if cached_default is None:
                            try:
                                company_response, company_error = make_erpnext_request(
                                    session=session,
                                    method="GET",
                                    endpoint=f"/api/resource/Company/{quote(company)}",
                                    params={"fields": json.dumps(["custom_default_warehouse"])}
                                )
                                if company_error:
                                    print(f"⚠ Error obteniendo almacén por defecto de compañía {company}: {company_error}")
                                    cached_default = ''
                                elif company_response and company_response.status_code == 200:
                                    cached_default = company_response.json().get('data', {}).get('custom_default_warehouse', '')
                                else:
                                    cached_default = ''
                            except Exception as wh_error:
                                print(f"⚠ Error consultando almacén por defecto de compañía {company}: {wh_error}")
                                cached_default = ''
                            company_default_warehouse_cache[company] = cached_default
                        default_warehouse = cached_default or default_warehouse

                    # Si hay opening_stock pero no hay almacén especificado, intentar usar el primer almacén de la lista
                    if has_opening_stock and not default_warehouse and item_data.get('warehouses'):
                        warehouses_list = item_data.get('warehouses', [])
                        if isinstance(warehouses_list, list) and len(warehouses_list) > 0:
                            default_warehouse = warehouses_list[0]
                            print(f"✓ Item {final_item_code}: Usando primer almacén de la lista como default_warehouse: {default_warehouse}")

                    # Si aún no hay almacén y hay opening_stock, buscar un almacén por defecto de la compañía
                    if has_opening_stock and not default_warehouse and company:
                        try:
                            # Buscar almacenes de la compañía
                            warehouse_response, error = make_erpnext_request(
                                session=session,
                                method="GET",
                                endpoint="/api/resource/Warehouse",
                                operation_name="Fetch Company Warehouses",
                                params={
                                    "fields": '["name", "warehouse_name"]',
                                    "filters": f'[["company", "=", "{company}"], ["is_group", "=", 0]]',
                                    "limit_page_length": 1
                                }
                            )
                            if error:
                                print(f"⚠ Error obteniendo almacén por defecto para {final_item_code}: {error}")
                            elif warehouse_response.status_code == 200:
                                warehouses_data = warehouse_response.json()
                                if warehouses_data.get('data') and len(warehouses_data['data']) > 0:
                                    default_warehouse = warehouses_data['data'][0]['name']
                                    print(f"✓ Item {final_item_code}: Usando almacén por defecto de compañía: {default_warehouse}")
                        except Exception as wh_error:
                            print(f"⚠ Error obteniendo almacén por defecto para {final_item_code}: {wh_error}")

                    item_body['item_defaults'] = [{
                        "company": company,
                        "default_warehouse": default_warehouse,
                        "expense_account": item_data.get('expense_account', ''),
                        "income_account": item_data.get('income_account', ''),
                    }]

                # Verificar si el item existe (para modo update)
                item_exists = False
                existing_item_data = None
                if mode == 'update':
                    check_response, error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Item/{quote(final_item_code)}",
                        operation_name="Check Item Exists"
                    )
                    if error:
                        print(f"Error verificando existencia del item {final_item_code}: {error}")
                    elif check_response.status_code == 200:
                        item_exists = True
                        existing_item_data = check_response.json().get('data', {})

                # Crear o actualizar el item
                if mode == 'update' and item_exists:
                    # Para actualizaciones, excluir campos que no se pueden cambiar después de submit
                    update_body = item_body.copy()

                    # No intentar cambiar item_group si el item ya existe
                    if 'item_group' in update_body and existing_item_data:
                        current_item_group = existing_item_data.get('item_group')
                        new_item_group = update_body.get('item_group')
                        if current_item_group and new_item_group and current_item_group != new_item_group:
                            print(f"⚠️ Item {final_item_code}: No se puede cambiar item_group de '{current_item_group}' a '{new_item_group}'. Manteniendo valor actual.")
                            del update_body['item_group']

                    # Manejar opening_stock para items existentes
                    if 'opening_stock' in update_body and existing_item_data:
                        current_docstatus = existing_item_data.get('docstatus', 0)
                        if current_docstatus == 1:  # Item ya está submitted
                            opening_stock_to_reconcile = update_body['opening_stock']
                            valuation_rate_to_reconcile = update_body.get('valuation_rate', 0)
                            print(f"✓ Item {final_item_code}: Item ya está submitted. Se creará Stock Reconciliation para ajustar stock a {opening_stock_to_reconcile}")
                            del update_body['opening_stock']
                            # También remover valuation_rate si solo se usaba para opening_stock
                            if 'valuation_rate' in update_body and update_body.get('valuation_rate') == item_data.get('valuation_rate'):
                                del update_body['valuation_rate']

                    # Actualizar item existente
                    response, error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/Item/{quote(final_item_code)}",
                        operation_name="Update Item",
                        data={"data": update_body}
                    )
                    if error:
                        print(f"Error actualizando item {final_item_code}: {error}")
                        response = None  # Para evitar errores en el código siguiente
                    action = "actualizado"
                else:
                    # Crear nuevo item
                    response, error = make_erpnext_request(
                        session=session,
                        method="POST",
                        endpoint="/api/resource/Item",
                        operation_name="Create Item",
                        data={"data": item_body}
                    )
                    if error:
                        print(f"Error creando item {final_item_code}: {error}")
                        response = None  # Para evitar errores en el código siguiente
                    action = "creado"

                if response and response.status_code in [200, 201]:
                    created_item = response.json().get('data', {})

                    # Crear Stock Reconciliation si se necesita ajustar opening_stock en item existente
                    if opening_stock_to_reconcile is not None and mode == 'update':
                        try:
                            # Determinar el almacén para el Stock Reconciliation
                            default_warehouse = item_data.get('default_warehouse', '')
                            if not default_warehouse and created_item.get('item_defaults'):
                                # Usar el default_warehouse del item si existe
                                item_defaults = created_item.get('item_defaults', [])
                                if isinstance(item_defaults, list) and len(item_defaults) > 0:
                                    default_warehouse = item_defaults[0].get('default_warehouse', '')

                            if not default_warehouse:
                                # Buscar un almacén por defecto de la compañía
                                company = item_data.get('custom_company') or item_data.get('company')
                                if company:
                                    warehouse_response, error = make_erpnext_request(
                                        session=session,
                                        method="GET",
                                        endpoint="/api/resource/Warehouse",
                                        operation_name="Fetch Default Warehouse",
                                        params={
                                            "fields": '["name"]',
                                            "filters": f'[["company", "=", "{company}"], ["is_group", "=", 0]]',
                                            "limit_page_length": 1
                                        }
                                    )
                                    if error:
                                        print(f"Error obteniendo almacén por defecto para Stock Reconciliation de {final_item_code}: {error}")
                                    elif warehouse_response.status_code == 200:
                                        warehouses_data = warehouse_response.json()
                                        if warehouses_data.get('data') and len(warehouses_data['data']) > 0:
                                            default_warehouse = warehouses_data['data'][0]['name']

                            if default_warehouse:
                                # Crear Stock Reconciliation
                                reconciliation_body = {
                                    "posting_date": datetime.datetime.now().strftime("%Y-%m-%d"),
                                    "posting_time": datetime.datetime.now().strftime("%H:%M:%S"),
                                    "purpose": "Opening Stock",
                                    "company": item_data.get('custom_company') or item_data.get('company'),
                                    "items": [{
                                        "item_code": final_item_code,
                                        "warehouse": default_warehouse,
                                        "qty": opening_stock_to_reconcile,
                                        "valuation_rate": 0  # Se calculará automáticamente
                                    }]
                                }

                                # Debug: mostrar tipos y valores antes de enviar
                                try:
                                    print(f"DEBUG OpeningStock payload built for {final_item_code}")
                                    print(f"DEBUG opening_stock types: qty type={type(opening_stock_to_reconcile)}, value={repr(opening_stock_to_reconcile)}")
                                    print(f"DEBUG reconciliation_body summary: company={reconciliation_body.get('company')}, warehouse={default_warehouse}")
                                except Exception:
                                    pass

                                reco_response, error = make_erpnext_request(
                                    session=session,
                                    method="POST",
                                    endpoint="/api/resource/Stock Reconciliation",
                                    operation_name="Create Stock Reconciliation",
                                    data={"data": reconciliation_body}
                                )
                                if error:
                                    print(f"Error enviando Stock Reconciliation (OpeningStock) para {final_item_code}: {error}")
                                    results.append({
                                        "index": idx + 1,
                                        "item_code": final_item_code,
                                        "success": False,
                                        "error": f"Exception al llamar a ERPNext: {str(error)}"
                                    })
                                    failed_count += 1
                                    # continuar con el siguiente item
                                    continue

                                if reco_response.status_code in [200, 201]:
                                    reco_data = reco_response.json().get('data', {})
                                    reco_name = reco_data.get('name')
                                    print(f"✓ Stock Reconciliation creado: {reco_name} para item {final_item_code}")

                                    # Si hay campos adicionales (cost_center, valuation_rate, posting_date) intentar actualizar el documento
                                    try:
                                        update_body = {}
                                        # Always set posting_date/time: prefer supplied values, otherwise use now
                                        update_body['posting_date'] = item_data.get('posting_date') or datetime.datetime.now().strftime("%Y-%m-%d")
                                        update_body['posting_time'] = item_data.get('posting_time') or datetime.datetime.now().strftime("%H:%M:%S")
                                        if item_data.get('cost_center'):
                                            update_body['cost_center'] = item_data.get('cost_center')

                                        # Build items update and ensure valuation_rate exists (fetch from Item if necessary)
                                        item_updates = []
                                        if opening_stock_to_reconcile is not None:
                                            item_update = {
                                                'item_code': final_item_code,
                                                'warehouse': default_warehouse,
                                                'qty': opening_stock_to_reconcile
                                            }
                                            # prefer explicit valuation_rate_to_reconcile if present
                                            vr = None
                                            if 'valuation_rate_to_reconcile' in locals():
                                                vr = locals().get('valuation_rate_to_reconcile')
                                            if not vr:
                                                vr = item_data.get('valuation_rate')
                                            if not vr:
                                                try:
                                                    item_resp, error = make_erpnext_request(
                                                        session=session,
                                                        method="GET",
                                                        endpoint=f"/api/resource/Item/{quote(final_item_code)}",
                                                        operation_name="Fetch Item Valuation Rate"
                                                    )
                                                    if error:
                                                        print(f"Error obteniendo valuation_rate para {final_item_code}: {error}")
                                                    elif item_resp.status_code == 200:
                                                        item_obj = item_resp.json().get('data', {})
                                                        vr = item_obj.get('valuation_rate') or item_obj.get('standard_rate')
                                                except Exception:
                                                    vr = None

                                            if vr is not None:
                                                item_update['valuation_rate'] = vr

                                            item_updates.append(item_update)

                                        if item_updates:
                                            update_body['items'] = item_updates

                                        # Always attempt to update the reconciliation to apply valuation_rate/cost_center/posting info
                                        if reco_name:
                                            print(f"-> Actualizando Stock Reconciliation {reco_name} con: {json.dumps(update_body)}")
                                            upd_resp, error = make_erpnext_request(
                                                session=session,
                                                method="PUT",
                                                endpoint=f"/api/resource/Stock Reconciliation/{quote(reco_name)}",
                                                operation_name="Update Stock Reconciliation",
                                                data={"data": update_body}
                                            )
                                            if error:
                                                print(f"⚠️ Error actualizando Stock Reconciliation {reco_name}: {error}")
                                            elif upd_resp.status_code in [200, 201]:
                                                print(f"✓ Stock Reconciliation {reco_name} actualizado correctamente")
                                            else:
                                                print(f"⚠️ Error actualizando Stock Reconciliation {reco_name}: {upd_resp.status_code} - {upd_resp.text}")
                                    except Exception as upd_exc:
                                        print(f"Error actualizando Stock Reconciliation {reco_name}: {upd_exc}")
                                        print(traceback.format_exc())
                                else:
                                    print(f"⚠️ Error creando Stock Reconciliation para {final_item_code}: {reco_response.status_code} - {reco_response.text}")
                            else:
                                print(f"⚠️ No se pudo determinar almacén para Stock Reconciliation de {final_item_code}")

                        except Exception as reco_error:
                            print(f"⚠️ Error creando Stock Reconciliation para {final_item_code}: {reco_error}")

                    # Si el item recién creado tiene custom_product_links, actualizar después
                    custom_product_links = item_data.get('custom_product_links')
                    if custom_product_links and len(custom_product_links) > 0:
                        try:
                            update_response, error = make_erpnext_request(
                                session=session,
                                method="PUT",
                                endpoint=f"/api/resource/Item/{created_item.get('name')}",
                                operation_name="Update Item Product Links",
                                data={"data": {"custom_product_links": json.dumps(custom_product_links)}}
                            )
                            if error:
                                print(f"Error actualizando custom_product_links: {error}")
                            elif update_response.status_code == 200:
                                print(f"custom_product_links actualizado para {created_item.get('name')}")
                                # Actualizar el item retornado
                                created_item['custom_product_links'] = custom_product_links
                            else:
                                print(f"Error actualizando custom_product_links: {update_response.status_code}")
                        except Exception as update_error:
                            print(f"Error actualizando custom_product_links: {update_error}")

                    results.append({
                        "index": idx + 1,
                        "item_code": final_item_code,
                        "success": True,
                        "item_name": created_item.get('name'),
                        "action": action
                    })
                    imported_count += 1
                    # Agregar la compañía al conjunto de compañías procesadas
                    if company:
                        processed_companies.add(company)
                    print(f"✓ Item {idx + 1} {action}: {final_item_code}")
                else:
                    if response:
                        error_text = response.text
                        # Intentar extraer mensaje de error más específico
                        try:
                            error_json = response.json()
                            error_message = error_json.get('exception', error_json.get('_error_message', error_text))
                        except:
                            error_message = error_text
                    else:
                        error_message = "Error desconocido en la creación/actualización del item"

                    results.append({
                        "index": idx + 1,
                        "item_code": final_item_code,
                        "success": False,
                        "error": f"Error al crear item: {error_message[:100]}"
                    })
                    failed_count += 1
                    print(f"✗ Item {idx + 1} falló: {error_message[:100]}")

            except Exception as item_error:
                results.append({
                    "index": idx + 1,
                    "item_code": final_item_code if 'final_item_code' in locals() else item_data.get('item_code', 'N/A'),
                    "success": False,
                    "error": str(item_error)
                })
                failed_count += 1
                print(f"✗ Item {idx + 1} error: {item_error}")

        print(f"\n--- Resumen de importación ---")
        print(f"Total: {len(items_to_import)}")
        print(f"Exitosos: {imported_count}")
        print(f"Fallidos: {failed_count}")

        # Actualizar el conteo de items para todas las compañías que tuvieron items importados
        for company in processed_companies:
            update_company_item_count(company)

        return jsonify({
            "success": True,
            "imported": imported_count,
            "failed": failed_count,
            "total": len(items_to_import),
            "results": results
        })

    except Exception as e:
        print(f"Error en bulk_import_items: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500