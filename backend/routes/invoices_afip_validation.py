from flask import Blueprint, request, jsonify
from urllib.parse import quote
import json

# Importar configuración
from config import ERPNEXT_URL

# Importar función de autenticación centralizada
from routes.auth_utils import get_session_with_auth

# Importar utilidades HTTP centralizadas
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Crear el blueprint
invoices_afip_validation_bp = Blueprint('invoices_afip_validation', __name__)


def validate_talonarios_for_afip_import(session, headers, invoices_data, company):
    """
    Valida que existan los talonarios necesarios para importar facturas AFIP.
    
    Args:
        session: Sesión autenticada
        headers: Headers de autenticación
        invoices_data: Lista de facturas parseadas del CSV
        company: Compañía activa
    
    Returns:
        dict: {
            "valid": bool,
            "talonarios": dict,  # Cache de talonarios por punto_venta-tipo_comprobante
            "errors": list,
            "missing_talonarios": list
        }
    """
    print(f"--- Validando talonarios para {len(invoices_data)} facturas AFIP")
    
    # Agrupar facturas por punto de venta y tipo de comprobante
    unique_combinations = {}
    for invoice in invoices_data:
        punto_venta = str(invoice.get('punto_venta', '')).strip()
        tipo_comprobante = str(invoice.get('tipo_comprobante', '')).strip()
        
        if not punto_venta or not tipo_comprobante:
            continue
            
        key = f"{punto_venta}-{tipo_comprobante}"
        if key not in unique_combinations:
            unique_combinations[key] = {
                'punto_venta': punto_venta,
                'tipo_comprobante': tipo_comprobante,
                'count': 0
            }
        unique_combinations[key]['count'] += 1
    
    print(f"--- Combinaciones únicas encontradas: {len(unique_combinations)}")
    
    # Validar cada combinación
    talonarios_cache = {}
    errors = []
    missing_talonarios = []
    
    for key, combo in unique_combinations.items():
        punto_venta = combo['punto_venta']
        tipo_comprobante = combo['tipo_comprobante']
        
        # Normalizar punto de venta a formato de 5 dígitos con padding de ceros
        punto_venta_padded = str(punto_venta).zfill(5)
        
        print(f"--- Validando: Punto de Venta {punto_venta} (normalizado: {punto_venta_padded}), Tipo Comprobante {tipo_comprobante}")
        
        # Buscar talonario con estos criterios
        filters = [
            ["compania", "=", company],
            ["punto_de_venta", "=", punto_venta_padded],
            ["tipo_de_talonario", "=", "FACTURA ELECTRONICA"],
            ["docstatus", "!=", 2]  # Excluir cancelados
        ]
        
        talonario_resp, talonario_error = make_erpnext_request(
            session=session,
            method="GET",
            endpoint="/api/resource/Talonario",
            params={
                "filters": json.dumps(filters),
                "fields": json.dumps([
                    "name", 
                    "punto_de_venta", 
                    "tipo_de_talonario",
                    "tipo_de_comprobante_afip"
                ]),
                "limit_page_length": 10
            },
            operation_name=f"Find talonario for PV {punto_venta}"
        )
        
        if talonario_error:
            errors.append(f"Error buscando talonario para PV {punto_venta}: {talonario_error}")
            continue
        
        if talonario_resp.status_code != 200:
            errors.append(f"Error buscando talonario para PV {punto_venta}: {talonario_resp.status_code}")
            continue
        
        talonarios = talonario_resp.json().get('data', [])
        
        if not talonarios:
            missing_talonarios.append({
                'punto_venta': punto_venta,
                'tipo_comprobante': tipo_comprobante,
                'tipo_talonario': 'FACTURA ELECTRONICA',
                'count': combo['count'],
                'message': f'No existe talonario electrónico para el punto de venta {punto_venta}'
            })
            print(f"--- NO ENCONTRADO: Talonario para PV {punto_venta}")
            continue
        
        # Validar que el talonario tenga el tipo de comprobante AFIP correcto
        talonario_found = None
        for talonario in talonarios:
            talonario_name = talonario.get('name')
            
            # Obtener detalle del talonario para verificar tipos de comprobante
            detail_resp, detail_error = make_erpnext_request(
                session=session,
                method="GET",
                endpoint=f"/api/resource/Talonario/{quote(talonario_name)}",
                operation_name=f"Get talonario details '{talonario_name}'"
            )
            
            if detail_error or detail_resp.status_code != 200:
                continue
            
            talonario_detail = detail_resp.json().get('data', {})
            tipos_comprobante_afip = talonario_detail.get('tipo_de_comprobante_afip', [])
            
            # Verificar si el tipo de comprobante está en la lista
            has_tipo_comprobante = False
            for tipo in tipos_comprobante_afip:
                # codigo_afip viene como int en ERPNext, tipo_comprobante viene como string del CSV
                codigo_afip = str(tipo.get('codigo_afip', '')).strip()
                tipo_comprobante_str = str(tipo_comprobante).strip()
                
                if codigo_afip == tipo_comprobante_str:
                    has_tipo_comprobante = True
                    break
            
            if has_tipo_comprobante:
                talonario_found = talonario_detail
                print(f"--- ENCONTRADO: {talonario_name} para PV {punto_venta}, Tipo {tipo_comprobante}")
                break
        
        if talonario_found:
            # Cachear el talonario
            talonarios_cache[key] = talonario_found
        else:
            missing_talonarios.append({
                'punto_venta': punto_venta,
                'tipo_comprobante': tipo_comprobante,
                'tipo_talonario': 'FACTURA ELECTRONICA',
                'count': combo['count'],
                'message': f'Existe talonario para PV {punto_venta}, pero no incluye el tipo de comprobante AFIP {tipo_comprobante}'
            })
            print(f"--- TIPO COMPROBANTE NO ENCONTRADO: {tipo_comprobante} en talonarios de PV {punto_venta}")
    
    # Resultado de la validación
    is_valid = len(missing_talonarios) == 0 and len(errors) == 0
    
    return {
        'valid': is_valid,
        'talonarios': talonarios_cache,
        'errors': errors,
        'missing_talonarios': missing_talonarios
    }


@invoices_afip_validation_bp.route('/api/invoices/afip/validate-talonarios', methods=['POST'])
def validate_talonarios():
    """
    Endpoint para validar que existan los talonarios necesarios antes de importar facturas AFIP.
    
    Request body:
    {
        "invoices": [...],  // Lista de facturas parseadas del CSV
        "company": "Nombre de la compañía"
    }
    
    Response:
    {
        "success": true/false,
        "valid": true/false,
        "talonarios_count": int,
        "missing_talonarios": [...],
        "errors": [...]
    }
    """
    print("--- Validando talonarios para importación AFIP")
    
    session, headers, user_id, error_response = get_session_with_auth()
    if error_response:
        return error_response
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                "success": False,
                "message": "Datos requeridos"
            }), 400
        
        invoices_data = data.get('invoices', [])
        company = data.get('company')
        
        if not invoices_data:
            return jsonify({
                "success": False,
                "message": "No se proporcionaron facturas para validar"
            }), 400
        
        if not company:
            return jsonify({
                "success": False,
                "message": "Compañía requerida"
            }), 400
        
        # Validar talonarios
        validation_result = validate_talonarios_for_afip_import(
            session=session,
            headers=headers,
            invoices_data=invoices_data,
            company=company
        )
        
        if validation_result['valid']:
            return jsonify({
                "success": True,
                "valid": True,
                "message": "Todos los talonarios necesarios están configurados correctamente",
                "talonarios_count": len(validation_result['talonarios']),
                "talonarios": validation_result['talonarios']
            })
        else:
            # Preparar mensaje de error detallado
            error_messages = []
            
            if validation_result['missing_talonarios']:
                error_messages.append("Talonarios faltantes o incompletos:")
                for missing in validation_result['missing_talonarios']:
                    error_messages.append(
                        f"  • Punto de Venta: {missing['punto_venta']}, "
                        f"Tipo Comprobante: {missing['tipo_comprobante']} "
                        f"({missing['count']} facturas afectadas)"
                    )
                    error_messages.append(f"    {missing['message']}")
            
            if validation_result['errors']:
                error_messages.append("\nErrores durante la validación:")
                for error in validation_result['errors']:
                    error_messages.append(f"  • {error}")
            
            return jsonify({
                "success": True,
                "valid": False,
                "message": "Faltan talonarios para importar las facturas",
                "missing_talonarios": validation_result['missing_talonarios'],
                "errors": validation_result['errors'],
                "error_detail": "\n".join(error_messages)
            })
    
    except Exception as e:
        print(f"--- Error validando talonarios: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "message": f"Error interno del servidor: {str(e)}"
        }), 500
