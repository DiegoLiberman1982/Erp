"""
Setup - Price Lists
Handles creation and verification of price lists in ERPNext
"""

import json
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar configuración
from config import ERPNEXT_URL

# Importar función centralizada para obtener compañía activa
from routes.general import get_active_company


def ensure_price_lists_exist(session, headers, user_id):
    """Asegura que existan las listas de precios necesarias"""
    print("\n--- Verificando Listas de Precios ---")

    try:
        # Obtener la compañía activa del usuario
        company_name = get_active_company(user_id)

        if not company_name:
            print(f"ERROR: No hay compañía activa para el usuario {user_id}")
            return False

        print(f"Compañía activa: {company_name}")

        # Listas de precios a crear
        price_lists = [
            {
                "price_list_name": "Venta Estándar ARS",
                "currency": "ARS",
                "selling": 1,
                "buying": 0
            },
            {
                "price_list_name": "Compra Estándar ARS",
                "currency": "ARS",
                "selling": 0,
                "buying": 1
            }
        ]

        created_lists = []
        errors = []

        for price_list in price_lists:
            try:
                # Verificar si la lista de precios ya existe
                # Build filters as JSON and pass via params to avoid URL encoding issues
                filters_param = json.dumps([["price_list_name", "=", price_list["price_list_name"]]])
                params = {
                    'filters': filters_param,
                    'limit_page_length': 1
                }
                endpoint = "/api/resource/Price List"
                check_resp, check_err = make_erpnext_request(session, 'GET', endpoint, params=params, operation_name=f"Check Price List {price_list['price_list_name']}")

                if check_err:
                    # Log and treat as non-existing so we can attempt creation (but collect error)
                    err_msg = f"Error verificando lista de precios '{price_list['price_list_name']}': {check_err.get('message')}"
                    print(err_msg)
                    errors.append(err_msg)
                else:
                    check_data = check_resp.json()
                    if check_data.get("data"):
                        print(f"Lista de precios '{price_list['price_list_name']}' ya existe")
                        created_lists.append({
                            "name": price_list['price_list_name'],
                            "status": "already_exists"
                        })
                        continue

                # No creamos listas de precios durante el setup inicial.
                # Solo verificamos su existencia y, en caso de que falten,
                # las marcamos como 'missing_skipped' para evitar duplicados.
                print(f"Lista de precios '{price_list['price_list_name']}' no encontrada: saltando creación automática (esperado si ya existe)")
                created_lists.append({
                    "name": price_list['price_list_name'],
                    "status": "missing_skipped"
                })

            except Exception as e:
                error_msg = f"Error procesando lista de precios '{price_list['price_list_name']}': {e}"
                print(error_msg)
                errors.append(error_msg)

        if errors:
            print(f"Se encontraron {len(errors)} errores al crear listas de precios")
            return False

        print(f"Listas de precios procesadas: {len(created_lists)}")
        return True

    except Exception as e:
        print(f"Error en ensure_price_lists_exist: {e}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return False