// ============================================
// API FUNCTIONS PARA ITEM IMPORT
// ============================================

import API_ROUTES from '../../../apiRoutes'
import { extractItemDataFromResponse, resolveWarehouseValue } from './itemImportHelpers'
import { fetchWarehouses as fetchWarehousesCommon } from '../../../apiUtils'

// ========================================
// FETCH ITEM GROUPS
// ========================================
export const fetchItemGroups = async (fetchWithAuth) => {
  try {
  const response = await fetchWithAuth(`${API_ROUTES.inventory}/item-groups?kind=leafs`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        const leafGroups = data.data.filter(group => !group.is_group)
        return leafGroups
      }
    }
  } catch (error) {
    console.error('Error fetching item groups:', error)
  }
  return []
}

// ========================================
// FETCH UOMS
// ========================================
export const fetchUoms = async (fetchWithAuth) => {
  try {
    const response = await fetchWithAuth(`${API_ROUTES.inventory}/uoms`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        return data.data || []
      }
    }
  } catch (error) {
    console.error('Error fetching UOMs:', error)
  }
  return []
}

// ========================================
// FETCH WAREHOUSES
// ========================================
export const fetchWarehouses = async (fetchWithAuth, activeCompany) => {
  return fetchWarehousesCommon(fetchWithAuth, activeCompany)
}

// ========================================
// FETCH AVAILABLE ACCOUNTS
// ========================================
export const fetchAvailableAccounts = async (fetchWithAuth) => {
  try {
    const response = await fetchWithAuth(API_ROUTES.accounts)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        const expenseAccounts = data.data.filter(account => 
          account.root_type === 'Expense' && !account.is_group
        )
        const incomeAccounts = data.data.filter(account => 
          account.root_type === 'Income' && !account.is_group
        )
        return { expenseAccounts, incomeAccounts }
      }
    }
  } catch (error) {
    console.error('Error fetching accounts:', error)
  }
  return { expenseAccounts: [], incomeAccounts: [] }
}

// ========================================
// FETCH AVAILABLE PURCHASE PRICE LISTS
// ========================================
export const fetchAvailablePurchasePriceLists = async (fetchWithAuth) => {
  try {
    const response = await fetchWithAuth(API_ROUTES.purchasePriceLists)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        return data.data
      } else {
        console.error('Error fetching purchase price lists:', data.message)
      }
    } else {
      console.error('Error response fetching purchase price lists:', response.status)
    }
  } catch (error) {
    console.error('Error fetching purchase price lists:', error)
  }
  return []
}

// ========================================
// FETCH PURCHASE PRICE LIST DETAILS
// ========================================
export const fetchPurchasePriceListDetails = async (fetchWithAuth, priceListName) => {
  if (!priceListName) return null

  try {
    const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListPrices}${encodeURIComponent(priceListName)}/prices`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        return data.data
      } else {
        console.error('Error fetching price list details:', data.message)
      }
    } else {
      console.error('Error response fetching price list details:', response.status)
    }
  } catch (error) {
    console.error('Error fetching price list details:', error)
  }
  return null
}

// ========================================
// FETCH PURCHASE PRICE LIST INFO
// ========================================
export const fetchPurchasePriceListInfo = async (fetchWithAuth, priceListName) => {
  if (!priceListName) return null

  try {
    const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListPrices}${encodeURIComponent(priceListName)}/prices`)
    if (response.ok) {
      const data = await response.json()
      if (data.success && data.data) {
        const { prices, ...priceListInfo } = data.data
        return priceListInfo
      } else {
        console.error('Error fetching price list info:', data.message)
      }
    } else {
      console.error('Error response fetching price list info:', response.status)
    }
  } catch (error) {
    console.error('Error fetching price list info:', error)
  }
  return null
}

// ========================================
// CREATE NEW UOM
// ========================================
export const createNewUom = async (fetchWithAuth, uomName, showNotification) => {
  if (!uomName.trim()) return null
  
  try {
    const response = await fetchWithAuth(`${API_ROUTES.inventory}/uoms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uom_name: uomName.trim() })
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        showNotification(`Unidad "${uomName}" creada exitosamente`, 'success')
        return data.data
      } else {
        showNotification(data.message || 'Error al crear la unidad', 'error')
      }
    } else {
      showNotification('Error al crear la unidad', 'error')
    }
  } catch (error) {
    console.error('Error creating UOM:', error)
    showNotification('Error al crear la unidad', 'error')
  }
  return null
}

// ========================================
// FETCH ITEM BY CODE
// ========================================
export const fetchItemByCode = async (fetchWithAuth, itemCode, importMode, selectedWarehouse, activeCompany, warehouses) => {
  try {
    let url = `${API_ROUTES.inventory}/items/${encodeURIComponent(itemCode)}`
    
    if (importMode === 'stock' && selectedWarehouse) {
      url += `?warehouse=${encodeURIComponent(selectedWarehouse)}`
    }
    
    const response = await fetchWithAuth(url)
    if (response.ok) {
      const data = await response.json()
      if (data.success && data.data) {
        return extractItemDataFromResponse(data.data, importMode, selectedWarehouse, activeCompany, warehouses)
      }
    }
    return null
  } catch (error) {
    console.error('Error fetching item by code:', error)
    return null
  }
}

// ========================================
// LOAD ALL ITEMS (para búsqueda local)
// ========================================
export const loadAllItems = async (fetchWithAuth, activeCompany, importMode, selectedWarehouse) => {
  try {
    let url = `${API_ROUTES.inventory}/items?company=${activeCompany}`
    
    if (importMode === 'stock' && selectedWarehouse) {
      url += `&warehouse=${encodeURIComponent(selectedWarehouse)}`
    }
    
    const response = await fetchWithAuth(url)
    
    if (response.ok) {
      const data = await response.json()
      if (data.success && data.data) {
        const itemsMap = new Map()
        data.data.forEach(item => {
          itemsMap.set(item.item_code, item)
        })
        
        return itemsMap
      } else {
        console.warn('ItemImport: No items data received')
      }
    } else {
      console.error('ItemImport: Failed to load items for local search')
    }
  } catch (error) {
    console.error('Error loading all items:', error)
  }
  return new Map()
}

// ========================================
// LOAD EXISTING ITEMS (para update/stock modes)
// ========================================
export const loadExistingItems = async (
  fetchWithAuth, 
  activeCompany, 
  importMode, 
  selectedWarehouse, 
  warehouses,
  showNotification
) => {
  try {
    showNotification('Cargando items existentes...', 'info')
    
    let url = `${API_ROUTES.inventory}/items?company=${activeCompany}&include_taxes=1`
    
    if (importMode === 'stock' && selectedWarehouse) {
      url += `&warehouse=${encodeURIComponent(selectedWarehouse)}`
    }
    
    const response = await fetchWithAuth(url)
    
    if (response.ok) {
      const data = await response.json()
      if (data.success && data.data) {
        data.data.slice(0, 10).forEach((item, idx) => {
          
          if (item.item_defaults && Array.isArray(item.item_defaults) && item.item_defaults.length > 0) {
            let match = null
            if (activeCompany) {
              match = item.item_defaults.find(d => d.company === activeCompany)
            }
            const firstDefault = match || item.item_defaults[0]
          } else {
            console.debug(`  - No item_defaults found`)
          }
        })
        
        const itemsRows = data.data.map((item, index) => {
          let platform = ''
          let url = ''
          if (item.custom_product_links && Array.isArray(item.custom_product_links) && item.custom_product_links.length > 0) {
            const firstLink = item.custom_product_links[0]
            platform = firstLink.platform || ''
            url = firstLink.url || ''
          }

          let default_warehouse = ''
          if (item.item_defaults && Array.isArray(item.item_defaults) && item.item_defaults.length > 0) {
            let match = null
            if (activeCompany) {
              match = item.item_defaults.find(d => d.company === activeCompany)
            }
            const firstDefault = match || item.item_defaults[0]
            const dv = firstDefault.default_warehouse
            if (dv && typeof dv === 'object') {
              default_warehouse = (dv.name || dv.value || '')
            } else if (dv) {
              default_warehouse = String(dv)
            }
            if (default_warehouse) default_warehouse = default_warehouse.trim()
            
            // Resolver el warehouse name para asegurar que sea el name completo
            if (default_warehouse && warehouses && Array.isArray(warehouses)) {
              const resolved = resolveWarehouseValue(default_warehouse, warehouses)
              if (resolved) {
                // Encontrar el warehouse correspondiente para obtener el display name limpio
                const warehouseObj = warehouses.find(w => w.name === resolved)
                if (warehouseObj) {
                  default_warehouse = warehouseObj.warehouse_name || resolved
                } else {
                  default_warehouse = resolved
                }
              }
            }

          }


          if (importMode === 'stock') {
            let currentStock = 0
            if (selectedWarehouse && item.stock_by_warehouse) {
              const warehouseStock = item.stock_by_warehouse.find(ws => ws.warehouse === selectedWarehouse)
              if (warehouseStock) {
                currentStock = warehouseStock.actual_qty || 0
              }
            } else {
              currentStock = item.available_qty || 0
            }

            // Convertir iva_rate a iva_template (string) para compatibilidad con el selector
            const ivaRateStr = item.iva_rate != null ? String(item.iva_rate) : ''

            return {
              id: index + 1,
              selected: false,
              item_code: item.item_code || '',
              item_name: item.item_name || '',
              current_stock: currentStock,
              new_stock: '',
              warehouse: selectedWarehouse || default_warehouse,
              default_warehouse: default_warehouse,
              valuation_rate: item.valuation_rate || item.standard_rate || '',
              original_valuation_rate: item.valuation_rate || item.standard_rate || '',
              iva_template: ivaRateStr,
              delete_selection: false,
              hasChanges: false,
              errors: {}
            }
          } else {
            // Convertir iva_rate a iva_template (string) para compatibilidad con el selector
            const ivaRateStr = item.iva_rate != null ? String(item.iva_rate) : ''

            const baseRow = {
              id: index + 1,
              selected: false,
              item_code: item.item_code || '',
              item_name: item.item_name || '',
              description: item.description || '',
              stock_uom: item.stock_uom || 'Unit',
              is_stock_item: item.is_stock_item ? 'Producto' : 'Servicio',
              item_group: item.item_group || '',
              brand: (typeof item.brand === 'object' ? item.brand?.name : item.brand) || '',
              default_warehouse: default_warehouse,
              warehouse: default_warehouse,
              platform: platform,
              url: url,
              docstatus: item.docstatus || 0,
              iva_template: ivaRateStr,
              delete_selection: false,
              hasChanges: false,
              errors: {}
            }

            return {
              ...baseRow,
              original_snapshot: { ...baseRow }
            }
          }
        })

        showNotification(`${itemsRows.length} items cargados para actualizar`, 'success')
        return itemsRows
      } else {
        showNotification('No se pudieron cargar los items existentes', 'error')
      }
    } else {
      showNotification('Error al cargar items existentes', 'error')
    }
  } catch (error) {
    console.error('Error loading existing items:', error)
    showNotification('Error al cargar items existentes', 'error')
  }
  return []
}

// ========================================
// RECOGNIZE SKUS (Backend-based bulk recognition)
// ========================================
export const recognizeSkus = async (
  fetchWithAuth,
  skus,
  activeCompany,
  importMode = 'insert',
  showNotification = null
) => {
  if (!skus || skus.length === 0) {
    return { recognized: new Map(), unrecognized: [] }
  }

  console.debug(`API: recognizeSkus called for ${skus.length} skus (unique will be filtered) mode=${importMode} company=${activeCompany}`)

  // Filtrar SKUs válidos y únicos
  const uniqueSkus = [...new Set(skus.filter(sku => sku && typeof sku === 'string' && sku.trim()))]
  if (uniqueSkus.length === 0) {
    return { recognized: new Map(), unrecognized: [] }
  }


  try {
    const response = await fetchWithAuth(`${API_ROUTES.inventory}/items/recognize-skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: activeCompany,
        skus: uniqueSkus,
        mode: importMode
      })
    })

    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        const recognizedMap = new Map()
        const recognizedItems = data.data.recognized_items || {}
        
        // Convertir el objeto de items reconocidos a Map
        Object.entries(recognizedItems).forEach(([sku, item]) => {
          recognizedMap.set(sku, item)
        })

        const unrecognizedSkus = data.data.unrecognized_skus || []


        if (showNotification) {
          if (recognizedMap.size > 0) {
            showNotification(
              `${recognizedMap.size} de ${uniqueSkus.length} SKUs reconocidos exitosamente`,
              'success'
            )
          }
          if (unrecognizedSkus.length > 0) {
            showNotification(
              `${unrecognizedSkus.length} SKUs no encontrados en el inventario`,
              'warning'
            )
          }
        }

        return {
          recognized: recognizedMap,
          unrecognized: unrecognizedSkus,
          companyAbbr: data.data.company_abbr
        }
      } else {
        console.error('recognizeSkus: API returned error:', data.message)
        if (showNotification) {
          showNotification(data.message || 'Error al reconocer SKUs', 'error')
        }
      }
    } else {
      console.error('recognizeSkus: HTTP error:', response.status)
      if (showNotification) {
        showNotification('Error al reconocer SKUs en el servidor', 'error')
      }
    }
  } catch (error) {
    console.error('recognizeSkus: Exception:', error)
    if (showNotification) {
      showNotification('Error al reconocer SKUs', 'error')
    }
  }

  return { recognized: new Map(), unrecognized: uniqueSkus }
}

// ========================================
// BULK FETCH ITEMS BY CODES
// ========================================
export const bulkFetchItemsByCodes = async (
  fetchWithAuth,
  itemCodes,
  allItems,
  activeCompany,
  importMode,
  selectedWarehouse,
  warehouses
) => {
  if (!itemCodes || itemCodes.length === 0) return new Map()

  console.debug(`API: bulkFetchItemsByCodes called for ${itemCodes.length} codes (unique will be filtered) mode=${importMode} company=${activeCompany}`)

  const uniqueCodes = [...new Set(itemCodes.filter(code => code && code.trim()))]
  if (uniqueCodes.length === 0) return new Map()

  const results = new Map()

  // Primero buscar localmente
  uniqueCodes.forEach(code => {
    let localItem = allItems.get(code)
    if (localItem) {
      // En modo insert, solo necesitamos saber que existe, no cargar todos los datos
      if (importMode === 'insert') {
        results.set(code, { exists: true })
      } else {
        results.set(code, extractItemDataFromResponse(localItem, importMode, selectedWarehouse, activeCompany, warehouses))
      }
      return
    }
    
    const codeWithAbbr = `${code}-MS`
    localItem = allItems.get(codeWithAbbr)
    if (localItem) {
      // En modo insert, solo necesitamos saber que existe, no cargar todos los datos
      if (importMode === 'insert') {
        results.set(code, { exists: true })
      } else {
        results.set(code, extractItemDataFromResponse(localItem, importMode, selectedWarehouse, activeCompany, warehouses))
      }
      return
    }
  })

  // Para los no encontrados, buscar en API
  const codesToFetch = uniqueCodes.filter(code => !results.has(code))
  
  if (codesToFetch.length > 0) {
    try {
      // OPTIMIZACIÓN: Para evitar URLs demasiado largas (error 414),
      // usar el endpoint optimizado bulk-fetch que consulta todo el inventario
      // y filtra en memoria en el backend
      
      // Dividir en lotes si es necesario (para no sobrecargar el payload)
      const BATCH_SIZE = 100
      
      for (let i = 0; i < codesToFetch.length; i += BATCH_SIZE) {
        const batchCodes = codesToFetch.slice(i, i + BATCH_SIZE)
        
        
        let params = new URLSearchParams()
        params.append('company', activeCompany || '')
        
        if (importMode === 'stock' && selectedWarehouse) {
          params.append('warehouse', selectedWarehouse)
        }
        
        // OPTIMIZACIÓN: Usar fetch targeted para lotes pequeños (<= 100 códigos)
        // Esto evita fetchear todo el inventario cuando solo necesitamos pocos items
        const isTargeted = batchCodes.length <= 100
        params.append('targeted', isTargeted.toString())
        
        // Agregar códigos al query string
        batchCodes.forEach(code => params.append('codes', code))

        const response = await fetchWithAuth(`${API_ROUTES.inventory}/items/bulk-fetch?${params}`)
        
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            // data.data es un array de items
            data.data.forEach(item => {
              if (item.item_code) {
                // Normalize returned item_code which may include company abbr: 'CODE - ABC'
                const rawCode = (item.item_code || '').toString()
                const strippedCode = rawCode.split(' - ')[0]
                const originalCode = batchCodes.find(code => item.item_code === code || strippedCode === code)
                if (originalCode) {
                  // En modo insert, solo necesitamos saber que existe, no cargar todos los datos
                  if (importMode === 'insert') {
                    results.set(originalCode, { exists: true })
                  } else {
                    results.set(originalCode, extractItemDataFromResponse(item, importMode, selectedWarehouse, activeCompany, warehouses))
                  }
                }
              }
            })
          }
        } else {
          console.error(`Error in bulk fetch batch ${Math.floor(i / BATCH_SIZE) + 1}:`, response.status)
        }
      }
    } catch (error) {
      console.error('Error in bulk fetch:', error)
    }
  }

  return results
}
