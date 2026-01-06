import React, { useEffect, useState, useContext } from 'react'
import Select from 'react-select'
import { AuthContext } from '../../AuthProvider'
import API_ROUTES from '../../apiRoutes'
import { useNotification } from '../../contexts/NotificationContext'

const ExchangeRateWidget = () => {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useNotification()

  const [currencies, setCurrencies] = useState([])
  const [selectedCurrency, setSelectedCurrency] = useState(null)
  const [rate, setRate] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [loadingBCRA, setLoadingBCRA] = useState(false)
  const [companyCurrency, setCompanyCurrency] = useState('')

  useEffect(() => {
    loadCurrencies()
    loadCompanyCurrency()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedCurrency || currencies.length === 0) return
    const base = (companyCurrency || '').toUpperCase()
    const preferred = base ? currencies.find(o => (o.value || '').toUpperCase() !== base) : null
    setSelectedCurrency(preferred || currencies[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCurrency, currencies])

  useEffect(() => {
    if (selectedCurrency) {
      fetchLatest(selectedCurrency.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCurrency])

  const loadCurrencies = async () => {
    try {
      const resp = await fetchWithAuth('/api/currencies')
      if (!resp.ok) return
      const data = await resp.json()
      if (data && data.success) {
        // Match mapping used elsewhere (CustomerSupplierAccounts): include symbol and friendly label
        const opts = (data.data || []).map((c) => ({ value: c.name || c.code, label: c.currency_name || c.name || c.code }))
        setCurrencies(opts)
        // Preserve current selection by matching value to the new options (react-select expects the option object
        // from the options array). If we already have a selectedCurrency value, remap to the corresponding new option.
        const currentValue = selectedCurrency && (selectedCurrency.value || selectedCurrency)
        if (currentValue) {
          const matched = opts.find(o => o.value === currentValue)
          if (matched) setSelectedCurrency(matched)
          else if (opts.length) setSelectedCurrency(opts[0])
        } else if (opts.length) {
          const base = (companyCurrency || '').toUpperCase()
          const preferred = base ? opts.find(o => (o.value || '').toUpperCase() !== base) : null
          setSelectedCurrency(preferred || opts[0])
        }
      }
    } catch (err) {
      console.error('Error loading currencies:', err)
    }
  }

  const loadCompanyCurrency = async () => {
    try {
      const resp = await fetchWithAuth('/api/active-company')
      const data = await resp.json().catch(() => ({}))
      setCompanyCurrency((data?.data?.company_details?.default_currency || '').toString().trim())
    } catch (err) {
      console.error('Error loading company currency:', err)
      setCompanyCurrency('')
    }
  }

  const fetchLatest = async (currencyValue) => {
    if (!currencyValue) return
    setLoading(true)
    setError(null)
    try {
      if (!companyCurrency) {
        setError('La empresa no tiene moneda por defecto definida')
        setRate('')
        return
      }
      const url = `${API_ROUTES.currencyExchange.latest(currencyValue)}&to=${encodeURIComponent(companyCurrency)}`
      const resp = await fetchWithAuth(url)
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        setError(err.message || `HTTP ${resp.status}`)
        setRate('')
        return
      }
      const data = await resp.json()
      if (data && data.success) {
        const item = data.data || {}
        // Backend returns fields like exchange_rate, date, and from_currency
        setRate(item.exchange_rate != null ? String(item.exchange_rate) : '')
        setDate(item.date || item.effective_date || new Date().toISOString().slice(0, 10))
        
        // CRITICAL: Restore selectedCurrency after data loads to prevent empty select
        // The backend returns from_currency, so we search for the matching option
        if (item.from_currency && currencies.length > 0) {
          const matchedOption = currencies.find(opt => opt.value === item.from_currency)
          if (matchedOption) {
            setSelectedCurrency(matchedOption)
          }
        }
      } else {
        setError((data && data.message) || 'No data')
        setRate('')
      }
    } catch (err) {
      console.error('Error fetching latest exchange rate:', err)
      setError('Error de conexión')
      setRate('')
    } finally {
      setLoading(false)
    }
  }

  const handleFetchBCRARate = async () => {
    if (!selectedCurrency) {
      showNotification('Seleccione una moneda', 'error')
      return
    }
    const currencyCode = selectedCurrency.value
    if (!companyCurrency) {
      showNotification('La empresa no tiene moneda por defecto definida', 'error')
      return
    }

    try {
      setLoadingBCRA(true)
      if ((currencyCode || '').toUpperCase() === (companyCurrency || '').toUpperCase()) {
        setRate('1')
        setDate(new Date().toISOString().slice(0, 10))
        showNotification(`${companyCurrency} tiene cotización 1`, 'info')
        return
      }

      const resp = await fetchWithAuth(`${API_ROUTES.currencyExchange.latest(currencyCode)}&to=${encodeURIComponent(companyCurrency)}`)
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        showNotification(err.message || `Error HTTP ${resp.status}`, 'error')
        return
      }
      const data = await resp.json()
      if (data && data.success && data.data) {
        const item = data.data || {}
        const latestRate = item.exchange_rate != null ? String(item.exchange_rate) : ''
        if (!latestRate) {
          showNotification(`No hay cotización cargada para ${currencyCode}/${companyCurrency}`, 'error')
          return
        }
        setRate(latestRate)
        setDate(item.date || item.effective_date || new Date().toISOString().slice(0, 10))
        showNotification(`Cotización ${currencyCode}/${companyCurrency} actualizada`, 'success')
      } else {
        showNotification((data && data.message) || 'No se obtuvo cotización', 'error')
      }
    } catch (err) {
      console.error('Error fetching latest exchange rate:', err)
      showNotification('Error al obtener la cotización', 'error')
    } finally {
      setLoadingBCRA(false)
    }
  }

  const handleSave = async () => {
    if (!selectedCurrency) return showNotification('Seleccione una moneda', 'error')
    if (!companyCurrency) return showNotification('La empresa no tiene moneda por defecto definida', 'error')
    const parsedRate = Number(rate)
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      return showNotification('Tipo de cambio invalido (debe ser mayor a 0)', 'error')
    }
    setSaving(true)
    try {
      const payload = {
        from_currency: selectedCurrency.value,
        to_currency: companyCurrency,
        exchange_rate: parsedRate,
        date: date,
      }
      const resp = await fetchWithAuth(API_ROUTES.currencyExchange.upsert, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        showNotification(err.message || `Error HTTP ${resp.status}`, 'error')
        return
      }
      const data = await resp.json()
      if (data && data.success) {
        showNotification('Tipo de cambio actualizado', 'success')
        try {
          // Notify other parts of the app that the global exchange rate changed
          window.dispatchEvent(new CustomEvent('globalExchangeRateUpdated', {
            detail: {
              currency: selectedCurrency.value,
              rate: Number(payload.exchange_rate),
              date: payload.date
            }
          }))
        } catch (e) {
          // noop
        }
      } else {
        showNotification((data && data.message) || 'Error actualizando tipo de cambio', 'error')
      }
    } catch (err) {
      console.error('Error saving exchange rate:', err)
      showNotification('Error de conexión', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 bg-white/80 rounded-2xl shadow-lg border border-gray-200/40">
      <div className="exchange-rate-widget exchange-rate-widget--in-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-black">Tipo de cambio general</div>

          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs block mb-1">Moneda</label>
            <Select
              value={selectedCurrency}
              onChange={setSelectedCurrency}
              options={currencies}
              classNamePrefix="react-select"
              styles={{
                control: (provided, state) => ({
                  ...provided,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#111827',
                  boxShadow: state.isFocused ? '0 0 0 2px rgba(99,102,241,0.2)' : 'none',
                }),
                menu: (provided) => ({ ...provided, zIndex: 99999 }),
              }}
              menuPortalTarget={document.body}
            />
          </div>

          <div>
            <label className="text-xs block mb-1">Tipo de cambio</label>
            <div className="flex gap-1">
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="flex-1 px-3 py-2 bg-white/10 text-white border border-white/20 rounded-md focus:outline-none focus:border-indigo-400"
                placeholder="0.00"
              />
              <button
                type="button"
                onClick={handleFetchBCRARate}
                disabled={loadingBCRA || !selectedCurrency}
                className="inline-flex items-center justify-center w-9 h-9 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded-lg transition-colors duration-200 exchange-rate-btn"
                title="Actualizar desde Exchange Rates"
                style={{ minWidth: '36px', minHeight: '36px' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-4 h-4 ${loadingBCRA ? 'icon-refresh spin' : 'icon-refresh'}`}>
                  <path d="M12 15V3"></path>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <path d="m7 10 5 5 5-5"></path>
                </svg>
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs block mb-1">Fecha efectiva</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 bg-white/10 text-white border border-white/20 rounded-md focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              {loading && <div className="text-xs text-white/70">Cargando...</div>}
              {error && <div className="text-xs text-red-300">{error}</div>}
            </div>
            <div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-secondary"
              >
                {saving ? 'Guardando...' : 'Actualizar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ExchangeRateWidget
