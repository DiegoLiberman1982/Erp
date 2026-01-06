import React from 'react'
import { Users, FileText, FilePlus2, Layers, ClipboardList, Plus, Edit, Trash2, Save, MapPin, Search, X, AlertTriangle, CheckCircle, FileDown, Loader2, DollarSign, RefreshCw, ChevronDown, ChevronUp, Calculator } from 'lucide-react'
import Select from 'react-select'
import PurchaseInvoiceModal from '../modals/PurchaseInvoiceModal/PurchaseInvoiceModal.jsx'
import SupplierAddressModal from '../modals/SupplierAddressModal'
import SupplierPaymentModal from '../modals/SupplierPaymentModal.jsx'
import SupplierGroupModal from '../configcomponents/modals/SupplierGroupModal.jsx'
import ConfirmModal from '../modals/ConfirmModal'
import ItemSettingsModal from '../modals/ItemSettingsModal'
import Modal from '../Modal'
import StatementsTable from '../Customerpanel/StatementsTable.jsx'
import { NotificationContext } from '../../contexts/NotificationContext'
import ActionChip from '../common/ActionChip.jsx'
import { templateMatchesType, TEMPLATE_TYPES } from '../../utils/taxTemplates'
import API_ROUTES from '../../apiRoutes'

export default function Visualizacion({
  // Estados
  suppliers,
  selectedSupplier,
  setSelectedSupplier,
  fetchWithAuth,
  supplierDetails,
  supplierAddresses,
  supplierInvoices,
  unpaidInvoicesCount,
  draftInvoicesCount,
  supplierStatements,
  conciliationGroups = [],
  loading,
  loadingSupplierDetails,
  isSupplierDetailsPanelExpanded,
  setIsSupplierDetailsPanelExpanded,
  loadSupplierDetailsOnExpand,
  balancesLoaded,
  loadingBalances,
  onFetchBalances,
  isInvoiceModalOpen,
  setIsInvoiceModalOpen,
  isPaymentModalOpen,
  setIsPaymentModalOpen,
  isEditingSupplier,
  editedSupplierData,
  savingSupplier,
  editingInvoice,
  setEditingInvoice,
  editingPayment,
  setEditingPayment,
  isAddressModalOpen,
  setIsAddressModalOpen,
  hasMoreStatements,
  loadingMoreStatements,
  invoiceTab,
  setInvoiceTab,
  supplierTab,
  setSupplierTab,
  availableAccounts,
  availableLiabilityAccounts,
  availableExpenseAccounts,
  paymentTermsTemplates,
  taxTemplates,
  supplierSearch,
  setSupplierSearch,
  consultingAfip,
  supplierGroups,
  availablePriceLists,
  showSupplierGroupTestModal,
  supplierGroupFormData,
  setSupplierGroupFormData,
  savingSupplierGroup,
  handleSaveSupplierGroup,
  editingSupplierGroup,
  handleCloseSupplierGroupModal,
  confirmModal,
  itemSettingsModal,
  setItemSettingsModal,
  onCreateRemito,
  activeCompany,
  onCreatePurchaseOrder,
  // Nuevas props para remitos
  supplierReceipts,
  receiptsPagination,
  isLoadingReceipts,
  onRemitoPageChange,
  onOpenRemito,
  supplierPurchaseOrders,
  purchaseOrdersPagination,
  isLoadingPurchaseOrders,
  onPurchaseOrdersPageChange,
  onOpenPurchaseOrder,
  bulkDeleteState,
  onToggleBulkDelete,
  onBulkRowToggle,
  onBulkSelectAll,
  isBulkDeleting,
  // Funciones
  handleAddSupplier,
  handleEditSupplier,
  handleCancelEdit,
  handleCreateSupplier,
  handleSaveSupplier,
  handleDeleteSupplier,
  handleEditChange,
  handleSearchAfip,
  handleCloseAddressModal,
  handleCreateInvoice,
  handleOpenInvoice,
  handleInvoiceDeleted,
  onOpenSupplierGroupModal,
  formatBalance,
  formatVoucherNumber,
  mapVoucherTypeToSigla,
  truncateDescription,
  formatDate,
  extractAccountDescription,
  renderInvoicesTable,
  loadMoreStatements,
  handleConfirmAction,
  handleCancelAction,
  filterSuppliers,
  isInvoiceVoucherType,
  isPaymentVoucherType,
  isCreditVoucherType,
  isDebitVoucherType,
  openStatementEntry,
  onDownloadDocumentPdf,
  downloadingDocuments = {},
  onSupplierPaymentSaved,
  isReconciliationModalOpen,
  setIsReconciliationModalOpen,
  // Props para toggle de nombre comercial/fiscal
  showCommercialName = false,
  setShowCommercialName = () => {},
  companyCurrency = ''
}) {
  const normalizeDateToIso = (value) => {
    if (!value) return null
    const raw = String(value).trim()
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (isoMatch) return raw

    const dmyMatch = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
    if (!dmyMatch) return null
    const day = dmyMatch[1]
    const month = dmyMatch[2]
    const year = dmyMatch[3]
    return `${year}-${month}-${day}`
  }

  const expandDateTokens = (value) => {
    if (!value) return []
    const iso = normalizeDateToIso(value)
    if (!iso) return [String(value)]
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return [String(value)]
    const year = match[1]
    const month = match[2]
    const day = match[3]
    return [iso, `${day}-${month}-${year}`, `${day}/${month}/${year}`]
  }

  const filterDocumentsByQuery = (list, query, { id, dates = [], text = [], amounts = [], matchedParents = null } = {}) => {
    const normalizedQuery = (query || '').toString().trim().toLowerCase()
    if (!normalizedQuery) return Array.isArray(list) ? list : []

    const numericQueryString = normalizedQuery.replace(/[^\d.-]/g, '')
    const numericQuery = Number(numericQueryString)
    const isNumericLikeQuery = /^[\d.,-]+$/.test(normalizedQuery)
    const hasNumericQuery = isNumericLikeQuery && Number.isFinite(numericQuery) && normalizedQuery.replace(/[^\d]/g, '').length > 0
    const queryDateIso = normalizeDateToIso(normalizedQuery)

    return (Array.isArray(list) ? list : []).filter((doc) => {
      if (!doc) return false

      const idValue = typeof id === 'function' ? id(doc) : ''
      const docId = String(idValue || '').trim()
      const docIdLower = docId.toLowerCase()

      if (matchedParents instanceof Set && docId && matchedParents.has(docId)) {
        return true
      }

      const dateTokens = (dates || [])
        .flatMap((getter) => (typeof getter === 'function' ? expandDateTokens(getter(doc)) : []))
        .map((token) => String(token).toLowerCase())

      const textValues = (text || [])
        .map((getter) => (typeof getter === 'function' ? getter(doc) : ''))
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())

      const amountValues = (amounts || [])
        .map((getter) => (typeof getter === 'function' ? getter(doc) : undefined))
        .filter((value) => value !== undefined && value !== null && value !== '')

      const amountTexts = amountValues.map((value) => String(value).toLowerCase())

      const matchesText = docIdLower.includes(normalizedQuery)
        || dateTokens.some(token => token.includes(normalizedQuery))
        || (queryDateIso ? dateTokens.includes(queryDateIso) : false)
        || textValues.some(value => value.includes(normalizedQuery))
        || amountTexts.some(value => value.includes(normalizedQuery))

      if (matchesText) return true

      if (!hasNumericQuery) return false
      return amountValues.some((value) => {
        const numeric = Number(value)
        if (!Number.isFinite(numeric)) return false
        return String(numeric).includes(String(numericQuery))
      })
    })
  }

  const useDocumentItemsSearch = ({ enabled, query, parents, childDoctype, parentDoctype }) => {
    const normalized = (query || '').toString().trim().toLowerCase()
    const shouldSearch = Boolean(
      enabled
      && fetchWithAuth
      && normalized
      && normalized.length >= 3
      && /[a-zA-Z]/.test(normalized)
      && Array.isArray(parents)
      && parents.length > 0
      && childDoctype
      && parentDoctype
    )

    const [matchedParents, setMatchedParents] = React.useState(null)
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState(null)
    const cacheRef = React.useRef(new Map())
    const abortRef = React.useRef(null)
    const queryRef = React.useRef(normalized)
    queryRef.current = normalized

    React.useEffect(() => {
      if (!shouldSearch) {
        if (abortRef.current) {
          abortRef.current.abort()
          abortRef.current = null
        }
        setMatchedParents(null)
        setError(null)
        setLoading(false)
        return
      }

      const parentsKey = parents.join('|')
      const cacheKey = `${childDoctype}::${parentDoctype}::${parentsKey}::${normalized}`
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        setMatchedParents(cached)
        setError(null)
        setLoading(false)
        return
      }

      const handle = setTimeout(async () => {
        if (queryRef.current !== normalized) return

        if (abortRef.current) {
          abortRef.current.abort()
        }
        const controller = new AbortController()
        abortRef.current = controller

        setLoading(true)
        setError(null)

        try {
          const response = await fetchWithAuth(API_ROUTES.documentItemsSearch, {
            method: 'POST',
            body: JSON.stringify({
              child_doctype: childDoctype,
              parent_doctype: parentDoctype,
              parents,
              query: normalized,
              limit: 2000
            }),
            signal: controller.signal
          })

          if (!response || typeof response.json !== 'function') {
            const maybeError = response?.error
            if (maybeError?.name === 'AbortError') return
            throw maybeError || new Error('Error de conexiÛn')
          }

          const payload = await response.json().catch(() => ({}))
          if (!response.ok || payload.success === false) {
            throw new Error(payload.message || `Error HTTP ${response.status}`)
          }

          const found = Array.isArray(payload.parents) ? payload.parents : []
          const nextSet = new Set(found.map(String))
          cacheRef.current.set(cacheKey, nextSet)
          setMatchedParents(nextSet)
        } catch (caught) {
          if (caught?.name === 'AbortError') return
          console.error('[Supplierpanel] Item search error', caught)
          setError(caught?.message || 'Error buscando items')
          setMatchedParents(null)
        } finally {
          setLoading(false)
        }
      }, 400)

      return () => clearTimeout(handle)
    }, [childDoctype, normalized, parentDoctype, parents, shouldSearch])

    return { matchedParents, loading, error, enabled: shouldSearch }
  }

  const { showNotification } = React.useContext(NotificationContext)
  const bulkSelectedSet = bulkDeleteState?.selected || new Set()
  const isBulkMode = Boolean(bulkDeleteState?.active && bulkDeleteState?.context === invoiceTab)
  const bulkSelectedCount = bulkDeleteState?.selected ? bulkDeleteState.selected.size : 0
  const canUseBulkDelete = Boolean(selectedSupplier && ['unpaid', 'draft', 'receipts'].includes(invoiceTab))
  const bulkInvoiceSelectionCandidates = React.useMemo(() => {
    if (!Array.isArray(supplierInvoices)) return []
    return supplierInvoices.filter(doc => doc?.doctype === 'Purchase Invoice')
  }, [supplierInvoices])
  const [receiptsTab, setReceiptsTab] = React.useState('pending') // pending, billed, cancelled
  const [purchaseOrdersTab, setPurchaseOrdersTab] = React.useState('pending') // pending, billed, cancelled
  const invoiceBulkOptions = (isBulkMode && invoiceTab !== 'receipts') ? {
    isBulkMode: true,
    selectedItems: bulkSelectedSet,
    onToggleRow: (name, checked) => onBulkRowToggle && onBulkRowToggle(name, checked),
    onToggleAll: (checked) => onBulkSelectAll && onBulkSelectAll(invoiceTab, bulkInvoiceSelectionCandidates, checked),
    documentsForSelection: bulkInvoiceSelectionCandidates,
    isProcessing: isBulkDeleting
  } : null
  const receiptsBulkMode = isBulkMode && invoiceTab === 'receipts'
  const receiptsSelectableItems = receiptsBulkMode ? supplierReceipts.filter(receipt => receipt?.name) : []
  const receiptsAllSelected = receiptsBulkMode && receiptsSelectableItems.length > 0 && receiptsSelectableItems.every(receipt => bulkSelectedSet.has(receipt.name))

  const getReceiptEstado = React.useCallback((receipt) => {
    if (!receipt) return ''
    return (receipt.custom_estado_remito || receipt.status || '').toString().trim().toLowerCase()
  }, [])

  const PURCHASE_ORDER_STATUS_MAP = React.useMemo(() => ({
    'Draft': 'Borrador',
    'On Hold': 'En espera',
    'To Receive and Bill': 'Para recibir y pagar',
    'To Receive': 'Recibir',
    'To Bill': 'Por facturar',
    'Completed': 'Completado',
    'Cancelled': 'Cancelado',
    'Closed': 'Cerrado',
    'Delivered': 'Enviado',
    'Submitted': 'Enviado'
  }), [])

  const getPurchaseOrderEstado = React.useCallback((order) => {
    if (!order) return { raw: '', label: '' }
    const rawStatus = typeof order === 'string'
      ? order
      : (order.status || order.docstatus_label || '')
    const normalized = rawStatus ? rawStatus.toString().trim() : ''
    const label = PURCHASE_ORDER_STATUS_MAP[normalized] || normalized || '-'
    return { raw: normalized, label }
  }, [PURCHASE_ORDER_STATUS_MAP])

  const filteredReceipts = React.useMemo(() => {
    if (!Array.isArray(supplierReceipts)) return []
    const normalized = supplierReceipts
    if (receiptsTab === 'cancelled') {
      return normalized.filter(r => Number(r.docstatus) === 2)
    }
    if (receiptsTab === 'billed') {
      return normalized.filter(r =>
        Number(r.docstatus) === 1 &&
        getReceiptEstado(r) === 'facturado completamente'
      )
    }
    // pending
    return normalized.filter(r =>
      (() => {
        const estado = getReceiptEstado(r)
        const docstatus = Number(r.docstatus)
        if (docstatus === 2) return false
        if (docstatus === 1) {
          if (estado === 'facturado completamente') return false
          if (estado === 'facturado parcialmente' || estado === 'recibido pendiente de factura') return true
          return false
        }
        // borradores u otros se consideran pendientes
        return docstatus !== 2
      })()
    )
  }, [supplierReceipts, receiptsTab, getReceiptEstado])

  const filteredPurchaseOrders = React.useMemo(() => {
    if (!Array.isArray(supplierPurchaseOrders)) return []
    const normalized = supplierPurchaseOrders
    if (purchaseOrdersTab === 'cancelled') {
      return normalized.filter(order => {
        const estado = getPurchaseOrderEstado(order).label
        return estado === 'Cancelado' || estado === 'Cerrado'
      })
    }
    if (purchaseOrdersTab === 'billed') {
      return normalized.filter(order => {
        const estado = getPurchaseOrderEstado(order).label
        return estado === 'Completado'
      })
    }
    // pending
    return normalized.filter(order => {
      const estado = getPurchaseOrderEstado(order).label
      return estado === 'Borrador' || estado === 'En espera' || estado === 'Para recibir y pagar' || 
             estado === 'Por facturar' || estado === 'Recibir' || estado === 'Enviado'
    })
  }, [supplierPurchaseOrders, purchaseOrdersTab, getPurchaseOrderEstado])

  const [documentsSearchByTab, setDocumentsSearchByTab] = React.useState({})
  const receiptsSearchQuery = (documentsSearchByTab?.receipts || '').toString()
  const purchaseOrdersSearchQuery = (documentsSearchByTab?.['purchase-orders'] || '').toString()

  const receiptParentsForSearch = React.useMemo(() => {
    const result = []
    const seen = new Set()
    for (const receipt of filteredReceipts || []) {
      const name = receipt?.name
      if (!name) continue
      const key = String(name)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(key)
      if (result.length >= 500) break
    }
    return result
  }, [filteredReceipts])

  const purchaseOrderParentsForSearch = React.useMemo(() => {
    const result = []
    const seen = new Set()
    for (const order of filteredPurchaseOrders || []) {
      const name = order?.name
      if (!name) continue
      const key = String(name)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(key)
      if (result.length >= 500) break
    }
    return result
  }, [filteredPurchaseOrders])

  const receiptsItemsSearch = useDocumentItemsSearch({
    enabled: invoiceTab === 'receipts',
    query: receiptsSearchQuery,
    parents: receiptParentsForSearch,
    childDoctype: 'Purchase Receipt Item',
    parentDoctype: 'Purchase Receipt'
  })

  const purchaseOrdersItemsSearch = useDocumentItemsSearch({
    enabled: invoiceTab === 'purchase-orders',
    query: purchaseOrdersSearchQuery,
    parents: purchaseOrderParentsForSearch,
    childDoctype: 'Purchase Order Item',
    parentDoctype: 'Purchase Order'
  })

  const visibleReceipts = React.useMemo(() => (
    filterDocumentsByQuery(filteredReceipts, receiptsSearchQuery, {
      id: (receipt) => receipt?.name,
      dates: [(receipt) => receipt?.posting_date],
      text: [(receipt) => receipt?.custom_estado_remito, (receipt) => receipt?.status],
      amounts: [(receipt) => receipt?.grand_total, (receipt) => receipt?.total_qty],
      matchedParents: receiptsItemsSearch.matchedParents instanceof Set ? receiptsItemsSearch.matchedParents : null
    })
  ), [filteredReceipts, filterDocumentsByQuery, receiptsItemsSearch.matchedParents, receiptsSearchQuery])

  const visiblePurchaseOrders = React.useMemo(() => (
    filterDocumentsByQuery(filteredPurchaseOrders, purchaseOrdersSearchQuery, {
      id: (order) => order?.name,
      dates: [(order) => order?.transaction_date, (order) => order?.schedule_date],
      text: [(order) => order?.status],
      amounts: [(order) => order?.grand_total, (order) => order?.rounded_total],
      matchedParents: purchaseOrdersItemsSearch.matchedParents instanceof Set ? purchaseOrdersItemsSearch.matchedParents : null
    })
  ), [filterDocumentsByQuery, filteredPurchaseOrders, purchaseOrdersItemsSearch.matchedParents, purchaseOrdersSearchQuery])

  const receiptsSelectableItemsForUi = receiptsBulkMode ? visibleReceipts.filter(receipt => receipt?.name) : []
  const receiptsAllSelectedForUi = receiptsBulkMode && receiptsSelectableItemsForUi.length > 0 && receiptsSelectableItemsForUi.every(receipt => bulkSelectedSet.has(receipt.name))

  const pendingReceiptsCount = React.useMemo(() => {
    if (!Array.isArray(supplierReceipts)) return 0
    return supplierReceipts.filter(r => {
      const estado = getReceiptEstado(r)
      const docstatus = Number(r.docstatus)
      if (docstatus === 2) return false
      if (docstatus === 1) {
        if (estado === 'facturado completamente') return false
        return estado === 'recibido pendiente de factura' || estado === 'facturado parcialmente'
      }
      return docstatus !== 2
    }).length
  }, [supplierReceipts, getReceiptEstado])

  const pendingPurchaseOrdersCount = React.useMemo(() => {
    if (!Array.isArray(supplierPurchaseOrders)) return 0
    return supplierPurchaseOrders.filter(order => {
      const estado = getPurchaseOrderEstado(order).label
      return (
        estado === 'Borrador' || estado === 'En espera' || estado === 'Para recibir y pagar' ||
        estado === 'Por facturar' || estado === 'Recibir' || estado === 'Enviado'
      )
    }).length
  }, [supplierPurchaseOrders, getPurchaseOrderEstado])

  const balancedConciliations = React.useMemo(() => {
    if (!Array.isArray(conciliationGroups)) {
      return []
    }
    return conciliationGroups.filter(group => Math.abs(Number(group?.net_amount || 0)) < 1)
  }, [conciliationGroups])

  const unbalancedConciliations = React.useMemo(() => {
    if (!Array.isArray(conciliationGroups)) {
      return []
    }
    return conciliationGroups.filter(group => Math.abs(Number(group?.net_amount || 0)) >= 1)
  }, [conciliationGroups])

  const handleOpenConciliationDoc = React.useCallback((voucherNo, docType) => {
    if (!voucherNo) return
    if (typeof openStatementEntry === 'function') {
      openStatementEntry(voucherNo, docType)
      return
    }
    if (typeof handleOpenInvoice === 'function') {
      handleOpenInvoice(voucherNo)
    }
  }, [openStatementEntry, handleOpenInvoice])


  // Mostrar solo grupos hoja para la vista de detalles: evita mostrar "All Supplier Groups" u otros grupos padre
  const getDisplaySupplierGroupName = React.useCallback((supplierDetails) => {
    if (!supplierDetails || !supplierDetails.supplier_group) return 'No especificado'
    const groupName = supplierDetails.supplier_group
    if (!Array.isArray(supplierGroups) || supplierGroups.length === 0) return groupName

    // Buscar grupo que coincida por supplier_group_name o name
    const directMatch = supplierGroups.find(g => (g.supplier_group_name === groupName || g.name === groupName))
    if (directMatch && Number(directMatch.is_group) === 0) {
      return groupName.replace(/\s-\s[A-Za-z0-9]+$/i, '')
    }

    // Si el grupo guardado es un grupo padre (is_group=1), intentar encontrar una hoja hija correspondiente
    const childLeaf = supplierGroups.find(g => Number(g.is_group) === 0 && (g.parent_supplier_group === groupName || g.old_parent === groupName))
    if (childLeaf) return childLeaf.supplier_group_name.replace(/\s-\s[A-Za-z0-9]+$/i, '')

    // No es hoja -> still return a cleaned group name if available (strip company abbr)
    const cleaned = (groupName || '').toString().replace(/\s-\s[A-Za-z0-9]+$/i, '').trim()
    return cleaned || 'No especificado'
  }, [supplierGroups])
  const handleOpenItemSettings = async (item, itemIndex, onSaveItemSettings) => {
    console.log('handleOpenItemSettings called with item:', item, 'itemIndex:', itemIndex, 'onSaveItemSettings:', !!onSaveItemSettings)

    try {
      // Obtener la compañía activa para agregar la abbr al item_code
      const companyResponse = await fetchWithAuth('/api/active-company')
      if (!companyResponse.ok) {
        console.error('Error obteniendo compañía activa')
        setItemSettingsModal({
          isOpen: true,
          item: item,
          itemIndex: itemIndex,
          customer: supplierDetails, // Pasar la información del proveedor como customer
          onSaveItemSettings: onSaveItemSettings
        })
        return
      }

      const companyData = await companyResponse.json()
      const activeCompanyAbbr = companyData.data?.company_details?.abbr

      if (!activeCompanyAbbr) {
        console.error('Abbr de compañía activa no encontrada:', companyData)
        setItemSettingsModal({
          isOpen: true,
          item: item,
          itemIndex: itemIndex,
          customer: supplierDetails, // Pasar la información del proveedor como customer
          onSaveItemSettings: onSaveItemSettings
        })
        return
      }

      // Agregar la abbr de la compañía al item_code
      const itemCodeWithAbbr = `${item.item_code} - ${activeCompanyAbbr}`

      // Obtener el item completo de ERPNext usando el item_code con abbr
      const itemResponse = await fetchWithAuth(`/api/items/${encodeURIComponent(itemCodeWithAbbr)}`)

      if (itemResponse.ok) {
        const fullItem = await itemResponse.json()
        console.log('Full item data received:', fullItem)

        setItemSettingsModal({
          isOpen: true,
          item: fullItem.data,
          itemIndex: itemIndex,
          customer: supplierDetails, // Pasar la información del proveedor como customer
          onSaveItemSettings: onSaveItemSettings
        })
      } else {
        console.error('Error obteniendo item completo:', itemResponse.status)
        // Si falla, usar el item original
        setItemSettingsModal({
          isOpen: true,
          item: item,
          itemIndex: itemIndex,
          customer: supplierDetails // Pasar la información del proveedor como customer
        })
      }
    } catch (error) {
      console.error('Error en handleOpenItemSettings:', error)
      // Si falla, usar el item original
      setItemSettingsModal({
        isOpen: true,
        item: item,
        itemIndex: itemIndex,
        customer: supplierDetails, // Pasar la información del proveedor como customer
        onSaveItemSettings: onSaveItemSettings
      })
    }
  }

  return (
    <div className="h-full flex gap-6">
      {/* Panel izquierdo - Lista de proveedores */}
      <div className="w-1/3 bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden flex flex-col">
        <div className="accounting-card-title">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-black text-gray-900">Proveedores</h3>
            </div>
            <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                    onClick={handleAddSupplier}>
              <Plus className="w-4 h-4 mr-2" />
              Agregar Proveedor
            </button>
          </div>
        </div>

        {/* Barra de búsqueda */}
        <div className="px-4 py-2 border-b border-gray-200">
          <input
            type="text"
            placeholder="Buscar proveedor..."
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>

        <div className="flex-1 p-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">Cargando proveedores...</span>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Encabezado de la tabla */}
              <div className="flex items-center justify-between py-3 px-3 bg-gray-100 rounded-lg font-semibold text-gray-700 text-sm border-b border-gray-200">
                <div className="flex items-center flex-1 gap-2">
                  <span>Proveedor</span>
                  {/* Toggle para nombre comercial/fiscal */}
                  <label 
                    className="flex items-center gap-1 text-xs font-normal cursor-pointer ml-2"
                    title={showCommercialName ? 'Mostrando nombre comercial' : 'Mostrando nombre fiscal'}
                  >
                    <span className={`${!showCommercialName ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>Fiscal</span>
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowCommercialName(!showCommercialName)
                      }}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors cursor-pointer ${
                        showCommercialName ? 'bg-blue-600' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          showCommercialName ? 'translate-x-3.5' : 'translate-x-0.5'
                        }`}
                      />
                    </div>
                    <span className={`${showCommercialName ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>Comercial</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right min-w-[80px]">
                    <span>Saldo</span>
                  </div>
                  {/* Botón para cargar saldos */}
                  <button
                    onClick={onFetchBalances}
                    disabled={loadingBalances || balancesLoaded}
                    className={`p-1 rounded-lg transition-all duration-200 ${
                      balancesLoaded
                        ? 'text-green-600 cursor-default'
                        : loadingBalances
                          ? 'text-blue-600 cursor-wait'
                          : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
                    }`}
                    title={balancesLoaded ? 'Saldos cargados' : loadingBalances ? 'Cargando saldos...' : 'Cargar saldos'}
                  >
                    {balancesLoaded ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : loadingBalances ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              {filterSuppliers(suppliers, supplierSearch).map(supplier => (
                <div
                  key={supplier.name}
                  className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-all duration-200 hover:bg-gray-100 ${
                    selectedSupplier === supplier.name ? 'bg-gray-200 border-l-4 border-gray-600' : ''
                  }`}
                  onClick={() => setSelectedSupplier(supplier.name)}
                >
                  <div className="flex items-center">
                    <FileText className={`w-4 h-4 mr-2 text-gray-600`} />
                    <span className={`text-sm font-medium text-gray-900`}>
                      {showCommercialName && supplier.supplier_details 
                        ? supplier.supplier_details 
                        : (supplier.supplier_name || supplier.name)}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <div className={`text-right min-w-[80px] font-semibold ${
                      supplier.outstanding_amount === null
                        ? 'text-gray-400'
                        : supplier.outstanding_amount > 0
                          ? 'text-red-600'
                          : 'text-gray-900'
                    }`}>
                      {supplier.outstanding_amount === null
                        ? '-'
                        : formatBalance(supplier.outstanding_amount || 0)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panel derecho - Detalles del proveedor */}
      <div className="flex-1 flex flex-col gap-6">
        {/* Panel de detalles del proveedor */}
        <div className={`bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden ${!isSupplierDetailsPanelExpanded ? 'flex-shrink-0' : ''}`}>
          <div 
            className="accounting-card-title bg-gray-50 border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={() => {
              const newExpanded = !isSupplierDetailsPanelExpanded
              setIsSupplierDetailsPanelExpanded(newExpanded)
              if (newExpanded && loadSupplierDetailsOnExpand) {
                loadSupplierDetailsOnExpand()
              }
            }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-200 rounded-lg">
                  <FileText className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">
                    {isEditingSupplier && selectedSupplier === 'new' ? 'Nuevo Proveedor' :
                     selectedSupplier ? `Proveedor: ${supplierDetails?.supplier_name || selectedSupplier}` : 'Selecciona un proveedor'}
                  </h3>
                  {selectedSupplier && supplierDetails && isSupplierDetailsPanelExpanded && (
                    <p className="text-sm text-gray-600 font-medium">
                      {supplierDetails.supplier_group && `Grupo: ${getDisplaySupplierGroupName(supplierDetails)}`}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(selectedSupplier || isEditingSupplier) && (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    {isEditingSupplier ? (
                      <div className="flex gap-2">
                        <button
                          onClick={handleCancelEdit}
                          disabled={savingSupplier}
                          className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl bg-white hover:bg-gray-50 transition-all duration-300 shadow-sm hover:shadow-md disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={selectedSupplier === 'new' ? handleCreateSupplier : handleSaveSupplier}
                          disabled={savingSupplier}
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                        >
                          {savingSupplier ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                              Guardando...
                            </>
                          ) : (
                            <>
                              <Save className="w-4 h-4 mr-2" />
                              Guardar Cambios
                            </>
                          )}
                        </button>
                      </div>
                    ) : selectedSupplier ? (
                      <>
                        <button className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                                title="Editar proveedor"
                                onClick={handleEditSupplier}>
                          <Edit className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100/80 rounded-xl transition-all duration-300"
                                title="Eliminar proveedor"
                                onClick={handleDeleteSupplier}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
                {/* Icono para expandir/colapsar */}
                {selectedSupplier && !isEditingSupplier && (
                  <div className="p-2 text-gray-500">
                    {isSupplierDetailsPanelExpanded ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contenido del panel - solo visible cuando está expandido O cuando está editando */}
          {(isSupplierDetailsPanelExpanded || isEditingSupplier) && (
            <>
              {loadingSupplierDetails && !isEditingSupplier ? (
                <div className="flex items-center justify-center py-8 bg-gray-50">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                  <span className="ml-3 text-gray-600">Cargando detalles...</span>
                </div>
              ) : (
                <div className="p-4 bg-gray-50">
                  {isEditingSupplier ? (
                    <>
                {/* Pestañas de edición */}
                <nav className="tab-nav mb-6">
                  <button
                    onClick={() => setSupplierTab('general')}
                    className={`tab-button ${supplierTab === 'general' ? 'active' : ''}`}
                  >
                    General
                  </button>
                  <button
                    onClick={() => setSupplierTab('comercial')}
                    className={`tab-button ${supplierTab === 'comercial' ? 'active' : ''}`}
                  >
                    Comercial
                  </button>
                  <button
                    onClick={() => setSupplierTab('contacto')}
                    className={`tab-button ${supplierTab === 'contacto' ? 'active' : ''}`}
                  >
                    Contacto
                  </button>
                  <button
                    onClick={() => setSupplierTab('fiscal')}
                    className={`tab-button ${supplierTab === 'fiscal' ? 'active' : ''}`}
                  >
                    Información Fiscal
                  </button>
                  <button
                    onClick={() => setSupplierTab('direccion')}
                    className={`tab-button ${supplierTab === 'direccion' ? 'active' : ''}`}
                  >
                    Dirección
                  </button>
                </nav>

                {/* Contenido de las pestañas de edición */}
                {supplierTab === 'general' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre fiscal *</label>
                        <input
                          type="text"
                          value={editedSupplierData.supplier_name || ''}
                          onChange={(e) => handleEditChange('supplier_name', e.target.value)}
                          placeholder="Razón social / Nombre fiscal"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre comercial</label>
                        <input
                          type="text"
                          value={editedSupplierData.supplier_details || ''}
                          onChange={(e) => handleEditChange('supplier_details', e.target.value)}
                          placeholder="Nombre comercial / Fantasía"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">CUIT</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={editedSupplierData.tax_id || ''}
                            onChange={(e) => handleEditChange('tax_id', e.target.value)}
                            placeholder="XX-XXXXXXXX-X"
                            className="w-full pr-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                          <button
                            type="button"
                            onClick={() => handleSearchAfip(editedSupplierData.tax_id)}
                            disabled={consultingAfip}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-blue-600 disabled:opacity-50"
                            title={consultingAfip ? "Consultando AFIP..." : "Buscar en AFIP"}
                          >
                            {consultingAfip ? (
                              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                              <Search className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Fecha alta</label>
                          <input
                            type="date"
                            value={editedSupplierData.fecha_alta || ''}
                            readOnly
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Grupo de proveedor</label>
                          <div className="flex space-x-2">
                            <select
                              value={editedSupplierData.supplier_group || ''}
                              onChange={(e) => handleEditChange('supplier_group', e.target.value)}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
                            >
                              <option value="">Seleccionar grupo...</option>
                              {supplierGroups.filter(group => group.is_group === 0).map((group) => (
                                <option key={group.name} value={group.supplier_group_name}>
                                  {group.supplier_group_name ? group.supplier_group_name.replace(/\s-\s[A-Za-z0-9]+$/i, '') : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => onOpenSupplierGroupModal && onOpenSupplierGroupModal()}
                              className="px-3 py-2 bg-green-500 text-black rounded-lg hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
                              title="Gestionar grupos de proveedores"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {supplierGroups.length === 1 
                              ? 'Solo hay un grupo disponible. Haga clic en + para crear más grupos.' 
                              : 'Seleccione un grupo existente o haga clic en + para crear uno nuevo'
                            }
                          </p>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta por Pagar</label>
                        <Select
                          value={availableLiabilityAccounts.find(acc => acc.name === editedSupplierData.default_payable_account) ?
                            { value: editedSupplierData.default_payable_account, label: availableLiabilityAccounts.find(acc => acc.name === editedSupplierData.default_payable_account).account_name } : null}
                          onChange={(selectedOption) => handleEditChange('default_payable_account', selectedOption ? selectedOption.value : '')}
                          options={availableLiabilityAccounts.map((account) => ({
                            value: account.name,
                            label: account.account_name
                          }))}
                          placeholder="Seleccionar cuenta..."
                          isClearable
                          isSearchable
                          className="w-full"
                          classNamePrefix="react-select"
                          styles={{
                            control: (provided, state) => ({
                              ...provided,
                              border: '1px solid #d1d5db',
                              borderRadius: '0.5rem',
                              padding: '0.125rem',
                              '&:hover': {
                                borderColor: '#3b82f6'
                              },
                              boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                            }),
                            option: (provided, state) => ({
                              ...provided,
                              backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                              color: state.isSelected ? 'white' : '#374151'
                            }),
                            menu: (provided) => ({
                              ...provided,
                              zIndex: 99999
                            }),
                            menuPortal: (provided) => ({
                              ...provided,
                              zIndex: 99999
                            })
                          }}
                          menuPortalTarget={document.body}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta de Gastos</label>
                        <Select
                          value={availableExpenseAccounts.find(acc => acc.name === editedSupplierData.default_expense_account) ? 
                            { value: editedSupplierData.default_expense_account, label: availableExpenseAccounts.find(acc => acc.name === editedSupplierData.default_expense_account).account_name } : null}
                          onChange={(selectedOption) => handleEditChange('default_expense_account', selectedOption ? selectedOption.value : '')}
                          options={availableExpenseAccounts.map((account) => ({
                            value: account.name,
                            label: account.account_name
                          }))}
                          placeholder="Seleccionar cuenta..."
                          isClearable
                          isSearchable
                          className="w-full"
                          classNamePrefix="react-select"
                          styles={{
                            control: (provided, state) => ({
                              ...provided,
                              border: '1px solid #d1d5db',
                              borderRadius: '0.5rem',
                              padding: '0.125rem',
                              '&:hover': {
                                borderColor: '#3b82f6'
                              },
                              boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                            }),
                            option: (provided, state) => ({
                              ...provided,
                              backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                              color: state.isSelected ? 'white' : '#374151'
                            }),
                            menu: (provided) => ({
                              ...provided,
                              zIndex: 99999
                            }),
                            menuPortal: (provided) => ({
                              ...provided,
                              zIndex: 99999
                            })
                          }}
                          menuPortalTarget={document.body}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {supplierTab === 'comercial' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Condición de Pago</label>
                        <select
                          value={editedSupplierData.payment_terms || ''}
                          onChange={(e) => handleEditChange('payment_terms', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Seleccionar condición de pago...</option>
                          {paymentTermsTemplates.map((template) => (
                            <option key={template.name} value={template.template_name}>
                              {template.template_name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">% Descuento</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={editedSupplierData.discount_percentage || ''}
                          onChange={(e) => handleEditChange('discount_percentage', e.target.value)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Lista de Precios por Defecto</label>
                        <select
                          value={editedSupplierData.custom_default_price_list || ''}
                          onChange={(e) => handleEditChange('custom_default_price_list', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Seleccionar lista de precios por defecto...</option>
                          {availablePriceLists.map((list) => (
                            <option key={list.name} value={list.name}>
                              {list.price_list_name} ({list.currency})
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Esta lista se seleccionará automáticamente en nuevas facturas de compra</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Transportista</label>
                        <input
                          type="text"
                          value={editedSupplierData.transporter || ''}
                          onChange={(e) => handleEditChange('transporter', e.target.value)}
                          placeholder="Nombre del transportista"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {supplierTab === 'contacto' && (
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Sitio web</label>
                      <input
                        type="text"
                        value={editedSupplierData.website || ''}
                        onChange={(e) => handleEditChange('website', e.target.value)}
                        placeholder="https://www.ejemplo.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                      <input
                        type="email"
                        value={editedSupplierData.email || ''}
                        onChange={(e) => handleEditChange('email', e.target.value)}
                        placeholder="proveedor@ejemplo.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
                      <input
                        type="text"
                        value={editedSupplierData.phone || ''}
                        onChange={(e) => handleEditChange('phone', e.target.value)}
                        placeholder="+54 11 1234-5678"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Contacto</label>
                      <input
                        type="text"
                        value={editedSupplierData.contacto || ''}
                        onChange={(e) => handleEditChange('contacto', e.target.value)}
                        placeholder="Nombre del contacto"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                )}

                {supplierTab === 'fiscal' && (
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">CUIT</label>
                      <input
                        type="text"
                        value={editedSupplierData.tax_id || ''}
                        onChange={(e) => handleEditChange('tax_id', e.target.value)}
                        placeholder="XX-XXXXXXXX-X"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Condición frente al IVA</label>
                      <select
                        value={editedSupplierData.custom_condicion_iva || ''}
                        onChange={(e) => handleEditChange('custom_condicion_iva', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Seleccionar condición...</option>
                        <option value="Responsable Inscripto">RI - Responsable Inscripto</option>
                        <option value="Monotributista">Monotributista</option>
                        <option value="Exento">Exento</option>
                        <option value="Consumidor Final">Exento Consumidor Final</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">IVA %</label>
                      <select
                        value={editedSupplierData.custom_default_iva_compras || ''}
                        onChange={(e) => handleEditChange('custom_default_iva_compras', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Seleccionar plantilla de IVA...</option>
                        {taxTemplates
                          .filter(template => templateMatchesType(template, TEMPLATE_TYPES.PURCHASE))
                          .map((template) => (
                            <option key={template.name} value={template.name}>
                              {template.title || template.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                )}

                {supplierTab === 'direccion' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Dirección</label>
                        <input
                          type="text"
                          value={editedSupplierData.address || ''}
                          onChange={(e) => handleEditChange('address', e.target.value)}
                          placeholder="Dirección completa"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Ciudad</label>
                        <input
                          type="text"
                          value={editedSupplierData.ciudad || ''}
                          onChange={(e) => handleEditChange('ciudad', e.target.value)}
                          placeholder="Ciudad"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Código Postal</label>
                        <input
                          type="text"
                          value={editedSupplierData.codigo_postal || ''}
                          onChange={(e) => handleEditChange('codigo_postal', e.target.value)}
                          placeholder="Código postal"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Provincia</label>
                        <input
                          type="text"
                          value={editedSupplierData.provincia || ''}
                          onChange={(e) => handleEditChange('provincia', e.target.value)}
                          placeholder="Provincia"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">País</label>
                        <select
                          value={editedSupplierData.pais || 'Argentina'}
                          onChange={(e) => handleEditChange('pais', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="Argentina">Argentina</option>
                          <option value="Chile">Chile</option>
                          <option value="Uruguay">Uruguay</option>
                          <option value="Paraguay">Paraguay</option>
                          <option value="Bolivia">Bolivia</option>
                          <option value="Brasil">Brasil</option>
                          <option value="Otro">Otro</option>
                        </select>
                      </div>
                    </div>

                    {/* Botón para gestionar direcciones */}
                    <div className="col-span-2 mt-4">
                      <button
                        onClick={() => setIsAddressModalOpen(true)}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                      >
                        <MapPin size={16} className="mr-2" />
                        Gestionar Direcciones
                      </button>
                    </div>
                  </div>
                )}

                {supplierTab === 'cuenta' && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta por Pagar</label>
                      <Select
                        value={availableAccounts.find(acc => acc.name === editedSupplierData.default_payable_account) ? 
                          { value: editedSupplierData.default_payable_account, label: availableAccounts.find(acc => acc.name === editedSupplierData.default_payable_account).account_name } : null}
                        onChange={(selectedOption) => handleEditChange('default_payable_account', selectedOption ? selectedOption.value : '')}
                        options={availableAccounts.map((account) => ({
                          value: account.name,
                          label: account.account_name
                        }))}
                        placeholder="Seleccionar cuenta..."
                        isClearable
                        isSearchable
                        className="w-full"
                        classNamePrefix="react-select"
                        styles={{
                          control: (provided, state) => ({
                            ...provided,
                            border: '1px solid #d1d5db',
                            borderRadius: '0.5rem',
                            padding: '0.125rem',
                            '&:hover': {
                              borderColor: '#3b82f6'
                            },
                            boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                          }),
                          option: (provided, state) => ({
                            ...provided,
                            backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                            color: state.isSelected ? 'white' : '#374151'
                          })
                        }}
                      />
                      <p className="text-sm text-gray-500 mt-1">Cuenta por defecto para los pagos a este proveedor</p>
                    </div>
                  </div>
                )}
              </>
            ) : supplierDetails ? (
              <>
                {/* Pestañas de visualización */}
                <nav className="tab-nav mb-6">
                  <button
                    onClick={() => setSupplierTab('general')}
                    className={`tab-button ${supplierTab === 'general' ? 'active' : ''}`}
                  >
                    General
                  </button>
                  <button
                    onClick={() => setSupplierTab('comercial')}
                    className={`tab-button ${supplierTab === 'comercial' ? 'active' : ''}`}
                  >
                    Comercial
                  </button>
                  <button
                    onClick={() => setSupplierTab('contacto')}
                    className={`tab-button ${supplierTab === 'contacto' ? 'active' : ''}`}
                  >
                    Contacto
                  </button>
                  <button
                    onClick={() => setSupplierTab('fiscal')}
                    className={`tab-button ${supplierTab === 'fiscal' ? 'active' : ''}`}
                  >
                    Información Fiscal
                  </button>
                  <button
                    onClick={() => setSupplierTab('direccion')}
                    className={`tab-button ${supplierTab === 'direccion' ? 'active' : ''}`}
                  >
                    Dirección
                  </button>
                </nav>

                {/* Contenido de las pestañas de visualización */}
                {supplierTab === 'general' && (
                  <div className="space-y-2 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Nombre fiscal:</span>
                        <span className="text-gray-900 font-medium ml-2">{supplierDetails.supplier_name || supplierDetails.name}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Nombre comercial:</span>
                        <span className="text-gray-900 font-medium ml-2">{supplierDetails.supplier_details || 'No especificado'}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Grupo de proveedor:</span>
                        <span className="text-gray-900 font-medium ml-2">{getDisplaySupplierGroupName(supplierDetails)}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Fecha alta:</span>
                        <span className="text-gray-900 font-medium ml-2">
                          {supplierDetails.creation ? new Date(supplierDetails.creation).toLocaleDateString('es-ES', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          }) : 'No especificada'}
                        </span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Cuenta por Pagar:</span>
                        <span className="text-gray-900 font-medium ml-2">{extractAccountDescription(supplierDetails.default_payable_account)}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Cuenta de Gastos:</span>
                                                <span className="text-gray-900 font-medium ml-2">{extractAccountDescription(supplierDetails.default_expense_account)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {supplierTab === 'comercial' && (
                  <div className="space-y-2 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Condición de Pago:</span>
                        <span className="text-gray-900 font-medium ml-2">{supplierDetails.payment_terms || 'No especificada'}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">% Descuento:</span>
                        <span className="text-gray-900 font-medium ml-2">{supplierDetails.discount_percentage ? `${supplierDetails.discount_percentage}%` : 'No especificado'}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Lista de Precios por Defecto:</span>
                        <span className="text-gray-900 font-medium ml-2">{supplierDetails.custom_default_price_list || 'No especificada'}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Transportista:</span>
                        <span className="text-gray-900 font-medium ml-2">{supplierDetails.transporter || 'No especificado'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {supplierTab === 'contacto' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Sitio web:</span>
                      <span className="text-gray-900 font-medium ml-2">{supplierDetails.website || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Email:</span>
                      <span className="text-gray-900 font-medium ml-2">{supplierDetails.email || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Teléfono:</span>
                      <span className="text-gray-900 font-medium ml-2">{supplierDetails.phone || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Contacto:</span>
                      <span className="text-gray-900 font-medium ml-2">{supplierDetails.contacto || 'No especificado'}</span>
                    </div>
                  </div>
                )}

                {supplierTab === 'fiscal' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">CUIT:</span>
                      <span className="text-gray-900 font-medium ml-2">{supplierDetails.tax_id || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Condición frente al IVA:</span>
                      <span className="text-gray-900 font-medium ml-2">{supplierDetails.custom_condicion_iva || 'No especificada'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">IVA %:</span>
                      <span className="text-gray-900 font-medium ml-2">{supplierDetails.custom_default_iva_compras || 'No especificada'}</span>
                    </div>
                  </div>
                )}

                {supplierTab === 'direccion' && (
                  <div className="space-y-4 mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-medium text-gray-900">Dirección Fiscal</h4>
                      <button
                        onClick={() => setIsAddressModalOpen(true)}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                        title="Gestionar direcciones adicionales"
                      >
                        <MapPin size={16} className="mr-2" />
                        Gestionar Direcciones
                      </button>
                    </div>
                    {(() => {
                      const fiscalAddress = supplierAddresses.find(address =>
                        address.address_type === 'Billing' ||
                        address.address_type === 'Dirección Fiscal' ||
                        (address.address_type === 'Other' && address.custom_type === 'Fiscal')
                      )

                      if (fiscalAddress) {
                        return (
                          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <span className="text-sm font-semibold text-gray-600">Dirección:</span>
                                <span className="text-gray-900 font-medium ml-2">{fiscalAddress.address_line1 || 'No especificada'}</span>
                              </div>
                              <div>
                                <span className="text-sm font-semibold text-gray-600">Ciudad:</span>
                                <span className="text-gray-900 font-medium ml-2">{fiscalAddress.city || 'No especificada'}</span>
                              </div>
                              <div>
                                <span className="text-sm font-semibold text-gray-600">Código Postal:</span>
                                <span className="text-gray-900 font-medium ml-2">{fiscalAddress.pincode || 'No especificado'}</span>
                              </div>
                              <div>
                                <span className="text-sm font-semibold text-gray-600">Provincia:</span>
                                <span className="text-gray-900 font-medium ml-2">{fiscalAddress.state || 'No especificada'}</span>
                              </div>
                              <div>
                                <span className="text-sm font-semibold text-gray-600">País:</span>
                                <span className="text-gray-900 font-medium ml-2">{fiscalAddress.country || 'No especificado'}</span>
                              </div>
                            </div>
                          </div>
                        )
                      } else {
                        return (
                          <div className="text-center py-8 text-gray-500">
                            <MapPin className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>No hay dirección fiscal configurada</p>
                          </div>
                        )
                      }
                    })()}
                  </div>
                )}

                {supplierTab === 'cuenta' && (
                  <div className="max-w-md mt-4 space-y-4">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Cuenta por Pagar:</span>
                      <span className="text-gray-900 font-medium text-lg ml-2">{supplierDetails.default_payable_account || 'No especificada'}</span>
                      <p className="text-sm text-gray-600 mt-2">Cuenta por defecto para los pagos a este proveedor</p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Selecciona un proveedor del panel izquierdo para ver sus detalles</p>
              </div>
            )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Panel de facturas y cuenta corriente */}
        <div className={`bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden ${!isSupplierDetailsPanelExpanded ? 'flex-1' : 'flex-1'}`}>
          <div className="accounting-card-title">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-black text-gray-900">
                  Facturas y Cuenta Corriente
                </h3>
              </div>
              {selectedSupplier && (
                <div className="action-chip-group">
                  <ActionChip
                    icon={FilePlus2}
                    variant="invoice"
                    label="Nueva factura"
                    helper="Compra / nota"
                    onClick={() => {
                      setEditingInvoice(null)
                      setIsInvoiceModalOpen(true)
                    }}
                  />
                  {onCreatePurchaseOrder && (
                    <ActionChip
                      icon={ClipboardList}
                      variant="order"
                      label="Orden de compra"
                      helper="Planificar pedido"
                      onClick={onCreatePurchaseOrder}
                    />
                  )}
                  {onCreateRemito && (
                    <ActionChip
                      icon={Layers}
                      variant="remito"
                      label="Nuevo remito"
                      helper="Ingreso mercadería"
                      onClick={onCreateRemito}
                    />
                  )}
                  {setIsPaymentModalOpen && (
                    <ActionChip
                      icon={DollarSign}
                      variant="payment"
                      label="Registrar pago"
                      helper="Orden / pago a proveedor"
                      onClick={() => {
                        if (setEditingPayment) {
                          setEditingPayment(null)
                        }
                        setIsPaymentModalOpen(true)
                      }}
                    />
                  )}
                  {setIsReconciliationModalOpen && (
                    <ActionChip
                      icon={Calculator}
                      variant="reconcile"
                      label="Conciliar facturas"
                      helper="Aplicar pagos/ND"
                      onClick={() => setIsReconciliationModalOpen(true)}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Pestañas de facturas: sólo mostrar cuando hay un proveedor seleccionado */}
          {selectedSupplier ? (
            <div className="tab-bar-with-action">
              <nav className="tab-nav">
                <button
                  onClick={() => setInvoiceTab('unpaid')}
                  className={`tab-button ${invoiceTab === 'unpaid' ? 'active' : ''}`}
                >
                  Facturas Pendientes ({unpaidInvoicesCount})
                </button>
                <button
                  onClick={() => setInvoiceTab('draft')}
                  className={`tab-button ${invoiceTab === 'draft' ? 'active' : ''}`}
                >
                  Facturas Borrador ({draftInvoicesCount})
                </button>
                <button
                  onClick={() => setInvoiceTab('receipts')}
                  className={`tab-button ${invoiceTab === 'receipts' ? 'active' : ''}`}
                >
                  Remitos ({pendingReceiptsCount || 0})
                </button>
                <button
                  onClick={() => setInvoiceTab('purchase-orders')}
                  className={`tab-button ${invoiceTab === 'purchase-orders' ? 'active' : ''}`}
                >
                  Ordenes de compra ({pendingPurchaseOrdersCount})
                </button>
                <button
                  onClick={() => setInvoiceTab('statement')}
                  className={`tab-button ${invoiceTab === 'statement' ? 'active' : ''}`}
                >
                  Cuenta Corriente
                </button>
              </nav>
              {canUseBulkDelete && (
                <button
                  className={`bulk-delete-toggle ${isBulkMode ? 'active' : ''}`}
                  onClick={() => onToggleBulkDelete && onToggleBulkDelete()}
                  disabled={isBulkDeleting}
                  title={isBulkMode ? 'Eliminar seleccionados' : 'Seleccionar documentos para eliminar'}
                >
                  <Trash2 className="w-4 h-4" />
                  {isBulkMode && bulkSelectedCount > 0 && (
                    <span className="bulk-delete-count">{bulkSelectedCount}</span>
                  )}
                </button>
              )}
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500">Selecciona un proveedor para ver Facturas y Cuenta Corriente</div>
          )}

          <div className="p-6">
            {invoiceTab === 'unpaid' || invoiceTab === 'draft' ? (
              <div className="space-y-4">
                {renderInvoicesTable(
                  supplierInvoices,
                  invoiceBulkOptions || undefined,
                  invoiceTab === 'unpaid'
                    ? {
                        summaryGroups: unbalancedConciliations,
                        onOpenConciliationDocument: handleOpenConciliationDoc
                      }
                    : undefined
                )}
              </div>
            ) : invoiceTab === 'receipts' ? (
              <div className="space-y-4">
	                <div className="flex gap-2 mb-4">
	                  <button
	                    onClick={() => setReceiptsTab('pending')}
	                    className={`tab-button ${receiptsTab === 'pending' ? 'active' : ''}`}
	                  >
	                    Pendientes
	                  </button>
                  <button
                    onClick={() => setReceiptsTab('billed')}
                    className={`tab-button ${receiptsTab === 'billed' ? 'active' : ''}`}
                  >
                    Facturados
                  </button>
                  <button
                    onClick={() => setReceiptsTab('cancelled')}
                    className={`tab-button ${receiptsTab === 'cancelled' ? 'active' : ''}`}
                  >
                    Cancelados
	                  </button>
	                </div>

	                <div className="px-4 py-3 bg-white border border-gray-200 rounded-2xl">
	                  <div className="flex items-center gap-2">
	                    <input
	                      type="text"
	                      value={receiptsSearchQuery}
	                      onChange={(e) => setDocumentsSearchByTab((prev) => ({ ...(prev || {}), receipts: e.target.value ?? '' }))}
	                      placeholder="Buscar por nro, fecha, estado, monto o item..."
	                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
	                    />
	                    {receiptsItemsSearch.loading && (
	                      <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
	                    )}
	                    {!!receiptsSearchQuery && (
	                      <button
	                        type="button"
	                        onClick={() => setDocumentsSearchByTab((prev) => ({ ...(prev || {}), receipts: '' }))}
	                        className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
	                        title="Limpiar b£squeda"
	                      >
	                        Limpiar
	                      </button>
	                    )}
	                  </div>
	                  {receiptsItemsSearch.enabled && receiptsItemsSearch.error && (
	                    <div className="mt-2 text-xs text-red-600">{receiptsItemsSearch.error}</div>
	                  )}
	                </div>
	
	                {isLoadingReceipts ? (
	                  <div className="flex items-center justify-center py-12">
	                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
	                    <span className="ml-3 text-gray-600">Cargando remitos...</span>
	                  </div>
	                ) : !filteredReceipts || filteredReceipts.length === 0 ? (
	                  <div className="text-center py-12 text-gray-500">
	                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
	                    <p>No hay remitos para mostrar</p>
	                  </div>
	                ) : receiptsSearchQuery.trim() && (!visibleReceipts || visibleReceipts.length === 0) ? (
	                  <div className="text-center py-12 text-gray-500">
	                    <div className="text-4xl mb-4">🔎</div>
	                    <p>No hay resultados para tu b£squeda</p>
	                  </div>
	                ) : (
	                  <div className="space-y-4">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
	                            {receiptsBulkMode && (
	                              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
	                                <input
	                                  type="checkbox"
	                                  className="form-checkbox h-4 w-4 text-red-600"
	                                  checked={receiptsAllSelectedForUi}
	                                  onChange={(e) => onBulkSelectAll && onBulkSelectAll('receipts', visibleReceipts, e.target.checked)}
	                                  disabled={isBulkDeleting || (visibleReceipts?.length || 0) === 0}
	                                />
	                              </th>
	                            )}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Nro. Remito
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Fecha
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Estado
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Cantidad Total
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
	                          {visibleReceipts.map(receipt => {
	                            const rowSelectable = Boolean(receipt?.name)
	                            const canOpenReceipt = !receiptsBulkMode
	                            const displayCode = (() => {
	                              if (receipt.base_code) return receipt.base_code
	                              const name = receipt?.name ? String(receipt.name) : ''
	                              if (!name) return name
	                              const parts = name.split('-')
	                              if (parts.length < 2) return name
	                              const last = parts[parts.length - 1]
	                              if (/^\d+$/.test(last) && last.length > 8) {
	                                parts[parts.length - 1] = last.slice(0, -5)
	                                return parts.join('-')
	                              }
	                              return name
	                            })()
	                            const estadoRaw = getReceiptEstado(receipt)
	                            const isCancelled = Number(receipt.docstatus) === 2
	                            const displayEstado = isCancelled
                              ? 'Cancelado'
                              : receipt.custom_estado_remito || receipt.status || (receipt.docstatus === 1 ? 'Confirmado' : receipt.docstatus === 0 ? 'Borrador' : 'Cancelado')
                            let estadoClass = 'bg-gray-100 text-gray-800'
                            let isPartial = false
                            if (isCancelled) {
                              estadoClass = 'bg-red-100 text-red-800'
                            } else if (estadoRaw === 'recibido pendiente de factura') {
                              estadoClass = 'bg-yellow-100 text-yellow-800'
                            } else if (estadoRaw === 'facturado parcialmente') {
                              estadoClass = 'bg-blue-100 text-blue-800'
                              isPartial = true
                            } else if (estadoRaw === 'facturado completamente') {
                              estadoClass = 'bg-green-100 text-green-800'
                            } else if (Number(receipt.docstatus) === 1) {
                              estadoClass = 'bg-green-100 text-green-800'
                            } else if (Number(receipt.docstatus) === 0) {
                              estadoClass = 'bg-yellow-100 text-yellow-800'
                            }
                            return (
                              <tr
                                key={receipt.name}
                                className={`hover:bg-gray-50 ${canOpenReceipt ? 'cursor-pointer' : ''} transition-colors duration-150`}
                                onDoubleClick={canOpenReceipt && onOpenRemito ? () => onOpenRemito(receipt.name) : undefined}
                              >
                                {receiptsBulkMode && (
                                  <td className="px-3 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      className="form-checkbox h-4 w-4 text-red-600"
                                      checked={rowSelectable && bulkSelectedSet.has(receipt.name)}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        if (rowSelectable) {
                                          onBulkRowToggle && onBulkRowToggle(receipt.name, e.target.checked)
                                        }
                                      }}
                                      disabled={!rowSelectable || isBulkDeleting}
                                    />
                                  </td>
                                )}
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {formatVoucherNumber ? formatVoucherNumber(displayCode || receipt.name) : (displayCode || receipt.name)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {formatDate ? formatDate(receipt.posting_date) : receipt.posting_date}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center gap-2 px-2 py-1 text-xs font-semibold rounded-full ${estadoClass}`}
                                  >
                                    {displayEstado}
                                    {isPartial && <span className="inline-flex w-2 h-2 rounded-full bg-blue-700" title="Facturado parcialmente" />}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {receipt.total_qty || 0}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {formatBalance ? formatBalance(receipt.grand_total || 0) : receipt.grand_total || 0}
                                </td>
                              </tr>
                            )
                          })}

                        </tbody>
                      </table>
                    </div>
                    {/* Controles de paginación */}
                    {receiptsPagination && receiptsPagination.total > receiptsPagination.pageSize && (
                      <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200 sm:px-6">
                        <div className="flex items-center">
                          <p className="text-sm text-gray-700">
                            Mostrando{' '}
                            <span className="font-medium">
                              {Math.min((receiptsPagination.page - 1) * receiptsPagination.pageSize + 1, receiptsPagination.total)}
                            </span>{' '}
                            a{' '}
                            <span className="font-medium">
                              {Math.min(receiptsPagination.page * receiptsPagination.pageSize, receiptsPagination.total)}
                            </span>{' '}
                            de{' '}
                            <span className="font-medium">{receiptsPagination.total}</span>{' '}
                            resultados
                          </p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => onRemitoPageChange(receiptsPagination.page - 1)}
                            disabled={receiptsPagination.page <= 1}
                            className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                          >
                            Anterior
                          </button>

                          {/* Páginas numeradas simples */}
                          {(() => {
                            const totalPages = Math.ceil(receiptsPagination.total / receiptsPagination.pageSize)
                            const currentPage = receiptsPagination.page
                            const pages = []

                            // Mostrar máximo 5 páginas alrededor de la actual
                            let startPage = Math.max(1, currentPage - 2)
                            let endPage = Math.min(totalPages, currentPage + 2)

                            // Ajustar si estamos cerca del inicio o fin
                            if (endPage - startPage < 4) {
                              if (startPage === 1) {
                                endPage = Math.min(totalPages, startPage + 4)
                              } else if (endPage === totalPages) {
                                startPage = Math.max(1, endPage - 4)
                              }
                            }

                            for (let i = startPage; i <= endPage; i++) {
                              pages.push(
                                <button
                                  key={i}
                                  onClick={() => onRemitoPageChange(i)}
                                  className={`relative inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                                    i === currentPage
                                      ? 'text-blue-600 bg-blue-50 border-blue-500'
                                      : 'text-gray-500 bg-white border-gray-300 hover:bg-gray-50'
                                  } border`}
                                >
                                  {i}
                                </button>
                              )
                            }

                            return pages
                          })()}

                          <button
                            onClick={() => onRemitoPageChange(receiptsPagination.page + 1)}
                            disabled={receiptsPagination.page >= Math.ceil(receiptsPagination.total / receiptsPagination.pageSize)}
                            className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                          >
                            Siguiente
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : invoiceTab === 'purchase-orders' ? (
              <div className="space-y-4">
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setPurchaseOrdersTab('pending')}
                    className={`tab-button ${purchaseOrdersTab === 'pending' ? 'active' : ''}`}
                  >
                    Pendientes
                  </button>
                  <button
                    onClick={() => setPurchaseOrdersTab('billed')}
                    className={`tab-button ${purchaseOrdersTab === 'billed' ? 'active' : ''}`}
                  >
                    Facturados
                  </button>
                  <button
                    onClick={() => setPurchaseOrdersTab('cancelled')}
                    className={`tab-button ${purchaseOrdersTab === 'cancelled' ? 'active' : ''}`}
                  >
                    Cancelados
                  </button>
                </div>

                <div className="px-4 py-3 bg-white border border-gray-200 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={purchaseOrdersSearchQuery}
                      onChange={(e) => setDocumentsSearchByTab((prev) => ({ ...(prev || {}), 'purchase-orders': e.target.value ?? '' }))}
                      placeholder="Buscar por nro, fecha, estado, monto o item..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    {purchaseOrdersItemsSearch.loading && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
                    )}
                    {!!purchaseOrdersSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setDocumentsSearchByTab((prev) => ({ ...(prev || {}), 'purchase-orders': '' }))}
                        className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                        title="Limpiar b£squeda"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  {purchaseOrdersItemsSearch.enabled && purchaseOrdersItemsSearch.error && (
                    <div className="mt-2 text-xs text-red-600">{purchaseOrdersItemsSearch.error}</div>
                  )}
                </div>

                {isLoadingPurchaseOrders ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    <span className="ml-3 text-gray-600">Cargando ordenes de compra...</span>
                  </div>
                ) : !supplierPurchaseOrders || supplierPurchaseOrders.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No hay ordenes de compra para mostrar</p>
                  </div>
                ) : purchaseOrdersSearchQuery.trim() && (!visiblePurchaseOrders || visiblePurchaseOrders.length === 0) ? (
                  <div className="text-center py-12 text-gray-500">
                    <div className="text-4xl mb-4">🔎</div>
                    <p>No hay resultados para tu b£squeda</p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Orden</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entrega Estimada</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {visiblePurchaseOrders.map((order) => {
                          const estadoInfo = getPurchaseOrderEstado(order)
                          const normalizedStatus = (estadoInfo.raw || '').toLowerCase()
                          let statusClasses = 'bg-blue-50 text-blue-700'
                          if (normalizedStatus.includes('cancel')) {
                            statusClasses = 'bg-red-50 text-red-700'
                          } else if (normalizedStatus.includes('draft') || normalizedStatus.includes('borrador')) {
                            statusClasses = 'bg-yellow-50 text-yellow-700'
                          } else if (normalizedStatus.includes('complet')) {
                            statusClasses = 'bg-green-50 text-green-700'
                          }
                          if (normalizedStatus === 'on hold') {
                            statusClasses = 'bg-red-100 text-red-700 border border-red-300'
                          }
                          const onHoldTooltip = normalizedStatus === 'on hold'
                            ? 'Esta orden está en espera. No se pueden generar remitos ni facturas hasta que cambie de estado.'
                            : undefined

                          return (
                            <tr key={order.name} className="hover:bg-gray-50 transition-colors duration-150" onDoubleClick={onOpenPurchaseOrder ? () => onOpenPurchaseOrder(order) : undefined}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{order.name}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {formatDate ? formatDate(order.transaction_date) : order.transaction_date}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {formatDate ? formatDate(order.schedule_date) : order.schedule_date}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap" title={onHoldTooltip}>
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${statusClasses}`}>
                                  {estadoInfo.label}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                                {formatBalance ? formatBalance(order.grand_total || 0) : order.grand_total || 0}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                    {purchaseOrdersPagination && purchaseOrdersPagination.total > purchaseOrdersPagination.pageSize && (
                    <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200 sm:px-6">
                      <div className="flex items-center">
                        <p className="text-sm text-gray-700">
                          Mostrando{' '}
                          <span className="font-medium">
                            {Math.min(
                              (purchaseOrdersPagination.page - 1) * purchaseOrdersPagination.pageSize + 1,
                              purchaseOrdersPagination.total
                            )}
                          </span>{' '}
                          a{' '}
                          <span className="font-medium">
                            {Math.min(purchaseOrdersPagination.page * purchaseOrdersPagination.pageSize, purchaseOrdersPagination.total)}
                          </span>{' '}
                          de <span className="font-medium">{purchaseOrdersPagination.total}</span> resultados
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => onPurchaseOrdersPageChange && onPurchaseOrdersPageChange(purchaseOrdersPagination.page - 1)}
                          disabled={purchaseOrdersPagination.page <= 1}
                          className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          Anterior
                        </button>
                        {(() => {
                          const totalPages = Math.ceil(purchaseOrdersPagination.total / purchaseOrdersPagination.pageSize)
                          const currentPage = purchaseOrdersPagination.page
                          const pages = []
                          let startPage = Math.max(1, currentPage - 2)
                          let endPage = Math.min(totalPages, currentPage + 2)
                          if (endPage - startPage < 4) {
                            if (startPage === 1) {
                              endPage = Math.min(totalPages, startPage + 4)
                            } else if (endPage === totalPages) {
                              startPage = Math.max(1, endPage - 4)
                            }
                          }
                          for (let i = startPage; i <= endPage; i++) {
                            pages.push(
                              <button
                                key={i}
                                onClick={() => onPurchaseOrdersPageChange && onPurchaseOrdersPageChange(i)}
                                className={`relative inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                                  i === currentPage ? 'text-blue-600 bg-blue-50 border-blue-500' : 'text-gray-500 bg-white border-gray-300 hover:bg-gray-50'
                                } border`}
                              >
                                {i}
                              </button>
                            )
                          }
                          return pages
                        })()}
                        <button
                          onClick={() =>
                            onPurchaseOrdersPageChange &&
                            onPurchaseOrdersPageChange(purchaseOrdersPagination.page + 1)
                          }
                          disabled={
                            purchaseOrdersPagination.page >= Math.ceil(purchaseOrdersPagination.total / purchaseOrdersPagination.pageSize)
                          }
                          className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                    )}
                  </>
                )}
              </div>
            ) : loadingSupplierDetails ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <span className="ml-3 text-gray-600">Cargando movimientos...</span>
              </div>
            ) : (
              <div className="space-y-6">
	              <StatementsTable
	                statements={supplierStatements}
	                hasMoreStatements={hasMoreStatements}
	                loadingMoreStatements={loadingMoreStatements}
	                loadMoreStatements={loadMoreStatements}
	                fetchWithAuth={fetchWithAuth}
	                itemSearchConfig={{
	                  childDoctype: 'Purchase Invoice Item',
	                  parentDoctype: 'Purchase Invoice'
	                }}
	                  formatBalance={formatBalance}
	                  formatVoucherNumber={formatVoucherNumber}
	                  mapVoucherTypeToSigla={mapVoucherTypeToSigla}
                  truncateDescription={truncateDescription}
                  formatDate={formatDate}
                  isInvoiceVoucherType={isInvoiceVoucherType}
                  isPaymentVoucherType={isPaymentVoucherType}
                  isCreditVoucherType={isCreditVoucherType}
                  isDebitVoucherType={isDebitVoucherType}
                  openStatementEntry={openStatementEntry}
                conciliationGroups={unbalancedConciliations}
                onOpenConciliationDocument={handleOpenConciliationDoc}
                companyCurrency={companyCurrency}
              />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modales */}
      <PurchaseInvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        onSave={handleCreateInvoice}
        onDelete={handleInvoiceDeleted}
        onSaved={handleInvoiceDeleted}
        selectedSupplier={selectedSupplier}
        editingData={editingInvoice}
        unpaidInvoicesCount={unpaidInvoicesCount}
        handleOpenItemSettings={handleOpenItemSettings}
      />

      <SupplierPaymentModal
        isOpen={Boolean(isPaymentModalOpen)}
        onClose={() => {
          setIsPaymentModalOpen(false)
          if (setEditingPayment) {
            setEditingPayment(null)
          }
        }}
        onSave={(paymentData) => {
          if (onSupplierPaymentSaved) {
            onSupplierPaymentSaved(paymentData)
          }
        }}
        selectedSupplier={selectedSupplier}
        editingData={editingPayment}
        supplierDetails={supplierDetails}
      />

      <SupplierAddressModal
        isOpen={isAddressModalOpen}
        onClose={handleCloseAddressModal}
        supplierName={selectedSupplier}
        supplierId={supplierDetails?.name}
      />

      <ItemSettingsModal
        isOpen={itemSettingsModal.isOpen}
        onClose={() => setItemSettingsModal({ isOpen: false, item: null, itemIndex: null, customer: null })}
        item={itemSettingsModal.item}
        customer={itemSettingsModal.customer}
        onSaveSettings={(settings) => {
          if (itemSettingsModal.onSaveItemSettings) {
            itemSettingsModal.onSaveItemSettings(itemSettingsModal.itemIndex, settings)
          }
        }}
      />

      {/* Modal centralizado de Supplier Group */}
      <SupplierGroupModal
        isOpen={showSupplierGroupTestModal}
        onClose={handleCloseSupplierGroupModal}
        editingGroup={editingSupplierGroup}
        groupFormData={supplierGroupFormData}
        onFormChange={setSupplierGroupFormData}
        onSave={handleSaveSupplierGroup}
        saving={savingSupplierGroup}
        supplierGroups={supplierGroups}
        availableExpenseAccounts={availableExpenseAccounts}
        paymentTermsTemplates={paymentTermsTemplates}
        extractAccountName={extractAccountDescription}
      />

      {/* Modal de Confirmación - usar ConfirmModal compartido (mismo estilo que InventoryPanel) */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={handleCancelAction}
        onConfirm={handleConfirmAction}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
        type={confirmModal.type}
      />
    </div>
  )}
