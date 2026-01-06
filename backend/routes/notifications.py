from flask import Blueprint, request, jsonify
import requests
import json
from urllib.parse import quote
from config import ERPNEXT_URL
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

notifications_bp = Blueprint('notifications', __name__)


def _parse_notification_identifier(notification_id):
    """
    Split notification ids in the format '<source>::<id>' to know what ERPNext
    resource we need to hit.
    """
    if not notification_id:
        return "data_import", ""

    if "::" in notification_id:
        prefix, suffix = notification_id.split("::", 1)
        return (prefix or "data_import"), suffix

    # Backwards compatibility with older ids that only contained the Data Import name
    return "data_import", notification_id


def _normalize_status(raw_status, has_error=False):
    """
    Map ERPNext status values to the reduced set handled by the frontend UI.
    """
    if has_error:
        return "error"

    if not raw_status:
        return "info"

    status = raw_status.lower()

    if "partial" in status:
        return "partially successful"
    if "success" in status or "completed" in status:
        return "completed"
    if status in ("pending", "in progress", "started", "processing"):
        return "in progress"
    if "fail" in status or "error" in status:
        return "error"

    return status


def _priority_from_status(status):
    if status == "completed":
        return "success"
    if status == "error":
        return "error"
    if status == "partially successful":
        return "warning"
    return "info"

@notifications_bp.route('/api/notifications', methods=['GET'])
def get_notifications():
    """
    Obtener notificaciones del sistema, incluyendo resultados de importaciones
    """

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response


    try:

        notifications = []

        # 1) Notification Log entries (ERPNext-native notifications)
        notif_resp, notif_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Notification Log",
            params={
                "fields": json.dumps(["*"]),
                "order_by": "creation desc",
                "limit_page_length": 50
            },
            operation_name="Get notification logs"
        )

        if notif_error:
            return handle_erpnext_error(notif_error, "Failed to get Notification Log entries")

        if notif_resp.status_code == 200:
            notif_data = notif_resp.json().get('data', [])
            for log in notif_data:
                log_name = log.get('name')
                if not log_name:
                    continue

                timestamp = log.get('creation') or log.get('modified')
                status = _normalize_status(log.get('type'))
                priority = _priority_from_status(status)
                document_type = log.get('document_type')
                document_name = log.get('document_name')

                message_parts = []
                if document_type and document_name:
                    message_parts.append(f"{document_type} {document_name}")
                if log.get('subject'):
                    message_parts.append(log['subject'])
                if not message_parts and log.get('message'):
                    message_parts.append(log['message'])
                if not message_parts:
                    message_parts.append("Notificación del sistema")

                notification = {
                    'id': f"notification_log::{log_name}",
                    'type': 'notification_log',
                    'source': 'notification_log',
                    'title': log.get('subject') or "Notificación",
                    'message': " - ".join(message_parts),
                    'timestamp': timestamp,
                    'status': status,
                    'priority': priority,
                    'read': bool(log.get('seen') in (1, True) or log.get('read') in (1, True)),
                    'details': log
                }
                notifications.append(notification)
        else:
            print(f"[notifications] Error al obtener Notification Log: {notif_resp.status_code}")
            print(f"[notifications] Respuesta: {notif_resp.text}")

        # 2) Data Import Log entries (sin consultar Data Import hasta ver detalles)
        import_log_resp, import_log_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Data Import Log",
            params={
                "fields": json.dumps(["*"]),
                "order_by": "creation desc",
                "limit_page_length": 50
            },
            operation_name="Get data import logs"
        )

        if import_log_error:
            return handle_erpnext_error(import_log_error, "Failed to get Data Import Log entries")

        if import_log_resp.status_code == 200:
            import_notifications = {}
            log_data = import_log_resp.json().get('data', [])

            for log in log_data:
                data_import_name = log.get('data_import')
                if not data_import_name:
                    continue

                timestamp = log.get('creation') or log.get('modified') or ""
                status = _normalize_status(log.get('status'), has_error=bool(log.get('error_message')))
                priority = _priority_from_status(status)

                base_message = log.get('error_message') or log.get('message') or "Revisar detalles de la importación"
                if log.get('row_index') is not None:
                    base_message = f"Fila {log.get('row_index')}: {base_message}"

                notification = {
                    'id': f"data_import::{data_import_name}",
                    'type': 'data_import',
                    'source': 'data_import',
                    'title': f"Importación {data_import_name}",
                    'message': base_message,
                    'timestamp': timestamp,
                    'status': status,
                    'priority': priority,
                    'read': False,
                    'details': {
                        'data_import': data_import_name,
                        'log_name': log.get('name'),
                        'row_index': log.get('row_index'),
                        'docname': log.get('docname'),
                        'status': log.get('status'),
                        'error_message': log.get('error_message'),
                        'exception': log.get('exception')
                    }
                }

                existing = import_notifications.get(data_import_name)
                existing_ts = existing.get('timestamp') if existing else ""
                if not existing or (timestamp and timestamp > (existing_ts or "")):
                    import_notifications[data_import_name] = notification

            notifications.extend(import_notifications.values())
        else:
            print(f"[notifications] Error al obtener Data Import Log: {import_log_resp.status_code}")
            print(f"[notifications] Respuesta: {import_log_resp.text}")

        notifications.sort(key=lambda n: n.get('timestamp') or "", reverse=True)

        result = {
            'success': True,
            'data': notifications,
            'unread_count': len([n for n in notifications if not n.get('read')])
        }

        return jsonify(result)

    except requests.exceptions.RequestException as e:
        return jsonify({
            'success': False,
            'message': f'Error conectando con ERPNext: {str(e)}'
        }), 500
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'message': f'Error interno: {str(e)}'
        }), 500

@notifications_bp.route('/api/notifications/<notification_id>/details', methods=['GET'])
def get_notification_details(notification_id):
    """
    Obtener detalles completos de una notificación de importación
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    source, target_id = _parse_notification_identifier(notification_id)

    try:
        print(f"[notifications] Obteniendo detalles de notificación: {notification_id}")

        if source == 'notification_log':
            detail_resp, detail_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Notification Log/{quote(target_id)}",
                params={"fields": json.dumps(["*"])},
                operation_name=f"Get notification log details for {target_id}"
            )

            if detail_error:
                return handle_erpnext_error(detail_error, f"Failed to get notification log {target_id}")

            if detail_resp.status_code == 200:
                log_data = detail_resp.json().get('data', {})
                status = _normalize_status(log_data.get('type'))
                details = {
                    'import_name': log_data.get('document_name'),
                    'status': status,
                    'reference_doctype': log_data.get('document_type'),
                    'import_type': log_data.get('type'),
                    'total_rows': None,
                    'successful_imports': None,
                    'failed_imports': None,
                    'creation': log_data.get('creation'),
                    'modified': log_data.get('modified'),
                    'payload_count': None,
                    'template_warnings': [],
                    'errors': [],
                    'notification_log': log_data
                }

                return jsonify({
                    'success': True,
                    'details': details
                })
            else:
                return jsonify({
                    'success': False,
                    'message': f'Error obteniendo Notification Log: {detail_resp.status_code}'
                }), detail_resp.status_code

        # Obtener detalles del Data Import
        detail_resp, detail_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Data Import/{quote(target_id)}",
            operation_name=f"Get notification details for {target_id}"
        )

        if detail_error:
            return handle_erpnext_error(detail_error, f"Failed to get notification details for {target_id}")

        if detail_resp.status_code == 200:
            import_data = detail_resp.json().get('data', {})

            # Procesar template_warnings para resumirlos
            template_warnings = import_data.get('template_warnings', '')
            summarized_warnings = []

            if template_warnings:
                try:
                    # Parsear el JSON string de warnings
                    warnings_list = json.loads(template_warnings) if isinstance(template_warnings, str) else template_warnings

                    # Agrupar warnings por tipo
                    warning_groups = {}
                    for warning in warnings_list:
                        warning_type = warning.get('type', 'warning')
                        message = warning.get('message', '')

                        if warning_type not in warning_groups:
                            warning_groups[warning_type] = []

                        warning_groups[warning_type].append(message)

                    # Crear resumen de warnings
                    for warning_type, messages in warning_groups.items():
                        if warning_type == 'warning':
                            # Para warnings, contar items faltantes
                            item_missing_count = 0
                            price_list_missing = False

                            for message in messages:
                                if 'do not exist for Item:' in message:
                                    # Contar items en la lista
                                    items_text = message.split('Item:')[1].strip()
                                    items = [item.strip() for item in items_text.split(',') if item.strip()]
                                    item_missing_count += len(items)
                                elif 'do not exist for Price List:' in message:
                                    price_list_missing = True

                            if item_missing_count > 0:
                                summarized_warnings.append(f"⚠️ {item_missing_count} items no existen en el sistema")
                            if price_list_missing:
                                summarized_warnings.append("⚠️ La lista de precios no existe")

                        elif warning_type == 'error':
                            # Para errores, mostrar los primeros pocos
                            error_count = len(messages)
                            if error_count > 0:
                                summarized_warnings.append(f"❌ {error_count} errores de validación encontrados")
                                # Mostrar máximo 3 errores específicos
                                for i, message in enumerate(messages[:3]):
                                    # Extraer el valor problemático del mensaje HTML
                                    if '<strong>' in message and '</strong>' in message:
                                        value = message.split('<strong>')[1].split('</strong>')[0]
                                        summarized_warnings.append(f"   • Valor faltante: {value}")
                                if error_count > 3:
                                    summarized_warnings.append(f"   • ... y {error_count - 3} errores más")

                except Exception as e:
                    print(f"[notifications] Error procesando template_warnings: {e}")
                    summarized_warnings = ["Error procesando warnings"]

            # Obtener logs de error si hay fallos
            errors = []
            if import_data.get('failed_imports', 0) > 0:
                log_resp, log_error = make_erpnext_request(
                    session=session,
                    method="GET",
                    endpoint="/api/resource/Data Import Log",
                    params={
                        "filters": json.dumps([['data_import', '=', target_id]]),
                        "fields": json.dumps(['row_index', 'error_message', 'docname']),
                        "limit_page_length": 50
                    },
                    operation_name=f"Get error logs for notification {target_id}"
                )

                if log_error:
                    print(f"[notifications] Error getting error logs: {log_error}")
                    errors = []
                elif log_resp.status_code == 200:
                    errors = log_resp.json().get('data', [])
                else:
                    print(f"[notifications] Error getting error logs: {log_resp.status_code} - {log_resp.text}")
                    errors = []

            details = {
                'import_name': import_data.get('name'),
                'status': import_data.get('status'),
                'reference_doctype': import_data.get('reference_doctype'),
                'import_type': import_data.get('import_type'),
                'total_rows': import_data.get('total_rows', 0),
                'successful_imports': import_data.get('successful_imports', 0),
                'failed_imports': import_data.get('failed_imports', 0),
                'creation': import_data.get('creation'),
                'modified': import_data.get('modified'),
                'payload_count': import_data.get('payload_count', 0),
                'template_warnings': summarized_warnings,
                'errors': errors
            }

            return jsonify({
                'success': True,
                'details': details
            })
        else:
            return jsonify({
                'success': False,
                'message': f'Error obteniendo detalles: {detail_resp.status_code}'
            }), detail_resp.status_code

    except Exception as e:
        import traceback
        print(f"[notifications] Traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False,
            'message': f'Error interno: {str(e)}'
        }), 500
@notifications_bp.route('/api/notifications/<notification_id>/read', methods=['POST'])
def mark_notification_read(notification_id):
    """
    Marcar una notificación como leída - crea un comentario en ERPNext
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    source, target_id = _parse_notification_identifier(notification_id)

    try:

        if source == 'notification_log':
            update_resp, update_error = make_erpnext_request(
                session=session,
                method="PUT",
                endpoint=f"/api/resource/Notification Log/{quote(target_id)}",
                data={"data": {"seen": 1, "read": 1}},
                operation_name=f"Mark notification log {target_id} as read"
            )

            if update_error:
                print(f"[notifications] Error al actualizar Notification Log {target_id}: {update_error}")
                return jsonify({
                    'success': True,
                    'message': 'Notificación marcada como leída (no se pudo actualizar Notification Log)',
                    'warning': 'No se pudo registrar el cambio en ERPNext'
                })

            if update_resp.status_code in [200, 202]:
                return jsonify({
                    'success': True,
                    'message': 'Notification Log marcado como leído en ERPNext'
                })

            print(f"[notifications] Error al actualizar Notification Log {target_id}: {update_resp.status_code}")
            print(f"[notifications] Respuesta completa: {update_resp.text}")
            return jsonify({
                'success': True,
                'message': 'Notificación marcada como leída (no se pudo actualizar Notification Log)',
                'warning': 'No se pudo registrar el cambio en ERPNext'
            })

        # Crear un comentario en el documento de Data Import para marcarlo como visto
        comment_data = {
            "doctype": "Comment",
            "comment_type": "Info",
            "reference_doctype": "Data Import",
            "reference_name": target_id,
            "content": f"Notificación vista por usuario {user_id} desde ERP Frontend",
            "comment_email": user_id
        }

        comment_resp, comment_error = make_erpnext_request(
            session=session,
            method="POST",
            endpoint="/api/resource/Comment",
            data={"data": comment_data},
            operation_name=f"Mark notification {target_id} as read"
        )

        if comment_error:
            print(f"[notifications] Error al crear comentario: {comment_error}")
            # Aun así devolver éxito, ya que la notificación se marcó como leída en el frontend
            return jsonify({
                'success': True,
                'message': 'Notificación marcada como leída (comentario no creado)',
                'warning': 'No se pudo registrar en ERPNext'
            })

        if comment_resp.status_code in [200, 201]:
            return jsonify({
                'success': True,
                'message': 'Notificación marcada como leída en ERPNext'
            })
        else:
            print(f"[notifications] Error al crear comentario: {comment_resp.status_code}")
            print(f"[notifications] Respuesta completa: {comment_resp.text}")
            # Aun así devolver éxito, ya que la notificación se marcó como leída en el frontend
            return jsonify({
                'success': True,
                'message': 'Notificación marcada como leída (comentario no creado)',
                'warning': 'No se pudo registrar en ERPNext'
            })

    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'message': f'Error interno: {str(e)}'
        }), 500
