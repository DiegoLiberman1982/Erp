"""
Setup - Units of Measurement (UOM)
Handles creation and verification of units of measurement in ERPNext
"""

from urllib.parse import quote
import json

# Importar configuración
from config import ERPNEXT_URL

from utils.http_utils import make_erpnext_request, handle_erpnext_error


def ensure_uom_exists(session, headers, user_id):
    """Asegura que existan las unidades de medida básicas"""
    print("\n--- Verificando Unidades de Medida Básicas ---")

    # Lista de UOMs básicas a crear
    basic_uoms = [
        {"uom_name": "Unit", "must_be_whole_number": 1},
        {"uom_name": "Kg", "must_be_whole_number": 0},
        {"uom_name": "Mtr", "must_be_whole_number": 0},
        {"uom_name": "Ltr", "must_be_whole_number": 0},
        {"uom_name": "Nos", "must_be_whole_number": 1},
        {"uom_name": "Box", "must_be_whole_number": 1},
        {"uom_name": "Pair", "must_be_whole_number": 1},
        {"uom_name": "Set", "must_be_whole_number": 1},
        {"uom_name": "Pcs", "must_be_whole_number": 1},
        {"uom_name": "Roll", "must_be_whole_number": 1}
    ]

    try:
        for uom_data in basic_uoms:
            uom_name = uom_data["uom_name"]
            print(f"Verificando si existe '{uom_name}'...")

            # Verificar si existe la UOM
            params = {
                'filters': json.dumps([["uom_name", "=", uom_name]]),
                'limit_page_length': 1
            }
            endpoint = "/api/resource/UOM"
            response, resp_err = make_erpnext_request(session, 'GET', endpoint, params=params, operation_name=f"Check UOM {uom_name}")

            if resp_err:
                print(f"Error verificando '{uom_name}': {resp_err.get('message')}")
                return False

            if response.status_code == 200:
                data = response.json()
                if data.get("data"):
                    print(f"'{uom_name}' ya existe")
                    continue
                else:
                    # Crear la UOM
                    print(f"Creando '{uom_name}'...")
                    endpoint = "/api/resource/UOM"
                    create_response, create_err = make_erpnext_request(session, 'POST', endpoint, data={"data": uom_data}, operation_name=f"Create UOM {uom_name}")

                    if create_err:
                        print(f"Error creando '{uom_name}': {create_err.get('message')}")
                        return False

                    if create_response.status_code == 200:
                        print(f"'{uom_name}' creada exitosamente")
                    else:
                        print(f"Error creando '{uom_name}': {create_response.status_code} - {create_response.text}")
                        return False
            else:
                print(f"Error verificando '{uom_name}': {response.status_code}")
                return False

        print("Todas las UOMs básicas han sido verificadas/creadas")
        return True

    except Exception as e:
        print(f"Error en ensure_uom_exists: {e}")
        return False