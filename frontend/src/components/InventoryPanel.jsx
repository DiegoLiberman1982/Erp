import React, { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../AuthProvider'
import { NotificationContext } from '../contexts/NotificationContext'
import useTaxTemplates from '../hooks/useTaxTemplates'
import API_ROUTES from '../apiRoutes'
import { useConfirm } from '../hooks/useConfirm'
import { ChevronRight, ChevronDown, Package, FileText, Plus, Edit, Trash2, Save, X, Warehouse, BarChart3, Lock, Unlock, Package2 } from 'lucide-react'
import Select from 'react-select'
import { components } from 'react-select'
import CreatableSelect from 'react-select/creatable'
import UomModal from './modals/UomModal.jsx'
import { formatCurrency, formatNumber, formatDate, extractAccountName, extractItemGroupName, extractItemCodeDisplay, mapVoucherTypeToSigla } from './InventoryPanel/inventoryUtils'
import { fetchWarehouses as fetchWarehousesApi } from '../apiUtils'
import MovementsTable from './InventoryPanel/MovementsTable'
import ItemListPanel from './InventoryPanel/ItemListPanel'
import ItemDetailsPanel from './InventoryPanel/ItemDetailsPanel'
import ItemMovementsPanel from './InventoryPanel/ItemMovementsPanel'
import RemitoModal from './modals/RemitoModal/RemitoModal.jsx'
import KitPanel from './InventoryPanel/KitPanel.jsx'
import KitDetailsPanel from './InventoryPanel/KitDetailsPanel'
import KitMovementsPanel from './InventoryPanel/KitMovementsPanel'
import WarehouseTransferModal from './modals/WarehouseTransferModal/WarehouseTransferModal.jsx'
import StockReconciliationModal from './modals/StockReconciliationModal.jsx'

export default function InventoryPanel() {
  const [items, setItems] = useState([])
  const [selectedItem, setSelectedItem] = useState(null)
  const [itemDetails, setItemDetails] = useState(null)
  const [itemMovements, setItemMovements] = useState([])
  const [loading, setLoading] = useState(false)
  const [isEditingItem, setIsEditingItem] = useState(false)
  const [editedItemData, setEditedItemData] = useState({})
  const [savingItem, setSavingItem] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  // Bulk delete states
  const [bulkModeActive, setBulkModeActive] = useState(false)
  const [selectedForDelete, setSelectedForDelete] = useState(new Set())
  
  // Estados para kits
  const [kitList, setKitList] = useState([])
  const [selectedKit, setSelectedKit] = useState(null)
  const [kitDetails, setKitDetails] = useState(null)
  const [kitLoading, setKitLoading] = useState(false) // For list loading only
  const [kitDetailsLoading, setKitDetailsLoading] = useState(false) // For details panel only
  const [isEditingKit, setIsEditingKit] = useState(false)
  const [editedKitData, setEditedKitData] = useState({})
  const [savingKit, setSavingKit] = useState(false)
  const [kitSearch, setKitSearch] = useState('')
  const [kitMovements, setKitMovements] = useState([])
  const [kitMovementWarehouseTab, setKitMovementWarehouseTab] = useState('all')
  const [kitWarehouses, setKitWarehouses] = useState([])
  
  // Estados para paginación
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(17)
  const [itemDetailsCache, setItemDetailsCache] = useState({}) // Cache para detalles de items
  
  // Estados para ordenamiento y filtrado
  const [sortField, setSortField] = useState('item_code') // Campo por el que ordenar
  const [sortDirection, setSortDirection] = useState('asc') // 'asc' o 'desc'
  const [filters, setFilters] = useState({
    item_code: '',
    description: ''
  })
  
  // Estados para pestañas
  const [itemTab, setItemTab] = useState('general') // 'general', 'sales_purchase', 'inventory', 'accounting', 'description', 'links'
  const [itemTypeTab, setItemTypeTab] = useState('services') // 'products', 'services'
  const [defaultItemTypeTab, setDefaultItemTypeTab] = useState('services') // Tab por defecto guardado
  const [movementWarehouseTab, setMovementWarehouseTab] = useState('all') // 'all' o nombre del warehouse
  const [isUomModalOpen, setIsUomModalOpen] = useState(false) // Control del modal UOM
  const [mainTab, setMainTab] = useState('items') // 'items' o 'kits'
  
  // Estados para warehouses mergeados
  const [warehouseTabs, setWarehouseTabs] = useState([]) // Tabs por base_code
  const [selectedWarehouseTab, setSelectedWarehouseTab] = useState(null) // Tab seleccionado
  const [warehouseTabItems, setWarehouseTabItems] = useState([]) // Items del tab seleccionado
  
  // Estados para datos auxiliares
  const [warehouses, setWarehouses] = useState([])
  const [itemGroups, setItemGroups] = useState([])
  const [brands, setBrands] = useState([])
  const [uoms, setUoms] = useState([])
  const [availableExpenseAccounts, setAvailableExpenseAccounts] = useState([])
  const [availableIncomeAccounts, setAvailableIncomeAccounts] = useState([])
  const [availableAssetAccounts, setAvailableAssetAccounts] = useState([])
  // Estados para Remito modal (abrir un remito desde la tabla de movimientos)
  const [isRemitoModalOpen, setIsRemitoModalOpen] = useState(false)
  const [selectedRemito, setSelectedRemito] = useState(null)
  const [remitoDraftData, setRemitoDraftData] = useState(null)
  // Stock Reconciliation modal (ver/cancelar desde movimientos)
  const [isStockReconciliationModalOpen, setIsStockReconciliationModalOpen] = useState(false)
  const [selectedStockReconciliation, setSelectedStockReconciliation] = useState(null)
  const [taxTemplates, setTaxTemplates] = useState([])
  const [companyDefaults, setCompanyDefaults] = useState({}) // Configuración por defecto de la compañía
  // Estado para modal de transferencia entre almacenes
  const [isWarehouseTransferModalOpen, setIsWarehouseTransferModalOpen] = useState(false)
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const { confirm, ConfirmDialog } = useConfirm()
  const { templates: taxTemplatesFromHook, sales: taxSales, purchase: taxPurchase, rateToTemplateMap, loading: taxTemplatesLoading, error: taxTemplatesError, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)

  useEffect(() => {
    if (taxTemplatesFromHook && Array.isArray(taxTemplatesFromHook)) {
      setTaxTemplates(taxTemplatesFromHook)
    }
  }, [taxTemplatesFromHook])

  // Función para inferir la tasa de IVA de un item basado en sus taxes
  const inferIvaRateFromItem = (item) => {
    const taxes = item?.taxes || []
    if (taxes.length === 0) return null
    const salesMap = rateToTemplateMap?.sales || {}
    const purchaseMap = rateToTemplateMap?.purchase || {}
    for (const tax of taxes) {
      const templateName = tax.item_tax_template
      // Find rate key from maps
      for (const [rate, name] of Object.entries(salesMap)) {
        if (name === templateName) return parseFloat(rate)
      }
      for (const [rate, name] of Object.entries(purchaseMap)) {
        if (name === templateName) return parseFloat(rate)
      }
    }
    return null
  }

  // Función para obtener ícono y colores de plataforma
  const getPlatformStyle = (platform) => {
    const styles = {
      mercadolibre: { 
        icon: '�', 
        bg: 'from-yellow-400 to-orange-500', 
        text: 'Mercado Libre',
        description: 'Compra y venta online'
      },
      amazon: { 
        icon: '�', 
        bg: 'from-blue-500 to-blue-600', 
        text: 'Amazon',
        description: 'Tienda global'
      },
      ebay: { 
        icon: '💰', 
        bg: 'from-red-500 to-red-600', 
        text: 'eBay',
        description: 'Subastas y compras'
      },
      aliexpress: { 
        icon: '🚚', 
        bg: 'from-orange-500 to-red-500', 
        text: 'AliExpress',
        description: 'Importaciones'
      },
      shopify: { 
        icon: '🛍️', 
        bg: 'from-green-500 to-green-600', 
        text: 'Shopify',
        description: 'Tienda propia'
      },
      woocommerce: { 
        icon: '🛒', 
        bg: 'from-purple-500 to-purple-600', 
        text: 'WooCommerce',
        description: 'E-commerce'
      },
      website: { 
        icon: '🌐', 
        bg: 'from-gray-500 to-gray-600', 
        text: 'Sitio Web',
        description: 'Página web'
      },
      other: { 
        icon: '🔗', 
        bg: 'from-indigo-500 to-indigo-600', 
        text: 'Otro',
        description: 'Enlace externo'
      }
    };
    return styles[platform] || styles.other;
  };

  // Cargar items al montar el componente
  useEffect(() => {
    if (activeCompany) {
      fetchDefaultTabPreference()
      setItemSearch('') // Limpiar búsqueda al cambiar de compañía
      fetchItems()
      fetchWarehouseTabs()
      fetchItemGroups()
      fetchBrands()
      fetchUoms()
      fetchAvailableAccounts()
      refreshTaxTemplates()
      fetchCompanyDefaults()
      // Limpiar cache de detalles cuando cambia la compañía
      setItemDetailsCache({})
      setCurrentPage(1)
    }
  }, [activeCompany])

  // Cargar detalles cuando se selecciona un item o kit
  useEffect(() => {
    if (selectedItem && selectedItem !== 'new' && mainTab === 'items') {
      console.log('DEBUG: selectedItem changed ->', selectedItem)
      fetchItemDetails(selectedItem)
      fetchItemMovements(selectedItem)
      setMovementWarehouseTab('all') // Resetear a "todos los almacenes"
    } else if (selectedKit && selectedKit !== 'new' && mainTab === 'kits') {
      fetchKitDetails(selectedKit)
      fetchKitMovements(selectedKit)
      setKitMovementWarehouseTab('all') // Reset to all warehouses
    } else if (selectedItem === 'new' || selectedKit === 'new') {
      if (mainTab === 'items') {
        setItemDetails(null)
        setItemMovements([])
        setMovementWarehouseTab('all')
      } else {
        setKitDetails(null)
        setKitMovements([])
        setKitMovementWarehouseTab('all')
      }
    }
  }, [selectedItem, selectedKit, mainTab])

  // Cargar kits cuando se cambia a la pestaña de kits y no hay kits cargados
  useEffect(() => {
    if (mainTab === 'kits' && kitList.length === 0) {
      fetchKits()
    }
  }, [mainTab, kitList.length])

  // Cargar itemGroups cuando se entra a la pestaña 'kits' (si aún no están cargados)
  useEffect(() => {
    if (mainTab === 'kits' && (!itemGroups || itemGroups.length === 0)) {
      fetchItemGroups()
    }
  }, [mainTab])

  // Cargar items del tab de almacén seleccionado
  useEffect(() => {
    if (selectedWarehouseTab) {
      fetchWarehouseTabItems(selectedWarehouseTab)
    }
  }, [selectedWarehouseTab])

  // Resetear página cuando cambia el tipo de item
  useEffect(() => {
    setCurrentPage(1)
  }, [itemTypeTab])

  // Limpiar estados al cambiar de tab principal
  useEffect(() => {
    if (mainTab === 'kits') {
      // Limpiar estados de items cuando se cambia a kits
      setSelectedItem(null)
      setItemDetails(null)
      setItemMovements([])
      setIsEditingItem(false)
      setEditedItemData({})
      setCurrentPage(1)
      setItemSearch('')
      // Cargar kits si no están cargados
      if (kitList.length === 0) {
        fetchKits()
      }
      // Ensure bulk mode is disabled when switching tabs
      setBulkModeActive(false)
      setSelectedForDelete(new Set())
    } else {
      // Limpiar estados de kits cuando se cambia a items
      setSelectedKit(null)
      setKitDetails(null)
      setIsEditingKit(false)
      setEditedKitData({})
      setKitSearch('')
      // Ensure bulk mode is disabled when switching tabs
      setBulkModeActive(false)
      setSelectedForDelete(new Set())
    }
  }, [mainTab])

  // Cargar detalles de items visibles cuando cambian los filtros o la página
  useEffect(() => {
    const { items: visibleItems } = getPaginatedItems()
    if (visibleItems.length > 0) {
      loadVisibleItemDetails(visibleItems)
    }
  }, [items, itemSearch, itemTypeTab, currentPage, filters, sortField, sortDirection])

  // Función para manejar el ordenamiento
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
    setCurrentPage(1) // Resetear a la primera página
  }

  // Función para manejar cambios en los filtros
  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value
    }))
    setCurrentPage(1) // Resetear a la primera página
  }

  const fetchItems = async (searchTerm = '') => {
    try {
      setLoading(true)
      let url = `${API_ROUTES.inventory}/items?company=${encodeURIComponent(activeCompany)}&limit=10000&exclude_kits=1`
      if (searchTerm.trim()) {
        url += `&search=${encodeURIComponent(searchTerm.trim())}`
      }
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          try {
            const raw = data.data || []
            const matches = raw.filter(i => {
              const check = (i && (i.erp_item_code || i.item_code || i.name || '')).toString()
              return check.includes('104M1-38T')
            })
            if (matches && matches.length > 0) {
              console.log('DEBUG fetchItems: rows matching 104M1-38T ->', matches)
            }
          } catch (e) {
            console.log('DEBUG fetchItems: error while checking matches', e)
          }
          setItems(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching items:', error)
      showNotification('Error al cargar items', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchKits = async (searchTerm = '') => {
    // Evitar llamadas duplicadas mientras ya está cargando
    if (kitLoading) {
      console.debug('fetchKits: skipping, already loading')
      return
    }
    try {
      setKitLoading(true)
      let url = `${API_ROUTES.inventoryKits}?company=${encodeURIComponent(activeCompany)}`
      if (searchTerm.trim()) {
        url += `&search=${encodeURIComponent(searchTerm.trim())}`
      }
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Defensive normalization: ensure we only store proper kit objects
          const raw = data.data || []
          console.debug('fetchKits: raw response length', raw.length, raw)
          const normalized = []
          const seen = new Set()
          raw.forEach(k => {
            if (!k) return
            const newCode = k.new_item_code || k.name || k.item_code || ''
            const itemName = k.item_name || k.name || ''
            const itemsArr = Array.isArray(k.items) ? k.items : []
            // Only accept entries that look like kits (have a code or items)
            if (!newCode && itemsArr.length === 0) return
            // Use a stable key that prefers new_item_code and name to avoid
            // accidental deduping collisions (previously JSON.stringify(items) could
            // collide in some edge cases). Prefer newCode + name.
            const key = `${(String(newCode).trim()||'')}:${(String(k.name||'').trim()||'')}` || JSON.stringify(itemsArr)
            if (seen.has(key)) return
            seen.add(key)
            normalized.push({
              name: k.name || newCode,
              new_item_code: newCode,
              item_name: itemName,
              // Use exactly the kit-level `description` field from the API.
              // Do NOT fallback to item_name here — if the kit has no
              // `description`, leave it empty so the list shows nothing.
              description: k.description ? k.description.toString() : '',
              item_group: k.item_group || '',
              items: itemsArr,
              available_qty: k.available_qty ?? 0
            })
          })
          console.debug(`fetchKits: received ${raw.length} raw entries, normalized ${normalized.length} kits`, normalized.map(x => ({ name: x.name, available_qty: x.available_qty })))
          setKitList(normalized)
        }
      }
    } catch (error) {
      console.error('Error fetching kits:', error)
      showNotification('Error al cargar kits', 'error')
    } finally {
      setKitLoading(false)
    }
  }

  const fetchKitDetails = async (kitName) => {
    try {
      setKitDetailsLoading(true)
      const response = await fetchWithAuth(`${API_ROUTES.inventoryKitByName(kitName)}?company=${encodeURIComponent(activeCompany)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setKitDetails(data.data)
        }
      }
    } catch (error) {
      console.error('Error fetching kit details:', error)
      showNotification('Error al cargar detalles del kit', 'error')
    } finally {
      setKitDetailsLoading(false)
    }
  }

  const fetchItemDetails = async (itemCode) => {
    try {
      console.log('DEBUG: fetchItemDetails called for ->', itemCode)
      const companyParam = encodeURIComponent(activeCompany)
      const response = await fetchWithAuth(`${API_ROUTES.inventory}/items/${encodeURIComponent(itemCode)}?company=${companyParam}&include_bin_stock=1`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setItemDetails(data.data)

          // DEBUG + resolve: when clicking an item log the warehouse we received
          try {
            const itemData = data.data || {}
            const defaults = itemData.item_defaults || []
            let defaultWarehouseRaw = ''
            for (const d of defaults) {
              if (d.company === activeCompany) {
                defaultWarehouseRaw = d.default_warehouse || ''
                break
              }
            }

            console.log('DEBUG: fetched item default warehouse raw ->', defaultWarehouseRaw)

            if (defaultWarehouseRaw) {
              // Fetch company warehouses and try to resolve a friendly name
              try {
                const whData = await fetchWarehousesApi(fetchWithAuth, activeCompany)
                const flat = (whData && whData.flat) || []
                const norm = (s) => (s || '').toString().trim().toUpperCase()
                const nm = norm(defaultWarehouseRaw)

                let resolved = flat.find(w => norm(w.name) === nm || norm(w.warehouse_name) === nm || norm(w.display_name) === nm)

                if (!resolved && defaultWarehouseRaw.includes('__')) {
                  const basePrefix = defaultWarehouseRaw.split('__')[0].trim()
                  const baseNorm = norm(basePrefix)
                  resolved = flat.find(w => norm(w.name).includes(baseNorm) || norm(w.warehouse_name).includes(baseNorm) || norm(w.display_name).includes(baseNorm))
                }

                if (!resolved && defaultWarehouseRaw.includes(' - ')) {
                  const withoutAbbr = defaultWarehouseRaw.split(' - ').slice(0, -1).join(' - ').trim()
                  const withoutNorm = norm(withoutAbbr)
                  resolved = flat.find(w => norm(w.name) === withoutNorm || norm(w.warehouse_name) === withoutNorm || norm(w.display_name) === withoutNorm || norm(w.name).includes(withoutNorm))
                }

                console.log('DEBUG: resolved display warehouse for item default ->', resolved ? { name: resolved.name, warehouse_name: resolved.warehouse_name } : null)

                // Ensure the resolved warehouse appears in `warehouses` state so UI will display friendly name
                if (resolved) {
                  setWarehouses(prev => {
                    if ((prev || []).some(w => w.name === resolved.name)) return prev
                    return [...(prev || []), resolved]
                  })
                }
              } catch (e) {
                console.error('DEBUG: error fetching/resolve warehouses for item default', e)
              }
            }
          } catch (e) {
            console.error('DEBUG: error processing item default warehouse', e)
          }
        }
      }
    } catch (error) {
      console.error('Error fetching item details:', error)
      showNotification('Error al cargar detalles del item', 'error')
    }
  }

  // Función para cargar detalles de items visibles (solo cantidad disponible)
  const loadVisibleItemDetails = async (visibleItems) => {
    const itemsToLoad = visibleItems.filter(item => (
      item.is_stock_item && typeof itemDetailsCache[item.item_code] === 'undefined'
    ))
    

    if (itemsToLoad.length === 0) return

    try {
      const payload = {
        company: activeCompany,
        items: itemsToLoad.map(item => ({
          item_code: item.item_code,
          display_code: item.item_code,
          erp_item_code: item.erp_item_code || item.name || item.item_code
        }))
      }

      const response = await fetchWithAuth(`${API_ROUTES.inventory}/items/bulk-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const stockMap = data.data || {}
          setItemDetailsCache(prev => {
            const newCache = { ...prev }
            itemsToLoad.forEach(item => {
              const stockEntry = stockMap[item.item_code]
              newCache[item.item_code] = stockEntry ? Number(stockEntry.available_qty || 0) : 0
            })
            return newCache
          })
        }
      }
    } catch (error) {
      console.error('Error loading visible item details:', error)
    }
  }

  const fetchItemMovements = async (itemCode) => {
    try {
      const companyParam = encodeURIComponent(activeCompany)
      const response = await fetchWithAuth(`${API_ROUTES.inventory}/items/${encodeURIComponent(itemCode)}/movements?company=${companyParam}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Backend already filters by docstatus=1 and is_cancelled=0, no need to re-filter
          const movements = Array.isArray(data.data) ? data.data : []
          
          // Agregar reservas de stock como movimientos especiales
          const reservations = Array.isArray(data.reservations) ? data.reservations : []
          console.log('DEBUG: fetchItemMovements received ->', `${movements.length} movements, ${reservations.length} reservations`)
          
          // Combinar movimientos y reservas (las reservas van primero para destacarlas)
          const allMovements = [...reservations, ...movements]
          console.log('DEBUG: fetchItemMovements sample ->', allMovements.slice(0, 5))
          setItemMovements(allMovements)
        }
      }
    } catch (error) {
      console.error('Error fetching item movements:', error)
      showNotification('Error al cargar movimientos del item', 'error')
    }
  }

  const fetchKitMovements = async (kitCode) => {
    try {
      const companyParam = encodeURIComponent(activeCompany)
      const response = await fetchWithAuth(`${API_ROUTES.inventoryKitMovements(kitCode)}?company=${companyParam}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          console.log('DEBUG: fetchKitMovements received ->', Array.isArray(data.data) ? `${data.data.length} movements` : data.data)
          console.log('DEBUG: fetchKitMovements sample ->', (data.data || []).slice(0,5))
          setKitMovements(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching kit movements:', error)
      showNotification('Error al cargar movimientos del kit', 'error')
    }
  }

  // Abrir remito en modo edición (similar a SupplierPanel.openRemitoForEdit)
  const openRemitoForEdit = async (remitoName) => {
    if (!remitoName) return
    try {
      setSelectedRemito(remitoName)
      const response = await fetchWithAuth(API_ROUTES.remitoByName(remitoName))
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setRemitoDraftData(data.remito)
          setIsRemitoModalOpen(true)
        } else {
          showNotification(data.message || 'Error al cargar remito', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al cargar remito', 'error')
      }
    } catch (error) {
      console.error('Error opening remito for edit:', error)
      showNotification('Error al cargar remito', 'error')
    }
  }

  const openStockReconciliation = (recoName) => {
    if (!recoName) return
    setSelectedStockReconciliation(recoName)
    setIsStockReconciliationModalOpen(true)
  }

  // Cuando cambian los movimientos, construir la lista de almacenes donde
  // está presente el producto y obtener sus display names desde la API.
  useEffect(() => {
    const buildMovementWarehouses = async () => {
      if (!activeCompany) return
      if (!itemMovements || itemMovements.length === 0) {
        setWarehouses([])
        return
      }

      try {
        // Obtener todos los warehouses de la compañía (procesados por apiUtils)
        const whData = await fetchWarehousesApi(fetchWithAuth, activeCompany)
        const flat = (whData && whData.flat) || []
        const grouped = (whData && whData.grouped) || []

        const norm = (s) => (s || '').toString().trim().toUpperCase()
        const removeAbbr = (s) => {
          if (!s) return s
          if (s.includes(' - ')) {
            return s.split(' - ').slice(0, -1).join(' - ').trim()
          }
          return s
        }

        // Build a map from variant (normalized) -> base warehouse object (ownWarehouse)
        const variantToBase = new Map()
        try {
          grouped.forEach(group => {
            const base = group.ownWarehouse || null
            if (!base) return
            const addVariant = (v) => {
              if (!v) return
              try {
                variantToBase.set(norm(v.name), base)
                variantToBase.set(norm(v.warehouse_name || v.display_name || ''), base)
                // also map without company abbr if present
                variantToBase.set(norm(removeAbbr(v.name)), base)
                variantToBase.set(norm(removeAbbr(v.warehouse_name || v.display_name || '')), base)
              } catch (e) {}
            }
            ;(group.consignationWarehouses || []).forEach(addVariant)
            ;(group.vendorConsignationWarehouses || []).forEach(addVariant)
          })
        } catch (e) {
          console.error('DEBUG: error building variantToBase map', e)
        }
        try {
          // Log what grouped contained for diagnosis
          console.log('DEBUG: grouped warehouses summary ->', grouped.map(g => ({ base: g?.ownWarehouse?.name, consignationCount: (g.consignationWarehouses||[]).length, vendorConsignationCount: (g.vendorConsignationWarehouses||[]).length })))
          console.log('DEBUG: variantToBase keys ->', Array.from(variantToBase.keys()).slice(0,50))
          console.log('DEBUG: flat warehouse names ->', flat.map(w => ({ name: w.name, warehouse_name: w.warehouse_name })))
        } catch (e) {}

        // Extraer nombres únicos desde los movimientos (estos son los 'name' en backend)
        const names = Array.from(new Set(itemMovements.map(m => m.warehouse).filter(Boolean)))

  const matched = []
  const matchedInput = new Set()

        // Debug: log incoming movement warehouse names
        try {
          console.log('DEBUG: movement warehouse names for matching ->', names)
        } catch (e) {}

        for (const nm of names) {
          const nrm = norm(nm)

          // First, try direct variant -> base mapping from grouped data
          let found = null
          const variantBase = variantToBase.get(nrm) || variantToBase.get(norm(removeAbbr(nm)))
          if (variantBase) {
            // find the corresponding object in flat (match by name) or use base object directly
            found = flat.find(w => norm(w.name) === norm(variantBase.name)) || variantBase
            console.log('DEBUG: matched variant -> base for', nm, '->', found ? { name: found.name, warehouse_name: found.warehouse_name } : null)
          }

          // Additional heuristic: if tokenized variant includes company abbr suffix, try constructing base with that abbr
          if (!found && nm.includes('__') && nm.includes(' - ')) {
            try {
              const basePrefix = nm.split('__')[0].trim()
              const abbr = nm.split(' - ').slice(-1)[0].trim()
              if (basePrefix && abbr) {
                const candidate = `${basePrefix} - ${abbr}`
                const candNorm = norm(candidate)
                const baseFound = flat.find(w => norm(w.name) === candNorm || norm(w.warehouse_name) === candNorm || norm(w.display_name) === candNorm || norm(w.name).includes(candNorm))
                if (baseFound) {
                  found = baseFound
                  console.log('DEBUG: heuristic matched tokenized variant to base candidate ->', nm, '=>', candidate, '->', { name: baseFound.name, warehouse_name: baseFound.warehouse_name })
                }
              }
            } catch (e) {}
          }

          // Buscar coincidencia exacta por name o por warehouse_name/display_name
          if (!found) {
            found = flat.find(w => norm(w.name) === nrm || norm(w.warehouse_name) === nrm || norm(w.display_name) === nrm)
          }

          // Si no encontramos y el nombre tiene formato tokenizado, intentar emparejar por prefijo base
          if (!found && nm.includes('__')) {
            const basePrefix = nm.split('__')[0].trim()
            const baseNorm = norm(basePrefix)
            found = flat.find(w => norm(w.name).includes(baseNorm) || norm(w.warehouse_name).includes(baseNorm) || norm(w.display_name).includes(baseNorm))
          }

          // Si sigue sin coincidencia, intentar quitar posible sufijo ' - ABBR' y buscar
          if (!found && nm.includes(' - ')) {
            const withoutAbbr = nm.split(' - ').slice(0, -1).join(' - ').trim()
            const withoutNorm = norm(withoutAbbr)
            found = flat.find(w => norm(w.name) === withoutNorm || norm(w.warehouse_name) === withoutNorm || norm(w.display_name) === withoutNorm || norm(w.name).includes(withoutNorm))
          }

          if (found) {
            matched.push(found)
            matchedInput.add(nm)
          }
        }

        // Warehouses encontrados (únicos por name)
        const uniqueByName = []
        const seen = new Set()
        for (const w of matched) {
          if (!seen.has(w.name)) {
            uniqueByName.push(w)
            seen.add(w.name)
          }
        }

        // Fallback para inputs no encontrados
        const missing = names.filter(n => !matchedInput.has(n))
        const fallback = missing.map(n => ({ name: n, warehouse_name: n }))

        // Debug: mostrar coincidencias y fallbacks antes de setear
        try {
          console.log('DEBUG: matched warehouses for movements ->', uniqueByName.map(w => ({ name: w.name, warehouse_name: w.warehouse_name })))
          console.log('DEBUG: missing movement names (no match) ->', missing)
          console.log('DEBUG: fallback entries ->', fallback)
        } catch (e) {}

        setWarehouses([...uniqueByName, ...fallback])
      } catch (error) {
        console.error('Error building movement warehouses:', error)
        // En caso de falla, generar mapeo simple con los nombres crudos
        const names = Array.from(new Set(itemMovements.map(m => m.warehouse).filter(Boolean)))
        setWarehouses(names.map(n => ({ name: n, warehouse_name: n })))
      }
    }

    buildMovementWarehouses()
  }, [itemMovements, activeCompany, fetchWithAuth])

  // Build warehouses mapping for kit movements (same logic as items)
  useEffect(() => {
    const buildKitMovementWarehouses = async () => {
      if (!activeCompany) return
      if (!kitMovements || kitMovements.length === 0) {
        setKitWarehouses([])
        return
      }

      try {
        const whData = await fetchWarehousesApi(fetchWithAuth, activeCompany)
        const flat = (whData && whData.flat) || []
        const grouped = (whData && whData.grouped) || []

        const norm = (s) => (s || '').toString().trim().toUpperCase()
        const removeAbbr = (s) => {
          if (!s) return s
          if (s.includes(' - ')) {
            return s.split(' - ').slice(0, -1).join(' - ').trim()
          }
          return s
        }

        const variantToBase = new Map()
        try {
          grouped.forEach(group => {
            const base = group.ownWarehouse || null
            if (!base) return
            const addVariant = (v) => {
              if (!v) return
              try {
                variantToBase.set(norm(v.name), base)
                variantToBase.set(norm(v.warehouse_name || v.display_name || ''), base)
                variantToBase.set(norm(removeAbbr(v.name)), base)
                variantToBase.set(norm(removeAbbr(v.warehouse_name || v.display_name || '')), base)
              } catch (e) {}
            }
            ;(group.consignationWarehouses || []).forEach(addVariant)
            ;(group.vendorConsignationWarehouses || []).forEach(addVariant)
          })
        } catch (e) {
          console.error('DEBUG: error building variantToBase map for kits', e)
        }

        const names = Array.from(new Set(kitMovements.map(m => m.warehouse).filter(Boolean)))

        const matched = []
        const matchedInput = new Set()

        for (const nm of names) {
          const nrm = norm(nm)

          let found = null
          const variantBase = variantToBase.get(nrm) || variantToBase.get(norm(removeAbbr(nm)))
          if (variantBase) {
            found = flat.find(w => norm(w.name) === norm(variantBase.name)) || variantBase
          }

          if (!found && nm.includes('__') && nm.includes(' - ')) {
            try {
              const basePrefix = nm.split('__')[0].trim()
              const abbr = nm.split(' - ').slice(-1)[0].trim()
              if (basePrefix && abbr) {
                const candidate = `${basePrefix} - ${abbr}`
                const candNorm = norm(candidate)
                const baseFound = flat.find(w => norm(w.name) === candNorm || norm(w.warehouse_name) === candNorm || norm(w.display_name) === candNorm || norm(w.name).includes(candNorm))
                if (baseFound) {
                  found = baseFound
                }
              }
            } catch (e) {}
          }

          if (!found) {
            found = flat.find(w => norm(w.name) === nrm || norm(w.warehouse_name) === nrm || norm(w.display_name) === nrm)
          }

          if (!found && nm.includes('__')) {
            const basePrefix = nm.split('__')[0].trim()
            const baseNorm = norm(basePrefix)
            found = flat.find(w => norm(w.name).includes(baseNorm) || norm(w.warehouse_name).includes(baseNorm) || norm(w.display_name).includes(baseNorm))
          }

          if (!found && nm.includes(' - ')) {
            const withoutAbbr = nm.split(' - ').slice(0, -1).join(' - ').trim()
            const withoutNorm = norm(withoutAbbr)
            found = flat.find(w => norm(w.name) === withoutNorm || norm(w.warehouse_name) === withoutNorm || norm(w.display_name) === withoutNorm || norm(w.name).includes(withoutNorm))
          }

          if (found) {
            matched.push(found)
            matchedInput.add(nm)
          }
        }

        const uniqueByName = []
        const seen = new Set()
        for (const w of matched) {
          if (!seen.has(w.name)) {
            uniqueByName.push(w)
            seen.add(w.name)
          }
        }

        const missing = names.filter(n => !matchedInput.has(n))
        const fallback = missing.map(n => ({ name: n, warehouse_name: n }))

        setKitWarehouses([...uniqueByName, ...fallback])
      } catch (error) {
        console.error('Error building kit movement warehouses:', error)
        const names = Array.from(new Set(kitMovements.map(m => m.warehouse).filter(Boolean)))
        setKitWarehouses(names.map(n => ({ name: n, warehouse_name: n })))
      }
    }

    buildKitMovementWarehouses()
  }, [kitMovements, activeCompany, fetchWithAuth])

  const fetchWarehouseTabs = async () => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.stockWarehouseTabs}?company=${encodeURIComponent(activeCompany)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setWarehouseTabs(data.data || [])
          // Si no hay tab seleccionado, seleccionar el primero
          if (data.data && data.data.length > 0 && !selectedWarehouseTab) {
            setSelectedWarehouseTab(data.data[0].base_code)
          }
        }
      }
    } catch (error) {
      console.error('Error fetching warehouse tabs:', error)
    }
  }

  const fetchWarehouseTabItems = async (baseCode) => {
    if (!baseCode) return

    try {
      const response = await fetchWithAuth(`${API_ROUTES.stockWarehouseTabItems}/${encodeURIComponent(baseCode)}?company=${encodeURIComponent(activeCompany)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setWarehouseTabItems(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching warehouse tab items:', error)
    }
  }

  const fetchItemGroups = async () => {
    try {
      // Request item groups passing the active company so backend can return cleaned names
      const response = await fetchWithAuth(`${API_ROUTES.itemGroups}?company=${encodeURIComponent(activeCompany)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // data.data may be an array of strings (cleaned names) or array of objects
          const raw = data.data || []
          let leafGroups = []
          if (raw.length > 0 && typeof raw[0] === 'string') {
            // Backend returned cleaned names as strings
            leafGroups = raw.map(name => ({ name, item_group_name: name }))
          } else {
            // Backend returned objects; keep leaf groups and normalize item_group_name
            leafGroups = raw.filter(group => !group.is_group).map(group => ({ ...group, item_group_name: extractItemGroupName(group) }))
          }
          setItemGroups(leafGroups || [])
        }
      }
    } catch (error) {
      console.error('Error fetching item groups:', error)
    }
  }

  const fetchBrands = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.brands)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setBrands(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching brands:', error)
    }
  }

  const createBrand = async (brandName) => {
    try {
      const response = await fetchWithAuth(API_ROUTES.brands, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand: brandName,
          description: `Marca creada automáticamente desde inventario`
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Recargar marcas para incluir la nueva
          await fetchBrands()
          return data.data
        }
      }
      return null
    } catch (error) {
      console.error('Error creating brand:', error)
      return null
    }
  }

  const createItemGroup = async (groupName) => {
    try {
      // Obtener la abreviatura de la compañía
      let companyAbbr = ''
      if (companyDefaults?.abbr) {
        companyAbbr = companyDefaults.abbr
      } else {
        // Intentar obtenerla desde la API
        try {
          const companyResponse = await fetchWithAuth(`${API_ROUTES.companies}/companies/${encodeURIComponent(activeCompany)}`)
          if (companyResponse.ok) {
            const companyData = await companyResponse.json()
            if (companyData.success && companyData.data?.abbr) {
              companyAbbr = companyData.data.abbr
            }
          }
        } catch (error) {
          console.error('Error fetching company abbr:', error)
        }
      }

      const fullGroupName = companyAbbr ? `${groupName} - ${companyAbbr}` : groupName

      const response = await fetchWithAuth(`${API_ROUTES.itemGroups}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item_group_name: fullGroupName,
          parent_item_group: 'All Item Groups',
          is_group: 0,
          custom_company: activeCompany
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Recargar grupos para incluir el nuevo
          await fetchItemGroups()
          return { name: data.data.name, item_group_name: fullGroupName }
        }
      }
      return null
    } catch (error) {
      console.error('Error creating item group:', error)
      return null
    }
  }

  const fetchUoms = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.uoms)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setUoms(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching UOMs:', error)
    }
  }

  const fetchAvailableAccounts = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.accounts)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Filtrar cuentas de gastos (Expense)
          const expenseAccounts = data.data.filter(account => 
            account.root_type === 'Expense' && !account.is_group
          )
          setAvailableExpenseAccounts(expenseAccounts || [])
          
          // Filtrar cuentas de ingresos (Income)
          const incomeAccounts = data.data.filter(account => 
            account.root_type === 'Income' && !account.is_group
          )
          setAvailableIncomeAccounts(incomeAccounts || [])
          
          // Filtrar cuentas de activos para costo de producto
          const assetAccounts = data.data.filter(account => 
            account.root_type === 'Asset' && !account.is_group
          )
          setAvailableAssetAccounts(assetAccounts || [])
        }
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
  }

  // Tax templates are provided by the shared `useTaxTemplates` hook above.

  const fetchCompanyDefaults = async () => {
    if (!activeCompany) return
    
    try {
      const response = await fetchWithAuth(`${API_ROUTES.companies}/companies/${encodeURIComponent(activeCompany)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data) {
          setCompanyDefaults(data.data)
        }
      }
    } catch (error) {
      console.error('Error fetching company defaults:', error)
    }
  }

  const fetchDefaultTabPreference = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.inventoryTabPreference)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const defaultTab = data.data.default_tab
          setDefaultItemTypeTab(defaultTab)
          setItemTypeTab(defaultTab)
        }
      }
    } catch (error) {
      console.error('Error fetching tab preference:', error)
      // Si hay error, usar valor por defecto
      setDefaultItemTypeTab('services')
      setItemTypeTab('services')
    }
  }

  const saveDefaultTabPreference = async (tab) => {
    try {
      const response = await fetchWithAuth(API_ROUTES.inventoryTabPreference, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_tab: tab })
      })
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setDefaultItemTypeTab(tab)
          showNotification(`Tab por defecto guardado: ${tab === 'products' ? 'Productos' : 'Servicios'}`, 'success')
        }
      }
    } catch (error) {
      console.error('Error saving tab preference:', error)
      showNotification('Error al guardar preferencia de tab', 'error')
    }
  }

  const toggleDefaultTab = () => {
    const newDefaultTab = itemTypeTab
    saveDefaultTabPreference(newDefaultTab)
  }

  const filterItems = (items, searchTerm) => {
    if (!searchTerm) return items
    return items.filter(item =>
      (item.item_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.item_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.description || '').toLowerCase().includes(searchTerm.toLowerCase())
    )
  }

  const filterItemsByType = (items, type) => {
    if (type === 'products') {
      return items.filter(item => item.is_stock_item === 1)
    } else if (type === 'kits') {
      return kitList
    } else {
      return items.filter(item => item.is_stock_item === 0)
    }
  }

  // Función para aplicar filtros adicionales (por columna)
  const applyColumnFilters = (items) => {
    return items.filter(item => {
      // Filtro por código: support item_code (items) and new_item_code/name (kits)
      if (filters.item_code) {
        const codeToCheck = extractItemCodeDisplay(item.item_code || item.new_item_code || item.name || '')
        if (!codeToCheck.toLowerCase().includes(filters.item_code.toLowerCase())) {
          return false
        }
      }
      // Filtro por descripción
      const descToCheck = (item.item_name || item.description || item.new_item_code || item.name || '')
      if (filters.description && !descToCheck.toLowerCase().includes(filters.description.toLowerCase())) {
        return false
      }
      return true
    })
  }

  // Función para ordenar items
  const sortItems = (items) => {
    return [...items].sort((a, b) => {
      let aValue, bValue

      switch (sortField) {
        case 'item_code':
          aValue = extractItemCodeDisplay(a.item_code).toLowerCase()
          bValue = extractItemCodeDisplay(b.item_code).toLowerCase()
          break
        case 'description':
          aValue = (a.item_name || a.description || '').toLowerCase()
          bValue = (b.item_name || b.description || '').toLowerCase()
          break
        default:
          return 0
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }

  // Función para obtener items filtrados, ordenados y paginados
  const getPaginatedItems = () => {
    let filtered
    if (mainTab === 'kits') {
      // Para kits, trabajar directamente con kitList sin filtros de is_stock_item
      filtered = filterItems(kitList, kitSearch)
      filtered = applyColumnFilters(filtered)
      filtered = sortItems(filtered)
    } else {
      // Para items, usar la lógica existente
      filtered = filterItemsByType(filterItems(items, itemSearch), itemTypeTab)
      filtered = applyColumnFilters(filtered)
      filtered = sortItems(filtered)
    }
    
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return {
      items: filtered.slice(startIndex, endIndex),
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / itemsPerPage)
    }
  }

  // Función para manejar cambio de página
  const handlePageChange = (page) => {
    setCurrentPage(page)
  }

  const handleItemTypeTabChange = (newTab) => {
    if (newTab === 'kits') {
      // Cambiar a la vista de kits
      setMainTab('kits')
      setItemTypeTab('kits')
      setCurrentPage(1)
      setItemSearch('')
      setKitSearch('')
      // Asegurar que no se mezclen filtros
      setFilters({
        item_code: '',
        description: ''
      })
    } else {
      // Cambiar a la vista de items (productos/servicios)
      setMainTab('items')
      setItemTypeTab(newTab)
      setCurrentPage(1)
      // limpiar búsquedas/estado relacionado con kits
      setKitSearch('')
      // Resetear filtros para que la lista muestre contenido correcto
      setFilters({
        item_code: '',
        description: ''
      })
    }
  }

  // Función para manejar búsqueda (resetea a página 1 y busca en backend)
  const handleSearchChange = async (searchTerm) => {
    setItemSearch(searchTerm)
    setCurrentPage(1) // Resetear a primera página cuando se busca
    
    // Si hay búsqueda, hacer consulta al backend
    if (searchTerm.trim()) {
      await fetchItems(searchTerm.trim())
    } else {
      // Si no hay búsqueda, recargar todos los items
      await fetchItems()
    }
  }

  // Bulk delete helpers
  const toggleBulkMode = async () => {
    if (!bulkModeActive) {
      // enter selection mode
      setSelectedForDelete(new Set())
      setBulkModeActive(true)
      return
    }

    // If already active: if none selected -> cancel mode; otherwise confirm deletion
    if (selectedForDelete.size === 0) {
      setBulkModeActive(false)
      return
    }

    const entityLabel = mainTab === 'kits' ? 'kits' : 'items'
    const confirmed = await confirm({
      title: `Eliminar ${entityLabel}`,
      message: `¿Estás seguro de eliminar ${selectedForDelete.size} ${entityLabel}? Esta acción es irreversible.`,
      type: 'error',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar'
    })

    if (!confirmed) return
    await handleBulkDelete()
  }

  const onToggleSelectItemLocal = (reactKey) => {
    setSelectedForDelete(prev => {
      const clone = new Set(prev)
      if (clone.has(reactKey)) clone.delete(reactKey)
      else clone.add(reactKey)
      return clone
    })
  }

  const onToggleSelectAllLocal = (checked) => {
    if (!checked) {
      setSelectedForDelete(new Set())
      return
    }
    // select all visible items on current page
    const { items: visible } = getPaginatedItems()
    const s = new Set()
    visible.forEach(it => {
      const key = it.erp_item_code || it.name || it.item_code || ''
      if (key) s.add(key)
    })
    setSelectedForDelete(s)
  }

  const handleBulkDelete = async () => {
    if (!activeCompany) {
      showNotification('No hay compañía activa', 'error')
      return
    }

    const codes = Array.from(selectedForDelete)
    if (!codes.length) {
      const emptyLabel = mainTab === 'kits' ? 'kits' : 'items'
      showNotification(`No hay ${emptyLabel} seleccionados`, 'warning')
      setBulkModeActive(false)
      return
    }

    if (mainTab === 'kits') {
      const kitLookup = new Map()
      kitList.forEach(kit => {
        const keys = [kit?.name, kit?.new_item_code, kit?.item_code]
        keys.forEach(key => {
          if (key) {
            kitLookup.set(key, kit)
          }
        })
      })

      const deletedNames = new Set()
      const failures = []
      for (const identifier of codes) {
        const kitData = kitLookup.get(identifier)
        if (!kitData) {
          failures.push({ kit: identifier, message: 'Kit no encontrado en la lista actual' })
          continue
        }

        const targetName = kitData.name || identifier
        try {
          const resp = await fetchWithAuth(API_ROUTES.inventoryKitByName(targetName), { method: 'DELETE' })
          if (resp && resp.ok) {
            deletedNames.add(targetName)
          } else {
            let errorMessage = ''
            try {
              const errPayload = await resp.json()
              errorMessage = errPayload.message || errPayload.error || ''
            } catch (err) {
              errorMessage = resp?.statusText || ''
            }
            failures.push({ kit: targetName, message: errorMessage || 'Error al eliminar kit' })
          }
        } catch (err) {
          failures.push({ kit: targetName, message: err.message })
        }
      }

      if (deletedNames.size > 0) {
        setKitList(prev => prev.filter(kit => !deletedNames.has(kit.name)))
        const selectedKitDocName = selectedKit ? (kitLookup.get(selectedKit)?.name || selectedKit) : null
        if (selectedKitDocName && deletedNames.has(selectedKitDocName)) {
          setSelectedKit(null)
          setKitDetails(null)
          setKitMovements([])
          setIsEditingKit(false)
          setEditedKitData({})
        }
        setBulkModeActive(false)
        setSelectedForDelete(new Set())
      }

      if (deletedNames.size > 0 && failures.length === 0) {
        showNotification(`${deletedNames.size} kits eliminados exitosamente`, 'success')
      } else if (deletedNames.size > 0 && failures.length > 0) {
        showNotification(`${deletedNames.size} kits eliminados. ${failures.length} no se pudieron eliminar.`, 'warning')
      } else {
        showNotification('No se pudieron eliminar los kits seleccionados', 'error')
      }

      return
    }

    try {
      const payload = { company: activeCompany, item_codes: codes }
      const resp = await fetchWithAuth(API_ROUTES.bulkDeleteItems, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!resp || !resp.ok) {
        const text = resp ? await resp.text() : 'No response'
        showNotification(`Error borrando items: ${text}`, 'error')
        return
      }

      const data = await resp.json()
      if (data && data.success) {
        const deleted = new Set()
        const failed = []
        if (data.data && data.data.results) {
          data.data.results.forEach(r => {
            if (r.success) deleted.add(r.item)
            else failed.push(r)
          })
        }

        // Remove deleted items from local list
        if (deleted.size > 0) {
          setItems(prev => prev.filter(it => {
            const key = it.erp_item_code || it.name || it.item_code || ''
            if (!key) return true
            if (deleted.has(key)) return false
            return true
          }))
        }

        setBulkModeActive(false)
        setSelectedForDelete(new Set())

        if (failed.length > 0) {
          showNotification(`${data.data.deleted_count || 0} items eliminados. ${failed.length} fallaron. Ver logs`, 'warning')
        } else {
          showNotification(`${data.data.deleted_count || 0} items eliminados exitosamente`, 'success')
        }
      } else {
        showNotification('No fue posible borrar los items', 'error')
      }
    } catch (e) {
      console.error('bulk delete failed', e)
      showNotification('Error interno procesando borrado masivo', 'error')
    }
  }

  const handleAddKit = () => {
    setSelectedKit('new')
    setIsEditingKit(true)
    // Use 'description' as the kit name — no categories for kits
    setEditedKitData({
      new_item_code: '',
      item_name: '',
      description: '',
      item_group: '',
      brand: '',
      __isNewItemGroup: false,
      items: [
        { item_code: '', qty: 1, uom: 'Unit' },
        { item_code: '', qty: 1, uom: 'Unit' }
      ]
    })
  }

  const handleAddItem = () => {
    setSelectedItem('new')
    setIsEditingItem(true)
    // Configurar is_stock_item según el tab activo
    const isStockItem = itemTypeTab === 'products' ? 1 : 0
    setEditedItemData({
      item_code: '',
      item_name: '',
      item_group: 'Services',
      stock_uom: 'Unit',
      is_stock_item: isStockItem,
      description: '',
      standard_rate: 0,
      valuation_rate: 0,
      company: activeCompany,
      brand: '',
      // Usar cuentas por defecto de la configuración de la compañía
      expense_account: companyDefaults?.default_purchase_account || '',
      income_account: companyDefaults?.default_sales_account || '',
      cost_of_goods_sold_account: companyDefaults?.default_cost_of_goods_sold_account || '',
      // Campos adicionales
      is_sales_item: 1,
      is_purchase_item: 1,
      grant_commission: 1,
      min_order_qty: 0,
      safety_stock: 0,
      lead_time_days: 0,
      max_discount: 0
    })
  }

  const handleSelectItem = (itemCode) => {
    if (itemTypeTab === 'kits') {
      setSelectedKit(itemCode)
      setSelectedItem(null)
      setItemDetails(null)
      setItemMovements([])
      setKitMovements([])
      // Limpiar estados de edición de kits
      setIsEditingKit(false)
      setEditedKitData({})
      // Cargar movimientos del kit si no es 'new'
      if (itemCode && itemCode !== 'new') {
        fetchKitMovements(itemCode)
      }
    } else {
      setSelectedItem(itemCode)
      setSelectedKit(null)
      setKitDetails(null)
      setKitMovements([])
      // Limpiar estados de edición de items
      setIsEditingItem(false)
      setEditedItemData({})
      // Cargar movimientos del item si no es 'new'
      if (itemCode && itemCode !== 'new') {
        fetchItemMovements(itemCode)
      }
    }
  }

  const handleEditItem = () => {
    if (!itemDetails) return
    setIsEditingItem(true)
    
    // Extraer configuraciones de la compañía actual
    const companyDefault = itemDetails.item_defaults?.find(
      def => def.company === activeCompany
    ) || {}
    
    // Inferir la tasa de IVA actual
    const currentIvaRate = inferIvaRateFromItem(itemDetails)
    
    setEditedItemData({
      ...itemDetails,
      // Limpiar códigos para mostrar en el formulario
      item_code: extractItemCodeDisplay(itemDetails.item_code),
      expense_account: companyDefault.expense_account || '',
      income_account: companyDefault.income_account || '',
      default_warehouse: companyDefault.default_warehouse || '',
      company: activeCompany,
      brand: itemDetails.brand || '',
      // Asegurar valores por defecto para campos numéricos
      is_sales_item: itemDetails.is_sales_item ?? 1,
      is_purchase_item: itemDetails.is_purchase_item ?? 1,
      grant_commission: itemDetails.grant_commission ?? 0,
      min_order_qty: itemDetails.min_order_qty ?? 0,
      safety_stock: itemDetails.safety_stock ?? 0,
      lead_time_days: itemDetails.lead_time_days ?? 0,
      max_discount: itemDetails.max_discount ?? 0,
      // Setear la tasa de IVA inferida
      iva_percent: currentIvaRate
    })
  }

  const handleCancelEdit = () => {
    setIsEditingItem(false)
    setEditedItemData({})
    if (selectedItem === 'new') {
      setSelectedItem(null)
    }
  }

  const handleEditChange = (field, value) => {
    setEditedItemData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleCreateItem = async () => {
    try {
      setSavingItem(true)
      
      // Validaciones básicas
      if (!editedItemData.item_code || !editedItemData.item_name) {
        showNotification('Por favor complete los campos obligatorios', 'error')
        return
      }

      // Construir item_defaults para el nuevo item
      const itemDefaults = [{
        company: activeCompany,
        expense_account: editedItemData.expense_account,
        income_account: editedItemData.income_account,
        default_warehouse: editedItemData.default_warehouse
      }]

      const payload = {
        ...editedItemData,
        item_defaults: itemDefaults
      }

      const response = await fetchWithAuth(`${API_ROUTES.inventory}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Item creado exitosamente', 'success')
          await fetchItems()
          setSelectedItem(data.data.item_code)
          setIsEditingItem(false)
          setEditedItemData({})
        } else {
          showNotification(data.message || 'Error al crear item', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al crear item', 'error')
      }
    } catch (error) {
      console.error('Error creating item:', error)
      showNotification('Error al crear item', 'error')
    } finally {
      setSavingItem(false)
    }
  }

  const handleSaveItem = async () => {
    try {
      setSavingItem(true)

      // Construir item_defaults actualizado
      const existingDefaults = itemDetails.item_defaults || []
      const updatedDefaults = existingDefaults.map(def => 
        def.company === activeCompany 
          ? { 
              ...def, 
              expense_account: editedItemData.expense_account,
              income_account: editedItemData.income_account,
              default_warehouse: editedItemData.default_warehouse
            }
          : def
      )

      // Si no existe para la compañía, agregarlo
      const companyDefaultExists = updatedDefaults.some(def => def.company === activeCompany)
      if (!companyDefaultExists) {
        updatedDefaults.push({
          company: activeCompany,
          expense_account: editedItemData.expense_account,
          income_account: editedItemData.income_account,
          default_warehouse: editedItemData.default_warehouse
        })
      }

      const payload = {
        ...editedItemData,
        item_defaults: updatedDefaults
      }

      const response = await fetchWithAuth(`${API_ROUTES.inventory}/items/${encodeURIComponent(selectedItem)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Item actualizado exitosamente', 'success')
          await fetchItems()
          await fetchItemDetails(selectedItem)
          setIsEditingItem(false)
          setEditedItemData({})
        } else {
          showNotification(data.message || 'Error al actualizar item', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al actualizar item', 'error')
      }
    } catch (error) {
      console.error('Error updating item:', error)
      showNotification('Error al actualizar item', 'error')
    } finally {
      setSavingItem(false)
    }
  }

  const handleDeleteItem = async () => {
    const confirmed = await confirm({
      title: 'Eliminar Item',
      message: `¿Estás seguro de que deseas eliminar el item ${selectedItem}? Esta acción no se puede deshacer.`
    })

    if (!confirmed) return

    try {
      const response = await fetchWithAuth(`${API_ROUTES.inventory}/items/${encodeURIComponent(selectedItem)}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        showNotification('Item eliminado exitosamente', 'success')
        await fetchItems()
        setSelectedItem(null)
        setItemDetails(null)
        setItemMovements([])
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al eliminar item', 'error')
      }
    } catch (error) {
      console.error('Error deleting item:', error)
      showNotification('Error al eliminar item', 'error')
    }
  }

  const handleDeleteKit = async () => {
    const confirmed = await confirm({
      title: 'Eliminar Kit',
      message: `¿Estás seguro de que deseas eliminar el kit ${selectedKit}? Esta acción no se puede deshacer.`
    })

    if (!confirmed) return

    try {
      const response = await fetchWithAuth(API_ROUTES.inventoryKitByName(selectedKit), {
        method: 'DELETE'
      })

      if (response.ok) {
        showNotification('Kit eliminado exitosamente', 'success')
        await fetchKits()
        setSelectedKit(null)
        setKitDetails(null)
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al eliminar kit', 'error')
      }
    } catch (error) {
      console.error('Error deleting kit:', error)
      showNotification('Error al eliminar kit', 'error')
    }
  }

  const handleUomAdded = async (newUom) => {
    // Recargar las UOMs para incluir la nueva
    await fetchUoms()
    // Opcionalmente, seleccionar la nueva UOM en el formulario si estamos editando
    if (isEditingItem) {
      setEditedItemData(prev => ({
        ...prev,
        stock_uom: newUom.name
      }))
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top-level toggles removed: use the lower tabs (Servicios / Productos / Kits) */}
      <div className="mb-6" />

      {/* Contenido según tab seleccionado */}
      {mainTab === 'items' ? (
        <div className="flex gap-6" style={{ height: 'calc(110vh - 180px)' }}>
          <ItemListPanel
            items={items}
            loading={loading}
            itemSearch={itemSearch}
            itemTypeTab={itemTypeTab}
            defaultItemTypeTab={defaultItemTypeTab}
            warehouseTabs={warehouseTabs}
            selectedWarehouseTab={selectedWarehouseTab}
            warehouseTabItems={warehouseTabItems}
            sortField={sortField}
            sortDirection={sortDirection}
            filters={filters}
            currentPage={currentPage}
            itemsPerPage={itemsPerPage}
            selectedItem={selectedItem}
            itemDetailsCache={itemDetailsCache}
            warehouses={warehouses}
            handleSearchChange={handleSearchChange}
            setItemTypeTab={handleItemTypeTabChange}
            toggleDefaultTab={toggleDefaultTab}
            setSelectedWarehouseTab={setSelectedWarehouseTab}
            handleSort={handleSort}
            handleFilterChange={handleFilterChange}
            handlePageChange={handlePageChange}
            setSelectedItem={setSelectedItem}
            handleAddItem={handleAddItem}
            getPaginatedItems={getPaginatedItems}
            // bulk delete props
            bulkModeActive={bulkModeActive}
            onToggleBulkMode={toggleBulkMode}
            selectedForDelete={selectedForDelete}
            onToggleSelectItem={onToggleSelectItemLocal}
            onToggleSelectAll={onToggleSelectAllLocal}
            onBulkDelete={handleBulkDelete}
            // warehouse transfer prop
            onOpenWarehouseTransfer={() => setIsWarehouseTransferModalOpen(true)}
          />

          {/* Panel derecho - Detalles y movimientos */}
          <div className="flex-1 flex flex-col gap-6 min-w-0">
            {/* Detalles del item - Arriba derecha */}
            <ItemDetailsPanel
              selectedItem={selectedItem}
              itemDetails={itemDetails}
              isEditingItem={isEditingItem}
              editedItemData={editedItemData}
              savingItem={savingItem}
              itemTab={itemTab}
              setItemTab={setItemTab}
              handleEditItem={handleEditItem}
              handleCancelEdit={handleCancelEdit}
              handleSaveItem={handleSaveItem}
              handleCreateItem={handleCreateItem}
              handleEditChange={handleEditChange}
              handleDeleteItem={handleDeleteItem}
              itemGroups={itemGroups}
              brands={brands}
              uoms={uoms}
              warehouses={warehouses}
              availableExpenseAccounts={availableExpenseAccounts}
              availableIncomeAccounts={availableIncomeAccounts}
              availableAssetAccounts={availableAssetAccounts}
              createBrand={createBrand}
              createItemGroup={createItemGroup}
              setIsUomModalOpen={setIsUomModalOpen}
              activeCompany={activeCompany}
              companyDefaults={companyDefaults}
              extractItemCodeDisplay={extractItemCodeDisplay}
              extractAccountName={extractAccountName}
              extractItemGroupName={extractItemGroupName}
              getPlatformStyle={getPlatformStyle}
              taxSales={taxSales}
              taxPurchase={taxPurchase}
              rateToTemplateMap={rateToTemplateMap}
            />

            {/* Movimientos de inventario - Abajo derecha */}
            <ItemMovementsPanel
              selectedItem={selectedItem}
              itemMovements={itemMovements}
              movementWarehouseTab={movementWarehouseTab}
              warehouses={warehouses}
              setMovementWarehouseTab={setMovementWarehouseTab}
              openRemitoForEdit={openRemitoForEdit}
              openStockReconciliation={openStockReconciliation}
            />
          </div>

          {/* Remito modal para abrir el remito asociado a un movimiento */}
          <RemitoModal
            isOpen={isRemitoModalOpen}
            onClose={() => {
              setIsRemitoModalOpen(false)
              setSelectedRemito(null)
              setRemitoDraftData(null)
            }}
            activeCompany={activeCompany}
            fetchWithAuth={fetchWithAuth}
              showNotification={showNotification}
              onDeleteKit={handleDeleteKit}
            selectedRemito={selectedRemito}
            remitoDraftData={remitoDraftData}
            // También pasar los nombres que RemitoModal espera
            selectedRemitoName={selectedRemito}
            initialRemitoData={remitoDraftData}
            onSaved={async () => {
              // Refrescar movimientos del item después de guardar (si hay item seleccionado)
              if (selectedItem) await fetchItemMovements(selectedItem)
              setSelectedRemito(null)
              setRemitoDraftData(null)
              setIsRemitoModalOpen(false)
            }}
          />
          <StockReconciliationModal
            isOpen={isStockReconciliationModalOpen}
            onClose={() => {
              setIsStockReconciliationModalOpen(false)
              setSelectedStockReconciliation(null)
            }}
            reconciliationName={selectedStockReconciliation}
            fetchWithAuth={fetchWithAuth}
            confirm={confirm}
            showNotification={showNotification}
            onCancelled={async () => {
              if (selectedItem) await fetchItemMovements(selectedItem)
            }}
          />
          <UomModal
            isOpen={isUomModalOpen}
            onClose={() => setIsUomModalOpen(false)}
            onUomAdded={handleUomAdded}
          />
          <WarehouseTransferModal
            isOpen={isWarehouseTransferModalOpen}
            onClose={() => setIsWarehouseTransferModalOpen(false)}
            activeCompany={activeCompany}
            onTransferComplete={() => {
              // Refrescar items y movimientos después de una transferencia
              fetchItems()
              if (selectedItem) fetchItemMovements(selectedItem)
            }}
          />
        </div>
      ) : (
        <div className="flex gap-6" style={{ height: 'calc(100vh - 180px)' }}>
          <ItemListPanel
            items={kitList}
            loading={kitLoading}
            itemSearch={kitSearch}
            itemTypeTab={itemTypeTab}
            defaultItemTypeTab={defaultItemTypeTab}
            warehouseTabs={[]}
            selectedWarehouseTab={null}
            warehouseTabItems={[]}
            sortField={sortField}
            sortDirection={sortDirection}
            filters={filters}
            currentPage={currentPage}
            itemsPerPage={itemsPerPage}
            selectedItem={selectedKit}
            itemDetailsCache={{}}
            warehouses={warehouses}
            handleSearchChange={(searchTerm) => {
              setKitSearch(searchTerm)
              setCurrentPage(1)
              if (searchTerm.trim()) {
                fetchKits(searchTerm.trim())
              } else {
                fetchKits()
              }
            }}
            setItemTypeTab={handleItemTypeTabChange}
            toggleDefaultTab={toggleDefaultTab}
            setSelectedWarehouseTab={() => {}}
            handleSort={handleSort}
            handleFilterChange={handleFilterChange}
            handlePageChange={handlePageChange}
            setSelectedItem={handleSelectItem}
            handleAddItem={handleAddKit}
            getPaginatedItems={getPaginatedItems}
            isKitMode={true}
            bulkModeActive={bulkModeActive}
            onToggleBulkMode={toggleBulkMode}
            selectedForDelete={selectedForDelete}
            onToggleSelectItem={onToggleSelectItemLocal}
            onToggleSelectAll={onToggleSelectAllLocal}
            onBulkDelete={handleBulkDelete}
          />

          {/* Panel derecho - Detalles y movimientos del kit */}
          <div className="flex-1 flex flex-col gap-6 min-w-0">
            {/* Detalles del kit - Arriba derecha */}
            <KitDetailsPanel
              selectedKit={selectedKit}
              kitDetails={kitDetails}
              isEditingKit={isEditingKit}
              setIsEditingKit={setIsEditingKit}
              editedKitData={editedKitData}
              setEditedKitData={setEditedKitData}
              onDeleteKit={handleDeleteKit}
              onSaveKit={async (kitData) => {
                setSavingKit(true)
                try {
                  // Validaciones
                  if (!kitData.description) {
                    showNotification('Por favor complete el nombre del kit', 'error')
                    return
                  }

                  if (!kitData.items || kitData.items.length < 2) {
                    showNotification('Un kit debe tener al menos 2 componentes', 'error')
                    return
                  }

                  // Validar que todos los items tengan item_code no vacío y qty > 0
                  for (let i = 0; i < kitData.items.length; i++) {
                    const item = kitData.items[i]
                    if (!item.item_code || !(Number(item.qty) > 0)) {
                      showNotification(`El componente ${i + 1} debe tener un código y cantidad mayor a 0`, 'error')
                      return
                    }
                  }

                  const isNew = selectedKit === 'new'

                  // Validate that new_item_code includes company abbreviation (no fallbacks)
                  const companyAbbr = (companyDefaults && companyDefaults.abbr) ? companyDefaults.abbr : null
                  if (companyAbbr) {
                    const suffix = ` - ${companyAbbr}`
                    if (!(kitData.new_item_code || '').endsWith(suffix)) {
                      showNotification(`El código del kit debe incluir la sigla de la compañía (ej: ART012${suffix})`, 'error')
                      return
                    }
                  }

                  // Build components payload using canonical item codes from inventory items (must include abbr)
                  // Build payload: use kit-level description and do not send per-component descriptions
                  const payload = {
                    company: activeCompany,
                    custom_company: activeCompany,
                    new_item_code: (kitData.new_item_code || '').toString().trim(),
                    // Use description as canonical name for kits
                    item_name: kitData.description || null,
                    description: kitData.description || null,
                    // Ensure components do not include per-component description fields
                    items: (kitData.items || []).map(it => {
                      // Find matching inventory item to obtain canonical code (with company abbr)
                      const raw = (it.item_code || '').toString().trim()
                      const found = (items || []).find(inv => extractItemCodeDisplay(inv.item_code || inv.name || '') === raw || (inv.item_code || inv.name || '') === raw)
                      if (!found) {
                        throw new Error(`Componente ${raw} no encontrado en el catálogo. Seleccioná el item desde la lista.`)
                      }
                      const canonical = found.item_code || found.name || raw
                      // Ensure canonical ended with companyAbbr if we have it
                      if (companyAbbr) {
                        const suffix = ` - ${companyAbbr}`
                        if (!canonical.endsWith(suffix)) {
                          throw new Error(`Componente ${raw} no corresponde a la compañía seleccionada (falta ${suffix})`)
                        }
                      }
                      return { item_code: canonical, qty: it.qty, uom: it.uom || 'Unit' }
                    }),
                    item_group: kitData.item_group || undefined,
                    __isNewItemGroup: !!kitData.__isNewItemGroup,
                    brand: kitData.brand || undefined,
                  }

                  const url = isNew ? API_ROUTES.inventoryKits : API_ROUTES.inventoryKitByName(selectedKit)
                  const method = isNew ? 'POST' : 'PUT'

                  const response = await fetchWithAuth(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  })

                  if (response.ok) {
                    const data = await response.json()
                    if (data.success) {
                      showNotification(`Kit ${isNew ? 'creado' : 'actualizado'} exitosamente`, 'success')
                      // Refrescar listas
                      await fetchKits()
                      await fetchItems()

                      // If a new group was created on server it will appear in later list

                      setSelectedKit(data.data.name || payload.new_item_code)
                      setIsEditingKit(false)
                      setEditedKitData({})
                    } else {
                      showNotification(data.message || `Error al ${isNew ? 'crear' : 'actualizar'} kit`, 'error')
                    }
                  } else {
                    const errorData = await response.json()
                    showNotification(errorData.message || `Error al ${isNew ? 'crear' : 'actualizar'} kit`, 'error')
                  }
                } catch (error) {
                  console.error('Error saving kit:', error)
                  showNotification('Error al guardar kit', 'error')
                } finally {
                  setSavingKit(false)
                }
              }}
              onCancelEdit={() => {
                setIsEditingKit(false)
                setEditedKitData({})
                if (selectedKit === 'new') setSelectedKit(null)
              }}
              inventoryItems={items}
              itemGroups={itemGroups}
              brands={brands}
              createBrand={createBrand}
              createItemGroup={createItemGroup}
              companyDefaults={companyDefaults}
              savingKit={savingKit}
              showNotification={showNotification}
            />

            {/* Movimientos del kit - Abajo derecha (usa KitMovementsPanel para compartir lógica con items) */}
            <KitMovementsPanel
              selectedKit={selectedKit}
              kitMovements={kitMovements}
              movementWarehouseTab={kitMovementWarehouseTab}
              warehouses={kitWarehouses}
              setMovementWarehouseTab={setKitMovementWarehouseTab}
              openRemitoForEdit={openRemitoForEdit}
            />
          </div>
        </div>
      )}
      <ConfirmDialog />
    </div>
  )
}
