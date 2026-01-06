"""
ERPNext AFIP Custom Fields Setup Module

This module handles the creation and verification of custom fields
required for AFIP (Administración Federal de Ingresos Públicos) compliance
in ERPNext, including IVA conditions, tax categories, and company information.

Functions:
- create_custom_fields_internal: Create custom fields for IVA conditions and tax categories
"""

from config import ERPNEXT_URL
from routes.Configuracion.setup_afip_utils import check_custom_field_exists

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request


def create_custom_fields_internal(session, headers, erpnext_url=ERPNEXT_URL):
    """Crear campos personalizados para Condición IVA en Cliente y Compañía (función interna)"""
    print("\n--- Creando campos personalizados para Condición IVA ---")

    try:
        # Campo personalizado para Cliente
        print("Verificando/Creando campo 'Condición IVA' en Customer...")
        if check_custom_field_exists(session, headers, "Customer", "custom_condicion_iva", erpnext_url):
            print("Campo 'Condición IVA' en Customer ya existe, saltando creación.")
        else:
            customer_field_data = {
                "data": {
                    "dt": "Customer",
                    "fieldname": "custom_condicion_iva",
                    "label": "Condición IVA",
                    "fieldtype": "Select",
                    "options": "\nResponsable Inscripto\nMonotributista\nExento\nConsumidor Final",
                    "insert_after": "tax_id"
                }
            }

            customer_response, customer_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom Field",
                data=customer_field_data,
                operation_name="Create custom field 'Condición IVA' for Customer"
            )

            if customer_error:
                print(f"Error creando campo en Customer: {customer_error}")
                return {"success": False, "message": f"Error creando campo en Customer: {customer_error}"}

            if customer_response.status_code not in [200, 201]:
                print(f"Error creando campo en Customer: {customer_response.status_code} - {customer_response.text}")
                return {"success": False, "message": f"Error creando campo en Customer: {customer_response.text}"}

        # Campo personalizado para Compañía
        print("Verificando/Creando campo 'Condición IVA' en Company...")
        if check_custom_field_exists(session, headers, "Company", "custom_condicion_iva", erpnext_url):
            print("Campo 'Condición IVA' en Company ya existe, saltando creación.")
        else:
            company_field_data = {
                "data": {
                    "dt": "Company",
                    "fieldname": "custom_condicion_iva",
                    "label": "Condición IVA",
                    "fieldtype": "Select",
                    "options": "\nResponsable Inscripto\nMonotributista\nExento",
                    "insert_after": "tax_id"
                }
            }

            company_response, company_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom Field",
                data=company_field_data,
                operation_name="Create custom field 'Condición IVA' for Company"
            )

            if company_error:
                print(f"Error creando campo en Company: {company_error}")
                return {"success": False, "message": f"Error creando campo en Company: {company_error}"}

            if company_response.status_code not in [200, 201]:
                print(f"Error creando campo en Company: {company_response.status_code} - {company_response.text}")
                return {"success": False, "message": f"Error creando campo en Company: {company_response.text}"}

        # Campo personalizado para Personería en Compañía
        print("Verificando/Creando campo 'Personería' en Company...")
        if check_custom_field_exists(session, headers, "Company", "custom_personeria", erpnext_url):
            print("Campo 'Personería' en Company ya existe, saltando creación.")
        else:
            # Aceptar las labels exactas que el frontend utiliza. El campo es Select y contendrá
            # las opciones que el equipo definió. Si el frontend envía una opción no listada,
            # el setup intentará crear el campo con estas opciones; si hace falta crear opciones
            # adicionales, se pueden añadir aquí.
            personeria_field_data = {
                "data": {
                    "dt": "Company",
                    "fieldname": "custom_personeria",
                    "label": "Personería",
                    "fieldtype": "Select",
                    "options": "\nSociedad Colectiva (SC)\nSociedad en Comandita Simple (SCS)\nSociedad de Capital e Industria (SCI)\nSociedad de Responsabilidad Limitada (S.R.L.)\nSociedad Anónima (S.A.)\nSociedad por Acciones Simplificada (S.A.S.)\nSociedad en Comandita por Acciones (SCA)\nSociedad Anónima Unipersonal (S.A.U.)\nMonotributista\nUnipersonal\nFísica\nJurídica",
                    "insert_after": "custom_condicion_iva"
                }
            }

            personeria_response, personeria_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom Field",
                data=personeria_field_data,
                operation_name="Create custom field 'Personería' for Company"
            )

            if personeria_error:
                print(f"Error creando campo Personería en Company: {personeria_error}")
                return {"success": False, "message": f"Error creando campo Personería en Company: {personeria_error}"}

            if personeria_response.status_code not in [200, 201]:
                print(f"Error creando campo Personería en Company: {personeria_response.status_code} - {personeria_response.text}")
                return {"success": False, "message": f"Error creando campo Personería en Company: {personeria_response.text}"}

        # Campo personalizado para Condición Ingresos Brutos en Compañía
        print("Verificando/Creando campo 'Condición Ingresos Brutos' en Company...")
        if check_custom_field_exists(session, headers, "Company", "custom_condicion_ingresos_brutos", erpnext_url):
            print("Campo 'Condición Ingresos Brutos' en Company ya existe, saltando creación.")
        else:
            condicion_iibb_field_data = {
                "data": {
                    "dt": "Company",
                    "fieldname": "custom_condicion_ingresos_brutos",
                    "label": "Condición Ingresos Brutos",
                    "fieldtype": "Select",
                    "options": "\nInscripto\nExento",
                    "insert_after": "custom_personeria"
                }
            }

            condicion_iibb_response, condicion_iibb_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom Field",
                data=condicion_iibb_field_data,
                operation_name="Create custom field 'Condición Ingresos Brutos' for Company"
            )

            if condicion_iibb_error:
                print(f"Error creando campo Condición Ingresos Brutos en Company: {condicion_iibb_error}")
                return {"success": False, "message": f"Error creando campo Condición Ingresos Brutos en Company: {condicion_iibb_error}"}

            if condicion_iibb_response.status_code not in [200, 201]:
                print(f"Error creando campo Condición Ingresos Brutos en Company: {condicion_iibb_response.status_code} - {condicion_iibb_response.text}")
                return {"success": False, "message": f"Error creando campo Condición Ingresos Brutos en Company: {condicion_iibb_response.text}"}

        # Campo personalizado para Jurisdicciones Ingresos Brutos en Compañía
        print("Verificando/Creando campo 'Jurisdicciones IIBB' en Company...")
        if check_custom_field_exists(session, headers, "Company", "custom_jurisdicciones_iibb", erpnext_url):
            print("Campo 'Jurisdicciones IIBB' en Company ya existe, saltando creación.")
        else:
            jurisdicciones_iibb_field_data = {
                "data": {
                    "dt": "Company",
                    "fieldname": "custom_jurisdicciones_iibb",
                    "label": "Jurisdicciones IIBB",
                    "fieldtype": "Data",
                    "insert_after": "custom_condicion_ingresos_brutos"
                }
            }

            jurisdicciones_iibb_response, jurisdicciones_iibb_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom Field",
                data=jurisdicciones_iibb_field_data,
                operation_name="Create custom field 'Jurisdicciones IIBB' for Company"
            )

            if jurisdicciones_iibb_error:
                print(f"Error creando campo Jurisdicciones IIBB en Company: {jurisdicciones_iibb_error}")
                return {"success": False, "message": f"Error creando campo Jurisdicciones IIBB en Company: {jurisdicciones_iibb_error}"}

            if jurisdicciones_iibb_response.status_code not in [200, 201]:
                print(f"Error creando campo Jurisdicciones IIBB en Company: {jurisdicciones_iibb_response.status_code} - {jurisdicciones_iibb_response.text}")
                return {"success": False, "message": f"Error creando campo Jurisdicciones IIBB en Company: {jurisdicciones_iibb_response.text}"}

        # Campo personalizado para Condición frente a Ganancias en Compañía
        print("Verificando/Creando campo 'Condición Ganancias' en Company...")
        if check_custom_field_exists(session, headers, "Company", "custom_condicion_ganancias", erpnext_url):
            print("Campo 'Condición Ganancias' en Company ya existe, saltando creación.")
        else:
            condicion_ganancias_field_data = {
                "data": {
                    "dt": "Company",
                    "fieldname": "custom_condicion_ganancias",
                    "label": "Condición Ganancias",
                    "fieldtype": "Select",
                    "options": "\nInscripto\nExento",
                    "insert_after": "custom_jurisdicciones_iibb"
                }
            }

            condicion_ganancias_response, condicion_ganancias_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom Field",
                data=condicion_ganancias_field_data,
                operation_name="Create custom field 'Condición Ganancias' for Company"
            )

            if condicion_ganancias_error:
                print(f"Error creando campo Condición Ganancias en Company: {condicion_ganancias_error}")
                return {"success": False, "message": f"Error creando campo Condición Ganancias en Company: {condicion_ganancias_error}"}

            if condicion_ganancias_response.status_code not in [200, 201]:
                print(f"Error creando campo Condición Ganancias en Company: {condicion_ganancias_response.status_code} - {condicion_ganancias_response.text}")
                return {"success": False, "message": f"Error creando campo Condición Ganancias en Company: {condicion_ganancias_response.text}"}

        print("Campos personalizados verificados/creados exitosamente")
        return {"success": True, "message": "Campos personalizados fiscales verificados/creados exitosamente"}

    except Exception as e:
        print(f"Error interno en create_custom_fields_internal: {e}")
        return {"success": False, "message": f"Error interno: {str(e)}"}