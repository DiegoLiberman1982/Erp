from flask import Blueprint, request, jsonify
import os
import requests
import json
import traceback
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar funciones de companies.py para evitar duplicación
from routes.companies import load_active_companies

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company
from .general import get_company_abbr, add_company_abbr, remove_company_abbr, validate_company_abbr_operation

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from utils.conciliation_utils import (
    CONCILIATION_FIELD,
    build_conciliation_groups,
    exclude_balanced_documents,
    summarize_group_balances,
)
from datetime import datetime, timedelta

# Crear el blueprint para las rutas de proveedores
suppliers_bp = Blueprint('suppliers', __name__)

def create_supplier_for_company(session, headers, company_name, supplier_name, tax_id, doc_type=None, custom_condicion_iva=None):
    """
    Helper reutilizable (sin request context) para crear un Supplier en ERPNext
    scopeado por company (custom_company) y con sufijo ABBR.

    - NO hace "fallbacks" peligrosos: valida existencia de Supplier Group.
    - Si existe un Supplier con el mismo supplier_name dentro de la company pero con tax_id distinto, falla.
    """
    if not company_name:
        return None, "Compañía requerida para crear proveedor"
    if not supplier_name or not str(supplier_name).strip():
        return None, "Nombre de proveedor requerido para crear proveedor"
    if not tax_id or not str(tax_id).strip():
        return None, "CUIT/DNI requerido para crear proveedor"

    company_abbr = get_company_abbr(session, headers, company_name)
    supplier_name_scoped = add_company_abbr(str(supplier_name).strip(), company_abbr) if company_abbr else str(supplier_name).strip()

    # Determinar Supplier Group (validar existencia; si no existe, abortar)
    base_group = get_default_supplier_group()
    group_candidates = []
    if company_abbr:
        group_candidates.append(add_company_abbr(base_group, company_abbr))
    group_candidates.append(base_group)

    supplier_group = None
    for candidate in group_candidates:
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Supplier%20Group/{quote(candidate)}",
            operation_name="Validate Supplier Group for auto-create",
        )
        if not err and resp and resp.status_code == 200:
            supplier_group = candidate
            break

    if not supplier_group:
        return None, f"No existe Supplier Group para crear proveedor (probé: {', '.join(group_candidates)})"

    # Evitar duplicación por nombre dentro de la company (y evitar corrupción por tax_id distinto)
    try:
        filters = [["supplier_name", "=", supplier_name_scoped], ["custom_company", "=", company_name]]
        check_resp, check_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Supplier",
            params={
                "filters": json.dumps(filters),
                "fields": json.dumps(["name", "supplier_name", "tax_id"]),
                "limit_page_length": 20,
            },
            operation_name="Check Supplier by supplier_name before auto-create",
        )
        if not check_err and check_resp and check_resp.status_code == 200:
            existing = check_resp.json().get("data", []) or []
            if len(existing) == 1:
                existing_tax = str(existing[0].get("tax_id") or "").strip()
                if existing_tax and existing_tax != str(tax_id).strip():
                    return None, "Ya existe un proveedor con el mismo nombre pero CUIT/DNI distinto"
                return existing[0].get("name"), None
            if len(existing) > 1:
                return None, "Hay más de un proveedor con el mismo nombre en la compañía (no se puede decidir)"
    except Exception:
        # Si la verificación falla, preferimos seguir y dejar que ERPNext valide, pero sin inventar datos.
        pass

    # Supplier type (best-effort, no impact crítico)
    supplier_type = "Company"
    doc_type_str = str(doc_type or "").strip()
    if doc_type_str == "96":
        supplier_type = "Individual"

    erpnext_supplier = {
        "supplier_name": supplier_name_scoped,
        "supplier_group": supplier_group,
        "supplier_type": supplier_type,
        "tax_id": str(tax_id).strip(),
        "custom_company": company_name,
    }
    if custom_condicion_iva is not None and str(custom_condicion_iva).strip() != "":
        erpnext_supplier["custom_condicion_iva"] = str(custom_condicion_iva).strip()

    resp, err = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Supplier",
        data={"data": erpnext_supplier},
        operation_name="Auto-create Supplier (AFIP import)",
    )
    if err or not resp or resp.status_code not in (200, 201):
        return None, "No se pudo crear el proveedor en ERPNext"

    created = resp.json().get("data", {}) or {}
    return created.get("name"), None


def _safe_float(value, default=0.0):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return default


def _supplier_conciliation_amount(doc):
    if doc.get('doctype') == "Payment Entry":
        return -_safe_float(doc.get('unallocated_amount'))
    return _safe_float(doc.get('outstanding_amount'))

def get_default_supplier_group():
    """
    Retorna el grupo de proveedores por defecto
    """
    return "Proveedores Generales"

def create_custom_supplier_fields(session, headers):
    """Crea los campos custom necesarios para el proveedor si no existen"""
    custom_fields = [
        {
            "dt": "Supplier",
            "label": "Condición IVA",
            "fieldname": "custom_condicion_iva",
            "fieldtype": "Select",
            "options": "Responsable Inscripto\nMonotributista\nExento\nConsumidor Final",
            "insert_after": "supplier_group"
        },
        {
            "dt": "Supplier",
            "label": "IVA Compras por Defecto",
            "fieldname": "custom_default_iva_compras",
            "fieldtype": "Link",
            "options": "Item Tax Template",
            "insert_after": "custom_condicion_iva"
        },
        {
            "dt": "Supplier",
            "label": "Personería",
            "fieldname": "custom_personeria",
            "fieldtype": "Data",
            "insert_after": "tax_id"
        },
        {
            "dt": "Supplier",
            "label": "País",
            "fieldname": "custom_pais",
            "fieldtype": "Data",
            "insert_after": "custom_personeria"
        },
        {
            "dt": "Supplier",
            "label": "Cuenta de Gastos por Defecto",
            "fieldname": "default_expense_account",
            "fieldtype": "Link",
            "options": "Account",
            "insert_after": "supplier_group"
        }
    ]
    
    def field_exists(fieldname):
        """Verifica si un campo custom ya existe"""
        try:
            filters_str = f'[["dt","=","Supplier"],["fieldname","=","{fieldname}"]]'
            params = {
                'filters': filters_str,
                'limit_page_length': 1
            }
            check_response, check_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Custom%20Field",
                params=params,
                operation_name=f"Check if custom field '{fieldname}' exists"
            )

            if check_error:
                print(f"Error verificando existencia del campo '{fieldname}': {check_error}")
                return False

            if check_response.status_code == 200:
                data = check_response.json()
                return len(data.get("data", [])) > 0
            return False
        except Exception as e:
            print(f"Error verificando existencia del campo '{fieldname}': {e}")
            return False
    
    for field_data in custom_fields:
        fieldname = field_data['fieldname']
        if field_exists(fieldname):
            print(f"Campo custom '{fieldname}' ya existe, saltando creación")
            continue
        
        try:
            print(f"Creando campo custom '{fieldname}'...")
            
            create_response, create_error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom%20Field",
                data={"data": field_data},
                operation_name=f"Create custom field '{fieldname}'"
            )

            if create_error:
                print(f"Error creando campo custom '{fieldname}': {create_error}")
                # Continuar con el siguiente campo
                continue
            
            if create_response.status_code in [200, 201]:
                print(f"Campo custom '{fieldname}' creado exitosamente")
            else:
                print(f"Advertencia al crear campo '{fieldname}': {create_response.text}")
                
        except Exception as e:
            print(f"Error al crear campo custom '{fieldname}': {e}")
            # Continuar con el siguiente campo
            continue
    
    return True

@suppliers_bp.route('/api/suppliers/names', methods=['GET'])
def get_supplier_names():
    """Obtiene solo los nombres de proveedores desde ERPNext (sin cálculos de saldo)"""
    print("\n--- Petición de obtener nombres de proveedores recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            print("ERROR: ERPNEXT_URL no está configurado")
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa configurada para el usuario {user_id}")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        print(f"Compañía activa: {company_name}")

        # Obtener solo nombres de proveedores desde ERPNext
        print("Obteniendo nombres de proveedores desde ERPNext...")
        fields = '["name","supplier_name","supplier_details"]'
        filters = json.dumps([['custom_company','=',company_name]])
        
        params = {
            'fields': fields,
            'filters': filters,
            'limit_page_length': 1000
        }
        suppliers_response, suppliers_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Supplier",
            params=params,
            operation_name="Get supplier names"
        )

        if suppliers_error:
            return handle_erpnext_error(suppliers_error, "Error obteniendo proveedores")

        if suppliers_response.status_code != 200:
            print(f"Error obteniendo proveedores: {suppliers_response.status_code} - {suppliers_response.text}")
            return jsonify({"success": False, "message": f"Error al obtener proveedores: {suppliers_response.status_code}"}), 500

        suppliers_data = suppliers_response.json()
        suppliers = suppliers_data.get("data", [])

        # Obtener sigla de la compañía para removerla de los nombres
        company_abbr = get_company_abbr(session, headers, company_name)

        # Simplificar respuesta: solo devolver array de objetos con name, supplier_name y supplier_details
        supplier_names = []
        for s in suppliers:
            supplier_names.append({
                "name": remove_company_abbr(s["name"], company_abbr) if company_abbr else s["name"],
                "supplier_name": remove_company_abbr(s["supplier_name"], company_abbr) if company_abbr else s["supplier_name"],
                "supplier_details": s.get("supplier_details", "")
            })

        print(f"Nombres de proveedores obtenidos: {len(supplier_names)}")

        return jsonify({"success": True, "suppliers": supplier_names, "message": "Nombres de proveedores obtenidos correctamente"})

    except Exception as e:
        print(f"ERROR GENERAL en get_supplier_names: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@suppliers_bp.route('/api/suppliers/', methods=['GET'])
def get_suppliers():
    """Obtiene la lista de proveedores desde ERPNext"""
    print("\n--- Petición de obtener proveedores recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            print("ERROR: ERPNEXT_URL no está configurado")
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500


        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa configurada para el usuario {user_id}")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        print(f"Compañía activa: {company_name}")

        # Crear campos custom si no existen
        # NOTA: Los campos custom se crean UNA SOLA VEZ durante la configuración inicial
        # create_custom_supplier_fields(session, headers)

        # Obtener proveedores desde ERPNext
        fields = '["name","supplier_name","supplier_group","supplier_type","supplier_details"]'
        filters = json.dumps([['custom_company','=',company_name]])
        
        params = {
            'fields': fields,
            'filters': filters,
            'limit_page_length': 1000
        }
        suppliers_response, suppliers_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Supplier",
            params=params,
            operation_name="Get suppliers list"
        )

        if suppliers_error:
            return handle_erpnext_error(suppliers_error, "Error obteniendo proveedores")

        print(f"Respuesta de ERPNext: {suppliers_response.status_code}")
        print(f"Headers de respuesta: {dict(suppliers_response.headers)}")

        if suppliers_response.status_code == 401:
            print("ERROR: Sesión expirada (401)")
            return jsonify({"success": False, "message": "Sesión expirada"}), 401
        elif suppliers_response.status_code != 200:
            print(f"Error obteniendo proveedores: {suppliers_response.status_code} - {suppliers_response.text}")
            return jsonify({"success": False, "message": f"Error al obtener proveedores: {suppliers_response.status_code}"}), 500

        suppliers_data = suppliers_response.json()
        suppliers = suppliers_data.get("data", [])

        print(f"Proveedores obtenidos: {len(suppliers)}")
        if suppliers:
            print(f"Primer proveedor: {suppliers[0]}")

        # Obtener sigla de la compañía para removerla de los nombres
        company_abbr = get_company_abbr(session, headers, company_name)

        # Para cada proveedor, obtener el saldo pendiente sumando las facturas
        for supplier in suppliers:
            try:
                supplier_name = supplier['name']
                print(f"🔍 Calculando saldo para proveedor: '{supplier_name}' en compañía: '{company_name}'")

                # Obtener todas las facturas del proveedor y sumar outstanding_amount
                print(f"🔍 Consultando facturas para supplier='{supplier_name}' y company='{company_name}'")

                # Intentar diferentes formas de filtrar
                filters_options = [
                    f'[["supplier","=","{supplier_name}"],["company","=","{company_name}"],["docstatus","!=","2"]]',  # Por supplier name, excluyendo canceladas
                    f'[["supplier_name","=","{supplier_name}"],["company","=","{company_name}"],["docstatus","!=","2"]]',  # Por supplier_name, excluyendo canceladas
                ]

                invoices = []
                for i, filters in enumerate(filters_options):
                    print(f"🔍 Intentando filtro {i+1}: {filters}")
                    fields = '["name","outstanding_amount","status","grand_total","supplier","supplier_name"]'
                    
                    params_inv = {
                        'filters': filters,
                        'fields': fields,
                        'limit_page_length': 1000
                    }
                    invoices_response, invoices_error = make_erpnext_request(
                        session=session,
                        method="GET",
                        endpoint="/api/resource/Purchase Invoice",
                        params=params_inv,
                        operation_name=f"Get invoices for supplier '{supplier_name}' (filter {i+1})"
                    )

                    if invoices_error:
                        print(f"❌ Error con filtro {i+1}: {invoices_error}")
                        continue

                    print(f"📊 Respuesta HTTP {i+1}: {invoices_response.status_code}")

                    if invoices_response.status_code == 200:
                        invoices_data = invoices_response.json()
                        current_invoices = invoices_data.get('data', [])
                        print(f"📋 Facturas encontradas con filtro {i+1}: {len(current_invoices)}")

                        if current_invoices:
                            for inv in current_invoices:
                                print(f"📄 Factura {inv.get('name')}: supplier={inv.get('supplier')}, supplier_name={inv.get('supplier_name')}, outstanding_amount={inv.get('outstanding_amount')}, status={inv.get('status')}, grand_total={inv.get('grand_total')}")
                            invoices = current_invoices
                            break  # Usar el primer filtro que funcione
                        else:
                            print(f"❌ No se encontraron facturas con filtro {i+1}")
                    else:
                        print(f"❌ Error con filtro {i+1}: {invoices_response.status_code} - {invoices_response.text}")

                total_outstanding = sum(float(invoice.get('outstanding_amount', 0)) for invoice in invoices)
                supplier['outstanding_amount'] = total_outstanding
                print(f"✅ Saldo calculado para {supplier_name}: ${total_outstanding} (de {len(invoices)} facturas)")

            except Exception as e:
                print(f"❌ Error calculando saldo para proveedor {supplier['name']}: {e}")
                import traceback
                print(f"❌ Traceback: {traceback.format_exc()}")
                supplier['outstanding_amount'] = 0

        # Remover sigla de compañía de los nombres antes de enviar al frontend
        for supplier in suppliers:
            if company_abbr:
                original_name = supplier['name']
                original_supplier_name = supplier['supplier_name']
                supplier['name'] = remove_company_abbr(supplier['name'], company_abbr)
                supplier['supplier_name'] = remove_company_abbr(supplier['supplier_name'], company_abbr)
                # Validar las operaciones
                if not validate_company_abbr_operation(original_name, supplier['name'], company_abbr, 'remove'):
                    print(f"⚠️ Validation failed for supplier name removal: {original_name} -> {supplier['name']}")
                if not validate_company_abbr_operation(original_supplier_name, supplier['supplier_name'], company_abbr, 'remove'):
                    print(f"⚠️ Validation failed for supplier_name removal: {original_supplier_name} -> {supplier['supplier_name']}")
                print(f"🏷️ Cleaned supplier names for frontend: {supplier['supplier_name']}")

        print(f"Proveedores obtenidos: {len(suppliers)}")

        return jsonify({"success": True, "suppliers": suppliers, "message": "Proveedores obtenidos correctamente"})

    except Exception as e:
        print(f"ERROR GENERAL en get_suppliers: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/', methods=['POST'])
def create_supplier():
    """Crea un nuevo proveedor en ERPNext"""
    print("\n--- Petición de crear proveedor recibida ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        supplier_data = data.get('supplier', {})

        print(f"Datos del proveedor a crear: {json.dumps(supplier_data, indent=2, ensure_ascii=False)}")

        # Obtener la compañía activa del usuario
        print(f"Obteniendo compañía activa para usuario {user_id}")
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa configurada para el usuario {user_id}")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        print(f"Compañía activa: {company_name}")

        # Obtener sigla de la compañía para agregar a los nombres
        company_abbr = get_company_abbr(session, headers, company_name)

        # Crear campos custom si no existen
        # NOTA: Los campos custom se crean UNA SOLA VEZ durante la configuración inicial
        create_custom_supplier_fields(session, headers)

        # Preparar los datos para ERPNext
        supplier_name = supplier_data.get('supplier_name')
        if supplier_name and company_abbr:
            supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Supplier name expanded for ERPNext: {supplier_name}")

        erpnext_supplier = {
            "supplier_name": supplier_name,
            # Respect whatever value the frontend provided for supplier_group.
            # Do NOT apply server-side fallbacks here - if the form leaves it blank, we will send blank.
            "supplier_group": supplier_data.get('supplier_group', ''),
            "supplier_type": supplier_data.get('supplier_type', 'Company'),
            "website": supplier_data.get('website', ''),
            "email_id": supplier_data.get('email', ''),
            "mobile_no": supplier_data.get('phone', ''),
            "contact": supplier_data.get('contacto', ''),
            "tax_id": supplier_data.get('tax_id', ''),
            "custom_condicion_iva": supplier_data.get('custom_condicion_iva', ''),
            "payment_terms": supplier_data.get('payment_terms', ''),
            "discount_percentage": supplier_data.get('discount_percentage', 0),
            "price_list": supplier_data.get('price_list', ''),
            "transporter": supplier_data.get('transporter', ''),
            "custom_company": company_name,
            "default_expense_account": supplier_data.get('default_expense_account', ''),
            "custom_default_price_list": supplier_data.get('custom_default_price_list', ''),
            "accounts": [
                {
                    "doctype": "Party Account",
                    "company": company_name,
                    "account": supplier_data.get('default_payable_account', '')
                }
            ] if supplier_data.get('default_payable_account') else []
        }

        print(f"Datos preparados para ERPNext: {json.dumps(erpnext_supplier, indent=2, ensure_ascii=False)}")

        # Crear el proveedor en ERPNext
        response, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Supplier",
            data={"data": erpnext_supplier},
            operation_name="Create supplier"
        )

        if create_error:
            return handle_erpnext_error(create_error, "Error creando proveedor")

        print(f"Respuesta de creación: {response.status_code}")
        print(f"Respuesta completa: {response.text}")

        if response.status_code == 200:
            created_supplier = response.json()
            print(f"Proveedor creado exitosamente: {created_supplier}")

            return jsonify({
                "success": True,
                "supplier": created_supplier.get('data'),
                "message": "Proveedor creado exitosamente"
            })
        else:
            print(f"Error creando proveedor: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error al crear proveedor: {response.status_code}"}), 500

    except Exception as e:
        print(f"ERROR GENERAL en create_supplier: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/<supplier_name>', methods=['GET'])
def get_supplier(supplier_name):
    """Obtiene los detalles de un proveedor específico"""
    print(f"\n--- Petición de obtener proveedor {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener compañía activa para manejar siglas
        company_name = get_active_company(user_id)
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

        # Agregar sigla al supplier_name para buscar en ERPNext
        search_supplier_name = supplier_name
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching supplier with abbr: {search_supplier_name}")

        # Obtener detalles del proveedor
        response, supplier_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Supplier/{quote(search_supplier_name)}",
            operation_name=f"Get supplier details for '{search_supplier_name}'"
        )

        if supplier_error:
            return handle_erpnext_error(supplier_error, f"Error obteniendo proveedor '{supplier_name}'")

        if response.status_code == 200:
            supplier_data = response.json()
            supplier = supplier_data.get('data', {})

            # Remover sigla de los nombres antes de enviar al frontend
            if company_abbr:
                supplier['name'] = remove_company_abbr(supplier.get('name', ''), company_abbr)
                supplier['supplier_name'] = remove_company_abbr(supplier.get('supplier_name', ''), company_abbr)

            print(f"Proveedor obtenido: {supplier.get('supplier_name', supplier_name)}")

            return jsonify({
                "success": True,
                "supplier": supplier,
                "message": "Proveedor obtenido correctamente"
            })
        else:
            print(f"Error obteniendo proveedor: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Proveedor no encontrado: {response.status_code}"}), 404

    except Exception as e:
        print(f"ERROR GENERAL en get_supplier: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/<supplier_name>', methods=['PUT'])
def update_supplier(supplier_name):
    """Actualiza un proveedor existente"""
    print(f"\n--- Petición de actualizar proveedor {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        supplier_data = data.get('supplier', {})

        print(f"Datos del proveedor a actualizar: {json.dumps(supplier_data, indent=2, ensure_ascii=False)}")

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        # Obtener sigla de la compañía
        company_abbr = get_company_abbr(session, headers, company_name)

        # Agregar sigla al supplier_name de la URL para buscar en ERPNext
        search_supplier_name = supplier_name
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching supplier with abbr: {search_supplier_name}")

        # Crear campos custom si no existen
        create_custom_supplier_fields(session, headers)

        # Obtener los datos actuales del proveedor
        current_response, current_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Supplier/{quote(search_supplier_name)}",
            operation_name=f"Get current supplier data for '{search_supplier_name}'"
        )

        if current_error:
            return handle_erpnext_error(current_error, f"Error obteniendo proveedor actual '{supplier_name}'")

        if current_response.status_code != 200:
            print(f"Error obteniendo proveedor actual: {current_response.status_code} - {current_response.text}")
            return jsonify({"success": False, "message": f"Error al obtener proveedor actual: {current_response.status_code}"}), 500

        current_supplier = current_response.json().get('data', {})

        # Preparar los datos para ERPNext, usando valores actuales como fallback
        existing_accounts = current_supplier.get('accounts', [])
        updated_accounts = []
        for acc in existing_accounts:
            acc_copy = acc.copy()
            if acc.get('company') == company_name:
                if supplier_data.get('default_payable_account'):
                    acc_copy['account'] = supplier_data['default_payable_account']
            acc_copy['doctype'] = 'Party Account'
            updated_accounts.append(acc_copy)
        
        if not any(acc.get('company') == company_name for acc in existing_accounts) and supplier_data.get('default_payable_account'):
            updated_accounts.append({
                "doctype": "Party Account",
                "company": company_name,
                "account": supplier_data['default_payable_account']
            })
        
        # Agregar sigla al supplier_name si viene en los datos
        updated_supplier_name = supplier_data.get('supplier_name') or current_supplier.get('supplier_name')
        if updated_supplier_name and company_abbr:
            original_name = updated_supplier_name
            updated_supplier_name = add_company_abbr(updated_supplier_name, company_abbr)
            # Validar la operación
            if not validate_company_abbr_operation(original_name, updated_supplier_name, company_abbr, 'add'):
                print(f"⚠️ Validation failed for supplier name abbreviation: {original_name} -> {updated_supplier_name}")
            print(f"🏷️ Updated supplier name with abbr: {updated_supplier_name}")

        # If the frontend explicitly provided the supplier_group key, use its exact value (even empty string)
        # Otherwise preserve current_supplier's value.
        if 'supplier_group' in supplier_data:
            supplier_group_value = supplier_data.get('supplier_group')
        else:
            supplier_group_value = current_supplier.get('supplier_group')

        erpnext_supplier = {
            "supplier_name": updated_supplier_name,
            "supplier_group": supplier_group_value,
            "supplier_type": supplier_data.get('supplier_type') or current_supplier.get('supplier_type') or 'Company',
            "website": supplier_data.get('website') or current_supplier.get('website', ''),
            "email_id": supplier_data.get('email') or current_supplier.get('email_id', ''),
            "mobile_no": supplier_data.get('phone') or current_supplier.get('mobile_no', ''),
            "contact": supplier_data.get('contacto') or current_supplier.get('contact', ''),
            "tax_id": supplier_data.get('tax_id') or current_supplier.get('tax_id', ''),
            "custom_condicion_iva": supplier_data.get('custom_condicion_iva') or current_supplier.get('custom_condicion_iva'),
            "payment_terms": supplier_data.get('payment_terms') or current_supplier.get('payment_terms', ''),
            "discount_percentage": supplier_data.get('discount_percentage') or current_supplier.get('discount_percentage', 0),
            "price_list": supplier_data.get('price_list') or current_supplier.get('price_list', ''),
            "transporter": supplier_data.get('transporter') or current_supplier.get('transporter', ''),
            "default_expense_account": supplier_data.get('default_expense_account') or current_supplier.get('default_expense_account', ''),
            "custom_default_price_list": supplier_data.get('custom_default_price_list') or current_supplier.get('custom_default_price_list', ''),
            "accounts": updated_accounts
        }

        print(f"Datos preparados para ERPNext: {json.dumps(erpnext_supplier, indent=2, ensure_ascii=False)}")

        # Actualizar el proveedor en ERPNext
        response, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Supplier/{quote(search_supplier_name)}",
            data={"data": erpnext_supplier},
            operation_name=f"Update supplier '{search_supplier_name}'"
        )

        if update_error:
            return handle_erpnext_error(update_error, f"Error actualizando proveedor '{supplier_name}'")

        print(f"Respuesta de actualización: {response.status_code}")
        print(f"Respuesta completa: {response.text}")

        if response.status_code == 200:
            updated_supplier = response.json()
            supplier_result = updated_supplier.get('data', {})

            # Remover sigla de los nombres antes de enviar al frontend
            if company_abbr:
                supplier_result['name'] = remove_company_abbr(supplier_result.get('name', ''), company_abbr)
                supplier_result['supplier_name'] = remove_company_abbr(supplier_result.get('supplier_name', ''), company_abbr)

            print(f"Proveedor actualizado exitosamente: {supplier_result.get('supplier_name', supplier_name)}")

            return jsonify({
                "success": True,
                "supplier": supplier_result,
                "message": "Proveedor actualizado exitosamente"
            })
        else:
            print(f"Error actualizando proveedor: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error al actualizar proveedor: {response.status_code}"}), 500

    except Exception as e:
        print(f"ERROR GENERAL en update_supplier: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/<supplier_name>', methods=['DELETE'])
def delete_supplier(supplier_name):
    """Elimina un proveedor"""
    print(f"\n--- Petición de eliminar proveedor {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener compañía activa para manejar siglas
        company_name = get_active_company(user_id)
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

        # Agregar sigla al supplier_name para eliminar en ERPNext
        delete_supplier_name = supplier_name
        if company_abbr:
            delete_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Deleting supplier with abbr: {delete_supplier_name}")

        # Eliminar el proveedor de ERPNext
        response, delete_error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Supplier/{quote(delete_supplier_name)}",
            operation_name=f"Delete supplier '{delete_supplier_name}'"
        )

        if delete_error:
            return handle_erpnext_error(delete_error, f"Error eliminando proveedor '{supplier_name}'")

        print(f"Respuesta de eliminación: {response.status_code}")
        print(f"Respuesta completa: {response.text}")

        if response.status_code == 202:  # ERPNext returns 202 for successful deletion
            print(f"Proveedor {supplier_name} eliminado exitosamente")

            return jsonify({
                "success": True,
                "message": "Proveedor eliminado exitosamente"
            })
        else:
            print(f"Error eliminando proveedor: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error al eliminar proveedor: {response.status_code}"}), 500

    except Exception as e:
        print(f"ERROR GENERAL en delete_supplier: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/<supplier_name>/invoices', methods=['GET'])
def get_supplier_invoices(supplier_name):
    """Obtiene las facturas de un proveedor"""
    print(f"\n--- Petición de obtener facturas del proveedor {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener compañía activa para manejar siglas
        company_name = get_active_company(user_id)
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

        # Agregar sigla al supplier_name para buscar en ERPNext
        search_supplier_name = supplier_name
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching invoices for supplier with abbr: {search_supplier_name}")

        # Obtener facturas del proveedor (excluyendo canceladas)
        filters = json.dumps([
            ["supplier", "=", search_supplier_name],
            ["company", "=", company_name],
            ["docstatus", "!=", 2]
        ])
        fields = json.dumps([
            "name",
            "posting_date",
            "status",
            "grand_total",
            "outstanding_amount",
            "docstatus",
            "base_grand_total",
            "currency",
            "conversion_rate"
        ])
        params = {
            "filters": filters,
            "fields": fields,
            "limit_page_length": 100
        }
        response, invoices_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Purchase Invoice",
            params=params,
            operation_name=f"Get invoices for supplier '{search_supplier_name}'"
        )

        if invoices_error:
            return handle_erpnext_error(invoices_error, f"Error obteniendo facturas del proveedor '{supplier_name}'")

        if response.status_code == 200:
            invoices_data = response.json()
            invoices = invoices_data.get('data', [])

            # Remover siglas de los nombres de proveedores en la respuesta
            if company_abbr:
                for invoice in invoices:
                    if 'supplier_name' in invoice and invoice['supplier_name']:
                        invoice['supplier_name'] = remove_company_abbr(invoice['supplier_name'], company_abbr)
                        print(f"🏷️ Cleaned supplier name in invoice: {invoice['supplier_name']}")

            print(f"Facturas obtenidas para {supplier_name}: {len(invoices)}")

            return jsonify({
                "success": True,
                "invoices": invoices,
                "message": "Facturas obtenidas correctamente"
            })
        else:
            print(f"Error obteniendo facturas: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error al obtener facturas: {response.status_code}"}), 500

    except Exception as e:
        print(f"ERROR GENERAL en get_supplier_invoices: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/<supplier_name>/statements', methods=['GET'])
def get_supplier_statements(supplier_name):
    """Obtiene el estado de cuenta de un proveedor con documentos pendientes"""
    print(f"\n--- Petición de obtener estado de cuenta del proveedor {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa
        company_name = get_active_company(user_id)

        if not company_name:
            return jsonify({"success": False, "message": "No hay compañía activa configurada"}), 400

        # Obtener abreviatura de compañía
        company_abbr = get_company_abbr(session, headers, company_name)
        search_supplier = add_company_abbr(supplier_name, company_abbr) if company_abbr else supplier_name

        page = int(request.args.get('page', 1))
        # Ensure page is 1-based and never negative or zero — defensive programming
        if page < 1:
            print(f"Warning: page param < 1 received ({page}), clamping to 1")
            page = 1
        limit = int(request.args.get('limit', 50))

        # Obtener facturas de compra del proveedor
        invoice_filters = [
            ["supplier", "=", search_supplier],
            ["company", "=", company_name],
            ["docstatus", "=", 1],  # Solo Submitted
        ]

        fields = json.dumps([
            "name",
            "posting_date",
            "grand_total",
            "outstanding_amount",
            "status",
            "is_return",
            "return_against",
            CONCILIATION_FIELD,
            "base_grand_total",
            "currency",
            "conversion_rate"
        ])
        invoice_filters_str = json.dumps(invoice_filters)
        invoice_url = f"/api/resource/Purchase%20Invoice?fields={quote(fields)}&filters={quote(invoice_filters_str)}&order_by=posting_date%20asc&limit_page_length={limit}&limit_start={(page-1)*limit}"
        invoice_response, invoice_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=invoice_url,
            operation_name="Fetch Supplier Invoices"
        )

        if invoice_error:
            return handle_erpnext_error(invoice_error, "Failed to fetch supplier invoices")

        invoice_data = invoice_response.json()
        invoices = invoice_data.get("data", [])
        for inv in invoices:
            inv["doctype"] = "Purchase Invoice"

        # Procesar documentos pendientes
        pending_documents = []
        processed_groups = set()
        movements = []
        conciliation_candidates = []

        # Agrupar documentos por 'return_against'
        groups = {}
        standalone_docs = []
        for doc in invoices:
            rec_id = doc.get(CONCILIATION_FIELD)
            if rec_id:
                # Usar base_grand_total que ya está en moneda de la compañía
                # outstanding_amount ya viene calculado por ERPNext en moneda de compañía
                amount_value = _safe_float(doc.get("base_grand_total") or doc.get("grand_total", 0))
                outstanding_value = _safe_float(doc.get("outstanding_amount", 0))
                voucher_type = "Purchase Invoice"
                if doc.get("is_return") or amount_value < 0:
                    voucher_type = "Debit Note"
                conciliation_candidates.append({
                    "name": doc.get("name"),
                    "voucher_no": doc.get("name"),
                    "voucher_type": voucher_type,
                    "posting_date": doc.get("posting_date"),
                    "doctype": "Purchase Invoice",
                    "amount": amount_value,
                    "outstanding": outstanding_value,
                    "outstanding_amount": outstanding_value,
                    "base_grand_total": amount_value,
                    "currency": doc.get("currency"),
                    CONCILIATION_FIELD: rec_id
                })
            return_against = doc.get("return_against")
            if return_against:
                if return_against not in groups:
                    groups[return_against] = []
                groups[return_against].append(doc)
            else:
                standalone_docs.append(doc)

        # Procesar cada grupo de documentos relacionados (FC + sus NDs)
        for original_invoice_name, debit_notes in groups.items():
            if original_invoice_name in processed_groups:
                continue
            processed_groups.add(original_invoice_name)

            original_invoice = next((doc for doc in invoices if doc["name"] == original_invoice_name), None)
            
            if original_invoice:
                if original_invoice.get("docstatus") == 2:
                    continue
                    
                saldo_restante_factura = original_invoice.get("grand_total", 0)
                debit_notes.sort(key=lambda x: x.get('posting_date', '') + x.get('name', ''))

                for dn in debit_notes:
                    dn_total = abs(dn.get("grand_total", 0))
                    
                    if saldo_restante_factura > 0.01:
                        saldo_restante_factura -= dn_total
                        
                        if saldo_restante_factura <= 0.01:
                            if saldo_restante_factura < -0.01:
                                pending_documents.append(dn)
                    else:
                        pending_documents.append(dn)
                
                if saldo_restante_factura > 0.01:
                    pending_documents.append(original_invoice)
            else:
                for doc in debit_notes:
                    if abs(doc.get("outstanding_amount", 0)) > 0.01:
                        pending_documents.append(doc)

        # Procesar documentos standalone
        for doc in standalone_docs:
            if doc["name"] in processed_groups:
                continue
            
            outstanding = doc.get("outstanding_amount", 0)
            if abs(outstanding) > 0.01:
                pending_documents.append(doc)

        # Convertir facturas a movimientos de cuenta corriente
        for invoice in invoices:
            if invoice.get("docstatus") == 2 or invoice.get("status") == "Cancelled":
                continue
                
            voucher_type = "Factura"
            if invoice.get("is_return") or invoice.get("status") == "Debit Note Issued":
                voucher_type = "Nota de Débito"
            
            # Usar base_grand_total que ya está en la moneda de la compañía
            base_grand_total = _safe_float(invoice.get("base_grand_total") or invoice.get("grand_total", 0))
            # outstanding_amount ya viene en moneda de la compañía
            outstanding_amount = _safe_float(invoice.get("outstanding_amount", 0))
            # Calcular el monto pagado = total - saldo pendiente
            paid_amount = base_grand_total - outstanding_amount
            
            if invoice.get("is_return") or base_grand_total < 0:
                remarks = f"Nota de Débito {invoice['name']}"
                if invoice.get("return_against"):
                    remarks += f" (contra {invoice['return_against']})"
                movement = {
                    "posting_date": invoice["posting_date"],
                    "voucher_type": voucher_type,
                    "voucher_no": invoice["name"],
                    "debit": abs(base_grand_total),  # ND reduce deuda
                    "credit": 0,
                    "paid_amount": abs(paid_amount),
                    "outstanding_amount": outstanding_amount,
                    "currency": invoice.get("currency"),
                    "remarks": remarks,
                    "return_against": invoice.get("return_against")
                }
            else:
                movement = {
                    "posting_date": invoice["posting_date"],
                    "voucher_type": voucher_type,
                    "voucher_no": invoice["name"],
                    "debit": 0,
                    "credit": base_grand_total,  # FC aumenta deuda
                    "paid_amount": paid_amount,
                    "outstanding_amount": outstanding_amount,
                    "currency": invoice.get("currency"),
                    "remarks": f"Factura {invoice['name']}",
                    "return_against": None
                }
            movements.append(movement)

        # Obtener pagos al proveedor
        payment_filters = [
            ["party_type", "=", "Supplier"],
            ["party", "=", search_supplier],
            ["company", "=", company_name],
            ["docstatus", "=", 1],
        ]

        fields = json.dumps([
            "name",
            "posting_date",
            "paid_amount",
            "unallocated_amount",
            "payment_type",
            "party",
            "party_type",
            CONCILIATION_FIELD,
            "base_paid_amount",
            "paid_from_account_currency",
            "source_exchange_rate"
        ])
        payment_filters_str = json.dumps(payment_filters)
        # Defensive clamp of page
        if page < 1:
            page = 1
        payment_url = f"/api/resource/Payment%20Entry?fields={quote(fields)}&filters={quote(payment_filters_str)}&order_by=posting_date%20asc&limit_page_length={limit}&limit_start={(page-1)*limit}"
        payment_response, payment_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=payment_url,
            operation_name="Fetch Supplier Payments"
        )

        if not payment_error and payment_response.status_code == 200:
            payment_data = payment_response.json()
            payments = payment_data.get("data", [])
            for payment in payments:
                payment["doctype"] = "Payment Entry"

            # Agregar pagos con montos sin asignar a pending_documents
            for payment in payments:
                rec_id = payment.get(CONCILIATION_FIELD)
                if rec_id:
                    # Usar base_paid_amount que ya está en moneda de la compañía
                    paid_amount = _safe_float(payment.get("base_paid_amount") or payment.get("paid_amount", 0))
                    unallocated_amount = _safe_float(payment.get("unallocated_amount", 0))
                    conciliation_candidates.append({
                        "name": payment.get("name"),
                        "voucher_no": payment.get("name"),
                        "voucher_type": "Payment Entry",
                        "posting_date": payment.get("posting_date"),
                        "doctype": "Payment Entry",
                        "amount": paid_amount,
                        "outstanding": -unallocated_amount,
                        "unallocated_amount": unallocated_amount,
                        "base_paid_amount": paid_amount,
                        "currency": payment.get("paid_from_account_currency"),
                        CONCILIATION_FIELD: rec_id
                    })

                unallocated = float(payment.get("unallocated_amount", 0))
                if unallocated > 0.01:
                    # Usar base_paid_amount para la moneda de la compañía
                    base_paid = _safe_float(payment.get("base_paid_amount") or payment.get("paid_amount", 0))
                    pending_documents.append({
                        "name": payment["name"],
                        "posting_date": payment["posting_date"],
                        "grand_total": -base_paid,  # Negativo para crédito
                        "outstanding_amount": -unallocated,  # Negativo para crédito
                        "base_grand_total": -base_paid,
                        "currency": payment.get("paid_from_account_currency"),
                        "status": "Submitted",
                        "is_return": False,
                        "voucher_type": "Payment Entry",
                        "doctype": "Payment Entry",
                        CONCILIATION_FIELD: rec_id
                    })

            # Convertir pagos a movimientos
            for payment in payments:
                # Usar base_paid_amount para moneda de la compañía
                base_paid = _safe_float(payment.get("base_paid_amount") or payment.get("paid_amount", 0))
                unallocated = _safe_float(payment.get("unallocated_amount", 0))
                # Calcular el monto efectivamente aplicado = total pagado - sin asignar
                allocated_amount = base_paid - unallocated
                movement = {
                    "posting_date": payment["posting_date"],
                    "voucher_type": "Payment Entry",
                    "voucher_no": payment["name"],
                    "debit": base_paid,  # Pago reduce deuda
                    "credit": 0,
                    "paid_amount": allocated_amount,
                    "outstanding_amount": -unallocated,  # Negativo porque es crédito a favor
                    "unallocated_amount": unallocated,
                    "currency": payment.get("paid_from_account_currency"),
                    "remarks": f"Pago {payment['name']}"
                }
                movements.append(movement)

        conciliation_groups, balanced_ids = build_conciliation_groups(
            conciliation_candidates,
            _supplier_conciliation_amount
        )
        if balanced_ids:
            pending_documents = exclude_balanced_documents(pending_documents, balanced_ids)
        conciliation_summary = summarize_group_balances(conciliation_groups)

        has_more = len(movements) == limit

        print(f"Estado de cuenta obtenido para {supplier_name}: {len(movements)} movimientos, {len(pending_documents)} pendientes")

        return jsonify({
            "success": True,
            "data": movements,
            "statements": movements,  # Backward compatibility
            "pending_invoices": pending_documents,
            "conciliations": conciliation_summary,
            "pagination": {
                "page": page,
                "limit": limit,
                "has_more": has_more
            },
            "message": "Estado de cuenta obtenido correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en get_supplier_statements: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/<supplier_name>/addresses', methods=['GET'])
def get_supplier_addresses(supplier_name):
    """Obtiene las direcciones de un proveedor"""
    print(f"\n--- Petición de obtener direcciones del proveedor {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener compañía activa para manejar siglas
        company_name = get_active_company(user_id)
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

        # Agregar sigla al supplier_name para buscar en ERPNext
        search_supplier_name = supplier_name
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching addresses for supplier with abbr: {search_supplier_name}")

        # Hacer petición a ERPNext para obtener direcciones del proveedor

        # Obtener todas las direcciones primero (sin filtros complejos)
        response, addresses_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Address",
            params={
                "fields": '["name","address_title","address_type","address_line1","address_line2","city","state","pincode","country"]',
                "limit": 100  # Aumentar límite para obtener más direcciones
            },
            operation_name="Get all addresses"
        )

        if addresses_error:
            return handle_erpnext_error(addresses_error, "Error obteniendo direcciones")

        addresses = []
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
                    print(f"Error obteniendo links para dirección {address_name}: {links_error}")
                    addr['links'] = []
                elif links_response.status_code == 200:
                    links_data = links_response.json()
                    addr['links'] = links_data.get('data', {}).get('links', [])
                else:
                    addr['links'] = []

            # Filtrar manualmente las direcciones que pertenecen al proveedor
            for addr in all_addresses:
                links = addr.get('links', [])

                if isinstance(links, list):
                    for link in links:
                        if (isinstance(link, dict) and
                            link.get('link_doctype') == 'Supplier' and
                            link.get('link_name') == search_supplier_name):
                            addresses.append(addr)
                            break
                elif isinstance(links, dict):
                    if (links.get('link_doctype') == 'Supplier' and
                        links.get('link_name') == search_supplier_name):
                        addresses.append(addr)

            print(f"Direcciones obtenidas para {supplier_name}: {len(addresses)}")

            return jsonify({
                "success": True,
                "addresses": addresses,
                "message": "Direcciones obtenidas correctamente"
            })
        else:
            print(f"Error obteniendo direcciones: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error al obtener direcciones: {response.status_code}"}), 500

    except Exception as e:
        print(f"ERROR GENERAL en get_supplier_addresses: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/<supplier_name>/addresses', methods=['POST'])
def create_supplier_address(supplier_name):
    """Crea una nueva dirección para un proveedor"""
    print(f"\n--- Petición de crear dirección para proveedor {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        address_data = data.get('address', {})

        print(f"Datos de dirección a crear: {json.dumps(address_data, indent=2, ensure_ascii=False)}")

        # Obtener compañía activa para manejar siglas
        company_name = get_active_company(user_id)
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

        # Agregar sigla al supplier_name para crear el link en ERPNext
        link_supplier_name = supplier_name
        if company_abbr:
            link_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Creating address link for supplier with abbr: {link_supplier_name}")

        # Preparar los datos para ERPNext
        erpnext_address = {
            "address_title": address_data.get('address_title', f"Dirección de {supplier_name}"),
            "address_type": address_data.get('address_type', 'Billing'),
            "address_line1": address_data.get('address_line1', ''),
            "city": address_data.get('city', ''),
            "state": address_data.get('state', ''),
            "pincode": address_data.get('pincode', ''),
            "country": address_data.get('country', 'Argentina'),
            "links": [{
                "link_doctype": "Supplier",
                "link_name": link_supplier_name
            }]
        }

        print(f"Datos preparados para ERPNext: {json.dumps(erpnext_address, indent=2, ensure_ascii=False)}")

        # Crear la dirección en ERPNext
        response, create_address_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Address",
            data={"data": erpnext_address},
            operation_name=f"Create address for supplier '{link_supplier_name}'"
        )

        if create_address_error:
            return handle_erpnext_error(create_address_error, f"Error creando dirección para proveedor '{supplier_name}'")

        print(f"Respuesta de creación: {response.status_code}")
        print(f"Respuesta completa: {response.text}")

        if response.status_code == 200:
            created_address = response.json()
            print(f"Dirección creada exitosamente: {created_address}")

            return jsonify({
                "success": True,
                "address": created_address.get('data'),
                "message": "Dirección creada exitosamente"
            })
        else:
            print(f"Error creando dirección: {response.status_code} - {response.text}")
            return jsonify({"success": False, "message": f"Error al crear dirección: {response.status_code}"}), 500

    except Exception as e:
        print(f"ERROR GENERAL en create_supplier_address: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def get_supplier_payable_account(supplier_name, company_name, session, headers):
    """
    Obtiene la cuenta por pagar específica del proveedor para la compañía dada.
    Si el proveedor no tiene una cuenta específica, retorna None.
    """
    try:
        print(f"🔍 Buscando cuenta por pagar específica para proveedor '{supplier_name}' en compañía '{company_name}'")

        # Obtener compañía activa para manejar siglas
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

        # Agregar sigla al supplier_name para buscar en ERPNext
        search_supplier_name = supplier_name
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching payable account for supplier with abbr: {search_supplier_name}")

        # Obtener datos del proveedor con sus cuentas
        supplier_response, supplier_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Supplier/{quote(search_supplier_name)}",
            operation_name=f"Get supplier data for payable account '{search_supplier_name}'"
        )

        if supplier_error:
            print(f"❌ Error obteniendo proveedor: {supplier_error}")
            return None

        if supplier_response.status_code != 200:
            print(f"❌ Error obteniendo proveedor: {supplier_response.status_code}")
            return None

        supplier_data = supplier_response.json()['data']

        # Buscar en las cuentas del proveedor la que corresponde a la compañía actual
        accounts = supplier_data.get('accounts', [])
        for account in accounts:
            if account.get('company') == company_name:
                account_name = account.get('account', '').strip()
                if account_name:
                    print(f"✅ Cuenta específica encontrada para proveedor: {account_name}")
                    return account_name

        print(f"ℹ️ Proveedor no tiene cuenta específica para compañía '{company_name}', usando cuenta por defecto")
        return None
    except Exception as e:
        print(f"❌ Error obteniendo cuenta por pagar del proveedor: {str(e)}")
        return None


def get_supplier_expense_account(supplier_name, company_name, session, headers):
    """
    Obtiene la cuenta de gastos específica del proveedor para la compañía dada.
    Si el proveedor no tiene una cuenta específica, retorna None.
    """
    try:
        print(f"🔍 Buscando cuenta de gastos específica para proveedor '{supplier_name}' en compañía '{company_name}'")

        # Obtener compañía activa para manejar siglas
        company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

        # Agregar sigla al supplier_name para buscar en ERPNext
        search_supplier_name = supplier_name
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching expense account for supplier with abbr: {search_supplier_name}")

        # Obtener datos del proveedor
        supplier_response, supplier_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Supplier/{quote(search_supplier_name)}",
            operation_name=f"Get supplier data for expense account '{search_supplier_name}'"
        )

        if supplier_error:
            print(f"❌ Error obteniendo proveedor: {supplier_error}")
            return None

        if supplier_response.status_code != 200:
            print(f"❌ Error obteniendo proveedor: {supplier_response.status_code}")
            return None

        supplier_data = supplier_response.json()['data']

        # Verificar si tiene default_expense_account
        expense_account = supplier_data.get('default_expense_account', '').strip()
        if expense_account:
            print(f"✅ Cuenta de gastos específica encontrada para proveedor: {expense_account}")
            return expense_account

        print(f"ℹ️ Proveedor no tiene cuenta de gastos específica, usando cuenta por defecto")
        return None
    except Exception as e:
        print(f"❌ Error obteniendo cuenta de gastos del proveedor: {str(e)}")
        return None

@suppliers_bp.route('/api/suppliers/balances', methods=['POST'])
def get_suppliers_balances():
    """Obtiene los saldos de proveedores específicos"""
    print("\n--- Petición de obtener saldos de proveedores específicos ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        supplier_names = data.get('supplier_names', [])

        if not supplier_names:
            return jsonify({"success": False, "message": "Lista de proveedores requerida"}), 400

        # Verificar que ERPNEXT_URL esté configurado
        if not ERPNEXT_URL:
            return jsonify({"success": False, "message": "Configuración del servidor ERPNext no encontrada"}), 500

        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        print(f"Calculando saldos para {len(supplier_names)} proveedores en compañía: {company_name}")

        closing_balance_map = {}
        try:
            try:
                to_date = datetime.utcnow().date()
            except Exception:
                to_date = datetime.now().date()
            from_date = to_date - timedelta(days=30)

            report_params = {
                'report_name': 'Supplier Ledger Summary',
                'filters': json.dumps({
                    'company': company_name,
                    'from_date': from_date.strftime('%Y-%m-%d'),
                    'to_date': to_date.strftime('%Y-%m-%d')
                }),
                'ignore_prepared_report': 'false',
                'are_default_filters': 'false'
            }
            report_response, report_error = make_erpnext_request(
                session=session,
                method='GET',
                endpoint='/api/method/frappe.desk.query_report.run',
                params=report_params,
                operation_name='Fetch Supplier Ledger Summary'
            )

            if not report_error and report_response and report_response.status_code == 200:
                report_payload = report_response.json()
                for row in report_payload.get('message', {}).get('result', []):
                    supplier_key = row.get('supplier_name') or row.get('party_name') or row.get('party')
                    if not supplier_key:
                        continue
                    closing_balance = row.get('closing_balance')
                    closing_balance_map[supplier_key] = closing_balance
                    if ' - ' in supplier_key:
                        closing_balance_map[supplier_key.split(' - ')[0]] = closing_balance
        except Exception as err:
            print(f" Error obteniendo reporte de saldos: {err}")

        balances = []

        # Para cada proveedor solicitado, calcular su saldo
        for supplier_name in supplier_names:
            try:
                print(f"🔍 Calculando saldo para proveedor: '{supplier_name}'")

                # Obtener compañía activa para manejar siglas
                company_abbr = get_company_abbr(session, headers, company_name) if company_name else None

                # Agregar sigla al supplier_name para buscar en ERPNext
                search_supplier_name = supplier_name
                if company_abbr:
                    search_supplier_name = add_company_abbr(supplier_name, company_abbr)
                    print(f"🏷️ Searching balance for supplier with abbr: {search_supplier_name}")

                closing_balance = None
                if closing_balance_map:
                    closing_balance = closing_balance_map.get(search_supplier_name)
                    if closing_balance is None:
                        closing_balance = closing_balance_map.get(supplier_name)
                if closing_balance is not None:
                    balances.append({
                        'name': supplier_name,
                        'outstanding_amount': _safe_float(closing_balance),
                        'invoice_count': 0
                    })
                    print(f" 💸 Saldo tomado del reporte para {supplier_name}: ${closing_balance}")
                    continue

                # Obtener todas las facturas CONFIRMADAS del proveedor (docstatus = 1)
                filters = f'[["supplier","=","{search_supplier_name}"],["company","=","{company_name}"],["docstatus","=","1"]]'
                fields = '["name","outstanding_amount","status","grand_total"]'

                params_inv = {
                    'filters': filters,
                    'fields': fields,
                    'limit_page_length': 1000
                }
                invoices_response, invoices_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Purchase Invoice",
                    params=params_inv,
                    operation_name=f"Get invoices for supplier balance '{search_supplier_name}'"
                )

                if invoices_error:
                    print(f"❌ Error obteniendo facturas para {supplier_name}: {invoices_error}")
                    balances.append({
                        'name': supplier_name,
                        'outstanding_amount': 0,
                        'invoice_count': 0
                    })
                    continue

                if invoices_response.status_code == 200:
                    invoices_data = invoices_response.json()
                    invoices = invoices_data.get('data', [])

                    total_outstanding = sum(float(invoice.get('outstanding_amount', 0)) for invoice in invoices)

                    balances.append({
                        'name': supplier_name,
                        'outstanding_amount': total_outstanding,
                        'invoice_count': len(invoices)
                    })

                    print(f"✅ Saldo calculado para {supplier_name}: ${total_outstanding} (de {len(invoices)} facturas)")
                else:
                    print(f"❌ Error obteniendo facturas para {supplier_name}: {invoices_response.status_code}")
                    balances.append({
                        'name': supplier_name,
                        'outstanding_amount': 0,
                        'invoice_count': 0
                    })

            except Exception as e:
                print(f"❌ Error calculando saldo para proveedor {supplier_name}: {e}")
                balances.append({
                    'name': supplier_name,
                    'outstanding_amount': 0,
                    'invoice_count': 0
                })

        print(f"Saldos calculados para {len(balances)} proveedores")

        return jsonify({
            "success": True,
            "balances": balances,
            "message": "Saldos obtenidos correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en get_suppliers_balances: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@suppliers_bp.route('/api/suppliers/<supplier_name>/purchase-receipts', methods=['GET'])
def get_supplier_purchase_receipts(supplier_name):
    """Obtiene los remitos de un proveedor con paginación"""
    print(f"\n--- Petición de obtener remitos del proveedor {supplier_name} ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa configurada para el usuario {user_id}")
            return jsonify({"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}), 400

        print(f"Compañía activa: {company_name}")

        # Obtener parámetros de paginación
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 20))
        limit_start = (page - 1) * page_size

        print(f"Paginación: página {page}, tamaño {page_size}, inicio {limit_start}")

        # Obtener sigla de la compañía para agregar al supplier
        company_abbr = get_company_abbr(session, headers, company_name)
        docstatus_param = request.args.get('docstatus')
        docstatus_filter = None
        if docstatus_param is not None:
            try:
                docstatus_filter = int(docstatus_param)
            except ValueError:
                return jsonify({"success": False, "message": "docstatus debe ser numérico"}), 400

        # Preparar filtros para Purchase Receipt
        search_supplier_name = supplier_name
        if company_abbr:
            search_supplier_name = add_company_abbr(supplier_name, company_abbr)
            print(f"🏷️ Searching receipts for supplier with abbr: {search_supplier_name}")

        base_filters = [
            ['supplier', '=', search_supplier_name],
            ['company', '=', company_name]
        ]
        if docstatus_filter is not None:
            base_filters.append(['docstatus', '=', docstatus_filter])

        filters = json.dumps(base_filters)

        # Primero obtener el conteo total
        params_count = {
            'doctype': 'Purchase Receipt',
            'filters': filters
        }
        count_response, count_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/method/frappe.client.get_count",
            params=params_count,
            operation_name=f"Get total count of purchase receipts for supplier '{search_supplier_name}'"
        )

        if count_error:
            return handle_erpnext_error(count_error, f"Error obteniendo conteo de remitos del proveedor '{supplier_name}'")

        total_count = 0
        if count_response.status_code == 200:
            count_data = count_response.json()
            total_count = count_data.get('message', 0)

        print(f"Total de remitos encontrados: {total_count}")

        # Obtener la página correspondiente de remitos
        fields = json.dumps([
            "name", "posting_date", "status", "docstatus", "supplier",
            "grand_total", "total_qty", "custom_estado_remito", "per_billed", "is_return"
        ])

        params_receipts = {
            'filters': filters,
            'fields': fields,
            'limit_start': limit_start,
            'limit_page_length': page_size,
            'order_by': 'posting_date desc'
        }
        receipts_response, receipts_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Purchase Receipt",
            params=params_receipts,
            operation_name=f"Get purchase receipts page {page} for supplier '{search_supplier_name}'"
        )

        if receipts_error:
            return handle_erpnext_error(receipts_error, f"Error obteniendo remitos del proveedor '{supplier_name}'")

        receipts = []
        if receipts_response.status_code == 200:
            receipts_data = receipts_response.json()
            receipts = receipts_data.get('data', [])

            # Remover sigla del supplier antes de enviar al frontend
            if company_abbr:
                for receipt in receipts:
                    if 'supplier' in receipt and receipt['supplier']:
                        receipt['supplier'] = remove_company_abbr(receipt['supplier'], company_abbr)
                        print(f"🏷️ Cleaned supplier name in receipt: {receipt['supplier']}")

        print(f"Remitos obtenidos para {supplier_name}: {len(receipts)} de {total_count}")

        return jsonify({
            "success": True,
            "receipts": receipts,
            "total_count": total_count,
            "page": page,
            "page_size": page_size,
            "message": "Remitos obtenidos correctamente"
        })

    except Exception as e:
        print(f"ERROR GENERAL en get_supplier_purchase_receipts: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
