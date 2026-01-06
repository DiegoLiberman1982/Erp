"""
ERPNext AFIP Setup Utilities Module

This module provides utility functions for checking existence of DocTypes,
records, and custom fields in ERPNext, specifically for AFIP setup operations.

Functions:
- check_doctype_exists: Verify if a DocType exists
- check_record_exists: Verify if a record exists in a DocType
- check_custom_field_exists: Verify if a custom field exists
"""

from urllib.parse import quote
import json

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request


def check_doctype_exists(session, headers, doctype_name, erpnext_url):
    """Check if a DocType exists"""
    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/DocType/{quote(doctype_name, safe='')}",
            operation_name=f"Check DocType existence '{doctype_name}'"
        )
        return response.status_code == 200 if not error else False
    except Exception as e:
        print(f"Error checking DocType existence: {str(e)}")
        return False


def check_record_exists(session, headers, doctype, name, erpnext_url):
    """Check if a record exists"""
    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/{quote(doctype, safe='')}/{quote(name, safe='')}",
            operation_name=f"Check record existence '{doctype}/{name}'"
        )
        return response.status_code == 200 if not error else False
    except Exception as e:
        print(f"Error checking record existence: {str(e)}")
        return False


def check_custom_field_exists(session, headers, dt, fieldname, erpnext_url):
    """Check if a custom field exists"""
    try:
        # Try different naming conventions for Custom Field records
        # Prefer the canonical ERPNext naming: "<DocType>-<fieldname>" (e.g. "Customer-custom_condicion_iva").
        # Fallbacks: "<fieldname>-<DocType>" and plain fieldname.
        possible_names = [
            f"{dt}-{fieldname}",
            f"{fieldname}-{dt}",
            fieldname
        ]

        for name in possible_names:
            # Directly try resource lookup by name (URL-encode the resource name)
            encoded_name = quote(name, safe='')
            response, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Custom Field/{encoded_name}",
                operation_name=f"Check custom field existence '{name}'"
            )
            if not error and response.status_code == 200:
                return True

        # If direct name check fails, try querying with filters
        try:
            query_response, query_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Custom Field",
                params={
                        "filters": json.dumps([["dt", "=", dt], ["fieldname", "=", fieldname]]),
                        "limit_page_length": 1,
                        "fields": json.dumps(["name"])
                },
                operation_name=f"Query custom field '{fieldname}' in '{dt}'"
            )
            if not query_error and query_response.status_code == 200:
                data = query_response.json()
                if data.get('data') and len(data['data']) > 0:
                    return True
        except Exception as query_e:
            print(f"Error querying custom fields: {str(query_e)}")

        return False
    except Exception as e:
        print(f"Error checking custom field existence: {str(e)}")
        return False


def ensure_custom_field_has_option(session, headers, dt, fieldname, option_value, erpnext_url):
    """Ensure a Custom Field exists for dt/fieldname and that its options include option_value.
    If the field doesn't exist it will create it with a sensible default set plus option_value.
    If it exists but doesn't include option_value, it will append the option and update the Custom Field.
    Returns True on success, False otherwise.
    """
    try:
        if not option_value or not option_value.strip():
            return True
        option_value = option_value.strip()

        # Query for existing custom field record (use filters format ERPNext expects)
        filters_list = [["dt", "=", dt], ["fieldname", "=", fieldname]]
        # Query via centralized HTTP util
        query_endpoint = "/api/resource/Custom Field"
        query_params = {
            "filters": json.dumps(filters_list),
            "fields": json.dumps(["name", "options"]),
            "limit_page_length": 1
        }
        resp, resp_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=query_endpoint,
            params=query_params,
            operation_name=f"Query Custom Field {fieldname} in {dt}"
        )

        if not resp_error and resp.status_code == 200:
            data = resp.json()
            items = data.get('data', [])
            if items:
                record = items[0]
                record_name = record.get('name')
                existing_options = record.get('options', '') or ''
                opts = [o.strip() for o in existing_options.splitlines() if o.strip()]

                # Build the full set of desired options (include common UI personeria values)
                desired_personeria = [
                    "Sociedad Colectiva (SC)",
                    "Sociedad en Comandita Simple (SCS)",
                    "Sociedad de Capital e Industria (SCI)",
                    "Sociedad de Responsabilidad Limitada (S.R.L.)",
                    "Sociedad Anónima (S.A.)",
                    "Sociedad por Acciones Simplificada (S.A.S.)",
                    "Sociedad en Comandita por Acciones (SCA)",
                    "Sociedad Anónima Unipersonal (S.A.U.)",
                    "Monotributista",
                    "Unipersonal",
                    # Keep these as well to be compatible with older ERPNext setups
                    "Física",
                    "Jurídica",
                ]

                # Merge existing options with desired set and the specific incoming option
                merged = []
                # preserve existing order, then append missing desired options
                for o in opts:
                    if o not in merged:
                        merged.append(o)
                for o in desired_personeria + [option_value]:
                    if o and o not in merged:
                        merged.append(o)

                # If the incoming option is already present and no new options, nothing to do
                if option_value in opts and len(merged) == len(opts):
                    return True

                new_options = '\n'.join(merged)
                update_endpoint = f"/api/resource/Custom Field/{quote(record_name, safe='')}"
                update_resp, update_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=update_endpoint,
                    data={"data": {"options": new_options}},
                    operation_name=f"Update Custom Field options {record_name}"
                )
                if not update_error and update_resp.status_code in [200, 201]:
                    print(f"Agregada/actualizada opciones en Custom Field {fieldname} ({dt})")
                    return True
                else:
                    print(f"Error actualizando Custom Field opciones: {update_error or update_resp.status_code} - {(update_resp.text if update_resp is not None else '')}")
                    return False

        # If not found via filters, try direct resource names (some ERPNext installs create CF with different name patterns)
        # Try the most likely record name patterns in ERPNext: first DocType-field
        possible_names = [f"{dt}-{fieldname}", f"{fieldname}-{dt}", fieldname]
        for name in possible_names:
            try:
                encoded_name = quote(name, safe='')
                direct_endpoint = f"/api/resource/Custom Field/{encoded_name}"
                direct_resp, direct_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=direct_endpoint,
                    operation_name=f"Direct get Custom Field {name}"
                )
                if not direct_error and direct_resp.status_code == 200:
                    rec = direct_resp.json().get('data', {})
                    record_name = rec.get('name') or name
                    existing_options = rec.get('options', '') or ''
                    opts = [o.strip() for o in existing_options.splitlines() if o.strip()]

                    # Merge as before
                    desired_personeria = [
                        "Sociedad Colectiva (SC)",
                        "Sociedad en Comandita Simple (SCS)",
                        "Sociedad de Capital e Industria (SCI)",
                        "Sociedad de Responsabilidad Limitada (S.R.L.)",
                        "Sociedad Anónima (S.A.)",
                        "Sociedad por Acciones Simplificada (S.A.S.)",
                        "Sociedad en Comandita por Acciones (SCA)",
                        "Sociedad Anónima Unipersonal (S.A.U.)",
                        "Monotributista",
                        "Unipersonal",
                        "Física",
                        "Jurídica",
                    ]
                    merged = []
                    for o in opts:
                        if o not in merged:
                            merged.append(o)
                    for o in desired_personeria + [option_value]:
                        if o and o not in merged:
                            merged.append(o)

                    if option_value in opts and len(merged) == len(opts):
                        return True

                    new_options = '\n'.join(merged)
                    update_endpoint = f"/api/resource/Custom Field/{quote(record_name, safe='')}"
                    update_resp, update_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint=update_endpoint,
                        data={"data": {"options": new_options}},
                        operation_name=f"Update Custom Field options (direct) {record_name}"
                    )
                    if not update_error and update_resp.status_code in [200, 201]:
                        print(f"Agregada/actualizada opciones en Custom Field {fieldname} ({dt}) via direct lookup {name}")
                        return True
                    else:
                        print(f"Error actualizando Custom Field (direct) opciones: {update_error or update_resp.status_code} - {(update_resp.text if update_resp is not None else '')}")
                        return False
            except Exception as e:
                print(f"Error consultando Custom Field directo {name}: {e}")

        # If we reach here, the field doesn't exist - create it with defaults + option
        print(f"Custom Field {fieldname} no existe en {dt}, creando con la opción '{option_value}'")
        # sensible defaults for personería/condición labels used by UI
        default_personeria_options = "\nSociedad Colectiva (SC)\nSociedad en Comandita Simple (SCS)\nSociedad de Capital e Industria (SCI)\nSociedad de Responsabilidad Limitada (S.R.L.)\nSociedad Anónima (S.A.)\nSociedad por Acciones Simplificada (S.A.S.)\nSociedad en Comandita por Acciones (SCA)\nSociedad Anónima Unipersonal (S.A.U.)\nMonotributista\nUnipersonal\nFísica\nJurídica"
        # Ensure option_value is included
        if option_value not in [o.strip() for o in default_personeria_options.splitlines() if o.strip()]:
            options = default_personeria_options + "\n" + option_value
        else:
            options = default_personeria_options

        create_payload = {
            "data": {
                "dt": dt,
                "fieldname": fieldname,
                "label": "Personería" if fieldname == 'custom_personeria' else fieldname,
                "fieldtype": "Select",
                "options": options,
                "insert_after": "custom_condicion_iva"
            }
        }

        create_endpoint = "/api/resource/Custom Field"
        create_resp, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint=create_endpoint,
            data=create_payload,
            operation_name=f"Create Custom Field {fieldname} in {dt}"
        )
        if not create_error and create_resp.status_code in [200, 201]:
            print(f"Custom Field {fieldname} creado en {dt} con opción '{option_value}'")
            return True
        else:
            print(f"Error creando Custom Field {fieldname}: {create_error or create_resp.status_code} - {(create_resp.text if create_resp is not None else '')}")
            return False

    except Exception as e:
        print(f"Error en ensure_custom_field_has_option: {e}")
        return False