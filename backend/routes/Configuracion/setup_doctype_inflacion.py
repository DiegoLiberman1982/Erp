from urllib.parse import quote

from routes.Configuracion.setup_afip_utils import check_doctype_exists
from utils.http_utils import make_erpnext_request

DOCTYPE_NAME = "Indice Inflacion FACPCE"


def _doctype_payload():
    """DocType definition for Argentinian inflation indices (IPC nacional)."""
    fields = [
        {
            "fieldname": "periodo",
            "label": "Periodo",
            "fieldtype": "Data",
            "reqd": 1,
            "unique": 1,
            "in_list_view": 1,
            "in_standard_filter": 1,
            "bold": 1,
            "description": "Ej: ene-93 o 2024-08",
        },
        {
            "fieldname": "ipc_nacional",
            "label": "IPC Nacional",
            "fieldtype": "Float",
            "reqd": 1,
            "precision": "4",
            "in_list_view": 1,
            "in_standard_filter": 1,
        },
        {
            "fieldname": "fuente",
            "label": "Fuente",
            "fieldtype": "Data",
            "default": "FACPCE",
            "in_list_view": 1,
            "read_only": 1,
        },
        {
            "fieldname": "notas",
            "label": "Notas",
            "fieldtype": "Small Text",
            "in_list_view": 0,
        },
    ]

    permissions = [
        {
            "role": "System Manager",
            "permlevel": 0,
            "read": 1,
            "write": 1,
            "create": 1,
            "delete": 1,
            "print": 1,
            "email": 1,
            "share": 1,
            "export": 1,
            "import": 1,
            "set_user_permissions": 1,
        },
        {
            "role": "Purchase Manager",
            "permlevel": 0,
            "read": 1,
            "write": 1,
            "create": 1,
            "delete": 0,
            "print": 1,
            "email": 1,
        },
        {
            "role": "Purchase User",
            "permlevel": 0,
            "read": 1,
            "write": 1,
            "create": 0,
            "delete": 0,
            "print": 1,
            "email": 1,
        },
        {
            "role": "Sales Manager",
            "permlevel": 0,
            "read": 1,
            "write": 1,
            "create": 1,
            "delete": 0,
            "print": 1,
            "email": 1,
        },
        {
            "role": "Sales User",
            "permlevel": 0,
            "read": 1,
            "write": 0,
            "create": 0,
            "delete": 0,
            "print": 1,
            "email": 1,
        },
    ]

    return {
        "data": {
            "doctype": "DocType",
            "name": DOCTYPE_NAME,
            "module": "Custom",
            "custom": 1,
            "istable": 0,
            "editable_grid": 1,
            "track_changes": 1,
            "allow_rename": 1,
            "allow_copy": 1,
            "allow_import": 1,
            "allow_export": 1,
            "autoname": "field:periodo",
            "description": "Indices de inflacion IPC nacional (Argentina) descargados de FACPCE",
            "fields": fields,
            "permissions": permissions,
        }
    }


def ensure_inflacion_doctype(session, headers, erpnext_url):
    """Create or update the custom DocType for inflation indices."""
    try:
        exists = check_doctype_exists(session, headers, DOCTYPE_NAME, erpnext_url)
        payload = _doctype_payload()
        if exists:
            # Si ya existe, no lo actualizamos en cada llamada para evitar loops repetitivos
            print(f"DocType '{DOCTYPE_NAME}' ya existe, omitimos actualización.")
            return True
        else:
            print(f"DocType '{DOCTYPE_NAME}' no existe, creando...")
            response, error = make_erpnext_request(
                session=session,
                method="POST",
                endpoint="/api/resource/DocType",
                data=payload,
                operation_name=f"Create DocType {DOCTYPE_NAME}",
            )

        if error:
            print(f"Error creando/actualizando DocType {DOCTYPE_NAME}: {error}")
            return False

        if response and response.status_code in (200, 201, 202):
            print(f"DocType {DOCTYPE_NAME} listo")
            return True

        print(
            f"Error creando/actualizando DocType {DOCTYPE_NAME}: "
            f"{response.status_code if response else 'sin respuesta'}"
        )
        return False
    except Exception as exc:
        print(f"Error general en ensure_inflacion_doctype: {exc}")
        return False
