"""
Routes for importing bank movements (Bank Transactions) from CSV/Excel files.
"""

from flask import Blueprint, request, jsonify
import json
from datetime import datetime
from collections import defaultdict

from routes.auth_utils import get_session_with_auth
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from routes.general import get_company_default_currency

bank_movements_import_bp = Blueprint('bank_movements_import', __name__)
MAX_BANK_TRANSACTION_BATCH = 200
SEVERITY_ORDER = {
    "none": 0,
    "yellow": 1,
    "orange": 2,
    "red": 3
}


def _parse_date(date_str):
    """Parse date from various formats to YYYY-MM-DD."""
    if not date_str:
        return None
    date_str = str(date_str).strip()
    
    # Try different formats
    formats = [
        '%d/%m/%Y',  # DD/MM/YYYY
        '%d-%m-%Y',  # DD-MM-YYYY
        '%Y-%m-%d',  # YYYY-MM-DD (already correct)
        '%Y/%m/%d',  # YYYY/MM/DD
        '%d.%m.%Y',  # DD.MM.YYYY
    ]
    
    for fmt in formats:
        try:
            parsed = datetime.strptime(date_str, fmt)
            return parsed.strftime('%Y-%m-%d')
        except ValueError:
            continue
    
    return None


def _parse_amount(value):
    """Parse amount from string to float, handling different decimal separators."""
    if value is None or value == '':
        return 0.0
    
    raw = str(value).strip()
    if not raw:
        return 0.0
    
    # Handle Argentine format: dots for thousands, comma for decimals
    # First check if it looks like Argentine format (has comma for decimals)
    if ',' in raw and '.' in raw:
        # e.g., "1.234,56" -> "1234.56"
        normalized = raw.replace('.', '').replace(',', '.')
    elif ',' in raw and '.' not in raw:
        # e.g., "1234,56" -> "1234.56"
        normalized = raw.replace(',', '.')
    else:
        # Already in standard format or no decimal
        normalized = raw
    
    try:
        return float(normalized)
    except ValueError:
        return 0.0


def _resolve_bank_account(session, bank_account_value, company):
    """Resolve bank account name from the provided value."""
    if not bank_account_value:
        return None
    
    # First, try to find by exact name
    try:
        filters = json.dumps([
            ["name", "=", bank_account_value],
            ["company", "=", company]
        ])
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Account",
            params={
                "filters": filters,
                "fields": json.dumps(["name"]),
                "limit_page_length": 1
            },
            operation_name="Resolve Bank Account by name"
        )
        if not error and response.status_code == 200:
            data = response.json().get("data", [])
            if data:
                return data[0].get("name")
    except Exception as e:
        print(f"DEBUG: Error resolving bank account by name: {e}")
    
    # Try by ledger account
    try:
        filters = json.dumps([
            ["account", "=", bank_account_value],
            ["company", "=", company]
        ])
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Account",
            params={
                "filters": filters,
                "fields": json.dumps(["name"]),
                "limit_page_length": 1
            },
            operation_name="Resolve Bank Account by ledger"
        )
        if not error and response.status_code == 200:
            data = response.json().get("data", [])
            if data:
                return data[0].get("name")
    except Exception as e:
        print(f"DEBUG: Error resolving bank account by ledger: {e}")
    
    return None


def _check_duplicate_transaction(session, reference_number, transaction_id, bank_account, date):
    """Check if a transaction with the same reference already exists."""
    try:
        filters = [["bank_account", "=", bank_account]]
        
        # Add reference_number filter if provided
        if reference_number:
            filters.append(["reference_number", "=", reference_number])
        
        # If no reference, check by transaction_id
        if not reference_number and transaction_id:
            filters = [
                ["bank_account", "=", bank_account],
                ["transaction_id", "=", transaction_id]
            ]
        
        # If neither, check by date (less reliable, just log)
        if not reference_number and not transaction_id:
            return False
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Transaction",
            params={
                "filters": json.dumps(filters),
                "fields": json.dumps(["name"]),
                "limit_page_length": 1
            },
            operation_name="Check duplicate bank transaction"
        )
        
        if not error and response.status_code == 200:
            data = response.json().get("data", [])
            return len(data) > 0
        
        return False
    except Exception as e:
        print(f"DEBUG: Error checking duplicate: {e}")
        return False


def _normalize_text(value):
    if not value:
        return ''
    return ' '.join(str(value).strip().lower().split())


def _normalize_reference(value):
    if not value:
        return ''
    return str(value).strip().lower()


def _extract_amount_components(movement):
    deposit = _parse_amount(movement.get('deposit') or movement.get('deposito') or 0)
    withdrawal = _parse_amount(movement.get('withdrawal') or movement.get('retiro') or 0)
    amount = movement.get('amount') or movement.get('monto')
    if amount is not None and deposit == 0 and withdrawal == 0:
        parsed_amount = _parse_amount(amount)
        if parsed_amount >= 0:
            deposit = parsed_amount
            withdrawal = 0
        else:
            deposit = 0
            withdrawal = abs(parsed_amount)
    net = deposit - withdrawal
    return round(net, 2), deposit, withdrawal


def _add_issue(row, severity, issue_type, message, trackers=None, meta=None):
    """Append an issue to the row and update severity."""
    current_level = SEVERITY_ORDER.get(row.get('severity', 'none'), 0)
    incoming_level = SEVERITY_ORDER.get(severity, 0)
    if incoming_level > current_level:
        row['severity'] = severity
    row.setdefault('issues', []).append({
        "type": issue_type,
        "severity": severity,
        "message": message,
        "meta": meta or {}
    })
    if trackers and issue_type in trackers:
        trackers[issue_type].add(row['row_index'])


def _mark_date_outliers(rows, trackers, day_threshold=30, edge_window=3):
    """Detect rows with dates far from the median near the table edges."""
    valid_rows = [row for row in rows if row.get('date_obj')]
    if len(valid_rows) < 4 or len(rows) < (edge_window * 2) + 1:
        return
    ordinals = sorted(row['date_obj'].toordinal() for row in valid_rows)
    mid = len(ordinals) // 2
    if len(ordinals) % 2 == 0:
        median_ord = (ordinals[mid - 1] + ordinals[mid]) / 2
    else:
        median_ord = ordinals[mid]
    last_index = len(rows) - 1
    for row in rows:
        idx = row['row_index'] - 1
        if idx < edge_window or idx > last_index - edge_window:
            if not row.get('date_obj'):
                continue
            diff_days = abs(row['date_obj'].toordinal() - median_ord)
            if diff_days >= day_threshold:
                message = "La fecha esta muy alejada del resto de los movimientos cargados."
                _add_issue(row, 'orange', 'date_outlier', message, trackers)


def _fetch_existing_transactions(session, bank_account, start_date, end_date):
    """Retrieve existing bank transactions within the provided date range."""
    if not bank_account or not start_date or not end_date:
        return []
    try:
        filters = [
            ["bank_account", "=", bank_account],
            ["date", ">=", start_date],
            ["date", "<=", end_date]
        ]
        params = {
            "filters": json.dumps(filters),
            "fields": json.dumps([
                "name",
                "date",
                "description",
                "reference_number",
                "transaction_id",
                "deposit",
                "withdrawal"
            ]),
            "limit_page_length": 500
        }
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Transaction",
            params=params,
            operation_name="Fetch existing bank transactions for validation"
        )
        if error or not response or response.status_code != 200:
            print(f"DEBUG: Failed to fetch existing transactions: {error or response.status_code}")
            return []
        payload = response.json() if response else {}
        data = payload.get("data", [])
        existing = []
        for tx in data:
            tx_date = tx.get("date")
            if not tx_date:
                continue
            normalized_date = _parse_date(tx_date)
            if not normalized_date:
                continue
            amount, _, _ = _extract_amount_components({
                "deposit": tx.get("deposit"),
                "withdrawal": tx.get("withdrawal")
            })
            description_key = _normalize_text(tx.get("description") or "")
            reference_raw = tx.get("reference_number") or tx.get("transaction_id") or ""
            existing.append({
                "name": tx.get("name"),
                "date": normalized_date,
                "amount": amount,
                "description_key": description_key,
                "reference": reference_raw,
                "reference_key": _normalize_reference(reference_raw),
                "transaction_id": tx.get("transaction_id") or ""
            })
        return existing
    except Exception as exc:
        print(f"DEBUG: _fetch_existing_transactions error: {exc}")
        return []


def _analyze_movements(rows, existing_transactions):
    """Detect duplicate or suspicious movements."""
    trackers = {
        'internal_duplicate': set(),
        'existing_duplicate': set(),
        'date_outlier': set()
    }
    key_map = defaultdict(list)
    for row in rows:
        key_map[row['key']].append(row)

    for group_rows in key_map.values():
        if len(group_rows) <= 1:
            continue
        ref_map = defaultdict(list)
        for row in group_rows:
            ref_map[row['reference_key'] or ''].append(row)
        for ref_value, repeated_rows in ref_map.items():
            if len(repeated_rows) > 1:
                related = [r['row_index'] for r in repeated_rows]
                ref_label = ref_value if ref_value else 'sin referencia'
                for row in repeated_rows:
                    others = [idx for idx in related if idx != row['row_index']]
                    message = f"Movimiento repetido dentro de la importacion (filas {', '.join(str(i) for i in related)}) con referencia {ref_label}."
                    _add_issue(row, 'red', 'internal_duplicate', message, trackers)
        for row in group_rows:
            if row.get('severity') == 'red':
                continue
            others = [r for r in group_rows if r['row_index'] != row['row_index']]
            if not others:
                continue
            has_reference_mismatch = any((r['reference_key'] or '') != (row['reference_key'] or '') for r in others)
            if not has_reference_mismatch:
                continue
            severity = 'yellow'
            if not row['reference_key'] or any(not (r['reference_key'] or '') for r in others):
                severity = 'orange'
            related = [r['row_index'] for r in others]
            message = f"Posible duplicado dentro del archivo (filas {', '.join(str(i) for i in related)})."
            _add_issue(row, severity, 'internal_duplicate', message, trackers)

    existing_map = defaultdict(list)
    for tx in existing_transactions or []:
        key = (tx['date'], tx['amount'], tx['description_key'])
        existing_map[key].append(tx)

    for row in rows:
        matches = existing_map.get(row['key'], [])
        if not matches:
            continue
        same_reference = []
        different_reference = []
        missing_reference = []
        for tx in matches:
            tx_ref = tx.get('reference_key') or ''
            row_ref = row['reference_key'] or ''
            if tx_ref == row_ref:
                same_reference.append(tx)
            elif not tx_ref or not row_ref:
                missing_reference.append(tx)
            else:
                different_reference.append(tx)
        if same_reference:
            names = ', '.join(tx.get('name') or 'sin nombre' for tx in same_reference)
            message = f"Este movimiento ya existe en ERPNext ({names}) con la misma referencia."
            _add_issue(row, 'red', 'existing_duplicate', message, trackers)
            continue
        if missing_reference:
            names = ', '.join(tx.get('name') or 'sin nombre' for tx in missing_reference)
            message = f"Cruza con movimientos existentes ({names}) pero falta referencia en alguno."
            _add_issue(row, 'orange', 'existing_duplicate', message, trackers)
            continue
        if different_reference:
            names = ', '.join(tx.get('name') or 'sin nombre' for tx in different_reference)
            message = f"Coincide con movimientos existentes ({names}) con referencia distinta."
            _add_issue(row, 'yellow', 'existing_duplicate', message, trackers)

    _mark_date_outliers(rows, trackers)

    summary = {
        "total_rows": len(rows),
        "yellow_count": sum(1 for row in rows if row.get('severity') == 'yellow'),
        "orange_count": sum(1 for row in rows if row.get('severity') == 'orange'),
        "red_count": sum(1 for row in rows if row.get('severity') == 'red'),
        "internal_duplicates": len(trackers['internal_duplicate']),
        "existing_duplicates": len(trackers['existing_duplicate']),
        "date_outliers": len(trackers['date_outlier'])
    }
    return rows, summary


@bank_movements_import_bp.route('/api/bank-movements/import/validate', methods=['POST'])
def validate_bank_movements():
    """Validate a batch of movements and detect duplicates against current data."""
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        payload = request.get_json() or {}
        bank_account = payload.get('bank_account')
        movements = payload.get('movements', [])

        if not bank_account:
            return jsonify({"success": False, "message": "Cuenta bancaria no especificada"}), 400
        if not movements:
            return jsonify({"success": False, "message": "No hay movimientos para analizar"}), 400

        resolved_bank_account = _resolve_bank_account(session, bank_account, active_company)
        if not resolved_bank_account:
            return jsonify({
                "success": False,
                "message": f"No se encontr¢ la cuenta bancaria '{bank_account}' para la empresa {active_company}"
            }), 400

        normalized_rows = []
        for idx, movement in enumerate(movements):
            row_index = idx + 1
            date_str = movement.get('date') or movement.get('fecha')
            parsed_date = _parse_date(date_str)
            amount, _, _ = _extract_amount_components(movement)
            if not parsed_date or amount == 0:
                continue
            description = movement.get('description') or movement.get('descripcion') or ''
            description_key = _normalize_text(description)
            reference = movement.get('reference') or movement.get('referencia') or ''
            transaction_id = movement.get('transaction_id') or ''
            combined_reference = reference or transaction_id
            reference_key = _normalize_reference(combined_reference)
            normalized_rows.append({
                "row_index": row_index,
                "row_id": str(movement.get('client_row_id') or movement.get('id') or row_index),
                "date": parsed_date,
                "date_obj": datetime.strptime(parsed_date, '%Y-%m-%d'),
                "description": description,
                "description_key": description_key,
                "reference": reference,
                "transaction_id": transaction_id,
                "reference_key": reference_key,
                "amount": amount,
                "key": (parsed_date, amount, description_key),
                "severity": "none",
                "issues": []
            })

        if not normalized_rows:
            return jsonify({"success": False, "message": "No hay movimientos validos para analizar"}), 400

        start_date = min(row['date'] for row in normalized_rows)
        end_date = max(row['date'] for row in normalized_rows)
        existing_transactions = _fetch_existing_transactions(session, resolved_bank_account, start_date, end_date)

        analyzed_rows, summary = _analyze_movements(normalized_rows, existing_transactions)
        response_rows = [{
            "row_id": row['row_id'],
            "row_index": row['row_index'],
            "severity": row.get('severity', 'none'),
            "issues": row.get('issues', [])
        } for row in analyzed_rows]

        return jsonify({
            "success": True,
            "data": {
                "rows": response_rows,
                "summary": summary
            }
        }), 200

    except Exception as exc:
        print(f"DEBUG: Exception in validate_bank_movements: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "No se pudo completar la validacion"}), 500


@bank_movements_import_bp.route('/api/bank-movements/import', methods=['POST'])
def import_bank_movements():
    """
    Import bank movements (Bank Transactions) from parsed data.
    
    Expected payload:
    {
        "bank_account": "Bank Account name",
        "movements": [
            {
                "date": "DD/MM/YYYY",
                "description": "Movement description",
                "reference": "Reference number",
                "deposit": 1000.00,  # optional
                "withdrawal": 0,     # optional
                "amount": 1000.00    # alternative to deposit/withdrawal
            },
            ...
        ],
        "skip_duplicates": true  # optional, default true
    }
    """
    print("=== bank_movements_import called ===")
    
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code
        
        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400
        
        # Obtener moneda por defecto de la empresa
        default_currency = get_company_default_currency(session, headers, active_company)
        if not default_currency:
            return jsonify({"success": False, "message": "La empresa activa no tiene moneda por defecto definida"}), 400
        
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Datos no proporcionados"}), 400
        
        bank_account = data.get('bank_account')
        movements = data.get('movements', [])
        skip_duplicates = data.get('skip_duplicates', True)
        
        if not bank_account:
            return jsonify({"success": False, "message": "Cuenta bancaria no especificada"}), 400
        
        if not movements or len(movements) == 0:
            return jsonify({"success": False, "message": "No hay movimientos para importar"}), 400
        
        print(f"DEBUG: Importing {len(movements)} movements for bank account: {bank_account}")
        
        # Resolve bank account
        resolved_bank_account = _resolve_bank_account(session, bank_account, active_company)
        if not resolved_bank_account:
            return jsonify({
                "success": False,
                "message": f"No se encontro la cuenta bancaria '{bank_account}' para la empresa {active_company}"
            }), 400
        
        print(f"DEBUG: Resolved bank account: {resolved_bank_account}")
        
        # Prepare transactions for import
        transactions_to_import = []
        skipped = []
        errors = []
        
        for idx, movement in enumerate(movements):
            row_num = idx + 1
            
            # Parse date
            date_str = movement.get('date') or movement.get('fecha')
            parsed_date = _parse_date(date_str)
            if not parsed_date:
                errors.append({
                    "row": row_num,
                    "error": f"Fecha inválida: '{date_str}'"
                })
                continue
            
            # Parse amounts
            deposit = _parse_amount(movement.get('deposit') or movement.get('deposito') or 0)
            withdrawal = _parse_amount(movement.get('withdrawal') or movement.get('retiro') or 0)
            
            # If amount is provided instead of deposit/withdrawal
            amount = movement.get('amount') or movement.get('monto')
            if amount is not None:
                parsed_amount = _parse_amount(amount)
                if parsed_amount >= 0:
                    deposit = parsed_amount
                    withdrawal = 0
                else:
                    deposit = 0
                    withdrawal = abs(parsed_amount)
            
            if deposit == 0 and withdrawal == 0:
                errors.append({
                    "row": row_num,
                    "error": "El movimiento no tiene monto (depósito o retiro)"
                })
                continue
            
            description = movement.get('description') or movement.get('descripcion') or ''
            reference = movement.get('reference') or movement.get('referencia') or ''
            transaction_id = movement.get('transaction_id') or ''
            currency = movement.get('currency') or movement.get('moneda') or default_currency
            
            # Check for duplicates if enabled
            if skip_duplicates and (reference or transaction_id):
                is_duplicate = _check_duplicate_transaction(
                    session, reference, transaction_id, resolved_bank_account, parsed_date
                )
                if is_duplicate:
                    skipped.append({
                        "row": row_num,
                        "reason": f"Duplicado: referencia '{reference or transaction_id}' ya existe"
                    })
                    continue
            
            # Build transaction document
            doc = {
                "doctype": "Bank Transaction",
                "bank_account": resolved_bank_account,
                "date": parsed_date,
                "currency": currency.upper() if currency else default_currency,
                "description": description[:140] if description else "Movimiento importado",
                "reference_number": reference[:140] if reference else "",
                "transaction_id": transaction_id[:140] if transaction_id else "",
                "deposit": deposit,
                "withdrawal": withdrawal,
                "unallocated_amount": deposit or withdrawal,
                "status": "Pending"
            }
            
            transactions_to_import.append(doc)
        
        if not transactions_to_import:
            return jsonify({
                "success": False,
                "message": "No hay movimientos válidos para importar",
                "errors": errors,
                "skipped": skipped
            }), 400
        
        print(f"DEBUG: Importing {len(transactions_to_import)} valid transactions")
        
        # Bulk insert transactions in batches of MAX_BANK_TRANSACTION_BATCH
        imported = []
        import_errors = []
        total_batches = (len(transactions_to_import) + MAX_BANK_TRANSACTION_BATCH - 1) // MAX_BANK_TRANSACTION_BATCH
        
        try:
            for batch_index in range(total_batches):
                start = batch_index * MAX_BANK_TRANSACTION_BATCH
                end = start + MAX_BANK_TRANSACTION_BATCH
                batch = transactions_to_import[start:end]
                
                if not batch:
                    continue
                
                print(f"DEBUG: Importing batch {batch_index + 1}/{total_batches} with {len(batch)} transactions")
                
                response, error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.insert_many",
                    data={"docs": batch},
                    operation_name=f"Bulk insert bank transactions (batch {batch_index + 1})"
                )
                
                if error:
                    print(f"DEBUG: Bulk insert error on batch {batch_index + 1}: {error}")
                    return jsonify({
                        "success": False,
                        "message": f"Error al importar movimientos (lote {batch_index + 1}): {error}",
                        "errors": errors,
                        "skipped": skipped
                    }), 500
                
                if response.status_code in [200, 201]:
                    result = response.json()
                    imported_names = result.get("message", [])
                    if isinstance(imported_names, list):
                        imported.extend({"name": name} for name in imported_names)
                    print(f"DEBUG: Successfully imported batch {batch_index + 1} ({len(imported_names) if isinstance(imported_names, list) else 0} transactions)")
                else:
                    error_msg = response.text if response else "Error desconocido"
                    print(f"DEBUG: Bulk insert failed on batch {batch_index + 1}: {error_msg}")
                    return jsonify({
                        "success": False,
                        "message": f"Error al importar (lote {batch_index + 1}): {error_msg}",
                        "errors": errors,
                        "skipped": skipped
                    }), 500
                
        except Exception as e:
            print(f"DEBUG: Exception in bulk insert: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({
                "success": False,
                "message": f"Error al importar movimientos: {str(e)}",
                "errors": errors,
                "skipped": skipped
            }), 500
        
        # Build response
        total = len(movements)
        imported_count = len(imported)
        skipped_count = len(skipped)
        error_count = len(errors)
        
        message_parts = [f"{imported_count} movimientos importados"]
        if skipped_count > 0:
            message_parts.append(f"{skipped_count} omitidos (duplicados)")
        if error_count > 0:
            message_parts.append(f"{error_count} con errores")
        
        return jsonify({
            "success": True,
            "message": ", ".join(message_parts),
            "data": {
                "total": total,
                "imported": imported_count,
                "skipped": skipped_count,
                "errors": error_count,
                "imported_transactions": imported
            },
            "errors": errors if errors else None,
            "skipped": skipped if skipped else None
        }), 200
        
    except Exception as e:
        print(f"DEBUG: Exception in import_bank_movements: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@bank_movements_import_bp.route('/api/bank-movements/import-template', methods=['GET'])
def get_import_template():
    """
    Return the expected columns for importing bank movements.
    """
    columns = [
        {
            "key": "date",
            "label": "Fecha",
            "type": "date",
            "format": "DD/MM/YYYY",
            "required": True,
            "description": "Fecha del movimiento",
            "width": 120
        },
        {
            "key": "description",
            "label": "Descripción",
            "type": "text",
            "required": True,
            "description": "Descripción del movimiento",
            "width": 300
        },
        {
            "key": "reference",
            "label": "Referencia",
            "type": "text",
            "required": False,
            "description": "Número de referencia o comprobante",
            "width": 150
        },
        {
            "key": "deposit",
            "label": "Depósito",
            "type": "number",
            "required": False,
            "description": "Monto de depósito (entrada de dinero)",
            "width": 120
        },
        {
            "key": "withdrawal",
            "label": "Retiro",
            "type": "number",
            "required": False,
            "description": "Monto de retiro (salida de dinero)",
            "width": 120
        },
        {
            "key": "currency",
            "label": "Moneda",
            "type": "text",
            "required": False,
            "description": "Codigo de moneda. Si no se especifica, se usa la moneda por defecto de la empresa activa.",
            "width": 80
        }
    ]
    
    return jsonify({
        "success": True,
        "data": columns
    }), 200
