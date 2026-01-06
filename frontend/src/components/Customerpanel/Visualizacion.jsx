import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, FileText, FilePlus2, Layers, Plus, Edit, Trash2, Save, MapPin, Search, X, AlertTriangle, CheckCircle, DollarSign, Calculator, FileDown, Loader2, ClipboardList, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import Select from 'react-select'
import Modal from '../Modal'
import StatementsTable from './StatementsTable.jsx'
import InvoiceModal from '../modals/InvoiceModal/InvoiceModal.jsx'
import AddressModal from '../modals/AddressModal.jsx'
import PaymentModal from '../modals/PaymentModal.jsx'
import ReconciliationModal from '../modals/ReconciliationModal.jsx'
import CustomerGroupModal from '../configcomponents/modals/CustomerGroupModal.jsx'
import { useConfirm } from '../../hooks/useConfirm'
import ActionChip from '../common/ActionChip.jsx'
import { templateMatchesType, TEMPLATE_TYPES } from '../../utils/taxTemplates'
import { useNotification } from '../../contexts/NotificationContext'


export default function Visualizacion({
  // Estados
  customers,
  subscriptionCustomers = [],
  fetchWithAuth,
  selectedCustomer,
  setSelectedCustomer,
  customerDetails,
  customerSubscriptions = [],
  isLoadingCustomerSubscriptions = false,
  subscriptionMutations = {},
  customerAddresses,
  customerInvoices,
  unpaidInvoicesCount,
  draftInvoicesCount,
  customerStatements,
  conciliationGroups = [],
  loading,
  isInvoiceModalOpen,
  setIsInvoiceModalOpen,
  companyTalonarios = [],
  linkedInvoiceDraft = null,
  onConsumeLinkedInvoiceDraft = () => {},
  isEditingCustomer,
  editedCustomerData,
  savingCustomer,
  editingInvoice,
  setEditingInvoice,
  isAddressModalOpen,
  setIsAddressModalOpen,
  isPaymentModalOpen,
  setIsPaymentModalOpen,
  editingPayment,
  setEditingPayment,
  isReconciliationModalOpen,
  setIsReconciliationModalOpen,
  hasMoreStatements,
  loadingMoreStatements,
  statementTablePage = 1,
  statementTablePageSize = 10,
  onStatementPageChange = () => {},
  invoiceTab,
  setInvoiceTab,
  customerListTab = 'customers',
  setCustomerListTab = () => {},
  customerTab,
  setCustomerTab,
  availableAssetAccounts,
  availableIncomeAccounts,
  paymentTermsTemplates,
  taxTemplates,
  customerSearch,
  setCustomerSearch,
  loadingSubscriptionCustomers = false,
  subscriptionPage = 1,
  setSubscriptionPage = () => {},
  totalSubscriptionCustomers = 0,
  consultingAfip,
  customerGroups,
  availablePriceLists,
  customerGroupFormData,
  setCustomerGroupFormData,
  savingCustomerGroup,
  handleSaveCustomerGroup,
  editingCustomerGroup,
  handleCloseCustomerGroupModal,
  confirmModal,
  // Funciones
  handleAddCustomer,
  handleEditCustomer,
  handleCancelEdit,
  handleCreateCustomer,
  handleSaveCustomer,
  handleDeleteCustomer,
  handleDisableCustomer,
  handleEditChange,
  handleSearchAfip,
  handleCloseAddressModal,
  handleCreateInvoice,
  handleOpenInvoice,
  onOpenCustomerGroupModal,
  showTestModal,
  formatBalance,
  formatVoucherNumber,
  mapVoucherTypeToSigla,
  truncateDescription,
  formatDate,
  extractAccountName,
  removeCompanyAbbr,
  renderItemsTable,
  loadMoreStatements,
  handleConfirmAction,
  handleCancelAction,
  filterCustomers,
  getFiscalAddress,
  hasValue,
  getFieldIcon,
  isInvoiceVoucherType,
  isPaymentVoucherType,
  isCreditVoucherType,
  isDebitVoucherType,
  openStatementEntry,
  bulkDeleteState,
  onToggleBulkDelete,
  onBulkRowToggle,
  onBulkSelectAll,
  isBulkDeleting,
  customerDeliveryNotes,
  deliveryNotesPagination,
  isLoadingDeliveryNotes,
  onSalesRemitoPageChange,
  onOpenSalesRemito,
  onCreateSalesRemito,
  canCreateSalesRemito = true,
  salesRemitoDisabledMessage = '',
  canCreateInvoice = true,
  salesInvoiceDisabledMessage = '',
  onCreateInvoice,
  canRegisterPayment = true,
  registerPaymentDisabledMessage = '',
  onCreatePayment,
  customerSalesOrders = [],
  salesOrdersPagination,
  isLoadingSalesOrders = false,
  salesOrdersView = 'pending',
  setSalesOrdersView = () => {},
  salesOrdersCounts = {},
  salesOrdersPendingCount = 0,
  onSalesOrderPageChange,
  onOpenSalesOrder,
  onCreateSalesOrder,
  onMarkSalesOrdersDelivered,
  customerQuotations = [],
  quotationsPagination,
  isLoadingQuotations = false,
  onSalesQuotationPageChange,
  onOpenSalesQuotation,
  onCreateSalesQuotation,
  // Pagination props
  totalCustomers,
  pageSize,
  currentPage,
  setCurrentPage,
  onOpenSubscriptionManager = () => {},
  onCancelSubscription = () => {},
  // Additional props
  activeCompany,
  companyAbbr = '',
  getAssignedIncomeAccount,
  onDownloadDocumentPdf,
  downloadingDocuments = {},
  fetchCustomerInvoices,
  fetchCustomerStatements,
  // Props para panel colapsable de detalles
  isCustomerDetailsPanelExpanded = false,
  setIsCustomerDetailsPanelExpanded = () => {},
  loadingCustomerDetails = false,
  // Props para carga de saldos a demanda
  balancesLoaded = false,
  loadingBalances = false,
  onFetchBalances = () => {},
  // Props para toggle de nombre comercial/fiscal
  showCommercialName = false,
  setShowCommercialName = () => {}
}) {
  const { confirm, ConfirmDialog } = useConfirm()
  const { showNotification } = useNotification()
  const bulkSelectedSet = bulkDeleteState?.selected || new Set()
  const isBulkMode = Boolean(bulkDeleteState?.active && bulkDeleteState?.context === invoiceTab)
  const bulkSelectedCount = bulkDeleteState?.selected ? bulkDeleteState.selected.size : 0
  const canUseBulkDelete = Boolean(selectedCustomer && ['unpaid', 'draft'].includes(invoiceTab))

  const salesOrderViewOptions = useMemo(() => ([
    { key: 'pending', label: 'Pendientes' },
    { key: 'billedPending', label: 'Facturadas sin envío' },
    { key: 'delivered', label: 'Finalizadas' },
    { key: 'cancelled', label: 'Canceladas' }
  ]), [])

  const salesOrdersEmptyMessages = {
    pending: 'No hay órdenes pendientes de facturar',
    billedPending: 'Todas las órdenes facturadas ya fueron marcadas como enviadas',
    delivered: 'Todavía no hay órdenes completadas',
    cancelled: 'No hay órdenes canceladas'
  }

  const [documentsSearchByTab, setDocumentsSearchByTab] = useState({})
  const salesOrdersSearchQuery = (documentsSearchByTab?.['sales-orders'] || '').toString()
  const quotationsSearchQuery = (documentsSearchByTab?.['quotations'] || '').toString()
  const deliveryNotesSearchQuery = (documentsSearchByTab?.['remitos'] || '').toString()
  const [deliveryNotesTab, setDeliveryNotesTab] = useState('pending')

  const deliveryNotesEmptyMessages = useMemo(() => ({
    pending: 'No hay remitos pendientes',
    billed: 'No hay remitos facturados',
    cancelled: 'No hay remitos cancelados'
  }), [])

  const getDeliveryNoteEstado = useCallback((note) => {
    if (!note) return ''
    return (note.status || '').toString().trim().toLowerCase()
  }, [])

  const isDeliveryNoteCancelled = useCallback((note) => {
    if (!note) return false
    if (Number(note.docstatus) === 2) return true
    const estado = getDeliveryNoteEstado(note)
    return estado === 'cancelled' || estado === 'cancelado'
  }, [getDeliveryNoteEstado])

  const isDeliveryNoteBilled = useCallback((note) => {
    if (!note) return false
    if (Number(note.docstatus) === 2) return false
    const estado = getDeliveryNoteEstado(note)
    if (estado === 'completed' || estado === 'completado') return true
    const raw = note.per_billed ?? note.per_billed_amount ?? note.per_billed_percent
    if (raw === null || raw === undefined || raw === '') return false
    const numeric = typeof raw === 'number' ? raw : parseFloat(raw)
    if (Number.isNaN(numeric)) return false
    return numeric >= 100
  }, [getDeliveryNoteEstado])

  const filteredDeliveryNotes = useMemo(() => {
    if (!Array.isArray(customerDeliveryNotes)) return []
    if (deliveryNotesTab === 'cancelled') {
      return customerDeliveryNotes.filter(isDeliveryNoteCancelled)
    }
    if (deliveryNotesTab === 'billed') {
      return customerDeliveryNotes.filter(isDeliveryNoteBilled)
    }
    // pending
    return customerDeliveryNotes.filter((note) => !isDeliveryNoteCancelled(note) && !isDeliveryNoteBilled(note))
  }, [customerDeliveryNotes, deliveryNotesTab, isDeliveryNoteCancelled, isDeliveryNoteBilled])

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

  const filterDocumentsByQuery = (list, query, { id, dates = [], text = [], amounts = [] } = {}) => {
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
      const voucherText = String(idValue || '').toLowerCase()

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

      const matchesText = voucherText.includes(normalizedQuery)
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

  const visibleSalesOrders = useMemo(() => (
    filterDocumentsByQuery(customerSalesOrders, salesOrdersSearchQuery, {
      id: (order) => order?.name,
      dates: [
        (order) => order?.receiving_date,
        (order) => order?.delivery_date,
        (order) => order?.transaction_date
      ],
      text: [
        (order) => order?.status,
        (order) => order?.po_no,
        (order) => order?.source,
        (order) => order?.marketplace_reference
      ],
      amounts: [
        (order) => order?.grand_total,
        (order) => order?.rounded_total
      ]
    })
  ), [customerSalesOrders, salesOrdersSearchQuery])

  const visibleQuotations = useMemo(() => (
    filterDocumentsByQuery(customerQuotations, quotationsSearchQuery, {
      id: (quotation) => quotation?.name,
      dates: [
        (quotation) => quotation?.transaction_date,
        (quotation) => quotation?.valid_till
      ],
      text: [
        (quotation) => quotation?.status,
        (quotation) => quotation?.title,
        (quotation) => quotation?.po_no
      ],
      amounts: [
        (quotation) => quotation?.grand_total,
        (quotation) => quotation?.rounded_total
      ]
    })
  ), [customerQuotations, quotationsSearchQuery])

  const visibleDeliveryNotes = useMemo(() => (
    filterDocumentsByQuery(filteredDeliveryNotes, deliveryNotesSearchQuery, {
      id: (note) => note?.name,
      dates: [
        (note) => note?.posting_date
      ],
      text: [
        (note) => note?.status,
        (note) => note?.customer,
        (note) => note?.customer_name
      ],
      amounts: [
        (note) => note?.grand_total,
        (note) => note?.rounded_total,
        (note) => note?.total_qty
      ]
    })
  ), [filteredDeliveryNotes, deliveryNotesSearchQuery])

  const [selectedSalesOrders, setSelectedSalesOrders] = useState([])
  const selectionEnabled = salesOrdersView === 'billedPending'
  const selectedSalesOrdersSet = useMemo(() => new Set(selectedSalesOrders || []), [selectedSalesOrders])
  const allSalesOrdersSelected =
    selectionEnabled &&
    (visibleSalesOrders?.length || 0) > 0 &&
    visibleSalesOrders.every(order => selectedSalesOrdersSet.has(order.name))

  const balancedConciliations = useMemo(() => {
    if (!Array.isArray(conciliationGroups)) {
      return []
    }
    return conciliationGroups.filter(group => Math.abs(Number(group?.net_amount || 0)) < 1)
  }, [conciliationGroups])

  const unbalancedConciliations = useMemo(() => {
    if (!Array.isArray(conciliationGroups)) {
      return []
    }
    return conciliationGroups.filter(group => Math.abs(Number(group?.net_amount || 0)) >= 1)
  }, [conciliationGroups])

  const handleOpenConciliationDoc = useCallback((voucherNo, docType) => {
    if (!voucherNo) return
    if (typeof openStatementEntry === 'function') {
      openStatementEntry(voucherNo, docType)
      return
    }
    if (typeof handleOpenInvoice === 'function') {
      handleOpenInvoice(voucherNo)
    }
  }, [openStatementEntry, handleOpenInvoice])


  const escapeRegExp = (value) => value?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || ''
  const formatCustomerGroupName = (groupName) => {
    if (!groupName) return ''
    const cleaned = groupName.replace(/[()]/g, '').trim()
    if (!cleaned) return ''

    if (companyAbbr) {
      const suffixRegex = new RegExp(`\\s*-\\s*${escapeRegExp(companyAbbr.trim())}$`)
      return cleaned.replace(suffixRegex, '').trim()
    }

    // Fallback: quitar sufijos de abreviaciones comunes
    return cleaned.replace(/\s+-\s+[A-Z0-9]{2,}$/, '').trim()
  }

  const displayCustomerGroup = useMemo(() => {
    const rawGroup = customerDetails?.customer_group_name || customerDetails?.customer_group || ''
    return formatCustomerGroupName(rawGroup)
  }, [customerDetails?.customer_group_name, customerDetails?.customer_group, companyAbbr])

  useEffect(() => {
    setSelectedSalesOrders([])
  }, [salesOrdersView, customerSalesOrders])

  const toggleSalesOrderSelection = (orderName) => {
    if (!orderName) return
    setSelectedSalesOrders(prev => (
      prev.includes(orderName)
        ? prev.filter(name => name !== orderName)
        : [...prev, orderName]
    ))
  }

  const handleSelectAllSalesOrders = (checked) => {
    if (!selectionEnabled) return
    if (checked) {
      setSelectedSalesOrders((visibleSalesOrders || []).map(order => order.name))
    } else {
      setSelectedSalesOrders([])
    }
  }

  const handleMarkDeliveredClick = () => {
    if (!selectionEnabled || !selectedSalesOrders.length) return
    if (onMarkSalesOrdersDelivered) {
      onMarkSalesOrdersDelivered(selectedSalesOrders, salesOrdersView)
    }
  }
  const invoiceBulkOptions = isBulkMode ? {
    isBulkMode: true,
    selectedItems: bulkSelectedSet,
    onToggleRow: (name, checked) => onBulkRowToggle && onBulkRowToggle(name, checked),
    onToggleAll: (checked) => onBulkSelectAll && onBulkSelectAll(invoiceTab, customerInvoices, checked),
    documentsForSelection: customerInvoices,
    isProcessing: isBulkDeleting,
    canSelectRow: () => true // Permitir seleccionar todos los documentos (facturas y pagos)
  } : null
  const isSubscriptionsTab = customerListTab === 'subscriptions'
  const listItems = filterCustomers(isSubscriptionsTab ? subscriptionCustomers : customers, customerSearch)
  const listLoading = isSubscriptionsTab ? loadingSubscriptionCustomers : loading
  const listTotal = isSubscriptionsTab ? totalSubscriptionCustomers : totalCustomers
  const listPage = isSubscriptionsTab ? subscriptionPage : currentPage
  const handleListPageChange = isSubscriptionsTab ? setSubscriptionPage : setCurrentPage
  return (
  <div className="h-full flex gap-6">
      {/* Lista de clientes - Izquierda */}
      <div className="w-1/3 bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden flex flex-col">
        <div className="accounting-card-title">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-blue-600" />
              <div className="flex flex-col">
                <h3 className="text-lg font-black text-gray-900">Clientes</h3>
                <nav className="tab-nav mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerListTab('customers')
                      setCurrentPage && setCurrentPage(1)
                    }}
                    className={`tab-button ${!isSubscriptionsTab ? 'active' : ''}`}
                  >
                    Clientes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerListTab('subscriptions')
                      setSubscriptionPage && setSubscriptionPage(1)
                    }}
                    className={`tab-button ${isSubscriptionsTab ? 'active' : ''}`}
                  >
                    Clientes con suscripcion
                  </button>
                </nav>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isSubscriptionsTab ? (
                <button
                  className="inline-flex items-center px-3 py-2 border border-transparent text-xs font-bold rounded-xl text-white bg-gradient-to-r from-indigo-600 to-blue-700 hover:from-indigo-500 hover:to-blue-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                  onClick={onOpenSubscriptionManager}
                >
                  <Layers className="w-4 h-4 mr-2" />
                  Gestionar suscripciones
                </button>
              ) : (
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                        onClick={handleAddCustomer}>
                  <Plus className="w-4 h-4 mr-2" />
                  Agregar Cliente
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Campo de búsqueda */}
        <div className="px-4 py-2 border-b border-gray-200">
          <input
            type="text"
            placeholder={isSubscriptionsTab ? 'Buscar cliente con suscripcion...' : 'Buscar cliente...'}
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>

        <div className="flex-1 p-4 overflow-y-auto">
          {listLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">
                Cargando clientes...
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Header */}
              <div className="flex items-center justify-between py-3 px-3 bg-gray-100 rounded-lg font-semibold text-gray-700 text-sm border-b border-gray-200">
                <div className="flex items-center flex-1 gap-2">
                  <span>{isSubscriptionsTab ? 'Cliente con suscripcion' : 'Cliente'}</span>
                  {/* Toggle para nombre comercial/fiscal */}
                  {!isSubscriptionsTab && (
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
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right min-w-[80px]">
                    <span>{isSubscriptionsTab ? 'Estado' : 'Saldo'}</span>
                  </div>
                  {/* Botón para cargar saldos */}
                  {!isSubscriptionsTab && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onFetchBalances && onFetchBalances()
                      }}
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
                  )}
                </div>
              </div>
              {listItems.map(customer => {
                const statusLabel = customer.subscription_status || customer.status || 'Activa'
                const statusColor = (statusLabel || '').toLowerCase().includes('cancel')
                  ? 'bg-red-100 text-red-700'
                  : (statusLabel || '').toLowerCase().includes('trial')
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-green-100 text-green-700'
                const amountValue = customer.amount ?? customer.recurring_amount ?? customer.monto
                const nextDate = customer.next_invoice_date || customer.next_billing_date || customer.current_invoice_start
                return (
                <div
                  key={customer.name}
                  className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-all duration-200 hover:bg-gray-100 ${
                    selectedCustomer === customer.name ? 'bg-gray-200 border-l-4 border-gray-600' : ''
                  }`}
                  onClick={() => setSelectedCustomer(customer.name)}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center">
                      <FileText className={`w-4 h-4 mr-2 text-gray-600`} />
                      <span className={`text-sm font-medium text-gray-900`}>
                        {isSubscriptionsTab 
                          ? (customer.customer || customer.party || customer.customer_name || customer.name)
                          : (showCommercialName && customer.customer_details 
                            ? customer.customer_details 
                            : (customer.customer_name || customer.name))
                        }
                      </span>
                    </div>
                    {isSubscriptionsTab && (
                      <div className="ml-6 text-xs text-gray-500 flex items-center gap-2">
                        {customer.plan && <span className="font-medium">{customer.plan}</span>}
                        {nextDate && <span>| Proximo {nextDate}</span>}
                        {customer.align_day_of_month && <span>| Dia {customer.align_day_of_month}</span>}
                        {customer.trial_days ? <span>| Trial {customer.trial_days} dias</span> : null}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center">
                    {isSubscriptionsTab ? (
                      <div className="flex flex-col items-end gap-1 min-w-[140px]">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                          {statusLabel}
                        </span>
                        {amountValue !== undefined && amountValue !== null && amountValue !== '' && (
                          <span className="text-sm font-semibold text-gray-900">
                            {formatBalance ? formatBalance(amountValue) : amountValue}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-right min-w-[80px] font-semibold">
                        {customer.outstanding_amount === null ? (
                          <span className="text-gray-400 text-xs">-</span>
                        ) : (
                          <span className={customer.outstanding_amount > 0 ? 'text-red-600' : 'text-gray-900'}>
                            {formatBalance(customer.outstanding_amount || 0)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>

        {/* Controles de paginacin */}
        {listTotal > pageSize && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Mostrando {((listPage - 1) * pageSize) + 1} - {Math.min(listPage * pageSize, listTotal)} de {listTotal} {isSubscriptionsTab ? 'suscripciones' : 'clientes'}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleListPageChange(prev => Math.max(1, (typeof prev === 'number' ? prev : listPage) - 1))}
                  disabled={listPage === 1 || listLoading}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <span className="text-sm text-gray-700">
                  Pgina {listPage} de {Math.ceil(listTotal / pageSize)}
                </span>
                <button
                  onClick={() => handleListPageChange(prev => (typeof prev === 'number' ? prev : listPage) + 1)}
                  disabled={listPage * pageSize >= listTotal || listLoading}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Siguiente
                </button>
              </div>
            </div>
          </div>
        )}
      </div>


      {/* Panel derecho - Detalles y facturas */}
  <div className="flex-1 flex flex-col gap-6 min-w-0">
        {/* Detalles del cliente - Arriba derecha (colapsable) */}
  <div
    className={`bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden min-w-0 transition-all duration-300`}
    style={(isCustomerDetailsPanelExpanded || isEditingCustomer || selectedCustomer === 'new') ? { maxHeight: '50vh', overflow: 'auto' } : undefined}
  >
          {/* Header del panel - siempre visible y clickeable para expandir/colapsar */}
          <div 
            className="accounting-card-title bg-gray-50 border-b border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors"
            onClick={() => {
              if (selectedCustomer && selectedCustomer !== 'new') {
                setIsCustomerDetailsPanelExpanded(!isCustomerDetailsPanelExpanded)
              }
            }}
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-200 rounded-lg">
                  <FileText className="w-5 h-5 text-gray-600" />
                </div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-black text-gray-900">
                    {isEditingCustomer && selectedCustomer === 'new' ? 'Nuevo Cliente' :
                     selectedCustomer ? `Cliente: ${removeCompanyAbbr ? removeCompanyAbbr(customerDetails?.customer_name || selectedCustomer) : (customerDetails?.customer_name || selectedCustomer)}` : 'Selecciona un cliente'}
                  </h3>
                  {selectedCustomer && selectedCustomer !== 'new' && !isEditingCustomer && (
                    <span className="text-xs text-gray-500">
                      {isCustomerDetailsPanelExpanded ? '(click para colapsar)' : '(click para ver detalles)'}
                    </span>
                  )}
                </div>
                {selectedCustomer && selectedCustomer !== 'new' && !isEditingCustomer && (
                  <button
                    type="button"
                    className="p-1.5 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsCustomerDetailsPanelExpanded(!isCustomerDetailsPanelExpanded)
                    }}
                  >
                    {isCustomerDetailsPanelExpanded ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>
                )}
              </div>
              {selectedCustomer && (
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {!isEditingCustomer ? (
                    <>
                      <button className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                              title="Editar cliente"
                              onClick={handleEditCustomer}>
                        <Edit className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100/80 rounded-xl transition-all duration-300"
                              title="Eliminar cliente"
                              onClick={handleDeleteCustomer}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {/* Desactivar cliente (alternativa a borrar) */}
                      {customerDetails && !customerDetails.disabled && (
                        <button
                          className="p-2 text-yellow-600 hover:text-yellow-800 hover:bg-yellow-100/80 rounded-xl transition-all duration-300"
                          title="Desactivar cliente"
                          onClick={(e) => { e.stopPropagation(); handleDisableCustomer && handleDisableCustomer() }}
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={handleCancelEdit}
                        disabled={savingCustomer}
                        className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={selectedCustomer === 'new' ? handleCreateCustomer : handleSaveCustomer}
                        disabled={savingCustomer}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                      >
                        {savingCustomer ? (
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
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Contenido del panel - solo visible cuando está expandido o editando, o es nuevo cliente */}
          {(isCustomerDetailsPanelExpanded || isEditingCustomer || selectedCustomer === 'new') && (
          <div
            className="p-4 bg-gray-50"
            style={isCustomerDetailsPanelExpanded ? { maxHeight: '50vh', overflow: 'auto' } : undefined}
          >
            {/* Mostrar spinner mientras se cargan los detalles */}
            {loadingCustomerDetails && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="ml-3 text-gray-600">Cargando detalles del cliente...</span>
              </div>
            )}
            
            {!loadingCustomerDetails && selectedCustomer && customerSubscriptions && customerSubscriptions.length > 0 && (
                  <div className="mb-4 bg-blue-50 border border-blue-200 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-2">Suscripciones</p>
                    <div className="space-y-3">
                      {customerSubscriptions.map((sub) => {
                        const statusLabel = sub.status || 'Activa'
                        const statusColor = statusLabel.toLowerCase().includes('cancel')
                          ? 'bg-red-100 text-red-700'
                          : statusLabel.toLowerCase().includes('trial')
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-green-100 text-green-700'
                        const amountValue = sub.amount ?? sub.recurring_amount ?? sub.grand_total
                        return (
                          <div key={sub.name || sub.plan || sub.plan_name} className="flex items-center justify-between gap-4">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900">{sub.plan || sub.plan_name || sub.name}</span>
                                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                                  {statusLabel}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600">
                                {sub.start_date ? `Desde ${sub.start_date}` : 'Sin fecha de inicio'}
                                {sub.end_date ? ` hasta ${sub.end_date}` : ''}
                              </div>
                              <div className="text-xs text-gray-500">
                                {sub.interval_days ? `Cada ${sub.interval_days} dias` : 'Intervalo no definido'}
                                {sub.align_day_of_month ? ` | Alineada al dia ${sub.align_day_of_month}` : ''}
                                {sub.trial_days ? ` | Trial ${sub.trial_days} dias` : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {amountValue ? (
                                <span className="text-sm font-semibold text-gray-900">
                                  {formatBalance ? formatBalance(amountValue) : amountValue}
                                </span>
                              ) : null}
                              {sub.name && (
                                <button
                                  type="button"
                                  onClick={() => onCancelSubscription && onCancelSubscription(sub.name)}
                                  className="px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  disabled={subscriptionMutations[sub.name] === 'cancelling'}
                                >
                                  {subscriptionMutations[sub.name] === 'cancelling' ? 'Cancelando...' : 'Cancelar'}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              
            {isEditingCustomer ? (
              <>
                {/* Pestañas para edición */}
                <nav className="tab-nav mb-6">
                  <button
                    onClick={() => setCustomerTab('general')}
                    className={`tab-button ${customerTab === 'general' ? 'active' : ''}`}
                  >
                    General
                  </button>
                  <button
                    onClick={() => setCustomerTab('comercial')}
                    className={`tab-button ${customerTab === 'comercial' ? 'active' : ''}`}
                  >
                    Comercial
                  </button>
                  <button
                    onClick={() => setCustomerTab('contacto')}
                    className={`tab-button ${customerTab === 'contacto' ? 'active' : ''}`}
                  >
                    Contacto
                  </button>
                  <button
                    onClick={() => setCustomerTab('fiscal')}
                    className={`tab-button ${customerTab === 'fiscal' ? 'active' : ''}`}
                  >
                    Información Fiscal
                  </button>
                  <button
                    onClick={() => setCustomerTab('direccion')}
                    className={`tab-button ${customerTab === 'direccion' ? 'active' : ''}`}
                  >
                    Dirección
                  </button>
                </nav>

                {/* Contenido de las pestañas de edición */}
                {customerTab === 'general' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre fiscal *</label>
                        <input
                          type="text"
                          value={editedCustomerData.customer_name || ''}
                          onChange={(e) => handleEditChange('customer_name', e.target.value)}
                          placeholder="Razón social / Nombre fiscal"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre comercial</label>
                        <input
                          type="text"
                          value={editedCustomerData.customer_details || ''}
                          onChange={(e) => handleEditChange('customer_details', e.target.value)}
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
                            value={editedCustomerData.tax_id || ''}
                            onChange={(e) => handleEditChange('tax_id', e.target.value)}
                            placeholder="XX-XXXXXXXX-X"
                            className="w-full pr-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                          <button
                            type="button"
                            onClick={() => handleSearchAfip(editedCustomerData.tax_id)}
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
                            value={editedCustomerData.fecha_alta || ''}
                            readOnly
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Grupo de cliente</label>
                          <div className="flex space-x-2">
                            {customerGroups.filter(g => g.is_group === 0).length === 1 ? (
                              <div className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-sm text-gray-700">
                                {customerGroups.find(g => g.is_group === 0).display_name || customerGroups.find(g => g.is_group === 0).customer_group_name}
                              </div>
                            ) : (
                              <select
                                value={editedCustomerData.customer_group || ''}
                                onChange={(e) => handleEditChange('customer_group', e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                              >
                                {customerGroups.filter(group => group.is_group === 0).map((group) => (
                                  <option key={group.name} value={group.customer_group_name}>
                                    {group.display_name || group.customer_group_name}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenCustomerGroupModal()}
                              className="px-3 py-2 bg-blue-500 text-black rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                              title="Gestionar grupos de clientes"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Seleccione un grupo existente o haga clic en + para crear uno nuevo
                          </p>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta por Cobrar</label>
                        <Select
                          value={availableAssetAccounts.find(acc => acc.name === editedCustomerData.default_receivable_account) ? 
                            { value: editedCustomerData.default_receivable_account, label: availableAssetAccounts.find(acc => acc.name === editedCustomerData.default_receivable_account).account_name } : null}
                          onChange={(selectedOption) => handleEditChange('default_receivable_account', selectedOption ? selectedOption.value : '')}
                          options={availableAssetAccounts.map((account) => ({
                            value: account.name,
                            label: extractAccountName(account.account_name)
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
                        <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta de Ingresos</label>
                        <div className="px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700">
                          {getAssignedIncomeAccount(editedCustomerData.customer_group, editedCustomerData).name}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Se asignará automáticamente según el grupo del cliente o la configuración de la empresa
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {customerTab === 'comercial' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Condición de Venta</label>
                        <select
                          value={editedCustomerData.payment_terms || ''}
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
                          value={editedCustomerData.discount_percentage || ''}
                          onChange={(e) => handleEditChange('discount_percentage', e.target.value)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Lista de Precios</label>
                        <select
                          value={editedCustomerData.price_list || ''}
                          onChange={(e) => handleEditChange('price_list', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Seleccionar lista de precios...</option>
                          {availablePriceLists.map((list) => (
                            <option key={list.name} value={list.price_list_name}>
                              {list.price_list_name} ({list.currency})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Transportista</label>
                        <input
                          type="text"
                          value={editedCustomerData.transporter || ''}
                          onChange={(e) => handleEditChange('transporter', e.target.value)}
                          placeholder="Nombre del transportista"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {customerTab === 'contacto' && (
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Sitio web</label>
                      <input
                        type="text"
                        value={editedCustomerData.website || ''}
                        onChange={(e) => handleEditChange('website', e.target.value)}
                        placeholder="https://www.ejemplo.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                      <input
                        type="email"
                        value={editedCustomerData.email || ''}
                        onChange={(e) => handleEditChange('email', e.target.value)}
                        placeholder="cliente@ejemplo.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
                      <input
                        type="text"
                        value={editedCustomerData.phone || ''}
                        onChange={(e) => handleEditChange('phone', e.target.value)}
                        placeholder="+54 11 1234-5678"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Contacto</label>
                      <input
                        type="text"
                        value={editedCustomerData.contacto || ''}
                        onChange={(e) => handleEditChange('contacto', e.target.value)}
                        placeholder="Nombre del contacto"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                )}

                {customerTab === 'fiscal' && (
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Condición frente al IVA</label>
                      <select
                        value={editedCustomerData.custom_condicion_iva || ''}
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
                        value={editedCustomerData.custom_default_iva_ventas || ''}
                        onChange={(e) => handleEditChange('custom_default_iva_ventas', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Seleccionar plantilla de IVA...</option>
                        {taxTemplates
                          .filter(template => templateMatchesType(template, TEMPLATE_TYPES.SALES))
                          .map((template) => (
                            <option key={template.name} value={template.name}>
                              {template.title || template.name}
                            </option>
                          ))
                        }
                      </select>
                    </div>
                  </div>
                )}

                {customerTab === 'direccion' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Dirección</label>
                        <input
                          type="text"
                          value={editedCustomerData.address || ''}
                          onChange={(e) => handleEditChange('address', e.target.value)}
                          placeholder="Dirección completa"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Ciudad</label>
                        <input
                          type="text"
                          value={editedCustomerData.ciudad || ''}
                          onChange={(e) => handleEditChange('ciudad', e.target.value)}
                          placeholder="Ciudad"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Código Postal</label>
                        <input
                          type="text"
                          value={editedCustomerData.codigo_postal || ''}
                          onChange={(e) => handleEditChange('codigo_postal', e.target.value)}
                          placeholder="Código postal"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Provincia</label>
                        <input
                          type="text"
                          value={editedCustomerData.provincia || ''}
                          onChange={(e) => handleEditChange('provincia', e.target.value)}
                          placeholder="Provincia"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">País</label>
                        <select
                          value={editedCustomerData.pais || 'Argentina'}
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
                    
                    {/* Botón para gestionar direcciones adicionales */}
                    <div className="col-span-2 mt-4">
                      <button
                        onClick={() => {
                          setIsAddressModalOpen(true)
                        }}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                      >
                        <MapPin size={16} className="mr-2" />
                        Gestionar Direcciones
                      </button>
                    </div>
                  </div>
                )}

                {customerTab === 'cuenta' && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta por Cobrar</label>
                      <select
                        value={editedCustomerData.default_receivable_account || ''}
                        onChange={(e) => handleEditChange('default_receivable_account', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Seleccionar cuenta...</option>
                        {availableAssetAccounts.map((account) => (
                          <option key={account.name} value={account.name}>
                            {extractAccountName(account.account_name)}
                          </option>
                        ))}
                      </select>
                      <p className="text-sm text-gray-500 mt-1">Cuenta por defecto para los cobros de este cliente</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta de Ingresos</label>
                      <select
                        value={editedCustomerData.default_income_account || ''}
                        onChange={(e) => handleEditChange('default_income_account', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Seleccionar cuenta...</option>
                        {availableIncomeAccounts.map((account) => (
                          <option key={account.name} value={account.name}>
                            {extractAccountName(account.account_name)}
                          </option>
                        ))}
                      </select>
                      <p className="text-sm text-gray-500 mt-1">Cuenta por defecto para los ingresos de las facturas de este cliente</p>
                    </div>
                  </div>
                )}
              </>
            ) : customerDetails ? (
              <>
                {/* Pestañas para visualización */}
                <nav className="tab-nav mb-6">
                  <button
                    onClick={() => setCustomerTab('general')}
                    className={`tab-button ${customerTab === 'general' ? 'active' : ''}`}
                  >
                    General
                  </button>
                  <button
                    onClick={() => setCustomerTab('comercial')}
                    className={`tab-button ${customerTab === 'comercial' ? 'active' : ''}`}
                  >
                    Comercial
                  </button>
                  <button
                    onClick={() => setCustomerTab('contacto')}
                    className={`tab-button ${customerTab === 'contacto' ? 'active' : ''}`}
                  >
                    Contacto
                  </button>
                  <button
                    onClick={() => setCustomerTab('fiscal')}
                    className={`tab-button ${customerTab === 'fiscal' ? 'active' : ''}`}
                  >
                    Información Fiscal
                  </button>
                  <button
                    onClick={() => setCustomerTab('direccion')}
                    className={`tab-button ${customerTab === 'direccion' ? 'active' : ''}`}
                  >
                    Dirección
                  </button>
                </nav>

                {/* Contenido de las pestañas de visualización */}
                {customerTab === 'general' && (
                  <div className="space-y-2 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Nombre fiscal:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.customer_name || customerDetails.name}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Nombre comercial:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.customer_details || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Grupo de cliente:</span>
                      <span className="text-gray-900 font-medium ml-2">{displayCustomerGroup || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Fecha alta:</span>
                        <span className="text-gray-900 font-medium ml-2">
                          {customerDetails.creation ? new Date(customerDetails.creation).toLocaleDateString('es-ES', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          }) : 'No especificada'}
                        </span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Cuenta por Cobrar:</span>
                        <span className="text-gray-900 font-medium ml-2">{extractAccountName(customerDetails.default_receivable_account) || 'No especificada'}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Cuenta de Ingresos:</span>
                        <span className="text-gray-900 font-medium ml-2">
                          {getAssignedIncomeAccount(customerDetails.customer_group, customerDetails).name}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {customerTab === 'comercial' && (
                  <div className="space-y-2 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Condición de Venta:</span>
                        <span className="text-gray-900 font-medium ml-2">{customerDetails.payment_terms || 'No especificada'}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">% Descuento:</span>
                        <span className="text-gray-900 font-medium ml-2">{customerDetails.discount_percentage ? `${customerDetails.discount_percentage}%` : 'No especificado'}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Lista de Precios:</span>
                        <span className="text-gray-900 font-medium ml-2">{customerDetails.price_list || 'No especificada'}</span>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <span className="text-sm font-semibold text-gray-600">Transportista:</span>
                        <span className="text-gray-900 font-medium ml-2">{customerDetails.transporter || 'No especificado'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {customerTab === 'contacto' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Sitio web:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.website || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Email:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.email || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Teléfono:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.phone || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Contacto:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.contacto || 'No especificado'}</span>
                    </div>
                  </div>
                )}

                {customerTab === 'fiscal' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">CUIT:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.tax_id || 'No especificado'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Condición frente al IVA:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.custom_condicion_iva || 'No especificada'}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">IVA %:</span>
                      <span className="text-gray-900 font-medium ml-2">{customerDetails.porcentaje_iva ? `${customerDetails.porcentaje_iva}%` : 'No especificado'}</span>
                    </div>
                  </div>
                )}

                {customerTab === 'direccion' && (
                  <div className="space-y-4 mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-medium text-gray-900">Dirección Fiscal</h4>
                      <button
                        onClick={() => setIsAddressModalOpen(true)}
                        title="Gestionar direcciones adicionales"
                        className="inline-flex items-center px-3 py-1 text-sm text-gray-700 hover:text-gray-900 rounded-md transition-colors"
                      >
                        <MapPin size={16} className="mr-2" />
                        Gestionar Direcciones
                      </button>
                    </div>
                    {(() => {
                      const fiscalAddress = getFiscalAddress()
                      return fiscalAddress ? (
                        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                          <div className="flex items-start justify-between mb-2">
                            <h5 className="text-md font-semibold text-gray-900">
                              {fiscalAddress.address_title || 'Dirección Fiscal'}
                            </h5>
                            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                              Dirección Fiscal
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-gray-600">Dirección:</span>
                              <span className="text-gray-900 font-medium ml-2">
                                {fiscalAddress.address_line1 || 'No especificada'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">Ciudad:</span>
                              <span className="text-gray-900 font-medium ml-2">
                                {fiscalAddress.city || 'No especificada'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">Código Postal:</span>
                              <span className="text-gray-900 font-medium ml-2">
                                {fiscalAddress.pincode || 'No especificado'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">Provincia:</span>
                              <span className="text-gray-900 font-medium ml-2">
                                {fiscalAddress.state || 'No especificada'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">País:</span>
                              <span className="text-gray-900 font-medium ml-2">
                                {fiscalAddress.country || 'Argentina'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <MapPin size={48} className="text-gray-300 mx-auto mb-4" />
                          <p className="text-lg font-medium mb-2">No hay dirección fiscal registrada</p>
                          <p className="text-sm">Haz click en "Gestionar Direcciones" para agregar la dirección fiscal</p>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {customerTab === 'cuenta' && (
                  <div className="max-w-md mt-4 space-y-4">
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Cuenta por Cobrar:</span>
                      <span className="text-gray-900 font-medium text-lg ml-2">{extractAccountName(customerDetails.default_receivable_account) || 'No especificada'}</span>
                      <p className="text-sm text-gray-600 mt-2">Cuenta por defecto para las facturas de este cliente</p>
                    </div>
                    <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <span className="text-sm font-semibold text-gray-600">Cuenta de Ingresos:</span>
                      <span className="text-gray-900 font-medium text-lg ml-2">
                        {getAssignedIncomeAccount(customerDetails.customer_group, customerDetails).name}
                      </span>
                      <p className="text-sm text-gray-600 mt-2">Cuenta por defecto para los ingresos de las facturas de este cliente</p>
                    </div>
                  </div>
                )}
              </>
            ) : !loadingCustomerDetails ? (
              <div className="text-center py-12 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Selecciona un cliente del panel izquierdo para ver sus detalles</p>
              </div>
            ) : null}
          </div>
          )}
        </div>

        {/* Facturas y cuenta corriente - Abajo derecha */}
        <div className={`bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden min-w-0 ${
          isCustomerDetailsPanelExpanded ? 'flex-1' : 'flex-1'
        }`}>
          <div className="accounting-card-title">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-black text-gray-900">Facturas y Cuenta Corriente</h3>
              </div>
              {selectedCustomer && (
                <div className="action-chip-group">
                  <ActionChip
                    icon={FilePlus2}
                    variant="invoice"
                    label="Nueva factura"
                    helper="Venta / nota"
                    onClick={() => {
                      console.log('[Visualizacion] Opening invoice modal for customer:', selectedCustomer)
                      if (onCreateInvoice) {
                        onCreateInvoice()
                      } else {
                        setIsInvoiceModalOpen(true)
                      }
                    }}
                    disabled={!canCreateInvoice}
                    title={canCreateInvoice ? 'Crear factura' : salesInvoiceDisabledMessage}
                  />
                  {onCreateSalesOrder && (
                    <ActionChip
                      icon={ClipboardList}
                      variant="order"
                      label="Nueva orden de venta"
                      helper="Reserva stock"
                      onClick={() => onCreateSalesOrder()}
                      disabled={!selectedCustomer}
                    />
                  )}
                  {onCreateSalesQuotation && (
                    <ActionChip
                      icon={FileText}
                      variant="quotation"
                      label="Nuevo presupuesto"
                      helper="Propuesta"
                      onClick={() => onCreateSalesQuotation()}
                      disabled={!selectedCustomer}
                    />
                  )}
                  {onCreateSalesRemito && (
                    <ActionChip
                      icon={Layers}
                      variant="remito"
                      label="Nuevo remito"
                      helper="Entrega de mercadería"
                      onClick={() => {
                        if (canCreateSalesRemito && onCreateSalesRemito) {
                          onCreateSalesRemito()
                        }
                      }}
                      disabled={!canCreateSalesRemito}
                      title={canCreateSalesRemito ? 'Crear remito' : salesRemitoDisabledMessage}
                    />
                  )}
                  <ActionChip
                    icon={DollarSign}
                    variant="payment"
                    label="Registrar pago"
                    helper="Cobro / recibo"
                    onClick={() => {
                      if (onCreatePayment) {
                        onCreatePayment()
                      } else {
                        setIsPaymentModalOpen(true)
                      }
                    }}
                    disabled={!canRegisterPayment}
                    title={canRegisterPayment ? 'Registrar pago' : registerPaymentDisabledMessage}
                  />
                  <ActionChip
                    icon={Calculator}
                    variant="reconcile"
                    label="Conciliar facturas"
                    helper="Aplicar pagos"
                    onClick={() => setIsReconciliationModalOpen(true)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Pestañas para facturas y cuenta corriente */}
          {selectedCustomer && (
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
                  Borradores ({draftInvoicesCount})
                </button>
                <button
                  onClick={() => setInvoiceTab('sales-orders')}
                  className={`tab-button ${invoiceTab === 'sales-orders' ? 'active' : ''}`}
                >
                  Órdenes de Venta ({salesOrdersPendingCount || 0})
                </button>
                <button
                  onClick={() => setInvoiceTab('quotations')}
                  className={`tab-button ${invoiceTab === 'quotations' ? 'active' : ''}`}
                >
                  Presupuestos ({quotationsPagination?.total || 0})
                </button>
                <button
                  onClick={() => setInvoiceTab('remitos')}
                  className={`tab-button ${invoiceTab === 'remitos' ? 'active' : ''}`}
                >
                  Remitos ({deliveryNotesPagination?.total || 0})
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
          )}

          <div className="flex-1 p-6 overflow-hidden">
            {selectedCustomer ? (
              invoiceTab === 'unpaid' || invoiceTab === 'draft' ? (
              <div className="space-y-4">
                {renderItemsTable(
                  customerInvoices,
                  invoiceBulkOptions || undefined,
                  invoiceTab === 'unpaid'
                    ? {
                        summaryGroups: unbalancedConciliations,
                        onOpenConciliationDocument: handleOpenConciliationDoc
                      }
                    : undefined
                )}
              </div>
            ) : invoiceTab === 'sales-orders' ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-3">
                  <div className="tab-bar-with-action">
                    <nav className="tab-nav">
                      {salesOrderViewOptions.map((option) => {
                        const count = salesOrdersCounts?.[option.key] || 0
                        const isActive = salesOrdersView === option.key
                        return (
                          <button
                            key={option.key}
                            type="button"
                            className={`tab-button ${isActive ? 'active' : ''}`}
                            onClick={() => setSalesOrdersView && setSalesOrdersView(option.key)}
                          >
                            {option.label} ({count})
                          </button>
                        )
                      })}
                    </nav>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectionEnabled && (
                        <button
                          type="button"
                          onClick={handleMarkDeliveredClick}
                          disabled={!selectedSalesOrders.length || isLoadingSalesOrders}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-semibold border border-green-300 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Marcar como enviadas ({selectedSalesOrders.length || 0})
                        </button>
                      )}
                    </div>
                  </div>

                </div>
                <div className="px-4 py-3 bg-white border border-gray-200 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={salesOrdersSearchQuery}
                      onChange={(e) => {
                        const value = e.target.value ?? ''
                        setDocumentsSearchByTab((prev) => ({ ...(prev || {}), 'sales-orders': value }))
                      }}
                      placeholder="Buscar por comprobante, fecha, descripci¢n o monto..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    {!!salesOrdersSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setDocumentsSearchByTab((prev) => ({ ...(prev || {}), 'sales-orders': '' }))}
                        className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                        title="Limpiar b£squeda"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>
                {isLoadingSalesOrders ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    <span className="ml-3 text-gray-600">Cargando órdenes de venta...</span>
                  </div>
                ) : !customerSalesOrders || customerSalesOrders.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-semibold">{salesOrdersEmptyMessages[salesOrdersView]}</p>
                    {salesOrdersView === 'pending' && (
                      <p className="text-sm text-gray-500">Usá el botón "Nueva orden de venta" para reservar stock.</p>
                    )}
                  </div>
                ) : salesOrdersSearchQuery.trim() && (!visibleSalesOrders || visibleSalesOrders.length === 0) ? (
                  <div className="text-center py-12 text-gray-500">
                    <div className="text-4xl mb-4">🔎</div>
                    <p>No hay resultados para tu bœsqueda</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm bg-white">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Orden</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha</th>
                            {salesOrdersView !== 'cancelled' && (
                              <>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Facturación</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Entrega</th>
                                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Origen</th>
                              </>
                            )}
                            {salesOrdersView === 'cancelled' && (
                              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                            )}
                            {salesOrdersView !== 'cancelled' && (
                              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">PDF</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {[...visibleSalesOrders]
                            .sort((a, b) => {
                              // Ordenar: sin stock (reserve_stock === 0) primero
                              const aNoStock = Number(a.reserve_stock || 0) === 0 ? 0 : 1
                              const bNoStock = Number(b.reserve_stock || 0) === 0 ? 0 : 1
                              return aNoStock - bNoStock
                            })
                            .map((order) => {
                            const billedPercent = Number(order.per_billed || 0)
                            const deliveredPercent = Number(order.per_delivered || 0)
                            const billedStatus = order.billing_status || (billedPercent >= 99.99 ? 'Facturada' : 'Pendiente')
                            const deliveryStatus = order.delivery_status || (deliveredPercent >= 99.99 ? 'Entregada' : 'Pendiente')
                            const isSelected = selectedSalesOrders.includes(order.name)
                            const hasNoStock = Number(order.reserve_stock || 0) === 0
                            return (
                              <tr
                                key={order.name}
                                className={`hover:bg-blue-50 transition ${salesOrdersView !== 'cancelled' ? 'cursor-pointer' : ''} ${isSelected ? 'bg-blue-50/70' : ''} ${hasNoStock ? 'bg-orange-50/60' : ''}`}
                                onDoubleClick={salesOrdersView !== 'cancelled' ? (() => onOpenSalesOrder && onOpenSalesOrder(order.name)) : undefined}
                              >
                                {selectionEnabled && salesOrdersView !== 'cancelled' && (
                                  <td className="px-4 py-4 text-center">
                                    <input
                                      type="checkbox"
                                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      checked={isSelected}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        toggleSalesOrderSelection(order.name)
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </td>
                                )}
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-gray-900">{order.name}</span>
                                    {hasNoStock && (
                                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 border border-orange-200">
                                        Sin stock
                                      </span>
                                    )}
                                  </div>
                                  {order.marketplace_reference && (
                                    <div className="text-xs text-gray-500">{order.marketplace_reference}</div>
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                  {formatDate(order.receiving_date || order.delivery_date || order.transaction_date)}
                                </td>
                                {salesOrdersView !== 'cancelled' && (
                                  <>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="space-y-1">
                                        <span
                                          className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                                            billedPercent >= 99.99 ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
                                          }`}
                                        >
                                          {billedStatus}
                                        </span>
                                        <div className="text-xs text-gray-500">{billedPercent.toFixed(0)}% facturado</div>
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="space-y-1">
                                        <span
                                          className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                                            deliveredPercent >= 99.99 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
                                          }`}
                                        >
                                          {deliveryStatus}
                                        </span>
                                        <div className="text-xs text-gray-500">{deliveredPercent.toFixed(0)}% entregado</div>
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-gray-900">
                                      {formatBalance ? formatBalance(order.grand_total || order.rounded_total || 0) : `$${Number(order.grand_total || 0).toFixed(2)}`}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                      {order.po_no || order.source || 'Manual'}
                                    </td>
                                  </>
                                )}
                                {salesOrdersView === 'cancelled' && (
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                    Cancelado
                                  </td>
                                )}
                                {salesOrdersView !== 'cancelled' && (
                                  <td className="px-4 py-4 text-center">
                                    <button
                                      type="button"
                                      className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors disabled:opacity-50"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        onDownloadDocumentPdf &&
                                          onDownloadDocumentPdf({
                                            docType: 'Sales Order',
                                            docName: order.name,
                                            suggestedFileName: order.name
                                          })
                                      }}
                                      disabled={Boolean(downloadingDocuments[order.name])}
                                    >
                                      {downloadingDocuments[order.name] ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <FileDown className="w-4 h-4" />
                                      )}
                                    </button>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <span className="text-sm text-gray-500">
                        Mostrando {visibleSalesOrders.length} de {salesOrdersPagination?.total || customerSalesOrders.length} órdenes
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onSalesOrderPageChange && onSalesOrderPageChange((salesOrdersPagination?.page || 1) - 1, salesOrdersView)
                          }
                          className="px-3 py-1.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          disabled={!onSalesOrderPageChange || (salesOrdersPagination?.page || 1) <= 1}
                        >
                          Anterior
                        </button>
                        <span className="text-sm text-gray-500">
                          Página {salesOrdersPagination?.page || 1} de{' '}
                          {Math.max(1, Math.ceil((salesOrdersPagination?.total || 0) / (salesOrdersPagination?.pageSize || 1)))}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onSalesOrderPageChange && onSalesOrderPageChange((salesOrdersPagination?.page || 1) + 1, salesOrdersView)
                          }
                          className="px-3 py-1.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          disabled={
                            !onSalesOrderPageChange ||
                            (salesOrdersPagination?.page || 1) >=
                              Math.max(1, Math.ceil((salesOrdersPagination?.total || 0) / (salesOrdersPagination?.pageSize || 1)))
                          }
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : invoiceTab === 'quotations' ? (
              <div className="space-y-4">
                <div className="px-4 py-3 bg-white border border-gray-200 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={quotationsSearchQuery}
                      onChange={(e) => {
                        const value = e.target.value ?? ''
                        setDocumentsSearchByTab((prev) => ({ ...(prev || {}), quotations: value }))
                      }}
                      placeholder="Buscar por comprobante, fecha, descripci¢n o monto..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    {!!quotationsSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setDocumentsSearchByTab((prev) => ({ ...(prev || {}), quotations: '' }))}
                        className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                        title="Limpiar b£squeda"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>
                {isLoadingQuotations ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                  <span className="ml-3 text-gray-600">Cargando presupuestos...</span>
                </div>
              ) : !customerQuotations || customerQuotations.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-semibold">A\u00fan no hay presupuestos</p>
                  <p className="text-sm text-gray-500">Cre\u00e1 uno nuevo desde el bot\u00f3n de arriba.</p>
                </div>
              ) : quotationsSearchQuery.trim() && (!visibleQuotations || visibleQuotations.length === 0) ? (
                <div className="text-center py-12 text-gray-500">
                  <div className="text-4xl mb-4">🔎</div>
                  <p>No hay resultados para tu b£squeda</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm bg-white">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Presupuesto</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">V\u00e1lido hasta</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Docstatus</th>
                          <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {visibleQuotations.map((quotation) => {
                          const docstatus = Number(quotation.docstatus || 0)
                          const statusClass = docstatus === 1
                            ? 'bg-green-100 text-green-800'
                            : docstatus === 0
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          return (
                            <tr
                              key={quotation.name}
                              className="hover:bg-gray-50 cursor-pointer"
                              onDoubleClick={() => onOpenSalesQuotation && onOpenSalesQuotation(quotation.name)}
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {quotation.name}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {formatDate ? formatDate(quotation.transaction_date) : quotation.transaction_date}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {formatDate ? formatDate(quotation.valid_till) : quotation.valid_till}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700">
                                  {quotation.status || 'Borrador'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${statusClass}`}>
                                  {docstatus === 1 ? 'Emitido' : docstatus === 0 ? 'Borrador' : 'Cancelado'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                                {formatBalance ? formatBalance(quotation.grand_total || 0) : quotation.grand_total || 0}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {quotationsPagination && quotationsPagination.total > quotationsPagination.pageSize && (
                    <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200 sm:px-6">
                      <div className="text-sm text-gray-700">
                        Mostrando{' '}
                        <span className="font-medium">
                          {Math.min((quotationsPagination.page - 1) * quotationsPagination.pageSize + 1, quotationsPagination.total)}
                        </span>{' '}
                        a{' '}
                        <span className="font-medium">
                          {Math.min(quotationsPagination.page * quotationsPagination.pageSize, quotationsPagination.total)}
                        </span>{' '}
                        de{' '}
                        <span className="font-medium">{quotationsPagination.total}</span> resultados
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => onSalesQuotationPageChange && onSalesQuotationPageChange(quotationsPagination.page - 1)}
                          disabled={quotationsPagination.page <= 1}
                          className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          Anterior
                        </button>
                        {(() => {
                          const totalPages = Math.ceil(quotationsPagination.total / quotationsPagination.pageSize)
                          const currentPage = quotationsPagination.page
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
                                onClick={() => onSalesQuotationPageChange && onSalesQuotationPageChange(i)}
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
                          onClick={() => onSalesQuotationPageChange && onSalesQuotationPageChange(quotationsPagination.page + 1)}
                          disabled={quotationsPagination.page >= Math.ceil(quotationsPagination.total / quotationsPagination.pageSize)}
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
            ) : invoiceTab === 'remitos' ? (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeliveryNotesTab('pending')}
                    className={`tab-button ${deliveryNotesTab === 'pending' ? 'active' : ''}`}
                  >
                    Pendientes
                  </button>
                  <button
                    onClick={() => setDeliveryNotesTab('billed')}
                    className={`tab-button ${deliveryNotesTab === 'billed' ? 'active' : ''}`}
                  >
                    Facturados
                  </button>
                  <button
                    onClick={() => setDeliveryNotesTab('cancelled')}
                    className={`tab-button ${deliveryNotesTab === 'cancelled' ? 'active' : ''}`}
                  >
                    Cancelados
                  </button>
                </div>
                <div className="px-4 py-3 bg-white border border-gray-200 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={deliveryNotesSearchQuery}
                      onChange={(e) => {
                        const value = e.target.value ?? ''
                        setDocumentsSearchByTab((prev) => ({ ...(prev || {}), remitos: value }))
                      }}
                      placeholder="Buscar por comprobante, fecha, descripci¢n o monto..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    />
                    {!!deliveryNotesSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setDocumentsSearchByTab((prev) => ({ ...(prev || {}), remitos: '' }))}
                        className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                        title="Limpiar b£squeda"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>
                {isLoadingDeliveryNotes ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                  <span className="ml-3 text-gray-600">Cargando remitos...</span>
                </div>
              ) : !customerDeliveryNotes || customerDeliveryNotes.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No hay remitos para mostrar</p>
                </div>
              ) : !filteredDeliveryNotes || filteredDeliveryNotes.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>{deliveryNotesEmptyMessages?.[deliveryNotesTab] || 'No hay remitos para mostrar'}</p>
                </div>
              ) : deliveryNotesSearchQuery.trim() && (!visibleDeliveryNotes || visibleDeliveryNotes.length === 0) ? (
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
                            Importe
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            PDF
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {visibleDeliveryNotes.map((note) => {
                          const statusClass =
                            note.docstatus === 1
                              ? 'bg-green-100 text-green-800'
                              : note.docstatus === 0
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          return (
                            <tr
                              key={note.name}
                              className="hover:bg-gray-50 cursor-pointer"
                              onDoubleClick={() => onOpenSalesRemito && onOpenSalesRemito(note.name)}
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {formatVoucherNumber ? formatVoucherNumber(note.name) : note.name}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {formatDate ? formatDate(note.posting_date) : note.posting_date}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${statusClass}`}>
                                  {(() => {
                                    if (note.docstatus === 2) return 'Cancelado'
                                    const estado = (note.status || '').toString().trim().toLowerCase()
                                    if (estado === 'completed' || estado === 'completado') return 'Facturado'
                                    if (estado === 'to bill' || estado === 'por facturar') return 'Pendiente'
                                    if (note.docstatus === 1) return 'Confirmado'
                                    if (note.docstatus === 0) return 'Borrador'
                                    return note.status || '-'
                                  })()}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {note.total_qty || 0}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {formatBalance ? formatBalance(note.grand_total || note.rounded_total || 0) : (note.grand_total || 0)}
                              </td>
                              <td className="px-4 py-4 text-center">
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors disabled:opacity-50"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onDownloadDocumentPdf &&
                                      onDownloadDocumentPdf({
                                        docType: 'Delivery Note',
                                        docName: note.name,
                                        suggestedFileName: formatVoucherNumber ? formatVoucherNumber(note.name) : note.name
                                      })
                                  }}
                                  disabled={Boolean(downloadingDocuments[note.name])}
                                >
                                  {downloadingDocuments[note.name] ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <FileDown className="w-4 h-4" />
                                  )}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {deliveryNotesPagination && deliveryNotesPagination.total > deliveryNotesPagination.pageSize && (
                    <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200 sm:px-6">
                      <div className="text-sm text-gray-700">
                        Mostrando{' '}
                        <span className="font-medium">
                          {Math.min((deliveryNotesPagination.page - 1) * deliveryNotesPagination.pageSize + 1, deliveryNotesPagination.total)}
                        </span>{' '}
                        a{' '}
                        <span className="font-medium">
                          {Math.min(deliveryNotesPagination.page * deliveryNotesPagination.pageSize, deliveryNotesPagination.total)}
                        </span>{' '}
                        de{' '}
                        <span className="font-medium">{deliveryNotesPagination.total}</span> resultados
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => onSalesRemitoPageChange && onSalesRemitoPageChange(deliveryNotesPagination.page - 1)}
                          disabled={deliveryNotesPagination.page <= 1}
                          className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          Anterior
                        </button>
                        {(() => {
                          const totalPages = Math.ceil(deliveryNotesPagination.total / deliveryNotesPagination.pageSize)
                          const currentPage = deliveryNotesPagination.page
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
                            pages.push(i)
                          }
                          return pages.map(page => (
                            <button
                              key={page}
                              onClick={() => onSalesRemitoPageChange && onSalesRemitoPageChange(page)}
                              className={`px-3 py-2 border border-gray-300 text-sm font-medium rounded-md ${
                                page === currentPage ? 'bg-gray-200 text-gray-800' : 'bg-white text-gray-500 hover:bg-gray-50'
                              }`}
                            >
                              {page}
                            </button>
                          ))
                        })()}
                        <button
                          onClick={() => onSalesRemitoPageChange && onSalesRemitoPageChange(deliveryNotesPagination.page + 1)}
                          disabled={deliveryNotesPagination.page >= Math.ceil(deliveryNotesPagination.total / deliveryNotesPagination.pageSize)}
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
            ) : (
              <div className="space-y-6">
                <StatementsTable
                  statements={customerStatements}
                  hasMoreStatements={hasMoreStatements}
                  loadingMoreStatements={loadingMoreStatements}
                  loadMoreStatements={loadMoreStatements}
                  fetchWithAuth={fetchWithAuth}
                  formatBalance={formatBalance}
                  formatDate={formatDate}
                  formatVoucherNumber={formatVoucherNumber}
                  mapVoucherTypeToSigla={mapVoucherTypeToSigla}
                  truncateDescription={truncateDescription}
                  isInvoiceVoucherType={isInvoiceVoucherType}
                  isPaymentVoucherType={isPaymentVoucherType}
                  isCreditVoucherType={isCreditVoucherType}
                  isDebitVoucherType={isDebitVoucherType}
                  openStatementEntry={openStatementEntry}
                  pagination={{
                    page: statementTablePage,
                    pageSize: statementTablePageSize
                  }}
                  onPageChange={onStatementPageChange}
                  conciliationGroups={conciliationGroups}
                  onOpenConciliationDocument={handleOpenConciliationDoc}
                />
              </div>
            )) : (
              <div className="text-center text-gray-500">
                Selecciona un cliente para ver Facturas y Cuenta Corriente
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal para crear factura */}
      <InvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => {
          setIsInvoiceModalOpen(false)
          setEditingInvoice(null)
          onConsumeLinkedInvoiceDraft()
          // Refrescar datos del cliente cuando se cierra el modal (por si se creó una nota de crédito)
          if (selectedCustomer) {
            fetchCustomerInvoices(selectedCustomer)
            fetchCustomerStatements(selectedCustomer)
          }
        }}
        onSave={handleCreateInvoice}
        selectedCustomer={selectedCustomer}
        editingData={editingInvoice}
        unpaidInvoicesCount={unpaidInvoicesCount}
        prefetchedCustomerDetails={customerDetails}
        prefillData={linkedInvoiceDraft}
        onPrefillConsumed={onConsumeLinkedInvoiceDraft}
        prefetchedTalonarios={companyTalonarios}
      />

      {/* Modal de direcciones */}
      <AddressModal
        isOpen={isAddressModalOpen}
        onClose={handleCloseAddressModal}
        customerName={selectedCustomer}
        customerId={customerDetails?.name}
      />

      {/* Modal de pagos */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onSave={(paymentData) => {
          // Aquí puedes agregar lógica adicional después de guardar el pago
          // Por ejemplo, recargar las facturas del cliente
          if (selectedCustomer) {
            fetchCustomerInvoices(selectedCustomer)
          }
          showNotification('Pago registrado exitosamente', 'success')
        }}
        selectedCustomer={selectedCustomer}
        editingData={editingPayment} // Pasar el pago en edición
        customerDetails={customerDetails}
      />

      <ReconciliationModal
        isOpen={isReconciliationModalOpen}
        onClose={() => {
          setIsReconciliationModalOpen(false)
          // Refrescar datos del cliente cuando se cierra el modal
          if (selectedCustomer) {
            fetchCustomerInvoices(selectedCustomer)
            fetchCustomerStatements(selectedCustomer)
          }
        }}
        customer={selectedCustomer}
        company={activeCompany}
      />

      <ConfirmDialog />

      {/* Modal centralizado de Customer Group */}
      <CustomerGroupModal
        isOpen={showTestModal}
        onClose={handleCloseCustomerGroupModal}
        editingGroup={editingCustomerGroup}
        groupFormData={customerGroupFormData}
        onFormChange={setCustomerGroupFormData}
        onSave={handleSaveCustomerGroup}
        saving={savingCustomerGroup}
        customerGroups={customerGroups}
        salesPriceLists={availablePriceLists}
        availableIncomeAccounts={availableIncomeAccounts}
        paymentTermsTemplates={paymentTermsTemplates}
        extractAccountName={extractAccountName}
      />
    </div>
  )
 }
