"""
Módulo principal de inventario - Re-exporta todos los blueprints de inventario.
Este archivo mantiene compatibilidad con el código existente mientras delega
las operaciones a los módulos especializados.

NOTA: Este archivo contiene temporalmente los endpoints que faltan migrar a:
- inventory_stock.py (bulk-stock, stock-reconciliation, bulk-details)
- inventory_search.py (search-items, recognize-skus)
- inventory_warehouse.py (warehouse-tabs, warehouse-tab-items, stock transfer)
"""

from flask import Blueprint, request, jsonify
import datetime
import traceback
import json
from urllib.parse import quote

# Importar blueprints especializados
from routes.inventory_items import inventory_items_bp

# Importar utilidades compartidas
from routes.inventory_utils import round_qty, fetch_bin_stock, query_items

# Importar utilidades necesarias
from utils.http_utils import handle_erpnext_error, make_erpnext_request
from routes.auth_utils import get_session_with_auth
from routes.general import (
    remove_company_abbr, get_company_abbr, get_company_item_count,
    update_company_item_count, get_active_company, get_smart_limit
)
from utils.warehouse_tokens import tokenize_warehouse_name, ensure_warehouse
from routes.inventory_utils import fetch_item_iva_rates_bulk as _fetch_item_iva_rates_bulk

# Crear el blueprint principal (mantiene compatibilidad con app.py)
inventory_bp = Blueprint('inventory', __name__)

# Re-exportar para mantener compatibilidad
__all__ = [
    'inventory_bp',
    'inventory_items_bp',
    'round_qty',
    'fetch_bin_stock',
    'query_items'
]


# ============================================================================
# ENDPOINTS PENDIENTES DE MIGRAR
# ============================================================================


# ============================================================================
# PENDIENTE: Mover a inventory_stock.py
# ============================================================================

@inventory_bp.route('/api/inventory/items/bulk-stock', methods=['POST'])
def get_bulk_item_stock():
    """Obtener cantidades de stock para múltiples items a partir de Bin."""
    print("\n--- Petición para obtener stock de items visibles ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        payload = request.get_json(silent=True) or {}
        company = payload.get('company')
        items_payload = payload.get('items', [])
        include_bins = bool(payload.get('include_bins'))

        if not items_payload:
            return jsonify({"success": False, "message": "Se requiere lista de items"}), 400

        item_map = {}
        pending_codes = []

        for entry in items_payload:
            display_code = entry.get('display_code') or entry.get('item_code')
            erp_code = entry.get('erp_item_code') or entry.get('erp_code') or entry.get('full_item_code')

            if erp_code:
                item_map[erp_code] = {
                    "display_code": display_code or erp_code,
                    "erp_code": erp_code
                }
            elif display_code:
                pending_codes.append(display_code)

        company_abbr = None
        if company:
            company_abbr = get_company_abbr(session, headers, company)

        if pending_codes and company_abbr:
            for code in pending_codes:
                constructed_code = f"{code} - {company_abbr}"
                if constructed_code not in item_map:
                    item_map[constructed_code] = {
                        "display_code": code,
                        "erp_code": constructed_code
                    }

        if not item_map:
            return jsonify({"success": True, "data": {}})

        stock_map = fetch_bin_stock(session, headers, list(item_map.keys()), company)

        response_data = {}

        for erp_code, meta in item_map.items():
            stock_entry = stock_map.get(erp_code, {
                "total_actual_qty": 0.0,
                "total_reserved_qty": 0.0,
                "total_available_qty": 0.0,
                "total_projected_qty": 0.0,
                "bins": []
            })

            # actual_qty = cantidad física en almacén
            # reserved_qty = cantidad reservada por Sales Orders
            # available_qty = actual - reserved (disponible para nuevas órdenes)
            actual_qty = round_qty(stock_entry.get("total_actual_qty"))
            reserved_qty = round_qty(stock_entry.get("total_reserved_qty"))
            available_qty = round_qty(stock_entry.get("total_available_qty", actual_qty - reserved_qty))

            entry_data = {
                "actual_qty": actual_qty,
                "available_qty": available_qty,
                "reserved_qty": reserved_qty,
                "projected_qty": round_qty(stock_entry.get("total_projected_qty"))
            }

            if include_bins:
                warehouses = []
                for warehouse_entry in stock_entry.get("bins", []):
                    warehouse_name = warehouse_entry.get("warehouse")
                    warehouse_display = remove_company_abbr(warehouse_name, company_abbr)
                    bin_actual = round_qty(warehouse_entry.get("actual_qty"))
                    bin_reserved = round_qty(warehouse_entry.get("reserved_qty"))
                    bin_available = round_qty(warehouse_entry.get("available_qty", bin_actual - bin_reserved))
                    # NOTA: 'warehouse' = name (ID interno), 'warehouse_name' = display label
                    warehouses.append({
                        "warehouse": warehouse_name,  # Internal ERPNext name for operations
                        "warehouse_name": warehouse_display,  # Display label for frontend
                        "warehouse_display": warehouse_display,  # Deprecated alias for backward compatibility
                        "actual_qty": bin_actual,
                        "available_qty": bin_available,
                        "reserved_qty": bin_reserved,
                        "projected_qty": round_qty(warehouse_entry.get("projected_qty"))
                    })

                entry_data["warehouses"] = warehouses

            response_data[meta["display_code"]] = entry_data

        return jsonify({
            "success": True,
            "data": response_data
        })

    except Exception as e:
        print(f"Error en get_bulk_item_stock: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_bp.route('/api/inventory/stock-reconciliation', methods=['POST'])
def bulk_stock_reconciliation():
    """Crear reconciliaciones de stock para múltiples items"""
    print("\n--- Petición para reconciliación de stock masiva ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        stock_items = data.get('items', [])
        
        if not stock_items:
            return jsonify({"success": False, "message": "No se proporcionaron items para reconciliación"}), 400

        print(f"Items para reconciliación de stock: {len(stock_items)}")

        results = []
        reconciled_count = 0
        failed_count = 0

        for idx, stock_item in enumerate(stock_items):
            try:
                # Validar datos requeridos
                if not stock_item.get('item_code'):
                    results.append({
                        "index": idx + 1,
                        "item_code": stock_item.get('item_code', 'N/A'),
                        "success": False,
                        "error": "Código de item requerido"
                    })
                    failed_count += 1
                    continue

                if not stock_item.get('warehouse'):
                    results.append({
                        "index": idx + 1,
                        "item_code": stock_item.get('item_code', 'N/A'),
                        "success": False,
                        "error": "Almacén requerido"
                    })
                    failed_count += 1
                    continue

                new_stock = stock_item.get('new_stock', 0)
                if new_stock < 0:
                    results.append({
                        "index": idx + 1,
                        "item_code": stock_item.get('item_code', 'N/A'),
                        "success": False,
                        "error": "El stock no puede ser negativo"
                    })
                    failed_count += 1
                    continue

                company = stock_item.get('custom_company')
                if not company:
                    results.append({
                        "index": idx + 1,
                        "item_code": stock_item.get('item_code', 'N/A'),
                        "success": False,
                        "error": "Compañía requerida"
                    })
                    failed_count += 1
                    continue

                # Obtener abreviación de la compañía
                company_abbr = get_company_abbr(session, headers, company)
                if not company_abbr:
                    results.append({
                        "index": idx + 1,
                        "item_code": stock_item.get('item_code', 'N/A'),
                        "success": False,
                        "error": f"No se pudo obtener la abreviación para la compañía '{company}'"
                    })
                    failed_count += 1
                    continue

                # Construir código completo con sigla de compañía
                original_code = stock_item['item_code']
                if f" - {company_abbr}" not in original_code:
                    full_item_code = f"{original_code} - {company_abbr}"
                else:
                    full_item_code = original_code

                # Obtener el stock actual del item en el almacén
                try:
                    # Consultar stock actual
                    stock_response, stock_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint="/api/resource/Bin",
                        operation_name="Fetch Current Stock",
                        params={
                            "fields": '["actual_qty", "item_code", "warehouse"]',
                            "filters": f'[["item_code", "=", "{full_item_code}"], ["warehouse", "=", "{stock_item["warehouse"]}"]]',
                            "limit_page_length": 1
                        }
                    )
                    
                    current_stock = 0
                    if stock_response and stock_response.status_code == 200:
                        stock_data = stock_response.json().get('data', [])
                        if stock_data:
                            current_stock = stock_data[0].get('actual_qty', 0)
                    
                    print(f"Item {stock_item['item_code']}: stock actual = {current_stock}, nuevo stock = {new_stock}")
                    
                    # Solo crear reconciliación si el stock cambió
                    if abs(current_stock - new_stock) > 0.001:  # Usar tolerancia para decimales
                        # Crear Stock Reconciliation
                        reconciliation_body = {
                            "posting_date": datetime.datetime.now().strftime("%Y-%m-%d"),
                            "posting_time": datetime.datetime.now().strftime("%H:%M:%S"),
                            "purpose": "Stock Reconciliation",
                            "company": company,
                            "items": [{
                                "item_code": full_item_code,
                                "warehouse": stock_item["warehouse"],
                                "qty": new_stock,
                                "valuation_rate": 0  # Se calculará automáticamente
                            }]
                        }

                        try:
                            reco_response, reco_error = make_erpnext_request(
                                session=session,
                                method="POST",
                                endpoint="/api/resource/Stock Reconciliation",
                                operation_name="Create Stock Reconciliation",
                                data={"data": reconciliation_body}
                            )
                        except Exception as post_exc:
                            print(f"Error enviando Stock Reconciliation para {stock_item.get('item_code')}: {post_exc}")
                            print(f"Traceback: {traceback.format_exc()}")
                            results.append({
                                "index": idx + 1,
                                "item_code": stock_item.get('item_code'),
                                "success": False,
                                "error": f"Exception al llamar a ERPNext: {str(post_exc)}"
                            })
                            failed_count += 1
                            continue
                        
                        if reco_response and reco_response.status_code in [200, 201]:
                            reco_data = reco_response.json().get('data', {})
                            reco_name = reco_data.get('name')
                            print(f"✓ Stock Reconciliation creado: {reco_name} para item {original_code}")

                            # Submit the document
                            try:
                                update_body = {'docstatus': 1}
                                
                                # Include items with valuation_rate if provided
                                item_updates = [{
                                    'item_code': full_item_code,
                                    'warehouse': stock_item.get('warehouse'),
                                    'qty': stock_item.get('new_stock')
                                }]
                                
                                if stock_item.get('valuation_rate') is not None:
                                    item_updates[0]['valuation_rate'] = stock_item.get('valuation_rate')
                                else:
                                    # Try to get valuation rate from item
                                    try:
                                        item_resp, _ = query_items(
                                            session=session,
                                            headers=headers,
                                            filters=[["name", "=", full_item_code]],
                                            fields=["valuation_rate", "standard_rate"],
                                            limit_page_length=1,
                                            operation_name="Fetch Item Valuation Rate"
                                        )
                                        if item_resp and item_resp.status_code == 200:
                                            item_data_list = item_resp.json().get('data', [])
                                            if item_data_list:
                                                vr = item_data_list[0].get('valuation_rate') or item_data_list[0].get('standard_rate')
                                                if vr:
                                                    item_updates[0]['valuation_rate'] = vr
                                    except Exception:
                                        pass

                                update_body['items'] = item_updates

                                upd_resp, upd_error = make_erpnext_request(
                                    session=session,
                                    method="PUT",
                                    endpoint=f"/api/resource/Stock Reconciliation/{quote(reco_name)}",
                                    operation_name="Update Stock Reconciliation",
                                    data={"data": update_body}
                                )
                                if upd_resp and upd_resp.status_code in [200, 201]:
                                    print(f"✓ Stock Reconciliation {reco_name} actualizado correctamente")
                            except Exception as upd_exc:
                                print(f"Error actualizando Stock Reconciliation {reco_name}: {upd_exc}")
                            
                            results.append({
                                "index": idx + 1,
                                "item_code": original_code,
                                "success": True,
                                "reconciliation_name": reco_data.get('name'),
                                "old_stock": current_stock,
                                "new_stock": new_stock
                            })
                            reconciled_count += 1
                        else:
                            error_text = reco_response.text if reco_response else "No response"
                            try:
                                error_json = reco_response.json()
                                error_message = error_json.get('exception', error_json.get('_error_message', error_text))
                            except:
                                error_message = error_text
                            
                            results.append({
                                "index": idx + 1,
                                "item_code": original_code,
                                "success": False,
                                "error": f"Error al crear reconciliación: {error_message[:100]}"
                            })
                            failed_count += 1
                    else:
                        # Stock no cambió
                        results.append({
                            "index": idx + 1,
                            "item_code": original_code,
                            "success": True,
                            "message": "Stock sin cambios",
                            "current_stock": current_stock
                        })
                        reconciled_count += 1
                        
                except Exception as stock_error:
                    results.append({
                        "index": idx + 1,
                        "item_code": original_code,
                        "success": False,
                        "error": f"Error consultando stock: {str(stock_error)}"
                    })
                    failed_count += 1

            except Exception as item_error:
                results.append({
                    "index": idx + 1,
                    "item_code": stock_item.get('item_code', 'N/A'),
                    "success": False,
                    "error": str(item_error)
                })
                failed_count += 1

        return jsonify({
            "success": True,
            "message": f"Procesadas {len(stock_items)} reconciliaciones de stock",
            "reconciled_count": reconciled_count,
            "failed_count": failed_count,
            "results": results
        })

    except Exception as e:
        print(f"Error en bulk_stock_reconciliation: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_bp.route('/api/inventory/stock-reconciliation/<reco_name>', methods=['GET', 'PUT', 'OPTIONS'])
def stock_reconciliation_by_name(reco_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    if not reco_name:
        return jsonify({"success": False, "message": "Nombre de Stock Reconciliation requerido"}), 400

    try:
        if request.method == 'GET':
            reco_resp, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Stock Reconciliation/{quote(reco_name)}",
                operation_name=f"Fetch Stock Reconciliation {reco_name}"
            )
            if error:
                return handle_erpnext_error(error, "Error al obtener Stock Reconciliation")
            if reco_resp.status_code != 200:
                return jsonify({"success": False, "message": reco_resp.text}), reco_resp.status_code

            return jsonify({"success": True, "data": reco_resp.json().get("data", {})})

        payload = request.get_json(silent=True) or {}
        docstatus = payload.get("docstatus")
        if docstatus is None and isinstance(payload.get("data"), dict):
            docstatus = payload["data"].get("docstatus")

        try:
            docstatus_int = int(docstatus) if docstatus is not None else 2
        except Exception:
            docstatus_int = 2

        if docstatus_int != 2:
            return jsonify({"success": False, "message": "Solo se permite cancelar (docstatus=2)"}), 400

        cancel_resp, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Stock Reconciliation/{quote(reco_name)}",
            operation_name=f"Cancel Stock Reconciliation {reco_name}",
            data={"data": {"docstatus": 2}}
        )
        if error:
            return handle_erpnext_error(error, "Error al cancelar Stock Reconciliation")
        if cancel_resp.status_code not in (200, 201):
            return jsonify({"success": False, "message": cancel_resp.text}), cancel_resp.status_code

        return jsonify({"success": True, "message": "Stock Reconciliation cancelado correctamente"})
    except Exception as e:
        print(f"Error en stock_reconciliation_by_name: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@inventory_bp.route('/api/inventory/items/bulk-details', methods=['POST'])
def get_bulk_item_details():
    """Obtener detalles masivos de items para optimizar el procesamiento de listas de precios"""
    print("\n--- Petición para obtener detalles masivos de items ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        item_codes = data.get('item_codes', [])
        company = get_active_company(user_id)
        price_list = data.get('price_list')

        if not item_codes:
            return jsonify({"success": False, "message": "Se requiere lista de códigos de items"}), 400

        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        print(f"Procesando {len(item_codes)} códigos para compañía: {company}")

        # Obtener todos los items de la compañía
        fields = [
            "name", "item_code", "item_name", "description",
            "item_group", "brand", "stock_uom", "is_stock_item"
        ]

        item_count = get_company_item_count(company)
        smart_limit = get_smart_limit(company, 'list')
        limit = max(smart_limit, item_count + 1000)

        base_filters = [
            ["disabled", "=", 0],
            ["custom_company", "=", company],
            ["docstatus", "in", [0, 1]]
        ]

        response, error = query_items(
            session=session,
            headers=headers,
            filters=base_filters,
            fields=fields,
            limit_page_length=limit,
            operation_name="Get All Company Items for Bulk Details"
        )

        if error:
            return jsonify({"success": False, "message": "Error al obtener items de la compañía"}), 500

        all_items = response.json().get('data', [])
        company_abbr = get_company_abbr(session, headers, company)
        items_map = {}

        for item in all_items:
            erp_code = item.get('name') or item.get('item_code')
            if erp_code:
                items_map[erp_code] = item
                if company_abbr:
                    clean_code = remove_company_abbr(erp_code, company_abbr)
                    items_map[clean_code] = item

        # Obtener precios si se especificó lista
        prices_map = {}
        if price_list:
            price_filters = [["price_list", "=", price_list]]
            price_limit = get_smart_limit(company, 'list')
            price_params = {
                "fields": json.dumps(["item_code", "price_list_rate"]),
                "filters": json.dumps(price_filters),
                "limit_page_length": price_limit
            }

            price_response, price_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Item Price",
                params=price_params,
                operation_name=f"Get prices for list {price_list}"
            )

            if not price_error:
                price_data = price_response.json().get('data', [])
                for price_entry in price_data:
                    item_code = price_entry.get('item_code')
                    if item_code:
                        prices_map[item_code] = price_entry.get('price_list_rate', 0)

            # NOTE: No fallback here — only use prices that belong to the specified price_list.
            # If no prices are found for the given price_list, prices_map remains empty.

        def strip_company_suffix(value):
            if not company_abbr or not isinstance(value, str):
                return value
            suffix = f" - {company_abbr}"
            return value[:-len(suffix)] if value.endswith(suffix) else value

        # Procesar códigos solicitados
        result_items = []
        for requested_code in item_codes:
            if not requested_code:
                continue

            # SIEMPRE buscar con la abreviatura de compañía
            search_code = requested_code
            if company_abbr and ' - ' not in requested_code:
                search_code = f"{requested_code} - {company_abbr}"

            item_data = None
            if search_code in items_map:
                item_data = items_map[search_code]

            if item_data:
                erp_code = item_data.get('name') or item_data.get('item_code')
                clean_code = remove_company_abbr(erp_code, company_abbr) if company_abbr else erp_code
                raw_name = item_data.get('item_name') or item_data.get('description') or ''
                raw_group = item_data.get('item_group') or ''

                result_item = {
                    "item_code": clean_code,
                    "erp_item_code": erp_code,
                    "item_name": strip_company_suffix(raw_name),
                    "item_group": strip_company_suffix(raw_group),
                    "brand": item_data.get('brand') or '',
                    "stock_uom": item_data.get('stock_uom') or 'Unit',
                    "is_stock_item": item_data.get('is_stock_item') or 0,
                    "existing_price": prices_map.get(erp_code, 0),
                    "found": True
                }
            else:
                result_item = {
                    "item_code": requested_code,
                    "erp_item_code": None,
                    "item_name": '',
                    "item_group": '',
                    "brand": '',
                    "stock_uom": 'Unit',
                    "is_stock_item": 0,
                    "existing_price": 0,
                    "found": False
                }

            result_items.append(result_item)

        return jsonify({
            "success": True,
            "data": result_items
        })

    except Exception as e:
        print(f"Error en get_bulk_item_details: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


# ============================================================================
# PENDIENTE: Mover a inventory_search.py
# ============================================================================

@inventory_bp.route('/api/inventory/search-items', methods=['GET'])
def search_inventory_items():
    """Buscar items de inventario con límites inteligentes basados en conteo de compañía"""
    print("\n--- Petición para buscar items de inventario ---")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        query_param = request.args.get('query', '').strip()
        field = request.args.get('field', 'item_code')

        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        if not query_param or len(query_param) < 2:
            return jsonify({"success": True, "data": []}), 200

        item_count = get_company_item_count(company)
        search_limit = max(get_smart_limit(company, 'search'), item_count + 100)

        fields = [
            "name", "item_code", "item_name", "item_group",
            "description", "custom_company", "stock_uom", "item_defaults",
            # Include is_stock_item so clients can tell products vs services without extra fetches
            "is_stock_item"
        ]

        filters = [
            ["disabled", "=", 0],
            ["custom_company", "=", company],
            ["docstatus", "in", [0, 1]]
        ]

        or_filters = []
        if field == 'item_code':
            or_filters.append(["item_code", "like", f"{query_param}%"])
            or_filters.append(["name", "like", f"{query_param}%"])
        elif field == 'description':
            like_query = f"%{query_param}%"
            or_filters.append(["item_name", "like", like_query])
            or_filters.append(["description", "like", like_query])
            or_filters.append(["item_code", "like", like_query])

        response, error = query_items(
            session=session,
            headers=headers,
            filters=filters,
            fields=fields,
            limit_page_length=search_limit,
            order_by="modified desc",
            or_filters=or_filters,
            include_child_tables=["item_defaults"],
            operation_name="Search Inventory Items"
        )

        if not response or response.status_code != 200:
            return handle_erpnext_error(error, "Failed to search inventory items")

        items_data = response.json().get('data', [])
        filtered_items = [item for item in items_data if item.get('docstatus', 0) in [0, 1]]
        filtered_items = filtered_items[:20]

        company_abbr = get_company_abbr(session, headers, company) if company else None
        print(f"🏢 Company abbreviation: {company_abbr}")
        if company_abbr:
            for item in filtered_items:
                if 'item_code' in item and item['item_code']:
                    original_code = item['item_code']
                    display_code = remove_company_abbr(original_code, company_abbr)
                    item['display_code'] = display_code
                    print(f"✂️ Procesado: {original_code} -> display_code: {display_code}")
                else:
                    item['display_code'] = item.get('name', '')
        else:
            print("⚠️ No company_abbr found, display_code NOT added to items")

        print(f"📦 Returning {len(filtered_items)} items")
        if filtered_items:
            print(f"📋 First item keys: {list(filtered_items[0].keys())}")
            print(f"📋 First item display_code: {filtered_items[0].get('display_code', 'NOT FOUND')}")

        return jsonify({
            "success": True,
            "data": filtered_items,
            "company_abbr": company_abbr
        })

    except Exception as e:
        print(f"Error en search_inventory_items: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@inventory_bp.route('/api/inventory/items/recognize-skus', methods=['POST'])
def recognize_skus():
    """Reconoce SKUs masivamente en el backend"""
    print("\n--- Petición para reconocer SKUs masivamente ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        payload = request.get_json(silent=True) or {}
        company = payload.get('company')
        skus = payload.get('skus', [])
        
        if not company:
            return jsonify({"success": False, "message": "Compañía es requerida"}), 400
        
        if not skus or not isinstance(skus, list):
            return jsonify({"success": False, "message": "Lista de SKUs es requerida"}), 400
        
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura de la compañía: {company}"}), 400
        
        # Construir SKUs con abreviatura
        sku_with_abbr_map = {}
        for sku in skus:
            if not sku or not isinstance(sku, str):
                continue
            
            sku_clean = sku.strip()
            if not sku_clean:
                continue
            
            sku_with_abbr = sku_clean
            if not sku_clean.endswith(f" - {company_abbr}"):
                sku_with_abbr = f"{sku_clean} - {company_abbr}"
            
            sku_with_abbr_map[sku_clean] = sku_with_abbr
        
        if not sku_with_abbr_map:
            return jsonify({"success": False, "message": "No hay SKUs válidos para procesar"}), 400
        
        # Consultar items del inventario
        smart_limit = get_smart_limit(company, operation_type='list')
        
        fields = [
            "name", "item_code", "item_name", "description", 
            "stock_uom", "is_stock_item", "standard_rate",
            "valuation_rate", "item_group", "docstatus",
            "brand", "item_defaults"
        ]
        
        filters = [
            ["disabled", "=", 0],
            ["custom_company", "=", company],
            ["docstatus", "in", [0, 1]]
        ]
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item",
            params={
                "fields": json.dumps(fields),
                "filters": json.dumps(filters),
                "limit_page_length": smart_limit
            },
            operation_name="Get all company items for SKU recognition"
        )
        
        if error:
            return handle_erpnext_error(error, "Error obteniendo items del inventario")
        
        inventory_items = response.json().get('data', [])
        inventory_map = {}
        for item in inventory_items:
            item_code = item.get('item_code') or item.get('name')
            if item_code:
                inventory_map[item_code] = item
        
        # Comparar SKUs con inventario
        recognized_items = {}
        unrecognized_skus = []
        
        for sku_clean, sku_with_abbr in sku_with_abbr_map.items():
            if sku_with_abbr in inventory_map:
                item = inventory_map[sku_with_abbr].copy()
                
                if 'item_code' in item:
                    item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)
                if 'name' in item:
                    item['name'] = remove_company_abbr(item['name'], company_abbr)
                if 'item_group' in item and item['item_group']:
                    item['item_group'] = remove_company_abbr(item['item_group'], company_abbr)
                
                if 'custom_product_links' in item and item['custom_product_links']:
                    try:
                        if isinstance(item['custom_product_links'], str):
                            item['custom_product_links'] = json.loads(item['custom_product_links'])
                    except (json.JSONDecodeError, TypeError):
                        item['custom_product_links'] = []
                
                recognized_items[sku_clean] = item
            else:
                unrecognized_skus.append(sku_clean)
        
        # Obtener tasas de IVA para los items reconocidos
        if recognized_items:
            # Construir lista de item_names CON abbreviation para la búsqueda de IVA
            item_names_with_abbr = []
            for sku_clean, sku_with_abbr in sku_with_abbr_map.items():
                if sku_clean in recognized_items:
                    item_names_with_abbr.append(sku_with_abbr)
            
            if item_names_with_abbr:
                iva_rates = _fetch_item_iva_rates_bulk(session, headers, item_names_with_abbr, company)
                
                # Agregar iva_rate a cada item reconocido
                for sku_clean, item in recognized_items.items():
                    sku_with_abbr = sku_with_abbr_map.get(sku_clean)
                    if sku_with_abbr and sku_with_abbr in iva_rates:
                        item['iva_rate'] = iva_rates[sku_with_abbr].get('iva_rate')
                        item['taxes'] = iva_rates[sku_with_abbr].get('taxes', [])
        
        return jsonify({
            "success": True,
            "data": {
                "recognized_items": recognized_items,
                "unrecognized_skus": unrecognized_skus,
                "total_skus": len(sku_with_abbr_map),
                "recognized_count": len(recognized_items),
                "unrecognized_count": len(unrecognized_skus),
                "company_abbr": company_abbr
            }
        })
        
    except Exception as e:
        print(f"❌ Error en recognize_skus: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error reconociendo SKUs: {str(e)}"}), 500


# ============================================================================
# PENDIENTE: Mover a inventory_warehouse.py
# ============================================================================

def sum_quantities_by_role(bins, company_abbr):
    """Suma cantidades de bins agrupadas por rol de warehouse (OWN, CON, VCON)."""
    quantities = {'own': 0.0, 'con': 0.0, 'vcon': 0.0, 'total': 0.0}
    
    for bin_entry in bins:
        warehouse = bin_entry.get('warehouse', '')
        qty = round_qty(bin_entry.get('actual_qty', 0))
        
        tokens = tokenize_warehouse_name(warehouse)
        if tokens:
            role = tokens['role'].lower()
            if role in quantities:
                quantities[role] += qty
        
        quantities['total'] += qty
    
    return quantities


def build_role_flags_and_suppliers(warehouse_bins, company_abbr):
    """Construye flags de roles y listas de proveedores a partir de bins."""
    flags = {
        'has_own': False,
        'has_con': False, 
        'has_vcon': False,
        'con_suppliers': [],
        'vcon_suppliers': []
    }
    
    for bin_entry in warehouse_bins:
        warehouse = bin_entry.get('warehouse', '')
        tokens = tokenize_warehouse_name(warehouse)
        if tokens:
            role = tokens['role']
            supplier = tokens.get('supplier_code')
            
            if role == 'OWN':
                flags['has_own'] = True
            elif role == 'CON':
                flags['has_con'] = True
                if supplier and supplier not in flags['con_suppliers']:
                    flags['con_suppliers'].append(supplier)
            elif role == 'VCON':
                flags['has_vcon'] = True
                if supplier and supplier not in flags['vcon_suppliers']:
                    flags['vcon_suppliers'].append(supplier)
    
    return flags


@inventory_bp.route('/api/stock/warehouse-tabs', methods=['GET', 'OPTIONS'])
def get_warehouse_tabs():
    """Obtener vista de tabs de warehouses agrupados por base_code"""
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        min_qty = float(request.args.get('min_qty', 0))
        search = request.args.get('search', '').strip()
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 50))

        if not company:
            return jsonify({'success': False, 'message': 'Parámetro company requerido'}), 400

        stock_map = fetch_bin_stock(session, headers, None, company)

        if not stock_map:
            return jsonify({'success': True, 'data': [], 'total': 0, 'page': page, 'page_size': page_size})

        base_groups = {}

        for item_code, stock_info in stock_map.items():
            bins = stock_info.get('bins', [])
            
            for bin_entry in bins:
                warehouse = bin_entry.get('warehouse', '')
                qty = round_qty(bin_entry.get('actual_qty', 0))
                
                if qty <= min_qty:
                    continue
                
                tokens = tokenize_warehouse_name(warehouse)
                if not tokens:
                    continue
                
                base_code = tokens['base_code']
                
                if base_code not in base_groups:
                    base_groups[base_code] = {
                        'base_code': base_code,
                        'qty_total': 0.0,
                        'qty_own': 0.0,
                        'qty_con': 0.0,
                        'qty_vcon': 0.0,
                        'has_own': False,
                        'has_con': False,
                        'has_vcon': False,
                        'con_suppliers': [],
                        'vcon_suppliers': []
                    }
                
                group = base_groups[base_code]
                group['qty_total'] += qty
                
                role = tokens['role']
                supplier = tokens.get('supplier_code')
                
                if role == 'OWN':
                    group['qty_own'] += qty
                    group['has_own'] = True
                elif role == 'CON':
                    group['qty_con'] += qty
                    group['has_con'] = True
                    if supplier and supplier not in group['con_suppliers']:
                        group['con_suppliers'].append(supplier)
                elif role == 'VCON':
                    group['qty_vcon'] += qty
                    group['has_vcon'] = True
                    if supplier and supplier not in group['vcon_suppliers']:
                        group['vcon_suppliers'].append(supplier)

        filtered_groups = [g for g in base_groups.values() if g['qty_total'] > 0]

        if search:
            search_lower = search.lower()
            filtered_groups = [g for g in filtered_groups if search_lower in g['base_code'].lower()]

        filtered_groups.sort(key=lambda x: x['qty_total'], reverse=True)

        total = len(filtered_groups)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_groups = filtered_groups[start_idx:end_idx]

        return jsonify({
            'success': True,
            'data': paginated_groups,
            'total': total,
            'page': page,
            'page_size': page_size
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'Error interno del servidor: {str(e)}'}), 500


@inventory_bp.route('/api/stock/warehouse-tab-items', methods=['GET', 'OPTIONS'])
def get_warehouse_tab_items():
    """Obtener items con stock desglosado por rol para un base_code específico"""
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        base_code = request.args.get('base_code')
        min_qty = float(request.args.get('min_qty', 0))
        search = request.args.get('search', '').strip()
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 50))

        if not company or not base_code:
            return jsonify({'success': False, 'message': 'Parámetros company y base_code requeridos'}), 400

        stock_map = fetch_bin_stock(session, headers, None, company)

        if not stock_map:
            return jsonify({'success': True, 'data': [], 'total': 0, 'page': page, 'page_size': page_size})

        items_data = []

        for item_code, stock_info in stock_map.items():
            bins = stock_info.get('bins', [])
            
            relevant_bins = []
            for bin_entry in bins:
                warehouse = bin_entry.get('warehouse', '')
                tokens = tokenize_warehouse_name(warehouse)
                if tokens and tokens['base_code'] == base_code:
                    relevant_bins.append(bin_entry)
            
            if not relevant_bins:
                continue
            
            item_quantities = {
                'item_code': item_code,
                'qty_own': 0.0,
                'qty_con': 0.0,
                'qty_vcon': 0.0,
                'qty_total': 0.0,
                'suppliers': []
            }
            
            for bin_entry in relevant_bins:
                warehouse = bin_entry.get('warehouse', '')
                qty = round_qty(bin_entry.get('actual_qty', 0))
                
                tokens = tokenize_warehouse_name(warehouse)
                if tokens:
                    role = tokens['role']
                    supplier = tokens.get('supplier_code')
                    
                    if role == 'OWN':
                        item_quantities['qty_own'] += qty
                    elif role == 'CON':
                        item_quantities['qty_con'] += qty
                        if supplier and supplier not in item_quantities['suppliers']:
                            item_quantities['suppliers'].append(supplier)
                    elif role == 'VCON':
                        item_quantities['qty_vcon'] += qty
                        if supplier and supplier not in item_quantities['suppliers']:
                            item_quantities['suppliers'].append(supplier)
                    
                    item_quantities['qty_total'] += qty
            
            if item_quantities['qty_total'] > min_qty:
                items_data.append(item_quantities)

        if search:
            search_lower = search.lower()
            items_data = [item for item in items_data if search_lower in item['item_code'].lower()]

        items_data.sort(key=lambda x: x['qty_total'], reverse=True)

        total = len(items_data)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_items = items_data[start_idx:end_idx]

        return jsonify({
            'success': True,
            'data': paginated_items,
            'total': total,
            'page': page,
            'page_size': page_size
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'Error interno del servidor: {str(e)}'}), 500


@inventory_bp.route('/api/stock/transfer', methods=['POST'])
def create_stock_transfer():
    """Crear una transferencia de stock entre depósitos"""
    print("\n--- Petición para crear transferencia de stock ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()

        required_fields = ['from', 'to', 'items', 'posting_date', 'company']
        for field in required_fields:
            if field not in data:
                return jsonify({"success": False, "message": f"Campo requerido faltante: {field}"}), 400

        from_data = data['from']
        to_data = data['to']
        items = data['items']
        posting_date = data['posting_date']
        company = data['company']

        for location, location_data in [('from', from_data), ('to', to_data)]:
            if not all(key in location_data for key in ['base_code', 'role']):
                return jsonify({"success": False, "message": f"Campos requeridos faltantes en {location}: base_code, role"}), 400

        from_result = ensure_warehouse(
            session, headers, company,
            from_data['base_code'], 
            from_data['role'], 
            from_data.get('supplier')
        )
        from_warehouse = from_result['name']
        from_auto_created = from_result['auto_created']

        to_result = ensure_warehouse(
            session, headers, company,
            to_data['base_code'], 
            to_data['role'], 
            to_data.get('supplier')
        )
        to_warehouse = to_result['name']
        to_auto_created = to_result['auto_created']

        stock_entry_items = []
        for item in items:
            if not all(key in item for key in ['item_code', 'qty']):
                return jsonify({"success": False, "message": "Cada item debe tener item_code y qty"}), 400
            
            company_abbr = get_company_abbr(session, headers, company)
            if company_abbr:
                full_item_code = f"{item['item_code']} - {company_abbr}"
            else:
                full_item_code = item['item_code']

            stock_entry_items.append({
                "item_code": full_item_code,
                "qty": item['qty'],
                "s_warehouse": from_warehouse,
                "t_warehouse": to_warehouse,
                "uom": item.get('uom', 'Unit'),
                "transfer_qty": item['qty']
            })

        stock_entry_data = {
            "purpose": "Material Transfer",
            "posting_date": posting_date,
            "company": company,
            "from_warehouse": from_warehouse,
            "to_warehouse": to_warehouse,
            "items": stock_entry_items,
            "docstatus": 1
        }

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Stock Entry",
            operation_name="Create Stock Transfer",
            data={"data": stock_entry_data}
        )

        if not response or response.status_code not in [200, 201]:
            return handle_erpnext_error(error, "Failed to create stock transfer")

        created_transfer = response.json().get('data', {})

        return jsonify({
            "success": True,
            "data": created_transfer,
            "warehouses": {
                "from": {
                    "name": from_warehouse,
                    "auto_created": from_auto_created
                },
                "to": {
                    "name": to_warehouse,
                    "auto_created": to_auto_created
                }
            }
        })

    except Exception as e:
        print(f"Error en create_stock_transfer: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
