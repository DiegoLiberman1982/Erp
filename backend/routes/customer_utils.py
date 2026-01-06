import json
from urllib.parse import quote

from routes.general import add_company_abbr, get_company_abbr, resolve_customer_name
from utils.http_utils import make_erpnext_request


def resolve_customer_fetch_name(session, headers, customer_name, company_name=None, company_abbr=None):
    """
    Return the canonical Customer name for the given company context.

    - If `company_abbr` is provided, it is used directly.
    - Else if `company_name` is provided, abbr is fetched from ERPNext.
    - If no abbr can be resolved, returns `customer_name` as-is.
    """
    if not customer_name:
        return customer_name
    if company_abbr:
        return resolve_customer_name(customer_name, company_abbr)
    if company_name:
        abbr = get_company_abbr(session, headers, company_name)
        if abbr:
            return resolve_customer_name(customer_name, abbr)
    return customer_name


def fetch_customer(session, headers, customer_name, company_name=None, fields=None, operation_name=None):
    """
    Fetch a Customer doc from ERPNext, resolving the company abbr when possible.

    Returns: (customer_data_dict_or_None, error_dict_or_None, fetch_name)
    """
    fetch_name = resolve_customer_fetch_name(
        session=session,
        headers=headers,
        customer_name=customer_name,
        company_name=company_name,
    )

    params = None
    if fields is not None:
        params = {"fields": json.dumps(fields) if isinstance(fields, (list, tuple)) else fields}

    resp, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Customer/{quote(fetch_name)}",
        params=params,
        operation_name=operation_name or f"Fetch Customer ({fetch_name})",
    )

    if error or not resp or resp.status_code != 200:
        return None, error, fetch_name

    try:
        data = resp.json().get("data", {})
    except Exception:
        data = {}
    return data, None, fetch_name


def get_customer_tax_condition(session, headers, customer_name, company_name=None):
    """
    Get Customer tax condition (custom_condicion_iva + tax_id) from ERPNext.
    """
    customer_data, error, fetch_name = fetch_customer(
        session=session,
        headers=headers,
        customer_name=customer_name,
        company_name=company_name,
        fields=["custom_condicion_iva", "tax_id"],
        operation_name=f"Get customer tax condition for {customer_name}",
    )
    if error or not customer_data:
        return None

    tax_condition = customer_data.get("custom_condicion_iva", "") or ""
    tax_id = customer_data.get("tax_id", "") or ""
    return {
        "tax_condition": tax_condition,
        "tax_id": tax_id,
        "is_company": tax_id.startswith(("30", "33", "34")) if tax_id else False,
        "is_person": tax_id.startswith(("20", "23", "24", "27")) if tax_id else False,
    }


def ensure_customer_by_tax(session, headers, tax_id, name, company, doc_type=None):
    """
    Find (or create) a customer by tax_id, scoped to `company` when possible.
    Returns the Customer.name or None.
    """
    try:
        filters = [["tax_id", "=", tax_id]]
        if company:
            filters.append(["custom_company", "=", company])
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Customer",
            params={
                "filters": json.dumps(filters),
                "fields": json.dumps(["name", "customer_name"]),
            },
            operation_name="Find customer by tax_id",
        )
        if not error and response and response.status_code == 200:
            data = response.json().get("data", [])
            if data:
                return data[0].get("name")
    except Exception as e:
        print(f"--- ensure_customer_by_tax search error: {e}")

    try:
        company_abbr = get_company_abbr(session, headers, company) if company else None
        base_customer_name = name or f"AFIP {tax_id}"
        customer_name_with_abbr = (
            add_company_abbr(base_customer_name, company_abbr) if company_abbr else base_customer_name
        )

        customer_payload = {
            "customer_name": customer_name_with_abbr,
            "name": customer_name_with_abbr,
            "tax_id": tax_id,
            "customer_type": "Company" if doc_type in ("80", "86") else "Individual",
            "custom_company": company,
        }
        create_resp, create_err = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Customer",
            data={"data": customer_payload},
            operation_name="Create customer from AFIP import",
        )
        if create_err or not create_resp:
            return None
        created = create_resp.json().get("data", {})
        return created.get("name")
    except Exception as e:
        print(f"--- ensure_customer_by_tax create error: {e}")
        return None

