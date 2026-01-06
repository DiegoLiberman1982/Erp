import React, { useState, useEffect, useContext, useMemo, useCallback, useRef } from 'react'
import { AuthContext } from '../AuthProvider'
import { NotificationContext } from '../contexts/NotificationContext'
import { useConfirm } from '../hooks/useConfirm'
import API_ROUTES from '../apiRoutes'
import { FileText, Banknote, CreditCard, Building2, Receipt, ChevronRight } from 'lucide-react'
import TreasuryAccountsList from './Financepanel/TreasuryAccountsList'
import TreasuryAccountPanel from './Financepanel/TreasuryAccountPanel'
import ConciliationPanel from './Financepanel/ConciliationPanel'
import BankAutoMatchingModal from './Financepanel/BankAutoMatchingModal'
import BankMovementsImportModal from './Financepanel/BankMovementsImportModal'
import UnpaidMovementModal from './modals/Movimientosbancarios/UnpaidMovementModal'
import BankTransactionActionSelector from './modals/Movimientosbancarios/BankTransactionActionSelector'
import PartySelector from './modals/Movimientosbancarios/PartySelector'
import PaymentModal from './modals/PaymentModal'
import SupplierPaymentModal from './modals/SupplierPaymentModal'
import RegisterPaymentModal from './Financepanel/RegisterPaymentModal'

const MOVEMENTS_PAGE_SIZE = 30
const MAX_DATE_RANGE_DAYS = 183

const getInitialDateRange = () => {
  const today = new Date()
  const to = today.toISOString().split('T')[0]
  const fromDate = new Date(today)
  fromDate.setMonth(fromDate.getMonth() - 1)
  const from = fromDate.toISOString().split('T')[0]
  return { from, to }
}

export default function FinancePanel() {
  const [treasuryAccounts, setTreasuryAccounts] = useState([])
  const [selectedTreasuryAccount, setSelectedTreasuryAccount] = useState(null)
  const [accountDetails, setAccountDetails] = useState(null)
  const [bankMovements, setBankMovements] = useState([])
  const [bankReconciledIdentifiers, setBankReconciledIdentifiers] = useState(null)
  const [accountingMovements, setAccountingMovements] = useState([])
  const [loading, setLoading] = useState(false)
  const [isEditingAccount, setIsEditingAccount] = useState(false)
  const [editedAccountData, setEditedAccountData] = useState({})
  const [savingAccount, setSavingAccount] = useState(false)
  const [syncingMercadoPago, setSyncingMercadoPago] = useState(false)
  const [updatingMercadoPagoAutoSync, setUpdatingMercadoPagoAutoSync] = useState(false)
  const [isAutoMatchModalOpen, setIsAutoMatchModalOpen] = useState(false)
  const [autoMatchSetupLoading, setAutoMatchSetupLoading] = useState(false)
  const [undoingTransactionId, setUndoingTransactionId] = useState(null)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [pendingUnreconciles, setPendingUnreconciles] = useState(new Set())
  const [savingReconciledChanges, setSavingReconciledChanges] = useState(false)
  
  // Estado para modal de movimientos sin factura (modo MANUAL)
  const [isRegisterPaymentModalOpen, setIsRegisterPaymentModalOpen] = useState(false)
  
  // Estados para modal de conversión de movimientos bancarios (modo BANCO)
  const [isActionSelectorOpen, setIsActionSelectorOpen] = useState(false)
  const [isPartySelectorOpen, setIsPartySelectorOpen] = useState(false)
  const [selectedPartyType, setSelectedPartyType] = useState(null)
  const [isBancoModalOpen, setIsBancoModalOpen] = useState(false)
  const [bancoModalMode, setBancoModalMode] = useState(null) // 'unpaid', 'customer_payment', 'supplier_payment'
  const [selectedParty, setSelectedParty] = useState(null)
  // Estados para búsqueda y filtrado
  const [bankSearch, setBankSearch] = useState('')
  const [accountingSearch, setAccountingSearch] = useState('')
  // Estados para ordenamiento
  const [bankSort, setBankSort] = useState({ field: 'date', direction: 'desc' })
  const [accountingSort, setAccountingSort] = useState({ field: 'date', direction: 'desc' })
  // Estados para selección de movimientos
  const [selectedBankMovements, setSelectedBankMovements] = useState(new Set())
  const [selectedAccountingMovements, setSelectedAccountingMovements] = useState(new Set())
  const [dateMismatchAcknowledged, setDateMismatchAcknowledged] = useState(false)
  const [movementDateRange, setMovementDateRange] = useState(() => getInitialDateRange())
  const [pendingDateRange, setPendingDateRange] = useState(() => getInitialDateRange())
  const [dateRangeError, setDateRangeError] = useState('')
  const [bankPage, setBankPage] = useState(1)
  const [accountingPage, setAccountingPage] = useState(1)
  const [bankHasMore, setBankHasMore] = useState(false)
  const [accountingHasMore, setAccountingHasMore] = useState(false)
  const [bankLoading, setBankLoading] = useState(false)
  const [accountingLoading, setAccountingLoading] = useState(false)
  // Estado para colapsar el panel de cuentas
  const [accountsPanelCollapsed, setAccountsPanelCollapsed] = useState(true)
  // Estados para conciliación
  const [conciliationTab, setConciliationTab] = useState('unreconciled') // 'reconciled' or 'unreconciled'
  // Estados para cuentas contables
  const [accountingAccounts, setAccountingAccounts] = useState([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  // Estados para bancos
  const [banks, setBanks] = useState([])
  const [loadingBanks, setLoadingBanks] = useState(false)
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const { confirm, ConfirmDialog } = useConfirm()
  const isMercadoPagoAccount = Boolean(accountDetails?.is_mercadopago_bank)
  // Función para limpiar el nombre de la cuenta (quitar abreviación de empresa)
  const cleanAccountName = (accountName) => {
    if (!accountName) return accountName
    // Buscar patrón " - XXX" al final y quitarlo
    const match = accountName.match(/^(.+?)\s-\s[A-Z]{2,4}$/)
    return match ? match[1] : accountName
  }

  const fetchTreasuryAccounts = useCallback(async () => {
    try {
      setLoading(true)
      const url = `/api/treasury-accounts`
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setTreasuryAccounts(data.data)
        } else {
          showNotification(data.message || 'Error al cargar cuentas de tesorería', 'error')
        }
      } else {
        console.log('DEBUG: Response not ok, status:', response.status)
        const errorText = await response.text()
        console.log('DEBUG: Error response text:', errorText)
        showNotification(`Error al cargar cuentas de tesorería (${response.status})`, 'error')
      }
    } catch (error) {
      console.error('DEBUG: Exception in fetchTreasuryAccounts:', error)
      showNotification('Error al cargar cuentas de tesorería', 'error')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth, showNotification])

  // Cargar cuentas de tesorería al montar el componente y cuando cambie la empresa activa
  const fetchTreasuryAccountsRef = useRef(fetchTreasuryAccounts)
  useEffect(() => {
    fetchTreasuryAccountsRef.current = fetchTreasuryAccounts
  }, [fetchTreasuryAccounts])
  useEffect(() => {
    if (!activeCompany) {
      console.log('DEBUG: Not calling fetchTreasuryAccounts - no activeCompany')
      return
    }
    fetchTreasuryAccountsRef.current()
  }, [activeCompany])
  // Cargar detalles cuando se selecciona una cuenta de tesorería
  useEffect(() => {
    setPendingUnreconciles(new Set())
    setSelectedBankMovements(new Set())
    setSelectedAccountingMovements(new Set())
    setBankHasMore(false)
    setAccountingHasMore(false)
    if (selectedTreasuryAccount && selectedTreasuryAccount !== 'new') {
      const defaultRange = getInitialDateRange()
      const pendingRange = { ...defaultRange }
      fetchTreasuryAccountDetails(selectedTreasuryAccount)
      setBankPage(1)
      setAccountingPage(1)
      setMovementDateRange(defaultRange)
      setPendingDateRange(pendingRange)
      setDateRangeError('')
    } else {
      setAccountDetails(null)
      setBankMovements([])
      setAccountingMovements([])
      const defaultRange = getInitialDateRange()
      const pendingRange = { ...defaultRange }
      setMovementDateRange(defaultRange)
      setPendingDateRange(pendingRange)
      setDateRangeError('')
    }
  }, [selectedTreasuryAccount])
  // Helper function to extract account name from composite key (deprecated - now using IDs)
  // const getAccountNameFromKey = (key) => {
  //   if (!key || key === 'new') return key;
  //   // Split by ' - ' to separate account name from mode of payment
  //   const parts = key.split(' - ');
  //   if (parts.length >= 2) {
  //     // Remove the last part (mode of payment) and join the rest
  //     return parts.slice(0, -1).join(' - ');
  //   }
  //   return key;
  // };
  const movementFrom = movementDateRange.from
  const movementTo = movementDateRange.to

  const fetchBankMovements = useCallback(async (accountId, options = {}) => {
    try {
      const account = treasuryAccounts.find(acc => acc.id === accountId)
      if (!account) return
      setBankLoading(true)
      const page = options.page || 1
      const params = new URLSearchParams()
      params.append('include_details', '1')
      params.append('page', String(page))
      params.append('page_size', String(MOVEMENTS_PAGE_SIZE))
      if (options.fromDate) {
        params.append('from_date', options.fromDate)
      }
      if (options.toDate) {
        params.append('to_date', options.toDate)
      }
      const searchTerm = options.search !== undefined ? options.search : bankSearch
      if (searchTerm) {
        params.append('search', searchTerm)
      }
      const response = await fetchWithAuth(`/api/bank-movements/${encodeURIComponent(account.name)}?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const movements = data.data || []
          setBankMovements(movements)
          if (Array.isArray(data.reconciled_ledger_identifiers)) {
            try {
              setBankReconciledIdentifiers(new Set(data.reconciled_ledger_identifiers))
            } catch (e) {
              setBankReconciledIdentifiers(null)
            }
          } else {
            setBankReconciledIdentifiers(null)
          }
          setBankHasMore(Boolean(data.pagination?.has_more))
          setPendingUnreconciles(new Set())
          if (!options.preserveSelection) {
            setSelectedBankMovements(new Set())
          }
          if (page > 1 && movements.length === 0 && !data.pagination?.has_more) {
            setBankPage(prev => Math.max(1, prev - 1))
          }
        } else {
          showNotification(data.message || 'Error al cargar movimientos bancarios', 'error')
        }
      } else {
        let errorMessage = 'Error al cargar movimientos bancarios'
        try {
          const errorData = await response.json()
          if (errorData?.message) {
            errorMessage = errorData.message
          }
        } catch (err) {
          const text = await response.text()
          if (text) {
            console.error('Bank movements error response:', text)
          }
        }
        showNotification(errorMessage, 'error')
      }
    } catch (error) {
      console.error('Error fetching bank movements:', error)
      showNotification('Error al cargar movimientos bancarios', 'error')
    } finally {
      setBankLoading(false)
    }
  }, [treasuryAccounts, fetchWithAuth, showNotification])

  const fetchBankReconciledIdentifiers = useCallback(async (accountId, options = {}) => {
    try {
      const account = treasuryAccounts.find(acc => acc.id === accountId)
      if (!account) return
      const params = new URLSearchParams()
      if (options.fromDate) params.append('from_date', options.fromDate)
      if (options.toDate) params.append('to_date', options.toDate)
      const url = `/api/bank-reconciled-identifiers/${encodeURIComponent(account.name)}?${params.toString()}`
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          if (Array.isArray(data.reconciled_ledger_identifiers)) {
            setBankReconciledIdentifiers(new Set(data.reconciled_ledger_identifiers))
          } else {
            setBankReconciledIdentifiers(null)
          }
        } else {
          showNotification(data.message || 'Error al obtener identificadores conciliados', 'error')
        }
      } else {
        let errorMessage = 'Error al obtener identificadores conciliados'
        try {
          const err = await response.json()
          if (err?.message) errorMessage = err.message
        } catch (e) {
          // ignore
        }
        showNotification(errorMessage, 'error')
      }
    } catch (err) {
      console.error('Error fetching reconciled identifiers:', err)
      showNotification('Error al obtener identificadores conciliados', 'error')
    }
  }, [treasuryAccounts, fetchWithAuth, showNotification])

  const fetchAccountingMovements = useCallback(async (accountId, options = {}) => {
    try {
      const account = treasuryAccounts.find(acc => acc.id === accountId)
      if (!account) return
      setAccountingLoading(true)
      const page = options.page || 1
      const params = new URLSearchParams()
      params.append('page', String(page))
      params.append('page_size', String(MOVEMENTS_PAGE_SIZE))
      if (options.fromDate) {
        params.append('from_date', options.fromDate)
      }
      if (options.toDate) {
        params.append('to_date', options.toDate)
      }
      const searchTerm = options.search !== undefined ? options.search : accountingSearch
      if (searchTerm) {
        params.append('search', searchTerm)
      }
      const response = await fetchWithAuth(`/api/accounting-movements/${encodeURIComponent(account.name)}?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const movements = data.data || []
          setAccountingMovements(movements)
          setAccountingHasMore(Boolean(data.pagination?.has_more))
          if (!options.preserveSelection) {
            setSelectedAccountingMovements(new Set())
          }
          if (page > 1 && movements.length === 0 && !data.pagination?.has_more) {
            setAccountingPage(prev => Math.max(1, prev - 1))
          }
        } else {
          showNotification(data.message || 'Error al cargar movimientos contables', 'error')
        }
      } else {
        let errorMessage = 'Error al cargar movimientos contables'
        try {
          const errorData = await response.json()
          if (errorData?.message) {
            errorMessage = errorData.message
          }
        } catch (err) {
          const text = await response.text()
          if (text) {
            console.error('Accounting movements error response:', text)
          }
        }
        showNotification(errorMessage, 'error')
      }
    } catch (error) {
      console.error('Error fetching accounting movements:', error)
      showNotification('Error al cargar movimientos contables', 'error')
    } finally {
      setAccountingLoading(false)
    }
  }, [treasuryAccounts, fetchWithAuth, showNotification])

  useEffect(() => {
    if (!selectedTreasuryAccount || selectedTreasuryAccount === 'new') return
    fetchBankMovements(selectedTreasuryAccount, {
      page: bankPage,
      fromDate: movementFrom,
      toDate: movementTo,
      search: bankSearch
    })
    // also refresh reconciled identifiers for full range
    fetchBankReconciledIdentifiers(selectedTreasuryAccount, { fromDate: movementFrom, toDate: movementTo })
  }, [selectedTreasuryAccount, bankPage, movementFrom, movementTo, fetchBankMovements, bankSearch])

  useEffect(() => {
    if (!selectedTreasuryAccount || selectedTreasuryAccount === 'new') return
    fetchAccountingMovements(selectedTreasuryAccount, {
      page: accountingPage,
      fromDate: movementFrom,
      toDate: movementTo,
      search: accountingSearch
    })
    // ensure reconciled identifiers are up-to-date when accounting list refreshes
    fetchBankReconciledIdentifiers(selectedTreasuryAccount, { fromDate: movementFrom, toDate: movementTo })
  }, [selectedTreasuryAccount, accountingPage, movementFrom, movementTo, fetchAccountingMovements, accountingSearch])
  const fetchTreasuryAccountDetails = async (accountId) => {
    try {
      // Los detalles ya están en la lista de cuentas, solo buscar el objeto por ID
      const account = treasuryAccounts.find(acc => acc.id === accountId)
      setAccountDetails(account)
    } catch (error) {
      console.error('Error fetching treasury account details:', error)
    }
  }
  

  const handleDateInputChange = useCallback((field, value) => {
    setPendingDateRange(prev => ({
      ...prev,
      [field]: value
    }))
    setDateRangeError('')
  }, [])

  const validateDateRange = useCallback((range) => {
    if (!range?.from || !range?.to) {
      return 'Completá ambas fechas para filtrar los movimientos.'
    }
    const fromDate = new Date(range.from)
    const toDate = new Date(range.to)
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return 'Alguna de las fechas ingresadas no es válida.'
    }
    if (fromDate > toDate) {
      return 'La fecha desde no puede ser posterior a la fecha hasta.'
    }
    const diffDays = Math.abs((toDate - fromDate) / (1000 * 60 * 60 * 24))
    if (diffDays > MAX_DATE_RANGE_DAYS) {
      return 'Máximo 2 meses por consulta.'
    }
    return ''
  }, [])


  const handleRefreshMovements = useCallback(async () => {
    if (!selectedTreasuryAccount || selectedTreasuryAccount === 'new') return
    await Promise.all([
      fetchBankMovements(selectedTreasuryAccount, {
        page: bankPage,
        fromDate: movementFrom,
        toDate: movementTo,
        preserveSelection: true
      }),
      fetchAccountingMovements(selectedTreasuryAccount, {
        page: accountingPage,
        fromDate: movementFrom,
        toDate: movementTo,
        preserveSelection: true
      })
    ])
  }, [selectedTreasuryAccount, fetchBankMovements, fetchAccountingMovements, bankPage, accountingPage, movementFrom, movementTo])

  const handleApplyDateRange = useCallback(async () => {
    const errorMessage = validateDateRange(pendingDateRange)
    if (errorMessage) {
      setDateRangeError(errorMessage)
      return
    }
    setDateRangeError('')
    const rangeChanged =
      pendingDateRange.from !== movementDateRange.from ||
      pendingDateRange.to !== movementDateRange.to
    if (rangeChanged) {
      setMovementDateRange({ ...pendingDateRange })
      setBankPage(1)
      setAccountingPage(1)
      setSelectedBankMovements(new Set())
      setSelectedAccountingMovements(new Set())
    } else {
      await handleRefreshMovements()
    }
  }, [
    pendingDateRange,
    movementDateRange,
    validateDateRange,
    handleRefreshMovements
  ])

  const handleBankPageChange = (nextPage) => {
    setBankPage(Math.max(1, nextPage))
    setSelectedBankMovements(new Set())
  }

  const handleAccountingPageChange = (nextPage) => {
    setAccountingPage(Math.max(1, nextPage))
    setSelectedAccountingMovements(new Set())
  }
  const ensureAutoMatchingEnabled = async () => {
    const response = await fetchWithAuth(API_ROUTES.bankMatching.enableAuto, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.message || 'No pudimos habilitar el matching automático')
    }
    return payload
  }
  const handleOpenAutoMatchModal = async () => {
    if (!selectedTreasuryAccount || selectedTreasuryAccount === 'new') {
      showNotification('Selecciona una cuenta de tesorería antes de buscar matches automáticos.', 'warning')
      return
    }
    try {
      setAutoMatchSetupLoading(true)
      await ensureAutoMatchingEnabled()
      setIsAutoMatchModalOpen(true)
    } catch (error) {
      console.error('Error enabling automatic matching:', error)
      showNotification(error.message || 'No pudimos habilitar el matching automático.', 'error')
    } finally {
      setAutoMatchSetupLoading(false)
    }
  }
  const closeAutoMatchModal = () => {
    setIsAutoMatchModalOpen(false)
  }
  const fetchAutoMatchSuggestions = async (movement) => {
    const transactionName = movement?.id || movement?.name
    if (!transactionName) {
      throw new Error('Movimiento bancario no válido para buscar sugerencias.')
    }
    // Calcular fechas de referencia: ±7 días desde la fecha del movimiento
    const movementDate = new Date(movement.date)
    const fromDate = new Date(movementDate)
    fromDate.setDate(fromDate.getDate() - 7)
    const toDate = new Date(movementDate)
    toDate.setDate(toDate.getDate() + 7)
    const fromReferenceDate = fromDate.toISOString().split('T')[0]
    const toReferenceDate = toDate.toISOString().split('T')[0]
    const response = await fetchWithAuth(API_ROUTES.bankMatching.suggestions(transactionName), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_types: ['Payment Entry', 'Journal Entry'],
        filter_by_reference_date: 0,
        from_date: fromReferenceDate,
        to_date: toReferenceDate,
        bank_account: movement.bank_account,
        company: movement.company || accountDetails?.company || activeCompany
      })
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.message || 'No pudimos obtener sugerencias.')
    }
    return payload.data || []
  }
  const handleAutoMatchReconcile = async (transactionName, vouchers) => {
    if (!selectedTreasuryAccount || !transactionName) {
      throw new Error('Selecciona una cuenta y un movimiento para conciliar.')
    }
    if (!Array.isArray(vouchers) || vouchers.length === 0) {
      throw new Error('Selecciona al menos un comprobante para conciliar.')
    }
    const response = await fetchWithAuth(API_ROUTES.bankMatching.reconcile(transactionName), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vouchers })
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.message || 'No pudimos conciliar el movimiento.')
    }
    await handleRefreshMovements()
    showNotification('Movimiento conciliado automáticamente', 'success')
    return payload?.data?.transaction
  }
  const handleUndoReconciliation = async (transactionName) => {
    if (!selectedTreasuryAccount || !transactionName) return
    try {
      setUndoingTransactionId(transactionName)
      const response = await fetchWithAuth(API_ROUTES.bankMatching.unreconcile(transactionName), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank_transaction_name: transactionName })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'No pudimos deshacer la conciliación.')
      }
      await handleRefreshMovements()
      setPendingUnreconciles(prev => {
        const next = new Set(prev)
        next.delete(transactionName)
        return next
      })
      showNotification('Conciliación deshecha correctamente', 'success')
    } catch (error) {
      console.error('Error undoing reconciliation:', error)
      showNotification(error.message || 'Error al deshacer la conciliación.', 'error')
    } finally {
      setUndoingTransactionId(null)
    }
  }
  const handleToggleReconciledState = (transactionId, checked) => {
    if (!transactionId) return
    setPendingUnreconciles(prev => {
      const next = new Set(prev)
      if (checked) {
        next.delete(transactionId)
      } else {
        next.add(transactionId)
      }
      return next
    })
  }
  const handleSaveReconciledChanges = async () => {
    if (!selectedTreasuryAccount || pendingUnreconciles.size === 0) {
      showNotification('No hay cambios pendientes para guardar.', 'info')
      return
    }
    try {
      setSavingReconciledChanges(true)
      showNotification(`Desconciliando ${pendingUnreconciles.size} movimiento${pendingUnreconciles.size === 1 ? '' : 's'}...`, 'warning', 4000)
      for (const transactionId of pendingUnreconciles) {
        const response = await fetchWithAuth(API_ROUTES.bankMatching.unreconcile(transactionId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bank_transaction_name: transactionId })
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || `No pudimos desconciliar ${transactionId}.`)
        }
      }
      setPendingUnreconciles(new Set())
      await handleRefreshMovements()
      showNotification('Se desconciliaron los movimientos seleccionados.', 'success')
    } catch (error) {
      console.error('Error saving reconciled changes:', error)
      showNotification(error.message || 'No pudimos desconciliar los movimientos seleccionados.', 'error')
    } finally {
      setSavingReconciledChanges(false)
    }
  }
  const handleDeleteBankMovements = async () => {
    if (selectedBankMovements.size === 0) {
      showNotification('Selecciona al menos un movimiento bancario para eliminar.', 'warning')
      return
    }
    if (selectedAccountingMovements.size > 0) {
      showNotification('No puedes eliminar movimientos bancarios si tienes movimientos contables seleccionados.', 'warning')
      return
    }
    const confirmed = await confirm({
      title: 'Eliminar Movimientos Bancarios',
      message: `¿Estás seguro de que quieres eliminar ${selectedBankMovements.size} movimiento${selectedBankMovements.size === 1 ? '' : 's'} bancario${selectedBankMovements.size === 1 ? '' : 's'}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'danger'
    })
    if (!confirmed) return
    try {
      let successCount = 0
      let errorMessages = []
      for (const movementId of selectedBankMovements) {
        try {
          const response = await fetchWithAuth(API_ROUTES.bankMatching.deleteBankTransaction(movementId), {
            method: 'DELETE'
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || !payload?.success) {
            errorMessages.push(`${movementId}: ${payload?.message || 'Error desconocido'}`)
          } else {
            successCount++
          }
        } catch (error) {
          errorMessages.push(`${movementId}: ${error.message}`)
        }
      }
      if (successCount > 0) {
        showNotification(`Eliminados ${successCount} movimiento${successCount === 1 ? '' : 's'} bancario${successCount === 1 ? '' : 's'} exitosamente.`, 'success')
        if (errorMessages.length > 0) {
          showNotification(`Errores al eliminar algunos movimientos: ${errorMessages.join('; ')}`, 'warning')
        }
      } else {
        showNotification(`No se pudo eliminar ningún movimiento: ${errorMessages.join('; ')}`, 'error')
      }
      // Refresh lists
      await handleRefreshMovements()
      // Clear selection
      setSelectedBankMovements(new Set())
    } catch (error) {
      console.error('Error deleting bank movements:', error)
      showNotification(error.message || 'Error al eliminar movimientos bancarios.', 'error')
    }
  }
  const updateAccountLocally = (accountName, patch) => {
    setTreasuryAccounts(prev =>
      prev.map(account => {
        if (account.name !== accountName) return account
        const fragment = typeof patch === 'function' ? patch(account) : patch
        return { ...account, ...fragment }
      })
    )
    setAccountDetails(prev => {
      if (!prev || prev.name !== accountName) return prev
      const fragment = typeof patch === 'function' ? patch(prev) : patch
      return { ...prev, ...fragment }
    })
  }
  const handleEditAccount = () => {
    if (!accountDetails) return
    console.log('DEBUG: handleEditAccount - accountDetails:', accountDetails)
    console.log('DEBUG: handleEditAccount - accountDetails.bank_name:', accountDetails.bank_name)
    console.log('DEBUG: handleEditAccount - cleanAccountName result:', cleanAccountName(accountDetails.bank_name))
    // Usar bank_name si existe, sino usar account_name como nombre del banco
    const bankName = accountDetails.bank_name || accountDetails.account_name || ''
    console.log('DEBUG: handleEditAccount - bankName:', bankName)
    setIsEditingAccount(true)
    setEditedAccountData({
      name: accountDetails.name || '',
      type: accountDetails.type || 'bank',
      bank_name: accountDetails.type !== 'cash' ? cleanAccountName(bankName) : '',
      account_number: accountDetails.type !== 'cash' ? (accountDetails.account_number || '') : '',
      accounting_account: accountDetails.accounting_account || ''
    })
    // Cargar cuentas contables disponibles
    fetchAccountingAccounts()
    // Cargar bancos disponibles
    fetchBanks()
  }
  const handleMercadoPagoAutoSyncToggle = async () => {
    if (!accountDetails || !isMercadoPagoAccount) return
    const targetAccount = accountDetails
    const nextValue = !targetAccount.mercadopago_auto_sync
    try {
      setUpdatingMercadoPagoAutoSync(true)
      const response = await fetchWithAuth(API_ROUTES.mercadopago.accountSync(targetAccount.name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSync: nextValue })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'No se pudo actualizar la preferencia de sincronización')
      }
      updateAccountLocally(targetAccount.name, { mercadopago_auto_sync: nextValue })
      showNotification('Preferencia de sincronización actualizada', 'success')
      if (nextValue) {
          await handleMercadoPagoSync({ trigger: 'auto-toggle', account: targetAccount })
      }
    } catch (error) {
      console.error('Error updating Mercado Pago auto sync:', error)
      showNotification(error.message || 'Error al guardar la sincronización automática', 'error')
    } finally {
      setUpdatingMercadoPagoAutoSync(false)
    }
  }
  const handleMercadoPagoSync = async ({ trigger = 'manual', account } = {}) => {
    const targetAccount = account || accountDetails
    if (!targetAccount || !targetAccount.is_mercadopago_bank) {
      showNotification('Selecciona una cuenta de Mercado Pago para sincronizar.', 'warning')
      return
    }
    try {
      setSyncingMercadoPago(true)
      const response = await fetchWithAuth(API_ROUTES.mercadopago.sync, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccount: targetAccount.name, trigger })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'Error al sincronizar con Mercado Pago')
      }
      const state = payload?.data?.state
      if (state) {
        updateAccountLocally(targetAccount.name, {
          mercadopago_last_sync_at: state.last_sync_at,
          mercadopago_last_sync_summary: state.last_sync_summary,
          mercadopago_last_report_id: state.last_report_id
        })
      }
      showNotification(payload?.message || 'Movimientos importados desde Mercado Pago', 'success')
      if (selectedTreasuryAccount === targetAccount.id) {
        await handleRefreshMovements()
      }
    } catch (error) {
      console.error('Error syncing Mercado Pago:', error)
      showNotification(error.message || 'No se pudo sincronizar con Mercado Pago', 'error')
    } finally {
      setSyncingMercadoPago(false)
    }
  }
  const handleCancelEdit = () => {
    setIsEditingAccount(false)
    setEditedAccountData({})
  }
  const handleEditChange = (field, value) => {
    setEditedAccountData(prev => ({
      ...prev,
      [field]: value
    }))
  }
  const handleSaveAccount = async () => {
    if (!selectedTreasuryAccount) return
    try {
      // Validaciones
      if (editedAccountData.type !== 'cash' && !editedAccountData.bank_name) {
        showNotification('Debe seleccionar o ingresar un banco para cuentas bancarias', 'error')
        return
      }
      
      console.log('DEBUG: handleSaveAccount - editedAccountData:', JSON.stringify(editedAccountData, null, 2))
      console.log('DEBUG: handleSaveAccount - bank_name value:', editedAccountData.bank_name)
      
      setSavingAccount(true)
      const response = await fetchWithAuth(`/api/treasury-accounts/${selectedTreasuryAccount}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editedAccountData)
      })
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Cuenta de tesorería actualizada exitosamente', 'success')
          setIsEditingAccount(false)
          setEditedAccountData({})
          // Recargar detalles
          fetchTreasuryAccountDetails(selectedTreasuryAccount)
          // Recargar lista
          fetchTreasuryAccounts()
        } else {
          showNotification(data.message || 'Error al actualizar cuenta de tesorería', 'error')
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'Error al actualizar cuenta de tesorería', 'error')
      }
    } catch (error) {
      console.error('Error updating treasury account:', error)
      showNotification('Error al actualizar cuenta de tesorería', 'error')
    } finally {
      setSavingAccount(false)
    }
  }
  const handleCreateAccount = async () => {
    try {
      // Validaciones
      if (!editedAccountData.accounting_account) {
        showNotification('Debe seleccionar una cuenta contable', 'error')
        return
      }
      
      if (editedAccountData.type !== 'cash' && !editedAccountData.bank_name) {
        showNotification('Debe seleccionar o ingresar un banco para cuentas bancarias', 'error')
        return
      }
      
      setSavingAccount(true)
      const response = await fetchWithAuth(`/api/treasury-accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editedAccountData)
      })
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Cuenta de tesorería creada exitosamente', 'success')
          setIsEditingAccount(false)
          setEditedAccountData({})
          setAccountDetails(null)
          // Recargar lista
          fetchTreasuryAccounts()
        } else {
          showNotification(data.message || 'Error al crear cuenta de tesorería', 'error')
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'Error al crear cuenta de tesorería', 'error')
      }
    } catch (error) {
      console.error('Error creating treasury account:', error)
      showNotification('Error al crear cuenta de tesorería', 'error')
    } finally {
      setSavingAccount(false)
    }
  }
  const handleDeleteAccount = async () => {
    if (!selectedTreasuryAccount || selectedTreasuryAccount === 'new') return
    const account = treasuryAccounts.find(acc => acc.id === selectedTreasuryAccount);
    if (!account) return;
    // Confirmar eliminación
    const confirmed = await confirm({
      title: 'Confirmar eliminación',
      message: `¿Estás seguro de que quieres eliminar la cuenta "${account.mode_of_payment}"? Esto eliminará la asociación con el modo de pago pero mantendrá la cuenta contable intacta.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'error'
    })
    if (!confirmed) {
      return
    }
    try {
      const response = await fetchWithAuth(`/api/treasury-accounts/${encodeURIComponent(account.name)}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(data.message || 'Cuenta de tesorería eliminada exitosamente', 'success')
          // Limpiar selección
          setSelectedTreasuryAccount(null)
          setAccountDetails(null)
          setBankMovements([])
          setAccountingMovements([])
          // Recargar lista
          fetchTreasuryAccounts()
        } else {
          showNotification(data.message || 'Error al eliminar cuenta de tesorería', 'error')
        }
      } else {
        showNotification('Error al eliminar cuenta de tesorería', 'error')
      }
    } catch (error) {
      console.error('Error deleting treasury account:', error)
      showNotification('Error al eliminar cuenta de tesorería', 'error')
    }
  }
  const handleAddAccount = () => {
    setSelectedTreasuryAccount('new')
    setIsEditingAccount(true)
    setEditedAccountData({
      name: '',
      type: 'bank',
      bank_name: '',
      account_number: '',
      accounting_account: ''
    })
    setAccountDetails(null)
    setBankMovements([])
    setAccountingMovements([])
    // Cargar cuentas contables disponibles
    fetchAccountingAccounts()
    // Cargar bancos disponibles
    fetchBanks()
  }
  const getAccountTypeIcon = (type) => {
    switch (type) {
      case 'bank':
        return <Building2 className="w-4 h-4 text-blue-600" />
      case 'cash':
        return <Banknote className="w-4 h-4 text-green-600" />
      case 'cheque':
        return <Receipt className="w-4 h-4 text-orange-600" />
      case 'tarjeta_debito':
        return <CreditCard className="w-4 h-4 text-purple-600" />
      case 'tarjeta_credito':
        return <CreditCard className="w-4 h-4 text-red-600" />
      default:
        return <FileText className="w-4 h-4 text-gray-600" />
    }
  }
  const getAccountTypeLabel = (type) => {
    switch (type) {
      case 'bank':
        return 'Cuenta Bancaria'
      case 'cash':
        return 'Caja - Efectivo'
      case 'cheque':
        return 'Cheque'
      case 'tarjeta_debito':
        return 'Tarjeta Débito'
      case 'tarjeta_credito':
        return 'Tarjeta Crédito'
      default:
        return 'Otro'
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
  
  // Funciones para manejar conversión de movimientos bancarios (modo BANCO)
  const handleConvertBankTransactions = () => {
    if (selectedBankMovements.size === 0) {
      showNotification('Selecciona al menos un movimiento bancario', 'warning')
      return
    }
    setIsActionSelectorOpen(true)
  }

  const handleOpenRegisterPaymentModal = () => {
    if (!selectedTreasuryAccount || selectedTreasuryAccount === 'new' || !accountDetails?.name) {
      showNotification('Selecciona una cuenta de tesorería antes de registrar un pago.', 'warning')
      return
    }
    setIsRegisterPaymentModalOpen(true)
  }
  
  const handleActionSelected = (action, partyType) => {
    setBancoModalMode(action)

    if (action === 'unpaid' || action === 'cash_exchange') {
      // Flujos que no requieren seleccionar cliente/proveedor
      setSelectedPartyType(null)
      setSelectedParty(null)
      setIsBancoModalOpen(true)
    } else {
      // Cliente o proveedor - necesita seleccionar party primero
      setSelectedPartyType(partyType)
      setIsPartySelectorOpen(true)
    }
  }
  
  const handlePartySelected = (party) => {
    setSelectedParty(party)
    setIsBancoModalOpen(true)
  }

  const buildTargetAccountFromMapping = (mapping) => {
    if (!mapping) return null
    return mapping.cuenta_contable_name || mapping.cuenta_contable || null
  }

  const handleRegisterPaymentSubmit = async ({ strategy, mapping, account, amount, postingDate, remarks }) => {
    if (!accountDetails?.name) {
      showNotification('Selecciona una cuenta de tesorería antes de registrar un pago.', 'warning')
      return false
    }
    const numericAmount = Math.abs(parseFloat(amount || 0))
    if (!numericAmount) {
      showNotification('Indicá un importe válido.', 'warning')
      return false
    }
    let targetAccount = null
    if (strategy === 'mapping') {
      targetAccount = buildTargetAccountFromMapping(mapping)
    } else if (strategy === 'account') {
      targetAccount = account?.name
    }
    if (!targetAccount) {
      showNotification('Selecciona la cuenta contable de destino.', 'warning')
      return false
    }
    try {
      const response = await fetchWithAuth('/api/unpaid-movements/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeCompany ? { 'X-Active-Company': activeCompany } : {})
        },
        body: JSON.stringify({
          mode: 'MANUAL',
          variant: 'register_payment',
          strategy,
          tipo_movimiento: 'Egreso',
          bank_account: accountDetails.name,
          bank_account_docname: accountDetails.bank_account_id || accountDetails.bank_account,
          bank_account_display_name: accountDetails.account_name,
          target_account: targetAccount,
          mapping_name: mapping?.name,
          mapping: mapping
            ? {
                name: mapping.name,
                cuenta_contable: buildTargetAccountFromMapping(mapping),
                cuenta_contable_label: mapping.cuenta_contable,
                direction: mapping.direction
              }
            : null,
          account: account
            ? {
                name: account.name,
                account_name: account.account_name || account.name
              }
            : null,
          amount: numericAmount,
          posting_date: postingDate || new Date().toISOString().split('T')[0],
          remarks: remarks || ''
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'No pudimos registrar el pago.')
      }
      showNotification(payload?.message || 'Pago registrado correctamente.', 'success')
      await handleRefreshMovements()
      setIsRegisterPaymentModalOpen(false)
      return true
    } catch (error) {
      console.error('Error registering manual payment:', error)
      showNotification(error.message || 'No pudimos registrar el pago.', 'error')
      return false
    }
  }

  const handleRegisterCashExchange = async ({ targetAccountId, amount, postingDate }) => {
    if (!accountDetails?.name) {
      showNotification('Selecciona una cuenta de tesorería antes de registrar un canje.', 'warning')
      return false
    }
    const counterpart = treasuryAccounts.find(
      (acc) => acc.id === targetAccountId || acc.name === targetAccountId
    )
    if (!counterpart) {
      showNotification('Selecciona la cuenta contra la que querés mover el saldo.', 'warning')
      return false
    }
    const numericAmount = Math.abs(parseFloat(amount || 0))
    if (!numericAmount) {
      showNotification('Indicá un importe válido para el canje.', 'warning')
      return false
    }
    try {
      const response = await fetchWithAuth('/api/unpaid-movements/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeCompany ? { 'X-Active-Company': activeCompany } : {})
        },
        body: JSON.stringify({
          mode: 'MANUAL',
          variant: 'cash_exchange',
          strategy: 'manual',
          tipo_movimiento: 'Egreso',
          bank_account: accountDetails.name,
          bank_account_docname: accountDetails.bank_account_id || accountDetails.bank_account,
          bank_account_display_name: accountDetails.account_name,
          contra_cuenta: counterpart.name,
          contra_account_docname: counterpart.bank_account_id || counterpart.bank_account,
          contra_account_display_name: counterpart.account_name || counterpart.bank_account_name,
          amount: numericAmount,
          posting_date: postingDate || new Date().toISOString().split('T')[0]
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'No pudimos registrar el canje.')
      }
      showNotification(payload?.message || 'Canje registrado correctamente.', 'success')
      await handleRefreshMovements()
      setIsRegisterPaymentModalOpen(false)
      return true
    } catch (error) {
      console.error('Error registering manual cash exchange:', error)
      showNotification(error.message || 'No pudimos registrar el canje.', 'error')
      return false
    }
  }
  
  const getSelectedBankTransactionsData = () => {
    return Array.from(selectedBankMovements).map(id => {
      const movement = bankMovements.find(m => m.id === id)
      if (!movement) return null
      return {
        name: movement.name || movement.id,
        deposit: parseFloat(movement.deposit || 0),
        withdrawal: parseFloat(movement.withdrawal || 0),
        date: movement.date,
        reference_number: movement.reference_number || movement.transaction_id || '',
        transaction_id: movement.transaction_id
      }
    }).filter(Boolean)
  }

  const selectedBankTransactionsData = useMemo(() => getSelectedBankTransactionsData(), [selectedBankMovements, bankMovements])

  const dateMismatchInfo = useMemo(() => {
    if (selectedBankMovements.size === 0 || selectedAccountingMovements.size === 0) {
      return { hasMismatch: false, bankMonths: [], accountingMonths: [] }
    }
    const getMonthKey = (dateString) => {
      if (!dateString || typeof dateString !== 'string') return null
      return dateString.slice(0, 7)
    }
    const selectedBankDetails = Array.from(selectedBankMovements).map((id) => {
      const movement = bankMovements.find(m => m.id === id)
      if (!movement?.date) return null
      return { id, date: movement.date, month: getMonthKey(movement.date) }
    }).filter(Boolean)
    const selectedAccountingDetails = Array.from(selectedAccountingMovements).map((key) => {
      const mov = accountingMovements.find(m => (m.name === key) || (m.voucher_no === key))
      if (!mov?.date) return null
      return { id: mov.name, date: mov.date, month: getMonthKey(mov.date) }
    }).filter(Boolean)
    if (selectedBankDetails.length === 0 || selectedAccountingDetails.length === 0) {
      return { hasMismatch: false, bankMonths: [], accountingMonths: [] }
    }
    const bankMonths = Array.from(new Set(selectedBankDetails.map(item => item.month).filter(Boolean)))
    const accountingMonths = Array.from(new Set(selectedAccountingDetails.map(item => item.month).filter(Boolean)))
    if (bankMonths.length === 0 || accountingMonths.length === 0) {
      return { hasMismatch: false, bankMonths, accountingMonths }
    }
    const monthsDiffer = bankMonths.some(month => !accountingMonths.includes(month)) ||
      accountingMonths.some(month => !bankMonths.includes(month))
    if (!monthsDiffer) {
      return { hasMismatch: false, bankMonths, accountingMonths }
    }
    const sampleBank = selectedBankDetails.find(detail => !accountingMonths.includes(detail.month)) || selectedBankDetails[0]
    const sampleAccounting = selectedAccountingDetails.find(detail => !bankMonths.includes(detail.month)) || selectedAccountingDetails[0]
    return {
      hasMismatch: true,
      bankMonths,
      accountingMonths,
      sampleBankDate: sampleBank?.date || null,
      sampleAccountingDate: sampleAccounting?.date || null
    }
  }, [selectedBankMovements, selectedAccountingMovements, bankMovements, accountingMovements])

  const formatMonthLabel = (monthKey) => {
    if (!monthKey) return 'sin fecha'
    const [year, month] = monthKey.split('-')
    if (!year || !month) return monthKey
    const date = new Date(Number(year), Number(month) - 1, 1)
    if (Number.isNaN(date.getTime())) return monthKey
    return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  }

  useEffect(() => {
    setDateMismatchAcknowledged(false)
  }, [selectedBankMovements, selectedAccountingMovements])
  
  const handleBancoModalClose = () => {
    setIsBancoModalOpen(false)
    setBancoModalMode(null)
    setSelectedParty(null)
    setSelectedPartyType(null)
  }
  
  const handleBancoModalSave = async (result) => {
    // Refresh movements
    if (selectedTreasuryAccount) {
      await handleRefreshMovements()
    }

    // Limpiar selección
    setSelectedBankMovements(new Set())
    setSelectedAccountingMovements(new Set())
    
    handleBancoModalClose()
  }

  const handleFreeConversionIntent = async (config) => {
    if (!accountDetails?.name || !selectedTreasuryAccount) {
      throw new Error('Selecciona una cuenta de tesoreria antes de conciliar automaticamente.')
    }
    if (!selectedBankTransactionsData.length) {
      throw new Error('No hay movimientos bancarios seleccionados para conciliar.')
    }

    const targetAccount = config.strategy === 'mapping'
      ? (config.mapping?.cuenta_contable_name || config.mapping?.cuenta_contable)
      : config.account?.name

    if (!targetAccount) {
      throw new Error('Selecciona una cuenta contable valida para continuar.')
    }

    const requestBody = {
      strategy: config.strategy,
      bank_account: accountDetails.name,
      bank_account_display_name: accountDetails.account_name,
      bank_account_docname: accountDetails.bank_account_id || accountDetails.bank_account,
      target_account: targetAccount,
      mapping: config.mapping ? {
        name: config.mapping.name,
        nombre: config.mapping.nombre,
        cuenta_contable: config.mapping.cuenta_contable,
        cuenta_contable_name: config.mapping.cuenta_contable_name
      } : null,
      account: config.account ? {
        name: config.account.name,
        account_name: config.account.account_name
      } : null,
      selected_bank_transactions: selectedBankTransactionsData
    }

    try {
      const response = await fetchWithAuth('/api/unpaid-movements/auto-convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeCompany ? { 'X-Active-Company': activeCompany } : {})
        },
        body: JSON.stringify(requestBody)
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'No pudimos crear la conciliacion automatica.')
      }

      showNotification(payload.message || 'Conciliamos los movimientos seleccionados.', 'success')

      if (selectedTreasuryAccount) {
        await handleRefreshMovements()
      }

      setSelectedBankMovements(new Set())
      return payload
    } catch (error) {
      console.error('Error en la conciliacion automatica:', error)
      throw error
    }
  }
  // Funciones para búsqueda y filtrado
  const filterMovements = (movements, searchTerm) => {
    if (!searchTerm) return movements
    const term = searchTerm.toLowerCase()
    return movements.filter(movement =>
      movement.description?.toLowerCase().includes(term) ||
      movement.reference?.toLowerCase().includes(term) ||
      movement.date?.includes(term) ||
      formatBalance(Math.abs(movement.amount || movement.debit || movement.credit || 0)).includes(term)
    )
  }
  // Funciones para ordenamiento
  const sortMovements = (movements, sortConfig) => {
    return [...movements].sort((a, b) => {
      let aValue, bValue
      switch (sortConfig.field) {
        case 'date':
          aValue = new Date(a.date)
          bValue = new Date(b.date)
          break
        case 'description':
          aValue = a.description?.toLowerCase() || ''
          bValue = b.description?.toLowerCase() || ''
          break
        case 'amount':
          aValue = Math.abs(a.amount || a.debit || a.credit || 0)
          bValue = Math.abs(b.amount || b.debit || b.credit || 0)
          break
        case 'reference':
          aValue = a.reference?.toLowerCase() || ''
          bValue = b.reference?.toLowerCase() || ''
          break
        default:
          return 0
      }
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
  }
  // Funciones para manejar ordenamiento
  const handleSort = (table, field) => {
    const sortConfig = table === 'bank' ? bankSort : accountingSort
    const setSortConfig = table === 'bank' ? setBankSort : setAccountingSort
    if (sortConfig.field === field) {
      setSortConfig({
        field,
        direction: sortConfig.direction === 'asc' ? 'desc' : 'asc'
      })
    } else {
      setSortConfig({ field, direction: 'asc' })
    }
  }
  // Funciones para selección
  const handleSelectMovement = (table, movementId, checked) => {
    const setSelected = table === 'bank' ? setSelectedBankMovements : setSelectedAccountingMovements
    const selected = table === 'bank' ? selectedBankMovements : selectedAccountingMovements
    const newSelected = new Set(selected)
    if (checked) {
      newSelected.add(movementId)
    } else {
      newSelected.delete(movementId)
    }
    setSelected(newSelected)
  }
  const handleSelectAll = (table, movements, checked) => {
    const setSelected = table === 'bank' ? setSelectedBankMovements : setSelectedAccountingMovements
    if (checked) {
      setSelected(new Set(movements.map(m => m.id || m.name)))
    } else {
      setSelected(new Set())
    }
  }
  // Función para conciliar movimientos seleccionados (manual)
  const handleReconcile = async () => {
    try {
      // Require at least one bank transaction selected
      if (selectedBankMovements.size === 0) {
        showNotification('Selecciona al menos un movimiento bancario para conciliar manualmente.', 'warning')
        return
      }
      if (selectedAccountingMovements.size === 0) {
        showNotification('Selecciona por lo menos un movimiento contable para conciliar.', 'warning')
        return
      }
      if (dateMismatchInfo.hasMismatch && !dateMismatchAcknowledged) {
        const bankMonthsLabel = (dateMismatchInfo.bankMonths || []).length
          ? dateMismatchInfo.bankMonths.map(formatMonthLabel).join(', ')
          : 'sin fecha'
        const accountingMonthsLabel = (dateMismatchInfo.accountingMonths || []).length
          ? dateMismatchInfo.accountingMonths.map(formatMonthLabel).join(', ')
          : 'sin fecha'
        showNotification(
          `Fechas fuera de mes: los movimientos bancarios (${bankMonthsLabel}) no coinciden con los comprobantes contables (${accountingMonthsLabel}). Ajusta la fecha del comprobante para mantener los saldos alineados o confirma que asumes la conciliacion fuera de mes.`,
          'warning'
        )
        return
      }
      // Build vouchers from selected accounting movements (use voucher_type + voucher_no when available)
      const accountingVouchers = Array.from(selectedAccountingMovements).map(nameOrId => {
        const mov = accountingMovements.find(m => (m.name === nameOrId) || (m.voucher_no === nameOrId))
        if (!mov) return null
        const total = (mov.debit || 0) - (mov.credit || 0)
        return {
          movement: mov,
          amount: Math.abs(total),
          voucher: {
            payment_doctype: mov.voucher_type || 'Journal Entry',
            payment_name: mov.voucher_no || mov.name,
            amount: Math.abs(total)
          }
        }
      }).filter(Boolean)
      if (accountingVouchers.length === 0) {
        showNotification('No se encontraron comprobantes válidos para conciliar.', 'warning')
        return
      }
      // Sort bank movements and accounting vouchers by amount for pairing
      const sortedBanks = Array.from(selectedBankMovements).map(id => {
        const mov = bankMovements.find(m => m.id === id)
        return { id, amount: Math.abs(mov.amount), movement: mov }
      }).sort((a, b) => a.amount - b.amount)
      const sortedAccounting = accountingVouchers.sort((a, b) => a.amount - b.amount)
      // Calculate totals
      const totalBank = sortedBanks.reduce((sum, b) => sum + b.amount, 0)
      const totalAccounting = sortedAccounting.reduce((sum, a) => sum + a.amount, 0)
      if (Math.abs(totalBank - totalAccounting) > 0.01) {
        showNotification('Los montos totales de los movimientos bancarios y contables seleccionados no coinciden.', 'warning')
        return
      }
      if (sortedBanks.length !== sortedAccounting.length && sortedBanks.length !== 1 && sortedAccounting.length !== 1) {
        showNotification('Para conciliar múltiples movimientos bancarios con múltiples comprobantes, el número debe ser igual. Para 1 a muchos o muchos a 1, seleccione 1 de un lado.', 'warning')
        return
      }
      // Reconcile based on selection
      let successCount = 0
      let errorMessages = []
      if (sortedBanks.length === 1) {
        // 1 bank, many accounting
        const bank = sortedBanks[0]
        const vouchers = sortedAccounting.map(a => a.voucher)
        try {
          const response = await fetchWithAuth(API_ROUTES.bankMatching.reconcile(bank.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vouchers })
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || !payload?.success) {
            errorMessages.push(`${bank.id}: ${payload?.message || 'Error desconocido'}`)
          } else {
            successCount++
          }
        } catch (error) {
          errorMessages.push(`${bank.id}: ${error.message}`)
        }
      } else if (sortedAccounting.length === 1) {
        // many banks, 1 accounting
        const accounting = sortedAccounting[0]
        for (const bank of sortedBanks) {
          const voucher = {
            payment_doctype: accounting.voucher.payment_doctype,
            payment_name: accounting.voucher.payment_name,
            amount: bank.amount  // Use bank amount for partial reconciliation
          }
          try {
            const response = await fetchWithAuth(API_ROUTES.bankMatching.reconcile(bank.id), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ vouchers: [voucher] })
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || !payload?.success) {
              errorMessages.push(`${bank.id}: ${payload?.message || 'Error desconocido'}`)
            } else {
              successCount++
            }
          } catch (error) {
            errorMessages.push(`${bank.id}: ${error.message}`)
          }
        }
      } else {
        // equal number, pair them
        for (let i = 0; i < sortedBanks.length; i++) {
          const bank = sortedBanks[i]
          const accounting = sortedAccounting[i]
          try {
            const response = await fetchWithAuth(API_ROUTES.bankMatching.reconcile(bank.id), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ vouchers: [accounting.voucher] })
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || !payload?.success) {
              errorMessages.push(`${bank.id}: ${payload?.message || 'Error desconocido'}`)
            } else {
              successCount++
            }
          } catch (error) {
            errorMessages.push(`${bank.id}: ${error.message}`)
          }
        }
      }
      if (successCount > 0) {
        showNotification(`Conciliación completada: ${successCount} conciliación(es) exitosa(s).`, 'success')
        if (errorMessages.length > 0) {
          showNotification(`Errores en algunas conciliaciones: ${errorMessages.join('; ')}`, 'warning')
        }
      } else {
        showNotification(`No se pudo conciliar ninguna: ${errorMessages.join('; ')}`, 'error')
      }
      // Refresh lists
      await handleRefreshMovements()
      // Clear selection
      setSelectedBankMovements(new Set())
      setSelectedAccountingMovements(new Set())
      return
    } catch (error) {
      console.error('Error manual reconciling:', error)
      showNotification(error.message || 'Error al conciliar manualmente.', 'error')
    }
  }
  const getLinkedPaymentEntries = (movement) => {
    if (!movement) return []
    if (Array.isArray(movement?.matched_vouchers)) return movement.matched_vouchers
    if (Array.isArray(movement?.linked_payments)) return movement.linked_payments
    if (Array.isArray(movement?.references)) return movement.references
    return []
  }
  const isBankMovementFullyReconciled = (movement) => {
    if (!movement) {
      return false
    }
    if (typeof movement.is_reconciled === 'boolean') {
      return movement.is_reconciled
    }
    const unallocated = Number(movement?.unallocated_amount ?? 0)
    if (unallocated === 0) {
      return true
    }
    const linked = getLinkedPaymentEntries(movement)
    return linked.some((entry) => Number(entry?.delinked ?? 0) === 0)
  }
  const reconciledLedgerIdentifiers = useMemo(() => {
    // Prefer identifiers computed by the backend from the full data set when
    // available (so searching/filtering the bank table doesn't change the
    // reconciliation markers used by the accounting table).
    if (bankReconciledIdentifiers && bankReconciledIdentifiers.size > 0) {
      return new Set(bankReconciledIdentifiers)
    }
    const identifiers = new Set()
    bankMovements.forEach((movement) => {
      const linked = getLinkedPaymentEntries(movement)
      linked.forEach((entry) => {
        if (Number(entry?.delinked ?? 0) !== 0) {
          return
        }
        const docType = entry?.payment_doctype || entry?.voucher_type || 'Payment Entry'
        const docName = entry?.payment_name || entry?.payment_entry || entry?.voucher_no || entry?.name
        if (docType && docName) {
          identifiers.add(`${docType}:${docName}`)
        }
      })
    })
    return identifiers
  }, [bankMovements, bankReconciledIdentifiers])
  const isAccountingMovementReconciled = (movement) => {
    const docType = movement?.voucher_type || 'Journal Entry'
    const docName = movement?.voucher_no || movement?.name
    if (!docName) {
      return false
    }
    return reconciledLedgerIdentifiers.has(`${docType}:${docName}`)
  }
  const reconciledTotals = useMemo(() => {
    const bankTotal = Array.from(selectedBankMovements || []).reduce((sum, id) => {
      const mv = bankMovements.find(m => (m.id === id) || (m.name === id))
      return sum + (mv ? (mv.amount || 0) : 0)
    }, 0)
    const accountingTotal = Array.from(selectedAccountingMovements || []).reduce((sum, id) => {
      const mv = accountingMovements.find(m => (m.name === id) || (m.voucher_no === id))
      if (!mv) return sum
      const total = (mv.debit || 0) - (mv.credit || 0)
      return sum + total
    }, 0)
    return {
      bankTotal,
      accountingTotal,
      difference: bankTotal - accountingTotal
    }
  }, [bankMovements, accountingMovements, selectedBankMovements, selectedAccountingMovements])
  const accountingMovementsMap = useMemo(() => {
    const map = new Map()
    accountingMovements.forEach((movement) => {
      const docType = movement?.voucher_type || 'Journal Entry'
      const docName = movement?.voucher_no || movement?.name
      if (docName) {
        map.set(`${docType}:${docName}`, movement)
      }
    })
    return map
  }, [accountingMovements])
  const reconciledGroups = useMemo(() => {
    const processedBanks = new Set()
    const processedVouchers = new Set()
    const groups = []
    // First, collect all links
    const voucherToBanks = new Map()
    const bankToVouchers = new Map()
    bankMovements.forEach((movement) => {
      if (!isBankMovementFullyReconciled(movement)) {
        return
      }
      const linked = getLinkedPaymentEntries(movement)
      linked.forEach((entry) => {
        const docType = entry?.payment_doctype || entry?.payment_document || entry?.voucher_type || 'Payment Entry'
        const docName = entry?.payment_name || entry?.payment_entry || entry?.voucher_no || entry?.name
        const vKey = docName ? `${docType}:${docName}` : `${movement.id}-voucher-${Math.random()}`
        if (!voucherToBanks.has(vKey)) voucherToBanks.set(vKey, [])
        voucherToBanks.get(vKey).push(movement)
        if (!bankToVouchers.has(movement.id)) bankToVouchers.set(movement.id, [])
        bankToVouchers.get(movement.id).push({ docType, docName, entry })
      })
    })
    // Group by voucher if it has multiple banks
    voucherToBanks.forEach((banks, vKey) => {
      if (banks.length > 1 && !processedVouchers.has(vKey)) {
        const firstEntry = banks[0].matched_vouchers?.find(v => `${v.docType}:${v.docName}` === vKey) || banks[0].linked_payments?.find(v => `${v.payment_doctype}:${v.payment_name}` === vKey) || {}
        const accountingMovement = accountingMovementsMap.get(vKey)
        const voucher = {
          docType: firstEntry.docType || firstEntry.payment_doctype,
          docName: firstEntry.docName || firstEntry.payment_name,
          amount: accountingMovement
            ? (accountingMovement.debit || 0) - (accountingMovement.credit || 0)
            : firstEntry.allocated_amount || 0,
          raw: firstEntry,
          date: accountingMovement?.date
        }
        groups.push({ type: 'voucher', voucher, accountingMovement, bankMovements: banks })
        banks.forEach(b => processedBanks.add(b.id))
        processedVouchers.add(vKey)
      }
    })
    // Then, for remaining, group by bank if it has multiple vouchers
    bankToVouchers.forEach((vouchers, bankId) => {
      if (processedBanks.has(bankId)) return
      const bank = bankMovements.find(b => b.id === bankId)
      const filteredVouchers = vouchers.filter(v => !processedVouchers.has(`${v.docType}:${v.docName}`))
      if (filteredVouchers.length > 1) {
        groups.push({ type: 'bank', bankMovement: bank, vouchers: filteredVouchers.map(v => {
          const key = `${v.docType}:${v.docName}`
          const accountingMovement = accountingMovementsMap.get(key)
          return {
            docType: v.docType,
            docName: v.docName,
            amount: accountingMovement ? (accountingMovement.debit || 0) - (accountingMovement.credit || 0) : v.entry?.allocated_amount || 0,
            raw: v.entry,
            date: accountingMovement?.date
          }
        }) })
        processedBanks.add(bankId)
        filteredVouchers.forEach(v => processedVouchers.add(`${v.docType}:${v.docName}`))
      } else if (filteredVouchers.length === 1) {
        // 1:1, group by bank
        const v = filteredVouchers[0]
        const accountingMovement = accountingMovementsMap.get(`${v.docType}:${v.docName}`)
        const voucher = {
          docType: v.docType,
          docName: v.docName,
          amount: accountingMovement
            ? (accountingMovement.debit || 0) - (accountingMovement.credit || 0)
            : v.entry?.allocated_amount || 0,
          raw: v.entry,
          date: accountingMovement?.date
        }
        groups.push({ type: 'bank', bankMovement: bank, vouchers: [voucher] })
        processedBanks.add(bankId)
        processedVouchers.add(`${v.docType}:${v.docName}`)
      }
    })
    return groups
  }, [bankMovements, accountingMovementsMap, isBankMovementFullyReconciled])
  // Movimientos filtrados y ordenados
  const filteredBankMovements = useMemo(() => {
    let filtered = filterMovements(bankMovements, bankSearch)
    if (conciliationTab === 'reconciled') {
      filtered = filtered.filter(isBankMovementFullyReconciled)
    } else if (conciliationTab === 'unreconciled') {
      filtered = filtered.filter((movement) => !isBankMovementFullyReconciled(movement))
    }
    return sortMovements(filtered, bankSort)
  }, [bankMovements, bankSearch, bankSort, conciliationTab])
  const filteredAccountingMovements = useMemo(() => {
    let filtered = filterMovements(accountingMovements, accountingSearch)
    if (conciliationTab === 'reconciled') {
      filtered = filtered.filter(isAccountingMovementReconciled)
    } else if (conciliationTab === 'unreconciled') {
      filtered = filtered.filter((movement) => !isAccountingMovementReconciled(movement))
    }
    return sortMovements(filtered, accountingSort)
  }, [accountingMovements, accountingSearch, accountingSort, conciliationTab, reconciledLedgerIdentifiers])
  // Función para cargar cuentas contables disponibles para tesorería
  const fetchAccountingAccounts = async () => {
    try {
      console.log('=== DEBUG: fetchAccountingAccounts called ===')
      setLoadingAccounts(true)
      const response = await fetchWithAuth(`/api/bank-cash-accounts`)
      console.log('DEBUG: Response received:', response)
      if (response.ok) {
        const data = await response.json()
        console.log('DEBUG: Response data:', data)
        if (data.success) {
          console.log('DEBUG: Setting available accounts:', data.data)
          setAccountingAccounts(data.data)
          console.log('DEBUG: Accounting accounts set to:', data.data)
        } else {
          console.log('DEBUG: API returned error:', data.message)
          showNotification(data.message || 'Error al cargar cuentas disponibles', 'error')
        }
      } else {
        console.log('DEBUG: HTTP error:', response.status, response.statusText)
        showNotification('Error al cargar cuentas disponibles', 'error')
      }
    } catch (error) {
      console.error('DEBUG: Exception in fetchAccountingAccounts:', error)
      showNotification('Error al cargar cuentas disponibles', 'error')
    } finally {
      setLoadingAccounts(false)
    }
  }
  // Función para cargar bancos disponibles
  const fetchBanks = async () => {
    try {
      console.log('=== DEBUG: fetchBanks called ===')
      setLoadingBanks(true)
      const response = await fetchWithAuth(`/api/setup2/list-banks`)
      console.log('DEBUG: Response received:', response)
      if (response.ok) {
        const data = await response.json()
        console.log('DEBUG: Response data:', data)
        if (data.success) {
          console.log('DEBUG: Setting banks:', data.data)
          setBanks(data.data)
          console.log('DEBUG: Banks set to:', data.data)
        } else {
          console.log('DEBUG: API returned error:', data.message)
          showNotification(data.message || 'Error al cargar bancos', 'error')
        }
      } else {
        console.log('DEBUG: HTTP error:', response.status, response.statusText)
        showNotification('Error al cargar bancos', 'error')
      }
    } catch (error) {
      console.error('DEBUG: Exception in fetchBanks:', error)
      showNotification('Error al cargar bancos', 'error')
    } finally {
      setLoadingBanks(false)
    }
  }
  // Crear una lista de opciones para el Select que SIEMPRE incluya la cuenta actual
  const accountingOptions = useMemo(() => {
    const requiredType = editedAccountData.type === 'cash' ? 'Cash' : 'Bank'
    const options = accountingAccounts.filter(
      (option) => (option.account_type || '').toLowerCase() === requiredType.toLowerCase()
    )
    // Verificar si estamos editando y si la cuenta actual no está en la lista de opciones
    if (editedAccountData.accounting_account) {
      const isCurrentAccountInOptions = options.some(
        opt => opt.value === editedAccountData.accounting_account
      );
      // Si no está, la agregamos al principio de la lista
      if (!isCurrentAccountInOptions) {
        options.unshift({
          value: editedAccountData.accounting_account,
          label: editedAccountData.accounting_account, // Asumimos que el label es igual al value
        });
      }
    }
    return options;
  }, [accountingAccounts, editedAccountData.accounting_account, editedAccountData.type]); // Se recalcula solo si estas dependencias cambian
  // Función para normalizar texto (quitar acentos, convertir a mayúsculas)
  const normalizeText = (text) => {
    if (!text) return '';
    return text
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^A-Z0-9\s]/g, '') // Remove special chars except spaces
      .trim();
  };
  // Función para obtener iniciales del banco
  const getBankInitials = (modeOfPayment) => {
    if (modeOfPayment === 'Nueva') return '+';
    let cleaned = modeOfPayment.replace(/\b(BANCO|BANK|S\.A\.?|SOCIEDAD ANONIMA|COOPERATIVO|COOP\.?|LIMITED|LTD\.?|INC\.?|CORPORATION|CORP\.?|ARGENTINA|ARG\.?|TRANSFERENCIA|PAGO|ELECTRONICO|ANC)\b/gi, '').trim();
    let bankPart = cleaned.split(' - ')[0].trim();
    let words = bankPart.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 1) {
      return words[0].substring(0, 2).toUpperCase();
    } else if (words.length >= 2) {
      return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
    }
    return 'BK';
  };
  // Crear opciones del select de bancos asegurando que incluya el banco actual aunque no esté en la lista
  const bankOptions = useMemo(() => {
    const options = banks.map((bank) => {
      const displayName = bank.bank_name || bank.name || ''
      return {
        name: displayName,
        value: bank.name || displayName,
        normalizedName: normalizeText(displayName || bank.name || '')
      }
    })
    const currentBankNormalized = normalizeText(editedAccountData.bank_name)
    if (currentBankNormalized && !options.some((option) => option.normalizedName === currentBankNormalized)) {
      options.unshift({
        name: editedAccountData.bank_name,
        value: editedAccountData.bank_name,
        normalizedName: currentBankNormalized
      })
    }
    return options
  }, [banks, editedAccountData.bank_name])
  return (
    <div className="h-full flex gap-6">
      <div className={`bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden transition-all duration-300 ${accountsPanelCollapsed ? 'w-20' : 'w-1/3'}`}>
        {accountsPanelCollapsed ? (
          // Vista colapsada - lista de cuentas con iniciales
          <div className="p-4 flex flex-col items-center gap-4">
            <button
              onClick={() => setAccountsPanelCollapsed(false)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors duration-200"
              title="Expandir panel de cuentas"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex flex-col gap-3 w-full">
              {treasuryAccounts.map(account => {
                const initials = getBankInitials(account.mode_of_payment);
                const isSelected = selectedTreasuryAccount === account.id;
                return (
                  <button
                    key={account.id}
                    onClick={() => setSelectedTreasuryAccount(account.id)}
                    className={`account-initials-btn p-3 rounded-lg transition-all duration-200 text-center font-bold text-sm ${
                      isSelected ? 'selected' : ''
                    }`}
                    title={account.mode_of_payment}
                  >
                    {initials}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          // Vista expandida - contenido completo
          <>
            <div className="accounting-card-title">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  <h3 className="text-lg font-black text-gray-900">Panel de Cuentas</h3>
                </div>
                <button
                  onClick={() => setAccountsPanelCollapsed(true)}
                  className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors duration-200"
                  title="Colapsar panel"
                >
                  <ChevronRight className="w-5 h-5 text-gray-600 rotate-180" />
                </button>
              </div>
            </div>
            <div className="p-4 flex flex-col gap-6">
              <TreasuryAccountsList
                loading={loading}
                treasuryAccounts={treasuryAccounts}
                selectedTreasuryAccount={selectedTreasuryAccount}
                onSelectAccount={setSelectedTreasuryAccount}
                onAddAccount={handleAddAccount}
                getAccountTypeIcon={getAccountTypeIcon}
                getAccountTypeLabel={getAccountTypeLabel}
                handleMercadoPagoSync={handleMercadoPagoSync}
                syncingMercadoPago={syncingMercadoPago}
              />
              <TreasuryAccountPanel
                isEditingAccount={isEditingAccount}
                selectedTreasuryAccount={selectedTreasuryAccount}
                accountDetails={accountDetails}
                handleEditAccount={handleEditAccount}
                handleDeleteAccount={handleDeleteAccount}
                editedAccountData={editedAccountData}
                handleEditChange={handleEditChange}
                handleCancelEdit={handleCancelEdit}
                handleCreateAccount={handleCreateAccount}
                handleSaveAccount={handleSaveAccount}
                savingAccount={savingAccount}
                loadingAccounts={loadingAccounts}
                accountingOptions={accountingOptions}
                loadingBanks={loadingBanks}
                bankOptions={bankOptions}
                getAccountTypeLabel={getAccountTypeLabel}
                formatBalance={formatBalance}
                handleMercadoPagoAutoSyncToggle={handleMercadoPagoAutoSyncToggle}
                updatingMercadoPagoAutoSync={updatingMercadoPagoAutoSync}
                syncingMercadoPago={syncingMercadoPago}
                handleMercadoPagoSync={handleMercadoPagoSync}
                isMercadoPagoAccount={isMercadoPagoAccount}
                normalizeText={normalizeText}
              />
            </div>
          </>
        )}
      </div>
      <ConciliationPanel
        selectedTreasuryAccount={selectedTreasuryAccount}
        accountDetails={accountDetails}
        conciliationTab={conciliationTab}
        setConciliationTab={setConciliationTab}
        reconciledGroups={reconciledGroups}
        reconciledTotals={reconciledTotals}
        handleReconcile={handleReconcile}
        selectedBankMovements={selectedBankMovements}
        selectedAccountingMovements={selectedAccountingMovements}
        bankSearch={bankSearch}
        setBankSearch={setBankSearch}
        accountingSearch={accountingSearch}
        setAccountingSearch={setAccountingSearch}
        bankSort={bankSort}
        accountingSort={accountingSort}
        handleSort={handleSort}
        filteredBankMovements={filteredBankMovements}
        filteredAccountingMovements={filteredAccountingMovements}
        handleSelectAll={handleSelectAll}
        handleSelectMovement={handleSelectMovement}
        formatDate={formatDate}
        formatBalance={formatBalance}
        dateMismatchInfo={dateMismatchInfo}
        dateMismatchAcknowledged={dateMismatchAcknowledged}
        onAcknowledgeDateMismatch={setDateMismatchAcknowledged}
        pendingDateRange={pendingDateRange}
        onDateInputChange={handleDateInputChange}
        onApplyDateRange={handleApplyDateRange}
        dateRangeError={dateRangeError}
        refreshingMovements={bankLoading || accountingLoading}
        bankPage={bankPage}
        onChangeBankPage={handleBankPageChange}
        bankHasMore={bankHasMore}
        accountingPage={accountingPage}
        onChangeAccountingPage={handleAccountingPageChange}
        accountingHasMore={accountingHasMore}
        bankLoading={bankLoading}
        accountingLoading={accountingLoading}
        pageSize={MOVEMENTS_PAGE_SIZE}
        onRequestImport={() => setIsImportModalOpen(true)}
        onRequestAutoMatch={handleOpenAutoMatchModal}
        onRequestRegisterPayment={handleOpenRegisterPaymentModal}
        onRequestConvertBankTransactions={handleConvertBankTransactions}
        autoMatchLoading={autoMatchSetupLoading}
        onUndoReconciliation={handleUndoReconciliation}
        undoingTransactionId={undoingTransactionId}
        pendingUnreconciles={pendingUnreconciles}
        onToggleReconciled={handleToggleReconciledState}
        onSaveReconciledChanges={handleSaveReconciledChanges}
        savingReconciledChanges={savingReconciledChanges}
        onRequestDelete={handleDeleteBankMovements}
      />
      <ConfirmDialog />
      <BankAutoMatchingModal
        isOpen={isAutoMatchModalOpen}
        onClose={closeAutoMatchModal}
        transactions={bankMovements}
        accountDetails={accountDetails}
        ensuringAutoMatching={autoMatchSetupLoading}
        fetchSuggestions={fetchAutoMatchSuggestions}
        onReconcile={handleAutoMatchReconcile}
      />
      <BankMovementsImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        bankAccount={accountDetails?.bank_account_id || accountDetails?.name}
        accountCurrency={accountDetails?.currency || accountDetails?.account_currency}
        onImportComplete={async () => {
          // Refresh bank movements after import
          if (selectedTreasuryAccount) {
            await handleRefreshMovements()
          }
        }}
      />
      <RegisterPaymentModal
        isOpen={isRegisterPaymentModalOpen}
        onClose={() => setIsRegisterPaymentModalOpen(false)}
        accountDetails={accountDetails}
        currency={accountDetails?.currency || accountDetails?.account_currency}
        treasuryAccounts={treasuryAccounts}
        currentAccountId={selectedTreasuryAccount}
        onSubmitPayment={handleRegisterPaymentSubmit}
        onSubmitCashExchange={handleRegisterCashExchange}
      />
      <BankTransactionActionSelector
        isOpen={isActionSelectorOpen}
        onClose={() => setIsActionSelectorOpen(false)}
        onSelectAction={handleActionSelected}
        onConfirmFreeConversion={handleFreeConversionIntent}
        selectedCount={selectedBankMovements.size}
        selectedTransactions={selectedBankTransactionsData}
        accountDetails={accountDetails}
      />
      <PartySelector
        isOpen={isPartySelectorOpen}
        onClose={() => {
          setIsPartySelectorOpen(false)
          setSelectedPartyType(null)
        }}
        onSelectParty={handlePartySelected}
        partyType={selectedPartyType}
      />
      {isBancoModalOpen && bancoModalMode === 'unpaid' && (
        <UnpaidMovementModal
          isOpen={true}
          onClose={handleBancoModalClose}
          mode="BANCO"
          selectedBankTransactions={getSelectedBankTransactionsData()}
          bankAccount={accountDetails?.name}
          onSave={handleBancoModalSave}
        />
      )}
      {isBancoModalOpen && bancoModalMode === 'cash_exchange' && (
        <UnpaidMovementModal
          isOpen={true}
          onClose={handleBancoModalClose}
          mode="BANCO"
          selectedBankTransactions={getSelectedBankTransactionsData()}
          bankAccount={accountDetails?.name}
          onSave={handleBancoModalSave}
          variant="cash_exchange"
        />
      )}
      {isBancoModalOpen && bancoModalMode === 'customer_payment' && selectedParty && (
        <PaymentModal
          isOpen={true}
          onClose={handleBancoModalClose}
          selectedCustomer={selectedParty.name}
          customerDetails={selectedParty}
          onSave={handleBancoModalSave}
          mode="BANCO"
          selectedBankTransactions={getSelectedBankTransactionsData()}
          bankAccountDetails={accountDetails}
        />
      )}
      {isBancoModalOpen && bancoModalMode === 'supplier_payment' && selectedParty && (
        <SupplierPaymentModal
          isOpen={true}
          onClose={handleBancoModalClose}
          selectedSupplier={selectedParty.name}
          supplierDetails={selectedParty}
          onSave={handleBancoModalSave}
          mode="BANCO"
          selectedBankTransactions={getSelectedBankTransactionsData()}
          bankAccountDetails={accountDetails}
        />
      )}
    </div>
  )
}
