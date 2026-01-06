"""
Sales Withholdings Module
=========================

Módulo centralizado para el manejo de retenciones SUFRIDAS en cobros de venta (Payment Entry) en Argentina.
Las retenciones se guardan como filas en Payment Entry Deduction de ERPNext.

Tipos de retenciones soportados:
- INGRESOS_BRUTOS: Siempre vinculadas a una provincia (código 901-924)
- IVA: Nunca vinculadas a provincia. El régimen define si es interna/aduanera/etc.
- GANANCIAS: Nunca vinculadas a provincia. El régimen define el tipo.
- SUSS: Nunca vinculadas a provincia.

Cada retención se convierte en una fila de Payment Entry Deduction con:
- Campos nativos: account, amount
- Campos custom: custom_is_withholding, custom_tax_type, custom_province_code,
                 custom_province_name, custom_afip_code, custom_afip_description,
                 custom_regimen, custom_certificate_number, custom_base_amount,
                 custom_percentage, custom_sales_invoice
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

# Crear el blueprint para las rutas de retenciones de venta
sales_withholdings_bp = Blueprint('sales_withholdings', __name__)

# ============================================================================
# CACHE Y CARGA DE CONFIGURACIÓN
# ============================================================================

_argentina_withholdings_config: Optional[Dict[str, Any]] = None


def _get_config_path() -> str:
    """Obtener la ruta al archivo de configuración de retenciones."""
    current_dir = os.path.dirname(__file__)
    # Subir desde routes/ -> backend/ -> proyecto raíz -> shared/
    return os.path.join(current_dir, '..', '..', 'shared', 'argentina_withholdings.json')


def load_argentina_withholdings_config() -> Dict[str, Any]:
    """
    Cargar la configuración de retenciones de Argentina desde el JSON.
    Se cachea en memoria para evitar lecturas repetidas.
    
    Returns:
        Dict con la configuración de retenciones
    """
    global _argentina_withholdings_config
    
    if _argentina_withholdings_config is not None:
        return _argentina_withholdings_config
    
    config_path = _get_config_path()
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            _argentina_withholdings_config = json.load(f)
            print(f"--- Withholdings config: loaded from {config_path}")
            return _argentina_withholdings_config
    except FileNotFoundError:
        print(f"--- Withholdings config: ERROR - file not found: {config_path}")
        return {"companies": {}, "provinces": {}}
    except json.JSONDecodeError as e:
        print(f"--- Withholdings config: ERROR - invalid JSON: {e}")
        return {"companies": {}, "provinces": {}}


def reload_argentina_withholdings_config() -> Dict[str, Any]:
    """Forzar recarga de la configuración desde disco."""
    global _argentina_withholdings_config
    _argentina_withholdings_config = None
    return load_argentina_withholdings_config()


# ============================================================================
# HELPERS DE CONFIGURACIÓN
# ============================================================================

def get_province_name(province_code: str) -> str:
    """
    Obtener el nombre legible de una provincia a partir de su código.
    
    Args:
        province_code: Código de jurisdicción AFIP (ej: "902")
    
    Returns:
        Nombre de la provincia o el código si no se encuentra
    """
    if not province_code:
        return ""
    
    config = load_argentina_withholdings_config()
    provinces = config.get("provinces", {})
    
    return provinces.get(province_code, province_code)


def get_withholding_account(
    company: str,
    tax_type: str,
    province_code: Optional[str] = None,
    regimen_code: Optional[str] = None,
    company_abbr: Optional[str] = None
) -> Optional[str]:
    """
    Resolver la cuenta contable para una retención según la configuración.
    
    Args:
        company: Nombre de la compañía en ERPNext
        tax_type: Tipo de retención (INGRESOS_BRUTOS, IVA, GANANCIAS, SUSS)
        province_code: Código de provincia (solo para IIBB, ej: "902" para Buenos Aires)
        regimen_code: Código de régimen (opcional, informativo)
        company_abbr: Abreviatura de la empresa para construir el nombre completo de cuenta
    
    Returns:
        Nombre de la cuenta contable o None si no se encuentra
    """
    config = load_argentina_withholdings_config()
    companies = config.get("companies", {})
    
    # Buscar primero en la configuración específica de la compañía
    company_config = companies.get(company)
    
    # Si no hay config para la compañía, usar _default
    if not company_config:
        company_config = companies.get("_default", {})
    
    # Obtener config del tipo de retención
    type_config = company_config.get(tax_type, {})
    if not type_config:
        # Fallback a _default
        default_config = companies.get("_default", {})
        type_config = default_config.get(tax_type, {})
    
    account_number = None
    account_name = None
    
    # Para IVA, GANANCIAS y SUSS, la cuenta está directamente en type_config
    if tax_type in ("IVA", "GANANCIAS", "SUSS"):
        account_number = type_config.get("default_account")
        account_name = type_config.get("account_name")
        if not account_number:
            # Fallback a _default
            default_type = companies.get("_default", {}).get(tax_type, {})
            account_number = default_type.get("default_account")
            account_name = default_type.get("account_name")
    
    # Para INGRESOS_BRUTOS, buscar por provincia
    elif tax_type == "INGRESOS_BRUTOS":
        if not province_code:
            print(f"--- get_withholding_account: IIBB requires province_code")
            return None
        
        province_config = type_config.get(province_code, {})
        if province_config:
            account_number = province_config.get("default_account")
            account_name = province_config.get("account_name")
        
        # Si no hay config para la provincia específica, buscar _any_province
        if not account_number:
            any_province = type_config.get("_any_province", {})
            if any_province:
                account_number = any_province.get("default_account")
                account_name = any_province.get("account_name")
        
        # Fallback a _default
        if not account_number:
            default_type = companies.get("_default", {}).get("INGRESOS_BRUTOS", {})
            default_province = default_type.get(province_code, {})
            if default_province:
                account_number = default_province.get("default_account")
                account_name = default_province.get("account_name")
            else:
                default_any = default_type.get("_any_province", {})
                account_number = default_any.get("default_account")
                account_name = default_any.get("account_name")
    
    if not account_number:
        return None
    
    # Construir nombre completo de cuenta para ERPNext
    # Formato: "nombre_cuenta - ABBR" (donde ABBR es la abreviatura de la empresa)
    if company_abbr and account_name:
        full_account_name = f"{account_name} - {company_abbr}"
        print(f"--- get_withholding_account: {tax_type}/{province_code or 'N/A'} -> {full_account_name}")
        return full_account_name
    elif account_name:
        print(f"--- get_withholding_account: {tax_type}/{province_code or 'N/A'} -> {account_name}")
        return account_name
    else:
        print(f"--- get_withholding_account: {tax_type}/{province_code or 'N/A'} -> {account_number} (number only)")
        return account_number


def get_available_provinces() -> Dict[str, str]:
    """
    Obtener diccionario de provincias disponibles.
    
    Returns:
        Dict con código -> nombre de provincia
    """
    config = load_argentina_withholdings_config()
    provinces = config.get("provinces", {})
    # Filtrar _doc
    return {k: v for k, v in provinces.items() if k != "_doc"}


def get_afip_regimen_description(regimen_code: str, tax_type: str = None) -> Optional[str]:
    """
    Obtener la descripción de un régimen AFIP.
    
    Args:
        regimen_code: Código del régimen (ej: "RG830")
        tax_type: Tipo de impuesto para buscar en categoría específica
    
    Returns:
        Descripción del régimen o None si no existe
    """
    config = load_argentina_withholdings_config()
    regimens = config.get("regimens", {})
    
    if tax_type:
        type_regimens = regimens.get(tax_type, {})
        if regimen_code in type_regimens:
            return type_regimens[regimen_code]
    
    # Buscar en todos los tipos
    for type_name, type_regimens in regimens.items():
        if type_name == "_doc":
            continue
        if regimen_code in type_regimens:
            return type_regimens[regimen_code]
    
    return None


# ============================================================================
# VALIDACIÓN DE RETENCIONES
# ============================================================================

class WithholdingValidationError(Exception):
    """Error de validación de retención."""
    def __init__(self, message: str, field: str = None):
        self.message = message
        self.field = field
        super().__init__(message)


def validate_withholding(withholding: Dict[str, Any]) -> None:
    """
    Validar una retención según las reglas de negocio.
    
    Reglas:
    - tax_type obligatorio: INGRESOS_BRUTOS, IVA, GANANCIAS, SUSS
    - total_amount obligatorio
    - Si tax_type == INGRESOS_BRUTOS -> province_code obligatorio
    - Si tax_type in (IVA, GANANCIAS, SUSS) -> province_code debe ser None/vacío
    - base_amount y percentage son opcionales
    
    Raises:
        WithholdingValidationError: Si la validación falla
    """
    tax_type = withholding.get("tax_type", "").upper()
    province_code = withholding.get("province_code")
    total_amount = withholding.get("total_amount")
    
    # Validar tipo de retención
    valid_types = ("INGRESOS_BRUTOS", "IVA", "GANANCIAS", "SUSS")
    if not tax_type or tax_type not in valid_types:
        raise WithholdingValidationError(
            f"Tipo de retención inválido: '{tax_type}'. Debe ser uno de: {valid_types}",
            field="tax_type"
        )
    
    # Validar total_amount
    if total_amount is None:
        raise WithholdingValidationError(
            "El importe total (total_amount) es obligatorio",
            field="total_amount"
        )
    
    try:
        total_amount = float(total_amount)
        if total_amount <= 0:
            raise WithholdingValidationError(
                f"El importe total debe ser mayor a 0: '{total_amount}'",
                field="total_amount"
            )
    except (ValueError, TypeError):
        raise WithholdingValidationError(
            f"Importe total inválido: '{total_amount}'",
            field="total_amount"
        )
    
    # Validar provincia según tipo
    if tax_type == "INGRESOS_BRUTOS":
        if not province_code or not str(province_code).strip():
            raise WithholdingValidationError(
                "Retenciones de Ingresos Brutos requieren province_code (código 901-924)",
                field="province_code"
            )
    else:
        # IVA, GANANCIAS y SUSS no deben tener provincia
        if province_code and str(province_code).strip():
            raise WithholdingValidationError(
                f"Retenciones de {tax_type} no pueden tener province_code (recibido: {province_code})",
                field="province_code"
            )


def validate_withholdings_list(withholdings: List[Dict[str, Any]]) -> List[str]:
    """
    Validar una lista de retenciones.
    
    Returns:
        Lista de errores encontrados (vacía si todo OK)
    """
    errors = []
    
    for i, withholding in enumerate(withholdings):
        try:
            validate_withholding(withholding)
        except WithholdingValidationError as e:
            errors.append(f"Retención #{i+1}: {e.message}")
    
    return errors


# ============================================================================
# CONSTRUCCIÓN DE DEDUCTIONS PARA ERPNEXT
# ============================================================================

def build_withholding_description(
    tax_type: str,
    province_name: Optional[str] = None,
    regimen: Optional[str] = None,
    certificate_number: Optional[str] = None,
    percentage: Optional[float] = None
) -> str:
    """
    Construir descripción legible para la fila de deducción.
    
    Ejemplos:
    - "Retención IIBB Buenos Aires RG 1234 Cert. 0001-00000001 (3%)"
    - "Retención IVA RG 2126 (1%)"
    - "Retención Ganancias RG 830"
    - "Retención SUSS"
    """
    type_names = {
        "INGRESOS_BRUTOS": "IIBB",
        "IVA": "IVA",
        "GANANCIAS": "Ganancias",
        "SUSS": "SUSS"
    }
    
    type_name = type_names.get(tax_type, tax_type)
    
    parts = [f"Retención {type_name}"]
    
    # Agregar provincia si es IIBB
    if tax_type == "INGRESOS_BRUTOS" and province_name:
        parts.append(province_name)
    
    # Agregar régimen si existe
    if regimen:
        parts.append(regimen)
    
    # Agregar número de certificado si existe
    if certificate_number:
        parts.append(f"Cert. {certificate_number}")
    
    description = " ".join(parts)
    
    # Agregar porcentaje si existe
    if percentage is not None:
        description += f" ({percentage}%)"
    
    return description


def build_payment_entry_deduction(
    company: str,
    withholding: Dict[str, Any],
    company_abbr: Optional[str] = None
) -> Dict[str, Any]:
    """
    Construir una fila de Payment Entry Deduction para una retención.
    
    Args:
        company: Nombre de la compañía en ERPNext
        withholding: Dict con datos de la retención del frontend
        company_abbr: Abreviatura de la empresa para construir nombre de cuenta
    
    Returns:
        Dict listo para incluir en el array 'deductions' de Payment Entry
    
    Raises:
        WithholdingValidationError: Si la retención no es válida
    """
    # Validar primero
    validate_withholding(withholding)
    
    # Extraer datos normalizados
    tax_type = withholding.get("tax_type", "").upper()
    province_code = str(withholding.get("province_code", "")).strip() if withholding.get("province_code") else None
    afip_code = withholding.get("afip_code", "").strip() if withholding.get("afip_code") else None
    afip_description = withholding.get("afip_description", "").strip() if withholding.get("afip_description") else None
    regimen = withholding.get("regimen", "").strip() if withholding.get("regimen") else None
    certificate_number = withholding.get("certificate_number", "").strip() if withholding.get("certificate_number") else None
    percentage = withholding.get("percentage")
    base_amount = withholding.get("base_amount")
    total_amount = float(withholding.get("total_amount", 0))
    account_code = withholding.get("account_code", "").strip() if withholding.get("account_code") else None
    sales_invoice = withholding.get("sales_invoice", "").strip() if withholding.get("sales_invoice") else None
    
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
        account = account_code
        print(f"--- build_payment_entry_deduction: using account from payload: {account}")
    else:
        account = get_withholding_account(
            company=company,
            tax_type=tax_type,
            province_code=province_code,
            regimen_code=regimen,
            company_abbr=company_abbr
        )
        if not account:
            raise WithholdingValidationError(
                f"No se pudo resolver la cuenta contable para {tax_type}/{province_code or 'N/A'}",
                field="account"
            )
    
    # Obtener nombre de provincia
    province_name = get_province_name(province_code) if province_code else None
    
    # Construir descripción si no viene afip_description
    if not afip_description:
        afip_description = build_withholding_description(
            tax_type=tax_type,
            province_name=province_name,
            regimen=regimen,
            certificate_number=certificate_number,
            percentage=percentage
        )
    
    # Construir la fila de deduction para ERPNext
    deduction_row = {
        # Campos nativos de Payment Entry Deduction
        "account": account,
        "amount": total_amount,
        
        # Campos custom para identificar la retención
        "custom_is_withholding": 1,
        "custom_tax_type": tax_type,
        "custom_province_code": province_code or "",
        "custom_province_name": province_name or "",
        "custom_afip_code": afip_code or "",
        "custom_afip_description": afip_description or "",
        "custom_regimen": regimen or "",
        "custom_certificate_number": certificate_number or "",
        "custom_base_amount": base_amount if base_amount is not None else 0,
        "custom_percentage": percentage if percentage is not None else 0,
        "custom_sales_invoice": sales_invoice or ""
    }
    
    print(f"--- build_payment_entry_deduction: built deduction row for {afip_description} -> {account} = {total_amount}")
    
    return deduction_row


def build_payment_entry_withholdings(
    company: str,
    customer: str,
    withholdings: List[Dict[str, Any]],
    references: List[Dict[str, Any]],
    company_abbr: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Construir lista de filas de deductions para múltiples retenciones.
    
    Args:
        company: Nombre de la compañía en ERPNext
        customer: Nombre del cliente
        withholdings: Lista de retenciones del frontend
        references: Lista de referencias del Payment Entry (facturas)
        company_abbr: Abreviatura de la empresa para construir nombres de cuenta
    
    Returns:
        Tuple de (lista de deduction rows, lista de errores)
    """
    if not withholdings:
        return [], []
    
    deduction_rows = []
    errors = []
    
    # Calcular total de referencias para validación básica
    total_references = sum(
        float(ref.get("allocated_amount", 0)) 
        for ref in references
    ) if references else 0
    
    # Calcular total de retenciones
    total_withholdings = sum(
        float(w.get("total_amount", 0)) 
        for w in withholdings
    )
    
    # Validación básica: las retenciones no pueden superar el total de las facturas
    if total_references > 0 and total_withholdings > total_references:
        errors.append(
            f"El total de retenciones ({total_withholdings:.2f}) supera el total aplicado a facturas ({total_references:.2f})"
        )
    
    for i, withholding in enumerate(withholdings):
        try:
            deduction_row = build_payment_entry_deduction(company, withholding, company_abbr)
            deduction_rows.append(deduction_row)
        except WithholdingValidationError as e:
            errors.append(f"Retención #{i+1}: {e.message}")
        except Exception as e:
            errors.append(f"Retención #{i+1}: Error inesperado - {str(e)}")
    
    print(f"--- build_payment_entry_withholdings: built {len(deduction_rows)} deduction rows, {len(errors)} errors")
    
    return deduction_rows, errors


# ============================================================================
# EXTRACCIÓN DE RETENCIONES DE UN PAYMENT ENTRY EXISTENTE
# ============================================================================

def extract_withholdings_from_deductions(deductions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Extraer retenciones del array de deductions de un Payment Entry existente.
    
    Args:
        deductions: Array de deductions del Payment Entry
    
    Returns:
        Lista de retenciones en formato del frontend
    """
    withholdings = []
    
    for deduction in deductions:
        # Verificar si es una retención
        if not deduction.get("custom_is_withholding"):
            continue
        
        withholding = {
            "tax_type": deduction.get("custom_tax_type", ""),
            "province_code": deduction.get("custom_province_code", "") or None,
            "province_name": deduction.get("custom_province_name", ""),
            "afip_code": deduction.get("custom_afip_code", "") or None,
            "afip_description": deduction.get("custom_afip_description", ""),
            "regimen": deduction.get("custom_regimen", "") or None,
            "certificate_number": deduction.get("custom_certificate_number", "") or None,
            "percentage": deduction.get("custom_percentage"),
            "base_amount": deduction.get("custom_base_amount"),
            "total_amount": deduction.get("amount", 0),
            "account_code": deduction.get("account", ""),
            "sales_invoice": deduction.get("custom_sales_invoice", "") or None
        }
        
        withholdings.append(withholding)
    
    return withholdings


# ============================================================================
# ENDPOINTS API
# ============================================================================

@sales_withholdings_bp.route('/api/sales-withholdings/config', methods=['GET'])
def get_withholdings_config():
    """
    Obtener configuración de retenciones para el frontend.
    Devuelve provincias, tipos y regímenes disponibles.
    """
    print("--- GET /api/sales-withholdings/config")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        config = load_argentina_withholdings_config()
        
        # Filtrar _doc del diccionario de provincias
        provinces_dict = {k: v for k, v in config.get("provinces", {}).items() if k != "_doc"}
        
        response_data = {
            "withholding_types": [
                {"code": "INGRESOS_BRUTOS", "name": "Ingresos Brutos", "requires_province": True},
                {"code": "IVA", "name": "IVA", "requires_province": False},
                {"code": "GANANCIAS", "name": "Ganancias", "requires_province": False},
                {"code": "SUSS", "name": "SUSS", "requires_province": False}
            ],
            "provinces": [
                {"code": code, "name": name}
                for code, name in sorted(provinces_dict.items(), key=lambda x: x[1])
            ],
            "regimens": config.get("regimens", {})
        }
        
        print("--- GET /api/sales-withholdings/config: success")
        return jsonify({
            "success": True,
            "data": response_data
        })
    
    except Exception as e:
        print(f"--- GET /api/sales-withholdings/config: error - {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error obteniendo configuración: {str(e)}"
        }), 500


@sales_withholdings_bp.route('/api/sales-withholdings/validate', methods=['POST'])
def validate_withholdings_endpoint():
    """
    Validar una lista de retenciones antes de crear el Payment Entry.
    Útil para validación en tiempo real en el frontend.
    """
    print("--- POST /api/sales-withholdings/validate")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.get_json()
        withholdings = data.get("withholdings", [])
        
        errors = validate_withholdings_list(withholdings)
        
        if errors:
            return jsonify({
                "success": False,
                "valid": False,
                "errors": errors
            })
        
        return jsonify({
            "success": True,
            "valid": True,
            "message": f"{len(withholdings)} retenciones validadas correctamente"
        })
    
    except Exception as e:
        print(f"--- POST /api/sales-withholdings/validate: error - {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error validando retenciones: {str(e)}"
        }), 500


@sales_withholdings_bp.route('/api/sales-withholdings/build-deductions', methods=['POST'])
def build_deductions_endpoint():
    """
    Construir las filas de deductions a partir de retenciones.
    Endpoint de debugging/preview para verificar cómo quedarán las retenciones en ERPNext.
    """
    print("--- POST /api/sales-withholdings/build-deductions")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.get_json()
        company = data.get("company")
        customer = data.get("customer")
        withholdings = data.get("withholdings", [])
        references = data.get("references", [])
        company_abbr = data.get("company_abbr")
        
        if not company:
            return jsonify({
                "success": False,
                "message": "El campo 'company' es requerido"
            }), 400
        
        deduction_rows, errors = build_payment_entry_withholdings(
            company, customer, withholdings, references, company_abbr
        )
        
        if errors:
            return jsonify({
                "success": False,
                "message": "Errores en algunas retenciones",
                "errors": errors,
                "deduction_rows": deduction_rows
            }), 400
        
        return jsonify({
            "success": True,
            "message": f"{len(deduction_rows)} filas de deducciones construidas",
            "deduction_rows": deduction_rows
        })
    
    except Exception as e:
        print(f"--- POST /api/sales-withholdings/build-deductions: error - {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error construyendo deductions: {str(e)}"
        }), 500


@sales_withholdings_bp.route('/api/sales-withholdings/reload-config', methods=['POST'])
def reload_config_endpoint():
    """
    Recargar la configuración de retenciones desde disco.
    Útil después de modificar el JSON manualmente.
    """
    print("--- POST /api/sales-withholdings/reload-config")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        config = reload_argentina_withholdings_config()
        
        return jsonify({
            "success": True,
            "message": "Configuración recargada exitosamente",
            "companies": list(config.get("companies", {}).keys()),
            "provinces_count": len(config.get("provinces", {}))
        })
    
    except Exception as e:
        print(f"--- POST /api/sales-withholdings/reload-config: error - {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error recargando configuración: {str(e)}"
        }), 500
