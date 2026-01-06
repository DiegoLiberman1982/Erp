"""
ERPNext AFIP Setup Module - Initialize AFIP Setup

This module handles the complete initialization of AFIP setup in ERPNext.
This includes calling all necessary setup functions in the correct order.

Functions:
- initialize_afip_setup: Complete AFIP setup initialization
"""

from flask import jsonify
from config import ERPNEXT_URL
from routes.auth_utils import get_session_with_auth

# Importar todas las funciones de setup AFIP
from routes.Configuracion.setup_afip_utils import check_doctype_exists
from routes.Configuracion.setup_afip_custom_fields import create_custom_fields_internal
from routes.Configuracion.setup_afip_comprobante_types import load_afip_comprobante_types, create_afip_records
from routes.Configuracion.setup_afip_doctypes import create_afip_doctypes
from routes.Configuracion.setup_banks import initialize_banks
from routes.Configuracion.setup_letras_disponibles import clear_letras_disponibles
from routes.Configuracion.setup_naming_series import create_naming_series

# Importar función para crear TODOS los campos custom
from routes.Configuracion.setup_custom_fields import create_all_custom_fields


def initialize_afip_setup():
    """Inicializar configuración completa de AFIP"""
    print("\n--- Inicializando configuración completa de AFIP ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response[0]  # Devolver solo el jsonify response, no la tupla completa

    try:
        results = {}
        errors = []

        # 1. Crear DocTypes para AFIP
        print("Paso 1: Creando DocTypes para AFIP...")
        try:
            result = create_afip_doctypes(session, headers, ERPNEXT_URL, user_id=user_id)
            # Handle both Response objects and tuples
            if isinstance(result, tuple):
                result = result[0]  # Get the Response object from tuple
            if hasattr(result, 'get_json'):
                result = result.get_json()
            results['doctypes'] = result
            if not result.get('success', False):
                errors.append(f"Error en DocTypes: {result.get('message', 'Error desconocido')}")
        except Exception as e:
            error_msg = f"Error creando DocTypes: {str(e)}"
            print(error_msg)
            errors.append(error_msg)
            results['doctypes'] = {"success": False, "message": error_msg}

        # 2a. Crear TODOS los campos personalizados generales
        print("Paso 2a: Creando todos los campos personalizados generales...")
        try:
            result = create_all_custom_fields()
            print(f"Resultado de create_all_custom_fields: {result}")
            # Handle both Response objects and tuples
            if isinstance(result, tuple):
                result = result[0]  # Get the Response object from tuple
            if hasattr(result, 'get_json'):
                result = result.get_json()
                print(f"Resultado JSON: {result}")
            results['all_custom_fields'] = result
            if not result.get('success', False):
                errors.append(f"Error en campos personalizados generales: {result.get('message', 'Error desconocido')}")
        except Exception as e:
            error_msg = f"Error creando campos personalizados generales: {str(e)}"
            print(error_msg)
            errors.append(error_msg)
            results['all_custom_fields'] = {"success": False, "message": error_msg}

        # 2b. Crear campos personalizados AFIP
        print("Paso 2b: Creando campos personalizados AFIP...")
        try:
            result = create_custom_fields_internal(session, headers, ERPNEXT_URL)
            # Handle both Response objects and tuples
            if isinstance(result, tuple):
                result = result[0]  # Get the Response object from tuple
            if hasattr(result, 'get_json'):
                result = result.get_json()
            results['custom_fields'] = result
            if not result.get('success', False):
                errors.append(f"Error en campos personalizados AFIP: {result.get('message', 'Error desconocido')}")
        except Exception as e:
            error_msg = f"Error creando campos personalizados AFIP: {str(e)}"
            print(error_msg)
            errors.append(error_msg)
            results['custom_fields'] = {"success": False, "message": error_msg}

        # 3. Cargar tipos de comprobante AFIP
        print("Paso 3: Cargando tipos de comprobante AFIP...")
        try:
            result = load_afip_comprobante_types()
            # Handle both Response objects and tuples
            if isinstance(result, tuple):
                result = result[0]  # Get the Response object from tuple
            if hasattr(result, 'get_json'):
                result = result.get_json()
            results['comprobante_types'] = result
            if not result.get('success', False):
                errors.append(f"Error cargando comprobantes: {result.get('message', 'Error desconocido')}")
        except Exception as e:
            error_msg = f"Error cargando comprobantes: {str(e)}"
            print(error_msg)
            errors.append(error_msg)
            results['comprobante_types'] = {"success": False, "message": error_msg}

        # 4. Crear registros de comprobantes
        print("Paso 4: Creando registros de comprobantes...")
        try:
            result = create_afip_records()
            # Handle both Response objects and tuples
            if isinstance(result, tuple):
                result = result[0]  # Get the Response object from tuple
            if hasattr(result, 'get_json'):
                result = result.get_json()
            results['records'] = result
            if not result.get('success', False):
                errors.append(f"Error creando registros: {result.get('message', 'Error desconocido')}")
        except Exception as e:
            error_msg = f"Error creando registros: {str(e)}"
            print(error_msg)
            errors.append(error_msg)
            results['records'] = {"success": False, "message": error_msg}

        # 5. Limpiar letras disponibles
        print("Paso 5: Limpiando letras disponibles...")
        try:
            result = clear_letras_disponibles()
            # Handle both Response objects and tuples
            if isinstance(result, tuple):
                result = result[0]  # Get the Response object from tuple
            if hasattr(result, 'get_json'):
                result = result.get_json()
            results['clear_letras'] = result
            if not result.get('success', False):
                errors.append(f"Error limpiando letras: {result.get('message', 'Error desconocido')}")
        except Exception as e:
            error_msg = f"Error limpiando letras: {str(e)}"
            print(error_msg)
            errors.append(error_msg)
            results['clear_letras'] = {"success": False, "message": error_msg}

        # 6. Crear series de numeración
        print("Paso 6: Creando series de numeración...")
        try:
            result = create_naming_series()
            # Handle both Response objects and tuples
            if isinstance(result, tuple):
                result = result[0]  # Get the Response object from tuple
            if hasattr(result, 'get_json'):
                result = result.get_json()
            results['naming_series'] = result
            if not result.get('success', False):
                errors.append(f"Error creando series: {result.get('message', 'Error desconocido')}")
        except Exception as e:
            error_msg = f"Error creando series: {str(e)}"
            print(error_msg)
            errors.append(error_msg)
            results['naming_series'] = {"success": False, "message": error_msg}

        # 7. Inicializar bancos
        print("Paso 7: Inicializando bancos...")
        try:
            result = initialize_banks()
            # Handle both Response objects and tuples
            if isinstance(result, tuple):
                result = result[0]  # Get the Response object from tuple
            if hasattr(result, 'get_json'):
                result = result.get_json()
            results['banks'] = result
            if not result.get('success', False):
                errors.append(f"Error inicializando bancos: {result.get('message', 'Error desconocido')}")
        except Exception as e:
            error_msg = f"Error inicializando bancos: {str(e)}"
            print(error_msg)
            errors.append(error_msg)
            results['banks'] = {"success": False, "message": error_msg}

        # Resumen final
        success_count = sum(1 for r in results.values() if r.get('success', False))
        total_steps = len(results)

        if errors:
            return jsonify({
                "success": False,
                "message": f"Inicialización AFIP completada parcialmente: {success_count}/{total_steps} pasos exitosos. Errores: {'; '.join(errors)}",
                "results": results,
                "errors": errors
            }), 207  # 207 Multi-Status
        else:
            return jsonify({
                "success": True,
                "message": f"Inicialización completa de AFIP exitosa: {success_count}/{total_steps} pasos completados",
                "results": results
            })

    except Exception as e:
        print(f"Error en inicialización completa de AFIP: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500