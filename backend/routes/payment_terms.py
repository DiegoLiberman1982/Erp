from flask import Blueprint, request, jsonify
import requests
import traceback
from urllib.parse import quote
import json

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar funciones de companies.py para evitar duplicación
from routes.companies import load_active_companies

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para las rutas de condiciones de pago
payment_terms_bp = Blueprint('payment_terms', __name__)

@payment_terms_bp.route('/api/payment-terms-templates', methods=['GET'])
def get_payment_terms_templates():
    """Obtiene la lista de plantillas de condiciones de pago desde ERPNext"""
    print("\n--- Petición de obtener plantillas de condiciones de pago recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500


        # Obtener plantillas desde ERPNext
        # Extract fields to avoid nested quotes in f-string
        fields_str = '["name","template_name","terms"]'

        templates_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Payment Terms Template",
            params={
                "fields": fields_str,
                "limit_page_length": 1000
            },
            operation_name="Get payment terms templates"
        )

        if error:
            print("❌ Error obteniendo plantillas")
            return handle_erpnext_error(error, "Failed to fetch payment terms templates")

        print(f"Respuesta de ERPNext: {templates_response.status_code}")

        if templates_response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif templates_response.status_code != 200:
            return jsonify({"success": False, "message": f"Error obteniendo plantillas: {templates_response.text}"}), 400

        templates_data = templates_response.json()
        templates = templates_data.get("data", [])

        print(f"Plantillas obtenidas: {len(templates)}")
        if templates:
            print(f"Primera plantilla: {templates[0]}")

        return jsonify({"success": True, "data": templates, "message": "Plantillas obtenidas correctamente"})

    except Exception as e:
        print(f"ERROR GENERAL en get_payment_terms_templates: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": f"Error HTTP: {err.response.text}"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión"}), 500

@payment_terms_bp.route('/api/payment-terms-templates', methods=['POST'])
def create_payment_terms_template():
    """Crea una nueva plantilla de condiciones de pago en ERPNext"""
    print("\n--- Petición de crear plantilla de condiciones de pago recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos de la plantilla a crear
    template_data = request.get_json()
    print(f"Datos de la plantilla a crear: {template_data}")

    if not template_data or 'data' not in template_data:
        return jsonify({"success": False, "message": "Datos de plantilla requeridos"}), 400

    try:
        print(f"Creando plantilla en ERPNext...")
        print(f"Usando SID token: {request.headers.get('X-Session-Token')[:10]}...")

        # Crear la plantilla en ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Payment Terms Template",
            data=template_data,
            operation_name="Create payment terms template"
        )

        if error:
            print("❌ Error creando plantilla")
            return handle_erpnext_error(error, "Failed to create payment terms template")

        print(f"Respuesta de ERPNext: {response.status_code}")

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 409:
            return jsonify({"success": False, "message": "La plantilla ya existe"}), 409
        elif response.status_code != 200:
            print(f"Error creando plantilla: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error creando plantilla: {response.text}"}), 400

        # ERPNext devuelve los datos de la plantilla creada
        created_template_data = response.json()

        print(f"Plantilla creada exitosamente: {created_template_data.get('data', {}).get('name')}")

        return jsonify({"success": True, "data": created_template_data.get("data", {}), "message": "Plantilla creada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        try:
            error_data = err.response.json()
            return jsonify({"success": False, "message": error_data.get('message', 'Error desconocido')}), 500
        except:
            return jsonify({"success": False, "message": f"Error HTTP: {err.response.text}"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión"}), 500

@payment_terms_bp.route('/api/payment-terms-templates/<path:template_name>', methods=['GET'])
def get_payment_terms_template(template_name):
    """Obtiene los detalles de una plantilla específica desde ERPNext"""
    print(f"\n--- Petición de obtener plantilla '{template_name}' recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        print(f"Obteniendo plantilla '{template_name}' desde ERPNext...")

        # Obtener la plantilla desde ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Payment Terms Template/{quote(template_name)}",
            operation_name=f"Get payment terms template '{template_name}'"
        )

        if error:
            print("❌ Error obteniendo plantilla")
            return handle_erpnext_error(error, "Failed to fetch payment terms template")

        print(f"Respuesta de ERPNext: {response.status_code}")

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Plantilla no encontrada"}), 404
        elif response.status_code != 200:
            return jsonify({"success": False, "message": f"Error obteniendo plantilla: {response.text}"}), 400

        template_data = response.json()
        template_info = template_data.get("data", {})

        print(f"Plantilla '{template_name}' obtenida exitosamente")

        return jsonify({"success": True, "data": template_info, "message": "Plantilla obtenida correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": f"Error HTTP: {err.response.text}"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión"}), 500

@payment_terms_bp.route('/api/payment-terms-templates/<path:template_name>', methods=['PUT'])
def update_payment_terms_template(template_name):
    """Actualiza una plantilla de condiciones de pago específica en ERPNext"""
    print(f"\n--- Petición de actualizar plantilla '{template_name}' recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    # Obtener los datos a actualizar del body de la petición
    update_data = request.get_json()
    print(f"Datos a actualizar: {update_data}")

    if not update_data or 'data' not in update_data:
        return jsonify({"success": False, "message": "Datos de actualización requeridos"}), 400

    try:
        print(f"Actualizando plantilla '{template_name}' en ERPNext...")

        # Actualizar la plantilla en ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Payment Terms Template/{quote(template_name)}",
            data=update_data,
            operation_name=f"Update payment terms template '{template_name}'"
        )

        if error:
            print("❌ Error actualizando plantilla")
            return handle_erpnext_error(error, "Failed to update payment terms template")

        print(f"Respuesta de ERPNext: {response.status_code}")

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Plantilla no encontrada"}), 404
        elif response.status_code != 200:
            print(f"Error actualizando plantilla: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error actualizando plantilla: {response.text}"}), 400

        # ERPNext devuelve los datos de la plantilla actualizada
        updated_template_data = response.json()

        print(f"Plantilla '{template_name}' actualizada exitosamente")

        return jsonify({"success": True, "data": updated_template_data.get("data", {}), "message": "Plantilla actualizada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        try:
            error_data = err.response.json()
            return jsonify({"success": False, "message": error_data.get('message', 'Error desconocido')}), 500
        except:
            return jsonify({"success": False, "message": f"Error HTTP: {err.response.text}"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión"}), 500

@payment_terms_bp.route('/api/payment-terms-templates/<path:template_name>', methods=['DELETE'])
def delete_payment_terms_template(template_name):
    """Elimina una plantilla de condiciones de pago específica de ERPNext"""
    print(f"\n--- Petición de eliminar plantilla '{template_name}' recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        print(f"Eliminando plantilla '{template_name}' de ERPNext...")

        # Eliminar la plantilla de ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Payment Terms Template/{quote(template_name)}",
            operation_name=f"Delete payment terms template '{template_name}'"
        )

        if error:
            print("❌ Error eliminando plantilla")
            return handle_erpnext_error(error, "Failed to delete payment terms template")

        print(f"Respuesta de ERPNext: {response.status_code}")

        if response.status_code == 401:
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif response.status_code == 404:
            return jsonify({"success": False, "message": "Plantilla no encontrada"}), 404
        elif response.status_code != 200:
            print(f"Error eliminando plantilla: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error eliminando plantilla: {response.text}"}), 400

        print(f"Plantilla '{template_name}' eliminada exitosamente")

        return jsonify({"success": True, "message": "Plantilla eliminada correctamente"})

    except requests.exceptions.HTTPError as err:
        print(f"Error HTTP de ERPNext: {err.response.status_code} - Respuesta: {err.response.text}")
        return jsonify({"success": False, "message": f"Error HTTP: {err.response.text}"}), 500
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión: {e}")
        return jsonify({"success": False, "message": "Error de conexión"}), 500

@payment_terms_bp.route('/api/create-standard-payment-terms', methods=['POST'])
def create_standard_payment_terms():
    """Crea las plantillas estándar de condiciones de pago (30, 60, 90, 120, 180 días)"""
    print("\n--- Creando plantillas estándar de condiciones de pago ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Definir las plantillas estándar
        standard_templates = [
            {"template_name": "Contado", "credit_days": 0},
            {"template_name": "30 Días Netos", "credit_days": 30},
            {"template_name": "60 Días Netos", "credit_days": 60},
            {"template_name": "90 Días Netos", "credit_days": 90},
            {"template_name": "120 Días Netos", "credit_days": 120},
            {"template_name": "180 Días Netos", "credit_days": 180}
        ]

        created_templates = []
        errors = []

        for template in standard_templates:
            try:
                # Primero verificar si la plantilla ya existe para evitar DuplicateEntryError (409)
                check_params = {
                    "filters": json.dumps([["template_name", "=", template["template_name"]]]),
                    "limit_page_length": 1
                }
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Payment Terms Template",
                    params=check_params,
                    operation_name=f"Check payment terms template '{template['template_name']}'"
                )

                if check_err:
                    # Si hubo error al verificar existencia, lo registramos y saltamos esta plantilla
                    err_msg = f"Error verificando existencia de '{template['template_name']}': {check_err}"
                    print(err_msg)
                    errors.append(err_msg)
                    continue

                if check_resp and check_resp.status_code == 200 and check_resp.json().get('data'):
                    # Ya existe, registrar y continuar
                    print(f"Plantilla '{template['template_name']}' ya existe, saltando creación")
                    created_templates.append({"name": template["template_name"], "exists": True})
                    continue

                template_data = {
                    "data": {
                        "template_name": template["template_name"],
                        "terms": [
                            {
                                "credit_days": template["credit_days"],
                                "invoice_portion": 100
                            }
                        ]
                    }
                }

                print(f"Creando plantilla: {template['template_name']}")

                response, error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Payment Terms Template",
                    data=template_data,
                    operation_name=f"Create standard payment terms template '{template['template_name']}'"
                )

                if error:
                    error_msg = f"Error creando '{template['template_name']}': {error}"
                    errors.append(error_msg)
                    print(f"❌ {error_msg}")
                    continue

                if response.status_code == 200:
                    created_template = response.json().get('data', {})
                    created_templates.append(created_template)
                elif response.status_code == 409:
                    created_templates.append({"name": template["template_name"], "exists": True})
                else:
                    error_msg = f"Error creando '{template['template_name']}': {response.text}"
                    errors.append(error_msg)
                    print(f"❌ {error_msg}")

            except Exception as e:
                error_msg = f"Error creando '{template['template_name']}': {str(e)}"
                errors.append(error_msg)
                print(f"❌ {error_msg}")

        result = {
            "success": len(created_templates) > 0,
            "created": created_templates,
            "errors": errors,
            "message": f"Se crearon {len(created_templates)} plantillas estándar"
        }

        if errors:
            result["message"] += f" con {len(errors)} errores"

        return jsonify(result)

    except Exception as e:
        print(f"ERROR GENERAL en create_standard_payment_terms: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500
    

@payment_terms_bp.route('/api/payment-terms-list-with-details', methods=['GET'])
def get_payment_terms_list_with_details():
    """
    Obtiene la lista de plantillas de condiciones de pago
    incluyendo los detalles de la tabla hija 'terms' haciendo consultas individuales.
    """

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # 1. Obtener la lista de plantillas
        # Extract fields to avoid nested quotes in f-string
        fields_str = '["name","template_name"]'

        templates_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Payment Terms Template",
            params={
                "fields": fields_str,
                "limit_page_length": 1000
            },
            operation_name="Get payment terms templates list"
        )

        if error:
            print("❌ Error obteniendo lista de plantillas")
            return handle_erpnext_error(error, "Failed to fetch payment terms templates list")

        if templates_response.status_code != 200:
            print(f"❌ Error obteniendo lista de plantillas: {templates_response.status_code} - {templates_response.text}")
            return jsonify({"success": False, "message": f"Error obteniendo lista de plantillas: {templates_response.text}"}), 400

        templates = templates_response.json().get("data", [])

        # 2. Obtener en bloque los detalles de las tablas hijas 'terms' usando frappe.client.get_list
        # Recolectar todos los nombres de plantilla para usarlos en el filtro 'parent in'
        template_names = [t.get('name') for t in templates if t.get('name')]

        detailed_templates = []
        if template_names:
            try:
                # Campos que necesitamos del child table 'Payment Terms Template Detail'
                child_payload = {
                    "doctype": "Payment Terms Template Detail",
                    "parent": "Payment Terms Template",
                    "fields": [
                        "name",
                        "parent",
                        "invoice_portion",
                        "due_date_based_on",
                        "credit_days",
                        "credit_months",
                        "discount_type",
                        "discount",
                        "discount_validity_based_on",
                        "discount_validity",
                        "idx"
                    ],
                    "filters": {
                        "parent": ["in", template_names],
                        "parenttype": "Payment Terms Template",
                        "parentfield": "terms"
                    },
                    "limit_page_length": 10000
                }

                child_response, child_error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.get_list",
                    data=child_payload,
                    operation_name="Bulk fetch Payment Terms Template Detail"
                )

                if child_error:
                    print(f"❌ Error obteniendo detalles de child tables: {child_error}")
                elif child_response.status_code == 200:
                    # frappe.client.get_list devuelve los rows en 'message'
                    child_rows = child_response.json().get('message', [])
                    # Agrupar por parent
                    child_map = {}
                    for r in child_rows:
                        parent = r.get('parent')
                        if parent:
                            child_map.setdefault(parent, []).append(r)

                    # Construir la lista detallada combinando la info básica con los child rows
                    for t in templates:
                        name = t.get('name')
                        full = {**t}
                        full['terms'] = child_map.get(name, [])
                        detailed_templates.append(full)
                else:
                    print(f"❌ Error en respuesta al traer child rows: {child_response.status_code} - {child_response.text}")
                    # Fallback: devolver al menos las plantillas básicas
                    detailed_templates = templates

            except Exception as e:
                print(f"ERROR procesando child rows en bloque: {e}")
                detailed_templates = templates
        else:
            # No hay plantillas
            detailed_templates = []

        return jsonify({"success": True, "data": detailed_templates, "message": "Plantillas con detalles obtenidas correctamente"})

    except Exception as e:
        print(f"ERROR GENERAL en get_payment_terms_list_with_details: {e}")
        return jsonify({"success": False, "message": "Error interno del servidor"}), 500

