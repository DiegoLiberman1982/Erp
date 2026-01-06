import React, { useState, useContext, useEffect, useMemo } from 'react'
import { X, Plus, Trash2, Save, Trash, ChevronDown, ChevronUp, Settings } from 'lucide-react'
import Modal from '../Modal.jsx'
import Notification from '../Notification.jsx'
import { NotificationContext } from '../../contexts/NotificationContext'
import { AuthContext } from '../../AuthProvider'
import API_ROUTES from '../../apiRoutes'
import Select from 'react-select'
import { addCompanyAbbrToSupplier } from '../Supplierpanel/supplierHandlers'
import JournalEntryLineSettingsModal from './JournalEntryLineSettingsModal.jsx'

const GRID_TEMPLATE_WITH_CURRENCY = '3fr 1fr 1fr 2fr 1.5fr 0.75fr auto'
const GRID_TEMPLATE_SINGLE_CURRENCY = '3fr 1fr 1fr 2fr 0.75fr auto'

const JournalEntryModal = ({
  isOpen,
  onClose,
  onSave,
  selectedAccount,
  editingData,
  isSaving = false,
  availableAccounts = []
}) => {
  const { showNotification } = useContext(NotificationContext)
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  // Do not hardcode a fallback currency here
  const [companyCurrency, setCompanyCurrency] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editingVoucherNo, setEditingVoucherNo] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showMoreDetails, setShowMoreDetails] = useState(false)
  const [saveAsDraft, setSaveAsDraft] = useState(false)
  const [entryStatus, setEntryStatus] = useState('Confirmada')
  const providedAccounts = Array.isArray(availableAccounts) ? availableAccounts : []
  const [accounts, setAccounts] = useState(providedAccounts)
  const [customers, setCustomers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [costCenters, setCostCenters] = useState([])
  const [lineSettingsModal, setLineSettingsModal] = useState({ isOpen: false, index: null })

  const toAmountString = (value, fallback = '0.00') => {
    if (value === null || value === undefined || value === '') {
      return fallback
    }
    return String(value)
  }

  // Función para limpiar el nombre de la cuenta (quitar abreviación de empresa)
  const [formData, setFormData] = useState({
    posting_date: new Date().toISOString().split('T')[0],
    title: '',
      remark: '',
      currency: companyCurrency, // Moneda del asiento
      accounts: Array.from({ length: 5 }, () => ({
        account: '', // Display name
        account_code: '', // ERPNext account code
        debit: '0.00',
        credit: '0.00',
        debit_account_currency: '0.00',
        credit_account_currency: '0.00',
        remark: '', // Comment per line
        party_type: '', // Customer, Supplier, etc.
        party: '', // Customer/Supplier name
        cost_center: '', // Cost center
        currency: companyCurrency,
        exchange_rate: '1.0000'
      }))
    })

  // Get company currency on mount
  useEffect(() => {
    const getCompanyInfo = async () => {
      try {
        const response = await fetchWithAuth('/api/active-company')
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            setCompanyName(data.data.active_company)
            // Get full company details to get currency
            const companyResponse = await fetchWithAuth(`/api/companies/${data.data.active_company}`)
            if (companyResponse.ok) {
              const companyData = await companyResponse.json()
              if (companyData.success && companyData.data?.default_currency) {
                setCompanyCurrency(companyData.data.default_currency)
                // Update existing accounts with company currency
                const defaultCurrency = companyData.data.default_currency
                setFormData(prev => ({
                  ...prev,
                  currency: defaultCurrency, // Update journal entry currency
                  accounts: prev.accounts.map(account => {
                    const nextAccount = {
                      ...account,
                      debit: account.debit || '0.00',
                      credit: account.credit || '0.00',
                      currency: account.currency || defaultCurrency,
                      exchange_rate:
                        account.currency && account.currency !== defaultCurrency
                          ? account.exchange_rate || ''
                          : '1.0000'
                    }
                    return syncAccountCurrencyAmounts(nextAccount)
                  })
                }))
              }
            }
          }
        }
      } catch (error) {
        console.error('Error getting company info:', error)
      }
    }

    if (isOpen) {
      getCompanyInfo()
    }
  }, [isOpen, fetchWithAuth])

  useEffect(() => {
    if (Array.isArray(availableAccounts) && availableAccounts.length) {
      setAccounts(availableAccounts)
    }
  }, [availableAccounts])


  const currencySummary = useMemo(() => {
    const codes = new Set()
    let hasForeignCurrencyLines = false
    formData.accounts.forEach((account) => {
      const code = (account.currency || companyCurrency || '').trim()
      if (code) {
        codes.add(code)
        if (companyCurrency && code !== companyCurrency) {
          hasForeignCurrencyLines = true
        }
      }
    })
    const list = Array.from(codes)
    const primaryCurrency = list[0] || companyCurrency || ''
    const isMultiCurrencyEntry = list.length > 1
    return { primaryCurrency, isMultiCurrencyEntry, hasForeignCurrencyLines }
  }, [formData.accounts, companyCurrency])
  const showCurrencyColumn = currencySummary.hasForeignCurrencyLines
  const lineGridTemplate = showCurrencyColumn ? GRID_TEMPLATE_WITH_CURRENCY : GRID_TEMPLATE_SINGLE_CURRENCY

  const buildStatusOptions = () => {
    if (!isEditing) {
      return ['Borrador', 'Confirmada']
    }
    if (entryStatus === 'Anulada') {
      return ['Anulada']
    }
    if (editingData?.docstatus === 1) {
      return ['Confirmada', 'Anulada']
    }
    if (editingData?.docstatus === 0) {
      return ['Borrador', 'Confirmada']
    }
    return ['Borrador', 'Confirmada']
  }

  const statusOptions = buildStatusOptions()

  // Effect to handle editing data
  useEffect(() => {
    if (editingData && isOpen) {
      setIsEditing(true)
      setEditingVoucherNo(editingData.voucher_no)
      
      const isDraft = editingData.docstatus === 0
      setSaveAsDraft(isDraft)
      const currentStatus = editingData.docstatus === 1 ? 'Confirmada' : editingData.docstatus === 2 ? 'Anulada' : 'Borrador'
      setEntryStatus(currentStatus)
      
      const mappedAccounts = (editingData.accounts || []).map(accountLine => {
        const lineCurrency = accountLine.account_currency || companyCurrency
        const requiresForeignRate = lineCurrency && companyCurrency && lineCurrency !== companyCurrency
        const exchangeRateString = accountLine.exchange_rate
          ? toAmountString(accountLine.exchange_rate, requiresForeignRate ? '' : '1.0000')
          : requiresForeignRate
            ? ''
            : '1.0000'

        return syncAccountCurrencyAmounts({
          account: accountLine.account || '',
          account_code: accountLine.account_code || accountLine.account || '',
          debit: toAmountString(
            accountLine.debit !== undefined && accountLine.debit !== null
              ? accountLine.debit
              : accountLine.debit_in_account_currency
          ),
          credit: toAmountString(
            accountLine.credit !== undefined && accountLine.credit !== null
              ? accountLine.credit
              : accountLine.credit_in_account_currency
          ),
          debit_account_currency: toAmountString(
            accountLine.debit_in_account_currency !== undefined && accountLine.debit_in_account_currency !== null
              ? accountLine.debit_in_account_currency
              : accountLine.debit
          ),
          credit_account_currency: toAmountString(
            accountLine.credit_in_account_currency !== undefined && accountLine.credit_in_account_currency !== null
              ? accountLine.credit_in_account_currency
              : accountLine.credit
          ),
          remark: accountLine.user_remark || accountLine.remark || '',
          party_type: accountLine.party_type === 'Customer' ? 'C'
            : accountLine.party_type === 'Supplier' ? 'P' : '',
          party: accountLine.party || '',
          cost_center: accountLine.cost_center || '',
          currency: lineCurrency,
          exchange_rate: exchangeRateString
        })
      })

      setFormData({
        posting_date: editingData.posting_date,
        title: editingData.title || '',
        remark: editingData.remark || '',
        currency: editingData.currency || companyCurrency,
        accounts: mappedAccounts.length
          ? mappedAccounts
          : Array.from({ length: 5 }, () => ({
              account: '',
              account_code: '',
              debit: '0.00',
              credit: '0.00',
              debit_account_currency: '0.00',
              credit_account_currency: '0.00',
              remark: '',
              party_type: '',
              party: '',
              cost_center: '',
              currency: companyCurrency,
              exchange_rate: '1.0000'
            }))
      })
      
    } else if (isOpen && !editingData) {
      setIsEditing(false)
      setEditingVoucherNo(null)
      resetForm()
    }
  }, [editingData, isOpen, companyCurrency])

  // Load accounts, customers and suppliers when modal opens
  useEffect(() => {
    const loadData = async () => {
      if (!isOpen) return

      try {
        if (!providedAccounts.length) {
          const accountsResponse = await fetchWithAuth(API_ROUTES.accounts)
          if (accountsResponse.ok) {
            const accountsData = await accountsResponse.json()
            setAccounts(accountsData.data || [])
          }
        }

        // Load customers
        const customersResponse = await fetchWithAuth('/api/customers')
        if (customersResponse.ok) {
          const customersData = await customersResponse.json()
          const customerList = customersData.data || customersData.customers || []
          setCustomers(Array.isArray(customerList) ? customerList : [])
        }

        // Load suppliers
        const suppliersResponse = await fetchWithAuth('/api/suppliers')
        if (suppliersResponse.ok) {
          const suppliersData = await suppliersResponse.json()
          const supplierList = suppliersData.data || suppliersData.suppliers || []
          setSuppliers(Array.isArray(supplierList) ? supplierList : [])
        }

        // Load cost centers
        const costCentersResponse = await fetchWithAuth(API_ROUTES.costCenters)
        if (costCentersResponse.ok) {
          const costCentersData = await costCentersResponse.json()
          const centers = costCentersData.data || costCentersData.cost_centers || []
          const leafCenters = Array.isArray(centers)
            ? centers.filter((center) => Number(center?.is_group) === 0 || center?.is_group === false)
            : []
          setCostCenters(leafCenters)
        }
      } catch (error) {
        console.error('Error loading data:', error)
      }
    }

    loadData()
  }, [isOpen, fetchWithAuth, providedAccounts.length])

  useEffect(() => {
    if (!isOpen) return
    formData.accounts.forEach((account, index) => {
      const currencyCode = getAccountCurrencyCode(account)
      if (!requiresExchange(currencyCode)) return
      const rate = parseFloat(account.exchange_rate)
      if (!Number.isFinite(rate) || rate <= 0) {
        fetchExchangeRateForLine(index, currencyCode)
      }
    })
  }, [isOpen, formData.accounts, companyCurrency])

  useEffect(() => {
    if (!isEditing || !Array.isArray(accounts) || !accounts.length || !companyCurrency) {
      return
    }
    setFormData((prev) => {
      let hasChanges = false
      const updatedAccounts = prev.accounts.map((line) => {
        if (!line.account_code) return line
        const metadata = accounts.find((acc) => acc.name === line.account_code)
        if (!metadata?.account_currency) return line
        const nextCurrency = metadata.account_currency
        const foreignCurrency = companyCurrency ? nextCurrency !== companyCurrency : false
        const shouldUpdateCurrency = nextCurrency !== (line.currency || '')
        const shouldUpdateExchange = foreignCurrency
          ? !line.exchange_rate || line.exchange_rate === '1.0000'
          : line.exchange_rate !== '1.0000'
        if (!shouldUpdateCurrency && !shouldUpdateExchange) {
          return line
        }
        hasChanges = true
        return {
          ...line,
          currency: nextCurrency,
          exchange_rate: foreignCurrency
            ? (line.exchange_rate && line.exchange_rate !== '1.0000' ? line.exchange_rate : '')
            : '1.0000'
        }
      })
      if (!hasChanges) {
        return prev
      }
      return {
        ...prev,
        accounts: updatedAccounts
      }
    })
  }, [isEditing, accounts, companyCurrency])

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleAccountChange = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      accounts: prev.accounts.map((account, i) => {
        if (i !== index) return account
        const nextAccount = { ...account, [field]: value }
        if (field === 'currency' || field === 'exchange_rate' || field === 'debit' || field === 'credit') {
          return syncAccountCurrencyAmounts(nextAccount)
        }
        return nextAccount
      })
    }))
  }

  const fetchExchangeRateForLine = async (lineIndex, currencyCode) => {
    if (!currencyCode || !companyCurrency || currencyCode === companyCurrency) {
      return
    }
    try {
      const response = await fetchWithAuth(API_ROUTES.currencyExchange.latest(currencyCode))
      if (!response.ok) return
      const payload = await response.json()
      if (!payload?.success) return
      const rateValue = payload?.data?.exchange_rate ?? payload?.data?.rate ?? payload?.rate
      if (!rateValue) return
      setFormData(prev => {
        const targetAccount = prev.accounts[lineIndex]
        if (!targetAccount) return prev
        const currentCurrency = targetAccount.currency || companyCurrency
        if (currentCurrency !== currencyCode) {
          return prev
        }
        return {
          ...prev,
          accounts: prev.accounts.map((account, idx) =>
            idx === lineIndex
              ? syncAccountCurrencyAmounts({ ...account, exchange_rate: String(rateValue) })
              : account
          )
        }
      })
    } catch (error) {
      console.error('Error fetching exchange rate:', error)
    }
  }

  const handleAccountSelect = (index, selectedOption) => {
    if (selectedOption) {
      const selectedAccountData = accounts.find(acc => acc.name === selectedOption.value)
      const accountCurrency = selectedAccountData?.account_currency || companyCurrency
      setFormData(prev => ({
        ...prev,
        accounts: prev.accounts.map((account, i) => {
          if (i !== index) return account
          const isForeign = accountCurrency && companyCurrency && accountCurrency !== companyCurrency
          const nextAccount = {
            ...account,
            account: selectedOption.label,
            account_code: selectedOption.value,
            currency: accountCurrency,
            exchange_rate: isForeign && account.currency === accountCurrency && account.exchange_rate
              ? account.exchange_rate
              : isForeign
                ? ''
                : '1.0000'
          }
          return syncAccountCurrencyAmounts(nextAccount)
        })
      }))
      if (accountCurrency && companyCurrency && accountCurrency !== companyCurrency) {
        fetchExchangeRateForLine(index, accountCurrency)
      }
    } else {
      setFormData(prev => ({
        ...prev,
        accounts: prev.accounts.map((account, i) =>
          i === index
            ? syncAccountCurrencyAmounts({
                ...account,
                account: '',
                account_code: '',
                currency: companyCurrency,
                exchange_rate: '1.0000'
              })
            : account
        )
      }))
    }
  }

  const openLineSettingsModal = (index) => {
    setLineSettingsModal({ isOpen: true, index })
  }

  const closeLineSettingsModal = () => {
    setLineSettingsModal({ isOpen: false, index: null })
  }

  const handleLineSettingsSave = (targetIndex, updates) => {
    if (typeof targetIndex !== 'number') return
    setFormData(prev => ({
      ...prev,
      accounts: prev.accounts.map((account, i) => {
        if (i !== targetIndex) return account
        const previousPartyType = account.party_type || ''
        const nextAccount = { ...account }
        if (updates.party_type) {
          nextAccount.party_type = updates.party_type
          nextAccount.party = updates.party || ''
        } else {
          nextAccount.party_type = ''
          nextAccount.party = ''
        }
        if ((updates.party_type || '') !== previousPartyType) {
          nextAccount.account = ''
          nextAccount.account_code = ''
        }
        nextAccount.cost_center = updates.cost_center || ''
        return nextAccount
      })
    }))
    closeLineSettingsModal()
  }

  const addAccountLine = () => {
    setFormData(prev => ({
      ...prev,
      accounts: [
        ...prev.accounts,
        {
          account: '',
          account_code: '',
          debit: '0.00',
          credit: '0.00',
          debit_account_currency: '0.00',
          credit_account_currency: '0.00',
          remark: '',
          party_type: '',
          party: '',
          cost_center: '',
          currency: companyCurrency,
          exchange_rate: '1.0000'
        }
      ]
    }))
  }

  const removeAccountLine = (index) => {
    if (formData.accounts.length > 1) {
      setFormData(prev => ({
        ...prev,
        accounts: prev.accounts.filter((_, i) => i !== index)
      }))
    }
  }

  const parseAmount = (value) => {
    const numeric = parseFloat(value)
    return Number.isFinite(numeric) ? numeric : 0
  }

  const normalizeAccountCurrencyAmount = (value) => {
    if (!Number.isFinite(value)) {
      return 0
    }
    return Number(value.toFixed(6))
  }

  const getAccountCurrencyCode = (account = {}) => {
    return account.currency || companyCurrency || ''
  }

  const requiresExchange = (currencyCode) => {
    if (!currencyCode || !companyCurrency) return false
    return currencyCode !== companyCurrency
  }

  const deriveAccountCurrencyAmount = (baseValue, currencyCode, exchangeRate, fallback = '0.00') => {
    const base = parseAmount(baseValue)
    if (!requiresExchange(currencyCode)) {
      return base.toFixed(2)
    }
    const rate = parseFloat(exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      return fallback
    }
    const converted = base / rate
    return Number.isFinite(converted) ? converted.toFixed(6) : fallback
  }

  const syncAccountCurrencyAmounts = (account) => {
    const currencyCode = getAccountCurrencyCode(account)
    return {
      ...account,
      debit_account_currency: deriveAccountCurrencyAmount(account.debit, currencyCode, account.exchange_rate, account.debit_account_currency),
      credit_account_currency: deriveAccountCurrencyAmount(account.credit, currencyCode, account.exchange_rate, account.credit_account_currency)
    }
  }

  const getExchangeRateForAccount = (account = {}) => {
    const currencyCode = getAccountCurrencyCode(account)
    if (!requiresExchange(currencyCode)) {
      return 1
    }
    const rate = parseFloat(account.exchange_rate)
    return Number.isFinite(rate) && rate > 0 ? rate : 0
  }

  const getAccountCurrencyAmountValue = (account, field) => {
    const sourceValue = field === 'debit' ? account.debit_account_currency : account.credit_account_currency
    const numeric = parseFloat(sourceValue)
    if (Number.isFinite(numeric)) {
      return numeric
    }
    const currencyCode = getAccountCurrencyCode(account)
    const derivedString = deriveAccountCurrencyAmount(account[field], currencyCode, account.exchange_rate, '0')
    const derived = parseFloat(derivedString)
    return Number.isFinite(derived) ? derived : 0
  }

  const getBaseAmount = (account, field) => {
    return parseAmount(account?.[field])
  }

  const calculateBaseTotal = (type) => {
    return formData.accounts.reduce((total, account) => total + getBaseAmount(account, type), 0)
  }

const handleSave = async () => {
  if (entryStatus === 'Anulada') {
    if (isEditing && editingVoucherNo) {
      setShowDeleteConfirm(true)
    } else {
      showNotification('Solo puedes anular un asiento que ya fue guardado', 'warning')
    }
    return
  }

  const totalDebitBase = calculateBaseTotal('debit')
  const totalCreditBase = calculateBaseTotal('credit')

  if (Math.abs(totalDebitBase - totalCreditBase) > 0.01) {
    showNotification('Los debitos y creditos convertidos deben ser iguales', 'error')
    return
  }

  const validAccounts = formData.accounts.filter(account =>
    account.account_code && account.account_code.trim() !== ''
  )

  if (validAccounts.length === 0) {
    showNotification('Debe seleccionar al menos una cuenta', 'error')
    return
  }

  for (const account of validAccounts) {
    const accountData = accounts.find(acc => acc.name === account.account_code)
    if (accountData && (accountData.account_type === 'Receivable' || accountData.account_type === 'Payable')) {
      if (!account.party_type || !account.party) {
        showNotification(`La cuenta "${accountData.account_name}" requiere un ${accountData.account_type === 'Receivable' ? 'cliente' : 'proveedor'}`, 'error')
        return
      }
    }

    const lineCurrency = getAccountCurrencyCode(account)
    if (requiresExchange(lineCurrency)) {
      const rateValue = parseFloat(account.exchange_rate)
      if (!Number.isFinite(rateValue) || rateValue <= 0) {
        showNotification(`Ingresa una cotizacion valida para la cuenta ${account.account || account.account_code}`, 'error')
        return
      }
    }
  }

  const uniqueCurrencies = new Set(
    validAccounts
      .map((account) => getAccountCurrencyCode(account) || companyCurrency)
      .filter(Boolean)
  )
  const usesForeignCurrency = Array.from(uniqueCurrencies).some(
    (code) => companyCurrency && code && code !== companyCurrency
  )
  const multiCurrencyFlag = usesForeignCurrency || uniqueCurrencies.size > 1 ? 1 : 0

  const autoTitle = formData.title.trim() || `Asiento ${formData.posting_date} - ${validAccounts.length} lineas`

  const processedAccounts = await Promise.all(validAccounts.map(async (account) => {
    const accountCurrency = getAccountCurrencyCode(account) || companyCurrency
    const exchangeRateValue = getExchangeRateForAccount(account)
    const debitBase = Number(parseAmount(account.debit).toFixed(2))
    const creditBase = Number(parseAmount(account.credit).toFixed(2))
    const debitInAccountCurrency = normalizeAccountCurrencyAmount(
      getAccountCurrencyAmountValue(account, 'debit')
    )
    const creditInAccountCurrency = normalizeAccountCurrencyAmount(
      getAccountCurrencyAmountValue(account, 'credit')
    )

    const mappedAccount = {
      account: account.account_code,
      account_currency: accountCurrency,
      exchange_rate: exchangeRateValue,
      debit_in_account_currency: debitInAccountCurrency,
      credit_in_account_currency: creditInAccountCurrency,
      debit: debitBase,
      credit: creditBase
    }

    if (account.remark && account.remark.trim()) {
      mappedAccount.user_remark = account.remark.trim()
    }

    if (account.party_type && account.party) {
      mappedAccount.party_type = account.party_type === 'C' ? 'Customer' : 'Supplier'
      if (account.party_type === 'P') {
        mappedAccount.party = await addCompanyAbbrToSupplier(account.party, fetchWithAuth)
      } else {
        mappedAccount.party = account.party
      }
    }

    if (account.cost_center) {
      mappedAccount.cost_center = account.cost_center
    }

    return mappedAccount
  }))

  const journalEntryData = {
    data: {
      voucher_type: "Journal Entry",
      posting_date: formData.posting_date,
      company: companyName,
      title: autoTitle,
      user_remark: formData.remark,
      multi_currency: multiCurrencyFlag,
      currency: companyCurrency,
      accounts: processedAccounts
    },
    save_as_draft: saveAsDraft
  }

  if (isEditing && editingVoucherNo) {
    journalEntryData.data.name = editingVoucherNo
    journalEntryData.isEditing = true
  }

  onSave(journalEntryData)
}

  const handleDelete = async () => {
    if (!isEditing || !editingVoucherNo) return
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    setShowDeleteConfirm(false)
    
    try {
      const response = await fetchWithAuth(`${API_ROUTES.journalEntries}/${editingVoucherNo}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        const successData = await response.json()
        showNotification(successData.message || 'Asiento contable eliminado exitosamente', 'success')
        onClose()
        // Forzar reset del estado de edición
        resetForm()
        // Recargar página para refrescar datos
        window.location.reload()
      } else {
        const errorData = await response.json()
        console.error('Error al eliminar/cancelar asiento:', errorData)
        
        // Mostrar detalles del error si están disponibles
        let errorMessage = errorData.message || 'Error desconocido'
        if (errorData.details) {
          if (typeof errorData.details === 'string') {
            errorMessage += ` - ${errorData.details}`
          } else if (errorData.details.message) {
            errorMessage += ` - ${errorData.details.message}`
          }
        }
        
        showNotification(`Error: ${errorMessage}`, 'error')
      }
    } catch (error) {
      console.error('Error cancelling journal entry:', error)
      showNotification('Error al cancelar asiento contable', 'error')
    }
  }

  const resetForm = () => {
    setFormData({
      posting_date: new Date().toISOString().split('T')[0],
      title: '',
      remark: '',
      currency: companyCurrency,
      accounts: Array.from({ length: 5 }, () => ({
        account: '',
        account_code: '',
        debit: '0.00',
        credit: '0.00',
        debit_account_currency: '0.00',
        credit_account_currency: '0.00',
        remark: '',
        party_type: '',
        party: '',
        cost_center: '',
        currency: companyCurrency,
        exchange_rate: '1.0000'
      }))
    })
    setIsEditing(false)
    setEditingVoucherNo(null)
    setSaveAsDraft(false)
    setEntryStatus('Confirmada')
    setLineSettingsModal({ isOpen: false, index: null })
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? `Editar Asiento Contable - ${editingVoucherNo}` : "Nuevo Asiento Contable"}
      size="default"
    >
      <div className="p-4 space-y-4">
        {/* Campos principales */}
        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha de Contabilización
            </label>
            <input
              type="date"
              value={formData.posting_date}
              onChange={(e) => handleInputChange('posting_date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Moneda
            </label>
            <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-semibold text-gray-800">
              {currencySummary.isMultiCurrencyEntry ? 'Multimoneda' : (currencySummary.primaryCurrency || companyCurrency || 'No definida')}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Estado
            </label>
            <select
              value={entryStatus}
              onChange={(e) => {
                const value = e.target.value
                setEntryStatus(value)
                setSaveAsDraft(value === 'Borrador')
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {statusOptions.map(status => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Título
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              placeholder="Descripción del asiento (opcional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Más detalles - colapsable */}
        <div className="border-t border-gray-200 pt-4">
          <button
            onClick={() => setShowMoreDetails(!showMoreDetails)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200"
          >
            {showMoreDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Más detalles
          </button>
          
          {showMoreDetails && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Observaciones
              </label>
              <textarea
                value={formData.remark}
                onChange={(e) => handleInputChange('remark', e.target.value)}
                placeholder="Observaciones adicionales"
                rows={2}
                className="w-full px-3 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}
        </div>

        {/* Líneas de cuentas */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-900">Líneas del Asiento</h3>
            <button
              onClick={addAccountLine}
              className="inline-flex items-center px-3 py-1.5 text-xs font-bold rounded-lg text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-md hover:shadow-lg"
            >
              <Plus className="w-3 h-3 mr-1.5" />
              Agregar
            </button>
          </div>
        </div>


        {/* Headers */}
        <div
          className="grid gap-2 mb-2 text-xs font-medium text-gray-600 px-2"
          style={{ gridTemplateColumns: lineGridTemplate }}
        >
          <div>Cuenta</div>
          <div className="text-right pr-2">Debito</div>
          <div className="text-right pr-2">Credito</div>
          <div className="text-left pl-1">Comentario</div>
          {showCurrencyColumn && (
            <div className="grid grid-cols-2 gap-2 text-center">
              <span>Moneda</span>
              <span>Cotizacion</span>
            </div>
          )}
          <div></div>
          <div></div>
        </div>

        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {formData.accounts.map((account, index) => {
            const currencyCode = getAccountCurrencyCode(account) || companyCurrency
            const isForeignCurrency = requiresExchange(currencyCode)
            return (
              <div
                key={index}
                className="grid gap-2 p-2 bg-gray-50 rounded-lg items-start"
                style={{ gridTemplateColumns: lineGridTemplate }}
              >
                {/* Cuenta */}
                <div className="flex items-center">
                  <Select
                    value={accounts.find(acc => acc.name === account.account_code) ?
                      { value: account.account_code, label: accounts.find(acc => acc.name === account.account_code).account_name } : null}
                    onChange={(selectedOption) => handleAccountSelect(index, selectedOption)}
                    options={
                      account.party_type === 'C'
                        ? accounts.filter(acc => acc.account_type === 'Receivable' && acc.is_group === 0).map((acc) => ({
                            value: acc.name,
                            label: acc.account_name
                          }))
                        : account.party_type === 'P'
                        ? accounts.filter(acc => acc.account_type === 'Payable' && acc.is_group === 0).map((acc) => ({
                            value: acc.name,
                            label: acc.account_name
                          }))
                        : accounts.filter(acc => acc.is_group === 0).map((acc) => ({
                            value: acc.name,
                            label: acc.account_name
                          }))
                    }
                    placeholder="Seleccionar cuenta..."
                    isClearable
                    isSearchable
                    className="flex-1 text-sm"
                    classNamePrefix="react-select"
                    styles={{
                      control: (provided) => ({
                        ...provided,
                        border: '1px solid #d1d5db',
                        borderRadius: '0.375rem',
                        padding: '0.125rem',
                        fontSize: '0.875rem',
                        minHeight: '36px',
                        height: '36px',
                        '&:hover': {
                          borderColor: '#3b82f6'
                        },
                        '&:focus-within': {
                          borderColor: '#3b82f6',
                          boxShadow: '0 0 0 1px #3b82f6'
                        }
                      }),
                      valueContainer: (provided) => ({
                        ...provided,
                        padding: '0 6px'
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

                {/* Debito */}
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.01"
                    value={account.debit}
                    onChange={(e) => handleAccountChange(index, 'debit', e.target.value)}
                    placeholder="0.00"
                    className="w-full h-9 px-2 text-sm text-right border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                    style={{ MozAppearance: 'textfield' }}
                    inputMode="decimal"
                  />
                </div>

                {/* Credito */}
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.01"
                    value={account.credit}
                    onChange={(e) => handleAccountChange(index, 'credit', e.target.value)}
                    placeholder="0.00"
                    className="w-full h-9 px-2 text-sm text-right border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                    style={{ MozAppearance: 'textfield' }}
                    inputMode="decimal"
                  />
                </div>

                {/* Comentario */}
                <div className="flex items-center">
                  <input
                    type="text"
                    value={account.remark}
                    onChange={(e) => handleAccountChange(index, 'remark', e.target.value)}
                    placeholder="Comentario (opcional)"
                    className="w-full h-9 px-2 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Moneda y Cotizacion */}
                {showCurrencyColumn && (
                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div className="h-9 flex items-center justify-center text-sm font-semibold text-gray-900 text-center">
                      {currencyCode || '--'}
                    </div>
                    {isForeignCurrency ? (
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={account.exchange_rate}
                        onChange={(e) => handleAccountChange(index, 'exchange_rate', e.target.value)}
                        placeholder="0.0000"
                        className="w-full h-9 px-2 text-xs text-right border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                      />
                    ) : (
                      <div className="h-9 flex items-center justify-center text-xs text-gray-400 text-center">1.0000</div>
                    )}
                  </div>
                )}

                {/* Asignaciones */}
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => openLineSettingsModal(index)}
                    className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors"
                    title="Configurar asignaciones"
                    aria-label="Configurar asignaciones"
                  >
                    <Settings size={14} />
                  </button>
                </div>
                {/* Boton eliminar */}
                <div className="flex justify-center items-start">
                  {formData.accounts.length > 1 && (
                    <button
                      onClick={() => removeAccountLine(index)}
                      className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors duration-200"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>          {/* Totales */}
<div className="flex justify-end gap-4 mt-3 p-3 bg-blue-50 rounded-lg">
  <div className="text-right">
    <div className="text-xs text-gray-600">
      Total Debito {companyCurrency ? `(${companyCurrency})` : ''}
    </div>
    <div className="text-sm font-semibold text-gray-900">
      {calculateBaseTotal('debit').toFixed(2)}
    </div>
  </div>
  <div className="text-right">
    <div className="text-xs text-gray-600">
      Total Credito {companyCurrency ? `(${companyCurrency})` : ''}
    </div>
    <div className="text-sm font-semibold text-gray-900">
      {calculateBaseTotal('credit').toFixed(2)}
    </div>
  </div>
  <div className="text-right">
    <div className="text-xs text-gray-600">
      Diferencia {companyCurrency ? `(${companyCurrency})` : ''}
    </div>
    <div className={`text-sm font-semibold ${(calculateBaseTotal('debit') - calculateBaseTotal('credit')).toFixed(2) === '0.00' ? 'text-green-600' : 'text-red-600'}`}>
      {(calculateBaseTotal('debit') - calculateBaseTotal('credit')).toFixed(2)}
    </div>
  </div>
</div>


        {/* Botones */}
        <div className="flex justify-between items-center pt-3 border-t border-gray-200">
          {/* Botón eliminar (solo en modo edición) */}
          {isEditing && (
            <button
              onClick={handleDelete}
              className="inline-flex items-center px-4 py-2 text-sm font-bold rounded-lg text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-300 shadow-md hover:shadow-lg"
            >
              <Trash className="w-4 h-4 mr-2" />
              Eliminar Asiento
            </button>
          )}
          
          {/* Botones de acción */}
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-all duration-300"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={`inline-flex items-center px-4 py-2 text-sm font-bold rounded-lg text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-md hover:shadow-lg ${isSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Procesando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {isEditing ? 'Actualizar' : 'Guardar'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Diálogo de confirmación para eliminar */}
      <JournalEntryLineSettingsModal
        isOpen={lineSettingsModal.isOpen}
        onClose={closeLineSettingsModal}
        lineIndex={lineSettingsModal.index}
        line={lineSettingsModal.index !== null ? formData.accounts[lineSettingsModal.index] : null}
        onSave={handleLineSettingsSave}
        customers={customers}
        suppliers={suppliers}
        costCenters={costCenters}
      />

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900/40 p-4">
          <Notification
            type={saveAsDraft ? "error" : "warning"}
            duration={0}
            onClose={() => setShowDeleteConfirm(false)}
            variant="inline"
            hideCloseButton
            className="max-w-md w-full"
            actions={
              <>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  No, volver
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 text-sm font-bold text-white bg-red-600 border border-red-700 rounded-lg hover:bg-red-700 transition-colors shadow-md hover:shadow-lg"
                >
                  {saveAsDraft ? 'Sí, Eliminar' : 'Sí, Cancelar'}
                </button>
              </>
            }
          >
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-gray-900">
                {saveAsDraft ? 'Eliminar borrador' : 'Cancelar asiento contable'}
              </h3>
              <p className="text-sm text-gray-700">
                {saveAsDraft ? (
                  <>¿Estás seguro de que deseas <span className="font-semibold text-red-600\">eliminar</span> el borrador <span className="font-semibold text-gray-900\">{editingVoucherNo}</span>?</>
                ) : (
                  <>¿Estás seguro de que deseas <span className="font-semibold text-red-600\">cancelar</span> el asiento <span className="font-semibold text-gray-900\">{editingVoucherNo}</span>?</>
                )}
              </p>
              <p className="text-xs text-gray-500">
                {saveAsDraft ? 'Esta acción eliminará permanentemente el borrador.' : 'Se cancelará el asiento y se generará una reversa automática.'}
              </p>
            </div>
          </Notification>
        </div>
      )}
    </Modal>
  )
}

export default JournalEntryModal

// Estilos para quitar las flechitas de los inputs numéricos
const styles = `
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input[type="number"] {
    -moz-appearance: textfield;
  }
`

// Agregar estilos al head del documento
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement("style")
  styleSheet.type = "text/css"
  styleSheet.innerText = styles
  document.head.appendChild(styleSheet)
}
