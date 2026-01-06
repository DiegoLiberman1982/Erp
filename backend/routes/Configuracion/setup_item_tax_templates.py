"""
Setup - Item Tax Templates
Handles creation and verification of item tax templates in ERPNext
"""

from urllib.parse import quote
from flask import jsonify, request
import unicodedata
import json
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar configuración
from config import ERPNEXT_URL

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr


def check_item_tax_templates():
    """Verificar la configuración actual de las plantillas de impuestos para ítems"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user)

        if not company_name:
            return jsonify({"success": False, "message": f"No hay compañía activa para el usuario {user}"}), 400

        # Obtener cuentas de IVA para determinar las correctas
        tax_accounts_response, tax_accounts_err = make_erpnext_request(
            session, 'GET', 
            "/api/resource/Account",
            params={
                "fields": json.dumps(["name","account_name","company"]),
                "limit_page_length": 100
            },
            operation_name="Fetch Tax Accounts"
        )

        debit_tax_account = None
        credit_tax_account = None
        if tax_accounts_err is None and tax_accounts_response and tax_accounts_response.status_code == 200:
            tax_accounts_data = tax_accounts_response.json()
            all_accounts = tax_accounts_data.get('data', [])
            tax_accounts = [acc for acc in all_accounts if acc.get('company') == company_name and 'IVA' in acc.get('name', '') and 'Fiscal' in acc.get('name', '')]
            print(f"check_item_tax_templates: found {len(tax_accounts)} tax accounts for company {company_name}")
            for account in tax_accounts:
                print(f"  - {account['name']}: {account['account_name']}")
            for account in tax_accounts:
                if 'IVA Débito Fiscal' in account['name']:
                    debit_tax_account = account['name']
                if 'IVA Crédito Fiscal' in account['name']:
                    credit_tax_account = account['name']
            print(f"check_item_tax_templates: debit_tax_account = {debit_tax_account}")
            print(f"check_item_tax_templates: credit_tax_account = {credit_tax_account}")
        else:
            print(f"Error obteniendo cuentas de impuestos: {tax_accounts_response.status_code if tax_accounts_response else tax_accounts_err.get('status_code') if tax_accounts_err else 'unknown'}")

        # Obtener plantillas de impuestos para ítems filtradas por compañía
        response, response_err = make_erpnext_request(
            session, 'GET', 
            "/api/resource/Item Tax Template",
            params={
                "filters": json.dumps([["company","=",company_name]]),
                "fields": json.dumps(["name","title","company"]),
                "limit_page_length": 100
            },
            operation_name="Fetch Item Tax Templates"
        )

        if response_err:
            print(f"check_item_tax_templates: Error fetching templates: {response_err.get('message')}")
            return jsonify({"success": False, "message": "Error obteniendo plantillas de impuestos"}), 400

        print(f"check_item_tax_templates: Respuesta ERPNext: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            templates = data.get('data', [])

            # Procesar cada plantilla consultándola individualmente para obtener los taxes
            processed_templates = []
            for template in templates:
                template_name = template.get('name')
                title = template.get('title', '')

                print(f"check_item_tax_templates: Consultando plantilla individual: {template_name}")

                # Consultar la plantilla completa para obtener los taxes
                detail_endpoint = f"/api/resource/Item Tax Template/{quote(template_name)}"
                detail_response, detail_err = make_erpnext_request(session, 'GET', detail_endpoint, operation_name=f"Get Item Tax Template {template_name}")

                taxes = []
                if detail_err is None and detail_response and detail_response.status_code == 200:
                    detail_data = detail_response.json().get('data', {})
                    taxes = detail_data.get('taxes', [])
                    print(f"check_item_tax_templates: Plantilla {template_name} tiene {len(taxes)} taxes")
                else:
                    print(f"check_item_tax_templates: Error obteniendo detalles de {template_name}: {detail_err.get('message') if detail_err else 'unknown'}")

                # Determinar si es correcta
                is_correct = False
                expected_account = ""

                if taxes:
                    # Use the account_head from the first tax row to determine
                    # whether this template is sales/purchase-correct. Some ERPNext
                    # Item Tax Template documents use `account_head` to point to the
                    # account, and `tax_type` can be used as a label. Historically
                    # we were comparing `tax_type` to the account name which caused
                    # issues when creating multiple rates pointing to the same
                    # account. Compare `account_head` instead.
                    tax_account = taxes[0].get('account_head') or taxes[0].get('tax_type', '')

                    # Determinar si debería usar débito o crédito
                    is_sales = ('Ventas' in title or 'Sales' in title or 'Ventas' in template_name or 'Sales' in template_name)
                    is_purchase = ('Compras' in title or 'Purchase' in title or 'Compras' in template_name or 'Purchase' in template_name)

                    if is_sales:
                        expected_account = debit_tax_account if debit_tax_account else "IVA Débito Fiscal"
                        is_correct = tax_account == expected_account
                    elif is_purchase:
                        expected_account = credit_tax_account if credit_tax_account else "IVA Crédito Fiscal"
                        is_correct = tax_account == expected_account
                    else:
                        # Para otros casos (exentos, etc.), usar débito por defecto
                        expected_account = debit_tax_account if debit_tax_account else "IVA Débito Fiscal"
                        is_correct = tax_account == expected_account

                processed_templates.append({
                    'name': template_name,
                    'title': title,
                    'company': template.get('company'),
                    'taxes': taxes,
                    'is_correct': is_correct,
                    'expected_account': expected_account
                })

            return jsonify({
                "success": True,
                "templates": processed_templates,
                "count": len(processed_templates),
                "message": f"Encontradas {len(processed_templates)} plantillas de impuestos"
            })
        else:
            print(f"check_item_tax_templates: Error ERPNext: {response.text}")
            return jsonify({"success": False, "message": "Error obteniendo plantillas de impuestos"}), 400

    except Exception as e:
        print(f"Error en check_item_tax_templates: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def ensure_item_tax_templates_exist_v2(session, headers, user_id):
    """
    Asegura que existan las plantillas de Item Tax Template necesarias para la compañía.
    
    IMPORTANTE: Requiere que ensure_iva_tax_accounts_exist() se haya ejecutado ANTES
    para tener las cuentas de IVA por tasa creadas.
    
    Crea una plantilla de IVA por cada alícuota y tipo (Ventas/Compras), cada una apuntando
    a la cuenta correspondiente para esa tasa. Los nombres de plantillas no incluyen el
    símbolo % para evitar problemas en integraciones externas.
    """
    print("\n--- Verificando/Creando Plantillas de Item Tax Template V2 ---")

    # Importar helper para obtener mapa de cuentas IVA
    from .setup_iva_accounts import get_iva_accounts_map, IVA_RATES

    def format_rate_label(rate_value: float) -> str:
        """Devuelve la tasa formateada sin el símbolo % para usarla en los nombres."""
        numeric_rate = float(rate_value)
        if numeric_rate.is_integer():
            return str(int(numeric_rate))
        rate_str = f"{numeric_rate}".rstrip('0').rstrip('.')
        return rate_str or "0"

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa configurada para el usuario {user_id}")
            return {"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}

        print(f"Compañía activa: {company_name}")

        # Obtener la abreviatura de la compañía
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return {"success": False, "message": "Error obteniendo abreviatura de la compañía"}

        # Obtener mapa de cuentas de IVA existentes (creadas por ensure_iva_tax_accounts_exist)
        iva_accounts = get_iva_accounts_map(session, headers, company_name, company_abbr)
        
        print(f"Cuentas IVA Débito encontradas: {len(iva_accounts['debito'])}")
        print(f"Cuentas IVA Crédito encontradas: {len(iva_accounts['credito'])}")

        # Verificar que existan las cuentas necesarias
        if not iva_accounts["debito"]:
            return {
                "success": False, 
                "message": "Faltan cuentas de IVA Débito Fiscal. Ejecute primero ensure_iva_tax_accounts_exist()"
            }
        if not iva_accounts["credito"]:
            return {
                "success": False, 
                "message": "Faltan cuentas de IVA Crédito Fiscal. Ejecute primero ensure_iva_tax_accounts_exist()"
            }

        tax_templates = []
        for rate in IVA_RATES:
            rate_label = format_rate_label(rate)
            # Formato corregido: "IVA {rate} Ventas - {abbr}" para evitar duplicación de abbr
            # ERPNext agrega " - {abbr}" automáticamente al name, así que el title no debe incluirlo
            sales_title = f"IVA {rate_label} Ventas"
            purchase_title = f"IVA {rate_label} Compras"

            debito_account = iva_accounts["debito"].get(rate)
            credito_account = iva_accounts["credito"].get(rate)

            ventas_taxes = []
            if debito_account:
                ventas_taxes.append({
                    "tax_type": debito_account,
                    "tax_rate": rate
                })
            else:
                print(f"ADVERTENCIA: No existe cuenta de IVA Débito para tasa {rate}")

            compras_taxes = []
            if credito_account:
                compras_taxes.append({
                    "tax_type": credito_account,
                    "tax_rate": rate
                })
            else:
                print(f"ADVERTENCIA: No existe cuenta de IVA Crédito para tasa {rate}")

            # Incluir custom_transaction_type para identificar claramente ventas/compras
            tax_templates.append({
                "title": sales_title,
                "taxes": ventas_taxes,
                "custom_transaction_type": "Ventas"
            })
            tax_templates.append({
                "title": purchase_title,
                "taxes": compras_taxes,
                "custom_transaction_type": "Compras"
            })

        created_templates = []
        errors = []

        for template in tax_templates:
            try:
                template_name = template["title"]  # Usamos title como identificador

                # Verificar si la plantilla ya existe
                # Buscar por title Y company (ERPNext genera name = title)
                params = {
                    'filters': json.dumps([
                        ["title", "=", template_name],
                        ["company", "=", company_name]
                    ]),
                    'limit_page_length': 1
                }
                endpoint = "/api/resource/Item Tax Template"
                check_response, check_err = make_erpnext_request(session, 'GET', endpoint, params=params, operation_name=f"Check Item Tax Template {template_name}")

                if check_err:
                    err_msg = f"Error verificando plantilla '{template_name}': {check_err.get('message')}"
                    print(err_msg)
                    errors.append(err_msg)
                else:
                    if check_response.status_code == 200:
                        check_data = check_response.json()
                        if check_data.get("data"):
                            print(f"Plantilla '{template_name}' ya existe — validando contenido")
                            # Obtain the existing doc name (first match)
                            existing_name = check_data.get("data")[0].get('name')
                            # Fetch full details to inspect taxes
                            detail_endpoint = f"/api/resource/Item Tax Template/{quote(existing_name)}"
                            detail_resp, detail_err = make_erpnext_request(session, 'GET', detail_endpoint, operation_name=f"Get Item Tax Template {existing_name}")
                            if detail_err or not detail_resp or detail_resp.status_code != 200:
                                # We could not fetch details — mark as already_exists and continue
                                created_templates.append({
                                    "name": template_name,
                                    "status": "already_exists_unverified"
                                })
                                continue

                            detail_doc = detail_resp.json().get('data', {})
                            existing_taxes = detail_doc.get('taxes', []) or []
                            existing_transaction_type = detail_doc.get('custom_transaction_type') or ''
                            expected_transaction_type = template.get('custom_transaction_type') or ''
                            
                            existing_rates = set()
                            for t in existing_taxes:
                                try:
                                    existing_rates.add(float(t.get('tax_rate', 0)))
                                except Exception:
                                    continue

                            expected_rates = set()
                            for t in (template.get('taxes') or []):
                                try:
                                    expected_rates.add(float(t.get('tax_rate', 0)))
                                except Exception:
                                    continue

                            # Check if rates match AND custom_transaction_type is set correctly
                            rates_match = existing_rates == expected_rates
                            transaction_type_match = existing_transaction_type == expected_transaction_type
                            
                            if rates_match and transaction_type_match:
                                print(f"Plantilla '{template_name}' ya contiene las tasas y tipo de transacción esperados")
                                created_templates.append({
                                    "name": template_name,
                                    "status": "already_exists"
                                })
                                continue

                            # Update the template if rates or transaction_type differ
                            update_reasons = []
                            if not rates_match:
                                update_reasons.append("tasas")
                            if not transaction_type_match:
                                update_reasons.append("custom_transaction_type")
                            print(f"Plantilla '{template_name}' existe pero difiere en {', '.join(update_reasons)} — actualizando.")
                            
                            update_endpoint = f"/api/resource/Item Tax Template/{quote(existing_name)}"
                            # Build the desired taxes (only include entries with a tax_type - link to account)
                            desired_taxes = [t for t in (template.get('taxes') or []) if t.get('tax_type')]
                            update_payload = {"taxes": desired_taxes}
                            # Always include custom_transaction_type in update
                            if expected_transaction_type:
                                update_payload["custom_transaction_type"] = expected_transaction_type
                            update_resp, update_err = make_erpnext_request(session, 'PUT', update_endpoint, data={"data": update_payload}, operation_name=f"Update Item Tax Template {existing_name}")
                            if update_err or not update_resp or update_resp.status_code != 200:
                                err_msg = f"Error actualizando plantilla '{template_name}': {update_err.get('message') if update_err else (update_resp.text if update_resp else 'unknown')}"
                                print(err_msg)
                                errors.append(err_msg)
                            else:
                                created_templates.append({
                                    "name": template_name,
                                    "status": "updated"
                                })
                            continue

                # Verificar que todas las cuentas de impuestos estén asignadas
                valid_taxes = []
                for tax in template["taxes"]:
                    if tax.get("tax_type"):  # tax_type es el link a la cuenta
                        valid_taxes.append(tax)
                    else:
                        account_type_needed = "IVA Débito Fiscal" if "Ventas" in template_name else "IVA Crédito Fiscal"
                        print(f"ADVERTENCIA: Cuenta de impuestos '{account_type_needed}' no encontrada para plantilla '{template_name}'")

                if not valid_taxes:
                    error_msg = f"No se pueden crear impuestos válidos para plantilla '{template_name}' - faltan cuentas"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                # Preparar datos de la plantilla
                # NO pasar "name" - ERPNext lo genera automáticamente basado en "title"
                template_data = {
                    "title": template["title"],
                    "company": company_name,
                    "taxes": valid_taxes
                }
                
                # Agregar custom_transaction_type si está definido en el template
                if template.get("custom_transaction_type"):
                    template_data["custom_transaction_type"] = template["custom_transaction_type"]

                # Crear la plantilla
                endpoint = "/api/resource/Item Tax Template"
                create_response, create_err = make_erpnext_request(session, 'POST', endpoint, data={"data": template_data}, operation_name=f"Create Item Tax Template {template_name}")

                if create_err:
                    error_msg = f"Error creando plantilla '{template_name}': {create_err.get('status_code')} - {create_err.get('message')}"
                    print(error_msg)
                    errors.append(error_msg)
                else:
                    if create_response.status_code == 200:
                        created_data = create_response.json()
                        print(f"Plantilla '{template_name}' creada exitosamente")
                        created_templates.append({
                            "name": template_name,
                            "status": "created",
                            "data": created_data.get("data", {})
                        })
                    else:
                        error_msg = f"Error creando plantilla '{template_name}': {create_response.status_code} - {create_response.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as e:
                error_msg = f"Error procesando plantilla '{template_name}': {e}"
                print(error_msg)
                errors.append(error_msg)

        # Respuesta final
        if errors:
            return {
                "success": False,
                "message": f"Se encontraron errores al crear plantillas: {'; '.join(errors)}",
                "templates": created_templates,
                "errors": errors
            }
        else:
            return {
                "success": True,
                "message": "Plantillas de Item Tax Template procesadas correctamente",
                "templates": created_templates
            }

    except Exception as e:
        print(f"ERROR GENERAL en ensure_item_tax_templates_exist: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return {"success": False, "message": f"Error interno del servidor: {str(e)}"}
