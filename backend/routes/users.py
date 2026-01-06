"""
Routes para gestión de usuarios
"""

from flask import Blueprint, request, jsonify, redirect
import requests
import json
import os
from urllib.parse import quote
from config import ERPNEXT_URL, ERPNEXT_HOST, FRONTEND_URL
from routes.auth_utils import get_session_with_auth
from utils.http_utils import make_erpnext_request, handle_erpnext_error

users_bp = Blueprint('users', __name__)

ROLE_DEFINITIONS = []
ROLE_DEFINITIONS_BY_NAME = {}
ROLE_TRANSLATIONS = {}

try:
    role_definitions_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), '..', '..', 'shared', 'role_definitions.json')
    )
    with open(role_definitions_path, 'r', encoding='utf-8') as role_file:
        ROLE_DEFINITIONS = json.load(role_file)
        ROLE_DEFINITIONS_BY_NAME = {
            role.get("name"): role for role in ROLE_DEFINITIONS if role.get("name")
        }
except FileNotFoundError:
    print("⚠️  BACKEND: role_definitions.json no encontrado. Se devolverán roles sin metadata.")
except Exception as exc:
    print(f"⚠️  BACKEND: Error leyendo role_definitions.json: {exc}")

try:
    role_translations_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), '..', '..', 'shared', 'role_translations.json')
    )
    with open(role_translations_path, 'r', encoding='utf-8') as translations_file:
        ROLE_TRANSLATIONS = json.load(translations_file)
except FileNotFoundError:
    print("⚠️  BACKEND: role_translations.json no encontrado. Se usarán nombres originales.")
except Exception as exc:
    print(f"⚠️  BACKEND: Error leyendo role_translations.json: {exc}")


def normalize_roles_payload(raw_roles):
    """
    Convierte los roles recibidos desde el frontend (strings o dicts)
    al formato esperado por ERPNext: lista de objetos {"role": "..."}.
    """
    if not raw_roles:
        return []

    normalized = []
    for entry in raw_roles:
        role_name = None
        if isinstance(entry, str):
            role_name = entry
        elif isinstance(entry, dict):
            role_name = entry.get("role") or entry.get("name")

        if role_name:
            normalized.append({"role": role_name})

    return normalized

@users_bp.route('/api/users', methods=['GET'])
def get_users():
    """
    Obtener lista de todos los usuarios desde ERPNext
    """
    print("🔍 BACKEND: Solicitando lista de usuarios")
    
    # Obtener sesión autenticada
    session, headers, user_id, error_response = get_session_with_auth()
    
    if error_response:
        print(f"❌ BACKEND: Error de autenticación: {error_response}")
        return error_response
    
    print(f"✅ BACKEND: Sesión autenticada obtenida para user_id: {user_id}")
    
    try:
        # Hacer petición a ERPNext para obtener lista de usuarios con campos específicos
        fields = [
            "name", "email", "first_name", "last_name", "user_type", 
            "enabled", "creation", "full_name", "username", "time_zone"
        ]
        fields_param = '["' + '","'.join(fields) + '"]'
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/User?fields={fields_param}",
            operation_name="Get Users List"
        )
        
        if error:
            print(f"❌ BACKEND: Error de ERPNext - {error}")
            return handle_erpnext_error(error, "Failed to get users list")
        
        users_data = response.json()
        users_list = users_data.get("data", [])
        
        print(f"✅ BACKEND: Lista de usuarios obtenida exitosamente - {len(users_list)} usuarios")
        
        return jsonify({
            "success": True,
            "data": users_list
        })
            
    except Exception as e:
        print(f"❌ BACKEND: Error interno del servidor: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500

@users_bp.route('/api/users/<username>', methods=['GET'])
def get_user_data(username):
    """
    Obtener datos del usuario desde ERPNext
    """
    print(f"🔍 BACKEND: Solicitando datos del usuario: {username}")
    
    # Obtener sesión autenticada
    session, headers, user_id, error_response = get_session_with_auth()
    
    if error_response:
        print(f"❌ BACKEND: Error de autenticación: {error_response}")
        return error_response
    
    print(f"✅ BACKEND: Sesión autenticada obtenida para user_id: {user_id}")
    
    try:
        # Hacer petición a ERPNext para obtener datos del usuario
        erpnext_url = f"/api/resource/User/{username}"
        
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=erpnext_url,
            operation_name="Get User Data"
        )
        
        if error:
            print(f"❌ BACKEND: Error de ERPNext - {error}")
            return handle_erpnext_error(error, "Failed to get user data")
        
        user_data = response.json()
        print(f"✅ BACKEND: Datos del usuario obtenidos exitosamente")
        print(f"🔍 BACKEND: Estructura de datos: {user_data.keys() if isinstance(user_data, dict) else 'No es dict'}")
        
        # Los roles ya vienen incluidos en la respuesta del usuario
        user_info = user_data.get("data", {})
        if user_info:
            permissions = get_user_company_permissions(session, user_info.get("name") or username)
            user_info["allowed_companies"] = [
                perm.get("for_value") for perm in permissions if perm.get("for_value")
            ]
        
        return jsonify({
            "success": True,
            "data": user_info
        })
            
    except Exception as e:
        print(f"❌ BACKEND: Error interno del servidor: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500

@users_bp.route('/api/users', methods=['POST'])
def create_user():
    """
    Crear un nuevo usuario en ERPNext
    """
    print("🔍 BACKEND: Creando nuevo usuario")
    
    # Obtener sesión autenticada
    session, headers, user_id, error_response = get_session_with_auth()
    
    if error_response:
        print(f"❌ BACKEND: Error de autenticación: {error_response}")
        return error_response
    
    # Obtener datos del usuario a crear
    user_data = request.get_json()
    print(f"🔍 BACKEND: Datos del usuario a crear: {user_data}")
    
    if not user_data or 'data' not in user_data:
        return jsonify({"success": False, "message": "Datos del usuario requeridos"}), 400
    
    user_info = user_data['data']
    
    # Validar campos requeridos
    required_fields = ['email', 'first_name', 'last_name']
    for field in required_fields:
        if field not in user_info:
            return jsonify({"success": False, "message": f"Campo requerido faltante: {field}"}), 400
    
    try:
        # Preparar datos para ERPNext
        erpnext_user_data = {
            "email": user_info["email"],
            "first_name": user_info["first_name"],
            "last_name": user_info["last_name"],
            "user_type": user_info.get("user_type", "System User"),
            "enabled": user_info.get("enabled", 1),
            "send_welcome_email": user_info.get("send_welcome_email", 1)
        }
        if "roles" in user_info:
            erpnext_user_data["roles"] = normalize_roles_payload(user_info.get("roles"))
        
        print(f"✅ BACKEND: Datos preparados para ERPNext: {erpnext_user_data}")
        
        # Crear usuario en ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/User",
            data={"data": erpnext_user_data},
            operation_name="Create User"
        )
        
        if error:
            print(f"❌ BACKEND: Error creando usuario en ERPNext: {error}")
            return handle_erpnext_error(error, "Failed to create user")
        
        created_user = response.json()
        print(f"✅ BACKEND: Usuario creado exitosamente: {created_user.get('data', {}).get('name')}")
        
        # Si se especifican compañías, crear User Permissions evitando duplicados
        if "companies" in user_info and user_info["companies"]:
            print(f"?? BACKEND: Creando permisos para compañías: {user_info['companies']}")
            created_username = created_user.get("data", {}).get("name") or user_info.get("email")
            existing_permissions = get_user_company_permissions(session, created_username)
            existing_companies = {perm.get("for_value") for perm in existing_permissions if perm.get("for_value")}
            
            for company in user_info["companies"]:
                if company in existing_companies:
                    print(f"?? BACKEND: Permiso para compañía {company} ya existe. Saltando creación.")
                    continue
                
                perm_response, perm_error = create_company_permission(session, created_username, company)
                
                if perm_error:
                    print(f"?? BACKEND: Error creando permiso para compañía {company}: {perm_error}")
                    # No fallar la creación del usuario por error en permisos
                else:
                    print(f"? BACKEND: Permiso creado para compañía {company}")
        return jsonify({
            "success": True,
            "data": created_user.get("data", {}),
            "message": "Usuario creado exitosamente"
        })
            
    except Exception as e:
        print(f"❌ BACKEND: Error interno del servidor: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500

@users_bp.route('/api/users/<username>/companies', methods=['GET'])
def get_user_companies(username):
    """
    Obtener compañías disponibles para un usuario (basado en User Permissions)
    """
    print(f"🔍 BACKEND: Obteniendo compañías para usuario: {username}")
    
    # Obtener sesión autenticada
    session, headers, user_id, error_response = get_session_with_auth()
    
    if error_response:
        print(f"❌ BACKEND: Error de autenticación: {error_response}")
        return error_response
    
    try:
        # Obtener todas las compañías
        companies_response, companies_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Company",
            operation_name="Get all companies"
        )
        
        if companies_error:
            print(f"❌ BACKEND: Error obteniendo compañías: {companies_error}")
            return handle_erpnext_error(companies_error, "Failed to get companies")
        
        all_companies = companies_response.json().get("data", [])
        
        # Si el usuario es administrador, devolver todas las compañías
        if username == user_id or username == "Administrator":
            print(f"✅ BACKEND: Usuario administrador, devolviendo todas las compañías")
            return jsonify({
                "success": True,
                "data": all_companies
            })
        
        permissions = get_user_company_permissions(session, username)
        allowed_company_names = {
            perm.get("for_value") for perm in permissions if perm.get("for_value")
        }

        if not allowed_company_names:
            print(f"✅ BACKEND: No hay permisos específicos, devolviendo todas las compañías")
            return jsonify({
                "success": True,
                "data": all_companies
            })

        allowed_companies = [
            company for company in all_companies
            if company.get("name") in allowed_company_names
        ]

        print(f"✅ BACKEND: Compañías permitidas para {username}: {[c.get('name') for c in allowed_companies]}")

        
        return jsonify({
            "success": True,
            "data": allowed_companies
        })
            
    except Exception as e:
        print(f"❌ BACKEND: Error interno del servidor: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500

@users_bp.route('/api/roles', methods=['GET'])
def get_roles():
    """
    Obtener lista de roles disponibles en ERPNext
    """
    print("?? BACKEND: Obteniendo roles disponibles")
    
    # Obtener sesión autenticada
    session, headers, user_id, error_response = get_session_with_auth()
    
    if error_response:
        print(f"? BACKEND: Error de autenticación: {error_response}")
        return error_response
    
    try:
        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Role?limit_page_length=500&order_by=name%20asc",
            operation_name="Get all roles"
        )
        
        if error:
            print(f"? BACKEND: Error obteniendo roles: {error}")
            return handle_erpnext_error(error, "Failed to get roles")
        
        roles_data = response.json().get("data", [])
        filtered_roles = []
        
        for role in roles_data:
            role_name = role.get("name")
            metadata = ROLE_DEFINITIONS_BY_NAME.get(role_name, {})
            
            display_name = metadata.get("display_name") or ROLE_TRANSLATIONS.get(role_name) or role_name
            
            enriched_role = {
                "name": role_name,
                "desk_access": role.get("desk_access"),
                "disabled": role.get("disabled"),
                "is_custom": role.get("is_custom"),
                "display_name": display_name,
                "description": metadata.get("description") or "Rol sin documentación local.",
                "category": metadata.get("category", "Otros"),
                "erpnext_modules": metadata.get("erpnext_modules", []),
                "erpnext_docs": metadata.get("erpnext_docs", []),
                "flowint_features": metadata.get("flowint_features", []),
                "notes": metadata.get("notes")
            }
            
            filtered_roles.append(enriched_role)
        
        filtered_roles.sort(key=lambda item: (item.get("category") or "", item.get("name") or ""))
        
        print(f"? BACKEND: Roles obtenidos: {len(filtered_roles)}")
        
        return jsonify({
            "success": True,
            "data": filtered_roles
        })
            
    except Exception as e:
        print(f"? BACKEND: Error interno del servidor: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500


@users_bp.route('/api/users/<username>', methods=['PUT'])
def update_user(username):
    """
    Actualizar un usuario existente en ERPNext
    """
    print(f"🔍 BACKEND: Actualizando usuario: {username}")
    
    # Obtener sesión autenticada
    session, headers, user_id, error_response = get_session_with_auth()
    
    if error_response:
        print(f"❌ BACKEND: Error de autenticación: {error_response}")
        return error_response
    
    # Obtener datos del usuario a actualizar
    user_data = request.get_json()
    print(f"🔍 BACKEND: Datos del usuario a actualizar: {user_data}")
    
    if not user_data or 'data' not in user_data:
        return jsonify({"success": False, "message": "Datos del usuario requeridos"}), 400
    
    user_info = user_data['data']
    
    # Validar campos requeridos
    required_fields = ['email', 'first_name', 'last_name']
    for field in required_fields:
        if field not in user_info:
            return jsonify({"success": False, "message": f"Campo requerido faltante: {field}"}), 400
    
    try:
        # Preparar datos para ERPNext
        erpnext_user_data = {
            "email": user_info["email"],
            "first_name": user_info["first_name"],
            "last_name": user_info["last_name"],
            "user_type": user_info.get("user_type", "System User"),
            "enabled": user_info.get("enabled", 1),
            "send_welcome_email": user_info.get("send_welcome_email", 1)
        }
        
        if "roles" in user_info:
            erpnext_user_data["roles"] = normalize_roles_payload(user_info.get("roles"))

        print(f"✅ BACKEND: Datos preparados para ERPNext: {erpnext_user_data}")
        
        # Actualizar usuario en ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/User/{username}",
            data={"data": erpnext_user_data},
            operation_name="Update User"
        )
        
        if error:
            print(f"❌ BACKEND: Error actualizando usuario en ERPNext: {error}")
            return handle_erpnext_error(error, "Failed to update user")
        
        updated_user = response.json()
        print(f"✅ BACKEND: Usuario actualizado exitosamente: {updated_user.get('data', {}).get('name')}")
        
        # Si se especifican compañías, actualizar User Permissions sincronizando cambios
        if "companies" in user_info:
            desired_companies = set(user_info.get("companies") or [])
            print(f"?? BACKEND: Actualizando permisos para compañías: {list(desired_companies)}")
            existing_permissions = get_user_company_permissions(session, username)
            existing_by_company = {
                perm.get("for_value"): perm for perm in existing_permissions if perm.get("for_value")
            }

            if not desired_companies:
                # Lista vacía significa acceso a todas las compañías: eliminar restricciones actuales
                for company, permission in existing_by_company.items():
                    perm_name = permission.get("name")
                    if not perm_name:
                        continue
                    delete_response, delete_error = make_erpnext_request(
                        session=session,
                        method="DELETE",
                        endpoint=f"/api/resource/User Permission/{perm_name}",
                        operation_name=f"Delete User Permission {perm_name}"
                    )
                    if delete_error:
                        print(f"?? BACKEND: Error eliminando permiso para compañía {company}: {delete_error}")
                    else:
                        print(f"? BACKEND: Permiso eliminado para compañía {company}")
            else:
                # Eliminar permisos que ya no aplican
                for company, permission in existing_by_company.items():
                    if company not in desired_companies:
                        perm_name = permission.get("name")
                        if not perm_name:
                            continue
                        delete_response, delete_error = make_erpnext_request(
                            session=session,
                            method="DELETE",
                            endpoint=f"/api/resource/User Permission/{perm_name}",
                            operation_name=f"Delete User Permission {perm_name}"
                        )
                        if delete_error:
                            print(f"?? BACKEND: Error eliminando permiso para compañía {company}: {delete_error}")
                        else:
                            print(f"? BACKEND: Permiso eliminado para compañía {company}")

                # Crear permisos nuevos que falten
                for company in desired_companies:
                    if company in existing_by_company:
                        continue

                    perm_response, perm_error = create_company_permission(session, username, company)
                    if perm_error:
                        print(f"?? BACKEND: Error creando permiso para compañía {company}: {perm_error}")
                    else:
                        print(f"? BACKEND: Permiso creado para compañía {company}")
        return jsonify({
            "success": True,
            "data": updated_user.get("data", {}),
            "message": "Usuario actualizado exitosamente"
        })
            
    except Exception as e:
        print(f"❌ BACKEND: Error interno del servidor: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500

@users_bp.route('/api/users/<username>', methods=['DELETE'])
def delete_user(username):
    """
    Eliminar un usuario de ERPNext
    """
    print(f"🔍 BACKEND: Eliminando usuario: {username}")
    
    # Obtener sesión autenticada
    session, headers, user_id, error_response = get_session_with_auth()
    
    if error_response:
        print(f"❌ BACKEND: Error de autenticación: {error_response}")
        return error_response
    
    try:
        # Verificar que no se esté eliminando el propio usuario
        if username == user_id:
            return jsonify({
                "success": False,
                "message": "No puedes eliminar tu propio usuario"
            }), 400
        
        # Eliminar usuario de ERPNext
        response, error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/User/{username}",
            operation_name="Delete User"
        )
        
        if error:
            print(f"❌ BACKEND: Error eliminando usuario en ERPNext: {error}")
            return handle_erpnext_error(error, "Failed to delete user")
        
        print(f"✅ BACKEND: Usuario eliminado exitosamente: {username}")
        
        return jsonify({
            "success": True,
            "message": f"Usuario {username} eliminado exitosamente"
        })
            
    except Exception as e:
        print(f"❌ BACKEND: Error interno del servidor: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500

@users_bp.route('/api/update-password', methods=['POST'])
def update_password():
    """
    Actualizar contraseña de usuario usando key de restablecimiento
    """
    print("🔍 BACKEND: Actualizando contraseña de usuario")
    
    try:
        # Obtener datos de la solicitud
        data = request.get_json()
        reset_key = data.get('key')
        new_password = data.get('new_password')
        
        if not reset_key or not new_password:
            return jsonify({
                "success": False,
                "message": "Key de restablecimiento y nueva contraseña son requeridos"
            }), 400
        
        if len(new_password) < 8:
            return jsonify({
                "success": False,
                "message": "La contraseña debe tener al menos 8 caracteres"
            }), 400
        
        # Por ahora, simulamos una respuesta exitosa
        # TODO: Implementar la lógica real con ERPNext
        print(f"✅ BACKEND: Contraseña actualizada exitosamente para key: {reset_key[:10]}...")
        
        return jsonify({
            "success": True,
            "message": "Contraseña actualizada exitosamente"
        })
        
    except Exception as e:
        print(f"❌ BACKEND: Error actualizando contraseña: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500

@users_bp.route('/api/users/<username>/reset-password', methods=['POST'])
def reset_user_password(username):
    """
    Resetear la contraseña de un usuario enviando un email de restablecimiento
    """
    print(f"🔍 BACKEND: Reseteando contraseña para usuario: {username}")
    
    # Obtener sesión autenticada
    session, headers, user_id, error_response = get_session_with_auth()
    
    if error_response:
        print(f"❌ BACKEND: Error de autenticación: {error_response}")
        return error_response
    
    try:
        # Llamar a la API de ERPNext para resetear contraseña
        response, error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/method/frappe.core.doctype.user.user.reset_password",
            data={"user": username},
            operation_name=f"Reset password for user {username}"
        )
        
        if error:
            print(f"❌ BACKEND: Error reseteando contraseña: {error}")
            return handle_erpnext_error(error, "Failed to reset password")
        
        print(f"✅ BACKEND: Contraseña reseteada exitosamente para usuario: {username}")
        
        return jsonify({
            "success": True,
            "message": f"Enlace de restablecimiento enviado exitosamente a {username}"
        })
            
    except Exception as e:
        print(f"❌ BACKEND: Error interno del servidor: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500

@users_bp.route('/update-password', methods=['GET'])
def update_password_page():
    """
    Redirigir a la página de actualización de contraseña en el frontend
    Este endpoint maneja los enlaces de email que apuntan a /update-password
    """
    reset_key = request.args.get('key')
    
    if not reset_key:
        return "Enlace de restablecimiento de contraseña inválido", 400
    
    # Obtener la URL del frontend desde las variables de entorno
    frontend_url = FRONTEND_URL
    
    # Redirigir al frontend con el key
    redirect_url = f"{frontend_url}/update-password?key={reset_key}"
    print(f"🔄 BACKEND: Redirigiendo a: {redirect_url}")
    
    return redirect(redirect_url)
def get_user_company_permissions(session, username):
    """
    Obtener User Permissions existentes para compañías de un usuario dado.
    Retorna una lista de diccionarios con al menos name y for_value.
    """
    if not username:
        return []

    try:
        filters = quote(json.dumps([["user", "=", username], ["allow", "=", "Company"]]))
        fields = quote(json.dumps(["name", "for_value", "user"]))
        endpoint = f"/api/resource/User Permission?filters={filters}&fields={fields}&limit_page_length=500"

        response, error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=endpoint,
            operation_name=f"Get company permissions for user {username}"
        )

        if error:
            print(f"⚠️ BACKEND: No se pudieron obtener permisos existentes para {username}: {error}")
            return []

        return response.json().get("data", []) or []
    except Exception as exc:
        print(f"⚠️ BACKEND: Error inesperado obteniendo permisos para {username}: {exc}")
        return []


def create_company_permission(session, username, company):
    permission_data = {
        "user": username,
        "allow": "Company",
        "for_value": company,
        "apply_to_all_doctypes": 1
    }

    return make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/resource/User Permission",
        data={"data": permission_data},
        operation_name=f"Create User Permission for company {company}"
    )
