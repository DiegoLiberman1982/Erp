"""
Purchase Perceptions Module
===========================

Módulo centralizado para el manejo de percepciones de compra en Argentina.
Las percepciones se guardan como filas en Purchase Taxes and Charges de ERPNext.

Tipos de percepciones soportados:
- INGRESOS_BRUTOS: Siempre vinculadas a una provincia
- IVA: Internas o aduaneras, nunca vinculadas a provincia
- GANANCIAS: Internas o aduaneras, nunca vinculadas a provincia

Cada percepción se convierte en una fila de Purchase Taxes and Charges con:
- Campos nativos: charge_type, tax_amount, rate, account_head, description
- Campos custom: custom_is_perception, custom_perception_type, custom_perception_scope,
                 custom_province_code, custom_province_name, custom_regimen_code, custom_percentage
"""

from flask import Blueprint, request, jsonify
import os
import json
from typing import Dict, List, Optional, Tuple, Any

# Importar configuración
from config import ERPNEXT_URL

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para las rutas de percepciones de compra
purchase_perceptions_bp = Blueprint('purchase_perceptions', __name__)

# ============================================================================
# CACHE Y CARGA DE CONFIGURACIÓN
# ============================================================================

_argentina_perceptions_config: Optional[Dict[str, Any]] = None


def _get_config_path() -> str:
    """Obtener la ruta al archivo de configuración de percepciones."""
    # El archivo está en shared/argentina_perceptions.json
    current_dir = os.path.dirname(__file__)
    return os.path.join(current_dir, '..', '..', 'shared', 'argentina_perceptions.json')


def load_argentina_perceptions_config() -> Dict[str, Any]:
    """
    Cargar la configuración de percepciones de Argentina desde el JSON.
    Se cachea en memoria para evitar lecturas repetidas.
    
    Returns:
        Dict con la configuración de percepciones
    """
    global _argentina_perceptions_config
    
    if _argentina_perceptions_config is not None:
        return _argentina_perceptions_config
    
    config_path = _get_config_path()
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            _argentina_perceptions_config = json.load(f)
            print(f"--- Percepciones config: loaded from {config_path}")
            return _argentina_perceptions_config
    except FileNotFoundError:
        print(f"--- Percepciones config: ERROR - file not found: {config_path}")
        return {"companies": {}, "provinces": {}}
    except json.JSONDecodeError as e:
        print(f"--- Percepciones config: ERROR - invalid JSON: {e}")
        return {"companies": {}, "provinces": {}}


def reload_argentina_perceptions_config() -> Dict[str, Any]:
    """Forzar recarga de la configuración desde disco."""
    global _argentina_perceptions_config
    _argentina_perceptions_config = None
    return load_argentina_perceptions_config()


# ============================================================================
# HELPERS DE CONFIGURACIÓN
# ============================================================================

def get_province_name(province_code: str) -> str:
    """
    Obtener el nombre legible de una provincia a partir de su código.
    
    Args:
        province_code: Código ISO de la provincia (ej: "AR-B")
    
    Returns:
        Nombre de la provincia o el código si no se encuentra
    """
    if not province_code:
        return ""
    
    config = load_argentina_perceptions_config()
    provinces = config.get("provinces", {})
    
    return provinces.get(province_code, province_code)


def _get_tax_account_from_map(
    session,
    company: str,
    perception_type: str,
    transaction_type: str,
    province_code: Optional[str] = None
) -> Optional[str]:
    """
    Buscar la cuenta contable en el DocType Tax Account Map.
    
    Args:
        session: Sesión de requests autenticada
        company: Nombre de la compañía en ERPNext
        perception_type: Tipo en Tax Account Map (PERCEPCION_IIBB, RETENCION_IIBB, etc.)
        transaction_type: 'purchase' o 'sale'
        province_code: Código de provincia (solo para IIBB, ej: "902" para Buenos Aires)
    
    Returns:
        Nombre completo de la cuenta contable (Link a Account) o None
    """
    import json
    
    # Construir filtros
    filters = [
        ["company", "=", company],
        ["perception_type", "=", perception_type],
        ["transaction_type", "=", transaction_type]
    ]
    
    # Para IIBB, agregar filtro de provincia
    if province_code and 'IIBB' in perception_type:
        filters.append(["province_code", "=", province_code])
    
    params = {
        "filters": json.dumps(filters),
        "fields": json.dumps(["account"]),
        "limit_page_length": 1
    }
    
    try:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Tax Account Map",
            params=params,
            operation_name=f"Get Tax Account Map for {perception_type}/{province_code or 'N/A'}"
        )
        
        if err or resp.status_code != 200:
            print(f"--- _get_tax_account_from_map: error fetching - {err or resp.status_code}")
            return None
        
        data = resp.json().get("data", [])
        if data and data[0].get("account"):
            account = data[0]["account"]
            print(f"--- _get_tax_account_from_map: found {perception_type}/{province_code or 'N/A'} -> {account}")
            return account
        
        print(f"--- _get_tax_account_from_map: no mapping found for {perception_type}/{province_code or 'N/A'}")
        return None
        
    except Exception as e:
        print(f"--- _get_tax_account_from_map: exception - {e}")
        return None


def get_perception_account(
    company: str,
    perception_type: str,
    province_code: Optional[str] = None,
    regimen_code: Optional[str] = None,
    company_abbr: Optional[str] = None,
    session = None
) -> Optional[str]:
    """
    Resolver la cuenta contable para una percepción desde el Tax Account Map.
    
    Args:
        company: Nombre de la compañía en ERPNext
        perception_type: Tipo de percepción (INGRESOS_BRUTOS, IVA, GANANCIAS)
        province_code: Código de provincia (solo para IIBB, ej: "902" o "AR-B")
        regimen_code: Código de régimen (opcional, informativo)
        company_abbr: Abreviatura de la empresa (no usado, mantenido por compatibilidad)
        session: Sesión de requests autenticada para buscar en Tax Account Map
    
    Returns:
        Nombre completo de la cuenta contable o None si no se encuentra
        
    Note:
        Esta función busca en el DocType Tax Account Map que se configura en
        Configuración > Datos Impositivos > Mapeo de Cuentas Contables.
        
        Mapeo de perception_type viejo a nuevo:
        - INGRESOS_BRUTOS -> PERCEPCION_IIBB (para compras)
        - IVA -> PERCEPCION_IVA (para compras)
        - GANANCIAS -> PERCEPCION_GANANCIAS (para compras)
    """
    if not session:
        print(f"--- get_perception_account: no session provided, cannot query Tax Account Map")
        return None
    
    # Mapear tipo viejo a nuevo tipo en Tax Account Map
    # Las percepciones de compra usan transaction_type='purchase'
    type_mapping = {
        'INGRESOS_BRUTOS': 'PERCEPCION_IIBB',
        'IVA': 'PERCEPCION_IVA',
        'GANANCIAS': 'PERCEPCION_GANANCIAS'
    }
    
    tax_map_type = type_mapping.get(perception_type, perception_type)
    
    # Normalizar province_code: convertir AR-X a código numérico si es necesario
    normalized_province = province_code
    if province_code and province_code.startswith('AR-'):
        # Mapeo de códigos ISO a códigos numéricos
        iso_to_numeric = {
            'AR-B': '902',  # Buenos Aires
            'AR-C': '901',  # CABA
            'AR-K': '903',  # Catamarca
            'AR-X': '904',  # Córdoba
            'AR-W': '905',  # Corrientes
            'AR-H': '906',  # Chaco
            'AR-U': '907',  # Chubut
            'AR-E': '908',  # Entre Ríos
            'AR-P': '909',  # Formosa
            'AR-Y': '910',  # Jujuy
            'AR-L': '911',  # La Pampa
            'AR-F': '912',  # La Rioja
            'AR-M': '913',  # Mendoza
            'AR-N': '914',  # Misiones
            'AR-Q': '915',  # Neuquén
            'AR-R': '916',  # Río Negro
            'AR-A': '917',  # Salta
            'AR-J': '918',  # San Juan
            'AR-D': '919',  # San Luis
            'AR-Z': '920',  # Santa Cruz
            'AR-S': '921',  # Santa Fe
            'AR-G': '922',  # Santiago del Estero
            'AR-V': '923',  # Tierra del Fuego
            'AR-T': '924',  # Tucumán
        }
        normalized_province = iso_to_numeric.get(province_code, province_code)
    
    # Buscar en Tax Account Map
    account = _get_tax_account_from_map(
        session=session,
        company=company,
        perception_type=tax_map_type,
        transaction_type='purchase',  # Las percepciones de compra siempre son purchase
        province_code=normalized_province
    )
    
    if account:
        return account
    
    # Si no se encontró en Tax Account Map, retornar None
    # NO usamos fallback al JSON - el mapeo debe existir en Tax Account Map
    print(f"--- get_perception_account: no mapping found in Tax Account Map for {perception_type}/{province_code}")
    return None


def get_perception_default_percentage(
    company: str,
    perception_type: str,
    province_code: Optional[str] = None
) -> Optional[float]:
    """
    Obtener el porcentaje por defecto para una percepción.
    
    Returns:
        Porcentaje por defecto o None si no está configurado
    """
    config = load_argentina_perceptions_config()
    companies = config.get("companies", {})
    
    company_config = companies.get(company, companies.get("_default", {}))
    type_config = company_config.get(perception_type, {})
    
    if perception_type in ("IVA", "GANANCIAS"):
        return type_config.get("default_percentage")
    
    if perception_type == "INGRESOS_BRUTOS" and province_code:
        province_config = type_config.get(province_code, type_config.get("_any_province", {}))
        return province_config.get("default_percentage")
    
    return None


def get_available_provinces() -> Dict[str, str]:
    """
    Obtener diccionario de provincias disponibles.
    
    Returns:
        Dict con código -> nombre de provincia
    """
    config = load_argentina_perceptions_config()
    return config.get("provinces", {})


# ============================================================================
# VALIDACIÓN DE PERCEPCIONES
# ============================================================================

class PerceptionValidationError(Exception):
    """Error de validación de percepción."""
    def __init__(self, message: str, field: str = None):
        self.message = message
        self.field = field
        super().__init__(message)


def validate_perception(perception: Dict[str, Any]) -> None:
    """
    Validar una percepción según las reglas de negocio.
    
    Reglas:
    - perception_type obligatorio: INGRESOS_BRUTOS, IVA, GANANCIAS
    - total_amount obligatorio
    - Si perception_type == INGRESOS_BRUTOS -> province_code obligatorio
    - Si perception_type in (IVA, GANANCIAS) -> province_code debe ser None/vacío
    
    Raises:
        PerceptionValidationError: Si la validación falla
    """
    perception_type = perception.get("perception_type", "").upper()
    province_code = perception.get("province_code")
    total_amount = perception.get("total_amount")
    
    # Validar tipo de percepción
    valid_types = ("INGRESOS_BRUTOS", "IVA", "GANANCIAS")
    if not perception_type or perception_type not in valid_types:
        raise PerceptionValidationError(
            f"Tipo de percepción inválido: '{perception_type}'. Debe ser uno de: {valid_types}",
            field="perception_type"
        )
    
    # Validar total_amount
    if total_amount is None:
        raise PerceptionValidationError(
            "El importe total (total_amount) es obligatorio",
            field="total_amount"
        )
    
    try:
        total_amount = float(total_amount)
    except (ValueError, TypeError):
        raise PerceptionValidationError(
            f"Importe total inválido: '{total_amount}'",
            field="total_amount"
        )
    
    # Validar provincia según tipo
    if perception_type == "INGRESOS_BRUTOS":
        if not province_code or not str(province_code).strip():
            raise PerceptionValidationError(
                "Percepciones de Ingresos Brutos requieren province_code (código 901-924)",
                field="province_code"
            )
    else:
        # IVA y GANANCIAS no deben tener provincia
        if province_code and str(province_code).strip():
            raise PerceptionValidationError(
                f"Percepciones de {perception_type} no pueden tener province_code (recibido: {province_code})",
                field="province_code"
            )


def validate_perceptions_list(perceptions: List[Dict[str, Any]]) -> List[str]:
    """
    Validar una lista de percepciones.
    
    Returns:
        Lista de errores encontrados (vacía si todo OK)
    """
    errors = []
    
    for i, perception in enumerate(perceptions):
        try:
            validate_perception(perception)
        except PerceptionValidationError as e:
            errors.append(f"Percepción #{i+1}: {e.message}")
    
    return errors


# ============================================================================
# CONSTRUCCIÓN DE TAXES PARA ERPNEXT
# ============================================================================

def build_perception_description(
    perception_type: str,
    province_name: Optional[str] = None,
    regimen_code: Optional[str] = None,
    percentage: Optional[float] = None
) -> str:
    """
    Construir descripción legible para la fila de impuesto.
    
    Ejemplos:
    - "Percepción IIBB Buenos Aires RG 1234 (3%)"
    - "Percepción IVA RG 2126 (1%)"
    - "Percepción Ganancias RG 4815 (6%)"
    """
    # Mapeo de tipos a nombres legibles
    type_names = {
        "INGRESOS_BRUTOS": "IIBB",
        "IVA": "IVA",
        "GANANCIAS": "Ganancias"
    }
    
    type_name = type_names.get(perception_type, perception_type)
    
    parts = [f"Percepción {type_name}"]
    
    # Agregar provincia si es IIBB
    if perception_type == "INGRESOS_BRUTOS" and province_name:
        parts.append(province_name)
    
    # Agregar régimen si existe
    if regimen_code:
        parts.append(regimen_code)
    
    description = " ".join(parts)
    
    # Agregar porcentaje si existe
    if percentage is not None:
        description += f" ({percentage}%)"
    
    return description


def build_purchase_perception_tax(
    company: str,
    perception: Dict[str, Any],
    company_abbr: Optional[str] = None,
    session = None
) -> Dict[str, Any]:
    """
    Construir una fila de Purchase Taxes and Charges para una percepción.
    
    Args:
        company: Nombre de la compañía en ERPNext
        perception: Dict con datos de la percepción del frontend
        company_abbr: Abreviatura de la empresa (no usado, mantenido por compatibilidad)
        session: Sesión de requests autenticada para buscar en Tax Account Map
    
    Returns:
        Dict listo para incluir en el array 'taxes' de Purchase Invoice
    
    Raises:
        PerceptionValidationError: Si la percepción no es válida
    """
    # Validar primero
    validate_perception(perception)
    
    # Extraer datos normalizados
    perception_type = perception.get("perception_type", "").upper()
    province_code = str(perception.get("province_code", "")).strip() if perception.get("province_code") else None
    regimen_code = perception.get("regimen_code", "").strip() if perception.get("regimen_code") else None
    percentage = perception.get("percentage")
    base_amount = perception.get("base_amount")
    total_amount = float(perception.get("total_amount", 0))
    account_code = perception.get("account_code", "").strip() if perception.get("account_code") else None
    
    # Normalizar porcentaje
    if percentage is not None:
        try:
            percentage = float(percentage)
        except (ValueError, TypeError):
            percentage = None
    
    # Normalizar base
    if base_amount is not None:
        try:
            base_amount = float(base_amount)
        except (ValueError, TypeError):
            base_amount = None
    
    # Resolver cuenta contable
    if account_code:
        account_head = account_code
        print(f"--- build_perception_tax: using account from payload: {account_head}")
    else:
        account_head = get_perception_account(
            company=company,
            perception_type=perception_type,
            province_code=province_code,
            regimen_code=regimen_code,
            company_abbr=company_abbr,
            session=session
        )
        if not account_head:
            raise PerceptionValidationError(
                f"No se pudo resolver la cuenta contable para {perception_type}/{province_code or 'N/A'}. "
                f"Configure el mapeo en Configuración > Datos Impositivos > Mapeo de Cuentas Contables.",
                field="account_head"
            )
    
    # Obtener nombre de provincia
    province_name = get_province_name(province_code) if province_code else None
    
    # Construir descripción
    description = build_perception_description(
        perception_type=perception_type,
        province_name=province_name,
        regimen_code=regimen_code,
        percentage=percentage
    )
    
    # Construir la fila de tax para ERPNext
    tax_row = {
        # Campos nativos de Purchase Taxes and Charges
        "charge_type": "Actual",  # Importe fijo, no calculado
        "tax_amount": total_amount,
        "rate": percentage if percentage is not None else 0,
        "account_head": account_head,
        "description": description,
        "add_deduct_tax": "Add",  # Las percepciones suman al total
        "included_in_print_rate": 0,
        
        # Campos custom para identificar la percepción
        "custom_is_perception": 1,
        "custom_perception_type": perception_type,
        "custom_province_code": province_code or "",
        "custom_province_name": province_name or "",
        "custom_regimen_code": regimen_code or "",
        "custom_percentage": percentage if percentage is not None else 0
    }
    
    print(f"--- build_perception_tax: built tax row for {description} -> {account_head} = {total_amount}")
    
    return tax_row


def build_purchase_perception_taxes(
    company: str,
    perceptions: List[Dict[str, Any]],
    company_abbr: Optional[str] = None,
    session = None
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Construir lista de filas de impuestos para múltiples percepciones.
    
    Args:
        company: Nombre de la compañía en ERPNext
        perceptions: Lista de percepciones del frontend
        company_abbr: Abreviatura de la empresa (no usado, mantenido por compatibilidad)
        session: Sesión de requests autenticada para buscar en Tax Account Map
    
    Returns:
        Tuple de (lista de tax rows, lista de errores)
    """
    if not perceptions:
        return [], []
    
    tax_rows = []
    errors = []
    
    for i, perception in enumerate(perceptions):
        try:
            tax_row = build_purchase_perception_tax(company, perception, company_abbr, session)
            tax_rows.append(tax_row)
        except PerceptionValidationError as e:
            errors.append(f"Percepción #{i+1}: {e.message}")
        except Exception as e:
            errors.append(f"Percepción #{i+1}: Error inesperado - {str(e)}")
    
    print(f"--- build_purchase_perception_taxes: built {len(tax_rows)} tax rows, {len(errors)} errors")
    
    return tax_rows, errors


# ============================================================================
# EXTRACCIÓN DE PERCEPCIONES DE UNA FACTURA EXISTENTE
# ============================================================================

def extract_perceptions_from_taxes(taxes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Extraer percepciones del array de taxes de una Purchase Invoice existente.
    
    Args:
        taxes: Array de taxes de la factura
    
    Returns:
        Lista de percepciones en formato del frontend
    """
    perceptions = []
    
    for tax in taxes:
        # Verificar si es una percepción
        if not tax.get("custom_is_perception"):
            continue
        
        perception = {
            "perception_type": tax.get("custom_perception_type", ""),
            "province_code": tax.get("custom_province_code", "") or None,
            "province_name": tax.get("custom_province_name", ""),
            "regimen_code": tax.get("custom_regimen_code", "") or None,
            "percentage": tax.get("custom_percentage") or tax.get("rate"),
            "total_amount": tax.get("tax_amount", 0),
            "base_amount": None,  # No se puede recuperar fácilmente
            "account_code": tax.get("account_head", ""),
            "description": tax.get("description", "")
        }
        
        perceptions.append(perception)
    
    return perceptions


# ============================================================================
# ENDPOINTS API
# ============================================================================

@purchase_perceptions_bp.route('/api/purchase-perceptions/config', methods=['GET'])
def get_perceptions_config():
    """
    Obtener configuración de percepciones para el frontend.
    Devuelve provincias, tipos y regímenes disponibles.
    """
    print("--- GET /api/purchase-perceptions/config")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        config = load_argentina_perceptions_config()
        
        # Filtrar _doc del diccionario de provincias
        provinces_dict = {k: v for k, v in config.get("provinces", {}).items() if k != "_doc"}
        
        response_data = {
            "perception_types": [
                {"code": "INGRESOS_BRUTOS", "name": "Ingresos Brutos", "requires_province": True},
                {"code": "IVA", "name": "IVA", "requires_province": False},
                {"code": "GANANCIAS", "name": "Ganancias", "requires_province": False}
            ],
            "provinces": [
                {"code": code, "name": name}
                for code, name in sorted(provinces_dict.items(), key=lambda x: x[1])
            ],
            "regimens": config.get("regimens", {})
        }
        
        print("--- GET /api/purchase-perceptions/config: success")
        return jsonify({
            "success": True,
            "data": response_data
        })
    
    except Exception as e:
        print(f"--- GET /api/purchase-perceptions/config: error - {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error obteniendo configuración: {str(e)}"
        }), 500


@purchase_perceptions_bp.route('/api/purchase-perceptions/validate', methods=['POST'])
def validate_perceptions_endpoint():
    """
    Validar una lista de percepciones antes de crear la factura.
    Útil para validación en tiempo real en el frontend.
    """
    print("--- POST /api/purchase-perceptions/validate")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.get_json()
        perceptions = data.get("perceptions", [])
        
        errors = validate_perceptions_list(perceptions)
        
        if errors:
            return jsonify({
                "success": False,
                "valid": False,
                "errors": errors
            })
        
        return jsonify({
            "success": True,
            "valid": True,
            "message": f"{len(perceptions)} percepciones validadas correctamente"
        })
    
    except Exception as e:
        print(f"--- POST /api/purchase-perceptions/validate: error - {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error validando percepciones: {str(e)}"
        }), 500


@purchase_perceptions_bp.route('/api/purchase-perceptions/build-taxes', methods=['POST'])
def build_taxes_endpoint():
    """
    Construir las filas de taxes a partir de percepciones.
    Endpoint de debugging/preview para verificar cómo quedarán las percepciones en ERPNext.
    """
    print("--- POST /api/purchase-perceptions/build-taxes")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.get_json()
        company = data.get("company")
        perceptions = data.get("perceptions", [])
        
        if not company:
            return jsonify({
                "success": False,
                "message": "El campo 'company' es requerido"
            }), 400
        
        tax_rows, errors = build_purchase_perception_taxes(company, perceptions, session=session)
        
        if errors:
            return jsonify({
                "success": False,
                "message": "Errores en algunas percepciones",
                "errors": errors,
                "tax_rows": tax_rows  # Devolver las que sí se pudieron construir
            }), 400
        
        return jsonify({
            "success": True,
            "message": f"{len(tax_rows)} filas de impuestos construidas",
            "tax_rows": tax_rows
        })
    
    except Exception as e:
        print(f"--- POST /api/purchase-perceptions/build-taxes: error - {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error construyendo taxes: {str(e)}"
        }), 500


@purchase_perceptions_bp.route('/api/purchase-perceptions/reload-config', methods=['POST'])
def reload_config_endpoint():
    """
    Recargar la configuración de percepciones desde disco.
    Útil después de modificar el JSON manualmente.
    """
    print("--- POST /api/purchase-perceptions/reload-config")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        config = reload_argentina_perceptions_config()
        
        return jsonify({
            "success": True,
            "message": "Configuración recargada exitosamente",
            "companies": list(config.get("companies", {}).keys()),
            "provinces_count": len(config.get("provinces", {}))
        })
    
    except Exception as e:
        print(f"--- POST /api/purchase-perceptions/reload-config: error - {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error recargando configuración: {str(e)}"
        }), 500


# ============================================================================
# CONSTRUCCIÓN DE FILAS DE IVA PARA COMPRAS
# ============================================================================

def build_purchase_iva_taxes(
    items: List[Dict[str, Any]],
    company: str,
    company_abbr: Optional[str] = None,
    session = None
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Construir las filas de IVA para facturas de compra.
    
    Cuando hay percepciones u otros taxes, ERPNext NO calcula automáticamente el IVA.
    Esta función construye las filas de IVA explícitas para incluirlas en taxes.
    
    Args:
        items: Lista de items de la factura con qty, rate, iva_percent
        company: Nombre de la compañía
        company_abbr: Abreviatura de la compañía
        session: Sesión de requests autenticada (para buscar cuentas si es necesario)
    
    Returns:
        Tupla (lista de tax rows, lista de errores)
    """
    tax_rows = []
    errors = []
    
    # Agrupar items por tasa de IVA
    iva_groups: Dict[float, float] = {}  # {rate: base_amount}
    
    for item in items:
        qty = float(item.get('qty', 1) or 1)
        rate = float(item.get('rate', 0) or 0)
        iva_percent = float(item.get('iva_percent', 21) or 21)
        
        # Calcular base imponible (cantidad * precio unitario)
        base_amount = qty * rate
        
        # Acumular por tasa de IVA
        if iva_percent not in iva_groups:
            iva_groups[iva_percent] = 0
        iva_groups[iva_percent] += base_amount
    
    # Mapeo de tasas de IVA a cuentas de crédito fiscal
    # Formato: {tasa: sufijo de cuenta}
    iva_account_mapping = {
        0.0: "1.1.4.01.20 - IVA Crédito Fiscal 0.0%",
        2.5: "1.1.4.01.06 - IVA Crédito Fiscal 2.5%",
        5.0: "1.1.4.01.07 - IVA Crédito Fiscal 5.0%",
        10.5: "1.1.4.01.04 - IVA Crédito Fiscal 10.5%",
        21.0: "1.1.4.01.05 - IVA Crédito Fiscal 21.0%",
        27.0: "1.1.4.01.08 - IVA Crédito Fiscal 27.0%"
    }
    
    # Construir una fila de tax por cada tasa de IVA
    for iva_rate, base_amount in iva_groups.items():
        if iva_rate <= 0 or base_amount == 0:
            continue  # No crear fila para IVA 0% o montos cero
        
        # Calcular el monto de IVA
        tax_amount = base_amount * (iva_rate / 100)
        
        # Obtener cuenta de IVA
        base_account = iva_account_mapping.get(iva_rate)
        if not base_account:
            errors.append(f"No hay cuenta IVA mapeada para tasa {iva_rate}%")
            continue
            # Intentar con la tasa más cercana o usar 21% por defecto
            base_account = iva_account_mapping.get(21.0, "1.1.4.01.05 - IVA Crédito Fiscal 21.0%")
        
        # Agregar abreviatura de compañía
        if company_abbr:
            account_head = f"{base_account} - {company_abbr}"
        else:
            account_head = base_account
        
        # Descripción del IVA
        if iva_rate == int(iva_rate):
            description = f"IVA {int(iva_rate)}%"
        else:
            description = f"IVA {iva_rate}%"
        
        tax_row = {
            "charge_type": "On Net Total",
            "rate": iva_rate,
            "tax_amount": round(tax_amount, 2),
            "account_head": account_head,
            "description": description,
            "add_deduct_tax": "Add",
            "included_in_print_rate": 0,
            # Marcar que NO es percepción (es IVA normal)
            "custom_is_perception": 0
        }
        
        tax_rows.append(tax_row)
        print(f"--- build_iva_tax: IVA {iva_rate}% sobre base {base_amount} = {tax_amount} -> {account_head}")
    
    return tax_rows, errors
