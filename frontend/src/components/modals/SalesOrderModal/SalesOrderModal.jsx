import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { AlertTriangle, ClipboardList, FileText, Link2, Loader2, Printer, Save, XCircle } from 'lucide-react'
import Modal from '../../Modal.jsx'
import { SalesItemsTable, isPendingItem } from '../shared'
import { fetchAvailableWarehouses, fetchSalesPriceLists } from '../InvoiceModal/invoiceModalApi.js'
import SalesItemSettingsModal from '../SalesItemSettingsModal.jsx'
import PendingItemResolveModal from '../PendingItemResolveModal/PendingItemResolveModal.jsx'
import DocumentLinkerModal from '../DocumentLinker/DocumentLinkerModal.jsx'
import { buildSalesOrderPatchFromDocument } from '../../../utils/documentLinkingTransforms.js'

const today = () => new Date().toISOString().split('T')[0]

import useTaxTemplates from '../../../hooks/useTaxTemplates'
import { getIvaRatesFromTemplates } from '../../../utils/taxTemplates'

/**
 * Remueve la abreviatura de empresa del final del nombre (formato: "NOMBRE - ABBR")
 */
const removeCompanyAbbr = (name) => {
  if (!name) return name
  return name.replace(/\s*-\s*[A-Z0-9]{1,5}$/, '').trim()
}

/**
 * Verifica si hay items pendientes de mapear en la lista
 */
const hasPendingItems = (items) => {
  if (!Array.isArray(items)) return false
  return items.some(item => isPendingItem(item))
}


const recalculateItemAmount = (item) => {
  const qty = parseFloat(item.qty || 0) || 0
  const rate = parseFloat(item.rate || 0) || 0
  const discount = parseFloat(item.discount_amount || 0) || 0
  // Determine IVA percent: prefer explicit iva_percent, otherwise try item_tax_rate mapping
  let ivaPercent = parseFloat(item.iva_percent || 0) || 0
  if ((!ivaPercent || ivaPercent === 0) && item && item.item_tax_rate) {
    try {
      const parsed = typeof item.item_tax_rate === 'string' ? JSON.parse(item.item_tax_rate) : item.item_tax_rate
      if (parsed && typeof parsed === 'object') {
        const vals = Object.values(parsed).map(v => parseFloat(v)).filter(v => Number.isFinite(v))
        if (vals.length > 0) ivaPercent = vals[0]
      }
    } catch (err) {
      // ignore parse errors
    }
  }

  // Detect price list adjustment: price_list_rate - rate (rounded to cents)
  const priceListRate = parseFloat(item.price_list_rate || item.base_price_list_rate || 0) || 0
  const expectedAdjustment = priceListRate > 0 ? Math.round(((priceListRate - rate) + Number.EPSILON) * 100) / 100 : 0
  const isPriceListAdjustment = priceListRate > 0 && Math.abs(expectedAdjustment - discount) <= 0.02

  // netAmount should use the applied rate (ERPNext stores the applied rate). Do NOT subtract price-list adjustment again.
  const netAmount = Math.max(qty * rate, 0)
  const ivaAmount = netAmount * (ivaPercent / 100)
  const totalAmount = netAmount + ivaAmount

  return {
    ...item,
    net_amount: netAmount.toFixed(2),
    iva_amount: ivaAmount.toFixed(2),
    amount: totalAmount.toFixed(2),
    iva_percent: ivaPercent,
    // helpers for UI: how much of discount is purely a price-list adjustment
    price_list_adjustment: expectedAdjustment,
    is_price_list_adjustment: isPriceListAdjustment,
    display_discount_amount: isPriceListAdjustment ? expectedAdjustment : discount
  }
}

const createEmptyItem = (scheduleDate, defaultWarehouse = '') =>
  recalculateItemAmount({
    item_code: '',
    item_name: '',
    description: '',
    qty: 1,
    uom: 'Unit',
    rate: 0,
    discount_amount: 0,
    iva_percent: '',
    warehouse: defaultWarehouse || '',
    schedule_date: scheduleDate || today(),
    income_account: '',
    cost_center: '',
    valuation_rate: '',
    item_defaults: [],
    item_tax_template: '',
    amount: '0.00'
  })

const normalizeItems = (items, fallbackDate, defaultWarehouse = '') => {
  const referenceDate = fallbackDate || today()
  const sourceItems = Array.isArray(items) && items.length > 0 ? items : [createEmptyItem(referenceDate, defaultWarehouse)]
  return sourceItems.map((item) =>
    recalculateItemAmount({
      ...createEmptyItem(item?.schedule_date || referenceDate, defaultWarehouse),
      ...item,
      schedule_date: item?.schedule_date || referenceDate,
      item_name: item?.item_name || item?.item_code || '',
      description: item?.description || item?.item_name || item?.item_code || '',
      item_defaults: item?.item_defaults || []
    })
  )
}

const buildDefaultOrder = (customer, company, defaultWarehouse = '') => {
  const referenceDate = today()
  const initialItems = Array.from({ length: 3 }, () => createEmptyItem(referenceDate, defaultWarehouse))
  return {
    customer: customer || '',
    company: company || '',
    transaction_date: referenceDate,
    receiving_date: referenceDate,
    marketplace_reference: '',
    notes: '',
    shipping_label_note: '',
    price_list: '',
    items: normalizeItems(initialItems, referenceDate, defaultWarehouse)
  }
}

const stripCompanyAbbr = (name) => {
  if (!name || typeof name !== 'string') {
    return ''
  }
  const normalized = name.trim()
  const separatorIndex = normalized.lastIndexOf(' - ')
  if (separatorIndex === -1) {
    return normalized
  }
  return normalized.substring(0, separatorIndex)
}

// Helper component for form fields - matching InvoiceModal style
const FormField = ({ label, children, className = '' }) => (
  <div className={className}>
    <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">{label}</label>
    {children}
  </div>
)

const inputStyle = "w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent transition h-7"
const selectStyle = `${inputStyle} bg-white`

const SalesOrderModal = ({
  isOpen,
  onClose,
  selectedCustomer,
  customerDetails,
  activeCompany,
  fetchWithAuth,
  showNotification,
  editingOrder,
  onSave,
  onCancelOrder,
  onConvertToInvoice
}) => {
  const [formData, setFormData] = useState(buildDefaultOrder(selectedCustomer, activeCompany))
  const [availableWarehouses, setAvailableWarehouses] = useState([])
  const [companyDefaultWarehouse, setCompanyDefaultWarehouse] = useState('')
  const [availablePriceLists, setAvailablePriceLists] = useState([])
  const { sales: taxSales, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)
  const [availableIVARates, setAvailableIVARates] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [itemSettingsModal, setItemSettingsModal] = useState({ isOpen: false, item: null, itemIndex: null })
  // Estado para el modal de resolución de items pendientes
  const [pendingItemModal, setPendingItemModal] = useState({ isOpen: false, item: null, itemIndex: null })
  const [showDocumentLinker, setShowDocumentLinker] = useState(false)
  const displayCustomerName = stripCompanyAbbr(selectedCustomer || formData.customer || '')

  // Usar ref para mantener fetchWithAuth estable y evitar loops
  const fetchWithAuthRef = useRef(fetchWithAuth)
  fetchWithAuthRef.current = fetchWithAuth

  // Estado para controlar si ya se cargaron los datos iniciales
  const initialLoadDoneRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    refreshTaxTemplates()?.catch(() => {})
  }, [isOpen, refreshTaxTemplates])

  useEffect(() => {
    if (!isOpen) return
    const rates = getIvaRatesFromTemplates(Array.isArray(taxSales) ? taxSales : [])
    setAvailableIVARates(rates)
  }, [isOpen, taxSales])

  // Fetch warehouses when modal opens / active company changes
  useEffect(() => {
    if (isOpen && activeCompany) {
      fetchAvailableWarehouses(activeCompany, fetchWithAuthRef.current, setAvailableWarehouses)
    }
  }, [isOpen, activeCompany]) // Removido fetchWithAuth de dependencias

  // Fetch company default warehouse for newly created items
  useEffect(() => {
    const loadCompanyDefault = async () => {
      if (!isOpen) return
      try {
        const resp = await fetchWithAuthRef.current('/api/active-company')
        if (resp && resp.ok) {
          const payload = await resp.json()
          const wh = payload?.data?.company_details?.custom_default_warehouse || ''
          if (wh) setCompanyDefaultWarehouse(wh)
          else if (Array.isArray(availableWarehouses) && availableWarehouses.length > 0) setCompanyDefaultWarehouse(availableWarehouses[0].name)
        }
      } catch (err) {
        console.error('Error fetching company default warehouse:', err)
      }
    }

    loadCompanyDefault()
  }, [isOpen, availableWarehouses]) // Removido fetchWithAuth de dependencias

  useEffect(() => {
    if (!isOpen) return
    const loadPriceLists = async () => {
      const lists = await fetchSalesPriceLists(fetchWithAuthRef.current)
      setAvailablePriceLists(Array.isArray(lists) ? lists : [])
    }
    loadPriceLists()
  }, [isOpen]) // Removido fetchWithAuth de dependencias

  useEffect(() => {
    const initializeForm = async () => {
      if (!isOpen) return

      // Función auxiliar para obtener la lista de precios del cliente
      const fetchCustomerPriceList = async (customerName) => {
        if (!customerName) return null

        let customerInfo = customerDetails

        // Si no tenemos datos del cliente, buscarlos
        if (!customerInfo || (!customerInfo.price_list && !customerInfo.customer_group)) {
          try {
            // Remover la abreviatura de la empresa del nombre del cliente para la API
            const cleanCustomerName = removeCompanyAbbr(customerName)
            console.log('--- Sales Order: customerName:', customerName, 'cleanCustomerName:', cleanCustomerName)
            const resp = await fetchWithAuthRef.current(`/api/resource/Customer/${encodeURIComponent(cleanCustomerName)}`)
            if (resp.ok) {
              const data = await resp.json()
              customerInfo = data?.data || customerInfo
            }
          } catch (error) {
            console.error('Error fetching customer details for price list:', error)
          }
        }

        // Primero intentar con la lista del cliente
        const customerPriceList = customerInfo?.price_list
        if (customerPriceList) {
          console.log('--- Sales Order: price list from customer:', customerPriceList)
          return customerPriceList
        }

        // Si no tiene, buscar en el grupo de clientes
        const groupName = customerInfo?.customer_group
        if (groupName) {
          try {
            const groupResp = await fetchWithAuthRef.current(`/api/resource/Customer%20Group/${encodeURIComponent(groupName)}`)
            if (groupResp?.ok) {
              const groupData = await groupResp.json()
              const defaultGroupPriceList = groupData?.data?.default_price_list
              if (defaultGroupPriceList) {
                console.log('--- Sales Order: price list from customer group:', defaultGroupPriceList)
                return defaultGroupPriceList
              }
            }
          } catch (error) {
            console.error('Error fetching customer group for price list:', error)
          }
        }

        return null
      }

      if (editingOrder) {
        // Cargar la orden existente
        const orderData = {
          ...editingOrder,
          items: normalizeItems(editingOrder.items, editingOrder.receiving_date || today(), companyDefaultWarehouse)
        }

        // Si la orden no tiene lista de precios, buscarla del cliente
        if (!orderData.price_list) {
          const customerName = editingOrder.customer || selectedCustomer
          const priceList = await fetchCustomerPriceList(customerName)
          if (priceList) {
            orderData.price_list = priceList
          }
        }

        setFormData(orderData)
        setCancelReason('')
        return
      }

      // Nueva orden: construir formulario base
      const baseOrder = buildDefaultOrder(selectedCustomer, activeCompany, companyDefaultWarehouse)

      // Determinar lista de precios del cliente o su grupo
      if (selectedCustomer) {
        const priceList = await fetchCustomerPriceList(selectedCustomer)
        if (priceList) {
          baseOrder.price_list = priceList
        }
      }

      setFormData(baseOrder)
      setCancelReason('')
    }

    initializeForm()
  }, [isOpen, editingOrder, selectedCustomer, activeCompany, customerDetails]) // Removido fetchWithAuth de dependencias

  const totals = useMemo(() => {
    const items = formData.items || []
    const validItems = items.filter(item => item.item_code && item.item_code.trim() !== '')

    let netTotal = 0
    let discountTotal = 0
    let ivaTotal = 0
    let allArePriceListAdjustments = validItems.length > 0

    validItems.forEach(item => {
      const qty = parseFloat(item.qty || 0) || 0
      const rate = parseFloat(item.rate || 0) || 0
      const ivaPercent = parseFloat(item.iva_percent || 0) || 0

      // display_discount_amount was set in recalculateItemAmount
      const displayDiscount = parseFloat(item.display_discount_amount || 0) || 0

      const lineNet = qty * rate
      const lineIva = lineNet * (ivaPercent / 100)

      netTotal += lineNet
      discountTotal += displayDiscount
      ivaTotal += lineIva

      if (displayDiscount > 0 && !item.is_price_list_adjustment) {
        allArePriceListAdjustments = false
      }
      if (displayDiscount === 0) {
        // If there's no display discount for an item, it's not an "all adjustments" case
        allArePriceListAdjustments = false
      }
    })

    // Subtotal should reflect applied rates (ERPNext base_total/net_total)
    const subtotal = netTotal
    const total = subtotal + ivaTotal

    return {
      itemsCount: validItems.length,
      netTotal,
      discountTotal,
      subtotal,
      ivaTotal,
      total,
      isPriceListAdjustment: allArePriceListAdjustments,
      discountLabel: allArePriceListAdjustments ? 'Ajuste de precio (lista)' : 'Descuento'
    }
  }, [formData.items])

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value
    }))
  }

  const handleItemChange = (index, field, value) => {
    setFormData((prev) => {
      const items = [...(prev.items || [])]
      const current = items[index] || createEmptyItem(prev.receiving_date || today(), companyDefaultWarehouse)
      items[index] = recalculateItemAmount({
        ...current,
        [field]: value
      })
      return { ...prev, items }
    })
  }

  const handleAddItem = () => {
    setFormData((prev) => {
      const receivingDate = prev.receiving_date || today()
      return {
        ...prev,
        items: [...(prev.items || []), createEmptyItem(receivingDate, companyDefaultWarehouse)]
      }
    })
  }

  const handleRemoveItem = (index) => {
    setFormData((prev) => {
      if ((prev.items || []).length <= 1) {
        return prev
      }
      const items = prev.items.filter((_, i) => i !== index)
      return { ...prev, items }
    })
  }

  const handleOpenItemSettings = (item, index) => {
    setItemSettingsModal({
      isOpen: true,
      item,
      itemIndex: index
    })
  }

  const handleCloseItemSettings = () => {
    setItemSettingsModal({
      isOpen: false,
      item: null,
      itemIndex: null
    })
  }

  const handleSaveItemSettings = (itemIndex, settings) => {
    if (itemIndex === null || itemIndex === undefined) return
    setFormData((prev) => {
      const items = [...(prev.items || [])]
      if (!items[itemIndex]) {
        return prev
      }
      items[itemIndex] = recalculateItemAmount({
        ...items[itemIndex],
        income_account: settings?.income_account ?? items[itemIndex].income_account,
        warehouse: settings?.warehouse ?? items[itemIndex].warehouse,
        cost_center: settings?.cost_center ?? items[itemIndex].cost_center,
        valuation_rate: settings?.valuation_rate ?? items[itemIndex].valuation_rate
      })
      return { ...prev, items }
    })
  }

  // Handler para abrir el modal de resolución de items pendientes
  const handleResolvePendingItem = useCallback((item, index) => {
    setPendingItemModal({
      isOpen: true,
      item,
      itemIndex: index
    })
  }, [])

  // Handler cuando se resuelve un item pendiente
    const handlePendingItemResolved = useCallback((result) => {
      if (!result || pendingItemModal.itemIndex === null) return
      
      const { new_item_code: newCode, item: resolvedItem = {} } = result
      const index = pendingItemModal.itemIndex
      
      setFormData((prev) => {
        const items = [...(prev.items || [])]
        if (!items[index]) return prev
        
        // Limpiar el código de empresa si viene incluido
        let cleanCode = newCode || ''
        cleanCode = cleanCode.replace(/\s*-\s*[A-Z]{2,}$/, '').trim()

        const resolvedName = resolvedItem.item_name || resolvedItem.name || items[index].item_name || cleanCode
        const resolvedDescription = resolvedItem.description || items[index].description || resolvedName
        const resolvedGroup = resolvedItem.item_group ? removeCompanyAbbr(resolvedItem.item_group) : items[index].item_group
        const resolvedIsStock = resolvedItem.is_stock_item ?? items[index].is_stock_item
        
        items[index] = recalculateItemAmount({
          ...items[index],
          item_code: cleanCode,
          item_name: resolvedName,
          description: resolvedDescription,
          item_group: resolvedGroup,
          is_stock_item: resolvedIsStock
        })
        return { ...prev, items }
      })
      
      setPendingItemModal({ isOpen: false, item: null, itemIndex: null })
      showNotification?.('Item resuelto correctamente. Podés guardar la orden.', 'success')
    }, [pendingItemModal.itemIndex, showNotification])

  const ensureCustomerAndCompany = (data) => ({
    ...data,
    customer: data.customer || selectedCustomer,
    company: data.company || activeCompany
  })

  const handleLinkedDocuments = useCallback(({ mergeStrategy, linkedDocuments }) => {
    if (!linkedDocuments || linkedDocuments.length === 0) {
      showNotification?.('Seleccioná al menos un documento para importar', 'warning')
      return
    }

    const patches = linkedDocuments
      .map(entry => buildSalesOrderPatchFromDocument(entry.document))
      .filter(patch => Array.isArray(patch.items) && patch.items.length > 0)

    if (patches.length === 0) {
      showNotification?.('Los documentos seleccionados no tienen ítems disponibles', 'warning')
      return
    }

    const reference = patches[0]
    const importedItems = patches.flatMap(patch => patch.items || [])

    setFormData(prev => {
      const preservedItems = mergeStrategy === 'append'
        ? (prev.items || []).filter(item => item.item_code || item.description)
        : []
      const normalizedItems = importedItems.map(item => {
        const scheduleDate = item.schedule_date || prev.receiving_date || today()
        return recalculateItemAmount({
          ...createEmptyItem(scheduleDate, companyDefaultWarehouse),
          ...item,
          schedule_date: scheduleDate,
          qty: parseFloat(item.qty) || 1
        })
      })

      return {
        ...prev,
        customer: reference.customer || prev.customer,
        company: reference.company || prev.company,
        transaction_date: reference.transaction_date || prev.transaction_date,
        receiving_date: reference.receiving_date || prev.receiving_date,
        price_list: reference.price_list || prev.price_list,
        currency: reference.currency || prev.currency,
        items: [...preservedItems, ...normalizedItems]
      }
    })

    showNotification?.('Items importados desde documentos vinculados', 'success')
  }, [setFormData, showNotification, companyDefaultWarehouse])

  const validateItems = (items) => {
    const validItems = (items || []).filter(
      (item) => item.item_code && item.item_code.trim() !== ''
    )

    if (validItems.length === 0) {
      showNotification?.('Agregá al menos un producto a la orden', 'warning')
      return false
    }

    // Verificar si hay items pendientes de mapear
    if (hasPendingItems(validItems)) {
      showNotification?.('Hay items pendientes de mapear. Resolvelos antes de guardar haciendo click en el ícono ⚠️', 'warning')
      return false
    }

    return true
  }

  const handleSave = async () => {
    if (!onSave) return

    // Asignar warehouse por defecto a items sin warehouse
    const updatedItems = formData.items.map(item => ({
      ...item,
      warehouse: item.warehouse || companyDefaultWarehouse
    }))
    const updatedFormData = { ...formData, items: updatedItems }

    // Actualizar el estado para que el usuario vea los cambios
    setFormData(updatedFormData)

    // Validar items
    if (!validateItems(updatedFormData.items)) {
      return
    }

    setIsSaving(true)
    try {
      const payload = ensureCustomerAndCompany(updatedFormData)
      const isEditing = Boolean(payload.name || editingOrder?.name)
      if (!payload.receiving_date) {
        payload.receiving_date = payload.transaction_date || today()
      }
      const response = await onSave(payload, { isEditing })
      if (response?.success) {
        setCancelReason('')
      }
    } catch (error) {
      console.error('Error saving sales order modal:', error)
      showNotification?.('Error al guardar la orden', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = async () => {
    if (!onCancelOrder) return
    if (!formData?.name) {
      showNotification?.('Todavía no podés cancelar esta orden', 'warning')
      return
    }
    if (!cancelReason.trim()) {
      showNotification?.('Contanos por qué cancelás el pedido', 'warning')
      return
    }
    setIsCancelling(true)
    try {
      await onCancelOrder(formData.name, cancelReason)
    } finally {
      setIsCancelling(false)
    }
  }

  const handleConvertToInvoice = async () => {
    if (!formData?.name) {
      showNotification?.('Guardá la orden antes de convertirla en factura', 'warning')
      return
    }
    if (!onConvertToInvoice) return
    setIsConverting(true)
    try {
      await onConvertToInvoice(formData)
    } catch (error) {
      // El handler padre se encarga de notificar
    } finally {
      setIsConverting(false)
    }
  }

  const actionDisabled = isSaving || !selectedCustomer
  const canLinkDocuments = Boolean(formData.customer || selectedCustomer)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingOrder ? 'Editar Orden de Venta' : 'Nueva Orden de Venta'}
      subtitle={displayCustomerName || 'Reservá stock antes de facturar'}
      size="default"
      headerActions={
        editingOrder && onConvertToInvoice ? (
          <button
            type="button"
            onClick={handleConvertToInvoice}
            disabled={isConverting || !formData?.name}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
          >
            {isConverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Facturar pedido
          </button>
        ) : null
      }
    >
      {!selectedCustomer && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          Seleccioná un cliente para continuar.
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-6">
        <div className="flex-1 space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white/80 p-4 space-y-4">
            {customerDetails?.customer_primary_contact && (
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-bold text-gray-500 tracking-wide">CONTACTO</p>
                <p className="text-xs text-gray-700">{customerDetails.customer_primary_contact}</p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="FECHA DE PEDIDO">
                <input
                  type="date"
                  className={inputStyle}
                  value={formData.transaction_date || ''}
                  onChange={(e) => handleInputChange('transaction_date', e.target.value)}
                />
              </FormField>
              <FormField label="FECHA DE RECEPCIÓN">
                <input
                  type="date"
                  className={inputStyle}
                  value={formData.receiving_date || ''}
                  onChange={(e) => {
                    const value = e.target.value
                    handleInputChange('receiving_date', value)
                    setFormData((prev) => ({
                      ...prev,
                      items: (prev.items || []).map((item) => ({
                        ...item,
                        schedule_date: item.schedule_date || value
                      }))
                    }))
                  }}
                />
              </FormField>
            </div>
            <FormField label="NOTAS">
              <input
                type="text"
                className={inputStyle}
                placeholder="Agregá notas para el pedido"
                value={formData.notes || ''}
                onChange={(e) => handleInputChange('notes', e.target.value)}
              />
            </FormField>
            <FormField label="LISTA DE PRECIOS">
              <select
                className={selectStyle}
                value={formData.price_list || ''}
                onChange={(e) => handleInputChange('price_list', e.target.value)}
              >
                {availablePriceLists.length === 0 ? (
                  <option value="">Sin listas disponibles</option>
                ) : (
                  <>
                    {!formData.price_list && <option value="">Selecciona una lista</option>}
                    {availablePriceLists.map((priceList) => (
                      <option key={priceList.name} value={priceList.name}>
                        {`${priceList.price_list_name || priceList.name}${priceList.currency ? ` (${priceList.currency})` : ''}`}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </FormField>
          </div>

          <SalesItemsTable
            formData={formData}
            handleItemChange={handleItemChange}
            addItem={handleAddItem}
            removeItem={handleRemoveItem}
            availableIVARates={availableIVARates}
            onOpenItemSettings={handleOpenItemSettings}
            onResolvePendingItem={handleResolvePendingItem}
            activeCompany={activeCompany}
            fetchWithAuth={fetchWithAuth}
            availableWarehouses={availableWarehouses}
            onSaveItemSettings={handleSaveItemSettings}
            showNotification={showNotification}
            showStockWarnings={true}
            priceListName={formData.price_list}
          />
        </div>

        <aside className="w-full xl:w-80 flex-shrink-0 space-y-4">
          <section className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Resumen</p>
              <p className="text-xs text-gray-500">Valores estimados</p>
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              <div className="flex items-center justify-between">
                <span>Ítems</span>
                <span className="font-semibold">{totals.itemsCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span className="font-semibold">${totals.subtotal.toFixed(2)}</span>
              </div>
              {/* Discount/price-list adjustment is shown after the total to avoid confusion */}
              <div className="flex items-center justify-between">
                <span>IVA</span>
                <span className="font-semibold">${totals.ivaTotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-gray-200 pt-2 mt-2">
                <span className="font-semibold text-gray-800">Total</span>
                <span className="font-bold text-gray-900">${totals.total.toFixed(2)}</span>
              </div>

              {/* Mostrar ajuste informativo (price list) después del total */}
              {totals.discountTotal > 0 && (
                <div className="mt-2 text-sm text-gray-600">
                  <div className="flex items-center justify-between">
                    <span className="italic">{totals.discountLabel}</span>
                    <span className="font-semibold">-${totals.discountTotal.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Este valor es un ajuste informativo por diferencias con la lista de precios.</p>
                </div>
              )}
            </div>
          </section>

          <section className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <ClipboardList className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-sm font-semibold text-blue-900">Etiquetas de envío</p>
                <p className="text-xs text-blue-700">Pronto vas a poder imprimirlas desde acá.</p>
              </div>
            </div>
            <textarea
              className="w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="Notas o recordatorios logísticos"
              value={formData.shipping_label_note || ''}
              onChange={(e) => handleInputChange('shipping_label_note', e.target.value)}
            />
            <button
              type="button"
              disabled
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 text-xs font-semibold text-blue-600 px-3 py-2"
            >
              <Printer className="w-4 h-4" />
              Imprimir etiquetas (pronto)
            </button>
          </section>

          {editingOrder && (
            <section className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-semibold text-red-500 flex items-center gap-2 uppercase">
                <XCircle className="w-4 h-4" />
                Cancelar pedido
              </p>
              <textarea
                className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                rows={2}
                placeholder="Contanos qué pasó"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <button
                type="button"
                onClick={handleCancel}
                disabled={!formData?.name || isCancelling}
                className="btn-action-danger w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                Cancelar pedido
              </button>
            </section>
          )}

          <section className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
            <button
              type="button"
              onClick={() => setShowDocumentLinker(true)}
              disabled={!canLinkDocuments}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-60"
            >
              <Link2 className="w-4 h-4" />
              Relacionar con...
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={actionDisabled}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-blue-500 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              Guardar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cerrar
            </button>
          </section>
        </aside>
      </div>
      <DocumentLinkerModal
        isOpen={showDocumentLinker}
        onClose={() => setShowDocumentLinker(false)}
        context="sales_order"
        customerName={formData.customer || selectedCustomer || ''}
        company={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        onLinked={handleLinkedDocuments}
      />
      <SalesItemSettingsModal
        isOpen={itemSettingsModal.isOpen}
        item={itemSettingsModal.item}
        itemIndex={itemSettingsModal.itemIndex}
        onClose={handleCloseItemSettings}
        onSave={handleSaveItemSettings}
        availableWarehouses={availableWarehouses}
        fetchWithAuth={fetchWithAuth}
      />
      <PendingItemResolveModal
        isOpen={pendingItemModal.isOpen}
        onClose={() => setPendingItemModal({ isOpen: false, item: null, itemIndex: null })}
        fetchWithAuth={fetchWithAuth}
        activeCompany={activeCompany}
        showNotification={showNotification}
        pendingItem={pendingItemModal.item}
        suggestedQty={parseFloat(pendingItemModal.item?.qty) || 1}
        onResolved={handlePendingItemResolved}
      />
    </Modal>
  )
}

export default SalesOrderModal
