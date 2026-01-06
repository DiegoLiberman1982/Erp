"""
Setup - IVA Tax Accounts
Handles creation and update of IVA tax accounts per rate in ERPNext.
Must be run BEFORE ensure_item_tax_templates_exist.

NUMERACIÓN - Todas las cuentas son HERMANAS (mismo parent):
- Crédito Fiscal: parent 1.1.4.01.00 - CRÉDITOS IMPOSITIVOS CORRIENTES
  - 1.1.4.01.05 (21% - existente, se renombra)
  - 1.1.4.01.20 (0%), 1.1.4.01.21 (2.5%), 1.1.4.01.22 (5%), etc.
- Débito Fiscal: parent 2.1.3.01.00 - IMPUESTO AL VALOR AGREGADO
  - 2.1.3.01.01 (21% - existente, se renombra)
  - 2.1.3.01.20 (0%), 2.1.3.01.21 (2.5%), 2.1.3.01.22 (5%), etc.
"""

import json
import traceback
from urllib.parse import quote

from utils.http_utils import make_erpnext_request
from routes.general import get_company_abbr, get_active_company


# Tasas de IVA oficiales de Argentina
IVA_RATES = [0.0, 2.5, 5.0, 10.5, 17.1, 21.0, 27.0]

# Mapeo de tasas a números de cuenta
# TODAS las cuentas son HERMANAS (mismo parent), NO hijas de la de 21%
# Usamos números altos (20+) para evitar conflictos con cuentas existentes
IVA_ACCOUNT_NUMBERS = {
    # Crédito Fiscal (Compras) - parent: 1.1.4.01.00 CRÉDITOS IMPOSITIVOS CORRIENTES
    "credito": {
        21.0: "1.1.4.01.05",    # Existente, se renombra agregando %
        0.0: "1.1.4.01.20",     # Nueva - hermana
        2.5: "1.1.4.01.21",     # Nueva - hermana
        5.0: "1.1.4.01.22",     # Nueva - hermana
        10.5: "1.1.4.01.23",    # Nueva - hermana
        17.1: "1.1.4.01.24",    # Nueva - hermana
        27.0: "1.1.4.01.25",    # Nueva - hermana
    },
    # Débito Fiscal (Ventas) - parent: 2.1.3.01.00 IMPUESTO AL VALOR AGREGADO
    "debito": {
        21.0: "2.1.3.01.01",    # Existente, se renombra agregando %
        0.0: "2.1.3.01.20",     # Nueva - hermana
        2.5: "2.1.3.01.21",     # Nueva - hermana
        5.0: "2.1.3.01.22",     # Nueva - hermana
        10.5: "2.1.3.01.23",    # Nueva - hermana
        17.1: "2.1.3.01.24",    # Nueva - hermana
        27.0: "2.1.3.01.25",    # Nueva - hermana
    }
}

# Cuentas PADRE (para TODAS las cuentas de IVA, incluyendo la de 21%)
PARENT_ACCOUNTS = {
    "credito": "1.1.4.01.00",  # CRÉDITOS IMPOSITIVOS CORRIENTES
    "debito": "2.1.3.01.00",   # IMPUESTO AL VALOR AGREGADO
}

# Nombres de los parent accounts (sin abbr, se agrega dinámicamente)
PARENT_ACCOUNT_NAMES = {
    "credito": "CRÉDITOS IMPOSITIVOS CORRIENTES",
    "debito": "IMPUESTO AL VALOR AGREGADO",
}


def get_iva_account_name(tipo: str, rate: float, company_abbr: str) -> str:
    """
    Genera el nombre completo de la cuenta de IVA.
    tipo: 'credito' o 'debito'
    rate: tasa de IVA (ej: 21.0)
    company_abbr: abreviatura de la compañía (ej: 'MS')
    """
    account_number = IVA_ACCOUNT_NUMBERS[tipo][rate]
    if tipo == "credito":
        account_name = f"IVA Crédito Fiscal {rate}%"
    else:
        account_name = f"IVA Débito Fiscal {rate}%"
    return f"{account_number} - {account_name} - {company_abbr}"


def get_iva_account_short_name(tipo: str, rate: float) -> str:
    """
    Genera el nombre corto de la cuenta de IVA (sin número ni abbr).
    """
    if tipo == "credito":
        return f"IVA Crédito Fiscal {rate}%"
    else:
        return f"IVA Débito Fiscal {rate}%"


def ensure_iva_tax_accounts_exist(session, headers, user_id):
    """
    Asegura que existan todas las cuentas de IVA por tasa para la compañía.
    
    TODAS las cuentas son HERMANAS (mismo parent):
    - Crédito: parent 1.1.4.01.00 - CRÉDITOS IMPOSITIVOS CORRIENTES
    - Débito: parent 2.1.3.01.00 - IMPUESTO AL VALOR AGREGADO
    
    La cuenta de 21% ya existe, se renombra agregando el %.
    Las demás se crean nuevas.
    
    Debe ejecutarse ANTES de ensure_item_tax_templates_exist.
    """
    print("\n--- Verificando/Creando Cuentas de IVA por Tasa ---")
    
    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)
        
        if not company_name:
            print(f"ERROR: No hay compañía activa configurada para el usuario {user_id}")
            return {"success": False, "message": f"No hay compañía activa configurada para el usuario {user_id}"}
        
        print(f"Compañía activa: {company_name}")
        
        # Obtener la abreviatura de la compañía
        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return {"success": False, "message": "Error obteniendo abreviatura de la compañía"}
        
        print(f"Abreviatura de compañía: {company_abbr}")
        
        created_accounts = []
        updated_accounts = []
        errors = []
        
        # Procesar ambos tipos de cuentas
        for tipo in ["credito", "debito"]:
            tipo_nombre = "Crédito" if tipo == "credito" else "Débito"
            parent_number = PARENT_ACCOUNTS[tipo]
            parent_name = PARENT_ACCOUNT_NAMES[tipo]
            parent_full_name = f"{parent_number} - {parent_name} - {company_abbr}"
            
            print(f"\n{'='*60}")
            print(f"Procesando cuentas de IVA {tipo.upper()} FISCAL")
            print(f"Parent: {parent_full_name}")
            print(f"{'='*60}")
            
            # Procesar TODAS las tasas (incluyendo 21%)
            for rate in IVA_RATES:
                account_number = IVA_ACCOUNT_NUMBERS[tipo][rate]
                account_short_name = get_iva_account_short_name(tipo, rate)
                
                print(f"\n   Procesando tasa {rate}%:")
                print(f"      Número: {account_number}")
                print(f"      Nombre: {account_short_name}")
                
                # Buscar si ya existe una cuenta con este número
                search_resp, search_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Account",
                    params={
                        "filters": json.dumps([
                            ["company", "=", company_name],
                            ["account_number", "=", account_number]
                        ]),
                        "fields": json.dumps(["name", "account_name", "account_type"]),
                        "limit_page_length": 1
                    },
                    operation_name=f"Search IVA Account {account_number}"
                )
                
                if search_err:
                    error_msg = f"Error buscando cuenta {account_number}: {search_err.get('message', str(search_err))}"
                    print(f"      ERROR: {error_msg}")
                    errors.append(error_msg)
                    continue
                
                existing_accounts = search_resp.json().get("data", []) if search_resp.status_code == 200 else []
                
                if existing_accounts:
                    # La cuenta existe
                    existing = existing_accounts[0]
                    existing_name = existing.get("name", "")
                    existing_account_name = existing.get("account_name", "")
                    account_type = existing.get("account_type", "")
                    
                    print(f"      Encontrada: {existing_name}")
                    
                    # Para la de 21%, verificar si necesita renombrarse (agregar %)
                    if rate == 21.0 and f"{rate}%" not in existing_account_name:
                        print(f"      Renombrando a '{account_short_name}'...")
                        
                        update_resp, update_err = make_erpnext_request(
                            session=session,
                            method="POST",
                            endpoint="/api/method/erpnext.accounts.doctype.account.account.update_account_number",
                            data={
                                "account_number": account_number,
                                "account_name": account_short_name,
                                "name": existing_name
                            },
                            operation_name=f"Rename Account {account_number}"
                        )
                        
                        if update_err:
                            print(f"      ADVERTENCIA: No se pudo renombrar: {update_err}")
                        elif update_resp.status_code == 200:
                            new_name = f"{account_number} - {account_short_name} - {company_abbr}"
                            print(f"      ✅ Renombrada a: {new_name}")
                            updated_accounts.append({
                                "old_name": existing_name,
                                "new_name": new_name,
                                "rate": rate,
                                "tipo": tipo
                            })
                        else:
                            print(f"      ADVERTENCIA: Error renombrando: {update_resp.text}")
                    
                    # Asegurar que account_type sea "Tax"
                    if account_type != "Tax":
                        print(f"      Actualizando account_type a 'Tax'...")
                        update_type_resp, update_type_err = make_erpnext_request(
                            session=session,
                            method="PUT",
                            endpoint=f"/api/resource/Account/{quote(existing_name, safe='')}",
                            data={"data": {"account_type": "Tax"}},
                            operation_name=f"Update Account Type {account_number}"
                        )
                        if update_type_resp and update_type_resp.status_code == 200:
                            print(f"      ✅ account_type actualizado")
                    
                else:
                    # La cuenta NO existe, crearla
                    print(f"      Creando cuenta nueva...")
                    
                    result = _create_iva_account(
                        session, company_name, company_abbr,
                        tipo, rate, account_number, account_short_name,
                        parent_full_name
                    )
                    
                    if result.get("success"):
                        created_accounts.append(result.get("account"))
                        print(f"      ✅ Creada: {result.get('account', {}).get('name')}")
                    else:
                        errors.append(result.get("error"))
                        print(f"      ❌ Error: {result.get('error')}")
        
        # Resultado final
        result = {
            "success": len(errors) == 0,
            "created_accounts": created_accounts,
            "updated_accounts": updated_accounts,
            "errors": errors,
            "message": f"Cuentas creadas: {len(created_accounts)}, actualizadas: {len(updated_accounts)}, errores: {len(errors)}"
        }
        
        print(f"\n{'='*60}")
        print(f"RESULTADO FINAL: {result['message']}")
        print(f"{'='*60}")
        
        return result
        
    except Exception as e:
        print(f"ERROR GENERAL en ensure_iva_tax_accounts_exist: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return {"success": False, "message": f"Error interno del servidor: {str(e)}"}


def _create_iva_account(session, company_name, company_abbr, tipo, rate, account_number, account_short_name, parent_account_name):
    """
    Crea una cuenta de IVA en ERPNext.
    """
    account_data = {
        "doctype": "Account",
        "account_name": account_short_name,
        "account_number": account_number,
        "company": company_name,
        "parent_account": parent_account_name,
        "account_type": "Tax",
        "is_group": 0,
        "root_type": "Asset" if tipo == "credito" else "Liability"
    }
    
    create_resp, create_err = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/Account",
        data={"data": account_data},
        operation_name=f"Create IVA Account {account_number}"
    )
    
    if create_err:
        error_msg = f"Error creando cuenta {account_number}: {create_err.get('message', str(create_err))}"
        print(f"      ERROR: {error_msg}")
        return {"success": False, "error": error_msg}
    
    if create_resp.status_code == 200:
        created_data = create_resp.json().get("data", {})
        print(f"      Cuenta creada: {created_data.get('name', account_number)}")
        return {
            "success": True,
            "account": {
                "name": created_data.get("name"),
                "account_number": account_number,
                "account_name": account_short_name,
                "rate": rate,
                "tipo": tipo
            }
        }
    else:
        error_msg = f"Error creando cuenta {account_number}: {create_resp.status_code} - {create_resp.text}"
        print(f"      ERROR: {error_msg}")
        return {"success": False, "error": error_msg}


def get_iva_accounts_map(session, headers, company_name, company_abbr):
    """
    Obtiene un mapa de todas las cuentas de IVA existentes para la compañía.
    Retorna un diccionario con estructura:
    {
        "credito": {
            21.0: "1.1.4.01.05 - IVA Crédito Fiscal 21% - MS",
            ...
        },
        "debito": {
            21.0: "2.1.3.01.01 - IVA Débito Fiscal 21% - MS",
            ...
        }
    }
    """
    result = {"credito": {}, "debito": {}}
    
    for tipo in ["credito", "debito"]:
        for rate in IVA_RATES:
            account_number = IVA_ACCOUNT_NUMBERS[tipo][rate]
            
            search_resp, search_err = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Account",
                params={
                    "filters": json.dumps([
                        ["company", "=", company_name],
                        ["account_number", "=", account_number]
                    ]),
                    "fields": json.dumps(["name"]),
                    "limit_page_length": 1
                },
                operation_name=f"Get IVA Account {account_number}"
            )
            
            if not search_err and search_resp.status_code == 200:
                accounts = search_resp.json().get("data", [])
                if accounts:
                    result[tipo][rate] = accounts[0]["name"]
    
    return result
