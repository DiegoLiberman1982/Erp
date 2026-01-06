from flask import Blueprint, request, jsonify
from urllib.parse import quote
import json

from routes.auth_utils import get_session_with_auth
from config import ERPNEXT_URL

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from utils.conciliation_utils import (
    CONCILIATION_FIELD,
    build_conciliation_groups,
    exclude_balanced_documents,
    generate_conciliation_id,
    summarize_group_balances,
)

reconciliation_bp = Blueprint('reconciliation', __name__)


def _safe_float(value, default=0.0):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return default


def _normalize_customer_doc_type(doctype_hint: str | None) -> str | None:
    if not doctype_hint:
        return None
    doctype_hint = doctype_hint.strip()
    if not doctype_hint:
        return None
    mapping = {
        "invoice": "Sales Invoice",
        "sales invoice": "Sales Invoice",
        "nota de credito": "Sales Invoice",
        "payment": "Payment Entry",
        "payment entry": "Payment Entry",
        "pago": "Payment Entry",
    }
    lowered = doctype_hint.lower()
    return mapping.get(lowered, doctype_hint)


def _resolve_customer_document(session, docname, doctype_hint=None):
    candidates = ["Sales Invoice", "Payment Entry"]
    order = []
    normalized_hint = _normalize_customer_doc_type(doctype_hint)
    if normalized_hint:
        order.append(normalized_hint)
    order.extend(dt for dt in candidates if dt not in order)

    last_error = None
    for doctype in order:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{doctype}/{quote(docname)}",
            operation_name=f"Fetch {doctype} '{docname}' for conciliation"
        )
        if err:
            last_error = err
            continue
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            data['doctype'] = doctype
            return doctype, data
    raise ValueError(f"No se pudo obtener el documento {docname}: {last_error or 'no existe'}")


def _assign_conciliation_to_customer_docs(session, customer, company, documents, conciliation_id):
    updated = []
    seen = set()
    for doc in documents:
        docname = (doc.get('voucher_no') or doc.get('name') or '').strip()
        if not docname or docname in seen:
            continue
        seen.add(docname)
        doctype_hint = doc.get('doctype') or doc.get('doc_type') or doc.get('voucher_type')
        doctype, data = _resolve_customer_document(session, docname, doctype_hint)

        if doctype == "Sales Invoice":
            if data.get('customer') != customer:
                raise ValueError(f"La factura {docname} no pertenece al cliente {customer}")
            if data.get('company') != company:
                raise ValueError(f"La factura {docname} no pertenece a la compania {company}")
        elif doctype == "Payment Entry":
            if data.get('party_type') != "Customer" or data.get('party') != customer:
                raise ValueError(f"El pago {docname} no pertenece al cliente {customer}")
            if data.get('company') != company:
                raise ValueError(f"El pago {docname} no pertenece a la compania {company}")

        update_resp, update_err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/{doctype}/{quote(docname)}",
            data={"data": {CONCILIATION_FIELD: conciliation_id}},
            operation_name=f"Assign conciliation '{conciliation_id}' to {doctype} '{docname}'"
        )

        if update_err or update_resp.status_code not in (200, 202):
            raise ValueError(f"No se pudo actualizar {docname}: {update_err or update_resp.text}")

        updated.append({
            "name": docname,
            "doctype": doctype,
            "posting_date": data.get('posting_date'),
            "outstanding_amount": data.get('outstanding_amount'),
            "unallocated_amount": data.get('unallocated_amount'),
            CONCILIATION_FIELD: conciliation_id
        })

    if not updated:
        raise ValueError("No se pudo conciliar ningun documento valido")

    return updated


def _customer_conciliation_amount(doc):
    if doc.get('doctype') == "Payment Entry":
        return -_safe_float(doc.get('unallocated_amount'))
    return _safe_float(doc.get('outstanding_amount'))


@reconciliation_bp.route('/api/reconcile', methods=['POST'])
def reconcile_entries():
    """Endpoint para conciliar documentos (facturas, NC, pagos) mediante vinculación de GL Entries

    Payload esperado:
    {
      "company": "Mi Empresa",
      "entries": [
        {"gl_entry_name": "ACC-GLE-2025-00004", "against_voucher": "ACC-SINV-2025-00002"},
        {"gl_entry_name": "ACC-GLE-2025-00008", "against_voucher": "FE-FAC-A-00003-0000000100001"}
      ]
    }
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        entries = data.get('entries')
        if not entries or not isinstance(entries, list):
            return jsonify({"success": False, "message": "Campo 'entries' inválido o vacío"}), 400

        results = []
        # Procesar cada enlace solicitado
        for item in entries:
            gl_name = item.get('gl_entry_name')
            against = item.get('against_voucher')
            if not gl_name or not against:
                results.append({"gl_entry": gl_name, "status": "skipped", "reason": "missing fields"})
                continue

            # Obtener GL Entry actual para validar
            gle_resp, gle_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/GL Entry/{quote(gl_name)}",
                operation_name=f"Get GL entry for reconciliation '{gl_name}'"
            )

            if gle_error:
                return handle_erpnext_error(gle_error, f"Failed to get GL entry {gl_name}")

            if gle_resp.status_code != 200:
                results.append({"gl_entry": gl_name, "status": "error", "reason": f"GL Entry not found: {gle_resp.text}"})
                continue

            gle = gle_resp.json().get('data', {})

            # Validar que el party coincida (mismo cliente)
            party = gle.get('party')
            if party:
                # Validar que el against_voucher también pertenece al mismo party
                # Extract fields to avoid nested quotes in f-string
                fields_str = '["customer"]'
                against_resp, against_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Sales Invoice/{quote(against)}",
                    params={"fields": fields_str},
                    operation_name=f"Get against document '{against}'"
                )

                if against_error:
                    return handle_erpnext_error(against_error, f"Failed to get against document {against}")

                if against_resp.status_code != 200:
                    against_doc = against_resp.json().get('data', {})
                    if against_doc.get('customer') != party:
                        results.append({"gl_entry": gl_name, "status": "error", "reason": f"Party mismatch: {party} vs {against_doc.get('customer')}"})
                        continue

            # Preparar payload para actualizar against_voucher y against_voucher_type
            update_data = {"data": {"against_voucher": against, "against_voucher_type": gle.get('voucher_type', '')}}
            put_resp, put_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/GL Entry/{quote(gl_name)}",
                data=update_data,
                operation_name=f"Update GL entry for reconciliation '{gl_name}'"
            )

            if put_error:
                return handle_erpnext_error(put_error, f"Failed to update GL entry {gl_name}")

            if put_resp.status_code != 200:
                results.append({"gl_entry": gl_name, "status": "error", "reason": f"Failed to update GL Entry: {put_resp.text}"})
                continue

            results.append({"gl_entry": gl_name, "status": "linked", "against": against})

        # Después de actualizar GL Entries, si se pidió también ajustar outstanding_amounts
        if data.get('adjust_outstanding') and data.get('adjustments'):
            for adj in data.get('adjustments'):
                docname = adj.get('docname')
                new_outstanding = adj.get('new_outstanding')
                if not docname:
                    continue
                put_doc, put_doc_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Sales Invoice/{quote(docname)}",
                    data={"data": {"outstanding_amount": new_outstanding}},
                    operation_name=f"Update outstanding amount for '{docname}'"
                )

                if put_doc_error:
                    return handle_erpnext_error(put_doc_error, f"Failed to update outstanding amount for {docname}")

                if put_doc.status_code == 200:
                    results.append({"doc": docname, "status": "error", "reason": f"Failed to update outstanding: {put_doc.text}"})
                else:
                    results.append({"doc": docname, "status": "outstanding_updated", "new_outstanding": new_outstanding})

        # Invalidate reconciled identifiers cache (conservative: invalidate all)
        try:
            from routes import treasury as treasury_routes
            treasury_routes._cache_invalidate_prefix('reconciled:')
        except Exception:
            pass

        return jsonify({"success": True, "results": results})

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@reconciliation_bp.route('/api/reconciliations', methods=['GET'])
def get_reconciliations():
    """Obtener los grupos de conciliación para un cliente."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        customer = request.args.get('customer')
        company = request.args.get('company')
        
        if not customer or not company:
            return jsonify({"success": False, "message": "Parámetros requeridos: customer, company"}), 400

        # Sólo documentos submitidos (docstatus = 1)
        filters = json.dumps([
            ["company", "=", company],
            ["docstatus", "=", 1]
        ])
        fields = json.dumps(["*"])
        inv_resp, inv_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Sales Invoice",
            params={
                "filters": filters,
                "fields": fields,
                "limit_page_length": 1000
            },
            operation_name="Get sales invoices with conciliation id"
        )
        invoices = inv_resp.json().get('data', []) if inv_resp and inv_resp.status_code == 200 else []

        # Filtrar por customer y conciliation_id
        invoices = [inv for inv in invoices if inv.get("customer") == customer and inv.get(CONCILIATION_FIELD)]

        pe_filters = json.dumps([
            ["party_type", "=", "Customer"],
            ["company", "=", company],
            ["docstatus", "=", 1]
        ])
        # Para pagos necesitamos también los 'references' (child table) para verificar asignaciones
        payment_fields = json.dumps(["name", "references", "paid_amount", "unallocated_amount", "docstatus"])
        pe_resp, pe_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Payment Entry",
            params={
                "filters": pe_filters,
                "fields": payment_fields,
                "limit_page_length": 1000
            },
            operation_name="Get payment entries with conciliation id"
        )
        payments = pe_resp.json().get('data', []) if pe_resp and pe_resp.status_code == 200 else []

        # Filtrar por party y conciliation_id
        payments = [pay for pay in payments if pay.get("party") == customer and pay.get(CONCILIATION_FIELD)]

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
                "voucher_type": "Nota de Crédito" if inv.get("is_return") else "Factura",
                "posting_date": inv.get("posting_date"),
                "amount": abs(float(inv.get("grand_total", 0))),
                "outstanding": float(inv.get("outstanding_amount", 0)),
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
                CONCILIATION_FIELD: rec_id
            })

        # Además: incluir pagos que no tengan el campo de conciliación pero que estén relacionados
        # con facturas de alguna conciliación (por ejemplo pagos que ya fueron aplicados en ERPNext)
        try:
            invoice_to_rec = {}
            for rec_id, rec_data in reconciliations_dict.items():
                for d in rec_data.get('documents', []):
                    if d.get('voucher_type') in ('Factura', 'Invoice'):
                        invoice_to_rec[d.get('voucher_no')] = rec_id

            if invoice_to_rec:
                # Buscar todos los pagos del cliente (docstatus 1)
                payments_all_fields = json.dumps(["name", "references", "paid_amount", "unallocated_amount", "posting_date", "docstatus", "party"])
                payments_all_resp, payments_all_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Payment Entry",
                    params={
                        "filters": json.dumps([["party", "=", customer], ["company", "=", company], ["docstatus", "=", 1]]),
                        "fields": payments_all_fields,
                        "limit_page_length": 1000
                    },
                    operation_name="Get all payment entries for customer to infer relations"
                )

                if payments_all_resp and payments_all_resp.status_code == 200:
                    for pay in payments_all_resp.json().get('data', []):
                        refs = pay.get('references')
                        # Si no vinieron las referencias en la consulta masiva, pedir detalle por pago
                        if not refs:
                            try:
                                detail_resp, detail_err = make_erpnext_request(
                                    session=session,
                                    method="GET",
                                    endpoint=f"/api/resource/Payment%20Entry/{quote(pay.get('name'))}",
                                    params={"fields": json.dumps(["references"])},
                                    operation_name=f"Get Payment Entry {pay.get('name')} references"
                                )
                                if detail_resp and detail_resp.status_code == 200:
                                    refs = detail_resp.json().get('data', {}).get('references')
                                    # Persist the fetched references into the payment dict so later code can use them
                                    pay['references'] = refs
                            except Exception:
                                refs = []
                        if not refs:
                            continue
                        # Verificar si alguna referencia apunta a una factura del grupo
                        # Use the local 'refs' (which may have been filled from detail fetch) to avoid missing references
                        for r in (refs or pay.get('references', [])):
                            ref_name = r.get('reference_name') or r.get('against_voucher') or r.get('reference_docname') or r.get('reference')
                            if ref_name and ref_name in invoice_to_rec:
                                rec_id = invoice_to_rec[ref_name]
                                group = reconciliations_dict.setdefault(rec_id, {
                                    "reconciliation_id": rec_id,
                                    "documents": [],
                                    "total_amount": 0,
                                    "posting_date": pay.get('posting_date')
                                })
                                # Añadir sólo si no existe ya un documento con ese nombre
                                if not any(d.get('voucher_no') == pay.get('name') for d in group['documents']):
                                    group['documents'].append({
                                        'voucher_no': pay.get('name'),
                                        'voucher_type': 'Pago',
                                        'posting_date': pay.get('posting_date'),
                                        'amount': float(pay.get('paid_amount', 0)),
                                        'outstanding': -float(pay.get('unallocated_amount', 0)),
                                        CONCILIATION_FIELD: None
                                    })
                                break
        except Exception:
            # No criticar el flujo principal si falla esta heurística
            pass

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
        print(f"[get_reconciliations] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
@reconciliation_bp.route('/api/reconcile/multi-document', methods=['POST'])
def reconcile_multi_document():
    """Agrupar documentos de un cliente bajo un conciliation_id sin mover montos."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        customer_name = data.get('customer')
        company = data.get('company')
        debit_docs = data.get('debit_documents', [])
        credit_docs = data.get('credit_documents', [])
        extra_docs = data.get('documents', [])

        if not customer_name or not company:
            return jsonify({"success": False, "message": "Faltan campos requeridos: customer, company"}), 400

        combined = debit_docs + credit_docs + extra_docs
        documents = []
        for doc in combined:
            voucher = (doc.get('voucher_no') or doc.get('name') or '').strip()
            if not voucher:
                continue
            documents.append({
                'voucher_no': voucher,
                'doctype': doc.get('doctype') or doc.get('doc_type') or doc.get('voucher_type')
            })

        # Si no se pasa una conciliación existente, requerimos al menos 2 documentos
        # para crear una nueva conciliación. Si se pasó `conciliation_id`, permitimos
        # agregar incluso un solo documento (se añadirá a la conciliación existente),
        # pero validamos que la conciliación pertenezca al cliente/empresa.
        conciliation_id = data.get('conciliation_id') or None

        if not conciliation_id:
            if len(documents) < 2:
                return jsonify({"success": False, "message": "Debe seleccionar al menos dos documentos"}), 400
        else:
            # Si se quiere agregar a una conciliación existente, al menos 1 documento
            # debe ser seleccionado
            if len(documents) < 1:
                return jsonify({"success": False, "message": "Seleccione al menos un comprobante para agregar"}), 400

            # Validar que la conciliación exista y pertenezca al customer/company
            try:
                # Buscar en Sales Invoice
                filters = json.dumps([[CONCILIATION_FIELD, "=", conciliation_id], ["company", "=", company]])
                fields = json.dumps(["name", "customer"])
                inv_resp, inv_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Sales%20Invoice",
                    params={"filters": filters, "fields": fields, "limit_page_length": 1},
                    operation_name="Validate conciliation existence (invoice)"
                )

                invoice_found = False
                if inv_resp and inv_resp.status_code == 200:
                    for inv in inv_resp.json().get('data', []):
                        if inv.get('customer') == customer_name:
                            invoice_found = True
                            break

                # Si no encontramos facturas, buscar pagos asociados a la conciliación
                payment_found = False
                if not invoice_found:
                    pe_filters = json.dumps([[CONCILIATION_FIELD, "=", conciliation_id], ["company", "=", company]])
                    pe_fields = json.dumps(["name", "party", "party_type"])
                    pe_resp, pe_err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Payment%20Entry",
                        params={"filters": pe_filters, "fields": pe_fields, "limit_page_length": 1},
                        operation_name="Validate conciliation existence (payment)"
                    )
                    if pe_resp and pe_resp.status_code == 200:
                        for pe in pe_resp.json().get('data', []):
                            if pe.get('party_type') == 'Customer' and pe.get('party') == customer_name:
                                payment_found = True
                                break

                if not invoice_found and not payment_found:
                    return jsonify({"success": False, "message": "Conciliación no encontrada o no pertenece al cliente/empresa"}), 400
            except Exception as e:
                # Si falla la validación, no permitir la operación para evitar inconsistencias
                return jsonify({"success": False, "message": "Error al validar conciliación existente"}), 400

        conciliation_id = conciliation_id or generate_conciliation_id('CONC-CUS')
        updated = _assign_conciliation_to_customer_docs(
            session=session,
            customer=customer_name,
            company=company,
            documents=documents,
            conciliation_id=conciliation_id
        )

        return jsonify({
            "success": True,
            "conciliation_id": conciliation_id,
            "documents": updated
        })

    except ValueError as ve:
        return jsonify({"success": False, "message": str(ve)}), 400
    except Exception as e:
        print(f"[reconcile_multi_document] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
@reconciliation_bp.route('/api/reconcile/credit-note', methods=['POST'])
def reconcile_credit_note():
    """Conciliar una nota de crédito con facturas sin mover montos."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        credit_note_name = data.get('credit_note')
        customer_name = data.get('customer')
        company = data.get('company')
        allocations = data.get('allocations', [])

        if not credit_note_name or not customer_name or not company:
            return jsonify({"success": False, "message": "Faltan campos requeridos: credit_note, customer, company"}), 400
        if not allocations:
            return jsonify({"success": False, "message": "Debe indicar las facturas a vincular"}), 400

        documents = [{'voucher_no': credit_note_name, 'doctype': 'Sales Invoice'}]
        for alloc in allocations:
            invoice = (alloc.get('invoice') or alloc.get('voucher_no') or '').strip()
            if invoice:
                documents.append({'voucher_no': invoice, 'doctype': 'Sales Invoice'})

        conciliation_id = data.get('conciliation_id') or generate_conciliation_id('CONC-CUS')
        updated = _assign_conciliation_to_customer_docs(
            session=session,
            customer=customer_name,
            company=company,
            documents=documents,
            conciliation_id=conciliation_id
        )

        return jsonify({
            "success": True,
            "conciliation_id": conciliation_id,
            "documents": updated
        })

    except ValueError as ve:
        return jsonify({"success": False, "message": str(ve)}), 400
    except Exception as e:
        print(f"[reconcile_credit_note] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500


@reconciliation_bp.route('/api/reconciliations/<conciliation_id>', methods=['DELETE'])
def unreconcile_documents(conciliation_id):
    """Desconciliar documentos removiendo el ID de conciliación"""
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

        # Buscar en Sales Invoice
        invoice_response, invoice_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Sales%20Invoice?fields={quote(fields_str)}&filters={quote(filters_str)}&limit_page_length=1000",
            operation_name="Find Sales Invoices for unreconcile"
        )

        # Buscar en Payment Entry
        payment_response, payment_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Payment%20Entry?fields={quote(fields_str)}&filters={quote(filters_str)}&limit_page_length=1000",
            operation_name="Find Payment Entries for unreconcile"
        )

        # Reconstruir lista de documentos a actualizar y adjuntar referencias de pagos
        documents_to_update = []

        if invoice_response and invoice_response.status_code == 200:
            for inv in invoice_response.json().get("data", []):
                documents_to_update.append({"name": inv["name"], "doctype": "Sales Invoice"})

        # Re-obtener pagos incluyendo sus 'references' para chequear asignaciones
        payment_fields = json.dumps(["name", "references", "paid_amount", "unallocated_amount", "docstatus"])
        payment_resp2, payment_err2 = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Payment%20Entry",
            params={"filters": filters_str, "fields": payment_fields, "limit_page_length": 1000},
            operation_name="Find Payment Entries (with references) for unreconcile"
        )

        payment_rows = payment_resp2.json().get("data", []) if payment_resp2 and payment_resp2.status_code == 200 else []
        for pay in payment_rows:
            documents_to_update.append({"name": pay["name"], "doctype": "Payment Entry", "references": pay.get("references", [])})

        if not documents_to_update:
            return jsonify({"success": False, "message": "No se encontraron documentos para desconciliar"}), 404

        # Antes de actualizar, validar si hay pagos que referencian facturas fuera de este grupo
        invoice_names_in_group = {d["name"] for d in documents_to_update if d.get("doctype") == "Sales Invoice"}

        payments_with_external_allocations = []
        payments_safe = []
        for doc in documents_to_update:
            if doc.get("doctype") != "Payment Entry":
                continue
            refs = doc.get("references") or []
            external_refs = []
            for r in refs:
                # intentar diferentes claves que puede usar ERPNext
                ref_name = r.get("reference_name") or r.get("against_voucher") or r.get("reference_docname") or r.get("name")
                ref_doctype = r.get("reference_doctype") or r.get("against_voucher_type") or r.get("reference_doctype")
                # Si es un invoice y no está en el grupo, marcar como externo
                if ref_name and (not invoice_names_in_group or ref_name not in invoice_names_in_group):
                    # sólo listar referencias a Sales Invoice (si hay doctype disponible)
                    if not ref_doctype or ref_doctype == "Sales Invoice":
                        external_refs.append({"reference_name": ref_name, "reference_doctype": ref_doctype, "allocated_amount": r.get("allocated_amount")})

            if external_refs:
                payments_with_external_allocations.append({"name": doc.get("name"), "references": external_refs})
            else:
                payments_safe.append(doc)

        force = request.args.get('force') in ("1", "true", "True")
        if payments_with_external_allocations and not force:
            return jsonify({
                "success": False,
                "message": "Algunos pagos están asignados a facturas fuera de esta conciliación. Revise y cancele los pagos o reintente con force=1 para desconciliar sólo documentos seguros.",
                "payments": payments_with_external_allocations
            }), 409

        # Actualizar cada documento removiendo el campo de conciliación (si es seguro)
        updated_count = 0

        # Primero procesar facturas
        for doc in documents_to_update:
            if doc.get("doctype") != "Sales Invoice":
                continue
            update_response, update_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/{quote(doc['doctype'])}/{quote(doc['name'])}",
                data={"data": {CONCILIATION_FIELD: None}},
                operation_name=f"Unreconcile document {doc['name']}"
            )

            if update_error:
                print(f"Error unreconciling {doc['doctype']} {doc['name']}: {update_error}")
                continue

            if update_response and update_response.status_code in (200, 202):
                updated_count += 1

        # Luego procesar pagos seguros
        for doc in payments_safe:
            update_response, update_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/{quote(doc['doctype'])}/{quote(doc['name'])}",
                data={"data": {CONCILIATION_FIELD: None}},
                operation_name=f"Unreconcile document {doc['name']}"
            )

            if update_error:
                print(f"Error unreconciling {doc['doctype']} {doc['name']}: {update_error}")
                continue

            if update_response and update_response.status_code in (200, 202):
                updated_count += 1

        return jsonify({
            "success": True,
            "message": f"Desconciliación completada. {updated_count} documentos actualizados.",
            "updated_count": updated_count
        })

        # Invalidate reconciled identifiers cache (conservative: invalidate all)
        try:
            from routes import treasury as treasury_routes
            treasury_routes._cache_invalidate_prefix('reconciled:')
        except Exception:
            pass

    except Exception as e:
        print(f"[unreconcile_documents] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": str(e)}), 500
