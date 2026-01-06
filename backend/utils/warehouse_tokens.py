"""
Warehouse naming convention utilities for ERP system.

This module provides utilities for handling warehouse names following the convention:
<BASE>__<ROL>[<PROV>] - <ABBR>

Where:
- BASE: Base code (alphanumeric, uppercase)
- ROL: Role (OWN, CON, VCON)
- PROV: Supplier code (optional, only for CON/VCON roles, sanitized to 6 chars)
- ABBR: Company abbreviation (added automatically by ERPNext)

Functions:
- tokenize_warehouse_name: Parse a valid warehouse name into components
- build_warehouse_name: Construct a full warehouse name from components
- ensure_warehouse: Ensure a warehouse exists in ERPNext, creating if necessary
- sanitize_supplier_code: Sanitize supplier code to uppercase alphanumeric, max 6 chars
- validate_warehouse_name: Validate if a name matches the warehouse naming convention
"""

import re
from urllib.parse import quote
from utils.http_utils import make_erpnext_request
from routes.general import get_company_abbr

__all__ = [
    'tokenize_warehouse_name',
    'build_warehouse_name',
    'ensure_warehouse',
    'sanitize_supplier_code',
    'validate_warehouse_name'
]

# Valid roles for warehouses
VALID_ROLES = ['OWN', 'CON', 'VCON']

# Regex pattern for warehouse names: <BASE>__<ROL>[<PROV>] - <ABBR>
WAREHOUSE_NAME_PATTERN = re.compile(r'^([A-Z0-9]+)__([A-Z]+)(?:\[(.*?)\])? - ([A-Z]+)$')


def tokenize_warehouse_name(name):
    """
    Tokenize a warehouse name into its components.

    Args:
        name (str): The warehouse name to tokenize

    Returns:
        dict or None: Dictionary with 'base_code', 'role', 'supplier_code' if valid, None otherwise
    """
    match = WAREHOUSE_NAME_PATTERN.match(name)
    if not match:
        return None

    base_code, role, supplier_code, abbr = match.groups()

    if role not in VALID_ROLES:
        return None

    if role in ['CON', 'VCON'] and not supplier_code:
        return None

    if role == 'OWN' and supplier_code:
        return None

    return {
        'base_code': base_code,
        'role': role,
        'supplier_code': supplier_code
    }


def validate_warehouse_name(name):
    """
    Validate if a warehouse name matches the naming convention.

    Args:
        name (str): The warehouse name to validate

    Returns:
        bool: True if valid, False otherwise
    """
    return tokenize_warehouse_name(name) is not None


def sanitize_supplier_code(supplier_code):
    """
    Sanitize supplier code to uppercase alphanumeric, maximum 6 characters.

    Args:
        supplier_code (str): The supplier code to sanitize

    Returns:
        str or None: Sanitized supplier code or None if empty after sanitization
    """
    if not supplier_code:
        return None

    sanitized = ''.join(c for c in supplier_code.upper() if c.isalnum())[:6]
    return sanitized if sanitized else None


def build_warehouse_name(base_code, role, supplier_code, company_abbr):
    """
    Build a full warehouse name from components.

    Args:
        base_code (str): The base code
        role (str): The role (OWN, CON, VCON)
        supplier_code (str or None): The supplier code (required for CON/VCON)
        company_abbr (str): The company abbreviation

    Returns:
        str: The full warehouse name

    Raises:
        ValueError: If supplier_code is missing for CON/VCON roles
    """
    base_code = base_code.upper()
    role = role.upper()
    company_abbr = company_abbr.upper()

    if role == 'OWN':
        return f"{base_code}__{role} - {company_abbr}"
    else:
        supplier_code = sanitize_supplier_code(supplier_code)
        if not supplier_code:
            raise ValueError("supplier_code is required for CON/VCON roles")
        return f"{base_code}__{role}[{supplier_code}] - {company_abbr}"


def ensure_warehouse(session, headers, company, base_code, role, supplier_code=None):
    """
    Ensure a warehouse exists in ERPNext, creating it if necessary.

    Args:
        session: The ERPNext session
        headers: Request headers
        company (str): The company name
        base_code (str): The base code
        role (str): The role (OWN, CON, VCON)
        supplier_code (str or None): The supplier code (required for CON/VCON)

    Returns:
        dict: {'name': warehouse_name, 'warehouse_name': display_name, 'parent_warehouse': parent, 'auto_created': bool}

    Raises:
        ValueError: If validation fails
        Exception: If ERPNext API call fails
    """
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {role}")

    if not base_code:
        raise ValueError("base_code is required")

    if role in ['CON', 'VCON']:
        if not supplier_code:
            raise ValueError("supplier_code is required for CON/VCON roles")
    else:
        supplier_code = None

    company_abbr = get_company_abbr(session, headers, company)
    warehouse_code = build_warehouse_code(base_code, role, supplier_code)
    full_name = f"{warehouse_code} - {company_abbr}"

    # For CON/VCON roles, get warehouse_name and parent_warehouse from the base warehouse
    warehouse_name = warehouse_code  # Default
    parent_warehouse = ""  # Default

    def _warehouse_endpoint(name: str) -> str:
        return f"/api/resource/Warehouse/{quote(str(name), safe='')}"

    def _get_warehouse(name: str, op: str):
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=_warehouse_endpoint(name),
            operation_name=op
        )
        # One retry for transient connection issues (ERPNext sometimes closes the connection).
        if error and error.get('status_code') == 500:
            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=_warehouse_endpoint(name),
                operation_name=f"{op} (retry)"
            )
        return response, error

    def _create_warehouse(warehouse_full_name: str, parent: str | None = None):
        create_data = {
            "warehouse_name": warehouse_full_name,
            "company": company
        }
        if parent:
            create_data["parent_warehouse"] = parent

        return make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Warehouse",
            data=create_data,
            operation_name="Create warehouse"
        )

    if role in ['CON', 'VCON']:
        # The base_code should be the actual warehouse selected by the user (e.g., "Finished Goods")
        # Build the full name with company abbr (e.g., "Finished Goods - MS")
        base_code_str = str(base_code)
        suffix = f" - {company_abbr}"
        base_full_name = base_code_str if base_code_str.endswith(suffix) else f"{base_code_str}{suffix}"

        base_response, base_error = _get_warehouse(base_full_name, "Check base warehouse existence")

        if base_error and base_error.get('status_code') == 404:
            # Auto-create base warehouse when missing (needed to derive CON/VCON sibling warehouses).
            parent_candidate = f"All Warehouses - {company_abbr}"
            parent_resp, parent_err = _get_warehouse(parent_candidate, "Check parent warehouse existence")
            parent_to_use = parent_candidate if not parent_err and parent_resp and parent_resp.status_code == 200 else None

            create_response, create_error = _create_warehouse(base_full_name, parent=parent_to_use)
            if create_error or not create_response or create_response.status_code not in (200, 201):
                raise Exception(f"Failed to auto-create base warehouse '{base_full_name}': {create_error or getattr(create_response, 'text', None)}")

            base_response, base_error = _get_warehouse(base_full_name, "Re-check base warehouse existence (after create)")

        if base_error or not base_response or base_response.status_code != 200:
            raise Exception(f"Base warehouse '{base_full_name}' not found. Merchandise must have a valid warehouse.")

        # Base warehouse exists, inherit its properties
        base_data = base_response.json().get('data', {})
        warehouse_name = base_data.get('warehouse_name', warehouse_code)
        # Vincular el warehouse de consignación al warehouse base (no al padre del base).
        # Si ERPNext no permite hijos en un warehouse no-grupo, hacemos fallback en la creación.
        parent_warehouse = base_data.get('name', base_full_name) or base_full_name
        parent_fallback = base_data.get('parent_warehouse', "") or ""

    # Check if warehouse exists
    response, error = _get_warehouse(full_name, "Check warehouse existence")

    if error:
        # If warehouse doesn't exist (404), create it
        if error.get('status_code') == 404:
            # Create the warehouse with inherited properties
            create_response, create_error = _create_warehouse(full_name, parent=parent_warehouse or None)
            if create_error and role in ['CON', 'VCON']:
                fallback_parent = parent_fallback or None
                if fallback_parent != (parent_warehouse or None):
                    create_response, create_error = _create_warehouse(full_name, parent=fallback_parent)
            if create_error:
                raise Exception(f"Failed to create warehouse: {create_error}")

            created_data = create_response.json().get('data', {})
            return {
                "name": created_data.get('name', full_name),  # ERPNext generates the name
                "warehouse_name": created_data.get('warehouse_name', full_name),
                "parent_warehouse": created_data.get('parent_warehouse', parent_warehouse),
                "auto_created": True
            }
        else:
            raise Exception(f"Error checking warehouse: {error}")

    # Warehouse exists, get its current properties
    existing_data = response.json().get('data', {})
    return {
        "name": existing_data.get('name', full_name),
        "warehouse_name": existing_data.get('warehouse_name', warehouse_name),
        "parent_warehouse": existing_data.get('parent_warehouse', parent_warehouse),
        "auto_created": False
    }


def build_warehouse_code(base_code, role, supplier_code=None):
    """
    Build the warehouse code part (without company abbreviation).

    Args:
        base_code (str): The base code
        role (str): The role (OWN, CON, VCON)
        supplier_code (str or None): The supplier code (required for CON/VCON)

    Returns:
        str: The warehouse code

    Raises:
        ValueError: If supplier_code is missing for CON/VCON roles
    """
    base_code = base_code.upper()
    role = role.upper()

    if role == 'OWN':
        return f"{base_code}__{role}"
    else:
        supplier_code = sanitize_supplier_code(supplier_code)
        if not supplier_code:
            raise ValueError("supplier_code is required for CON/VCON roles")
        return f"{base_code}__{role}[{supplier_code}]"
