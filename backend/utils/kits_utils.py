def append_company_abbr(item_code, abbr):
    """Return item_code with company abbreviation suffix (" - ABBR") if abbr provided and not already present.

    This helper is intentionally lightweight and has no dependencies so it can be
    easily unit-tested in isolation.
    """
    if not item_code:
        return item_code
    if not abbr:
        return item_code
    suffix = f" - {abbr}"
    if not isinstance(item_code, str):
        item_code = str(item_code)
    if item_code.endswith(suffix):
        return item_code
    return f"{item_code}{suffix}"


def compose_combined_brand(brands):
    """Given an iterable of brand names, return a deterministic combined name.

    Example: {'A', 'B'} -> 'A + B'
    """
    if not brands:
        return ''
    # Filter empty names and create deterministic order
    cleaned = sorted({str(b).strip() for b in brands if b and str(b).strip()})
    return ' + '.join(cleaned)
