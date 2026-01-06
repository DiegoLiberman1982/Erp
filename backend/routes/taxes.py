from flask import Blueprint, request, jsonify
import os
import requests
import json
import unicodedata
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
import time

# Simple in-memory cache for tax templates keyed by company name.
# Stored value: {'ts': <epoch_seconds>, 'payload': <response-dict>}
TAX_TEMPLATES_CACHE = {}
TAX_TEMPLATES_CACHE_TTL = int(os.getenv('TAX_TEMPLATES_CACHE_TTL', '300'))  # seconds

# Crear el blueprint para las rutas de impuestos
taxes_bp = Blueprint('taxes', __name__)


def _normalize_text(value: str) -> str:
    """Lowercase helper that strips accents to simplify template classification."""
    if not value:
        return ""
    normalized = unicodedata.normalize('NFKD', value)
    ascii_text = normalized.encode('ascii', 'ignore').decode('ascii')
    return ascii_text.lower()

@taxes_bp.route('/api/tax-settings', methods=['GET'])
def get_tax_settings():
    """Obtiene la configuración de impuestos de la empresa activa"""
    print("\n--- Petición de obtener configuración de impuestos ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print("--- Configuración impuestos: error")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        # Configuración por defecto de cuentas de IVA
        tax_settings = {
            "iva_credito_fiscal": {
                "account_name": "IVA Crédito Fiscal",
                "account_code": "1.1.4.01.05",
                "description": "Cuenta para registrar el crédito fiscal de IVA"
            },
            "iva_debito_fiscal": {
                "account_name": "IVA Débito Fiscal",
                "account_code": "2.1.3.01.01",
                "description": "Cuenta para registrar el débito fiscal de IVA"
            }
        }

        # Verificar si las cuentas existen en ERPNext
        for key, setting in tax_settings.items():
            try:
                # Buscar cuenta por código (usar params con JSON para filters)
                account_filters = [["name", "=", setting["account_code"]]]
                account_resp, account_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Account",
                    params={
                        "filters": json.dumps(account_filters),
                        "limit_page_length": 1
                    },
                    operation_name=f"Check tax account existence '{setting['account_code']}'"
                )

                if account_error:
                    setting["exists"] = False
                elif account_resp.status_code == 200:
                    account_data = account_resp.json()
                    if account_data.get("data"):
                        actual_account = account_data["data"][0]
                        setting["exists"] = True
                        setting["actual_name"] = actual_account.get("account_name", actual_account.get("name"))
                    else:
                        setting["exists"] = False
                else:
                    setting["exists"] = False

            except Exception as e:
                setting["exists"] = False

        return jsonify({"success": True, "data": tax_settings, "message": "Configuración de impuestos obtenida correctamente"})

    except Exception as e:
        print("--- Configuración impuestos: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@taxes_bp.route('/api/tax-settings', methods=['POST'])
def create_tax_accounts():
    """Crea las cuentas de impuestos si no existen"""
    print("\n--- Petición de crear cuentas de impuestos ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Usar la función utilitaria
    result = create_tax_accounts_util(session, headers, user_id)
    return jsonify(result)

@taxes_bp.route('/api/tax-settings/<account_code>', methods=['PUT'])
def update_tax_account(account_code):
    """Actualiza una cuenta de impuestos específica"""
    print("--- Actualizar cuenta impuestos: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos a actualizar
    update_data = request.get_json()

    if not update_data or 'data' not in update_data:
        return jsonify({"success": False, "message": "Datos de actualización requeridos"}), 400

    try:
        # Actualizar la cuenta en ERPNext
        update_resp, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Account/{account_code}",
            data=update_data,
            operation_name=f"Update tax account '{account_code}'"
        )

        if update_error:
            print("--- Actualizar cuenta impuestos: error")
            return handle_erpnext_error(update_error, f"Failed to update tax account {account_code}")

        if update_resp.status_code == 200:
            updated_data = update_resp.json()
            print("--- Actualizar cuenta impuestos: ok")
            return jsonify({
                "success": True,
                "message": "Cuenta de impuestos actualizada correctamente",
                "data": updated_data.get("data", {})
            })
        else:
            print("--- Actualizar cuenta impuestos: error")
            return jsonify({"success": False, "message": f"Error al actualizar cuenta: {update_resp.status_code}"}), 500

    except Exception as e:
        print("--- Actualizar cuenta impuestos: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@taxes_bp.route('/api/tax-templates', methods=['GET'])
def get_tax_templates():
    """
    Obtener todos los Item Tax Templates de IVA para ventas y compras de la compañía activa.
    
    Cada alícuota cuenta con su propio template (ventas/compras) creado por
    setup_item_tax_templates.py. Esta ruta devuelve el detalle de cada uno y el mapa
    tasa -> template listo para asignaciones.
    """
    print("--- Templates impuestos: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print("--- Templates impuestos: error - no company")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        # Obtener abreviatura de la compañía (para información adicional en logs/respuesta)
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            print("--- Templates impuestos: error - no abbr")
            return jsonify({"success": False, "message": "Error obteniendo abreviatura de la compañía"}), 400

        print(f"--- Templates impuestos: company={company_name}, abbr={company_abbr}")

        # Check if nocache is requested
        nocache = request.args.get('nocache', '0') == '1'

        # Check cache first (unless nocache is requested)
        if not nocache:
            cache_entry = TAX_TEMPLATES_CACHE.get(company_name)
            if cache_entry and (time.time() - cache_entry.get('ts', 0)) < TAX_TEMPLATES_CACHE_TTL:
                payload = cache_entry.get('payload', {})
                sales_len = len(payload.get('data', {}).get('sales', []) or [])
                purchase_len = len(payload.get('data', {}).get('purchase', []) or [])
                if sales_len + purchase_len == 0:
                    # If cache exists but contains zero templates, treat it as stale
                    # and continue with a fresh fetch. This prevents stale-empty
                    # caches from masking available templates in ERPNext.
                    print(f"--- Templates impuestos: cache encontrada pero vacía (sales={sales_len}, purchase={purchase_len}) -> forzando refetch")
                else:
                    print(f"--- Templates impuestos: usando cache (sales={sales_len}, purchase={purchase_len})")
                    return jsonify(payload)

        tax_templates_sales = []
        tax_templates_purchase = []
        rate_to_template_map_sales = {}
        rate_to_template_map_purchase = {}
        template_records = []

        # Obtener todos los templates de la compañía y clasificarlos
        # Incluimos custom_transaction_type para clasificación directa (sin heurísticas)
        list_response, list_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Tax Template",
            params={
                "fields": json.dumps(["name", "title", "company", "disabled", "custom_transaction_type"]),
                "filters": json.dumps([["company", "=", company_name], ["disabled", "=", 0]]),
                "limit_page_length": 500
            },
            operation_name="List Item Tax Templates for IVA"
        )

        if list_error or not list_response or list_response.status_code != 200:
            err_msg = list_error.get('message') if list_error else list_response.text
            print(f"--- Templates impuestos: error listando templates - {err_msg}")
            return jsonify({"success": False, "message": "Error obteniendo plantillas de impuestos"}), 400

        templates = list_response.json().get('data', []) or []
        print(f"--- Templates impuestos: {len(templates)} registros encontrados (sin filtrar)")

        # Collect base template records (name + title + custom_transaction_type)
        # La clasificación se hace usando el campo custom_transaction_type (Ventas/Compras)
        for template_doc in templates:
            template_name = template_doc.get('name')
            title = template_doc.get('title') or template_name
            transaction_type = template_doc.get('custom_transaction_type') or ''

            template_records.append({
                "name": template_name,
                "title": title,
                "custom_transaction_type": transaction_type
            })

        parent_names = [tpl['name'] for tpl in template_records]

        children_by_parent = {}
        if parent_names:
            chunk_size = 40
            # Only request fields allowed by frappe.client.get_list for Item Tax Template Detail.
            # 'account_head' can be restricted by ERPNext and caused DataError/417. Use tax_type and tax_rate.
            fields = ["name", "parent", "tax_type", "tax_rate"]
            for i in range(0, len(parent_names), chunk_size):
                chunk = parent_names[i:i + chunk_size]
                filters = {
                    "parent": ["in", chunk],
                    "parenttype": "Item Tax Template"
                }
                # Use the documented get_list payload for child tables and include
                # the top-level "parent" argument to satisfy ERPNext permission checks
                # for child/parent access.
                detail_response, detail_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.get_list",
                    data={
                        "doctype": "Item Tax Template Detail",
                        "parent": "Item Tax Template",
                        "fields": json.dumps(fields),
                        "filters": json.dumps(filters),
                        "limit_page_length": 500
                    },
                    operation_name=f"Bulk fetch Item Tax Template Detail ({len(chunk)} parents)"
                )

                if detail_error or not detail_response or detail_response.status_code != 200:
                    print(f"--- Templates impuestos: error get_list chunk ({i}-{i+len(chunk)}): {detail_error.get('message') if detail_error else detail_response.text}")
                    continue

                rows = detail_response.json().get('message', []) or []
                for row in rows:
                    parent = row.get('parent')
                    if not parent:
                        continue
                    children_by_parent.setdefault(parent, []).append(row)

        for template_info in template_records:
            template_name = template_info["name"]
            title = template_info["title"]
            transaction_type = template_info.get("custom_transaction_type", "")
            
            # Clasificación usando el campo custom_transaction_type (sin heurísticas)
            is_sales = transaction_type == "Ventas"
            is_purchase = transaction_type == "Compras"

            taxes = children_by_parent.get(template_name, []) or []

            if not taxes:
                print(f"--- Templates impuestos: template {template_name} sin taxes, se ignora")
                continue

            iva_rates = []
            accounts = []
            for tax in taxes:
                if not isinstance(tax, dict):
                    continue
                account_ref = tax.get('tax_type') or tax.get('account_head')
                if account_ref:
                    accounts.append(account_ref)
                if tax.get('tax_rate') is None:
                    continue
                try:
                    rate = float(tax.get('tax_rate'))
                    iva_rates.append(rate)
                    rate_key = str(rate)
                    
                    # Usar la clasificación del campo custom_transaction_type
                    if is_sales:
                        rate_to_template_map_sales.setdefault(rate_key, template_name)
                        print(f"--- Template {template_name}: tasa {rate} asignada (ventas)")
                    if is_purchase:
                        rate_to_template_map_purchase.setdefault(rate_key, template_name)
                        print(f"--- Template {template_name}: tasa {rate} asignada (compras)")
                except (TypeError, ValueError):
                    continue

            if not iva_rates:
                continue

            # Si no tiene custom_transaction_type definido, ignorar el template
            # No usamos fallbacks ni heurísticas
            if not is_sales and not is_purchase:
                print(f"--- Templates impuestos: template {template_name} sin custom_transaction_type -> se ignora")
                continue

            template_summary = {
                "name": template_name,
                "title": title,
                "iva_rates": iva_rates,
                "accounts": accounts,
                "tax_count": len(taxes),
                "transaction_type": transaction_type
            }

            if is_sales:
                tax_templates_sales.append(template_summary)
            if is_purchase:
                tax_templates_purchase.append(template_summary)

        # Ordenar por tasa para facilitar lectura en el frontend
        tax_templates_sales.sort(key=lambda tpl: tpl.get('iva_rates', [999])[0])
        tax_templates_purchase.sort(key=lambda tpl: tpl.get('iva_rates', [999])[0])

        # Build a merged flat map (sales wins in conflicts)
        merged_map = dict(rate_to_template_map_sales)
        for k, v in rate_to_template_map_purchase.items():
            merged_map.setdefault(k, v)

        payload = {
            "success": True,
            "data": {
                "sales": tax_templates_sales,
                "purchase": tax_templates_purchase
            },
            "rate_to_template_map": {
                "sales": rate_to_template_map_sales,
                "purchase": rate_to_template_map_purchase,
                "flat": merged_map
            }
        }

        # Store in cache
        TAX_TEMPLATES_CACHE[company_name] = {"ts": time.time(), "payload": payload}

        total_templates = len(tax_templates_sales) + len(tax_templates_purchase)
        print(f"--- Templates impuestos: {total_templates} templates IVA procesados (ventas={len(tax_templates_sales)}, compras={len(tax_templates_purchase)})")
        print(f"--- rate_to_template_map_sales: {rate_to_template_map_sales}")
        print(f"--- rate_to_template_map_purchase: {rate_to_template_map_purchase}")

        return jsonify(payload)
    except Exception as e:
        print(f"--- Templates impuestos: error (outer): {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@taxes_bp.route('/api/tax-templates/resolve-for-item', methods=['POST'])
def resolve_item_tax_template():
    """
    Dado un item (ERP name) y un transaction_type ('Ventas' | 'Compras'),
    busca entre las Item Tax asociadas al item y devuelve el Item Tax Template
    que tenga custom_transaction_type igual al transaction_type, junto con
    su tax_rate (primer tax_rate encontrado en el template).

    Body: { item_name: string, transaction_type: 'Ventas'|'Compras' }
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json() or {}
        item_name = data.get('item_name')
        transaction_type = data.get('transaction_type')

        if not item_name or not transaction_type:
            return jsonify({"success": False, "message": "item_name and transaction_type required"}), 400

        # Build candidate parent names intelligently so we don't duplicate company abbr
        company_abbr = get_company_abbr(session, headers, get_active_company(user_id))
        candidates = set()
        orig_name = (item_name or '').strip()
        if orig_name:
            candidates.add(orig_name)
        if company_abbr:
            suff = f" - {company_abbr}"
            # If original doesn't already end with the abbr, try with it appended
            if orig_name and not orig_name.endswith(suff):
                candidates.add(orig_name + suff)
            # Collapse duplicates like ' - MS - MS' into single occurrence and add
            import re
            collapsed = re.sub(rf"(\s-\s{re.escape(company_abbr)})+$", suff, orig_name)
            if collapsed:
                candidates.add(collapsed)

        # Ensure non-empty list
        candidate_list = [c for c in list(candidates) if c]

        # Query Item Tax child table for this item to get the templates linked
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data={
                "doctype": "Item Tax",
                "parent": "Item",
                "fields": ["parent", "item_tax_template"],
                "filters": [
                    ["parent", "in", candidate_list],
                    ["parenttype", "=", "Item"]
                ],
                "limit_page_length": 5000
            },
            operation_name="Get Item Tax templates for item"
        )

        if error or not response or response.status_code != 200:
            return jsonify({"success": False, "message": "Error fetching item tax rows"}), 500

        rows = response.json().get('message', []) or []
        template_names = list({r.get('item_tax_template') for r in rows if r.get('item_tax_template')})

        if not template_names:
            return jsonify({"success": False, "message": "No item tax templates found for item"}), 404

        # Fetch those templates and filter by custom_transaction_type
        # Use GET with filters to fetch multiple templates in one call
        params = {
            "fields": json.dumps(["name", "custom_transaction_type"]),
            "filters": json.dumps([["name", "in", template_names]]),
            "limit_page_length": 500
        }
        tmpl_resp, tmpl_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Tax Template",
            params=params,
            operation_name="Get Item Tax Template docs for item templates"
        )

        if tmpl_err or not tmpl_resp or tmpl_resp.status_code != 200:
            return jsonify({"success": False, "message": "Error fetching template docs"}), 500

        templates = tmpl_resp.json().get('data', []) or []
        # Find template names matching the requested transaction_type
        desired = [t.get('name') for t in templates if t.get('custom_transaction_type') == transaction_type]

        if not desired:
            # No match for this transaction type
            return jsonify({"success": False, "message": f"No Item Tax Template with custom_transaction_type={transaction_type} found for this item"}), 404

        chosen_template = desired[0]

        # Fetch the template's detail rows to get tax_rate
        detail_resp, detail_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data={
                "doctype": "Item Tax Template Detail",
                "parent": "Item Tax Template",
                "fields": ["tax_type", "tax_rate"],
                "filters": [
                    ["parent", "=", chosen_template],
                    ["parenttype", "=", "Item Tax Template"]
                ],
                "limit_page_length": 5000
            },
            operation_name=f"Get Item Tax Template Detail for {chosen_template}"
        )

        if detail_err or not detail_resp or detail_resp.status_code != 200:
            return jsonify({"success": False, "message": "Error fetching template detail"}), 500

        details = detail_resp.json().get('message', []) or []
        iva_rate = None
        taxes = []
        for d in details:
            taxes.append(d)
            if iva_rate is None and d.get('tax_rate') is not None:
                try:
                    iva_rate = float(d.get('tax_rate'))
                except Exception:
                    pass

        return jsonify({"success": True, "data": {"template_name": chosen_template, "iva_rate": iva_rate, "taxes": taxes}})

    except Exception as e:
        print(f"Error in resolve_item_tax_template: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

    except Exception as e:
        print(f"--- Templates impuestos: error - {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@taxes_bp.route('/api/tax-templates/<path:template_name>', methods=['GET'])
def get_tax_template_details(template_name):
    """Obtener detalles de una plantilla de impuesto específica"""
    print("--- Detalles template: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print("--- Detalles template: error")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        # Obtener detalles del template
        template_resp, template_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item Tax Template/{quote(template_name)}",
            operation_name=f"Get tax template details '{template_name}'"
        )

        if template_error:
            print("--- Detalles template: error")
            return handle_erpnext_error(template_error, f"Failed to get tax template {template_name}")

        if template_resp.status_code != 200:
            print("--- Detalles template: error")
            return jsonify({"success": False, "message": f"Error obteniendo template: {template_resp.text}"}), 400

        template_data = template_resp.json().get('data', {})

        # Verificar que el template pertenece a la compañía correcta
        if template_data.get('company') != company_name:
            return jsonify({"success": False, "message": "Template no pertenece a la compañía activa"}), 403

        return jsonify({
            "success": True,
            "data": template_data,
            "message": "Detalle de plantilla de impuesto obtenido correctamente"
        })

    except Exception as e:
        print("--- Detalles template: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@taxes_bp.route('/api/tax-templates/<path:template_name>', methods=['PUT'])
def update_tax_template(template_name):
    """Actualizar las cuentas de un template de impuesto específico"""
    print("--- Actualizar template: procesando")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print("--- Actualizar template: error")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        # Obtener datos a actualizar
        update_data = request.get_json()
        accounts = update_data.get('accounts', [])

        # Obtener detalles actuales del template
        template_resp, template_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item Tax Template/{quote(template_name)}",
            operation_name=f"Get tax template details '{template_name}'"
        )

        if template_error:
            print("--- Actualizar template: error")
            return handle_erpnext_error(template_error, f"Failed to get tax template {template_name}")

        if template_resp.status_code != 200:
            print("--- Actualizar template: error")
            return jsonify({"success": False, "message": f"Error obteniendo template: {template_resp.text}"}), 400

        template_data = template_resp.json().get('data', {})

        # Verificar que el template pertenece a la compañía correcta
        if template_data.get('company') != company_name:
            return jsonify({"success": False, "message": "Template no pertenece a la compañía activa"}), 403

        # Actualizar las taxes del template
        taxes = template_data.get('taxes', [])
        if len(taxes) != len(accounts):
            # Si no coinciden las longitudes, actualizar todas con la primera cuenta (o agregar)
            for i, tax in enumerate(taxes):
                if i < len(accounts):
                    tax['tax_type'] = accounts[i]
                else:
                    tax['tax_type'] = accounts[0] if accounts else ''
        else:
            # Actualizar cada tax con la cuenta correspondiente
            for i, tax in enumerate(taxes):
                tax['tax_type'] = accounts[i]

        # Actualizar el template
        update_resp, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Item Tax Template/{quote(template_name)}",
            data={"data": template_data},
            operation_name=f"Update tax template '{template_name}'"
        )

        if update_error:
            print("--- Actualizar template: error")
            return handle_erpnext_error(update_error, f"Failed to update tax template {template_name}")

        if update_resp.status_code == 200:
            # Invalidate cache for this company so clients get fresh templates
            try:
                TAX_TEMPLATES_CACHE.pop(company_name, None)
            except Exception:
                pass
            print("--- Actualizar template: ok")
            return jsonify({
                "success": True,
                "message": "Template de impuesto actualizado correctamente"
            })
        else:
            print("--- Actualizar template: error")
            return jsonify({"success": False, "message": f"Error actualizando template: {update_resp.status_code}"}), 500

    except Exception as e:
        print("--- Actualizar template: error")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

# Función utilitaria para crear cuentas de impuestos (sin depender de Flask)
def create_tax_accounts_util(session, headers, user_id):
    """Función utilitaria para crear cuentas de impuestos - puede ser llamada desde otros módulos"""
    print("\n--- Creando cuentas de impuestos (utilitaria) ---")

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print("--- Crear cuentas impuestos: error")
            return {"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}

        # Obtener la abreviatura de la compañía
        company_abbr = get_company_abbr(session, headers, company_name)

        # Simplificar: Solo crear las cuentas finales directamente bajo cuentas padre existentes
        # Buscar cuentas padre disponibles para Tax
        tax_parent_accounts = []
        try:
            # Buscar cuentas padre de tipo Tax que ya existan
            parent_resp, parent_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Account",
                params={
                    "filters": json.dumps([["account_type","=","Tax"],["is_group","=",1],["company","=",company_name]]),
                    "fields": json.dumps(["name","account_name","parent_account"]),
                    "limit_page_length": 50
                },
                operation_name="Get tax parent accounts"
            )
            
            if parent_error:
                pass  # Continue to next attempt
            elif parent_resp.status_code == 200:
                parent_data = parent_resp.json()
                tax_parent_accounts = parent_data.get('data', [])
                print(f"--- Cuentas padre tax: {len(tax_parent_accounts)} registros")
            else:
                pass
        except Exception as e:
            pass

        # Si no hay cuentas padre específicas, buscar cualquier cuenta padre
        if not tax_parent_accounts:
            try:
                # Buscar cuentas padre generales
                general_resp, general_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Account",
                    params={
                        "filters": json.dumps([["is_group","=",1],["company","=",company_name]]),
                        "fields": json.dumps(["name","account_name","account_type"]),
                        "limit_page_length": 20
                    },
                    operation_name="Get general parent accounts"
                )
                
                if general_error:
                    pass
                elif general_resp.status_code == 200:
                    general_data = general_resp.json()
                    all_parent_accounts = general_data.get('data', [])
                    # Priorizar cuentas relacionadas con impuestos o contabilidad
                    tax_related = [acc for acc in all_parent_accounts if 'tax' in acc.get('account_name', '').lower() or 'iva' in acc.get('account_name', '').lower() or 'fiscal' in acc.get('account_name', '').lower()]
                    if tax_related:
                        tax_parent_accounts = tax_related
                    else:
                        # Usar las primeras cuentas padre disponibles
                        tax_parent_accounts = all_parent_accounts[:5] if all_parent_accounts else []
                    
                    print(f"--- Cuentas padre generales: {len(tax_parent_accounts)} registros")
                else:
                    pass
            except Exception as e:
                pass

        # Usar la primera cuenta padre disponible como fallback, o una cuenta por defecto
        default_parent = tax_parent_accounts[0]['name'] if tax_parent_accounts else "Application of Funds (Assets)"  # Cuenta por defecto que debería existir

        # Cuentas a crear con nombres que incluyen el código de la compañía
        accounts_to_create = [
            {
                "name": f"1.1.4.01.05 - IVA Crédito Fiscal - {company_abbr}",
                "account_name": f"IVA Crédito Fiscal - {company_abbr}",
                "parent_account": default_parent,
                "account_type": "Chargeable",
                "is_group": 0,
                "company": company_name
            },
            {
                "name": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                "account_name": f"IVA Débito Fiscal - {company_abbr}",
                "parent_account": default_parent,
                "account_type": "Chargeable",
                "is_group": 0,
                "company": company_name
            }
        ]

        created_accounts = []
        errors = []

        for account in accounts_to_create:
            try:
                # Verificar si la cuenta ya existe
                check_resp, check_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Account",
                    params={
                        "filters": json.dumps([["name","=",account["name"]]]),
                        "limit_page_length": 1
                    },
                    operation_name=f"Check if account exists '{account['name']}'"
                )

                if check_error:
                    error_msg = f"Error verificando cuenta {account['name']}: {check_error}"
                    errors.append(error_msg)
                    continue
                elif check_resp.status_code == 200:
                    check_data = check_resp.json()
                    if check_data.get("data"):
                        created_accounts.append({
                            "name": account['name'],
                            "account_name": account['account_name'],
                            "status": "already_exists"
                        })
                        continue

                # Crear la cuenta
                create_resp, create_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Account",
                    data={"data": account},
                    operation_name=f"Create tax account '{account['name']}'"
                )

                if create_error:
                    error_msg = f"Error creando cuenta {account['name']}: {create_error}"
                    errors.append(error_msg)
                elif create_resp.status_code == 200:
                    created_data = create_resp.json()
                    created_accounts.append({
                        "name": account['name'],
                        "account_name": account['account_name'],
                        "status": "created",
                        "data": created_data.get("data", {})
                    })
                else:
                    error_msg = f"Error creando cuenta {account['name']}: {create_resp.status_code} - {create_resp.text}"
                    errors.append(error_msg)

            except Exception as e:
                error_msg = f"Error procesando cuenta {account['name']}: {e}"
                errors.append(error_msg)

        # Respuesta final
        if errors:
            return {
                "success": False,
                "message": f"Se encontraron errores al crear cuentas: {'; '.join(errors)}",
                "created_accounts": created_accounts,
                "errors": errors
            }
        else:
            return {
                "success": True,
                "message": "Cuentas de impuestos procesadas correctamente",
                "created_accounts": created_accounts
            }

    except Exception as e:
        print("--- Crear cuentas impuestos: error")
        return {"success": False, "message": f"Error interno del servidor: {str(e)}"}
