# ERP System - AI Coding Assistant Instructions

## Architecture Overview
This is a full-stack ERP integration system with:
- **Backend**: Flask API gateway/proxy to ERPNext (Frappe framework)
- **Frontend**: React + Vite with Tailwind CSS and Handsontable
- **Deployment**: Docker Compose with separate backend/frontend services
- **Authentication**: ERPNext session-based (SID tokens via X-Session-Token header)

## Critical Developer Workflows

### Environment Setup
```bash
# Copy environment template
cp .env.production.example .env

# Required environment variables
ERPNEXT_URL=http://your-erpnext-server:port
ERPNEXT_HOST=your-erpnext-host
FLASK_CORS_ORIGINS=http://localhost:5173
```

### Running the Application
```bash
# Start all services
docker-compose up --build

# Backend only (port 5000)
cd backend && python app.py

# Frontend only (port 5173)
cd frontend && npm run dev
```

### Authentication Flow
- Login endpoint: `POST /api/login` with `username`/`password`
- Returns SID token from ERPNext
- All subsequent requests include `X-Session-Token` header
- Session validation via `routes/auth_utils.get_session_with_auth()`

## Project-Specific Conventions

### Company Isolation Pattern
All business entities are scoped by company using abbreviations:
```python
# Company codes are appended with abbreviation
item_code = f"{base_code} - {company_abbr}"
item_group = f"{group_name} - {company_abbr}"

# Utility functions in routes/general.py
company_abbr = get_company_abbr(session, headers, company)
clean_code = remove_company_abbr(code, company_abbr)
full_code = add_company_abbr(code, company_abbr)
```

### Centralized HTTP Utilities
Always use `utils/http_utils.make_erpnext_request()` for ERPNext API calls:
```python
from utils.http_utils import make_erpnext_request

response, error = make_erpnext_request(
    session=session,
    method="GET",
    endpoint="/api/resource/Item",
    operation_name="Fetch Items"
)

if error:
    return handle_erpnext_error(error, "Failed to fetch items")
```

### Authentication Helper
Use `routes/auth_utils.get_session_with_auth()` in all protected routes:
```python
session, headers, user_id, error_response = get_session_with_auth()
if error_response:
    return error_response
```

### Error Handling Pattern
Consistent error responses with logging:
```python
try:
    # operation
    print("--- Operation: success")
    return jsonify({"success": True, "data": result})
except Exception as e:
    print("--- Operation: error")
    return jsonify({"success": False, "message": str(e)}), 500
```

### Blueprint Registration
All route modules are registered in `backend/app.py`:
```python
from routes.items import items_bp
app.register_blueprint(items_bp)  # No URL prefix needed
```

### CORS Configuration
Environment-based CORS setup in `app.py`:
```python
allowed_origins = os.getenv('FLASK_CORS_ORIGINS', 'http://localhost:5173')
CORS(app, origins=allowed_origins, supports_credentials=True)
```

## Integration Patterns

### ERPNext API Calls
- Use `quote()` from `urllib.parse` for URL encoding
- Handle filters as JSON strings: `filters=[["field","=","value"]]`
- Use `fields=["field1","field2"]` for selective retrieval
- POST data as `{"data": {...}}` wrapper

### Frontend-Backend Communication
- API base URL from `VITE_API_URL` environment variable
- Authenticated requests via `AuthContext.fetchWithAuth()`
- Error handling with `response.ok` checks

### Data Import/Export
- Use ERPNext Data Import Tool for bulk operations
- CSV generation with proper field mapping
- Progress tracking with UUID-based process IDs

## Key Files to Reference

### Backend Architecture
- `backend/app.py` - Main Flask app and blueprint registration
- `backend/config.py` - Environment configuration
- `backend/routes/auth_utils.py` - Authentication helpers
- `backend/utils/http_utils.py` - ERPNext API utilities
- `backend/routes/general.py` - Company utilities and helpers

### Frontend Architecture
- `frontend/src/App.jsx` - Main React app
- `frontend/src/AuthProvider.jsx` - Authentication context
- `frontend/src/apiUtils.js` - API utilities
- `frontend/src/apiRoutes.js` - Centralized API endpoints

### Configuration
- `docker-compose.yml` - Multi-service deployment
- `.env.production.example` - Required environment variables

## Common Patterns

### Item Processing
Items are created/found dynamically with tax templates. The helper now requires a
`transaction_type` argument to choose the appropriate template set for the document
context (`'sales'` for sales documents and `'purchase'` for purchase documents):
```python
item_code = find_or_create_item_by_description(item, session, headers, company)
# transaction_type must be 'sales' or 'purchase'
tax_map = get_tax_template_map(session, headers, company, transaction_type='sales')
assign_tax_template_by_rate(item_code, iva_percent, session, headers, company, transaction_type='sales')
```

### Account Determination
Income/expense accounts resolved hierarchically:
1. Item-specific account
2. Customer/supplier default account
3. Company default account
4. Chart of accounts search
5. Hardcoded fallback

### Bulk Operations
Use threading for long-running imports:
```python
thread = threading.Thread(target=process_import)
thread.daemon = True
thread.start()
return jsonify({"process_id": process_id})
```

## Development Best Practices

- Always check `active_companies.json` for user company assignments
- Use company abbreviations for multi-tenant isolation
- Implement progress tracking for bulk operations
- Handle ERPNext API pagination with `limit_page_length` and `limit_start`
- Validate all user inputs and ERPNext responses
- Use descriptive operation names in `make_erpnext_request()` calls

## Directrices: fallbacks, límites y aclaraciones (tooltips)

- No hacemos nunca fallbacks automáticos: los datos deben buscarse siempre de una única forma definida. Si una búsqueda o consulta falla, hay que investigar qué pasó y debuguear; no introducir un fallback implícito que oculte el problema.

- Los fallbacks sólo son válidos cuando el autor lo indica explícitamente y están documentados. Por ejemplo: buscar la cuenta contable asignada al cliente; si el cliente no tiene cuenta, entonces (y sólo entonces) buscar la cuenta en las configuraciones del grupo de clientes. Estas cascadas deben ser limpias y deterministas.

- Casos donde NO corresponde usar fallbacks: por ejemplo, si no encuentro un precio para una determinada lista de precios, NO se debe buscar automáticamente en otra lista de precios. Ese comportamiento está prohibido salvo indicación expresas del dueño del requerimiento.

- `limit_page_length` para las peticiones no debe venir hardcodeado. Siempre debe utilizarse el "smart limit" definido en `routes/general.py` (o la función utilitaria correspondiente) para controlar paginación y evitar valores mágicos en los llamados a ERPNext.

- Aclaraciones y elecciones: siempre que hace falta explicar qué opciones están permitidas o no, usar un tooltip en la UI o documentación contextual. No dejar copetes o aclaraciones visibles por defecto en el layout; las aclaraciones deben estar en tooltips o documentación asociada.

## Frontend UI Patterns

#### Modal Usage
- **Always use** `frontend/src/components/Modal.jsx` for modal dialogs
- **Modal execution**: Modals must always be controlled from the parent component (when pages have many components)
- **Best practice**: Create modals as separate components for better organization
- **Modal features**: Supports dragging, minimizing, maximizing, and custom sizes

#### Notifications
- **Never use** old browser `alert()` dialogs
- **Always use** `frontend/src/components/Notification.jsx` with `NotificationContext`
- **Import pattern**: `import { useNotification } from '../contexts/NotificationContext'`
- **Usage**: `const { showNotification, showSuccess, showError, showWarning, showInfo } = useNotification()`
- **Styling**: Notification styles are defined in `frontend/src/styles.css`

#### Confirmation Modals
- **Always use** `confirm-modal-*` CSS classes from `frontend/src/styles.css` for confirmation dialogs
- **Never use** custom Tailwind classes for confirmation modals - they must use the predefined styles
- **Structure**: Use `confirm-modal-overlay`, `confirm-modal-content`, `confirm-modal-header`, `confirm-modal-body`, `confirm-modal-footer`
- **Header**: Include `confirm-modal-title-section` with icon and title, plus `confirm-modal-close-btn`
- **Buttons**: Use `confirm-modal-btn-cancel` for cancel actions and `confirm-modal-btn-confirm` with variants (`error`, `warning`, `success`) for confirm actions
- **Example**:
```jsx
<div className="confirm-modal-overlay">
  <div className="confirm-modal-content">
    <div className="confirm-modal-header">
      <div className="confirm-modal-title-section">
        <AlertTriangle className="w-6 h-6 text-red-500" />
        <h3 className="confirm-modal-title">Confirmar Acción</h3>
      </div>
      <button className="confirm-modal-close-btn">×</button>
    </div>
    <div className="confirm-modal-body">
      <p className="confirm-modal-message">Mensaje de confirmación</p>
    </div>
    <div className="confirm-modal-footer">
      <button className="confirm-modal-btn-cancel">Cancelar</button>
      <button className="confirm-modal-btn-confirm error">Confirmar</button>
    </div>
  </div>
</div>
```

#### Button Styling
- **Primary actions**: Use `btn-secondary` class from `frontend/src/styles.css` for action buttons
- **Never use** custom Tailwind button classes - always use predefined CSS classes
- **Common classes**: `btn-secondary` for action buttons, `btn-primary` for primary actions
- **Styling location**: All button styles must be defined in `frontend/src/styles.css` for consistency