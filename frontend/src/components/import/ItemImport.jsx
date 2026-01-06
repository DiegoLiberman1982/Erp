import React, { useState, useContext, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AuthContext } from '../../AuthProvider'
import { NotificationContext } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'
import API_ROUTES from '../../apiRoutes'
import { Plus, Trash2, RefreshCw, Download, Upload, AlertCircle, CheckCircle, Info, Zap, X, AlertTriangle, DollarSign, Loader2, Filter, RotateCcw } from 'lucide-react'
import Modal from '../Modal'
import loadingStockGif from '../../media/Carga2.gif'
import useCurrencies from '../../hooks/useCurrencies'
import useTaxTemplates from '../../hooks/useTaxTemplates'
import { templateMatchesType, TEMPLATE_TYPES } from '../../utils/taxTemplates'

// Importar modales y helpers
import { PatternModal, DefaultValueModal, DeleteConfirmModal, CostModal, BulkUpdateModal } from './ItemImport/ItemImportModals'
import {
  platformOptions,
  extractItemDataFromResponse,
  removeCompanyAbbr,
  getValidRowsForImport as getValidRowsHelper,
  getFilteredRows as getFilteredRowsHelper,
  resolveWarehouseValue
} from './ItemImport/itemImportHelpers'
import { getColumns, getColumnOptions } from './ItemImport/itemImportColumns'
import * as ItemImportApi from './ItemImport/itemImportApi'
import * as ItemImportActions from './ItemImport/itemImportActions'
import {
  computeVisibleItems,
  toggleSelectAllSet,
  buildFilterChangeAction,
  resetSelectionState as resetSelectionHelper
} from '../../handsometable/utils/tableFilters'


export default function ItemImport() {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const { confirm, ConfirmDialog } = useConfirm()
  const { currencies, loading: currenciesLoading } = useCurrencies()
  // Do not auto-load templates on mount. We'll load them only when the user chooses "Cargar Todos".
  const { templates: taxTemplates, refresh: refreshTaxTemplates, loading: taxTemplatesLoading } = useTaxTemplates(fetchWithAuth, { auto: false })

  // Estado para las filas de datos
  const [rows, setRows] = useState([ItemImportActions.createEmptyRow(1)])
  const hasTableContent = useMemo(
    () => rows.some(row =>
      (row.item_code && row.item_code.trim() !== '') ||
      (row.item_name && row.item_name.trim() !== '') ||
      (row.description && row.description.trim() !== '') ||
      (row.brand && row.brand.trim() !== '') ||
      (row.platform && row.platform.trim() !== '') ||
      (row.url && row.url.trim() !== '') ||
      (row.default_warehouse && row.default_warehouse.trim() !== '') ||
      (row.opening_stock && String(row.opening_stock).trim() !== '') ||
      (row.iva_template && row.iva_template.trim() !== '') ||
      row.hasChanges ||
      (row.errors && Object.values(row.errors).some(Boolean))
    ),
    [rows]
  )

  const taxTemplateOptions = useMemo(() => {
    if (!Array.isArray(taxTemplates)) return []

    const normalizeRate = (rate) => {
      const parsed = Number.parseFloat(String(rate).replace(',', '.'))
      return Number.isFinite(parsed) ? Number(parsed.toFixed(4)) : null
    }

    const formatRate = (rate) => {
      if (rate == null) return ''
      return Number.isInteger(rate) ? `${rate}%` : `${rate.toFixed(2)}%`
    }

    // Extraer todas las tasas únicas de todos los templates
    const uniqueRates = new Set()
    taxTemplates.forEach(template => {
      if (!template || !Array.isArray(template.iva_rates)) return
      template.iva_rates.forEach(rate => {
        const normalized = normalizeRate(rate)
        if (normalized !== null) {
          uniqueRates.add(normalized)
        }
      })
    })

    // Convertir a array ordenado y formatear como opciones
    // El value es la tasa numérica (ej: "21"), el label muestra "IVA 21%"
    return Array.from(uniqueRates)
      .sort((a, b) => a - b)
      .map(rate => ({
        value: String(rate),
        label: `IVA ${formatRate(rate)}`
      }))
  }, [taxTemplates])
  
  const [importMode, setImportMode] = useState('insert') // 'insert', 'update', 'stock', 'bulk-update-fields'
  const [inputMode, setInputMode] = useState({}) // Object mapping import modes to input modes ('all' or 'paste')
  const [importing, setImporting] = useState(false) // Loading state for import operations
  const [validationResults, setValidationResults] = useState([])
  const [showPatternModal, setShowPatternModal] = useState(false)
  const [patternConfig, setPatternConfig] = useState({ column: '', pattern: '', start: 1 })
  const [showDefaultModal, setShowDefaultModal] = useState(false)
  const [defaultConfig, setDefaultConfig] = useState({ column: '', value: '' })
  const [addingUom, setAddingUom] = useState(false)
  const [scientificNotationAlert, setScientificNotationAlert] = useState(null)

  useEffect(() => {
    const handleOpenItemImportMode = (event) => {
      const mode = (event?.detail?.mode || '').toString()
      if (!mode) return
      if (mode === 'insert' || mode === 'update' || mode === 'stock' || mode === 'bulk-update-fields') {
        setImportMode(mode)
      }
    }

    window.addEventListener('openItemImportMode', handleOpenItemImportMode)
    return () => {
      window.removeEventListener('openItemImportMode', handleOpenItemImportMode)
    }
  }, [])
  const [columnFilters, setColumnFilters] = useState({})
  const [tableKey, setTableKey] = useState(0) // Para forzar re-render de la tabla
  const [portalDropdown, setPortalDropdown] = useState({ open: false, rowId: null, colKey: null, x: 0, y: 0 })
  
  // Estado para CSV file upload (para update-with-defaults)
  const [csvFile, setCsvFile] = useState(null)
  const [csvData, setCsvData] = useState([])
  const [csvHeaders, setCsvHeaders] = useState([])
  const [processingCsv, setProcessingCsv] = useState(false)
  
  // Row highlighting (computed below) - removed separate filter UI
  
  // Estado para modal de eliminación
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  
  // Estado para selección múltiple
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [selectAll, setSelectAll] = useState(false)
  
  // Estado para preloading de items
  const [allItems, setAllItems] = useState(new Map())
  
  // Estado para loading de datos
  const [loadingData, setLoadingData] = useState(false)
  
  // Estado para contar filas filtradas
  const [filteredRowCount, setFilteredRowCount] = useState(null)
  
  // Estado para controlar procesamiento masivo de SKUs
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const bulkProcessingTimeoutRef = useRef(null)
  
  // Estado para mostrar solo seleccionados
  const [showOnlySelected, setShowOnlySelected] = useState(false)
  
  // Estado para filtrar items duplicados (marcados en rojo en modo insert)
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false)
  
  // Estado para filtro combinado (select)
  const [activeFilter, setActiveFilter] = useState('none') // 'none', 'selected', 'duplicates'
  
  // Estado para forzar re-render del botón cuando cambian los filtros
  const [buttonKey, setButtonKey] = useState(0)
  
	  // Estados para modal de costos
	  const [showCostModal, setShowCostModal] = useState(false)
	  const [selectedPriceLists, setSelectedPriceLists] = useState([])
	  const [availablePriceLists, setAvailablePriceLists] = useState([])
	  const [exchangeRate, setExchangeRate] = useState(1)
	  const [costModalPosition, setCostModalPosition] = useState({ x: 100, y: 100 })
	  const [applyingCosts, setApplyingCosts] = useState(false)
	  const [selectedPriceListInfo, setSelectedPriceListInfo] = useState(null)
  
  // Estados para modal de bulk update
  const [bulkUpdateConfig, setBulkUpdateConfig] = useState({ field: '', value: '' })
  const [applyingBulkUpdate, setApplyingBulkUpdate] = useState(false)
  
  // Estado para almacén seleccionado en modo stock
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  
  // Refs
  const tableHeaderRef = useRef(null)
  const [patternModalPosition, setPatternModalPosition] = useState({ x: 100, y: 100 })
  const iframeRef = useRef(null)
  const lastSentRowIdsRef = useRef([])
  const selectedRowsRef = useRef(new Set())
  const ignoreNextSendRef = useRef(false)
  const postMessageTimerRef = useRef(null)

  useEffect(() => {
    selectedRowsRef.current = selectedRows
  }, [selectedRows])
  
  // Datos auxiliares
  const [itemGroups, setItemGroups] = useState([])
  const [uoms, setUoms] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [availableExpenseAccounts, setAvailableExpenseAccounts] = useState([])
  const [availableIncomeAccounts, setAvailableIncomeAccounts] = useState([])
  const [defaultIvaTemplate, setDefaultIvaTemplate] = useState('')
  const [defaultIvaEnabled, setDefaultIvaEnabled] = useState(false)



  // Calcular si hay datos cargados (para lógica de readonly en paste mode)
  const hasLoadedData = rows.some(r => r.item_name && r.item_name.trim())



  const columns = getColumns({
    importMode,
    inputMode,
    hasLoadedData,
    itemGroups,
    uoms,
    warehouses,
    availableExpenseAccounts,
    availableIncomeAccounts,
    taxTemplateOptions
  })

  useEffect(() => {
    if (!Array.isArray(taxTemplateOptions) || taxTemplateOptions.length === 0) {
      setDefaultIvaTemplate('')
      setDefaultIvaEnabled(false)
      return
    }
    if (defaultIvaTemplate && !taxTemplateOptions.some(opt => opt.value === defaultIvaTemplate)) {
      setDefaultIvaTemplate('')
      setDefaultIvaEnabled(false)
    }
  }, [taxTemplateOptions, defaultIvaTemplate])

  useEffect(() => {
    if (!['insert', 'update'].includes(importMode)) {
      setDefaultIvaEnabled(false)
    }
  }, [importMode])

  useEffect(() => {
    if (!defaultIvaEnabled || !defaultIvaTemplate) return
    setRows(prevRows => {
      let changed = false
      const updated = prevRows.map(row => {
        if (!row || row.iva_template === defaultIvaTemplate) {
          return row
        }
        changed = true
        return {
          ...row,
          iva_template: defaultIvaTemplate,
          errors: { ...(row.errors || {}), iva_template: null },
          hasChanges: true
        }
      })
      if (changed) {
        setTableKey(prev => prev + 1)
        return updated
      }
      return prevRows
    })
  }, [defaultIvaEnabled, defaultIvaTemplate, setRows, setTableKey])

  useEffect(() => {
    if (!defaultIvaEnabled || !defaultIvaTemplate) return
    setRows(prevRows => {
      let changed = false
      const updated = prevRows.map(row => {
        if (!row) return row
        if (row.iva_template && row.iva_template.trim() !== '') return row
        changed = true
        return {
          ...row,
          iva_template: defaultIvaTemplate,
          errors: { ...(row.errors || {}), iva_template: null },
          hasChanges: true
        }
      })
      if (changed) {
        setTableKey(prev => prev + 1)
        return updated
      }
      return prevRows
    })
  }, [rows.length, defaultIvaEnabled, defaultIvaTemplate, setRows, setTableKey])

  useEffect(() => {
    if (activeCompany) {
      ItemImportApi.fetchItemGroups(fetchWithAuth).then(setItemGroups)
      ItemImportApi.fetchUoms(fetchWithAuth).then(setUoms)
      ItemImportApi.fetchWarehouses(fetchWithAuth, activeCompany).then(warehouseData => {
        // Usar warehouseData.flat y filtrar variantes de consignación
        const flatWarehouses = warehouseData.flat || []
        const filtered = flatWarehouses.filter(w => !w.is_consignment_variant)
        setWarehouses(filtered)
      })
      ItemImportApi.fetchAvailableAccounts(fetchWithAuth).then(({ expenseAccounts, incomeAccounts }) => {
        setAvailableExpenseAccounts(expenseAccounts)
        setAvailableIncomeAccounts(incomeAccounts)
      })
      ItemImportApi.fetchAvailablePurchasePriceLists(fetchWithAuth).then(lists => {
        setAvailablePriceLists(lists)
      })
      ItemImportApi.loadAllItems(fetchWithAuth, activeCompany, importMode, selectedWarehouse).then(setAllItems)
    }
  }, [activeCompany])

  // Inicializar selectedWarehouse con el primer warehouse disponible
  useEffect(() => {
    if (warehouses.length > 0 && !selectedWarehouse) {
      setSelectedWarehouse(warehouses[0].name)
    }
  }, [warehouses, selectedWarehouse])

  // Cargar información de la lista de precios seleccionada
  useEffect(() => {
    const loadPriceListInfo = async () => {
      if (selectedPriceLists.length === 1) {
        const info = await ItemImportApi.fetchPurchasePriceListInfo(fetchWithAuth, selectedPriceLists[0])
        setSelectedPriceListInfo(info)
      } else {
        setSelectedPriceListInfo(null)
      }
    }

    loadPriceListInfo()
  }, [selectedPriceLists, fetchWithAuth])

  // Reset filter when import mode changes
  useEffect(() => {
    setActiveFilter('none')
  }, [importMode])

  // Initialize inputMode when importMode changes
  useEffect(() => {
    if (['update', 'stock', 'bulk-update-fields'].includes(importMode)) {
      // Para modo 'update', FORZAR siempre 'paste' (nunca cargar automáticamente todos los items)
      if (importMode === 'update') {
        setInputMode(prev => ({ ...prev, [importMode]: 'paste' }))
        // Reset rows to empty when switching to update mode to prevent automatic validation of previous data
        setRows([{
          id: 1,
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
          platform: '',
          url: '',
          expense_account: '',
          income_account: '',
          delete_selection: false,
          hasChanges: false,
          errors: {}
        }])
        setTableKey(prev => prev + 1) // Force iframe re-render
      } else if (!inputMode[importMode]) {
        // Para otros modos, usar 'paste' por defecto si no está definido
        setInputMode(prev => ({ ...prev, [importMode]: 'paste' }))
      }
    }
  }, [importMode]) // Removed inputMode from dependencies to prevent infinite loop

  // Forzar re-render del botón cuando cambian los filtros o el conteo filtrado
  useEffect(() => {
    setButtonKey(prev => prev + 1)
  }, [filteredRowCount, activeFilter])

  // Cuando cambie el almacén seleccionado en modo stock, recargar items locales
  useEffect(() => {
    if (importMode === 'stock' && selectedWarehouse) {
      ItemImportApi.loadAllItems(fetchWithAuth, activeCompany, importMode, selectedWarehouse).then(setAllItems)
    }
  }, [selectedWarehouse, importMode])

  // Enviar configuración de tabla al iframe cuando cambian columns, rows o warehouses
  useEffect(() => {
    // No enviar durante procesamiento masivo para evitar sobrecarga
    if (bulkProcessing) {
      return
    }

    // Debounce sending to iframe to avoid racing with ht-data-changed (pastes)
    if (postMessageTimerRef.current) {
      clearTimeout(postMessageTimerRef.current)
    }

    postMessageTimerRef.current = setTimeout(() => {
      if (!iframeRef.current || !iframeRef.current.contentWindow) return

      // If instructed to ignore next send (e.g. right after processing incoming ht-data-changed), skip once
      if (ignoreNextSendRef.current) {
        ignoreNextSendRef.current = false
        return
      }

      const allRows = rows

      // Use shared computeVisibleItems to apply common filters (including duplicates behavior when importMode === 'insert')
      const filteredRows = computeVisibleItems(allRows, { activeFilter, selectedRows, visibleRowIds: null, importMode })

      // compute per-row highlight: 'duplicate' -> red, 'error' -> yellow, null -> none
      const duplicateSet = (() => {
        const codes = filteredRows.map(r => r.item_code).filter(Boolean)
        const dupes = codes.filter((c, i) => codes.indexOf(c) !== i)
        return new Set(dupes)
      })()

      const rowHighlights = filteredRows.map(r => {
        // En modo insert, items existentes se marcan como duplicate (rojo)
        if (importMode === 'insert' && r.errors?.item_code && r.errors.item_code.includes('ya existe')) {
          return 'duplicate'
        }
        if (r.item_code && duplicateSet.has(r.item_code)) return 'duplicate'
        if (r.errors && Object.keys(r.errors).some(k => r.errors[k])) return 'error'
        return null
      })

      const dataArray = filteredRows.map(row => columns.map(col => {
        if (col.key === 'selected') {
          return selectedRows.has(row.id)
        }
        return row[col.key] || ''
      }))
      const rowIds = filteredRows.map(r => r.id)
      lastSentRowIdsRef.current = rowIds
      iframeRef.current.contentWindow.postMessage({
        type: 'ht-configure-table',
        columns: columns,
        data: dataArray,
        rowIds,
        rowHighlights,
        selectAll: selectAll,
        loadingData: loadingData
      }, '*')
    }, 120)

    return () => {
      if (postMessageTimerRef.current) {
        clearTimeout(postMessageTimerRef.current)
        postMessageTimerRef.current = null
      }
    }
  }, [columns, rows, warehouses, columnFilters, availableExpenseAccounts, availableIncomeAccounts, importMode, hasLoadedData, activeFilter, selectedRows, bulkProcessing, loadingData])

  // Escuchar cambios de datos desde el iframe
  useEffect(() => {
    const handleMessage = (event) => {
      try {
        const msg = event.data || {}
        if (!msg || typeof msg !== 'object') return

          if (msg.type === 'ht-data-changed') {
            console.log('PARENT: Received ht-data-changed', { pasteInSku: msg.pasteInSku, dataLength: Array.isArray(msg.data) ? msg.data.length : 0, rowIdsLength: Array.isArray(msg.rowIds) ? msg.rowIds.length : 0, importMode })
          const newDataArray = Array.isArray(msg.data) ? msg.data : []
          const rowIds = Array.isArray(msg.rowIds) ? msg.rowIds : []

          // Changes coming from iframe -> avoid immediately re-sending the full table back
          // Set flag and schedule it to reset after the debounce period + margin
          ignoreNextSendRef.current = true
          setTimeout(() => {
            ignoreNextSendRef.current = false
          }, 200) // 120ms debounce + 80ms margin

          // Build a map of existing rows by ID
          const prevById = new Map(rows.map(r => [r.id, r]))
          let maxId = Math.max(...rows.map(r => typeof r.id === 'number' ? r.id : 0), 0)

          // Map incoming data arrays to objects
          const incomingRows = newDataArray.map((rowArr, idx) => {
            const obj = {}
            columns.forEach((col, cidx) => {
              obj[col.key] = rowArr[cidx]
            })
            
            const id = rowIds[idx]
            if (id !== undefined && id !== null) {
              // Has ID: update existing or keep as-is
              obj.id = id
              if (prevById.has(id)) {
                const prevRow = prevById.get(id)
                obj.errors = prevRow.errors || {}
                
                // Detectar cambios para marcar hasChanges
                obj.original_snapshot = prevRow.original_snapshot || prevRow
                if (importMode === 'bulk-update-fields') {
                  // Para bulk-update-fields, solo marcar hasChanges si cambiaron las columnas permitidas
                  const allowedFields = ['item_code']
                  if (inputMode[importMode] === 'paste') {
                    allowedFields.push('item_code')
                  }
                  
                  // Verificar si alguna columna permitida cambió
                  const hasChanged = allowedFields.some(field => {
                    const prevValue = prevRow[field] || ''
                    const newValue = obj[field] || ''
                    return String(prevValue) !== String(newValue)
                  })
                  
                  obj.hasChanges = prevRow.hasChanges || hasChanged
                } else {
                  // Para otros modos, marcar hasChanges si cualquier campo cambió
                  const baseline = prevRow.original_snapshot || prevRow
                  const hasChanged = columns.some(col => {
                    const prevValue = baseline[col.key] || ''
                    const newValue = obj[col.key] || ''
                    return String(prevValue) !== String(newValue)
                  })
                  obj.hasChanges = hasChanged
                }
                if (msg.pasteInSku && ['update', 'stock', 'bulk-update-fields'].includes(importMode)) {
                  obj.hasChanges = false
                }
              } else {
                obj.errors = {}
                obj.hasChanges = false
                obj.original_snapshot = { ...obj }
              }
            } else {
              // No ID: solo crear nueva fila si estamos pegando datos (no para cambios simples como checkbox)
              if (msg.pasteInSku || newDataArray.length > rows.length) {
                maxId++
                obj.id = maxId
                obj.errors = {}
                obj.delete_selection = false
                obj.hasChanges = false
                obj.original_snapshot = { ...obj }
              } else {
                // Si no hay ID y no estamos pegando, ignorar esta fila (debería ser un error de Handsontable)
                return null
              }
            }
            return obj
          }).filter(row => row !== null) // Filtrar filas null


          // Manejar cambios en la columna 'selected' para actualizar selectedRows
          const selectedIndex = columns.findIndex(col => col.key === 'selected')
          if (selectedIndex !== -1) {
            const newSelectedRows = new Set(selectedRows) // Mantener selecciones previas
            incomingRows.forEach(row => {
              if (row.selected) {
                newSelectedRows.add(row.id)
              } else {
                newSelectedRows.delete(row.id)
              }
            })
          }

          // If this change came from pasting SKUs, incomingRows may contain
          // partial values filled by the iframe. To avoid showing a partial
          // preview (and then replacing it with a richer result), only apply
          // a minimal row update here with the item_code (and selection state).
          // The subsequent recognizeSkus processing will merge the full data
          // (including description and iva_template) into these rows.
          if (msg.pasteInSku) {
            console.log('PARENT: ht-data-changed indicates pasteInSku=true; applying minimal rows and deferring full merge to recognizeSkus')
            const minimalRows = incomingRows.map(r => ({
              id: r.id,
              selected: r.selected || false,
              item_code: r.item_code || '',
              errors: r.errors || {},
              delete_selection: r.delete_selection || false,
              hasChanges: false
            }))
            console.log('PARENT: setRows(minimalRows) count=', minimalRows.length)
            setRows(minimalRows)
            setLoadingData(true) // Deshabilitar edición durante recognizeSkus
          } else {
            console.log('PARENT: applying full incomingRows count=', incomingRows.length)
            // show small sample for debugging
            console.log('PARENT: sample incomingRow[0]:', incomingRows[0])
            setRows(incomingRows)
          }

          // Recalcular hasChanges contra el snapshot original (ignorar columnas de seleccion)
          setRows(prev => {
            const dataCols = columns.filter(col => !['selected', 'delete_selection'].includes(col.key))
            return prev.map(row => {
              const baseline = row.original_snapshot || { ...row, hasChanges: false }
              const changed = dataCols.some(col => {
                const prevValue = baseline[col.key] || ''
                const newValue = row[col.key] || ''
                return String(prevValue) !== String(newValue)
              })
              return { ...row, hasChanges: changed }
            })
          })

          // Verificar si hay códigos de item que necesiten búsqueda masiva (solo desde pegado de SKUs)
          const itemCodesToFetch = []
          if (msg.pasteInSku) {
            newDataArray.forEach((rowArr) => {
              const itemCodeIndex = columns.findIndex(col => col.key === 'item_code')
              if (itemCodeIndex !== -1) {
                const itemCode = rowArr[itemCodeIndex]
                if (itemCode && itemCode.trim()) {
                  itemCodesToFetch.push(itemCode.trim())
                }
              }
            })
          }


          // Si hay códigos para buscar masivamente, hacerlo
          if (itemCodesToFetch.length > 0 && (msg.pasteInSku || importMode === 'insert' || ['update', 'stock', 'bulk-update-fields'].includes(importMode))) {
            const isBulkOperation = itemCodesToFetch.length > 50 // Considerar masivo si hay más de 50 SKUs

            // Función helper para procesar los resultados de recognizeSkus
            const processRecognizeResults = (recognized, companyAbbr) => {
              // Convertir Map a Map con iva_template procesado
              const bulkResults = new Map()
              recognized.forEach((item, sku) => {
                // Convertir iva_rate a iva_template (string) para compatibilidad con el selector
                const ivaRateStr = item.iva_rate != null ? String(item.iva_rate) : ''
                const processedItem = {
                  ...item,
                  iva_template: ivaRateStr,
                  ...(importMode === 'insert' ? { exists: true } : {})
                }
                // Clean display name by removing company abbreviation suffix when provided
                if (companyAbbr && processedItem.item_name) {
                  processedItem.item_name = removeCompanyAbbr(processedItem.item_name, companyAbbr)
                }
                bulkResults.set(sku, processedItem)
              })
              return bulkResults
            }

            // Función helper para actualizar las filas con los resultados
            const updateRowsWithResults = (bulkResults) => {
              console.log('PARENT: updateRowsWithResults called, bulkResults.size=', bulkResults?.size)
              // Contar items existentes en modo insert
              let existingCount = 0
              if (importMode === 'insert') {
                existingCount = Array.from(bulkResults.values()).filter(result => result.exists).length
              }

              // Actualizar las filas con los datos obtenidos
              setRows(currentRows => {
                console.log('PARENT: updateRowsWithResults - applying merge to currentRows count=', currentRows.length)
                return currentRows.map(row => {
                  if (row.item_code && bulkResults.has(row.item_code)) {
                    const itemData = bulkResults.get(row.item_code)
                    // En modo insert, marcar como error si existe
                    if (importMode === 'insert' && itemData.exists) {
                      return {
                        ...row,
                        errors: {
                          ...row.errors,
                          item_code: `⚠️ Item ya existe - Use "Actualizar Existentes"`
                        }
                      }
                    }
                    // En otros modos, cargar los datos del item
                    else if (['update', 'stock', 'bulk-update-fields'].includes(importMode)) {
                      const merged = { ...row, ...itemData }
                      return {
                        ...merged,
                        errors: { ...row.errors, item_code: null },
                        original_snapshot: { ...merged, hasChanges: false },
                        hasChanges: false
                      }
                    }
                  }
                  return row
                })
              })
              console.log('PARENT: updateRowsWithResults - setRows completed')

              // Notificación especial para modo insert
              if (importMode === 'insert' && existingCount > 0) {
                showNotification(
                  `${itemCodesToFetch.length} filas procesadas. ⚠️ ${existingCount} SKU(s) ya existe(n) - marcados en rojo. Use "Actualizar Existentes" para modificarlos.`,
                  'warning'
                )
              }

              setTableKey(prev => prev + 1) // Forzar re-render
            }

                if (isBulkOperation) {
              setBulkProcessing(true)

              // Mantener ignore flag por más tiempo en operaciones masivas
              if (bulkProcessingTimeoutRef.current) {
                clearTimeout(bulkProcessingTimeoutRef.current)
              }
              bulkProcessingTimeoutRef.current = setTimeout(() => {
                setBulkProcessing(false)
                ignoreNextSendRef.current = false
              }, 3000) // 3 segundos para operaciones masivas

              // Retrasar para evitar sobrecargar
                  setTimeout(async () => {
                try {
                  const { recognized, companyAbbr } = await ItemImportApi.recognizeSkus(
                    fetchWithAuth,
                    itemCodesToFetch,
                    activeCompany,
                    importMode,
                    null // No mostrar notificación aquí
                  )
                      console.log('PARENT: recognizeSkus returned recognized count=', recognized ? Array.from(recognized.keys()).length : 0)
                      const bulkResults = processRecognizeResults(recognized, companyAbbr)
                      console.log('PARENT: processed bulkResults size=', bulkResults.size)
                      updateRowsWithResults(bulkResults)
                } catch (error) {
                  console.error('Error en recognizeSkus masivo desde ht-data-changed:', error)
                } finally {
                  setBulkProcessing(false)
                  setLoadingData(false) // Rehabilitar edición
                  if (bulkProcessingTimeoutRef.current) {
                    clearTimeout(bulkProcessingTimeoutRef.current)
                  }
                }
              }, 500) // Retrasar 500ms para evitar sobrecarga inmediata
            } else {
              // Operación normal (pocos SKUs)
              ItemImportApi.recognizeSkus(
                fetchWithAuth,
                itemCodesToFetch,
                activeCompany,
                importMode,
                null // No mostrar notificación aquí

                // Ensure we also capture companyAbbr when available
              ).then(({ recognized, companyAbbr }) => {
                // Permitir envío de datos actualizados al iframe
                ignoreNextSendRef.current = false
                console.log('PARENT: recognizeSkus (non-bulk) returned recognized count=', recognized ? Array.from(recognized.keys()).length : 0)
                const bulkResults = processRecognizeResults(recognized, companyAbbr)
                console.log('PARENT: non-bulk processed bulkResults size=', bulkResults.size)
                updateRowsWithResults(bulkResults)
                setLoadingData(false) // Rehabilitar edición
              }).catch(error => {
                console.error('Error en recognizeSkus desde ht-data-changed:', error)
                setLoadingData(false) // Rehabilitar edición en caso de error
              })
            }
          }

          // No validar automáticamente durante operaciones de paste - el usuario valida manualmente cuando quiere
        }

        if (msg.type === 'ht-cell-changed') {
          // Si es un cambio en la columna de selección
          try {
            if (msg.colKey === 'selected') {
              // Usar rowId si está disponible, sino usar rowIndex + 1
              const itemId = msg.rowId !== undefined ? msg.rowId : (msg.rowIndex + 1)



              // Actualizar selectedRows directamente con el itemId
              setSelectedRows(prev => {
                const next = new Set(prev)
                if (msg.value) {
                  next.add(itemId)
                } else {
                  next.delete(itemId)
                }

                return next
              })
            }
          } catch (selErr) {
            console.error('Error handling ht-cell-changed selection:', selErr)
          }
        }

        if (msg.type === 'ht-toggle-select-all') {
          toggleSelectAll()
          // Forzar re-render para actualizar el checkbox en el header
          setTableKey(prev => prev + 1)
        }

        if (msg.type === 'ht-rows-removed') {
          // iframe reports explicit removed row ids (preferred)
          const removedIds = msg.removedIds
          setRows(prev => {
            // Remove only the ids reported
            const next = prev.filter(r => !removedIds.includes(r.id))
            return next
          })
          // Also clear selection
          setSelectedRows(prev => {
            const ns = new Set(prev)
            removedIds.forEach(id => ns.delete(id))
            return ns
          })
          // Reset filtered count when rows change
        }

        if (msg.type === 'ht-filters-changed') {
          setFilteredRowCount(msg.filteredRowCount)
        }
      } catch (e) {
        console.debug('Error processing iframe message', e)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [columns])

  // Cargar items existentes cuando se selecciona modo 'update' o 'stock'
  useEffect(() => {
    if (importMode === 'stock' && inputMode[importMode] === 'all' && activeCompany) {
      // Solo cargar items existentes en modo stock cuando está en "Cargar Todos"
      ;(async () => {
        setLoadingData(true)
        try {
          if (typeof refreshTaxTemplates === 'function') await refreshTaxTemplates()
        } catch (err) {
          console.debug('Error refreshing tax templates:', err)
        }

        try {
          const itemsRows = await ItemImportApi.loadExistingItems(
            fetchWithAuth,
            activeCompany,
            importMode,
            selectedWarehouse,
            warehouses,
            showNotification
          )
          setRows(itemsRows)
          setTableKey(prev => prev + 1)
        } catch (err) {
          console.debug('Error loading existing items:', err)
        } finally {
          setLoadingData(false)
        }
      })()
    } else if (importMode === 'bulk-update-fields' && inputMode[importMode] === 'all' && activeCompany) {
      // Solo cargar items existentes en modo bulk-update-fields cuando está en "Cargar Todos"
      ;(async () => {
        setLoadingData(true)
        try {
          if (typeof refreshTaxTemplates === 'function') await refreshTaxTemplates()
        } catch (err) {
          console.debug('Error refreshing tax templates:', err)
        }

        try {
          const itemsRows = await ItemImportApi.loadExistingItems(
            fetchWithAuth,
            activeCompany,
            importMode,
            selectedWarehouse,
            warehouses,
            showNotification
          )
          setRows(itemsRows)
          setTableKey(prev => prev + 1)
        } catch (err) {
          console.debug('Error loading existing items:', err)
        } finally {
          setLoadingData(false)
        }
      })()
    } else if (importMode === 'bulk-update-fields' && inputMode[importMode] === 'paste') {
      // En modo bulk-update-fields con paste mode, iniciar con una fila vacía para pegar datos
      setRows([{
        id: 1,
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
        platform: '',
        url: '',
        expense_account: '',
        income_account: '',
        delete_selection: false,
        hasChanges: false,
        errors: {}
      }])
      setCsvFile(null)
      setCsvData([])
      setCsvHeaders([])
      setLoadingData(false)
    } else if (importMode === 'insert') {
      // Resetear a una fila vacía cuando se cambia a modo insert
      setRows([{
        id: 1,
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
        platform: '',
        url: '',
        expense_account: '',
        income_account: '',
        delete_selection: false,
        hasChanges: false,
        errors: {}
      }])
      setLoadingData(false)
    } else if ((importMode === 'update' || importMode === 'stock') && inputMode[importMode] === 'paste') {
      // Para update y stock en modo paste, iniciar con fila vacía
      setRows([{
        id: 1,
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
        platform: '',
        url: '',
        expense_account: '',
        income_account: '',
        delete_selection: false,
        hasChanges: false,
        errors: {}
      }])
      setLoadingData(false)
    }
  }, [importMode, activeCompany, inputMode])

  // Handle inputMode changes
  useEffect(() => {
    // EXCLUSIÓN: Modo 'update' nunca carga automáticamente todos los items
    // Solo debe usarse para pegar SKUs específicos
    // NOTE: 'update' should not auto-load when switching modes, but when the user explicitly
    // clicks "Cargar Todos" (which sets inputMode[importMode] = 'all'), we must honor it.
    if (['stock', 'bulk-update-fields', 'update'].includes(importMode) && activeCompany) {
      const currentInputMode = inputMode[importMode] || 'paste' // Ahora por defecto es 'paste'
      if (currentInputMode === 'all') {
        // Use an async IIFE to allow awaits inside the effect
        ;(async () => {
          setLoadingData(true)
          // When user requested "Cargar Todos" we also need tax templates available.
          // Load tax templates lazily here (refreshTaxTemplates is safe; hook won't re-fetch too often due to internal cache).
          try {
            if (typeof refreshTaxTemplates === 'function') await refreshTaxTemplates()
          } catch (err) {
            console.debug('Error loading tax templates before loading items:', err)
          }

          try {
            const itemsRows = await ItemImportApi.loadExistingItems(
              fetchWithAuth,
              activeCompany,
              importMode,
              selectedWarehouse,
              warehouses,
              showNotification
            )
            setRows(itemsRows)
            setTableKey(prev => prev + 1)
            setFilteredRowCount(null) // Reset filtered count when loading new data
          } catch (err) {
            console.debug('Error loading existing items:', err)
          } finally {
            setLoadingData(false)
          }
        })()
      } else if (currentInputMode === 'paste') {
        // Reset to empty row for paste mode
        setRows([{
          id: 1,
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
          platform: '',
          url: '',
          expense_account: '',
          income_account: '',
          delete_selection: false,
          hasChanges: false,
          errors: {}
        }])
        setCsvFile(null)
        setCsvData([])
        setCsvHeaders([])
        setFilteredRowCount(null) // Reset filtered count when switching to paste mode
        setLoadingData(false)
      }
    }
  }, [inputMode, importMode, activeCompany])


  // Obtener tasa de cambio entre dos monedas
  const fetchExchangeRateBetweenCurrencies = async (fromCurrency, toCurrency) => {
    if (fromCurrency === toCurrency) return 1
    
    try {
      const from = (fromCurrency || '').toString().trim()
      const to = (toCurrency || '').toString().trim()
      if (!from || !to) {
        throw new Error('Moneda origen/destino requerida para obtener cotización')
      }

      const requester = fetchWithAuth || fetch
      const response = await requester(
        `/api/currency/exchange-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `No se pudo obtener cotización (${response.status})`)
      }
      const rate = data.exchange_rate ?? data.data?.exchange_rate
      if (!(Number(rate) > 0)) {
        throw new Error('Cotización inválida o no encontrada')
      }
      return Number(rate)
    } catch (error) {
      console.error('Error fetching exchange rate between currencies:', error)
      throw error
    }
    
    throw new Error(`No se pudo obtener la tasa de cambio entre ${fromCurrency} y ${toCurrency}`)
  }
  const createNewItemGroup = async (groupName) => {
    if (!groupName.trim()) return
    
    setAddingItemGroup(true)
    try {
      const response = await fetchWithAuth(`${API_ROUTES.inventory}/item-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_group_name: groupName.trim() })
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(`Grupo "${groupName}" creado exitosamente`, 'success')
          // Recargar grupos para incluir el nuevo
          ItemImportApi.fetchItemGroups(fetchWithAuth).then(setItemGroups)
          // Establecer el nuevo grupo como valor por defecto
          setDefaultConfig(prev => ({ ...prev, value: data.data.name }))
        } else {
          showNotification(data.message || 'Error al crear el grupo', 'error')
        }
      } else {
        showNotification('Error al crear el grupo', 'error')
      }
    } catch (error) {
      console.error('Error creating item group:', error)
      showNotification('Error al crear el grupo', 'error')
    } finally {
      setAddingItemGroup(false)
    }
  }

  // Versión local de fetchItemByCode que usa datos pre-cargados
  const fetchItemByCodeFromLocal = (item) => {
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
      
      // Resolver el warehouse name para asegurar que sea el name completo
      if (default_warehouse && warehouses) {
        const resolved = resolveWarehouseValue(default_warehouse, warehouses)
        if (resolved) {
          default_warehouse = resolved
        }
      }
    }


    if (importMode === 'stock') {
      // En modo stock, usar el stock específico del almacén seleccionado
      let currentStock = 0
      if (selectedWarehouse && item.stock_by_warehouse) {
        // Buscar el stock en el almacén específico
        const warehouseStock = item.stock_by_warehouse.find(ws => ws.warehouse === selectedWarehouse)
        if (warehouseStock) {
          currentStock = warehouseStock.actual_qty || 0
        }
      } else {
        // Fallback al stock general si no hay warehouse específico
        currentStock = item.available_qty || 0
      }

      return {
        item_code: item.item_code || '',
        item_name: item.item_name || '',
        current_stock: currentStock, // Stock del almacén seleccionado
        new_stock: '',
        warehouse: selectedWarehouse || default_warehouse, // Usar almacén seleccionado
        default_warehouse: default_warehouse,
        valuation_rate: item.valuation_rate || item.standard_rate || '',
        original_valuation_rate: item.valuation_rate || item.standard_rate || '', // Guardar valor original
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

  const addRow = () =>
    ItemImportActions.addRow({ rows, setRows })

  const handleClearTable = useCallback(() => {
    setRows([ItemImportActions.createEmptyRow(1)])
    lastSentRowIdsRef.current = []
    ignoreNextSendRef.current = true
    resetSelectionHelper(setSelectedRows, setSelectAll, setActiveFilter, setFilteredRowCount)
    setShowOnlySelected(false)
    setShowOnlyDuplicates(false)
    setColumnFilters({})
    try {
      const iframeWindow = iframeRef?.current?.contentWindow
      if (iframeWindow) {
        iframeWindow.postMessage({ type: 'ht-clear-table' }, '*')
      }
    } catch (error) {
      console.debug('Error clearing item import table', error)
    }
    showNotification('Tabla vaciada. Esto no elimina items en ERPNext.', 'info')
  }, [showNotification])



  // Aplicar valor por defecto a toda una columna (solo a filas filtradas)
  const applyDefaultValue = (column, value) =>
    ItemImportActions.applyDefaultValue({
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
    })

  // Copiar columna completa al portapapeles
  const copyColumnToClipboard = (column) =>
    ItemImportActions.copyColumnToClipboard({
      column,
      rows,
      columnFilters,
      showNotification
    })

  // Limpiar columna completa (borrar todos los valores)
  const clearColumn = (column) =>
    ItemImportActions.clearColumn({
      column,
      rows,
      setRows,
      columns,
      showNotification
    })







  // duplicate/error filter UI removed — we render highlights and let table filtering handle visibility

  // Helper: find first problem and focus it (or clear if none)
  const findAndFocusFirstProblem = () =>
    ItemImportActions.findAndFocusFirstProblem({
      rows,
      columns,
      iframeRef,
      importMode
    })

  const deleteRow = (id) =>
    ItemImportActions.deleteRow({
      id,
      rows,
      setRows,
      setSelectedRows
    })

  // Funciones para selección múltiple
  const toggleRowSelection = (rowId) =>
    ItemImportActions.toggleRowSelection({
      rowId,
      setSelectedRows
    })

  const toggleSelectAll = () =>
    ItemImportActions.toggleSelectAll({
      rows,
      columnFilters,
      setSelectedRows,
      activeFilter,
      importMode,
      selectedRows
    })

  // Actualizar selectAll cuando cambian las selecciones
  useEffect(() => {
    const visibleRows = rows // rows ya está filtrado por el iframe
    const visibleIds = visibleRows.map(row => row.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedRows.has(id))
    const someSelected = visibleIds.some(id => selectedRows.has(id))
    setSelectAll(allSelected && someSelected)
  }, [selectedRows, rows, columnFilters, activeFilter])

  // Función para eliminar múltiples items
  const deleteSelectedItems = () =>
    ItemImportActions.deleteSelectedItems({
      selectedRows,
      importMode,
      rows,
      setRows,
      setSelectedRows,
      setSelectAll,
      showNotification,
      setShowDeleteModal
    })

  // Función que ejecuta la eliminación después de confirmar
  const executeDeleteSelectedItems = async () => {
    setShowDeleteModal(false)
    await ItemImportActions.executeDeleteSelectedItems({
      selectedRows,
      rows,
      fetchWithAuth,
      setRows,
      setSelectedRows,
      showNotification
    })
  }

  // Validar todas las filas para reglas de negocio
  const validateAllRows = () =>
    ItemImportActions.validateAllRows({
      setRows,
      importMode
    })

  const updateCell = (id, field, value) =>
    ItemImportActions.updateCell({
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
      fetchItemByCodeFromLocal
    })

  // Manejar paste desde Excel
  const handlePaste = (event, rowId, field) =>
    ItemImportActions.handlePaste({
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
      updateCell: ({ id, field: targetField, value: newValue }) => updateCell(id, targetField, newValue)
    })

  const generatePattern = (column, pattern, startFrom) =>
    ItemImportActions.generatePattern({
      column,
      pattern,
      startFrom,
      rows,
      setRows,
      showNotification
    })



  const validateRows = () =>
    ItemImportActions.validateRows({
      rows,
      columns,
      setRows
    })

  const importItems = () =>
    ItemImportActions.importItems({
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
    })

  const openPatternModal = (column) => {
    const colDef = columns.find(c => c.key === column)
    setPatternConfig({
      column,
      pattern: colDef?.defaultPattern || '',
      start: 1
    })
    
    // Calcular posición debajo del header de la tabla
    if (tableHeaderRef.current) {
      const rect = tableHeaderRef.current.getBoundingClientRect()
      setPatternModalPosition({
        x: Math.max(20, rect.left),
        y: rect.bottom + 10
      })
    }
    
    setShowPatternModal(true)
  }

  const applyPattern = () => {
    generatePattern(patternConfig.column, patternConfig.pattern, patternConfig.start)
    setShowPatternModal(false)
  }

  // Resolver un valor de warehouse (puede venir como name o como warehouse_name) -> devolver el canonical w.name
  const normalizeRowsWarehouses = () =>
    ItemImportActions.normalizeRowsWarehouses({
      warehouses,
      setRows,
      setTableKey
    })

  // Función para manejar la selección de archivo CSV
  const processCsvFile = (file) =>
    ItemImportActions.processCsvFile({
      file,
      setProcessingCsv,
      showNotification,
      setCsvHeaders,
      setCsvData,
      setRows
    })

  const handleCsvFileSelect = (event) =>
    ItemImportActions.handleCsvFileSelect({
      event,
      setCsvFile,
      processCsvFile: ({ file }) => processCsvFile(file)
    })

  // Función para aplicar bulk update
  const onApplyBulkUpdate = async () => {
    if (!bulkUpdateConfig.field || !bulkUpdateConfig.value) {
      showNotification('Por favor selecciona un campo y un valor', 'warning')
      return
    }

    if (!activeCompany) {
      showNotification('No hay compañía activa', 'error')
      return
    }

    setApplyingBulkUpdate(true)
    try {
      // Obtener items visibles (rows ya está filtrado por el iframe)
      const visibleRows = rows
      const itemCodes = visibleRows
        .map(row => row.item_code)
        .filter(code => code && code.trim())

      if (itemCodes.length === 0) {
        showNotification('No hay items visibles para actualizar', 'warning')
        return
      }

      showNotification(`Actualizando ${itemCodes.length} items...`, 'info')

      // Llamar a la API de bulk update
      const response = await fetchWithAuth('/api/inventory/items/bulk-update-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_codes: itemCodes,
          field: bulkUpdateConfig.field,
          value: bulkUpdateConfig.value,
          company: activeCompany
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(data.message, 'success')
          setBulkUpdateConfig({ field: '', value: '' })
          
          // Recargar los items para reflejar los cambios
          if (inputMode[importMode] === 'all') {
            ItemImportApi.loadExistingItems(
              fetchWithAuth,
              activeCompany,
              importMode,
              selectedWarehouse,
              warehouses,
              showNotification
            ).then(itemsRows => {
              setRows(itemsRows)
              setTableKey(prev => prev + 1)
            })
          }
        } else {
          showNotification(data.message || 'Error en la actualización', 'error')
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'Error en la actualización', 'error')
      }
    } catch (error) {
      console.error('Error aplicando bulk update:', error)
      showNotification('Error al aplicar la actualización masiva', 'error')
    } finally {
      setApplyingBulkUpdate(false)
    }
  }


  
  // PortalSelect: renders a simple dropdown in document.body to avoid clipping/overflow issues
  const PortalSelect = ({ options, value, onChange, anchorRect, onClose }) => {
    if (!anchorRect) return null
    const style = {
      position: 'absolute',
      left: anchorRect.left + window.scrollX,
      top: anchorRect.bottom + window.scrollY,
      minWidth: Math.max(200, anchorRect.width),
      maxHeight: 300,
      overflowY: 'auto',
      zIndex: 2147483647,
      background: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      boxShadow: '0 6px 18px rgba(0,0,0,0.12)'
    }

    return createPortal(
      <div style={style} onMouseLeave={onClose}>
        {options.map(opt => (
          <div
            key={opt.value}
            onMouseDown={(e) => { e.preventDefault(); onChange(opt.value); onClose() }}
            style={{ padding: '6px 10px', cursor: 'pointer', background: opt.value === value ? '#f1f5f9' : 'transparent' }}
            title={opt.label}
          >
            {opt.label}
          </div>
        ))}
      </div>,
      document.body
    )
  }

  return (
    <div className="h-full flex flex-col bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-visible">
      {loadingData && (
        <div className="absolute inset-0 z-50 flex items-center justify-center px-6">
          <div className="bg-white/90 backdrop-blur-lg shadow-2xl border border-gray-200/60 rounded-2xl px-8 py-6 flex flex-col items-center gap-4 max-w-md w-full text-center">
            <div className="w-28 h-28 rounded-xl overflow-hidden border border-blue-100 bg-blue-50 flex items-center justify-center">
              <img src={loadingStockGif} alt="Cargando items" className="w-full h-full object-contain" />
            </div>
            <div className="text-base font-semibold text-gray-800">Cargando items existentes...</div>
            <div className="text-sm text-gray-600 leading-snug">Obteniendo información y tasas de IVA — esto puede tardar un poco para catálogos grandes.</div>
          </div>
        </div>
      )}
  {/* Rendering ItemImport table */}
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        {/* Título arriba de los botones */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 rounded-xl flex items-center justify-center">
            <Upload className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500">Gestión</div>
            <div className="text-xl font-bold text-gray-800 flex items-center gap-2">
              Items
              {(loadingData || bulkProcessing) && (
                <div className="flex items-center gap-1 text-sm text-blue-600">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {bulkProcessing ? 'Procesando SKUs...' : 'Cargando...'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6">
          {/* Sección izquierda: Modos de importación */}
          <div className="flex items-center gap-4">
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setImportMode('update')}
                disabled={loadingData}
                className={`btn-mode-selector ${importMode === 'update' ? 'active' : ''} ${loadingData ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Actualizar Existentes
              </button>
              <button
                onClick={() => setImportMode('insert')}
                disabled={loadingData}
                className={`btn-mode-selector ${importMode === 'insert' ? 'active' : ''} ${loadingData ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Crear Nuevos
              </button>
              <button
                onClick={() => setImportMode('stock')}
                disabled={loadingData}
                className={`btn-mode-selector ${importMode === 'stock' ? 'active' : ''} ${loadingData ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Gestionar Stock
              </button>
              <button
                onClick={() => setImportMode('bulk-update-fields')}
                disabled={loadingData}
                className={`btn-mode-selector ${importMode === 'bulk-update-fields' ? 'active' : ''} ${loadingData ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Actualizar Campos
              </button>
            </div>
          </div>

          {/* Sección derecha: Modos de entrada + acciones */}
          <div className="flex items-center gap-4">
            {/* Select de almacén para modo stock */}
            {importMode === 'stock' && (
              <>
                <select
                  value={selectedWarehouse}
                  onChange={(e) => setSelectedWarehouse(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  style={{ minWidth: '150px' }}
                >
                  {(warehouses && Array.isArray(warehouses) ? warehouses : []).map(warehouse => (
                    <option key={warehouse.name} value={warehouse.name}>
                      {warehouse.warehouse_name}
                    </option>
                  ))}
                </select>
                <div className="h-8 w-px bg-gray-300"></div>
              </>
            )}

            {/* Input mode toggle for relevant modes */}
            {['update', 'stock', 'bulk-update-fields'].includes(importMode) && (
              <>
                <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
                  <button
                    onClick={() => setInputMode(prev => ({ ...prev, [importMode]: 'all' }))}
                    disabled={loadingData}
                    className={`btn-mode-selector ${inputMode[importMode] === 'all' ? 'active' : ''} ${loadingData ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title="Cargar todos los items existentes"
                  >
                    Cargar Todos
                  </button>
                  <button
                    onClick={() => setInputMode(prev => ({ ...prev, [importMode]: 'paste' }))}
                    disabled={loadingData}
                    className={`btn-mode-selector ${inputMode[importMode] === 'paste' ? 'active' : ''} ${loadingData ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title="Pegar códigos de items para cargar datos específicos"
                  >
                    Pegar SKUs
                  </button>
                </div>

                <div className="h-8 w-px bg-gray-300"></div>
              </>
            )}

            {['insert', 'update'].includes(importMode) && taxTemplateOptions.length > 0 && (
              <>
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
                  <label className="text-xs font-semibold text-gray-500">IVA por defecto</label>
                  <select
                    value={defaultIvaTemplate}
                    onChange={(e) => {
                      const nextValue = e.target.value
                      setDefaultIvaTemplate(nextValue)
                      if (!nextValue) {
                        setDefaultIvaEnabled(false)
                      }
                    }}
                    className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[180px]"
                  >
                    <option value="">Sin seleccionar</option>
                    {taxTemplateOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <label className={`flex items-center gap-1 text-xs ${defaultIvaTemplate ? 'text-gray-700' : 'text-gray-400'}`}>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      disabled={!defaultIvaTemplate}
                      checked={!!defaultIvaTemplate && defaultIvaEnabled}
                      onChange={(e) => setDefaultIvaEnabled(e.target.checked)}
                    />
                    Aplicar a todos
                  </label>
                </div>
                <div className="h-8 w-px bg-gray-300"></div>
              </>
            )}

            {/* Bulk update field selector for bulk-update-fields mode */}
            {importMode === 'bulk-update-fields' && (
              <>
                <div className="flex items-center gap-3">
                  <select
                    value={bulkUpdateConfig.field}
                    onChange={(e) => setBulkUpdateConfig(prev => ({ ...prev, field: e.target.value }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-[150px]"
                  >
                    <option value="">Seleccionar campo...</option>
                    <option value="item_name">Nombre</option>
                    <option value="description">Descripción</option>
                    <option value="item_group">Categoría</option>
                    <option value="brand">Marca</option>
                    <option value="stock_uom">Unidad de Medida</option>
                    <option value="is_stock_item">Tipo (Producto/Servicio)</option>
                    <option value="safety_stock">Stock de Seguridad</option>
                    <option value="min_order_qty">Cantidad Mínima de Pedido</option>
                    <option value="lead_time_days">Días de Entrega</option>
                    <option value="max_discount">Descuento Máximo (%)</option>
                    <option value="grant_commission">Otorga Comisión</option>
                    <option value="is_sales_item">Es Item de Venta</option>
                    <option value="is_purchase_item">Es Item de Compra</option>
                    <option value="custom_description_type">Tipo de Descripción</option>
                  </select>

                  <input
                    type="text"
                    value={bulkUpdateConfig.value}
                    onChange={(e) => setBulkUpdateConfig(prev => ({ ...prev, value: e.target.value }))}
                    placeholder="Ingrese el nuevo valor..."
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-[200px]"
                  />

                  {/* Removed redundant "Aplicar Actualización" button per UX request */}
                </div>

                <div className="h-8 w-px bg-gray-300"></div>
              </>
            )}

            {/* Icono único para ir al primer problema (duplicado/errores) */}
            <button
              onClick={() => findAndFocusFirstProblem()}
              className="btn-filter"
              title="Ir al primer duplicado/ error"
            >
              <AlertCircle className="w-3 h-3 text-red-600" />
            </button>
            
            {/* Botón para abrir modal de costos en modo stock */}
            {importMode === 'stock' && (
              <button
                onClick={() => setShowCostModal(true)}
                className="btn-filter"
                title="Aplicar costos desde lista de precios de compra"
              >
                <DollarSign className="w-3 h-3 text-green-600" />
              </button>
            )}

            <div className="h-8 w-px bg-gray-300"></div>

            {(() => {
              const validRows = getValidRowsHelper(rows, importMode, activeFilter === 'duplicates' && importMode === 'insert')
              
              // Contar items válidos con IVA asignado para insert/update
              const validRowsWithIva = validRows.filter(row => row.iva_template && String(row.iva_template).trim() !== '')
              
              const pendingCount = importMode === 'stock'
                ? validRows.filter(item => {
                    const valuationChanged = Math.abs(parseFloat(item.valuation_rate || 0) - parseFloat(item.original_valuation_rate || 0)) > 0.01
                    const stockChanged = Math.abs(parseFloat(item.new_stock || 0) - parseFloat(item.current_stock || 0)) > 0.001
                    return valuationChanged || stockChanged
                  }).length
                : importMode === 'bulk-update-fields'
                ? (filteredRowCount !== null ? filteredRowCount : getFilteredRowsHelper(rows, columnFilters).filter(r => r.item_code).length)
                : importMode === 'update'
                ? validRowsWithIva.filter(row => row.hasChanges).length
                : importMode === 'insert' && activeFilter === 'duplicates' && filteredRowCount !== null
                ? filteredRowCount
                : validRowsWithIva.length
              return (
                <button
                  key={buttonKey}
                  onClick={importMode === 'bulk-update-fields' ? onApplyBulkUpdate : importItems}
                  disabled={importing || (importMode !== 'bulk-update-fields' && pendingCount === 0)}
                  className="btn-action-success"
                >
                  {importing || (importMode === 'bulk-update-fields' && applyingBulkUpdate) ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      {importMode === 'bulk-update-fields' ? 'Actualizando...' : importMode === 'update' ? 'Actualizando...' : 'Importando...'}
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      {importMode === 'bulk-update-fields' 
                        ? `Actualizar Campos (${pendingCount})` 
                        : importMode === 'update' 
                        ? `Actualizar Items (${pendingCount})` 
                        : importMode === 'stock'
                        ? `Actualizar Stock/Costos (${pendingCount})`
                        : `Importar Items (${pendingCount})`
                      }
                    </>
                  )}
                </button>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Tabla estilo Excel */}
      {importMode === 'stock' && importing && (
        <div className="absolute inset-0 z-50 flex items-center justify-center px-6">
          <div className="bg-white/90 backdrop-blur-lg shadow-2xl border border-gray-200/60 rounded-2xl px-8 py-6 flex flex-col items-center gap-4 max-w-md w-full text-center">
            <div className="w-28 h-28 rounded-xl overflow-hidden border border-blue-100 bg-blue-50 flex items-center justify-center">
              <img src={loadingStockGif} alt="Cargando" className="w-full h-full object-cover" style={{ objectPosition: 'center' }} />
            </div>
            <div className="text-base font-semibold text-gray-800">Actualizando Stock y Costos...</div>
            <div className="text-sm text-gray-600 leading-snug">Esto puede tardar unos segundos. No cierres la ventana ni recargues la página.</div>
          </div>
        </div>
      )}

      <div className="p-6 flex flex-col h-full">
        {/* Controles de selección y filtro - Barra arriba de la tabla */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => toggleSelectAll()}
              className="btn-filter"
              title={showOnlySelected ? 'Seleccionar todos los items (incluyendo los no visibles)' : 'Seleccionar todos los items visibles'}
            >
              <CheckCircle className="w-3 h-3 text-green-600" />
            </button>

            <button
              onClick={() => deleteSelectedItems()}
              disabled={selectedRows.size === 0}
              className={`btn-filter ${selectedRows.size > 0 ? 'btn-filter-danger-active' : 'opacity-50 cursor-not-allowed'}`}
              title={selectedRows.size > 0 ? `Eliminar ${selectedRows.size} fila(s) seleccionada(s)` : 'Seleccionar filas para eliminar'}
            >
              <Trash2 className="w-3 h-3" />
            </button>

            <button
              onClick={handleClearTable}
              disabled={!hasTableContent}
              className={`btn-filter ${hasTableContent ? '' : 'opacity-50 cursor-not-allowed'}`}
              title="Vaciar la tabla (solo limpia esta vista, no borra datos en ERPNext)"
            >
              <RotateCcw className="w-3 h-3 text-blue-600" />
            </button>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={activeFilter}
                onChange={(e) => {
                  const newFilter = e.target.value
                  setActiveFilter(newFilter)
                  
                  // Mostrar notificación según el filtro seleccionado
                  if (newFilter === 'duplicates' && importMode === 'insert') {
                    const duplicatesCount = rows.filter(row => 
                      row.errors?.item_code && row.errors.item_code.includes('ya existe')
                    ).length
                    
                    if (duplicatesCount === 0) {
                      showNotification('No hay items duplicados/existentes para ocultar', 'info')
                    } else {
                      showNotification(`Ocultando ${duplicatesCount} item(s) duplicado(s)/existente(s)`, 'info')
                    }
                  } else if (newFilter === 'selected') {
                    if (selectedRows.size === 0) {
                      showNotification('Selecciona al menos una fila para usar el filtro', 'warning')
                      setActiveFilter('none')
                      return
                    }
                    showNotification(`Mostrando ${selectedRows.size} item(s) seleccionado(s)`, 'info')
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-[180px]"
                title="Filtrar items visibles"
              >
                <option value="none">Sin filtro</option>
                <option value="selected">Solo seleccionados</option>
                {importMode === 'insert' && (
                  <option value="duplicates">Ocultar duplicados</option>
                )}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs sm:text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span>{`${selectedRows.size} ${selectedRows.size === 1 ? 'seleccionado' : 'seleccionados'}`}</span>
            </div>
            <span className="text-gray-300">|</span>
            <div className="flex items-center gap-1">
              <Filter className="w-4 h-4 text-blue-500" />
              <span>{`${(() => {
                if (activeFilter === 'selected') {
                  return selectedRows.size
                } else if (activeFilter === 'duplicates' && importMode === 'insert') {
                  return filteredRowCount !== null ? filteredRowCount : rows.filter(row => 
                    !(row.errors?.item_code && row.errors.item_code.includes('ya existe'))
                  ).length
                } else {
                  return rows.length
                }
              })()} ${(() => {
                const count = (() => {
                  if (activeFilter === 'selected') {
                    return selectedRows.size
                  } else if (activeFilter === 'duplicates' && importMode === 'insert') {
                    return filteredRowCount !== null ? filteredRowCount : rows.filter(row => 
                      !(row.errors?.item_code && row.errors.item_code.includes('ya existe'))
                    ).length
                  } else {
                    return rows.length
                  }
                })()
                return count === 1 ? 'visible' : 'visibles'
              })()}`}</span>
            </div>
            <span className="text-gray-300">|</span>
            <div className="flex items-center gap-1">
              <Info className="w-4 h-4 text-gray-500" />
              <span>{`${rows.length} ${rows.length === 1 ? 'total' : 'totales'}`}</span>
            </div>
          </div>
        </div>

        <iframe
          ref={iframeRef}
          src="/handsontable-demo.html"
          className="w-full flex-1 border-0"
          title="Tabla de Importación"
          style={{ minHeight: '600px', height: '100%' }}
        />
      </div>





      <ConfirmDialog />
      {/* Modales */}
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        selectedRows={selectedRows}
        visibleRows={rows}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={executeDeleteSelectedItems}
      />

      <PatternModal
        isOpen={showPatternModal}
        onClose={() => setShowPatternModal(false)}
        patternConfig={patternConfig}
        setPatternConfig={setPatternConfig}
        columns={columns}
        applyPattern={applyPattern}
        addingUom={addingUom}
        position={patternModalPosition}
      />

      <DefaultValueModal
        isOpen={showDefaultModal}
        onClose={() => setShowDefaultModal(false)}
        defaultConfig={defaultConfig}
        setDefaultConfig={setDefaultConfig}
        columns={columns}
        uoms={uoms}
        warehouses={warehouses}
        platformOptions={platformOptions}
        createNewUom={(name) => {
          const trimmed = name.trim()
          if (!trimmed) return Promise.resolve()

          setAddingUom(true)
          return ItemImportApi.createNewUom(fetchWithAuth, trimmed, showNotification)
            .then(async (newUom) => {
              if (newUom) {
                const updatedUoms = await ItemImportApi.fetchUoms(fetchWithAuth)
                setUoms(updatedUoms)
                setDefaultConfig(prev => ({ ...prev, value: newUom.name }))
              }
            })
            .finally(() => {
              setAddingUom(false)
            })
        }}
        addingUom={addingUom}
        applyDefaultValue={applyDefaultValue}
        getFilteredRows={() => rows}
        rows={rows}
      />

	      <CostModal
	        isOpen={showCostModal}
	        onClose={() => setShowCostModal(false)}
	        selectedPriceLists={selectedPriceLists}
	        setSelectedPriceLists={setSelectedPriceLists}
	        availablePriceLists={availablePriceLists}
	        selectedPriceListInfo={selectedPriceListInfo}
	        applyingCosts={applyingCosts}
	        onApplyCosts={async () => {
	          if (!selectedPriceLists || selectedPriceLists.length === 0) {
	            showNotification('Por favor selecciona al menos una lista de precios', 'warning')
	            return
	          }

	          setApplyingCosts(true)
	          try {
	            showNotification('Aplicando costos desde listas de precios...', 'info')

	            const requestedLists = Array.from(new Set(selectedPriceLists)).filter(Boolean)
	            const detailsResults = await Promise.all(
	              requestedLists.map(async (priceListName) => {
	                const details = await ItemImportApi.fetchPurchasePriceListDetails(fetchWithAuth, priceListName)
	                return { priceListName, details }
	              })
	            )

	            const failedLists = detailsResults
	              .filter(r => !r.details || !r.details.prices)
	              .map(r => r.priceListName)

	            if (failedLists.length > 0) {
	              showNotification(
	                `No se pudieron obtener los precios de: ${failedLists.slice(0, 5).join(', ')}${failedLists.length > 5 ? '…' : ''}`,
	                'error'
	              )
	              return
	            }

	            let companyAbbr = null
	            try {
	              const companyResponse = await fetchWithAuth('/api/active-company')
              if (companyResponse.ok) {
                const companyData = await companyResponse.json()
                if (companyData.success && companyData.data?.active_company) {
                  const companyDetailResponse = await fetchWithAuth(`/api/companies/${companyData.data.active_company}`)
                  if (companyDetailResponse.ok) {
                    const companyDetail = await companyDetailResponse.json()
                    if (companyDetail.success && companyDetail.data) {
                      companyAbbr = companyDetail.data.abbr
                      if (companyAbbr) {
                      }
                    }
                  }
                }
              }
	            } catch (error) {
	              console.log('Could not get company abbreviation:', error)
	            }

	            const listConfigs = detailsResults.map(({ priceListName, details }) => {
	              const priceMap = new Map()
	              details.prices.forEach(price => {
	                if (price.item_code) {
	                  priceMap.set(price.item_code, parseFloat(price.price_list_rate || 0))
	                }
	              })

	              const rateRaw = details.price_list ? (details.price_list.custom_exchange_rate ?? details.price_list.exchange_rate) : null
	              const rate = rateRaw != null ? parseFloat(rateRaw) : 1

	              return {
	                priceListName,
	                currency: details.price_list?.currency || null,
	                exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
	                priceMap
	              }
	            })

	            const visibleRowIds = new Set(Array.isArray(lastSentRowIdsRef.current) ? lastSentRowIdsRef.current : [])
	            const shouldApplyToRow = (row) => visibleRowIds.size === 0 || visibleRowIds.has(row.id)

	            let appliedCount = 0
	            const conflictItemCodes = new Set()
	            
	            const updatedRows = await Promise.all(
	              rows.map(async (row) => {
	                if (!shouldApplyToRow(row)) return row

	                if (row.item_code) {
	                  const searchCodes = [row.item_code]

	                  if (companyAbbr && !row.item_code.includes(` - ${companyAbbr}`)) {
	                    searchCodes.push(`${row.item_code} - ${companyAbbr}`)
	                  }

	                  const matches = []
	                  for (const cfg of listConfigs) {
	                    let found = null
	                    for (const searchCode of searchCodes) {
	                      if (cfg.priceMap.has(searchCode)) {
	                        found = cfg.priceMap.get(searchCode)
	                        break
	                      }
	                    }
	                    if (found != null) {
	                      matches.push({ price: found, exchangeRate: cfg.exchangeRate, priceListName: cfg.priceListName })
	                    }
	                  }

	                  if (matches.length === 1) {
	                    const finalPrice = matches[0].price * matches[0].exchangeRate
	                    appliedCount++
	                    return {
	                      ...row,
	                      valuation_rate: finalPrice.toFixed(2)
	                    }
	                  }

	                  if (matches.length > 1) {
	                    conflictItemCodes.add(row.item_code)
	                    return row
	                  }
	                }
	                return row
	              })
	            )
            
	            setRows(updatedRows)
	            setTableKey(prev => prev + 1)
	            setShowCostModal(false)

	            const listLabel = requestedLists.length === 1 ? requestedLists[0] : `${requestedLists.length} listas`
	            showNotification(`Costos aplicados a ${appliedCount} item(s) (${listLabel})`, 'success')

	            if (conflictItemCodes.size > 0) {
	              const conflictList = Array.from(conflictItemCodes)
	              showNotification(
	                `${conflictItemCodes.size} item(s) no se pudieron procesar porque aparecen en 2 o más listas seleccionadas.${conflictList.length ? ` Ej: ${conflictList.slice(0, 5).join(', ')}${conflictList.length > 5 ? '…' : ''}` : ''}`,
	                'warning'
	              )
	            }
	            
	          } catch (error) {
	            console.error('Error aplicando costos:', error)
	            showNotification('Error al aplicar costos desde lista de precios', 'error')
	          } finally {
            setApplyingCosts(false)
          }
        }}
        showNotification={showNotification}
      />

      <ConfirmDialog />
      {portalDropdown.open && (
        <PortalSelect
          options={getColumnOptions(
            portalDropdown.colKey,
            itemGroups,
            uoms,
            warehouses,
            availableExpenseAccounts,
            availableIncomeAccounts,
            taxTemplateOptions
          )}
          value={rows.find(r => r.id === portalDropdown.rowId)?.[portalDropdown.colKey]}
          anchorRect={portalDropdown.anchorRect}
          onChange={(val) => {
            // PortalSelect chosen
            updateCell(portalDropdown.rowId, portalDropdown.colKey, val)
          }}
          onClose={() => setPortalDropdown({ open: false, rowId: null, colKey: null, x: 0, y: 0 })}
        />
      )}

      {/* Removed BulkUpdateModal as per UX request - direct apply now */}
    </div>
  )
}
