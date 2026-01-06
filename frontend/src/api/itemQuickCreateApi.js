import API_ROUTES from '../apiRoutes'

/**
 * Calls backend quick-create endpoint to create an item and sync price lists.
 * @param {Function} fetchWithAuth - Authenticated fetch helper
 * @param {Object} payload - Quick create payload (company, supplier, price_list, item, etc.)
 * @returns {Promise<Object>} Created item + price info
 */
export const quickCreateItem = async (fetchWithAuth, payload) => {
  const response = await fetchWithAuth(API_ROUTES.quickCreateItem, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  let data = {}
  try {
    data = await response.json()
  } catch (error) {
    data = {}
  }

  if (!response.ok || data.success === false) {
    const message = data?.message || 'No se pudo crear el item automáticamente'
    throw new Error(message)
  }

  return data.data
}

