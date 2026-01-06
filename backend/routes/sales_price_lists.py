from flask import Blueprint, request, jsonify
import requests
import datetime
import traceback
import json
import uuid
import threading
import time
import csv
import io
import math
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Almacenamiento temporal de progreso de importaciones
sales_import_progress = {}

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr, get_active_company
from routes.price_list_automation import _translate_and_sanitize_formula, safe_eval_formula

# Importar función para calcular límites inteligentes
from routes.general import get_smart_limit

# Importar CORS para manejo específico
from flask_cors import cross_origin

# Crear el blueprint para las rutas de sales price lists
sales_price_lists_bp = Blueprint('sales_price_lists', __name__)


@sales_price_lists_bp.route('/api/sales-price-lists/<path:price_list_name>', methods=['OPTIONS'])
@cross_origin(supports_credentials=True)
def handle_sales_price_lists_options(price_list_name):
    """Manejar solicitudes OPTIONS para CORS"""
    return '', 200


@sales_price_lists_bp.route('/api/sales-price-lists', methods=['GET'])
def get_sales_price_lists():
    """Obtener todas las listas de precios de venta existentes"""
    print("\n--- Petición para obtener listas de precios de venta ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        active_company = get_active_company(user_id)
        if not active_company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        # Obtener todas las Price Lists de venta (selling=1) y propias de la compañía
        filters = [["selling", "=", 1], ["custom_company", "=", active_company]]

        # Include custom_exchange_rate so frontend can interpret exchange mode
        search_params = {
            "fields": '["name", "price_list_name", "currency", "custom_exchange_rate", "enabled", "creation", "modified"]',
            "filters": json.dumps(filters),
            "order_by": "modified desc",
            "limit_page_length": 100
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Price List",
            params=search_params,
            operation_name="Get sales price lists"
        )

        if error:
            print(f"❌ Error obteniendo Sales Price Lists: {error}")
            return jsonify({"success": False, "message": f"Error obteniendo listas de precios de venta: {error}"}), response.status_code if hasattr(response, 'status_code') else 500

        if response.status_code == 200:
            data = response.json()
            price_lists = data.get('data', [])
            print(f"📋 Sales Price Lists encontradas: {len(price_lists)}")

            # Normalize exchange_rate_mode for each price list (general if custom_exchange_rate == -1)
            for pl in price_lists:
                try:
                    cer = pl.get('custom_exchange_rate')
                    if cer is not None and float(cer) == -1:
                        pl['exchange_rate_mode'] = 'general'
                    else:
                        pl['exchange_rate_mode'] = 'specific'
                except Exception:
                    pl['exchange_rate_mode'] = 'specific'

            return jsonify({
                "success": True,
                "data": price_lists
            })
        else:
            print(f"❌ Error obteniendo Sales Price Lists: {response.text}")
            return jsonify({"success": False, "message": f"Error obteniendo listas de precios de venta: {response.text}"}), response.status_code

    except Exception as e:
        print(f"❌ Error en get_sales_price_lists: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/<path:price_list_name>', methods=['GET'])
def get_sales_price_list_by_name(price_list_name):
    """Obtener detalles de una lista de precios de venta específica"""
    print(f"\n--- Obteniendo detalles de lista de precios de venta: {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        requested_company = request.args.get('company') or get_active_company(user_id)
        if not requested_company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        # Obtener detalles de la Price List
        detail_response, detail_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Price List/{quote(price_list_name)}",
            operation_name=f"Get sales price list details for '{price_list_name}'"
        )

        if detail_error:
            print(f"❌ Sales Price List no encontrada: {detail_error}")
            return jsonify({"success": False, "message": "Lista de precios de venta no encontrada"}), 404

        if detail_response.status_code == 200:
            price_list_data = detail_response.json().get('data', {})
            pl_company = price_list_data.get('custom_company')
            if pl_company != requested_company:
                return jsonify({"success": False, "message": "Acceso no autorizado a la lista de precios solicitada"}), 403
            print(f"📋 Sales Price List encontrada: {price_list_data.get('price_list_name')}")

            # Obtener los precios asociados a esta lista de venta
            filters = [
                ["price_list", "=", price_list_name],
                ["selling", "=", 1]
            ]

            # Determinar compañía activa / abbr para usar en smart_limit y sanitizar nombres
            try:
                active_company = get_active_company(user_id)
            except Exception:
                active_company = None

            # Prefer company query param if provided (frontend can pass explicit company)
            req_company = request.args.get('company') or None
            company_for_limits = req_company or active_company or price_list_name

            try:
                company_abbr = get_company_abbr(session, headers, req_company or active_company) if (req_company or active_company) else None
            except Exception:
                company_abbr = None

            smart_limit = get_smart_limit(company_for_limits, 'get')

            prices_data = []
            limit_start = 0
            iteration = 0
            max_iterations = 200
            while True:
                params = {
                    "fields": '["name", "item_code", "item_name", "supplier", "currency", "price_list_rate", "valid_from", "valid_upto", "buying", "selling"]',
                    "filters": json.dumps(filters),
                    "limit_page_length": smart_limit,
                    "limit_start": limit_start
                }

                prices_response, prices_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Item Price",
                    params=params,
                    operation_name=f"Get prices for sales price list '{price_list_name}' (page {iteration + 1})"
                )

                if prices_error:
                    print(f"?? Error obteniendo precios de venta: {prices_error}")
                    break
                if prices_response.status_code != 200:
                    print(f"?? Error obteniendo precios de venta: {prices_response.text}")
                    break

                batch = prices_response.json().get('data', []) or []
                prices_data.extend(batch)
                print(f"?? Precios de venta acumulados: {len(prices_data)} (último lote: {len(batch)})")

                if len(batch) < smart_limit:
                    break

                iteration += 1
                if iteration >= max_iterations:
                    print(f"?? Se alcanzó el máximo de iteraciones ({max_iterations}) al paginar precios de venta.")
                    break

                limit_start += smart_limit


            # Si se solicita filtrar por kits O items, obtener la lista de Product Bundle -> new_item_code
            item_type = request.args.get('item_type')
            if item_type in ('kits', 'items', None):
                # Obtener lista de kits para filtrar (incluir en kits mode, excluir en items mode)
                filter_mode = item_type if item_type else 'items'  # default: excluir kits
                print(f"🔍 Filtrando precios por item_type={filter_mode}")
                try:
                    kb_params = {
                        "fields": '["new_item_code"]',
                        "filters": json.dumps([["disabled", "=", 0], ["docstatus", "in", [0,1]]]),
                        "limit_page_length": smart_limit
                    }
                    kits_resp, kits_err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint="/api/resource/Product Bundle",
                        params=kb_params,
                        operation_name="Get Product Bundles for kits filter"
                    )
                    if kits_err:
                        return handle_erpnext_error(kits_err, "Failed to fetch kits for filtering")
                    if kits_resp.status_code == 200:
                        kits_list = kits_resp.json().get('data', [])
                        # Build set of allowed kit codes (canonical) and a metadata map
                        allowed_kits = set()
                        kits_meta = {}
                        for k in kits_list:
                            code = k.get('new_item_code')
                            if code:
                                allowed_kits.add(code)
                                kits_meta[code] = {
                                    'item_name': k.get('item_name') or k.get('name') or '',
                                    'item_group': k.get('item_group') or ''
                                }

                        # Filter prices_data based on mode:
                        # - kits mode: ONLY include items in allowed_kits
                        # - items mode: EXCLUDE items in allowed_kits (no kits)
                        original_count = len(prices_data)
                        filtered_prices = []
                        
                        def is_kit(p_code):
                            """Check if item_code is a kit"""
                            if p_code in allowed_kits:
                                return True
                            # Check stripped form
                            for ak in allowed_kits:
                                if p_code and ak.endswith(p_code):
                                    return True
                            return False
                        
                        for p in prices_data:
                            p_code = p.get('item_code')
                            item_is_kit = is_kit(p_code)
                            
                            if filter_mode == 'kits':
                                # Incluir solo kits
                                if item_is_kit:
                                    # Enrich with Product Bundle metadata when missing
                                    meta = kits_meta.get(p_code, {})
                                    if not meta:
                                        for ak in allowed_kits:
                                            if p_code and ak.endswith(p_code):
                                                meta = kits_meta.get(ak, {})
                                                break
                                    if not p.get('item_name') and meta.get('item_name'):
                                        p['item_name'] = meta.get('item_name')
                                    if not p.get('item_group') and meta.get('item_group'):
                                        p['item_group'] = meta.get('item_group')
                                    filtered_prices.append(p)
                            else:
                                # items mode: Excluir kits
                                if not item_is_kit:
                                    filtered_prices.append(p)

                        prices_data = filtered_prices
                        print(f"🔍 Precios filtrados ({filter_mode} mode): {len(prices_data)} / {original_count}")
                    else:
                        print(f"⚠️ Error obteniendo Product Bundle para filtrar: {kits_resp.text}")
                except Exception as ke:
                    print(f"⚠️ Error filtrando por kits: {ke}")

            # Sanitize item_name to remove company abbreviation for display
            if company_abbr and prices_data:
                try:
                    for p in prices_data:
                        try:
                            name = p.get('item_name') or ''
                            if name and isinstance(name, str) and name.endswith(f" - {company_abbr}"):
                                p['item_name'] = name[:-(len(company_abbr) + 3)]
                        except Exception:
                            # be tolerant: if any row fails, skip sanitization for that row
                            pass
                except Exception:
                    pass

            # Formatear precios con dos decimales (backend envía listo para mostrar)
            try:
                for p in prices_data:
                    if 'price_list_rate' in p:
                        try:
                            p['price_list_rate'] = f"{float(p.get('price_list_rate') or 0):.2f}"
                        except Exception:
                            p['price_list_rate'] = "0.00"
            except Exception:
                pass

            # Normalize exchange rate mode for frontend convenience
            try:
                cer = price_list_data.get('custom_exchange_rate')
                if cer is not None and float(cer) == -1:
                    price_list_data['exchange_rate_mode'] = 'general'
                else:
                    price_list_data['exchange_rate_mode'] = 'specific'
            except Exception:
                price_list_data['exchange_rate_mode'] = 'specific'

            return jsonify({
                "success": True,
                "price_list": price_list_data,
                "prices": prices_data,
                "count": len(prices_data)
            })
        else:
            print(f"❌ Sales Price List no encontrada: {detail_response.text}")
            return jsonify({"success": False, "message": "Lista de precios de venta no encontrada"}), 404

    except Exception as e:
        print(f"❌ Error en get_sales_price_list_by_name: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/kits', methods=['GET'])
def get_sales_price_list_kits():
    """Devolver kits listos para autocomplete en listas de venta.

    Query params: company=<company name> (opcional, usado para normalizar códigos)
    Devuelve: { success: True, data: [ { new_item_code, item_name, item_group }, ... ] }
    """
    print("\n--- Petición para obtener kits para sales price lists (autocomplete) ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        # Determine smart limit based on active company to avoid truncated results
        try:
            active_company = get_active_company(user_id)
        except Exception:
            active_company = None
        smart_limit = get_smart_limit(active_company or company or '', 'list')
        # Determine company abbr to strip from returned codes for frontend
        abbr = ''
        if company:
            try:
                abbr = get_company_abbr(session, headers, company) or ''
                print(f"🔍 [DEBUG] Company abbr for kits autocomplete: {abbr}")
            except Exception as e:
                print(f"⚠️ [WARNING] Error obteniendo company abbr for kits: {e}")

        # Note: ERPNext does not allow querying arbitrary fields like `item_name` on Product Bundle.
        # Request the `name` field instead and map it to `item_name` for the frontend.
        # Request only fields that ERPNext allows querying for Product Bundle.
        # `item_group` is not permitted in query fields on some ERPNext installations, so omit it.
        params = {
            "fields": json.dumps(["new_item_code", "name"]),
            "filters": json.dumps([["disabled", "=", 0], ["docstatus", "in", [0,1]]]),
            "limit_page_length": smart_limit
        }

        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Product Bundle",
            params=params,
            operation_name="Get Product Bundles for sales price lists autocomplete"
        )

        if err:
            print(f"❌ Error obteniendo Product Bundles para autocomplete: {err}")
            return handle_erpnext_error(err, "Failed to fetch kits for sales price lists")

        if resp.status_code != 200:
            print(f"❌ Error obteniendo Product Bundles para autocomplete: {resp.text}")
            return jsonify({"success": False, "message": "Error obteniendo kits"}), resp.status_code

        kits = resp.json().get('data', [])
        processed = []

        # Collect all new_item_code values so we can query the Item doctype
        kit_codes = [k.get('new_item_code') for k in kits if k.get('new_item_code')]
        items_map = {}
        try:
            if kit_codes:
                # Query Item by item_code to obtain canonical item_name and item_group
                # Batch request to avoid too long URLs (limit page length to len(kit_codes))
                item_params = {
                    "fields": json.dumps(["item_code", "item_name", "item_group"]),
                    "filters": json.dumps([["item_code", "in", kit_codes]]),
                    # Use smart_limit (company-aware) as baseline to avoid truncation for large companies
                    "limit_page_length": max(smart_limit, len(kit_codes))
                }
                items_resp, items_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Item",
                    params=item_params,
                    operation_name="Get Items for kits autocomplete"
                )
                if items_err:
                    print(f"⚠️ Error obteniendo Items para completar nombres de kits: {items_err}")
                elif items_resp.status_code == 200:
                    items_list = items_resp.json().get('data', [])
                    for it in items_list:
                        key = it.get('item_code') or it.get('name')
                        if key:
                            items_map[key] = {
                                'item_name': it.get('item_name', '') or '',
                                'item_group': it.get('item_group', '') or ''
                            }
                    print(f"🔍 Items matched for kits: {len(items_map)} / {len(kit_codes)}")
                else:
                    print(f"⚠️ Error obteniendo Items para kits: {items_resp.text}")
        except Exception as ie:
            print(f"⚠️ Exception querying Items for kits: {ie}")

        for k in kits:
            code = k.get('new_item_code', '') or ''
            display_code = code
            try:
                if abbr and display_code.endswith(f" - {abbr}"):
                    display_code = display_code[:-(len(abbr) + 3)]
            except Exception:
                pass

            # Prefer the Item.doctype values when available (better item_name/item_group)
            mapped = items_map.get(code) or items_map.get(display_code) or {}
            item_name = mapped.get('item_name') or k.get('name', '') or ''
            item_group = mapped.get('item_group') or ''

            processed.append({
                'new_item_code': display_code,
                'item_name': item_name,
                'item_group': item_group
            })

        print(f"📋 Kits para autocomplete encontrados: {len(processed)} (product bundle rows: {len(kits)})")
        return jsonify({"success": True, "data": processed})

    except Exception as e:
        print(f"❌ Error en get_sales_price_list_kits: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/calculate-from-purchase', methods=['POST'])
def calculate_from_purchase():
    """Calcular precios de venta aplicando markup sobre una lista de compra"""
    print("\n--- Calculando precios de venta desde lista de compra ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        purchase_list_name = data.get('purchase_list_name')
        markup_percentage = data.get('markup_percentage', 0)
        exchange_rate = data.get('exchange_rate', 1)

        if not purchase_list_name:
            return jsonify({"success": False, "message": "Nombre de lista de compra requerido"}), 400

        print(f"📋 Lista de compra base: {purchase_list_name}")
        print(f"📊 Markup: {markup_percentage}%")
        print(f"💱 Exchange rate: {exchange_rate}")

        # Obtener precios de compra con límite inteligente
        filters = [
            ["price_list", "=", purchase_list_name],
            ["buying", "=", 1]
        ]
        smart_limit = get_smart_limit(purchase_list_name, 'calculate')
        params = {
            "fields": '["item_code", "item_name", "price_list_rate", "currency"]',
            "filters": json.dumps(filters),
            "limit_page_length": smart_limit
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=params,
            operation_name=f"Get purchase prices for calculation from '{purchase_list_name}'"
        )

        if error:
            print(f"❌ Error obteniendo precios de compra: {error}")
            return jsonify({"success": False, "message": "Error obteniendo precios de la lista de compra"}), response.status_code if hasattr(response, 'status_code') else 500

        if response.status_code != 200:
            print(f"❌ Error obteniendo precios de compra: {response.text}")
            return jsonify({"success": False, "message": "Error obteniendo precios de la lista de compra"}), response.status_code

        purchase_prices = response.json().get('data', [])
        print(f"💰 Precios de compra encontrados: {len(purchase_prices)}")

        # Calcular precios de venta aplicando markup y exchange rate
        calculated_prices = []
        markup_factor = 1 + (markup_percentage / 100) if markup_percentage > 0 else 1  # No aplicar markup si es 0

        for price_item in purchase_prices:
            purchase_price = float(price_item.get('price_list_rate', 0))

            # Aplicar exchange rate si es necesario
            purchase_price_converted = purchase_price * exchange_rate
            calculated_sale_price = round(purchase_price_converted * markup_factor, 2)

            calculated_prices.append({
                "item_code": price_item.get('item_code'),
                "item_name": price_item.get('item_name'),
                "purchase_price": f"{purchase_price:.2f}",
                "purchase_price_converted": f"{(round(purchase_price_converted, 2) if exchange_rate != 1 else purchase_price):.2f}",
                "calculated_sale_price": f"{calculated_sale_price:.2f}",
                "markup_percentage": markup_percentage,
                "exchange_rate": exchange_rate,
                "currency": price_item.get('currency')
            })

        print(f"✅ Cálculo completado: {len(calculated_prices)} precios de venta calculados")

        return jsonify({
            "success": True,
            "data": calculated_prices,
            "count": len(calculated_prices),
            "purchase_list_name": purchase_list_name,
            "markup_percentage": markup_percentage,
            "exchange_rate": exchange_rate
        })

    except Exception as e:
        print(f"❌ Error en calculate_from_purchase: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/calculate-from-cost', methods=['POST'])
def calculate_from_cost():
    """Calcular precios de venta aplicando markup sobre el costo estándar"""
    print("\n--- Calculando precios de venta desde costo estándar ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        item_codes = data.get('item_codes', [])
        markup_percentage = data.get('markup_percentage', 0)

        if not item_codes:
            return jsonify({"success": False, "message": "Lista de códigos de item requerida"}), 400

        print(f"📋 Items a procesar: {len(item_codes)}")
        print(f"📊 Markup: {markup_percentage}%")

        calculated_prices = []
        markup_factor = 1 + (markup_percentage / 100)

        # Procesar en lotes para evitar URLs demasiado largas
        batch_size = 50
        for i in range(0, len(item_codes), batch_size):
            batch_codes = item_codes[i:i + batch_size]

            # Obtener información de los items
            filters = [["item_code", "in", batch_codes]]
            params = {
                "fields": '["item_code", "item_name", "standard_buying_rate", "last_purchase_rate"]',
                "filters": json.dumps(filters),
                "limit_page_length": len(batch_codes)
            }

            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Item",
                params=params,
                operation_name="Get item cost information for price calculation"
            )

            if error:
                print(f"❌ Error obteniendo información de items: {error}")
                continue

            if response.status_code != 200:
                print(f"❌ Error obteniendo información de items: {response.text}")
                continue

            items_data = response.json().get('data', [])

            for item in items_data:
                # Usar standard_buying_rate o last_purchase_rate como costo base
                cost_price = float(item.get('standard_buying_rate', 0) or item.get('last_purchase_rate', 0))
                calculated_sale_price = round(cost_price * markup_factor, 2) if cost_price > 0 else 0

                calculated_prices.append({
                    "item_code": item.get('item_code'),
                    "item_name": item.get('item_name'),
                    "cost_price": cost_price,
                    "calculated_sale_price": calculated_sale_price,
                    "markup_percentage": markup_percentage
                })

        print(f"✅ Cálculo completado: {len(calculated_prices)} precios de venta calculados desde costo")

        return jsonify({
            "success": True,
            "data": calculated_prices,
            "count": len(calculated_prices),
            "markup_percentage": markup_percentage
        })

    except Exception as e:
        print(f"❌ Error en calculate_from_cost: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/apply-formula', methods=['POST'])
def apply_formula_to_sales_items():
    """Aplicar una fórmula a precios actuales/compra y devolver los nuevos valores normalizados."""
    print("\n--- Aplicando fórmula masiva para lista de precios de venta ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        payload = request.get_json(force=True) or {}
        formula = (payload.get('formula') or '').strip()
        items = payload.get('items') or []

        if not formula:
            return jsonify({"success": False, "message": "Fórmula requerida"}), 400
        if not items:
            return jsonify({"success": False, "message": "Lista de items vacía"}), 400

        try:
            pyexpr = _translate_and_sanitize_formula(formula)
        except Exception as e:
            return jsonify({"success": False, "message": f"Fórmula inválida: {str(e)}"}), 400

        results = []
        row_errors = []

        for idx, row in enumerate(items):
            row_id = row.get('id', f"row-{idx}")
            item_code = row.get('item_code') or row.get('code') or ''

            try:
                actual = float(row.get('existing_price') or row.get('actual') or row.get('valor') or 0)
            except Exception:
                actual = 0
            try:
                compra = float(
                    row.get('purchase_price')
                    or row.get('purchase_price_converted')
                    or row.get('compra')
                    or row.get('cost')
                    or 0
                )
            except Exception:
                compra = 0

            try:
                res = safe_eval_formula(pyexpr, actual=actual, compra=compra)
                if isinstance(res, bool):
                    raise ValueError("La fórmula devolvió un valor booleano")
                value = float(res)
                if not math.isfinite(value):
                    raise ValueError("La fórmula devolvió un número no válido")
                normalized = round(value, 2)
                results.append({
                    "id": row_id,
                    "item_code": item_code,
                    "valor": normalized
                })
            except Exception as err:
                row_errors.append({
                    "id": row_id,
                    "item_code": item_code,
                    "error": str(err)
                })

        if not results:
            return jsonify({
                "success": False,
                "message": "No se pudieron calcular resultados para la fórmula",
                "errors": row_errors
            }), 400

        return jsonify({
            "success": True,
            "data": results,
            "count": len(results),
            "errors": row_errors
        })

    except Exception as e:
        print(f"⚠ Error en apply_formula_to_sales_items: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/bulk-save', methods=['POST'])
def bulk_save_sales_price_list():
    """Guardar múltiples precios de venta creando/actualizando una lista de precios"""
    print("\n--- Guardando lista de precios de venta ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        price_list_name = data.get('price_list_name')
        currency = data.get('currency')
        valid_from = data.get('valid_from')
        csv_data = data.get('csv_data')  # CSV directo desde el frontend
        preview = data.get('preview', False)  # Nuevo parámetro para preview
        # Mode may be 'insert' or 'update' - default to insert
        mode = (data.get('mode') or 'insert').strip().lower()

        print(f"BACKEND: Recibido price_list_name: {price_list_name}")
        print(f"BACKEND: Recibido currency: {currency}")
        print(f"BACKEND: Recibido valid_from: {valid_from}")
        print(f"BACKEND: Recibido preview: {preview}")
        print(f"BACKEND: CSV data length: {len(csv_data) if csv_data else 0}")
        print(f"BACKEND: Primeras 500 chars del CSV:")
        print(csv_data[:500] if csv_data else "None")

        if not price_list_name:
            return jsonify({"success": False, "message": "Nombre de lista de precios requerido"}), 400

        company_name = get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        if not csv_data:
            return jsonify({"success": False, "message": "Datos CSV requeridos"}), 400

        # Contar filas en el CSV (restar header)
        csv_lines = csv_data.strip().split('\n')
        total_items = max(0, len(csv_lines) - 1)  # Restar header

        print(f"BACKEND: Total líneas en CSV: {len(csv_lines)}")
        print(f"BACKEND: Total items calculados: {total_items}")
        print(f"BACKEND: Primeras 5 líneas del CSV:")
        for i, line in enumerate(csv_lines[:5]):
            print(f"BACKEND: Línea {i+1}: '{line}'")

        if total_items == 0:
            return jsonify({"success": False, "message": "No se encontraron filas de datos en el CSV"}), 400

        # Obtener el abbr de la compañía para quitarlo de los item codes
        company_abbr = None
        try:
            active_company = get_active_company(user_id)
            if active_company:
                company_abbr = get_company_abbr(session, headers, active_company)
                print(f"🔍 [DEBUG] Company abbr: {company_abbr}")
        except Exception as e:
            print(f"⚠️ [WARNING] Error obteniendo company abbr: {e}")
        # Compute smart limit for queries that depend on company item counts
        try:
            smart_limit = get_smart_limit(active_company or '', 'list')
        except Exception:
            smart_limit = 1000

        # Si se especifica item_type=kits, obtener la lista de códigos de kits (new_item_code)
        item_type = data.get('item_type')
        allowed_kits = None
        if item_type == 'kits':
            print("🔍 [DEBUG] item_type=kits: obteniendo lista de Product Bundles para validación")
            try:
                kb_params = {
                    "fields": '["new_item_code"]',
                    "filters": json.dumps([["disabled", "=", 0], ["docstatus", "in", [0,1]]]),
                    "limit_page_length": smart_limit
                }
                kits_resp, kits_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Product Bundle",
                    params=kb_params,
                    operation_name="Get Product Bundles for bulk save kits"
                )
                if kits_err:
                    print(f"❌ Error obteniendo Product Bundles: {kits_err}")
                    return handle_erpnext_error(kits_err, "Failed to fetch kits for bulk save")
                if kits_resp.status_code == 200:
                    kits_list = kits_resp.json().get('data', [])
                    allowed_kits = set()
                    for k in kits_list:
                        code = k.get('new_item_code')
                        if code:
                            allowed_kits.add(code)
                            # Also add stripped version without company abbr if present
                            try:
                                if company_abbr and code.endswith(f" - {company_abbr}"):
                                    stripped = code[:-(len(company_abbr) + 3)]
                                    allowed_kits.add(stripped)
                            except Exception:
                                pass
                    print(f"🔍 [DEBUG] Allowed kits found: {len(allowed_kits)}")
                else:
                    print(f"⚠️ Error obteniendo Product Bundles: {kits_resp.text}")
            except Exception as e:
                print(f"⚠️ Error obteniendo kits: {e}")

        if preview:
            # Modo preview: procesar CSV y devolver primeras 10 líneas sin importar
            print("🔍 [PREVIEW] Procesando CSV para preview...")
            processed_csv = _process_csv_data(csv_data, price_list_name, currency, company_abbr, allowed_item_codes=allowed_kits)
            processed_lines = processed_csv.split('\n')
            preview_lines = processed_lines[:10]  # Primeras 10 líneas incluyendo header
            
            print("🔍 [PREVIEW] Primeras 10 líneas del CSV procesado:")
            for i, line in enumerate(preview_lines):
                print(f"🔍 [PREVIEW]   Línea {i+1}: '{line}'")
            
            return jsonify({
                "success": True,
                "preview": True,
                "preview_lines": preview_lines,
                "total_lines": len(processed_lines),
                "message": "Preview generado. Revisa las líneas y envía sin 'preview' para importar."
            })

        # Generar ID único para este proceso
        process_id = str(uuid.uuid4())

        # Inicializar progreso
        sales_import_progress[process_id] = {
            "success": True,
            "progress": 0,
            "total": total_items,
            "current_item": "Iniciando guardado...",
            "message": f"Guardando {total_items} precios de venta...",
            "status": "running"
        }

        print(f"CSV recibido con {total_items} filas, Lista: {price_list_name}, Process ID: {process_id}")

        # Iniciar procesamiento en un hilo separado
        def process_save():
            try:
                processed_csv = _process_csv_data(csv_data, price_list_name, currency, company_abbr, allowed_item_codes=allowed_kits)
                _do_bulk_save_csv(session, headers, user_id, process_id, price_list_name, currency, valid_from, processed_csv, mode, company_abbr, allowed_item_codes=allowed_kits)
            except Exception as e:
                print(f"Error en procesamiento de guardado {process_id}: {e}")
                sales_import_progress[process_id] = {
                    "success": False,
                    "progress": 0,
                    "total": total_items,
                    "current_item": "Error en procesamiento",
                    "message": f"Error: {str(e)}",
                    "status": "error"
                }

        thread = threading.Thread(target=process_save)
        thread.daemon = True
        thread.start()

        # Devolver inmediatamente con el process_id
        return jsonify({
            "success": True,
            "process_id": process_id,
            "message": "Guardado iniciado",
            "total_items": total_items
        })

    except Exception as e:
        print(f"Error en bulk_save_sales_price_list: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def _process_csv_data(csv_data, price_list_name, currency, company_abbr, allowed_item_codes=None):
    """Función para procesar el CSV y devolver el CSV formateado para ERPNext

    allowed_item_codes: optional set of item codes (canonical or stripped) that are allowed.
    If provided, rows whose item code does not match any value in this set will be skipped.
    """
    print(f"BACKEND: Iniciando _process_csv_data con csv_data length: {len(csv_data)}")
    print(f"BACKEND: Primeras 300 chars del CSV recibido:")
    print(csv_data[:300])
    try:
        csv_input = io.StringIO(csv_data)
        csv_reader = csv.DictReader(csv_input)

        # Crear nuevo CSV con labels de ERPNext (sin quotes excesivos)
        output = io.StringIO()
        fieldnames = ["Item Code", "Price List", "Currency", "Rate", "Buying", "Selling"]

        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        processed_count = 0
        skipped_count = 0

        for row in csv_reader:
            print(f"BACKEND: Procesando fila cruda: {row}")
            processed_row = {
                "Item Code": row.get("Item Code", row.get("item_code", "")).strip('"'),
                "Price List": price_list_name,
                "Currency": currency,
                "Rate": row.get("Rate", row.get("Price List Rate", row.get("price_list_rate", "0"))).strip('"').replace(',', '.'),
                "Buying": "0",
                "Selling": "1"
            }
            
            print(f"BACKEND: Fila procesada: Item Code='{processed_row['Item Code']}', Rate='{processed_row['Rate']}'")
            
            # Validate Price List Rate: must be present, numeric, and > 0
            try:
                rate = float(processed_row["Rate"])
                print(f"BACKEND: Rate convertido a float: {rate}")
                if rate <= 0:
                    print(f"⚠️ BACKEND: Skipping row with invalid Rate: {rate}")
                    skipped_count += 1
                    continue
            except (ValueError, TypeError):
                print(f"⚠️ BACKEND: Skipping row with non-numeric Rate: {processed_row['Rate']}")
                skipped_count += 1
                continue
            # Si se pidió validar por una lista de allowed_item_codes, comprobar aquí.
            item_code = processed_row["Item Code"]
            if allowed_item_codes is not None:
                # Build candidates to check: raw, raw+abbr, stripped if raw has abbr
                candidates = {item_code}
                try:
                    if company_abbr:
                        if not item_code.endswith(f" - {company_abbr}"):
                            candidates.add(f"{item_code} - {company_abbr}")
                        else:
                            # also add stripped
                            candidates.add(item_code[:-(len(company_abbr) + 3)])
                except Exception:
                    pass

                allowed_match = any((c in allowed_item_codes) for c in candidates)
                if not allowed_match:
                    print(f"⚠️ BACKEND: Skipping row porque Item Code '{item_code}' no está en allowed_item_codes")
                    skipped_count += 1
                    continue

            # Agregar el abbr de la compañía al item code si no está presente
            if company_abbr and f" - {company_abbr}" not in item_code:
                processed_row["Item Code"] = f"{item_code} - {company_abbr}"
                print(f"BACKEND: Item code adjusted: '{item_code}' -> '{processed_row['Item Code']}'")
            
            writer.writerow(processed_row)
            processed_count += 1
            if processed_count <= 5:
                print(f"BACKEND: Fila escrita {processed_count}: {processed_row}")

        processed_csv = output.getvalue()
        print(f"BACKEND: Procesamiento completado - Procesadas: {processed_count}, Saltadas: {skipped_count}")
        print(f"BACKEND: CSV procesado length: {len(processed_csv)}")
        print(f"BACKEND: Primeras 300 chars del CSV procesado:")
        print(processed_csv[:300])
        return processed_csv
    except Exception as csv_error:
        print(f"⚠️ BACKEND: Error procesando CSV: {csv_error}")
        print(f"BACKEND: Traceback: {traceback.format_exc()}")
        return csv_data


def _do_bulk_save_csv(session, headers, user_id, process_id, price_list_name, currency, valid_from, csv_data, mode='insert', company_abbr=None, allowed_item_codes=None):
    """Función interna que realiza el guardado real usando Data Import Tool con archivo subido

    mode: 'insert' or 'update' - controls whether Data Import uses Insert New Records or Update Existing Records
    company_abbr: company abbreviation used to normalize item codes (if any)
    """

    print(f"🔍 [DEBUG] Iniciando _do_bulk_save_csv con process_id: {process_id}")
    print(f"🔍 [DEBUG] price_list_name: {price_list_name}")
    print(f"🔍 [DEBUG] currency: {currency}")
    print(f"🔍 [DEBUG] valid_from: {valid_from}")
    print(f"🔍 [DEBUG] csv_data type: {type(csv_data)}")
    print(f"🔍 [DEBUG] csv_data length: {len(csv_data) if csv_data else 'None'}")

    # El CSV ya viene procesado, no necesitamos obtener company_abbr ni procesar de nuevo
    print(f"🔍 [DEBUG] Company abbr ya obtenido: {company_abbr}")

    if csv_data:
        csv_lines = csv_data.split('\n')
        print(f"🔍 [DEBUG] Número de líneas en CSV procesado: {len(csv_lines)}")
        print(f"🔍 [DEBUG] Primeras 5 líneas del CSV procesado:")
        for i, line in enumerate(csv_lines[:5]):
            print(f"🔍 [DEBUG]   Línea {i+1}: '{line}'")
        if len(csv_lines) > 5:
            print(f"🔍 [DEBUG]   ... y {len(csv_lines) - 5} líneas más")
    else:
        print(f"🔍 [DEBUG] csv_data es None o vacío!")

    # Ya no procesamos el CSV aquí, asumimos que viene procesado

    company_name = get_active_company(user_id)
    if not company_name:
        raise ValueError("No hay compañía activa para asociar la lista de precios")

    # Verificar si la Price List existe, si no, crearla
    filter_list = [["price_list_name", "=", price_list_name], ["custom_company", "=", company_name]]
    price_list_filters = json.dumps(filter_list)
    check_response, check_error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Price List",
        params={
            "filters": price_list_filters,
            "fields": '["name","custom_company"]',
            "limit_page_length": 1
        },
        operation_name=f"Check if price list '{price_list_name}' exists"
    )

    price_list_exists = False
    if check_error:
        print(f"🔍 [DEBUG] Error checking price list existence: {check_error}")
    elif check_response.status_code == 200:
        existing = check_response.json().get('data', [])
        price_list_exists = len(existing) > 0
        if price_list_exists:
            existing_company = existing[0].get('custom_company')
            if existing_company != company_name:
                raise ValueError(f"La lista de precios '{price_list_name}' pertenece a otra compañía ({existing_company})")
        print(f"🔍 [DEBUG] Price List '{price_list_name}' existe: {price_list_exists}")
    else:
        print(f"🔍 [DEBUG] Error checking price list existence: {check_response.status_code}")

    if not price_list_exists:
        # Crear la Price List de venta
        price_list_data = {
            "price_list_name": price_list_name,
            "enabled": 1,
            "buying": 0,
            "selling": 1,
            "currency": currency,
            "custom_company": company_name
        }

        if valid_from:
            price_list_data["valid_from"] = valid_from

        print(f"🔍 [DEBUG] Creando Price List con data: {price_list_data}")

        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Price List",
            data={"data": price_list_data},
            operation_name=f"Create sales price list '{price_list_name}'"
        )

        if create_error:
            print(f"❌ Error creando Price List de venta: {create_error}")
            sales_import_progress[process_id]["status"] = "error"
            sales_import_progress[process_id]["message"] = f"Error creando Price List: {create_error}"
            return

        if create_response.status_code not in [200, 201]:
            print(f"❌ Error creando Price List de venta: {create_response.text}")
            sales_import_progress[process_id]["status"] = "error"
            sales_import_progress[process_id]["message"] = f"Error creando Price List: {create_response.text}"
            return

        print(f"✅ Price List de venta creada: {price_list_name}")
    else:
        print(f"✅ Price List de venta ya existe: {price_list_name}")

    # PASO 1: Subir el CSV como archivo
    print("🚀 Subiendo archivo CSV...")
    
    # If allowed_item_codes provided, validate CSV contains only allowed codes (or filter out disallowed)
    if allowed_item_codes is not None and csv_data:
        try:
            input_io = io.StringIO(csv_data)
            reader = csv.DictReader(input_io)
            filtered_rows = []
            disallowed = []
            for r in reader:
                code = (r.get('Item Code') or '').strip()
                # Code should be already normalized by _process_csv_data, but check both forms
                if code in allowed_item_codes:
                    filtered_rows.append(r)
                else:
                    # try stripped version
                    stripped = code
                    try:
                        # if endswith abbr, also try stripped
                        if company_abbr and code.endswith(f" - {company_abbr}"):
                            stripped = code[:-(len(company_abbr) + 3)]
                    except Exception:
                        pass
                    if stripped in allowed_item_codes:
                        filtered_rows.append(r)
                    else:
                        disallowed.append(code)

            if disallowed:
                print(f"🔍 [DEBUG] Se encontraron códigos no permitidos y serán omitidos: {disallowed}")

            if not filtered_rows:
                print(f"❌ Ninguna fila válida permanece después de filtrar por kits. Abortando import.")
                sales_import_progress[process_id]["status"] = "error"
                sales_import_progress[process_id]["message"] = "Ninguna fila válida para importar después de filtrar por kits"
                return

            # Rebuild csv_data with header
            output_io = io.StringIO()
            fieldnames = reader.fieldnames or ["Item Code", "Price List", "Currency", "Rate", "Buying", "Selling"]
            writer = csv.DictWriter(output_io, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(filtered_rows)
            csv_data = output_io.getvalue()
            print(f"🔍 [DEBUG] CSV filtrado size: {len(csv_data)}")
        except Exception as fe:
            print(f"⚠️ Error filtrando CSV por allowed_item_codes: {fe}")
    files = {
        'file': (f'import_{process_id}.csv', csv_data.encode('utf-8'), 'text/csv'),
        'is_private': (None, '0'),
        'folder': (None, 'Home')
    }
    
    # Crear headers sin Content-Type para multipart/form-data
    upload_headers = {k: v for k, v in headers.items() if k.lower() != 'content-type'}
    
    # Para archivos multipart, necesitamos usar session.post directamente ya que make_erpnext_request
    # está diseñado para JSON, no para multipart/form-data
    upload_response = session.post(
        f"{ERPNEXT_URL}/api/method/upload_file",
        files=files,
        headers=upload_headers
    )
    
    print(f"🔍 [DEBUG] Respuesta de upload_file - Status: {upload_response.status_code}")
    print(f"🔍 [DEBUG] Respuesta completa: {upload_response.text}")
    
    if upload_response.status_code not in [200, 201]:
        print(f"❌ Error subiendo archivo: {upload_response.text}")
        sales_import_progress[process_id]["status"] = "error"
        sales_import_progress[process_id]["message"] = f"Error subiendo archivo: {upload_response.text}"
        return
    
    upload_result = upload_response.json()
    message_data = upload_result.get('message', {})
    
    # El file_url puede estar en diferentes lugares según la versión
    file_url = message_data.get('file_url') or message_data.get('file_name')
    
    if not file_url:
        print(f"❌ No se pudo obtener file_url del upload: {upload_result}")
        sales_import_progress[process_id]["status"] = "error"
        sales_import_progress[process_id]["message"] = "Error: No se pudo obtener file_url del upload"
        return
    
    print(f"✅ Archivo subido: {file_url}")
    
    # PASO 2: Crear el Data Import con el archivo adjunto
    import_type = "Update Existing Records" if mode == 'update' else "Insert New Records"
    import_doc_data = {
        "reference_doctype": "Item Price",
        "import_type": import_type,
        "submit_after_import": 0,
        "import_file": file_url,  # ← AQUÍ va la URL del archivo
        "mute_emails": 1
    }
    
    print(f"🔍 [DEBUG] Creando Data Import con import_file: {file_url}")
    
    create_import_response, create_import_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Data Import",
        data={"data": import_doc_data},
        operation_name=f"Create data import for '{price_list_name}'"
    )
    
    print(f"🔍 [DEBUG] Respuesta de creación de Data Import - Status: {create_import_response.status_code}")
    print(f"🔍 [DEBUG] Respuesta completa: {create_import_response.text}")
    
    if create_import_error:
        error_text = create_import_error
        print(f"❌ Error creando Data Import document: {error_text}")
        sales_import_progress[process_id]["status"] = "error"
        sales_import_progress[process_id]["message"] = f"Error creando Data Import document: {error_text}"
        return
    
    if create_import_response.status_code not in [200, 201]:
        error_text = create_import_response.text
        print(f"❌ Error creando Data Import document: {error_text}")
        sales_import_progress[process_id]["status"] = "error"
        sales_import_progress[process_id]["message"] = f"Error creando Data Import document: {error_text}"
        return
    
    import_doc = create_import_response.json().get('data', {})
    import_name = import_doc.get('name')
    print(f"✅ Data Import document creado: {import_name}")
    print(f"🔍 [DEBUG] import_doc completo: {import_doc}")
    
    payload_count = import_doc.get('payload_count', 0)
    print(f"🔍 [DEBUG] payload_count: {payload_count}")
    
    if payload_count == 0:
        print(f"⚠️ WARNING: payload_count es 0, pero continuando con start_import...")
    
    # PASO 3: Iniciar el import
    print("🚀 Iniciando Data Import...")
    
    import_response, import_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.core.doctype.data_import.data_import.form_start_import",
        data={"data_import": import_name},
        operation_name=f"Start data import '{import_name}'"
    )
    
    print(f"🔍 [DEBUG] Respuesta de form_start_import - Status: {import_response.status_code}")
    print(f"🔍 [DEBUG] Respuesta completa: {import_response.text}")
    
    if import_error:
        error_text = import_error
        print(f"❌ Error en Data Import: {error_text}")
        sales_import_progress[process_id]["status"] = "error"
        sales_import_progress[process_id]["message"] = f"Error en Data Import: {error_text}"
        return
    
    if import_response.status_code in [200, 201]:
        import_result = import_response.json()
        print(f"🔍 [DEBUG] import_result: {import_result}")
        
        message = import_result.get('message', '')
        print(f"✅ Data Import iniciado: {message}")
        
        # Actualizar progreso
        sales_import_progress[process_id]["status"] = "completed"
        sales_import_progress[process_id]["message"] = f"Importación bulk iniciada exitosamente. Import ID: {import_name}"
        sales_import_progress[process_id]["import_name"] = import_name
        sales_import_progress[process_id]["saved"] = payload_count if payload_count > 0 else len(csv_data.split('\n')) - 1
        sales_import_progress[process_id]["failed"] = 0
        sales_import_progress[process_id]["price_list_name"] = price_list_name
        
        print(f"✅ Bulk import completado con archivo subido")
    else:
        error_text = import_response.text
        print(f"❌ Error en Data Import: {error_text}")
        sales_import_progress[process_id]["status"] = "error"
        sales_import_progress[process_id]["message"] = f"Error en Data Import: {error_text}"


@sales_price_lists_bp.route('/api/sales-price-lists/bulk-save-progress/<process_id>', methods=['GET'])
def get_bulk_save_progress(process_id):
    """Obtener el progreso de un guardado en curso"""
    try:
        if process_id not in sales_import_progress:
            return jsonify({"success": False, "message": "Proceso no encontrado"}), 404

        progress_data = sales_import_progress[process_id]

        # Calcular porcentaje
        total = progress_data.get('total', 0)
        current = progress_data.get('progress', 0)
        percentage = int((current / total) * 100) if total > 0 else 0

        return jsonify({
            "success": True,
            "process_id": process_id,
            "status": progress_data.get('status', 'unknown'),
            "progress": current,
            "total": total,
            "percentage": percentage,
            "current_item": progress_data.get('current_item', ''),
            "message": progress_data.get('message', ''),
            "results": progress_data.get('results', []) if progress_data.get('status') == 'completed' else [],
            "saved": progress_data.get('saved', 0),
            "failed": progress_data.get('failed', 0),
            "price_list_name": progress_data.get('price_list_name', '')
        })

    except Exception as e:
        print(f"Error obteniendo progreso de guardado {process_id}: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@sales_price_lists_bp.route('/api/sales-price-lists/<path:price_list_name>/items', methods=['DELETE'])
@cross_origin(supports_credentials=True)
def delete_items_from_price_list(price_list_name):
    """Eliminar artículos específicos de una lista de precios de venta

    Espera JSON body: { item_codes: ["CODE1","CODE2"], company: "Company Name", item_type: "kits" (opcional) }
    Devuelve: { success: True, data: { deleted_count, failed_count } }
    """
    print(f"\n--- Petición para eliminar items de lista de precios: {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        item_codes = data.get('item_codes') or []
        item_type = data.get('item_type') or request.args.get('item_type')
        company = data.get('company') or request.args.get('company')

        if not item_codes or not isinstance(item_codes, list):
            return jsonify({"success": False, "message": "Campo 'item_codes' requerido (array)."}), 400

        # Normalizar códigos con la sigla de la compañía (si está disponible)
        company_abbr = None
        active_company = None
        try:
            if company:
                company_abbr = get_company_abbr(session, headers, company)
            else:
                # intentar obtener la compañía activa del usuario
                active_company = get_active_company(user_id)
                if active_company:
                    company_abbr = get_company_abbr(session, headers, active_company)
        except Exception as e:
            print(f"⚠️ Error obteniendo company abbr para normalizar códigos: {e}")

        # Construir lista de búsqueda que incluya variantes (con y sin abbr)
        search_codes = []
        try:
            for c in item_codes:
                if not c:
                    continue
                c = c.strip()
                search_codes.append(c)
                if company_abbr:
                    suffix = f" - {company_abbr}"
                    # si no termina con el sufijo, añadir la versión con abbr
                    if not c.endswith(suffix):
                        search_codes.append(f"{c}{suffix}")
                    else:
                        # si viene con abbr, añadir la versión sin abbr también
                        stripped = c[: -len(suffix)]
                        search_codes.append(stripped)

            # Dedupe while preserving order
            seen = set()
            dedup_codes = []
            for sc in search_codes:
                if sc not in seen:
                    seen.add(sc)
                    dedup_codes.append(sc)
            search_codes = dedup_codes
        except Exception as e:
            print(f"⚠️ Error construyendo search_codes: {e}")

        # Buscar los Item Price que coincidan con la lista y los códigos provistos (en batches para evitar URI enormes)
        smart_limit = get_smart_limit(company or active_company or price_list_name, 'list')
        existing_prices = []
        batch_size = 150
        for idx in range(0, len(search_codes), batch_size):
            batch_codes = search_codes[idx: idx + batch_size]
            filters = [
                ["price_list", "=", price_list_name],
                ["selling", "=", 1],
                ["item_code", "in", batch_codes]
            ]
            params = {
                "fields": '["name","item_code"]',
                "filters": json.dumps(filters),
                "limit_page_length": smart_limit
            }

            check_response, check_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Item Price",
                params=params,
                operation_name=f"Find specific prices to delete for sales price list '{price_list_name}' (batch {idx//batch_size + 1})"
            )

            if check_error:
                print(f"Error buscando precios a eliminar (batch {idx//batch_size + 1}): {check_error}")
                return jsonify({"success": False, "message": "Error verificando precios a eliminar"}), 500

            if not check_response or check_response.status_code != 200:
                message = check_response.text if check_response else "Sin respuesta"
                print(f"Error buscando precios a eliminar (batch {idx//batch_size + 1}): {message}")
                return jsonify({"success": False, "message": "Error verificando precios a eliminar"}), 500

            batch_data = check_response.json().get('data', [])
            existing_prices.extend(batch_data)

        print(f"Precios encontrados para eliminar: {len(existing_prices)}")

        # Si se solicita item_type=kits, filtrar por Product Bundle codes permitidos
        if item_type == 'kits' and existing_prices:
            try:
                kb_params = {
                    "fields": '["new_item_code"]',
                    "filters": json.dumps([["disabled", "=", 0], ["docstatus", "in", [0,1]]]),
                    "limit_page_length": smart_limit
                }
                kits_resp, kits_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Product Bundle",
                    params=kb_params,
                    operation_name="Get Product Bundles for delete filter"
                )
                if kits_err:
                    print(f"❌ Error obteniendo Product Bundles para delete: {kits_err}")
                else:
                    allowed_kits = set()
                    if kits_resp.status_code == 200:
                        for k in kits_resp.json().get('data', []):
                            code = k.get('new_item_code')
                            if code:
                                allowed_kits.add(code)
                    original_count = len(existing_prices)
                    existing_prices = [p for p in existing_prices if p.get('item_code') in allowed_kits]
                    print(f"🔍 [DEBUG] Precios a eliminar tras filtrar por kits: {len(existing_prices)} / {original_count}")
            except Exception as e:
                print(f"⚠️ Error filtrando precios por kits: {e}")

        if not existing_prices:
            return jsonify({"success": True, "data": {"deleted_count": 0, "failed_count": 0}, "message": "No se encontraron precios para los códigos indicados"})

        deleted_count = 0
        failed_count = 0

        for price in existing_prices:
            try:
                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Item Price/{price['name']}",
                    operation_name=f"Delete price '{price['name']}' from sales price list"
                )

                if delete_error:
                    failed_count += 1
                    print(f"Error eliminando precio {price['name']}: {delete_error}")
                elif delete_response.status_code in [200, 202, 204]:
                    deleted_count += 1
                else:
                    failed_count += 1
                    print(f"Error eliminando precio {price['name']}: {delete_response.text}")
            except Exception as e:
                failed_count += 1
                print(f"Excepción eliminando precio {price.get('name')}: {e}")

        return jsonify({"success": True, "data": {"deleted_count": deleted_count, "failed_count": failed_count}})

    except Exception as e:
        print(f"Error eliminando items de lista de precios {price_list_name}: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@sales_price_lists_bp.route('/api/sales-price-lists/<path:price_list_name>', methods=['DELETE'])
@cross_origin(supports_credentials=True)
def delete_sales_price_list(price_list_name):
    """Eliminar una lista de precios de venta"""
    print(f"\n--- Petición para eliminar lista de precios: {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Verificar que existen precios asociados a la lista
        filters = [
            ["price_list", "=", price_list_name],
            ["selling", "=", 1]
        ]
        # Compute smart_limit for this delete operation
        try:
            active_company = get_active_company(user_id)
        except Exception:
            active_company = None
        smart_limit = get_smart_limit(active_company or price_list_name, 'list')
        params = {
            "fields": '["name"]',
            "filters": json.dumps(filters),
            "limit_page_length": smart_limit  # Buscar más para encontrar todos los precios
        }

        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=params,
            operation_name=f"Find prices associated with sales price list '{price_list_name}'"
        )

        if check_error:
            print(f"Error buscando precios asociados: {check_error}")
            return jsonify({"success": False, "message": "Error verificando precios asociados"}), 500

        if check_response.status_code != 200:
            print(f"Error buscando precios asociados: {check_response.text}")
            return jsonify({"success": False, "message": "Error verificando precios asociados"}), 500

        existing_prices = check_response.json().get('data', [])
        print(f"Precios asociados encontrados: {len(existing_prices)}")

        # Si se solicitó item_type=kits, obtener lista de kits y filtrar existing_prices
        item_type = request.args.get('item_type')
        if item_type == 'kits' and existing_prices:
            print(f"🔍 [DEBUG] delete with item_type=kits: filtrando precios a borrar")
            try:
                kb_params = {
                    "fields": '["new_item_code"]',
                    "filters": json.dumps([["disabled", "=", 0], ["docstatus", "in", [0,1]]]),
                    "limit_page_length": smart_limit
                }
                kits_resp, kits_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Product Bundle",
                    params=kb_params,
                    operation_name="Get Product Bundles for delete filter"
                )
                if kits_err:
                    print(f"❌ Error obteniendo Product Bundles para delete: {kits_err}")
                    return handle_erpnext_error(kits_err, "Failed to fetch kits for delete")
                allowed_kits = set()
                if kits_resp.status_code == 200:
                    kits_list = kits_resp.json().get('data', [])
                    for k in kits_list:
                        code = k.get('new_item_code')
                        if code:
                            allowed_kits.add(code)
                else:
                    print(f"⚠️ Error obteniendo Product Bundles para delete: {kits_resp.text}")

                original_count = len(existing_prices)
                existing_prices = [p for p in existing_prices if p.get('item_code') in allowed_kits]
                print(f"🔍 [DEBUG] Precios a eliminar tras filtrar por kits: {len(existing_prices)} / {original_count}")
            except Exception as e:
                print(f"⚠️ Error filtrando precios para delete por kits: {e}")

        if not existing_prices:
            print(f"No se encontraron precios asociados a la lista '{price_list_name}'")
        else:
            print(f"Eliminando {len(existing_prices)} precios asociados...")

        # Eliminar todos los precios de la lista
        deleted_count = 0
        failed_count = 0

        for price in existing_prices:
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Item Price/{price['name']}",
                operation_name=f"Delete price '{price['name']}' from sales price list"
            )

            if delete_error:
                failed_count += 1
                print(f"Error eliminando precio {price['name']}: {delete_error}")
            elif delete_response.status_code in [200, 202, 204]:
                deleted_count += 1
            else:
                failed_count += 1
                print(f"Error eliminando precio {price['name']}: {delete_response.text}")

        # Intentar eliminar la lista de precios en sí (si existe como doctype separado)
        try:
            # Buscar el documento Price List por nombre
            price_list_filters = [["price_list_name", "=", price_list_name]]
            price_list_params = {
                "fields": '["name"]',
                "filters": json.dumps(price_list_filters),
                "limit_page_length": 1
            }

            list_check_response, list_check_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Price List",
                params=price_list_params,
                operation_name=f"Find price list document for '{price_list_name}'"
            )

            if list_check_error:
                print(f"Error buscando documento Price List: {list_check_error}")
            elif list_check_response.status_code == 200:
                price_list_docs = list_check_response.json().get('data', [])
                if price_list_docs:
                    price_list_doc_name = price_list_docs[0]['name']
                    print(f"Eliminando documento Price List: {price_list_doc_name}")

                    list_delete_response, list_delete_error = make_erpnext_request(
                        session=session,
                        method="DELETE",
                        endpoint=f"/api/resource/Price List/{quote(price_list_doc_name)}",
                        operation_name=f"Delete price list document '{price_list_doc_name}'"
                    )

                    if list_delete_error:
                        print(f"Error eliminando Price List document: {list_delete_error}")
                    elif list_delete_response.status_code in [200, 202, 204]:
                        print(f"Documento Price List '{price_list_doc_name}' eliminado exitosamente")
                    else:
                        print(f"Error eliminando Price List document: {list_delete_response.text}")
                else:
                    print(f"No se encontró documento Price List para '{price_list_name}'")
            else:
                print(f"Error buscando documento Price List: {list_check_response.text}")
        except Exception as e:
            print(f"Error eliminando documento Price List: {e}")

        return jsonify({
            "success": True,
            "message": f"Lista de precios eliminada exitosamente",
            "deleted": deleted_count,
            "failed": failed_count
        })

    except Exception as e:
        print(f"Error eliminando lista de precios {price_list_name}: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/<path:price_list_name>/status', methods=['PATCH'])
@cross_origin(supports_credentials=True)
def update_sales_price_list_status(price_list_name):
    """Actualizar el estado (habilitado/deshabilitado) de una lista de precios de venta"""
    print(f"\n--- Petición para actualizar estado de lista de precios: {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Datos requeridos"}), 400

        enabled = data.get('enabled')

        if enabled is None:
            return jsonify({"success": False, "message": "Campo 'enabled' requerido"}), 400

        # Verificar que la lista existe
        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Price%20List?filters=[[\"price_list_name\",\"=\",\"{price_list_name}\"]]&fields=[\"name\",\"enabled\"]&limit_page_length=1",
            operation_name=f"Check if price list '{price_list_name}' exists for status update"
        )

        if check_error:
            print(f"Error verificando existencia de lista: {check_error}")
            return jsonify({"success": False, "message": "Error verificando lista de precios"}), 500

        if check_response.status_code != 200:
            print(f"Error verificando existencia de lista: {check_response.text}")
            return jsonify({"success": False, "message": "Error verificando lista de precios"}), 500

        existing_lists = check_response.json().get('data', [])
        if not existing_lists:
            return jsonify({"success": False, "message": "Lista de precios no encontrada"}), 404

        price_list_doc = existing_lists[0]
        price_list_name_field = price_list_doc.get('name')

        # Preparar datos para actualización
        update_data = {
            "enabled": 1 if enabled else 0
        }

        # Actualizar la lista de precios
        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Price List/{price_list_name_field}",
            data={"data": update_data},
            operation_name=f"Update status of price list '{price_list_name}'"
        )

        if update_error:
            print(f"Error actualizando estado de lista: {update_error}")
            return jsonify({"success": False, "message": "Error actualizando estado de lista de precios"}), 500

        if update_response.status_code not in [200, 201]:
            print(f"Error actualizando estado de lista: {update_response.text}")
            return jsonify({"success": False, "message": "Error actualizando estado de lista de precios"}), 500

        action = "habilitada" if enabled else "deshabilitada"
        message = f"Lista de precios '{price_list_name}' {action} exitosamente"

        return jsonify({
            "success": True,
            "message": message,
            "price_list_name": price_list_name,
            "enabled": enabled
        })

    except Exception as e:
        print(f"Error actualizando estado de lista de precios {price_list_name}: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/import-data', methods=['POST'])
def import_sales_price_list_data():
    """Importar datos de lista de precios usando el Data Import Tool de ERPNext"""
    print("\n--- Importando datos de lista de precios usando Data Import Tool ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Verificar que se recibió un archivo
        if 'file' not in request.files:
            return jsonify({"success": False, "message": "No se recibió ningún archivo"}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({"success": False, "message": "Nombre de archivo vacío"}), 400

        # Obtener parámetros adicionales
        price_list_name = request.form.get('price_list_name')
        currency = request.form.get('currency')
        valid_from = request.form.get('valid_from')

        if not price_list_name:
            return jsonify({"success": False, "message": "Nombre de lista de precios requerido"}), 400

        print(f"📁 Archivo recibido: {file.filename}")
        print(f"📋 Lista de precios: {price_list_name}")
        print(f"💱 Moneda: {currency}")

        # Obtener la compañía activa
        company_name = get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        # Verificar si la Price List existe, si no, crearla
        price_list_filters = json.dumps([["price_list_name","=",price_list_name], ["custom_company","=",company_name]])
        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Price%20List?filters={quote(price_list_filters)}&limit_page_length=1",
            operation_name=f"Check if price list '{price_list_name}' exists for import"
        )

        price_list_exists = False
        if check_error:
            print(f"📋 Error checking price list existence: {check_error}")
        elif check_response.status_code == 200:
            existing = check_response.json().get('data', [])
            price_list_exists = len(existing) > 0
            print(f"📋 Price List '{price_list_name}' existe: {price_list_exists}")
        else:
            print(f"📋 Error checking price list existence: {check_response.status_code}")

        if not price_list_exists:
            # Crear la Price List de venta
            price_list_data = {
                "price_list_name": price_list_name,
                "enabled": 1,
                "buying": 0,
                "selling": 1,
                "currency": currency,
                "custom_company": company_name
            }

            if valid_from:
                price_list_data["valid_from"] = valid_from

            print(f"📋 Creando Price List con data: {price_list_data}")

            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Price List",
                data={"data": price_list_data},
                operation_name=f"Create sales price list '{price_list_name}' for import"
            )

            if create_error:
                print(f"❌ Error creando Price List de venta: {create_error}")
                return jsonify({"success": False, "message": f"Error creando Price List: {create_error}"}), 500

            if create_response.status_code not in [200, 201]:
                print(f"❌ Error creando Price List de venta: {create_response.text}")
                return jsonify({"success": False, "message": f"Error creando Price List: {create_response.text}"}), 500

            print(f"✅ Price List de venta creada: {price_list_name}")
        else:
            print(f"✅ Price List de venta ya existe: {price_list_name}")

        # Leer el archivo y convertirlo a CSV si es necesario
        file_content = file.read().decode('utf-8')

        # Determinar el tipo de archivo por extensión
        filename = file.filename.lower()
        if filename.endswith('.csv'):
            csv_content = file_content
        elif filename.endswith(('.xlsx', '.xls')):
            # Para archivos Excel, por ahora asumimos que ya vienen como CSV
            # En una implementación completa, usaríamos una librería como openpyxl
            return jsonify({"success": False, "message": "Archivos Excel no soportados aún. Use CSV."}), 400
        else:
            return jsonify({"success": False, "message": "Formato de archivo no soportado. Use CSV."}), 400

        # Obtener el abbr de la compañía para quitarlo de los item codes
        company_abbr = None
        try:
            active_company = get_active_company(user_id)
            if active_company:
                company_abbr = get_company_abbr(session, headers, active_company)
                print(f"📋 Company abbr: {company_abbr}")
        except Exception as e:
            print(f"⚠️ Error obteniendo company abbr: {e}")

        # Modo: insert (default) o update
        mode = (request.form.get('mode') or 'insert').strip().lower()
        print(f"🔍 Import mode: {mode}")

        # Procesar el CSV y formatearlo para ERPNext
        csv_input = io.StringIO(csv_content)
        csv_reader = csv.DictReader(csv_input)
        original_fieldnames = csv_reader.fieldnames or []

        rows = []
        for row_idx, row in enumerate(csv_reader, start=2):  # +2 porque header es línea 1
            try:
                # Try common item code columns
                item_code = (row.get('item_code') or row.get('Item Code') or row.get('SKU') or row.get('codigo') or '').strip()
                price_val = (row.get('price') or row.get('valor') or row.get('precio') or row.get('Rate') or '').strip()

                if not item_code:
                    print(f"⚠️ Fila {row_idx}: Código de item faltante, omitiendo")
                    continue
                if not price_val:
                    print(f"⚠️ Fila {row_idx}: Precio faltante, omitiendo")
                    continue

                try:
                    price_float = float(price_val.replace(',', '.'))
                except ValueError:
                    print(f"⚠️ Fila {row_idx}: Precio inválido '{price_val}', omitiendo")
                    continue

                # Normalize item_code to include company abbr when present (for ERPNext storage)
                final_code = item_code
                if company_abbr and f" - {company_abbr}" not in final_code:
                    final_code = f"{final_code} - {company_abbr}"

                row_out = {
                    'Item Code': final_code,
                    'Price List': price_list_name,
                    'Currency': currency,
                    'Rate': price_float,
                    'Buying': 0,
                    'Selling': 1
                }
                if valid_from:
                    row_out['Valid From'] = valid_from

                # Preserve original columns so we can rebuild CSV if needed
                row_out['_original_row'] = row
                rows.append(row_out)
            except Exception as row_error:
                print(f"⚠️ Error procesando fila {row_idx}: {row_error}")
                continue

        if not rows:
            return jsonify({"success": False, "message": "No se pudieron procesar filas válidas del archivo"}), 400

        print(f"✅ Filas procesadas: {len(rows)}")

        # If update mode, ensure we have Identificador column (docname) for each row
        if mode == 'update':
            # Check if original CSV already provided an identifier column
            provided_identifier = False
            for fn in original_fieldnames:
                if fn and fn.strip().lower() in ['identificador', 'name', 'docname']:
                    provided_identifier = True
                    identifier_fieldname = fn
                    break

            if provided_identifier:
                print("🔍 CSV contiene columna identificador proporcionada por frontend; will use it for update")
                # Rebuild rows preserving the provided identifier (normalize into 'Identificador')
                for r in rows:
                    orig = r.get('_original_row', {})
                    r['Identificador'] = orig.get(identifier_fieldname, '').strip()

            else:
                # Need to auto-resolve docnames using abbr-only lookup
                if not company_abbr:
                    codes_missing = [r['_original_row'].get('item_code') or r['_original_row'].get('Item Code') for r in rows]
                    sample = ', '.join([c for c in (codes_missing[:50] or []) if c])
                    msg = (
                        "Modo 'update' requiere Identificador (docname) para cada Item Price. "
                        "No hay sigla de compañía activa para intentar resolución automática. "
                        f"Ejemplos de códigos: {sample}"
                    )
                    print(f"❌ Auto-resolve aborted: {msg}")
                    return jsonify({"success": False, "message": msg, "missing_item_codes": codes_missing}), 400

                # Build lookup codes with abbr only
                lookup_codes = []
                for r in rows:
                    orig = r.get('_original_row', {})
                    code = (orig.get('item_code') or orig.get('Item Code') or orig.get('SKU') or orig.get('codigo') or '').strip()
                    if not code:
                        continue
                    lookup_codes.append(f"{code} - {company_abbr}")

                unique_codes = list(set(lookup_codes))
                try:
                    lookup_filters = [
                        ["price_list", "=", price_list_name],
                        ["item_code", "in", unique_codes],
                        ["selling", "=", 1]
                    ]
                    params = {
                        "fields": '["name","item_code"]',
                        "filters": json.dumps(lookup_filters),
                        "limit_page_length": len(unique_codes) or 1000
                    }
                    print(f"🔎 Attempting to auto-resolve missing Item Price names (abbr-only) for {len(unique_codes)} codes")
                    lookup_resp, lookup_err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint="/api/resource/Item Price",
                        params=params,
                        operation_name="Auto-resolve Item Price names for sales (abbr-only)"
                    )

                    found_map = {}
                    if lookup_err:
                        print(f"⚠️ Error buscando Item Prices para resolver names: {lookup_err}")
                    elif lookup_resp.status_code == 200:
                        for r in lookup_resp.json().get('data', []):
                            found_map[r.get('item_code')] = r.get('name')
                        print(f"🔎 Auto-resolve (abbr-only) found {len(found_map)} Item Prices")
                    else:
                        print(f"⚠️ Auto-resolve lookup returned status {lookup_resp.status_code}: {lookup_resp.text}")

                    unresolved = []
                    for r in rows:
                        orig = r.get('_original_row', {})
                        code = (orig.get('item_code') or orig.get('Item Code') or orig.get('SKU') or orig.get('codigo') or '').strip()
                        if not code:
                            unresolved.append(code)
                            continue
                        abbr_code = f"{code} - {company_abbr}"
                        assigned = found_map.get(abbr_code)
                        if assigned:
                            r['Identificador'] = assigned
                            print(f"🔧 Auto-resolved name for {abbr_code} -> {assigned}")
                        else:
                            unresolved.append(code)

                    if unresolved:
                        sample = ', '.join(unresolved[:50])
                        msg = (
                            f"Modo 'update' requiere Identificador (docname) para cada Item Price. "
                            f"No pude resolver automáticamente {len(unresolved)} items usando solo la sigla de compañía. Ejemplos: {sample}"
                        )
                        print(f"❌ Auto-resolve incomplete: {msg}")
                        return jsonify({"success": False, "message": msg, "missing_item_codes": unresolved}), 400

                except Exception as e:
                    print(f"⚠️ Exception intentando auto-resolver names: {e}")
                    print(traceback.format_exc())

        # Rebuild CSV for import
        output = io.StringIO()
        # If update mode, include Identificador as first column to match ERPNext Spanish template
        if mode == 'update':
            fieldnames = ["Identificador", "Item Code", "Price List", "Currency", "Rate", "Buying", "Selling"]
        else:
            fieldnames = ["Item Code", "Price List", "Currency", "Rate", "Buying", "Selling"]
        if valid_from:
            # insert Valid From at the end if present
            fieldnames.append("Valid From")

        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()

        for r in rows:
            out_row = {
                'Item Code': r['Item Code'],
                'Price List': r['Price List'],
                'Currency': r['Currency'],
                'Rate': r['Rate'],
                'Buying': r['Buying'],
                'Selling': r['Selling']
            }
            if valid_from:
                out_row['Valid From'] = r.get('Valid From')
            if mode == 'update':
                out_row['Identificador'] = (r.get('Identificador') or '').strip()
            writer.writerow(out_row)

        csv_data = output.getvalue()
        print(f"📄 CSV generado con {len(rows)} filas (mode={mode})")

        # Crear el Data Import en ERPNext
        import_type = "Update Existing Records" if mode == 'update' else "Insert New Records"
        import_data = {
            "reference_doctype": "Item Price",
            "import_type": import_type,
            "submit_after_import": 0,
            "ignore_encoding_errors": 1,
            "data": csv_data
        }

        # Iniciar el import
        import_response, import_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.core.doctype.data_import.data_import.form_start_import",
            data=import_data,
            operation_name=f"Start data import for sales price list '{price_list_name}'"
        )

        if import_error:
            print(f"❌ Error en Data Import: {import_error}")
            return jsonify({"success": False, "message": f"Error en Data Import: {import_error}"}), 500

        if import_response.status_code in [200, 201]:
            import_result = import_response.json()

            if import_result.get('message'):
                # Extraer el import_name del mensaje
                message = import_result['message']
                print(f"✅ Data Import iniciado: {message}")

                # El mensaje típico es: "Import 'Import-2024-01-01-123456' has been enqueued"
                import_name = None
                if 'Import' in message and 'has been enqueued' in message:
                    import_name = message.split("'")[1] if "'" in message else None

                return jsonify({
                    "success": True,
                    "message": "Importación iniciada exitosamente",
                    "import_name": import_name,
                    "total_rows": len(rows),
                    "data_import_message": message
                })
            else:
                return jsonify({"success": False, "message": "Error iniciando importación"}), 500
        else:
            error_text = import_response.text
            print(f"❌ Error en Data Import: {error_text}")
            return jsonify({"success": False, "message": f"Error en Data Import: {error_text}"}), 500

    except Exception as e:
        print(f"❌ Error en import_sales_price_list_data: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@sales_price_lists_bp.route('/api/sales-price-lists/import-progress/<import_name>', methods=['GET'])
def get_import_progress(import_name):
    """Obtener el progreso de una importación usando Data Import Tool"""
    print(f"\n--- Consultando progreso de importación: {import_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Consultar el estado del Data Import
        progress_response, progress_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Data Import/{quote(import_name)}",
            operation_name=f"Get import progress for '{import_name}'"
        )

        if progress_error:
            return jsonify({"success": False, "message": "Error obteniendo progreso de importación"}), 500

        if progress_response.status_code == 200:
            import_data = progress_response.json().get('data', {})

            status = import_data.get('status', 'Unknown')
            total_rows = import_data.get('total_rows', 0)
            successful_imports = import_data.get('successful_imports', 0)
            failed_imports = import_data.get('failed_imports', 0)

            # Calcular porcentaje
            processed_rows = successful_imports + failed_imports
            percentage = int((processed_rows / total_rows) * 100) if total_rows > 0 else 0

            # Determinar si está completo
            is_completed = status in ['Completed', 'Partially Successful', 'Failed']

            result = {
                "success": True,
                "import_name": import_name,
                "status": status,
                "progress": processed_rows,
                "total": total_rows,
                "percentage": percentage,
                "successful_imports": successful_imports,
                "failed_imports": failed_imports,
                "is_completed": is_completed
            }

            # Si está completo, obtener detalles de errores si los hay
            if is_completed and failed_imports > 0:
                # Obtener el log de importación para detalles de errores
                filters = json.dumps([['data_import', '=', import_name]])
                fields = json.dumps(['row_index', 'error_message', 'docname'])
                log_response, log_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Data Import Log?filters={filters}&fields={fields}&limit_page_length=100",
                    operation_name=f"Get import error logs for '{import_name}'"
                )

                if log_error:
                    print(f"Error obteniendo logs de error: {log_error}")
                elif log_response.status_code == 200:
                    log_data = log_response.json().get('data', [])
                    result["errors"] = log_data

            return jsonify(result)
        else:
            return jsonify({"success": False, "message": "Error obteniendo progreso de importación"}), 500

    except Exception as e:
        print(f"❌ Error en get_import_progress: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
