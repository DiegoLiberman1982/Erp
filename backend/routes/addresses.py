from flask import Blueprint, jsonify, request
import requests
from config import ERPNEXT_URL, ERPNEXT_HOST
import json
from urllib.parse import quote
import logging

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

addresses_bp = Blueprint('addresses', __name__)

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@addresses_bp.route('/api/addresses/templates', methods=['POST'])
def create_address_template():
    """
    Crea un template de dirección en ERPNext

    Body esperado:
    {
        "country": "Argentina",
        "is_default": 1,
        "template": "{{ address_line1 }}<br>{{ city }}<br>{{ state }} {{ pincode }}<br>{{ country }}"
    }
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Datos requeridos"}), 400

        # Preparar datos para ERPNext
        template_data = {
            "country": data.get("country", "Argentina"),
            "is_default": data.get("is_default", 1),
            "template": data.get("template", "{{ address_line1 }}<br>{{ city }}<br>{{ state }} {{ pincode }}<br>{{ country }}")
        }

        # (no-op) template creation does not involve company-specific address_data

        # template creation does not involve company-specific address_data

        # Template creation has no company-address logic here

        # No company-address logic required here (template creation)

        # No company-address logic required here (template creation)

        # Hacer petición a ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Address Template",
            data={"data": template_data},
            operation_name="Create address template"
        )

        if error:
            logger.error(f"Error creando template: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al crear template: {error}"
            }), 500

        if response.status_code in [200, 201]:
            result = response.json()
            return jsonify({
                "success": True,
                "message": "Template de dirección creado exitosamente",
                "data": result.get("data", {})
            })
        else:
            logger.error(f"Error creando template: {response.status_code} - {response.text}")
            return jsonify({
                "success": False,
                "message": f"Error al crear template: {response.status_code}"
            }), response.status_code

    except Exception as e:
        logger.error(f"Error creando template de dirección: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500

@addresses_bp.route('/api/addresses', methods=['POST'])
def create_address():
    """
    Crea una nueva dirección en ERPNext

    Body esperado:
    {
        "address_title": "Cliente de Prueba (Principal)",
        "address_type": "Billing",
        "address_line1": "Av. Corrientes 1234, Piso 5",
        "city": "Ciudad Autónoma de Buenos Aires",
        "state": "Buenos Aires",
        "pincode": "C1000",
        "country": "Argentina",
        "link_doctype": "Customer",
        "link_name": "Nombre del Cliente"
    }
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Datos requeridos"}), 400

        # Preparar datos para ERPNext
        address_data = {
            "address_title": data.get("address_title"),
            "address_type": data.get("address_type", "Billing"),
            "address_line1": data.get("address_line1", ""),
            "city": data.get("city", ""),
            "state": data.get("state", ""),
            "pincode": data.get("pincode", ""),
            "country": data.get("country", "Argentina")
        }

        # Agregar links si se proporcionan (aceptamos lista 'links' o pareja link_doctype/link_name)
        if data.get("links") and isinstance(data.get("links"), list):
            address_data["links"] = data.get("links")
        elif data.get("link_doctype") and data.get("link_name"):
            address_data["links"] = [{
                "link_doctype": data["link_doctype"],
                "link_name": data["link_name"]
            }]

        # Soporte para flags y campos auxiliares (p.ej. marca de 'dirección de la compañía')
        if "is_primary" in data:
            address_data["is_primary"] = 1 if data.get("is_primary") else 0
        if "is_your_company_address" in data:
            address_data["is_your_company_address"] = 1 if data.get("is_your_company_address") else 0
        if "custom_type" in data:
            address_data["custom_type"] = data.get("custom_type")

        # Si la dirección va relacionada a una Company, intentar obtener la abbr y anexarla al título
        try:
            if ("links" in address_data and isinstance(address_data["links"], list)):
                for link in address_data["links"]:
                    if link.get("link_doctype") == 'Company' and link.get("link_name"):
                        company_name = link.get("link_name")
                        comp_resp, comp_err = make_erpnext_request(
                            session=session,
                            method="GET",
                            endpoint=f"/api/resource/Company/{quote(company_name)}",
                            params={"fields": json.dumps(["abbr"])},
                            operation_name=f"Get company abbr for {company_name}"
                        )
                        if comp_resp and comp_resp.status_code == 200:
                            comp_data = comp_resp.json().get("data", {})
                            abbr = comp_data.get("abbr")
                            if abbr:
                                if address_data.get("address_title"):
                                    if not address_data["address_title"].endswith(f" - {abbr}"):
                                        address_data["address_title"] = f"{address_data['address_title']} - {abbr}"
                                else:
                                    base_title = address_data.get("address_type", "Dirección")
                                    address_data["address_title"] = f"{base_title} - {abbr}"
                        break
        except Exception:
            pass

        # Hacer petición a ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Address",
            data={"data": address_data},
            operation_name="Create address"
        )

        if error:
            logger.error(f"Error creando dirección: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al crear dirección: {error}"
            }), 500

        if response.status_code in [200, 201]:
            result = response.json()
            return jsonify({
                "success": True,
                "message": "Dirección creada exitosamente",
                "data": result.get("data", {})
            })
        else:
            logger.error(f"Error creando dirección: {response.status_code} - {response.text}")
            return jsonify({
                "success": False,
                "message": f"Error al crear dirección: {response.status_code}"
            }), response.status_code

    except Exception as e:
        logger.error(f"Error creando dirección: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500

@addresses_bp.route('/api/addresses/<address_name>', methods=['PUT'])
def update_address(address_name):
    """
    Actualiza una dirección existente en ERPNext

    Args:
        address_name: Nombre de la dirección a actualizar

    Body esperado:
    {
        "address_title": "Cliente de Prueba (Principal)",
        "address_type": "Billing",
        "address_line1": "Av. Corrientes 1234, Piso 5",
        "city": "Ciudad Autónoma de Buenos Aires",
        "state": "Buenos Aires",
        "pincode": "C1000",
        "country": "Argentina"
    }
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Datos requeridos"}), 400

        # Preparar datos para ERPNext
        address_data = {}
        fields_to_update = [
            "address_title", "address_type", "address_line1", "address_line2",
            "city", "state", "pincode", "country", "phone", "email_id",
            # Additional metadata that may be relevant for company fiscal addresses
            "custom_type", "is_primary", "is_your_company_address", "links"
        ]

        for field in fields_to_update:
            if field in data:
                # Normalize boolean flags to 1/0 which ERPNext commonly expects
                if field in ("is_primary", "is_your_company_address"):
                    address_data[field] = 1 if data[field] else 0
                else:
                    address_data[field] = data[field]

        if not address_data:
            return jsonify({"success": False, "message": "No hay campos para actualizar"}), 400

        # Si se va a actualizar el link a una Company, verificar abbr para ajustar el título
        try:
            links_to_check = None
            if "links" in address_data and isinstance(address_data["links"], list):
                links_to_check = address_data["links"]
            else:
                if data.get("link_doctype") and data.get("link_name"):
                    links_to_check = [{"link_doctype": data.get("link_doctype"), "link_name": data.get("link_name")}]

            if links_to_check:
                for link in links_to_check:
                    if link.get("link_doctype") == 'Company' and link.get("link_name"):
                        company_name = link.get("link_name")
                        comp_resp, comp_err = make_erpnext_request(
                            session=session,
                            method="GET",
                            endpoint=f"/api/resource/Company/{quote(company_name)}",
                            params={"fields": json.dumps(["abbr"])},
                            operation_name=f"Get company abbr for {company_name}"
                        )
                        if comp_resp and comp_resp.status_code == 200:
                            comp_data = comp_resp.json().get("data", {})
                            abbr = comp_data.get("abbr")
                            if abbr and address_data.get("address_title"):
                                if not address_data["address_title"].endswith(f" - {abbr}"):
                                    address_data["address_title"] = f"{address_data['address_title']} - {abbr}"
                        break
        except Exception:
            pass

        # Hacer petición a ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Address/{address_name}",
            data={"data": address_data},
            operation_name=f"Update address '{address_name}'"
        )

        if error:
            logger.error(f"Error actualizando dirección: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al actualizar dirección: {error}"
            }), 500

        if response.status_code == 200:
            result = response.json()
            return jsonify({
                "success": True,
                "message": "Dirección actualizada exitosamente",
                "data": result.get("data", {})
            })
        else:
            logger.error(f"Error actualizando dirección: {response.status_code} - {response.text}")
            return jsonify({
                "success": False,
                "message": f"Error al actualizar dirección: {response.status_code}"
            }), response.status_code

    except Exception as e:
        logger.error(f"Error actualizando dirección: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500

@addresses_bp.route('/api/addresses/<address_name>', methods=['GET'])
def get_address(address_name):
    """
    Obtiene los detalles de una dirección específica

    Args:
        address_name: Nombre de la dirección
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Hacer petición a ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Address/{address_name}",
            operation_name=f"Get address '{address_name}'"
        )

        if error:
            logger.error(f"Error obteniendo dirección: {error}")
            return jsonify({
                "success": False,
                "message": f"Dirección no encontrada: {error}"
            }), 500

        if response.status_code == 200:
            result = response.json()
            return jsonify({
                "success": True,
                "data": result.get("data", {})
            })
        else:
            logger.error(f"Error obteniendo dirección: {response.status_code} - {response.text}")
            return jsonify({
                "success": False,
                "message": f"Dirección no encontrada: {response.status_code}"
            }), response.status_code

    except Exception as e:
        logger.error(f"Error obteniendo dirección: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500

@addresses_bp.route('/api/addresses', methods=['GET'])
def get_addresses():
    """
    Obtiene todas las direcciones o filtra por cliente

    Query params:
        customer: Nombre del cliente para filtrar direcciones
        limit: Número máximo de resultados (default: 20)
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        customer = request.args.get('customer')
        limit = request.args.get('limit', 20, type=int)

        # Hacer petición a ERPNext

        # Construir filtros usando sintaxis correcta de ERPNext
        params = {
            "fields": '["name","address_title","address_type","address_line1","address_line2","city","state","pincode","country","links"]',
            "limit": limit
        }

        if customer:
            filters = f'[["links","link_name","=","{customer}"],["links","link_doctype","=","Customer"]]'
            params["filters"] = filters

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Address",
            params=params,
            operation_name="Get addresses"
        )

        if error:
            logger.error(f"Error obteniendo direcciones: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al obtener direcciones: {error}"
            }), 500

        if response.status_code == 200:
            result = response.json()
            return jsonify({
                "success": True,
                "data": result.get("data", [])
            })
        else:
            logger.error(f"Error obteniendo direcciones: {response.status_code} - {response.text}")
            return jsonify({
                "success": False,
                "message": f"Error al obtener direcciones: {response.status_code}"
            }), response.status_code

    except Exception as e:
        logger.error(f"Error obteniendo direcciones: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500

@addresses_bp.route('/api/customers/<customer_name>/addresses', methods=['GET'])
def get_customer_addresses(customer_name):
    """
    Obtiene todas las direcciones vinculadas a un cliente específico

    Args:
        customer_name: Nombre del cliente
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Hacer petición a ERPNext para obtener direcciones del cliente

        # Obtener todas las direcciones primero (sin filtros complejos)
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Address",
            params={
                "fields": '["name","address_title","address_type","address_line1","address_line2","city","state","pincode","country"]',
                "limit": 100  # Aumentar límite para obtener más direcciones
            },
            operation_name="Get all addresses for customer filtering"
        )

        addresses = []
        if error:
            logger.error(f"Error obteniendo direcciones: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al obtener direcciones: {error}"
            }), 500

        if response.status_code == 200:
            result = response.json()
            all_addresses = result.get('data', [])

            # Para cada dirección, obtener los links por separado
            for addr in all_addresses:
                address_name = addr.get('name')

                # Obtener los links de esta dirección específica
                links_response, links_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Address/{address_name}",
                    operation_name=f"Get links for address '{address_name}'"
                )

                if links_error:
                    logger.error(f"Error obteniendo links para dirección {address_name}: {links_error}")
                    addr['links'] = []
                elif links_response.status_code == 200:
                    links_data = links_response.json()
                    addr['links'] = links_data.get('data', {}).get('links', [])
                else:
                    addr['links'] = []

            # Filtrar manualmente las direcciones que pertenecen al cliente
            for addr in all_addresses:
                links = addr.get('links', [])

                if isinstance(links, list):
                    for link in links:
                        if (isinstance(link, dict) and
                            link.get('link_doctype') == 'Customer' and
                            link.get('link_name') == customer_name):
                            addresses.append(addr)
                            break
                elif isinstance(links, dict):
                    if (links.get('link_doctype') == 'Customer' and
                        links.get('link_name') == customer_name):
                        addresses.append(addr)

        else:
            logger.error(f"Error obteniendo direcciones: {response.status_code}")
            logger.error(f"Response text: {response.text}")
            logger.error(f"Response headers: {response.headers}")

        if response.status_code == 200:
            return jsonify({
                "success": True,
                "data": addresses
            })
        else:
            return jsonify({
                "success": False,
                "message": f"Error al obtener direcciones: {response.status_code}"
            }), response.status_code

    except Exception as e:
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500

@addresses_bp.route('/api/addresses/<address_name>', methods=['DELETE'])
def delete_address(address_name):
    """
    Elimina una dirección

    Args:
        address_name: Nombre de la dirección a eliminar
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Hacer petición a ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Address/{address_name}",
            operation_name=f"Delete address '{address_name}'"
        )

        if error:
            logger.error(f"Error eliminando dirección: {error}")
            return jsonify({
                "success": False,
                "message": f"Error al eliminar dirección: {error}"
            }), 500

        if response.status_code == 202:
            return jsonify({
                "success": True,
                "message": "Dirección eliminada exitosamente"
            })
        else:
            logger.error(f"Error eliminando dirección: {response.status_code} - {response.text}")
            return jsonify({
                "success": False,
                "message": f"Error al eliminar dirección: {response.status_code}"
            }), response.status_code

    except Exception as e:
        logger.error(f"Error eliminando dirección: {str(e)}")
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500


@addresses_bp.route('/api/companies/<path:company_name>/addresses', methods=['GET'])
def get_company_addresses(company_name):
    """
    Obtiene todas las direcciones vinculadas a una compañía específica

    Args:
        company_name: Nombre de la compañía
    """
    try:
        session, headers, user_id, error_response = get_session_with_auth()
        if error_response:
            return error_response

        # Hacer petición a ERPNext para obtener direcciones de la compañía

        # Obtener todas las direcciones primero (sin filtros complejos)
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Address",
            params={
                "fields": '["name","address_title","address_type","address_line1","address_line2","city","state","pincode","country"]',
                "limit": 100  # Aumentar límite para obtener más direcciones
            },
            operation_name="Get all addresses for company filtering"
        )

        addresses = []
        if error:
            return jsonify({
                "success": False,
                "message": f"Error al obtener direcciones: {error}"
            }), 500

        if response.status_code == 200:
            result = response.json()
            all_addresses = result.get('data', [])

            # Para cada dirección, obtener los links por separado
            for addr in all_addresses:
                address_name = addr.get('name')

                # Obtener los links de esta dirección específica
                links_response, links_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Address/{address_name}",
                    operation_name=f"Get links for address '{address_name}'"
                )

                if links_error:
                    addr['links'] = []
                elif links_response.status_code == 200:
                    links_data = links_response.json()
                    addr['links'] = links_data.get('data', {}).get('links', [])
                else:
                    addr['links'] = []

            # Filtrar manualmente las direcciones que pertenecen a la compañía
            for addr in all_addresses:
                links = addr.get('links', [])

                if isinstance(links, list):
                    for link in links:
                        if isinstance(link, dict) and link.get('link_doctype') == 'Company' and link.get('link_name') == company_name:
                            addresses.append(addr)
                            break
                elif isinstance(links, dict):
                    if links.get('link_doctype') == 'Company' and links.get('link_name') == company_name:
                        addresses.append(addr)

        else:
            return jsonify({
                "success": False,
                "message": f"Error al obtener direcciones: {response.status_code}"
            }), response.status_code

        return jsonify({
            "success": True,
            "data": addresses
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500