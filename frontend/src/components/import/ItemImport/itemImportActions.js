// ============================================
// ITEM IMPORT ACTION HANDLERS
// ============================================

import API_ROUTES from '../../../apiRoutes'
import {
  numberToAlpha,
  validateValue as validateValueHelper,
  resolveWarehouseValue as resolveWarehouseHelper,
  removeCompanyAbbr,
  getDuplicateCodes,
  getFilteredRows as getFilteredRowsHelper,
  getValidRowsForImport as getValidRowsHelper,
  convertItemsForBackend,
  parseCsvLine
} from './itemImportHelpers'
import * as ItemImportApi from './itemImportApi'
import { toggleSelectAllSet, countExistingItemErrors, countVisibleSelected } from '../../../handsometable/utils/tableFilters'

export const createEmptyRow = (id = 1) => ({
  id,
  selected: false,
  item_code: '',
  item_name: '',
  description: '',
  stock_uom: 'Unit',
  is_stock_item: 'Producto',
  item_group: '',
  opening_stock: '',
  brand: '',
  default_warehouse: '',
  warehouse: '',
  platform: '',
  url: '',
  expense_account: '',
  income_account: '',
  iva_template: '',
  delete_selection: false,
  hasChanges: false,
  errors: {}
})

export const addRow = ({ rows, setRows }) => {
  const nextId = rows.reduce((max, row) => Math.max(max, row.id || 0), 0) + 1
  const newRow = createEmptyRow(nextId)
  setRows([...rows, newRow])
}

export const applyDefaultValue = ({
  column,
  value,
  rows,
  setRows,
  columns,
  columnFilters,
  warehouses,
  itemGroups,
  uoms,
  setTableKey,
  showNotification,
  setShowDefaultModal
}) => {
  if (column === 'default_warehouse') {
    if (!Array.isArray(warehouses)) {
      showNotification('Error: Lista de almacenes no disponible', 'error')
      return
    }
    const validWarehouse = warehouses.find(w => w.name === value)
    if (!validWarehouse) {
      showNotification('Almac├⌐n seleccionado no v├ílido', 'error')
      return
    }
  }

  const columnDef = columns.find(c => c.key === column)
  const validation = validateValueHelper(
    value,
    columnDef || column,
    itemGroups,
    uoms
  )

  if (!validation.valid) {
    showNotification(validation.message, 'error')
    return
  }

  const visibleRows = rows // rows ya est├í filtrado por el iframe
  const visibleIds = new Set(visibleRows.map(r => r.id))

  const updatedRows = rows.map(row => {
    if (!visibleIds.has(row.id)) {
      return row
    }

    return {
      ...row,
      [column]: validation.normalized,
      errors: { ...row.errors, [column]: null },
      hasChanges: true
    }
  })

  setRows(updatedRows)
  setTableKey(prev => prev + 1)
  showNotification(
    `Valor "${value}" aplicado a ${visibleIds.size} fila(s)`,
    'success'
  )
  setShowDefaultModal(false)
}

export const copyColumnToClipboard = ({
  column,
  rows,
  columnFilters,
  showNotification
}) => {
  const visibleRows = rows // rows ya est├í filtrado por el iframe
  const values = visibleRows.map(row => row[column] || '').join('\n')
  navigator.clipboard.writeText(values)
    .then(() => {
      showNotification(`Columna copiada al portapapeles (${visibleRows.length} valores)`, 'success')
    })
    .catch(error => {
      console.error('Error copiando:', error)
      showNotification('Error al copiar columna', 'error')
    })
}

export const clearColumn = ({
  column,
  rows,
  setRows,
  columns,
  showNotification
}) => {
  const updatedRows = rows.map(row => ({
    ...row,
    [column]: '',
    errors: { ...row.errors, [column]: null }
  }))

  setRows(updatedRows)
  const columnLabel = columns.find(c => c.key === column)?.label || column
  showNotification(`Columna "${columnLabel}" limpiada`, 'success')
}

export const findAndFocusFirstProblem = ({ rows, columns, iframeRef, importMode }) => {
  const duplicates = getDuplicateCodes(rows)
  let target = null

  // NUEVO: Prioridad 1 - Items existentes en modo insert
  if (importMode === 'insert') {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.errors?.item_code && row.errors.item_code.includes('ya existe')) {
        target = { row: i, colKey: 'item_code', msg: row.errors.item_code }
        break
      }
    }
  }

  // Prioridad 2 - Duplicados en la tabla
  if (!target && duplicates.length > 0) {
    const code = duplicates[0]
    const rowIndex = rows.findIndex(row => row.item_code === code)
    if (rowIndex !== -1) {
      target = { row: rowIndex, colKey: 'item_code', msg: `Duplicado: c├│digo ${code}` }
    }
  }

  // Prioridad 3 - Otros errores
  if (!target) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row.errors) continue
      const errorKey = Object.keys(row.errors).find(key => row.errors[key])
      if (errorKey) {
        target = { row: i, colKey: errorKey, msg: row.errors[errorKey] }
        break
      }
    }
  }

  const iframeWindow = iframeRef?.current?.contentWindow

  if (!target) {
    if (iframeWindow) {
      iframeWindow.postMessage({ type: 'ht-clear-focus' }, '*')
    }
    return
  }

  const colIndex = columns.findIndex(col => col.key === target.colKey)
  if (iframeWindow) {
    iframeWindow.postMessage({
      type: 'ht-focus-cell',
      rowIndex: target.row,
      colIndex,
      message: target.msg
    }, '*')
  }
}

export const deleteRow = ({ id, rows, setRows, setSelectedRows }) => {
  setRows(rows.filter(row => row.id !== id))
  setSelectedRows(prev => {
    const next = new Set(prev)
    next.delete(id)
    return next
  })
}

export const toggleRowSelection = ({ rowId, setSelectedRows }) => {
  setSelectedRows(prev => {
    const next = new Set(prev)
    if (next.has(rowId)) {
      next.delete(rowId)
    } else {
      next.add(rowId)
    }
    return next
  })
}

export const toggleSelectAll = ({ rows, setSelectedRows }) => {
  // rows is expected to be the currently visible rows (iframe-filtered).
  // Delegate selection toggle logic to the shared utility so all tables behave the same.
  if (typeof setSelectedRows !== 'function') return
  setSelectedRows(prev => toggleSelectAllSet(prev, rows))
}

export const deleteSelectedItems = ({
  selectedRows,
  importMode,
  rows,
  setRows,
  setSelectedRows,
  setSelectAll,
  showNotification,
  setShowDeleteModal
}) => {
  // Contar solo las filas visibles que est├ín seleccionadas (delegado a helper)
  const visibleAndSelectedCount = countVisibleSelected(rows, selectedRows)
  
  if (visibleAndSelectedCount === 0) {
    showNotification('No hay filas seleccionadas en la vista actual', 'warning')
    return
  }

  if (importMode === 'insert') {
    // En modo insert, eliminar solo las filas visibles y seleccionadas
    const visibleIds = new Set(rows.map(r => r.id))
    const toDelete = new Set([...selectedRows].filter(id => visibleIds.has(id)))
    
    setRows(rows.filter(row => !toDelete.has(row.id)))
    
    // Limpiar selecciones de las filas eliminadas
    setSelectedRows(prev => {
      const next = new Set(prev)
      toDelete.forEach(id => next.delete(id))
      return next
    })
    
    setSelectAll(false)
    showNotification(`Se eliminaron ${toDelete.size} fila(s) de la tabla`, 'success')
  } else {
    setShowDeleteModal(true)
  }
}

export const executeDeleteSelectedItems = async ({
  selectedRows,
  rows,
  fetchWithAuth,
  setRows,
  setSelectedRows,
  showNotification
}) => {
  // Crear un Set con los IDs de las filas visibles
  const visibleIds = new Set(rows.map(r => r.id))
  
  // Filtrar selectedRows para incluir solo las filas visibles
  const visibleSelectedIds = [...selectedRows].filter(id => visibleIds.has(id))
  
  let deletedCount = 0
  let cancelledCount = 0
  const errors = []

  for (const rowId of visibleSelectedIds) {
    const row = rows.find(r => r.id === rowId)
    if (!row || !row.item_code) continue

    try {
      const encodedCode = encodeURIComponent(row.item_code)
      const itemUrl = `${API_ROUTES.inventory}/items/${encodedCode}`
      const checkResponse = await fetchWithAuth(itemUrl)

      if (checkResponse.ok) {
        const itemData = await checkResponse.json()
        if (itemData.success && itemData.data) {
          const docstatus = itemData.data.docstatus

          if (docstatus === 1) {
            const cancelResponse = await fetchWithAuth(itemUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ docstatus: 2 })
            })

            if (cancelResponse.ok) {
              cancelledCount++
            } else {
              const errorData = await cancelResponse.json().catch(() => ({ message: 'Error desconocido' }))
              const errorMsg = errorData.message || `Error cancelando ${row.item_code}`
              errors.push(errorMsg)
              console.error(`Error cancelando ${row.item_code}:`, errorData)
            }
          } else if (docstatus === 0) {
            const deleteResponse = await fetchWithAuth(itemUrl, { method: 'DELETE' })

            if (deleteResponse.ok) {
              deletedCount++
            } else {
              const errorData = await deleteResponse.json().catch(() => ({ message: 'Error desconocido' }))
              const errorMsg = errorData.message || `Error eliminando ${row.item_code}`
              errors.push(errorMsg)
              console.error(`Error eliminando ${row.item_code}:`, errorData)
            }
          }
        }
      }

      setRows(prev => prev.filter(r => r.id !== rowId))
    } catch (error) {
      console.error(`Error procesando ${row.item_code}:`, error)
      errors.push(`Error procesando ${row.item_code}: ${error.message}`)
    }
  }

  // Limpiar solo las selecciones de las filas procesadas
  setSelectedRows(prev => {
    const next = new Set(prev)
    visibleSelectedIds.forEach(id => next.delete(id))
    return next
  })

  let message = ''
  if (deletedCount > 0 && cancelledCount > 0) {
    message = `Eliminados: ${deletedCount}, Cancelados: ${cancelledCount}`
  } else if (deletedCount > 0) {
    message = `Eliminados: ${deletedCount} item(s)`
  } else if (cancelledCount > 0) {
    message = `Cancelados: ${cancelledCount} item(s)`
  }

  if (errors.length > 0) {
    // Si hay errores, mostrarlos individualmente para mejor claridad
    if (deletedCount === 0 && cancelledCount === 0) {
      // Si no se eliminó nada, mostrar solo los errores
      errors.forEach(err => showNotification(err, 'error'))
    } else {
      // Si se eliminaron algunos, mostrar resumen y errores
      showNotification(message, 'success')
      errors.forEach(err => showNotification(err, 'error'))
    }
  } else if (message) {
    showNotification(message, 'success')
  }
}

export const validateAllRows = ({ setRows, importMode }) => {
  setRows(currentRows => currentRows.map(row => {
    const errors = { ...row.errors }

    if (importMode !== 'stock') {
      const hasOpeningStock = row.opening_stock && parseFloat(row.opening_stock) > 0
      const hasWarehouse = row.default_warehouse

      if (hasOpeningStock && !hasWarehouse) {
        errors.default_warehouse = 'Warehouse es obligatorio cuando se especifica stock inicial'
      } else if (errors.default_warehouse === 'Warehouse es obligatorio cuando se especifica stock inicial') {
        errors.default_warehouse = null
      }

      const hasValuationRate = row.valuation_rate && parseFloat(row.valuation_rate) > 0
      if (hasOpeningStock && !hasValuationRate) {
        errors.valuation_rate = 'Precio de Costo recomendado cuando se especifica stock inicial (se usar├í el valor autom├ítico si no se especifica)'
      } else if (errors.valuation_rate === 'Precio de Costo recomendado cuando se especifica stock inicial (se usar├í el valor autom├ítico si no se especifica)') {
        errors.valuation_rate = null
      }
    }

    return { ...row, errors }
  }))
}

export const updateCell = async ({
  id,
  field,
  value,
  columns,
  itemGroups,
  uoms,
  warehouses,
  importMode,
  inputMode,
  allItems,
  fetchWithAuth,
  selectedWarehouse,
  activeCompany,
  setRows,
  setTableKey,
  fetchItemByCodeFromLocal,
  // When true, skip the immediate server/local fetch (used when paste handler will trigger bulk recognition)
  skipFetch = false
}) => {
  const columnDef = columns.find(c => c.key === field)
  console.debug(`ACTIONS: updateCell called id=${id} field=${field}`, { value, skipFetch })
  let finalValue = value
  let error = null

  if (columnDef && columnDef.type === 'validated-text' && value) {
    const validation = validateValueHelper(value, columnDef, itemGroups, uoms)
    if (!validation.valid) {
      error = validation.message
    } else {
      finalValue = validation.normalized
    }
  }

  if ((field === 'default_warehouse' || field === 'warehouse') && finalValue) {
    const resolved = resolveWarehouseHelper(finalValue, warehouses)
    if (resolved) {
      finalValue = resolved
    }
  }

  // Normalizar item_group y brand a may├║sculas para evitar duplicados
  if (field === 'item_group' && finalValue) {
    finalValue = finalValue.toUpperCase()
  }
  if (field === 'brand' && finalValue) {
    finalValue = finalValue.toUpperCase()
  }

  setRows(prevRows => prevRows.map(row => {
    if (row.id !== id) return row

    const updatedRow = {
      ...row,
      [field]: finalValue,
      errors: { ...row.errors, [field]: error },
      hasChanges: true
    }

    if (importMode === 'update-with-defaults') {
      const allowedFields = ['default_warehouse', 'expense_account', 'income_account']
      if (inputMode[importMode] === 'paste') {
        allowedFields.push('item_code')
      }
      updatedRow.hasChanges = allowedFields.includes(field) ? true : row.hasChanges
    }

    if (field === 'opening_stock' || field === 'default_warehouse') {
      const hasOpeningStock = field === 'opening_stock'
        ? finalValue && parseFloat(finalValue) > 0
        : updatedRow.opening_stock && parseFloat(updatedRow.opening_stock) > 0
      const hasWarehouse = field === 'default_warehouse' ? finalValue : updatedRow.default_warehouse

      if (hasOpeningStock && !hasWarehouse) {
        updatedRow.errors = { ...updatedRow.errors, default_warehouse: 'Warehouse es obligatorio cuando se especifica stock inicial' }
      } else if (field === 'default_warehouse' && updatedRow.errors.default_warehouse === 'Warehouse es obligatorio cuando se especifica stock inicial') {
        updatedRow.errors = { ...updatedRow.errors, default_warehouse: null }
      }
    }

    if (importMode !== 'stock' && (field === 'opening_stock' || field === 'valuation_rate')) {
      const hasOpeningStock = field === 'opening_stock'
        ? finalValue && parseFloat(finalValue) > 0
        : updatedRow.opening_stock && parseFloat(updatedRow.opening_stock) > 0
      const hasValuationRate = field === 'valuation_rate'
        ? finalValue && parseFloat(finalValue) > 0
        : updatedRow.valuation_rate && parseFloat(updatedRow.valuation_rate) > 0

      if (hasOpeningStock && !hasValuationRate) {
        updatedRow.errors = { ...updatedRow.errors, valuation_rate: 'Precio de Costo recomendado cuando se especifica stock inicial (se usar├í el valor autom├ítico si no se especifica)' }
      } else if (field === 'valuation_rate' && updatedRow.errors.valuation_rate === 'Precio de Costo recomendado cuando se especifica stock inicial (se usar├í el valor autom├ítico si no se especifica)') {
        updatedRow.errors = { ...updatedRow.errors, valuation_rate: null }
      }
    }

    return updatedRow
  }))

  if (!skipFetch && (
    field === 'item_code' &&
    finalValue &&
    (
      (inputMode[importMode] === 'paste' && ['update', 'stock', 'update-with-defaults'].includes(importMode)) ||
      importMode === 'insert'
    ))
  ) {
    const findItemData = async (searchValue) => {
      let localItem = allItems.get(searchValue)

      if (!localItem) {
        const codeWithAbbr = `${searchValue}-MS`
        localItem = allItems.get(codeWithAbbr)
      }

      if (localItem) {
        return fetchItemByCodeFromLocal(localItem)
      }

      const searchCodes = [searchValue, `${searchValue}-MS`]
      for (const searchCode of searchCodes) {
        const itemData = await ItemImportApi.fetchItemByCode(
          fetchWithAuth,
          searchCode,
          importMode,
          selectedWarehouse,
          activeCompany,
          warehouses
        )
        if (itemData) {
          return itemData
        }
      }

      return null
    }

    try {
      console.debug(`ACTIONS: findItemData starting for value='${finalValue}'`)
      const itemData = await findItemData(finalValue)
      console.debug(`ACTIONS: findItemData finished for value='${finalValue}'`, itemData)
      
      // NUEVO: En modo insert, si el item existe, marcar como error
      if (importMode === 'insert' && itemData && itemData.exists) {
        setRows(currentRows => currentRows.map(row => {
          if (row.id === id) {
            return { 
              ...row, 
              errors: { 
                ...row.errors, 
                item_code: `ΓÜá∩╕Å Item ya existe - Use "Actualizar Existentes"` 
              } 
            }
          }
          return row
        }))
      } else if (itemData && ['update', 'stock', 'update-with-defaults'].includes(importMode)) {
        setRows(currentRows => currentRows.map(row => {
          if (row.id === id) {
            return { ...row, ...itemData, errors: { ...row.errors, item_code: null } }
          }
          return row
        }))
      } else if (!itemData && ['update', 'stock', 'update-with-defaults'].includes(importMode)) {
        setRows(currentRows => currentRows.map(row => {
          if (row.id === id) {
            return { ...row, errors: { ...row.errors, item_code: `Item "${finalValue}" no encontrado` } }
          }
          return row
        }))
      }
      // En modo insert, si no existe, est├í bien (limpiar error si hab├¡a)
      else if (importMode === 'insert' && !itemData) {
        setRows(currentRows => currentRows.map(row => {
          if (row.id === id) {
            return { ...row, errors: { ...row.errors, item_code: null } }
          }
          return row
        }))
      }
    } catch (error) {
      console.error('Error fetching item data:', error)
      setRows(currentRows => currentRows.map(row => {
        if (row.id === id) {
          return { ...row, errors: { ...row.errors, item_code: `Error al buscar item "${finalValue}"` } }
        }
        return row
      }))
    } finally {
      setTableKey(prev => prev + 1)
      console.debug(`ACTIONS: updateCell finished id=${id} field=${field}`)
    }
  }
}

export const handlePaste = async ({
  event,
  rowId,
  field,
  rows,
  columns,
  importMode,
  inputMode,
  allItems,
  activeCompany,
  selectedWarehouse,
  fetchWithAuth,
  showNotification,
  setRows,
  setScientificNotationAlert,
  updateCell
}) => {
  event.preventDefault()
  window.pasteInProgress = true

  try {
    const pastedText = event.clipboardData.getData('text')
    const rawLines = pastedText.split(/\r?\n/)

    const processedLines = []
    let index = 0
    while (index < rawLines.length) {
      let line = rawLines[index]

      if (line.startsWith('"') && !line.endsWith('"') && index + 1 < rawLines.length) {
        let multiline = line
        index++
        while (index < rawLines.length && !rawLines[index].endsWith('"')) {
          multiline += '\n' + rawLines[index]
          index++
        }
        if (index < rawLines.length) {
          multiline += '\n' + rawLines[index]
        }
        processedLines.push(multiline)
      } else if (line.trim() === '"' || (line.startsWith('"') && line.endsWith('"') && line.length === 1)) {
        index++
        continue
      } else {
        processedLines.push(line)
      }
      index++
    }

    const lines = processedLines.length > 1 ? processedLines : processedLines.filter(line => line.trim() !== '')
    if (lines.length === 0) return

    const currentRowIndex = rows.findIndex(r => r.id === rowId)
    if (currentRowIndex === -1) return

    if (lines.length === 1) {
      let cellValue = lines[0].replace(/^"|"$/g, '').split(/\r?\n/)[0].trim()
      const scientificNotationRegex = /\d+[\.,]?\d*[Ee][+\-]?\d+/
      if (scientificNotationRegex.test(cellValue)) {
        setScientificNotationAlert({
          detected: cellValue,
          field,
          column: columns.find(col => col.key === field)?.label || field,
          count: 1
        })
      }
      // When pasting a single SKU, avoid triggering the immediate single-item fetch in updateCell.
      // The iframe will emit ht-data-changed with pasteInSku which triggers recognizeSkus
      // and supplies the full data (including iva_template). Skipping the immediate fetch
      // avoids a partial update followed by a second update.
      updateCell({ id: rowId, field, value: cellValue, skipFetch: true })
      return
    }

    const updatedRows = [...rows]
    let maxId = rows.reduce((max, row) => Math.max(max, row.id || 0), 0)
    const scientificNotationRegex = /\d+[\.,]?\d*[Ee][+\-]?\d+/
    let scientificCount = 0

    const itemCodesToFetch = []
    const pasteData = []

    lines.forEach((line, offset) => {
      const targetIndex = currentRowIndex + offset
      const cellValue = line.replace(/^"|"$/g, '').split(/\r?\n/)[0].trim()

      if (scientificNotationRegex.test(cellValue)) {
        scientificCount++
      }

      pasteData.push({ targetIndex, cellValue })

      if (
        field === 'item_code' &&
        ['update', 'stock', 'update-with-defaults'].includes(importMode) &&
        inputMode[importMode] === 'paste' &&
        cellValue
      ) {
        itemCodesToFetch.push(cellValue.trim())
      }

      // NUEVO: En modo 'insert', tambi├⌐n verificar si los SKUs ya existen
      if (
        field === 'item_code' &&
        importMode === 'insert' &&
        cellValue
      ) {
        itemCodesToFetch.push(cellValue.trim())
      }
    })

    let bulkResults = new Map()
    if (itemCodesToFetch.length > 0) {
      // Siempre usar recognizeSkus para obtener items con tasas de IVA
      console.debug(`Reconociendo ${itemCodesToFetch.length} SKUs en backend`, itemCodesToFetch)
      const { recognized, unrecognized, companyAbbr } = await ItemImportApi.recognizeSkus(
        fetchWithAuth,
        itemCodesToFetch,
        activeCompany,
        importMode,
        showNotification
      )
      
      // Procesar cada item reconocido para convertir iva_rate a iva_template
      recognized.forEach((item, sku) => {
        // DEBUG: Verificar si viene iva_rate del backend
        console.debug(`Item ${sku}: iva_rate=${item.iva_rate}`, item.taxes)
        
        // Convertir iva_rate a iva_template (string) para compatibilidad con el selector
        const ivaRateStr = item.iva_rate != null ? String(item.iva_rate) : ''
        const processedItem = {
          ...item,
          iva_template: ivaRateStr,
          // En modo insert, marcar como existente
          ...(importMode === 'insert' ? { exists: true } : {})
        }
        // Clean display item_name by removing company abbreviation suffix if present
        if (companyAbbr && processedItem.item_name) {
          processedItem.item_name = removeCompanyAbbr(processedItem.item_name, companyAbbr)
        }
        bulkResults.set(sku, processedItem)
      })
    }

    pasteData.forEach(({ targetIndex, cellValue }) => {
      if (targetIndex < updatedRows.length) {
        const targetRow = {
          ...updatedRows[targetIndex],
          [field]: cellValue,
          errors: { ...updatedRows[targetIndex].errors, [field]: null }
        }

        if (
          field === 'item_code' &&
          bulkResults.has(cellValue) &&
          ['update', 'stock', 'update-with-defaults'].includes(importMode)
        ) {
          Object.assign(targetRow, bulkResults.get(cellValue))
        }

        // NUEVO: En modo insert, marcar como error si el item ya existe
        if (
          field === 'item_code' &&
          importMode === 'insert' &&
          bulkResults.has(cellValue) &&
          bulkResults.get(cellValue).exists
        ) {
          targetRow.errors = {
            ...targetRow.errors,
            item_code: `ΓÜá∩╕Å Item ya existe - Use "Actualizar Existentes"`
          }
        }

        updatedRows[targetIndex] = targetRow
      } else {
        maxId++
        const newRow = {
          ...createEmptyRow(maxId),
          [field]: cellValue
        }

        if (
          field === 'item_code' &&
          bulkResults.has(cellValue) &&
          ['update', 'stock', 'update-with-defaults'].includes(importMode)
        ) {
          Object.assign(newRow, bulkResults.get(cellValue))
        }

        // NUEVO: En modo insert, marcar como error si el item ya existe
        if (
          field === 'item_code' &&
          importMode === 'insert' &&
          bulkResults.has(cellValue) &&
          bulkResults.get(cellValue).exists
        ) {
          newRow.errors = {
            ...newRow.errors,
            item_code: `ΓÜá∩╕Å Item ya existe - Use "Actualizar Existentes"`
          }
        }

        updatedRows.push(newRow)
      }
    })

    if (scientificCount > 0) {
      setScientificNotationAlert({
        detected: `Se detectaron ${scientificCount} valores en notaci├│n cient├¡fica`,
        field,
        column: columns.find(col => col.key === field)?.label || field,
        count: scientificCount
      })
    }

    console.debug('ACTIONS: setRows(updatedRows) - rows count', { before: rows.length, after: updatedRows.length })
    if (updatedRows.length > 0) console.debug('ACTIONS: sample updated row 0 =', updatedRows[0])
    setRows(updatedRows)
    
    // NUEVO: Notificaci├│n especial si se detectaron items existentes en modo insert
    if (importMode === 'insert' && field === 'item_code' && bulkResults.size > 0) {
      const existingCount = Array.from(bulkResults.values()).filter(result => result.exists).length
      if (existingCount > 0) {
        showNotification(
          `${lines.length} filas procesadas. ΓÜá∩╕Å ${existingCount} SKU(s) ya existe(n) - marcados en rojo. Use "Actualizar Existentes" para modificarlos.`,
          'warning'
        )
      } else {
        showNotification(`${lines.length} filas procesadas desde el portapapeles (incluyendo celdas vac├¡as)`, 'success')
      }
    } else {
      showNotification(`${lines.length} filas procesadas desde el portapapeles (incluyendo celdas vac├¡as)`, 'success')
    }
  } finally {
    window.pasteInProgress = false
  }
}

export const generatePattern = ({
  column,
  pattern,
  startFrom,
  rows,
  setRows,
  showNotification
}) => {
  let counter = parseInt(startFrom, 10) || 1
  const updatedRows = rows.map(row => {
    if (row[column]) return row

    let generated = pattern
    if (pattern.includes('{n}')) {
      const paddingMatch = pattern.match(/\{n:(\d+)\}/)
      const padding = paddingMatch ? parseInt(paddingMatch[1], 10) : 4
      const paddedNumber = String(counter).padStart(padding, '0')
      generated = pattern.replace(/\{n(?::\d+)?\}/, paddedNumber)
    } else if (pattern.includes('{AAA}')) {
      generated = pattern.replace('{AAA}', numberToAlpha(counter))
    } else {
      const match = pattern.match(/\d+/)
      if (match) {
        const number = parseInt(match[0], 10)
        const paddedNumber = String(number + counter - 1).padStart(match[0].length, '0')
        generated = pattern.replace(/\d+/, paddedNumber)
      }
    }

    counter++
    return { ...row, [column]: generated }
  })

  setRows(updatedRows)
  showNotification(`Generados ${counter - parseInt(startFrom || 1, 10)} c├│digos`, 'success')
}

export const validateRows = ({ rows, columns, setRows }) => {
  const validated = rows.map(row => {
    const errors = {}

    columns.forEach(col => {
      if (col.required) {
        const value = row[col.key]
        if (value === undefined || value === null || value === '') {
          errors[col.key] = 'Campo requerido'
        }
      }

      if (col.type === 'number' && row[col.key] && isNaN(row[col.key])) {
        errors[col.key] = 'Debe ser un n├║mero'
      }
    })

    return { ...row, errors }
  })

  setRows(validated)

  return !validated.some(row => Object.values(row.errors).some(Boolean))
}

export const importItems = async ({
  rows,
  setRows,
  setImporting,
  showNotification,
  fetchWithAuth,
  importMode,
  inputMode,
  activeCompany,
  selectedWarehouse,
  warehouses,
  activeFilter
}) => {
  console.debug('=== INICIANDO IMPORTACIÓN ===')
  console.debug(`Total de filas en la tabla: ${rows.length}`)
  console.debug(`Modo de importacion: ${importMode}`)
  console.debug(`Filtro activo: ${activeFilter}`)
  console.debug(`Compañia activa: ${activeCompany}`)

  // Verificar duplicados primero
  let duplicateCodes = getDuplicateCodes(rows)
  console.debug(`Códigos duplicados encontrados: ${duplicateCodes.length}`)
  if (duplicateCodes.length > 0) {
    console.debug('Lista de códigos duplicados:', duplicateCodes)
    duplicateCodes.forEach(code => {
      const duplicateRows = rows.filter(r => r.item_code === code)
      console.debug(`  - Código "${code}": ${duplicateRows.length} filas (IDs: ${duplicateRows.map(r => r.id).join(', ')})`)
    })
  }

  if (duplicateCodes.length > 0) {
    console.debug(`Duplicados globales encontrados (se validar n solo en filas elegibles): ${duplicateCodes.length}`)
  }

  setImporting(true)

  try {
    console.debug('=== VALIDANDO FILAS ===')
    
    // Obtener filas v├ílidas con logging detallado
    const filteringDuplicates = activeFilter === 'duplicates' && importMode === 'insert'
    console.debug(`filteringDuplicates: ${filteringDuplicates}`)
    
    // Recalcular duplicados solo en filas elegibles (con campos requeridos y que realmente podrian enviarse),
    // para que filas incompletas no bloqueen el envio de items validos.
    const rowHasRequiredFields = (row) => {
      if (!row) return false

      if (importMode === 'stock') {
        const hasSku = !!row.item_code
        const hasName = !!row.item_name
        const hasNewStock = row.new_stock !== undefined && row.new_stock !== ''
        const hasValuation = row.valuation_rate !== undefined && row.valuation_rate !== ''
        return hasSku && hasName && hasNewStock && hasValuation
      }

      if (importMode === 'insert') {
        const hasSku = !!row.item_code
        const hasName = !!row.item_name
        const hasGroup = !!row.item_group
        const hasUom = !!row.stock_uom
        const hasType = row.is_stock_item !== undefined && row.is_stock_item !== null
        const hasIva = !!(row.iva_template && String(row.iva_template).trim())
        return hasSku && hasName && hasGroup && hasUom && hasType && hasIva
      }

      if (importMode === 'update') {
        const hasSku = !!row.item_code
        const hasIva = !!(row.iva_template && String(row.iva_template).trim())
        return hasSku && hasIva
      }

      if (importMode === 'update-with-defaults') {
        return !!row.item_code
      }

      return false
    }

    const rowWillBeConsideredForImport = (row) => {
      if (!rowHasRequiredFields(row)) return false
      const hasNoExistingItemError = importMode !== 'insert' || !row.errors?.item_code || !row.errors.item_code.includes('ya existe')
      return hasNoExistingItemError
    }

    duplicateCodes = getDuplicateCodes(rows.filter(rowWillBeConsideredForImport))
    console.debug(`C¢digos duplicados (solo filas elegibles): ${duplicateCodes.length}`)
    
    let validRows = []
    let invalidRows = []
    
    rows.forEach((row, index) => {
      console.debug(`Fila ${index + 1} (ID: ${row.id}):`, { sku: row.item_code || 'VACÍO', name: row.item_name || 'VACÍO' })
      console.debug(`  - Categoría: "${row.item_group || 'VACÍO'}"`)
      console.debug(`  - UOM: "${row.stock_uom || 'VACÍO'}"`)
      console.debug(`  - Tipo: "${row.is_stock_item || 'VACÍO'}"`)
      console.debug(`  - Errores:`, row.errors || 'Ninguno')
      
      let hasRequiredFields = false
      let validationReasons = []
      
      if (importMode === 'stock') {
        const hasSku = !!row.item_code
        const hasName = !!row.item_name
        const hasNewStock = row.new_stock !== undefined && row.new_stock !== ''
        const hasValuation = row.valuation_rate !== undefined && row.valuation_rate !== ''
        
        hasRequiredFields = hasSku && hasName && hasNewStock && hasValuation
        validationReasons = [
          hasSku ? 'Γ£à SKU presente' : 'Γ¥î SKU faltante',
          hasName ? 'Γ£à Nombre presente' : 'Γ¥î Nombre faltante',
          hasNewStock ? 'Γ£à Nuevo stock presente' : 'Γ¥î Nuevo stock faltante',
          hasValuation ? 'Γ£à Costo presente' : 'Γ¥î Costo faltante'
        ]
        
        console.debug(`  Validacion modo STOCK: ${hasRequiredFields ? 'VÁLIDA' : 'INVÁLIDA'}`)
        validationReasons.forEach(reason => console.debug(`    ${reason}`))
        
      } else if (importMode === 'insert') {
        const hasSku = !!row.item_code
        const hasName = !!row.item_name
        const hasGroup = !!row.item_group
        const hasUom = !!row.stock_uom
        const hasType = row.is_stock_item !== undefined && row.is_stock_item !== null
        const hasIva = !!(row.iva_template && String(row.iva_template).trim())

        hasRequiredFields = hasSku && hasName && hasGroup && hasUom && hasType && hasIva
        validationReasons = [
          hasSku ? ' SKU presente' : ' SKU faltante',
          hasName ? ' Nombre presente' : ' Nombre faltante',
          hasGroup ? ' Categora presente' : ' Categora faltante',
          hasUom ? ' UOM presente' : ' UOM faltante',
          hasType ? ' Tipo presente' : ' Tipo faltante',
          hasIva ? ' IVA presente' : ' IVA faltante'
        ]

        console.debug(`   Validacion modo INSERT: ${hasRequiredFields ? 'VLIDA' : 'INVLIDA'}`)
        validationReasons.forEach(reason => console.debug(`    ${reason}`))

      } else if (importMode === 'update') {
        const hasSku = !!row.item_code
        const hasIva = !!(row.iva_template && String(row.iva_template).trim())
        hasRequiredFields = hasSku && hasIva
        validationReasons = [
          hasSku ? ' SKU presente' : ' SKU faltante',
          hasIva ? ' IVA presente' : ' IVA faltante'
        ]

        console.debug(`   Validacion modo UPDATE: ${hasRequiredFields ? 'VLIDA' : 'INVLIDA'}`)
        validationReasons.forEach(reason => console.debug(`    ${reason}`))

      } else if (importMode === 'update-with-defaults') {
        hasRequiredFields = !!row.item_code
        validationReasons = [
          hasRequiredFields ? 'Γ£à SKU presente' : 'Γ¥î SKU faltante'
        ]
        
        console.debug(`  Validacion modo UPDATE-DEFAULTS: ${hasRequiredFields ? 'VÁLIDA' : 'INVÁLIDA'}`)
        validationReasons.forEach(reason => console.debug(`    ${reason}`))
      }
      
      // Verificar duplicados
      const hasNoDuplicates = filteringDuplicates || !duplicateCodes.includes(row.item_code)
      if (!hasNoDuplicates) {
        console.debug(`  Duplicados: TIENE DUPLICADO (codigo: ${row.item_code})`)
      } else {
        console.debug(`  Duplicados: SIN DUPLICADOS`)
      }
      
      // Verificar error de item existente (solo en modo insert)
      const hasNoExistingItemError = importMode !== 'insert' || !row.errors?.item_code || !row.errors.item_code.includes('ya existe')
      if (!hasNoExistingItemError) {
        console.debug(`  Item existente: YA EXISTE EN EL SISTEMA`)
      } else {
        console.debug(`  Item existente: NO EXISTE O NO SE VERIFICO`)
      }
      
      const isValid = hasRequiredFields && hasNoDuplicates && hasNoExistingItemError
      
      if (isValid) {
        validRows.push(row)
        console.debug(`  RESULTADO: FILA VALIDA PARA IMPORTAR`)
      } else {
        invalidRows.push({ row, reasons: validationReasons, hasDuplicates: !hasNoDuplicates, hasExistingError: !hasNoExistingItemError })
        console.debug(`  RESULTADO: FILA INVALIDA - NO SE IMPORTARA`)
      }
    })
    
    console.debug(`\n=== RESUMEN DE VALIDACION ===`)
    console.debug(`Filas válidas: ${validRows.length}`)
    console.debug(`Filas inválidas: ${invalidRows.length}`)
    
    if (invalidRows.length > 0) {
      console.log(`\n≡ƒöì === DETALLE DE FILAS INV├üLIDAS ===`)
      invalidRows.forEach(({ row, reasons, hasDuplicates, hasExistingError }, idx) => {
        console.log(`Γ¥î Fila ${idx + 1} (ID: ${row.id}, SKU: "${row.item_code || 'VAC├ìO'}"):`)
        reasons.forEach(reason => console.log(`   ${reason}`))
        if (hasDuplicates) console.log(`   Γ¥î Tiene c├│digo duplicado`)
        if (hasExistingError) console.log(`   Γ¥î Item ya existe en el sistema`)
      })
    }

    // (IVA missing check moved later to validate only the rows that will actually be sent)

    let processedRows = validRows

    // NUEVO: Contar items excluidos por ya existir en modo insert (delegado a helper)
    let existingItemsCount = 0
    if (importMode === 'insert') {
      existingItemsCount = countExistingItemErrors(rows)
    }

    if (processedRows.length === 0) {
      console.log('≡ƒÜ½ No hay filas v├ílidas para procesar')
      
      // Crear mensaje detallado de errores
      let errorSummary = `No hay items v├ílidos para procesar. ${invalidRows.length} fila(s) con errores:\n\n`
      
      // Agrupar errores por tipo
      const errorGroups = {
        'Sin SKU': [],
        'Sin nombre': [],
        'Sin categor├¡a': [],
        'Sin UOM': [],
        'Sin tipo': [],
        'Sin IVA': [],
        'Duplicados': [],
        'Ya existen': []
      }
      
      invalidRows.forEach(({ row, reasons, hasDuplicates, hasExistingError }) => {
        if (hasExistingError) {
          errorGroups['Ya existen'].push(`Fila ${row.id}: "${row.item_code || 'SIN SKU'}"`)
        } else if (hasDuplicates) {
          errorGroups['Duplicados'].push(`Fila ${row.id}: "${row.item_code || 'SIN SKU'}"`)
        } else {
          reasons.forEach(reason => {
            if (reason.includes('SKU faltante')) {
              errorGroups['Sin SKU'].push(`Fila ${row.id}`)
            } else if (reason.includes('Nombre faltante')) {
              errorGroups['Sin nombre'].push(`Fila ${row.id}`)
            } else if (reason.includes('Categor├¡a faltante')) {
              errorGroups['Sin categor├¡a'].push(`Fila ${row.id}`)
            } else if (reason.includes('UOM faltante')) {
              errorGroups['Sin UOM'].push(`Fila ${row.id}`)
            } else if (reason.includes('Tipo faltante')) {
            } else if (reason.includes('IVA faltante')) {
              errorGroups['Sin IVA'].push(`Fila ${row.id}`)
              errorGroups['Sin tipo'].push(`Fila ${row.id}`)
            }
          })
        }
      })
      
      // Construir mensaje final
      const errorLines = []
      Object.entries(errorGroups).forEach(([errorType, items]) => {
        if (items.length > 0) {
          errorLines.push(`Γ¥î ${errorType}: ${items.length} fila(s)`)
          if (items.length <= 5) { // Mostrar detalles solo si no son muchos
            items.forEach(item => errorLines.push(`   ${item}`))
          } else {
            errorLines.push(`   ${items.slice(0, 3).join(', ')}... (+${items.length - 3} m├ís)`)
          }
        }
      })
      
      errorSummary += errorLines.join('\n')
      
      // Mostrar notificaci├│n detallada
      showNotification(errorSummary, 'error')
      
      setImporting(false)
      return
    }

    console.log(`\n≡ƒÜÇ === PROCESANDO IMPORTACI├ôN ===`)
    console.log(`≡ƒôª Filas a procesar: ${processedRows.length}`)
    console.log(`≡ƒÄ» Items a enviar al backend:`, processedRows.map(r => ({ id: r.id, sku: r.item_code, name: r.item_name })))

    let existingItemCodes = []
    if (importMode !== 'update-with-defaults') {
      console.log('≡ƒöì Consultando items existentes en el sistema...')
      const existingItemsResponse = await fetchWithAuth(`${API_ROUTES.inventory}/items?company=${activeCompany}&fields=item_code`)
      if (existingItemsResponse.ok) {
        const existingData = await existingItemsResponse.json()
        if (existingData.success) {
          existingItemCodes = existingData.data.map(item => item.item_code)
          console.log(`≡ƒôï Items existentes encontrados: ${existingItemCodes.length}`)
        }
      }
    }

    let itemsToImport = processedRows
    if (importMode === 'insert') {
      const existingSet = new Set(existingItemCodes)
      const beforeFilter = itemsToImport.length
      itemsToImport = processedRows.filter(row => !existingSet.has(row.item_code))
      const filteredCount = beforeFilter - itemsToImport.length
      console.log(`≡ƒåò Modo INSERT: ${filteredCount} items filtrados por ya existir, ${itemsToImport.length} items nuevos para crear`)
    } else if (importMode === 'update') {
      const existingSet = new Set(existingItemCodes)
      const beforeFilter = itemsToImport.length
      itemsToImport = processedRows.filter(row => existingSet.has(row.item_code))
      const filteredCount = beforeFilter - itemsToImport.length
      console.log(`≡ƒöä Modo UPDATE: ${filteredCount} items filtrados por no existir, ${itemsToImport.length} items para actualizar`)
      
      if (inputMode[importMode] === 'paste') {
        const beforeChangesFilter = itemsToImport.length
        itemsToImport = itemsToImport.filter(row => row.hasChanges)
        const changesFilteredCount = beforeChangesFilter - itemsToImport.length
        console.log(`🔄 Modo UPDATE (paste): ${changesFilteredCount} items sin cambios filtrados, ${itemsToImport.length} items con cambios`)
      }
    }

    // Validar IVA SÓLO sobre las filas que realmente vamos a enviar al backend
    // EXCEPCIÓN: En modo 'stock' NO validar IVA porque solo actualizamos cantidades/costos
    // y los items ya existen con su Item Tax Template asignado
    if (importMode !== 'stock') {
      const ivaMissingForSend = itemsToImport.filter(row => !(row.iva_template && String(row.iva_template).trim()))
      if (ivaMissingForSend.length > 0) {
        const examples = ivaMissingForSend.slice(0, 3).map(r => r.item_code || `Fila ${r.id}`).join(', ')
        showNotification(
          `Falta asignar la tasa de IVA en ${ivaMissingForSend.length} item(s). Completa la columna IVA antes de importar.${examples ? ` Ejemplos: ${examples}` : ''}`,
          'error'
        )
        setImporting(false)
        return
      }
    }

    if (itemsToImport.length === 0) {
      console.log('≡ƒÜ½ No quedan items para importar despu├⌐s del filtrado')
      showNotification(`No hay items para ${importMode === 'insert' ? 'crear' : 'actualizar'} despu├⌐s del filtro`, 'warning')
      setImporting(false)
      return
    }

    console.log(`\n≡ƒôñ === ENVIANDO AL BACKEND ===`)
    console.log(`≡ƒÄ» Items finales a importar: ${itemsToImport.length}`)

    setRows(itemsToImport)

    // Determinar si usar endpoint con IVA o el tradicional
    // El endpoint con IVA es más directo y maneja correctamente la asignación de taxes
    const hasIvaItems = itemsToImport.some(item => item.iva_template && String(item.iva_template).trim() !== '')
    const useIvaEndpoint = (importMode === 'insert' || importMode === 'update') && hasIvaItems
    
    // NUEVO: Si hay items con IVA, intentar usar Server Script para bulk update optimizado
    let useServerScript = false
    let scriptCheckResult = null
    
    if (useIvaEndpoint) {
      console.log('🔍 Verificando disponibilidad de Server Script para bulk IVA...')
      scriptCheckResult = await ensureBulkIvaScript({ fetchWithAuth, showNotification })
      
      if (scriptCheckResult.scriptReady) {
        console.log('✅ Server Script disponible - se usará método optimizado')
        useServerScript = true
      } else {
        console.warn('⚠️ Server Script no disponible:', scriptCheckResult.error)
        console.log('📌 Se usará el método tradicional (1 a 1)')
      }
    }
    
    let endpoint = useIvaEndpoint 
      ? API_ROUTES.bulkImportItemsWithIva  // '/api/items/bulk-import-with-iva'
      : `${API_ROUTES.inventory}/items/bulk-import`
    
    console.log(`🔗 Endpoint: ${endpoint}`)
    console.log(`📋 Modo: ${importMode}`)
    console.log(`💠 Usando endpoint IVA: ${useIvaEndpoint}`)
    console.log(`⚡ Usando Server Script: ${useServerScript}`)
    
    let requestBody = {
      items: convertItemsForBackend(itemsToImport),
      mode: importMode
    }
    
    // Removed debug logs for production; platform/url are mapped to custom_product_links via convertItemsForBackend

    if (importMode === 'stock') {
      console.log('≡ƒÄ» MODO STOCK: Iniciando procesamiento especial')
      
      const changedValuationItems = itemsToImport.filter(item => {
        const current = parseFloat(item.valuation_rate || 0)
        const original = parseFloat(item.original_valuation_rate || 0)
        return Math.abs(current - original) > 0.01
      })

      const changedStockItems = itemsToImport.filter(item => {
        const current = parseFloat(item.new_stock || 0)
        const original = parseFloat(item.current_stock || 0)
        return Math.abs(current - original) > 0.001
      })

      console.log(`≡ƒôª Modo STOCK - Cambios detectados:`)
      console.log(`  ≡ƒÆ░ Items con cambio de costo: ${changedValuationItems.length}`)
      console.log(`  ≡ƒôª Items con cambio de stock: ${changedStockItems.length}`)

      if (changedValuationItems.length === 0 && changedStockItems.length === 0) {
        console.log('≡ƒÜ½ No hay cambios para procesar en modo stock')
        console.log('≡ƒöÜ SALIENDO: No se ejecutar├í bulk-import')
        showNotification('No hay cambios en valuation rates ni stock para procesar', 'info')
        setImporting(false)
        return  // Importante: salir aqu├¡ para no continuar con bulk-import
      }

      if (changedValuationItems.length > 0) {
        console.log('≡ƒÆ░ Actualizando costos...')
        const valuationResponse = await fetchWithAuth(`${API_ROUTES.inventory}/items/bulk-update-valuation-rates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: changedValuationItems.map(item => ({
              item_code: item.item_code,
              valuation_rate: item.valuation_rate
            })),
            company: activeCompany
          })
        })

        if (!valuationResponse.ok) {
          console.error('Γ¥î Error al actualizar costos')
          showNotification('Error al actualizar costos de items', 'error')
        } else {
          console.log('Γ£à Costos actualizados correctamente')
        }
      }

      if (changedStockItems.length > 0) {
        console.log('≡ƒôª Actualizando stock...')
        const stockResponse = await fetchWithAuth(`${API_ROUTES.inventory}/stock-reconciliation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: changedStockItems.map(item => ({
              item_code: item.item_code,
              warehouse: item.warehouse || selectedWarehouse,
              new_stock: item.new_stock,
              custom_company: activeCompany
            }))
          })
        })

        if (!stockResponse.ok) {
          console.error('Γ¥î Error al reconciliar stock')
          showNotification('Error al reconciliar stock', 'error')
        } else {
          console.log('Γ£à Stock reconciliado correctamente')
        }
      }

      console.log('≡ƒÄë Procesamiento de stock/costos completado')
      showNotification('Procesamiento de stock/costos completado', 'success')
      
      // Recargar items despu├⌐s de actualizar stock/costos
      if (inputMode[importMode] === 'all') {
        const reloadedItems = await ItemImportApi.loadExistingItems(
          fetchWithAuth,
          activeCompany,
          importMode,
          selectedWarehouse,
          warehouses,
          showNotification
        )
        setRows(reloadedItems)
      }
      
      setImporting(false)
      console.log('≡ƒÅü === IMPORTACI├ôN FINALIZADA ===\n')
      return  // Importante: salir aqu├¡ para no continuar con bulk-import
    } else if (importMode === 'update-with-defaults') {
      endpoint = `${API_ROUTES.inventory}/items/bulk-update-with-defaults`
      const changedRows = processedRows.filter(row => row.hasChanges)
      requestBody = {
        items: changedRows.map(item => ({
          item_code: item.item_code,
          item_name: item.item_name || undefined,
          description: item.description || undefined,
          item_group: item.item_group ? item.item_group.toUpperCase() : undefined,  // Normalizar a may├║sculas
          brand: item.brand ? item.brand.toUpperCase() : undefined,  // Normalizar a may├║sculas
          default_warehouse: item.default_warehouse ? resolveWarehouseHelper(item.default_warehouse, warehouses) || item.default_warehouse : undefined,
          expense_account: item.expense_account || undefined,
          income_account: item.income_account || undefined,
          custom_company: activeCompany
        }))
      }
      console.log('ΓÜÖ∩╕Å Enviando actualizaci├│n de campos por defecto...')
    } else {
      console.log('≡ƒôñ Enviando importaci├│n est├índar...')
    }

    // Si usamos Server Script, modificar el flujo:
    // 1. Crear/actualizar items SIN el IVA usando el endpoint tradicional
    // 2. Ejecutar bulk update de IVA usando Server Script
    var responseData
    
    if (useServerScript) {
      console.log('Γÿü Flujo con Server Script activado')
      
      // 1. Crear/actualizar items sin IVA
      console.log('ΓîÆ Paso 1: Crear/actualizar items sin IVA...')
      const itemsWithoutIva = convertItemsForBackend(itemsToImport).map(item => {
        // Remover iva_template para usar endpoint tradicional
        const { iva_template, ...itemWithoutIva } = item
        return itemWithoutIva
      })
      
      const createResponse = await fetchWithAuth(`${API_ROUTES.inventory}/items/bulk-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: itemsWithoutIva,
          mode: importMode
        })
      })
      
      if (!createResponse.ok) {
        console.error('Γ¥î Error creando/actualizando items')
        const errorText = await createResponse.text()
        console.error('Respuesta del error:', errorText)
        showNotification('Error al crear/actualizar items', 'error')
        return
      }
      
      const createData = await createResponse.json()
      console.log('Γ£à Items creados/actualizados:', createData)
      
      // 2. Bulk update de IVA via Server Script
      console.log('ΓÿüPaso 2: Bulk update de IVA via Server Script...')
      const ivaUpdateResult = await executeBulkIvaUpdate({
        items: itemsToImport,
        company: activeCompany,
        transactionType: 'Ventas', // TODO: determinar seg├║n contexto
        fetchWithAuth
      })
      
      if (!ivaUpdateResult.success) {
        console.error('Γÿ░Γ£ø´©Å Error en bulk update de IVA:', ivaUpdateResult.error)
        showNotification(
          `Items creados/actualizados pero hubo un error al asignar IVA: ${ivaUpdateResult.error}`,
          'warning'
        )
        // No retornar aqu├¡ - los items se crearon correctamente
      } else {
        const { processed, errors, updated } = ivaUpdateResult.data
        console.log(`Γ£à IVA actualizado: ${processed} procesados, ${errors?.length || 0} errores`)
        
        if (errors && errors.length > 0) {
          console.warn('Γÿ░Γ£ø´©Å Algunos items tuvieron errores al asignar IVA:', errors)
          showNotification(
            `Items importados. IVA asignado a ${updated?.length || 0} items. ${errors.length} con errores.`,
            'warning'
          )
        }
      }
      
      responseData = createData
      
    } else {
      // Flujo tradicional
      const response = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        console.error('Γ¥î Error en la respuesta del backend')
        const errorText = await response.text()
        console.error('Respuesta del error:', errorText)
        showNotification('Error al importar items', 'error')
        return
      }

      responseData = await response.json()
      console.log('Γ£à Respuesta del backend:', responseData)
    }

    // Vaciar la tabla despu├⌐s de importaci├│n exitosa
    setRows([createEmptyRow()])
    
    // NUEVO: Notificaci├│n mejorada para modo insert con items existentes excluidos
    if (importMode === 'insert' && existingItemsCount > 0) {
      console.log(`≡ƒÄë Importaci├│n completada: ${processedRows.length} items creados, ${existingItemsCount} items excluidos por existir`)
      showNotification(
        `Γ£à Importaci├│n completada. ${processedRows.length} item(s) creado(s). ${existingItemsCount} item(s) excluido(s) por ya existir. Tabla vaciada.`,
        'success'
      )
    } else {
      console.log(`≡ƒÄë Importaci├│n completada exitosamente`)
      showNotification('Importaci├│n completada correctamente. Tabla vaciada.', 'success')
    }
  } catch (error) {
    console.error('Γ¥î Error durante la importaci├│n:', error)
    showNotification('Error al importar items', 'error')
  } finally {
    setImporting(false)
    console.log('≡ƒÅü === IMPORTACI├ôN FINALIZADA ===\n')
  }
}

export const normalizeRowsWarehouses = ({ warehouses, setRows, setTableKey }) => {
  if (!warehouses || warehouses.length === 0) return

  setRows(prevRows => prevRows.map(row => {
    const value = row.default_warehouse || row.warehouse
    if (!value) return row
    const resolved = resolveWarehouseHelper(value, warehouses)
    if (resolved && resolved !== value) {
      return { ...row, default_warehouse: resolved, warehouse: resolved }
    }
    return row
  }))

  setTableKey(prev => prev + 1)
}

export const handleCsvFileSelect = ({ event, setCsvFile, processCsvFile }) => {
  const file = event.target.files[0]
  if (file) {
    setCsvFile(file)
    processCsvFile({ file })
  }
}

export const processCsvFile = async ({
  file,
  setProcessingCsv,
  showNotification,
  setCsvHeaders,
  setCsvData,
  setRows
}) => {
  setProcessingCsv(true)
  try {
    const text = await file.text()
    const lines = text.split('\n').filter(line => line.trim())

    if (lines.length < 2) {
      showNotification('El CSV debe tener al menos una fila de encabezados y una fila de datos', 'error')
      return
    }

    const headers = lines[0].split(',').map(header => header.trim().replace(/"/g, ''))
    setCsvHeaders(headers)

    const data = lines.slice(1).map((line, index) => {
      const values = parseCsvLine(line)
      const row = {
        id: index + 1,
        selected: false,
        hasChanges: false,
        errors: {}
      }

      headers.forEach((header, colIndex) => {
        const value = values[colIndex] || ''
        const fieldMapping = {
          sku: 'item_code',
          codigo: 'item_code',
          item_code: 'item_code',
          nombre: 'item_name',
          name: 'item_name',
          item_name: 'item_name',
          descripcion: 'description',
          description: 'description',
          categoria: 'item_group',
          category: 'item_group',
          item_group: 'item_group',
          marca: 'brand',
          brand: 'brand',
          almacen_defecto: 'default_warehouse',
          default_warehouse: 'default_warehouse',
          cuenta_gasto: 'expense_account',
          expense_account: 'expense_account',
          cuenta_ingreso: 'income_account',
          income_account: 'income_account'
          ,
            platform: 'platform',
            url: 'url',
            custom_product_links: 'custom_product_links'
        }

        const fieldKey = fieldMapping[header.toLowerCase()] || header.toLowerCase()
        row[fieldKey] = value
      })

      return row
    })

    setCsvData(data)
    setRows(data)
    showNotification(`CSV procesado: ${data.length} filas cargadas`, 'success')
  } catch (error) {
    console.error('Error procesando CSV:', error)
    showNotification('Error al procesar el archivo CSV', 'error')
  } finally {
    setProcessingCsv(false)
  }
}

/**
 * Verifica y asegura que el Server Script de bulk IVA existe en ERPNext.
 * @returns {Promise<{enabled: boolean, scriptReady: boolean, error?: string}>}
 */
export const ensureBulkIvaScript = async ({ fetchWithAuth, showNotification }) => {
  try {
    // 1. Verificar si los Server Scripts están habilitados
    const enabledResponse = await fetchWithAuth(API_ROUTES.erpnextScripts.checkEnabled)
    if (!enabledResponse.ok) {
      const error = await enabledResponse.text()
      console.error('Error verificando Server Scripts:', error)
      return { 
        enabled: false, 
        scriptReady: false, 
        error: 'No se pudo verificar si Server Scripts está habilitado' 
      }
    }
    
    const enabledData = await enabledResponse.json()
    if (!enabledData.enabled) {
      console.warn('⚠️ Server Scripts no está habilitado en ERPNext')
      return { 
        enabled: false, 
        scriptReady: false, 
        error: 'Server Scripts no está habilitado en la configuración de ERPNext. Activar en System Settings.' 
      }
    }
    
    console.log('✓ Server Scripts está habilitado')
    
    // 2. Asegurar que el script bulk_update_item_iva existe
    const ensureResponse = await fetchWithAuth(API_ROUTES.erpnextScripts.ensureBulkIva, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update: false }) // No actualizar si ya existe
    })
    
    if (!ensureResponse.ok) {
      const error = await ensureResponse.text()
      console.error('Error asegurando script:', error)
      return { 
        enabled: true, 
        scriptReady: false, 
        error: 'No se pudo crear/verificar el Server Script de bulk IVA' 
      }
    }
    
    const ensureData = await ensureResponse.json()
    console.log(`✓ Script bulk_update_item_iva: ${ensureData.action}`, ensureData.script_name)
    
    return { 
      enabled: true, 
      scriptReady: true, 
      scriptName: ensureData.script_name 
    }
    
  } catch (error) {
    console.error('Error en ensureBulkIvaScript:', error)
    return { 
      enabled: false, 
      scriptReady: false, 
      error: `Error: ${error.message}` 
    }
  }
}

/**
 * Ejecuta bulk update de Item Tax Templates usando Server Script (método optimizado).
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
export const executeBulkIvaUpdate = async ({ 
  items, 
  company, 
  transactionType = 'Ventas',
  fetchWithAuth 
}) => {
  try {
    if (!items || items.length === 0) {
      return { success: false, error: 'No hay items para procesar' }
    }
    
    console.log(`🚀 Ejecutando bulk update IVA via Server Script: ${items.length} items`)
    console.log('📤 Datos enviados al Server Script:', {
      items: items.map(item => ({
        item_code: item.item_code,
        iva_rate: parseFloat(item.iva_template)
      })),
      company,
      transaction_type: transactionType
    })
    
    const response = await fetchWithAuth(API_ROUTES.erpnextScripts.bulkUpdateIva, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map(item => ({
          item_code: item.item_code,
          iva_rate: parseFloat(item.iva_template) // iva_template contiene la tasa numérica
        })),
        company,
        transaction_type: transactionType
      })
    })
    
    if (!response.ok) {
      const error = await response.text()
      console.error('❌ Error en bulk update IVA:', error)
      return { success: false, error: `Error ejecutando bulk update: ${error}` }
    }
    
    const result = await response.json()
    console.log('📥 Respuesta del Server Script:', result)
    
    if (!result.success) {
      console.error('❌ Bulk update retornó error:', result.data)
      return { success: false, error: result.data?.error || 'Error desconocido', data: result.data }
    }
    
    console.log('✅ Bulk update IVA completado:', result.data)
    return { success: true, data: result.data }
    
  } catch (error) {
    console.error('❌ Error en executeBulkIvaUpdate:', error)
    return { success: false, error: error.message }
  }
}

