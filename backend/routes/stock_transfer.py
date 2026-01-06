"""
Módulo para transferencias de stock entre almacenes.
Crea Stock Entry con propósito "Material Transfer" en ERPNext.
"""

from flask import Blueprint, request, jsonify
import traceback
from datetime import datetime

from utils.http_utils import handle_erpnext_error, make_erpnext_request
from routes.auth_utils import get_session_with_auth
from routes.general import get_company_abbr, get_smart_limit
from routes.inventory_utils import fetch_bin_stock, round_qty

stock_transfer_bp = Blueprint('stock_transfer', __name__)


@stock_transfer_bp.route('/api/stock/warehouse-transfer', methods=['POST'])
def create_warehouse_transfer():
    """
    Crear una transferencia de stock entre depósitos (Material Transfer).
    
    Payload esperado:
    {
        "company": "Mi Empresa SA",
        "source_warehouse": "Almacén Principal - COMP",
        "target_warehouse": "Taller - COMP",
        "items": [
            {"item_code": "ITEM-001", "qty": 5, "uom": "Unit"},
            {"item_code": "ITEM-002", "qty": 3}
        ],
        "posting_date": "2025-11-28"  // Opcional, por defecto hoy
    }
    """
    print("\n--- Petición para crear transferencia de stock (Material Transfer) ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        
        # Validar campos requeridos
        company = data.get('company')
        source_warehouse = data.get('source_warehouse')
        target_warehouse = data.get('target_warehouse')
        items = data.get('items', [])
        posting_date = data.get('posting_date', datetime.now().strftime('%Y-%m-%d'))
        
        if not company:
            return jsonify({"success": False, "message": "Campo requerido faltante: company"}), 400
        if not source_warehouse:
            return jsonify({"success": False, "message": "Campo requerido faltante: source_warehouse"}), 400
        if not target_warehouse:
            return jsonify({"success": False, "message": "Campo requerido faltante: target_warehouse"}), 400
        if not items or len(items) == 0:
            return jsonify({"success": False, "message": "Debe incluir al menos un item para transferir"}), 400
        
        if source_warehouse == target_warehouse:
            return jsonify({"success": False, "message": "El almacén origen y destino no pueden ser el mismo"}), 400
        
        # Obtener abreviatura de la compañía
        company_abbr = get_company_abbr(session, headers, company)
        
        # Construir items para el Stock Entry
        stock_entry_items = []
        for idx, item in enumerate(items):
            item_code = item.get('item_code')
            qty = item.get('qty')
            uom = item.get('uom', 'Unit')
            
            if not item_code:
                return jsonify({"success": False, "message": f"Item {idx + 1}: falta item_code"}), 400
            if not qty or float(qty) <= 0:
                return jsonify({"success": False, "message": f"Item {idx + 1}: qty debe ser mayor a 0"}), 400
            
            # Construir código completo del item si no tiene ya la abreviatura
            full_item_code = item_code
            if company_abbr and not item_code.endswith(f" - {company_abbr}"):
                full_item_code = f"{item_code} - {company_abbr}"
            
            stock_entry_items.append({
                "item_code": full_item_code,
                "qty": float(qty),
                "s_warehouse": source_warehouse,
                "t_warehouse": target_warehouse,
                "uom": uom,
                "transfer_qty": float(qty)
            })
        
        # Crear el Stock Entry
        stock_entry_data = {
            "doctype": "Stock Entry",
            "stock_entry_type": "Material Transfer",
            "purpose": "Material Transfer",
            "posting_date": posting_date,
            "posting_time": datetime.now().strftime('%H:%M:%S'),
            "set_posting_time": 1,
            "company": company,
            "from_warehouse": source_warehouse,
            "to_warehouse": target_warehouse,
            "items": stock_entry_items
        }
        
        print(f"--- Creando Stock Entry con {len(stock_entry_items)} items ---")
        print(f"    Origen: {source_warehouse}")
        print(f"    Destino: {target_warehouse}")
        
        # Crear el documento en estado borrador primero
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Stock Entry",
            operation_name="Create Stock Transfer (Draft)",
            data={"data": stock_entry_data}
        )
        
        if error or not response or response.status_code not in [200, 201]:
            print(f"--- Error al crear Stock Entry: {error}")
            return handle_erpnext_error(error, "Error al crear transferencia de stock")
        
        created_entry = response.json().get('data', {})
        entry_name = created_entry.get('name')
        
        print(f"--- Stock Entry creado: {entry_name} (borrador)")
        
        # Enviar el documento (docstatus = 1)
        submit_response, submit_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Stock Entry/{entry_name}",
            operation_name="Submit Stock Transfer",
            data={"data": {"docstatus": 1}}
        )
        
        if submit_error or not submit_response or submit_response.status_code not in [200, 201]:
            print(f"--- Error al enviar Stock Entry: {submit_error}")
            # Si falla el envío, intentar cancelar/borrar el borrador
            return handle_erpnext_error(submit_error, "Error al confirmar transferencia de stock")
        
        submitted_entry = submit_response.json().get('data', {})
        
        print(f"--- Stock Entry enviado exitosamente: {entry_name} ---")
        
        return jsonify({
            "success": True,
            "message": f"Transferencia de stock creada: {entry_name}",
            "data": {
                "name": entry_name,
                "docstatus": 1,
                "source_warehouse": source_warehouse,
                "target_warehouse": target_warehouse,
                "items_count": len(stock_entry_items),
                "posting_date": posting_date
            }
        })

    except Exception as e:
        print(f"Error en create_warehouse_transfer: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@stock_transfer_bp.route('/api/stock/item-warehouse-qty', methods=['POST'])
def get_item_warehouse_qty():
    """
    Obtener la cantidad disponible de items específicos en un almacén.
    
    Payload esperado:
    {
        "company": "Mi Empresa SA",
        "warehouse": "Almacén Principal - COMP",
        "item_codes": ["ITEM-001", "ITEM-002"]
    }
    """
    print("\n--- Petición para obtener cantidades por almacén ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        
        company = data.get('company')
        warehouse = data.get('warehouse')
        item_codes = data.get('item_codes', [])
        
        if not company:
            return jsonify({"success": False, "message": "Campo requerido: company"}), 400
        if not warehouse:
            return jsonify({"success": False, "message": "Campo requerido: warehouse"}), 400
        if not item_codes:
            return jsonify({"success": False, "message": "Campo requerido: item_codes"}), 400
        
        company_abbr = get_company_abbr(session, headers, company)
        
        # Construir códigos completos
        full_codes = []
        code_mapping = {}  # full_code -> display_code
        for code in item_codes:
            if company_abbr and not code.endswith(f" - {company_abbr}"):
                full_code = f"{code} - {company_abbr}"
            else:
                full_code = code
            full_codes.append(full_code)
            code_mapping[full_code] = code
        
        # Usar fetch_bin_stock para obtener stock
        stock_map = fetch_bin_stock(session, headers, full_codes, company)
        
        # Procesar resultados filtrando por almacén específico
        result = {}
        for full_code, stock_data in stock_map.items():
            display_code = code_mapping.get(full_code, full_code)
            
            # Buscar el bin correspondiente al almacén solicitado
            qty_in_warehouse = 0
            for bin_entry in stock_data.get('bins', []):
                if bin_entry.get('warehouse') == warehouse:
                    # Usar available_qty que ya resta reserved_qty
                    # Si no existe, calcular: actual_qty - reserved_qty
                    if 'available_qty' in bin_entry:
                        qty_in_warehouse = round_qty(bin_entry.get('available_qty', 0))
                    else:
                        actual = round_qty(bin_entry.get('actual_qty', 0))
                        reserved = round_qty(bin_entry.get('reserved_qty', 0))
                        qty_in_warehouse = round_qty(actual - reserved)
                    break
            
            result[display_code] = {
                "item_code": display_code,
                "full_item_code": full_code,
                "warehouse": warehouse,
                "available_qty": qty_in_warehouse
            }
        
        # Agregar items que no se encontraron con qty = 0
        for code in item_codes:
            if code not in result:
                result[code] = {
                    "item_code": code,
                    "full_item_code": f"{code} - {company_abbr}" if company_abbr else code,
                    "warehouse": warehouse,
                    "available_qty": 0
                }
        
        return jsonify({
            "success": True,
            "data": result
        })

    except Exception as e:
        print(f"Error en get_item_warehouse_qty: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
