# Configuracion

Esta carpeta contiene los módulos de configuración avanzada del sistema ERP.

## Archivos

### setup.py
Contiene las funciones de configuración inicial básica de la empresa:
- Creación de unidades de medida (UOM)
- Configuración de grupos de clientes y proveedores (con abreviatura de compañía)
- Creación de listas de precios
- Creación de plantillas de impuestos
- Creación de plantillas de impuestos para ítems
- Inicialización completa de la configuración de empresa

### setup_groups.py
Gestiona la configuración de grupos de clientes y proveedores con abreviatura de compañía:
- **ensure_customer_groups_exist**: Busca "All Customer Groups" y lo renombra a "Todos los Grupos de Clientes - {abbr}", o lo crea si no existe
- **ensure_supplier_groups_exist**: Busca "All Supplier Groups" y lo renombra a "Todos los Grupos de Proveedores - {abbr}", o lo crea si no existe
- **setup_all_groups**: Configura todos los grupos para una compañía

**Lógica de renombrado/creación:**
1. Verifica si existe el grupo sin abreviatura (ej: "All Customer Groups")
2. Verifica si existe el grupo con abreviatura (ej: "Todos los Grupos de Clientes - ABC")
3. Si existe sin abbr y no existe con abbr → renombra
4. Si no existe con abbr → crea nuevo
5. Crea subgrupos necesarios (Clientes Generales, Proveedores Generales)

### setup2.py
Contiene las funciones de configuración avanzada para AFIP y talonarios:
- Creación de campos personalizados para Condición IVA
- Creación de DocTypes para Tipo Comprobante AFIP
- Creación de DocTypes para Talonario
- Creación de registros de ejemplo para AFIP
- Creación de series de numeración para talonarios
- Inicialización completa de la configuración AFIP

## Endpoints API

### Setup (setup.py)
- `POST /api/setup/company-initialization` - Inicialización completa de empresa
- `GET /api/setup/status` - Estado de configuración
- `GET /api/setup/tax-templates` - Plantillas de impuestos
- `GET /api/setup/items` - Ítems para asignar plantillas
- `GET /api/setup/tax-accounts` - Cuentas de impuestos
- `POST /api/setup/assign-tax-account` - Asignar cuenta de impuestos
- `POST /api/setup/create-tax-template` - Crear plantilla de impuestos
- `POST /api/setup/assign-template-to-item` - Asignar plantilla a ítem
- `GET /api/setup/sales-tax-templates` - Plantillas de impuestos de ventas

### Setup2 (setup2.py)
- `POST /api/setup2/create-custom-fields` - Crear campos personalizados
- `POST /api/setup2/create-afip-doctypes` - Crear DocTypes AFIP
- `POST /api/setup2/create-afip-records` - Crear registros AFIP
- `POST /api/setup2/create-naming-series` - Crear series de numeración
- `POST /api/setup2/initialize-afip-setup` - Inicialización completa AFIP

## Uso

Los módulos se importan automáticamente en `app.py` y están disponibles como blueprints Flask.