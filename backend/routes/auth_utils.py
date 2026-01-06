"""
Utilidades de autenticación centralizadas para evitar duplicación
"""

from flask import request, jsonify
import requests
from config import ERPNEXT_URL, ERPNEXT_HOST

def get_session_with_auth():
    """
    Helper function centralizada para crear una sesión con autenticación
    
    Returns:
        tuple: (session, headers, user_id, error_response)
               Si hay error, error_response será una tupla (response, status_code)
               Si todo está bien, error_response será None
    """
    # Obtener el token SID del header o de las cookies
    sid_token = request.headers.get('X-Session-Token') or request.cookies.get('sid')



    if not sid_token:
        return None, None, None, (jsonify({"success": False, "message": "Sesión no encontrada"}), 401)

    # Usamos una sesión de 'requests' para manejar las cookies automáticamente
    session = requests.Session()
    # Establecer la cookie SID en la sesión
    erp_host = ERPNEXT_HOST if ERPNEXT_HOST else ERPNEXT_URL.split('//')[1].split(':')[0]
    session.cookies.set('sid', sid_token, domain=erp_host)

    # Creamos la cabecera 'Host' para conectarnos a ERPNext
    headers = {"Host": erp_host}

    # Obtener información del usuario actual
    try:
        # Use a separate session for user check to avoid overwriting main session cookies
        user_session = requests.Session()
        user_session.cookies.set('sid', sid_token, domain=erp_host)
        user_response = user_session.get(
            f"{ERPNEXT_URL}/api/method/frappe.auth.get_logged_user",
            headers=headers
        )
        if user_response.status_code == 200:
            user_data = user_response.json()
            user_id = user_data.get("message", f"user_{sid_token[:16]}")
        else:
            user_id = f"user_{sid_token[:16]}"  # Fallback en caso de error
    except Exception as e:
        user_id = f"user_{sid_token[:16]}"  # Fallback en caso de error

    return session, headers, user_id, None