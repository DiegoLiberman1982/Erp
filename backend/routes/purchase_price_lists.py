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
from urllib.parse import quote
# Importar CORS para manejo específico
from flask_cors import cross_origin

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Almacenamiento temporal de progreso de importaciones
import_progress = {}

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr, remove_company_abbr, add_company_abbr, get_smart_limit, get_active_company, validate_company_abbr_operation

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
# Import automation service for scheduling recalculations
from services import price_list_automation_service

# Crear el blueprint para las rutas de purchase price lists
purchase_price_lists_bp = Blueprint('purchase_price_lists', __name__)


# Helper: elegir la fila más reciente dentro de una lista de Item Price
def _pick_latest_price_row(prices):
    """Devuelve la fila con la fecha más reciente según prioridad: valid_from > modified > creation.
    Acepta strings ISO como '2025-11-05' o '2025-11-10 10:52:35.508964'.
    Si no hay fechas parseables, se considera la fecha mínima.
    """
    if not prices:
        return None

    from datetime import datetime

    def _parse_date(s):
        if not s:
            return None
        try:
            # datetime.fromisoformat maneja 'YYYY-MM-DD' y 'YYYY-MM-DD HH:MM:SS[.ffffff]'
            return datetime.fromisoformat(s)
        except Exception:
            try:
                # Fallback: intentar parseo simple conservador
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
            # Si falla el parsing en un row concreto, ignorarlo pero no romper el loop
            if best is None:
                best = p
                best_ts = datetime.fromtimestamp(0)
    return best


def _ensure_price_list_for_company(session, price_list_name, company_name):
    """Fetch a Price List doc and ensure it belongs to the provided company"""
    try:
        if not company_name:
            return None, (jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400)

        detail_response, detail_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Price List/{quote(price_list_name)}",
            operation_name=f"Fetch purchase price list '{price_list_name}'"
        )

        if detail_error:
            print(f"❌ Error obteniendo lista {price_list_name}: {detail_error}")
            return None, (jsonify({"success": False, "message": "Lista de precios no encontrada"}), 404)

        if not detail_response or detail_response.status_code != 200:
            message = detail_response.text if detail_response else "Lista de precios no encontrada"
            print(f"❌ Price List '{price_list_name}' no encontrada: {message}")
            return None, (jsonify({"success": False, "message": "Lista de precios no encontrada"}), 404)

        price_list_data = detail_response.json().get('data', {})
        pl_company = price_list_data.get('custom_company')
        if pl_company != company_name:
            readable_company = pl_company or "sin asignar"
            msg = f"La lista de precios '{price_list_name}' pertenece a otra compañía ({readable_company})"
            print(f"❌ {msg}")
            return None, (jsonify({"success": False, "message": msg}), 403)

        return price_list_data, None
    except Exception as e:
        print(f"❌ Error validando acceso a lista '{price_list_name}': {e}")
        return None, (jsonify({"success": False, "message": "Error verificando lista de precios"}), 500)


def _get_company_purchase_price_lists(session, company_name):
    """Return all purchase price list names scoped to a company"""
    try:
        filters = json.dumps([["buying", "=", 1], ["custom_company", "=", company_name]])
        params = {
            "fields": '["price_list_name"]',
            "filters": filters,
            "limit_page_length": get_smart_limit(company_name, 'list')
        }
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Price List",
            params=params,
            operation_name=f"Fetch purchase price lists for {company_name}"
        )
        if error or response.status_code != 200:
            print(f"⚠️ No se pudieron obtener listas para {company_name}: {error or response.text}")
            return []
        data = response.json().get('data', [])
        return [pl.get("price_list_name") for pl in data if pl.get("price_list_name")]
    except Exception as e:
        print(f"⚠️ Error obteniendo listas de compra para {company_name}: {e}")
        return []


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/bulk-import', methods=['POST'])
def bulk_import_purchase_price_lists():
    """Importar múltiples precios de compra usando Data Import Tool de ERPNext"""
    print("\n--- Petición para importar listas de precios de compra usando Data Import Tool ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        mode = data.get('mode', 'insert')  # 'insert' o 'update'
        supplier = data.get('supplier')
        price_list_description = data.get('price_list_description', '').strip()[:26]  # Máx 26 caracteres
        currency = data.get('currency')  # Moneda de la Price List
        exchange_rate = data.get('exchange_rate')  # Cotización de la Price List
        exchange_rate_mode = data.get('exchange_rate_mode')  # 'specific'|'general' optional

        # Normalize exchange_rate based on exchange_rate_mode when provided
        if exchange_rate_mode:
            if exchange_rate_mode == 'general':
                exchange_rate = -1
            elif exchange_rate_mode == 'specific':
                # Ensure provided exchange_rate is valid
                try:
                    if exchange_rate is None:
                        return jsonify({"success": False, "message": "exchange_rate required for specific mode"}), 400
                    parsed = float(exchange_rate)
                    if parsed < 0:
                        return jsonify({"success": False, "message": "exchange_rate must be >= 0 for specific mode"}), 400
                    exchange_rate = parsed
                except Exception:
                    return jsonify({"success": False, "message": "Invalid exchange_rate value"}), 400
            else:
                # unknown mode - ignore and proceed with raw value
                pass
        items = data.get('items', [])

        # Si no hay items pero estamos en modo 'update', permitir actualizar
        # solo la metadata de la Price List (moneda / cotización)
        if not items:
            if mode == 'update':
                existing_price_list = data.get('existing_price_list')
                if not existing_price_list:
                    return jsonify({"success": False, "message": "Modo update requiere existing_price_list"}), 400

                update_body = {}
                if currency is not None and currency != '':
                    update_body['currency'] = currency
                if exchange_rate is not None and exchange_rate != '':
                    try:
                        update_body['custom_exchange_rate'] = float(exchange_rate)
                    except Exception:
                        # intentar como string si no convierte
                        update_body['custom_exchange_rate'] = exchange_rate

                if not update_body:
                    return jsonify({"success": False, "message": "No hay items para importar ni metadata para actualizar"}), 400

                # Actualizar la Price List directamente en ERPNext
                print(f"Actualizar solo metadata de Price List '{existing_price_list}': {update_body}")
                resp, err = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Price List/{quote(existing_price_list)}",
                    data={"data": update_body},
                    operation_name=f"Update Price List '{existing_price_list}' (metadata only)"
                )

                if err:
                    print(f"Error actualizando Price List metadata: {err}")
                    return jsonify({"success": False, "message": f"Error actualizando lista: {err}"}), 500

                if resp.status_code in [200, 201]:
                    updated = resp.json().get('data', {})
                    print(f"Lista de precios actualizada (metadata) for {existing_price_list}: {updated}")
                    # Try scheduling recalculation for dependent price lists (metadata-only path)
                    try:
                        sched_result = price_list_automation_service.schedule_price_list_recalculation(existing_price_list, session)
                        print(f"🔔 Scheduled recalculation (metadata-only path) for {existing_price_list}: {sched_result}")
                    except Exception as se:
                        print(f"⚠️ Error scheduling recalculation (metadata-only path) for {existing_price_list}: {se}")

                    return jsonify({"success": True, "message": "Lista de precios actualizada (metadata)", "data": updated})
                else:
                    print(f"Error updating price list metadata: {resp.status_code} - {resp.text}")
                    return jsonify({"success": False, "message": f"Error actualizando lista: {resp.text}"}), 500

            # Si no es modo update, devolver error como antes
            return jsonify({"success": False, "message": "No se proporcionaron items para importar"}), 400

        # Validación estricta: el frontend DEBE enviar 'item_name' para cada item.
        # No se permiten fallbacks en backend — si falta 'item_name' se devuelve error
        missing_name_items = []
        for it in items:
            name_val = (it.get('item_name') or '').strip()
            if not name_val:
                # usar el código si está disponible, sino indicar '<unknown>'
                code = (it.get('item_code') or '').strip() or '<unknown>'
                missing_name_items.append(code)

        if missing_name_items:
            # Limitar lista mostrada en mensaje a 50 códigos para no inflar la respuesta
            sample = ', '.join(missing_name_items[:50])
            msg = (
                f"Faltan 'item_name' en {len(missing_name_items)} items. "
                "El frontend debe enviar 'item_name' para cada item. "
                f"Ejemplos de códigos faltantes: {sample}"
            )
            print(f"❌ Validation failed: {msg}")
            return jsonify({
                "success": False,
                "message": msg,
                "missing_item_codes": missing_name_items
            }), 400

        # Nota: la validación de 'name' en modo 'update' se realiza MÁS ADELANTE
        # después de obtener la sigla de compañía (company_abbr) para permitir
        # intentar una resolución automática usando el código con la sigla.

        company_name = data.get('company') or request.args.get('company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        # Generar nombre de Price List basado en el modo
        price_list_name = None
        if mode == 'update':
            existing_price_list = data.get('existing_price_list')
            if not existing_price_list:
                return jsonify({"success": False, "message": "existing_price_list requerido para modo update"}), 400
            price_list_name = existing_price_list
        else:
            # Modo insert: crear nueva Price List
            if supplier and price_list_description:
                price_list_name = f"{supplier} - {price_list_description}"
            else:
                price_list_name = f"Lista Compra - {datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}"

        print(f"📋 Modo: {mode}, Lista: {price_list_name}, Items: {len(items)}")

        # Obtener el abbr de la compañía para manejar item codes correctamente
        company_abbr = None
        try:
            if company_name:
                company_abbr = get_company_abbr(session, headers, company_name)
                print(f"🏢 Company abbr: {company_abbr}")
        except Exception as e:
            print(f"⚠️ Error obteniendo company abbr: {e}")

        # Evitar actualizar listas de otra compañía
        if mode == 'update':
            _, access_error = _ensure_price_list_for_company(session, price_list_name, company_name)
            if access_error:
                return access_error

        # Crear CSV(s) para Data Import Tool
        # Si estamos en modo 'update' podemos tener una mezcla de rows: algunas con 'name' (actualizar)
        # y otras sin 'name' (crear). Para manejarlo correctamente, generamos dos CSVs separados
        # y lanzamos dos Data Imports: uno para actualizar (Update Existing Records) y otro para
        # insertar (Insert New Records). Esto evita usar un único import_type para filas mixtas.

        update_rows = []
        insert_rows = []
        prepared_rows = []

        for item in items:
            item_code = item.get('item_code', '').strip()
            item_name = item.get('item_name', '').strip()
            price = item.get('price', 0)
            item_supplier = item.get('supplier', supplier)  # Usar supplier del item o el general

            # Si el frontend no aportó item_name, saltar (no se puede crear/actualizar sin referencia)
            if not item_name:
                print(f"⏭️ Skipping item {item_code}: no item_name provided")
                continue

            # Agregar sigla al supplier para ERPNext
            erpnext_supplier = item_supplier
            if company_abbr and item_supplier:
                original_supplier = item_supplier
                erpnext_supplier = add_company_abbr(item_supplier, company_abbr)
                if not validate_company_abbr_operation(original_supplier, erpnext_supplier, company_abbr, 'add'):
                    print(f"⚠️ Validation failed for supplier name abbreviation: {original_supplier} -> {erpnext_supplier}")

            if not item_code or not price:
                print(f"⏭️ Skipping item {item_code}: missing code or price")
                continue

            # Cuando el frontend nos envía item_name sin sigla, en el backend agregamos
            # la sigla de compañía para mantener consistencia si los registros de ERPNext
            # almacenan item_name con el sufijo " - ABBR".
            if company_abbr and item_name:
                original_item_name = item_name
                item_name = add_company_abbr(item_name, company_abbr)
                if not validate_company_abbr_operation(original_item_name, item_name, company_abbr, 'add'):
                    print(f"⚠️ Warning: item_name abbreviation addition validation failed: {original_item_name} -> {item_name}")
                else:
                    print(f"🧾 Added company abbr to item_name: {item_name}")

            # Manejar company abbr: asegurar que el final del código tenga el abbr
            if company_abbr:
                if item_code.endswith(f' - {company_abbr}'):
                    base_code = item_code[:-len(f' - {company_abbr}')]
                else:
                    base_code = item_code
                final_item_code = f"{base_code} - {company_abbr}"
            else:
                final_item_code = item_code

            # Construir row base
            try:
                rate_value = float(price)
            except Exception:
                print(f"?? Skipping item {item_code}: invalid price '{price}'")
                continue

            base_row = {
                "Item Code": final_item_code,
                "Price List": price_list_name,
                "Currency": currency,
                "Rate": rate_value,
                "Buying": 1,
                "Selling": 0,
                "Supplier": erpnext_supplier
            }

            docname_val = (item.get('name') or '').strip()
            if not docname_val:
                docname_val = (item.get('item_price_name') or '').strip()

            prepared_rows.append({
                "base_row": base_row,
                "docname": docname_val,
                "final_item_code": final_item_code,
                "_source_docname": docname_val if docname_val else None,
                "_auto_resolved": False
            })

        auto_resolved = 0
        if mode == 'update':
            codes_to_lookup = list({row["final_item_code"] for row in prepared_rows if not row["docname"]})
            if codes_to_lookup:
                existing_price_map = {}
                batch_size = 150
                total_batches = (len(codes_to_lookup) + batch_size - 1) // batch_size
                for start in range(0, len(codes_to_lookup), batch_size):
                    batch = codes_to_lookup[start:start + batch_size]
                    lookup_filters = [
                        ["price_list", "=", price_list_name],
                        ["item_code", "in", batch],
                        ["buying", "=", 1]
                    ]
                    params = {
                        "fields": json.dumps(["name", "item_code", "modified", "valid_from", "creation"]),
                        "filters": json.dumps(lookup_filters),
                        "limit_page_length": max(len(batch), 100)
                    }
                    lookup_label = f"Lookup purchase price docnames ({start // batch_size + 1}/{total_batches})"
                    resp, err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint="/api/resource/Item Price",
                        params=params,
                        operation_name=lookup_label
                    )
                    if err:
                        print(f"?? Error resolving Item Price docnames: {err}")
                        continue
                    if resp and resp.status_code in [200, 201]:
                        try:
                            payload = resp.json()
                            data_rows = payload.get('data', []) if isinstance(payload, dict) else []
                        except Exception:
                            data_rows = []
                        for row in data_rows:
                            code = row.get('item_code')
                            name = row.get('name')
                            if not code or not name:
                                continue
                            current = existing_price_map.get(code)
                            if current:
                                best = _pick_latest_price_row([current, row])
                                if best:
                                    existing_price_map[code] = best
                            else:
                                existing_price_map[code] = row
                for row in prepared_rows:
                    if row["docname"]:
                        continue
                    resolved = existing_price_map.get(row["final_item_code"])
                    if resolved:
                        row["docname"] = resolved.get("name") if isinstance(resolved, dict) else resolved
                        row["_auto_resolved"] = True
                        auto_resolved += 1
                if auto_resolved:
                    print(f"?? Auto-resolved {auto_resolved} Item Price docname(s) for list {price_list_name}")

        if prepared_rows:
            print("Debug Purchase Price docname resolution (primeros 5 items):")
            for idx, row in enumerate(prepared_rows[:5]):
                status = "sin-identificador"
                if row.get("_source_docname"):
                    status = "frontend"
                elif row.get("_auto_resolved"):
                    status = "auto"
                elif row.get("docname"):
                    status = "pre"
                print(f"   {idx + 1}. code={row['final_item_code']} docname={row.get('docname') or '-'} status={status}")

        for row in prepared_rows:
            base_row = row["base_row"]
            docname_val = (row.get("docname") or '').strip()
            if mode == 'update' and docname_val:
                row_out = dict(base_row)
                row_out["Identificador"] = docname_val
                update_rows.append(row_out)
            else:
                insert_rows.append(base_row)

        # Generar CSV de updates e inserts (pueden estar vacíos)
        update_csv = ''
        insert_csv = ''

        if update_rows:
            update_output = io.StringIO()
            update_fieldnames = ["Identificador", "Price List", "Currency", "Rate", "Buying", "Selling", "Supplier"]
            writer_u = csv.DictWriter(update_output, fieldnames=update_fieldnames)
            writer_u.writeheader()
            for r in update_rows:
                writer_u.writerow({
                    "Identificador": r.get("Identificador"),
                    "Price List": r.get("Price List"),
                    "Currency": r.get("Currency"),
                    "Rate": r.get("Rate"),
                    "Buying": r.get("Buying"),
                    "Selling": r.get("Selling"),
                    "Supplier": r.get("Supplier")
                })
            update_csv = update_output.getvalue()

        if insert_rows:
            insert_output = io.StringIO()
            insert_fieldnames = ["Item Code", "Price List", "Currency", "Rate", "Buying", "Selling", "Supplier"]
            writer_i = csv.DictWriter(insert_output, fieldnames=insert_fieldnames)
            writer_i.writeheader()
            for r in insert_rows:
                writer_i.writerow(r)
            insert_csv = insert_output.getvalue()

        # Calcular totales para progreso
        valid_items_count = 0
        if update_csv:
            valid_items_count += len([l for l in update_csv.split('\n') if l.strip()]) - 1
        if insert_csv:
            valid_items_count += len([l for l in insert_csv.split('\n') if l.strip()]) - 1
        print(f"📄 CSVs generados - updates: {len(update_rows)}, inserts: {len(insert_rows)} (total filas válidas: {valid_items_count})")

        # Generar ID único para este proceso
        process_id = str(uuid.uuid4())

        # Inicializar progreso
        import_progress[process_id] = {
            "success": True,
            "progress": 0,
            "total": valid_items_count,  # Usar la cantidad real de items válidos
            "current_item": "Iniciando importación...",
            "message": f"Importando {valid_items_count} precios...",
            "status": "running"
        }


        # Iniciar procesamiento en un hilo separado
        def process_import():
            try:
                # Ejecutar imports por separado: updates primero, luego inserts
                results = {
                    'updates': None,
                    'inserts': None
                }

                if update_csv:
                    print(f"🚀 Starting UPDATE import for {len(update_rows)} rows")
                    results['updates'] = _do_bulk_import_csv(session, headers, user_id, process_id, price_list_name, currency, exchange_rate, update_csv, 'update', items=None, company_name=company_name)

                if insert_csv:
                    print(f"🚀 Starting INSERT import for {len(insert_rows)} rows")
                    results['inserts'] = _do_bulk_import_csv(session, headers, user_id, process_id, price_list_name, currency, exchange_rate, insert_csv, 'insert', items=None, company_name=company_name)

                # After both imports, trigger automation once using the original items list
                try:
                    from services.price_list_automation_service import apply_automatic_updates
                    if items:
                        print(f"🔄 Triggering automatic selling price updates for {len(items)} items (post-import)")
                        # Map frontend 'price' into 'compra' when appropriate
                        items_for_automation = []
                        for it in items:
                            if not isinstance(it, dict):
                                items_for_automation.append(it)
                                continue
                            new_it = dict(it)
                            # Add company abbr to item_code to match stored Item Prices
                            item_code = new_it.get('item_code', '')
                            if item_code and company_abbr:
                                item_code = add_company_abbr(item_code, company_abbr)
                                new_it['item_code'] = item_code
                            has_compra = new_it.get('compra') is not None
                            has_cost = new_it.get('cost') is not None
                            if not has_compra and not has_cost:
                                price_front = new_it.get('price')
                                if price_front is not None:
                                    try:
                                        new_it['compra'] = float(price_front)
                                    except Exception:
                                        new_it['compra'] = price_front
                            items_for_automation.append(new_it)

                        au_result = apply_automatic_updates(
                            items_for_automation,
                            session,
                            perform_import=True,
                            list_type='sales',
                            source_currency=currency,
                            source_exchange_rate=exchange_rate,
                            company_abbr=company_abbr,
                            company_name=company_name
                        )
                        import_progress[process_id]["automation"] = au_result
                        print(f"✅ Automatic updates result: {au_result}")
                except Exception as ae:
                    import_progress[process_id]["automation_error"] = str(ae)
                    print(f"⚠️ Error applying automatic updates: {ae}")

                # Consolidated result: collect saved/failed counts from both results
                try:
                    saved = 0
                    failed = 0
                    if results.get('updates'):
                        saved += results['updates'].get('saved', 0)
                        failed += results['updates'].get('failed', 0)
                    if results.get('inserts'):
                        saved += results['inserts'].get('saved', 0)
                        failed += results['inserts'].get('failed', 0)
                    import_progress[process_id]["saved"] = saved
                    import_progress[process_id]["failed"] = failed
                except Exception:
                    pass

            except Exception as e:
                print(f"Error en procesamiento de importación {process_id}: {e}")
                import_progress[process_id] = {
                    "success": False,
                    "progress": 0,
                    "total": valid_items_count,
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
            "total_items": valid_items_count  # Devolver la cantidad real de items válidos
        })

    except Exception as e:
        print(f"Error en bulk_import_purchase_price_lists: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def _do_bulk_import_csv(session, headers, user_id, process_id, price_list_name, currency, exchange_rate, csv_data, mode, items=None, company_name=None):
    """Función interna que realiza el import usando Data Import Tool con archivo subido"""


    if csv_data:
        csv_lines = csv_data.split('\n')
        print(f"🔍 Número de líneas en CSV: {len(csv_lines)}")
        print(f"🔍 Primeras 3 líneas del CSV:")
        for i, line in enumerate(csv_lines[:3]):
            print(f"🔍   Línea {i+1}: '{line}'")

    # Verificar si la Price List existe, si no, crearla
    filter_list = [["price_list_name", "=", price_list_name]]
    if company_name:
        filter_list.append(["custom_company", "=", company_name])
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
        print(f"🔍 Error checking price list existence: {check_error}")
    elif check_response.status_code == 200:
        existing = check_response.json().get('data', [])
        price_list_exists = len(existing) > 0
        if price_list_exists and company_name:
            existing_company = existing[0].get('custom_company')
            if existing_company != company_name:
                msg = f"La lista de precios '{price_list_name}' pertenece a otra compañía ({existing_company or 'sin asignar'})"
                print(f"❌ {msg}")
                import_progress[process_id]["status"] = "error"
                import_progress[process_id]["message"] = msg
                return
        print(f"🔍 Price List '{price_list_name}' existe: {price_list_exists}")
    else:
        print(f"🔍 Error checking price list existence: {check_response.status_code}")

    if not price_list_exists:
        # Crear la Price List de compra
        price_list_data = {
            "price_list_name": price_list_name,
            "enabled": 1,
            "buying": 1,
            "selling": 0,
            "currency": currency,
            "custom_company": company_name
        }

        if exchange_rate is not None:
            price_list_data["custom_exchange_rate"] = exchange_rate


        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Price List",
            data={"data": price_list_data},
            operation_name=f"Create purchase price list '{price_list_name}'"
        )

        if create_error:
            print(f"❌ Error creando Price List: {create_error}")
            import_progress[process_id]["status"] = "error"
            import_progress[process_id]["message"] = f"Error creando Price List: {create_error}"
            return

        if create_response.status_code not in [200, 201]:
            print(f"❌ Error creando Price List: {create_response.text}")
            import_progress[process_id]["status"] = "error"
            import_progress[process_id]["message"] = f"Error creando Price List: {create_response.text}"
            return

        print(f"✅ Price List creada: {price_list_name}")
    else:
        print(f"✅ Price List ya existe: {price_list_name}")

    # PASO 1: Subir el CSV como archivo
    print("🚀 Subiendo archivo CSV...")

    files = {
        'file': (f'import_{process_id}.csv', csv_data.encode('utf-8'), 'text/csv'),
        'is_private': (None, '0'),
        'folder': (None, 'Home')
    }

    # Crear headers sin Content-Type para multipart/form-data
    upload_headers = {k: v for k, v in headers.items() if k.lower() != 'content-type'}

    # Para archivos multipart, necesitamos usar session.post directamente
    upload_response = session.post(
        f"{ERPNEXT_URL}/api/method/upload_file",
        files=files,
        headers=upload_headers
    )

    print(f"🔍 Respuesta de upload_file - Status: {upload_response.status_code}")
    print(f"🔍 Respuesta completa: {upload_response.text}")

    if upload_response.status_code not in [200, 201]:
        print(f"❌ Error subiendo archivo: {upload_response.text}")
        import_progress[process_id]["status"] = "error"
        import_progress[process_id]["message"] = f"Error subiendo archivo: {upload_response.text}"
        return

    upload_result = upload_response.json()
    message_data = upload_result.get('message', {})

    # El file_url puede estar en diferentes lugares según la versión
    file_url = message_data.get('file_url') or message_data.get('file_name')

    if not file_url:
        print(f"❌ No se pudo obtener file_url del upload: {upload_result}")
        import_progress[process_id]["status"] = "error"
        import_progress[process_id]["message"] = "Error: No se pudo obtener file_url del upload"
        return

    print(f"✅ Archivo subido: {file_url}")

    # PASO 2: Crear el Data Import con el archivo adjunto
    # Elegir import_type según el modo: insertar o actualizar registros existentes
    import_type = "Update Existing Records" if mode == 'update' else "Insert New Records"

    import_doc_data = {
        "reference_doctype": "Item Price",
        "import_type": import_type,
        "submit_after_import": 0,
        "import_file": file_url,  # ← AQUÍ va la URL del archivo
        "mute_emails": 1
    }

    print(f"🔍 Creando Data Import con import_file: {file_url}")

    create_import_response, create_import_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Data Import",
        data={"data": import_doc_data},
        operation_name=f"Create data import for '{price_list_name}'"
    )

    print(f"🔍 Respuesta de creación de Data Import - Status: {create_import_response.status_code}")
    print(f"🔍 Respuesta completa: {create_import_response.text}")

    if create_import_error:
        error_text = create_import_error
        print(f"❌ Error creando Data Import document: {error_text}")
        import_progress[process_id]["status"] = "error"
        import_progress[process_id]["message"] = f"Error creando Data Import document: {error_text}"
        return

    if create_import_response.status_code not in [200, 201]:
        error_text = create_import_response.text
        print(f"❌ Error creando Data Import document: {error_text}")
        import_progress[process_id]["status"] = "error"
        import_progress[process_id]["message"] = f"Error creando Data Import document: {error_text}"
        return

    import_doc = create_import_response.json().get('data', {})
    import_name = import_doc.get('name')
    print(f"✅ Data Import document creado: {import_name}")
    print(f"🔍 import_doc completo: {import_doc}")

    payload_count = import_doc.get('payload_count', 0)
    print(f"🔍 payload_count: {payload_count}")

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

    print(f"🔍 Respuesta de form_start_import - Status: {import_response.status_code}")
    print(f"🔍 Respuesta completa: {import_response.text}")

    if import_error:
        error_text = import_error
        print(f"❌ Error en Data Import: {error_text}")
        import_progress[process_id]["status"] = "error"
        import_progress[process_id]["message"] = f"Error en Data Import: {error_text}"
        return

    if import_response.status_code in [200, 201]:
        import_result = import_response.json()
        print(f"🔍 import_result: {import_result}")

        message = import_result.get('message', '')
        print(f"✅ Data Import iniciado: {message}")

        # Esperar un poco para que el proceso termine y verificar el status final
        import time
        time.sleep(2)  # Esperar 2 segundos para que el proceso termine

        # Verificar el status final del Data Import
        status_check_response, status_check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Data Import/{quote(import_name)}",
            operation_name=f"Check final status of data import '{import_name}'"
        )

        final_status = "Pending"  # Default si no se puede verificar
        if status_check_error:
            print(f"⚠️ Error verificando status final: {status_check_error}")
        elif status_check_response.status_code == 200:
            status_data = status_check_response.json().get('data', {})
            final_status = status_data.get('status', 'Pending')
            print(f"🔍 Status final del Data Import: {final_status}")

        # Determinar si fue exitoso basado en el status final
        if final_status == "Success":
            # Actualizar progreso como completado
            import_progress[process_id]["status"] = "completed"
            import_progress[process_id]["message"] = f"Importación bulk completada exitosamente. Import ID: {import_name}"
            import_progress[process_id]["import_name"] = import_name
            # Calcular la cantidad real de items válidos del CSV
            csv_lines_count = len([line for line in csv_data.split('\n') if line.strip()]) - 1  # Restar header
            saved_count = csv_lines_count if csv_lines_count > 0 else payload_count
            import_progress[process_id]["saved"] = saved_count
            import_progress[process_id]["failed"] = 0
            import_progress[process_id]["price_list_name"] = price_list_name
            print(f"✅ Bulk import completado exitosamente (import: {import_name}) saved={saved_count}")
            # Devolver resumen del import para que el caller lo consuma
            return {
                'status': 'success',
                'import_name': import_name,
                'saved': saved_count,
                'failed': 0
            }
        else:
            # Status es Error, Pending u otro - marcar como error
            import_progress[process_id]["status"] = "error"
            import_progress[process_id]["message"] = f"Error en la importación bulk. Status: {final_status}. Import ID: {import_name}"
            import_progress[process_id]["import_name"] = import_name
            import_progress[process_id]["saved"] = 0
            import_progress[process_id]["failed"] = payload_count if payload_count > 0 else 1
            import_progress[process_id]["price_list_name"] = price_list_name
            print(f"❌ Bulk import falló con status: {final_status} (import: {import_name})")
            return {
                'status': 'error',
                'import_name': import_name,
                'saved': 0,
                'failed': payload_count if payload_count > 0 else 1
            }
    else:
        error_text = import_response.text
        print(f"❌ Error en Data Import: {error_text}")
        import_progress[process_id]["status"] = "error"
        import_progress[process_id]["message"] = f"Error en Data Import: {error_text}"


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/bulk-import-progress/<process_id>', methods=['GET'])
def get_bulk_import_progress(process_id):
    """Obtener el progreso de una importación en curso"""
    try:
        if process_id not in import_progress:
            return jsonify({"success": False, "message": "Proceso no encontrado"}), 404
        
        progress_data = import_progress[process_id]
        
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
            "imported": progress_data.get('imported', 0),
            "failed": progress_data.get('failed', 0),
            "price_list_name": progress_data.get('price_list_name', '')
        })
        
    except Exception as e:
        print(f"Error obteniendo progreso de importación {process_id}: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/verify-items-batch', methods=['POST'])
def verify_items_batch():
    """Verificar varios códigos de item y retornar sus nombres (batch lookup)"""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        codes = data.get('codes', [])
        company = get_active_company(user_id)

        print(f"🔍 verify_items_batch called with {len(codes)} codes, company: {company}")
        print(f"📋 Codes: {codes[:5]}..." if len(codes) > 5 else f"📋 Codes: {codes}")

        if not codes:
            print("⚠️ No codes provided")
            return jsonify({"success": True, "data": {}})

        # Procesar códigos en lotes para evitar URLs demasiado largas
        batch_size = 50  # Procesar máximo 50 códigos por request para evitar URLs largas
        all_items = []

        # Fetch company abbr once per request when possible so we can normalize results
        company_abbr = None
        if company:
            try:
                company_abbr = get_company_abbr(session, headers, company)
                if company_abbr:
                    print(f"🏢 Company abbr found (verify_items_batch): {company_abbr}")
            except Exception as e:
                print(f"⚠️ Error fetching company abbr for verify_items_batch: {e}")

        for i in range(0, len(codes), batch_size):
            batch_codes = codes[i:i + batch_size]
            print(f"🔄 Processing batch {i//batch_size + 1}: {len(batch_codes)} codes")

            # Expandir códigos para buscar tanto códigos exactos como con sufijo de compañía
            search_codes = list(batch_codes)  # Copia de los códigos originales
            
            # Si se pasó compañía, intentar agregar códigos con sufijo de compañía
            if company:
                company_abbr = get_company_abbr(session, headers, company)
                if company_abbr:
                    print(f"🏢 Company abbr found: {company_abbr}")
                    # Agregar versiones con sufijo de compañía
                    for code in batch_codes:
                        full_code = f"{code} - {company_abbr}"
                        if full_code not in search_codes:
                            search_codes.append(full_code)
                    print(f"🔍 Expanded search codes from {len(batch_codes)} to {len(search_codes)}")
                else:
                    print(f"⚠️ No company abbr found for: {company}")

            # Construir filtros para ERPNext: item_code in search_codes
            filters = [["item_code", "in", search_codes]]
            # No filtrar por compañía aquí, ya que los códigos de items deberían ser únicos
            # Si se necesita filtrar por compañía, hacerlo después de obtener los resultados

            params = {
                "fields": '["item_code", "item_name", "name", "custom_company"]',
                "filters": json.dumps(filters),
                "limit_page_length": len(search_codes) or 1000
            }

            print(f"📡 ERPNext API call with filters: {filters}")
            batch_response, batch_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Item",
                params=params,
                operation_name=f"Lookup items batch {i//batch_size + 1} with {len(batch_codes)} codes"
            )

            if batch_error:
                print(f"❌ Error looking up items batch {i//batch_size + 1}: {batch_error}")
                return jsonify({"success": False, "message": "Error looking up items"}), 500

            print(f"📡 ERPNext response status: {batch_response.status_code}")
            if batch_response.status_code != 200:
                print(f"❌ Error looking up items batch {i//batch_size + 1}: {batch_response.status_code} - {batch_response.text}")
                return jsonify({"success": False, "message": "Error looking up items"}), batch_response.status_code

            batch_items = batch_response.json().get('data', [])
            print(f"📦 Batch returned {len(batch_items)} items")
            for item in batch_items[:3]:  # Log first 3 items for debugging
                print(f"   📋 Item: {item.get('item_code')} (company: {item.get('custom_company')})")
            # If company_abbr was found, ensure item_name returned to frontend doesn't include the suffix
            if company_abbr:
                for bi in batch_items:
                    if bi.get('item_name'):
                        orig_name = bi.get('item_name')
                        bi['item_name'] = remove_company_abbr(orig_name, company_abbr)
                        if not validate_company_abbr_operation(orig_name, bi['item_name'], company_abbr, 'remove'):
                            print(f"⚠️ validate_company_abbr_operation failed while cleaning item_name in verify_items_batch: {orig_name} -> {bi['item_name']}")
            all_items.extend(batch_items)

        # Map item_code -> item object
        # Normalizar las keys removiendo el sufijo de compañía si existe
        mapping = {}
        for item in all_items:
            item_code = item.get('item_code', '')
            item_company = item.get('custom_company')
            
            # Si se especificó compañía y el item pertenece a otra compañía, saltarlo
            if company and item_company and item_company != company:
                print(f"⏭️ Skipping item {item_code} from company {item_company} (filtering for {company})")
                continue
            
            # Si el código tiene sufijo de compañía, crear entrada con código base
            if company and company_abbr and item_code.endswith(f' - {company_abbr}'):
                base_code = item_code.replace(f' - {company_abbr}', '')
                mapping[base_code] = item
                print(f"🔄 Mapped {item_code} -> {base_code}")
            else:
                # También mantener el código completo por si acaso
                mapping[item_code] = item
        
        print(f"🗺️ Final mapping has {len(mapping)} items")
        print(f"🗺️ Mapping keys: {list(mapping.keys())[:5]}..." if len(mapping) > 5 else f"🗺️ Mapping keys: {list(mapping.keys())}")

        return jsonify({"success": True, "data": mapping})

    except Exception as e:
        print(f"Error en verify_items_batch: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "message": f"Error interno: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/all', methods=['GET'])
def get_all_purchase_price_lists():
    """Obtener todas las listas de precios de compra existentes"""
    print("\n--- Petición para obtener listas de precios de compra ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company_name = request.args.get('company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        # Obtener todas las Price Lists de compra (buying=1) de la compañía activa
        filters = [
            ["buying", "=", 1],
            ["custom_company", "=", company_name]
        ]

        smart_limit = get_smart_limit('all', 'list')
        # Include exchange rate fields so frontend can show currency + custom exchange rate
        search_params = {
            "fields": '["name", "price_list_name", "currency", "custom_exchange_rate", "enabled", "creation", "modified", "custom_company"]',
            "filters": json.dumps(filters),
            "order_by": "modified desc",
            "limit_page_length": smart_limit
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Price List",
            params=search_params,
            operation_name="Get all purchase price lists"
        )

        if error:
            print(f"❌ Error obteniendo Purchase Price Lists: {error}")
            return jsonify({"success": False, "message": f"Error obteniendo listas de precios de compra: {error}"}), 500

        if response.status_code == 200:
            data = response.json()
            price_lists = data.get('data', [])
            print(f"📋 Purchase Price Lists encontradas: {len(price_lists)}")

            # Normalize exchange_rate_mode for each price list
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
            print(f"❌ Error obteniendo Purchase Price Lists: {response.text}")
            return jsonify({"success": False, "message": f"Error obteniendo listas de precios de compra: {response.text}"}), response.status_code

    except Exception as e:
        print(f"❌ Error en get_all_purchase_price_lists: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists', methods=['GET'])
def get_purchase_price_lists():
    """Obtener lista de precios de compra"""
    print("\n--- Petición para obtener listas de precios de compra ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        supplier = request.args.get('supplier')
        item_code = request.args.get('item_code')

        print(f"Obteniendo precios - Proveedor: {supplier}, Item: {item_code}")

        # Obtener compañía activa para manejar siglas
        company_name = request.args.get('company') or get_active_company(user_id)
        if not company_name:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

        allowed_price_lists = _get_company_purchase_price_lists(session, company_name)
        if not allowed_price_lists:
            return jsonify({"success": True, "data": [], "count": 0})

        # Construir filtros
        filters = [
            ["buying", "=", 1],
            ["price_list", "in", allowed_price_lists]
        ]
        
        if supplier:
            # Agregar sigla al supplier para buscar en ERPNext
            search_supplier = supplier
            if company_abbr:
                search_supplier = add_company_abbr(supplier, company_abbr)
                print(f"🏷️ Searching prices for supplier with abbr: {search_supplier}")
            filters.append(["supplier", "=", search_supplier])
        
        if item_code:
            filters.append(["item_code", "=", item_code])

        # Obtener precios con los campos necesarios
        fields = [
            "name", "item_code", "item_name", "supplier", 
            "currency", "price_list_rate", "valid_from", "valid_upto",
            "buying", "selling", "custom_company"
        ]

        smart_limit = get_smart_limit('purchase', 'list')
        params = {
            "fields": str(fields).replace("'", '"'),
            "filters": json.dumps(filters),
            "limit_page_length": smart_limit
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=params,
            operation_name="Get purchase price lists"
        )

        if error:
            print(f"❌ Error obteniendo precios de compra: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al obtener precios de compra: {error}"
            }), 500

        if response.status_code == 200:
            prices_data = response.json().get('data', [])
            print(f"Precios encontrados: {len(prices_data)}")
            
            # ==== Dedupe: mantener solo la fila más reciente por item_code ====
            try:
                latest_map = {}
                for p in prices_data:
                    item_code_raw = p.get('item_code') or ''
                    # Normalizar clave removiendo el sufijo de compañía si corresponde
                    key = remove_company_abbr(item_code_raw, company_abbr) if company_abbr else item_code_raw
                    if not key:
                        continue
                    existing = latest_map.get(key)
                    if not existing:
                        latest_map[key] = p
                    else:
                        # pick latest between existing and p
                        cand = _pick_latest_price_row([existing, p])
                        latest_map[key] = cand or existing
                # Rebuild prices list
                deduped_prices = list(latest_map.values())
                prices_data = deduped_prices
                print(f"🔎 Dedupe applied: reduced to {len(prices_data)} prices (unique SKUs)")
            except Exception as dedup_e:
                print(f"⚠️ Error aplicando dedupe en get_purchase_price_lists: {dedup_e}")
            
            # Remover siglas de los suppliers antes de enviar al frontend
            if company_abbr:
                for price in prices_data:
                    if 'supplier' in price and price['supplier']:
                        original_supplier = price['supplier']
                        price['supplier'] = remove_company_abbr(price['supplier'], company_abbr)
                        # Validar la operación
                        if not validate_company_abbr_operation(original_supplier, price['supplier'], company_abbr, 'remove'):
                            print(f"⚠️ Validation failed for supplier name removal: {original_supplier} -> {price['supplier']}")
                        print(f"🏷️ Cleaned supplier name in price: {price['supplier']}")
                    # Also remove company abbreviation from item_name if present
                    if 'item_name' in price and price['item_name']:
                        original_item_name = price['item_name']
                        cleaned = remove_company_abbr(original_item_name, company_abbr)
                        price['item_name'] = cleaned
                        # Validate removal to catch unexpected formats
                        if not validate_company_abbr_operation(original_item_name, cleaned, company_abbr, 'remove'):
                            # If validation fails, still set the cleaned value but log a warning
                            print(f"⚠️ Validation failed for item_name removal: {original_item_name} -> {cleaned}")
                        print(f"🧾 Cleaned item_name in price: {price['item_name']}")
            
            return jsonify({
                "success": True,
                "data": prices_data,
                "count": len(prices_data)
            })
        else:
            return jsonify({
                "success": False,
                "message": "Error al obtener precios de compra"
            }), response.status_code

    except Exception as e:
        print(f"Error en get_purchase_price_lists: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/<price_name>', methods=['PUT'])
def update_purchase_price_list(price_name):
    """Actualizar una lista de precios de compra"""
    print(f"\n--- Petición para actualizar lista de precios: {price_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        print(f"Datos recibidos: {data}")
        company = (data or {}).get('company') or request.args.get('company') or get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        _, access_error = _ensure_price_list_for_company(session, price_name, company)
        if access_error:
            return access_error

        # Construir el objeto de actualización
        update_body = {}

        if 'price_list_rate' in data:
            update_body['price_list_rate'] = float(data['price_list_rate'])

        if 'currency' in data:
            update_body['currency'] = data['currency']

        # Accept exchange_rate_mode as option. Map to custom_exchange_rate for persistence.
        if 'exchange_rate_mode' in data:
            mode = data.get('exchange_rate_mode')
            if mode == 'general':
                update_body['custom_exchange_rate'] = -1
            elif mode == 'specific':
                # Expect a numeric value in custom_exchange_rate or exchange_rate
                raw = data.get('custom_exchange_rate', data.get('exchange_rate'))
                try:
                    parsed = float(raw)
                    if parsed < 0:
                        return jsonify({"success": False, "message": "custom_exchange_rate must be >= 0 for specific mode"}), 400
                    update_body['custom_exchange_rate'] = parsed
                except Exception:
                    return jsonify({"success": False, "message": "Invalid custom_exchange_rate for specific mode"}), 400
            else:
                # Unknown mode - ignore
                pass
        else:
            # Backwards-compatible: accept custom_exchange_rate directly
            if 'custom_exchange_rate' in data:
                try:
                    update_body['custom_exchange_rate'] = float(data['custom_exchange_rate'])
                except Exception:
                    update_body['custom_exchange_rate'] = data.get('custom_exchange_rate')

        if 'valid_from' in data:
            update_body['valid_from'] = data['valid_from']

        if 'valid_upto' in data:
            update_body['valid_upto'] = data['valid_upto']

        if not update_body:
            return jsonify({"success": False, "message": "No hay campos para actualizar"}), 400

        # Actualizar en ERPNext - Price List, no Item Price
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Price List/{price_name}",
            data={"data": update_body},
            operation_name=f"Update Price List '{price_name}'"
        )

        if error:
            print(f"❌ Error actualizando lista de precios: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al actualizar lista de precios: {error}"
            }), 500

        if response.status_code == 200:
            updated_price_list = response.json().get('data', {})
            print(f"Lista de precios actualizada exitosamente: {price_name}")
            # Try scheduling recalculation for dependent price lists
            try:
                # Pass the authenticated session so the automation service can query ERPNext
                sched_result = price_list_automation_service.schedule_price_list_recalculation(price_name, session)
                print(f"🔔 Scheduled recalculation result for {price_name}: {sched_result}")
            except Exception as se:
                print(f"⚠️ Error scheduling recalculation for {price_name}: {se}")

            return jsonify({
                "success": True,
                "message": "Lista de precios actualizada exitosamente",
                "data": updated_price_list
            })
        else:
            error_message = response.text
            try:
                error_data = response.json()
                error_message = error_data.get('exception') or error_data.get('message') or error_message
            except:
                pass
            
            print(f"Error al actualizar lista de precios: {error_message}")
            return jsonify({
                "success": False,
                "message": f"Error al actualizar lista de precios: {error_message}"
            }), response.status_code

    except Exception as e:
        print(f"Error en update_purchase_price: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/price/<price_name>', methods=['DELETE'])
def delete_purchase_price(price_name):
    """Eliminar un precio de compra"""
    print(f"\n--- Petición para eliminar precio: {price_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Item Price/{price_name}",
            operation_name=f"Delete Item Price '{price_name}'"
        )

        if error:
            print(f"❌ Error eliminando precio: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al eliminar precio: {error}"
            }), 500

        if response.status_code == 202:
            print(f"Precio eliminado exitosamente: {price_name}")
            return jsonify({
                "success": True,
                "message": "Precio eliminado exitosamente"
            })
        else:
            error_message = response.text
            try:
                error_data = response.json()
                error_message = error_data.get('exception') or error_data.get('message') or error_message
            except:
                pass
            
            print(f"Error al eliminar precio: {error_message}")
            return jsonify({
                "success": False,
                "message": f"Error al eliminar precio: {error_message}"
            }), response.status_code

    except Exception as e:
        print(f"Error en delete_purchase_price: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/supplier/<supplier_name>', methods=['GET'])
def get_price_lists_by_supplier(supplier_name):
    """Obtener todas las listas de precios de un proveedor específico"""
    print(f"\n--- Obteniendo listas de precios del proveedor: {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company') or get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "Compañía requerida"}), 400

        # Obtener compañía activa para manejar siglas
        company_abbr = get_company_abbr(session, headers, company) if company else None

        # Agregar sigla al supplier_name para buscar en ERPNext
        search_supplier_name = supplier_name
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching price lists for supplier with abbr: {search_supplier_name}")

        # Buscar Price Lists que contengan el nombre del supplier
        filters = [
            ["price_list_name", "like", f"%{search_supplier_name}%"],
            ["buying", "=", 1],
            ["custom_company", "=", company]
        ]

        search_params = {
            "fields": '["name", "price_list_name", "currency", "enabled"]',
            "filters": json.dumps(filters),
            "order_by": "modified desc",
            "limit_page_length": 50
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Price List",
            params=search_params,
            operation_name=f"Get Price Lists for supplier '{supplier_name}'"
        )

        if error:
            print(f"❌ Error obteniendo Price Lists: {error}")
            return jsonify({"success": False, "message": f"Error obteniendo listas de precios: {error}"}), 500

        if response.status_code == 200:
            data = response.json()
            price_lists = data.get('data', [])
            print(f"📊 Respuesta cruda de ERPNext: {data}")
            print(f"📋 Price Lists encontradas: {len(price_lists)}")
            
            # Mostrar todas las price lists encontradas
            for i, pl in enumerate(price_lists):
                print(f"📋 Price List {i+1}: {pl}")

            # Para cada price list, obtener la fecha de creación o modificación
            enhanced_price_lists = []
            for pl in price_lists:
                try:
                    # Obtener detalles completos de la Price List
                    detail_response, detail_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Price List/{pl['name']}",
                        operation_name=f"Get details for Price List '{pl['name']}'"
                    )

                    if detail_error:
                        print(f"Error obteniendo detalles de Price List {pl['name']}: {detail_error}")
                        # Agregar versión básica si falla
                        enhanced_price_lists.append({
                            "name": pl["name"],
                            "price_list_name": pl["price_list_name"],
                            "currency": pl.get("currency",),
                            "enabled": pl.get("enabled", 1),
                            "creation": None,
                            "modified": None,
                            "price_list_date": None
                        })
                    elif detail_response.status_code == 200:
                        detail_data = detail_response.json().get('data', {})
                        enhanced_pl = {
                            "name": pl["name"],
                            "price_list_name": pl["price_list_name"],
                            "currency": pl.get("currency"),
                            "enabled": pl.get("enabled", 1),
                            "creation": detail_data.get("creation"),
                            "modified": detail_data.get("modified"),
                            "price_list_date": detail_data.get("creation"),  # Usamos creation como fecha aproximada
                            "custom_exchange_rate": detail_data.get("custom_exchange_rate"),
                            "exchange_rate_mode": ('general' if detail_data.get('custom_exchange_rate') == -1 else 'specific')
                        }
                        enhanced_price_lists.append(enhanced_pl)
                    else:
                        print(f"Error obteniendo detalles de Price List {pl['name']}: {detail_response.text}")
                        # Agregar versión básica si falla
                        enhanced_price_lists.append({
                            "name": pl["name"],
                            "price_list_name": pl["price_list_name"],
                            "currency": pl.get("currency",),
                            "enabled": pl.get("enabled", 1),
                            "creation": None,
                            "modified": None,
                            "price_list_date": None
                        })
                except Exception as e:
                    print(f"Error obteniendo detalles de Price List {pl['name']}: {e}")
                    # Agregar versión básica si falla
                    enhanced_price_lists.append({
                        "name": pl["name"],
                        "price_list_name": pl["price_list_name"],
                        "currency": pl.get("currency",),
                        "enabled": pl.get("enabled", 1),
                        "creation": None,
                        "modified": None,
                        "price_list_date": None
                    })

            print(f"✅ Encontradas {len(enhanced_price_lists)} listas de precios para {supplier_name}")
            return jsonify({
                "success": True,
                "data": enhanced_price_lists
            })
        else:
            print(f"❌ Error obteniendo Price Lists: {response.text}")
            return jsonify({"success": False, "message": f"Error obteniendo listas de precios: {response.text}"}), response.status_code

    except Exception as e:
        print(f"❌ Error en get_price_lists_by_supplier: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/<price_list_name>/details', methods=['GET'])
def get_price_list_details(price_list_name):
    """Obtener detalles básicos de una lista de precios específica (moneda, cotización, etc.)"""
    print(f"\n--- Obteniendo detalles básicos de lista de precios: {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company') or get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        # Obtener detalles básicos de la Price List
        detail_response, detail_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Price List/{quote(price_list_name)}",
            operation_name=f"Get details for Price List '{price_list_name}'"
        )

        if detail_error:
            print(f"? Price List no encontrada: {detail_error}")
            return jsonify({"success": False, "message": "Lista de precios no encontrada"}), 404

        if detail_response.status_code == 200:
            price_list_data = detail_response.json().get('data', {})
            print(f"?? Detalles de Price List obtenidos: {price_list_data.get('price_list_name')}")
            if price_list_data.get('custom_company') != company:
                return jsonify({"success": False, "message": "No tienes acceso a esta lista de precios"}), 403

            # Extraer solo los campos relevantes para el frontend
            details = {
                "name": price_list_data.get("name"),
                "price_list_name": price_list_data.get("price_list_name"),
                "currency": price_list_data.get("currency"),
                "custom_exchange_rate": price_list_data.get("custom_exchange_rate"),
                "exchange_rate_mode": ('general' if price_list_data.get('custom_exchange_rate') == -1 else 'specific'),
                "buying": price_list_data.get("buying"),
                "selling": price_list_data.get("selling"),
                "enabled": price_list_data.get("enabled")
            }

            return jsonify({
                "success": True,
                "data": details
            })
        else:
            print(f"? Price List no encontrada: {detail_response.text}")
            return jsonify({"success": False, "message": "Lista de precios no encontrada"}), 404

    except Exception as e:
        print(f"? Error en get_price_list_details: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/<price_list_name>/item/<item_code>/price', methods=['GET'])
def get_item_price_in_price_list(price_list_name, item_code):
    """Obtener el precio de un item específico en una lista de precios específica"""
    print(f"\n--- Obteniendo precio del item {item_code} en lista {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario para expandir el código del item
        company = request.args.get('company') or get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400
        _, access_error = _ensure_price_list_for_company(session, price_list_name, company)
        if access_error:
            return access_error
        print(f"🏢 Empresa activa: {company}")

        # Preparar códigos de búsqueda: primero con sufijo de compañía, luego sin sufijo
        search_codes = [item_code]  # Siempre buscar el código original
        
        if company:
            company_abbr = get_company_abbr(session, headers, company)
            if company_abbr:
                expanded_code = f"{item_code} - {company_abbr}"
                search_codes.insert(0, expanded_code)  # Buscar primero el código expandido
                print(f"🔍 Buscando con códigos: {search_codes}")
            else:
                print(f"⚠️ No se pudo obtener abbr para compañía: {company}")

        # Buscar el precio del item en la lista de precios especificada
        # Intentar con cada código de búsqueda hasta encontrar uno
        for search_code in search_codes:
            print(f"🔍 Buscando precio para: {search_code}")
            
            filters = [
                ["item_code", "=", search_code],
                ["price_list", "=", price_list_name],
                ["buying", "=", 1]  # Solo precios de compra
            ]

            search_params = {
                "fields": '["name", "item_code", "price_list", "price_list_rate", "currency", "supplier"]',
                "filters": json.dumps(filters),
                "limit_page_length": 100  # Traer varios y elegir el más reciente
            }

            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Item Price",
                params=search_params,
                operation_name=f"Get price for item '{search_code}' in '{price_list_name}'"
            )

            if error:
                print(f"❌ Error buscando precio para {search_code}: {error}")
                continue

            if response.status_code == 200:
                data = response.json()
                prices = data.get('data', [])

                if prices:
                    # Elegir la fila más reciente entre las retornadas
                    price_data = _pick_latest_price_row(prices) or prices[0]
                    print(f"✅ Precio encontrado para {search_code}: {price_data.get('price_list_rate')} {price_data.get('currency')} (docname: {price_data.get('name')})")

                    # Remover sigla del supplier antes de enviar al frontend
                    response_supplier = price_data.get("supplier")
                    if company_abbr and response_supplier:
                        response_supplier = remove_company_abbr(response_supplier, company_abbr)
                        print(f"🏷️ Cleaned supplier name in price: {response_supplier}")

                    return jsonify({
                        "success": True,
                        "data": {
                            "item_code": price_data.get("item_code"),
                            "price_list": price_data.get("price_list"),
                            "price_list_rate": price_data.get("price_list_rate"),
                            "currency": price_data.get("currency"),
                            "supplier": response_supplier,
                            "item_price_name": price_data.get('name')
                        }
                    })

        # Si no se encontró con ninguno de los códigos
        print(f"⚠️ No se encontró precio para el item {item_code} en la lista {price_list_name}")
        return jsonify({
            "success": False,
            "message": f"No se encontró precio para el item {item_code} en la lista {price_list_name}"
        }), 404

    except Exception as e:
        print(f"❌ Error en get_item_price_in_price_list: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/<price_list_name>/prices', methods=['GET'])
def get_price_list_prices(price_list_name):
    """Obtener todos los precios de una lista de precios específica"""
    print(f"\n--- Obteniendo todos los precios de lista: {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario
        company = request.args.get('company') or get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400
        price_list_doc, error_response = _ensure_price_list_for_company(session, price_list_name, company)
        if error_response:
            return error_response
        print(f"🏢 Empresa activa: {company}")

        # Obtener todos los precios de la lista especificada (solo precios de compra)
        filters = [
            ["price_list", "=", price_list_name],
            ["buying", "=", 1]  # Solo precios de compra
        ]

        # Usar el smart limit basado en la compañía activa para evitar truncar a 1000
        smart_limit = get_smart_limit(company, 'list')
        search_params = {
            "fields": '["name", "item_code", "item_name", "price_list", "price_list_rate", "currency", "supplier", "valid_from", "modified", "creation"]',
            "filters": json.dumps(filters),
            "limit_page_length": smart_limit
        }

        # DEBUG: mostrar los parámetros de consulta que enviamos a ERPNext
        try:
            print(f"[DEBUG get_price_list_prices] Calling ERPNext /api/resource/Item Price with params: {search_params}")
        except Exception:
            pass

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=search_params,
            operation_name=f"Get all prices for Price List '{price_list_name}'"
        )

        if error:
            print(f"❌ Error obteniendo precios: {error}")
            return jsonify({"success": False, "message": f"Error obteniendo precios: {error}"}), 500

        if response.status_code == 200:
            data = response.json()
            prices = data.get('data', [])
            print(f"✅ Encontrados {len(prices)} precios en la lista {price_list_name}")

            # DEBUG: mostrar algunas filas crudas recibidas de ERPNext (hasta 5)
            try:
                sample_raw = prices[:5]
                print(f"[DEBUG get_price_list_prices] ERPNext returned {len(prices)} rows, sample (up to 5):")
                for i, r in enumerate(sample_raw):
                    print(f"    Raw[{i}]: name={r.get('name')} item_code={r.get('item_code')} price_list_rate={r.get('price_list_rate')} currency={r.get('currency')} valid_from={r.get('valid_from')} modified={r.get('modified')} creation={r.get('creation')}")
            except Exception:
                pass

            # Determinar company_abbr si es posible (usado para normalizar claves)
            company_abbr = None
            if company:
                try:
                    company_abbr = get_company_abbr(session, headers, company)
                    print(f"🏢 Company abbr for dedupe: '{company_abbr}'")
                except Exception as e:
                    print(f"⚠️ Error obteniendo company_abbr para dedupe: {e}")

            # ==== Dedupe: mantener solo la fila más reciente por item_code ====
            try:
                print(f"🔍 Starting dedupe for {len(prices)} prices...")
                latest_map = {}
                for i, p in enumerate(prices):
                    item_code_raw = p.get('item_code') or ''
                    # Normalizar clave removiendo el sufijo de compañía si corresponde
                    key = remove_company_abbr(item_code_raw, company_abbr) if company_abbr else item_code_raw
                    if not key:
                        print(f"⚠️ Skipping price {i}: empty key after normalization (raw: '{item_code_raw}')")
                        continue
                    
                    existing = latest_map.get(key)
                    if not existing:
                        latest_map[key] = p
                        print(f"➕ Added first price for key '{key}': {item_code_raw}")
                    else:
                        # pick latest between existing and p
                        cand = _pick_latest_price_row([existing, p])
                        latest_map[key] = cand or existing
                        chosen_code = (cand or existing).get('item_code')
                        print(f"🔄 Deduped key '{key}': kept {chosen_code} (had {existing.get('item_code')} vs {item_code_raw})")
                
                # Rebuild prices list
                deduped_prices = list(latest_map.values())
                original_count = len(prices)
                deduped_count = len(deduped_prices)
                prices = deduped_prices
                print(f"🔎 Dedupe applied: reduced from {original_count} to {deduped_count} prices (unique SKUs)")
                
                if original_count == deduped_count:
                    print(f"⚠️ No duplicates found - all {original_count} prices were unique")

                # DEBUG: mostrar muestra de precios dedupeados que enviaremos al frontend
                try:
                    print(f"[DEBUG get_price_list_prices] Prices after dedupe (count={len(prices)}), sample up to 5:")
                    for i, r in enumerate(prices[:5]):
                        print(f"    Out[{i}]: name={r.get('name')} item_code={r.get('item_code')} price_list_rate={r.get('price_list_rate')} currency={r.get('currency')} valid_from={r.get('valid_from')} modified={r.get('modified')} creation={r.get('creation')}")
                except Exception:
                    pass
            except Exception as dedup_e:
                print(f"❌ CRITICAL: Error aplicando dedupe en get_price_list_prices: {dedup_e}")
                import traceback
                print(f"❌ Dedupe traceback: {traceback.format_exc()}")
                # No fallar la petición, continuar con precios sin deduplicar
                print(f"⚠️ Continuing with undeduped prices ({len(prices)} total)")

            # Remover siglas de los suppliers antes de enviar al frontend
            if company_abbr:
                for price in prices:
                    if 'supplier' in price and price['supplier']:
                        price['supplier'] = remove_company_abbr(price['supplier'], company_abbr)
                        print(f"🏷️ Cleaned supplier name in price: {price['supplier']}")
                    # Also clean item_name if present
                    if 'item_name' in price and price['item_name']:
                        orig = price['item_name']
                        cleaned = remove_company_abbr(orig, company_abbr)
                        price['item_name'] = cleaned
                        if not validate_company_abbr_operation(orig, cleaned, company_abbr, 'remove'):
                            print(f"⚠️ Validation failed for item_name removal in price list prices: {orig} -> {cleaned}")
                        print(f"🧾 Cleaned item_name in price list price: {price['item_name']}")

            price_list_data = price_list_doc or {}

            return jsonify({
                "success": True,
                "data": {
                    "price_list": {
                        "name": price_list_data.get("name"),
                        "price_list_name": price_list_data.get("price_list_name"),
                        "currency": price_list_data.get("currency"),
                        "custom_exchange_rate": price_list_data.get("custom_exchange_rate"),
                        "exchange_rate_mode": ('general' if price_list_data.get('custom_exchange_rate') == -1 else 'specific'),
                        "custom_company": price_list_data.get("custom_company")
                    },
                    "prices": prices
                }
            })
        else:
            print(f"❌ Error obteniendo precios: {response.text}")
            return jsonify({"success": False, "message": "Error obteniendo precios de la lista"}), 500

    except Exception as e:
        print(f"❌ Error en get_price_list_prices: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/<path:price_list_name>/items', methods=['DELETE'])
@cross_origin(supports_credentials=True)
def delete_items_from_price_list(price_list_name):
    """Eliminar artículos específicos de una lista de precios de compra"""
    print(f"\n--- Petición para eliminar artículos de lista de precios: {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Datos requeridos"}), 400

        item_codes = data.get('item_codes', [])
        company = data.get('company') or request.args.get('company')

        if not item_codes or not isinstance(item_codes, list):
            return jsonify({"success": False, "message": "item_codes requerido como array"}), 400

        print(f"Eliminando {len(item_codes)} artículos de la lista '{price_list_name}'")

        # Obtener compañía activa para manejar siglas
        if not company:
            company = get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400
        _, access_error = _ensure_price_list_for_company(session, price_list_name, company)
        if access_error:
            return access_error

        company_abbr = get_company_abbr(session, headers, company) if company else None

        # Preparar códigos de búsqueda con siglas
        search_codes = []
        for item_code in item_codes:
            search_codes.append(item_code)  # Código original
            if company_abbr:
                search_codes.append(f"{item_code} - {company_abbr}")  # Código con sigla

        # Buscar todos los Item Price que coincidan
        filters = [
            ["price_list", "=", price_list_name],
            ["item_code", "in", search_codes],
            ["buying", "=", 1]  # Solo precios de compra
        ]

        search_params = {
            "fields": '["name", "item_code"]',
            "filters": json.dumps(filters),
            "limit_page_length": len(search_codes) * 2  # Máximo posible
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=search_params,
            operation_name=f"Find Item Prices to delete from '{price_list_name}'"
        )

        if error:
            print(f"❌ Error buscando Item Prices: {error}")
            return jsonify({"success": False, "message": "Error buscando precios a eliminar"}), 500

        if response.status_code != 200:
            print(f"❌ Error buscando Item Prices: {response.text}")
            return jsonify({"success": False, "message": "Error buscando precios a eliminar"}), 500

        prices_to_delete = response.json().get('data', [])
        print(f"✅ Encontrados {len(prices_to_delete)} Item Prices para eliminar")

        # Mapear códigos encontrados para verificar cuáles se encontraron
        found_codes = [price['item_code'] for price in prices_to_delete]

        # Eliminar cada Item Price
        deleted_count = 0
        failed_count = 0
        failed_items = []

        for price in prices_to_delete:
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Item Price/{price['name']}",
                operation_name=f"Delete Item Price '{price['name']}' from '{price_list_name}'"
            )

            if delete_error:
                failed_count += 1
                failed_items.append(price['item_code'])
                print(f"❌ Error eliminando Item Price {price['name']}: {delete_error}")
            elif delete_response.status_code == 202:
                deleted_count += 1
                print(f"✅ Item Price eliminado: {price['name']} ({price['item_code']})")
            else:
                failed_count += 1
                failed_items.append(price['item_code'])
                print(f"❌ Error eliminando Item Price {price['name']}: {delete_response.status_code} - {delete_response.text}")

        # Verificar cuáles códigos no se encontraron
        not_found_codes = [
            code for code in item_codes
            if code not in found_codes and (not company_abbr or f"{code} - {company_abbr}" not in found_codes)
        ]

        result_message = f"Eliminados {deleted_count} artículos de la lista de precios"
        if failed_count > 0:
            result_message += f", {failed_count} fallaron"
        if len(not_found_codes) > 0:
            result_message += f", {len(not_found_codes)} no encontrados"

        return jsonify({
            "success": True,
            "message": result_message,
            "data": {
                "deleted_count": deleted_count,
                "failed_count": failed_count,
                "not_found_count": len(not_found_codes),
                "failed_items": failed_items,
                "not_found_items": not_found_codes
            }
        })

    except Exception as e:
        print(f"❌ Error eliminando artículos de lista de precios {price_list_name}: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/<path:price_list_name>', methods=['DELETE'])
@cross_origin(supports_credentials=True)
def delete_purchase_price_list(price_list_name):
    """Eliminar una lista de precios de compra"""
    print(f"\n--- Petición para eliminar lista de precios de compra: {price_list_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        def _extract_error_message(response):
            """Intentar obtener un mensaje legible de un response de ERPNext."""
            try:
                data = response.json()
                if isinstance(data, dict):
                    if data.get('message'):
                        return data['message']
                    if data.get('exception'):
                        return data['exception']
                    return json.dumps(data)
                return str(data)
            except Exception:
                return getattr(response, 'text', '') or 'Error desconocido'

        def _looks_like_supplier_link_error(message):
            """Detectar si el error proviene de tener la lista vinculada a un proveedor."""
            if not message:
                return False
            normalized = message.lower()
            keywords = [
                "proveedor",
                "supplier",
                "linked with supplier",
                "desactivar este lista de precios",
                "price list is linked"
            ]
            return any(keyword in normalized for keyword in keywords)

        company = request.args.get('company') or get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400
        price_list_doc, access_error = _ensure_price_list_for_company(session, price_list_name, company)
        if access_error:
            return access_error

        # Verificar que existen precios asociados a la lista
        filters = [
            ["price_list", "=", price_list_name],
            ["buying", "=", 1]
        ]
        params = {
            "fields": '["name"]',
            "filters": json.dumps(filters),
            "limit_page_length": 1000  # Buscar más para encontrar todos los precios
        }

        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=params,
            operation_name=f"Find prices associated with purchase price list '{price_list_name}'"
        )

        if check_error:
            print(f"Error buscando precios asociados: {check_error}")
            return jsonify({"success": False, "message": "Error verificando precios asociados"}), 500

        if check_response.status_code != 200:
            print(f"Error buscando precios asociados: {check_response.text}")
            return jsonify({"success": False, "message": "Error verificando precios asociados"}), 500

        existing_prices = check_response.json().get('data', [])
        print(f"Precios asociados encontrados: {len(existing_prices)}")

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
                operation_name=f"Delete price '{price['name']}' from purchase price list"
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
            supplier_link_blocked = False
            supplier_link_message = None

            # Buscar el documento Price List por nombre
            price_list_filters = [["price_list_name", "=", price_list_name], ["custom_company", "=", company]]
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
                # Si hay error buscando, asumimos que no existe y continuamos
                print(f"Continuando sin eliminar documento Price List (posiblemente no existe)")
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
                        # No fallar si no se puede eliminar el documento, ya que los precios ya se eliminaron
                        if _looks_like_supplier_link_error(str(list_delete_error)):
                            supplier_link_blocked = True
                            supplier_link_message = str(list_delete_error)
                    elif list_delete_response.status_code in [200, 202, 204]:
                        print(f"Documento Price List '{price_list_doc_name}' eliminado exitosamente")
                    else:
                        error_message = _extract_error_message(list_delete_response)
                        print(f"Error eliminando Price List document: {error_message}")
                        if _looks_like_supplier_link_error(error_message):
                            supplier_link_blocked = True
                            supplier_link_message = error_message
                        # No fallar si no se puede eliminar el documento
                else:
                    print(f"No se encontró documento Price List para '{price_list_name}' (esto es normal para algunas listas)")
            else:
                print(f"Error buscando documento Price List: {list_check_response.text}")
                # No fallar si no se puede buscar el documento

            if supplier_link_blocked:
                user_message = (
                    "Se borraron todos los ítems de la lista de precios, pero sigue asignada en los datos del proveedor. "
                    "Elegí otra lista para ese proveedor y volvé a borrarla."
                )
                return jsonify({
                    "success": False,
                    "message": user_message,
                    "data": {
                        "deleted_items": deleted_count,
                        "failed_items": failed_count,
                        "requires_supplier_unlink": True,
                        "erpnext_message": supplier_link_message
                    }
                }), 409
        except Exception as e:
            print(f"Error eliminando documento Price List: {e}")
            # No fallar si hay error eliminando el documento, ya que los precios ya se eliminaron

        return jsonify({
            "success": True,
            "message": f"Lista de precios de compra eliminada exitosamente",
            "deleted": deleted_count,
            "failed": failed_count
        })

    except Exception as e:
        print(f"Error eliminando lista de precios de compra {price_list_name}: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_price_lists_bp.route('/api/inventory/purchase-price-lists/<path:price_list_name>/status', methods=['PATCH'])
@cross_origin(supports_credentials=True)
def update_purchase_price_list_status(price_list_name):
    """Actualizar el estado (habilitado/deshabilitado) de una lista de precios de compra"""
    print(f"\n--- Petición para actualizar estado de lista de precios de compra: {price_list_name} ---")

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

        company = data.get('company') or request.args.get('company') or get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

        price_list_doc, access_error = _ensure_price_list_for_company(session, price_list_name, company)
        if access_error:
            return access_error

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
            operation_name=f"Update status of purchase price list '{price_list_name}'"
        )

        if update_error:
            print(f"Error actualizando estado de lista: {update_error}")
            return jsonify({"success": False, "message": "Error actualizando estado de lista de precios"}), 500

        if update_response.status_code not in [200, 201]:
            print(f"Error actualizando estado de lista: {update_response.text}")
            return jsonify({"success": False, "message": "Error actualizando estado de lista de precios"}), 500

        action = "habilitada" if enabled else "deshabilitada"
        message = f"Lista de precios de compra '{price_list_name}' {action} exitosamente"

        return jsonify({
            "success": True,
            "message": message,
            "price_list_name": price_list_name,
            "enabled": enabled
        })

    except Exception as e:
        print(f"Error actualizando estado de lista de precios de compra {price_list_name}: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


