"""
ERPNext AFIP Comprobante Types Setup Module

This module handles the creation, loading, and management of AFIP
(Administración Federal de Ingresos Públicos) comprobante types in ERPNext.
This includes loading from files, creating predefined records, and clearing data.

Functions:
- load_afip_comprobante_types: Load comprobante types from file
- create_afip_records: Create predefined AFIP comprobante records
- clear_afip_comprobante_types: Remove all AFIP comprobante records
"""

import os
import json
from flask import jsonify
from config import ERPNEXT_URL
from routes.auth_utils import get_session_with_auth
from routes.Configuracion.setup_afip_utils import check_record_exists

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error


def load_afip_comprobante_types():
    """Cargar tipos de comprobante AFIP desde archivo"""
    print("\n--- Cargando tipos de comprobante AFIP desde archivo ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response[0]  # Devolver solo el jsonify response, no la tupla completa

    try:
        # Leer el archivo de tipos de comprobante
        comprobante_file_path = os.path.join(os.path.dirname(__file__), '..', '..', 'TIPOS DE COMPROBANTE')

        if not os.path.exists(comprobante_file_path):
            return jsonify({"success": False, "message": f"Archivo de tipos de comprobante no encontrado: {comprobante_file_path}"}), 404

        with open(comprobante_file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        created_count = 0
        skipped_count = 0

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Separar código y descripción (tab-separated)
            parts = line.split('\t')
            if len(parts) >= 2:
                codigo = parts[0].strip()
                descripcion = parts[1].strip()

                # Verificar si ya existe
                if check_record_exists(session, headers, "Tipo Comprobante AFIP", codigo, ERPNEXT_URL):
                    print(f"Registro '{codigo} - {descripcion}' ya existe, saltando.")
                    skipped_count += 1
                    continue

                # Crear el registro
                comprobante_data = {
                    "data": {
                        "codigo": codigo,
                        "codigo_afip": int(codigo),
                        "descripcion": descripcion,
                        "tipo_documento": "FAC",  # Default value
                        "letra": "A"  # Default value
                    }
                }

                response, error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Tipo Comprobante AFIP",
                    data=comprobante_data,
                    operation_name=f"Create AFIP comprobante type '{codigo}'"
                )

                if error:
                    print(f"Error creando registro {codigo}: {error}")
                    return handle_erpnext_error(error, f"Failed to create AFIP comprobante type {codigo}")

                if response.status_code not in [200, 201]:
                    print(f"Error creando registro {codigo}: {response.status_code} - {response.text}")
                    return jsonify({"success": False, "message": f"Error creando registro {codigo}: {response.text}"}), 400

                created_count += 1
                print(f"Registro '{codigo} - {descripcion}' creado exitosamente")

        return jsonify({
            "success": True,
            "message": f"Tipos de comprobante AFIP cargados: {created_count} creados, {skipped_count} omitidos",
            "created": created_count,
            "skipped": skipped_count
        })

    except Exception as e:
        print(f"Error cargando tipos de comprobante: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def create_afip_records():
    """Crear registros de ejemplo para Tipo Comprobante AFIP"""
    print("\n--- Creando registros para Tipo Comprobante AFIP ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response[0]  # Devolver solo el jsonify response, no la tupla completa

    try:
        # Cargar tipos de comprobante desde shared/afip_codes.json para evitar listas hardcodeadas
        afip_file = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'shared', 'afip_codes.json'))
        if not os.path.exists(afip_file):
            print(f"Archivo de mapeo AFIP no encontrado: {afip_file}")
            return jsonify({"success": False, "message": f"Archivo de mapeo AFIP no encontrado: {afip_file}"}), 404

        with open(afip_file, 'r', encoding='utf-8') as fh:
            afip_map = json.load(fh)

        # Sólo usar la sección 'comprobantes' del mapeo -- sin fallbacks ni heurísticas
        comprobante_types = []
        comprobantes_section = afip_map.get('comprobantes')
        if not comprobantes_section:
            msg = "Sección 'comprobantes' no encontrada en shared/afip_codes.json. Abortando para evitar heurísticas."
            print(msg)
            return jsonify({"success": False, "message": msg}), 400

        for codigo, info in comprobantes_section.items():
            descripcion = info.get('description') or info.get('descripcion') or ''
            letra = (info.get('letra') or '').strip().upper()
            tipo_key = (info.get('tipo') or info.get('tipo_comprobante') or '').strip().upper()
            if not letra or not tipo_key:
                print(f"Omitiendo comprobante {codigo} porque falta 'letra' o 'tipo' en el mapeo: letra='{letra}', tipo='{tipo_key}'")
                continue
            comprobante_types.append({"codigo": codigo, "descripcion": descripcion, "letra": letra, "tipo": tipo_key})

        created_count = 0
        skipped_count = 0

        # Track letras encontradas (usadas para decidir crear opciones de talonario)
        letras_encontradas = set()

        for comprobante in comprobante_types:
            codigo = comprobante.get('codigo')
            descripcion = comprobante.get('descripcion', '')
            print(f"Verificando/Creando registro '{descripcion}' ({codigo})...")

            # Usar letra y tipo tal como están en el mapeo (sin heurísticas)
            letra = (comprobante.get('letra') or '').strip().upper()
            tipo_documento = (comprobante.get('tipo') or '').strip().upper()
            if not letra or not tipo_documento:
                print(f"Saltando creación de {codigo} por datos incompletos: letra='{letra}', tipo='{tipo_documento}'")
                skipped_count += 1
                continue

            letras_encontradas.add(letra)

            # Crear o saltar según existencia
            if check_record_exists(session, headers, "Tipo Comprobante AFIP", codigo, ERPNEXT_URL):
                print(f"Registro '{descripcion}' ({codigo}) ya existe, saltando creación.")
                skipped_count += 1
            else:
                comprobante_data = {
                    "data": {
                        "codigo": codigo,
                        "codigo_afip": int(codigo),
                        "descripcion": descripcion,
                        "tipo_documento": tipo_documento,
                        "letra": letra
                    }
                }

                response, error = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/resource/Tipo Comprobante AFIP",
                    data=comprobante_data,
                    operation_name=f"Create AFIP comprobante record '{descripcion}'"
                )

                if error:
                    print(f"Error creando registro {descripcion}: {error}")
                    return handle_erpnext_error(error, f"Failed to create AFIP comprobante record {descripcion}")

                if response.status_code not in [200, 201]:
                    print(f"Error creando registro {descripcion}: {response.status_code} - {response.text}")
                    return jsonify({"success": False, "message": f"Error creando registro {descripcion}: {response.text}"}), 400

                created_count += 1

        # No se modifica el DocType Talonario desde aquí. El script solo crea/actualiza
        # registros de 'Tipo Comprobante AFIP' basados en `shared/afip_codes.json`.

        print(f"Registros de Tipo Comprobante AFIP procesados: {created_count} creados, {skipped_count} omitidos")
        return jsonify({
            "success": True,
            "message": f"Registros de Tipo Comprobante AFIP procesados: {created_count} creados, {skipped_count} omitidos",
            "created": created_count,
            "skipped": skipped_count
        })

    except Exception as e:
        print(f"Error creando registros de Tipo Comprobante AFIP: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


def clear_afip_comprobante_types():
    """Eliminar todos los registros de Tipo Comprobante AFIP"""
    print("\n--- Eliminando todos los registros de Tipo Comprobante AFIP ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response[0]  # Devolver solo el jsonify response, no la tupla completa

    try:
        # Obtener todos los registros de Tipo Comprobante AFIP
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Tipo Comprobante AFIP",
            params={
                "fields": "['name','codigo_afip','descripcion']",
                "limit": 1000
            },
            operation_name="Get all AFIP comprobante types for clearing"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get AFIP comprobante types for clearing")

        if response.status_code != 200:
            return jsonify({"success": False, "message": f"Error obteniendo registros: {response.text}"}), 400

        records = response.json().get('data', [])
        deleted_count = 0
        failed_count = 0

        for record in records:
            delete_response, delete_error = make_erpnext_request(
                session=session,
                method="DELETE",
                endpoint=f"/api/resource/Tipo Comprobante AFIP/{record['name']}",
                operation_name=f"Delete AFIP comprobante type '{record['codigo_afip']}'"
            )

            if delete_error:
                failed_count += 1
                print(f"Error eliminando registro '{record['codigo_afip']}': {delete_error}")
            elif delete_response.status_code in [200, 202, 204]:
                deleted_count += 1
                print(f"Registro '{record['codigo_afip']} - {record['descripcion']}' eliminado exitosamente")
            else:
                failed_count += 1
                print(f"Error eliminando registro '{record['codigo_afip']}': {delete_response.status_code} - {delete_response.text}")

        return jsonify({
            "success": True,
            "message": f"Registros de Tipo Comprobante AFIP eliminados: {deleted_count} eliminados, {failed_count} fallaron",
            "deleted": deleted_count,
            "failed": failed_count
        })

    except Exception as e:
        print(f"Error eliminando registros de Tipo Comprobante AFIP: {str(e)}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500