import { fetchWarehouses } from '../../../apiUtils.js'
import { normalizeText } from './invoiceModalUtils.js'
import { isCreditNoteLabel, isDebitNoteLabel } from '../../../utils/comprobantes'

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
      `/api/currency/exchange-rate?from=${encodeURIComponent(currency)}&to=${encodeURIComponent(resolvedBaseCurrency)}`
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data?.success === false) {
      throw new Error(data?.message || `Status ${response.status}`)
    }
    const rate = data.exchange_rate ?? data.data?.exchange_rate
    if (!rate) {
      throw new Error('No se encontró cotización para la moneda seleccionada')
    }

    setExchangeRate(rate)
    setExchangeRateDate(invoiceDate)
    setFormData(prev => ({ ...prev, exchange_rate: rate }))
    showNotification(`Cotización ${currency}/${resolvedBaseCurrency} actualizada: ${rate}`, 'success')
  } catch (error) {
    console.error('Error fetching exchange rate:', error)
    showNotification(error?.message || 'Error al obtener la cotización', 'error')
    setExchangeRate(null)
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

        setPaymentTerms && setPaymentTerms(sortedTerms)
        return sortedTerms
      } else {
        console.error('Error fetching payment terms:', data.message)
      }
    } else {
      console.error('Error fetching payment terms:', response.status)
    }
  } catch (error) {
    console.error('Error fetching payment terms:', error)
  }
  return []
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
      setActiveCompanyDetails && setActiveCompanyDetails(data.data)
      return data.data
    }
  } catch (error) {
    console.error('Error fetching active company details:', error)
  }
  return null
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
    console.log('--- Talonarios: no active company')
    setAvailableTalonarios([])
    return []
  }

  try {
    console.log('--- Talonarios: fetching from API')
    const response = await fetchWithAuth(`/api/talonarios?compania=${encodeURIComponent(activeCompany)}&activos=1`)
    console.log('--- Talonarios: response received')

    if (response.ok) {
      const data = await response.json()
      console.log('--- Talonarios: data loaded')

      if (data.success) {

        // Log each talonario for debugging
        data.data?.forEach((talonario, index) => {
        })

        // Filtrar talonarios que pueden emitir facturas
        // Criterio principal: Debe tener punto_de_venta válido
        // El metodo_numeracion se puede generar automáticamente si no existe o es inválido
        const invoiceTalonarios = data.data
          .filter(talonario => {
            const hasPuntoVenta = talonario.punto_de_venta && talonario.punto_de_venta.trim() !== ''

            console.log('--- Talonarios: filtering by punto de venta')

            // Solo requerimos que tenga punto de venta
            // El método de numeración se generará automáticamente si falta o es inválido
            return hasPuntoVenta
          })
          .map(talonario => {
            const lastNumbersMap = {}
            if (Array.isArray(talonario.ultimos_numeros)) {
              talonario.ultimos_numeros.forEach(entry => {
                if (entry?.tipo_documento && entry?.letra) {
                  const key = `${entry.tipo_documento}-${entry.letra}`
                  lastNumbersMap[key] = entry.ultimo_numero_utilizado ?? 0
                }
              })
            }
            return {
              ...talonario,
              last_numbers_map: lastNumbersMap
            }
          })


        setAvailableTalonarios && setAvailableTalonarios(invoiceTalonarios)
        return invoiceTalonarios
      } else {
        console.log('--- Talonarios: API success false')
        setAvailableTalonarios && setAvailableTalonarios([])
      }
    } else {
      console.log('--- Talonarios: API response not ok')
      setAvailableTalonarios && setAvailableTalonarios([])
    }
  } catch (error) {
    console.error('❌ Error fetching available talonarios:', error)
    setAvailableTalonarios && setAvailableTalonarios([])
  }
  return []
}

/**
 * Updates all existing talonarios to add metodo_numeracion_factura_venta if missing
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} showNotification - Notification function
 * @returns {Promise<boolean>} Success status
 */
export const updateTalonariosNumeracion = async (fetchWithAuth, showNotification) => {
  try {
    console.log('--- Talonarios: updating numeración methods')
    
    const response = await fetchWithAuth('/api/talonarios/update-numeracion', {
      method: 'POST'
    })

    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        console.log('--- Talonarios: numeración methods updated')
        showNotification(`Actualizados ${data.updated_count} talonarios con métodos de numeración`, 'success')
        return true
      } else {
        console.error('--- Talonarios: update failed')
        showNotification(`Error actualizando talonarios: ${data.message}`, 'error')
        return false
      }
    } else {
      console.error('--- Talonarios: API error')
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
 * Determines available comprobante options based on customer and company
 * @param {string} selectedCustomer - Selected customer name
 * @param {string} activeCompany - Active company name
 * @param {number} unpaidInvoicesCount - Number of unpaid invoices
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setComprobanteOptions - State setter for comprobante options
 * @param {Function} setAvailableLetters - State setter for available letters
 * @param {Function} setAvailableComprobantes - State setter for available comprobantes
 * @param {Function} setFormData - State setter for form data
 * @param {Function} setSelectedComprobanteOption - State setter for selected comprobante option
 * @returns {Promise<void>}
 */
export const determineComprobanteOptions = async (
  selectedCustomer,
  activeCompany,
  unpaidInvoicesCount,
  fetchWithAuth,
  setComprobanteOptions,
  setAvailableLetters,
  setAvailableComprobantes,
  setFormData,
  setSelectedComprobanteOption,
  currentInvoiceType = null,
  excludeName = null
) => {
  console.log('--- Comprobante options: determining')
  console.log('[invoiceModalApi] determineComprobanteOptions called with', { selectedCustomer, activeCompany, unpaidInvoicesCount, currentInvoiceType })

  if (!selectedCustomer || !activeCompany) return

  try {
    console.log('📡 [invoiceModalApi] Enviando POST a /api/comprobantes/determine-options con:', { customer: selectedCustomer, company: activeCompany, exclude_name: excludeName })
    const response = await fetchWithAuth('/api/comprobantes/determine-options', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer: selectedCustomer,
        company: activeCompany,
        exclude_name: excludeName
      })
    })

    if (response.ok) {
      const data = await response.json()
      console.log('📥 [invoiceModalApi] Respuesta de determine-options:', data)
      if (data.success) {
        let options = data.data.options || []
        console.log('🔧 [invoiceModalApi] Opciones iniciales recibidas:', options)

        // Filtrar opciones de nota de crédito/débito si no hay facturas pendientes
        // Pero mantener todas las opciones para talonarios de resguardo
        if (unpaidInvoicesCount === 0) {
          const beforeFilter = options.length
          options = options.filter(option =>
            option.is_resguardo || (!isCreditNoteLabel(option.descripcion) && !isDebitNoteLabel(option.descripcion))
          )
          console.log('🔧 [invoiceModalApi] Opciones filtradas por unpaidInvoicesCount === 0:', { before: beforeFilter, after: options.length, filteredOut: beforeFilter - options.length })
        }

        console.log('🔧 [invoiceModalApi] Opciones finales después de filtro:', options)
        setComprobanteOptions(options)

        // Set available letters
        const letters = [...new Set(options.map(opt => opt.letra))]
        console.log('🔧 [invoiceModalApi] Letras disponibles:', letters)
        setAvailableLetters(letters)

        // Set default letter and comprobantes
        if (letters.length > 0) {
          console.log('🔧 [invoiceModalApi] Seleccionando opción por defecto. currentInvoiceType:', currentInvoiceType)
          // If caller provided an explicit invoice type, honor it strictly:
          // - If an option matching that descripcion exists, select it
          // - If not, DO NOT fallback to another type (that would change user's explicit selection)
          if (currentInvoiceType) {
            const matchingOption = options.find(opt => opt.descripcion === currentInvoiceType)
            if (!matchingOption) {
              console.log('[invoiceModalApi] Requested invoice type not found in options; preserving caller selection and not assigning a default', { requested: currentInvoiceType })
              // Publish available lists but do NOT set a default option nor change invoice_type
              const allDescriptions = [...new Set(options.map(opt => opt.descripcion))]
              console.log('🔧 [invoiceModalApi] Descripciones disponibles sin selección por defecto:', allDescriptions)
              setAvailableComprobantes(allDescriptions)
              setComprobanteOptions(options)
              setAvailableLetters(letters)
              return options
            }
            // Found a matching option -> proceed to treat it as defaultOption
            console.log('🔧 [invoiceModalApi] Opción matching encontrada:', matchingOption)
            const defaultOption = matchingOption
            setFormData(prev => ({ ...prev, invoice_category: defaultOption.letra }))
            const filtered = [...new Set(options
              .filter(opt => opt.letra === defaultOption.letra)
              .map(opt => opt.descripcion))]
            console.log('🔧 [invoiceModalApi] Comprobantes filtrados para letra', defaultOption.letra, ':', filtered)
            setAvailableComprobantes(filtered)
            setSelectedComprobanteOption(defaultOption)
            // Ensure punto_de_venta applies for credit notes
            if (currentInvoiceType && isCreditNoteLabel(currentInvoiceType)) {
              console.log('🔧 [invoiceModalApi] Aplicando punto_de_venta para nota de crédito:', defaultOption.punto_de_venta)
              setFormData(prev => ({ ...prev, invoice_category: defaultOption.letra, punto_de_venta: defaultOption.punto_de_venta }))
            } else {
              console.log('🔧 [invoiceModalApi] Aplicando configuración estándar:', { voucher_type: defaultOption.letra, invoice_type: defaultOption.descripcion, punto_de_venta: defaultOption.punto_de_venta })
              setFormData(prev => ({ ...prev, voucher_type: defaultOption.letra, invoice_type: defaultOption.descripcion, punto_de_venta: defaultOption.punto_de_venta }))
            }
          } else {
            // No explicit requested type -> preserve original fallback behavior
            console.log('🔧 [invoiceModalApi] No currentInvoiceType, usando fallback. defaultLetter:', letters[0])
            const defaultLetter = letters[0]
            const defaultOption = options.find(opt => opt.letra === defaultLetter)
            if (defaultOption) {
              console.log('🔧 [invoiceModalApi] defaultOption encontrada:', defaultOption)
              setFormData(prev => ({ ...prev, invoice_category: defaultOption.letra }))
              const filtered = [...new Set(options
                .filter(opt => opt.letra === defaultOption.letra)
                .map(opt => opt.descripcion))]
              console.log('🔧 [invoiceModalApi] Comprobantes filtrados para defaultLetter:', filtered)
              setAvailableComprobantes(filtered)
              setSelectedComprobanteOption(defaultOption)
              setFormData(prev => ({ ...prev, voucher_type: defaultOption.letra, invoice_type: defaultOption.descripcion, punto_de_venta: defaultOption.punto_de_venta }))
            } else {
              console.log('🔧 [invoiceModalApi] No defaultOption encontrada para defaultLetter:', defaultLetter)
            }
          }
        }
      } else {
        // Handle backend error - check if it's about missing talonario
        const errorMessage = data.message || 'Error desconocido'
        if (errorMessage.includes('talonario') || errorMessage.includes('No se encontró')) {
          // Clear any existing options and show error
          setComprobanteOptions([])
          setAvailableLetters([])
          setAvailableComprobantes([])
          setSelectedComprobanteOption(null)
          
          // Show notification to user about configuring talonarios
          console.error('Error de talonario:', errorMessage)
          // Note: showNotification is not available in this scope, will be handled by caller
        } else {
          // Other backend errors
          console.error('Error determinando opciones de comprobante:', errorMessage)
        }
      }
    } else {
      // Handle HTTP error responses
      try {
        const errorData = await response.json()
        const errorMessage = errorData.message || `Error HTTP ${response.status}`
        
        // Check if it's about missing talonario
        if (errorMessage.includes('talonario') || errorMessage.includes('No se encontró')) {
          setComprobanteOptions([])
          setAvailableLetters([])
          setAvailableComprobantes([])
          setSelectedComprobanteOption(null)
          
          console.error('Error de talonario:', errorMessage)
          // Note: showNotification is not available in this scope, will be handled by caller
        } else {
          console.error('Error HTTP determinando opciones de comprobante:', errorMessage)
        }
      } catch (parseError) {
        console.error('Error parsing error response:', parseError)
      }
    }
  } catch (error) {
    console.error('Error determinando opciones de comprobante:', error)
  }
}

/**
 * Searches for items based on query and field
 * @param {string} query - Search query
 * @param {string} field - Field to search in ('item_code' or 'description')
 * @param {string} activeCompany - Active company name
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setItemSearchResults - State setter for search results
 * @param {Function} setShowItemDropdown - State setter for dropdown visibility
 * @returns {Promise<void>}
 */
export const searchItems = async (
  query,
  field,
  activeCompany,
  fetchWithAuth,
  setItemSearchResults,
  setShowItemDropdown,
  options = {}
) => {
  const { skipPrimaryTokenFilter = false, showDropdown = true, returnResults = false } = options
  const trimmedQuery = (query || '').trim()
  if (trimmedQuery.length < 2) {
    setItemSearchResults([])
    if (showDropdown) setShowItemDropdown(false)
    if (returnResults) return []
    return
  }

  try {
    console.log('🔍 Searching items with query:', trimmedQuery, 'for company:', activeCompany, 'field:', field)
    
    // Construir los filtros según el campo de búsqueda
    // - 'code': buscar solo en name (código del item)
    // - 'description': buscar solo en item_name y description
    // - 'all': buscar en todos los campos
    let orFilters
    if (field === 'code') {
      orFilters = [["name", "like", `%${trimmedQuery}%`]]
    } else if (field === 'description') {
      orFilters = [
        ["item_name", "like", `%${trimmedQuery}%`],
        ["description", "like", `%${trimmedQuery}%`]
      ]
    } else {
      orFilters = [
        ["item_name", "like", `%${trimmedQuery}%`],
        ["description", "like", `%${trimmedQuery}%`],
        ["name", "like", `%${trimmedQuery}%`]
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
        // Procesar los resultados para mostrar el código limpio (sin empresa) y extraer income_account
        const processedItems = data.data.map(item => {
          // Intentar extraer income_account de item_defaults si existe (para ventas)
          let incomeAccount = ''
          if (item.item_defaults && Array.isArray(item.item_defaults) && item.item_defaults.length > 0) {
            console.log('DEBUG - item_defaults found:', item.item_defaults)
            const defaultForCompany = item.item_defaults.find(def => {
              console.log('DEBUG - comparing company:', def.company, '===', activeCompany, '?', def.company === activeCompany)
              return def.company === activeCompany
            })
            if (defaultForCompany && defaultForCompany.income_account) {
              incomeAccount = defaultForCompany.income_account
              console.log('DEBUG - income_account found:', incomeAccount)
            } else {
              console.log('DEBUG - no default found for company:', activeCompany, 'using first available')
              // Si no hay default para la compañía específica, usar el primero disponible
              if (item.item_defaults[0] && item.item_defaults[0].income_account) {
                incomeAccount = item.item_defaults[0].income_account
              }
            }
          }

          console.log('DEBUG searchItems - Item:', item.name, 'income_account extracted:', incomeAccount)

          return {
            ...item,
            display_code: item.name, // Mantener el código completo para compatibilidad
            income_account: incomeAccount
          }
        })

        console.log('📋 Processed items:', processedItems.length)
        setItemSearchResults(processedItems)
        if (showDropdown) setShowItemDropdown(true)
        if (returnResults) return processedItems
      } else {
        console.warn('[InvoiceModal] searchItems backend responded with success=false', data)
        setItemSearchResults([])
        if (showDropdown) setShowItemDropdown(false)
        if (returnResults) return []
      }
    } else {
      console.warn('[InvoiceModal] searchItems request failed', response.status)
      setItemSearchResults([])
      if (showDropdown) setShowItemDropdown(false)
      if (returnResults) return []
    }
  } catch (error) {
    console.error('[InvoiceModal] searchItems error:', error)
    setItemSearchResults([])
    if (showDropdown) setShowItemDropdown(false)
    if (returnResults) return []
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
    console.log('--- Warehouses: fetching using grouped API')
    const warehouseData = await fetchWarehouses(fetchWithAuth, activeCompany)
    console.log('--- Warehouses: loaded', warehouseData.flat.length, 'warehouses')

    // Use the flat array for backward compatibility, but now it includes warehouse_name
    setAvailableWarehouses && setAvailableWarehouses(warehouseData.flat)
    return warehouseData.flat
  } catch (error) {
    console.error('--- Warehouses: fetch failed')
    setAvailableWarehouses && setAvailableWarehouses([])
  }
  return []
}

/**
 * Fetches enabled sales price lists from the backend
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {string} [route='/api/sales-price-lists'] - Endpoint to retrieve price lists
 * @returns {Promise<Array>} List of price list objects
 */
export const fetchSalesPriceLists = async (fetchWithAuth, route = '/api/sales-price-lists') => {
  try {
    const response = await fetchWithAuth(route)
    if (!response.ok) {
      console.error('Error fetching sales price lists:', response.status)
      return []
    }

    const data = await response.json()
    if (!data.success) {
      console.error('Sales price lists response returned success=false:', data.message)
      return []
    }

    return Array.isArray(data.data) ? data.data : []
  } catch (error) {
    console.error('Error fetching sales price lists:', error)
    return []
  }
}

/**
 * Fetches the price of an item for a given price list
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {string} priceListName - Price list identifier
 * @param {string} itemName - Full item code/name (usually includes company suffix)
 * @returns {Promise<{rate: number, currency: string} | null>} Price information or null if not found
 */
export const fetchItemPriceRate = async (fetchWithAuth, priceListName, itemName) => {
  if (!priceListName || !itemName) {
    console.log('fetchItemPriceRate: missing priceListName or itemName', { priceListName, itemName })
    return null
  }

  try {
    const params = new URLSearchParams()
    params.set('fields', JSON.stringify(['name', 'price_list_rate', 'currency', 'item_code', 'price_list']))
    params.set('filters', JSON.stringify([
      ['price_list', '=', priceListName],
      ['item_code', '=', itemName],
      ['selling', '=', 1]
    ]))
    params.set('limit', '1')

    console.log('fetchItemPriceRate: searching price', { priceListName, itemName, url: `/api/resource/Item Price?${params.toString()}` })

    const response = await fetchWithAuth(`/api/resource/Item Price?${params.toString()}`)
    if (!response.ok) {
      console.warn('fetchItemPriceRate request failed', response.status)
      return null
    }

    const data = await response.json()
    console.log('fetchItemPriceRate: response', { success: data.success, dataLength: data.data?.length, data: data.data })
    
    if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
      console.log('fetchItemPriceRate: no price found for', { priceListName, itemName })
      return null
    }

    const entry = data.data[0]
    if (entry == null || entry.price_list_rate == null) {
      console.log('fetchItemPriceRate: entry has no price_list_rate', entry)
      return null
    }

    console.log('fetchItemPriceRate: found price', { 
      priceList: entry.price_list, 
      itemCode: entry.item_code, 
      rate: entry.price_list_rate 
    })

    return {
      rate: typeof entry.price_list_rate === 'number'
        ? entry.price_list_rate
        : parseFloat(entry.price_list_rate),
      currency: entry.currency || ''
    }
  } catch (error) {
    console.error('Error fetching item price rate:', error)
    return null
  }
}

/**
 * Fetches the available quantity for an item across warehouses
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {string} itemName - Full item code/name (usually includes company suffix)
 * @returns {Promise<number|null>} Available quantity or null if unavailable
 */
export const fetchItemAvailableQty = async (fetchWithAuth, itemName) => {
  if (!itemName) {
    return null
  }

  try {
    const response = await fetchWithAuth(`/api/inventory/items/${encodeURIComponent(itemName)}?fields=available_qty`)
    if (!response.ok) {
      console.warn('fetchItemAvailableQty request failed', response.status)
      return null
    }

    const data = await response.json()
    if (!data.success || !data.data) {
      return null
    }

    const qty = data.data.available_qty
    if (qty == null) {
      return null
    }

    const parsed = typeof qty === 'number' ? qty : parseFloat(qty)
    return isNaN(parsed) ? null : parsed
  } catch (error) {
    console.error('Error fetching item available quantity:', error)
    return null
  }
}

/**
 * Fetches the next confirmed number for a talonario and letra
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {string} talonarioName - Talonario name
 * @param {string} letra - Letter (A, B, etc.)
 * @param {string} tipoComprobante - Tipo comprobante code (001, etc.)
 * @param {string} excludeName - Name to exclude from search
 * @returns {Promise<number|null>} Next number or null if error
 */
export const fetchNextConfirmedNumber = async (fetchWithAuth, talonarioName, letra, tipoComprobante, excludeName) => {
  try {
    const params = new URLSearchParams({
      talonario_name: talonarioName,
      letra: letra,
      tipo_comprobante: tipoComprobante || '',
      exclude_name: excludeName || ''
    })

    const response = await fetchWithAuth(`/api/comprobantes/next-confirmed-number?${params}`)
    if (!response.ok) {
      console.error('Error fetching next confirmed number:', response.status)
      return null
    }

    const data = await response.json()
    if (!data.success || !data.data) {
      console.error('Invalid response for next confirmed number:', data)
      return null
    }

    return data.data.next_confirmed_number
  } catch (error) {
    console.error('Error fetching next confirmed number:', error)
    return null
  }
}
