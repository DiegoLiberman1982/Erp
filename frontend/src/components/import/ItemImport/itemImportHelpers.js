// ============================================
// HELPER FUNCTIONS PARA ITEM IMPORT
// ============================================

export const platformOptions = [
  { value: 'mercadolibre', label: 'Mercado Libre' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'ebay', label: 'eBay' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'woocommerce', label: 'WooCommerce' },
  { value: 'tienda_nube', label: 'Tienda Nube' },
  { value: 'otro', label: 'Otro' }
]

// Remover sigla de compañía del nombre del warehouse
export const removeCompanyAbbr = (warehouseName, companyAbbr) => {
  if (!warehouseName || !companyAbbr) return warehouseName
  
  const suffix = ` - ${companyAbbr}`
  if (warehouseName.endsWith(suffix)) {
    return warehouseName.slice(0, -suffix.length)
  }
  
  return warehouseName
}

// Convertir número a secuencia alfabética (1=A, 2=B, 27=AA, etc.)
export const numberToAlpha = (num) => {
  let result = ''
  while (num > 0) {
    const remainder = (num - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    num = Math.floor((num - 1) / 26)
  }
  return result
}

// Validar valor contra lista permitida
export const validateValue = (value, column, itemGroups, uoms) => {
  if (!value) return { valid: true, normalized: value }
  
  if (!column.validationSource) return { valid: true, normalized: value }
  
  const valueStr = String(value).trim().toLowerCase()
  
  if (column.validationSource === 'itemGroups') {
    const match = itemGroups.find(g => 
      g.name.toLowerCase() === valueStr || 
      g.item_group_name.toLowerCase() === valueStr
    )
    return match 
      ? { valid: true, normalized: match.name }
      : { valid: false, message: 'Grupo no válido. Usa: ' + itemGroups.slice(0, 3).map(g => g.item_group_name).join(', ') + '...' }
  }
  
  if (column.validationSource === 'uoms') {
    const match = uoms.find(u => 
      u.name.toLowerCase() === valueStr || 
      u.uom_name.toLowerCase() === valueStr
    )
    return match 
      ? { valid: true, normalized: match.name }
      : { valid: false, message: 'UOM no válida. Usa: ' + uoms.slice(0, 5).map(u => u.uom_name).join(', ') + '...' }
  }
  
  if (column.validationSource === 'itemType') {
    if (['producto', 'product', '1', 1].includes(valueStr)) {
      return { valid: true, normalized: 1 }
    }
    if (['servicio', 'service', '0', 0].includes(valueStr)) {
      return { valid: true, normalized: 0 }
    }
    return { valid: false, message: 'Tipo no válido. Usa: Producto, Servicio, 1 o 0' }
  }
  
  return { valid: true, normalized: value }
}

// Resolver un valor de warehouse (puede venir como name o como warehouse_name)
export const resolveWarehouseValue = (raw, warehouses) => {
  if (!raw) return ''
  const r = String(raw).trim()
  
  // Buscar por name exacto
  const byName = (warehouses || []).find(w => (w.name || '').toString() === r)
  if (byName) return byName.name
  
  // Buscar por warehouse_name (label)
  const byLabel = (warehouses || []).find(w => (w.warehouse_name || '').toString() === r)
  if (byLabel) return byLabel.name
  
  // Intentar comparación case-insensitive / trim
  const lower = r.toLowerCase()
  const byNameCi = (warehouses || []).find(w => (w.name || '').toString().toLowerCase() === lower)
  if (byNameCi) return byNameCi.name
  
  const byLabelCi = (warehouses || []).find(w => (w.warehouse_name || '').toString().toLowerCase() === lower)
  if (byLabelCi) return byLabelCi.name
  
  return ''
}

// Parsear línea CSV correctamente
export const parseCsvLine = (line) => {
  const result = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''))
      current = ''
    } else {
      current += char
    }
  }
  
  result.push(current.trim().replace(/^"|"$/g, ''))
  return result
}

// Extraer datos de item desde respuesta de API
export const extractItemDataFromResponse = (item, importMode, selectedWarehouse, activeCompany, warehouses) => {
  // NOTE: extractItemDataFromResponse is used to hydrate rows from backend API.
  // Avoid noisy console logs in production - keep logic silent unless an explicit debug flag is set

  // Obtener tasa de IVA: priorizar iva_rate del backend (ya calculado)
  // Si no está, intentar extraer del template o taxes
  let ivaRate = item.iva_rate
  let ivaTemplate = item.item_tax_template || ''
  
  if (ivaRate == null && Array.isArray(item.taxes)) {
    for (const taxRow of item.taxes) {
      if (taxRow && typeof taxRow === 'object') {
        if (taxRow.item_tax_template) {
          ivaTemplate = taxRow.item_tax_template
          break
        }
        if (taxRow.tax_type) {
          ivaTemplate = taxRow.tax_type
        }
      }
    }
  }
  
  // Convertir iva_rate a string para el selector (que usa strings como value)
  const ivaRateStr = ivaRate != null ? String(ivaRate) : ''

  // Extraer platform y url de custom_product_links
  let platform = ''
  let url = ''
  if (item.custom_product_links && Array.isArray(item.custom_product_links) && item.custom_product_links.length > 0) {
    const firstLink = item.custom_product_links[0]
    platform = firstLink.platform || ''
    url = firstLink.url || ''
  }

  // Extraer default_warehouse de item_defaults
  let default_warehouse = ''
  if (item.item_defaults && Array.isArray(item.item_defaults) && item.item_defaults.length > 0) {
    let match = null
    if (activeCompany) {
      match = item.item_defaults.find(d => d.company === activeCompany)
    }
    const firstDefault = match || item.item_defaults[0]
    const dv = firstDefault.default_warehouse
    // no-op: debug logging removed
    
    if (dv && typeof dv === 'object') {
      default_warehouse = (dv.name || dv.value || '')
    } else if (dv) {
      default_warehouse = String(dv)
    }
    if (default_warehouse) default_warehouse = default_warehouse.trim()
    
    console.log(`  - default_warehouse after extraction: "${default_warehouse}"`)
    
    // Resolver el warehouse name para asegurar que sea el name completo
    if (default_warehouse && warehouses && Array.isArray(warehouses)) {
      const resolved = resolveWarehouseValue(default_warehouse, warehouses)
      
      if (resolved) {
        // Encontrar el warehouse correspondiente para obtener el display name limpio
        const warehouseObj = warehouses.find(w => w.name === resolved)
        console.log(`  - warehouseObj found:`, warehouseObj)
        
        if (warehouseObj) {
          default_warehouse = warehouseObj.warehouse_name || resolved
        } else {
          default_warehouse = resolved
        }
      }
    }
    
    // no-op: debug logging removed
  } else {
    // no-op: debug logging removed
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

    return {
      item_code: item.item_code || '',
      item_name: item.item_name || '',
      item_group: item.item_group || '',
      stock_uom: item.stock_uom || 'Unit',
      is_stock_item: item.is_stock_item ? 'Producto' : 'Servicio',
      brand: (typeof item.brand === 'object' ? item.brand?.name : item.brand) || '',
      current_stock: currentStock,
      new_stock: '',
      warehouse: selectedWarehouse || default_warehouse,
      default_warehouse: default_warehouse,
      valuation_rate: item.valuation_rate || item.standard_rate || '',
      original_valuation_rate: item.valuation_rate || item.standard_rate || '',
      docstatus: item.docstatus || 0,
      iva_template: ivaRateStr  // Ahora es la tasa numérica como string
    }
  } else {
    return {
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
      expense_account: item.expense_account || '',
      income_account: item.income_account || '',
      docstatus: item.docstatus || 0,
      iva_template: ivaRateStr  // Ahora es la tasa numérica como string
    }
  }
}

// Convertir items para backend (is_stock_item de string a número)
export const convertItemsForBackend = (items) => {
  return items.map(item => {
    const mapped = {
      ...item,
      is_stock_item: item.is_stock_item === 'Producto' ? 1 : item.is_stock_item === 'Servicio' ? 0 : item.is_stock_item
    }

    // Convert platform/url into custom_product_links expected by backend
    // backend accepts `custom_product_links` as JSON array of { platform, url }
    try {
      const platform = (item.platform || '').toString().trim()
      const url = (item.url || '').toString().trim()
      if ((platform && platform !== '') || (url && url !== '')) {
        mapped.custom_product_links = [{ platform: platform || '', url: url || '' }]
      }
    } catch (e) {
      // ignore mapping failure
    }

    return mapped
  })
}

// Detectar códigos duplicados
export const getDuplicateCodes = (rows) => {
  const codes = rows.map(r => r.item_code).filter(c => c)
  const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index)
  return [...new Set(duplicates)]
}

// Detectar filas sin código
export const getMissingCodes = (rows) => {
  return rows.filter(r => !r.item_code).map(r => r.id)
}

// Obtener filas válidas para importar
export const getValidRowsForImport = (rows, importMode = 'insert', filteringDuplicates = false) => {
  const duplicateCodes = filteringDuplicates ? [] : getDuplicateCodes(rows)
  
  return rows.filter(row => {
    let hasRequiredFields = false
    const hasIvaTemplate = row.iva_template && String(row.iva_template).trim() !== ''
    
    if (importMode === 'stock') {
      // Para stock: requiere item_code, item_name, new_stock, valuation_rate
      hasRequiredFields = row.item_code && row.item_name && row.new_stock !== undefined && row.new_stock !== '' && row.valuation_rate !== undefined && row.valuation_rate !== ''
    } else if (importMode === 'insert') {
      // Para insert: requiere item_code, item_name, item_group, stock_uom, is_stock_item no None
      hasRequiredFields = row.item_code && row.item_name && row.item_group && row.stock_uom && row.is_stock_item !== undefined && row.is_stock_item !== null && hasIvaTemplate
    } else if (importMode === 'update') {
      // Para update: requiere item_code y plantilla de IVA
      hasRequiredFields = row.item_code && hasIvaTemplate
    } else if (importMode === 'update-with-defaults') {
      // Para update-with-defaults: requiere item_code
      hasRequiredFields = row.item_code
    }
    
    const hasNoDuplicates = !duplicateCodes.includes(row.item_code)
    
    // NUEVO: En modo insert, excluir filas con errores de item_code (items existentes)
    const hasNoExistingItemError = importMode !== 'insert' || !row.errors?.item_code || !row.errors.item_code.includes('ya existe')
    
    return hasRequiredFields && hasNoDuplicates && hasNoExistingItemError
  })
}

// Obtener filas filtradas por filtros de columna
export const getFilteredRows = (rows, columnFilters) => {
  let filtered = [...rows]

  Object.keys(columnFilters).forEach(key => {
    const filterValue = columnFilters[key]
    if (filterValue) {
      filtered = filtered.filter(row => {
        const cellValue = String(row[key] || '')
        if (filterValue === '(vacío)') {
          return cellValue === ''
        }
        const cellValueLower = cellValue.toLowerCase()
        return cellValueLower.includes(filterValue.toLowerCase())
      })
    }
  })

  return filtered
}
