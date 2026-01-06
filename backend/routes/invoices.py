from flask import Blueprint, request, jsonify
import os
import requests
import json
import re
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar funciones para compañía activa y abreviaciones
from routes.general import get_active_company, get_company_abbr, add_company_abbr, get_company_default_currency

# Importar funciones de items.py para manejo de items
from routes.items import (
    process_invoice_item,
    find_or_create_item_by_description,
    create_item_with_description,
    create_free_item,
    get_tax_template_map,
    get_tax_template_for_rate,
    assign_tax_template_by_rate,
    determine_income_account,
    get_company_defaults
)

# Importar función para obtener cuenta específica del cliente
from routes.customers import get_customer_receivable_account

# Importar funciones de comprobantes.py para evitar duplicación
from routes.comprobantes import get_next_confirmed_number_for_talonario

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades de logging y cacheo
from utils.logging_utils import cached_function, conditional_log, log_function_call, log_search_operation, log_error, log_success
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar utilidades de inventario para verificar stock
from routes.inventory_utils import fetch_bin_stock

# Crear el blueprint para las rutas de facturas
invoices_bp = Blueprint('invoices', __name__)


def parse_negative_stock_error(error_response):
    """
    Parsea un error NegativeStockError de ERPNext y extrae información útil.
    
    Returns:
        dict or None: Información del error si es NegativeStockError, None si no lo es
    """
    if not error_response:
        return None
    
    response_body = error_response.get('response_body', '')
    
    # Verificar si es un NegativeStockError
    if 'NegativeStockError' not in response_body:
        return None
    
    try:
        error_data = json.loads(response_body)
        exception_text = error_data.get('exception', '')
        
        # Extraer cantidad requerida usando regex
        # Formato: <strong>15.0</strong> unidades de
        qty_match = re.search(r'<strong>([\d.]+)</strong>\s*unidades', exception_text)
        required_qty = float(qty_match.group(1)) if qty_match else None
        
        # Extraer item code
        # Formato: /app/Form/Item/ART010%20-%20ANC
        item_match = re.search(r'/app/Form/Item/([^"]+)', exception_text)
        item_code_encoded = item_match.group(1) if item_match else None
        item_code = None
        if item_code_encoded:
            from urllib.parse import unquote
            item_code = unquote(item_code_encoded)
        
        # Extraer warehouse
        # Formato: /app/Form/Warehouse/ALMACEN%20SENILLOSA%2058%20Piso%3APB%20Dpto%3AB%20-%20ANC
        warehouse_match = re.search(r'/app/Form/Warehouse/([^"]+)', exception_text)
        warehouse_encoded = warehouse_match.group(1) if warehouse_match else None
        warehouse = None
        if warehouse_encoded:
            from urllib.parse import unquote
            warehouse = unquote(warehouse_encoded)
        
        # Extraer nombre del item (descripción)
        # Formato: >Producto ART010 - ANC: Candado de seguridad 50mm - ANC</a>
        item_name_match = re.search(r'>Producto\s+[^:]+:\s*([^<]+)</a>', exception_text)
        item_name = item_name_match.group(1).strip() if item_name_match else None
        
        return {
            'is_negative_stock_error': True,
            'required_qty': required_qty,
            'item_code': item_code,
            'item_name': item_name,
            'warehouse': warehouse,
            'raw_exception': exception_text[:500]  # Guardar parte del texto original para debug
        }
    except Exception as e:
        print(f"--- Error parsing NegativeStockError: {e}")
        return None


def check_stock_in_other_warehouses(session, headers, item_code, required_qty, current_warehouse, company):
    """
    Verifica si hay stock suficiente en otros almacenes para el item.
    
    Returns:
        dict: Información sobre stock disponible en otros almacenes
    """
    if not item_code or not company:
        return {'has_alternative': False, 'warehouses': []}
    
    try:
        # Obtener stock del item en todos los almacenes
        stock_data = fetch_bin_stock(session, headers, [item_code], company)
        
        if not stock_data or item_code not in stock_data:
            return {'has_alternative': False, 'warehouses': [], 'total_available': 0}
        
        item_stock = stock_data[item_code]
        bins = item_stock.get('bins', [])
        
        # Filtrar almacenes que NO sean el actual y tengan stock disponible
        other_warehouses = []
        total_in_others = 0
        
        for bin_entry in bins:
            wh = bin_entry.get('warehouse', '')
            available = bin_entry.get('available_qty', 0)
            actual = bin_entry.get('actual_qty', 0)
            reserved = bin_entry.get('reserved_qty', 0)
            
            # Normalizar nombres para comparación
            current_wh_normalized = (current_warehouse or '').upper().strip()
            wh_normalized = wh.upper().strip()
            
            # Solo incluir si NO es el almacén actual y tiene stock disponible
            if wh_normalized != current_wh_normalized and available > 0:
                other_warehouses.append({
                    'warehouse': wh,
                    'available_qty': available,
                    'actual_qty': actual,
                    'reserved_qty': reserved
                })
                total_in_others += available
        
        # Ordenar por cantidad disponible (mayor primero)
        other_warehouses.sort(key=lambda x: x['available_qty'], reverse=True)
        
        # Determinar si hay suficiente stock combinando almacenes
        has_enough = total_in_others >= required_qty if required_qty else total_in_others > 0
        
        return {
            'has_alternative': len(other_warehouses) > 0,
            'has_enough_combined': has_enough,
            'total_available_in_others': total_in_others,
            'required_qty': required_qty,
            'warehouses': other_warehouses[:5],  # Limitar a 5 almacenes
            'current_warehouse': current_warehouse
        }
    except Exception as e:
        print(f"--- Error checking stock in other warehouses: {e}")
        return {'has_alternative': False, 'warehouses': [], 'error': str(e)}


def handle_stock_error(submit_error, session, headers, processed_items, company):
    """
    Maneja errores de stock insuficiente, proporcionando información útil al usuario.
    
    Returns:
        tuple: (json_response, status_code) con información detallada del error
    """
    # Parsear el error de stock negativo
    stock_error_info = parse_negative_stock_error(submit_error)
    
    if not stock_error_info:
        # No es un error de stock, usar manejo genérico
        return handle_erpnext_error(submit_error, "Failed to submit invoice")
    
    print(f"--- Stock error detected: item={stock_error_info['item_code']}, "
          f"qty={stock_error_info['required_qty']}, warehouse={stock_error_info['warehouse']}")
    
    # Verificar si hay stock en otros almacenes
    alternative_stock = check_stock_in_other_warehouses(
        session, headers,
        stock_error_info['item_code'],
        stock_error_info['required_qty'],
        stock_error_info['warehouse'],
        company
    )
    
    # Construir mensaje de error detallado
    item_display = stock_error_info['item_name'] or stock_error_info['item_code']
    required = stock_error_info['required_qty'] or 'desconocida'
    warehouse_display = stock_error_info['warehouse'] or 'desconocido'
    
    # Remover sufijo de compañía del warehouse para display más limpio
    if warehouse_display and ' - ' in warehouse_display:
        warehouse_display = warehouse_display.rsplit(' - ', 1)[0]
    
    message_parts = [
        f"Stock insuficiente: se necesitan {required} unidades de '{item_display}' en almacén '{warehouse_display}'."
    ]
    
    # Si hay alternativas en otros almacenes
    if alternative_stock.get('has_alternative'):
        total_other = alternative_stock.get('total_available_in_others', 0)
        warehouses = alternative_stock.get('warehouses', [])
        
        if alternative_stock.get('has_enough_combined'):
            message_parts.append(
                f"Hay {total_other} unidades disponibles en otros almacenes que podrían utilizarse."
            )
        else:
            message_parts.append(
                f"Solo hay {total_other} unidades disponibles en otros almacenes (no alcanza)."
            )
        
        # Listar los almacenes alternativos
        if warehouses:
            alt_list = []
            for w in warehouses[:3]:  # Mostrar máximo 3
                wh_name = w['warehouse']
                if ' - ' in wh_name:
                    wh_name = wh_name.rsplit(' - ', 1)[0]
                alt_list.append(f"{wh_name}: {w['available_qty']} disp.")
            message_parts.append(f"Almacenes con stock: {', '.join(alt_list)}")
    else:
        message_parts.append("No hay stock disponible de este producto en ningún otro almacén.")
    
    message_parts.append("La factura se guardó como borrador. Ajuste el stock y vuelva a confirmar.")
    
    error_response = {
        "success": False,
        "message": " ".join(message_parts),
        "error_type": "negative_stock",
        "stock_error": {
            "item_code": stock_error_info['item_code'],
            "item_name": stock_error_info['item_name'],
            "required_qty": stock_error_info['required_qty'],
            "warehouse": stock_error_info['warehouse'],
            "alternative_warehouses": alternative_stock.get('warehouses', []),
            "total_available_elsewhere": alternative_stock.get('total_available_in_others', 0),
            "has_enough_combined": alternative_stock.get('has_enough_combined', False)
        },
        "draft_saved": True
    }
    
    return jsonify(error_response), 417



def apply_company_abbr_to_invoice_payload(invoice_payload, company_abbr):
    """Ensure customer and items use the company abbreviation suffix before ERPNext calls."""
    if not invoice_payload or not company_abbr:
        return

    if invoice_payload.get('customer'):
        invoice_payload['customer'] = add_company_abbr(invoice_payload['customer'], company_abbr)

    for item in invoice_payload.get('items', []):
        item_code = item.get('item_code')
        if item_code:
            item['item_code'] = add_company_abbr(item_code, company_abbr)

def log_sales_order_item_links(items, context_label):
    """Log a compact summary of sales order references present in the provided items list."""
    if not items:
        print(f"--- {context_label}: no items provided for Sales Order link check")
        return

    has_links = any(item.get('sales_order') or item.get('so_detail') for item in items)
    if not has_links:
        print(f"--- {context_label}: no Sales Order references detected ({len(items)} items)")
        return

    unique_orders = sorted({
        item.get('sales_order')
        for item in items
        if item.get('sales_order')
    })
    print(
        f"--- {context_label}: Sales Order link check "
        f"({len(items)} items, {len(unique_orders)} unique orders: {', '.join(unique_orders) or 'n/a'})"
    )
    for idx, item in enumerate(items, start=1):
        so = item.get('sales_order')
        so_detail = item.get('so_detail')
        flags = []
        if not so:
            flags.append("missing sales_order")
        if not so_detail:
            flags.append("missing so_detail")
        flag_suffix = f" [{' & '.join(flags)}]" if flags else ""
        print(
            f"---   #{idx} code={item.get('item_code', '')} qty={item.get('qty')} "
            f"so={so or '-'} so_detail={so_detail or '-'}{flag_suffix}"
        )

def log_sales_order_statuses(session, sales_orders, context_label):
    """Fetch each Sales Order and log its status/billing percentages right after invoice actions."""
    unique_orders = sorted({so for so in sales_orders if so})
    if not unique_orders:
        print(f"--- {context_label}: no Sales Orders detected for status verification")
        return

    print(f"--- {context_label}: checking Sales Order status for {len(unique_orders)} orders")
    orders_with_status = []
    for so_name in unique_orders:
        so_response, so_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Sales Order/{quote(so_name)}",
            operation_name=f"Get Sales Order Status ({so_name})"
        )

        if so_error or not so_response or so_response.status_code != 200:
            print(f"--- {context_label}: unable to fetch Sales Order {so_name} status")
            continue

        so_data = so_response.json().get('data', {})
        billing_status = so_data.get('billing_status')
        per_billed = float(so_data.get('per_billed') or 0)
        print(
            f"--- {context_label}: {so_name} status={so_data.get('status')} "
            f"billing_status={billing_status} "
            f"per_billed={per_billed} per_delivered={so_data.get('per_delivered')} "
            f"per_picked={so_data.get('per_picked')}"
        )
        orders_with_status.append({
            "name": so_name,
            "billing_status": billing_status,
            "per_billed": per_billed
        })

    if not orders_with_status:
        return

    pending = [
        o for o in orders_with_status
        if (o["billing_status"] or "").lower() not in ("fully billed", "closed")
        and o["per_billed"] < 99.99
    ]
    if pending:
        pending_names = ", ".join(o["name"] for o in pending)
        print(f"--- {context_label}: pending billing detected for {pending_names}")
    else:
        print(f"--- {context_label}: all linked Sales Orders are billed")

def check_items_valuation_rate(session, headers, items, company):
    """
    Verifica si los items de stock tienen valuation rate válido.
    Retorna una lista de items que necesitan valuation rate.
    """
    items_needing_valuation = []
    
    for item in items:
        item_code = item.get('item_code')
        if not item_code:
            continue
            
        # Verificar si es item de stock
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item/{quote(item_code)}",
            operation_name="Check Item Stock Status"
        )
        
        if error:
            continue
            
        item_data = response.json().get('data', {})
        
        # Solo verificar items de stock
        if item_data.get('is_stock_item') == 1:
                valuation_rate = item_data.get('valuation_rate', 0)
                
                # Considerar valuation rate válido si es > 0
                if not valuation_rate or valuation_rate <= 0:
                    items_needing_valuation.append({
                        'item_code': item_code,
                        'item_name': item_data.get('item_name', ''),
                        'valuation_rate': valuation_rate
                    })
    
    return items_needing_valuation

def find_purchase_price_for_item(session, headers, item_code, company):
    """
    Busca el precio de compra más reciente para un item.
    Retorna el precio si lo encuentra, None si no.
    """
    try:
        print("--- Purchase price search: started")
        
        # PRIMERA BÚSQUEDA: Precios de compra en listas de precios de la compañía
        filters_company = [
            ['item_code', '=', item_code],
            ['selling', '=', 0]  # Precios de compra
        ]
        
        # Obtener listas de precios de compra de la compañía
        price_list_filters = [
            ['buying', '=', 1],  # Lista de precios de compra
            ['company', '=', company]
        ]
        
        price_list_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Price List",
            params={
                'filters': json.dumps(price_list_filters),
                'fields': json.dumps(["name"])
            },
            operation_name="Get Company Purchase Price Lists"
        )
        
        if not error and price_list_response.status_code == 200:
            price_lists = price_list_response.json().get('data', [])
            if price_lists:
                price_list_names = [pl['name'] for pl in price_lists]
                filters_company.append(['price_list', 'in', price_list_names])
                print("--- Purchase price search: filtering by company lists")
        
        params_company = {
            'fields': json.dumps(['price_list_rate', 'currency', 'price_list', 'valid_from']),
            'filters': json.dumps(filters_company),
            'order_by': 'valid_from desc',  # Más reciente primero
            'limit_page_length': 1
        }
        
        response_company, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=params_company,
            operation_name="Get Company Item Prices"
        )
        
        if not error and response_company.status_code == 200:
            data_company = response_company.json().get('data', [])
            if data_company:
                price_entry = data_company[0]
                print("--- Purchase price search: found in company list")
                return {
                    'rate': price_entry.get('price_list_rate', 0),
                    'currency': price_entry.get('currency'),
                    'price_list': price_entry.get('price_list', '')
                }
        
        # SEGUNDA BÚSQUEDA: Precios de compra en TODAS las listas de precios de compra (sin filtrar por compañía)
        print("--- Purchase price search: searching all lists")
        filters_all = [
            ['item_code', '=', item_code],
            ['selling', '=', 0]  # Precios de compra
        ]
        
        params_all = {
            'fields': json.dumps(['price_list_rate', 'currency', 'price_list', 'valid_from']),
            'filters': json.dumps(filters_all),
            'order_by': 'valid_from desc',  # Más reciente primero
            'limit_page_length': 1
        }
        
        response_all, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Price",
            params=params_all,
            operation_name="Get All Item Prices"
        )
        
        if not error and response_all.status_code == 200:
            data_all = response_all.json().get('data', [])
            if data_all:
                price_entry = data_all[0]
                print("--- Purchase price search: found in any list")
                return {
                    'rate': price_entry.get('price_list_rate', 0),
                    'currency': price_entry.get('currency'),
                    'price_list': price_entry.get('price_list', '')
                }
        
        print("--- Purchase price search: not found")
    
    except Exception as e:
        print("--- Purchase price search: error")
    
    return None

def get_metodo_numeracion_field(invoice_type):
    """
    Determina qué campo de metodo_numeracion usar basado en el tipo de comprobante
    """
    if not invoice_type:
        return 'metodo_numeracion_factura_venta'
    
    invoice_type_lower = invoice_type.lower()
    
    if 'crédito' in invoice_type_lower or 'credito' in invoice_type_lower:
        return 'metodo_numeracion_nota_credito'
    elif 'débito' in invoice_type_lower or 'debito' in invoice_type_lower:
        return 'metodo_numeracion_nota_debito'
    else:
        return 'metodo_numeracion_factura_venta'


def get_next_confirmed_invoice_number(session, headers, metodo_numeracion):
    """
    Wrapper para compatibilidad: convierte metodo_numeracion a talonario_name y letra
    """
    try:
        # Extraer información del método de numeración
        # Formato: FE-FAC-A-00003-00000001
        parts = metodo_numeracion.split('-')
        if len(parts) < 5:
            print("--- Invoice numbering: invalid format")
            return 1
            
        # Extraer letra (posición 2) y punto de venta (posición 3)
        letra = parts[2]  # A, B, M, etc.
        punto_venta = parts[3]  # 00003
        
        # Buscar el talonario por punto de venta
        # Este es un approach simplificado - en producción podrías cachear esto
        search_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params={
                'filters': json.dumps([["punto_de_venta", "=", int(punto_venta)]]),
                'fields': json.dumps(["name"])
            },
            operation_name="Find Talonario by Punto de Venta"
        )
        
        if not error and search_response.status_code == 200:
            search_data = search_response.json()
            if search_data.get('data') and len(search_data['data']) > 0:
                talonario_name = search_data['data'][0]['name']
                return get_next_confirmed_number_for_talonario(session, headers, talonario_name, letra)
        
        print("--- Invoice numbering: talonario not found")
        return 1
        
    except Exception as e:
        print("--- Invoice numbering: wrapper error")
        return 1

def update_talonario_last_number(session, headers, invoice_name, metodo_numeracion):
    """
    Actualiza el campo 'ultimo_numero_utilizado' del talonario correspondiente
    basado en el nombre de la factura generada.
    """
    try:
        log_search_operation(f"Actualizando contador de talonario para factura: {invoice_name}")
        
        # Extraer el número del final del nombre de la factura
        parts = invoice_name.split('-')
        if len(parts) >= 5:
            # El último parte es el número (ej: 0000000100006)
            last_part = parts[-1]
            
            # Tomar los PRIMEROS 8 dígitos (no los últimos)
            if len(last_part) >= 8:
                number_str = last_part[:8]  # Primeros 8 dígitos
            else:
                number_str = last_part  # Si es menor a 8, usar todo
                
            log_search_operation(f"Última parte completa: {last_part}")
            log_search_operation(f"Primeros 8 dígitos para número: {number_str}")
            
            try:
                # Convertir a entero para remover ceros a la izquierda
                last_number = int(number_str)
                log_search_operation(f"Número extraído de la factura: {last_number}")
            except ValueError:
                log_error(f"No se pudo convertir '{number_str}' a número", "update_talonario_last_number")
                return
        else:
            log_error(f"Formato de nombre de factura inválido: {invoice_name}", "update_talonario_last_number")
            return
            
        # Buscar el talonario
        search_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params={
                'filters': json.dumps([["metodo_numeracion_factura_venta", "=", metodo_numeracion]]),
                'fields': json.dumps(["name"])
            },
            operation_name="Find Talonario by Metodo Numeracion"
        )
        
        if error or search_response.status_code != 200:
            log_error(f"Error buscando talonario: {search_response.status_code}", "update_talonario_last_number")
            return
            
        search_data = search_response.json()
        if not search_data.get('data') or len(search_data['data']) == 0:
            log_error(f"No se encontró talonario con método: {metodo_numeracion}", "update_talonario_last_number")
            return
            
        talonario_name = search_data['data'][0]['name']
        log_search_operation(f"Talonario encontrado: {talonario_name}")
        
        # Actualizar el campo ultimo_numero_utilizado
        update_response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            data={"ultimo_numero_utilizado": last_number},
            operation_name="Update Talonario Last Number"
        )
        
        if not error and update_response.status_code in [200, 202]:
            log_search_operation(f"Talonario {talonario_name} actualizado: último número {last_number}")
        else:
            log_error(f"Error actualizando talonario: {update_response.status_code} - {update_response.text}", "update_talonario_last_number")
            
    except Exception as e:
        log_error(f"Error actualizando talonario: {str(e)}", "update_talonario_last_number")
        import traceback
        traceback.print_exc()

@invoices_bp.route('/api/invoices', methods=['POST'])
def create_invoice():
    """Crear una nueva factura de venta con procesamiento completo de items y cuentas"""
    log_function_call("create_invoice")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener datos del frontend
    invoice_data = request.get_json()

    if not invoice_data or 'data' not in invoice_data:
        return jsonify({"success": False, "message": "Datos de factura requeridos"}), 400

    data = invoice_data['data']
    raw_items = data.get('items', [])
    log_sales_order_item_links(raw_items, "Invoice payload (incoming)")
    
    # Log detallado de cada item incluyendo warehouse
    for idx, item in enumerate(raw_items, start=1):
        wh = item.get('warehouse', '(no warehouse)')
        so = item.get('sales_order', '(no SO)')
        so_detail = item.get('so_detail', '(no so_detail)')
        print(f"---   Item #{idx}: code={item.get('item_code', '')} warehouse={wh} SO={so} so_detail={so_detail}")
    
    print("--- Invoice payload: processing items")

    # Validación básica
    if not data.get('customer'):
        return jsonify({"success": False, "message": "Cliente requerido"}), 400
    if not data.get('company'):
        return jsonify({"success": False, "message": "Compañía requerida"}), 400
    if not data.get('items') or len(data['items']) == 0:
        return jsonify({"success": False, "message": "Al menos un item requerido"}), 400

    company_abbr = get_company_abbr(session, headers, data['company'])
    if not company_abbr:
        return jsonify({
            "success": False,
            "message": f"No se pudo obtener la abreviatura para la compania {data['company']}"
        }), 400

    apply_company_abbr_to_invoice_payload(data, company_abbr)

    try:
        # Paso 1: Obtener el mapa de templates de impuestos para la compañía
        tax_map = get_tax_template_map(session, headers, data['company'], transaction_type='sales')

        # Paso 1.1: Obtener defaults de la compañía (incluye almacén por defecto)
        company_defaults = get_company_defaults(data['company'], session, headers)
        if not company_defaults:
            return jsonify({"success": False, "message": "Error obteniendo configuración de compañía"}), 400
        
        # Obtener moneda por defecto de la empresa
        default_currency = get_company_default_currency(session, headers, data['company'])
        if not default_currency:
            return jsonify({
                "success": False,
                "message": f"La empresa '{data['company']}' no tiene moneda por defecto definida (default_currency)"
            }), 400
        
        # Paso 2: Procesar items y crear items libres si es necesario
        processed_items = []
        has_stock_items = False
        linked_sales_orders = False

        for item in data['items']:
            processed_item = process_invoice_item(item, session, headers, data['company'], tax_map, data.get('customer'))
            if processed_item:
                if processed_item.get('sales_order') or processed_item.get('so_detail'):
                    linked_sales_orders = True
                    print(f"--- Invoice item linked to Sales Order: {processed_item.get('sales_order')} (so_detail={processed_item.get('so_detail')})")

                # Verificar si este item es de stock
                item_response, error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Item/{processed_item['item_code']}",
                    operation_name="Check Item Stock Status in Create"
                )
                
                if not error and item_response.status_code == 200:
                    item_data = item_response.json()['data']
                    if item_data.get('is_stock_item') == 1:
                        has_stock_items = True
                        print("--- Invoice items: stock item detected")
                        # Verificar si el processed_item ya tiene warehouse (puede venir de la Sales Order)
                        if not processed_item.get('warehouse') or not processed_item.get('warehouse').strip():
                            # Buscar default_warehouse en item_defaults para la compañía
                            default_warehouse = None
                            for default in item_data.get('item_defaults', []):
                                if default.get('company') == data['company']:
                                    default_warehouse = default.get('default_warehouse')
                                    break
                            if not default_warehouse:
                                default_warehouse = company_defaults.get('default_warehouse')

                            if default_warehouse:
                                processed_item['warehouse'] = default_warehouse
                                print("--- Invoice items: using default warehouse")
                            else:
                                error_msg = f"El ítem {processed_item['item_code']} es un ítem de stock y requiere un almacén asignado"
                                print("--- Invoice items: warehouse required")
                                return jsonify({"success": False, "message": error_msg}), 400
                processed_items.append(processed_item)
            else:
                return jsonify({"success": False, "message": f"Error procesando item: {item.get('item_name', 'Sin nombre')}"}), 400

        log_sales_order_item_links(processed_items, "Invoice payload (processed)")

        # Determinar si la factura debe actualizar el stock
        # IMPORTANTE: ERPNext NO permite update_stock=1 cuando hay items vinculados a Delivery Note.
        linked_delivery_notes = sorted({
            item.get('delivery_note')
            for item in processed_items
            if item.get('delivery_note')
        })
        has_delivery_note_links = any(
            item.get('delivery_note') or item.get('dn_detail')
            for item in processed_items
        )

        if has_delivery_note_links:
            update_stock = 0
            print(
                f"--- Invoice stock: forcing update_stock=0 "
                f"(linked_delivery_notes: {linked_delivery_notes or 'n/a'})"
            )
        else:
            update_stock = 1 if has_stock_items else 0
            print("--- Invoice stock: configured")

        # Paso 3: Construir y crear el borrador de la factura
        # Validar y ajustar fechas para evitar error de ERPNext
        posting_date = data.get('posting_date', '')
        due_date = data.get('due_date', '')
        
        # Función auxiliar para ajustar fechas
        def adjust_due_date_if_needed(posting, due):
            """Ajusta due_date si es igual o anterior a posting_date"""
            from datetime import datetime, timedelta
            
            if not posting or not due:
                return due
            
            try:
                posting_dt = datetime.strptime(posting.strip(), "%Y-%m-%d")
                due_dt = datetime.strptime(due.strip(), "%Y-%m-%d")
                
                # Si due_date es igual o anterior a posting_date, agregar un día
                if due_dt <= posting_dt:
                    adjusted_dt = posting_dt + timedelta(days=1)
                    adjusted_date = adjusted_dt.strftime("%Y-%m-%d")
                    return adjusted_date
                else:
                    return due
            except (ValueError, AttributeError) as e:
                return due
        
        # Ajustar due_date si es necesario
        due_date = adjust_due_date_if_needed(posting_date, due_date)
        
        # Determinar la cuenta por cobrar (cliente específico o compañía por defecto)
        customer_account = get_customer_receivable_account(data['customer'], data['company'], session, headers)
        debit_to_account = customer_account if customer_account else company_defaults.get('default_receivable_account', '')
        
        print("--- Invoice account: configured")
        
        if linked_sales_orders:
            linked_orders = sorted({
                item.get('sales_order')
                for item in processed_items
                if item.get('sales_order')
            })
            print(f"--- Invoice contains linked Sales Order items - forcing sales order billing update ({', '.join(linked_orders)})")
        else:
            print("--- Invoice has no linked Sales Order items")

        invoice_body = {
            "customer": data['customer'],
            "company": data['company'],
            "posting_date": posting_date,
            "due_date": due_date,
            "debit_to": debit_to_account,
            "update_stock": update_stock,
            "items": processed_items,
            "update_billed_amount_in_sales_order": 1 if linked_sales_orders else 0
        }
        if linked_sales_orders:
            print(f"--- Invoice Sales Order payload: update_billed_amount_in_sales_order={invoice_body['update_billed_amount_in_sales_order']}")

        # Agregar naming_series si viene del frontend (método de numeración personalizado)
        metodo_numeracion_field = get_metodo_numeracion_field(data.get('invoice_type', ''))
        metodo_numeracion = data.get(metodo_numeracion_field, '').strip()
        
        # Si no se encuentra en el campo específico, buscar en metodo_numeracion_factura_venta como fallback
        if not metodo_numeracion:
            metodo_numeracion = data.get('metodo_numeracion_factura_venta', '').strip()
        
        # Determinar si es borrador
        save_as_draft = data.get('save_as_draft', False)
        docstatus = data.get('docstatus', 1)
        is_draft = save_as_draft or docstatus == 0
        
        # Validar método de numeración solo para facturas confirmadas
        if not is_draft:
            if not metodo_numeracion:
                return jsonify({"success": False, "message": "Método de numeración de factura requerido para facturas confirmadas"}), 400
            
            # Validar formato del método de numeración
            if len(metodo_numeracion.split('-')) < 5:
                return jsonify({"success": False, "message": "Formato de método de numeración inválido"}), 400
        
        # LÓGICA DE NUMERACIÓN: Borradores pueden usar numeración temporal, confirmadas usan método personalizado
        if is_draft:
            # Para borradores: verificar si hay un nombre temporal sugerido desde el frontend
            temp_name = data.get('temp_name', '').strip()
            if temp_name:
                print("--- Invoice numbering: draft with temp name")
                # Usar el nombre temporal para identificar el tipo de comprobante
                invoice_body['name'] = temp_name
                invoice_body['naming_series'] = temp_name
            else:
                print("--- Invoice numbering: draft with native numbering")
                # No setear name ni naming_series para que ERPNext use su numeración automática
        else:
            # Para facturas confirmadas: usar el método de numeración personalizado
            print("--- Invoice numbering: confirmed with custom series")
            invoice_body['name'] = metodo_numeracion
            invoice_body['naming_series'] = metodo_numeracion

        # Agregar campos opcionales si existen (excluyendo 'status' que se maneja con docstatus)
        for field in ['invoice_number', 'punto_de_venta', 'currency', 'exchange_rate', 'title', 'invoice_type', 'voucher_type_code', 'invoice_category', 'price_list', 'discount_amount', 'net_gravado', 'net_no_gravado', 'total_iva', 'percepcion_iva', 'percepcion_iibb', 'sales_condition_type', 'sales_condition_amount', 'sales_condition_days', 'sales_condition']:
            if data.get(field):
                invoice_body[field] = data[field]

        # Si no se especificó moneda, usar la moneda por defecto de la empresa
        if not data.get('currency'):
            invoice_body['currency'] = default_currency

        # El título se guarda en el campo 'description' en ERPNext
        if data.get('title'):
            invoice_body['description'] = data['title']

        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Sales Invoice",
            data=invoice_body,
            operation_name="Create Invoice"
        )

        if create_error:
            return handle_erpnext_error(create_error, "Failed to create invoice")

        draft_result = create_response.json()
        invoice_name = draft_result['data']['name']
        log_success(f"Borrador creado exitosamente: {invoice_name}", "create_invoice")
        log_sales_order_item_links(draft_result.get('data', {}).get('items', []), "ERPNext draft invoice response")

        # SOLO actualizar el último número utilizado en el talonario si NO es borrador
        if not is_draft:
            conditional_log(f"FACTURA CONFIRMADA: Actualizando contador del talonario")
            update_talonario_last_number(session, headers, invoice_name, metodo_numeracion)
        else:
            conditional_log(f"BORRADOR: NO actualizando contador del talonario (número temporal)")

        # Paso 4: Confirmar la factura solo si NO es borrador
        save_as_draft = data.get('save_as_draft', False)
        docstatus = data.get('docstatus', 1)
        
        conditional_log(f"BACKEND STATUS CHECK: save_as_draft={save_as_draft}, docstatus={docstatus}")
        
        if save_as_draft or docstatus == 0:
            # Mantener como borrador
            log_success(f"Manteniendo factura como borrador: {invoice_name}", "create_invoice")
            return jsonify({
                "success": True,
                "message": "Factura creada como borrador exitosamente",
                "data": draft_result['data']
            })
        else:
            # Antes de confirmar, verificar si hay items sin valuation rate
            items_needing_valuation = check_items_valuation_rate(session, headers, processed_items, data['company'])
            
            if items_needing_valuation:
                print("--- Invoice valuation: items need valuation rate")
                
                # Buscar precios de compra para estos items
                items_with_purchase_prices = []
                items_without_prices = []
                
                for item in items_needing_valuation:
                    purchase_price = find_purchase_price_for_item(session, headers, item['item_code'], data['company'])
                    if purchase_price:
                        items_with_purchase_prices.append({
                            'item_code': item['item_code'],
                            'item_name': item['item_name'],
                            'purchase_price': purchase_price
                        })
                    else:
                        items_without_prices.append({
                            'item_code': item['item_code'],
                            'item_name': item['item_name']
                        })
                
                # Crear mensaje informativo
                message_parts = ["Factura creada como borrador porque algunos items requieren configuración:"]
                
                if items_without_prices:
                    items_str = ', '.join([f"{item.get('item_code', '')} ({item.get('item_name', '')})" for item in items_without_prices])
                    message_parts.append(f"• Items sin precio de compra: {items_str}")
                    message_parts.append("  Debe cargar el precio de compra en la lista de precios correspondiente antes de confirmar.")
                
                if items_with_purchase_prices:
                    items_str = ', '.join([f"{item.get('item_code', '')} ({item.get('item_name', '')})" for item in items_with_purchase_prices])
                    message_parts.append(f"• Items con precio de compra disponible: {items_str}")
                    message_parts.append("  Considere actualizar el valuation rate del item con el precio de compra encontrado.")
                
                message_parts.append("La factura se mantendrá como borrador hasta que se resuelvan estos temas.")
                
                log_success(f"Factura mantenida como borrador por items sin valuation rate: {invoice_name}", "create_invoice")
                return jsonify({
                    "success": True,
                    "message": " ".join(message_parts),
                    "data": draft_result['data'],
                    "warning": {
                        "type": "valuation_rate_missing",
                        "items_without_prices": items_without_prices,
                        "items_with_purchase_prices": items_with_purchase_prices
                    }
                })
            
            # Confirmar la factura (submit)
            submit_response, submit_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                data={"docstatus": 1},
                operation_name="Submit Invoice"
            )

            if submit_error:
                # Verificar si es un error de stock insuficiente
                stock_error_info = parse_negative_stock_error(submit_error)
                if stock_error_info:
                    print(f"--- Invoice create: NegativeStockError detected for {stock_error_info['item_code']}")
                    # Devolver error estructurado con información de stock alternativo
                    # NO eliminar el borrador - el usuario lo necesita para corregir
                    return handle_stock_error(submit_error, session, headers, processed_items, data.get('company', ''))
                else:
                    return handle_erpnext_error(submit_error, "Failed to submit invoice")

            final_result = submit_response.json()
            log_success(f"Factura confirmada exitosamente: {invoice_name}", "create_invoice")
            log_sales_order_item_links(final_result.get('data', {}).get('items', []), "ERPNext submit invoice response")
            if linked_sales_orders:
                sales_order_names = [item.get('sales_order') for item in processed_items]
                log_sales_order_statuses(session, sales_order_names, "Invoice submit follow-up")

            return jsonify({
                "success": True,
                "message": "Factura creada y confirmada exitosamente",
                "data": final_result['data']
            })

    except Exception as e:
        log_error(f"Error creando factura: {str(e)}", "create_invoice")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500














@invoices_bp.route('/api/invoices/<invoice_name>', methods=['PUT'])
def update_invoice(invoice_name):
    """
    Modificar una factura existente.
    CORREGIDO: Fuerza la moneda a ARS, añade la plantilla de impuestos
    general y construye el body dinámicamente.
    """
    print("--- Invoice update: started")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    data = request.get_json().get('data', {})

    company = data.get('company')
    if not company:
        # Intentar obtener la compañía de la factura existente
        try:
            invoice_response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                operation_name="Get Existing Invoice Company"
            )
            
            if not error and invoice_response.status_code == 200:
                existing_invoice = invoice_response.json()['data']
                company = existing_invoice.get('company')
                if company:
                    data['company'] = company
                else:
                    return jsonify({"success": False, "message": "No se pudo determinar la compañía de la factura existente"}), 400
            else:
                return jsonify({"success": False, "message": "Error obteniendo la factura existente para determinar compañía"}), 400
        except Exception as e:
            print("--- Invoice update: error getting company")
            return jsonify({"success": False, "message": "Error interno obteniendo compania"}), 500

    company_abbr = get_company_abbr(session, headers, company)
    if not company_abbr:
        return jsonify({
            "success": False,
            "message": f"No se pudo obtener la abreviatura para la compania {company}"
        }), 400

    apply_company_abbr_to_invoice_payload(data, company_abbr)

    try:
        tax_map = get_tax_template_map(session, headers, company, transaction_type='sales')
        
        # Obtener el docstatus actual
        invoice_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
            operation_name="Get Current Invoice Docstatus"
        )

        if error or invoice_response.status_code == 404:
            return jsonify({"success": False, "message": f"Factura {invoice_name} no encontrada - puede que ya haya sido eliminada"}), 404
        elif invoice_response.status_code != 200:
            return jsonify({"success": False, "message": f"Error obteniendo factura: {invoice_response.text if hasattr(invoice_response, 'text') else 'Error desconocido'}"}), 400
            return jsonify({"success": False, "message": f"Factura {invoice_name} no encontrada - puede que ya haya sido eliminada"}), 404
        elif invoice_response.status_code != 200:
            return jsonify({"success": False, "message": f"Error obteniendo factura: {invoice_response.text}"}), 400

        current_invoice = invoice_response.json()['data']
        docstatus = current_invoice.get('docstatus', 0)
        print("--- Invoice status: checked")

        if docstatus == 0:  # Borrador
            return update_draft_invoice(invoice_name, data, session, headers)
        elif docstatus == 1:  # Confirmada
            return update_confirmed_invoice(invoice_name, data, session, headers)
        else:
            return jsonify({"success": False, "message": "Estado de factura no soportado"}), 400

    except requests.exceptions.HTTPError as e:
        print("--- Invoice update: HTTP error")
        return jsonify({"success": False, "message": f"Error de ERPNext: {e.response.text}"}), 500
    except Exception as e:
        print("--- Invoice update: critical error")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@invoices_bp.route('/api/invoices/<invoice_name>', methods=['DELETE'])
def delete_invoice(invoice_name):
    """Eliminar/cancelar una factura - borradores se eliminan, confirmadas se cancelan"""
    print("--- Invoice delete: started")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Primero obtener el estado de la factura para saber si es borrador o confirmada
        # Extract fields to avoid nested quotes in f-string
        fields_str = '["docstatus"]'
        invoice_response, invoice_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}?fields={quote(fields_str)}",
            operation_name="Get Invoice Status for Deletion"
        )

        if invoice_error:
            return handle_erpnext_error(invoice_error, "Failed to get invoice status")

        invoice_data = invoice_response.json()['data']
        docstatus = invoice_data.get('docstatus', 0)

        print("--- Invoice delete: status checked")

        if docstatus == 0:
            # Es un borrador - usar DELETE directo
            print("--- Invoice delete: deleting draft")
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                operation_name="Delete Draft Invoice"
            )

            if delete_error:
                return handle_erpnext_error(delete_error, "Failed to delete draft invoice")

            print("--- Invoice delete: draft deleted successfully")
            return jsonify({
                "success": True,
                "message": "Factura borrador eliminada exitosamente"
            })

        elif docstatus == 1:
            # Está confirmada - usar cancel
            print("--- Invoice delete: canceling confirmed")
            result = cancel_invoice(invoice_name, session, headers)
            return result

        else:
            # Estado desconocido
            return jsonify({"success": False, "message": f"Estado de factura desconocido (docstatus: {docstatus})"}), 400

    except Exception as e:
        print("--- Invoice delete: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@invoices_bp.route('/api/invoices/bulk-removal', methods=['POST'])
def bulk_remove_sales_invoices():
    """
    Permite eliminar o cancelar masivamente facturas de venta.
    docstatus 0 -> DELETE, docstatus 1 -> cancel (docstatus 2)
    """
    payload = request.get_json() or {}
    invoices = payload.get('invoices')

    if not invoices or not isinstance(invoices, list):
        return jsonify({"success": False, "message": "Debe proporcionar la lista de facturas a procesar"}), 400

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    summary = {"deleted": 0, "cancelled": 0, "failed": 0}
    results = []

    def resolve_docstatus(invoice_name, provided_status=None):
        if provided_status is not None:
            return provided_status

        fields_str = '["docstatus"]'
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}?fields={quote(fields_str)}",
            operation_name=f"Get docstatus for '{invoice_name}' (bulk removal)"
        )
        if error:
            raise RuntimeError(f"Error obteniendo docstatus: {error}")
        if response.status_code != 200:
            raise RuntimeError(f"Error obteniendo docstatus: {response.text}")
        data = response.json().get('data', {})
        return data.get('docstatus', 0)

    for entry in invoices:
        invoice_name = entry.get('name') if isinstance(entry, dict) else entry
        provided_status = entry.get('docstatus') if isinstance(entry, dict) else None

        if not invoice_name:
            summary["failed"] += 1
            results.append({
                "name": invoice_name,
                "success": False,
                "message": "Nombre de factura inválido"
            })
            continue

        try:
            docstatus = resolve_docstatus(invoice_name, provided_status)

            if docstatus == 0:
                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                    operation_name=f"Delete draft sales invoice '{invoice_name}' (bulk)"
                )
                if delete_error:
                    raise RuntimeError(delete_error)
                if delete_response.status_code not in [200, 202, 204]:
                    raise RuntimeError(delete_response.text)

                summary["deleted"] += 1
                results.append({
                    "name": invoice_name,
                    "success": True,
                    "action": "deleted"
                })

            elif docstatus == 1:
                cancel_response, cancel_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.cancel",
                    data={"doctype": "Sales Invoice", "name": invoice_name},
                    operation_name=f"Cancel sales invoice '{invoice_name}' (bulk)"
                )
                if cancel_error:
                    raise RuntimeError(cancel_error)
                if cancel_response.status_code != 200:
                    raise RuntimeError(cancel_response.text)

                summary["cancelled"] += 1
                results.append({
                    "name": invoice_name,
                    "success": True,
                    "action": "cancelled"
                })
            else:
                summary["failed"] += 1
                results.append({
                    "name": invoice_name,
                    "success": False,
                    "message": f"Docstatus {docstatus} no soportado para eliminación masiva"
                })

        except Exception as exc:
            summary["failed"] += 1
            results.append({
                "name": invoice_name,
                "success": False,
                "message": str(exc)
            })

    success = summary["failed"] == 0
    message = (
        f"Procesadas {len(invoices)} facturas "
        f"(eliminadas: {summary['deleted']}, canceladas: {summary['cancelled']}, con error: {summary['failed']})"
    )
    status_code = 200 if success else (207 if summary["deleted"] or summary["cancelled"] else 400)

    return jsonify({
        "success": success,
        "message": message,
        "summary": summary,
        "results": results
    }), status_code


def update_draft_invoice(invoice_name, data, session, headers):
    """Actualizar una factura en borrador directamente"""
    try:
        # Verificar si se quiere cancelar la factura
        requested_status = data.get('status', '').lower()
        requested_docstatus = data.get('docstatus', 0)
        
        if requested_status in ['cancelada', 'cancelled'] or requested_docstatus == 2:
            # Factura en borrador que se quiere cancelar - eliminar en lugar de cancelar
            print("--- Invoice draft: canceling by deleting")
            print("--- Invoice draft: deleting")
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                operation_name="Delete Draft Invoice on Cancel"
            )

            if delete_error:
                return handle_erpnext_error(delete_error, "Failed to delete draft invoice")

            print("--- Invoice draft: deleted successfully")
            return jsonify({
                "success": True,
                "message": "Factura borrador eliminada exitosamente"
            })

        # Obtener el mapa de templates de impuestos
        tax_map = get_tax_template_map(session, headers, data.get('company', ''), transaction_type='sales')
        
        # Obtener moneda por defecto de la empresa
        default_currency = get_company_default_currency(session, headers, data.get('company', ''))
        if not default_currency:
            company_name = data.get('company', '')
            return jsonify({
                "success": False,
                "message": f"La empresa '{company_name}' no tiene moneda por defecto definida (default_currency)"
            }), 400
        
        # Procesar items (el warehouse ya viene con abbr desde process_invoice_item)
        # NOTA: Las facturas con Sales Order NO pueden ser borradores, así que no necesitamos
        # la lógica compleja de verificación de warehouse aquí
        processed_items = []
        for item in data.get('items', []):
            processed_item = process_invoice_item(item, session, headers, data.get('company', ''), tax_map, data.get('customer'))
            if processed_item:
                processed_items.append(processed_item)
            else:
                return jsonify({"success": False, "message": f"Error procesando item: {item.get('item_name', 'Sin nombre')}"}), 400

        # Función auxiliar para ajustar fechas
        def adjust_due_date_if_needed(posting, due):
            """Ajusta due_date si es igual o anterior a posting_date"""
            from datetime import datetime, timedelta
            
            if not posting or not due:
                return due
            
            try:
                posting_dt = datetime.strptime(posting.strip(), "%Y-%m-%d")
                due_dt = datetime.strptime(due.strip(), "%Y-%m-%d")
                
                # Si due_date es igual o anterior a posting_date, agregar un día
                # NOTA: Comparación con <= para asegurar que due_date sea SIEMPRE mayor que posting_date
                if due_dt <= posting_dt:
                    adjusted_dt = posting_dt + timedelta(days=1)
                    adjusted_date = adjusted_dt.strftime("%Y-%m-%d")
                    print(f"--- Invoice dates: due date adjusted from {due} to {adjusted_date} (posting_date={posting})")
                    return adjusted_date
                else:
                    print(f"--- Invoice dates: due date OK ({due} > {posting})")
                    return due
            except (ValueError, AttributeError) as e:
                print(f"--- Invoice dates: invalid format in draft update - {e}")
                return due

        update_body = {
            "customer": data.get('customer'),
            "company": data.get('company'),
            "items": processed_items,
            "docstatus": data.get('docstatus', 0)
        }

        # LÓGICA ESPECIAL: Manejar confirmación de borrador (cambio de docstatus 0 -> 1)
        requested_docstatus = data.get('docstatus', 0)
        requested_status = data.get('status', '').lower()
        is_confirming_draft = (
            requested_docstatus == 1 or 
            requested_status in ['confirmada', 'submitted']
        )
        
        if is_confirming_draft:
            print("--- Invoice draft: confirming")
            
            # 1. Obtener el método de numeración de los datos (siempre debe estar presente para confirmación)
            metodo_numeracion_field = get_metodo_numeracion_field(data.get('invoice_type', ''))
            metodo_numeracion = data.get(metodo_numeracion_field, '').strip()
            
            # Si no se encuentra en el campo específico, buscar en metodo_numeracion_factura_venta como fallback
            if not metodo_numeracion:
                metodo_numeracion = data.get('metodo_numeracion_factura_venta', '').strip()
            
            if not metodo_numeracion:
                return jsonify({"success": False, "message": "Método de numeración requerido para confirmar borrador"}), 400
            
            print("--- Invoice draft: generating final number")
            
            # 2. Extraer el número del método de numeración enviado por el frontend (ya calculado)
            parts = metodo_numeracion.split('-')
            if len(parts) >= 5:
                next_number = int(parts[4])  # El número ya viene calculado por el frontend
                print(f"--- Invoice draft: using frontend-calculated number: {next_number}")
            else:
                # Fallback: calcular el siguiente número si el formato es inválido
                next_number = get_next_confirmed_invoice_number(session, headers, metodo_numeracion)
                print(f"--- Invoice draft: using backend-calculated number: {next_number}")
            
            # 3. Crear el nuevo nombre definitivo
            parts = metodo_numeracion.split('-')
            talonario_prefix = '-'.join(parts[:-1])
            new_invoice_name = f"{talonario_prefix}-{next_number:08d}"
            print("--- Invoice draft: new name generated")
            
            # 4. Crear una nueva factura con el nombre definitivo y eliminar el borrador
            # Primero obtener todos los datos del borrador actual
            current_invoice_response, current_invoice_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                operation_name="Get Current Draft Invoice Data"
            )

            if current_invoice_error:
                return handle_erpnext_error(current_invoice_error, "Failed to get current draft invoice data")

            current_invoice_data = current_invoice_response.json()['data']

            # Preparar los datos para la nueva factura confirmada
            new_invoice_data = current_invoice_data.copy()
            new_invoice_data['name'] = new_invoice_name
            new_invoice_data['naming_series'] = new_invoice_name
            new_invoice_data['docstatus'] = 0  # Crear como borrador y luego confirmar
            new_invoice_data[metodo_numeracion_field] = new_invoice_name

            for field in ['posting_date', 'due_date', 'currency', 'title', 'invoice_type', 'voucher_type_code', 'invoice_category', 'price_list', 'discount_amount', 'net_gravado', 'net_no_gravado', 'total_iva', 'percepcion_iva', 'percepcion_iibb', 'sales_condition_type', 'sales_condition_amount', 'sales_condition_days', 'sales_condition']:
                if data.get(field):
                    new_invoice_data[field] = data[field]

            new_invoice_data['items'] = processed_items
            linked_sales_orders = any(
                item.get('sales_order') or item.get('so_detail') for item in processed_items
            )
            new_invoice_data['update_billed_amount_in_sales_order'] = 1 if linked_sales_orders else 0
            if linked_sales_orders:
                linked_orders = sorted({
                    item.get('sales_order')
                    for item in processed_items
                    if item.get('sales_order')
                })
                print(f"--- Draft confirmation: linked Sales Orders detected ({', '.join(linked_orders)})")
                log_sales_order_item_links(processed_items, "Draft confirmation payload (POST)")
                print(f"--- Draft confirmation payload: update_billed_amount_in_sales_order={new_invoice_data['update_billed_amount_in_sales_order']}")
            else:
                print("--- Draft confirmation: no linked Sales Orders detected")

            # Antes de confirmar, verificar si hay items sin valuation rate
            items_needing_valuation = check_items_valuation_rate(session, headers, processed_items, data.get('company', ''))
            
            if items_needing_valuation:
                print("--- Invoice valuation: items need valuation rate in update")
                
                # Buscar precios de compra para estos items y actualizar valuation rate si es posible
                items_with_purchase_prices = []
                items_without_prices = []
                
                for item in items_needing_valuation:
                    purchase_price = find_purchase_price_for_item(session, headers, item['item_code'], data.get('company', ''))
                    if purchase_price and purchase_price['rate'] > 0:
                        # Intentar actualizar el valuation rate del item con el precio de compra
                        try:
                            update_valuation_body = {
                                "valuation_rate": purchase_price['rate']
                            }
                            
                            update_response, update_error = make_erpnext_request(
                                session=session,
                                method="PUT",
                                endpoint=f"/api/resource/Item/{quote(item['item_code'])}",
                                data=update_valuation_body,
                                operation_name="Update Item Valuation Rate"
                            )
                            
                            if not update_error and update_response.status_code == 200:
                                print("--- Invoice valuation: rate updated automatically")
                                items_with_purchase_prices.append({
                                    'item_code': item['item_code'],
                                    'item_name': item['item_name'],
                                    'purchase_price': purchase_price,
                                    'valuation_updated': True
                                })
                            else:
                                print("--- Invoice valuation: failed to update rate")
                                items_with_purchase_prices.append({
                                    'item_code': item['item_code'],
                                    'item_name': item['item_name'],
                                    'purchase_price': purchase_price,
                                    'valuation_updated': False
                                })
                        except Exception as update_error:
                            print("--- Invoice valuation: error updating rate")
                            items_with_purchase_prices.append({
                                'item_code': item['item_code'],
                                'item_name': item['item_name'],
                                'purchase_price': purchase_price,
                                'valuation_updated': False
                            })
                    else:
                        items_without_prices.append({
                            'item_code': item['item_code'],
                            'item_name': item['item_name']
                        })
                
                # Verificar nuevamente si después de actualizar valuation rates, aún hay items sin valuation rate
                items_still_needing_valuation = check_items_valuation_rate(session, headers, processed_items, data.get('company', ''))
                
                if items_still_needing_valuation:
                    # Crear mensaje informativo
                    message_parts = ["Factura mantenida como borrador porque algunos items requieren configuración:"]
                    
                    if items_without_prices:
                        items_str = ', '.join([f"{item.get('item_code', '')} ({item.get('item_name', '')})" for item in items_without_prices])
                        message_parts.append(f"• Items sin precio de compra: {items_str}")
                        message_parts.append("  Debe cargar el precio de compra en la lista de precios correspondiente antes de confirmar.")
                    
                    if items_with_purchase_prices:
                        updated_items = [item for item in items_with_purchase_prices if item.get('valuation_updated', False)]
                        not_updated_items = [item for item in items_with_purchase_prices if not item.get('valuation_updated', False)]
                        
                        if updated_items:
                            items_str = ', '.join([f"{item.get('item_code', '')} ({item.get('item_name', '')})" for item in updated_items])
                            message_parts.append(f"• Items con valuation rate actualizado automáticamente: {items_str}")
                        
                        if not_updated_items:
                            items_str = ', '.join([f"{item.get('item_code', '')} ({item.get('item_name', '')})" for item in not_updated_items])
                            message_parts.append(f"• Items con precio de compra pero valuation rate no actualizado: {items_str}")
                            message_parts.append("  Considere actualizar manualmente el valuation rate del item.")
                    
                    message_parts.append("La factura se mantendrá como borrador hasta que se resuelvan estos temas.")
                    
                    # Mantener como borrador - actualizar sin confirmar
                    update_body['docstatus'] = 0
                    
                    update_response, update_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                        data=update_body,
                        operation_name="Update Draft Invoice Without Confirmation"
                    )
                    
                    if update_error:
                        return handle_erpnext_error(update_error, "Failed to update draft invoice")
                    
                    updated_draft = update_response.json()
                    print("--- Invoice draft: updated without confirmation due to valuation")
                    
                    return jsonify({
                        "success": True,
                        "message": " ".join(message_parts),
                        "data": updated_draft['data'],
                        "warning": {
                            "type": "valuation_rate_missing",
                            "items_without_prices": items_without_prices,
                            "items_with_purchase_prices": items_with_purchase_prices
                        }
                    })
            
            # Si todos los items tienen valuation rate (o se actualizaron), proceder con la confirmación
            create_confirmed_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Sales Invoice",
                data=new_invoice_data,
                operation_name="Create Confirmed Invoice"
            )

            if create_error:
                return handle_erpnext_error(create_error, "Failed to create confirmed invoice")

            created_invoice = create_confirmed_response.json()
            final_invoice_name = created_invoice.get('data', {}).get('name', new_invoice_name)
            if linked_sales_orders:
                log_sales_order_item_links(created_invoice.get('data', {}).get('items', []), "ERPNext confirmed draft invoice response")
            print("--- Invoice confirmed: draft created")

            submit_response, submit_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Sales Invoice/{quote(final_invoice_name)}",
                data={"docstatus": 1},
                operation_name="Submit Created Invoice"
            )

            if submit_error:
                # Verificar si es un error de stock insuficiente
                stock_error_info = parse_negative_stock_error(submit_error)
                if stock_error_info:
                    print(f"--- Invoice submit: NegativeStockError detected for {stock_error_info['item_code']}")
                    # NO eliminar el borrador - el usuario lo necesita para corregir y reintentar
                    # Devolver error estructurado con información de stock alternativo
                    return handle_stock_error(submit_error, session, headers, processed_items, data.get('company', ''))
                else:
                    # Error genérico - limpiar el invoice creado y devolver error
                    try:
                        make_erpnext_request(
                            session=session,
                            method="DELETE",
                            endpoint=f"/api/resource/Sales Invoice/{quote(final_invoice_name)}",
                            operation_name="Delete Failed Invoice"
                        )
                    except:
                        pass
                    return handle_erpnext_error(submit_error, "Failed to submit created invoice")

            submit_result = submit_response.json()
            print("--- Invoice confirmed: submitted")
            if linked_sales_orders:
                log_sales_order_item_links(submit_result.get('data', {}).get('items', []), "ERPNext confirmed submit invoice response")
                sales_order_names = [item.get('sales_order') for item in processed_items]
                log_sales_order_statuses(session, sales_order_names, "Draft confirmation submit follow-up")

            # Actualizar el contador del talonario ahora que está confirmada
            update_talonario_last_number(session, headers, final_invoice_name, metodo_numeracion)

            # Eliminar el borrador temporal
            delete_draft_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                operation_name="Delete Temporary Draft Invoice"
            )

            if delete_error:
                print("--- Invoice draft: error deleting temporary")
            else:
                print("--- Invoice draft: temporary deleted")

            confirmed_result = submit_result
            return jsonify({
                "success": True,
                "message": "Borrador confirmado exitosamente con número definitivo",
                "data": confirmed_result['data'],
                "new_invoice_name": final_invoice_name
            })

        # Manejar el campo status y convertirlo a docstatus si es necesario
        status = data.get('status')
        if status:
            if status.lower() == 'cancelada' or status.lower() == 'cancelled':
                update_body['docstatus'] = 2  # Cancelled
            elif status.lower() == 'confirmada' or status.lower() == 'submitted':
                update_body['docstatus'] = 1  # Submitted
            elif status.lower() == 'borrador' or status.lower() == 'draft':
                update_body['docstatus'] = 0  # Draft

        # Agregar campos opcionales si existen con validación de fechas
        # IMPORTANTE: Obtener posting_date actual del documento si no se proporciona una nueva
        current_posting_date = data.get('posting_date')
        if not current_posting_date:
            # Si no se envía posting_date, obtener la del documento existente
            try:
                current_doc_response, current_doc_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
                    operation_name="Get Existing Invoice Posting Date"
                )
                if not current_doc_error and current_doc_response.status_code == 200:
                    current_posting_date = current_doc_response.json()['data'].get('posting_date')
                    print(f"--- Invoice dates: using existing posting_date: {current_posting_date}")
            except Exception as e:
                print(f"--- Invoice dates: error getting existing posting_date: {e}")
        
        for field in ['posting_date', 'due_date', 'invoice_number', 'punto_de_venta', 'currency', 'title', 'invoice_type', 'voucher_type_code', 'invoice_category', 'price_list', 'discount_amount', 'net_gravado', 'net_no_gravado', 'total_iva', 'percepcion_iva', 'percepcion_iibb', 'sales_condition_type', 'sales_condition_amount', 'sales_condition_days', 'sales_condition']:
            if data.get(field):
                if field == 'due_date':
                    # Ajustar due_date si es necesario usando la posting_date correcta
                    adjusted_due_date = adjust_due_date_if_needed(current_posting_date or data.get('posting_date'), data[field])
                    update_body[field] = adjusted_due_date
                    print(f"--- Invoice dates: setting due_date to {adjusted_due_date} (posting_date={current_posting_date or data.get('posting_date')})")
                else:
                    update_body[field] = data[field]


        # El título se guarda en el campo 'description' en ERPNext
        if data.get('title'):
            update_body['description'] = data['title']

        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}",
            data=update_body,
            operation_name="Update Draft Invoice"
        )

        if update_error:
            return handle_erpnext_error(update_error, "Failed to update draft invoice")

        result = update_response.json()
        print("--- Invoice draft: processed successfully")

        return jsonify({
            "success": True,
            "message": "Factura procesada exitosamente",
            "data": result['data']
        })

    except Exception as e:
        print("--- Invoice draft: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

def update_confirmed_invoice(invoice_name, data, session, headers):
    """Actualizar una factura confirmada usando cancel/amend workflow"""
    try:
        # Verificar si solo se quiere cancelar la factura
        requested_status = data.get('status', '').lower()
        requested_docstatus = data.get('docstatus', 1)
        
        if requested_status in ['cancelada', 'cancelled'] or requested_docstatus == 2:
            # Solo cancelar la factura, no hacer amend
            print("--- Invoice confirmed: canceling only")
            return cancel_invoice(invoice_name, session, headers)
        
        # Si se quiere modificar (no cancelar), entonces hacer el workflow completo de cancel/amend
        print("--- Invoice confirmed: modifying with amend workflow")
        
        # Paso 1: Cancelar la factura original
        print("--- Invoice confirmed: canceling original")
        cancel_response, cancel_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.cancel",
            data={"doctype": "Sales Invoice", "name": invoice_name},
            operation_name="Cancel Original Invoice"
        )

        if cancel_error:
            return handle_erpnext_error(cancel_error, "Failed to cancel original invoice")

        # Paso 2: Crear enmienda usando el método correcto de frappe
        print("--- Invoice confirmed: creating amendment")
        amend_response, amend_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.amend_doc",
            data={
                "doctype": "Sales Invoice",
                "docname": invoice_name
            },
            operation_name="Create Invoice Amendment"
        )

        if amend_error:
            return handle_erpnext_error(amend_error, "Failed to create invoice amendment")

        amend_result = amend_response.json()
        new_invoice_name = amend_result['message']['name']
        print("--- Invoice confirmed: amendment created")

        # Paso 3: Actualizar el nuevo borrador con los datos modificados
        # Obtener el mapa de templates de impuestos
        tax_map = get_tax_template_map(session, headers, data.get('company', ''), transaction_type='sales')
        
        # Obtener moneda por defecto de la empresa
        default_currency = get_company_default_currency(session, headers, data.get('company', ''))
        if not default_currency:
            company_name = data.get('company', '')
            return jsonify({
                "success": False,
                "message": f"La empresa '{company_name}' no tiene moneda por defecto definida (default_currency)"
            }), 400
        
        processed_items = []
        for item in data.get('items', []):
            processed_item = process_invoice_item(item, session, headers, data.get('company', ''), tax_map, data.get('customer'))
            if processed_item:
                processed_items.append(processed_item)
            else:
                return jsonify({"success": False, "message": f"Error procesando item: {item.get('item_name', 'Sin nombre')}"}), 400

        # Función auxiliar para ajustar fechas
        def adjust_due_date_if_needed(posting, due):
            """Ajusta due_date si es igual o anterior a posting_date"""
            from datetime import datetime, timedelta
            
            if not posting or not due:
                return due
            
            try:
                posting_dt = datetime.strptime(posting.strip(), "%Y-%m-%d")
                due_dt = datetime.strptime(due.strip(), "%Y-%m-%d")
                
                # Si due_date es igual o anterior a posting_date, agregar un día
                if due_dt <= posting_dt:
                    adjusted_dt = posting_dt + timedelta(days=1)
                    adjusted_date = adjusted_dt.strftime("%Y-%m-%d")
                    print("--- Invoice dates: due date adjusted in confirmed update")
                    return adjusted_date
                else:
                    return due
            except (ValueError, AttributeError) as e:
                print("--- Invoice dates: invalid format in confirmed update")
                return due

        update_body = {
            "customer": data.get('customer'),
            "company": data.get('company'),
            "items": processed_items,
            "docstatus": data.get('docstatus', 0)
        }

        # Agregar campos opcionales si existen con validación de fechas
        for field in ['currency', 'title']:
            if data.get(field):
                update_body[field] = data[field]

        # Si no se especificó moneda, usar la moneda por defecto de la empresa
        if not data.get('currency'):
            update_body['currency'] = default_currency
        # El título se guarda en el campo 'description' en ERPNext
        if data.get('title'):
            update_body['description'] = data['title']

        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Sales Invoice/{quote(new_invoice_name)}",
            data=update_body,
            operation_name="Update Amended Invoice Draft"
        )

        if update_error:
            return handle_erpnext_error(update_error, "Failed to update amended invoice draft")

        # Paso 4: Confirmar la factura modificada
        print("--- Invoice confirmed: submitting modified")
        submit_response, submit_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Sales Invoice/{quote(new_invoice_name)}",
            data={"docstatus": 1},
            operation_name="Submit Modified Invoice"
        )

        if submit_error:
            # Verificar si es un error de stock insuficiente
            stock_error_info = parse_negative_stock_error(submit_error)
            if stock_error_info:
                print(f"--- Invoice modify: NegativeStockError detected for {stock_error_info['item_code']}")
                # Devolver error estructurado con información de stock alternativo
                return handle_stock_error(submit_error, session, headers, processed_items, data.get('company', ''))
            else:
                return handle_erpnext_error(submit_error, "Failed to submit modified invoice")

        final_result = submit_response.json()
        print("--- Invoice confirmed: modified successfully")

        return jsonify({
            "success": True,
            "message": "Factura modificada exitosamente",
            "data": final_result['data']
        })

    except Exception as e:
        print("--- Invoice confirmed: error modifying")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

def cancel_invoice(invoice_name, session, headers):
    """Cancelar una factura"""
    try:
        print("--- Invoice cancel: started")
        def _extract_ppr_log_name(error):
            if not isinstance(error, dict):
                return None
            body = error.get("response_body") or ""
            try:
                payload = json.loads(body)
                body = payload.get("exception") or body
                # Some responses stash details in _server_messages
                if payload.get("_server_messages"):
                    body = f"{body} {payload.get('_server_messages')}"
            except Exception:
                pass
            if not isinstance(body, str):
                body = str(body)
            # Prefer the explicit doctype/url match
            m = re.search(r'process-payment-reconciliation-log/([A-Za-z0-9\-\.]+)', body, flags=re.IGNORECASE)
            if m:
                return m.group(1)
            m2 = re.search(r'\bPPR-LOG-\d+\b', body, flags=re.IGNORECASE)
            if m2:
                return m2.group(0)
            return None

        cancel_response, cancel_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.cancel",
            data={"doctype": "Sales Invoice", "name": invoice_name},
            operation_name="Cancel Invoice"
        )

        if cancel_error:
            # Workaround: si el doc está vinculado a un Process Payment Reconciliation Log, eliminar el log y reintentar.
            ppr_log = _extract_ppr_log_name(cancel_error)
            if ppr_log:
                print(f"--- Invoice cancel: detected PPR log link, deleting '{ppr_log}' and retrying")
                _, delete_err = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Process Payment Reconciliation Log/{quote(ppr_log)}",
                    operation_name="Delete Process Payment Reconciliation Log (unlink for cancel)"
                )
                if not delete_err:
                    cancel_response, cancel_error = make_erpnext_request(
                        session=session,
                        method="POST",
                        endpoint="/api/method/frappe.client.cancel",
                        data={"doctype": "Sales Invoice", "name": invoice_name},
                        operation_name="Cancel Invoice (retry after PPR log delete)"
                    )
                    if not cancel_error:
                        cancel_error = None
                else:
                    print(f"--- Invoice cancel: could not delete PPR log '{ppr_log}': {delete_err.get('message')}")

            if cancel_error:
                return handle_erpnext_error(cancel_error, "Failed to cancel invoice")

        print("--- Invoice cancel: success")
        return jsonify({
            "success": True,
            "message": "Factura cancelada exitosamente"
        })

    except Exception as e:
        print("--- Invoice cancel: exception")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@invoices_bp.route('/api/customer-invoices', methods=['GET', 'OPTIONS'])
def get_customer_invoices():
    """Obtiene las facturas de un cliente específico"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print("Obteniendo facturas de cliente")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener parámetros
    customer_name = request.args.get('customer')
    status = request.args.get('status', 'all')  # 'all', 'paid', 'unpaid', 'draft'
    limit = request.args.get('limit', '20')  # Límite de resultados

    if not customer_name:
        return jsonify({"success": False, "message": "Nombre del cliente requerido"}), 400

    try:
        # Obtener la compañía activa
        company_name = get_active_company(user_id)

        if not company_name:
            print("--- Customer invoices: no active company")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compania {company_name}"}), 400

        customer_name = add_company_abbr(customer_name, company_abbr)

        # Construir filtros para las facturas
        filters = [
            ["customer", "=", customer_name],
            ["company", "=", company_name]
        ]

        # Configurar docstatus basado en el status
        if status == 'draft':
            filters.append(["docstatus", "=", 0])  # Draft
        elif status == 'all':
            # Para 'all', obtener tanto draft como submitted
            filters.append(["docstatus", "in", [0, 1]])  # 0=Draft, 1=Submitted
        else:
            filters.append(["docstatus", "=", 1])  # Submitted

        if status == 'paid':
            filters.append(["outstanding_amount", "=", 0])
        elif status == 'unpaid':
            # Para 'unpaid', incluir todos los documentos con saldo pendiente != 0
            # incluyendo notas de crédito con saldos negativos
            filters.append(["outstanding_amount", "!=", 0])

        # Obtener facturas desde ERPNext (solicitar todos los campos para evitar llamadas adicionales)
        fields_str = '["*"]'
        filters_json = json.dumps(filters)
        invoices_url = f"/api/resource/Sales%20Invoice?fields={quote(fields_str)}&filters={quote(filters_json)}&limit_page_length={limit}&order_by=posting_date%20desc"
        
        invoices_response, invoices_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=invoices_url,
            operation_name="Fetch Customer Invoices"
        )

        if invoices_error:
            return handle_erpnext_error(invoices_error, "Failed to fetch customer invoices")

        invoices_data = invoices_response.json()
        all_documents = invoices_data.get("data", [])

        # Procesar documentos basado en el status solicitado
        if status in ['all', 'draft']:
            # Para 'all' y 'draft', incluir todos los documentos sin filtrar por saldo
            invoices = all_documents
        else:
            # Para 'paid' y 'unpaid', usar la lógica de documentos pendientes
            # Procesar documentos considerando relaciones para determinar cuáles son realmente pendientes
            pending_documents = []
            processed_groups = set()  # Para evitar procesar el mismo grupo múltiples veces

            # Agrupar documentos por return_against
            groups = {}
            standalone_docs = []

            for doc in all_documents:
                return_against = doc.get("return_against")
                if return_against:
                    if return_against not in groups:
                        groups[return_against] = []
                    groups[return_against].append(doc)
                else:
                    # Documentos sin relación (facturas originales o NC sin relación)
                    standalone_docs.append(doc)

            # Procesar cada grupo de documentos relacionados
            for original_invoice_name, related_docs in groups.items():
                if original_invoice_name in processed_groups:
                    continue

                processed_groups.add(original_invoice_name)

                # Encontrar la factura original
                original_invoice = None
                credit_notes = []

                for doc in related_docs:
                    if not doc.get("is_return"):
                        original_invoice = doc
                    else:
                        credit_notes.append(doc)

                # Si no hay factura original en este grupo, agregar todos los documentos relacionados
                if not original_invoice:
                    # Buscar la factura original entre todos los documentos
                    for doc in all_documents:
                        if doc["name"] == original_invoice_name:
                            original_invoice = doc
                            break

                if original_invoice:
                    # Calcular el saldo neto del grupo
                    net_outstanding = original_invoice.get("outstanding_amount", 0)
                    for cn in credit_notes:
                        net_outstanding += cn.get("outstanding_amount", 0)

                    # Si el saldo neto es cero, no mostrar ninguno
                    if abs(net_outstanding) < 0.01:  # Tolerancia para decimales
                        continue
                    # Si el saldo neto es positivo, mostrar la factura original
                    elif net_outstanding > 0:
                        pending_documents.append(original_invoice)
                    # Si el saldo neto es negativo, mostrar las notas de crédito excepto la primera (que cancela con la factura)
                    else:
                        pending_documents.extend(credit_notes)
                else:
                    # Si no se encuentra la factura original, mostrar todos los documentos relacionados
                    pending_documents.extend(related_docs)

            # Agregar documentos standalone (facturas sin NC relacionadas y NC sin factura relacionada)
            for doc in standalone_docs:
                outstanding = doc.get("outstanding_amount", 0)
                if abs(outstanding) > 0.01:  # Solo incluir si tiene saldo significativo
                    pending_documents.append(doc)

            invoices = pending_documents

        # Obtener detalles completos de cada factura incluyendo items
        def build_invoice_payload(invoice_detail):
            voucher_type = "Factura"
            if invoice_detail.get("is_return"):
                voucher_type = "Nota de Crédito"
            elif invoice_detail.get("invoice_type"):
                voucher_type = invoice_detail.get("invoice_type")

            detailed_invoice = {
                "name": invoice_detail.get("name"),
                "posting_date": invoice_detail.get("posting_date"),
                "due_date": invoice_detail.get("due_date"),
                "customer": invoice_detail.get("customer"),
                "customer_name": invoice_detail.get("customer_name"),
                "grand_total": invoice_detail.get("grand_total"),
                "outstanding_amount": invoice_detail.get("outstanding_amount"),
                "status": invoice_detail.get("status"),
                "docstatus": invoice_detail.get("docstatus"),
                "remarks": invoice_detail.get("remarks"),
                "is_return": invoice_detail.get("is_return", 0),
                "invoice_type": invoice_detail.get("invoice_type"),
                "voucher_type_code": invoice_detail.get("voucher_type_code"),
                "voucher_type": voucher_type,
                "return_against": invoice_detail.get("return_against"),
                "currency": invoice_detail.get("currency"),
                "price_list": invoice_detail.get("selling_price_list"),
                "discount_amount": invoice_detail.get("discount_amount", 0),
                "net_gravado": invoice_detail.get("net_total", 0),
                "net_no_gravado": invoice_detail.get("total_taxes_and_charges", 0),
                "total_iva": invoice_detail.get("total_taxes_and_charges", 0),
                "items": []
            }

            # Procesar los items de la factura usando los datos ya obtenidos
            for item in invoice_detail.get("items", []):
                processed_item = {
                    "item_code": item.get("item_code", ""),
                    "item_name": item.get("item_name", ""),
                    "description": item.get("description", ""),
                    "qty": item.get("qty", 1),
                    "rate": item.get("rate", 0),
                    "amount": item.get("amount", 0),
                    "discount_amount": item.get("discount_amount", 0),
                    "item_tax_rate": item.get("item_tax_rate", 21)
                }
                detailed_invoice["items"].append(processed_item)

            return detailed_invoice

        detailed_invoices = []
        for invoice in invoices:
            try:
                detailed_invoices.append(build_invoice_payload(invoice))
            except Exception:
                print("--- Customer invoices: error processing invoice data")
                detailed_invoices.append(invoice)

        return jsonify({"success": True, "data": detailed_invoices, "message": "Facturas obtenidas correctamente"})

    except requests.exceptions.HTTPError as err:
        print("--- Customer invoices: HTTP error")
        return jsonify({"success": False, "message": "Error al obtener facturas"}), 500
    except requests.exceptions.RequestException as e:
        print("--- Customer invoices: connection error")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500
    

@invoices_bp.route('/api/sales-invoice-items/search', methods=['POST', 'OPTIONS'])
def search_sales_invoice_items():
    """
    Busca items (Sales Invoice Item) dentro de un conjunto de Sales Invoice ya cargadas en el front.

    Request JSON:
      - parents: [sales_invoice_name, ...] (restringe la busqueda)
      - query: string (LIKE %query% en item_code/item_name/description)
      - limit: int (opcional)

    Response JSON:
      - success: bool
      - parents: [sales_invoice_name, ...] (parents que matchearon)
    """
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    request_payload = request.get_json(silent=True) or {}
    query = (request_payload.get('query') or '').strip()
    parents = request_payload.get('parents') or []

    try:
        limit = int(request_payload.get('limit') or 2000)
    except (TypeError, ValueError):
        limit = 2000
    limit = max(1, min(limit, 5000))

    if not query or len(query) < 2:
        return jsonify({"success": True, "parents": []})

    if not isinstance(parents, list) or not parents:
        return jsonify({"success": True, "parents": []})

    normalized_parents = []
    seen = set()
    for parent_name in parents:
        if parent_name is None:
            continue
        parent_str = str(parent_name).strip()
        if not parent_str or parent_str in seen:
            continue
        seen.add(parent_str)
        normalized_parents.append(parent_str)
        if len(normalized_parents) >= 500:
            break

    if not normalized_parents:
        return jsonify({"success": True, "parents": []})

    try:
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data={
                "doctype": "Sales Invoice Item",
                "parent": "Sales Invoice",
                "fields": [
                    "name",
                    "parent",
                    "parenttype",
                    "parentfield",
                    "item_code",
                    "item_name",
                    "description",
                    "qty",
                    "rate",
                    "amount",
                    "idx"
                ],
                "filters": [
                    ["parent", "in", normalized_parents],
                    ["parenttype", "=", "Sales Invoice"],
                    ["parentfield", "=", "items"]
                ],
                "or_filters": [
                    ["Sales Invoice Item", "item_code", "like", f"%{query}%"],
                    ["Sales Invoice Item", "item_name", "like", f"%{query}%"],
                    ["Sales Invoice Item", "description", "like", f"%{query}%"]
                ],
                "limit_page_length": limit
            },
            operation_name="Search Sales Invoice Items"
        )

        if error:
            return handle_erpnext_error(error, "Search Sales Invoice Items failed")

        if not response or response.status_code != 200:
            status_code = response.status_code if response else 500
            return jsonify({"success": False, "message": f"Error HTTP {status_code}"}), status_code

        rows = response.json().get("message", []) or []
        matched = []
        matched_set = set()
        for row in rows:
            parent_name = row.get("parent")
            if not parent_name:
                continue
            parent_str = str(parent_name)
            if parent_str in matched_set:
                continue
            matched_set.add(parent_str)
            matched.append(parent_str)

        return jsonify({"success": True, "parents": matched})
    except Exception as e:
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@invoices_bp.route('/api/document-items/search', methods=['POST', 'OPTIONS'])
def search_document_items():
    """
    Busqueda generica de items (child tables) para documentos de venta.

    Request JSON:
      - child_doctype: "Sales Order Item" | "Quotation Item" | "Delivery Note Item" | "Sales Invoice Item"
      - parent_doctype: por ej "Sales Order"
      - parentfield: por ej "items" (default)
      - parents: [doc_name, ...]
      - query: string
      - limit: int (opcional)

    Response JSON:
      - success: bool
      - parents: [doc_name, ...]
    """
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    request_payload = request.get_json(silent=True) or {}
    query = (request_payload.get('query') or '').strip()
    parents = request_payload.get('parents') or []
    child_doctype = (request_payload.get('child_doctype') or '').strip()
    parent_doctype = (request_payload.get('parent_doctype') or '').strip()
    parentfield = (request_payload.get('parentfield') or 'items').strip() or 'items'

    allowed = {
        ("Sales Invoice Item", "Sales Invoice"),
        ("Sales Order Item", "Sales Order"),
        ("Quotation Item", "Quotation"),
        ("Delivery Note Item", "Delivery Note"),
        ("Purchase Invoice Item", "Purchase Invoice"),
        ("Purchase Order Item", "Purchase Order"),
        ("Purchase Receipt Item", "Purchase Receipt")
    }

    if (child_doctype, parent_doctype) not in allowed:
        return jsonify({"success": False, "message": "doctype no permitido"}), 400

    try:
        limit = int(request_payload.get('limit') or 2000)
    except (TypeError, ValueError):
        limit = 2000
    limit = max(1, min(limit, 5000))

    if not query or len(query) < 2:
        return jsonify({"success": True, "parents": []})

    if not isinstance(parents, list) or not parents:
        return jsonify({"success": True, "parents": []})

    normalized_parents = []
    seen = set()
    for parent_name in parents:
        if parent_name is None:
            continue
        parent_str = str(parent_name).strip()
        if not parent_str or parent_str in seen:
            continue
        seen.add(parent_str)
        normalized_parents.append(parent_str)
        if len(normalized_parents) >= 500:
            break

    if not normalized_parents:
        return jsonify({"success": True, "parents": []})

    try:
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data={
                "doctype": child_doctype,
                "parent": parent_doctype,
                "fields": [
                    "name",
                    "parent",
                    "parenttype",
                    "parentfield",
                    "item_code",
                    "item_name",
                    "description",
                    "qty",
                    "rate",
                    "amount",
                    "idx"
                ],
                "filters": [
                    ["parent", "in", normalized_parents],
                    ["parenttype", "=", parent_doctype],
                    ["parentfield", "=", parentfield]
                ],
                "or_filters": [
                    [child_doctype, "item_code", "like", f"%{query}%"],
                    [child_doctype, "item_name", "like", f"%{query}%"],
                    [child_doctype, "description", "like", f"%{query}%"]
                ],
                "limit_page_length": limit
            },
            operation_name="Search Document Items"
        )

        if error:
            return handle_erpnext_error(error, "Search Document Items failed")

        if not response or response.status_code != 200:
            status_code = response.status_code if response else 500
            return jsonify({"success": False, "message": f"Error HTTP {status_code}"}), status_code

        rows = response.json().get("message", []) or []
        matched = []
        matched_set = set()
        for row in rows:
            parent_name = row.get("parent")
            if not parent_name:
                continue
            parent_str = str(parent_name)
            if parent_str in matched_set:
                continue
            matched_set.add(parent_str)
            matched.append(parent_str)

        return jsonify({"success": True, "parents": matched})
    except Exception as e:
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@invoices_bp.route('/api/invoices/<invoice_name>', methods=['GET'])
@cached_function(ttl=10)  # Cache por 10 segundos para evitar múltiples llamadas inmediatas
def get_invoice(invoice_name):
    """Obtener una factura específica por nombre"""
    log_function_call("get_invoice", minimal=True)
    conditional_log(f"Obteniendo factura {invoice_name}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la factura desde ERPNext con campos específicos
        # IMPORTANTE: Especificar campos de items incluyendo item_tax_rate
        fields = '["name","posting_date","due_date","customer","company","currency","description","title","docstatus","total","is_return","return_against","invoice_type","voucher_type","invoice_category","punto_de_venta","invoice_number","items.item_code","items.item_name","items.description","items.qty","items.rate","items.amount","items.discount_amount","items.item_tax_template","items.item_tax_rate","items.warehouse","items.cost_center","items.uom","items.income_account","taxes","status","grand_total","outstanding_amount","paid","net_gravado","net_no_gravado","total_iva","percepcion_iva","percepcion_iibb","discount_amount","price_list","sales_condition_type","sales_condition_amount","sales_condition_days"]'
        invoice_response, invoice_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Sales Invoice/{quote(invoice_name)}?fields={quote(fields)}",
            operation_name="Get Invoice Details"
        )

        if invoice_error:
            return handle_erpnext_error(invoice_error, "Failed to get invoice")

        invoice_data = invoice_response.json()['data']

        # Procesar los items para incluir la información necesaria
        processed_items = []
        conditional_log(f"Procesando factura {invoice_name}")

        # Obtener el mapa de impuestos de la compañía para búsqueda robusta
        company = invoice_data.get('company')
        if company:
            try:
                tax_map = get_tax_template_map(session, headers, company, transaction_type='sales')
            except Exception as e:
                conditional_log(f"Error obteniendo tax_map: {str(e)}")
                tax_map = {}
        else:
            tax_map = {}
        
        for i, item in enumerate(invoice_data.get('items', [])):
            # LÓGICA PARA EXTRAER IVA:
            # Prioridad: item_tax_rate (tasa real aplicada), luego fallback a tax_map si es necesario
            iva_percent = None

            # Intentar obtener la tasa desde item_tax_rate (JSON con la tasa real)
            item_tax_rate_raw = item.get('item_tax_rate')
            if item_tax_rate_raw:
                try:
                    tax_rate_dict = json.loads(item_tax_rate_raw)
                    if tax_rate_dict and len(tax_rate_dict) > 0:
                        iva_percent = float(list(tax_rate_dict.values())[0])
                except (json.JSONDecodeError, ValueError, IndexError) as e:
                    pass
            
            # Si no se pudo obtener de item_tax_rate, intentar con tax_map (menos confiable)
            if iva_percent is None:
                template_name = item.get('item_tax_template')
                if template_name and tax_map:
                    # Invertir el tax_map: template -> tasa
                    template_to_rate = {v: k for k, v in tax_map.items()}
                    if template_name in template_to_rate:
                        iva_percent = float(template_to_rate[template_name])

            processed_item = {
                "item_code": item.get('item_code', ''),
                "item_name": item.get('item_name', ''),
                "description": item.get('description', ''),
                "qty": item.get('qty', 1),
                "rate": item.get('rate', 0),
                "discount_amount": item.get('discount_amount', 0),
                "iva_percent": iva_percent,  # Puede ser None si no se encontró
                "amount": item.get('amount', 0),
                "warehouse": item.get('warehouse', ''),
                "cost_center": item.get('cost_center', ''),
                "uom": item.get('uom', 'Unidad'),
                "account": item.get('income_account', ''),
                "item_tax_template": item.get('item_tax_template', '')
            }
            processed_items.append(processed_item)
        
        # Construir la respuesta con todos los campos necesarios
        # Intentar obtener el título de diferentes formas - priorizar 'description'
        title = invoice_data.get('description') or invoice_data.get('title') or invoice_data.get('naming_series') or invoice_data.get('name') or ''

        response_data = {
            "name": invoice_data.get('name'),
            "posting_date": invoice_data.get('posting_date'),
            "due_date": invoice_data.get('due_date'),
            "customer": invoice_data.get('customer'),
            "company": invoice_data.get('company'),
            "currency": invoice_data.get('currency'),
            "title": title,  # Usar el título obtenido
            "status": "Confirmado" if invoice_data.get('docstatus') == 1 else "Borrador",
            "items": processed_items,
            "total": invoice_data.get('total', 0),
            "docstatus": invoice_data.get('docstatus', 0),
            "return_against": invoice_data.get('return_against'),
            "invoice_type": invoice_data.get('invoice_type'),
            "voucher_type": invoice_data.get('voucher_type'),
            "invoice_category": invoice_data.get('invoice_category'),
            "punto_de_venta": invoice_data.get('punto_de_venta'),
            "invoice_number": invoice_data.get('invoice_number'),
            "is_return": invoice_data.get('is_return', 0)
        }

        print("--- Invoice get: response data prepared")
        print("--- Invoice get: items processed")
        for i, item in enumerate(response_data['items']):
            print("--- Invoice get: item details checked")

        log_success(f"Factura obtenida exitosamente: {invoice_name}", "get_invoice")
        
        return jsonify({
            "success": True,
            "data": response_data
        })

    except Exception as e:
        log_error(f"Error obteniendo factura: {str(e)}", "get_invoice")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
