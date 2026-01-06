"""Price List Automation service helpers

Provides functions to fetch automatable price lists, evaluate formulas safely,
build bulk import payloads (CSV) and orchestrate applying automatic updates.

This module reuses the safe evaluator and translation utilities from
`routes.price_list_automation` and the centralized HTTP helper `make_erpnext_request`.
"""
from typing import List, Dict, Any, Tuple
import io
import csv
import json
import math
import traceback
from datetime import datetime

from config import ERPNEXT_URL, PRICE_PIVOT_CURRENCY
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Reuse translator and safe evaluator from the route module to ensure
# consistent behavior with the price_list_automation routes.
from routes.price_list_automation import _translate_and_sanitize_formula, safe_eval_formula, _build_csv_rows_for_updates

# Import company abbr utilities
from routes.general import get_company_abbr, add_company_abbr, get_company_default_currency


def _parse_datetime(value: str) -> datetime:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        try:
            return datetime.strptime(value.split('.')[0], '%Y-%m-%d %H:%M:%S')
        except Exception:
            try:
                return datetime.strptime(value, '%Y-%m-%d')
            except Exception:
                return None


def _select_latest_row(current: Dict[str, Any], candidate: Dict[str, Any]) -> Dict[str, Any]:
    if not current:
        return candidate
    if not candidate:
        return current

    def _priority(row):
        for field in ('valid_from', 'modified', 'creation'):
            dt = _parse_datetime(row.get(field))
            if dt:
                return dt
        return datetime.min

    return candidate if _priority(candidate) >= _priority(current) else current


def _resolve_pivot_currency(session, company_name):
    """Determina la moneda pivote usando la configuración global o la compañía activa."""
    if PRICE_PIVOT_CURRENCY:
        return PRICE_PIVOT_CURRENCY
    if not company_name:
        raise ValueError("No se pudo determinar la moneda pivote porque falta el nombre de la compañía.")
    currency = get_company_default_currency(session, {}, company_name)
    if currency:
        return currency
    raise ValueError(f"No se pudo leer la moneda por defecto para la compañía '{company_name}'.")


def _fetch_sale_price_map(session, item_codes: List[str], price_lists: List[str], company_abbr: str) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """Fetch existing selling Item Prices for the provided codes/lists."""
    if not item_codes:
        return {}

    unique_codes = []
    seen = set()
    for code in item_codes:
        if not code:
            continue
        normalized = add_company_abbr(code, company_abbr) if company_abbr else code
        if normalized not in seen:
            seen.add(normalized)
            unique_codes.append(normalized)

    if not unique_codes:
        return {}

    sale_price_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
    chunk_size = 150
    total_chunks = (len(unique_codes) + chunk_size - 1) // chunk_size

    for index in range(total_chunks):
        chunk = unique_codes[index * chunk_size:(index + 1) * chunk_size]
        filters = [
            ["item_code", "in", chunk],
            ["selling", "=", 1]
        ]
        if price_lists:
            filters.append(["price_list", "in", price_lists])

        params = {
            'fields': '["name","item_code","price_list","valid_from","modified","creation","price_list_rate"]',
            'filters': json.dumps(filters),
            'limit_page_length': max(len(chunk), 200)
        }

        resp, err = make_erpnext_request(
            session=session,
            method='GET',
            endpoint='/api/resource/Item Price',
            params=params,
            operation_name=f'Fetch sale Item Prices chunk {index + 1}/{total_chunks}'
        )

        if err or resp.status_code != 200:
            print(f"[AUTOMATION SERVICE] Failed to fetch sale Item Prices chunk {index + 1}: {err or resp.text}")
            continue

        data_rows = resp.json().get('data', [])
        for row in data_rows:
            code = row.get('item_code')
            if code and company_abbr:
                code = add_company_abbr(code, company_abbr)
            price_list = row.get('price_list')
            key = (code, price_list)
            sale_price_map[key] = _select_latest_row(sale_price_map.get(key), row)

    if sale_price_map:
        sample = list(sale_price_map.items())[:5]
        print("[AUTOMATION SERVICE] Resolved sale Item Price identifiers (sample):")
        for (code, pl), row in sample:
            print(f"    code={code} price_list={pl} name={row.get('name')} valid_from={row.get('valid_from')} modified={row.get('modified')}")

    return sale_price_map

def fetch_auto_price_lists(session, list_type: str = 'sales') -> List[Dict[str, Any]]:
    """Fetch price lists from ERPNext that include automation fields.

    Args:
        session: requests.Session already authenticated with ERPNext (cookies)
        list_type: 'sales' or 'purchase' - selects selling/buying price lists

    Returns:
        A list of price list dicts with keys: name, price_list_name, currency,
        auto_update_enabled (bool), auto_update_formula (str), selling/buying.

    Raises:
        Exception on failure (wraps ERPNext errors)
    """
    filters = [["selling", "=", 1]] if list_type == 'sales' else [["buying", "=", 1]]
    # Also fetch custom_exchange_rate so we can convert between currencies when calculating formulas
    params = {
        'fields': '["name","price_list_name","currency","custom_exchange_rate","enabled","auto_update_enabled","auto_update_formula","selling","buying"]',
        'filters': str(filters).replace("'", '"'),
        'limit_page_length': 500
    }

    resp, err = make_erpnext_request(
        session=session,
        method='GET',
        endpoint='/api/resource/Price List',
        params=params,
        operation_name='Fetch automatable price lists'
    )

    if err:
        raise Exception(f'Failed to fetch price lists: {err}')

    if resp.status_code != 200:
        raise Exception(f'Unexpected status when fetching price lists: {resp.status_code} - {resp.text}')

    data = resp.json().get('data', [])
    processed = []
    for pl in data:
        processed.append({
            'name': pl.get('name'),
            'price_list_name': pl.get('price_list_name'),
            'currency': pl.get('currency'),
            'enabled': pl.get('enabled'),
            'auto_update_enabled': bool(pl.get('auto_update_enabled')),
            'auto_update_formula': pl.get('auto_update_formula') or '',
            'custom_exchange_rate': float(pl.get('custom_exchange_rate') or 0.0),
            'selling': pl.get('selling'),
            'buying': pl.get('buying')
        })

    return processed


def calculate_sale_price(purchase_price: float, formula: str, context: Dict[str, Any]) -> Tuple[float, str]:
    """Calculate the sale price/rate from a purchase price using a formula.

    Args:
        purchase_price: numeric base (compra)
        formula: formula string (may include IF/AND/OR and Math.*)
        context: additional values used by formula (e.g. 'actual', 'last_purchase_rate')

    Returns:
        Tuple of (calculated_value, error_message). If error_message is not empty,
        calculated_value may be None.
    """
    try:
        # Map common context keys into names expected by translator/evaluator
        actual = float(context.get('actual', 0) or 0)
        compra = float(purchase_price or context.get('compra') or context.get('cost') or 0)

        pyexpr = _translate_and_sanitize_formula(formula or '')
        if not pyexpr:
            return (None, 'Empty formula')

        result = safe_eval_formula(pyexpr, actual=actual, compra=compra)

        # We expect numeric result for a rate; booleans are considered invalid for rate
        if isinstance(result, bool):
            return (None, 'Formula evaluated to boolean; numeric rate expected')

        return (float(result), '')
    except Exception as e:
        tb = traceback.format_exc()
        return (None, f'Formula evaluation error: {e} - {tb}')


def build_bulk_payload(items: List[Dict[str, Any]], auto_price_lists: List[Dict[str, Any]], list_type: str = 'sales', source_currency: str = None, source_exchange_rate: float = None, pivot_currency: str = None, sale_price_map: Dict = None, company_abbr: str = None) -> Dict[str, Any]:
    """Build payload(s) required for bulk import of updated prices.

    Given a list of computed updates (or items to compute) and a list of automatable
    price lists, returns a mapping of price_list_name -> CSV string ready for import
    and a flat list of update dicts useful for previews.

    Args:
        items: list of item dicts. Each item must include at least 'item_code' and
               either 'compra' or 'cost' (purchase price). May include 'actual'.
        auto_price_lists: list of price list dicts as returned by fetch_auto_price_lists()
        list_type: 'sales' or 'purchase' controls selling flag in CSV
        sale_price_map: dict mapping (item_code, price_list) -> existing sale Item Price doc

    Returns:
        { 'csv_by_price_list': { price_list_name: csv_string }, 'updates': [ {item_code, price_list, rate, currency, selling} ] }
    """
    updates = []
    selling_flag = 1 if list_type == 'sales' else 0
    sale_price_map = sale_price_map or {}
    missing_identifiers: Dict[str, List[str]] = {}

    # determine pivot currency from caller (should already be resolved)
    if not pivot_currency:
        raise ValueError("Pivot currency is required to build automation payloads.")

    # Add company abbr to item_codes if provided
    processed_items = []
    for item in items:
        processed_item = dict(item)
        item_code = processed_item.get('item_code')
        if item_code and company_abbr:
            processed_item['item_code'] = add_company_abbr(item_code, company_abbr)
        processed_items.append(processed_item)

    for item in processed_items:
        item_code = item.get('item_code')
        compra = float(item.get('compra') or item.get('cost') or 0)
        actual = float(item.get('actual') or 0)

        for pl in auto_price_lists:
            if not pl.get('auto_update_enabled'):
                continue
            formula = pl.get('auto_update_formula') or ''
            try:
                # Determine currencies and exchange rates
                selling_currency = (pl.get('currency'))
                selling_exchange = float(pl.get('custom_exchange_rate') or 0.0)

                # Compute compra in pivot currency (ARS)
                if not source_currency or source_currency == pivot_currency:
                    compra_in_pivot = compra
                    actual_in_pivot = actual
                else:
                    if source_exchange_rate and float(source_exchange_rate) > 0:
                        compra_in_pivot = compra * float(source_exchange_rate)
                        actual_in_pivot = actual * float(source_exchange_rate)
                    else:
                        # No exchange rate provided for source; assume no conversion and log a warning
                        compra_in_pivot = compra
                        actual_in_pivot = actual

                # Evaluate formula in pivot currency (so price.compra in formulas refers to pivot)
                rate_pivot, err = calculate_sale_price(compra_in_pivot, formula, {'actual': actual_in_pivot, 'compra': compra_in_pivot})
                if err:
                    updates.append({'item_code': item_code, 'price_list': pl.get('price_list_name') or pl.get('name'), 'error': err})
                    continue

                # Convert resulting pivot-rate to selling currency if needed
                if selling_currency == pivot_currency:
                    final_rate = float(rate_pivot)
                else:
                    if selling_exchange and selling_exchange > 0:
                        final_rate = float(rate_pivot) / float(selling_exchange)
                    else:
                        # No selling exchange provided; assume pivot==selling for lack of info
                        final_rate = float(rate_pivot)

                # Look up existing sale Item Price identifier for this item_code + price_list
                pl_name = pl.get('price_list_name') or pl.get('name')
                sale_key = (item_code, pl_name)
                existing_sale_price = sale_price_map.get(sale_key)
                item_price_name = existing_sale_price.get('name') if existing_sale_price else None
                if not item_price_name:
                    bucket = missing_identifiers.setdefault(pl_name, [])
                    if len(bucket) < 5:
                        bucket.append(item_code)

                updates.append({
                    'item_code': item_code,
                    'price_list': pl_name,
                    'rate': round(final_rate, 4) if final_rate is not None else 0,
                    'item_price_name': item_price_name,
                    'currency': selling_currency,
                    'selling': selling_flag
                })
            except Exception as e:
                updates.append({'item_code': item_code, 'price_list': pl.get('price_list_name') or pl.get('name'), 'error': str(e)})

    if missing_identifiers:
        for pl_name, samples in missing_identifiers.items():
            print(f"[AUTOMATION SERVICE] Missing Item Price identifiers for '{pl_name}'. Samples: {', '.join(samples)}")

    # Group updates per price list and build CSVs
    csv_by_price_list = {}
    grouped = {}
    for u in updates:
        if 'error' in u:
            continue
        pl_name = u.get('price_list')
        grouped.setdefault(pl_name, []).append(u)

    for pl_name, rows in grouped.items():
        print(f"--- [CSV BUILDER] Building CSV for price list '{pl_name}' with {len(rows)} rows ---")
        if rows:
            sample = rows[0]
            print(f"    Sample row: item_code={sample.get('item_code')} rate={sample.get('rate')} selling={sample.get('selling')} item_price_name={sample.get('item_price_name')}")
        
        # Determine identifier coverage: require ALL rows to have item_price_name or NONE.
        total_rows = len(rows)
        id_count = sum(1 for r in rows if r.get('item_price_name'))
        print(f"    Identifier coverage: {id_count}/{total_rows} rows have item_price_name")
        
        if id_count == 0:
            raise Exception(f"Missing Item Price identifiers for price list '{pl_name}'. Cannot build update payload.")
        if 0 < id_count < total_rows:
            raise Exception(f"Mixed identifiers for price list '{pl_name}': {id_count}/{total_rows} rows have item_price_name.")

        # All rows have ids -> perform updates.
        csv_result = _build_csv_rows_for_updates(rows)
        if isinstance(csv_result, tuple):
            csv_text, has_ids = csv_result
        else:
            csv_text, has_ids = csv_result, False
        # Ensure has_ids is True only when all rows had identifiers
        has_ids = (id_count == total_rows and total_rows > 0)
        csv_by_price_list[pl_name] = { 'csv': csv_text, 'has_identifiers': bool(has_ids) }

    return {'csv_by_price_list': csv_by_price_list, 'updates': updates}


def apply_automatic_updates(items: List[Dict[str, Any]], session, perform_import: bool = False, list_type: str = 'sales', source_currency: str = None, source_exchange_rate: float = None, sale_price_map: Dict = None, company_abbr: str = None, company_name: str = None) -> Dict[str, Any]:
    """Orchestrate automatic update flow.

    Steps:
      1. Fetch automatable price lists (selling/buying depending on list_type)
      2. Calculate rates per item & price list
      3. Build CSV payloads grouped per Price List
      4. Optionally perform the Data Import in ERPNext (perform_import=True)

    Args:
      items: list of items with 'item_code' and purchase price ('compra'/'cost')
      session: authenticated requests.Session
      perform_import: if True, upload CSV(s) and start Data Import for each price list
      list_type: 'sales' or 'purchase'

    Returns:
      Dict with keys: success, results (list per price list), csv_previews (first lines), errors
    """
    result = {'success': True, 'results': [], 'csv_previews': {}, 'errors': []}
    try:
        pivot_currency = _resolve_pivot_currency(session, company_name)
    except Exception as e:
        return {'success': False, 'message': str(e)}

    try:
        print("--- [AUTOMATION SERVICE] apply_automatic_updates called ---")
        print(f"    Received items: {len(items) if items is not None else 0}, list_type={list_type}")
        print(f"    source_currency={source_currency}, source_exchange_rate={source_exchange_rate}")
        # Print sample of incoming items
        if items:
            for i, it in enumerate(items[:20]):
                price_front = it.get('price') if isinstance(it, dict) else None
                compra = it.get('compra') if isinstance(it, dict) else None
                cost = it.get('cost') if isinstance(it, dict) else None
                actual = it.get('actual') if isinstance(it, dict) else None
                print(f"    Item[{i}]: item_code={it.get('item_code')} item_name={it.get('item_name')} price(front)={price_front} compra={compra} cost={cost} actual={actual}")

        auto_price_lists = fetch_auto_price_lists(session, list_type=list_type)
        print(f"--- [AUTOMATION SERVICE] Fetched {len(auto_price_lists)} automatable price lists for list_type={list_type} ---")
        for i, pl in enumerate(auto_price_lists[:10]):
            print(f"    [{i}] {pl.get('price_list_name')} selling={pl.get('selling')} buying={pl.get('buying')} auto_enabled={pl.get('auto_update_enabled')}")
    except Exception as e:
        return {'success': False, 'message': f'Failed to fetch automatable price lists: {e}'}

    # Debug: print fetched price lists and currencies
    try:
        print("--- [AUTOMATION SERVICE] Fetched automatable price lists ---")
        for pl in auto_price_lists:
            print(f"    PriceList: {pl.get('price_list_name') or pl.get('name')} currency={pl.get('currency')} custom_exchange_rate={pl.get('custom_exchange_rate')} auto_enabled={pl.get('auto_update_enabled')}")
    except Exception:
        pass

    # Pass source currency/exchange rate into the payload builder via a small wrapper
    if not sale_price_map:
        item_codes = [it.get('item_code') for it in items if isinstance(it, dict)]
        price_list_names = [pl.get('price_list_name') or pl.get('name') for pl in auto_price_lists if pl.get('auto_update_enabled')]
        sale_price_map = _fetch_sale_price_map(session, item_codes, price_list_names, company_abbr)

    payload = build_bulk_payload(
        items,
        auto_price_lists,
        list_type=list_type,
        source_currency=source_currency,
        source_exchange_rate=source_exchange_rate,
        pivot_currency=pivot_currency,
        sale_price_map=sale_price_map,
        company_abbr=company_abbr
    )
    csvs = payload.get('csv_by_price_list', {})
    updates = payload.get('updates', [])

    # Collect preview lines
    for pl_name, csv_info in csvs.items():
        csv_text = csv_info.get('csv') if isinstance(csv_info, dict) else csv_info
        lines = csv_text.split('\n')[:21]
        result['csv_previews'][pl_name] = lines

    # Debug: print CSV previews and computed updates for inspection
    try:
        print("--- [AUTOMATION SERVICE] CSV previews ---")
        for pl_name, lines in result['csv_previews'].items():
            print(f"    Preview for {pl_name} (first {len(lines)} lines):")
            for ln in lines[:10]:
                print(f"        {ln}")
        print("--- [AUTOMATION SERVICE] Computed updates (first 50) ---")
        for u in updates[:50]:
            print(f"    Update: item_code={u.get('item_code')} price_list={u.get('price_list')} rate={u.get('rate')} currency={u.get('currency')} selling={u.get('selling')} error={u.get('error')}")
    except Exception:
        pass

    # If perform_import, execute upload + create Data Import + start import per price list
    if perform_import and csvs:
        try:
            for pl_name, csv_info in csvs.items():
                # csv_info is { 'csv': ..., 'has_identifiers': bool }
                csv_text = csv_info.get('csv') if isinstance(csv_info, dict) else csv_info
                has_ids = bool(csv_info.get('has_identifiers')) if isinstance(csv_info, dict) else False
                files = {
                    'file': (f'import_{pl_name}.csv', csv_text.encode('utf-8'), 'text/csv'),
                    'is_private': (None, '0'),
                    'folder': (None, 'Home')
                }
                # upload
                upload_headers = {k: v for k, v in session.headers.items()} if hasattr(session, 'headers') else {}
                upload_headers = {k: v for k, v in upload_headers.items() if k.lower() != 'content-type'}
                upload_resp = session.post(f"{ERPNEXT_URL}/api/method/upload_file", files=files, headers=upload_headers)
                if upload_resp.status_code not in [200, 201]:
                    result['errors'].append({'price_list': pl_name, 'error': f'Upload failed: {upload_resp.status_code} {upload_resp.text}'})
                    continue
                upload_json = upload_resp.json()
                file_url = upload_json.get('message', {}).get('file_url') or upload_json.get('message', {}).get('file_name')
                if not file_url:
                    result['errors'].append({'price_list': pl_name, 'error': f'No file_url after upload: {upload_json}'})
                    continue

                # Create Data Import document
                import_type = 'Update Existing Records' if has_ids else 'Insert New Records'
                import_doc_data = {
                    'reference_doctype': 'Item Price',
                    'import_type': import_type,
                    'submit_after_import': 0,
                    'import_file': file_url,
                    'mute_emails': 1
                }
                create_import_resp, create_import_err = make_erpnext_request(
                    session=session,
                    method='POST',
                    endpoint='/api/resource/Data Import',
                    data={'data': import_doc_data},
                    operation_name=f'Create data import for {pl_name}'
                )
                if create_import_err or create_import_resp.status_code not in [200, 201]:
                    result['errors'].append({'price_list': pl_name, 'error': f'Create Data Import failed: {create_import_err or create_import_resp.text}'})
                    continue
                import_name = create_import_resp.json().get('data', {}).get('name')

                # Start import
                start_resp, start_err = make_erpnext_request(
                    session=session,
                    method='POST',
                    endpoint='/api/method/frappe.core.doctype.data_import.data_import.form_start_import',
                    data={'data_import': import_name},
                    operation_name=f'Start data import {import_name}'
                )
                if start_err or start_resp.status_code not in [200, 201]:
                    result['errors'].append({'price_list': pl_name, 'error': f'Start import failed: {start_err or start_resp.text}'})
                    continue

                result['results'].append({'price_list': pl_name, 'import_name': import_name})

        except Exception as e:
            tb = traceback.format_exc()
            result['errors'].append({'error': f'Exception during import: {e} - {tb}'})

    # Always include flat updates list for diagnostics
    result['updates'] = updates
    return result


def get_effective_exchange_rate(price_list_doc: Dict[str, Any], global_rate_lookup) -> float:
    """
    Determine the effective exchange rate for a Price List document.

    If the Price List has a non-negative `custom_exchange_rate` that value is
    returned. If `custom_exchange_rate` == -1 (sentinel for "general"), the
    function will consult `global_rate_lookup` to obtain the current global
    exchange rate for the Price List currency.

    Args:
        price_list_doc: dict containing at least 'currency' and
            'custom_exchange_rate' keys (as returned by ERPNext API)
        global_rate_lookup: either a callable(session, currency)->float or a
            dict-like mapping currency->rate. The callable form is preferred
            when a session is required to fetch latest rates.

    Returns:
        effective_rate (float) or None when unknown.
    """
    try:
        cer = price_list_doc.get('custom_exchange_rate')
        # Accept None / missing as specific with value 0
        if cer is None:
            return None

        try:
            cer_val = float(cer)
        except Exception:
            # If conversion fails, return None to indicate unknown
            return None

        if cer_val >= 0:
            return cer_val

        # sentinel for general/global
        if cer_val == -1:
            currency = price_list_doc.get('currency')
            if not currency:
                return None
            # global_rate_lookup may be callable or mapping
            try:
                if callable(global_rate_lookup):
                    return global_rate_lookup(currency)
                else:
                    return global_rate_lookup.get(currency)
            except Exception:
                return None

        return None
    except Exception:
        return None


def schedule_price_list_recalculation(price_list_name: str, session) -> Dict[str, Any]:
    """
    Recalculate selling prices for all automated sales price lists that
    depend on the given purchase price list.

    This function will:
      - fetch the purchase Price List doc to discover currency and
        custom_exchange_rate
      - fetch Item Price rows (buying=1) that belong to the purchase price list
      - build a minimal 'items' list with 'item_code' and 'compra' (purchase price)
      - call `apply_automatic_updates(..., perform_import=True, list_type='sales')`
        to compute and persist selling prices via the existing bulk-import flow

    Important: this function updates SALES price lists based on purchase prices,
    NOT the purchase price list itself.

    Args:
        price_list_name: the purchase price list name (human-readable)
        session: authenticated requests.Session used to call ERPNext APIs

    Returns:
        dict with summary keys: success, processed_items, results, errors
    """
    result = {'success': True, 'processed_items': 0, 'results': [], 'errors': []}
    try:
        print(f"[AUTOMATION] Recalculating dependent sales price lists for: {price_list_name}")

        # Fetch purchase Price List doc
        from urllib.parse import quote
        pl_resp, pl_err = make_erpnext_request(
            session=session,
            method='GET',
            endpoint=f"/api/resource/Price List/{quote(price_list_name)}",
            operation_name=f"Get Price List '{price_list_name}'"
        )

        if pl_err:
            err_text = str(pl_err)
            print(f"[AUTOMATION] Error fetching Price List {price_list_name}: {err_text}")
            return {'success': False, 'error': err_text}

        if pl_resp.status_code != 200:
            txt = pl_resp.text if pl_resp is not None else 'No response'
            print(f"[AUTOMATION] Unexpected status fetching price list {price_list_name}: {txt}")
            return {'success': False, 'error': f'Unexpected status: {pl_resp.status_code}'}

        pl_doc = pl_resp.json().get('data', {})
        source_currency = pl_doc.get('currency')
        company = pl_doc.get('company')
        if not company:
            print(f"[AUTOMATION] No company found for price list {price_list_name}")
            return {'success': False, 'error': 'No company associated with price list'}
        
        company_abbr = get_company_abbr(session, {}, company)
        if not company_abbr:
            print(f"[AUTOMATION] Could not get abbr for company {company}")
            return {'success': False, 'error': f'Could not get abbr for company {company}'}
        
        print(f"[AUTOMATION] Using company '{company}' with abbr '{company_abbr}'")
        try:
            pivot_currency = _resolve_pivot_currency(session, company)
        except Exception as e:
            print(f"[AUTOMATION] No se pudo resolver la moneda pivote: {e}")
            return {'success': False, 'error': str(e)}
        # Determine source exchange rate: use global lookup that queries Currency Exchange
        def _global_lookup(currency_code):
            try:
                filters = [["from_currency", "=", currency_code], ["to_currency", "=", pivot_currency]]
                params = {
                    'fields': '["exchange_rate"]',
                    'filters': str(filters).replace("'", '"'),
                    'order_by': 'creation desc',
                    'limit': 1
                }
                resp, err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint='/api/resource/Currency Exchange',
                    params=params,
                    operation_name='Get latest currency exchange for automation'
                )
                if err or resp.status_code != 200:
                    return None
                rows = resp.json().get('data', [])
                if not rows:
                    return None
                return float(rows[0].get('exchange_rate'))
            except Exception:
                return None

        source_exchange = get_effective_exchange_rate(pl_doc, _global_lookup)

        # Fetch Item Price rows belonging to this purchase price list
        filters = [["price_list", "=", price_list_name], ["buying", "=", 1]]
        params = {
            'fields': '["name","item_code","item_name","price_list_rate"]',
            'filters': str(filters).replace("'", '"'),
            'limit_page_length': 10000
        }
        ip_resp, ip_err = make_erpnext_request(
            session=session,
            method='GET',
            endpoint='/api/resource/Item Price',
            params=params,
            operation_name=f'Get Item Prices for purchase price list {price_list_name}'
        )

        if ip_err:
            print(f"[AUTOMATION] Error fetching Item Prices for {price_list_name}: {ip_err}")
            return {'success': False, 'error': str(ip_err)}

        if ip_resp.status_code != 200:
            print(f"[AUTOMATION] Unexpected status fetching Item Prices: {ip_resp.status_code}")
            return {'success': False, 'error': f'Unexpected status: {ip_resp.status_code}'}

        items = ip_resp.json().get('data', [])
        mapped_items = []
        
        # Extract item codes to fetch corresponding sale prices
        item_codes = [it.get('item_code') for it in items if it.get('item_code')]
        
        # Fetch existing sale Item Prices for these items to get correct identifiers
        sale_price_map = {}
        if item_codes:
            item_code_filters = [["item_code", "in", item_codes], ["selling", "=", 1]]
            sale_params = {
                'fields': '["name","item_code","price_list","valid_from","modified","creation","price_list_rate"]',
                'filters': str(item_code_filters).replace("'", '"'),
                'limit_page_length': 10000
            }
            sale_resp, sale_err = make_erpnext_request(
                session=session,
                method='GET',
                endpoint='/api/resource/Item Price',
                params=sale_params,
                operation_name=f'Get Item Prices for sales to find identifiers'
            )
            
            if not sale_err and sale_resp.status_code == 200:
                sale_items = sale_resp.json().get('data', [])
                for si in sale_items:
                    ic = si.get('item_code')
                    if ic:
                        ic = add_company_abbr(ic, company_abbr)
                    pl = si.get('price_list')
                    key = (ic, pl)
                    sale_price_map[key] = _select_latest_row(sale_price_map.get(key), si)
                if sale_price_map:
                    sample = list(sale_price_map.items())[:5]
                    print("[AUTOMATION SERVICE] Sample sale Item Price identifiers resolved:")
                    for (code, pl), row in sample:
                        print(f"    code={code} price_list={pl} name={row.get('name')} valid_from={row.get('valid_from')} modified={row.get('modified')}")
        
        for it in items:
            try:
                item_code = it.get('item_code')
                if item_code:
                    item_code = add_company_abbr(item_code, company_abbr)
                compra_val = it.get('price_list_rate')
                if compra_val is None:
                    # fallback to rate or 0
                    compra_val = it.get('rate') or 0
                try:
                    compra_num = float(compra_val)
                except Exception:
                    compra_num = 0.0
                
                # DO NOT include item_price_name from purchase - we'll add it per sale price list later
                mapped_items.append({
                    'item_code': item_code,
                    'compra': compra_num,
                    'item_name': it.get('item_name')
                })
            except Exception as e:
                print(f"[AUTOMATION] Skipping item during mapping: {e}")

        result['processed_items'] = len(mapped_items)
        
        # Store sale_price_map for use in build_bulk_payload
        result['sale_price_map'] = sale_price_map

        if not mapped_items:
            print(f"[AUTOMATION] No purchase items found for {price_list_name}")
            return result

        # Delegate to apply_automatic_updates to compute & persist selling prices
        try:
            au_result = apply_automatic_updates(
                mapped_items,
                session,
                perform_import=True,
                list_type='sales',
                source_currency=source_currency,
                source_exchange_rate=source_exchange,
                sale_price_map=sale_price_map,
                company_abbr=company_abbr,
                company_name=company
            )
            result['results'] = au_result
        except Exception as e:
            tb = traceback.format_exc()
            result['success'] = False
            result['errors'].append({'error': str(e), 'trace': tb})

        return result
    except Exception as e:
        tb = traceback.format_exc()
        return {'success': False, 'error': f'{e}', 'trace': tb}


def apply_global_exchange_rate(session, currency: str, new_rate: float):
    """
    Called when the global exchange rate for a given currency changes.

    This helper finds purchase price lists that are configured to use the "general"
    exchange rate (i.e. have custom_exchange_rate == -1) for the given currency,
    and schedules recalculation for each affected price list. It returns a
    summary dict listing which purchase price lists were detected and scheduled.

    Args:
        session: authenticated requests.Session to call ERPNext APIs
        currency: currency code (e.g. 'USD') whose global rate changed
        new_rate: the new exchange rate value

    Returns:
        dict: { success: bool, purchase_price_lists: [ {name, price_list_name} ], scheduled: [name,...], errors: [...] }
    """
    result = {"success": True, "purchase_price_lists": [], "scheduled": [], "errors": []}
    try:
        # Fetch purchase Price List documents that are buying=1 and have custom_exchange_rate == -1
        filters = [["buying", "=", 1], ["currency", "=", currency], ["custom_exchange_rate", "=", -1]]
        params = {
            'fields': '["name","price_list_name","currency","custom_exchange_rate"]',
            'filters': str(filters).replace("'", '"'),
            'limit_page_length': 500
        }

        resp, err = make_erpnext_request(
            session=session,
            method='GET',
            endpoint='/api/resource/Price List',
            params=params,
            operation_name='Fetch purchase price lists using general exchange rate'
        )

        if err:
            result['success'] = False
            result['errors'].append(str(err))
            return result

        if resp.status_code != 200:
            result['success'] = False
            result['errors'].append(f'Unexpected status when fetching price lists: {resp.status_code}')
            return result

        pls = resp.json().get('data', [])
        for pl in pls:
            try:
                result['purchase_price_lists'].append({'name': pl.get('name'), 'price_list_name': pl.get('price_list_name')})
                # For now, schedule recalculation (lightweight) for each purchase price list
                try:
                    # Pass session so the scheduler can fetch Item Prices and Price List docs
                    sched = schedule_price_list_recalculation(pl.get('name'), session)
                    if sched and sched.get('success'):
                        result['scheduled'].append(pl.get('name'))
                    else:
                        result['errors'].append({'price_list': pl.get('name'), 'error': sched})
                except Exception as se:
                    result['errors'].append({'price_list': pl.get('name'), 'error': str(se)})
            except Exception as e:
                result['errors'].append({'price_list': pl, 'error': str(e)})

        # Return summary
        return result
    except Exception as e:
        tb = traceback.format_exc()
        return {"success": False, "purchase_price_lists": [], "scheduled": [], "errors": [f'{e} - {tb}']}
