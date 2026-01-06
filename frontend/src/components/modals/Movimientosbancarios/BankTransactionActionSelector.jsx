import React, { useContext, useEffect, useMemo, useState } from 'react'
import { Sparkles, Wallet, ShieldCheck, AlertTriangle, Loader2, Search, Receipt, Building2, UserCheck, ArrowLeftRight } from 'lucide-react'
import Modal from '../../Modal'
import { AuthContext } from '../../../AuthProvider'
import { useNotification } from '../../../contexts/NotificationContext'

const MIN_ACCOUNT_QUERY = 2

const formatCurrency = (value) => {
  const number = Number(value || 0)
  return number.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const monthLabel = (dateString) => {
  if (!dateString) return 'Sin fecha'
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
}

const groupByMonth = (transactions = []) => {
  const groups = new Map()
  transactions.forEach((tx) => {
    const deposit = Number(tx.deposit || 0)
    const withdrawal = Number(tx.withdrawal || 0)
    const amount = deposit > 0 ? deposit : withdrawal
    if (!amount) return
    const key = (tx.date || '').slice(0, 7) || 'sin-fecha'
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: tx.date ? monthLabel(tx.date) : 'Sin fecha',
        total: 0,
        count: 0
      })
    }
    const bucket = groups.get(key)
    bucket.total += amount
    bucket.count += 1
  })
  return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key))
}

export default function BankTransactionActionSelector({
  isOpen,
  onClose,
  selectedCount = 0,
  selectedTransactions = [],
  accountDetails,
  onSelectAction,
  onConfirmFreeConversion
}) {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useNotification()

  const [strategy, setStrategy] = useState('mapping')
  const [mappings, setMappings] = useState([])
  const [loadingMappings, setLoadingMappings] = useState(false)
  const [selectedMappingName, setSelectedMappingName] = useState('')
  const [mappingError, setMappingError] = useState('')

  const [accountQuery, setAccountQuery] = useState('')
  const [accountResults, setAccountResults] = useState([])
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [searchingAccounts, setSearchingAccounts] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const totals = useMemo(() => {
    let deposits = 0
    let withdrawals = 0
    selectedTransactions.forEach((tx) => {
      deposits += Number(tx.deposit || 0)
      withdrawals += Number(tx.withdrawal || 0)
    })
    const net = deposits - withdrawals
    return { deposits, withdrawals, net }
  }, [selectedTransactions])

  const monthlyBreakdown = useMemo(() => groupByMonth(selectedTransactions), [selectedTransactions])
  const showCustomerOption = totals.net >= 0
  const showSupplierOption = totals.net <= 0

  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.name === selectedMappingName),
    [mappings, selectedMappingName]
  )

  const canConfirm = strategy === 'mapping'
    ? Boolean(selectedMappingName)
    : Boolean(selectedAccount)

  useEffect(() => {
    if (!isOpen) return
    setStrategy('mapping')
    setSelectedMappingName('')
    setSelectedAccount(null)
    setAccountQuery('')
    setMappingError('')
    loadMappings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const loadMappings = async () => {
    if (!fetchWithAuth) return
    setLoadingMappings(true)
    setMappingError('')
    try {
      const response = await fetchWithAuth('/api/expense-mappings')
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'No se pudieron cargar los mapeos')
      }
      const payload = await response.json()
      const allMappings = payload?.data || []
      let filtered = allMappings.filter(
        (mapping) => (mapping.usage_context || '').toLowerCase() === 'bank_reconciliation'
      )
      if (filtered.length === 0 && allMappings.length > 0) {
        filtered = allMappings
      }
      setMappings(filtered)
      if (filtered.length === 0) {
        setStrategy('account')
        setSelectedMappingName('')
      } else {
        setSelectedMappingName(filtered[0].name)
      }
    } catch (error) {
      console.error('Error loading mappings', error)
      setMappingError(error.message || 'Error al cargar mapeos')
      setStrategy('account')
    } finally {
      setLoadingMappings(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    if (accountQuery.trim().length < MIN_ACCOUNT_QUERY) {
      setAccountResults([])
      return
    }

    let cancelled = false
    const searchAccounts = async () => {
      setSearchingAccounts(true)
      try {
        const response = await fetchWithAuth(`/api/accounts?search=${encodeURIComponent(accountQuery)}&limit=10`)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.message || 'No se pudieron buscar cuentas')
        }
        const data = await response.json()
        if (!cancelled) {
          setAccountResults(data.data || [])
        }
      } catch (error) {
        console.error('Error searching accounts', error)
      } finally {
        if (!cancelled) {
          setSearchingAccounts(false)
        }
      }
    }

    searchAccounts()
    return () => {
      cancelled = true
    }
  }, [accountQuery, fetchWithAuth, isOpen])

  const handleAccountSelect = (account) => {
    setSelectedAccount(account)
    setAccountQuery(account.account_name || account.name || '')
    setAccountResults([])
  }

  const handleConfirm = async () => {
    if (!canConfirm || isSubmitting) return
    setIsSubmitting(true)
    try {
      const payload = {
        strategy,
        mapping: strategy === 'mapping' ? selectedMapping : null,
        account: strategy === 'account' ? selectedAccount : null,
        totals,
        monthlyBreakdown,
        selectedCount
      }
      if (typeof onConfirmFreeConversion === 'function') {
        await onConfirmFreeConversion(payload)
      }
    } catch (error) {
      console.error('Error confirming conversion', error)
      showNotification(error.message || 'No se pudo preparar la conversion', 'error')
      setIsSubmitting(false)
      return
    }
    setIsSubmitting(false)
    onClose()
  }

  const bankName = accountDetails?.mode_of_payment || accountDetails?.account_name || 'Cuenta seleccionada'
  const currency = accountDetails?.currency || accountDetails?.account_currency

  const renderMappingSelector = () => {
    if (loadingMappings) {
      return (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando mapeos...
        </div>
      )
    }

    if (mappingError) {
      return (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          {mappingError}
        </div>
      )
    }

    if (mappings.length === 0) {
      return (
        <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
          No encontramos mapeos configurados para conciliacion bancaria. Configura uno en Tesoreria &gt; Expense Account Mapping.
        </div>
      )
    }

    return (
      <div className="space-y-2">
        <select
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          value={selectedMappingName}
          onChange={(event) => setSelectedMappingName(event.target.value)}
        >
          {mappings.map((mapping) => (
            <option key={mapping.name} value={mapping.name}>
              {mapping.nombre || mapping.name}
            </option>
          ))}
        </select>
        {selectedMapping && (
          <div className="text-xs text-gray-500">
            Cuenta destino: <span className="font-semibold text-gray-800">{selectedMapping.cuenta_contable}</span>
          </div>
        )}
      </div>
    )
  }

  const renderAccountSelector = () => (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Buscar cuenta contable"
          value={accountQuery}
          onChange={(event) => {
            setAccountQuery(event.target.value)
            if (!event.target.value) {
              setSelectedAccount(null)
            }
          }}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
        {searchingAccounts && (
          <Loader2 className="w-4 h-4 text-violet-500 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
        )}
        {accountResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
            {accountResults.map((account) => (
              <button
                key={account.name}
                type="button"
                onClick={() => handleAccountSelect(account)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
              >
                <div className="text-sm font-semibold text-gray-800">{account.account_name || account.name}</div>
                <div className="text-xs text-gray-500">{account.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedAccount && (
        <div className="text-xs text-gray-500">
          Cuenta seleccionada: <span className="font-semibold text-gray-800">{selectedAccount.account_name || selectedAccount.name}</span>
        </div>
      )}
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Convertir Movimientos Bancarios"
      size="lg"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2 text-xs">
          <div className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">
            Seleccionados: {selectedCount}
          </div>
          <div className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold flex items-center gap-1">
            <Wallet className="w-3 h-3" /> {bankName}
          </div>
          <div className={`px-3 py-1 rounded-full font-semibold flex items-center gap-1 ${totals.net >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            <Sparkles className="w-3 h-3" /> Neto: ${formatCurrency(totals.net)}
          </div>
          <div className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 font-semibold">
            Moneda: {currency}
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-violet-600" />
            <div>
              <h4 className="text-base font-bold text-gray-900">Conciliacion automatica</h4>
              <p className="text-sm text-gray-600">Elegi si queres usar un mapeo existente o indicar la cuenta contable.</p>
            </div>
          </div>

          <div className="space-y-3 mb-4">
            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${strategy === 'mapping' ? 'border-violet-400 bg-white shadow-sm' : 'border-gray-200 bg-white'}`}>
              <input
                type="radio"
                name="conversion-strategy"
                value="mapping"
                checked={strategy === 'mapping'}
                onChange={() => setStrategy('mapping')}
                disabled={mappings.length === 0 && !loadingMappings}
              />
              <div>
                <div className="text-sm font-semibold text-gray-900">Mapeo de Expense Account Mapping</div>
                <div className="text-xs text-gray-500">Aplicamos el mapeo configurado.</div>
              </div>
            </label>

            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${strategy === 'account' ? 'border-violet-400 bg-white shadow-sm' : 'border-gray-200 bg-white'}`}>
              <input
                type="radio"
                name="conversion-strategy"
                value="account"
                checked={strategy === 'account'}
                onChange={() => setStrategy('account')}
              />
              <div>
                <div className="text-sm font-semibold text-gray-900">Cuenta contable directa</div>
                <div className="text-xs text-gray-500">Seleccioná la cuenta contable de destino.</div>
              </div>
            </label>
          </div>

          <div className="mb-4">
            {strategy === 'mapping' ? renderMappingSelector() : renderAccountSelector()}
          </div>

          <div className="text-xs text-gray-500 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-violet-500" />
            Vamos a generar un Payment Entry por mes con los movimientos seleccionados.
          </div>

          {monthlyBreakdown.length > 0 && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {monthlyBreakdown.map((bucket) => (
                <div key={bucket.key} className="p-3 rounded-xl border border-gray-200 bg-white">
                  <div className="font-semibold text-gray-800 capitalize">{bucket.label}</div>
                  <div className="text-gray-500">{bucket.count} movimiento(s)</div>
                  <div className="text-sm font-bold text-gray-900">${formatCurrency(bucket.total)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mt-4">
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Revisar antes de confirmar, esta accion es automatica.
            </div>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm || isSubmitting}
              className={`btn-secondary inline-flex items-center gap-2 ${(!canConfirm || isSubmitting) ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Conciliar automaticamente
                </>
              )}
            </button>
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 bg-white space-y-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-blue-600" />
            <div>
              <h4 className="text-base font-bold text-gray-900">Pagos y cobros</h4>
              <p className="text-sm text-gray-600">
                Crear un recibo, una orden de pago o un canje entre cajas con los importes seleccionados.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {showCustomerOption && (
              <button
                type="button"
                onClick={() => {
                  if (onSelectAction) onSelectAction('customer_payment', 'Customer')
                  onClose()
                }}
                className="p-4 rounded-2xl border border-blue-200 hover:border-blue-400 hover:shadow-md transition text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-blue-50">
                    <UserCheck className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">Recibo de cliente</div>
                    <div className="text-xs text-gray-500">El importe quedara bloqueado con el total seleccionado.</div>
                  </div>
                </div>
              </button>
            )}

            {showSupplierOption && (
              <button
                type="button"
                onClick={() => {
                  if (onSelectAction) onSelectAction('supplier_payment', 'Supplier')
                  onClose()
                }}
                className="p-4 rounded-2xl border border-green-200 hover:border-green-400 hover:shadow-md transition text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-green-50">
                    <Building2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">Pago a proveedor</div>
                    <div className="text-xs text-gray-500">Creamos la orden de pago usando la seleccion actual.</div>
                  </div>
                </div>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (onSelectAction) onSelectAction('cash_exchange', null)
                onClose()
              }}
              className="p-4 rounded-2xl border border-violet-200 hover:border-violet-400 hover:shadow-md transition text-left"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-violet-50">
                  <ArrowLeftRight className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">Canje entre cajas</div>
                  <div className="text-xs text-gray-500">Movemos el saldo seleccionado entre cuentas de tesoreria.</div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
