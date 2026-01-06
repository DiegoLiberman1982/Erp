import API_ROUTES from './apiRoutes';

// Base API URL read from Vite env: VITE_API_URL.
// If not provided the app will use relative paths (helpful when using Vite proxy or same-origin backend).
// Example: VITE_API_URL=http://localhost:5000
const API_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL)
  ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
  : '';

/**
 * Consulta datos de AFIP para un CUIT específico
 * @param {string} cuit - El CUIT a consultar
 * @param {function} fetchWithAuth - Función de autenticación (no usada para AFIP)
 * @returns {Promise<Object>} Datos del contribuyente desde AFIP
 */
export const getAfipData = async (cuit, fetchWithAuth) => {
  try {
    console.log(`Consultando datos AFIP para CUIT: ${cuit}`);

    // Para consultas AFIP, usamos fetch directo ya que no requiere empresa activa
    const token = localStorage.getItem('erp_token');
    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['X-Session-Token'] = token;
    }

    const fullUrl = `${API_URL}${API_ROUTES.afipData}${cuit}`;
    console.log('URL completa para AFIP:', fullUrl);

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        console.log('Datos AFIP obtenidos exitosamente:', data.data);
        return {
          success: true,
          data: data.data
        };
      } else {
        console.error('Error en respuesta de AFIP:', data.message);
        return {
          success: false,
          error: data.message || 'Error desconocido al consultar AFIP'
        };
      }
    } else {
      const errorData = await response.json().catch(() => ({}));
      console.error('Error HTTP al consultar AFIP:', response.status, errorData);
      return {
        success: false,
        error: errorData.message || `Error HTTP: ${response.status}`
      };
    }
  } catch (error) {
    console.error('Error al consultar datos AFIP:', error);
    return {
      success: false,
      error: 'Error de conexión al consultar AFIP'
    };
  }
};

/**
 * Valida que un CUIT tenga el formato correcto
 * @param {string} cuit - El CUIT a validar
 * @returns {boolean} True si el CUIT es válido
 */
export const validateCuit = (cuit) => {
  // Remover guiones y espacios
  const cleanCuit = cuit.replace(/[-\s]/g, '');

  // Verificar que tenga 11 dígitos
  if (!/^\d{11}$/.test(cleanCuit)) {
    return false;
  }

  // Algoritmo de validación de CUIT
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;

  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleanCuit[i]) * multipliers[i];
  }

  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder;

  return parseInt(cleanCuit[10]) === checkDigit;
};

/**
 * Formatea un CUIT para mostrar (con guiones)
 * @param {string} cuit - El CUIT a formatear
 * @returns {string} CUIT formateado
 */
export const formatCuit = (cuit) => {
  const cleanCuit = cuit.replace(/[-\s]/g, '');
  if (cleanCuit.length === 11) {
    return `${cleanCuit.slice(0, 2)}-${cleanCuit.slice(2, 10)}-${cleanCuit.slice(10)}`;
  }
  return cuit;
};

/**
 * Fetches available warehouses for the active company
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {string} activeCompany - Active company name
 * @returns {Promise<Object>} Object with flat and grouped warehouse arrays
 */
export const fetchWarehouses = async (fetchWithAuth, activeCompany) => {
  try {
    const response = await fetchWithAuth(`/api/inventory/warehouses?company=${encodeURIComponent(activeCompany)}`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        const warehouses = data.data || []
        const grouped = data.grouped || []

        // Ensure all warehouses have warehouse_name for display consistency
        const processedWarehouses = (warehouses && Array.isArray(warehouses)) ? warehouses.map(warehouse => ({
          ...warehouse,
          // Use warehouse_name as the primary display label, fallback to name if needed
          warehouse_name: warehouse.warehouse_name || warehouse.display_name || warehouse.name,
          display_name: warehouse.display_name || warehouse.warehouse_name || warehouse.name
        })) : []

        // Process grouped warehouses to ensure display names
        const processedGrouped = grouped.map(group => ({
          ...group,
          ownWarehouse: group.ownWarehouse ? {
            ...group.ownWarehouse,
            warehouse_name: group.ownWarehouse.warehouse_name || group.ownWarehouse.display_name || group.ownWarehouse.name,
            display_name: group.ownWarehouse.display_name || group.ownWarehouse.warehouse_name || group.ownWarehouse.name
          } : null,
          consignationWarehouses: (group.consignationWarehouses || []).map(wh => ({
            ...wh,
            warehouse_name: wh.warehouse_name || wh.display_name || wh.name,
            display_name: wh.display_name || wh.warehouse_name || wh.name
          })),
          vendorConsignationWarehouses: (group.vendorConsignationWarehouses || []).map(wh => ({
            ...wh,
            warehouse_name: wh.warehouse_name || wh.display_name || wh.name,
            display_name: wh.display_name || wh.warehouse_name || wh.name
          }))
        }))

        return {
          flat: processedWarehouses,  // Flat list for backward compatibility
          grouped: processedGrouped,  // Grouped by base_code for new UI
          all: processedWarehouses     // Alias for flat list
        }
      } else {
        console.error('Error fetching warehouses:', data.message)
        return { flat: [], grouped: [], all: [] }
      }
    } else {
      console.error('Error response fetching warehouses:', response.status)
      return { flat: [], grouped: [], all: [] }
    }
  } catch (error) {
    console.error('Error fetching warehouses:', error)
    return { flat: [], grouped: [], all: [] }
  }
};


/**
 * Fetch Item Tax Templates from the backend and normalize the response to a
 * consistent shape for the frontend. The backend returns a typed payload:
 * {
 *   success: true,
 *   data: { sales: [...], purchase: [...] },
 *   rate_to_template_map: { sales: {...}, purchase: {...}, flat: {...} }
 * }
 * This helper returns an object: { success: true, templates: [...combined], sales: [...], purchase: [...], rate_to_template_map: {...} }
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {boolean} force - If true, bypass cache
 */
export const fetchTaxTemplates = async (fetchWithAuth, force = false) => {
  try {
    const url = force ? `${API_ROUTES.taxTemplates}?nocache=1` : API_ROUTES.taxTemplates
    const response = await fetchWithAuth(url)
    if (!response.ok) return { success: false }
    const data = await response.json()
    if (!data.success) return { success: false }

    // If backend returned typed payload use it, else fallback to legacy data array
    const payload = data.data || {}
    let sales = []
    let purchase = []
    if (Array.isArray(payload)) {
      // legacy: flat array
      sales = payload
      purchase = []
    } else {
      sales = Array.isArray(payload.sales) ? payload.sales : []
      purchase = Array.isArray(payload.purchase) ? payload.purchase : []
    }

    // Merge into a single array for components that expect a flat list
    const templates = [...sales, ...purchase]

    console.log(`--- Tax templates loaded: ${templates.length} templates (sales: ${sales.length}, purchase: ${purchase.length})`)

    return {
      success: true,
      templates,
      sales,
      purchase,
      rate_to_template_map: (data.rate_to_template_map || {})
    }
  } catch (error) {
    console.error('Error fetching tax templates', error)
    return { success: false }
  }
}