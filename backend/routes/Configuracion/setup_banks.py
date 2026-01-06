"""
Módulo para la gestión de bancos y billeteras digitales en ERPNext.

Este módulo contiene funciones para crear, listar e inicializar bancos argentinos
y billeteras digitales según los requerimientos de AFIP y el sistema bancario argentino.

Funciones principales:
- create_banks: Crea bancos argentinos y billeteras digitales
- list_banks: Lista todos los bancos disponibles en ERPNext
- initialize_banks: Inicializa bancos y billeteras digitales
"""

import json
from flask import jsonify
from urllib.parse import quote
from routes.auth_utils import get_session_with_auth
# central HTTP utilities
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Bancos argentinos con códigos BCRA
ARGENTINE_BANKS = [
    {"code": "00007", "name": "BANCO DE GALICIA Y BUENOS AIRES S.A."},
    {"code": "00015", "name": "INDUSTRIAL AND COMMERCIAL BANK OF CHINA"},
    {"code": "00016", "name": "CITIBANK N.A."},
    {"code": "00017", "name": "BANCO BBVA ARGENTINA S.A."},
    {"code": "00027", "name": "BANCO SUPERVIELLE S.A."},
    {"code": "00034", "name": "BANCO PATAGONIA S.A."},
    {"code": "00044", "name": "BANCO HIPOTECARIO S.A."},
    {"code": "00045", "name": "BANCO DE SAN JUAN S.A."},
    {"code": "00072", "name": "BANCO SANTANDER ARGENTINA S.A."},
    {"code": "00086", "name": "BANCO DE SANTA CRUZ S.A."},
    {"code": "00131", "name": "BANK OF CHINA LIMITED SUCURSAL BUENOS AI"},
    {"code": "00143", "name": "BRUBANK S.A.U."},
    {"code": "00147", "name": "BIBANK S.A."},
    {"code": "00165", "name": "JPMORGAN CHASE BANK, NATIONAL ASSOCIATIO"},
    {"code": "00191", "name": "BANCO CREDICOOP COOPERATIVO LIMITADO"},
    {"code": "00198", "name": "BANCO DE VALORES S.A."},
    {"code": "00247", "name": "BANCO ROELA S.A."},
    {"code": "00254", "name": "BANCO MARIVA S.A."},
    {"code": "00266", "name": "BNP PARIBAS"},
    {"code": "00269", "name": "BANCO DE LA REPUBLICA ORIENTAL DEL URUGU"},
    {"code": "00277", "name": "BANCO SAENZ S.A."},
    {"code": "00281", "name": "BANCO MERIDIAN S.A."},
    {"code": "00285", "name": "BANCO MACRO S.A."},
    {"code": "00299", "name": "BANCO COMAFI SOCIEDAD ANONIMA"},
    {"code": "00301", "name": "BANCO PIANO S.A."},
    {"code": "00305", "name": "BANCO JULIO SOCIEDAD ANONIMA"},
    {"code": "00310", "name": "BANCO DEL SOL S.A."},
    {"code": "00312", "name": "BANCO VOII S.A."},
    {"code": "00319", "name": "BANCO CMF S.A."},
    {"code": "00321", "name": "BANCO DE SANTIAGO DEL ESTERO S.A."},
    {"code": "00322", "name": "BANCO INDUSTRIAL S.A."},
    {"code": "00330", "name": "NUEVO BANCO DE SANTA FE SOCIEDAD ANONIMA"},
    {"code": "00331", "name": "BANCO CETELEM ARGENTINA S.A."},
    {"code": "00332", "name": "BANCO DE SERVICIOS FINANCIEROS S.A."},
    {"code": "00338", "name": "BANCO DE SERVICIOS Y TRANSACCIONES S.A."},
    {"code": "00339", "name": "RCI BANQUE S.A."},
    {"code": "00340", "name": "BACS BANCO DE CREDITO Y SECURITIZACION S"},
    {"code": "00341", "name": "BANCO MASVENTAS S.A."},
    {"code": "00384", "name": "UALA BANK S.A.U."},
    {"code": "00386", "name": "NUEVO BANCO DE ENTRE RÍOS S.A."},
    {"code": "00389", "name": "BANCO COLUMBIA S.A."},
    {"code": "00426", "name": "BANCO BICA S.A."},
    {"code": "00431", "name": "BANCO COINAG S.A."},
    {"code": "00432", "name": "BANCO DE COMERCIO S.A."},
    {"code": "00435", "name": "BANCO SUCREDITO REGIONAL S.A.U."},
    {"code": "00448", "name": "BANCO DINO S.A."},
    {"code": "00011", "name": "BANCO DE LA NACION ARGENTINA"},
    {"code": "00014", "name": "BANCO DE LA PROVINCIA DE BUENOS AIRES"},
    {"code": "00020", "name": "BANCO DE LA PROVINCIA DE CORDOBA S.A."},
    {"code": "00029", "name": "BANCO DE LA CIUDAD DE BUENOS AIRES"},
    {"code": "00065", "name": "BANCO MUNICIPAL DE ROSARIO"},
    {"code": "00083", "name": "BANCO DEL CHUBUT S.A."},
    {"code": "00093", "name": "BANCO DE LA PAMPA SOCIEDAD DE ECONOMÍA M"},
    {"code": "00094", "name": "BANCO DE CORRIENTES S.A."},
    {"code": "00097", "name": "BANCO PROVINCIA DEL NEUQUÉN SOCIEDAD ANÓ"},
    {"code": "00268", "name": "BANCO PROVINCIA DE TIERRA DEL FUEGO"},
    {"code": "00300", "name": "BANCO DE INVERSION Y COMERCIO EXTERIOR S"},
    {"code": "00309", "name": "BANCO RIOJA SOCIEDAD ANONIMA UNIPERSONAL"},
    {"code": "00311", "name": "NUEVO BANCO DEL CHACO S. A."},
    {"code": "00315", "name": "BANCO DE FORMOSA S.A."},
]

# Billeteras digitales
DIGITAL_WALLETS = [
    {"code": "MP", "name": "MERCADO PAGO"},
    {"code": "PP", "name": "PAYPAL"},
    {"code": "UB", "name": "ULEMONEY"},
    {"code": "TP", "name": "TODO PAGO"},
    {"code": "DM", "name": "DINERO MAIL"},
    {"code": "PM", "name": "PAGOMISCUENTAS"},
    {"code": "WM", "name": "WALLET MONEY"},
    {"code": "BM", "name": "BITCOIN MARKET"},
    {"code": "BX", "name": "BINANCE"},
    {"code": "CB", "name": "CRYPTO BANK"},
]


def create_banks():
    """
    Crear bancos argentinos y billeteras digitales en ERPNext.

    Esta función crea todos los bancos argentinos con sus códigos BCRA
    y las billeteras digitales más comunes en Argentina.

    Returns:
        Response JSON con resultado de la operación
    """
    print("=== DEBUG: create_banks called ===")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        created_banks = []
        existing_banks = []
        failed_banks = []

        # Crear bancos argentinos
        print("Creando bancos argentinos...")
        for bank in ARGENTINE_BANKS:
            try:
                # Verificar si el banco ya existe (por nombre)
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Bank/{quote(bank['name'])}",
                    custom_headers=headers,
                    operation_name=f"Check Bank {bank['name']}"
                )

                if check_err:
                    # If check fails, log and treat as non-existent so creation will be attempted
                    print(f"Error verificando banco {bank['name']}: {check_err}")
                else:
                    if check_resp.status_code == 200:
                        existing_banks.append(bank)
                        print(f"Banco ya existe: {bank['name']} ({bank['code']})")
                        continue

                # Crear el banco
                bank_data = {
                    "bank_name": bank['name'],
                    "swift_number": bank['code']
                }

                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Bank",
                    data=bank_data,
                    custom_headers=headers,
                    operation_name=f"Create Bank {bank['name']}"
                )

                if create_err:
                    # treat 409 as already exists (though unlikely for Bank creation by name)
                    if create_err.get('status_code') == 409:
                        existing_banks.append(bank)
                        print(f"Banco ya existe (conflict): {bank['name']} ({bank['code']})")
                    else:
                        failed_banks.append({"bank": bank, "error": create_err})
                        print(f"Error creando banco {bank['name']}: {create_err}")
                else:
                    if create_resp.status_code == 200:
                        created_banks.append(bank)
                        print(f"Banco creado: {bank['name']} ({bank['code']})")
                    else:
                        failed_banks.append({"bank": bank, "error": create_resp.text})
                        print(f"Error creando banco {bank['name']}: {create_resp.text}")

            except Exception as e:
                failed_banks.append({
                    "bank": bank,
                    "error": str(e)
                })
                print(f"Exception creando banco {bank['name']}: {e}")

        # Crear billeteras digitales
        print("Creando billeteras digitales...")
        for wallet in DIGITAL_WALLETS:
            try:
                # Verificar si la billetera ya existe (por nombre)
                check_resp, check_err = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint=f"/api/resource/Bank/{quote(wallet['name'])}",
                    custom_headers=headers,
                    operation_name=f"Check Wallet {wallet['name']}"
                )

                if check_err:
                    print(f"Error verificando billetera {wallet['name']}: {check_err}")
                else:
                    if check_resp.status_code == 200:
                        existing_banks.append(wallet)
                        print(f"Billetera ya existe: {wallet['name']} ({wallet['code']})")
                        continue

                # Crear la billetera
                wallet_data = {
                    "bank_name": wallet['name'],
                    "swift_number": wallet['code']
                }

                create_resp, create_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Bank",
                    data=wallet_data,
                    custom_headers=headers,
                    operation_name=f"Create Wallet {wallet['name']}"
                )

                if create_err:
                    if create_err.get('status_code') == 409:
                        existing_banks.append(wallet)
                        print(f"Billetera ya existe (conflict): {wallet['name']} ({wallet['code']})")
                    else:
                        failed_banks.append({"bank": wallet, "error": create_err})
                        print(f"Error creando billetera {wallet['name']}: {create_err}")
                else:
                    if create_resp.status_code == 200:
                        created_banks.append(wallet)
                        print(f"Billetera creada: {wallet['name']} ({wallet['code']})")
                    else:
                        failed_banks.append({"bank": wallet, "error": create_resp.text})
                        print(f"Error creando billetera {wallet['name']}: {create_resp.text}")

            except Exception as e:
                failed_banks.append({
                    "bank": wallet,
                    "error": str(e)
                })
                print(f"Exception creando billetera {wallet['name']}: {e}")

        return jsonify({
            "success": True,
            "message": f"Bancos procesados: {len(created_banks)} creados, {len(existing_banks)} ya existían, {len(failed_banks)} fallaron",
            "created": created_banks,
            "existing": existing_banks,
            "failed": failed_banks
        })

    except Exception as e:
        print(f"Error en create_banks: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def list_banks():
    """
    Listar bancos disponibles en ERPNext.

    Obtiene todos los bancos configurados en el sistema ERPNext,
    incluyendo bancos tradicionales y billeteras digitales.

    Returns:
        Response JSON con lista de bancos
    """
    print("=== DEBUG: list_banks called ===")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        print("=== DEBUG: Authentication failed ===")
        return error_response[0]  # Devolver solo el jsonify response, no la tupla completa

    try:
        print("=== DEBUG: Making request to ERPNext ===")
        # Obtener todos los bancos
        response, response_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Bank",
            params={
                "fields": json.dumps(["name","bank_name","swift_number"]),
                "limit_page_length": 1000
            },
            custom_headers=headers,
            operation_name="List Banks"
        )

        if response_err:
            print(f"=== DEBUG: ERPNext returned error: {response_err} ===")
            # If Bank doctype doesn't exist, return empty list instead of error
            if response_err.get('status_code') == 404:
                print("=== DEBUG: Bank doctype not found, returning empty list ===")
                return jsonify({
                    "success": True,
                    "data": [],
                    "total": 0,
                    "message": "Bank doctype not available in ERPNext"
                })
            return jsonify({"success": False, "message": f"Error obteniendo bancos: {response_err}"}), 500

        print(f"=== DEBUG: ERPNext response status: {response.status_code} ===")
        print(f"=== DEBUG: ERPNext response text: {response.text[:500]} ===")

        if response.status_code == 200:
            data = response.json()
            banks = data.get("data", [])

            return jsonify({
                "success": True,
                "data": banks,
                "total": len(banks)
            })
        else:
            print(f"=== DEBUG: ERPNext returned error: {response.status_code} ===")
            # If Bank doctype doesn't exist, return empty list instead of error
            if response.status_code == 404:
                print("=== DEBUG: Bank doctype not found, returning empty list ===")
                return jsonify({
                    "success": True,
                    "data": [],
                    "total": 0,
                    "message": "Bank doctype not available in ERPNext"
                })
            return jsonify({"success": False, "message": f"Error obteniendo bancos: {response.text}"}), 500

    except Exception as e:
        print(f"=== DEBUG: Exception in list_banks: {e} ===")
        import traceback
        print(f"=== DEBUG: Traceback: {traceback.format_exc()} ===")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def initialize_banks():
    """
    Inicializar bancos argentinos y billeteras digitales.

    Función wrapper que llama a create_banks para inicializar
    todos los bancos y billeteras digitales en el sistema.

    Returns:
        Response JSON con resultado de la inicialización
    """
    print("=== DEBUG: initialize_banks called ===")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response[0]  # Devolver solo el jsonify response, no la tupla completa

    try:
        # Crear bancos
        result = create_banks()

        # Si la función create_banks devuelve una respuesta Flask, extraer los datos
        if hasattr(result, 'get_json'):
            result_data = result.get_json()
        else:
            result_data = result[0].get_json() if isinstance(result, tuple) else result

        return result

    except Exception as e:
        print(f"Error en initialize_banks: {e}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500