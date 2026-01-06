import React, { useState, useContext, useEffect, useRef } from 'react'
import { AuthContext } from '../../../AuthProvider'
import { NotificationContext } from '../../../contexts/NotificationContext'
import API_ROUTES from '../../../apiRoutes'
import { fetchSalesKits } from './helpers'
import { Plus, RefreshCw, Save, Calculator, Search, AlertCircle, CheckCircle, Info, DollarSign, X, Trash2, AlertTriangle, Upload, Download, Settings } from 'lucide-react'
import Modal from '../../Modal'
import HandsontableDemo from '../../../handsometable/HandsontableDemo'
import CalculatorModal from '../../modals/CalculatorModal'
import useCurrencies from '../../../hooks/useCurrencies'

export default function SalesPriceListImport() {

  const { showNotification } = useContext(NotificationContext)
  const { fetchWithAuth, activeCompany, isAuthenticated, token } = useContext(AuthContext)
  const { currencies, loading: currenciesLoading } = useCurrencies()

  // Refs
  const iframeRef = useRef(null)

  // Función para quitar las siglas de la empresa
  const stripAbbr = (code) => {
    if (!code) return code
    const idx = code.lastIndexOf(' - ')
    return idx === -1 ? code : code.substring(0, idx)
  }

  // Función para agregar las siglas de la empresa
  const addAbbr = (code) => {
    if (!code) return code
    // Por ahora, devolver el código tal cual.
    // En el futuro, esto debería agregar las siglas de la compañía activa
    return code
  }

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
  const [itemType, setItemType] = useState('items') // 'items' or 'kits'
  const [kitsSet, setKitsSet] = useState(new Set())

  const loadKitsList = async () => {
    try {
      const kits = await fetchSalesKits(fetchWithAuth, activeCompany)
      const s = new Set()
      kits.forEach(k => {
        const code = stripAbbr(k.new_item_code || k.item_code || '')
        if (code) s.add(code)
        if (k.new_item_code) s.add(k.new_item_code)
      })
      setKitsSet(s)
    } catch (e) {
      console.error('Error loading kits list in import:', e)
      setKitsSet(new Set())
    }
  }

  // Estados para nueva lista
  const [newListName, setNewListName] = useState('')
  // No hardcodear moneda por defecto: cargar desde backend
  const [newListCurrency, setNewListCurrency] = useState('')
  const [newListValidFrom, setNewListValidFrom] = useState('')

  // Estados para métodos de creación
  const [creationMethod, setCreationMethod] = useState('manual') // 'manual', 'supplier', 'brand', 'group'
  const [creationMode, setCreationMode] = useState('update') // 'update', 'create'
  const [isUpdateMode, setIsUpdateMode] = useState(true)
  const [savedItemsCount, setSavedItemsCount] = useState(0)

  // Estados para input mode (como en ItemImport)
  const [inputMode, setInputMode] = useState('paste') // 'paste', 'load_all'

  // Estados para la tabla de items
  const [items, setItems] = useState([])
  const [originalItems, setOriginalItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState(null)

  // Estados para gestión de listas existentes
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Estados para edición de listas existentes
  const [editListName, setEditListName] = useState('')
  const [editListCurrency, setEditListCurrency] = useState('')

  // Estados para filtros de columna
  const [columnFilters, setColumnFilters] = useState({})

  // Estados para listas de precios de compra (en lugar de proveedores)
  const [purchasePriceLists, setPurchasePriceLists] = useState([])
  const [selectedPurchaseList, setSelectedPurchaseList] = useState('')
  const [selectedPurchaseListData, setSelectedPurchaseListData] = useState(null)
  const [newListExchangeRate, setNewListExchangeRate] = useState('1.0000')

  // Estados para grupos de clientes
  const [customerGroups, setCustomerGroups] = useState([])
  const [selectedCustomerGroups, setSelectedCustomerGroups] = useState([])

  // Estados para modal de calculadora
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false)
  const calculatorWasOpenRef = React.useRef(false)

  // Cargar datos iniciales al montar el componente
  useEffect(() => {
    console.log('SalesPriceListImport: Loading initial data...')
    loadSalesPriceLists()
    loadPurchasePriceLists()
    loadCustomerGroups()
  }, [])

  // Helper to set itemType and notify parent/iframe so it can return kits when requested
  const setAndNotifyItemType = (t) => {
    try {
      setItemType(t)
      console.log(`SalesPriceListImport: setting itemType -> ${t}`)
      window.postMessage({ type: 'ht-set-mode', itemType: t }, window.location.origin)
    } catch (e) {
      console.debug('Error posting ht-set-mode from import', e)
    }
  }

  useEffect(() => {
    if (itemType === 'kits') loadKitsList()
  }, [itemType, activeCompany])

  // Recargar detalles de lista de compra cuando cambie la selección
  useEffect(() => {
    if (selectedPurchaseList) {
      loadPurchaseListDetails(selectedPurchaseList)
    } else {
      setSelectedPurchaseListData(null)
    }
  }, [selectedPurchaseList])

  // Auto-load SKUs into the table when purchase list details are loaded (manual/create mode)
  useEffect(() => {
    if (creationMode === 'manual' && selectedPurchaseListData) {
      // small defer to let state settle
      const t = setTimeout(() => {
        fetchAndLoadSKUs()
      }, 200)
      return () => clearTimeout(t)
    }
  }, [selectedPurchaseListData, creationMode])

  // Efecto para manejar cambios en el modo de creación
  useEffect(() => {
    if (creationMode === 'update') {
      setIsUpdateMode(true)
      setIsCreatingNew(false)
      setCreationMethod('manual')
      setSelectedPriceList('')
      setCurrentPriceListData(null)
      setItems([])
      setNewListName('')
  setNewListCurrency('')
      setNewListValidFrom('')
      setInputMode('paste') // Resetear a pegar SKUs cuando se cambia a modo update
    } else if (creationMode === 'manual') {
      setIsUpdateMode(false)
      setIsCreatingNew(true)
      setCreationMethod('manual')
      setSelectedPriceList('')
      setCurrentPriceListData(null)
      setItems([])
      setNewListName('')
  setNewListCurrency('')
      setNewListValidFrom('')
      setSelectedPurchaseList('')
      setSelectedPurchaseListData(null)
      setNewListExchangeRate('1.0000')
      setSelectedCustomerGroups([])
      // Cargar listas de precios de compra para el modo Crear Nueva
      loadPurchasePriceLists()
    }

    // Limpiar la tabla del iframe cuando cambie el modo
    try {
      if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'ht-clear-table' }, '*')
      }
    } catch (e) {
      console.debug('Error clearing table on mode change', e)
    }

    // Restaurar el estado de la calculadora si estaba abierta antes del cambio de modo
    try {
      if (creationMode === 'manual' && calculatorWasOpenRef.current) {
        setIsCalculatorOpen(true)
      }
    } catch (e) {
      console.debug('Error restoring calculator open state', e)
    }
  }, [creationMode])

  // Mantener referencia del estado de la calculadora para restaurarlo si es necesario
  useEffect(() => {
    calculatorWasOpenRef.current = isCalculatorOpen
  }, [isCalculatorOpen])

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

  const loadPurchasePriceLists = async () => {
    console.log('loadPurchasePriceLists: Starting...')
    try {
      const response = await fetchWithAuth(API_ROUTES.purchasePriceLists)
      console.log('loadPurchasePriceLists: Response status:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('loadPurchasePriceLists: Data received:', data)
        setPurchasePriceLists(data.data || [])
      } else {
        console.error('loadPurchasePriceLists: Response not ok:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error loading purchase price lists:', error)
      showNotification('Error al cargar listas de precios de compra', 'error')
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

  const loadPurchaseListDetails = async (priceListName) => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListPrices}${encodeURIComponent(priceListName)}/prices?company=${encodeURIComponent(activeCompany || '')}`)
      if (response.ok) {
        const data = await response.json()
        console.log('SalesPriceListImport: loadPurchaseListDetails - Data received:', data)
        console.log('SalesPriceListImport: loadPurchaseListDetails - Prices array:', data.data?.prices)
        setSelectedPurchaseListData(data.data)
      } else {
        console.error('Error loading purchase list details:', response.status, response.statusText)
        setSelectedPurchaseListData(null)
      }
    } catch (error) {
      console.error('Error loading purchase list details:', error)
      setSelectedPurchaseListData(null)
    }
  }

  const loadPriceListDetails = async (priceListName) => {
    try {
      const params = new URLSearchParams()
      params.append('company', activeCompany || '')
      if (itemType === 'kits') params.append('item_type', 'kits')
      const response = await fetchWithAuth(`${API_ROUTES.salesPriceListPrices}${encodeURIComponent(priceListName)}/prices?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        console.log('SalesPriceListImport: loadPriceListDetails - Data received:', data)
        console.log('SalesPriceListImport: loadPriceListDetails - Prices array:', data.data?.prices)
        setCurrentPriceListData(data.data)
        setItems(data.data?.prices || [])
        setOriginalItems(data.data?.prices || [])
      } else {
        console.error('Error loading price list details:', response.status, response.statusText)
        setCurrentPriceListData(null)
        setItems([])
        setOriginalItems([])
      }
    } catch (error) {
      console.error('Error loading price list details:', error)
      setCurrentPriceListData(null)
      setItems([])
      setOriginalItems([])
    }
  }

  const handlePriceListSelection = (priceListName) => {
    setSelectedPriceList(priceListName)
    if (priceListName) {
      loadPriceListDetails(priceListName)
    } else {
      setCurrentPriceListData(null)
      setItems([])
      setOriginalItems([])
    }
  }

  const handleCreateNew = () => {
    setIsCreatingNew(true)
    setCreationMode('manual')
  }

  const calculateFromPurchase = async () => {
    if (!selectedPurchaseList || !selectedPurchaseListData) {
      showNotification('Debes seleccionar una lista de precios de compra', 'error')
      return
    }

    if (!newListName.trim()) {
      showNotification('Debes especificar un nombre para la nueva lista', 'error')
      return
    }

    try {
      // Calcular precios basados en la lista de compra seleccionada
      const calculatedItems = (selectedPurchaseListData.prices || []).map(purchaseItem => {
        const markup = 25 // 25% markup por defecto
        const purchasePrice = parseFloat(purchaseItem.price_list_rate || 0)
        const salesPrice = purchasePrice * (1 + markup / 100)

        return {
          item_code: purchaseItem.item_code,
          item_name: purchaseItem.item_name,
          purchase_price: purchasePrice,
          price_list_rate: salesPrice,
          currency: newListCurrency,
          uom: purchaseItem.uom || 'Unidad'
        }
      })

      setItems(calculatedItems)
      setOriginalItems([...calculatedItems])

      // Enviar datos a la tabla
      try {
        if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'ht-load-data',
            data: calculatedItems
          }, '*')
        }
      } catch (e) {
        console.debug('Error sending data to iframe', e)
      }

      showNotification(`Calculados ${calculatedItems.length} items desde lista de compra`, 'success')
    } catch (error) {
      console.error('Error calculating from purchase list:', error)
      showNotification('Error al calcular precios desde lista de compra', 'error')
    }
  }

  // Helper: cuantos items tienen código y precio válido (para mostrar en el botón Guardar)
  const getSaveableCount = () => {
    const saveableItems = items.filter(item =>
      item.item_code &&
      item.item_code.trim() !== '' &&
      item.price_list_rate &&
      !isNaN(parseFloat(item.price_list_rate)) &&
      parseFloat(item.price_list_rate) > 0
    )
    const count = saveableItems.length
    console.log('getSaveableCount - Total items:', items.length, 'Saveable items:', count, 'Items with item_name:', items.filter(item => item.item_name && item.item_name.trim() !== '').length)
    return count
  }

  // Fetch SKUs and computed prices, but do not overwrite local items state - only send to iframe
  const fetchAndLoadSKUs = async () => {
    if (!selectedPurchaseListData) {
      showNotification('Primero selecciona una lista de precios de compra', 'warning')
      return
    }

    try {
      const skusWithPrices = (selectedPurchaseListData.prices || []).map(purchaseItem => ({
        item_code: purchaseItem.item_code,
        item_name: purchaseItem.item_name,
        purchase_price: parseFloat(purchaseItem.price_list_rate || 0),
        price_list_rate: 0, // Se calculará después
        currency: newListCurrency,
        uom: purchaseItem.uom || 'Unidad'
      }))

      // Enviar datos a la tabla
      try {
        if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'ht-load-data',
            data: skusWithPrices
          }, '*')
        }
      } catch (e) {
        console.debug('Error sending data to iframe', e)
      }

      setItems(skusWithPrices)
      setOriginalItems([...skusWithPrices])

      const labelTerm = itemType === 'kits' ? 'kits' : 'items'
      showNotification(`Cargados ${skusWithPrices.length} ${labelTerm} desde lista de compra`, 'info')
    } catch (error) {
      console.error('Error fetching SKUs:', error)
      showNotification('Error al cargar SKUs desde lista de compra', 'error')
    }
  }

  const addItemsByFilters = async () => {
    // Implementar lógica para agregar items por filtros
    showNotification('Funcionalidad de filtros no implementada aún', 'info')
  }

  const addItemToTable = (item) => {
    const newItem = {
      item_code: item.item_code,
      item_name: item.item_name,
      purchase_price: 0,
      price_list_rate: 0,
      currency: newListCurrency,
      uom: item.stock_uom || 'Unidad'
    }

    setItems(prev => [...prev, newItem])
    setOriginalItems(prev => [...prev, newItem])
  }

  const updateItemCell = (rowId, colKey, value) => {
    setItems(prev => prev.map((item, index) =>
      index === rowId ? { ...item, [colKey]: value } : item
    ))
  }

  const addItemRow = () => {
    const newItem = {
      item_code: '',
      item_name: '',
      purchase_price: 0,
      price_list_rate: 0,
      currency: newListCurrency,
      uom: 'Unidad'
    }

    setItems(prev => [...prev, newItem])
    setOriginalItems(prev => [...prev, newItem])
  }

  const deleteItemRow = (id) => {
    setItems(prev => prev.filter((_, index) => index !== id))
    setOriginalItems(prev => prev.filter((_, index) => index !== id))
  }

  const savePriceList = async () => {
    if (!selectedPriceList && !isCreatingNew) {
      showNotification('Debes seleccionar una lista de precios existente', 'error')
      return
    }

    if (isCreatingNew && !newListName.trim()) {
      showNotification('Debes especificar un nombre para la nueva lista', 'error')
      return
    }

    const saveableItems = items.filter(item =>
      item.item_code &&
      item.item_code.trim() !== '' &&
      item.price_list_rate &&
      !isNaN(parseFloat(item.price_list_rate)) &&
      parseFloat(item.price_list_rate) > 0
    )

    if (saveableItems.length === 0) {
      showNotification('No hay items válidos para guardar', 'warning')
      return
    }

    setSaving(true)

    try {
      const priceListData = {
        price_list_name: isCreatingNew ? newListName : selectedPriceList,
        // Use currency from user selection or existing price list; do NOT apply hardcoded fallback
        currency: isCreatingNew ? newListCurrency : currentPriceListData?.currency,
        valid_from: isCreatingNew ? newListValidFrom : currentPriceListData?.valid_from,
        buying: 0, // Lista de venta
        selling: 1,
        prices: saveableItems.map(item => ({
          item_code: item.item_code,
          price_list_rate: parseFloat(item.price_list_rate),
          currency: item.currency || (isCreatingNew ? newListCurrency : currentPriceListData?.currency),
          uom: item.uom || 'Unidad'
        })),
        customer_groups: selectedCustomerGroups // Agregar grupos de clientes
      }
      if (itemType === 'kits') {
        priceListData.item_type = 'kits'
      }

      console.log('Saving price list:', priceListData)

      const response = await fetchWithAuth(
        isCreatingNew ? API_ROUTES.salesPriceLists : `${API_ROUTES.salesPriceLists}/${encodeURIComponent(selectedPriceList)}`,
        {
          method: isCreatingNew ? 'POST' : 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(priceListData)
        }
      )

      if (response.ok) {
        const result = await response.json()
        console.log('Price list saved successfully:', result)

        const labelTerm = itemType === 'kits' ? 'kits' : 'items'
        showNotification(
          isCreatingNew
            ? `Lista de precios "${newListName}" creada exitosamente (${saveableItems.length} ${labelTerm}). Tabla vaciada.`
            : `Lista de precios "${selectedPriceList}" actualizada exitosamente (${saveableItems.length} ${labelTerm}). Tabla vaciada.`,
          'success'
        )

        // Recargar listas
        loadSalesPriceLists()

        // Vaciar la tabla después de importación exitosa (tanto crear como actualizar)
        setItems([])
        setOriginalItems([])
        
        // Enviar mensaje al iframe para limpiar la tabla
        try {
          if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage({ type: 'ht-clear-table' }, '*')
          }
        } catch (e) {
          console.debug('Error clearing table after save', e)
        }

        // Si era creación nueva, resetear campos adicionales
        if (isCreatingNew) {
          setIsCreatingNew(false)
          setNewListName('')
          setNewListCurrency('')
          setNewListValidFrom('')
          setSelectedCustomerGroups([])
        }
      } else {
        const errorData = await response.json()
        console.error('Error saving price list:', errorData)
        showNotification(errorData.message || 'Error al guardar la lista de precios', 'error')
      }
    } catch (error) {
      console.error('Error saving price list:', error)
      showNotification('Error al guardar la lista de precios', 'error')
    } finally {
      setSaving(false)
    }
  }

  const getFilteredRows = () => {
    // Implementar lógica de filtros
    return items
  }

  // Habilita la calculadora si al menos una fila tiene precio actual o precio de compra
  const canOpenCalculator = () => {
    if (!items || items.length === 0) return false
    return items.some(it => {
      const purchase = it.purchase_price !== undefined && it.purchase_price !== null && it.purchase_price !== '' && !isNaN(parseFloat(it.purchase_price)) && parseFloat(it.purchase_price) > 0
      const existing = it.price_list_rate !== undefined && it.price_list_rate !== null && it.price_list_rate !== '' && !isNaN(parseFloat(it.price_list_rate)) && parseFloat(it.price_list_rate) > 0
      const existing_price_field = it.existing_price !== undefined && it.existing_price !== null && it.existing_price !== '' && !isNaN(parseFloat(it.existing_price)) && parseFloat(it.existing_price) > 0
      return purchase || existing || existing_price_field
    })
  }

  const countItemsForCalculator = () => {
    if (!items || items.length === 0) return 0
    return items.reduce((acc, it) => {
      const purchase = it.purchase_price !== undefined && it.purchase_price !== null && it.purchase_price !== '' && !isNaN(parseFloat(it.purchase_price)) && parseFloat(it.purchase_price) > 0
      const existing = it.price_list_rate !== undefined && it.price_list_rate !== null && it.price_list_rate !== '' && !isNaN(parseFloat(it.price_list_rate)) && parseFloat(it.price_list_rate) > 0
      const existing_price_field = it.existing_price !== undefined && it.existing_price !== null && it.existing_price !== '' && !isNaN(parseFloat(it.existing_price)) && parseFloat(it.existing_price) > 0
      return acc + (purchase || existing || existing_price_field ? 1 : 0)
    }, 0)
  }

  const handleDeletePriceList = async () => {
    if (!selectedPriceList) return

    setIsDeleting(true)
    try {
      const response = await fetchWithAuth(`${API_ROUTES.salesPriceLists}/${encodeURIComponent(selectedPriceList)}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        showNotification(`Lista de precios "${selectedPriceList}" eliminada exitosamente`, 'success')
        setSelectedPriceList('')
        setCurrentPriceListData(null)
        setItems([])
        setOriginalItems([])
        loadSalesPriceLists()
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al eliminar la lista de precios', 'error')
      }
    } catch (error) {
      console.error('Error deleting price list:', error)
      showNotification('Error al eliminar la lista de precios', 'error')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const applyBulkUpdate = () => {
    // Implementar lógica de actualización masiva
    showNotification('Funcionalidad de actualización masiva no implementada aún', 'info')
  }

  const getChangedItems = () => {
    return items.filter((item, index) => {
      const original = originalItems[index]
      return !original ||
             item.item_code !== original.item_code ||
             item.price_list_rate !== original.price_list_rate ||
             item.currency !== original.currency
    })
  }

  // Función para aplicar fórmula de calculadora
  const handleApplyFormula = (formula) => {
    try {
      if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'ht-apply-formula',
          formula: formula
        }, '*')
      }
    } catch (e) {
      console.debug('Error applying formula', e)
    }
  }

  // useEffect para manejar mensajes del iframe
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return

      const { type, data } = event.data

      switch (type) {
        case 'ht-data-changed':
          if (data && Array.isArray(data)) {
            if (inputMode === 'paste' && itemType === 'kits') {
              const discarded = []
              const filtered = data.filter(d => {
                const code = stripAbbr((d.item_code || '').toString())
                if (!code || !kitsSet.has(code)) {
                  if (d.item_code) discarded.push(d.item_code)
                  return false
                }
                return true
              })
              if (discarded.length > 0) {
                const unique = [...new Set(discarded)].slice(0, 20)
                showNotification(`Se descartaron ${discarded.length} códigos no pertenecientes a kits: ${unique.join(', ')}${discarded.length > unique.length ? ', ...' : ''}`, 'warning')
              }
              setItems(filtered)
            } else {
              setItems(data)
            }
          }
          break
        case 'ht-cell-changed':
          if (data && data.row !== undefined && data.col !== undefined && data.value !== undefined) {
            updateItemCell(data.row, data.col, data.value)
          }
          break
        case 'ht-add-row':
          addItemRow()
          break
        case 'ht-delete-row':
          if (data && data.row !== undefined) {
            deleteItemRow(data.row)
          }
          break
        default:
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [activeCompany])

  // useEffect para inicializar la tabla cuando el componente se monta
  useEffect(() => {
    const initializeTable = () => {
      try {
        if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
          const config = {
            columns: [
              { data: 'item_code', title: 'Código Item', type: 'text', width: 120 },
              { data: 'item_name', title: 'Nombre Item', type: 'text', width: 200 },
              { data: 'purchase_price', title: '$ Compra', type: 'numeric', width: 100, readOnly: true },
              { data: 'price_list_rate', title: 'Precio Venta', type: 'numeric', width: 120 },
              { data: 'currency', title: 'Moneda', type: 'text', width: 80 },
              { data: 'uom', title: 'UM', type: 'text', width: 60 }
            ],
            data: items,
            allowAddRow: true,
            allowDeleteRow: true,
            showContextMenu: true
          }

          iframeRef.current.contentWindow.postMessage({
            type: 'ht-initialize',
            config: config
          }, '*')
        }
      } catch (e) {
        console.debug('Error initializing table', e)
      }
    }

    // Pequeño delay para asegurar que el iframe esté listo
    const timer = setTimeout(initializeTable, 1000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <DollarSign className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Importar Lista de Precios de Venta</h1>
                <p className="text-sm text-gray-600">Crear o actualizar listas de precios basadas en listas de compra</p>
              </div>
            </div>

            {/* Controles principales */}
            <div className="flex items-center gap-3">
              {/* Modo: Actualizar Existente vs Crear Nueva */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Modo:</label>
                <select
                  value={creationMode}
                  onChange={(e) => setCreationMode(e.target.value)}
                  className="form-select bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                >
                  <option value="update">Actualizar Existente</option>
                  <option value="manual">Crear Nueva</option>
                </select>
              </div>

              {/* Item Type: Items vs Kits */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Tipo:</label>
                <div className="flex gap-2 bg-gray-100 p-1 rounded-lg h-9">
                  <button
                    className={`btn-mode-selector ${itemType === 'items' ? 'active' : ''}`}
                    onClick={() => setAndNotifyItemType('items')}
                  >
                    Items
                  </button>
                  <button
                    className={`btn-mode-selector ${itemType === 'kits' ? 'active' : ''}`}
                    onClick={() => setAndNotifyItemType('kits')}
                  >
                    Kits
                  </button>
                </div>
              </div>

              {/* Botones de acción */}
              {creationMode === 'update' ? (
                /* Controles para Actualizar Existente */
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600">Cargar como:</label>
                    <button
                      className={`btn-mode-selector ${inputMode === 'paste' ? 'active' : ''}`}
                      onClick={() => setInputMode('paste')}
                    >
                      Pegar SKUs
                    </button>
                    <button
                      className={`btn-mode-selector ${inputMode === 'csv' ? 'active' : ''}`}
                      onClick={() => setInputMode('csv')}
                    >
                      Subir CSV
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600">Tipo:</label>
                    <button
                      className={`btn-mode-selector ${itemType === 'items' ? 'active' : ''}`}
                      onClick={() => setAndNotifyItemType('items')}
                    >
                      Items
                    </button>
                    <button
                      className={`btn-mode-selector ${itemType === 'kits' ? 'active' : ''}`}
                      onClick={() => setAndNotifyItemType('kits')}
                    >
                      Kits
                    </button>
                  </div>
                    {/* Botón Editar Nombre */}
                  <button
                    className="flex items-center gap-2 h-9 px-3 bg-gray-100 text-gray-700 font-semibold rounded-lg shadow-sm hover:bg-gray-200 transition-all"
                    title="Editar nombre de lista"
                    onClick={() => {/* Implementar edición de nombre */}}
                  >
                    <Settings className="w-4 h-4" />
                  </button>

                  {/* Botón Eliminar */}
                  <button
                    className="flex items-center gap-2 h-9 px-3 bg-red-100 text-red-700 font-semibold rounded-lg shadow-sm hover:bg-red-200 transition-all"
                    title="Eliminar lista"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={!selectedPriceList}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  {/* Botón Guardar */}
                  <button
                    className="flex items-center gap-2 h-9 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all disabled:bg-gray-400"
                    title="Guardar Cambios"
                    onClick={savePriceList}
                    disabled={getSaveableCount() === 0 || saving || !selectedPriceList}
                  >
                    <Save className="w-4 h-4" />
                    <span>{saving ? 'Guardando...' : `Guardar (${getSaveableCount()})`}</span>
                  </button>
                  {/* Botón Calculadora (también disponible en modo Actualizar) */}
                  <button
                    className={`flex items-center gap-2 h-9 px-3 ml-1 rounded-lg shadow-sm transition-all ${canOpenCalculator() ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                    title={canOpenCalculator() ? 'Abrir calculadora' : 'Necesitas al menos un precio para usar la calculadora'}
                    onClick={() => setIsCalculatorOpen(true)}
                    disabled={!canOpenCalculator()}
                  >
                    <Calculator className="w-4 h-4" />
                  </button>
                </div>
              ) : creationMode === 'manual' ? (
                /* Controles para Crear Nueva */
                <div className="flex items-end gap-3">
                  {/* Selector de lista de precios de compra */}
                  {itemType !== 'kits' && (
                    <div>
                      <label htmlFor="purchase-list-select" className="block text-xs font-medium text-gray-600 mb-1">Lista Precios Compra</label>
                      <select
                        id="purchase-list-select"
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
                  <div>
                    <label htmlFor="new-list-name" className="block text-xs font-medium text-gray-600 mb-1">Nombre Lista</label>
                    <input
                      type="text"
                      id="new-list-name"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="Nombre de la lista"
                      className="form-input w-full sm:w-40 bg-white border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                    />
                  </div>

                  {/* Moneda */}
                  <div>
                    <label htmlFor="new-list-currency" className="block text-xs font-medium text-gray-600 mb-1">Moneda</label>
                      <select
                        id="new-list-currency"
                        value={newListCurrency || ''}
                        onChange={(e) => setNewListCurrency(e.target.value)}
                        className="form-select w-full sm:w-20 bg-gray-50 border-gray-300 rounded-lg shadow-sm text-sm py-2 px-3 h-9"
                      >
                        <option value="">Seleccionar moneda...</option>
                        {currenciesLoading ? (
                          <option value="" disabled>Cargando monedas...</option>
                        ) : (
                          currencies.map(c => (
                            <option key={c.name} value={c.name}>{`${c.name} - ${c.currency_name || c.name}`}</option>
                          ))
                        )}
                      </select>
                  </div>

                  {/* Grupos de clientes */}
                  <div>
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

                  {/* Items se cargan automáticamente al seleccionar una lista de compra */}

                  {/* Botón Calculadora */}
                  <button
                    className={`flex items-center gap-2 h-9 px-3 ${canOpenCalculator() ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-400 cursor-not-allowed'} font-semibold rounded-lg shadow-sm transition-all`}
                    title={canOpenCalculator() ? 'Abrir calculadora' : 'Necesitas al menos un precio para usar la calculadora'}
                    onClick={() => setIsCalculatorOpen(true)}
                    disabled={!canOpenCalculator()}
                  >
                    <Calculator className="w-4 h-4" />
                  </button>

                  {/* Botón Guardar */}
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
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 flex flex-col h-full">
          {/* Tabla Handsontable - Aislada en iframe para evitar conflictos de estilos */}
          <div className="flex-1 flex flex-col" style={{ minHeight: '600px' }}>
            <iframe
              ref={iframeRef}
              src="/handsontable-demo.html"
              className="w-full flex-1 border-0"
              title="Tabla Base de Gestión"
              style={{ minHeight: '600px', height: '100%' }}
            />
          </div>
        </div>

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

      {/* Modal de confirmación de eliminación */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Confirmar Eliminación"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-amber-600">
            <AlertTriangle className="w-6 h-6" />
            <span className="font-medium">¿Estás seguro de que deseas eliminar esta lista de precios?</span>
          </div>
          <p className="text-gray-600">
            Esta acción no se puede deshacer. Se eliminarán todos los precios asociados a la lista "{selectedPriceList}".
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleDeletePriceList}
              disabled={isDeleting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400"
            >
              {isDeleting ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal de Calculadora */}
      <CalculatorModal
        isOpen={isCalculatorOpen}
        onClose={() => setIsCalculatorOpen(false)}
        onApplyFormula={handleApplyFormula}
        currentItemsCount={countItemsForCalculator()}
      />

    </div>
  )
}
