import React, { useState, useEffect, useContext, useRef, useMemo, useCallback } from 'react'
import { AuthContext } from '../AuthProvider'
import { NotificationContext } from '../contexts/NotificationContext'
import API_ROUTES from '../apiRoutes'
import { ChevronRight, ChevronDown, Folder, FileText, Plus, Edit, Trash2, Calculator, BarChart3, Receipt, Save, Check, X, Circle, Settings, CalendarDays, TrendingUp } from 'lucide-react'
import Select from 'react-select'
import useCurrencies from '../hooks/useCurrencies'
import JournalEntryModal from './modals/JournalEntryModal.jsx'
import InvoiceModal from './modals/InvoiceModal/InvoiceModal.jsx'
import PurchaseInvoiceModal from './modals/PurchaseInvoiceModal/PurchaseInvoiceModal.jsx'
import GenericPaymentModal from './modals/GenericPaymentModal.jsx'
import PaymentModal from './modals/PaymentModal.jsx'
import SupplierPaymentModal from './modals/SupplierPaymentModal.jsx'
import SalesRemitoModal from './modals/SalesRemitoModal/SalesRemitoModal.jsx'
import RemitoModal from './modals/RemitoModal/RemitoModal.jsx'
import Modal from './Modal.jsx'
import { parseAfipComprobanteName } from '../utils/comprobantes'
import StockReconciliationModal from './modals/StockReconciliationModal.jsx'
import { useConfirm } from '../hooks/useConfirm'

const ACCOUNT_TYPE_OPTIONS = [
  { value: '', label: 'No especificado' },
  { value: 'Asset', label: 'Activo' },
  { value: 'Liability', label: 'Pasivo' },
  { value: 'Equity', label: 'Patrimonio' },
  { value: 'Income', label: 'Ingresos' },
  { value: 'Expense', label: 'Gastos' },
  { value: 'Bank', label: 'Bancos' },
  { value: 'Cash', label: 'Caja' },
  { value: 'Receivable', label: 'Cuentas por cobrar' },
  { value: 'Payable', label: 'Cuentas por pagar' },
  { value: 'Stock', label: 'Inventario' },
  { value: 'Stock Adjustment', label: 'Ajuste de inventario' },
  { value: 'Cost of Goods Sold', label: 'Costo de bienes vendidos' },
  { value: 'Deferred Revenue', label: 'Ingresos diferidos' },
  { value: 'Deferred Expense', label: 'Gastos diferidos' },
  { value: 'Fixed Asset', label: 'Activos fijos' },
  { value: 'Accumulated Depreciation', label: 'Depreciación acumulada' },
  { value: 'Depreciation', label: 'Depreciación' },
  { value: 'Round Off', label: 'Redondeo' },
  { value: 'Chargeable', label: 'Cobrable' },
  { value: 'Income Account', label: 'Cuenta de ingresos' },
  { value: 'Expense Account', label: 'Cuenta de gastos' },
  { value: 'Tax', label: 'Impuestos' },
  { value: 'Temporary', label: 'Temporal' },
]

const normalizeAccountType = (type = '') => {
  if (!type || type === 'No especificado') {
    return ''
  }
  const normalizedOption = ACCOUNT_TYPE_OPTIONS.find(
    (option) => option.value.toLowerCase() === type.toLowerCase()
  )
  return normalizedOption ? normalizedOption.value : type
}

const getAccountTypeLabel = (type = '') => {
  const normalizedType = normalizeAccountType(type)
  if (!normalizedType) {
    return 'No especificado'
  }
  const matchingOption = ACCOUNT_TYPE_OPTIONS.find((option) => option.value === normalizedType)
  return matchingOption ? matchingOption.label : type
}

const VOUCHER_ABBREVIATIONS = {
  'journal entry': 'JE',
  'payment entry': 'PE',
  'sales invoice': 'SI',
  'purchase invoice': 'PI',
  'purchase entry': 'PE',
  'expense claim': 'EC',
  'stock entry': 'SE',
  'delivery note': 'DN'
}

const getVoucherTypeAbbreviation = (value = '') => {
  if (!value) {
    return '--'
  }
  const normalized = value.trim().toLowerCase()
  if (VOUCHER_ABBREVIATIONS[normalized]) {
    return VOUCHER_ABBREVIATIONS[normalized]
  }
  const letters = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
  return letters ? letters.slice(0, 3).toUpperCase() : value.slice(0, 3).toUpperCase()
}


export default function AccountingPanel() {
  const [accounts, setAccounts] = useState([])
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [accountDetails, setAccountDetails] = useState(null)
  const [accountMovements, setAccountMovements] = useState([])
  const [loading, setLoading] = useState(false)
  const [expandedNodes, setExpandedNodes] = useState(new Set())
  const [isJournalModalOpen, setIsJournalModalOpen] = useState(false)
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)
  const [isPurchaseInvoiceModalOpen, setIsPurchaseInvoiceModalOpen] = useState(false)
  const [isGenericPaymentModalOpen, setIsGenericPaymentModalOpen] = useState(false)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isSupplierPaymentModalOpen, setIsSupplierPaymentModalOpen] = useState(false)
  const [isSalesRemitoModalOpen, setIsSalesRemitoModalOpen] = useState(false)
  const [isPurchaseRemitoModalOpen, setIsPurchaseRemitoModalOpen] = useState(false)
  const [isStockReconciliationModalOpen, setIsStockReconciliationModalOpen] = useState(false)
  const [selectedStockReconciliation, setSelectedStockReconciliation] = useState(null)
  const [isEditingAccount, setIsEditingAccount] = useState(false)
  const [editedAccountData, setEditedAccountData] = useState({})
  const [savingAccount, setSavingAccount] = useState(false)
  const [editingJournalEntry, setEditingJournalEntry] = useState(null) // Para almacenar datos del asiento que se está editando
  const [editingInvoice, setEditingInvoice] = useState(null) // Para almacenar datos de la factura que se está editando
  const [editingPurchaseInvoice, setEditingPurchaseInvoice] = useState(null) // Para almacenar datos de la factura de compra que se está editando
  const [editingPayment, setEditingPayment] = useState(null) // Para almacenar datos del pago que se está editando
  const [editingSupplierPayment, setEditingSupplierPayment] = useState(null) // Para almacenar datos del pago a proveedor que se está editando
  const [editingSalesRemitoName, setEditingSalesRemitoName] = useState(null)
  const [editingSalesRemitoData, setEditingSalesRemitoData] = useState(null)
  const [editingPurchaseRemitoName, setEditingPurchaseRemitoName] = useState(null)
  const [editingPurchaseRemitoData, setEditingPurchaseRemitoData] = useState(null)
  const [paymentMode, setPaymentMode] = useState('customer') // 'customer' o 'supplier'
  
  // Estados para pestañas
  const [movementsTab, setMovementsTab] = useState('current') // 'current', 'audit', 'drafts'
  const [auditMovements, setAuditMovements] = useState([]) // Movimientos de auditoría
  const [draftMovements, setDraftMovements] = useState([]) // Movimientos borradores
  const [accountBalances, setAccountBalances] = useState({}) // Saldos de cuentas del Trial Balance
  const [fiscalYears, setFiscalYears] = useState([]) // Lista de años fiscales disponibles
  const [selectedFiscalYear, setSelectedFiscalYear] = useState('') // Año fiscal seleccionado
  const [isFiscalYearModalOpen, setIsFiscalYearModalOpen] = useState(false)
  const [fiscalYearManagerLoading, setFiscalYearManagerLoading] = useState(false)
  const [fiscalYearManagerList, setFiscalYearManagerList] = useState([])
  const [creatingFiscalYearRecord, setCreatingFiscalYearRecord] = useState(false)
  const [newFiscalYearClosingYear, setNewFiscalYearClosingYear] = useState('')
  const [customClosingYear, setCustomClosingYear] = useState(false)
  const [isSavingJournalEntry, setIsSavingJournalEntry] = useState(false)

  const [accountSearch, setAccountSearch] = useState('')
  
  const [movementSearch, setMovementSearch] = useState('')

  const ACCOUNT_MOVEMENTS_PAGE_SIZE = 12
  const [movementsPagination, setMovementsPagination] = useState({
    current: 1,
    audit: 1,
    drafts: 1
  })
  
  // Estados para ordenamiento
  const [sortField, setSortField] = useState('posting_date')
  const [sortDirection, setSortDirection] = useState('desc') // 'asc' o 'desc'
  
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const { confirm, ConfirmDialog } = useConfirm()

  // Cargar monedas dinámicamente desde backend
  const { currencies, loading: currenciesLoading } = useCurrencies()

  // Refs para evitar refrescos innecesarios
  const lastActiveCompany = useRef(null)
  const lastSelectedFiscalYear = useRef(null)
  const shouldRefresh = useRef(true)
  const fiscalYearModalFetchTriggered = useRef(false)
  const lastFiscalYearModalCompany = useRef(activeCompany || null)
  const hasUserSelectedFiscalYear = useRef(false)

  const getFiscalYearDisplayName = useCallback((name = '') => {
    if (!name) {
      return ''
    }
    if (activeCompany && name.endsWith(` - ${activeCompany}`)) {
      return name.replace(` - ${activeCompany}`, '').trim()
    }
    const separatorIndex = name.lastIndexOf(' - ')
    if (separatorIndex !== -1) {
      return name.slice(0, separatorIndex).trim()
    }
    return name
  }, [activeCompany])

  const parseDateToUTC = (dateString) => {
    if (!dateString) {
      return null
    }
    const [year, month, day] = dateString.split('-').map(Number)
    if (!year || !month || !day) {
      return null
    }
    return new Date(Date.UTC(year, month - 1, day))
  }

  const createUTCDate = (year, monthIndex, day) => {
    return new Date(Date.UTC(year, monthIndex, day))
  }

  const addDaysUTC = (date, days) => {
    if (!date) return null
    const result = new Date(date.getTime())
    result.setUTCDate(result.getUTCDate() + days)
    return result
  }

  const formatDateISO = (date) => {
    if (!date) return ''
    return date.toISOString().split('T')[0]
  }

  const getMonthLabel = (monthIndex = 0) => {
    const baseDate = new Date(Date.UTC(2000, monthIndex, 1))
    const monthName = baseDate.toLocaleString('es-AR', { month: 'long', timeZone: 'UTC' })
    return monthName.charAt(0).toUpperCase() + monthName.slice(1)
  }

  const getLastDayOfMonth = (year, monthIndex) => {
    const targetYear = year && !Number.isNaN(year) ? year : new Date().getUTCFullYear()
    const date = new Date(Date.UTC(targetYear, monthIndex + 1, 0))
    return date.getUTCDate()
  }

  const findLatestFiscalYear = (yearList = []) => {
    if (!Array.isArray(yearList) || yearList.length === 0) {
      return null
    }
    return yearList.reduce((latest, current) => {
      if (!current?.year_end_date) {
        return latest
      }
      if (!latest?.year_end_date) {
        return current
      }
      return new Date(current.year_end_date) > new Date(latest.year_end_date) ? current : latest
    }, null)
  }


  // Función para limpiar el nombre de la cuenta (quitar abreviación de empresa)
  const cleanAccountName = (accountName) => {
    if (!accountName) return accountName
    // Buscar patrón " - XXX" al final y quitarlo
    const match = accountName.match(/^(.+?)\s-\s[A-Z]{2,4}$/)
    return match ? match[1] : accountName
  }

  // Cargar cuentas, años fiscales y saldos al montar el componente
  useEffect(() => {
    fetchAccounts()
    fetchFiscalYears()
    fetchTrialBalance()
    
    // Inicializar refs
    lastActiveCompany.current = activeCompany
    lastSelectedFiscalYear.current = selectedFiscalYear
  }, [])

  // Refrescar datos cuando cambie la empresa activa
  useEffect(() => {
    if (activeCompany && activeCompany !== lastActiveCompany.current && shouldRefresh.current) {
      console.log('Empresa activa cambió, refrescando datos...')
      lastActiveCompany.current = activeCompany
      // Resetear el año fiscal seleccionado cuando cambia la empresa
      setSelectedFiscalYear('')
      hasUserSelectedFiscalYear.current = false
      fetchAccounts()
      fetchFiscalYears()
      fetchTrialBalance()
    }
  }, [activeCompany])

  useEffect(() => {
    if (!Array.isArray(fiscalYears) || fiscalYears.length === 0) {
      return
    }
    if (selectedFiscalYear) {
      return
    }
    if (fiscalYears.length === 1) {
      setSelectedFiscalYear(fiscalYears[0].name)
      return
    }
    if (!hasUserSelectedFiscalYear.current) {
      const latest = findLatestFiscalYear(fiscalYears)
      if (latest?.name) {
        setSelectedFiscalYear(latest.name)
      }
    }
  }, [fiscalYears, selectedFiscalYear])

  // Refrescar saldos cuando cambie el año fiscal seleccionado
  useEffect(() => {
    if (selectedFiscalYear && selectedFiscalYear !== lastSelectedFiscalYear.current) {
      console.log('Año fiscal cambió, refrescando saldos...')
      lastSelectedFiscalYear.current = selectedFiscalYear
      fetchTrialBalance(selectedFiscalYear)
    }
  }, [selectedFiscalYear])

  // Cargar detalles cuando se selecciona una cuenta
  useEffect(() => {
    if (selectedAccount && selectedAccount !== 'new') {
      fetchAccountDetails(selectedAccount)
      fetchAccountMovements(selectedAccount)
      fetchAuditMovements(selectedAccount)
      fetchDraftMovements(selectedAccount)
    }
  }, [selectedAccount])

  // Refrescar saldos cuando cambie la empresa activa
  useEffect(() => {
    if (activeCompany && activeCompany !== lastActiveCompany.current && shouldRefresh.current) {
      console.log('Empresa activa cambió, refrescando Trial Balance...')
      fetchTrialBalance()
    }
  }, [activeCompany])

  const fetchAccounts = async () => {
    try {
      setLoading(true)
      const response = await fetchWithAuth(API_ROUTES.accounts)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAccounts(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAccountDetails = async (accountName) => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.accountDetails}${encodeURIComponent(accountName)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAccountDetails(data.data)
        }
      }
    } catch (error) {
      console.error('Error fetching account details:', error)
    }
  }

  const fetchAccountMovements = async (accountName) => {
    try {
      // Obtener movimientos de cuenta confirmados (excluyendo cancelados y borradores)
      const response = await fetchWithAuth(`${API_ROUTES.glEntries}?account=${encodeURIComponent(accountName)}&include_cancelled=false`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Filtrar solo movimientos confirmados (no cancelados, no borradores)
          const confirmedMovements = data.data.filter(movement => !movement.is_cancelled && !movement.is_draft)
          setAccountMovements(confirmedMovements)
        }
      }
    } catch (error) {
      console.error('Error fetching account movements:', error)
    }
  }

  const fetchAuditMovements = async (accountName) => {
    try {
      // Obtener TODOS los movimientos para auditoría (incluyendo cancelados)
      const response = await fetchWithAuth(`${API_ROUTES.glEntries}?account=${encodeURIComponent(accountName)}&include_cancelled=true`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAuditMovements(data.data || [])
        }
      } else {
        console.error('Error fetching audit movements:', response.status)
      }
    } catch (error) {
      console.error('Error fetching audit movements:', error)
    }
  }

  const fetchDraftMovements = async (accountName) => {
    try {
      console.log('Obteniendo borradores...')
      // Obtener asientos borradores - para borradores queremos todos los borradores, no filtrar por cuenta específica
      const response = await fetchWithAuth(`${API_ROUTES.journalEntries}?status=draft`)
      console.log('Respuesta de borradores:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('Datos de borradores:', data)
        if (data.success) {
          console.log('Primer borrador (si existe):', data.data?.[0])
          setDraftMovements(data.data || [])
          console.log('Borradores obtenidos:', data.data?.length || 0)
        }
      } else {
        console.error('Error fetching draft movements:', response.status)
      }
    } catch (error) {
      console.error('Error fetching draft movements:', error)
    }
  }

  const fetchTrialBalance = async (fiscalYear = '') => {
    try {
      console.log('Obteniendo Trial Balance...')
      const params = fiscalYear ? `?fiscal_year=${encodeURIComponent(fiscalYear)}` : ''
      const response = await fetchWithAuth(`${API_ROUTES.trialBalance}${params}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAccountBalances(data.data || {})
          // Si no se especificó año fiscal, usar el que devolvió el backend
          if (!fiscalYear && data.fiscal_year) {
            setSelectedFiscalYear(data.fiscal_year)
          }
          console.log('Trial Balance obtenido:', data.data)
        }
      } else {
        console.error('Error fetching trial balance:', response.status)
      }
    } catch (error) {
      console.error('Error fetching trial balance:', error)
    }
  }

  const fetchFiscalYears = async () => {
    try {
      console.log('Obteniendo años fiscales...')
      const response = await fetchWithAuth(API_ROUTES.fiscalYears)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const fiscalYearsData = data.data || []
          setFiscalYears(fiscalYearsData)
          console.log('Años fiscales obtenidos:', fiscalYearsData)

          setSelectedFiscalYear((current) => {
            if (!Array.isArray(fiscalYearsData) || fiscalYearsData.length === 0) {
              return current
            }
            if (fiscalYearsData.length === 1) {
              const singleFiscalYear = fiscalYearsData[0].name
              console.log('Solo un año fiscal disponible, seleccionado automáticamente:', singleFiscalYear)
              hasUserSelectedFiscalYear.current = false
              return singleFiscalYear
            }
            const hasExisting = current && fiscalYearsData.some((fy) => fy.name === current)
            if (hasUserSelectedFiscalYear.current && hasExisting) {
              return current
            }
            const latest = findLatestFiscalYear(fiscalYearsData)
            if (latest) {
              console.log('Múltiples años fiscales, seleccionado el último automáticamente:', latest.name)
              return latest.name
            }
            return current
          })
        }
      } else {
        console.error('Error fetching fiscal years:', response.status)
      }
    } catch (error) {
      console.error('Error fetching fiscal years:', error)
    }
  }

  const currentFiscalYearDetails = useMemo(() => {
    if (!Array.isArray(fiscalYears) || fiscalYears.length === 0) {
      return null
    }
    if (selectedFiscalYear) {
      return fiscalYears.find((fy) => fy.name === selectedFiscalYear) || fiscalYears[0]
    }
    return fiscalYears[0]
  }, [fiscalYears, selectedFiscalYear])

  const currentFiscalYearDisplay = useMemo(() => {
    const identifier = currentFiscalYearDetails?.name || currentFiscalYearDetails?.year
    if (!identifier) {
      return 'Sin ejercicio configurado'
    }
    const displayName = getFiscalYearDisplayName(identifier)
    return displayName || identifier
  }, [currentFiscalYearDetails, getFiscalYearDisplayName])

  const latestModalFiscalYear = useMemo(() => {
    if (!Array.isArray(fiscalYearManagerList) || fiscalYearManagerList.length === 0) {
      return null
    }
    return findLatestFiscalYear(fiscalYearManagerList)
  }, [fiscalYearManagerList])

  const modalClosingMeta = useMemo(() => {
    // Si no hay año fiscal previo, no podemos determinar el patrón de cierre
    if (!latestModalFiscalYear?.year_end_date) {
      return null
    }
    
    const latestEndDate = parseDateToUTC(latestModalFiscalYear.year_end_date)
    if (!latestEndDate) {
      return null
    }
    
    // Extraer mes y día del año fiscal existente
    const monthIndex = latestEndDate.getUTCMonth()
    const dayOfMonth = latestEndDate.getUTCDate()
    
    // Verificar que el día sea válido para ese mes
    const referenceYear = latestEndDate.getUTCFullYear()
    const lastDayOfMonth = getLastDayOfMonth(referenceYear, monthIndex)
    
    // Usar el día del año fiscal, pero asegurarse de que no exceda el último día del mes
    const day = Math.min(dayOfMonth, lastDayOfMonth)
    
    const label = getMonthLabel(monthIndex)
    const latestEndYear = latestEndDate.getUTCFullYear()
    
    return { monthIndex, day, label, latestEndYear }
  }, [latestModalFiscalYear])

  const sortedFiscalYearManagerList = useMemo(() => {
    if (!Array.isArray(fiscalYearManagerList)) {
      return []
    }
    return [...fiscalYearManagerList].sort((a, b) => {
      const aTime = a?.year_end_date ? new Date(a.year_end_date).getTime() : 0
      const bTime = b?.year_end_date ? new Date(b.year_end_date).getTime() : 0
      return bTime - aTime
    })
  }, [fiscalYearManagerList])

  const fetchFiscalYearCompanies = useCallback(
    async (parentNames = []) => {
      if (!activeCompany || !Array.isArray(parentNames) || parentNames.length === 0) {
        return null
      }
      try {
        const filters = {
          parent: ['in', parentNames],
          parenttype: 'Fiscal Year',
          parentfield: 'companies',
          company: activeCompany
        }
        const body = {
          doctype: 'Fiscal Year Company',
          fields: ['name', 'parent', 'company'],
          filters,
          limit_page_length: 1000
        }
        const response = await fetchWithAuth('/api/method/frappe.client.get_list', {
          method: 'POST',
          body: JSON.stringify(body)
        })
        if (response?.ok) {
          const payload = await response.json()
          const rows = Array.isArray(payload?.message) ? payload.message : []
          const companyMap = new Map()
          rows.forEach((row) => {
            if (!row?.parent) return
            if (!companyMap.has(row.parent)) {
              companyMap.set(row.parent, [])
            }
            if (row.company) {
              companyMap.get(row.parent).push(row.company)
            }
          })
          return companyMap
        } else if (response) {
          console.error('Error fetching Fiscal Year companies:', response.status)
        }
      } catch (error) {
        console.error('Error fetching Fiscal Year companies:', error)
      }
      return null
    },
    [fetchWithAuth, activeCompany]
  )

  const fetchFiscalYearRecords = useCallback(async () => {
    try {
      setFiscalYearManagerLoading(true)
      const response = await fetchWithAuth('/api/fiscal-years')
      if (response?.ok) {
        const data = response.json ? await response.json() : { data: [] }
        if (data.success) {
          setFiscalYearManagerList(data.data || [])
        } else {
          showNotification(data.message || 'No se pudieron obtener los ejercicios', 'error')
          setFiscalYearManagerList([])
        }
      } else if (response) {
        let errorMessage = 'No se pudieron obtener los ejercicios'
        try {
          if (response.json) {
            const errorData = await response.json()
            errorMessage = errorData.message || errorData._server_messages || errorMessage
          } else if (response.error) {
            errorMessage = response.error.message || errorMessage
          }
        } catch (readError) {
          console.error('Error leyendo respuesta de Fiscal Years:', readError)
        }
        showNotification(errorMessage, 'error')
        setFiscalYearManagerList([])
      }
    } catch (error) {
      console.error('Error fetching Fiscal Years:', error)
      showNotification('Error al obtener los ejercicios fiscales', 'error')
      setFiscalYearManagerList([])
    } finally {
      setFiscalYearManagerLoading(false)
    }
  }, [fetchWithAuth, showNotification])

  useEffect(() => {
    if (!isFiscalYearModalOpen) {
      fiscalYearModalFetchTriggered.current = false
      lastFiscalYearModalCompany.current = activeCompany || null
      return
    }
    const companyChangedWhileOpen = lastFiscalYearModalCompany.current !== (activeCompany || null)
    if (fiscalYearModalFetchTriggered.current && !companyChangedWhileOpen) {
      return
    }
    fiscalYearModalFetchTriggered.current = true
    lastFiscalYearModalCompany.current = activeCompany || null
    fetchFiscalYearRecords()
  }, [isFiscalYearModalOpen, fetchFiscalYearRecords, activeCompany])

  useEffect(() => {
    if (!isFiscalYearModalOpen || customClosingYear) {
      return
    }
    // Solo establecer el año si hay un ejercicio fiscal previo
    if (modalClosingMeta?.latestEndYear) {
      setNewFiscalYearClosingYear(String(modalClosingMeta.latestEndYear + 1))
    } else {
      // Si no hay ejercicio previo, dejar vacío
      setNewFiscalYearClosingYear('')
    }
  }, [isFiscalYearModalOpen, customClosingYear, modalClosingMeta])

  const handleOpenFiscalYearModal = () => {
    fiscalYearModalFetchTriggered.current = false
    setCustomClosingYear(false)
    setIsFiscalYearModalOpen(true)
  }

  const handleCloseFiscalYearModal = () => {
    fiscalYearModalFetchTriggered.current = false
    setIsFiscalYearModalOpen(false)
    setNewFiscalYearClosingYear('')
    setCustomClosingYear(false)
  }

  const handleFiscalYearPlaceholderAction = (actionLabel, fiscalYear) => {
    const targetName = fiscalYear?.year || fiscalYear?.name || 'el ejercicio seleccionado'
    const friendlyName = getFiscalYearDisplayName(targetName) || targetName
    showNotification(`${actionLabel} para ${friendlyName} estará disponible próximamente.`, 'info')
  }

  const handleCreateFiscalYearRecord = async () => {
    if (!newFiscalYearClosingYear) {
      showNotification('Ingresá el año de cierre deseado.', 'warning')
      return
    }
    
    // Verificar que exista un año fiscal previo para determinar el patrón de cierre
    if (!modalClosingMeta) {
      showNotification('No se puede crear un nuevo ejercicio sin un ejercicio fiscal previo.', 'error')
      return
    }

    const closingYearInt = parseInt(newFiscalYearClosingYear, 10)
    if (Number.isNaN(closingYearInt) || closingYearInt < 1900) {
      showNotification('El año de cierre ingresado no es válido.', 'error')
      return
    }

    // Usar el mes y día del año fiscal existente
    const closingMonthIndex = modalClosingMeta.monthIndex
    const closingDayNumber = modalClosingMeta.day
    
    // Asegurarse de que el día sea válido para el mes en el año de cierre
    const lastDayOfClosingMonth = getLastDayOfMonth(closingYearInt, closingMonthIndex)
    const normalizedClosingDay = Math.min(closingDayNumber, lastDayOfClosingMonth)
    
    // Calcular el día de inicio (mismo mes/día pero año anterior)
    const lastDayOfPreviousMonth = getLastDayOfMonth(closingYearInt - 1, closingMonthIndex)
    const previousYearDay = Math.min(normalizedClosingDay, lastDayOfPreviousMonth)
    
    const baseStartDate = createUTCDate(closingYearInt - 1, closingMonthIndex, previousYearDay)
    const newStartDateObj = addDaysUTC(baseStartDate, 1)
    const newEndDateObj = createUTCDate(closingYearInt, closingMonthIndex, normalizedClosingDay)

    if (!newStartDateObj || !newEndDateObj) {
      showNotification('No se pudo calcular el nuevo ejercicio.', 'error')
      return
    }

    const monthLabel = modalClosingMeta.label
    const displayName = `Ejercicio Cierre ${monthLabel} ${closingYearInt}`
    const backendName = activeCompany ? `${displayName} - ${activeCompany}` : displayName

    const payload = {
      year: backendName,
      year_start_date: formatDateISO(newStartDateObj),
      year_end_date: formatDateISO(newEndDateObj),
      disabled: 0,
      is_short_year: 0,
      auto_created: 0
    }

    // Agregar company como docchild, no como campo directo
    if (activeCompany) {
      payload.companies = [
        {
          company: activeCompany
        }
      ]
    }

    setCreatingFiscalYearRecord(true)
    try {
      const response = await fetchWithAuth('/api/resource/Fiscal Year', {
        method: 'POST',
        body: JSON.stringify({ data: payload })
      })

      if (response.ok) {
        showNotification('Ejercicio creado correctamente.', 'success')
        setCustomClosingYear(false)
        await fetchFiscalYearRecords()
        await fetchFiscalYears()
      } else {
        let errorMessage = 'No se pudo crear el ejercicio fiscal.'
        try {
          if (response.json) {
            const errorData = await response.json()
            errorMessage = errorData.message || errorData._server_messages || errorMessage
          } else if (response.error) {
            errorMessage = response.error.message || errorMessage
          }
        } catch (errorRead) {
          console.error('Error al leer respuesta de creación de Fiscal Year:', errorRead)
        }
        showNotification(errorMessage, 'error')
      }
    } catch (error) {
      console.error('Error al crear Fiscal Year:', error)
      showNotification('Error de conexión al crear el ejercicio.', 'error')
    } finally {
      setCreatingFiscalYearRecord(false)
    }
  }

  const toggleNode = (nodeId) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  const buildAccountTree = (accounts) => {
    const accountMap = new Map()
    const rootAccounts = []
    const parseAccountNumber = (value) => {
      if (!value) return null
      const raw = value.toString().trim()
      if (!raw) return null
      const parts = raw
        .split(/[.\-\/\s]+/g)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const n = parseInt(p, 10)
          return Number.isFinite(n) ? n : null
        })
      return parts.length ? parts : null
    }

    const compareAccountNumbers = (a, b) => {
      const aParts = parseAccountNumber(a?.account_number)
      const bParts = parseAccountNumber(b?.account_number)
      if (!aParts && !bParts) return 0
      if (!aParts) return 1
      if (!bParts) return -1

      const maxLen = Math.max(aParts.length, bParts.length)
      for (let i = 0; i < maxLen; i++) {
        const av = aParts[i]
        const bv = bParts[i]
        if (av == null && bv == null) continue
        if (av == null) return -1
        if (bv == null) return 1
        if (av !== bv) return av - bv
      }
      return aParts.length - bParts.length
    }

    // Primero, crear un mapa de todas las cuentas
    accounts.forEach(account => {
      accountMap.set(account.name, {
        ...account,
        children: [],
        isExpanded: false,
        level: 0
      })
    })

    // Luego, organizar la jerarquía
    accounts.forEach(account => {
      const accountNode = accountMap.get(account.name)

      if (account.parent_account && accountMap.has(account.parent_account)) {
        // Esta cuenta tiene un padre, agregarla como hijo
        const parentNode = accountMap.get(account.parent_account)
        parentNode.children.push(accountNode)
        accountNode.level = parentNode.level + 1
      } else {
        // Esta cuenta no tiene padre (o el padre no existe), es raíz
        rootAccounts.push(accountNode)
      }
    })

    // Ordenar los hijos alfabéticamente
    const sortChildren = (node) => {
      node.children.sort((a, b) => a.account_name.localeCompare(b.account_name))
      node.children.forEach(sortChildren)
    }

    rootAccounts.forEach(sortChildren)
    rootAccounts.sort((a, b) => {
      const byNumber = compareAccountNumbers(a, b)
      if (byNumber !== 0) return byNumber
      return (a.account_name || a.name || '').localeCompare((b.account_name || b.name || ''), 'es', { sensitivity: 'base' })
    })

    return rootAccounts
  }

  // Función para calcular el saldo de una cuenta incluyendo sus subcuentas
  const calculateAccountBalance = (node) => {
    let totalBalance = 0

    // Si la cuenta tiene saldo propio, agregarlo
    if (accountBalances[node.name]) {
      totalBalance += accountBalances[node.name].balance || 0
    }

    // Si tiene hijos, sumar sus saldos recursivamente
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => {
        totalBalance += calculateAccountBalance(child)
      })
    }

    return totalBalance
  }

  // Función para calcular débito total de una cuenta incluyendo sus subcuentas
  const calculateAccountDebit = (node) => {
    let totalDebit = 0

    // Si la cuenta tiene débito propio, agregarlo
    if (accountBalances[node.name]) {
      totalDebit += accountBalances[node.name].debit || 0
    }

    // Si tiene hijos, sumar sus débitos recursivamente
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => {
        totalDebit += calculateAccountDebit(child)
      })
    }

    return totalDebit
  }

  // Función para calcular crédito total de una cuenta incluyendo sus subcuentas
  const calculateAccountCredit = (node) => {
    let totalCredit = 0

    // Si la cuenta tiene crédito propio, agregarlo
    if (accountBalances[node.name]) {
      totalCredit += accountBalances[node.name].credit || 0
    }

    // Si tiene hijos, sumar sus créditos recursivamente
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => {
        totalCredit += calculateAccountCredit(child)
      })
    }

    return totalCredit
  }

  // Función para formatear el saldo
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

  // Función para calcular totales generales de todas las cuentas raíz
  const calculateTotalDebit = () => {
    return filteredRootAccounts.reduce((total, account) => total + calculateAccountDebit(account), 0)
  }

  const calculateTotalCredit = () => {
    return filteredRootAccounts.reduce((total, account) => total + calculateAccountCredit(account), 0)
  }

  const calculateTotalBalance = () => {
    return filteredRootAccounts.reduce((total, account) => total + calculateAccountBalance(account), 0)
  }

  const renderAccountNode = (node, level = 0) => {
    const isExpanded = expandedNodes.has(node.name)
    const hasChildren = node.children && node.children.length > 0
    const isSelected = selectedAccount === node.name

    // Calcular el color basado en el nivel (escala de grises)
    const grayLevel = Math.min(900, 400 + level * 100) // 400, 500, 600, 700, 800, 900
    const textColor = `text-gray-${grayLevel}`
    const hoverColor = level === 0 ? 'hover:bg-gray-100' : 'hover:bg-gray-50'

    // Calcular el saldo total de la cuenta
    const accountBalance = calculateAccountBalance(node)
 
    return (
      <div key={node.name}>
        <div
          className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-all duration-200 ${hoverColor} ${
            isSelected ? 'bg-gray-200 border-l-4 border-gray-600' : ''
          }`}
          style={{ paddingLeft: level * 20 + 12 }}
          onClick={() => {
            // Seleccionar la cuenta (tanto carpetas como hojas)
            setSelectedAccount(node.name)
            
            // Si tiene hijos, también expandir/colapsar
            if (hasChildren) {
              toggleNode(node.name)
            }
          }}
        >
          <div className="flex items-center">
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className={`w-4 h-4 mr-2 ${textColor}`} />
              ) : (
                <ChevronRight className={`w-4 h-4 mr-2 ${textColor}`} />
              )
            ) : (
              <div className="w-4 mr-2" />
            )}

            {hasChildren || node.is_group ? (
              <Folder className={`w-4 h-4 mr-2 ${textColor}`} />
            ) : (
              <FileText className={`w-4 h-4 mr-2 ${textColor}`} />
            )}

            <span className={`text-sm font-medium ${textColor}`}>
              {node.account_name || node.name}
            </span>
          </div>

          {/* Mostrar débito, crédito y total */}
          <div className="flex items-center space-x-4 text-sm">
            <div className="text-right min-w-[80px] font-semibold text-gray-900">
              {formatBalance(calculateAccountDebit(node))}
            </div>
            <div className="text-right min-w-[80px] font-semibold text-gray-900">
              {formatBalance(calculateAccountCredit(node))}
            </div>
            <div className="text-right min-w-[80px] font-semibold text-gray-900">
              {formatBalance(calculateAccountBalance(node))}
            </div>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div>
            {node.children.map(child => renderAccountNode(child, level + 1))}
          </div>
        )}
      </div>
    )
  }

  const rootAccounts = buildAccountTree(accounts)

  // Función para filtrar cuentas recursivamente
  const filterAccounts = (accounts, searchTerm) => {
    if (!searchTerm) return accounts

    const filtered = []
    accounts.forEach(account => {
      const matchesSearch = account.account_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           account.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           account.account_number?.toLowerCase().includes(searchTerm.toLowerCase())

      if (matchesSearch) {
        filtered.push(account)
      } else if (account.children && account.children.length > 0) {
        // Si no coincide pero tiene hijos, filtrar los hijos
        const filteredChildren = filterAccounts(account.children, searchTerm)
        if (filteredChildren.length > 0) {
          // Crear una copia de la cuenta con solo los hijos filtrados
          filtered.push({
            ...account,
            children: filteredChildren
          })
        }
      }
    })
    return filtered
  }

  const filteredRootAccounts = filterAccounts(rootAccounts, accountSearch)

  // Función para filtrar movimientos
  const filterMovements = (movements, searchTerm) => {
    if (!searchTerm) return movements

    return movements.filter(movement => {
      const searchLower = searchTerm.toLowerCase()
      const voucherType = movement.voucher_type?.toLowerCase() || ''
      return (
        movement.journal_title?.toLowerCase().includes(searchLower) ||
        movement.remarks?.toLowerCase().includes(searchLower) ||
        voucherType.includes(searchLower) ||
        movement.posting_date?.includes(searchTerm) ||
        movement.debit?.toString().includes(searchTerm) ||
        movement.credit?.toString().includes(searchTerm)
      )
    })
  }

  // Función para ordenar movimientos
  const sortMovements = (movements, field, direction) => {
    return [...movements].sort((a, b) => {
      let aValue, bValue

      switch (field) {
        case 'posting_date':
          aValue = new Date(a.posting_date)
          bValue = new Date(b.posting_date)
          break
        case 'movement_type':
          aValue = (a.voucher_type || '').toLowerCase()
          bValue = (b.voucher_type || '').toLowerCase()
          break
        case 'debit':
          aValue = a.debit || 0
          bValue = b.debit || 0
          break
        case 'credit':
          aValue = a.credit || 0
          bValue = b.credit || 0
          break
        default:
          return 0
      }

      if (aValue < bValue) return direction === 'asc' ? -1 : 1
      if (aValue > bValue) return direction === 'asc' ? 1 : -1
      return 0
    })
  }

  // Función para procesar movimientos (filtrar y ordenar)
  const processMovements = (movements, searchTerm) => {
    const fiscalYearFiltered = (() => {
      if (!selectedFiscalYear || !currentFiscalYearDetails) {
        return movements
      }
      const start = parseDateToUTC(currentFiscalYearDetails.year_start_date)
      const end = parseDateToUTC(currentFiscalYearDetails.year_end_date)
      if (!start || !end) {
        return movements
      }

      return Array.isArray(movements)
        ? movements.filter((movement) => {
            const posting = parseDateToUTC(movement?.posting_date)
            if (!posting) return true
            return posting >= start && posting <= end
          })
        : []
    })()

    const filtered = filterMovements(fiscalYearFiltered, searchTerm)
    return sortMovements(filtered, sortField, sortDirection)
  }

  useEffect(() => {
    setMovementsPagination(prev => ({ ...prev, [movementsTab]: 1 }))
  }, [movementsTab, selectedAccount, selectedFiscalYear, movementSearch, sortField, sortDirection])

  const paginateList = (list, key) => {
    const length = Array.isArray(list) ? list.length : 0
    const totalPages = Math.max(1, Math.ceil(length / ACCOUNT_MOVEMENTS_PAGE_SIZE))
    const currentPage = Math.min(
      Math.max(movementsPagination?.[key] || 1, 1),
      totalPages
    )
    const startIndex = (currentPage - 1) * ACCOUNT_MOVEMENTS_PAGE_SIZE
    const pageItems = Array.isArray(list)
      ? list.slice(startIndex, startIndex + ACCOUNT_MOVEMENTS_PAGE_SIZE)
      : []

    return {
      currentPage,
      totalPages,
      startIndex,
      pageItems,
      setPage: (next) => setMovementsPagination(prev => ({ ...prev, [key]: next }))
    }
  }

  const handleCreateJournalEntry = async (journalEntryData) => {
    try {
      setIsSavingJournalEntry(true)
      
      let response
      if (journalEntryData.isEditing) {
        // Si estamos editando, hacer PUT para actualizar
        response = await fetchWithAuth(`${API_ROUTES.journalEntries}/${journalEntryData.data.name}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(journalEntryData),
        })
      } else {
        // Si es nuevo, hacer POST para crear
        response = await fetchWithAuth(API_ROUTES.journalEntries, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(journalEntryData),
        })
      }
      
      if (response.ok) {
        const isDraft = journalEntryData.save_as_draft
        const successMessage = journalEntryData.isEditing 
          ? 'Asiento contable actualizado exitosamente' 
          : isDraft 
            ? 'Asiento contable guardado como borrador' 
            : 'Asiento contable creado y confirmado exitosamente'
        showNotification(successMessage, 'success')
        shouldRefresh.current = true
        setIsJournalModalOpen(false)
        setEditingJournalEntry(null) // Limpiar datos de edición
        // Recargar movimientos si hay una cuenta seleccionada
        if (selectedAccount) {
          fetchAccountMovements(selectedAccount)
          fetchAuditMovements(selectedAccount)
          fetchDraftMovements(selectedAccount)
        }
      } else {
        const errorData = await response.json()
        showNotification(`Error al ${journalEntryData.isEditing ? 'actualizar' : 'crear'} asiento: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error creating/updating journal entry:', error)
      showNotification(`Error al ${journalEntryData.isEditing ? 'actualizar' : 'crear'} asiento contable`, 'error')
    } finally {
      setIsSavingJournalEntry(false)
    }
  }

  const handleMovementDoubleClick = async (movement) => {
    try {
      shouldRefresh.current = false
      console.log('Movimiento seleccionado para editar:', movement)
      console.log('Campos disponibles:', Object.keys(movement))

      // Detectar comprobantes por nomenclatura (shared/afip_codes.json) para abrir el modal correcto,
      // incluso cuando voucher_type viene distinto o incompleto (ej: GL entries).
      const referenceId = movement.voucher_no || movement.against_voucher || movement.name || ''
      const parsedRef = referenceId ? parseAfipComprobanteName(referenceId) : { scope: null, tipo: null }

      const isAfipInvoiceLikeTipo = (tipo) => {
        if (!tipo) return false
        return (
          tipo === 'FAC' ||
          tipo === 'FCE' ||
          tipo === 'FACX' ||
          tipo === 'NCC' ||
          tipo === 'NCE' ||
          tipo === 'NDB' ||
          tipo === 'NDE' ||
          tipo === 'TNC' ||
          tipo === 'TND'
        )
      }

      const inferredScope =
        parsedRef.scope ||
        (movement.voucher_type === 'Purchase Invoice' || movement.against_voucher_type === 'Purchase Invoice'
          ? 'compra'
          : movement.voucher_type === 'Sales Invoice' || movement.against_voucher_type === 'Sales Invoice'
            ? 'venta'
            : null)

      // Stock Reconciliation (ver/cancelar desde modal)
      const movementVoucherType = (movement.voucher_type || movement.against_voucher_type || '').toString().trim()
      const lowerVoucherType = movementVoucherType.toLowerCase()
      const refUpper = (referenceId || '').toString().trim().toUpperCase()
      const isStockReconciliation =
        lowerVoucherType === 'stock reconciliation' ||
        lowerVoucherType.includes('stock reconciliation') ||
        refUpper.startsWith('MAT-RECO-') ||
        refUpper.includes('-RECO-')

      if (isStockReconciliation) {
        const recoName = movement.voucher_no || movement.against_voucher || movement.name || referenceId
        if (!recoName) {
          showNotification('No se puede identificar el Stock Reconciliation', 'error')
          return
        }
        setSelectedStockReconciliation(recoName)
        setIsStockReconciliationModalOpen(true)
        return
      }

      // Verificar si es un remito de venta (Delivery Note)
      const isDeliveryNote =
        movementVoucherType === 'Delivery Note' ||
        getVoucherTypeAbbreviation(movementVoucherType) === 'DN' ||
        parsedRef.tipo === 'REM'

      if (isDeliveryNote) {
        console.log('Es un remito de venta, abriendo SalesRemitoModal')

        const remitoName = movement.voucher_no || movement.against_voucher || movement.name
        if (!remitoName) {
          console.error('No se puede identificar el remito - no hay voucher_no/against_voucher/name')
          showNotification('No se puede identificar el remito', 'error')
          return
        }

        const response = await fetchWithAuth(API_ROUTES.salesRemitoByName(remitoName))

        if (response.ok) {
          const data = await response.json().catch(() => ({}))
          if (data.success && data.remito) {
            setEditingSalesRemitoName(remitoName)
            setEditingSalesRemitoData(data.remito)
            setIsSalesRemitoModalOpen(true)
          } else {
            showNotification('No se pudieron obtener los datos del remito', 'error')
          }
        } else {
          let errorMessage = 'Error al obtener remito'
          try {
            const errorData = await response.json()
            errorMessage = errorData.message || errorMessage
          } catch (e) {
            errorMessage = `Error ${response.status}: ${response.statusText}`
          }
          showNotification(errorMessage, 'error')
        }

        return
      }

      // Verificar si es un remito de compra (Purchase Receipt)
      const isPurchaseReceipt =
        movementVoucherType === 'Purchase Receipt' ||
        getVoucherTypeAbbreviation(movementVoucherType) === 'PR' ||
        (parsedRef.tipo && parsedRef.tipo.toUpperCase().startsWith('RM'))

      if (isPurchaseReceipt) {
        console.log('Es un remito de compra, abriendo RemitoModal')

        const remitoName = movement.voucher_no || movement.against_voucher || movement.name
        if (!remitoName) {
          console.error('No se puede identificar el remito - no hay voucher_no/against_voucher/name')
          showNotification('No se puede identificar el remito', 'error')
          return
        }

        const response = await fetchWithAuth(API_ROUTES.remitoByName(remitoName))

        if (response.ok) {
          const data = await response.json().catch(() => ({}))
          if (data.success && data.remito) {
            setEditingPurchaseRemitoName(remitoName)
            setEditingPurchaseRemitoData(data.remito)
            setIsPurchaseRemitoModalOpen(true)
          } else {
            showNotification('No se pudieron obtener los datos del remito', 'error')
          }
        } else {
          let errorMessage = 'Error al obtener remito'
          try {
            const errorData = await response.json()
            errorMessage = errorData.message || errorMessage
          } catch (e) {
            errorMessage = `Error ${response.status}: ${response.statusText}`
          }
          showNotification(errorMessage, 'error')
        }

        return
      }

      if (referenceId && isAfipInvoiceLikeTipo(parsedRef.tipo) && inferredScope) {
        if (inferredScope === 'compra') {
          const response = await fetchWithAuth(`${API_ROUTES.purchaseInvoices}/${encodeURIComponent(referenceId)}`)

          if (response.ok) {
            const data = await response.json()
            if (data.success && data.data) {
              setEditingPurchaseInvoice(data.data)
              setIsPurchaseInvoiceModalOpen(true)
            } else {
              showNotification('No se pudieron obtener los datos de la factura de compra', 'error')
            }
          } else {
            let errorMessage = 'Error al obtener factura de compra'
            try {
              const errorData = await response.json()
              errorMessage = errorData.message || errorMessage
            } catch (e) {
              errorMessage = `Error ${response.status}: ${response.statusText}`
            }
            showNotification(errorMessage, 'error')
          }

          return
        }

        if (inferredScope === 'venta') {
          const response = await fetchWithAuth(`${API_ROUTES.invoices}/${encodeURIComponent(referenceId)}`)

          if (response.ok) {
            const data = await response.json()
            if (data.success && data.data) {
              setEditingInvoice(data.data)
              setIsInvoiceModalOpen(true)
            } else {
              showNotification('No se pudieron obtener los datos de la factura', 'error')
            }
          } else {
            let errorMessage = 'Error al obtener factura'
            try {
              const errorData = await response.json()
              errorMessage = errorData.message || errorMessage
            } catch (e) {
              errorMessage = `Error ${response.status}: ${response.statusText}`
            }
            showNotification(errorMessage, 'error')
          }

          return
        }
      }

      // Verificar si es una factura usando voucher_type
      if (movement.voucher_type === 'Sales Invoice' || movement.against_voucher_type === 'Sales Invoice') {
        console.log('Es una factura, abriendo InvoiceModal')
        
        // Para facturas, usar voucher_no como ID
        const invoiceId = movement.voucher_no || movement.against_voucher
        if (!invoiceId) {
          console.error('No se puede identificar la factura - no hay voucher_no ni against_voucher')
          showNotification('No se puede identificar la factura', 'error')
          return
        }

        // Obtener los datos de la factura
        const response = await fetchWithAuth(`${API_ROUTES.invoices}/${encodeURIComponent(invoiceId)}`)
        
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            console.log('Datos de factura obtenidos:', data.data)
            setEditingInvoice(data.data)
            setIsInvoiceModalOpen(true)
          } else {
            showNotification('No se pudieron obtener los datos de la factura', 'error')
          }
        } else {
          let errorMessage = 'Error al obtener factura'
          try {
            const errorData = await response.json()
            errorMessage = errorData.message || errorMessage
          } catch (e) {
            errorMessage = `Error ${response.status}: ${response.statusText}`
          }
          showNotification(errorMessage, 'error')
        }
        return
      }

      // Verificar si es un Payment Entry
      if (movement.voucher_type === 'Payment Entry') {
        console.log('Es un Payment Entry, determinando el tipo...')
        
        const paymentId = movement.voucher_no || movement.name
        if (!paymentId) {
          console.error('No se puede identificar el pago - no hay voucher_no ni name')
          showNotification('No se puede identificar el pago', 'error')
          return
        }

        // Obtener los datos completos del Payment Entry
        const response = await fetchWithAuth(`${API_ROUTES.pagos}/${encodeURIComponent(paymentId)}`)
        
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            const paymentData = data.data
            console.log('Payment Entry completo:', paymentData)
            
            // Determinar el tipo de Payment Entry basándose en el nombre y party_type
            const paymentName = paymentData.name || ''
            const partyType = paymentData.party_type || ''
            
            // Patrones para detectar el tipo de pago:
            // CC-REC-X-... = Recibos de compra (pagos a proveedores)
            // VM-REC-X-... = Recibos de venta (cobros a clientes)
            // ACC-PAY-... = Pagos genéricos
            
            const parsedPayment = paymentName ? parseAfipComprobanteName(paymentName) : { scope: null }

            if (parsedPayment.scope === 'compra' || partyType === 'Supplier') {
              // Es un pago a proveedor
              console.log('Abriendo SupplierPaymentModal (pago a proveedor)')
              setEditingSupplierPayment(paymentData)
              setIsSupplierPaymentModalOpen(true)
            } else if (parsedPayment.scope === 'venta' || partyType === 'Customer') {
              // Es un cobro a cliente
              console.log('Abriendo modal de cobro a cliente')
              setPaymentMode('customer')
              setEditingPayment(paymentData)
              setIsPaymentModalOpen(true)
            } else {
              // Es un pago genérico (canjes, sueldos, impuestos, etc.)
              console.log('Abriendo modal de pago genérico')
              setEditingPayment(paymentData)
              setIsGenericPaymentModalOpen(true)
            }
          } else {
            showNotification('No se pudieron obtener los datos del pago', 'error')
          }
        } else {
          let errorMessage = 'Error al obtener pago'
          try {
            const errorData = await response.json()
            errorMessage = errorData.message || errorMessage
          } catch (e) {
            errorMessage = `Error ${response.status}: ${response.statusText}`
          }
          showNotification(errorMessage, 'error')
        }
        return
      }

      // Para asientos contables (Journal Entries)
      console.log('Es un asiento contable, abriendo JournalEntryModal')
      
      // Obtener los datos completos del Journal Entry
      // Para GL entries usar voucher_no, para journal entries usar name
      const entryId = movement.voucher_no || movement.name
      console.log('Intentando editar movimiento con ID:', entryId)

      if (!entryId) {
        console.error('No se puede identificar el asiento - campos disponibles:', movement)
        showNotification('No se puede identificar el asiento contable', 'error')
        return
      }

      const response = await fetchWithAuth(`${API_ROUTES.journalEntries}/${encodeURIComponent(entryId)}`)
      
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data) {
          // Preparar los datos para el modal de edición
          const journalEntry = data.data
          console.log('Journal Entry completo:', journalEntry)
          console.log('DocStatus:', journalEntry.docstatus)
          console.log('Total de cuentas en el journal entry:', journalEntry.accounts?.length)
          console.log('Cuentas completas:', journalEntry.accounts)
          
          setEditingJournalEntry({
            voucher_no: journalEntry.name,
            posting_date: journalEntry.posting_date,
            title: journalEntry.title || '',
            remark: journalEntry.user_remark || '',
            // Do not apply hardcoded fallback currency
            currency: journalEntry.currency || '',
            docstatus: journalEntry.docstatus, // 0=Draft, 1=Submitted, 2=Cancelled
            accounts: journalEntry.accounts.map(account => {
              // Extraer el código de cuenta limpio (sin la parte " - XXX")
              const accountCode = account.account
              
              // Mapear party_type de ERPNext a nuestro formato
              let partyType = ''
              if (account.party_type === 'Customer') {
                partyType = 'C'
              } else if (account.party_type === 'Supplier') {
                partyType = 'P'
              }
              
              return {
                account: account.account, // Display name completo
                account_code: accountCode, // Código completo para ERPNext
                currency: account.account_currency || '',
                exchange_rate:
                  account.exchange_rate !== undefined && account.exchange_rate !== null
                    ? account.exchange_rate.toString()
                    : '1.0000',
                debit:
                  account.debit !== undefined && account.debit !== null
                    ? account.debit.toString()
                    : account.debit_in_account_currency?.toString() || '0.00',
                credit:
                  account.credit !== undefined && account.credit !== null
                    ? account.credit.toString()
                    : account.credit_in_account_currency?.toString() || '0.00',
                debit_in_account_currency:
                  account.debit_in_account_currency !== undefined && account.debit_in_account_currency !== null
                    ? account.debit_in_account_currency.toString()
                    : account.debit?.toString() || '0.00',
                credit_in_account_currency:
                  account.credit_in_account_currency !== undefined && account.credit_in_account_currency !== null
                    ? account.credit_in_account_currency.toString()
                    : account.credit?.toString() || '0.00',
                remark: account.user_remark || '',
                party_type: partyType, // 'C' o 'P' o ''
                party: account.party || '',
                cost_center: account.cost_center || ''
              }
            })
          })
          setIsJournalModalOpen(true)
        } else {
          showNotification('No se pudieron obtener los datos del asiento contable', 'error')
        }
      } else {
        let errorMessage = 'Error al obtener asiento'
        try {
          const errorData = await response.json()
          errorMessage = errorData.message || errorMessage
        } catch (e) {
          // Si no podemos parsear el error, usar mensaje genérico
          errorMessage = `Error ${response.status}: ${response.statusText}`
        }
        showNotification(errorMessage, 'error')
      }
    } catch (error) {
      console.error('Error fetching movement details:', error)
      if (error.message?.includes('fetch')) {
        showNotification('Error de conexión: Verifica que el servidor backend esté ejecutándose', 'error')
      } else {
        showNotification('Error al obtener datos del movimiento', 'error')
      }
    }
  }

  const handleEditAccount = () => {
    if (!accountDetails) return
    setIsEditingAccount(true)
    setEditedAccountData({
      account_name: accountDetails.account_name || accountDetails.name,
      account_number: accountDetails.account_number || '',
      // No default fallbacks: use whatever value is present or empty
      account_currency: accountDetails.account_currency || '',
      account_type: normalizeAccountType(accountDetails.account_type),
      parent_account: accountDetails.parent_account || '',
      is_group: accountDetails.is_group || false
    })
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

  const getSuggestedAccountNumber = (parentAccountName) => {
    if (!parentAccountName) {
      return ''
    }

    const parentAccount = accounts.find((acc) => acc.name === parentAccountName)
    const parentAccountNumber = parentAccount?.account_number?.trim()

    if (!parentAccountNumber) {
      return ''
    }

    const siblingAccounts = accounts.filter(
      (acc) => acc.parent_account === parentAccountName && acc.account_number
    )

    let maxSegmentValue = 0
    let segmentLength = 0

    siblingAccounts.forEach((acc) => {
      const segments = acc.account_number.split('.')
      const lastSegment = segments[segments.length - 1]

      if (!lastSegment) {
        return
      }

      const parsedSegment = parseInt(lastSegment, 10)

      if (!Number.isNaN(parsedSegment)) {
        if (parsedSegment > maxSegmentValue) {
          maxSegmentValue = parsedSegment
        }
        segmentLength = Math.max(segmentLength, lastSegment.length)
      }
    })

    if (!segmentLength) {
      const parentSegments = parentAccountNumber.split('.')
      const parentLastSegment = parentSegments[parentSegments.length - 1]
      segmentLength = parentLastSegment ? Math.max(parentLastSegment.length, 2) : 2
    }

    const nextSegmentValue = maxSegmentValue + 1
    const formattedSegment = String(nextSegmentValue).padStart(segmentLength, '0')

    return `${parentAccountNumber}.${formattedSegment}`
  }

  const handleParentAccountChange = (selectedOption) => {
    const parentValue = selectedOption ? selectedOption.value : ''
    handleEditChange('parent_account', parentValue)

    if (selectedAccount === 'new') {
      const suggestedNumber = getSuggestedAccountNumber(parentValue)
      handleEditChange('account_number', suggestedNumber || '')
    }
  }

  const handleSaveAccount = async () => {
    if (!selectedAccount) return

    try {
      setSavingAccount(true)
      const response = await fetchWithAuth(`${API_ROUTES.accountDetails}${selectedAccount}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: editedAccountData }),
      })

      if (response.ok) {
        showNotification('Cuenta actualizada exitosamente', 'success')
        setIsEditingAccount(false)
        setEditedAccountData({})
        // Recargar detalles de la cuenta
        fetchAccountDetails(selectedAccount)
        // Recargar la lista de cuentas
        fetchAccounts()
      } else {
        const errorData = await response.json()
        showNotification(`Error al actualizar cuenta: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error updating account:', error)
      showNotification('Error al actualizar cuenta', 'error')
    } finally {
      setSavingAccount(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!selectedAccount) return

    try {
      setLoading(true)
      const response = await fetchWithAuth(`${API_ROUTES.accountDetails}${selectedAccount}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        showNotification('Cuenta eliminada exitosamente', 'success')
        setSelectedAccount(null)
        setAccountDetails(null)
        setAccountMovements([])
        // Recargar la lista de cuentas
        fetchAccounts()
      } else {
        const errorData = await response.json()
        showNotification(`Error al eliminar cuenta: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error deleting account:', error)
      showNotification('Error al eliminar cuenta', 'error')
    } finally {
      setLoading(false)
    }
  }

  const renderPaginationFooter = ({ currentPage, totalPages, onChange }) => {
    const safeTotalPages = Math.max(totalPages || 1, 1)
    const safePage = Math.min(Math.max(currentPage || 1, 1), safeTotalPages)

    return (
      <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200">
        <div className="text-sm text-gray-700">
          Página {safePage} de {safeTotalPages}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onChange(safePage - 1)}
            disabled={safePage === 1}
            className="px-3 py-1 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anterior
          </button>

          {Array.from({ length: Math.min(5, safeTotalPages) }, (_, i) => {
            let pageNum
            if (safeTotalPages <= 5) {
              pageNum = i + 1
            } else if (safePage <= 3) {
              pageNum = i + 1
            } else if (safePage >= safeTotalPages - 2) {
              pageNum = safeTotalPages - 4 + i
            } else {
              pageNum = safePage - 2 + i
            }

            return (
              <button
                key={pageNum}
                onClick={() => onChange(pageNum)}
                className={`px-3 py-1 text-sm font-medium rounded-md ${
                  safePage === pageNum
                    ? 'text-blue-600 bg-blue-50 border border-blue-500'
                    : 'text-gray-500 bg-white border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {pageNum}
              </button>
            )
          })}

          <button
            onClick={() => onChange(safePage + 1)}
            disabled={safePage === safeTotalPages}
            className="px-3 py-1 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Siguiente
          </button>
        </div>
      </div>
    )
  }

  const renderDraftsTable = (drafts, pageKey = 'drafts') => {
    if (drafts.length === 0) {
      return (
        <div className="text-center py-12 text-gray-500">
          <div className="text-4xl mb-4">📝</div>
          <p>No hay asientos borradores</p>
        </div>
      )
    }

    const { pageItems, currentPage, totalPages, setPage, startIndex } = paginateList(drafts, pageKey)

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
          <table className="accounting-table min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th 
                className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('posting_date')}
              >
                <div className="flex items-center">
                  Fecha
                  {sortField === 'posting_date' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('movement_type')}
              >
                <div className="flex items-center">
                  Tipo
                  {sortField === 'movement_type' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Observaciones
              </th>
              <th 
                className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('debit')}
              >
                <div className="flex items-center">
                  Débito
                  {sortField === 'debit' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('credit')}
              >
                <div className="flex items-center">
                  Crédito
                  {sortField === 'credit' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Saldo
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Estado
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {(() => {
              let runningBalance = 0
              let totalDebit = 0
              let totalCredit = 0
              let startingBalance = 0

              for (let i = 0; i < drafts.length; i++) {
                const draft = drafts[i]
                const draftTotalDebit = draft.accounts?.reduce(
                  (sum, account) => sum + (parseFloat(account.debit_in_account_currency) || 0),
                  0
                ) || 0
                const draftTotalCredit = draft.accounts?.reduce(
                  (sum, account) => sum + (parseFloat(account.credit_in_account_currency) || 0),
                  0
                ) || 0

                runningBalance += draftTotalDebit - draftTotalCredit
                totalDebit += draftTotalDebit
                totalCredit += draftTotalCredit

                if (i === startIndex - 1) {
                  startingBalance = runningBalance
                }
              }

              runningBalance = startIndex === 0 ? 0 : startingBalance

              return pageItems.map((draft, index) => {
                // Para borradores (asientos de diario), calcular totales de todas las cuentas
                const draftTotalDebit = draft.accounts?.reduce((sum, account) => 
                  sum + (parseFloat(account.debit_in_account_currency) || 0), 0) || 0
                const draftTotalCredit = draft.accounts?.reduce((sum, account) => 
                  sum + (parseFloat(account.credit_in_account_currency) || 0), 0) || 0
                
                // Para el balance acumulado, usar el mayor de débito o crédito (ya que deben ser iguales)
                
                // Para borradores, incluir todos los movimientos en el balance
                runningBalance += draftTotalDebit - draftTotalCredit

                return (
                  <tr
                    key={startIndex + index}
                    className="hover:bg-gray-50 bg-yellow-50"
                    onDoubleClick={() => handleMovementDoubleClick(draft)}
                    title="Doble click para editar el borrador"
                  >
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(draft.posting_date)}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">
                      <span className="inline-flex items-center justify-center px-3 py-1 text-xs font-semibold uppercase tracking-wide border border-gray-200 rounded-md bg-white text-gray-700">
                        {getVoucherTypeAbbreviation(draft.voucher_type)}
                      </span>
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">
                      {draft.user_remark || draft.title || draft.name || 'Sin observaciones'}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900 text-right">
                      {draftTotalDebit > 0 ? draftTotalDebit.toFixed(2) : ''}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900 text-right">
                      {draftTotalCredit > 0 ? draftTotalCredit.toFixed(2) : ''}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900 text-right">
                      {overallBalance.toFixed(2)}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-center">
                      <Circle className="w-5 h-5 text-yellow-600 mx-auto fill-current" />
                    </td>
                  </tr>
                )
              })
            })()}
          </tbody>
          </table>
        </div>
        {totalPages > 1 &&
          renderPaginationFooter({
            currentPage,
            totalPages,
            onChange: setPage
          })}
      </div>
    )
  }

  const renderMovementsTable = (movements, showStatus = false, showBalance = true, pageKey = 'current') => {
    const { pageItems, currentPage, totalPages, setPage, startIndex } = paginateList(movements, pageKey)
    if (movements.length === 0) {
      return (
        <div className="text-center py-12 text-gray-500">
          <div className="text-4xl mb-4">📊</div>
          <p>No hay movimientos registrados para esta cuenta</p>
        </div>
      )
    }

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
          <table className="accounting-table min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th 
                className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('posting_date')}
              >
                <div className="flex items-center">
                  Fecha
                  {sortField === 'posting_date' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('movement_type')}
              >
                <div className="flex items-center">
                  Tipo
                  {sortField === 'movement_type' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Observaciones
              </th>
              <th 
                className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('debit')}
              >
                <div className="flex items-center">
                  Débito
                  {sortField === 'debit' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('credit')}
              >
                <div className="flex items-center">
                  Crédito
                  {sortField === 'credit' && (
                    <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              {showBalance && (
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Saldo
                </th>
              )}
              {showStatus && (
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {(() => {
              let runningBalance = 0
              let totalDebit = 0
              let totalCredit = 0
              let overallBalance = 0
              let startingBalance = 0

              for (let i = 0; i < movements.length; i++) {
                const movement = movements[i]
                const debit = movement.debit || 0
                const credit = movement.credit || 0

                totalDebit += debit
                totalCredit += credit

                const includeInBalance = showStatus || (!movement.is_cancelled && !movement.is_draft)
                if (includeInBalance) {
                  overallBalance += debit - credit
                }

                if (i === startIndex - 1) {
                  startingBalance = overallBalance
                }
              }

              runningBalance = startIndex === 0 ? 0 : startingBalance

              return pageItems.map((movement, index) => {
                const debit = movement.debit || 0
                const credit = movement.credit || 0
                const movementVoucherType = movement.voucher_type || movement.against_voucher_type || ''
                const movementVoucherAbbr = getVoucherTypeAbbreviation(movementVoucherType)
                
                // Para auditoría, incluir todos los movimientos en el balance
                // Para otras vistas, solo incluir movimientos confirmados
                if (showStatus || !movement.is_cancelled && !movement.is_draft) {
                  runningBalance += debit - credit
                }

                return (
                  <tr 
                    key={startIndex + index} 
                    className={`hover:bg-gray-50 ${movement.is_cancelled ? 'bg-red-50' : movement.is_draft ? 'bg-yellow-50' : ''}`}
                    onDoubleClick={() => !movement.is_cancelled && handleMovementDoubleClick(movement)}
                    title={movement.is_cancelled
                      ? 'Movimiento cancelado'
                      : movement.is_draft
                        ? 'Movimiento borrador'
                        : movementVoucherAbbr === 'DN'
                          ? 'Doble click para abrir el remito de venta'
                          : movementVoucherAbbr === 'PR'
                            ? 'Doble click para abrir el remito de compra'
                          : 'Doble click para editar el asiento contable'}
                  >
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(movement.posting_date)}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm font-medium text-gray-700 text-center bg-gray-50">
                      <span className="inline-flex items-center justify-center px-3 py-1 text-xs font-semibold uppercase tracking-wide border border-gray-200 rounded-md bg-white text-gray-700">
                        {movementVoucherAbbr}
                      </span>
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-500">
                      {movement.journal_title || movement.remarks || 'Sin título'}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900 text-right">
                      {debit ? debit.toFixed(2) : '0.00'}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900 text-right">
                      {credit ? credit.toFixed(2) : '0.00'}
                    </td>
                    {showBalance && (
                      <td className="px-6 py-2 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                        {runningBalance.toFixed(2)}
                      </td>
                    )}
                    {showStatus && (
                      <td className="px-6 py-2 whitespace-nowrap text-sm text-center">
                        {movement.is_cancelled ? (
                          <X className="w-5 h-5 text-red-600 mx-auto" />
                        ) : movement.is_draft ? (
                          <Circle className="w-5 h-5 text-yellow-600 mx-auto fill-current" />
                        ) : (
                          <Check className="w-5 h-5 text-green-600 mx-auto" />
                        )}
                      </td>
                    )}
                  </tr>
                )
              }).concat(
                <tr key="totals" className="bg-gray-50 font-bold border-t-2 border-gray-300">
                  <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900" colSpan="3">
                    TOTALES
                  </td>
                  <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900 text-right">
                    {totalDebit.toFixed(2)}
                  </td>
                  <td className="px-6 py-2 whitespace-nowrap text-sm text-gray-900 text-right">
                    {totalCredit.toFixed(2)}
                  </td>
                  {showBalance && (
                    <td className="px-6 py-2 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                      {overallBalance.toFixed(2)}
                    </td>
                  )}
                  {showStatus && <td></td>}
                </tr>
              )
            })()}
          </tbody>
          </table>
        </div>
        {totalPages > 1 &&
          renderPaginationFooter({
            currentPage,
            totalPages,
            onChange: setPage
          })}
      </div>
    )
  }

  const handleCreateAccount = async () => {
    try {
      setSavingAccount(true)
      // Limpiar datos para enviar solo los campos necesarios
      const dataToSend = {
        account_name: editedAccountData.account_name,
        account_number: editedAccountData.account_number,
        // Do not apply fallback currency values here
        account_currency: editedAccountData.account_currency,
        account_type: editedAccountData.account_type || '',
        parent_account: editedAccountData.parent_account,
        is_group: editedAccountData.is_group
      }

      const response = await fetchWithAuth(API_ROUTES.accounts, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: dataToSend }),
      })

      if (response.ok) {
        showNotification('Cuenta creada exitosamente', 'success')
        setIsEditingAccount(false)
        setEditedAccountData({})
        setAccountDetails(null)
        // Recargar la lista de cuentas
        fetchAccounts()
      } else {
        const errorData = await response.json()
        showNotification(`Error al crear cuenta: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error creating account:', error)
      showNotification('Error al crear cuenta', 'error')
    } finally {
      setSavingAccount(false)
    }
  }

  const handleAddAccount = () => {
    setSelectedAccount('new')
    setIsEditingAccount(true)
    setEditedAccountData({
      account_name: '',
      account_number: '',
      account_currency: '',
      account_type: '',
      parent_account: '',
      is_group: false
    })
    setAccountDetails(null)
    setAccountMovements([])
  }

  return (
    <div className="h-full flex gap-6 min-h-0" style={{ height: 'calc(110vh - 180px)' }}>
      {/* Árbol de cuentas - Izquierda */}
      <div className="w-1/3 bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden flex flex-col min-h-0">
        <div className="accounting-card-title">
          <div className="flex flex-col gap-3 w-full">
            <div className="flex flex-wrap items-center justify-between w-full gap-3">
              <div className="flex items-center gap-3">
                <Calculator className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-black text-gray-900">Plan de Cuentas</h3>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Buscar cuentas..."
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                    className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                        onClick={handleAddAccount}>
                  <Plus className="w-4 h-4 mr-2" />
                  Cuenta
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-3">
                  <CalendarDays className="w-4 h-4 text-gray-500" />
                  {fiscalYears.length <= 1 && (
                    <div className="flex flex-col leading-tight">
                      <span className="text-sm font-semibold text-gray-900">
                        {currentFiscalYearDisplay}
                      </span>
                    </div>
                  )}
                </div>
                {fiscalYears.length > 1 && (
                  <select
                    id="fiscal-year-select"
                    value={selectedFiscalYear}
                  onChange={(e) => {
                    shouldRefresh.current = true
                    hasUserSelectedFiscalYear.current = true
                    setSelectedFiscalYear(e.target.value)
                  }}
                    className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {fiscalYears.map((fy) => {
                      const optionLabel = getFiscalYearDisplayName(fy.name || fy.year || '') || fy.name || fy.year
                      return (
                        <option key={fy.name} value={fy.name}>
                          {optionLabel}
                        </option>
                      )
                    })}
                  </select>
                )}
                {fiscalYears.length === 0 && (
                  <div className="px-3 py-1 bg-red-100 border border-red-300 rounded-lg text-sm text-red-700">
                    Sin años fiscales
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleOpenFiscalYearModal}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-xs font-semibold rounded-xl text-gray-700 bg-white hover:bg-gray-50 transition-all duration-200 shadow-sm hover:shadow"
              >
                <Settings className="w-4 h-4 mr-2 text-gray-500" />
                Gestionar ejercicio
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 p-4 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">Cargando cuentas...</span>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Header con columnas */}
              <div className="flex items-center justify-between py-3 px-3 bg-gray-100 rounded-lg font-semibold text-gray-700 text-sm border-b border-gray-200">
                <div className="flex items-center flex-1">
                  <span>Cuenta</span>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right min-w-[80px]">
                    <span>Débito</span>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <span>Crédito</span>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <span>Total</span>
                  </div>
                </div>
              </div>
              {filteredRootAccounts.map(root => renderAccountNode(root))}
              
              {/* Fila de totales */}
              <div className="flex items-center justify-between py-3 px-3 bg-gray-200 rounded-lg font-bold text-gray-800 text-sm border-t-2 border-gray-300 mt-2">
                <div className="flex items-center flex-1">
                  <span>TOTAL GENERAL</span>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right min-w-[80px] text-gray-900">
                    {formatBalance(calculateTotalDebit())}
                  </div>
                  <div className="text-right min-w-[80px] text-gray-900">
                    {formatBalance(calculateTotalCredit())}
                  </div>
                  <div className="text-right min-w-[80px] text-gray-900">
                    {formatBalance(calculateTotalBalance())}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Panel derecho - Detalles y movimientos */}
      <div className="flex-1 flex flex-col gap-6 min-h-0">
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden">
          <div className="accounting-card-title">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-green-600" />
                <h3 className="text-lg font-black text-gray-900">
                  {isEditingAccount && selectedAccount === 'new' ? 'Nueva Cuenta' :
                   selectedAccount ? `Cuenta: ${accountDetails?.account_name || selectedAccount}` : 'Selecciona una cuenta'}
                </h3>
              </div>
              {selectedAccount && (
                <div className="flex gap-2">
                  {!isEditingAccount ? (
                    <>
                      <button className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                              title="Editar cuenta"
                              onClick={handleEditAccount}>
                        <Edit className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100/80 rounded-xl transition-all duration-300"
                              title="Eliminar cuenta"
                              onClick={handleDeleteAccount}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={handleCancelEdit}
                        disabled={savingAccount}
                        className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={selectedAccount === 'new' ? handleCreateAccount : handleSaveAccount}
                        disabled={savingAccount}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                      >
                        {savingAccount ? (
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

          <div className="p-4">
            {isEditingAccount ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nombre de la cuenta *</label>
                  <input
                    type="text"
                    value={editedAccountData.account_name || ''}
                    onChange={(e) => handleEditChange('account_name', e.target.value)}
                    placeholder="Nombre de la cuenta"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta padre</label>
                  <Select
                    value={accounts.find(acc => acc.name === editedAccountData.parent_account) ?
                      { value: editedAccountData.parent_account, label: accounts.find(acc => acc.name === editedAccountData.parent_account).account_name } : null}
                    onChange={handleParentAccountChange}
                    options={accounts.map((account) => ({
                      value: account.name,
                      label: account.account_name
                    }))}
                    placeholder="Seleccionar cuenta padre..."
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
                        '&:focus-within': {
                          borderColor: '#3b82f6',
                          boxShadow: '0 0 0 1px #3b82f6'
                        }
                      }),
                      menu: (provided) => ({
                        ...provided,
                        zIndex: 9999
                      }),
                      menuPortal: (provided) => ({
                        ...provided,
                        zIndex: 9999
                      })
                    }}
                    menuPortalTarget={document.body}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Moneda *</label>
                  <select
                    value={editedAccountData.account_currency || ''}
                    onChange={(e) => handleEditChange('account_currency', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Seleccionar moneda...</option>
                    {currenciesLoading ? (
                      <option value="" disabled>Cargando monedas...</option>
                    ) : (
                      currencies.map((c) => (
                        <option key={c.name} value={c.name}>{`${c.name} - ${c.currency_name || c.name}`}</option>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de cuenta</label>
                  <select
                    value={editedAccountData.account_type || ''}
                    onChange={(e) => handleEditChange('account_type', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {ACCOUNT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value || 'no-specified'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Número de cuenta *</label>
                  <input
                    type="text"
                    value={editedAccountData.account_number || ''}
                    onChange={(e) => handleEditChange('account_number', e.target.value)}
                    placeholder="Ej: 1.1.1.01.02"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="flex items-center space-x-3 min-h-[95px]">
                  <input
                    type="checkbox"
                    id="is_group"
                    checked={editedAccountData.is_group || false}
                    onChange={(e) => handleEditChange('is_group', e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <div className="flex items-center space-x-2">
                    <Folder className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-gray-700">Cuenta de agrupación</span>
                  </div>
                </div>
              </div>
            ) : accountDetails ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Nombre de la cuenta:</span>
                    <span className="text-gray-900 font-medium ml-2">{accountDetails.account_name || accountDetails.name}</span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 md:max-w-xs">
                    <span className="text-sm font-semibold text-gray-600">Número de cuenta:</span>
                    <span className="text-gray-900 font-medium ml-2">{accountDetails.account_number || 'No especificado'}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 md:max-w-xs">
                    <span className="text-sm font-semibold text-gray-600">Moneda:</span>
                    <span className="text-gray-900 font-medium ml-2">{accountDetails.account_currency || ''}</span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <span className="text-sm font-semibold text-gray-600">Tipo de cuenta:</span>
                    <span className="text-gray-900 font-medium ml-2">{getAccountTypeLabel(accountDetails.account_type)}</span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200 md:max-w-xs">
                    <span className="text-sm font-semibold text-gray-600">Grupo padre:</span>
                    <span className="text-gray-900 font-medium ml-2">
                      {accountDetails.parent_account ? 
                        (accounts.find(acc => acc.name === accountDetails.parent_account)?.account_name || accountDetails.parent_account) 
                        : 'Cuenta raíz'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Selecciona una cuenta del árbol para ver sus detalles</p>
              </div>
            )}
          </div>
        </div>

        {/* Movimientos de la cuenta - Abajo derecha */}
        <div className="flex-1 bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden flex flex-col min-h-0">
          <div className="accounting-card-title">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <BarChart3 className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-black text-gray-900">
                  Movimientos de la cuenta
                </h3>
              </div>
              <div className="flex items-center gap-3">
                {/* Búsqueda de movimientos */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Buscar movimientos..."
                    value={movementSearch}
                    onChange={(e) => setMovementSearch(e.target.value)}
                    className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={() => {
                    shouldRefresh.current = false
                    setIsJournalModalOpen(true)
                  }}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Agregar Asiento
                </button>
              </div>
            </div>
          </div>

          {/* Pestañas para movimientos */}
          <nav className="tab-nav">
            <button
              onClick={() => setMovementsTab('current')}
              className={`tab-button ${movementsTab === 'current' ? 'active' : ''}`}
            >
              Actual
            </button>
            <button
              onClick={() => setMovementsTab('audit')}
              className={`tab-button ${movementsTab === 'audit' ? 'active' : ''}`}
            >
              Auditoría
            </button>
            <button
              onClick={() => setMovementsTab('drafts')}
              className={`tab-button ${movementsTab === 'drafts' ? 'active' : ''}`}
            >
              Borradores ({draftMovements.length})
            </button>
          </nav>

          <div className="flex-1 p-4 overflow-hidden min-h-0">
            {movementsTab === 'current'
              ? renderMovementsTable(processMovements(accountMovements, movementSearch), false, true, 'current')
              : movementsTab === 'audit'
                ? renderMovementsTable(processMovements(auditMovements, movementSearch), true, true, 'audit')
                : renderDraftsTable(processMovements(draftMovements, movementSearch), 'drafts')}
          </div>
        </div>
      </div>

      {/* Modal para crear asiento contable */}
      <JournalEntryModal
        isOpen={isJournalModalOpen}
        onClose={() => {
          setIsJournalModalOpen(false)
          setEditingJournalEntry(null)
          shouldRefresh.current = true
        }}
        onSave={handleCreateJournalEntry}
        selectedAccount={selectedAccount}
        editingData={editingJournalEntry}
        isSaving={isSavingJournalEntry}
        availableAccounts={accounts}
      />

      {/* Modal para ver/editar factura */}
      <InvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => {
          setIsInvoiceModalOpen(false)
          setEditingInvoice(null)
          shouldRefresh.current = true
        }}
        onSave={(invoiceData) => {
          // Aquí podríamos implementar guardar cambios en la factura
          // Por ahora solo cerramos el modal
          setIsInvoiceModalOpen(false)
          setEditingInvoice(null)
          shouldRefresh.current = true
          // Podríamos refrescar los movimientos después de guardar
          if (selectedAccount) {
            fetchAccountMovements(selectedAccount)
          }
        }}
        selectedCustomer={editingInvoice?.customer}
        editingData={editingInvoice}
      />

      <PurchaseInvoiceModal
        isOpen={isPurchaseInvoiceModalOpen}
        onClose={() => {
          setIsPurchaseInvoiceModalOpen(false)
          setEditingPurchaseInvoice(null)
          shouldRefresh.current = true
        }}
        onSave={() => {}}
        onDelete={() => {}}
        onSaved={() => {
          setIsPurchaseInvoiceModalOpen(false)
          setEditingPurchaseInvoice(null)
          shouldRefresh.current = true
          if (selectedAccount) {
            fetchAccountMovements(selectedAccount)
            fetchAuditMovements(selectedAccount)
            fetchDraftMovements(selectedAccount)
          }
        }}
        selectedSupplier={editingPurchaseInvoice?.supplier || ''}
        editingData={editingPurchaseInvoice}
        unpaidInvoicesCount={0}
        handleOpenItemSettings={null}
      />

      <SalesRemitoModal
        isOpen={isSalesRemitoModalOpen}
        onClose={() => {
          setIsSalesRemitoModalOpen(false)
          setEditingSalesRemitoName(null)
          setEditingSalesRemitoData(null)
          shouldRefresh.current = true
        }}
        selectedCustomer={editingSalesRemitoData?.customer || ''}
        customerDetails={null}
        activeCompany={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        selectedRemitoName={editingSalesRemitoName}
        initialRemitoData={editingSalesRemitoData}
        onSaved={() => {
          setIsSalesRemitoModalOpen(false)
          setEditingSalesRemitoName(null)
          setEditingSalesRemitoData(null)
          shouldRefresh.current = true
          if (selectedAccount) {
            fetchAccountMovements(selectedAccount)
            fetchAuditMovements(selectedAccount)
            fetchDraftMovements(selectedAccount)
          }
        }}
      />

      <RemitoModal
        isOpen={isPurchaseRemitoModalOpen}
        onClose={() => {
          setIsPurchaseRemitoModalOpen(false)
          setEditingPurchaseRemitoName(null)
          setEditingPurchaseRemitoData(null)
          shouldRefresh.current = true
        }}
        selectedSupplier={editingPurchaseRemitoData?.supplier || ''}
        supplierDetails={null}
        activeCompany={activeCompany}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        selectedRemitoName={editingPurchaseRemitoName}
        initialRemitoData={editingPurchaseRemitoData}
        onSaved={() => {
          setIsPurchaseRemitoModalOpen(false)
          setEditingPurchaseRemitoName(null)
          setEditingPurchaseRemitoData(null)
          shouldRefresh.current = true
          if (selectedAccount) {
            fetchAccountMovements(selectedAccount)
            fetchAuditMovements(selectedAccount)
            fetchDraftMovements(selectedAccount)
          }
        }}
      />

      {/* Modal para ver/editar pago genérico */}
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
        onCancelled={() => {
          shouldRefresh.current = true
          if (selectedAccount) {
            fetchAccountMovements(selectedAccount)
            fetchAuditMovements(selectedAccount)
            fetchDraftMovements(selectedAccount)
          }
        }}
      />

      <GenericPaymentModal
        isOpen={isGenericPaymentModalOpen}
        onClose={() => {
          setIsGenericPaymentModalOpen(false)
          setEditingPayment(null)
          shouldRefresh.current = true
        }}
        paymentData={editingPayment}
        onSave={(paymentData) => {
          setIsGenericPaymentModalOpen(false)
          setEditingPayment(null)
          shouldRefresh.current = true
          // Refrescar movimientos después de guardar
          if (selectedAccount) {
            fetchAccountMovements(selectedAccount)
            fetchAuditMovements(selectedAccount)
          }
        }}
      />

      {/* Modal para ver/editar pago a proveedor o cobro a cliente */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false)
          setEditingPayment(null)
          shouldRefresh.current = true
        }}
        selectedCustomer={paymentMode === 'customer' ? editingPayment?.party : null}
        selectedSupplier={paymentMode === 'supplier' ? editingPayment?.party : null}
        editingData={editingPayment}
        mode="MANUAL"
        onSave={(paymentData) => {
          setIsPaymentModalOpen(false)
          setEditingPayment(null)
          shouldRefresh.current = true
          // Refrescar movimientos después de guardar
          if (selectedAccount) {
            fetchAccountMovements(selectedAccount)
            fetchAuditMovements(selectedAccount)
          }
        }}
      />

      <SupplierPaymentModal
        isOpen={isSupplierPaymentModalOpen}
        onClose={() => {
          setIsSupplierPaymentModalOpen(false)
          setEditingSupplierPayment(null)
          shouldRefresh.current = true
        }}
        onSave={() => {
          setIsSupplierPaymentModalOpen(false)
          setEditingSupplierPayment(null)
          shouldRefresh.current = true
          if (selectedAccount) {
            fetchAccountMovements(selectedAccount)
            fetchAuditMovements(selectedAccount)
            fetchDraftMovements(selectedAccount)
          }
        }}
        selectedSupplier={editingSupplierPayment?.party || editingSupplierPayment?.supplier || ''}
        editingData={editingSupplierPayment}
        supplierDetails={null}
        mode="MANUAL"
      />

      <Modal
        isOpen={isFiscalYearModalOpen}
        onClose={handleCloseFiscalYearModal}
        title="Gestionar ejercicios fiscales"
        subtitle="Consultá los ejercicios cargados, cerralos o creá uno nuevo respetando el mes de cierre."
        size="lg"
      >
        <div className="space-y-6 max-h-[65vh] overflow-y-auto pr-1">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h4 className="text-lg font-semibold text-gray-900">Ejercicios disponibles</h4>
            </div>
            {fiscalYearManagerLoading ? (
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400"></div>
                Cargando ejercicios...
              </div>
            ) : sortedFiscalYearManagerList.length > 0 ? (
              <div className="space-y-3">
                {sortedFiscalYearManagerList.map((fy) => (
                  <div key={fy.name} className="p-4 rounded-2xl border border-gray-200 shadow-sm bg-white flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-gray-900">
                          {getFiscalYearDisplayName(fy.year || fy.name) || fy.year || fy.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          Inicio: {formatDate(fy.year_start_date)} · Cierre: {formatDate(fy.year_end_date)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleFiscalYearPlaceholderAction('Cerrar ejercicio', fy)}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
                        >
                          <FileText className="w-4 h-4 mr-1.5 text-gray-500" />
                          Cerrar ejercicio
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFiscalYearPlaceholderAction('Ajuste por inflación', fy)}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 transition"
                        >
                          <TrendingUp className="w-4 h-4 mr-1.5" />
                          Ajuste por inflación
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-gray-500 border border-dashed border-gray-300 rounded-2xl">
                No encontramos ejercicios cargados todavía.
              </div>
            )}
          </section>

          <section className="border-t border-gray-100 pt-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Crear nuevo ejercicio</h4>
            <div className="grid gap-4 md:grid-cols-2">
                  <div className="p-4 border border-gray-200 rounded-2xl bg-gray-50">
                    <p className="text-sm text-gray-600">Mes de cierre definido</p>
                    {modalClosingMeta ? (
                      <p className="text-lg font-bold text-gray-900">
                        {modalClosingMeta.label} · día {modalClosingMeta.day}
                      </p>
                    ) : (
                      <p className="text-lg font-medium text-gray-500">
                        Sin ejercicio previo
                      </p>
                    )}
                  </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700" htmlFor="new-fiscal-year-year">
                  Nuevo año de cierre
                </label>
                <input
                  id="new-fiscal-year-year"
                  type="number"
                  min="1900"
                  value={newFiscalYearClosingYear}
                  onChange={(e) => {
                    setCustomClosingYear(true)
                    setNewFiscalYearClosingYear(e.target.value)
                  }}
                  placeholder="Ej: 2026"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleCreateFiscalYearRecord}
                disabled={creatingFiscalYearRecord || !newFiscalYearClosingYear}
                className="inline-flex items-center px-5 py-2 text-sm font-bold rounded-xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {creatingFiscalYearRecord ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Creando...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Crear ejercicio
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      </Modal>
      <ConfirmDialog />
    </div>
  )
}
