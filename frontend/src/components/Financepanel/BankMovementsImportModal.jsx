import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, UploadCloud, ArrowDownToLine, Save, ListChecks, AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react'
import Modal from '../Modal'
import API_ROUTES from '../../apiRoutes'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import loadingGif from '../../media/Carga1.gif'

const DEFAULT_IMPORT_FORMAT = 'split'

// Template columns for bank movements import
const BASE_TEMPLATE_COLUMNS = [
  {
    key: 'date',
    label: 'Fecha',
    type: 'date',
    format: 'DD/MM/YYYY',
    required: true,
    description: 'Fecha del movimiento',
    width: 120
  },
  {
    key: 'description',
    label: 'Descripción',
    type: 'text',
    required: true,
    description: 'Descripción del movimiento',
    width: 300
  },
  {
    key: 'reference',
    label: 'Referencia',
    type: 'text',
    required: false,
    description: 'Número de referencia o comprobante',
    width: 150
  }
]

const FORMAT_SPECIFIC_COLUMNS = {
  split: [
    {
      key: 'deposit',
      label: 'Depósito',
      type: 'number',
      required: false,
      description: 'Monto de depósito (entrada de dinero)',
      width: 120
    },
    {
      key: 'withdrawal',
      label: 'Retiro',
      type: 'number',
      required: false,
      description: 'Monto de retiro (salida de dinero)',
      width: 120
    }
  ],
  combined: [
    {
      key: 'amount',
      label: 'Monto (+ entrada / - salida)',
      type: 'number',
      required: false,
      description: 'Monto en una sola columna (positivo = depósito, negativo = retiro)',
      width: 160
    }
  ]
}

const getTemplateColumns = (format = DEFAULT_IMPORT_FORMAT) => {
  const formatColumns = FORMAT_SPECIFIC_COLUMNS[format] || FORMAT_SPECIFIC_COLUMNS[DEFAULT_IMPORT_FORMAT]
  return [...BASE_TEMPLATE_COLUMNS, ...formatColumns]
}

const normalizeHeader = (header) => {
  if (!header) return ''
  return header
    .toLowerCase()
    .replace(/"/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

const headerAliases = {
  'fecha': 'date',
  'date': 'date',
  'descripcion': 'description',
  'description': 'description',
  'detalle': 'description',
  'concepto': 'description',
  'referencia': 'reference',
  'reference': 'reference',
  'numero': 'reference',
  'comprobante': 'reference',
  'deposito': 'deposit',
  'deposit': 'deposit',
  'credito': 'deposit',
  'credit': 'deposit',
  'haber': 'deposit',
  'entrada': 'deposit',
  'retiro': 'withdrawal',
  'withdrawal': 'withdrawal',
  'debito': 'withdrawal',
  'debit': 'withdrawal',
  'debe': 'withdrawal',
  'salida': 'withdrawal',
  'moneda': 'currency',
  'currency': 'currency',
  'monto': 'amount',
  'amount': 'amount',
  'importe': 'amount'
}

const parseDecimal = (value) => {
  if (value === undefined || value === null || value === '') return ''
  const raw = String(value).trim()
  if (!raw) return ''
  // Handle Argentine format: dots for thousands, comma for decimals
  const normalized = raw.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : ''
}

const generateRowId = () => `bank-import-row-${Date.now()}-${Math.random().toString(16).slice(2)}`

const createEmptyRow = () => ({
  id: generateRowId(),
  date: '',
  description: '',
  reference: '',
  deposit: '',
  withdrawal: '',
  amount: '',
  currency: ''
})

const normalizeMovementRow = (row = {}) => {
  const normalizedRow = {
    id: row.id || generateRowId(),
    date: row.date || '',
    description: row.description || '',
    reference: row.reference || '',
    currency: row.currency || ''
  }

  const depositValue = parseDecimal(row.deposit)
  const withdrawalValue = parseDecimal(row.withdrawal)
  const amountValue = parseDecimal(row.amount)

  let deposit = typeof depositValue === 'number' ? depositValue : ''
  let withdrawal = typeof withdrawalValue === 'number' ? withdrawalValue : ''
  let amount = typeof amountValue === 'number' ? amountValue : ''

  if (typeof deposit === 'number' && deposit < 0) {
    withdrawal = Math.abs(deposit)
    deposit = ''
  }

  if (typeof withdrawal === 'number' && withdrawal < 0) {
    deposit = Math.abs(withdrawal)
    withdrawal = ''
  }

  if (typeof amount === 'number') {
    if (amount >= 0) {
      deposit = amount
      withdrawal = ''
    } else {
      deposit = ''
      withdrawal = Math.abs(amount)
    }
  } else if (typeof deposit === 'number') {
    amount = deposit
  } else if (typeof withdrawal === 'number') {
    amount = -withdrawal
  } else {
    amount = ''
  }

  normalizedRow.deposit = deposit
  normalizedRow.withdrawal = withdrawal
  normalizedRow.amount = amount
  return normalizedRow
}

const hasRowContent = (row = {}) => {
  const hasText = ['date', 'description', 'reference'].some((key) => {
    const value = row[key]
    return value !== undefined && value !== null && String(value).trim() !== ''
  })

  const hasNumericValue = (value) => value !== '' && value !== null && value !== undefined && Number(value) !== 0

  return hasText || hasNumericValue(row.deposit) || hasNumericValue(row.withdrawal) || hasNumericValue(row.amount)
}

const parseCsvContent = (content) => {
  if (!content) return []
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const rawHeaders = lines[0].split(delimiter).map(cell => cell.replace(/^"+|"+$/g, '').trim())
  const headers = rawHeaders.map(h => normalizeHeader(h)).filter(Boolean)

  console.log('CSV Headers detectados:', headers)

  const hasHeaders = headers.some(h => headerAliases[h])
  const dataLines = hasHeaders ? lines.slice(1) : lines

  const rows = dataLines.map((line, rowIndex) => {
    const cells = line.split(delimiter).map(cell => cell.replace(/^"+|"+$/g, '').trim())
    const row = { id: rowIndex + 1 }

    if (hasHeaders) {
      headers.forEach((header, idx) => {
        const key = headerAliases[header] || header.replace(/\s+/g, '_')
        const value = cells[idx] ?? ''
        
        // Numeric columns
        const numericKeys = ['deposit', 'withdrawal', 'amount']
        if (numericKeys.includes(key)) {
          row[key] = parseDecimal(value)
        } else {
          row[key] = value
        }
      })
    } else {
      // Assume fixed order: date, description, reference, deposit, withdrawal, amount, currency
      const fixedKeys = ['date', 'description', 'reference', 'deposit', 'withdrawal', 'amount', 'currency']
      fixedKeys.forEach((key, idx) => {
        const value = cells[idx] ?? ''
        if (['deposit', 'withdrawal'].includes(key)) {
          row[key] = parseDecimal(value)
        } else {
          row[key] = value
        }
      })
    }

    // Handle "amount" column - convert to deposit/withdrawal
    if (row.amount !== undefined && row.amount !== '') {
      const amt = Number(row.amount)
      if (amt >= 0) {
        row.deposit = amt
        row.withdrawal = ''
      } else {
        row.deposit = ''
        row.withdrawal = Math.abs(amt)
      }
      delete row.amount
    }

    return row
  })

  return rows.filter(row => Object.values(row).some(v => v !== '' && v !== undefined))
}

export default function BankMovementsImportModal({
  isOpen,
  onClose,
  bankAccount,
  onImportComplete,
  accountCurrency = ''
}) {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showSuccess, showWarning, showError } = useNotification()

  const [tableData, setTableData] = useState([])
  const [importFormat, setImportFormat] = useState(DEFAULT_IMPORT_FORMAT)
  const [csvFileName, setCsvFileName] = useState('')
  const [isParsingCsv, setIsParsingCsv] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [rowIssues, setRowIssues] = useState([])
  const [validationResult, setValidationResult] = useState(null)
  const [isValidating, setIsValidating] = useState(false)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [totalsPreview, setTotalsPreview] = useState({ deposits: 0, withdrawals: 0 })
  const resolvedCurrency = accountCurrency
  
  const fileInputRef = useRef(null)
  const iframeRef = useRef(null)
  const [iframeReady, setIframeReady] = useState(false)
  const activeRows = useMemo(() => tableData.filter(hasRowContent), [tableData])
  const isManualInput = !csvFileName
  const rowHighlightMap = useMemo(() => {
    if (!validationResult || !Array.isArray(validationResult.rows)) {
      return {}
    }

    const map = {}
    validationResult.rows.forEach((row) => {
      if (!row) return
      const severityKey = row.severity && row.severity !== 'none' ? `flag-${row.severity}` : null
      const rowId = row.row_id ? String(row.row_id) : null
      const rowIndexKey = Number.isFinite(row.row_index) ? String(row.row_index) : null

      if (rowId) {
        map[rowId] = severityKey
      }
      if (rowIndexKey) {
        map[rowIndexKey] = severityKey
      }
    })
    return map
  }, [validationResult])

  // Iframe columns configuration
  const iframeColumns = useMemo(() => getTemplateColumns(importFormat).map(col => ({
    key: col.key,
    label: `${col.label}${col.required ? ' *' : ''}`,
    type: col.type === 'number' ? 'numeric' : col.type,
    width: col.width || 160,
    dateFormat: col.format || undefined
  })), [importFormat])

  // Validate rows and calculate totals
  useEffect(() => {
    if (activeRows.length === 0) {
      setRowIssues([])
      setTotalsPreview({ deposits: 0, withdrawals: 0 })
      return
    }

    const issues = []
    let deposits = 0
    let withdrawals = 0

    activeRows.forEach((row, idx) => {
      if (!row.date || String(row.date).trim() === '') {
        issues.push({ row: idx + 1, message: 'Fecha requerida' })
      }
      if (!row.description || String(row.description).trim() === '') {
        issues.push({ row: idx + 1, message: 'Descripción requerida' })
      }
      
      const dep = typeof row.deposit === 'number' ? row.deposit : 0
      const wit = typeof row.withdrawal === 'number' ? row.withdrawal : 0
      
      if (dep === 0 && wit === 0) {
        issues.push({ row: idx + 1, message: 'Debe ingresar un monto (depósito o retiro)' })
      }

      if (Number.isFinite(dep)) deposits += dep
      if (Number.isFinite(wit)) withdrawals += wit
    })

    setRowIssues(issues)
    setTotalsPreview({ deposits, withdrawals })
  }, [activeRows])

  // Handle CSV file upload
  const handleCsvUpload = useCallback((event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setCsvFileName(file.name)
    setIsParsingCsv(true)

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = parseCsvContent(reader.result)
        const normalized = parsed.map(normalizeMovementRow).filter(hasRowContent)
        setValidationResult(null)
        setWarningsAcknowledged(false)
        setTableData(normalized)
        if (normalized.length === 0) {
          showWarning('El archivo no contiene movimientos válidos')
        } else {
          showSuccess(`Archivo cargado (${normalized.length} movimientos)`)
        }
      } catch (error) {
        console.error('Error parsing CSV:', error)
        showError('No se pudo leer el archivo')
      } finally {
        setIsParsingCsv(false)
      }
    }
    reader.onerror = () => {
      setIsParsingCsv(false)
      showError('No se pudo leer el archivo')
    }
    reader.readAsText(file, 'utf-8')
  }, [showError, showSuccess, showWarning])

  const handleBrowseFile = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  // Download template
  const handleDownloadTemplate = useCallback(() => {
    const columns = getTemplateColumns(importFormat)
    const headers = columns.map(c => c.label).join(';')
    const exampleRow = importFormat === 'combined'
      ? '15/01/2025;Transferencia recibida;REF-001;10000'
      : '15/01/2025;Transferencia recibida;REF-001;10000;'
    const csvContent = `${headers}\n${exampleRow}`
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'plantilla_movimientos_bancarios.csv'
    link.click()
    URL.revokeObjectURL(url)
  }, [importFormat])

  const runValidationCheck = useCallback(async () => {
    if (!bankAccount) {
      showError('Selecciona una cuenta bancaria antes de chequear duplicados')
      return null
    }
    if (!resolvedCurrency) {
      showError('No se pudo determinar la moneda de la cuenta bancaria (faltan datos de la cuenta)')
      return null
    }
    if (!activeRows || activeRows.length === 0) {
      showWarning('Agrega al menos un movimiento antes de chequear')
      return null
    }

    setIsValidating(true)
    try {
      const payload = {
        bank_account: bankAccount,
        movements: activeRows.map((row, idx) => ({
          client_row_id: row.id || `row-${idx + 1}`,
          date: row.date,
          description: row.description,
          reference: row.reference || '',
          deposit: row.deposit || 0,
          withdrawal: row.withdrawal || 0,
          currency: resolvedCurrency
        }))
      }

      const response = await fetchWithAuth(API_ROUTES.bankMovementsValidate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.success) {
        showError(data.message || 'No se pudo chequear los movimientos')
        return null
      }

      const summary = data?.data?.summary || {}
      setValidationResult(data.data)
      const hasWarnings = (summary.yellow_count || 0) + (summary.orange_count || 0) > 0
      setWarningsAcknowledged(!hasWarnings)

      if (summary.red_count > 0) {
        showWarning('Hay movimientos repetidos marcados en rojo. Borralos antes de importar.')
      } else if (hasWarnings) {
        showWarning('Revisa los movimientos marcados en amarillo o naranja y si estan correctos confirmalos antes de importar.')
      } else if (isManualInput) {
        showSuccess('Chequeo completado. No se detectaron movimientos sospechosos.')
      }

      return data.data
    } catch (error) {
      console.error('Validation error:', error)
      showError('No se pudo ejecutar el chequeo de duplicados')
      return null
    } finally {
      setIsValidating(false)
    }
  }, [activeRows, bankAccount, fetchWithAuth, isManualInput, resolvedCurrency, showError, showSuccess, showWarning])

  // Send table configuration to iframe
  const sendTableConfiguration = useCallback(() => {
    if (!iframeReady || !iframeRef.current?.contentWindow) return

    const rowsForIframe = tableData.length > 0 ? [...tableData] : []
    rowsForIframe.push(createEmptyRow())

    const tableRows = rowsForIframe.map((row) =>
      iframeColumns.map(col => {
        if (col.key === 'amount') {
          if (typeof row.amount === 'number') return row.amount
          if (typeof row.deposit === 'number') return row.deposit
          if (typeof row.withdrawal === 'number') return -row.withdrawal
          return ''
        }
        if (col.key === 'deposit' || col.key === 'withdrawal') {
          return typeof row[col.key] === 'number' ? row[col.key] : ''
        }
        return row[col.key] ?? ''
      })
    )

    const rowIds = rowsForIframe.map(row => row.id || generateRowId())
    const rowHighlights = rowsForIframe.map((row, idx) => {
      const idKey = row.id != null ? String(row.id) : null
      const numericKey = String(idx + 1)
      return (idKey && rowHighlightMap[idKey]) ?? rowHighlightMap[numericKey] ?? null
    })

    iframeRef.current.contentWindow.postMessage({
      type: 'ht-configure-table',
      columns: iframeColumns,
      data: tableRows,
      rowIds,
      rowHighlights
    }, '*')
  }, [iframeReady, tableData, iframeColumns, rowHighlightMap])

  useEffect(() => {
    if (isOpen) {
      sendTableConfiguration()
    }
  }, [sendTableConfiguration, isOpen])

  const handleIframeLoad = useCallback(() => {
    setIframeReady(true)
  }, [])

  // Listen for iframe messages
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data || typeof event.data !== 'object') return
      if (!isOpen) return

      if (event.data.type === 'ht-data-changed' && Array.isArray(event.data.data)) {
        const updatedData = event.data.data.map((row, idx) => {
          const obj = { id: event.data.rowIds?.[idx] || generateRowId() }
          iframeColumns.forEach((col, colIdx) => {
            obj[col.key] = row[colIdx]
          })
          return normalizeMovementRow(obj)
        }).filter(hasRowContent)
        
        setTableData(updatedData)
        setValidationResult(null)
        setWarningsAcknowledged(false)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [iframeColumns, isOpen])

  // Handle import
  const executeImport = useCallback(async () => {
    setIsImporting(true)

    try {
      const payload = {
        bank_account: bankAccount,
        skip_duplicates: false,
        movements: activeRows.map(row => ({
          date: row.date,
          description: row.description,
          reference: row.reference || '',
          deposit: row.deposit || 0,
          withdrawal: row.withdrawal || 0,
          currency: resolvedCurrency
        }))
      }

      const response = await fetchWithAuth(API_ROUTES.bankMovementsImport, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json().catch(() => ({}))
      
      if (!response.ok) {
        showError(data.message || 'Error al importar movimientos')
        return
      }

      if (data.success) {
        showSuccess(data.message || 'Movimientos importados correctamente')
        
        setTableData([])
        setCsvFileName('')
        setValidationResult(null)
        setWarningsAcknowledged(false)
        
        if (onImportComplete) {
          onImportComplete(data.data)
        }
        
        onClose()
        
        
        // Show warnings if any
        if (data.skipped && data.skipped.length > 0) {
          const skippedMsg = data.skipped.slice(0, 5).map(s => `• Fila ${s.row}: ${s.reason}`).join('\n')
          showWarning(`Movimientos omitidos:\n${skippedMsg}`)
        }
      } else {
        showWarning(data.message || 'Importación con advertencias')
      }


    } catch (err) {
      console.error('Import error:', err)
      showError('No se pudo importar los movimientos')
    } finally {
      setIsImporting(false)
    }
  }, [activeRows, bankAccount, fetchWithAuth, onClose, onImportComplete, resolvedCurrency, showError, showSuccess, showWarning])

  const handleImport = async () => {
    if (!activeRows || activeRows.length === 0) {
      showWarning('Carga al menos un movimiento antes de importar')
      return
    }
    if (rowIssues.length > 0) {
      showWarning('Revisa los campos obligatorios: fecha, descripci▋ y monto')
      return
    }
    if (!bankAccount) {
      showError('No se ha seleccionado una cuenta bancaria')
      return
    }
    if (!resolvedCurrency) {
      showError('No se pudo determinar la moneda de la cuenta bancaria (faltan datos de la cuenta)')
      return
    }

    const summary = validationResult?.summary || {}
    const hasWarnings = (summary.yellow_count || 0) + (summary.orange_count || 0) > 0

    if (!validationResult) {
      const validationData = await runValidationCheck()
      if (!validationData) {
        return
      }
      const newSummary = validationData.summary || {}
      const newHasWarnings = (newSummary.yellow_count || 0) + (newSummary.orange_count || 0) > 0
      if (!isManualInput && newSummary.red_count === 0 && !newHasWarnings) {
        await executeImport()
      }
      return
    }

    if (summary.red_count > 0) {
      showWarning('Borra antes los movimientos repetidos que aparecen en rojo')
      return
    }

    if (hasWarnings && !warningsAcknowledged) {
      showWarning('Acepta los movimientos marcados en amarillo o naranja antes de importar')
      return
    }

    await executeImport()
  }

  // Count valid rows
  const validCount = useMemo(() => {
    if (!activeRows || activeRows.length === 0) return 0
    return activeRows.reduce((acc, row) => {
      const hasDate = row.date && String(row.date).trim() !== ''
      const hasDesc = row.description && String(row.description).trim() !== ''
      const dep = typeof row.deposit === 'number' ? row.deposit : 0
      const wit = typeof row.withdrawal === 'number' ? row.withdrawal : 0
      const hasMonto = dep !== 0 || wit !== 0
      return acc + (hasDate && hasDesc && hasMonto ? 1 : 0)
    }, 0)
  }, [activeRows])

  const validationSummary = validationResult?.summary || null
  const warningTotal = validationSummary ? (validationSummary.yellow_count || 0) + (validationSummary.orange_count || 0) : 0
  const redBlocked = Boolean(validationSummary && validationSummary.red_count > 0)
  const warningsPending = warningTotal > 0 && !warningsAcknowledged
  const primaryButtonDisabled = isImporting || isValidating || validCount <= 0 || rowIssues.length > 0 || redBlocked || warningsPending
  const primaryButtonTitle = redBlocked
    ? 'Borra antes los movimientos repetidos'
    : warningsPending
      ? 'Acepta los movimientos marcados en amarillo o naranja'
      : ''
  const primaryButtonLabel = isImporting
    ? 'Procesando...'
    : isValidating
      ? 'Chequeando...'
      : (isManualInput && !validationResult ? `Chequear (${validCount || 0})` : `Importar (${validCount || 0})`)

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setTableData([])
      setCsvFileName('')
      setRowIssues([])
      setTotalsPreview({ deposits: 0, withdrawals: 0 })
      setIframeReady(false)
      setValidationResult(null)
      setWarningsAcknowledged(false)
    }
  }, [isOpen])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Importar Movimientos Bancarios"
      size="xl"
    >
      <div className="relative">
        {isImporting && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 rounded-2xl">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-24 h-24 rounded-xl overflow-hidden border border-blue-100 bg-blue-50 flex items-center justify-center">
                <img src={loadingGif} alt="Importando" className="w-full h-full object-contain" />
              </div>
              <div className="text-base font-semibold text-gray-800">Importando movimientos...</div>
              <div className="text-sm text-gray-600">
                Esto puede tardar unos segundos.
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Actions bar */}
          <div className="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              className="btn-secondary flex items-center justify-center gap-2"
              onClick={handleBrowseFile}
              disabled={isParsingCsv}
            >
              <UploadCloud className="w-4 h-4" />
              {isParsingCsv ? 'Cargando...' : 'Cargar CSV'}
            </button>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center px-4 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 font-semibold hover:bg-blue-100 transition-colors text-sm"
          >
            <ArrowDownToLine className="w-4 h-4 mr-2" />
            Plantilla
          </button>

          <div className="flex flex-col justify-center">
            <div className="flex gap-2 bg-gray-100 p-1 rounded-lg h-9">
              <button
                type="button"
                className={`btn-mode-selector ${importFormat === 'split' ? 'active' : ''}`}
                onClick={() => setImportFormat('split')}
              >
                Depósitos / Retiros
              </button>
              <button
                type="button"
                className={`btn-mode-selector ${importFormat === 'combined' ? 'active' : ''}`}
                onClick={() => setImportFormat('combined')}
              >
                Monto único
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1 rounded-2xl border border-blue-200 bg-blue-50 text-blue-800 text-xs font-semibold" title="Moneda de la cuenta contable asociada">
            <span className="uppercase tracking-wider text-[10px] text-blue-600">Moneda</span>
            <span className="text-sm text-blue-900">{resolvedCurrency}</span>
          </div>

          {csvFileName && (
            <span className="text-xs text-gray-600 px-2 py-1 bg-gray-100 rounded-lg border border-gray-200">
              {csvFileName}
            </span>
          )}

            {rowIssues.length > 0 && (
              <div className="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
                <ListChecks className="w-4 h-4" />
                <span>Faltan datos en {rowIssues.length} fila(s)</span>
              </div>
            )}

            <div className="ml-auto">
              <button
                type="button"
                className="flex items-center gap-2 h-9 px-4 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-all disabled:bg-gray-400 text-sm"
                onClick={handleImport}
                disabled={primaryButtonDisabled}
                title={primaryButtonTitle}
              >
                <Save className="w-4 h-4" />
                <span>{primaryButtonLabel}</span>
              </button>
            </div>
          </div>

          {validationResult && (
            <div className="rounded-2xl border border-gray-200 bg-white/90 shadow-sm px-4 py-3 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-orange-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-800">Chequeo de duplicados</p>
                  <p className="text-xs text-gray-500">Revisa los movimientos marcados dentro de la tabla antes de continuar.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-yellow-200 bg-yellow-50 text-yellow-800">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  Amarillo: {validationSummary?.yellow_count || 0}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-orange-200 bg-orange-50 text-orange-800">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-400" />
                  Naranja: {validationSummary?.orange_count || 0}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-red-200 bg-red-50 text-red-700">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  Rojo: {validationSummary?.red_count || 0}
                </span>
              </div>
              {validationSummary?.red_count > 0 ? (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Elimina o ajusta los movimientos en rojo antes de importar.</span>
                </div>
              ) : warningTotal > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-sm text-amber-700">Si ya verificaste los movimientos marcados, confírmalo para continuar.</div>
                  <button
                    type="button"
                    onClick={() => setWarningsAcknowledged(true)}
                    disabled={warningsAcknowledged}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border ${warningsAcknowledged ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {warningsAcknowledged ? 'Aceptado' : 'Aceptar y continuar'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <ShieldCheck className="w-4 h-4" />
                  <span>No se detectaron coincidencias con otros movimientos.</span>
                </div>
              )}
            </div>
          )}

          {/* Handsontable iframe */}
          <div className="rounded-2xl border border-gray-200 shadow-inner" style={{ height: '400px' }}>
            <iframe
              ref={iframeRef}
              src="/handsontable-demo.html"
              className="w-full h-full border-0 rounded-2xl"
              title="Importación de movimientos"
              onLoad={handleIframeLoad}
            />
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-yellow-300 border border-yellow-500" />
              <span>Coincidencia dentro del archivo</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-orange-400 border border-orange-600" />
              <span>Cruce con movimientos existentes o fechas fuera de rango</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-400 border border-red-600" />
              <span>Movimiento repetido (bloquea la importación)</span>
            </div>
          </div>

          {/* Totals preview */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/80 border border-gray-200 rounded-2xl p-3 shadow-sm">
              <p className="text-xs text-gray-500">Total Depósitos</p>
              <p className="text-lg font-bold text-green-600">
                {Number(totalsPreview.deposits || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-white/80 border border-gray-200 rounded-2xl p-3 shadow-sm">
              <p className="text-xs text-gray-500">Total Retiros</p>
              <p className="text-lg font-bold text-red-600">
                {Number(totalsPreview.withdrawals || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-white/80 border border-gray-200 rounded-2xl p-3 shadow-sm">
              <p className="text-xs text-gray-500">Neto</p>
              <p className={`text-lg font-bold ${(totalsPreview.deposits - totalsPreview.withdrawals) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {Number((totalsPreview.deposits || 0) - (totalsPreview.withdrawals || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Footer hint */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <FileSpreadsheet className="w-4 h-4 text-gray-400" />
            <span>Puedes copiar y pegar directamente desde Excel o Google Sheets.</span>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleCsvUpload}
          className="hidden"
        />
      </div>
    </Modal>
  )
}
