// invoiceModalApi.js - API functions for InvoiceModal

import API_ROUTES from '../../../apiRoutes.js';
import { fetchWarehouses as fetchWarehousesCommon } from '../../../apiUtils.js';

/**
 * Parse metodo_numeracion_factura_venta string to extract components
 * Format: PREFIX-TYPE-LETTER-PUNTO_VENTA-NUMERO
 * Example: "FC-FAC-A-50201-00000075" -> { prefix: "FC", type: "FAC", letter: "A", punto_venta: "50201", numero: "00000075" }
 * @param {string} metodoNumeracion - The metodo_numeracion_factura_venta string
 * @returns {Object|null} Parsed components or null if invalid format
 */
export const parseMetodoNumeracion = (metodoNumeracion) => {
  if (!metodoNumeracion || typeof metodoNumeracion !== 'string') {
    return null;
  }

  const parts = metodoNumeracion.split('-');
  if (parts.length < 5) {
    return null;
  }

  const [prefix, type, letter, puntoVenta, numero] = parts;

  return {
    prefix,
    type,
    letter,
    punto_venta: puntoVenta,
    numero
  };
};

/**
 * Convert parsed type to invoice type description
 * @param {string} type - The type from metodo_numeracion (FAC, NDC, NDB, TIQ, etc.)
 * @returns {string} Invoice type description
 */
export const getInvoiceTypeFromParsedType = (type) => {
  switch (type) {
    case 'FAC':
      return 'Factura';
    case 'NCC':
    case 'NDC':
      return 'Nota de Crédito';
    case 'NDB':
      return 'Nota de Débito';
    case 'TIQ':
      return 'Ticket';
    case 'REC':
      return 'Recibo';
    default:
      return 'Factura'; // Default fallback
  }
}

/**
 * Fetches exchange rate for a given currency
 * @param {string} currency - Currency code (e.g., 'USD', 'EUR')
 * @param {string} postingDate - Posting date for the invoice
 * @param {Function} setExchangeRate - State setter for exchange rate
 * @param {Function} setExchangeRateDate - State setter for exchange rate date
 * @param {Function} setFormData - State setter for form data
 * @param {Function} setIsLoadingExchangeRate - State setter for loading state
 * @param {Function} showNotification - Notification function
 * @returns {Promise<void>}
 */
export const fetchExchangeRate = async (
  currency,
  postingDate,
  baseCurrency,
  setExchangeRate,
  setExchangeRateDate,
  setFormData,
  setIsLoadingExchangeRate,
  showNotification,
  fetchWithAuth
) => {
  // Usar la fecha de emisión de la factura, o la fecha actual si no hay
  const invoiceDate = postingDate || new Date().toISOString().split('T')[0]
  const resolvedBaseCurrency = (baseCurrency || '').toString().trim()

  if (!currency) {
    showNotification('Seleccione una moneda antes de consultar cotización', 'error')
    setExchangeRate(null)
    setExchangeRateDate(invoiceDate)
    setFormData(prev => ({ ...prev, exchange_rate: '' }))
    return
  }

  if (!resolvedBaseCurrency) {
    showNotification('La empresa no tiene moneda por defecto definida', 'error')
    setExchangeRate(null)
    setExchangeRateDate(invoiceDate)
    setFormData(prev => ({ ...prev, exchange_rate: '' }))
    return
  }

  if (currency === resolvedBaseCurrency) {
    setExchangeRate(1)
    setExchangeRateDate(invoiceDate)
    setFormData(prev => ({ ...prev, exchange_rate: 1 }))
    return
  }

  setIsLoadingExchangeRate(true)
  try {
    const requester = fetchWithAuth || fetch
    const response = await requester(
      `/api/currency-exchange/latest?currency=${encodeURIComponent(currency)}&to=${encodeURIComponent(resolvedBaseCurrency)}`
    )
    if (response && response.ok) {
      const data = await response.json()
      if (data.success && data.data) {
        const rate = data.data.exchange_rate || data.data.rate || data.data.exchangeRate || data.data.cotizacion_ars
        if (rate) {
          setExchangeRate(rate)
          setExchangeRateDate(data.data.date || invoiceDate)
          setFormData(prev => ({ ...prev, exchange_rate: rate }))
          showNotification(`Cotización ${currency}/${resolvedBaseCurrency} actualizada: ${rate}`, 'success')
        } else {
          showNotification('No se encontró cotización para la moneda seleccionada', 'error')
          setExchangeRate(null)
          setExchangeRateDate(invoiceDate)
          setFormData(prev => ({ ...prev, exchange_rate: '' }))
        }
      } else {
        showNotification(`Error al obtener cotización: ${data.message || 'sin datos'}`, 'error')
        setExchangeRate(null)
        setExchangeRateDate(invoiceDate)
        setFormData(prev => ({ ...prev, exchange_rate: '' }))
      }
    } else {
      showNotification('Error al consultar la API de cotizaciones', 'error')
      setExchangeRate(null)
      setExchangeRateDate(invoiceDate)
      setFormData(prev => ({ ...prev, exchange_rate: '' }))
    }
  } catch (error) {
    console.error('Error fetching exchange rate:', error)
    showNotification(error?.message || 'Error al obtener la cotización', 'error')
    setExchangeRate(null)
    setExchangeRateDate(invoiceDate)
    setFormData(prev => ({ ...prev, exchange_rate: '' }))
  } finally {
    setIsLoadingExchangeRate(false)
  }
}

/**
 * Fetches payment terms from the API
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {string} API_ROUTES - API routes object
 * @param {Function} setPaymentTerms - State setter for payment terms
 * @returns {Promise<void>}
 */
export const fetchPaymentTerms = async (fetchWithAuth, API_ROUTES, setPaymentTerms) => {
  try {
    // Usar el nuevo endpoint que incluye los detalles de términos
    const response = await fetchWithAuth(API_ROUTES.paymentTermsListWithDetails)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        // Ordenar: primero Contado (0 días), luego por días ascendentes
        const sortedTerms = (data.data || []).sort((a, b) => {
          const aDays = a.terms && a.terms.length > 0 ? a.terms[0].credit_days || 0 : 0
          const bDays = b.terms && b.terms.length > 0 ? b.terms[0].credit_days || 0 : 0

          // Contado (0 días) siempre primero
          if (aDays === 0) return -1
          if (bDays === 0) return 1

          // Luego ordenar por días ascendentes
          return aDays - bDays
        })

        setPaymentTerms(sortedTerms)
      } else {
        console.error('Error fetching payment terms:', data.message)
      }
    } else {
      console.error('Error fetching payment terms:', response.status)
    }
  } catch (error) {
    console.error('Error fetching payment terms:', error)
  }
}

/**
 * Fetches active company details
 * @param {string} companyName - Name of the company
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setActiveCompanyDetails - State setter for company details
 * @returns {Promise<void>}
 */
export const fetchActiveCompanyDetails = async (companyName, fetchWithAuth, setActiveCompanyDetails) => {
  try {
    const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}`)
    if (response.ok) {
      const data = await response.json()
      setActiveCompanyDetails(data.data)
    }
  } catch (error) {
    console.error('Error fetching active company details:', error)
  }
}

/**
 * Searches for accounts based on query
 * @param {string} query - Search query
 * @param {number} itemIndex - Index of the item
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setAccountSearchResults - State setter for search results
 * @param {Function} setShowAccountDropdown - State setter for dropdown visibility
 * @returns {Promise<void>}
 */
export const searchAccounts = async (
  query,
  itemIndex,
  fetchWithAuth,
  setAccountSearchResults,
  setShowAccountDropdown
) => {
  if (query.length < 3) {
    setAccountSearchResults(prev => ({ ...prev, [itemIndex]: [] }))
    setShowAccountDropdown(prev => ({ ...prev, [itemIndex]: false }))
    return
  }

  try {
    const response = await fetchWithAuth(`/api/accounts?search=${encodeURIComponent(query)}&limit=10`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        // Filtrar cuentas del mismo tipo que usa el cliente: Income y no sumarizadoras
        const filteredAccounts = data.data.filter(account =>
          account.root_type === 'Income' &&
          !account.is_group
        )
        setAccountSearchResults(prev => ({ ...prev, [itemIndex]: filteredAccounts }))
        setShowAccountDropdown(prev => ({ ...prev, [itemIndex]: true }))
      }
    }
  } catch (error) {
    console.error('Error searching accounts:', error)
  }
}

/**
 * Fetches available talonarios for invoice generation
 * @param {string} activeCompany - Active company name
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setAvailableTalonarios - State setter for available talonarios
 * @returns {Promise<void>}
 */
export const fetchAvailableTalonarios = async (
  activeCompany,
  fetchWithAuth,
  setAvailableTalonarios
) => {

  if (!activeCompany) {
    console.log('❌ No active company provided')
    setAvailableTalonarios([])
    return
  }

  try {
    console.log('📡 Fetching talonarios from API...')
    const response = await fetchWithAuth(`/api/talonarios?compania=${encodeURIComponent(activeCompany)}&activos=1`)
    console.log('📡 Talonarios response status:', response.status)

    if (response.ok) {
      const data = await response.json()
      console.log('📦 Talonarios raw data:', data)

      if (data.success) {

        // Log each talonario for debugging
        data.data?.forEach((talonario, index) => {
        })

        // Filtrar talonarios que pueden emitir facturas
        // Criterio principal: Debe tener punto_de_venta válido
        // El metodo_numeracion se puede generar automáticamente si no existe o es inválido
        const invoiceTalonarios = data.data.filter(talonario => {
          const hasPuntoVenta = talonario.punto_de_venta && talonario.punto_de_venta.trim() !== ''

          console.log(`🔍 Filtering talonario ${talonario.name}:`, {
            hasPuntoVenta,
            punto_de_venta: talonario.punto_de_venta,
            metodo_numeracion_factura_venta: talonario.metodo_numeracion_factura_venta
          })

          // Solo requerimos que tenga punto de venta
          // El método de numeración se generará automáticamente si falta o es inválido
          return hasPuntoVenta
        })


        setAvailableTalonarios(invoiceTalonarios)
      } else {
        console.log('❌ API returned success=false:', data.message)
        setAvailableTalonarios([])
      }
    } else {
      console.log('❌ API response not ok:', response.status)
      setAvailableTalonarios([])
    }
  } catch (error) {
    console.error('❌ Error fetching available talonarios:', error)
    setAvailableTalonarios([])
  }
}

/**
 * Filters available talonarios based on selected comprobante type
 * @param {Array} allTalonarios - All available talonarios
 * @param {string} invoiceCategory - Selected letter (A, B, C, etc.)
 * @param {string} invoiceType - Selected invoice type (Factura, Nota de Crédito, etc.)
 * @returns {Array} Filtered talonarios that can emit the selected type
 */
export const filterTalonariosByComprobanteType = (allTalonarios, invoiceCategory, invoiceType) => {
  if (!invoiceCategory || !invoiceType) {
    return allTalonarios.filter(t => t.punto_de_venta && t.punto_de_venta.trim() !== '')
  }

  // Determine if it's a credit/debit note
  const isCreditNote = invoiceType.toLowerCase().includes('crédito') || invoiceType.toLowerCase().includes('credito')
  const isDebitNote = invoiceType.toLowerCase().includes('débito') || invoiceType.toLowerCase().includes('debito')

  // Filter talonarios that have punto_venta and the appropriate metodo_numeracion field
  const filtered = allTalonarios.filter(talonario => {
    const hasPuntoVenta = talonario.punto_de_venta && talonario.punto_de_venta.trim() !== ''
    
    // Check the appropriate metodo_numeracion field based on document type
    let hasValidMetodoNumeracion = false
    let metodoNumeracion = ''
    
    if (isCreditNote) {
      // For credit notes, check metodo_numeracion_nota_credito first, fallback to factura_venta
      metodoNumeracion = talonario.metodo_numeracion_nota_credito || talonario.metodo_numeracion_factura_venta || ''
      hasValidMetodoNumeracion = metodoNumeracion.trim() !== '' && metodoNumeracion.split('-').length >= 5
    } else if (isDebitNote) {
      // For debit notes, check metodo_numeracion_nota_debito first, fallback to factura_venta
      metodoNumeracion = talonario.metodo_numeracion_nota_debito || talonario.metodo_numeracion_factura_venta || ''
      hasValidMetodoNumeracion = metodoNumeracion.trim() !== '' && metodoNumeracion.split('-').length >= 5
    } else {
      // For regular invoices, use metodo_numeracion_factura_venta
      metodoNumeracion = talonario.metodo_numeracion_factura_venta || ''
      hasValidMetodoNumeracion = metodoNumeracion.trim() !== '' && metodoNumeracion.split('-').length >= 5
    }

    // TEMPORAL: Permitir talonarios sin método válido si tienen punto de venta
    const canUseTemporarily = !hasValidMetodoNumeracion && hasPuntoVenta

    // Check if the talonario can emit this specific letter
    let canEmitLetter = true  // TEMPORAL: Permitir todas las letras mientras debugueamos
    if (talonario.letras && Array.isArray(talonario.letras) && talonario.letras.length > 0) {
      canEmitLetter = talonario.letras.some(letra => letra.letra === invoiceCategory)
    }

    // Check if the talonario matches the invoice type based on metodo_numeracion
    let canEmitType = true  // TEMPORAL: Permitir todos los tipos mientras debugueamos
    if (hasValidMetodoNumeracion) {
      const parts = metodoNumeracion.split('-')
      const prefix = parts[0]  // FE or FM
      const docType = parts[1]  // FAC, NDC, NDB, etc.
      
      // Check document type first
      if (isCreditNote && docType !== 'NDC') {
        canEmitType = false
      } else if (isDebitNote && docType !== 'NDB') {
        canEmitType = false
      } else if (!isCreditNote && !isDebitNote && docType !== 'FAC') {
        canEmitType = false
      }
      
      // Then check if electronic/manual matches the invoice type
      if (canEmitType) {
        if (invoiceType === 'Factura Electrónica') {
          canEmitType = prefix === 'FE'
        } else if (invoiceType === 'Factura') {
          canEmitType = prefix === 'FM'
        } else {
          // For other types (Nota de Crédito, etc.), check prefix based on electronic flag
          // This is more complex - we might need to enhance this logic
          canEmitType = true  // Allow for now
        }
      }
    } else if (canUseTemporarily) {
      // Para talonarios temporales sin método de numeración válido,
      // permitir que emitan cualquier tipo mientras no tengamos la validación estricta
      canEmitType = true
    }

    // Permitir talonarios válidos O temporales que cumplan con letra y tipo
    const passesFilter = hasPuntoVenta && canEmitLetter && canEmitType && (hasValidMetodoNumeracion || canUseTemporarily)
    
    return passesFilter
  })

  return filtered
}

/**
 * Updates all existing talonarios to add metodo_numeracion_factura_venta if missing
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} showNotification - Notification function
 * @returns {Promise<boolean>} Success status
 */
export const updateTalonariosNumeracion = async (fetchWithAuth, showNotification) => {
  try {
    console.log('🔄 Updating talonarios numeración methods...')
    
    const response = await fetchWithAuth('/api/talonarios/update-numeracion', {
      method: 'POST'
    })

    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        console.log(`✅ Updated ${data.updated_count} talonarios with numeración methods`)
        showNotification(`Actualizados ${data.updated_count} talonarios con métodos de numeración`, 'success')
        return true
      } else {
        console.error('❌ Failed to update talonarios:', data.message)
        showNotification(`Error actualizando talonarios: ${data.message}`, 'error')
        return false
      }
    } else {
      console.error('❌ API error updating talonarios:', response.status)
      showNotification('Error en la API al actualizar talonarios', 'error')
      return false
    }
  } catch (error) {
    console.error('❌ Exception updating talonarios:', error)
    showNotification('Error interno al actualizar talonarios', 'error')
    return false
  }
}

/**
 * Determines available comprobante options based on supplier IVA condition
 * SIMPLIFICADO: Lógica determinista basada en condición fiscal del proveedor
 * - RI (Responsable Inscripto): letras A, B, M
 * - Exento: letras A, B, M  
 * - Monotributista: letra C
 * - Sin condición fiscal: letra X
 * 
 * Los tipos de comprobantes vienen de afip_codes.json (tipos_comprobante + uso_comprobante.compras)
 * @param {string} supplierIVACondition - IVA condition of the supplier (cached)
 * @param {Function} setComprobanteOptions - State setter for comprobante options
 * @param {Function} setAvailableLetters - State setter for available letters
 * @param {Function} setAvailableComprobantes - State setter for available comprobantes
 * @param {Function} setFormData - State setter for form data
 * @param {Function} setSelectedComprobanteOption - State setter for selected comprobante option
 * @param {boolean} isEditing - Whether we are editing an existing invoice
 * @param {Object} afipCodes - Full afip_codes.json object
 * @returns {void}
 */
export const determineComprobanteOptions = (
  supplierIVACondition,
  setComprobanteOptions,
  setAvailableLetters,
  setAvailableComprobantes,
  setFormData,
  setSelectedComprobanteOption,
  isEditing = false,
  afipCodes = null
) => {
  // Determine allowed letters based on IVA condition - lógica simple y directa
  let allowedLetters = []
  
  if (supplierIVACondition) {
    const condition = supplierIVACondition.toLowerCase()
    if (condition.includes('responsable inscripto') || condition.includes('exento')) {
      // RI y Exento reciben facturas A, B, M
      allowedLetters = ['A', 'B', 'M']
    } else if (condition.includes('monotribut')) {
      // Monotributista solo emite C
      allowedLetters = ['C']
    } else {
      // Sin condición fiscal conocida = X
      allowedLetters = ['X']
    }
  } else {
    // Si no hay proveedor seleccionado o no tiene condición fiscal = X
    allowedLetters = ['X']
  }

  // Get comprobante types for purchases from afip_codes.json
  let comprobanteTypes = ['Factura', 'Nota de Débito', 'Nota de Crédito', 'Ticket'] // fallback
  
  if (afipCodes && afipCodes.tipos_comprobante && afipCodes.uso_comprobante?.compras) {
    // Filter tipos_comprobante to only those allowed for purchases
    const tiposCompras = afipCodes.uso_comprobante.compras
    comprobanteTypes = afipCodes.tipos_comprobante
      .filter(t => tiposCompras.includes(t.tipo))
      .map(t => t.descripcion)
  }

  // Generate options based on allowed letters and types
  const comprobanteOptions = []
  comprobanteTypes.forEach(type => {
    allowedLetters.forEach(letter => {
      comprobanteOptions.push({
        letra: letter,
        descripcion: type,
        punto_de_venta: '00001',
        proximo_numero: 1
      })
    })
  })

  setComprobanteOptions(comprobanteOptions)
  setAvailableLetters(allowedLetters)
  setAvailableComprobantes(comprobanteTypes)

  // Set default letter and comprobante
  if (allowedLetters.length > 0 && comprobanteTypes.length > 0) {
    const defaultLetter = allowedLetters[0]
    const defaultComprobante = 'Factura'
    
    // Only update form data for new invoices
    if (!isEditing) {
      setFormData(prev => ({
        ...prev,
        invoice_category: defaultLetter,
        invoice_type: defaultComprobante,
        voucher_type: defaultLetter,
        invoice_number: '00000001',
        punto_de_venta: '00001'
      }))
    }

    const defaultOption = comprobanteOptions.find(opt => opt.letra === defaultLetter && opt.descripcion === defaultComprobante)
    if (defaultOption) {
      setSelectedComprobanteOption(defaultOption)
    }
  }
}

/**
 * Searches for items based on query
 * @param {string} query - Search query
 * @param {string} activeCompany - Active company name
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setItemSearchResults - State setter for search results
 * @param {Function} setShowItemDropdown - State setter for dropdown visibility
 * @returns {Promise<void>}
 */
export const searchItems = async (
  query,
  activeCompany,
  fetchWithAuth,
  successHandler,
  showDropdownHandler,
  searchField = 'all' // 'code' | 'description' | 'all'
) => {
  // Normalize handlers: accept state setters or plain callbacks
  const setResultsFn = typeof successHandler === 'function' ? successHandler : () => {}
  const setShowDropdownFn = typeof showDropdownHandler === 'function' ? showDropdownHandler : () => {}

  if (query.length < 2) {
    // Keep callers consistent: call handlers with empty array / hide dropdown
    try { setResultsFn([]) } catch (e) { console.error('searchItems: setResultsFn error', e) }
    try { setShowDropdownFn(false) } catch (e) { console.error('searchItems: setShowDropdownFn error', e) }
    return []
  }

  try {
    console.log('🔍 Searching items with query:', query, 'for company:', activeCompany, 'field:', searchField)
    
    // Construir los filtros según el campo de búsqueda
    // - 'code': buscar solo en name (código del item)
    // - 'description': buscar solo en item_name y description
    // - 'all': buscar en todos los campos
    let orFilters
    if (searchField === 'code') {
      orFilters = [["name", "like", `%${query}%`]]
    } else if (searchField === 'description') {
      orFilters = [
        ["item_name", "like", `%${query}%`],
        ["description", "like", `%${query}%`]
      ]
    } else {
      orFilters = [
        ["item_name", "like", `%${query}%`],
        ["description", "like", `%${query}%`],
        ["name", "like", `%${query}%`]
      ]
    }

    const baseFilters = [["is_stock_item", "=", "1"]]
    if (activeCompany) baseFilters.push(["custom_company", "=", activeCompany])

    // Limitar fields a lo necesario para la búsqueda y display
    const fields = JSON.stringify(["name","item_name","description","custom_company","stock_uom","item_defaults","item_group"])

    // Crear URL con parámetros correctamente serializados
    const params = new URLSearchParams({
      fields,
      or_filters: JSON.stringify(orFilters),
      filters: JSON.stringify(baseFilters),
      limit: '30'
    })
    
    const response = await fetchWithAuth(`/api/resource/Item?${params.toString()}`)
    console.log('📡 Search response status:', response.status)
    if (response.ok) {
      const data = await response.json()
      console.log('📦 Search response data:', data)
      if (data.success) {
        console.log('✅ Found', data.data.length, 'items')
        // Procesar los resultados para mostrar el código limpio (sin empresa) y extraer expense_account
        const processedItems = data.data.map(item => {
          // Intentar extraer expense_account de item_defaults si existe (para compras)
          let expenseAccount = ''
          if (item.item_defaults && Array.isArray(item.item_defaults) && item.item_defaults.length > 0) {
            console.log('DEBUG - item_defaults found:', item.item_defaults)
            const defaultForCompany = item.item_defaults.find(def => {
              console.log('DEBUG - comparing company:', def.company, '===', activeCompany, '?', def.company === activeCompany)
              return def.company === activeCompany
            })
            if (defaultForCompany && defaultForCompany.expense_account) {
              expenseAccount = defaultForCompany.expense_account
              console.log('DEBUG - expense_account found:', expenseAccount)
            } else {
              console.log('DEBUG - no default found for company:', activeCompany, 'using first available')
              // Si no hay default para la compañía específica, usar el primero disponible
              if (item.item_defaults[0] && item.item_defaults[0].expense_account) {
                expenseAccount = item.item_defaults[0].expense_account
              }
            }
          } else {
            console.log('DEBUG - no item_defaults found for item:', item.name, '- will use default expense account')
          }

          console.log('DEBUG searchItems - Item:', item.name, 'expense_account extracted:', expenseAccount)

          return {
            ...item,
            display_code: item.name.split(' - ')[0], // Remover la parte de la empresa
            expense_account: expenseAccount,
            search_text: `${item.item_name} ${item.description} ${item.name}`.toLowerCase()
          }
        })
        try { setResultsFn(processedItems) } catch (e) { console.error('searchItems: setResultsFn error', e) }
        try { setShowDropdownFn(true) } catch (e) { /* ignore */ }
        return processedItems
      }
    }
  } catch (error) {
    console.error('Error searching items:', error)
    try { setResultsFn([]) } catch (e) { console.error('searchItems: setResultsFn error', e) }
    try { setShowDropdownFn(false) } catch (e) { /* ignore */ }
    return []
  }
}

/**
 * Fetches available warehouses for the active company
 * @param {string} activeCompany - Active company name
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setAvailableWarehouses - State setter for warehouses
 * @returns {Promise<void>}
 */
export const fetchAvailableWarehouses = async (activeCompany, fetchWithAuth, setAvailableWarehouses) => {
  try {
    console.log('Fetching available warehouses for company:', activeCompany)
    const warehouses = await fetchWarehousesCommon(fetchWithAuth, activeCompany)
    setAvailableWarehouses(warehouses)
    console.log('Available warehouses for company:', warehouses.length)
  } catch (error) {
    console.error('Error fetching warehouses:', error)
    setAvailableWarehouses([])
  }
}

/**
 * Fetches available purchase price lists
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setAvailablePriceLists - State setter for price lists
 * @returns {Promise<void>}
 */
export const fetchAvailablePurchasePriceLists = async (fetchWithAuth, setAvailablePriceLists) => {
  try {
    console.log('Fetching available purchase price lists')
    const response = await fetchWithAuth('/api/inventory/purchase-price-lists/all')
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        console.log('Available purchase price lists:', data.data.length)
        setAvailablePriceLists(data.data)
      } else {
        console.error('Error fetching purchase price lists:', data.message)
        setAvailablePriceLists([])
      }
    } else {
      console.error('Error response fetching purchase price lists:', response.status)
      setAvailablePriceLists([])
    }
  } catch (error) {
    console.error('Error fetching purchase price lists:', error)
    setAvailablePriceLists([])
  }
}

/**
 * Fetches details of a specific purchase price list
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {string} priceListName - Name of the price list
 * @returns {Promise<Object|null>} Price list details or null if not found
 */
export const fetchPurchasePriceListDetails = async (fetchWithAuth, priceListName) => {
  if (!priceListName) return null

  try {
    const response = await fetchWithAuth(`/api/inventory/purchase-price-lists/${encodeURIComponent(priceListName)}/details`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        return data.data
      } else {
        console.error('Error fetching price list details:', data.message)
        return null
      }
    } else {
      console.error('Error response fetching price list details:', response.status)
      return null
    }
  } catch (error) {
    console.error('Error fetching price list details:', error)
    return null
  }
}

/**
 * Fetches the price of a specific item in a specific price list
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {string} priceListName - Name of the price list
 * @param {string} itemCode - Code of the item
 * @returns {Promise<Object|null>} Item price data or null if not found
 */
export const fetchItemPriceInPriceList = async (fetchWithAuth, priceListName, itemCode) => {
  if (!priceListName || !itemCode) return null

  try {
    console.log('Fetching item price for:', itemCode, 'in price list:', priceListName)
    const response = await fetchWithAuth(`/api/inventory/purchase-price-lists/${encodeURIComponent(priceListName)}/item/${encodeURIComponent(itemCode)}/price`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        console.log('Item price found:', data.data)
        return data.data
      } else {
        console.error('Error fetching item price:', data.message)
        return null
      }
    } else if (response.status === 404) {
      // Item not found in price list - this is expected behavior, don't log as error
      console.log('Item not found in price list (404):', itemCode, 'in', priceListName)
      return null
    } else {
      console.error('Error response fetching item price:', response.status)
      return null
    }
  } catch (error) {
    console.error('Error fetching item price:', error)
    return null
  }
}
