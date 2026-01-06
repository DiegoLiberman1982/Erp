"""
Setup - Customer and Supplier Groups
Handles creation of customer and supplier groups with company association via custom fields
"""

import json
import traceback
from flask import jsonify
from urllib.parse import quote

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar función para obtener sigla de compañía
from routes.general import get_company_abbr


def create_groups_custom_fields(session, headers):
    """
    Crea campos custom 'custom_company' en Customer Group y Supplier Group
    para asociar grupos a compañías específicas.
    
    Returns:
        tuple: (success: bool, customer_field_exists: bool, supplier_field_exists: bool)
    """
    print("\n--- Creando campos custom para grupos ---")
    
    custom_fields = [
        {
            "dt": "Customer Group",
            "label": "Compañía",
            "fieldname": "custom_company",
            "fieldtype": "Link",
            "options": "Company",
            "insert_after": "customer_group_name"
        },
        {
            "dt": "Supplier Group",
            "label": "Compañía",
            "fieldname": "custom_company",
            "fieldtype": "Link",
            "options": "Company",
            "insert_after": "supplier_group_name"
        }
    ]
    
    customer_field_exists = False
    supplier_field_exists = False
    
    for field_data in custom_fields:
        try:
            fieldname = field_data['fieldname']
            dt = field_data['dt']
            
            # Verificar si el campo ya existe
            filters_list = [["fieldname", "=", fieldname], ["dt", "=", dt]]
            check_resp, check_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Custom Field",
                params={"filters": json.dumps(filters_list), "limit_page_length": 1},
                operation_name=f"Check Custom Field {fieldname} in {dt}"
            )
            
            if check_err:
                print(f"Error verificando campo custom '{fieldname}' en '{dt}': {check_err}")
                continue
            
            if check_resp.status_code == 200:
                check_data = check_resp.json()
                if check_data.get('data'):
                    print(f"Campo custom '{fieldname}' en '{dt}' ya existe ✓")
                    if dt == "Customer Group":
                        customer_field_exists = True
                    else:
                        supplier_field_exists = True
                    continue
            
            # Crear el campo custom
            print(f"Creando campo custom '{fieldname}' en '{dt}'...")
            create_resp, create_err = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/Custom Field",
                data=field_data,
                operation_name=f"Create Custom Field {fieldname} in {dt}"
            )
            
            if create_err:
                if create_err.get('status_code') == 409:
                    print(f"Campo custom '{fieldname}' en '{dt}' ya existe (ignorando)")
                    if dt == "Customer Group":
                        customer_field_exists = True
                    else:
                        supplier_field_exists = True
                else:
                    print(f"Error creando campo '{fieldname}' en '{dt}': {create_err}")
            else:
                if create_resp.status_code in [200, 201]:
                    print(f"Campo custom '{fieldname}' en '{dt}' creado exitosamente ✓")
                    if dt == "Customer Group":
                        customer_field_exists = True
                    else:
                        supplier_field_exists = True
                else:
                    print(f"Error creando campo '{fieldname}': {create_resp.status_code} - {create_resp.text}")
        
        except Exception as e:
            print(f"Error procesando campo custom '{field_data['fieldname']}': {e}")
            continue
    
    success = customer_field_exists and supplier_field_exists
    return success, customer_field_exists, supplier_field_exists


def ensure_customer_groups_exist(session, headers, company_name):
    """
    Asegura que existan los grupos de clientes necesarios para la compañía.
    Usa el campo custom_company para filtrar por compañía.
    
    Args:
        session: Sesión de requests
        headers: Headers HTTP
        company_name: Nombre de la compañía
    
    Returns:
        bool: True si se configuraron correctamente los grupos
    """
    print(f"\n--- Configurando Grupos de Clientes para {company_name} ---")
    
    try:
        # Obtener abreviatura de la compañía
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            print("ERROR: No se pudo obtener la abreviatura de la compañía")
            return False
        
        print(f"Abreviatura de compañía: {company_abbr}")
        
        # Verificar si ya existen grupos para esta compañía
        filters_list = [["custom_company", "=", company_name]]
        check_resp, check_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Customer Group",
            params={
                "filters": json.dumps(filters_list),
                "fields": json.dumps(["name", "customer_group_name", "custom_company"]),
                "limit_page_length": 10
            },
            operation_name=f"Check existing Customer Groups for {company_name}"
        )
        
        if check_err:
            print(f"Error verificando grupos existentes: {check_err}")
            return False
        
        existing_groups = []
        if check_resp.status_code == 200:
            data = check_resp.json()
            existing_groups = data.get('data', [])
            if existing_groups:
                print(f"Se encontraron {len(existing_groups)} grupos existentes para {company_name}")
                for group in existing_groups:
                    print(f"  - {group.get('customer_group_name')}")
        
        # Definir grupos a crear
        groups_to_create = [
            {
                "customer_group_name": f"Grupos de Clientes - {company_abbr}",
                "is_group": 1,
                "parent_customer_group": "",
                "custom_company": company_name
            },
            {
                "customer_group_name": f"Clientes Generales - {company_abbr}",
                "is_group": 0,
                "parent_customer_group": f"Grupos de Clientes - {company_abbr}",
                "custom_company": company_name
            }
        ]
        
        # Crear grupos que no existan
        for group in groups_to_create:
            try:
                group_name = group["customer_group_name"]
                
                # Verificar si este grupo específico ya existe
                filters_check = [["customer_group_name", "=", group_name]]
                check_group_resp, check_group_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Customer Group",
                    params={
                        "filters": json.dumps(filters_check),
                        "fields": json.dumps(["name", "custom_company"]),
                        "limit_page_length": 1
                    },
                    operation_name=f"Check Customer Group '{group_name}'"
                )
                
                if check_group_err:
                    print(f"Error verificando grupo '{group_name}': {check_group_err}")
                    continue
                
                if check_group_resp.status_code == 200:
                    data = check_group_resp.json()
                    existing = data.get('data', [])
                    if existing:
                        existing_group = existing[0]
                        # Si existe pero no tiene compañía asignada, actualizarla
                        if not existing_group.get('custom_company'):
                            print(f"Actualizando grupo '{group_name}' con compañía {company_name}...")
                            encoded_name = quote(group_name)
                            update_data = {
                                "custom_company": company_name
                            }
                            update_resp, update_err = make_erpnext_request(
                                session=session,
                                method="PUT",
                                endpoint=f"/api/resource/Customer Group/{encoded_name}",
                                data=update_data,
                                operation_name=f"Update Customer Group '{group_name}' with company"
                            )
                            if update_err:
                                print(f"Error actualizando grupo: {update_err}")
                            elif update_resp.status_code == 200:
                                print(f"Grupo '{group_name}' actualizado con compañía ✓")
                        else:
                            print(f"Grupo '{group_name}' ya existe ✓")
                        continue
                
                # Crear el grupo
                print(f"Creando grupo '{group_name}'...")
                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Customer Group",
                    data={"data": group},
                    operation_name=f"Create Customer Group '{group_name}'"
                )
                
                if create_err:
                    print(f"Error creando grupo '{group_name}': {create_err}")
                    continue
                
                if create_resp.status_code in [200, 201]:
                    print(f"Grupo '{group_name}' creado exitosamente ✓")
                else:
                    print(f"Error creando grupo: {create_resp.status_code} - {create_resp.text}")
            
            except Exception as e:
                print(f"Error procesando grupo '{group['customer_group_name']}': {e}")
                continue
        
        print("Grupos de clientes configurados exitosamente ✓")
        return True
    
    except Exception as e:
        print(f"Error en ensure_customer_groups_exist: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return False


def ensure_supplier_groups_exist(session, headers, company_name):
    """
    Asegura que existan los grupos de proveedores necesarios para la compañía.
    Usa el campo custom_company para filtrar por compañía.
    
    Args:
        session: Sesión de requests
        headers: Headers HTTP
        company_name: Nombre de la compañía
    
    Returns:
        bool: True si se configuraron correctamente los grupos
    """
    print(f"\n--- Configurando Grupos de Proveedores para {company_name} ---")
    
    try:
        # Obtener abreviatura de la compañía
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            print("ERROR: No se pudo obtener la abreviatura de la compañía")
            return False
        
        print(f"Abreviatura de compañía: {company_abbr}")
        
        # Verificar si ya existen grupos para esta compañía
        filters_list = [["custom_company", "=", company_name]]
        check_resp, check_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Supplier Group",
            params={
                "filters": json.dumps(filters_list),
                "fields": json.dumps(["name", "supplier_group_name", "custom_company"]),
                "limit_page_length": 10
            },
            operation_name=f"Check existing Supplier Groups for {company_name}"
        )
        
        if check_err:
            print(f"Error verificando grupos existentes: {check_err}")
            return False
        
        existing_groups = []
        if check_resp.status_code == 200:
            data = check_resp.json()
            existing_groups = data.get('data', [])
            if existing_groups:
                print(f"Se encontraron {len(existing_groups)} grupos existentes para {company_name}")
                for group in existing_groups:
                    print(f"  - {group.get('supplier_group_name')}")
        
        # Definir grupos a crear
        groups_to_create = [
            {
                "supplier_group_name": f"Grupos de Proveedores - {company_abbr}",
                "is_group": 1,
                "parent_supplier_group": "",
                "custom_company": company_name
            },
            {
                "supplier_group_name": f"Proveedores Generales - {company_abbr}",
                "is_group": 0,
                "parent_supplier_group": f"Grupos de Proveedores - {company_abbr}",
                "custom_company": company_name
            }
        ]
        
        # Crear grupos que no existan
        for group in groups_to_create:
            try:
                group_name = group["supplier_group_name"]
                
                # Verificar si este grupo específico ya existe
                filters_check = [["supplier_group_name", "=", group_name]]
                check_group_resp, check_group_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Supplier Group",
                    params={
                        "filters": json.dumps(filters_check),
                        "fields": json.dumps(["name", "custom_company"]),
                        "limit_page_length": 1
                    },
                    operation_name=f"Check Supplier Group '{group_name}'"
                )
                
                if check_group_err:
                    print(f"Error verificando grupo '{group_name}': {check_group_err}")
                    continue
                
                if check_group_resp.status_code == 200:
                    data = check_group_resp.json()
                    existing = data.get('data', [])
                    if existing:
                        existing_group = existing[0]
                        # Si existe pero no tiene compañía asignada, actualizarla
                        if not existing_group.get('custom_company'):
                            print(f"Actualizando grupo '{group_name}' con compañía {company_name}...")
                            encoded_name = quote(group_name)
                            update_data = {
                                "custom_company": company_name
                            }
                            update_resp, update_err = make_erpnext_request(
                                session=session,
                                method="PUT",
                                endpoint=f"/api/resource/Supplier Group/{encoded_name}",
                                data=update_data,
                                operation_name=f"Update Supplier Group '{group_name}' with company"
                            )
                            if update_err:
                                print(f"Error actualizando grupo: {update_err}")
                            elif update_resp.status_code == 200:
                                print(f"Grupo '{group_name}' actualizado con compañía ✓")
                        else:
                            print(f"Grupo '{group_name}' ya existe ✓")
                        continue
                
                # Crear el grupo
                print(f"Creando grupo '{group_name}'...")
                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Supplier Group",
                    data={"data": group},
                    operation_name=f"Create Supplier Group '{group_name}'"
                )
                
                if create_err:
                    print(f"Error creando grupo '{group_name}': {create_err}")
                    continue
                
                if create_resp.status_code in [200, 201]:
                    print(f"Grupo '{group_name}' creado exitosamente ✓")
                else:
                    print(f"Error creando grupo: {create_resp.status_code} - {create_resp.text}")
            
            except Exception as e:
                print(f"Error procesando grupo '{group['supplier_group_name']}': {e}")
                continue
        
        print("Grupos de proveedores configurados exitosamente ✓")
        return True
    
    except Exception as e:
        print(f"Error en ensure_supplier_groups_exist: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return False


def setup_all_groups(session, headers, company_name):
    """
    Configura todos los grupos (clientes y proveedores) para una compañía.
    
    Proceso:
    1. Crear campos custom 'custom_company' en Customer Group y Supplier Group (si no existen)
    2. Si los campos ya existían, verificar si hay grupos para esta compañía
    3. Crear los grupos necesarios con la compañía asignada
    
    Args:
        session: Sesión de requests
        headers: Headers HTTP
        company_name: Nombre de la compañía
    
    Returns:
        bool: True si todo se configuró correctamente
    """
    print(f"\n=== CONFIGURANDO GRUPOS PARA COMPAÑÍA: {company_name} ===")
    
    try:
        # Paso 1: Crear campos custom
        print("Paso 1: Creando/Verificando campos custom...")
        success, customer_field_exists, supplier_field_exists = create_groups_custom_fields(session, headers)
        
        if not success:
            print("ERROR: No se pudieron crear los campos custom necesarios")
            return False
        
        print("Campos custom verificados ✓")
        
        # Paso 2: Configurar grupos de clientes
        print("\nPaso 2: Configurando grupos de clientes...")
        customer_groups_success = ensure_customer_groups_exist(session, headers, company_name)
        if not customer_groups_success:
            print("Error configurando grupos de clientes")
            return False
        
        # Paso 3: Configurar grupos de proveedores
        print("\nPaso 3: Configurando grupos de proveedores...")
        supplier_groups_success = ensure_supplier_groups_exist(session, headers, company_name)
        if not supplier_groups_success:
            print("Error configurando grupos de proveedores")
            return False
        
        print("\n=== GRUPOS CONFIGURADOS EXITOSAMENTE ===")
        return True
    
    except Exception as e:
        print(f"Error en setup_all_groups: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return False
