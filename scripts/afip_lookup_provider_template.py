def lookup_afip_data(*, cuit: str, user_id: str | None = None) -> dict:
    """
    Implementación privada (NO versionar) para resolver datos AFIP por CUIT.

    Debe devolver un dict con el formato que espera el frontend, por ejemplo:
      {
        "name": "...",
        "business_name": "...",
        "cuit": "20123456789",
        "tax_condition": "...",
        "tax_condition_id": 1,
        "address": "...",
        "email": "",
        "phone": "",
        "tipo_persona": "FISICA|JURIDICA",
        "personeria": "",
        "pais": "ARGENTINA",
        "provincia": "...",
        "localidad": "...",
        "codigo_postal": "...",
        "impuestos": [],
      }
    """
    raise NotImplementedError("Implementación privada")

