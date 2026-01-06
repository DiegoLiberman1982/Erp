from flask import Blueprint, request, jsonify
import copy
import datetime
import json
from urllib.parse import quote

from routes.auth_utils import get_session_with_auth
from routes.general import get_company_abbr, get_active_company, remove_company_abbr
from utils.http_utils import make_erpnext_request, handle_erpnext_error

document_linking_bp = Blueprint('document_linking', __name__)


LINK_RELATIONS = {
    'purchase_receipt_from_purchase_order': {
        'method': 'erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_receipt',
        'source_doctype': 'Purchase Order',
        'target_doctype': 'Purchase Receipt',
        'description': 'Generar remito de compra desde orden de compra'
    },
    'purchase_invoice_from_purchase_order': {
        'method': 'erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_invoice',
        'source_doctype': 'Purchase Order',
        'target_doctype': 'Purchase Invoice',
        'description': 'Generar factura de compra desde orden de compra'
    },
    'purchase_invoice_from_purchase_receipt': {
        'method': 'erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_invoice',
        'source_doctype': 'Purchase Receipt',
        'target_doctype': 'Purchase Invoice',
        'description': 'Generar factura de compra desde remito de compra'
    },
    'delivery_note_from_sales_order': {
        'method': 'erpnext.selling.doctype.sales_order.sales_order.make_delivery_note',
        'source_doctype': 'Sales Order',
        'target_doctype': 'Delivery Note',
        'description': 'Generar remito de venta desde orden de venta'
    },
    'sales_invoice_from_delivery_note': {
        'method': 'erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice',
        'source_doctype': 'Delivery Note',
        'target_doctype': 'Sales Invoice',
        'description': 'Generar factura de venta desde remito de venta'
    },
    'sales_invoice_from_sales_order': {
        'method': 'erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice',
        'source_doctype': 'Sales Order',
        'target_doctype': 'Sales Invoice',
        'description': 'Generar factura de venta desde orden de venta'
    },
    'sales_order_from_sales_quotation': {
        'method': 'erpnext.selling.doctype.quotation.quotation.make_sales_order',
        'source_doctype': 'Quotation',
        'target_doctype': 'Sales Order',
        'description': 'Generar orden de venta desde un presupuesto'
    },
    'delivery_note_from_sales_quotation': {
        'method': 'erpnext.selling.doctype.quotation.quotation.make_delivery_note',
        'source_doctype': 'Quotation',
        'target_doctype': 'Delivery Note',
        'description': 'Generar remito de venta directamente desde un presupuesto'
    },
    'sales_invoice_from_sales_quotation': {
        'method': 'erpnext.selling.doctype.quotation.quotation.make_sales_invoice',
        'source_doctype': 'Quotation',
        'target_doctype': 'Sales Invoice',
        'description': 'Generar factura de venta directamente desde un presupuesto'
    },
    'purchase_credit_note_from_invoice': {
        'method': 'erpnext.accounts.doctype.purchase_invoice.purchase_invoice.make_debit_note',
        'source_doctype': 'Purchase Invoice',
        'target_doctype': 'Purchase Invoice',
        'description': 'Generar nota de crédito (purchase return) desde una factura de compra con saldo'
    },
    'sales_credit_note_from_invoice': {
        'method': 'erpnext.accounts.doctype.sales_invoice.sales_invoice.make_sales_return',
        'source_doctype': 'Sales Invoice',
        'target_doctype': 'Sales Invoice',
        'description': 'Generar nota de crédito (sales return) desde una factura de venta con saldo'
    },
    'purchase_receipt_return_from_purchase_receipt': {
        'method': None,
        'source_doctype': 'Purchase Receipt',
        'target_doctype': 'Purchase Receipt',
        'description': 'Usar remito de compra como origen para devoluci¢n'
    },
    'delivery_note_return_from_delivery_note': {
        'method': None,
        'source_doctype': 'Delivery Note',
        'target_doctype': 'Delivery Note',
        'description': 'Usar remito de venta como origen para devoluci¢n'
    }
}


def _strip_company_suffix(value, company_abbr):
    if not value or not isinstance(value, str) or not company_abbr:
        return value
    return remove_company_abbr(value, company_abbr)


def _clean_document(document, company_abbr):
    if not isinstance(document, dict):
        return document

    cleaned_doc = copy.deepcopy(document)

    for key in ('supplier', 'customer', 'customer_name', 'title'):
        if key in cleaned_doc:
            cleaned_doc[key] = _strip_company_suffix(cleaned_doc.get(key), company_abbr)

    items = cleaned_doc.get('items')
    if isinstance(items, list):
        for item in items:
            for field in (
                'item_code',
                'item_name',
                'warehouse',
                'source_warehouse',
                'target_warehouse',
                'from_warehouse',
                'to_warehouse'
            ):
                if field in item:
                    item[field] = _strip_company_suffix(item.get(field), company_abbr)

    return cleaned_doc


def _fetch_erpnext_document(session, doctype, name, fields=None):
    if not doctype or not name:
        return None, {"message": "doctype/name requerido"}

    if fields:
        fields_param = quote(json.dumps(fields))
        endpoint = f"/api/resource/{quote(doctype)}/{quote(name)}?fields={fields_param}"
    else:
        endpoint = f"/api/resource/{quote(doctype)}/{quote(name)}"

    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=endpoint,
        operation_name=f"Fetch {doctype} {name}"
    )

    if error or not response or response.status_code != 200:
        return None, error or {"message": f"ERPNext no devolvió {doctype}"}

    return response.json().get("data") or {}, None


def _filter_selected_children(items, selected_children):
    if not isinstance(items, list):
        return []
    if not selected_children or not isinstance(selected_children, list):
        return items
    selected_set = {str(name) for name in selected_children if name}
    if not selected_set:
        return items
    return [it for it in items if isinstance(it, dict) and str(it.get("name") or "") in selected_set]


def _build_delivery_note_from_sales_quotation(quotation, selected_children=None):
    if not isinstance(quotation, dict):
        return None

    posting_date = (
        quotation.get("transaction_date")
        or quotation.get("posting_date")
        or datetime.date.today().isoformat()
    )

    items = _filter_selected_children(quotation.get("items") or [], selected_children)
    mapped_items = []
    for row in items:
        mapped_items.append({
            "item_code": row.get("item_code") or "",
            "item_name": row.get("item_name") or row.get("item_code") or "",
            "description": row.get("description") or row.get("item_name") or row.get("item_code") or "",
            "qty": row.get("qty") or 0,
            "uom": row.get("uom") or row.get("stock_uom") or "Unit",
            "warehouse": row.get("warehouse") or "",
            "custom_propiedad": row.get("custom_propiedad") or row.get("propiedad") or "Propio",
            "quotation": quotation.get("name") or "",
            "quotation_item": row.get("name") or ""
        })

    return {
        "doctype": "Delivery Note",
        "posting_date": posting_date,
        "customer": quotation.get("customer") or quotation.get("party_name") or "",
        "company": quotation.get("company") or "",
        "status": "Por facturar",
        "comprobante_type": "Remito",
        "items": mapped_items
    }


def _build_sales_invoice_from_sales_quotation(quotation, selected_children=None):
    if not isinstance(quotation, dict):
        return None

    posting_date = (
        quotation.get("transaction_date")
        or quotation.get("posting_date")
        or datetime.date.today().isoformat()
    )

    items = _filter_selected_children(quotation.get("items") or [], selected_children)
    mapped_items = []
    for row in items:
        mapped_items.append({
            "item_code": row.get("item_code") or "",
            "item_name": row.get("item_name") or row.get("item_code") or "",
            "description": row.get("description") or row.get("item_name") or row.get("item_code") or "",
            "qty": row.get("qty") or 0,
            "uom": row.get("uom") or row.get("stock_uom") or "Unit",
            "rate": row.get("rate") or 0,
            "amount": row.get("amount") or 0,
            "warehouse": row.get("warehouse") or "",
            "quotation": quotation.get("name") or "",
            "quotation_item": row.get("name") or ""
        })

    return {
        "doctype": "Sales Invoice",
        "posting_date": posting_date,
        "customer": quotation.get("customer") or quotation.get("party_name") or "",
        "company": quotation.get("company") or "",
        "currency": quotation.get("currency"),
        "price_list": quotation.get("selling_price_list") or quotation.get("price_list") or "",
        "items": mapped_items,
        "taxes": quotation.get("taxes") or []
    }


def _propagate_propiedad_from_purchase_receipt(document, session, remito_name):
    """Copia el campo propiedad desde el remito (Purchase Receipt) hacia la factura generada."""
    if not isinstance(document, dict) or not session or not remito_name:
        return document

    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Receipt/{quote(remito_name)}",
            operation_name=f"Fetch Purchase Receipt '{remito_name}' for propiedad propagation"
        )
        if error or response.status_code != 200:
            return document

        source = response.json().get('data', {}) or {}
        source_items = source.get('items') or []

        propiedad_by_name = {item.get('name'): item.get('propiedad') for item in source_items if item.get('name')}
        propiedad_by_idx = {item.get('idx'): item.get('propiedad') for item in source_items if item.get('idx') is not None}

        for item in document.get('items', []) or []:
            if not isinstance(item, dict) or item.get('propiedad'):
                continue

            mapped_propiedad = None
            pr_detail = item.get('pr_detail') or item.get('purchase_receipt_item')
            if pr_detail and pr_detail in propiedad_by_name:
                mapped_propiedad = propiedad_by_name.get(pr_detail)

            if mapped_propiedad is None and item.get('idx') in propiedad_by_idx:
                mapped_propiedad = propiedad_by_idx.get(item.get('idx'))

            if mapped_propiedad:
                item['propiedad'] = mapped_propiedad

    except Exception as exc:
        print(f"--- Document Linking: no se pudo propagar propiedad desde remito {remito_name}: {exc}")

    return document


def _propagate_propiedad_from_purchase_order(document, session, order_name):
    """Copia el campo propiedad desde la orden de compra (Purchase Order) hacia el remito generado."""
    if not isinstance(document, dict) or not session or not order_name:
        return document

    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Order/{quote(order_name)}",
            operation_name=f"Fetch Purchase Order '{order_name}' for propiedad propagation"
        )
        if error or response.status_code != 200:
            return document

        source = response.json().get('data', {}) or {}
        source_items = source.get('items') or []

        propiedad_by_name = {item.get('name'): item.get('propiedad') for item in source_items if item.get('name')}
        propiedad_by_idx = {item.get('idx'): item.get('propiedad') for item in source_items if item.get('idx') is not None}

        for item in document.get('items', []) or []:
            if not isinstance(item, dict) or item.get('propiedad'):
                continue

            mapped_propiedad = None
            po_detail = item.get('po_detail') or item.get('purchase_order_item')
            if po_detail and po_detail in propiedad_by_name:
                mapped_propiedad = propiedad_by_name.get(po_detail)

            if mapped_propiedad is None and item.get('idx') in propiedad_by_idx:
                mapped_propiedad = propiedad_by_idx.get(item.get('idx'))

            if mapped_propiedad:
                item['propiedad'] = mapped_propiedad

    except Exception as exc:
        print(f"--- Document Linking: no se pudo propagar propiedad desde orden de compra {order_name}: {exc}")

    return document


def _copy_quantities_from_purchase_order(document, session, order_name):
    """Copia las cantidades desde la orden de compra (Purchase Order) hacia el remito generado."""
    if not isinstance(document, dict) or not session or not order_name:
        return document

    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase Order/{quote(order_name)}",
            operation_name=f"Fetch Purchase Order '{order_name}' for quantity copying"
        )
        if error or response.status_code != 200:
            return document

        source = response.json().get('data', {}) or {}
        source_items = source.get('items') or []

        qty_by_name = {item.get('name'): item.get('qty') for item in source_items if item.get('name')}
        qty_by_idx = {item.get('idx'): item.get('qty') for item in source_items if item.get('idx') is not None}

        for item in document.get('items', []) or []:
            if not isinstance(item, dict):
                continue

            # Only update if qty is 1 (default) or not set
            current_qty = item.get('qty')
            if current_qty is None or current_qty == 1 or current_qty == '1':
                mapped_qty = None
                po_detail = item.get('po_detail') or item.get('purchase_order_item')
                if po_detail and po_detail in qty_by_name:
                    mapped_qty = qty_by_name.get(po_detail)

                if mapped_qty is None and item.get('idx') in qty_by_idx:
                    mapped_qty = qty_by_idx.get(item.get('idx'))

                if mapped_qty is not None:
                    item['qty'] = mapped_qty
                    print(f"     ✅ Updated qty to {mapped_qty} for item {item.get('item_code')}")

    except Exception as exc:
        print(f"--- Document Linking: no se pudo copiar cantidades desde orden de compra {order_name}: {exc}")

    return document


@document_linking_bp.route('/api/document-linking/make', methods=['POST', 'OPTIONS'])
def create_document_from_relation():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    relation_key = payload.get('relation')
    source_name = payload.get('source_name')

    if not relation_key or relation_key not in LINK_RELATIONS:
        return jsonify({
            'success': False,
            'message': 'Relación no soportada'
        }), 400

    if not source_name:
        return jsonify({
            'success': False,
            'message': 'Debe indicar el documento de origen'
        }), 400

    relation = LINK_RELATIONS[relation_key]
    method_path = relation.get('method')

    request_data = {'source_name': source_name}

    selected_children = payload.get('selected_children')
    if selected_children:
        if not isinstance(selected_children, list):
            return jsonify({
                'success': False,
                'message': 'selected_children debe ser una lista'
            }), 400
        request_data['selected_children'] = selected_children

    target_doc = payload.get('target_doc')
    if target_doc:
        request_data['target_doc'] = target_doc

    # Returns based on existing remitos: fetch the source and let the frontend import items
    # (keeps UI limited to remitos no facturados, without showing OC/OV/Presupuestos).
    if relation_key in ('purchase_receipt_return_from_purchase_receipt', 'delivery_note_return_from_delivery_note'):
        if relation_key == 'purchase_receipt_return_from_purchase_receipt':
            doctype = "Purchase Receipt"
            fields = [
                "name",
                "posting_date",
                "supplier",
                "company",
                "status",
                "docstatus",
                "is_return",
                "per_billed",
                "custom_estado_remito",
                "items.name",
                "items.item_code",
                "items.item_name",
                "items.description",
                "items.qty",
                "items.uom",
                "items.stock_uom",
                "items.warehouse",
                "items.purchase_order",
                "items.purchase_order_item",
                "items.po_detail",
                "items.pr_detail"
            ]
        else:
            doctype = "Delivery Note"
            fields = [
                "name",
                "posting_date",
                "customer",
                "company",
                "status",
                "docstatus",
                "is_return",
                "per_billed",
                "title",
                "items.name",
                "items.item_code",
                "items.item_name",
                "items.description",
                "items.qty",
                "items.uom",
                "items.stock_uom",
                "items.warehouse",
                "items.custom_propiedad",
                "items.propiedad"
            ]

        source_doc, doc_error = _fetch_erpnext_document(session, doctype, source_name, fields=fields)
        if doc_error:
            return jsonify({
                "success": False,
                "message": doc_error.get("message") or "Error obteniendo remito"
            }), 400

        company_name = source_doc.get("company") or payload.get("company")
        if not company_name:
            company_name = get_active_company(user_id)
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None
        cleaned_document = _clean_document(source_doc, company_abbr)

        return jsonify({
            "success": True,
            "data": {
                "relation": relation_key,
                "source_name": source_name,
                "target_doctype": relation["target_doctype"],
                "document": cleaned_document
            }
        })

    # ERPNext versions may not expose Quotation -> Delivery Note / Sales Invoice mapping methods.
    # For those relations we build a lightweight draft document here and let the frontend patch it.
    if relation_key in ('delivery_note_from_sales_quotation', 'sales_invoice_from_sales_quotation'):
        quotation_fields = [
            "name",
            "transaction_date",
            "posting_date",
            "customer",
            "party_name",
            "company",
            "currency",
            "selling_price_list",
            "price_list",
            "taxes",
            "items.name",
            "items.item_code",
            "items.item_name",
            "items.description",
            "items.qty",
            "items.uom",
            "items.stock_uom",
            "items.warehouse",
            "items.custom_propiedad",
            "items.propiedad",
            "items.rate",
            "items.amount"
        ]

        quotation, quote_error = _fetch_erpnext_document(session, "Quotation", source_name, fields=quotation_fields)
        if quote_error:
            return jsonify({
                "success": False,
                "message": quote_error.get("message") or "Error obteniendo presupuesto"
            }), 400

        if relation_key == 'delivery_note_from_sales_quotation':
            document = _build_delivery_note_from_sales_quotation(quotation, selected_children=selected_children)
        else:
            document = _build_sales_invoice_from_sales_quotation(quotation, selected_children=selected_children)

        if not isinstance(document, dict):
            return jsonify({
                "success": False,
                "message": "No se pudo generar el documento desde el presupuesto"
            }), 400

        company_name = document.get("company") or payload.get("company")
        if not company_name:
            company_name = get_active_company(user_id)
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None
        cleaned_document = _clean_document(document, company_abbr)

        return jsonify({
            "success": True,
            "data": {
                "relation": relation_key,
                "source_name": source_name,
                "target_doctype": relation["target_doctype"],
                "document": cleaned_document
            }
        })

    if not method_path:
        return jsonify({
            'success': False,
            'message': 'Relaci¢n no soportada'
        }), 400

    print(f"--- Document Linking: {relation['target_doctype']} request_data={request_data}")
    response, error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint=f"/api/method/{method_path}",
        data=request_data,
        operation_name=f"Create {relation['target_doctype']} from {relation['source_doctype']}"
    )

    if error:
        return handle_erpnext_error(error, 'Error generando documento vinculado')

    if response.status_code != 200:
        return jsonify({
            'success': False,
            'message': response.text
        }), response.status_code

    erp_payload = response.json()
    document = erp_payload.get('message')

    if not isinstance(document, dict):
        return jsonify({
            'success': False,
            'message': 'ERPNext no devolvió un documento válido para vincular'
        }), 400

    print(f"--- Document Linking: {relation_key} documento generado por ERPNext: {json.dumps(document, ensure_ascii=False)}")

    if relation_key == 'purchase_invoice_from_purchase_receipt':
        document = _propagate_propiedad_from_purchase_receipt(document, session, source_name)
        print(f"--- Document Linking: {relation_key} después de propagar propiedad desde remito: {json.dumps(document, ensure_ascii=False)}")

    if relation_key == 'purchase_receipt_from_purchase_order':
        document = _propagate_propiedad_from_purchase_order(document, session, source_name)
        document = _copy_quantities_from_purchase_order(document, session, source_name)

    company_name = document.get('company') or payload.get('company')
    if not company_name:
        try:
            company_name = get_active_company(user_id)
        except Exception as exc:
            print(f"--- Document Linking: no se pudo determinar la compañía activa para {user_id}: {exc}")
    company_abbr = None
    if company_name:
        try:
            company_abbr = get_company_abbr(session, headers, company_name)
        except Exception as exc:
            print(f"--- Document Linking: no se pudo obtener sigla para {company_name}: {exc}")

    cleaned_document = _clean_document(document, company_abbr)

    if relation_key in ('purchase_invoice_from_purchase_receipt', 'purchase_invoice_from_purchase_order'):
        item_links = cleaned_document.get('items') or []
        print(f"--- Document Linking: {relation_key} generó {len(item_links)} items")
        for idx, item in enumerate(item_links):
            pr = item.get('purchase_receipt') or ''
            pr_detail = item.get('pr_detail') or item.get('purchase_receipt_item') or ''
            po = item.get('purchase_order') or ''
            po_detail = item.get('po_detail') or item.get('purchase_order_item') or ''
            if pr or pr_detail or po or po_detail:
                print(f"   Item {idx + 1} ({item.get('item_code', '?')}): PR={pr}, pr_detail={pr_detail}, PO={po}, po_detail={po_detail}")

    if relation_key == 'sales_invoice_from_sales_order':
        target_name = cleaned_document.get('name') or '<sin nombre>'
        item_links = cleaned_document.get('items') or []
        linked_orders = sorted({
            item.get('sales_order')
            for item in item_links
            if item.get('sales_order')
        })
        link_summary = ", ".join(linked_orders) if linked_orders else "sin referencias en items"
        print(
            f"--- Document Linking: Sales Order {source_name} -> draft Sales Invoice {target_name} "
            f"({len(item_links)} items, enlaces: {link_summary})"
        )
        if not linked_orders:
            print("--- Document Linking: advertencia - el borrador no conservó referencias a la Sales Order")

    if relation_key == 'purchase_receipt_from_purchase_order':
        target_name = cleaned_document.get('name') or '<sin nombre>'
        item_links = cleaned_document.get('items') or []
        linked_orders = sorted({
            item.get('purchase_order')
            for item in item_links
            if item.get('purchase_order')
        })
        link_summary = ", ".join(linked_orders) if linked_orders else "sin referencias en items"
        print(
            f"--- Document Linking: Purchase Order {source_name} -> draft Purchase Receipt {target_name} "
            f"({len(item_links)} items, enlaces: {link_summary})"
        )
        for idx, item in enumerate(item_links):
            qty = item.get('qty', '?')
            po_detail = item.get('po_detail') or item.get('purchase_order_item') or ''
            item_code = item.get('item_code', '?')
            description = item.get('description', '?')
            print(f"   Item {idx + 1} ({item_code}): qty={qty}, po_detail={po_detail}")
            print(f"      description: {description}")
            print(f"      full item payload: {json.dumps(item, ensure_ascii=False)}")
            if qty == 1 or qty == '1':
                print(f"     ⚠️  WARNING: qty is {qty}, may not be copied correctly from PO")

    return jsonify({
        'success': True,
        'data': {
            'relation': relation_key,
            'source_name': source_name,
            'target_doctype': relation['target_doctype'],
            'document': cleaned_document
        }
    })
