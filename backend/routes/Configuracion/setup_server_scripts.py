"""
Setup - Server Scripts
Handles creation of server scripts for account locking and period closure
"""

from flask import jsonify
import json
import traceback

from utils.http_utils import make_erpnext_request, handle_erpnext_error
from routes.auth_utils import get_session_with_auth


# Script templates for different doctypes and events
PAYMENT_ENTRY_SCRIPT = """# Lock by Account.custom_lock_posting_before (inclusive)
# Applies to Payment Entry. No role exemptions.

# Defensive: doc is provided by DocType Event context
d = {}
try:
    d = doc.as_dict()
except Exception:
    d = {}

posting_date = d.get("posting_date")

# If no posting_date, do nothing (ERPNext will validate it anyway)
if posting_date:
    accounts_to_check = []
    paid_from = d.get("paid_from")
    paid_to = d.get("paid_to")

    if paid_from:
        accounts_to_check.append(paid_from)
    if paid_to and paid_to != paid_from:
        accounts_to_check.append(paid_to)

    # Check each account lock date
    for acc in accounts_to_check:
        lock_date = None
        try:
            lock_date = frappe.db.get_value("Account", acc, "custom_lock_posting_before")
        except Exception:
            lock_date = None

        if lock_date and posting_date <= lock_date:
            reason = None
            try:
                reason = frappe.db.get_value("Account", acc, "custom_lock_reason")
            except Exception:
                reason = None

            msg = "Cuenta bloqueada por cierre: {0}. No se permite movimiento con fecha {1} (bloqueado hasta {2}).".format(
                acc, posting_date, lock_date
            )
            if reason:
                msg = msg + " Motivo: {0}".format(reason)

            frappe.throw(msg)
"""

JOURNAL_ENTRY_SCRIPT = """# Lock by Account.custom_lock_posting_before (inclusive)
# Applies to Journal Entry. No role exemptions.

d = {}
try:
    d = doc.as_dict()
except Exception:
    d = {}

posting_date = d.get("posting_date")
lines = d.get("accounts") or []

if posting_date and isinstance(lines, list):
    seen = {}
    for row in lines:
        if not isinstance(row, dict):
            continue
        acc = row.get("account")
        if not acc:
            continue
        # de-dupe accounts
        if seen.get(acc):
            continue
        seen[acc] = 1

        lock_date = None
        try:
            lock_date = frappe.db.get_value("Account", acc, "custom_lock_posting_before")
        except Exception:
            lock_date = None

        if lock_date and posting_date <= lock_date:
            reason = None
            try:
                reason = frappe.db.get_value("Account", acc, "custom_lock_reason")
            except Exception:
                reason = None

            msg = "Cuenta bloqueada por cierre: {0}. No se permite asiento con fecha {1} (bloqueado hasta {2}).".format(
                acc, posting_date, lock_date
            )
            if reason:
                msg = msg + " Motivo: {0}".format(reason)

            frappe.throw(msg)
"""

BANK_TRANSACTION_SCRIPT = """# Lock Bank Transaction edits by Account.custom_lock_posting_before (inclusive)
# Bank Transaction: uses fields "date" and "bank_account"
# No role exemptions (nobody has coronita).

d = {}
try:
    d = doc.as_dict()
except Exception:
    d = {}

tx_date = d.get("date")
bank_account_name = d.get("bank_account")

# Only proceed if we have both
if tx_date and bank_account_name:
    # 1) Map Bank Account -> GL Account (Account doctype)
    gl_account = None

    # Common field name in Bank Account is "account"
    try:
        gl_account = frappe.db.get_value("Bank Account", bank_account_name, "account")
    except Exception:
        gl_account = None

    # If not found, try to infer by reading Bank Account doc (field name may differ)
    if not gl_account:
        ba = None
        try:
            ba = frappe.get_doc("Bank Account", bank_account_name)
        except Exception:
            ba = None

        if ba:
            ba_d = {}
            try:
                ba_d = ba.as_dict()
            except Exception:
                ba_d = {}

            # Try a few likely keys without getattr/hasattr
            gl_account = ba_d.get("account") or ba_d.get("bank_account") or ba_d.get("gl_account") or ba_d.get("default_account")

    # If still no GL account, block (otherwise you silently allow edits)
    if not gl_account:
        frappe.throw(
            "No se pudo determinar la cuenta contable (Account) del Bank Account '{0}'. "
            "No se permite modificar Bank Transactions sin ese mapeo.".format(bank_account_name)
        )

    # 2) Check lock date on the GL Account
    lock_date = None
    try:
        lock_date = frappe.db.get_value("Account", gl_account, "custom_lock_posting_before")
    except Exception:
        lock_date = None

    if lock_date and tx_date <= lock_date:
        reason = None
        try:
            reason = frappe.db.get_value("Account", gl_account, "custom_lock_reason")
        except Exception:
            reason = None

        msg = (
            "Cuenta bancaria bloqueada por cierre.\\n"
            "Bank Account: {0}\\n"
            "Cuenta contable: {1}\\n"
            "Fecha transacción: {2}\\n"
            "Bloqueado hasta: {3}\\n"
        ).format(bank_account_name, gl_account, tx_date, lock_date)

        if reason:
            msg = msg + "Motivo: {0}".format(reason)

        frappe.throw(msg)
"""


def create_server_script(session, headers, script_name, doctype, event, script_content):
    """
    Crear o actualizar un Server Script en ERPNext
    
    Args:
        session: Sesión de requests
        headers: Headers HTTP
        script_name: Nombre del script
        doctype: DocType al que se aplica
        event: Evento (validate, before_submit, before_cancel, etc.)
        script_content: Contenido del script Python
    
    Returns:
        tuple: (success, message)
    """
    try:
        # Verificar si el script ya existe
        filters_list = [["name", "=", script_name]]
        check_resp, check_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Server Script",
            params={
                "filters": json.dumps(filters_list),
                "fields": json.dumps(["name", "script_type", "reference_doctype", "doctype_event"]),
                "limit_page_length": 1
            },
            operation_name=f"Check Server Script {script_name}"
        )

        if check_err:
            return False, f"Error verificando script {script_name}: {check_err}"

        script_exists = False
        if check_resp.status_code == 200:
            existing = check_resp.json().get("data", [])
            if existing:
                script_exists = True
                print(f"Script {script_name} ya existe, actualizando...")

        # Preparar datos del script
        script_data = {
            "doctype": "Server Script",
            "name": script_name,
            "script_type": "DocType Event",
            "reference_doctype": doctype,
            "doctype_event": event,
            "script": script_content,
            "enabled": 1,
            "allow_guest": 0,
            "api_method": ""
        }

        if script_exists:
            # Actualizar script existente
            update_resp, update_err = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Server Script/{script_name}",
                data=script_data,
                custom_headers=headers,
                operation_name=f"Update Server Script {script_name}"
            )

            if update_err:
                return False, f"Error actualizando script {script_name}: {update_err}"

            if update_resp.status_code in [200, 201]:
                print(f"✓ Script {script_name} actualizado exitosamente")
                return True, f"Script {script_name} actualizado"
            else:
                return False, f"Error actualizando script {script_name}: {update_resp.status_code}"
        else:
            # Crear nuevo script
            create_resp, create_err = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Server Script",
                data=script_data,
                custom_headers=headers,
                operation_name=f"Create Server Script {script_name}"
            )

            if create_err:
                return False, f"Error creando script {script_name}: {create_err}"

            if create_resp.status_code in [200, 201]:
                print(f"✓ Script {script_name} creado exitosamente")
                return True, f"Script {script_name} creado"
            else:
                return False, f"Error creando script {script_name}: {create_resp.status_code}"

    except Exception as e:
        print(f"Excepción en create_server_script: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return False, f"Excepción: {str(e)}"


def create_account_lock_scripts():
    """
    Crear todos los Server Scripts necesarios para el bloqueo de cuentas por período
    
    Crea scripts para:
    - Payment Entry: validate, before_submit, before_cancel
    - Journal Entry: validate, before_submit, before_cancel
    - Bank Transaction: validate, before_submit, before_cancel, before_update_after_submit
    """
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("\n=== CREANDO SERVER SCRIPTS PARA BLOQUEO DE CUENTAS ===")

        success_count = 0
        errors = []
        created_scripts = []

        # Definir todos los scripts a crear
        scripts_to_create = [
            # Payment Entry scripts
            {
                "name": "Account Lock - Payment Entry - Validate",
                "doctype": "Payment Entry",
                "event": "validate",
                "script": PAYMENT_ENTRY_SCRIPT
            },
            {
                "name": "Account Lock - Payment Entry - Before Submit",
                "doctype": "Payment Entry",
                "event": "before_submit",
                "script": PAYMENT_ENTRY_SCRIPT
            },
            {
                "name": "Account Lock - Payment Entry - Before Cancel",
                "doctype": "Payment Entry",
                "event": "before_cancel",
                "script": PAYMENT_ENTRY_SCRIPT
            },
            
            # Journal Entry scripts
            {
                "name": "Account Lock - Journal Entry - Validate",
                "doctype": "Journal Entry",
                "event": "validate",
                "script": JOURNAL_ENTRY_SCRIPT
            },
            {
                "name": "Account Lock - Journal Entry - Before Submit",
                "doctype": "Journal Entry",
                "event": "before_submit",
                "script": JOURNAL_ENTRY_SCRIPT
            },
            {
                "name": "Account Lock - Journal Entry - Before Cancel",
                "doctype": "Journal Entry",
                "event": "before_cancel",
                "script": JOURNAL_ENTRY_SCRIPT
            },
            
            # Bank Transaction scripts
            {
                "name": "Account Lock - Bank Transaction - Validate",
                "doctype": "Bank Transaction",
                "event": "validate",
                "script": BANK_TRANSACTION_SCRIPT
            },
            {
                "name": "Account Lock - Bank Transaction - Before Submit",
                "doctype": "Bank Transaction",
                "event": "before_submit",
                "script": BANK_TRANSACTION_SCRIPT
            },
            {
                "name": "Account Lock - Bank Transaction - Before Cancel",
                "doctype": "Bank Transaction",
                "event": "before_cancel",
                "script": BANK_TRANSACTION_SCRIPT
            },
            {
                "name": "Account Lock - Bank Transaction - Before Update After Submit",
                "doctype": "Bank Transaction",
                "event": "before_update_after_submit",
                "script": BANK_TRANSACTION_SCRIPT
            }
        ]

        # Crear cada script
        for script_config in scripts_to_create:
            success, message = create_server_script(
                session=session,
                headers=headers,
                script_name=script_config["name"],
                doctype=script_config["doctype"],
                event=script_config["event"],
                script_content=script_config["script"]
            )

            if success:
                success_count += 1
                created_scripts.append(script_config["name"])
            else:
                errors.append(message)

        # Preparar respuesta
        print(f"\n=== RESUMEN: {success_count} scripts procesados exitosamente ===")
        if errors:
            print(f"Errores encontrados: {len(errors)}")
            for error in errors:
                print(f"  - {error}")

        if success_count > 0:
            return jsonify({
                "success": True,
                "message": f"{success_count} Server Scripts creados/actualizados para bloqueo de cuentas",
                "scripts": created_scripts,
                "errors": errors if errors else None
            })
        else:
            return jsonify({
                "success": False,
                "message": "No se pudo crear ningún Server Script",
                "errors": errors
            }), 500

    except Exception as e:
        print(f"Error en create_account_lock_scripts: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": f"Error interno: {str(e)}"
        }), 500


def list_account_lock_scripts():
    """Listar todos los Server Scripts relacionados con bloqueo de cuentas"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Buscar scripts que empiecen con "Account Lock"
        filters_list = [["name", "like", "Account Lock%"]]
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Server Script",
            params={
                "filters": json.dumps(filters_list),
                "fields": json.dumps(["name", "script_type", "reference_doctype", "doctype_event", "enabled"]),
                "limit_page_length": 100
            },
            operation_name="List Account Lock Scripts"
        )

        if err:
            return jsonify({
                "success": False,
                "message": f"Error listando scripts: {err}"
            }), 500

        if resp.status_code == 200:
            scripts = resp.json().get("data", [])
            return jsonify({
                "success": True,
                "scripts": scripts,
                "count": len(scripts)
            })
        else:
            return jsonify({
                "success": False,
                "message": f"Error: {resp.status_code}"
            }), resp.status_code

    except Exception as e:
        print(f"Error en list_account_lock_scripts: {e}")
        return jsonify({
            "success": False,
            "message": f"Error interno: {str(e)}"
        }), 500


def delete_account_lock_scripts():
    """Eliminar todos los Server Scripts relacionados con bloqueo de cuentas"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Primero listar los scripts
        filters_list = [["name", "like", "Account Lock%"]]
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Server Script",
            params={
                "filters": json.dumps(filters_list),
                "fields": json.dumps(["name"]),
                "limit_page_length": 100
            },
            operation_name="List Account Lock Scripts for Deletion"
        )

        if err:
            return jsonify({
                "success": False,
                "message": f"Error listando scripts: {err}"
            }), 500

        scripts = resp.json().get("data", []) if resp.status_code == 200 else []
        
        deleted_count = 0
        errors = []

        # Eliminar cada script
        for script in scripts:
            script_name = script.get("name")
            delete_resp, delete_err = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Server Script/{script_name}",
                custom_headers=headers,
                operation_name=f"Delete Server Script {script_name}"
            )

            if delete_err:
                errors.append(f"Error eliminando {script_name}: {delete_err}")
            elif delete_resp.status_code in [200, 202]:
                deleted_count += 1
                print(f"✓ Script {script_name} eliminado")
            else:
                errors.append(f"Error eliminando {script_name}: {delete_resp.status_code}")

        return jsonify({
            "success": deleted_count > 0,
            "message": f"{deleted_count} scripts eliminados",
            "deleted_count": deleted_count,
            "errors": errors if errors else None
        })

    except Exception as e:
        print(f"Error en delete_account_lock_scripts: {e}")
        return jsonify({
            "success": False,
            "message": f"Error interno: {str(e)}"
        }), 500
