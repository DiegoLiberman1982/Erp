import json
from urllib.parse import quote

from flask import Blueprint, jsonify, request

from config import ERPNEXT_URL
from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_smart_limit
from routes.Configuracion.setup_doctype_inflacion import (
    DOCTYPE_NAME,
    ensure_inflacion_doctype,
)
from utils.http_utils import make_erpnext_request, handle_erpnext_error

inflation_bp = Blueprint("inflation", __name__)

MONTH_MAP = {
    "ene": 1,
    "feb": 2,
    "mar": 3,
    "abr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "sep": 9,
    "sept": 9,
    "oct": 10,
    "nov": 11,
    "dic": 12,
}


def _normalize_number(value):
    """Convert incoming values to float if possible; return None when invalid."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except Exception:
            return None
    # Accept comma as decimal separator (common in AR data)
    text = str(value).strip().replace(",", ".")
    if text == "":
        return None
    try:
        return float(text)
    except Exception:
        return None


def _ensure_doctype(session, headers):
    created = ensure_inflacion_doctype(session, headers, ERPNEXT_URL)
    if not created:
        return jsonify(
            {
                "success": False,
                "message": "No se pudo asegurar el DocType de indices de inflacion",
            }
        ), 500
    return None


def _parse_periodo_tuple(val):
    """Return (year, month) tuple; unknown values become (9999,99)"""
    if not val:
        return (9999, 99)
    txt = str(val).strip()
    # YYYY-MM
    if len(txt) == 7 and txt[4] == "-" and txt[:4].isdigit() and txt[5:].isdigit():
        return (int(txt[:4]), int(txt[5:7]))
    # MMM-YY
    parts = txt.split("-")
    if len(parts) == 2:
        month_part = parts[0].lower()
        year_part = parts[1]
        if month_part in MONTH_MAP and year_part.isdigit():
            yy = int(year_part)
            year = 2000 + yy if yy < 50 else 1900 + yy
            return (year, MONTH_MAP[month_part])
    return (9999, 99)


def _tuple_to_periodo_str(tup, fallback=""):
    year, month = tup
    if year == 9999:
        return fallback
    # prefer MMM-YY
    inv_map = {v: k for k, v in MONTH_MAP.items()}
    month_key = inv_map.get(month, "").title()
    yy = str(year % 100).zfill(2)
    if month_key:
        return f"{month_key}-{yy}"
    return f"{year}-{str(month).zfill(2)}"


def _add_months(period_tuple, months_delta):
    year, month = period_tuple
    total = year * 12 + (month - 1) + months_delta
    if total < 0:
        return (9999, 99)
    new_year = total // 12
    new_month = total % 12 + 1
    return (new_year, new_month)


def _months_diff_inclusive(start_tuple, end_tuple):
    sy, sm = start_tuple
    ey, em = end_tuple
    return (ey - sy) * 12 + (em - sm) + 1


def _fetch_indices(session, headers, user_id):
    company = get_active_company(user_id)
    limit = get_smart_limit(company, "list")
    params = {
        "fields": json.dumps(["name", "periodo", "ipc_nacional", "fuente"]),
        "limit_page_length": limit,
    }
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/{quote(DOCTYPE_NAME, safe='')}",
        params=params,
        operation_name="List inflation indices",
    )
    if error:
        return None, error
    if response and response.status_code == 200:
        data = response.json().get("data", [])
        items = data if isinstance(data, list) else []
        items_sorted = sorted(items, key=lambda row: _parse_periodo_tuple(row.get("periodo")))
        return items_sorted, None
    return None, {
        "success": False,
        "message": "No se pudo obtener la lista de indices",
        "status_code": response.status_code if response else 500,
    }


def _build_index_map(items):
    """Return dict {(year,month): {'value':float,'label':periodo}} sorted list also returned."""
    idx_map = {}
    for row in items or []:
        tup = _parse_periodo_tuple(row.get("periodo"))
        if tup[0] == 9999:
            continue
        try:
            val = _normalize_number(row.get("ipc_nacional"))
            if val is None:
                continue
            if tup not in idx_map:
                idx_map[tup] = {"value": float(val), "label": row.get("periodo") or _tuple_to_periodo_str(tup)}
        except Exception:
            continue
    sorted_items = sorted(idx_map.items(), key=lambda kv: kv[0])
    return idx_map, sorted_items


def _find_contiguous_window(request_start, request_end, available_set):
    """Find contiguous window of length len(request range) ending at or before available data."""
    length = _months_diff_inclusive(request_start, request_end)
    available_months = sorted(list(available_set))
    if not available_months:
        return None, None
    earliest = available_months[0]
    latest = available_months[-1]

    # slide window backwards starting aligned with requested end
    for offset in range(0, 120):  # max 10 years of backtracking
        start_candidate = _add_months(request_start, -offset)
        end_candidate = _add_months(start_candidate, length - 1)
        if end_candidate > latest:
            # shift further back
            continue
        if start_candidate < earliest:
            break
        ok = True
        for i in range(length):
            m = _add_months(start_candidate, i)
            if m not in available_set:
                ok = False
                break
        if ok:
            return start_candidate, end_candidate
    return None, None


@inflation_bp.route("/api/inflation-indices", methods=["GET"])
def list_inflation_indices():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    doctype_error = _ensure_doctype(session, headers)
    if doctype_error:
        return doctype_error

    data, error = _fetch_indices(session, headers, user_id)
    if error:
        return handle_erpnext_error(error, "No se pudieron cargar los indices")

    return jsonify({"success": True, "data": data})


@inflation_bp.route("/api/inflation-indices/bulk", methods=["POST"])
def upsert_inflation_indices():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    doctype_error = _ensure_doctype(session, headers)
    if doctype_error:
        return doctype_error

    payload = request.get_json(silent=True) or {}
    rows = payload.get("rows") or payload.get("indices") or []
    if not isinstance(rows, list) or len(rows) == 0:
        return (
            jsonify({"success": False, "message": "No se recibieron datos para guardar"}),
            400,
        )

    normalized = []
    errors = []
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            errors.append(f"Fila {idx + 1}: formato invalido")
            continue

        periodo = str(row.get("periodo") or row.get("mes") or "").strip()
        ipc_val = _normalize_number(row.get("ipc_nacional"))
        fuente = (row.get("fuente") or "").strip() or "FACPCE"
        name = periodo  # enforce periodo as record name/identifier

        if not periodo:
            errors.append(f"Fila {idx + 1}: periodo requerido")
            continue
        if ipc_val is None:
            errors.append(f"Fila {idx + 1}: IPC Nacional invalido")
            continue

        normalized.append(
            {"name": name or periodo, "periodo": periodo, "ipc_nacional": ipc_val, "fuente": fuente}
        )

    if errors:
        return jsonify({"success": False, "message": "; ".join(errors)}), 400

    created = 0
    updated = 0
    failures = []
    for entry in normalized:
        periodo_key = entry["periodo"]
        record_name = entry["name"] or entry["periodo"]
        base_payload = {
            "data": {
                "name": record_name,
                "periodo": entry["periodo"],
                "ipc_nacional": entry["ipc_nacional"],
                "fuente": entry.get("fuente") or "FACPCE",
            }
        }

        # Resolve existing by periodo via filters (avoids noisy 404s)
        exists_resp, exists_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{quote(DOCTYPE_NAME, safe='')}",
            params={
                "filters": json.dumps([["periodo", "=", periodo_key]]),
                "fields": json.dumps(["name"]),
                "limit_page_length": 1,
            },
            operation_name="Check inflation index by periodo",
        )

        existing_name = None
        if not exists_err and exists_resp and exists_resp.status_code == 200:
            data = exists_resp.json().get("data", [])
            if isinstance(data, list) and data:
                existing_name = data[0].get("name")

        target_name = existing_name or record_name

        if existing_name:
            resp, err = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/{quote(DOCTYPE_NAME, safe='')}/{quote(existing_name, safe='')}",
                data=base_payload,
                operation_name="Update inflation index",
            )
            if err or (resp and resp.status_code not in (200, 201, 202)):
                failures.append(existing_name)
            else:
                updated += 1
        else:
            resp, err = make_erpnext_request(
                session=session,
                method="POST",
                endpoint=f"/api/resource/{quote(DOCTYPE_NAME, safe='')}",
                data=base_payload,
                operation_name="Create inflation index",
            )
            if err or (resp and resp.status_code not in (200, 201, 202)):
                failures.append(target_name)
            else:
                created += 1

    refreshed, refresh_error = _fetch_indices(session, headers, user_id)
    if refresh_error:
        return handle_erpnext_error(
            refresh_error, "Guardado parcial: no se pudo refrescar la lista"
        )

    message_parts = []
    if created:
        message_parts.append(f"{created} creados")
    if updated:
        message_parts.append(f"{updated} actualizados")
    if failures:
        message_parts.append(f"{len(failures)} con error")

    return jsonify(
        {
            "success": len(failures) == 0,
            "data": {"rows": refreshed, "failed": failures},
            "message": "; ".join(message_parts) if message_parts else "Sin cambios",
        }
    )


@inflation_bp.route("/api/inflation/adjust", methods=["POST"])
def adjust_by_inflation():
    """Calcular factor de ajuste por inflacion entre dos periodos y opcionalmente aplicarlo a items."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    doctype_error = _ensure_doctype(session, headers)
    if doctype_error:
        return doctype_error

    payload = request.get_json(silent=True) or {}
    from_period = payload.get("from_period") or payload.get("from")
    to_period = payload.get("to_period") or payload.get("to")
    items = payload.get("items") or []
    base = (payload.get("base") or "actual").lower()

    if not from_period or not to_period:
        return jsonify({"success": False, "message": "from_period y to_period son requeridos"}), 400

    start_tuple = _parse_periodo_tuple(from_period)
    end_tuple = _parse_periodo_tuple(to_period)

    if start_tuple[0] == 9999 or end_tuple[0] == 9999:
        return jsonify({"success": False, "message": "Periodos invalidos"}), 400

    if end_tuple < start_tuple:
        return jsonify({"success": False, "message": "El periodo destino debe ser posterior al origen"}), 400

    raw_indices, err = _fetch_indices(session, headers, user_id)
    if err:
        return handle_erpnext_error(err, "No se pudieron leer los indices")

    idx_map, sorted_items = _build_index_map(raw_indices)
    available_set = set(idx_map.keys())

    used_start, used_end = _find_contiguous_window(start_tuple, end_tuple, available_set)
    if not used_start or not used_end:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "No se encontro una serie completa para el rango solicitado. Actualiza los indices de inflacion.",
                }
            ),
            400,
        )

    start_val = idx_map[used_start]["value"]
    end_val = idx_map[used_end]["value"]
    if start_val == 0:
        return jsonify({"success": False, "message": "Indice inicial es 0, no se puede calcular factor"}), 400

    factor = float(end_val) / float(start_val)

    adjusted_items = []
    if isinstance(items, list) and items:
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            price_actual = _normalize_number(
                item.get("existing_price") or item.get("valor") or item.get("price")
            )
            price_compra = _normalize_number(item.get("purchase_price"))

            if base == "compra":
                price = price_compra
            else:
                price = price_actual

            # No fallback: si falta el precio de la base elegida, omitir
            if price is None:
                continue

            adjusted_price = round(price * factor, 4)
            adjusted_items.append(
                {
                    "id": item.get("id") or item.get("name") or item.get("item_code") or f"row-{idx}",
                    "item_code": item.get("item_code"),
                    "original_price": price,
                    "adjusted_price": adjusted_price,
                    "factor": factor,
                }
            )

    return jsonify(
        {
            "success": True,
            "data": {
                "factor": factor,
                "used_from_period": idx_map[used_start]["label"],
                "used_to_period": idx_map[used_end]["label"],
                "items": adjusted_items,
            },
            "message": f"Factor aplicado: {round(factor,4)} (de {idx_map[used_start]['label']} a {idx_map[used_end]['label']})",
        }
    )
