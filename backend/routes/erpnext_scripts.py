"""
ERPNext Server Scripts Management
Handles creation, verification and usage of ERPNext Server Scripts for bulk operations.
"""

from flask import Blueprint, request, jsonify
from routes.auth_utils import get_session_with_auth
from utils.http_utils import make_erpnext_request
import json

erpnext_scripts_bp = Blueprint('erpnext_scripts', __name__)


# Script template for bulk Item Tax Template update
# IMPORTANT: ERPNext Server Scripts require flat code, NO function definitions
BULK_ITEM_IVA_SCRIPT = """
# Server Script contract (strict, no fallbacks):
# Content-Type: application/json
# Body: {
#   "items": [
#     {
#       "item_code": "ITEM-1",
#       "item_tax_templates": [ {"name": "IVA 21 Ventas - MS"}, {"name": "IVA 21 Compras - MS"} ]
#     },
#     ...
#   ]
# }

data = {}
try:
    req = frappe.request
except Exception:
    req = None

if not req:
    frappe.response['message'] = {'success': False, 'error': 'Server script requires a parsed JSON request (no fallbacks)'}
else:
    parsed = None
    try:
        parsed = req.get_json(silent=True)
    except Exception:
        parsed = None

    if not isinstance(parsed, dict):
        frappe.response['message'] = {'success': False, 'error': 'Invalid or missing JSON payload'}
    else:
        data = parsed

        items = data.get('items', [])

        if not items or not isinstance(items, list):
            frappe.response['message'] = {'success': False, 'error': 'No items provided'}
        else:
            results = {'success': True, 'processed': 0, 'errors': [], 'updated': []}

            # Ensure each item provides a list of item_tax_template names
            for entry in items:
                item_code = entry.get('item_code')
                templates = entry.get('item_tax_templates')

                if not item_code:
                    results['errors'].append({'item': 'Unknown', 'error': 'Missing item_code'})
                    continue

                if not templates or not isinstance(templates, list):
                    results['errors'].append({'item': item_code, 'error': 'Missing item_tax_templates (must be an array of {"name":...})'})
                    continue

                # Validate that all provided templates exist (no company check)
                valid_template_names = []
                bad_templates = []

                for t in templates:
                    tname = None
                    try:
                        # Accept either object {"name":..} or a plain string
                        if isinstance(t, dict):
                            tname = t.get('name')
                        elif isinstance(t, str):
                            tname = t
                    except Exception:
                        tname = None

                    if not tname:
                        bad_templates.append({'template': t, 'error': 'invalid_template_format'})
                        continue

                    try:
                        tmpl = frappe.get_doc('Item Tax Template', tname)
                    except Exception as exc:
                        bad_templates.append({'template': tname, 'error': 'not_found'})
                        continue

                    # We don't require company matching. If template exists, accept it.

                    valid_template_names.append(tname)

                if bad_templates:
                    results['errors'].append({'item': item_code, 'error': 'invalid_templates', 'details': bad_templates})
                    continue

                # All templates are valid for this company — update the Item taxes
                try:
                    item_doc = frappe.get_doc('Item', item_code)
                    item_doc.taxes = []
                    for tname in valid_template_names:
                        item_doc.append('taxes', {'item_tax_template': tname, 'tax_category': '', 'valid_from': None})
                    item_doc.save(ignore_permissions=True)

                    results['updated'].append({'item': item_code, 'templates': valid_template_names, 'action': 'updated'})
                    # RestrictedPython forbids augmented assignment to subscriptions
                    results['processed'] = results.get('processed', 0) + 1
                except Exception as exc:
                    results['errors'].append({'item': item_code, 'error': str(exc)})

            frappe.response['message'] = results

""".strip()


@erpnext_scripts_bp.route('/api/erpnext-scripts/check-enabled', methods=['GET'])
def check_scripts_enabled():
    """
    Verifica si los Server Scripts están habilitados en ERPNext.
    Consulta el System Settings para ver server_script_enabled.
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        # Prefer a direct method call which returns a simple boolean in `message`.
        # Endpoint: /api/method/frappe.core.doctype.server_script.server_script.enabled
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/method/frappe.core.doctype.server_script.server_script.enabled",
            operation_name="Check Server Scripts Enabled"
        )

        if error:
            return jsonify({
                "success": False,
                "message": "Failed to check server script settings",
                "error": str(error)
            }), 500

        # Only use the server_script.enabled method and its 'message' field — no fallbacks.
        try:
            resp_json = response.json() if response is not None else {}
            enabled_val = bool(resp_json.get('message')) if isinstance(resp_json, dict) else False
        except Exception:
            enabled_val = False

        return jsonify({
            "success": True,
            "enabled": enabled_val
        })
        
    except Exception as e:
        print(f"--- Error checking scripts enabled: {e}")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@erpnext_scripts_bp.route('/api/erpnext-scripts/ensure-bulk-iva', methods=['POST'])
def ensure_bulk_iva_script():
    """
    Asegura que exista el Server Script para bulk update de IVA.
    Si no existe, lo crea. Si existe, opcionalmente lo actualiza.
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        # Antes de cualquier cosa, verificar que Server Scripts esté habilitado en ERPNext
        enabled_resp, enabled_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/method/frappe.core.doctype.server_script.server_script.enabled",
            operation_name="Check Server Scripts Enabled"
        )

        if enabled_err:
            return jsonify({
                "success": False,
                "message": "Failed to check if Server Scripts is enabled",
                "error": str(enabled_err)
            }), 500

        try:
            enabled_json = enabled_resp.json() if enabled_resp is not None else {}
            ss_enabled = bool(enabled_json.get('message'))
        except Exception:
            ss_enabled = False

        if not ss_enabled:
            return jsonify({
                "success": False,
                "message": "Server Scripts are not enabled on the ERPNext site. Please enable server_script_enabled in System Settings before creating server scripts.",
            }), 412

        # Verificar si el script ya existe (no solicitar campos prohibidos como 'enabled')
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Server Script",
            params={
                "fields": json.dumps(["name", "api_method"]),
                "filters": json.dumps([["api_method", "=", "bulk_update_item_iva"]])
            },
            operation_name="Check Bulk IVA Script Exists"
        )
        
        if error:
            return jsonify({
                "success": False,
                "message": "Failed to check if script exists",
                "error": str(error)
            }), 500
        
        try:
            existing_scripts = response.json().get('data', []) if response is not None else []
        except Exception:
            existing_scripts = []
        
        if existing_scripts:
            # Ya existe, eliminarlo para recrearlo con el código actualizado
            script_name = existing_scripts[0].get('name')
            
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Server Script/{script_name}",
                operation_name="Delete Existing Bulk IVA Script"
            )
            
            if delete_error:
                return jsonify({
                    "success": False,
                    "message": "Failed to delete existing script",
                    "error": str(delete_error)
                }), 500
        
        # No existe, crearlo
        create_response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Server Script",
            data={
                # name is required when Doctype uses Prompt naming; use api_method as stable name
                "name": "bulk_update_item_iva",
                "script_type": "API",
                "api_method": "bulk_update_item_iva",
                "script": BULK_ITEM_IVA_SCRIPT,
                "disabled": 0,
                "allow_guest": 0,
                "doctype": "Server Script"
            },
            operation_name="Create Bulk IVA Script"
        )
        
        if create_error:
            return jsonify({
                "success": False,
                "message": "Failed to create script",
                "error": str(create_error)
            }), 500
        
        try:
            created_name = create_response.json().get('data', {}).get('name') if create_response is not None else None
        except Exception:
            created_name = None

        return jsonify({
            "success": True,
            "action": "created",
            "script_name": created_name
        })
        
    except Exception as e:
        print(f"--- Error ensuring bulk IVA script: {e}")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@erpnext_scripts_bp.route('/api/erpnext-scripts/bulk-update-iva', methods=['POST'])
def bulk_update_iva():
    """
    Ejecuta el bulk update de Item Tax Templates usando el Server Script.
    
    Body:
    {
        "items": [
            {"item_code": "CODE-1", "iva_rate": 21.0},
            {"item_code": "CODE-2", "iva_rate": 10.5}
        ],
        "company": "Company Name",
        "transaction_type": "Ventas"  // o "Compras"
    }
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.json
        items = data.get('items', [])
        company = data.get('company')
        transaction_type = data.get('transaction_type', 'Ventas')
        
        if not items:
            return jsonify({
                "success": False,
                "message": "No items provided"
            }), 400
        
        if not company:
            return jsonify({
                "success": False,
                "message": "Company is required"
            }), 400

        # Transform incoming items to the strict server-script contract:
        # items[].item_tax_templates -> [{"name": template_name}, ...]
        try:
            from routes.items import _build_tax_template_lookup, _build_item_taxes

            lookup = _build_tax_template_lookup(session, headers, company)

            transformed_items = []
            errors = []

            # Try to obtain the company abbreviation so we can send item codes
            # with the company suffix (e.g. 'PLZ2217889683 - MS') which ERPNext
            # commonly expects.
            try:
                from routes.general import get_company_abbr, add_company_abbr
                company_abbr = get_company_abbr(session, headers, company)
            except Exception:
                company_abbr = None

            for it in items:
                item_code = it.get('item_code')
                if not item_code:
                    errors.append({'item': 'Unknown', 'error': 'Missing item_code'})
                    continue

                # If frontend already provided item_tax_templates, use them
                provided_templates = it.get('item_tax_templates')
                if provided_templates and isinstance(provided_templates, list):
                    names = []
                    for t in provided_templates:
                        if isinstance(t, dict) and t.get('name'):
                            names.append(t.get('name'))
                        elif isinstance(t, str):
                            names.append(t)
                    if not names:
                        errors.append({'item': item_code, 'error': 'Provided item_tax_templates invalid'})
                        continue
                    transformed_items.append({'item_code': item_code, 'item_tax_templates': [{'name': n} for n in names]})
                    continue

                # Otherwise, build from iva_rate
                iva_rate = it.get('iva_rate')
                taxes = _build_item_taxes(iva_rate, lookup, company)
                if taxes is None:
                    errors.append({'item': item_code, 'error': f'No tax template found for rate {iva_rate}'})
                    continue

                names = []
                for t in taxes:
                    if isinstance(t, dict) and t.get('item_tax_template'):
                        names.append(t.get('item_tax_template'))
                    elif isinstance(t, str):
                        names.append(t)

                if not names:
                    errors.append({'item': item_code, 'error': f'No templates resolved for rate {iva_rate}'})
                    continue

                # Ensure item_code includes company_abbr if available
                if company_abbr and not item_code.endswith(f" - {company_abbr}"):
                    safe_code = add_company_abbr(item_code, company_abbr)
                else:
                    safe_code = item_code

                transformed_items.append({'item_code': safe_code, 'item_tax_templates': [{'name': n} for n in names]})

            if errors:
                return jsonify({'success': False, 'message': 'Some items failed to resolve templates', 'errors': errors}), 400

            data_to_send = {'items': transformed_items}

        except Exception as e:
            print(f"--- Error transforming payload for server script: {e}")
            return jsonify({"success": False, "message": str(e)}), 500
        # Send JSON body (application/json). Server Script will prefer the
        # parsed JSON request body (handled above), so avoid form-encoding.
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/bulk_update_item_iva",
            data=data_to_send,
            operation_name="Bulk Update Item IVA"
        )
        
        if error:
            return jsonify({
                "success": False,
                "message": "Failed to execute bulk update",
                "error": str(error)
            }), 500
        
        # El Server Script devuelve el resultado en response.message
        try:
            response_json = response.json() if response is not None else {}
            print(f"--- Bulk update IVA response: {response_json}")
            result = response_json.get('message', {})
            print(f"--- Bulk update IVA result: {result}")
        except Exception as e:
            print(f"--- Error parsing bulk update response: {e}")
            result = {}
        
        return jsonify({
            "success": result.get('success', False),
            "data": result
        })
        
    except Exception as e:
        print(f"--- Error in bulk update IVA: {e}")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500
