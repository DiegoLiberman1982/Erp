from flask import Blueprint, request, jsonify
import os
import requests
import json
import re
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company, get_company_abbr, add_company_abbr, remove_company_abbr, validate_company_abbr_operation

# Importar funciones de items.py para manejo de items
from routes.items import (
    process_invoice_item,
    process_purchase_invoice_item,
    find_or_create_item_by_description,
    create_item_with_description,
    create_free_item,
    get_tax_template_map,
    get_tax_template_for_rate,
    assign_tax_template_by_rate,
    determine_income_account,
    get_company_defaults
)

# Importar función para obtener cuenta específica del proveedor
from routes.suppliers import get_supplier_payable_account

# Importar funciones de comprobantes.py para evitar duplicación
from routes.comprobantes import get_next_confirmed_number_for_talonario

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from utils.comprobante_utils import get_purchase_prefix

# Importar utilidades de logging y cacheo
from utils.logging_utils import cached_function, conditional_log, log_function_call, log_search_operation, log_error, log_success
from routes.auth_utils import get_session_with_auth

# Campo de conciliación usado por los módulos de conciliación
from utils.conciliation_utils import CONCILIATION_FIELD

# Importar módulo de percepciones de compra
from routes.purchase_perceptions import build_purchase_perception_taxes, build_purchase_iva_taxes

# Crear el blueprint para las rutas de facturas de compra
purchase_invoices_bp = Blueprint('purchase_invoices', __name__)


def _map_jurisdiction_to_province_code(jurisdiccion: str) -> str:
    """
    Mapear nombre de jurisdicción del formato antiguo a código ISO de provincia.
    
    Args:
        jurisdiccion: Nombre de la jurisdicción (ej: "Buenos Aires", "CABA")
    
    Returns:
        Código ISO de provincia (ej: "AR-B", "AR-C")
    """
    if not jurisdiccion:
        return ""
    
    # Mapeo de nombres comunes a códigos ISO
    mapping = {
        "buenos aires": "AR-B",
        "caba": "AR-C",
        "capital federal": "AR-C",
        "ciudad autonoma de buenos aires": "AR-C",
        "ciudad autónoma de buenos aires": "AR-C",
        "catamarca": "AR-K",
        "chaco": "AR-H",
        "chubut": "AR-U",
        "córdoba": "AR-X",
        "cordoba": "AR-X",
        "corrientes": "AR-W",
        "entre ríos": "AR-E",
        "entre rios": "AR-E",
        "formosa": "AR-P",
        "jujuy": "AR-Y",
        "la pampa": "AR-L",
        "la rioja": "AR-F",
        "mendoza": "AR-M",
        "misiones": "AR-N",
        "neuquén": "AR-Q",
        "neuquen": "AR-Q",
        "río negro": "AR-R",
        "rio negro": "AR-R",
        "salta": "AR-A",
        "san juan": "AR-J",
        "san luis": "AR-D",
        "santa cruz": "AR-Z",
        "santa fe": "AR-S",
        "santiago del estero": "AR-G",
        "tierra del fuego": "AR-V",
        "tucumán": "AR-T",
        "tucuman": "AR-T"
    }
    
    normalized = jurisdiccion.strip().lower()
    return mapping.get(normalized, "")


def _safe_float(value):
    try:
        return float(value)
    except Exception:
        return 0.0


def _get_receipt_parent_from_detail(session, pr_detail):
    """Obtener el parent (Purchase Receipt) de un Purchase Receipt Item."""
    if not pr_detail:
        return None
    try:
        fields_str = '["parent"]'
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Receipt Item/{quote(pr_detail)}?fields={quote(fields_str)}",
            operation_name=f"Get parent receipt for detail '{pr_detail}'"
        )
        if error or response.status_code != 200:
            return None
        return response.json().get("data", {}).get("parent")
    except Exception as exc:
        print(f"--- Warning: no se pudo obtener parent para pr_detail {pr_detail}: {exc}")
        return None


def _collect_receipt_names_from_items(items, session):
    """Recolectar nombres de Purchase Receipt referenciados por los items de factura."""
    receipt_names = set()
    if not isinstance(items, list):
        return receipt_names

    for item in items:
        if not isinstance(item, dict):
            continue
        receipt = item.get("purchase_receipt")
        if receipt:
            receipt_names.add(receipt)
            continue
        pr_detail = item.get("pr_detail") or item.get("purchase_receipt_item")
        if pr_detail:
            parent = _get_receipt_parent_from_detail(session, pr_detail)
            if parent:
                receipt_names.add(parent)

    return receipt_names


def _update_receipt_estado_directo(session, headers, receipt_name, nuevo_estado):
    """
    Actualiza directamente el campo custom_estado_remito de un Purchase Receipt.
    NO usa per_billed - el estado se determina por la lógica de negocio del caller.
    
    Valores válidos para nuevo_estado:
    - "Recibido pendiente de factura"
    - "Facturado parcialmente"  
    - "Facturado completamente"
    - "Anulado"
    """
    if not receipt_name or not nuevo_estado:
        return False
    
    try:
        # Verificar el estado actual
        fields_str = '["name","docstatus","custom_estado_remito"]'
        receipt_response, receipt_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Receipt/{quote(receipt_name)}?fields={quote(fields_str)}",
            operation_name=f"Get Purchase Receipt '{receipt_name}' for estado update"
        )
        if receipt_error or receipt_response.status_code != 200:
            print(f"⚠️ No se pudo obtener remito '{receipt_name}': {receipt_error or receipt_response.text}")
            return False

        receipt_data = receipt_response.json().get("data", {}) or {}
        current_estado = receipt_data.get("custom_estado_remito")
        docstatus = receipt_data.get("docstatus")
        
        print(f"📊 Remito '{receipt_name}': docstatus={docstatus}, estado_actual='{current_estado}' -> nuevo_estado='{nuevo_estado}'")
        
        if current_estado == nuevo_estado:
            print(f"   ✓ Estado ya es correcto, no se actualiza")
            return True

        # Actualizar el campo custom
        update_payload = {"data": {"custom_estado_remito": nuevo_estado}}
        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Purchase Receipt/{quote(receipt_name)}",
            data=update_payload,
            custom_headers=headers,
            operation_name=f"Update estado remito '{receipt_name}' -> {nuevo_estado}"
        )
        if update_error or update_response.status_code not in (200, 202):
            print(f"⚠️ No se pudo actualizar estado de remito '{receipt_name}': {update_error or update_response.text}")
            return False
        
        print(f"   ✅ Estado actualizado a '{nuevo_estado}'")
        return True
        
    except Exception as exc:
        print(f"⚠️ Error actualizando estado de remito '{receipt_name}': {exc}")
        return False


def refresh_receipt_states_to_pending(session, headers, receipt_names):
    """
    Revertir remitos a 'Recibido pendiente de factura' cuando se cancela una factura.
    Solo revierte si el remito no está anulado.
    """
    if not receipt_names:
        return
    for receipt_name in receipt_names:
        # Verificar que el remito no esté anulado antes de revertir
        try:
            fields_str = '["docstatus","custom_estado_remito"]'
            receipt_response, _ = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Receipt/{quote(receipt_name)}?fields={quote(fields_str)}",
                operation_name=f"Check receipt '{receipt_name}' status before reverting"
            )
            if receipt_response and receipt_response.status_code == 200:
                data = receipt_response.json().get("data", {})
                if data.get("docstatus") == 2:
                    print(f"   ⏭️ Remito '{receipt_name}' está anulado, no se revierte estado")
                    continue
        except Exception:
            pass
        
        _update_receipt_estado_directo(session, headers, receipt_name, "Recibido pendiente de factura")


def update_receipts_to_billed(session, headers, receipt_names):
    """Marcar remitos como 'Facturado completamente' al crear/confirmar factura."""
    if not receipt_names:
        return
    for receipt_name in receipt_names:
        _update_receipt_estado_directo(session, headers, receipt_name, "Facturado completamente")


def update_receipt_states_from_invoice_items(session, headers, items):
    """Actualizar estados custom de remitos a 'Facturado completamente' al crear factura."""
    receipt_names = _collect_receipt_names_from_items(items, session)
    if receipt_names:
        print(f"🔄 Actualizando estado de remitos vinculados a 'Facturado completamente': {sorted(receipt_names)}")
        update_receipts_to_billed(session, headers, receipt_names)


def _create_auto_purchase_receipt(session, headers, items_without_receipt, supplier, company, posting_date, company_abbr):
    """
    Crea un Purchase Receipt automático para items de stock que no tienen remito vinculado.
    Retorna el nombre del PR creado y la lista de items con sus pr_detail asignados.
    """
    if not items_without_receipt:
        return None, []
    
    print(f"📦 Creando Purchase Receipt automático para {len(items_without_receipt)} items sin remito")
    
    # Preparar items para el Purchase Receipt
    pr_items = []
    for item in items_without_receipt:
        pr_item = {
            "item_code": item.get("item_code"),
            "item_name": item.get("item_name") or item.get("item_code"),
            "description": item.get("description") or item.get("item_name") or item.get("item_code"),
            "qty": float(item.get("qty") or 1),
            "rate": float(item.get("rate") or 0),
            "warehouse": item.get("warehouse"),
            "uom": item.get("uom") or "Unidad",
            "stock_uom": item.get("uom") or "Unidad",
            "conversion_factor": 1
        }
        pr_items.append(pr_item)
    
    # Crear el Purchase Receipt
    pr_body = {
        "supplier": supplier,
        "company": company,
        "posting_date": posting_date,
        "posting_time": "00:00:00",
        "items": pr_items,
        # Campo custom para identificar que fue auto-generado desde factura
        "custom_auto_generado_desde_factura": 1,
        "custom_estado_remito": "Facturado completamente"  # Ya se facturará inmediatamente
    }
    
    # Usar naming series automático
    pr_body["naming_series"] = "MAT-PRE-.YYYY.-"
    
    print(f"📦 Enviando PR automático con {len(pr_items)} items...")
    
    create_response, create_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Purchase Receipt",
        data={"data": pr_body},
        operation_name="Create auto Purchase Receipt for unlinked items"
    )
    
    if create_error:
        print(f"❌ Error creando PR automático: {create_error}")
        return None, []
    
    if create_response.status_code not in [200, 201]:
        print(f"❌ Error creando PR automático: {create_response.status_code} - {create_response.text}")
        return None, []
    
    pr_result = create_response.json()
    pr_name = pr_result.get("data", {}).get("name")
    pr_items_created = pr_result.get("data", {}).get("items", [])
    
    print(f"✅ Purchase Receipt automático creado: {pr_name}")
    
    # Confirmar (submit) el Purchase Receipt
    submit_response, submit_error = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/Purchase Receipt/{quote(pr_name)}",
        data={"docstatus": 1},
        operation_name=f"Submit auto Purchase Receipt '{pr_name}'"
    )
    
    if submit_error or submit_response.status_code != 200:
        print(f"⚠️ Error confirmando PR automático: {submit_error or submit_response.text}")
        # Intentar eliminar el borrador creado
        make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Purchase Receipt/{quote(pr_name)}",
            operation_name=f"Delete failed auto Purchase Receipt '{pr_name}'"
        )
        return None, []
    
    print(f"✅ Purchase Receipt automático confirmado: {pr_name}")
    
    # Obtener los pr_detail de los items creados
    # Necesitamos volver a obtener el PR para tener los names de los items
    get_response, get_error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Purchase Receipt/{quote(pr_name)}",
        operation_name=f"Get auto Purchase Receipt '{pr_name}' for item details"
    )
    
    if get_error or get_response.status_code != 200:
        print(f"⚠️ No se pudieron obtener detalles del PR automático")
        return pr_name, []
    
    pr_data = get_response.json().get("data", {})
    pr_items_with_names = pr_data.get("items", [])
    
    # Mapear los items originales con los pr_detail creados
    items_with_pr_links = []
    for idx, original_item in enumerate(items_without_receipt):
        if idx < len(pr_items_with_names):
            pr_item = pr_items_with_names[idx]
            updated_item = original_item.copy()
            updated_item["purchase_receipt"] = pr_name
            updated_item["pr_detail"] = pr_item.get("name")
            items_with_pr_links.append(updated_item)
            print(f"   🔗 Item {original_item.get('item_code')} vinculado a pr_detail: {pr_item.get('name')}")
        else:
            items_with_pr_links.append(original_item)
    
    return pr_name, items_with_pr_links


def _cancel_auto_purchase_receipt(session, headers, pr_name):
    """
    Anula un Purchase Receipt que fue auto-generado.
    Solo anula si tiene el campo custom_auto_generado_desde_factura = 1
    """
    if not pr_name:
        return False
    
    try:
        # Verificar que sea auto-generado
        fields_str = '["name","docstatus","custom_auto_generado_desde_factura"]'
        get_response, get_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Receipt/{quote(pr_name)}?fields={quote(fields_str)}",
            operation_name=f"Check if Purchase Receipt '{pr_name}' is auto-generated"
        )
        
        if get_error or get_response.status_code != 200:
            print(f"⚠️ No se pudo verificar PR '{pr_name}': {get_error or get_response.text}")
            return False
        
        pr_data = get_response.json().get("data", {}) or {}
        
        # Solo anular si es auto-generado
        if not pr_data.get("custom_auto_generado_desde_factura"):
            print(f"📦 PR '{pr_name}' no es auto-generado, no se anulará")
            return False
        
        # Si ya está anulado, no hacer nada
        if pr_data.get("docstatus") == 2:
            print(f"📦 PR '{pr_name}' ya está anulado")
            return True
        
        # Anular el Purchase Receipt
        print(f"🗑️ Anulando Purchase Receipt auto-generado: {pr_name}")
        cancel_response, cancel_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.cancel",
            data={"doctype": "Purchase Receipt", "name": pr_name},
            operation_name=f"Cancel auto Purchase Receipt '{pr_name}'"
        )
        
        if cancel_error or cancel_response.status_code != 200:
            print(f"⚠️ Error anulando PR auto-generado '{pr_name}': {cancel_error or cancel_response.text}")
            return False
        
        print(f"✅ Purchase Receipt auto-generado anulado: {pr_name}")
        return True
        
    except Exception as exc:
        print(f"⚠️ Error inesperado anulando PR auto-generado '{pr_name}': {exc}")
        return False


def _collect_auto_generated_receipts(items, session):
    """
    Recolecta los Purchase Receipts auto-generados vinculados a los items.
    
    Un PR se considera auto-generado si tiene el campo custom_auto_generado_desde_factura = 1
    """
    auto_receipts = set()
    receipt_names = _collect_receipt_names_from_items(items, session)
    
    for receipt_name in receipt_names:
        try:
            fields_str = '["name","custom_auto_generado_desde_factura"]'
            get_response, get_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Receipt/{quote(receipt_name)}?fields={quote(fields_str)}",
                operation_name=f"Check if PR '{receipt_name}' is auto-generated"
            )
            
            if get_error or get_response.status_code != 200:
                print(f"   ⚠️ No se pudo verificar PR '{receipt_name}': {get_error or get_response.text}")
                continue
            
            pr_data = get_response.json().get("data", {}) or {}
            is_auto = pr_data.get("custom_auto_generado_desde_factura") in (1, "1", True)
            
            print(f"   🔍 PR '{receipt_name}': custom_auto_generado_desde_factura={pr_data.get('custom_auto_generado_desde_factura')} -> auto={is_auto}")
            
            if is_auto:
                auto_receipts.add(receipt_name)
                
        except Exception as exc:
            print(f"   ⚠️ Error verificando PR '{receipt_name}': {exc}")
            continue
    
    return auto_receipts


def _parse_docstatus(value, default=None):
    """Convertir docstatus a int si es posible."""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def _is_cancel_request(data):
    """Detectar si el payload representa una solicitud de anulación."""
    if not isinstance(data, dict):
        return False
    status_raw = str(data.get('status', '')).strip().lower()
    docstatus_raw = data.get('docstatus')
    docstatus_int = _parse_docstatus(docstatus_raw, None)
    if status_raw in {'anulada', 'anulado', 'cancelada', 'cancelado', 'cancelled'}:
        return True
    if docstatus_int == 2:
        return True
    return False

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
            print(f"⚠️ Formato de numeración inválido: {metodo_numeracion}")
            return 1
            
        # Extraer letra (posición 2) y punto de venta (posición 3)
        letra = parts[2]  # A, B, M, etc.
        punto_venta = parts[3]  # 00003
        
        # Buscar el talonario por punto de venta
        # Este es un approach simplificado - en producción podrías cachear esto
        params = {
            'filters': json.dumps([["punto_de_venta", "=", int(punto_venta)]]),
            'fields': json.dumps(["name"]),
            'limit_page_length': 1
        }
        search_response, search_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params=params,
            operation_name="Search talonario by punto_venta"
        )
        
        if search_error:
            print(f"⚠️ Error buscando talonario: {search_error}")
            return 1
        
        if search_response.status_code == 200:
            search_data = search_response.json()
            if search_data.get('data') and len(search_data['data']) > 0:
                talonario_name = search_data['data'][0]['name']
                return get_next_confirmed_number_for_talonario(session, headers, talonario_name, letra)
        
        print(f"⚠️ No se encontró talonario para punto de venta: {punto_venta}")
        return 1
        
    except Exception as e:
        print(f"❌ Error en wrapper: {str(e)}")
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
        params = {
            'filters': json.dumps([["metodo_numeracion_factura_venta", "=", metodo_numeracion]]),
            'fields': json.dumps(["name"]),
            'limit_page_length': 1
        }
        search_response, search_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params=params,
            operation_name="Search talonario by metodo_numeracion"
        )
        
        if search_error:
            log_error(f"Error buscando talonario: {search_error}", "update_talonario_last_number")
            return
            
        search_data = search_response.json()
        if not search_data.get('data') or len(search_data['data']) == 0:
            log_error(f"No se encontró talonario con método: {metodo_numeracion}", "update_talonario_last_number")
            return
            
        talonario_name = search_data['data'][0]['name']
        log_search_operation(f"Talonario encontrado: {talonario_name}")
        
        # Actualizar el campo ultimo_numero_utilizado
        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            data={"data": {"ultimo_numero_utilizado": last_number}},
            operation_name=f"Update talonario '{talonario_name}' last number"
        )
        
        if update_error:
            log_error(f"Error actualizando talonario: {update_error}", "update_talonario_last_number")
        elif update_response.status_code in [200, 202]:
            log_search_operation(f"Talonario {talonario_name} actualizado: último número {last_number}")
        else:
            log_error(f"Error actualizando talonario: {update_response.status_code} - {update_response.text}", "update_talonario_last_number")
            
    except Exception as e:
        log_error(f"Error actualizando talonario: {str(e)}", "update_talonario_last_number")
        import traceback
        traceback.print_exc()

@purchase_invoices_bp.route('/api/purchase-invoices', methods=['POST'])
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

    # Validación básica
    if not data.get('supplier'):
        return jsonify({"success": False, "message": "proveedor requerido"}), 400
    if not data.get('company'):
        return jsonify({"success": False, "message": "Compañía requerida"}), 400
    if not data.get('items') or len(data['items']) == 0:
        return jsonify({"success": False, "message": "Al menos un item requerido"}), 400

    try:
        # Paso 1: Obtener el mapa de templates de impuestos para la compañía
        tax_map = get_tax_template_map(session, headers, data['company'], transaction_type='purchase')
        company_abbr = get_company_abbr(session, headers, data['company'])
        company_defaults = get_company_defaults(data['company'], session, headers)
        if not company_defaults:
            return jsonify({"success": False, "message": "Error obteniendo configuración de compañía"}), 400
        
        # Paso 2: Procesar items y crear items libres si es necesario
        # Construir el set de items a procesar tomando como base la factura original:
        # - preserva los campos de vinculaci¢n (PR/PO) por item
        # - aplica cambios del frontend sobre esos items
        # - evita duplicados de item_code (ERPNext no los permite)
        # Deduplicar por item_code (con la misma normalizaci¢n de abbr que usa el loop de procesamiento)
        processed_items = []
        has_stock_items = False
        linked_purchase_receipts = set()
        
        for item in data['items']:
            processed_item = process_purchase_invoice_item(item, session, headers, data['company'], tax_map, data.get('supplier'))
            if processed_item:
                # Agregar la abbr de la compañía al código del item antes de enviar a ERPNext
                if company_abbr and not processed_item['item_code'].endswith(f' - {company_abbr}'):
                    processed_item['item_code'] = f"{processed_item['item_code']} - {company_abbr}"
                    print(f"🏷️ Item code expanded for ERPNext: {processed_item['item_code']}")
                
                # Actualizar valuation_rate en el item de ERPNext si viene configurado
                if item.get('valuation_rate') and processed_item.get('item_code'):
                    try:
                        valuation_rate_value = float(item['valuation_rate'])
                        update_data = {
                            "valuation_rate": valuation_rate_value
                        }
                        update_response, update_error = make_erpnext_request(
                            session=session,
                            method="PUT",
                            endpoint=f"/api/resource/Item/{quote(processed_item['item_code'])}",
                            data={"data": update_data},
                            operation_name=f"Update valuation rate for item '{processed_item['item_code']}'"
                        )
                        if update_error:
                            print(f"--- Warning: Could not update valuation_rate for item {processed_item['item_code']}: {update_error}")
                        elif update_response and update_response.status_code == 200:
                            print(f"--- Valuation rate updated to {valuation_rate_value} for item {processed_item['item_code']}")
                        else:
                            print(f"--- Warning: Could not update valuation_rate for item {processed_item['item_code']}: {update_response.text if update_response else 'No response'}")
                    except Exception as e:
                        print(f"--- Warning: Error updating valuation_rate for item {processed_item['item_code']}: {str(e)}")
                
                # Verificar si este item es de stock
                item_response, item_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Item/{processed_item['item_code']}",
                    operation_name=f"Check if item '{processed_item['item_code']}' is stock item"
                )

                if item_error:
                    print(f"Error verificando si item es de stock: {item_error}")
                elif item_response and item_response.status_code == 200:
                    item_data = item_response.json()['data']
                    if item_data.get('is_stock_item') == 1:
                        has_stock_items = True
                        print(f"📦 Item de stock detectado: {processed_item['item_code']}")
                        if not item.get('warehouse') or not item.get('warehouse').strip():
                            # Buscar default_warehouse en item_defaults para la compañía
                            default_warehouse = None
                            for default in item_data.get('item_defaults', []):
                                if default.get('company') == data['company']:
                                    default_warehouse = default.get('default_warehouse')
                                    break
                            if not default_warehouse:
                                default_warehouse = company_defaults.get('default_warehouse')
                            if default_warehouse:
                                item['warehouse'] = default_warehouse
                                processed_item['warehouse'] = default_warehouse
                                print(f"📦 Usando almacén por defecto: {default_warehouse} para ítem {processed_item['item_code']}")
                            else:
                                error_msg = f"El ítem {processed_item['item_code']} es un ítem de stock y requiere un almacén asignado"
                                print(f"❌ {error_msg}")
                                return jsonify({"success": False, "message": error_msg}), 400
                # Normalizar almacenes con la abreviatura de la compania
                if processed_item.get('warehouse'):
                    warehouse_name = processed_item['warehouse'].strip()
                    if warehouse_name and company_abbr:
                        normalized_warehouse = add_company_abbr(warehouse_name, company_abbr)
                        processed_item['warehouse'] = normalized_warehouse
                        item['warehouse'] = normalized_warehouse
                        print(f"??? Warehouse expanded for ERPNext: {normalized_warehouse}")

                # Conservar enlaces a remitos para que ERPNext no duplique stock
                # IMPORTANTE: Capturar todos los posibles campos de vinculación
                pr_detail_value = (
                    item.get('pr_detail') or 
                    item.get('purchase_receipt_item') or 
                    processed_item.get('pr_detail')
                )
                pr_value = (
                    item.get('purchase_receipt') or 
                    processed_item.get('purchase_receipt')
                )
                
                # Log de campos de vinculación recibidos
                if pr_detail_value or pr_value:
                    print(f"🔗 Campos de vinculación recibidos para {processed_item['item_code']}:")
                    print(f"   - purchase_receipt: {pr_value}")
                    print(f"   - pr_detail: {pr_detail_value}")
                
                if pr_detail_value:
                    processed_item['pr_detail'] = pr_detail_value
                    print(f"🔗 Set pr_detail: {pr_detail_value}")
                
                if pr_value:
                    processed_item['purchase_receipt'] = pr_value
                    linked_purchase_receipts.add(pr_value)
                    print(f"🔗 Set purchase_receipt: {pr_value}")
                
                # Si tenemos pr_detail pero no purchase_receipt, intentar recuperarlo
                if processed_item.get('pr_detail') and not processed_item.get('purchase_receipt'):
                    parent_receipt = _get_receipt_parent_from_detail(session, processed_item['pr_detail'])
                    if parent_receipt:
                        processed_item['purchase_receipt'] = parent_receipt
                        linked_purchase_receipts.add(parent_receipt)
                        print(f"🔗 Recovered purchase_receipt from pr_detail: {parent_receipt}")

                processed_items.append(processed_item)
            else:
                return jsonify({"success": False, "message": f"Error procesando item: {item.get('item_name', 'Sin nombre')}"}), 400

        # Determinar si la factura debe actualizar el stock
        # IMPORTANTE: ERPNext NO permite update_stock=1 cuando hay items vinculados a Purchase Receipt
        # 
        # Contamos items con y sin vinculación a remitos para loguear y validar
        items_with_receipt = [item for item in processed_items if item.get('pr_detail') or item.get('purchase_receipt')]
        items_without_receipt = [item for item in processed_items if not item.get('pr_detail') and not item.get('purchase_receipt')]
        
        # Filtrar items de stock sin remito (excluir items FREE- y servicios)
        items_without_receipt_stock = []
        for item in items_without_receipt:
            item_code = item.get('item_code', '')
            if not item_code or item_code.startswith('FREE-'):
                continue
            # Verificar si es item de stock consultando ERPNext
            try:
                item_check_response, item_check_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Item/{quote(item_code)}?fields=" + quote('["is_stock_item"]'),
                    operation_name=f"Check if '{item_code}' is stock item for auto-PR"
                )
                if not item_check_error and item_check_response.status_code == 200:
                    item_data = item_check_response.json().get('data', {})
                    if item_data.get('is_stock_item') == 1:
                        items_without_receipt_stock.append(item)
            except Exception:
                pass
        
        # NUEVA LÓGICA: Si hay items mixtos, crear PR automático para los items sin remito
        auto_created_pr = None
        if linked_purchase_receipts and items_without_receipt_stock:
            print(f"📦 Detectados {len(items_without_receipt_stock)} items de stock sin remito en factura mixta")
            print(f"   Items: {[item.get('item_code', '?') for item in items_without_receipt_stock]}")
            
            # Obtener el supplier con abbr para el PR
            erpnext_supplier_for_pr = data['supplier']
            if company_abbr:
                erpnext_supplier_for_pr = add_company_abbr(data['supplier'], company_abbr)
            
            # Crear Purchase Receipt automático
            auto_created_pr, items_with_new_pr_links = _create_auto_purchase_receipt(
                session=session,
                headers=headers,
                items_without_receipt=items_without_receipt_stock,
                supplier=erpnext_supplier_for_pr,
                company=data['company'],
                posting_date=data.get('posting_date') or data.get('bill_date') or '',
                company_abbr=company_abbr
            )
            
            if auto_created_pr:
                # Actualizar los items procesados con los nuevos vínculos
                linked_purchase_receipts.add(auto_created_pr)
                
                # Reemplazar los items sin remito por los que ahora tienen vínculo
                new_processed_items = []
                items_updated_codes = {item.get('item_code') for item in items_with_new_pr_links}
                
                for item in processed_items:
                    item_code = item.get('item_code')
                    # Buscar si este item fue actualizado con pr_detail
                    updated_item = None
                    for new_item in items_with_new_pr_links:
                        if new_item.get('item_code') == item_code and not item.get('pr_detail'):
                            updated_item = item.copy()
                            updated_item['purchase_receipt'] = new_item.get('purchase_receipt')
                            updated_item['pr_detail'] = new_item.get('pr_detail')
                            break
                    
                    if updated_item:
                        new_processed_items.append(updated_item)
                    else:
                        new_processed_items.append(item)
                
                processed_items = new_processed_items
                
                # Recalcular contadores
                items_with_receipt = [item for item in processed_items if item.get('pr_detail') or item.get('purchase_receipt')]
                items_without_receipt_stock = []  # Ya no hay items sin remito
                
                print(f"✅ Items actualizados con PR automático '{auto_created_pr}'")
            else:
                print(f"⚠️ No se pudo crear PR automático, los items no actualizarán stock")
        
        # update_stock siempre 0 si hay remitos vinculados (restricción de ERPNext)
        if linked_purchase_receipts:
            update_stock = 0
        else:
            update_stock = 1 if has_stock_items else 0
        
        print(
            f"📊 Configuración update_stock: {update_stock} "
            f"(has_stock_items: {has_stock_items}, items_de_remitos: {len(items_with_receipt)}, "
            f"items_nuevos_stock: {len(items_without_receipt_stock)}, linked_receipts: {sorted(linked_purchase_receipts)}, "
            f"auto_pr: {auto_created_pr or 'ninguno'})"
        )

        # Paso 2: Obtener cuentas por defecto de la compañía
        company_defaults = get_company_defaults(data['company'], session, headers)
        if not company_defaults:
            return jsonify({"success": False, "message": "Error obteniendo configuración de compañía"}), 400

        # Paso 3: Construir y crear el borrador de la factura
        # Validar y ajustar fechas para evitar error de ERPNext
        posting_date = data.get('posting_date') or data.get('bill_date') or ''
        bill_date_value = data.get('bill_date') or posting_date
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
        due_date = adjust_due_date_if_needed(bill_date_value or posting_date, due_date)
        
        # Determinar la cuenta por cobrar (proveedor específico o compañía por defecto)
        supplier_account = get_supplier_payable_account(data['supplier'], data['company'], session, headers)
        credit_to_account = supplier_account if supplier_account else company_defaults.get('default_payable_account', '')
        
        print(f"💳 Cuenta por pagar - Proveedor específico: {supplier_account or 'No tiene'}, Compañía por defecto: {company_defaults.get('default_payable_account', 'No configurada')}, Usando: {credit_to_account}")
        
        # Agregar sigla al supplier para ERPNext
        erpnext_supplier = data['supplier']
        if company_abbr:
            original_supplier = erpnext_supplier
            erpnext_supplier = add_company_abbr(data['supplier'], company_abbr)
            # Validar la operación
            if not validate_company_abbr_operation(original_supplier, erpnext_supplier, company_abbr, 'add'):
                print(f"⚠️ Validation failed for supplier name abbreviation: {original_supplier} -> {erpnext_supplier}")
            print(f"🏷️ Supplier name expanded for ERPNext: {erpnext_supplier}")

        invoice_body = {
            "supplier": erpnext_supplier,
            "company": data['company'],
            "posting_date": posting_date,
            "bill_date": bill_date_value,
            "due_date": due_date,
            "credit_to": credit_to_account,
            "update_stock": update_stock,
            "items": processed_items,
            "set_posting_time": data.get('set_posting_time', 1)
        }

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
                print(f"🔍 BORRADOR CON NOMBRE TEMPORAL SUGERIDO: {temp_name}")
                # Usar el nombre temporal para identificar el tipo de comprobante
                invoice_body['name'] = temp_name
                invoice_body['naming_series'] = temp_name
            else:
                print(f"🔍 BORRADOR DETECTADO: Usando numeración nativa de ERPNext (sin naming_series personalizado)")
                # No setear name ni naming_series para que ERPNext use su numeración automática
        else:
            # Para facturas confirmadas: usar el método de numeración personalizado
            print(f"🔍 FACTURA CONFIRMADA: Usando naming_series personalizado: {metodo_numeracion}")
            invoice_body['name'] = metodo_numeracion
            invoice_body['naming_series'] = metodo_numeracion

        # Agregar campos opcionales si existen (SOLO los que son válidos en ERPNext Purchase Invoice)
        # Campos válidos: currency, exchange_rate, price_list, buying_price_list, discount_amount
        # Campos NO válidos: invoice_number, punto_de_venta, invoice_type, voucher_type_code, 
        #                    invoice_category, sales_condition_type, net_gravado, net_no_gravado, total_iva
        valid_optional_fields = ['currency', 'exchange_rate', 'title', 'buying_price_list', 'discount_amount']
        for field in valid_optional_fields:
            if data.get(field):
                invoice_body[field] = data[field]
        
        # price_list se mapea a buying_price_list en ERPNext
        if data.get('price_list') and not data.get('buying_price_list'):
            invoice_body['buying_price_list'] = data['price_list']

        # ============================================================
        # PROCESAMIENTO DE PERCEPCIONES (NUEVO MODELO UNIFICADO)
        # ============================================================
        # Las percepciones se procesan desde el nuevo formato 'perceptions' 
        # y se agregan como filas en la tabla de impuestos de ERPNext
        
        perceptions = data.get('perceptions', [])
        
        # Si el frontend aún envía los campos antiguos, convertirlos al nuevo formato
        # TODO: Esta conversión se puede eliminar cuando el frontend esté completamente migrado
        if not perceptions:
            old_perceptions = []
            
            # Convertir percepciones_iva antiguas
            for p_iva in data.get('percepciones_iva', []):
                old_perceptions.append({
                    "perception_type": "IVA",
                    "scope": "INTERNA",
                    "province_code": None,
                    "regimen_code": p_iva.get('regimen', ''),
                    "percentage": p_iva.get('alicuota'),
                    "base_amount": p_iva.get('base_imponible'),
                    "total_amount": p_iva.get('importe', 0)
                })
            
            # Convertir percepciones_ingresos_brutos antiguas
            for p_iibb in data.get('percepciones_ingresos_brutos', []):
                # Mapear jurisdicción a código de provincia
                jurisdiccion = p_iibb.get('jurisdiccion', '')
                province_code = _map_jurisdiction_to_province_code(jurisdiccion)
                
                old_perceptions.append({
                    "perception_type": "INGRESOS_BRUTOS",
                    "scope": "INTERNA",
                    "province_code": province_code,
                    "regimen_code": p_iibb.get('regimen', ''),
                    "percentage": p_iibb.get('alicuota'),
                    "base_amount": p_iibb.get('base_imponible'),
                    "total_amount": p_iibb.get('importe', 0)
                })
            
            perceptions = old_perceptions
        
        # Construir filas de taxes para las percepciones
        if perceptions:
            # IMPORTANTE: Cuando hay percepciones, ERPNext NO calcula el IVA automáticamente
            # Debemos construir las filas de IVA explícitamente y agregarlas ANTES de las percepciones
            
            # 1. Construir filas de IVA basadas en los items
            iva_taxes, iva_errors = build_purchase_iva_taxes(
                items=data.get('items', []),
                company=data['company'],
                company_abbr=company_abbr,
                session=session
            )
            
            if iva_errors:
                log_error(f"Errores construyendo IVA: {iva_errors}", "create_invoice")
            
            # 2. Construir filas de percepciones
            perception_taxes, perception_errors = build_purchase_perception_taxes(
                company=data['company'],
                perceptions=perceptions,
                company_abbr=company_abbr,
                session=session
            )
            
            if perception_errors:
                log_error(f"Errores en percepciones: {perception_errors}", "create_invoice")
                return jsonify({
                    "success": False,
                    "message": f"Errores en percepciones: {'; '.join(perception_errors)}"
                }), 400
            
            # 3. Combinar: primero IVA, luego percepciones
            all_taxes = []
            if iva_taxes:
                all_taxes.extend(iva_taxes)
                print(f"📊 IVA agregado: {len(iva_taxes)} filas")
            if perception_taxes:
                all_taxes.extend(perception_taxes)
                print(f"📊 Percepciones agregadas: {len(perception_taxes)} filas")
            
            if all_taxes:
                base_taxes = invoice_body.get('taxes', [])
                invoice_body['taxes'] = base_taxes + all_taxes

        # Si no se especificó moneda, no establecer ninguna (ERPNext usará la de la empresa)
        if data.get('currency'):
            invoice_body['currency'] = data.get('currency')

        # El título se guarda en el campo 'description' en ERPNext
        if data.get('title'):
            invoice_body['description'] = data['title']

        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Purchase Invoice",
            data={"data": invoice_body},
            operation_name="Create purchase invoice"
        )

        if create_error:
            log_error(f"Error creando borrador: {create_error}", "create_invoice")
            return jsonify({"success": False, "message": f"Error creando borrador de factura: {create_error}"}), 400

        if create_response.status_code not in [200, 201]:
            log_error(f"Error creando borrador: {create_response.status_code}", "create_invoice")
            return jsonify({"success": False, "message": f"Error creando borrador de factura: {create_response.text}"}), 400

        draft_result = create_response.json()
        invoice_name = draft_result['data']['name']
        log_success(f"Borrador creado exitosamente: {invoice_name}", "create_invoice")

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
            # Confirmar la factura (submit)
            submit_response, submit_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                data={"docstatus": 1},
                operation_name=f"Submit purchase invoice '{invoice_name}'"
            )

            if submit_error:
                log_error(f"Error confirmando factura: {submit_error}", "create_invoice")
                return jsonify({"success": False, "message": f"Error confirmando factura: {submit_error}"}), 400

            if submit_response.status_code != 200:
                log_error(f"Error confirmando factura: {submit_response.status_code}", "create_invoice")
                return jsonify({"success": False, "message": f"Error confirmando factura: {submit_response.text}"}), 400

            final_result = submit_response.json()
            log_success(f"Factura confirmada exitosamente: {invoice_name}", "create_invoice")
            try:
                update_receipt_states_from_invoice_items(
                    session,
                    headers,
                    final_result.get('data', {}).get('items') or data.get('items', [])
                )
            except Exception as estado_error:
                log_error(f"No se pudo actualizar el estado de remitos vinculados: {estado_error}", "create_invoice")

            return jsonify({
                "success": True,
                "message": "Factura creada y confirmada exitosamente",
                "data": final_result['data']
            })

    except Exception as e:
        log_error(f"Error creando factura: {str(e)}", "create_invoice")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500














@purchase_invoices_bp.route('/api/purchase-invoices/<invoice_name>', methods=['PUT'])
def update_invoice(invoice_name):
    """
    Modificar una factura existente.
    CORREGIDO: Fuerza la moneda a ARS, añade la plantilla de impuestos
    general y construye el body dinámicamente.
    """
    print(f"Modificando factura {invoice_name}")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    data = request.get_json().get('data', {})

    # Atajo: si solo se solicita anular/cancelar, no procesar nada m�s
    if _is_cancel_request(data):
        print(f"Solicitud directa de anulaci�n para factura {invoice_name} (status={data.get('status')}, docstatus={data.get('docstatus')})")
        return cancel_invoice(invoice_name, session, headers)

    company = data.get('company')
    if not company:
        # Intentar obtener la compañía de la factura existente
        try:
            invoice_response, invoice_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                operation_name="Get existing invoice for company determination"
            )

            if invoice_error:
                return jsonify({"success": False, "message": f"Error obteniendo la factura existente para determinar compañía: {invoice_error}"}), 400

            if invoice_response.status_code == 200:
                existing_invoice = invoice_response.json()['data']
                company = existing_invoice.get('company')
                if company:
                    data['company'] = company
                else:
                    return jsonify({"success": False, "message": "No se pudo determinar la compañía de la factura existente"}), 400
            else:
                return jsonify({"success": False, "message": "Error obteniendo la factura existente para determinar compañía"}), 400
        except Exception as e:
            print(f"Error obteniendo compañía de factura existente: {str(e)}")
            return jsonify({"success": False, "message": "Error interno obteniendo compañía"}), 500

    try:
        tax_map = get_tax_template_map(session, headers, company, transaction_type='purchase')
        
        # Obtener el docstatus actual
        invoice_response, invoice_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
            operation_name="Get current invoice docstatus"
        )

        if invoice_error:
            return jsonify({"success": False, "message": f"Error obteniendo factura: {invoice_error}"}), 400

        if invoice_response.status_code == 404:
            return jsonify({"success": False, "message": f"Factura {invoice_name} no encontrada - puede que ya haya sido eliminada"}), 404
        elif invoice_response.status_code != 200:
            return jsonify({"success": False, "message": f"Error obteniendo factura: {invoice_response.text}"}), 400

        current_invoice = invoice_response.json()['data']
        docstatus = current_invoice.get('docstatus', 0)
        print(f"Factura actual tiene docstatus: {docstatus}")

        if docstatus == 0:  # Borrador
            return update_draft_invoice(invoice_name, data, session, headers)
        elif docstatus == 1:  # Confirmada
            return update_confirmed_invoice(invoice_name, data, session, headers)
        else:
            return jsonify({"success": False, "message": "Estado de factura no soportado"}), 400

    except requests.exceptions.HTTPError as e:
        print(f"Error HTTP de ERPNext: {e.response.status_code}")
        return jsonify({"success": False, "message": f"Error de ERPNext: {e.response.text}"}), 500
    except Exception as e:
        print(f"Error crítico en update_invoice: {str(e)}")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@purchase_invoices_bp.route('/api/purchase-invoices/<invoice_name>', methods=['DELETE'])
def delete_invoice(invoice_name):
    """Eliminar/cancelar una factura - borradores se eliminan, confirmadas se cancelan"""
    print(f"Eliminando factura {invoice_name}")

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
            endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}?fields={quote(fields_str)}",
            operation_name="Get invoice docstatus for deletion"
        )

        if invoice_error:
            print(f"Error obteniendo estado de factura: {invoice_error}")
            return jsonify({"success": False, "message": f"Error obteniendo estado de factura: {invoice_error}"}), 400

        if invoice_response.status_code != 200:
            print(f"Error obteniendo estado de factura: {invoice_response.status_code}")
            return jsonify({"success": False, "message": f"Error obteniendo estado de factura: {invoice_response.text}"}), 400

        invoice_data = invoice_response.json()['data']
        docstatus = invoice_data.get('docstatus', 0)

        print(f"Factura {invoice_name} tiene docstatus: {docstatus}")

        if docstatus == 0:
            # Es un borrador - usar DELETE directo
            print(f"Eliminando borrador: {invoice_name}")
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                operation_name=f"Delete draft invoice '{invoice_name}'"
            )

            if delete_error:
                print(f"Error eliminando borrador: {delete_error}")
                return jsonify({"success": False, "message": f"Error eliminando borrador: {delete_error}"}), 400

            if delete_response.status_code not in [200, 202, 204]:
                print(f"Error eliminando borrador: {delete_response.status_code} - {delete_response.text}")
                return jsonify({"success": False, "message": f"Error eliminando borrador: {delete_response.text}"}), 400

            print(f"Borrador eliminado exitosamente: {invoice_name}")
            return jsonify({
                "success": True,
                "message": "Factura borrador eliminada exitosamente"
            })

        elif docstatus == 1:
            # Está confirmada - usar cancel
            print(f"Cancelando factura confirmada: {invoice_name}")
            result = cancel_invoice(invoice_name, session, headers)
            return result

        else:
            # Estado desconocido
            return jsonify({"success": False, "message": f"Estado de factura desconocido (docstatus: {docstatus})"}), 400

    except Exception as e:
        print(f"Error eliminando factura: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_invoices_bp.route('/api/purchase-invoices/bulk-removal', methods=['POST'])
def bulk_remove_purchase_invoices():
    """
    Permite eliminar o cancelar masivamente facturas de compra.
    - docstatus 0 -> DELETE
    - docstatus 1 -> Cancel (docstatus 2)
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
            endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}?fields={quote(fields_str)}",
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
                    endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                    operation_name=f"Delete draft purchase invoice '{invoice_name}' (bulk)"
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
                    data={"doctype": "Purchase Invoice", "name": invoice_name},
                    operation_name=f"Cancel purchase invoice '{invoice_name}' (bulk)"
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
        requested_status = str(data.get('status', '')).lower()
        requested_docstatus = _parse_docstatus(data.get('docstatus'), 0)
        
        if requested_status in ['cancelada', 'cancelled', 'anulada', 'anulado'] or requested_docstatus == 2:
            # Factura en borrador que se quiere cancelar - eliminar en lugar de cancelar
            print(f"Factura en borrador {invoice_name} se quiere cancelar - eliminando en lugar de cancelar")
            print(f"Eliminando borrador: {invoice_name}")
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                operation_name=f"Delete draft invoice '{invoice_name}' for cancellation"
            )

            if delete_error:
                print(f"Error eliminando borrador: {delete_error}")
                return jsonify({"success": False, "message": f"Error eliminando borrador: {delete_error}"}), 400

            if delete_response.status_code not in [200, 202, 204]:
                print(f"Error eliminando borrador: {delete_response.status_code} - {delete_response.text}")
                return jsonify({"success": False, "message": f"Error eliminando borrador: {delete_response.text}"}), 400

            print(f"Borrador eliminado exitosamente: {invoice_name}")
            return jsonify({
                "success": True,
                "message": "Factura borrador eliminada exitosamente"
            })

        # Obtener el mapa de templates de impuestos
        tax_map = get_tax_template_map(session, headers, data.get('company', ''), transaction_type='purchase')
        
        # Procesar items igual que en la creación
        effective_items = data.get('items', []) if isinstance(data.get('items'), list) else []
        if not effective_items:
            return jsonify({"success": False, "message": "El borrador debe contener al menos un item"}), 400

        processed_items = []
        for item in effective_items:
            processed_item = process_purchase_invoice_item(item, session, headers, data.get('company', ''), tax_map, data.get('supplier'))
            if processed_item:
                # Agregar la abbr de la compañía al código del item antes de enviar a ERPNext
                company_abbr = get_company_abbr(session, headers, data.get('company', ''))
                if company_abbr and not processed_item['item_code'].endswith(f' - {company_abbr}'):
                    processed_item['item_code'] = f"{processed_item['item_code']} - {company_abbr}"
                    print(f"🏷️ Item code expanded for ERPNext: {processed_item['item_code']}")
                
                # Actualizar valuation_rate en el item de ERPNext si viene configurado
                if item.get('valuation_rate') and processed_item.get('item_code'):
                    try:
                        valuation_rate_value = float(item['valuation_rate'])
                        update_data = {
                            "valuation_rate": valuation_rate_value
                        }
                        update_response, update_error = make_erpnext_request(
                            session=session,
                            method="PUT",
                            endpoint=f"/api/resource/Item/{quote(processed_item['item_code'])}",
                            data={"data": update_data},
                            operation_name=f"Update valuation rate for item '{processed_item['item_code']}' in draft update"
                        )
                        if update_error:
                            print(f"--- Warning: Could not update valuation_rate for item {processed_item['item_code']}: {update_error}")
                        elif update_response.status_code == 200:
                            print(f"--- Valuation rate updated to {valuation_rate_value} for item {processed_item['item_code']}")
                        else:
                            print(f"--- Warning: Could not update valuation_rate for item {processed_item['item_code']}: {update_response.text}")
                    except Exception as e:
                        print(f"--- Warning: Error updating valuation_rate for item {processed_item['item_code']}: {str(e)}")
                
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
                    print(f"ADVERTENCIA: Due date ajustada de {due} a {adjusted_date} para evitar error de ERPNext")
                    return adjusted_date
                else:
                    return due
            except (ValueError, AttributeError) as e:
                print(f"ERROR: Formato de fecha inválido - posting_date: '{posting}', due_date: '{due}' - {str(e)}")
                return due

        # Agregar sigla al supplier para ERPNext
        erpnext_supplier = data.get('supplier')
        company_abbr = get_company_abbr(session, headers, data.get('company', ''))
        if company_abbr and erpnext_supplier:
            erpnext_supplier = add_company_abbr(erpnext_supplier, company_abbr)
            print(f"🏷️ Supplier name expanded for ERPNext: {erpnext_supplier}")

        update_body = {
            "supplier": erpnext_supplier,
            "company": data.get('company'),
            "items": processed_items,
            "posting_date": data.get('posting_date') or data.get('bill_date') or '',
            "bill_date": data.get('bill_date') or data.get('posting_date') or '',
            "docstatus": data.get('docstatus', 0),
            "set_posting_time": data.get('set_posting_time', 1)
        }

        # LÓGICA ESPECIAL: Manejar confirmación de borrador (cambio de docstatus 0 -> 1)
        requested_docstatus = data.get('docstatus', 0)
        requested_status = data.get('status', '').lower()
        is_confirming_draft = (
            requested_docstatus == 1 or 
            requested_status in ['confirmada', 'submitted']
        )
        
        if is_confirming_draft:
            print(f"🔄 CONFIRMANDO BORRADOR: {invoice_name}")
            
            # 1. Obtener el método de numeración de los datos (siempre debe estar presente para confirmación)
            metodo_numeracion_field = get_metodo_numeracion_field(data.get('invoice_type', ''))
            metodo_numeracion = data.get(metodo_numeracion_field, '').strip()
            
            # Si no se encuentra en el campo específico, buscar en metodo_numeracion_factura_venta como fallback
            if not metodo_numeracion:
                metodo_numeracion = data.get('metodo_numeracion_factura_venta', '').strip()
            
            if not metodo_numeracion:
                return jsonify({"success": False, "message": "Método de numeración requerido para confirmar borrador"}), 400
            
            print(f"🎯 Generando número definitivo basado en: {metodo_numeracion}")
            
            # 2. Generar el nuevo nombre basado en el próximo número confirmado
            next_number = get_next_confirmed_invoice_number(session, headers, metodo_numeracion)
            
            # 3. Crear el nuevo nombre definitivo
            parts = metodo_numeracion.split('-')
            talonario_prefix = '-'.join(parts[:-1])
            new_invoice_name = f"{talonario_prefix}-{next_number:08d}"
            print(f"🆕 Nuevo nombre definitivo: {new_invoice_name}")
            
            # 4. Crear una nueva factura con el nombre definitivo y eliminar el borrador
            # Primero obtener todos los datos del borrador actual
            current_invoice_response, current_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                operation_name="Get current draft invoice data for confirmation"
            )

            if current_error:
                print(f"❌ Error obteniendo datos del borrador actual: {current_error}")
                return jsonify({
                    "success": False,
                    "message": f"Error obteniendo datos del borrador: {current_error}"
                }), 400

            if current_invoice_response.status_code == 200:
                current_invoice_data = current_invoice_response.json()['data']
                
                # Preparar los datos para la nueva factura confirmada
                new_invoice_data = current_invoice_data.copy()
                new_invoice_data['name'] = new_invoice_name
                new_invoice_data['naming_series'] = new_invoice_name
                new_invoice_data['docstatus'] = 1  # Confirmada
                
                # Actualizar con los nuevos datos del request
                for field in ['posting_date', 'bill_date', 'due_date', 'currency', 'title', 'invoice_type', 'voucher_type_code', 'invoice_category', 'price_list', 'discount_amount', 'net_gravado', 'net_no_gravado', 'total_iva', 'percepcion_iva', 'percepcion_iibb', 'sales_condition_type', 'sales_condition_amount', 'sales_condition_days', 'sales_condition']:
                    if data.get(field):
                        new_invoice_data[field] = data[field]
                if 'bill_date' not in data:
                    new_invoice_data['bill_date'] = current_invoice_data.get('bill_date') or new_invoice_data.get('posting_date')
                new_invoice_data['set_posting_time'] = data.get('set_posting_time', current_invoice_data.get('set_posting_time', 1))
                
                # Items actualizados
                new_invoice_data['items'] = processed_items
                
                # Crear la nueva factura confirmada
                create_confirmed_response, create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Purchase Invoice",
                    data={"data": new_invoice_data},
                    operation_name=f"Create confirmed invoice '{new_invoice_name}'"
                )

                if create_error:
                    print(f"❌ Error creando factura confirmada: {create_error}")
                    return jsonify({
                        "success": False,
                        "message": f"Error confirmando borrador: {create_error}"
                    }), 400

                if create_confirmed_response.status_code in [200, 201]:
                    print(f"✅ Factura confirmada creada: {new_invoice_name}")
                    
                    # Actualizar el contador del talonario ahora que está confirmada
                    update_talonario_last_number(session, headers, new_invoice_name, metodo_numeracion)
                    try:
                        update_receipt_states_from_invoice_items(session, headers, new_invoice_data.get('items', []))
                    except Exception as estado_error:
                        print(f"--- Advertencia: no se pudo actualizar estado de remitos vinculados: {estado_error}")
                    
                    # Eliminar el borrador temporal
                    delete_draft_response, delete_error = make_erpnext_request(
                        session=session,
                        method="DELETE",
                        endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                        operation_name=f"Delete draft invoice '{invoice_name}' after confirmation"
                    )

                    if delete_error:
                        print(f"⚠️ Error eliminando borrador temporal: {delete_error}")
                    elif delete_draft_response.status_code in [200, 202, 204]:
                        print(f"🗑️ Borrador temporal eliminado: {invoice_name}")
                    else:
                        print(f"⚠️ Error eliminando borrador temporal: {delete_draft_response.text}")
                    
                    # Retornar éxito con el nuevo nombre
                    confirmed_result = create_confirmed_response.json()
                    return jsonify({
                        "success": True,
                        "message": "Borrador confirmado exitosamente con número definitivo",
                        "data": confirmed_result['data'],
                        "new_invoice_name": new_invoice_name
                    })
                else:
                    print(f"❌ Error creando factura confirmada: {create_confirmed_response.text}")
                    return jsonify({
                        "success": False, 
                        "message": f"Error confirmando borrador: {create_confirmed_response.text}"
                    }), 400
            else:
                print(f"❌ Error obteniendo datos del borrador actual: {current_invoice_response.text}")
                return jsonify({
                    "success": False, 
                    "message": f"Error obteniendo datos del borrador: {current_invoice_response.text}"
                }), 400

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
        for field in ['posting_date', 'bill_date', 'due_date', 'invoice_number', 'punto_de_venta', 'currency', 'title', 'invoice_type', 'voucher_type_code', 'invoice_category', 'price_list', 'discount_amount', 'net_gravado', 'net_no_gravado', 'total_iva', 'percepcion_iva', 'percepcion_iibb', 'sales_condition_type', 'sales_condition_amount', 'sales_condition_days', 'sales_condition']:
            if data.get(field):
                if field == 'due_date':
                    reference_date = data.get('bill_date') or data.get('posting_date') or update_body.get('bill_date')
                    adjusted_due_date = adjust_due_date_if_needed(reference_date, data[field])
                    update_body[field] = adjusted_due_date
                else:
                    update_body[field] = data[field]



        # El título se guarda en el campo 'description' en ERPNext
        if data.get('title'):
            update_body['description'] = data['title']

        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
            data={"data": update_body},
            operation_name=f"Update draft invoice '{invoice_name}'"
        )

        if update_error:
            print(f"Error actualizando borrador: {update_error}")
            return jsonify({"success": False, "message": f"Error actualizando borrador: {update_error}"}), 400

        if update_response.status_code != 200:
            print(f"Error actualizando borrador: {update_response.status_code} - {update_response.text}")
            return jsonify({"success": False, "message": f"Error actualizando borrador: {update_response.text}"}), 400

        result = update_response.json()
        print(f"Factura procesada exitosamente: {invoice_name}")

        return jsonify({
            "success": True,
            "message": "Factura procesada exitosamente",
            "data": result['data']
        })

    except Exception as e:
        print(f"Error actualizando borrador: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

def update_confirmed_invoice(invoice_name, data, session, headers):
    """Actualizar una factura confirmada creando una nueva y cancelando la original (workflow seguro)"""
    try:
        # Verificar si solo se quiere cancelar la factura
        requested_status = str(data.get('status', '')).lower()
        requested_docstatus = _parse_docstatus(data.get('docstatus'), 1)
        
        if requested_status in ['cancelada', 'cancelled', 'anulada', 'anulado'] or requested_docstatus == 2:
            # Solo cancelar la factura, no hacer modificación
            print(f"Solo cancelando factura confirmada: {invoice_name}")
            return cancel_invoice(invoice_name, session, headers)
        
        # WORKFLOW SEGURO: Crear nueva factura primero, luego cancelar la original si todo sale bien
        print(f"Modificando factura confirmada con workflow seguro: {invoice_name}")
        
        # Paso 1: Obtener los datos actuales de la factura original para usar como base
        current_invoice_response, current_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
            operation_name="Get current confirmed invoice data for modification"
        )

        if current_error:
            print(f"Error obteniendo datos de la factura original: {current_error}")
            return jsonify({"success": False, "message": f"Error obteniendo datos de la factura original: {current_error}"}), 400

        if current_invoice_response.status_code != 200:
            print(f"Error obteniendo datos de la factura original: {current_invoice_response.text}")
            return jsonify({"success": False, "message": f"Error obteniendo datos de la factura original: {current_invoice_response.text}"}), 400

        current_invoice_data = current_invoice_response.json()['data']

        def _normalize_truthy(value):
            if value is None:
                return None
            if isinstance(value, str):
                return value.strip()
            return value

        def _incoming_item_key(item):
            # Frontend sends purchase_invoice_item when editing items loaded from ERPNext.
            # Fallback to "name" or "pi_detail" variants if present.
            return (
                _normalize_truthy(item.get('purchase_invoice_item')) or
                _normalize_truthy(item.get('name')) or
                _normalize_truthy(item.get('pi_detail'))
            )

        def _extract_link_fields(source_item):
            # Preserve linkage fields to upstream documents (PO/PR) for remito states & traceability.
            if not isinstance(source_item, dict):
                return {
                    'purchase_order': '',
                    'po_detail': '',
                    'purchase_receipt': '',
                    'pr_detail': ''
                }
            return {
                'purchase_order': _normalize_truthy(source_item.get('purchase_order')) or '',
                'po_detail': _normalize_truthy(source_item.get('po_detail')) or _normalize_truthy(source_item.get('purchase_order_item')) or '',
                'purchase_receipt': _normalize_truthy(source_item.get('purchase_receipt')) or '',
                'pr_detail': _normalize_truthy(source_item.get('pr_detail')) or _normalize_truthy(source_item.get('purchase_receipt_item')) or ''
            }

        def _merge_link_fields(base_fields, override_fields):
            merged = dict(base_fields or {})
            for key, value in (override_fields or {}).items():
                if value is None:
                    continue
                normalized = value.strip() if isinstance(value, str) else value
                if normalized == '':
                    continue
                merged[key] = normalized
            return merged

        def _dedupe_processed_items(items):
            """
            ERPNext validates that the same item_code cannot appear multiple times in Purchase Invoice.
            If duplicates exist, merge them ONLY when their linkage fields are identical; otherwise,
            return a validation error so the user can resolve it explicitly.
            """
            grouped = {}
            order = []
            for item in items or []:
                code = item.get('item_code') or ''
                if code not in grouped:
                    grouped[code] = []
                    order.append(code)
                grouped[code].append(item)

            deduped = []
            for code in order:
                entries = grouped.get(code) or []
                if len(entries) == 1:
                    deduped.append(entries[0])
                    continue

                def _link_signature(it):
                    return (
                        (it.get('purchase_order') or ''),
                        (it.get('po_detail') or ''),
                        (it.get('purchase_receipt') or ''),
                        (it.get('pr_detail') or ''),
                        (it.get('warehouse') or ''),
                        (it.get('uom') or ''),
                        (it.get('expense_account') or ''),
                        (it.get('cost_center') or ''),
                        (it.get('item_tax_template') or ''),
                        (it.get('item_tax_rate') or '')
                    )

                signatures = {_link_signature(it) for it in entries}
                if len(signatures) != 1:
                    return None, f"El mismo artículo no se puede introducir varias veces: '{code}'. Hay líneas con vínculos distintos (OC/Remito)."

                merged = dict(entries[0])
                merged_qty = 0.0
                for it in entries:
                    try:
                        merged_qty += float(it.get('qty') or 0)
                    except Exception:
                        merged_qty += 0.0
                merged['qty'] = merged_qty
                deduped.append(merged)

            return deduped, None

        def _build_items_for_confirmed_workaround(company_abbr):
            incoming_items = data.get('items', []) if isinstance(data.get('items'), list) else []
            incoming_by_key = {}
            for incoming in incoming_items:
                if not isinstance(incoming, dict):
                    continue
                key = _incoming_item_key(incoming)
                if key:
                    incoming_by_key[key] = incoming

            base_items = current_invoice_data.get('items') if isinstance(current_invoice_data.get('items'), list) else []
            # If the original invoice already contains duplicate item_code rows, do NOT block duplicates here.
            # Some installations allow it and users rely on having separate PR links per line.
            seen_codes = set()
            allow_duplicate_item_codes = False
            linked_codes = set()
            for base in base_items:
                if not isinstance(base, dict):
                    continue
                code = base.get('item_code')
                if not code:
                    continue
                normalized_code = code
                if company_abbr and not str(normalized_code).endswith(f' - {company_abbr}'):
                    normalized_code = f"{normalized_code} - {company_abbr}"
                links = _extract_link_fields(base)
                if any(links.get(field) for field in ('purchase_receipt', 'pr_detail', 'purchase_order', 'po_detail')):
                    linked_codes.add(normalized_code)
                if code in seen_codes:
                    allow_duplicate_item_codes = True
                    break
                seen_codes.add(code)
            existing_child_names = {
                _normalize_truthy(item.get('name'))
                for item in base_items
                if isinstance(item, dict) and item.get('name')
            }

            effective_items = []
            for base in base_items:
                if not isinstance(base, dict):
                    continue

                base_key = _normalize_truthy(base.get('name'))
                override = incoming_by_key.get(base_key) if base_key else None

                base_links = _extract_link_fields(base)
                override_links = _extract_link_fields(override)
                merged_links = _merge_link_fields(base_links, override_links)

                merged_item = {
                    'item_code': (override.get('item_code') if isinstance(override, dict) else None) or base.get('item_code', ''),
                    'item_name': (override.get('item_name') if isinstance(override, dict) else None) or base.get('item_name', ''),
                    'description': (override.get('description') if isinstance(override, dict) else None) or base.get('description', ''),
                    'qty': (override.get('qty') if isinstance(override, dict) else None) if isinstance(override, dict) else base.get('qty', 1),
                    'rate': (override.get('rate') if isinstance(override, dict) else None) if isinstance(override, dict) else base.get('rate', 0),
                    'uom': (override.get('uom') if isinstance(override, dict) else None) or base.get('uom', 'Unit'),
                    'discount_percent': (
                        (override.get('discount_percent') if isinstance(override, dict) else None) or
                        (override.get('discount_percentage') if isinstance(override, dict) else None) or
                        base.get('discount_percentage') or 0
                    ),
                    'iva_percent': (override.get('iva_percent') if isinstance(override, dict) else None) or base.get('iva_percent') or 21,
                    'warehouse': (override.get('warehouse') if isinstance(override, dict) else None) or base.get('warehouse') or '',
                    'cost_center': (override.get('cost_center') if isinstance(override, dict) else None) or base.get('cost_center') or '',
                    'valuation_rate': (override.get('valuation_rate') if isinstance(override, dict) else None) or base.get('valuation_rate')
                }
                merged_item.update(merged_links)

                if company_abbr and merged_item.get('item_code') and not str(merged_item['item_code']).endswith(f' - {company_abbr}'):
                    merged_item['item_code'] = f"{merged_item['item_code']} - {company_abbr}"

                effective_items.append(merged_item)

            for incoming in incoming_items:
                if not isinstance(incoming, dict):
                    continue
                key = _incoming_item_key(incoming)
                if key and key in existing_child_names:
                    continue

                item_copy = dict(incoming)
                if company_abbr and item_copy.get('item_code') and not str(item_copy['item_code']).endswith(f' - {company_abbr}'):
                    item_copy['item_code'] = f"{item_copy['item_code']} - {company_abbr}"

                # Avoid accidental duplication: if the original invoice already has this item_code linked to a PR/PO,
                # and the incoming "new" row has no linkage fields, skip it (usually a duplicated UI row).
                item_code_normalized = item_copy.get('item_code') or ''
                incoming_links = _extract_link_fields(item_copy)
                has_any_link = any(incoming_links.get(field) for field in ('purchase_receipt', 'pr_detail', 'purchase_order', 'po_detail'))
                if item_code_normalized and item_code_normalized in linked_codes and not has_any_link:
                    continue

                effective_items.append(item_copy)

            if allow_duplicate_item_codes:
                return effective_items, None

            grouped = {}
            order = []
            for it in effective_items:
                code = (it.get('item_code') or '')
                if code not in grouped:
                    grouped[code] = []
                    order.append(code)
                grouped[code].append(it)

            deduped = []
            for code in order:
                entries = grouped.get(code) or []
                if len(entries) == 1:
                    deduped.append(entries[0])
                    continue

                def _signature(x):
                    links = _extract_link_fields(x)
                    return (
                        links.get('purchase_order') or '',
                        links.get('po_detail') or '',
                        links.get('purchase_receipt') or '',
                        links.get('pr_detail') or '',
                        (x.get('warehouse') or ''),
                        (x.get('uom') or '')
                    )

                signatures = {_signature(x) for x in entries}
                if len(signatures) != 1:
                    return None, f"El mismo artículo no se puede introducir varias veces: '{code}'. Hay líneas con vínculos distintos (OC/Remito)."

                merged = dict(entries[0])
                merged_qty = 0.0
                for x in entries:
                    try:
                        merged_qty += float(x.get('qty') or 0)
                    except Exception:
                        merged_qty += 0.0
                merged['qty'] = merged_qty
                deduped.append(merged)

            return deduped, None
        
        # Paso 2: Preparar los datos para la nueva factura
        # Obtener el mapa de templates de impuestos
        tax_map = get_tax_template_map(session, headers, data.get('company', current_invoice_data.get('company')), transaction_type='purchase')

        # En el workaround de factura confirmada, preservar los datos originales (incluyendo v¡nculos PR/PO)
        # y evitar items duplicados (ERPNext no permite repetir item_code).
        company_value = data.get('company', current_invoice_data.get('company'))
        company_abbr = get_company_abbr(session, headers, company_value)
        items_for_processing, dedupe_error = _build_items_for_confirmed_workaround(company_abbr)
        if dedupe_error:
            return jsonify({"success": False, "message": dedupe_error}), 400
        data['items'] = items_for_processing
        
        processed_items = []
        for item in data.get('items', []):
            processed_item = process_purchase_invoice_item(item, session, headers, data.get('company', current_invoice_data.get('company')), tax_map, data.get('supplier', current_invoice_data.get('supplier')))
            if processed_item:
                # Agregar la abbr de la compañía al código del item antes de enviar a ERPNext
                company_abbr = get_company_abbr(session, headers, data.get('company', current_invoice_data.get('company')))
                if company_abbr and not processed_item['item_code'].endswith(f' - {company_abbr}'):
                    processed_item['item_code'] = f"{processed_item['item_code']} - {company_abbr}"
                    print(f"🏷️ Item code expanded for ERPNext: {processed_item['item_code']}")
                
                # Actualizar valuation_rate en el item de ERPNext si viene configurado
                if item.get('valuation_rate') and processed_item.get('item_code'):
                    try:
                        valuation_rate_value = float(item['valuation_rate'])
                        update_data = {
                            "valuation_rate": valuation_rate_value
                        }
                        update_response, update_error = make_erpnext_request(
                            session=session,
                            method="PUT",
                            endpoint=f"/api/resource/Item/{quote(processed_item['item_code'])}",
                            data={"data": update_data},
                            operation_name=f"Update valuation rate for item '{processed_item['item_code']}' in confirmed invoice modification"
                        )
                        if update_error:
                            print(f"--- Warning: Could not update valuation_rate for item {processed_item['item_code']}: {update_error}")
                        elif update_response.status_code == 200:
                            print(f"--- Valuation rate updated to {valuation_rate_value} for item {processed_item['item_code']}")
                        else:
                            print(f"--- Warning: Could not update valuation_rate for item {processed_item['item_code']}: {update_response.text}")
                    except Exception as e:
                        print(f"--- Warning: Error updating valuation_rate for item {processed_item['item_code']}: {str(e)}")
                
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
                    print(f"ADVERTENCIA: Due date ajustada de {due} a {adjusted_date} para evitar error de ERPNext")
                    return adjusted_date
                else:
                    return due
            except (ValueError, AttributeError) as e:
                print(f"ERROR: Formato de fecha inválido - posting_date: '{posting}', due_date: '{due}' - {str(e)}")
                return due

        # Paso 3: Determinar cuentas y configuración
        company_defaults = get_company_defaults(data.get('company', current_invoice_data.get('company')), session, headers)
        if not company_defaults:
            return jsonify({"success": False, "message": "Error obteniendo configuración de compañía"}), 400

        supplier_account = get_supplier_payable_account(data.get('supplier', current_invoice_data.get('supplier')), data.get('company', current_invoice_data.get('company')), session, headers)
        credit_to_account = supplier_account if supplier_account else company_defaults.get('default_payable_account', '')
        
        # Determinar si la nueva factura debe actualizar stock
        has_stock_items = any(item.get('item_code') and not item.get('item_code').startswith('FREE-') for item in processed_items)
        has_linked_receipts = any(item.get('pr_detail') or item.get('purchase_receipt') for item in processed_items)
        # ERPNext restriction: cannot update stock against purchase receipts
        update_stock = 0 if has_linked_receipts else (1 if has_stock_items else 0)
        
        # Paso 4: Preparar el body de la nueva factura
        # Determinar el método de numeración para usar naming_series correcto
        metodo_numeracion_field = get_metodo_numeracion_field(data.get('invoice_type', ''))
        metodo_numeracion = data.get(metodo_numeracion_field, '').strip()
        
        # Si no se encuentra en el campo específico, buscar en metodo_numeracion_factura_venta como fallback
        if not metodo_numeracion:
            metodo_numeracion = data.get('metodo_numeracion_factura_venta', '').strip()
        
        # Agregar sigla al supplier para ERPNext
        erpnext_supplier = data.get('supplier', current_invoice_data.get('supplier'))
        company_abbr = get_company_abbr(session, headers, data.get('company', current_invoice_data.get('company')))
        if company_abbr and erpnext_supplier:
            erpnext_supplier = add_company_abbr(erpnext_supplier, company_abbr)
            print(f"🏷️ Supplier name expanded for ERPNext: {erpnext_supplier}")

        reference_posting_date = data.get('posting_date', current_invoice_data.get('posting_date'))
        reference_bill_date = data.get('bill_date', current_invoice_data.get('bill_date') or reference_posting_date)

        new_invoice_body = {
            "supplier": erpnext_supplier,
            "company": data.get('company', current_invoice_data.get('company')),
            "posting_date": reference_posting_date,
            "bill_date": reference_bill_date,
            "due_date": adjust_due_date_if_needed(
                reference_bill_date or reference_posting_date,
                data.get('due_date', current_invoice_data.get('due_date'))
            ),
            "credit_to": credit_to_account,
            "update_stock": update_stock,
            "items": processed_items,
            "docstatus": 1,  # Crear directamente como confirmada
            "set_posting_time": data.get('set_posting_time', current_invoice_data.get('set_posting_time', 1))
        }

        # Configurar naming_series para usar método de numeración personalizado
        if metodo_numeracion:
            new_invoice_body["naming_series"] = metodo_numeracion
        else:
            # Si no hay método personalizado, usar automáticamente el prefijo de compras
            # REQUERIMIENTO ESTRICTO: obtener el prefijo desde shared/afip_codes.json.
            # Si no existe, fallar la operación (no hacer fallback silencioso).
            try:
                purchase_prefix = get_purchase_prefix(strict=True)
            except Exception as e:
                return jsonify({"success": False, "message": str(e)}), 400
            new_invoice_body["naming_series"] = f"{purchase_prefix}-PINV-.YYYY.-.#####"

        # Agregar campos opcionales si existen
        optional_fields = ['currency', 'title', 'invoice_type', 'voucher_type_code', 'invoice_category', 
                          'price_list', 'discount_amount', 'net_gravado', 'net_no_gravado', 'total_iva', 
                          'percepcion_iva', 'percepcion_iibb', 'sales_condition_type', 'sales_condition_amount', 
                          'sales_condition_days', 'sales_condition', 'invoice_number', 'punto_de_venta']
        
        for field in optional_fields:
            if data.get(field) is not None:
                new_invoice_body[field] = data[field]
            elif current_invoice_data.get(field) is not None:
                new_invoice_body[field] = current_invoice_data.get(field)

        # ============================================================
        # PROCESAMIENTO DE PERCEPCIONES (NUEVO MODELO UNIFICADO)
        # ============================================================
        perceptions = data.get('perceptions', [])
        
        # Convertir formato antiguo si es necesario
        if not perceptions:
            old_perceptions = []
            
            for p_iva in data.get('percepciones_iva', []):
                old_perceptions.append({
                    "perception_type": "IVA",
                    "scope": "INTERNA",
                    "province_code": None,
                    "regimen_code": p_iva.get('regimen', ''),
                    "percentage": p_iva.get('alicuota'),
                    "base_amount": p_iva.get('base_imponible'),
                    "total_amount": p_iva.get('importe', 0)
                })
            
            for p_iibb in data.get('percepciones_ingresos_brutos', []):
                jurisdiccion = p_iibb.get('jurisdiccion', '')
                province_code = _map_jurisdiction_to_province_code(jurisdiccion)
                
                old_perceptions.append({
                    "perception_type": "INGRESOS_BRUTOS",
                    "scope": "INTERNA",
                    "province_code": province_code,
                    "regimen_code": p_iibb.get('regimen', ''),
                    "percentage": p_iibb.get('alicuota'),
                    "base_amount": p_iibb.get('base_imponible'),
                    "total_amount": p_iibb.get('importe', 0)
                })
            
            perceptions = old_perceptions
        
        # Construir filas de taxes para las percepciones
        if perceptions:
            company_for_perceptions = data.get('company', current_invoice_data.get('company'))
            # Obtener company_abbr para las percepciones (puede ya estar definido desde el loop de items)
            perception_company_abbr = get_company_abbr(session, headers, company_for_perceptions)
            
            # IMPORTANTE: Cuando hay percepciones, ERPNext NO calcula el IVA automáticamente
            # Debemos construir las filas de IVA explícitamente y agregarlas ANTES de las percepciones
            
            # 1. Construir filas de IVA basadas en los items
            iva_taxes, iva_errors = build_purchase_iva_taxes(
                items=data.get('items', []),
                company=company_for_perceptions,
                company_abbr=perception_company_abbr,
                session=session
            )
            
            if iva_errors:
                print(f"⚠️ Errores construyendo IVA: {iva_errors}")
            
            # 2. Construir filas de percepciones
            perception_taxes, perception_errors = build_purchase_perception_taxes(
                company=company_for_perceptions,
                perceptions=perceptions,
                company_abbr=perception_company_abbr,
                session=session
            )
            
            if perception_errors:
                print(f"❌ Errores en percepciones: {perception_errors}")
                return jsonify({
                    "success": False,
                    "message": f"Errores en percepciones: {'; '.join(perception_errors)}"
                }), 400
            
            # 3. Combinar: primero IVA, luego percepciones
            all_taxes = []
            if iva_taxes:
                all_taxes.extend(iva_taxes)
                print(f"📊 IVA agregado a factura modificada: {len(iva_taxes)} filas")
            if perception_taxes:
                all_taxes.extend(perception_taxes)
                print(f"📊 Percepciones agregadas a factura modificada: {len(perception_taxes)} filas")
            
            if all_taxes:
                base_taxes = new_invoice_body.get('taxes', [])
                new_invoice_body['taxes'] = base_taxes + all_taxes



        # Título se guarda en description
        if data.get('title'):
            new_invoice_body['description'] = data['title']

        # Preservar conciliación si la factura original tenía un conciliation id
        try:
            orig_conc_id = current_invoice_data.get(CONCILIATION_FIELD)
            if orig_conc_id:
                new_invoice_body[CONCILIATION_FIELD] = orig_conc_id
                print(f"📎 Preservando conciliation id en la factura modificada: {orig_conc_id}")
        except Exception:
            pass

        # Paso 5: Crear la nueva factura confirmada
        print(f"Creando nueva factura modificada...")
        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Purchase Invoice",
            data={"data": new_invoice_body},
            operation_name=f"Create modified confirmed invoice"
        )

        if create_error:
            print(f"Error creando nueva factura: {create_error}")
            return jsonify({"success": False, "message": f"Error creando nueva factura modificada: {create_error}"}), 400

        if create_response.status_code not in [200, 201]:
            print(f"Error creando nueva factura: {create_response.status_code} - {create_response.text}")
            return jsonify({"success": False, "message": f"Error creando nueva factura modificada: {create_response.text}"}), 400

        new_invoice_result = create_response.json()
        new_invoice_name = new_invoice_result['data']['name']
        print(f"Nueva factura creada exitosamente: {new_invoice_name}")

        # Paso 6: Si la nueva factura se creó exitosamente, cancelar la factura original
        print(f"Cancelando factura original: {invoice_name}")
        # Use the cancel_invoice helper to ensure we also revert PR states and cancel auto-generated PRs
        cancel_result = cancel_invoice(invoice_name, session, headers)
        # cancel_result is a Flask response; try to interpret it
        cancel_error = None
        cancel_response_status = getattr(cancel_result, 'status_code', None)
        cancel_json = None
        try:
            cancel_json = cancel_result.get_json()
        except Exception:
            cancel_json = None

        if not cancel_json or not cancel_json.get('success') or cancel_response_status != 200:
            # Build an error message from cancel_json if available
            cancel_error = cancel_json.get('message') if cancel_json else 'Unknown error while cancelling invoice'
            print(f"Error cancelando factura original: {cancel_error}")
            # CRÍTICO: Si no podemos cancelar la original, debemos eliminar la nueva para evitar duplicados
            print(f"ERROR CRÍTICO: Eliminando nueva factura {new_invoice_name} porque no se pudo cancelar la original")
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Purchase Invoice/{quote(new_invoice_name)}",
                operation_name=f"Delete new invoice '{new_invoice_name}' after cancel failure"
            )
            if delete_error:
                print(f"ERROR: No se pudo eliminar la nueva factura {new_invoice_name}: {delete_error}")
            elif delete_response.status_code in [200, 202, 204]:
                print(f"Nueva factura eliminada exitosamente: {new_invoice_name}")
            else:
                print(f"ERROR: No se pudo eliminar la nueva factura {new_invoice_name}")
            
            return jsonify({"success": False, "message": f"Error cancelando factura original. Operación revertida: {cancel_error}"}), 400

        # cancel_result already handled above (if not success we deleted new invoice and returned)

        print(f"Factura original cancelada exitosamente: {invoice_name}")
        print(f"Factura modificada completada exitosamente: {new_invoice_name}")
        try:
            update_receipt_states_from_invoice_items(session, headers, new_invoice_body.get('items', []))
        except Exception as estado_error:
            print(f"--- Advertencia: no se pudo actualizar estado de remitos tras modificar factura: {estado_error}")

        return jsonify({
            "success": True,
            "message": "Factura modificada exitosamente",
            "data": new_invoice_result['data'],
            "original_cancelled": invoice_name,
            "new_invoice": new_invoice_name
        })

    except Exception as e:
        print(f"Error modificando factura confirmada: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

def cancel_invoice(invoice_name, session, headers):
    """Cancelar una factura"""
    try:
        print(f"Cancelando factura: {invoice_name}")
        receipts_to_refresh = set()
        auto_generated_receipts = set()
        
        try:
            # Obtener la factura completa (incluyendo items)
            # ERPNext no permite filtrar campos de child tables en la URL, hay que traer todo
            invoice_details_resp, invoice_details_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
                operation_name=f"Get invoice '{invoice_name}' for receipt status update"
            )
            if not invoice_details_err and invoice_details_resp.status_code == 200:
                invoice_data = invoice_details_resp.json().get("data", {})
                invoice_items = invoice_data.get("items") or []
                print(f"📋 Factura tiene {len(invoice_items)} items")
                
                receipts_to_refresh = _collect_receipt_names_from_items(invoice_items, session)
                # Identificar PRs auto-generados para cancelarlos
                auto_generated_receipts = _collect_auto_generated_receipts(invoice_items, session)
                print(f"📋 Remitos a refrescar: {receipts_to_refresh}, Auto-generados a cancelar: {auto_generated_receipts}")
            else:
                print(f"⚠️ No se pudo obtener la factura: err={invoice_details_err}, status={invoice_details_resp.status_code if invoice_details_resp else 'N/A'}")
        except Exception as fetch_error:
            print(f"--- Advertencia: no se pudieron obtener remitos vinculados antes de cancelar: {fetch_error}")

        cancel_response, cancel_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.cancel",
            data={"doctype": "Purchase Invoice", "name": invoice_name},
            operation_name=f"Cancel invoice '{invoice_name}'"
        )

        if cancel_error:
            print(f"Error cancelando factura: {cancel_error}")
            return jsonify({"success": False, "message": f"Error cancelando factura: {cancel_error}"}), 400

        if cancel_response.status_code != 200:
            print(f"Error cancelando factura: {cancel_response.status_code} - {cancel_response.text}")
            return jsonify({"success": False, "message": f"Error cancelando factura: {cancel_response.text}"}), 400

        print(f"Factura cancelada exitosamente: {invoice_name}")
        
        # Revertir estados de remitos normales a 'Recibido pendiente de factura' (excluyendo los auto-generados)
        normal_receipts = receipts_to_refresh - auto_generated_receipts
        if normal_receipts:
            print(f"🔄 Revirtiendo estado de remitos normales: {sorted(normal_receipts)}")
            refresh_receipt_states_to_pending(session, headers, normal_receipts)
        
        # Cancelar PRs auto-generados
        cancelled_auto_prs = []
        failed_auto_prs = []
        for auto_pr in auto_generated_receipts:
            success = _cancel_auto_purchase_receipt(session, headers, auto_pr)
            if success:
                cancelled_auto_prs.append(auto_pr)
            else:
                failed_auto_prs.append(auto_pr)
        
        if cancelled_auto_prs:
            print(f"✅ PRs auto-generados cancelados: {cancelled_auto_prs}")
        if failed_auto_prs:
            print(f"⚠️ PRs auto-generados que no se pudieron cancelar: {failed_auto_prs}")
        
        return jsonify({
            "success": True,
            "message": "Factura cancelada exitosamente",
            "cancelled_auto_receipts": cancelled_auto_prs,
            "failed_auto_receipts": failed_auto_prs
        })

    except Exception as e:
        print(f"Error cancelando factura: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@purchase_invoices_bp.route('/api/supplier-invoices/', methods=['GET'])
def get_supplier_invoices():
    """Obtiene las facturas de un proveedor específico"""
    print("Obteniendo facturas de proveedor")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener parámetros
    supplier_name = request.args.get('supplier')
    status = request.args.get('status', 'all')  # 'all', 'paid', 'unpaid', 'draft'
    limit = request.args.get('limit', '20')  # Límite de resultados

    if not supplier_name:
        return jsonify({"success": False, "message": "Nombre del proveedor requerido"}), 400

    try:
        # Obtener la compañía activa
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa configurada para el usuario {user_id}")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        # Agregar sigla al supplier_name para buscar en ERPNext
        search_supplier_name = supplier_name
        company_abbr = get_company_abbr(session, headers, company_name)
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching invoices for supplier with abbr: {search_supplier_name}")

        # Construir filtros para las facturas
        filters = [
            ["supplier", "=", search_supplier_name],
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

        # Obtener facturas desde ERPNext (primero sin items para ser más rápido)
        # Extract fields to avoid nested quotes in f-string
        fields_str = '["name","posting_date","supplier","supplier_name","grand_total","outstanding_amount","status","docstatus","remarks","is_return","return_against"]'
        filters_json = json.dumps(filters)
        
        params = {
            'fields': fields_str,
            'filters': filters_json,
            'limit_page_length': limit,
            'order_by': 'posting_date desc'
        }
        invoices_response, invoices_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Sales%20Invoice",
            params=params,
            operation_name="Get supplier invoices"
        )

        print(f"Respuesta de ERPNext para facturas: {invoices_response.status_code}")

        if invoices_error:
            print(f"Error obteniendo facturas: {invoices_error}")
            return jsonify({"success": False, "message": "Error al obtener facturas"}), 500

        if invoices_response.status_code != 200:
            print(f"Error obteniendo facturas: {invoices_response.status_code} - {invoices_response.text}")
            return jsonify({"success": False, "message": "Error al obtener facturas"}), 500

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
        detailed_invoices = []
        for invoice in invoices:
            try:
                # Obtener detalles completos de la factura
                detail_response, detail_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Purchase Invoice/{quote(invoice['name'])}",
                    operation_name=f"Get invoice details for '{invoice['name']}'"
                )

                if detail_error:
                    print(f"Error obteniendo detalles de factura {invoice['name']}: {detail_error}")
                    # Si no podemos obtener detalles, usar los datos básicos
                    detailed_invoices.append(invoice)
                elif detail_response.status_code == 200:
                    detail_data = detail_response.json()
                    invoice_detail = detail_data.get("data", {})

                    # Determinar el tipo de comprobante
                    voucher_type = "Factura"
                    if invoice_detail.get("is_return"):
                        voucher_type = "Nota de Crédito"
                    elif invoice_detail.get("invoice_type"):
                        voucher_type = invoice_detail.get("invoice_type")
                    
                    # Agregar los campos básicos más los items detallados
                    detailed_invoice = {
                        "name": invoice_detail.get("name"),
                        "posting_date": invoice_detail.get("posting_date"),
                        "due_date": invoice_detail.get("due_date"),
                        "supplier": invoice_detail.get("supplier"),
                        "supplier_name": invoice_detail.get("supplier_name"),
                        "grand_total": invoice_detail.get("grand_total"),
                        "outstanding_amount": invoice_detail.get("outstanding_amount"),
                        "status": invoice_detail.get("status"),
                        "docstatus": invoice_detail.get("docstatus"),  # Agregar docstatus
                        "remarks": invoice_detail.get("remarks"),
                        "is_return": invoice_detail.get("is_return", 0),
                        "invoice_type": invoice_detail.get("invoice_type"),
                        "voucher_type_code": invoice_detail.get("voucher_type_code"),
                        "voucher_type": voucher_type,
                        "return_against": invoice_detail.get("return_against"),
                        "currency": invoice_detail.get("currency", "ARS"),
                        "price_list": invoice_detail.get("selling_price_list"),
                        "discount_amount": invoice_detail.get("discount_amount", 0),
                        "net_gravado": invoice_detail.get("net_total", 0),
                        "net_no_gravado": invoice_detail.get("total_taxes_and_charges", 0),
                        "total_iva": invoice_detail.get("total_taxes_and_charges", 0),
                        "items": []
                    }

                    # Remover siglas de los nombres de proveedores antes de enviar al frontend
                    if company_abbr:
                        detailed_invoice['supplier'] = remove_company_abbr(detailed_invoice.get('supplier', ''), company_abbr)
                        detailed_invoice['supplier_name'] = remove_company_abbr(detailed_invoice.get('supplier_name', ''), company_abbr)
                        print(f"🏷️ Cleaned supplier names in invoice: {detailed_invoice['supplier_name']}")

                    # Procesar los items de la factura
                    items = invoice_detail.get("items", [])
                    for item in items:
                        processed_item = {
                            "item_code": item.get("item_code", ""),
                            "item_name": item.get("item_name", ""),
                            "description": item.get("description", ""),
                            "qty": item.get("qty", 1),
                            "rate": item.get("rate", 0),
                            "amount": item.get("amount", 0),
                            "discount_amount": item.get("discount_amount", 0),
                            "item_tax_rate": 21  # Default IVA rate, could be improved to get actual tax rate
                        }
                        detailed_invoice["items"].append(processed_item)

                    detailed_invoices.append(detailed_invoice)
                else:
                    print(f"Error obteniendo detalles de factura {invoice['name']}: {detail_response.status_code}")
                    # Si no podemos obtener detalles, usar los datos básicos
                    detailed_invoices.append(invoice)

            except Exception as e:
                print(f"Error procesando factura {invoice['name']}: {str(e)}")
                # Si hay error, usar los datos básicos
                detailed_invoices.append(invoice)

        return jsonify({"success": True, "data": detailed_invoices, "message": "Facturas obtenidas correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code}")
        return jsonify({"success": False, "message": "Error al obtener facturas"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500
    

@purchase_invoices_bp.route('/api/purchase-invoices/<invoice_name>', methods=['GET'])
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
        fields_str = '["name","posting_date","bill_date","due_date","supplier","company","currency","description","title","docstatus","total","is_return","return_against","invoice_type","voucher_type","invoice_category","punto_de_venta","invoice_number","items.item_code","items.item_name","items.description","items.qty","items.rate","items.amount","items.discount_amount","items.item_tax_template","items.item_tax_rate","items.warehouse","items.cost_center","items.uom","items.expense_account","taxes","status","grand_total","outstanding_amount","paid","net_gravado","net_no_gravado","total_iva","percepcion_iva","percepcion_iibb","discount_amount","price_list","sales_condition_type","sales_condition_amount","sales_condition_days"]'
        params = {
            'fields': fields_str
        }
        invoice_response, invoice_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Invoice/{quote(invoice_name)}",
            params=params,
            operation_name=f"Get invoice '{invoice_name}'"
        )

        if invoice_error:
            log_error(f"Error obteniendo factura: {invoice_error}", "get_invoice")
            return jsonify({"success": False, "message": f"Error obteniendo factura: {invoice_error}"}), 400

        if invoice_response.status_code != 200:
            log_error(f"Error obteniendo factura: {invoice_response.status_code} - {invoice_response.text}", "get_invoice")
            return jsonify({"success": False, "message": f"Error obteniendo factura: {invoice_response.text}"}), 400

        invoice_data = invoice_response.json()['data']

        # Remover sigla del supplier antes de enviar al frontend
        company = invoice_data.get('company')
        if company:
            company_abbr = get_company_abbr(session, headers, company)
            if company_abbr:
                invoice_data['supplier'] = remove_company_abbr(invoice_data.get('supplier', ''), company_abbr)
                print(f"🏷️ Cleaned supplier name in invoice: {invoice_data['supplier']}")

        # Procesar los items para incluir la información necesaria
        processed_items = []
        conditional_log(f"Procesando factura {invoice_name}")

        # Obtener el mapa de impuestos de la compañía para búsqueda robusta
        company = invoice_data.get('company')
        if company:
            try:
                tax_map = get_tax_template_map(session, headers, company, transaction_type='purchase')
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
                "account": item.get('expense_account', ''),
                "item_tax_template": item.get('item_tax_template', '')
            }
            processed_items.append(processed_item)
        
        # Construir la respuesta con todos los campos necesarios
        # Intentar obtener el título de diferentes formas - priorizar 'description'
        title = invoice_data.get('description') or invoice_data.get('title') or invoice_data.get('naming_series') or invoice_data.get('name') or ''

        # Procesar taxes para incluir percepciones
        # El frontend usa extractPerceptionsFromTaxes para extraer percepciones del array taxes
        raw_taxes = invoice_data.get('taxes', [])
        processed_taxes = []
        for tax in raw_taxes:
            processed_tax = {
                "name": tax.get('name'),
                "charge_type": tax.get('charge_type'),
                "account_head": tax.get('account_head'),
                "description": tax.get('description'),
                "rate": tax.get('rate', 0),
                "tax_amount": tax.get('tax_amount', 0),
                "tax_amount_after_discount_amount": tax.get('tax_amount_after_discount_amount', 0),
                "base_total": tax.get('base_total', 0),
                "total": tax.get('total', 0),
                "add_deduct_tax": tax.get('add_deduct_tax'),
                "included_in_print_rate": tax.get('included_in_print_rate', 0),
                # Custom fields para percepciones (nuevo modelo)
                "custom_is_perception": tax.get('custom_is_perception', 0),
                "custom_perception_type": tax.get('custom_perception_type'),
                "custom_perception_scope": tax.get('custom_perception_scope'),
                "custom_province_code": tax.get('custom_province_code'),
                "custom_province_name": tax.get('custom_province_name'),
                "custom_regimen_code": tax.get('custom_regimen_code'),
                "custom_percentage": tax.get('custom_percentage')
            }
            processed_taxes.append(processed_tax)
        
        if processed_taxes:
            perception_count = sum(1 for t in processed_taxes if t.get('custom_is_perception'))
            conditional_log(f"📊 Taxes procesados: {len(processed_taxes)} total, {perception_count} percepciones")

        response_data = {
            "name": invoice_data.get('name'),
            "posting_date": invoice_data.get('posting_date'),
            "bill_date": invoice_data.get('bill_date'),
            "due_date": invoice_data.get('due_date'),
            "supplier": invoice_data.get('supplier'),
            "company": invoice_data.get('company'),
            "currency": invoice_data.get('currency'),
            "title": title,  # Usar el título obtenido
            "status": "Confirmado" if invoice_data.get('docstatus') == 1 else "Borrador",
            "items": processed_items,
            "taxes": processed_taxes,  # Incluir taxes para que el frontend pueda extraer percepciones
            "total": invoice_data.get('total', 0),
            "grand_total": invoice_data.get('grand_total', 0),
            "outstanding_amount": invoice_data.get('outstanding_amount', 0),
            "docstatus": invoice_data.get('docstatus', 0),
            "return_against": invoice_data.get('return_against'),
            "invoice_type": invoice_data.get('invoice_type'),
            "voucher_type": invoice_data.get('voucher_type'),
            "invoice_category": invoice_data.get('invoice_category'),
            "punto_de_venta": invoice_data.get('punto_de_venta'),
            "invoice_number": invoice_data.get('invoice_number'),
            "is_return": invoice_data.get('is_return', 0),
            # Campos adicionales para el resumen
            "price_list": invoice_data.get('buying_price_list') or invoice_data.get('price_list'),
            "sales_condition_type": invoice_data.get('sales_condition_type'),
            "sales_condition_amount": invoice_data.get('sales_condition_amount'),
            "sales_condition_days": invoice_data.get('sales_condition_days'),
            "discount_amount": invoice_data.get('discount_amount', 0),
            "net_total": invoice_data.get('net_total', 0),
            "total_taxes_and_charges": invoice_data.get('total_taxes_and_charges', 0)
        }

        print(f"   🔍 RESPONSE_DATA ANTES DE ENVIAR:")
        print(f"      response_data['items'] type: {type(response_data['items'])}")
        print(f"      response_data['items'] length: {len(response_data['items'])}")
        for i, item in enumerate(response_data['items']):
            print(f"      Item {i+1} in response_data:")
            print(f"         iva_percent: {item.get('iva_percent', 'MISSING')}")
            print(f"         item_tax_template: {item.get('item_tax_template', 'MISSING')}")
            print(f"         All keys: {list(item.keys())}")

        log_success(f"Factura obtenida exitosamente: {invoice_name}", "get_invoice")
        
        return jsonify({
            "success": True,
            "data": response_data
        })

    except Exception as e:
        log_error(f"Error obteniendo factura: {str(e)}", "get_invoice")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
