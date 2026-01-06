"""
Módulo de validación de documentos duplicados.

Este módulo verifica que no existan documentos duplicados antes de crearlos.
Aplica a: Sales Invoice, Purchase Invoice, Delivery Note, Purchase Receipt.
No aplica a: Sales Order, Purchase Order, Quotation.
"""

from flask import Blueprint, request, jsonify
import json
from urllib.parse import quote

from routes.auth_utils import get_session_with_auth
from utils.http_utils import make_erpnext_request


document_validator_bp = Blueprint('document_validator', __name__)


# Doctypes que requieren validación de duplicados
DOCTYPES_TO_VALIDATE = {
    "Sales Invoice": {
        "prefix_field": "naming_series",  # El campo que contiene el prefijo
        "name_field": "name",
        "docstatus_check": True,  # Solo verificar documentos confirmados (docstatus=1)
    },
    "Purchase Invoice": {
        "prefix_field": "naming_series",
        "name_field": "name",
        "docstatus_check": True,
    },
    "Delivery Note": {
        "prefix_field": "naming_series",
        "name_field": "name",
        "docstatus_check": True,
    },
    "Purchase Receipt": {
        "prefix_field": "naming_series",
        "name_field": "name",
        "docstatus_check": True,
    },
}


def check_duplicate_document(session, headers, doctype, document_name_prefix):
    """
    Verifica si existe un documento con el prefijo dado y docstatus=1.
    
    Args:
        session: Sesión HTTP autenticada
        headers: Headers de autenticación
        doctype: Tipo de documento (Sales Invoice, Purchase Invoice, etc.)
        document_name_prefix: Prefijo del nombre del documento a verificar
            Por ejemplo: "FE-FAC-A-00004-00000814"
    
    Returns:
        dict: {
            "exists": bool,
            "duplicates": list de nombres de documentos duplicados,
            "message": str mensaje descriptivo
        }
    """
    if doctype not in DOCTYPES_TO_VALIDATE:
        return {
            "exists": False,
            "duplicates": [],
            "message": f"Doctype {doctype} no requiere validación de duplicados"
        }
    
    config = DOCTYPES_TO_VALIDATE[doctype]
    
    try:
        # Construir filtros para buscar documentos que empiecen con el prefijo
        # y tengan docstatus=1 (confirmados)
        filters = [
            ["name", "like", f"{document_name_prefix}%"]
        ]
        
        if config.get("docstatus_check"):
            filters.append(["docstatus", "=", 1])
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{doctype}",
            params={
                "filters": json.dumps(filters),
                "fields": json.dumps(["name", "docstatus"]),
                "limit_page_length": 10  # Limitar resultados
            },
            operation_name=f"Check duplicate {doctype}"
        )
        
        if error:
            print(f"--- Duplicate check error: {error}")
            return {
                "exists": False,
                "duplicates": [],
                "message": "Error al verificar duplicados"
            }
        
        if response.status_code != 200:
            return {
                "exists": False,
                "duplicates": [],
                "message": "Error en respuesta de ERPNext"
            }
        
        data = response.json().get("data", [])
        duplicates = [doc.get("name") for doc in data if doc.get("name")]
        
        if duplicates:
            return {
                "exists": True,
                "duplicates": duplicates,
                "message": f"Ya existe(n) {len(duplicates)} documento(s) confirmado(s) con este número: {', '.join(duplicates)}"
            }
        
        return {
            "exists": False,
            "duplicates": [],
            "message": "No se encontraron duplicados"
        }
        
    except Exception as e:
        print(f"--- Duplicate check exception: {e}")
        return {
            "exists": False,
            "duplicates": [],
            "message": f"Error al verificar duplicados: {str(e)}"
        }


def validate_before_create(session, headers, doctype, document_name):
    """
    Valida que no exista un documento duplicado antes de crearlo.
    
    Args:
        session: Sesión HTTP autenticada
        headers: Headers de autenticación
        doctype: Tipo de documento
        document_name: Nombre completo del documento a crear
            Por ejemplo: "FE-FAC-A-00004-00000814"
    
    Returns:
        tuple: (can_create: bool, message: str, duplicates: list)
    """
    result = check_duplicate_document(session, headers, doctype, document_name)
    
    if result["exists"]:
        return (False, result["message"], result["duplicates"])
    
    return (True, "OK", [])


def validate_invoice_name(session, headers, doctype, naming_series, numero_padded):
    """
    Valida un nombre de factura específico antes de crearla.
    
    Args:
        session: Sesión HTTP autenticada
        headers: Headers de autenticación
        doctype: "Sales Invoice" o "Purchase Invoice"
        naming_series: Serie base, ej: "FE-FAC-A-00004-"
        numero_padded: Número con padding, ej: "00000814"
    
    Returns:
        tuple: (can_create: bool, message: str, duplicates: list)
    """
    # Construir el nombre completo sin el guión final del naming_series
    if naming_series.endswith("-"):
        base_name = naming_series[:-1]  # Quitar el guión final
    else:
        base_name = naming_series
    
    # El nombre a buscar es: FE-FAC-A-00004-00000814
    document_name = f"{base_name}-{numero_padded}" if numero_padded else base_name
    
    return validate_before_create(session, headers, doctype, document_name)


@document_validator_bp.route('/api/validate/duplicate-check', methods=['POST'])
def api_check_duplicate():
    """
    Endpoint para verificar duplicados de documentos.
    
    Body:
    {
        "doctype": "Sales Invoice",
        "name_prefix": "FE-FAC-A-00004-00000814"
    }
    
    O para validación de factura:
    {
        "doctype": "Sales Invoice",
        "naming_series": "FE-FAC-A-00004-",
        "numero": "00000814"
    }
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    payload = request.get_json(silent=True) or {}
    doctype = payload.get("doctype")
    
    if not doctype:
        return jsonify({"success": False, "message": "doctype requerido"}), 400
    
    # Modo 1: Prefijo directo
    if payload.get("name_prefix"):
        result = check_duplicate_document(session, headers, doctype, payload["name_prefix"])
        return jsonify({
            "success": True,
            "exists": result["exists"],
            "duplicates": result["duplicates"],
            "message": result["message"]
        })
    
    # Modo 2: naming_series + numero
    if payload.get("naming_series") and payload.get("numero"):
        can_create, message, duplicates = validate_invoice_name(
            session, headers, doctype,
            payload["naming_series"],
            payload["numero"]
        )
        return jsonify({
            "success": True,
            "can_create": can_create,
            "exists": not can_create,
            "duplicates": duplicates,
            "message": message
        })
    
    return jsonify({
        "success": False,
        "message": "Debe proporcionar name_prefix o (naming_series + numero)"
    }), 400


@document_validator_bp.route('/api/validate/bulk-duplicate-check', methods=['POST'])
def api_bulk_check_duplicates():
    """
    Endpoint para verificar duplicados de múltiples documentos.
    
    Body:
    {
        "doctype": "Sales Invoice",
        "documents": [
            {"naming_series": "FE-FAC-A-00004-", "numero": "00000814"},
            {"naming_series": "FE-FAC-A-00004-", "numero": "00000815"}
        ]
    }
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    payload = request.get_json(silent=True) or {}
    doctype = payload.get("doctype")
    documents = payload.get("documents", [])
    
    if not doctype:
        return jsonify({"success": False, "message": "doctype requerido"}), 400
    
    if not documents:
        return jsonify({"success": False, "message": "documents requerido"}), 400
    
    results = []
    has_duplicates = False
    
    for doc in documents:
        naming_series = doc.get("naming_series", "")
        numero = doc.get("numero", "")
        
        can_create, message, duplicates = validate_invoice_name(
            session, headers, doctype,
            naming_series, numero
        )
        
        result = {
            "naming_series": naming_series,
            "numero": numero,
            "can_create": can_create,
            "duplicates": duplicates,
            "message": message
        }
        results.append(result)
        
        if not can_create:
            has_duplicates = True
    
    return jsonify({
        "success": True,
        "has_duplicates": has_duplicates,
        "results": results,
        "message": f"Verificados {len(documents)} documentos. {'Hay duplicados.' if has_duplicates else 'Sin duplicados.'}"
    })
