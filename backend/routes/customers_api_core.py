from flask import request, jsonify
import os
import requests
import json
from urllib.parse import quote
from datetime import datetime, timedelta

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company, get_company_abbr, add_company_abbr, remove_company_abbr, resolve_customer_name

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth
from routes.customer_utils import ensure_customer_by_tax, fetch_customer, get_customer_tax_condition
from routes.customers_common import _get_active_company_abbr, _safe_float

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from utils.conciliation_utils import (
    CONCILIATION_FIELD,
    build_conciliation_groups,
    exclude_balanced_documents,
    summarize_group_balances,
)

# Crear el blueprint para las rutas de clientes


def register(bp):
    @bp.route('/api/customers', methods=['GET', 'OPTIONS'])
    def get_customers():
        """Obtiene la lista de clientes desde ERPNext"""

        # Manejar preflight request para CORS
        if request.method == 'OPTIONS':
            return '', 200

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        try:
            # Verificar que ERPNEXT_URL esté configurado
            if not ERPNEXT_URL:
                return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

            # Obtener la compañía activa del usuario
            company_name = get_active_company(user_id)

            if not company_name:
                return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

            # Obtener clientes desde ERPNext
            fields = json.dumps(["*"])
            filters = json.dumps([['custom_company','=',company_name]])
            customers_url = f"/api/resource/Customer?fields={quote(fields)}&filters={quote(filters)}&limit_page_length=1000"

            customers_response, customers_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=customers_url,
                operation_name="Fetch Customers"
            )

            if customers_error:
                return handle_erpnext_error(customers_error, "Failed to fetch customers")

            customers_data = customers_response.json()
            customers = customers_data.get("data", [])

            print(f"--- Clientes: {len(customers)} registros")

            # Remover ABBR de los nombres de clientes para mostrar
            company_abbr = get_company_abbr(session, headers, company_name)
            for customer in customers:
                if 'customer_name' in customer and customer['customer_name'] and company_abbr:
                    customer['customer_name'] = remove_company_abbr(customer['customer_name'], company_abbr)

            # Para cada cliente, calcular el saldo neto incluyendo notas de crédito
            for customer in customers:
                try:
                    # Obtener todas las facturas y notas de crédito del cliente para calcular saldo neto
                    invoice_filters = [
                        ["customer", "=", customer['name']],
                        ["company", "=", company_name],
                        ["docstatus", "=", 1],  # Solo Submitted, excluir Draft
                    ]

                    fields = '["outstanding_amount"]'
                    filters_str = json.dumps(invoice_filters)
                    balance_url = f"/api/resource/Sales%20Invoice?fields={quote(fields)}&filters={quote(filters_str)}&limit_page_length=1000"
                    balance_response, balance_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=balance_url,
                        operation_name="Fetch Customer Balance"
                    )

                    if balance_error:
                        customer['outstanding_amount'] = 0
                    else:
                        balance_data = balance_response.json()
                        invoices = balance_data.get("data", [])
                    
                        # Calcular saldo neto sumando todos los outstanding_amount
                        net_balance = sum(invoice.get("outstanding_amount", 0) for invoice in invoices)
                        customer['outstanding_amount'] = net_balance

                except Exception as e:
                    customer['outstanding_amount'] = 0

            return jsonify({"success": True, "data": customers, "message": "Clientes obtenidos correctamente"})

        except Exception as e:
            import traceback
            return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

        except requests.exceptions.HTTPError as err:
            return jsonify({"success": False, "message": "Error al obtener clientes"}), 500
        except requests.exceptions.RequestException as e:
            return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

    @bp.route('/api/customers/names', methods=['GET', 'OPTIONS'])
    def get_customer_names():
        """Obtiene la lista de nombres de clientes con paginación y búsqueda"""

        # Manejar preflight request para CORS
        if request.method == 'OPTIONS':
            return '', 200

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        try:
            # Verificar que ERPNEXT_URL esté configurado
            if not ERPNEXT_URL:
                return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

            # Obtener la compañía activa del usuario
            company_name = get_active_company(user_id)

            if not company_name:
                return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

            # Parámetros de paginación y búsqueda
            page = int(request.args.get('page', 1))
            limit = int(request.args.get('limit', 20))
            search = request.args.get('search', '').strip()

            # Calcular offset
            offset = (page - 1) * limit

            # Construir filtros base
            filters = [['custom_company', '=', company_name]]

            # Agregar filtro de búsqueda si existe
            if search:
                filters.append(['customer_name', 'like', f'%{search}%'])

            # Obtener total de clientes para paginación
            fields = '["name"]'
            filters_str = json.dumps(filters)
            total_url = f"/api/resource/Customer?fields={quote(fields)}&filters={quote(filters_str)}&limit_page_length=0"
            total_response, total_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=total_url,
                operation_name="Fetch Total Customers"
            )

            if total_error:
                return handle_erpnext_error(total_error, "Failed to fetch total customers")

            total_data = total_response.json()
            total_customers = len(total_data.get("data", []))

            # Obtener clientes paginados
            fields = '["name","customer_name","customer_details"]'
            filters_str = json.dumps(filters)
            customers_url = f"/api/resource/Customer?fields={quote(fields)}&filters={quote(filters_str)}&order_by=customer_name%20asc&limit_page_length={limit}&limit_start={offset}"

            customers_response, customers_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=customers_url,
                operation_name="Fetch Customers Names"
            )

            if customers_error:
                return handle_erpnext_error(customers_error, "Failed to fetch customer names")

            customers_data = customers_response.json()
            customers = customers_data.get("data", [])

            # Remover ABBR de los nombres de clientes para mostrar
            company_abbr = get_company_abbr(session, headers, company_name)
            for customer in customers:
                if 'customer_name' in customer and customer['customer_name'] and company_abbr:
                    customer['customer_name'] = remove_company_abbr(customer['customer_name'], company_abbr)

            # Calcular si hay más páginas
            has_more = (offset + len(customers)) < total_customers

            return jsonify({
                "success": True,
                "data": customers,
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": total_customers,
                    "has_more": has_more
                },
                "message": "Nombres de clientes obtenidos correctamente"
            })

        except Exception as e:
            return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

        except requests.exceptions.HTTPError as err:
            return jsonify({"success": False, "message": "Error al obtener clientes"}), 500
        except requests.exceptions.RequestException as e:
            return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

    @bp.route('/api/customers/balances', methods=['POST', 'OPTIONS'])
    def get_customer_balances():
        """Obtiene los saldos de una lista de clientes"""

        # Manejar preflight request para CORS
        if request.method == 'OPTIONS':
            return '', 200

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener la lista de nombres de clientes
        data = request.get_json()
        customer_names = data.get('customer_names', [])

        if not customer_names:
            return jsonify({"success": False, "message": "Lista de nombres de clientes requerida"}), 400

        try:
            # Verificar que ERPNEXT_URL esté configurado
            if not ERPNEXT_URL:
                return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

            # Obtener la compañía activa del usuario
            company_name = get_active_company(user_id)

            if not company_name:
                return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

            closing_balance_map = {}
            try:
                try:
                    to_date = datetime.utcnow().date()
                except Exception:
                    to_date = datetime.now().date()
                from_date = to_date - timedelta(days=30)

                report_params = {
                    "report_name": "Customer Ledger Summary",
                    "filters": json.dumps({
                        "company": company_name,
                        "from_date": from_date.strftime("%Y-%m-%d"),
                        "to_date": to_date.strftime("%Y-%m-%d")
                    }),
                    "ignore_prepared_report": "false",
                    "are_default_filters": "false"
                }
                report_response, report_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/method/frappe.desk.query_report.run",
                    params=report_params,
                    operation_name="Fetch Customer Ledger Summary"
                )

                if not report_error and report_response and report_response.status_code == 200:
                    report_payload = report_response.json()
                    for row in report_payload.get("message", {}).get("result", []):
                        customer_key = row.get("customer_name") or row.get("party_name") or row.get("party")
                        if not customer_key:
                            continue
                        closing_balance = row.get("closing_balance")
                        if closing_balance is None:
                            continue
                        closing_balance_map[customer_key] = closing_balance
                        if " - " in customer_key:
                            closing_balance_map[customer_key.split(" - ")[0]] = closing_balance
            except Exception as err:
                print(f" Error obteniendo reporte de saldos: {err}")

            balances = {}

            # Para cada cliente, calcular el saldo neto
            for customer_name in customer_names:
                try:
                    # Obtener todas las facturas del cliente para calcular saldo neto
                    company_abbr = get_company_abbr(session, headers, company_name)
                    search_customer_name = customer_name
                    if company_abbr:
                        search_customer_name = resolve_customer_name(customer_name, company_abbr)

                    invoice_filters = [
                        ["customer", "=", customer_name],
                        ["company", "=", company_name],
                        ["docstatus", "=", 1],  # Solo Submitted
                    ]

                    fields = '["outstanding_amount"]'
                    filters_str = json.dumps(invoice_filters)
                    balance_url = f"/api/resource/Sales%20Invoice?fields={quote(fields)}&filters={quote(filters_str)}&limit_page_length=1000"
                    balance_response, balance_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=balance_url,
                        operation_name="Fetch Customer Balance"
                    )

                    closing_balance = None
                    if closing_balance_map:
                        closing_balance = closing_balance_map.get(search_customer_name)
                        if closing_balance is None:
                            closing_balance = closing_balance_map.get(customer_name)
                    if closing_balance is not None:
                        balances[customer_name] = _safe_float(closing_balance)
                        continue

                    if balance_error:
                        balances[customer_name] = 0
                    else:
                        balance_data = balance_response.json()
                        invoices = balance_data.get("data", [])
                    
                        # Calcular saldo neto sumando todos los outstanding_amount
                        net_balance = sum(invoice.get("outstanding_amount", 0) for invoice in invoices)
                        balances[customer_name] = net_balance

                except Exception as e:
                    balances[customer_name] = 0

            return jsonify({"success": True, "data": balances, "message": "Saldos obtenidos correctamente"})

        except Exception as e:
            return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

        except requests.exceptions.HTTPError as err:
            return jsonify({"success": False, "message": "Error al obtener saldos"}), 500
        except requests.exceptions.RequestException as e:
            return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

    @bp.route('/api/customers', methods=['POST', 'OPTIONS'])
    def create_customer():
        """Crea un nuevo cliente en ERPNext"""

        # Manejar preflight request para CORS
        if request.method == 'OPTIONS':
            return '', 200

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Obtener los datos del cliente a crear
        customer_data = request.get_json()

        if not customer_data or 'data' not in customer_data:
            return jsonify({"success": False, "message": "Datos del cliente requeridos"}), 400

        try:
            # Obtener la compañía activa del usuario
            print("--- Crear cliente: procesando")
            company_name = get_active_company(user_id)

            if not company_name:
                return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

            # Crear campos custom si no existen
            # NOTA: Los campos custom se crean UNA SOLA VEZ durante la configuración inicial
            # create_custom_customer_fields(session, headers)

            # Obtener la condición de pago por defecto de la compañía
            try:
                company_response, company_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Company/{quote(company_name)}",
                    operation_name="Fetch Company Data"
                )
            
                if company_error:
                    default_payment_terms = None
                else:
                    company_data = company_response.json().get('data', {})
                    default_payment_terms = company_data.get('default_payment_terms')
            except Exception as e:
                default_payment_terms = None

            # Procesar los campos de cuentas por defecto
            customer_create_data = customer_data['data'].copy()
            customer_create_data['custom_company'] = company_name

            # Agregar ABBR de la compañía al nombre del cliente
            if 'customer_name' in customer_create_data and customer_create_data['customer_name']:
                company_abbr = get_company_abbr(session, headers, company_name)
                if company_abbr:
                    customer_create_data['customer_name'] = add_company_abbr(customer_create_data['customer_name'], company_abbr)
                    print(f"--- Crear cliente: nombre con ABBR: {customer_create_data['customer_name']}")

            # Extraer campos de dirección antes de crear el cliente
            address_fields = ['address', 'ciudad', 'codigo_postal', 'provincia', 'pais', 'address_line1', 'city', 'pincode', 'state', 'country']
            address_data = {}
            for field in address_fields:
                if field in customer_create_data:
                    address_data[field] = customer_create_data.pop(field)

            # Construir la lista de accounts
            accounts_list = []

            if 'default_receivable_account' in customer_create_data and customer_create_data['default_receivable_account']:
                account_name = customer_create_data['default_receivable_account']
                accounts_list.append({
                    'company': company_name,
                    'account': account_name
                })

            # Asignar la cuenta de ingresos al campo custom
            if 'default_income_account' in customer_create_data and customer_create_data['default_income_account']:
                income_account_name = customer_create_data['default_income_account']
                customer_create_data['custom_cuenta_de_ingresos_por_defecto'] = income_account_name
                customer_create_data.pop('default_income_account')  # Remover para no enviarlo duplicado

            if accounts_list:
                customer_create_data['accounts'] = accounts_list

            # Asignar condición de pago por defecto si no se especifica una
            if not customer_create_data.get('payment_terms') and default_payment_terms:
                customer_create_data['payment_terms'] = default_payment_terms

            # Mapear condición IVA: "No Responsable" -> "Consumidor Final"
            if customer_create_data.get('custom_condicion_iva') == 'No Responsable':
                customer_create_data['custom_condicion_iva'] = 'Consumidor Final'

            # Mapear price_list a default_price_list
            if 'price_list' in customer_create_data:
                customer_create_data['default_price_list'] = customer_create_data.pop('price_list')

            # --- VALIDACIÓN: evitar asignar un Customer Group que sea is_group = 1 ---
            # Los clientes nunca deben apuntar a grupos de tipo "is_group=1" (nodos agregadores)
            if customer_create_data.get('customer_group'):
                try:
                    group_response, group_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Customer%20Group/{quote(customer_create_data.get('customer_group'))}",
                        operation_name="Fetch Customer Group for Validation"
                    )

                    if group_error:
                        # Si falla la validación de grupo por conexión/errores, devolver error claro
                        return handle_erpnext_error(group_error, "Failed to validate customer_group")

                    group_data = group_response.json().get('data', {})
                    if group_data.get('is_group') == 1:
                        return jsonify({"success": False, "message": "El campo 'customer_group' no puede ser un grupo padre (is_group=1). Seleccione un grupo de cliente final."}), 400

                except Exception as e:
                    return jsonify({"success": False, "message": f"Error validando customer_group: {str(e)}"}), 500

            # Crear el cliente en ERPNext
            print(f"--- Crear cliente: enviando datos: {customer_create_data}")
            response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Customer",
                data=customer_create_data,
                operation_name="Create Customer"
            )

            if create_error:
                return handle_erpnext_error(create_error, "Failed to create customer")

            # ERPNext devuelve los datos del cliente creado
            created_customer_data = response.json()
            customer_name = created_customer_data.get("data", {}).get("name")

            # Si hay datos de dirección, crear la dirección y linkearla al cliente
            if address_data and any(address_data.values()):
                try:
                    # Preparar datos de dirección para ERPNext
                    erpnext_address_data = {
                        "address_title": f"{customer_create_data.get('customer_name', customer_name)} (Principal)",
                        "address_type": "Billing",
                        "address_line1": address_data.get('address_line1', address_data.get('address', '')),
                        "city": address_data.get('city', address_data.get('ciudad', '')),
                        "state": address_data.get('state', address_data.get('provincia', '')),
                        "pincode": address_data.get('pincode', address_data.get('codigo_postal', '')),
                        "country": address_data.get('country', address_data.get('pais', 'Argentina')),
                        "links": [{
                            "link_doctype": "Customer",
                            "link_name": customer_name
                        }]
                    }

                    # Crear la dirección en ERPNext
                    address_response, address_error = make_erpnext_request(
                        session=session,
                        method="POST",
                        endpoint="/api/resource/Address",
                        data={"data": erpnext_address_data},
                        operation_name="Create Customer Address"
                    )

                    if address_error:
                        print("--- Crear dirección: error")
                    else:
                        print("--- Crear dirección: ok")

                except Exception as e:
                    print("--- Crear dirección: error")
                    # No fallar la creación del cliente si la dirección falla

            return jsonify({"success": True, "data": created_customer_data.get("data", {}), "message": "Cliente creado correctamente"})

        except requests.exceptions.HTTPError as err:
            try:
                error_detail = err.response.json()
                return jsonify({"success": False, "message": error_detail.get("message", "Error al crear cliente")}), 500
            except:
                return jsonify({"success": False, "message": "Error al crear cliente"}), 500
        except requests.exceptions.RequestException as e:
            return jsonify({"success": False, "message": "Error de conexión con ERPNext"}), 500

    @bp.route('/api/customers/<path:customer_name>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
    def manage_customer(customer_name):
        """Gestiona operaciones de un cliente específico (GET, PUT, DELETE)"""

        # Manejar preflight request para CORS
        if request.method == 'OPTIONS':
            return '', 200

        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Si es GET, obtener los detalles del cliente
        if request.method == 'GET':
            try:
                # Obtener el cliente desde ERPNext
                # Resolver nombre de cliente con ABBR de la empresa activa
                company_name, company_abbr = _get_active_company_abbr(session, headers, user_id)
                fetch_name = resolve_customer_name(customer_name, company_abbr) if company_abbr else customer_name

                fields = '["*","custom_condicion_iva","porcentaje_iva","default_price_list"]'
                response, get_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Customer/{quote(fetch_name)}?fields={quote(fields)}",
                    operation_name="Fetch Customer"
                )

                if get_error:
                    return handle_erpnext_error(get_error, "Failed to fetch customer")

                customer_data = response.json()
                customer_info = customer_data.get("data", {})

                # Remover ABBR del nombre del cliente para mostrar
                if 'customer_name' in customer_info and customer_info['customer_name'] and company_abbr:
                    customer_info['customer_name'] = remove_company_abbr(customer_info['customer_name'], company_abbr)
                if 'accounts' in customer_info and customer_info['accounts']:
                    # Buscar las cuentas por defecto en el array de accounts
                    for account_entry in customer_info['accounts']:
                        if account_entry.get('account'):
                            account_type = account_entry.get('account_type', 'Receivable')
                        
                            if account_type == 'Receivable':
                                customer_info['default_receivable_account'] = account_entry['account']

                # Leer la cuenta de ingresos del campo custom
                if 'custom_cuenta_de_ingresos_por_defecto' in customer_info:
                    customer_info['default_income_account'] = customer_info['custom_cuenta_de_ingresos_por_defecto']

                # Mapear default_price_list a price_list para el frontend
                if 'default_price_list' in customer_info:
                    customer_info['price_list'] = customer_info['default_price_list']

                return jsonify({"success": True, "data": customer_info, "message": "Cliente obtenido correctamente"})

            except Exception as e:
                return jsonify({"success": False, "message": f"Error al obtener cliente: {str(e)}"}), 500

        # Si es DELETE, eliminar el cliente
        if request.method == 'DELETE':
            try:
                # Obtener la compañía activa
                company_name = get_active_company(user_id)
                if not company_name:
                    return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

                # Obtener abreviatura de la empresa
                company_abbr = get_company_abbr(session, headers, company_name)
            
                # Intentar con el nombre tal cual primero
                actual_customer_name = customer_name
            
                # Intentar eliminar
                response, delete_error = make_erpnext_request(
                    session=session,
                    method="DELETE",
                    endpoint=f"/api/resource/Customer/{quote(actual_customer_name)}",
                    operation_name="Delete Customer"
                )
                # If there's an error, check if it's due to linked documents (LinkExistsError)
                if delete_error:
                    body = delete_error.get('response_body', '') or ''
                    if isinstance(body, str) and ('LinkExistsError' in body or 'No se puede eliminar' in body or 'Puede desactivar' in body):
                        # Return the ERPNext body back to the client so frontend can detect LinkExistsError
                        return jsonify({"success": False, "message": "Cliente vinculado a documentos", "detail": body}), delete_error.get('status_code', 500)

                # Si falla, intentar con ABBR
                if delete_error and company_abbr:
                    actual_customer_name = resolve_customer_name(customer_name, company_abbr)
                    response, delete_error = make_erpnext_request(
                        session=session,
                        method="DELETE",
                        endpoint=f"/api/resource/Customer/{quote(actual_customer_name)}",
                        operation_name="Delete Customer with ABBR"
                    )

                if delete_error:
                    return handle_erpnext_error(delete_error, "Failed to delete customer")

                return jsonify({"success": True, "message": "Cliente eliminado correctamente"})
            except Exception as e:
                return jsonify({"success": False, "message": f"Error eliminando cliente: {str(e)}"}), 500


            @bp.route('/api/customers/<path:customer_name>/disable', methods=['PUT', 'POST', 'OPTIONS'])
            def disable_customer(customer_name):
                """Marca un cliente como desactivado (disabled = 1) en ERPNext. Intenta primero con el nombre tal cual y luego con la ABBR de compañía."""

                # Manejar preflight request para CORS
                if request.method == 'OPTIONS':
                    return '', 200

                session, headers, user_id, error_response = get_session_with_auth()
                if error_response:
                    return error_response

                try:
                    company_name = get_active_company(user_id)
                    if not company_name:
                        return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

                    company_abbr = get_company_abbr(session, headers, company_name)

                    # Primero intentar con el nombre tal cual
                    actual_customer_name = customer_name

                    payload = {"data": {"disabled": 1}}

                    response, error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=f"/api/resource/Customer/{quote(actual_customer_name)}",
                        operation_name="Disable Customer",
                        data=payload
                    )

                    # Si falla intentar con ABBR
                    if error and company_abbr:
                        actual_customer_name = resolve_customer_name(customer_name, company_abbr)
                        response, error = make_erpnext_request(
                            session=session,
                            method="PUT",
                            endpoint=f"/api/resource/Customer/{quote(actual_customer_name)}",
                            operation_name="Disable Customer with ABBR",
                            data=payload
                        )

                    if error:
                        return handle_erpnext_error(error, "Failed to disable customer")

                    return jsonify({"success": True, "message": "Cliente desactivado correctamente"})

                except Exception as e:
                    return jsonify({"success": False, "message": f"Error desactivando cliente: {str(e)}"}), 500


        # Obtener los datos a actualizar del body de la petición
        update_data = request.get_json()
        if not update_data or 'data' not in update_data:
            return jsonify({"success": False, "message": "Datos de actualización requeridos"}), 400

        try:
            # Obtener la compañía activa del usuario
            company_name = get_active_company(user_id)
            if not company_name:
                return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

            # Intentar encontrar el cliente por nombre (primero sin ABBR, luego con ABBR)
            actual_customer_name = customer_name
            company_abbr = get_company_abbr(session, headers, company_name)
        
            # Primero intentar con el nombre tal cual
            customer_response, customer_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Customer/{quote(actual_customer_name)}",
                operation_name="Fetch Customer for Update"
            )
        
            # Si no se encuentra, intentar agregando la ABBR
            if customer_error and company_abbr:
                actual_customer_name = resolve_customer_name(customer_name, company_abbr)
                customer_response, customer_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Customer/{quote(actual_customer_name)}",
                    operation_name="Fetch Customer for Update with ABBR"
                )
        
            if customer_error:
                return handle_erpnext_error(customer_error, "Failed to find customer for update")
        
            current_customer_data = customer_response.json().get("data", {})
            # Usamos las cuentas existentes como base para no perderlas
            accounts_list = current_customer_data.get('accounts', [])

            # Preparar los datos para actualizar
            customer_data = update_data['data']
        
            # Si se está actualizando el nombre del cliente, agregar ABBR si no lo tiene
            if 'customer_name' in customer_data and company_abbr:
                customer_data['customer_name'] = add_company_abbr(customer_data['customer_name'], company_abbr)
        
            # Mantener las cuentas existentes si no se especifican nuevas
            if 'accounts' not in customer_data:
                customer_data['accounts'] = accounts_list

            # Mapear price_list a default_price_list
            if 'price_list' in customer_data:
                customer_data['default_price_list'] = customer_data.pop('price_list')
            # --- Eliminar campos vacíos antes de enviar la actualización ---
            def prune_empty(obj):
                """Recorre recursivamente dicts/lists y elimina claves con valores vacíos:
                - Strings vacías o sólo espacios
                - None
                - listas/dicts vacías
                Esto evita enviar campos que limpiarían valores requeridos en ERPNext.
                """
                if isinstance(obj, dict):
                    new = {}
                    for k, v in obj.items():
                        # Skip None
                        if v is None:
                            continue

                        # Strings: skip empty or whitespace-only
                        if isinstance(v, str):
                            if v.strip() == "":
                                continue
                            new[k] = v
                            continue

                        # Lists/tuples: prune items and skip if empty
                        if isinstance(v, (list, tuple)):
                            pruned_list = []
                            for item in v:
                                pr = prune_empty(item)
                                if pr is None:
                                    continue
                                # For primitive values keep non-empty
                                if pr == "" or pr == {} or pr == []:
                                    continue
                                pruned_list.append(pr)
                            if not pruned_list:
                                continue
                            new[k] = pruned_list
                            continue

                        # Dicts: recurse and skip if empty
                        if isinstance(v, dict):
                            pr = prune_empty(v)
                            if not pr:
                                continue
                            new[k] = pr
                            continue

                        # Other values (numbers, booleans) keep as-is
                        new[k] = v

                    return new

                if isinstance(obj, (list, tuple)):
                    res = []
                    for item in obj:
                        pr = prune_empty(item)
                        if pr is None:
                            continue
                        if pr == "" or pr == {} or pr == []:
                            continue
                        res.append(pr)
                    return res

                return obj

            # Aplicar la poda de campos vacíos
            customer_data = prune_empty(customer_data)

            # --- VALIDACIÓN: evitar asignar un Customer Group que sea is_group = 1 en actualizaciones ---
            if customer_data.get('customer_group'):
                try:
                    grp_resp, grp_err = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint=f"/api/resource/Customer%20Group/{quote(customer_data.get('customer_group'))}",
                        operation_name="Fetch Customer Group for Update Validation"
                    )

                    if grp_err:
                        return handle_erpnext_error(grp_err, "Failed to validate customer_group for update")

                    grp_data = grp_resp.json().get('data', {})
                    if grp_data.get('is_group') == 1:
                        return jsonify({"success": False, "message": "El campo 'customer_group' no puede ser un grupo padre (is_group=1). Seleccione un grupo de cliente final."}), 400
                except Exception as e:
                    return jsonify({"success": False, "message": f"Error validando customer_group: {str(e)}"}), 500

            # Actualizar el cliente en ERPNext
            update_response, update_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Customer/{quote(actual_customer_name)}",
                data={"data": customer_data},
                operation_name="Update Customer"
            )
        
            if update_error:
                return handle_erpnext_error(update_error, "Failed to update customer")
        
            # Obtener los datos actualizados para devolver
            fields = '["*","custom_condicion_iva","porcentaje_iva","default_price_list"]'

            # Preferir el nombre (docname) devuelto por la respuesta de la actualización si está disponible.
            updated_docname = None
            try:
                if update_response is not None:
                    upd_json = update_response.json()
                    updated_docname = upd_json.get('data', {}).get('name')
            except Exception:
                updated_docname = None

            # Fallback: si no tenemos docname, intentar usar customer_data['customer_name'] (ya con ABBR) o el actual_customer_name
            fetch_name = updated_docname or customer_data.get('customer_name') or actual_customer_name

            updated_customer_response, updated_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Customer/{quote(fetch_name)}?fields={quote(fields)}",
                operation_name="Fetch Updated Customer"
            )
        
            if updated_error:
                return handle_erpnext_error(updated_error, "Failed to fetch updated customer")
        
            updated_customer_data = updated_customer_response.json().get("data", {})
        
            # Remover ABBR del nombre para mostrar en frontend
            if 'customer_name' in updated_customer_data and company_abbr:
                updated_customer_data['customer_name'] = remove_company_abbr(updated_customer_data['customer_name'], company_abbr)
        
            # Mapear default_price_list a price_list para el frontend
            if 'default_price_list' in updated_customer_data:
                updated_customer_data['price_list'] = updated_customer_data['default_price_list']
        
            return jsonify({
                "success": True,
                "message": "Cliente actualizado exitosamente",
                "data": updated_customer_data
            })

        except Exception as e:
            return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


