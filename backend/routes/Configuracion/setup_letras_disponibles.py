"""
ERPNext AFIP Setup Module - Setup Letras Disponibles

This module handles the setup of available letras (letters) for AFIP talonarios.
This includes configuring all available letras for talonario configurations.

Functions:
- clear_letras_disponibles: Configure all available letras for talonarios
"""

from flask import jsonify
from config import ERPNEXT_URL
from routes.auth_utils import get_session_with_auth
from urllib.parse import quote
import json
from utils.http_utils import make_erpnext_request, handle_erpnext_error


def clear_letras_disponibles():
    """Configurar letras disponibles para los talonarios AFIP"""
    print("\n--- Configurando letras disponibles para talonarios AFIP ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response[0]  # Devolver solo el jsonify response, no la tupla completa

    try:
        # Definir las letras disponibles para AFIP
        letras_disponibles = [
            {"letra": "A", "descripcion": "Factura A"},
            {"letra": "B", "descripcion": "Factura B"},
            {"letra": "C", "descripcion": "Factura C"},
            {"letra": "E", "descripcion": "Factura E"},
            {"letra": "M", "descripcion": "Factura M"},
            {"letra": "X", "descripcion": "Factura X"},
            {"letra": "T", "descripcion": "Factura T"},
            {"letra": "R", "descripcion": "Factura R"}
        ]

        # NO modificar registros de Talonario existentes: el comportamiento deseado
        # es únicamente asegurar que el DocType/estructura soporte las letras disponibles
        # (la definición del DocType y su tabla hija 'Talonario Letra' se gestiona
        # en setup_afip_doctypes.py). Aquí simplemente devolvemos la lista de
        # letras que consideramos "disponibles" para uso en nuevas configuraciones.

        print("No se modificarán los registros de Talonario existentes; solo se devolverá la lista de letras disponibles.")

        return jsonify({
            "success": True,
            "message": "Letras disponibles (no modificadas en talonarios existentes)",
            "configured": 0,
            "letras": [letra["letra"] for letra in letras_disponibles]
        })

    except Exception as e:
        print(f"Error configurando letras disponibles: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500