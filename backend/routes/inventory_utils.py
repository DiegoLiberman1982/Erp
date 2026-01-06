"""
Utilidades compartidas para operaciones de inventario.
Contiene funciones helper que son usadas por múltiples módulos de inventario.
"""

import json
import traceback
from utils.http_utils import make_erpnext_request


def round_qty(value):
    """Utility to normalize quantity values to 4 decimal places."""
    try:
        return float(round(float(value or 0), 4))
    except (TypeError, ValueError):
        return 0.0


def fetch_stock_reservations(session, headers, item_codes, company=None):
    """
    Obtiene las reservas de stock activas desde Stock Reservation Entry.
    ERPNext no actualiza el campo reserved_qty del Bin automáticamente,
    por lo que necesitamos consultar directamente las reservas.
    
    Returns:
        dict: Mapa de item_code -> {total_reserved: X, warehouses: {warehouse: qty}}
    """
    if not item_codes:
        return {}
    
    unique_codes = list({code for code in item_codes if code})
    if not unique_codes:
        return {}
    
    print(f"Obteniendo reservas de stock para {len(unique_codes)} items")
    
    # Solo reservas activas (status != Cancelled/Delivered)
    filters = [
        ["item_code", "in", unique_codes],
        ["docstatus", "=", 1],
        ["status", "not in", ["Cancelled", "Delivered"]]
    ]
    
    if company:
        filters.append(["company", "=", company])
    
    params = {
        "fields": json.dumps([
            "name",
            "item_code",
            "warehouse",
            "reserved_qty",
            "delivered_qty",
            "status",
            "voucher_type",
            "voucher_no"
        ]),
        "filters": json.dumps(filters),
        "limit_page_length": 5000
    }
    
    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Stock Reservation Entry",
            params=params,
            operation_name="Get stock reservations"
        )
        
        if error:
            print(f"Error obteniendo reservas de stock: {error}")
            return {}
        
        reservations = response.json().get("data", [])
        print(f"Reservas encontradas: {len(reservations)}")
        
        # Agrupar por item_code
        reservation_map = {}
        for entry in reservations:
            code = entry.get("item_code")
            if not code:
                continue
            
            # Calcular cantidad efectivamente reservada (reserved - delivered)
            reserved = round_qty(entry.get("reserved_qty", 0))
            delivered = round_qty(entry.get("delivered_qty", 0))
            effective_reserved = max(0, reserved - delivered)
            
            if effective_reserved <= 0:
                continue
            
            warehouse = entry.get("warehouse")
            
            if code not in reservation_map:
                reservation_map[code] = {
                    "total_reserved": 0.0,
                    "warehouses": {},
                    "reservations": []
                }
            
            reservation_map[code]["total_reserved"] += effective_reserved
            
            if warehouse:
                if warehouse not in reservation_map[code]["warehouses"]:
                    reservation_map[code]["warehouses"][warehouse] = 0.0
                reservation_map[code]["warehouses"][warehouse] += effective_reserved
            
            # Guardar detalle de la reserva para mostrar en movimientos
            reservation_map[code]["reservations"].append({
                "name": entry.get("name"),
                "warehouse": warehouse,
                "reserved_qty": reserved,
                "delivered_qty": delivered,
                "effective_reserved": effective_reserved,
                "status": entry.get("status"),
                "voucher_type": entry.get("voucher_type"),
                "voucher_no": entry.get("voucher_no")
            })
        
        # Redondear totales
        for code in reservation_map:
            reservation_map[code]["total_reserved"] = round_qty(reservation_map[code]["total_reserved"])
            for wh in reservation_map[code]["warehouses"]:
                reservation_map[code]["warehouses"][wh] = round_qty(reservation_map[code]["warehouses"][wh])
        
        print(f"Reservas procesadas para {len(reservation_map)} items")
        return reservation_map
    
    except Exception as exc:
        print(f"Error procesando reservas de stock: {exc}")
        traceback.print_exc()
        return {}


def fetch_bin_stock(session, headers, item_codes, company=None):
    """Retrieve Bin stock information for the given item codes."""
    if not item_codes:
        return {}

    unique_codes = list({code for code in item_codes if code})
    if not unique_codes:
        return {}

    # Dividir los códigos en lotes para evitar URLs demasiado largas
    batch_size = 100
    all_stock_map = {}

    print(f"Obteniendo stock para {len(unique_codes)} items en lotes de {batch_size}")

    for i in range(0, len(unique_codes), batch_size):
        batch_codes = unique_codes[i:i + batch_size]
        print(f"Procesando lote {i//batch_size + 1}/{(len(unique_codes) + batch_size - 1)//batch_size}: {len(batch_codes)} items")

        filters = [["item_code", "in", batch_codes]]

        # Filter by warehouses of the company
        if company:
            warehouse_filters = [["company", "=", company], ["disabled", "=", 0], ["is_group", "=", 0]]
            warehouse_params = {
                "fields": '["name"]',
                "filters": json.dumps(warehouse_filters),
                "limit_page_length": 5000
            }
            warehouse_response, warehouse_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Warehouse",
                params=warehouse_params,
                operation_name="Get company warehouses for stock filtering"
            )

            if warehouse_error:
                print(f"Error obteniendo warehouses para compañía {company}: {warehouse_error}")
                continue
            
            warehouses = [w['name'] for w in warehouse_response.json().get('data', [])]
            if warehouses:
                filters.append(["warehouse", "in", warehouses])
            else:
                # No warehouses for company, return empty
                continue

        params = {
            "fields": json.dumps([
                "item_code",
                "warehouse",
                "actual_qty",
                "reserved_qty",
                "projected_qty"
            ]),
            "filters": json.dumps(filters),
            "limit_page_length": 5000
        }

        try:
            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Bin",
                params=params,
                operation_name=f"Get bin stock data (batch {i//batch_size + 1})"
            )

            if error:
                print(f"Error obteniendo stock desde Bin (lote {i//batch_size + 1}): {error}")
                continue

            bins = response.json().get("data", [])
            stock_map = {}

            for entry in bins:
                code = entry.get("item_code")
                if not code:
                    continue

                item_entry = stock_map.setdefault(code, {
                    "total_actual_qty": 0.0,
                    "total_reserved_qty": 0.0,
                    "total_projected_qty": 0.0,
                    "bins": []
                })

                actual_qty = round_qty(entry.get("actual_qty"))
                reserved_qty = round_qty(entry.get("reserved_qty"))
                projected_qty = round_qty(entry.get("projected_qty"))

                item_entry["total_actual_qty"] += actual_qty
                item_entry["total_reserved_qty"] += reserved_qty
                item_entry["total_projected_qty"] += projected_qty
                item_entry["bins"].append({
                    "warehouse": entry.get("warehouse"),
                    "actual_qty": actual_qty,
                    "reserved_qty": reserved_qty,
                    "projected_qty": projected_qty
                })

            # Agregar los resultados de este lote al mapa general
            for code, item_entry in stock_map.items():
                if code not in all_stock_map:
                    all_stock_map[code] = item_entry
                else:
                    # Combinar con resultados previos si el item ya existe
                    existing = all_stock_map[code]
                    existing["total_actual_qty"] += item_entry["total_actual_qty"]
                    existing["total_reserved_qty"] += item_entry["total_reserved_qty"]
                    existing["total_projected_qty"] += item_entry["total_projected_qty"]
                    existing["bins"].extend(item_entry["bins"])

        except Exception as exc:
            print(f"Error procesando lote {i//batch_size + 1}: {exc}")
            continue

    # Obtener reservas de stock desde Stock Reservation Entry
    # (el campo reserved_qty del Bin no se actualiza automáticamente en ERPNext)
    reservation_map = fetch_stock_reservations(session, headers, list(all_stock_map.keys()), company)
    
    # Combinar stock con reservas reales
    for code, item_entry in all_stock_map.items():
        # Obtener reservas reales desde Stock Reservation Entry
        reservations = reservation_map.get(code, {})
        real_reserved = reservations.get("total_reserved", 0.0)
        warehouse_reservations = reservations.get("warehouses", {})
        
        # Actualizar el total reservado con datos reales
        item_entry["total_reserved_qty"] = round_qty(real_reserved)
        
        # Calcular cantidad disponible (actual - reservado)
        item_entry["total_available_qty"] = round_qty(
            item_entry["total_actual_qty"] - real_reserved
        )
        
        # Guardar detalles de reservas para posible uso en frontend
        item_entry["stock_reservations"] = reservations.get("reservations", [])
        
        # Crear un set de warehouses que ya existen en bins
        existing_warehouses = {bin_entry.get("warehouse") for bin_entry in item_entry["bins"]}
        
        # Actualizar cada bin con su reserva real
        for bin_entry in item_entry["bins"]:
            warehouse = bin_entry.get("warehouse")
            bin_reserved = warehouse_reservations.get(warehouse, 0.0)
            bin_entry["reserved_qty"] = round_qty(bin_reserved)
            bin_entry["available_qty"] = round_qty(
                bin_entry["actual_qty"] - bin_reserved
            )
        
        # IMPORTANTE: Agregar almacenes que solo tienen reservas pero no stock físico
        # Esto permite ver en el frontend los almacenes donde hay reservas pendientes
        for res_warehouse, res_qty in warehouse_reservations.items():
            if res_warehouse not in existing_warehouses and res_qty > 0:
                item_entry["bins"].append({
                    "warehouse": res_warehouse,
                    "actual_qty": 0.0,  # No hay stock físico
                    "reserved_qty": round_qty(res_qty),
                    "projected_qty": 0.0,
                    "available_qty": round_qty(-res_qty),  # Negativo porque se debe stock
                    "is_reservation_only": True  # Flag para identificar que solo tiene reservas
                })
                print(f"  Agregado warehouse de reserva: {res_warehouse} con {res_qty} reservados")
        
        # Redondear y ordenar
        item_entry["total_actual_qty"] = round_qty(item_entry["total_actual_qty"])
        item_entry["total_projected_qty"] = round_qty(item_entry["total_projected_qty"])
        item_entry["bins"] = sorted(
            item_entry["bins"],
            key=lambda b: b["actual_qty"],
            reverse=True
        )

    print(f"Stock obtenido exitosamente para {len(all_stock_map)} items (con reservas)")
    return all_stock_map


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


def fetch_item_iva_rates_bulk(session, headers, item_names, company):
    """
    Obtiene las tasas de IVA de múltiples items de manera eficiente.

    Consulta la tabla hija Item Tax filtrando por los parent (item names).
    Luego obtiene los detalles de cada Item Tax Template para extraer la tasa.

    IMPORTANTE: Usa POST a frappe.client.get_list para evitar PermissionError
    en consultas a child tables.

    Args:
        session: Sesión de requests
        headers: Headers de autenticación
        item_names: Lista de nombres de items (los 'name' de ERPNext)
        company: Nombre de la compañía

    Returns:
        Dict con item_name -> { taxes: [...], iva_rate: float or None }
    """
    if not item_names:
        return {}

    result = {}

    try:
        # Inicializar resultado vacío para todos los items
        for item_name in item_names:
            result[item_name] = {'taxes': [], 'iva_rate': None}

        # Consultar Item Tax (tabla hija) para todos los items
        # Usando POST a frappe.client.get_list para evitar PermissionError
        batch_size = 50
        all_item_taxes = []

        for i in range(0, len(item_names), batch_size):
            batch = item_names[i:i + batch_size]

            # Usar POST a frappe.client.get_list para consultar child tablas
            response, error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.get_list",
                data={
                    "doctype": "Item Tax",
                    "parent": "Item",
                    "fields": ["parent", "item_tax_template"],
                    "filters": [
                        ["parent", "in", batch],
                        ["parenttype", "=", "Item"]
                    ],
                    "limit_page_length": 5000
                },
                operation_name=f"Bulk fetch Item Tax (batch {i // batch_size + 1})"
            )

            if not error and response and response.status_code == 200:
                # frappe.client.get_list devuelve en "message", no en "data"
                data = response.json().get('message', [])
                all_item_taxes.extend(data)

        if not all_item_taxes:
            print("No se encontraron Item Tax para los items consultados")
            return result

        # Agrupar taxes por item
        item_taxes_map = {}  # item_name -> [template_names]
        template_names_set = set()

        for tax_row in all_item_taxes:
            parent = tax_row.get('parent')
            template = tax_row.get('item_tax_template')
            if parent and template:
                if parent not in item_taxes_map:
                    item_taxes_map[parent] = []
                item_taxes_map[parent].append(template)
                template_names_set.add(template)

        # Obtener las tasas de cada template usando frappe.client.get_list
        template_rates = {}  # template_name -> iva_rate

        if template_names_set:
            template_names_list = list(template_names_set)

            for i in range(0, len(template_names_list), batch_size):
                batch = template_names_list[i:i + batch_size]

                # Usar POST a frappe.client.get_list para consultar child tables
                response, error = make_erpnext_request(
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

                if not error and response and response.status_code == 200:
                    # frappe.client.get_list devuelve en "message", no en "data"
                    details = response.json().get('message', [])
                    for detail in details:
                        parent = detail.get('parent')
                        tax_rate = detail.get('tax_rate')
                        if parent and tax_rate is not None and parent not in template_rates:
                            try:
                                template_rates[parent] = float(tax_rate)
                            except (ValueError, TypeError):
                                pass

        # Construir resultado final
        for item_name, templates in item_taxes_map.items():
            taxes_list = []
            iva_rate = None

            for template in templates:
                taxes_list.append({'item_tax_template': template})
                # Usar la primera tasa encontrada
                if iva_rate is None and template in template_rates:
                    iva_rate = template_rates[template]

            result[item_name] = {
                'taxes': taxes_list,
                'iva_rate': iva_rate
            }

        print(f"✅ Tasas de IVA obtenidas para {len(item_taxes_map)} items")
        return result

    except Exception as e:
        print(f"Error en fetch_item_iva_rates_bulk: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return result
