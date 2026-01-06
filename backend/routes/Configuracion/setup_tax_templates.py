"""
Setup - Tax Templates
Handles creation and verification of tax templates in ERPNext
"""

import json

# Importar configuración
from config import ERPNEXT_URL

# Importar función centralizada para obtener abreviatura de compañía
from routes.general import get_company_abbr, get_active_company

from utils.http_utils import make_erpnext_request, handle_erpnext_error


def ensure_tax_templates_exist(session, headers, user_id):
    """Asegura que existan las plantillas de impuestos necesarias"""
    print("\n--- Verificando Plantillas de Impuestos ---")

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa para el usuario {user_id}")
            return False

        print(f"Compañía activa: {company_name}")

        # Obtener abreviatura de la compañía usando función centralizada
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            print(f"ERROR: No se pudo obtener la abreviatura de la compañía {company_name}")
            return False
        print(f"Abreviatura de la compañía: {company_abbr}")

        # Plantillas de impuestos a crear
        tax_templates = [
            {
                "title": "IVA 21% (Ventas)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                        "rate": 21,
                        "description": "IVA 21%"
                    }
                ]
            },
            {
                "title": "IVA 21% (Compras)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"1.1.4.01.05 - IVA Crédito Fiscal - {company_abbr}",
                        "rate": 21,
                        "description": "IVA 21%"
                    }
                ]
            },
            {
                "title": "IVA 10.5% (Ventas)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                        "rate": 10.5,
                        "description": "IVA 10.5%"
                    }
                ]
            },
            {
                "title": "IVA 10.5% (Compras)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"1.1.4.01.05 - IVA Crédito Fiscal - {company_abbr}",
                        "rate": 10.5,
                        "description": "IVA 10.5%"
                    }
                ]
            },
            {
                "title": "IVA 27% (Ventas)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                        "rate": 27,
                        "description": "IVA 27%"
                    }
                ]
            },
            {
                "title": "IVA 27% (Compras)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"1.1.4.01.05 - IVA Crédito Fiscal - {company_abbr}",
                        "rate": 27,
                        "description": "IVA 27%"
                    }
                ]
            },
            {
                "title": "IVA 0% (Exento)",
                "taxes": [
                    {
                        "charge_type": "On Net Total",
                        "account_head": f"2.1.3.01.01 - IVA Débito Fiscal - {company_abbr}",
                        "rate": 0,
                        "description": "IVA Exento"
                    }
                ]
            }
        ]

        created_templates = []
        errors = []

        for template in tax_templates:
            try:
                # Verificar si la plantilla ya existe
                params = {
                    'filters': json.dumps([["title", "=", template["title"]]]),
                    'limit_page_length': 1
                }
                endpoint = "/api/resource/Sales Taxes and Charges Template"
                check_response, check_err = make_erpnext_request(session, 'GET', endpoint, params=params, operation_name=f"Check Tax Template {template['title']}")

                if check_err:
                    err_msg = f"Error verificando plantilla '{template['title']}': {check_err.get('message')}"
                    print(err_msg)
                    errors.append(err_msg)
                else:
                    if check_response.status_code == 200:
                        check_data = check_response.json()
                        if check_data.get("data"):
                            print(f"Plantilla '{template['title']}' ya existe")
                            created_templates.append({
                                "title": template['title'],
                                "status": "already_exists"
                            })
                            continue

                # Crear la plantilla
                template_data = {
                    "title": template['title'],
                    "company": company_name,
                    "taxes": template['taxes']
                }

                endpoint = "/api/resource/Sales Taxes and Charges Template"
                create_response, create_err = make_erpnext_request(session, 'POST', endpoint, data={"data": template_data}, operation_name=f"Create Tax Template {template['title']}")

                if create_err:
                    error_msg = f"Error creando plantilla '{template['title']}': {create_err.get('message')}"
                    print(error_msg)
                    errors.append(error_msg)
                else:
                    if create_response.status_code == 200:
                        print(f"Plantilla '{template['title']}' creada exitosamente")
                        created_templates.append({
                            "title": template['title'],
                            "status": "created"
                        })
                    else:
                        error_msg = f"Error creando plantilla '{template['title']}': {create_response.status_code} - {create_response.text}"
                        print(error_msg)
                        errors.append(error_msg)

            except Exception as e:
                error_msg = f"Error procesando plantilla '{template['title']}': {e}"
                print(error_msg)
                errors.append(error_msg)

        if errors:
            print(f"Se encontraron {len(errors)} errores al crear plantillas de impuestos")
            return False

        print(f"Plantillas de impuestos procesadas: {len(created_templates)}")
        return True

    except Exception as e:
        print(f"Error en ensure_tax_templates_exist: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return False