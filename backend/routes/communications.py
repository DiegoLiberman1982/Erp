from flask import Blueprint, request, jsonify
import requests
import json
from urllib.parse import quote
from config import ERPNEXT_URL
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error, is_detailed_logging_enabled

communications_bp = Blueprint('communications', __name__)

@communications_bp.route('/api/communications/email-accounts', methods=['GET'])
def get_email_accounts():
    """
    Obtener todas las cuentas de email configuradas
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener todas las cuentas de email
        email_resp, email_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Email Account",
            params={
                "fields": '["name","email_id","email_account_name","service","enable_outgoing","default_outgoing","smtp_server","smtp_port","use_tls","login_id","creation","modified"]',
                "order_by": "creation desc"
            },
            operation_name="Get email accounts"
        )

        if email_error:
            return handle_erpnext_error(email_error, "Failed to get email accounts")

        email_accounts = []
        if email_resp.status_code == 200:
            email_data = email_resp.json()
            if 'data' in email_data:
                email_accounts = email_data['data']

        print("--- Get email accounts: success")
        return jsonify({
            "success": True,
            "data": email_accounts
        })

    except Exception as e:
        print("--- Get email accounts: error")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@communications_bp.route('/api/communications/email-accounts', methods=['POST'])
def create_email_account():
    """
    Crear una nueva cuenta de email
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()

        # Validar campos requeridos
        required_fields = ['email_id', 'email_account_name', 'service']
        for field in required_fields:
            if field not in data or not data[field]:
                return jsonify({
                    "success": False,
                    "message": f"Campo requerido faltante: {field}"
                }), 400

        # CHECK: si no existen cuentas de email, marcamos esta como cuenta por defecto
        accounts_resp, accounts_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Email Account",
            params={
                "fields": '["name"]',
                "limit_page_length": 1
            },
            operation_name="Check existing email accounts"
        )

        if accounts_error:
            return handle_erpnext_error(accounts_error, "Failed to check existing email accounts")

        has_existing_accounts = False
        if accounts_resp and accounts_resp.status_code == 200:
            try:
                ar = accounts_resp.json()
                has_existing_accounts = len(ar.get('data', [])) > 0
            except Exception:
                has_existing_accounts = True

        # Preparar datos para ERPNext - enviar solo campos esenciales primero para evitar validación SMTP
        # Construir payload evitando incluir keys vacías (especialmente password)
        email_data = {
            "email_id": data['email_id'],
            "email_account_name": data['email_account_name'],
            "service": data['service'],
            "login_id": data.get('login_id', data['email_id']),
            "smtp_server": data.get('smtp_server', ''),
            "smtp_port": data.get('smtp_port', 587),
            "use_tls": data.get('use_tls', 1),
            # No enviar email_sync_option para evitar validación conflictiva con GMail
            # "email_sync_option": data.get('email_sync_option', 'TODOS'),
            # Habilitar outgoing directamente (SMTP ya configurado en el servidor)
            "enable_outgoing": data.get('enable_outgoing', 1),
            # Si no hay cuentas existentes, forzamos que ésta sea la predeterminada
            "default_outgoing": data.get('default_outgoing', 0 if has_existing_accounts else 1)
        }

        # Incluir password sólo si fue provisto y no es vacío
        if 'password' in data and isinstance(data.get('password'), str) and data.get('password').strip() != '':
            email_data['password'] = data.get('password')

        # LOG: Mostrar datos que se van a enviar (solo si logging detallado está habilitado)
        if is_detailed_logging_enabled():
            print("📧 Datos preparados para crear cuenta de email:")
            print(json.dumps(email_data, indent=2))

        # Crear cuenta de email primero sin outgoing para evitar validación SMTP
        create_resp, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Email Account",
            data={"data": email_data},
            operation_name="Create email account (disabled outgoing)"
        )

        if create_error:
            return handle_erpnext_error(create_error, "Failed to create email account")

        # Si la creación fue exitosa, devolver el resultado directamente
        # (no es necesario hacer una actualización separada porque ya habilitamos outgoing)
        if create_resp and create_resp.status_code == 200:
            create_data = create_resp.json()

        print("--- Create email account: success")
        return jsonify({
            "success": True,
            "message": "Cuenta de email creada exitosamente",
            "data": create_resp.json() if create_resp else None
        })

    except Exception as e:
        print("--- Create email account: error")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@communications_bp.route('/api/communications/email-accounts/<email_account_name>', methods=['PUT'])
def update_email_account(email_account_name):
    """
    Actualizar una cuenta de email existente
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()

        # Preparar datos para actualizar
        update_data = {}
        allowed_fields = [
            'email_id', 'email_account_name', 'service', 'enable_outgoing',
            'default_outgoing', 'login_id', 'password', 'smtp_server',
            'smtp_port', 'use_tls'
        ]

        # Sólo incluir campos que vienen explícitamente y no son strings vacíos.
        for field in allowed_fields:
            if field in data:
                val = data.get(field)
                # Si es string y está vacío, no lo enviamos (evita validaciones de ERPNext)
                if isinstance(val, str) and val.strip() == "":
                    continue
                update_data[field] = val

        if not update_data:
            return jsonify({
                "success": False,
                "message": "No se proporcionaron campos para actualizar"
            }), 400

        # Obtener lista de cuentas para aplicar reglas sobre default_outgoing
        accounts_resp, accounts_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Email Account",
            params={
                "fields": '["name","default_outgoing"]',
                "order_by": "creation desc",
                "limit_page_length": 100
            },
            operation_name="List email accounts for update rules"
        )

        if accounts_error:
            return handle_erpnext_error(accounts_error, "Failed to list email accounts for update rules")

        accounts = []
        if accounts_resp and accounts_resp.status_code == 200:
            try:
                accounts = accounts_resp.json().get('data', [])
            except Exception:
                accounts = []

        # If only one account exists, prevent disabling default_outgoing on it
        if len(accounts) <= 1 and 'default_outgoing' in update_data:
            # If trying to set default_outgoing to falsy, ignore it
            try:
                if not bool(int(update_data.get('default_outgoing'))):
                    # remove the field so we don't unset the only default
                    del update_data['default_outgoing']
            except Exception:
                # if cannot parse, just remove it to be safe
                del update_data['default_outgoing']

        # If multiple accounts and this update sets default_outgoing=1, unset others
        if len(accounts) > 1 and update_data.get('default_outgoing') in (1, True, '1', 'true'):
            # For each other account currently marked default, set to 0
            for acct in accounts:
                try:
                    acct_name = acct.get('name')
                    if acct_name and acct_name != email_account_name and acct.get('default_outgoing'):
                        # Update other account to unset default_outgoing
                        _, unset_err = make_erpnext_request(
                            session=session,
                            method="PUT",
                            endpoint=f"/api/resource/Email Account/{quote(acct_name)}",
                            data={"data": {"default_outgoing": 0}},
                            operation_name="Unset default_outgoing on other email account"
                        )
                        if unset_err:
                            # Log but don't fail the whole operation
                            print(f"--- Warning: failed to unset default on {acct_name}: {unset_err}")
                except Exception as e:
                    print(f"--- Warning unsetting other default: {e}")

        # Actualizar cuenta de email
        update_resp, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Email Account/{quote(email_account_name)}",
            data={"data": update_data},
            operation_name="Update email account"
        )

        if update_error:
            return handle_erpnext_error(update_error, "Failed to update email account")

        print("--- Update email account: success")
        return jsonify({
            "success": True,
            "message": "Cuenta de email actualizada exitosamente",
            "data": update_resp.json() if update_resp else None
        })

    except Exception as e:
        print("--- Update email account: error")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@communications_bp.route('/api/communications/email-accounts/<email_account_name>', methods=['DELETE'])
def delete_email_account(email_account_name):
    """
    Eliminar una cuenta de email
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Eliminar cuenta de email
        delete_resp, delete_error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Email Account/{quote(email_account_name)}",
            operation_name="Delete email account"
        )

        if delete_error:
            return handle_erpnext_error(delete_error, "Failed to delete email account")

        print("--- Delete email account: success")
        return jsonify({
            "success": True,
            "message": "Cuenta de email eliminada exitosamente"
        })

    except Exception as e:
        print("--- Delete email account: error")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@communications_bp.route('/api/communications/test-email', methods=['POST'])
def test_email_configuration():
    """
    Probar la configuración de email enviando un email de prueba
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()

        # Validar campos requeridos
        if 'email_account' not in data or not data['email_account']:
            return jsonify({
                "success": False,
                "message": "Cuenta de email requerida para la prueba"
            }), 400

        if 'test_email' not in data or not data['test_email']:
            return jsonify({
                "success": False,
                "message": "Email de destino requerido para la prueba"
            }), 400

        # Preparar datos para enviar email de prueba
        test_data = {
            "recipients": data['test_email'],
            "subject": "Prueba de configuración de email - ERP System",
            "content": f"""
                <p>Este es un email de prueba enviado desde el sistema ERP.</p>
                <p>Si estás viendo este mensaje, la configuración de email está funcionando correctamente.</p>
                <p>Cuenta de email utilizada: {data['email_account']}</p>
                <p>Fecha de envío: {json.dumps({'now': True})}</p>
            """,
            "email_account": data['email_account']
        }

        # Enviar email de prueba
        test_resp, test_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.core.doctype.communication.email.make",
            data={"data": test_data},
            operation_name="Send test email"
        )

        if test_error:
            return handle_erpnext_error(test_error, "Failed to send test email")

        print("--- Test email: success")
        return jsonify({
            "success": True,
            "message": "Email de prueba enviado exitosamente"
        })

    except Exception as e:
        print("--- Test email: error")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500