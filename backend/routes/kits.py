
"""Kits routes: list, details, create, update, movements, and item-groups helper endpoint.

This module provides helper functions to ensure an Item Group and a parent Item
exist in ERPNext (idempotent get-or-create), and endpoints used by the frontend
to list/create/update Product Bundles (kits) and to fetch Item Groups.
"""

from flask import Blueprint, request, jsonify
import traceback
import json
import math
from urllib.parse import quote

from utils.http_utils import handle_erpnext_error, make_erpnext_request
from routes.auth_utils import get_session_with_auth
from routes.general import get_company_abbr, update_company_item_count
from routes.inventory_utils import fetch_bin_stock, round_qty
# NOTE: Backend automatically appends company abbreviation to new_item_code and component item_codes before sending to ERPNext.
# Frontend sends bare codes (e.g. 'ART012', 'ART005'); backend adds ' - ABBR' if needed.


def ensure_item_group(session, headers, group_name, company):
    """Ensure an Item Group with the given name exists in ERPNext.

    Returns the canonical group name (as stored in ERPNext) or None on failure.
    """
    if not group_name:
        return None
    # Server-side: attach company abbreviation to the group name when ensuring.
    # Frontend will send the bare group name (e.g. 'Prueba'); we must use
    # the canonical name 'Prueba - ABBR' when searching/creating in ERPNext.
    try:
        abbr = get_company_abbr(session, headers, company) or ''
    except Exception:
        abbr = ''

    canonical_name = group_name
    if abbr:
        abbr = abbr.strip()
        if not group_name.endswith(f" - {abbr}"):
            canonical_name = f"{group_name} - {abbr}"

    # Try fetch by canonical name only (no fallbacks)
    try:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item Group/{quote(canonical_name)}",
            operation_name=f"Fetch Item Group {canonical_name}"
        )
        if not err and resp.status_code == 200:
            data = resp.json().get('data')
            if data:
                return data.get('name') or canonical_name
    except Exception:
        # proceed to creation attempt
        pass

    # Create it under the root 'All Item Groups' using canonical name
    try:
        payload = {
            "item_group_name": canonical_name,
            "parent_item_group": "All Item Groups",
            "is_group": 0
        }
        resp, err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item Group",
            operation_name=f"Create Item Group {canonical_name}",
            data={"data": payload}
        )
        if err:
            return None
        created = resp.json().get('data')
        return created.get('name') if created else canonical_name
    except Exception:
        return None


def ensure_parent_item(session, headers, *, company, item_code, item_name, item_group=None):
    """Ensure the parent Item exists.

    Returns a tuple (item_data, created_flag) where created_flag is True when a
    new Item was created by this function.
    """
    if not item_code:
        return None, False

    # Try direct fetch by provided code ONLY. No fallbacks and no auto-creation.
    try:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item/{quote(item_code)}",
            operation_name=f"Fetch Item {item_code}"
        )
        if not err and resp.status_code == 200:
            return resp.json().get('data'), False
    except Exception:
        pass

    # Do not attempt any creation -- caller must explicitly create the parent Item in ERPNext first.
    return None, False
    try:
        # Do not attempt to create a parent Item if no item_group was provided.
        # ERPNext requires item_group to be set for Item records (MandatoryError), so
        # avoid creating items with an empty item_group and fail gracefully.
        if not item_group:
            print(f"--- ensure_parent_item: cannot create {item_code} because item_group is missing")
            return None, False

        item_payload = {
            "item_code": full_code,
            "item_name": item_name or item_code,
            "item_group": item_group,
            "is_stock_item": 0,
            "include_item_in_manufacturing": 0,
            "disabled": 0,
            "stock_uom": "Unit",
            "docstatus": 0
        }
        if company:
            item_payload["item_defaults"] = [{"company": company}]

        resp, err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item",
            operation_name=f"Create Item {full_code}",
            data={"data": item_payload}
        )
        if err:
            return None, False
        return resp.json().get('data'), True
    except Exception:
        return None, False


# Blueprint
kits_bp = Blueprint('kits', __name__)


@kits_bp.route('/api/inventory/kits', methods=['GET'])
def get_kits():
    """List Product Bundles (kits). Expects query param `company`."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company = request.args.get('company')
        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        try:
            abbr = get_company_abbr(session, headers, company) or ''
        except Exception:
            abbr = ''

        # Per decision: only filter Product Bundles by company (`custom_company`) and
        # docstatus (0 or 1). Do not attempt fallback logic (parent item lookup,
        # cross-checking item codes, etc.) — those produce complex and expensive
        # queries and caused ambiguous ownership behaviors.

        # Prefer server-side filtering by custom_company when present - this
        # avoids iterating over all Product Bundles. We still keep the base
        # filters and fields to enrich the returned rows.
        # NOTE: ERPNext forbids arbitrary fields in list queries for some doctypes.
        # 'item_name' is not permitted when listing Product Bundle via get_list, so
        # do not request it here — fetch full details later when needed.
        # Request only fields that are safe to query in Product Bundle's get_list.
        # Some ERPNext instances forbid requesting certain fields (e.g. item_name, item_group)
        # in list queries and will return DataError (417). Keep the list minimal.
        # NOTE: The 'items' child table is NOT returned in list queries - we fetch it separately below.
        params = {
            "fields": json.dumps(["name", "new_item_code", "custom_company", "description"]),
            "filters": json.dumps([
                ["custom_company", "=", company],
                ["docstatus", "in", [0, 1]]
            ]),
            "limit_page_length": 1000
        }
        response, error = make_erpnext_request(session=session, method="GET", endpoint="/api/resource/Product Bundle", params=params, operation_name="Get Product Bundles")
        if error:
            return handle_erpnext_error(error, "Failed to fetch kits")

        kits_data = response.json().get('data', [])
        processed = []

        # Collect all kit names to fetch their details (to get child items)
        kit_names = [kit.get('name') for kit in kits_data if kit.get('name')]
        print(f"--- get_kits: Found {len(kit_names)} kits, fetching child items in bulk")

        # Fetch ALL child items (Product Bundle Item) in ONE call using frappe.client.get_list
        kit_items_map = {}  # Map: parent_name -> list of child items
        if kit_names:
            try:
                child_payload = {
                    "doctype": "Product Bundle Item",
                    "parent": "Product Bundle",
                    "fields": [
                        "name",
                        "parent",
                        "item_code",
                        "qty",
                        "description",
                        "uom",
                        "idx"
                    ],
                    "filters": {
                        "parent": ["in", kit_names],
                        "parenttype": "Product Bundle",
                        "parentfield": "items"
                    },
                    "limit_page_length": 10000
                }
                child_response, child_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.get_list",
                    operation_name="Fetch all Product Bundle Items",
                    data=child_payload
                )
                if not child_error and child_response.status_code == 200:
                    child_items = child_response.json().get('message', [])
                    print(f"--- get_kits: Fetched {len(child_items)} child items in bulk")
                    # Group by parent
                    for item in child_items:
                        parent_name = item.get('parent')
                        if parent_name:
                            if parent_name not in kit_items_map:
                                kit_items_map[parent_name] = []
                            kit_items_map[parent_name].append(item)
                else:
                    print(f"--- get_kits: Error fetching child items: {child_error}")
            except Exception as e:
                print(f"--- get_kits: Exception fetching child items: {e}")
        
        # Build kits_full_data from original kits_data + fetched child items
        kits_full_data = []
        for kit in kits_data:
            kit_name = kit.get('name')
            kit_full = {**kit}  # Copy base fields
            # Add child items from map
            kit_full['items'] = kit_items_map.get(kit_name, [])
            kits_full_data.append(kit_full)

        for kit in kits_full_data:
            # Minimal, predictable behavior: do not attempt parent/Item fallback checks.
            # We only return bundles that match the requested company (we already
            # signalled that in the query) and have docstatus 0 or 1. Any further
            # enrichment can happen lazily from the frontend if desired.
            raw_kit_code = kit.get('new_item_code', '') or kit.get('name', '')
            if abbr and raw_kit_code.endswith(f" - {abbr}"):
                display_kit_code = raw_kit_code[:-(len(abbr) + 3)]
            else:
                display_kit_code = raw_kit_code
            kit_items = kit.get('items') or []
            parent_item_name = kit.get('description') or ''
            print(f"--- get_kits: Kit {kit.get('name')} has {len(kit_items)} items")

            # Strip company abbreviation from returned item codes for frontend display
            items = []
            for i in kit_items:
                raw_code = i.get('item_code', '') or ''
                display_code = raw_code
                if abbr and display_code.endswith(f" - {abbr}"):
                    display_code = display_code[:-(len(abbr) + 3)]
                items.append({
                    'item_code': display_code,
                    'qty': i.get('qty', 0),
                    'description': i.get('description', ''),
                    'uom': i.get('uom', 'Unit')
                })

            # Prepare kit-level code (strip abbr for display)
            
            # Also prepare user-friendly fields for list display
            description = kit.get('description') or kit.get('item_name') or parent_item_name
            raw_group = kit.get('item_group', '') or ''
            display_group = raw_group
            if abbr and display_group.endswith(f" - {abbr}"):
                display_group = display_group[:-(len(abbr) + 3)]

            available_kits = 0
            try:
                # When components are stored in ERP they may include a company
                # abbreviation suffix (" - {abbr}") in their item_code, while
                # the kit detail may contain codes without the suffix. The
                # Bin table stores item_code with the suffix, so make sure we
                # query using the full ERP code when we have a company abbr.
                comp_codes = []
                for c in kit_items:
                    raw_code = (c.get('item_code') or '').strip()
                    if not raw_code:
                        continue
                    # If we have an abbr, append it only when the code doesn't
                    # already end with it. This avoids double-suffixing.
                    if abbr:
                        suffix = f" - {abbr}"
                        if not raw_code.endswith(suffix):
                            full_code = f"{raw_code}{suffix}"
                        else:
                            full_code = raw_code
                    else:
                        full_code = raw_code
                    comp_codes.append(full_code)
                print(f"--- get_kits: Fetching stock for {len(comp_codes)} components: {comp_codes}")
                comp_stock_map = fetch_bin_stock(session, headers, comp_codes, company) if comp_codes else {}
                print(f"--- get_kits: Stock map returned: {comp_stock_map}")
                min_kits = math.inf
                suffix = f" - {abbr}" if abbr else ''
                for comp in kit_items or []:
                    erp_code = (comp.get('item_code') or '').strip()
                    qty_needed = float(comp.get('qty') or 0)
                    if not erp_code or qty_needed <= 0:
                        continue
                    # Determine the lookup key used in the stock map. We tried
                    # to query Bin using codes with the company suffix above
                    # (comp_codes). The returned stock map keys will therefore
                    # include that suffix. Build the lookup key in the same way
                    # so we actually find the stock entry.
                    lookup_code = erp_code
                    if suffix and not lookup_code.endswith(suffix):
                        lookup_code = f"{erp_code}{suffix}"

                    # Look up stock using the full code with company suffix - NO fallbacks
                    stock_entry = comp_stock_map.get(lookup_code) or {}
                    comp_stock = round_qty(stock_entry.get('total_available_qty', 0))
                    kits_from_comp = comp_stock / qty_needed if qty_needed else 0
                    print(f"--- get_kits: Component {erp_code} (lookup {lookup_code}): stock={comp_stock}, qty_needed={qty_needed}, kits_from_comp={kits_from_comp}")
                    min_kits = min(min_kits, kits_from_comp)
                if min_kits is not math.inf:
                    available_kits = math.floor(min_kits + 1e-9)
                print(f"--- get_kits: Final available_kits={available_kits}")
            except Exception as e:
                print(f"--- get_kits: Error calculating available_kits: {e}")
                available_kits = 0

            processed.append({
                'name': kit.get('name', ''),
                'new_item_code': display_kit_code,
                'item_code': display_kit_code,
                'description': description,
                'parent_item': {'item_name': parent_item_name},
                'item_group': display_group,
                'items': items,
                'available_qty': available_kits
            })

        return jsonify({"success": True, "data": processed})
    except Exception as e:
        print('Error en get_kits:', e)
        print(traceback.format_exc())
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@kits_bp.route('/api/inventory/kits/<kit_name>', methods=['GET'])
def get_kit_details(kit_name):
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        response, error = make_erpnext_request(session=session, method="GET", endpoint=f"/api/resource/Product Bundle/{quote(kit_name)}", operation_name=f"Fetch Kit Details for {kit_name}")
        if error:
            return handle_erpnext_error(error, "Failed to fetch kit details")
        kit = response.json().get('data', {})
        requested_company = request.args.get('company')
        if requested_company:
            if kit.get('custom_company') and kit.get('custom_company') != requested_company:
                return jsonify({"success": False, "message": "Kit no pertenece a la compa\u00f1\u00eda solicitada"}), 403
            if not kit.get('custom_company'):
                try:
                    parent_resp, parent_err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Item/{quote(kit.get('new_item_code', kit_name))}",
                        operation_name=f"Fetch parent Item for kit {kit_name}"
                    )
                    if not parent_err and parent_resp.status_code == 200:
                        parent_item = parent_resp.json().get('data', {})
                        parent_company = parent_item.get('custom_company')
                        if parent_company and parent_company != requested_company:
                            return jsonify({"success": False, "message": "Kit no pertenece a la compa\u00f1\u00eda solicitada"}), 403
                except Exception:
                    pass
        # Strip company abbr for display
        try:
            abbr = get_company_abbr(session, headers, request.args.get('company')) or ''
        except Exception:
            abbr = ''

        raw_kit_code = kit.get('new_item_code', '') or ''
        display_kit_code = raw_kit_code
        if abbr and display_kit_code.endswith(f" - {abbr}"):
            display_kit_code = display_kit_code[:-(len(abbr) + 3)]

        items = []
        for i in kit.get('items', []):
            raw_item_code = i.get('item_code', '') or ''
            display_item_code = raw_item_code
            if abbr and display_item_code.endswith(f" - {abbr}"):
                display_item_code = display_item_code[:-(len(abbr) + 3)]
            items.append({'item_code': display_item_code, 'qty': i.get('qty', 0), 'description': i.get('description', ''), 'uom': i.get('uom', 'Unit')})

        # Also include item_group (display-friendly) and description
        raw_group = kit.get('item_group', '') or ''
        if not raw_group and kit.get('new_item_code'):
            try:
                parent_resp, parent_err = make_erpnext_request(session=session, method="GET", endpoint=f"/api/resource/Item/{quote(kit.get('new_item_code'))}", operation_name=f"Fetch parent Item for kit {kit_name}")
                if not parent_err and parent_resp.status_code == 200:
                    parent_item = parent_resp.json().get('data', {})
                    raw_group = parent_item.get('item_group', '')
            except Exception:
                pass
        display_group = raw_group
        if abbr and display_group.endswith(f" - {abbr}"):
            display_group = display_group[:-(len(abbr) + 3)]

            description = kit.get('description') or kit.get('item_name') or ''        # Calculate available kits from component stock
        # Component codes in ERPNext include company suffix, so we query with full codes
        available_kits = 0
        try:
            kit_items = kit.get('items', [])
            # Build component codes with company suffix for Bin lookup
            comp_codes = []
            for c in kit_items:
                raw_code = (c.get('item_code') or '').strip()
                if not raw_code:
                    continue
                # Component codes from ERPNext already include suffix, use as-is
                comp_codes.append(raw_code)
            
            print(f"--- get_kit_details: Fetching stock for {len(comp_codes)} components: {comp_codes}")
            stock_map = fetch_bin_stock(session, headers, comp_codes, request.args.get('company')) if comp_codes else {}
            print(f"--- get_kit_details: Stock map returned: {stock_map}")
            
            min_kits = math.inf
            for comp in kit_items:
                erp_code = (comp.get('item_code') or '').strip()
                qty_needed = float(comp.get('qty') or 0)
                if not erp_code or qty_needed <= 0:
                    continue
                # Look up stock using the exact code - NO fallbacks
                stock_entry = stock_map.get(erp_code) or {}
                comp_stock = round_qty(stock_entry.get('total_available_qty', 0))
                kits_from_comp = comp_stock / qty_needed if qty_needed else 0
                print(f"--- get_kit_details: Component {erp_code}: stock={comp_stock}, qty_needed={qty_needed}, kits_from_comp={kits_from_comp}")
                min_kits = min(min_kits, kits_from_comp)
            if min_kits is not math.inf:
                available_kits = math.floor(min_kits + 1e-9)
            print(f"--- get_kit_details: Final available_kits={available_kits}")
        except Exception as e:
            print(f"--- get_kit_details: Error calculating available_kits: {e}")
            available_kits = 0

        # Fetch parent item details to include taxes
        parent_item = None
        try:
            parent_resp, parent_err = make_erpnext_request(
                session=session, 
                method="GET", 
                endpoint=f"/api/resource/Item/{quote(kit.get('new_item_code'))}", 
                operation_name=f"Fetch parent Item for kit {kit_name}"
            )
            if not parent_err and parent_resp.status_code == 200:
                parent_item = parent_resp.json().get('data', {})
        except Exception as e:
            print(f"--- get_kit_details: Error fetching parent item: {e}")

        return jsonify({"success": True, "data": {"new_item_code": display_kit_code, "item_name": kit.get('item_name', ''), "description": description, "item_group": display_group, "items": items, "available_qty": available_kits, "parent_item": parent_item}})
    except Exception as e:
        print('Error en get_kit_details:', e)
        print(traceback.format_exc())
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@kits_bp.route('/api/inventory/kits', methods=['POST'])
def create_kit():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        company = data.get('company')
        new_item_code = data.get('new_item_code')
        item_group = data.get('item_group')
        items = data.get('items', [])
        is_new_item_group = data.get('__isNewItemGroup') or data.get('isNewItemGroup') or False

        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400
        if not new_item_code:
            return jsonify({"success": False, "message": "Se requiere new_item_code"}), 400
        if not items or len(items) < 2:
            return jsonify({"success": False, "message": "Un kit debe tener al menos 2 componentes"}), 400

        # No fallback: do not auto-create or select default Item Group. Use whatever frontend provided.
        # If frontend passed a new item group flagged as new, ensure it exists; otherwise don't create default.
        if is_new_item_group or (item_group and item_group.strip()):
            ensured = ensure_item_group(session, headers, item_group, company) if item_group else None
            if ensured:
                item_group = ensured

        # Ensure parent Item exists (create if missing). This returns the canonical item (with abbr).
        # Prefer user-supplied item_name, then fall back to description for the parent Item
        # Parent Item must already exist in ERPNext. We require frontend to provide the
        # complete item code that includes company abbreviation (e.g. 'ART012 - ANC').
        try:
            abbr = get_company_abbr(session, headers, company) or ''
        except Exception:
            abbr = ''

        # Append company abbreviation to new_item_code if not already present
        canonical_new_item_code = new_item_code
        if abbr:
            suffix = f" - {abbr}"
            if not canonical_new_item_code.endswith(suffix):
                canonical_new_item_code = f"{canonical_new_item_code}{suffix}"

        # Check if the parent Item already exists - if so, prevent creation to avoid conflicts
        parent_item = None
        resp, err = make_erpnext_request(session=session, method="GET", endpoint=f"/api/resource/Item/{quote(canonical_new_item_code)}", operation_name=f"Check if Item {canonical_new_item_code} exists")
        if resp and resp.status_code == 200:
            return jsonify({"success": False, "message": f"El código de item '{canonical_new_item_code}' ya existe. Use un código diferente."}), 400
        # If 404 or other, proceed to create

        kit_payload = {
            'doctype': 'Product Bundle',
            'new_item_code': canonical_new_item_code,
            'item_name': data.get('item_name') or canonical_new_item_code,
            'description': data.get('description') or data.get('item_name') or '',
            'disabled': 0,
            'docstatus': 0,
            'items': [],
            'custom_company': company
        }

        if item_group:
            kit_payload['item_group'] = item_group

        # Append company abbreviation to component item codes if not already present
        try:
            abbr = get_company_abbr(session, headers, company) or ''
        except Exception:
            abbr = ''

        processed_items = []
        for it in items:
            if not it.get('item_code') or not it.get('qty'):
                return jsonify({"success": False, "message": "Cada item debe tener item_code y qty"}), 400

            comp_code = it['item_code']
            # Append company abbreviation to component code if not already present
            if abbr:
                suffix = f" - {abbr}"
                if not comp_code.endswith(suffix):
                    comp_code = f"{comp_code}{suffix}"

            pi = {
                'item_code': comp_code,
                'qty': it['qty'],
                'uom': it.get('uom', 'Unit'),
                'custom_company': company
            }
            # We do not store per-component descriptions — kit has a single description
            processed_items.append(pi)

        kit_payload['items'] = processed_items

        # Allow frontend to provide an explicit parent_taxes override (list of template names).
        # If provided and valid, we will use it instead of computing intersection from components.
        parent_taxes = []
        try:
            provided_parent_taxes = data.get('parent_taxes') or data.get('item_tax_templates')
            if provided_parent_taxes:
                # Accept either list of strings or list of dicts like {"name": "..."}
                parsed = []
                if isinstance(provided_parent_taxes, list):
                    for t in provided_parent_taxes:
                        if isinstance(t, str):
                            parsed.append(t)
                        elif isinstance(t, dict) and t.get('name'):
                            parsed.append(t.get('name'))
                if parsed:
                    parent_taxes = parsed
                    print(f"--- create_kit: Using frontend-supplied parent_taxes override -> {parent_taxes}")
                else:
                    # Fallthrough to compute from components if provided format is invalid
                    provided_parent_taxes = None

            # Validate component item tax templates: all components must have the same set of item tax templates
        
        except Exception as e:
            print(f"--- create_kit: Error parsing provided parent_taxes: {e}")
            provided_parent_taxes = None

        try:
            component_tax_sets = []
            missing = []

            # If frontend provided valid parent_taxes, skip fetching component taxes
            if parent_taxes:
                # We trust frontend-provided templates; skip validation against components
                component_tax_sets = []
            else:
                for comp in processed_items:
                    comp_code = comp.get('item_code')
                    if not comp_code:
                        continue
                    comp_resp, comp_err = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Item/{quote(comp_code)}", operation_name=f"Fetch component Item {comp_code}")
                    if comp_err or not comp_resp or comp_resp.status_code != 200:
                        # If we can't fetch the component, we cannot validate taxes -- error out
                        print(f"--- create_kit: Error fetching component {comp_code} for tax validation: {comp_err or (comp_resp.status_code if comp_resp else 'no response')}")
                        return jsonify({"success": False, "message": f"No se pudo obtener el item componente {comp_code} para validar impuestos"}), 400

                    comp_data = comp_resp.json().get('data', {}) or {}
                    taxes_list = comp_data.get('taxes') or []
                    tax_set = set()
                    for tax in taxes_list:
                        if tax.get('item_tax_template'):
                            tax_set.add(tax['item_tax_template'])
                    if not tax_set:
                        missing.append(comp_code)
                    component_tax_sets.append(tax_set)
                    # Log taxes for this component
                    try:
                        print(f"--- create_kit: component {comp_code} tax templates -> {sorted(list(tax_set))}")
                    except Exception:
                        pass

            if missing:
                return jsonify({"success": False, "message": f"Los siguientes componentes no tienen Item Tax Templates asignados: {', '.join(missing)}"}), 400

            # Compute intersection of item tax templates present in all components
            try:
                if component_tax_sets:
                    common_taxes = set.intersection(*component_tax_sets) if len(component_tax_sets) > 1 else set(component_tax_sets[0])
                else:
                    common_taxes = set()
            except Exception as inter_e:
                print(f"--- create_kit: Error computing intersection of tax templates: {inter_e}")
                common_taxes = set()

            print(f"--- create_kit: component_tax_sets (raw) -> {component_tax_sets}")
            print(f"--- create_kit: common tax templates -> {sorted(list(common_taxes))}")

            if not parent_taxes:
                if not common_taxes:
                    return jsonify({"success": False, "message": "No se pueden crear kits con productos que tengan distinto IVA. Verifique que todos los componentes compartan la misma plantilla de impuestos."}), 400
                parent_taxes = sorted(list(common_taxes))
        except Exception as tax_v_err:
            print(f"--- create_kit: Error validating component tax templates: {tax_v_err}")
            return jsonify({"success": False, "message": f"Error validando impuestos de componentes: {str(tax_v_err)}"}), 500

        # (Duplicate validation block removed)

        # (Duplicate validation block removed)

        # If parent Item didn't exist, create it now (we need item_group present to create an Item)
        if not parent_item:
            if not item_group:
                return jsonify({"success": False, "message": "Parent Item does not exist. Provide item_group or mark a new item_group to create the parent Item."}), 400

            # Determine brand for parent Item based on component items
            # Allow frontend to override by sending `brand` in the request payload
            provided_brand = data.get('brand') or data.get('parent_brand')
            if provided_brand:
                chosen_brand = provided_brand
            else:
                chosen_brand = None
            component_brands = set()
            for comp in processed_items:
                comp_code = comp['item_code']
                try:
                    comp_resp, comp_err = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Item/{quote(comp_code)}", operation_name=f"Fetch component Item {comp_code}")
                    if not comp_err and comp_resp.status_code == 200:
                        b = (comp_resp.json().get('data') or {}).get('brand')
                        if b:
                            component_brands.add(b)
                except Exception:
                    pass

            # If frontend provided a brand override for the update, prefer it
            provided_brand = data.get('brand') or data.get('parent_brand')
            if provided_brand:
                chosen_brand = provided_brand
            else:
                chosen_brand = None
            if len(component_brands) == 1:
                chosen_brand = list(component_brands)[0]
            elif len(component_brands) > 1:
                # Create (or find) a combined brand name
                combined_name = ' + '.join(sorted(component_brands))
                # Check if brand already exists
                try:
                    b_resp, b_err = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Brand/{quote(combined_name)}", operation_name=f"Fetch brand {combined_name}")
                    if not b_err and b_resp.status_code == 200:
                        chosen_brand = (b_resp.json().get('data') or {}).get('name')
                    else:
                        # Create new Brand
                        create_resp, create_err = make_erpnext_request(session=session, method='POST', endpoint='/api/resource/Brand', operation_name='Create combined Brand', data={"data": {"brand": combined_name, "description": "Auto-generated combined brand for kit components"}})
                        if not create_err and create_resp.status_code in (200, 201):
                            chosen_brand = (create_resp.json().get('data') or {}).get('name')
                except Exception:
                    chosen_brand = None

            # Build parent Item payload
            item_payload = {
                "item_code": canonical_new_item_code,
                "item_name": data.get('item_name') or data.get('description') or canonical_new_item_code,
                "item_group": item_group,
                "is_stock_item": 0,
                "include_item_in_manufacturing": 0,
                "disabled": 0,
                "stock_uom": "Unit",
                "docstatus": 0
            }
            if company:
                item_payload["item_defaults"] = [{"company": company}]
            if parent_taxes:
                # Assign tax templates using taxes child table
                item_payload["taxes"] = [{"item_tax_template": t} for t in parent_taxes]
            if chosen_brand:
                item_payload["brand"] = chosen_brand

            # Create parent Item in ERPNext
            response_item, error_item = make_erpnext_request(session=session, method='POST', endpoint='/api/resource/Item', operation_name='Create parent Item for kit', data={"data": item_payload})
            if error_item or (response_item and response_item.status_code not in (200, 201)):
                return handle_erpnext_error(error_item or (response_item.text if response_item else 'Unknown'), 'Failed to create parent Item')

            parent_item = response_item.json().get('data', {})
            canonical_new_item_code = parent_item.get('item_code') or parent_item.get('name') or canonical_new_item_code

        response, error = make_erpnext_request(
            session=session,
            method='POST',
            endpoint='/api/resource/Product Bundle',
            operation_name='Create Product Bundle',
            data=kit_payload
        )
        if error:
            return handle_erpnext_error(error, 'Failed to create kit')

        created_kit = response.json().get('data', {})
        kit_name = created_kit.get('name', canonical_new_item_code)
        # No auto-creation -> no increment
        return jsonify({"success": True, "data": {"name": kit_name, **created_kit}})
    except Exception as e:
        err_text = str(e) + '\n' + traceback.format_exc()
        print('Error en create_kit:', e)
        if 'LinkValidationError' in err_text or 'link_validation' in err_text.lower():
            return jsonify({"success": False, "message": "No se pudo crear el kit porque algún componente o la categoría es inválida"}), 400
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@kits_bp.route('/api/inventory/kits/<kit_name>', methods=['PUT'])
def update_kit(kit_name):
    """
    Update an existing Product Bundle (kit).

    Logic:
    1. If a new or changed item_group is provided and flagged, ensure it exists.
    2. Ensure the parent Item exists (create if needed). If created, increment company item count.
    3. Send PUT to ERPNext and return a concise JSON with name, item_group and parent_item info.
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        company = data.get('company')
        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        item_group = data.get('item_group')
        is_new_item_group = data.get('__isNewItemGroup') or data.get('isNewItemGroup') or False
        new_item_code = data.get('new_item_code')
        item_name = data.get('item_name') or data.get('description') or new_item_code
        items = data.get('items', [])

        # Basic validations
        if items and len(items) > 0:
            for it in items:
                if not it.get('item_code') or not it.get('qty'):
                    return jsonify({"success": False, "message": "Cada componente debe tener item_code y qty"}), 400

        # Ensure item group
        if is_new_item_group or (item_group and item_group.strip()):
            ensured = ensure_item_group(session, headers, item_group, company) if item_group else None
            if ensured:
                item_group = ensured

        # Parent Item must already exist in ERPNext and new_item_code should include the company abbr
        try:
            abbr = get_company_abbr(session, headers, company) or ''
        except Exception:
            abbr = ''

        # Append company abbreviation to new_item_code if not already present
        canonical_new_item_code = new_item_code
        if abbr:
            suffix = f" - {abbr}"
            if not canonical_new_item_code.endswith(suffix):
                canonical_new_item_code = f"{canonical_new_item_code}{suffix}"

        resp, err = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Item/{quote(canonical_new_item_code)}", operation_name=f"Fetch Item {canonical_new_item_code}")
        parent_item = None
        if not err and resp.status_code == 200:
            parent_item = resp.json().get('data', {})
        else:
            pass  # Will create later if needed
        # Build update payload
        update_body = {}
        if canonical_new_item_code:
            update_body['new_item_code'] = canonical_new_item_code
        if item_name:
            update_body['item_name'] = item_name
        # Allow updating kit level description
        if data.get('description') is not None:
            update_body['description'] = data.get('description')
        if item_group:
            update_body['item_group'] = item_group
        update_body['custom_company'] = company
        if items is not None:
            # Append company abbreviation to component item codes if not already present
            try:
                abbr = get_company_abbr(session, headers, company) or ''
            except Exception:
                abbr = ''

            processed = []
            for it in items:
                if not it.get('item_code') or not it.get('qty'):
                    return jsonify({"success": False, "message": "Cada componente debe tener item_code y qty"}), 400

                comp_code = it['item_code']
                # Append company abbreviation to component code if not already present
                if abbr:
                    suffix = f" - {abbr}"
                    if not comp_code.endswith(suffix):
                        comp_code = f"{comp_code}{suffix}"

                pi = {
                    'item_code': comp_code,
                    'qty': it['qty'],
                    'uom': it.get('uom', 'Unit'),
                    'custom_company': company
                }
                # Do not set per-component description on update; keep kit-level description
                processed.append(pi)
            update_body['items'] = processed

            # Validate component item tax templates: compute intersection of templates from components
            parent_taxes = []
            try:
                provided_parent_taxes = data.get('parent_taxes') or data.get('item_tax_templates')
                if provided_parent_taxes:
                    parsed = []
                    if isinstance(provided_parent_taxes, list):
                        for t in provided_parent_taxes:
                            if isinstance(t, str):
                                parsed.append(t)
                            elif isinstance(t, dict) and t.get('name'):
                                parsed.append(t.get('name'))
                    if parsed:
                        parent_taxes = parsed
                        print(f"--- update_kit: Using frontend-supplied parent_taxes override -> {parent_taxes}")
                    else:
                        provided_parent_taxes = None

                component_tax_sets = []
                missing = []
                # If frontend provided valid parent_taxes, skip fetching component taxes
                if parent_taxes:
                    component_tax_sets = []
                else:
                    for comp in processed:
                        comp_code = comp.get('item_code')
                        if not comp_code:
                            continue
                        comp_resp, comp_err = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Item/{quote(comp_code)}", operation_name=f"Fetch component Item {comp_code}")
                        if comp_err or not comp_resp or comp_resp.status_code != 200:
                            print(f"--- update_kit: Error fetching component {comp_code} for tax validation: {comp_err or (comp_resp.status_code if comp_resp else 'no response')}")
                            return jsonify({"success": False, "message": f"No se pudo obtener el item componente {comp_code} para validar impuestos"}), 400
                        comp_data = comp_resp.json().get('data', {}) or {}
                        taxes_list = comp_data.get('taxes') or []
                        tax_set = set()
                        for tax in taxes_list:
                            if tax.get('item_tax_template'):
                                tax_set.add(tax['item_tax_template'])
                        if not tax_set:
                            missing.append(comp_code)
                        component_tax_sets.append(tax_set)
                        # Log taxes for this component
                        try:
                            print(f"--- update_kit: component {comp_code} tax templates -> {sorted(list(tax_set))}")
                        except Exception:
                            pass

                if missing:
                    return jsonify({"success": False, "message": f"Los siguientes componentes no tienen Item Tax Templates asignados: {', '.join(missing)}"}), 400

                try:
                    if component_tax_sets:
                        common_taxes = set.intersection(*component_tax_sets) if len(component_tax_sets) > 1 else set(component_tax_sets[0])
                    else:
                        common_taxes = set()
                except Exception as inter_e:
                    print(f"--- update_kit: Error computing intersection of tax templates: {inter_e}")
                    common_taxes = set()

                print(f"--- update_kit: component_tax_sets (raw) -> {component_tax_sets}")
                print(f"--- update_kit: common tax templates -> {sorted(list(common_taxes))}")

                if not parent_taxes:
                    if not common_taxes:
                        return jsonify({"success": False, "message": "No se pueden crear kits con productos que tengan distinto IVA. Verifique que todos los componentes compartan la misma plantilla de impuestos."}), 400
                    parent_taxes = sorted(list(common_taxes))
            except Exception as tax_v_err:
                print(f"--- update_kit: Error validating component tax templates: {tax_v_err}")
                return jsonify({"success": False, "message": f"Error validando impuestos de componentes: {str(tax_v_err)}"}), 500

        # If parent_item does not exist yet, create it similarly to create_kit (requires item_group)
        if not parent_item:
            if not item_group:
                return jsonify({"success": False, "message": "Parent Item does not exist. Provide item_group or mark a new item_group to create the parent Item."}), 400

            # Determine brand for parent Item based on component items
            # Allow frontend to override by sending `brand` in the request payload
            provided_brand = data.get('brand') or data.get('parent_brand')
            if provided_brand:
                chosen_brand = provided_brand
            else:
                chosen_brand = None
            component_brands = set()
            for comp in processed:
                comp_code = comp['item_code']
                try:
                    comp_resp, comp_err = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Item/{quote(comp_code)}", operation_name=f"Fetch component Item {comp_code}")
                    if not comp_err and comp_resp.status_code == 200:
                        b = (comp_resp.json().get('data') or {}).get('brand')
                        if b:
                            component_brands.add(b)
                except Exception:
                    pass

            # If frontend provided a brand override for the update, prefer it
            provided_brand = data.get('brand') or data.get('parent_brand')
            if provided_brand:
                chosen_brand = provided_brand
            else:
                chosen_brand = None
            if len(component_brands) == 1:
                chosen_brand = list(component_brands)[0]
            elif len(component_brands) > 1:
                # Create (or find) a combined brand name
                combined_name = ' + '.join(sorted(component_brands))
                # Check if brand already exists
                try:
                    b_resp, b_err = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Brand/{quote(combined_name)}", operation_name=f"Fetch brand {combined_name}")
                    if not b_err and b_resp.status_code == 200:
                        chosen_brand = (b_resp.json().get('data') or {}).get('name')
                    else:
                        # Create new Brand
                        create_resp, create_err = make_erpnext_request(session=session, method='POST', endpoint='/api/resource/Brand', operation_name='Create combined Brand', data={"data": {"brand": combined_name, "description": "Auto-generated combined brand for kit components"}})
                        if not create_err and create_resp.status_code in (200, 201):
                            chosen_brand = (create_resp.json().get('data') or {}).get('name')
                except Exception:
                    chosen_brand = None

            item_payload = {
                "item_code": canonical_new_item_code,
                "item_name": item_name or canonical_new_item_code,
                "item_group": item_group,
                "is_stock_item": 0,
                "include_item_in_manufacturing": 0,
                "disabled": 0,
                "stock_uom": "Unit",
                "docstatus": 0
            }
            if company:
                item_payload["item_defaults"] = [{"company": company}]
            if parent_taxes:
                # Assign tax templates using taxes child table
                item_payload["taxes"] = [{"item_tax_template": t} for t in parent_taxes]
            if chosen_brand:
                item_payload["brand"] = chosen_brand

            response_item, error_item = make_erpnext_request(session=session, method='POST', endpoint='/api/resource/Item', operation_name='Create parent Item for kit', data={"data": item_payload})
            if error_item or (response_item and response_item.status_code not in (200, 201)):
                return handle_erpnext_error(error_item or (response_item.text if response_item else 'Unknown'), 'Failed to create parent Item')

            parent_item = response_item.json().get('data', {})
            canonical_new_item_code = parent_item.get('item_code') or parent_item.get('name') or canonical_new_item_code
        else:
            # Update existing parent item ensuring custom_company and tax template are set if needed
            try:
                if parent_item:
                    item_update = {"custom_company": company}
                    if parent_taxes:
                        item_update["taxes"] = [{"item_tax_template": t} for t in parent_taxes]
                    upd_resp, upd_err = make_erpnext_request(session=session, method='PUT', endpoint=f"/api/resource/Item/{quote(parent_item.get('item_code'))}", data={"data": item_update}, operation_name=f"Update parent Item {parent_item.get('item_code')} with company/taxes")
                    if upd_err:
                        print(f"--- update_kit: Warning: failed to update parent Item {parent_item.get('item_code')} with taxes/company: {upd_err}")
                    else:
                        print(f"--- update_kit: Successfully updated parent Item {parent_item.get('item_code')} with custom_company and taxes")
            except Exception as e:
                print(f"--- update_kit: exception updating parent Item with taxes/company: {e}")

        # Send update to ERPNext
        response, error = make_erpnext_request(session=session, method='PUT', endpoint=f"/api/resource/Product Bundle/{quote(kit_name)}", operation_name='Update Product Bundle', data={"data": update_body})
        if error:
            return handle_erpnext_error(error, 'Failed to update kit')

        updated = response.json().get('data', {})

        parent_summary = {
            'item_code': parent_item.get('item_code') if parent_item else new_item_code,
            'item_name': parent_item.get('item_name') if parent_item else item_name
        }

        return jsonify({"success": True, "data": {"name": updated.get('name', kit_name), "item_group": item_group, "parent_item": parent_summary}})
    except Exception as e:
        err_text = str(e) + '\n' + traceback.format_exc()
        print('Error en update_kit:', e)
        if 'LinkValidationError' in err_text or 'link_validation' in err_text.lower():
            return jsonify({"success": False, "message": "No se pudo actualizar el kit porque algún componente o la categoría es inválida"}), 400
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@kits_bp.route('/api/inventory/kits/<kit_name>', methods=['DELETE'])
def delete_kit(kit_name):
    """Delete a Product Bundle (kit)."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Fetch kit first to validate it exists and belongs to the requested company if provided
        fetch_resp, fetch_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Product Bundle/{quote(kit_name)}",
            operation_name=f"Fetch Kit Before Delete {kit_name}"
        )
        if fetch_err:
            return handle_erpnext_error(fetch_err, "No se pudo obtener el kit antes de eliminarlo")
        if fetch_resp.status_code == 404:
            return jsonify({"success": False, "message": "Kit no encontrado"}), 404

        kit_data = fetch_resp.json().get('data', {}) or {}
        requested_company = request.args.get('company')
        if requested_company:
            if kit_data.get('custom_company') and kit_data.get('custom_company') != requested_company:
                return jsonify({"success": False, "message": "Kit no pertenece a la compañía solicitada"}), 403
            if not kit_data.get('custom_company'):
                try:
                    parent_code = kit_data.get('new_item_code') or kit_name
                    parent_resp, parent_err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Item/{quote(parent_code)}",
                        operation_name=f"Fetch parent Item for delete validation {kit_name}"
                    )
                    if not parent_err and parent_resp.status_code == 200:
                        parent_company = (parent_resp.json().get('data') or {}).get('custom_company')
                        if parent_company and parent_company != requested_company:
                            return jsonify({"success": False, "message": "Kit no pertenece a la compañía solicitada"}), 403
                except Exception:
                    pass

        delete_resp, delete_err = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Product Bundle/{quote(kit_name)}",
            operation_name=f"Delete Kit {kit_name}"
        )
        if delete_err:
            return handle_erpnext_error(delete_err, "No se pudo eliminar el kit")

        if delete_resp.status_code not in (200, 202):
            return jsonify({"success": False, "message": delete_resp.text}), delete_resp.status_code

        # Remove parent Item as well - ERPNext creates an Item per kit to expose it in lists
        parent_item_code = kit_data.get('new_item_code') or kit_name
        try:
            parent_delete_resp, parent_delete_err = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Item/{quote(parent_item_code)}",
                operation_name=f"Delete parent Item for Kit {kit_name}"
            )
            if parent_delete_err:
                print(f"--- delete_kit: error deleting parent Item {parent_item_code}: {parent_delete_err}")
            elif parent_delete_resp.status_code not in (200, 202, 404):
                print(f"--- delete_kit: unexpected status deleting parent Item {parent_item_code}: {parent_delete_resp.status_code} {parent_delete_resp.text}")
        except Exception as parent_err:
            print(f"--- delete_kit: exception deleting parent Item {parent_item_code}: {parent_err}")

        return jsonify({"success": True, "message": "Kit e Item relacionado eliminados exitosamente"})
    except Exception as e:
        print('Error deleting kit:', e)
        print(traceback.format_exc())
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@kits_bp.route('/api/inventory/kits/<kit_name>/movements', methods=['GET'])
def get_kit_movements(kit_name):
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        company = request.args.get('company')
        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        kit_response, kit_error = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Product Bundle/{quote(kit_name)}", operation_name=f"Fetch Kit Details for movements {kit_name}")
        if kit_error:
            return handle_erpnext_error(kit_error, 'Kit no encontrado')

        kit_data = kit_response.json().get('data', {})
        if kit_data.get('custom_company') and kit_data.get('custom_company') != company:
            return jsonify({"success": False, "message": "Kit no pertenece a la compa\u00f1\u00eda solicitada"}), 403
        if not kit_data.get('custom_company'):
            try:
                parent_resp, parent_err = make_erpnext_request(
                    session=session,
                    method='GET',
                    endpoint=f"/api/resource/Item/{quote(kit_data.get('new_item_code', kit_name))}",
                    operation_name=f"Fetch parent Item for kit {kit_name} (movements)"
                )
                if not parent_err and parent_resp.status_code == 200:
                    parent_company = (parent_resp.json().get('data') or {}).get('custom_company')
                    if parent_company and parent_company != company:
                        return jsonify({"success": False, "message": "Kit no pertenece a la compa\u00f1\u00eda solicitada"}), 403
            except Exception:
                pass
        kit_items = kit_data.get('items', [])
        
        # Obtener abreviatura de la compañía para construir códigos completos
        try:
            abbr = get_company_abbr(session, headers, company) or ''
        except Exception:
            abbr = ''
        
        print(f"--- get_kit_movements: Kit {kit_name} has {len(kit_items)} items, company abbr: {abbr}")

        all_movements = []
        voucher_cache = {}  # Cache para verificar docstatus de vouchers
        stock_reco_cache = {}  # Cache para Stock Reconciliation documents
        
        for kit_item in kit_items:
            item_code = kit_item.get('item_code')
            if not item_code:
                continue
            
            # Construir el código completo del item con sufijo de compañía si es necesario
            # Los item codes en Stock Ledger Entry tienen el formato "CODE - ABBR"
            # No fallbacks - use the stored item_code as-is. The system requires
            # that item codes already include the company abbreviation.
            erp_item_code = item_code
            
            print(f"--- get_kit_movements: Fetching movements for component {item_code} -> {erp_item_code}")
            
            # Agregar filtro docstatus=1 para solo obtener movimientos confirmados
            movements_response, movements_error = make_erpnext_request(session=session, method='GET', endpoint=f"/api/resource/Stock Ledger Entry", params={
                'fields': json.dumps(["name", "item_code", "warehouse", "posting_date", "posting_time", "voucher_type", "voucher_no", "actual_qty", "valuation_rate", "stock_value", "batch_no", "serial_no", "docstatus", "is_cancelled"]),
                'filters': json.dumps([["item_code", "=", erp_item_code], ["company", "=", company], ["is_cancelled", "=", 0], ["docstatus", "=", 1]]),
                'order_by': 'posting_date desc, posting_time desc',
                'limit_page_length': 500
            }, operation_name=f'Fetch Movements for kit item {erp_item_code}')

            if movements_response and not movements_error:
                item_movements = movements_response.json().get('data', [])
                print(f"--- get_kit_movements: Found {len(item_movements)} movements for {erp_item_code}")
                
                for movement in item_movements:
                    voucher_type = movement.get('voucher_type')
                    voucher_no = movement.get('voucher_no')
                    
                    # Verificar docstatus del voucher padre
                    if voucher_type and voucher_no:
                        cache_key = f"{voucher_type}::{voucher_no}"
                        
                        if cache_key not in voucher_cache:
                            try:
                                voucher_response, voucher_error = make_erpnext_request(
                                    session=session,
                                    method="GET",
                                    endpoint=f"/api/resource/{quote(voucher_type)}/{quote(voucher_no)}",
                                    operation_name=f"Check Voucher Status for kit movement",
                                    params={"fields": '["docstatus"]'}
                                )
                                
                                if voucher_response and voucher_response.status_code == 200:
                                    voucher_data = voucher_response.json().get('data', {})
                                    voucher_cache[cache_key] = voucher_data.get('docstatus', 0)
                                elif voucher_response and voucher_response.status_code == 404:
                                    voucher_cache[cache_key] = 0
                                else:
                                    # Error de conexión - asumir válido ya que SLE tiene docstatus=1
                                    voucher_cache[cache_key] = 1
                            except Exception as e:
                                print(f"Error verificando voucher {voucher_type} {voucher_no}: {e}")
                                voucher_cache[cache_key] = 1
                        
                        # Excluir si el voucher no tiene docstatus=1
                        if voucher_cache.get(cache_key, 0) != 1:
                            continue
                    
                    # Enriquecer Stock Reconciliation con qty=0
                    actual_qty = float(movement.get('actual_qty', 0))
                    if voucher_type == 'Stock Reconciliation' and actual_qty == 0 and voucher_no:
                        if voucher_no not in stock_reco_cache:
                            try:
                                reco_response, reco_error = make_erpnext_request(
                                    session=session,
                                    method="GET",
                                    endpoint=f"/api/resource/Stock Reconciliation/{quote(voucher_no)}",
                                    operation_name=f"Fetch Stock Reconciliation {voucher_no} for kit",
                                    params={"fields": '["name", "items"]'}
                                )
                                if reco_response and reco_response.status_code == 200:
                                    reco_data = reco_response.json().get('data', {})
                                    stock_reco_cache[voucher_no] = reco_data.get('items', [])
                                else:
                                    stock_reco_cache[voucher_no] = []
                            except Exception as e:
                                print(f"Error fetching Stock Reconciliation {voucher_no}: {e}")
                                stock_reco_cache[voucher_no] = []
                        
                        # Buscar el item en los items del Stock Reconciliation
                        reco_items = stock_reco_cache.get(voucher_no, [])
                        for reco_item in reco_items:
                            # Comparar con erp_item_code (con sufijo de compañía)
                            if reco_item.get('item_code') == erp_item_code:
                                qty_diff = reco_item.get('quantity_difference', 0)
                                if isinstance(qty_diff, str):
                                    try:
                                        qty_diff = float(qty_diff)
                                    except:
                                        qty_diff = 0
                                
                                if qty_diff != 0:
                                    movement = dict(movement)  # Crear copia
                                    movement['actual_qty'] = qty_diff
                                    movement['_enriched_from_reco'] = True
                                    print(f"--- get_kit_movements: Enriched Stock Reco {voucher_no} for {erp_item_code}: qty_diff={qty_diff}")
                                break
                    
                    # Agregar metadata del kit
                    movement['kit_name'] = kit_name
                    movement['kit_item_code'] = kit_item.get('item_code')
                    movement['kit_qty'] = kit_item.get('qty', 1)
                    movement['kit_description'] = kit_item.get('description', '')
                    all_movements.append(movement)
            else:
                print(f"--- get_kit_movements: Error or no response for {erp_item_code}: error={movements_error}")

        print(f"--- get_kit_movements: Total movements collected: {len(all_movements)}")
        all_movements.sort(key=lambda x: (x.get('posting_date', ''), x.get('posting_time', '')), reverse=True)
        return jsonify({"success": True, "data": all_movements})
    except Exception as e:
        print('Error en get_kit_movements:', e)
        print(traceback.format_exc())
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


