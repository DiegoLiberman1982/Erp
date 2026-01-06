import React, { useState, useEffect, useContext, useMemo, useRef } from 'react'
import {
  Users,
  FileText,
  Edit,
  Trash2,
  Save,
  Plus,
  MapPin,
  Check,
  Search,
  DollarSign,
  AlertTriangle,
  X,
  CheckCircle,
  FileDown,
  Loader2
} from 'lucide-react'
import { AuthContext } from '../AuthProvider'
import { NotificationContext } from '../contexts/NotificationContext'
import useTaxTemplates from '../hooks/useTaxTemplates'
import API_ROUTES from '../apiRoutes'
import { prepareRemitoModalPayload } from '../utils/remitoDataPreparation.js'
import { getAfipData, validateCuit } from '../apiUtils'
import Select from 'react-select'
import PurchaseInvoiceModal from './modals/PurchaseInvoiceModal/PurchaseInvoiceModal.jsx'
import SupplierAddressModal from './modals/SupplierAddressModal'
import RemitoModal from './modals/RemitoModal/RemitoModal.jsx'
import ReconciliationModal from './modals/ReconciliationModal.jsx'
import Visualizacion from './Supplierpanel/Visualizacion.jsx'
import SupplierGroupModal from './configcomponents/modals/SupplierGroupModal'
import PurchaseOrderModal from './modals/PurchaseOrderModal/PurchaseOrderModal.jsx'
import { normalizePurchaseOrderData } from './modals/PurchaseOrderModal/purchaseOrderModalUtils.js'
import {
  formatBalance,
  formatCurrencyValue,
  formatVoucherNumber,
  mapVoucherTypeToSigla,
  truncateDescription,
  formatDate,
  hasValue,
  extractAccountDescription,
  isInvoiceVoucherType,
  isPaymentVoucherType,
  isCreditVoucherType,
  isDebitVoucherType
} from './Supplierpanel/supplierUtils'
import {
  handleAddSupplier,
  handleEditSupplier as handleEditSupplierHandler,
  handleCancelEdit,
  handleSaveSupplier,
  handleDeleteSupplier,
  handleEditChange as handleEditChangeHandler,
  handleSearchAfip,
  handleCreateSupplier,
  handleSaveFiscalAddress,
  getFiscalAddress,
  addCompanyAbbrToSupplier
} from './Supplierpanel/supplierHandlers'

const SUPPLIER_BULK_TABS = ['unpaid', 'draft', 'receipts']

export default function SupplierPanel() {
  const [suppliers, setSuppliers] = useState([])
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [supplierDetails, setSupplierDetails] = useState(null)
  const [supplierAddresses, setSupplierAddresses] = useState([])
  const [allSupplierInvoices, setAllSupplierInvoices] = useState([]) // Todas las facturas
  const [supplierInvoices, setSupplierInvoices] = useState([]) // Facturas filtradas para mostrar
  const [unpaidInvoicesCount, setUnpaidInvoicesCount] = useState(0)
  const [draftInvoicesCount, setDraftInvoicesCount] = useState(0)
  const [supplierStatements, setSupplierStatements] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingSupplierDetails, setLoadingSupplierDetails] = useState(false)
  const [balancesLoaded, setBalancesLoaded] = useState(false) // Indica si los saldos fueron cargados
  const [loadingBalances, setLoadingBalances] = useState(false) // Indica si se están cargando los saldos
  const [isSupplierDetailsPanelExpanded, setIsSupplierDetailsPanelExpanded] = useState(false) // Panel de detalles plegado por defecto
  const [supplierDetailsLoaded, setSupplierDetailsLoaded] = useState(false) // Si los detalles del proveedor fueron cargados
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)
  const [isEditingSupplier, setIsEditingSupplier] = useState(false)
  const [editedSupplierData, setEditedSupplierData] = useState({})
  const [savingSupplier, setSavingSupplier] = useState(false)
  // Toggle para mostrar nombre comercial vs nombre fiscal en la lista
  const [showCommercialName, setShowCommercialName] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState(null)
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false)
  const [editingPurchaseOrder, setEditingPurchaseOrder] = useState(null)
  const resetBulkDeleteState = () => {
    setBulkDeleteState({
      active: false,
      context: null,
      selected: new Set()
    })
  }
  const [supplierPayments, setSupplierPayments] = useState([])
  const [editingPayment, setEditingPayment] = useState(null)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [pendingInvoices, setPendingInvoices] = useState([])
  const [supplierConciliations, setSupplierConciliations] = useState([])
  const [expandedConciliationRows, setExpandedConciliationRows] = useState({})
  const [hasMoreStatements, setHasMoreStatements] = useState(false)
  const [loadingMoreStatements, setLoadingMoreStatements] = useState(false)
  const [statementsPage, setStatementsPage] = useState(0)
  const [invoiceTab, setInvoiceTab] = useState('unpaid') // 'unpaid', 'draft', 'receipts', 'statement'
  const [supplierTab, setSupplierTab] = useState('general') // 'general', 'comercial', 'contacto', 'fiscal', 'direccion'
  const [invoiceSearchByTab, setInvoiceSearchByTab] = useState({})
  const invoiceSearchQuery = (invoiceSearchByTab?.[invoiceTab] || '').toString()
  const normalizedInvoiceSearchQuery = invoiceSearchQuery.trim().toLowerCase()
  const isInvoiceTableTab = invoiceTab === 'unpaid' || invoiceTab === 'draft'
  const purchaseInvoiceParentsForSearch = useMemo(() => {
    if (!isInvoiceTableTab) return []
    const list = Array.isArray(supplierInvoices) ? supplierInvoices : []
    const result = []
    const seen = new Set()
    for (const doc of list) {
      if (!doc || doc.doctype !== 'Purchase Invoice') continue
      const id = doc.erpnext_name || doc.name || doc.voucher_no
      if (!id) continue
      const key = String(id)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(key)
      if (result.length >= 500) break
    }
    return result
  }, [isInvoiceTableTab, supplierInvoices])
  const shouldSearchPurchaseInvoiceItems = useMemo(() => {
    if (!isInvoiceTableTab) return false
    if (!normalizedInvoiceSearchQuery || normalizedInvoiceSearchQuery.length < 3) return false
    if (/[a-zA-Z]/.test(normalizedInvoiceSearchQuery)) return true
    if (/-/.test(normalizedInvoiceSearchQuery) && normalizedInvoiceSearchQuery.length >= 3) return true
    // Avoid expensive "numeric-only" item searches unless query is long enough to be selective
    const digitsOnly = /^[0-9]+$/.test(normalizedInvoiceSearchQuery)
    return digitsOnly && normalizedInvoiceSearchQuery.length >= 5
  }, [isInvoiceTableTab, normalizedInvoiceSearchQuery])
  const [purchaseItemMatchedParents, setPurchaseItemMatchedParents] = useState(null)
  const [purchaseItemSearchLoading, setPurchaseItemSearchLoading] = useState(false)
  const [purchaseItemSearchError, setPurchaseItemSearchError] = useState(null)
  const purchaseItemSearchCacheRef = useRef(new Map())
  const purchaseItemSearchAbortRef = useRef(null)
  const purchaseSearchQueryRef = useRef(normalizedInvoiceSearchQuery)
  purchaseSearchQueryRef.current = normalizedInvoiceSearchQuery
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [paymentTermsTemplates, setPaymentTermsTemplates] = useState([])
  const [taxTemplates, setTaxTemplates] = useState([])
  const [supplierSearch, setSupplierSearch] = useState('')
  const [consultingAfip, setConsultingAfip] = useState(false)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const companyCurrency = (activeCompanyDetails?.default_currency || '').toString().trim().toUpperCase()
  const [bulkDeleteState, setBulkDeleteState] = useState({
    active: false,
    context: null,
    selected: new Set()
  })
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  // Estados para grupos de proveedores
  const [supplierGroups, setSupplierGroups] = useState([])
  const [loadingSupplierGroups, setLoadingSupplierGroups] = useState(false)
  const [allSupplierGroups, setAllSupplierGroups] = useState([])
  const [showSupplierGroupModal, setShowSupplierGroupModal] = useState(false)
  const [supplierGroupFormData, setSupplierGroupFormData] = useState({
    name: '',
    parent_group: '',
    account: '',
    payment_terms: '',
    is_group: 0
  })
  const [editingSupplierGroup, setEditingSupplierGroup] = useState(null)
  const [savingSupplierGroup, setSavingSupplierGroup] = useState(false)
  const [showSupplierGroupTestModal, setShowSupplierGroupTestModal] = useState(false)

  // Estados para listas de precios
  const [availablePriceLists, setAvailablePriceLists] = useState([])

  // Estados para modales de confirmación
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    onCancel: null,
    type: 'warning' // 'warning', 'danger', 'info'
  })

  // Estado para el modal de configuración de items
  const [itemSettingsModal, setItemSettingsModal] = useState({
    isOpen: false,
    item: null,
    itemIndex: null
  })

  // Estado para remitos
  const [isRemitoModalOpen, setIsRemitoModalOpen] = useState(false)
  const [isPurchaseOrderModalOpen, setIsPurchaseOrderModalOpen] = useState(false)

  // Estado para el selector de documentos

  // Estados para remitos
  const [supplierReceipts, setSupplierReceipts] = useState([])
  const [receiptsPagination, setReceiptsPagination] = useState({ page: 1, pageSize: 20, total: 0 })
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(false)
  const [supplierPurchaseOrders, setSupplierPurchaseOrders] = useState([])
  const [purchaseOrdersPagination, setPurchaseOrdersPagination] = useState({ page: 1, pageSize: 20, total: 0 })
  const [isLoadingPurchaseOrders, setIsLoadingPurchaseOrders] = useState(false)
  const [selectedRemito, setSelectedRemito] = useState(null)
  const [remitoDraftData, setRemitoDraftData] = useState(null)
  const [downloadingDocuments, setDownloadingDocuments] = useState({})

  // Estado para modal de conciliación
  const [isReconciliationModalOpen, setIsReconciliationModalOpen] = useState(false)

  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const { templates: taxTemplatesFromHook, sales: taxSales, purchase: taxPurchase, loading: taxTemplatesLoading, error: taxTemplatesError, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)

  // Sync hook data into local state for backward compatibility
  useEffect(() => {
    if (taxTemplatesFromHook && Array.isArray(taxTemplatesFromHook)) {
      setTaxTemplates(taxTemplatesFromHook)
    }
  }, [taxTemplatesFromHook])

  useEffect(() => {
    setPurchaseItemMatchedParents(null)
    setPurchaseItemSearchError(null)
    setPurchaseItemSearchLoading(false)
  }, [invoiceTab])

  useEffect(() => {
    if (!shouldSearchPurchaseInvoiceItems) {
      if (purchaseItemSearchAbortRef.current) {
        purchaseItemSearchAbortRef.current.abort()
        purchaseItemSearchAbortRef.current = null
      }
      setPurchaseItemMatchedParents(null)
      setPurchaseItemSearchError(null)
      setPurchaseItemSearchLoading(false)
      return
    }

    if (!purchaseInvoiceParentsForSearch.length) {
      setPurchaseItemMatchedParents(new Set())
      return
    }

    const parentsKey = purchaseInvoiceParentsForSearch.join('|')
    const cacheKey = `${parentsKey}::${normalizedInvoiceSearchQuery}`
    const cached = purchaseItemSearchCacheRef.current.get(cacheKey)
    if (cached) {
      setPurchaseItemMatchedParents(cached)
      setPurchaseItemSearchError(null)
      setPurchaseItemSearchLoading(false)
      return
    }

    const handle = setTimeout(async () => {
      if (purchaseSearchQueryRef.current !== normalizedInvoiceSearchQuery) return

      if (purchaseItemSearchAbortRef.current) {
        purchaseItemSearchAbortRef.current.abort()
      }
      const controller = new AbortController()
      purchaseItemSearchAbortRef.current = controller

      setPurchaseItemSearchLoading(true)
      setPurchaseItemSearchError(null)

      try {
        const response = await fetchWithAuth(API_ROUTES.documentItemsSearch, {
          method: 'POST',
          body: JSON.stringify({
            child_doctype: 'Purchase Invoice Item',
            parent_doctype: 'Purchase Invoice',
            parents: purchaseInvoiceParentsForSearch,
            query: normalizedInvoiceSearchQuery,
            limit: 2000
          }),
          signal: controller.signal
        })
        if (!response || typeof response.json !== 'function') {
          const maybeError = response?.error
          if (maybeError?.name === 'AbortError') return
          throw maybeError || new Error('Error de conexión')
        }
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || `Error HTTP ${response.status}`)
        }
        const parents = Array.isArray(payload.parents) ? payload.parents : []
        const nextSet = new Set(parents.map(String))
        purchaseItemSearchCacheRef.current.set(cacheKey, nextSet)
        setPurchaseItemMatchedParents(nextSet)
      } catch (error) {
        if (error?.name === 'AbortError') return
        console.error('[SupplierPanel] Purchase invoice item search error', error)
        setPurchaseItemSearchError(error?.message || 'Error buscando items')
        setPurchaseItemMatchedParents(null)
      } finally {
        setPurchaseItemSearchLoading(false)
      }
    }, 400)

    return () => clearTimeout(handle)
  }, [
    fetchWithAuth,
    normalizedInvoiceSearchQuery,
    purchaseInvoiceParentsForSearch,
    shouldSearchPurchaseInvoiceItems
  ])

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
      console.warn('[SupplierPanel] downloadDocumentPdf missing parameters or route')
      showNotification && showNotification('Falta configurar la descarga de PDFs', 'warning')
      return
    }

    const query = new URLSearchParams()
    if (suggestedFileName) {
      const safeName = suggestedFileName.toString().trim().replace(/\.pdf$/i, '')
      query.set('filename', `${safeName}.pdf`)
    }
    const pdfUrl = `${API_ROUTES.documentFormats.pdf(docType, docName)}${query.toString() ? `?${query.toString()}` : ''}`

    setDownloadingDocuments((prev) => ({ ...prev, [docName]: true }))
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
          /* ignore parse errors */
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
      showNotification && showNotification('PDF generado correctamente', 'success')
    } catch (error) {
      console.error('[SupplierPanel] Error generating PDF', error)
      showNotification && showNotification('No pudimos generar el PDF', 'error')
    } finally {
      setDownloadingDocuments((prev) => {
        const next = { ...prev }
        delete next[docName]
        return next
      })
    }
  }

  // Filtrar cuentas por tipo: Payable para cuentas por pagar, Expense para gastos
  const availableExpenseAccounts = availableAccounts.filter(account => {
    if (account.is_group) return false
    const accountType = (account.account_type || '').toString().trim().toLowerCase()
    if (accountType === 'cost of goods sold') return false
    return account.root_type === 'Expense' || account.account_type === 'Stock'
  })
  const availableLiabilityAccounts = availableAccounts.filter(account => account.root_type === 'Liability' && !account.is_group)

  // Ref para saber si es el primer render
  const isFirstRender = useRef(true)

  // Cargar proveedores al montar el componente (solo nombres, sin saldos)
  useEffect(() => {
    fetchSuppliers()
    // Removido: fetchSupplierGroups() - se carga solo cuando sea necesario
    fetchAvailableAccounts() // Agregar carga inicial de cuentas
    // Removido: fetchPaymentTermsTemplates(), fetchTaxTemplates(), fetchPriceLists()
    if (activeCompany) {
      fetchActiveCompanyDetails(activeCompany)
      // Removido: fetchAvailableAccounts()
    }
  }, [])

  // Refrescar datos cuando cambie la empresa activa (NO en el primer render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (activeCompany) {
      fetchSuppliers()
      fetchActiveCompanyDetails(activeCompany)
      // Removido: fetchAvailableAccounts()
      setSelectedSupplier(null)
      setSupplierDetails(null)
      setSupplierInvoices([])
      setSupplierStatements([])
      setSupplierAddresses([])
      setSupplierReceipts([])
      setReceiptsPagination({ page: 1, pageSize: 20, total: 0 })
      setSupplierPurchaseOrders([])
      setPurchaseOrdersPagination({ page: 1, pageSize: 20, total: 0 })
    }
  }, [activeCompany])

  // Cargar detalles cuando se selecciona un proveedor
  useEffect(() => {
    if (selectedSupplier && selectedSupplier !== 'new') {
      // Limpiar datos anteriores antes de cargar nuevos
      setAllSupplierInvoices([])
      setSupplierInvoices([])
      setPendingInvoices([])
      setSupplierConciliations([])
      setSupplierStatements([])
      setSupplierAddresses([])
      setSupplierReceipts([])
      setReceiptsPagination({ page: 1, pageSize: 20, total: 0 })
      setSelectedRemito(null)
      setRemitoDraftData(null)
      setSupplierPurchaseOrders([])
      setPurchaseOrdersPagination({ page: 1, pageSize: 20, total: 0 })
      setSupplierDetailsLoaded(false) // Resetear estado de detalles cargados

      // NO cargar detalles automáticamente - se cargarán cuando se expanda el panel
      // fetchSupplierDetails(selectedSupplier)
      fetchSupplierInvoices(selectedSupplier)
      fetchSupplierStatements(selectedSupplier)
      fetchSupplierAddresses(selectedSupplier)
      fetchSupplierReceipts(selectedSupplier, 1)
      fetchSupplierPurchaseOrders(selectedSupplier, 1)
    } else {
      setSupplierDetails(null)
      setSupplierDetailsLoaded(false)
      setAllSupplierInvoices([])
      setSupplierInvoices([])
      setPendingInvoices([])
      setSupplierConciliations([])
      setSupplierStatements([])
      setSupplierAddresses([])
      setSupplierReceipts([])
      setReceiptsPagination({ page: 1, pageSize: 20, total: 0 })
      setSelectedRemito(null)
      setRemitoDraftData(null)
      setSupplierPurchaseOrders([])
      setPurchaseOrdersPagination({ page: 1, pageSize: 20, total: 0 })
    }
  }, [selectedSupplier])

  // Refrescar facturas cuando cambie la pestaña o cuando se carguen nuevas facturas
  useEffect(() => {
    if (invoiceTab === 'unpaid' || invoiceTab === 'draft') {
      filterInvoicesByTab(allSupplierInvoices, invoiceTab)
    }
  }, [invoiceTab, allSupplierInvoices, pendingInvoices])

  useEffect(() => {
    resetBulkDeleteState()
  }, [selectedSupplier])

  useEffect(() => {
    setExpandedConciliationRows({})
  }, [supplierConciliations])

  useEffect(() => {
    if (!SUPPLIER_BULK_TABS.includes(invoiceTab)) {
      if (bulkDeleteState.active) {
        resetBulkDeleteState()
      }
      return
    }
    if (bulkDeleteState.active && bulkDeleteState.context !== invoiceTab) {
      resetBulkDeleteState()
    }
  }, [invoiceTab, bulkDeleteState])

  const fetchSuppliers = async () => {
    try {
      setLoading(true)
      setBalancesLoaded(false) // Resetear estado de saldos cargados
      // Usar endpoint optimizado que solo trae nombres
      const response = await fetchWithAuth('/api/suppliers/names')
      if (response.ok) {
        const data = await response.json()
        // Inicializar proveedores con outstanding_amount = null (no cargado)
        const suppliersWithBalances = (data.suppliers || []).map(supplier => ({
          ...supplier,
          outstanding_amount: null // null indica que no se ha cargado el saldo
        }))
        setSuppliers(suppliersWithBalances)
        // NO cargar saldos automáticamente - se cargarán bajo demanda
        // setTimeout(() => loadVisibleSupplierBalances(suppliersWithBalances), 100)
      } else {
        showNotification('Error al cargar proveedores', 'error')
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error)
      showNotification('Error al cargar proveedores', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchSupplierBalances = async (supplierNames) => {
    if (!supplierNames || supplierNames.length === 0) return

    try {
      // Agregar siglas de compañía a los nombres de proveedores antes de enviar al backend
      const companyAbbr = activeCompanyDetails?.abbr || null
      const supplierNamesWithAbbr = await Promise.all(
        supplierNames.map(name => addCompanyAbbrToSupplier(name, fetchWithAuth, companyAbbr))
      )

      const response = await fetchWithAuth('/api/suppliers/balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_names: supplierNamesWithAbbr })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.balances) {
          // Actualizar los proveedores con los saldos calculados
          // Build a robust match so we find balances whether backend returned
          // a plain supplier name or the name with the company abbreviation
          // appended (e.g. "FERREMUNDO SRL - ANC"). We try exact match first,
          // then match by prefix + ' - '. This avoids async calls and is resilient
          // against supplier names that may include hyphens elsewhere.
          setSuppliers(prevSuppliers =>
            prevSuppliers.map(supplier => {
              const balanceData = data.balances.find(b => {
                if (!b || !b.name) return false
                // Exact match
                if (b.name === supplier.name) return true
                // Matches when backend returned "NAME - ABBR" and supplier.name is "NAME"
                if (b.name.startsWith(`${supplier.name} - `)) return true
                // Also try stripping a trailing " - <token>" from b.name and compare
                const idx = b.name.lastIndexOf(' - ')
                if (idx > 0 && b.name.substring(0, idx) === supplier.name) return true
                return false
              })
              return balanceData ? { ...supplier, outstanding_amount: balanceData.outstanding_amount } : supplier
            })
          )
        }
      }
    } catch (error) {
      console.error('Error fetching supplier balances:', error)
    }
  }

  // Cargar saldos de proveedores visibles (lazy loading) - BAJO DEMANDA
  const loadVisibleSupplierBalances = async (currentSuppliers = suppliers) => {
    const visibleSuppliers = currentSuppliers.slice(0, 50) // Cargar saldos de los primeros 50 proveedores
    const supplierNamesToLoad = visibleSuppliers
      .filter(supplier => supplier.outstanding_amount === null) // Solo cargar si no tiene saldo cargado
      .map(supplier => supplier.name)

    if (supplierNamesToLoad.length > 0) {
      console.log('Cargando saldos para proveedores:', supplierNamesToLoad.length)
      await fetchSupplierBalances(supplierNamesToLoad)
    }
  }

  // Función para cargar saldos bajo demanda (botón en la UI)
  const fetchSupplierBalancesOnDemand = async () => {
    if (loadingBalances || balancesLoaded) return
    setLoadingBalances(true)
    try {
      await loadVisibleSupplierBalances(suppliers)
      setBalancesLoaded(true)
    } finally {
      setLoadingBalances(false)
    }
  }

  // Callback para cargar detalles del proveedor cuando se expande el panel
  const loadSupplierDetailsOnExpand = React.useCallback(async () => {
    if (!selectedSupplier || selectedSupplier === 'new' || supplierDetailsLoaded || loadingSupplierDetails) return
    await fetchSupplierDetails(selectedSupplier)
    setSupplierDetailsLoaded(true)
  }, [selectedSupplier, supplierDetailsLoaded, loadingSupplierDetails])

  // Cargar datos adicionales solo cuando sean necesarios (lazy loading)
  const loadAdditionalData = async () => {
    // Cargar grupos, templates y cuentas solo cuando se necesiten
    if (supplierGroups.length === 0) {
      await fetchSupplierGroups()
    }
    if (paymentTermsTemplates.length === 0) {
      await fetchPaymentTermsTemplates()
    }
    if (taxTemplates.length === 0) {
      // ensure hook has loaded or trigger refresh
      await refreshTaxTemplates()
    }
    if (availablePriceLists.length === 0) {
      await fetchPriceLists()
    }
    if (availableAccounts.length === 0) {
      await fetchAvailableAccounts()
    }
  }

  const fetchAvailableAccounts = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.accounts)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAvailableAccounts(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
  }

  const fetchPaymentTermsTemplates = async () => {
    try {
      const response = await fetchWithAuth('/api/payment-terms-templates')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setPaymentTermsTemplates(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching payment terms:', error)
    }
  }

  const fetchTaxTemplates = async () => {
    // handled via useTaxTemplates hook
  }

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

  const fetchSupplierGroups = async () => {
    setLoadingSupplierGroups(true)
    try {
      const requestGroups = async () => {
        const response = await fetchWithAuth(API_ROUTES.supplierGroups)
        console.log('Respuesta de supplier groups:', response.status)
        if (!response.ok) {
          console.error('Error HTTP cargando supplier groups:', response.status)
          return []
        }

        const data = await response.json()
        console.log('Datos de supplier groups:', data)
        if (!data.success) {
          console.error('Error en datos de supplier groups:', data.message)
          return []
        }

        return data.data || []
      }

      let groups = await requestGroups()

      if (groups.length === 0) {
        console.log('No hay grupos, creando grupos por defecto...')
        await createDefaultSupplierGroups()
        groups = await requestGroups()
      }

      const leafGroups = groups.filter(group => group.is_group === 0)
      setSupplierGroups(leafGroups)
      setAllSupplierGroups(groups)
      console.log('Grupos de proveedores filtrados (solo hojas):', leafGroups.length)
      return groups
    } catch (error) {
      console.error('Error fetching supplier groups:', error)
      setSupplierGroups([])
      setAllSupplierGroups([])
      return []
    } finally {
      setLoadingSupplierGroups(false)
    }
  }

  const fetchPriceLists = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.purchasePriceLists)
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

  const createDefaultSupplierGroups = async () => {
    try {
      console.log('Creando grupo padre All Supplier Groups...')
      const parentResponse = await fetchWithAuth(API_ROUTES.supplierGroups, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            supplier_group_name: 'All Supplier Groups',
            is_group: 1
          }
        })
      })
      
      if (parentResponse.ok) {
        console.log('Grupo padre creado, creando grupo hijo...')
        const childResponse = await fetchWithAuth(API_ROUTES.supplierGroups, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: {
              supplier_group_name: 'Proveedores Generales',
              parent_supplier_group: 'All Supplier Groups',
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

  const getDefaultSupplierParent = (groupsList) => {
    if (!groupsList || groupsList.length === 0) return ''
    const parentGroup = groupsList.find(group => group.is_group === 1)
    return parentGroup?.name || groupsList[0]?.name || ''
  }

  const prepareSupplierGroupModal = async (group = null) => {
    try {
      const groups = allSupplierGroups.length > 0 ? allSupplierGroups : await fetchSupplierGroups()

      if (paymentTermsTemplates.length === 0) {
        await fetchPaymentTermsTemplates()
      }

      if (availableAccounts.length === 0) {
        await fetchAvailableAccounts()
      }

      const defaultParent = group
        ? group.parent_supplier_group || group.old_parent || getDefaultSupplierParent(groups)
        : getDefaultSupplierParent(groups)

      setSupplierGroupFormData({
        name: group?.supplier_group_name || group?.name || '',
        parent_group:
          group?.is_group === 1
            ? defaultParent
            : group?.parent_supplier_group || group?.old_parent || defaultParent,
        account: group?.accounts?.[0]?.account || group?.account || '',
        payment_terms: group?.payment_terms || '',
        is_group: group?.is_group || 0
      })
    } catch (error) {
      console.error('Error preparando el modal de grupos de proveedores:', error)
      showNotification('No se pudo preparar el formulario de grupos de proveedores', 'error')
      throw error
    }
  }

  const handleOpenSupplierGroupModal = async (group = null) => {
    try {
      setEditingSupplierGroup(group)
      await prepareSupplierGroupModal(group)
      setShowSupplierGroupModal(true)
    } catch (error) {
      console.error('No se pudo abrir el modal de grupos de proveedores:', error)
    }
  }

  const handleOpenSupplierGroupTestModal = async () => {
    try {
      setEditingSupplierGroup(null)
      await prepareSupplierGroupModal(null)
      setShowSupplierGroupTestModal(true)
    } catch (error) {
      console.error('No se pudo abrir el modal de prueba de grupos de proveedores:', error)
    }
  }

  const handleCloseSupplierGroupModal = () => {
    setShowSupplierGroupModal(false)
    setShowSupplierGroupTestModal(false)
    setSupplierGroupFormData({
      name: '',
      parent_group: getDefaultSupplierParent(allSupplierGroups),
      account: '',
      payment_terms: '',
      is_group: 0
    })
    setEditingSupplierGroup(null)
  }

  const handleSaveSupplierGroup = async () => {
    if (!supplierGroupFormData.name.trim()) {
      showNotification('El nombre del grupo es obligatorio', 'error')
      return
    }

    setSavingSupplierGroup(true)

    try {
      const url = editingSupplierGroup
        ? `/api/resource/Supplier Group/${encodeURIComponent(editingSupplierGroup.name)}`
        : '/api/resource/Supplier Group'
      const method = editingSupplierGroup ? 'PUT' : 'POST'

      const payload = {
        supplier_group_name: supplierGroupFormData.name,
        parent_supplier_group: supplierGroupFormData.is_group === 1 ? null : (supplierGroupFormData.parent_group || null),
        payment_terms: supplierGroupFormData.payment_terms || null,
        is_group: supplierGroupFormData.is_group || 0,
        accounts: supplierGroupFormData.account
          ? [{
              account: supplierGroupFormData.account,
              company: activeCompanyDetails?.name,
              parent: editingSupplierGroup ? editingSupplierGroup.name : supplierGroupFormData.name,
              parentfield: 'accounts',
              parenttype: 'Supplier Group',
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
          editingSupplierGroup ? 'Grupo de proveedores actualizado exitosamente' : 'Grupo de proveedores creado exitosamente',
          'success'
        )
        await fetchSupplierGroups()
        if (!editingSupplierGroup) {
          setEditedSupplierData(prev => ({
            ...prev,
            supplier_group: supplierGroupFormData.name || prev.supplier_group
          }))
        }
        handleCloseSupplierGroupModal()
      } else {
        showNotification(data.message || 'Error al guardar grupo', 'error')
      }
    } catch (error) {
      console.error('Error guardando grupo de proveedores:', error)
      showNotification('Error al guardar grupo', 'error')
    } finally {
      setSavingSupplierGroup(false)
    }
  }

  const fetchSupplierGroupDetails = async (groupName) => {
    try {
      const response = await fetchWithAuth(`/api/resource/Supplier%20Group/${encodeURIComponent(groupName)}`)
      if (response.ok) {
        const result = await response.json()
        return result.data
      }
    } catch (error) {
      console.error('Error fetching supplier group details:', error)
    }
    return null
  }

  const handleEditChange = async (field, value) => {
    const setters = {
      setEditedSupplierData,
      editedSupplierData,
      availableLiabilityAccounts,
      availableExpenseAccounts
    }
    await handleEditChangeHandler(field, value, setters, fetchSupplierGroupDetails, activeCompanyDetails)
  }

  const fetchSupplierDetails = async (supplierName) => {
    try {
      setLoadingSupplierDetails(true)
      // Agregar abreviatura de compañía al supplierName antes de consultar
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)
      const response = await fetchWithAuth(`/api/suppliers/${supplierNameWithAbbr}`)
      if (response.ok) {
        const data = await response.json()
        const supplierData = data.supplier
        // Extraer cuenta por pagar de accounts para la compañía activa
        supplierData.default_payable_account = supplierData.accounts?.find(acc => acc.company === activeCompany)?.account || ''
        setSupplierDetails(supplierData)
        setSupplierDetailsLoaded(true)
      }
    } catch (error) {
      console.error('Error fetching supplier details:', error)
    } finally {
      setLoadingSupplierDetails(false)
    }
  }

  const fetchSupplierInvoices = async (supplierName) => {
    try {
      // Agregar abreviatura de compañía al supplierName antes de consultar
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)
      const response = await fetchWithAuth(`/api/suppliers/${supplierNameWithAbbr}/invoices`)
      if (response.ok) {
        const data = await response.json()
        // Filtrar facturas canceladas (docstatus = 2)
        const filteredInvoices = (data.invoices || []).filter(invoice => invoice.docstatus !== 2)
        setAllSupplierInvoices(filteredInvoices)
        updateInvoiceCounts(filteredInvoices)
      }
    } catch (error) {
      console.error('Error fetching supplier invoices:', error)
    }
  }

  // page should be 1-based (ERPNext pagination). Use default page=1 to avoid negative offset in backend.
  const fetchSupplierStatements = async (supplierName, page = 1, append = false) => {
    try {
      if (!append) {
        setLoadingSupplierDetails(true)
        setStatementsPage(0)
      } else {
        setLoadingMoreStatements(true)
      }

      // Agregar abreviatura de compañía al supplierName antes de consultar
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)
      const response = await fetchWithAuth(`/api/suppliers/${supplierNameWithAbbr}/statements?page=${page}`)
      if (response.ok) {
        const data = await response.json()
        const movements = data.data || data.statements || []
        if (append) {
          setSupplierStatements(prev => [...prev, ...movements])
        } else {
          setSupplierStatements(movements)
        }
        setStatementsPage(page)
        const pendingDocs = (data.pending_invoices || []).map(doc => ({
          ...doc,
          erpnext_name: doc.name,
          itemType: doc.doctype === 'Payment Entry' ? 'payment' : 'invoice'
        }))
        setPendingInvoices(pendingDocs)
        updateInvoiceCounts(allSupplierInvoices, pendingDocs)
        setSupplierConciliations(data.conciliations || [])
        const hasMoreFlag = data.has_more ?? data.pagination?.has_more ?? false
        setHasMoreStatements(Boolean(hasMoreFlag))
      }
    } catch (error) {
      console.error('Error fetching supplier statements:', error)
    } finally {
      if (!append) {
        setLoadingSupplierDetails(false)
      } else {
        setLoadingMoreStatements(false)
      }
    }
  }

  const fetchSupplierReceipts = async (supplierName, page = 1) => {
    try {
      setIsLoadingReceipts(true)
      // Agregar abreviatura de compañía al supplierName antes de consultar
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)
      const response = await fetchWithAuth(API_ROUTES.supplierPurchaseReceipts(supplierNameWithAbbr, page, receiptsPagination.pageSize))
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setSupplierReceipts(data.receipts || [])
          setReceiptsPagination({
            page: data.page,
            pageSize: data.page_size,
            total: data.total_count
          })
        } else {
          showNotification(data.message || 'Error al cargar remitos', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al cargar remitos', 'error')
      }
    } catch (error) {
      console.error('Error fetching supplier receipts:', error)
      showNotification('Error al cargar remito', 'error')
    } finally {
      setIsLoadingReceipts(false)
    }
  }

  const handleRemitoPageChange = async (newPage) => {
    setReceiptsPagination(prev => ({ ...prev, page: newPage }))
    if (selectedSupplier) {
      await fetchSupplierReceipts(selectedSupplier, newPage)
    }
  }

  const handlePurchaseOrdersPageChange = async (newPage) => {
    setPurchaseOrdersPagination(prev => ({ ...prev, page: newPage }))
    if (selectedSupplier) {
      await fetchSupplierPurchaseOrders(selectedSupplier, newPage)
    }
  }

  const fetchSupplierPurchaseOrders = async (supplierName, page = 1) => {
    try {
      setIsLoadingPurchaseOrders(true)
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)
      const apiUrl = API_ROUTES.supplierPurchaseOrders(
        supplierNameWithAbbr,
        page,
        purchaseOrdersPagination.pageSize,
        activeCompany
      )
      const response = await fetchWithAuth(apiUrl)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setSupplierPurchaseOrders(data.purchase_orders || [])
          setPurchaseOrdersPagination({
            page: data.page,
            pageSize: data.page_size,
            total: data.total_count
          })
        } else {
          showNotification(data.message || 'Error al cargar órdenes de compra', 'error')
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'Error al cargar órdenes de compra', 'error')
      }
    } catch (error) {
      console.error('Error fetching supplier purchase orders:', error)
      showNotification('Error al cargar ordenes de compra', 'error')
    } finally {
      setIsLoadingPurchaseOrders(false)
    }
  }

  const handlePurchaseOrderSaved = async () => {
    if (selectedSupplier) {
      await fetchSupplierPurchaseOrders(selectedSupplier, 1)
    }
  }

  const openRemitoForEdit = async (remitoName) => {

    console.log('🟡 [SupplierPanel] Abriendo remito para edición:', remitoName)

    try {

      const payload = await prepareRemitoModalPayload(remitoName, fetchWithAuth)

      console.log('🟢 [SupplierPanel] Datos de remito preparados:', payload.summary)

      setRemitoDraftData(payload)

      setSelectedRemito(payload.name)

      console.log('🟣 [SupplierPanel] Remito listo, abriendo modal Remito en modo edición')

      setIsRemitoModalOpen(true)

    } catch (error) {

      console.error('Error opening remito for edit:', error)

      showNotification(error.message || 'Error al cargar remito', 'error')

      setSelectedRemito(null)

    }

  }



  const handleOpenRemitoCreation = () => {

    setSelectedRemito(null)

    setRemitoDraftData(null)

    setIsRemitoModalOpen(true)

  }

  const openPurchaseOrderForEdit = async (purchaseOrder) => {
    console.log('🟡 [SupplierPanel] Abriendo orden de compra para edición:', purchaseOrder.name)

    try {
      // Obtener datos completos de la orden de compra
      const response = await fetchWithAuth(`/api/purchase-orders/${purchaseOrder.name}`)
      if (!response.ok) {
        throw new Error('Error al obtener datos de la orden de compra')
      }
      const result = await response.json()
      const orderData = result.data

      console.log('🟢 [SupplierPanel] Datos de orden de compra obtenidos:', orderData)

      // Pasar los datos al modal
      setEditingPurchaseOrder(orderData)
      setIsPurchaseOrderModalOpen(true)
    } catch (error) {
      console.error('Error opening purchase order for edit:', error)
      showNotification(error.message || 'Error al abrir orden de compra', 'error')
    }
  }

  const handleOpenPurchaseOrderCreation = () => {
    if (!selectedSupplier || selectedSupplier === 'new') {
      showNotification('Selecciona un proveedor antes de crear una orden de compra', 'warning')
      return
    }
    setIsPurchaseOrderModalOpen(true)
  }




  const buildSupplierBulkPayload = (context, documentNames) => {
    if (!context || !Array.isArray(documentNames)) return []
    const source = context === 'receipts' ? supplierReceipts : supplierInvoices
    return documentNames.map(name => {
      const match = source.find(doc => doc.name === name)
      if (match) {
        const payload = { name: match.name }
        if (typeof match.docstatus === 'number') {
          payload.docstatus = match.docstatus
        }
        return payload
      }
      return { name }
    })
  }

  const handleBulkRowToggle = (documentName, checked) => {
    setBulkDeleteState(prev => {
      if (!prev.active) return prev
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
    if (!Array.isArray(documents) || documents.length === 0) return
    setBulkDeleteState(prev => {
      if (!prev.active || prev.context !== context) return prev
      const nextSelection = new Set(prev.selected)
      documents.forEach(doc => {
        const docName = doc?.name
        if (!docName) return
        if (checked) {
          nextSelection.add(docName)
        } else {
          nextSelection.delete(docName)
        }
      })
      return {
        ...prev,
        selected: nextSelection
      }
    })
  }

  const executeSupplierBulkDelete = async () => {
    if (!selectedSupplier) {
      showNotification('Selecciona un proveedor antes de eliminar documentos', 'warning')
      return
    }

    const context = bulkDeleteState.context
    if (!context) {
      resetBulkDeleteState()
      return
    }

    const selectedDocuments = Array.from(bulkDeleteState.selected)
    if (selectedDocuments.length === 0) {
      resetBulkDeleteState()
      return
    }

    const payload = buildSupplierBulkPayload(context, selectedDocuments).filter(Boolean)
    if (payload.length === 0) {
      showNotification('No hay documentos válidos para eliminar', 'warning')
      resetBulkDeleteState()
      return
    }

    const endpoint = context === 'receipts' ? API_ROUTES.bulkRemitosRemoval : API_ROUTES.bulkPurchaseInvoicesRemoval
    const bodyKey = context === 'receipts' ? 'remitos' : 'invoices'

    setIsBulkDeleting(true)
    try {
      const response = await fetchWithAuth(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ [bodyKey]: payload })
      })

      let data = {}
      try {
        data = await response.json()
      } catch (jsonError) {
        console.error('Error parsing bulk removal response:', jsonError)
      }

      if (!response.ok || data.success === false) {
        showNotification(data.message || 'Error al eliminar documentos seleccionados', 'error')
        return
      }

      showNotification(data.message || 'Documentos procesados correctamente', 'success')

      if (context === 'receipts') {
        await fetchSupplierReceipts(selectedSupplier, receiptsPagination.page)
        await fetchSupplierPurchaseOrders(selectedSupplier, purchaseOrdersPagination.page)
      } else {
        await fetchSupplierInvoices(selectedSupplier)
      }
    } catch (error) {
      console.error('Error eliminando documentos de proveedor:', error)
      showNotification('Error eliminando documentos seleccionados', 'error')
    } finally {
      setIsBulkDeleting(false)
      resetBulkDeleteState()
    }
  }

  const handleBulkDeleteToggle = async () => {
    if (!SUPPLIER_BULK_TABS.includes(invoiceTab) || isBulkDeleting) {
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

    await executeSupplierBulkDelete()
  }

  const parseNumericValue = (value) => {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const getDocumentDisplayName = (doc) => doc?.erpnext_name || doc?.name || ''

  const buildPendingDocumentList = (invoices = [], pendingDocs = pendingInvoices) => {
    const normalizedPending = []
    const seenNames = new Set()

    ;(pendingDocs || []).forEach((doc) => {
      const name = getDocumentDisplayName(doc)
      if (!name) return
      const outstandingValue = getDocumentOutstandingValue(doc)
      if (Math.abs(outstandingValue) <= 0.01) return
      normalizedPending.push({
        ...doc,
        name,
        outstanding_amount: outstandingValue,
        grand_total: doc.grand_total ?? doc.amount ?? doc.paid_amount ?? 0
      })
      seenNames.add(name)
    })

    const fallbackInvoices = (invoices || []).filter((invoice) => {
      if (!invoice?.name) return false
      if (seenNames.has(invoice.name)) return false
      const outstanding = parseNumericValue(invoice.outstanding_amount)
      return invoice.docstatus === 1 && invoice.status !== 'Draft' && Math.abs(outstanding) > 0.01
    })

    return [...normalizedPending, ...fallbackInvoices]
  }

  const filterInvoicesByTab = (invoices, tab) => {
    let filtered = []
    if (tab === 'unpaid') {
      filtered = buildPendingDocumentList(invoices)
    } else if (tab === 'draft') {
      // Solo borradores
      filtered = invoices.filter(invoice => invoice.docstatus === 0 || invoice.status === 'Draft')
    }
    setSupplierInvoices(filtered)
  }

  const filterSuppliers = (suppliers, searchTerm) => {
    if (!searchTerm) return suppliers
    return suppliers.filter(supplier =>
      (supplier.supplier_name || supplier.name).toLowerCase().includes(searchTerm.toLowerCase())
    )
  }

  const updateInvoiceCounts = (invoices, pendingDocs = pendingInvoices) => {
    const unpaidDocs = buildPendingDocumentList(invoices, pendingDocs)
    const draft = invoices.filter(invoice => invoice.docstatus === 0 || invoice.status === 'Draft').length
    setUnpaidInvoicesCount(unpaidDocs.length)
    setDraftInvoicesCount(draft)
  }

  const fetchSupplierAddresses = async (supplierName) => {
    try {
      // Agregar abreviatura de compañía al supplierName antes de consultar
      const supplierNameWithAbbr = await addCompanyAbbrToSupplier(supplierName, fetchWithAuth)
      const response = await fetchWithAuth(`/api/suppliers/${supplierNameWithAbbr}/addresses`)
      if (response.ok) {
        const data = await response.json()
        setSupplierAddresses(data.addresses || [])
      }
    } catch (error) {
      console.error('Error fetching supplier addresses:', error)
    }
  }

  const handleCreateInvoice = async (invoiceData) => {
    // Cargar datos adicionales necesarios para crear factura (lazy loading)
    await loadAdditionalData()

    try {
      setSavingSupplier(true)
      const response = await fetchWithAuth('/api/purchase-invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invoiceData),
      })

      if (response.ok) {
        const data = await response.json()
        showNotification('Factura creada exitosamente', 'success')
        setIsInvoiceModalOpen(false)
        // Refrescar facturas del proveedor
        if (selectedSupplier) {
          fetchSupplierInvoices(selectedSupplier)
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al crear la factura', 'error')
      }
    } catch (error) {
      console.error('Error creating invoice:', error)
      showNotification('Error al crear la factura', 'error')
    } finally {
      setSavingSupplier(false)
    }
  }

  const handleCreateRemito = async (remitoData) => {
    try {
      setSavingSupplier(true)
      const response = await fetchWithAuth(API_ROUTES.remitos, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(remitoData),
      })

      if (response.ok) {
        const data = await response.json()
        showNotification('Remito creado exitosamente', 'success')
        setIsRemitoModalOpen(false)
        // Refrescar la lista de remitos después de crear uno nuevo
        if (selectedSupplier) {
          await fetchSupplierReceipts(selectedSupplier, receiptsPagination.page)
          await fetchSupplierPurchaseOrders(selectedSupplier, purchaseOrdersPagination.page)
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al crear el remito', 'error')
      }
    } catch (error) {
      console.error('Error creating remito:', error)
      showNotification('Error al crear el remito', 'error')
    } finally {
      setSavingSupplier(false)
    }
  }

  const handleInvoiceDeleted = async () => {
    console.log('🔄 Refrescando datos después de eliminar factura')
    
    try {
      // Refrescar facturas del proveedor
      if (selectedSupplier) {
        console.log('📄 Refrescando facturas del proveedor:', selectedSupplier)
        await fetchSupplierInvoices(selectedSupplier)
      }
      
      // Refrescar movimientos/cuenta corriente del proveedor
      if (selectedSupplier) {
        console.log('📊 Refrescando movimientos del proveedor:', selectedSupplier)
        await fetchSupplierStatements(selectedSupplier)
      }
      
      // Refrescar lista de proveedores con saldos actualizados
      console.log('👥 Refrescando lista de proveedores con saldos')
      await fetchSuppliers()
      
      console.log('✅ Todos los datos refrescados después de eliminar factura')
    } catch (error) {
      console.error('❌ Error refrescando datos después de eliminar factura:', error)
    }
  }

  const handleEditSupplierLocal = async () => {
    // Si los detalles no están cargados, cargarlos primero
    if (!supplierDetailsLoaded && selectedSupplier && selectedSupplier !== 'new') {
      await fetchSupplierDetails(selectedSupplier)
    }
    
    if (!supplierDetails) return

    // Expandir el panel de detalles al editar
    setIsSupplierDetailsPanelExpanded(true)

    // Cargar datos adicionales necesarios para editar (lazy loading)
    await loadAdditionalData()

    await handleEditSupplierHandler(
      supplierDetails,
      supplierAddresses,
      { setIsEditingSupplier, setEditedSupplierData },
      activeCompanyDetails,
      fetchSupplierGroupDetails,
      availableExpenseAccounts,
      supplierGroups
    )
  }

  const handleDeleteInvoice = async (invoiceName) => {
    if (!invoiceName) return

    showConfirmModal(
      'Eliminar Factura',
      `¿Estás seguro de que quieres eliminar la factura "${invoiceName}"? Esta acción no se puede deshacer.`,
      async () => {
        try {
          const response = await fetchWithAuth(`/api/invoices/${invoiceName}`, {
            method: 'DELETE',
          })

          if (response.ok) {
            showNotification('Factura eliminada exitosamente', 'success')
            // Refrescar facturas del proveedor
            if (selectedSupplier) {
              fetchSupplierInvoices(selectedSupplier)
            }
          } else {
            const errorData = await response.json()
            showNotification(errorData.message || 'Error al eliminar la factura', 'error')
          }
        } catch (error) {
          console.error('Error deleting invoice:', error)
          showNotification('Error al eliminar la factura', 'error')
        }
      },
      null,
      'danger'
    )
  }

  const handleOpenPayment = async (paymentName) => {
    try {
      const response = await fetchWithAuth(`/api/pagos/${paymentName}`)
      if (response.ok) {
        const result = await response.json()
        // Para editar pago, pasar el data al PaymentModal
        // Pero PaymentModal espera editingData con el name, etc.
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

  const handleSupplierPaymentSaved = async () => {
    try {
      if (selectedSupplier) {
        await Promise.all([
          fetchSupplierInvoices(selectedSupplier),
          fetchSupplierStatements(selectedSupplier)
        ])
      }
      await fetchSuppliers()
    } catch (error) {
      console.error('Error refreshing data after supplier payment:', error)
    }
  }

  const handleOpenInvoice = async (invoiceName) => {
    try {
      const response = await fetchWithAuth(`/api/purchase-invoices/${invoiceName}`)
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

  const loadMoreStatements = async () => {
    if (selectedSupplier && hasMoreStatements && !loadingMoreStatements) {
      await fetchSupplierStatements(selectedSupplier, statementsPage + 1, true)
    }
  }

  const handleCloseAddressModal = () => {
    setIsAddressModalOpen(false)
    // Recargar direcciones después de cerrar el modal
    if (selectedSupplier) {
      fetchSupplierAddresses(selectedSupplier)
    }
  }

  const openStatementEntry = async (voucherNo, voucherType) => {
    try {
      console.log('[SupplierPanel] openStatementEntry', voucherNo, voucherType)
      if (!voucherNo) return

      if (isPaymentVoucherType(voucherType)) {
        // Try to find payment locally
        const foundPayment = supplierPayments.find(p => p.name === voucherNo || p.name?.includes(voucherNo) || p.payment_entry?.includes?.(voucherNo))
        console.log('[SupplierPanel] payment found locally:', foundPayment?.name)
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
        const found = allSupplierInvoices.find(inv => inv.name === voucherNo || inv.name?.includes(voucherNo) || inv.invoice_number === voucherNo)
        console.log('[SupplierPanel] invoice found locally:', found?.name)
        if (found) {
          await handleOpenInvoice(found.name)
          return
        }
        const pendingFound = pendingInvoices.find(inv => inv.name === voucherNo || inv.name?.includes(voucherNo) || inv.invoice_number === voucherNo)
        console.log('[SupplierPanel] invoice found in pending:', pendingFound?.name)
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
      console.error('[SupplierPanel] error opening statement entry:', err)
    }
  }

  const formatInvoiceNumber = (invoiceName) => {
    if (invoiceName && invoiceName.length > 5 && /^\d{5}$/.test(invoiceName.slice(-5))) {
      return invoiceName.slice(0, -5);
    }
    return invoiceName;
  }

  // Función para truncar el número de comprobante según el nuevo formato
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

  const toggleConciliationRow = (groupId) => {
    if (!groupId) return
    setExpandedConciliationRows(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }



  const preferAmount = (source = {}, keys = []) => {
    for (const key of keys) {
      const value = source[key]
      if (value === undefined || value === null || value === '') continue
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
    return 0
  }

  const getInvoiceTotalValue = (invoice = {}) => {
    // El backend YA envía base_grand_total en la moneda de la compañía
    // NO hacer conversiones adicionales
    return preferAmount(invoice, [
      'base_grand_total',
      'grand_total'
    ])
  }

  const getInvoiceOutstandingValue = (invoice = {}) => {
    // outstanding_amount ya viene calculado por ERPNext en moneda de compañía
    // NO existe base_outstanding_amount en Purchase Invoice
    return preferAmount(invoice, [
      'outstanding_amount'
    ])
  }

  const getDocumentAmountValue = (doc = {}) => {
    // El backend YA envía base_grand_total en la moneda de la compañía
    // NO hacer conversiones adicionales
    return preferAmount(doc, [
      'base_grand_total',
      'grand_total',
      'amount'
    ])
  }

  const getDocumentOutstandingValue = (doc = {}) => {
    // outstanding_amount ya viene calculado por ERPNext en moneda de compañía
    // NO existe base_outstanding_amount en Purchase Invoice
    return preferAmount(doc, [
      'outstanding_amount',
      'outstanding'
    ])
  }

  const getPaymentAmountInCompanyCurrency = (source = {}) => {
    // El backend YA envía base_paid_amount en la moneda de la compañía
    // NO hacer conversiones adicionales
    return preferAmount(source, [
      'base_paid_amount',
      'paid_amount'
    ])
  }

  const renderInvoicesTable = (invoices, bulkOptions = {}, extraOptions = {}) => {
    const {
      isBulkMode = false,
      selectedItems,
      onToggleRow,
      onToggleAll,
      documentsForSelection,
      isProcessing = false
    } = bulkOptions
    const {
      summaryGroups = [],
      onOpenConciliationDocument = () => {}
    } = extraOptions
    const selectedSet = selectedItems instanceof Set ? selectedItems : new Set(selectedItems || [])
    const searchQuery = invoiceSearchQuery
    const normalizedSearchQuery = normalizedInvoiceSearchQuery
    const showSummaryRows = !isBulkMode && Array.isArray(summaryGroups) && summaryGroups.length > 0 && !normalizedSearchQuery

    const resolveSigla = (voucherType, fallbackName) => mapVoucherTypeToSigla(voucherType || fallbackName)
    const normalizeNumber = (value) => {
      const numberValue = Number(value)
      return Number.isFinite(numberValue) ? numberValue : 0
    }
    const getDocumentDescription = (doc, fallback = 'Factura') => {
      if (!doc) return fallback
      return doc.remarks || doc.description || doc.voucher_description || doc.name || fallback
    }

    const conciliatedDocIds = new Set()
    if (showSummaryRows) {
      summaryGroups.forEach(group => {
        (group.documents || []).forEach(doc => {
          const id = doc.name || doc.erpnext_name || doc.voucher_no
          if (id) conciliatedDocIds.add(id)
        })
      })
    }

    let summaryRunningBalance = 0
    const summaryRowsData = showSummaryRows
      ? summaryGroups.map(group => {
          const documents = Array.isArray(group.documents) ? group.documents : []
          let totalSum = 0
          let paidSum = 0
          let outstandingSum = 0

          // Primero, calcular el total de pagos aplicados en este grupo
          let totalPaymentsInGroup = 0
          documents.forEach(doc => {
            const isPaymentDoc = doc.doctype === 'Payment Entry' || doc.voucher_type === 'Payment Entry'
            if (isPaymentDoc) {
              const paidAmount = normalizeNumber(doc.base_paid_amount || doc.paid_amount || doc.amount || 0)
              totalPaymentsInGroup += paidAmount
            }
          })

          documents.forEach(doc => {
            const isPaymentDoc = doc.doctype === 'Payment Entry' || doc.voucher_type === 'Payment Entry'
            if (isPaymentDoc) {
              // Para pagos en conciliación: mostrar el total del pago en "Cobrado"
              const paidAmount = normalizeNumber(doc.base_paid_amount || doc.paid_amount || doc.amount || 0)
              const outstandingValue = normalizeNumber(doc.outstanding || -(doc.unallocated_amount || 0))
              totalSum += -paidAmount
              paidSum += -paidAmount  // Mostrar el total del pago
              outstandingSum += outstandingValue
            } else {
              // Para facturas: el "pagado" es el total de pagos del grupo
              const amount = normalizeNumber(doc.base_grand_total || doc.grand_total || doc.amount || 0)
              const outstanding = normalizeNumber(doc.outstanding_amount || doc.outstanding || 0)
              totalSum += amount
              // En una conciliación, el pagado de la factura es la suma de todos los pagos del grupo
              paidSum += totalPaymentsInGroup
              outstandingSum += outstanding
            }
          })

          summaryRunningBalance += outstandingSum

          return {
            group,
            documents,
            totalSum,
            paidSum,
            outstandingSum,
            runningBalance: summaryRunningBalance
          }
        })
      : []

    const baseInvoices = showSummaryRows
      ? invoices.filter(invoice => {
          const id = invoice.name || invoice.voucher_no
          return !conciliatedDocIds.has(id)
        })
      : invoices

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

    const matchedParents = purchaseItemMatchedParents instanceof Set ? purchaseItemMatchedParents : null
    const filteredInvoices = normalizedSearchQuery
      ? (baseInvoices || []).filter((doc) => {
          if (!doc) return false

          const query = normalizedSearchQuery
          const numericQueryString = query.replace(/[^\d.-]/g, '')
          const numericQuery = Number(numericQueryString)
          const isNumericLikeQuery = /^[\d.,-]+$/.test(query)
          const hasNumericQuery = isNumericLikeQuery && Number.isFinite(numericQuery) && query.replace(/[^\d]/g, '').length > 0
          const queryDateIso = normalizeDateToIso(query)

          const docIdentifier = doc.erpnext_name || doc.name || doc.voucher_no || ''
          const idCandidates = [
            docIdentifier,
            doc.name,
            doc.erpnext_name,
            doc.voucher_no
          ]
            .filter(Boolean)
            .map(v => String(v))

          const dateCandidates = [
            doc.posting_date,
            doc.transaction_date,
            doc.due_date,
            doc.fecha
          ]
          const dateTokens = dateCandidates.flatMap(expandDateTokens).map(v => String(v).toLowerCase())

          const docTypeHint = (doc.voucher_type || doc.doctype || '').toString()
          const desc = getDocumentDescription(doc, '').toString().toLowerCase()
          const voucherText = String(docIdentifier).toLowerCase()

          const totalRaw = doc.base_grand_total ?? doc.grand_total ?? doc.total ?? doc.amount ?? ''
          const outstandingRaw = doc.outstanding_amount ?? doc.outstanding ?? doc.unallocated_amount ?? ''
          const paidRaw = doc.base_paid_amount ?? doc.paid_amount ?? doc.paid ?? ''
          const amountText = `${totalRaw} ${outstandingRaw} ${paidRaw}`.toLowerCase()

          const localMatch = voucherText.includes(query)
            || idCandidates.some(v => v.toLowerCase().includes(query))
            || dateTokens.some(token => token.includes(query))
            || (queryDateIso ? dateTokens.includes(queryDateIso) : false)
            || desc.includes(query)
            || docTypeHint.toLowerCase().includes(query)
            || amountText.includes(query)
            || (
              hasNumericQuery && (
                (Number.isFinite(Number(totalRaw)) && String(Number(totalRaw)).includes(String(numericQuery)))
                || (Number.isFinite(Number(outstandingRaw)) && String(Number(outstandingRaw)).includes(String(numericQuery)))
                || (Number.isFinite(Number(paidRaw)) && String(Number(paidRaw)).includes(String(numericQuery)))
              )
            )

          if (doc.itemType === 'payment') {
            return localMatch
          }

          const itemMatch = matchedParents && idCandidates.some(candidate => matchedParents.has(String(candidate)))
          return localMatch || itemMatch
        })
      : baseInvoices

    let runningBalance = summaryRunningBalance
    const invoicesWithBalance = filteredInvoices.map(invoice => {
      const isPaymentDoc =
        invoice.itemType === 'payment' ||
        invoice.doctype === 'Payment Entry' ||
        invoice.voucher_type === 'Payment Entry'
      const isDraft = invoice.docstatus === 0 || invoice.status === 'Draft'

      let totalAmount = 0
      let paidAmount = 0
      let outstandingAmount = 0

      if (isPaymentDoc) {
        const paid = normalizeNumber(getPaymentAmountInCompanyCurrency(invoice))
        const unallocated = normalizeNumber(
          invoice.outstanding_amount ??
            invoice.outstanding ??
            invoice.unallocated_amount ??
            invoice.outstanding_in_company_currency ??
            0
        )
        totalAmount = -paid
        paidAmount = -(paid - Math.abs(unallocated))
        outstandingAmount = unallocated
      } else {
        // Para facturas, usar base_grand_total y outstanding_amount (ambos en moneda de compañía)
        const total = normalizeNumber(getInvoiceTotalValue(invoice))
        const outstanding = isDraft
          ? total
          : normalizeNumber(getInvoiceOutstandingValue(invoice))
        totalAmount = total
        paidAmount = isDraft ? 0 : total - outstanding
        outstandingAmount = outstanding
      }

      runningBalance += outstandingAmount

      return {
        ...invoice,
        normalized_total: totalAmount,
        normalized_paid: paidAmount,
        normalized_outstanding: outstandingAmount,
        running_balance: runningBalance
      }
    })

    const showEmptyState = invoicesWithBalance.length === 0 && !showSummaryRows
    const selectionItems = Array.isArray(documentsForSelection) ? documentsForSelection : invoicesWithBalance
    const allSelected = isBulkMode && selectionItems.length > 0 && selectionItems.every(invoice => selectedSet.has(invoice.name))

    return (
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                const nextValue = e.target.value
                setInvoiceSearchByTab(prev => ({
                  ...(prev || {}),
                  [invoiceTab]: nextValue
                }))
              }}
              placeholder="Buscar por nro, fecha, descripción o item..."
              className="w-full pl-10 pr-10 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setInvoiceSearchByTab(prev => ({
                    ...(prev || {}),
                    [invoiceTab]: ''
                  }))
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Limpiar búsqueda"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {shouldSearchPurchaseInvoiceItems && (
            <div className="text-xs text-gray-500 flex items-center">
              {purchaseItemSearchLoading
                ? 'Buscando items...'
                : purchaseItemMatchedParents instanceof Set
                  ? `${purchaseItemMatchedParents.size} factura(s) por items`
                  : null}
            </div>
          )}
        </div>
        {shouldSearchPurchaseInvoiceItems && purchaseItemSearchError && (
          <div className="text-xs text-red-600">{purchaseItemSearchError}</div>
        )}

        {showEmptyState ? (
          <div className="text-center py-8 text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No hay facturas para mostrar</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="accounting-table min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {isBulkMode && (
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                  <input
                    type="checkbox"
                    className="form-checkbox h-4 w-4 text-red-600"
                    checked={allSelected}
                    onChange={(e) => onToggleAll && onToggleAll(e.target.checked)}
                    disabled={isProcessing || selectionItems.length === 0}
                  />
                </th>
              )}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Nro.
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tipo
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Fecha
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Descripci¢n
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                <DollarSign className="w-4 h-4 mx-auto" />
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cobrado
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Saldo
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Acumulado
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {showSummaryRows && summaryRowsData.map(({ group, documents, outstandingSum, totalSum, paidSum, runningBalance: groupRunningBalance }) => {
              const groupId = group.conciliation_id
              const isExpanded = !!expandedConciliationRows[groupId]
              const firstDoc = documents[0] || {}
              const groupDate = firstDoc.posting_date
              return (
                <React.Fragment key={`conc-${groupId}`}>
                  <tr
                    className="bg-yellow-50 hover:bg-yellow-200 cursor-pointer"
                    onClick={() => toggleConciliationRow(groupId)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      Conciliaci¢n
                      <span className="ml-2 text-xs text-gray-600">
                        ({documents.length})
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">CON</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {formatDate(groupDate)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700" title={documents.map(doc => doc.voucher_no).join(', ')}>
                      Documentos agrupados
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{companyCurrency}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">
                      {formatBalance(totalSum)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">
                      {formatBalance(paidSum)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">
                      {formatBalance(outstandingSum)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">
                      {formatBalance(groupRunningBalance)}
                    </td>
                  </tr>
                  {isExpanded && (() => {
                    // Calcular el total de pagos del grupo primero
                    const totalPaymentsInGroup = documents.reduce((sum, doc) => {
                      const isPayment = doc.doctype === 'Payment Entry' || doc.voucher_type === 'Payment Entry'
                      if (isPayment) {
                        return sum + normalizeNumber(doc.base_paid_amount || doc.paid_amount || doc.amount || 0)
                      }
                      return sum
                    }, 0)

                    return documents.map((doc) => {
                      const voucherNo = doc.voucher_no || doc.name
                      const isPaymentDoc = doc.doctype === 'Payment Entry' || doc.voucher_type === 'Payment Entry'
                      let docAmount
                      let docOutstanding
                      let docPaid
                      if (isPaymentDoc) {
                        // Para pagos en conciliación: mostrar el total del pago en "Cobrado"
                        const paidAmount = normalizeNumber(doc.base_paid_amount || doc.paid_amount || doc.amount || 0)
                        const outstandingValue = normalizeNumber(doc.outstanding || -(doc.unallocated_amount || 0))
                        docAmount = -paidAmount
                        docPaid = -paidAmount  // Mostrar el total del pago
                        docOutstanding = outstandingValue
                      } else {
                        // Para facturas en conciliación: el pagado es el total de pagos del grupo
                        docAmount = normalizeNumber(doc.base_grand_total || doc.grand_total || doc.amount || 0)
                        docOutstanding = normalizeNumber(doc.outstanding_amount || doc.outstanding || 0)
                        docPaid = totalPaymentsInGroup
                      }
                       
                      const docTypeHint = doc.voucher_type || doc.doctype || ''
                      // Siempre usar companyCurrency porque los montos vienen convertidos a la moneda de la compañía
                      const docCurrency = companyCurrency
                      const isDocClickable = typeof onOpenConciliationDocument === 'function' &&
                        (isInvoiceVoucherType(docTypeHint) || isPaymentVoucherType(docTypeHint) || isCreditVoucherType(docTypeHint) || isDebitVoucherType(docTypeHint))
                      const handleOpenDoc = () => onOpenConciliationDocument(voucherNo, docTypeHint)

                      return (
                        <tr
                          key={`conc-${groupId}-${voucherNo}`}
                          className={`bg-yellow-100 ${isDocClickable ? 'cursor-pointer hover:bg-yellow-200' : ''}`}
                          onClick={isDocClickable ? handleOpenDoc : undefined}
                          title={isDocClickable ? 'Click para abrir documento' : ''}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatVoucherNumber ? formatVoucherNumber(voucherNo) : voucherNo}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {resolveSigla(docTypeHint, voucherNo)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {formatDate(doc.posting_date)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate text-left" title={getDocumentDescription(doc)}>
                            {truncateDescription(getDocumentDescription(doc))}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {docCurrency}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatBalance(docAmount)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatBalance(docPaid)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatBalance(docOutstanding)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                            {formatBalance(docOutstanding)}
                          </td>
                        </tr>
                      )
                    })
                  })()}

                </React.Fragment>
              )
            })}
            {invoicesWithBalance.map((invoice) => {
              const canOpenRow = !isBulkMode
              const isBulkRowSelectable = invoice?.doctype === 'Purchase Invoice'
              // Siempre usar companyCurrency porque los montos vienen convertidos a la moneda de la compañía
              const invoiceCurrency = companyCurrency
              // Usar normalized_total que ya está en moneda de la compañía
              const invoiceTotalValue = normalizeNumber(invoice.normalized_total ?? invoice.grand_total ?? invoice.total ?? 0)
              return (
                <tr
                  key={invoice.name}
                  className={`hover:bg-gray-50 ${canOpenRow ? 'cursor-pointer' : ''}`}
                  onClick={canOpenRow ? () => handleOpenInvoice(invoice.name) : undefined}
                >
                {isBulkMode && (
                  <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    {isBulkRowSelectable ? (
                      <input
                        type="checkbox"
                        className="form-checkbox h-4 w-4 text-red-600"
                        checked={selectedSet.has(invoice.name)}
                        onChange={(e) => {
                          e.stopPropagation()
                          onToggleRow && onToggleRow(invoice.name, e.target.checked)
                        }}
                        disabled={isProcessing}
                      />
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                )}
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {formatVoucherNumber(invoice.name)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {(() => {
                    let voucherType = invoice.voucher_type || ''
                    if (!voucherType) {
                      if (invoice.is_return || invoice.status === 'Return') {
                        voucherType = 'Nota de Credito'
                      } else if (invoice.name && invoice.name.includes('NDB')) {
                        voucherType = 'Nota de Debito'
                      } else if (invoice.invoice_type) {
                        voucherType = invoice.invoice_type
                      } else {
                        voucherType = 'Factura'
                      }
                    }
                    return resolveSigla(voucherType, invoice.name)
                  })()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(invoice.posting_date)}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title={getDocumentDescription(invoice)}>
                  {truncateDescription(getDocumentDescription(invoice))}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {invoiceCurrency}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {formatBalance(invoiceTotalValue)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {formatBalance(invoice.normalized_paid)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                  {formatBalance(invoice.normalized_outstanding ?? invoice.outstanding_amount)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                  {formatBalance(invoice.running_balance)}
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
        )}
      </div>
    )
  }
  const handleAddSupplierLocal = async () => {
    // Expandir el panel de detalles al agregar nuevo proveedor
    setIsSupplierDetailsPanelExpanded(true)
    
    // Ensure supplier groups are loaded before opening the new supplier form
    let groupsToUse = supplierGroups
    if (!groupsToUse || groupsToUse.length === 0) {
      // fetchSupplierGroups returns groups and sets state
      try {
        groupsToUse = await fetchSupplierGroups()
      } catch (e) {
        console.warn('No se pudieron cargar grupos de proveedores antes de abrir el modal:', e)
        groupsToUse = []
      }
    }

    await handleAddSupplier({
      setSelectedSupplier,
      setIsEditingSupplier,
      setEditedSupplierData,
      setSupplierTab
    }, fetchWithAuth, fetchSupplierGroupDetails, activeCompanyDetails, groupsToUse, availableExpenseAccounts, paymentTermsTemplates, taxTemplates, availablePriceLists)
  }

  const handleCancelEditLocal = () => {
    handleCancelEdit({
      setIsEditingSupplier,
      setEditedSupplierData
    })
  }

  const handleSearchAfipLocal = async (cuit) => {
    const setters = {
      setConsultingAfip,
      setEditedSupplierData
    }
    await handleSearchAfip(cuit, fetchWithAuth, setters, showNotification)
  }

  const handleSaveSupplierLocal = async () => {
    const setters = {
      setSavingSupplier,
      setIsEditingSupplier,
      fetchSuppliers,
      fetchSupplierDetails,
      // needed so handlers can persist fiscal address after save
      fetchSupplierAddresses,
      supplierAddresses,
      setSelectedSupplier
    }
    await handleSaveSupplier(selectedSupplier, editedSupplierData, fetchWithAuth, setters, showNotification)
  }

  const handleCreateSupplierLocal = async () => {
    const setters = {
      setSavingSupplier,
      setIsEditingSupplier,
      setSelectedSupplier,
      fetchSuppliers,
      // include address helpers so handler can persist fiscal address on create
      fetchSupplierAddresses,
      supplierAddresses
    }
    await handleCreateSupplier(editedSupplierData, fetchWithAuth, setters, showNotification)
  }

  const handleDeleteSupplierLocal = async () => {
    const setters = {
      setSelectedSupplier,
      setSupplierDetails,
      fetchSuppliers,
      showConfirmModal
    }
    await handleDeleteSupplier(selectedSupplier, supplierDetails, fetchWithAuth, setters, showNotification)
  }

  return (
    <>
        <Visualizacion
          suppliers={suppliers}
          selectedSupplier={selectedSupplier}
          setSelectedSupplier={setSelectedSupplier}
          fetchWithAuth={fetchWithAuth}
          supplierDetails={supplierDetails}
          supplierAddresses={supplierAddresses}
          supplierInvoices={supplierInvoices}
          unpaidInvoicesCount={unpaidInvoicesCount}
        draftInvoicesCount={draftInvoicesCount}
        supplierStatements={supplierStatements}
        conciliationGroups={supplierConciliations}
        loading={loading}
        loadingSupplierDetails={loadingSupplierDetails}
        isSupplierDetailsPanelExpanded={isSupplierDetailsPanelExpanded}
        setIsSupplierDetailsPanelExpanded={setIsSupplierDetailsPanelExpanded}
        loadSupplierDetailsOnExpand={loadSupplierDetailsOnExpand}
        balancesLoaded={balancesLoaded}
        loadingBalances={loadingBalances}
        onFetchBalances={fetchSupplierBalancesOnDemand}
        isInvoiceModalOpen={isInvoiceModalOpen}
        setIsInvoiceModalOpen={setIsInvoiceModalOpen}
        isPaymentModalOpen={isPaymentModalOpen}
        setIsPaymentModalOpen={setIsPaymentModalOpen}
        isEditingSupplier={isEditingSupplier}
        editedSupplierData={editedSupplierData}
        savingSupplier={savingSupplier}
        editingInvoice={editingInvoice}
        setEditingInvoice={setEditingInvoice}
        editingPayment={editingPayment}
        setEditingPayment={setEditingPayment}
        isAddressModalOpen={isAddressModalOpen}
        setIsAddressModalOpen={setIsAddressModalOpen}
        hasMoreStatements={hasMoreStatements}
        loadingMoreStatements={loadingMoreStatements}
        invoiceTab={invoiceTab}
        setInvoiceTab={setInvoiceTab}
        supplierTab={supplierTab}
        setSupplierTab={setSupplierTab}
        availableAccounts={availableAccounts}
        availableLiabilityAccounts={availableLiabilityAccounts}
        availableExpenseAccounts={availableExpenseAccounts}
        paymentTermsTemplates={paymentTermsTemplates}
        taxTemplates={taxTemplates}
        supplierSearch={supplierSearch}
        setSupplierSearch={setSupplierSearch}
        consultingAfip={consultingAfip}
        supplierGroups={supplierGroups}
        availablePriceLists={availablePriceLists}
        showSupplierGroupTestModal={showSupplierGroupTestModal}
        supplierGroupFormData={supplierGroupFormData}
        setSupplierGroupFormData={setSupplierGroupFormData}
        savingSupplierGroup={savingSupplierGroup}
        handleSaveSupplierGroup={handleSaveSupplierGroup}
        editingSupplierGroup={editingSupplierGroup}
        handleCloseSupplierGroupModal={handleCloseSupplierGroupModal}
        confirmModal={confirmModal}
        itemSettingsModal={itemSettingsModal}
        setItemSettingsModal={setItemSettingsModal}
        activeCompany={activeCompany}
        companyCurrency={companyCurrency}
        onCreateRemito={handleOpenRemitoCreation}
        onCreatePurchaseOrder={handleOpenPurchaseOrderCreation}
        supplierReceipts={supplierReceipts}
        receiptsPagination={receiptsPagination}
        isLoadingReceipts={isLoadingReceipts}
        onRemitoPageChange={handleRemitoPageChange}
        onOpenRemito={openRemitoForEdit}
        supplierPurchaseOrders={supplierPurchaseOrders}
        purchaseOrdersPagination={purchaseOrdersPagination}
        isLoadingPurchaseOrders={isLoadingPurchaseOrders}
        onPurchaseOrdersPageChange={handlePurchaseOrdersPageChange}
        onOpenPurchaseOrder={openPurchaseOrderForEdit}
        bulkDeleteState={bulkDeleteState}
        onToggleBulkDelete={handleBulkDeleteToggle}
        onBulkRowToggle={handleBulkRowToggle}
        onBulkSelectAll={handleBulkSelectAll}
        isBulkDeleting={isBulkDeleting}
        handleAddSupplier={handleAddSupplierLocal}
        handleEditSupplier={handleEditSupplierLocal}
        handleCancelEdit={handleCancelEditLocal}
        handleCreateSupplier={handleCreateSupplierLocal}
        handleSaveSupplier={handleSaveSupplierLocal}
        handleDeleteSupplier={handleDeleteSupplierLocal}
        handleEditChange={handleEditChange}
        handleSearchAfip={handleSearchAfipLocal}
        handleCloseAddressModal={handleCloseAddressModal}
        handleCreateInvoice={handleCreateInvoice}
        handleOpenInvoice={handleOpenInvoice}
        handleInvoiceDeleted={handleInvoiceDeleted}
        onOpenSupplierGroupModal={handleOpenSupplierGroupTestModal}
        formatBalance={formatBalance}
        formatVoucherNumber={formatVoucherNumber}
        mapVoucherTypeToSigla={mapVoucherTypeToSigla}
        truncateDescription={truncateDescription}
        formatDate={formatDate}
        extractAccountDescription={extractAccountDescription}
        renderInvoicesTable={renderInvoicesTable}
        loadMoreStatements={loadMoreStatements}
        handleConfirmAction={handleConfirmAction}
        handleCancelAction={handleCancelAction}
        filterSuppliers={filterSuppliers}
        isInvoiceVoucherType={isInvoiceVoucherType}
        isPaymentVoucherType={isPaymentVoucherType}
        isCreditVoucherType={isCreditVoucherType}
        isDebitVoucherType={isDebitVoucherType}
        openStatementEntry={openStatementEntry}
        onDownloadDocumentPdf={downloadDocumentPdf}
        downloadingDocuments={downloadingDocuments}
        onSupplierPaymentSaved={handleSupplierPaymentSaved}
        isReconciliationModalOpen={isReconciliationModalOpen}
        setIsReconciliationModalOpen={setIsReconciliationModalOpen}
        showCommercialName={showCommercialName}
        setShowCommercialName={setShowCommercialName}
      />

      {/* Supplier Reconciliation Modal */}
      <ReconciliationModal
        isOpen={isReconciliationModalOpen}
        onClose={() => {
          setIsReconciliationModalOpen(false)
          // Refrescar datos del proveedor cuando se cierra el modal
          if (selectedSupplier) {
            fetchSupplierInvoices(selectedSupplier)
            fetchSupplierStatements(selectedSupplier)
          }
        }}
        partyType="supplier"
        party={selectedSupplier}
        company={activeCompany}
      />

      {/* Supplier Address Modal */}
      <SupplierAddressModal
        isOpen={isAddressModalOpen}
        onClose={handleCloseAddressModal}
        supplier={selectedSupplier}
        addresses={supplierAddresses}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        onSaved={handlePurchaseOrderSaved}
      />

      {/* Remito Modal */}
      <RemitoModal
        isOpen={isRemitoModalOpen}
        onClose={() => {
          setIsRemitoModalOpen(false)
          setSelectedRemito(null)
          setRemitoDraftData(null)
        }}
        selectedSupplier={selectedSupplier}
        supplierDetails={supplierDetails}
        activeCompany={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        selectedRemitoName={selectedRemito}
        initialRemitoData={remitoDraftData?.remito}
        prefilledFormData={remitoDraftData?.normalizedFormData}
        onSaved={async () => {
          // Refrescar la lista de remitos después de guardar
          if (selectedSupplier) {
            await fetchSupplierReceipts(selectedSupplier, receiptsPagination.page)
            await fetchSupplierPurchaseOrders(selectedSupplier, purchaseOrdersPagination.page)
          }
          setSelectedRemito(null)
          setRemitoDraftData(null)
        }}
      />

      <PurchaseOrderModal
        isOpen={isPurchaseOrderModalOpen}
        onClose={() => {
          setIsPurchaseOrderModalOpen(false)
          setEditingPurchaseOrder(null)
        }}
        supplierName={selectedSupplier}
        supplierDetails={supplierDetails}
        activeCompany={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        editingData={editingPurchaseOrder}
        initialData={editingPurchaseOrder}
        prefilledFormData={editingPurchaseOrder ? normalizePurchaseOrderData(editingPurchaseOrder) : null}
        onSaved={handlePurchaseOrderSaved}
      />

      <SupplierGroupModal
        isOpen={showSupplierGroupModal}
        onClose={handleCloseSupplierGroupModal}
        editingGroup={editingSupplierGroup}
        groupFormData={supplierGroupFormData}
        onFormChange={setSupplierGroupFormData}
        onSave={handleSaveSupplierGroup}
        saving={savingSupplierGroup}
        supplierGroups={allSupplierGroups}
        availableExpenseAccounts={availableExpenseAccounts}
        paymentTermsTemplates={paymentTermsTemplates}
        extractAccountName={extractAccountDescription}
      />
    </>
  )
}
