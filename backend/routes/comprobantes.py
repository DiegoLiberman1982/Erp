from flask import Blueprint, request, jsonify
import requests
import json
import time
import copy
from urllib.parse import quote

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST
import os

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth
from routes.customer_utils import get_customer_tax_condition
from routes.general import get_company_abbr, resolve_customer_name

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error
from utils.comprobante_utils import get_sales_prefix

# Mapa de códigos AFIP a tipos base utilizados en los talonarios
# Load AFIP comprobante mapping from shared JSON so it's defined in a single place
# Strict: load AFIP comprobante mapping from shared JSON. Do NOT fallback silently.
shared_path = os.path.normpath(os.path.join(os.path.dirname(os.path.dirname(__file__)), '..', 'shared', 'afip_codes.json'))
if not os.path.exists(shared_path):
    raise RuntimeError(f"Required shared AFIP codes file not found at '{shared_path}'. Please add 'shared/afip_codes.json' to the repository.")

with open(shared_path, 'r', encoding='utf-8') as f:
    _AFIP_SHARED = json.load(f)
    comprobantes_map = _AFIP_SHARED.get('comprobantes', {})
    # Build a simple code -> tipo map (keys are zero-padded 3-digit strings)
    AFIP_DOC_TYPE_MAP = {str(code).zfill(3): str(info.get('tipo', '')).upper() for code, info in comprobantes_map.items()}


def map_afip_to_doc_type(codigo_afip):
    """
    Devuelve el tipo base (FAC/NDC/NDB/REC) asociado al código AFIP.

    Strict behavior:
    - If codigo_afip is falsy (None or empty), returns None so callers know it wasn't provided.
    - If codigo_afip is present but not found in the shared mapping, raises ValueError so the caller
      fails fast instead of silently assuming some default.
    """
    if codigo_afip is None or (isinstance(codigo_afip, str) and codigo_afip.strip() == ''):
        return None
    key = str(codigo_afip).zfill(3)
    tipo = AFIP_DOC_TYPE_MAP.get(key)
    if tipo is None or tipo == '':
        raise ValueError(f"Unknown AFIP code '{key}' — it's not present in shared/afip_codes.json")
    return tipo

# Crear el blueprint para las rutas de comprobantes
comprobantes_bp = Blueprint('comprobantes', __name__)

# Cache global para descripciones de tipos de comprobante AFIP
_afip_descriptions_cache = None

# Cache local para talonarios
_TALONARIO_CACHE_TTL = 60  # segundos
_default_talonario_cache = {}
_resguardo_talonario_cache = {}
_talonario_details_cache = {}

# Construir base_comprobantes desde tipos_comprobante y codigos_afip del JSON
# Solo incluimos FAC, NDB, NDC que son los tipos principales de facturación
_tipos_comprobante = _AFIP_SHARED.get('tipos_comprobante', [])
_codigos_afip = _AFIP_SHARED.get('codigos_afip', {})
_DEFAULT_BASE_COMPROBANTES = []
for tipo_info in _tipos_comprobante:
    tipo = tipo_info.get('tipo', '')
    descripcion = tipo_info.get('descripcion', '')
    # Solo incluir tipos que tienen códigos AFIP definidos y son de facturación principal
    if tipo in _codigos_afip and tipo in ['FAC', 'NDB', 'NDC']:
        # Usar el código AFIP de la letra A como referencia (el código base)
        codigo_afip_str = _codigos_afip[tipo].get('A', '')
        if codigo_afip_str:
            _DEFAULT_BASE_COMPROBANTES.append({
                "codigo_afip": int(codigo_afip_str),
                "descripcion": descripcion
            })


def _cache_get(cache, key):
    entry = cache.get(key)
    if not entry:
        return False, None
    if time.time() - entry["ts"] > _TALONARIO_CACHE_TTL:
        cache.pop(key, None)
        return False, None
    return True, entry["value"]


def _cache_set(cache, key, value):
    cache[key] = {"ts": time.time(), "value": value}

def parse_letters_field(letras_value):
    """
    Normalizar el contenido del campo letras_json (o similar) a una lista de letras únicas.
    """
    letters = []
    if isinstance(letras_value, list):
        letters = letras_value
    elif isinstance(letras_value, str):
        try:
            parsed = json.loads(letras_value)
            if isinstance(parsed, list):
                letters = parsed
        except Exception:
            # Soportar cadenas separadas por comas/espacios
            letters = [part.strip() for part in letras_value.replace('\n', ',').split(',')]
    cleaned = []
    for letra in letters:
        letra_norm = str(letra).strip().upper()
        if letra_norm and letra_norm not in cleaned:
            cleaned.append(letra_norm)
    return cleaned

def build_default_comprobantes(letras_list):
    """
    Generar combinaciones de comprobantes base por letra sin consultar el detalle del talonario.
    """
    if not letras_list:
        letras_list = ['A']
    comprobantes = []
    for base in _DEFAULT_BASE_COMPROBANTES:
        for letra in letras_list:
            comprobantes.append({
                "codigo_afip": base["codigo_afip"],
                "descripcion": f"{base['descripcion']} {letra}"
            })
    return comprobantes

def get_afip_descriptions_cached(session, headers):
    """
    Obtener todas las descripciones de tipos de comprobante AFIP con cache en memoria.
    Realiza una sola llamada a la API la primera vez y guarda los resultados en cache.
    """
    global _afip_descriptions_cache
    
    # Si el cache ya está poblado, devolverlo directamente
    if _afip_descriptions_cache is not None:
        return _afip_descriptions_cache
    
    try:
        print("--- Cache AFIP: cargando")
        
        # Realizar una única llamada a la API para obtener todos los tipos de comprobante AFIP
        afip_resp, afip_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Tipo Comprobante AFIP",
            params={
                "fields": '["name","descripcion"]',
                "limit_page_length": 100
            },
            operation_name="Get AFIP comprobante types cache"
        )

        if afip_error:
            print("--- Cache AFIP: error")
            # Fallback: devolver cache vacío
            _afip_descriptions_cache = {}
            return _afip_descriptions_cache

        if afip_resp.status_code != 200:
            print("--- Cache AFIP: error")
            # Fallback: devolver cache vacío
            _afip_descriptions_cache = {}
            return _afip_descriptions_cache

        afip_data = afip_resp.json()
        tipos_afip = afip_data.get('data', [])
        
        # Transformar la lista en un diccionario para acceso instantáneo
        # Clave: código (name), Valor: descripción
        _afip_descriptions_cache = {}
        for tipo in tipos_afip:
            codigo = tipo.get('name', '').strip()
            descripcion = tipo.get('descripcion', '').strip()
            if codigo:
                _afip_descriptions_cache[codigo] = descripcion
        
        print(f"--- Cache AFIP: {len(_afip_descriptions_cache)} registros")
        return _afip_descriptions_cache
        
    except Exception as e:
        print("--- Cache AFIP: error")
        # Fallback: devolver cache vacío
        _afip_descriptions_cache = {}
        return _afip_descriptions_cache

def determine_invoice_type(customer_condition):
    """
    Determinar el tipo de comprobante basado en la condición fiscal del cliente
    siguiendo las reglas de AFIP
    """
    tax_condition = customer_condition.get('tax_condition', '').upper()
    tax_id = customer_condition.get('tax_id', '')
    is_company = customer_condition.get('is_company', False)
    is_person = customer_condition.get('is_person', False)

    print("--- Tipo comprobante: ok")

    # Reglas según condición fiscal
    if tax_condition == 'RESPONSABLE INSCRIPTO':
        # Cliente Responsable Inscripto
        if is_company:
            # Empresa RI - solo A, M, E
            return ['A', 'M', 'E']
        elif is_person:
            # Persona humana RI - puede usar B para uso personal
            return ['A', 'B', 'M', 'E']
        else:
            # RI sin CUIT claro - asumir empresa
            return ['A', 'M', 'E']

    elif tax_condition == 'MONOTRIBUTISTA':
        # Monotributista - A por defecto, B si uso personal
        return ['A', 'B']

    elif tax_condition == 'EXENTO':
        # Exento de IVA - B por defecto
        return ['B']

    elif tax_condition in ['CONSUMIDOR FINAL', '']:
        # Consumidor final o sin condición definida - B por defecto
        return ['B']

    else:
        # Caso por defecto - B
        print("--- Tipo comprobante: ok")
        return ['B']


def simplify_comprobante_description(description):
    """
    Simplificar la descripción del comprobante eliminando la letra del final
    Ej: "Factura A" -> "Factura", "Nota de Débito B" -> "Nota de Débito"
    """
    # Lista de tipos base de comprobantes
    base_types = [
        'Factura',
        'Nota de Debito', 'Nota de Débito',
        'Nota de Credito', 'Nota de Crédito',
        'Recibo',
        'Nota de Venta al contado',
        'Factura de Crédito Electrónica MiPyMEs (FCE)'
    ]
    
    for base_type in base_types:
        if description.startswith(base_type):
            return base_type
    
    # Si no coincide con ningún tipo conocido, devolver la descripción original
    return description


def get_default_talonario(session, headers, company):
    """
    Obtener el talonario por defecto de la compañía
    """
    try:
        cached, cached_value = _cache_get(_default_talonario_cache, company)
        if cached:
            print(f"--- Talonario defecto: usando cache para compañía '{company}'")
            return cached_value

        print(f"--- Talonario defecto: buscando para compañía '{company}'")

        # Buscar talonarios de la compañía marcados como por defecto
        talonarios_resp, talonarios_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params={
                "fields": '["name","por_defecto","compania"]',
                "filters": '[["por_defecto","=","1"]]',
                "limit": 100
            },
            operation_name=f"Get default talonario for company {company}"
        )

        if talonarios_error:
            print(f"--- Talonario defecto: error {talonarios_error}")
            return None

        if talonarios_resp.status_code != 200:
            print(f"--- Talonario defecto: error HTTP {talonarios_resp.status_code}")
            return None

        talonarios = talonarios_resp.json().get('data', [])
        print(f"--- Talonario defecto: encontrados {len(talonarios)} talonarios marcados como defecto")
        
        # CORRECCIÓN AQUÍ: t.get('company') cambiado a t.get('compania')
        # Filtrar por compañía en Python
        company_talonarios = [t for t in talonarios if t.get('compania') == company]
        print(f"--- Talonario defecto: {len(company_talonarios)} para la compañía '{company}'")
        
        if company_talonarios:
            talonario_name = company_talonarios[0]['name']
            print(f"--- Talonario defecto: seleccionado '{talonario_name}'")
            _cache_set(_default_talonario_cache, company, talonario_name)
            return talonario_name
        else:
            print("--- Talonario defecto: ninguno encontrado para la compañía")
            _cache_set(_default_talonario_cache, company, None)
            return None

    except Exception as e:
        print(f"--- Talonario defecto: error {str(e)}")
        _cache_set(_default_talonario_cache, company, None)
        return None


def get_resguardo_talonarios(session, headers, company):
    """
    Obtener todos los talonarios de resguardo disponibles para la compañía
    """
    try:
        cached, cached_value = _cache_get(_resguardo_talonario_cache, company)
        if cached:
            print(f"--- Talonarios resguardo: usando cache para compañía '{company}'")
            return cached_value or []

        print(f"--- Talonarios resguardo: buscando para compañía '{company}'")

        # Buscar talonarios de resguardo de la compañía
        talonarios_resp, talonarios_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params={
                "fields": '["name","tipo_de_talonario","compania","letras"]',
                "filters": '[["tipo_de_talonario","=","TALONARIOS DE RESGUARDO"]]',
                "limit": 100
            },
            operation_name=f"Get resguardo talonarios for company {company}"
        )

        if talonarios_error:
            print(f"--- Talonarios resguardo: error {talonarios_error}")
            return []

        if talonarios_resp.status_code != 200:
            print(f"--- Talonarios resguardo: error HTTP {talonarios_resp.status_code}")
            return []

        talonarios = talonarios_resp.json().get('data', [])
        print(f"--- Talonarios resguardo: encontrados {len(talonarios)} talonarios de tipo 'TALONARIOS DE RESGUARDO'")
        
        # Filtrar por compañía
        resguardo_talonarios = []
        for talonario in talonarios:
            if talonario.get('compania') == company:
                resguardo_talonarios.append(talonario['name'])
                print(f"--- Talonarios resguardo: encontrado '{talonario['name']}' para compañía '{company}'")
        
        print(f"--- Talonarios resguardo: {len(resguardo_talonarios)} encontrados para la compañía")
        _cache_set(_resguardo_talonario_cache, company, resguardo_talonarios)
        return resguardo_talonarios

    except Exception as e:
        print(f"--- Talonarios resguardo: error {str(e)}")
        _cache_set(_resguardo_talonario_cache, company, [])
        return []

def fetch_company_talonarios_basic(session, headers, company):
    """
    Obtener los talonarios de la compañía con campos mínimos y las letras cacheadas.
    """
    try:
        allowed_types = [
            "FACTURA ELECTRONICA",
            "COMPROBANTES DE EXPORTACION ELECTRONICOS",
            "TALONARIOS DE RESGUARDO",
            "RECIBOS",
            "REMITOS",
            "REMITOS ELECTRONICOS"
        ]
        params = {
            "fields": json.dumps([
                "name",
                "compania",
                "por_defecto",
                "tipo_de_talonario",
                "punto_de_venta",
                "tipo_numeracion",
                "factura_electronica",
                "letras_json",
                "docstatus"
            ]),
            "filters": json.dumps([
                ["compania", "=", company],
                ["docstatus", "<", 2],
                ["tipo_de_talonario", "in", allowed_types]
            ]),
            "limit_page_length": 1000
        }
        resp, err = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params=params,
            operation_name=f"Get basic talonarios for {company}"
        )
        if err:
            print(f"--- Talonarios basicos: error {err}")
            return []
        if resp.status_code != 200:
            print(f"--- Talonarios basicos: error HTTP {resp.status_code}")
            return []
        talonarios = resp.json().get('data', []) or []
        for tal in talonarios:
            # Prefer the canonical 'letras_json' field returned by the Talonario API
            letters = parse_letters_field(tal.get('letras_json'))
            tal["_letras_list"] = letters
        return talonarios
    except Exception as e:
        print(f"--- Talonarios basicos: error {str(e)}")
        return []

def get_talonario_comprobantes(session, headers, talonario_name):
    """
    Obtener los tipos de comprobante disponibles en un talonario
    """
    try:
        cached, cached_value = _cache_get(_talonario_details_cache, talonario_name)
        if cached:
            print(f"--- Tipos comprobante talonario: cache hit para {talonario_name}")
            return copy.deepcopy(cached_value) if cached_value is not None else None

        print("--- Tipos comprobante talonario: procesando")

        # Obtener el talonario con sus child tables
        talonario_resp, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Talonario/{quote(talonario_name)}",
            operation_name=f"Get talonario details for {talonario_name}"
        )

        if talonario_error:
            print("--- Tipos comprobante talonario: error")
            return None

        if talonario_resp.status_code != 200:
            print("--- Tipos comprobante talonario: error")
            return None

        talonario_data = talonario_resp.json()['data']

        # Obtener punto de venta
        punto_de_venta = talonario_data.get('punto_de_venta', '')

        # Obtener tipo de numeración
        tipo_numeracion = talonario_data.get('tipo_numeracion', 'Manual')

        # Obtener último número utilizado
        ultimo_numero = talonario_data.get('ultimo_numero_utilizado', 0)

        # Obtener tipos de comprobante del child table
        tipos_comprobante = talonario_data.get('tipo_de_comprobante_afip', [])

        comprobantes_list = []
        
        # Obtener el cache de descripciones AFIP (una sola vez)
        descriptions_cache = get_afip_descriptions_cached(session, headers)
        
        for comp in tipos_comprobante:
            tipo_afip = comp.get('codigo_afip')  # Campo correcto: 'codigo_afip'
            if tipo_afip is not None:
                # Convertir a string de 3 dígitos con padding cero
                tipo_afip_str = str(tipo_afip).zfill(3)

                # Obtener la descripción del cache (sin llamada a API)
                descripcion = descriptions_cache.get(tipo_afip_str, f'Comprobante AFIP {tipo_afip_str}')
                
                comprobantes_list.append({
                    'codigo_afip': tipo_afip_str,  # Guardar como string de 3 dígitos
                    'descripcion': descripcion
                })

        # Obtener letras disponibles
        letras = talonario_data.get('letras', [])
        letras_list = [letra.get('letra') for letra in letras if letra.get('letra')]
        print(f"--- Letras talonario: {len(letras_list)} registros")

        # Mapear últimos números para uso rápido en el frontend
        last_numbers_map = {}
        for ultimo in talonario_data.get('ultimos_numeros', []):
            tipo_doc = ultimo.get('tipo_documento')
            letra_doc = ultimo.get('letra')
            if tipo_doc and letra_doc:
                key = f"{tipo_doc}-{letra_doc}"
                last_numbers_map[key] = ultimo.get('ultimo_numero_utilizado', 0)

        result = {
            'punto_de_venta': punto_de_venta,
            'tipo_numeracion': tipo_numeracion,
            'ultimo_numero': ultimo_numero,
            'comprobantes': comprobantes_list,
            'letras': letras_list,
            'last_numbers_map': last_numbers_map
        }
        print("--- Tipos comprobante talonario: ok")
        _cache_set(_talonario_details_cache, talonario_name, copy.deepcopy(result))
        return result

    except Exception as e:
        print("--- Tipos comprobante talonario: error")
        import traceback
        traceback.print_exc()
        _cache_set(_talonario_details_cache, talonario_name, None)
        return None


def get_next_confirmed_number_for_talonario(session, headers, talonario_name, letra, tipo_comprobante=None, exclude_name=None):
    """
    Obtener el próximo número disponible para facturas confirmadas de un talonario específico
    tipo_comprobante: código AFIP del tipo de comprobante (001, 002, etc.)
    exclude_name: nombre del documento a excluir de la búsqueda (útil al editar)
    """
    try:
        
        # Si no se especifica tipo_comprobante, asumir factura por defecto
        if not tipo_comprobante:
            search_doc_type = 'FAC'
        else:
            # This will raise a ValueError if the AFIP code is unknown — fail fast
            search_doc_type = map_afip_to_doc_type(tipo_comprobante)
        
        # Obtener el talonario para construir el prefijo del método de numeración
        talonario_resp, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint=f"/api/resource/Talonario/{quote(talonario_name)}",
            operation_name=f"Get talonario for numbering {talonario_name}"
        )

        if talonario_error:
            print("--- Próximo número confirmado: error")
            return 1

        if talonario_resp.status_code != 200:
            print("--- Próximo número confirmado: error")
            return 1

        talonario_data = talonario_resp.json()['data']
        
        # Construir el prefijo del método de numeración
        punto_venta = talonario_data.get('punto_de_venta', '00001')
        factura_electronica = talonario_data.get('factura_electronica', True)
        
        prefix = get_sales_prefix(bool(factura_electronica))
        punto_venta_formatted = str(punto_venta).zfill(5)
        
        # Construir el patrón de búsqueda: FE-NDC-A-00003-% (para notas de crédito)
        search_pattern = f"{prefix}-{search_doc_type}-{letra}-{punto_venta_formatted}-%"
        
        # Buscar documentos confirmados (docstatus=1) con este patrón, excluyendo borradores y documento específico si se indica
        filters = [
            ["name","like",search_pattern],
            ["docstatus","=",1],
            ["name","not like","%BORR-%"]
        ]
        
        # Excluir documento específico si se proporciona
        if exclude_name:
            filters.append(["name","!=",exclude_name])
        
        search_resp, search_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Sales Invoice",
            params={
                "filters": json.dumps(filters),
                "fields": '["name"]',
                "order_by": "name desc",
                "limit": 10
            },
            operation_name=f"Get confirmed numbers for talonario {talonario_name}"
        )
        
        next_number = 1  # Por defecto empezar en 1
        if search_error:
            print("--- Próximo número confirmado: error")
        elif search_resp.status_code == 200:
            search_data = search_resp.json()
            documentos_count = len(search_data.get('data', []))
            
            if search_data.get('data') and documentos_count > 0:
                
                last_confirmed_name = search_data['data'][0]['name']
                
                # Extraer el número del final
                try:
                    parts = last_confirmed_name.split('-')
                    if len(parts) >= 5:
                        last_part = parts[-1]  # Ej: "0000000100001"
                        
                        # Tomar los PRIMEROS 8 dígitos (no los últimos)
                        if len(last_part) >= 8:
                            last_number_str = last_part[:8]  # Primeros 8 dígitos
                        else:
                            last_number_str = last_part  # Si es menor a 8, usar todo
                        
                        if last_number_str.isdigit():
                            last_number = int(last_number_str)
                            next_number = last_number + 1
                except (IndexError, ValueError) as e:
                    pass
        else:
            print("--- Próximo número confirmado: error")
        
        return next_number
        
    except Exception as e:
        print("--- Próximo número confirmado: error")
        import traceback
        traceback.print_exc()
        return 1

def generate_talonario_options(session, headers, talonario_info, letras_filtradas, exclude_name, is_resguardo=False, comprobantes_override=None):
    """
    Generar opciones de comprobante para un talonario específico
    """
    punto_de_venta = talonario_info['punto_de_venta']
    tipo_numeracion = talonario_info['tipo_numeracion']
    comprobantes_disponibles = comprobantes_override if comprobantes_override is not None else talonario_info['comprobantes']
    talonario_name = talonario_info.get('talonario_name')
    last_numbers_map = talonario_info.get('last_numbers_map', {})
    
    options = []
    
    # Simplificar descripciones de comprobantes para este talonario
    comprobantes_simplificados = []
    for comprobante in comprobantes_disponibles:
        descripcion_simplificada = simplify_comprobante_description(comprobante['descripcion'])
        comprobantes_simplificados.append({
            'codigo_afip': comprobante['codigo_afip'],
            'descripcion': descripcion_simplificada,
            'descripcion_completa': comprobante['descripcion']
        })
    
    for comprobante in comprobantes_simplificados:
        for letra in letras_filtradas:
            # Verificar si esta combinación letra + tipo existe en el talonario
            descripcion_completa_buscada = f"{comprobante['descripcion']} {letra}"
            
            # Buscar si existe esta combinación en los comprobantes del talonario
            combinacion_valida = any(
                comp['descripcion'] == descripcion_completa_buscada 
                for comp in comprobantes_disponibles
            )
            
            if combinacion_valida or is_resguardo:  # Para resguardo, permitir aunque no haya combinación exacta
                doc_type = map_afip_to_doc_type(comprobante['codigo_afip'])
                cache_key = f"{doc_type}-{letra}"
                ultimo_registrado = last_numbers_map.get(cache_key)
                proximo_numero = (ultimo_registrado + 1) if isinstance(ultimo_registrado, (int, float)) else None
                
                options.append({
                    'tipo_comprobante': comprobante['codigo_afip'],
                    'letra': letra,
                    'descripcion': comprobante['descripcion'],
                    'descripcion_completa': descripcion_completa_buscada,
                    'punto_de_venta': punto_de_venta,
                    'proximo_numero': proximo_numero,
                    'numeracion_automatica': tipo_numeracion == 'Automática',
                    'talonario': talonario_name,
                    'is_resguardo': is_resguardo
                })
    
    return options


@comprobantes_bp.route('/api/comprobantes/determine-options', methods=['POST'])
def determine_comprobante_options():
    """
    Determinar las opciones de comprobante disponibles para un cliente específico
    """
    print("\n--- Determinando opciones de comprobante ---")

    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    data = request.get_json()
    print(f"--- Request data: {data}")
    customer = data.get('customer')
    company = data.get('company')
    exclude_name = data.get('exclude_name')

    # Handle customer as object or string
    if isinstance(customer, dict):
        customer_name = customer.get('name')
    else:
        customer_name = customer

    if not customer_name or not company:
        return jsonify({
            "success": False,
            "message": "Se requieren customer y company"
        }), 400

    try:
        # 1. Obtener condición fiscal del cliente
        customer_condition = get_customer_tax_condition(session, headers, customer_name, company_name=company)
        if not customer_condition:
            return jsonify({
                "success": False,
                "message": "No se pudo obtener la condición fiscal del cliente"
            }), 400

        # 2. Determinar tipos de comprobante válidos
        valid_types = determine_invoice_type(customer_condition)
        print(f"--- Tipos válidos para condición '{customer_condition}': {valid_types}")

        # 3. Obtener talonarios disponibles con las letras cacheadas
        talonarios_basicos = fetch_company_talonarios_basic(session, headers, company)
        print(f"--- Talonarios básicos encontrados: {len(talonarios_basicos)}")
        for t in talonarios_basicos:
            print(f"    - {t.get('name')}: tipo={t.get('tipo_de_talonario')}, letras={t.get('_letras_list')}, docstatus={t.get('docstatus')}, letras_json={t.get('letras_json')}")
        
        talonarios_filtrados = [
            t for t in talonarios_basicos
            if t.get("_letras_list") and t.get("docstatus", 0) in (0, 1)
        ]
        print(f"--- Talonarios filtrados (con letras): {len(talonarios_filtrados)}")

        if not talonarios_filtrados:
            print("--- No hay talonarios disponibles con letras configuradas")
            return jsonify({
                "success": False,
                "message": "No se encontraron talonarios disponibles para la compañía"
            }), 400

        # 4. Procesar talonarios disponibles (sin pedir detalle uno por uno)
        all_options = []
        talonarios_info = {}

        for talonario in talonarios_filtrados:
            talonario_name = talonario.get('name')
            if not talonario_name:
                continue

            talonario_type = talonario.get('tipo_de_talonario', '')
            letras_disponibles = talonario.get('_letras_list', [])
            is_resguardo = talonario_type == 'TALONARIOS DE RESGUARDO'

            # Para resguardo usar todas las letras, para el resto filtrar por la condición fiscal del cliente
            letras_filtradas = letras_disponibles if is_resguardo else [letra for letra in letras_disponibles if letra in valid_types]
            print(f"    - Talonario {talonario_name}: letras_disponibles={letras_disponibles}, letras_filtradas={letras_filtradas}, is_resguardo={is_resguardo}")
            if not letras_filtradas:
                print(f"      -> Sin letras filtradas, saltando")
                continue

            comprobantes_generados = build_default_comprobantes(letras_filtradas)
            print(f"      -> Comprobantes generados: {len(comprobantes_generados)}")
            talonario_info = {
                'talonario_name': talonario_name,
                'punto_de_venta': talonario.get('punto_de_venta', ''),
                'tipo_numeracion': talonario.get('tipo_numeracion', 'Manual'),
                'comprobantes': comprobantes_generados,
                'letras': letras_disponibles,
                'last_numbers_map': {}
            }
            talonarios_info[talonario_name] = talonario_info

            talonario_options = generate_talonario_options(
                session,
                headers,
                talonario_info,
                letras_filtradas,
                exclude_name,
                is_resguardo=is_resguardo,
                comprobantes_override=comprobantes_generados
            )
            print(f"      -> Opciones generadas: {len(talonario_options)}")
            all_options.extend(talonario_options)

        print(f"--- Total opciones generadas: {len(all_options)}")
        if not all_options:
            return jsonify({
                "success": False,
                "message": f"No hay opciones de comprobante disponibles para la compañía. Configure un talonario por defecto o talonarios de resguardo."
            }), 400


        # Determine default/resguardo talonarios to pick a primary talonario for response
        default_talonario = get_default_talonario(session, headers, company)
        resguardo_talonarios = get_resguardo_talonarios(session, headers, company)

        # 6. Preparar respuesta
        # Usar información del talonario por defecto para datos generales, o del primer resguardo si no hay defecto
        # Prefer explicitly configured default talonario; otherwise pick a resguardo if available, otherwise first available talonario
        if default_talonario:
            primary_talonario = default_talonario
        elif resguardo_talonarios:
            primary_talonario = resguardo_talonarios[0]
        else:
            primary_talonario = next(iter(talonarios_info.keys()))
        primary_info = talonarios_info[primary_talonario]
        
        # Simplificar descripciones de comprobantes (de todos los talonarios)
        all_comprobantes = []
        for talonario_info in talonarios_info.values():
            all_comprobantes.extend(talonario_info['comprobantes'])
        
        comprobantes_simplificados = []
        tipos_unicos = set()
        for comprobante in all_comprobantes:
            descripcion_simplificada = simplify_comprobante_description(comprobante['descripcion'])
            if descripcion_simplificada not in tipos_unicos:
                tipos_unicos.add(descripcion_simplificada)
                comprobantes_simplificados.append({
                    'codigo_afip': comprobante['codigo_afip'],
                    'descripcion': descripcion_simplificada,
                    'descripcion_completa': comprobante['descripcion']
                })
        
        available_comprobantes = sorted([comp['descripcion'] for comp in comprobantes_simplificados])

        print(f"--- Opciones comprobante: {len(all_options)} registros")

        return jsonify({
            "success": True,
            "data": {
                "customer_condition": customer_condition,
                "valid_types": valid_types,
                "available_letters": list(set([opt['letra'] for opt in all_options])),  # Todas las letras disponibles
                "available_comprobantes": available_comprobantes,
                "talonario": primary_talonario,
                "punto_de_venta": primary_info['punto_de_venta'],
                "tipo_numeracion": primary_info['tipo_numeracion'],
                "options": all_options
            }
        })

    except Exception as e:
        print("--- Opciones comprobante: error")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "message": "Error interno del servidor"
        }), 500

@comprobantes_bp.route('/api/comprobantes/next-confirmed-number', methods=['POST'])
def get_next_confirmed_number_endpoint():
    """
    Endpoint para obtener el próximo número confirmado de un talonario específico
    """
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    try:
        data = request.get_json()
        talonario_name = data.get('talonario_name')
        letra = data.get('letra', 'A')
        tipo_comprobante = data.get('tipo_comprobante')  # Opcional
        exclude_name = data.get('exclude_name')  # Opcional: nombre del documento a excluir
        
        if not talonario_name:
            return jsonify({
                "success": False,
                "message": "Nombre del talonario requerido"
            }), 400
        
        next_number = get_next_confirmed_number_for_talonario(session, headers, talonario_name, letra, tipo_comprobante, exclude_name)
        
        return jsonify({
            "success": True,
            "data": {
                "next_confirmed_number": next_number,
                "talonario": talonario_name,
                "letra": letra
            }
        })
        
    except Exception as e:
        print("--- Próximo número confirmado endpoint: error")
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500
