"""
Módulo de reportes de inventario.
Proporciona endpoints para generar reportes estándar de inventario:
- Stock por almacén (Bin Report)
- Movimientos de items (Stock Ledger Entry)
- Stock Balance (Stock Balance Report)
- Valorización de inventario
"""

from flask import Blueprint, request, jsonify
import json
from urllib.parse import quote
from datetime import datetime, timedelta
import io
import pandas as pd

from utils.http_utils import handle_erpnext_error, make_erpnext_request
from routes.auth_utils import get_session_with_auth
from routes.general import get_company_abbr, remove_company_abbr, get_smart_limit
from routes.inventory_utils import round_qty

inventory_reports_bp = Blueprint('inventory_reports', __name__)


def _get_company_leaf_warehouses(session, company):
    """Return leaf Warehouse names for the given company (no groups, not disabled).

    Some ERPNext instances don't allow filtering Bin by `company` directly (Bin has no company field),
    so we filter by the company's warehouses instead.
    """
    try:
        if not company:
            return []

        filters = [
            ["company", "=", company],
            ["disabled", "=", 0],
            ["is_group", "=", 0]
        ]
        params = {
            "fields": json.dumps(["name"]),
            "filters": json.dumps(filters),
            "limit_page_length": 2000
        }
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Warehouse",
            params=params,
            operation_name="Get company warehouses for Bin filtering"
        )
        if err or not resp or resp.status_code != 200:
            return []

        rows = resp.json().get("data", []) or []
        return [r.get("name") for r in rows if r.get("name")]
    except Exception:
        return []


@inventory_reports_bp.route('/api/reports/inventory/stock-by-warehouse', methods=['GET'])
def get_stock_by_warehouse():
    """
    Reporte: Stock disponible por almacén.
    Basado en el reporte estándar "Stock Balance" de ERPNext.
    
    Query params:
    - company: Nombre de la empresa (requerido)
    - warehouse: Filtrar por almacén específico (opcional)
    - item_group: Filtrar por grupo de items (opcional)
    - search: Buscar por código o nombre de item (opcional)
    """
    print("\n--- Reporte: Stock por Almacén ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = request.args.get('company', '').strip()
        if not company:
            return jsonify({"success": False, "message": "Se requiere empresa"}), 400
        
        warehouse = request.args.get('warehouse', '').strip()
        item_group = request.args.get('item_group', '').strip()
        search_term = request.args.get('search', '').strip()
        
        company_abbr = get_company_abbr(session, headers, company)
        
        # Obtener todos los bins (stock en almacenes)
        # NOTE: Bin does not reliably expose a `company` field for filtering on some ERPNext versions.
        # Filter by the company's warehouses instead.
        if warehouse:
            filters = [["warehouse", "=", warehouse]]
        else:
            company_warehouses = _get_company_leaf_warehouses(session, company)
            if not company_warehouses:
                return jsonify({"success": True, "data": [], "total": 0})
            filters = [["warehouse", "in", company_warehouses]]
        
        # Excluir bins con qty = 0
        filters.append(["actual_qty", ">", 0])
        
        fields = [
            "name",
            "item_code",
            "warehouse",
            "actual_qty",
            "reserved_qty",
            "ordered_qty",
            "indented_qty",
            "planned_qty",
            "projected_qty",
            "stock_uom",
            "valuation_rate"
        ]
        
        limit = get_smart_limit(company, 'list')
        params = {
            "fields": json.dumps(fields),
            "filters": json.dumps(filters),
            "limit_page_length": limit
        }
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bin",
            params=params,
            operation_name="Fetch stock bins"
        )
        
        if error:
            return handle_erpnext_error(error, "Error al obtener stock por almacén")
        
        bins = response.json().get("data", [])
        print(f"Bins obtenidos: {len(bins)}")
        
        # Obtener información de items (nombre, grupo, etc.)
        item_codes = list(set([b["item_code"] for b in bins if b.get("item_code")]))
        
        items_map = {}
        if item_codes:
            # Fetch items en lotes
            batch_size = 100
            for i in range(0, len(item_codes), batch_size):
                batch = item_codes[i:i+batch_size]
                
                item_filters = [
                    ["item_code", "in", batch],
                    ["custom_company", "=", company],
                    ["disabled", "=", 0],
                    ["docstatus", "in", [0, 1]]
                ]
                if item_group:
                    item_filters.append(["item_group", "=", item_group])
                
                item_params = {
                    "fields": json.dumps([
                        "item_code",
                        "item_name",
                        "item_group",
                        "stock_uom",
                        "description"
                    ]),
                    "filters": json.dumps(item_filters),
                    "limit_page_length": batch_size
                }
                
                item_response, item_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Item",
                    params=item_params,
                    operation_name=f"Fetch items batch {i//batch_size + 1}"
                )
                
                if not item_error and item_response:
                    items_data = item_response.json().get("data", [])
                    for item in items_data:
                        items_map[item["item_code"]] = item
        
        # Construir respuesta combinando bins con info de items
        result = []
        for bin_entry in bins:
            item_code = bin_entry.get("item_code")
            item_info = items_map.get(item_code, {})
            
            # Aplicar filtro de búsqueda si existe
            if search_term:
                item_name = item_info.get("item_name", "")
                if not (search_term.lower() in item_code.lower() or 
                       search_term.lower() in item_name.lower()):
                    continue
            
            # Limpiar código de item
            display_code = remove_company_abbr(item_code, company_abbr)
            
            # Calcular cantidad disponible (actual - reserved)
            actual_qty = round_qty(bin_entry.get("actual_qty", 0))
            reserved_qty = round_qty(bin_entry.get("reserved_qty", 0))
            available_qty = round_qty(actual_qty - reserved_qty)
            
            result.append({
                "item_code": display_code,
                "full_item_code": item_code,
                "item_name": item_info.get("item_name", ""),
                "item_group": item_info.get("item_group", ""),
                "warehouse": bin_entry.get("warehouse", ""),
                "actual_qty": actual_qty,
                "reserved_qty": reserved_qty,
                "available_qty": available_qty,
                "ordered_qty": round_qty(bin_entry.get("ordered_qty", 0)),
                "projected_qty": round_qty(bin_entry.get("projected_qty", 0)),
                "stock_uom": bin_entry.get("stock_uom", item_info.get("stock_uom", "")),
                "valuation_rate": round_qty(bin_entry.get("valuation_rate", 0)),
                "stock_value": round_qty(actual_qty * bin_entry.get("valuation_rate", 0))
            })
        
        print(f"Registros de stock retornados: {len(result)}")
        
        return jsonify({
            "success": True,
            "data": result,
            "total": len(result)
        })
    
    except Exception as e:
        print(f"Error en stock-by-warehouse: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@inventory_reports_bp.route('/api/reports/inventory/item-movements', methods=['GET'])
def get_item_movements():
    """
    Reporte: Movimientos de items (Stock Ledger Entry).
    Muestra el historial de movimientos de inventario para items seleccionados.
    
    Query params:
    - company: Nombre de la empresa (requerido)
    - item_codes: Códigos de items separados por coma (requerido)
    - from_date: Fecha inicio (formato YYYY-MM-DD, opcional, default: hace 30 días)
    - to_date: Fecha fin (formato YYYY-MM-DD, opcional, default: hoy)
    - warehouse: Filtrar por almacén (opcional)
    - voucher_type: Filtrar por tipo de documento (opcional)
    """
    print("\n--- Reporte: Movimientos de Items ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = request.args.get('company', '').strip()
        item_codes_str = request.args.get('item_codes', '').strip()
        
        if not company:
            return jsonify({"success": False, "message": "Se requiere empresa"}), 400
        
        if not item_codes_str:
            return jsonify({"success": False, "message": "Se requiere al menos un item"}), 400
        
        # Parsear códigos de items
        item_codes = [code.strip() for code in item_codes_str.split(',') if code.strip()]
        if not item_codes:
            return jsonify({"success": False, "message": "No se proporcionaron códigos válidos"}), 400
        
        company_abbr = get_company_abbr(session, headers, company)
        
        # Convertir códigos display a códigos completos
        full_item_codes = [f"{code} - {company_abbr}" if not code.endswith(f" - {company_abbr}") else code 
                          for code in item_codes]
        
        # Fechas
        to_date = request.args.get('to_date', '').strip()
        from_date = request.args.get('from_date', '').strip()
        
        if not to_date:
            to_date = datetime.now().strftime('%Y-%m-%d')
        
        if not from_date:
            from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        
        warehouse = request.args.get('warehouse', '').strip()
        voucher_type = request.args.get('voucher_type', '').strip()
        
        # Construir filtros
        filters = [
            ["company", "=", company],
            ["item_code", "in", full_item_codes],
            ["posting_date", ">=", from_date],
            ["posting_date", "<=", to_date],
            ["docstatus", "<", 2]  # Excluir cancelados
        ]
        
        if warehouse:
            filters.append(["warehouse", "=", warehouse])
        
        if voucher_type:
            filters.append(["voucher_type", "=", voucher_type])
        
        fields = [
            "name",
            "posting_date",
            "posting_time",
            "item_code",
            "warehouse",
            "actual_qty",
            "qty_after_transaction",
            "stock_uom",
            "incoming_rate",
            "valuation_rate",
            "stock_value",
            "stock_value_difference",
            "voucher_type",
            "voucher_no",
            "voucher_detail_no",
            "batch_no",
            "serial_no",
            "company"
        ]
        
        limit = get_smart_limit(company, 'list')
        params = {
            "fields": json.dumps(fields),
            "filters": json.dumps(filters),
            "order_by": "posting_date desc, posting_time desc, creation desc",
            "limit_page_length": limit
        }
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Stock Ledger Entry",
            params=params,
            operation_name="Fetch stock ledger entries"
        )
        
        if error:
            return handle_erpnext_error(error, "Error al obtener movimientos de items")
        
        entries = response.json().get("data", [])
        print(f"Movimientos obtenidos: {len(entries)}")
        
        # Procesar y limpiar datos
        result = []
        for entry in entries:
            item_code = entry.get("item_code", "")
            display_code = remove_company_abbr(item_code, company_abbr)
            
            result.append({
                "name": entry.get("name"),
                "posting_date": entry.get("posting_date"),
                "posting_time": entry.get("posting_time"),
                "item_code": display_code,
                "full_item_code": item_code,
                "warehouse": entry.get("warehouse", ""),
                "actual_qty": round_qty(entry.get("actual_qty", 0)),
                "qty_after_transaction": round_qty(entry.get("qty_after_transaction", 0)),
                "stock_uom": entry.get("stock_uom", ""),
                "incoming_rate": round_qty(entry.get("incoming_rate", 0)),
                "valuation_rate": round_qty(entry.get("valuation_rate", 0)),
                "stock_value": round_qty(entry.get("stock_value", 0)),
                "stock_value_difference": round_qty(entry.get("stock_value_difference", 0)),
                "voucher_type": entry.get("voucher_type", ""),
                "voucher_no": entry.get("voucher_no", ""),
                "batch_no": entry.get("batch_no", ""),
                "serial_no": entry.get("serial_no", "")
            })
        
        print(f"Movimientos retornados: {len(result)}")
        
        return jsonify({
            "success": True,
            "data": result,
            "total": len(result),
            "from_date": from_date,
            "to_date": to_date
        })
    
    except Exception as e:
        print(f"Error en item-movements: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@inventory_reports_bp.route('/api/reports/inventory/warehouses', methods=['GET'])
def get_warehouses():
    """
    Obtiene la lista de almacenes disponibles para la empresa.
    
    Query params:
    - company: Nombre de la empresa (requerido)
    """
    print("\n--- Obtener lista de almacenes ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = request.args.get('company', '').strip()
        if not company:
            return jsonify({"success": False, "message": "Se requiere empresa"}), 400
        
        filters = [
            ["company", "=", company],
            ["disabled", "=", 0]
        ]
        
        fields = [
            "name",
            "warehouse_name",
            "warehouse_type",
            "is_group",
            "parent_warehouse",
            "company"
        ]
        
        params = {
            "fields": json.dumps(fields),
            "filters": json.dumps(filters),
            "limit_page_length": 500
        }
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Warehouse",
            params=params,
            operation_name="Fetch warehouses"
        )
        
        if error:
            return handle_erpnext_error(error, "Error al obtener almacenes")
        
        warehouses = response.json().get("data", [])
        
        print(f"Almacenes obtenidos: {len(warehouses)}")
        
        return jsonify({
            "success": True,
            "data": warehouses
        })
    
    except Exception as e:
        print(f"Error en get_warehouses: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@inventory_reports_bp.route('/api/reports/inventory/export-stock-xlsx', methods=['GET'])
def export_stock_to_xlsx():
    """
    Exporta el reporte de stock por almacén a Excel.
    
    Query params: mismos que stock-by-warehouse
    """
    print("\n--- Exportar Stock a Excel ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = request.args.get('company', '').strip()
        if not company:
            return jsonify({"success": False, "message": "Se requiere empresa"}), 400
        
        warehouse = request.args.get('warehouse', '').strip()
        
        # Reutilizar la lógica del endpoint principal
        # (En producción, considerar extraer la lógica a una función compartida)
        
        from flask import make_response
        
        company_abbr = get_company_abbr(session, headers, company)
        
        # NOTE: Bin does not reliably expose a `company` field for filtering on some ERPNext versions.
        if warehouse:
            filters = [["warehouse", "=", warehouse]]
        else:
            company_warehouses = _get_company_leaf_warehouses(session, company)
            if not company_warehouses:
                # Return an empty excel file (headers only)
                from flask import make_response
                df = pd.DataFrame([])
                output = io.BytesIO()
                with pd.ExcelWriter(output, engine='openpyxl') as writer:
                    df.to_excel(writer, index=False, sheet_name='Stock por Almacén')
                output.seek(0)
                response = make_response(output.getvalue())
                response.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                response.headers['Content-Disposition'] = f'attachment; filename=Stock_por_Almacen_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
                return response
            filters = [["warehouse", "in", company_warehouses]]
        filters.append(["actual_qty", ">", 0])
        
        fields = [
            "item_code",
            "warehouse",
            "actual_qty",
            "reserved_qty",
            "ordered_qty",
            "projected_qty",
            "stock_uom",
            "valuation_rate"
        ]
        
        limit = get_smart_limit(company, 'list')
        params = {
            "fields": json.dumps(fields),
            "filters": json.dumps(filters),
            "limit_page_length": limit
        }
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bin",
            params=params,
            operation_name="Fetch bins for export"
        )
        
        if error:
            return handle_erpnext_error(error, "Error al exportar stock")
        
        bins = response.json().get("data", [])
        
        # Crear DataFrame
        data_for_excel = []
        for bin_entry in bins:
            item_code = bin_entry.get("item_code", "")
            display_code = remove_company_abbr(item_code, company_abbr)
            
            actual_qty = round_qty(bin_entry.get("actual_qty", 0))
            reserved_qty = round_qty(bin_entry.get("reserved_qty", 0))
            available_qty = round_qty(actual_qty - reserved_qty)
            
            data_for_excel.append({
                "Código Item": display_code,
                "Almacén": bin_entry.get("warehouse", ""),
                "Cantidad Actual": actual_qty,
                "Cantidad Reservada": reserved_qty,
                "Cantidad Disponible": available_qty,
                "Cantidad Pedida": round_qty(bin_entry.get("ordered_qty", 0)),
                "Cantidad Proyectada": round_qty(bin_entry.get("projected_qty", 0)),
                "UOM": bin_entry.get("stock_uom", ""),
                "Tasa Valoración": round_qty(bin_entry.get("valuation_rate", 0)),
                "Valor Stock": round_qty(actual_qty * bin_entry.get("valuation_rate", 0))
            })
        
        df = pd.DataFrame(data_for_excel)
        
        # Crear archivo Excel en memoria
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Stock por Almacén')
        
        output.seek(0)
        
        filename = f"Stock_por_Almacen_{company.replace(' ', '_')}"
        if warehouse:
            filename += f"_{warehouse.replace(' ', '_')}"
        filename += f"_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        
        response = make_response(output.getvalue())
        response.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        response.headers['Content-Disposition'] = f'attachment; filename={filename}'
        
        print(f"Archivo Excel generado: {filename}")
        
        return response
    
    except Exception as e:
        print(f"Error en export_stock_to_xlsx: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@inventory_reports_bp.route('/api/reports/inventory/export-movements-xlsx', methods=['GET'])
def export_movements_to_xlsx():
    """
    Exporta el reporte de movimientos de items a Excel.
    
    Query params: mismos que item-movements
    """
    print("\n--- Exportar Movimientos a Excel ---")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = request.args.get('company', '').strip()
        item_codes_str = request.args.get('item_codes', '').strip()
        
        if not company or not item_codes_str:
            return jsonify({"success": False, "message": "Se requiere empresa e items"}), 400
        
        from flask import make_response
        
        item_codes = [code.strip() for code in item_codes_str.split(',') if code.strip()]
        company_abbr = get_company_abbr(session, headers, company)
        
        full_item_codes = [f"{code} - {company_abbr}" if not code.endswith(f" - {company_abbr}") else code 
                          for code in item_codes]
        
        to_date = request.args.get('to_date', datetime.now().strftime('%Y-%m-%d'))
        from_date = request.args.get('from_date', (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d'))
        warehouse = request.args.get('warehouse', '').strip()
        
        filters = [
            ["company", "=", company],
            ["item_code", "in", full_item_codes],
            ["posting_date", ">=", from_date],
            ["posting_date", "<=", to_date],
            ["docstatus", "<", 2]
        ]
        
        if warehouse:
            filters.append(["warehouse", "=", warehouse])
        
        fields = [
            "posting_date",
            "posting_time",
            "item_code",
            "warehouse",
            "actual_qty",
            "qty_after_transaction",
            "stock_uom",
            "valuation_rate",
            "stock_value_difference",
            "voucher_type",
            "voucher_no"
        ]
        
        limit = get_smart_limit(company, 'list')
        params = {
            "fields": json.dumps(fields),
            "filters": json.dumps(filters),
            "order_by": "posting_date desc, posting_time desc",
            "limit_page_length": limit
        }
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Stock Ledger Entry",
            params=params,
            operation_name="Fetch movements for export"
        )
        
        if error:
            return handle_erpnext_error(error, "Error al exportar movimientos")
        
        entries = response.json().get("data", [])
        
        data_for_excel = []
        for entry in entries:
            item_code = entry.get("item_code", "")
            display_code = remove_company_abbr(item_code, company_abbr)
            
            data_for_excel.append({
                "Fecha": entry.get("posting_date"),
                "Hora": entry.get("posting_time"),
                "Código Item": display_code,
                "Almacén": entry.get("warehouse", ""),
                "Cantidad": round_qty(entry.get("actual_qty", 0)),
                "Cantidad Después": round_qty(entry.get("qty_after_transaction", 0)),
                "UOM": entry.get("stock_uom", ""),
                "Tasa Valoración": round_qty(entry.get("valuation_rate", 0)),
                "Diferencia Valor": round_qty(entry.get("stock_value_difference", 0)),
                "Tipo Documento": entry.get("voucher_type", ""),
                "Nº Documento": entry.get("voucher_no", "")
            })
        
        df = pd.DataFrame(data_for_excel)
        
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Movimientos')
        
        output.seek(0)
        
        filename = f"Movimientos_Items_{company.replace(' ', '_')}_{from_date}_a_{to_date}.xlsx"
        
        response = make_response(output.getvalue())
        response.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        response.headers['Content-Disposition'] = f'attachment; filename={filename}'
        
        print(f"Archivo Excel generado: {filename}")
        
        return response
    
    except Exception as e:
        print(f"Error en export_movements_to_xlsx: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
