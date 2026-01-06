"""
Setup - Custom Fields
Handles creation and verification of custom fields in ERPNext
"""

from urllib.parse import quote
import json
from flask import jsonify

# Importar configuración
# central HTTP utilities
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company


def create_company_custom_fields(session, headers):
    """Crea los campos custom necesarios para Company si no existen"""
    custom_fields = [
        {
            "dt": "Company",
            "label": "IVA Ventas por Defecto",
            "fieldname": "custom_default_iva_ventas",
            "fieldtype": "Data",
            "insert_after": "default_currency"
        },
        {
            "dt": "Company",
            "label": "IVA Compras por Defecto",
            "fieldname": "custom_default_iva_compras",
            "fieldtype": "Data",
            "insert_after": "custom_default_iva_ventas"
        },
        {
            "dt": "Company",
            "label": "Almacen por Defecto",
            "fieldname": "custom_default_warehouse",
            "fieldtype": "Link",
            "options": "Warehouse",
            "insert_after": "default_expense_account"
        }
    ]

    for field_data in custom_fields:
        try:
            fieldname = field_data['fieldname']
            dt = field_data['dt']

            # Verificar si el campo ya existe (usar params JSON para filters)
            filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
            check_resp, check_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Custom Field",
                params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                operation_name=f"Check Custom Field {fieldname} in {dt}"
            )

            if check_err:
                print(f"Error verificando campo custom '{fieldname}': {check_err}")
                # Continuar con el siguiente campo en caso de error de verificación
                continue

            if check_resp.status_code == 200:
                check_data = check_resp.json()
                if check_data.get('data'):
                    print(f"Campo custom '{fieldname}' ya existe")
                    continue

            print(f"Creando campo custom '{fieldname}' para Company...")

            create_resp, create_err = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom Field",
                data=field_data,
                custom_headers=headers,
                operation_name=f"Create Custom Field {fieldname} in {dt}"
            )

            if create_err:
                # 409 conflicts are handled inside helper as error_response with status_code
                if create_err.get('status_code') == 409:
                    print(f"Campo custom '{fieldname}' ya existe (ignorando)")
                else:
                    print(f"Advertencia al crear campo '{fieldname}': {create_err}")
                # No fallar por campos que ya existen
            else:
                if create_resp.status_code in [200, 201]:
                    print(f"Campo custom '{fieldname}' creado exitosamente")

                    # If we just created the company-level custom_default_warehouse field,
                    # attempt to auto-assign a default warehouse for the active company
                    try:
                        if fieldname == 'custom_default_warehouse':
                            # Resolve active company for the current session
                            s2, h2, user_id, err_resp = get_session_with_auth()
                            if not err_resp and user_id:
                                company_name = get_active_company(user_id)
                                if company_name:
                                    # Check if company already has a value
                                    comp_resp, comp_err = make_erpnext_request(
                                        session=session,
                                        method="GET",
                                        endpoint=f"/api/resource/Company/{quote(company_name)}",
                                        params={"fields": json.dumps(["custom_default_warehouse"])},
                                        operation_name=f"Check company {company_name} custom_default_warehouse"
                                    )
                                    if comp_resp and comp_resp.status_code == 200:
                                        current_val = comp_resp.json().get('data', {}).get('custom_default_warehouse')
                                        if not current_val:
                                            # Find any non-group warehouse for the company
                                            wh_resp, wh_err = make_erpnext_request(
                                                session=session,
                                                method="GET",
                                                endpoint="/api/resource/Warehouse",
                                                params={
                                                    'filters': json.dumps([["company","=",company_name],["is_group","=",0]]),
                                                    'fields': json.dumps(["name"]),
                                                    'limit_page_length': 1
                                                },
                                                operation_name=f"Find candidate default warehouse for {company_name}"
                                            )
                                            if wh_resp and wh_resp.status_code == 200:
                                                wh_list = wh_resp.json().get('data', [])
                                                if wh_list:
                                                    chosen_wh = wh_list[0].get('name')
                                                    upd_resp, upd_err = make_erpnext_request(
                                                        session=session,
                                                        method="PUT",
                                                        endpoint=f"/api/resource/Company/{quote(company_name)}",
                                                        data={"data": {"custom_default_warehouse": chosen_wh}},
                                                        operation_name=f"Assign default warehouse {chosen_wh} to {company_name}"
                                                    )
                                                    if upd_resp and upd_resp.status_code in (200, 201):
                                                        print(f"Auto-asignado warehouse '{chosen_wh}' a {company_name}.custom_default_warehouse")
                    except Exception as e:
                        print(f"Advertencia: no se pudo auto-asignar custom_default_warehouse: {e}")
                else:
                    print(f"Advertencia al crear campo '{fieldname}': {create_resp.text}")

        except Exception as e:
            print(f"Error al crear campo custom '{field_data['fieldname']}': {e}")
            # Continuar con el siguiente campo
            continue

    return True


def create_iva_custom_fields():
    """Crear los campos custom para IVA por defecto en ventas y compras"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("Creando campos custom para IVA por defecto...")

        # Definir los campos custom a crear
        custom_fields = [
            {
                "dt": "Company",
                "label": "IVA por Defecto - Ventas",
                "fieldname": "custom_default_iva_ventas",
                "fieldtype": "Data",
                "insert_after": "company_name"
            },
            {
                "dt": "Company",
                "label": "IVA por Defecto - Compras",
                "fieldname": "custom_default_iva_compras",
                "fieldtype": "Data",
                "insert_after": "custom_default_iva_ventas"
            },
            {
                "dt": "Company",
                "label": "Almacen por Defecto",
                "fieldname": "custom_default_warehouse",
                "fieldtype": "Link",
                "options": "Warehouse",
                "insert_after": "default_expense_account"
            },
            {
                "dt": "Company",
                "label": "Ingresos Brutos", 
                "fieldname": "custom_ingresos_brutos",
                "fieldtype": "Data",
                "insert_after": "tax_id"
            },
            {
                "dt": "Company",
                "label": "Convenio Multilateral",
                "fieldname": "custom_convenio_multilateral", 
                "fieldtype": "Check",
                "insert_after": "custom_ingresos_brutos"
            },
            {
                "dt": "Customer",
                "label": "IVA por Defecto - Ventas",
                "fieldname": "custom_default_iva_ventas",
                "fieldtype": "Data",
                "insert_after": "customer_name"
            },
            {
                "dt": "Customer",
                "label": "Cuenta de Ingresos por Defecto",
                "fieldname": "custom_cuenta_de_ingresos_por_defecto",
                "fieldtype": "Link",
                "options": "Account",
                "insert_after": "customer_group"
            },
            {
                "dt": "Supplier",
                "label": "IVA por Defecto - Compras",
                "fieldname": "custom_default_iva_compras",
                "fieldtype": "Data",
                "insert_after": "supplier_name"
            },
            {
                "dt": "Supplier",
                "label": "Condición IVA",
                "fieldname": "custom_condicion_iva",
                "fieldtype": "Select",
                "options": "Responsable Inscripto\nMonotributista\nExento\nConsumidor Final",
                "insert_after": "supplier_group"
            },
            {
                "dt": "Supplier",
                "label": "Personería",
                "fieldname": "custom_personeria",
                "fieldtype": "Data",
                "insert_after": "tax_id"
            },
            {
                "dt": "Supplier",
                "label": "País",
                "fieldname": "custom_pais",
                "fieldtype": "Data",
                "insert_after": "custom_personeria"
            },
            {
                "dt": "Supplier",
                "label": "Lista de Precios por Defecto",
                "fieldname": "custom_default_price_list",
                "fieldtype": "Link",
                "options": "Price List",
                "insert_after": "custom_condicion_iva"
            }
        ]

        created_fields = []
        errors = []

        for field_data in custom_fields:
            try:
                fieldname = field_data['fieldname']
                dt = field_data['dt']

                # Verificar si el campo ya existe (usar params JSON para filters)
                filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Custom Field",
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {fieldname} in {dt}"
                )

                if check_err:
                    error_msg = f"Error verificando campo custom '{fieldname}' en '{dt}': {check_err}"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                if check_resp.status_code == 200:
                    check_data = check_resp.json()
                    if check_data.get('data'):
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}', saltando creación.")
                        continue

                print(f"Creando campo custom '{fieldname}' en '{dt}'...")

                # Intentar crear el campo custom
                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Custom%20Field",
                    data=field_data,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {fieldname} in {dt}"
                )

                if create_err:
                    if create_err.get('status_code') == 409:
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}' (ignorando)")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_err}"
                        print(error_msg)
                        errors.append(error_msg)
                else:
                    if create_resp.status_code in [200, 201]:
                        print(f"Campo custom '{fieldname}' creado exitosamente en '{dt}'")
                        created_fields.append(fieldname)

                        # If this is the company-level default warehouse field, try to auto-assign
                        try:
                            if fieldname == 'custom_default_warehouse':
                                # We already have user from get_session_with_auth at top
                                if user:
                                    from routes.general import get_active_company
                                    company_name = get_active_company(user)
                                    if company_name:
                                        # If company field empty, find a candidate warehouse and assign it
                                        comp_resp, comp_err = make_erpnext_request(
                                            session=session,
                                            method="GET",
                                            endpoint=f"/api/resource/Company/{quote(company_name)}",
                                            params={"fields": json.dumps(["custom_default_warehouse"])},
                                            operation_name=f"Check company {company_name} custom_default_warehouse"
                                        )
                                        if comp_resp and comp_resp.status_code == 200:
                                            current_val = comp_resp.json().get('data', {}).get('custom_default_warehouse')
                                            if not current_val:
                                                wh_resp, wh_err = make_erpnext_request(
                                                    session=session,
                                                    method="GET",
                                                    endpoint="/api/resource/Warehouse",
                                                    params={
                                                        'filters': json.dumps([["company","=",company_name],["is_group","=",0]]),
                                                        'fields': json.dumps(["name"]),
                                                        'limit_page_length': 1
                                                    },
                                                    operation_name=f"Find candidate default warehouse for {company_name}"
                                                )
                                                if wh_resp and wh_resp.status_code == 200:
                                                    wh_list = wh_resp.json().get('data', [])
                                                    if wh_list:
                                                        chosen_wh = wh_list[0].get('name')
                                                        upd_resp, upd_err = make_erpnext_request(
                                                            session=session,
                                                            method="PUT",
                                                            endpoint=f"/api/resource/Company/{quote(company_name)}",
                                                            data={"data": {"custom_default_warehouse": chosen_wh}},
                                                            operation_name=f"Assign default warehouse {chosen_wh} to {company_name}"
                                                        )
                                                        if upd_resp and upd_resp.status_code in (200, 201):
                                                            print(f"Auto-asignado warehouse '{chosen_wh}' a {company_name}.custom_default_warehouse")
                        except Exception as e:
                            print(f"Advertencia: no se pudo auto-asignar custom_default_warehouse (iva fields): {e}")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_resp.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as field_error:
                error_msg = f"Error al crear campo '{field_data['fieldname']}': {str(field_error)}"
                print(error_msg)
                errors.append(error_msg)

        # Respuesta final
        if created_fields or (not created_fields and not errors):
            doctypes = set()
            for field in created_fields:
                if 'company' in field.lower():
                    doctypes.add('Company')
                elif 'customer' in field.lower():
                    doctypes.add('Customer')
                elif 'supplier' in field.lower():
                    doctypes.add('Supplier')

            if created_fields:
                doctype_str = ', '.join(sorted(doctypes))
                message = f"Campos custom IVA creados en {doctype_str}: {', '.join(created_fields)}"
                if errors:
                    message += f". Errores: {'; '.join(errors)}"
            else:
                message = "Todos los campos custom IVA ya existen"

            return jsonify({
                "success": True,
                "message": message,
                "created_fields": created_fields,
                "errors": errors
            })
        else:
            return jsonify({
                "success": False,
                "message": "No se pudo crear ningún campo custom",
                "errors": errors
            }), 400

    except Exception as e:
        print(f"Error en create_iva_custom_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_item_tax_template_custom_fields():
    """
    Crear el campo custom para identificar si un Item Tax Template es de Ventas o Compras.
    
    Este campo elimina la necesidad de usar heurísticas basadas en nombres para
    clasificar los templates. Debe ejecutarse ANTES de crear los Item Tax Templates.
    """
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("Creando campo custom para Item Tax Template (custom_transaction_type)...")

        fieldname = "custom_transaction_type"
        dt = "Item Tax Template"

        # Verificar si el campo ya existe
        filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
        check_resp, check_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Custom Field",
            params={"filters": json.dumps(filters_list), "limit_page_length": 1},
            operation_name=f"Check Custom Field {fieldname} in {dt}"
        )

        if check_err:
            error_msg = f"Error verificando campo custom '{fieldname}' en '{dt}': {check_err}"
            print(error_msg)
            return jsonify({"success": False, "message": error_msg}), 500

        if check_resp.status_code == 200:
            check_data = check_resp.json()
            if check_data.get('data'):
                print(f"Campo custom '{fieldname}' ya existe en '{dt}', saltando creación.")
                return jsonify({
                    "success": True,
                    "message": f"Campo '{fieldname}' ya existe en '{dt}'"
                })

        # Crear el campo custom
        # Usamos Select con opciones "Ventas" y "Compras" para ser explícito
        field_data = {
            "dt": dt,
            "label": "Tipo de Transacción",
            "fieldname": fieldname,
            "fieldtype": "Select",
            "options": "Ventas\nCompras",
            "insert_after": "title",
            "description": "Indica si este template es para ventas (IVA Débito) o compras (IVA Crédito)"
        }

        create_resp, create_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Custom%20Field",
            data=field_data,
            custom_headers=headers,
            operation_name=f"Create Custom Field {fieldname} in {dt}"
        )

        if create_err:
            if create_err.get('status_code') == 409:
                print(f"Campo custom '{fieldname}' ya existe en '{dt}' (ignorando)")
                return jsonify({
                    "success": True,
                    "message": f"Campo '{fieldname}' ya existe en '{dt}'"
                })
            else:
                error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_err}"
                print(error_msg)
                return jsonify({"success": False, "message": error_msg}), 500

        if create_resp.status_code in [200, 201]:
            print(f"Campo custom '{fieldname}' creado exitosamente en '{dt}'")
            return jsonify({
                "success": True,
                "message": f"Campo '{fieldname}' creado exitosamente en '{dt}'",
                "created": [fieldname]
            })
        else:
            error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_resp.text}"
            print(error_msg)
            return jsonify({"success": False, "message": error_msg}), 500

    except Exception as e:
        print(f"Error en create_item_tax_template_custom_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_reconciliation_custom_fields():
    """Crear los campos custom necesarios para agrupar documentos por conciliación manual."""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        fieldname = "custom_conciliation_id"
        print("Creando campos custom de conciliación (conciliation_id) para facturas y pagos...")

        custom_fields = [
            {
                "dt": "Sales Invoice",
                "label": "Conciliation ID",
                "fieldname": fieldname,
                "fieldtype": "Data",
                "insert_after": "customer_name",
                "allow_on_submit": 1,
                "description": "Identificador de agrupación manual para conciliar facturas y pagos."
            },
            {
                "dt": "Purchase Invoice",
                "label": "Conciliation ID",
                "fieldname": fieldname,
                "fieldtype": "Data",
                "insert_after": "supplier_name",
                "allow_on_submit": 1,
                "description": "Identificador de agrupación manual para conciliar facturas y notas de crédito."
            },
            {
                "dt": "Payment Entry",
                "label": "Conciliation ID",
                "fieldname": fieldname,
                "fieldtype": "Data",
                "insert_after": "party_name",
                "allow_on_submit": 1,
                "description": "Identificador de agrupación manual que vincula pagos con facturas."
            }
        ]

        created_fields = []
        errors = []

        for field in custom_fields:
            try:
                filters_list = [["fieldname", "=", field["fieldname"]], ["dt", "=", field["dt"]]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Custom Field",
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {field['fieldname']} in {field['dt']}"
                )

                if check_err:
                    errors.append(f"No se pudo verificar {field['fieldname']} en {field['dt']}: {check_err}")
                    continue

                if check_resp.status_code == 200 and check_resp.json().get("data"):
                    print(f"Campo custom '{field['fieldname']}' ya existe en {field['dt']}, omitiendo.")
                    continue

                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Custom Field",
                    data=field,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {field['fieldname']} in {field['dt']}"
                )

                if create_err:
                    if create_err.get("status_code") == 409:
                        print(f"Campo custom '{field['fieldname']}' ya existe en {field['dt']} (ignorando).")
                    else:
                        errors.append(f"Error al crear {field['fieldname']} en {field['dt']}: {create_err}")
                elif create_resp.status_code in (200, 201):
                    created_fields.append(f"{field['dt']}.{field['fieldname']}")
                    print(f"Campo custom '{field['fieldname']}' creado en {field['dt']}.")
                else:
                    errors.append(f"No se pudo crear {field['fieldname']} en {field['dt']}: {create_resp.text}")
            except Exception as field_error:
                errors.append(f"Error procesando campo en {field['dt']}: {field_error}")

        if created_fields:
            message = f"Campos de conciliación creados: {', '.join(created_fields)}"
            if errors:
                message += f". Errores: {'; '.join(errors)}"
            return jsonify({"success": True, "message": message, "created_fields": created_fields, "errors": errors})

        if errors:
            return jsonify({"success": False, "message": "No se pudieron crear los campos de conciliación", "errors": errors}), 400

        return jsonify({
            "success": True,
            "message": "Los campos de conciliación ya existían previamente."
        })

    except Exception as e:
        print(f"Error en create_reconciliation_custom_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_item_custom_fields():
    """Crear los campos custom necesarios para Item (descripción y enlaces)"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("Creando campos custom para Item...")

        # Definir los campos custom a crear
        custom_fields = [
            {
                "dt": "Item",
                "label": "Tipo de Descripción",
                "fieldname": "custom_description_type",
                "fieldtype": "Select",
                "options": "Plain Text\nHTML",
                "default": "Plain Text",
                "insert_after": "description"
            },
            {
                "dt": "Item",
                "label": "Enlaces del Producto",
                "fieldname": "custom_product_links",
                "fieldtype": "JSON",
                "insert_after": "custom_description_type"
            }
        ]

        created_fields = []
        errors = []

        for field_data in custom_fields:
            try:
                fieldname = field_data['fieldname']
                dt = field_data['dt']

                filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Custom Field",
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {fieldname} in {dt}"
                )

                if check_err:
                    error_msg = f"Error verificando campo custom '{fieldname}' en '{dt}': {check_err}"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                if check_resp.status_code == 200:
                    check_data = check_resp.json()
                    if check_data.get('data'):
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}', saltando creación.")
                        continue

                print(f"Creando campo custom '{fieldname}' en '{dt}'...")

                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Custom%20Field",
                    data=field_data,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {fieldname} in {dt}"
                )

                if create_err:
                    if create_err.get('status_code') == 409:
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}' (ignorando)")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_err}"
                        print(error_msg)
                        errors.append(error_msg)
                else:
                    if create_resp.status_code in [200, 201]:
                        print(f"Campo custom '{fieldname}' creado exitosamente en '{dt}'")
                        created_fields.append(fieldname)
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_resp.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as field_error:
                error_msg = f"Error al crear campo '{field_data['fieldname']}': {str(field_error)}"
                print(error_msg)
                errors.append(error_msg)

        # Respuesta final
        if created_fields or (not created_fields and not errors):
            if created_fields:
                message = f"Campos custom de Item creados: {', '.join(created_fields)}"
                if errors:
                    message += f". Errores: {'; '.join(errors)}"
            else:
                message = "Todos los campos custom de Item ya existen"

            return jsonify({
                "success": True,
                "message": message,
                "created": created_fields,
                "errors": errors
            })
        else:
            return jsonify({
                "success": False,
                "message": "No se pudo crear ningún campo custom de Item",
                "errors": errors
            }), 400

    except Exception as e:
        print(f"Error en create_item_custom_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_company_filter_fields():
    """Crear los campos custom para filtrar por compañía en doctypes principales"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("Creando campos custom para filtrado por compañía...")

        # Definir los campos custom a crear
        custom_fields = [
            {
                "dt": "Supplier",
                "label": "Compañía",
                "fieldname": "custom_company",
                "fieldtype": "Link",
                "options": "Company",
                "insert_after": "supplier_name"
            },
            {
                "dt": "Customer",
                "label": "Compañía",
                "fieldname": "custom_company",
                "fieldtype": "Link",
                "options": "Company",
                "insert_after": "customer_name"
            },
            {
                "dt": "Item",
                "label": "Compañía",
                "fieldname": "custom_company",
                "fieldtype": "Link",
                "options": "Company",
                "insert_after": "item_name"
            },
            {
                "dt": "Item Group",
                "label": "Compañía",
                "fieldname": "custom_company",
                "fieldtype": "Link",
                "options": "Company",
                "insert_after": "item_group_name"
            },
            {
                "dt": "Price List",
                "label": "Compania",
                "fieldname": "custom_company",
                "fieldtype": "Link",
                "options": "Company",
                "insert_after": "price_list_name"
            },
            {
                "dt": "Subscription Plan",
                "label": "Compañía",
                "fieldname": "custom_company",
                "fieldtype": "Link",
                "options": "Company",
                "insert_after": "currency"
            },
            {
                "dt": "Item Price",
                "label": "Compania",
                "fieldname": "custom_company",
                "fieldtype": "Link",
                "options": "Company",
                "insert_after": "price_list"
            },
            {
                "dt": "Product Bundle",
                "label": "Compañía",
                "fieldname": "custom_company",
                "fieldtype": "Link",
                "options": "Company",
                "insert_after": "new_item_code"
            }
        ]

        created_fields = []
        errors = []

        for field_data in custom_fields:
            try:
                fieldname = field_data['fieldname']
                dt = field_data['dt']

                filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Custom Field",
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {fieldname} in {dt}"
                )

                if check_err:
                    error_msg = f"Error verificando campo custom '{fieldname}' en {dt}: {check_err}"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                if check_resp.status_code == 200:
                    check_data = check_resp.json()
                    if check_data.get('data'):
                        print(f"Campo custom '{fieldname}' ya existe en {dt}")
                        continue

                print(f"Creando campo custom '{fieldname}' para {dt}...")

                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Custom%20Field",
                    data=field_data,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {fieldname} in {dt}"
                )

                if create_err:
                    if create_err.get('status_code') == 409:
                        print(f"Campo custom '{fieldname}' ya existe en {dt} (ignorando)")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en {dt}: {create_err}"
                        print(error_msg)
                        errors.append(error_msg)
                else:
                    if create_resp.status_code in [200, 201]:
                        print(f"Campo custom '{fieldname}' creado exitosamente en {dt}")
                        created_fields.append(f"{dt}.{fieldname}")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en {dt}: {create_resp.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as field_error:
                error_msg = f"Error procesando campo '{field_data['fieldname']}' en {field_data['dt']}: {str(field_error)}"
                print(error_msg)
                errors.append(error_msg)

        # Respuesta final
        if created_fields:
            doctypes = set()
            for field in created_fields:
                doctype = field.split('.')[0]
                doctypes.add(doctype)

            doctype_str = ', '.join(sorted(doctypes))
            message = f"Campos custom de compañía creados en {doctype_str}: {', '.join(created_fields)}"
            if errors:
                message += f". Errores: {'; '.join(errors)}"
            return jsonify({
                "success": True,
                "message": message,
                "created_fields": created_fields,
                "errors": errors
            })
        else:
            return jsonify({
                "success": False,
                "message": "No se pudo crear ningún campo custom de compañía",
                "errors": errors
            }), 400


    except Exception as e:
        print(f"Error en create_company_filter_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_price_list_custom_fields():
    """Crear los campos custom necesarios para Price List (exchange rate)"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("Creando campos custom para Price List...")

        # Definir los campos custom a crear
        custom_fields = [
            {
                "dt": "Price List",
                "label": "Cotización (Exchange Rate)",
                "fieldname": "custom_exchange_rate",
                "fieldtype": "Float",
                "precision": 4,
                "insert_after": "currency"
            }
        ]

        # Añadimos campos para actualización automática de listas de precios
        # - auto_update_enabled: Check (Actualización automática)
        # - auto_update_formula: Code (Fórmula de actualización)
        custom_fields.extend([
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
        ])

        created_fields = []
        errors = []

        for field_data in custom_fields:
            try:
                fieldname = field_data['fieldname']
                dt = field_data['dt']

                filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Custom Field",
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {fieldname} in {dt}"
                )

                if check_err:
                    error_msg = f"Error verificando campo custom '{fieldname}' en '{dt}': {check_err}"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                if check_resp.status_code == 200:
                    check_data = check_resp.json()
                    if check_data.get('data'):
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}', saltando creación.")
                        continue

                print(f"Creando campo custom '{fieldname}' en '{dt}'...")

                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Custom%20Field",
                    data=field_data,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {fieldname} in {dt}"
                )

                if create_err:
                    if create_err.get('status_code') == 409:
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}' (ignorando)")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_err}"
                        print(error_msg)
                        errors.append(error_msg)
                else:
                    if create_resp.status_code in [200, 201]:
                        print(f"Campo custom '{fieldname}' creado exitosamente en '{dt}'")
                        created_fields.append(fieldname)
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_resp.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as field_error:
                error_msg = f"Error al crear campo '{field_data['fieldname']}': {str(field_error)}"
                print(error_msg)
                errors.append(error_msg)

        # Respuesta final
        if created_fields or (not created_fields and not errors):
            if created_fields:
                message = f"Campos custom de Price List creados: {', '.join(created_fields)}"
                if errors:
                    message += f". Errores: {'; '.join(errors)}"
            else:
                message = "Todos los campos custom de Price List ya existen"

            return jsonify({
                "success": True,
                "message": message,
                "created_fields": created_fields,
                "errors": errors
            })
        else:
            return jsonify({
                "success": False,
                "message": "No se pudo crear ningún campo custom de Price List",
                "errors": errors
            }), 400

    except Exception as e:
        print(f"Error en create_price_list_custom_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_integration_settings_field():
    """Crear campo custom para almacenar integraciones en Company"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        fieldname = "custom_integration_settings"
        dt = "Company"
        print("Creando campo custom para integraciones por compania...")

        filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
        check_resp, check_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Custom Field",
            params={"filters": json.dumps(filters_list), "limit_page_length": 1},
            operation_name=f"Check Custom Field {fieldname} in {dt}"
        )

        if check_err:
            error_msg = f"Error verificando campo custom '{fieldname}': {check_err}"
            print(error_msg)
            return jsonify({"success": False, "message": error_msg}), 400

        if check_resp.status_code == 200:
            check_data = check_resp.json()
            if check_data.get('data'):
                print("Campo custom de integraciones ya existe")
                return jsonify({"success": True, "message": "Campo custom de integraciones ya existe"})

        field_data = {
            "dt": dt,
            "label": "Integraciones ERP",
            "fieldname": fieldname,
            "fieldtype": "Long Text",
            "insert_after": "abbr",
            "description": "JSON con las credenciales y configuraciones de integraciones"
        }

        create_resp, create_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Custom Field",
            data=field_data,
            custom_headers=headers,
            operation_name="Create integration settings custom field"
        )

        if create_err:
            print(f"Error creando campo custom de integraciones: {create_err}")
            return handle_erpnext_error(create_err, "No se pudo crear el campo de integraciones")

        if create_resp.status_code in (200, 201):
            print("Campo custom de integraciones creado")
            return jsonify({"success": True, "message": "Campo custom de integraciones creado"})

        print(f"ERPNext no confirmo la creacion del campo de integraciones: {create_resp.text}")
        return jsonify({"success": False, "message": "No se pudo crear el campo de integraciones"}), create_resp.status_code

    except Exception as e:
        print(f"Error en create_integration_settings_field: {e}")
        import traceback
        print(traceback.format_exc())
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_purchase_receipt_status_field():
    """Crear campos custom necesarios en Purchase Receipt"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        custom_fields = [
            {
                "dt": "Purchase Receipt",
                "allow_on_submit": 1,
                "fieldname": "custom_estado_remito",
                "label": "Estado del Remito",
                "fieldtype": "Select",
                "insert_after": "supplier",
                "options": "Recibido pendiente de factura\nFacturado parcialmente\nFacturado completamente\nAnulado",
                "default": "Recibido pendiente de factura",
                "reqd": 0,
                "hidden": 0,
                "in_list_view": 1
            },
            {
                "dt": "Purchase Receipt",
                "allow_on_submit": 1,
                "fieldname": "custom_auto_generado_desde_factura",
                "label": "Auto-generado desde Factura",
                "fieldtype": "Check",
                "insert_after": "custom_estado_remito",
                "default": "0",
                "reqd": 0,
                "hidden": 1,
                "read_only": 1
            }
        ]

        created_fields = []
        errors = []

        for field_data in custom_fields:
            fieldname = field_data["fieldname"]
            dt = field_data["dt"]

            filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
            check_resp, check_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Custom Field",
                params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                operation_name=f"Check Custom Field {fieldname} in {dt}"
            )

            if check_err:
                error_msg = f"Error verificando campo custom '{fieldname}' en '{dt}': {check_err}"
                print(error_msg)
                errors.append(error_msg)
                continue

            if check_resp.status_code == 200 and check_resp.json().get("data"):
                print(f"Campo custom '{fieldname}' ya existe en '{dt}'")
                continue

            print(f"Creando campo custom '{fieldname}' para '{dt}'...")
            create_resp, create_err = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom%20Field",
                data=field_data,
                custom_headers=headers,
                operation_name=f"Create Custom Field {fieldname} in {dt}"
            )

            if create_err:
                print(f"Error creando campo custom '{fieldname}': {create_err}")
                errors.append(f"{fieldname}: {create_err}")
                continue

            if create_resp.status_code in (200, 201):
                print(f"Campo custom '{fieldname}' creado exitosamente en '{dt}'")
                created_fields.append(fieldname)
            else:
                error_msg = f"ERPNext no confirmo la creacion del campo '{fieldname}': {create_resp.text}"
                print(error_msg)
                errors.append(error_msg)

        if created_fields or (not created_fields and not errors):
            message = "Campos custom de Purchase Receipt procesados."
            if created_fields:
                message = f"Campos custom de Purchase Receipt creados: {', '.join(created_fields)}"
            if errors:
                message += f" Errores: {'; '.join(errors)}"
            return jsonify({"success": True, "message": message, "created_fields": created_fields, "errors": errors})

        return jsonify({"success": False, "message": "No se pudieron crear campos custom de Purchase Receipt", "errors": errors}), 400

    except Exception as e:
        print(f"Error en create_purchase_receipt_status_field: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_purchase_taxes_perception_fields():
    """
    Crear los campos custom necesarios en Purchase Taxes and Charges para percepciones.
    
    Estos campos permiten identificar y filtrar las filas de impuestos que corresponden
    a percepciones de compra (IIBB, IVA, Ganancias) en las facturas de compra.
    """
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("Creando campos custom para Purchase Taxes and Charges (percepciones)...")

        # Campos custom para identificar percepciones en la tabla de impuestos
        custom_fields = [
            {
                "dt": "Purchase Taxes and Charges",
                "label": "Es Percepción",
                "fieldname": "custom_is_perception",
                "fieldtype": "Check",
                "default": "0",
                "insert_after": "description",
                "description": "Indica si esta fila es una percepción de compra"
            },
            {
                "dt": "Purchase Taxes and Charges",
                "label": "Tipo de Percepción",
                "fieldname": "custom_perception_type",
                "fieldtype": "Select",
                "options": "\nINGRESOS_BRUTOS\nIVA\nGANANCIAS",
                "insert_after": "custom_is_perception",
                "description": "Tipo de percepción: IIBB, IVA o Ganancias"
            },
            {
                "dt": "Purchase Taxes and Charges",
                "label": "Código de Provincia",
                "fieldname": "custom_province_code",
                "fieldtype": "Data",
                "insert_after": "custom_perception_type",
                "description": "Código de jurisdicción AFIP (901-924) solo para IIBB"
            },
            {
                "dt": "Purchase Taxes and Charges",
                "label": "Nombre de Provincia",
                "fieldname": "custom_province_name",
                "fieldtype": "Data",
                "insert_after": "custom_province_code",
                "description": "Nombre legible de la provincia"
            },
            {
                "dt": "Purchase Taxes and Charges",
                "label": "Código de Régimen",
                "fieldname": "custom_regimen_code",
                "fieldtype": "Data",
                "insert_after": "custom_province_name",
                "description": "Código de régimen de percepción (ej: RG2126)"
            },
            {
                "dt": "Purchase Taxes and Charges",
                "label": "Porcentaje de Percepción",
                "fieldname": "custom_percentage",
                "fieldtype": "Float",
                "precision": 2,
                "insert_after": "custom_regimen_code",
                "description": "Porcentaje aplicado a la base imponible"
            }
        ]

        created_fields = []
        errors = []

        for field_data in custom_fields:
            try:
                fieldname = field_data['fieldname']
                dt = field_data['dt']

                # Verificar si el campo ya existe
                filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Custom Field",
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {fieldname} in {dt}"
                )

                if check_err:
                    error_msg = f"Error verificando campo custom '{fieldname}' en '{dt}': {check_err}"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                if check_resp.status_code == 200:
                    check_data = check_resp.json()
                    if check_data.get('data'):
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}', saltando creación.")
                        continue

                print(f"Creando campo custom '{fieldname}' para '{dt}'...")

                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Custom%20Field",
                    data=field_data,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {fieldname} in {dt}"
                )

                if create_err:
                    if create_err.get('status_code') == 409:
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}' (ignorando)")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_err}"
                        print(error_msg)
                        errors.append(error_msg)
                else:
                    if create_resp.status_code in [200, 201]:
                        print(f"Campo custom '{fieldname}' creado exitosamente en '{dt}'")
                        created_fields.append(f"{dt}.{fieldname}")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_resp.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as field_error:
                error_msg = f"Error procesando campo '{field_data['fieldname']}' en {field_data['dt']}: {str(field_error)}"
                print(error_msg)
                errors.append(error_msg)

        # Respuesta final
        if created_fields or (not created_fields and not errors):
            if created_fields:
                message = f"Campos custom de percepciones creados: {', '.join(created_fields)}"
                if errors:
                    message += f". Errores: {'; '.join(errors)}"
            else:
                message = "Todos los campos custom de percepciones ya existen"

            return jsonify({
                "success": True,
                "message": message,
                "created_fields": created_fields,
                "errors": errors
            })
        else:
            return jsonify({
                "success": False,
                "message": "No se pudo crear ningún campo custom de percepciones",
                "errors": errors
            }), 400

    except Exception as e:
        print(f"Error en create_purchase_taxes_perception_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_payment_entry_deduction_withholding_fields():
    """
    Crear campos custom en Payment Entry Deduction para retenciones de venta.
    
    Estos campos permiten identificar y guardar metadatos de retenciones SUFRIDAS
    en cobros de clientes (IIBB, IVA, Ganancias, SUSS).
    """
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("Creando campos custom para Payment Entry Deduction (retenciones)...")

        # Campos custom para identificar retenciones en la tabla de deducciones
        custom_fields = [
            {
                "dt": "Payment Entry Deduction",
                "label": "Es Retención",
                "fieldname": "custom_is_withholding",
                "fieldtype": "Check",
                "default": "0",
                "insert_after": "description",
                "description": "Indica si esta fila es una retención sufrida"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Tipo de Impuesto",
                "fieldname": "custom_tax_type",
                "fieldtype": "Select",
                "options": "\nINGRESOS_BRUTOS\nIVA\nGANANCIAS\nSUSS",
                "insert_after": "custom_is_withholding",
                "description": "Tipo de retención: IIBB, IVA, Ganancias o SUSS"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Código de Provincia",
                "fieldname": "custom_province_code",
                "fieldtype": "Data",
                "insert_after": "custom_tax_type",
                "description": "Código de jurisdicción AFIP (901-924) solo para IIBB"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Nombre de Provincia",
                "fieldname": "custom_province_name",
                "fieldtype": "Data",
                "insert_after": "custom_province_code",
                "description": "Nombre legible de la provincia"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Código AFIP",
                "fieldname": "custom_afip_code",
                "fieldtype": "Data",
                "insert_after": "custom_province_name",
                "description": "Código AFIP de la retención"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Descripción AFIP",
                "fieldname": "custom_afip_description",
                "fieldtype": "Data",
                "insert_after": "custom_afip_code",
                "description": "Descripción legible de la retención"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Régimen",
                "fieldname": "custom_regimen",
                "fieldtype": "Data",
                "insert_after": "custom_afip_description",
                "description": "Código de régimen AFIP (define si es interna/aduanera/etc.)"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Nro. Certificado",
                "fieldname": "custom_certificate_number",
                "fieldtype": "Data",
                "insert_after": "custom_regimen",
                "description": "Número de certificado de retención"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Base Imponible",
                "fieldname": "custom_base_amount",
                "fieldtype": "Currency",
                "insert_after": "custom_certificate_number",
                "description": "Base imponible sobre la que se calculó la retención (opcional)"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Porcentaje",
                "fieldname": "custom_percentage",
                "fieldtype": "Float",
                "precision": 2,
                "insert_after": "custom_base_amount",
                "description": "Alícuota aplicada (opcional)"
            },
            {
                "dt": "Payment Entry Deduction",
                "label": "Factura de Venta",
                "fieldname": "custom_sales_invoice",
                "fieldtype": "Link",
                "options": "Sales Invoice",
                "insert_after": "custom_percentage",
                "description": "Factura de venta a la que se aplica esta retención"
            }
        ]

        created_fields = []
        errors = []

        for field_data in custom_fields:
            try:
                fieldname = field_data['fieldname']
                dt = field_data['dt']

                # Verificar si el campo ya existe
                filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Custom Field",
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {fieldname} in {dt}"
                )

                if check_err:
                    error_msg = f"Error verificando campo custom '{fieldname}' en '{dt}': {check_err}"
                    print(error_msg)
                    errors.append(error_msg)
                    continue

                if check_resp.status_code == 200:
                    check_data = check_resp.json()
                    if check_data.get('data'):
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}', saltando creación.")
                        continue

                print(f"Creando campo custom '{fieldname}' para '{dt}'...")

                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Custom%20Field",
                    data=field_data,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {fieldname} in {dt}"
                )

                if create_err:
                    if create_err.get('status_code') == 409:
                        print(f"Campo custom '{fieldname}' ya existe en '{dt}' (ignorando)")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_err}"
                        print(error_msg)
                        errors.append(error_msg)
                else:
                    if create_resp.status_code in [200, 201]:
                        print(f"Campo custom '{fieldname}' creado exitosamente en '{dt}'")
                        created_fields.append(f"{dt}.{fieldname}")
                    else:
                        error_msg = f"Error al crear campo '{fieldname}' en '{dt}': {create_resp.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as field_error:
                error_msg = f"Error procesando campo '{field_data['fieldname']}' en {field_data['dt']}: {str(field_error)}"
                print(error_msg)
                errors.append(error_msg)

        # Respuesta final
        if created_fields or (not created_fields and not errors):
            if created_fields:
                message = f"Campos custom de retenciones creados: {', '.join(created_fields)}"
                if errors:
                    message += f". Errores: {'; '.join(errors)}"
            else:
                message = "Todos los campos custom de retenciones ya existen"

            return jsonify({
                "success": True,
                "message": message,
                "created_fields": created_fields,
                "errors": errors
            })
        else:
            return jsonify({
                "success": False,
                "message": "No se pudo crear ningún campo custom de retenciones",
                "errors": errors
            }), 400

    except Exception as e:
        print(f"Error en create_payment_entry_deduction_withholding_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_account_lock_custom_fields():
    """Crear campos custom para bloqueo de períodos en Account"""
    try:
        session, headers, user, error_response = get_session_with_auth()
        if error_response:
            return error_response

        print("Creando campos custom para bloqueo de períodos en Account...")

        custom_fields = [
            {
                "dt": "Account",
                "label": "Bloquear movimientos antes de",
                "fieldname": "custom_lock_posting_before",
                "fieldtype": "Date",
                "insert_after": "account_currency",
                "description": "No se permitirán movimientos con fecha igual o anterior a esta fecha"
            },
            {
                "dt": "Account",
                "label": "Motivo del bloqueo",
                "fieldname": "custom_lock_reason",
                "fieldtype": "Small Text",
                "insert_after": "custom_lock_posting_before",
                "description": "Razón por la cual se bloqueó este período (ej: Cierre mensual Diciembre 2024)"
            }
        ]

        created_fields = []
        errors = []

        for field_data in custom_fields:
            try:
                dt = field_data["dt"]
                fieldname = field_data["fieldname"]
                
                # Verificar si el campo ya existe
                filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Custom Field",
                    params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                    operation_name=f"Check Custom Field {fieldname} in {dt}"
                )

                if check_err:
                    errors.append(f"Error verificando {fieldname}: {check_err}")
                    continue

                if check_resp.status_code == 200:
                    existing = check_resp.json().get("data", [])
                    if existing:
                        print(f"Campo {fieldname} ya existe en {dt}")
                        continue

                # Crear el campo custom
                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Custom%20Field",
                    data=field_data,
                    custom_headers=headers,
                    operation_name=f"Create Custom Field {fieldname} in {dt}"
                )

                if create_err:
                    errors.append(f"Error creando {fieldname}: {create_err}")
                    continue

                if create_resp.status_code in [200, 201]:
                    print(f"Campo {fieldname} creado exitosamente en {dt}")
                    created_fields.append(fieldname)
                else:
                    errors.append(f"Error creando {fieldname}: {create_resp.status_code}")

            except Exception as e:
                errors.append(f"Error procesando {field_data.get('fieldname')}: {str(e)}")
                print(f"Error: {e}")

        # Respuesta final
        if created_fields:
            return jsonify({
                "success": True,
                "message": f"Campos de bloqueo creados: {', '.join(created_fields)}",
                "created_fields": created_fields
            })
        elif not errors:
            return jsonify({
                "success": True,
                "message": "Los campos de bloqueo ya existían previamente."
            })
        else:
            return jsonify({
                "success": False,
                "message": f"Errores: {'; '.join(errors)}",
                "errors": errors
            }), 500

    except Exception as e:
        print(f"Error en create_account_lock_custom_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({
            "success": False,
            "message": f"Error interno: {str(e)}"
        }), 500


def create_all_custom_fields():
    """Crear TODOS los campos custom necesarios para el sistema ERP"""
    try:
        print("\n=== CREANDO TODOS LOS CAMPOS CUSTOM ===")
        
        # Crear campo custom para Item Tax Template (DEBE ejecutarse ANTES de crear los templates)
        print("0. Creando campo custom_transaction_type para Item Tax Template...")
        item_tax_template_result = create_item_tax_template_custom_fields()
        if hasattr(item_tax_template_result, 'get_json'):
            item_tax_template_data = item_tax_template_result.get_json()
        else:
            item_tax_template_data = item_tax_template_result
        
        if isinstance(item_tax_template_data, dict) and not item_tax_template_data.get('success', False):
            print("Error creando campo para Item Tax Template")
            return item_tax_template_result
        
        # Crear campos IVA (Company, Customer, Supplier)
        print("1. Creando campos IVA...")
        iva_result = create_iva_custom_fields()
        # Handle Response objects
        if hasattr(iva_result, 'get_json'):
            iva_data = iva_result.get_json()
        else:
            iva_data = iva_result
        
        if isinstance(iva_data, dict) and not iva_data.get('success', False):
            print("Error creando campos IVA")
            return iva_result
        
        # Crear campos de conciliación
        print("2. Creando campos de conciliación...")
        reconciliation_result = create_reconciliation_custom_fields()
        # Handle Response objects
        if hasattr(reconciliation_result, 'get_json'):
            reconciliation_data = reconciliation_result.get_json()
        else:
            reconciliation_data = reconciliation_result
        
        if isinstance(reconciliation_data, dict) and not reconciliation_data.get('success', False):
            print("Error creando campos de conciliación")
            return reconciliation_result
        
        # Crear campos de items
        print("3. Creando campos de items...")
        item_result = create_item_custom_fields()
        # Handle Response objects
        if hasattr(item_result, 'get_json'):
            item_data = item_result.get_json()
        else:
            item_data = item_result
        
        if isinstance(item_data, dict) and not item_data.get('success', False):
            print("Error creando campos de items")
            return item_result
        
        # Crear campos de filtros por compañía
        print("4. Creando campos de filtros por compañía...")
        filter_result = create_company_filter_fields()
        # Handle Response objects
        if hasattr(filter_result, 'get_json'):
            filter_data = filter_result.get_json()
        else:
            filter_data = filter_result
        
        if isinstance(filter_data, dict) and not filter_data.get('success', False):
            print("Error creando campos de filtros")
            return filter_result
        
        # Crear campos de listas de precios
        print("5. Creando campos de listas de precios...")
        price_result = create_price_list_custom_fields()
        # Handle Response objects
        if hasattr(price_result, 'get_json'):
            price_data = price_result.get_json()
        else:
            price_data = price_result
        
        if isinstance(price_data, dict) and not price_data.get('success', False):
            print("Error creando campos de listas de precios")
            return price_result
        
        # Crear campo de estado de remito en Purchase Receipt
        print("6. Creando campo de estado de remitos...")
        receipt_status_result = create_purchase_receipt_status_field()
        if hasattr(receipt_status_result, 'get_json'):
            receipt_status_data = receipt_status_result.get_json()
        else:
            receipt_status_data = receipt_status_result

        if isinstance(receipt_status_data, dict) and not receipt_status_data.get('success', False):
            print("Error creando campo de estado de remitos")
            return receipt_status_result
        
        # Crear campo de integraciones
        print("7. Creando campo de integraciones por compania...")
        integration_field_result = create_integration_settings_field()
        if hasattr(integration_field_result, 'get_json'):
            integration_data = integration_field_result.get_json()
        else:
            integration_data = integration_field_result

        if isinstance(integration_data, dict) and not integration_data.get('success', False):
            print("Error creando campo de integraciones")
            return integration_field_result

        # Crear campos de percepciones en Purchase Taxes and Charges
        print("8. Creando campos de percepciones en Purchase Taxes and Charges...")
        perception_fields_result = create_purchase_taxes_perception_fields()
        if hasattr(perception_fields_result, 'get_json'):
            perception_fields_data = perception_fields_result.get_json()
        else:
            perception_fields_data = perception_fields_result

        if isinstance(perception_fields_data, dict) and not perception_fields_data.get('success', False):
            print("Error creando campos de percepciones")
            return perception_fields_result

        # Crear campos de retenciones en Payment Entry Deduction
        print("9. Creando campos de retenciones en Payment Entry Deduction...")
        withholding_fields_result = create_payment_entry_deduction_withholding_fields()
        if hasattr(withholding_fields_result, 'get_json'):
            withholding_fields_data = withholding_fields_result.get_json()
        else:
            withholding_fields_data = withholding_fields_result

        if isinstance(withholding_fields_data, dict) and not withholding_fields_data.get('success', False):
            print("Error creando campos de retenciones")
            return withholding_fields_result

        # Crear campos de bloqueo de períodos en Account
        print("10. Creando campos de bloqueo de períodos en Account...")
        account_lock_result = create_account_lock_custom_fields()
        if hasattr(account_lock_result, 'get_json'):
            account_lock_data = account_lock_result.get_json()
        else:
            account_lock_data = account_lock_result

        if isinstance(account_lock_data, dict) and not account_lock_data.get('success', False):
            print("Error creando campos de bloqueo de períodos")
            return account_lock_result

        print("=== TODOS LOS CAMPOS CUSTOM CREADOS EXITOSAMENTE ===")
        return jsonify({
            "success": True,
            "message": "Todos los campos custom han sido creados exitosamente"
        })
        
    except Exception as e:
        print(f"Error en create_all_custom_fields: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
