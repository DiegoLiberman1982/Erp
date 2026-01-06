from flask import Blueprint, request, jsonify
import json
from urllib.parse import quote
from datetime import datetime

from routes.auth_utils import get_session_with_auth
from routes.items import ensure_item_exists, assign_tax_template_by_rate, get_tax_template_map
from routes.general import get_active_company
from utils.http_utils import make_erpnext_request, handle_erpnext_error

subscriptions_bp = Blueprint('subscriptions', __name__, url_prefix='/api')


def convert_date_format(date_str):
    """Convert date from DD/MM/YYYY to YYYY-MM-DD format"""
    if not date_str or not isinstance(date_str, str):
        return date_str
    try:
        # Try parsing DD/MM/YYYY
        dt = datetime.strptime(date_str, '%d/%m/%Y')
        return dt.strftime('%Y-%m-%d')
    except ValueError:
        # If already in YYYY-MM-DD or other format, return as is
        return date_str


def _map_subscription(doc, plan_detail=None, plan_data=None):
    """Map subscription document to response format.
    
    Args:
        doc: Subscription document
        plan_detail: Optional plan detail from child table query
        plan_data: Optional plan data with amount/interval_days from Subscription Plan
    """
    if not isinstance(doc, dict):
        return {}
    
    # Extraer plan: primero desde plan_detail (bulk query), luego desde doc.plans (single query), luego desde doc.plan
    plan_name = None
    plan_qty = 1
    if plan_detail:
        plan_name = plan_detail.get("plan")
        plan_qty = plan_detail.get("qty", 1)
    elif doc.get("plans") and len(doc.get("plans", [])) > 0:
        plan_name = doc["plans"][0].get("plan")
        plan_qty = doc["plans"][0].get("qty", 1)
    else:
        plan_name = doc.get("plan")
    
    # Si tenemos plan_data, usar amount e interval_days del plan; sino, de la suscripción
    amount = None
    interval_days = None
    trial_days = None
    discount_percent = None
    
    if plan_data:
        amount = plan_data.get("amount") or plan_data.get("cost") or plan_data.get("payment_amount")
        interval_days = plan_data.get("interval_days") or plan_data.get("billing_interval_count")
        trial_days = plan_data.get("trial_days") or plan_data.get("trial_period")
        discount_percent = plan_data.get("discount_percent")
    
    # Fallback a datos de suscripción si no hay plan_data
    if amount is None:
        amount = doc.get("amount") or doc.get("grand_total") or doc.get("recurring_amount")
    if interval_days is None:
        interval_days = doc.get("interval_days") or doc.get("billing_interval_count")
    if trial_days is None:
        trial_days = doc.get("trial_period_days") or doc.get("trial_days")
    if discount_percent is None:
        discount_percent = doc.get("discount_percent") or doc.get("additional_discount_percentage")
    
    # Mapear generate_invoice_at
    generate_invoice_at = doc.get("generate_invoice_at") or ""
    # Convertir a formato simplificado
    if "beginning" in generate_invoice_at.lower() or "start" in generate_invoice_at.lower():
        generate_invoice_at = "start"
    elif "end" in generate_invoice_at.lower():
        generate_invoice_at = "end"
    else:
        generate_invoice_at = "end"  # Default
    
    return {
        "name": doc.get("name"),
        "subscription_name": doc.get("name"),
        "customer": doc.get("party") or doc.get("customer"),
        "party": doc.get("party"),
        "plan": plan_name,
        "plan_qty": plan_qty,
        "start_date": doc.get("start_date"),
        "end_date": doc.get("end_date"),
        "amount": amount,
        "interval_days": interval_days,
        "trial_days": trial_days,
        "discount_percent": discount_percent,
        "align_day_of_month": doc.get("align_day_of_month") or doc.get("follow_calendar_months_day"),
        "next_invoice_date": doc.get("next_invoice_date") or doc.get("current_invoice_start"),
        "status": doc.get("status") or "",
        "generate_invoice_at": generate_invoice_at,
    }




def _map_plan(doc, item_tax_template=None):
    if not isinstance(doc, dict):
        return {}
    return {
        "name": doc.get("name"),
        "plan_name": doc.get("plan_name") or doc.get("name"),
            # The Subscription Plan doctype may use 'cost' (Currency) for the plan price
            # and older deployments might use 'payment_amount' or 'amount'. Support all.
            "amount": doc.get("amount") or doc.get("payment_amount") or doc.get("cost"),
        "interval_days": doc.get("interval_days") or doc.get("billing_interval_count") or doc.get("every_n_days"),
        "trial_days": doc.get("trial_days") or doc.get("trial_period") or doc.get("trial_period_days"),
        "discount_percent": doc.get("discount_percent") or doc.get("additional_discount_percentage"),
        "align_day_of_month": doc.get("align_day_of_month") or doc.get("follow_calendar_months_day"),
        "description": doc.get("description") or doc.get("plan_description"),
        "currency": doc.get("currency"),
        "tax_template": item_tax_template or doc.get("tax_template")
    }

def _build_filters(company=None, customer=None, search=None):
    filters = [["party_type", "=", "Customer"]]
    # Note: Subscription doctype may not allow filtering by company in list queries
    # So we skip company filter for subscriptions
    if customer:
        filters.append(["party", "=", customer])
    if search:
        filters.append(["party", "like", f"%{search}%"])
    return filters


def _extract_tax_rate_from_item(item_code, session, headers):
    """
    Extrae la tasa de IVA del item asociado al plan de suscripción.
    Retorna el primer tax_rate encontrado en los item tax templates del item.
    """
    if not item_code:
        return None
    
    try:
        response, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item/{quote(item_code)}",
            params={"fields": json.dumps(["name", "taxes"])},
            operation_name=f"Get item tax for {item_code}"
        )
        
        if err or not response or response.status_code != 200:
            return None
        
        item_data = response.json().get("data", {})
        taxes = item_data.get("taxes", [])
        
        if not taxes or len(taxes) == 0:
            return None
        
        # Obtener el nombre del primer template
        first_template_name = taxes[0].get("item_tax_template")
        if not first_template_name:
            return None
        
        # Obtener los detalles del template para extraer la tasa
        template_resp, template_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item Tax Template/{quote(first_template_name)}",
            operation_name=f"Get tax template {first_template_name}"
        )
        
        if template_err or not template_resp or template_resp.status_code != 200:
            return None
        
        template_data = template_resp.json().get("data", {})
        template_taxes = template_data.get("taxes", [])
        
        if not template_taxes or len(template_taxes) == 0:
            return None
        
        # Retornar la primera tasa encontrada
        tax_rate = template_taxes[0].get("tax_rate")
        return str(float(tax_rate)) if tax_rate is not None else None
        
    except Exception as e:
        print(f"--- Error extracting tax rate from item {item_code}: {e}")
        return None


@subscriptions_bp.route('/subscriptions', methods=['GET', 'OPTIONS'])
def list_subscriptions():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    page = int(request.args.get('page', 1))
    limit = int(request.args.get('limit', 50))
    company = request.args.get('company')
    search = request.args.get('search')
    limit_start = (page - 1) * limit

    params = {
        # 'amount' is not permitted in the list query for some ERPNext versions (DataError)
        # so request only safe fields and compute/normalize amounts from available fields when needed.
        "fields": json.dumps([
            "name", "party", "party_type", "start_date", "end_date"

        ]),
        "filters": json.dumps(_build_filters(company=company, search=search)),
        "limit_start": limit_start,
        "limit_page_length": limit
    }

    response, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Subscription",
        params=params,
        operation_name="List Subscriptions"
    )
    if err:
        return handle_erpnext_error(err, "No se pudieron obtener las suscripciones")

    data = response.json().get("data", [])
    
    # Cargar planes usando child table query en bulk
    subscription_names = [doc.get("name") for doc in data if doc.get("name")]
    plan_details_map = {}
    
    if subscription_names:
        # Usar frappe.client.get_list para obtener child table en bulk
        plans_payload = {
            "doctype": "Subscription Plan Detail",
            "parent": "Subscription",
            "fields": ["name", "parent", "plan", "qty", "idx"],
            "filters": {
                "parent": ["in", subscription_names],
                "parenttype": "Subscription",
                "parentfield": "plans"
            },
            "limit_page_length": 1000
        }
        
        plans_resp, plans_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data=plans_payload,
            operation_name="Load subscription plans in bulk"
        )
        
        if not plans_err and plans_resp and plans_resp.status_code == 200:
            plans_data = plans_resp.json().get("message", [])
            # Mapear planes por parent (subscription name)
            for plan_detail in plans_data:
                parent = plan_detail.get("parent")
                if parent:
                    # Solo guardamos el primer plan de cada suscripción
                    if parent not in plan_details_map:
                        plan_details_map[parent] = plan_detail
    
    # Cargar datos de los planes (amount, interval_days) desde Subscription Plan
    plan_names = list(set([plan_details_map[sub_name].get("plan") for sub_name in plan_details_map if plan_details_map[sub_name].get("plan")]))
    plans_data_map = {}
    
    if plan_names:
        plan_filters = [["name", "in", plan_names]]
        plan_params = {
            "fields": json.dumps(["name", "cost", "amount", "payment_amount", "billing_interval_count", "interval_days", "trial_days", "trial_period", "discount_percent"]),
            "filters": json.dumps(plan_filters),
            "limit_page_length": 1000
        }
        
        plans_master_resp, plans_master_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Subscription Plan",
            params=plan_params,
            operation_name="Load Subscription Plan data"
        )
        
        if not plans_master_err and plans_master_resp and plans_master_resp.status_code == 200:
            plans_master_data = plans_master_resp.json().get("data", [])
            for plan_data in plans_master_data:
                plan_name = plan_data.get("name")
                if plan_name:
                    plans_data_map[plan_name] = plan_data
    
    # Mapear suscripciones incluyendo plan details y plan data
    mapped = []
    for doc in data:
        sub_name = doc.get("name")
        plan_detail = plan_details_map.get(sub_name)
        plan_data = None
        if plan_detail:
            plan_name = plan_detail.get("plan")
            if plan_name:
                plan_data = plans_data_map.get(plan_name)
        mapped.append(_map_subscription(doc, plan_detail, plan_data))
    
    return jsonify({
        "success": True,
        "data": mapped,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": response.json().get("count", len(mapped)) if isinstance(response.json(), dict) else len(mapped)
        }
    })


@subscriptions_bp.route('/subscriptions/customers', methods=['GET', 'OPTIONS'])
def list_subscription_customers():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    page = int(request.args.get('page', 1))
    limit = int(request.args.get('limit', 50))
    search = request.args.get('search')
    company = request.args.get('company')
    limit_start = (page - 1) * limit

    params = {
        # Avoid requesting 'amount' here because ERPNext may reject it (DataError).
        "fields": json.dumps([
            "name", "party", "status", "start_date", "end_date",
            
        ]),
        "filters": json.dumps(_build_filters(company=company, search=search)),
        "limit_start": limit_start,
        "limit_page_length": limit
    }

    response, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Subscription",
        params=params,
        operation_name="List Subscription Customers"
    )
    if err:
        return handle_erpnext_error(err, "No se pudieron obtener clientes con suscripciones")

    records = response.json().get("data", [])
    
    # Cargar planes usando child table query en bulk
    subscription_names = [doc.get("name") for doc in records if doc.get("name")]
    plan_details_map = {}
    
    if subscription_names:
        plans_payload = {
            "doctype": "Subscription Plan Detail",
            "parent": "Subscription",
            "fields": ["name", "parent", "plan", "qty", "idx"],
            "filters": {
                "parent": ["in", subscription_names],
                "parenttype": "Subscription",
                "parentfield": "plans"
            },
            "limit_page_length": 1000
        }
        
        plans_resp, plans_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.client.get_list",
            data=plans_payload,
            operation_name="Load subscription plans for customers"
        )
        
        if not plans_err and plans_resp and plans_resp.status_code == 200:
            plans_data = plans_resp.json().get("message", [])
            for plan_detail in plans_data:
                parent = plan_detail.get("parent")
                if parent and parent not in plan_details_map:
                    plan_details_map[parent] = plan_detail
    
    mapped = [_map_subscription(doc, plan_details_map.get(doc.get("name"))) for doc in records]

    # Deduplicar por cliente manteniendo la primera entrada
    unique_by_customer = {}
    for sub in mapped:
        customer = sub.get("customer") or sub.get("party")
        if customer and customer not in unique_by_customer:
            unique_by_customer[customer] = sub

    items = list(unique_by_customer.values())
    return jsonify({
        "success": True,
        "data": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": response.json().get("count", len(items)) if isinstance(response.json(), dict) else len(items)
        }
    })


@subscriptions_bp.route('/customers/<customer_name>/subscriptions', methods=['GET', 'OPTIONS'])
def list_customer_subscriptions(customer_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    params = {
        "fields": json.dumps(["*"]),
        "filters": json.dumps(_build_filters(customer=customer_name))
    }

    response, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Subscription",
        params=params,
        operation_name=f"Subscriptions for customer {customer_name}"
    )
    if err:
        return handle_erpnext_error(err, "No se pudieron obtener las suscripciones del cliente")

    data = response.json().get("data", [])
    mapped = [_map_subscription(doc) for doc in data]
    return jsonify({"success": True, "data": mapped})



@subscriptions_bp.route('/subscription-plans', methods=['GET', 'OPTIONS'])
def list_subscription_plans():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company = request.args.get('company')
    filters = []
    # The Subscription Plan doctype for this ERP instance uses a custom field
    # 'custom_company' to tag plans to a company. Use that field when filtering
    # by company (created via the setup scripts).
    if company:
        filters.append(["custom_company", "=", company])

    params = {
        "fields": json.dumps(["*"]),
        "limit_page_length": 1000,
    }
    if filters:
        params["filters"] = json.dumps(filters)

    response, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Subscription Plan",
        params=params,
        operation_name="List Subscription Plans"
    )
    if err:
        return handle_erpnext_error(err, "No se pudieron obtener los planes")

    data = response.json().get("data", [])
    mapped = []
    for doc in data:
        item_code = doc.get("item")
        tax_rate = _extract_tax_rate_from_item(item_code, session, headers) if item_code else None
        mapped.append(_map_plan(doc, tax_rate))
    return jsonify({"success": True, "data": mapped})


@subscriptions_bp.route('/subscription-plans/<plan_name>', methods=['GET', 'OPTIONS'])
def get_subscription_plan(plan_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    params = {
        "fields": json.dumps(["*"]),
        "filters": json.dumps([["name", "=", plan_name]])
    }

    response, err = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Subscription Plan",
        params=params,
        operation_name=f"Get Subscription Plan {plan_name}"
    )
    if err:
        return handle_erpnext_error(err, f"No se pudo obtener el plan {plan_name}")

    data = response.json().get("data", [])
    if not data:
        return jsonify({"success": False, "message": f"Plan {plan_name} no encontrado"}), 404

    doc = data[0]
    item_code = doc.get("item")
    tax_rate = _extract_tax_rate_from_item(item_code, session, headers) if item_code else None
    mapped = _map_plan(doc, tax_rate)
    return jsonify({"success": True, "data": mapped})


@subscriptions_bp.route('/subscription-plans/bulk', methods=['POST', 'OPTIONS'])
def bulk_upsert_subscription_plans():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company = get_active_company(user_id)
    if not company:
        return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

    body = request.get_json() or {}
    plans = body.get("plans", [])
    if not isinstance(plans, list) or len(plans) == 0:
        return jsonify({"success": False, "message": "No hay planes para procesar"}), 400

    results = []
    for plan in plans:
        if not isinstance(plan, dict):
            continue
        name = plan.get("name")
        
        # Generate item code for the plan
        plan_name = plan.get("plan_name") or name or ""
        item_code = f"SUB-{plan_name.replace(' ', '-').replace('ñ', 'n').upper()}"
        
        # Ensure the item exists as a service
        item_data = {
            "item_name": plan_name,
            "description": plan.get("description", ""),
            "item_group": "Services",
            "is_stock_item": 0
        }
        ensure_item_exists(item_code, item_data, session, headers, company)
        
        # Asignar tax templates al item si se proporciona tax_template (tasa de IVA)
        tax_rate = plan.get("tax_template")
        if tax_rate:
            try:
                # Convertir tasa a número si es string
                if isinstance(tax_rate, str):
                    tax_rate = float(tax_rate)
                
                # Obtener mapas de templates para ventas y compras
                tax_map_sales = get_tax_template_map(session, headers, company, transaction_type='sales')
                tax_map_purchase = get_tax_template_map(session, headers, company, transaction_type='purchase')
                
                # Asignar template de ventas
                assign_tax_template_by_rate(item_code, tax_rate, session, headers, company, tax_map_sales, transaction_type='sales')
                
                # Asignar template de compras
                assign_tax_template_by_rate(item_code, tax_rate, session, headers, company, tax_map_purchase, transaction_type='purchase')
                
                print(f"--- Tax templates assigned to item {item_code} for rate {tax_rate}%")
            except Exception as e:
                print(f"--- Error assigning tax templates to item {item_code}: {e}")
        
        payload = {
            "plan_name": plan_name,
            "item": item_code,
            "price_determination": "Fixed Rate",
            "custom_company": company,
            # Use 'cost' as the canonical price field for Subscription Plan in this ERP instance
            # but still include backwards-compatible 'payment_amount' and 'amount' to support different deployments.
            "cost": plan.get("amount") or plan.get("payment_amount") or plan.get("cost") or 0,
            "amount": plan.get("amount") or plan.get("payment_amount") or plan.get("cost") or 0,
            "payment_amount": plan.get("amount") or plan.get("payment_amount") or plan.get("cost") or 0,
            "billing_interval": "Day",
            "billing_interval_count": plan.get("interval_days") or plan.get("billing_interval_count") or 0,
            "trial_period": plan.get("trial_days") or 0,
            "trial_days": plan.get("trial_days") or 0,
            "discount_percent": plan.get("discount_percent") or 0,
            "currency": plan.get("currency")
        }

        endpoint = "/api/resource/Subscription Plan"
        method = "POST"
        if name:
            endpoint = f"/api/resource/Subscription Plan/{quote(name)}"
            method = "PUT"

        response, err = make_erpnext_request(
            session=session,
            method=method,
            endpoint=endpoint,
            data=payload,
            operation_name=f"{'Actualizar' if method == 'PUT' else 'Crear'} plan {plan_name}"
        )
        if err:
            return handle_erpnext_error(err, f"No se pudo guardar el plan {plan_name}")

        # Recuperar tax_template del item para incluirlo en el resultado
        item_tax_template = tax_rate if tax_rate else None
        results.append(_map_plan(response.json().get("data", {}), item_tax_template))

    return jsonify({"success": True, "data": results, "message": f"Planes guardados ({len(results)})"})

@subscriptions_bp.route('/subscriptions/<subscription_name>', methods=['PUT', 'OPTIONS'])
def update_subscription(subscription_name):
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json() or {}
    response, err = make_erpnext_request(
        session=session,
        method="PUT",
        endpoint=f"/api/resource/Subscription/{quote(subscription_name)}",
        data=payload,
        operation_name=f"Actualizar suscripcion {subscription_name}"
    )
    if err:
        return handle_erpnext_error(err, "No se pudo actualizar la suscripcion")

    data = response.json().get("data", {})
    return jsonify({"success": True, "data": _map_subscription(data), "message": "Suscripcion actualizada"})


@subscriptions_bp.route('/subscriptions/bulk', methods=['POST', 'OPTIONS'])
def bulk_upsert_subscriptions():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company = get_active_company(user_id)
    if not company:
        return jsonify({"success": False, "message": "No se pudo determinar la compañía activa"}), 400

    body = request.get_json() or {}
    subscriptions = body.get("subscriptions", [])
    mode = body.get("mode", "manage")

    if not isinstance(subscriptions, list) or len(subscriptions) == 0:
        return jsonify({"success": False, "message": "No hay suscripciones para procesar"}), 400

    results = []
    errors = []

    for sub in subscriptions:
        # Mapear generate_invoice_at
        generate_invoice_at_value = sub.get("generate_invoice_at", "end")
        if generate_invoice_at_value == "start":
            generate_invoice_at = "Beginning of the current subscription period"
        else:
            generate_invoice_at = "End of the current subscription period"
        
        data_payload = {
            "party_type": "Customer",
            "party": sub.get("customer") or sub.get("party"),
            "company": company,
            "plan": sub.get("plan"),
            "start_date": convert_date_format(sub.get("start_date")),
            "end_date": convert_date_format(sub.get("end_date")) or None,
            "currency": sub.get("currency"),
            "amount": sub.get("amount"),
            "billing_interval_count": sub.get("interval_days"),
            "trial_period_days": sub.get("trial_days"),
            "additional_discount_percentage": sub.get("discount_percent"),
            "generate_invoice_at": generate_invoice_at,
            "submit_invoice": 1,
            "plans": [{"plan": sub.get("plan"), "qty": 1}] if sub.get("plan") else []
        }

        try:
            if sub.get("name") or sub.get("subscription_name"):
                sub_name = sub.get("name") or sub.get("subscription_name")
                resp, err = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Subscription/{quote(sub_name)}",
                    data=data_payload,
                    operation_name=f"Actualizar suscripcion {sub_name}"
                )
            else:
                resp, err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Subscription",
                    data=data_payload,
                    operation_name="Crear suscripcion"
                )

            if err:
                errors.append({"subscription": sub.get("name") or sub.get("customer"), "error": err.get("message")})
            else:
                results.append(_map_subscription(resp.json().get("data", {})))
        except Exception as e:
            errors.append({"subscription": sub.get("name") or sub.get("customer"), "error": str(e)})

    success = len(errors) == 0
    return jsonify({
        "success": success,
        "data": results,
        "errors": errors,
        "message": "Suscripciones procesadas" if success else "Algunas suscripciones no se pudieron procesar"
    }), (200 if success else 207)


@subscriptions_bp.route('/subscriptions/bulk-cancel', methods=['POST', 'OPTIONS'])
def bulk_cancel_subscriptions():
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    body = request.get_json() or {}
    names = body.get("subscriptions") or body.get("names") or []

    if not names:
        return jsonify({"success": False, "message": "No se enviaron suscripciones para cancelar"}), 400

    errors = []
    cancelled = []

    for sub_name in names:
        resp, err = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Subscription/{quote(sub_name)}",
            data={"status": "Cancelled"},
            operation_name=f"Cancelar suscripcion {sub_name}"
        )
        if err:
            errors.append({"subscription": sub_name, "error": err.get("message")})
        else:
            cancelled.append(sub_name)

    success = len(errors) == 0
    return jsonify({
        "success": success,
        "cancelled": cancelled,
        "errors": errors,
        "message": "Suscripciones canceladas" if success else "Algunas suscripciones no se pudieron cancelar"
    }), (200 if success else 207)
