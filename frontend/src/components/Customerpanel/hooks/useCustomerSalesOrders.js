import { useState, useMemo, useCallback, useEffect } from 'react'
import API_ROUTES from '../../../apiRoutes'
import { buildSalesInvoicePatchFromDocument } from '../../../utils/documentLinkingTransforms.js'
import { SALES_ORDERS_PAGE_SIZE, SALES_ORDER_VIEW_MAP } from '../constants'

export default function useCustomerSalesOrders({
  fetchWithAuth,
  showNotification,
  activeCompany,
  invoiceTab,
  selectedCustomer,
  companyTalonarios,
  fetchCompanyTalonarios,
  setLinkedInvoiceDraft,
  setEditingInvoice,
  setIsInvoiceModalOpen
}) {
  const [customerSalesOrders, setCustomerSalesOrders] = useState([])
  const [salesOrdersPagination, setSalesOrdersPagination] = useState({
    page: 1,
    pageSize: SALES_ORDERS_PAGE_SIZE,
    total: 0
  })
  const [salesOrdersView, setSalesOrdersView] = useState('pending')
  const [salesOrdersCounts, setSalesOrdersCounts] = useState({
    pending: 0,
    billedPending: 0,
    delivered: 0,
    cancelled: 0
  })
  const [loadedSalesOrdersViews, setLoadedSalesOrdersViews] = useState({
    pending: false,
    billedPending: false,
    delivered: false,
    cancelled: false
  })
  const [salesOrdersCache, setSalesOrdersCache] = useState({})
  const [salesOrdersLoadingView, setSalesOrdersLoadingView] = useState(null)
  const [isSalesOrderModalOpen, setIsSalesOrderModalOpen] = useState(false)
  const [editingSalesOrder, setEditingSalesOrder] = useState(null)

  const clearSalesOrderCacheForView = useCallback((view) => {
    if (!view) {
      return
    }
    setSalesOrdersCache(prev => {
      if (!prev[view]) {
        return prev
      }
      const next = { ...prev }
      delete next[view]
      return next
    })
    setLoadedSalesOrdersViews(prev => ({
      ...prev,
      [view]: false
    }))
  }, [])

  const fetchCustomerSalesOrders = useCallback(async (customerName, page = 1, view = 'pending', options = {}) => {
    if (!customerName) {
      setCustomerSalesOrders([])
      setSalesOrdersPagination({
        page: 1,
        pageSize: SALES_ORDERS_PAGE_SIZE,
        total: 0
      })
      return
    }

    const apiState = view === 'cancelled' ? null : (SALES_ORDER_VIEW_MAP[view] || SALES_ORDER_VIEW_MAP.pending)

    try {
      setSalesOrdersLoadingView(view)
      const params = new URLSearchParams({
        customer: customerName,
        page: page.toString(),
        limit: (options.pageSize || SALES_ORDERS_PAGE_SIZE).toString(),
        status: view === 'cancelled' ? 'cancelled' : view === 'pending' ? 'open' : 'all'
      })
      if (apiState) {
        params.set('billing_state', apiState)
      }
      if (activeCompany) {
        params.set('company', activeCompany)
      }
      const response = await fetchWithAuth(`${API_ROUTES.salesOrders}?${params.toString()}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'Error al cargar órdenes de venta')
      }

      const pagination = {
        page: payload.page || page,
        pageSize: payload.page_size || SALES_ORDERS_PAGE_SIZE,
        total: payload.total_count || 0
      }

      setSalesOrdersCache(prev => ({
        ...prev,
        [view]: {
          items: payload.orders || [],
          pagination
        }
      }))

      setSalesOrdersCounts(prev => ({
        ...prev,
        [view]: pagination.total
      }))

      setLoadedSalesOrdersViews(prev => ({
        ...prev,
        [view]: true
      }))

      if (salesOrdersView === view) {
        setCustomerSalesOrders(payload.orders || [])
        setSalesOrdersPagination(pagination)
      }

    } catch (error) {
      console.error('Error fetching customer sales orders:', error)
      showNotification(error.message || 'Error al cargar órdenes de venta', 'error')
    } finally {
      setSalesOrdersLoadingView(current => (current === view ? null : current))
    }
  }, [activeCompany, fetchWithAuth, salesOrdersView, showNotification])

  useEffect(() => {
    setSalesOrdersView('pending')
    setCustomerSalesOrders([])
    setSalesOrdersPagination({
      page: 1,
      pageSize: SALES_ORDERS_PAGE_SIZE,
      total: 0
    })
    setSalesOrdersCounts({ pending: 0, billedPending: 0, delivered: 0, cancelled: 0 })
    setSalesOrdersCache({})
    setLoadedSalesOrdersViews({ pending: false, billedPending: false, delivered: false, cancelled: false })
    setSalesOrdersLoadingView(null)
    setIsSalesOrderModalOpen(false)
    setEditingSalesOrder(null)
  }, [selectedCustomer])

  useEffect(() => {
    if (invoiceTab !== 'sales-orders' || !selectedCustomer) {
      return
    }
    const cached = salesOrdersCache[salesOrdersView]
    if (cached) {
      setCustomerSalesOrders(cached.items)
      setSalesOrdersPagination(cached.pagination)
    } else {
      setCustomerSalesOrders([])
      setSalesOrdersPagination(prev => ({
        page: 1,
        pageSize: prev?.pageSize || SALES_ORDERS_PAGE_SIZE,
        total: 0
      }))
    }
    if (!loadedSalesOrdersViews[salesOrdersView] && salesOrdersLoadingView !== salesOrdersView) {
      fetchCustomerSalesOrders(selectedCustomer, 1, salesOrdersView)
    }
  }, [
    fetchCustomerSalesOrders,
    invoiceTab,
    loadedSalesOrdersViews,
    salesOrdersCache,
    salesOrdersLoadingView,
    salesOrdersView,
    selectedCustomer
  ])

  useEffect(() => {
    const cached = salesOrdersCache[salesOrdersView]
    if (cached) {
      setCustomerSalesOrders(cached.items)
      setSalesOrdersPagination(cached.pagination)
    }
  }, [salesOrdersCache, salesOrdersView])

  const handleSalesOrderPageChange = useCallback(async (newPage, view = salesOrdersView) => {
    if (newPage < 1) return
    const cacheState = view === salesOrdersView ? { pagination: salesOrdersPagination } : salesOrdersCache[view]
    const pageSize = cacheState?.pagination?.pageSize || SALES_ORDERS_PAGE_SIZE
    const total = cacheState?.pagination?.total || 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    if (newPage > totalPages) return
    if (selectedCustomer) {
      await fetchCustomerSalesOrders(selectedCustomer, newPage, view, { pageSize })
    }
  }, [fetchCustomerSalesOrders, salesOrdersCache, salesOrdersPagination, salesOrdersView, selectedCustomer])

  const handleMarkSalesOrdersDelivered = useCallback(
    async (orderNames = [], view = 'billedPending') => {
      if (!orderNames || orderNames.length === 0) {
        showNotification('Seleccioná al menos una orden para marcarla como enviada', 'warning')
        return
      }
      if (!selectedCustomer) {
        return
      }
      try {
        const response = await fetchWithAuth('/api/sales-orders/mark-delivered', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ orders: orderNames })
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || 'No se pudieron actualizar las órdenes seleccionadas')
        }
        showNotification('Ordenes marcadas como enviadas', 'success')
        const cacheState = view === salesOrdersView ? { pagination: salesOrdersPagination } : salesOrdersCache[view]
        const currentPage = cacheState?.pagination?.page || 1
        await fetchCustomerSalesOrders(selectedCustomer, currentPage, view)
        clearSalesOrderCacheForView('delivered')
      } catch (error) {
        console.error('Error marking sales orders delivered:', error)
        showNotification(error.message || 'No se pudieron marcar las órdenes como enviadas', 'error')
      }
    },
    [
      clearSalesOrderCacheForView,
      fetchCustomerSalesOrders,
      fetchWithAuth,
      salesOrdersCache,
      salesOrdersPagination,
      salesOrdersView,
      selectedCustomer,
      showNotification
    ]
  )

  const handleOpenSalesOrder = useCallback(async (orderName) => {
    try {
      const response = await fetchWithAuth(API_ROUTES.salesOrder(orderName))
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'No se pudo cargar la orden de venta')
      }
      setEditingSalesOrder(payload.data)
      setIsSalesOrderModalOpen(true)
    } catch (error) {
      console.error('Error opening sales order:', error)
      showNotification(error.message || 'Error al abrir orden de venta', 'error')
    }
  }, [fetchWithAuth, showNotification])

  const handleNewSalesOrder = useCallback(() => {
    if (!selectedCustomer) {
      showNotification('Seleccioná un cliente antes de crear un pedido', 'warning')
      return
    }
    setEditingSalesOrder(null)
    setIsSalesOrderModalOpen(true)
  }, [selectedCustomer, showNotification])

  const handleSaveSalesOrder = useCallback(async (orderData, options = {}) => {
    const isEditing = options.isEditing ?? Boolean(orderData?.name)
    const targetName = orderData?.name || editingSalesOrder?.name || null
    const payload = {
      ...orderData,
      name: targetName || undefined
    }
    const endpoint = isEditing && targetName
      ? API_ROUTES.salesOrder(targetName)
      : API_ROUTES.salesOrders
    const method = isEditing && targetName ? 'PUT' : 'POST'

    try {
      const response = await fetchWithAuth(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sales_order: payload })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Error al guardar la orden')
      }

      if (!options.silent) {
        showNotification(isEditing ? 'Orden de venta actualizada' : 'Orden de venta creada', 'success')
        setIsSalesOrderModalOpen(false)
        setEditingSalesOrder(null)
      }

      if (selectedCustomer) {
        if (isEditing) {
          await fetchCustomerSalesOrders(
            selectedCustomer,
            salesOrdersPagination.page || 1,
            salesOrdersView
          )
        } else {
          setSalesOrdersView('pending')
          clearSalesOrderCacheForView('pending')
          await fetchCustomerSalesOrders(selectedCustomer, 1, 'pending')
        }
      }

      return { success: true, data: data.data }
    } catch (error) {
      console.error('Error saving sales order:', error)
      showNotification(error.message || 'No se pudo guardar la orden', 'error')
      return { success: false }
    }
  }, [
    clearSalesOrderCacheForView,
    editingSalesOrder,
    fetchCustomerSalesOrders,
    fetchWithAuth,
    salesOrdersPagination.page,
    salesOrdersView,
    selectedCustomer,
    showNotification
  ])

  const handleConvertSalesOrderToInvoice = useCallback(async (orderData) => {
    if (!orderData?.name) {
      showNotification('Guardá la orden antes de convertirla en factura', 'warning')
      return
    }
    try {
      const response = await fetchWithAuth(API_ROUTES.documentLinking.make, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          relation: 'sales_invoice_from_sales_order',
          source_name: orderData.name,
          company: orderData.company || activeCompany
        })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'No pudimos convertir la orden en factura')
      }
      const document = data.data?.document
      if (!document) {
        throw new Error('ERPNext no devolvió la factura generada')
      }
      const patch = buildSalesInvoicePatchFromDocument(document)
      setLinkedInvoiceDraft({
        ...patch,
        taxes: patch.taxes || [],
        items: patch.items || [],
        sourceSalesOrder: orderData.name
      })
      setEditingInvoice(null)
      setIsSalesOrderModalOpen(false)
      setEditingSalesOrder(null)
      if (companyTalonarios.length === 0) {
        await fetchCompanyTalonarios()
      }
      setIsInvoiceModalOpen(true)
      showNotification('Generamos una factura borrador desde la orden. Revisala antes de confirmar.', 'success')

      if (selectedCustomer) {
        await fetchCustomerSalesOrders(
          selectedCustomer,
          salesOrdersView === 'pending' ? (salesOrdersPagination.page || 1) : 1,
          'pending'
        )
        clearSalesOrderCacheForView('billedPending')
      }
    } catch (error) {
      console.error('Error converting sales order:', error)
      showNotification(error.message || 'No pudimos convertir la orden en factura', 'error')
      throw error
    }
  }, [
    activeCompany,
    clearSalesOrderCacheForView,
    companyTalonarios.length,
    fetchCompanyTalonarios,
    fetchCustomerSalesOrders,
    fetchWithAuth,
    salesOrdersPagination.page,
    salesOrdersView,
    selectedCustomer,
    setEditingInvoice,
    setIsInvoiceModalOpen,
    setLinkedInvoiceDraft,
    showNotification
  ])

  const handleCancelSalesOrder = useCallback(async (orderName, reason) => {
    try {
      const response = await fetchWithAuth(API_ROUTES.salesOrderCancel(orderName), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'No se pudo cancelar la orden')
      }
      showNotification('Orden cancelada', 'success')
      setIsSalesOrderModalOpen(false)
      setEditingSalesOrder(null)
      if (selectedCustomer) {
        await fetchCustomerSalesOrders(selectedCustomer, salesOrdersPagination.page, salesOrdersView)
      }
    } catch (error) {
      console.error('Error cancelling sales order:', error)
      showNotification(error.message || 'Error al cancelar la orden', 'error')
    }
  }, [fetchCustomerSalesOrders, fetchWithAuth, salesOrdersPagination.page, salesOrdersView, selectedCustomer, showNotification])

  const isLoadingSalesOrders = useMemo(
    () => salesOrdersLoadingView === salesOrdersView,
    [salesOrdersLoadingView, salesOrdersView]
  )

  return {
    customerSalesOrders,
    salesOrdersPagination,
    salesOrdersView,
    setSalesOrdersView,
    salesOrdersCounts,
    handleSalesOrderPageChange,
    handleMarkSalesOrdersDelivered,
    handleOpenSalesOrder,
    handleNewSalesOrder,
    handleSaveSalesOrder,
    handleConvertSalesOrderToInvoice,
    handleCancelSalesOrder,
    fetchCustomerSalesOrders,
    isSalesOrderModalOpen,
    setIsSalesOrderModalOpen,
    editingSalesOrder,
    setEditingSalesOrder,
    isLoadingSalesOrders
  }
}
