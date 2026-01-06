import re
from urllib.parse import quote, urljoin, urlparse

from flask import Blueprint, request, jsonify, make_response
from werkzeug.utils import secure_filename

from routes.auth_utils import get_session_with_auth
from routes.general import get_active_company
from utils.http_utils import make_erpnext_request
from services.letterhead_service import (
    build_default_footer_html,
    build_default_header_html,
    ensure_default_letterhead,
    fetch_letterhead,
    upload_file_to_erpnext,
    upsert_letterhead,
    enrich_letterhead_doc,
    ensure_inline_letterhead_doc
)
from config import ERPNEXT_URL

document_formats_bp = Blueprint('document_formats', __name__)

DOWNLOAD_ENDPOINT = "/api/method/frappe.utils.print_format.download_pdf"


def analyze_printview_images(session, doc_type, doc_name, format_name, no_letterhead, letterhead=None):
    if not ERPNEXT_URL:
        return {}
    try:
        base = ERPNEXT_URL.rstrip('/')
        query = [
            f"doctype={quote(doc_type)}",
            f"name={quote(doc_name)}",
            f"format={quote(format_name)}",
            f"no_letterhead={quote(str(no_letterhead))}"
        ]
        if letterhead:
            query.append(f"letterhead={quote(letterhead)}")
        preview_url = f"{base}/printview?{'&'.join(query)}"
        response = session.get(preview_url, timeout=60)
        if response.status_code != 200:
            print(f"[DocumentFormats] Could not fetch printview HTML ({response.status_code}) for {doc_type}:{doc_name}")
            return {}
        html = response.text
        img_pattern = re.compile(r'<img[^>]+src=[\"\'](.*?)[\"\']', re.IGNORECASE)
        css_url_pattern = re.compile(r'url\((?!data:)(?!cid:)[\'"]?(.*?)[\'"]?\)', re.IGNORECASE)
        matches = img_pattern.findall(html)
        matches += css_url_pattern.findall(html)
        relative_sources = []
        inaccessible_sources = []
        inspected_sources = []

        def resolve_url(src_value):
            if not src_value:
                return None
            if src_value.lower().startswith(('http://', 'https://', 'data:', 'cid:')):
                return src_value
            if src_value.startswith('//'):
                parsed_base = urlparse(base)
                scheme = parsed_base.scheme or 'http'
                return f"{scheme}:{src_value}"
            if src_value.startswith('/'):
                return f"{base}{src_value}"
            return urljoin(base + '/', src_value)

        for src in matches:
            if not src:
                continue
            lowered = src.lower()
            if lowered.startswith(('data:', 'cid:')):
                continue

            is_relative = True
            if lowered.startswith(('http://', 'https://')):
                is_relative = False
            elif src.startswith('file:'):
                relative_sources.append(src)
                continue
            elif src.startswith('//'):
                is_relative = False

            if is_relative:
                relative_sources.append(src)

            resolved = resolve_url(src)
            if not resolved:
                continue

            inspected_entry = {
                'src': src,
                'resolved_url': resolved
            }
            try:
                img_resp = session.get(resolved, timeout=15)
                inspected_entry['status_code'] = img_resp.status_code
                if img_resp.status_code != 200:
                    inaccessible_sources.append({
                        'src': src,
                        'resolved_url': resolved,
                        'status_code': img_resp.status_code
                    })
            except Exception as img_exc:
                inaccessible_sources.append({
                    'src': src,
                    'resolved_url': resolved,
                    'error': str(img_exc)
                })
                inspected_entry['error'] = str(img_exc)
            inspected_sources.append(inspected_entry)

        if relative_sources:
            print(f"[DocumentFormats] Relative image sources detected for {doc_type}:{doc_name} -> {relative_sources}")
        if inaccessible_sources:
            print(f"[DocumentFormats] Inaccessible images for {doc_type}:{doc_name} -> {inaccessible_sources}")
        return {
            'relative_sources': relative_sources,
            'inaccessible_sources': inaccessible_sources,
            'inspected_sources': inspected_sources
        }
    except Exception as exc:
        print(f"[DocumentFormats] Failed to analyze printview HTML for {doc_type}:{doc_name}: {exc}")
        return {}


@document_formats_bp.route('/api/document-formats/<path:doc_type>/pdf/<path:doc_name>', methods=['GET', 'OPTIONS'])
def download_document_pdf(doc_type, doc_name):
    """
    Proxy para descargar PDFs de ERPNext usando el print format configurado.
    Maneja las cookies de sesi�n y resuelve CORS para el frontend.
    """
    if request.method == 'OPTIONS':
        # Responder OK para los preflight y evitar que el navegador bloquee la petici�n
        return '', 200

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    format_name = request.args.get('format') or request.args.get('print_format') or 'Standard'
    no_letterhead = request.args.get('no_letterhead', '0')
    filename = request.args.get('filename') or f"{doc_name}.pdf"
    company_name = get_active_company(user_id)

    letterhead_param = None
    if str(no_letterhead) == '0' and company_name:
        base_letterhead, base_error = fetch_letterhead(session, company_name)
        if base_error:
            print(f"[DocumentFormats] No se pudo obtener el letterhead base: {base_error}")
        elif base_letterhead:
            inline_name, inline_error = ensure_inline_letterhead_doc(session, company_name, base_letterhead)
            if inline_error:
                print(f"[DocumentFormats] No se pudo asegurar el letterhead embebido: {inline_error}")
            else:
                letterhead_param = inline_name

    request_params = {
        'doctype': doc_type,
        'name': doc_name,
        'format': format_name,
        'no_letterhead': no_letterhead
    }
    if letterhead_param:
        request_params['letterhead'] = letterhead_param

    response, error = make_erpnext_request(
        session=session,
        method='GET',
        endpoint=DOWNLOAD_ENDPOINT,
        params=request_params,
        custom_headers={'Accept': 'application/pdf'},
        operation_name=f'Download PDF {doc_type}:{doc_name}'
    )

    if error:
        message = error.get('message') or 'No se pudo generar el PDF'
        details = {k: v for k, v in error.items() if k not in ('message',)}
        diagnostics = analyze_printview_images(
            session,
            doc_type,
            doc_name,
            format_name,
            no_letterhead,
            letterhead_param
        )
        if diagnostics:
            details['image_diagnostics'] = diagnostics
        return jsonify({
            'success': False,
            'message': message,
            'details': details
        }), error.get('status_code', 500)

    flask_response = make_response(response.content)
    flask_response.headers.set('Content-Type', 'application/pdf')
    flask_response.headers.set('Content-Disposition', f'attachment; filename="{filename}"')
    return flask_response


@document_formats_bp.route('/api/document-formats/logo', methods=['POST'])
def upload_letterhead_logo():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No se adjuntó ningún archivo'}), 400

    file = request.files.get('file')
    if not file or file.filename == '':
        return jsonify({'success': False, 'message': 'El archivo es vacío'}), 400

    allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'}
    filename = secure_filename(file.filename)
    extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

    if extension not in allowed_extensions:
        return jsonify({'success': False, 'message': 'Formato de imagen no soportado'}), 400

    try:
        file.stream.seek(0)
        upload_data, upload_error = upload_file_to_erpnext(
            session=session,
            headers=headers,
            filename=filename,
            file_obj=file.stream,
            content_type=file.content_type or 'application/octet-stream',
            is_private=request.form.get('is_private', '0'),
            folder=request.form.get('folder', 'Home')
        )

        if upload_error:
            return jsonify({
                'success': False,
                'message': upload_error.get('message', 'Error subiendo el logo')
            }), upload_error.get('status_code', 500)

        return jsonify({
            'success': True,
            'message': 'Logo subido correctamente',
            'data': upload_data
        })
    except Exception as exc:
        print(f"[DocumentFormats] Error uploading logo: {exc}")
        return jsonify({'success': False, 'message': str(exc)}), 500


@document_formats_bp.route('/api/document-formats/letterhead', methods=['GET'])
def get_letterhead():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    company_name = get_active_company(user_id)
    letterhead_doc, error = fetch_letterhead(session, company_name)

    if error:
        return jsonify({
            'success': False,
            'message': error.get('message', 'No se pudo obtener el letter head')
        }), error.get('status_code', 500)

    if not letterhead_doc:
        letterhead_doc, create_error = ensure_default_letterhead(session, headers, company_name)
        if create_error:
            return jsonify({
                'success': False,
                'message': create_error.get('message', 'No se pudo crear el letter head por defecto')
            }), create_error.get('status_code', 500)
    else:
        letterhead_doc = enrich_letterhead_doc(letterhead_doc)

    return jsonify({
        'success': True,
        'data': letterhead_doc,
        'company': company_name
    })


@document_formats_bp.route('/api/document-formats/letterhead', methods=['POST'])
def save_letterhead():
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    payload = request.get_json(silent=True) or {}
    company_name = get_active_company(user_id)
    if not company_name:
        return jsonify({'success': False, 'message': 'No hay compañía activa para el usuario'}), 400

    source = (payload.get('source') or 'HTML').upper()
    header_html = payload.get('header')
    footer_html = payload.get('footer')
    logo_url = payload.get('image') or payload.get('logo')

    if source == 'IMAGE':
        header_html = build_default_header_html(company_name, logo_url)
        source = 'HTML'
    elif not header_html:
        header_html = build_default_header_html(company_name, logo_url)
    if not footer_html:
        footer_html = build_default_footer_html(company_name)

    letterhead_payload = {
        'letter_head_name': payload.get('letter_head_name') or f"{company_name} Letterhead",
        'source': source,
        'header': header_html,
        'footer': footer_html,
        'image': logo_url,
        'is_default': 1 if payload.get('is_default', True) else 0,
        'disabled': 0
    }

    existing_name = payload.get('name')
    if not existing_name:
        existing_doc, _ = fetch_letterhead(session, company_name)
        if existing_doc:
            existing_name = existing_doc.get('name')

    response, error = upsert_letterhead(
        session=session,
        company_name=company_name,
        payload=letterhead_payload,
        existing_name=existing_name
    )

    if error:
        return jsonify({
            'success': False,
            'message': error.get('message', 'No se pudo guardar el letter head')
        }), error.get('status_code', 500)

    data = response.json().get('data') if response is not None else letterhead_payload
    enriched = enrich_letterhead_doc(data)
    inline_name, inline_error = ensure_inline_letterhead_doc(session, company_name, enriched)
    if inline_error:
        print(f"[DocumentFormats] No se pudo preparar el letterhead embebido: {inline_error}")
    return jsonify({
        'success': True,
        'message': 'Letter head actualizado',
        'data': enriched
    })
