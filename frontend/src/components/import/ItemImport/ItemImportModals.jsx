import React from 'react'
import Modal from '../../Modal'

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
export const extractItemDataFromResponse = (item, importMode, selectedWarehouse, activeCompany) => {
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
    if (dv && typeof dv === 'object') {
      default_warehouse = (dv.name || dv.value || '')
    } else if (dv) {
      default_warehouse = String(dv)
    }
    if (default_warehouse) default_warehouse = default_warehouse.trim()
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
      current_stock: currentStock,
      new_stock: '',
      warehouse: selectedWarehouse || default_warehouse,
      default_warehouse: default_warehouse,
      valuation_rate: item.valuation_rate || item.standard_rate || '',
      original_valuation_rate: item.valuation_rate || item.standard_rate || '',
      docstatus: item.docstatus || 0
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
      docstatus: item.docstatus || 0
    }
  }
}

// Convertir items para backend (is_stock_item de string a número)
export const convertItemsForBackend = (items) => {
  return items.map(item => ({
    ...item,
    is_stock_item: item.is_stock_item === 'Producto' ? 1 : item.is_stock_item === 'Servicio' ? 0 : item.is_stock_item
  }))
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
export const getValidRowsForImport = (rows) => {
  const duplicateCodes = getDuplicateCodes(rows)
  
  return rows.filter(row => {
    const hasRequiredFields = row.item_code && row.item_name && row.new_stock && row.valuation_rate
    const hasNoDuplicates = !duplicateCodes.includes(row.item_code)
    return hasRequiredFields && hasNoDuplicates
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

export const PatternModal = ({ isOpen, onClose, patternConfig, setPatternConfig, columns, applyPattern, addingUom, position }) => {
  if (!isOpen) return null
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Generar Patrón" initialPosition={position}>
      <div>
        {/* Pattern config form */}
        <label>Prefijo:</label>
        <input
          type="text"
          value={patternConfig.prefix || ''}
          onChange={(e) => setPatternConfig(prev => ({ ...prev, prefix: e.target.value }))}
        />
        <label>Número inicial:</label>
        <input
          type="number"
          value={patternConfig.startNumber || 1}
          onChange={(e) => setPatternConfig(prev => ({ ...prev, startNumber: parseInt(e.target.value) }))}
        />
        <label>Columna:</label>
        <select value={patternConfig.column || ''} onChange={(e) => setPatternConfig(prev => ({ ...prev, column: e.target.value }))}>
          <option value="">Seleccionar columna</option>
          {columns.filter(col => col.data === 'item_code').map(col => (
            <option key={col.data} value={col.data}>{col.header}</option>
          ))}
        </select>
        <button onClick={applyPattern} disabled={addingUom}>Aplicar Patrón</button>
      </div>
    </Modal>
  )
}

export const DefaultValueModal = ({ isOpen, onClose, defaultConfig, setDefaultConfig, columns, uoms, warehouses, platformOptions, createNewUom, addingUom, applyDefaultValue, getFilteredRows, rows }) => {
  if (!isOpen) return null
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Aplicar Valor por Defecto">
      <div>
        <label>Columna:</label>
        <select value={defaultConfig.column || ''} onChange={(e) => setDefaultConfig(prev => ({ ...prev, column: e.target.value }))}>
          <option value="">Seleccionar columna</option>
          {columns.map(col => (
            <option key={col.data} value={col.data}>{col.header}</option>
          ))}
        </select>
        <label>Valor:</label>
        <input
          type="text"
          value={defaultConfig.value || ''}
          onChange={(e) => setDefaultConfig(prev => ({ ...prev, value: e.target.value }))}
        />
        <button onClick={applyDefaultValue}>Aplicar Valor</button>
      </div>
    </Modal>
  )
}

export const DeleteConfirmModal = ({ isOpen, selectedRows, visibleRows, onCancel, onConfirm }) => {
  if (!isOpen) return null
  
  // Calcular cuántas de las filas seleccionadas están visibles
  const visibleSelectedCount = visibleRows.filter(row => selectedRows.has(row.id)).length
  
  return (
    <div className="confirm-modal-overlay">
      <div className="confirm-modal-content">
        <div className="confirm-modal-header">
          <div className="confirm-modal-title-section">
            <span className="text-2xl">⚠️</span>
            <h3 className="confirm-modal-title">Confirmar Eliminación Definitiva</h3>
          </div>
          <button onClick={onCancel} className="confirm-modal-close-btn">×</button>
        </div>
        <div className="confirm-modal-body">
          <p className="confirm-modal-message text-red-600 font-semibold mb-3">
            ATENCIÓN: Esta acción no se puede deshacer
          </p>
          <p className="confirm-modal-message mb-2">
            ¿Eliminar definitivamente {visibleSelectedCount} item(s) del sistema?
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            Los items serán eliminados permanentemente de la base de datos.
            Si solo quieres quitarlos de esta edición, simplemente borra la fila
            sin seleccionarlos.
          </p>
        </div>
        <div className="confirm-modal-footer">
          <button onClick={onCancel} className="confirm-modal-btn-cancel">
            Cancelar
          </button>
          <button onClick={onConfirm} className="confirm-modal-btn-confirm error">
            Eliminar Definitivamente
          </button>
        </div>
      </div>
    </div>
  )
}

export const CostModal = ({ isOpen, onClose, selectedPriceLists, setSelectedPriceLists, availablePriceLists, selectedPriceListInfo, applyingCosts, onApplyCosts, showNotification }) => {
  if (!isOpen) return null

  const allListNames = (availablePriceLists || []).map(l => l.name).filter(Boolean)
  const selectedSet = new Set(selectedPriceLists || [])
  const allSelected = allListNames.length > 0 && allListNames.every(n => selectedSet.has(n))

  const toggleAll = (checked) => {
    setSelectedPriceLists(checked ? allListNames : [])
  }

  const toggleOne = (priceListName, checked) => {
    setSelectedPriceLists(prev => {
      const next = new Set(prev || [])
      if (checked) next.add(priceListName)
      else next.delete(priceListName)
      return Array.from(next)
    })
  }
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Aplicar Costos desde Lista de Precios" size="default">
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Selecciona una o mas listas de precios de compra para aplicar los costos a los items visibles en la tabla.
          </p>
        </div>

        <div>
          <label className="block text-sm font-black text-gray-700 mb-1">
            Lista de Precios de Compra
          </label>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={allListNames.length === 0}
                />
                Seleccionar todas
              </label>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">
                  {(selectedPriceLists || []).length} seleccionada(s)
                </span>
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (v) {
                      toggleOne(v, !selectedSet.has(v))
                      e.target.value = ''
                    }
                  }}
                  className="px-2 py-1 border border-gray-300 rounded-md text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={availablePriceLists.length === 0}
                >
                  <option value="">Agregar/Quitar...</option>
                  {availablePriceLists.map(list => (
                    <option key={list.name} value={list.name}>
                      {selectedSet.has(list.name) ? '[x] ' : ''}{list.price_list_name} ({list.currency})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto">
              {availablePriceLists.map(list => {
                const checked = selectedSet.has(list.name)
                return (
                  <label
                    key={list.name}
                    className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={checked}
                        onChange={(e) => toggleOne(list.name, e.target.checked)}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {list.price_list_name}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {list.name}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 whitespace-nowrap">
                      {list.currency}
                    </div>
                  </label>
                )
              })}
              {availablePriceLists.length === 0 && (
                <div className="px-3 py-3 text-xs text-amber-700 bg-amber-50">
                  No hay listas de precios de compra disponibles para esta compania
                </div>
              )}
            </div>
          </div>
        </div>

        {selectedPriceListInfo && (selectedPriceLists || []).length === 1 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <h4 className="text-sm font-black text-blue-900 mb-2">Información de la Lista</h4>
            <div className="text-xs text-blue-800 space-y-1">
              <div className="flex justify-between">
                <span className="font-medium">Moneda:</span>
                <span>{selectedPriceListInfo.price_list?.currency || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Tipo de Cotización:</span>
                <span>
                  {selectedPriceListInfo.price_list?.custom_exchange_rate === -1 
                    ? 'Cotización General' 
                    : `Cotización Específica (${selectedPriceListInfo.price_list?.custom_exchange_rate || 'N/A'})`
                  }
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={onApplyCosts}
          disabled={applyingCosts || !(selectedPriceLists || []).length}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {applyingCosts ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Aplicando...
            </span>
          ) : (
            'Aplicar Costos'
          )}
        </button>
      </div>
    </Modal>
  )
}

export const BulkUpdateModal = ({ isOpen, onClose, bulkUpdateConfig, setBulkUpdateConfig, onApplyBulkUpdate, applyingBulkUpdate, visibleItemsCount }) => {
  if (!isOpen) return null

  const fieldOptions = [
    { value: 'item_group', label: 'Grupo de Items' },
    { value: 'stock_uom', label: 'Unidad de Medida' },
    { value: 'safety_stock', label: 'Stock de Seguridad' },
    { value: 'lead_time_days', label: 'Días de Entrega' },
    { value: 'min_order_qty', label: 'Cantidad Mínima de Pedido' },
    { value: 'max_discount', label: 'Descuento Máximo (%)' },
    { value: 'is_sales_item', label: 'Es Item de Venta (1=Sí, 0=No)' },
    { value: 'is_purchase_item', label: 'Es Item de Compra (1=Sí, 0=No)' },
    { value: 'grant_commission', label: 'Otorga Comisión (1=Sí, 0=No)' },
    { value: 'brand', label: 'Marca' },
    { value: 'custom_description_type', label: 'Tipo de Descripción' }
  ]

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Actualizar Campo Masivo">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Se actualizarán <strong>{visibleItemsCount}</strong> items visibles en la tabla.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Campo a actualizar:
          </label>
          <select
            value={bulkUpdateConfig.field || ''}
            onChange={(e) => setBulkUpdateConfig(prev => ({ ...prev, field: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Seleccionar campo</option>
            {fieldOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Nuevo valor:
          </label>
          <input
            type="text"
            value={bulkUpdateConfig.value || ''}
            onChange={(e) => setBulkUpdateConfig(prev => ({ ...prev, value: e.target.value }))}
            placeholder="Ingrese el nuevo valor"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onApplyBulkUpdate}
            disabled={applyingBulkUpdate || !bulkUpdateConfig.field || !bulkUpdateConfig.value}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {applyingBulkUpdate ? 'Actualizando...' : 'Actualizar Campo'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
