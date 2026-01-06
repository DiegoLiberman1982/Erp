from flask import Blueprint, request, jsonify
from datetime import datetime
import requests
import os
import json
from datetime import datetime
import urllib.parse
import uuid
import unicodedata

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from services.treasury_sync_state import get_account_state, set_auto_sync

# Importar utilidades de general
from routes.general import add_company_abbr, get_company_abbr, remove_company_abbr

# Crear el blueprint para las rutas de tesorería
treasury_bp = Blueprint('treasury', __name__)

# Archivo para almacenar cuentas de tesorería
TREASURY_ACCOUNTS_FILE = os.path.join(os.path.dirname(__file__), '..', 'treasury_accounts.json')

# Simple in-memory cache for reconciled identifiers
# Key: reconciled:<account_name>:<from_date>:<to_date>
_reconciled_identifiers_cache = {}

def _cache_set(key, value, ttl_seconds=300):
    try:
        _reconciled_identifiers_cache[key] = {
            'value': value,
            'expires_at': datetime.utcnow().timestamp() + int(ttl_seconds)
        }
    except Exception:
        pass

def _cache_get(key):
    rec = _reconciled_identifiers_cache.get(key)
    if not rec:
        return None
    if rec.get('expires_at', 0) < datetime.utcnow().timestamp():
        try:
            del _reconciled_identifiers_cache[key]
        except Exception:
            pass
        return None
    return rec.get('value')

def _cache_invalidate_prefix(prefix):
    # Remove any keys that start with prefix
    keys = list(_reconciled_identifiers_cache.keys())
    for k in keys:
        if k.startswith(prefix):
            try:
                del _reconciled_identifiers_cache[k]
            except Exception:
                pass



def _parse_bool(value):
    if value is None:
        return False
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')

def _to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

def _fix_text_encoding(value):
    if not isinstance(value, str):
        return value
    if 'Ã' not in value and 'Â' not in value and '¿' not in value:
        return value
    try:
        return value.encode('latin-1', errors='ignore').decode('utf-8', errors='ignore') or value
    except Exception:
        return value

def _has_active_linked_payment(movement):
    linked = movement.get('linked_payments') or []
    for entry in linked:
        if entry and _to_float(entry.get('delinked', 0)) == 0:
            return True
    return False

def _build_linked_identifier(entry):
    if not entry:
        return None
    doc_type = entry.get('payment_doctype') or entry.get('voucher_type') or entry.get('payment_document') or 'Payment Entry'
    doc_name = (
        entry.get('payment_name')
        or entry.get('payment_entry')
        or entry.get('voucher_no')
        or entry.get('name')
    )
    if not doc_name:
        return None
    return f"{doc_type}:{doc_name}"


def _merge_linked_payment_lists(*sources):
    merged = []
    seen = set()
    for source in sources:
        for entry in source or []:
            if not entry:
                continue
            identifier = entry.get('name') or _build_linked_identifier(entry)
            if not identifier or identifier in seen:
                continue
            normalized = dict(entry)
            if not normalized.get('payment_doctype'):
                normalized['payment_doctype'] = (
                    normalized.get('payment_document')
                    or normalized.get('voucher_type')
                    or 'Payment Entry'
                )
            if not normalized.get('payment_name'):
                normalized['payment_name'] = (
                    normalized.get('payment_entry')
                    or normalized.get('voucher_no')
                    or normalized.get('name')
                )
            if 'allocated_amount' in normalized:
                normalized['allocated_amount'] = _to_float(normalized.get('allocated_amount'))
            merged.append(normalized)
            seen.add(identifier)
    return merged

def _is_bank_transaction_reconciled(movement):
    if not movement:
        return False
    unallocated = _to_float(movement.get('unallocated_amount', 0))
    if unallocated == 0:
        return True
    return _has_active_linked_payment(movement)


def _fetch_bank_transaction_details(session, transaction_name):
    """Fetch full bank transaction details including child tables."""
    try:
        endpoint = f"/api/resource/Bank Transaction/{urllib.parse.quote(transaction_name)}"
        detail_response, detail_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=endpoint,
            operation_name=f"Get Bank Transaction details '{transaction_name}'"
        )
        if detail_error or detail_response.status_code != 200:
            msg = detail_error or detail_response.json().get("_server_messages") or detail_response.text
            return {"error": msg}
        data = detail_response.json().get("data", {}) or {}

        # If remarks or other string fields contain replacement char, try re-decoding
        try:
            contains_replacement = False
            for k, v in list(data.items()):
                if isinstance(v, str) and '\ufffd' in v:
                    contains_replacement = True
                    break
            if contains_replacement:
                try:
                    text_latin1 = detail_response.content.decode('latin-1')
                    parsed = json.loads(text_latin1)
                    data_alt = parsed.get('data', {}) or {}
                    if data_alt:
                        data = data_alt
                except Exception:
                    pass
        except Exception:
            pass

        return data
    except Exception:
        return {}


def _resolve_bank_account_name(session, bank_account_value):
    """Ensure we send a valid Bank Account document name to ERPNext."""
    if not bank_account_value:
        return None

    def normalized_variants(value):
        base_value = str(value)
        variants = []
        seen = set()
        for form in (None, "NFC", "NFKC"):
            candidate = base_value if form is None else unicodedata.normalize(form, base_value)
            if candidate and candidate not in seen:
                variants.append(candidate)
                seen.add(candidate)
        return variants

    candidates = normalized_variants(bank_account_value)

    def _lookup_bank_account(field, value, op_suffix):
        filters = json.dumps([[field, "=", value]])
        lookup_resp, lookup_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Account",
            params={
                "filters": filters,
                "fields": json.dumps(["name", "account"]),
                "limit_page_length": 1
            },
            operation_name=f"{op_suffix} '{value}'"
        )
        if not lookup_error and lookup_resp.status_code == 200:
            data = lookup_resp.json().get("data") or []
            if data:
                return data[0].get("name")
        return None

    for candidate in candidates:
        try:
            resolved = _lookup_bank_account("name", candidate, "Validate Bank Account")
            if resolved:
                return resolved
        except Exception as exc:
            print(f"DEBUG: Exception validating bank account '{candidate}': {exc}")

    for candidate in candidates:
        try:
            resolved = _lookup_bank_account("account", candidate, "Resolve Bank Account for ledger")
            if resolved:
                return resolved
        except Exception as exc:
            print(f"DEBUG: Exception resolving bank account '{candidate}': {exc}")
    return None


def _fetch_bank_transaction_payments(session, transaction_names):
    """Fetch linked vouchers from Bank Transaction Payments child table."""
    if not transaction_names:
        return {}

    normalized = [name for name in transaction_names if name]
    if not normalized:
        return {}

    payments_by_tx = {name: [] for name in normalized}
    batch_size = 100

    try:
        for start in range(0, len(normalized), batch_size):
            batch = normalized[start:start + batch_size]
            payload = {
                "doctype": "Bank Transaction Payments",
                "parent": "Bank Transaction",
                "fields": [
                    "name",
                    "parent",
                    "payment_document",
                    "payment_entry",
                    "allocated_amount",
                    "idx"
                ],
                "filters": {
                    "parent": ["in", batch],
                    "parenttype": "Bank Transaction",
                    "parentfield": "payment_entries"
                },
                "order_by": "parent asc, idx asc",
                "limit_page_length": 1000
            }
            response, error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/method/frappe.client.get_list",
                data=payload,
                operation_name=f"Fetch Bank Transaction Payments batch {start // batch_size + 1}"
            )
            if error or not response or response.status_code != 200:
                print(f"DEBUG: Failed to fetch Bank Transaction Payments batch: {error or response.status_code}")
                continue

            rows = response.json().get("message", []) or []
            for row in rows:
                parent = row.get("parent")
                if not parent:
                    continue
                entry = {
                    "name": row.get("name"),
                    "payment_document": row.get("payment_document"),
                    "payment_entry": row.get("payment_entry"),
                    "payment_doctype": row.get("payment_document"),
                    "payment_name": row.get("payment_entry"),
                    "allocated_amount": _to_float(row.get("allocated_amount")),
                    "delinked": _to_float(row.get("delinked", 0)),
                    "idx": row.get("idx")
                }
                payments_by_tx.setdefault(parent, []).append(entry)
    except Exception as exc:
        print(f"DEBUG: Exception fetching Bank Transaction Payments: {exc}")

    return payments_by_tx


def load_treasury_accounts():
    """Carga las cuentas de tesorería desde el archivo JSON"""
    try:
        if os.path.exists(TREASURY_ACCOUNTS_FILE):
            with open(TREASURY_ACCOUNTS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {"treasury_accounts": []}
    except Exception as e:
        print(f"Error al cargar cuentas de tesorería: {e}")
        return {"treasury_accounts": []}

def save_treasury_accounts(data):
    """Guarda las cuentas de tesorería en el archivo JSON"""
    try:
        with open(TREASURY_ACCOUNTS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error al guardar cuentas de tesorería: {e}")
        return False


@treasury_bp.route('/api/treasury-accounts', methods=['GET'])
def get_treasury_accounts():
    """Obtener todas las cuentas de tesorería desde ERPNext (cuentas con medio de pago asignado)"""
    try:
        print("get_treasury_accounts called")

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        # Obtener empresa activa
        active_company = request.headers.get('X-Active-Company')
        print(f"Active company: {active_company}")

        if not active_company:
            print("DEBUG: No active company specified")
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Obtener abreviatura de la empresa
        company_abbr = get_company_abbr(session, headers, active_company)

        # Consultar Mode of Payment con cuentas asociadas expandidas
        mop_url = "/api/resource/Mode of Payment"
        mop_params = {
            "fields": '["name","type","accounts.default_account","accounts.company","accounts.parent"]',
            "limit_page_length": 500
        }

        print(f"DEBUG: Querying Mode of Payment with expanded accounts")
        mop_response, mop_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=mop_url,
            params=mop_params,
            operation_name="Get Mode of Payments"
        )

        if mop_error:
            print(f"DEBUG: Failed to get Mode of Payment: {mop_error}")
            return handle_erpnext_error(mop_error, "Failed to get mode of payments")

        mop_data = mop_response.json()
        mode_of_payments = mop_data.get("data", [])
        print(f"DEBUG: Found {len(mode_of_payments)} Mode of Payment records")

        # Get all bank accounts for mapping
        bank_url = "/api/resource/Bank Account"
        bank_fields = ["name", "account", "bank", "bank_account_no", "account_name"]
        bank_params = {
            "fields": json.dumps(bank_fields),
            "limit_page_length": 500
        }
        bank_response, bank_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=bank_url,
            params=bank_params,
            operation_name="Get Bank Accounts"
        )

        if bank_error:
            print(f"DEBUG: Failed to get Bank Accounts: {bank_error}")
            return handle_erpnext_error(bank_error, "Failed to get bank accounts")

        bank_mapping = {}
        if not bank_error and bank_response.status_code == 200:
            bank_data = bank_response.json().get("data", [])
            for bank_acc in bank_data:
                number_value = (
                    bank_acc.get('bank_account_no')
                    or bank_acc.get('account_number')
                    or bank_acc.get('account_no')
                    or bank_acc.get('iban')
                    or ''
                )
                bank_mapping[bank_acc.get('account')] = {
                    'name': bank_acc.get('name'),
                    'bank': bank_acc.get('bank'),
                    'account_number': number_value,
                    'account_name': bank_acc.get('account_name')
                }
        print(f"DEBUG: Loaded {len(bank_mapping)} bank account mappings")

        # Procesar todas las cuentas asociadas (sin filtrar duplicados)
        treasury_accounts = []
        account_counter = 0

        for mop in mode_of_payments:
            mode_of_payment_name = mop.get('name')
            mop_type = mop.get('type', 'Bank')
            default_account = mop.get('default_account')
            account_company = mop.get('company')


            # Solo procesar si tiene cuenta asociada y pertenece a la empresa activa
            if not default_account or account_company != active_company:
                continue

            account_name = default_account

            # Obtener detalles de la cuenta contable
            account_response, account_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Account/{urllib.parse.quote(account_name)}",
                operation_name="Get Account Details"
            )

            if account_error:
                print(f"DEBUG: Failed to get account details for {account_name}: {account_error}")
                continue

            account_data = account_response.json().get('data', {})

            # Determinar el tipo basado en el medio de pago
            account_type = 'cash' if mop_type == 'Cash' else 'bank' if mop_type == 'Bank' else mop_type.lower()

            # Mapear tipos de ERPNext a nuestros tipos
            type_mapping = {
                'bank': 'bank',
                'cash': 'cash',
                'cheque': 'cheque',
                'debit card': 'tarjeta_debito',
                'credit card': 'tarjeta_credito'
            }
            mapped_type = type_mapping.get(account_type, 'bank')

            # Buscar si existe registro Bank Account (para cuentas no cash)

            bank_account_info = bank_mapping.get(account_name, {})

            bank_name_value = (bank_account_info.get('bank') or '').strip()

            is_mercadopago_bank = bool(bank_name_value and 'mercado' in bank_name_value.lower() and 'pago' in bank_name_value.lower())

            mercadopago_state = get_account_state(active_company, account_name) if is_mercadopago_bank else {}



            # Crear entrada de cuenta de tesorería

            account_counter += 1

            treasury_account = {

                "id": account_counter,

                "name": account_name,

                "account_name": account_data.get('account_name', ''),

                "currency": account_data.get('account_currency'),  # Sin fallback - currency no account_currency

                "type": mapped_type,

                "mode_of_payment": mode_of_payment_name,

                "mode_of_payment_type": mop_type,

                "accounting_account": remove_company_abbr(account_name, company_abbr),

                "company": active_company,

                "bank_name": bank_account_info.get('bank', ''),

                "account_number": bank_account_info.get('account_number', ''),

                "bank_account_name": bank_account_info.get('account_name', ''),

                "bank_account_id": bank_account_info.get('name', ''),

                "bank_account_created": bool(bank_account_info),

                "is_mercadopago_bank": is_mercadopago_bank,

                "mercadopago_auto_sync": bool(mercadopago_state.get('auto_sync_enabled')) if is_mercadopago_bank else False,

                "mercadopago_last_sync_at": mercadopago_state.get('last_sync_at') if is_mercadopago_bank else None,

                "mercadopago_last_sync_summary": mercadopago_state.get('last_sync_summary') if is_mercadopago_bank else None,

                "mercadopago_last_report_id": mercadopago_state.get('last_report_id') if is_mercadopago_bank else None

            }

            treasury_accounts.append(treasury_account)



        return jsonify({
            "success": True,
            "data": treasury_accounts
        })

    except Exception as e:
        print(f"DEBUG: Exception in get_treasury_accounts: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

@treasury_bp.route('/api/bank-cash-accounts', methods=['GET'])
def get_bank_cash_accounts():
    """Obtener cuentas contables de banco y caja"""
    try:
        # debug: get_bank_cash_accounts called (log removed)

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        # Obtener empresa activa
        active_company = request.headers.get('X-Active-Company')
        print(f"DEBUG: Active company: {active_company}")

        if not active_company:
            print("DEBUG: No active company specified")
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Intentar obtener datos reales de ERPNext primero
        try:
            # Consultar todas las cuentas con paginación para no dejar cuentas fuera
            base_params = {
                "fields": '["name","account_name","account_type","is_group","parent_account","company"]',
                "filters": f'[["company","=","{active_company}"]]',
                "order_by": "account_name asc",
            }

            limit = 500
            all_accounts = []
            current_start = 0

            while True:
                params = {
                    **base_params,
                    "limit_page_length": limit,
                    "limit_start": current_start
                }

                print(f"DEBUG: Querying ERPNext URL: /api/resource/Account (start={current_start}, limit={limit})")

                response, error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Account",
                    params=params,
                    operation_name="Get All Accounts (paged)"
                )

                if error:
                    print(f"DEBUG: ERPNext error: {error}")
                    return handle_erpnext_error(error, "Failed to get accounts")

                batch_data = response.json().get("data", [])
                all_accounts.extend(batch_data)
                print(f"DEBUG: Retrieved {len(batch_data)} accounts in this batch (total so far: {len(all_accounts)})")

                if len(batch_data) < limit:
                    break

                current_start += limit

            print(f"DEBUG: Found {len(all_accounts)} total accounts after pagination")

            # Mostrar todas las cuentas y sus tipos para debug
            account_types = {}
            for account in all_accounts:
                acc_type = account.get("account_type", "NO_TYPE")
                if acc_type not in account_types:
                    account_types[acc_type] = 0
                account_types[acc_type] += 1

            print(f"DEBUG: Account types found: {account_types}")

            # Filtrar únicamente cuentas con tipo Bank o Cash que sean hojas
            bank_cash_accounts = []
            for account in all_accounts:
                account_type = (account.get("account_type") or "").strip()
                if account_type not in ["Bank", "Cash"]:
                    continue
                if account.get("is_group"):
                    continue

                bank_cash_accounts.append(account)
                print(f"DEBUG: Eligible account by type {account_type}: {account.get('name')}")

            print(f"DEBUG: Filtered to {len(bank_cash_accounts)} bank/cash accounts (by type)")

            # Obtener cuentas ya asignadas a mode of payment para excluirlas
            assigned_accounts = set()
            try:
                mop_url = "/api/resource/Mode of Payment"
                mop_params = {
                    "fields": '["accounts.default_account"]',
                    "limit_page_length": 500
                }
                mop_response, mop_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=mop_url,
                    params=mop_params,
                    operation_name="Get Assigned Mode of Payments"
                )
                if not mop_error and mop_response.status_code == 200:
                    mop_data = mop_response.json()
                    mode_of_payments = mop_data.get("data", [])
                    for mop in mode_of_payments:
                        default_account = mop.get('default_account')
                        if default_account:
                            assigned_accounts.add(default_account)
                    print(f"DEBUG: Found {len(assigned_accounts)} accounts already assigned to mode of payment")
            except Exception as e:
                print(f"DEBUG: Error getting assigned accounts: {e}")

            # Si hay cuentas válidas, formatearlas y excluir las ya asignadas
            if len(bank_cash_accounts) > 0:
                formatted_accounts = []
                for account in bank_cash_accounts:
                    account_full_name = account['name']
                    if not account.get("is_group", False) and account_full_name not in assigned_accounts:  # Solo cuentas hoja no asignadas
                        formatted_accounts.append({
                            "value": account_full_name,  # Usar solo el name (código completo)
                            "label": account['account_name'],  # Solo el nombre, sin tipo
                            "account_name": account['account_name'],
                            "account_code": account_full_name,
                            "account_type": account.get('account_type', '')
                        })

                return jsonify({
                    "success": True,
                    "data": formatted_accounts
                })
            else:
                print("DEBUG: No valid bank/cash accounts found in ERPNext")
                return jsonify({
                    "success": True,
                    "data": []
                })
        except Exception as e:
            print(f"DEBUG: Exception connecting to ERPNext: {e}")
            return jsonify({"success": False, "message": "Error interno del servidor"}), 500

    except Exception as e:
        print(f"DEBUG: Exception in get_bank_cash_accounts: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

@treasury_bp.route('/api/all-accounts', methods=['GET'])
def get_all_accounts():
    """Obtener todas las cuentas contables para debug"""
    try:
        # debug: get_all_accounts called (log removed)

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        # Obtener empresa activa
        active_company = request.headers.get('X-Active-Company')
        print(f"DEBUG: Active company: {active_company}")

        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Consultar todas las cuentas
        params = {
            "fields": '["name","account_name","account_type","is_group","parent_account","company"]',
            "filters": f'[["company","=","{active_company}"]]',
            "order_by": "account_name asc",
            "limit_page_length": 50
        }

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Account",
            params=params,
            operation_name="Get All Accounts for Debug"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get all accounts")
            erp_data = response.json()
            accounts = erp_data.get("data", [])

            return jsonify({
                "success": True,
                "data": accounts,
                "total": len(accounts)
            })
        else:
            return jsonify({"success": False, "message": f"Error ERPNext: {response.status_code}"}), 500

    except Exception as e:
        print(f"DEBUG: Exception in get_all_accounts: {e}")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

@treasury_bp.route('/api/treasury-accounts', methods=['POST'])
def _ensure_bank_exists(session, bank_name):
    """Verificar que un banco existe, si no existe crearlo"""
    if not bank_name or not bank_name.strip():
        return None
    
    bank_name = bank_name.strip()
    
    # Verificar si existe
    bank_check_response, bank_check_error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Bank/{urllib.parse.quote(bank_name)}",
        operation_name="Check Bank Exists"
    )
    
    if not bank_check_error and bank_check_response.status_code == 200:
        # El banco ya existe
        return bank_name
    
    # El banco no existe, crearlo
    print(f"DEBUG: Creating new bank '{bank_name}'")
    bank_create_response, bank_create_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Bank",
        data={"bank_name": bank_name},
        operation_name="Create Bank"
    )
    
    if bank_create_error:
        print(f"WARNING: Failed to create bank '{bank_name}': {bank_create_error}")
        return None
    
    print(f"DEBUG: Bank '{bank_name}' created successfully")
    return bank_name

@treasury_bp.route('/api/treasury-accounts', methods=['POST'])
def create_treasury_account():
    """Crear una nueva cuenta de tesorería en ERPNext usando cuenta contable existente"""
    # debug: create_treasury_account called (log removed)

    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        data = request.get_json()
        print(f"DEBUG: Request data received: {data}")
        print(f"DEBUG: Request headers: {dict(request.headers)}")

        if not data:
            print("DEBUG: No JSON data received")
            return jsonify({"success": False, "message": "Datos no proporcionados"}), 400

        # Validar campos requeridos según el tipo
        account_type = data.get('type')
        if not account_type:
            return jsonify({"success": False, "message": "Tipo de cuenta requerido"}), 400

        # Validar tipo de cuenta
        valid_types = ['bank', 'cash', 'cheque', 'tarjeta_debito', 'tarjeta_credito']
        if account_type not in valid_types:
            return jsonify({"success": False, "message": f"Tipo de cuenta inválido. Debe ser uno de: {', '.join(valid_types)}"}), 400

        # Para cuentas de cash: solo necesitamos la cuenta contable
        if account_type == 'cash':
            required_fields = ['accounting_account']
        else:
            # Para cuentas bancarias: necesitamos cuenta contable y banco
            required_fields = ['accounting_account', 'bank_name']

        for field in required_fields:
            if field not in data:
                return jsonify({"success": False, "message": f"Campo requerido faltante: {field}"}), 400

        # Obtener empresa activa
        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Obtener abreviatura de la empresa
        company_abbr = get_company_abbr(session, headers, active_company)

        # VERIFICAR que la cuenta contable existe y pertenece a la empresa activa
        accounting_account_name = data['accounting_account']
        print(f"DEBUG: Verifying accounting account exists: {accounting_account_name}")

        account_check_response, account_check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Account/{urllib.parse.quote(accounting_account_name)}",
            operation_name="Check Accounting Account"
        )

        if account_check_error:
            return handle_erpnext_error(account_check_error, "Failed to check accounting account")

        account_data = account_check_response.json().get('data', {})
        if account_data.get('company') != active_company:
            return jsonify({"success": False, "message": "La cuenta contable no pertenece a la empresa activa"}), 400

        # Determinar el medio de pago basado en el tipo
        # Para cuentas bancarias, incluir el nombre del banco en el nombre del Mode of Payment
        base_mode_mapping = {
            'bank': 'Transferencia',
            'cheque': 'Cheque',
            'tarjeta_debito': 'Tarjeta de Débito',
            'tarjeta_credito': 'Tarjeta de Crédito',
            'cash': 'Efectivo'
        }

        base_mode_name = base_mode_mapping.get(account_type)
        if not base_mode_name:
            return jsonify({"success": False, "message": "Tipo de cuenta no válido"}), 400

        # Para cuentas bancarias, obtener el nombre del banco y crear nombre compuesto
        if account_type != 'cash':
            # Obtener información del banco desde los datos enviados
            bank_name = data.get('bank_name', '')
            if not bank_name:
                # Si no hay bank_name, intentar extraerlo del nombre de la cuenta
                account_parts = account_data.get('account_name', '').split(' - ')
                if len(account_parts) >= 2:
                    # El nombre del banco usualmente está al final o en el medio
                    # Buscar un patrón que parezca nombre de banco
                    potential_bank_names = []
                    for part in account_parts:
                        part = part.strip()
                        # Si la parte parece un nombre de banco (tiene palabras clave o es suficientemente largo)
                        if (len(part) > 3 and
                            not part.isdigit() and
                            not part.startswith(('DIE', 'C/C', 'Cta', 'Cuenta')) and
                            any(keyword in part.upper() for keyword in ['BANCO', 'BANK', 'BANC', 'CAJA', 'WALLET', 'DIGITAL'])):
                            potential_bank_names.append(part)

                    if potential_bank_names:
                        bank_name = potential_bank_names[-1]  # Tomar el último que parezca nombre de banco
                    else:
                        # Fallback: tomar la segunda parte si existe
                        bank_name = account_parts[1] if len(account_parts) > 1 else ''

            if bank_name:
                mode_of_payment_name = f"{bank_name} - {base_mode_name} - {company_abbr}"
            else:
                mode_of_payment_name = f"{base_mode_name} - {company_abbr}"
        else:
            # Para cuentas de efectivo, usar el nombre simple
            mode_of_payment_name = f"{base_mode_name} - {company_abbr}"

        print(f"DEBUG: Mode of payment name: {mode_of_payment_name}")

        # Verificar que el medio de pago existe, si no, crearlo
        mop_check_response, mop_check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Mode of Payment/{urllib.parse.quote(mode_of_payment_name)}",
            operation_name="Check Mode of Payment"
        )

        if mop_check_error:
            print(f"DEBUG: Mode of Payment '{mode_of_payment_name}' does not exist, creating it...")
            # Crear el Mode of Payment
            mop_type = 'Bank' if account_type != 'cash' else 'Cash'
            mop_create_data = {
                "mode_of_payment": mode_of_payment_name,
                "type": mop_type,
                "accounts": []
            }

            mop_create_response, mop_create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Mode of Payment",
                data=mop_create_data,
                operation_name="Create Mode of Payment"
            )

            if mop_create_error:
                print(f"DEBUG: Failed to create Mode of Payment: {mop_create_error}")
                return handle_erpnext_error(mop_create_error, "Failed to create mode of payment")

            print(f"DEBUG: Mode of Payment '{mode_of_payment_name}' created successfully")
        else:
            print(f"DEBUG: Mode of Payment '{mode_of_payment_name}' already exists")

        # Asignar la cuenta al medio de pago (crear Mode of Payment Account)
        mop_account_data = {
            "parent": mode_of_payment_name,
            "parentfield": "accounts",
            "parenttype": "Mode of Payment",
            "default_account": accounting_account_name,
            "company": active_company
        }

        mop_account_response, mop_account_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Mode of Payment Account",
            data=mop_account_data,
            operation_name="Create Mode of Payment Account"
        )

        if mop_account_error:
            print(f"DEBUG: Failed to create Mode of Payment Account: {mop_account_error}")
            # No es error crítico si ya existe, continuar

        # Para cuentas bancarias (no cash), crear registro Bank Account
        bank_account_created = False
        bank_name = ""
        if account_type != 'cash':
            bank_name = data['bank_name']

            # Asegurar que el banco existe (crear si no existe)
            bank_name = _ensure_bank_exists(session, bank_name)
            if not bank_name:
                return jsonify({"success": False, "message": "No se pudo crear o verificar el banco"}), 400

            # Crear registro Bank Account
            account_number = data.get('account_number', '').strip()
            if account_number:
                bank_account_name = f"{bank_name} - {account_number}"
            else:
                bank_account_name = bank_name
            
            bank_account_data = {
                "name": bank_account_name,
                "account": accounting_account_name,
                "bank": bank_name,
                "account_name": account_data.get('account_name'),
                "bank_account_no": data.get('account_number', ''),
                "company": active_company,
                "mode_of_payment": mode_of_payment_name,
                "is_company_account": 1
            }

            # Verificar si ya existe
            existing_ba_response, existing_ba_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Bank Account/{urllib.parse.quote(bank_account_name)}",
                operation_name="Check Existing Bank Account"
            )

            if not existing_ba_error and existing_ba_response.status_code == 200:
                # Actualizar existente
                update_response, update_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Bank Account/{urllib.parse.quote(bank_account_name)}",
                    data=bank_account_data,
                    operation_name="Update Bank Account"
                )
                bank_account_created = not update_error and update_response.status_code in [200, 201]
            else:
                # Crear nuevo
                create_response, create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Bank Account",
                    data=bank_account_data,
                    operation_name="Create Bank Account"
                )
                bank_account_created = not create_error and create_response.status_code in [200, 201]

        # Preparar respuesta
        if account_type == 'cash':
            account_name = account_data.get('account_name', '')
        else:
            account_name = bank_name

        response_data = {
            "name": accounting_account_name,
            "account_name": account_name,
            "type": account_type,
            "mode_of_payment": mode_of_payment_name,
            "accounting_account": accounting_account_name,
            "company": active_company,
            "bank_name": bank_name,
            "account_number": data.get('account_number', ''),
            "bank_account_created": bank_account_created
        }

        return jsonify({
            "success": True,
            "message": "Cuenta de tesorería creada exitosamente",
            "data": response_data
        }), 201

    except Exception as e:
        print(f"DEBUG: Exception in create_treasury_account: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

@treasury_bp.route('/api/treasury-accounts/<int:account_id>', methods=['PUT'])
def update_treasury_account(account_id):
    """Actualizar una cuenta de tesorería existente (actualiza registro Bank Account si existe)"""
    # debug: update_treasury_account called (log removed)

    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Datos no proporcionados"}), 400

        print(f"DEBUG: update_treasury_account - received data: {json.dumps(data, indent=2, ensure_ascii=False)}")
        print(f"DEBUG: update_treasury_account - 'bank_name' in data: {'bank_name' in data}")
        if 'bank_name' in data:
            print(f"DEBUG: update_treasury_account - bank_name value: '{data['bank_name']}'")

        # Obtener empresa activa
        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Obtener abreviatura de la empresa
        company_abbr = get_company_abbr(session, headers, active_company)

        # Get treasury accounts to find the actual ERPNext account name
        # Consultar Mode of Payment con cuentas asociadas expandidas
        mop_url = "/api/resource/Mode of Payment"
        mop_params = {
            "fields": '["name","type","accounts.default_account","accounts.company","accounts.parent"]',
            "limit_page_length": 500
        }

        mop_response, mop_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=mop_url,
            params=mop_params,
            operation_name="Get Mode of Payments for Update"
        )

        if mop_error:
            print(f"DEBUG: Failed to get Mode of Payment: {mop_error}")
            return handle_erpnext_error(mop_error, "Failed to get mode of payments for update")

        mop_data = mop_response.json()
        mode_of_payments = mop_data.get("data", [])

        # Find the treasury account with the given id
        treasury_account = None
        account_counter = 0

        for mop in mode_of_payments:
            mode_of_payment_name = mop.get('name')
            mop_type = mop.get('type', 'Bank')
            default_account = mop.get('default_account')
            account_company = mop.get('company')

            # Solo procesar si tiene cuenta asociada y pertenece a la empresa activa
            if not default_account or account_company != active_company:
                continue

            account_counter += 1
            if account_counter == account_id:
                # Found the matching treasury account
                treasury_account = {
                    "id": account_counter,
                    "name": default_account,
                    "accounting_account": default_account,
                    "company": active_company
                }
                break

        if not treasury_account:
            return jsonify({"success": False, "message": f"Cuenta de tesorería con id {account_id} no encontrada"}), 404

        # Now use the actual ERPNext account name
        erp_account_name = add_company_abbr(data.get('name', treasury_account["name"]), company_abbr)
        print(f"DEBUG: Found ERPNext account name: {erp_account_name}")

        # Verificar que la cuenta contable existe
        account_check_response, account_check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Account/{urllib.parse.quote(erp_account_name)}",
            operation_name="Check Accounting Account for Update"
        )

        if account_check_error:
            print(f"DEBUG: Accounting account not found: {account_check_error}")
            return handle_erpnext_error(account_check_error, "Failed to check accounting account")

        account_data = account_check_response.json().get('data', {})
        if account_data.get('company') != active_company:
            print(f"DEBUG: Accounting account belongs to different company")
            return jsonify({"success": False, "message": "La cuenta contable pertenece a una empresa diferente"}), 400

        # Buscar si existe un registro Bank Account asociado
        bank_account_params = {
            "fields": json.dumps(["name", "account", "bank", "bank_account_no", "account_name"]),
            "filters": f'[["account","=","{erp_account_name}"]]',
            "limit_page_length": 1
        }
        bank_account_response, bank_account_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Account",
            params=bank_account_params,
            operation_name="Get Bank Account for Update"
        )

        if bank_account_error:
            print(f"DEBUG: Failed to get Bank Account for update: {bank_account_error}")
            return handle_erpnext_error(bank_account_error, "Failed to get bank account for update")

        bank_account_updated = False
        if not bank_account_error and bank_account_response.status_code == 200:
            bank_accounts = bank_account_response.json().get('data', [])
            if bank_accounts:
                # Existe registro Bank Account - actualizarlo
                bank_account = bank_accounts[0]
                bank_account_name = bank_account['name']

                # Preparar datos para actualizar
                update_data = {}

                # Solo actualizar campos que vienen en la request
                if 'account_name' in data:
                    update_data['account_name'] = data['account_name']
                if 'bank_name' in data:
                    # Asegurar que el banco existe (crear si no existe)
                    bank_name_resolved = _ensure_bank_exists(session, data['bank_name'])
                    if not bank_name_resolved:
                        return jsonify({"success": False, "message": "No se pudo crear o verificar el banco"}), 400
                    update_data['bank'] = bank_name_resolved
                if 'account_number' in data:
                    update_data['bank_account_no'] = data['account_number']

                if update_data:
                    update_data['company'] = active_company
                    update_data['is_company_account'] = 1
                    update_response, update_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/Bank Account/{bank_account_name}",
                        data=update_data,
                        operation_name="Update Bank Account"
                    )

                    if update_error:
                        print(f"DEBUG: Failed to update Bank Account: {update_error}")
                        return handle_erpnext_error(update_error, "Failed to update bank account")
                else:
                    print("DEBUG: No fields to update")
                    bank_account_updated = True  # Considerar como actualizado si no hay cambios
            else:
                # No existe registro Bank Account - crearlo si se especifica bank_name
                if data.get('bank_name'):
                    # Preparar datos para crear registro Bank Account
                    # Determinar mode of payment basado en el tipo
                    update_type = data.get('type', 'bank')
                    mode_of_payment_mapping = {
                        'bank': 'Transferencia',
                        'cheque': 'Cheque',
                        'tarjeta_debito': 'Tarjeta de Débito',
                        'tarjeta_credito': 'Tarjeta de Crédito'
                    }
                    update_mode_of_payment = mode_of_payment_mapping.get(update_type, 'Transferencia')

                    bank_account_data = {
                        "account": erp_account_name,
                        "bank": data.get('bank_name', ''),
                        "bank_account_no": data.get('account_number', ''),
                        "account_name": data.get('account_name', account_data.get('account_name', '')),
                        "mode_of_payment": update_mode_of_payment,
                        "company": active_company,
                        "is_company_account": 1
                    }

                    # Asegurar que el banco existe si se especifica (crear si no existe)
                    if data.get('bank_name'):
                        bank_name_resolved = _ensure_bank_exists(session, data['bank_name'])
                        if not bank_name_resolved:
                            return jsonify({"success": False, "message": "No se pudo crear o verificar el banco"}), 400
                        bank_account_data['bank'] = bank_name_resolved

                    create_response, create_error = make_erpnext_request(
                        session=session,
                        method="POST",
                        endpoint="/api/resource/Bank Account",
                        data=bank_account_data,
                        operation_name="Create Bank Account"
                    )

                    if not create_error and create_response.status_code == 200:
                        bank_account_updated = True
                    else:
                        print(f"DEBUG: Failed to create Bank Account record: {create_error}")
                        return handle_erpnext_error(create_error, "Failed to create bank account")
                else:
                    print(f"DEBUG: Account {account_id} is not a Bank account (type: {account_data.get('account_type')}), skipping Bank Account creation")
                    bank_account_updated = True  # No es error, simplemente no se necesita Bank Account

        # Preparar respuesta
        response_data = {
            "name": erp_account_name,
            "account_name": data.get('account_name', account_data.get('account_name', '')),
            "type": data.get('type', 'bank'),
            "bank_name": data.get('bank_name', ''),
            "account_number": data.get('account_number', ''),
            "accounting_account": erp_account_name,
            "company": active_company,
            "bank_account_updated": bank_account_updated
        }

        return jsonify({
            "success": True,
            "data": response_data,
            "message": f"Cuenta de tesorería actualizada exitosamente. {'Registro Bank Account actualizado/creado.' if bank_account_updated else 'No se realizó ningún cambio.'}"
        }), 200

    except Exception as e:
        print(f"DEBUG: Exception in update_treasury_account: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@treasury_bp.route('/api/treasury-accounts/<int:account_id>', methods=['GET'])
def get_treasury_account(account_id):
    """Obtener detalles de una cuenta de tesorería específica"""
    try:
        print(f"get_treasury_account called for id: {account_id}")

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        # Obtener empresa activa
        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Obtener abreviatura de la empresa
        company_abbr = get_company_abbr(session, headers, active_company)

        # Consultar Mode of Payment con cuentas asociadas expandidas
        mop_url = "/api/resource/Mode of Payment"
        mop_params = {
            "fields": '["name","type","accounts.default_account","accounts.company","accounts.parent"]',
            "limit_page_length": 500
        }

        mop_response, mop_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=mop_url,
            params=mop_params,
            operation_name="Get Mode of Payments for Detail"
        )

        if mop_error:
            return handle_erpnext_error(mop_error, "Failed to get mode of payments")

        mop_data = mop_response.json()
        mode_of_payments = mop_data.get("data", [])

        # Get all bank accounts for mapping
        bank_url = "/api/resource/Bank Account"
        bank_fields = ["name", "account", "bank", "bank_account_no", "account_name"]
        bank_params = {
            "fields": json.dumps(bank_fields),
            "limit_page_length": 500
        }
        bank_response, bank_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=bank_url,
            params=bank_params,
            operation_name="Get Bank Accounts for Detail"
        )

        bank_mapping = {}
        if not bank_error and bank_response.status_code == 200:
            bank_data = bank_response.json().get("data", [])
            for bank_acc in bank_data:
                number_value = (
                    bank_acc.get('bank_account_no')
                    or bank_acc.get('account_number')
                    or bank_acc.get('account_no')
                    or bank_acc.get('iban')
                    or ''
                )
                bank_mapping[bank_acc.get('account')] = {
                    'name': bank_acc.get('name'),
                    'bank': bank_acc.get('bank'),
                    'account_number': number_value,
                    'account_name': bank_acc.get('account_name')
                }

        # Find the treasury account with the given id
        treasury_account = None
        account_counter = 0

        for mop in mode_of_payments:
            mode_of_payment_name = mop.get('name')
            mop_type = mop.get('type', 'Bank')
            default_account = mop.get('default_account')
            account_company = mop.get('company')

            # Solo procesar si tiene cuenta asociada y pertenece a la empresa activa
            if not default_account or account_company != active_company:
                continue

            account_counter += 1
            if account_counter == account_id:
                # Found the matching treasury account
                account_name = default_account

                # Obtener detalles de la cuenta contable
                account_response, account_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Account/{urllib.parse.quote(account_name)}",
                    operation_name="Get Account Details for Detail"
                )

                if account_error:
                    return handle_erpnext_error(account_error, "Failed to get account details")

                account_data = account_response.json().get('data', {})

                # Determinar el tipo basado en el medio de pago
                account_type = 'cash' if mop_type == 'Cash' else 'bank' if mop_type == 'Bank' else mop_type.lower()

                # Mapear tipos de ERPNext a nuestros tipos
                type_mapping = {
                    'bank': 'bank',
                    'cash': 'cash',
                    'cheque': 'cheque',
                    'debit card': 'tarjeta_debito',
                    'credit card': 'tarjeta_credito'
                }
                mapped_type = type_mapping.get(account_type, 'bank')

                # Buscar si existe registro Bank Account
                bank_account_info = bank_mapping.get(account_name, {})
                bank_name_value = (bank_account_info.get('bank') or '').strip()
                is_mercadopago_bank = bool(bank_name_value and 'mercado' in bank_name_value.lower() and 'pago' in bank_name_value.lower())

                mercadopago_state = get_account_state(active_company, account_name) if is_mercadopago_bank else {}

                treasury_account = {
                    "id": account_counter,
                    "name": bank_account_info.get('account_name', remove_company_abbr(account_name, company_abbr)),  # Usar bank account name si existe
                    "account_name": account_data.get('account_name', ''),
                    "type": mapped_type,
                    "mode_of_payment": mode_of_payment_name,
                    "mode_of_payment_type": mop_type,
                    "accounting_account": account_name,
                    "company": active_company,
                    "bank_name": bank_account_info.get('bank', ''),
                    "account_number": bank_account_info.get('account_number', ''),
                    "bank_account_name": bank_account_info.get('account_name', ''),
                    "bank_account_id": bank_account_info.get('name', ''),
                    "bank_account_created": bool(bank_account_info),
                    "is_mercadopago_bank": is_mercadopago_bank,
                    "mercadopago_auto_sync": bool(mercadopago_state.get('auto_sync_enabled')) if is_mercadopago_bank else False,
                    "mercadopago_last_sync_at": mercadopago_state.get('last_sync_at') if is_mercadopago_bank else None,
                    "mercadopago_last_sync_summary": mercadopago_state.get('last_sync_summary') if is_mercadopago_bank else None,
                    "mercadopago_last_report_id": mercadopago_state.get('last_report_id') if is_mercadopago_bank else None,
                    "currency": account_data.get('account_currency')  # Sin fallback - debe venir de ERPNext
                }
                break

        if not treasury_account:
            return jsonify({"success": False, "message": f"Cuenta de tesorería con id {account_id} no encontrada"}), 404

        return jsonify({
            "success": True,
            "data": treasury_account
        })

    except Exception as e:
        print(f"Exception in get_treasury_account: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@treasury_bp.route('/api/treasury-accounts/<path:account_name>/mercadopago-sync', methods=['PUT'])
def update_mercadopago_sync(account_name):
    """Permite activar o desactivar la sincronización automática de Mercado Pago para una cuenta."""
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        payload = request.get_json(silent=True) or {}
        desired_state = bool(payload.get("autoSync"))

        bank_filters = [
            ["account", "=", account_name]
        ]
        bank_params = {
            "fields": json.dumps(["name", "bank", "account", "company"]),
            "filters": json.dumps(bank_filters),
            "limit_page_length": 10
        }
        bank_response, bank_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Account",
            params=bank_params,
            operation_name="Validate bank account for Mercado Pago sync"
        )

        if bank_error:
            return handle_erpnext_error(bank_error, "No se pudo validar la cuenta bancaria")

        records = bank_response.json().get("data", [])
        target_record = next((item for item in records if item.get("account") == account_name and (item.get("company") == active_company or not item.get("company"))), None)

        if not target_record:
            return jsonify({"success": False, "message": "Cuenta bancaria no encontrada en ERPNext"}), 404

        bank_name = (target_record.get("bank") or "").strip().lower()
        if "mercado" not in bank_name or "pago" not in bank_name:
            return jsonify({"success": False, "message": "Solo las cuentas del banco Mercado Pago permiten esta opción."}), 400

        state = set_auto_sync(active_company, account_name, desired_state)

        return jsonify({
            "success": True,
            "message": "Preferencias de sincronización actualizadas.",
            "data": state
        })

    except Exception as e:
        print(f"DEBUG: Exception in update_mercadopago_sync: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@treasury_bp.route('/api/bank-movements/<account_id>', methods=['GET'])

def get_bank_movements(account_id):

    """Compatibilidad con firmas anteriores: delega al handler general."""

    return bank_movements(account_id)



@treasury_bp.route('/api/accounting-movements/<treasury_account_id>', methods=['GET'])

def get_accounting_movements(treasury_account_id):

    """Compatibilidad con firmas anteriores: delega al handler general."""

    return accounting_movements(treasury_account_id)



@treasury_bp.route('/api/available-accounts', methods=['GET'])
def get_available_accounts():
    """Obtener cuentas contables disponibles para configurar como cuentas bancarias"""
    try:
        # debug: get_available_accounts called (log removed)

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        # Obtener empresa activa
        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Obtener todas las cuentas contables que podrían ser de banco/caja
        # Más flexible: buscar por nombre que contenga "BANCO", "CAJA", etc.
        params = {
            "fields": '["name","account_name","account_type","is_group","company"]',
            "filters": f'[["company","=","{active_company}"],["is_group","=",0]]',
            "order_by": "account_name asc",
            "limit_page_length": 500
        }

        print(f"DEBUG: Querying available accounts URL: /api/resource/Account")
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Account",
            params=params,
            operation_name="Get Available Accounts"
        )

        if error:
            print(f"DEBUG: Failed to get accounts: {error}")
            return handle_erpnext_error(error, "Failed to get available accounts")

        erp_data = response.json()
        all_accounts = erp_data.get("data", [])
        print(f"DEBUG: Found {len(all_accounts)} total accounts")

        # Mostrar tipos de cuenta para debug
        account_types = {}
        for account in all_accounts:
            acc_type = account.get("account_type", "NO_TYPE")
            if acc_type not in account_types:
                account_types[acc_type] = []
            account_types[acc_type].append(account.get("account_name", ""))

        print(f"DEBUG: Account types distribution: { {k: len(v) for k, v in account_types.items()} }")
        for acc_type, names in account_types.items():
            print(f"DEBUG: {acc_type}: {names[:5]}...")  # Mostrar primeros 5 nombres

        # Filtrar cuentas que parecen ser de banco o caja
        # Incluir cuentas con nombres que contengan "BANCO", "CAJA", etc. o tipo "Bank"/"Cash"
        bank_cash_keywords = ["BANCO", "CAJA", "BANK", "CASH", "BANCARIO", "TESORERIA"]
        potential_bank_accounts = []

        for account in all_accounts:
            account_name = account.get("account_name", "").upper()
            account_type = account.get("account_type", "")

            # Incluir si:
            # 1. Es tipo Bank o Cash
            # 2. El nombre contiene palabras clave de banco/caja
            is_bank_type = account_type in ["Bank", "Cash"]
            has_bank_keywords = any(keyword in account_name for keyword in bank_cash_keywords)

            if is_bank_type or has_bank_keywords:
                potential_bank_accounts.append(account)
                print(f"DEBUG: Including account: {account.get('account_name')} (type: {account_type})")

        print(f"DEBUG: Found {len(potential_bank_accounts)} potential bank/cash accounts")

        # Obtener registros Bank Account existentes para excluirlos
        bank_params = {
            "fields": '["account"]',
            "limit_page_length": 500
        }

        bank_response, bank_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Account",
            params=bank_params,
            operation_name="Get Bank Accounts"
        )
        configured_accounts = set()

        if not bank_error and bank_response.status_code == 200:
            bank_data = bank_response.json()
            bank_accounts = bank_data.get("data", [])
            configured_accounts = {ba.get("account") for ba in bank_accounts if ba.get("account")}
            print(f"DEBUG: Found {len(configured_accounts)} already configured accounts: {list(configured_accounts)}")

        # Filtrar cuentas que no están configuradas aún
        available_accounts = []
        for account in potential_bank_accounts:
            if account['name'] not in configured_accounts:
                available_accounts.append({
                    "value": account['name'],
                    "label": f"{account['account_name']} ({account.get('account_type', 'Sin tipo')})"
                })
                print(f"DEBUG: Available account: {account['account_name']}")
                available_accounts.append({
                    "value": account['name'],
                    "label": account['account_name']
                })

        return jsonify({
            "success": True,
            "data": available_accounts
        }), 200

    except Exception as e:
        print(f"DEBUG: Exception in get_available_accounts: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

@treasury_bp.route('/api/treasury-accounts/<path:account_id>', methods=['DELETE'])
def delete_treasury_account(account_id):
    """Eliminar una cuenta de tesorería (solo el registro Bank Account, no la cuenta contable)"""
    # debug: delete_treasury_account called (log removed)

    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        # Obtener empresa activa
        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Primero verificar que la cuenta contable existe y pertenece a la empresa
        account_check_response, account_check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Account/{account_id}",
            operation_name="Check Accounting Account for Delete"
        )

        if account_check_error:
            print(f"DEBUG: Accounting account not found: {account_check_error}")
            return handle_erpnext_error(account_check_error, "Failed to check accounting account")

        account_data = account_check_response.json().get('data', {})
        if account_data.get('company') != active_company:
            print(f"DEBUG: Accounting account belongs to different company")
            return jsonify({"success": False, "message": "La cuenta contable pertenece a una empresa diferente"}), 400

        # Buscar si existe un registro Bank Account asociado
        bank_account_response, bank_account_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Account",
            params={
                "fields": '["name","account"]',
                "filters": f'[["account","=","{account_id}"]]',
                "limit_page_length": 1
            },
            operation_name="Get Bank Account for Delete"
        )

        bank_account_deleted = False
        if not bank_account_error and bank_account_response.status_code == 200:
            bank_accounts = bank_account_response.json().get('data', [])
            if bank_accounts:
                bank_account_name = bank_accounts[0]['name']
                print(f"DEBUG: Found associated Bank Account: {bank_account_name}")

                # Eliminar el registro Bank Account
                delete_response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Bank Account/{bank_account_name}",
                    operation_name="Delete Bank Account"
                )

                if not delete_error and delete_response.status_code in [200, 202, 204]:
                    print("DEBUG: Bank Account record deleted successfully")
                    bank_account_deleted = True
                else:
                    print(f"WARNING: Failed to delete Bank Account record: {delete_error}")
                    # No fallar la operación completa por esto

        # Encontrar el Mode of Payment correspondiente a esta cuenta y eliminarlo completamente
        mop_account_deleted = False
        mop_to_delete = None
        try:
            # Obtener todos los Mode of Payment con sus accounts expandidas
            mop_response, mop_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Mode of Payment",
                params={
                    "fields": '["name","type","accounts.default_account","accounts.company","accounts.parent"]',
                    "limit_page_length": 500
                },
                operation_name="Get Mode of Payments for Delete"
            )

            if not mop_error and mop_response.status_code == 200:
                mode_of_payments = mop_response.json().get('data', [])
                print(f"DEBUG: Found {len(mode_of_payments)} Mode of Payment records to check for deletion")
                print(f"DEBUG: Mode of Payment data sample: {mode_of_payments[:2] if mode_of_payments else 'None'}")

                for mop in mode_of_payments:
                    mop_name = mop.get('parent')  # El nombre del Mode of Payment está en 'parent'
                    account_default = mop.get('default_account')
                    account_company = mop.get('company')

                    print(f"DEBUG: Checking Mode of Payment Account: parent='{mop_name}', account='{account_default}', company='{account_company}'")

                    # Si este Mode of Payment Account tiene la cuenta que queremos eliminar
                    if account_default == account_id and account_company == active_company and mop_name:
                        mop_to_delete = mop_name
                        print(f"DEBUG: Found Mode of Payment '{mop_name}' to delete (contains account {account_id})")
                        break

                # Si encontramos el Mode of Payment, primero desvincular todas las cuentas y luego borrarlo
                if mop_to_delete:
                    print(f"DEBUG: Deleting Mode of Payment '{mop_to_delete}' completely")

                    # Paso 1: Desvincular todas las cuentas (poner accounts: [])
                    update_response, update_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/Mode of Payment/{mop_to_delete}",
                        data={"accounts": []},
                        operation_name="Clear Mode of Payment Accounts"
                    )

                    if not update_error and update_response.status_code == 200:
                        print(f"DEBUG: Successfully cleared accounts from Mode of Payment '{mop_to_delete}'")
                        mop_account_deleted = True

                        # Paso 2: Borrar el Mode of Payment completo
                        delete_response, delete_error = make_erpnext_request(
                            session=session,
                            method="DELETE",
                            endpoint=f"/api/resource/Mode of Payment/{mop_to_delete}",
                            operation_name="Delete Mode of Payment"
                        )

                        if not delete_error and delete_response.status_code in [200, 202, 204]:
                            print(f"DEBUG: Successfully deleted Mode of Payment '{mop_to_delete}'")
                        else:
                            print(f"WARNING: Failed to delete Mode of Payment '{mop_to_delete}': {delete_error}")
                    else:
                        print(f"WARNING: Failed to clear accounts from Mode of Payment '{mop_to_delete}': {update_error}")
                else:
                    print(f"DEBUG: No Mode of Payment found containing account {account_id}")
            else:
                print(f"DEBUG: Failed to query Mode of Payment: {mop_response.text}")

        except Exception as e:
            print(f"DEBUG: Error deleting Mode of Payment: {e}")
            import traceback
            traceback.print_exc()

        # IMPORTANTE: NO eliminar la cuenta contable, solo las asociaciones
        # La cuenta contable debe permanecer intacta

        return jsonify({
            "success": True,
            "message": f"Cuenta de tesorería eliminada exitosamente. {'Registro Bank Account eliminado.' if bank_account_deleted else ''} {'Asociaciones Mode of Payment eliminadas.' if mop_account_deleted else ''}",
            "bank_account_deleted": bank_account_deleted,
            "mop_account_deleted": mop_account_deleted
        }), 200

    except Exception as e:
        print(f"DEBUG: Exception in delete_treasury_account: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

@treasury_bp.route('/api/bank-movements/<path:account_name>', methods=['GET'])
def bank_movements(account_name):
    """Obtener movimientos bancarios para una cuenta de tesorería"""
    try:
        # debug: bank_movements called (log removed)

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        resolved_bank_account = _resolve_bank_account_name(session, account_name)
        target_bank_account = resolved_bank_account or account_name
        print(f"DEBUG: bank_movements target bank_account={target_bank_account} (resolved from {account_name})")

        bt_filters = [["bank_account", "=", target_bank_account]]
        if active_company:
            bt_filters.append(["company", "=", active_company])

        include_details = _parse_bool(request.args.get("include_details"))
        from_date = request.args.get("from_date")
        to_date = request.args.get("to_date")
        try:
            page = max(int(request.args.get("page", 1)), 1)
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.args.get("page_size", 100))
        except (TypeError, ValueError):
            page_size = 100
        page_size = max(1, min(page_size, 500))
        limit_start = (page - 1) * page_size

        if from_date:
            bt_filters.append(["date", ">=", from_date])
        if to_date:
            bt_filters.append(["date", "<=", to_date])
        if from_date and to_date:
            try:
                from_dt = datetime.strptime(from_date, "%Y-%m-%d")
                to_dt = datetime.strptime(to_date, "%Y-%m-%d")
                if (to_dt - from_dt).days > 183:
                    return jsonify({"success": False, "message": "Selecciona un rango de fechas de hasta 6 meses."}), 400
            except ValueError:
                return jsonify({"success": False, "message": "Formato de fecha inválido. Usa AAAA-MM-DD."}), 400

        # Support server-side search across all pages: if `search` param provided,
        # fetch all Bank Transactions within the date range and apply filtering
        search = (request.args.get('search') or '').strip()
        if search:
            fetch_size = 500
            limit_start_fetch = 0
            all_movements = []
            while True:
                bt_params = {
                    "fields": json.dumps([
                        "name",
                        "date",
                        "description",
                        "reference_number",
                        "transaction_id",
                        "deposit",
                        "withdrawal",
                        "status",
                        "currency",
                        "bank_account",
                        "company",
                        "party",
                        "party_type",
                        "unallocated_amount",
                        "allocated_amount"
                    ]),
                    "filters": json.dumps(bt_filters),
                    "order_by": "date desc",
                    "limit_page_length": fetch_size,
                    "limit_start": limit_start_fetch
                }
                bt_response, bt_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Bank Transaction",
                    params=bt_params,
                    operation_name="Get Bank Movements (search mode)"
                )
                if bt_error:
                    print(f"DEBUG: Failed to get Bank Transactions (search): {bt_error}")
                    return handle_erpnext_error(bt_error, "Failed to get bank movements")
                batch = bt_response.json().get("data", [])
                all_movements.extend(batch)
                if len(batch) < fetch_size:
                    break
                limit_start_fetch += fetch_size
            movements = all_movements
        else:
            bt_params = {
                "fields": json.dumps([
                    "name",
                    "date",
                    "description",
                    "reference_number",
                    "transaction_id",
                    "deposit",
                    "withdrawal",
                    "status",
                    "currency",
                    "bank_account",
                    "company",
                    "party",
                    "party_type",
                    "unallocated_amount",
                    "allocated_amount"
                ]),
                "filters": json.dumps(bt_filters),
                "order_by": "date desc",
                "limit_page_length": page_size,
                "limit_start": limit_start
            }

            bt_response, bt_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Bank Transaction",
                params=bt_params,
                operation_name="Get Bank Movements"
            )

            if bt_error:
                print(f"DEBUG: Failed to get Bank Transactions: {bt_error}")
                return handle_erpnext_error(bt_error, "Failed to get bank movements")

            movements = bt_response.json().get("data", [])

        # If any movement description contains the Unicode replacement character
        # it likely means ERPNext returned bytes in a different encoding (eg. latin-1)
        # that were decoded as UTF-8. Attempt to re-decode the entire payload as
        # latin-1 and parse JSON again to recover original characters.
        try:
            if any((mv.get('description') or '').find('\ufffd') >= 0 for mv in movements):
                try:
                    text_latin1 = bt_response.content.decode('latin-1')
                    parsed = json.loads(text_latin1)
                    alt_movements = parsed.get('data', [])
                    if alt_movements and not any((mv.get('description') or '').find('\ufffd') >= 0 for mv in alt_movements):
                        movements = alt_movements
                except Exception:
                    pass
        except Exception:
            pass
        transaction_names = [mv.get("name") for mv in movements if mv.get("name")]
        links_by_transaction = _fetch_bank_transaction_payments(session, transaction_names)
        total_links = sum(len(rows) for rows in links_by_transaction.values())
        print(f"DEBUG: Retrieved {len(movements)} bank transactions and {total_links} linked voucher rows via Bank Transaction Payments.")

        formatted_movements = []
        voucher_to_bank = {}

        for movement in movements:
            deposit = movement.get("deposit") or 0
            withdrawal = movement.get("withdrawal") or 0
            amount = deposit - withdrawal
            formatted_record = {
                "id": movement.get("name"),
                "bank_account": movement.get("bank_account"),
                "company": movement.get("company"),
                "date": movement.get("date"),
                "description": _fix_text_encoding(movement.get("description") or ""),
                "reference": movement.get("reference_number") or movement.get("transaction_id"),
                "amount": amount,
                "type": "credit" if amount >= 0 else "debit",
                "status": movement.get("status"),
                "currency": movement.get("currency"),
                "deposit": deposit,
                "withdrawal": withdrawal,
                "party": movement.get("party"),
                "party_type": movement.get("party_type"),
                "unallocated_amount": movement.get("unallocated_amount", 0),
                "allocated_amount": movement.get("allocated_amount", 0),
                "linked_payments": [],
                "references": []
            }

            # NOTE: removed debug logging for raw description (cleaned up per request)

            # All required data is already in the initial query (party, party_type, unallocated_amount, allocated_amount)
            # No need for individual _fetch_bank_transaction_details() calls
            formatted_record["match_number"] = movement.get("name")
            
            # Use links from Bank Transaction Payments child table (already fetched in batch)
            child_links = links_by_transaction.get(movement.get("name")) or []
            combined_links = child_links
            if combined_links:
                formatted_record["linked_payments"] = combined_links
                formatted_record["matched_vouchers"] = combined_links

            for link in formatted_record.get("linked_payments") or []:
                identifier = _build_linked_identifier(link)
                if identifier and formatted_record.get("id"):
                    voucher_to_bank.setdefault(identifier, set()).add(formatted_record["id"])

            formatted_movements.append(formatted_record)

        # Keep a copy of all formatted movements (unfiltered) so we can compute
        # reconciliation identifiers from the full dataset even when the
        # response is filtered for a search term.
        all_formatted_movements = list(formatted_movements)

        # If search param provided, filter formatted_movements locally so search
        # covers the entire date range (not just the current page)
        search = (request.args.get('search') or '').strip()
        if search:
            term = search.lower()
            def match_record(rec):
                parts = [
                    (rec.get('description') or ''),
                    (rec.get('reference') or ''),
                    str(rec.get('amount') or ''),
                    (rec.get('date') or '')
                ]
                hay = ' '.join(parts).lower()
                return term in hay
            formatted_movements = [r for r in formatted_movements if match_record(r)]

        # Compute reconciled identifiers from the full (unfiltered) list so the
        # accounting movements view can keep a stable reconciliation state even
        # when the bank movements view is filtered by a search term.
        reconciled_identifiers_all = set()
        for movement in all_formatted_movements:
            if _is_bank_transaction_reconciled(movement):
                for link in movement.get('linked_payments') or []:
                    identifier = _build_linked_identifier(link)
                    if identifier:
                        reconciled_identifiers_all.add(identifier)

        reconciled_bank_movements = []
        unreconciled_bank_movements = []
        reconciled_identifiers = set()
        for movement in formatted_movements:
            movement_is_reconciled = _is_bank_transaction_reconciled(movement)
            movement["is_reconciled"] = movement_is_reconciled
            if movement_is_reconciled:
                reconciled_bank_movements.append(movement.get("id"))
                for link in movement.get("linked_payments") or []:
                    identifier = _build_linked_identifier(link)
                    if identifier:
                        reconciled_identifiers.add(identifier)
            else:
                unreconciled_bank_movements.append(movement.get("id"))

        voucher_links = []
        for identifier, tx_ids in voucher_to_bank.items():
            if ":" in identifier:
                doc_type, doc_name = identifier.split(":", 1)
            else:
                doc_type, doc_name = ("Payment Entry", identifier)
            voucher_links.append({
                "payment_doctype": doc_type,
                "payment_name": doc_name,
                "bank_transactions": sorted(tx_ids)
            })

        print("DEBUG: Bank reconciliation logic => unallocated_amount == 0 OR Bank Transaction Payments rows exist (delinked=0).")
        print("DEBUG: Reconciled Bank Movements:", reconciled_bank_movements)
        print("DEBUG: Unreconciled Bank Movements:", unreconciled_bank_movements)
        print("DEBUG: Reconciled Ledger Identifiers:", sorted(reconciled_identifiers))

        # Removed extra debug dumps for finalized descriptions

        if search:
            resp_page = 1
            resp_page_size = len(formatted_movements)
            has_more = False
        else:
            resp_page = page
            resp_page_size = page_size
            has_more = len(movements) == page_size

        return jsonify({
            "success": True,
            "data": formatted_movements,
            "voucher_links": voucher_links,
            "reconciled_ledger_identifiers": sorted(list(reconciled_identifiers_all)),
            "pagination": {
                "page": resp_page,
                "page_size": resp_page_size,
                "has_more": has_more
            }
        })

    except Exception as e:
        print(f"DEBUG: Exception in bank_movements: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500
@treasury_bp.route('/api/accounting-movements/<path:account_name>', methods=['GET'])
def accounting_movements(account_name):
    """Obtener movimientos contables para una cuenta de tesorería"""
    try:
        # debug: accounting_movements called (log removed)

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')

        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        # Obtener movimientos contables (GL Entry) para la cuenta
        gl_filters = [
            ["account", "=", account_name],
            ["company", "=", active_company],
            ["docstatus", "<", 2]
        ]
        # Paginación: respetar los parámetros opcionales `page` y `page_size`
        try:
            page = max(int(request.args.get("page", 1)), 1)
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.args.get("page_size", 100))
        except (TypeError, ValueError):
            page_size = 100
        page_size = max(1, min(page_size, 500))
        limit_start = (page - 1) * page_size

        # Apply optional date range filters if provided by the client
        from_date = request.args.get('from_date')
        to_date = request.args.get('to_date')
        try:
            if from_date:
                # Ensure format expected by ERPNext (YYYY-MM-DD)
                gl_filters.append(["posting_date", ">=", from_date])
            if to_date:
                gl_filters.append(["posting_date", "<=", to_date])
        except Exception:
            # If any parsing error occurs, ignore date filter and continue
            print(f"DEBUG: Invalid date filters received: from_date={from_date}, to_date={to_date}")

        # Support server-side search across all pages: when `search` param is present
        # fetch all matching GL Entries within the date range and then filter locally.
        search = (request.args.get('search') or '').strip()
        if from_date and to_date:
            try:
                from_dt = datetime.strptime(from_date, "%Y-%m-%d")
                to_dt = datetime.strptime(to_date, "%Y-%m-%d")
                if (to_dt - from_dt).days > 183:
                    return jsonify({"success": False, "message": "Selecciona un rango de fechas de hasta 6 meses."}), 400
            except ValueError:
                return jsonify({"success": False, "message": "Formato de fecha inválido. Usa AAAA-MM-DD."}), 400

        if search:
            fetch_size = 500
            limit_start_fetch = 0
            all_movements = []
            while True:
                gl_params = {
                    "fields": json.dumps(["name", "posting_date", "account", "debit", "credit", "debit_in_account_currency", "credit_in_account_currency", "account_currency", "voucher_type", "voucher_no", "remarks"]),
                    "filters": json.dumps(gl_filters),
                    "order_by": "posting_date desc",
                    "limit_page_length": fetch_size,
                    "limit_start": limit_start_fetch
                }
                gl_response, gl_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/GL Entry",
                    params=gl_params,
                    operation_name="Get Accounting Movements (search mode)"
                )
                if gl_error:
                    print(f"DEBUG: Failed to get GL Entries (search): {gl_error}")
                    return handle_erpnext_error(gl_error, "Failed to get accounting movements")
                batch = gl_response.json().get("data", [])
                all_movements.extend(batch)
                if len(batch) < fetch_size:
                    break
                limit_start_fetch += fetch_size
            movements = all_movements
        else:
            gl_params = {
                "fields": json.dumps(["name", "posting_date", "account", "debit", "credit", "voucher_type", "voucher_no", "remarks"]),
                "filters": json.dumps(gl_filters),
                "order_by": "posting_date desc",
                "limit_page_length": page_size,
                "limit_start": limit_start
            }
        cancelled_entries = set()
        for field in ["paid_from", "paid_to"]:
            payment_filters = [
                [field, "=", account_name],
                ["company", "=", active_company],
                ["docstatus", "=", 2]
            ]
            payment_params = {
                "fields": json.dumps(["name"]),
                "filters": json.dumps(payment_filters),
                "limit_page_length": 100
            }
            payment_resp, payment_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Payment Entry",
                params=payment_params,
                operation_name=f"Get Cancelled Payment Entries for {field}"
            )
            if not payment_err and payment_resp.status_code == 200:
                cancelled_vouchers = payment_resp.json().get("data", []) or []
                for entry in cancelled_vouchers:
                    entry_name = entry.get("name")
                    if entry_name:
                        cancelled_entries.add(entry_name)
            else:
                print(f"DEBUG: Failed to fetch cancelled Payment Entries for {field}: {payment_err or payment_resp.status_code}")

        # If search mode we already populated `movements`; otherwise fetch now
        if not search:
            gl_params = {
                "fields": json.dumps(["name", "posting_date", "account", "debit", "credit", "debit_in_account_currency", "credit_in_account_currency", "account_currency", "voucher_type", "voucher_no", "remarks"]),
                "filters": json.dumps(gl_filters),
                "order_by": "posting_date desc",
                "limit_page_length": page_size,
                "limit_start": limit_start
            }
            gl_response, gl_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/GL Entry",
                params=gl_params,
                operation_name="Get Accounting Movements"
            )

            if gl_error:
                print(f"DEBUG: Failed to get GL Entries: {gl_error}")
                return handle_erpnext_error(gl_error, "Failed to get accounting movements")

            gl_data = gl_response.json()
            movements = gl_data.get("data", [])

        # Formatear movimientos
        formatted_movements = []
        for movement in movements:
            voucher_type = (movement.get("voucher_type") or "").strip()
            voucher_no = movement.get("voucher_no")
            if voucher_type == "Payment Entry" and voucher_no in cancelled_entries:
                continue
            # Usar montos en moneda de la cuenta (no en moneda base)
            debit_amount = movement.get("debit_in_account_currency", 0) or movement.get("debit", 0)
            credit_amount = movement.get("credit_in_account_currency", 0) or movement.get("credit", 0)
            formatted_movements.append({
                "name": movement.get("name"),
                "date": movement.get("posting_date"),
                "description": _fix_text_encoding(movement.get("remarks", "")),
                "voucher_type": movement.get("voucher_type", ""),
                "voucher_no": movement.get("voucher_no"),
                "debit": debit_amount,
                "credit": credit_amount,
                "currency": movement.get("account_currency")
            })

            print(f"Movement date: {movement.get('posting_date')}")
        # If search param present, filter accounting movements locally so search
        # spans the entire date range
        search = (request.args.get('search') or '').strip()
        if search:
            term = search.lower()
            def match_acc(rec):
                parts = [
                    (rec.get('description') or ''),
                    (rec.get('voucher_no') or rec.get('name') or ''),
                    str(((rec.get('debit') or 0) - (rec.get('credit') or 0)) or '') ,
                    (rec.get('date') or '')
                ]
                hay = ' '.join(parts).lower()
                return term in hay
            formatted_movements = [r for r in formatted_movements if match_acc(r)]

        accounting_keys = [
            f"{mov.get('voucher_type') or 'Unknown'}:{mov.get('voucher_no') or mov.get('name')}"
            for mov in formatted_movements
        ]
        print("DEBUG: Accounting movements returned (voucher_type:voucher_no).", accounting_keys)
        print("DEBUG: Accounting reconciliation assumes matching voucher_type/voucher_no pairs referenced from bank linked payments.")

        if search:
            resp_page = 1
            resp_page_size = len(formatted_movements)
            has_more = False
        else:
            resp_page = page
            resp_page_size = page_size
            has_more = len(movements) == page_size

        return jsonify({
            "success": True,
            "data": formatted_movements,
            "pagination": {
                "page": resp_page,
                "page_size": resp_page_size,
                "has_more": has_more
            }
        })

    except Exception as e:
        print(f"DEBUG: Exception in accounting_movements: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@treasury_bp.route('/api/bank-reconciled-identifiers/<path:account_name>', methods=['GET'])
def bank_reconciled_identifiers(account_name):
    """Return reconciled ledger identifiers for a treasury bank account across the
    full date range provided. This iterates all Bank Transaction pages (like
    search mode) but returns only the list of reconciled ledger identifiers.
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            response, status_code = error_response
            return response, status_code

        active_company = request.headers.get('X-Active-Company')
        if not active_company:
            return jsonify({"success": False, "message": "Empresa activa no especificada"}), 400

        resolved_bank_account = _resolve_bank_account_name(session, account_name)
        target_bank_account = resolved_bank_account or account_name

        from_date = request.args.get('from_date')
        to_date = request.args.get('to_date')

        # Basic date validation and limit
        if from_date and to_date:
            try:
                from_dt = datetime.strptime(from_date, "%Y-%m-%d")
                to_dt = datetime.strptime(to_date, "%Y-%m-%d")
                if (to_dt - from_dt).days > 183:
                    return jsonify({"success": False, "message": "Selecciona un rango de fechas de hasta 6 meses."}), 400
            except ValueError:
                return jsonify({"success": False, "message": "Formato de fecha inválido. Usa AAAA-MM-DD."}), 400

        cache_key = f"reconciled:{target_bank_account}:{from_date or ''}:{to_date or ''}" 
        cached = _cache_get(cache_key)
        if cached is not None:
            return jsonify({"success": True, "reconciled_ledger_identifiers": sorted(list(cached))}), 200

        bt_filters = [["bank_account", "=", target_bank_account]]
        if active_company:
            bt_filters.append(["company", "=", active_company])
        if from_date:
            bt_filters.append(["date", ">=", from_date])
        if to_date:
            bt_filters.append(["date", "<=", to_date])

        fetch_size = 500
        limit_start_fetch = 0
        all_movements = []
        while True:
            bt_params = {
                "fields": json.dumps([
                    "name",
                    "date",
                    "description",
                    "reference_number",
                    "transaction_id",
                    "deposit",
                    "withdrawal",
                    "status",
                    "currency",
                    "bank_account",
                    "company",
                    "party",
                    "party_type",
                    "unallocated_amount",
                    "allocated_amount"
                ]),
                "filters": json.dumps(bt_filters),
                "order_by": "date desc",
                "limit_page_length": fetch_size,
                "limit_start": limit_start_fetch
            }
            bt_response, bt_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Bank Transaction",
                params=bt_params,
                operation_name="Get Bank Movements (reconciled identifiers)"
            )
            if bt_error:
                return handle_erpnext_error(bt_error, "Failed to get bank movements for reconciled identifiers")
            batch = bt_response.json().get("data", [])
            all_movements.extend(batch)
            if len(batch) < fetch_size:
                break
            limit_start_fetch += fetch_size

        # Collect linked payments (child table) for all transactions
        transaction_names = [mv.get("name") for mv in all_movements if mv.get("name")]
        links_by_transaction = _fetch_bank_transaction_payments(session, transaction_names)

        reconciled_identifiers_all = set()
        for mv in all_movements:
            # build a minimal movement dict so _is_bank_transaction_reconciled works
            movement = dict(mv)
            movement["linked_payments"] = links_by_transaction.get(mv.get("name")) or []
            if _is_bank_transaction_reconciled(movement):
                for link in movement.get('linked_payments') or []:
                    identifier = _build_linked_identifier(link)
                    if identifier:
                        reconciled_identifiers_all.add(identifier)

        # Cache result
        _cache_set(cache_key, reconciled_identifiers_all, ttl_seconds=300)

        return jsonify({"success": True, "reconciled_ledger_identifiers": sorted(list(reconciled_identifiers_all))}), 200

    except Exception as e:
        print(f"DEBUG: Exception in bank_reconciled_identifiers: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500


@treasury_bp.route('/api/bank-matching/enable-auto', methods=['POST'])
def enable_bank_auto_matching():
    """Habilitar el matching automático de ERPNext antes de buscar sugerencias."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        response, status_code = error_response
        return response, status_code

    try:
        payload = {
            "data": {
                "enable_automatic_party_matching": 1,
                "enable_fuzzy_matching": 1
            }
        }
        settings_response, settings_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint="/api/resource/Accounts Settings/Accounts Settings",
            data=payload,
            operation_name="Enable automatic bank matching"
        )
        if settings_error:
            return handle_erpnext_error(settings_error, "No se pudo habilitar el matching automático")

        return jsonify({
            "success": True,
            "message": "Matching automático habilitado en ERPNext."
        })
    except Exception as exc:
        print(f"DEBUG: Exception enabling automatic matching: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "No se pudo habilitar el matching automático"}), 500


@treasury_bp.route('/api/bank-transactions/<path:transaction_name>/suggestions', methods=['POST'])
def get_bank_transaction_suggestions(transaction_name):
    """Obtener vouchers sugeridos para un Bank Transaction."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        response, status_code = error_response
        return response, status_code

    try:
        payload = request.get_json() or {}
        document_types_list = payload.get("document_types") or ["Payment Entry", "Journal Entry"]
        # Convertir a string JSON como requiere ERPNext: "[\"payment_entry\",\"journal_entry\"]"
        document_types = json.dumps([dt.lower().replace(" ", "_") for dt in document_types_list])
        bank_account = payload.get("bank_account")
        company = payload.get("company")

        transaction_details = _fetch_bank_transaction_details(session, transaction_name)
        if transaction_details.get("error"):
            return handle_erpnext_error({"message": transaction_details["error"]}, "No se pudo obtener la transacción bancaria")
        if transaction_details:
            bank_account = bank_account or transaction_details.get("bank_account")
            company = company or transaction_details.get("company")

        resolved_bank_account = _resolve_bank_account_name(session, bank_account) if bank_account else None
        if resolved_bank_account:
            bank_account = resolved_bank_account
            if transaction_details and transaction_details.get("bank_account") != resolved_bank_account:
                try:
                    update_payload = {"data": {"bank_account": resolved_bank_account}}
                    _, update_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/Bank Transaction/{urllib.parse.quote(transaction_name)}",
                        data=update_payload,
                        operation_name=f"Update bank account on transaction '{transaction_name}'"
                    )
                    if update_error:
                        print(f"DEBUG: Unable to update bank transaction bank_account: {update_error}")
                except Exception as exc:
                    print(f"DEBUG: Exception updating bank transaction bank_account: {exc}")
        else:
            bank_account = None

        if not bank_account:
            return jsonify({
                "success": False,
                "message": "No se pudo determinar la cuenta bancaria asociada. Asegúrate de que la transacción tenga una Bank Account válida o envía el nombre explícitamente."
            }), 400

        request_body = {
            "bank_transaction_name": transaction_name,
            "document_types": document_types,
            "from_date": payload.get("from_date"),
            "to_date": payload.get("to_date"),
            "filter_by_reference_date": 1 if _parse_bool(payload.get("filter_by_reference_date")) else 0
        }
        request_body["bank_account"] = bank_account
        if company:
            request_body["company"] = company
        request_body = {key: value for key, value in request_body.items() if value is not None}

        suggestions_response, suggestions_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.get_linked_payments",
            data=request_body,
            operation_name=f"Get suggested vouchers for {transaction_name}"
        )

        if suggestions_error:
            return handle_erpnext_error(suggestions_error, "No se pudieron obtener los vouchers sugeridos")

        raw_suggestions = suggestions_response.json().get("message") or []
        normalized = []
        for item in raw_suggestions:
            payment_name = (
                item.get("payment_name")
                or item.get("payment_entry")
                or item.get("journal_entry")
                or item.get("voucher_no")
                or item.get("name")
            )
            payment_doctype = (
                item.get("payment_doctype")
                or item.get("payment_document")
                or ("Payment Entry" if item.get("payment_entry") else None)
                or ("Journal Entry" if item.get("journal_entry") else None)
                or item.get("voucher_type")
            )
            normalized.append({
                "payment_doctype": payment_doctype or "Payment Entry",
                "payment_name": payment_name,
                "party": item.get("party"),
                "posting_date": item.get("posting_date"),
                "amount": item.get("amount") or item.get("paid_amount") or item.get("received_amount") or 0,
                "reference_no": item.get("reference_no") or item.get("reference"),
                "match_score": item.get("match_score"),
                "currency": item.get("currency"),
                "raw": item
            })
        return jsonify({"success": True, "data": normalized})
    except Exception as exc:
        print(f"DEBUG: Exception fetching suggestions: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "No se pudieron obtener sugerencias"}), 500


@treasury_bp.route('/api/bank-transactions/<path:transaction_name>/reconcile', methods=['POST'])
def reconcile_bank_transaction(transaction_name):
    """Conciliar un Bank Transaction con los vouchers seleccionados."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        response, status_code = error_response
        return response, status_code

    try:
        payload = request.get_json() or {}
        vouchers = payload.get("vouchers")
        if not vouchers or not isinstance(vouchers, list):
            return jsonify({"success": False, "message": "Debes seleccionar vouchers válidos."}), 400

        # Validate vouchers: ERPNext v15 expects vouchers to be a JSON string and each voucher must include
        # payment_doctype, payment_name and amount (numeric). We'll ensure those fields and attempt to fetch
        # amount for Payment Entry if missing.
        final_vouchers = []
        for idx, v in enumerate(vouchers):
            if not isinstance(v, dict):
                return jsonify({"success": False, "message": f"Voucher at index {idx} must be an object."}), 400
            payment_doctype = v.get("payment_doctype") or v.get("payment_document")
            payment_name = v.get("payment_name") or v.get("payment_entry") or v.get("payment") or v.get("name")
            amount = v.get("amount")

            if not payment_doctype:
                return jsonify({"success": False, "message": f"payment_doctype is required for voucher at index {idx}."}), 400
            if not payment_name:
                return jsonify({"success": False, "message": f"payment_name is required for voucher at index {idx}."}), 400

            # Normalize amount: if missing and Payment Entry, try to fetch it
            if amount is None:
                if payment_doctype == 'Payment Entry':
                    # Try to fetch Payment Entry to obtain paid_amount/received_amount
                    pe_resp, pe_err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Payment Entry/{urllib.parse.quote(payment_name)}",
                        operation_name=f"Get Payment Entry {payment_name}"
                    )
                    if pe_err or pe_resp.status_code != 200:
                        return jsonify({"success": False, "message": f"No se pudo obtener el monto del Payment Entry '{payment_name}'. Proporcioná 'amount' en el voucher."}), 400
                    pe_data = pe_resp.json().get('data') or {}
                    amount = pe_data.get('paid_amount') or pe_data.get('received_amount') or pe_data.get('amount')
                else:
                    return jsonify({"success": False, "message": f"'amount' is required for voucher '{payment_name}' of type '{payment_doctype}'."}), 400

            # Ensure amount is numeric
            try:
                amount = float(amount)
            except Exception:
                return jsonify({"success": False, "message": f"Invalid numeric amount for voucher '{payment_name}'."}), 400

            final_vouchers.append({
                "payment_doctype": payment_doctype,
                "payment_name": payment_name,
                "amount": amount
            })

        request_body = {
            "bank_transaction_name": transaction_name,
            # ERPNext v15 expects vouchers as a JSON string
            "vouchers": json.dumps(final_vouchers)
        }
        clearance_date = payload.get("clearance_date")
        if clearance_date:
            request_body["clearance_date"] = clearance_date

        # Validate amounts match before reconciling
        transaction_response, transaction_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Bank Transaction/{urllib.parse.quote(transaction_name)}",
            operation_name="Get Bank Transaction for amount validation"
        )
        if transaction_error:
            return handle_erpnext_error(transaction_error, "Error al obtener la transacción bancaria")
        transaction_data = transaction_response.json().get('data', {})
        total_voucher_amount = sum(v['amount'] for v in final_vouchers)
        bank_amount = abs(float(transaction_data.get('deposit', 0) - float(transaction_data.get('withdrawal', 0))))
        if abs(total_voucher_amount - bank_amount) > 0.01:
            return jsonify({"success": False, "message": f"Los montos de los comprobantes ({total_voucher_amount:.2f}) no coinciden con el monto de la transacción bancaria ({bank_amount:.2f})"}), 400

        # Call the correct ERPNext method for reconcile (bank_reconciliation_tool)
        reconcile_response, reconcile_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.reconcile_vouchers",
            data=request_body,
            send_as_form=True,
            operation_name=f"Reconcile bank transaction {transaction_name}"
        )

        if reconcile_error:
            return handle_erpnext_error(reconcile_error, "No se pudo conciliar la transacción bancaria")

        updated_transaction = _fetch_bank_transaction_details(session, transaction_name)
        return jsonify({
            "success": True,
            "message": "Transacción conciliada correctamente.",
            "data": {
                "transaction": updated_transaction
            }
        })
    except Exception as exc:
        print(f"DEBUG: Exception reconciling bank transaction {transaction_name}: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": "No se pudo conciliar la transacción bancaria"}), 500


@treasury_bp.route('/api/bank-transactions/<path:transaction_name>/unreconcile', methods=['POST'])
def unreconcile_bank_transaction(transaction_name):
    """Deshacer la conciliación de un Bank Transaction eliminando sus Bank Transaction Payments."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        response, status_code = error_response
        return response, status_code

    try:
        print(f"DEBUG: Starting unreconcile for Bank Transaction: {transaction_name}")
        
        # 1) Obtener todos los Bank Transaction Payments (child rows) del Bank Transaction
        child_payload = {
            "doctype": "Bank Transaction Payments",
            "parent": "Bank Transaction",
            "fields": ["name", "parent", "allocated_amount", "payment_document", "payment_entry"],
            "filters": {
                "parent": transaction_name,
                "parenttype": "Bank Transaction",
                "parentfield": "payment_entries"
            },
            "limit_page_length": 100
        }
        
        child_response, child_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data=child_payload,
            operation_name=f"Get Bank Transaction Payments for {transaction_name}"
        )
        
        if child_error:
            return handle_erpnext_error(child_error, "Failed to get Bank Transaction Payments")
        
        child_rows = child_response.json().get("message", []) or []
        print(f"DEBUG: Found {len(child_rows)} Bank Transaction Payments to delete")
        
        if not child_rows:
            return jsonify({
                "success": True,
                "message": "No hay pagos vinculados para desconciliar.",
                "data": {"transaction": _fetch_bank_transaction_details(session, transaction_name)}
            })
        
        # 2) Borrar cada Bank Transaction Payment (uno por uno)
        deleted_count = 0
        failed_deletes = []
        
        for child in child_rows:
            child_name = child.get("name")
            if not child_name:
                continue
            
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Bank Transaction Payments/{urllib.parse.quote(child_name)}",
                operation_name=f"Delete Bank Transaction Payment {child_name}"
            )
            
            if delete_error:
                print(f"DEBUG: Failed to delete Bank Transaction Payment {child_name}: {delete_error}")
                failed_deletes.append(child_name)
            else:
                deleted_count += 1
                print(f"DEBUG: Deleted Bank Transaction Payment {child_name}")
        
        if failed_deletes:
            return jsonify({
                "success": False,
                "message": f"No se pudieron eliminar {len(failed_deletes)} vínculos.",
                "failed_items": failed_deletes
            }), 500
        
        # 3) Recalcular allocated_amount / unallocated_amount del Bank Transaction
        # Obtener el monto total del movimiento bancario
        transaction_details = _fetch_bank_transaction_details(session, transaction_name)
        if transaction_details.get("error"):
            return jsonify({
                "success": False,
                "message": "No se pudo obtener los detalles del Bank Transaction"
            }), 500
        
        deposit = _to_float(transaction_details.get("deposit", 0))
        withdrawal = _to_float(transaction_details.get("withdrawal", 0))
        
        # Calcular monto absoluto
        total_amount = deposit if deposit > 0 else withdrawal
        
        # Después de borrar todos los links:
        # allocated_amount = 0
        # unallocated_amount = monto absoluto total
        update_payload = {
            "allocated_amount": 0,
            "unallocated_amount": total_amount
        }
        
        print(f"DEBUG: Updating Bank Transaction with allocated=0, unallocated={total_amount}")
        
        update_response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Bank Transaction/{urllib.parse.quote(transaction_name)}",
            data=update_payload,
            operation_name=f"Update amounts for {transaction_name}"
        )
        
        if update_error:
            return handle_erpnext_error(update_error, "Failed to update Bank Transaction amounts")
        
        # 4) Verificación final
        updated_transaction = _fetch_bank_transaction_details(session, transaction_name)
        
        print(f"DEBUG: Unreconcile completed. Deleted {deleted_count} payment links.")
        print(f"DEBUG: Final state - allocated: {updated_transaction.get('allocated_amount')}, unallocated: {updated_transaction.get('unallocated_amount')}")
        
        return jsonify({
            "success": True,
            "message": f"Conciliación revertida exitosamente. Se eliminaron {deleted_count} vínculos.",
            "data": {
                "transaction": updated_transaction,
                "deleted_links": deleted_count
            }
        })
        
    except Exception as exc:
        print(f"DEBUG: Exception unreconciling bank transaction {transaction_name}: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error al desconciliar: {str(exc)}"}), 500


@treasury_bp.route('/api/bank-transactions/<path:transaction_name>', methods=['DELETE'])
def delete_bank_transaction(transaction_name):
    """Eliminar una Bank Transaction."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        response, status_code = error_response
        return response, status_code

    try:
        # First, check if the transaction exists and get its details
        check_response, check_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Bank Transaction/{urllib.parse.quote(transaction_name)}",
            operation_name="Check Bank Transaction existence"
        )
        if check_error:
            return handle_erpnext_error(check_error, "Error al verificar la transacción bancaria")
        if check_response.status_code == 404:
            return jsonify({"success": False, "message": "Transacción bancaria no encontrada"}), 404

        # Delete the bank transaction
        delete_response, delete_error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Bank Transaction/{urllib.parse.quote(transaction_name)}",
            operation_name=f"Delete Bank Transaction {transaction_name}"
        )
        if delete_error:
            return handle_erpnext_error(delete_error, "Error al eliminar la transacción bancaria")

        print(f"DEBUG: Successfully deleted Bank Transaction {transaction_name}")
        return jsonify({"success": True, "message": "Transacción bancaria eliminada exitosamente"})

    except Exception as exc:
        print(f"DEBUG: Exception deleting bank transaction {transaction_name}: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error al eliminar: {str(exc)}"}), 500
