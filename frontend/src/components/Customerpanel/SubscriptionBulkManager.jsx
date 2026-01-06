import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Info, Loader2, RefreshCw, Save, ShieldOff, Upload } from 'lucide-react'
import API_ROUTES from '../../apiRoutes'
import useTaxTemplates from '../../hooks/useTaxTemplates'

const generateRowId = () => `sub-row-${Date.now()}-${Math.random().toString(16).slice(2)}`

// Handsontable usa un iframe compartido; este componente solo arma la configuracion y sincroniza los datos.
export default function SubscriptionBulkManager({
  onBack,
  fetchWithAuth,
  showNotification,
  activeCompany,
  confirm
}) {
  const [mode, setMode] = useState('new') // manage = existentes, new = crear (por defecto crear)
  const [entityMode, setEntityMode] = useState('subscriptions') // subscriptions | plans
  const [rows, setRows] = useState([])
  const [planRows, setPlanRows] = useState([])
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [customers, setCustomers] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [plansLibrary, setPlansLibrary] = useState([])
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const companyCurrency = (activeCompanyDetails?.default_currency || '').toString().trim()
  const iframeRef = useRef(null)
  const [iframeReady, setIframeReady] = useState(false)
  const suppressIframeRefreshRef = useRef(false)
  const rowsRef = useRef(rows)
  const planRowsRef = useRef(planRows)
  const selectedRowsRef = useRef(selectedRows)
  const entityModeRef = useRef(entityMode)
  const loadingRef = useRef(false)
  const currentLoadRef = useRef({entityMode, mode})
  const plansLoadedForSubscriptionsRef = useRef(false)
  const activeColumnsLengthRef = useRef(0)

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  useEffect(() => {
    planRowsRef.current = planRows
  }, [planRows])

  useEffect(() => {
    selectedRowsRef.current = selectedRows
  }, [selectedRows])

  useEffect(() => {
    entityModeRef.current = entityMode
  }, [entityMode])

  const persistPlansLibrary = useCallback((list) => {
    try {
      window.localStorage.setItem('subscriptionPlansLibrary', JSON.stringify(list || []))
    } catch (e) {
      console.debug('Could not persist plans library', e)
    }
  }, [])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('subscriptionPlansLibrary')
      if (stored) {
        const list = JSON.parse(stored)
        if (Array.isArray(list)) {
          setPlansLibrary(list)
        }
      }
    } catch (e) {
      console.debug('Could not load plans library', e)
    }
  }, [])

  useEffect(() => {
    const loadCustomers = async () => {
      try {
        const params = new URLSearchParams()
        params.set('page', '1')
        params.set('limit', '500')
        params.set('search', '')
        const response = await fetchWithAuth(`${API_ROUTES.customers}/names?${params.toString()}`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) throw new Error(payload.message || 'No se pudieron cargar clientes')
        const list = Array.isArray(payload.data) ? payload.data : []
        const names = list
          .map(c => c.name || c.customer_name || c.customer)
          .filter(Boolean)
          .map(String)
        const unique = Array.from(new Set(names))
        setCustomers(unique)
      } catch (e) {
        console.error('[SubscriptionBulkManager] Error loading customers', e)
        setCustomers([])
      }
    }
    loadCustomers()
  }, [activeCompany, fetchWithAuth])

  useEffect(() => {
    const loadCompanyDetails = async () => {
      if (!activeCompany) {
        setActiveCompanyDetails(null)
        return
      }
      try {
        const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompany)}`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || 'No se pudieron cargar los datos de la empresa')
        }
        setActiveCompanyDetails(payload.data || null)
      } catch (e) {
        console.error('[SubscriptionBulkManager] Error loading company details', e)
        setActiveCompanyDetails(null)
      }
    }
    loadCompanyDetails()
  }, [activeCompany, fetchWithAuth])

  useEffect(() => {
    const loadCurrencies = async () => {
      try {
        const response = await fetchWithAuth(`${API_ROUTES.currencies}`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) throw new Error(payload.message || 'No se pudieron cargar monedas')
        const list = Array.isArray(payload.data) ? payload.data : []
        setCurrencies(list)
      } catch (e) {
        console.error('[SubscriptionBulkManager] Error loading currencies', e)
        setCurrencies([])
      }
    }
    loadCurrencies()
  }, [fetchWithAuth])

  // Do not auto-load templates on mount. We'll load them only when the user chooses "Cargar Todos".
  const { templates: taxTemplates, refresh: refreshTaxTemplates, loading: taxTemplatesLoading, rateToTemplateMap } = useTaxTemplates(fetchWithAuth, { auto: false })

  const planOptions = useMemo(() => {
    const source = plansLibrary.length ? plansLibrary : planRows
    return source
      .map(p => p.plan_name || p.name || p.plan)
      .filter(Boolean)
      .map(String)
      .filter((val, idx, arr) => arr.indexOf(val) === idx)
      .map(v => ({ value: v, label: v }))
  }, [planRows, plansLibrary])

  const customerOptions = useMemo(
    () => customers.map(c => ({ value: c, label: c })),
    [customers]
  )

  const currencyOptions = useMemo(
    () => currencies.map(c => ({ value: c.name, label: c.currency_name || c.name })),
    [currencies]
  )

  const taxTemplateOptions = useMemo(() => {
    if (!Array.isArray(taxTemplates)) return []

    const normalizeRate = (rate) => {
      const parsed = Number.parseFloat(String(rate).replace(',', '.'))
      return Number.isFinite(parsed) ? Number(parsed.toFixed(4)) : null
    }

    const formatRate = (rate) => {
      if (rate == null) return ''
      return Number.isInteger(rate) ? `${rate}%` : `${rate.toFixed(2)}%`
    }

    // Extraer todas las tasas únicas de todos los templates
    const uniqueRates = new Set()
    taxTemplates.forEach(template => {
      if (!template || !Array.isArray(template.iva_rates)) return
      template.iva_rates.forEach(rate => {
        const normalized = normalizeRate(rate)
        if (normalized !== null) {
          uniqueRates.add(normalized)
        }
      })
    })

    // Convertir a array ordenado y formatear como opciones
    // El value es la tasa numérica (ej: "21"), el label muestra "21%"
    return Array.from(uniqueRates)
      .sort((a, b) => a - b)
      .map(rate => ({
        value: String(rate),
        label: formatRate(rate)
      }))
  }, [taxTemplates])

  const subscriptionColumns = useMemo(() => ([
    { key: 'selected', label: 'Sel.', type: 'checkbox', width: 50, readonly: false },
    { key: 'subscription_name', label: 'ID', type: 'text', width: 140, readonly: true, hidden: true },
    { key: 'customer', label: 'Cliente', type: 'select', width: 180, options: customerOptions },
    { key: 'plan', label: 'Plan', type: 'select', width: 160, options: planOptions },
    { key: 'currency', label: 'Moneda', type: 'select', width: 100, options: currencyOptions, readonly: true },
    { key: 'start_date', label: 'Desde', type: 'date', width: 110 },
    { key: 'end_date', label: 'Hasta', type: 'date', width: 110 },
    { key: 'generate_invoice_at', label: 'Facturar', type: 'select', width: 100, options: [{ value: 'start', label: 'Inicio' }, { value: 'end', label: 'Fin' }] },
    { key: 'amount', label: 'Monto', type: 'numeric', width: 110, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0.00' }, readonly: true },
    { key: 'interval_days', label: 'Cada (dias)', type: 'numeric', width: 110, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0' }, readonly: true },
    { key: 'trial_days', label: 'Trial (dias)', type: 'numeric', width: 110, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0' } },
    { key: 'discount_percent', label: 'Desc. %', type: 'numeric', width: 110, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0.00' } }
  ]), [customerOptions, planOptions, currencyOptions])

  const planColumns = useMemo(() => ([
    { key: 'selected', label: 'Sel.', type: 'checkbox', width: 50, readonly: false },
    { key: 'plan_name', label: 'Plan', type: 'text', width: 180 },
    { key: 'amount', label: 'Monto', type: 'numeric', width: 120, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0.00' } },
    { key: 'currency', label: 'Moneda', type: 'select', width: 100, options: currencyOptions },
    { key: 'interval_days', label: 'Cada (dias)', type: 'numeric', width: 120, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0' } },
    { key: 'trial_days', label: 'Trial (dias)', type: 'numeric', width: 120, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0' } },
    { key: 'discount_percent', label: 'Desc. %', type: 'numeric', width: 120, className: 'htRight htNumeric text-right', numericFormat: { pattern: '0.00' } },
    { key: 'tax_template', label: 'IVA %', type: 'select', width: 150, options: taxTemplateOptions }
  ]), [currencyOptions, taxTemplateOptions])

  const activeColumns = entityMode === 'plans' ? planColumns : subscriptionColumns

  const hiddenColumnIndexes = useMemo(() => (
    activeColumns.reduce((acc, col, idx) => {
      if (col.hidden) acc.push(idx)
      return acc
    }, [])
  ), [activeColumns])

  const isRowValid = useCallback((row) => {
    if (entityMode === 'plans') {
      if (!row) return false
      const hasName = row.plan_name && String(row.plan_name).trim() !== ''
      const hasAmount = row.amount !== '' && row.amount !== null && Number.isFinite(Number(row.amount))
      const hasInterval = row.interval_days !== '' && row.interval_days !== null && Number.isFinite(Number(row.interval_days))
      const hasCurrency = row.currency && String(row.currency).trim() !== ''
      return hasName && hasAmount && hasInterval && hasCurrency
    }
    if (!row) return false
    const hasCustomer = row.customer && String(row.customer).trim() !== ''
    const hasPlan = row.plan && String(row.plan).trim() !== ''
    const hasStartDate = row.start_date && String(row.start_date).trim() !== ''
    const hasCurrency = row.currency && String(row.currency).trim() !== ''
    return hasCustomer && hasPlan && hasStartDate && hasCurrency
  }, [entityMode])

  const validRowsCount = useMemo(() => {
    const source = entityMode === 'plans' ? planRows : rows
    return source.filter(isRowValid).length
  }, [entityMode, isRowValid, planRows, rows])

  const normalizeRow = useCallback((row, idx = 0) => {
    if (!row) return { id: generateRowId(), selected: false }
    const id = row.id || row.name || generateRowId()
    const resolvedCurrency = (row.currency || '').toString().trim() || companyCurrency
    return {
      id,
      subscription_name: row.subscription_name || row.name || '',
      customer: row.customer || row.party || '',
      plan: row.plan || row.plan_name || '',
      currency: resolvedCurrency || '',
      start_date: row.start_date || '',
      end_date: row.end_date || '',
      generate_invoice_at: row.generate_invoice_at || 'end',
      amount: row.amount ?? row.grand_total ?? '',
      interval_days: row.interval_days ?? row.every_n_days ?? row.billing_interval_count ?? '',
      trial_days: row.trial_days ?? row.trial_period_days ?? '',
      discount_percent: row.discount_percent ?? row.additional_discount_percentage ?? '',
      selected: selectedRowsRef.current.has(id)
    }
  }, [companyCurrency])

  const normalizePlanRow = useCallback((row) => {
    if (!row) return { id: generateRowId(), selected: false }
    const id = row.id || generateRowId()
    const resolvedCurrency = (row.currency || '').toString().trim() || companyCurrency
    return {
      id,
      name: row.name || '',
      plan_name: row.plan_name || row.name || '',
      amount: row.amount ?? '',
      currency: resolvedCurrency || '',
      interval_days: row.interval_days ?? '',
      trial_days: row.trial_days ?? '',
      discount_percent: row.discount_percent ?? '',
      tax_template: row.tax_template || '',
      selected: selectedRowsRef.current.has(id)
    }
  }, [companyCurrency])

  const hasPlanDraftData = useCallback((row) => {
    if (!row) return false
    const fields = ['plan_name', 'amount', 'interval_days', 'trial_days', 'discount_percent', 'tax_template', 'align_day_of_month', 'description']
    return fields.some((key) => {
      const value = row[key]
      return value !== undefined && value !== null && String(value).trim() !== ''
    })
  }, [])

  const sendTableConfiguration = useCallback(() => {
    if (!iframeReady || !iframeRef.current || !iframeRef.current.contentWindow) return

    if (activeColumns.length !== activeColumnsLengthRef.current) {
      iframeRef.current.contentWindow.postMessage({ type: 'ht-clear-table' }, '*')
      activeColumnsLengthRef.current = activeColumns.length
    }

    const sourceRows = entityMode === 'plans'
      ? (planRows.length > 0 ? planRows : [normalizePlanRow({})])
      : (rows.length > 0 ? rows : [normalizeRow({})])

    const preparedData = sourceRows.map(row =>
      activeColumns.map(col => {
        if (col.key === 'selected') {
          return selectedRowsRef.current.has(row.id)
        }
        if (col.type === 'numeric') {
          const value = row[col.key]
          if (value === undefined || value === null || value === '') return ''
          const n = Number(value)
          return Number.isFinite(n) ? n : ''
        }
        return row[col.key] ?? ''
      })
    )
    const rowIds = sourceRows.map(r => r.id || generateRowId())

    iframeRef.current.contentWindow.postMessage({
      type: 'ht-configure-table',
      columns: activeColumns,
      data: preparedData,
      rowIds,
      selectAll: false,
      hiddenColumns: hiddenColumnIndexes
    }, '*')
  }, [activeColumns, entityMode, hiddenColumnIndexes, iframeReady, normalizePlanRow, normalizeRow, planRows, rows])

  useEffect(() => {
    if (!iframeReady || !iframeRef.current?.contentWindow) return
    try {
      // Reenviar configuracion para evitar columnas desfasadas al cambiar de modo
      setTimeout(() => sendTableConfiguration(), 0)
    } catch (e) {
      console.debug('Error clearing table on mode switch', e)
    }
    // Solo debe disparar cuando cambia el modo o el iframe está listo, no en cada cambio de data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityMode, iframeReady])

  useEffect(() => {
    if (!iframeReady) return
    if (suppressIframeRefreshRef.current) {
      suppressIframeRefreshRef.current = false
      return
    }
    sendTableConfiguration()
    // Reenviar cuando cambien datos/selección; incluye planRows para refrescar modo planes
  }, [iframeReady, rows, planRows, selectedRows, sendTableConfiguration])

  const handleIframeLoad = useCallback(() => {
    setIframeReady(true)
  }, [])

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return
      const msg = event.data || {}
      const currentMode = entityModeRef.current

      switch (msg.type) {
        case 'ht-data-changed': {
          (async () => {
            const dataRows = Array.isArray(msg.data) ? msg.data : []
            if (dataRows.length === 0) return
            const currentList = entityModeRef.current === 'plans' ? planRowsRef.current : rowsRef.current
            const updatedList = currentList.slice()
            const nextSelection = new Set(selectedRowsRef.current)

            for (let index = 0; index < dataRows.length; index++) {
              const row = dataRows[index]
              const current = updatedList[index] || normalizeRow({ id: generateRowId() })
              const updated = { ...current }

              const cols = entityModeRef.current === 'plans' ? planColumns : subscriptionColumns
              cols.forEach((col, colIndex) => {
                const value = row[colIndex]
                if (col.key === 'selected') {
                  if (value) nextSelection.add(updated.id)
                  else nextSelection.delete(updated.id)
                } else {
                  if (value !== '') {
                    updated[col.key] = value
                  }
                }
                if (entityModeRef.current === 'subscriptions' && col.key === 'plan' && value !== '' && value !== current.plan) {
                  console.log('[SubscriptionBulkManager] Plan selected:', value)
                  // Fetch plan details
                  ;(async () => {
                    try {
                      console.log('[SubscriptionBulkManager] Fetching plan details from backend for:', value)
                      const response = await fetchWithAuth(`${API_ROUTES.subscriptionPlans}/${encodeURIComponent(value)}`)
                      const payload = await response.json().catch(() => ({}))
                      console.log('[SubscriptionBulkManager] Response received:', response.ok, payload)
                      if (response.ok && payload.success && payload.data) {
                        const plan = payload.data
                        console.log('[SubscriptionBulkManager] Plan data received:', plan)
                        updated.currency = plan.currency || updated.currency
                        updated.amount = plan.amount || plan.cost || updated.amount
                        updated.interval_days = plan.interval_days || plan.billing_interval_count || updated.interval_days
                        updated.trial_days = plan.trial_days || updated.trial_days
                        updated.discount_percent = plan.discount_percent || updated.discount_percent
                        updated.tax_template = plan.tax_template || updated.tax_template
                        console.log('[SubscriptionBulkManager] Updated row with plan data:', updated)
                        // Update the list
                        const newList = [...updatedList]
                        newList[index] = { ...updated }
                        suppressIframeRefreshRef.current = true
                        if (entityModeRef.current === 'plans') {
                          setPlanRows(newList)
                        } else {
                          setRows(newList)
                        }
                      }
                    } catch (e) {
                      console.error('[SubscriptionBulkManager] Error fetching plan details', e)
                    }
                  })()
                }
              })

              updatedList[index] = updated
            }

            if (entityModeRef.current === 'plans') {
              setPlanRows(updatedList.length ? updatedList : [normalizePlanRow({ id: generateRowId() })])
            } else {
              setRows(updatedList)
            }
            setSelectedRows(nextSelection)
          })()
          break
        }
        case 'ht-cell-changed': {
          const { rowIndex, colKey, value } = msg
          if (typeof rowIndex === 'number' && colKey) {
            const targetRow = (currentMode === 'plans' ? planRowsRef.current : rowsRef.current)[rowIndex]
            if (!targetRow) break
            suppressIframeRefreshRef.current = true
            if (currentMode === 'plans') {
              setPlanRows(prev => {
                const updated = prev.map((row, idx) => {
                  if (idx !== rowIndex) return row
                  const next = { ...row }
                  if (colKey === 'selected') {
                    const selection = new Set(selectedRowsRef.current)
                    if (value) selection.add(row.id)
                    else selection.delete(row.id)
                    setSelectedRows(selection)
                  } else {
                    next[colKey] = value ?? ''
                  }
                  return next
                })
                return updated.length ? updated : [normalizePlanRow({ id: generateRowId() })]
              })
            } else {
              setRows(prev => prev.map((row, idx) => {
                if (idx !== rowIndex) return row
                const next = { ...row }
                if (colKey === 'selected') {
                  const selection = new Set(selectedRowsRef.current)
                  if (value) selection.add(row.id)
                  else selection.delete(row.id)
                  setSelectedRows(selection)
                } else {
                  next[colKey] = value ?? ''
                  if (colKey === 'plan' && value) {
                    console.log('[SubscriptionBulkManager] Plan selected in cell change:', value)
                    // Fetch plan details from backend
                    (async () => {
                      try {
                        console.log('[SubscriptionBulkManager] Fetching plan details from backend for:', value)
                        const response = await fetchWithAuth(`${API_ROUTES.subscriptionPlans}/${encodeURIComponent(value)}`)
                        const payload = await response.json().catch(() => ({}))
                        console.log('[SubscriptionBulkManager] Response received:', response.ok, payload)
                        if (response.ok && payload.success && payload.data) {
                          const plan = payload.data
                          console.log('[SubscriptionBulkManager] Plan data received:', plan)
                          suppressIframeRefreshRef.current = true
                          setRows(prev => prev.map((row, idx) => {
                            if (idx !== rowIndex) return row
                            const updatedRow = {
                              ...row,
                              currency: plan.currency || row.currency,
                              amount: plan.amount || plan.cost || row.amount,
                              interval_days: plan.interval_days || plan.billing_interval_count || row.interval_days,
                              trial_days: plan.trial_days || row.trial_days,
                              discount_percent: plan.discount_percent || row.discount_percent,
                              tax_template: plan.tax_template || row.tax_template
                            }
                            console.log('[SubscriptionBulkManager] Updated row with plan data:', updatedRow)
                            return updatedRow
                          }))
                        }
                      } catch (e) {
                        console.error('[SubscriptionBulkManager] Error fetching plan details', e)
                      }
                    })()
                  }
                }
                return next
              }))
            }
          }
          break
        }
        case 'ht-toggle-select-all': {
          const currentList = currentMode === 'plans' ? planRowsRef.current : rowsRef.current
          const selectAll = !selectedRowsRef.current.size || selectedRowsRef.current.size !== currentList.length
          const next = new Set()
          if (selectAll) {
            currentList.forEach(r => next.add(r.id))
          }
          setSelectedRows(next)
          break
        }
        case 'ht-rows-removed': {
          const removedIds = Array.isArray(msg.removedIds) ? msg.removedIds : []
          if (removedIds.length === 0) break
          if (currentMode === 'plans') {
            // No eliminar filas de planes automaticamente; preserva borradores y deja al menos una fila
            setPlanRows(prev => (prev.length ? prev : [normalizePlanRow({ id: generateRowId() })]))
            suppressIframeRefreshRef.current = true
            sendTableConfiguration()
          } else {
            setRows(prev => prev.filter(r => !removedIds.includes(r.id)))
            setSelectedRows(prev => {
              const next = new Set(prev)
              removedIds.forEach(id => next.delete(id))
              return next
            })
          }
          break
        }
        default:
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [planColumns, plansLibrary, subscriptionColumns])

  const loadExisting = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      if (entityMode !== 'subscriptions') return
      setIsLoading(true)
      const params = new URLSearchParams()
      if (activeCompany) params.set('company', activeCompany)
      const response = await fetchWithAuth(`${API_ROUTES.subscriptions}?${params.toString()}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'No se pudieron cargar las suscripciones')
      }
      const list = Array.isArray(payload.data) ? payload.data : []
      const normalized = list.map((row, idx) => normalizeRow(row, idx))
      setRows(normalized)
      setSelectedRows(new Set())
      showNotification && showNotification(`Suscripciones cargadas (${normalized.length})`, 'success')
    } catch (error) {
      console.error('[SubscriptionBulkManager] Error loading subscriptions', error)
      showNotification && showNotification(error.message || 'Error al cargar suscripciones', 'error')
    } finally {
      setIsLoading(false)
      loadingRef.current = false
    }
  }, [activeCompany, entityMode, fetchWithAuth, normalizeRow, showNotification])

  const loadExistingPlans = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      setIsLoading(true)
      const params = new URLSearchParams()
      if (activeCompany) params.set('company', activeCompany)
      const response = await fetchWithAuth(`${API_ROUTES.subscriptionPlans}?${params.toString()}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || 'No se pudieron cargar los planes')
      }
      const list = Array.isArray(payload.data) ? payload.data : []
      const normalized = list.map(normalizePlanRow)
      setPlansLibrary(normalized)
      persistPlansLibrary(normalized)
      if (entityMode === 'plans') {
        setPlanRows(normalized.length ? normalized : [normalizePlanRow({})])
        setSelectedRows(new Set())
      }
      if (normalized.length && showNotification) {
        showNotification(`Planes cargados (${normalized.length})`, 'success')
      }
    } catch (error) {
      console.error('[SubscriptionBulkManager] Error loading plans', error)
      setPlansLibrary([])
      if (entityMode === 'plans') {
        setPlanRows([normalizePlanRow({})])
        setSelectedRows(new Set())
      }
      showNotification && showNotification(error.message || 'Error al cargar planes', 'error')
    } finally {
      setIsLoading(false)
      loadingRef.current = false
    }
  }, [activeCompany, entityMode, fetchWithAuth, normalizePlanRow, showNotification])

  useEffect(() => {
    if (currentLoadRef.current.entityMode !== entityMode || currentLoadRef.current.mode !== mode) {
      currentLoadRef.current = {entityMode, mode}
      if (entityMode === 'subscriptions') {
        if (mode === 'manage') {
          loadExisting()
        } else {
          setRows([normalizeRow({})])
          setSelectedRows(new Set())
        }
      } else {
        if (mode === 'manage') {
          loadExistingPlans()
        } else {
          setPlanRows([normalizePlanRow({})])
          setSelectedRows(new Set())
        }
      }
    }
  }, [entityMode, mode, loadExisting, loadExistingPlans, normalizePlanRow, normalizeRow])

  // Load plans when in subscription mode so planOptions are available
  useEffect(() => {
    if (entityMode === 'subscriptions' && !plansLoadedForSubscriptionsRef.current && !loadingRef.current) {
      plansLoadedForSubscriptionsRef.current = true
      loadExistingPlans()
    }
  }, [entityMode, loadExistingPlans])

  // Reset plans loaded flag when switching away from subscriptions
  useEffect(() => {
    if (entityMode !== 'subscriptions') {
      plansLoadedForSubscriptionsRef.current = false
    }
  }, [entityMode])

  // Load tax templates when in plans mode
  useEffect(() => {
    if (entityMode === 'plans') {
      refreshTaxTemplates()
    }
  }, [entityMode, refreshTaxTemplates])

  const saveAll = async () => {
    const rowsToSave = (entityMode === 'plans' ? planRows : rows).filter(isRowValid)
    if (!rowsToSave.length) {
      showNotification && showNotification('No hay filas validas para guardar', 'warning')
      return
    }
    if (entityMode === 'plans') {
      try {
        setIsSaving(true)
        const response = await fetchWithAuth(API_ROUTES.subscriptionPlansBulk, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plans: rowsToSave })
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || 'No se pudieron guardar los planes')
        }
        const normalized = Array.isArray(payload.data) ? payload.data.map(normalizePlanRow) : rowsToSave.map(normalizePlanRow)
        setPlanRows(normalized.length ? normalized : [normalizePlanRow({})])
        setPlansLibrary(normalized)
        persistPlansLibrary(normalized)
        showNotification && showNotification(payload.message || `Planes guardados (${normalized.length})`, 'success')
      } catch (error) {
        console.error('[SubscriptionBulkManager] Error saving plans', error)
        showNotification && showNotification(error.message || 'Error al guardar planes', 'error')
      } finally {
        setIsSaving(false)
      }
      return
    }
    try {
      setIsSaving(true)
      const payload = rowsToSave.map(row => ({
        name: row.subscription_name || undefined,
        customer: row.customer,
        plan: row.plan,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        generate_invoice_at: row.generate_invoice_at || 'end',
        amount: row.amount === '' || row.amount === null ? null : Number(row.amount),
        interval_days: row.interval_days === '' || row.interval_days === null ? null : Number(row.interval_days),
        trial_days: row.trial_days === '' || row.trial_days === null ? null : Number(row.trial_days),
        discount_percent: row.discount_percent === '' || row.discount_percent === null ? null : Number(row.discount_percent),
        align_day_of_month: row.align_day_of_month === '' || row.align_day_of_month === null ? null : Number(row.align_day_of_month),
        status: row.status
      }))

      const response = await fetchWithAuth(API_ROUTES.subscriptionsBulk, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptions: payload, mode })
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'No se pudieron guardar las suscripciones')
      }
      showNotification && showNotification(result.message || 'Suscripciones guardadas', 'success')
      if (mode === 'manage') {
        loadExisting()
      } else {
        setRows(result.data ? result.data.map(normalizeRow) : rows)
      }
    } catch (error) {
      console.error('[SubscriptionBulkManager] Error saving subscriptions', error)
      showNotification && showNotification(error.message || 'Error al guardar suscripciones', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const cancelSelected = async () => {
    if (entityMode !== 'subscriptions') return
    const selectedList = rows.filter(r => selectedRows.has(r.id) && (r.subscription_name || r.name))
    if (!selectedList.length) {
      showNotification && showNotification('Selecciona al menos una suscripcion existente para cancelar', 'warning')
      return
    }
    const ok = await confirm?.({
      title: 'Cancelar suscripciones',
      message: `Vas a cancelar ${selectedList.length} suscripcion(es). Continuar?`,
      type: 'danger',
      confirmText: 'Cancelar suscripcion'
    })
    if (!ok) return

    try {
      setIsSaving(true)
      const response = await fetchWithAuth(API_ROUTES.subscriptionsBulkCancel, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptions: selectedList.map(r => r.subscription_name || r.name) })
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'No se pudieron cancelar las suscripciones seleccionadas')
      }
      showNotification && showNotification(result.message || 'Suscripciones canceladas', 'success')
      loadExisting()
    } catch (error) {
      console.error('[SubscriptionBulkManager] Error cancelling subscriptions', error)
      showNotification && showNotification(error.message || 'Error al cancelar suscripciones', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const addEmptyRow = () => {
    if (entityMode === 'plans') {
      setPlanRows(prev => [...prev, normalizePlanRow({ id: generateRowId() })])
    } else {
      setRows(prev => [...prev, normalizeRow({ id: generateRowId() })])
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 rounded-3xl border border-gray-200 shadow-lg overflow-hidden">
      <div className="accounting-card-title bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100"
            title="Volver al panel de clientes"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Suscripciones</p>
            <h2 className="text-xl font-black text-gray-900">Gestion masiva</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-2 bg-gray-100 p-1 rounded-lg h-9">
            <button
              type="button"
              onClick={() => setEntityMode('subscriptions')}
              className={`btn-mode-selector ${entityMode === 'subscriptions' ? 'active' : ''}`}
            >
              Suscripciones
            </button>
            <button
              type="button"
              onClick={() => setEntityMode('plans')}
              className={`btn-mode-selector ${entityMode === 'plans' ? 'active' : ''}`}
            >
              Planes
            </button>
          </div>
          {entityMode === 'subscriptions' && (
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg h-9">
              <button
                type="button"
                onClick={() => setMode('manage')}
                className={`btn-mode-selector ${mode === 'manage' ? 'active' : ''}`}
              >
                Gestionar existentes
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`btn-mode-selector ${mode === 'new' ? 'active' : ''}`}
              >
                Crear nuevas
              </button>
            </div>
          )}
          {entityMode === 'plans' && (
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg h-9">
              <button
                type="button"
                onClick={() => setMode('manage')}
                className={`btn-mode-selector ${mode === 'manage' ? 'active' : ''}`}
              >
                Gestionar existentes
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`btn-mode-selector ${mode === 'new' ? 'active' : ''}`}
              >
                Crear nuevas
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-4 bg-white border-b border-gray-100 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={entityMode === 'subscriptions'
            ? (mode === 'manage' ? loadExisting : addEmptyRow)
            : (mode === 'manage' ? loadExistingPlans : addEmptyRow)}
          className="btn-action-primary inline-flex items-center justify-center gap-2 h-10 px-3"
          disabled={isLoading || isSaving}
          title={entityMode === 'subscriptions'
            ? (mode === 'manage' ? 'Recargar suscripciones' : 'Agregar fila')
            : 'Agregar fila de plan'}
        >
          {((entityMode === 'subscriptions' && mode === 'manage') || (entityMode === 'plans' && mode === 'manage'))
            ? <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            : <Upload className="w-4 h-4" />}
          {((entityMode === 'subscriptions' && mode === 'manage') || (entityMode === 'plans' && mode === 'manage')) ? null : 'Agregar fila'}
        </button>
        <button
          type="button"
          onClick={saveAll}
          className="btn-action-success inline-flex items-center gap-2 h-10 px-4 shadow-sm"
          disabled={isSaving || isLoading || validRowsCount === 0}
          title={validRowsCount ? `Guardar ${validRowsCount} ${entityMode === 'plans' ? 'planes' : 'suscripciones'} validas` : 'No hay filas validas'}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isSaving ? 'Guardando...' : `Guardar (${validRowsCount})`}
        </button>
        {entityMode === 'subscriptions' && mode === 'manage' && (
          <button
            type="button"
            onClick={cancelSelected}
            className="btn-action-danger inline-flex items-center gap-2 h-10 px-4 shadow-sm disabled:opacity-60"
            disabled={isSaving || isLoading || selectedRows.size === 0}
          >
            <ShieldOff className="w-4 h-4" />
            Cancelar seleccionadas ({selectedRows.size})
          </button>
        )}
        <div className="ml-auto">
          <button
            type="button"
            className="text-gray-600 hover:text-gray-800"
            title={
              entityMode === 'plans'
                ? 'Defini y guarda plantillas de planes; luego usalas en la tabla de suscripciones.'
                : (mode === 'manage'
                  ? 'Edita, recalcula montos o cancela suscripciones activas.'
                  : 'Pega clientes y defini los parametros de facturacion recurrente.')
            }
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1">
        <iframe
          ref={iframeRef}
          src="/handsontable-demo.html"
          className="w-full h-full border-0"
          title="Tabla de suscripciones"
          onLoad={handleIframeLoad}
          style={{ minHeight: '720px' }}
        />
      </div>
    </div>
  )
}
