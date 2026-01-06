// --- COMPONENTE PARA LA TABLA DE ÍTEMS DE REMITOS ---
import { useState, useEffect, useCallback, useMemo } from 'react'
import { PurchaseItemsTable } from '../shared'
import { searchItems, fetchItemPriceInPriceList } from '../PurchaseInvoiceModal/purchaseInvoiceModalApi.js'
import SalesItemSettingsModal from '../SalesItemSettingsModal.jsx'
import useTaxTemplates from '../../../hooks/useTaxTemplates'
import { getIvaRatesFromTemplates } from '../../../utils/taxTemplates'

const RemitoItemsTable = ({
  formData,
  handleItemChange,
  addItem,
  removeItem,
  activeCompany,
  fetchWithAuth,
  availableWarehouses,
  onRequestQuickCreate,
  showNotification,
  isSales = false,
  // Props opcionales para mostrar precios
  showPricing = false,
  priceList = '',
  supplierDetails = null
}) => {
  const [availableUOMs, setAvailableUOMs] = useState([])
  const [showItemSettingsModal, setShowItemSettingsModal] = useState(false)
  const [selectedItemForSettings, setSelectedItemForSettings] = useState(null)
  const [selectedItemIndex, setSelectedItemIndex] = useState(null)
  const [itemStockMap, setItemStockMap] = useState({})
  const { templates: taxTemplates } = useTaxTemplates(fetchWithAuth)
  const availableIVARates = useMemo(() => getIvaRatesFromTemplates(taxTemplates), [taxTemplates])

  const resolvedPriceList = priceList || supplierDetails?.custom_default_price_list || ''

  // Cargar UOMs disponibles
  useEffect(() => {
    const fetchUOMs = async () => {
      try {
        const response = await fetchWithAuth('/api/inventory/uoms')
        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            setAvailableUOMs(data.data || [])
          }
        }
      } catch (error) {
        console.error('Error fetching UOMs:', error)
      }
    }

    fetchUOMs()
  }, [fetchWithAuth])

  // Función para búsqueda de items compatible con PurchaseItemsTable (devuelve Promise)
  const handleSearchItems = useCallback(async (query) => {
    return new Promise((resolve) => {
      searchItems(query, activeCompany, fetchWithAuth, (results) => {
        resolve(results || [])
      }, () => {})
    })
  }, [activeCompany, fetchWithAuth])

  // Función para obtener precio (solo se usa si showPricing está habilitado)
  const handleFetchItemPrice = useCallback(async (itemCode) => {
    if (!showPricing || !resolvedPriceList) return null
    try {
      return await fetchItemPriceInPriceList(fetchWithAuth, resolvedPriceList, itemCode)
    } catch (error) {
      console.error('Error fetching price for item:', error)
      return null
    }
  }, [fetchWithAuth, resolvedPriceList, showPricing])

  // Manejar cambios en items con lógica adicional para warehouse
  const handleItemChangeWithDefaults = useCallback((index, field, value) => {
    handleItemChange(index, field, value)
    
    // Si se asignan item_defaults, configurar warehouse automáticamente
    if (field === 'item_defaults' && Array.isArray(value)) {
      const defaultForCompany = value.find(def => def.company === activeCompany)
      if (defaultForCompany && defaultForCompany.default_warehouse) {
        handleItemChange(index, 'warehouse', defaultForCompany.default_warehouse)
        console.log('✅ Set default warehouse from item_defaults:', defaultForCompany.default_warehouse)
      }
    }
  }, [handleItemChange, activeCompany])

  // Handler cuando se selecciona un item (para stock check y warehouse auto-assign)
  const handleItemSelected = useCallback(async (index, item) => {
    if (!activeCompany || !fetchWithAuth) return

    try {
      const response = await fetchWithAuth('/api/inventory/items/bulk-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: activeCompany,
          include_bins: true,
          items: [{
            display_code: item.display_code || item.item_code || item.name || '',
            erp_item_code: item.name || item.item_code || ''
          }]
        })
      })

      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      const entry = data?.data ? Object.values(data.data)[0] : null
      const stockEntry = {
        available_qty: entry?.available_qty ?? 0,
        warehouses: entry?.warehouses || entry?.bins || []
      }

      setItemStockMap(prev => ({ ...prev, [index]: stockEntry }))

      const qty = parseFloat(formData?.items?.[index]?.qty) || 0
      const available = parseFloat(stockEntry.available_qty) || 0
      if (isSales && typeof showNotification === 'function') {
        if (available <= 0) {
          showNotification(`No hay stock disponible para ${item.display_code || item.item_name || 'el item'}`, 'warning')
        } else if (qty > available) {
          showNotification(`Stock insuficiente para ${item.display_code || item.item_name || 'el item'} (disp: ${available})`, 'warning')
        }
      }

      // Auto-assign warehouse if not set
      if (!formData?.items?.[index]?.warehouse && availableWarehouses.length > 0) {
        const firstWarehouse = availableWarehouses[0]?.name
        if (firstWarehouse) {
          handleItemChangeWithDefaults(index, 'warehouse', firstWarehouse)
        }
      }

      // Ensure propiedad defaults to 'Propio' when selecting an item (Remito items default to Propio)
      if (!formData?.items?.[index]?.propiedad) {
        handleItemChange(index, 'propiedad', 'Propio')
      }
    } catch (error) {
      console.error('Error checking stock for item', error)
    }
  }, [activeCompany, fetchWithAuth, formData?.items, isSales, showNotification, availableWarehouses, handleItemChangeWithDefaults, handleItemChange])

  const handleOpenItemSettings = useCallback((item, index) => {
    setSelectedItemForSettings(item)
    setSelectedItemIndex(index)
    setShowItemSettingsModal(true)
  }, [])

  const handleSaveItemSettings = useCallback((itemIndex, settings) => {
    // Aplicar los settings al item
    Object.keys(settings).forEach(key => {
      handleItemChange(itemIndex, key, settings[key])
    })
  }, [handleItemChange])

  useEffect(() => {
    if (formData?.items) {
      console.log('📦 [RemitoItemsTable] Items recibidos para renderizar:', formData.items.map((item, index) => ({
        index,
        item_code: item.item_code,
        qty: item.qty,
        warehouse: item.warehouse
      })))
    }
  }, [formData?.items])

  return (
    <>
      <PurchaseItemsTable
        items={formData.items}
        onItemChange={handleItemChangeWithDefaults}
        onAddItem={addItem}
        onRemoveItem={removeItem}
        searchItems={handleSearchItems}
        fetchItemPrice={showPricing ? handleFetchItemPrice : null}
        availableUOMs={availableUOMs}
        availableWarehouses={availableWarehouses}
        title="Ítems"
        showPricing={showPricing}
        showWarehouse={true}
        showDiscount={false}
        requireWarehouse={true}
        availableIVARates={showPricing ? availableIVARates : []}
        priceListName={resolvedPriceList}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        onRequestQuickCreate={isSales ? undefined : onRequestQuickCreate}
        onItemSelected={handleItemSelected}
        onOpenItemSettings={handleOpenItemSettings}
      />

      {/* Modal de configuración de ítems */}
      <SalesItemSettingsModal
        isOpen={showItemSettingsModal}
        onClose={() => {
          setShowItemSettingsModal(false)
          setSelectedItemForSettings(null)
          setSelectedItemIndex(null)
        }}
        item={selectedItemForSettings}
        itemIndex={selectedItemIndex}
        onSave={handleSaveItemSettings}
        fetchWithAuth={fetchWithAuth}
        availableWarehouses={availableWarehouses}
        showPropiedad={!isSales}
        propiedadOptions={['Propio', 'Consignación', 'Mercadería en local del proveedor']}
      />
    </>
  )
}

export default RemitoItemsTable
