import React, { useState, useContext, useEffect, useMemo, useRef } from 'react'
import { Save, X, Plus, Trash2, FileText, Calendar, DollarSign, ChevronDown, ChevronRight, Users } from 'lucide-react'
import Modal from '../Modal'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import useCurrencies from '../../hooks/useCurrencies'
import { removeCompanyAbbrFromSupplier } from '../Supplierpanel/supplierHandlers'
import RetencionesSection from './PaymentModal/RetencionesSection'
import UnpaidInvoicesSection from './InvoiceModal/UnpaidInvoicesSection.jsx'

const generateConciliationId = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `CONC-PAY-${date}-${random}`
}

const summarizeBankTransactions = (transactions = []) => {
  return (transactions || []).reduce(
    (acc, tx) => {
      const deposit = parseFloat(tx?.deposit || tx?.deposito || 0) || 0
      const withdrawal = parseFloat(tx?.withdrawal || tx?.retiro || 0) || 0
      return {
        deposits: acc.deposits + deposit,
        withdrawals: acc.withdrawals + withdrawal
      }
    },
    { deposits: 0, withdrawals: 0 }
  )
}

const PaymentModal = ({
  isOpen,
  onClose,
  onSave,
  selectedCustomer,
  editingData,
  customerDetails,
  mode = 'MANUAL',
  selectedBankTransactions = [],
  bankAccountDetails = null
}) => {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useNotification()
  const { currencies, loading: currenciesLoading } = useCurrencies()

  // Cache refs para evitar recargas innecesarias de datos estáticos
  const staticDataCache = useRef({
    talonarios: { loaded: false, data: [] },
    treasuryAccounts: { loaded: false, data: [] },
    companyCurrency: { company: null, currency: null }
  })

  // Nombre del cliente para mostrar en el header (sin la sigla de la compañía)
  const [displayCustomerName, setDisplayCustomerName] = useState('')

  // Clase reutilizable para inputs/selects del header (igual que PurchaseInvoice)
  const inputClass = "w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7 bg-white"
  // Estado para moneda de la compañía (no hardcoded fallback)
  const [companyCurrency, setCompanyCurrency] = useState('')

  // Estados principales
  const [isEditing, setIsEditing] = useState(!!editingData)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Estados para talonarios y comprobantes
  const [availableTalonarios, setAvailableTalonarios] = useState([])
  const [selectedTalonario, setSelectedTalonario] = useState(null)
  const [nextPaymentNumber, setNextPaymentNumber] = useState('')
  const [puntoVenta, setPuntoVenta] = useState('')

  // Estados para monedas y tasas de cambio
  const [exchangeRate, setExchangeRate] = useState(1)
  const [exchangeRateDate, setExchangeRateDate] = useState('')
  const [isLoadingExchangeRate, setIsLoadingExchangeRate] = useState(false)

  // Estados para facturas impagas
  const [unpaidInvoices, setUnpaidInvoices] = useState([])
  const [invoiceSelections, setInvoiceSelections] = useState({})
  const [expandedGroups, setExpandedGroups] = useState({})
  const [conciliationSummaries, setConciliationSummaries] = useState([])
  const [selectedConciliationNet, setSelectedConciliationNet] = useState(null)
  const [selectedConciliationId, setSelectedConciliationId] = useState(null)
  const [selectedConciliationSource, setSelectedConciliationSource] = useState(null)
  const [autoConciliatedInvoices, setAutoConciliatedInvoices] = useState([])

  // Estados para cuentas de tesorería
  const [treasuryAccounts, setTreasuryAccounts] = useState([])

  // Estados para medios de cobro
  const [paymentMethods, setPaymentMethods] = useState([
    {
      id: 1,
      medio_pago: '',
      fecha_pago: new Date().toISOString().split('T')[0],
      importe: '0.00',
      archivos: []
    }
  ])
  const [isPaymentAmountAuto, setIsPaymentAmountAuto] = useState(true)

  // Estados para retenciones impositivas
  const [withholdings, setWithholdings] = useState([])

  // Estado del formulario principal
  const [formData, setFormData] = useState({
    posting_date: new Date().toISOString().split('T')[0],
    status: 'Confirmado',
    description: '',
    currency: companyCurrency,
    exchange_rate: 1,
    total_aplicado: 0,
    retenciones_iibb: 0,
    otras_retenciones: 0,
    intereses: 0,
    diferencia_cambio: 0,
    total_cobrar: 0
  })
  const isBankMode = mode === 'BANCO'
  const bankSelectionTotals = useMemo(
    () => summarizeBankTransactions(selectedBankTransactions),
    [selectedBankTransactions]
  )
  const lockedBankAmount = isBankMode
    ? Math.max(0, bankSelectionTotals.deposits - bankSelectionTotals.withdrawals)
    : null
  const formattedLockedBankAmount = lockedBankAmount !== null
    ? lockedBankAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null
  const canUseLockedAmount = !isBankMode || (lockedBankAmount || 0) > 0
  const isPaymentMethodValid = paymentMethods.some(method => method.medio_pago && parseFloat(method.importe || 0) > 0)
  const paymentModeOptions = useMemo(() => {
    const opts = []
    if (Array.isArray(treasuryAccounts)) {
      treasuryAccounts.forEach(account => {
        const display = account.account_name || (account.name ? account.name.split(' - ')[0] : account.name)
        opts.push({
          value: account.name,
          label: account.account_name || account.name,
          display,
          account: account.account,
          account_currency: account.account_currency,
          mode_of_payment: account.mode_of_payment
        })
      })
    }
    if (isBankMode && bankAccountDetails) {
      const bankDisplay = bankAccountDetails.account_name || (bankAccountDetails.name ? bankAccountDetails.name.split(' - ')[0] : bankAccountDetails.name)
      const bankOpt = {
        value: bankAccountDetails.name,
        label: bankAccountDetails.account_name || bankAccountDetails.name,
        display: bankDisplay,
        account: bankAccountDetails.account,
        account_currency: bankAccountDetails.account_currency,
        mode_of_payment: bankAccountDetails.mode_of_payment
      }
      if (!opts.find(o => o.value === bankOpt.value)) {
        opts.unshift(bankOpt)
      }
    }
    return opts
  }, [treasuryAccounts, isBankMode, bankAccountDetails])
  const bankPostingDate = useMemo(() => {
    if (!isBankMode || !selectedBankTransactions.length) return null
    const sortedDates = selectedBankTransactions
      .map((tx) => tx.date)
      .filter(Boolean)
      .sort()
    return sortedDates[0] || null
  }, [isBankMode, selectedBankTransactions])

  const formatAmountInputValue = (value) => {
    const numericValue = typeof value === 'string' ? parseFloat(value) : value
    if (numericValue === null || numericValue === undefined || isNaN(numericValue)) {
      return '0.00'
    }
    return numericValue.toFixed(2)
  }

  const normalizeAmountInput = (rawValue) => {
    if (typeof rawValue === 'number') return rawValue
    if (typeof rawValue !== 'string') return NaN
    const trimmed = rawValue.trim()
    if (!trimmed) return NaN
    const sanitized = trimmed
      .replace(/\s+/g, '')
      .replace(/,/g, '.')
      .replace(/[^\d.]/g, '')
    if (!sanitized) return NaN
    const parts = sanitized.split('.')
    if (parts.length > 2) {
      const integerPart = parts.shift()
      const decimalPart = parts.join('')
      return parseFloat(`${integerPart}.${decimalPart}`)
    }
    return parseFloat(sanitized)
  }

  const parseOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') return null
    const parsed = parseFloat(value)
    return Number.isNaN(parsed) ? null : parsed
  }

  // Cargar datos iniciales cuando se abre el modal
  useEffect(() => {
    if (isOpen && selectedCustomer) {
      loadInitialData()
    }
  }, [isOpen, selectedCustomer])

  // Cargar datos cuando cambia editingData
  useEffect(() => {
    if (editingData) {
      loadEditingData()
    }
  }, [editingData])

  // Auto-seleccionar talonario disponible
  useEffect(() => {
    if (!isOpen) return
    if (!availableTalonarios || availableTalonarios.length === 0) return
    const alreadySelectedName = typeof selectedTalonario === 'string'
      ? selectedTalonario
      : selectedTalonario?.name
    const existing = availableTalonarios.find(t => t.name === alreadySelectedName)
    if (existing) {
      if (typeof selectedTalonario === 'string') {
        setSelectedTalonario(existing)
        setPuntoVenta(existing.punto_de_venta)
      }
      return
    }
    const talonario = availableTalonarios[0]
    setSelectedTalonario(talonario)
    setPuntoVenta(talonario.punto_de_venta)
    calculateNextNumber(talonario)
  }, [availableTalonarios, selectedTalonario, isOpen])

  // Effect to initialize exchange rate when modal opens or currency changes
  useEffect(() => {
    if (isOpen && formData.currency) {
      fetchExchangeRate(formData.currency)
    }
  }, [isOpen, formData.currency])

  // Recalcular totales cuando cambian las selecciones de facturas, medios de pago o retenciones
  useEffect(() => {
    if (isOpen) {
      calculateTotals()
    }
  }, [invoiceSelections, paymentMethods, withholdings, isOpen])

  useEffect(() => {
    const selectedEntries = Object.entries(invoiceSelections)
      .filter(([, selection]) => selection.selected && (parseFloat(selection.saldo_aplicado) || 0) > 0)
    const selectedNames = selectedEntries.map(([name]) => name)
    if (selectedNames.length === 0) {
      if (selectedConciliationSource) {
        setSelectedConciliationId(null)
        setSelectedConciliationSource(null)
        setAutoConciliatedInvoices([])
      }
      return
    }
    const selectedInvoices = selectedNames
      .map(name => unpaidInvoices.find(inv => inv.name === name))
      .filter(Boolean)
    const existingConcId = selectedInvoices.find(inv => inv.custom_conciliation_id)?.custom_conciliation_id
    if (existingConcId) {
      if (selectedConciliationId !== existingConcId || selectedConciliationSource !== 'group') {
        setSelectedConciliationId(existingConcId)
        setSelectedConciliationSource('group')
      }
      setAutoConciliatedInvoices([])
      return
    }

    if (selectedNames.length >= 2) {
      const needsNewId = !(selectedConciliationSource === 'auto' && selectedConciliationId)
      const nextId = needsNewId ? generateConciliationId() : selectedConciliationId
      if (nextId && (selectedConciliationSource !== 'auto' || selectedConciliationId !== nextId)) {
        setSelectedConciliationId(nextId)
        setSelectedConciliationSource('auto')
      }
      setAutoConciliatedInvoices(selectedNames)
      return
    }

    if (selectedConciliationSource === 'auto') {
      setSelectedConciliationId(null)
      setSelectedConciliationSource(null)
      setAutoConciliatedInvoices([])
    }
  }, [invoiceSelections, unpaidInvoices, selectedConciliationId, selectedConciliationSource])

  useEffect(() => {
    if (isBankMode && bankPostingDate) {
      setFormData((prev) => ({ ...prev, posting_date: bankPostingDate }))
      setPaymentMethods((prev) => prev.map((method) => ({
        ...method,
        fecha_pago: bankPostingDate
      })))
    }
  }, [isBankMode, bankPostingDate])

  useEffect(() => {
    if (!isBankMode) return

    const applyCurrencyFromBankAccount = async () => {
      const directCurrency = bankAccountDetails?.account_currency || bankAccountDetails?.accountCurrency
      if (directCurrency) {
        setFormData(prev => ({ ...prev, status: 'Confirmado', currency: directCurrency }))
        return
      }

      const acctName = bankAccountDetails?.account || bankAccountDetails?.account_name || bankAccountDetails?.accounting_account
      if (!acctName) {
        setFormData(prev => ({ ...prev, status: 'Confirmado', currency: prev.currency || companyCurrency }))
        return
      }

      try {
        const resp = await fetchWithAuth(`/api/accounts/${encodeURIComponent(acctName)}`)
        if (resp.ok) {
          const data = await resp.json()
          const account = data?.data || data
          const acctCurrency = account?.account_currency || account?.currency
          if (acctCurrency) {
            console.log('PaymentModal: moneda cambiada por cuenta contable asociada ->', acctCurrency)
            setFormData(prev => ({
              ...prev,
              status: 'Confirmado',
              currency: acctCurrency,
              exchange_rate: acctCurrency === companyCurrency ? 1 : prev.exchange_rate
            }))
          }
        }
      } catch (err) {
        console.error('PaymentModal: error al obtener detalles de la cuenta contable:', err)
      }
    }

    applyCurrencyFromBankAccount()
  }, [isBankMode, bankAccountDetails, fetchWithAuth])

  // Log cuando cambia la moneda del formulario
  useEffect(() => {
    console.log('PaymentModal: formData.currency changed ->', formData.currency)
  }, [formData.currency])

  useEffect(() => {
    if (!isBankMode) return
    if (!bankAccountDetails) return
    // Mapear la cuenta bancaria seleccionada a la cuenta de tesorería asociada
    const matchedTreasury = treasuryAccounts.find(acc => acc.account === bankAccountDetails.name)
    const medioPagoValue = matchedTreasury ? matchedTreasury.name : bankAccountDetails.name
    setPaymentMethods((prev) =>
      prev.map((method) => ({
        ...method,
        medio_pago: medioPagoValue
      }))
    )
  }, [isBankMode, bankAccountDetails])

  const singlePaymentAmount = paymentMethods.length === 1 ? paymentMethods[0]?.importe : null

  useEffect(() => {
    // Solo auto-actualizar si:
    // 1. Hay exactamente 1 medio de pago
    // 2. El modo automático está activo (el usuario NO ha editado manualmente)
    if (paymentMethods.length !== 1) return
    if (!isPaymentAmountAuto) return  // Si el usuario editó manualmente, NO modificar
    
    const appliedTotal = Number(formData.total_aplicado || 0)
    const totalRetenciones = withholdings.reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0)
    // El importe a cobrar es el total aplicado MENOS las retenciones
    const netAmount = appliedTotal - totalRetenciones
    const formattedNet = formatAmountInputValue(Math.max(0, netAmount))
    const currentAmount = singlePaymentAmount ?? '0.00'
    
    // Evitar updates innecesarios si el valor ya es igual
    if (currentAmount === formattedNet) {
      return
    }
    
    setPaymentMethods(prev =>
      prev.map((method, index) =>
        index === 0 ? { ...method, importe: formattedNet } : method
      )
    )
  }, [formData.total_aplicado, withholdings, paymentMethods.length, singlePaymentAmount, isPaymentAmountAuto])

  useEffect(() => {
    const defaultMode = getDefaultModeOfPayment()
    if (!defaultMode) return
    
    // Buscar la cuenta de tesorería del medio de pago por defecto (por nombre)
    const account = treasuryAccounts.find(acc => acc.name === defaultMode)
    
      setPaymentMethods(prev => {
      let changed = false
      const updated = prev.map(method => {
        if (method.medio_pago) {
          return method
        }
        changed = true
        return { ...method, medio_pago: defaultMode }
      })
      return changed ? updated : prev
    })
    
    // SOLO actualizar moneda si NO está en modo banco, NO tiene moneda definida, Y es la primera carga
    if (account?.account_currency && !isBankMode && !formData.currency) {
      setFormData(prev => ({
        ...prev,
        currency: account.account_currency,
        exchange_rate: account.account_currency === companyCurrency ? 1 : prev.exchange_rate
      }))
    }
  }, [treasuryAccounts, isBankMode])

  useEffect(() => {
    if (!isBankMode || !isOpen) return
    const formattedLock = formatAmountInputValue(lockedBankAmount || 0)
    const defaultMode = getDefaultModeOfPayment()
    setIsPaymentAmountAuto(false)
    setPaymentMethods((prev) => {
      const base = prev.length > 0
        ? prev[0]
        : {
            id: 1,
            medio_pago: defaultMode,
            fecha_pago: new Date().toISOString().split('T')[0],
            importe: formattedLock,
            archivos: []
          }
      if (prev.length === 1 && base.importe === formattedLock && base.medio_pago) {
        return prev
      }
      return [{
        ...base,
        id: base.id || 1,
        medio_pago: base.medio_pago || defaultMode,
        fecha_pago: base.fecha_pago || new Date().toISOString().split('T')[0],
        importe: formattedLock,
        archivos: base.archivos || []
      }]
    })
  }, [isBankMode, isOpen, lockedBankAmount, treasuryAccounts])

  // Calcular displayCustomerName (sin la sigla de la compañía)
  useEffect(() => {
    let mounted = true
    const computeDisplayName = async () => {
      try {
        if (selectedCustomer) {
          const cleaned = await removeCompanyAbbrFromSupplier(selectedCustomer, fetchWithAuth)
          if (mounted) setDisplayCustomerName(cleaned)
          return
        }
        if (customerDetails?.customer_name) {
          const cleaned = await removeCompanyAbbrFromSupplier(customerDetails.customer_name, fetchWithAuth)
          if (mounted) setDisplayCustomerName(cleaned)
          return
        }
        if (mounted) setDisplayCustomerName('')
      } catch (err) {
        console.error('Error removing company abbr from customer name:', err)
      }
    }
    computeDisplayName()
    return () => { mounted = false }
  }, [selectedCustomer, customerDetails, fetchWithAuth])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      // Reset form first
      resetForm()

      // Obtener moneda de la compañía
      await loadCompanyCurrency()

      // Cargar talonarios disponibles
      await loadAvailableTalonarios()

      // Cargar facturas impagas del cliente
      await loadUnpaidInvoices()

      // Cargar pagos en draft y marcar facturas aplicadas
      await loadDraftPayments()

      // Cargar cuentas de tesorería
      await loadTreasuryAccounts()

    } catch (error) {
      console.error('Error loading initial data:', error)
      showNotification('Error al cargar datos iniciales', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadEditingData = async () => {
    if (!editingData) return

    setIsEditing(true)
    setSelectedConciliationNet(null)
    
    // Cargar datos del pago existente
    setFormData({
      posting_date: editingData.posting_date || new Date().toISOString().split('T')[0],
      status: editingData.docstatus === 1 ? 'Confirmado' : editingData.docstatus === 2 ? 'Cancelado' : 'Borrador',
      description: editingData.remarks || '',
      currency: editingData.paid_from_account_currency || '',
      exchange_rate: editingData.source_exchange_rate || 1,
      total_aplicado: editingData.total_allocated_amount || 0,
      retenciones_iibb: 0,
      otras_retenciones: 0,
      anticipo: 0,
      descuentos: 0,
      intereses: 0,
      diferencia_cambio: editingData.difference_amount || 0,
      total_cobrar: editingData.paid_amount || 0
    })

    // Cargar medio de pago
    if (editingData.mode_of_payment) {
      // Intentar mapear el mode_of_payment al nombre de la cuenta de tesorería si está disponible
      const matched = treasuryAccounts.find(acc => acc.name === editingData.mode_of_payment || acc.account === editingData.mode_of_payment || acc.mode_of_payment === editingData.mode_of_payment)
      const medioValue = matched ? matched.name : editingData.mode_of_payment
      setPaymentMethods([{
        id: 1,
        medio_pago: medioValue,
        fecha_pago: editingData.posting_date || new Date().toISOString().split('T')[0],
        importe: formatAmountInputValue(editingData.paid_amount || 0),
        archivos: []
      }])
      setIsPaymentAmountAuto(false)
    }

    // Cargar referencias a facturas
    if (editingData.references && editingData.references.length > 0) {
      setInvoiceSelections(prev => {
        const updated = { ...prev }
        editingData.references.forEach(ref => {
          if (updated[ref.reference_name]) {
            updated[ref.reference_name] = {
              ...updated[ref.reference_name],
              selected: true,
              saldo_aplicado: ref.allocated_amount || 0,
              saldo: updated[ref.reference_name].saldo_anterior - (ref.allocated_amount || 0)
            }
          }
        })
        // Debug log: show updated selections and computed credit_note_total
        try {
          const total = Math.abs(Object.values(updated).reduce((sum, s) => sum + (s.selected ? (parseFloat(s.saldo_aplicado) || 0) : 0), 0))
          console.log('[PaymentModal] Group select updated invoiceSelections (conciliation):', { concId, updatedPreview: updated, computedCreditNoteTotal: total })
        } catch (err) {
          console.error('[PaymentModal] Error logging updated invoice selections:', err)
        }
        return updated
      })
    }

    // Cargar talonario desde reference_no
    if (editingData.reference_no) {
      // El reference_no tiene formato como 0000100000001
      // Intentar encontrar el talonario correspondiente
      if (availableTalonarios.length > 0) {
        const matchingTalonario = availableTalonarios.find(t => 
          editingData.reference_no.startsWith(t.punto_de_venta)
        )
        if (matchingTalonario) {
          setSelectedTalonario(matchingTalonario)
          setPuntoVenta(matchingTalonario.punto_de_venta)
        }
      }
    }

    // Recalcular totales después de cargar todos los datos
    setTimeout(() => {
      calculateTotals()
    }, 100) // Pequeño delay para asegurar que las selecciones se actualizaron
  }

  const loadAvailableTalonarios = async () => {
    // Check cache first
    if (staticDataCache.current.talonarios.loaded) {
      setAvailableTalonarios(staticDataCache.current.talonarios.data)
      return
    }

    try {
      const response = await fetchWithAuth('/api/pagos/types')
      if (response.ok) {
        const data = await response.json()
        const talonarios = data.data || []
        staticDataCache.current.talonarios = { loaded: true, data: talonarios }
        setAvailableTalonarios(talonarios)
        
        // La auto-selección se maneja en el useEffect
      }
    } catch (error) {
      console.error('Error loading talonarios:', error)
    }
  }

  const calculateNextNumber = async (talonario) => {
    try {
      console.log('Calculating next number for talonario:', talonario.name)
      const puntoVenta = talonario.punto_de_venta
      const numeroInicio = talonario.numero_de_inicio

      // Consultar ERPNext directamente para obtener los últimos pagos con este punto de venta
      const searchFilters = JSON.stringify([
        ['reference_no', 'like', `${puntoVenta}%`]
      ])
      const encodedFilters = encodeURIComponent(searchFilters)

      const response = await fetchWithAuth(`/api/pagos/search-payments?filters=${encodedFilters}&limit=10`)

      if (response.ok) {
        const data = await response.json()
        console.log('Search payments response:', data)

        let lastNumber = numeroInicio - 1 // Empezar desde el inicio si no hay ninguno

        if (data.data && data.data.length > 0) {
          for (const payment of data.data) {
            const refNo = payment.reference_no || ''
            if (refNo.startsWith(puntoVenta)) {
              try {
                const numberPart = refNo.substring(puntoVenta.length)
                if (numberPart && !isNaN(numberPart)) {
                  const paymentNumber = parseInt(numberPart)
                  if (paymentNumber > lastNumber) {
                    lastNumber = paymentNumber
                  }
                }
              } catch (e) {
                console.error('Error parsing reference number:', refNo, e)
              }
            }
          }
        }

        const nextNumber = lastNumber + 1
        const formattedNumber = `${nextNumber.toString().padStart(8, '0')}`
        console.log('Calculated next number:', nextNumber, 'formatted:', formattedNumber)

        setNextPaymentNumber(formattedNumber)
      } else {
        console.error('Failed to search payments:', response.status)
        // Fallback: usar el número de inicio
        const formattedNumber = `${numeroInicio.toString().padStart(8, '0')}`
        setNextPaymentNumber(formattedNumber)
      }
    } catch (error) {
      console.error('Error calculating next number:', error)
      // Fallback: usar el número de inicio
      const formattedNumber = `${talonario.numero_de_inicio.toString().padStart(8, '0')}`
      setNextPaymentNumber(formattedNumber)
    }
  }

  const loadUnpaidInvoices = async () => {
    try {
      const response = await fetchWithAuth(`/api/customer-statements?customer=${encodeURIComponent(selectedCustomer)}&page=1&limit=1000`)
      if (response.ok) {
        const data = await response.json()
        const filteredData = (data.pending_invoices || []).filter(invoice => invoice.outstanding_amount > 0)
        setUnpaidInvoices(filteredData)
        setConciliationSummaries(data.conciliations || [])

        // Inicializar selecciones
        const initialSelections = {}
        filteredData.forEach(invoice => {
          const key = invoice.name
          initialSelections[key] = {
            selected: false,
            saldo_anterior: invoice.outstanding_amount,
            saldo_aplicado: 0,
            saldo: invoice.outstanding_amount
          }
        })
        setInvoiceSelections(initialSelections)
        setSelectedConciliationNet(null)
        setSelectedConciliationId(null)
        setSelectedConciliationSource(null)
        setAutoConciliatedInvoices([])
      }
    } catch (error) {
      console.error('Error loading unpaid invoices:', error)
    }
  }

  const loadDraftPayments = async () => {
    try {
      const response = await fetchWithAuth(`/api/pagos/draft-payments/${encodeURIComponent(selectedCustomer)}`)
      if (response.ok) {
        const data = await response.json()
        console.log('Draft payments data:', data)
        const draftPayments = data.data || []

        // Para cada pago en draft, marcar las facturas referenciadas como seleccionadas
        setInvoiceSelections(prev => {
          const updated = { ...prev }
          draftPayments.forEach(payment => {
            console.log('Processing payment:', payment.name, 'references:', payment.references)
            if (payment.references) {
              payment.references.forEach(ref => {
                console.log('Processing reference:', ref.reference_name, 'allocated_amount:', ref.allocated_amount)
                if (updated[ref.reference_name]) {
                  updated[ref.reference_name] = {
                    ...updated[ref.reference_name],
                    selected: true,
                    saldo_aplicado: ref.allocated_amount || 0,
                    saldo: updated[ref.reference_name].saldo_anterior - (ref.allocated_amount || 0)
                  }
                  console.log('Updated invoice selection for:', ref.reference_name)
                }
              })
            }
          })
          console.log('Final invoice selections:', updated)
          return updated
        })
        setSelectedConciliationNet(null)
      }
    } catch (error) {
      console.error('Error loading draft payments:', error)
    }
  }

  const loadTreasuryAccounts = async () => {
    // Check cache first
    if (staticDataCache.current.treasuryAccounts.loaded) {
      setTreasuryAccounts(staticDataCache.current.treasuryAccounts.data)
      return
    }

    try {
      const response = await fetchWithAuth('/api/treasury-accounts')
      if (response.ok) {
        const data = await response.json()
        const accounts = data.data || []
        staticDataCache.current.treasuryAccounts = { loaded: true, data: accounts }
        setTreasuryAccounts(accounts)
      }
    } catch (error) {
      console.error('Error loading treasury accounts:', error)
    }
  }

  const loadCompanyCurrency = async () => {
    // Check cache first
    if (staticDataCache.current.companyCurrency.company === activeCompany) {
      const currency = staticDataCache.current.companyCurrency.currency
      setCompanyCurrency(currency)
      setFormData(prev => ({ ...prev, currency }))
      return
    }

    try {
      if (activeCompany) {
        const response = await fetchWithAuth(`/api/companies/${activeCompany}`)
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            // Do not apply hardcoded fallback; use value from backend if present
            const currency = data.data.default_currency || ''
            staticDataCache.current.companyCurrency = { company: activeCompany, currency }
            setCompanyCurrency(currency)
            setFormData(prev => ({ ...prev, currency }))
          }
        }
      }
    } catch (error) {
      console.error('Error loading company currency:', error)
    }
  }

  const resetForm = () => {
    console.log('Resetting form - clearing puntoVenta')
    setFormData({
      posting_date: new Date().toISOString().split('T')[0],
      status: 'Confirmado',
      description: '',
      total_aplicado: 0,
      retenciones_iibb: 0,
      otras_retenciones: 0,
      intereses: 0,
      diferencia_cambio: 0,
      total_cobrar: 0
    })
    setSelectedTalonario(null)
    setPuntoVenta('')
    setPaymentMethods([
      {
        id: 1,
        medio_pago: '',
        fecha_pago: new Date().toISOString().split('T')[0],
        importe: '0.00',
        archivos: []
      }
    ])
    setIsPaymentAmountAuto(true)
    setWithholdings([])  // Limpiar retenciones
    setSelectedConciliationNet(null)
    setSelectedConciliationId(null)
    setSelectedConciliationSource(null)
    setAutoConciliatedInvoices([])
  }

  const calculateTotals = () => {
    // Calcular total aplicado de las facturas seleccionadas
    let totalAplicadoFromSelections = 0
    Object.values(invoiceSelections).forEach(selection => {
      if (selection.selected) {
        totalAplicadoFromSelections += selection.saldo_aplicado
      }
    })

    const parsedConciliationNet = selectedConciliationNet !== null
      ? parseOptionalNumber(selectedConciliationNet)
      : null
    const effectiveConciliationTotal = parsedConciliationNet !== null
      ? Math.abs(parsedConciliationNet)
      : null
    const totalAplicado = effectiveConciliationTotal !== null
      ? effectiveConciliationTotal
      : totalAplicadoFromSelections

    // Calcular total de medios de pago
    let totalMediosPago = 0
    paymentMethods.forEach(method => {
      const importe = parseFloat(method.importe) || 0
      totalMediosPago += importe
    })

    // Calcular total de retenciones
    const totalRetenciones = withholdings.reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0)
    
    // Calcular retenciones por tipo para el resumen
    const retencionesIIBB = withholdings
      .filter(w => w.tax_type === 'INGRESOS_BRUTOS')
      .reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0)
    
    const otrasRetenciones = withholdings
      .filter(w => w.tax_type !== 'INGRESOS_BRUTOS')
      .reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0)

    // Calcular total a cobrar (suma de medios de pago)
    const totalCobrar = totalMediosPago

    setFormData(prev => ({
      ...prev,
      total_aplicado: totalAplicado,
      total_cobrar: totalCobrar,
      retenciones_iibb: retencionesIIBB,
      otras_retenciones: otrasRetenciones
    }))

    // Auto-llenar el importe del primer medio de pago si está en modo automático
    // El importe a cobrar es el total aplicado MENOS las retenciones
    const importeNetoCobro = totalAplicado - totalRetenciones
    if (isPaymentAmountAuto && paymentMethods.length === 1 && importeNetoCobro > 0) {
      const currentImporte = parseFloat(paymentMethods[0].importe) || 0
      if (Math.abs(currentImporte - importeNetoCobro) > 0.005) {
        setPaymentMethods(prev => 
          prev.map((method, index) => 
            index === 0 ? { ...method, importe: formatAmountInputValue(importeNetoCobro) } : method
          )
        )
      }
    }
  }

  const handleInputChange = (field, value) => {
    if (isBankMode && (field === 'posting_date' || field === 'status')) {
      return
    }
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    // Recalcular totales cuando cambian los campos relacionados
    setTimeout(calculateTotals, 0)
  }

  const handleTalonarioChange = (talonarioName) => {
    console.log('Talonario changed to:', talonarioName)
    const talonario = availableTalonarios.find(t => t.name === talonarioName)
    console.log('Found talonario:', talonario)
    setSelectedTalonario(talonario)
    if (talonario) {
      // Actualizar punto de venta y calcular próximo número
      setPuntoVenta(talonario.punto_de_venta)
      calculateNextNumber(talonario)
    } else {
      setNextPaymentNumber('')
      setPuntoVenta('')
    }
  }

  const handleInvoiceSelection = (invoiceName, field, value) => {
    setInvoiceSelections(prev => {
      const current = prev[invoiceName]
      const updated = { ...prev }

      if (field === 'selected') {
        if (value === true) {
          // Seleccionando: auto-llenar saldo_aplicado con saldo_anterior
          updated[invoiceName] = {
            ...current,
            selected: true,
            saldo_aplicado: current.saldo_anterior,
            saldo: 0
          }
        } else {
          // Deseleccionando: poner saldo_aplicado en 0 y restaurar saldo
          updated[invoiceName] = {
            ...current,
            selected: false,
            saldo_aplicado: 0,
            saldo: current.saldo_anterior
          }
        }
      } else if (field === 'saldo_aplicado') {
        // Fix issue 2: limitar el saldo_aplicado al saldo_anterior (no puede superar el total de la factura)
        const maxValue = current.saldo_anterior
        const clampedValue = Math.min(Math.max(0, value), maxValue)
        updated[invoiceName] = {
          ...current,
          saldo_aplicado: clampedValue,
          saldo: current.saldo_anterior - clampedValue
        }
      } else {
        updated[invoiceName] = {
          ...current,
          [field]: value
        }
      }

      return updated
    })
    // Recalcular totales cuando cambian las selecciones o montos aplicados
    setTimeout(calculateTotals, 0)
  }

  // Adapter for UnpaidInvoicesSection selection (invoiceName can be 'CONC|<id>' or an invoice name)
  const handleUnpaidInvoiceSelection = (invoiceKey, isSelected, group) => {
    if (String(invoiceKey).startsWith('CONC|')) {
      const concId = invoiceKey.split('|')[1]
      // Find invoices in unpaidInvoices belonging to this conciliation
      const groupInvoices = unpaidInvoices.filter(inv => inv.custom_conciliation_id === concId || inv.custom_conciliation_id === concId)
      if (isSelected) {
        const conciliationNet = parseOptionalNumber(group?.net_amount)
        setSelectedConciliationNet(conciliationNet)
      } else {
        setSelectedConciliationNet(null)
      }
      setInvoiceSelections(prev => {
        // When selecting a whole conciliation group, replace other selections to avoid mixing groups
        const updated = {}
        // initialize updated from prev but clear selections
        Object.entries(prev).forEach(([k, v]) => {
          updated[k] = { ...v, selected: false, saldo_aplicado: 0, saldo: v.saldo_anterior }
        })
        // Select only the invoices from the chosen group
        groupInvoices.forEach(inv => {
          const key = inv.name
          if (!updated[key]) return
          if (isSelected) {
            // Keep the signed outstanding amount instead of abs — the totals will reflect conciliation net
            const parsed = parseFloat(inv.outstanding_amount) || 0
            updated[key] = { ...updated[key], selected: true, saldo_aplicado: parsed, saldo: 0 }
          } else {
            // If unselecting, ensure it's deselected
            updated[key] = { ...updated[key], selected: false, saldo_aplicado: 0, saldo: updated[key].saldo_anterior }
          }
        })
        return updated
      })
    } else {
      setSelectedConciliationNet(null)
      const invoice = unpaidInvoices.find(inv => inv.name === invoiceKey)
      if (!invoice) return
      handleInvoiceSelection(invoiceKey, 'selected', isSelected)
    }
    setTimeout(calculateTotals, 0)
  }

  const handleUnpaidInvoiceAmountChange = (invoiceName, newAmount) => {
    // Map UnpaidInvoicesSection amount change to our invoiceSelections 'saldo_aplicado'
    const numeric = Number(newAmount) || 0
    handleInvoiceSelection(invoiceName, 'saldo_aplicado', numeric)
  }

  // Función para seleccionar/deseleccionar todas las facturas
  const handleSelectAllInvoices = (selectAll) => {
    setInvoiceSelections(prev => {
      const updated = { ...prev }
      unpaidInvoices.forEach(invoice => {
        const key = invoice.is_group ? invoice.group_id : invoice.name
        if (updated[key]) {
          updated[key] = {
            ...updated[key],
            selected: selectAll,
            saldo_aplicado: selectAll ? updated[key].saldo_anterior : 0,
            saldo: selectAll ? 0 : updated[key].saldo_anterior
          }
        }
      })
      return updated
    })
  }

  const getDefaultModeOfPayment = () => {
    if (isBankMode && bankAccountDetails) {
      return bankAccountDetails.name
    }
    if (!Array.isArray(treasuryAccounts) || treasuryAccounts.length === 0) return ''
    return treasuryAccounts[0].name || ''
  }

  const addPaymentMethod = () => {
    if (isBankMode) return
    const newId = Math.max(...paymentMethods.map(m => m.id)) + 1
    setPaymentMethods(prev => [...prev, {
      id: newId,
      medio_pago: getDefaultModeOfPayment(),
      fecha_pago: new Date().toISOString().split('T')[0],
      importe: '0.00',
      archivos: []
    }])
    setIsPaymentAmountAuto(false)
  }

  const removePaymentMethod = (id) => {
    if (isBankMode) return
    if (paymentMethods.length > 1) {
      setPaymentMethods(prev => prev.filter(m => m.id !== id))
      if (paymentMethods.length <= 2) {
        setIsPaymentAmountAuto(true)
      }
    }
  }

  const updatePaymentMethod = (id, field, value) => {
    setPaymentMethods(prev => prev.map(method =>
      method.id === id ? { ...method, [field]: value } : method
    ))
    
    // Actualizar la moneda del formulario cuando se selecciona un medio de pago en modo MANUAL
    if (field === 'medio_pago' && value) {
      // El valor del select puede ser treasury.name, treasury.mode_of_payment o la cuenta contable.
      const account = treasuryAccounts.find(acc => acc.name === value || acc.mode_of_payment === value || acc.account === value) ||
        (bankAccountDetails && (bankAccountDetails.name === value || bankAccountDetails.account === value) ? bankAccountDetails : null)

      if (account) {
        // Si la cuenta trae account_currency, usarla inmediatamente
        if (account.account_currency && account.account_currency !== formData.currency) {
          console.log('PaymentModal: medio_pago seleccionado ->', value, 'matched_account ->', account.name || account.account, 'account_currency ->', account.account_currency)
          setFormData(prev => ({
            ...prev,
            currency: account.account_currency,
            exchange_rate: account.account_currency === companyCurrency ? 1 : prev.exchange_rate
          }))
          return
        }

        // Si no tiene account_currency, intentar obtenerla desde la cuenta contable referenciada
        const acctName = account.account || account.accounting_account || account.account_name || account.name
        if (acctName) {
          ;(async () => {
            try {
              const resp = await fetchWithAuth(`/api/accounts/${encodeURIComponent(acctName)}`)
              if (resp.ok) {
                const data = await resp.json()
                const acct = data?.data || data
                const acctCurrency = acct?.account_currency || acct?.currency
                if (acctCurrency && acctCurrency !== formData.currency) {
                  console.log('PaymentModal: moneda obtenida de cuenta contable ->', acctName, acctCurrency)
                  setFormData(prev => ({
                    ...prev,
                    currency: acctCurrency,
                    exchange_rate: acctCurrency === companyCurrency ? 1 : prev.exchange_rate
                  }))
                }
              } else {
                try {
                  const errBody = await resp.json()
                  console.warn('PaymentModal: /api/accounts responded with', resp.status, errBody)
                } catch (e) {
                  console.warn('PaymentModal: /api/accounts responded with', resp.status)
                }
              }
            } catch (err) {
              console.error('PaymentModal: error al obtener cuenta contable:', err)
            }
          })()
        }
      }
    }
    
    // Recalcular totales cuando cambian los importes
    if (field === 'importe') {
      setTimeout(calculateTotals, 0)
    }
  }

  const handlePaymentAmountChange = (id, rawValue) => {
    if (isBankMode) return
    // Marcar como no automático ANTES de actualizar (el usuario está editando manualmente)
    setIsPaymentAmountAuto(false)
    
    // Permitir que el usuario escriba libremente mientras edita
    // Solo sanitizar caracteres no válidos, mantener el valor como string
    const sanitized = rawValue
      .replace(/[^\d.,]/g, '')
      .replace(/,/g, '.')
    
    // Actualizar el valor directamente sin formatear (para permitir escritura fluida)
    updatePaymentMethod(id, 'importe', sanitized)
  }

  // Formatear el importe cuando el input pierde el foco
  const handlePaymentAmountBlur = (id, rawValue) => {
    if (isBankMode) return
    let numericValue = normalizeAmountInput(rawValue)
    if (isNaN(numericValue) || numericValue < 0) {
      numericValue = 0
    }
    const formattedAmount = formatAmountInputValue(numericValue)
    updatePaymentMethod(id, 'importe', formattedAmount)
  }

  // Función para obtener la tasa de cambio
  const fetchExchangeRate = async (currency) => {
    // Usar la fecha del pago
    const paymentDate = formData.posting_date || new Date().toISOString().split('T')[0]

    if (!companyCurrency) {
      setExchangeRate(null)
      setExchangeRateDate(paymentDate)
      setFormData(prev => ({ ...prev, exchange_rate: '' }))
      showNotification('La empresa no tiene moneda por defecto definida', 'error')
      return
    }

    if (currency === companyCurrency) {
      setExchangeRate(1)
      setExchangeRateDate(paymentDate)
      setFormData(prev => ({ ...prev, exchange_rate: 1 }))
      return
    }

    setIsLoadingExchangeRate(true)
    try {
      const response = await fetchWithAuth(`${API_ROUTES.currencyExchange.latest(currency)}&to=${encodeURIComponent(companyCurrency)}`)
      const data = await (response && response.json ? response.json().catch(() => ({})) : Promise.resolve({}))
      if (!response || !response.ok || data?.success === false) {
        throw new Error(data?.message || `Error HTTP ${response ? response.status : 'no-response'}`)
      }
      const rate = data?.data?.exchange_rate
      if (!(Number(rate) > 0)) {
        throw new Error(`No hay cotización cargada para ${currency}/${companyCurrency}`)
      }
      setExchangeRate(Number(rate))
      setExchangeRateDate(paymentDate)
      setFormData(prev => ({ ...prev, exchange_rate: Number(rate) }))
      showNotification(`Cotización ${currency}/${companyCurrency} actualizada`, 'success')
    } catch (error) {
      console.error('Error fetching exchange rate:', error)
      setExchangeRate(null)
      setExchangeRateDate(paymentDate)
      setFormData(prev => ({ ...prev, exchange_rate: '' }))
      showNotification(error?.message || 'Error al obtener la cotización', 'error')
    } finally {
      setIsLoadingExchangeRate(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Validaciones
      if (!selectedTalonario) {
        showNotification('Debe seleccionar un talonario', 'error')
        setSaving(false)
        return
      }

      if (!paymentMethods.length || paymentMethods.some(method => !method.medio_pago)) {
        showNotification('Debes seleccionar al menos un medio de cobro válido', 'error')
        setSaving(false)
        return
      }

      const totalCobrar = paymentMethods.reduce((sum, method) => sum + (parseFloat(method.importe) || 0), 0)
      if (totalCobrar <= 0) {
        showNotification('Debes ingresar un importe positivo para el pago', 'error')
        setSaving(false)
        return
      }

      // Procesar selecciones de facturas, distribuyendo grupos
      const processedInvoices = {}
      const selectedConciliationIds = []
      Object.entries(invoiceSelections).forEach(([key, selection]) => {
        if (!(selection.selected && (parseFloat(selection.saldo_aplicado) || 0) > 0)) return
        const groupInvoice = unpaidInvoices.find(inv => inv.is_group && inv.group_id === key)
        if (groupInvoice) {
          selectedConciliationIds.push(key)
          const payableInvoices = groupInvoice.invoices.filter(inv => inv.outstanding_amount > 0)
          const totalPayable = payableInvoices.reduce((sum, inv) => sum + inv.outstanding_amount, 0)
          if (totalPayable > 0) {
            payableInvoices.forEach(subInv => {
              const proportion = subInv.outstanding_amount / totalPayable
              const subAllocated = (parseFloat(selection.saldo_aplicado) || 0) * proportion
              if (subAllocated > 0) {
                processedInvoices[subInv.name] = {
                  selected: true,
                  saldo_anterior: subInv.outstanding_amount,
                  saldo_aplicado: subAllocated,
                  saldo: subInv.outstanding_amount - subAllocated
                }
              }
            })
          }
        } else {
          processedInvoices[key] = {
            ...selection,
            selected: true
          }
        }
      })

      const totalRetenciones = withholdings.reduce((sum, w) => sum + (parseFloat(w.amount) || 0), 0)
      const allocationBudget = totalCobrar + totalRetenciones
      let remainingAllocation = allocationBudget
      const finalInvoiceAllocations = {}
      Object.entries(processedInvoices).forEach(([key, selection]) => {
        if (remainingAllocation <= 0) return
        const currentSaldo = parseFloat(selection.saldo_aplicado) || 0
        const available = Math.min(currentSaldo, remainingAllocation)
        if (available <= 0) return
        remainingAllocation -= available
        finalInvoiceAllocations[key] = {
          ...selection,
          saldo_aplicado: available,
          saldo: (selection.saldo_anterior || 0) - available
        }
      })
      const finalTotalApplied = Object.values(finalInvoiceAllocations).reduce(
        (sum, entry) => sum + (parseFloat(entry.saldo_aplicado) || 0),
        0
      )

      const selectedTalonarioName = typeof selectedTalonario === 'string'
        ? selectedTalonario
        : selectedTalonario?.name

      const assignedInvoices = selectedConciliationSource === 'auto'
        ? autoConciliatedInvoices
        : []
      const payloadConciliationIds = selectedConciliationId ? [selectedConciliationId] : selectedConciliationIds

      const paymentData = {
        customer: selectedCustomer,
        posting_date: formData.posting_date,
        status: formData.status,
        current_status: editingData ? editingData.status : null,
        description: formData.description,
        currency: formData.currency,
        exchange_rate: formData.exchange_rate,
        talonario: selectedTalonarioName,
        invoices: finalInvoiceAllocations,
        selected_conciliation_ids: payloadConciliationIds,
        payment_methods: paymentMethods,
        withholdings: withholdings,  // Agregar retenciones al payload
        totals: {
          total_aplicado: finalTotalApplied,
          retenciones_iibb: formData.retenciones_iibb,
          otras_retenciones: formData.otras_retenciones,
          anticipo: formData.anticipo,
          descuentos: formData.descuentos,
          intereses: formData.intereses,
          diferencia_cambio: formData.diferencia_cambio,
          total_cobrar: formData.total_cobrar
        },
        company: activeCompany
      }
      if (assignedInvoices.length > 0 && selectedConciliationId) {
        paymentData.assigned_invoices_for_conciliation = assignedInvoices
      }
      if (editingData && editingData.status === 'Confirmado') {
        paymentData.replace_confirmed_payment = true
      }

      console.log('Sending payment data:', paymentData)

      let response
      if (editingData) {
        response = await fetchWithAuth(`/api/pagos/${editingData.name}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(paymentData)
        })
      } else {
        response = await fetchWithAuth('/api/pagos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(paymentData)
        })
      }

      if (response.ok) {
        const result = await response.json()
        const successMessage = isEditing && editingData?.status === 'Confirmado'
          ? 'Pago reemplazado exitosamente'
          : isEditing
            ? 'Pago actualizado exitosamente'
            : 'Pago creado exitosamente'
        showNotification(successMessage, 'success')
        onSave && onSave(result.data)
        onClose()
      } else {
        const error = await response.json()
        console.error('Backend error response:', error)
        console.error('Backend error status:', response.status)
        console.error('Backend error text:', await response.text())
        showNotification(error.message || 'Error al guardar el pago', 'error')
      }
    } catch (error) {
      console.error('Error saving payment:', error)
      showNotification('Error al guardar el pago', 'error')
    } finally {
      setSaving(false)
    }
  }

  const getStatusOptions = () => {
    if (editingData) {
      return ['Confirmado', 'Cancelado']
    } else {
      return ['Confirmado', 'Borrador']
    }
  }

  if (loading) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Cargando..." size="large">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Modal>
    )
  }

  const resolvedPaymentCurrency =
    formData.currency ||
    (isBankMode ? bankAccountDetails?.account_currency : companyCurrency) ||
    ''
  const isCompanyBaseCurrency = Boolean(companyCurrency) && resolvedPaymentCurrency === companyCurrency

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingData ? 'Editar cobranza' : 'Ingresar cobranza'}
      subtitle={
        `${displayCustomerName || (customerDetails?.customer_name || selectedCustomer || 'Cliente')}${customerDetails?.tax_id ? ` · CUIT: ${customerDetails.tax_id}` : ''}`
      }
      size="default"
    >
        <div className="flex flex-col md:flex-row gap-4 h-full overflow-hidden">
          <div className="flex-grow flex flex-col gap-4 overflow-y-auto">
            {/* SECCIÓN SUPERIOR COMPACTA */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-3 p-4 bg-white border border-gray-200 rounded-2xl">
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">
                Tipo de Talonario
              </label>
              <select
                value={typeof selectedTalonario === 'string' ? selectedTalonario : selectedTalonario?.name || ''}
                onChange={(e) => handleTalonarioChange(e.target.value)}
                disabled={availableTalonarios.length === 1}
                className={`w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7 ${availableTalonarios.length === 1 ? 'bg-gray-50 cursor-not-allowed' : ''}`}
              >
                {availableTalonarios.map(talonario => (
                  <option key={talonario.name} value={talonario.name}>
                    {talonario.descripcion} - {talonario.tipo_de_talonario}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">
                Punto de Venta
              </label>
              <input
                type="text"
                value={puntoVenta}
                readOnly
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md bg-gray-50 h-7"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">
                Próximo Número
              </label>
              <input
                type="text"
                value={nextPaymentNumber || (selectedTalonario ? 'Cargando...' : '')}
                readOnly
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md bg-gray-50 h-7"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">
                Fecha Cobranza
              </label>
              <input
                type="date"
                value={isBankMode ? (bankPostingDate || formData.posting_date) : formData.posting_date}
                onChange={(e) => handleInputChange('posting_date', e.target.value)}
                readOnly={isBankMode}
                className={`${inputClass} ${isBankMode ? 'bg-gray-100 cursor-not-allowed' : ''}`}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">
                Estado
              </label>
              <select
                value={formData.status}
                onChange={(e) => handleInputChange('status', e.target.value)}
                className={inputClass}
                disabled={isBankMode || (editingData && formData.status === 'Cancelado')}
              >
                {getStatusOptions().map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">
                Moneda
              </label>
              <input
                type="text"
                value={resolvedPaymentCurrency}
                readOnly
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md bg-gray-50 h-7 cursor-not-allowed"
                title="La moneda está determinada por la cuenta contable asociada al medio de pago"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">
                Tasa de Cambio
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  value={formData.exchange_rate}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value)
                    handleInputChange('exchange_rate', Number.isFinite(parsed) ? parsed : '')
                  }}
                  className={`${inputClass} ${isCompanyBaseCurrency ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                  disabled={isLoadingExchangeRate || isCompanyBaseCurrency}
                  title={isCompanyBaseCurrency ? `La tasa de cambio es siempre 1 para ${companyCurrency}` : 'Editar tasa de cambio'}
                />
                {isLoadingExchangeRate && (
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                    <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-600"></div>
                  </div>
                )}
              </div>
            </div>

            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">
                Descripción
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="Descripción del pago..."
                className={inputClass}
              />
            </div>
          </div>

          {/* Shared unpaid invoices / conciliations section (replaces manual table above). */}
          <div>
            {(() => {
              const selectedEntries = Object.entries(invoiceSelections)
              const selectedUnpaidInvoices = selectedEntries
                .filter(([_, selection]) => selection.selected)
                .map(([name, selection]) => ({ name, amount: selection.saldo_aplicado || 0 }))
              const totalApplied = selectedEntries.reduce((sum, [, selection]) => sum + (selection.selected ? (parseFloat(selection.saldo_aplicado) || 0) : 0), 0)
              const displayedTotal = selectedConciliationNet !== null
                ? Math.abs(parseOptionalNumber(selectedConciliationNet) || 0)
                : Math.abs(totalApplied)

              return (
                <UnpaidInvoicesSection
                  isCreditNote={() => true}
                  title="Facturas Impagas"
                  formData={{
                    selected_unpaid_invoices: selectedUnpaidInvoices,
                    credit_note_total: displayedTotal
                  }}
                  unpaidInvoices={unpaidInvoices}
                  conciliationSummaries={conciliationSummaries}
                  handleUnpaidInvoiceSelection={handleUnpaidInvoiceSelection}
                  handleUnpaidInvoiceAmountChange={handleUnpaidInvoiceAmountChange}
                  formatCurrency={(v) => `$${Number(v || 0).toFixed(2)}`}
                />
              )
            })()}
          </div>

          {/* Medios de Cobro */}
            <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold text-gray-900">Medios de Cobro</h3>
              <button
                onClick={addPaymentMethod}
                disabled={isBankMode}
                className={`flex items-center gap-2 text-xs font-semibold px-2 py-1 rounded-md ${
                  isBankMode
                    ? 'text-gray-400 cursor-not-allowed bg-gray-100'
                    : 'text-blue-600 hover:text-blue-800 hover:bg-blue-50'
                }`}
              >
                <Plus className="w-3 h-3" />
                Agregar
              </button>
            </div>
            {isBankMode && (
              <p className="text-xs text-gray-500 mb-2">
                El importe del medio de cobro se bloquea para igualar los movimientos bancarios seleccionados.
              </p>
            )}

            <div className="overflow-x-auto border border-gray-200 rounded-2xl">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Medio de Pago
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fecha
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Importe
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Opc.
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paymentMethods.map((method, index) => (
                    <tr key={method.id}>
                      <td className="px-3 py-2">
                        <select
                          value={method.medio_pago}
                          onChange={(e) => updatePaymentMethod(method.id, 'medio_pago', e.target.value)}
                          disabled={isBankMode}
                          className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7 ${
                            isBankMode ? 'bg-gray-100 cursor-not-allowed' : ''
                          }`}
                        >
                          {paymentModeOptions.length === 0 ? (
                            <option value="">
                              Sin medios disponibles
                            </option>
                          ) : (
                            paymentModeOptions.map((opt) => (
                              <option key={opt.mode_of_payment || opt.value} value={opt.mode_of_payment || opt.value}>
                                {opt.display || opt.label}
                              </option>
                            ))
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={isBankMode ? (bankPostingDate || method.fecha_pago) : method.fecha_pago}
                          onChange={(e) => updatePaymentMethod(method.id, 'fecha_pago', e.target.value)}
                          readOnly={isBankMode}
                          className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7 ${
                            isBankMode ? 'bg-gray-100 cursor-not-allowed' : ''
                          }`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={method.importe}
                          onChange={(e) => handlePaymentAmountChange(method.id, e.target.value)}
                          onBlur={(e) => handlePaymentAmountBlur(method.id, e.target.value)}
                          readOnly={isBankMode}
                          className={`w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent h-7 text-right font-mono ${
                            isBankMode ? 'bg-gray-100 cursor-not-allowed' : ''
                          }`}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {!isBankMode && paymentMethods.length > 1 && (
                          <button
                            onClick={() => removePaymentMethod(method.id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

  {/* PANEL LATERAL DE RESUMEN */}
  <div className="w-full md:w-64 lg:w-72 flex-shrink-0 bg-white rounded-2xl p-5 border border-gray-200 flex flex-col">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-gray-800">Resumen</h3>
          </div>
          
          {isBankMode && (
            <div
              className={`mb-3 rounded-2xl border text-xs p-3 ${
                canUseLockedAmount
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <p className="text-sm font-semibold">Importe fijado por movimientos bancarios</p>
              <p className="mt-1">
                {canUseLockedAmount
                  ? `Total neto seleccionado: $${formattedLockedBankAmount || '0,00'}`
                  : 'Los movimientos elegidos no tienen un saldo neto positivo. Selecciona otra combinacion para continuar.'}
              </p>
            </div>
          )}
          
          {/* Sección de Retenciones */}
          <RetencionesSection
            withholdings={withholdings}
            onWithholdingsChange={setWithholdings}
            invoiceOptions={unpaidInvoices.filter(inv => invoiceSelections[inv.name]?.selected)}
            minimal={true}
          />
          
          <div className="space-y-2 flex-grow text-xs">
            <div className="flex justify-between items-center text-gray-600">
              <span className="font-medium">Total Aplicado</span>
              <span className="font-mono">${formData.total_aplicado?.toFixed(2)}</span>
            </div>
            {parseFloat(formData.retenciones_iibb || 0) + parseFloat(formData.otras_retenciones || 0) > 0 && (
              <div className="flex justify-between items-center text-gray-600">
                <span className="font-medium">Retenciones</span>
                <span className="font-mono text-orange-600">- ${(parseFloat(formData.retenciones_iibb || 0) + parseFloat(formData.otras_retenciones || 0)).toFixed(2)}</span>
              </div>
            )}
            {parseFloat(formData.intereses || 0) > 0 && (
              <div className="flex justify-between items-center text-gray-600">
                <span className="font-medium">Intereses</span>
                <span className="font-mono">+ ${parseFloat(formData.intereses || 0).toFixed(2)}</span>
              </div>
            )}
            {parseFloat(formData.diferencia_cambio || 0) > 0 && (
              <div className="flex justify-between items-center text-gray-600">
                <span className="font-medium">Dif. Cambio</span>
                <span className="font-mono">+ ${parseFloat(formData.diferencia_cambio || 0).toFixed(2)}</span>
              </div>
            )}
            {(() => {
              const totalRetenciones = parseFloat(formData.retenciones_iibb || 0) + parseFloat(formData.otras_retenciones || 0)
              const saldoAFavor = (formData.total_cobrar || 0) + totalRetenciones - (formData.total_aplicado || 0)
              if (saldoAFavor > 0.005) {
                return (
                  <div className="flex justify-between items-center text-gray-600">
                    <span className="font-medium">Saldo a Favor</span>
                    <span className="font-mono text-green-600">+ ${saldoAFavor.toFixed(2)}</span>
                  </div>
                )
              }
              return null
            })()}
            <div className="pt-2 border-t border-gray-200 flex justify-between items-center mt-2">
              <span className="text-sm font-bold text-gray-800">Total a Cobrar</span>
              <span className="text-lg font-bold text-blue-600 font-mono">${formData.total_cobrar?.toFixed(2)}</span>
            </div>
          </div>
            <div className="mt-4 space-y-2">
            <button
              onClick={handleSave}
              disabled={saving || !canUseLockedAmount || !isPaymentMethodValid}
                className={`btn-payment btn-manage-addresses w-full flex items-center justify-center gap-2 ${(saving || !canUseLockedAmount || !isPaymentMethodValid) ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-3 h-3" />
                  {editingData ? 'Actualizar' : 'Guardar'}
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="w-full px-3 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 font-medium text-xs"
              disabled={saving}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default PaymentModal
