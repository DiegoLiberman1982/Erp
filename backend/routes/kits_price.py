from flask import Blueprint, request, jsonify
import traceback
import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from routes.auth_utils import get_session_with_auth
from routes.general import get_company_abbr, get_smart_limit
from utils.http_utils import make_erpnext_request, handle_erpnext_error


kits_price_bp = Blueprint('kits_price', __name__)


def _parse_erp_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        if isinstance(value, datetime):
            return value
        s = str(value)
        # fromisoformat handles 'YYYY-MM-DD' and 'YYYY-MM-DD HH:MM:SS[.ffffff]'
        return datetime.fromisoformat(s)
    except Exception:
        try:
            s = str(value).split('.')[0]
            return datetime.strptime(s, '%Y-%m-%d %H:%M:%S')
        except Exception:
            try:
                return datetime.strptime(str(value), '%Y-%m-%d')
            except Exception:
                return None


def _is_price_row_valid_now(row: Dict[str, Any], now: datetime) -> bool:
    try:
        vf = _parse_erp_datetime(row.get('valid_from'))
        vu = _parse_erp_datetime(row.get('valid_upto'))
        if vf and vf > now:
            return False
        if vu and vu < now:
            return False
        return True
    except Exception:
        return True


def _pick_latest_price_row(rows: List[Dict[str, Any]], now: datetime) -> Optional[Dict[str, Any]]:
    """Pick latest *valid* Item Price row. If latest has ties, pick the most expensive."""
    if not rows:
        return None

    valid_rows = [r for r in rows if _is_price_row_valid_now(r, now)]
    if not valid_rows:
        return None

    def _priority(row: Dict[str, Any]) -> Tuple[datetime, float]:
        vf = _parse_erp_datetime(row.get('valid_from'))
        md = _parse_erp_datetime(row.get('modified'))
        cr = _parse_erp_datetime(row.get('creation'))
        dt = vf or md or cr or datetime.fromtimestamp(0)
        try:
            rate = float(row.get('price_list_rate') or 0)
        except Exception:
            rate = 0.0
        return dt, rate

    best = None
    best_dt = None
    best_rate = None
    for r in valid_rows:
        dt, rate = _priority(r)
        if best is None:
            best = r
            best_dt = dt
            best_rate = rate
            continue
        if dt > best_dt:
            best = r
            best_dt = dt
            best_rate = rate
            continue
        if dt == best_dt and rate > (best_rate or 0.0):
            best = r
            best_dt = dt
            best_rate = rate
    return best


def _chunk_list(values: List[Any], size: int) -> List[List[Any]]:
    if size <= 0:
        return [values]
    return [values[i:i + size] for i in range(0, len(values), size)]


def _fetch_price_lists_bulk(
    session,
    price_list_names: List[str],
    limit_page_length: int,
    chunk_size: int = 200
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[Dict[str, Any]]]:
    all_rows: List[Dict[str, Any]] = []
    for chunk in _chunk_list(price_list_names, chunk_size):
        payload = {
            "doctype": "Price List",
            "fields": ["name", "currency", "custom_exchange_rate", "buying", "selling", "custom_company"],
            "filters": {
                "name": ["in", chunk],
                "docstatus": ["in", [0, 1]]
            },
            "limit_page_length": limit_page_length
        }
        resp, err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            operation_name=f"Fetch Price Lists (bulk chunk size={len(chunk)})",
            data=payload
        )
        if err:
            return None, err
        if not resp or resp.status_code != 200:
            return None, {"success": False, "message": f"ERPNext error fetching Price Lists: {resp.text if resp else ''}"}
        all_rows.extend(resp.json().get('message', []) or [])
    return all_rows, None


def _fetch_exchange_rate_from_erpnext(
    session,
    from_currency: str,
    to_currency: str
) -> Tuple[Optional[float], Optional[Dict[str, Any]]]:
    """Return latest Currency Exchange rate from ERPNext (direct or inverse)."""
    if not from_currency or not to_currency:
        return None, {"success": False, "message": "Missing from/to currency"}
    if from_currency == to_currency:
        return 1.0, None

    fields = '["name","from_currency","to_currency","exchange_rate","date"]'
    filters = f'[["from_currency","=","{from_currency}"],["to_currency","=","{to_currency}"]]'
    resp, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Currency Exchange",
        params={
            "fields": fields,
            "filters": filters,
            "order_by": "date desc",
            "limit": 1
        },
        operation_name="Get exchange rate (kits purchase)"
    )
    if err:
        return None, err
    if resp and resp.status_code == 200:
        rows = resp.json().get('data', []) or []
        if rows:
            try:
                return float(rows[0].get('exchange_rate', 1)), None
            except Exception:
                return None, {"success": False, "message": "Invalid exchange_rate value"}

    # Inverse fallback
    filters_inv = f'[["from_currency","=","{to_currency}"],["to_currency","=","{from_currency}"]]'
    resp2, err2 = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Currency Exchange",
        params={
            "fields": fields,
            "filters": filters_inv,
            "order_by": "date desc",
            "limit": 1
        },
        operation_name="Get inverse exchange rate (kits purchase)"
    )
    if err2:
        return None, err2
    if resp2 and resp2.status_code == 200:
        rows = resp2.json().get('data', []) or []
        if rows:
            try:
                inv = float(rows[0].get('exchange_rate', 1))
                if inv == 0:
                    return None, {"success": False, "message": "Inverse exchange_rate is 0"}
                return 1.0 / inv, None
            except Exception:
                return None, {"success": False, "message": "Invalid inverse exchange_rate value"}

    return None, {"success": False, "message": f"No exchange rate found for {from_currency}->{to_currency}"}


def _rate_from_price_list_custom_exchange(
    from_currency: str,
    to_currency: str,
    custom_exchange_rate: Any
) -> Optional[float]:
    """Try to build a rate from a Price List's custom_exchange_rate.

    Generic conversion: works for any currency pair.
    custom_exchange_rate represents the rate from price list currency to target currency.
    Returns None when custom_exchange_rate is invalid or currencies are the same.
    """
    if from_currency == to_currency:
        return 1.0
    
    try:
        cer = float(custom_exchange_rate)
    except Exception:
        return None
    
    if cer <= 0:
        return None
    
    # custom_exchange_rate is the direct conversion rate from from_currency to to_currency
    return cer


def _fetch_product_bundle_items_bulk(
    session,
    kit_names: List[str],
    limit_page_length: int
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[Dict[str, Any]]]:
    payload = {
        "doctype": "Product Bundle Item",
        "parent": "Product Bundle",
        "fields": ["name", "parent", "item_code", "qty", "uom", "idx"],
        "filters": {
            "parent": ["in", kit_names],
            "parenttype": "Product Bundle",
            "parentfield": "items"
        },
        "limit_page_length": limit_page_length
    }
    resp, err = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.client.get_list",
        operation_name="Fetch Product Bundle Items (bulk)",
        data=payload
    )
    if err:
        return None, err
    if not resp or resp.status_code != 200:
        return None, {"success": False, "message": f"ERPNext error fetching Product Bundle Items: {resp.text if resp else ''}"}
    return resp.json().get('message', []) or [], None


def _fetch_item_prices_bulk(
    session,
    item_codes: List[str],
    limit_page_length: int,
    chunk_size: int = 200
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[Dict[str, Any]]]:
    all_rows: List[Dict[str, Any]] = []
    for chunk in _chunk_list(item_codes, chunk_size):
        payload = {
            "doctype": "Item Price",
            "fields": [
                "name",
                "item_code",
                "price_list_rate",
                "currency",
                "price_list",
                "buying",
                "valid_from",
                "valid_upto",
                "modified",
                "creation",
                "docstatus"
            ],
            "filters": {
                "item_code": ["in", chunk],
                "buying": 1,
                "docstatus": ["in", [0, 1]]
            },
            "order_by": "valid_from desc",
            "limit_page_length": limit_page_length
        }
        resp, err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            operation_name=f"Fetch Item Prices (bulk chunk size={len(chunk)})",
            data=payload
        )
        if err:
            return None, err
        if not resp or resp.status_code != 200:
            return None, {"success": False, "message": f"ERPNext error fetching Item Prices: {resp.text if resp else ''}"}
        all_rows.extend(resp.json().get('message', []) or [])
    return all_rows, None


@kits_price_bp.route('/api/inventory/kits/purchase-prices', methods=['POST'])
def compute_kits_purchase_prices():
    """Compute kit purchase price as SUM(component_qty * latest_valid_purchase_price(component)).

    Rules:
    - Use latest valid Item Price row per component (valid_from/valid_upto), buying=1.
    - If multiple rows share the latest date, pick the most expensive one.
    - If any component lacks a valid purchase Item Price, omit the kit from results.
    - If a target_currency is provided, convert each component price:
      1) Prefer the purchase Price List's custom_exchange_rate when it applies.
      2) Else fallback to ERPNext Currency Exchange.
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        body = request.get_json(silent=True) or {}
        company = (body.get('company') or '').strip()
        target_currency = (body.get('target_currency') or '').strip() or None
        kit_names = body.get('kit_names') or []
        if not company:
            return jsonify({"success": False, "message": "Se requiere company"}), 400
        if not isinstance(kit_names, list) or len(kit_names) == 0:
            return jsonify({"success": False, "message": "Se requiere kit_names (lista no vacía)"}), 400

        # Smart limit sizing: use a conservative page size; still large enough for bulk fetches.
        smart_limit = get_smart_limit(company, 'list')
        limit_page_length = max(1000, int(smart_limit))

        try:
            company_abbr = get_company_abbr(session, headers, company) or ''
        except Exception:
            company_abbr = ''

        # 1) Fetch kit components in bulk (Product Bundle Item child table)
        pb_items, pb_err = _fetch_product_bundle_items_bulk(session, kit_names, limit_page_length=10000)
        if pb_err:
            return handle_erpnext_error(pb_err, "Failed to fetch kit components")

        kit_components: Dict[str, List[Dict[str, Any]]] = {}
        component_codes_set = set()
        suffix = f" - {company_abbr}" if company_abbr else ""
        for row in pb_items or []:
            parent = (row.get('parent') or '').strip()
            raw_code = (row.get('item_code') or '').strip()
            if not parent or not raw_code:
                continue
            try:
                qty = float(row.get('qty') or 0)
            except Exception:
                qty = 0.0
            if qty <= 0:
                continue
            canonical_code = raw_code
            if suffix and canonical_code and not canonical_code.endswith(suffix):
                canonical_code = f"{canonical_code}{suffix}"
            kit_components.setdefault(parent, []).append({"item_code": canonical_code, "qty": qty, "raw_item_code": raw_code})
            component_codes_set.add(canonical_code)

        component_codes = sorted(component_codes_set)
        if not component_codes:
            return jsonify({"success": True, "data": {}, "missing": {}}), 200

        # 2) Fetch Item Prices in bulk for all component codes
        price_rows, price_err = _fetch_item_prices_bulk(session, component_codes, limit_page_length=limit_page_length, chunk_size=200)
        if price_err:
            return handle_erpnext_error(price_err, "Failed to fetch purchase item prices")

        by_code: Dict[str, List[Dict[str, Any]]] = {}
        for r in price_rows or []:
            code = (r.get('item_code') or '').strip()
            if not code:
                continue
            by_code.setdefault(code, []).append(r)

        now = datetime.now()
        latest_row_by_code: Dict[str, Dict[str, Any]] = {}
        for code, rows in by_code.items():
            best = _pick_latest_price_row(rows, now=now)
            if not best:
                continue
            latest_row_by_code[code] = best

        # If conversion is requested, fetch involved Price Lists to get custom_exchange_rate/currency
        price_list_meta: Dict[str, Dict[str, Any]] = {}
        if target_currency:
            price_list_names = sorted({str(r.get('price_list') or '').strip() for r in latest_row_by_code.values() if r.get('price_list')})
            if price_list_names:
                pls, pl_err = _fetch_price_lists_bulk(session, price_list_names, limit_page_length=limit_page_length, chunk_size=200)
                if pl_err:
                    return handle_erpnext_error(pl_err, "Failed to fetch purchase price lists")
                for pl in pls or []:
                    name = (pl.get('name') or '').strip()
                    if name:
                        price_list_meta[name] = pl

        # Cache exchange rates to avoid repeated ERPNext hits
        rate_cache: Dict[Tuple[str, str], Optional[float]] = {}

        def _get_rate(from_cur: str, to_cur: str, price_list_name: Optional[str]) -> Optional[float]:
            if not from_cur or not to_cur:
                return None
            if from_cur == to_cur:
                return 1.0
            key = (from_cur, to_cur)
            if key in rate_cache:
                return rate_cache[key]

            # 1) Prefer custom_exchange_rate from the originating purchase Price List
            if price_list_name and price_list_name in price_list_meta:
                cer = price_list_meta[price_list_name].get('custom_exchange_rate')
                r = _rate_from_price_list_custom_exchange(from_cur, to_cur, cer)
                if r is not None:
                    rate_cache[key] = r
                    return r

            # 2) Fallback to ERPNext Currency Exchange
            r2, _err2 = _fetch_exchange_rate_from_erpnext(session, from_cur, to_cur)
            if r2 is None:
                rate_cache[key] = None
                return None
            rate_cache[key] = r2
            return r2

        # 3) Compute kit purchase totals (omit kits with missing component prices)
        prices_by_kit: Dict[str, float] = {}
        missing_by_kit: Dict[str, List[str]] = {}

        for kit_name in kit_names:
            comps = kit_components.get(kit_name, [])
            if not comps:
                missing_by_kit[kit_name] = ["<no_components>"]
                continue

            missing: List[str] = []
            total = 0.0
            for c in comps:
                code = c.get('item_code')
                qty = float(c.get('qty') or 0)
                raw_code = c.get('raw_item_code') or code
                row = latest_row_by_code.get(code)
                if not row:
                    missing.append(raw_code)
                    continue
                try:
                    rate_val = float(row.get('price_list_rate') or 0)
                except Exception:
                    missing.append(raw_code)
                    continue

                if target_currency:
                    from_cur = (row.get('currency') or '').strip()
                    pl_name = (row.get('price_list') or '').strip() or None
                    if not from_cur and pl_name and pl_name in price_list_meta:
                        from_cur = (price_list_meta[pl_name].get('currency') or '').strip()
                    if not from_cur:
                        missing.append(raw_code)
                        continue
                    fx = _get_rate(from_cur, target_currency, pl_name)
                    if fx is None:
                        missing.append(f"{raw_code}::<fx {from_cur}->{target_currency}>")
                        continue
                    rate_val = rate_val * fx

                total += rate_val * qty

            if missing:
                missing_by_kit[kit_name] = missing
                continue

            prices_by_kit[kit_name] = round(total, 6)

        # Optional: include abbr info for debugging (not required by frontend)
        meta = {"company_abbr": company_abbr} if company_abbr else {}
        if target_currency:
            meta["target_currency"] = target_currency
        return jsonify({"success": True, "data": prices_by_kit, "missing": missing_by_kit, "meta": meta})
    except Exception as e:
        print(f"Error en compute_kits_purchase_prices: {e}")
        print(traceback.format_exc())
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
