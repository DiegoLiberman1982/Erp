from flask import Blueprint, request, jsonify
from urllib.parse import quote
import json

from routes.auth_utils import get_session_with_auth
from routes.general import get_company_abbr, add_company_abbr
from utils.http_utils import make_erpnext_request
from utils.conciliation_utils import CONCILIATION_FIELD, generate_conciliation_id

supplier_reconciliation_bp = Blueprint('supplier_reconciliation', __name__)


def _normalize_supplier_name(session, headers, supplier_name, company):
    if not supplier_name or not company:
        return supplier_name
    try:
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return supplier_name
        suffix = f" - {company_abbr}"
        if supplier_name.endswith(suffix):
            return supplier_name
        expanded = add_company_abbr(supplier_name, company_abbr)
        print(f"[supplier_reconciliation] Normalized supplier '{supplier_name}' -> '{expanded}'")
        return expanded
    except Exception as exc:
        print(f"[supplier_reconciliation] Could not normalize supplier '{supplier_name}': {exc}")
        return supplier_name


def _normalize_supplier_doc_type(doctype_hint):
    if not doctype_hint:
        return None
    lookup = {
        "invoice": "Purchase Invoice",
        "purchase invoice": "Purchase Invoice",
        "factura": "Purchase Invoice",
        "nota de debito": "Purchase Invoice",
        "payment entry": "Payment Entry",
        "payment": "Payment Entry",
        "pago": "Payment Entry"
    }
    hint = doctype_hint.strip().lower()
    return lookup.get(hint, doctype_hint)


def _resolve_supplier_document(session, docname, doctype_hint=None):
    preferred = []
    normalized_hint = _normalize_supplier_doc_type(doctype_hint)
    if normalized_hint:
        preferred.append(normalized_hint)
    for candidate in ("Purchase Invoice", "Payment Entry"):
        if candidate not in preferred:
            preferred.append(candidate)

    last_error = None
    for doctype in preferred:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{doctype}/{quote(docname)}",
            operation_name=f"Fetch {doctype} '{docname}' for supplier conciliation"
        )
        if err:
            last_error = err
            continue
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            data['doctype'] = doctype
            return doctype, data
        last_error = resp.text

    raise ValueError(f"No se pudo obtener el documento {docname}: {last_error or 'no existe'}")


def _validate_supplier_document(data, doctype, supplier_names, company):
    if doctype == "Purchase Invoice":
        supplier_value = data.get('supplier')
        if supplier_value not in supplier_names:
            raise ValueError(f"La factura {data.get('name')} no pertenece al proveedor seleccionado")
    elif doctype == "Payment Entry":
        if data.get('party_type') != "Supplier":
            raise ValueError(f"El pago {data.get('name')} no pertenece a un proveedor")
        party = data.get('party')
        if party not in supplier_names:
            raise ValueError(f"El pago {data.get('name')} no pertenece al proveedor seleccionado")
    else:
        raise ValueError(f"Tipo de documento no soportado: {doctype}")

    if data.get('company') != company:
        raise ValueError(f"El documento {data.get('name')} no pertenece a la compañía {company}")


def _update_conciliation_field(session, doctype, docname, conciliation_id):
    payload = {"data": {CONCILIATION_FIELD: conciliation_id or ""}}
    resp, err = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/{doctype}/{quote(docname)}",
        data=payload,
        operation_name=f"Update conciliation for {doctype} '{docname}'"
    )
    if err or resp.status_code not in (200, 202):
        raise ValueError(f"No se pudo actualizar {docname}: {err or resp.text}")


def assign_supplier_conciliation(session, headers, supplier_name, company, documents, conciliation_id=None):
    """Expose helper so other modules (credit notes) can tag documents."""
    normalized_supplier = _normalize_supplier_name(session, headers, supplier_name, company)
    supplier_names = {supplier_name, normalized_supplier}
    conciliation_id = conciliation_id or generate_conciliation_id("CONC-SUP")
    updated = []
    seen = set()

    for doc in documents or []:
        docname = (doc.get('voucher_no') or doc.get('name') or '').strip()
        if not docname or docname in seen:
            continue
        seen.add(docname)
        doctype_hint = doc.get('doctype') or doc.get('doc_type') or doc.get('voucher_type')
        doctype, data = _resolve_supplier_document(session, docname, doctype_hint)
        _validate_supplier_document(data, doctype, supplier_names, company)
        _update_conciliation_field(session, doctype, docname, conciliation_id)
        updated.append({
            "name": docname,
            "doctype": doctype,
            "posting_date": data.get('posting_date'),
            "outstanding_amount": data.get('outstanding_amount'),
            "unallocated_amount": data.get('unallocated_amount'),
            CONCILIATION_FIELD: conciliation_id
        })

    if not updated:
        raise ValueError("No se pudo conciliar ningún documento válido")

    return {
        "conciliation_id": conciliation_id,
        "documents": updated
    }


def clear_supplier_conciliation(session, headers, supplier_name, company, documents):
    normalized_supplier = _normalize_supplier_name(session, headers, supplier_name, company)
    supplier_names = {supplier_name, normalized_supplier}
    cleared = []

    for doc in documents or []:
        docname = (doc.get('voucher_no') or doc.get('name') or '').strip()
        if not docname:
            continue
        doctype_hint = doc.get('doctype') or doc.get('doc_type') or doc.get('voucher_type')
        doctype, data = _resolve_supplier_document(session, docname, doctype_hint)
        _validate_supplier_document(data, doctype, supplier_names, company)
        _update_conciliation_field(session, doctype, docname, "")
        cleared.append(docname)

    return {"cleared_documents": cleared}


@supplier_reconciliation_bp.route('/api/supplier-reconciliations', methods=['GET'])
def get_supplier_reconciliations():
    """Obtener grupos de conciliación por proveedor."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        supplier = request.args.get('supplier')
        company = request.args.get('company')
        if not supplier or not company:
            return jsonify({"success": False, "message": "Parámetros requeridos: supplier, company"}), 400

        erp_supplier = _normalize_supplier_name(session, headers, supplier, company)

        filters = json.dumps([
            ["company", "=", company]
        ])
        fields = json.dumps(["*"])
        inv_resp, inv_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Purchase Invoice",
            params={
                "filters": filters,
                "fields": fields,
                "limit_page_length": 1000
            },
            operation_name="Get purchase invoices with conciliation id"
        )
        invoices = inv_resp.json().get('data', []) if inv_resp and inv_resp.status_code == 200 else []

        # Filtrar por supplier y conciliation_id
        invoices = [inv for inv in invoices if inv.get("supplier") == erp_supplier and inv.get(CONCILIATION_FIELD)]

        pe_filters = json.dumps([
            ["party_type", "=", "Supplier"],
            ["company", "=", company]
        ])
        pe_resp, pe_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Payment Entry",
            params={
                "filters": pe_filters,
                "fields": fields,
                "limit_page_length": 1000
            },
            operation_name="Get supplier payments with conciliation id"
        )
        payments = pe_resp.json().get('data', []) if pe_resp and pe_resp.status_code == 200 else []

        # Filtrar por party y conciliation_id
        payments = [pay for pay in payments if pay.get("party") == erp_supplier and pay.get(CONCILIATION_FIELD)]

        reconciliations_dict = {}
        for inv in invoices:
            rec_id = inv.get(CONCILIATION_FIELD)
            if not rec_id:
                continue
            group = reconciliations_dict.setdefault(rec_id, {
                "reconciliation_id": rec_id,
                "documents": [],
                "total_amount": 0,
                "posting_date": inv.get("posting_date")
            })
            group["documents"].append({
                "voucher_no": inv.get("name"),
                "voucher_type": "Nota de Débito" if inv.get("is_return") else "Factura",
                "posting_date": inv.get("posting_date"),
                "amount": abs(float(inv.get("grand_total", 0))),
                "outstanding": float(inv.get("outstanding_amount", 0)),
                "docstatus": int(inv.get("docstatus") or 0),
                CONCILIATION_FIELD: rec_id
            })

        for pe in payments:
            rec_id = pe.get(CONCILIATION_FIELD)
            if not rec_id:
                continue
            group = reconciliations_dict.setdefault(rec_id, {
                "reconciliation_id": rec_id,
                "documents": [],
                "total_amount": 0,
                "posting_date": pe.get("posting_date")
            })
            group["documents"].append({
                "voucher_no": pe.get("name"),
                "voucher_type": "Pago",
                "posting_date": pe.get("posting_date"),
                "amount": float(pe.get("paid_amount", 0)),
                "outstanding": -float(pe.get("unallocated_amount", 0)),
                "docstatus": int(pe.get("docstatus") or 0),
                CONCILIATION_FIELD: rec_id
            })

        for rec_id, rec_data in reconciliations_dict.items():
            rec_data["total_amount"] = sum(doc["outstanding"] for doc in rec_data["documents"])
            rec_data["total_amount"] = round(rec_data["total_amount"], 2)

        reconciliations_list = list(reconciliations_dict.values())
        reconciliations_list.sort(key=lambda x: x["posting_date"], reverse=True)

        return jsonify({
            "success": True,
            "data": reconciliations_list
        })

    except Exception as e:
        print(f"[get_supplier_reconciliations] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@supplier_reconciliation_bp.route('/api/supplier-reconcile/multi-document', methods=['POST'])
def reconcile_supplier_multi_document():
    """Agrupar documentos de compra bajo un conciliation_id sin mover montos."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        supplier_name = data.get('supplier')
        company = data.get('company')
        debit_docs = data.get('debit_documents', [])
        credit_docs = data.get('credit_documents', [])
        extra_docs = data.get('documents', [])

        if not supplier_name or not company:
            return jsonify({"success": False, "message": "Faltan campos requeridos: supplier, company"}), 400

        combined = debit_docs + credit_docs + extra_docs
        documents = []
        for doc in combined:
            voucher = (doc.get('voucher_no') or doc.get('name') or '').strip()
            if not voucher:
                continue
            documents.append({
                "voucher_no": voucher,
                "doctype": doc.get('doctype') or doc.get('doc_type') or doc.get('voucher_type')
            })

        # Si no se pasa una conciliación existente, requerimos al menos 2 documentos
        # para crear una nueva conciliación. Si se pasó `conciliation_id`, permitimos
        # agregar incluso un solo documento, pero validamos que la conciliación exista
        # y pertenezca al proveedor/compañía.
        conciliation_id = data.get('conciliation_id') or None

        if not conciliation_id:
            if len(documents) < 2:
                return jsonify({"success": False, "message": "Debe seleccionar al menos dos documentos"}), 400
        else:
            if len(documents) < 1:
                return jsonify({"success": False, "message": "Seleccione al menos un comprobante para agregar"}), 400

            # Validar existencia de la conciliación para este proveedor/compañía
            try:
                erp_supplier = _normalize_supplier_name(session, headers, supplier_name, company)
                # Buscar en Purchase Invoice
                filters = json.dumps([[CONCILIATION_FIELD, "=", conciliation_id], ["company", "=", company]])
                fields = json.dumps(["name", "supplier"])
                inv_resp, inv_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Purchase%20Invoice",
                    params={"filters": filters, "fields": fields, "limit_page_length": 1},
                    operation_name="Validate supplier conciliation existence (invoice)"
                )

                invoice_found = False
                if inv_resp and inv_resp.status_code == 200:
                    for inv in inv_resp.json().get('data', []):
                        if inv.get('supplier') == erp_supplier:
                            invoice_found = True
                            break

                payment_found = False
                if not invoice_found:
                    pe_filters = json.dumps([[CONCILIATION_FIELD, "=", conciliation_id], ["company", "=", company]])
                    pe_fields = json.dumps(["name", "party", "party_type"])
                    pe_resp, pe_err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Payment%20Entry",
                        params={"filters": pe_filters, "fields": pe_fields, "limit_page_length": 1},
                        operation_name="Validate supplier conciliation existence (payment)"
                    )
                    if pe_resp and pe_resp.status_code == 200:
                        for pe in pe_resp.json().get('data', []):
                            if pe.get('party_type') == 'Supplier' and pe.get('party') == erp_supplier:
                                payment_found = True
                                break

                if not invoice_found and not payment_found:
                    return jsonify({"success": False, "message": "Conciliación no encontrada o no pertenece al proveedor/empresa"}), 400
            except Exception:
                return jsonify({"success": False, "message": "Error al validar conciliación existente"}), 400

        conciliation_id = conciliation_id or generate_conciliation_id("CONC-SUP")
        result = assign_supplier_conciliation(
            session=session,
            headers=headers,
            supplier_name=supplier_name,
            company=company,
            documents=documents,
            conciliation_id=conciliation_id
        )

        return jsonify({"success": True, **result})

    except ValueError as ve:
        return jsonify({"success": False, "message": str(ve)}), 400
    except Exception as e:
        print(f"[reconcile_supplier_multi_document] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@supplier_reconciliation_bp.route('/api/supplier-reconciliations/<conciliation_id>', methods=['DELETE'])
def unreconcile_supplier_documents(conciliation_id):
    """Desconciliar documentos de proveedor removiendo el ID de conciliación"""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Buscar todos los documentos con este conciliation_id
        filters = [
            [CONCILIATION_FIELD, "=", conciliation_id]
        ]
        fields = ["name", "doctype"]
        filters_str = json.dumps(filters)
        fields_str = json.dumps(fields)

        # Buscar en Purchase Invoice
        invoice_response, invoice_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Purchase%20Invoice?fields={quote(fields_str)}&filters={quote(filters_str)}&limit_page_length=1000",
            operation_name="Find Purchase Invoices for unreconcile"
        )

        # Buscar en Payment Entry
        payment_response, payment_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Payment%20Entry?fields={quote(fields_str)}&filters={quote(filters_str)}&limit_page_length=1000",
            operation_name="Find Payment Entries for unreconcile"
        )

        documents_to_update = []

        if invoice_response and invoice_response.status_code == 200:
            invoice_data = invoice_response.json()
            for invoice in invoice_data.get("data", []):
                invoice["doctype"] = "Purchase Invoice"
                documents_to_update.append(invoice)

        if payment_response and payment_response.status_code == 200:
            payment_data = payment_response.json()
            for payment in payment_data.get("data", []):
                payment["doctype"] = "Payment Entry"
                documents_to_update.append(payment)

        if not documents_to_update:
            return jsonify({"success": False, "message": "No se encontraron documentos para desconciliar"}), 404

        # Actualizar cada documento removiendo el campo de conciliación
        updated_count = 0
        for doc in documents_to_update:
            update_response, update_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/{quote(doc['doctype'])}/{quote(doc['name'])}",
                data={"data": {CONCILIATION_FIELD: None}},
                operation_name=f"Unreconcile supplier document {doc['name']}"
            )

            if update_error:
                print(f"Error unreconciling {doc['doctype']} {doc['name']}: {update_error}")
                continue

            updated_count += 1

        return jsonify({
            "success": True,
            "message": f"Desconciliación completada. {updated_count} documentos actualizados.",
            "updated_count": updated_count
        })

    except Exception as e:
        print(f"[unreconcile_supplier_documents] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
