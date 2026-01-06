from flask import Blueprint, request, jsonify
import requests
import os
import json
from urllib.parse import quote
# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST
# Importar funciones de companies.py para evitar duplicación
from routes.companies import load_active_companies
# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth
# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from utils.comprobante_utils import get_sales_prefix
# Crear el blueprint para las rutas de talonarios
talonarios_bp = Blueprint('talonarios', __name__)


def fetch_talonario_doc(session, headers, talonario_name):
    """Helper to fetch talonario data or raise RuntimeError."""
    detail_resp, detail_error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Talonario/{quote(talonario_name)}",
        operation_name=f"Fetch talonario '{talonario_name}'"
    )
    if detail_error:
        raise RuntimeError(detail_error.get('message') or 'Error obteniendo talonario')
    if detail_resp.status_code != 200:
        raise RuntimeError(f"Error obteniendo talonario: {detail_resp.text}")
    return detail_resp.json().get('data', {})

def submit_talonario(session, headers, talonario_name):
    """Submit a talonario (docstatus 0 -> 1)."""
    submit_resp, submit_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.client.submit",
        data={"doctype": "Talonario", "name": talonario_name},
        operation_name=f"Submit talonario '{talonario_name}'"
    )
    if submit_error:
        raise RuntimeError(submit_error.get('message') or 'Error enviando talonario')
    if submit_resp.status_code != 200:
        raise RuntimeError(f"Error enviando talonario: {submit_resp.text}")
    return submit_resp.json().get('message')

def cancel_talonario(session, headers, talonario_name):
    """Cancel a talonario (docstatus 1 -> 2)."""
    cancel_resp, cancel_error = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/frappe.client.cancel",
        data={"doctype": "Talonario", "name": talonario_name},
        operation_name=f"Cancel talonario '{talonario_name}'"
    )
    if cancel_error:
        raise RuntimeError(cancel_error.get('message') or 'Error cancelando talonario')
    if cancel_resp.status_code != 200:
        raise RuntimeError(f"Error cancelando talonario: {cancel_resp.text}")
    return cancel_resp.json().get('message')

def transition_talonario_docstatus(session, headers, talonario_name, target_docstatus):
    """
    Ajustar docstatus de un talonario respetando las reglas de ERPNext.
    """
    talonario_doc = fetch_talonario_doc(session, headers, talonario_name)
    current_docstatus = talonario_doc.get('docstatus', 0)
    if target_docstatus == current_docstatus:
        return talonario_doc
    if target_docstatus == 1:
        if current_docstatus == 0:
            submit_talonario(session, headers, talonario_name)
            return fetch_talonario_doc(session, headers, talonario_name)
        if current_docstatus == 2:
            raise RuntimeError('No se puede reactivar un talonario cancelado')
        return talonario_doc
    if target_docstatus == 2:
        if current_docstatus == 2:
            return talonario_doc
        if current_docstatus == 0:
            submit_talonario(session, headers, talonario_name)
        cancel_talonario(session, headers, talonario_name)
        return fetch_talonario_doc(session, headers, talonario_name)
    raise RuntimeError('Docstatus solicitado no soportado')

def normalize_letters_payload(payload):
    """
    Normalizar el payload de letras recibido desde el frontend para garantizar
    que siempre sea una lista de diccionarios con al menos la clave 'letra'.
    """
    if not payload:
        return []
    raw_data = payload
    if isinstance(raw_data, str):
        stripped = raw_data.strip()
        if not stripped:
            return []
        try:
            raw_data = json.loads(stripped)
        except json.JSONDecodeError:
            candidates = [part.strip() for part in stripped.replace(',', '\n').split('\n')]
            raw_data = [candidate for candidate in candidates if candidate]
    if isinstance(raw_data, dict):
        raw_data = [raw_data]
    if not isinstance(raw_data, list):
        return []
    normalized = []
    for entry in raw_data:
        if isinstance(entry, str):
            letra_value = entry.strip().upper()
            if not letra_value:
                continue
            normalized.append({
                "letra": letra_value,
                "descripcion": f"Letra {letra_value}"
            })
            continue
        if not isinstance(entry, dict):
            continue
        letra_value = entry.get('letra') or entry.get('Letra') or entry.get('name') or ''
        letra_value = str(letra_value).strip().upper()
        if not letra_value:
            continue
        descripcion = entry.get('descripcion') or entry.get('description') or entry.get('descripcion_letra') or ''
        normalized.append({
            "letra": letra_value,
            "descripcion": descripcion or f"Letra {letra_value}"
        })
    return normalized

def enforce_resguardo_single_letter(payload):
    """
    Los talonarios de resguardo sólo aceptan una letra. Validamos y devolvemos
    la versión normalizada o lanzamos ValueError si el payload no es válido.
    """
    normalized = normalize_letters_payload(payload)
    if not normalized:
        raise ValueError('Los talonarios de resguardo requieren al menos una letra permitida')
    if len(normalized) > 1:
        raise ValueError('Los talonarios de resguardo sólo permiten una única letra')
    return normalized

def build_letters_json(letras_payload):
    """
    Generar un JSON compacto con las letras disponibles del talonario.
    """
    letters = []
    for entry in letras_payload or []:
        if isinstance(entry, dict):
            letra_val = entry.get('letra') or entry.get('Letra') or entry.get('name')
        else:
            letra_val = entry
        letra_val = str(letra_val).strip().upper() if letra_val is not None else ''
        if letra_val and letra_val not in letters:
            letters.append(letra_val)
    return json.dumps(letters) if letters else "[]"

def get_next_number_for_sequence(session, headers, talonario_name, tipo_documento, letra):
    """
    Obtener el siguiente número para una secuencia específica de talonario
    Args:
        talonario_name: Nombre del talonario
        tipo_documento: FAC, NCC, NDB, etc.
        letra: A, B, C, etc.
    Returns:
        next_number: Siguiente número disponible
    """
    try:
        # Obtener el talonario completo
        talonario_resp, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            operation_name=f"Get talonario '{talonario_name}'"
        )
        if talonario_error:
            return None
        if talonario_resp.status_code != 200:
            return None
        talonario_data = talonario_resp.json()['data']
        ultimos_numeros = talonario_data.get('ultimos_numeros', [])
        # Buscar el último número para esta combinación
        for ultimo_numero in ultimos_numeros:
            if (ultimo_numero.get('tipo_documento') == tipo_documento and 
                ultimo_numero.get('letra') == letra):
                return ultimo_numero.get('ultimo_numero_utilizado', 0) + 1
        # Si no existe registro, usar número de inicio del talonario
        return talonario_data.get('numero_de_inicio', 1)
    except Exception as e:
        print(f"Error obteniendo siguiente número: {str(e)}")
        return None

def update_last_number_for_sequence(session, headers, talonario_name, tipo_documento, letra, nuevo_numero):
    """
    Actualizar el último número utilizado para una secuencia específica
    Args:
        talonario_name: Nombre del talonario
        tipo_documento: FAC, NCC, NDB, etc.
        letra: A, B, C, etc.
        nuevo_numero: Nuevo último número utilizado
    """
    try:
        # Obtener el talonario completo
        talonario_resp, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            operation_name=f"Get talonario '{talonario_name}' for update"
        )
        if talonario_error:
            print(f"Error obteniendo talonario: {talonario_error}")
            return False
        if talonario_resp.status_code != 200:
            print(f"Error obteniendo talonario: {talonario_resp.status_code}")
            return False
        talonario_data = talonario_resp.json()['data']
        ultimos_numeros = talonario_data.get('ultimos_numeros', [])
        # Buscar si ya existe un registro para esta combinación
        found = False
        for ultimo_numero in ultimos_numeros:
            if (ultimo_numero.get('tipo_documento') == tipo_documento and 
                ultimo_numero.get('letra') == letra):
                ultimo_numero['ultimo_numero_utilizado'] = nuevo_numero
                found = True
                break
        # Si no existe, crear nuevo registro
        if not found:
            prefix = get_sales_prefix(bool(talonario_data.get('factura_electronica')))
            punto_venta = str(talonario_data.get('punto_de_venta', '1')).zfill(5)
            numero_formateado = str(nuevo_numero).zfill(8)
            metodo_numeracion = f"{prefix}-{tipo_documento}-{letra}-{punto_venta}-{numero_formateado}"
            ultimos_numeros.append({
                'tipo_documento': tipo_documento,
                'letra': letra,
                'ultimo_numero_utilizado': nuevo_numero,
                'metodo_numeracion': metodo_numeracion
            })
        # Actualizar el talonario
        update_resp, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            data={"data": {"ultimos_numeros": ultimos_numeros}},
            operation_name=f"Update talonario last numbers '{talonario_name}'"
        )
        if update_error:
            print(f"Error actualizando último número: {update_error}")
            return False
        if update_resp.status_code in [200, 202]:
            print(f"Actualizado último número: {tipo_documento}-{letra} = {nuevo_numero}")
            return True
        else:
            print(f"Error actualizando último número: {update_resp.status_code}")
            return False
    except Exception as e:
        print(f"Error actualizando último número: {str(e)}")
        return False

@talonarios_bp.route('/api/talonarios', methods=['POST'])
def create_talonario():
    """Crear un nuevo talonario"""
    print("Creando nuevo talonario")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        # Obtener datos del request (aceptar payload plano o con clave 'data')
        payload = request.get_json()
        if not payload:
            return jsonify({"success": False, "message": "Datos requeridos"}), 400
        data = payload.get('data') if isinstance(payload, dict) and isinstance(payload.get('data'), dict) else payload
        if not isinstance(data, dict):
            return jsonify({"success": False, "message": "Formato de datos invalido"}), 400
        # Validar campos requeridos
        required_fields = ['name', 'tipo_de_talonario', 'compania']
        for field in required_fields:
            if field not in data:
                return jsonify({"success": False, "message": f"Campo requerido faltante: {field}"}), 400
        # Preparar datos para ERPNext
        talonario_data = {
            "data": {
                "doctype": "Talonario",
                "name": data['name'],
                "tipo_de_talonario": data['tipo_de_talonario'],
                "descripcion": data.get('descripcion', ''),
                "punto_de_venta": data.get('punto_de_venta', ''),
                "numero_de_inicio": data.get('numero_de_inicio', 1),
                "numero_de_fin": data.get('numero_de_fin', 99999999),
                "tipo_numeracion": data.get('tipo_numeracion', 'Automática'),
                "por_defecto": data.get('por_defecto', False),
                "factura_electronica": data.get('factura_electronica', True),
                "compania": data['compania'],
                "metodo_numeracion_factura_venta": data.get('metodo_numeracion_factura_venta', ''),
                "metodo_numeracion_nota_debito": data.get('metodo_numeracion_nota_debito', ''),
                "metodo_numeracion_nota_credito": data.get('metodo_numeracion_nota_credito', ''),
                "tipo_comprobante_orden_pago": data.get('tipo_comprobante_orden_pago', ''),
                "tipo_comprobante_recibo": data.get('tipo_comprobante_recibo', ''),
                "tipo_comprobante_remito": data.get('tipo_comprobante_remito', ''),
                "tipo_comprobante_factura_electronica": data.get('tipo_comprobante_factura_electronica', ''),
            }
        }
        # Generar automáticamente metodo_numeracion_factura_venta (requerido)
        if not talonario_data['data']['metodo_numeracion_factura_venta']:
            # Determinar prefijo para ventas (VE/VM)
            prefix = get_sales_prefix(bool(talonario_data['data'].get('factura_electronica')))
            # Usar tipo de talonario como base (FAC, NDC, NDB, etc.)
            tipo_base = 'FAC'  # Default para facturas
            if 'Factura' in talonario_data['data']['tipo_de_talonario']:
                tipo_base = 'FAC'
            elif 'Nota de Crédito' in talonario_data['data']['tipo_de_talonario']:
                tipo_base = 'NDC'
            elif 'Nota de Débito' in talonario_data['data']['tipo_de_talonario']:
                tipo_base = 'NDB'
            elif 'Recibo' in talonario_data['data']['tipo_de_talonario']:
                tipo_base = 'REC'
            # Validar que tenga punto_de_venta
            if not talonario_data['data']['punto_de_venta']:
                return jsonify({"success": False, "message": "Punto de venta requerido para generar método de numeración"}), 400
            # Formatear punto de venta (5 dígitos) y número de inicio (8 dígitos)
            punto_venta = str(talonario_data['data']['punto_de_venta']).zfill(5)
            numero_inicio = str(talonario_data['data']['numero_de_inicio']).zfill(8)
            # Generar el método de numeración con prefijo configurable
            # Por ahora usamos 'A' como letra por defecto, se puede ajustar según las letras permitidas
            metodo_numeracion = f"{prefix}-{tipo_base}-A-{punto_venta}-{numero_inicio}"
            talonario_data['data']['metodo_numeracion_factura_venta'] = metodo_numeracion
            print(f"Generado metodo_numeracion_factura_venta: {metodo_numeracion}")
        else:
            # Si viene definido, validarlo
            metodo = talonario_data['data']['metodo_numeracion_factura_venta']
            if not metodo or len(metodo.split('-')) < 5:
                return jsonify({"success": False, "message": "Formato de método de numeración inválido. Debe ser: PREFIJO-TIPO-LETRA-PV-NUMERO"}), 400
        # Agregar letras si existen, sino usar letras por defecto
        talonario_type = talonario_data['data']['tipo_de_talonario']
        normalized_letters = normalize_letters_payload(data.get('letras'))
        if talonario_type == 'TALONARIOS DE RESGUARDO':
            try:
                talonario_data['data']['letras'] = enforce_resguardo_single_letter(data.get('letras'))
            except ValueError as exc:
                return jsonify({"success": False, "message": str(exc)}), 400
        elif normalized_letters:
            talonario_data['data']['letras'] = normalized_letters
        else:
            # Letras disponibles por defecto para AFIP
            letras_disponibles = [
                {"letra": "A", "descripcion": "Factura A"},
                {"letra": "B", "descripcion": "Factura B"},
                {"letra": "C", "descripcion": "Factura C"},
                {"letra": "E", "descripcion": "Factura E"},
                {"letra": "M", "descripcion": "Factura M"},
                {"letra": "X", "descripcion": "Factura X"},
                {"letra": "T", "descripcion": "Factura T"},
                {"letra": "R", "descripcion": "Factura R"}
            ]
            talonario_data['data']['letras'] = letras_disponibles
        # Cachear letras en formato JSON para consultas rápidas
        talonario_data['data']['letras_json'] = build_letters_json(talonario_data['data']['letras'])
        # Agregar tipos de comprobante AFIP si existen
        if 'tipo_de_comprobante_afip' in data and data['tipo_de_comprobante_afip']:
            talonario_data['data']['tipo_de_comprobante_afip'] = data['tipo_de_comprobante_afip']
        # Crear el talonario en ERPNext
        create_resp, create_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Talonario",
            data=talonario_data,
            operation_name=f"Create talonario '{data['name']}'"
        )
        if create_error:
            print(f"Error creando talonario: {create_error}")
            return handle_erpnext_error(create_error, f"Failed to create talonario {data['name']}")
        if create_resp.status_code in [200, 201]:
            result = create_resp.json()
            print("Talonario creado exitosamente")
            return jsonify({
                "success": True,
                "message": "Talonario creado exitosamente",
                "data": result.get('data', {})
            })
        else:
            print(f"Error creando talonario: {create_resp.status_code}")
            return jsonify({"success": False, "message": f"Error creando talonario: {create_resp.text}"}), 400
    except Exception as e:
        print(f"Error creando talonario: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
# Backfill endpoints were added originally to help migrate historical records lacking
# `letras_json`. All existing talonarios have been migrated and the front-end now
# includes `letras_json` in create/update payloads, so these endpoints are no longer
# necessary and have been removed to keep the codebase clean.


# removed backfill_all_talonarios_letras — see commit message above

@talonarios_bp.route('/api/talonarios/<talonario_name>', methods=['PUT'])
def update_talonario(talonario_name):
    """Actualizar un talonario existente"""
    print(f"Actualizando talonario: {talonario_name}")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        payload = request.get_json()
        if not payload:
            return jsonify({"success": False, "message": "Datos requeridos"}), 400
        if not isinstance(payload, dict):
            return jsonify({"success": False, "message": "Formato de datos invalido"}), 400
        inner_data = payload.get('data') if isinstance(payload.get('data'), dict) else None
        data = inner_data if inner_data is not None else payload
        desired_docstatus = payload.pop('docstatus', None)
        docstatus_result = None
        if desired_docstatus is None and inner_data is not None:
            desired_docstatus = data.pop('docstatus', None)
        if desired_docstatus is not None:
            try:
                docstatus_result = transition_talonario_docstatus(
                    session=session,
                    headers=headers,
                    talonario_name=talonario_name,
                    target_docstatus=int(desired_docstatus)
                )
            except RuntimeError as exc:
                return jsonify({
                    "success": False,
                    "message": str(exc)
                }), 400
            # Si sólo se solicitó actualizar docstatus, devolver inmediatamente
            if not data:
                return jsonify({
                    "success": True,
                    "message": "Estado del talonario actualizado",
                    "data": docstatus_result
                })
        if not isinstance(data, dict):
            return jsonify({"success": False, "message": "Formato de datos invalido"}), 400
        # Normalizar letras si se enviaron y aplicar validaciones para resguardo
        if 'letras' in data:
            letras_payload = data.get('letras', [])
            tipo_talonario = data.get('tipo_de_talonario')
            if not tipo_talonario:
                try:
                    existing_doc = fetch_talonario_doc(session, headers, talonario_name)
                    tipo_talonario = existing_doc.get('tipo_de_talonario')
                except RuntimeError as exc:
                    return jsonify({"success": False, "message": str(exc)}), 400
            if tipo_talonario == 'TALONARIOS DE RESGUARDO':
                try:
                    data['letras'] = enforce_resguardo_single_letter(letras_payload)
                except ValueError as exc:
                    return jsonify({"success": False, "message": str(exc)}), 400
            else:
                data['letras'] = normalize_letters_payload(letras_payload)
            data['letras_json'] = build_letters_json(data['letras'])
        talonario_data = {"data": data}
        update_resp, update_error = make_erpnext_request(
            session=session,
            method="PUT",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            data=talonario_data,
            operation_name=f"Update talonario '{talonario_name}'"
        )
        if update_error:
            print(f"Error actualizando talonario: {update_error}")
            return handle_erpnext_error(update_error, f"Failed to update talonario {talonario_name}")
        if update_resp.status_code in [200, 202]:
            result = update_resp.json()
            updated_data = result.get('data', {})
            # Si se cambió el docstatus antes, asegurarnos de devolver el valor correcto
            if docstatus_result and 'docstatus' in docstatus_result:
                updated_data['docstatus'] = docstatus_result.get('docstatus')
            print("Talonario actualizado exitosamente")
            return jsonify({
                "success": True,
                "message": "Talonario actualizado exitosamente",
                "data": updated_data
            })
        else:
            print(f"Error actualizando talonario: {update_resp.status_code}")
            return jsonify({"success": False, "message": f"Error actualizando talonario: {update_resp.text}"}), 400
    except Exception as e:
        print(f"Error actualizando talonario: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@talonarios_bp.route('/api/talonarios/<talonario_name>', methods=['DELETE'])
def delete_talonario(talonario_name):
    """Eliminar un talonario"""
    print(f"Eliminando talonario: {talonario_name}")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        # Hacer la petición DELETE a ERPNext
        delete_resp, delete_error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Talonario/{quote(talonario_name)}",
            operation_name=f"Delete talonario '{talonario_name}'"
        )
        if delete_error:
            print(f"Error eliminando talonario: {delete_error}")
            return handle_erpnext_error(delete_error, f"Failed to delete talonario {talonario_name}")
        # Treat any 2xx success response from ERPNext as success (200, 202, 204)
        if delete_resp.status_code in [200, 202, 204]:
            print(f"Talonario {talonario_name} eliminado correctamente")
            return jsonify({
                'success': True,
                'message': f'Talonario {talonario_name} eliminado correctamente'
            })
        else:
            error_data = delete_resp.json() if delete_resp.content else {}
            print(f"Error eliminando talonario: {delete_resp.status_code}")
            return jsonify({
                'success': False,
                'message': f'Error al eliminar talonario: {delete_resp.status_code} - {error_data.get("message", "Error desconocido")}',
                'data': error_data
            }), max(delete_resp.status_code, 400)
    except Exception as e:
        print(f"Error eliminando talonario: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'Error interno del servidor: {str(e)}'}), 500

@talonarios_bp.route('/api/talonarios/update-numeracion', methods=['POST'])
def update_talonarios_numeracion():
    """Actualizar todos los talonarios existentes para agregar metodo_numeracion_factura_venta si no lo tienen"""
    print("Actualizando métodos de numeración en talonarios existentes")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        # Obtener todos los talonarios
        talonarios_resp, talonarios_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            operation_name="Get all talonarios for numeration update"
        )
        if talonarios_error:
            return handle_erpnext_error(talonarios_error, "Failed to get talonarios")
        if talonarios_resp.status_code != 200:
            return jsonify({"success": False, "message": "Error obteniendo talonarios"}), 400
        talonarios_data = talonarios_resp.json()
        talonarios = talonarios_data.get('data', [])
        updated_count = 0
        for talonario in talonarios:
            # Verificar si ya tiene metodo_numeracion_factura_venta
            if not talonario.get('metodo_numeracion_factura_venta'):
                # Generar el método de numeración
                prefix = get_sales_prefix(bool(talonario.get('factura_electronica')))
                tipo_base = 'FAC'  # Default
                tipo_talonario = talonario.get('tipo_de_talonario', '')
                if 'Factura' in tipo_talonario:
                    tipo_base = 'FAC'
                elif 'Nota de Crédito' in tipo_talonario:
                    tipo_base = 'NDC'
                elif 'Nota de Débito' in tipo_talonario:
                    tipo_base = 'NDB'
                elif 'Recibo' in tipo_talonario:
                    tipo_base = 'REC'
                punto_venta = str(talonario.get('punto_de_venta', '1')).zfill(5)
                numero_inicio = str(talonario.get('numero_de_inicio', 1)).zfill(8)
                metodo_numeracion = f"{prefix}-{tipo_base}-A-{punto_venta}-{numero_inicio}"
                # Actualizar el talonario
                update_resp, update_error = make_erpnext_request(
                    session=session,
                    method="PUT",
                    endpoint=f"/api/resource/Talonario/{talonario['name']}",
                    data={"data": {"metodo_numeracion_factura_venta": metodo_numeracion}},
                    operation_name=f"Update talonario numeration '{talonario['name']}'"
                )
                if update_error:
                    print(f"Error actualizando talonario {talonario['name']}: {update_error}")
                elif update_resp.status_code in [200, 202]:
                    updated_count += 1
                    print(f"Actualizado talonario {talonario['name']}")
                else:
                    print(f"Error actualizando talonario {talonario['name']}: {update_resp.status_code}")
        return jsonify({
            "success": True,
            "message": f"Actualizados {updated_count} talonarios con métodos de numeración",
            "updated_count": updated_count
        })
    except Exception as e:
        print(f"Error actualizando talonarios: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
        # Verificar si el talonario existe
        talonario_resp, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            operation_name=f"Check talonario existence '{talonario_name}'"
        )
        if talonario_error:
            return handle_erpnext_error(talonario_error, f"Failed to check talonario {talonario_name}")
        if talonario_resp.status_code != 200:
            return jsonify({"success": False, "message": f"Talonario '{talonario_name}' no encontrado"}), 404
        # Verificar si tiene facturas asociadas
        # Nota: Asumimos que las facturas tienen un campo que referencia el talonario
        # Si no hay campo, esta verificación puede ser removida o ajustada
        invoices_resp, invoices_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Sales Invoice",
            params={
                "filters": f'[["custom_talonario","=","{talonario_name}"]]',
                "fields": '["name"]'
            },
            operation_name=f"Check invoices for talonario '{talonario_name}'"
        )
        if invoices_error:
            # Si hay error verificando, permitir eliminación (asumir que no hay facturas)
            pass
        elif invoices_resp.status_code == 200:
            invoices_data = invoices_resp.json()
            if invoices_data.get('data') and len(invoices_data['data']) > 0:
                return jsonify({
                    "success": False,
                    "message": f"No se puede eliminar el talonario '{talonario_name}' porque tiene {len(invoices_data['data'])} factura(s) asociada(s)"
                }), 400
        # Eliminar el talonario
        delete_resp, delete_error = make_erpnext_request(
            session=session,
            method="DELETE",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            operation_name=f"Delete talonario '{talonario_name}'"
        )
        if delete_error:
            print(f"Error eliminando talonario: {delete_error}")
            return handle_erpnext_error(delete_error, f"Failed to delete talonario {talonario_name}")
        if delete_resp.status_code in [200, 202, 204]:
            print(f"Talonario '{talonario_name}' eliminado exitosamente")
            return jsonify({
                "success": True,
                "message": f"Talonario '{talonario_name}' eliminado exitosamente"
            })
        else:
            print(f"Error eliminando talonario: {delete_resp.status_code}")
            return jsonify({"success": False, "message": f"Error eliminando talonario: {delete_resp.text}"}), 400
    except Exception as e:
        print(f"Error eliminando talonario: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@talonarios_bp.route('/api/talonarios', methods=['GET'])
def get_talonarios():
    """Obtener talonarios"""
    print("Obteniendo talonarios")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        compania = request.args.get('compania')
        if not compania:
            return jsonify({"success": False, "message": "Compañía requerida"}), 400
        # Tipos permitidos en el listado — aceptar también REMITOS (y su variante electrónica)
        allowed_types = [
            "FACTURA ELECTRONICA",
            "COMPROBANTES DE EXPORTACION ELECTRONICOS",
            "TALONARIOS DE RESGUARDO",
            "RECIBOS",
            "REMITOS",
            "REMITOS ELECTRONICOS"
        ]
        default_fields = ["name", "punto_de_venta", "tipo_de_talonario", "docstatus"]
        requested_fields = request.args.get('fields')
        fields_param = requested_fields if requested_fields else json.dumps(default_fields)
        filters_list = [
            ["compania", "=", compania],
            ["tipo_de_talonario", "in", allowed_types]
        ]
        docstatus_filter = request.args.get('docstatus')
        if docstatus_filter is not None:
            try:
                filters_list.append(["docstatus", "=", int(docstatus_filter)])
            except ValueError:
                pass
        base_params = {
            "fields": fields_param,
            "filters": json.dumps(filters_list),
            "limit_page_length": request.args.get('limit_page_length', 1000)
        }
        talonarios_resp, talonarios_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params=base_params,
            operation_name=f"Get talonarios for company '{compania}'"
        )
        if talonarios_error:
            print(f"Error obteniendo talonarios: {talonarios_error}")
            return handle_erpnext_error(talonarios_error, f"Failed to get talonarios for company {compania}")
        if talonarios_resp.status_code != 200:
            print(f"Error obteniendo talonarios: {talonarios_resp.status_code}")
            return jsonify({"success": False, "message": f"Error consultando ERPNext: {talonarios_resp.text}"}), talonarios_resp.status_code
        talonarios_summary = talonarios_resp.json().get('data', [])

        # Recolectar nombres para solicitudes en bloque de las child tables
        talonario_names = [t.get('name') for t in talonarios_summary if t.get('name')]

        # Preparar mapas para child rows: letras, ultimos_numeros, tipo_de_comprobante_afip
        letras_map = {}
        ultimos_map = {}
        comprobantes_map = {}

        if talonario_names:
            try:
                # Fetch Talonario Letra (letras)
                letras_payload = {
                    "doctype": "Talonario Letra",
                    "parent": "Talonario",
                    "fields": ["name", "parent", "letra", "descripcion", "idx"],
                    "filters": {
                        "parent": ["in", talonario_names],
                        "parenttype": "Talonario",
                        "parentfield": "letras"
                    },
                    "limit_page_length": 10000
                }
                letras_resp, letras_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.get_list",
                    data=letras_payload,
                    operation_name="Bulk fetch Talonario Letra"
                )
                if not letras_err and letras_resp.status_code == 200:
                    for row in letras_resp.json().get('message', []):
                        parent = row.get('parent')
                        if parent:
                            letras_map.setdefault(parent, []).append(row)
                else:
                    print(f"Error fetching Talonario Letra: {letras_err or (letras_resp.status_code if letras_resp else 'no response')}")

                # Fetch Talonario Ultimo Numero (ultimos_numeros)
                ultimos_payload = {
                    "doctype": "Talonario Ultimo Numero",
                    "parent": "Talonario",
                    "fields": ["name", "parent", "tipo_documento", "letra", "ultimo_numero_utilizado", "metodo_numeracion", "idx"],
                    "filters": {
                        "parent": ["in", talonario_names],
                        "parenttype": "Talonario",
                        "parentfield": "ultimos_numeros"
                    },
                    "limit_page_length": 10000
                }
                ultimos_resp, ultimos_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.get_list",
                    data=ultimos_payload,
                    operation_name="Bulk fetch Talonario Ultimo Numero"
                )
                if not ultimos_err and ultimos_resp.status_code == 200:
                    for row in ultimos_resp.json().get('message', []):
                        parent = row.get('parent')
                        if parent:
                            ultimos_map.setdefault(parent, []).append(row)
                else:
                    print(f"Error fetching Talonario Ultimo Numero: {ultimos_err or (ultimos_resp.status_code if ultimos_resp else 'no response')}")

                # Fetch Talonario Comprobante (tipo_de_comprobante_afip)
                comprobantes_payload = {
                    "doctype": "Talonario Comprobante",
                    "parent": "Talonario",
                    "fields": ["name", "parent", "tipo_documento", "codigo_afip", "idx"],
                    "filters": {
                        "parent": ["in", talonario_names],
                        "parenttype": "Talonario",
                        "parentfield": "tipo_de_comprobante_afip"
                    },
                    "limit_page_length": 10000
                }
                comp_resp, comp_err = make_erpnext_request(
                    session=session,
                    method="POST",
                    endpoint="/api/method/frappe.client.get_list",
                    data=comprobantes_payload,
                    operation_name="Bulk fetch Talonario Comprobante"
                )
                if not comp_err and comp_resp.status_code == 200:
                    for row in comp_resp.json().get('message', []):
                        parent = row.get('parent')
                        if parent:
                            comprobantes_map.setdefault(parent, []).append(row)
                else:
                    print(f"Error fetching Talonario Comprobante: {comp_err or (comp_resp.status_code if comp_resp else 'no response')}")

            except Exception as e:
                print(f"Error bulk fetching talonario child rows: {e}")

        # Construir talonarios_data combinando resumen y child rows
        talonarios_data = []
        for t in talonarios_summary:
            name = t.get('name')
            if not name:
                continue
            full = {**t}
            # Adjuntar arrays child si existen (mantener nombres de campo esperados por frontend)
            full['letras'] = letras_map.get(name, [])
            full['ultimos_numeros'] = ultimos_map.get(name, [])
            full['tipo_de_comprobante_afip'] = comprobantes_map.get(name, [])
            talonarios_data.append(full)
        activos_only = request.args.get('activos')
        if activos_only and activos_only.lower() in ('1', 'true', 'yes'):
            talonarios_data = [
                tal for tal in talonarios_data
                if tal.get('docstatus', 0) in (0, 1)
            ]
        return jsonify({
            "success": True,
            "message": "Datos de Talonario obtenidos correctamente",
            "data": talonarios_data
        })
    except Exception as e:
        print(f"Error obteniendo talonarios: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500

@talonarios_bp.route('/api/talonarios/types', methods=['GET'])
def get_talonario_types():
    """Obtener los tipos de talonarios disponibles desde el DocType"""
    print("Obteniendo tipos de talonarios disponibles")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        # Obtener el DocType Talonario para extraer las opciones del campo tipo_de_talonario
        doctype_resp, doctype_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/DocType/Talonario",
            operation_name="Get talonario DocType for types"
        )
        if doctype_error:
            print("Error obteniendo DocType")
            return handle_erpnext_error(doctype_error, "Failed to get talonario DocType")
        if doctype_resp.status_code != 200:
            print("Error obteniendo DocType")
            return jsonify({"success": False, "message": "Error obteniendo configuración de talonarios"}), 500
        doctype_data = doctype_resp.json()
        # Extraer las opciones del campo 'tipo_de_talonario'
        fields = doctype_data.get('data', {}).get('fields', [])
        tipo_talonario_field = None
        for field in fields:
            if field.get('fieldname') == 'tipo_de_talonario':
                tipo_talonario_field = field
                break
        if not tipo_talonario_field:
            return jsonify({"success": False, "message": "Campo tipo_de_talonario no encontrado"}), 500
        options_str = tipo_talonario_field.get('options', '')
        if not options_str:
            return jsonify({"success": False, "message": "No hay tipos de talonarios definidos"}), 500
        # Separar las opciones por líneas
        tipos_talonarios = [tipo.strip() for tipo in options_str.split('\n') if tipo.strip()]
        # Clasificar los tipos según si son electrónicos o físicos
        electronic_types = []
        physical_types = []
        for tipo in tipos_talonarios:
            if tipo in ['FACTURA ELECTRONICA', 'REMITOS ELECTRONICOS', 'COMPROBANTES DE EXPORTACION ELECTRONICOS']:
                electronic_types.append(tipo)
            else:
                physical_types.append(tipo)
        return jsonify({
            "success": True,
            "message": "Tipos de talonarios obtenidos correctamente",
            "data": {
                "electronic_types": electronic_types,
                "physical_types": physical_types,
                "all_types": tipos_talonarios
            }
        })
    except Exception as e:
        print(f"Error obteniendo tipos de talonarios: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
@talonarios_bp.route('/api/talonarios/<talonario_name>/ultimos-numeros', methods=['GET'])
def get_talonario_ultimos_numeros(talonario_name):
    """Obtener los últimos números utilizados de un talonario específico"""
    print(f"Obteniendo últimos números del talonario: {talonario_name}")
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        # Obtener el talonario completo
        talonario_resp, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Talonario/{talonario_name}",
            operation_name=f"Get talonario last numbers '{talonario_name}'"
        )
        if talonario_error:
            print(f"Error obteniendo talonario: {talonario_error}")
            return handle_erpnext_error(talonario_error, f"Failed to get talonario {talonario_name}")
        if talonario_resp.status_code != 200:
            print(f"Error obteniendo talonario: {talonario_resp.status_code}")
            return jsonify({"success": False, "message": "Talonario no encontrado"}), 404
        talonario_data = talonario_resp.json()['data']
        ultimos_numeros = talonario_data.get('ultimos_numeros', [])
        # Formatear los datos para el frontend
        formatted_numbers = []
        for ultimo_numero in ultimos_numeros:
            formatted_numbers.append({
                'tipo_documento': ultimo_numero.get('tipo_documento'),
                'letra': ultimo_numero.get('letra'),
                'ultimo_numero_utilizado': ultimo_numero.get('ultimo_numero_utilizado', 0),
                'metodo_numeracion': ultimo_numero.get('metodo_numeracion', ''),
                'siguiente_numero': ultimo_numero.get('ultimo_numero_utilizado', 0) + 1
            })
        return jsonify({
            "success": True,
            "message": "Últimos números obtenidos correctamente",
            "data": {
                'talonario_name': talonario_name,
                'punto_de_venta': talonario_data.get('punto_de_venta'),
                'ultimos_numeros': formatted_numbers
            }
        })
    except Exception as e:
        print(f"Error obteniendo últimos números: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Error interno del servidor: {str(e)}"}), 500
@talonarios_bp.route('/api/talonarios/<talonario_name>/next-remito-number', methods=['POST'])
def get_next_remito_number(talonario_name):
    """Obtener el próximo número disponible para remitos asociados a un talonario."""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    try:
        payload = request.get_json(silent=True) or {}
        letra = (payload.get('letra') or 'R').upper()
        next_number = get_next_number_for_sequence(
            session=session,
            headers=headers,
            talonario_name=talonario_name,
            tipo_documento='REM',
            letra=letra
        )
        if not next_number:
            next_number = 1
        return jsonify({
            "success": True,
            "data": {
                "next_number": next_number,
                "formatted_number": str(next_number).zfill(8),
                "letra": letra
            }
        })
    except Exception as e:
        print(f"Error obteniendo próximo número de remito: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500
