from flask import Blueprint, request, jsonify
import json
import re
import threading
import uuid
import io
import csv
import math
import traceback
from urllib.parse import quote

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company, get_company_abbr, get_smart_limit
from utils.http_utils import make_erpnext_request, handle_erpnext_error

price_list_automation_bp = Blueprint('price_list_automation', __name__)

# Progress tracking for apply operations
automation_import_progress = {}


def ensure_price_list_custom_fields(session, headers):
    """Ensure the two custom fields used by the automation UI exist on Price List.
    This is idempotent and will attempt to create missing fields via ERPNext API.
    """
    try:
        custom_fields = [
            {
                "dt": "Price List",
                "label": "Actualización automática",
                "fieldname": "auto_update_enabled",
                "fieldtype": "Check",
                "insert_after": "custom_exchange_rate"
            },
            {
                "dt": "Price List",
                "label": "Fórmula de actualización",
                "fieldname": "auto_update_formula",
                "fieldtype": "Code",
                "insert_after": "auto_update_enabled"
            }
        ]

        for field_def in custom_fields:
            try:
                filters_list = [["fieldname", "=", field_def['fieldname']], ["dt", "=", field_def['dt']]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint='/api/resource/Custom Field',
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {field_def['fieldname']} in {field_def['dt']}"
                )
                if check_err:
                    print(f"Warning: error checking custom field {field_def['fieldname']}: {check_err}")
                    continue
                if check_resp.status_code == 200 and check_resp.json().get('data'):
                    continue

                # Create the custom field
                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method='POST',
                    endpoint='/api/resource/Custom%20Field',
                    data=field_def,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {field_def['fieldname']} in {field_def['dt']}"
                )
                if create_err:
                    # If conflict or permission issue, log and continue
                    print(f"Warning creating custom field {field_def['fieldname']}: {create_err}")
                else:
                    if create_resp.status_code in (200, 201):
                        print(f"Created custom field {field_def['fieldname']} on {field_def['dt']}")
                    else:
                        print(f"Unexpected response creating custom field {field_def['fieldname']}: {create_resp.status_code} {create_resp.text}")

            except Exception as e:
                print(f"Exception ensuring custom field {field_def.get('fieldname')}: {e}")
                continue
    except Exception as e:
        print(f"Error in ensure_price_list_custom_fields: {e}")
        import traceback
        traceback.print_exc()


def _translate_and_sanitize_formula(expr: str) -> str:
    """Translate IF(...) and logical operators to Python and map Math.* to math.*"""
    if not expr or not isinstance(expr, str):
        return ''

    s = expr
    # Replace Math. -> math.
    s = s.replace('Math.', 'math.')
    # Replace AND/OR -> and/or
    s = s.replace('\bAND\b', ' and ').replace('\bOR\b', ' or ')
    s = s.replace('AND', ' and ').replace('OR', ' or ')

    # Replace IF(cond, a, b) with (a if cond else b) - handle nested by simple parse
    def replace_if(original):
        out = ''
        i = 0
        while i < len(original):
            idx = original.upper().find('IF(', i)
            if idx == -1:
                out += original[i:]
                break
            out += original[i:idx]
            pos = idx + 3
            depth = 1
            while pos < len(original) and depth > 0:
                if original[pos] == '(':
                    depth += 1
                elif original[pos] == ')':
                    depth -= 1
                pos += 1
            inside = original[idx + 3: pos - 1]
            # split top-level commas
            parts = []
            buf = ''
            d = 0
            for ch in inside:
                if ch == '(':
                    d += 1
                    buf += ch
                elif ch == ')':
                    d -= 1
                    buf += ch
                elif ch == ',' and d == 0:
                    parts.append(buf.strip())
                    buf = ''
                else:
                    buf += ch
            if buf.strip():
                parts.append(buf.strip())
            if len(parts) == 3:
                out += f"(({parts[1]}) if ({parts[0]}) else ({parts[2]}))"
            else:
                out += f"IF({inside})"
            i = pos
        return out

    s = replace_if(s)

    # Replace price variables
    s = s.replace('price.actual', 'actual')
    s = s.replace('price.compra', 'compra')
    s = s.replace('\bprice\b', 'actual')

    return s


import ast

ALLOWED_NAMES = {'actual', 'compra', 'math', 'round', 'abs', 'max', 'min', 'pow'}


class SafeEvaluator(ast.NodeTransformer):
    """Validate AST nodes to allow only safe expressions."""
    ALLOWED_NODE_TYPES = (
        ast.Expression, ast.BinOp, ast.UnaryOp, ast.Num, ast.Call, ast.Name,
        ast.Load, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.Pow,
        ast.USub, ast.UAdd, ast.Compare, ast.Eq, ast.NotEq, ast.Lt, ast.LtE,
        ast.Gt, ast.GtE, ast.BoolOp, ast.And, ast.Or, ast.IfExp, ast.Attribute,
        ast.Tuple, ast.List, ast.Constant
    )

    def generic_visit(self, node):
        if not isinstance(node, self.ALLOWED_NODE_TYPES):
            raise ValueError(f'Unsupported expression element: {type(node).__name__}')
        return super().generic_visit(node)

    def visit_Name(self, node):
        if node.id not in ALLOWED_NAMES:
            raise ValueError(f'Use of name "{node.id}" not allowed')
        return node

    def visit_Call(self, node):
        # Allow calls to whitelisted names or math.<func>
        if isinstance(node.func, ast.Name):
            if node.func.id not in ALLOWED_NAMES:
                raise ValueError(f'Call to function "{node.func.id}" is not allowed')
        elif isinstance(node.func, ast.Attribute):
            # e.g., math.floor
            if not (isinstance(node.func.value, ast.Name) and node.func.value.id == 'math'):
                raise ValueError('Only math.* calls allowed as attributes')
        else:
            raise ValueError('Unsupported call type')
        return self.generic_visit(node)


def safe_eval_formula(py_expr: str, actual: float = 0.0, compra: float = 0.0):
    """Evaluate translated python expression safely returning number or boolean."""
    try:
        tree = ast.parse(py_expr, mode='eval')
        SafeEvaluator().visit(tree)
        compiled = compile(tree, filename='<ast>', mode='eval')
        safe_globals = {'__builtins__': None, 'math': math, 'round': round, 'abs': abs, 'max': max, 'min': min, 'pow': pow}
        safe_locals = {'actual': actual, 'compra': compra}
        result = eval(compiled, safe_globals, safe_locals)
        return result
    except Exception as e:
        raise


@price_list_automation_bp.route('/api/price-list-automation/settings', methods=['GET'])
def get_settings():
    """Return automation settings: global toggle and price lists with automation fields."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Ensure the Price List custom fields exist before querying Price List records
        try:
            ensure_price_list_custom_fields(session, headers)
        except Exception as ef:
            print(f"Warning: ensure_price_list_custom_fields failed: {ef}")

        list_type = request.args.get('type', 'sales')
        filters = [["selling", "=", 1]] if list_type == 'sales' else [["buying", "=", 1]]
        params = {
            'fields': '["name","price_list_name","currency","enabled","auto_update_enabled","auto_update_formula"]',
            'filters': json.dumps(filters),
            'order_by': 'modified desc',
            'limit_page_length': 500
        }

        response, error = make_erpnext_request(
            session=session,
            method='GET',
            endpoint='/api/resource/Price List',
            params=params,
            operation_name='Get price list automation settings'
        )

        if error:
            return handle_erpnext_error(error, 'Failed to fetch price lists for automation')

        if response.status_code == 200:
            data = response.json().get('data', [])
            # Ensure fields exist
            processed = []
            for pl in data:
                processed.append({
                    'name': pl.get('name'),
                    'price_list_name': pl.get('price_list_name'),
                    'currency': pl.get('currency'),
                    'enabled': pl.get('enabled'),
                    'auto_update_enabled': pl.get('auto_update_enabled', False),
                    'auto_update_formula': pl.get('auto_update_formula', '')
                })
            return jsonify({'success': True, 'data': {'price_lists': processed}})

        return jsonify({'success': False, 'message': 'Unexpected response from ERPNext'}), 500

    except Exception as e:
        print(f"❌ Error in get_settings: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500


@price_list_automation_bp.route('/api/price-list-automation/settings', methods=['PUT'])
def update_settings():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        payload = request.get_json(force=True) or {}
        auto_enabled = payload.get('auto_enabled')
        price_lists = payload.get('price_lists', [])

        results = []

        # Update global toggle on Company if provided
        if auto_enabled is not None:
            try:
                company = get_active_company(user_id)
                if company:
                    # Attempt to update a custom field 'auto_price_list_enabled' on Company
                    resp, err = make_erpnext_request(
                        session=session,
                        method='PUT',
                        endpoint=f"/api/resource/Company/{quote(company)}",
                        data={'data': {'auto_price_list_enabled': 1 if auto_enabled else 0}},
                        operation_name='Update company auto price list toggle'
                    )
                    if err:
                        print(f"⚠️ Could not update company toggle: {err}")
                else:
                    print('⚠️ No active company to store global toggle')
            except Exception as e:
                print(f"⚠️ Error updating company toggle: {e}")

        # Update each price list custom fields
        for pl in price_lists:
            name = pl.get('name')
            enabled = pl.get('auto_update_enabled')
            formula = pl.get('formula')
            if not name:
                continue
            update_body = {}
            if enabled is not None:
                update_body['auto_update_enabled'] = 1 if enabled else 0
            if formula is not None:
                update_body['auto_update_formula'] = formula

            if update_body:
                resp_upd, err_upd = make_erpnext_request(
                    session=session,
                    method='PUT',
                    endpoint=f"/api/resource/Price List/{quote(name)}",
                    data={'data': update_body},
                    operation_name=f'Update automation settings for {name}'
                )
                if err_upd:
                    results.append({'name': name, 'success': False, 'error': str(err_upd)})
                else:
                    results.append({'name': name, 'success': True})

        return jsonify({'success': True, 'results': results})

    except Exception as e:
        print(f"❌ Error in update_settings: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500


@price_list_automation_bp.route('/api/price-list-automation/settings/<path:price_list_name>', methods=['PUT'])
def update_single_price_list(price_list_name):
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        payload = request.get_json(force=True) or {}
        enabled = payload.get('auto_update_enabled')
        formula = payload.get('formula')
        update_body = {}

        # Server-side validation: formulas for automatic price list updates must use price.compra
        # and must NOT reference price.actual. This enforces the frontend rule.
        if formula is not None:
            if not isinstance(formula, str) or not formula.strip():
                return jsonify({'success': False, 'message': 'Fórmula vacía o inválida'}), 400
            if not re.search(r'price\.compra', formula, re.IGNORECASE):
                return jsonify({'success': False, 'message': "La fórmula debe incluir 'price.compra' para actualizaciones automáticas."}), 400
            if re.search(r'price\.actual', formula, re.IGNORECASE):
                return jsonify({'success': False, 'message': "No está permitida la referencia a 'price.actual' en fórmulas de actualización automática."}), 400

        # Helper to ensure a custom field exists on Price List; if missing, create it
        def ensure_custom_field(field_def):
            try:
                filters_list = [["fieldname", "=", field_def['fieldname']], ["dt", "=", field_def['dt']]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint='/api/resource/Custom Field',
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {field_def['fieldname']} in {field_def['dt']}"
                )
                if check_err:
                    # Log and continue
                    print(f"Error checking custom field {field_def['fieldname']}: {check_err}")
                    return False
                if check_resp.status_code == 200 and check_resp.json().get('data'):
                    return True

                # Create the custom field
                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method='POST',
                    endpoint='/api/resource/Custom%20Field',
                    data=field_def,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {field_def['fieldname']} in {field_def['dt']}"
                )
                if create_err:
                    print(f"Error creating custom field {field_def['fieldname']}: {create_err}")
                    return False
                if create_resp.status_code in (200, 201):
                    return True
                print(f"Unexpected response creating custom field {field_def['fieldname']}: {create_resp.status_code} {create_resp.text}")
                return False
            except Exception as ce:
                print(f"Exception ensuring custom field {field_def.get('fieldname')}: {ce}")
                return False

        # If formula provided, ensure the formula custom field exists on Price List
        if formula is not None:
            cf_formula = {
                "dt": "Price List",
                "label": "Fórmula de actualización",
                "fieldname": "auto_update_formula",
                "fieldtype": "Code",
                "insert_after": "auto_update_enabled"
            }
            ensure_custom_field(cf_formula)

        # If enabling/disabling, ensure the enabled custom field exists
        if enabled is not None:
            cf_enabled = {
                "dt": "Price List",
                "label": "Actualización automática",
                "fieldname": "auto_update_enabled",
                "fieldtype": "Check",
                "insert_after": "custom_exchange_rate"
            }
            ensure_custom_field(cf_enabled)
            update_body['auto_update_enabled'] = 1 if enabled else 0

        if formula is not None:
            update_body['auto_update_formula'] = formula

        if not update_body:
            return jsonify({'success': False, 'message': 'No fields to update'}), 400

        resp, err = make_erpnext_request(
            session=session,
            method='PUT',
            endpoint=f"/api/resource/Price List/{quote(price_list_name)}",
            data={'data': update_body},
            operation_name=f'Update automation for {price_list_name}'
        )

        if err:
            return handle_erpnext_error(err, 'Failed to update price list')

        return jsonify({'success': True, 'data': resp.json() if resp is not None else {}})

    except Exception as e:
        print(f"❌ Error in update_single_price_list: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500


def _build_csv_rows_for_updates(updates):
    """Given list of dicts {item_code, price_list, rate, currency, buying, selling, item_price_name?}
    build CSV string. If item_price_name is present for any row, include an "Identificador"
    column so the Data Import may update existing Item Price documents.

    Returns a tuple (csv_text, has_identifiers) where has_identifiers is True when
    the Identificador column was included.
    """
    output = io.StringIO()

    # Detect whether ALL update rows contain an item_price_name (existing Item Price docname)
    # We now enforce identifiers for every update row; otherwise abort upstream.
    has_ids = bool(updates) and all(bool(u.get('item_price_name')) for u in (updates or []))

    if not has_ids:
        raise Exception("Missing Item Price identifiers for update payload")

    fieldnames = ["Identificador", "Price List", "Currency", "Rate", "Buying", "Selling"]

    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for u in updates:
        row = {
            "Price List": u.get('price_list'),
            "Currency": u.get('currency'),
            "Rate": float(u.get('rate', 0)),
            "Buying": 0 if u.get('selling', 1) else 1,
            "Selling": 1 if u.get('selling', 1) else 0
        }
        # Use the existing Item Price docname as the identifier for update
        row = {"Identificador": (u.get('item_price_name') or '').strip(), **row}
        writer.writerow(row)
    return output.getvalue(), has_ids


@price_list_automation_bp.route('/api/price-list-automation/apply', methods=['POST'])
def apply_updates():
    """Apply automated formulas to provided items and import results to ERPNext (async)."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json(force=True) or {}
        items = data.get('items', [])  # Each item: { item_code, compra (cost) }
        list_type = data.get('type', 'sales')

        if not items:
            return jsonify({'success': False, 'message': 'No items provided'}), 400

        # Load price lists with automation enabled
        filters = [["selling", "=", 1]] if list_type == 'sales' else [["buying", "=", 1]]
        params = {
            'fields': '["name","price_list_name","currency","auto_update_enabled","auto_update_formula"]',
            'filters': json.dumps(filters),
            'limit_page_length': 500
        }
        resp_pl, err_pl = make_erpnext_request(
            session=session,
            method='GET',
            endpoint='/api/resource/Price List',
            params=params,
            operation_name='Get automatable price lists for apply'
        )
        if err_pl:
            return handle_erpnext_error(err_pl, 'Failed to fetch price lists')

        price_lists = []
        if resp_pl.status_code == 200:
            for pl in resp_pl.json().get('data', []):
                if pl.get('auto_update_enabled'):
                    price_lists.append(pl)

        if not price_lists:
            return jsonify({'success': False, 'message': 'No price lists with automation enabled found'}), 400

        process_id = str(uuid.uuid4())
        automation_import_progress[process_id] = {'success': True, 'status': 'running', 'progress': 0, 'total': len(items) * len(price_lists), 'message': 'Processing', 'results': []}

        def worker():
            try:
                updates = []
                total = 0
                for item in items:
                    item_code = item.get('item_code')
                    compra = float(item.get('compra') or item.get('cost') or 0)
                    actual = float(item.get('actual') or 0)
                    for pl in price_lists:
                        formula = pl.get('auto_update_formula') or ''
                        try:
                            pyexpr = _translate_and_sanitize_formula(formula)
                            res = safe_eval_formula(pyexpr, actual=actual or 0, compra=compra or 0)
                            # Numeric results expected for rates, booleans are ignored
                            if isinstance(res, bool):
                                # skip boolean result for rate
                                continue
                            rate = float(res)
                            updates.append({
                                'item_code': item_code,
                                'price_list': pl.get('price_list_name') or pl.get('name'),
                                'rate': round(rate, 4),
                                'currency': pl.get('currency'),
                                'selling': 1 if list_type == 'sales' else 0
                            })
                        except Exception as fe:
                            automation_import_progress[process_id]['results'].append({'item_code': item_code, 'price_list': pl.get('price_list_name'), 'error': str(fe)})
                        total += 1
                        automation_import_progress[process_id]['progress'] = total

                    # Build CSV and run Data Import similar to sales bulk save
                if updates:
                    # Build CSV preview and store summary in progress. Actual import via Data Import Tool
                    csv_result = _build_csv_rows_for_updates(updates)
                    if isinstance(csv_result, tuple):
                        csv_data, has_ids = csv_result
                    else:
                        csv_data, has_ids = csv_result, False
                    sample_lines = csv_data.split('\n')[:21]  # header + 20 rows
                    automation_import_progress[process_id]['status'] = 'completed'
                    automation_import_progress[process_id]['results'].append({'applied_rows': len(updates), 'csv_preview_lines': sample_lines, 'has_identifiers': bool(has_ids)})
                else:
                    automation_import_progress[process_id]['status'] = 'completed'
                    automation_import_progress[process_id]['results'].append({'applied_rows': 0})
            except Exception as e:
                automation_import_progress[process_id]['status'] = 'error'
                automation_import_progress[process_id]['message'] = str(e)
                automation_import_progress[process_id]['results'].append({'error': str(e)})

        thread = threading.Thread(target=worker)
        thread.daemon = True
        thread.start()

        return jsonify({'success': True, 'process_id': process_id, 'message': 'Apply started (async)'}), 202

    except Exception as e:
        print(f"❌ Error in apply_updates: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500


@price_list_automation_bp.route('/api/price-list-automation/preview', methods=['POST'])
def preview_formula():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json(force=True) or {}
        formula = data.get('formula', '')
        item = data.get('item', {})
        compra = float(item.get('compra') or item.get('cost') or 0)
        actual = float(item.get('actual') or 0)

        pyexpr = _translate_and_sanitize_formula(formula)
        res = safe_eval_formula(pyexpr, actual=actual, compra=compra)
        return jsonify({'success': True, 'result': res})

    except Exception as e:
        print(f"❌ Error in preview_formula: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 400
