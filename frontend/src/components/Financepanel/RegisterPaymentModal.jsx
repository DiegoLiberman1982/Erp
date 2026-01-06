import React, { useContext, useEffect, useMemo, useState } from 'react'
import { Calendar, DollarSign, ShieldCheck, ArrowLeftRight, Wallet, Loader2 } from 'lucide-react'
import Modal from '../Modal'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'

const MIN_ACCOUNT_QUERY = 2
const todayISO = () => new Date().toISOString().split('T')[0]

const formatCurrency = (value) => {
  const number = Number(value || 0)
  return number.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function RegisterPaymentModal({
  isOpen,
  onClose,
  accountDetails,
  currency = '',
  treasuryAccounts = [],
  currentAccountId = null,
  onSubmitPayment,
  onSubmitCashExchange
}) {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useNotification()

  const [strategy, setStrategy] = useState('mapping') // mapping | account | cash_exchange
  const [mappings, setMappings] = useState([])
  const [loadingMappings, setLoadingMappings] = useState(false)
  const [selectedMappingName, setSelectedMappingName] = useState('')

  const [accountQuery, setAccountQuery] = useState('')
  const [accountResults, setAccountResults] = useState([])
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [searchingAccounts, setSearchingAccounts] = useState(false)

  const [paymentDate, setPaymentDate] = useState(todayISO())
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDescription, setPaymentDescription] = useState('')
  const [submittingPayment, setSubmittingPayment] = useState(false)

  const [cashTargetAccountId, setCashTargetAccountId] = useState('')
  const [cashDate, setCashDate] = useState(todayISO())
  const [cashAmount, setCashAmount] = useState('')
  const [submittingCashExchange, setSubmittingCashExchange] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setStrategy('mapping')
    setSelectedMappingName('')
    setSelectedAccount(null)
    setAccountQuery('')
    setAccountResults([])
    setPaymentDate(todayISO())
    setPaymentAmount('')
    setPaymentDescription('')
    setCashTargetAccountId('')
    setCashAmount('')
    setCashDate(todayISO())
    loadMappings()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.name === selectedMappingName),
    [mappings, selectedMappingName]
  )

  const canSubmitPayment = useMemo(() => {
    if (strategy === 'cash_exchange') return false
    const numericAmount = Math.abs(parseFloat(paymentAmount || 0))
    if (!numericAmount || !paymentDate) return false
    if (strategy === 'mapping') {
      return Boolean(selectedMapping)
    }
    return Boolean(selectedAccount)
  }, [paymentAmount, paymentDate, strategy, selectedMapping, selectedAccount])

  const canSubmitCashExchange = useMemo(() => {
    if (strategy !== 'cash_exchange') return false
    const numericAmount = Math.abs(parseFloat(cashAmount || 0))
    return Boolean(cashTargetAccountId && numericAmount && cashDate)
  }, [cashTargetAccountId, cashAmount, cashDate, strategy])

  const loadMappings = async () => {
    if (!fetchWithAuth) return
    setLoadingMappings(true)
    try {
      const response = await fetchWithAuth('/api/expense-mappings')
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'No se pudieron cargar los mapeos')
      }
      const payload = await response.json().catch(() => ({}))
      const allMappings = payload?.data || []
      let filtered = allMappings.filter(
        (mapping) => (mapping.usage_context || '').toLowerCase() === 'bank_reconciliation'
      )
      if (filtered.length === 0) {
        filtered = allMappings
      }
      setMappings(filtered)
      if (filtered.length) {
        setSelectedMappingName(filtered[0].name)
        setStrategy('mapping')
      } else {
        setSelectedMappingName('')
        setStrategy('account')
      }
    } catch (error) {
      console.error('Error loading mappings', error)
      showNotification(error.message || 'Error al cargar mapeos', 'error')
      setMappings([])
      setSelectedMappingName('')
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

  const handleSubmitPayment = async () => {
    if (!canSubmitPayment || !onSubmitPayment) return
    setSubmittingPayment(true)
    try {
      await onSubmitPayment({
        strategy,
        mapping: selectedMapping,
        account: selectedAccount,
        amount: paymentAmount,
        postingDate: paymentDate,
        remarks: paymentDescription
      })
    } catch (error) {
      console.error('Error submitting manual payment', error)
    } finally {
      setSubmittingPayment(false)
    }
  }

  const handleSubmitCashExchange = async () => {
    if (!canSubmitCashExchange || !onSubmitCashExchange) return
    setSubmittingCashExchange(true)
    try {
      await onSubmitCashExchange({
        targetAccountId: cashTargetAccountId,
        amount: cashAmount,
        postingDate: cashDate
      })
    } catch (error) {
      console.error('Error submitting cash exchange', error)
    } finally {
      setSubmittingCashExchange(false)
    }
  }

  const renderMappingSelector = () => {
    if (loadingMappings) {
      return (
        <div className="p-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-500">
          Cargando mapeos...
        </div>
      )
    }
    if (!mappings.length) {
      return (
        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-700">
          No hay mapeos configurados. Elegí una cuenta contable manualmente.
        </div>
      )
    }
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold text-gray-600">Mapeo disponible</label>
        <select
          className="select2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          value={selectedMappingName}
          onChange={(event) => setSelectedMappingName(event.target.value)}
        >
          {mappings.map((mapping) => {
            const label = mapping.nombre || mapping.name
            const subtitle = mapping.descripcion || mapping.description || mapping.cuenta_contable
            return (
              <option key={mapping.name} value={mapping.name}>
                {label}{subtitle ? ` — ${subtitle}` : ''}
              </option>
            )
          })}
        </select>
      </div>
    )
  }

  const renderAccountSelector = () => (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-gray-600">Cuenta contable</label>
      <input
        type="text"
        value={accountQuery}
        onChange={(event) => {
          setAccountQuery(event.target.value)
          if (!event.target.value) {
            setSelectedAccount(null)
          }
        }}
        placeholder="Buscar cuenta..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
      />
      {searchingAccounts && <div className="text-xs text-gray-500">Buscando cuentas...</div>}
      {accountResults.length > 0 && (
        <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
          {accountResults.map((account) => (
            <button
              type="button"
              key={account.name}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => handleAccountSelect(account)}
            >
              <div className="font-semibold text-gray-900">{account.account_name || account.name}</div>
              <div className="text-xs text-gray-500">{account.name}</div>
            </button>
          ))}
        </div>
      )}
      {selectedAccount && (
        <div className="text-xs text-gray-500">
          Cuenta seleccionada:{' '}
          <span className="font-semibold text-gray-800">{selectedAccount.account_name || selectedAccount.name}</span>
        </div>
      )}
    </div>
  )

  const availableCashTargets = treasuryAccounts.filter(
    (acc) => acc.id !== currentAccountId && acc.name !== accountDetails?.name
  )

  if (!isOpen) return null

  const currentAccountName = accountDetails?.account_name || accountDetails?.bank_account_name

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar Pago"
      size="lg"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2 text-xs">
          <div className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 font-semibold flex items-center gap-1">
            <Wallet className="w-3 h-3" /> Moneda: {currency || '-'}
          </div>
          {currentAccountName ? (
            <div className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">
              {currentAccountName}
            </div>
          ) : null}
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 bg-gray-50 space-y-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-violet-600" />
            <div>
              <h4 className="text-base font-bold text-gray-900">Definí cómo querés registrar</h4>
              <p className="text-sm text-gray-600">Elegí entre mapeo, cuenta directa o canje entre cuentas.</p>
            </div>
          </div>

          <div className="space-y-3">
            <label
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
                strategy === 'mapping' ? 'border-violet-400 bg-white shadow-sm' : 'border-gray-200 bg-white'
              }`}
            >
              <input
                type="radio"
                name="register-strategy"
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

            <label
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
                strategy === 'account' ? 'border-violet-400 bg-white shadow-sm' : 'border-gray-200 bg-white'
              }`}
            >
              <input
                type="radio"
                name="register-strategy"
                value="account"
                checked={strategy === 'account'}
                onChange={() => setStrategy('account')}
              />
              <div>
                <div className="text-sm font-semibold text-gray-900">Cuenta contable directa</div>
                <div className="text-xs text-gray-500">Seleccioná la cuenta destino.</div>
              </div>
            </label>

            <label
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${
                strategy === 'cash_exchange' ? 'border-violet-400 bg-white shadow-sm' : 'border-gray-200 bg-white'
              }`}
            >
              <input
                type="radio"
                name="register-strategy"
                value="cash_exchange"
                checked={strategy === 'cash_exchange'}
                onChange={() => setStrategy('cash_exchange')}
              />
              <div>
                <div className="text-sm font-semibold text-gray-900">Canje entre cuentas</div>
                <div className="text-xs text-gray-500">Movemos el saldo entre cuentas de tesorería.</div>
              </div>
            </label>
          </div>

          {strategy === 'mapping' && (
            <div className="mt-4">
              {renderMappingSelector()}
            </div>
          )}
          {strategy === 'account' && (
            <div className="mt-4">
              {renderAccountSelector()}
            </div>
          )}

          {strategy !== 'cash_exchange' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-dashed border-gray-200">
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold text-gray-600">Descripción</label>
                  <input
                    type="text"
                    value={paymentDescription}
                    onChange={(event) => setPaymentDescription(event.target.value)}
                    placeholder="Detalle opcional para identificar el pago"
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Fecha</label>
                  <div className="relative mt-1">
                    <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Importe</label>
                  <div className="relative mt-1">
                    <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-right"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500">
                  Importe final: <span className="font-semibold text-gray-900">${formatCurrency(paymentAmount || 0)}</span>
                </div>
                <button
                  type="button"
                  onClick={handleSubmitPayment}
                  disabled={!canSubmitPayment || submittingPayment}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submittingPayment ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {submittingPayment ? 'Guardando...' : 'Guardar Payment Entry'}
                </button>
              </div>
            </>
          )}

          {strategy === 'cash_exchange' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-dashed border-gray-200">
                <div className="sm:col-span-1">
                  <label className="text-xs font-semibold text-gray-600">Cuenta destino</label>
                  <select
                    value={cashTargetAccountId}
                    onChange={(event) => setCashTargetAccountId(event.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  >
                    <option value="">Seleccionar...</option>
                    {availableCashTargets.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.display_name || account.bank_account_name || account.account_name || account.mode_of_payment}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Fecha</label>
                  <input
                    type="date"
                    value={cashDate}
                    onChange={(event) => setCashDate(event.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Importe</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashAmount}
                    onChange={(event) => setCashAmount(event.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-right"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-gray-500">
                  Total a mover: <span className="font-semibold text-gray-900">${formatCurrency(cashAmount || 0)}</span>
                </div>
                <button
                  type="button"
                  onClick={handleSubmitCashExchange}
                  disabled={!canSubmitCashExchange || submittingCashExchange}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-violet-200 text-violet-700 font-semibold hover:bg-violet-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submittingCashExchange ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {submittingCashExchange ? 'Procesando...' : 'Registrar canje'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
