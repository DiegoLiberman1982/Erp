import traceback
from flask import Blueprint, request, jsonify
import requests
import json
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar función para obtener sigla de compañía
from routes.general import remove_company_abbr

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr

# Importar función para actualizar conteo de items de compañía
from routes.general import update_company_item_count

# Importar función para obtener conteo de items de compañía
from routes.general import get_company_item_count

# Importar función para obtener límite inteligente
from routes.general import get_smart_limit

# Importar función para obtener stock
# Use fetch_bin_stock from inventory and centralized IVA helper from inventory_utils
from routes.inventory import fetch_bin_stock
from routes.inventory_utils import fetch_item_iva_rates_bulk as _fetch_item_iva_rates_bulk

# Crear el blueprint para las rutas de bulk update
bulk_update_bp = Blueprint('bulk_update', __name__)


@bulk_update_bp.route('/api/inventory/items/bulk-update-with-defaults', methods=['POST'])
def bulk_update_items_with_defaults():
    """Actualizar múltiples items con sus configuraciones por defecto desde CSV"""
    print("\n--- Petición para actualizar items con defaults en masa ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        items_to_update = data.get('items', [])

        if not items_to_update:
            return jsonify({"success": False, "message": "No se proporcionaron items para actualizar"}), 400

        print(f"Items a actualizar: {len(items_to_update)}")

        results = []
        updated_count = 0
        failed_count = 0
        processed_companies = set()

        # NOTA: En modo "update-with-defaults" NO se crean marcas ni grupos nuevos
        # Solo se actualizan los defaults de items existentes

        # Procesar cada item para actualizar
        for idx, item_data in enumerate(items_to_update):
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

                # Construir el código completo del item con sigla de compañía
                original_item_code = item_data.get('item_code')
                company = item_data.get('custom_company') or item_data.get('company')

                if company and original_item_code:
                    company_abbr = get_company_abbr(session, headers, company)
                    if company_abbr and f" - {company_abbr}" not in original_item_code:
                        final_item_code = f"{original_item_code} - {company_abbr}"
                    else:
                        final_item_code = original_item_code
                else:
                    final_item_code = original_item_code

                # Verificar que el item existe
                check_resp, check_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Item/{quote(final_item_code)}",
                    operation_name=f"Check item exists {final_item_code}"
                )

                if check_error:
                    results.append({
                        "index": idx + 1,
                        "item_code": final_item_code,
                        "success": False,
                        "error": f"Item no encontrado: {check_error}"
                    })
                    failed_count += 1
                    continue

                if check_resp.status_code != 200:
                    results.append({
                        "index": idx + 1,
                        "item_code": final_item_code,
                        "success": False,
                        "error": f"Item no encontrado: {check_resp.status_code}"
                    })
                    failed_count += 1
                    continue

                existing_item = check_resp.json().get('data', {})
                print(f"✓ Item encontrado: {final_item_code}")

                # Construir el objeto de actualización para el Item
                update_body = {}

                # Campos básicos del Item
                if 'item_name' in item_data:
                    update_body['item_name'] = item_data['item_name']
                if 'description' in item_data:
                    update_body['description'] = item_data['description']
                if 'standard_rate' in item_data:
                    update_body['standard_rate'] = item_data['standard_rate']
                if 'valuation_rate' in item_data:
                    update_body['valuation_rate'] = item_data['valuation_rate']
                if 'is_stock_item' in item_data:
                    update_body['is_stock_item'] = item_data['is_stock_item']
                if 'stock_uom' in item_data:
                    update_body['stock_uom'] = item_data['stock_uom']

                # Campos adicionales de ventas/compras
                if 'is_sales_item' in item_data:
                    update_body['is_sales_item'] = item_data['is_sales_item']
                if 'is_purchase_item' in item_data:
                    update_body['is_purchase_item'] = item_data['is_purchase_item']
                if 'grant_commission' in item_data:
                    update_body['grant_commission'] = item_data['grant_commission']
                if 'min_order_qty' in item_data:
                    update_body['min_order_qty'] = item_data['min_order_qty']
                if 'safety_stock' in item_data:
                    update_body['safety_stock'] = item_data['safety_stock']
                if 'lead_time_days' in item_data:
                    update_body['lead_time_days'] = item_data['lead_time_days']
                if 'max_discount' in item_data:
                    update_body['max_discount'] = item_data['max_discount']

                # Campos custom
                if 'custom_description_type' in item_data:
                    update_body['custom_description_type'] = item_data['custom_description_type']
                if 'brand' in item_data:
                    update_body['brand'] = item_data['brand'].strip().upper() if item_data['brand'] else ''  # Normalizar a mayúsculas

                # Manejar item_group con sigla de compañía
                if 'item_group' in item_data:
                    original_group = item_data['item_group'].strip().upper()  # Normalizar a mayúsculas
                    if company and company_abbr and original_group and f" - {company_abbr}" not in original_group:
                        final_group = f"{original_group} - {company_abbr}"
                    else:
                        final_group = original_group
                    update_body['item_group'] = final_group

                # Manejar item_defaults - puede venir como array completo o campos individuales
                if 'item_defaults' in item_data and item_data['item_defaults']:
                    # Si se proporciona item_defaults completo, usarlo directamente
                    update_body['item_defaults'] = item_data['item_defaults']
                    print(f"✓ Actualizando item_defaults completo para {final_item_code}: {item_data['item_defaults']}")
                elif company and any(key in item_data for key in ['expense_account', 'income_account', 'default_warehouse']):
                    # Lógica para campos individuales
                    item_defaults = existing_item.get('item_defaults', [])

                    # Buscar o crear la configuración para esta compañía
                    company_default = None
                    for default in item_defaults:
                        if default.get('company') == company:
                            company_default = default
                            break

                    if not company_default:
                        company_default = {"company": company}
                        item_defaults.append(company_default)

                    # Actualizar los campos con sigla de compañía
                    if 'expense_account' in item_data and item_data['expense_account']:
                        original_account = item_data['expense_account'].strip()
                        if company_abbr and f" - {company_abbr}" not in original_account:
                            company_default['expense_account'] = f"{original_account} - {company_abbr}"
                        else:
                            company_default['expense_account'] = original_account

                    if 'income_account' in item_data and item_data['income_account']:
                        original_account = item_data['income_account'].strip()
                        if company_abbr and f" - {company_abbr}" not in original_account:
                            company_default['income_account'] = f"{original_account} - {company_abbr}"
                        else:
                            company_default['income_account'] = original_account

                    if 'default_warehouse' in item_data and item_data['default_warehouse']:
                        original_warehouse = item_data['default_warehouse'].strip()
                        if company_abbr and f" - {company_abbr}" not in original_warehouse:
                            company_default['default_warehouse'] = f"{original_warehouse} - {company_abbr}"
                        else:
                            company_default['default_warehouse'] = original_warehouse

                    update_body['item_defaults'] = item_defaults
                    print(f"✓ Actualizando item_defaults individuales para {final_item_code}")

                # Actualizar el item
                update_resp, update_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Item/{quote(final_item_code)}",
                    data={"data": update_body},
                    operation_name=f"Update item {final_item_code}"
                )

                if update_error:
                    error_msg = f"Error actualizando item: {update_error}"
                    print(f"❌ {error_msg}")

                    results.append({
                        "index": idx + 1,
                        "item_code": final_item_code,
                        "success": False,
                        "error": error_msg
                    })
                    failed_count += 1
                    continue

                if update_resp.status_code == 200:
                    updated_item = update_resp.json().get('data', {})
                    print(f"✓ Item actualizado exitosamente: {final_item_code}")

                    results.append({
                        "index": idx + 1,
                        "item_code": final_item_code,
                        "success": True,
                        "message": "Item actualizado exitosamente"
                    })

                    updated_count += 1
                    if company:
                        processed_companies.add(company)

                else:
                    error_msg = f"Error actualizando item: {update_resp.status_code} - {update_resp.text}"
                    print(f"❌ {error_msg}")

                    results.append({
                        "index": idx + 1,
                        "item_code": final_item_code,
                        "success": False,
                        "error": error_msg
                    })
                    failed_count += 1

            except Exception as e:
                error_msg = f"Error procesando item: {str(e)}"
                print(f"❌ Error en item {idx + 1}: {error_msg}")
                print(f"Traceback: {traceback.format_exc()}")

                results.append({
                    "index": idx + 1,
                    "item_code": item_data.get('item_code', 'N/A'),
                    "success": False,
                    "error": error_msg
                })
                failed_count += 1

        # Actualizar el conteo de items para las compañías procesadas
        for company in processed_companies:
            try:
                update_company_item_count(company)
            except Exception as e:
                print(f"Error actualizando conteo para compañía {company}: {e}")

        print(f"\n--- Resumen de actualización ---")
        print(f"Items procesados: {len(items_to_update)}")
        print(f"Items actualizados exitosamente: {updated_count}")
        print(f"Items con error: {failed_count}")

        return jsonify({
            "success": True,
            "message": f"Procesamiento completado. {updated_count} items actualizados, {failed_count} errores.",
            "data": {
                "total_processed": len(items_to_update),
                "updated_count": updated_count,
                "failed_count": failed_count,
                "results": results
            }
        })

    except Exception as e:
        print(f"Error en bulk_update_items_with_defaults: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


# NOTE: fetch_item_iva_rates_bulk implementation was moved to routes.inventory_utils


@bulk_update_bp.route('/api/inventory/items/bulk-fetch', methods=['GET'])
def bulk_fetch_items():
    """Buscar múltiples items por códigos"""
    print("\n--- Petición para buscar items en masa ---")
    
    # DEBUG: Log de parámetros recibidos
    targeted_param = request.args.get('targeted', 'false')
    codes = request.args.getlist('codes')
    print(f"DEBUG: targeted={targeted_param}, codes_count={len(codes)}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        codes = request.args.getlist('codes')  # Obtener lista de códigos
        warehouse = request.args.get('warehouse')
        targeted = request.args.get('targeted', 'false').lower() == 'true'  # Nuevo parámetro para fetch targeted

        if not codes:
            return jsonify({"success": False, "message": "Se requieren códigos de items"}), 400

        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        print(f"Buscando {len(codes)} códigos para compañía: {company}")
        print(f"DEBUG: Requested codes: {codes}")
        if warehouse:
            print(f"Con filtro de almacén: {warehouse}")
        print(f"Modo targeted: {targeted}")

        # Obtener sigla de la compañía
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía '{company}'"}), 400

        # OPTIMIZACIÓN: Si hay pocos códigos (<= 100), filtrar directamente en ERPNext
        # Independientemente del parámetro targeted, para asegurar optimización automática
        if len(codes) <= 100:  # Límite razonable para evitar URLs enormes
            print(f"🚀 OPTIMIZACIÓN: Fetch targeted - filtrando {len(codes)} códigos directamente en ERPNext...")
            smart_limit = len(codes)  # Exacto al número de códigos
            
            # Agregar abreviaturas a los códigos para la búsqueda
            codes_with_abbr = []
            print(f"DEBUG: building codes_with_abbr for company_abbr {company_abbr}")
            for code in codes:
                code_clean = code.strip()
                if not code_clean:
                    continue
                if not code_clean.endswith(f" - {company_abbr}"):
                    code_with_abbr = f"{code_clean} - {company_abbr}"
                else:
                    code_with_abbr = code_clean
                codes_with_abbr.append(code_with_abbr)
            print(f"DEBUG: codes_with_abbr: {codes_with_abbr}")
            
            # Filtros base
            filters_list = [
                ["disabled", "=", 0],
                ["custom_company", "=", company],
                ["docstatus", "in", [0, 1]],
                ["item_code", "in", codes_with_abbr]  # Filtrar directamente por códigos
            ]
        else:
            # Fallback a fetch completo (para backward compatibility)
            print("📊 Fetch completo: Consultando inventario completo para filtrar en memoria...")
            smart_limit = get_smart_limit(company, operation_type='list')
            print(f"📊 Límite inteligente: {smart_limit}")
            
            # Filtros base sin filtro de códigos
            filters_list = [
                ["disabled", "=", 0],
                ["custom_company", "=", company],
                ["docstatus", "in", [0, 1]]
            ]

        # If a warehouse is requested we are in stock mode: return only stock items
        if warehouse:
            filters_list.append(["is_stock_item", "=", 1])

        params = {
            "fields": json.dumps([
                "name", "item_code", "item_name", "description",
                "stock_uom", "is_stock_item", "standard_rate",
                "valuation_rate", "item_group", "docstatus",
                "is_sales_item", "is_purchase_item", "lead_time_days",
                "min_order_qty", "safety_stock", "max_discount",
                "grant_commission", "custom_description_type",
                "custom_product_links", "allow_negative_stock",
                "brand", "item_defaults"
            ]),
                "filters": json.dumps(filters_list),
            "limit_page_length": smart_limit
        }

        fetch_resp, fetch_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item",
            params=params,
            operation_name="Bulk fetch - Get all company items"
        )

        if fetch_error:
            print(f"❌ Error obteniendo inventario completo: {fetch_error}")
            return jsonify({"success": False, "message": "Error obteniendo items del inventario"}), 500

        if fetch_resp.status_code != 200:
            print(f"❌ Error HTTP {fetch_resp.status_code}: {fetch_resp.text}")
            return jsonify({"success": False, "message": f"Error HTTP {fetch_resp.status_code}"}), 500

        all_items = fetch_resp.json().get('data', [])
        print(f"✅ Items obtenidos del inventario: {len(all_items)}")

        # Si fue fetch targeted (pocos códigos), ya viene filtrado, solo procesar
        if len(codes) <= 100:
            results = {}
            for item in all_items:
                item_code = item.get('item_code')
                if item_code:
                    # Remover sigla de compañía del código mostrado
                    display_code = remove_company_abbr(item_code, company_abbr)
                    results[display_code] = item
            print(f"✅ Códigos encontrados (targeted): {len(results)} de {len(codes)}")
        else:
            # Fetch completo: crear mapa y filtrar en memoria como antes
            inventory_map = {}
            for item in all_items:
                item_code = item.get('item_code')
                if item_code:
                    inventory_map[item_code] = item
            
            print(f"✅ Mapa de inventario creado: {len(inventory_map)} items")

            # Filtrar solo los códigos solicitados
            results = {}
            codes_with_abbr = {}  # {codigo_limpio: codigo_con_abbr}
            
            for code in codes:
                code_clean = code.strip()
                if not code_clean:
                    continue
                
                # Agregar abreviatura si no la tiene
                code_with_abbr = code_clean
                if not code_clean.endswith(f" - {company_abbr}"):
                    code_with_abbr = f"{code_clean} - {company_abbr}"
                
                codes_with_abbr[code_clean] = code_with_abbr
            
            # Buscar en el mapa (operación O(1) por código)
            for code_clean, code_with_abbr in codes_with_abbr.items():
                if code_with_abbr in inventory_map:
                    item = inventory_map[code_with_abbr]
                    # Remover sigla de compañía del código mostrado
                    display_code = remove_company_abbr(item['item_code'], company_abbr)
                    results[display_code] = item
            
            print(f"✅ Códigos encontrados: {len(results)} de {len(codes_with_abbr)}")

        # Obtener stock si se especificó warehouse
        if warehouse and results:
            print(f"Obteniendo stock para {len(results)} items en almacén {warehouse}")

            # Obtener códigos completos con sigla para búsqueda de stock
            full_codes = []
            for display_code, item in results.items():
                full_code = item.get('name') or item.get('item_code')
                if full_code:
                    full_codes.append(full_code)

            if full_codes:
                stock_map = fetch_bin_stock(session, headers, full_codes, company)

                # Agregar stock a los resultados
                for display_code, item in results.items():
                    full_code = item.get('name') or item.get('item_code')
                    if full_code and full_code in stock_map:
                        stock_data = stock_map[full_code]
                        item['current_stock'] = stock_data.get('total_actual_qty', 0)
                        item['available_qty'] = stock_data.get('total_actual_qty', 0)
                        item['reserved_qty'] = stock_data.get('total_reserved_qty', 0)
                        item['projected_qty'] = stock_data.get('total_projected_qty', 0)

        # Convertir custom_product_links de string JSON a array
        for item in results.values():
            if 'custom_product_links' in item:
                if isinstance(item['custom_product_links'], str):
                    try:
                        item['custom_product_links'] = json.loads(item['custom_product_links'])
                    except json.JSONDecodeError as e:
                        print(f"Error parseando custom_product_links para {item.get('item_code')}: {e}")
                        item['custom_product_links'] = []
                elif not isinstance(item['custom_product_links'], list):
                    item['custom_product_links'] = []

        # Remover sigla de compañía de item_group
        for item in results.values():
            if 'item_group' in item and item['item_group']:
                item['item_group'] = remove_company_abbr(item['item_group'], company_abbr)

        # Obtener tasas de IVA de los items (consulta en bulk)
        if results:
            item_names = [item.get('name') for item in results.values() if item.get('name')]
            if item_names:
                iva_rates_map = _fetch_item_iva_rates_bulk(session, headers, item_names, company)
                # Agregar tasa de IVA a cada item
                for display_code, item in results.items():
                    item_name = item.get('name')
                    if item_name and item_name in iva_rates_map:
                        iva_info = iva_rates_map[item_name]
                        item['taxes'] = iva_info.get('taxes', [])
                        item['iva_rate'] = iva_info.get('iva_rate')

        # Convertir results a lista y ajustar item_code para que sea sin sigla
        items_list = []
        for display_code, item in results.items():
            # Crear una copia del item con item_code sin sigla
            item_copy = item.copy()
            item_copy['item_code'] = display_code
            item_copy['erp_item_code'] = item.get('name') or item.get('item_code')  # Guardar el código completo
            items_list.append(item_copy)

        print(f"Búsqueda completada: {len(items_list)} items encontrados")

        return jsonify({
            "success": True,
            "data": items_list
        })

    except Exception as e:
        print(f"Error en bulk_fetch_items: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@bulk_update_bp.route('/api/inventory/items/bulk-update-valuation-rates', methods=['POST'])
def bulk_update_valuation_rates():
    """Actualizar valuation_rate de múltiples items existentes (modo stock)"""
    print("\n--- Actualizando valuation rates en masa ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        items = data.get('items', [])
        company = data.get('company')

        if not items:
            return jsonify({"success": False, "message": "No se proporcionaron items para actualizar"}), 400

        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        print(f"📦 Items a actualizar: {len(items)}")
        print(f"🏢 Compañía: {company}")

        # Log first 5 items received from frontend
        print("🔍 Primeros 5 items recibidos del frontend:")
        for i, item in enumerate(items[:5]):
            print(f"  {i+1}. Código: {item.get('item_code')}, Costo: {item.get('valuation_rate')}")

        # Obtener abreviación de la compañía
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": "No se pudo obtener la abreviación de la compañía"}), 400

        results = []
        updated_count = 0
        failed_count = 0

        for idx, item in enumerate(items):
            try:
                # Validar datos requeridos
                if not item.get('item_code'):
                    results.append({
                        "index": idx + 1,
                        "item_code": item.get('item_code', 'N/A'),
                        "success": False,
                        "error": "Código de item requerido"
                    })
                    failed_count += 1
                    continue

                if item.get('valuation_rate') is None:
                    results.append({
                        "index": idx + 1,
                        "item_code": item.get('item_code', 'N/A'),
                        "success": False,
                        "error": "valuation_rate requerido"
                    })
                    failed_count += 1
                    continue

                # Construir código completo con sigla de compañía
                original_code = item['item_code']
                if f" - {company_abbr}" not in original_code:
                    full_item_code = f"{original_code} - {company_abbr}"
                else:
                    full_item_code = original_code

                # Verificar que el item existe y obtener su valuation_rate actual
                check_resp, check_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Item/{quote(full_item_code)}",
                    operation_name=f"Check item exists for valuation update {full_item_code}"
                )

                if check_error:
                    results.append({
                        "index": idx + 1,
                        "item_code": original_code,
                        "success": False,
                        "error": f"Item no encontrado: {check_error}"
                    })
                    failed_count += 1
                    continue

                if check_resp.status_code != 200:
                    results.append({
                        "index": idx + 1,
                        "item_code": original_code,
                        "success": False,
                        "error": f"Item no encontrado: {check_resp.status_code}"
                    })
                    failed_count += 1
                    continue

                existing_item = check_resp.json().get('data', {})
                current_valuation_rate = existing_item.get('valuation_rate', 0)
                new_valuation_rate = float(item['valuation_rate'])

                # Log comparison for first 5 items
                if idx < 5:
                    print(f"🔄 Comparando item {original_code}:")
                    print(f"   Actual en ERPNext: {current_valuation_rate}")
                    print(f"   Nuevo del frontend: {new_valuation_rate}")
                    print(f"   Diferencia: {abs(current_valuation_rate - new_valuation_rate)}")

                # Solo actualizar si el valuation_rate cambió significativamente
                if abs(current_valuation_rate - new_valuation_rate) > 0.01:  # Tolerancia de 0.01
                    if idx < 5:
                        print(f"   ✅ Se actualizará (cambio significativo)")

                    # Actualizar solo el valuation_rate
                    update_body = {
                        "valuation_rate": new_valuation_rate
                    }

                    response, update_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/Item/{quote(full_item_code)}",
                        data={"data": update_body},
                        operation_name=f"Update valuation rate for {full_item_code}"
                    )

                    if update_error:
                        error_text = str(update_error)
                        print(f"❌ Error actualizando {full_item_code}: {error_text}")
                        results.append({
                            "index": idx + 1,
                            "item_code": original_code,
                            "success": False,
                            "error": f"Error actualizando valuation_rate: {error_text}"
                        })
                        failed_count += 1
                        continue

                    if response.status_code == 200:
                        print(f"✓ valuation_rate actualizado para {full_item_code}: {new_valuation_rate} (era {current_valuation_rate})")
                        results.append({
                            "index": idx + 1,
                            "item_code": original_code,
                            "success": True,
                            "valuation_rate": new_valuation_rate,
                            "old_valuation_rate": current_valuation_rate
                        })
                        updated_count += 1
                    else:
                        error_text = response.text
                        print(f"❌ Error actualizando {full_item_code}: {response.status_code} - {error_text}")
                        results.append({
                            "index": idx + 1,
                            "item_code": original_code,
                            "success": False,
                            "error": f"Error actualizando valuation_rate: {response.status_code}"
                        })
                        failed_count += 1
                else:
                    if idx < 5:
                        print(f"   ⏭️  Se omite (sin cambio significativo)")
                    print(f"⏭️ valuation_rate sin cambios para {full_item_code}: {current_valuation_rate}")
                    results.append({
                        "index": idx + 1,
                        "item_code": original_code,
                        "success": True,
                        "message": "valuation_rate sin cambios",
                        "valuation_rate": current_valuation_rate
                    })
                    updated_count += 1  # Contar como exitoso aunque no se actualizó

            except Exception as e:
                error_msg = f"Error procesando item: {str(e)}"
                print(f"❌ Error en item {idx + 1}: {error_msg}")
                results.append({
                    "index": idx + 1,
                    "item_code": item.get('item_code', 'N/A'),
                    "success": False,
                    "error": error_msg
                })
                failed_count += 1

        print(f"\n--- Resumen de actualización de valuation rates ---")
        print(f"Items procesados: {len(items)}")
        print(f"Items actualizados exitosamente: {updated_count}")
        print(f"Items con error: {failed_count}")

        return jsonify({
            "success": True,
            "message": f"Actualización completada. {updated_count} items actualizados, {failed_count} errores.",
            "data": {
                "total_processed": len(items),
                "updated_count": updated_count,
                "failed_count": failed_count,
                "results": results
            }
        })

    except Exception as e:
        print(f"Error en bulk_update_valuation_rates: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@bulk_update_bp.route('/api/inventory/items/bulk-update-fields', methods=['POST'])
def bulk_update_item_fields():
    """Actualizar un campo específico de múltiples items usando la API de bulk update de ERPNext"""
    print("\n--- Bulk update fields ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        item_codes = data.get('item_codes', [])
        field = data.get('field')
        value = data.get('value')
        company = data.get('company')

        if not item_codes:
            return jsonify({"success": False, "message": "No se proporcionaron códigos de items"}), 400

        if not field:
            return jsonify({"success": False, "message": "Campo requerido"}), 400

        if not company:
            return jsonify({"success": False, "message": "Compañía requerida"}), 400

        print(f"Actualizando campo '{field}' con valor '{value}' para {len(item_codes)} items en compañía {company}")

        # Obtener sigla de la compañía
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía '{company}'"}), 400

        # Construir códigos completos con sigla
        full_item_codes = []
        for code in item_codes:
            if f" - {company_abbr}" not in code:
                full_item_codes.append(f"{code} - {company_abbr}")
            else:
                full_item_codes.append(code)

        # Procesar en batches de 500
        batch_size = 500
        total_updated = 0
        total_failed = 0
        results = []

        for i in range(0, len(full_item_codes), batch_size):
            batch_codes = full_item_codes[i:i + batch_size]
            print(f"Procesando batch {i//batch_size + 1}: {len(batch_codes)} items")

            # Preparar datos para la API de bulk update
            bulk_data = {
                "doctype": "Item",
                "freeze": True,
                "docnames": batch_codes,
                "action": "update",
                "data": {field: value}
            }

            # Llamar a la API de bulk update de ERPNext
            bulk_resp, bulk_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.desk.doctype.bulk_update.bulk_update.submit_cancel_or_update_docs",
                data=bulk_data,
                operation_name=f"Bulk update field {field} for batch {i//batch_size + 1}"
            )

            if bulk_error:
                print(f"Error en batch {i//batch_size + 1}: {bulk_error}")
                for code in batch_codes:
                    results.append({
                        "item_code": code,
                        "success": False,
                        "error": str(bulk_error)
                    })
                total_failed += len(batch_codes)
                continue

            if bulk_resp.status_code == 200:
                response_data = bulk_resp.json()
                print(f"Batch {i//batch_size + 1} completado exitosamente")
                
                # La API no devuelve detalles por item, asumimos éxito para todos
                for code in batch_codes:
                    results.append({
                        "item_code": code,
                        "success": True,
                        "message": f"Campo '{field}' actualizado a '{value}'"
                    })
                total_updated += len(batch_codes)
            else:
                print(f"Error en batch {i//batch_size + 1}: {bulk_resp.status_code} - {bulk_resp.text}")
                for code in batch_codes:
                    results.append({
                        "item_code": code,
                        "success": False,
                        "error": f"Error {bulk_resp.status_code}: {bulk_resp.text}"
                    })
                total_failed += len(batch_codes)

        print(f"\n--- Resumen bulk update ---")
        print(f"Total items procesados: {len(item_codes)}")
        print(f"Items actualizados: {total_updated}")
        print(f"Items con error: {total_failed}")

        return jsonify({
            "success": True,
            "message": f"Actualización completada. {total_updated} items actualizados, {total_failed} errores.",
            "data": {
                "total_processed": len(item_codes),
                "updated_count": total_updated,
                "failed_count": total_failed,
                "results": results
            }
        })

    except Exception as e:
        print(f"Error en bulk_update_item_fields: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500