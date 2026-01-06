from flask import Blueprint, request, jsonify
import os
import json
from urllib.parse import quote

from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar funciones de companies.py para evitar duplicación
from routes.companies import load_active_companies

# Importar funciones de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar módulos AFIP especializados
from routes.Configuracion.setup_afip_utils import check_doctype_exists, check_record_exists, check_custom_field_exists
from routes.Configuracion.setup_afip_custom_fields import create_custom_fields_internal
from routes.Configuracion.setup_afip_comprobante_types import load_afip_comprobante_types, create_afip_records, clear_afip_comprobante_types
from routes.Configuracion.setup_afip_doctypes import create_afip_doctypes
from routes.Configuracion.setup_banks import create_banks, list_banks, initialize_banks
from routes.Configuracion.setup_letras_disponibles import clear_letras_disponibles
from routes.Configuracion.setup_naming_series import create_naming_series
from routes.Configuracion.setup_initialize_afip import initialize_afip_setup

# Crear el blueprint para las rutas de configuración avanzada (talonarios, etc.)
setup2_bp = Blueprint('setup2', __name__)

# Constantes AFIP (movidas a módulos especializados)

@setup2_bp.route('/api/setup2/create-custom-fields', methods=['POST'])
def create_custom_fields():
    """Crear campos personalizados para Condición IVA en Cliente y Compañía"""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    result = create_custom_fields_internal(session, headers)
    return jsonify(result)
    return jsonify(result)


@setup2_bp.route('/api/setup2/load-afip-comprobante-types', methods=['POST'])
def load_afip_comprobante_types_route():
    """Cargar tipos de comprobante AFIP desde archivo"""
    return load_afip_comprobante_types()

@setup2_bp.route('/api/setup2/create-afip-doctypes', methods=['POST'])
def create_afip_doctypes_route():
    """Crear DocTypes para Tipo Comprobante AFIP y Talonario"""
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response

    return create_afip_doctypes(session, headers, ERPNEXT_URL, user_id=user_id)

@setup2_bp.route('/api/setup2/create-afip-records', methods=['POST'])
def create_afip_records_route():
    """Crear registros de ejemplo para Tipo Comprobante AFIP"""
    return create_afip_records()


@setup2_bp.route('/api/setup2/clear-afip-comprobante-types', methods=['DELETE'])
def clear_afip_comprobante_types_route():
    """Limpiar tipos de comprobante AFIP"""
    return clear_afip_comprobante_types()





@setup2_bp.route('/api/setup2/clear-letras-disponibles', methods=['DELETE'])
def clear_letras_disponibles_route():
    """Limpiar letras disponibles"""
    return clear_letras_disponibles()


@setup2_bp.route('/api/setup2/create-naming-series', methods=['POST'])
def create_naming_series_route():
    """Crear series de numeración"""
    return create_naming_series()


@setup2_bp.route('/api/setup2/initialize-afip-setup', methods=['POST'])
def initialize_afip_setup_route():
    """Inicializar configuración completa de AFIP"""
    return initialize_afip_setup()


@setup2_bp.route('/api/setup2/create-banks', methods=['POST'])
def create_banks_route():
    """Crear bancos"""
    return create_banks()


@setup2_bp.route('/api/setup2/list-banks', methods=['GET'])
def list_banks_route():
    """Listar bancos"""
    return list_banks()


@setup2_bp.route('/api/setup2/initialize-banks', methods=['POST'])
def initialize_banks_route():
    """Inicializar bancos"""
    return initialize_banks()
