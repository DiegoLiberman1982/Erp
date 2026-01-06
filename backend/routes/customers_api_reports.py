from flask import request, jsonify
import os
import requests
import json
from urllib.parse import quote
from datetime import datetime, timedelta

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company, get_company_abbr, add_company_abbr, remove_company_abbr, resolve_customer_name

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth
from routes.customer_utils import ensure_customer_by_tax, fetch_customer, get_customer_tax_condition
from routes.customers_common import _get_active_company_abbr, _safe_float

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from utils.conciliation_utils import (
    CONCILIATION_FIELD,
    build_conciliation_groups,
    exclude_balanced_documents,
    summarize_group_balances,
)
from routes.reconciliation import _customer_conciliation_amount

# Crear el blueprint para las rutas de clientes


def register(bp):
    @bp.route('/api/customer-statements', methods=['GET', 'OPTIONS'])
    def get_customer_statements():
        """Obtiene los movimientos de cuenta corriente de un cliente"""

        # Manejar preflight request para CORS
        if request.method == 'OPTIONS':
            return '', 200

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener parámetros
        customer_name = request.args.get('customer')
        page = int(request.args.get('page', 1))
        # Defensive clamp: ensure page is 1 or greater to avoid negative limit_start values.
        if page < 1:
            print(f"Warning: page param < 1 received ({page}) for customer statements; clamping to 1")
            page = 1
        limit = int(request.args.get('limit', 50))  # Por defecto 50 registros por página

        if not customer_name:
            return jsonify({"success": False, "message": "Nombre del cliente requerido"}), 400

        try:
            # Obtener la compañía activa
            company_name = get_active_company(user_id)

            if not company_name:
                return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

            # Obtener movimientos de GL Entry para el cliente
            gl_filters = [
                ["party_type", "=", "Customer"],
                ["party", "=", customer_name],
                ["company", "=", company_name],
                ["is_cancelled", "=", 0],  # Excluir movimientos cancelados
                ["voucher_type", "in", ["Sales Invoice", "Payment Entry", "Journal Entry"]]  # Incluir también Journal Entry por si las notas de crédito las usan
            ]

            fields = '["posting_date","voucher_type","voucher_no","debit","credit","remarks"]'
            gl_filters_str = json.dumps(gl_filters)
            gl_url = f"/api/resource/GL%20Entry?fields={quote(fields)}&filters={quote(gl_filters_str)}&order_by=posting_date%20asc&limit_page_length={limit}&limit_start={(page-1)*limit}"
            gl_response, gl_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=gl_url,
                operation_name="Fetch GL Entries"
            )

            if gl_error:
                return handle_erpnext_error(gl_error, "Failed to fetch GL entries")

            gl_data = gl_response.json()
            gl_movements = gl_data.get("data", [])

            # Siempre obtener facturas y pagos directamente para asegurar que las notas de crédito aparezcan
            movements = []

            # Obtener facturas del cliente
            invoice_filters = [
                ["customer", "=", customer_name],
                ["company", "=", company_name],
                ["docstatus", "=", 1],  # Solo Submitted, excluir Draft
            ]

            fields = json.dumps([
                "name",
                "posting_date",
                "grand_total",
                "outstanding_amount",
                "base_grand_total",
                "currency",
                "party_account_currency",
                "conversion_rate",
                "status",
                "is_return",
                "return_against",
                "remarks",
                CONCILIATION_FIELD
            ])
            invoice_filters_str = json.dumps(invoice_filters)
            invoice_url = f"/api/resource/Sales%20Invoice?fields={quote(fields)}&filters={quote(invoice_filters_str)}&order_by=posting_date%20asc&limit_page_length={limit}&limit_start={(page-1)*limit}"
            invoice_response, invoice_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=invoice_url,
                operation_name="Fetch Customer Invoices"
            )

            if invoice_error:
                return handle_erpnext_error(invoice_error, "Failed to fetch customer invoices")

            invoice_data = invoice_response.json()
            invoices = invoice_data.get("data", [])
            for inv in invoices:
                inv["doctype"] = "Sales Invoice"
            
                # === LOG: DATOS CRUDOS DE ERPNEXT ===
                print(f"\n=== FACTURA {inv.get('name')} ===")
                print(f"currency: {inv.get('currency')}")
                print(f"grand_total: {inv.get('grand_total')} (moneda del documento)")
                print(f"base_grand_total: {inv.get('base_grand_total')} (ARS)")
                print(f"outstanding_amount: {inv.get('outstanding_amount')} (¿en qué moneda?)")
                print(f"conversion_rate: {inv.get('conversion_rate')}")
            
                # === CÁLCULO: base_outstanding_amount ===
                conversion_rate = _safe_float(inv.get("conversion_rate") or 1) or 1
                outstanding_value = _safe_float(inv.get("outstanding_amount", 0))
            
                # TEORÍA ORIGINAL: outstanding_amount está en moneda del documento, hay que convertirlo
                calculated_base_outstanding = outstanding_value * conversion_rate
                print(f"CÁLCULO VIEJO: outstanding_amount ({outstanding_value}) * conversion_rate ({conversion_rate}) = {calculated_base_outstanding}")
            
                # TEORÍA CORRECTA: outstanding_amount YA está en ARS
                print(f"TEORÍA NUEVA: outstanding_amount ya está en ARS = {outstanding_value}")
            
                inv["base_outstanding_amount"] = outstanding_value  # NO multiplicar
            
                # === CÁLCULO: base_grand_total ===
                if "base_grand_total" not in inv or inv["base_grand_total"] is None:
                    grand_total = _safe_float(inv.get("grand_total", 0))
                    calculated_base_total = grand_total * conversion_rate
                    print(f"base_grand_total NO vino de ERPNext, calculando: {grand_total} * {conversion_rate} = {calculated_base_total}")
                    inv["base_grand_total"] = calculated_base_total
                else:
                    print(f"base_grand_total vino de ERPNext: {inv['base_grand_total']}")
            
                # === RESULTADO FINAL ===
                print(f"FINAL base_grand_total (TOTAL): {inv['base_grand_total']}")
                print(f"FINAL base_outstanding_amount (SALDO): {inv['base_outstanding_amount']}")
                print(f"FINAL PAGADO (calculado): {_safe_float(inv['base_grand_total']) - _safe_float(inv['base_outstanding_amount'])}")
                print("=" * 60)
            conciliation_candidates = []
            for inv in invoices:
                rec_id = inv.get(CONCILIATION_FIELD)
                if not rec_id:
                    continue
                # Usar valores en moneda base (ARS) para conciliaciones
                amount_value = _safe_float(inv.get("base_grand_total", 0))
                outstanding_value = _safe_float(inv.get("base_outstanding_amount", 0))
                voucher_type = "Sales Invoice"
                if inv.get("is_return") or amount_value < 0:
                    voucher_type = "Credit Note"
            
                # Generar remarks si no existe
                remarks = inv.get("remarks")
                if not remarks:
                    if inv.get("is_return") or amount_value < 0:
                        remarks = f"Nota de Crédito {inv.get('name')}"
                        if inv.get("return_against"):
                            remarks += f" (contra {inv.get('return_against')})"
                    else:
                        remarks = f"Factura {inv.get('name')}"
            
                conciliation_candidates.append({
                    "name": inv.get("name"),
                    "voucher_no": inv.get("name"),
                    "voucher_type": voucher_type,
                    "posting_date": inv.get("posting_date"),
                    "doctype": "Sales Invoice",
                    "amount": amount_value,
                    "outstanding": outstanding_value,
                    "outstanding_amount": outstanding_value,
                    "base_grand_total": amount_value,  # Agregar para consistencia con pending_invoices
                    "base_outstanding_amount": outstanding_value,  # Agregar para consistencia
                    "remarks": remarks,
                    CONCILIATION_FIELD: rec_id,
                })

            # Procesar documentos pendientes
            pending_documents = []
            processed_groups = set()

            # --- PASO 1: Agrupar documentos por 'return_against' ---
            groups = {}
            standalone_docs = []
            for doc in invoices:
                return_against = doc.get("return_against")
                if return_against:
                    if return_against not in groups:
                        groups[return_against] = []
                    groups[return_against].append(doc)
                else:
                    standalone_docs.append(doc)

            # --- PASO 2: Procesar cada grupo de documentos relacionados (FC + sus NCs) ---
            for original_invoice_name, credit_notes in groups.items():

                if original_invoice_name in processed_groups:
                    continue
                processed_groups.add(original_invoice_name)

                original_invoice = next((doc for doc in invoices if doc["name"] == original_invoice_name), None)
            
                if original_invoice:
                
                    if original_invoice.get("docstatus") == 2:
                        continue
                    
                    # Calcular saldo restante de la factura
                    saldo_restante_factura = original_invoice.get("grand_total", 0)

                    # Ordenar NCs por fecha/nombre para una aplicación consistente
                    credit_notes.sort(key=lambda x: x.get('posting_date', '') + x.get('name', ''))

                    for cn in credit_notes:
                        cn_total = abs(cn.get("grand_total", 0))
                    
                        if saldo_restante_factura > 0.01:
                            saldo_anterior = saldo_restante_factura
                            saldo_restante_factura -= cn_total
                        
                            # No agregar cn aquí, se agregarán en PASO 3 si tienen outstanding != 0
                        
                        else:
                            # No agregar cn aquí
                            pass
                
                    # Al final, si aún queda saldo en la factura, esta sigue pendiente
                    if saldo_restante_factura > 0.01:
                        # Asegurar que tenga base_outstanding_amount calculado
                        if "base_outstanding_amount" not in original_invoice or original_invoice["base_outstanding_amount"] is None:
                            conversion_rate = _safe_float(original_invoice.get("conversion_rate") or 1) or 1
                            outstanding = _safe_float(original_invoice.get("outstanding_amount", 0))
                            original_invoice["base_outstanding_amount"] = outstanding * conversion_rate
                        # Asegurar base_grand_total
                        if "base_grand_total" not in original_invoice or original_invoice["base_grand_total"] is None:
                            conversion_rate = _safe_float(original_invoice.get("conversion_rate") or 1) or 1
                            grand_total = _safe_float(original_invoice.get("grand_total", 0))
                            original_invoice["base_grand_total"] = grand_total * conversion_rate
                        pending_documents.append(original_invoice)
                
                else:
                    # Si no hay factura original, no hacer nada, se procesarán en PASO 3
                    pass

            # --- PASO 3: Procesar todos los documentos con outstanding != 0 ---
            for doc in invoices:
            
                if doc["name"] in processed_groups:
                    continue
            
                outstanding = doc.get("outstanding_amount", 0)
                if abs(outstanding) > 0.01:
                    print(f"\n>>> AGREGANDO A PENDING: {doc.get('name')}")
                    print(f"    outstanding_amount: {outstanding}")
                    print(f"    base_outstanding_amount ANTES: {doc.get('base_outstanding_amount')}")
                
                    # Asegurar que tenga base_outstanding_amount calculado
                    if "base_outstanding_amount" not in doc or doc["base_outstanding_amount"] is None:
                        conversion_rate = _safe_float(doc.get("conversion_rate") or 1) or 1
                        doc["base_outstanding_amount"] = outstanding * conversion_rate
                        print(f"    CALCULADO base_outstanding_amount: {outstanding} * {conversion_rate} = {doc['base_outstanding_amount']}")
                
                    # Asegurar que tenga base_grand_total
                    if "base_grand_total" not in doc or doc["base_grand_total"] is None:
                        conversion_rate = _safe_float(doc.get("conversion_rate") or 1) or 1
                        grand_total = _safe_float(doc.get("grand_total", 0))
                        doc["base_grand_total"] = grand_total * conversion_rate
                        print(f"    CALCULADO base_grand_total: {grand_total} * {conversion_rate} = {doc['base_grand_total']}")
                
                    print(f"    FINAL base_grand_total: {doc.get('base_grand_total')}")
                    print(f"    FINAL base_outstanding_amount: {doc.get('base_outstanding_amount')}")
                
                    pending_documents.append(doc)

            # ======================================================================
            # FIN DE SECCIÓN CON LOGS DE DEBUGGING
            # ======================================================================

            # Convertir documentos a movimientos de cuenta corriente (excluyendo cancelled)
            # ... el resto de tu código continúa aquí sin cambios ...

            # Convertir documentos a movimientos de cuenta corriente (excluyendo cancelled)
            for invoice in invoices:
                # Excluir facturas canceladas (docstatus=2 o status=Cancelled), incluir todas las submitted para historial completo
                if invoice.get("docstatus") == 2 or invoice.get("status") == "Cancelled":
                    continue
                
                # Determinar el tipo de comprobante
                voucher_type = "Factura"
                if invoice.get("is_return") or invoice.get("status") == "Return":
                    voucher_type = "Nota de Crédito"
                elif invoice.get("invoice_type"):
                    voucher_type = invoice.get("invoice_type")
            
                if invoice.get("is_return") or invoice.get("grand_total", 0) < 0 or invoice.get("status") == "Return":
                    # Nota de crédito: crédito en cuenta cliente (reduce saldo)
                    remarks = f"Nota de Crédito {invoice['name']}"
                    if invoice.get("return_against"):
                        remarks += f" (contra {invoice['return_against']})"
                    # Usar base_grand_total (ARS) para movimientos
                    base_total = float(invoice.get("base_grand_total", invoice.get("grand_total", 0)))
                    base_outstanding = float(invoice.get("base_outstanding_amount", invoice.get("outstanding_amount", 0)))
                    movement = {
                        "posting_date": invoice["posting_date"],
                        "voucher_type": voucher_type,
                        "voucher_no": invoice["name"],
                        "debit": 0,
                        "credit": abs(base_total),  # Valor absoluto para mostrar como positivo
                        "remarks": remarks,
                        "return_against": invoice.get("return_against"),
                        "base_grand_total": base_total,
                        "base_outstanding_amount": base_outstanding,
                        "doctype": "Sales Invoice"
                    }
                else:
                    # Factura normal: débito en cuenta cliente (aumenta saldo)
                    # Usar base_grand_total (ARS) para movimientos
                    base_total = float(invoice.get("base_grand_total", invoice.get("grand_total", 0)))
                    base_outstanding = float(invoice.get("base_outstanding_amount", invoice.get("outstanding_amount", 0)))
                    movement = {
                        "posting_date": invoice["posting_date"],
                        "voucher_type": voucher_type,
                        "voucher_no": invoice["name"],
                        "debit": base_total,
                        "credit": 0,
                        "remarks": f"Factura {invoice['name']}",
                        "return_against": None,
                        "base_grand_total": base_total,
                        "base_outstanding_amount": base_outstanding,
                        "doctype": "Sales Invoice"
                    }
                movements.append(movement)

            # Obtener pagos del cliente
            payment_filters = [
                ["party_type", "=", "Customer"],
                ["party", "=", customer_name],
                ["company", "=", company_name],
                ["docstatus", "=", 1],  # Solo confirmados
            ]

            fields = json.dumps([
                "name",
                "posting_date",
                "paid_amount",
                "base_paid_amount",
                "received_amount",
                "base_received_amount",
                "unallocated_amount",
                "payment_type",
                "party",
                "party_type",
                "paid_from_account_currency",
                "paid_to_account_currency",
                "source_exchange_rate",
                "target_exchange_rate",
                "remarks",
                CONCILIATION_FIELD
            ])
            payment_filters_str = json.dumps(payment_filters)
            payment_url = f"/api/resource/Payment%20Entry?fields={quote(fields)}&filters={quote(payment_filters_str)}&order_by=posting_date%20asc&limit_page_length={limit}&limit_start={(page-1)*limit}"
            payment_response, payment_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=payment_url,
                operation_name="Fetch Customer Payments"
            )

            if payment_error:
                return handle_erpnext_error(payment_error, "Failed to fetch customer payments")

            payment_data = payment_response.json()
            payments = payment_data.get("data", [])
            for payment in payments:
                payment["doctype"] = "Payment Entry"
            for payment in payments:
                rec_id = payment.get(CONCILIATION_FIELD)
                if not rec_id:
                    continue
                # Usar valores en moneda base (ARS) para conciliaciones
                base_paid_amount = _safe_float(payment.get("base_paid_amount", 0))
                unallocated_amount = _safe_float(payment.get("unallocated_amount", 0))  # Ya está en ARS
            
                # Generar remarks si no existe
                remarks = payment.get("remarks")
                if not remarks:
                    remarks = f"Pago {payment.get('name')}"
            
                conciliation_candidates.append({
                    "name": payment.get("name"),
                    "voucher_no": payment.get("name"),
                    "voucher_type": "Payment Entry",
                    "posting_date": payment.get("posting_date"),
                    "doctype": "Payment Entry",
                    "amount": base_paid_amount,
                    "outstanding": -unallocated_amount,
                    "unallocated_amount": unallocated_amount,
                    "base_paid_amount": base_paid_amount,  # Agregar para consistencia
                    "base_grand_total": base_paid_amount,  # Para pagos, el "total" es el monto pagado
                    "base_outstanding_amount": -unallocated_amount,  # Negativo porque es crédito
                    "remarks": remarks,
                    CONCILIATION_FIELD: rec_id,
                })

            # Agregar pagos con montos sin asignar a pending_documents
            for payment in payments:
                # NOTA: unallocated_amount en ERPNext ya está en moneda base (ARS)
                # No existe base_unallocated_amount como campo separado
                unallocated = float(payment.get("unallocated_amount", 0))
                if unallocated > 0.01:  # Solo incluir pagos con montos sin asignar
                    paid_amount = float(payment.get("paid_amount", 0))
                    base_paid_amount = float(payment.get("base_paid_amount", paid_amount))
                    # unallocated_amount ya está en ARS (moneda base)
                    base_unallocated = unallocated
                    company_currency = None
                    paid_currency = payment.get("paid_from_account_currency") or payment.get("paid_to_account_currency")
                    conversion_rate = None
                    if paid_amount and base_paid_amount:
                        conversion_rate = base_paid_amount / paid_amount if paid_amount else None
                
                    # Generar remarks si no existe
                    remarks = payment.get("remarks")
                    if not remarks:
                        remarks = f"Pago {payment['name']}"
                
                    pending_documents.append({
                        "name": payment["name"],
                        "posting_date": payment["posting_date"],
                        "grand_total": -paid_amount,  # Negativo para crédito
                        "base_grand_total": -base_paid_amount,
                        "outstanding_amount": -unallocated,  # Ya en ARS, negativo para crédito
                        "base_outstanding_amount": -base_unallocated,  # Mismo que outstanding_amount
                        "status": "Submitted",
                        "is_return": False,
                        "voucher_type": "Payment Entry",
                        "doctype": "Payment Entry",
                        "paid_amount": paid_amount,
                        "base_paid_amount": base_paid_amount,
                        "currency": paid_currency or company_currency,
                        "company_currency": company_currency,
                        "conversion_rate": conversion_rate,
                        "remarks": remarks,
                        CONCILIATION_FIELD: payment.get(CONCILIATION_FIELD)
                    })

            # Convertir pagos a movimientos de cuenta corriente
            for payment in payments:
                # Usar base_paid_amount (ARS) para mostrar en cuenta corriente
                base_paid = float(payment.get("base_paid_amount", payment.get("paid_amount", 0)))
                unallocated = float(payment.get("unallocated_amount", 0))
                movement = {
                    "posting_date": payment["posting_date"],
                    "voucher_type": "Payment Entry",
                    "voucher_no": payment["name"],
                    "debit": 0,
                    "credit": base_paid,
                    "remarks": f"Pago {payment['name']}",
                    "base_paid_amount": base_paid,
                    "unallocated_amount": unallocated,
                    "base_outstanding_amount": unallocated,  # For payments, outstanding = unallocated
                    "doctype": "Payment Entry"
                }
                movements.append(movement)


            # Asegurar que todos los pending_documents tengan remarks
            for doc in pending_documents:
                if not doc.get("remarks"):
                    if doc.get("doctype") == "Payment Entry":
                        doc["remarks"] = f"Pago {doc.get('name')}"
                    elif doc.get("is_return") or doc.get("grand_total", 0) < 0:
                        doc["remarks"] = f"Nota de Crédito {doc.get('name')}"
                        if doc.get("return_against"):
                            doc["remarks"] += f" (contra {doc.get('return_against')})"
                    else:
                        doc["remarks"] = f"Factura {doc.get('name')}"

            # Aplicar lógica de conciliación para ocultar grupos balanceados
            conciliation_groups, balanced_ids = build_conciliation_groups(
                conciliation_candidates,
                _customer_conciliation_amount
            )
            if balanced_ids:
                pending_documents = exclude_balanced_documents(pending_documents, balanced_ids)
            conciliation_summary = summarize_group_balances(conciliation_groups)

            # Verificar si hay más páginas disponibles
            has_more = len(movements) == limit

            return jsonify({
                "success": True,
                "data": movements,
                "pending_invoices": pending_documents,
                "conciliations": conciliation_summary,
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "has_more": has_more
                },
                "message": "Movimientos obtenidos correctamente"
            })

        except requests.exceptions.HTTPError as err:
            print("--- Estados de cuenta: error HTTP")
            return jsonify({"success": False, "message": "Error al obtener movimientos"}), 500
        except requests.exceptions.RequestException as e:
            print("--- Estados de cuenta: error conexión")
            return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500


    @bp.route('/api/customers/<customer_name>/delivery-notes', methods=['GET'])
    def get_customer_delivery_notes(customer_name):
        """Obtiene Delivery Notes de un cliente con paginación."""
        print(f"\n--- Obtener remitos de venta para el cliente {customer_name} ---")

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        try:
            company_name = get_active_company(user_id)
            if not company_name:
                return jsonify({
                    "success": False,
                    "message": f"No hay compañía activa configurada para el usuario {user_id}"
                }), 400

            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 20))
            limit_start = (page - 1) * page_size

            company_abbr = get_company_abbr(session, headers, company_name)
            search_customer = resolve_customer_name(customer_name, company_abbr) if company_abbr else customer_name

            filters = json.dumps([
                ['customer', '=', search_customer],
                ['company', '=', company_name]
            ])

            params_count = {
                'doctype': 'Delivery Note',
                'filters': filters
            }

            count_response, count_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/method/frappe.client.get_count",
                params=params_count,
                operation_name=f"Get total delivery notes for '{search_customer}'"
            )

            if count_error:
                return handle_erpnext_error(count_error, f"Error obteniendo conteo de remitos del cliente '{customer_name}'")

            total_count = 0
            if count_response.status_code == 200:
                total_count = count_response.json().get('message', 0)

            # Request all available fields (*) to avoid DataError for fields not permitted in list queries
            # (some ERPNext installations restrict fields like talonario_name/remito_number/punto_de_venta)
            fields = json.dumps(["*"])

            params_notes = {
                'filters': filters,
                'fields': fields,
                'limit_start': limit_start,
                'limit_page_length': page_size,
                'order_by': 'posting_date desc'
            }

            notes_response, notes_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Delivery Note",
                params=params_notes,
                operation_name=f"Get delivery notes page {page} for '{search_customer}'"
            )

            if notes_error:
                return handle_erpnext_error(notes_error, f"Error obteniendo remitos del cliente '{customer_name}'")

            delivery_notes = []
            if notes_response.status_code == 200:
                delivery_notes = notes_response.json().get('data', [])
                if company_abbr:
                    for note in delivery_notes:
                        if note.get('customer'):
                            note['customer'] = remove_company_abbr(note['customer'], company_abbr)

            return jsonify({
                "success": True,
                "delivery_notes": delivery_notes,
                "total_count": total_count,
                "page": page,
                "page_size": page_size,
                "message": "Remitos de venta obtenidos correctamente"
            })

        except Exception as e:
            print(f"ERROR GENERAL en get_customer_delivery_notes: {e}")
            import traceback
            print(f"Traceback: {traceback.format_exc()}")
            return jsonify({
                "success": False,
                "message": f"Error interno del servidor: {str(e)}"
            }), 500


    @bp.route('/api/customer-invoices', methods=['GET'])
    def get_customer_invoices():
        """Obtener facturas del cliente agrupadas por conciliación"""
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        try:
            customer_name = request.args.get('customer')
            status = request.args.get('status', 'all')
            limit = int(request.args.get('limit', 20))

            if not customer_name:
                return jsonify({"success": False, "message": "Customer name is required"}), 400

            company = get_active_company(user_id)
            if not company:
                return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

            # Usar la lógica de pagos para obtener facturas agrupadas
            from routes.pagos import get_unpaid_invoices as get_grouped_invoices
        
            # Modificar la request para simular la llamada
            original_args = request.args
            request.args = request.args.copy()
            request.args['party_type'] = 'Customer'
        
            # Llamar a la función de pagos pero sin filtrar outstanding > 0
            # Para eso, necesitamos modificar temporalmente o crear una versión sin filtro
        
            # Por ahora, hacer la query directamente similar pero sin filtro de outstanding
            doctype = "Sales Invoice"
            party_field = "customer"
        
            # Obtener facturas del cliente
            filters = json.dumps([[party_field, "=", customer_name], ["company", "=", company]])
            if status == 'submitted':
                filters = json.dumps([[party_field, "=", customer_name], ["company", "=", company], ["docstatus", "=", 1]])
            elif status == 'draft':
                filters = json.dumps([[party_field, "=", customer_name], ["company", "=", company], ["docstatus", "=", 0]])
            # Para 'unpaid', obtener todas y filtrar después
        
            fields = json.dumps([
                "name",
                "posting_date",
                "due_date",
                "grand_total",
                "outstanding_amount",
                "base_grand_total",
                "currency",
                "party_account_currency",
                "conversion_rate",
                "is_return",
                "docstatus",
                "status",
                CONCILIATION_FIELD
            ])

            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/{doctype}",
                params={
                    "filters": filters,
                    "fields": fields,
                    "order_by": "posting_date desc",
                    "limit": limit
                },
                operation_name="Fetch Customer Invoices"
            )

            if error:
                return handle_erpnext_error(error, "Failed to fetch customer invoices")

            data = response.json()
            invoices = data.get('data', [])
            # Para otros status, devolver todas las facturas como lista simple
            result_invoices = []
            for invoice in invoices:
                conversion_rate = _safe_float(invoice.get('conversion_rate') or 1) or 1
                base_outstanding = _safe_float(invoice.get('outstanding_amount', 0)) * conversion_rate
                result_invoices.append({
                    "name": invoice.get('name'),
                    "posting_date": invoice.get('posting_date'),
                    "due_date": invoice.get('due_date'),
                    "grand_total": invoice.get('grand_total', 0),
                    "base_grand_total": invoice.get('base_grand_total'),
                    "outstanding_amount": invoice.get('outstanding_amount', 0),
                    "base_outstanding_amount": base_outstanding,
                    "currency": invoice.get('currency'),
                    "party_account_currency": invoice.get('party_account_currency'),
                    "company_currency": invoice.get('company_currency'),
                    "conversion_rate": invoice.get('conversion_rate'),
                    "is_return": invoice.get('is_return', False),
                    "docstatus": invoice.get('docstatus'),
                    "status": invoice.get('status'),
                    CONCILIATION_FIELD: invoice.get(CONCILIATION_FIELD)
                })
            return jsonify({
                "success": True,
                "data": result_invoices,
                "message": "Facturas obtenidas correctamente"
            })
    

        except Exception as e:
            print("--- Obtener facturas cliente: error")
            return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


