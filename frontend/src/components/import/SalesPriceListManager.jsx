import React, { useState, useContext, useEffect, useRef, useMemo, useCallback } from 'react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import { Plus, RefreshCw, Save, Calculator, Search, AlertCircle, CheckCircle, Info, DollarSign, X, Trash2, AlertTriangle, Upload, Download, Settings, Filter, RotateCcw } from 'lucide-react'
import Modal from '../Modal'
import SalesPriceListImport from './Saleslist/SalesPriceListImport'
import { fetchSalesKits, fetchSalesPriceListDetails } from './Saleslist/helpers'
import HandsontableDemo from '../../handsometable/HandsontableDemo'
import CalculatorModal from '../modals/CalculatorModal'
import SalesPriceListManagementModal from './Saleslist/SalesPriceListManagementModal'
import DecimalSeparatorModal from './Purchaselist/components/DecimalSeparatorModal'
import useCurrencies from '../../hooks/useCurrencies'
import {
  computeVisibleItems,
  buildFilterChangeAction,
  toggleSelectAllSet,
  resetSelectionState as resetSelectionHelper
} from '../../handsometable/utils/tableFilters'
import { normalizePriceInput, stripAbbr } from './Purchaselist/utils/purchasePriceListHelpers'

// Función para detectar formato decimal ambiguo (ej: "14.000" puede ser 14000 o 14.0)
const detectAmbiguousDecimalFormat = (value) => {
  if (value === undefined || value === null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9.,-]/g, '')
  if (!cleaned) return null

  const hasDot = cleaned.includes('.')
  const hasComma = cleaned.includes(',')
  if (!hasDot && !hasComma) return null

  // Si tiene ambos, no es ambiguo (el último es el decimal)
  if (hasDot && hasComma) {
    return null
  }

  const separatorChar = hasDot ? '.' : ','
  const fragments = cleaned.split(separatorChar)
  const decimals = fragments.length > 1 ? fragments[fragments.length - 1] : ''
  // Es ambiguo si tiene exactamente 3 dígitos después del separador (podría ser miles)
  const isAmbiguous = decimals.length === 0 || (decimals.length === 3 && /^\d{3}$/.test(decimals))

  if (!isAmbiguous) {
    return null
  }

  return {
    ambiguous: true,
    suspected: separatorChar === '.' ? 'comma' : 'dot',
    sample: raw
  }
}


export default function SalesPriceListManager() {

  const { showNotification } = useNotification()
  const { fetchWithAuth, activeCompany, isAuthenticated, token } = useContext(AuthContext)
  const { currencies: currencyDocs, loading: currenciesLoading } = useCurrencies()



  // Si no está autenticado, mostrar mensaje
  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30">
        <div className="text-center text-gray-500">
          <div className="text-lg font-semibold mb-2">Autenticación requerida</div>
          <p>Debes iniciar sesión para acceder a la gestión de precios de venta.</p>
        </div>
      </div>
    )
  }

  // Estados principales
  const [salesPriceLists, setSalesPriceLists] = useState([])
  const [selectedPriceList, setSelectedPriceList] = useState('')
  const [currentPriceListData, setCurrentPriceListData] = useState(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [creationMode, setCreationMode] = useState('update') // 'update', 'create'
  const [isUpdateMode, setIsUpdateMode] = useState(true)
  const [savedItemsCount, setSavedItemsCount] = useState(0)

  // Estados para input mode (como en ItemImport)
  const [inputMode, setInputMode] = useState('paste') // 'paste', 'load_all'

  // Estados para el modal de separador decimal
  const [decimalSeparator, setDecimalSeparator] = useState('auto')
  const [isDecimalModalOpen, setIsDecimalModalOpen] = useState(false)
  const [decimalSamples, setDecimalSamples] = useState([])
  const [detectedDecimalSeparator, setDetectedDecimalSeparator] = useState(null)
  const decimalSeparatorRef = useRef('auto')
  const isDecimalModalOpenRef = useRef(false)

  // Mantener refs actualizados
  useEffect(() => {
    decimalSeparatorRef.current = decimalSeparator
  }, [decimalSeparator])

  useEffect(() => {
    isDecimalModalOpenRef.current = isDecimalModalOpen
  }, [isDecimalModalOpen])

  // Handlers para el modal de separador decimal
  const openDecimalModal = useCallback((samples = [], suggestion = null) => {
    setDecimalSamples(samples)
    setDetectedDecimalSeparator(suggestion)
    setIsDecimalModalOpen(true)
  }, [])

  const handleDecimalModalClose = useCallback(() => {
    setIsDecimalModalOpen(false)
    setDecimalSamples([])
    setDetectedDecimalSeparator(null)
  }, [])

  const handleDecimalSelection = useCallback((selection) => {
    setDecimalSeparator(selection || 'auto')
    const label = selection === 'comma'
      ? 'formato con coma decimal'
      : selection === 'dot'
        ? 'formato con punto decimal'
        : 'detección automática'
    showNotification(`Formato decimal configurado en ${label}`, 'success')
    
    // Re-procesar los valores actuales de la columna 'valor' con el nuevo formato
    // Esto es necesario porque Handsontable ya parseó los valores incorrectamente
    if (selection && selection !== 'auto' && decimalSamples.length > 0) {
      // Los samples contienen los valores originales antes del parseo de Handsontable
      // Usamos estos para reconstruir los valores correctos
      setItems(prevItems => {
        // Crear un mapa de samples para buscar por valor parseado incorrectamente
        const sampleSet = new Set(decimalSamples.map(s => s.toString().trim()))
        
        return prevItems.map(item => {
          // Si el valor actual parece haber sido mal-parseado (es un número pequeño
          // cuando debería ser grande, o viceversa)
          const currentValor = item.valor
          if (currentValor === undefined || currentValor === null || currentValor === '') {
            return item
          }
          
          // Buscar en los samples originales si hay una coincidencia
          // por ejemplo, si valor=22 y había un sample "22.000", entonces corregir
          const currentNum = parseFloat(currentValor)
          if (!Number.isFinite(currentNum)) return item
          
          // Intentar encontrar el sample original que fue mal-parseado a este valor
          let correctedValue = currentValor
          for (const sample of decimalSamples) {
            const cleaned = sample.toString().replace(/[^0-9.,-]/g, '')
            // Para formato coma decimal: "22.000" -> 22000 (no 22.0)
            // Para formato punto decimal: "22.000" -> 22.0 (no 22000)
            if (selection === 'comma') {
              // Coma decimal: punto es separador de miles
              const expected = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
              const badParse = parseFloat(cleaned.replace(',', '.'))
              if (Math.abs(currentNum - badParse) < 0.01 && expected !== badParse) {
                correctedValue = expected.toString()
                break
              }
            } else if (selection === 'dot') {
              // Punto decimal: coma es separador de miles
              const expected = parseFloat(cleaned.replace(/,/g, ''))
              const badParse = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
              if (Math.abs(currentNum - badParse) < 0.01 && expected !== badParse) {
                correctedValue = expected.toString()
                break
              }
            }
          }
          
          if (correctedValue !== currentValor) {
            console.log('DECIMAL: Correcting value', currentValor, '->', correctedValue)
            return { ...item, valor: correctedValue }
          }
          return item
        })
      })
      
      // Notificar al iframe para que actualice la tabla
      setTimeout(() => {
        if (iframeRef.current && iframeRef.current.contentWindow) {
          const currentItems = itemsRef.current
          const priceKeys = ['existing_price', 'purchase_price', 'valor']
          const preparedData = currentItems.map(item => priceListColumns.map(col => {
            if (col.key === 'selected') {
              return selectedRowsRef.current.has(item.id)
            }
            const value = item[col.key]
            if (value === undefined || value === null || value === '') return ''
            if (priceKeys.includes(col.key)) {
              const n = parseFloat(value)
              if (isNaN(n)) return ''
              return Number(n.toFixed(2))
            }
            return value
          }))
          const rowIds = currentItems.map(item => item.id)
          
          console.log('DECIMAL: Sending corrected data to iframe')
          iframeRef.current.contentWindow.postMessage({
            type: 'ht-configure-table',
            columns: priceListColumns,
            data: preparedData,
            rowIds,
            selectAll: false
          }, '*')
        }
      }, 100)
    }
  }, [showNotification, decimalSamples]) // priceListColumns not included to avoid pre-init reference; uses latest value at runtime

  // Modo de items: 'items' o 'kits'
  const [itemType, setItemType] = useState('items')
  const [kitsSet, setKitsSet] = useState(new Set())

  const loadKitsList = async () => {
    try {
      const kits = await fetchSalesKits(fetchWithAuth, activeCompany)
      // Normalize: strip company abbr and index by stripped code
      const s = new Set()
      kits.forEach(k => {
        const code = stripAbbr(k.new_item_code || k.item_code || '')
        if (code) s.add(code)
        // also add raw codes as a fallback
        if (k.new_item_code) s.add(k.new_item_code)
      })
      setKitsSet(s)
      console.log('Loaded kits set, count:', s.size)
    } catch (e) {
      console.error('Error loading kits list for filtering:', e)
      setKitsSet(new Set())
    }
  }

  // Load kits list whenever kits mode is activated or company changes
  useEffect(() => {
    if (itemType === 'kits') {
      loadKitsList()
    }
  }, [itemType, activeCompany])

  // Estado para detalles de la empresa activa (para obtener moneda por defecto)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const companyCurrency = (activeCompanyDetails?.default_currency || '').toString().trim()

  // Estados para nueva lista
  const [newListName, setNewListName] = useState('')
  const [newListCurrency, setNewListCurrency] = useState(companyCurrency || '')
  const [newListValidFrom, setNewListValidFrom] = useState('')
  const [newListExchangeRate, setNewListExchangeRate] = useState('1.0000')

  // Estados para métodos de creación
  const [creationMethod, setCreationMethod] = useState('manual') // 'manual', 'markup-purchase', 'clone'
  const [purchasePriceLists, setPurchasePriceLists] = useState([])
  const [selectedPurchaseList, setSelectedPurchaseList] = useState('')
  const [selectedPurchaseListData, setSelectedPurchaseListData] = useState(null)
  const [markupPercentage, setMarkupPercentage] = useState(25)
  const [exchangeRate, setExchangeRate] = useState(1)
  const [calculatedPrices, setCalculatedPrices] = useState([])
  const [isCalculating, setIsCalculating] = useState(false)

  // Estados para la tabla de items
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState(null)

  const [selectedRows, setSelectedRows] = useState(() => new Set())
  const [selectAll, setSelectAll] = useState(false)
  const [activeFilter, setActiveFilter] = useState('none')
  const [filteredRowCount, setFilteredRowCount] = useState(null)
  const [iframeReady, setIframeReady] = useState(false)
  const [visibleRowIds, setVisibleRowIds] = useState(null) // null = no filter active, array = filtered row IDs

  const normalizeNumber = useCallback((value) => {
    if (value === undefined || value === null || value === '') return ''
    const n = typeof value === 'number' ? value : parseFloat(String(value))
    return Number.isNaN(n) ? '' : Number(n).toFixed(2)
  }, [])

  const computeHasChanges = useCallback((row) => {
    const baseline = row.original_snapshot || {}
    const trackedKeys = ['item_code', 'item_name', 'item_group', 'brand', 'existing_price', 'purchase_price', 'valor', 'platform', 'url']
    return trackedKeys.some(key => {
      const currentVal = ['existing_price', 'purchase_price', 'valor'].includes(key)
        ? normalizeNumber(row[key])
        : (row[key] === undefined || row[key] === null ? '' : String(row[key]).trim())
      const baseVal = ['existing_price', 'purchase_price', 'valor'].includes(key)
        ? normalizeNumber(baseline[key])
        : (baseline[key] === undefined || baseline[key] === null ? '' : String(baseline[key]).trim())
      return currentVal !== baseVal
    })
  }, [normalizeNumber])

  const applyBaseline = useCallback((list) => {
    return (list || []).map(row => {
      const snap = row.original_snapshot || { ...row }
      const hasChanges = computeHasChanges({ ...row, original_snapshot: snap })
      return { ...row, original_snapshot: snap, hasChanges }
    })
  }, [computeHasChanges])

  // Shared reset helper (defined early so other code can call it)
  const resetSelectionState = () => resetSelectionHelper(setSelectedRows, setSelectAll, setActiveFilter, setFilteredRowCount)

  const clearTableData = useCallback(({ silent = false } = {}) => {
    itemsRef.current = []
    setItems([])
    setOriginalItems([])
    setVisibleRowIds(null)
    setFilteredRowCount(null)
    resetSelectionState()
    try {
      const iframeWindow = iframeRef?.current?.contentWindow
      if (iframeWindow) {
        iframeWindow.postMessage({ type: 'ht-clear-table' }, '*')
      }
    } catch (error) {
      console.debug('Error clearing sales price list table', error)
    }
    if (!silent) {
      showNotification('Tabla vaciada. Esto no elimina precios en ERPNext.', 'info')
    }
  }, [resetSelectionState, showNotification])

  // Estados para búsqueda de items
  const [itemSearchQuery, setItemSearchQuery] = useState('')
  const [itemSearchResults, setItemSearchResults] = useState([])
  const [showItemSearch, setShowItemSearch] = useState(false)

  // Estados para agregar items por filtros
  const [itemCategories, setItemCategories] = useState([])
  const [itemBrands, setItemBrands] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [selectedPurchaseListForItems, setSelectedPurchaseListForItems] = useState('')
  const [isLoadingItems, setIsLoadingItems] = useState(false)

  // Estados para "Actualizar Existentes"
  const [priceListCurrency, setPriceListCurrency] = useState(companyCurrency || '')
  const [priceListExchangeRate, setPriceListExchangeRate] = useState('1')
  const [selectedPurchaseListForUpdate, setSelectedPurchaseListForUpdate] = useState('')

  // Estados para pestañas (manual vs import)
  const [activeTab, setActiveTab] = useState('manual') // 'manual' o 'import'
  const iframeRef = useRef(null)

  // Estados para actualización masiva de precios
  const [bulkUpdateType, setBulkUpdateType] = useState('percentage') // 'percentage', 'fixed', 'multiplier'
  const [bulkUpdateValue, setBulkUpdateValue] = useState('')
  const [originalItems, setOriginalItems] = useState([]) // Para comparar cambios
  const [changedItemsCount, setChangedItemsCount] = useState(0)

  // Estados para grupos de clientes
  const [customerGroups, setCustomerGroups] = useState([])
  const [selectedCustomerGroups, setSelectedCustomerGroups] = useState([])

  // Estados para modal de calculadora
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false)
  const [isApplyingFormula, setIsApplyingFormula] = useState(false)

  // Estados para modal de gestión de listas
  const [isManagementModalOpen, setIsManagementModalOpen] = useState(false)

  const generateRowId = useCallback(() => `price-row-${Date.now()}-${Math.random().toString(16).slice(2)}`, [])

  // Ensure numeric values for price-related fields when sending to iframe
  const toNumberValue = (v) => {
    if (v === undefined || v === null || v === '') return 0
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    if (isNaN(n)) return 0
    return Number(n.toFixed(2))
  }

  // Normalize price input to handle both . and , as decimal separators
  
  const priceListColumns = useMemo(() => ([
    { key: 'selected', label: 'Sel.', type: 'checkbox', width: 44, readonly: false },
    { key: 'item_code', label: 'SKU', type: 'text', width: 140 },
    { key: 'item_name', label: 'Nombre', type: 'text', width: 200 },
    { key: 'existing_price', label: '$ Actual', type: 'numeric', width: 110, readonly: true, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0.00' } },
    { key: 'purchase_price', label: '$ Compra', type: 'numeric', width: 110, readonly: true, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0.00' } },
    { key: 'valor', label: 'Nuevo Precio', type: 'numeric', width: 120, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0.00' } }
  ]), [])

  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Avoid reloading the iframe table (which clears filters) when the edit originated inside the iframe
  const suppressIframeRefreshRef = useRef(false)

  const selectedRowsRef = useRef(selectedRows)
  useEffect(() => {
    selectedRowsRef.current = selectedRows
  }, [selectedRows])

  const activeFilterRef = useRef(activeFilter)
  useEffect(() => {
    activeFilterRef.current = activeFilter
  }, [activeFilter])

  const visibleItems = useMemo(() => {
    return computeVisibleItems(items, { activeFilter, selectedRows, visibleRowIds })
  }, [items, activeFilter, selectedRows, visibleRowIds])

  const visibleItemsRef = useRef(visibleItems)
  useEffect(() => {
    visibleItemsRef.current = visibleItems
  }, [visibleItems])

  useEffect(() => {
    const visible = visibleItems
    const allSelected = visible.length > 0 && visible.every(item => selectedRows.has(item.id))
    if (selectAll !== allSelected) {
      setSelectAll(allSelected)
    }
  }, [visibleItems, selectedRows, selectAll])

  useEffect(() => {
    if (activeFilter === 'selected') {
      if (selectedRows.size === 0) {
        setActiveFilter('none')
        setFilteredRowCount(null)
      } else {
        setFilteredRowCount(selectedRows.size)
      }
    }
  }, [activeFilter, selectedRows])

  useEffect(() => {
    if (activeTab !== 'manual') {
      setIframeReady(false)
    }
  }, [activeTab])

  const sendTableConfiguration = useCallback(() => {
    if (!iframeReady || !iframeRef.current || !iframeRef.current.contentWindow) {
      return
    }

    const hasItems = items.length > 0
    const tableRows = visibleItems.length > 0
      ? visibleItems
      : hasItems
        ? []
        : [{
            id: generateRowId(),
            selected: false,
            item_code: '',
            item_name: '',
            existing_price: '',
            purchase_price: '',
            valor: '',
            errors: {}
          }]

    const priceKeys = ['existing_price', 'purchase_price', 'valor']
    const preparedData = tableRows.map(item => priceListColumns.map(col => {
      if (col.key === 'selected') {
        return selectedRows.has(item.id)
      }
      const value = item[col.key]
      if (value === undefined || value === null || value === '') return ''
      if (priceKeys.includes(col.key)) {
        const n = parseFloat(value)
        if (isNaN(n)) return ''
        return Number(n.toFixed(2))
      }
      return value
    }))

    const rowIds = tableRows.map(item => item.id ?? generateRowId())

    iframeRef.current.contentWindow.postMessage({
      type: 'ht-configure-table',
      columns: priceListColumns,
      data: preparedData,
      rowIds,
      selectAll
    }, '*')
  }, [generateRowId, iframeReady, items, priceListColumns, selectedRows, selectAll, visibleItems])

  useEffect(() => {
    if (suppressIframeRefreshRef.current) {
      suppressIframeRefreshRef.current = false
      return
    }
    sendTableConfiguration()
  }, [sendTableConfiguration])

  const handleIframeLoad = useCallback(() => {
    setIframeReady(true)
  }, [])

  // Helper: habilita la calculadora si al menos una fila tiene precio actual o precio de compra
  const canOpenCalculator = () => {
    if (!items || items.length === 0) return false
    return items.some(it => {
      const purchase = it.purchase_price !== undefined && it.purchase_price !== null && it.purchase_price !== '' && !isNaN(parseFloat(it.purchase_price)) && parseFloat(it.purchase_price) > 0
      const existing = it.valor !== undefined && it.valor !== null && it.valor !== '' && !isNaN(parseFloat(it.valor)) && parseFloat(it.valor) > 0
      const existing_price_field = it.existing_price !== undefined && it.existing_price !== null && it.existing_price !== '' && !isNaN(parseFloat(it.existing_price)) && parseFloat(it.existing_price) > 0
      return purchase || existing || existing_price_field
    })
  }

  const countItemsForCalculator = () => {
    if (!items || items.length === 0) return 0
    return items.reduce((acc, it) => {
      const purchase = it.purchase_price !== undefined && it.purchase_price !== null && it.purchase_price !== '' && !isNaN(parseFloat(it.purchase_price)) && parseFloat(it.purchase_price) > 0
      const existing = it.valor !== undefined && it.valor !== null && it.valor !== '' && !isNaN(parseFloat(it.valor)) && parseFloat(it.valor) > 0
      const existing_price_field = it.existing_price !== undefined && it.existing_price !== null && it.existing_price !== '' && !isNaN(parseFloat(it.existing_price)) && parseFloat(it.existing_price) > 0
      return acc + (purchase || existing || existing_price_field ? 1 : 0)
    }, 0)
  }

  const handleApplyFormula = async (formula) => {
    if (!fetchWithAuth) {
      throw new Error('Sesión no disponible para aplicar la fórmula')
    }

    const normalizeNumeric = (value) => {
      const n = parseFloat(value)
      return Number.isFinite(n) ? n : 0
    }

    const itemsForBackend = (items || []).map((row, idx) => {
      const purchaseSource = (row.purchase_price !== undefined && row.purchase_price !== null && row.purchase_price !== '')
        ? row.purchase_price
        : row.purchase_price_converted
      return {
        id: row.id || `row-${idx}`,
        item_code: row.item_code || '',
        existing_price: normalizeNumeric(row.existing_price ?? row.valor),
        purchase_price: normalizeNumeric(purchaseSource)
      }
    })

    const applicable = itemsForBackend.filter(it => it.existing_price !== 0 || it.purchase_price !== 0)
    if (applicable.length === 0) {
      throw new Error('No hay precios actuales ni de compra para aplicar la fórmula.')
    }

    setIsApplyingFormula(true)
    try {
      const response = await fetchWithAuth(API_ROUTES.applySalesFormula, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formula, items: itemsForBackend })
      })

      let payload = {}
      try {
        payload = await response.json()
      } catch (e) {
        payload = {}
      }

      if (!response.ok || !payload.success) {
        const msg = payload?.message || 'No se pudo aplicar la fórmula'
        throw new Error(msg)
      }

      const resultsArray = Array.isArray(payload.data) ? payload.data : []
      if (resultsArray.length === 0) {
        throw new Error('La fórmula no devolvió resultados válidos')
      }

      const resultsById = new Map()
      resultsArray.forEach(res => {
        const key = res.id ?? res.item_code ?? null
        if (key !== null && key !== undefined) {
          resultsById.set(key.toString(), res)
        }
      })

      setItems(prevItems => prevItems.map((item, idx) => {
        const lookupKeys = [
          item.id,
          item.id !== undefined && item.id !== null ? item.id.toString() : null,
          idx,
          idx.toString(),
          item.item_code
        ].filter(k => k !== null && k !== undefined)
        let found = null
        for (const key of lookupKeys) {
          if (resultsById.has(key.toString())) {
            found = resultsById.get(key.toString())
            break
          }
        }
        if (found && found.valor !== undefined && found.valor !== null && found.valor !== '') {
          return { ...item, valor: Number(found.valor).toFixed(2) }
        }
        return item
      }))

      if (payload.errors && payload.errors.length > 0) {
        showNotification(`Fórmula aplicada con ${payload.errors.length} fila(s) con error; revisá los items sin actualizar.`, 'warning')
      } else {
        showNotification(`Fórmula aplicada a ${resultsArray.length} items`, 'success')
      }

      return true
    } catch (e) {
      console.debug('Error applying formula', e)
      throw e
    } finally {
      setIsApplyingFormula(false)
    }
  }

  const getInflationItems = () => {
    return (items || []).map((row, idx) => ({
      id: row.id || `row-${idx}`,
      item_code: row.item_code || '',
      existing_price: row.existing_price ?? row.valor ?? null,
      purchase_price: row.purchase_price ?? row.purchase_price_converted ?? null,
      valor: row.valor ?? null
    }))
  }

  const handleApplyInflationResult = (result) => {
    if (!result || !Array.isArray(result.items)) return
    const updated = (items || []).map((row) => {
      const match = result.items.find(
        (it) =>
          (it.id && row.id === it.id) ||
          (!it.id && it.item_code && row.item_code === it.item_code) ||
          (it.id && row.item_code && row.item_code === it.id)
      )
      if (!match || match.adjusted_price === undefined || match.adjusted_price === null) return row
      return { ...row, valor: Number(match.adjusted_price).toFixed(2) }
    })

    setItems(updated)
    scheduleIframeSync(updated)
    setIsCalculatorOpen(false)

    if (result.factor) {
      showNotification(`Ajuste por inflación aplicado. Factor ${Number(result.factor).toFixed(4)}`, 'success')
    }
  }

  // Estados para eliminación
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteItemsConfirm, setShowDeleteItemsConfirm] = useState(false)
  const [isDeletingItems, setIsDeletingItems] = useState(false)

  // Estados para edición de listas existentes
  const [editListName, setEditListName] = useState('')
  const [editListCurrency, setEditListCurrency] = useState(companyCurrency || '')

  // Estados para filtros de columna
  const [columnFilters, setColumnFilters] = useState({})

  // Función para cargar detalles de la empresa activa (para obtener moneda por defecto)
  const fetchActiveCompanyDetails = async (companyName) => {
    if (!companyName) return
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

  // Cargar detalles de la empresa cuando cambie activeCompany
  useEffect(() => {
    if (activeCompany) {
      fetchActiveCompanyDetails(activeCompany)
    }
  }, [activeCompany])

  // Actualizar estados de moneda cuando se cargue companyCurrency
  useEffect(() => {
    if (companyCurrency && !newListCurrency) {
      setNewListCurrency(companyCurrency)
    }
    if (companyCurrency && !editListCurrency) {
      setEditListCurrency(companyCurrency)
    }
    if (companyCurrency && !priceListCurrency) {
      setPriceListCurrency(companyCurrency)
    }
  }, [companyCurrency])

  // Cargar datos iniciales al montar el componente
  useEffect(() => {
    console.log('SalesPriceListManager: Loading initial data...')
    loadSalesPriceLists()
    loadPurchaseLists()
    loadItemCategories()
    loadItemBrands()
    loadCustomerGroups()
  }, [])

  // Seleccionar automáticamente la primera lista de venta cuando se cargan
  useEffect(() => {
    if (salesPriceLists.length > 0 && !selectedPriceList && creationMode === 'update') {
      setSelectedPriceList(salesPriceLists[0].name)
    }
  }, [salesPriceLists, creationMode])

  // Cargar items cuando se selecciona una lista de compra en modo actualizar
  useEffect(() => {
    if (selectedPurchaseListForUpdate && creationMode === 'update') {
      loadItemsFromPurchaseList(selectedPurchaseListForUpdate)
    }
  }, [selectedPurchaseListForUpdate])

  // Recargar detalles de lista de compra cuando cambie la selección
  useEffect(() => {
    loadPurchaseListDetails(selectedPurchaseList)
  }, [selectedPurchaseList])

  // Contar items cambiados
  useEffect(() => {
    if (originalItems.length > 0) {
      const changed = items.filter((item, index) => {
        const original = originalItems[index]
        return original && parseFloat(item.valor) !== parseFloat(original.original_price)
      }).length
      setChangedItemsCount(changed)
    }
  }, [items, originalItems])

  // Recargar exchange rate cuando cambie la moneda de venta
  useEffect(() => {
    if (selectedPurchaseList && selectedPurchaseListData) {
      const purchaseCurrency = selectedPurchaseListData.price_list?.currency
      const saleCurrency = isCreatingNew ? newListCurrency : currentPriceListData?.price_list?.currency

      if (purchaseCurrency && saleCurrency && purchaseCurrency !== saleCurrency) {
        // Intentar obtener el exchange rate actual
        const loadExchangeRate = async () => {
          try {
            const exchangeResponse = await fetchWithAuth(`/api/currency/exchange-rate?from=${purchaseCurrency}&to=${saleCurrency}`)
            if (exchangeResponse.ok) {
              const exchangeData = await exchangeResponse.json()
              const rate = exchangeData.exchange_rate ?? exchangeData.data?.exchange_rate
              if (!(Number(rate) > 0)) {
                throw new Error(`Cotización inválida para ${purchaseCurrency}/${saleCurrency}`)
              }
              setExchangeRate(Number(rate))
              return
            }
            const err = await exchangeResponse.json().catch(() => ({}))
            throw new Error(err.message || `Error HTTP ${exchangeResponse.status}`)
          } catch (error) {
            console.error('Error loading exchange rate:', error)
            showNotification(`No se pudo obtener cotización ${purchaseCurrency}/${saleCurrency}`, 'error')
            setExchangeRate(null)
          }
        }
        loadExchangeRate()
      } else {
        setExchangeRate(1)
      }
    }
  }, [newListCurrency, selectedPurchaseListData])

  // Recalcular precios cuando cambie el exchange rate
  useEffect(() => {
    if (calculatedPrices.length > 0 && Number.isFinite(exchangeRate) && exchangeRate !== 1) {
      const recalculatedItems = items.map(item => {
        if (item.purchase_price) {
          const convertedPrice = item.purchase_price * exchangeRate
          const markupAmount = convertedPrice * (markupPercentage / 100)
          const salePrice = convertedPrice + markupAmount

          return {
            ...item,
            purchase_price_converted: convertedPrice,
            valor: salePrice
          }
        }
        return item
      })
      setItems(recalculatedItems)
    }
  }, [exchangeRate, markupPercentage])

  // Sincronizar creationMode con isCreatingNew
  useEffect(() => {
    if (creationMode === 'update') {
      setIsCreatingNew(false)
    } else if (creationMode === 'manual') {
      setIsCreatingNew(true)
    }
  }, [creationMode])

  // Cuando cambia el modo de creación, limpiar la tabla del iframe y resetear estado relevante
  useEffect(() => {
    try {
      if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'ht-clear-table' }, '*')
      }
    } catch (err) {
      // ignore
    }
    setItems([])
    setOriginalItems([])
    resetSelectionState()
    setSelectedPurchaseList('')
    setSelectedPurchaseListData(null)
    setSelectedPurchaseListForUpdate('')
    setNewListName('')
  }, [creationMode])

  // useEffect para manejar mensajes del iframe
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return

      const msg = event.data || {}
      const { type } = msg

      switch (type) {
        case 'ht-data-changed': {
          // Avoid reconfiguring the iframe immediately after it notifies changes (keeps filters and prevents loops)
          suppressIframeRefreshRef.current = true
          const dataRows = Array.isArray(msg.data) ? msg.data : []
          const rowIds = Array.isArray(msg.rowIds) ? msg.rowIds : []
          
          // Special handling for formula application
          if (msg.formulaApplied) {
            console.log('FORMULA: Processing formula-applied data change, rows:', dataRows.length)
            
            // For formula application, only update the 'valor' (new price) column
            // dataRows is array of arrays: [item_code, item_name, item_group, brand, existing_price, purchase_price, new_price]
            setItems(prevItems => {
              const updatedItems = [...prevItems]
              
              // Update items by index since dataRows contains rows in the same order as items
              dataRows.forEach((tableRow, index) => {
                if (tableRow && tableRow.length >= 7 && updatedItems[index]) {
                  // Column 6 is 'new_price' (valor)
                  const calculatedPrice = tableRow[6]
                  updatedItems[index] = {
                    ...updatedItems[index],
                    valor: calculatedPrice !== undefined && calculatedPrice !== null && calculatedPrice !== '' ? String(calculatedPrice) : updatedItems[index].valor
                  }
                }
              })
              
              console.log('FORMULA: Updated items sample:', updatedItems.slice(0, 3).map(it => ({ code: it.item_code, valor: it.valor })))
              return updatedItems
            })
            return
          }
          
          // Original logic for other ht-data-changed messages
          if (dataRows.length === 0) break
          
          // Debug: log what we received
          console.log('DEBUG ht-data-changed: Received', dataRows.length, 'rows, rowIds:', rowIds)
          console.log('DEBUG ht-data-changed: Current items count:', itemsRef.current.length, 'item ids:', itemsRef.current.map(i => i.id))

          const updatedSelection = new Set(selectedRowsRef.current)
          const incomingById = new Map()
          const discarded = []
          
          // Variables para detectar formato decimal ambiguo
          const ambiguousSamples = []
          let suggestedSeparator = null

          dataRows.forEach((row, index) => {
            let rowId = rowIds[index]
            const originalRowId = rowId
            if (rowId === undefined || rowId === null) {
              rowId = generateRowId()
              console.log('DEBUG ht-data-changed: Generated new rowId', rowId, 'for row index', index, '(original was:', originalRowId, ')')
            }

            const existing = itemsRef.current.find(item => item.id === rowId)
            console.log('DEBUG ht-data-changed: Row', index, 'rowId:', rowId, 'existing:', existing ? 'YES' : 'NO')
            const updated = existing ? { ...existing } : { id: rowId }

            priceListColumns.forEach((col, colIndex) => {
              const cellValue = row[colIndex]
              if (col.key === 'selected') {
                if (cellValue) {
                  updatedSelection.add(rowId)
                } else {
                  updatedSelection.delete(rowId)
                }
              } else {
                // Para campos de precio (valor, existing_price, purchase_price), detectar formato ambiguo
                const isPriceColumn = ['valor', 'existing_price', 'purchase_price'].includes(col.key)
                if (isPriceColumn && cellValue !== undefined && cellValue !== null && cellValue !== '') {
                  // Detectar si es ambiguo solo si estamos en modo auto
                  if (decimalSeparatorRef.current === 'auto') {
                    const detection = detectAmbiguousDecimalFormat(cellValue)
                    if (detection?.ambiguous) {
                      console.log('DECIMAL [ht-data-changed]: Detected ambiguous value in column', col.key, ':', cellValue, '-> suspected:', detection.suspected)
                      ambiguousSamples.push(detection.sample)
                      if (!suggestedSeparator && detection.suspected) {
                        suggestedSeparator = detection.suspected
                      }
                    }
                  }
                  // Normalizar el precio con el separador actual (solo para 'valor' que es editable)
                  if (col.key === 'valor') {
                    updated[col.key] = normalizePriceInput(cellValue, { decimalSeparator: decimalSeparatorRef.current })
                  } else {
                    updated[col.key] = cellValue
                  }
                } else {
                  updated[col.key] = cellValue === undefined || cellValue === null ? '' : cellValue
                }
              }
            })

            updated.id = rowId
            // If we're in paste mode AND kits mode, filter by kitsSet
            if (inputMode === 'paste' && itemType === 'kits') {
              const code = stripAbbr((updated.item_code || '').toString())
              if (!code || !kitsSet.has(code)) {
                // Collect discarded codes for notification
                if (updated.item_code) discarded.push(updated.item_code)
                return // skip adding this row
              }
            }
            incomingById.set(rowId, updated)
          })

          // Debug: log what was pasted and how it was filtered (kits mode)
          if (inputMode === 'paste' && itemType === 'kits') {
            try {
              console.log('SalesPriceListManager: paste incoming rows count:', dataRows.length)
              console.log('SalesPriceListManager: kitsSet size:', kitsSet.size)
              if (discarded.length > 0) console.log('SalesPriceListManager: discarded codes (first 20):', [...new Set(discarded)].slice(0,20))
              console.log('SalesPriceListManager: resulting rows to add:', incomingById.size)
            } catch (e) { console.debug('Error logging paste debug info', e) }
          }

          if (discarded.length > 0) {
            const unique = [...new Set(discarded)].slice(0, 20)
            showNotification(`Se descartaron ${discarded.length} ${discarded.length === 1 ? 'código' : 'códigos'} no pertenecientes a kits: ${unique.join(', ')}${discarded.length > unique.length ? ', ...' : ''}`, 'warning')
          }

          // If we are in paste mode, query backend for the pasted SKUs and log responses
          try {
            if (inputMode === 'paste') {
              const uniqueSkus = [...new Set(Array.from(incomingById.values()).map(it => (it.item_code || it.item_code === 0 ? String(it.item_code).trim() : '')).filter(Boolean))].slice(0, 250)
              if (uniqueSkus.length > 0) {
                // Batch request: send all SKUs at once to the backend bulk endpoint
                (async () => {
                  try {
                    console.log('SalesPriceListManager: performing bulk SKU fetch for', uniqueSkus.length, 'skus')
                    const body = {
                      company: activeCompany || '',
                      codes: uniqueSkus,
                      price_list: selectedPriceList || '' // Pasar la lista de precios seleccionada
                    }

                    console.log('SalesPriceListManager: bulk /items/bulk request body:', body)
                    console.log('SalesPriceListManager: uniqueSkus:', uniqueSkus)
                    const resp = await fetchWithAuth('/api/inventory/items/bulk', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(body)
                    })

                    let json = null
                    if (!resp.ok) {
                      console.debug('Bulk SKU fetch (POST /items/bulk) failed, status:', resp.status)
                      // Try fallback to GET targeted bulk-fetch
                      const fallbackParams = new URLSearchParams()
                      fallbackParams.append('company', activeCompany || '')
                      uniqueSkus.forEach(code => fallbackParams.append('codes', code))
                      fallbackParams.append('targeted', 'true')
                      try {
                        const fbResp = await fetchWithAuth(`${API_ROUTES.inventory}/items/bulk-fetch?${fallbackParams}`)
                        if (!fbResp.ok) {
                          console.debug('Bulk SKU fetch (GET /items/bulk-fetch) failed, status:', fbResp.status)
                          return
                        }
                        const fbJson = await fbResp.json().catch(() => ({ success: false }))
                        console.log('DEBUG: Bulk backend fallback (bulk-fetch) response for pasted SKUs:', fbJson)
                        console.log('DEBUG: Bulk backend fallback (bulk-fetch) response raw data: ', fbJson?.data && fbJson?.data.length ? JSON.parse(JSON.stringify(fbJson.data)) : fbJson.data)
                        json = fbJson
                      } catch (fbErr) {
                        console.error('Bulk SKU fetch fallback failed:', fbErr)
                        return
                      }
                    } else {
                      const jsonResp = await resp.json().catch(() => ({ success: false }))
                      console.log('DEBUG: Bulk backend response for pasted SKUs (POST /items/bulk):', jsonResp)
                      console.log('DEBUG: Bulk backend response for pasted SKUs raw data: ', jsonResp?.data && jsonResp?.data.length ? JSON.parse(JSON.stringify(jsonResp.data)) : jsonResp.data)
                      json = jsonResp
                      // If the POST returned success but no data, try the GET fallback
                      if (json && json.success && Array.isArray(json.data) && json.data.length === 0) {
                        const fallbackParams2 = new URLSearchParams()
                        fallbackParams2.append('company', activeCompany || '')
                        uniqueSkus.forEach(code => fallbackParams2.append('codes', code))
                        fallbackParams2.append('targeted', 'true')
                        try {
                          const fbResp2 = await fetchWithAuth(`${API_ROUTES.inventory}/items/bulk-fetch?${fallbackParams2}`)
                          if (fbResp2 && fbResp2.ok) {
                            const fbJson2 = await fbResp2.json().catch(() => ({ success: false }))
                            console.log('DEBUG: Bulk backend fallback (bulk-fetch) response for pasted SKUs (POST-empty fallback):', fbJson2)
                            json = fbJson2
                          } else {
                            console.debug('Bulk SKU fetch fallback 2 failed or not ok', fbResp2?.status)
                          }
                        } catch (fbErr2) {
                          console.error('Bulk SKU fetch fallback 2 failed:', fbErr2)
                        }
                      }
                    }

                    // Map backend results into incomingById rows: set existing_price from price_list_rate when available
                    try {
                      const populated = []
                      if (json && json.success && Array.isArray(json.data)) {
                        json.data.forEach(itemFromBack => {
                          // Normalize item code: ERP may include company abbr in the item_code
                          const rawCode = itemFromBack.item_code || itemFromBack.erp_item_code || itemFromBack.name || ''
                          const skuCode = (rawCode || '').toString().split(' - ')[0].trim()
                          const priceVal = (itemFromBack.price_list_rate !== undefined && itemFromBack.price_list_rate !== null) ? itemFromBack.price_list_rate : null
                          const priceDocName = itemFromBack.prices && itemFromBack.prices.length > 0 ? (itemFromBack.prices[0].name || null) : null

                          // Update pasted row with item_name, brand and price if available
                          incomingById.forEach((upd, rowId) => {
                            try {
                              if ((upd.item_code || '').toString() === (skuCode || '').toString()) {
                                // Basic fields from backend
                                if (itemFromBack.item_name) upd.item_name = itemFromBack.item_name
                                if (itemFromBack.brand && typeof itemFromBack.brand === 'string') upd.brand = itemFromBack.brand
                                if (itemFromBack.docstatus !== undefined && itemFromBack.docstatus !== null) upd.docstatus = itemFromBack.docstatus

                                if (priceVal !== null && priceVal !== undefined) {
                                  upd.existing_price = priceVal
                                  upd.price_list_rate = priceVal
                                  if (priceDocName) upd.item_price_name = priceDocName
                                  populated.push({ sku: skuCode, rowId, price: priceVal })
                                }
                              }
                            } catch (e) { /* ignore per-row errors */ }
                          })
                        })
                      }

                      if (populated.length > 0) {
                        console.log('DEBUG: Populated existing_price for pasted SKUs (bulk):', populated)
                      } else {
                        console.log('DEBUG: No pasted SKUs were populated with price_list_rate (bulk)')
                      }

                      // Apply merged updates to React state AND send updated data to iframe
                      try {
                        suppressIframeRefreshRef.current = true
                        
                        // Build merged data first so we can both update state and send to iframe
                        const currentItems = itemsRef.current
                        const prevMap = new Map(currentItems.map(item => [item.id, item]))
                        const merged = currentItems.map(item => incomingById.get(item.id) ?? item)
                        incomingById.forEach((value, id) => {
                          if (!prevMap.has(id)) merged.push(value)
                        })

                        try {
                          const populatedSampleAfter = merged
                            .filter(it => it && (it.existing_price !== undefined && it.existing_price !== null && it.existing_price !== ''))
                            .slice(0, 10)
                            .map(it => ({ id: it.id, item_code: it.item_code, existing_price: it.existing_price, item_name: it.item_name }))
                          console.log('DEBUG: After bulk populate, items populated with existing_price (sample):', populatedSampleAfter)
                        } catch (e) { console.debug('Error logging populated sample after setItems', e) }

                        // Update React state
                        setItems(merged)

                        // Send updated data directly to iframe to refresh the table with names and prices
                        try {
                          if (iframeRef.current && iframeRef.current.contentWindow) {
                            const priceKeys = ['existing_price', 'purchase_price', 'valor']
                            const preparedData = merged.map(item => priceListColumns.map(col => {
                              if (col.key === 'selected') {
                                return selectedRowsRef.current.has(item.id)
                              }
                              const value = item[col.key]
                              if (value === undefined || value === null || value === '') return ''
                              if (priceKeys.includes(col.key)) {
                                const n = parseFloat(value)
                                if (isNaN(n)) return ''
                                return Number(n.toFixed(2))
                              }
                              return value
                            }))
                            const rowIds = merged.map(item => item.id)
                            
                            console.log('DEBUG: Sending updated data to iframe after bulk fetch, rows:', merged.length)
                            iframeRef.current.contentWindow.postMessage({
                              type: 'ht-configure-table',
                              columns: priceListColumns,
                              data: preparedData,
                              rowIds,
                              selectAll: false
                            }, '*')
                          }
                        } catch (iframeErr) {
                          console.debug('Error sending updated data to iframe after bulk fetch', iframeErr)
                        }
                      } catch (e) {
                        console.debug('Error updating items state after bulk populate', e)
                      }
                    } catch (mapErr) {
                      console.debug('Error mapping bulk backend results into rows', mapErr)
                    }
                  } catch (err) {
                    console.debug('Error fetching pasted SKU details from backend (bulk)', err)
                  }
                })()
              }
            }
          } catch (e) {
            console.debug('Error in paste-mode backend logging', e)
          }

          suppressIframeRefreshRef.current = true
          setItems(prev => {
            const prevMap = new Map(prev.map(item => [item.id, item]))
            const merged = prev.map(item => incomingById.get(item.id) ?? item)
            incomingById.forEach((value, id) => {
              if (!prevMap.has(id)) {
                merged.push(value)
              }
            })

            try {
              // log a sample of rows where existing_price was populated
              const populatedSample = merged
                .filter(it => it && (it.existing_price !== undefined && it.existing_price !== null && it.existing_price !== ''))
                .slice(0, 10)
                .map(it => ({ id: it.id, item_code: it.item_code, existing_price: it.existing_price }))
              console.log('DEBUG: After merging, items populated with existing_price (sample):', populatedSample)
            } catch (e) {
              console.debug('Error logging populated sample after merge', e)
            }

            return merged
          })

          setSelectedRows(new Set(updatedSelection))
          
          // Si se detectaron valores ambiguos y estamos en modo auto, mostrar modal
          // Solo si el modal no está ya abierto (puede haberse abierto desde beforePaste del iframe)
          if (decimalSeparatorRef.current === 'auto' && ambiguousSamples.length > 0 && !isDecimalModalOpenRef.current) {
            console.log('DECIMAL [ht-data-changed]: Opening modal with samples:', ambiguousSamples.slice(0, 6), 'suggested:', suggestedSeparator)
            openDecimalModal(ambiguousSamples.slice(0, 6), suggestedSeparator)
          } else if (ambiguousSamples.length > 0) {
            console.log('DECIMAL [ht-data-changed]: Found ambiguous samples but modal already open or separator set. Samples:', ambiguousSamples.slice(0, 6))
          }
          break
        }
        case 'ht-cell-changed': {
          const { rowIndex, colKey, value } = msg
          if (typeof rowIndex === 'number' && colKey) {
            const targetRow = visibleItemsRef.current?.[rowIndex]
            if (targetRow) {
              // Apply price normalization for price columns
              let normalizedValue = value
              if (colKey === 'valor') {
                // Detectar formato ambiguo si estamos en modo auto y el modal no está abierto
                if (decimalSeparatorRef.current === 'auto' && value !== undefined && value !== null && value !== '' && !isDecimalModalOpenRef.current) {
                  const detection = detectAmbiguousDecimalFormat(value)
                  if (detection?.ambiguous) {
                    console.log('DECIMAL [ht-cell-changed]: Detected ambiguous value:', value)
                    openDecimalModal([detection.sample], detection.suspected)
                  }
                }
                normalizedValue = normalizePriceInput(value, { decimalSeparator: decimalSeparatorRef.current })
              }
              suppressIframeRefreshRef.current = true
              updateItemCell(targetRow.id, colKey, normalizedValue)
            }
          }
          break
        }
        case 'ht-add-row':
          addItemRow()
          break
        case 'ht-delete-row': {
          if (typeof msg.row === 'number') {
            const targetRow = visibleItemsRef.current?.[msg.row]
            if (targetRow) {
              deleteItemRow(targetRow.id)
            }
          }
          break
        }
        case 'ht-toggle-select-all':
          handleToggleSelectAll()
          break
        case 'ht-rows-removed': {
          if (Array.isArray(msg.removedIds) && msg.removedIds.length > 0) {
            setItems(prev => prev.filter(item => !msg.removedIds.includes(item.id)))
            setSelectedRows(prev => {
              const next = new Set(prev)
              msg.removedIds.forEach(id => next.delete(id))
              return next
            })
          }
          break
        }
        case 'ht-filters-changed': {
          if (typeof msg.filteredRowCount === 'number') {
            setFilteredRowCount(msg.filteredRowCount)
          }
          break
        }
        case 'ht-filter-applied': {
          // New message from iframe when column filters are applied
          if (Array.isArray(msg.visibleRowIds)) {
            console.log('FILTER: Received ht-filter-applied, visible rows:', msg.visibleRowIds.length, 'of', msg.totalRowCount)
            setVisibleRowIds(msg.visibleRowIds)
            setFilteredRowCount(msg.visibleRowIds.length)
          } else {
            // No filter active or filter cleared
            setVisibleRowIds(null)
            setFilteredRowCount(null)
          }
          break
        }
        case 'ht-decimal-format-detected': {
          // Mensaje del iframe cuando detecta valores ambiguos al pegar (ANTES de que se procesen)
          console.log('DECIMAL: Received ht-decimal-format-detected:', {
            samples: msg.samples,
            suspected: msg.suspected,
            currentSeparator: decimalSeparatorRef.current,
            isModalOpen: isDecimalModalOpenRef.current,
            timestamp: msg.timestamp
          })
          
          // Siempre mostrar el modal si estamos en modo 'auto' y hay samples
          if (decimalSeparatorRef.current === 'auto') {
            if (Array.isArray(msg.samples) && msg.samples.length > 0) {
              // Evitar abrir múltiples modales si ya está abierto
              if (!isDecimalModalOpenRef.current) {
                console.log('DECIMAL: Opening modal from iframe detection')
                openDecimalModal(msg.samples.slice(0, 6), msg.suspected)
              } else {
                console.log('DECIMAL: Modal already open, skipping')
              }
            } else {
              console.log('DECIMAL: No samples in message, skipping modal')
            }
          } else {
            console.log('DECIMAL: Separator already set to', decimalSeparatorRef.current, ', skipping modal')
          }
          break
        }
        default:
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [priceListColumns])

  const loadSalesPriceLists = async () => {
    console.log('loadSalesPriceLists: Starting...')
    try {
      const response = await fetchWithAuth(API_ROUTES.salesPriceLists)
      console.log('loadSalesPriceLists: Response status:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('loadSalesPriceLists: Data received:', data)
        setSalesPriceLists(data.data || [])
      } else {
        console.error('loadSalesPriceLists: Response not ok:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error loading sales price lists:', error)
      showNotification('Error al cargar listas de precios de venta', 'error')
    }
  }

  const loadPurchaseLists = async () => {
    console.log('loadPurchaseLists: Starting...')
    try {
      const response = await fetchWithAuth('/api/inventory/purchase-price-lists/all')
      console.log('loadPurchaseLists: Response status:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('loadPurchaseLists: Data received:', data)
        setPurchasePriceLists(data.data || [])
      } else {
        console.error('loadPurchaseLists: Response not ok:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error loading purchase price lists:', error)
    }
  }

  const loadItemCategories = async () => {
    console.log('loadItemCategories: Starting...')
    try {
  const response = await fetchWithAuth('/api/item-groups?kind=leafs')
      console.log('loadItemCategories: Response status:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('loadItemCategories: Data received:', data)
        setItemCategories(data.data || [])
      } else {
        console.error('loadItemCategories: Response not ok:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error loading item categories:', error)
    }
  }

  const loadItemBrands = async () => {
    console.log('loadItemBrands: Starting...')
    try {
      const response = await fetchWithAuth('/api/brands')
      console.log('loadItemBrands: Response status:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('loadItemBrands: Data received:', data)
        setItemBrands(data.data || [])
      } else {
        console.error('loadItemBrands: Response not ok:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error loading item brands:', error)
    }
  }

  const loadCustomerGroups = async () => {
    try {
      const response = await fetchWithAuth('/api/customer-groups')
      if (response.ok) {
        const data = await response.json()
        setCustomerGroups(data.data || [])
      } else {
        console.error('Error loading customer groups:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error loading customer groups:', error)
    }
  }

  const handleFilterChange = (newFilter) => {
    const action = buildFilterChangeAction(newFilter, { activeFilter, selectedRows, items, visibleItems })
    if (!action.changed) return
    if (action.newActiveFilter) setActiveFilter(action.newActiveFilter)
    if (typeof action.filteredCount !== 'undefined') setFilteredRowCount(action.filteredCount)
    if (action.notify) showNotification(action.notify.message, action.notify.level)
  }

  const handleToggleSelectAll = () => {
    // Use the visibleItems from the memoized value
    setSelectedRows(prev => toggleSelectAllSet(prev, visibleItems))
  }

  const deleteSelectedItems = () => {
    const selectionCount = selectedRows.size
    if (selectionCount === 0) {
      showNotification('Selecciona al menos una fila para eliminar', 'warning')
      return
    }

    // Si estamos en modo 'update' y hay lista seleccionada, eliminar del backend
    if (creationMode === 'update' && selectedPriceList) {
      setShowDeleteItemsConfirm(true)
    } else {
      // En otros modos, solo eliminar de la tabla local
      setItems(prev => prev.filter(item => !selectedRows.has(item.id)))
      resetSelectionState()
      const rowsLabel = selectionCount === 1 ? 'fila seleccionada' : 'filas seleccionadas'
      showNotification(`Se eliminaron ${selectionCount} ${rowsLabel}`, 'success')
    }
  }

  // Función para ejecutar la eliminación de items de la lista de precios
  const executeDeleteSelectedItems = async () => {
    const selectionCount = selectedRows.size
    if (selectionCount === 0) {
      showNotification('No hay filas seleccionadas para eliminar', 'warning')
      return
    }

    if (!selectedPriceList) {
      showNotification('No hay lista de precios seleccionada', 'error')
      return
    }

    try {
      setIsDeletingItems(true)

      // Obtener los códigos de los items seleccionados
      const selectedItems = items.filter(item => selectedRows.has(item.id))
      const itemCodes = selectedItems.map(item => item.item_code).filter(code => code)

      if (itemCodes.length === 0) {
        showNotification('No se encontraron códigos válidos para eliminar', 'warning')
        return
      }

      // Llamar a la API para eliminar los item_price de la lista de precios
      const response = await fetchWithAuth(`${API_ROUTES.salesPriceList}${selectedPriceList}/items`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_codes: itemCodes,
          company: activeCompany
        })
      })

      if (response.ok) {
        const data = await response.json()
          if (data.success) {
          // Recargar los detalles de la lista para reflejar los cambios
          await loadPriceListDetails(selectedPriceList, itemType)
          resetSelectionState()

          const deletedCount = data.data?.deleted_count || itemCodes.length
          showNotification(`Se eliminaron ${deletedCount} artículos de la lista de precios`, 'success')

          // Cerrar modal
          setShowDeleteItemsConfirm(false)
        } else {
          showNotification(data.message || 'Error al eliminar artículos de la lista', 'error')
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'Error al eliminar artículos de la lista', 'error')
      }
    } catch (error) {
      console.error('Error deleting items from price list:', error)
      showNotification('Error al eliminar artículos de la lista', 'error')
    } finally {
      setIsDeletingItems(false)
    }
  }

  const handlePasteSkus = () => {
    setInputMode('paste')
    clearTableData({ silent: true })
  }

  const handleLoadData = () => {
    if (!selectedPriceList) {
      showNotification('Selecciona una lista de precios primero', 'warning')
      return
    }
    setInputMode('load_all')
    loadPriceListDetails(selectedPriceList, itemType)
  }

  const toggleKitMode = async () => {
    const newType = itemType === 'kits' ? 'items' : 'kits'
    setItemType(newType)

    // Resetear tabla y selección
    try {
      if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'ht-clear-table' }, '*')
      }
    } catch (e) {
      console.debug('Error clearing iframe table during toggleKitMode', e)
    }
    setItems([])
    resetSelectionState()
    
    // Resetear a modo paste cuando se cambia de tipo
    setInputMode('paste')

    // NO cargar datos automáticamente - el usuario debe elegir "Cargar Datos" o pegar SKUs
    // Esto aplica tanto para items como para kits
    // Notify parent/iframe about mode change so it can provide kits list when needed
    try {
      console.log(`SalesPriceListManager: toggled mode -> ${newType}`)
      window.postMessage({ type: 'ht-set-mode', itemType: newType }, window.location.origin)
    } catch (e) {
      console.debug('Error posting ht-set-mode to parent', e)
    }
  }

  const loadPurchaseListDetails = async (priceListName) => {
    if (!priceListName) {
      setSelectedPurchaseListData(null)
      setExchangeRate(1)
      return
    }

    try {
      // Usar el mismo endpoint que en SalesPriceListImport: /purchase-price-lists/<name>/prices
      const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListPrices}${encodeURIComponent(priceListName)}/prices?company=${encodeURIComponent(activeCompany || '')}`)
      if (response.ok) {
        const data = await response.json()
        setSelectedPurchaseListData(data)

        // Si la moneda de la lista de compra es diferente a la de venta, intentar obtener el exchange rate
        const purchaseCurrency = data.price_list?.currency
        const saleCurrency = isCreatingNew ? newListCurrency : (currentPriceListData?.price_list?.currency || companyCurrency || '')

        let currentExchangeRate = 1
        if (purchaseCurrency && saleCurrency && purchaseCurrency !== saleCurrency) {
          const exchangeResponse = await fetchWithAuth(`/api/currency/exchange-rate?from=${purchaseCurrency}&to=${saleCurrency}`)
          const exchangeData = await exchangeResponse.json().catch(() => ({}))
          if (!exchangeResponse.ok || exchangeData?.success === false) {
            showNotification(`No se pudo obtener cotización ${purchaseCurrency}/${saleCurrency}`, 'error')
            setExchangeRate(null)
            return
          }
          const rate = exchangeData.exchange_rate ?? exchangeData.data?.exchange_rate
          if (!(Number(rate) > 0)) {
            showNotification(`Cotización inválida para ${purchaseCurrency}/${saleCurrency}`, 'error')
            setExchangeRate(null)
            return
          }
          currentExchangeRate = Number(rate)
        }
        setExchangeRate(currentExchangeRate)
        
        // Cargar SKUs pasando el exchange rate directamente (no esperar actualización de estado)
        try {
          const exchangeRateToUse = currentExchangeRate
          
          await fetchAndLoadSKUs(exchangeRateToUse)
        } catch (e) {
          console.debug('Error auto-loading SKUs after selecting purchase list', e)
        }
      }
    } catch (error) {
      console.error('Error loading purchase list details:', error)
      setSelectedPurchaseListData(null)
      setExchangeRate(null)
    }
  }

  const searchItems = async (query) => {
    if (!query.trim()) {
      setItemSearchResults([])
      return
    }

    try {
      const params = new URLSearchParams()
      params.append('company', activeCompany || '')
      params.append('search', query.trim())

      const response = await fetchWithAuth(`/api/inventory/items?${params}`)
      if (response.ok) {
        const data = await response.json()
        setItemSearchResults(data.data || [])
      }
    } catch (error) {
      console.error('Error searching items:', error)
      setItemSearchResults([])
    }
  }

  const loadPriceListDetails = async (priceListName, itemTypeParam = null) => {
    try {
      const data = await fetchSalesPriceListDetails(fetchWithAuth, priceListName, itemTypeParam || itemType, activeCompany)
      if (!data) {
        showNotification('Error al cargar detalles de la lista de precios', 'error')
        return
      }
      console.log('SalesPriceListManager: loadPriceListDetails - Data received:', data)
      console.log('SalesPriceListManager: loadPriceListDetails - Prices array:', data.prices)

      // Normalize and pick the latest Item Price per item_code (by valid_from, fallback to modified/creation)
      const rawPrices = Array.isArray(data.prices) ? data.prices : []
      const latestMap = {}
      rawPrices.forEach(p => {
        try {
          const rawCode = p.item_code || ''
          const key = stripAbbr(rawCode)
          if (!key) return

          const parseDate = (s) => {
            if (!s) return 0
            const t = Date.parse(s)
            return isNaN(t) ? 0 : t
          }

          const newPriority = parseDate(p.valid_from) || parseDate(p.modified) || parseDate(p.creation) || 0

          const existing = latestMap[key]
          if (!existing) {
            latestMap[key] = p
          } else {
            const existingPriority = parseDate(existing.valid_from) || parseDate(existing.modified) || parseDate(existing.creation) || 0
            if (newPriority >= existingPriority) {
              // prefer newer or equal (keep replacement to get most recent)
              latestMap[key] = p
            }
          }
        } catch (e) {
          console.debug('Error processing price row for dedupe:', e, p)
        }
      })

      const dedupedPrices = Object.values(latestMap)

      setCurrentPriceListData(data)

      // Inicializar valores editables
      setEditListName(data.price_list?.price_list_name || '')
      setEditListCurrency(data.price_list?.currency)

      // Convertir los precios a formato de tabla
      const tableItems = (dedupedPrices || []).map((price, index) => ({
        id: index + 1,
        item_code: stripAbbr(price.item_code),
        item_name: stripCompanySuffix(price.item_name || ''),
        item_group: price.item_group || '',
        existing_price: toNumberValue(price.price_list_rate), // Precio actual (numeric)
        purchase_price: '', // Vacío - se llenará cuando se cargue lista de compras
        valor: '', // Vacío - será calculado por usuario
        original_price: price.price_list_rate, // Guardar precio original
        errors: {}
      }))

      console.log('SalesPriceListManager: loadPriceListDetails - Table items created:', tableItems.map(it => ({ item_code: it.item_code, existing_price: it.existing_price })))

      setItems(tableItems)
      setOriginalItems(tableItems.map(item => ({ ...item }))) // Copia profunda para comparación
      resetSelectionState()

      // Send to iframe to load data
      try {
        if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
          const payload = tableItems.map(it => ({ 
            item_code: it.item_code, 
            item_name: it.item_name || '',
            existing_price: it.existing_price, // Solo precio actual
            purchase_price: '', // Vacío
            new_price: '' // Vacío
          }))
          console.log('SalesPriceListManager: loadPriceListDetails - Payload to iframe:', payload)
          iframeRef.current.contentWindow.postMessage({ type: 'ht-load-items', items: payload }, '*')
        }
      } catch (e) {
        console.debug('Error posting items to iframe', e)
      }
    } catch (error) {
      console.error('Error loading price list details:', error)
      showNotification('Error al cargar detalles de la lista de precios', 'error')
    }
  }

  const handlePriceListSelection = (priceListName) => {
    setSelectedPriceList(priceListName)
    setIsCreatingNew(false)
    if (priceListName) {
      loadPriceListDetails(priceListName, itemType)
    } else {
      setCurrentPriceListData(null)
      setItems([])
      resetSelectionState()
    }
  }

  const handleCreateNew = () => {
    setIsCreatingNew(true)
    setSelectedPriceList('')
    setCurrentPriceListData(null)
    setItems([])
    resetSelectionState()
    setNewListName('')
    setNewListCurrency(companyCurrency || '')
    setNewListValidFrom('')
    setCreationMethod('manual')
    setCalculatedPrices([])
  }

  const calculateFromPurchase = async () => {
    if (!selectedPurchaseList || markupPercentage < 0) {
      showNotification('Selecciona una lista de compra y un markup válido', 'warning')
      return
    }

    setIsCalculating(true)
    try {
      const response = await fetchWithAuth(API_ROUTES.calculateSalesFromPurchase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_list_name: selectedPurchaseList,
          markup_percentage: markupPercentage,
          exchange_rate: exchangeRate
        })
      })

      if (response.ok) {
        const data = await response.json()
        setCalculatedPrices(data.data || [])

        // Convertir a formato de tabla
        const tableItems = data.data.map((item, index) => ({
          id: index + 1,
          item_code: stripAbbr(item.item_code),
          item_name: stripCompanySuffix(item.item_name || ''),
          existing_price: toNumberValue(item.existing_price !== undefined ? item.existing_price : ''),
          purchase_price: toNumberValue(item.purchase_price_converted !== undefined ? item.purchase_price_converted : (item.purchase_price !== undefined ? item.purchase_price : '')),
          purchase_price_converted: item.purchase_price_converted,
          valor: item.calculated_sale_price,
          errors: {}
        }))

        setItems(tableItems)
        resetSelectionState()
        // Send computed rows to the iframe demo so it can populate the Handsontable
        try {
            if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
              const payload = tableItems.map(it => ({
                item_code: it.item_code,
                item_name: it.item_name || '',
                existing_price: toNumberValue(it.existing_price),
                purchase_price: toNumberValue(it.purchase_price),
                new_price: toNumberValue(it.valor)
              }))
              iframeRef.current.contentWindow.postMessage({ type: 'ht-load-items', items: payload }, '*')
            }
        } catch (e) {
          console.debug('Error posting calculated items to iframe', e)
        }
        showNotification(`Calculados ${data.count} precios de venta`, 'success')
      } else {
        showNotification('Error al calcular precios', 'error')
      }
    } catch (error) {
      console.error('Error calculating prices:', error)
      showNotification('Error al calcular precios', 'error')
    } finally {
      setIsCalculating(false)
    }
  }

  // Helper: cuantos items tienen código y precio válido (para mostrar en el botón Guardar)
  // Using useMemo to ensure React tracks dependencies and updates the button count
  const saveableCount = useMemo(() => {
    // Use visibleItems if column filters are active
    const itemsToCount = visibleRowIds !== null ? visibleItems : items
    
    if (!itemsToCount || !itemsToCount.length) return 0
    
    let saveableItems
    if (isCreatingNew) {
      // Para listas nuevas, contar todos los items válidos
      // Debe tener: (item_code O item_name) Y valor válido
      saveableItems = itemsToCount.filter(it => {
        const code = it.item_code?.trim()
        const name = it.item_name?.trim()
        const val = parseFloat(it.valor)
        const hasIdentifier = code || name // Al menos uno debe existir
        const hasValidPrice = !isNaN(val) && val > 0
        return hasIdentifier && hasValidPrice
      })
    } else {
      // Para listas existentes, contar items con precio válido
      // En modo actualizar, los items YA tienen item_code e item_name desde la carga
      saveableItems = itemsToCount.filter(it => {
        const code = it.item_code?.trim()
        const name = it.item_name?.trim()
        const val = parseFloat(it.valor)
        const hasIdentifier = code || name
        const hasValidPrice = !isNaN(val) && val > 0
        return hasIdentifier && hasValidPrice
      })
    }
    const count = saveableItems.length
    console.log('saveableCount - Total items:', items.length, 'Visible items:', itemsToCount.length, 'Saveable items:', count)
    return count
  }, [items, visibleItems, visibleRowIds, isCreatingNew])
  
  // Wrapper function for backward compatibility
  const getSaveableCount = () => saveableCount

  // Fetch SKUs and computed prices, but do not overwrite local items state - only send to iframe
  const fetchAndLoadSKUs = async (overrideExchangeRate = null) => {
    if (!selectedPurchaseList || markupPercentage < 0) {
      showNotification('Selecciona una lista de compra y un markup válido', 'warning')
      return
    }

    // Usar el exchange rate pasado como parámetro o el del estado
    const currentExchangeRate = overrideExchangeRate !== null ? overrideExchangeRate : exchangeRate
    const purchaseCurrency = selectedPurchaseListData?.price_list?.currency
    const saleCurrency = isCreatingNew ? newListCurrency : currentPriceListData?.price_list?.currency
    const requiresConversion = Boolean(purchaseCurrency && saleCurrency && purchaseCurrency !== saleCurrency)
    if (requiresConversion && !(Number.isFinite(currentExchangeRate) && currentExchangeRate > 0)) {
      showNotification(`Falta cotización válida para convertir ${purchaseCurrency} → ${saleCurrency}`, 'error')
      return
    }

    try {
      const response = await fetchWithAuth(API_ROUTES.calculateSalesFromPurchase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_list_name: selectedPurchaseList,
          // En modo "Crear Nueva", NO aplicamos markup automático - solo copiamos los precios convertidos
          // El usuario podrá aplicar markup manualmente con la calculadora si lo desea
          markup_percentage: isCreatingNew ? 0 : markupPercentage,
          exchange_rate: currentExchangeRate
        })
      })

      if (response.ok) {
        const data = await response.json()
        
        console.log(`fetchAndLoadSKUs: Response from backend:`, data)
        
        // El backend YA hizo todas las conversiones necesarias.
        // Normalizar y enviar payload numérico al iframe.
        const payload = (data.data || []).map(it => ({
          item_code: stripAbbr(it.item_code),
          item_name: stripCompanySuffix(it.item_name || ''),
          existing_price: toNumberValue(it.existing_price !== undefined ? it.existing_price : (it.existing_price_from_erp || '')),
          purchase_price: toNumberValue(it.purchase_price_converted !== undefined ? it.purchase_price_converted : (it.purchase_price || '')),
          new_price: 0
        }))

        try {
          if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage({ type: 'ht-load-items', items: payload }, '*')
          }
        } catch (e) {
          console.debug('Error posting SKUs to iframe', e)
        }

        // Mensaje informativo sobre la conversión
        const needsConversion = requiresConversion && Number.isFinite(currentExchangeRate) && currentExchangeRate !== 1
        const labelTerm = itemType === 'kits' ? 'Kits' : 'SKUs'
        if (needsConversion) {
          showNotification(`Se cargaron ${payload.length} ${labelTerm} (convertidos de ${purchaseCurrency} a ${saleCurrency} con cotización ${currentExchangeRate.toFixed(4)})`, 'success')
        } else {
          showNotification(`Se cargaron ${payload.length} ${labelTerm} en la tabla`, 'success')
        }

        // Also update local items so the Save button reflects count and validation
        const tableItems = payload.map((it, index) => ({
          id: Date.now() + index,
          item_code: it.item_code,
          item_name: it.item_name || '',
          existing_price: it.existing_price,
          purchase_price: it.purchase_price,
          valor: it.new_price,
          errors: {}
        }))
        setItems(tableItems)
        setOriginalItems(tableItems.map(it => ({ ...it, original_price: it.valor })))
        resetSelectionState()
        
      } else {
        showNotification('Error al traer SKUs desde la lista de compra', 'error')
      }
    } catch (error) {
      console.error('Error fetching SKUs:', error)
      showNotification('Error al traer SKUs', 'error')
    }
  }

  const addItemsByFilters = async () => {
    if (!selectedCategory && !selectedBrand && !selectedPurchaseListForItems) {
      showNotification('Selecciona al menos un filtro (categoría, marca o lista de precios)', 'warning')
      return
    }

    setIsLoadingItems(true)
    setItems([]) // Limpiar la tabla antes de agregar nuevos items
    resetSelectionState()
    try {
      const params = new URLSearchParams()
      params.append('company', activeCompany || '')
      if (selectedCategory) params.append('category', selectedCategory)
      if (selectedBrand) params.append('brand', selectedBrand)
      if (selectedPurchaseListForItems) params.append('price_list', selectedPurchaseListForItems)

      const response = await fetchWithAuth(`/api/inventory/items?${params}`)
      if (response.ok) {
        const data = await response.json()
        const itemsToAdd = data.data || []

        if (itemsToAdd.length === 0) {
          showNotification('No se encontraron items con los filtros seleccionados', 'info')
          return
        }

        // Obtener IDs existentes para evitar duplicados
        const existingItemCodes = new Set(items.map(item => item.item_code))

        // Filtrar items que no estén ya en la lista
        const newItems = itemsToAdd
          .filter(item => !existingItemCodes.has(item.item_code))
          .map(item => ({
            id: generateRowId(),
            item_code: item.item_code,
            item_name: stripCompanySuffix(item.item_name || ''),
            valor: '', // Dejar vacío
            errors: {}
          }))

        if (newItems.length === 0) {
          showNotification('Todos los items ya están en la lista', 'info')
          return
        }

        setItems(prev => [...prev, ...newItems])
        showNotification(`Agregados ${newItems.length} items a la lista`, 'success')

        // Limpiar filtros después de agregar
        setSelectedCategory('')
        setSelectedBrand('')
        setSelectedPurchaseListForItems('')
      } else {
        showNotification('Error al buscar items', 'error')
      }
    } catch (error) {
      console.error('Error adding items by filters:', error)
      showNotification('Error al agregar items', 'error')
    } finally {
      setIsLoadingItems(false)
    }
  }

  // Cargar items desde lista de precios de compra (modo actualizar)
  const loadItemsFromPurchaseList = async (purchaseListName) => {
    if (!purchaseListName) return

    try {
      console.log('Loading items from purchase list:', purchaseListName)
      // Usar el mismo endpoint que en loadPurchaseListDetails
      const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListPrices}${encodeURIComponent(purchaseListName)}/prices?company=${encodeURIComponent(activeCompany || '')}`)

      if (!response.ok) {
        throw new Error('Error al cargar items de la lista de compra')
      }

      const data = await response.json()
      console.log('Purchase list items loaded:', data)

      if (data.success && data.data && data.data.prices) {
        // Obtener moneda de la lista de compra desde price_list
        const purchaseCurrency = data.data.price_list?.currency
        const saleCurrency = priceListCurrency
        
        console.log('Purchase currency:', purchaseCurrency, 'Sale currency:', saleCurrency)

        // Calcular exchange rate si las monedas son diferentes (sin fallbacks)
        let exchangeRateToUse = 1
        if (purchaseCurrency !== saleCurrency) {
          const exchangeResponse = await fetchWithAuth(`/api/currency/exchange-rate?from=${purchaseCurrency}&to=${saleCurrency}`)
          const exchangeData = await exchangeResponse.json().catch(() => ({}))
          if (!exchangeResponse.ok || exchangeData?.success === false) {
            throw new Error(exchangeData?.message || `No se pudo obtener cotización ${purchaseCurrency}/${saleCurrency}`)
          }
          const rate = exchangeData.exchange_rate ?? exchangeData.data?.exchange_rate
          if (!(Number(rate) > 0)) {
            throw new Error(`Cotización inválida para ${purchaseCurrency}/${saleCurrency}`)
          }
          exchangeRateToUse = Number(rate)
        }

        console.log('Exchange rate to use:', exchangeRateToUse)

        const purchaseItems = data.data.prices.map(item => {
          const originalPrice = parseFloat(item.price_list_rate || 0)
          const convertedPrice = originalPrice * exchangeRateToUse
          
          console.log(`Item: ${item.item_code}, Original: ${originalPrice}, Converted: ${convertedPrice}`)
          
          return {
            item_code: stripAbbr(item.item_code),
            item_name: stripCompanySuffix(item.item_name || ''),
            purchase_price: convertedPrice
          }
        })
        
        console.log('Total purchase items to process:', purchaseItems.length)

        // Ensure we have the current sales price list data to pull existing prices.
        let salePriceRows = Array.isArray(currentPriceListData?.prices) ? currentPriceListData.prices : []
        if ((!salePriceRows || salePriceRows.length === 0) && selectedPriceList) {
          try {
            const freshSalesData = await fetchSalesPriceListDetails(fetchWithAuth, selectedPriceList, itemType, activeCompany)
            if (freshSalesData?.prices?.length) {
              salePriceRows = freshSalesData.prices
              // Only overwrite if we didn't have data already to avoid clobbering user changes
              if (!currentPriceListData) {
                setCurrentPriceListData(freshSalesData)
              }
            }
          } catch (saleErr) {
            console.error('Error fetching sales price list data for existing price lookup:', saleErr)
          }
        }

        // Build a lookup for existing sale prices so we can keep the "Precio actual" column populated
        const salePriceLookup = new Map()
        const registerSalePrice = (code, value) => {
          const normalized = stripAbbr(code)
          if (!normalized) return
          if (value === undefined || value === null || String(value).trim() === '') return
          const numericValue = toNumberValue(value)
          if (!Number.isFinite(numericValue)) return
          salePriceLookup.set(normalized, numericValue)
        }

        items.forEach(item => registerSalePrice(item.item_code, item.existing_price ?? item.valor ?? item.current_price))
        originalItems.forEach(item => {
          const normalized = stripAbbr(item.item_code)
          if (!salePriceLookup.has(normalized)) {
            registerSalePrice(item.item_code, item.existing_price ?? item.valor ?? item.current_price)
          }
        })
        if (Array.isArray(salePriceRows)) {
          salePriceRows.forEach(priceRow => registerSalePrice(priceRow.item_code, priceRow.price_list_rate))
        }

        // Actualizar items existentes o agregar nuevos
        let updatedCount = 0
        let addedCount = 0
        
        const updatedItems = [...items]
        
        purchaseItems.forEach(purchaseItem => {
          // Buscar si el item ya existe en la tabla
          const existingIndex = updatedItems.findIndex(
            item => stripAbbr(item.item_code) === purchaseItem.item_code
          )

          if (existingIndex >= 0) {
            // Actualizar precio de compra del item existente
            updatedItems[existingIndex] = {
              ...updatedItems[existingIndex],
              purchase_price: purchaseItem.purchase_price
            }
            updatedCount++
            console.log('Updated existing item:', purchaseItem.item_code, 'price:', purchaseItem.purchase_price)
          } else {
            const fallbackExistingPrice = salePriceLookup.get(purchaseItem.item_code) ?? ''
            // Agregar nuevo item
            updatedItems.push({
              id: generateRowId(),
              item_code: purchaseItem.item_code,
              item_name: purchaseItem.item_name,
              existing_price: fallbackExistingPrice,
              purchase_price: purchaseItem.purchase_price,
              valor: '',
              errors: {}
            })
            addedCount++
            console.log('Added new item:', purchaseItem.item_code, 'price:', purchaseItem.purchase_price)
          }
        })

        // Actualizar el estado
        console.log('Setting items state with', updatedItems.length, 'items')
        console.log('First 3 items:', updatedItems.slice(0, 3))
        setItems(updatedItems)

        // Mostrar resumen de la operación
        const conversionMsg = exchangeRateToUse !== 1 
          ? ` (convertidos de ${purchaseCurrency} a ${saleCurrency} con cotización ${exchangeRateToUse.toFixed(4)})`
          : ''
        
        const message = updatedCount > 0 && addedCount > 0 
          ? `${updatedCount} items actualizados, ${addedCount} items nuevos agregados${conversionMsg}`
          : updatedCount > 0
            ? `${updatedCount} items actualizados con precios de compra${conversionMsg}`
            : `${addedCount} items nuevos agregados desde lista de compra${conversionMsg}`
        
        showNotification(message, 'success')
      }
    } catch (error) {
      console.error('Error loading purchase list items:', error)
      showNotification('Error al cargar items de la lista de compra', 'error')
    }
  }

  const addItemToTable = (item) => {
    const newItem = {
      id: generateRowId(),
      item_code: item.item_code,
      item_name: stripCompanySuffix(item.item_name || ''),
      valor: '', // Dejar vacío para que el usuario lo complete
      errors: {}
    }

    setItems(prev => [...prev, newItem])
    setShowItemSearch(false)
    setItemSearchQuery('')
    setItemSearchResults([])
  }

  const updateItemCell = (itemId, colKey, value) => {
    setItems(prev => prev.map(row =>
      row.id === itemId ? { ...row, [colKey]: value } : row
    ))
  }

  const addItemRow = () => {
    const newItem = {
      id: generateRowId(),
      item_code: '',
      item_name: '',
      existing_price: '',
      purchase_price: '',
      valor: '', // Dejar vacío
      errors: {}
    }
    setItems(prev => [...prev, newItem])
  }

  const deleteItemRow = (itemId) => {
    setItems(prev => prev.filter(row => row.id !== itemId))
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
  }

  const savePriceList = async () => {
    // Use visibleItems instead of items to respect column filters
    const itemsToSave = visibleRowIds !== null ? visibleItems : items
    
    // Ignorar filas totalmente vacías (sin código, nombre ni precio)
    const rowsWithData = itemsToSave.filter(item => {
      const code = item.item_code?.trim()
      const name = item.item_name?.trim()
      const rawPrice = item.valor
      const hasPriceInput = rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== ''
      return code || name || hasPriceInput
    })

    if (rowsWithData.length === 0) {
      showNotification('Agrega al menos un item a la lista', 'warning')
      return
    }

    const isValidForSave = (item) => {
      const code = item.item_code?.trim()
      const name = item.item_name?.trim()
      const val = parseFloat(item.valor)
      return (code || name) && !Number.isNaN(val) && val > 0
    }

    const validItems = rowsWithData.filter(isValidForSave)
    const invalidItems = rowsWithData.filter(item => !isValidForSave(item))

    if (validItems.length === 0) {
      showNotification('Todos los items deben tener código y precio válido', 'warning')
      return
    }

    if (invalidItems.length > 0) {
      showNotification(`Se omitirán ${invalidItems.length} item(s) sin código o precio válido`, 'warning')
    }

    // En modo actualizar, usar selectedPriceList; en modo crear, usar newListName
    const priceListName = isCreatingNew ? newListName : selectedPriceList
    const currency = isCreatingNew ? newListCurrency : priceListCurrency

    // Validar que el nombre de la lista no esté vacío
    if (!priceListName || !priceListName.trim()) {
      showNotification('El nombre de la lista de precios es requerido', 'warning')
      return
    }

    setSaving(true)

    try {
      const validFrom = isCreatingNew ? newListValidFrom : null

      // Convertir items a CSV
      let csvHeaders
      if (itemType === 'kits') {
        // For kits only include relevant columns
        csvHeaders = ['Item Code', 'Price List', 'Currency', 'Rate']
      } else {
        csvHeaders = ['Item Code', 'Price List', 'Currency', 'Rate', 'Buying', 'Selling']
      }
      if (validFrom) {
        csvHeaders.push('Valid From')
      }

      const csvRows = [csvHeaders.join(',')]

      // Determinar qué items guardar (ya filtrados con la misma lógica del botón)
      const itemsToProcess = validItems

      console.log('FRONTEND: Items totales:', items.length, 'Items con datos visibles:', rowsWithData.length, 'Items a procesar:', itemsToProcess.length)

      itemsToProcess.forEach((item, index) => {
        // Usar item_code directamente (viene sin sufijo de compañía)
        const itemCode = item.item_code?.trim() || ''
        const itemName = item.item_name?.trim() || ''
        const valor = parseFloat(item.valor)

        // Validar que el item tenga al menos código o nombre, y un precio válido
        if (!itemCode && !itemName) {
          console.warn(`FRONTEND: Item ${index} sin código ni nombre, saltando`)
          return
        }

        if (isNaN(valor) || valor <= 0) {
          console.warn(`FRONTEND: Item ${index} (${itemCode || itemName}) con precio inválido: ${item.valor}, saltando`)
          return
        }

        console.log(`FRONTEND: Procesando item ${index + 1}/${itemsToProcess.length}: ${itemCode} - ${itemName} = ${valor}`)

        let row
        if (itemType === 'kits') {
          row = [
            `"${itemCode}"`,
            `"${priceListName}"`,
            `"${currency}"`,
            valor.toFixed(2)
          ]
        } else {
          row = [
            `"${itemCode}"`,
            `"${priceListName}"`,
            `"${currency}"`,
            valor.toFixed(2),
            '0', // Buying
            '1'  // Selling
          ]
        }

        if (validFrom) {
          row.push(`"${validFrom}"`)
        }

        csvRows.push(row.join(','))
      })

      const csvData = csvRows.join('\n')
      console.log('FRONTEND: CSV generado - Primeras 5 filas:')
      csvRows.slice(0, 5).forEach((row, i) => console.log(`FRONTEND: Fila ${i+1}: ${row}`))
      console.log(`FRONTEND: Total filas en CSV: ${csvRows.length - 1}`) // -1 por header

      const response = await fetchWithAuth(API_ROUTES.bulkSaveSalesPriceList, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_list_name: priceListName.trim(),
          currency: currency,
          valid_from: validFrom,
          csv_data: csvData,
          item_type: itemType === 'kits' ? 'kits' : undefined
        })
      })

      console.log('SalesPriceListManager: Enviando CSV a bulk-save:', {
        price_list_name: priceListName.trim(),
        currency: currency,
        valid_from: validFrom,
        csv_rows: csvRows.length - 1 // Restar header
      })

      if (response.ok) {
        const data = await response.json()
        const processId = data.process_id

        // Monitorear progreso
        const checkProgress = async () => {
          try {
            const progressResponse = await fetchWithAuth(`${API_ROUTES.bulkSaveSalesPriceListProgress}${processId}`)
            if (progressResponse.ok) {
              const progressData = await progressResponse.json()
              setSaveProgress(progressData)

              if (progressData.status === 'completed') {
                const labelTerm = itemType === 'kits' ? 'kits' : 'items'
                showNotification(`Lista guardada exitosamente: ${progressData.saved} ${labelTerm} guardados`, 'success')
                setSaving(false)
                setSaveProgress(null)

                // Recargar listas
                loadSalesPriceLists()

                // Si era una nueva lista, seleccionarla
                if (isCreatingNew) {
                  setSelectedPriceList(newListName)
                  setIsCreatingNew(false)
                  loadPriceListDetails(newListName, itemType)
                }
              } else if (progressData.status === 'error') {
                showNotification('Error al guardar la lista de precios', 'error')
                setSaving(false)
                setSaveProgress(null)
              } else {
                // Continuar monitoreando
                setTimeout(checkProgress, 1000)
              }
            }
          } catch (error) {
            console.error('Error checking progress:', error)
            setSaving(false)
            setSaveProgress(null)
          }
        }

        checkProgress()
      } else {
        showNotification('Error al iniciar guardado', 'error')
        setSaving(false)
      }
    } catch (error) {
      console.error('Error saving price list:', error)
      showNotification('Error al guardar la lista de precios', 'error')
      setSaving(false)
    }
  }

  const getFilteredRows = () => {
    return items.filter(row => {
      // Aplicar filtros de columna
      for (const [colKey, filterValue] of Object.entries(columnFilters)) {
        if (!filterValue) continue

        const cellValue = row[colKey] || ''
        const cellString = String(cellValue).toLowerCase()
        const filterString = filterValue.toLowerCase()

        if (filterValue === '(vacío)') {
          if (cellString.trim() !== '') return false
        } else {
          if (!cellString.includes(filterString)) return false
        }
      }
      return true
    })
  }

  const handleDeletePriceList = async () => {
    if (!selectedPriceList) {
      showNotification('Selecciona una lista de precios para eliminar', 'warning')
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetchWithAuth(`${API_ROUTES.salesPriceLists}/${encodeURIComponent(selectedPriceList)}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        showNotification('Lista de precios eliminada exitosamente', 'success')
        setSelectedPriceList('')
        setCurrentPriceListData(null)
        setItems([])
        resetSelectionState()
        setShowDeleteConfirm(false)
        loadSalesPriceLists() // Recargar la lista
      } else {
        showNotification('Error al eliminar la lista de precios', 'error')
      }
    } catch (error) {
      console.error('Error deleting price list:', error)
      showNotification('Error al eliminar la lista de precios', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  const applyBulkUpdate = () => {
    if (!bulkUpdateValue || bulkUpdateValue === '') {
      showNotification('Ingresa un valor para la actualización', 'warning')
      return
    }

    const value = parseFloat(bulkUpdateValue)
    if (isNaN(value)) {
      showNotification('El valor debe ser un número válido', 'warning')
      return
    }

    const updatedItems = items.map(item => {
      let newPrice = parseFloat(item.valor) || 0

      switch (bulkUpdateType) {
        case 'percentage':
          newPrice = newPrice * (1 + value / 100)
          break
        case 'fixed':
          newPrice = newPrice + value
          break
        case 'multiplier':
          newPrice = newPrice * value
          break
        default:
          break
      }

      return {
        ...item,
        valor: Math.max(0, newPrice).toFixed(2) // Evitar precios negativos
      }
    })

    setItems(updatedItems)

    showNotification(`Precios actualizados usando ${bulkUpdateType === 'percentage' ? 'porcentaje' : bulkUpdateType === 'fixed' ? 'valor fijo' : 'multiplicador'}`, 'success')

    // Send updated prices to iframe
    try {
      if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
        const payload = updatedItems.map(it => ({
          item_code: it.item_code,
          item_name: stripCompanySuffix(it.item_name || ''),
          existing_price: toNumberValue(it.existing_price),
          purchase_price: toNumberValue(it.purchase_price),
          new_price: toNumberValue(it.valor)
        }))
        iframeRef.current.contentWindow.postMessage({ type: 'ht-load-items', items: payload }, '*')
      }
    } catch (e) {
      console.debug('Error posting updated items to iframe', e)
    }
  }

  const getChangedItems = () => {
    return items.filter((item, index) => {
      const original = originalItems[index]
      return original && parseFloat(item.valor) !== parseFloat(original.original_price)
    })
  }

  const totalItems = items.length
  const selectedCount = selectedRows.size
  const displayedCount = Math.max(0, filteredRowCount !== null ? filteredRowCount : visibleItems.length)
  const selectedLabel = selectedCount === 1 ? 'seleccionado' : 'seleccionados'
  const visibleLabel = displayedCount === 1 ? 'visible' : 'visibles'
  const totalLabel = totalItems === 1 ? 'total' : 'totales'

  return (
    <div className="h-full flex flex-col bg-white/80 backdrop-blur-xl shadow-2xl rounded-2xl border border-gray-200/50 overflow-hidden">
      
      <style>
        {`
          .dynamic-section {
            transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
          }
          .dynamic-section.hidden {
            opacity: 0;
            transform: translateY(-10px);
            pointer-events: none;
            position: absolute;
          }
        `}
      </style>
      
      {/* Cabecera de Gestión */}
      <div className="px-6 py-4 border-b border-gray-200">
        {/* Título arriba de los botones */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">Gestión</div>
              <div className="flex items-center gap-3">
                <div className="text-xl font-bold text-gray-800">Listas de Precios de Venta</div>
                {itemType === 'kits' && (
                  <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold">MODO KITS</span>
                )}
              </div>
            </div>
          </div>

          {/* Botón para abrir modal de gestión */}
          <button
            onClick={() => setIsManagementModalOpen(true)}
            className="btn-secondary"
            title="Gestionar listas de precios (habilitar/deshabilitar/eliminar)"
          >
            <Settings className="w-4 h-4" />
            Gestionar Listas
          </button>
        </div>

        <div className="flex items-end justify-between gap-6">
          {/* Sección izquierda: Modos de creación */}
          <div className="flex items-end gap-4">
            <div className="flex flex-col justify-end">
              <div className="flex gap-2 bg-gray-100 p-1 rounded-lg h-9">
                <button
                  className={`btn-mode-selector ${creationMode === 'update' ? 'active' : ''}`}
                  onClick={() => setCreationMode('update')}
                >
                  Actualizar Existentes
                </button>
                <button
                  className={`btn-mode-selector ${creationMode === 'manual' ? 'active' : ''}`}
                  onClick={() => setCreationMode('manual')}
                >
                  Crear Nueva
                </button>
              </div>
            </div>
          </div>

          {/* Sección derecha: Controles */}
          <div className="flex items-end gap-3 flex-1 min-w-[300px] justify-end">

            {creationMode === 'update' ? (
              /* Controles para Actualizar Existentes */
              <div className="flex items-end gap-3 flex-wrap">
                {/* Lista Venta */}
                <div className="flex flex-col">
                  <label htmlFor="existing-price-list" className="block text-xs font-medium text-gray-600 mb-1">Lista Venta</label>
                  <select
                    id="existing-price-list"
                    name="existing-price-list"
                    value={selectedPriceList}
                    onChange={(e) => handlePriceListSelection(e.target.value)}
                    className="form-select w-full sm:w-52 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  >
                    {salesPriceLists.map(list => (
                      <option key={list.name} value={list.name}>{list.price_list_name}</option>
                    ))}
                  </select>
                </div>

                {/* Moneda */}
                <div className="flex flex-col">
                  <label htmlFor="price-list-currency" className="block text-xs font-medium text-gray-600 mb-1">Moneda</label>
                  <select
                    id="price-list-currency"
                    name="price-list-currency"
                    value={priceListCurrency}
                    onChange={(e) => setPriceListCurrency(e.target.value)}
                    className="form-select w-full sm:w-20 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  >
                    <option value="">{currenciesLoading ? 'Cargando…' : 'Seleccionar…'}</option>
                    {currencyDocs.length === 0 && priceListCurrency ? (
                      <option value={priceListCurrency}>{priceListCurrency}</option>
                    ) : null}
                    {currencyDocs.map((currency) => {
                      const code = currency.name || currency.code
                      const label = (currency.currency_name || code) + (currency.symbol ? ` (${currency.symbol})` : '')
                      return (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </div>

                {/* Cotización */}
                {priceListCurrency && priceListCurrency !== companyCurrency && (
                  <div className="flex flex-col">
                    <label htmlFor="price-list-exchange-rate" className="block text-xs font-medium text-gray-600 mb-1">Cotización</label>
                    <input
                      type="number"
                      id="price-list-exchange-rate"
                      name="price-list-exchange-rate"
                      value={priceListExchangeRate}
                      onChange={(e) => setPriceListExchangeRate(e.target.value)}
                      min="0"
                      step="0.0001"
                      placeholder="1.0000"
                      className="form-input w-full sm:w-24 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                    />
                  </div>
                )}

                {/* Botones de modo de entrada - con altura fija h-9 */}
                <div className="flex flex-col justify-end">
                  <div className="flex gap-2 bg-gray-100 p-1 rounded-lg h-9">
                    <button
                      onClick={handlePasteSkus}
                      className={`btn-mode-selector ${inputMode === 'paste' ? 'active' : ''}`}
                    >
                      Pegar SKUs
                    </button>
                    <button
                      onClick={handleLoadData}
                      className={`btn-mode-selector ${inputMode === 'load_all' ? 'active' : ''}`}
                      disabled={!selectedPriceList}
                      title={!selectedPriceList ? 'Selecciona una lista de precios primero' : 'Cargar items de la lista seleccionada'}
                    >
                      Cargar Datos
                    </button>
                    <button
                      onClick={toggleKitMode}
                      className={`btn-filter ${itemType === 'kits' ? 'btn-filter-warning-active' : 'btn-filter-warning'}`}
                      title={itemType === 'kits' ? 'Desactivar modo Kits' : 'Activar modo Kits'}
                    >
                      Kits
                    </button>
                  </div>
                </div>

                {/* Lista de Precios de Compra (oculto para kits) */}
                {itemType !== 'kits' && (
                  <div className="flex flex-col">
                    <label htmlFor="purchase-list-for-update" className="block text-xs font-medium text-gray-600 mb-1">Lista Precios Compra</label>
                    <select
                      id="purchase-list-for-update"
                      name="purchase-list-for-update"
                      value={selectedPurchaseListForUpdate}
                      onChange={(e) => setSelectedPurchaseListForUpdate(e.target.value)}
                      className="form-select w-full sm:w-48 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                    >
                      <option value="">Seleccionar lista de compra...</option>
                      {purchasePriceLists.map(list => (
                        <option key={list.name} value={list.name}>{list.price_list_name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Botón Calculadora */}
                <div className="flex flex-col justify-end">
                  <button
                    className={`flex items-center gap-2 h-9 px-4 ${canOpenCalculator() ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'} font-semibold rounded-lg shadow-md transition-all`}
                    title={canOpenCalculator() ? 'Calculadora de Precios' : 'Necesitas al menos un precio para usar la calculadora'}
                    onClick={() => setIsCalculatorOpen(true)}
                    disabled={!canOpenCalculator()}
                  >
                    <Calculator className="w-4 h-4" />
                    <span>Calculadora</span>
                  </button>
                </div>

                {/* Botón Guardar */}
                <div className="flex flex-col justify-end">
                  <button
                    className="flex items-center gap-2 h-9 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all disabled:bg-gray-400"
                    title="Guardar Cambios"
                    onClick={savePriceList}
                    disabled={getSaveableCount() === 0 || saving || !selectedPriceList}
                  >
                    <Save className="w-4 h-4" />
                    <span>{saving ? 'Guardando...' : `Guardar (${getSaveableCount()})`}</span>
                  </button>
                </div>
              </div>
            ) : creationMode === 'manual' ? (
              /* Controles para Crear Nueva */
              <div className="flex items-end gap-3 flex-wrap">
                {itemType !== 'kits' && (
                  <div className="flex flex-col">
                    <label htmlFor="purchase-list-select" className="block text-xs font-medium text-gray-600 mb-1">Lista Precios Compra</label>
                    <select
                      id="purchase-list-select"
                      name="purchase-list-select"
                      value={selectedPurchaseList}
                      onChange={(e) => setSelectedPurchaseList(e.target.value)}
                      className="form-select w-full sm:w-48 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                    >
                      <option value="">Seleccionar lista de compra...</option>
                      {purchasePriceLists.map(list => (
                        <option key={list.name} value={list.name}>{list.price_list_name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Nombre de la lista */}
                <div className="flex flex-col">
                  <label htmlFor="new-list-name" className="block text-xs font-medium text-gray-600 mb-1">Nombre Lista</label>
                  <input
                    type="text"
                    id="new-list-name"
                    name="new-list-name"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder="Nombre de la lista"
                    className="form-input w-full sm:w-40 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  />
                </div>

                {/* Moneda */}
                <div className="flex flex-col">
                  <label htmlFor="new-list-currency" className="block text-xs font-medium text-gray-600 mb-1">Moneda</label>
                  <select
                    id="new-list-currency"
                    name="new-list-currency"
                    value={newListCurrency}
                    onChange={(e) => setNewListCurrency(e.target.value)}
                    className="form-select w-full sm:w-20 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                  >
                    <option value="">{currenciesLoading ? 'Cargando…' : 'Seleccionar…'}</option>
                    {currencyDocs.length === 0 && newListCurrency ? (
                      <option value={newListCurrency}>{newListCurrency}</option>
                    ) : null}
                    {currencyDocs.map((currency) => {
                      const code = currency.name || currency.code
                      const label = (currency.currency_name || code) + (currency.symbol ? ` (${currency.symbol})` : '')
                      return (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </div>

                {/* Cotización (solo si no es la moneda de la compañía) */}
                {newListCurrency && newListCurrency !== companyCurrency && (
                  <div className="flex flex-col">
                    <label htmlFor="new-list-exchange-rate" className="block text-xs font-medium text-gray-600 mb-1">Cotización</label>
                    <input
                      type="number"
                      id="new-list-exchange-rate"
                      name="new-list-exchange-rate"
                      value={newListExchangeRate}
                      onChange={(e) => setNewListExchangeRate(e.target.value)}
                      min="0"
                      step="0.0001"
                      placeholder="1.0000"
                      className="form-input w-full sm:w-24 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                    />
                  </div>
                )}

                {/* Grupos de clientes - Alineado al final sin label para mantener altura h-9 */}
                <div className="flex flex-col">
                  <label htmlFor="customer-groups-select" className="block text-xs font-medium text-gray-600 mb-1">Grupos Clientes</label>
                  <select
                    id="customer-groups-select"
                    multiple
                    value={selectedCustomerGroups}
                    onChange={(e) => {
                      const values = Array.from(e.target.selectedOptions, option => option.value)
                      setSelectedCustomerGroups(values)
                    }}
                    className="form-select w-full sm:w-48 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-20"
                  >
                    {customerGroups.map(group => (
                      <option key={group.name} value={group.name}>{group.customer_group_name}</option>
                    ))}
                  </select>
                </div>

                {/* Botón Calculadora */}
                <div className="flex flex-col justify-end">
                  <button
                    className={`flex items-center gap-2 h-9 px-4 ${canOpenCalculator() ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'} font-semibold rounded-lg shadow-md transition-all`}
                    title={canOpenCalculator() ? 'Calculadora de Precios' : 'Necesitas al menos un precio para usar la calculadora'}
                    onClick={() => setIsCalculatorOpen(true)}
                    disabled={!canOpenCalculator()}
                  >
                    <Calculator className="w-4 h-4" />
                    <span>Calculadora</span>
                  </button>
                </div>

                {/* Botón Guardar con contador */}
                <div className="flex flex-col justify-end">
                  {(() => {
                    const saveableCount = getSaveableCount()
                    const hasName = newListName.trim() !== ''
                    const isEnabled = saveableCount > 0 && hasName
                    console.log('Botón Guardar - saveableCount:', saveableCount, 'hasName:', hasName, 'isEnabled:', isEnabled)
                    return (
                      <button
                        className="flex items-center gap-2 h-9 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all disabled:bg-gray-400"
                        title="Guardar Lista de Precios"
                        onClick={savePriceList}
                        disabled={!isEnabled}
                      >
                        <Save className="w-4 h-4" />
                        <span>{`Guardar (${saveableCount})`}</span>
                      </button>
                    )
                  })()}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 overflow-auto">
        {/* Contenido según pestaña activa */}
        {isCreatingNew && activeTab === 'import' ? (
          <div className="p-6 flex flex-col h-full">
            <SalesPriceListImport
              onImportComplete={(result) => {
                showNotification(`Importación completada: ${result.successful_imports} exitosos, ${result.failed_imports} fallidos`, 'success')
                // Recargar listas después de importar
                loadSalesPriceLists()
              }}
              priceListName={newListName}
              currency={newListCurrency}
              validFrom={newListValidFrom}
            />
          </div>
        ) : (
          // La tabla siempre debe renderizarse cuando estemos en la pestaña 'manual'
          // independientemente de si hay items o lista seleccionada
          activeTab === 'manual'
        ) && (
          <div className="p-6 flex flex-col h-full gap-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleToggleSelectAll}
                  className="btn-filter"
                  title={selectAll ? 'Deseleccionar todos los items visibles' : 'Seleccionar todos los items visibles'}
                >
                  <CheckCircle className="w-3 h-3 text-green-600" />
                </button>

                <button
                  onClick={deleteSelectedItems}
                  disabled={selectedCount === 0}
                  className={`btn-filter ${selectedCount > 0 ? 'btn-filter-danger-active' : 'opacity-50 cursor-not-allowed'}`}
                  title={selectedCount > 0 ? `Eliminar ${selectedCount} fila(s) seleccionada(s)` : 'Selecciona filas para eliminar'}
                >
                  <Trash2 className="w-3 h-3" />
                </button>

                <button
                  onClick={() => clearTableData()}
                  disabled={totalItems === 0}
                  className={`btn-filter ${totalItems > 0 ? '' : 'opacity-50 cursor-not-allowed'}`}
                  title="Vaciar la tabla (solo limpia esta vista, no borra datos en ERPNext)"
                >
                  <RotateCcw className="w-3 h-3 text-blue-600" />
                </button>

                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <select
                    value={activeFilter}
                    onChange={(e) => handleFilterChange(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-[180px]"
                    title="Filtrar items visibles"
                  >
                    <option value="none">Sin filtro</option>
                    <option value="selected">Solo seleccionados</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs sm:text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span>{`${selectedCount} ${selectedLabel}`}</span>
                </div>
                <span className="text-gray-300">|</span>
                <div className="flex items-center gap-1">
                  <Filter className="w-4 h-4 text-blue-500" />
                  <span>{`${displayedCount} ${visibleLabel}`}</span>
                </div>
                <span className="text-gray-300">|</span>
                <div className="flex items-center gap-1">
                  <Info className="w-4 h-4 text-gray-500" />
                  <span>{`${totalItems} ${totalLabel}`}</span>
                </div>
              </div>
            </div>

            {/* Tabla Handsontable - Aislada en iframe para evitar conflictos de estilos */}
            <div className="flex-1 flex flex-col" style={{ minHeight: '600px' }}>
              <iframe
                ref={iframeRef}
                src="/handsontable-demo.html"
                className="w-full flex-1 border-0"
                title="Tabla Base de Gestión"
                onLoad={handleIframeLoad}
                style={{ minHeight: '600px', height: '100%' }}
              />
            </div>
          </div>
        )}

        {/* Footer con progreso de guardado */}
        {saveProgress && saveProgress.status === 'completed' && (
          <div className="p-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">
                  {(() => {
                    const labelTerm = itemType === 'kits' ? 'kits' : 'items'
                    return `¡Lista guardada exitosamente! ${saveProgress.saved} ${labelTerm} guardados, ${saveProgress.failed} fallidos.`
                  })()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de confirmación de eliminación de lista */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <h3 className="text-lg font-semibold text-gray-900">Confirmar Eliminación</h3>
            </div>
            <p className="text-gray-600 mb-6">
              ¿Estás seguro de que deseas eliminar la lista de precios "{selectedPriceList?.name}"?
              Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeletePriceList}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed"
              >
                {isDeleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación para eliminar artículos de la lista de precios */}
      {showDeleteItemsConfirm && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal-content">
            <div className="confirm-modal-header">
              <div className="confirm-modal-title-section">
                <span className="text-2xl">⚠️</span>
                <h3 className="confirm-modal-title">Confirmar Eliminación de Artículos</h3>
              </div>
              <button onClick={() => setShowDeleteItemsConfirm(false)} className="confirm-modal-close-btn">×</button>
            </div>
            <div className="confirm-modal-body">
              <p className="confirm-modal-message text-red-600 font-semibold mb-3">
                ATENCIÓN: Esta acción no se puede deshacer
              </p>
              <p className="confirm-modal-message mb-2">
                ¿Eliminar definitivamente {selectedRows.size} artículo(s) de la lista de precios "{salesPriceLists.find(list => list.name === selectedPriceList)?.price_list_name || selectedPriceList}"?
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                Los artículos serán eliminados permanentemente de la lista de precios seleccionada.
                Los items en sí no serán afectados, solo se removerán de esta lista específica.
              </p>
            </div>
            <div className="confirm-modal-footer">
              <button onClick={() => setShowDeleteItemsConfirm(false)} className="confirm-modal-btn-cancel">
                Cancelar
              </button>
              <button onClick={executeDeleteSelectedItems} className="confirm-modal-btn-confirm error">
                Eliminar de Lista
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Calculadora */}
      {isCalculatorOpen && (
        <CalculatorModal
          isOpen={isCalculatorOpen}
          onClose={() => setIsCalculatorOpen(false)}
          onApplyFormula={handleApplyFormula}
          onApplyInflation={handleApplyInflationResult}
          getInflationItems={getInflationItems}
          currentItemsCount={countItemsForCalculator()}
          isApplying={isApplyingFormula}
        />
      )}

      {/* Modal de Gestión de Listas */}
      <SalesPriceListManagementModal
        isOpen={isManagementModalOpen}
        onClose={() => setIsManagementModalOpen(false)}
        onListUpdated={() => {
          loadSalesPriceLists() // Recargar listas cuando se actualice alguna
        }}
      />

      {/* Modal de Separador Decimal */}
      <DecimalSeparatorModal
        isOpen={isDecimalModalOpen}
        onClose={handleDecimalModalClose}
        onConfirm={handleDecimalSelection}
        currentSelection={decimalSeparator}
        samples={decimalSamples}
        detectedSeparator={detectedDecimalSeparator}
      />

    </div>
  )
}
function stripCompanySuffix(text) {
  if (!text || typeof text !== 'string') return ''
  const trimmed = text.trim()
  const separatorIndex = trimmed.lastIndexOf(' - ')
  if (separatorIndex === -1) return trimmed
  const suffix = trimmed.slice(separatorIndex + 3).trim()
  if (/^[A-Z0-9. ]{1,6}$/.test(suffix)) {
    return trimmed.slice(0, separatorIndex)
  }
  return trimmed
}
