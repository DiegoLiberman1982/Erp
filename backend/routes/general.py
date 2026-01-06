from flask import Blueprint, request, jsonify
from urllib.parse import quote
import os
import json

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para rutas generales
general_bp = Blueprint('general', __name__)

def get_company_abbr(session, headers, company_name):
    """Obtener la sigla (abbr) de una compañía desde ERPNext"""
    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            operation_name="Get Company Abbr"
        )
        
        if not error and response.status_code == 200:
            company_data = response.json().get('data', {})
            abbr = company_data.get('abbr')
            if abbr:
                return abbr
        
        print("--- Company abbr: not found")
        return None
    except Exception as e:
        print("--- Company abbr: error")
        return None

def get_company_default_currency(session, headers, company_name):
    """Obtener la moneda por defecto de una compañía desde ERPNext"""
    try:
        if not company_name:
            return None

        params = {"fields": json.dumps(["default_currency"])}
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Company/{quote(company_name)}",
            params=params,
            operation_name="Get Company Default Currency"
        )

        if error or not response or response.status_code != 200:
            print(f"--- Company default currency: failed to load {company_name}")
            return None

        company_data = response.json().get('data', {})
        return company_data.get('default_currency')
    except Exception as e:
        print(f"--- Company default currency: error - {e}")
        return None

def get_active_company(user_id):
    """Obtener la compañía activa para un usuario específico"""
    try:
        # Importar la función load_active_companies desde companies.py
        from routes.companies import load_active_companies
        
        active_data = load_active_companies()
        active_companies = active_data.get("active_companies", {})
        active_company = active_companies.get(user_id)

        return active_company
    except Exception as e:
        return None

def remove_company_abbr(code, company_abbr):
    """Remover la sigla de compañía de un código si está presente"""
    try:
        if not code or not company_abbr:
            return code
            
        # Validar que company_abbr no contenga caracteres problemáticos
        if not isinstance(company_abbr, str) or len(company_abbr.strip()) == 0:
            return code
            
        company_abbr = company_abbr.strip()
        
        # Si el código termina con " - {ABBR}", removerlo
        suffix = f" - {company_abbr}"
        if code.endswith(suffix):
            result = code[:-len(suffix)]
            return result
            
        # Si no tiene el sufijo, devolver como está sin log adicional
        return code
    except Exception as e:
        print(f"--- Company abbr removal: error - {e}")
        return code

def add_company_abbr(code, company_abbr):
    """Agregar la sigla de compañía a un código si no está presente"""
    try:
        if not code or not company_abbr:
            return code
            
        # Validar que company_abbr no contenga caracteres problemáticos
        if not isinstance(company_abbr, str) or len(company_abbr.strip()) == 0:
            print(f"--- Company abbr addition: invalid abbr '{company_abbr}'")
            return code
            
        company_abbr = company_abbr.strip()
        code = str(code).strip()
        
        # Si ya termina con la ABBR, devolver como está (evitar duplicación)
        suffix = f" - {company_abbr}"
        if code.endswith(suffix):
            return code

        # Ser tolerante con espacios (p.ej. "P-004 - ANC " o espacios no estándar)
        import re
        suffix_regex = re.compile(rf"\s*-\s*{re.escape(company_abbr)}\s*$")
        if suffix_regex.search(code):
            return suffix_regex.sub(suffix, code).strip()
            
        # Only avoid adding the suffix when the code already ends with the exact suffix.
        # Previously we rejected adding the abbr if there was any " - " anywhere in the
        # code, which prevented names that legitimately contain hyphens from getting
        # the company suffix. Now we only check the suffix to determine if we should
        # add it.
            
        # Agregar la ABBR al final
        result = f"{code} - {company_abbr}"
        return result
    except Exception as e:
        print(f"--- Company abbr addition: error - {e}")
        return code

def resolve_customer_name(customer_name, company_abbr):
    """
    Normaliza el nombre/código de Customer para que quede scopeado por company.

    Regla:
    - Si ya termina en " - {ABBR}" (tolerando espacios), no se modifica.
    - Si termina en " - OTRAABBR", no se modifica (evita doble sufijo).
    - Si no tiene sufijo, se agrega " - {ABBR}".
    """
    try:
        if not customer_name or not company_abbr:
            return customer_name

        customer_name = str(customer_name).strip()
        company_abbr = str(company_abbr).strip()
        if not customer_name or not company_abbr:
            return customer_name

        import re

        suffix_match = re.search(r"\s*-\s*([A-Za-z0-9]{1,15})\s*$", customer_name)
        if suffix_match:
            suffix_abbr = suffix_match.group(1).strip()
            if suffix_abbr.upper() != company_abbr.upper():
                print(f"--- Customer name already has a different ABBR suffix ('{suffix_abbr}'), leaving as-is")
                return customer_name

        return add_company_abbr(customer_name, company_abbr)
    except Exception as e:
        print(f"--- Customer name resolve: error - {e}")
        return customer_name


def get_company_item_count(company_name):
    """Obtener el conteo de items para una compañía desde active_companies.json"""
    try:
        config_path = os.path.join(os.path.dirname(__file__), '..', 'active_companies.json')
        
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        company_item_counts = config.get('company_item_counts', {})
        return company_item_counts.get(company_name, 0)
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        return 0

def update_company_item_count(company_name, operation='increment'):
    """Actualizar el conteo de items para una compañía en active_companies.json
    
    Args:
        company_name: Nombre de la compañía
        operation: 'increment' o 'decrement' para aumentar o disminuir el conteo
    """
    try:
        config_path = os.path.join(os.path.dirname(__file__), '..', 'active_companies.json')
        
        # Leer configuración actual
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            config = {'company_item_counts': {}}
        
        company_item_counts = config.get('company_item_counts', {})
        current_count = company_item_counts.get(company_name, 0)
        
        # Actualizar conteo
        if operation == 'increment':
            company_item_counts[company_name] = current_count + 1
        elif operation == 'decrement':
            company_item_counts[company_name] = max(0, current_count - 1)
        else:
            print(f"--- Invalid operation for update_company_item_count: {operation}")
            return
        
        # Guardar configuración actualizada
        config['company_item_counts'] = company_item_counts
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        print(f"--- Company item count updated: {company_name} {operation}d to {company_item_counts[company_name]}")
        
    except Exception as e:
        print(f"--- Error updating company item count: {e}")
        # No fallar si no se puede actualizar el conteo

def get_smart_limit(company_name, operation_type='default'):
    """Calcular límite inteligente para consultas basado en el conteo de items de la compañía
    
    Args:
        company_name: Nombre de la compañía
        operation_type: Tipo de operación ('search', 'list', 'calculate', etc.)
    
    Returns:
        int: Límite calculado para limit_page_length
    """
    try:
        item_count = get_company_item_count(company_name)
        
        if operation_type == 'search':
            # Para búsquedas: mínimo 500, máximo razonable
            return max(500, item_count + 100)
        elif operation_type == 'list':
            # Para listados completos: mínimo 1000, +1000 por compañía
            return max(1000, item_count + 1000)
        elif operation_type == 'calculate':
            # Para cálculos: mínimo 1000, +500 por compañía (más conservador)
            return max(1000, item_count + 500)
        else:
            # Default: mínimo 1000
            return max(1000, item_count + 100)
    except Exception as e:
        print(f"--- Smart limit calculation error: {e}")
        # Fallback seguro
        return 1000


def _get_formula_history_key(user_id, company_name):
    """Build the storage key for formula history"""
    if not user_id or not company_name:
        return None
    return f"{user_id}_{company_name}"


def get_formula_history_entries(user_id, company_name, limit=5):
    """Return the most recent formulas stored for the given user+company combo"""
    try:
        key = _get_formula_history_key(user_id, company_name)
        if not key:
            return []
        from routes.companies import load_active_companies  # lazy import to avoid circular deps
        data = load_active_companies()
        history_map = data.get("formula_history", {})
        history = history_map.get(key, [])
        if not isinstance(history, list):
            return []
        return history[:limit]
    except Exception as e:
        print(f"--- Formula history read error: {e}")
        return []


def append_formula_history_entry(user_id, company_name, formula, limit=5):
    """Persist a formula in the history list for a user+company and return the updated list"""
    try:
        key = _get_formula_history_key(user_id, company_name)
        if not key or not isinstance(formula, str):
            return []
        trimmed = formula.strip()
        if not trimmed:
            return get_formula_history_entries(user_id, company_name, limit=limit)

        from routes.companies import load_active_companies, save_active_companies  # lazy import
        data = load_active_companies()
        history_map = data.get("formula_history")
        if not isinstance(history_map, dict):
            history_map = {}

        existing = history_map.get(key, [])
        if not isinstance(existing, list):
            existing = []

        new_history = [trimmed]
        for entry in existing:
            if entry == trimmed:
                continue
            new_history.append(entry)
            if len(new_history) >= limit:
                break

        history_map[key] = new_history[:limit]
        data["formula_history"] = history_map
        if not save_active_companies(data):
            print("--- Warning: failed to persist formula history")
        return history_map.get(key, [])[:limit]
    except Exception as e:
        print(f"--- Formula history write error: {e}")
        return get_formula_history_entries(user_id, company_name, limit=limit)


def validate_company_abbr_operation(original_code, result_code, company_abbr, operation):
    """
    Validar que una operación de sigla de compañía se realizó correctamente
    
    Args:
        original_code: Código original
        result_code: Código resultante
        company_abbr: Sigla de compañía usada
        operation: 'add' o 'remove'
    
    Returns:
        bool: True si la operación es válida
    """
    try:
        if not original_code or not result_code or not company_abbr:
            print(f"--- Validation {operation}: invalid parameters")
            return False
            
        suffix = f" - {company_abbr}"
        
        if operation == 'add':
            # Para agregar: el resultado debe terminar con el sufijo y no debe tenerlo duplicado
            if not result_code.endswith(suffix):
                print(f"--- Validation add: result doesn't end with suffix '{result_code}'")
                return False
            if result_code.count(suffix) > 1:
                print(f"--- Validation add: duplicate suffix in result '{result_code}'")
                return False
            # Verificar que el código base es correcto
            expected_base = result_code[:-len(suffix)]
            if expected_base != original_code:
                print(f"--- Validation add: base mismatch '{expected_base}' != '{original_code}'")
                return False
                
        elif operation == 'remove':
            # Para remover: el original debe terminar con el sufijo y el resultado no debe tenerlo
            if not original_code.endswith(suffix):
                print(f"--- Validation remove: original doesn't end with suffix '{original_code}'")
                return False
            if result_code.endswith(suffix):
                print(f"--- Validation remove: result still has suffix '{result_code}'")
                return False
            # Verificar que el resultado es correcto
            expected_result = original_code[:-len(suffix)]
            if expected_result != result_code:
                print(f"--- Validation remove: result mismatch '{expected_result}' != '{result_code}'")
                return False
                
        else:
            print(f"--- Validation: unknown operation '{operation}'")
            return False
            
        print(f"--- Validation {operation}: passed")
        return True
        
    except Exception as e:
        print(f"--- Validation {operation}: error - {e}")
        return False


@general_bp.route('/api/calculator/formula-history', methods=['GET'])
def fetch_formula_history():
    """Return the last stored formulas for the authenticated user/company context"""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company = request.args.get('company') or get_active_company(user_id)
    if not company:
        return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

    history = get_formula_history_entries(user_id, company)
    return jsonify({"success": True, "data": history})


@general_bp.route('/api/calculator/formula-history', methods=['POST'])
def store_formula_history():
    """Persist a formula entry for the authenticated user/company context"""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company = request.args.get('company') or get_active_company(user_id)
    if not company:
        return jsonify({"success": False, "message": "No hay compañía activa seleccionada"}), 400

    payload = request.get_json() or {}
    formula = payload.get('formula')
    if not isinstance(formula, str) or not formula.strip():
        return jsonify({"success": False, "message": "Fórmula requerida"}), 400

    history = append_formula_history_entry(user_id, company, formula)
    return jsonify({"success": True, "data": history})
