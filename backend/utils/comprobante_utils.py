import json
import os
import unicodedata


_AFIP_SHARED = None
_ALIAS_MAP = None
_SIGLA_REVERSE_MAP = None
_KNOWN_TIPOS = None
_CURRENCY_ALIAS_MAP = None
_SHARED_PATH = os.path.normpath(
    os.path.join(os.path.dirname(os.path.dirname(__file__)), '..', 'shared', 'afip_codes.json')
)


def _load_shared():
    global _AFIP_SHARED
    if _AFIP_SHARED is None:
        if not os.path.exists(_SHARED_PATH):
            raise RuntimeError(
                f"Required shared AFIP codes file not found at '{_SHARED_PATH}'. "
                "Please add 'shared/afip_codes.json' to the repository."
            )
        with open(_SHARED_PATH, 'r', encoding='utf-8') as handle:
            _AFIP_SHARED = json.load(handle)
    return _AFIP_SHARED


def _normalize(value):
    if value is None:
        return ''
    if not isinstance(value, str):
        value = str(value)
    normalized = unicodedata.normalize('NFD', value.strip().lower())
    return ''.join(ch for ch in normalized if unicodedata.category(ch) != 'Mn')


def get_alias_map():
    global _ALIAS_MAP
    if _ALIAS_MAP is None:
        shared = _load_shared()
        raw_map = shared.get('alias_to_tipo', {})
        alias_map = {}
        for key, tipo in raw_map.items():
            normalized_key = _normalize(key)
            if normalized_key:
                alias_map[normalized_key] = str(tipo).upper()
        _ALIAS_MAP = alias_map
    return _ALIAS_MAP


def map_label_to_afip_type(label):
    """
    Attempt to map a free-form voucher label (Factura, Credit Note, etc.) to
    the canonical AFIP tipo (FAC/NCC/NDB/REC/...).
    """
    if not label:
        return None

    alias_map = get_alias_map()
    normalized = _normalize(label)

    if normalized in alias_map:
        return alias_map[normalized]

    shared = _load_shared()

    global _KNOWN_TIPOS
    if _KNOWN_TIPOS is None:
        tipos = set()
        for entry in shared.get('tipos_comprobante', []) or []:
            tipo = entry.get('tipo')
            if tipo:
                tipos.add(str(tipo).upper())
        _KNOWN_TIPOS = tipos

    upper_label = str(label).strip().upper()

    # If it's already an AFIP tipo, return directly (strictly from config)
    if upper_label in _KNOWN_TIPOS:
        return upper_label

    # Reverse map of configured siglas (FCV/FCC/etc.) -> tipo (strict: only if unambiguous)
    global _SIGLA_REVERSE_MAP
    if _SIGLA_REVERSE_MAP is None:
        reverse = {}
        siglas_cfg = shared.get('naming_conventions', {}).get('siglas', {}) or {}
        for tipo, entry in siglas_cfg.items():
            if not tipo or not entry:
                continue
            tipo_up = str(tipo).upper()
            for scope_key in ('venta', 'compra'):
                sigla = entry.get(scope_key)
                if not sigla:
                    continue
                sigla_up = str(sigla).upper()
                reverse.setdefault(sigla_up, set()).add(tipo_up)
        _SIGLA_REVERSE_MAP = reverse

    tipos_for_sigla = _SIGLA_REVERSE_MAP.get(upper_label)
    if tipos_for_sigla:
        if len(tipos_for_sigla) == 1:
            return next(iter(tipos_for_sigla))
        return None

    # Parse "XX-TIPO-..." patterns (strict: candidate must exist in config)
    if '-' in upper_label:
        parts = [p.strip() for p in upper_label.split('-') if p.strip()]
        if len(parts) >= 2:
            candidate = parts[1]
            if candidate in _KNOWN_TIPOS:
                return candidate

    return None


def get_currency_alias_map():
    """
    Returns a map of AFIP currency representations -> ERPNext Currency code
    loaded from shared/afip_codes.json (currency_aliases).
    """
    global _CURRENCY_ALIAS_MAP
    if _CURRENCY_ALIAS_MAP is None:
        shared = _load_shared()
        raw = shared.get('currency_aliases', {}) or {}
        mapped = {}
        for key, value in raw.items():
            if key is None or value is None:
                continue
            k = str(key).strip().upper()
            v = str(value).strip().upper()
            if k and v:
                mapped[k] = v
        _CURRENCY_ALIAS_MAP = mapped
    return _CURRENCY_ALIAS_MAP


def normalize_afip_currency_code(value):
    """
    Normaliza una moneda AFIP (símbolo/código) a un Currency code de ERPNext
    usando shared/afip_codes.json (currency_aliases). Si no hay alias, devuelve
    el valor en mayúsculas sin inventar fallbacks.
    """
    if value is None:
        return None
    raw = str(value).strip()
    if raw == "":
        return None
    alias_map = get_currency_alias_map()
    key = raw.upper()
    return alias_map.get(key, key)


def get_sales_prefix(is_electronic=True):
    shared = _load_shared()
    prefixes = shared.get('naming_conventions', {}).get('prefixes', {})
    ventas_cfg = prefixes.get('ventas', {})
    key = 'electronico' if is_electronic else 'manual'
    default = 'VE' if is_electronic else 'VM'
    return ventas_cfg.get(key, default)


def get_all_sales_prefixes(include_legacy=True):
    prefixes = {
        get_sales_prefix(True),
        get_sales_prefix(False)
    }
    if include_legacy:
        prefixes.update({'FE', 'FM'})
    return prefixes


def get_purchase_prefix(strict=False):
    """
    Return the purchase naming prefix from shared AFIP config.

    If strict is True, raise a RuntimeError when the configuration is missing
    or empty. When strict is False (default), fall back to 'CC' for
    backward-compatibility.
    """
    shared = _load_shared()
    prefixes = shared.get('naming_conventions', {}).get('prefixes', {})
    value = prefixes.get('compras', {}).get('default')
    if strict:
        if not value:
            raise RuntimeError(
                "Missing required AFIP purchase prefix: 'naming_conventions.prefixes.compras.default'"
            )
    return value if value else 'CC'


def get_payment_prefix(is_sales=True, is_electronic=True):
    shared = _load_shared()
    prefixes = shared.get('naming_conventions', {}).get('prefixes', {})
    pagos_cfg = prefixes.get('pagos', {})
    key = 'ventas' if is_sales else 'compras'
    scoped = pagos_cfg.get(key, {})
    if is_sales:
        return scoped.get('electronico' if is_electronic else 'manual', get_sales_prefix(is_electronic))
    return scoped.get('default', get_purchase_prefix())


def get_sigla_from_tipo(tipo, scope='venta'):
    """
    Returns the short sigla (FCV, FCC, NCV, etc.) for a given AFIP tipo.
    scope: 'venta' or 'compra'
    """
    if not tipo:
        return None
    shared = _load_shared()
    siglas_cfg = shared.get('naming_conventions', {}).get('siglas', {})
    scope_key = 'venta' if scope == 'venta' else 'compra'
    entry = siglas_cfg.get(tipo)
    if entry and scope_key in entry:
        return entry[scope_key]

    # Fallback basic mapping
    base = tipo
    if tipo.startswith('FAC') or tipo.startswith('FCE'):
        base = 'FC'
    elif tipo.startswith('NC'):
        base = 'NC'
    elif tipo.startswith('ND'):
        base = 'ND'
    suffix = 'V' if scope_key == 'venta' else 'C'
    return f"{base}{suffix}"
