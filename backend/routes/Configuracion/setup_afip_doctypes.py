"""
Módulo para la creación y gestión de DocTypes relacionados con AFIP (Administración Federal de Ingresos Públicos).

Este módulo contiene funciones para crear y configurar los DocTypes necesarios para el manejo
de talonarios de comprobantes fiscales, letras, tipos de comprobantes y control de numeración
según los requerimientos de AFIP.

Funciones principales:
- create_afip_doctypes: Crea todos los DocTypes relacionados con AFIP
"""

import requests
from flask import jsonify
from routes.Configuracion.setup_afip_utils import check_doctype_exists

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from routes.Configuracion.setup_tax_account_map import ensure_tax_account_map_defaults


def create_afip_doctypes(session, headers, ERPNEXT_URL, user_id=None):
    """
    Crea los DocTypes necesarios para el funcionamiento de AFIP en ERPNext.

    Esta función crea los siguientes DocTypes:
    - Talonario Letra: Tabla hija para letras de comprobantes
    - Talonario Comprobante: Tabla hija para tipos de comprobantes AFIP
    - Talonario Ultimo Numero: Tabla hija para control de últimos números utilizados
    - Tipo Comprobante AFIP: DocType principal para tipos de comprobante AFIP
    - Talonario: DocType principal para gestión de talonarios

    Args:
        session: Sesión de requests autenticada
        headers: Headers con autenticación para ERPNext
        ERPNEXT_URL: URL base de la instancia de ERPNext

    Returns:
        Response JSON con resultado de la operación
    """
    try:
        print("Iniciando creación de DocTypes para AFIP...")

        # Crear DocType 'Talonario Letra' (Tabla hija para letras)
        print("Verificando/Creando DocType 'Talonario Letra'... (Tabla hija)")
        talonario_letra_doctype_data = {
            "data": {
                "doctype": "DocType",
                "name": "Talonario Letra",
                "module": "Accounts",
                "custom": 1,
                "istable": 1,  # Indica que es una tabla hija
                "fields": [
                    {
                        "fieldname": "letra",
                        "label": "Letra",
                        "fieldtype": "Select",
                        "options": "A\nB\nC\nE\nM\nX\nT\nR",
                        "reqd": 1
                    },
                    {
                        "fieldname": "descripcion",
                        "label": "Descripción",
                        "fieldtype": "Data"
                    }
                ]
            }
        }

        if check_doctype_exists(session, headers, "Talonario Letra", ERPNEXT_URL):
            print("DocType 'Talonario Letra' ya existe, actualizando...")
            talonario_letra_response, talonario_letra_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint="/api/resource/DocType/Talonario Letra",
                data=talonario_letra_doctype_data,
                operation_name="Update DocType 'Talonario Letra'"
            )
        else:
            print("DocType 'Talonario Letra' no existe, creando...")
            talonario_letra_response, talonario_letra_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/DocType",
                data=talonario_letra_doctype_data,
                operation_name="Create DocType 'Talonario Letra'"
            )

        if talonario_letra_error:
            print(f"Error creando/actualizando DocType Talonario Letra: {talonario_letra_error}")
            return handle_erpnext_error(talonario_letra_error, "Failed to create/update DocType Talonario Letra")

        if talonario_letra_response.status_code not in [200, 201, 202]:
            print(f"Error creando/actualizando DocType Talonario Letra: {talonario_letra_response.status_code} - {talonario_letra_response.text}")
            return jsonify({"success": False, "message": f"Error creando/actualizando DocType Talonario Letra: {talonario_letra_response.text}"}), 400

        # Crear DocType 'Talonario Comprobante' (Tabla hija para tipos de comprobantes AFIP)
        print("Verificando/Creando DocType 'Talonario Comprobante'... (Tabla hija)")
        talonario_comprobante_doctype_data = {
            "data": {
                "doctype": "DocType",
                "name": "Talonario Comprobante",
                "module": "Accounts",
                "custom": 1,
                "istable": 1,  # Indica que es una tabla hija
                "fields": [
                    {
                        "fieldname": "tipo_documento",
                        "label": "Tipo Documento",
                        "fieldtype": "Select",
                        "options": "FAC\nNCC\nNDB\nREC\nREM\nORD",
                        "reqd": 1
                    },
                    {
                        "fieldname": "codigo_afip",
                        "label": "Código AFIP",
                        "fieldtype": "Int",
                        "reqd": 1
                    },
                    {
                        "fieldname": "descripcion",
                        "label": "Descripción",
                        "fieldtype": "Data"
                    }
                ]
            }
        }

        if check_doctype_exists(session, headers, "Talonario Comprobante", ERPNEXT_URL):
            print("DocType 'Talonario Comprobante' ya existe, actualizando...")
            talonario_comprobante_response, talonario_comprobante_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint="/api/resource/DocType/Talonario Comprobante",
                data=talonario_comprobante_doctype_data,
                operation_name="Update DocType 'Talonario Comprobante'"
            )
        else:
            print("DocType 'Talonario Comprobante' no existe, creando...")
            talonario_comprobante_response, talonario_comprobante_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/DocType",
                data=talonario_comprobante_doctype_data,
                operation_name="Create DocType 'Talonario Comprobante'"
            )

        if talonario_comprobante_error:
            print(f"Error creando/actualizando DocType Talonario Comprobante: {talonario_comprobante_error}")
            return handle_erpnext_error(talonario_comprobante_error, "Failed to create/update DocType Talonario Comprobante")

        if talonario_comprobante_response.status_code not in [200, 201, 202]:
            print(f"Error creando/actualizando DocType Talonario Comprobante: {talonario_comprobante_response.status_code} - {talonario_comprobante_response.text}")
            return jsonify({"success": False, "message": f"Error creando/actualizando DocType Talonario Comprobante: {talonario_comprobante_response.text}"}), 400

        # Crear DocType 'Talonario Ultimo Numero' (Tabla hija para últimos números utilizados)
        print("Verificando/Creando DocType 'Talonario Ultimo Numero'... (Tabla hija)")
        talonario_ultimo_numero_doctype_data = {
            "data": {
                "doctype": "DocType",
                "name": "Talonario Ultimo Numero",
                "module": "Accounts",
                "custom": 1,
                "istable": 1,  # Indica que es una tabla hija
                "fields": [
                    {
                        "fieldname": "tipo_documento",
                        "label": "Tipo Documento",
                        "fieldtype": "Select",
                        "options": "FAC\nNCC\nNDB\nREC\nREM\nORD",
                        "reqd": 1
                    },
                    {
                        "fieldname": "letra",
                        "label": "Letra",
                        "fieldtype": "Select",
                        "options": "A\nB\nC\nE\nM\nX\nT\nR",
                        "reqd": 1
                    },
                    {
                        "fieldname": "ultimo_numero_utilizado",
                        "label": "Último Número Utilizado",
                        "fieldtype": "Int",
                        "default": 0
                    },
                    {
                        "fieldname": "metodo_numeracion",
                        "label": "Método de Numeración",
                        "fieldtype": "Data",
                        "read_only": 1
                    }
                ]
            }
        }

        if check_doctype_exists(session, headers, "Talonario Ultimo Numero", ERPNEXT_URL):
            print("DocType 'Talonario Ultimo Numero' ya existe, actualizando...")
            talonario_ultimo_numero_response, talonario_ultimo_numero_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint="/api/resource/DocType/Talonario Ultimo Numero",
                data=talonario_ultimo_numero_doctype_data,
                operation_name="Update DocType 'Talonario Ultimo Numero'"
            )
        else:
            print("DocType 'Talonario Ultimo Numero' no existe, creando...")
            talonario_ultimo_numero_response, talonario_ultimo_numero_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/DocType",
                data=talonario_ultimo_numero_doctype_data,
                operation_name="Create DocType 'Talonario Ultimo Numero'"
            )

        if talonario_ultimo_numero_error:
            print(f"Error creando/actualizando DocType Talonario Ultimo Numero: {talonario_ultimo_numero_error}")
            return handle_erpnext_error(talonario_ultimo_numero_error, "Failed to create/update DocType Talonario Ultimo Numero")

        if talonario_ultimo_numero_response.status_code not in [200, 201, 202]:
            print(f"Error creando/actualizando DocType Talonario Ultimo Numero: {talonario_ultimo_numero_response.status_code} - {talonario_ultimo_numero_response.text}")
            return jsonify({"success": False, "message": f"Error creando/actualizando DocType Talonario Ultimo Numero: {talonario_ultimo_numero_response.text}"}), 400

        # Crear DocType 'Tipo Comprobante AFIP' (DocType principal para tipos de comprobante)
        print("Verificando/Creando DocType 'Tipo Comprobante AFIP'...")
        tipo_comprobante_afip_doctype_data = {
            "data": {
                "doctype": "DocType",
                "name": "Tipo Comprobante AFIP",
                "module": "Accounts",
                "custom": 1,
                "autoname": "field:codigo",
                "permissions": [
                    {
                        "role": "System Manager",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 1,
                        "print": 1,
                        "email": 1,
                        "share": 1,
                        "set_user_permissions": 1
                    },
                    {
                        "role": "Administrator",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 1,
                        "print": 1,
                        "email": 1,
                        "share": 1
                    },
                    {
                        "role": "Purchase Manager",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 0,
                        "print": 1,
                        "email": 1
                    },
                    {
                        "role": "Purchase User",
                        "permlevel": 0,
                        "read": 1,
                        "write": 0,
                        "create": 0,
                        "delete": 0,
                        "print": 1,
                        "email": 1
                    },
                    {
                        "role": "Sales Manager",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 0,
                        "print": 1,
                        "email": 1
                    },
                    {
                        "role": "Sales User",
                        "permlevel": 0,
                        "read": 1,
                        "write": 0,
                        "create": 0,
                        "delete": 0,
                        "print": 1,
                        "email": 1
                    }
                ],
                "fields": [
                    {
                        "fieldname": "codigo",
                        "label": "Código",
                        "fieldtype": "Data",
                        "reqd": 1,
                        "unique": 1
                    },
                    {
                        "fieldname": "descripcion",
                        "label": "Descripción",
                        "fieldtype": "Data",
                        "reqd": 1
                    },
                    {
                        "fieldname": "codigo_afip",
                        "label": "Código AFIP",
                        "fieldtype": "Int",
                        "reqd": 1
                    },
                    {
                        "fieldname": "tipo_documento",
                        "label": "Tipo Documento",
                        "fieldtype": "Select",
                        "options": "FAC\nNCC\nNDB\nREC\nREM\nORD",
                        "reqd": 1
                    },
                    {
                        "fieldname": "letra",
                        "label": "Letra",
                        "fieldtype": "Select",
                        "options": "A\nB\nC\nE\nM\nX\nT\nR",
                        "reqd": 1
                    },
                    {
                        "fieldname": "activo",
                        "label": "Activo",
                        "fieldtype": "Check",
                        "default": 1
                    }
                ]
            }
        }

        if check_doctype_exists(session, headers, "Tipo Comprobante AFIP", ERPNEXT_URL):
            print("DocType 'Tipo Comprobante AFIP' ya existe, actualizando...")
            tipo_comprobante_afip_response, tipo_comprobante_afip_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint="/api/resource/DocType/Tipo Comprobante AFIP",
                data=tipo_comprobante_afip_doctype_data,
                operation_name="Update DocType 'Tipo Comprobante AFIP'"
            )
        else:
            print("DocType 'Tipo Comprobante AFIP' no existe, creando...")
            tipo_comprobante_afip_response, tipo_comprobante_afip_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/DocType",
                data=tipo_comprobante_afip_doctype_data,
                operation_name="Create DocType 'Tipo Comprobante AFIP'"
            )

        if tipo_comprobante_afip_error:
            print(f"Error creando/actualizando DocType Tipo Comprobante AFIP: {tipo_comprobante_afip_error}")
            return handle_erpnext_error(tipo_comprobante_afip_error, "Failed to create/update DocType Tipo Comprobante AFIP")

        if tipo_comprobante_afip_response.status_code not in [200, 201, 202]:
            print(f"Error creando/actualizando DocType Tipo Comprobante AFIP: {tipo_comprobante_afip_response.status_code} - {tipo_comprobante_afip_response.text}")
            return jsonify({"success": False, "message": f"Error creando/actualizando DocType Tipo Comprobante AFIP: {tipo_comprobante_afip_response.text}"}), 400

        # Definir datos del DocType Talonario
        talonario_doctype_data = {
            "data": {
                "doctype": "DocType",
                "name": "Talonario",
                "module": "Accounts",
                "custom": 1,
                "autoname": "format:TAL-{punto_de_venta}-{#####}",
                "is_submittable": 1,
                "permissions": [
                    {
                        "role": "System Manager",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 1,
                        "submit": 1,
                        "print": 1,
                        "email": 1,
                        "share": 1,
                        "set_user_permissions": 1
                    },
                    {
                        "role": "Administrator",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 1,
                        "submit": 1,
                        "print": 1,
                        "email": 1,
                        "share": 1
                    },
                    {
                        "role": "Purchase Manager",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 0,
                        "submit": 1,
                        "print": 1,
                        "email": 1
                    },
                    {
                        "role": "Purchase User",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 0,
                        "delete": 0,
                        "submit": 0,
                        "print": 1,
                        "email": 1
                    },
                    {
                        "role": "Sales Manager",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 0,
                        "submit": 1,
                        "print": 1,
                        "email": 1
                    },
                    {
                        "role": "Sales User",
                        "permlevel": 0,
                        "read": 1,
                        "write": 0,
                        "create": 0,
                        "delete": 0,
                        "submit": 0,
                        "print": 1,
                        "email": 1
                    }
                ],
                "fields": [
                    {
                        "fieldname": "punto_de_venta",
                        "label": "Punto de Venta",
                        "fieldtype": "Data",
                        "reqd": 1
                    },
                    {
                        "fieldname": "letras",
                        "label": "Letras",
                        "fieldtype": "Table",
                        "options": "Talonario Letra",
                        "reqd": 1
                    },
                    {
                        "fieldname": "letras_json",
                        "label": "Letras (cache)",
                        "fieldtype": "JSON",
                        "description": "Lista de letras del talonario en formato JSON para consultas rápidas"
                    },
                    {
                        "fieldname": "tipo_de_comprobante_afip",
                        "label": "Tipos de Comprobante AFIP",
                        "fieldtype": "Table",
                        "options": "Talonario Comprobante",
                        "reqd": 1
                    },
                    {
                        "fieldname": "ultimos_numeros",
                        "label": "Últimos Números Utilizados",
                        "fieldtype": "Table",
                        "options": "Talonario Ultimo Numero",
                        "description": "Control de últimos números por tipo de documento y letra"
                    },
                    {
                        "fieldname": "tipo_de_talonario",
                        "label": "Tipo de Talonario",
                        "fieldtype": "Select",
                        "options": "FACTURA ELECTRONICA\nREMITOS ELECTRONICOS\nCOMPROBANTES DE EXPORTACION ELECTRONICOS\nREMITOS\nTALONARIOS DE RESGUARDO\nTICKETEADORA FISCAL\nRECIBOS\nORDENES DE COMPRA",
                        "reqd": 1
                    },
                    {
                        "fieldname": "descripcion",
                        "label": "Descripción Talonario",
                        "fieldtype": "Data"
                    },
                    {
                        "fieldname": "numero_de_inicio",
                        "label": "Número de Inicio",
                        "fieldtype": "Int"
                    },
                    {
                        "fieldname": "numero_de_fin",
                        "label": "Número de Fin",
                        "fieldtype": "Int"
                    },
                    {
                        "fieldname": "tipo_numeracion",
                        "label": "Tipo de Numeración",
                        "fieldtype": "Select",
                        "options": "Automática\nManual"
                    },
                    {
                        "fieldname": "por_defecto",
                        "label": "Talonario por defecto",
                        "fieldtype": "Check"
                    },
                    {
                        "fieldname": "factura_electronica",
                        "label": "Factura Electrónica",
                        "fieldtype": "Check"
                    },
                    {
                        "fieldname": "compania",
                        "label": "Compañía",
                        "fieldtype": "Link",
                        "options": "Company",
                        "reqd": 1
                    },
                    {
                        "fieldname": "metodo_numeracion_factura_venta",
                        "label": "Método Numeración Factura Venta",
                        "fieldtype": "Data",
                        "description": "Formato: FE-FAC-A-00001-00000001"
                    },
                    {
                        "fieldname": "metodo_numeracion_nota_debito",
                        "label": "Método Numeración Nota Débito",
                        "fieldtype": "Data",
                        "description": "Formato: FE-NDB-A-00001-00000001"
                    },
                    {
                        "fieldname": "metodo_numeracion_nota_credito",
                        "label": "Método Numeración Nota Crédito",
                        "fieldtype": "Data",
                        "description": "Formato: FE-NCC-A-00001-00000001"
                    }
                ]
            }
        }

        if check_doctype_exists(session, headers, "Talonario", ERPNEXT_URL):
            print("DocType 'Talonario' ya existe, actualizando...")
            talonario_response, talonario_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint="/api/resource/DocType/Talonario",
                data=talonario_doctype_data,
                operation_name="Update DocType 'Talonario'"
            )
        else:
            print("DocType 'Talonario' no existe, creando...")
            talonario_response, talonario_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/DocType",
                data=talonario_doctype_data,
                operation_name="Create DocType 'Talonario'"
            )

        if talonario_error:
            print(f"Error creando/actualizando DocType Talonario: {talonario_error}")
            return handle_erpnext_error(talonario_error, "Failed to create/update DocType Talonario")

        if talonario_response.status_code not in [200, 201, 202]:
            print(f"Error creando/actualizando DocType Talonario: {talonario_response.status_code} - {talonario_response.text}")
            return jsonify({"success": False, "message": f"Error creando/actualizando DocType Talonario: {talonario_response.text}"}), 400

        # Actualizar específicamente las opciones del campo tipo_de_talonario si el DocType ya existía
        if check_doctype_exists(session, headers, "Talonario", ERPNEXT_URL):
            print("Actualizando opciones del campo 'tipo_de_talonario' en DocType Talonario...")
            try:
                # Obtener el DocType actual para encontrar el campo tipo_de_talonario
                doctype_response, doctype_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/DocType/Talonario",
                    operation_name="Get DocType Talonario for field options update"
                )

                if doctype_error:
                    print(f"Error obteniendo DocType Talonario para actualizar opciones: {doctype_error}")
                elif doctype_response.status_code == 200:
                    doctype_data = doctype_response.json()['data']

                    # Encontrar y actualizar el campo tipo_de_talonario
                    for field in doctype_data.get('fields', []):
                        if field.get('fieldname') == 'tipo_de_talonario':
                            field['options'] = "FACTURA ELECTRONICA\nREMITOS ELECTRONICOS\nCOMPROBANTES DE EXPORTACION ELECTRONICOS\nREMITOS\nTALONARIOS DE RESGUARDO\nTICKETEADORA FISCAL\nRECIBOS\nORDENES DE COMPRA"
                            break

                    # Actualizar el DocType con las nuevas opciones
                    update_response, update_error = make_erpnext_request(
                        session=session,
                        method="PUT",
                        endpoint="/api/resource/DocType/Talonario",
                        data={"data": doctype_data},
                        operation_name="Update DocType Talonario field options"
                    )

                    if update_error:
                        print(f"Error actualizando opciones del campo: {update_error}")
                    elif update_response.status_code in [200, 202]:
                        print("Opciones del campo 'tipo_de_talonario' actualizadas exitosamente")
                    else:
                        print(f"Error actualizando opciones del campo: {update_response.status_code} - {update_response.text}")
                else:
                    print(f"Error obteniendo DocType Talonario para actualizar opciones: {doctype_response.status_code}")
            except Exception as e:
                print(f"Error actualizando opciones del campo tipo_de_talonario: {str(e)}")

        print("DocTypes para AFIP verificados/creados exitosamente")
        # Crear DocType 'Tax Account Map' para mapear percepciones/retenciones a cuentas por empresa
        print("Verificando/Creando DocType 'Tax Account Map' (mapeo cuentas impuestos)...")
        tax_map_doctype_data = {
            "data": {
                "doctype": "DocType",
                "name": "Tax Account Map",
                "module": "Accounts",
                "custom": 1,
                "autoname": "format:{company}-{perception_type}-{transaction_type}-{account_number}",
                "permissions": [
                    {
                        "role": "System Manager",
                        "permlevel": 0,
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 1,
                        "print": 1,
                        "email": 1,
                        "share": 1,
                        "set_user_permissions": 1
                    }
                ],
                "fields": [
                    { "fieldname": "company",          "label": "Company",          "fieldtype": "Link",  "options": "Company", "reqd": 1 },
                    { "fieldname": "transaction_type", "label": "Transaction Type", "fieldtype": "Select","options": "purchase\nsale", "reqd": 1 },
                    { "fieldname": "perception_type",  "label": "Perception Type",  "fieldtype": "Select","options": "PERCEPCION_IIBB\nRETENCION_IIBB\nPERCEPCION_IVA\nRETENCION_IVA\nPERCEPCION_GANANCIAS\nRETENCION_GANANCIAS", "reqd": 1 },
                    { "fieldname": "province_code",    "label": "Province Code",    "fieldtype": "Data" },
                    { "fieldname": "regimen_code",     "label": "Regimen Code",     "fieldtype": "Data" },
                    { "fieldname": "rate_percent",     "label": "Rate Percent",     "fieldtype": "Float" },
                    { "fieldname": "account",          "label": "Account",          "fieldtype": "Link",  "options": "Account", "reqd": 1 },
                    { "fieldname": "account_number",   "label": "Account Number",   "fieldtype": "Data",  "read_only": 1 },
                    { "fieldname": "description",      "label": "Description",      "fieldtype": "Data" },
                    { "fieldname": "active",           "label": "Active",           "fieldtype": "Check", "default": 1 }
                ]
            }
        }

        if check_doctype_exists(session, headers, "Tax Account Map", ERPNEXT_URL):
            print("DocType 'Tax Account Map' ya existe, actualizando...")
            tax_map_response, tax_map_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint="/api/resource/DocType/Tax Account Map",
                data=tax_map_doctype_data,
                operation_name="Update DocType 'Tax Account Map'"
            )
        else:
            print("DocType 'Tax Account Map' no existe, creando...")
            tax_map_response, tax_map_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/DocType",
                data=tax_map_doctype_data,
                operation_name="Create DocType 'Tax Account Map'"
            )

        if tax_map_error:
            print(f"Error creando/actualizando DocType Tax Account Map: {tax_map_error}")
            return handle_erpnext_error(tax_map_error, "Failed to create/update DocType Tax Account Map")

        if tax_map_response.status_code not in [200, 201, 202]:
            print(f"Error creando/actualizando DocType Tax Account Map: {tax_map_response.status_code} - {tax_map_response.text}")
            return jsonify({"success": False, "message": f"Error creando/actualizando DocType Tax Account Map: {tax_map_response.text}"}), 400
        else:
            print("DocType 'Tax Account Map' creado/actualizado con autoname simplificado para evitar validaciones por campos opcionales.")
        # Bootstrap default Tax Account Map records after creating the DocType
        try:
            bootstrap_result = ensure_tax_account_map_defaults(session, headers, ERPNEXT_URL, user_id=user_id)
            print('Tax Account Map bootstrap result:', bootstrap_result)
        except Exception as ex:
            print('Error bootstrapping Tax Account Map defaults:', str(ex))

        return jsonify({
            "success": True,
            "message": "DocTypes para AFIP verificados/creados exitosamente",
            "tax_account_map_bootstrap": bootstrap_result if 'bootstrap_result' in locals() else None
        })

    except Exception as e:
        print(f"Error creando DocTypes para AFIP: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
