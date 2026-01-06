"""
Crear mappings por defecto para Tax Account Map a partir de shared/argentina_perceptions.json

Esta utilidad crea filas en el DocType `Tax Account Map` con las cuentas por defecto
para percepciones/retenciones por provincia / impuesto, en la compañía activa.

Tipos de perception_type:
- PERCEPCION_IIBB: Percepciones de Ingresos Brutos (compras)
- RETENCION_IIBB: Retenciones de Ingresos Brutos (ventas)
- PERCEPCION_IVA: Percepciones de IVA (compras)
- RETENCION_IVA: Retenciones de IVA (ventas)
- PERCEPCION_GANANCIAS: Percepciones de Ganancias (compras)
- RETENCION_GANANCIAS: Retenciones de Ganancias (ventas)
"""
import json
from urllib.parse import quote
from typing import Any, Dict

from routes.purchase_perceptions import load_argentina_perceptions_config
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Mapeo de códigos de provincia a account_number base para percepciones y retenciones IIBB
# Percepciones: 1.1.4.01.04.01 a 1.1.4.01.04.24
# Retenciones: 1.1.4.01.04.25 a 1.1.4.01.04.48
PROVINCE_ACCOUNT_MAP = {
    # Percepciones IIBB
    '902': {'percepcion': '1.1.4.01.04.01', 'retencion': '1.1.4.01.04.25'},  # Buenos Aires
    '903': {'percepcion': '1.1.4.01.04.02', 'retencion': '1.1.4.01.04.26'},  # Catamarca
    '906': {'percepcion': '1.1.4.01.04.03', 'retencion': '1.1.4.01.04.27'},  # Chaco
    '907': {'percepcion': '1.1.4.01.04.04', 'retencion': '1.1.4.01.04.28'},  # Chubut
    '904': {'percepcion': '1.1.4.01.04.05', 'retencion': '1.1.4.01.04.29'},  # Córdoba
    '905': {'percepcion': '1.1.4.01.04.06', 'retencion': '1.1.4.01.04.30'},  # Corrientes
    '908': {'percepcion': '1.1.4.01.04.07', 'retencion': '1.1.4.01.04.31'},  # Entre Ríos
    '909': {'percepcion': '1.1.4.01.04.08', 'retencion': '1.1.4.01.04.32'},  # Formosa
    '910': {'percepcion': '1.1.4.01.04.09', 'retencion': '1.1.4.01.04.33'},  # Jujuy
    '911': {'percepcion': '1.1.4.01.04.10', 'retencion': '1.1.4.01.04.34'},  # La Pampa
    '912': {'percepcion': '1.1.4.01.04.11', 'retencion': '1.1.4.01.04.35'},  # La Rioja
    '913': {'percepcion': '1.1.4.01.04.12', 'retencion': '1.1.4.01.04.36'},  # Mendoza
    '914': {'percepcion': '1.1.4.01.04.13', 'retencion': '1.1.4.01.04.37'},  # Misiones
    '915': {'percepcion': '1.1.4.01.04.14', 'retencion': '1.1.4.01.04.38'},  # Neuquén
    '916': {'percepcion': '1.1.4.01.04.15', 'retencion': '1.1.4.01.04.39'},  # Río Negro
    '917': {'percepcion': '1.1.4.01.04.16', 'retencion': '1.1.4.01.04.40'},  # Salta
    '918': {'percepcion': '1.1.4.01.04.17', 'retencion': '1.1.4.01.04.41'},  # San Juan
    '919': {'percepcion': '1.1.4.01.04.18', 'retencion': '1.1.4.01.04.42'},  # San Luis
    '920': {'percepcion': '1.1.4.01.04.19', 'retencion': '1.1.4.01.04.43'},  # Santa Cruz
    '921': {'percepcion': '1.1.4.01.04.20', 'retencion': '1.1.4.01.04.44'},  # Santa Fe
    '922': {'percepcion': '1.1.4.01.04.21', 'retencion': '1.1.4.01.04.45'},  # Santiago del Estero
    '923': {'percepcion': '1.1.4.01.04.22', 'retencion': '1.1.4.01.04.46'},  # Tierra del Fuego
    '924': {'percepcion': '1.1.4.01.04.23', 'retencion': '1.1.4.01.04.47'},  # Tucumán
    '901': {'percepcion': '1.1.4.01.04.24', 'retencion': '1.1.4.01.04.48'},  # CABA
}

# Cuentas fijas para IVA y Ganancias
IVA_ACCOUNTS = {
    'percepcion': '1.1.4.01.10.01',  # Percepciones de IVA
    'retencion': '1.1.4.01.10.02',   # Retenciones de IVA
}

GANANCIAS_ACCOUNTS = {
    'percepcion': '1.1.4.01.03.01',  # Percepciones Impto. a las Ganancias
    'retencion': '1.1.4.01.03.02',   # Retenciones Impto. a las Ganancias
}


def _get_active_company(session):
    # Intenta obtener la compañía activa del usuario vía endpoint interno
    resp, err = make_erpnext_request(session=session, method="GET", endpoint="/api/active-company", operation_name="Get active company")
    if err or resp.status_code != 200:
        return None
    data = resp.json().get('data') or {}
    return data.get('company_details', {}).get('company') or data.get('company')


def _find_account_by_number(session, account_number, company=None):
    try:
        filters = [["account_number", "=", account_number]]
        if company:
            filters.append(["company", "=", company])
        params = {
            'filters': json.dumps(filters),
            'fields': json.dumps(["name", "account_number", "is_group", "company"]),
            'limit_page_length': 1
        }
        resp, err = make_erpnext_request(session=session, method="GET", endpoint="/api/resource/Account", params=params, operation_name=f"Find account {account_number}")
        if err or resp.status_code != 200:
            return None
        rows = resp.json().get('data') or []
        if not rows:
            return None
        return rows[0]
    except Exception:
        return None


def _upsert_tax_map(session, mapping: Dict[str, Any]):
    # Check existing
    filters = [["company", "=", mapping['company']], ["transaction_type", "=", mapping['transaction_type']], ["perception_type", "=", mapping['perception_type']]]
    if mapping.get('province_code'):
        filters.append(["province_code", "=", mapping['province_code']])
    if mapping.get('rate_percent') is not None:
        filters.append(["rate_percent", "=", mapping['rate_percent']])

    params = { 'filters': json.dumps(filters), 'fields': json.dumps(["name"]), 'limit_page_length': 1 }
    resp, err = make_erpnext_request(session=session, method="GET", endpoint="/api/resource/Tax Account Map", params=params, operation_name="Find Tax Account Map")
    if err:
        print('Error buscando Tax Account Map existente:', err)
        return False
    if resp.status_code == 200 and (resp.json().get('data') or []):
        # Update existing
        name = resp.json()['data'][0]['name']
        update_data = { 'data': mapping }
        update_resp, update_err = make_erpnext_request(session=session, method='PUT', endpoint=f"/api/resource/Tax Account Map/{quote(name)}", data=update_data, operation_name='Update Tax Account Map')
        if update_err or update_resp.status_code not in (200,202):
            print('Error actualizando Tax Account Map', update_err or update_resp.text)
            return False
        return True

    # Create new
    # Ensure a stable name is provided to avoid autoname validation errors in ERPNext
    try:
        name_parts = [mapping.get('company') or '']
        name_parts.append(mapping.get('perception_type') or '')
        name_parts.append(mapping.get('transaction_type') or '')
        if mapping.get('province_code'):
            name_parts.append(str(mapping.get('province_code')))
        if mapping.get('rate_percent') is not None:
            name_parts.append(str(mapping.get('rate_percent')))
        safe_name = ' - '.join([p for p in name_parts if p])
        payload = {'data': dict(mapping, name=safe_name)}
    except Exception:
        payload = {'data': mapping}

    create_resp, create_err = make_erpnext_request(session=session, method='POST', endpoint='/api/resource/Tax Account Map', data=payload, operation_name='Create Tax Account Map')
    if create_err or create_resp.status_code not in (200,201,202):
        print('Error creando Tax Account Map', create_err or create_resp.text)
        return False
    return True


def ensure_tax_account_map_defaults(session, headers, ERPNEXT_URL, user_id=None):
    """Carga los mapeos por defecto para percepciones y retenciones para la compañía activa.

    Crea mappings para:
    - PERCEPCION_IIBB: Por cada provincia (compras)
    - RETENCION_IIBB: Por cada provincia (ventas - el cliente nos retiene)
    - PERCEPCION_IVA: Una sola cuenta (compras)
    - RETENCION_IVA: Una sola cuenta (ventas)
    - PERCEPCION_GANANCIAS: Una sola cuenta (compras)
    - RETENCION_GANANCIAS: Una sola cuenta (ventas)
    """
    company = None
    try:
        if user_id:
            from routes.general import get_active_company as _get_active_company_local
            company = _get_active_company_local(user_id)
    except Exception:
        company = None

    if not company:
        company = _get_active_company(session)

    if not company:
        print('No active company found, skipping Tax Account Map bootstrap')
        return {'success': False, 'message': 'No active company found for bootstrap'}

    created = 0
    skipped = 0

    # ========== IIBB por provincia ==========
    for prov_code, accounts in PROVINCE_ACCOUNT_MAP.items():
        # PERCEPCION_IIBB (compras - el proveedor nos percibe)
        perc_acc_num = accounts['percepcion']
        perc_acct = _find_account_by_number(session, perc_acc_num, company=company)
        if perc_acct and not perc_acct.get('is_group'):
            mapping = {
                'company': company,
                'transaction_type': 'purchase',
                'perception_type': 'PERCEPCION_IIBB',
                'province_code': prov_code,
                'rate_percent': None,
                'account': perc_acct.get('name'),
                'account_number': perc_acct.get('account_number'),
                'description': f'Percepción IIBB - Provincia {prov_code}'
            }
            if _upsert_tax_map(session, mapping):
                created += 1
            else:
                skipped += 1
        else:
            print(f"Cuenta percepción IIBB {perc_acc_num} no encontrada o es grupo, skip")
            skipped += 1

        # RETENCION_IIBB (ventas - el cliente nos retiene)
        ret_acc_num = accounts['retencion']
        ret_acct = _find_account_by_number(session, ret_acc_num, company=company)
        if ret_acct and not ret_acct.get('is_group'):
            mapping = {
                'company': company,
                'transaction_type': 'sale',
                'perception_type': 'RETENCION_IIBB',
                'province_code': prov_code,
                'rate_percent': None,
                'account': ret_acct.get('name'),
                'account_number': ret_acct.get('account_number'),
                'description': f'Retención IIBB - Provincia {prov_code}'
            }
            if _upsert_tax_map(session, mapping):
                created += 1
            else:
                skipped += 1
        else:
            print(f"Cuenta retención IIBB {ret_acc_num} no encontrada o es grupo, skip")
            skipped += 1

    # ========== IVA (una sola cuenta sin provincia) ==========
    # PERCEPCION_IVA (compras)
    iva_perc_acct = _find_account_by_number(session, IVA_ACCOUNTS['percepcion'], company=company)
    if iva_perc_acct and not iva_perc_acct.get('is_group'):
        mapping = {
            'company': company,
            'transaction_type': 'purchase',
            'perception_type': 'PERCEPCION_IVA',
            'province_code': None,
            'rate_percent': None,
            'account': iva_perc_acct.get('name'),
            'account_number': iva_perc_acct.get('account_number'),
            'description': 'Percepciones de IVA'
        }
        if _upsert_tax_map(session, mapping):
            created += 1
        else:
            skipped += 1
    else:
        print(f"Cuenta percepción IVA {IVA_ACCOUNTS['percepcion']} no encontrada o es grupo, skip")
        skipped += 1

    # RETENCION_IVA (ventas - el cliente nos retiene IVA)
    iva_ret_acct = _find_account_by_number(session, IVA_ACCOUNTS['retencion'], company=company)
    if iva_ret_acct and not iva_ret_acct.get('is_group'):
        mapping = {
            'company': company,
            'transaction_type': 'sale',
            'perception_type': 'RETENCION_IVA',
            'province_code': None,
            'rate_percent': None,
            'account': iva_ret_acct.get('name'),
            'account_number': iva_ret_acct.get('account_number'),
            'description': 'Retenciones de IVA'
        }
        if _upsert_tax_map(session, mapping):
            created += 1
        else:
            skipped += 1
    else:
        print(f"Cuenta retención IVA {IVA_ACCOUNTS['retencion']} no encontrada o es grupo, skip")
        skipped += 1

    # ========== GANANCIAS (una sola cuenta sin provincia) ==========
    # PERCEPCION_GANANCIAS (compras)
    gan_perc_acct = _find_account_by_number(session, GANANCIAS_ACCOUNTS['percepcion'], company=company)
    if gan_perc_acct and not gan_perc_acct.get('is_group'):
        mapping = {
            'company': company,
            'transaction_type': 'purchase',
            'perception_type': 'PERCEPCION_GANANCIAS',
            'province_code': None,
            'rate_percent': None,
            'account': gan_perc_acct.get('name'),
            'account_number': gan_perc_acct.get('account_number'),
            'description': 'Percepciones de Ganancias'
        }
        if _upsert_tax_map(session, mapping):
            created += 1
        else:
            skipped += 1
    else:
        print(f"Cuenta percepción Ganancias {GANANCIAS_ACCOUNTS['percepcion']} no encontrada o es grupo, skip")
        skipped += 1

    # RETENCION_GANANCIAS (ventas - el cliente nos retiene ganancias)
    gan_ret_acct = _find_account_by_number(session, GANANCIAS_ACCOUNTS['retencion'], company=company)
    if gan_ret_acct and not gan_ret_acct.get('is_group'):
        mapping = {
            'company': company,
            'transaction_type': 'sale',
            'perception_type': 'RETENCION_GANANCIAS',
            'province_code': None,
            'rate_percent': None,
            'account': gan_ret_acct.get('name'),
            'account_number': gan_ret_acct.get('account_number'),
            'description': 'Retenciones de Ganancias'
        }
        if _upsert_tax_map(session, mapping):
            created += 1
        else:
            skipped += 1
    else:
        print(f"Cuenta retención Ganancias {GANANCIAS_ACCOUNTS['retencion']} no encontrada o es grupo, skip")
        skipped += 1

    print(f"Tax Account Map bootstrap finished: created={created} skipped={skipped}")
    return {'success': True, 'created': created, 'skipped': skipped}
