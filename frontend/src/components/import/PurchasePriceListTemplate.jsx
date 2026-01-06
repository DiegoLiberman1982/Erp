import React, { useState, useContext, useEffect, useRef, useMemo, useCallback } from 'react'
import { AuthContext } from '../../AuthProvider'
import { NotificationContext } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import PurchasePriceListLayout from './Purchaselist/components/PurchasePriceListLayout'
import DecimalSeparatorModal from './Purchaselist/components/DecimalSeparatorModal'
import { getDuplicateCodes } from './ItemImport/itemImportHelpers'
import {
  countSaveableItems as _countSaveableItems,
  computeVisibleItems,
  buildFilterChangeAction,
  toggleSelectAllSet,
  resetSelectionState as resetSelectionHelper
} from '../../handsometable/utils/tableFilters'
import {
  addAbbr,
  normalizePriceInput,
  stripAbbr,
  toNumberValue
} from './Purchaselist/utils/purchasePriceListHelpers'
import usePurchasePriceListIframeBridge from './Purchaselist/hooks/usePurchasePriceListIframeBridge'

const PRICE_CHANGE_THRESHOLD = 0.01

export default function PurchasePriceListTemplate() {

  const { showNotification } = useContext(NotificationContext)
  const { fetchWithAuth, activeCompany, isAuthenticated } = useContext(AuthContext)

  // Refs
  const iframeRef = useRef(null)
  const fetchWithAuthRef = useRef(fetchWithAuth)
  useEffect(() => {
    fetchWithAuthRef.current = fetchWithAuth
  }, [fetchWithAuth])

  const [items, setItems] = useState([])
  const [originalItems, setOriginalItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState(null)

  const duplicateRemovalOptions = useMemo(() => ([
    { value: 'keep-highest-price', label: 'Conservar precio más alto' },
    { value: 'keep-lowest-price', label: 'Conservar precio más bajo' },
    { value: 'keep-first', label: 'Conservar 1ª aparición' },
    { value: 'keep-second', label: 'Conservar 2ª aparición' },
    { value: 'keep-third', label: 'Conservar 3ª aparición' }
  ]), [])

  const [duplicateRemovalStrategy, setDuplicateRemovalStrategy] = useState('keep-highest-price')

  const duplicateCodes = useMemo(() => getDuplicateCodes(items), [items])
  const hasAnyDuplicates = duplicateCodes.length > 0

  // Función para ir al primer duplicado
  const findAndFocusFirstDuplicate = () => {
    const duplicates = duplicateCodes
    let target = null

    // Buscar el primer duplicado
    if (duplicates && duplicates.length > 0) {
      const code = duplicates[0]
      const rowIndex = items.findIndex(row => row.item_code === code)
      if (rowIndex !== -1) {
        target = { row: rowIndex, colKey: 'item_code', msg: `Duplicado: código ${code}` }
      }
    }

    const iframeWindow = iframeRef?.current?.contentWindow

    if (!target) {
      if (iframeWindow) {
        iframeWindow.postMessage({ type: 'ht-clear-focus' }, '*')
      }
      showNotification('No se encontraron SKUs duplicados', 'info')
      return
    }

    // Enviar mensaje al iframe para enfocar la celda
    if (iframeWindow) {
      iframeWindow.postMessage({
        type: 'ht-focus-cell',
        rowIndex: target.row,
        colIndex: 1, // columna de item_code (selected=0, item_code=1)
        message: target.msg
      }, '*')
    }
  }

  // Si no está autenticado, mostrar mensaje
  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30">
        <div className="text-center text-gray-500">
          <div className="text-lg font-semibold mb-2">Autenticación requerida</div>
          <p>Debes iniciar sesión para acceder a la gestión de precios de compra.</p>
        </div>
      </div>
    )
  }

  // Estados principales
  const [purchasePriceLists, setPurchasePriceLists] = useState([])
  const [selectedPriceList, setSelectedPriceList] = useState('')
  const [currentPriceListData, setCurrentPriceListData] = useState(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const lastSelectedPriceListRef = useRef('')
  const lastCreationModeRef = useRef(null)

  // Estado para detalles de la empresa activa (para obtener moneda por defecto)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const companyCurrency = (activeCompanyDetails?.default_currency || '').toString().trim()

  // Estados para nueva lista
  const [newListName, setNewListName] = useState('')
  const [newListCurrency, setNewListCurrency] = useState(companyCurrency || '')
  const [newListValidFrom, setNewListValidFrom] = useState('')

  // Estados para métodos de creación
  const [creationMethod, setCreationMethod] = useState('manual') // 'manual', 'supplier', 'brand', 'group'
  const [creationMode, setCreationMode] = useState('update') // 'update', 'create'
  const [isUpdateMode, setIsUpdateMode] = useState(true)
  const [savedItemsCount, setSavedItemsCount] = useState(0)

  // Estados para input mode (como en ItemImport)
  // Por defecto venir en modo 'paste' (Pegar SKUs) para que la tabla quede vacía
  // hasta que el usuario presione "Cargar Datos".
  const [inputMode, setInputMode] = useState('paste') // 'paste', 'load_all'

  // Estados para gestión de listas existentes
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Estados para edición de listas existentes
  const [editListName, setEditListName] = useState('')
  const [editListCurrency, setEditListCurrency] = useState(companyCurrency || '')

  // Estados para filtros de columna
  const [columnFilters, setColumnFilters] = useState({})

  // Estados para proveedores (para modo Crear Nueva)
  const [suppliers, setSuppliers] = useState([])
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [newListExchangeRate, setNewListExchangeRate] = useState('1.0000')
  // Nuevo: modo de cotización ('specific' = cotización específica, 'general' = usa tasa global)
  const [newListExchangeMode, setNewListExchangeMode] = useState('specific')

  // Estados para "Actualizar Existentes"
  const [priceListCurrency, setPriceListCurrency] = useState(companyCurrency || '')
  const [priceListExchangeRate, setPriceListExchangeRate] = useState('1')
  // Nuevo: modo de cotización ('specific' = cotización específica, 'general' = usa tasa global)
  const [priceListExchangeMode, setPriceListExchangeMode] = useState('specific')
  const [globalExchangeRate, setGlobalExchangeRate] = useState('1')

  // Estados para modal de calculadora
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false)

  // Estados para modal de gestión de listas
  const [isManagementModalOpen, setIsManagementModalOpen] = useState(false)

  // Estados para selección de filas (como en SalesPriceListManager)
  const [selectedRows, setSelectedRows] = useState(() => new Set())
  const [selectAll, setSelectAll] = useState(false)
  const [activeFilter, setActiveFilter] = useState('none')
  const [visibleRowIds, setVisibleRowIds] = useState(null) // null = no filter active, array = filtered row IDs
  const [filteredRowCount, setFilteredRowCount] = useState(null)

  // Estado para loading de exchange rate
  const [isLoadingExchangeRate, setIsLoadingExchangeRate] = useState(false)

  // Overlay para cargas pesadas (pegar SKUs y recuperar precios previos)
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [loadingItemsMessage, setLoadingItemsMessage] = useState('Buscando SKUs y precios anteriores...')

  // Estado para preferencia de separador decimal en precios pegados
  const [decimalSeparator, setDecimalSeparator] = useState('auto')
  const [isDecimalModalOpen, setIsDecimalModalOpen] = useState(false)
  const [decimalSamples, setDecimalSamples] = useState([])
  const [detectedDecimalSeparator, setDetectedDecimalSeparator] = useState(null)

  const beginItemsLoading = useCallback((message) => {
    setLoadingItemsMessage(message || 'Buscando SKUs y precios anteriores...')
    setIsLoadingItems(true)
  }, [])

  const endItemsLoading = useCallback(() => {
    setIsLoadingItems(false)
    setLoadingItemsMessage('Buscando SKUs y precios anteriores...')
  }, [])

  const cancelInFlightRef = useRef(() => {})

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

  const handleManualDecimalModal = useCallback(() => {
    openDecimalModal([], null)
  }, [openDecimalModal])

  const handleDecimalSelection = useCallback((selection) => {
    setDecimalSeparator(selection || 'auto')
    const label = selection === 'comma'
      ? 'formato con coma decimal'
      : selection === 'dot'
        ? 'formato con punto decimal'
        : 'deteccion automatica'
    showNotification(`Formato decimal configurado en ${label}`, 'success')
  }, [showNotification])

  const handleDecimalPromptFromPaste = useCallback((payload = {}) => {
    if (decimalSeparator !== 'auto') return
    openDecimalModal(payload.samples || [], payload.suspected || null)
  }, [decimalSeparator, openDecimalModal])

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
    console.log('PurchasePriceListTemplate: Loading initial data...')
    loadPurchasePriceLists()
  }, [])

  // Cargar listas de precios existentes cuando se selecciona un proveedor en modo update
  useEffect(() => {
    if (isUpdateMode && activeCompany) {
      fetchExistingPriceLists()
    }
  }, [isUpdateMode, activeCompany])

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

  const fetchExistingPriceLists = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.purchasePriceLists)
      if (response.ok) {
        const data = await response.json()
        setPurchasePriceLists(data.data || [])
      }
    } catch (error) {
      console.error('Error loading existing price lists:', error)
    }
  }

  // Si estamos en modo 'update' y hay listas cargadas, auto-seleccionar la primera.
  // IMPORTANTE: no cargar los items automáticamente si estamos en modo 'paste'.
  useEffect(() => {
    if (creationMode === 'update' && purchasePriceLists && purchasePriceLists.length > 0 && !selectedPriceList) {
      const first = purchasePriceLists[0]
      if (first && first.name) {
        setSelectedPriceList(first.name)

        // If the fetched price-list contains currency/exchange information, use it
        if (first.currency) {
          setPriceListCurrency(first.currency)
        } else {
          setPriceListCurrency(companyCurrency || '')
        }

        const er = first.custom_exchange_rate ?? first.exchange_rate ?? null
        if (er !== null && typeof er !== 'undefined') {
          // Interpret sentinel -1 as 'use global rate' (general)
          if (Number(er) === -1) {
            setPriceListExchangeMode('general')
            // clear visible rate so the shared effect will fetch the global rate
            setPriceListExchangeRate('')
          } else {
            setPriceListExchangeMode('specific')
            setPriceListExchangeRate(String(er))
          }
        } else {
          setPriceListExchangeMode('specific')
          setPriceListExchangeRate('1')
        }

        // Cargar detalles sólo si estamos en modo 'load_all'
        if (inputMode === 'load_all') {
          loadPriceListDetails(first.name)
        } else {
          // En modo pegar, asegurarnos que la UI quede limpia para pegar
          setCurrentPriceListData(null)
          itemsRef.current = []
          setItems([])
        }
      }
    }
  }, [purchasePriceLists, creationMode, inputMode, selectedPriceList])

  const loadSuppliers = async () => {
    try {
      const response = await fetchWithAuth('/api/suppliers/names')
      if (response.ok) {
        const data = await response.json()
        // Procesar proveedores como en SupplierPanel
        const suppliersData = (data.suppliers || []).map(supplier => ({
          ...supplier,
          outstanding_amount: 0
        }))
        setSuppliers(suppliersData)
      }
    } catch (error) {
      console.error('Error loading suppliers:', error)
    }
  }

  const loadPriceListDetails = async (priceListName) => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListPrices}${encodeURIComponent(priceListName)}/prices?company=${encodeURIComponent(activeCompany || '')}`)
      if (response.ok) {
        const data = await response.json()
        const pricesData = data.data?.prices || []
        const pricesCount = Array.isArray(pricesData) ? pricesData.length : 0


        // The response structure is { success: true, data: { price_list: {...}, prices: [...] } }
        const priceListData = data.data?.price_list || {}

        setCurrentPriceListData({
          price_list: priceListData,
          prices: pricesData
        })

        // Inicializar valores editables
        setEditListName(priceListData.price_list_name || '')
        setEditListCurrency(priceListData.currency)
        // Actualizar moneda y cotización visibles en el modo Actualizar
        if (priceListData.currency) {
          setPriceListCurrency(priceListData.currency)
        }

        const exchangeRateValue =
          priceListData.custom_exchange_rate !== undefined && priceListData.custom_exchange_rate !== null
            ? priceListData.custom_exchange_rate
            : (priceListData.exchange_rate !== undefined && priceListData.exchange_rate !== null
                ? priceListData.exchange_rate
                : null)

        if (exchangeRateValue !== null) {
          console.log('PurchasePriceListTemplate: loadPriceListDetails - exchange rate:', exchangeRateValue)
          // Si el valor es -1 se interpreta como 'usar tasa global'
          if (Number(exchangeRateValue) === -1) {
            // Sentinel -1 = use global rate
            setPriceListExchangeMode('general')
            // Clear visible rate so the shared effect (which uses authenticated fetch)
            // will retrieve and populate the global exchange rate.
            setGlobalExchangeRate('')
            setPriceListExchangeRate('')
          } else {
            setPriceListExchangeMode('specific')
            setPriceListExchangeRate(exchangeRateValue.toString())
          }
        } else {
          setPriceListExchangeRate('1')
        }

        // Convertir los precios a formato de tabla
        const tableItems = pricesData.map((price, index) => ({
          id: index + 1,
          item_code: stripAbbr(price.item_code),
          item_name: price.item_name,
          item_group: price.item_group || '',
          brand: price.brand || '',
          price: toNumberValue(price.price_list_rate),
          original_price: toNumberValue(price.price_list_rate), // Guardar precio original
          erp_item_code: price.item_code, // Guardar el código completo con abbr
          errors: {}
        }))


    itemsRef.current = tableItems
    setItems(tableItems)
        setOriginalItems(tableItems.map(item => ({ ...item }))) // Copia profunda para comparación

        // Send to iframe to load data
        try {
            if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
              const payload = tableItems.map(it => ({ 
                selected: false, // Inicialmente ninguna fila seleccionada
                item_code: it.item_code, 
                existing_price: toNumberValue(it.price), 
                new_price: toNumberValue(0), 
                item_group: it.item_group, 
                brand: it.brand,
                item_name: it.item_name
              }))

              iframeRef.current.contentWindow.postMessage({
                type: 'ht-load-items',
                items: payload,
                rowIds: tableItems.map(it => it.id)
              }, '*')
            }
        } catch (e) {
          console.debug('Error posting items to iframe', e)
        }
      }
    } catch (error) {
      console.error('Error loading price list details:', error)
      showNotification('Error al cargar detalles de la lista de precios', 'error')
    }
  }

  const handlePriceListSelection = async (priceListName) => {
    cancelInFlightRef.current()
    const isNewSelection = priceListName !== lastSelectedPriceListRef.current

    // Siempre limpiar si es una selección nueva; evita quedarse con residuos de listas anteriores.
    if (isNewSelection) {
      clearTableData({ silent: true })
    }

    setSelectedPriceList(priceListName)
    lastSelectedPriceListRef.current = priceListName
    setIsCreatingNew(false)

    // If we have the full list data locally (from purchasePriceLists), set currency/exchange immediately
    try {
      const found = purchasePriceLists.find(p => p && p.name === priceListName)
      if (found) {
        if (found.currency) setPriceListCurrency(found.currency)

        const er = found.custom_exchange_rate ?? found.exchange_rate ?? null
        if (er !== null && typeof er !== 'undefined') {
          if (Number(er) === -1) {
            setPriceListExchangeMode('general')
            setPriceListExchangeRate('')
          } else {
            setPriceListExchangeMode('specific')
            setPriceListExchangeRate(String(er))
          }
        } else {
          setPriceListExchangeMode('specific')
          setPriceListExchangeRate('1')
        }
      }
    } catch (e) {
      // ignore
    }

    if (priceListName) {
      // Si estamos en modo 'load_all', cargamos detalles y items.
      // Si estamos en modo 'paste', no cargar items — dejar la tabla libre para pegar.
      if (inputMode === 'load_all') {
        await loadPriceListDetails(priceListName)
        // Esperar un poco para que el iframe se limpie antes de cargar
        setTimeout(() => {
          loadPriceListItems(priceListName)
        }, 100)
      } else {
        // No cargamos items en modo 'paste' pero no debemos sobrescribir
        // la moneda/cotización que vinieron con la lista seleccionada.
        setCurrentPriceListData(null)
        // Tabla queda vacía para pegado
        itemsRef.current = []
        setItems([])
      }
    } else {
      setCurrentPriceListData(null)
      setPriceListCurrency(companyCurrency || '')
      setPriceListExchangeRate('1')
    }
  }

  const handleCreateNew = () => {
    setIsCreatingNew(true)
    setSelectedPriceList('')
    setCurrentPriceListData(null)
    itemsRef.current = []
    setItems([])
    setEditListName('')
    setEditListCurrency(companyCurrency || '')
  }

  const handleSavePriceList = async () => {
    // Validaciones para modo Crear Nueva
    if (!newListName.trim()) {
      showNotification('El nombre de la lista de precios es requerido', 'error')
      return
    }

    if (!selectedSupplier) {
      showNotification('Debes seleccionar un proveedor', 'error')
      return
    }

    try {
      showNotification('Guardando lista de precios...', 'info')

      // Enviar sólo los items que el botón "Guardar" ya cuenta como válidos
      // (tienen item_name, price > 0 y sin errores)
      const validItems = saveableItems
      debugSaveEvaluation('create-mode candidates (primeros 5)', itemsScopedForSave)
      debugSaveEvaluation('create-mode saveables (primeros 5)', validItems)

      if (validItems.length === 0) {
        showNotification('No hay items válidos para guardar', 'warning')
        return
      }

      // Validar cotización si está en modo específico
      if (newListExchangeMode === 'specific') {
        const parsed = parseFloat(newListExchangeRate)
        if (isNaN(parsed) || parsed < 0) {
          showNotification('La cotización debe ser un número mayor o igual a 0', 'error')
          return
        }
      }

      const payload = {
        mode: 'insert', // Crear nueva lista
        supplier: selectedSupplier,
        price_list_description: newListName,
        currency: newListCurrency,
        exchange_rate: newListExchangeMode === 'general' ? -1 : newListExchangeRate,
        custom_exchange_rate: newListExchangeMode === 'general' ? -1 : newListExchangeRate,
        items: validItems.map(item => ({
          item_code: item.item_code,
          item_name: item.item_name, // REQUERIDO por backend
          price: item.price,
          supplier: selectedSupplier,
          company: activeCompany
        }))
      }

      const response = await fetchWithAuth(`${API_ROUTES.inventory}/purchase-price-lists/bulk-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const result = await response.json()
        const processId = result.process_id
        
        // Poll for progress
        pollImportProgress(processId, 'create')
      } else {
        const error = await response.json()
        showNotification(`Error al crear lista de precios: ${error.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error saving price list:', error)
      showNotification('Error al crear la lista de precios', 'error')
    }
  }

  const handleCancelEdit = () => {
    if (isCreatingNew) {
      setIsCreatingNew(false)
      setSelectedPriceList('')
      itemsRef.current = []
      setItems([])
    } else {
      // Restaurar valores originales
      setEditListName(currentPriceListData?.price_list?.price_list_name || '')
      setEditListCurrency(currentPriceListData?.price_list?.currency || companyCurrency || '')
      const restoredItems = [...originalItems]
      itemsRef.current = restoredItems
      setItems(restoredItems)
    }
  }

  const handlePasteSkus = () => {
    cancelInFlightRef.current()
    // Mantener la lista existente seleccionada; solo limpiamos la tabla.
    setInputMode('paste')
    clearTableData({ silent: true })
  }

  const handleLoadData = () => {
    cancelInFlightRef.current()
    clearTableData({ silent: true })
    setInputMode('load_all')
    beginItemsLoading('Buscando SKUs y precios anteriores...')
    
    // Solo cargar items si hay una lista de precios seleccionada
    if (selectedPriceList) {
      loadPriceListItems()
    } else {
      showNotification('Selecciona una lista de precios primero', 'warning')
      endItemsLoading()
    }
  }

  const loadPriceListItems = async (priceListName) => {
    const listToLoad = priceListName || selectedPriceList
    
    if (!listToLoad) {
      showNotification('Debes seleccionar una lista de precios primero', 'warning')
      endItemsLoading()
      return
    }

    try {
      showNotification('Cargando items de la lista de precios...', 'info')
      beginItemsLoading('Buscando SKUs y precios anteriores...')

      // Usar el endpoint específico que incluye deduplicación por fecha más reciente
      const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListPrices}${encodeURIComponent(listToLoad)}/prices?company=${encodeURIComponent(activeCompany || '')}`)

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data && data.data.prices && data.data.prices.length > 0) {
          setLoadingItemsMessage('Preparando tabla con los resultados...')
          // Convertir los items a formato de tabla
          const tableItems = data.data.prices.map((item, index) => ({
            id: index + 1,
            item_code: stripAbbr(item.item_code || ''),
            item_name: item.item_name || '',
            item_group: '', // No viene en Item Price, se obtendrá después
            brand: item.brand || '',
            price: 0, // Nuevo precio: siempre inicializar en 0 (será calculado/ingresado por usuario)
            existing_price: toNumberValue(item.price_list_rate || 0), // Guardar precio existente de la lista (numeric)
            erp_item_code: item.item_code, // Guardar el código completo con abbr
            item_price_name: item.name, // Guardar el identificador del Item Price existente
            errors: {},
            raw_new_price: '',
            raw_price_input: ''
          }))

          itemsRef.current = tableItems
          setItems(tableItems)
          showNotification(`Cargados ${tableItems.length} items de la lista de precios`, 'success')

          // Send to iframe to load data
          try {
              if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
                const payload = tableItems.map(it => ({ 
                  selected: false, // Inicialmente ninguna fila seleccionada
                  item_code: it.item_code, 
                  existing_price: toNumberValue(it.existing_price), // Precio actual (numeric)
                  new_price: toNumberValue(''), // Mantener numérico -> 0
                  item_group: it.item_group,
                  brand: it.brand,
                  item_name: it.item_name
                }))
                iframeRef.current.contentWindow.postMessage({
                  type: 'ht-load-items',
                  items: payload,
                  rowIds: tableItems.map(it => it.id)
                }, '*')
              }
          } catch (e) {
            console.debug('Error posting items to iframe', e)
          }
        } else {
          showNotification('No se encontraron items en esta lista de precios', 'warning')
          itemsRef.current = []
          setItems([])
        }
      } else {
        const error = await response.json()
        showNotification(`Error al cargar items: ${error.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error loading price list items:', error)
      showNotification('Error al cargar items de la lista de precios', 'error')
    } finally {
      endItemsLoading()
    }
  }

  const savePriceList = async () => {
    // Validaciones para modo Actualizar Existentes
    if (!selectedPriceList) {
      showNotification('Debes seleccionar una lista de precios existente', 'error')
      return
    }

    setSaving(true)
    try {
      // Use the same scope the Guardar counter relies on (column filters when active)
      const itemsToSave = itemsScopedForSave
      
      // Enviar sólo los items que el botón "Guardar" ya cuenta como válidos
      // (tienen item_name, price > 0 y sin errores) - mismo criterio que getSaveableCount
      const validItems = saveableItems
      debugSaveEvaluation('update-mode candidates (primeros 5)', itemsToSave)
      debugSaveEvaluation('update-mode saveables (primeros 5)', validItems)
      
      // Si no hay items válidos, permitir guardar si cambió la metadata (moneda/cotización)
      if (validItems.length === 0 && !priceListMetaChanged) {
        showNotification('No hay items válidos para guardar', 'warning')
        setSaving(false)
        return
      }

      console.log('FRONTEND (Purchase): Items totales:', items.length, 'Items visibles:', itemsToSave.length, 'Items a guardar:', validItems.length)

      // Validar cotización si está en modo específico
      if (priceListExchangeMode === 'specific') {
        const parsed = parseFloat(priceListExchangeRate)
        if (isNaN(parsed) || parsed < 0) {
          showNotification('La cotización debe ser un número mayor o igual a 0', 'error')
          setSaving(false)
          return
        }
      }

      const payload = {
        mode: 'update', // Actualizar lista existente
        existing_price_list: selectedPriceList,
        currency: priceListCurrency,
        // Enviar exchange_rate compatible con backend; si el modo es 'general' enviar -1
        exchange_rate: priceListExchangeMode === 'general' ? -1 : priceListExchangeRate,
        // También incluir custom_exchange_rate explícito
        custom_exchange_rate: priceListExchangeMode === 'general' ? -1 : priceListExchangeRate,
        items: validItems.length > 0 ? validItems.map(item => ({
          item_code: item.item_code,
          item_name: item.item_name, // REQUERIDO por backend
          price: item.price,
          name: item.item_price_name, // Incluir el identificador del Item Price si existe (para updates)
          supplier: '', // Se determinará automáticamente en el backend
          company: activeCompany
        })) : []
      }

      const response = await fetchWithAuth(`${API_ROUTES.inventory}/purchase-price-lists/bulk-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const result = await response.json()
        const processId = result.process_id

        // If the backend returned a process id, poll for progress.
        // Otherwise this was a metadata-only save (no items to import) so
        // treat it as completed and avoid calling the progress endpoint with undefined.
        if (processId) {
          pollImportProgress(processId, 'update')
        } else {
          // No background import started — metadata-only save completed.
          setSaving(false)
          showNotification('Lista de precios actualizada exitosamente', 'success')
          // Refresh the list summaries so UI reflects persisted metadata
          try {
            loadPurchasePriceLists()
          } catch (e) {
            console.debug('loadPurchasePriceLists failed after metadata-only save', e)
          }
        }
      } else {
        const error = await response.json()
        showNotification(`Error al guardar: ${error.message || 'Error desconocido'}`, 'error')
        setSaving(false)
      }
    } catch (error) {
      console.error('Error saving price list:', error)
      showNotification('Error al guardar la lista de precios', 'error')
      setSaving(false)
    }
  }

  const pollImportProgress = async (processId, operation) => {
    // Defensive: if called without a valid processId, skip polling.
    if (!processId) {
      console.warn('pollImportProgress called without processId, skipping')
      return
    }

    try {
      const response = await fetchWithAuth(`${API_ROUTES.inventory}/purchase-price-lists/bulk-import-progress/${processId}`)
      
      if (response.ok) {
        const progress = await response.json()
        
        if (progress.success) {
          if (progress.status === 'completed') {
            // Import completed
            setSaving(false)
            if (operation === 'create') {
              showNotification('Lista de precios creada exitosamente. Tabla vaciada.', 'success')
              // Limpiar formulario después de guardar
              setNewListName('')
              setSelectedSupplier('')
              setNewListCurrency(companyCurrency || '')
              setNewListExchangeRate('1.0000')
              setNewListExchangeMode('specific')
              itemsRef.current = []
              setItems([])
              // Limpiar tabla del iframe
              try {
                if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
                  iframeRef.current.contentWindow.postMessage({ type: 'ht-clear-table' }, '*')
                }
              } catch (e) {
                console.debug('Error clearing table after create', e)
              }
              loadPurchasePriceLists() // Recargar listas
            } else {
              showNotification(`Lista de precios actualizada exitosamente. ${progress.imported} items guardados. Tabla vaciada.`, 'success')
              setSaveProgress({ status: 'completed', saved: progress.imported, failed: progress.failed })
              // Vaciar tabla después de importación exitosa (modo update)
              itemsRef.current = []
              setItems([])
              setOriginalItems([])
              resetSelectionState()
              // Limpiar tabla del iframe
              try {
                if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
                  iframeRef.current.contentWindow.postMessage({ type: 'ht-clear-table' }, '*')
                }
              } catch (e) {
                console.debug('Error clearing table after update', e)
              }
            }
          } else if (progress.status === 'error') {
            // Import failed
            setSaving(false)
            const msg = progress.message || ''
            if (/status:\s*success/i.test(msg) || /completado/i.test(msg)) {
              showNotification(`Lista de precios actualizada (Data Import reportó éxito).`, 'success')
              setSaveProgress({ status: 'completed', saved: progress.imported, failed: progress.failed })
            } else {
              showNotification(`Error en la importación: ${progress.message}`, 'error')
            }
          } else {
            // Still running, continue polling
            setTimeout(() => pollImportProgress(processId, operation), 1000)
          }
        } else {
          setSaving(false)
          showNotification(`Error obteniendo progreso: ${progress.message}`, 'error')
        }
      } else {
        setSaving(false)
        showNotification('Error obteniendo progreso de importación', 'error')
      }
    } catch (error) {
      console.error('Error polling import progress:', error)
      setSaving(false)
      showNotification('Error obteniendo progreso de importación', 'error')
    }
  }

  
  const canSaveItem = useCallback((item) => {
    if (!item) return false
    const hasName = item.item_name && item.item_name.toString().trim() !== ''
    const hasNoErrors = !item.errors?.price
    const hasErp = !!item.erp_item_code
    const newPrice = toNumberValue(item.price)
    const hasPrice = newPrice > 0
    if (!hasName || !hasNoErrors || !hasErp || !hasPrice) {
      return false
    }
    const baselinePrice = toNumberValue(item.original_price ?? item.existing_price ?? 0)
    return Math.abs(newPrice - baselinePrice) > PRICE_CHANGE_THRESHOLD
  }, [])

  const debugSaveEvaluation = useCallback((label, list) => {
    if (!Array.isArray(list) || list.length === 0) return
    const sample = list.slice(0, 5).map(item => ({
      code: item.item_code,
      existing: toNumberValue(item.original_price ?? item.existing_price ?? 0),
      new_price: toNumberValue(item.price),
      canSave: canSaveItem(item),
      hasDocname: !!item.item_price_name
    }))
    console.debug(`[PurchasePriceListTemplate] ${label} total=${list.length}`, sample)
  }, [canSaveItem])

  // Use shared utilities for filtering/selection so logic remains consistent across components
  const visibleItems = useMemo(() => {
    // For PurchasePriceListTemplate, we need custom duplicate filtering
    if (activeFilter === 'duplicates') {
      const duplicateSet = new Set(duplicateCodes)
      return items.filter(item => duplicateSet.has(item.item_code))
    }
    return computeVisibleItems(items, { activeFilter, selectedRows, visibleRowIds })
  }, [items, activeFilter, selectedRows, visibleRowIds, duplicateCodes])

  const itemsScopedForSave = useMemo(
    () => (visibleRowIds !== null ? visibleItems : items),
    [visibleItems, visibleRowIds, items]
  )

  const saveableItems = useMemo(
    () => itemsScopedForSave.filter(canSaveItem),
    [itemsScopedForSave, canSaveItem]
  )

  const saveableCount = saveableItems.length

  // Detectar si cambió la metadata de la lista (moneda / cotización)
  const priceListMetaChanged = useMemo(() => {
    if (!selectedPriceList) return false

    // Obtener valores originales desde currentPriceListData si está cargada,
    // si no, intentar desde purchasePriceLists (lista resumida)
    const originalFromDetails = currentPriceListData?.price_list || null
    const listSummary = purchasePriceLists.find(p => p && p.name === selectedPriceList)

    const originalCurrency = originalFromDetails?.currency ?? listSummary?.currency

    const originalExchange = (originalFromDetails && (originalFromDetails.custom_exchange_rate ?? originalFromDetails.exchange_rate))
      ?? (listSummary && (listSummary.custom_exchange_rate ?? listSummary.exchange_rate))
      ?? null

    const normOriginalExchange = originalExchange === null || typeof originalExchange === 'undefined' ? '1' : String(originalExchange)
    const normCurrentExchange = priceListExchangeRate === null || typeof priceListExchangeRate === 'undefined' ? '1' : String(priceListExchangeRate)

    const currencyChanged = String(priceListCurrency) !== String(originalCurrency)
    const exchangeChanged = String(normCurrentExchange) !== String(normOriginalExchange)

    return currencyChanged || exchangeChanged
  }, [selectedPriceList, priceListCurrency, priceListExchangeRate, currentPriceListData, purchasePriceLists])

  // Detectar si hay duplicados con precio > 0 (bloqueará el guardado)
  const hasDuplicatesWithPrice = useMemo(() => {
    if (!duplicateCodes || duplicateCodes.length === 0) return false
    if (!saveableItems || saveableItems.length === 0) return false
    const duplicateSet = new Set(duplicateCodes)
    const counts = new Map()

    saveableItems.forEach(item => {
      const code = (item.item_code || '').toString().trim()
      if (!code || !duplicateSet.has(code)) {
        return
      }
      counts.set(code, (counts.get(code) || 0) + 1)
    })

    for (const count of counts.values()) {
      if (count > 1) {
        return true
      }
    }

    return false
  }, [duplicateCodes, saveableItems])

  // Calcular conteos para habilitar/deshabilitar filtros
  const filterStats = useMemo(() => {
    const withNewPrice = items.filter(item => 
      (item.price !== undefined && item.price !== null) && Number(item.price) > 0
    ).length
    const withoutNewPrice = items.filter(item => 
      !item.price || Number(item.price) <= 0
    ).length
    
    return {
      withNewPrice,
      withoutNewPrice,
      canFilterWithPrice: withNewPrice > 0 && withNewPrice < items.length,
      canFilterWithoutPrice: withoutNewPrice > 0 && withoutNewPrice < items.length
    }
  }, [items])

  // Backwards-compatible getter
  const getSaveableCount = () => saveableCount

  // Reset selection using shared helper
  const resetSelectionState = useCallback(
    () => resetSelectionHelper(setSelectedRows, setSelectAll, setActiveFilter, setFilteredRowCount),
    [setSelectedRows, setSelectAll, setActiveFilter, setFilteredRowCount]
  )

  const clearTableData = useCallback(({ silent = false } = {}) => {
    itemsRef.current = []
    setItems([])
    setOriginalItems([])
    setVisibleRowIds(null)
    resetSelectionState()
    try {
      const iframeWindow = iframeRef?.current?.contentWindow
      if (iframeWindow) {
        iframeWindow.postMessage({ type: 'ht-clear-table' }, '*')
      }
    } catch (error) {
      console.debug('Error clearing purchase price list table', error)
    }
    if (!silent) {
      showNotification('Tabla vaciada. Esto no elimina precios en ERPNext.', 'info')
    }
  }, [resetSelectionState, showNotification])

  // Efecto para manejar cambios en el modo de creación (solo una vez por cambio)
  useEffect(() => {
    if (creationMode === lastCreationModeRef.current) return
    lastCreationModeRef.current = creationMode

    cancelInFlightRef.current()
    clearTableData({ silent: true })
    if (creationMode === 'update') {
      setIsUpdateMode(true)
      setIsCreatingNew(false)
      setCreationMethod('manual')
      setSelectedPriceList('')
      setCurrentPriceListData(null)
      itemsRef.current = []
      setItems([])
      setNewListName('')
      setNewListCurrency(companyCurrency || '')
      setNewListValidFrom('')
      setInputMode('paste') // Resetear a pegar SKUs cuando se cambia a modo update
    } else if (creationMode === 'manual') {
      setIsUpdateMode(false)
      setIsCreatingNew(true)
      setCreationMethod('manual')
      setSelectedPriceList('')
      setCurrentPriceListData(null)
      itemsRef.current = []
      setItems([])
      setNewListName('')
      setNewListCurrency(companyCurrency || '')
      setNewListValidFrom('')
      setSelectedSupplier('')
      setNewListExchangeRate('1.0000')
      setNewListExchangeMode('specific') // Resetear modo de cotización
      // Cargar proveedores para el modo Crear Nueva
      loadSuppliers()
    }

    // Limpiar la tabla del iframe cuando cambie el modo
    try {
      if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'ht-clear-table' }, '*')
      }
    } catch (e) {
      console.debug('Error clearing table on mode change', e)
    }

    // Resetear estado de selección
    resetSelectionHelper(setSelectedRows, setSelectAll, setActiveFilter, setFilteredRowCount)
  }, [creationMode, clearTableData])

  const handleFilterChange = (newFilter) => {
    // Custom handling for duplicates filter
    if (newFilter === 'duplicates') {
      const duplicateSet = new Set(duplicateCodes)
      const filteredDuplicates = items.filter(item => duplicateSet.has(item.item_code))
      const duplicateCount = filteredDuplicates.length

      if (duplicateCount === 0) {
        showNotification('No hay SKUs duplicados para mostrar', 'info')
        setActiveFilter('none')
        setFilteredRowCount(null)
        return
      }

      showNotification(`Mostrando ${duplicateCount} item(s) duplicados`, 'info')
      setActiveFilter('duplicates')
      setFilteredRowCount(duplicateCount)
      // Sincronizar con los items duplicados filtrados, no con visibleItems que aún no se actualizó
      scheduleIframeSync(filteredDuplicates)
      return
    }

    // Custom handling for other filters to ensure correct sync
    let filteredItems = items
    if (newFilter === 'selected') {
      filteredItems = items.filter(item => selectedRows.has(item.id))
      if (filteredItems.length === 0) {
        showNotification('Selecciona al menos una fila para mostrar solo los seleccionados', 'warning')
        setActiveFilter('none')
        setFilteredRowCount(null)
        return
      }
      showNotification(`Mostrando ${filteredItems.length} item(s) seleccionados`, 'info')
      setActiveFilter('selected')
      setFilteredRowCount(filteredItems.length)
      scheduleIframeSync(filteredItems)
      return
    }

    if (newFilter === 'with-price') {
      filteredItems = items.filter(item => (item.price !== undefined && item.price !== null) && Number(item.price) > 0)
      showNotification(`Mostrando ${filteredItems.length} item(s) con precio nuevo`, 'info')
      setActiveFilter('with-price')
      setFilteredRowCount(filteredItems.length)
      scheduleIframeSync(filteredItems)
      return
    }

    if (newFilter === 'without-price') {
      filteredItems = items.filter(item => !item.price || Number(item.price) <= 0)
      showNotification(`Mostrando ${filteredItems.length} item(s) sin precio nuevo`, 'info')
      setActiveFilter('without-price')
      setFilteredRowCount(filteredItems.length)
      scheduleIframeSync(filteredItems)
      return
    }

    // None or fallback
    if (newFilter === 'none') {
      showNotification('Mostrando todos los items', 'info')
      setActiveFilter('none')
      setFilteredRowCount(null)
      scheduleIframeSync(items)
      return
    }
  }

  const handleToggleSelectAll = () => {
    setSelectedRows(prev => toggleSelectAllSet(prev, visibleItems))
  }

  const deleteSelectedItems = () => {
    const selectionCount = selectedRows.size
    if (selectionCount === 0) {
      showNotification('Selecciona al menos una fila para eliminar', 'warning')
      return
    }

    // Mostrar modal de confirmación
    setShowDeleteConfirm(true)
  }

  // Función que ejecuta la eliminación después de confirmar
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
      // Obtener los códigos de los items seleccionados
      const selectedItems = items.filter(item => selectedRows.has(item.id))
      const itemCodes = selectedItems.map(item => item.item_code).filter(code => code)

      if (itemCodes.length === 0) {
        showNotification('No se encontraron códigos válidos para eliminar', 'warning')
        return
      }

    // Llamar a la API para eliminar los item_price de la lista de precios
      const response = await fetchWithAuth(`${API_ROUTES.purchasePriceListPrices}${selectedPriceList}/items`, {
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
          // Eliminar las filas de la tabla local
          setItems(prev => prev.filter(item => !selectedRows.has(item.id)))
          resetSelectionHelper(setSelectedRows, setSelectAll, setActiveFilter, setFilteredRowCount)
          
          const deletedCount = data.data?.deleted_count || itemCodes.length
          showNotification(`Se eliminaron ${deletedCount} artículos de la lista de precios`, 'success')
          
          // Cerrar modal
          setShowDeleteConfirm(false)
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
    }
  }


  // Sincronizar selectAll cuando cambian visibleItems o selectedRows
  useEffect(() => {
    const visible = visibleItems
    const allSelected = visible.length > 0 && visible.every(item => selectedRows.has(item.id))
    if (selectAll !== allSelected) {
      setSelectAll(allSelected)
    }
  }, [visibleItems, selectedRows, selectAll])

  // Manejar cambios en activeFilter y selectedRows
  useEffect(() => {
    if (activeFilter === 'selected') {
      if (selectedRows.size === 0) {
        setActiveFilter('none')
      }
    }
    // Resetear filtro si se vuelve inválido
    if (activeFilter === 'with-price' && !filterStats.canFilterWithPrice) {
      setActiveFilter('none')
      showNotification('El filtro "Con precio nuevo" ya no es aplicable', 'info')
    }
    if (activeFilter === 'without-price' && !filterStats.canFilterWithoutPrice) {
      setActiveFilter('none')
      showNotification('El filtro "Sin precio nuevo" ya no es aplicable', 'info')
    }
  }, [activeFilter, selectedRows, filterStats])

  // Obtener cotización desde Exchange Rates (ERPNext)
  const handleFetchExchangeRate = async (currency, setExchangeRate, baseCurrency) => {
    const from = (currency || '').toString().trim()
    const to = (baseCurrency || '').toString().trim()
    if (!from || !to) {
      showNotification('No se pudo determinar moneda origen/destino para obtener cotización', 'error')
      return
    }
    if (from === to) {
      setExchangeRate('1')
      return
    }

    const authFetch = fetchWithAuthRef.current
    if (!authFetch) {
      showNotification('No se pudo obtener cotización: sesión no disponible', 'error')
      return
    }

    setIsLoadingExchangeRate(true)
    try {
      const response = await authFetch(`${API_ROUTES.currencyExchange.latest(from)}&to=${encodeURIComponent(to)}`)
      const data = await (response && response.json ? response.json().catch(() => ({})) : Promise.resolve({}))
      if (!response || !response.ok || data?.success === false) {
        throw new Error(data?.message || `Error HTTP ${response ? response.status : 'no-response'}`)
      }
      const latestRate = data?.data?.exchange_rate
      if (!(Number(latestRate) > 0)) {
        throw new Error(`No hay cotización cargada para ${from}/${to}`)
      }
      setExchangeRate(String(latestRate))
      showNotification(`Cotización ${from}/${to} actualizada`, 'success')
    } catch (error) {
      console.error('Error fetching exchange rate:', error)
      showNotification(error?.message || 'Error al obtener la cotización', 'error')
    } finally {
      setIsLoadingExchangeRate(false)
    }
  }

  // Si el modo es 'general', obtener la cotización global del sistema y forzar el input como no editable
  useEffect(() => {
    if (priceListExchangeMode !== 'general') return
    if (!priceListCurrency || priceListCurrency === companyCurrency) return

    const authFetch = fetchWithAuthRef.current
    if (!authFetch) {
      console.error('PurchasePriceListTemplate: fetchWithAuth no disponible para obtener tasa global')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        setIsLoadingExchangeRate(true)
        const path = `${API_ROUTES.currencyExchange.latest(priceListCurrency)}&to=${encodeURIComponent(companyCurrency)}`
        const resp = await authFetch(path)
        const body = await (resp && resp.json ? resp.json().catch(() => ({})) : Promise.resolve({}))
        if (!resp || !resp.ok || body?.success === false) {
          throw new Error(body?.message || `Error HTTP ${resp ? resp.status : 'no-response'}`)
        }

        const rate = body?.data?.exchange_rate
        if (!cancelled) {
          if (!(Number(rate) > 0)) {
            throw new Error(`No hay cotización cargada para ${priceListCurrency}/${companyCurrency}`)
          }
          setPriceListExchangeRate(String(rate))
        }
      } catch (err) {
        console.error('Error fetching global exchange rate:', err)
        if (!cancelled) {
          setPriceListExchangeRate('')
          showNotification?.(err?.message || 'Error al obtener la cotización', 'error')
        }
      } finally {
        if (!cancelled) setIsLoadingExchangeRate(false)
      }
    })()

    return () => { cancelled = true }
  }, [priceListExchangeMode, priceListCurrency, companyCurrency])

  // Si el modo es 'general' para nueva lista, obtener la cotización global del sistema
  useEffect(() => {
    if (newListExchangeMode !== 'general') return
    if (!newListCurrency || newListCurrency === companyCurrency) return

    const authFetch = fetchWithAuthRef.current
    if (!authFetch) {
      console.error('PurchasePriceListTemplate: fetchWithAuth no disponible para obtener tasa global (nueva lista)')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        setIsLoadingExchangeRate(true)
        const path = `${API_ROUTES.currencyExchange.latest(newListCurrency)}&to=${encodeURIComponent(companyCurrency)}`
        const resp = await authFetch(path)
        const body = await (resp && resp.json ? resp.json().catch(() => ({})) : Promise.resolve({}))
        if (!resp || !resp.ok || body?.success === false) {
          throw new Error(body?.message || `Error HTTP ${resp ? resp.status : 'no-response'}`)
        }

        const rate = body?.data?.exchange_rate
        if (!cancelled) {
          if (!(Number(rate) > 0)) {
            throw new Error(`No hay cotización cargada para ${newListCurrency}/${companyCurrency}`)
          }
          setNewListExchangeRate(String(rate))
        }
      } catch (err) {
        console.error('Error fetching global exchange rate for new list:', err)
        if (!cancelled) {
          setNewListExchangeRate('')
          showNotification?.(err?.message || 'Error al obtener la cotización', 'error')
        }
      } finally {
        if (!cancelled) setIsLoadingExchangeRate(false)
      }
    })()

    return () => { cancelled = true }
  }, [newListExchangeMode, newListCurrency, companyCurrency])

  // Función para aplicar fórmula de calculadora
  const handleApplyFormula = (formula) => {
    try {
      // Enviar la fórmula al iframe para que la aplique directamente
      if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'ht-apply-formula',
          formula: formula
        }, '*')
      }
    } catch (e) {
      console.debug('Error applying formula', e)
      showNotification('Error al aplicar la fórmula', 'error')
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
      const newPrice = Number(match.adjusted_price)
        const normalizedValue = Number.isFinite(newPrice) ? String(newPrice) : row.raw_new_price
        return {
          ...row,
          price: newPrice,
          new_price: newPrice,
          valor: newPrice,
          raw_new_price: normalizedValue,
          raw_price_input: normalizedValue
        }
      })

    setItems(updated)
    scheduleIframeSync(updated)
    setIsCalculatorOpen(false)

    if (result.factor) {
      showNotification(`Ajuste por inflación aplicado. Factor ${Number(result.factor).toFixed(4)}`, 'success')
    }
  }

  const { itemsRef, scheduleIframeSync, cancelInFlight } = usePurchasePriceListIframeBridge({
    iframeRef,
    items,
    setItems,
    selectedRows,
    setSelectedRows,
    setVisibleRowIds,
    fetchWithAuth,
    activeCompany,
    selectedPriceList,
    showNotification,
    visibleItems,
    onBulkDetailsStart: beginItemsLoading,
    onBulkDetailsEnd: endItemsLoading,
    onDecimalFormatRequest: handleDecimalPromptFromPaste,
    decimalSeparator
  })

  useEffect(() => {
    cancelInFlightRef.current = cancelInFlight || (() => {})
  }, [cancelInFlight])

  useEffect(() => {
    setItems(prevItems => {
      if (!prevItems || prevItems.length === 0) {
        return prevItems
      }

      let changed = false
      const updatedItems = prevItems.map(item => {
        if (!item) return item
        const primaryRaw = typeof item.raw_price_input === 'string' ? item.raw_price_input.trim() : ''
        const secondaryRaw = typeof item.raw_new_price === 'string' ? item.raw_new_price.trim() : ''
        const rawInput = primaryRaw || secondaryRaw
        if (!rawInput) {
          if (item.errors && item.errors.price) {
            const mergedErrors = { ...item.errors }
            delete mergedErrors.price
            if (mergedErrors.price !== item.errors.price) {
              changed = true
              return { ...item, errors: mergedErrors }
            }
          }
          return item
        }

        const normalized = normalizePriceInput(rawInput, { decimalSeparator })
        const parsedValue = normalized ? parseFloat(normalized) : NaN
        const finalPrice = Number.isFinite(parsedValue) ? parsedValue : 0
        const mergedErrors = { ...(item.errors || {}) }

        if (rawInput && (!normalized || !Number.isFinite(parsedValue) || parsedValue <= 0)) {
          mergedErrors.price = 'Precio invalido'
        } else if (mergedErrors.price) {
          delete mergedErrors.price
        }

        const nextRaw = normalized || rawInput
        if (
          finalPrice !== item.price ||
          (item.errors?.price ?? null) !== (mergedErrors.price ?? null) ||
          nextRaw !== item.raw_new_price
        ) {
          changed = true
          return {
            ...item,
            price: finalPrice,
            errors: mergedErrors,
            raw_new_price: nextRaw,
            raw_price_input: rawInput || item.raw_price_input
          }
        }
        return item
      })

      if (changed) {
        itemsRef.current = updatedItems
        scheduleIframeSync(updatedItems)
        return updatedItems
      }

      return prevItems
    })
  }, [decimalSeparator, scheduleIframeSync, setItems])

  const handleRemoveDuplicates = () => {
    if (!hasAnyDuplicates) {
      showNotification('No hay SKUs duplicados para limpiar', 'info')
      return
    }

    const duplicateSet = new Set(duplicateCodes)
    const groupedByCode = new Map()

    items.forEach((item, index) => {
      if (!item?.item_code || !duplicateSet.has(item.item_code)) {
        return
      }
      if (!groupedByCode.has(item.item_code)) {
        groupedByCode.set(item.item_code, [])
      }
      groupedByCode.get(item.item_code).push({ item, index })
    })

    const idsToKeep = new Set()

    const pickByPrice = (group, comparator) => {
      return [...group].sort((a, b) => {
        const priceA = Number(a.item.price)
        const priceB = Number(b.item.price)
        const safeA = Number.isFinite(priceA) ? priceA : 0
        const safeB = Number.isFinite(priceB) ? priceB : 0
        const priceComparison = comparator(safeA, safeB)
        if (priceComparison !== 0) {
          return priceComparison
        }
        return a.index - b.index
      })[0]
    }

    groupedByCode.forEach(group => {
      if (!group || group.length === 0) {
        return
      }

      const sortedByIndex = [...group].sort((a, b) => a.index - b.index)
      let chosen = null

      switch (duplicateRemovalStrategy) {
        case 'keep-highest-price':
          chosen = pickByPrice(group, (a, b) => b - a)
          break
        case 'keep-lowest-price':
          chosen = pickByPrice(group, (a, b) => a - b)
          break
        case 'keep-second':
          chosen = sortedByIndex[1] || sortedByIndex[0]
          break
        case 'keep-third':
          chosen = sortedByIndex[2] || sortedByIndex[sortedByIndex.length - 1] || sortedByIndex[0]
          break
        case 'keep-first':
        default:
          chosen = sortedByIndex[0]
          break
      }

      if (chosen && chosen.item && chosen.item.id !== undefined) {
        idsToKeep.add(chosen.item.id)
      }
    })

    if (idsToKeep.size === 0) {
      showNotification('No se pudo determinar qué duplicados eliminar con el criterio seleccionado', 'warning')
      return
    }

    let removedCount = 0
    const updatedItems = items.filter(item => {
      if (!item?.item_code || !duplicateSet.has(item.item_code)) {
        return true
      }
      if (idsToKeep.has(item.id)) {
        return true
      }
      removedCount += 1
      return false
    })

    if (removedCount === 0) {
      showNotification('No se eliminaron duplicados con el criterio seleccionado', 'info')
      return
    }

    itemsRef.current = updatedItems
    setItems(updatedItems)

    setSelectedRows(prev => {
      if (!prev || prev.size === 0) return prev
      const validIds = new Set(updatedItems.map(item => item.id))
      let changed = false
      const next = new Set()
      prev.forEach(id => {
        if (validIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      })
      return changed ? next : prev
    })

    setSelectAll(false)
    setVisibleRowIds(null)
    if (activeFilter !== 'none') {
      setActiveFilter('none')
    }
    setFilteredRowCount(null)

    const strategyLabel = duplicateRemovalOptions.find(opt => opt.value === duplicateRemovalStrategy)?.label || 'criterio seleccionado'
    showNotification(`Se eliminaron ${removedCount} duplicado(s) usando "${strategyLabel}"`, 'success')

    scheduleIframeSync(updatedItems)
  }

  const layoutProps = {
    activeCompany,
    activeFilter,
    creationMode,
    duplicateRemovalOptions,
    duplicateRemovalStrategy,
    deleteSelectedItems,
    executeDeleteSelectedItems,
    filterStats,
    findAndFocusFirstDuplicate,
    getSaveableCount,
    handleApplyFormula,
    handleApplyInflationResult,
    handleFetchExchangeRate,
    handleFilterChange,
    handleLoadData,
    handlePasteSkus,
    handleClearTable: clearTableData,
    handlePriceListSelection,
    handleRemoveDuplicates,
    handleSavePriceList,
    handleToggleSelectAll,
    hasAnyDuplicates,
    hasDuplicatesWithPrice,
    iframeRef,
    inputMode,
    getInflationItems,
    isCalculatorOpen,
    isLoadingExchangeRate,
    isManagementModalOpen,
    items,
    openDecimalFormatModal: handleManualDecimalModal,
    loadPurchasePriceLists,
    newListCurrency,
    newListExchangeMode,
    newListExchangeRate,
    newListName,
    priceListCurrency,
    priceListExchangeMode,
    priceListExchangeRate,
    priceListMetaChanged,
    purchasePriceLists,
    savePriceList,
    saveProgress,
    saving,
    selectedPriceList,
    selectedRows,
    selectedSupplier,
    selectAll,
    setCreationMode,
    setIsCalculatorOpen,
    setIsManagementModalOpen,
    setNewListCurrency,
    setNewListExchangeMode,
    setNewListExchangeRate,
    setNewListName,
    setPriceListCurrency,
    setPriceListExchangeMode,
    setPriceListExchangeRate,
    setDuplicateRemovalStrategy,
    setSelectedSupplier,
    setShowDeleteConfirm,
    showDeleteConfirm,
    showNotification,
    suppliers,
    visibleItems,
    isLoadingItems,
    decimalSeparator,
    loadingItemsMessage
  }

  return (
    <>
      <PurchasePriceListLayout {...layoutProps} />
      <DecimalSeparatorModal
        isOpen={isDecimalModalOpen}
        onClose={handleDecimalModalClose}
        onConfirm={handleDecimalSelection}
        currentSelection={decimalSeparator}
        samples={decimalSamples}
        detectedSeparator={detectedDecimalSeparator}
      />
    </>
  )
}
