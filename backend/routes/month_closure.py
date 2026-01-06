"""
Month Closure Routes
Handles month closure operations for bank accounts and account reconciliation
"""

from flask import Blueprint, request, jsonify
from datetime import datetime
import calendar
import json
import traceback

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_company_abbr
from utils.http_utils import make_erpnext_request, handle_erpnext_error

month_closure_bp = Blueprint('month_closure', __name__)


def ensure_account_name_with_abbr(account_name, company_abbr):
    """
    Asegura que el nombre de cuenta incluya la abreviación de la empresa.
    Si ya la tiene, la retorna tal cual. Si no, la agrega al final.
    """
    if not account_name or not company_abbr:
        return account_name
    
    # Verificar si ya termina con la abreviación
    if account_name.endswith(f" - {company_abbr}"):
        return account_name
    
    # Agregar la abreviación
    return f"{account_name} - {company_abbr}"


def get_last_day_of_month(year, month):
    """Obtener el último día del mes"""
    last_day = calendar.monthrange(year, month)[1]
    return f"{year}-{month:02d}-{last_day:02d}"


def get_first_day_of_month(year, month):
    """Obtener el primer día del mes"""
    return f"{year}-{month:02d}-01"


def get_bank_account_from_gl_account(session, headers, gl_account_name):
    """
    Busca el Bank Account que tiene asignada una cuenta contable específica.
    Bank Transaction.bank_account apunta al nombre del documento Bank Account,
    NO a la cuenta contable (GL Account).
    """
    try:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank Account",
            params={
                "filters": json.dumps([["account", "=", gl_account_name]]),
                "fields": json.dumps(["name", "account", "bank", "account_name"]),
                "limit_page_length": 1
            },
            operation_name="Get Bank Account from GL Account"
        )
        
        if resp and resp.status_code == 200:
            data = resp.json().get("data", [])
            if data:
                bank_account_name = data[0].get("name")
                print(f"DEBUG: Found Bank Account '{bank_account_name}' for GL Account '{gl_account_name}'")
                return bank_account_name
            else:
                print(f"DEBUG: No Bank Account found for GL Account '{gl_account_name}'")
                return None
        else:
            print(f"DEBUG: Error fetching Bank Account: {err}")
            return None
    except Exception as e:
        print(f"DEBUG: Exception in get_bank_account_from_gl_account: {e}")
        return None


@month_closure_bp.route('/api/month-closure/account-summary/<account_name>', methods=['GET'])
def get_account_month_summary(account_name):
    """
    Obtener resumen mensual de una cuenta bancaria
    Incluye saldos contables, bank transactions y estado de cierre por mes
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        company_name = get_active_company(user_id)
        if not company_name:
            return jsonify({
                "success": False,
                "message": "No hay compañía activa configurada"
            }), 400

        # Obtener abreviación de la empresa
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({
                "success": False,
                "message": "Error obteniendo abreviación de la empresa"
            }), 500

        # Asegurar que el nombre de cuenta tenga la abreviación
        account_name_with_abbr = ensure_account_name_with_abbr(account_name, company_abbr)
        print(f"Account name original: {account_name}")
        print(f"Account name with abbr: {account_name_with_abbr}")

        # Obtener información de la cuenta
        account_resp, account_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Account/{account_name_with_abbr}",
            params={"fields": json.dumps(["name", "account_name", "custom_lock_posting_before", "custom_lock_reason"])},
            operation_name=f"Get Account {account_name_with_abbr}"
        )

        if account_err or account_resp.status_code != 200:
            return jsonify({
                "success": False,
                "message": f"Error obteniendo información de la cuenta: {account_err or account_resp.text}"
            }), 500

        account_data = account_resp.json().get("data", {})
        
        # Obtener rangos de fechas de movimientos contables
        gl_filters = [
            ["account", "=", account_name_with_abbr],
            ["company", "=", company_name]
        ]
        
        gl_resp, gl_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/GL Entry",
            params={
                "filters": json.dumps(gl_filters),
                "fields": json.dumps(["posting_date"]),
                "order_by": "posting_date asc",
                "limit_page_length": 10000
            },
            operation_name="Get GL Entry dates"
        )

        # Obtener el Bank Account asociado a esta cuenta contable
        bank_account_name = get_bank_account_from_gl_account(session, headers, account_name_with_abbr)
        
        if not bank_account_name:
            print(f"DEBUG: No Bank Account found for GL Account {account_name_with_abbr}, skipping Bank Transactions")
            # Continue without bank transactions
            bt_filters = None
        else:
            # Obtener rangos de fechas de bank transactions
            bt_filters = [["bank_account", "=", bank_account_name]]
        
        bt_resp = None
        bt_err = None
        if bt_filters:
            bt_resp, bt_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Bank Transaction",
                params={
                    "filters": json.dumps(bt_filters),
                    "fields": json.dumps(["date"]),
                    "order_by": "date asc",
                    "limit_page_length": 10000
                },
                operation_name="Get Bank Transaction dates"
            )

        # Construir lista de meses con movimientos
        months_with_movements = set()
        
        if gl_resp and gl_resp.status_code == 200:
            gl_entries = gl_resp.json().get("data", [])
            for entry in gl_entries:
                date_str = entry.get("posting_date")
                if date_str:
                    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                    months_with_movements.add((date_obj.year, date_obj.month))

        if bt_resp and bt_resp.status_code == 200:
            bt_entries = bt_resp.json().get("data", [])
            for entry in bt_entries:
                date_str = entry.get("date")
                if date_str:
                    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                    months_with_movements.add((date_obj.year, date_obj.month))

        # Ordenar meses
        sorted_months = sorted(list(months_with_movements), reverse=True)

        # Determinar qué meses están cerrados
        lock_date_str = account_data.get("custom_lock_posting_before")
        lock_date = None
        if lock_date_str:
            lock_date = datetime.strptime(lock_date_str, "%Y-%m-%d")

        months_summary = []
        for year, month in sorted_months:
            last_day = get_last_day_of_month(year, month)
            last_day_obj = datetime.strptime(last_day, "%Y-%m-%d")
            
            is_closed = False
            if lock_date and last_day_obj <= lock_date:
                is_closed = True

            months_summary.append({
                "year": year,
                "month": month,
                "month_name": calendar.month_name[month],
                "last_day": last_day,
                "is_closed": is_closed
            })

        # Calcular saldo contable actual
        gl_balance_resp, gl_balance_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/GL Entry",
            params={
                "filters": json.dumps(gl_filters),
                "fields": json.dumps(["debit", "credit"]),
                "limit_page_length": 99999
            },
            operation_name="Get GL Balance"
        )

        accounting_balance = 0
        if gl_balance_resp and gl_balance_resp.status_code == 200:
            gl_entries = gl_balance_resp.json().get("data", [])
            for entry in gl_entries:
                accounting_balance += float(entry.get("debit", 0) or 0)
                accounting_balance -= float(entry.get("credit", 0) or 0)

        # Calcular saldo de bank transactions
        bank_balance = 0
        if bt_filters:
            print(f"DEBUG: Fetching Bank Transactions with filters: {bt_filters}")
            bt_balance_resp, bt_balance_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Bank Transaction",
                params={
                    "filters": json.dumps(bt_filters),
                    "fields": json.dumps(["name", "date", "deposit", "withdrawal", "bank_account"]),
                    "limit_page_length": 99999
                },
                operation_name="Get Bank Transaction Balance"
            )

            if bt_balance_resp and bt_balance_resp.status_code == 200:
                bt_entries = bt_balance_resp.json().get("data", [])
                print(f"DEBUG: Found {len(bt_entries)} bank transactions for balance calculation")
                if len(bt_entries) > 0:
                    print(f"DEBUG: First entry sample: {bt_entries[0]}")
                for entry in bt_entries:
                    deposit = float(entry.get("deposit") or 0)
                    withdrawal = float(entry.get("withdrawal") or 0)
                    print(f"DEBUG: Entry {entry.get('name')} ({entry.get('date')}) - deposit: {deposit}, withdrawal: {withdrawal}")
                    bank_balance += deposit
                    bank_balance -= withdrawal
                print(f"DEBUG: Total bank balance: {bank_balance}")
            else:
                print(f"DEBUG: Error fetching Bank Transactions: {bt_balance_err}")
                if bt_balance_resp:
                    print(f"DEBUG: Response status: {bt_balance_resp.status_code}, body: {bt_balance_resp.text}")
        else:
            print(f"DEBUG: No Bank Account found, bank balance will be 0")

        return jsonify({
            "success": True,
            "account_name": account_data.get("account_name"),
            "accounting_balance": round(accounting_balance, 2),
            "bank_balance": round(bank_balance, 2),
            "lock_date": lock_date_str,
            "lock_reason": account_data.get("custom_lock_reason"),
            "months": months_summary
        })

    except Exception as e:
        print(f"Error en get_account_month_summary: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": f"Error interno: {str(e)}"
        }), 500


@month_closure_bp.route('/api/month-closure/month-balances', methods=['POST'])
def get_month_balances():
    """
    Obtener saldos de un mes específico para una cuenta
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        account_name = data.get("account_name")
        year = data.get("year")
        month = data.get("month")

        if not account_name or not year or not month:
            return jsonify({
                "success": False,
                "message": "Faltan parámetros requeridos: account_name, year, month"
            }), 400

        company_name = get_active_company(user_id)
        if not company_name:
            return jsonify({
                "success": False,
                "message": "No hay compañía activa configurada"
            }), 400

        # Obtener abreviación de la empresa
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({
                "success": False,
                "message": "Error obteniendo abreviación de la empresa"
            }), 500

        # Asegurar que el nombre de cuenta tenga la abreviación
        account_name_with_abbr = ensure_account_name_with_abbr(account_name, company_abbr)

        # Calcular fechas del mes
        first_day = get_first_day_of_month(year, month)
        last_day = get_last_day_of_month(year, month)

        # Saldo contable hasta el fin del mes
        gl_filters = [
            ["account", "=", account_name_with_abbr],
            ["company", "=", company_name],
            ["posting_date", "<=", last_day]
        ]
        
        gl_resp, gl_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/GL Entry",
            params={
                "filters": json.dumps(gl_filters),
                "fields": json.dumps(["debit", "credit"]),
                "limit_page_length": 99999
            },
            operation_name="Get GL Balance for month"
        )

        accounting_balance = 0
        if gl_resp and gl_resp.status_code == 200:
            gl_entries = gl_resp.json().get("data", [])
            for entry in gl_entries:
                accounting_balance += float(entry.get("debit", 0) or 0)
                accounting_balance -= float(entry.get("credit", 0) or 0)

        # Obtener el Bank Account asociado a esta cuenta contable
        bank_account_name = get_bank_account_from_gl_account(session, headers, account_name_with_abbr)
        
        # Saldo de bank transactions hasta el fin del mes
        bank_balance = 0
        if bank_account_name:
            bt_filters = [
                ["bank_account", "=", bank_account_name],
                ["date", "<=", last_day]
            ]
            
            bt_resp, bt_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Bank Transaction",
                params={
                    "filters": json.dumps(bt_filters),
                    "fields": json.dumps(["deposit", "withdrawal"]),
                    "limit_page_length": 99999
                },
                operation_name="Get Bank Transaction Balance for month"
            )

            if bt_resp and bt_resp.status_code == 200:
                bt_entries = bt_resp.json().get("data", [])
                for entry in bt_entries:
                    deposit = float(entry.get("deposit") or 0)
                    withdrawal = float(entry.get("withdrawal") or 0)
                    bank_balance += deposit
                    bank_balance -= withdrawal
        else:
            print(f"DEBUG: No Bank Account found for GL Account {account_name_with_abbr} in get_month_balances")

        return jsonify({
            "success": True,
            "year": year,
            "month": month,
            "month_name": calendar.month_name[month],
            "first_day": first_day,
            "last_day": last_day,
            "accounting_balance": round(accounting_balance, 2),
            "bank_balance": round(bank_balance, 2),
            "difference": round(accounting_balance - bank_balance, 2),
            "balances_match": abs(accounting_balance - bank_balance) < 0.01
        })

    except Exception as e:
        print(f"Error en get_month_balances: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": f"Error interno: {str(e)}"
        }), 500


@month_closure_bp.route('/api/month-closure/close-month', methods=['POST'])
def close_month():
    """
    Cerrar un mes específico para una cuenta
    Actualiza el campo custom_lock_posting_before de la cuenta
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        account_name = data.get("account_name")
        year = data.get("year")
        month = data.get("month")

        if not account_name or not year or not month:
            return jsonify({
                "success": False,
                "message": "Faltan parámetros requeridos: account_name, year, month"
            }), 400

        company_name = get_active_company(user_id)
        if not company_name:
            return jsonify({
                "success": False,
                "message": "No hay compañía activa configurada"
            }), 400

        # Obtener abreviación de la empresa
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({
                "success": False,
                "message": "Error obteniendo abreviación de la empresa"
            }), 500

        # Asegurar que el nombre de cuenta tenga la abreviación
        account_name_with_abbr = ensure_account_name_with_abbr(account_name, company_abbr)

        # Calcular último día del mes
        last_day = get_last_day_of_month(year, month)
        
        # Formatear motivo
        month_name_es = {
            1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
            5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
            9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre"
        }
        lock_reason = f"Conciliación cerrada {month_name_es[month]}/{year}"

        # Actualizar cuenta
        update_data = {
            "custom_lock_posting_before": last_day,
            "custom_lock_reason": lock_reason
        }

        update_resp, update_err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Account/{account_name_with_abbr}",
            data=update_data,
            custom_headers=headers,
            operation_name=f"Close month for Account {account_name_with_abbr}"
        )

        if update_err or update_resp.status_code not in [200, 201]:
            return jsonify({
                "success": False,
                "message": f"Error cerrando mes: {update_err or update_resp.text}"
            }), 500

        return jsonify({
            "success": True,
            "message": f"Mes {month_name_es[month]}/{year} cerrado exitosamente",
            "lock_date": last_day,
            "lock_reason": lock_reason
        })

    except Exception as e:
        print(f"Error en close_month: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": f"Error interno: {str(e)}"
        }), 500


@month_closure_bp.route('/api/month-closure/unlock-month', methods=['POST'])
def unlock_month():
    """
    Desbloquear meses de una cuenta
    Actualiza el campo custom_lock_posting_before a None o a una fecha anterior
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        account_name = data.get("account_name")
        new_lock_date = data.get("new_lock_date")  # Puede ser None para desbloquear todo

        if not account_name:
            return jsonify({
                "success": False,
                "message": "Falta parámetro requerido: account_name"
            }), 400

        company_name = get_active_company(user_id)
        if not company_name:
            return jsonify({
                "success": False,
                "message": "No hay compañía activa configurada"
            }), 400

        # Obtener abreviación de la empresa
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({
                "success": False,
                "message": "Error obteniendo abreviación de la empresa"
            }), 500

        # Asegurar que el nombre de cuenta tenga la abreviación
        account_name_with_abbr = ensure_account_name_with_abbr(account_name, company_abbr)

        # Actualizar cuenta
        update_data = {
            "custom_lock_posting_before": new_lock_date,
            "custom_lock_reason": "" if not new_lock_date else None
        }

        update_resp, update_err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Account/{account_name_with_abbr}",
            data=update_data,
            custom_headers=headers,
            operation_name=f"Unlock month for Account {account_name_with_abbr}"
        )

        if update_err or update_resp.status_code not in [200, 201]:
            return jsonify({
                "success": False,
                "message": f"Error desbloqueando mes: {update_err or update_resp.text}"
            }), 500

        return jsonify({
            "success": True,
            "message": "Meses desbloqueados exitosamente",
            "new_lock_date": new_lock_date
        })

    except Exception as e:
        print(f"Error en unlock_month: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": f"Error interno: {str(e)}"
        }), 500
