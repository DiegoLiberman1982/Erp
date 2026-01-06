from flask import Blueprint, request, jsonify
import json
from urllib.parse import quote
from datetime import datetime

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company, get_company_abbr

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para movimientos sin factura
unpaid_movements_bp = Blueprint('unpaid_movements', __name__)


def _safe_float(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_date(value):
    """
    Normaliza diferentes formatos de fecha a YYYY-MM-DD.
    """
    if not value:
        return None

    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d')

    text = str(value).strip()
    if not text:
        return None

    # Quitar fracciones de segundos / zonas horarias comunes
    text = text.replace('T', ' ')
    text = text.replace('Z', '')
    text = text.split('.')[0]
    text = text.split(' ')[0]

    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(text, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None


def _group_transactions_by_month(transactions):
    """
    Agrupa transacciones bancarias por mes y tipo de movimiento para crear Payment Entries
    que respeten la temporalidad del extracto bancario.
    """
    groups = {}
    for tx in transactions or []:
        if not isinstance(tx, dict):
            continue
        deposit = _safe_float(tx.get('deposit') or tx.get('deposito'))
        withdrawal = _safe_float(tx.get('withdrawal') or tx.get('retiro'))
        amount = deposit if deposit > 0 else withdrawal
        if amount <= 0:
            continue
        payment_type = 'Receive' if deposit > 0 else 'Pay'
        parsed_date = _parse_date(tx.get('date') or tx.get('fecha')) or datetime.now().strftime('%Y-%m-%d')
        month_key = parsed_date[:7]
        group_key = f"{month_key}-{payment_type}"
        group = groups.setdefault(group_key, {
            "month_key": month_key,
            "payment_type": payment_type,
            "posting_date": parsed_date,
            "transactions": [],
            "total_amount": 0
        })
        group["transactions"].append({
            "name": tx.get('name'),
            "deposit": deposit,
            "withdrawal": withdrawal,
            "allocated_amount": amount,
            "reference_number": tx.get('reference_number') or tx.get('transaction_id') or '',
            "transaction_id": tx.get('transaction_id'),
            "raw": tx
        })
        group["total_amount"] += amount
        if parsed_date > group["posting_date"]:
            group["posting_date"] = parsed_date
    return list(groups.values())


def _resolve_party_fields(payload, company):
    """
    ERPNext requiere Party Type/Party para Payment Entry (Pay/Receive). Usamos la compa¤¡a
    como contraparte por defecto para ajustar asientos autom ticos, permitiendo override expl¡cito.
    """
    party_type = payload.get('party_type')
    party = payload.get('party')
    if party_type and party:
        return party_type, party
    return 'Company', company


def _reconcile_bank_transactions(session, transactions, payment_name):
    """
    Agrega el Payment Entry generado a cada transacci¢n bancaria y actualiza los montos asignados.
    """
    results = []
    for tx in transactions or []:
        tx_name = tx.get('name')
        if not tx_name:
            results.append({
                "transaction": None,
                "success": False,
                "error": "Transacci¢n sin identificador"
            })
            continue

        allocated_amount = _safe_float(tx.get('allocated_amount') or tx.get('deposit') or tx.get('withdrawal'))

        get_tx_response, get_tx_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Bank Transaction/{quote(tx_name)}",
            operation_name=f"Get Bank Transaction {tx_name}"
        )

        if get_tx_error or get_tx_response.status_code != 200:
            results.append({
                "transaction": tx_name,
                "success": False,
                "error": "No pudimos obtener la transacci¢n bancaria"
            })
            continue

        tx_data = get_tx_response.json().get('data', {}) or {}
        payment_entries = tx_data.get('payment_entries', []) or []
        payment_entries.append({
            "doctype": "Bank Transaction Payments",
            "parent": tx_name,
            "parenttype": "Bank Transaction",
            "parentfield": "payment_entries",
            "payment_document": "Payment Entry",
            "payment_entry": payment_name,
            "allocated_amount": allocated_amount
        })

        tx_amount = _safe_float(tx_data.get('deposit') or tx_data.get('deposito'))
        if tx_amount <= 0:
            tx_amount = _safe_float(tx_data.get('withdrawal') or tx_data.get('retiro'))

        total_allocated = sum(_safe_float(entry.get('allocated_amount')) for entry in payment_entries)
        unallocated_amount = max(tx_amount - total_allocated, 0)

        update_data = {
            "payment_entries": payment_entries,
            "allocated_amount": total_allocated,
            "unallocated_amount": unallocated_amount
        }

        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Bank Transaction/{quote(tx_name)}",
            data={"data": update_data},
            operation_name=f"Reconcile Bank Transaction {tx_name}"
        )

        if update_error or update_response.status_code not in (200, 202):
            results.append({
                "transaction": tx_name,
                "success": False,
                "error": "No pudimos actualizar la transacci¢n bancaria"
            })
        else:
            results.append({
                "transaction": tx_name,
                "success": True,
                "allocated_amount": allocated_amount
            })
    return results


def get_category_default_account(session, headers, category_name, company, payment_type):
    """
    Obtiene la cuenta contable por defecto para una categoría de movimiento.
    Esta función debe buscar en las configuraciones de la empresa o en un catálogo de categorías.
    
    Por ahora, retorna cuentas hardcoded como ejemplo. En producción, estas deben 
    venir de configuración ERPNext.
    """
    # TODO: Implementar búsqueda real en ERPNext cuando se definan las categorías
    # Por ahora retornamos ejemplos según el tipo de pago
    
    company_abbr = get_company_abbr(session, headers, company)
    
    # Mapeo básico de categorías a cuentas
    # Estos valores deben configurarse en ERPNext
    default_accounts = {
        'Receive': f'Cash - {company_abbr}',  # Cuenta de ingresos generales
        'Pay': f'Cash - {company_abbr}'  # Cuenta de gastos generales
    }
    
    return default_accounts.get(payment_type, f'Cash - {company_abbr}')


@unpaid_movements_bp.route('/api/unpaid-movements/categories', methods=['GET'])
def get_movement_categories():
    """
    Obtener categorías de movimientos sin factura disponibles.
    Las categorías deben estar configuradas en ERPNext.
    """
    print("--- Get movement categories: procesando")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        company = get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400
        
        # TODO: Implementar búsqueda real de categorías en ERPNext
        # Por ahora retornamos categorías hardcoded como ejemplo
        categories = [
            {
                "name": "AJUSTES_BANCARIOS",
                "description": "Ajustes Bancarios",
                "default_account": None,
                "requires_party": False
            },
            {
                "name": "COMISIONES_BANCARIAS",
                "description": "Comisiones Bancarias",
                "default_account": None,
                "requires_party": False
            },
            {
                "name": "INTERESES_GANADOS",
                "description": "Intereses Ganados",
                "default_account": None,
                "requires_party": False
            },
            {
                "name": "TRANSFERENCIAS_INTERNAS",
                "description": "Transferencias Internas",
                "default_account": None,
                "requires_party": False
            },
            {
                "name": "OTROS_INGRESOS",
                "description": "Otros Ingresos",
                "default_account": None,
                "requires_party": False
            },
            {
                "name": "OTROS_EGRESOS",
                "description": "Otros Egresos",
                "default_account": None,
                "requires_party": False
            }
        ]
        
        print(f"--- Get movement categories: retornando {len(categories)} categorías")
        return jsonify({
            "success": True,
            "data": categories
        })
        
    except Exception as e:
        print(f"--- Get movement categories: error - {str(e)}")
        return jsonify({"success": False, "message": f"Error interno: {str(e)}"}), 500


@unpaid_movements_bp.route('/api/unpaid-movements/create', methods=['POST'])
def create_unpaid_movement():
    """
    Crear un movimiento sin factura (Payment Entry).
    
    En modo MANUAL: solo crea el Payment Entry.
    En modo BANCO: crea el Payment Entry y luego concilia con Bank Transactions.
    """
    print("--- Create unpaid movement: procesando")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "No se recibieron datos"}), 400
        
        mode = data.get('mode', 'MANUAL')
        company = get_active_company(user_id)
        
        if not company:
            return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400
        
        # Validaciones básicas
        strategy = data.get('strategy', 'manual')
        selected_transactions = data.get('selected_bank_transactions', []) or []
        should_group_transactions = (
            mode == 'BANCO'
            and isinstance(selected_transactions, list)
            and len(selected_transactions) > 0
            and data.get('group_transactions', True)
        )
        
        tipo_movimiento = data.get('tipo_movimiento')
        if not should_group_transactions:
            if tipo_movimiento not in ['Ingreso', 'Egreso']:
                return jsonify({"success": False, "message": "Tipo de movimiento inválido"}), 400
        else:
            if tipo_movimiento not in ['Ingreso', 'Egreso']:
                tipo_movimiento = 'Ingreso'
        
        amount = float(data.get('amount', 0))
        if amount <= 0 and not should_group_transactions:
            return jsonify({"success": False, "message": "El importe debe ser mayor a cero"}), 400
        
        bank_account = data.get('bank_account')
        if not bank_account:
            return jsonify({"success": False, "message": "Cuenta bancaria requerida"}), 400
        bank_account_docname = data.get('bank_account_docname') or data.get('bank_account_id') or data.get('bank_account_record')
        
        categoria = data.get('categoria') or data.get('mapping_name') or 'Conciliación Bancaria'
        
        # Determinar tipo de pago ERPNext
        payment_type = "Receive" if tipo_movimiento == "Ingreso" else "Pay"
        # Si viene desde el modal de canje entre cajas, usar Internal Transfer
        if data.get('variant') == 'cash_exchange':
            payment_type = 'Internal Transfer'
        
        # Obtener cuenta contrapartida
        contra_cuenta = data.get('contra_cuenta') or data.get('target_account')
        if not contra_cuenta:
            # Usar cuenta por defecto de la categoría
            contra_cuenta = get_category_default_account(session, headers, categoria, company, payment_type)
        
        # Construir remarks con trazabilidad
        remarks = data.get('remarks', '')
        if mode == 'BANCO':
            if not selected_transactions:
                return jsonify({"success": False, "message": "No hay transacciones bancarias seleccionadas"}), 400
            
            # Agregar información de conciliación al remarks
            transaction_info = []
            for tx in selected_transactions:
                tx_name = tx.get('name', '')
                tx_amount = tx.get('deposit', 0) or tx.get('withdrawal', 0)
                transaction_info.append(f"{tx_name} (${tx_amount})")
            
            remarks += f"\n\nConciliación automática con movimientos bancarios:\n" + "\n".join(transaction_info)
        
        # Construir Payment Entry
        posting_date = data.get('posting_date', datetime.now().strftime('%Y-%m-%d'))
        
        # Determinar paid_from y paid_to según tipo de pago
        if payment_type == "Receive":
            paid_from = contra_cuenta  # De donde viene el dinero (cuenta de ingreso)
            paid_to = bank_account      # A donde va el dinero (cuenta bancaria)
        else:
            paid_from = bank_account    # De donde sale el dinero (cuenta bancaria)
            paid_to = contra_cuenta     # A donde va el dinero (cuenta de gasto)
        
        payment_data = {
            "doctype": "Payment Entry",
            "payment_type": payment_type,
            "posting_date": posting_date,
            "company": company,
            "paid_from": paid_from,
            "paid_to": paid_to,
            "paid_amount": amount,
            "received_amount": amount,
            "reference_no": f"UNPAID-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "reference_date": posting_date,
            "remarks": remarks
        }
        if bank_account_docname:
            payment_data["bank_account"] = bank_account_docname

        # Incluir party solo si no es Internal Transfer
        if payment_type != 'Internal Transfer':
            party_type, party = _resolve_party_fields(data, company)
            if party_type and party:
                payment_data["party_type"] = party_type
                payment_data["party"] = party
            # Agregar party si viene explícito en el payload (override)
            explicit_party_type = data.get('party_type')
            explicit_party = data.get('party')
            if explicit_party_type and explicit_party:
                payment_data['party_type'] = explicit_party_type
                payment_data['party'] = explicit_party
        
        print(f"--- Creating Payment Entry: {payment_type} for {amount} on {bank_account}")
        
        # Crear Payment Entry
        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Payment Entry",
            data={"data": payment_data},
            operation_name="Create Unpaid Movement Payment Entry"
        )
        
        if create_error:
            return handle_erpnext_error(create_error, "Error al crear Payment Entry")
        
        if create_response.status_code not in (200, 201):
            error_msg = create_response.json().get('message', 'Error desconocido')
            return jsonify({"success": False, "message": f"Error al crear Payment Entry: {error_msg}"}), 400
        
        result = create_response.json()
        payment_name = result.get('data', {}).get('name')
        
        print(f"--- Payment Entry created: {payment_name}")
        # If we're reconciling (mode BANCO), submit the Payment Entry so it's docstatus=1
        if mode == 'BANCO' and payment_name:
            try:
                created_doc = result.get('data', {})
                submit_payload = {'doc': created_doc}
                submit_response, submit_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.submit",
                    data=submit_payload,
                    operation_name=f"Submit Payment Entry '{payment_name}'"
                )
                if submit_error or submit_response.status_code != 200:
                    # rollback created payment entry if submit failed
                    make_erpnext_request(
                        session=session,
                        method="DELETE",
                        endpoint=f"/api/resource/Payment Entry/{quote(payment_name)}",
                        operation_name=f"Rollback Payment Entry '{payment_name}' draft"
                    )
                    if submit_error:
                        return handle_erpnext_error(submit_error, "Error confirmando Payment Entry")
                    return jsonify({"success": False, "message": submit_response.text}), submit_response.status_code
                # update payment_name in case submit returns different structure
                try:
                    created_after_submit = submit_response.json().get('message') or created_doc
                    payment_name = created_after_submit.get('name', payment_name)
                except Exception:
                    pass
                print(f"--- Payment Entry submitted: {payment_name}")
            except Exception as e:
                print(f"--- Warning: could not submit Payment Entry {payment_name}: {e}")
        
        # Si estamos en modo BANCO, conciliar con Bank Transactions
        if mode == 'BANCO':
            selected_transactions = data.get('selected_bank_transactions', [])
            conciliation_results = []
            
            for tx in selected_transactions:
                tx_name = tx.get('name')
                if not tx_name:
                    continue
                
                # Determinar el monto asignado (deposit o withdrawal)
                tx_deposit = float(tx.get('deposit', 0))
                tx_withdrawal = float(tx.get('withdrawal', 0))
                allocated_amount = tx_deposit if tx_deposit > 0 else tx_withdrawal
                
                # Crear entrada en Bank Transaction Payments (child table)
                # Necesitamos agregar un row a la child table
                payment_entry_row = {
                    "doctype": "Bank Transaction Payments",
                    "parent": tx_name,
                    "parenttype": "Bank Transaction",
                    "parentfield": "payment_entries",
                    "payment_document": "Payment Entry",
                    "payment_entry": payment_name,
                    "allocated_amount": allocated_amount
                }
                
                # Obtener Bank Transaction actual para agregar el child row
                get_tx_response, get_tx_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Bank Transaction/{quote(tx_name)}",
                    operation_name=f"Get Bank Transaction {tx_name}"
                )
                
                if get_tx_error or get_tx_response.status_code != 200:
                    print(f"--- Warning: Could not fetch Bank Transaction {tx_name}")
                    continue
                
                tx_data = get_tx_response.json().get('data', {})
                payment_entries = tx_data.get('payment_entries', [])
                payment_entries.append(payment_entry_row)
                
                # Calcular allocated_amount total
                total_allocated = sum(float(pe.get('allocated_amount', 0)) for pe in payment_entries)
                unallocated_amount = (tx_deposit or tx_withdrawal) - total_allocated
                
                # Actualizar Bank Transaction con el nuevo child row
                update_data = {
                    "payment_entries": payment_entries,
                    "allocated_amount": total_allocated,
                    "unallocated_amount": unallocated_amount
                }
                
                update_response, update_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Bank Transaction/{quote(tx_name)}",
                    data={"data": update_data},
                    operation_name=f"Reconcile Bank Transaction {tx_name}"
                )
                
                if update_error or update_response.status_code not in (200, 202):
                    print(f"--- Warning: Could not reconcile Bank Transaction {tx_name}")
                    conciliation_results.append({
                        "transaction": tx_name,
                        "success": False,
                        "error": "Failed to update Bank Transaction"
                    })
                else:
                    # Update succeeded — record reconciliation but DO NOT submit the Bank Transaction
                    try:
                        print(f"--- Bank Transaction {tx_name} reconciled with {payment_name}")
                        conciliation_results.append({
                            "transaction": tx_name,
                            "success": True,
                            "allocated_amount": allocated_amount
                        })
                    except Exception as e:
                        print(f"--- Warning: recording reconciliation result failed for {tx_name}: {e}")
                        conciliation_results.append({
                            "transaction": tx_name,
                            "success": False,
                            "error": "Exception while recording reconciliation result"
                        })
            
            return jsonify({
                "success": True,
                "payment_name": payment_name,
                "conciliation_results": conciliation_results,
                "message": f"Movimiento creado y {len([r for r in conciliation_results if r['success']])} transacción(es) conciliada(s)"
            })
        
        # Modo MANUAL: solo retornar el Payment Entry creado
        return jsonify({
            "success": True,
            "payment_name": payment_name,
            "message": "Movimiento creado exitosamente"
        })
        
    except Exception as e:
        print(f"--- Create unpaid movement: error - {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno: {str(e)}"}), 500


@unpaid_movements_bp.route('/api/unpaid-movements/auto-convert', methods=['POST'])
def auto_convert_bank_transactions():
    """
    Convierte movimientos bancarios seleccionados en Payment Entries agrupados por mes y tipo
    y los concilia autom ticamente contra las transacciones bancarias.
    """
    print("--- Auto convert unpaid movements: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        selected_transactions = data.get('selected_bank_transactions') or []
        if not selected_transactions:
            return jsonify({"success": False, "message": "Selecciona movimientos bancarios para conciliar"}), 400

        bank_account = data.get('bank_account')
        if not bank_account:
            return jsonify({"success": False, "message": "No se indic¢ la cuenta bancaria"}), 400
        bank_account_docname = data.get('bank_account_docname') or data.get('bank_account_id')

        company = get_active_company(user_id)
        if not company:
            return jsonify({"success": False, "message": "No se pudo determinar la compa¤¡a activa"}), 400

        strategy = (data.get('strategy') or 'mapping').lower()
        mapping_payload = data.get('mapping') or {}
        account_payload = data.get('account') or data.get('selected_account') or {}
        target_account = data.get('target_account')

        display_label = ''
        if strategy == 'mapping':
            target_account = target_account or mapping_payload.get('cuenta_contable_name') or mapping_payload.get('cuenta_contable')
            display_label = mapping_payload.get('nombre') or mapping_payload.get('name') or 'Mapeo Expense Account'
        elif strategy == 'account':
            target_account = target_account or account_payload.get('name')
            display_label = account_payload.get('account_name') or account_payload.get('name') or 'Cuenta directa'
        else:
            return jsonify({"success": False, "message": "Estrategia de conciliaci¢n inv lida"}), 400

        if not target_account:
            return jsonify({"success": False, "message": "No se encontr¢ la cuenta contable destino"}), 400

        groups = _group_transactions_by_month(selected_transactions)
        if not groups:
            return jsonify({"success": False, "message": "No se detectaron importes v lidos para conciliar"}), 400

        remarks_prefix = (data.get('remarks') or '').strip()
        category = data.get('categoria') or display_label or 'Conciliaci¢n Bancaria'
        party_type, party = _resolve_party_fields(data, company)
        created_payments = []
        conciliation_results = []

        for bucket in groups:
            payment_amount = _safe_float(bucket.get('total_amount'))
            bucket_transactions = bucket.get('transactions') or []
            if payment_amount <= 0 or not bucket_transactions:
                continue

            payment_type = bucket.get('payment_type') or 'Receive'
            posting_date = bucket.get('posting_date') or datetime.now().strftime('%Y-%m-%d')
            month_key = bucket.get('month_key', 'sin-fecha')
            reference_no = f"AUTO-{month_key}-{datetime.now().strftime('%H%M%S')}"

            remarks_lines = [
                remarks_prefix,
                f"Conciliaci¢n autom tica ({category})",
                f"Mes: {month_key} - {len(bucket_transactions)} movimiento(s)"
            ]
            movement_refs = [tx.get('name') for tx in bucket_transactions if tx.get('name')]
            if movement_refs:
                remarks_lines.append("Transacciones: " + ", ".join(movement_refs))
            remarks = "\n".join([line for line in remarks_lines if line])

            paid_from = target_account if payment_type == "Receive" else bank_account
            paid_to = bank_account if payment_type == "Receive" else target_account

            payment_data = {
                "doctype": "Payment Entry",
                "payment_type": payment_type,
                "posting_date": posting_date,
                "company": company,
                "paid_from": paid_from,
                "paid_to": paid_to,
                "paid_amount": payment_amount,
                "received_amount": payment_amount,
                "reference_no": reference_no,
                "reference_date": posting_date,
                "remarks": remarks
            }
            if bank_account_docname:
                payment_data["bank_account"] = bank_account_docname
            if party_type and party:
                payment_data["party_type"] = party_type
                payment_data["party"] = party

            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Payment Entry",
                data={"data": payment_data},
                operation_name="Create Auto Unpaid Movement Payment Entry"
            )

            if create_error:
                print(f"--- Auto convert: error al crear Payment Entry para {month_key}: {create_error}")
                return handle_erpnext_error(create_error, "Error al crear Payment Entry autom tico")

            if create_response.status_code not in (200, 201):
                error_msg = create_response.json().get('message', 'Error desconocido')
                return jsonify({
                    "success": False,
                    "message": f"Error al crear Payment Entry: {error_msg}",
                    "created_payments": created_payments
                }), 400

            payment_doc = create_response.json().get('data', {}) or {}
            payment_name = payment_doc.get('name')
            created_payments.append({
                "payment_name": payment_name,
                "payment_type": payment_type,
                "posting_date": posting_date,
                "month_key": month_key,
                "total_amount": payment_amount,
                "transaction_count": len(bucket_transactions)
            })

            conciliation_results.extend(_reconcile_bank_transactions(session, bucket_transactions, payment_name))

        if not created_payments:
            return jsonify({"success": False, "message": "Los movimientos seleccionados no tienen montos para conciliar"}), 400

        success_allocations = len([res for res in conciliation_results if res.get('success')])
        return jsonify({
            "success": True,
            "data": {
                "payments": created_payments,
                "conciliation_results": conciliation_results
            },
            "message": f"Se generaron {len(created_payments)} Payment Entries y se conciliaron {success_allocations} movimiento(s)."
        })

    except Exception as e:
        print(f"--- Auto convert unpaid movements: error - {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno: {str(e)}"}), 500
