# http_utils.py - Utilidades para manejar peticiones HTTP a ERPNext de manera centralizada

import requests
import json
import re
import html
import os
from flask import jsonify
from typing import Dict, Any, Optional, Tuple
from config import ERPNEXT_URL, ERPNEXT_HOST
from urllib.parse import quote, unquote

def is_detailed_logging_enabled(operation_name: str = "") -> bool:
    """Verificar si el logging detallado está habilitado"""
    # No mostrar logs detallados para operaciones de notificaciones y datos recientes
    if "notification" in operation_name.lower() or "check if" in operation_name.lower() or "get recent" in operation_name.lower():
        return False

    return os.getenv('LOG_DETALLADO', 'false').lower() in ('true', '1', 'yes', 'on')

def _collapse_spaced_letters(text: str) -> str:
    if not text:
        return text
    parts = text.split()
    if len(parts) > 10:
        single_char_ratio = sum(1 for p in parts if len(p) == 1) / len(parts)
        if single_char_ratio > 0.6:
            return ''.join(parts)
    return text

def clean_html_message(raw_text) -> str:
    if raw_text is None:
        return ''
    if not isinstance(raw_text, str):
        raw_text = str(raw_text)
    text = raw_text
    try:
        text = html.unescape(text)
    except Exception:
        pass
    try:
        text = bytes(text, 'utf-8').decode('unicode_escape')
    except Exception:
        pass
    text = re.sub(r'<\s*a[^>]*>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<\s*/\s*a\s*>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    try:
        text = unquote(text)
    except Exception:
        pass
    text = _collapse_spaced_letters(text)
    text = re.sub(r'[\r\n]+', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def extract_docnames_from_error(raw_text: Optional[str]) -> list:
    if not raw_text:
        return []
    names = []
    try:
        matches = re.findall(r'/app/[A-Za-z0-9_-]+/([A-Za-z0-9\-\.]+)', raw_text)
        for match in matches:
            candidate = match.strip()
            if candidate and candidate not in names:
                names.append(candidate)
    except Exception:
        pass

    cleaned = clean_html_message(raw_text)
    pattern = re.compile(r'\b[A-Z]{1,5}-[A-Z0-9\-]{3,}\b')
    for candidate in pattern.findall(cleaned):
        if candidate not in names:
            names.append(candidate)
    return names

def humanize_linked_document_error(cleaned_message: str, raw_text: Optional[str]) -> str:
    if not cleaned_message:
        return cleaned_message
    normalized = cleaned_message.lower()
    if 'vinculado' not in normalized and 'linked' not in normalized:
        return cleaned_message
    docnames = extract_docnames_from_error(raw_text or cleaned_message)
    if len(docnames) >= 2:
        base_doc, related_doc = docnames[0], docnames[1]
        return f"No se puede cancelar el documento '{base_doc}' porque está vinculado con '{related_doc}'. Cancelá o revertí el documento relacionado antes de continuar."
    if len(docnames) == 1:
        return f"No se puede cancelar este documento porque está vinculado con '{docnames[0]}'. Cancelá o revertí el documento relacionado antes de continuar."
    return cleaned_message

def humanize_generic_error_message(message: str, error_detail: Optional[Dict[str, Any]] = None) -> str:
    cleaned_message = clean_html_message(message)
    raw_sources = []
    if isinstance(message, str):
        raw_sources.append(message)
    if isinstance(error_detail, dict):
        if error_detail.get('exception'):
            raw_sources.append(error_detail['exception'])
        if error_detail.get('_server_messages'):
            try:
                raw_sources.append(json.dumps(error_detail['_server_messages']))
            except Exception:
                raw_sources.append(str(error_detail.get('_server_messages')))
    for raw in raw_sources:
        improved = humanize_linked_document_error(cleaned_message, raw)
        if improved != cleaned_message:
            return improved
    return cleaned_message or "Error inesperado en ERPNext"

def make_erpnext_request(
    session: requests.Session,
    method: str,
    endpoint: str,
    data: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, Any]] = None,
    custom_headers: Optional[Dict[str, str]] = None,
    operation_name: str = "Operación ERPNext",
    _fiscal_retry: bool = False,
    send_as_form: bool = False
) -> Tuple[Optional[requests.Response], Optional[Dict[str, Any]]]:
    """
    Función centralizada para hacer peticiones HTTP a ERPNext

    Args:
        session: Sesión de requests con autenticación
        method: Método HTTP (GET, POST, PUT, DELETE)
        endpoint: Endpoint de ERPNext (ej: '/api/resource/Company/TestCompany')
        data: Datos JSON para POST/PUT
        params: Parámetros de query string
        custom_headers: Headers adicionales
        operation_name: Nombre descriptivo de la operación para logs

    Returns:
        Tuple de (response, error_response)
        - response: Objeto Response si exitoso, None si error
        - error_response: Dict con error si falló, None si exitoso
    """

    # Preparar headers base
    erp_host = ERPNEXT_HOST if ERPNEXT_HOST else ERPNEXT_URL.split('//')[1].split(':')[0]
    headers = {
        "Host": erp_host,
        "Accept": "application/json"
    }
    if send_as_form:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    else:
        headers["Content-Type"] = "application/json"
    if custom_headers:
        headers.update(custom_headers)

    try:
        # Determinar si debemos suprimir completamente los logs para esta operación
        def should_suppress_logging(op_name: str) -> bool:
            if not op_name:
                return False
            low = op_name.lower()
            # Suprimir logs completamente para operaciones de notificaciones y datos recientes
            return (
                "check if notification" in low
                or "get recent data" in low
                or "notification log" in low
                or "data import log" in low
            )

        suppress_logs = should_suppress_logging(operation_name)

        # Helper de logging seguro (no imprime si suppress_logs=True)
        def _log(*args, **kwargs):
            if not suppress_logs:
                print(*args, **kwargs)

        # LOG: Avisamos que estamos por contactar a ERPNext
        
        # LOG detallado: Mostrar datos enviados y parámetros (no mostrar headers por ruido/privacidad)
        if is_detailed_logging_enabled(operation_name):
            # Evitar imprimir headers completos (contienen cookies/metadata innecesaria)
            # Mostrar solo payloads y parámetros relevantes
            if data and method in ['POST', 'PUT']:
                print(f"📤 Datos JSON enviados: {json.dumps(data, indent=2)}")
            if params:
                print(f"📤 Parámetros de query: {params}")

        # Construir URL completa
        url = f"{ERPNEXT_URL}{endpoint}"

        # Preparar kwargs para la petición
        request_kwargs = {
            'headers': headers
        }

        if params:
            request_kwargs['params'] = params

        if data and method in ['POST', 'PUT']:
            if send_as_form:
                request_kwargs['data'] = data
            else:
                request_kwargs['json'] = data

        # Hacer la petición según el método
        if method.upper() == 'GET':
            response = session.get(url, **request_kwargs, timeout=60)  # 60 segundos timeout
        elif method.upper() == 'POST':
            response = session.post(url, **request_kwargs, timeout=120)  # 2 minutos para POST (crear email account)
        elif method.upper() == 'PUT':
            response = session.put(url, **request_kwargs, timeout=120)  # 2 minutos para PUT
        elif method.upper() == 'DELETE':
            response = session.delete(url, **request_kwargs, timeout=60)  # 60 segundos para DELETE
        else:
            return None, {
                "success": False,
                "message": f"Método HTTP no soportado: {method}",
                "status_code": 400
            }
        # LOG: Mostramos el código de estado de la respuesta de ERPNext
        _log(f"📡 Respuesta de ERPNext: {response.status_code}")

        # LOG detallado: Mostrar contenido de respuesta solo si está habilitado (no imprimir headers)
        if is_detailed_logging_enabled(operation_name):
            # Evitar mostrar headers de respuesta por ruido/privacidad
            try:
                response_text = response.text
                if len(response_text) > 1000:
                    _log(f"📥 Respuesta (truncada): {response_text[:1000]}...")
                else:
                    _log(f"📥 Respuesta completa: {response_text}")
            except:
                _log("📥 No se pudo leer el contenido de la respuesta")

        # Si la respuesta no es exitosa, devolver error
        if response.status_code >= 400:
            error_msg = f"Error HTTP {response.status_code}"
            error_detail: Dict[str, Any] = {}
            try:
                error_detail = response.json()
                if is_detailed_logging_enabled(operation_name):
                    _log(f"📋 Detalles del error JSON: {json.dumps(error_detail, indent=2)}")
                if isinstance(error_detail, dict):
                    if 'message' in error_detail:
                        error_msg = error_detail['message']
                        # Si el message trae HTML (<a>...) o escapes, limpiarlo y extraer item/kit
                        try:
                            raw_msg = clean_html_message(error_msg)

                            # Attempt to extract names: look for product-bundle and item urls or segments ending with '- MS'
                            item_name = None
                            kit_name = None
                            m_item = re.search(r'/app/item/([^"\'>\s]+)', error_msg)
                            if m_item:
                                item_name = unquote(m_item.group(1)).replace('%20', ' ')
                            m_kit = re.search(r'/app/product-bundle/([^"\'>\s]+)', error_msg)
                            if m_kit:
                                kit_name = unquote(m_kit.group(1)).replace('%20', ' ')

                            if not item_name or not kit_name:
                                # Find segments that likely contain names (e.g., 'MT-16 / W5 (TALLE M) - MS')
                                seg_pattern = re.compile(r'([A-Za-z0-9\-\s/\(\)%]{5,120}?\s*-\s*MS)', re.IGNORECASE)
                                segs = [s.strip() for s in seg_pattern.findall(raw_msg) if len(s.strip()) > 6]
                                if not item_name and len(segs) >= 1:
                                    item_name = segs[0]
                                if not kit_name and len(segs) >= 2:
                                    kit_name = segs[1]

                            # Normalize
                            if item_name:
                                item_name = re.sub(r'\s+', ' ', item_name).strip()
                            if kit_name:
                                kit_name = re.sub(r'\s+', ' ', kit_name).strip()

                            if item_name and kit_name:
                                error_msg = f"No se puede eliminar o cancelar porque el producto '{item_name}' está vinculado con el kit '{kit_name}'."
                            elif item_name:
                                error_msg = f"No se puede eliminar o cancelar porque el producto '{item_name}' está vinculado con un kit."
                            else:
                                # fallback to cleaned raw message
                                error_msg = raw_msg
                        except Exception:
                            # keep original message on failure
                            pass
                    elif '_server_messages' in error_detail:
                        error_msg = "Error del servidor ERPNext"
                        # Intentar decodificar _server_messages
                        try:
                            import base64
                            server_messages = error_detail.get('_server_messages', [])
                            if server_messages:
                                    decoded_messages = []
                                    # server_messages puede venir como lista codificada en base64,
                                    # o como string JSON con contenidos escapados/HTML. Intentamos varias estrategias.

                                    # Si server_messages es lista, intentar decodificar cada elemento
                                    if isinstance(server_messages, (list, tuple)):
                                        for msg in server_messages:
                                            try:
                                                # Intentar base64 decode -> json -> message
                                                decoded = base64.b64decode(msg).decode('utf-8')
                                                try:
                                                    parsed = json.loads(decoded)
                                                    if isinstance(parsed, dict) and 'message' in parsed:
                                                        decoded_messages.append(clean_html_message(parsed.get('message', '')))
                                                    else:
                                                        decoded_messages.append(clean_html_message(decoded))
                                                except Exception:
                                                    decoded_messages.append(clean_html_message(decoded))
                                            except Exception:
                                                # No base64: limpiar HTML/escapes
                                                decoded_messages.append(clean_html_message(str(msg)))
                                    else:
                                        # Si viene como string, intentar parsearlo como JSON, luego como escapes
                                        raw = server_messages
                                        try:
                                            # Primer intento: si es JSON string
                                                parsed = json.loads(raw)
                                                if isinstance(parsed, list):
                                                    for p in parsed:
                                                        if isinstance(p, dict) and 'message' in p:
                                                            decoded_messages.append(clean_html_message(p.get('message', '')))
                                                        else:
                                                            decoded_messages.append(clean_html_message(str(p)))
                                                elif isinstance(parsed, dict) and 'message' in parsed:
                                                    decoded_messages.append(clean_html_message(parsed.get('message', '')))
                                                else:
                                                    decoded_messages.append(clean_html_message(str(parsed)))
                                        except Exception:
                                                # Intentar des-escape de unicode y comillas
                                                try:
                                                    unescaped = bytes(raw, 'utf-8').decode('unicode_escape')
                                                    try:
                                                        parsed2 = json.loads(unescaped)
                                                        if isinstance(parsed2, list):
                                                            for p in parsed2:
                                                                if isinstance(p, dict) and 'message' in p:
                                                                    decoded_messages.append(clean_html_message(p.get('message', '')))
                                                                else:
                                                                    decoded_messages.append(clean_html_message(str(p)))
                                                        elif isinstance(parsed2, dict) and 'message' in parsed2:
                                                            decoded_messages.append(clean_html_message(parsed2.get('message', '')))
                                                        else:
                                                            decoded_messages.append(clean_html_message(unescaped))
                                                    except Exception:
                                                        # Fallback: tratar como texto con HTML
                                                        decoded_messages.append(clean_html_message(raw))
                                                except Exception:
                                                    decoded_messages.append(clean_html_message(raw))

                                    if decoded_messages:
                                        # Construir texto combinado y luego intentar extraer nombres de item y kit
                                        combined = ' '.join([m for m in decoded_messages if m]).strip()

                                        # Intentar extraer nombres desde URLs (product-bundle/ y item/)
                                        try:
                                            item_name = None
                                            kit_name = None

                                            # Buscar item URL
                                            m_item = re.search(r'/app/item/([^"\'>\s]+)', combined)
                                            if m_item:
                                                item_name = unquote(m_item.group(1))
                                                # reemplazar separadores codificados
                                                item_name = item_name.replace('%20', ' ')

                                            # Buscar kit URL
                                            m_kit = re.search(r'/app/product-bundle/([^"\'>\s]+)', combined)
                                            if m_kit:
                                                kit_name = unquote(m_kit.group(1))
                                                kit_name = kit_name.replace('%20', ' ')

                                            # Si no encontramos por URL, intentar extraer por patrones de texto
                                            if not item_name or not kit_name:
                                                # Intent: buscar prefijos tipo 'MT-16' y expandir hasta '- MS'
                                                code_prefix_match = re.search(r"[A-Za-z]{1,5}-\d{1,4}", combined)
                                                segs = []
                                                if code_prefix_match:
                                                    start_idx = code_prefix_match.start()
                                                    # Buscar hasta 120 chars alrededor para capturar nombre completo
                                                    window_start = max(0, start_idx - 40)
                                                    window = combined[window_start: window_start + 160]
                                                    # Buscar la primera ocurrencia de '- MS' dentro de la ventana
                                                    m_ms = re.search(r"-\s*MS", window, re.IGNORECASE)
                                                    if m_ms:
                                                        # expand from code_prefix_match relative to window
                                                        rel_start = code_prefix_match.start() - window_start
                                                        candidate = window[rel_start: m_ms.end()]
                                                        segs.append(candidate.strip())

                                                # Si no encontramos con el prefijo, intentar buscar directamente segmentos cortos que terminen en '- MS'
                                                if not segs:
                                                    seg_pattern = re.compile(r'([A-Za-z0-9\-\s/\(\)%]{5,80}?\s*-\s*MS)', re.IGNORECASE)
                                                    segs = [s.strip() for s in seg_pattern.findall(combined) if len(s.strip()) > 6]

                                                if not item_name and len(segs) >= 1:
                                                    item_name = segs[0]
                                                if not kit_name and len(segs) >= 2:
                                                    kit_name = segs[1]

                                            # Normalizar espacios
                                            def norm(s):
                                                return re.sub(r'\s+', ' ', s).strip() if s else s
                                            item_name = norm(item_name) if item_name else None
                                            kit_name = norm(kit_name) if kit_name else None

                                            # Construir mensaje final más humano
                                            if item_name and kit_name:
                                                error_msg = f"No se puede eliminar o cancelar porque el producto '{item_name}' está vinculado con el kit '{kit_name}'."
                                            elif item_name:
                                                error_msg = f"No se puede eliminar o cancelar porque el producto '{item_name}' está vinculado con un kit."
                                            else:
                                                error_msg = combined

                                            # Si hay mensajes adicionales (por ejemplo sugerencia de desactivar), anexarlos si no duplican
                                            # Buscar una sugerencia en decoded_messages
                                            for m in decoded_messages:
                                                if 'desactivar' in m.lower() and m not in error_msg:
                                                    error_msg = f"{error_msg} {m}"
                                                    break
                                        except Exception:
                                            # Fallback: usar el texto combinado tal cual
                                            error_msg = ' '.join([m for m in decoded_messages if m])

                                    _log(f"📋 Mensajes del servidor decodificados: {decoded_messages}")
                        except:
                            pass
            except Exception as json_error:
                if is_detailed_logging_enabled(operation_name):
                    _log(f"📋 No se pudo parsear respuesta JSON: {json_error}")
                    # Mostrar respuesta raw si no es JSON
                    _log(f"📋 Respuesta raw: {response.text[:500]}...")

            error_msg = humanize_generic_error_message(error_msg, error_detail)

            _log(f"❌ {operation_name} falló: {error_msg}")

            # Detectar error de Product Bundle (Kit) vinculado
            try:
                exception_text = error_detail.get('exception') or ''
                
                # Buscar patrón de error de Product Bundle
                # Ejemplo: "No se puede eliminar o cancelar porque Producto <a href="...">MT-16 / W5 (TALLE M) - MS</a> está vinculado con Conjunto / paquete de productos <a href="...">MT-16 / W5 (TALLE L) - MS"
                if 'Product Bundle' in error_msg or 'paquete de productos' in error_msg or 'Conjunto' in error_msg:
                    # Intentar extraer el nombre del kit del mensaje
                    kit_name_match = re.search(r'product-bundle/([^"\']+)', exception_text)
                    if not kit_name_match:
                        # Intentar extraer del texto después de "Conjunto / paquete de productos"
                        kit_name_match = re.search(r'paquete de productos\s*<a[^>]*>([^<]+)</a>', exception_text)
                    
                    if kit_name_match:
                        kit_name = kit_name_match.group(1).strip()
                        # URL decode si es necesario
                        kit_name = unquote(kit_name)
                        
                        # Construir mensaje amigable
                        error_msg = f"No se puede eliminar este item porque está vinculado al kit '{kit_name}'. Por favor, elimine primero el kit antes de eliminar este item."
                        _log(f"⚠️ Item vinculado a kit: {kit_name}")
            except Exception as bundle_detect_error:
                # Si falla la detección, continuar con el mensaje original
                _log(f"⚠️ Error detectando Product Bundle: {bundle_detect_error}")

            # Detectar error de Fiscal Year y realizar recuperación automática
            try:
                exc_type = error_detail.get('exc_type') or ''
                exception_text = error_detail.get('exception') or ''
                server_messages = error_detail.get('_server_messages')

                fiscal_error_detected = False
                if 'FiscalYearError' in str(exc_type) or 'FiscalYearError' in str(exception_text):
                    fiscal_error_detected = True
                # _server_messages puede venir como JSON-string o lista codificada
                if not fiscal_error_detected and server_messages:
                    try:
                        # If it's a JSON string containing messages, search for the typical message
                        if isinstance(server_messages, str) and 'FiscalYearError' in server_messages:
                            fiscal_error_detected = True
                    except:
                        pass

                if fiscal_error_detected and not _fiscal_retry:
                    # Intentar recuperación automática: crear/obtener Fiscal Year y reintentar la petición una vez
                    try:
                        import re
                        company_name = None
                        # Buscar <strong>Company Name</strong> en el exception text
                        m = re.search(r"<strong>([^<]+?)</strong>", exception_text or '')
                        if m:
                            company_name = m.group(1)
                        else:
                            # Intentar buscar 'de <company>' en texto español
                            m2 = re.search(r"de\s+([A-Za-z0-9\s\.,'-]+)\.?", exception_text or '')
                            if m2:
                                company_name = m2.group(1).strip()

                        if company_name:
                            _log(f"⚙️ FiscalYearError detectado para compañía '{company_name}', intentando crear Fiscal Year y reintentar...")
                            # Importar funciones localmente para evitar circular imports
                            from routes.companies import get_or_create_fiscal_year, assign_fiscal_year_to_company

                            # Intentar obtener el mes de cierre desde el Fiscal Year existente
                            mes_cierre = '12'
                            try:
                                # Primero, intentar obtener desde la compañía
                                comp_resp, comp_err = make_erpnext_request(
                                    session=session,
                                    method="GET",
                                    endpoint=f"/api/resource/Company/{quote(company_name)}",
                                    operation_name=f"Get company data for '{company_name}'",
                                    _fiscal_retry=True
                                )
                                if comp_resp and comp_resp.status_code == 200:
                                    comp_data = comp_resp.json().get('data', {})
                                    mes_cierre = comp_data.get('custom_mes_cierre') or mes_cierre
                                
                                # Si no está configurado, derivarlo del Fiscal Year existente
                                if mes_cierre == '12':
                                    # Importar funciones localmente
                                    from routes.companies import get_fiscal_year_for_company
                                    existing_fy = get_fiscal_year_for_company(session, headers, company_name)
                                    if existing_fy and existing_fy.get('year_end_date'):
                                        # Extraer el mes de la fecha de fin (formato: YYYY-MM-DD)
                                        end_date = existing_fy['year_end_date']
                                        end_month = end_date.split('-')[1]  # Obtener MM
                                        mes_cierre = end_month
                                        _log(f"📅 Mes de cierre derivado del Fiscal Year existente: {mes_cierre}")
                                    else:
                                        _log(f"📅 Mes de cierre por defecto (no configurado): {mes_cierre}")
                                else:
                                    _log(f"📅 Mes de cierre obtenido de la compañía: {mes_cierre}")
                            except Exception as e:
                                _log(f"⚠️ Error obteniendo mes de cierre: {e}")
                                mes_cierre = '12'

                            # Crear o recuperar Fiscal Year
                            fy_name = get_or_create_fiscal_year(session, headers, company_name, mes_cierre)
                            if fy_name:
                                assigned = assign_fiscal_year_to_company(session, headers, company_name, fy_name)
                                _log(f"⚙️ Fiscal Year '{fy_name}' creado/asignado: {assigned}")
                                # Reintentar la petición original una vez
                                _log(f"🔁 Reintentando operación '{operation_name}' después de crear Fiscal Year")
                                return make_erpnext_request(
                                    session=session,
                                    method=method,
                                    endpoint=endpoint,
                                    data=data,
                                    params=params,
                                    custom_headers=custom_headers,
                                    operation_name=operation_name,
                                    _fiscal_retry=True
                                )
                            else:
                                _log("⚠️ No se pudo crear/obtener Fiscal Year automáticamente")
                    except Exception as recovery_exc:
                        _log(f"⚠️ Error durante la recuperación automática de Fiscal Year: {recovery_exc}")
            except Exception:
                # Si falla la detección, continuar con el manejo de error normal
                pass

            return None, {
                "success": False,
                "message": error_msg,
                "status_code": response.status_code,
                "response_body": response.text
            }

        # Respuesta exitosa
        _log(f"✅ {operation_name} completada exitosamente")
        return response, None

    except requests.exceptions.HTTPError as err:
        # LOG: Capturamos y mostramos el error HTTP en detalle
        _log(f"❌ Error HTTP en {operation_name}: {err.response.status_code}")

        if is_detailed_logging_enabled(operation_name):
            # No imprimir headers de error (ruido). Mostrar contenido y JSON si está disponible.
            try:
                error_content = err.response.text
                _log(f"📋 Contenido del error: {error_content[:1000]}{'...' if len(error_content) > 1000 else ''}")

                error_detail = err.response.json()
                _log(f"📋 Detalles del error JSON: {json.dumps(error_detail, indent=2)}")
            except:
                _log(f"📋 Respuesta raw del error: {err.response.text[:500]}...")

        error_msg = "Error del servidor ERPNext"
        error_detail: Dict[str, Any] = {}
        try:
            error_detail = err.response.json()
            if 'message' in error_detail:
                error_msg = error_detail['message']
        except:
            pass

        error_msg = humanize_generic_error_message(error_msg, error_detail)

        return None, {
            "success": False,
            "message": error_msg,
            "status_code": err.response.status_code,
            "response_body": err.response.text
        }

    except requests.exceptions.RequestException as e:
        # LOG: Capturamos y mostramos cualquier otro error de conexión
        _log(f"❌ Error de conexión en {operation_name}: {e}")
        return None, {
            "success": False,
            "message": f"Error de conexión con ERPNext: {str(e)}",
            "status_code": 500
        }

def handle_erpnext_error(error_response: Dict[str, Any], default_message: str = "Error en operación ERPNext") -> Tuple[Dict[str, Any], int]:
    """
    Función helper para manejar errores de ERPNext de manera consistente

    Args:
        error_response: Dict con información del error
        default_message: Mensaje por defecto

    Returns:
        Tuple de (json_response, status_code)
    """
    status_code = error_response.get('status_code', 500)
    message = error_response.get('message', default_message)

    # Manejo específico para errores de Fiscal Year
    if "Fiscal Year" in message or "Año Fiscal" in message:
        message = "Vaya al módulo de contabilidad para habilitar el año Fiscal para poder entrar la transacción"

    # Mapeo de códigos de estado comunes
    if status_code == 401:
        if message == default_message:
            message = "Sesión expirada o credenciales inválidas"
    elif status_code == 403:
        if message == default_message:
            message = "No tienes permisos para realizar esta operación"
    elif status_code == 404:
        if message == default_message:
            message = "Recurso no encontrado"
    elif status_code == 409:
        if message == default_message:
            message = "Conflicto - el recurso ya existe"
    elif status_code == 417:
        if message == default_message:
            message = "Error de expectativa - posible problema con headers o formato de datos. Verifica los logs detallados."
    elif status_code == 422:
        if message == default_message:
            message = "Datos inválidos - verifica la información enviada"
    elif status_code >= 500:
        if message == default_message:
            message = "Error interno del servidor ERPNext"

    # Si el mensaje contiene HTML o URLs típicas de ERPNext, limpiarlo y extraer información útil
    try:
        raw = message
        if isinstance(raw, str) and ('<a' in raw.lower() or '/app/product-bundle/' in raw or '/app/item/' in raw or '%20' in raw):
            cleaned_raw = clean_html_message(raw)

            # Try to extract item and kit names
            item_name = None
            kit_name = None
            m_item = re.search(r"/app/item/([^\"'>\s]+)", raw)
            if m_item:
                item_name = unquote(m_item.group(1)).replace('%20', ' ')
            m_kit = re.search(r"/app/product-bundle/([^\"'>\s]+)", raw)
            if m_kit:
                kit_name = unquote(m_kit.group(1)).replace('%20', ' ')

            if not item_name or not kit_name:
                seg_pattern = re.compile(r'([A-Za-z0-9\-\s/\(\)%]{5,120}?\s*-\s*MS)', re.IGNORECASE)
                segs = [s.strip() for s in seg_pattern.findall(cleaned_raw) if len(s.strip()) > 6]
                if not item_name and len(segs) >= 1:
                    item_name = segs[0]
                if not kit_name and len(segs) >= 2:
                    kit_name = segs[1]

            if item_name:
                item_name = re.sub(r'\s+', ' ', item_name).strip()
            if kit_name:
                kit_name = re.sub(r'\s+', ' ', kit_name).strip()

            if item_name and kit_name:
                message = f"No se puede eliminar o cancelar porque el producto '{item_name}' está vinculado con el kit '{kit_name}'."
            elif item_name:
                message = f"No se puede eliminar o cancelar porque el producto '{item_name}' está vinculado con un kit."
            else:
                message = cleaned_raw
    except Exception:
        pass

    message = humanize_generic_error_message(message, error_response)
    json_response = jsonify({"success": False, "message": message})
    return json_response, status_code
