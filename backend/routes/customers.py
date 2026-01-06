from flask import Blueprint

from routes.customer_utils import ensure_customer_by_tax, fetch_customer, get_customer_tax_condition
from routes.customers_common import create_custom_customer_fields, get_customer_receivable_account
from routes.customers_api_core import register as _register_core
from routes.customers_api_reports import register as _register_reports

customers_bp = Blueprint('customers', __name__)

_register_core(customers_bp)
_register_reports(customers_bp)
