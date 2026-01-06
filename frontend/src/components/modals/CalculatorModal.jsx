import React, { useState, useContext } from 'react'
import Modal from '../Modal'
import { Calculator, Check, AlertCircle, X, Info, TrendingUp, RefreshCw } from 'lucide-react'
import API_ROUTES from '../../apiRoutes'
import { AuthContext } from '../../AuthProvider'

const CalculatorModal = ({
  isOpen,
  onClose,
  onApplyFormula,
  currentItemsCount,
  mode = 'sales',
  contextType = 'manualPriceList',
  initialFormula = '',
  isApplying = false,
  onApplyInflation, // optional callback to apply inflation results to parent
  getInflationItems // optional function to provide items payload for inflation calc
}) => {
  const [formula, setFormula] = useState(initialFormula || '')
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [formulaHistory, setFormulaHistory] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState('formula')
  const [inflationFrom, setInflationFrom] = useState('')
  const [inflationTo, setInflationTo] = useState('')
  const [inflationResult, setInflationResult] = useState(null)
  const [inflationError, setInflationError] = useState('')
  const [inflationLoading, setInflationLoading] = useState(false)
  const [inflationOptions, setInflationOptions] = useState([])
  const [basePriceSource, setBasePriceSource] = useState('actual') // 'actual' or 'compra'
  const { fetchWithAuth, activeCompany } = useContext(AuthContext) || {}
  const formulaHistoryEndpoint = (API_ROUTES?.calculator?.formulaHistory) || '/api/calculator/formula-history'

  // When modal opens with an initial formula (from price list), set it
  React.useEffect(() => {
    if (isOpen) {
      setFormula(initialFormula || '')
      setError('')
      setPreview('')
      setActiveTab('formula')
      setInflationFrom('')
      setInflationTo('')
      setInflationResult(null)
      setInflationError('')
      setBasePriceSource('actual')
      if (initialFormula && initialFormula.trim()) {
        handleFormulaChange(initialFormula)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialFormula])

  const loadFormulaHistory = React.useCallback(async () => {
    if (!fetchWithAuth) return
    try {
      const params = new URLSearchParams()
      if (activeCompany) params.set('company', activeCompany)
      const query = params.toString()
      const response = await fetchWithAuth(query ? `${formulaHistoryEndpoint}?${query}` : formulaHistoryEndpoint)
      if (!response || !response.ok) {
        return
      }
      let payload = null
      if (typeof response.json === 'function') {
        payload = await response.json().catch(() => null)
      }
      if (payload && Array.isArray(payload.data)) {
        setFormulaHistory(payload.data.slice(0, 5))
      } else {
        setFormulaHistory([])
      }
    } catch (err) {
      console.warn('No se pudo cargar el historial de fórmulas', err)
    }
  }, [fetchWithAuth, activeCompany, formulaHistoryEndpoint])

  React.useEffect(() => {
    if (isOpen) {
      loadFormulaHistory()
    }
  }, [isOpen, loadFormulaHistory])

  const persistFormulaHistory = React.useCallback(async (newFormula) => {
    if (!fetchWithAuth || !newFormula || !newFormula.trim()) return
    try {
      const params = new URLSearchParams()
      if (activeCompany) params.set('company', activeCompany)
      const response = await fetchWithAuth(
        params.toString() ? `${formulaHistoryEndpoint}?${params.toString()}` : formulaHistoryEndpoint,
        {
          method: 'POST',
          body: JSON.stringify({ formula: newFormula.trim() })
        }
      )
      if (!response || !response.ok) {
        let detail = ''
        try {
          detail = await response.text()
        } catch (err) {
          detail = ''
        }
        console.warn('No se pudo guardar el historial de fórmulas', detail)
        return
      }
      let payload = null
      if (typeof response.json === 'function') {
        payload = await response.json().catch(() => null)
      }
      if (payload && Array.isArray(payload.data)) {
        setFormulaHistory(payload.data.slice(0, 5))
      }
    } catch (err) {
      console.warn('No se pudo guardar el historial de fórmulas', err)
    }
  }, [fetchWithAuth, activeCompany, formulaHistoryEndpoint])

  const updateFormulaHistory = React.useCallback((newFormula) => {
    if (!newFormula || !newFormula.trim()) return
    const trimmed = newFormula.trim()
    setFormulaHistory(prev => [trimmed, ...prev.filter(item => item !== trimmed)].slice(0, 5))
    persistFormulaHistory(trimmed)
  }, [persistFormulaHistory])

  const resetInflationState = () => {
    setInflationResult(null)
    setInflationError('')
  }

  const normalizeNumber = (value) => {
    if (value === null || value === undefined || value === '') return null
    const text = typeof value === 'string' ? value.replace(',', '.').trim() : value
    const n = parseFloat(text)
    return Number.isFinite(n) ? n : null
  }

  const parsePeriod = (str) => {
    if (!str || typeof str !== 'string') return null
    const txt = str.trim().toLowerCase()
    if (txt.length === 7 && txt[4] === '-' && /^\d{4}-\d{2}$/.test(txt)) {
      return { year: parseInt(txt.slice(0, 4), 10), month: parseInt(txt.slice(5), 10) }
    }
    const parts = txt.split('-')
    if (parts.length === 2) {
      const monthMap = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 }
      const m = monthMap[parts[0]]
      const yy = parseInt(parts[1], 10)
      if (m && Number.isFinite(yy)) {
        const year = yy < 50 ? 2000 + yy : 1900 + yy
        return { year, month: m }
      }
    }
    return null
  }

  const formatPeriod = ({ year, month }) => {
    const inv = { 1: 'ene', 2: 'feb', 3: 'mar', 4: 'abr', 5: 'may', 6: 'jun', 7: 'jul', 8: 'ago', 9: 'sept', 10: 'oct', 11: 'nov', 12: 'dic' }
    const mm = inv[month] || String(month).padStart(2, '0')
    const yy = String(year % 100).padStart(2, '0')
    return `${mm}-${yy}`
  }

  const addMonths = (base, delta) => {
    const total = base.year * 12 + (base.month - 1) + delta
    return { year: Math.floor(total / 12), month: (total % 12) + 1 }
  }

  const loadInflationPeriods = React.useCallback(async () => {
    if (!fetchWithAuth) return
    try {
      const response = await fetchWithAuth(API_ROUTES.inflationIndices.list)
      const payload = await response.json().catch(() => ({}))
      const data = Array.isArray(payload.data) ? payload.data : []
      const periods = data.map((row) => row.periodo).filter(Boolean)
      const parsed = periods.map(parsePeriod).filter(Boolean)
      if (parsed.length === 0) {
        setInflationOptions([])
        return
      }
      const sorted = parsed.sort((a, b) => (a.year - b.year) || (a.month - b.month))
      const last = sorted[sorted.length - 1]
      const extra1 = addMonths(last, 1)
      const extra2 = addMonths(last, 2)
      const fullList = [...sorted, extra1, extra2]
      const uniqueMap = new Map()
      fullList.forEach((p) => {
        const key = `${p.year}-${p.month}`
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, formatPeriod(p))
        }
      })
      const options = Array.from(uniqueMap.values())
      setInflationOptions(options)
      if (!inflationFrom && options.length) {
        setInflationFrom(options[Math.max(options.length - 3, 0)])
      }
      if (!inflationTo && options.length) {
        setInflationTo(options[Math.max(options.length - 1, 0)])
      }
    } catch (err) {
      setInflationOptions([])
    }
  }, [fetchWithAuth, inflationFrom, inflationTo])

  React.useEffect(() => {
    if (isOpen && activeTab === 'inflation') {
      loadInflationPeriods()
    }
  }, [isOpen, activeTab, loadInflationPeriods])

  // Helpers to support AND, OR and IF(...) by translating them to JS equivalents
  const replaceLogicalOperators = (expr) => {
    // Replace logical operators (case-insensitive) AND/OR with JS && and ||
    return expr.replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||')
  }

  // Replace IF(cond, a, b) with (cond ? a : b). Handles nested parentheses by parsing.
  const replaceIF = (expr) => {
    let out = ''
    let i = 0
    while (i < expr.length) {
      const idx = expr.toUpperCase().indexOf('IF(', i)
      if (idx === -1) {
        out += expr.slice(i)
        break
      }
      out += expr.slice(i, idx)
      // find matching closing parenthesis for this IF(
      let pos = idx + 3 // position after 'IF('
      let depth = 1
      while (pos < expr.length && depth > 0) {
        if (expr[pos] === '(') depth++
        else if (expr[pos] === ')') depth--
        pos++
      }
      const inside = expr.slice(idx + 3, pos - 1)
      // split top-level commas
      const parts = []
      let buf = ''
      let d = 0
      for (let j = 0; j < inside.length; j++) {
        const ch = inside[j]
        if (ch === '(') { d++; buf += ch }
        else if (ch === ')') { d--; buf += ch }
        else if (ch === ',' && d === 0) { parts.push(buf.trim()); buf = '' }
        else { buf += ch }
      }
      if (buf.length) parts.push(buf.trim())
      if (parts.length !== 3) {
        // keep original and let validation fail later
        out += `IF(${inside})`
      } else {
        // Wrap the entire ternary in parentheses to preserve correct precedence when
        // the IF expression appears in larger expressions (e.g. a + IF(...)).
        out += `(( ${parts[0]} ) ? ( ${parts[1]} ) : ( ${parts[2]} ))`
      }
      i = pos
    }
    return out
  }

  // Validations for boolean operator usage: heuristic - require presence of comparison operators when AND/OR used
  const validateBooleanOperatorsUsage = (originalExpr) => {
    const hasLogical = /\bAND\b|\bOR\b/i.test(originalExpr)
    if (!hasLogical) return true
    // If logical operators are used, require at least one comparison operator in the expression
    const hasComparison = /[<>!=]=?|===|!==/.test(originalExpr)
    return hasComparison
  }

  // Función segura para evaluar expresiones matemáticas y lógicas
  // Ahora soporta price.actual y price.compra, AND/OR, y IF(cond,a,b)
  const evaluateFormula = (expression, actualPrice = 0, compraPrice = 0) => {
    try {
      if (!expression || typeof expression !== 'string') throw new Error('Fórmula inválida')

      // Basic validation for AND/OR usage
      if (!validateBooleanOperatorsUsage(expression)) {
        throw new Error('AND/OR deben operar sobre expresiones booleanas (p. ej. price.actual > 0)')
      }

      // Translate IF and logical operators before variable replacement
      let expr = expression
      expr = replaceIF(expr)
      expr = replaceLogicalOperators(expr)

      // Reemplazar variables por valores numéricos (envolviéndolos entre paréntesis)
      expr = expr
        .replace(/price\.actual/g, `(${parseFloat(actualPrice) || 0})`)
        .replace(/price\.compra/g, `(${parseFloat(compraPrice) || 0})`)
        .replace(/\bprice\b/g, `(${parseFloat(actualPrice) || 0})`)

      // Permitir números, operadores, paréntesis, puntos decimales, comas, espacios y letras para funciones Math y operadores lógicos
      const sanitizedExpression = expr.replace(/[^0-9+\-*/().,\sA-Za-z&|?:<>!=]/g, '')

      // Use Function constructor to evaluate. Result can be number or boolean.
      // eslint-disable-next-line no-new-func
      const result = new Function('return ' + sanitizedExpression)()

      if ((typeof result !== 'number' && typeof result !== 'boolean') || result === null || result === undefined) {
        throw new Error('Resultado inválido')
      }

      return result
    } catch (err) {
      throw new Error(err.message || 'Fórmula inválida')
    }
  }

  const handleFormulaChange = (value) => {
    setFormula(value)
    setError('')
    if (activeTab !== 'formula') return

    // Generar preview con precios de ejemplo (actual y compra)
    if (value.trim()) {
      try {
        // Use larger example values for Argentina to better reflect local magnitudes
        // and avoid many zeros confusion in the preview.
        const exampleActual = 10000
        const exampleCompra = 8000
        const result = evaluateFormula(value, exampleActual, exampleCompra)
        if (typeof result === 'boolean') {
          setPreview(`Ejemplo: actual $${exampleActual}, compra $${exampleCompra} → ${result ? 'true' : 'false'}`)
        } else {
          setPreview(`Ejemplo: actual $${exampleActual}, compra $${exampleCompra} → $${result.toFixed(2)}`)
        }
      } catch (err) {
        setPreview('')
        setError(err.message || 'Fórmula inválida')
      }
    } else {
      setPreview('')
    }
  }

  const clearFormula = () => {
    setFormula('')
    setPreview('')
    setError('')
  }

  const applyFormula = async () => {
    if (activeTab !== 'formula') return
    if (!formula.trim()) {
      setError('Ingresa una fórmula')
      return
    }

    // Context-specific validation: for automatic price list updates, formula MUST use price.compra and MUST NOT use price.actual
    if (contextType === 'autoPriceList') {
      const hasCompra = /price\.compra/i.test(formula)
      const hasActual = /price\.actual/i.test(formula)
      if (!hasCompra) {
        setError("La fórmula para actualización automática debe usar 'price.compra'.")
        return
      }
      if (hasActual) {
        setError("No está permitida la referencia a 'price.actual' en fórmulas de actualización automática.")
        return
      }
    }

    try {
      // Probar con precios de ejemplo para validar (actual y compra)
      evaluateFormula(formula, 100, 80)
      setIsSubmitting(true)
      await onApplyFormula(formula)
      updateFormulaHistory(formula)
      onClose()
      setFormula('')
      setPreview('')
      setError('')
    } catch (err) {
      setError(err.message || 'Fórmula inválida')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Ejemplos según el modo (purchase o sales)
  const purchaseExamples = [
    { label: 'Aumentar 10%', formula: 'price.actual * 1.1' },
    { label: 'Aumentar 25%', formula: 'price.actual * 1.25' },
    { label: 'Sumar $50', formula: 'price.actual + 50' },
    { label: 'Precio fijo $100', formula: '100' }
  ]

  const salesExamples = [
    { label: 'Aumentar 10% (actual)', formula: 'price.actual * 1.1' },
    { label: 'Aumentar 10% (compra)', formula: 'price.compra * 1.1' },
    { label: 'Margen compra (x1.3)', formula: 'price.compra * 1.3' },
    { label: 'IF sobre compra', formula: 'IF(price.compra > 33000, price.compra * 2 + 5800, price.compra * 2)' }
  ]

  const examples = mode === 'purchase' ? purchaseExamples : salesExamples

  // If opened from the automatic price-list flow, hide any examples that reference price.actual
  // to avoid showing disallowed examples in that context.
  const visibleExamples = (contextType === 'autoPriceList')
    ? examples.filter(ex => !/price\.actual/i.test(ex.formula))
    : examples

  // Lista de operadores (se muestran como chips)
  const operators = [
    { label: '+', insert: ' + ' },
    { label: '-', insert: ' - ' },
    { label: '*', insert: ' * ' },
    { label: '/', insert: ' / ' },
    { label: 'AND', insert: ' AND ' },
    { label: 'OR', insert: ' OR ' },
    { label: 'IF()', insert: 'IF( , , )' }
  ]

  const insertAtEnd = (text) => {
    // Simple insertion at end to keep implementation small
    const newForm = formula + text
    setFormula(newForm)
    // trigger preview update
    handleFormulaChange(newForm)
  }

  const buildInflationItemsPayload = () => {
    if (typeof getInflationItems !== 'function') return []
    const source = (basePriceSource || 'actual').toLowerCase()
    const raw = getInflationItems()
    if (!Array.isArray(raw)) return []
    return raw.map((item) => {
      const priceActual = normalizeNumber(item?.existing_price ?? item?.valor ?? item?.price ?? null)
      const priceCompra = normalizeNumber(item?.purchase_price ?? item?.purchase_price_converted ?? null)
      const chosen =
        source === 'compra'
          ? (priceCompra ?? priceActual ?? null)
          : (priceActual ?? priceCompra ?? null)
      if (chosen === null || chosen === undefined) return null
      return {
        id: item?.id || item?.name || item?.item_code,
        price: chosen
      }
    }).filter(Boolean)
  }

  const runInflationAdjustment = async () => {
    setInflationError('')
    setInflationResult(null)

    if (!inflationFrom.trim() || !inflationTo.trim()) {
      setInflationError('Completá periodo origen y destino (ej: mar-25)')
      return
    }
    if (!fetchWithAuth) {
      setInflationError('No hay sesión para calcular')
      return
    }

    const itemsPayload = buildInflationItemsPayload()

    try {
      setInflationLoading(true)
      const body = {
        from_period: inflationFrom.trim(),
        to_period: inflationTo.trim(),
        items: Array.isArray(itemsPayload) ? itemsPayload : [],
        base: basePriceSource
      }
      const response = await fetchWithAuth(API_ROUTES.inflationAdjustment, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      let payload = {}
      try {
        payload = await response.json()
      } catch (e) {
        payload = {}
      }

      if (!response.ok || !payload.success) {
        setInflationError(payload.message || 'No se pudo calcular ajuste')
        return null
      }

      const data = payload.data || payload
      setInflationResult(data)
      return data
    } catch (err) {
      setInflationError('Error al calcular ajuste')
      return null
    } finally {
      setInflationLoading(false)
    }
  }

  React.useEffect(() => {
    if (!isOpen || activeTab !== 'inflation') return
    if (!inflationFrom || !inflationTo) return
    if (inflationLoading) return
    runInflationAdjustment()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inflationFrom, inflationTo, basePriceSource, activeTab, isOpen])

  const applyInflation = async () => {
    let data = inflationResult
    if (!data) {
      data = await runInflationAdjustment()
    }
    if (!data) return
    if (typeof onApplyInflation === 'function') {
      onApplyInflation({ ...data, base: basePriceSource })
    }
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Calculadora de Precios"
      subtitle={`Aplicar fórmula a ${currentItemsCount} items`}
      size="md"
      initialPosition={{ x: 200, y: 150 }}
    >
      <div className="space-y-6">
        <div className="tabs-container">
          <div className="tab-nav">
            <button
              type="button"
              className={`tab-button ${activeTab === 'formula' ? 'active' : ''}`}
              onClick={() => setActiveTab('formula')}
            >
              <Calculator className="w-4 h-4" />
              Fórmulas
            </button>
            <button
              type="button"
              className={`tab-button ${activeTab === 'inflation' ? 'active' : ''}`}
              onClick={() => setActiveTab('inflation')}
            >
              <TrendingUp className="w-4 h-4" />
              Ajuste por inflación
            </button>
          </div>
        </div>

        {activeTab === 'formula' && (
          <>
            {/* Context-specific note */}
            {contextType === 'autoPriceList' ? (
              <p className="text-sm text-gray-500">Esta fórmula será aplicada automáticamente por la configuración de listas de precios automáticas.</p>
            ) : (
              <p className="text-sm text-gray-500">Fórmula manual que se aplicará a los items seleccionados.</p>
            )}

            {/* Input de fórmula */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fórmula matemática
                <span
                  className="ml-2 text-gray-400 hover:text-gray-600 cursor-help"
                  title={"• Usa 'price.actual' para referenciar la columna Precio actual\n• Usa 'price.compra' para referenciar la columna Precio de compra\n• También se admite 'price' como alias de price.actual\n• Operadores: + - * /\n• Paréntesis: ( ) para agrupar\n• Funciones: Math.round(), Math.floor(), Math.ceil(), Math.abs(), Math.max(), Math.min(), Math.pow()"}
                >
                  <Info className="w-4 h-4 inline" />
                </span>
              </label>
              {/* Operator chips */}
              <div className="flex gap-2 mb-2 flex-wrap">
                {operators.map((op, i) => (
                  <button
                    key={i}
                    onClick={() => insertAtEnd(op.insert)}
                    className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
                    title={`Insertar ${op.label}`}
                    type="button"
                  >
                    {op.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={formula}
                  onChange={(e) => handleFormulaChange(e.target.value)}
                  placeholder="Ej: price * 1.1"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
                <button
                  onClick={clearFormula}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  title="Limpiar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {preview && <p className="text-sm text-green-600 mt-1">{preview}</p>}
              {error && (
                <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </p>
              )}
            </div>

            {/* Historial de fórmulas */}
            {formulaHistory.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Últimas fórmulas (max. 5)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {formulaHistory.map((historyFormula, index) => (
                    <button
                      key={`${historyFormula}-${index}`}
                      onClick={() => handleFormulaChange(historyFormula)}
                      className="p-2 text-left bg-white border border-gray-200 hover:border-blue-400 rounded-lg transition-colors text-sm"
                    >
                      <div className="font-mono text-gray-800 text-xs break-words">{historyFormula}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Ejemplos */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ejemplos rápidos
              </label>
              <div className="grid grid-cols-2 gap-2">
                {visibleExamples.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => handleFormulaChange(example.formula)}
                    className="p-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-sm"
                    title={example.label}
                  >
                    <div className="font-medium text-gray-900">{example.label}</div>
                    <div className="font-mono text-gray-600 text-xs">{example.formula}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'inflation' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Calcula un factor de ajuste usando los índices FACPCE disponibles. Si falta un mes final, usa el rango más largo disponible previo; si no hay serie completa se pedirá actualizar índices.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Periodo origen</label>
                <select
                  value={inflationFrom}
                  onChange={(e) => setInflationFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                >
                  <option value="">Selecciona</option>
                  {inflationOptions.map((opt) => (
                    <option key={`from-${opt}`} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Periodo destino</label>
                <select
                  value={inflationTo}
                  onChange={(e) => setInflationTo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
                >
                  <option value="">Selecciona</option>
                  {inflationOptions.map((opt) => (
                    <option key={`to-${opt}`} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <label className="text-sm font-medium text-gray-700">Base:</label>
                <label className="inline-flex items-center gap-1 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="base-price-source"
                    value="actual"
                    checked={basePriceSource === 'actual'}
                    onChange={() => setBasePriceSource('actual')}
                  />
                  Precio actual
                </label>
                <label className="inline-flex items-center gap-1 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="base-price-source"
                    value="compra"
                    checked={basePriceSource === 'compra'}
                    onChange={() => setBasePriceSource('compra')}
                  />
                  Precio compra
                </label>
              </div>
              {inflationResult?.factor && (
                <span className="text-sm font-semibold text-green-700">
                  Factor: {Number(inflationResult.factor).toFixed(4)} (de {inflationResult.used_from_period} a {inflationResult.used_to_period})
                </span>
              )}
            </div>
            {inflationError && (
              <p className="text-sm text-red-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {inflationError}
              </p>
            )}
            <p className="text-xs text-gray-500">
              Si el periodo destino no aparece, agrega índices en Configuración &gt; Indices de inflación (se listan dos meses extras sobre el último disponible).
            </p>
            {inflationResult?.items && inflationResult.items.length > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                <div className="text-sm font-semibold text-gray-700 mb-2">Precios ajustados</div>
                <div className="max-h-48 overflow-auto text-xs text-gray-700 space-y-1">
                  {inflationResult.items.slice(0, 8).map((it, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className="truncate">{it.id || `item-${idx}`}</span>
                      <span className="font-mono">{Number(it.adjusted_price).toFixed(2)}</span>
                    </div>
                  ))}
                  {inflationResult.items.length > 8 && (
                    <div className="text-gray-500">... y {inflationResult.items.length - 8} más</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancelar
          </button>
          {activeTab === 'formula' ? (
            <button
              onClick={applyFormula}
              disabled={!formula.trim() || !!error || isSubmitting || isApplying}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="w-4 h-4" />
              {(isSubmitting || isApplying) ? 'Calculando...' : `Aplicar a ${currentItemsCount} items`}
            </button>
          ) : (
            <button
              onClick={applyInflation}
              disabled={inflationLoading || !inflationFrom.trim() || !inflationTo.trim()}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              <TrendingUp className="w-4 h-4" />
              {inflationLoading ? 'Calculando...' : 'Aplicar ajuste'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default CalculatorModal
