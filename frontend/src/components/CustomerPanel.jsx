import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react'
import { AuthContext } from '../AuthProvider'
import { NotificationContext } from '../contexts/NotificationContext'
import API_ROUTES from '../apiRoutes'
import { getAfipData, validateCuit } from '../apiUtils'
import { useConfirm } from '../hooks/useConfirm'
import useTaxTemplates from '../hooks/useTaxTemplates'
import { templateMatchesType, TEMPLATE_TYPES } from '../utils/taxTemplates'
import { ChevronRight, ChevronDown, Folder, FileText, Plus, Edit, Trash2, Calculator, BarChart3, Receipt, Save, Check, X, Circle, Users, MapPin, Search } from 'lucide-react'
import InvoiceModal from './modals/InvoiceModal/InvoiceModal.jsx'
import AddressModal from './modals/AddressModal.jsx'
import PaymentModal from './modals/PaymentModal.jsx'
import ReconciliationModal from './modals/ReconciliationModal.jsx'
import SalesRemitoModal from './modals/SalesRemitoModal/SalesRemitoModal.jsx'
import SalesOrderModal from './modals/SalesOrderModal/SalesOrderModal.jsx'
import SalesQuotationModal from './modals/SalesQuotationModal/SalesQuotationModal.jsx'
import Visualizacion from './Customerpanel/Visualizacion.jsx'
import SubscriptionBulkManager from './Customerpanel/SubscriptionBulkManager.jsx'
import CustomerInvoicesTable from './Customerpanel/CustomerInvoicesTable.jsx'
import CustomerGroupModal from './configcomponents/modals/CustomerGroupModal'
import { prepareSalesRemitoModalPayload } from '../utils/salesRemitoDataPreparation.js'
import { mapVoucherTypeToSigla } from '../utils/comprobantes'
import {
  CUSTOMER_BULK_TABS,
  SALES_ORDERS_PAGE_SIZE,
  SALES_QUOTATIONS_PAGE_SIZE,
  CUSTOMER_INVOICE_PAGE_SIZE,
  CUSTOMER_STATEMENT_PAGE_SIZE,
  SALES_ORDER_VIEW_MAP
} from './Customerpanel/constants'
import useCustomerSalesOrders from './Customerpanel/hooks/useCustomerSalesOrders'
export default function CustomerPanel() {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const { confirm, ConfirmDialog } = useConfirm()
  const { templates: taxTemplatesFromHook, sales: taxSales, purchase: taxPurchase, loading: taxTemplatesLoading, error: taxTemplatesError, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)
  useEffect(() => {
    if (taxTemplatesFromHook && Array.isArray(taxTemplatesFromHook)) {
      setTaxTemplates(taxTemplatesFromHook)
    }
  }, [taxTemplatesFromHook])
  const [customers, setCustomers] = useState([])
  const [customerListTab, setCustomerListTab] = useState('customers') // customers | subscriptions
  const [subscriptionCustomers, setSubscriptionCustomers] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customerDetails, setCustomerDetails] = useState(null)
  const [customerSubscriptions, setCustomerSubscriptions] = useState([])
  const [isLoadingCustomerSubscriptions, setIsLoadingCustomerSubscriptions] = useState(false)
  const [subscriptionMutations, setSubscriptionMutations] = useState({})
  const [allCustomerInvoices, setAllCustomerInvoices] = useState([]) // Todas las facturas
  const [customerPayments, setCustomerPayments] = useState([]) // Todos los pagos
  const [customerInvoices, setCustomerInvoices] = useState([]) // Facturas filtradas para mostrar
  const [unpaidInvoicesCount, setUnpaidInvoicesCount] = useState(0)
  const [draftInvoicesCount, setDraftInvoicesCount] = useState(0)
  const [customerStatements, setCustomerStatements] = useState([])
  const [invoiceTablePage, setInvoiceTablePage] = useState(1)
  const [statementTablePage, setStatementTablePage] = useState(1)
  const [pendingInvoices, setPendingInvoices] = useState([])
  const [customerConciliations, setCustomerConciliations] = useState([])
  const [expandedConciliationRows, setExpandedConciliationRows] = useState({})
  const [loading, setLoading] = useState(false)
  const [loadingSubscriptionCustomers, setLoadingSubscriptionCustomers] = useState(false)
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)
  const [linkedInvoiceDraft, setLinkedInvoiceDraft] = useState(null)
  const [isEditingCustomer, setIsEditingCustomer] = useState(false)
  const [editedCustomerData, setEditedCustomerData] = useState({})
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState(null)
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false)
  const [customerAddresses, setCustomerAddresses] = useState([])
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState(null) // Estado para el pago en edición
  const [isReconciliationModalOpen, setIsReconciliationModalOpen] = useState(false)
  const [isSalesRemitoModalOpen, setIsSalesRemitoModalOpen] = useState(false)
  const [selectedSalesRemito, setSelectedSalesRemito] = useState(null)
  const [salesRemitoDraftData, setSalesRemitoDraftData] = useState(null)
  const [customerDeliveryNotes, setCustomerDeliveryNotes] = useState([])
  const [deliveryNotesPagination, setDeliveryNotesPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0
  })
  const [isLoadingDeliveryNotes, setIsLoadingDeliveryNotes] = useState(false)
  const [customerQuotations, setCustomerQuotations] = useState([])
  const [quotationsPagination, setQuotationsPagination] = useState({
    page: 1,
    pageSize: SALES_QUOTATIONS_PAGE_SIZE,
    total: 0
  })
  const [isLoadingQuotations, setIsLoadingQuotations] = useState(false)
  const [isSalesQuotationModalOpen, setIsSalesQuotationModalOpen] = useState(false)
  const [editingSalesQuotation, setEditingSalesQuotation] = useState(null)
  const [companyTalonarios, setCompanyTalonarios] = useState([])
  const [companyBankAccounts, setCompanyBankAccounts] = useState([])
  const [bulkDeleteState, setBulkDeleteState] = useState({
    active: false,
    context: null,
    selected: new Set()
  })
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [downloadingDocuments, setDownloadingDocuments] = useState({})
  const [showSubscriptionManager, setShowSubscriptionManager] = useState(false)
  
  // Estado para controlar si el panel de detalles está expandido (colapsado por defecto)
  const [isCustomerDetailsPanelExpanded, setIsCustomerDetailsPanelExpanded] = useState(false)
  // Estado para indicar si los detalles del cliente ya fueron cargados
  const [customerDetailsLoaded, setCustomerDetailsLoaded] = useState(false)
  // Estado de carga de detalles del cliente
  const [loadingCustomerDetails, setLoadingCustomerDetails] = useState(false)
  // Toggle para mostrar nombre comercial vs nombre fiscal en la lista
  const [showCommercialName, setShowCommercialName] = useState(false)
  const isActiveTalonario = useCallback((talonario = {}) => {
    const docstatus = talonario.docstatus ?? 0
    return docstatus === 0 || docstatus === 1
  }, [])
  const isSalesRemitoTalonario = useCallback((talonario = {}) => {
    if (!isActiveTalonario(talonario)) return false
    const tipo = (talonario.tipo_de_talonario || '').toLowerCase()
    const hasLetterR = Array.isArray(talonario.letras) && talonario.letras.some(
      (entry) => (entry.letra || '').toUpperCase() === 'R'
    )
    return hasLetterR && tipo.includes('remito')
  }, [isActiveTalonario])
  const isSalesInvoiceTalonario = useCallback((talonario = {}) => {
    if (!isActiveTalonario(talonario)) return false
    const tipo = (talonario.tipo_de_talonario || '').toLowerCase()
    const keywords = ['factura', 'resguardo', 'exportacion']
    return keywords.some(keyword => tipo.includes(keyword))
  }, [isActiveTalonario])
  const isReceiptTalonario = useCallback((talonario = {}) => {
    if (!isActiveTalonario(talonario)) return false
    const tipo = (talonario.tipo_de_talonario || '').toLowerCase()
    return tipo.includes('recibo')
  }, [isActiveTalonario])
  const hasActiveSalesRemitoTalonario = useMemo(
    () => companyTalonarios.some(isSalesRemitoTalonario),
    [isSalesRemitoTalonario, companyTalonarios]
  )
  const hasActiveSalesInvoiceTalonario = useMemo(
    () => companyTalonarios.some(isSalesInvoiceTalonario),
    [companyTalonarios, isSalesInvoiceTalonario]
  )
  const hasActiveReceiptTalonario = useMemo(
    () => companyTalonarios.some(isReceiptTalonario),
    [companyTalonarios, isReceiptTalonario]
  )
  const hasCompanyBankAccount = useMemo(
    () => companyBankAccounts.length > 0,
    [companyBankAccounts]
  )
  // Para registrar pagos se requiere talonario de recibos Y al menos una cuenta bancaria
  const canRegisterPayment = useMemo(
    () => hasActiveReceiptTalonario && hasCompanyBankAccount,
    [hasActiveReceiptTalonario, hasCompanyBankAccount]
  )
  const salesRemitoDisabledMessage = 'Necesitas habilitar un talonario de remitos (letra R) en Configuración > Talonarios'
  const salesInvoiceDisabledMessage = 'Necesitas habilitar un talonario de facturas en Configuración > Talonarios'
  const registerPaymentDisabledMessage = useMemo(() => {
    if (!hasActiveReceiptTalonario && !hasCompanyBankAccount) {
      return 'Necesitas habilitar un talonario de tipo "RECIBOS" y una cuenta bancaria en Configuración'
    }
    if (!hasActiveReceiptTalonario) {
      return 'Necesitas habilitar un talonario de tipo "RECIBOS" en Configuración > Talonarios'
    }
    if (!hasCompanyBankAccount) {
      return 'Necesitas configurar al menos una cuenta bancaria para esta compañía'
    }
    return ''
  }, [hasActiveReceiptTalonario, hasCompanyBankAccount])
  const fetchCompanyTalonarios = useCallback(async () => {
    if (!activeCompany) {
      setCompanyTalonarios([])
      return []
    }
    try {
      const response = await fetchWithAuth(`/api/talonarios?compania=${encodeURIComponent(activeCompany)}&activos=1`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'Error al cargar talonarios de remitos')
      }
      const talonarios = payload.data || []
      setCompanyTalonarios(talonarios)
      return talonarios
    } catch (error) {
      console.error('Error fetching sales remito talonarios:', error)
      setCompanyTalonarios([])
      return []
    }
  }, [activeCompany, fetchWithAuth])
  const fetchCompanyBankAccounts = useCallback(async () => {
    if (!activeCompany) {
      setCompanyBankAccounts([])
      return []
    }
    try {
      const filters = JSON.stringify([
        ['company', '=', activeCompany],
        ['disabled', '=', 0]
      ])
      const response = await fetchWithAuth(`/api/resource/Bank Account?filters=${encodeURIComponent(filters)}&fields=["name","account_name","bank","company"]`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message || 'Error al cargar cuentas bancarias')
      }
      const accounts = payload.data || []
      setCompanyBankAccounts(accounts)
      return accounts
    } catch (error) {
      console.error('Error fetching company bank accounts:', error)
      setCompanyBankAccounts([])
      return []
    }
  }, [activeCompany, fetchWithAuth])
  const fetchCustomerQuotations = useCallback(async (customerName, page = 1) => {
    if (!customerName) {
      setCustomerQuotations([])
      setQuotationsPagination({
        page: 1,
        pageSize: SALES_QUOTATIONS_PAGE_SIZE,
        total: 0
      })
      return
    }
    try {
      setIsLoadingQuotations(true)
      const pageSize = quotationsPagination.pageSize || SALES_QUOTATIONS_PAGE_SIZE
      const params = new URLSearchParams({
        customer: customerName,
        page: page.toString(),
        limit: pageSize.toString()
      })
      if (activeCompany) {
        params.set('company', activeCompany)
      }
      const response = await fetchWithAuth(`${API_ROUTES.salesQuotations}?${params.toString()}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'Error al cargar presupuestos')
      }
      setCustomerQuotations(payload.quotations || [])
      setQuotationsPagination({
        page: payload.page || page,
        pageSize: payload.page_size || pageSize,
        total: payload.total_count || 0
      })
    } catch (error) {
      console.error('Error fetching customer sales quotations:', error)
      showNotification(error.message || 'Error al cargar presupuestos', 'error')
    } finally {
      setIsLoadingQuotations(false)
    }
  }, [activeCompany, fetchWithAuth, quotationsPagination.pageSize, showNotification])

  // Estados para pestañas y filtros principales
  const [invoiceTab, setInvoiceTab] = useState('unpaid') // 'unpaid', 'draft', 'remitos', 'statement'
  const [customerTab, setCustomerTab] = useState('general') // 'general', 'comercial', 'contacto', 'fiscal', 'direccion'
  const [availableAssetAccounts, setAvailableAssetAccounts] = useState([])
  const [availableIncomeAccounts, setAvailableIncomeAccounts] = useState([])
  const [paymentTermsTemplates, setPaymentTermsTemplates] = useState([])
  const [taxTemplates, setTaxTemplates] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [consultingAfip, setConsultingAfip] = useState(false)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)

  // Estados para grupos de clientes
  const [customerGroups, setCustomerGroups] = useState([])
  const [loadingCustomerGroups, setLoadingCustomerGroups] = useState(false)
  const [showCustomerGroupModal, setShowCustomerGroupModal] = useState(false)
  const [customerGroupFormData, setCustomerGroupFormData] = useState({
    name: '',
    parent_group: '',
    default_price_list: '',
    account: '',
    payment_terms: '',
    is_group: 0
  })
  const [editingCustomerGroup, setEditingCustomerGroup] = useState(null)
  const [savingCustomerGroup, setSavingCustomerGroup] = useState(false)
  const {
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
  } = useCustomerSalesOrders({
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
  })
  // Estado para modal de prueba
  const [showTestModal, setShowTestModal] = useState(false)
  // Estados para listas de precios
  const [availablePriceLists, setAvailablePriceLists] = useState([])
  // Estados para paginación de clientes
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const [pageSize] = useState(20) // 20 clientes por página
  const [subscriptionPage, setSubscriptionPage] = useState(1)
  const [totalSubscriptionCustomers, setTotalSubscriptionCustomers] = useState(0)
  const [searchTimeout, setSearchTimeout] = useState(null)
  // Estados para paginación de estados de cuenta
  const [statementsPage, setStatementsPage] = useState(1)
  const [statementsPageSize] = useState(50) // 50 movimientos por página
  const [hasMoreStatements, setHasMoreStatements] = useState(true)
  const [loadingMoreStatements, setLoadingMoreStatements] = useState(false)
  // Guard to avoid repeated identical fetches (helps prevent runaway loops)
  const lastFetchedStatementsRef = useRef({ customer: null, page: null, inFlight: false, timestamp: 0 })
  // Estados para modales de confirmación
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    onCancel: null,
    type: 'warning' // 'warning', 'danger', 'info'
  })
  const resetBulkDeleteState = () => {
    setBulkDeleteState({
      active: false,
      context: null,
      selected: new Set()
    })
  }
  // Funciones para manejar modal de confirmación
  const showConfirmModal = (title, message, onConfirm, onCancel = null, type = 'warning') => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm,
      onCancel,
      type
    })
  }
  const hideConfirmModal = () => {
    setConfirmModal({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: null,
      onCancel: null,
      type: 'warning'
    })
  }
  const handleConfirmAction = () => {
    if (confirmModal.onConfirm) {
      confirmModal.onConfirm()
    }
    hideConfirmModal()
  }
  const handleCancelAction = () => {
    if (confirmModal.onCancel) {
      confirmModal.onCancel()
    }
    hideConfirmModal()
  }
  const downloadDocumentPdf = async ({ docType, docName, suggestedFileName }) => {
    if (!docType || !docName || !API_ROUTES.documentFormats?.pdf) {
      showNotification && showNotification('La descarga de PDFs todavía no está disponible para este documento', 'warning')
      return
    }
    const normalizedDocName = docName?.trim()
    if (!normalizedDocName) {
      showNotification && showNotification('No encontramos el identificador completo del documento', 'warning')
      return
    }
    const query = new URLSearchParams()
    if (suggestedFileName) {
      const safeName = suggestedFileName.toString().trim().replace(/\.pdf$/i, '')
      query.set('filename', `${safeName}.pdf`)
    }
    const pdfUrl = `${API_ROUTES.documentFormats.pdf(docType, normalizedDocName)}${query.toString() ? `?${query.toString()}` : ''}`
    setDownloadingDocuments((prev) => ({ ...prev, [normalizedDocName]: true }))
    try {
      const response = await fetchWithAuth(pdfUrl)
      if (!response.ok) {
        let errorMessage = `No pudimos generar el PDF (HTTP ${response.status})`
        try {
          const errorPayload = await response.clone().json()
          if (errorPayload?.message) {
            errorMessage = errorPayload.message
          }
        } catch {
          /* ignore */
        }
        throw new Error(errorMessage)
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${suggestedFileName || docName}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      showNotification && showNotification('PDF generado', 'success')
    } catch (error) {
      console.error('[CustomerPanel] Error downloading PDF', error)
      showNotification && showNotification('No pudimos generar el PDF', 'error')
    } finally {
      setDownloadingDocuments((prev) => {
        const next = { ...prev }
        delete next[normalizedDocName]
        return next
      })
    }
  }
  const handleInvoiceDeleted = async () => {
    console.log('🔄 Refrescando datos después de eliminar factura')
    
    try {
      if (selectedCustomer) {
        fetchCustomerInvoices(selectedCustomer)
        fetchCustomerStatements(selectedCustomer)
      }
    } catch (error) {
      console.error('Error refrescando datos:', error)
    }
  }
  // Helper to extract a display name for accounts (keeps compatibility)
  const extractAccountName = (account) => {
    if (!account) return ''
    // If account is an object with readable name
    if (typeof account === 'object') {
      const fullName = account.account_name || account.name || ''
      // Extract just the account name from format like "5.1.8.03.00 - Ajuste de Existencia - DELP"
      const parts = fullName.split(' - ')
      return parts.length >= 2 ? parts[1] : fullName
    }
    // If it's a string, extract the readable name from format like "5.1.8.03.00 - Ajuste de Existencia - DELP"
    if (typeof account === 'string') {
      const parts = account.split(' - ')
      return parts.length >= 2 ? parts[1] : account
    }
    return account
  }
  // Función helper para truncar el nombre de factura a los primeros 23 caracteres
  const truncateInvoiceNumber = (invoiceName) => {
    if (!invoiceName) return invoiceName
    // Para facturas con talonarios, mostrar solo los primeros 23 caracteres
    // Ejemplo: 'FM-FAC-A-00003-0000000100003' -> 'FM-FAC-A-00003-00000001'
    if (invoiceName.includes('-') && invoiceName.split('-').length >= 5) {
      const parts = invoiceName.split('-')
      // Mantener los primeros 4 grupos y truncar el último
      return parts.slice(0, 4).join('-') + '-' + parts[4].substring(0, 8)
    }
    return invoiceName
  }
  // Función para formatear el número de comprobante según el nuevo formato
  const formatVoucherNumber = (voucherNo) => {
    if (!voucherNo) return voucherNo
    // Ejemplo: "FE-FAC-A-00003-00000001" -> "A 00003 00000001"
    const parts = voucherNo.split('-')
    if (parts.length >= 5) {
      const letra = parts[2] // A
      const numero1 = parts[3] // 00003
      const numero2 = parts[4].substring(0, 8) // 00000001 (solo primeros 8 dígitos)
      return `${letra} ${numero1} ${numero2}`
    }
    return voucherNo // Si no tiene el formato esperado, devolver original
  }
  // Función para mapear tipos de comprobante a siglas
  const truncateDescription = (description, maxLength = 24) => {
    if (!description) return description
    if (description.length <= maxLength) return description
    return description.substring(0, maxLength) + '...'
  }
  // Función para remover la abreviatura de la empresa del nombre
  const removeCompanyAbbr = (name) => {
    if (!name) return name
    const abbr = activeCompanyDetails?.abbr
    if (!abbr) return name
    // Remove trailing " - ABBR" if present
    const suffix = ` - ${abbr}`
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length).trim()
    // Also try removing other common patterns like '-ABBR' (no space)
    const suffixNoSpace = `-${abbr}`
    if (name.endsWith(suffixNoSpace)) return name.slice(0, -suffixNoSpace.length).trim()
    return name
  }
  // Ref para saber si es el primer render
  const isFirstRender = useRef(true)
  // Ref para evitar recargar los mismos datos del cliente varias veces seguidas (por ejemplo con StrictMode)
  const lastLoadedCustomerRef = useRef(null)
  useEffect(() => {
    setExpandedConciliationRows({})
  }, [customerConciliations])
  // Cargar clientes al montar el componente
  useEffect(() => {
    fetchCustomers()
  }, [])
  // Cargar detalles de la compañía activa al inicio si no están cargados
  useEffect(() => {
    if (activeCompany && !activeCompanyDetails) {
      fetchActiveCompanyDetails(activeCompany)
    }
  }, [activeCompany])
  // Las cuentas contables se cargan solo cuando se necesitan (al editar/crear cliente)
  // Refrescar datos cuando cambie la empresa activa (NO en el primer render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (activeCompany) {
      console.log('Empresa activa cambió, refrescando datos...')
      setCurrentPage(1) // Resetear a página 1
      setCustomerSearch('') // Limpiar búsqueda
      fetchCustomers()
      fetchActiveCompanyDetails(activeCompany)
    }
  }, [activeCompany])
  // Los talonarios y cuentas bancarias se cargan solo cuando se abren modales que los necesitan
  // Recompute display_name for groups when company abbr becomes available
  useEffect(() => {
    if (!customerGroups || customerGroups.length === 0) return
    const abbr = activeCompanyDetails?.abbr || ''
    if (!abbr) return
    const updated = customerGroups.map(g => {
      const raw = g.customer_group_name || g.name || ''
      const suffix = ` - ${abbr}`
      if (!raw) return { ...g, display_name: '' }
      if (raw.endsWith(suffix)) return { ...g, display_name: raw.slice(0, -suffix.length).trim() }
      if (raw.endsWith(`-${abbr}`)) return { ...g, display_name: raw.slice(0, -abbr.length - 1).trim() }
      return { ...g, display_name: raw }
    })
    setCustomerGroups(updated)
  }, [activeCompanyDetails?.abbr])
  useEffect(() => {
    setInvoiceTablePage(prev => {
      if (customerInvoices.length === 0) {
        return 1
      }
      const totalPages = Math.max(1, Math.ceil(customerInvoices.length / CUSTOMER_INVOICE_PAGE_SIZE))
      return Math.min(prev, totalPages)
    })
  }, [customerInvoices.length])
  useEffect(() => {
    setStatementTablePage(prev => {
      if (customerStatements.length === 0) {
        return 1
      }
      const totalPages = Math.max(1, Math.ceil(customerStatements.length / CUSTOMER_STATEMENT_PAGE_SIZE))
      return Math.min(prev, totalPages)
    })
  }, [customerStatements.length])
  const fetchCustomerSubscriptions = useCallback(async (customerName) => {
    if (!customerName) {
      setCustomerSubscriptions([])
      return []
    }
    try {
      setIsLoadingCustomerSubscriptions(true)
      const response = await fetchWithAuth(API_ROUTES.customerSubscriptions(customerName))
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'No pudimos cargar las suscripciones del cliente')
      }
      const list = Array.isArray(payload.data) ? payload.data : []
      setCustomerSubscriptions(list)
      return list
    } catch (error) {
      console.error('Error fetching customer subscriptions:', error)
      setCustomerSubscriptions([])
      return []
    } finally {
      setIsLoadingCustomerSubscriptions(false)
    }
  }, [fetchWithAuth])

  const fetchSubscriptionCustomers = useCallback(async (page) => {
    try {
      setLoadingSubscriptionCustomers(true)
      const params = new URLSearchParams({
        page: (page || subscriptionPage).toString(),
        limit: pageSize.toString()
      })
      if (customerSearch) {
        params.set('search', customerSearch)
      }
      const response = await fetchWithAuth(`${API_ROUTES.subscriptionCustomers}?${params.toString()}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'Error al cargar clientes con suscripciones')
      }
      const list = payload.data || []
      setSubscriptionCustomers(list)
      setTotalSubscriptionCustomers(payload.pagination?.total || list.length)
      return list
    } catch (error) {
      console.error('Error fetching subscription customers:', error)
      setSubscriptionCustomers([])
      setTotalSubscriptionCustomers(0)
      return []
    } finally {
      setLoadingSubscriptionCustomers(false)
    }
  }, [customerSearch, fetchWithAuth, pageSize])
  // Cargar datos de facturas y cuenta corriente cuando se selecciona un cliente
  // (Los detalles del cliente se cargan solo cuando se expande el panel)
  useEffect(() => {
    if (selectedCustomer && selectedCustomer !== 'new') {
      if (lastLoadedCustomerRef.current === selectedCustomer) {
        return
      }
      lastLoadedCustomerRef.current = selectedCustomer
      const loadCustomerInvoicesData = async (customerName) => {
        // Resetear paginacion de estados
        setStatementsPage(1)
        setHasMoreStatements(true)
        setLoadingMoreStatements(false)
        setInvoiceTablePage(1)
        setStatementTablePage(1)
        
        // Resetear estado de detalles expandidos
        setIsCustomerDetailsPanelExpanded(false)
        setCustomerDetailsLoaded(false)
        setCustomerDetails(null)
        setCustomerAddresses([])
        // Cargar talonarios y cuentas bancarias para habilitar los action chips
        const configRequests = []
        if (companyTalonarios.length === 0) {
          configRequests.push(fetchCompanyTalonarios())
        }
        if (companyBankAccounts.length === 0) {
          configRequests.push(fetchCompanyBankAccounts())
        }
        if (configRequests.length > 0) {
          await Promise.all(configRequests)
        }
        // Solo cargar facturas, statements, pagos y documentos relacionados
        // Los detalles del cliente se cargan a demanda cuando se expande el panel
        const invoiceRequests = [
          fetchCustomerInvoices(customerName),
          fetchCustomerStatements(customerName),
          fetchCustomerPayments(customerName),
          fetchCustomerSubscriptions(customerName),
          fetchCustomerDeliveryNotes(customerName),
          fetchCustomerQuotations(customerName)
        ]
        await Promise.allSettled(invoiceRequests)
        await fetchCustomerSalesOrders(customerName, 1, 'pending')
      }
      loadCustomerInvoicesData(selectedCustomer)
      // No cargar cuentas contables aqui - solo cuando se edite
    } else {
      lastLoadedCustomerRef.current = null
      // Limpiar datos cuando no hay cliente seleccionado
      setCustomerDetails(null)
      setCustomerDetailsLoaded(false)
      setIsCustomerDetailsPanelExpanded(false)
      setAllCustomerInvoices([])
      setCustomerInvoices([])
      setInvoiceTablePage(1)
      setStatementTablePage(1)
      setUnpaidInvoicesCount(0)
      setDraftInvoicesCount(0)
      setCustomerStatements([])
      setCustomerPayments([])
      setCustomerAddresses([])
      setCustomerSubscriptions([])
      setCustomerDeliveryNotes([])
      setDeliveryNotesPagination(prev => ({ ...prev, page: 1, total: 0 }))
      setCustomerQuotations([])
      setQuotationsPagination({
        page: 1,
        pageSize: SALES_QUOTATIONS_PAGE_SIZE,
        total: 0
      })
      setIsLoadingQuotations(false)
      setSelectedSalesRemito(null)
      setSalesRemitoDraftData(null)
      setIsSalesRemitoModalOpen(false)
      setIsLoadingDeliveryNotes(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer])
  // Cargar detalles del cliente cuando se expande el panel
  const loadCustomerDetailsOnExpand = useCallback(async () => {
    if (!selectedCustomer || selectedCustomer === 'new' || customerDetailsLoaded || loadingCustomerDetails) return
    
    setLoadingCustomerDetails(true)
    try {
      await Promise.allSettled([
        fetchCustomerDetails(selectedCustomer),
        fetchCustomerAddresses(selectedCustomer)
      ])
      setCustomerDetailsLoaded(true)
    } catch (error) {
      console.error('Error loading customer details:', error)
    } finally {
      setLoadingCustomerDetails(false)
    }
  }, [selectedCustomer, customerDetailsLoaded, loadingCustomerDetails])
  // Cuando se expande el panel de detalles, cargar los datos si no están cargados
  useEffect(() => {
    if (isCustomerDetailsPanelExpanded && selectedCustomer && selectedCustomer !== 'new' && !customerDetailsLoaded) {
      loadCustomerDetailsOnExpand()
    }
  }, [isCustomerDetailsPanelExpanded, selectedCustomer, customerDetailsLoaded, loadCustomerDetailsOnExpand])
  useEffect(() => {
    if (invoiceTab !== 'quotations' || !selectedCustomer) {
      return
    }
    fetchCustomerQuotations(selectedCustomer, quotationsPagination.page || 1)
  }, [invoiceTab, selectedCustomer, fetchCustomerQuotations, quotationsPagination.page])
  useEffect(() => {
    resetBulkDeleteState()
  }, [selectedCustomer])
  useEffect(() => {
    setBulkDeleteState(prev => {
      if (!CUSTOMER_BULK_TABS.includes(invoiceTab)) {
        return prev.active ? { active: false, context: null, selected: new Set() } : prev
      }
      if (prev.active && prev.context !== invoiceTab) {
        return { active: true, context: invoiceTab, selected: new Set() }
      }
      return prev
    })
  }, [invoiceTab])
  // Refrescar facturas cuando cambie la pestaña
  useEffect(() => {
    if (showSubscriptionManager) return
    if (invoiceTab === 'remitos') return
    if (allCustomerInvoices.length > 0 || (invoiceTab === 'draft' && customerPayments.length > 0) || invoiceTab === 'unpaid') {
      filterInvoicesByTab(allCustomerInvoices, invoiceTab, customerPayments, pendingInvoices)
    }
  }, [invoiceTab, allCustomerInvoices, customerPayments, pendingInvoices, showSubscriptionManager])
  // Actualizar contadores cuando cambien facturas o pagos
  useEffect(() => {
    if (showSubscriptionManager) return
    updateInvoiceCounts(allCustomerInvoices, customerPayments)
    setUnpaidInvoicesCount(pendingInvoices.length)
  }, [allCustomerInvoices, customerPayments, pendingInvoices, showSubscriptionManager])
  // useEffect para manejar cambios en la búsqueda con debounce
  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout)
    }
    const timeout = setTimeout(() => {
      if (customerListTab === 'subscriptions') {
        setSubscriptionPage(1)
        fetchSubscriptionCustomers(1)
      } else {
        setCurrentPage(1) // Reset a página 1 cuando cambia la búsqueda
        fetchCustomers()
      }
    }, 500) // 500ms de debounce
    setSearchTimeout(timeout)
    return () => clearTimeout(timeout)
  }, [customerSearch, customerListTab, fetchSubscriptionCustomers])
  // useEffect para manejar cambios en la página
  useEffect(() => {
    if (customerListTab !== 'customers') return
    if (currentPage > 1) {
      fetchCustomers()
    }
  }, [currentPage, customerListTab])
  useEffect(() => {
    if (customerListTab !== 'subscriptions') return
    // call the stable fetch function with current page
    fetchSubscriptionCustomers(subscriptionPage)
  }, [customerListTab, subscriptionPage])
  // Cleanup del timeout al desmontar el componente
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout)
      }
    }
  }, [searchTimeout])
  // Funcion para cargar datos necesarios para editar clientes
  const fetchEditData = async () => {
    const loaders = []
    if (!activeCompanyDetails && activeCompany) {
      loaders.push(fetchActiveCompanyDetails(activeCompany))
    }
    if (availableAssetAccounts.length === 0 || availableIncomeAccounts.length === 0) {
      loaders.push(fetchAvailableAccounts())
    }
    if (paymentTermsTemplates.length === 0) {
      loaders.push(fetchPaymentTermsTemplates())
    }
    if (taxTemplates.length === 0) {
      loaders.push(refreshTaxTemplates())
    }
    if (customerGroups.length === 0) {
      loaders.push(fetchCustomerGroups())
    }
    if (availablePriceLists.length === 0) {
      loaders.push(fetchPriceLists())
    }
    if (loaders.length > 0) {
      await Promise.all(loaders)
    }
  }
  // Estado para controlar si los saldos están cargados
  const [balancesLoaded, setBalancesLoaded] = useState(false)
  const [loadingBalances, setLoadingBalances] = useState(false)
  const fetchCustomers = async () => {
    try {
      setLoading(true)
      setBalancesLoaded(false) // Reset balances state on new fetch
      
      // Solo obtener nombres de clientes paginados (sin saldos para carga rápida)
      const namesResponse = await fetchWithAuth(`${API_ROUTES.customers}/names?page=${currentPage}&limit=${pageSize}&search=${encodeURIComponent(customerSearch)}`)
      if (!namesResponse.ok) {
        throw new Error('Error al obtener nombres de clientes')
      }
      
      const namesData = await namesResponse.json()
      if (!namesData.success) {
        throw new Error(namesData.message || 'Error al obtener nombres de clientes')
      }
      
      const customerNames = namesData.data || []
      setTotalCustomers(namesData.pagination?.total || 0)
      
      if (customerNames.length === 0) {
        setCustomers([])
        return
      }
      
      // Inicializar clientes sin saldos (se cargarán a demanda)
      const customersWithoutBalances = customerNames.map(customer => ({
        ...customer,
        outstanding_amount: null // null indica que no se ha cargado
      }))
      
      setCustomers(customersWithoutBalances)
    } catch (error) {
      console.error('Error fetching customers:', error)
      setCustomers([])
    } finally {
      setLoading(false)
    }
  }
  // Función para cargar saldos de los clientes visibles en la página actual
  const fetchCustomerBalances = async () => {
    if (customers.length === 0 || loadingBalances) return
    
    try {
      setLoadingBalances(true)
      const customerNamesList = customers.map(c => c.name)
      
      const balancesResponse = await fetchWithAuth(`${API_ROUTES.customers}/balances`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ customer_names: customerNamesList })
      })
      
      if (balancesResponse.ok) {
        const balancesData = await balancesResponse.json()
        if (balancesData.success) {
          const balances = balancesData.data || {}
          // Actualizar clientes con los saldos obtenidos
          setCustomers(prevCustomers => 
            prevCustomers.map(customer => ({
              ...customer,
              outstanding_amount: balances[customer.name] ?? 0
            }))
          )
          setBalancesLoaded(true)
        }
      }
    } catch (error) {
      console.error('Error fetching customer balances:', error)
    } finally {
      setLoadingBalances(false)
    }
  }
    const fetchAvailableAccounts = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.accounts)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Filtrar cuentas por cobrar (account_type = "Receivable")
          const receivableAccounts = data.data.filter(account => (
            account.account_type === 'Receivable' &&
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          ))
          setAvailableAssetAccounts(receivableAccounts || [])
          
          // Filtrar cuentas de ingresos (para cuentas de ingresos)
          const incomeAccounts = data.data.filter(account => (
            account.root_type === 'Income' &&
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          ))
          setAvailableIncomeAccounts(incomeAccounts || [])
        }
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
  }
  const fetchPaymentTermsTemplates = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.paymentTermsTemplates)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setPaymentTermsTemplates(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching payment terms templates:', error)
    }
  }
  // Tax templates handled by `useTaxTemplates` hook above.
  const fetchActiveCompanyDetails = async (companyName) => {
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
  const fetchCustomerGroups = async () => {
    setLoadingCustomerGroups(true)
    try {
      const requestGroups = async () => {
        const response = await fetchWithAuth(API_ROUTES.customerGroups)
        console.log('Respuesta de customer groups:', response.status)
        if (!response.ok) {
          console.error('Error HTTP cargando customer groups:', response.status)
          return []
        }
        const data = await response.json()
        console.log('Datos de customer groups:', data)
        if (!data.success) {
          console.error('Error en datos de customer groups:', data.message)
          return []
        }
        return data.data || []
      }
      let groups = await requestGroups()
      if (groups.length === 0) {
        console.log('No hay grupos, creando grupos por defecto...')
        await createDefaultCustomerGroups()
        groups = await requestGroups()
      }
      // Normalize groups: expose a display_name with company abbr removed (if present)
      const abbr = activeCompanyDetails?.abbr || ''
      const normalizeDisplay = (g) => {
        const raw = g.customer_group_name || g.name || ''
        if (!raw) return { ...g, display_name: '' }
        if (!abbr) return { ...g, display_name: raw }
        // Remove trailing " - ABBR" if present (common pattern used in this project)
        const suffix = ` - ${abbr}`
        if (raw.endsWith(suffix)) return { ...g, display_name: raw.slice(0, -suffix.length).trim() }
        // Also try removing other common patterns like ' -ANC' (no space)
        const suffixNoSpace = `-${abbr}`
        if (raw.endsWith(suffixNoSpace)) return { ...g, display_name: raw.slice(0, -suffixNoSpace.length).trim() }
        return { ...g, display_name: raw }
      }
      groups = groups.map(normalizeDisplay)
      setCustomerGroups(groups)
      console.log('Grupos de clientes cargados:', groups.length)
      return groups
    } catch (error) {
      console.error('Error fetching customer groups:', error)
      return []
    } finally {
      setLoadingCustomerGroups(false)
    }
  }
  const fetchPriceLists = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.salesPriceLists)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAvailablePriceLists(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching price lists:', error)
    }
  }
  const fetchCustomerGroupDetails = async (groupName) => {
    try {
      const response = await fetchWithAuth(`/api/resource/Customer%20Group/${encodeURIComponent(groupName)}`)
      if (response.ok) {
        const result = await response.json()
        return result.data
      }
    } catch (error) {
      console.error('Error fetching customer group details:', error)
    }
    return null
  }
  const createDefaultCustomerGroups = async () => {
    try {
      console.log('Creando grupo padre All Customer Groups...')
      const parentResponse = await fetchWithAuth(API_ROUTES.customerGroups, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            customer_group_name: 'All Customer Groups',
            is_group: 1
          }
        })
      })
      
      if (parentResponse.ok) {
        console.log('Grupo padre creado, creando grupo hijo...')
        const childResponse = await fetchWithAuth(API_ROUTES.customerGroups, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: {
              customer_group_name: 'Clientes Generales',
              parent_customer_group: 'All Customer Groups',
              is_group: 0
            }
          })
        })
        
        if (childResponse.ok) {
          console.log('Grupos por defecto creados correctamente')
        }
      }
    } catch (error) {
      console.error('Error creando grupos por defecto:', error)
    }
  }
  const getDefaultCustomerParent = (groupsList) => {
    if (!groupsList || groupsList.length === 0) return ''
    const parentGroup = groupsList.find(group => group.is_group === 1)
    return parentGroup?.name || groupsList[0]?.name || ''
  }
  const prepareCustomerGroupModal = async () => {
    console.log('Preparando modal de grupos de clientes')
    setEditingCustomerGroup(null)
    setCustomerGroupFormData({
      name: '',
      parent_group: getDefaultCustomerParent(customerGroups),
      default_price_list: '',
      account: '',
      payment_terms: '',
      is_group: 0
    })

    try {
      const groups = customerGroups.length > 0 ? customerGroups : await fetchCustomerGroups()
      console.log('Total de grupos disponibles para el modal:', groups.length)
      const loaders = []
      if (availablePriceLists.length === 0) {
        console.log('Cargando listas de precios para el modal de grupos de clientes...')
        loaders.push(fetchPriceLists())
      }
      if (paymentTermsTemplates.length === 0) {
        console.log('Cargando plantillas de condiciones de pago para el modal de grupos de clientes...')
        loaders.push(fetchPaymentTermsTemplates())
      }
      if (availableIncomeAccounts.length === 0) {
        console.log('Cargando cuentas de ingresos para el modal de grupos de clientes...')
        loaders.push(fetchAvailableAccounts())
      }
      await Promise.all(loaders)

      const defaultParent = getDefaultCustomerParent(groups)
      console.log('Grupo padre por defecto para el modal:', defaultParent)
      setCustomerGroupFormData((prev) => ({
        ...prev,
        parent_group: defaultParent,
        default_price_list: '',
        account: '',
        payment_terms: '',
        is_group: 0
      }))
    } catch (error) {
      console.error('Error preparando el modal de grupos de clientes:', error)
      showNotification('No se pudo preparar el formulario de grupos de clientes', 'error')
      throw error
    }
  }

  const handleOpenCustomerGroupModal = async () => {
    console.log('Abriendo modal de grupos de clientes desde CustomerPanel')
    try {
      await prepareCustomerGroupModal()
      setShowCustomerGroupModal(true)
    } catch (error) {
      console.error('No se pudo abrir el modal de grupos de clientes:', error)
    }
  }

  // Funcion para abrir modal de prueba
  const handleOpenTestModal = async () => {
    console.log('Abriendo modal de prueba para grupos de clientes')
    try {
      await prepareCustomerGroupModal()
      setShowTestModal(true)
    } catch (error) {
      console.error('No se pudo abrir el modal de prueba:', error)
    }
  }

  const handleCloseCustomerGroupModal = () => {
    setShowCustomerGroupModal(false)
    setShowTestModal(false)
    setCustomerGroupFormData({
      name: '',
      parent_group: getDefaultCustomerParent(customerGroups),
      default_price_list: '',
      account: '',
      payment_terms: '',
      is_group: 0
    })
  }

  const handleSaveCustomerGroup = async () => {
    if (!customerGroupFormData.name.trim()) {
      showNotification('El nombre del grupo es obligatorio', 'error')
      return
    }
    setSavingCustomerGroup(true)
    try {
      const url = editingCustomerGroup
        ? `/api/resource/Customer Group/${encodeURIComponent(editingCustomerGroup.name)}`
        : '/api/resource/Customer Group'
      const method = editingCustomerGroup ? 'PUT' : 'POST'
      const payload = {
        customer_group_name: customerGroupFormData.name,
        parent_customer_group: customerGroupFormData.is_group === 1 ? null : (customerGroupFormData.parent_group || null),
        default_price_list: customerGroupFormData.default_price_list || null,
        payment_terms: customerGroupFormData.payment_terms || null,
        is_group: customerGroupFormData.is_group || 0,
        accounts: customerGroupFormData.account
          ? [{
              account: customerGroupFormData.account,
              company: activeCompanyDetails?.name,
              parent: editingCustomerGroup ? editingCustomerGroup.name : customerGroupFormData.name,
              parentfield: 'accounts',
              parenttype: 'Customer Group',
              doctype: 'Party Account'
            }]
          : []
      }
      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify({ data: payload })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data.success) {
        showNotification(
          editingCustomerGroup ? 'Grupo actualizado exitosamente' : 'Grupo creado exitosamente',
          'success'
        )
        await fetchCustomerGroups()
        if (!editingCustomerGroup) {
          setEditedCustomerData(prev => ({
            ...prev,
            customer_group: customerGroupFormData.name || prev.customer_group
          }))
        }
        handleCloseCustomerGroupModal()
      } else {
        showNotification(data.message || 'Error al guardar grupo', 'error')
      }
    } catch (error) {
      console.error('Error guardando grupo de clientes:', error)
      showNotification('Error al guardar grupo', 'error')
    } finally {
      setSavingCustomerGroup(false)
    }
  }
  const fetchCustomerDetails = async (customerName) => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.customers}/${encodeURIComponent(customerName)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          console.log('Customer details received:', data.data) // Debug log
          console.log('porcentaje_iva value:', data.data.porcentaje_iva) // Debug log
          setCustomerDetails(data.data)
        }
      }
    } catch (error) {
      console.error('Error fetching customer details:', error)
    }
  }
  const handleCancelSubscription = async (subscriptionName) => {
    if (!subscriptionName) return
    const confirmed = await confirm({
      title: 'Cancelar suscripcion',
      message: `Vas a cancelar ${subscriptionName}. Continuar?`,
      type: 'danger',
      confirmText: 'Cancelar'
    })
    if (!confirmed) return
    setSubscriptionMutations(prev => ({ ...prev, [subscriptionName]: 'cancelling' }))
    try {
      const response = await fetchWithAuth(API_ROUTES.subscriptionByName(subscriptionName), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Cancelled' })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'No pudimos cancelar la suscripcion')
      }
      showNotification && showNotification(payload.message || 'Suscripcion cancelada', 'success')
      await fetchCustomerSubscriptions(selectedCustomer)
      if (customerListTab === 'subscriptions') {
        await fetchSubscriptionCustomers(subscriptionPage)
      }
    } catch (error) {
      console.error('Error cancelling subscription:', error)
      showNotification && showNotification(error.message || 'Error al cancelar suscripcion', 'error')
    } finally {
      setSubscriptionMutations(prev => {
        const next = { ...prev }
        delete next[subscriptionName]
        return next
      })
    }
  }
  const fetchCustomerInvoices = async (customerName) => {
    try {
      // Obtener todas las facturas del cliente (últimas 20)
      const response = await fetchWithAuth(`${API_ROUTES.customerInvoices}?customer=${encodeURIComponent(customerName)}&status=all&limit=20`)
      if (response.ok) {
        const data = await response.json()
        console.log('📥 BACKEND RESPONSE - fetchCustomerInvoices:', data)
        if (data.success) {
          const invoices = (data.data || []).map(invoice => ({
            ...invoice,
            relacion: invoice.return_against || null,
            erpnext_name: invoice.name
          }))
          console.log('📥 INVOICES PROCESADAS (primeras 3):', invoices.slice(0, 3).map(inv => ({
            name: inv.name,
            remarks: inv.remarks,
            description: inv.description,
            voucher_description: inv.voucher_description
          })))
          setAllCustomerInvoices(invoices)
          updateInvoiceCounts(invoices, customerPayments)
          filterInvoicesByTab(invoices, invoiceTab, customerPayments, pendingInvoices)
        }
      }
    } catch (error) {
      console.error('Error fetching customer invoices:', error)
    }
  }
  const fetchCustomerStatements = async (customerName, page = 1, append = false) => {
    try {
      // Prevent duplicate identical requests in short succession
      const last = lastFetchedStatementsRef.current || {}
      const now = Date.now()
      if (last.customer === customerName && last.page === page) {
        // If a request is already in-flight for the same params, skip
        if (last.inFlight) return
        // If the last fetch for same params happened very recently, skip to avoid tight loops
        if (now - (last.timestamp || 0) < 1500) return
      }
      lastFetchedStatementsRef.current = { customer: customerName, page, inFlight: true, timestamp: now }
      setLoadingMoreStatements(true)
      // Obtener movimientos de cuenta corriente del cliente con paginación
      const response = await fetchWithAuth(`${API_ROUTES.customerStatements}?customer=${encodeURIComponent(customerName)}&page=${page}&limit=${statementsPageSize}`)
      if (response.ok) {
        const data = await response.json()
        console.log('📥 BACKEND RESPONSE - fetchCustomerStatements:', data)
        if (data.success) {
          const newStatements = data.data || []
          console.log('📥 STATEMENTS (primeros 3):', newStatements.slice(0, 3).map(stmt => ({
            name: stmt.name || stmt.voucher_no,
            remarks: stmt.remarks,
            description: stmt.description,
            voucher_description: stmt.voucher_description
          })))
          if (append) {
            setCustomerStatements(prev => [...prev, ...newStatements])
          } else {
            setCustomerStatements(newStatements)
            setStatementTablePage(1)
          }
          // Verificar si hay más páginas disponibles
          setHasMoreStatements(data.pagination?.has_more || false)
          setStatementsPage(page)

          
          const pendingInvoicesData = (data.pending_invoices || []).map(doc => ({
            ...doc,
            erpnext_name: doc.name,
            itemType: doc.doctype === 'Payment Entry' ? 'payment' : 'invoice'
          }))

          console.log('📥 PENDING INVOICES (primeras 3):', pendingInvoicesData.slice(0, 3).map(inv => ({
            name: inv.name,
            remarks: inv.remarks,
            description: inv.description,
            voucher_description: inv.voucher_description
          })))
          console.log('📥 CONCILIATIONS (primeras 2):', (data.conciliations || []).slice(0, 2).map(conc => ({
            conciliation_id: conc.conciliation_id,
            documents: (conc.documents || []).map(doc => ({
              name: doc.name || doc.voucher_no,
              remarks: doc.remarks,
              description: doc.description,
              voucher_description: doc.voucher_description
            }))
          })))
          setPendingInvoices(pendingInvoicesData)
          setCustomerConciliations(data.conciliations || [])
        }
      }
    } catch (error) {
      console.error('Error fetching customer statements:', error)
    } finally {
      // mark as finished
      try {
        if (lastFetchedStatementsRef.current) {
          lastFetchedStatementsRef.current.inFlight = false
          lastFetchedStatementsRef.current.timestamp = Date.now()
        }
      } catch (e) {}
      setLoadingMoreStatements(false)
    }
  }
  const loadMoreStatements = async () => {
    if (selectedCustomer && hasMoreStatements && !loadingMoreStatements) {
      await fetchCustomerStatements(selectedCustomer, statementsPage + 1, true)
    }
  }
  const fetchCustomerPayments = async (customerName) => {
    try {
      // Obtener todos los pagos del cliente
      const response = await fetchWithAuth(`${API_ROUTES.customerPayments}?customer=${encodeURIComponent(customerName)}&status=all&limit=1000`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setCustomerPayments(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching customer payments:', error)
    }
  }
  const fetchCustomerDeliveryNotes = async (customerName, page = 1) => {
    try {
      setIsLoadingDeliveryNotes(true)
      const pageSize = deliveryNotesPagination.pageSize || 20
      const response = await fetchWithAuth(API_ROUTES.customerDeliveryNotes(customerName, page, pageSize))
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setCustomerDeliveryNotes(data.delivery_notes || [])
          setDeliveryNotesPagination({
            page: data.page || page,
            pageSize: data.page_size || pageSize,
            total: data.total_count || 0
          })
        } else {
          showNotification(data.message || 'Error al cargar remitos de venta', 'error')
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'Error al cargar remitos de venta', 'error')
      }
    } catch (error) {
      console.error('Error fetching customer delivery notes:', error)
      showNotification('Error al cargar remitos de venta', 'error')
  } finally {
    setIsLoadingDeliveryNotes(false)
  }
}
  const handleSalesRemitoPageChange = async (newPage) => {
    if (newPage < 1) return
    const totalPages = Math.max(1, Math.ceil((deliveryNotesPagination.total || 0) / (deliveryNotesPagination.pageSize || 20)))
    if (newPage > totalPages) return
    setDeliveryNotesPagination(prev => ({ ...prev, page: newPage }))
    if (selectedCustomer) {
      await fetchCustomerDeliveryNotes(selectedCustomer, newPage)
    }
  }
  const handleSalesQuotationPageChange = async (newPage) => {
    if (newPage < 1) return
    const pageSize = quotationsPagination.pageSize || SALES_QUOTATIONS_PAGE_SIZE
    const totalPages = Math.max(1, Math.ceil((quotationsPagination.total || 0) / pageSize))
    if (newPage > totalPages) return
    setQuotationsPagination(prev => ({ ...prev, page: newPage }))
    if (selectedCustomer) {
      await fetchCustomerQuotations(selectedCustomer, newPage)
    }
  }
  useEffect(() => {
    const handler = (e) => {
      const detail = e && e.detail ? e.detail : e
      const customerName = detail.customerName || detail.customer || detail.customer_name
      const orderName = detail.orderName || detail.order || detail.sales_order_name
      if (!customerName) return
      try {
        setSelectedCustomer(customerName)
        setIsCustomerDetailsPanelExpanded(true)
        if (orderName) {
          setTimeout(() => {
            handleOpenSalesOrder(orderName)
          }, 300)
        }
      } catch (err) {
        console.error('Error handling openCustomerWithOrder event:', err)
      }
    }
    window.addEventListener('openCustomerWithOrder', handler)
    return () => window.removeEventListener('openCustomerWithOrder', handler)
  }, [handleOpenSalesOrder, setIsCustomerDetailsPanelExpanded, setSelectedCustomer])
  const handleOpenSalesQuotation = async (quotationName) => {
    try {
      setInvoiceTab('quotations')
      const response = await fetchWithAuth(API_ROUTES.salesQuotationByName(quotationName))
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'No se pudo cargar el presupuesto')
      }
      setEditingSalesQuotation(payload.data)
      setIsSalesQuotationModalOpen(true)
    } catch (error) {
      console.error('Error opening sales quotation:', error)
      showNotification(error.message || 'Error al abrir presupuesto', 'error')
    }
  }
  const handleNewSalesQuotation = () => {
    if (!selectedCustomer) {
      showNotification('Seleccion\u00e1 un cliente antes de crear el presupuesto', 'warning')
      return
    }
    setInvoiceTab('quotations')
    setEditingSalesQuotation(null)
    setIsSalesQuotationModalOpen(true)
  }
  const handleSaveSalesQuotation = async (quotationData, options = {}) => {
    const isEditing = options.isEditing ?? Boolean(quotationData?.name)
    const targetName = quotationData?.name || editingSalesQuotation?.name || null
    const payload = {
      ...quotationData,
      name: targetName || undefined
    }
    const endpoint = isEditing && targetName
      ? API_ROUTES.salesQuotationByName(targetName)
      : API_ROUTES.salesQuotations
    const method = isEditing && targetName ? 'PUT' : 'POST'
    try {
      const response = await fetchWithAuth(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sales_quotation: payload })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Error al guardar el presupuesto')
      }
      showNotification(
        payload.docstatus === 1 ? 'Presupuesto emitido' : (isEditing ? 'Presupuesto actualizado' : 'Presupuesto creado'),
        'success'
      )
      setIsSalesQuotationModalOpen(false)
      setEditingSalesQuotation(null)
      if (selectedCustomer) {
        const targetPage = isEditing ? (quotationsPagination.page || 1) : 1
        await fetchCustomerQuotations(selectedCustomer, targetPage)
      }
      return { success: true, data: data.data }
    } catch (error) {
      console.error('Error saving sales quotation:', error)
      showNotification(error.message || 'No se pudo guardar el presupuesto', 'error')
      return { success: false }
    }
  }
  const openSalesRemitoForEdit = async (remitoName) => {
    try {
      const payload = await prepareSalesRemitoModalPayload(remitoName, fetchWithAuth)
      setSalesRemitoDraftData(payload)
      setSelectedSalesRemito(payload.name)
      setIsSalesRemitoModalOpen(true)
    } catch (error) {
      console.error('Error opening sales remito for edit:', error)
      showNotification(error.message || 'Error al cargar remito', 'error')
      setSelectedSalesRemito(null)
    }
  }
  const handleOpenSalesRemitoCreation = () => {
    if (!selectedCustomer || selectedCustomer === 'new') {
      showNotification('Selecciona un cliente antes de crear un remito', 'warning')
      return
    }
    if (!hasActiveSalesRemitoTalonario) {
      showNotification(salesRemitoDisabledMessage, 'warning')
      fetchCompanyTalonarios()
      return
    }
    setSelectedSalesRemito(null)
    setSalesRemitoDraftData(null)
    setIsSalesRemitoModalOpen(true)
  }
  const handleOpenNewInvoice = async () => {
    // Cargar talonarios si no están cargados
    console.log('🎯 [CustomerPanel] handleOpenNewInvoice - Estado actual de talonarios:', companyTalonarios.length)
    if (companyTalonarios.length === 0) {
      console.log('⏳ [CustomerPanel] Cargando talonarios...')
      const fetchedTalonarios = await fetchCompanyTalonarios()
      console.log('✅ [CustomerPanel] Talonarios cargados (retornados):', fetchedTalonarios?.length || 0)
      // Esperar a que React actualice el estado antes de abrir el modal
      await new Promise(resolve => setTimeout(resolve, 0))
    } else {
      console.log('✅ [CustomerPanel] Talonarios ya estaban en caché:', companyTalonarios.length)
    }
    setEditingInvoice(null)
    setLinkedInvoiceDraft(null)
    console.log('📂 [CustomerPanel] Abriendo modal. Estado actual de talonarios:', companyTalonarios.length)
    setIsInvoiceModalOpen(true)
  }
  const handleOpenNewPayment = async () => {
    // Cargar talonarios y cuentas bancarias si no están cargados
    const loaders = []
    if (companyTalonarios.length === 0) {
      loaders.push(fetchCompanyTalonarios())
    }
    if (companyBankAccounts.length === 0) {
      loaders.push(fetchCompanyBankAccounts())
    }
    if (loaders.length > 0) {
      await Promise.all(loaders)
    }
    setEditingPayment(null)
    setIsPaymentModalOpen(true)
  }
  const filterInvoicesByTab = (invoices, tab, payments = [], pendingInvoices = []) => {
    let filtered = []
    switch (tab) {
      case 'unpaid':
        filtered = pendingInvoices
        break
      case 'paid':
        filtered = invoices.filter(invoice => invoice.outstanding_amount === 0 && invoice.docstatus === 1 && !invoice.return_against)
        break
      case 'draft':
        const draftInvoices = invoices.filter(invoice => invoice.docstatus === 0)
        const draftPayments = payments.filter(payment => payment.docstatus === 0)
        console.log('[CustomerPanel] filterInvoicesByTab - draft:', { draftInvoices: draftInvoices.map(inv => ({ name: inv.name, docstatus: inv.docstatus })), draftPayments: draftPayments.length })
        // Combinar y marcar el tipo
        filtered = [
          ...draftInvoices.map(item => ({ ...item, itemType: 'invoice' })),
          ...draftPayments.map(item => ({ ...item, itemType: 'payment' }))
        ]
        break
      case 'all':
        filtered = invoices.filter(invoice => invoice.docstatus === 1 && !invoice.return_against)
        break
      default:
        filtered = invoices
    }
    setCustomerInvoices(filtered)
    setInvoiceTablePage(1)
  }
  const filterCustomers = (customers, searchTerm) => {
    // La búsqueda ahora se hace en el backend, así que devolvemos todos los customers
    return customers
  }
  const updateInvoiceCounts = (invoices, payments = []) => {
    const unpaid = invoices.filter(invoice => Math.abs(invoice.outstanding_amount) > 0.01 && invoice.docstatus === 1 && !invoice.return_against).length
    const draftInvoices = invoices.filter(invoice => invoice.docstatus === 0).length
    const draftPayments = payments.filter(payment => payment.docstatus === 0).length
    const draft = draftInvoices + draftPayments
    setUnpaidInvoicesCount(unpaid)
    setDraftInvoicesCount(draft)
  }
  const fetchCustomerAddresses = async (customerName) => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.customerAddresses}${encodeURIComponent(customerName)}/addresses`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setCustomerAddresses(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching customer addresses:', error)
    }
  }
  const handleSearchAfip = async (cuit) => {
    if (!cuit || !cuit.trim()) {
      showNotification('Por favor ingrese un CUIT', 'error')
      return
    }
    // Limpiar el CUIT y validar
    const cleanCuit = cuit.replace(/[-\s]/g, '')
    if (!validateCuit(cleanCuit)) {
      showNotification('El CUIT ingresado no es válido', 'error')
      return
    }
    setConsultingAfip(true)
    try {
      const result = await getAfipData(cleanCuit, fetchWithAuth)
      if (result.success) {
        const afipData = result.data
        // Parsear la dirección completa para separar componentes
        let parsedAddress = ''
        let parsedCity = afipData.localidad || '' // Usar directamente la localidad de AFIP
        let parsedPostalCode = afipData.codigo_postal || ''
        let parsedProvince = afipData.provincia || ''
        if (afipData.address) {
          // La dirección viene como: "DIRECCIÓN, LOCALIDAD, PROVINCIA, CP: CODIGO_POSTAL"
          const addressParts = afipData.address.split(', ')
          if (addressParts.length >= 1) {
            parsedAddress = addressParts[0].trim() // Primera parte es la dirección
          }
          // Si no tenemos localidad específica, intentar extraerla de la dirección
          if (!parsedCity && addressParts.length >= 2) {
            // Buscar si hay CP: en alguna parte
            const cpIndex = addressParts.findIndex(part => part.includes('CP:'))
            if (cpIndex !== -1) {
              // Extraer código postal si no lo tenemos
              if (!parsedPostalCode) {
                const cpPart = addressParts[cpIndex]
                const cpMatch = cpPart.match(/CP:\s*(\d+)/)
                if (cpMatch) {
                  parsedPostalCode = cpMatch[1]
                }
              }
              // La ciudad es la parte inmediatamente antes del CP
              if (cpIndex > 1) {
                parsedCity = addressParts[cpIndex - 1].trim()
              }
            } else if (addressParts.length >= 2) {
              // No hay CP, la segunda parte podría ser ciudad o ciudad,provincia
              const secondPart = addressParts[1].trim()
              // Si contiene coma, tomar solo la primera parte como ciudad
              parsedCity = secondPart.split(',')[0].trim()
            }
          }
          // Extraer código postal si no lo tenemos
          if (!parsedPostalCode) {
            const cpPart = addressParts.find(part => part.includes('CP:'))
            if (cpPart) {
              const cpMatch = cpPart.match(/CP:\s*(\d+)/)
              if (cpMatch) {
                parsedPostalCode = cpMatch[1]
              }
            }
          }
        }
        // Llenar automáticamente los campos con los datos de AFIP
        const updatedData = {
          ...editedCustomerData,
          customer_name: afipData.business_name || afipData.name,
          tax_id: cleanCuit,
          custom_condicion_iva: afipData.tax_condition,
          address: parsedAddress,
          ciudad: parsedCity,
          codigo_postal: parsedPostalCode,
          provincia: parsedProvince,
          custom_personeria: afipData.personeria || '',
          custom_pais: afipData.pais || ''
        }
        setEditedCustomerData(updatedData)
        showNotification('Datos de AFIP cargados exitosamente', 'success')
      } else {
        showNotification(result.error, 'error')
      }
    } catch (error) {
      console.error('Error al consultar AFIP:', error)
      showNotification('Error al consultar AFIP', 'error')
    } finally {
      setConsultingAfip(false)
    }
  }
  const handleCreateInvoice = async (invoiceData) => {
    try {
      setLoading(true)
      let response
      if (invoiceData.isEditing) {
        // Si estamos editando, hacer PUT para actualizar
        response = await fetchWithAuth(`${API_ROUTES.invoices}/${invoiceData.data.name}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(invoiceData),
        })
      } else {
        // Si es nuevo, hacer POST para crear
        response = await fetchWithAuth(API_ROUTES.invoices, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(invoiceData),
        })
      }
      if (response.ok) {
        const responseData = await response.json()
        const successMessage = invoiceData.isEditing
          ? 'Factura actualizada exitosamente'
          : 'Factura creada exitosamente'
        showNotification(successMessage, 'success')
        
        // Si es una nota de crédito con asignaciones parciales, llamar al endpoint de conciliación
        const isCreditNote = invoiceData.data?.doctype_name === 'Nota de Crédito' || 
                            invoiceData.data?.doctype_name === 'NOTA DE CREDITO' ||
                            invoiceData.data?.is_return === 1
        
        const hasPartialAllocations = invoiceData.data?.selected_unpaid_invoices?.length > 0 &&
          invoiceData.data.selected_unpaid_invoices.some(inv => 
            inv.allocated_amount > 0 && 
            inv.allocated_amount < inv.outstanding_amount
          )
        
        if (!invoiceData.isEditing && isCreditNote && hasPartialAllocations) {
          console.log('Nota de crédito con asignaciones parciales detectada, llamando a reconciliación...')
          try {
            const allocations = invoiceData.data.selected_unpaid_invoices
              .filter(inv => inv.allocated_amount > 0)
              .map(inv => ({
                invoice: inv.name,
                amount: parseFloat(inv.allocated_amount)
              }))
            
            const reconcilePayload = {
              credit_note: responseData.data?.name || responseData.name, // Nombre de la NC recién creada
              customer: selectedCustomer,
              company: invoiceData.data.company,
              allocations: allocations
            }
            
            console.log('Payload de conciliación:', reconcilePayload)
            
            const reconcileResponse = await fetchWithAuth(API_ROUTES.reconcileCreditNote, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(reconcilePayload),
            })
            
            if (reconcileResponse.ok) {
              showNotification('Conciliación aplicada exitosamente', 'success')
            } else {
              const errorData = await reconcileResponse.json()
              console.error('Error en conciliación:', errorData)
              showNotification(`Advertencia: NC creada pero conciliación falló: ${errorData.message || 'Error desconocido'}`, 'warning')
            }
          } catch (reconcileError) {
            console.error('Error al intentar conciliar:', reconcileError)
            showNotification('Advertencia: NC creada pero conciliación falló', 'warning')
          }
        }
        
        setIsInvoiceModalOpen(false)
        setEditingInvoice(null)
        // Recargar facturas si hay un cliente seleccionado
        if (selectedCustomer) {
          fetchCustomerInvoices(selectedCustomer)
          fetchCustomerStatements(selectedCustomer)
        }
      } else {
        const errorData = await response.json()
        showNotification(`Error al ${invoiceData.isEditing ? 'actualizar' : 'crear'} factura: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error creating/updating invoice:', error)
      showNotification(`Error al ${invoiceData.isEditing ? 'actualizar' : 'crear'} factura`, 'error')
    } finally {
      setLoading(false)
    }
  }
  const handleEditCustomer = async () => {
    if (!selectedCustomer || selectedCustomer === 'new') return
    
    // Expandir el panel si no está expandido
    setIsCustomerDetailsPanelExpanded(true)
    
    // Obtener los detalles del cliente directamente (no depender del estado)
    let currentCustomerDetails = customerDetails
    
    // Si los detalles no están cargados, cargarlos primero
    if (!customerDetailsLoaded || !currentCustomerDetails) {
      setLoadingCustomerDetails(true)
      try {
        // Obtener detalles directamente y guardar en estado
        const detailsResponse = await fetchWithAuth(`${API_ROUTES.customers}/${encodeURIComponent(selectedCustomer)}`)
        if (detailsResponse.ok) {
          const detailsData = await detailsResponse.json()
          if (detailsData.success) {
            currentCustomerDetails = detailsData.data
            setCustomerDetails(currentCustomerDetails)
          }
        }
        await fetchCustomerAddresses(selectedCustomer)
        setCustomerDetailsLoaded(true)
      } catch (error) {
        console.error('Error loading customer details for edit:', error)
        setLoadingCustomerDetails(false)
        return
      }
      setLoadingCustomerDetails(false)
    }
    
    if (!currentCustomerDetails) {
      showNotification('Error al cargar los detalles del cliente', 'error')
      return
    }
    
    // Cargar datos necesarios para edición si no están cargados
    await fetchEditData()
    
    setIsEditingCustomer(true)
    
    // Obtener la dirección fiscal para cargar sus datos
    const fiscalAddress = getFiscalAddress()
    
    // Determinar el template de IVA correspondiente al porcentaje guardado
    let ivaTemplateName = currentCustomerDetails.custom_default_iva_ventas || ''
    console.log('Initial ivaTemplateName from customerDetails:', ivaTemplateName) // Debug log
    console.log('customerDetails.porcentaje_iva:', currentCustomerDetails.porcentaje_iva) // Debug log
    if (currentCustomerDetails.porcentaje_iva && !ivaTemplateName) {
      // Buscar el template que corresponde al porcentaje
      console.log('Searching for template matching porcentaje_iva:', currentCustomerDetails.porcentaje_iva) // Debug log
      console.log('Available taxTemplates:', taxTemplates) // Debug log
      const currentIvaRate = parseFloat(currentCustomerDetails.porcentaje_iva)
      const matchingTemplate = taxTemplates.find(template => 
        templateMatchesType(template, TEMPLATE_TYPES.SALES) &&
        template.iva_rates && template.iva_rates.includes(currentIvaRate)
      )
      console.log('Matching template found:', matchingTemplate) // Debug log
      if (matchingTemplate) {
        ivaTemplateName = matchingTemplate.name
        console.log('Updated ivaTemplateName to:', ivaTemplateName) // Debug log
      }
    }
    
    // Construir datos iniciales del cliente
    // Normalize the stored customer_group value to match available groups.
    // The ERPNext value may be the canonical customer_group_name or a display label.
    let normalizedGroup = currentCustomerDetails.customer_group || ''
    if (normalizedGroup && customerGroups && customerGroups.length > 0) {
      const found = customerGroups.find(g => (
        (g.customer_group_name || '').toString() === normalizedGroup.toString()
        || (g.name || '').toString() === normalizedGroup.toString()
        || (g.display_name || '').toString() === normalizedGroup.toString()
      ))
      if (found) normalizedGroup = found.customer_group_name || found.name || normalizedGroup
    }
    const initialData = {
      customer_name: currentCustomerDetails.customer_name || currentCustomerDetails.name,
      customer_details: currentCustomerDetails.customer_details || '', // Nombre comercial
      customer_group: normalizedGroup || '',
      website: currentCustomerDetails.website || '',
      email: currentCustomerDetails.email || '',
      phone: currentCustomerDetails.phone || '',
      address: fiscalAddress?.address_line1 || currentCustomerDetails.address || '',
      contacto: currentCustomerDetails.contacto || '',
      default_receivable_account: currentCustomerDetails.default_receivable_account || '',
      default_income_account: currentCustomerDetails.default_income_account || '',
      // Campos que van en General
      fecha_alta: currentCustomerDetails.creation ? new Date(currentCustomerDetails.creation).toISOString().split('T')[0] : '',
      ciudad: fiscalAddress?.city || currentCustomerDetails.ciudad || '',
      codigo_postal: fiscalAddress?.pincode || currentCustomerDetails.codigo_postal || '',
      provincia: fiscalAddress?.state || currentCustomerDetails.provincia || '',
      pais: fiscalAddress?.country || currentCustomerDetails.pais || 'Argentina',
      tax_id: currentCustomerDetails.tax_id || '', // CUIT
      custom_condicion_iva: currentCustomerDetails.custom_condicion_iva || '', // Condición frente al IVA
      custom_default_iva_ventas: ivaTemplateName, // IVA por defecto para ventas
      // Campos que van en Información Fiscal
      condicion_venta: currentCustomerDetails.condicion_venta || '',
      porcentaje_descuento: currentCustomerDetails.porcentaje_descuento || '',
      porcentaje_iva: currentCustomerDetails.porcentaje_iva || '',
      price_list: currentCustomerDetails.price_list || '',
      payment_terms: currentCustomerDetails.payment_terms || '',
      transportista: currentCustomerDetails.transportista || ''
    }
    // Completar con valores del grupo si faltan
    if (currentCustomerDetails.customer_group) {
      const groupDetails = await fetchCustomerGroupDetails(currentCustomerDetails.customer_group)
      if (groupDetails) {
        if (!initialData.price_list && groupDetails.default_price_list) {
          initialData.price_list = groupDetails.default_price_list
        }
        if (!initialData.payment_terms && groupDetails.payment_terms) {
          initialData.payment_terms = groupDetails.payment_terms
        }
        if (groupDetails.accounts && groupDetails.accounts.length > 0) {
          console.log('DEBUG: groupDetails.accounts:', groupDetails.accounts)
          const incomeAccount = groupDetails.accounts.find(acc => acc.account)
          console.log('DEBUG: incomeAccount encontrado:', incomeAccount)
          if (incomeAccount) {
            console.log('DEBUG: incomeAccount.account:', incomeAccount.account)
            console.log('DEBUG: availableIncomeAccounts:', availableIncomeAccounts.map(acc => ({ name: acc.name, account_name: acc.account_name })))
            // Buscar la cuenta correspondiente en availableIncomeAccounts por account_name
            const matchingAccount = availableIncomeAccounts.find(acc => acc.account_name === incomeAccount.account)
            console.log('DEBUG: matchingAccount encontrado:', matchingAccount)
            if (matchingAccount) {
              console.log('DEBUG: Asignando default_income_account:', matchingAccount.name)
              initialData.default_income_account = matchingAccount.name
            } else {
              console.log('DEBUG: No se encontró matchingAccount para:', incomeAccount.account)
            }
          }
        }
      }
    }
    
    setEditedCustomerData(initialData)
  }
  const handleCancelEdit = () => {
    setIsEditingCustomer(false)
    setEditedCustomerData({})
    // Si era un cliente nuevo, volver al estado colapsado
    if (selectedCustomer === 'new') {
      setSelectedCustomer(null)
    }
    // No limpiar los datos de edición aquí ya que podrían ser necesarios después
  }
  const handleAddCustomer = async () => {
    // Expandir el panel para mostrar el formulario de nuevo cliente
    setIsCustomerDetailsPanelExpanded(true)
    
    // Cargar datos necesarios para edición directamente (no depender del estado global)
    if (availableAssetAccounts.length === 0) {
      await fetchAvailableAccounts()
    }
    if (paymentTermsTemplates.length === 0) {
      await fetchPaymentTermsTemplates()
    }
    if (taxTemplates.length === 0) {
      await refreshTaxTemplates()
    }
    // Cargar grupos directamente en lugar de usar el estado
    let customerGroupsData = customerGroups
    if (customerGroupsData.length === 0) {
      try {
        console.log('Cargando grupos de clientes directamente...')
        const response = await fetchWithAuth(API_ROUTES.customerGroups)
        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            customerGroupsData = data.data || []
            console.log('Grupos de clientes cargados directamente:', customerGroupsData.length)
          }
        }
      } catch (error) {
        console.error('Error cargando grupos directamente:', error)
      }
    }
    if (availablePriceLists.length === 0) {
      await fetchPriceLists()
    }
    
    console.log('DEBUG handleAddCustomer: customerGroupsData:', customerGroupsData)
    console.log('DEBUG handleAddCustomer: customerGroupsData.length:', customerGroupsData.length)
    
    // Obtener el grupo por defecto: preferir grupos hoja (is_group === 0).
    const leafGroups = customerGroupsData.filter(g => g.is_group === 0)
    let defaultGroup = ''
    if (leafGroups.length === 1) {
      defaultGroup = leafGroups[0].customer_group_name
    } else if (leafGroups.length > 1) {
      // IMPORTANT: previously we silently fell back to 'Clientes Generales' or the first leaf.
      // That created incorrect assignments to parent groups. Do not invent a default here — fail
      // loudly so the situation can be debugged and corrected.
      console.error('Multiple leaf customer groups found but no explicit default set. Aborting automatic default selection.')
      showNotification('No se puede determinar un grupo de cliente por defecto automáticamente. Hay varios grupos finales — seleccioná uno manualmente.', 'error')
      // Keep defaultGroup empty so the UI will require the user to select an explicit group
      defaultGroup = ''
    } else {
      // No leaf groups available at all — fail loudly
      console.error('No leaf (is_group=0) customer groups found. Aborting new-customer default group selection.')
      showNotification('No hay grupos de clientes finales definidos (is_group = 0). Por favor crea al menos un grupo final antes de crear clientes.', 'error')
      defaultGroup = ''
    }
    // Cargar cuentas de ingresos si no están disponibles
    let incomeAccountsData = availableIncomeAccounts
    if (incomeAccountsData.length === 0) {
      try {
        console.log('Cargando cuentas de ingresos directamente...')
        const accountsResponse = await fetchWithAuth(API_ROUTES.accounts)
        if (accountsResponse.ok) {
          const accountsData = await accountsResponse.json()
          if (accountsData.success) {
            // Filtrar cuentas de ingresos
            incomeAccountsData = accountsData.data.filter(account => 
              account.root_type === 'Income' && 
              !account.is_group // Solo cuentas hoja, no sumarizadoras
            )
            console.log('Cuentas de ingresos cargadas directamente:', incomeAccountsData.length)
          }
        }
      } catch (error) {
        console.error('Error cargando cuentas de ingresos directamente:', error)
      }
    }
    // Cargar valores por defecto del grupo si hay un grupo único
    let defaultValues = {}
    if (customerGroupsData.length === 1) {
      console.log('DEBUG handleAddCustomer: Solo hay un grupo, cargando valores por defecto')
      const groupDetails = await fetchCustomerGroupDetails(defaultGroup)
      console.log('DEBUG handleAddCustomer: groupDetails obtenidos:', groupDetails)
      if (groupDetails) {
        if (groupDetails.default_price_list) {
          defaultValues.price_list = groupDetails.default_price_list
          console.log('DEBUG handleAddCustomer: price_list del grupo:', groupDetails.default_price_list)
        }
        if (groupDetails.payment_terms) {
          defaultValues.payment_terms = groupDetails.payment_terms
          console.log('DEBUG handleAddCustomer: payment_terms del grupo:', groupDetails.payment_terms)
        }
        if (groupDetails.accounts && groupDetails.accounts.length > 0) {
          console.log('DEBUG handleAddCustomer: groupDetails.accounts:', groupDetails.accounts)
          const incomeAccount = groupDetails.accounts.find(acc => acc.account)
          console.log('DEBUG handleAddCustomer: incomeAccount encontrado:', incomeAccount)
          if (incomeAccount) {
            console.log('DEBUG handleAddCustomer: incomeAccount.account:', incomeAccount.account)
            console.log('DEBUG handleAddCustomer: availableIncomeAccounts:', incomeAccountsData.map(acc => ({ name: acc.name, account_name: acc.account_name })))
            // Buscar la cuenta correspondiente en availableIncomeAccounts por account_name
            // Extraer el nombre de la cuenta del formato "4.1.1.01.00 - Ventas de Servicios - MS"
            const accountNameFromGroup = incomeAccount.account.split(' - ')[1] // "Ventas de Servicios"
            const matchingAccount = incomeAccountsData.find(acc => acc.account_name === accountNameFromGroup)
            console.log('DEBUG handleAddCustomer: matchingAccount encontrado:', matchingAccount)
            if (matchingAccount) {
              defaultValues.default_income_account = matchingAccount.name
              console.log('DEBUG handleAddCustomer: Asignando default_income_account:', matchingAccount.name)
            } else {
              console.log('DEBUG handleAddCustomer: No se encontró matchingAccount para:', incomeAccount.account)
            }
          }
        }
      }
    } else {
      console.log('DEBUG handleAddCustomer: No hay un grupo único, no se cargan valores por defecto automáticamente')
    }
    setSelectedCustomer('new')
    setIsEditingCustomer(true)
    setEditedCustomerData({
      customer_name: '',
      customer_details: '', // Nombre comercial
      customer_group: defaultGroup,
      website: '',
      email: '',
      phone: '',
      address: '',
      contacto: '',
      default_receivable_account: activeCompanyDetails?.default_receivable_account || '',
      default_income_account: defaultValues.default_income_account || '',
      fecha_alta: '',
      ciudad: '',
      codigo_postal: '',
      provincia: '',
      pais: 'Argentina',
      tax_id: '',
      custom_condicion_iva: '',
      condicion_venta: '',
      porcentaje_descuento: '',
      porcentaje_iva: '',
      lista_precios: '',
      transportista: '',
      custom_default_iva_ventas: activeCompanyDetails?.custom_default_iva_ventas || '',
      price_list: defaultValues.price_list || '',
      payment_terms: defaultValues.payment_terms || ''
    })
    setCustomerDetails(null)
    setCustomerInvoices([])
    setCustomerStatements([])
    setCustomerAddresses([])
  }
  const handleEditChange = async (field, value) => {
    const newData = {
      ...editedCustomerData,
      [field]: value
    }
    // Si se cambia la plantilla de IVA, actualizar también el porcentaje
    if (field === 'custom_default_iva_ventas' && value) {
      const selectedTemplate = taxTemplates.find(template => template.name === value)
      if (selectedTemplate && selectedTemplate.iva_rates && selectedTemplate.iva_rates.length > 0) {
        newData.porcentaje_iva = selectedTemplate.iva_rates[0]
      }
    }
    // Si se cambia el grupo de cliente, cargar valores por defecto del grupo si faltan
    if (field === 'customer_group' && value) {
      const groupDetails = await fetchCustomerGroupDetails(value)
      if (groupDetails) {
        console.log('Detalles del grupo obtenidos:', groupDetails)
        // Setear valores por defecto del grupo solo si no existen
        if (!newData.price_list && groupDetails.default_price_list) {
          newData.price_list = groupDetails.default_price_list
          console.log('Aplicando price_list del grupo:', groupDetails.default_price_list)
        }
        if (!newData.payment_terms && groupDetails.payment_terms) {
          newData.payment_terms = groupDetails.payment_terms
          console.log('Aplicando payment_terms del grupo:', groupDetails.payment_terms)
        }
        // La cuenta de ingresos del grupo prevalece sobre la de la compañía si no tiene
        if (groupDetails.accounts && groupDetails.accounts.length > 0) {
          const incomeAccount = groupDetails.accounts.find(acc => acc.account)
          if (incomeAccount) {
            // Buscar la cuenta correspondiente en availableIncomeAccounts por account_name
            // Extraer el nombre de la cuenta del formato "4.1.1.01.00 - Ventas de Servicios - MS"
            const accountNameFromGroup = incomeAccount.account.split(' - ')[1] // "Ventas de Servicios"
            const matchingAccount = availableIncomeAccounts.find(acc => acc.account_name === accountNameFromGroup)
            if (matchingAccount) {
              newData.default_income_account = matchingAccount.name
              console.log('Aplicando default_income_account del grupo:', matchingAccount.name)
            } else {
              console.log('No se encontró cuenta correspondiente para:', incomeAccount.account)
            }
          }
        }
      }
    }
    setEditedCustomerData(newData)
  }
  const handleSaveCustomer = async () => {
    if (!selectedCustomer) return
    try {
      setSavingCustomer(true)
      console.log('Datos originales editedCustomerData:', editedCustomerData) // Para debugging
      // Asegurar que los campos vacíos se conviertan a null para ERPNext
      const dataToSend = { ...editedCustomerData }
      const fieldsToCheck = ['address', 'ciudad', 'codigo_postal', 'provincia', 'pais', 'custom_condicion_iva']
      fieldsToCheck.forEach(field => {
        if (dataToSend[field] === '') {
          dataToSend[field] = null
        }
      })
      // Normalize customer_group to canonical before validations/sends
      const normalizeGroupToCanonical = (groupValue) => {
        if (!groupValue) return groupValue
        let found = customerGroups.find(g => (
          (g.customer_group_name || '').toString() === groupValue.toString()
          || (g.name || '').toString() === groupValue.toString()
          || (g.display_name || '').toString() === groupValue.toString()
        ))
        if (found) return found.customer_group_name || found.name || groupValue
        const abbr = activeCompanyDetails?.abbr || ''
        if (abbr) {
          const candidates = [ `${groupValue} - ${abbr}`, `${groupValue}-${abbr}` ]
          for (const candidate of candidates) {
            found = customerGroups.find(g => (g.customer_group_name || '') === candidate || (g.name || '') === candidate)
            if (found) return found.customer_group_name || found.name || candidate
          }
        }
        return groupValue
      }
      if (dataToSend.customer_group) {
        dataToSend.customer_group = normalizeGroupToCanonical(dataToSend.customer_group)
      }
      // Asignar automáticamente la cuenta de ingresos basada en el grupo o empresa
      const assignedIncomeAccount = getAssignedIncomeAccount(dataToSend.customer_group, dataToSend)
      if (assignedIncomeAccount.id) {
        dataToSend.default_income_account = assignedIncomeAccount.id
      }
      // VALIDACIÓN: evitar enviar un customer_group que sea un nodo (is_group === 1)
      if (dataToSend.customer_group) {
        try {
          const groupDetails = await fetchCustomerGroupDetails(dataToSend.customer_group)
          if (groupDetails && groupDetails.is_group === 1) {
            showNotification('El grupo seleccionado es un grupo padre (is_group=1). Seleccione un grupo de cliente final.', 'error')
            setSavingCustomer(false)
            return
          }
        } catch (err) {
          console.error('Error validando grupo de cliente antes de guardar:', err)
        }
      }
      // No enviar campos de dirección al customer, se manejan en la dirección fiscal
      const addressFields = ['address', 'ciudad', 'codigo_postal', 'provincia', 'pais']
      addressFields.forEach(field => {
        delete dataToSend[field]
      })
      // No enviar fecha_alta (es de solo lectura - campo creation de ERPNext)
      delete dataToSend.fecha_alta
      console.log('Datos procesados dataToSend:', dataToSend) // Para debugging
      const response = await fetchWithAuth(`${API_ROUTES.customers}/${selectedCustomer}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: dataToSend }),
      })
      if (response.ok) {
        showNotification('Cliente actualizado exitosamente', 'success')
        setIsEditingCustomer(false)
        setEditedCustomerData({})
        
        // Actualizar o crear la dirección fiscal
        await handleSaveFiscalAddress()
        
        // Recargar detalles del cliente
        fetchCustomerDetails(selectedCustomer)
        fetchCustomerAddresses(selectedCustomer)
        // Recargar la lista de clientes
        fetchCustomers()
      } else {
        const errorData = await response.json()
        showNotification(`Error al actualizar cliente: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error updating customer:', error)
      showNotification('Error al actualizar cliente', 'error')
    } finally {
      setSavingCustomer(false)
    }
  }
  const handleDeleteCustomer = async () => {
    if (!selectedCustomer) return
    // Confirmación antes de borrar
    const confirmed = await confirm({
      title: 'Eliminar Cliente',
      message: `¿Estás seguro de que querés eliminar al cliente "${selectedCustomer}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'error'
    })
    if (!confirmed) return
    try {
      setLoading(true)
      const response = await fetchWithAuth(`${API_ROUTES.customers}/${selectedCustomer}`, {
        method: 'DELETE',
      })
      // Success
      if (response.ok) {
        showNotification('Cliente eliminado exitosamente', 'success')
        setSelectedCustomer(null)
        setCustomerDetails(null)
        setCustomerInvoices([])
        setCustomerStatements([])
        // Recargar la lista de clientes
        fetchCustomers()
        return
      }
      // Error paths: try to parse JSON or text to surface helpful messages
      let payload = null
      try {
        payload = await response.json()
      } catch (jsonErr) {
        // response wasn't JSON (HTML error page or text)
        try {
          const bodyText = await response.text()
          // crude check for link exists / not deletable
          if (/No se puede eliminar|Puede desactivar|LinkExistsError/i.test(bodyText)) {
              // Inform the user and offer to deactivate the customer instead of deleting
              const wantsDisable = await confirm({
                title: 'No se puede eliminar',
                message: 'Este cliente tiene documentos vinculados y no puede eliminarse. ¿Querés desactivarlo en su lugar? (Podrás re-activar más adelante)',
                confirmText: 'Desactivar',
                cancelText: 'Cancelar',
                type: 'warning'
              })
              if (wantsDisable) {
                await handleDisableCustomer()
              } else {
                showNotification('No se puede eliminar este cliente porque tiene documentos vinculados. Podés desactivarlo en lugar de borrarlo.', 'error')
              }
              return
            }
          // fallback: show a truncated response text
          showNotification(`Error al eliminar cliente (HTTP ${response.status})`, 'error')
          console.error('Delete customer response text:', bodyText)
          return
        } catch (tErr) {
          console.error('Error parsing non-JSON delete response', tErr)
        }
      }
      // If payload is JSON, inspect it for ERPNext style errors
      if (payload) {
        // If backend returned a detail text (e.g. from ERPNext) that mentions LinkExistsError or 'No se puede eliminar', offer to disable
        const detailText = payload.detail || payload._server_messages || ''
        if (typeof detailText === 'string' && /LinkExistsError|No se puede eliminar|Puede desactivar/i.test(detailText)) {
          const wantsDisable = await confirm({
            title: 'Cliente vinculado',
            message: 'Este cliente tiene documentos vinculados y no puede eliminarse. ¿Querés desactivarlo en su lugar?',
            confirmText: 'Desactivar',
            cancelText: 'Cancelar',
            type: 'warning'
          })
          if (wantsDisable) await handleDisableCustomer()
          else showNotification('No se puede eliminar este cliente porque tiene documentos vinculados.', 'error')
          return
        }
        // ERPNext sometimes returns exc_type or exception with LinkExistsError
        const excType = payload.exc_type || (payload.exception && payload.exception.indexOf('LinkExistsError') !== -1 ? 'LinkExistsError' : null)
        const serverMessages = payload._server_messages || []
        if (excType && /LinkExistsError/i.test(excType)) {
          // Try to extract a helpful message from server messages
          let friendly = 'No se puede eliminar este cliente porque tiene documentos vinculados. Podés desactivarlo en lugar de borrarlo.'
          if (Array.isArray(serverMessages) && serverMessages.length) {
            // Join and strip HTML tags to provide more context if available
            const joined = serverMessages.join('\n')
            const stripped = joined.replace(/<[^>]*>/g, '')
            if (stripped && stripped.length < 1000) {
              friendly += `\nDetalles: ${stripped}`
            }
          }
          // Ask if user wants to disable instead
          const wantsDisable = await confirm({
            title: 'Cliente vinculado',
            message: `${friendly}\n\n¿Deseás desactivarlo en su lugar?`,
            confirmText: 'Desactivar',
            cancelText: 'Cancelar',
            type: 'warning'
          })
          if (wantsDisable) {
            await handleDisableCustomer()
          } else {
            showNotification(friendly, 'error')
          }
          return
        }
        // Generic message coming as JSON
        const message = payload.message || payload.error || (payload.data && payload.data.message)
        if (message) {
          showNotification(`Error al eliminar cliente: ${message}`, 'error')
        } else {
          showNotification(`Error al eliminar cliente (HTTP ${response.status})`, 'error')
        }
        return
      }
      // Fallback generic error
      showNotification(`Error al eliminar cliente (HTTP ${response.status})`, 'error')
    } catch (error) {
      console.error('Error deleting customer:', error)
      showNotification('Error al eliminar cliente', 'error')
    } finally {
      setLoading(false)
    }
  }
  const handleDisableCustomer = async () => {
    if (!selectedCustomer) return
    const confirmed = await confirm({
      title: 'Desactivar Cliente',
      message: `¿Querés desactivar al cliente "${selectedCustomer}"? Esto impedirá usarlo en nuevos documentos pero mantendrá el historial.`,
      confirmText: 'Desactivar',
      cancelText: 'Cancelar',
      type: 'warning'
    })
    if (!confirmed) return
    try {
      setLoading(true)
      const response = await fetchWithAuth(`${API_ROUTES.customers}/${selectedCustomer}/disable`, {
        method: 'PUT'
      })
      if (response.ok) {
        showNotification('Cliente desactivado correctamente', 'success')
        // Refresh customer data and list
        setSelectedCustomer(null)
        setCustomerDetails(null)
        fetchCustomers()
        return
      }
      const payload = await response.json().catch(() => null)
      const message = payload?.message || payload?.error || `Error al desactivar cliente (HTTP ${response.status})`
      showNotification(message, 'error')
    } catch (error) {
      console.error('Error disabling customer:', error)
      showNotification('Error al desactivar cliente', 'error')
    } finally {
      setLoading(false)
    }
  }
  const handleDeleteInvoice = async (invoiceName) => {
    if (!invoiceName) return
    const confirmed = await confirm({
      title: 'Eliminar Factura',
      message: `¿Estás seguro de que quieres eliminar la factura "${invoiceName}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'error'
    })
    if (!confirmed) return
    try {
      const response = await fetchWithAuth(`${API_ROUTES.invoices}/${invoiceName}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        showNotification('Factura eliminada exitosamente', 'success')
        // Recargar las facturas del cliente
        if (selectedCustomer) {
          fetchCustomerInvoices(selectedCustomer)
        }
      } else {
        const errorData = await response.json()
        showNotification(`Error al eliminar factura: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error deleting invoice:', error)
      showNotification('Error al eliminar factura', 'error')
    }
  }
  const handleOpenInvoice = async (invoiceName) => {
    try {
      const response = await fetchWithAuth(`/api/invoices/${invoiceName}`)
      if (response.ok) {
        const result = await response.json()
        setEditingInvoice(result.data)
        setIsInvoiceModalOpen(true)
      } else {
        showNotification('Error al obtener la factura', 'error')
      }
    } catch (error) {
      console.error('Error fetching invoice:', error)
      showNotification('Error al obtener la factura', 'error')
    }
  }
  const handleOpenPayment = async (paymentName) => {
    try {
      const response = await fetchWithAuth(`/api/pagos/${paymentName}`)
      if (response.ok) {
        const result = await response.json()
        setEditingPayment(result.data)
        setIsPaymentModalOpen(true)
      } else {
        showNotification('Error al obtener el pago', 'error')
      }
    } catch (error) {
      console.error('Error fetching payment:', error)
      showNotification('Error al obtener el pago', 'error')
    }
  }
  const openInvoiceFromStatement = async (voucherNo) => {
    try {
      console.log('[CustomerPanel] openInvoiceFromStatement called with voucherNo:', voucherNo)
      if (!voucherNo) return
      // Try to find in already loaded invoices
      const found = allCustomerInvoices.find(inv => inv.name === voucherNo || inv.name?.includes(voucherNo) || inv.invoice_number === voucherNo)
      console.log('[CustomerPanel] found in allCustomerInvoices:', found?.name)
      if (found) {
        await handleOpenInvoice(found.name)
        return
      }
      // Try pendingInvoices
      const pendingFound = pendingInvoices.find(inv => {
        const identifier = getDocumentIdentifier(inv)
        return identifier === voucherNo || identifier?.includes(voucherNo) || inv.invoice_number === voucherNo
      })
      console.log('[CustomerPanel] found in pendingInvoices:', pendingFound?.name)
      if (pendingFound) {
        await handleOpenInvoice(pendingFound.name)
        return
      }
      // Fallback: try opening directly by voucherNo (handleOpenInvoice will fetch)
      console.log('[CustomerPanel] falling back to handleOpenInvoice with voucherNo')
      await handleOpenInvoice(voucherNo)
    } catch (err) {
      console.error('[CustomerPanel] error in openInvoiceFromStatement:', err)
    }
  }
  const isInvoiceVoucherType = (voucherType) => {
    if (!voucherType) return false
    return /invoice|factura/i.test(voucherType)
  }
  const isPaymentVoucherType = (voucherType) => {
    if (!voucherType) return false
    return /payment|pago|receipt|payment entry/i.test(voucherType)
  }
  const isCreditVoucherType = (voucherType) => {
    if (!voucherType) return false
    return /credit|nota de cr|nota_credito|nota|nc/i.test(voucherType)
  }
  const isDebitVoucherType = (voucherType) => {
    if (!voucherType) return false
    return /debit|nota de débito|nd/i.test(voucherType)
  }
  // Generic handler: open the correct document depending on voucher_type
  const openStatementEntry = async (voucherNo, voucherType) => {
    try {
      console.log('[CustomerPanel] openStatementEntry', voucherNo, voucherType)
      if (!voucherNo) return
      if (isPaymentVoucherType(voucherType)) {
        // Try to find payment locally
        const foundPayment = customerPayments.find(p => p.name === voucherNo || p.name?.includes(voucherNo) || p.payment_entry?.includes?.(voucherNo))
        console.log('[CustomerPanel] payment found locally:', foundPayment?.name)
        if (foundPayment) {
          await handleOpenPayment(foundPayment.name)
          return
        }
        // Fallback: open by voucherNo
        await handleOpenPayment(voucherNo)
        return
      }
      // Treat credit/debit/invoice all as invoices for opening in InvoiceModal (the modal distinguishes credit notes)
      if (isInvoiceVoucherType(voucherType) || isCreditVoucherType(voucherType) || isDebitVoucherType(voucherType)) {
        // Try to find in invoices loaded
        const found = allCustomerInvoices.find(inv => inv.name === voucherNo || inv.name?.includes(voucherNo) || inv.invoice_number === voucherNo)
        console.log('[CustomerPanel] invoice found locally:', found?.name)
        if (found) {
          await handleOpenInvoice(found.name)
          return
        }
        const pendingFound = pendingInvoices.find(inv => {
          const identifier = getDocumentIdentifier(inv)
          return identifier === voucherNo || identifier?.includes(voucherNo) || inv.invoice_number === voucherNo
        })
        console.log('[CustomerPanel] invoice found in pending:', pendingFound?.name)
        if (pendingFound) {
          await handleOpenInvoice(pendingFound.name)
          return
        }
        // Fallback: try opening directly by voucherNo
        await handleOpenInvoice(voucherNo)
        return
      }
      // Default fallback: try invoice first then payment
      await handleOpenInvoice(voucherNo)
    } catch (err) {
      console.error('[CustomerPanel] error opening statement entry:', err)
    }
  }
  const handleCreateCustomer = async () => {
    try {
      // Normalize customer_group into a canonical name (ensure company abbr is included when possible)
      const normalizeGroupToCanonical = (groupValue) => {
        if (!groupValue) return groupValue
        // exact matches
        let found = customerGroups.find(g => (
          (g.customer_group_name || '').toString() === groupValue.toString()
          || (g.name || '').toString() === groupValue.toString()
          || (g.display_name || '').toString() === groupValue.toString()
        ))
        if (found) return found.customer_group_name || found.name || groupValue
        // try appending company abbr (with and without space)
        const abbr = activeCompanyDetails?.abbr || ''
        if (abbr) {
          const candidates = [ `${groupValue} - ${abbr}`, `${groupValue}-${abbr}` ]
          for (const candidate of candidates) {
            found = customerGroups.find(g => (g.customer_group_name || '') === candidate || (g.name || '') === candidate)
            if (found) return found.customer_group_name || found.name || candidate
          }
        }
        return groupValue
      }
      // Asignar automáticamente la cuenta de ingresos antes de crear
      const dataToSend = { ...editedCustomerData }
      // Ensure the group is canonical before assigning accounts / creating
      if (dataToSend.customer_group) {
        dataToSend.customer_group = normalizeGroupToCanonical(dataToSend.customer_group)
      }
      const assignedIncomeAccount = getAssignedIncomeAccount(dataToSend.customer_group, dataToSend)
      if (assignedIncomeAccount.id) {
        dataToSend.default_income_account = assignedIncomeAccount.id
      }
      // VALIDACIÓN: evitar crear cliente con un grupo padre (is_group === 1)
      if (dataToSend.customer_group) {
        try {
          const groupDetails = await fetchCustomerGroupDetails(dataToSend.customer_group)
          if (groupDetails && groupDetails.is_group === 1) {
            showNotification('El grupo seleccionado para el cliente es un grupo padre (is_group=1). Seleccione un grupo final antes de crear.', 'error')
            setSavingCustomer(false)
            return
          }
        } catch (err) {
          console.error('Error validando grupo de cliente antes de crear:', err)
        }
      }
      const response = await fetchWithAuth(API_ROUTES.customers, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: dataToSend }),
      })
      if (response.ok) {
        showNotification('Cliente creado exitosamente', 'success')
        setIsEditingCustomer(false)
        setEditedCustomerData({})
        setCustomerDetails(null)
        // Recargar la lista de clientes
        fetchCustomers()
      } else {
        const errorData = await response.json()
        showNotification(`Error al crear cliente: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error creating customer:', error)
      showNotification('Error al crear cliente', 'error')
    } finally {
      setSavingCustomer(false)
    }
  }
  // Función para determinar la cuenta de ingresos asignada automáticamente
  const getAssignedIncomeAccount = (customerGroup, editedData = null) => {
    // Si estamos editando y hay una cuenta ya asignada, mostrar esa
    if (editedData && editedData.default_income_account) {
      const account = availableIncomeAccounts.find(acc => acc.name === editedData.default_income_account)
      if (account) {
        return {
          name: extractAccountName(account.account_name),
          id: account.name
        }
      }
    }
    // Buscar la cuenta del grupo de clientes
    if (customerGroup) {
      // Allow flexible matching: customer_group_name, name or display_name may be provided.
      const findGroup = (value) => {
        if (!value) return null
        return customerGroups.find(g => (
          (g.customer_group_name || '').toString() === value.toString()
          || (g.name || '').toString() === value.toString()
          || (g.display_name || '').toString() === value.toString()
        ))
      }
      const resolvedGroup = findGroup(customerGroup) || findGroup((activeCompanyDetails?.abbr && `${customerGroup} - ${activeCompanyDetails.abbr}`) || customerGroup)
      const groupDetails = resolvedGroup
      if (groupDetails && groupDetails.accounts && groupDetails.accounts.length > 0) {
        const incomeAccount = groupDetails.accounts.find(acc => acc.account)
        if (incomeAccount) {
          // Buscar la cuenta correspondiente en availableIncomeAccounts
          const accountNameFromGroup = incomeAccount.account.split(' - ')[1] // "Ventas de Servicios"
          const matchingAccount = availableIncomeAccounts.find(acc => acc.account_name === accountNameFromGroup)
          if (matchingAccount) {
            return {
              name: extractAccountName(matchingAccount.account_name),
              id: matchingAccount.name
            }
          }
        }
      }
    }
    // Si no hay cuenta del grupo, usar la cuenta por defecto de la empresa
    if (activeCompanyDetails && activeCompanyDetails.default_income_account) {
      const account = availableIncomeAccounts.find(acc => acc.name === activeCompanyDetails.default_income_account)
      if (account) {
        return {
          name: extractAccountName(account.account_name),
          id: account.name
        }
      }
    }
    return {
      name: 'No especificada',
      id: null
    }
  }
  const getFiscalAddress = () => {
    return customerAddresses.find(address => 
      address.address_type === 'Billing' || 
      address.address_type === 'Dirección Fiscal' ||
      (address.address_type === 'Other' && address.custom_type === 'Fiscal')
    )
  }
  const handleSaveFiscalAddress = async () => {
    // Validar campos obligatorios
    if (!editedCustomerData.address || !editedCustomerData.address.trim()) {
      showNotification('La dirección es obligatoria', 'error')
      return
    }
    if (!editedCustomerData.ciudad || !editedCustomerData.ciudad.trim()) {
      showNotification('La ciudad es obligatoria', 'error')
      return
    }
    try {
      const fiscalAddress = getFiscalAddress()
      const addressData = {
        address_title: 'Dirección Fiscal',
        address_type: 'Billing',
        address_line1: editedCustomerData.address.trim(),
        address_line2: '',
        city: editedCustomerData.ciudad.trim(),
        state: editedCustomerData.provincia || '',
        pincode: editedCustomerData.codigo_postal || '',
        country: editedCustomerData.pais || 'Argentina',
        link_doctype: 'Customer',
        link_name: selectedCustomer
      }
      let response
      if (fiscalAddress) {
        // Actualizar dirección fiscal existente
        response = await fetchWithAuth(`${API_ROUTES.addressDetails}${encodeURIComponent(fiscalAddress.name)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(addressData),
        })
      } else {
        // Crear nueva dirección fiscal
        response = await fetchWithAuth(API_ROUTES.addresses, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(addressData),
        })
      }
      if (!response.ok) {
        console.error('Error saving fiscal address:', await response.text())
      }
    } catch (error) {
      console.error('Error saving fiscal address:', error)
    }
  }
  const handleCloseAddressModal = () => {
    setIsAddressModalOpen(false)
    // Recargar direcciones después de cerrar el modal
    if (selectedCustomer) {
      fetchCustomerAddresses(selectedCustomer)
    }
  }
  const formatBalance = (balance) => {
    if (balance === null || balance === undefined || balance === 0) {
      return '$ 0.00'
    }
    return `$${balance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const formatDate = (dateString) => {
    if (!dateString) return ''
    const [year, month, day] = dateString.split('-')
    return `${day}-${month}-${year}`
  }
  const hasValue = (value) => {
    return value && value !== 'No especificado' && value !== 'No especificada' && value !== '';
  }
  const getFieldIcon = (value) => {
    return hasValue(value) ? (
      <Check className="w-4 h-4 text-green-500" />
    ) : (
      <div className="w-4 h-4 rounded-full border-2 border-gray-300"></div>
    )
  }
  const canSelectCustomerDocument = (doc) => {
    if (!doc) return false
    // Permitir seleccionar todos los tipos de documentos (facturas y pagos)
    return true
  }
  const buildCustomerBulkPayload = (context, documentNames) => {
    if (!context || !Array.isArray(documentNames)) return { invoices: [], payments: [] }
    
    const invoices = []
    const payments = []
    
    for (const name of documentNames) {
      const match = customerInvoices.find(doc => getDocumentIdentifier(doc) === name)
      if (!match || !canSelectCustomerDocument(match)) continue
      
      const payload = { name: getDocumentIdentifier(match) }
      if (typeof match.docstatus === 'number') {
        payload.docstatus = match.docstatus
      }
      
      // Clasificar por tipo de documento
      if (match.itemType === 'payment' || match.doctype === 'Payment Entry') {
        payments.push(payload)
      } else {
        invoices.push(payload)
      }
    }
    
    return { invoices, payments }
  }
  const handleBulkRowToggle = (documentName, checked) => {
    setBulkDeleteState(prev => {
      if (!prev.active) return prev
      const target = customerInvoices.find(doc => getDocumentIdentifier(doc) === documentName)
      if (!canSelectCustomerDocument(target)) return prev
      const nextSelection = new Set(prev.selected)
      if (checked) {
        nextSelection.add(documentName)
      } else {
        nextSelection.delete(documentName)
      }
      return {
        ...prev,
        selected: nextSelection
      }
    })
  }
  const handleBulkSelectAll = (context, documents, checked) => {
    if (!Array.isArray(documents)) return
    setBulkDeleteState(prev => {
      if (!prev.active || prev.context !== context) return prev
      const nextSelection = new Set(prev.selected)
      documents.forEach(doc => {
        if (!canSelectCustomerDocument(doc)) return
        const identifier = getDocumentIdentifier(doc)
        if (!identifier) return
        if (checked) {
          nextSelection.add(identifier)
        } else {
          nextSelection.delete(identifier)
        }
      })
      return {
        ...prev,
        selected: nextSelection
      }
    })
  }
  const executeCustomerBulkDelete = async () => {
    if (!selectedCustomer) {
      showNotification('Selecciona un cliente antes de eliminar documentos', 'warning')
      return
    }
    const selectedDocuments = Array.from(bulkDeleteState.selected)
    if (selectedDocuments.length === 0) {
      resetBulkDeleteState()
      return
    }
    const { invoices, payments } = buildCustomerBulkPayload(bulkDeleteState.context, selectedDocuments)
    
    if (invoices.length === 0 && payments.length === 0) {
      showNotification('Selecciona documentos válidos para eliminar', 'warning')
      resetBulkDeleteState()
      return
    }
    
    setIsBulkDeleting(true)
    
    try {
      const promises = []
      
      // Eliminar facturas si hay
      if (invoices.length > 0) {
        promises.push(
          fetchWithAuth(API_ROUTES.bulkSalesInvoicesRemoval, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoices })
          }).then(async response => {
            const data = await response.json().catch(() => ({}))
            return { type: 'invoices', response, data }
          })
        )
      }
      
      // Eliminar pagos si hay
      if (payments.length > 0) {
        promises.push(
          fetchWithAuth(API_ROUTES.bulkPaymentEntriesRemoval, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payments })
          }).then(async response => {
            const data = await response.json().catch(() => ({}))
            return { type: 'payments', response, data }
          })
        )
      }
      
      const results = await Promise.all(promises)
      
      // Procesar resultados
      const errors = []
      const successes = []
      
      for (const result of results) {
        if (!result.response.ok || result.data.success === false) {
          errors.push(result.data.message || `Error al eliminar ${result.type}`)
        } else {
          successes.push(result.data.message || `${result.type} procesados correctamente`)
        }
      }
      
      if (errors.length > 0) {
        showNotification(errors.join('. '), 'error')
      } else {
        showNotification(successes.join('. '), 'success')
      }
      
      // Refrescar datos
      if (selectedCustomer) {
        await fetchCustomerInvoices(selectedCustomer)
        await fetchCustomerStatements(selectedCustomer)
      }
    } catch (error) {
      console.error('Error eliminando documentos de cliente:', error)
      showNotification('Error eliminando documentos seleccionados', 'error')
    } finally {
      setIsBulkDeleting(false)
      resetBulkDeleteState()
    }
  }
  const handleBulkDeleteToggle = async () => {
    if (!CUSTOMER_BULK_TABS.includes(invoiceTab) || isBulkDeleting) {
      return
    }
    if (!bulkDeleteState.active || bulkDeleteState.context !== invoiceTab) {
      setBulkDeleteState({
        active: true,
        context: invoiceTab,
        selected: new Set()
      })
      return
    }
    if (bulkDeleteState.selected.size === 0) {
      resetBulkDeleteState()
      return
    }
    await executeCustomerBulkDelete()
  }
  const handleInvoiceTablePageChange = (newPage) => {
    const totalPages = Math.max(1, Math.ceil(customerInvoices.length / CUSTOMER_INVOICE_PAGE_SIZE))
    const nextPage = Math.min(Math.max(newPage, 1), totalPages)
    setInvoiceTablePage(nextPage)
  }
  const handleStatementTablePageChange = (newPage) => {
    const totalPages = Math.max(1, Math.ceil(customerStatements.length / CUSTOMER_STATEMENT_PAGE_SIZE))
    const nextPage = Math.min(Math.max(newPage, 1), totalPages)
    setStatementTablePage(nextPage)
  }
  const toggleConciliationRow = (groupId) => {
    if (!groupId) return
    setExpandedConciliationRows(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }
  const renderItemsTable = (items, bulkOptions = {}, extraOptions = {}) => (
    <CustomerInvoicesTable
      items={items}
      invoiceTab={invoiceTab}
      invoiceTablePage={invoiceTablePage}
      handleInvoiceTablePageChange={handleInvoiceTablePageChange}
      fetchWithAuth={fetchWithAuth}
      bulkOptions={bulkOptions}
      extraOptions={extraOptions}
      expandedConciliationRows={expandedConciliationRows}
      toggleConciliationRow={toggleConciliationRow}
      isInvoiceVoucherType={isInvoiceVoucherType}
      isPaymentVoucherType={isPaymentVoucherType}
      isCreditVoucherType={isCreditVoucherType}
      isDebitVoucherType={isDebitVoucherType}
      formatDate={formatDate}
      formatBalance={formatBalance}
      truncateDescription={truncateDescription}
      formatVoucherNumber={formatVoucherNumber}
      mapVoucherTypeToSigla={mapVoucherTypeToSigla}
      downloadDocumentPdf={downloadDocumentPdf}
      handleDeleteInvoice={handleDeleteInvoice}
      downloadingDocuments={downloadingDocuments}
      handleOpenInvoice={handleOpenInvoice}
      handleOpenPayment={handleOpenPayment}
    />
  )

  const salesOrdersPendingCount = salesOrdersCounts.pending || 0
  if (showSubscriptionManager) {
    return (
      <>
        <SubscriptionBulkManager
          onBack={() => setShowSubscriptionManager(false)}
          fetchWithAuth={fetchWithAuth}
          showNotification={showNotification}
          activeCompany={activeCompany}
          confirm={confirm}
        />
        <ConfirmDialog />
      </>
    )
  }
  return (
    <>
      <Visualizacion
        customers={customers}
        subscriptionCustomers={subscriptionCustomers}
        fetchWithAuth={fetchWithAuth}
        selectedCustomer={selectedCustomer}
        setSelectedCustomer={setSelectedCustomer}
        customerDetails={customerDetails}
        customerSubscriptions={customerSubscriptions}
        isLoadingCustomerSubscriptions={isLoadingCustomerSubscriptions}
        subscriptionMutations={subscriptionMutations}
        customerAddresses={customerAddresses}
        customerInvoices={customerInvoices}
        unpaidInvoicesCount={unpaidInvoicesCount}
        draftInvoicesCount={draftInvoicesCount}
        customerStatements={customerStatements}
        conciliationGroups={customerConciliations}
        loading={loading}
        isInvoiceModalOpen={isInvoiceModalOpen}
        setIsInvoiceModalOpen={setIsInvoiceModalOpen}
        companyTalonarios={companyTalonarios}
        isEditingCustomer={isEditingCustomer}
        editedCustomerData={editedCustomerData}
        savingCustomer={savingCustomer}
        editingInvoice={editingInvoice}
        setEditingInvoice={setEditingInvoice}
        isAddressModalOpen={isAddressModalOpen}
        setIsAddressModalOpen={setIsAddressModalOpen}
        isPaymentModalOpen={isPaymentModalOpen}
        setIsPaymentModalOpen={setIsPaymentModalOpen}
        editingPayment={editingPayment}
        setEditingPayment={setEditingPayment}
        isReconciliationModalOpen={isReconciliationModalOpen}
        setIsReconciliationModalOpen={setIsReconciliationModalOpen}
        hasMoreStatements={hasMoreStatements}
        loadingMoreStatements={loadingMoreStatements}
        statementTablePage={statementTablePage}
        statementTablePageSize={CUSTOMER_STATEMENT_PAGE_SIZE}
        onStatementPageChange={handleStatementTablePageChange}
        invoiceTab={invoiceTab}
        setInvoiceTab={setInvoiceTab}
        customerListTab={customerListTab}
        setCustomerListTab={setCustomerListTab}
        customerTab={customerTab}
        setCustomerTab={setCustomerTab}
        availableAssetAccounts={availableAssetAccounts}
        availableIncomeAccounts={availableIncomeAccounts}
        paymentTermsTemplates={paymentTermsTemplates}
        taxTemplates={taxTemplates}
        customerSearch={customerSearch}
        setCustomerSearch={setCustomerSearch}
        loadingSubscriptionCustomers={loadingSubscriptionCustomers}
        consultingAfip={consultingAfip}
        customerGroups={customerGroups}
        availablePriceLists={availablePriceLists}
        confirmModal={confirmModal}
        handleAddCustomer={handleAddCustomer}
        handleEditCustomer={handleEditCustomer}
        handleCancelEdit={handleCancelEdit}
        handleCreateCustomer={handleCreateCustomer}
        handleSaveCustomer={handleSaveCustomer}
        handleDeleteCustomer={handleDeleteCustomer}
        handleDisableCustomer={handleDisableCustomer}
        handleEditChange={handleEditChange}
        handleSearchAfip={handleSearchAfip}
        handleCloseAddressModal={handleCloseAddressModal}
        handleCreateInvoice={handleCreateInvoice}
        handleOpenInvoice={handleOpenInvoice}
        handleInvoiceDeleted={handleInvoiceDeleted}
        onCancelSubscription={handleCancelSubscription}
        linkedInvoiceDraft={linkedInvoiceDraft}
        onConsumeLinkedInvoiceDraft={() => setLinkedInvoiceDraft(null)}
        onOpenCustomerGroupModal={handleOpenTestModal}
        showTestModal={showTestModal}
        customerGroupFormData={customerGroupFormData}
        setCustomerGroupFormData={setCustomerGroupFormData}
        savingCustomerGroup={savingCustomerGroup}
        handleSaveCustomerGroup={handleSaveCustomerGroup}
        editingCustomerGroup={editingCustomerGroup}
        handleCloseCustomerGroupModal={handleCloseCustomerGroupModal}
        formatBalance={formatBalance}
        formatVoucherNumber={formatVoucherNumber}
        mapVoucherTypeToSigla={mapVoucherTypeToSigla}
        truncateDescription={truncateDescription}
        formatDate={formatDate}
        extractAccountName={extractAccountName}
        removeCompanyAbbr={removeCompanyAbbr}
        renderItemsTable={renderItemsTable}
        loadMoreStatements={loadMoreStatements}
        handleConfirmAction={handleConfirmAction}
        handleCancelAction={handleCancelAction}
        filterCustomers={filterCustomers}
        getFiscalAddress={getFiscalAddress}
        hasValue={hasValue}
        getFieldIcon={getFieldIcon}
        isInvoiceVoucherType={isInvoiceVoucherType}
        isPaymentVoucherType={isPaymentVoucherType}
        isCreditVoucherType={isCreditVoucherType}
        isDebitVoucherType={isDebitVoucherType}
        openStatementEntry={openStatementEntry}
        customerDeliveryNotes={customerDeliveryNotes}
        deliveryNotesPagination={deliveryNotesPagination}
        isLoadingDeliveryNotes={isLoadingDeliveryNotes}
        onSalesRemitoPageChange={handleSalesRemitoPageChange}
        onOpenSalesRemito={openSalesRemitoForEdit}
        onCreateSalesRemito={handleOpenSalesRemitoCreation}
        canCreateSalesRemito={hasActiveSalesRemitoTalonario}
        salesRemitoDisabledMessage={salesRemitoDisabledMessage}
        canCreateInvoice={hasActiveSalesInvoiceTalonario}
        salesInvoiceDisabledMessage={salesInvoiceDisabledMessage}
        onCreateInvoice={handleOpenNewInvoice}
        canRegisterPayment={canRegisterPayment}
        registerPaymentDisabledMessage={registerPaymentDisabledMessage}
        onCreatePayment={handleOpenNewPayment}
        customerSalesOrders={customerSalesOrders}
        salesOrdersPagination={salesOrdersPagination}
        isLoadingSalesOrders={isLoadingSalesOrders}
        salesOrdersView={salesOrdersView}
        setSalesOrdersView={setSalesOrdersView}
        salesOrdersCounts={salesOrdersCounts}
        onSalesOrderPageChange={handleSalesOrderPageChange}
        onOpenSalesOrder={handleOpenSalesOrder}
        onCreateSalesOrder={handleNewSalesOrder}
        onMarkSalesOrdersDelivered={handleMarkSalesOrdersDelivered}
        salesOrdersPendingCount={salesOrdersPendingCount}
        customerQuotations={customerQuotations}
        quotationsPagination={quotationsPagination}
        isLoadingQuotations={isLoadingQuotations}
        onSalesQuotationPageChange={handleSalesQuotationPageChange}
        onOpenSalesQuotation={handleOpenSalesQuotation}
        onCreateSalesQuotation={handleNewSalesQuotation}
        totalCustomers={totalCustomers}
        pageSize={pageSize}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        subscriptionPage={subscriptionPage}
        setSubscriptionPage={setSubscriptionPage}
        totalSubscriptionCustomers={totalSubscriptionCustomers}
        onOpenSubscriptionManager={() => setShowSubscriptionManager(true)}
        activeCompany={activeCompany}
        companyAbbr={activeCompanyDetails?.abbr}
        getAssignedIncomeAccount={getAssignedIncomeAccount}
        bulkDeleteState={bulkDeleteState}
        onToggleBulkDelete={handleBulkDeleteToggle}
        onBulkRowToggle={handleBulkRowToggle}
        onBulkSelectAll={handleBulkSelectAll}
        isBulkDeleting={isBulkDeleting}
        onDownloadDocumentPdf={downloadDocumentPdf}
        downloadingDocuments={downloadingDocuments}
        fetchCustomerInvoices={fetchCustomerInvoices}
        fetchCustomerStatements={fetchCustomerStatements}
        // Props para panel colapsable de detalles
        isCustomerDetailsPanelExpanded={isCustomerDetailsPanelExpanded}
        setIsCustomerDetailsPanelExpanded={setIsCustomerDetailsPanelExpanded}
        loadingCustomerDetails={loadingCustomerDetails}
        // Props para carga de saldos a demanda
        balancesLoaded={balancesLoaded}
        loadingBalances={loadingBalances}
        onFetchBalances={fetchCustomerBalances}
        // Props para toggle de nombre comercial/fiscal
        showCommercialName={showCommercialName}
        setShowCommercialName={setShowCommercialName}
    />
      <SalesOrderModal
        isOpen={isSalesOrderModalOpen}
        onClose={() => {
          setIsSalesOrderModalOpen(false)
          setEditingSalesOrder(null)
        }}
        selectedCustomer={selectedCustomer}
        customerDetails={customerDetails}
        activeCompany={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        editingOrder={editingSalesOrder}
        onSave={handleSaveSalesOrder}
        onCancelOrder={handleCancelSalesOrder}
        onConvertToInvoice={handleConvertSalesOrderToInvoice}
      />
      <SalesQuotationModal
        isOpen={isSalesQuotationModalOpen}
        onClose={() => {
          setIsSalesQuotationModalOpen(false)
          setEditingSalesQuotation(null)
        }}
        selectedCustomer={selectedCustomer}
        customerDetails={customerDetails}
        activeCompany={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        editingQuotation={editingSalesQuotation}
        onSave={handleSaveSalesQuotation}
      />
      <SalesRemitoModal
        isOpen={isSalesRemitoModalOpen}
        onClose={() => {
          setIsSalesRemitoModalOpen(false)
          setSelectedSalesRemito(null)
          setSalesRemitoDraftData(null)
        }}
        selectedCustomer={selectedCustomer}
        customerDetails={customerDetails}
        activeCompany={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        selectedRemitoName={selectedSalesRemito}
        initialRemitoData={salesRemitoDraftData?.remito}
        prefilledFormData={salesRemitoDraftData?.normalizedFormData}
        onSaved={async () => {
          if (selectedCustomer) {
            await fetchCustomerDeliveryNotes(selectedCustomer, deliveryNotesPagination.page)
          }
          await fetchCompanyTalonarios()
          setSelectedSalesRemito(null)
          setSalesRemitoDraftData(null)
        }}
      />
      <CustomerGroupModal
        isOpen={showCustomerGroupModal}
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
      <ConfirmDialog />
    </>
  )
}
  const getDocumentIdentifier = (document) => {
    if (!document) return ''
    return document.erpnext_name || document.name || ''
  }
