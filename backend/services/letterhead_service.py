import base64
import json
import re
from io import BytesIO
from urllib.parse import quote

from config import ERPNEXT_URL
from utils.http_utils import make_erpnext_request

PLACEHOLDER_LOGO_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y2ZxXwAAAAASUVORK5CYII="
)
INLINE_SUFFIX = " (Inline)"


def build_file_url(file_path):
    if not file_path:
        return None
    if isinstance(file_path, str) and file_path.startswith(('http://', 'https://')):
        return file_path
    base = (ERPNEXT_URL or '').rstrip('/')
    if not base:
        return file_path
    normalized = file_path if file_path.startswith('/') else f"/{file_path}"
    return f"{base}{normalized}"


def enrich_letterhead_doc(doc):
    if not isinstance(doc, dict):
        return doc
    doc['absolute_image_url'] = build_file_url(doc.get('image'))
    doc['absolute_footer_image_url'] = build_file_url(doc.get('footer_image'))
    return doc


def _slugify(value):
    value = (value or "").strip()
    if not value:
        return "logo"
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"[-\s]+", "-", value)
    value = value.strip("-")
    return value or "logo"


def build_embedded_logo_src(session, file_path):
    """
    Descarga el logo desde ERPNext y devuelve un data URI para evitar dependencias de red en wkhtmltopdf.
    """
    if not session or not file_path:
        return None

    absolute_url = build_file_url(file_path)
    if not absolute_url:
        return None

    try:
        response = session.get(absolute_url, timeout=30)
        if response.status_code != 200:
            print(f"[LetterheadService] No se pudo descargar el logo ({response.status_code}) desde {absolute_url}")
            return None
        content_type = response.headers.get('Content-Type') or 'application/octet-stream'
        encoded = base64.b64encode(response.content).decode('ascii')
        return f"data:{content_type};base64,{encoded}"
    except Exception as exc:
        print(f"[LetterheadService] Error embedding logo {absolute_url}: {exc}")
        return None


def upload_file_to_erpnext(session, headers, filename, file_obj, content_type="application/octet-stream", is_private="0",
                           folder="Home"):
    upload_headers = {k: v for k, v in (headers or {}).items() if k and k.lower() != 'content-type'}
    files = {
        'file': (filename, file_obj, content_type),
        'is_private': (None, str(is_private)),
        'folder': (None, folder)
    }
    response = session.post(f"{ERPNEXT_URL}/api/method/upload_file", files=files, headers=upload_headers, timeout=120)
    if response.status_code not in (200, 201):
        return None, {
            'success': False,
            'status_code': response.status_code,
            'message': response.text
        }
    payload = response.json().get('message', {})
    payload['absolute_file_url'] = build_file_url(payload.get('file_url'))
    return payload, None


def _build_logo_markup(resolved_logo_url, safe_company):
    if not resolved_logo_url:
        return f"<strong style='font-size:20px;color:#111;'>{safe_company}</strong>"

    if resolved_logo_url.startswith("data:"):
        return (
            "<div style=\"height:60px;display:block;background-repeat:no-repeat;"
            "background-position:left center;background-size:contain;"
            f"background-image:url('{resolved_logo_url}');\"></div>"
        )

    return (
        f"<img src='{resolved_logo_url}' alt='{safe_company} Logo' "
        "style='height:60px; object-fit:contain; display:block;' />"
    )


def build_default_header_html(company_name, logo_url=None, raw_logo_src=None):
    safe_company = company_name or "Tu Empresa"
    resolved_logo_url = raw_logo_src or build_file_url(logo_url)

    logo_markup = _build_logo_markup(resolved_logo_url, safe_company)

    return (
        "<div style='padding:10px 0;border-bottom:2px solid #111;'>"
        "  <div style='display:flex;align-items:center;justify-content:space-between;gap:24px;'>"
        f"    <div style='flex:1;min-width:140px;'>{logo_markup}</div>"
        f"    <div style='text-align:right;font-size:12px;color:#4b5563;'>"
        f"      <p style='margin:0;font-weight:600;color:#111;'>{safe_company}</p>"
        f"      <p style='margin:0;'>Comprobantes generados con ERPNext</p>"
        "    </div>"
        "  </div>"
        "</div>"
    )


def build_default_footer_html(company_name):
    safe_company = company_name or "Tu Empresa"
    return (
        "<div style='text-align:center;font-size:10px;color:#6b7280;"
        "             border-top:1px solid #e5e7eb;padding:8px 0;margin-top:16px;'>"
        f"  <p style='margin:0;'>{safe_company} · Documentos electrónicos</p>"
        "  <p style='margin:0;'>Emitido automáticamente — No requiere firma manuscrita</p>"
        "</div>"
    )


def fetch_letterhead(session, company_name=None):
    params = {
        'limit_page_length': 20,
        'order_by': 'is_default desc, modified desc'
    }

    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint="/api/resource/Letter Head",
        params=params,
        operation_name="Fetch letter head list"
    )
    if error:
        return None, error

    entries = response.json().get('data', []) if response and response.status_code == 200 else []
    names = [entry.get('name') for entry in entries if entry.get('name')]

    if not names:
        return None, None

    cache = {}

    def load_detail(doc_name):
        if doc_name in cache:
            return cache[doc_name], None
        detail_resp, detail_err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Letter Head/{quote(doc_name)}",
            operation_name=f"Fetch letter head detail {doc_name}"
        )
        if detail_err:
            return None, detail_err
        if detail_resp and detail_resp.status_code == 200:
            data = detail_resp.json().get('data')
            cache[doc_name] = data
            return data, None
        return None, None


    # Fall back to the first available letterhead
    detail, detail_error = load_detail(names[0])
    if detail_error:
        return None, detail_error
    return enrich_letterhead_doc(detail), None


def upsert_letterhead(session, company_name, payload, existing_name=None):
    payload = {
        **payload,
        "company": company_name,
        "disabled": payload.get('disabled', 0),
        "is_default": payload.get('is_default', 1),
    }

    if payload.get('source', 'HTML') == 'HTML':
        payload.setdefault('content', payload.get('header', ''))

    if existing_name:
        endpoint = f"/api/resource/Letter Head/{quote(existing_name)}"
        method = "PUT"
    else:
        endpoint = "/api/resource/Letter Head"
        method = "POST"

    response, error = make_erpnext_request(
        session=session,
        method=method,
        endpoint=endpoint,
        data={"data": payload},
        operation_name=f"{'Update' if existing_name else 'Create'} Letter Head"
    )
    return response, error


def ensure_default_letterhead(session, headers, company_name):
    if not company_name:
        return None, {
            'success': False,
            'status_code': 400,
            'message': 'No se pudo determinar la compañía activa'
        }

    existing, error = fetch_letterhead(session, company_name)
    if error:
        return None, error
    if existing:
        return existing, None

    placeholder_bytes = base64.b64decode(PLACEHOLDER_LOGO_BASE64)
    filename = f"{_slugify(company_name)}-default-logo.png"
    file_buffer = BytesIO(placeholder_bytes)
    upload_data, upload_error = upload_file_to_erpnext(
        session=session,
        headers=headers,
        filename=filename,
        file_obj=file_buffer,
        content_type="image/png",
        is_private="0",
        folder="Home"
    )
    if upload_error:
        return None, upload_error

    logo_url = upload_data.get('file_url')
    header_html = build_default_header_html(company_name, logo_url)
    footer_html = build_default_footer_html(company_name)
    payload = {
        "letter_head_name": f"{company_name} Letterhead",
        "source": "HTML",
        "header": header_html,
        "footer": footer_html,
        "image": logo_url
    }

    response, error = upsert_letterhead(session, company_name, payload, existing_name=None)
    if error:
        return None, error

    if response is not None and response.status_code in (200, 201):
        data = response.json().get('data')
        if data:
            return enrich_letterhead_doc(data), None

    # fallback: fetch again
    refreshed, refresh_error = fetch_letterhead(session, company_name)
    if refreshed:
        return enrich_letterhead_doc(refreshed), None
    if refresh_error:
        return None, refresh_error
    return enrich_letterhead_doc(payload), None


def get_inline_letterhead_name(base_name):
    if not base_name:
        return None
    if base_name.endswith(INLINE_SUFFIX):
        return base_name
    return f"{base_name}{INLINE_SUFFIX}"


def fetch_letterhead_by_name(session, doc_name):
    if not doc_name:
        return None, None
    response, error = make_erpnext_request(
        session=session,
        method="GET",
        endpoint=f"/api/resource/Letter Head/{quote(doc_name)}",
        operation_name=f"Fetch letter head by name {doc_name}"
    )
    if error:
        if error.get('status_code') == 404:
            return None, None
        return None, error
    if response and response.status_code == 200:
        data = response.json().get('data')
        if data:
            return enrich_letterhead_doc(data), None
    return None, None


def _build_embedded_header_html(session, company_name, header_html, logo_url):
    raw_logo_src = build_embedded_logo_src(session, logo_url)
    if not raw_logo_src:
        return header_html

    if header_html:
        img_pattern = re.compile(r'<img\b[^>]*>', re.IGNORECASE)
        match = img_pattern.search(header_html)
        if match:
            logo_markup = _build_logo_markup(raw_logo_src, company_name or "Tu Empresa")
            return header_html[:match.start()] + logo_markup + header_html[match.end():]

    return build_default_header_html(company_name, logo_url, raw_logo_src=raw_logo_src)


def ensure_inline_letterhead_doc(session, company_name, base_doc):
    if not session or not company_name or not base_doc:
        return None, None

    base_name = base_doc.get('letter_head_name') or base_doc.get('name')
    if not base_name:
        return None, {'message': 'Letterhead base sin nombre'}

    inline_name = get_inline_letterhead_name(base_name)
    header_html = base_doc.get('header') or base_doc.get('content')
    embedded_header = _build_embedded_header_html(session, company_name, header_html, base_doc.get('image'))

    inline_payload = {
        'letter_head_name': inline_name,
        'source': 'HTML',
        'header': embedded_header or header_html or build_default_header_html(company_name, base_doc.get('image')),
        'footer': base_doc.get('footer') or build_default_footer_html(company_name),
        'image': base_doc.get('image'),
        'is_default': 0,
        'disabled': 0
    }
    inline_payload['content'] = inline_payload['header']

    existing_inline, fetch_error = fetch_letterhead_by_name(session, inline_name)
    if fetch_error:
        return None, fetch_error
    existing_name = inline_name if existing_inline else None

    response, error = upsert_letterhead(
        session=session,
        company_name=company_name,
        payload=inline_payload,
        existing_name=existing_name
    )
    if error:
        return None, error
    return inline_name, None
