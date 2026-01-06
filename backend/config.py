import os
import os.path
from urllib.parse import urlparse
from dotenv import load_dotenv

# Carga las variables de entorno desde el archivo .env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

# Configuración de ERPNext
ERPNEXT_URL = os.getenv("ERPNEXT_URL")
ERPNEXT_HOST = os.getenv("ERPNEXT_HOST")

# Integración opcional para consulta de AFIP (proveedor privado)
AFIP_LOOKUP_PROVIDER_PATH = os.getenv("AFIP_LOOKUP_PROVIDER_PATH")

# Configuración del frontend
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
# Moneda pivote global opcional (se espera que se reemplace por la moneda por defecto de la compañía)
PRICE_PIVOT_CURRENCY = os.getenv("PRICE_PIVOT_CURRENCY")

# URL p�blica/base del sitio para plantillas de correo y branding
SITE_BASE_URL = os.getenv("SITE_BASE_URL")
if not SITE_BASE_URL and ERPNEXT_URL:
    parsed = urlparse(ERPNEXT_URL)
    scheme = parsed.scheme or "http"
    host = parsed.hostname or ""
    SITE_BASE_URL = f"{scheme}://{host}" if host else None
