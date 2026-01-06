import React, { useEffect, useMemo, useState } from 'react'
import { Search, RefreshCw, Link2, Layers, AlertTriangle } from 'lucide-react'
import Modal from '../../Modal.jsx'
import API_ROUTES from '../../../apiRoutes.js'
import { isCreditNoteLabel } from '../../../utils/comprobantes'

const PAGE_SIZE = 20

const CONTEXT_CONFIG = {
  purchase_receipt: [
    {
      key: 'purchaseOrders',
      label: 'Ordenes de compra',
      requires: 'supplier',
      relation: 'purchase_receipt_from_purchase_order',
      description: 'Importa cantidades pendientes de la orden seleccionada.'
    }
  ],
  purchase_receipt_return: [
    {
      key: 'purchaseReceipts',
      label: 'Remitos de compra (sin facturar)',
      requires: 'supplier',
      relation: 'purchase_receipt_return_from_purchase_receipt',
      description: 'Genera una devolución basada en un remito sin facturar.',
      unbilledOnly: true
    }
  ],
  purchase_invoice: [
    {
      key: 'purchaseInvoices',
      label: 'Facturas con saldo',
      requires: 'supplier',
      relation: 'purchase_credit_note_from_invoice',
      description: 'Selecciona una factura con saldo para generar una nota de credito.'
    },
    {
      key: 'purchaseOrders',
      label: 'Ordenes de compra',
      requires: 'supplier',
      relation: 'purchase_invoice_from_purchase_order',
      description: 'Trae precios y cantidades pendientes directamente desde la orden.'
    },
    {
      key: 'purchaseReceipts',
      label: 'Remitos de compra',
      requires: 'supplier',
      relation: 'purchase_invoice_from_purchase_receipt',
      description: 'Factura solo lo recibido en los remitos seleccionados.'
    }
  ],
  sales_invoice: [
    {
      key: 'deliveryNotes',
      label: 'Remitos de venta',
      requires: 'customer',
      relation: 'sales_invoice_from_delivery_note',
      description: 'Carga lo entregado para facturarlo sin reingresar items.',
      unbilledOnly: true
    },
    {
      key: 'salesOrders',
      label: 'Ordenes de venta',
      requires: 'customer',
      relation: 'sales_invoice_from_sales_order',
      description: 'Convierte pedidos confirmados en factura.'
    },
    {
      key: 'salesQuotations',
      label: 'Presupuestos',
      requires: 'customer',
      relation: 'sales_invoice_from_sales_quotation',
      description: 'Factura directamente un presupuesto confirmado.'
    },
    {
      key: 'customerInvoices',
      label: 'Facturas con saldo',
      requires: 'customer',
      relation: 'sales_credit_note_from_invoice',
      description: 'Selecciona facturas confirmadas para generar notas de credito.'
    }
  ],
  sales_order: [
    {
      key: 'salesQuotations',
      label: 'Presupuestos',
      requires: 'customer',
      relation: 'sales_order_from_sales_quotation',
      description: 'Convierte un presupuesto aprobado en orden de venta.'
    }
  ],
  sales_remito: [
    {
      key: 'salesOrders',
      label: 'Ordenes de venta',
      requires: 'customer',
      relation: 'delivery_note_from_sales_order',
      description: 'Entrega pedidos confirmados sin reingresar items.'
    },
    {
      key: 'salesQuotations',
      label: 'Presupuestos',
      requires: 'customer',
      relation: 'delivery_note_from_sales_quotation',
      description: 'Genera remitos directamente desde presupuestos confirmados.'
    }
  ],
  sales_remito_return: [
    {
      key: 'deliveryNotes',
      label: 'Remitos de venta (sin facturar)',
      requires: 'customer',
      relation: 'delivery_note_return_from_delivery_note',
      description: 'Genera una devolución basada en un remito sin facturar.',
      unbilledOnly: true
    }
  ]
}

const isUnbilled = (doc) => {
  const raw = doc?.per_billed ?? doc?.per_billed_amount ?? doc?.per_billed_percent
  if (raw === null || raw === undefined || raw === '') return true
  const numeric = typeof raw === 'number' ? raw : parseFloat(raw)
  if (Number.isNaN(numeric)) return true
  return numeric <= 0
}

const isSubmitted = (doc) => {
  if (typeof doc?.docstatus !== 'number') return true
  return doc.docstatus === 1
}

const isReturnDocument = (doc) => {
  return Boolean(doc?.is_return) || normalizeStatus(doc).toLowerCase().includes('devol')
}


const sourceFetchers = {
  purchaseInvoices: async ({ supplierName, fetchWithAuth }) => {
    if (!supplierName) {
      return { items: [], totalCount: 0 }
    }
    const endpoint = `/api/pagos/unpaid-invoices/${encodeURIComponent(supplierName)}?party_type=Supplier`
    const response = await fetchWithAuth(endpoint)
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || 'Error al cargar facturas de compra con saldo')
    }
    const data = await response.json()
    return {
      items: data.data || [],
      totalCount: (data.data || []).length
    }
  },
  purchaseOrders: async ({ supplierName, company, page, fetchWithAuth }) => {
    const response = await fetchWithAuth(
      API_ROUTES.supplierPurchaseOrders(supplierName, page, PAGE_SIZE, company, 1)
    )
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || 'Error al cargar órdenes de compra')
    }
    const data = await response.json()
    return {
      items: data.purchase_orders || [],
      totalCount: data.total_count || 0
    }
  },
  purchaseReceipts: async ({ supplierName, page, fetchWithAuth }) => {
    console.log('[DocumentLinker] loading purchase receipts for supplier:', supplierName, 'page:', page)
    const response = await fetchWithAuth(
      API_ROUTES.supplierPurchaseReceipts(supplierName, page, PAGE_SIZE, 1)
    )
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || 'Error al cargar remitos de compra')
    }
    const data = await response.json()
    console.log('[DocumentLinker] purchase receipts result count:', (data.receipts || []).length)
    return {
      items: data.receipts || [],
      totalCount: data.total_count || 0
    }
  },
  deliveryNotes: async ({ customerName, page, fetchWithAuth }) => {
    const response = await fetchWithAuth(
      API_ROUTES.customerDeliveryNotes(customerName, page, PAGE_SIZE)
    )
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || 'Error al cargar remitos de venta')
    }
    const data = await response.json()
    return {
      items: data.delivery_notes || [],
      totalCount: data.total_count || 0
    }
  },
  salesOrders: async ({ customerName, company, page, fetchWithAuth }) => {
    if (!customerName) {
      return { items: [], totalCount: 0 }
    }
    const response = await fetchWithAuth(
      API_ROUTES.customerSalesOrders(customerName, page, PAGE_SIZE, company)
    )
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || 'Error al cargar órdenes de venta')
    }
    const data = await response.json()
    return {
      items: data.orders || [],
      totalCount: data.total_count || 0
    }
  }
,
  salesQuotations: async ({ customerName, company, page, fetchWithAuth }) => {
    if (!customerName) {
      return { items: [], totalCount: 0 }
    }
    const params = new URLSearchParams({
      page: page?.toString() || '1',
      limit: PAGE_SIZE.toString(),
      docstatus: '1'
    })
    if (customerName) {
      params.append('customer', customerName)
    }
    if (company) {
      params.append('company', company)
    }
    const endpoint = `${API_ROUTES.salesQuotations}?${params.toString()}`
    const response = await fetchWithAuth(endpoint)
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || 'Error al cargar presupuestos')
    }
    const data = await response.json()
    return {
      items: data.quotations || [],
      totalCount: data.total_count || 0
    }
  },
  customerInvoices: async ({ customerName, fetchWithAuth }) => {
    if (!customerName) {
      return { items: [], totalCount: 0 }
    }
    const endpoint = `/api/pagos/unpaid-invoices/${encodeURIComponent(customerName)}?party_type=Customer`
    const response = await fetchWithAuth(endpoint)
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || 'Error al cargar facturas de venta con saldo')
    }
    const data = await response.json()
    // The backend may return conciliation groups (is_group === true) which contain
    // an `invoices` array. Expand group invoices into the items list so the
    // DocumentLinker shows the individual invoices (excluding returns / negative totals).
    const items = []
    ;(data.data || []).forEach(entry => {
      if (entry.is_group && Array.isArray(entry.invoices)) {
        entry.invoices.forEach(inv => {
          // Skip returns and negative totals
          if (inv.is_return || (inv.grand_total || 0) < 0) return
          items.push({
            // Keep invoice fields compatible with standalone invoices
            ...inv,
            // Keep a reference to the group so UI can show context if necessary
            _conciliation_group: entry.group_id,
            _group_total: entry.total_amount
          })
        })
      } else {
        // Regular individual invoice
        if (entry.is_return || (entry.grand_total || 0) < 0) return
        items.push(entry)
      }
    })

    return {
      items,
      totalCount: items.length
    }
  }}

const formatDate = (value) => {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleDateString('es-AR')
  } catch (_) {
    return value
  }
}

const formatAmount = (value) => {
  const numberValue = typeof value === 'number' ? value : parseFloat(value || 0)
  return numberValue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const normalizeStatus = (doc) => {
  if (typeof doc?.status === 'string') return doc.status
  if (typeof doc?.docstatus === 'number') {
    if (doc.docstatus === 0) return 'Borrador'
    if (doc.docstatus === 1) return 'Confirmado'
    if (doc.docstatus === 2) return 'Cancelado'
  }
  return '—'
}

const buildInitialSourceState = (configs) => {
  const next = {}
  configs.forEach(cfg => {
    next[cfg.key] = {
      items: [],
      totalCount: 0,
      page: 0,
      loading: false,
      error: null
    }
  })
  return next
}

const DocumentLinkerModal = ({
  isOpen,
  onClose,
  context,
  supplierName,
  customerName,
  invoiceType,
  company,
  fetchWithAuth,
  showNotification,
  onLinked
}) => {
  const creditNoteMode = useMemo(() => isCreditNoteLabel(invoiceType), [invoiceType])
  const config = useMemo(() => {
    const base = CONTEXT_CONFIG[context] || []
    if (context === 'purchase_invoice') {
      return base.filter(cfg => creditNoteMode ? cfg.key === 'purchaseInvoices' : cfg.key !== 'purchaseInvoices')
    }
    if (context === 'sales_invoice') {
      return base.filter(cfg => creditNoteMode ? cfg.key === 'customerInvoices' : cfg.key !== 'customerInvoices')
    }
    return base
  }, [context, creditNoteMode])
  const [activeSource, setActiveSource] = useState(config[0]?.key || null)
  const [sourcesState, setSourcesState] = useState(() => buildInitialSourceState(config))
  const [searchTerm, setSearchTerm] = useState('')
  const [mergeStrategy, setMergeStrategy] = useState('replace')
  const [selectedDocs, setSelectedDocs] = useState(() => new Map())
  const [isLinking, setIsLinking] = useState(false)

  useEffect(() => {
    setActiveSource(config[0]?.key || null)
    setSourcesState(buildInitialSourceState(config))
    setSelectedDocs(new Map())
    setSearchTerm('')
    setMergeStrategy('replace')
  }, [config, isOpen])

  useEffect(() => {
    if (!isOpen) return
    setSourcesState(buildInitialSourceState(config))
    setSelectedDocs(new Map())
  }, [supplierName, customerName, company, isOpen, config])

  useEffect(() => {
    if (!isOpen) return
    const requirementsMet = (sourceKey) => {
      const cfg = config.find(item => item.key === sourceKey)
      if (!cfg) return false
      if (cfg.requires === 'supplier') return Boolean(supplierName)
      if (cfg.requires === 'customer') return Boolean(customerName)
      return true
    }

    if (activeSource && requirementsMet(activeSource)) {
      const state = sourcesState[activeSource]
      if (state && state.items.length === 0 && !state.loading) {
        loadSource(activeSource, 1, true)
      }
    }
  }, [isOpen, activeSource, supplierName, customerName])

  const loadSource = async (sourceKey, page = 1, replace = false) => {
    const cfg = config.find(item => item.key === sourceKey)
    if (!cfg) return
    const fetcher = sourceFetchers[sourceKey]
    if (!fetcher) return

    setSourcesState(prev => ({
      ...prev,
      [sourceKey]: { ...prev[sourceKey], loading: true, error: null }
    }))

    try {
      const result = await fetcher({
        supplierName,
        customerName,
        company,
        page,
        fetchWithAuth
      })
      setSourcesState(prev => ({
        ...prev,
        [sourceKey]: {
          ...prev[sourceKey],
          items: replace || page === 1 ? result.items : [...prev[sourceKey].items, ...result.items],
          totalCount: result.totalCount,
          page,
          loading: false,
          error: null
        }
      }))
    } catch (err) {
      const message = err.message || 'Error cargando documentos'
      setSourcesState(prev => ({
        ...prev,
        [sourceKey]: { ...prev[sourceKey], loading: false, error: message }
      }))
      if (showNotification) {
        showNotification(message, 'error')
      }
    }
  }

  const toggleSelection = (sourceKey, relation, doc) => {
    const selectionKey = `${sourceKey}:${doc.name}`
    setSelectedDocs(prev => {
      const next = new Map(prev)
      if (next.has(selectionKey)) {
        next.delete(selectionKey)
      } else {
        next.set(selectionKey, {
          selectionKey,
          sourceKey,
          relation,
          name: doc.name
        })
      }
      return next
    })
  }

  const handleLinkDocuments = async () => {
    if (selectedDocs.size === 0 || isLinking) return
    setIsLinking(true)
    const selectionEntries = Array.from(selectedDocs.values())
    const isPurchaseCreditMultiMake = selectionEntries.length > 0 &&
      selectionEntries.every(entry => entry.relation === 'purchase_credit_note_from_invoice')
    const isSalesCreditMultiMake = selectionEntries.length > 0 &&
      selectionEntries.every(entry => entry.relation === 'sales_credit_note_from_invoice')

    try {
      if (isPurchaseCreditMultiMake || isSalesCreditMultiMake) {
        const invoiceNames = selectionEntries.map(entry => entry.name)
        const requestBody = isPurchaseCreditMultiMake
          ? { purchase_invoices: invoiceNames }
          : { sales_invoices: invoiceNames }
        const response = await fetchWithAuth(API_ROUTES.creditDebitNotesMultiMake, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || result.success === false) {
          throw new Error(result.message || 'Error generando la nota de credito combinada')
        }

        if (onLinked) {
          onLinked({
            mergeStrategy,
            linkedDocuments: [],
            multiMakeResult: result.data
          })
        }

        setSelectedDocs(new Map())
        onClose()
        return
      }

      const linkedDocuments = []
      for (const docEntry of selectionEntries) {
        const response = await fetchWithAuth(API_ROUTES.documentLinking.make, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            relation: docEntry.relation,
            source_name: docEntry.name,
            company
          })
        })
        const result = await response.json()
        console.log('[DocumentLinker] make result', { relation: docEntry.relation, source: docEntry.name, result })
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Error al generar documento vinculado')
        }
        linkedDocuments.push({
          relation: docEntry.relation,
          sourceKey: docEntry.sourceKey,
          sourceName: docEntry.name,
          ...result.data
        })
      }

      if (onLinked) {
        onLinked({
          mergeStrategy,
          linkedDocuments
        })
      }

      setSelectedDocs(new Map())
      onClose()
    } catch (err) {
      if (showNotification) {
        showNotification(err.message || 'Error al vincular documentos', 'error')
      }
    } finally {
      setIsLinking(false)
    }
  }

  const filteredItems = () => {
    const state = sourcesState[activeSource] || { items: [] }
    let items = state.items

    // Filtrar por término de búsqueda
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      items = items.filter(item => item.name?.toLowerCase().includes(term))
    }

    // Para remitos de compra, excluir los que están en estado "Completed",
    // salvo si tienen un custom_estado_remito que indique 'Recibido pendiente de factura'
    if (activeSource === 'purchaseReceipts') {
      items = items.filter(item => {
        const status = normalizeStatus(item)
        const customEstado = (item.custom_estado_remito || '').toString().toLowerCase()
        // If receipt explicitly flagged as 'recibido pendiente de factura' in the custom field, keep it
        if (customEstado.includes('recibido pendiente')) return true
        return status !== 'Completed' && status !== 'Completado'
      })
    }

    // Para remitos de venta al facturar, excluir "Completed" (ya facturados) y cancelados
    if (activeSource === 'deliveryNotes' && context === 'sales_invoice') {
      items = items.filter(item => {
        if (Number(item?.docstatus) === 2) return false
        const status = String(normalizeStatus(item) || '').trim().toLowerCase()
        if (status === 'completed' || status === 'completado') return false
        if (status === 'cancelled' || status === 'cancelado') return false
        return true
      })
    }

    if (activeSource === 'purchaseOrders') {
      items = items.filter(item => (item.status || '').trim() !== 'On Hold')
      if (context === 'purchase_receipt') {
        items = items.filter(item => (item.status || '').trim() !== 'To Bill')
      }
    }

    if (activeConfig?.unbilledOnly) {
      items = items
        .filter(isSubmitted)
        .filter(isUnbilled)
        .filter(doc => !isReturnDocument(doc))
    }

    return items
  }

  const activeConfig = config.find(cfg => cfg.key === activeSource)
  const activeState = sourcesState[activeSource] || { items: [], totalCount: 0, page: 0, loading: false }

  const requirementsMissing = (() => {
    if (!activeConfig) return null
    if (activeConfig.requires === 'supplier' && !supplierName) {
      return 'Seleccioná un proveedor para listar documentos vinculables.'
    }
    if (activeConfig.requires === 'customer' && !customerName) {
      return 'Seleccioná un cliente para listar documentos vinculables.'
    }
    return null
  })()

  const hasMore = activeState.totalCount > activeState.items.length

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Relacionar documentos"
      size="large"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {config.map(cfg => (
            <button
              key={cfg.key}
              onClick={() => setActiveSource(cfg.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                activeSource === cfg.key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {cfg.label}
            </button>
          ))}
        </div>

        {activeConfig && (
          <p className="text-xs text-gray-600 flex items-center gap-2">
            <Layers className="w-4 h-4 text-gray-400" />
            {activeConfig.description}
          </p>
        )}

        {requirementsMissing ? (
          <div className="flex items-center gap-3 p-3 border border-amber-300 bg-amber-50 rounded-lg text-sm text-amber-700">
            <AlertTriangle className="w-4 h-4" />
            {requirementsMissing}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-grow">
                <Search className="w-4 h-4 text-gray-400 absolute left-2 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por nombre..."
                  className="pl-7 pr-3 py-2 text-xs w-full border border-gray-300 rounded-lg"
                />
              </div>
              <button
                onClick={() => loadSource(activeSource, 1, true)}
                className="flex items-center gap-1 px-3 py-2 text-xs font-semibold border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                <RefreshCw className="w-3 h-3" />
                Refrescar
              </button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 w-8"></th>
                    <th className="text-left px-3 py-2">Documento</th>
                    <th className="text-left px-3 py-2">Fecha</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-left px-3 py-2">Cantidad / Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems().map(doc => {
                    const selectionKey = `${activeConfig?.key}:${doc.name}`
                    const isSelected = selectedDocs.has(selectionKey)
                    return (
                      <tr
                        key={doc.name}
                        className={`border-t border-gray-100 ${isSelected ? 'bg-blue-50/60' : 'bg-white'}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelection(activeConfig.key, activeConfig.relation, doc)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-blue-700">
                          {activeSource === 'purchaseReceipts' && doc.name?.length > 5
                            ? doc.name.slice(0, -5)
                            : doc.name}
                        </td>
                        <td className="px-3 py-2">{formatDate(doc.posting_date || doc.transaction_date)}</td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-1 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-600">
                            {normalizeStatus(doc)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-700">
                          {activeSource === 'purchaseInvoices' || activeSource === 'customerInvoices' ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-700">
                                Total: $ {formatAmount(doc.grand_total || doc.total || 0)}
                              </span>
                              <span className="text-xs font-semibold text-amber-600">
                                Saldo: $ {formatAmount(doc.outstanding_amount || 0)}
                              </span>
                            </div>
                          ) : typeof doc.total_qty !== 'undefined'
                            ? `${doc.total_qty} u`
                            : `$ ${formatAmount(doc.grand_total || doc.total || doc.base_grand_total || 0)}`}
                        </td>
                      </tr>
                    )
                  })}
                  {filteredItems().length === 0 && (
                    <tr>
                      <td colSpan="5" className="text-center text-gray-500 py-6">
                        {activeState.loading ? 'Cargando documentos...' : 'No hay documentos disponibles'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <button
                onClick={() => loadSource(activeSource, activeState.page + 1)}
                className="text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 self-start"
              >
                Cargar más
              </button>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="font-semibold">Modo:</span>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="merge-mode"
                value="replace"
                checked={mergeStrategy === 'replace'}
                onChange={() => setMergeStrategy('replace')}
              />
              Reemplazar
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="merge-mode"
                value="append"
                checked={mergeStrategy === 'append'}
                onChange={() => setMergeStrategy('append')}
              />
              Agregar al final
            </label>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {selectedDocs.size} documento(s) seleccionado(s)
            </span>
            <button
              disabled={selectedDocs.size === 0 || isLinking}
              onClick={handleLinkDocuments}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              <Link2 className="w-4 h-4" />
              {isLinking ? 'Creando...' : 'Usar selección'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default DocumentLinkerModal
