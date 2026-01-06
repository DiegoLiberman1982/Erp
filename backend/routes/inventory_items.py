"""
Operaciones CRUD de items de inventario.
Maneja GET, POST, PUT, DELETE de items individuales y listas.
"""

from flask import Blueprint, request, jsonify
import datetime
import traceback
import json
from urllib.parse import quote

# Importar utilidades
from utils.http_utils import handle_erpnext_error, make_erpnext_request
from routes.auth_utils import get_session_with_auth
from routes.general import (
    remove_company_abbr, get_company_abbr, get_company_item_count,
    update_company_item_count, get_active_company, get_smart_limit,
    add_company_abbr, validate_company_abbr_operation, get_company_default_currency
)
from routes.inventory_utils import fetch_bin_stock, round_qty, query_items
from services import price_list_automation_service
from routes.inventory_utils import fetch_item_iva_rates_bulk as _fetch_item_iva_rates_bulk
from routes.items import assign_tax_template_by_rate, get_tax_template_map

# Crear el blueprint
inventory_items_bp = Blueprint('inventory_items', __name__)


# Helper: pick latest Item Price row from a list by valid_from > modified > creation
def _pick_latest_price_row(prices):
    if not prices:
        return None
    from datetime import datetime

    def _parse_date(s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(s)
        except Exception:
            try:
                return datetime.strptime(s.split('.')[0], '%Y-%m-%d %H:%M:%S')
            except Exception:
                try:
                    return datetime.strptime(s, '%Y-%m-%d')
                except Exception:
                    return None

    best = None
    best_ts = None
    for p in prices:
        try:
            vf = _parse_date(p.get('valid_from'))
            md = _parse_date(p.get('modified'))
            cr = _parse_date(p.get('creation'))
            priority = vf or md or cr or datetime.fromtimestamp(0)
            if best is None or priority >= best_ts:
                best = p
                best_ts = priority
        except Exception:
            if best is None:
                best = p
                best_ts = datetime.fromtimestamp(0)
    return best


def _normalize_stock_flag(value, default=1):
    """Convert incoming is_stock_item representations to ERPNext-friendly ints."""
    if value is None:
        return default
    if isinstance(value, bool):
        return 1 if value else 0
    try:
        if isinstance(value, (int, float)):
            return 1 if int(value) != 0 else 0
        str_value = str(value).strip().lower()
        if str_value in ('producto', 'product', 'true', '1', 'si', 'sí'):
            return 1
        if str_value in ('servicio', 'service', 'false', '0', 'no'):
            return 0
    except Exception:
        pass
    return default


def _ensure_purchase_price_entry(session, item_code, price_list_name, rate, currency=None, supplier=None):
    """Create or update the purchase Item Price row for a given item."""
    if not price_list_name or rate is None:
        return None, "Missing price list or rate"
    
    # Si no se proporciona currency, devolver error (no usar fallback)
    if not currency:
        return None, "Currency is required"

    try:
        filters = [
            ["price_list", "=", price_list_name],
            ["item_code", "=", item_code],
            ["buying", "=", 1]
        ]
        params = {
            "fields": '["name","price_list","price_list_rate","currency","supplier"]',
            "filters": json.dumps(filters),
            "limit_page_length": 5
        }
        existing_docname = None
        lookup_response, lookup_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=params,
            operation_name="Lookup purchase price for quick item creation"
        )
        if lookup_error:
            print(f"[QuickCreate] Error checking existing Item Price: {lookup_error}")
        elif lookup_response and lookup_response.status_code == 200:
            rows = lookup_response.json().get('data', [])
            if rows:
                existing_docname = rows[0].get('name')

        payload = {
            "item_code": item_code,
            "price_list": price_list_name,
            "price_list_rate": float(rate),
            "currency": currency,
            "buying": 1,
            "selling": 0
        }
        if supplier:
            payload["supplier"] = supplier

        if existing_docname:
            response, error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Item Price/{quote(existing_docname)}",
                operation_name="Update purchase price for quick item creation",
                data={"data": payload}
            )
        else:
            response, error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Item Price",
                operation_name="Create purchase price for quick item creation",
                data={"data": payload}
            )

        if error or not response or response.status_code not in [200, 201]:
            failure = error or (response.text if response is not None else "Unknown Item Price error")
            print(f"[QuickCreate] Failed to ensure purchase price: {failure}")
            return None, failure

        return response.json().get('data', {}), None
    except Exception as exc:
        print(f"[QuickCreate] Unexpected error ensuring purchase price: {exc}")
        return None, str(exc)


def _format_group_with_abbr(group_name, company_abbr):
    """Append the company abbreviation to the group name when missing."""
    if not group_name:
        return None
    safe_name = str(group_name).strip()
    if not safe_name:
        return None
    if company_abbr:
        suffix = f" - {company_abbr.strip()}"
        if not safe_name.endswith(suffix):
            safe_name = f"{safe_name}{suffix}"
    return safe_name


def _fetch_item_group(session, group_name):
    """Return the ERPNext docname for the given item group if it exists."""
    if not group_name:
        return None
    try:
        params = {
            "fields": '["name"]',
            "filters": json.dumps([["item_group_name", "=", group_name]]),
            "limit_page_length": 1
        }
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Group",
            params=params,
            operation_name=f"Lookup Item Group {group_name}"
        )
        if error or not response or response.status_code != 200:
            return None
        data = response.json().get('data', [])
        if data:
            return data[0].get('name') or group_name
    except Exception as lookup_exc:
        print(f"[ensure_item_group] Error buscando grupo '{group_name}': {lookup_exc}")
    return None


def _ensure_root_group(session):
    """Ensure the global 'All Item Groups' root exists and return its name."""
    root_name = "All Item Groups"
    existing = _fetch_item_group(session, root_name)
    if existing:
        return existing
    payload = {
        "item_group_name": root_name,
        "is_group": 1
    }
    response, error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Item Group",
        operation_name="Create All Item Groups root",
        data={"data": payload}
    )
    if error or not response or response.status_code not in [200, 201]:
        return None
    return response.json().get('data', {}).get('name', root_name)


def _ensure_item_group(session, company, company_abbr, requested_group):
    """Ensure the requested item group exists for the company and return its canonical name."""
    canonical_name = _format_group_with_abbr(requested_group, company_abbr)
    if not canonical_name:
        return None, "El grupo de items es requerido"

    existing = _fetch_item_group(session, canonical_name)
    if existing:
        return existing, None

    parent_group = None
    abbr_root = None
    if company_abbr:
        abbr_root_name = f"All Item Groups - {company_abbr.strip()}"
        abbr_root = _fetch_item_group(session, abbr_root_name)
        if not abbr_root:
            base_root = _ensure_root_group(session)
            if base_root:
                payload = {
                    "item_group_name": abbr_root_name,
                    "parent_item_group": base_root,
                    "is_group": 1
                }
                response, error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Item Group",
                    operation_name=f"Create company root group {abbr_root_name}",
                    data={"data": payload}
                )
                if not error and response and response.status_code in [200, 201]:
                    abbr_root = response.json().get('data', {}).get('name', abbr_root_name)
        parent_group = abbr_root

    if not parent_group:
        parent_group = _ensure_root_group(session)

    if not parent_group:
        return None, "No se pudo asegurar el grupo padre para la compañía"

    payload = {
        "item_group_name": canonical_name,
        "parent_item_group": parent_group,
        "is_group": 0
    }
    if company:
        payload["custom_company"] = company

    response, error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Item Group",
        operation_name=f"Create Item Group {canonical_name}",
        data={"data": payload}
    )
    if error or not response or response.status_code not in [200, 201]:
        # Puede que otro proceso lo haya creado en paralelo; verificar nuevamente
        existing = _fetch_item_group(session, canonical_name)
        if existing:
            return existing, None
        message = "No se pudo crear el grupo de items solicitado"
        if isinstance(error, dict):
            message = error.get('message') or message
        return None, message

    created_name = response.json().get('data', {}).get('name', canonical_name)
    return created_name, None


def _extract_custom_links(item_payload):
    """Build custom_product_links array based on provided platform/url info."""
    custom_links = item_payload.get('custom_product_links')
    if custom_links and isinstance(custom_links, list):
        return custom_links

    platform = (item_payload.get('platform') or '').strip()
    url = (item_payload.get('url') or '').strip()
    if platform or url:
        return [{"platform": platform, "url": url}]
    return None


@inventory_items_bp.route('/api/inventory/items', methods=['GET'])
def get_inventory_items():
    """
    Obtener lista de items de inventario
        exclude_kits = str(request.args.get('exclude_kits', '0')).strip() in ['1', 'true', 'True']
    Query params:
    - company: Nombre de la compañía (requerido)
    - warehouse: Nombre interno del warehouse (opcional) para filtrar stock
                 NOTA: Debe ser 'name' completo (ej: DEPOT__OWN - ABC), no warehouse_name
    - search, category, brand, price_list: Filtros adicionales
    """
    print("\n--- Petición para obtener items de inventario ---")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = request.args.get('company')
        search_term = request.args.get('search', '').strip()
        category = request.args.get('category', '').strip()
        brand = request.args.get('brand', '').strip()
        price_list = request.args.get('price_list', '').strip()
        warehouse = request.args.get('warehouse', '').strip()  # Internal warehouse name for filtering
        exclude_kits = str(request.args.get('exclude_kits', '0')).strip().lower() in ['1', 'true', 'yes']
        include_taxes = str(request.args.get('include_taxes', '0')).strip().lower() in ['1', 'true', 'yes']
        
        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400
        
        print(f"Obteniendo items para la compañía: {company}")
        try:
            company_abbr = get_company_abbr(session, headers, company)
        except Exception:
            company_abbr = None
        # Calcular smart_limit una vez por compañía para consultas relacionadas con items
        try:
            company_item_count = get_company_item_count(company)
        except Exception:
            company_item_count = 0
        smart_limit = get_smart_limit(company, 'list')
        if warehouse:
            print(f"Filtrando por almacén: {warehouse}")
        
        fields = [
            "name", "item_code", "item_name", "description", 
            "stock_uom", "is_stock_item", "standard_rate",
            "valuation_rate", "item_group", "docstatus",
            "is_sales_item", "is_purchase_item", "lead_time_days",
            "min_order_qty", "safety_stock", "max_discount", "grant_commission",
            "custom_description_type", "custom_product_links", "allow_negative_stock",
            "brand", "item_defaults"
        ]
        
        # Filtros base
        base_filters = [
            ["disabled", "=", 0],
            ["custom_company", "=", company],
            ["docstatus", "in", [0, 1]]
        ]
        # When a warehouse filter is provided we are working in stock mode
        # and should only return actual stock items (is_stock_item == 1).
        # This keeps the filtering server-side per product: services (is_stock_item == 0)
        # must not be returned when listing items for a warehouse.
        if warehouse:
            base_filters.append(["is_stock_item", "=", 1])
        
        if category:
            base_filters.append(["item_group", "=", category])
        if brand:
            base_filters.append(["brand", "=", brand])
        
        # Si hay búsqueda
        if search_term:
            print(f"Con búsqueda: '{search_term}'")
            search_pattern = f"%{search_term}%"
            
            # Calcular límite basado en el conteo de items usando smart_limit
            item_count = get_company_item_count(company)
            search_limit = max(get_smart_limit(company, 'search'), item_count + 100)
            
            # Query 1: Buscar por item_code
            filters_code = base_filters.copy()
            filters_code.append(["item_code", "like", search_pattern])
            
            response_code, error_code = query_items(
                session=session, headers=headers, filters=filters_code,
                fields=fields, limit_page_length=search_limit,
                operation_name="Search items by code"
            )
            
            items_by_code = {}
            if not error_code:
                items_by_code = {item['name']: item for item in response_code.json().get('data', [])}
                print(f"Items encontrados por código: {len(items_by_code)}")
            
            # Query 2: Buscar por item_name
            filters_name = base_filters.copy()
            filters_name.append(["item_name", "like", search_pattern])
            
            response_name, error_name = query_items(
                session=session, headers=headers, filters=filters_name,
                fields=fields, limit_page_length=search_limit,
                operation_name="Search items by name"
            )
            
            items_by_name = {}
            if not error_name:
                items_by_name = {item['name']: item for item in response_name.json().get('data', [])}
                print(f"Items encontrados por nombre: {len(items_by_name)}")
            
            all_items = {**items_by_code, **items_by_name}
            items_data = list(all_items.values())
            print(f"Total items únicos encontrados: {len(items_data)}")
            
        else:
            # Sin búsqueda: usar smart_limit (con un fallback basado en item_count)
            item_count = get_company_item_count(company)
            limit = max(smart_limit, item_count + 1000)

            response, error = query_items(
                session=session, headers=headers, filters=base_filters,
                fields=fields, limit_page_length=limit,
                operation_name="Get inventory items"
            )
            
            if error:
                return jsonify({"success": False, "message": "Error al obtener items"}), 500
            
            items_data = response.json().get('data', [])
            print(f"Items obtenidos: {len(items_data)}")
        
        # Filtrar por docstatus
        filtered_items = [item for item in items_data if item.get('docstatus', 0) in [0, 1]]

        # Excluir items que son padres de Product Bundles (kits) si se solicita
        if exclude_kits:
            try:
                pb_params = {
                    "fields": json.dumps(["name", "new_item_code", "disabled", "docstatus"]),
                    "filters": json.dumps([["docstatus", "in", [0, 1]], ["disabled", "=", 0]]),
                    "limit_page_length": 2000
                }
                pb_resp, pb_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Product Bundle",
                    params=pb_params,
                    operation_name="Get Product Bundles for item exclusion"
                )
                bundle_codes = set()
                if not pb_err and pb_resp and pb_resp.status_code == 200:
                    for pb in pb_resp.json().get('data', []) or []:
                        code = pb.get('new_item_code') or pb.get('name')
                        if code:
                            bundle_codes.add(code)
                            if company_abbr and code.endswith(f" - {company_abbr}"):
                                bundle_codes.add(code[:-(len(company_abbr) + 3)])
                if bundle_codes:
                    filtered_items = [item for item in filtered_items if item.get('item_code') not in bundle_codes and (company_abbr is None or remove_company_abbr(item.get('item_code', ''), company_abbr) not in bundle_codes)]
            except Exception:
                # If exclusion fails, keep the original list to avoid hiding items erroneously
                pass
        print(f"Items filtrados para mostrar: {len(filtered_items)}")

        # Normalizar nombres removiendo la abbr de compañía para mostrar en front
        if company_abbr:
            for item in filtered_items:
                if item.get('item_group'):
                    item['item_group'] = remove_company_abbr(item['item_group'], company_abbr)
        
        # Convertir custom_product_links
        for item in filtered_items:
            if 'custom_product_links' in item:
                if isinstance(item['custom_product_links'], str):
                    try:
                        item['custom_product_links'] = json.loads(item['custom_product_links'])
                    except json.JSONDecodeError:
                        item['custom_product_links'] = []
                elif not isinstance(item['custom_product_links'], list):
                    item['custom_product_links'] = []
        
        # Filtrar por price_list si se especificó
        if price_list:
            price_filters = [["price_list", "=", price_list]]
            # Usar smart_limit para consultas relacionadas con items / precios
            price_limit = get_smart_limit(company, 'list')
            price_params = {
                "fields": json.dumps(["item_code"]),
                "filters": json.dumps(price_filters),
                "limit_page_length": price_limit
            }
            
            price_response, price_error = make_erpnext_request(
                session=session, method="GET",
                endpoint="/api/resource/Item Price",
                params=price_params,
                operation_name=f"Get item prices for list {price_list}"
            )
            
            if not price_error:
                price_data = price_response.json().get('data', [])
                items_with_prices = set(price['item_code'] for price in price_data)
                filtered_items = [item for item in filtered_items if item['item_code'] in items_with_prices]
        
        # Obtener stock por warehouse si se especificó
        # NOTA: El parámetro 'warehouse' debe ser el 'name' interno (ej: DEPOT__OWN - ABC)
        # Si el frontend envía warehouse_name limpio, debe traducirse aquí
        if warehouse:
            erp_codes = [item.get('name') or item.get('item_code') for item in filtered_items]
            if erp_codes:
                stock_map = fetch_bin_stock(session, headers, erp_codes, company)
                for item in filtered_items:
                    erp_code = item.get('name') or item.get('item_code')
                    if erp_code and erp_code in stock_map:
                        stock_info = stock_map[erp_code]
                        warehouse_stock = None
                        for bin_entry in stock_info.get('bins', []):
                            if bin_entry.get('warehouse') == warehouse:
                                warehouse_display = remove_company_abbr(warehouse, company_abbr)
                                warehouse_stock = {
                                    'warehouse': bin_entry.get('warehouse'),  # Internal name
                                    'warehouse_name': warehouse_display,  # Display label
                                    'actual_qty': bin_entry.get('actual_qty', 0),
                                    'reserved_qty': bin_entry.get('reserved_qty', 0),
                                    'projected_qty': bin_entry.get('projected_qty', 0)
                                }
                                break
                        
                        if warehouse_stock:
                            item['stock_by_warehouse'] = [warehouse_stock]
                            item['available_qty'] = warehouse_stock.get('actual_qty', 0)
                        else:
                            warehouse_display = remove_company_abbr(warehouse, company_abbr)
                            item['stock_by_warehouse'] = [{
                                'warehouse': warehouse,  # Internal name
                                'warehouse_name': warehouse_display,  # Display label
                                'actual_qty': 0,
                                'reserved_qty': 0, 
                                'projected_qty': 0
                            }]
                            item['available_qty'] = 0
                    else:
                        warehouse_display = remove_company_abbr(warehouse, company_abbr)
                        item['stock_by_warehouse'] = [{
                            'warehouse': warehouse,  # Internal name
                            'warehouse_name': warehouse_display,  # Display label
                            'actual_qty': 0,
                            'reserved_qty': 0, 
                            'projected_qty': 0
                        }]
                        item['available_qty'] = 0
        
        # Remover sigla de compañía
        company_abbr = get_company_abbr(session, headers, company)
        for item in filtered_items:
            original_code = item.get('item_code')
            if original_code:
                # Preserve original ERP code and provide a cleaned display code
                item['erp_item_code'] = original_code
                transformed_code = remove_company_abbr(original_code, company_abbr)
                item['item_code'] = transformed_code
            # Also remove company abbr from item_name for display if present
            if company_abbr and item.get('item_name'):
                try:
                    item['item_name'] = remove_company_abbr(item.get('item_name'), company_abbr)
                except Exception:
                    pass
        # If this request included a search term, fetch Item Price (ONLY) for the matched items
        # NOTE: Per user requirement, do NOT use fallbacks — query Item Price by exact ERP item code
        try:
            if search_term and filtered_items:
                # Build list of full ERP item codes (use item's 'name' if present which is the full code)
                full_codes = []
                for it in filtered_items:
                    # If the ERP resource 'name' exists and looks like the full code, prefer it
                    erp_name = it.get('name')
                    if erp_name:
                        full_codes.append(erp_name)
                    else:
                        # Fallback to item_code + company_abbr (this should match how items are stored)
                        code = it.get('item_code')
                        if code:
                            full_codes.append(f"{code} - {company_abbr}")

                # Deduplicate
                full_codes = list(dict.fromkeys(full_codes))

                # Query ERPNext Item Price for these full_codes with selling=1
                price_filters = [
                    ["item_code", "in", full_codes],
                    ["selling", "=", 1]
                ]

                # Request explicit fields (as requested) and page through results until
                # we've either collected all matching rows or ERPNext returns no more.
                price_limit = max(len(full_codes), get_smart_limit(company, 'list'))
                fields_list = [
                    "name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
                    "item_code", "uom", "packing_unit", "item_name", "brand", "item_description",
                    "price_list", "customer", "supplier", "batch_no", "buying", "selling",
                    "currency", "price_list_rate", "valid_from", "lead_time_days", "valid_upto",
                    "note", "reference"
                ]

                collected = []
                limit_start = 0
                max_pages = 5  # safety cap to avoid infinite loops
                page = 0

                try:
                    print(f"[DEBUG get_inventory_items] Fetching Item Price for {len(full_codes)} full_codes using price_limit={price_limit}")
                except Exception:
                    pass

                while page < max_pages:
                    price_params = {
                        "fields": json.dumps(fields_list),
                        "filters": json.dumps(price_filters),
                        "limit_page_length": price_limit,
                        "limit_start": limit_start
                    }

                    try:
                        print(f"[DEBUG get_inventory_items] ERPNext call page={page} limit_start={limit_start} params_fields_count={len(fields_list)}")
                    except Exception:
                        pass

                    price_response, price_error = make_erpnext_request(
                        session=session, method="GET",
                        endpoint="/api/resource/Item Price",
                        params=price_params,
                        operation_name=f"Fetch Item Price for search '{search_term}' page {page}"
                    )

                    if price_error or not price_response or price_response.status_code != 200:
                        # stop on error but continue with whatever we've collected
                        try:
                            print(f"[DEBUG get_inventory_items] ERPNext price page {page} error or empty response: {price_error}")
                        except Exception:
                            pass
                        break

                    page_data = price_response.json().get('data', [])
                    try:
                        print(f"[DEBUG get_inventory_items] ERPNext returned {len(page_data)} rows on page {page}")
                    except Exception:
                        pass

                    if not page_data:
                        break

                    collected.extend(page_data)

                    # If we've likely collected all relevant rows (at least as many as full_codes), stop
                    if len(collected) >= len(full_codes):
                        break

                    # prepare next page
                    limit_start += price_limit
                    page += 1

                price_data = collected
                try:
                    print(f"[DEBUG get_inventory_items] Total price rows collected: {len(price_data)} sample item_codes: {[p.get('item_code') for p in price_data[:40]]}")
                except Exception:
                    pass

                # Map raw price rows by item_code (ERP full code)
                raw_price_map = {}
                for p in price_data:
                    key = p.get('item_code')
                    if not key:
                        continue
                    raw_price_map.setdefault(key, []).append(p)

                # For each item, pick the latest price row and attach as the prices list (single entry)
                price_map = {}
                for key, raws in raw_price_map.items():
                    latest = _pick_latest_price_row(raws)
                    if latest:
                        price_map[key] = [{
                            'name': latest.get('name'),
                            'price_list': latest.get('price_list'),
                            'price_list_rate': latest.get('price_list_rate'),
                            'selling': latest.get('selling'),
                            'valid_from': latest.get('valid_from'),
                            'modified': latest.get('modified'),
                            'creation': latest.get('creation')
                        }]

                # Attach prices to filtered_items using their ERP full code
                for it in filtered_items:
                    erp_name = it.get('name') if it.get('name') else (f"{it.get('item_code')} - {company_abbr}" if it.get('item_code') else None)
                    it_prices = price_map.get(erp_name, []) if erp_name else []
                    it['prices'] = it_prices
                    # expose a primary price_list_rate if available (latest entry)
                    if it_prices:
                        it['price_list_rate'] = it_prices[0].get('price_list_rate')
                        it['price_list_name'] = it_prices[0].get('price_list')

                # Log the result (small sample) to help debug paste flow
                sample = []
                for it in filtered_items[:20]:
                    sample.append({
                        'name': it.get('name'),
                        'item_code': it.get('item_code'),
                        'prices_count': len(it.get('prices', [])),
                        'price_list_rate': it.get('price_list_rate')
                    })
                print(f"[DEBUG get_inventory_items] search_term='{search_term}' matched_count={len(filtered_items)} sample={sample}")
        except Exception as e:
            print(f"[ERROR get_inventory_items] fetching Item Price: {e}")
            # Do not fail the outer request because of price fetch errors
            pass
        
        # Obtener tasas de IVA para los items - Solo cuando se solicite explícitamente
        if include_taxes:
            try:
                if filtered_items:
                    # Obtener los nombres ERP completos de los items
                    item_names_with_abbr = [item.get('name') or item.get('erp_item_code') for item in filtered_items if item.get('name') or item.get('erp_item_code')]
                    if item_names_with_abbr:
                        iva_rates = _fetch_item_iva_rates_bulk(session, headers, item_names_with_abbr, company)
                        # Agregar iva_rate y taxes a cada item
                        for item in filtered_items:
                            item_name = item.get('name') or item.get('erp_item_code')
                            if item_name and item_name in iva_rates:
                                item['iva_rate'] = iva_rates[item_name].get('iva_rate')
                                item['taxes'] = iva_rates[item_name].get('taxes', [])
            except Exception as e:
                print(f"[ERROR get_inventory_items] fetching IVA rates: {e}")
                # Do not fail the outer request because of IVA rate fetch errors
                pass
        
        return jsonify({"success": True, "data": filtered_items})
        
    except Exception as e:
        print(f"Error en get_inventory_items: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_items_bp.route('/api/inventory/items/bulk', methods=['POST'])
def bulk_get_inventory_items():
    """
    Buscar varios items por lista de códigos en un único request.

    Body JSON expected: { company: string, codes: ["CODE1", "CODE2", ...], price_list?: string }
    Returns: { success: True, data: [ items... ] }
    This reuses the same normalization and Item Price attachment logic from get_inventory_items,
    but operates on an explicit list of codes to avoid repeated single-item requests.
    """
    print("\n--- Petición bulk para obtener items de inventario ---")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        company = data.get('company')
        codes = data.get('codes') or []
        price_list = data.get('price_list', '').strip()

        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        if not isinstance(codes, list) or len(codes) == 0:
            return jsonify({"success": False, "message": "Se requiere una lista de códigos (codes)"}), 400

        # Normalize and dedupe codes
        seen = set()
        cleaned = []
        for c in codes:
            if not c: continue
            s = str(c).strip()
            if s in seen: continue
            seen.add(s)
            cleaned.append(s)

        print(f"DEBUG: bulk_get_inventory_items POST received codes: {codes}")
        print(f"DEBUG: cleaned codes: {cleaned}")

        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía {company}"}), 400

        # Build full ERP codes
        full_codes = []
        for code in cleaned:
            if ' - ' in code:
                full_codes.append(code)
            else:
                full_codes.append(f"{code} - {company_abbr}")

        print(f"DEBUG: full_codes for query: {full_codes}")

        # Query ERPNext Items by exact item_code in full_codes (chunked to avoid huge URLs)
        fields = [
            "name", "item_code", "item_name", "description",
            "stock_uom", "is_stock_item", "standard_rate",
            "valuation_rate", "item_group", "docstatus",
            "is_sales_item", "is_purchase_item", "lead_time_days",
            "min_order_qty", "safety_stock", "max_discount", "grant_commission",
            "custom_description_type", "custom_product_links", "allow_negative_stock",
            "brand", "item_defaults"
        ]

        items_data = []
        batch_size = 50
        for idx in range(0, len(full_codes), batch_size):
            batch_codes = full_codes[idx: idx + batch_size]
            # Do not filter by custom_company at query time because some items (e.g., kits)
            # do not set custom_company but instead set item_defaults.company for their company.
            # We therefore query by item_code and filter post-hoc to keep items relevant to the company.
            base_filters = [
                ["disabled", "=", 0],
                ["docstatus", "in", [0, 1]],
                ["item_code", "in", batch_codes]
            ]
            item_limit = min(max(len(batch_codes), 5), max(len(batch_codes), get_smart_limit(company, 'list')))

            response, error = query_items(
                session=session, headers=headers,
                filters=base_filters, fields=fields,
                limit_page_length=item_limit,
                operation_name=f"Bulk fetch items by codes (batch {idx//batch_size + 1})"
            )

            if not error and response and response.status_code == 200:
                batch_res_data = response.json().get('data', [])
                print(f"DEBUG: API query batch {idx//batch_size + 1} returned {len(batch_res_data)} items: {[d.get('item_code') for d in batch_res_data]}")
                items_data.extend(batch_res_data)

        # Filter docstatus and keep only items relevant to the requested company.
        filtered_items = []
        for item in items_data:
            if item.get('docstatus', 0) not in [0, 1]:
                continue
            # Keep items where custom_company matches OR item_defaults contains the company
            keep = False
            if item.get('custom_company') == company:
                keep = True
                reason = 'custom_company'
            else:
                defaults = item.get('item_defaults') or []
                if isinstance(defaults, list):
                    for d in defaults:
                        if d and (str(d.get('company')).strip().lower() == str(company).strip().lower()):
                            keep = True
                            reason = 'item_defaults'
                            break
            
            # If still not matched, accept items where the item_code includes the company abbr
            if not keep:
                try:
                    if item.get('item_code') and company_abbr and str(item.get('item_code')).endswith(f" - {company_abbr}"):
                        keep = True
                        reason = 'item_code_abbr'
                except Exception:
                    pass
            # Debug: log why an item is kept or excluded
            try:
                debug_custom_company = item.get('custom_company')
                debug_item_defaults = item.get('item_defaults')
                if keep:
                    print(f"DEBUG: Keeping item {item.get('item_code')} reason={reason} -> custom_company={debug_custom_company} item_defaults_count={len(debug_item_defaults) if isinstance(debug_item_defaults, list) else 0}")
                else:
                    print(f"DEBUG: Excluding item {item.get('item_code')} -> custom_company={debug_custom_company} item_defaults={debug_item_defaults}")
            except Exception:
                pass
            if keep:
                filtered_items.append(item)

        # Convert custom_product_links
        for item in filtered_items:
            if 'custom_product_links' in item:
                if isinstance(item['custom_product_links'], str):
                    try:
                        item['custom_product_links'] = json.loads(item['custom_product_links'])
                    except json.JSONDecodeError:
                        item['custom_product_links'] = []
                elif not isinstance(item['custom_product_links'], list):
                    item['custom_product_links'] = []

        # Remove company abbr for display
        for item in filtered_items:
            original_code = item.get('item_code')
            if original_code:
                item['erp_item_code'] = original_code
                item['item_code'] = remove_company_abbr(original_code, company_abbr)
            # Also strip abbr from item_name if present
            if company_abbr and item.get('item_name'):
                try:
                    item['item_name'] = remove_company_abbr(item.get('item_name'), company_abbr)
                except Exception:
                    pass

        # Attach Item Price (selling=1) for the requested full_codes (no fallback)
        try:
            fields_list = [
                "name", "owner", "creation", "modified", "modified_by", "docstatus", "idx",
                "item_code", "uom", "packing_unit", "item_name", "brand", "item_description",
                "price_list", "customer", "supplier", "batch_no", "buying", "selling",
                "currency", "price_list_rate", "valid_from", "lead_time_days", "valid_upto",
                "note", "reference"
            ]

            price_data = []
            batch_size = 50  # evitar URLs enormes
            for idx in range(0, len(full_codes), batch_size):
                batch_codes = full_codes[idx: idx + batch_size]
                price_filters = [["item_code", "in", batch_codes], ["selling", "=", 1]]
                
                # Si se especificó una lista de precios, filtrar por ella
                if price_list:
                    price_filters.append(["price_list", "=", price_list])
                    print(f"DEBUG: Filtering Item Price by price_list={price_list}")
                    
                price_limit = max(len(batch_codes), 5)

                price_params = {
                    "fields": json.dumps(fields_list),
                    "filters": json.dumps(price_filters),
                    "limit_page_length": price_limit
                }

                price_response, price_error = make_erpnext_request(
                    session=session, method="GET",
                    endpoint="/api/resource/Item Price",
                    params=price_params,
                    operation_name=f"Bulk Fetch Item Price batch {idx//batch_size + 1}"
                )

                if price_error:
                    print(f"[ERROR bulk_get_inventory_items] Item Price batch {idx//batch_size + 1}: {price_error}")
                    continue
                if not price_response or price_response.status_code != 200:
                    msg = price_response.text if price_response else "No response"
                    print(f"[ERROR bulk_get_inventory_items] Item Price batch {idx//batch_size + 1}: {msg}")
                    continue

                batch_data = price_response.json().get('data', [])
                if batch_data:
                    price_data.extend(batch_data)

            # Map and pick latest
            raw_price_map = {}
            for p in price_data:
                key = p.get('item_code')
                if not key: continue
                raw_price_map.setdefault(key, []).append(p)

            price_map = {}
            for key, raws in raw_price_map.items():
                latest = _pick_latest_price_row(raws)
                if latest:
                    price_map[key] = [{
                        'name': latest.get('name'),
                        'price_list': latest.get('price_list'),
                        'price_list_rate': latest.get('price_list_rate'),
                        'selling': latest.get('selling'),
                        'valid_from': latest.get('valid_from'),
                        'modified': latest.get('modified'),
                        'creation': latest.get('creation')
                    }]

            # Attach prices to filtered_items
            for it in filtered_items:
                erp_name = it.get('name') if it.get('name') else (f"{it.get('item_code')} - {company_abbr}" if it.get('item_code') else None)
                it_prices = price_map.get(erp_name, []) if erp_name else []
                it['prices'] = it_prices
                if it_prices:
                    it['price_list_rate'] = it_prices[0].get('price_list_rate')
                    it['price_list_name'] = it_prices[0].get('price_list')
        except Exception as e:
            print(f"[ERROR bulk_get_inventory_items] fetching Item Price: {e}")
            pass

        return jsonify({"success": True, "data": filtered_items})

    except Exception as e:
        print(f"Error en bulk_get_inventory_items: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_items_bp.route('/api/inventory/items/<path:item_code>', methods=['GET'])
def get_item_details(item_code):
    """Obtener detalles completos de un item"""
    print(f"\n--- Petición para obtener detalles del item: {item_code} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        if not company:
            company = get_active_company(user_id)
            if not company:
                return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400
        
        fields_param = request.args.get('fields')
        include_bin_stock = request.args.get('include_bin_stock', '0').lower() in ('1', 'true', 'yes')

        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía {company}"}), 400
        
        # `item_code` may already include the company suffix; avoid duplicating it.
        normalized_code = (item_code or '').strip()
        full_code = add_company_abbr(normalized_code, company_abbr)
        
        response, error = make_erpnext_request(
            session=session, method="GET",
            endpoint=f"/api/resource/Item/{quote(full_code)}",
            operation_name=f"Fetch Item Details for {full_code}"
        )

        if not response or response.status_code != 200:
            return handle_erpnext_error(error, "Failed to fetch item details")

        item_data = response.json().get('data', {})
        erp_item_code = item_data.get('name') or item_data.get('item_code') or full_code

        # Si se solicitan campos específicos
        if fields_param:
            requested_fields = [f.strip() for f in fields_param.split(',') if f.strip()]
            needs_stock_data = 'available_qty' in requested_fields

            stock_entry = {}
            if needs_stock_data and item_data.get('is_stock_item') == 1 and erp_item_code:
                stock_map = fetch_bin_stock(session, headers, [erp_item_code], company)
                stock_entry = stock_map.get(erp_item_code, {}) if stock_map else {}

            available_qty = round_qty(stock_entry.get('total_actual_qty')) if stock_entry else 0.0

            filtered_data = {}
            for field in requested_fields:
                if field == 'available_qty':
                    filtered_data['available_qty'] = available_qty
                elif field in item_data:
                    filtered_data[field] = item_data[field]

            if company_abbr:
                if 'item_code' in filtered_data and filtered_data['item_code']:
                    original_code = filtered_data['item_code']
                    filtered_data['erp_item_code'] = original_code
                    filtered_data['item_code'] = remove_company_abbr(original_code, company_abbr)
                if 'item_group' in filtered_data and filtered_data['item_group']:
                    filtered_data['item_group'] = remove_company_abbr(filtered_data['item_group'], company_abbr)
                # Also normalize item_name if requested
                if 'item_name' in filtered_data and filtered_data.get('item_name'):
                    filtered_data['item_name'] = remove_company_abbr(filtered_data.get('item_name'), company_abbr)

            return jsonify({"success": True, "data": filtered_data})

        # Asegurar que custom_product_links sea un array
        if 'custom_product_links' in item_data:
            if isinstance(item_data['custom_product_links'], str):
                try:
                    item_data['custom_product_links'] = json.loads(item_data['custom_product_links'])
                except json.JSONDecodeError:
                    item_data['custom_product_links'] = []
            elif not isinstance(item_data['custom_product_links'], list):
                item_data['custom_product_links'] = []

        # Obtener stock si se requiere
        if include_bin_stock and item_data.get('is_stock_item') == 1 and erp_item_code:
            stock_map = fetch_bin_stock(session, headers, [erp_item_code], company)
            stock_entry = stock_map.get(erp_item_code, {}) if stock_map else {}
            
            # actual_qty = cantidad física en almacén
            # reserved_qty = cantidad reservada por Sales Orders
            # available_qty = actual - reserved (disponible para nuevas órdenes)
            actual_qty = round_qty(stock_entry.get('total_actual_qty', 0))
            reserved_qty = round_qty(stock_entry.get('total_reserved_qty', 0))
            available_qty = round_qty(stock_entry.get('total_available_qty', actual_qty - reserved_qty))
            projected_qty = round_qty(stock_entry.get('total_projected_qty', 0))
            
            item_data['actual_qty'] = actual_qty
            item_data['available_qty'] = available_qty
            item_data['reserved_qty'] = reserved_qty
            item_data['projected_qty'] = projected_qty
            
            # Incluir detalles de reservas si existen
            item_data['stock_reservations'] = stock_entry.get('stock_reservations', [])

            warehouses = []
            for entry in stock_entry.get('bins', []):
                warehouse_internal_name = entry.get('warehouse')
                warehouse_display = remove_company_abbr(warehouse_internal_name, company_abbr)
                # NOTA: Frontend debe usar 'warehouse_name' para mostrar y 'warehouse' para operaciones
                warehouses.append({
                    "warehouse": warehouse_internal_name,  # Internal ERPNext name for operations
                    "warehouse_name": warehouse_display,  # Display label for frontend
                    "warehouse_display": warehouse_display,  # Deprecated alias for backward compatibility
                    "actual_qty": round_qty(entry.get('actual_qty')),
                    "available_qty": round_qty(entry.get('available_qty', entry.get('actual_qty', 0) - entry.get('reserved_qty', 0))),
                    "reserved_qty": round_qty(entry.get('reserved_qty')),
                    "projected_qty": round_qty(entry.get('projected_qty'))
                })

            item_data['bin_stock'] = {
                "total_actual_qty": actual_qty,
                "total_available_qty": available_qty,
                "total_reserved_qty": reserved_qty,
                "total_projected_qty": projected_qty,
                "warehouses": warehouses
            }
        elif include_bin_stock:
            item_data['actual_qty'] = 0.0
            item_data['available_qty'] = 0.0
            item_data['reserved_qty'] = 0.0
            item_data['projected_qty'] = 0.0
            item_data['stock_reservations'] = []
            item_data['bin_stock'] = {
                "total_actual_qty": 0.0,
                "total_available_qty": 0.0,
                "total_reserved_qty": 0.0,
                "total_projected_qty": 0.0,
                "warehouses": []
            }

        # Remover sigla de compañía
        if company_abbr:
            original_code = item_data.get('item_code')
            if original_code:
                item_data['erp_item_code'] = original_code
                transformed_code = remove_company_abbr(original_code, company_abbr)
                item_data['item_code'] = transformed_code
                try:
                    if '104M1-38T' in (original_code or ''):
                        print(f"[DEBUG ITEM DETAILS] original: '{original_code}' -> transformed: '{transformed_code}'")
                except Exception:
                    pass
            if 'item_group' in item_data and item_data['item_group']:
                item_data['item_group'] = remove_company_abbr(item_data['item_group'], company_abbr)
            # Also remove abbr from item_name for display
            if 'item_name' in item_data and item_data.get('item_name'):
                try:
                    item_data['item_name'] = remove_company_abbr(item_data.get('item_name'), company_abbr)
                except Exception:
                    pass

        return jsonify({"success": True, "data": item_data})

    except Exception as e:
        print(f"Error en get_item_details: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_items_bp.route('/api/inventory/items/<path:item_code>/movements', methods=['GET'])
def get_item_movements(item_code):
    """Obtener movimientos de inventario de un item"""
    print(f"\n--- Petición para obtener movimientos del item: {item_code} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        if not company:
            company = get_active_company(user_id)
            if not company:
                return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía {company}"}), 400

        full_item_code = f"{item_code} - {company_abbr}" if not str(item_code).endswith(f" - {company_abbr}") else item_code
        print(f"🔍 Buscando item: {full_item_code}")

        response, error = make_erpnext_request(
            session=session, method="GET",
            endpoint=f"/api/resource/Item/{quote(full_item_code)}",
            operation_name=f"Fetch Item for Movements"
        )

        erp_item_code = full_item_code
        if not error and response and response.status_code == 200:
            item_data = response.json().get('data', {})
            erp_item_code = item_data.get('name') or item_data.get('item_code') or full_item_code
        else:
            # Fallback: try with provided code (could already include abbr)
            try:
                alt_resp, alt_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Item/{quote(item_code)}",
                    operation_name=f"Fetch Item fallback for Movements"
                )
                if not alt_err and alt_resp and alt_resp.status_code == 200:
                    alt_data = alt_resp.json().get('data', {})
                    erp_item_code = alt_data.get('name') or alt_data.get('item_code') or item_code
            except Exception:
                pass

        # Obtener registros del Stock Ledger Entry
        # Solo movimientos confirmados y no anulados
        filters = [["item_code", "=", erp_item_code], ["docstatus", "=", 1], ["is_cancelled", "=", 0]]
        fields = [
            "name", "posting_date", "posting_time", "warehouse",
            "actual_qty", "qty_after_transaction", "incoming_rate",
            "valuation_rate", "stock_value", "voucher_type",
            "voucher_no", "stock_uom", "company", "docstatus", "is_cancelled"
        ]

        params = {
            "fields": str(fields).replace("'", '"'),
            "filters": str(filters).replace("'", '"'),
            "order_by": "posting_date desc, posting_time desc",
            "limit_page_length": 500
        }

        response, error = make_erpnext_request(
            session=session, method="GET",
            endpoint="/api/resource/Stock Ledger Entry",
            operation_name="Fetch Stock Ledger Movements",
            params=params
        )

        if not response or response.status_code != 200:
            return handle_erpnext_error(error, "Failed to fetch stock movements")

        movements = response.json().get('data', [])
        print(f"Movimientos obtenidos del Stock Ledger: {len(movements)}")

        # Filtrar movimientos verificando el docstatus del documento voucher referenciado
        # Solo incluir movimientos donde el documento voucher también tenga docstatus=1
        filtered_movements = []
        voucher_cache = {}  # Cache para evitar consultas repetidas

        for movement in movements:
            voucher_type = movement.get('voucher_type')
            voucher_no = movement.get('voucher_no')
            
            if not voucher_type or not voucher_no:
                # Si no hay voucher, incluir el movimiento (caso raro pero posible)
                filtered_movements.append(movement)
                continue
            
            # Crear key para cache
            cache_key = f"{voucher_type}::{voucher_no}"
            
            # Verificar si ya consultamos este voucher
            if cache_key not in voucher_cache:
                try:
                    # Consultar el docstatus del voucher
                    voucher_response, voucher_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/{quote(voucher_type)}/{quote(voucher_no)}",
                        operation_name=f"Check Voucher Status",
                        params={"fields": '["docstatus"]'}
                    )
                    
                    if voucher_response and voucher_response.status_code == 200:
                        voucher_data = voucher_response.json().get('data', {})
                        voucher_docstatus = voucher_data.get('docstatus', 0)
                        voucher_cache[cache_key] = voucher_docstatus
                    elif voucher_response and voucher_response.status_code == 404:
                        # Voucher no encontrado - probablemente fue eliminado, excluir
                        print(f"Voucher no encontrado (404): {voucher_type} {voucher_no}")
                        voucher_cache[cache_key] = 0
                    else:
                        # Error de conexión u otro - incluir el movimiento para no perder datos
                        # El Stock Ledger Entry ya tiene docstatus=1, así que el movimiento es válido
                        print(f"Error verificando voucher {voucher_type} {voucher_no}, asumiendo válido (SLE ya tiene docstatus=1)")
                        voucher_cache[cache_key] = 1
                except Exception as voucher_ex:
                    print(f"Excepción al verificar voucher {voucher_type} {voucher_no}: {voucher_ex}")
                    # En caso de error de excepción, incluir el movimiento (el SLE ya tiene docstatus=1)
                    voucher_cache[cache_key] = 1
            
            # Solo incluir si el voucher tiene docstatus=1 (submitted/confirmado)
            if voucher_cache[cache_key] == 1:
                filtered_movements.append(movement)
            else:
                print(f"Movimiento excluido: voucher {voucher_type} {voucher_no} tiene docstatus={voucher_cache[cache_key]}")

        print(f"Movimientos filtrados después de verificar vouchers: {len(filtered_movements)}")

        # Enriquecer movimientos de Stock Reconciliation que tienen actual_qty = 0
        # Estos movimientos necesitan consultar el documento padre para obtener el quantity_difference real
        stock_reco_cache = {}  # Cache para Stock Reconciliation documents
        enriched_movements = []
        
        for movement in filtered_movements:
            voucher_type = movement.get('voucher_type', '')
            voucher_no = movement.get('voucher_no', '')
            actual_qty = float(movement.get('actual_qty', 0))
            
            # Si es Stock Reconciliation con qty = 0, necesitamos obtener el quantity_difference real
            if voucher_type == 'Stock Reconciliation' and actual_qty == 0 and voucher_no:
                if voucher_no not in stock_reco_cache:
                    try:
                        reco_response, reco_error = make_erpnext_request(
                            session=session,
                            method="GET",
                            endpoint=f"/api/resource/Stock Reconciliation/{quote(voucher_no)}",
                            operation_name=f"Fetch Stock Reconciliation {voucher_no}",
                            params={"fields": '["name", "items"]'}
                        )
                        if reco_response and reco_response.status_code == 200:
                            reco_data = reco_response.json().get('data', {})
                            stock_reco_cache[voucher_no] = reco_data.get('items', [])
                        else:
                            stock_reco_cache[voucher_no] = []
                    except Exception as e:
                        print(f"Error fetching Stock Reconciliation {voucher_no}: {e}")
                        stock_reco_cache[voucher_no] = []
                
                # Buscar el item en los items del Stock Reconciliation
                reco_items = stock_reco_cache.get(voucher_no, [])
                for reco_item in reco_items:
                    if reco_item.get('item_code') == erp_item_code:
                        # Obtener el quantity_difference - puede ser string o número
                        qty_diff = reco_item.get('quantity_difference', 0)
                        if isinstance(qty_diff, str):
                            try:
                                qty_diff = float(qty_diff)
                            except:
                                qty_diff = 0
                        
                        # Si hay un quantity_difference significativo, usarlo
                        if qty_diff != 0:
                            movement = dict(movement)  # Crear copia para no modificar el original
                            movement['actual_qty'] = qty_diff
                            movement['_enriched_from_reco'] = True
                            print(f"Stock Reconciliation {voucher_no}: enriched actual_qty from 0 to {qty_diff} for item {erp_item_code}")
                        break
            
            enriched_movements.append(movement)

        print(f"Movimientos enriquecidos: {len(enriched_movements)}")
        
        # Obtener reservas de stock activas para este item
        from routes.inventory_utils import fetch_stock_reservations
        reservation_map = fetch_stock_reservations(session, headers, [erp_item_code], company)
        stock_reservations = reservation_map.get(erp_item_code, {}).get("reservations", [])
        
        # Convertir reservas a formato de "movimientos" para mostrar en la tabla
        reservation_movements = []
        for res in stock_reservations:
            if res.get("effective_reserved", 0) > 0:
                reservation_movements.append({
                    "name": res.get("name"),
                    "posting_date": None,  # Las reservas no tienen fecha de posting
                    "posting_time": None,
                    "warehouse": res.get("warehouse"),
                    "actual_qty": 0,  # No es un movimiento físico
                    "reserved_qty": res.get("effective_reserved"),
                    "qty_after_transaction": None,
                    "incoming_rate": 0,
                    "valuation_rate": 0,
                    "stock_value": 0,
                    "voucher_type": res.get("voucher_type"),
                    "voucher_no": res.get("voucher_no"),
                    "stock_uom": None,
                    "company": company,
                    "docstatus": 1,
                    "is_cancelled": 0,
                    "is_reservation": True,  # Flag para identificar que es una reserva
                    "reservation_status": res.get("status")
                })
        
        print(f"Reservas de stock encontradas: {len(reservation_movements)}")
        
        return jsonify({
            "success": True, 
            "data": enriched_movements,
            "reservations": reservation_movements
        })

    except Exception as e:
        print(f"Error en get_item_movements: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_items_bp.route('/api/inventory/items/quick-create', methods=['POST'])
def quick_create_inventory_item():
    """Create an item directly from transactional documents and sync price lists."""
    print("\n--- Quick item creation request ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        payload = request.get_json(force=True) or {}
        company = (payload.get('company') or '').strip()
        if not company:
            return jsonify({"success": False, "message": "La compañía es requerida"}), 400

        # Obtener moneda por defecto de la empresa
        default_currency = get_company_default_currency(session, headers, company)
        if not default_currency:
            return jsonify({"success": False, "message": "No se pudo obtener la moneda por defecto de la compañía"}), 400

        supplier = (payload.get('supplier') or '').strip()
        if not supplier:
            return jsonify({"success": False, "message": "El proveedor es requerido para crear el item"}), 400

        price_list_name = (payload.get('price_list') or payload.get('purchase_price_list') or '').strip()
        if not price_list_name:
            return jsonify({"success": False, "message": "La lista de precios de compra es obligatoria"}), 400

        item_payload = payload.get('item') or {}
        required_fields = ['item_code', 'item_name', 'item_group', 'stock_uom']
        missing_fields = [field for field in required_fields if not str(item_payload.get(field) or '').strip()]
        if missing_fields:
            return jsonify({
                "success": False,
                "message": f"Faltan datos obligatorios del item: {', '.join(missing_fields)}"
            }), 400

        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la sigla para la compañía '{company}'"}), 400

        base_code = str(item_payload.get('item_code')).strip()
        full_item_code = add_company_abbr(base_code, company_abbr)

        purchase_rate_raw = (
            payload.get('price_list_rate')
            if payload.get('price_list_rate') is not None else payload.get('rate')
        )
        if purchase_rate_raw is None:
            purchase_rate_raw = item_payload.get('standard_rate') or item_payload.get('valuation_rate')
        if purchase_rate_raw is None:
            purchase_rate_raw = payload.get('purchase_price')
        if purchase_rate_raw is None:
            return jsonify({"success": False, "message": "El precio de compra es obligatorio"}), 400
        try:
            purchase_rate = round(float(purchase_rate_raw), 6)
        except Exception:
            return jsonify({"success": False, "message": "El precio de compra es inválido"}), 400

        currency = (payload.get('currency') or payload.get('price_list_currency') or default_currency).strip() or default_currency
        is_stock_item = _normalize_stock_flag(item_payload.get('is_stock_item', 1))

        requested_group = item_payload.get('item_group') or 'Services'
        ensured_group, group_error = _ensure_item_group(session, company, company_abbr, requested_group)
        if not ensured_group:
            return jsonify({"success": False, "message": group_error or "No se pudo asegurar el grupo de items"}), 400

        item_body = {
            "item_code": full_item_code,
            "item_name": item_payload.get('item_name') or base_code,
            "item_group": ensured_group,
            "stock_uom": item_payload.get('stock_uom') or 'Unit',
            "is_stock_item": is_stock_item,
            "is_purchase_item": 1,
            "is_sales_item": 1,
            "description": item_payload.get('description') or '',
            "standard_rate": purchase_rate,
            "valuation_rate": purchase_rate,
            "brand": item_payload.get('brand') or '',
            "custom_description_type": item_payload.get('custom_description_type') or 'Plain Text',
            "custom_company": company,
            "docstatus": 0,
            "allow_negative_stock": 1,
            "grant_commission": 1,
            "min_order_qty": item_payload.get('min_order_qty') or 0,
            "safety_stock": item_payload.get('safety_stock') or 0,
            "lead_time_days": item_payload.get('lead_time_days') or 0,
            "max_discount": item_payload.get('max_discount') or 0
        }

        expense_account = item_payload.get('expense_account')
        income_account = item_payload.get('income_account')
        default_warehouse = item_payload.get('default_warehouse')
        if any([expense_account, income_account, default_warehouse]):
            item_body['item_defaults'] = [{
                "company": company,
                "default_warehouse": default_warehouse,
                "expense_account": expense_account,
                "income_account": income_account
            }]

        response, error = make_erpnext_request(
            session=session, method="POST",
            endpoint="/api/resource/Item",
            operation_name="Quick Create Inventory Item",
            data={"data": item_body}
        )

        if not response or response.status_code not in [200, 201]:
            return handle_erpnext_error(error, "No se pudo crear el item")

        created_item = response.json().get('data', {})
        erp_item_name = created_item.get('name') or full_item_code

        custom_links = _extract_custom_links(item_payload)
        if custom_links:
            try:
                make_erpnext_request(
                    session=session, method="PUT",
                    endpoint=f"/api/resource/Item/{quote(erp_item_name)}",
                    operation_name="Quick Create - Update custom_product_links",
                    data={"data": {"custom_product_links": json.dumps(custom_links)}}
                )
                created_item['custom_product_links'] = custom_links
            except Exception as upd_exc:
                print(f"[QuickCreate] Error updating custom_product_links: {upd_exc}")

        # Ensure supplier is ERPNext-formatted with company abbreviation
        erpnext_supplier = supplier
        try:
            if company_abbr and supplier:
                original_supplier = supplier
                erpnext_supplier = add_company_abbr(supplier, company_abbr)
                # Validate operation: don't fail if invalid, just log a warning
                if not validate_company_abbr_operation(original_supplier, erpnext_supplier, company_abbr, 'add'):
                    print(f"[QuickCreate] Warning: Failed validate_company_abbr_operation for supplier: '{original_supplier}' -> '{erpnext_supplier}'")
                else:
                    print(f"[QuickCreate] Supplier name expanded for ERPNext: {erpnext_supplier}")
        except Exception as abbr_exc:
            print(f"[QuickCreate] Warning: Error adding company abbr to supplier: {abbr_exc}")

        price_entry, price_error = _ensure_purchase_price_entry(
            session,
            erp_item_name,
            price_list_name,
            purchase_rate,
            currency,
            erpnext_supplier
        )
        if price_error:
            print(f"[QuickCreate] Purchase price error: {price_error}")
            return jsonify({
                "success": False,
                "message": f"No se pudo guardar el precio en la lista '{price_list_name}': {price_error}"
            }), 500

        automation_result = None
        if payload.get('sync_sales_prices', True):
            try:
                automation_result = price_list_automation_service.schedule_price_list_recalculation(price_list_name, session)
            except Exception as automation_exc:
                print(f"[QuickCreate] Error scheduling automation: {automation_exc}")
                automation_result = {"success": False, "error": str(automation_exc)}

        update_company_item_count(company, 'increment')

        if company_abbr:
            original_code = created_item.get('item_code')
            if original_code:
                created_item['erp_item_code'] = original_code
                created_item['item_code'] = remove_company_abbr(original_code, company_abbr)
            if created_item.get('item_group'):
                created_item['item_group'] = remove_company_abbr(created_item['item_group'], company_abbr)
            if created_item.get('item_name'):
                try:
                    created_item['item_name'] = remove_company_abbr(created_item['item_name'], company_abbr)
                except Exception:
                    pass

        return jsonify({
            "success": True,
            "data": {
                "item": created_item,
                "purchase_price": price_entry,
                "automation": automation_result
            }
        })

    except Exception as e:
        print(f"Error en quick_create_inventory_item: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_items_bp.route('/api/inventory/items', methods=['POST'])
def create_inventory_item():
    """Crear un nuevo item de inventario"""
    print("\n--- Petición para crear item de inventario ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        company = data.get('company')
        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía '{company}'"}), 400

        original_item_code = data.get('item_code')
        if not original_item_code:
            return jsonify({"success": False, "message": "El código del item es requerido"}), 400

        full_item_code = f"{original_item_code} - {company_abbr}"

        # Verificar si ya existe
        check_response, check_error = query_items(
            session=session, headers=headers,
            filters=[["item_code", "=", full_item_code]],
            fields=["name"],
            limit_page_length=1,
            operation_name="Check Existing Item"
        )

        if check_response and check_response.status_code == 200:
            existing_items = check_response.json().get('data', [])
            if existing_items:
                return jsonify({"success": False, "message": f"Ya existe un item con el código '{full_item_code}'"}), 400

        requested_group = data.get('item_group') or 'Services'
        ensured_group, group_error = _ensure_item_group(session, company, company_abbr, requested_group)
        if not ensured_group:
            return jsonify({"success": False, "message": group_error or "No se pudo asegurar el grupo de items"}), 400

        # Construir el objeto del item
        item_body = {
            "item_code": full_item_code,
            "item_name": data.get('item_name'),
            "item_group": ensured_group,
            "stock_uom": data.get('stock_uom', 'Unit'),
            "is_stock_item": data.get('is_stock_item', 0),
            "description": data.get('description', ''),
            "standard_rate": data.get('standard_rate', 0),
            "opening_stock": data.get('opening_stock', 0),
            "valuation_rate": data.get('valuation_rate', 0),
            "is_sales_item": data.get('is_sales_item', 1),
            "is_purchase_item": data.get('is_purchase_item', 1),
            "grant_commission": data.get('grant_commission', 1),
            "min_order_qty": data.get('min_order_qty', 0),
            "safety_stock": data.get('safety_stock', 0),
            "lead_time_days": data.get('lead_time_days', 0),
            "max_discount": data.get('max_discount', 0),
            "custom_description_type": data.get('custom_description_type', 'Plain Text'),
            "brand": data.get('brand', ''),
            "custom_company": company,
            "docstatus": 0,
            "allow_negative_stock": 1
        }

        # Agregar configuraciones por defecto
        if data.get('expense_account') or data.get('income_account') or data.get('asset_account'):
            item_body['item_defaults'] = [{
                "company": company,
                "default_warehouse": data.get('default_warehouse'),
                "expense_account": data.get('expense_account'),
                "income_account": data.get('income_account'),
                "buying_cost_center": data.get('buying_cost_center'),
                "selling_cost_center": data.get('selling_cost_center')
            }]

        # Crear el item
        response, error = make_erpnext_request(
            session=session, method="POST",
            endpoint="/api/resource/Item",
            operation_name="Create Inventory Item",
            data={"data": item_body}
        )

        if not response or response.status_code not in [200, 201]:
            return handle_erpnext_error(error, "Failed to create inventory item")

        created_item = response.json().get('data', {})

        # Asignar templates de IVA si se especificó iva_percent
        iva_percent = data.get('iva_percent')
        if iva_percent is not None:
            try:
                iva_rate = float(iva_percent)
                item_name = created_item.get('name') or full_item_code
                # Asignar template de ventas
                assign_tax_template_by_rate(item_name, iva_rate, session, headers, company, transaction_type='sales')
                # Asignar template de compras
                assign_tax_template_by_rate(item_name, iva_rate, session, headers, company, transaction_type='purchase')
                print(f"--- IVA templates assigned for item {item_name} at rate {iva_rate}%")
            except Exception as tax_exc:
                print(f"Error asignando templates de IVA: {tax_exc}")

        # Si hay custom_product_links, actualizar
        custom_product_links = data.get('custom_product_links')
        if custom_product_links and len(custom_product_links) > 0:
            try:
                make_erpnext_request(
                    session=session, method="PUT",
                    endpoint=f"/api/resource/Item/{created_item.get('name')}",
                    operation_name="Update Custom Product Links",
                    data={"data": {"custom_product_links": json.dumps(custom_product_links)}}
                )
                created_item['custom_product_links'] = custom_product_links
            except Exception as upd_exc:
                print(f"Error actualizando custom_product_links: {upd_exc}")

        # Actualizar conteo
        update_company_item_count(company, 'increment')

        # Remover sigla
        if company_abbr:
            original_code = created_item.get('item_code')
            if original_code:
                created_item['erp_item_code'] = original_code
                created_item['item_code'] = remove_company_abbr(original_code, company_abbr)
            if 'item_group' in created_item and created_item['item_group']:
                created_item['item_group'] = remove_company_abbr(created_item['item_group'], company_abbr)
            # Also normalize item_name
            if 'item_name' in created_item and created_item.get('item_name'):
                try:
                    created_item['item_name'] = remove_company_abbr(created_item.get('item_name'), company_abbr)
                except Exception:
                    pass

        return jsonify({"success": True, "data": created_item})

    except Exception as e:
        print(f"Error en create_inventory_item: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_items_bp.route('/api/inventory/items/<path:item_code>', methods=['PUT'])
def update_inventory_item(item_code):
    """Actualizar un item de inventario existente"""
    print(f"\n--- Petición para actualizar item: {item_code} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        company = data.get('company') or get_active_company(user_id)

        # Resolve company abbr early so we can build the target ERP name
        company_abbr = get_company_abbr(session, headers, company) if company else None

        # Build target ERP resource name for the Item (route param item_code comes from frontend without abbr)
        target_item_name = item_code
        if company_abbr and not str(item_code).endswith(f" - {company_abbr}"):
            target_item_name = f"{item_code} - {company_abbr}"

        # Construir objeto de actualización
        update_body = {}
        
        # Campos básicos
        if 'item_name' in data:
            update_body['item_name'] = data['item_name']
        if 'description' in data:
            update_body['description'] = data['description']
        if 'standard_rate' in data:
            update_body['standard_rate'] = data['standard_rate']
        if 'valuation_rate' in data:
            update_body['valuation_rate'] = data['valuation_rate']
        if 'is_stock_item' in data:
            update_body['is_stock_item'] = data['is_stock_item']
        if 'stock_uom' in data:
            update_body['stock_uom'] = data['stock_uom']
        
        # Campos adicionales
        for field in ['is_sales_item', 'is_purchase_item', 'grant_commission',
                      'min_order_qty', 'safety_stock', 'lead_time_days', 'max_discount',
                      'custom_description_type', 'brand']:
            if field in data:
                update_body[field] = data[field]
        
        if 'custom_product_links' in data:
            update_body['custom_product_links'] = json.dumps(data['custom_product_links'])
        
        # Manejar opening_stock
        if 'opening_stock' in data:
            opening_stock_value = data['opening_stock']
            if opening_stock_value is not None and opening_stock_value > 0:
                valuation_rate = data.get('valuation_rate')
                if valuation_rate is None:
                    # Obtener del item existente
                    current_response, _ = query_items(
                            session=session, headers=headers,
                            filters=[["name", "=", target_item_name]],
                            fields=["valuation_rate", "standard_rate"],
                            limit_page_length=1,
                            operation_name="Fetch Current Item for Valuation Rate"
                        )
                    
                    if current_response and current_response.status_code == 200:
                        current_items = current_response.json().get('data', [])
                        if current_items:
                            valuation_rate = current_items[0].get('valuation_rate', 0)
                            if not valuation_rate:
                                valuation_rate = current_items[0].get('standard_rate', 0)
                
                if valuation_rate and valuation_rate > 0:
                    update_body['valuation_rate'] = valuation_rate
                    update_body['opening_stock'] = opening_stock_value
            elif opening_stock_value == 0:
                update_body['opening_stock'] = 0
                update_body['valuation_rate'] = 0

        # Campos de estado
        if 'docstatus' in data:
            update_body['docstatus'] = data['docstatus']
        if 'disabled' in data:
            update_body['disabled'] = data['disabled']

        # Actualizar configuraciones por compañía
        if 'item_defaults' in data and data['item_defaults']:
            update_body['item_defaults'] = data['item_defaults']

        # Actualizar el item
        response, error = make_erpnext_request(
            session=session, method="PUT",
            endpoint=f"/api/resource/Item/{quote(target_item_name)}",
            operation_name="Update Inventory Item",
            data={"data": update_body}
        )

        if not response or response.status_code != 200:
            return handle_erpnext_error(error, "Failed to update inventory item")

        updated_item = response.json().get('data', {})

        # Asignar templates de IVA si se especificó iva_percent
        iva_percent = data.get('iva_percent')
        if iva_percent is not None:
            try:
                iva_rate = float(iva_percent)
                # Asignar template de ventas
                assign_tax_template_by_rate(target_item_name, iva_rate, session, headers, company, transaction_type='sales')
                # Asignar template de compras
                assign_tax_template_by_rate(target_item_name, iva_rate, session, headers, company, transaction_type='purchase')
                print(f"--- IVA templates updated for item {target_item_name} at rate {iva_rate}%")
            except Exception as tax_exc:
                print(f"Error actualizando templates de IVA: {tax_exc}")

        # Remover sigla
        # company_abbr already resolved above
        if company_abbr:
            original_code = updated_item.get('item_code')
            if original_code:
                updated_item['erp_item_code'] = original_code
                updated_item['item_code'] = remove_company_abbr(original_code, company_abbr)
            if 'item_group' in updated_item and updated_item['item_group']:
                updated_item['item_group'] = remove_company_abbr(updated_item['item_group'], company_abbr)
            # Also normalize item_name
            if 'item_name' in updated_item and updated_item.get('item_name'):
                try:
                    updated_item['item_name'] = remove_company_abbr(updated_item.get('item_name'), company_abbr)
                except Exception:
                    pass

        return jsonify({"success": True, "data": updated_item})

    except Exception as e:
        print(f"Error en update_inventory_item: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_items_bp.route('/api/inventory/items/<path:item_code>', methods=['DELETE'])
def delete_inventory_item(item_code):
    """Eliminar un item de inventario"""
    print(f"\n--- Petición para eliminar item: {item_code} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía {company}"}), 400

        normalized_code = (item_code or '').strip()
        full_code = add_company_abbr(normalized_code, company_abbr)

        response, error = make_erpnext_request(
            session=session, method="DELETE",
            endpoint=f"/api/resource/Item/{quote(full_code)}",
            operation_name="Delete Inventory Item"
        )

        if not response or response.status_code != 202:
            return handle_erpnext_error(error, "Failed to delete inventory item")

        update_company_item_count(company, 'decrement')

        return jsonify({"success": True, "message": "Item eliminado exitosamente"})

    except Exception as e:
        print(f"Error en delete_inventory_item: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_items_bp.route('/api/inventory/items/bulk-delete', methods=['POST'])
def bulk_delete_inventory_items():
    """Eliminar múltiples items de inventario en un solo request.

    Body JSON expected: { company?: string, item_codes: ["CODE1", "CODE2", ...] }
    The API will normalize codes by appending the company's abbreviation when missing
    and attempt to delete each item calling ERPNext DELETE resource endpoint.
    Returns a per-item result array and summary counts.
    """
    print("\n--- Petición para eliminar múltiples items ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json(silent=True) or {}
        items = data.get('item_codes') or data.get('items') or []

        if not isinstance(items, list) or len(items) == 0:
            return jsonify({"success": False, "message": "Se requiere una lista de códigos (item_codes)"}), 400

        company = data.get('company') or get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No se pudo determinar la compañía"}), 400

        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía {company}"}), 400

        # Normalize and dedupe
        normalized = []
        seen = set()
        for code in items:
            if not code: continue
            s = str(code).strip()
            # If already a full ERP code (ends with " - {abbr}"), keep it
            if s.endswith(f" - {company_abbr}"):
                full = s
            else:
                full = f"{s} - {company_abbr}"
            if full in seen: continue
            seen.add(full)
            normalized.append(full)

        results = []
        success_count = 0
        fail_count = 0

        for full_code in normalized:
            try:
                print(f"Attempting to delete: {full_code}")
                resp, err = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Item/{quote(full_code)}",
                    operation_name=f"Bulk Delete Item {full_code}"
                )

                # ERPNext often returns 202 for asynchronous deletes
                if resp and resp.status_code in [200, 202, 204]:
                    results.append({"item": full_code, "success": True})
                    success_count += 1
                    try:
                        update_company_item_count(company, 'decrement')
                    except Exception:
                        # Count update shouldn't block deletion
                        pass
                else:
                    msg = None
                    if err:
                        msg = err.get('message')
                    elif resp is not None:
                        try:
                            parsed = resp.json()
                            msg = parsed.get('message') or str(parsed)
                        except Exception:
                            msg = resp.text[:500]

                    results.append({"item": full_code, "success": False, "message": msg or "Unknown error"})
                    fail_count += 1

            except Exception as exc:
                print(f"Error deleting {full_code}: {exc}")
                results.append({"item": full_code, "success": False, "message": str(exc)})
                fail_count += 1

        return jsonify({
            "success": True,
            "data": {
                "requested": len(normalized),
                "deleted_count": success_count,
                "failed_count": fail_count,
                "results": results
            }
        })

    except Exception as e:
        print(f"Error en bulk_delete_inventory_items: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
