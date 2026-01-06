from flask import Blueprint, request, jsonify
import traceback
import json
from urllib.parse import quote

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar utilidades de tokens de warehouse
from utils.warehouse_tokens import ensure_warehouse, sanitize_supplier_code, tokenize_warehouse_name
from routes.inventory_utils import fetch_bin_stock

# Crear el blueprint para las rutas de remitos
remitos_bp = Blueprint('remitos', __name__)

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr, get_active_company, add_company_abbr, remove_company_abbr
from routes.talonarios import get_next_number_for_sequence, update_last_number_for_sequence


def get_purchase_receipt_docstatus(session, remito_name):
    """Obtiene el docstatus de un Purchase Receipt."""
    fields_str = '["docstatus"]'
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Purchase Receipt/{quote(remito_name)}?fields={quote(fields_str)}",
        operation_name=f"Get docstatus for Purchase Receipt '{remito_name}'"
    )
    if error:
        raise RuntimeError(f"Error obteniendo docstatus: {error}")
    if response.status_code != 200:
        raise RuntimeError(f"Error obteniendo docstatus: {response.text}")
    data = response.json().get('data', {})
    return data.get('docstatus', 0)


def _set_remito_estado(session, headers, remito_name, estado):
    """Actualiza el campo custom_estado_remito de un Purchase Receipt sin interrumpir el flujo principal."""
    if not remito_name or not estado:
        return
    try:
        make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Purchase Receipt/{quote(remito_name)}",
            data={"data": {"custom_estado_remito": estado}},
            custom_headers=headers,
            operation_name=f"Set remito estado '{estado}' for '{remito_name}'"
        )
    except Exception as exc:
        print(f"--- Warning: no se pudo actualizar custom_estado_remito para {remito_name}: {exc}")


def get_delivery_note_docstatus(session, remito_name):
    """Obtiene el docstatus de un Delivery Note."""
    fields_str = '["docstatus"]'
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Delivery Note/{quote(remito_name)}?fields={quote(fields_str)}",
        operation_name=f"Get docstatus for Delivery Note '{remito_name}'"
    )
    if error:
        raise RuntimeError(f"Error obteniendo docstatus: {error}")
    if response.status_code != 200:
        raise RuntimeError(f"Error obteniendo docstatus: {response.text}")
    data = response.json().get('data', {})
    return data.get('docstatus', 0)


@remitos_bp.route('/api/remitos', methods=['POST', 'OPTIONS'])
def create_remito():
    """Crear un remito (Purchase Receipt) con ensure automático de warehouse"""

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        print("--- Crear remito: error auth")
        return error_response

    print("--- Crear remito: procesando")

    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'message': 'Datos requeridos'
            }), 400

        # Extraer parámetros
        supplier = data.get('supplier')
        posting_date = data.get('posting_date')
        items = data.get('items', [])
        company = data.get('company')
        title = data.get('title')
        supplier_address = data.get('supplier_address')
        currency = data.get('currency')
        exchange_rate = data.get('exchange_rate')
        base_code = data.get('base_code')
        naming_series = data.get('naming_series')
        punto_de_venta = data.get('punto_de_venta')
        remito_number = data.get('remito_number')
        is_return = data.get('is_return', 0)  # 1 para devoluciones, 0 por defecto
        return_against = data.get('return_against')

        # Si no se envían items, posting_date, etc., usar valores por defecto para remito simple
        if not items:
            # Para remito simple, usar fecha actual y items vacíos
            from datetime import datetime
            posting_date = posting_date or datetime.now().strftime('%Y-%m-%d')
            items = []  # Remito vacío por ahora

        # Validaciones básicas
        if not company:
            return jsonify({
                'success': False,
                'message': 'Company es requerida'
            }), 400

        # Obtener sigla de la compañía
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({
                'success': False,
                'message': 'No se pudo obtener la sigla de la compañía'
            }), 400

        # Validar supplier para roles CON/VCON
        supplier_code = None
        if supplier:
            supplier_code = sanitize_supplier_code(supplier)
            if not supplier_code:
                return jsonify({
                    'success': False,
                    'message': 'Supplier code inválido'
                }), 400

        # Agregar sigla de compañía al supplier para ERPNext
        # Use helper to add company abbreviation safely (avoids duplicate suffixes)
        supplier_full = add_company_abbr(supplier, company_abbr) if supplier else None

        # Si no hay items, solo asegurar warehouse básico
        if not items:
            try:
                # Para remito vacío, buscar warehouse por defecto de la compañía
                company_response, company_error = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint=f'/api/resource/Company/{quote(company)}',
                    operation_name='Get Company Default Warehouse'
                )

                if company_error:
                    return jsonify({
                        'success': False,
                        'message': 'Error obteniendo warehouse por defecto de la compañía'
                    }), 500

                company_data = company_response.json()['data']
                warehouse_name = company_data.get('custom_default_warehouse') or company_data.get('default_warehouse')

                if not warehouse_name:
                    return jsonify({
                        'success': False,
                        'message': 'La compañía no tiene warehouse por defecto configurado'
                    }), 400

                message = f"Warehouse por defecto de la compañía: '{warehouse_name}'"

                print(f"--- Using company default warehouse: {warehouse_name}")

                return jsonify({
                    'success': True,
                    'message': message,
                    'data': {
                        'warehouse': warehouse_name,
                        'auto_created': False,
                        'base_code': None,
                        'role': None,
                        'supplier': supplier,
                        'company': company
                    }
                })

            except ValueError as ve:
                return jsonify({
                    'success': False,
                    'message': f'Error obteniendo warehouse: {str(ve)}'
                }), 400
            except Exception as e:
                print("--- Error getting company default warehouse")
                traceback.print_exc()
                return jsonify({
                    'success': False,
                    'message': f'Error al obtener warehouse por defecto: {str(e)}'
                }), 500

        # Preparar items para Purchase Receipt con warehouses apropiados
        purchase_items = []
        warehouses_created = []

        for item in items:
            item_code = item.get('item_code')
            qty = item.get('qty', 0)
            try:
                qty_val = float(qty or 0)
            except Exception:
                qty_val = 0.0
            rate = item.get('rate', 0)
            propiedad = item.get('propiedad', 'Propio')

            if not item_code:
                return jsonify({
                    'success': False,
                    'message': 'Cada item debe tener item_code'
                }), 400

            # Agregar sigla de compañía al item_code (sin duplicar)
            item_code_full = add_company_abbr(item_code, company_abbr)

            # Determinar warehouse
            warehouse_name = item.get('warehouse')

            if propiedad == 'Propio' or not propiedad:
                # Para items propios o sin especificar, usar el warehouse seleccionado directamente
                if not warehouse_name:
                    # Si no viene warehouse, buscar default_warehouse en item_defaults
                    try:
                        item_response, item_error = make_erpnext_request(
                            session=session,
                            method='GET',
                            endpoint=f'/api/resource/Item/{quote(item_code_full)}',
                            operation_name='Get Item Details'
                        )

                        if not item_error:
                            item_data = item_response.json()['data']
                            # Buscar default_warehouse en item_defaults para la compañía
                            for default in item_data.get('item_defaults', []):
                                if default.get('company') == company:
                                    warehouse_name = default.get('default_warehouse')
                                    break

                            if not warehouse_name:
                            # Si no hay default_warehouse, buscar warehouse principal de la compañía
                                company_response, company_error = make_erpnext_request(
                                    session=session,
                                    method='GET',
                                    endpoint=f'/api/resource/Company/{quote(company)}',
                                    operation_name='Get Company Default Warehouse'
                                )

                                if not company_error:
                                    company_data = company_response.json()['data']
                                    warehouse_name = company_data.get('custom_default_warehouse') or company_data.get('default_warehouse')

                        if not warehouse_name:
                            return jsonify({
                                'success': False,
                                'message': f'No se encontró warehouse por defecto para item {item_code} (propiedad: Propio)'
                            }), 400

                        print(f"--- Using default warehouse for item {item_code}: {warehouse_name}")

                    except Exception as e:
                        print(f"--- Error getting default warehouse for item {item_code}: {str(e)}")
                        return jsonify({
                            'success': False,
                            'message': f'Error obteniendo warehouse por defecto para item {item_code}: {str(e)}'
                        }), 500
                else:
                    print(f"--- Using manually assigned warehouse for item {item_code}: {warehouse_name}")
            
            elif propiedad == 'Consignación' or propiedad == 'Mercadería en local del proveedor':
                # Para consignación, usar warehouse tokenizado basado en el warehouse seleccionado
                # Si no hay warehouse seleccionado, usar 'Finished Goods' por defecto
                base_code = 'Finished Goods'
                
                if warehouse_name:
                    # Extraer el base_code del warehouse seleccionado (remover abbr de compañía)
                    # Importante: el nombre del warehouse puede contener ' - ' internamente.
                    # Solo removemos el sufijo ' - <ABBR>' del final.
                    base_code_parts = warehouse_name.rsplit(' - ', 1)
                    base_code = base_code_parts[0] if len(base_code_parts) == 2 else warehouse_name
                
                role = 'CON' if propiedad == 'Consignación' else 'VCON'

                try:
                    warehouse_result = ensure_warehouse(
                        session=session,
                        headers=headers,
                        company=company,
                        base_code=base_code,
                        role=role,
                        supplier_code=supplier_code
                    )

                    warehouse_name = warehouse_result['name']
                    auto_created = warehouse_result['auto_created']

                    if auto_created:
                        warehouses_created.append(warehouse_name)

                    print(f"--- Warehouse ensured for {propiedad} item {item_code}: {warehouse_name} (base: {base_code}, role: {role}, auto_created: {auto_created})")

                except ValueError as ve:
                    return jsonify({
                        'success': False,
                        'message': f'Error en warehouse para item {item_code}: {str(ve)}'
                    }), 400
                except Exception as e:
                    print(f"--- Error ensuring warehouse for item {item_code}")
                    traceback.print_exc()
                    return jsonify({
                        'success': False,
                        'message': f'Error al asegurar warehouse para item {item_code}: {str(e)}'
                    }), 500
            else:
                # Caso no reconocido, error
                return jsonify({
                    'success': False,
                    'message': f'Propiedad no reconocida para item {item_code}: {propiedad}'
                }), 400

            # Ajustar cantidad para devoluciones: ERPNext exige cantidades negativas
            if int(is_return):
                effective_qty = -abs(qty_val)
            else:
                effective_qty = qty_val

            if int(is_return):
                if not return_against:
                    return jsonify({
                        'success': False,
                        'message': 'Para crear un remito de devolución debes relacionarlo con un remito anterior (return_against).'
                    }), 400

                pr_detail = item.get('pr_detail') or item.get('purchase_receipt_item')
                if not pr_detail:
                    return jsonify({
                        'success': False,
                        'message': (
                            f"Item {item_code}: falta la relación con el remito original (pr_detail). "
                            "Usá 'Relacionar con...' para generar la devolución."
                        )
                    }), 400

            purchase_item = {
                'item_code': item_code_full,
                'qty': effective_qty,
                'rate': rate,
                'warehouse': warehouse_name,
                'amount': effective_qty * rate,
                'propiedad': propiedad or 'Propio'
            }

            # Agregar campos opcionales si existen
            if item.get('uom'):
                purchase_item['uom'] = item['uom']
            if item.get('conversion_factor'):
                purchase_item['conversion_factor'] = item['conversion_factor']
            # Conservar campos de linking si existen
            if item.get('purchase_order'):
                purchase_item['purchase_order'] = item['purchase_order']
            if item.get('purchase_order_item'):
                purchase_item['purchase_order_item'] = item['purchase_order_item']
            if item.get('pr_detail'):
                purchase_item['pr_detail'] = item['pr_detail']
            if item.get('purchase_receipt_item'):
                purchase_item['purchase_receipt_item'] = item['purchase_receipt_item']
            if item.get('po_detail'):
                purchase_item['po_detail'] = item['po_detail']

            purchase_items.append(purchase_item)

        # Prefer naming_series (client standard), fallback to legacy base_code, else compose from pdv/number.
        if not naming_series:
            naming_series = base_code
        if not naming_series and punto_de_venta and remito_number:
            pv = str(punto_de_venta).zfill(5)[-5:]
            rn = str(remito_number).zfill(8)[-8:]
            naming_series = f"CC-REM-R-{pv}-{rn}"

        # Preparar payload para Purchase Receipt
        purchase_receipt_data = {
            'doctype': 'Purchase Receipt',
            'supplier': supplier_full if supplier_full else supplier,
            'posting_date': posting_date,
            'company': company,
            'items': purchase_items,
            'is_return': int(is_return),  # 1 para devolución emitida, 0 para remito normal
            'docstatus': 1,  # Crear confirmado
            'status': 'To Bill',  # pendiente de facturar
            'custom_estado_remito': 'Recibido pendiente de factura'
        }
        if int(is_return) and return_against:
            purchase_receipt_data['return_against'] = return_against
        if naming_series:
            # ERPNext expects document naming via naming_series; do not send name/base_code.
            purchase_receipt_data['naming_series'] = naming_series

        # Agregar campos opcionales si existen
        if title:
            purchase_receipt_data['title'] = title
        if supplier_address:
            purchase_receipt_data['supplier_address'] = supplier_address
        if currency:
            purchase_receipt_data['currency'] = currency
        if exchange_rate:
            purchase_receipt_data['conversion_rate'] = exchange_rate

        # Crear Purchase Receipt
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Purchase Receipt",
            data={'data': purchase_receipt_data},
            operation_name="Create Purchase Receipt"
        )

        if error:
            return handle_erpnext_error(error, "Failed to create purchase receipt")

        created_data = response.json()
        purchase_receipt_name = created_data.get('data', {}).get('name')


        # Preparar mensaje de éxito
        message = f'Remito creado exitosamente: {purchase_receipt_name}'
        if warehouses_created:
            message += f'. Warehouses creados: {", ".join(warehouses_created)}'

        print(f"--- Purchase Receipt created: {purchase_receipt_name}")
        if warehouses_created:
            print(f"--- Warehouses auto-created: {warehouses_created}")

        return jsonify({
            'success': True,
            'message': message,
            'data': {
                'name': purchase_receipt_name,
                'supplier': supplier,  # Devolver sin abbr para el frontend
                'posting_date': posting_date,
                'company': company,
                'warehouses_created': warehouses_created,
                'items_count': len(purchase_items)
            }
        })

    except Exception as e:
        print("--- Crear remito: error")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@remitos_bp.route('/api/remitos/<remito_name>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def handle_remito(remito_name):
    """Obtiene o actualiza un remito específico (Purchase Receipt)"""

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        print("--- Remito operation: error auth")
        return error_response

    print(f"--- {request.method} remito: {remito_name}")

    try:
        if request.method == 'GET':
            # Obtener detalles completos del remito
            print(f"🔍 Solicitando datos del remito '{remito_name}' para edición")
            fields_param = '["*"]'
            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Receipt/{quote(remito_name)}?fields={quote(fields_param)}",
                operation_name=f"Get purchase receipt details for '{remito_name}'"
            )

            if error:
                return handle_erpnext_error(error, f"Error obteniendo remito '{remito_name}'")

            if response.status_code == 200:
                remito_data = response.json().get('data', {})

                # Remover sigla del supplier antes de enviar al frontend
                company_abbr = get_company_abbr(session, headers, remito_data.get('company'))
                if company_abbr and 'supplier' in remito_data:
                    remito_data['supplier'] = remove_company_abbr(remito_data['supplier'], company_abbr)

                # Remover sigla de los item_codes antes de enviar al frontend
                if company_abbr and 'items' in remito_data and isinstance(remito_data['items'], list):
                    for item in remito_data['items']:
                        if 'item_code' in item and item['item_code']:
                            item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)

                print(f"Remito obtenido: {remito_name}")
                try:
                    preview_payload = {
                        "name": remito_data.get("name"),
                        "supplier": remito_data.get("supplier"),
                        "posting_date": remito_data.get("posting_date"),
                        "items_count": len(remito_data.get("items", []))
                    }
                    print(f"📦 Datos listos para enviar al frontend: {json.dumps(preview_payload, ensure_ascii=False)}")
                except Exception as preview_error:
                    print(f"⚠️ Error generando preview del remito '{remito_name}': {preview_error}")

                return jsonify({
                    "success": True,
                    "remito": remito_data,
                    "message": "Remito obtenido correctamente"
                })
            else:
                print(f"Error obteniendo remito: {response.status_code} - {response.text}")
                return jsonify({"success": False, "message": f"Remito no encontrado: {response.status_code}"}), 404

        elif request.method == 'PUT':
            # Actualizar remito existente
            payload = request.get_json()
            if not payload:
                return jsonify({
                    'success': False,
                    'message': 'Datos del remito requeridos'
                }), 400

            remito_data = payload.get('remito') if isinstance(payload.get('remito'), dict) else payload
            if not remito_data or not isinstance(remito_data, dict):
                return jsonify({
                    'success': False,
                    'message': 'Datos del remito requeridos'
                }), 400

            # Obtener datos actuales del remito para validar compañía
            current_response, current_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Receipt/{quote(remito_name)}",
                operation_name=f"Get current purchase receipt data for '{remito_name}'"
            )

            if current_error:
                return handle_erpnext_error(current_error, f"Error obteniendo remito actual '{remito_name}'")

            if current_response.status_code != 200:
                return jsonify({"success": False, "message": f"Error obteniendo remito actual: {current_response.status_code}"}), 500

            current_remito = current_response.json().get('data', {})
            company_name = current_remito.get('company')
            current_docstatus = current_remito.get('docstatus', 0)

            # Validar que el usuario tenga acceso a la compañía
            user_company = get_active_company(user_id)
            if user_company != company_name:
                return jsonify({"success": False, "message": "No tiene permisos para modificar este remito"}), 403

            # Obtener sigla de la compañía para manejar supplier
            company_abbr = get_company_abbr(session, headers, company_name)

            # Cancelación directa: si se pide docstatus 2 o status cancelado, solo cancelar
            requested_docstatus = remito_data.get('docstatus')
            requested_status = str(remito_data.get('status') or '').strip().lower()
            wants_cancel = requested_docstatus in (2, '2') or requested_status in ('cancelado', 'cancelled')
            if wants_cancel:
                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.cancel",
                    data={"doctype": "Purchase Receipt", "name": remito_name},
                    operation_name=f"Cancel purchase receipt '{remito_name}' (PUT cancel)",
                    send_as_form=True
                )
                if cancel_error:
                    return handle_erpnext_error(cancel_error, f"Error cancelando remito '{remito_name}'")
                if cancel_response.status_code != 200:
                    return jsonify({"success": False, "message": cancel_response.text}), 400

                return jsonify({
                    "success": True,
                    "message": "Remito cancelado correctamente",
                    "data": {"name": remito_name, "docstatus": 2}
                })

            # Si el remito ya fue enviado y se está intentando modificar, aplicar workaround:
            # cancelar el remito existente y crear uno nuevo con los cambios solicitados.
            # Esto cubre cambios de is_return u otras modificaciones que no son cancelaciones.
            current_is_return = int(current_remito.get('is_return', 0))
            requested_is_return = int(remito_data.get('is_return', current_is_return))
            return_against_value = remito_data.get('return_against') or current_remito.get('return_against')

            if requested_is_return == 1:
                if not return_against_value:
                    return jsonify({
                        "success": False,
                        "message": "Para guardar una devolución debés indicar return_against (remito original). Usá 'Relacionar con...'."
                    }), 400
                items = remito_data.get('items', [])
                for idx, item in enumerate(items, start=1):
                    if not (item.get('pr_detail') or item.get('purchase_receipt_item')):
                        return jsonify({
                            "success": False,
                            "message": f"Item #{idx}: falta pr_detail (relación con el remito original). Usá 'Relacionar con...'."
                        }), 400
            if current_docstatus == 1 and requested_is_return != current_is_return:
                print(f"--- is_return cambió de {current_is_return} a {requested_is_return}, aplicando workaround (cancelar + recrear)")
                
                # 1. Cancelar remito existente
                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.cancel",
                    data={"doctype": "Purchase Receipt", "name": remito_name},
                    operation_name=f"Cancel purchase receipt '{remito_name}' (is_return workaround)",
                    send_as_form=True
                )
                if cancel_error:
                    return handle_erpnext_error(cancel_error, f"Error cancelando remito '{remito_name}' para workaround is_return")
                if cancel_response.status_code != 200:
                    return jsonify({"success": False, "message": f"Error cancelando remito para recrear: {cancel_response.text}"}), 400
                
                # 2. Preparar datos para recrear el remito
                # Usar el base_code original para que ERPNext le asigne nuevo sufijo
                original_base_code = None
                original_name = current_remito.get('name', '')
                # Extraer base_code del name (quitar últimos 5 dígitos de auditoría)
                if original_name and len(original_name) > 5:
                    # El formato es CC-REM-R-XXXXX-XXXXXXXX + sufijo de ERPNext
                    # El base_code es la parte sin el sufijo numérico final
                    parts = original_name.rsplit('-', 1)
                    if len(parts) == 2 and parts[1].isdigit():
                        # Es un name con sufijo, el base_code son los primeros 22 caracteres
                        # Formato: CC-REM-R-XXXXX-XXXXXXXX (base) + sufijo interno
                        original_base_code = f"{parts[0]}-{parts[1][:10]}" if len(parts[1]) > 10 else original_name
                    else:
                        original_base_code = original_name
                else:
                    original_base_code = remito_data.get('base_code') or original_name
                
                # Usar items del request o los actuales
                recreate_items = remito_data.get('items') or current_remito.get('items', [])
                
                # Normalizar items para recreación
                normalized_recreate_items = []
                for item in recreate_items:
                    if not isinstance(item, dict):
                        continue
                    item_code = item.get('item_code', '')
                    # Asegurar que tenga sigla de compañía (sin duplicar)
                    if company_abbr and item_code:
                        item_code = add_company_abbr(item_code, company_abbr)
                    pr_detail = item.get('pr_detail') or item.get('purchase_receipt_item')
                    
                    qty_val = float(item.get('qty', 0))
                    if requested_is_return == 1:
                        qty_val = -abs(qty_val)
                    normalized_recreate_items.append({
                        'item_code': item_code,
                        'qty': qty_val,
                        'rate': float(item.get('rate', 0)),
                        'warehouse': item.get('warehouse', ''),
                        'uom': item.get('uom') or item.get('stock_uom', 'Unit'),
                        'propiedad': item.get('propiedad', 'Propio'),
                        'conversion_factor': float(item.get('conversion_factor', 1)),
                        **({'pr_detail': pr_detail, 'purchase_receipt_item': pr_detail} if pr_detail else {})
                    })
                
                # Preparar supplier con sigla
                recreate_supplier = remito_data.get('supplier') or current_remito.get('supplier', '')
                if company_abbr and recreate_supplier and not recreate_supplier.endswith(f' - {company_abbr}'):
                    recreate_supplier = add_company_abbr(recreate_supplier, company_abbr)
                
                # Crear nuevo remito con is_return actualizado
                new_receipt_data = {
                    'doctype': 'Purchase Receipt',
                    'supplier': recreate_supplier,
                    'posting_date': remito_data.get('posting_date') or current_remito.get('posting_date'),
                    'company': company_name,
                    'items': normalized_recreate_items,
                    'is_return': requested_is_return,
                    'docstatus': 1,
                    'status': 'To Bill',
                    'custom_estado_remito': 'Recibido pendiente de factura'
                }
                if requested_is_return == 1 and return_against_value:
                    new_receipt_data['return_against'] = return_against_value

                # Naming: prefer naming_series from client, else derive from current fields/name.
                effective_series = remito_data.get('naming_series') or None
                if not effective_series:
                    pv = remito_data.get('punto_de_venta') or current_remito.get('punto_de_venta')
                    rn = remito_data.get('remito_number') or current_remito.get('remito_number')
                    if pv and rn:
                        pv_formatted = str(pv).zfill(5)[-5:]
                        rn_formatted = str(rn).zfill(8)[-8:]
                        effective_series = f"CC-REM-R-{pv_formatted}-{rn_formatted}"
                if not effective_series:
                    original_name_for_series = current_remito.get('name') or ''
                    parts = str(original_name_for_series).split('-')
                    if len(parts) >= 2:
                        last = parts[-1]
                        if last.isdigit() and len(last) > 8:
                            parts[-1] = last[:-5]
                            effective_series = '-'.join(parts)

                if effective_series:
                    new_receipt_data['naming_series'] = effective_series
                # Optional fields
                if remito_data.get('supplier_address') or current_remito.get('supplier_address'):
                    new_receipt_data['supplier_address'] = remito_data.get('supplier_address') or current_remito.get('supplier_address')
                if remito_data.get('currency') or current_remito.get('currency'):
                    new_receipt_data['currency'] = remito_data.get('currency') or current_remito.get('currency')
                if remito_data.get('conversion_rate') or current_remito.get('conversion_rate'):
                    new_receipt_data['conversion_rate'] = remito_data.get('conversion_rate') or current_remito.get('conversion_rate')
                
                # Do not send name/base_code for purchase receipts; naming is handled via naming_series.
                
                if remito_data.get('title') or current_remito.get('title'):
                    new_receipt_data['title'] = remito_data.get('title') or current_remito.get('title')
                
                # Crear el nuevo remito
                create_response, create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Purchase Receipt",
                    data={'data': new_receipt_data},
                    operation_name=f"Recreate purchase receipt (edit workaround from '{remito_name}')"
                )
                
                if create_error:
                    return handle_erpnext_error(create_error, f"Error recreando remito tras cancelar '{remito_name}'")
                
                if create_response.status_code not in [200, 201]:
                    return jsonify({"success": False, "message": f"Error creando nuevo remito: {create_response.text}"}), 400
                
                new_receipt = create_response.json().get('data', {})
                new_name = new_receipt.get('name')
                
                # Remover siglas antes de enviar al frontend
                if company_abbr and 'supplier' in new_receipt:
                    new_receipt['supplier'] = remove_company_abbr(new_receipt['supplier'], company_abbr)
                if company_abbr and 'items' in new_receipt and isinstance(new_receipt['items'], list):
                    for item in new_receipt['items']:
                        if 'item_code' in item and item['item_code']:
                            item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)
                
                action_label = 'Devolución emitida' if requested_is_return == 1 else 'Por facturar'
                return jsonify({
                    "success": True,
                    "message": f"Remito actualizado a '{action_label}'. Anterior cancelado: {remito_name}, nuevo: {new_name}",
                    "remito": new_receipt,
                    "data": {
                        "name": new_name,
                        "old_name": remito_name,
                        "is_return": requested_is_return
                    }
                })
            # Ya se recreó el remito y retornó la respuesta al frontend.

            incoming_items = remito_data.get('items')
            if not incoming_items or not isinstance(incoming_items, list) or len(incoming_items) == 0:
                incoming_items = current_remito.get('items', [])

            if not incoming_items:
                return jsonify({
                    'success': False,
                    'message': 'El remito debe contener al menos un item'
                }), 400

            normalized_items = []
            current_items = current_remito.get('items', []) if isinstance(current_remito.get('items'), list) else []
            map_by_name = {itm.get('name'): itm for itm in current_items if isinstance(itm, dict) and itm.get('name')}
            map_by_code = {itm.get('item_code'): itm for itm in current_items if isinstance(itm, dict) and itm.get('item_code')}

            for item in incoming_items:
                if not isinstance(item, dict):
                    continue
                item_copy = dict(item)
                item_code_value = item_copy.get('item_code')
                if item_code_value and company_abbr:
                    item_copy['item_code'] = add_company_abbr(item_code_value, company_abbr)
                if not item_copy.get('propiedad'):
                    item_copy['propiedad'] = 'Propio'

                # Completar campos mandatorios usando el ítem actual en ERP como fallback
                source_item = None
                if item_copy.get('name') and item_copy.get('name') in map_by_name:
                    source_item = map_by_name.get(item_copy.get('name'))
                elif item_copy.get('item_code') and item_copy.get('item_code') in map_by_code:
                    source_item = map_by_code.get(item_copy.get('item_code'))

                # Asegurar que usemos el name real del ítem existente si lo encontramos
                if source_item and source_item.get('name'):
                    item_copy['name'] = source_item.get('name')
                elif 'name' in item_copy and not source_item:
                    # Eliminar names que no correspondan a ERPNext para evitar DoesNotExistError
                    item_copy.pop('name', None)

                # No permitir cambios de apply_to después de submit: forzar valor original si existe
                if source_item and source_item.get('apply_to') is not None:
                    item_copy['apply_to'] = source_item.get('apply_to')

                def ensure_field(field, default=None):
                    if item_copy.get(field) is None or item_copy.get(field) == '':
                        if source_item and source_item.get(field) is not None:
                            item_copy[field] = source_item.get(field)
                        elif default is not None:
                            item_copy[field] = default

                ensure_field('item_name')
                ensure_field('stock_uom')
                ensure_field('conversion_factor', 1)
                ensure_field('uom', item_copy.get('stock_uom'))
                ensure_field('rate', 0)
                ensure_field('base_rate', item_copy.get('rate') or 0)
                ensure_field('brand')
                ensure_field('item_group')
                ensure_field('apply_to')

                # Asegurar campos numéricos obligatorios (received_qty, stock_qty, amounts)
                qty_val = float(item_copy.get('qty') or 0)
                # Si el remito se marca como devolución, forzar qty negativa
                if isinstance(remito_data, dict):
                    requested_is_return = int(remito_data.get('is_return', current_remito.get('is_return', 0)))
                else:
                    requested_is_return = int(current_remito.get('is_return', 0))
                item_copy['qty'] = -abs(qty_val) if requested_is_return == 1 else abs(qty_val)
                conv_val = float(item_copy.get('conversion_factor') or 1)
                rate_val = float(item_copy.get('rate') or 0)
                base_rate_val = float(item_copy.get('base_rate') or rate_val)
                item_copy['rate'] = rate_val
                item_copy['base_rate'] = base_rate_val

                if item_copy.get('received_qty') in (None, '', 0):
                    item_copy['received_qty'] = qty_val
                if item_copy.get('stock_qty') in (None, '', 0):
                    item_copy['stock_qty'] = qty_val * conv_val

                amount_val = item_copy.get('amount')
                if amount_val in (None, ''):
                    amount_val = qty_val * rate_val
                    item_copy['amount'] = amount_val
                if item_copy.get('base_amount') in (None, ''):
                    item_copy['base_amount'] = amount_val

                item_copy['_source_item'] = source_item  # referenciar luego para validaciones

                normalized_items.append(item_copy)

            if not normalized_items:
                return jsonify({
                    'success': False,
                    'message': 'El remito debe contener al menos un item'
                }), 400

            # Si el documento ya está enviado, bloquear cambios de cantidad y avisar
            if current_docstatus == 1:
                for item in normalized_items:
                    src = item.pop('_source_item', None)
                    if not src:
                        continue
                    def _f(val):
                        try:
                            return float(val)
                        except Exception:
                            return 0.0
                    if _f(item.get('qty')) != _f(src.get('qty')) or _f(item.get('received_qty')) != _f(src.get('received_qty')):
                        return jsonify({
                            'success': False,
                            'message': 'No se pueden modificar cantidades en un remito enviado. Cancela el remito y crea uno nuevo.'
                        }), 400
            else:
                # limpiar referencia auxiliar si el doc no está enviado
                for item in normalized_items:
                    item.pop('_source_item', None)

            # Preparar datos para actualizar
            updated_supplier = remito_data.get('supplier') or current_remito.get('supplier')
            if updated_supplier and company_abbr:
                updated_supplier = add_company_abbr(updated_supplier, company_abbr)

            # Preparar payload para actualizar Purchase Receipt
            update_data = {
                'supplier': updated_supplier,
                'posting_date': remito_data.get('posting_date') or current_remito.get('posting_date'),
                'company': company_name,
                'title': remito_data.get('title') or current_remito.get('title'),
                'status': remito_data.get('status') or current_remito.get('status'),
                'items': normalized_items,
                'docstatus': remito_data.get('docstatus', current_remito.get('docstatus', 0)),
                'is_return': requested_is_return
            }
            if requested_is_return == 1 and return_against_value:
                update_data['return_against'] = return_against_value

            # Naming: prefer naming_series from client, else derive from current fields/name.
            effective_series = remito_data.get('naming_series') or None
            if not effective_series:
                pv = remito_data.get('punto_de_venta') or current_remito.get('punto_de_venta')
                rn = remito_data.get('remito_number') or current_remito.get('remito_number')
                if pv and rn:
                    pv_formatted = str(pv).zfill(5)[-5:]
                    rn_formatted = str(rn).zfill(8)[-8:]
                    effective_series = f"CC-REM-R-{pv_formatted}-{rn_formatted}"
            if effective_series:
                update_data['naming_series'] = effective_series

            # Agregar campos opcionales si existen
            if remito_data.get('supplier_address'):
                update_data['supplier_address'] = remito_data['supplier_address']
            if remito_data.get('currency'):
                update_data['currency'] = remito_data['currency']
            if remito_data.get('conversion_rate'):
                update_data['conversion_rate'] = remito_data['conversion_rate']

            # Actualizar Purchase Receipt
            response, error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Purchase Receipt/{quote(remito_name)}",
                data={"data": update_data},
                operation_name=f"Update purchase receipt '{remito_name}'"
            )

            if error:
                return handle_erpnext_error(error, f"Error actualizando remito '{remito_name}'")

            if response.status_code == 200:
                updated_remito = response.json().get('data', {})

                # Remover sigla del supplier antes de enviar al frontend
                if company_abbr and 'supplier' in updated_remito:
                    updated_remito['supplier'] = remove_company_abbr(updated_remito['supplier'], company_abbr)

                # Remover sigla de los item_codes antes de enviar al frontend
                if company_abbr and 'items' in updated_remito and isinstance(updated_remito['items'], list):
                    for item in updated_remito['items']:
                        if 'item_code' in item and item['item_code']:
                            item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)

                print(f"Remito actualizado exitosamente: {remito_name}")

                return jsonify({
                    "success": True,
                    "remito": updated_remito,
                    "message": "Remito actualizado correctamente"
                })
            else:
                print(f"Error actualizando remito: {response.status_code} - {response.text}")
                return jsonify({"success": False, "message": f"Error al actualizar remito: {response.status_code}"}), 500

        elif request.method == 'DELETE':
            payload = request.get_json(silent=True) or {}
            provided_status = payload.get('docstatus')
            docstatus = provided_status if provided_status is not None else get_purchase_receipt_docstatus(session, remito_name)

            if docstatus == 0:
                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Purchase Receipt/{quote(remito_name)}",
                    operation_name=f"Delete draft purchase receipt '{remito_name}'"
                )
                if delete_error:
                    return handle_erpnext_error(delete_error, f"Error eliminando remito '{remito_name}'")
                if delete_response.status_code not in [200, 202, 204]:
                    return jsonify({"success": False, "message": delete_response.text}), 400

                return jsonify({
                    "success": True,
                    "message": "Remito borrador eliminado correctamente"
                })

            elif docstatus == 1:
                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.cancel",
                    data={"doctype": "Purchase Receipt", "name": remito_name},
                    operation_name=f"Cancel purchase receipt '{remito_name}'",
                    send_as_form=True
                )
                if cancel_error:
                    return handle_erpnext_error(cancel_error, f"Error cancelando remito '{remito_name}'")
                if cancel_response.status_code != 200:
                    return jsonify({"success": False, "message": cancel_response.text}), 400

                return jsonify({
                    "success": True,
                    "message": "Remito cancelado correctamente"
                })

            else:
                return jsonify({
                    "success": False,
                    "message": f"Docstatus {docstatus} no soportado para eliminación"
                }), 400

    except Exception as e:
        print(f"--- {request.method} remito: error")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(e)}'
        }), 500


@remitos_bp.route('/api/remitos/bulk-removal', methods=['POST'])
def bulk_remove_remitos():
    """Eliminar o cancelar remitos de forma masiva."""
    payload = request.get_json() or {}
    remitos = payload.get('remitos')

    if not remitos or not isinstance(remitos, list):
        return jsonify({"success": False, "message": "Debe proporcionar la lista de remitos a procesar"}), 400

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    summary = {"deleted": 0, "cancelled": 0, "failed": 0}
    results = []

    for entry in remitos:
        remito_name = entry.get('name') if isinstance(entry, dict) else entry
        provided_status = entry.get('docstatus') if isinstance(entry, dict) else None

        if not remito_name:
            summary["failed"] += 1
            results.append({
                "name": remito_name,
                "success": False,
                "message": "Nombre de remito inválido"
            })
            continue

        try:
            docstatus = provided_status if provided_status is not None else get_purchase_receipt_docstatus(session, remito_name)

            if docstatus == 0:
                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Purchase Receipt/{quote(remito_name)}",
                    operation_name=f"Delete draft purchase receipt '{remito_name}' (bulk)"
                )
                if delete_error:
                    raise RuntimeError(delete_error)
                if delete_response.status_code not in [200, 202, 204]:
                    raise RuntimeError(delete_response.text)

                summary["deleted"] += 1
                results.append({
                    "name": remito_name,
                    "success": True,
                    "action": "deleted"
                })

            elif docstatus == 1:
                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.cancel",
                    data={"doctype": "Purchase Receipt", "name": remito_name},
                    operation_name=f"Cancel purchase receipt '{remito_name}' (bulk)",
                    send_as_form=True
                )
                if cancel_error:
                    raise RuntimeError(cancel_error)
                if cancel_response.status_code != 200:
                    raise RuntimeError(cancel_response.text)

                summary["cancelled"] += 1
                results.append({
                    "name": remito_name,
                    "success": True,
                    "action": "cancelled"
                })
            else:
                summary["failed"] += 1
                results.append({
                    "name": remito_name,
                    "success": False,
                    "message": f"Docstatus {docstatus} no soportado para eliminación masiva"
                })

        except Exception as exc:
            summary["failed"] += 1
            results.append({
                "name": remito_name,
                "success": False,
                "message": str(exc)
            })

    success = summary["failed"] == 0
    message = (
        f"Procesados {len(remitos)} remitos "
        f"(eliminados: {summary['deleted']}, cancelados: {summary['cancelled']}, con error: {summary['failed']})"
    )
    status_code = 200 if success else (207 if summary["deleted"] or summary["cancelled"] else 400)

    return jsonify({
        "success": success,
        "message": message,
        "summary": summary,
        "results": results
    }), status_code


ROLE_PRIORITY = {'OWN': 0, 'CON': 1, 'VCON': 2}
ROLE_TO_PROPIEDAD = {
    'OWN': 'Propio',
    'CON': 'Consignación',
    'VCON': 'Mercadería en local del proveedor'
}


def _normalize_group_entries(group_data, company_abbr):
    entries = []
    if not isinstance(group_data, dict):
        return entries

    raw_entries = group_data.get('entries', [])
    if not isinstance(raw_entries, list):
        return entries

    for entry in raw_entries:
        name = entry.get('name')
        if not name:
            continue
        role = entry.get('role')
        if not role:
            tokens = tokenize_warehouse_name(name)
            role = tokens.get('role') if tokens else 'OWN'
        display = entry.get('warehouse_name') or remove_company_abbr(name, company_abbr)
        entries.append({
            'warehouse': name,
            'role': role or 'OWN',
            'display': display
        })
    return entries


def _fetch_group_entries_from_erp(session, headers, company, warehouse_display, company_abbr):
    if not warehouse_display:
        return []

    filters = [
        ["company", "=", company],
        ["warehouse_name", "=", warehouse_display]
    ]

    params = {
        'fields': json.dumps(["name", "warehouse_name"]),
        'filters': json.dumps(filters),
        'limit_page_length': 1000
    }

    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Warehouse",
        params=params,
        operation_name="Fetch warehouse group entries"
    )

    if error or response.status_code != 200:
        return []

    entries = []
    for warehouse in response.json().get('data', []):
        name = warehouse.get('name')
        if not name:
            continue
        tokens = tokenize_warehouse_name(name)
        role = tokens.get('role') if tokens else 'OWN'
        display = warehouse.get('warehouse_name') or remove_company_abbr(name, company_abbr)
        entries.append({
            'warehouse': name,
            'role': role or 'OWN',
            'display': display
        })
    return entries


def _resolve_sales_item_candidates(item_data, session, headers, company, company_abbr):
    group_entries = _normalize_group_entries(item_data.get('warehouse_group'), company_abbr)
    if group_entries:
        return group_entries

    warehouse_display = item_data.get('warehouse') or item_data.get('warehouse_preference')
    if warehouse_display:
        erp_entries = _fetch_group_entries_from_erp(session, headers, company, warehouse_display, company_abbr)
        if erp_entries:
            return erp_entries

    fallback_name = item_data.get('warehouse')
    if fallback_name:
        return [{
            'warehouse': fallback_name,
            'role': 'OWN',
            'display': remove_company_abbr(fallback_name, company_abbr)
        }]

    return []


def _allocate_sales_item(item_data, candidates, stock_entry):
    qty = float(item_data.get('qty') or 0)
    if qty <= 0:
        raise ValueError('Cada item debe tener cantidad mayor a 0')

    bins = stock_entry.get('bins', []) if stock_entry else []
    qty_map = {}
    for bin_entry in bins:
        warehouse_name = bin_entry.get('warehouse')
        if warehouse_name:
            qty_map[warehouse_name] = float(bin_entry.get('actual_qty') or 0)

    ordered_candidates = sorted(
        candidates,
        key=lambda candidate: ROLE_PRIORITY.get(candidate['role'], 99)
    )

    allocations = []
    remaining = qty

    for candidate in ordered_candidates:
        available = qty_map.get(candidate['warehouse'], 0)
        take_qty = min(remaining, available)
        if take_qty <= 0:
            continue
        allocations.append({
            'candidate': candidate,
            'qty': take_qty
        })
        remaining -= take_qty
        if remaining <= 0:
            break

    if remaining > 0:
        if allocations:
            allocations[0]['qty'] += remaining
        elif ordered_candidates:
            allocations.append({
                'candidate': ordered_candidates[0],
                'qty': remaining
            })
        else:
            raise ValueError('No se encontraron warehouses disponibles para el item seleccionado')

    return allocations


def _build_sales_delivery_items(items_payload, company, company_abbr, session, headers, is_return=False):
    if not isinstance(items_payload, list) or len(items_payload) == 0:
        raise ValueError('Debe proporcionar al menos un item para el remito')

    normalized_items = []
    erp_codes = []

    for item in items_payload:
        item_code = item.get('item_code')
        if not item_code:
            raise ValueError('Cada item debe incluir item_code')
        erp_code = add_company_abbr(item_code, company_abbr)
        normalized_items.append((item, erp_code))
        erp_codes.append(erp_code)

    stock_map = fetch_bin_stock(session, headers, erp_codes, company)
    delivery_items = []

    for item, erp_code in normalized_items:
        candidates = _resolve_sales_item_candidates(item, session, headers, company, company_abbr)
        if not candidates:
            raise ValueError(f"No se encontraron warehouses para '{item.get('warehouse') or item.get('warehouse_preference') or 'sin especificar'}'")

        stock_entry = stock_map.get(erp_code, {})
        allocation_item = dict(item)
        try:
            allocation_item['qty'] = abs(float(item.get('qty') or 0))
        except Exception:
            allocation_item['qty'] = item.get('qty')
        allocations = _allocate_sales_item(allocation_item, candidates, stock_entry)

        for allocation in allocations:
            candidate = allocation['candidate']
            qty_value = -allocation['qty'] if is_return else allocation['qty']
            delivery_items.append({
                'item_code': erp_code,
                'qty': qty_value,
                'warehouse': candidate['warehouse'],
                'description': item.get('description'),
                'uom': item.get('uom') or 'Unit',
                'propiedad': ROLE_TO_PROPIEDAD.get(candidate['role'], 'Propio'),
                'dn_detail': item.get('dn_detail') or item.get('delivery_note_item') or item.get('detail')
            })

    return delivery_items


@remitos_bp.route('/api/sales-remitos', methods=['POST', 'OPTIONS'])
def create_sales_remito():
    """Crear un remito de venta (Delivery Note)."""

    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        customer = data.get('customer')
        posting_date = data.get('posting_date')
        items = data.get('items', [])
        company = data.get('company')
        title = data.get('title')
        customer_address = data.get('customer_address')
        status = data.get('status', 'Borrador')
        return_against = data.get('return_against')
        punto_de_venta = data.get('punto_de_venta')
        remito_number = data.get('remito_number')
        talonario_name = data.get('talonario_name')
        remito_letter = (data.get('remito_letter') or 'R').upper()

        if not customer:
            return jsonify({
                'success': False,
                'message': 'El cliente es requerido'
            }), 400

        if not company:
            return jsonify({
                'success': False,
                'message': 'La compa\u00f1\u00eda es requerida'
            }), 400

        if not items:
            return jsonify({
                'success': False,
                'message': 'El remito debe incluir al menos un \u00edtem'
            }), 400

        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({
                'success': False,
                'message': 'No se pudo obtener la sigla de la compa\u00f1\u00eda'
            }), 400

        from datetime import datetime
        posting_date = posting_date or datetime.now().strftime('%Y-%m-%d')
        # Ensure we don't append the company abbr twice if the customer already includes it
        customer_full = add_company_abbr(customer, company_abbr)

        if not talonario_name:
            return jsonify({
                'success': False,
                'message': 'Debes seleccionar un talonario de remitos activo'
            }), 400

        talonario_resp, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Talonario/{quote(talonario_name)}",
            operation_name=f"Get talonario '{talonario_name}' for sales remito"
        )

        if talonario_error:
            return jsonify({
                'success': False,
                'message': talonario_error.get('message') or 'Error obteniendo talonario'
            }), 400

        if talonario_resp.status_code != 200:
            return jsonify({
                'success': False,
                'message': f"Error obteniendo talonario: {talonario_resp.text}"
            }), talonario_resp.status_code

        talonario_doc = talonario_resp.json().get('data', {})
        if talonario_doc.get('docstatus') == 2:
            return jsonify({
                'success': False,
                'message': 'El talonario seleccionado está deshabilitado'
            }), 400

        talonario_letters = [
            (entry.get('letra') or '').upper()
            for entry in talonario_doc.get('letras', [])
        ]
        if talonario_letters and remito_letter not in talonario_letters:
            return jsonify({
                'success': False,
                'message': f'El talonario no tiene configurada la letra {remito_letter}'
            }), 400

        talonario_punto_venta = talonario_doc.get('punto_de_venta')
        if not talonario_punto_venta:
            return jsonify({
                'success': False,
                'message': 'El talonario seleccionado no tiene punto de venta configurado'
            }), 400

        next_remito_number = get_next_number_for_sequence(
            session=session,
            headers=headers,
            talonario_name=talonario_name,
            tipo_documento='REM',
            letra=remito_letter
        ) or 1

        remito_number_formatted = str(next_remito_number).zfill(8)
        talonario_pdv_formatted = str(talonario_punto_venta).zfill(5)

        # If the client provides a specific PDV/number, respect it (but normalize).
        effective_pdv = punto_de_venta or talonario_pdv_formatted
        effective_number = remito_number or remito_number_formatted
        effective_pdv_formatted = str(effective_pdv).zfill(5)[-5:]
        effective_number_formatted = str(effective_number).zfill(8)[-8:]

        # Compose a single naming_series string based on talonario type (manual/electronic).
        # Example: VM-REM-R-00004-00000001
        talonario_tipo = (talonario_doc.get('tipo_de_talonario') or '').lower()
        prefix = 'VE' if 'electron' in talonario_tipo else 'VM'
        naming_series = f"{prefix}-REM-{remito_letter}-{effective_pdv_formatted}-{effective_number_formatted}"

        status_lower = str(status or '').strip().lower()
        is_return = int(data.get('is_return') or 0) == 1 or 'devoluci' in status_lower

        if is_return:
            if not return_against:
                return jsonify({
                    'success': False,
                    'message': "Para crear un remito de devolución debés relacionarlo con un remito anterior (return_against)."
                }), 400
            for idx, item in enumerate(items, start=1):
                if not (item.get('dn_detail') or item.get('delivery_note_item') or item.get('detail')):
                    return jsonify({
                        'success': False,
                        'message': f"Item #{idx}: falta la relación con el remito original (dn_detail). Usá 'Relacionar con...' para generar la devolución."
                    }), 400

        try:
            delivery_items = _build_sales_delivery_items(
                items,
                company,
                company_abbr,
                session,
                headers,
                is_return=is_return
            )
        except ValueError as allocation_error:
            return jsonify({
                'success': False,
                'message': str(allocation_error)
            }), 400
        except Exception as allocation_error:
            print(f"--- Error allocating warehouses for sales remito: {allocation_error}")
            traceback.print_exc()
            return jsonify({
                'success': False,
                'message': 'Error interno al distribuir los \u00edtems por almac\u00e9n'
            }), 500

        # ERPNext uses status values like: "", "Borrador", "Por facturar", "Completado", "Devolución emitida", "Cancelado", "Cerrado"
        # Treat 'Completado' or 'Por facturar' (or old 'Confirmada') as submitted (docstatus=1)
        submitted_status_values = {'Completado', 'Por facturar', 'Devolución emitida', 'Confirmada'}
        docstatus = 1 if (isinstance(status, str) and status in submitted_status_values) or data.get('docstatus') == 1 else 0

        delivery_note_data = {
            'doctype': 'Delivery Note',
            'customer': customer_full,
            'posting_date': posting_date,
            'company': company,
            'items': delivery_items,
            'docstatus': docstatus,
            # Do not send talonario/pdv/number/status fields; send naming_series only.
            'naming_series': naming_series
        }
        if is_return:
            delivery_note_data['is_return'] = 1
            delivery_note_data['return_against'] = return_against

        if title:
            delivery_note_data['title'] = title
        if customer_address:
            delivery_note_data['customer_address'] = customer_address
        # NOTE: ERPNext expects the document name/naming via naming_series. Do not send these fields.

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Delivery Note",
            data={'data': delivery_note_data},
            operation_name="Create Delivery Note"
        )

        if error:
            return handle_erpnext_error(error, "Failed to create delivery note")

        created_data = response.json().get('data', {})

        try:
            try:
                chosen_number = int(effective_number_formatted)
            except Exception:
                chosen_number = next_remito_number
            update_last_number_for_sequence(
                session=session,
                headers=headers,
                talonario_name=talonario_name,
                tipo_documento='REM',
                letra=remito_letter,
                nuevo_numero=chosen_number
            )
        except Exception as update_error:
            print(f"--- Advertencia: no se pudo actualizar el número del talonario '{talonario_name}': {update_error}")
        if customer and company_abbr:
            created_data['customer'] = remove_company_abbr(created_data.get('customer'), company_abbr)
        if 'items' in created_data and isinstance(created_data['items'], list):
            for item in created_data['items']:
                if 'item_code' in item:
                    item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)

        return jsonify({
            'success': True,
            'message': f"Remito de venta creado: {created_data.get('name')}",
            'data': created_data
        })

    except Exception as exc:
        print("--- Error creating sales remito")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(exc)}'
        }), 500


@remitos_bp.route('/api/sales-remitos/<remito_name>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def handle_sales_remito(remito_name):
    """Operaciones CRUD para Delivery Note."""

    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        if request.method == 'GET':
            fields_param = '["*"]'
            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Delivery Note/{quote(remito_name)}?fields={quote(fields_param)}",
                operation_name=f"Get delivery note details for '{remito_name}'"
            )

            if error:
                return handle_erpnext_error(error, f"Error obteniendo remito de venta '{remito_name}'")

            if response.status_code != 200:
                return jsonify({'success': False, 'message': 'Remito no encontrado'}), 404

            remito_data = response.json().get('data', {})
            company_abbr = get_company_abbr(session, headers, remito_data.get('company'))
            if company_abbr and remito_data.get('customer'):
                remito_data['customer'] = remove_company_abbr(remito_data['customer'], company_abbr)

            if company_abbr and isinstance(remito_data.get('items'), list):
                for item in remito_data['items']:
                    if item.get('item_code'):
                        item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)

            return jsonify({
                'success': True,
                'remito': remito_data,
                'message': 'Remito obtenido correctamente'
            })

        elif request.method == 'PUT':
            payload = request.get_json() or {}
            remito_data = payload.get('remito') if isinstance(payload.get('remito'), dict) else payload
            items = remito_data.get('items', [])

            if not items:
                return jsonify({
                    'success': False,
                    'message': 'El remito debe contener al menos un \u00edtem'
                }), 400

            current_response, current_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Delivery Note/{quote(remito_name)}",
                operation_name=f"Get current delivery note data for '{remito_name}'"
            )

            if current_error or current_response.status_code != 200:
                return handle_erpnext_error(current_error, f"Error obteniendo remito '{remito_name}'") if current_error else (
                    jsonify({'success': False, 'message': 'No se pudo obtener el remito'}), 500
                )

            current_remito = current_response.json().get('data', {})
            company_name = current_remito.get('company')
            company_abbr = get_company_abbr(session, headers, company_name)
            current_is_return = int(current_remito.get('is_return', 0))
            requested_is_return = int(remito_data.get('is_return', current_is_return))
            return_against_value = remito_data.get('return_against') or current_remito.get('return_against')

            user_company = get_active_company(user_id)
            if user_company != company_name:
                return jsonify({'success': False, 'message': 'No tiene permisos para modificar este remito'}), 403

            customer_value = remito_data.get('customer') or current_remito.get('customer')
            if customer_value and company_abbr:
                customer_value = add_company_abbr(customer_value, company_abbr)

            if requested_is_return == 1:
                if not return_against_value:
                    return jsonify({
                        'success': False,
                        'message': 'Para guardar una devolución debés indicar return_against (remito original).'
                    }), 400
                for idx, item in enumerate(items, start=1):
                    if not (item.get('dn_detail') or item.get('delivery_note_item') or item.get('detail')):
                        return jsonify({
                            'success': False,
                            'message': f"Item #{idx}: falta dn_detail (relación con el remito original). Usá 'Relacionar con...'."
                        }), 400

            try:
                delivery_items = _build_sales_delivery_items(
                    items,
                    company_name,
                    company_abbr,
                    session,
                    headers,
                    is_return=(requested_is_return == 1)
                )
            except ValueError as allocation_error:
                return jsonify({
                    'success': False,
                    'message': str(allocation_error)
                }), 400
            except Exception as allocation_error:
                print(f"--- Error allocating warehouses for sales remito update: {allocation_error}")
                traceback.print_exc()
                return jsonify({
                    'success': False,
                    'message': 'Error interno al distribuir los \u00edtems por almac\u00e9n'
                }), 500

            docstatus = remito_data.get('docstatus')
            if docstatus is None:
                val_status = remito_data.get('status')
                submitted_status_values = {'Completado', 'Por facturar', 'Devolución emitida', 'Confirmada'}
                docstatus = 1 if (isinstance(val_status, str) and val_status in submitted_status_values) else current_remito.get('docstatus', 0)

            remito_letter_value = remito_data.get('remito_letter') or current_remito.get('remito_letter') or 'R'
            talonario_value = remito_data.get('talonario_name') or current_remito.get('talonario_name')

            update_payload = {
                'customer': customer_value,
                'posting_date': remito_data.get('posting_date') or current_remito.get('posting_date'),
                'company': company_name,
                'title': remito_data.get('title') or current_remito.get('title'),
                'status': remito_data.get('status') or current_remito.get('status'),
                'punto_de_venta': remito_data.get('punto_de_venta') or current_remito.get('punto_de_venta'),
                'remito_number': remito_data.get('remito_number') or current_remito.get('remito_number'),
                'items': delivery_items,
                'docstatus': docstatus,
                'remito_letter': remito_letter_value,
                'is_return': requested_is_return
            }
            if requested_is_return == 1:
                update_payload['return_against'] = return_against_value
            if talonario_value:
                update_payload['talonario_name'] = talonario_value

            if remito_data.get('customer_address'):
                update_payload['customer_address'] = remito_data['customer_address']

            response, error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Delivery Note/{quote(remito_name)}",
                data={'data': update_payload},
                operation_name=f"Update delivery note '{remito_name}'"
            )

            if error:
                return handle_erpnext_error(error, f"Error actualizando remito '{remito_name}'")

            updated = response.json().get('data', {})
            if company_abbr and updated.get('customer'):
                updated['customer'] = remove_company_abbr(updated['customer'], company_abbr)
            if company_abbr and isinstance(updated.get('items'), list):
                for item in updated['items']:
                    if item.get('item_code'):
                        item['item_code'] = remove_company_abbr(item['item_code'], company_abbr)

            return jsonify({
                'success': True,
                'remito': updated,
                'message': 'Remito actualizado correctamente'
            })

        elif request.method == 'DELETE':
            docstatus = get_delivery_note_docstatus(session, remito_name)

            if docstatus == 0:
                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Delivery Note/{quote(remito_name)}",
                    operation_name=f"Delete delivery note '{remito_name}'"
                )
                if delete_error:
                    return handle_erpnext_error(delete_error, f"Error eliminando remito '{remito_name}'")
                if delete_response.status_code != 200:
                    return jsonify({'success': False, 'message': 'No se pudo eliminar el remito'}), delete_response.status_code

                return jsonify({'success': True, 'message': 'Remito eliminado correctamente'})

            elif docstatus == 1:
                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.cancel",
                    data={'doctype': 'Delivery Note', 'name': remito_name},
                    operation_name=f"Cancel delivery note '{remito_name}'"
                )

                if cancel_error:
                    return handle_erpnext_error(cancel_error, f"Error cancelando remito '{remito_name}'")

                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Delivery Note/{quote(remito_name)}",
                    operation_name=f"Delete delivery note '{remito_name}' after cancel"
                )

                if delete_error:
                    return handle_erpnext_error(delete_error, f"Error eliminando remito '{remito_name}'")

                return jsonify({'success': True, 'message': 'Remito cancelado y eliminado correctamente'})

            else:
                return jsonify({
                    'success': False,
                    'message': f'Docstatus {docstatus} no soportado para eliminaci\u00f3n'
                }), 400

    except Exception as exc:
        print(f"--- Error handling sales remito '{remito_name}': {exc}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': f'Error interno del servidor: {str(exc)}'
        }), 500
