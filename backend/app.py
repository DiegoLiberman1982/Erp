from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
import logging
from dotenv import load_dotenv

# Importar utilidades HTTP
from utils.http_utils import make_erpnext_request, handle_erpnext_error

# Importar configuración
from config import ERPNEXT_URL, ERPNEXT_HOST

# Importar los blueprints de rutas
from routes.companies import companies_bp
from routes.accounting import accounting_bp
from routes.customers import customers_bp
from routes.suppliers import suppliers_bp
from routes.items import items_bp
from routes.taxes import taxes_bp
from routes.Configuracion.setup import setup_bp
from routes.Configuracion.setup2 import setup2_bp
from routes.system_settings import system_settings_bp
from routes.exchange_rates import exchange_rates_bp
from routes.currency_exchange import currency_exchange_bp
from routes.addresses import addresses_bp
from routes.invoices import invoices_bp
from routes.invoices_afip_import import invoices_import_bp
from routes.purchase_invoices_afip_import import purchase_invoices_import_bp
from routes.invoices_afip_validation import invoices_afip_validation_bp
from routes.purchase_invoices import purchase_invoices_bp
from routes.credit_debit_notes import credit_debit_notes_bp
from routes.payment_terms import payment_terms_bp
from routes.resources import resources_bp
from routes.comprobantes import comprobantes_bp
from routes.afip_lookup import afip_lookup_bp
from routes.treasury import treasury_bp
from routes.talonarios import talonarios_bp
from routes.pagos import pagos_bp
from routes.currency import currency_bp
from routes.reconciliation import reconciliation_bp
from routes.supplier_reconciliation import supplier_reconciliation_bp
from routes.inventory import inventory_bp
from routes.inventory_items import inventory_items_bp  # Nuevo módulo especializado
from routes.kits import kits_bp  # Módulo para kits (Product Bundles)
from routes.item_groups import item_groups_bp
from routes.uoms import uoms_bp
from routes.general import general_bp
from routes.purchase_price_lists import purchase_price_lists_bp
from routes.brands import brands_bp
from routes.bulk_import import bulk_import_bp
from routes.warehouses import warehouses_bp
from routes.sales_price_lists import sales_price_lists_bp
from routes.reports.price_list_reports import price_list_reports_bp
from routes.reports.inventory_reports import inventory_reports_bp
from routes.reports.iva_reports import iva_reports_bp
from routes.reports.percepciones_reports import percepciones_reports_bp
from routes.price_list_automation import price_list_automation_bp
from routes.users import users_bp
from routes.notifications import notifications_bp
from routes.bulk_update import bulk_update_bp
from routes.communications import communications_bp
from routes.groups import groups_bp
from routes.config_warehouses import config_warehouses_bp
from routes.remitos import remitos_bp
from routes.purchase_orders import purchase_orders_bp
from routes.document_linking import document_linking_bp
from routes.document_formats import document_formats_bp
from routes.sales_orders import sales_orders_bp
from routes.sales_quotations import sales_quotations_bp
from routes.integrations import integrations_bp
from routes.mercadopago import mercadopago_bp
from routes.inflation import inflation_bp
from routes.subscriptions import subscriptions_bp
from routes.stock_transfer import stock_transfer_bp
from routes.document_validator import document_validator_bp
from routes.purchase_perceptions import purchase_perceptions_bp
from routes.sales_withholdings import sales_withholdings_bp
from routes.bank_movements_import import bank_movements_import_bp
from routes.erpnext_scripts import erpnext_scripts_bp
from routes.tax_account_map import tax_account_map_bp
from routes.unpaid_movements import unpaid_movements_bp
from routes.expense_mapping import expense_mapping_bp
from routes.month_closure import month_closure_bp
from routes.party_import import party_import_bp

# Inicializa la aplicación Flask
app = Flask(__name__)
# Avoid automatic redirect when trailing slashes differ between request and route.
# This prevents browsers from receiving a 301/308 redirect for preflight OPTIONS requests
# which causes CORS failures: "Redirect is not allowed for a preflight request".
app.url_map.strict_slashes = False

# Configurar logging para reducir logs de werkzeug
logging.getLogger('werkzeug').setLevel(logging.WARNING)
app.logger.setLevel(logging.WARNING)

# Registrar los blueprints ANTES de configurar CORS
app.register_blueprint(companies_bp)
app.register_blueprint(accounting_bp)
app.register_blueprint(customers_bp)
app.register_blueprint(suppliers_bp)
app.register_blueprint(items_bp)
app.register_blueprint(taxes_bp)
app.register_blueprint(setup_bp)
app.register_blueprint(setup2_bp)
app.register_blueprint(system_settings_bp)
app.register_blueprint(exchange_rates_bp)
app.register_blueprint(addresses_bp)
app.register_blueprint(invoices_bp)
app.register_blueprint(invoices_import_bp)
app.register_blueprint(purchase_invoices_import_bp)
app.register_blueprint(invoices_afip_validation_bp)
app.register_blueprint(purchase_invoices_bp)
app.register_blueprint(credit_debit_notes_bp)
app.register_blueprint(payment_terms_bp)
app.register_blueprint(resources_bp, url_prefix='/api')
app.register_blueprint(comprobantes_bp)
app.register_blueprint(afip_lookup_bp)
app.register_blueprint(treasury_bp)
app.register_blueprint(talonarios_bp)
app.register_blueprint(pagos_bp)
app.register_blueprint(currency_bp)
app.register_blueprint(currency_exchange_bp)
app.register_blueprint(reconciliation_bp)
app.register_blueprint(supplier_reconciliation_bp)
app.register_blueprint(inventory_bp)
app.register_blueprint(inventory_items_bp)  # Módulo especializado para CRUD de items
app.register_blueprint(kits_bp)  # Módulo para kits (Product Bundles)
app.register_blueprint(item_groups_bp)
app.register_blueprint(uoms_bp)
app.register_blueprint(general_bp)
app.register_blueprint(purchase_price_lists_bp)
app.register_blueprint(brands_bp)
app.register_blueprint(bulk_import_bp)
app.register_blueprint(warehouses_bp)
app.register_blueprint(sales_price_lists_bp)
app.register_blueprint(price_list_automation_bp)
app.register_blueprint(price_list_reports_bp)
app.register_blueprint(inventory_reports_bp)
app.register_blueprint(iva_reports_bp)
app.register_blueprint(percepciones_reports_bp)
app.register_blueprint(users_bp)
app.register_blueprint(notifications_bp)
app.register_blueprint(bulk_update_bp)
app.register_blueprint(communications_bp)
app.register_blueprint(groups_bp)
app.register_blueprint(config_warehouses_bp)
app.register_blueprint(remitos_bp)
app.register_blueprint(purchase_orders_bp)
app.register_blueprint(document_linking_bp)
app.register_blueprint(document_formats_bp)
app.register_blueprint(sales_orders_bp)
app.register_blueprint(sales_quotations_bp)
app.register_blueprint(integrations_bp)
app.register_blueprint(mercadopago_bp)
app.register_blueprint(inflation_bp)
app.register_blueprint(subscriptions_bp)
app.register_blueprint(stock_transfer_bp)
app.register_blueprint(document_validator_bp)
app.register_blueprint(purchase_perceptions_bp)  # Módulo de percepciones de compra
app.register_blueprint(sales_withholdings_bp)  # Módulo de retenciones de venta
app.register_blueprint(bank_movements_import_bp)  # Módulo de importación de movimientos bancarios
app.register_blueprint(erpnext_scripts_bp)  # Módulo de Server Scripts de ERPNext
app.register_blueprint(tax_account_map_bp)  # Módulo de mapeo de cuentas para percepciones/retenciones
app.register_blueprint(unpaid_movements_bp)  # Módulo de movimientos sin factura
app.register_blueprint(expense_mapping_bp)  # Módulo de mapeo de cuentas de gastos
app.register_blueprint(month_closure_bp)  # Módulo de cierre de mes bancario

# Configurar CORS basado en el ambiente
# Lee la variable de entorno. Si no existe, usa localhost:5173 para desarrollo.
# En producción, le pasaremos la IP a través de docker-compose.
app.register_blueprint(party_import_bp)  # Importaci¢n masiva de clientes/proveedores

allowed_origins = os.getenv('FLASK_CORS_ORIGINS', 'http://localhost:5173,http://localhost:5174')
print(f"CORS - Orígenes permitidos leídos de ENV: {allowed_origins}")

# Configura CORS. Si allowed_origins tiene una sola URL, pasala como string.
# Si tiene varias separadas por coma, pasalas como lista.
if ',' in allowed_origins:
    origins_list = [origin.strip() for origin in allowed_origins.split(',')]
    CORS(app, origins=origins_list, supports_credentials=True, methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "Authorization", "X-Session-Token", "X-Requested-With", "X-Active-Company", "x-active-company"], expose_headers=["Content-Type", "X-Custom-Header"])
    print(f"CORS configurado para MÚLTIPLES orígenes: {origins_list}")
else:
    CORS(app, origins=allowed_origins, supports_credentials=True, methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "Authorization", "X-Session-Token", "X-Requested-With", "X-Active-Company", "x-active-company"], expose_headers=["Content-Type", "X-Custom-Header"])
    print(f"CORS configurado para UN origen: {allowed_origins}")


# Ruta de login (AHORA CON /api)
@app.route('/api/login', methods=['POST'])
def login():
    # LOG: Imprimimos para saber que la función fue llamada
    print("\n--- Petición de login recibida (/api/login) ---")

    # Obtiene el usuario y contraseña del JSON que envía React
    data = request.get_json()
    # LOG: Mostramos los datos que nos llegaron del frontend
    print(f"Datos recibidos: {data}")

    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        print("Error: Usuario o contraseña faltante en la petición.")
        return jsonify({"success": False, "message": "Usuario o contraseña faltante"}), 400

    # Usamos una sesión de 'requests' para que maneje las cookies automáticamente
    session = requests.Session()

    # Hacer la petición de login usando la utilidad centralizada
    response, error_response = make_erpnext_request(
        session=session,
        method="POST",
        endpoint="/api/method/login",
        data={"usr": username, "pwd": password},
        operation_name="Login"
    )

    # Si hubo error, devolver respuesta de error
    if error_response:
        if error_response.get('status_code') == 404: # Usar .get() por seguridad
             return jsonify({"success": False, "message": "Sitio no encontrado en el servidor ERPNext"}), 404
        # Usar handle_erpnext_error para consistencia
        print(f"Error en make_erpnext_request: {error_response}")
        json_resp, status = handle_erpnext_error(error_response, "Credenciales inválidas o error de conexión")
        return json_resp, status


    # Si el login es exitoso, ERPNext nos devuelve una cookie de sesión llamada 'sid'
    sid_token = session.cookies.get('sid')

    if not sid_token:
        print("Error: Login exitoso pero no se encontró el token 'sid' en las cookies de la respuesta de ERPNext.")
        # Podría ser un cambio en ERPNext o un problema de red intermedio
        return jsonify({"success": False, "message": "No se pudo obtener el token de sesión desde ERPNext"}), 500

    # LOG: Confirmamos que obtuvimos el token
    print(f"Token de sesión (SID) obtenido exitosamente: {sid_token[:15]}...")
    # Devolvemos el token al frontend
    return jsonify({"success": True, "token": sid_token})

# Inicia el servidor
if __name__ == '__main__':
    if not ERPNEXT_URL:
        print("Error: La variable de entorno ERPNEXT_URL no está definida. Por favor, asegúrate de que esté configurada.")
    else:
        # Usar host 0.0.0.0 para aceptar conexiones externas dentro de Docker
        # Debug=True es útil, pero considerar quitarlo para producción final
        app.run(host="0.0.0.0", port=5000, debug=True)
