"""
ERPNext AFIP Setup Module - Naming Series

This module handles the creation of naming series for AFIP documents.
This includes setting up automatic numbering for invoices, receipts, and other documents.

Functions:
- create_naming_series: Create naming series for AFIP documents
"""

from flask import jsonify
from config import ERPNEXT_URL
from routes.auth_utils import get_session_with_auth


def create_naming_series():
    """Crear series de numeración para documentos AFIP
    
    Nota: Las series de numeración se generan automáticamente en los talonarios
    cuando se crean. No es necesario crear series globales adicionales.
    """
    print("\n--- Series de numeración AFIP ---")
    print("Las series de numeración se generan automáticamente en los talonarios.")
    print("No es necesario crear series globales adicionales.")
    
    return jsonify({
        "success": True,
        "message": "Series de numeración se manejan automáticamente en talonarios",
        "note": "La numeración se genera dinámicamente según la configuración del talonario"
    })