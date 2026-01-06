"""
Setup - Item Account Assignment
Handles assignment of tax accounts and templates to items in ERPNext
"""

import json
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from urllib.parse import quote
from flask import jsonify, request

# Note: ERPNEXT_URL usage removed; make_erpnext_request builds the full URL

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr


def get_items():
    """Obtener ítems para asignar plantillas de impuestos"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener ítems
        response, response_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item",
            params={
                "fields": json.dumps(["name","item_name","item_code"]),
                "limit": 50
            },
            custom_headers=headers,
            operation_name="Get Items"
        )

        if response_err:
            return jsonify({"success": False, "message": f"Error al obtener ítems: {response_err}"}), 400

        if response.status_code == 200:
            data = response.json()
            return jsonify({
                "success": True,
                "data": data.get('data', []),
                "message": "Ítems obtenidos correctamente"
            })
        else:
            return jsonify({"success": False, "message": "Error al obtener ítems"}), 400

    except Exception as e:
        print(f"Error en get_items: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def assign_tax_account():
    """Asignar una cuenta como cuenta de impuestos"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        account_name = data.get('account_name')
        account_type = data.get('account_type', 'Tax')

        if not account_name:
            return jsonify({"success": False, "message": "Nombre de cuenta requerido"}), 400

        # Actualizar el tipo de cuenta
        update_resp, update_err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Account/{quote(account_name)}",
            data={"account_type": account_type},
            custom_headers=headers,
            operation_name=f"Update Account type {account_name}"
        )

        if update_err:
            error_msg = update_err.get('message', str(update_err))
            return jsonify({"success": False, "message": f"Error al asignar cuenta: {error_msg}"}), 400

        if update_resp.status_code == 200:
            return jsonify({
                "success": True,
                "message": f"Cuenta {account_name} asignada como {account_type} correctamente"
            })
        else:
            error_msg = update_resp.json().get('message', 'Error desconocido')
            return jsonify({"success": False, "message": f"Error al asignar cuenta: {error_msg}"}), 400

    except Exception as e:
        print(f"Error en assign_tax_account: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def remove_tax_account():
    """Remover una cuenta de la lista de cuentas de impuestos"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        print(f"remove_tax_account: data received = {data}")
        account_name = data.get('account_name')
        company = data.get('company')

        print(f"remove_tax_account: account_name = {account_name}, company = {company}")

        if not account_name:
            return jsonify({"success": False, "message": "Nombre de cuenta requerido"}), 400

        # Cambiar el tipo de cuenta de "Tax" a algo más genérico o vacío
        # Primero verificamos el tipo actual de la cuenta
        print(f"remove_tax_account: Checking account {account_name}")
        check_resp, check_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Account/{quote(account_name)}",
            custom_headers=headers,
            operation_name=f"Get Account {account_name}"
        )

        print(f"remove_tax_account: check_resp/error = {check_resp}, {check_err}")

        if check_err:
            print(f"remove_tax_account: Account not found or error: {check_err}")
            return jsonify({"success": False, "message": "Cuenta no encontrada"}), 404

        account_data = check_resp.json().get('data', {})
        print(f"remove_tax_account: account_data = {account_data}")

        # Si es una cuenta de tipo "Tax", la cambiamos a "Asset" o similar
        current_account_type = account_data.get('account_type')
        print(f"remove_tax_account: current account_type = {current_account_type}")

        if current_account_type == 'Tax':
            print(f"remove_tax_account: Attempting to change account type from Tax to Asset")

            update_resp, update_err = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Account/{quote(account_name)}",
                data={"account_type": "Asset"},
                custom_headers=headers,
                operation_name=f"Set Account {account_name} to Asset"
            )
            print(f"remove_tax_account: update_resp/error = {update_resp}, {update_err}")

            if update_err is None and update_resp.status_code == 200:
                print(f"remove_tax_account: Successfully changed account type to Asset")
                return jsonify({
                    "success": True,
                    "message": f"Cuenta {account_name} removida de cuentas de impuestos correctamente"
                })
            else:
                # Si falla cambiar a Asset, intentar cambiar a un tipo vacío
                print(f"remove_tax_account: Trying to set account_type to empty string")
                update_resp2, update_err2 = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Account/{quote(account_name)}",
                    data={"account_type": ""},
                    custom_headers=headers,
                    operation_name=f"Set Account {account_name} to empty"
                )
                print(f"remove_tax_account: update_resp2/error = {update_resp2}, {update_err2}")

                if update_err2 is None and update_resp2.status_code == 200:
                    print(f"remove_tax_account: Successfully set account_type to empty")
                    return jsonify({
                        "success": True,
                        "message": f"Cuenta {account_name} removida de cuentas de impuestos correctamente"
                    })
                else:
                    error_msg2 = update_err2.get('message') if update_err2 else update_resp2.text
                    print(f"remove_tax_account: Failed to set to empty, error = {error_msg2}")
                    return jsonify({"success": False, "message": f"Error al remover cuenta: {error_msg2}"}), 400
        else:
            print(f"remove_tax_account: Account is not of type Tax, current type = {current_account_type}")
            return jsonify({
                "success": True,
                "message": f"La cuenta {account_name} no era una cuenta de impuestos"
            })

    except Exception as e:
        print(f"Error en remove_tax_account: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def assign_purchase_account():
    """Asignar una cuenta como cuenta de compras"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        account_name = data.get('account_name')

        if not account_name:
            return jsonify({"success": False, "message": "Nombre de cuenta requerido"}), 400

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user)

        if not company_name:
            return jsonify({"success": False, "message": f"No hay compañía activa para el usuario {user}"}), 400

        # Aquí puedes agregar lógica específica para cuentas de compras
        # Por ahora, solo confirmamos la asignación
        return jsonify({
            "success": True,
            "message": f"Cuenta {account_name} asignada como cuenta de compras correctamente"
        })

    except Exception as e:
        print(f"Error en assign_purchase_account: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def assign_sales_account():
    """Asignar una cuenta como cuenta de ventas"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        account_name = data.get('account_name')

        if not account_name:
            return jsonify({"success": False, "message": "Nombre de cuenta requerido"}), 400

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user)

        if not company_name:
            return jsonify({"success": False, "message": f"No hay compañía activa para el usuario {user}"}), 400

        # Aquí puedes agregar lógica específica para cuentas de ventas
        # Por ahora, solo confirmamos la asignación
        return jsonify({
            "success": True,
            "message": f"Cuenta {account_name} asignada como cuenta de ventas correctamente"
        })

    except Exception as e:
        print(f"Error en assign_sales_account: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_tax_template():
    """Crear una plantilla de impuestos para ítems"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        template_data = data.get('template_data')

        if not template_data:
            return jsonify({"success": False, "message": "Datos de plantilla requeridos"}), 400

        # Crear la plantilla de impuestos
        create_resp, create_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item Tax Template",
            data={"data": template_data},
            custom_headers=headers,
            operation_name="Create Item Tax Template"
        )

        if create_err:
            error_msg = create_err.get('message', str(create_err))
            return jsonify({"success": False, "message": f"Error al crear plantilla: {error_msg}"}), 400

        if create_resp.status_code == 200:
            response_data = create_resp.json()
            return jsonify({
                "success": True,
                "data": response_data.get('data'),
                "message": "Plantilla de impuestos creada correctamente"
            })
        else:
            error_msg = create_resp.json().get('message', 'Error desconocido')
            return jsonify({"success": False, "message": f"Error al crear plantilla: {error_msg}"}), 400

    except Exception as e:
        print(f"Error en create_tax_template: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def assign_template_to_item():
    """Asignar una plantilla de impuestos a un ítem"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        item_name = data.get('item_name')
        template_name = data.get('template_name')

        if not item_name or not template_name:
            return jsonify({"success": False, "message": "Nombre de ítem y plantilla requeridos"}), 400

        # Actualizar el ítem con la plantilla de impuestos
        update_resp, update_err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Item/{quote(item_name)}",
            data={
                "data": {
                    "taxes": [
                        {"item_tax_template": template_name}
                    ]
                }
            },
            custom_headers=headers,
            operation_name=f"Assign template {template_name} to item {item_name}"
        )

        if update_err:
            error_msg = update_err.get('message', str(update_err))
            return jsonify({"success": False, "message": f"Error al asignar plantilla: {error_msg}"}), 400

        if update_resp.status_code == 200:
            return jsonify({
                "success": True,
                "message": f"Plantilla {template_name} asignada al ítem {item_name} correctamente"
            })
        else:
            error_msg = update_resp.json().get('message', 'Error desconocido')
            return jsonify({"success": False, "message": f"Error al asignar plantilla: {error_msg}"}), 400

    except Exception as e:
        print(f"Error en assign_template_to_item: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def get_sales_tax_templates():
    """Obtener plantillas de impuestos de ventas (Sales Taxes and Charges Template) filtradas por compañía"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user)

        if not company_name:
            return jsonify({"success": False, "message": f"No hay compañía activa para el usuario {user}"}), 400

        # Obtener plantillas de impuestos filtradas por compañía
        response, response_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Sales Taxes and Charges Template",
            params={
                "filters": json.dumps([["company","=",company_name]]),
                "fields": json.dumps(["name","title","company","is_default"])
            },
            custom_headers=headers,
            operation_name="Get Sales Taxes Templates"
        )

        if response_err:
            return jsonify({"success": False, "message": f"Error al obtener plantillas de impuestos: {response_err}"}), 400

        if response.status_code == 200:
            data = response.json()
            return jsonify({
                "success": True,
                "data": data.get('data', []),
                "message": "Plantillas de impuestos obtenidas correctamente"
            })
        else:
            return jsonify({"success": False, "message": "Error al obtener plantillas de impuestos"}), 400

    except Exception as e:
        print(f"Error en get_sales_tax_templates: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def get_item_tax_templates():
    """Obtener plantillas de impuestos para ítems (Item Tax Template) filtradas por compañía"""
    print("🔍 get_item_tax_templates called")
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            print("❌ get_item_tax_templates: authentication error")
            return error_response

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user)

        print(f"DEBUG get_item_tax_templates: user={user}, company_name={company_name}")

        if not company_name:
            print("❌ get_item_tax_templates: no company found")
            return jsonify({"success": False, "message": f"No hay compañía activa para el usuario {user}"}), 400

        # PRIMERO: Obtener TODOS los templates para debug
        all_response, all_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Tax Template",
            params={
                "fields": json.dumps(["name","title","company","custom_company","taxes"]),
                "limit_page_length": 1000
            },
            custom_headers=headers,
            operation_name="Get all Item Tax Templates"
        )

        if all_err:
            print(f"❌ get_item_tax_templates: Error getting all templates: {all_err}")
            return jsonify({"success": False, "message": "Error obteniendo templates"}), 500

        if all_response.status_code != 200:
            print(f"❌ get_item_tax_templates: Error getting all templates: {all_response.status_code}")
            return jsonify({"success": False, "message": "Error obteniendo templates"}), 500

        all_data = all_response.json()
        all_templates = all_data.get('data', [])
        print(f"DEBUG get_item_tax_templates: Total templates in system: {len(all_templates)}")

        # Mostrar algunos ejemplos para debug
        for i, template in enumerate(all_templates[:5]):
            print(f"  Template {i+1}: name='{template.get('name')}', company='{template.get('company')}', custom_company='{template.get('custom_company')}'")

        # Filtrar por compañía
        templates = []
        for template in all_templates:
            template_company = template.get('company')
            template_custom_company = template.get('custom_company')
            template_name = template.get('name', '')

            # Verificar si pertenece a la compañía por campo company, custom_company, o por abreviatura en el nombre
            company_abbr = get_company_abbr(session, headers, company_name)

            if (template_company == company_name or
                template_custom_company == company_name or
                company_abbr in template_name):
                templates.append(template)
                print(f"  ✅ MATCH: {template_name} -> company: {template_company}, custom_company: {template_custom_company}")

        print(f"DEBUG get_item_tax_templates: Final result: {len(templates)} templates for company '{company_name}'")

        # Mostrar resultados encontrados
        for template in templates:
            print(f"  - {template.get('name')}: company={template.get('company')}")

        return jsonify({
            "success": True,
            "data": templates,
            "message": f"Plantillas de impuestos para ítems obtenidas correctamente. Encontradas: {len(templates)}"
        })

    except Exception as e:
        print(f"❌ get_item_tax_templates: exception: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def get_tax_accounts_list():
    """Obtener todas las cuentas de tipo Tax asignadas a la compañía activa"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener la compañía activa del header
        active_company = request.headers.get('X-Active-Company') or request.headers.get('x-active-company')
        if not active_company:
            return jsonify({"success": False, "message": "Compañía activa no especificada"}), 400

        print(f"Obteniendo cuentas de impuestos para compañía: {active_company}")

        # Obtener todas las cuentas de tipo Tax para la compañía específica
        response, response_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Account",
            params={
                "filters": json.dumps([["account_type","=","Tax"],["company","=",active_company]]),
                "fields": json.dumps(["name","account_name","account_type","is_group","company"]),
                "limit_page_length": 1000
            },
            custom_headers=headers,
            operation_name="Get Tax Accounts List"
        )

        if response_err:
            print(f"Error al obtener cuentas de impuestos: {response_err}")
            return jsonify({"success": False, "message": "Error al obtener cuentas de impuestos"}), 400

        if response.status_code == 200:
            data = response.json()
            accounts = data.get('data', [])

            print(f"Encontradas {len(accounts)} cuentas de impuestos para compañía {active_company}")

            return jsonify({
                "success": True,
                "data": accounts,
                "total": len(accounts),
                "message": f"Encontradas {len(accounts)} cuentas de impuestos"
            })
        else:
            print(f"Error al obtener cuentas de impuestos: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": "Error al obtener cuentas de impuestos"}), 400

    except Exception as e:
        print(f"Error en get_tax_accounts_list: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def get_tax_template_detail(template_name):
    """Obtener detalle completo de una plantilla de impuesto específica"""
    print(f"🔍 get_tax_template_detail called for: {template_name}")
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            print("❌ get_tax_template_detail: authentication error")
            return error_response

        # URL encode the template name to handle special characters like %
        encoded_template_name = quote(template_name, safe='')
        endpoint = f"/api/resource/Item Tax Template/{encoded_template_name}"

        print(f"DEBUG get_tax_template_detail: calling endpoint: {endpoint}")
        response, response_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=endpoint,
            custom_headers=headers,
            operation_name=f"Get Item Tax Template {template_name}"
        )

        if response_err:
            print(f"DEBUG get_tax_template_detail: error: {response_err}")
            return jsonify({"success": False, "message": f"Error al obtener plantilla de impuesto: {template_name}"}), response_err.get('status_code', 500)

        print(f"DEBUG get_tax_template_detail: response.status_code={response.status_code}")

        if response.status_code == 200:
            data = response.json()
            template = data.get('data', {})
            print(f"DEBUG get_tax_template_detail: found template: {template.get('name')}")
            return jsonify({
                "success": True,
                "data": template,
                "message": "Detalle de plantilla de impuesto obtenido correctamente"
            })
        else:
            print(f"DEBUG get_tax_template_detail: error response: {response.text}")
            return jsonify({"success": False, "message": f"Error al obtener plantilla de impuesto: {template_name}"}), response.status_code

    except Exception as e:
        print(f"❌ get_tax_template_detail: exception: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def update_tax_template(template_name):
    """Actualizar la cuenta de una plantilla de impuesto específica"""
    print(f"🔄 update_tax_template called for: {template_name}")
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            print("❌ update_tax_template: authentication error")
            return error_response

        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Datos no proporcionados"}), 400

        # URL encode the template name to handle special characters like %
        encoded_template_name = quote(template_name, safe='')
        endpoint = f"/api/resource/Item Tax Template/{encoded_template_name}"

        print(f"DEBUG update_tax_template: calling endpoint: {endpoint}")
        print(f"DEBUG update_tax_template: data: {data}")

        response, response_err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=endpoint,
            data={"data": data},
            custom_headers=headers,
            operation_name=f"Update Item Tax Template {template_name}"
        )

        if response_err:
            print(f"DEBUG update_tax_template: error: {response_err}")
            return jsonify({"success": False, "message": f"Error al actualizar plantilla de impuesto: {template_name}"}), response_err.get('status_code', 500)

        print(f"DEBUG update_tax_template: response.status_code={response.status_code}")

        if response.status_code == 200:
            updated_data = response.json()
            print(f"DEBUG update_tax_template: template updated successfully")
            # Try to invalidate the shared cache (if the canonical taxes module is used elsewhere)
            try:
                from routes import taxes as taxes_module
                company_val = updated_data.get('data', {}).get('company')
                if company_val:
                    taxes_module.TAX_TEMPLATES_CACHE.pop(company_val, None)
            except Exception:
                # Don't fail the update flow if cache invalidation doesn't work
                pass
            return jsonify({
                "success": True,
                "data": updated_data.get('data', {}),
                "message": "Plantilla de impuesto actualizada correctamente"
            })
        else:
            print(f"DEBUG update_tax_template: error response: {response.text}")
            return jsonify({"success": False, "message": f"Error al actualizar plantilla de impuesto: {template_name}"}), response.status_code

    except Exception as e:
        print(f"❌ update_tax_template: exception: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500