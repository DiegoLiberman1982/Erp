import json

from routes.customer_utils import fetch_customer
from routes.general import get_active_company, get_company_abbr
from utils.http_utils import make_erpnext_request


def _get_active_company_abbr(session, headers, user_id, company_name=None):
    company = company_name or get_active_company(user_id)
    abbr = get_company_abbr(session, headers, company) if company else None
    return company, abbr


def _safe_float(value, default=0.0):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return default


def create_custom_customer_fields(session, headers):
    '''Crea los campos custom necesarios para el cliente si no existen'''
    custom_fields = [
        {
            "dt": "Customer",
            "label": "Cuenta de Ingresos por Defecto",
            "fieldname": "custom_cuenta_de_ingresos_por_defecto",
            "fieldtype": "Link",
            "options": "Account",
            "insert_after": "customer_group",
        }
    ]

    for field_data in custom_fields:
        try:
            check_response, check_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Custom%20Field",
                params={
                    "filters": json.dumps(
                        [["dt", "=", field_data["dt"]], ["fieldname", "=", field_data["fieldname"]]]
                    )
                },
                operation_name="Check Custom Field",
            )

            if check_error:
                print("--- Campos custom: error al verificar")
                continue

            existing_fields = check_response.json().get("data", [])
            if existing_fields:
                continue

            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom%20Field",
                data={"data": field_data},
                operation_name="Create Custom Field",
            )

            if create_error:
                print("--- Campos custom: error al crear")

        except Exception as e:
            print(f"Exception creating custom field {field_data['fieldname']}: {str(e)}")
            continue

    return True


def get_customer_receivable_account(customer_name, company_name, session, headers):
    '''Obtiene la cuenta por cobrar específica del cliente para la compañía dada.'''
    try:
        customer_data, customer_error, fetch_name = fetch_customer(
            session=session,
            headers=headers,
            customer_name=customer_name,
            company_name=company_name,
            fields=["accounts"],
            operation_name="Fetch Customer Account",
        )

        if customer_error or not customer_data:
            print("--- Obtener cuenta cliente: error")
            return None

        accounts = customer_data.get("accounts", [])
        for account in accounts:
            if account.get("company") == company_name:
                account_name = (account.get("account") or "").strip()
                if account_name:
                    print("--- Obtener cuenta cliente: ok")
                    return account_name

        print("--- Obtener cuenta cliente: no específica")
        return None

    except Exception:
        print("--- Obtener cuenta cliente: error")
        return None
