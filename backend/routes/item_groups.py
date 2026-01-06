from flask import Blueprint, request, jsonify
import json
import traceback
from urllib.parse import quote, unquote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar funciones relacionadas con compañía
from routes.general import get_company_abbr, get_active_company

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint para las rutas de grupos de items
item_groups_bp = Blueprint('item_groups', __name__)


@item_groups_bp.route('/api/inventory/item-groups', methods=['GET', 'OPTIONS'])
@item_groups_bp.route('/api/item-groups', methods=['GET', 'OPTIONS'])
def get_item_groups():
    """Obtener lista de grupos de items"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print("\n--- Petición para obtener grupos de items ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        company_name = request.args.get('custom_company') or get_active_company(user_id)
        if not company_name:
            return jsonify({
                "success": False,
                "message": "No se encontró una compañía activa configurada para el usuario."
            }), 400

        company_abbr = get_company_abbr(session, headers, company_name)
        if not company_abbr:
            return jsonify({
                "success": False,
                "message": f"No se pudo obtener la abreviatura para la compañía '{company_name}'"
            }), 400

        # Calcular límite basado en el conteo de items de la compañía
        # Para grupos, usamos un límite fijo razonable
        limit = 500

        filters = [
            ["item_group_name", "like", f"% - {company_abbr}"]
        ]

        params = {
            "fields": '["name", "item_group_name", "parent_item_group", "is_group", "custom_company"]',
            "limit_page_length": limit,
            "order_by": "item_group_name asc"
        }

        if filters:
            params["filters"] = str(filters).replace("'", '"')

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Group",
            params=params,
            operation_name="Get Item Groups"
        )

        if error:
            return handle_erpnext_error(error, "Failed to get item groups")

        groups = response.json().get('data', [])

        # Allow the caller to request only parent groups or only leaf groups
        # - kind=parents  => return groups where is_group == 1
        # - kind=leafs    => return groups where is_group == 0
        # Default behaviour: return all groups
        kind = request.args.get('kind')  # 'parents'|'leafs'
        if kind == 'parents':
            groups = [g for g in groups if int(g.get('is_group', 0)) == 1]
        elif kind == 'leafs':
            groups = [g for g in groups if int(g.get('is_group', 0)) == 0]

        print(f"Grupos de items obtenidos (filtered kind={kind}): {len(groups)}")

        return jsonify({
            "success": True,
            "data": groups
        })

    except Exception as e:
        print(f"Error en get_item_groups: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@item_groups_bp.route('/api/inventory/item-groups', methods=['POST', 'OPTIONS'])
@item_groups_bp.route('/api/item-groups', methods=['POST', 'OPTIONS'])
def create_item_group():
    """Crear un nuevo grupo de items"""
    
    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200
    
    print(f"\n--- Petición para crear grupo de items ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        print(f"Datos recibidos: {data}")

        item_group_name = data.get('item_group_name')
        parent_item_group = data.get('parent_item_group')
        is_group = data.get('is_group', 0)
        company = data.get('custom_company')

        if not company:
            return jsonify({"success": False, "message": "Se requiere el nombre de la compañía"}), 400

        # Si no se especifica parent_item_group, usar el grupo raíz
        if not parent_item_group:
            # Intentar con "All Item Groups" primero
            root_check, error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint="/api/resource/Item Group",
                params={
                    "filters": '[["item_group_name", "=", "All Item Groups"]]',
                    "fields": '["name"]'
                },
                operation_name="Check All Item Groups"
            )
            if not error and root_check.status_code == 200 and root_check.json().get('data'):
                parent_item_group = "All Item Groups"
            else:
                # Buscar el grupo raíz (el que no tiene padre)
                root_response, error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Item Group",
                    params={
                        "filters": '[["parent_item_group", "=", ""]]',
                        "fields": '["name", "item_group_name"]',
                        "limit_page_length": 1
                    },
                    operation_name="Find Root Item Group"
                )
                if error:
                    return handle_erpnext_error(error, "Failed to find root item group")
                if root_response.status_code == 200:
                    root_groups = root_response.json().get('data', [])
                    if root_groups:
                        parent_item_group = root_groups[0]['name']
                    else:
                        return jsonify({"success": False, "message": "No se pudo encontrar el grupo de items raíz"}), 500
                else:
                    return jsonify({"success": False, "message": "Error al buscar el grupo de items raíz"}), 500

        # Obtener sigla de la compañía y crear nombre completo
        company_abbr = get_company_abbr(session, headers, company)
        if not company_abbr:
            return jsonify({"success": False, "message": f"No se pudo obtener la abreviatura para la compañía '{company}'"}), 400

        # Crear nombre completo con sigla de compañía
        full_item_group_name = f"{item_group_name} - {company_abbr}"

        # Verificar si ya existe un grupo con ese nombre completo
        check_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Item Group",
            params={
                "filters": f'[["item_group_name", "=", "{full_item_group_name}"]]',
                "fields": '["name"]'
            },
            operation_name="Check Existing Item Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to check existing item group")

        if check_response.status_code == 200:
            existing_groups = check_response.json().get('data', [])
            if existing_groups:
                return jsonify({"success": False, "message": f"Ya existe un grupo de items con el nombre '{full_item_group_name}'"}), 400

        # Crear el nuevo grupo de items
        group_body = {
            "item_group_name": full_item_group_name,
            "parent_item_group": parent_item_group,
            "is_group": is_group,
            "custom_company": company
        }

        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Item Group",
            data=group_body,
            operation_name="Create Item Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to create item group")

        created_group = response.json().get('data', {})
        print(f"Grupo de items creado: {created_group.get('name')}")

        return jsonify({
            "success": True,
            "data": created_group
        })

    except Exception as e:
        print(f"Error en create_item_group: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@item_groups_bp.route('/api/inventory/item-groups/<path:group_name>', methods=['PUT', 'DELETE', 'OPTIONS'])
@item_groups_bp.route('/api/item-groups/<path:group_name>', methods=['PUT', 'DELETE', 'OPTIONS'])
def update_item_group(group_name):
    """Actualizar un grupo de items"""
    print(f"\n--- Petición para actualizar grupo de items: {group_name} ---")

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Decodificar el nombre del grupo si viene URL-encoded
        decoded_group_name = unquote(group_name)

        data = request.get_json()
        print(f"Datos para actualizar: {data}")

        # Verificar que el grupo existe antes de intentar actualizarlo
        check_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item Group/{quote(decoded_group_name)}",
            operation_name="Check Item Group Exists"
        )

        if error:
            if check_response and check_response.status_code == 404:
                return jsonify({"success": False, "message": "Grupo de items no encontrado"}), 404
            return handle_erpnext_error(error, "Failed to check item group")

        # Preparar los datos para actualizar
        update_data = {}
        if 'parent_item_group' in data:
            update_data['parent_item_group'] = data['parent_item_group']
        if 'is_group' in data:
            update_data['is_group'] = data['is_group']

        if not update_data:
            return jsonify({"success": False, "message": "No se proporcionaron campos para actualizar"}), 400

        # Actualizar el grupo
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Item Group/{quote(decoded_group_name)}",
            data=update_data,
            operation_name="Update Item Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to update item group")

        if response.status_code == 200:
            print(f"Grupo de items actualizado exitosamente: {decoded_group_name}")
            updated_group = response.json().get('data', {})
            return jsonify({
                "success": True,
                "data": updated_group
            })
        else:
            try:
                error_data = response.json() if response.content else {}
                error_message = error_data.get('message', f'Error al actualizar el grupo: {response.status_code}')
            except:
                error_message = f'Error al actualizar el grupo: {response.status_code} - {response.text[:200]}'

            print(f"Error actualizando grupo: {response.status_code} - {error_message}")
            return jsonify({"success": False, "message": error_message}), response.status_code

    except Exception as e:
        print(f"Error en update_item_group: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@item_groups_bp.route('/api/inventory/item-groups/<path:group_name>', methods=['DELETE', 'OPTIONS'])
def delete_item_group(group_name):
    """Eliminar un grupo de items"""
    print(f"\n--- Petición para eliminar grupo de items: {group_name} ---")

    # Manejar preflight request para CORS
    if request.method == 'OPTIONS':
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        # Decodificar el nombre del grupo si viene URL-encoded
        decoded_group_name = unquote(group_name)

        print(f"Eliminando grupo: {decoded_group_name}")

        # Verificar que el grupo existe antes de intentar eliminarlo
        check_response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Item Group/{quote(decoded_group_name)}",
            operation_name="Check Item Group Exists for Deletion"
        )

        if error:
            if check_response and check_response.status_code == 404:
                return jsonify({"success": False, "message": "Grupo de items no encontrado"}), 404
            return handle_erpnext_error(error, "Failed to check item group for deletion")

        # Intentar eliminar el grupo
        delete_response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Item Group/{quote(decoded_group_name)}",
            operation_name="Delete Item Group"
        )

        if error:
            return handle_erpnext_error(error, "Failed to delete item group")

        if delete_response.status_code in [200, 204]:
            print(f"Grupo de items eliminado exitosamente: {decoded_group_name}")
            return jsonify({
                "success": True,
                "message": "Grupo de items eliminado exitosamente"
            })
        elif delete_response.status_code == 202:
            # ERPNext a veces devuelve 202 para operaciones asíncronas
            print(f"Grupo de items marcado para eliminación: {decoded_group_name}")
            return jsonify({
                "success": True,
                "message": "Grupo de items marcado para eliminación"
            })
        else:
            # Mejorar el manejo de errores - intentar parsear JSON pero manejar casos donde no hay JSON
            try:
                error_data = delete_response.json() if delete_response.content else {}
                error_message = error_data.get('message', f'Error al eliminar el grupo: {delete_response.status_code}')
            except:
                error_message = f'Error al eliminar el grupo: {delete_response.status_code} - {delete_response.text[:200]}'

            # Mejorar mensajes de error específicos
            if 'Cannot delete or cancel because' in error_message:
                if 'is linked with' in error_message:
                    error_message = 'No se puede eliminar el grupo porque tiene items asociados. Primero debe reasignar o eliminar los items asociados.'
                elif 'has child nodes' in error_message:
                    error_message = 'No se puede eliminar el grupo porque tiene subgrupos. Primero debe eliminar o reasignar los subgrupos.'

            print(f"Error eliminando grupo: {delete_response.status_code} - {error_message}")
            return jsonify({"success": False, "message": error_message}), delete_response.status_code

    except Exception as e:
        print(f"Error en delete_item_group: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500


@item_groups_bp.route('/api/inventory/item-groups/bulk-delete', methods=['POST'])
@item_groups_bp.route('/api/item-groups/bulk-delete', methods=['POST'])
def bulk_delete_item_groups():
    """Eliminar múltiples grupos de items.

    Body JSON: { group_names: ["Group A - ABC", "Group B - ABC", ...] }
    Returns per-group results and summary counts.
    """
    print("\n--- Petición para eliminar múltiples grupos de items ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json(silent=True) or {}
        group_names = data.get('group_names') or data.get('groups') or data.get('names') or []

        if not isinstance(group_names, list) or len(group_names) == 0:
            return jsonify({"success": False, "message": "Se requiere una lista de nombres de grupos (group_names)"}), 400

        results = []
        deleted = 0
        failed = 0

        for name in group_names:
            if not name:
                continue
            decoded = str(name)
            try:
                # Ensure we use the exact docname when calling ERPNext
                resp, err = make_erpnext_request(
                    session=session,
                    method='DELETE',
                    endpoint=f"/api/resource/Item Group/{quote(decoded)}",
                    operation_name=f"Bulk Delete Item Group {decoded}"
                )

                if resp and resp.status_code in [200, 202, 204]:
                    results.append({"group": decoded, "success": True})
                    deleted += 1
                else:
                    # try to extract a helpful message
                    msg = None
                    if err:
                        msg = err.get('message')
                    elif resp is not None:
                        try:
                            parsed = resp.json()
                            msg = parsed.get('message') or str(parsed)
                        except Exception:
                            msg = resp.text[:500]

                    results.append({"group": decoded, "success": False, "message": msg or 'Unknown error'})
                    failed += 1

            except Exception as exc:
                print(f"Error deleting group {decoded}: {exc}")
                results.append({"group": decoded, "success": False, "message": str(exc)})
                failed += 1

        return jsonify({
            "success": True,
            "data": {
                "requested": len(group_names),
                "deleted_count": deleted,
                "failed_count": failed,
                "results": results
            }
        })

    except Exception as e:
        print(f"Error en bulk_delete_item_groups: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
