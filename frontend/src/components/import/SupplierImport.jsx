import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileSpreadsheet, Save, Trash2, Truck } from 'lucide-react'
import * as XLSX from 'xlsx'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'

const normalizeHeader = (value) => {
  if (value === undefined || value === null) return ''
  return String(value)
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const normalizeTaxId = (value) => {
  if (value === undefined || value === null) return ''
  return String(value).replace(/[^\d]/g, '').trim()
}

const headerAliases = {
  nombre: 'supplier_name',
  proveedor: 'supplier_name',
  'razon social': 'supplier_name',
  'razón social': 'supplier_name',
  supplier_name: 'supplier_name',
  'supplier name': 'supplier_name',
  cuit: 'tax_id',
  'cuit/dni': 'tax_id',
  dni: 'tax_id',
  tax_id: 'tax_id',
  'tax id': 'tax_id',
  'condicion iva': 'custom_condicion_iva',
  'condición iva': 'custom_condicion_iva',
  custom_condicion_iva: 'custom_condicion_iva',
  'custom condicion iva': 'custom_condicion_iva'
}

const REQUIRED_KEYS = ['supplier_name', 'tax_id']

const isRowEmpty = (row) => {
  if (!row) return true
  return REQUIRED_KEYS.concat(['custom_condicion_iva']).every((k) => {
    const v = row[k]
    return v === undefined || v === null || String(v).trim() === ''
  })
}

export default function SupplierImport() {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showSuccess, showWarning, showError, showInfo } = useNotification()

  const fileInputRef = useRef(null)
  const iframeRef = useRef(null)
  const [iframeReady, setIframeReady] = useState(false)

  const generateRowId = useCallback(
    () => `supplier-row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    []
  )

  const createEmptyRow = useCallback(
    () => ({ id: generateRowId(), supplier_name: '', tax_id: '', custom_condicion_iva: '' }),
    [generateRowId]
  )

  const [rows, setRows] = useState([createEmptyRow()])
  const [rowStatusById, setRowStatusById] = useState({})
  const [isImporting, setIsImporting] = useState(false)
  const [fileName, setFileName] = useState('')

  const columns = useMemo(
    () => [
      { key: 'supplier_name', label: 'Nombre', type: 'text', width: 260 },
      { key: 'tax_id', label: 'CUIT/DNI', type: 'text', width: 140 },
      { key: 'custom_condicion_iva', label: 'Condición IVA', type: 'text', width: 180 }
    ],
    []
  )

  const issues = useMemo(() => {
    const nonEmpty = (rows || []).filter((r) => !isRowEmpty(r))
    const problemRowIds = new Set()

    const seenTaxIds = new Map()
    nonEmpty.forEach((r) => {
      const name = String(r.supplier_name || '').trim()
      const tax = normalizeTaxId(r.tax_id)
      if (!name || !tax) problemRowIds.add(r.id)
      if (tax) {
        const prev = seenTaxIds.get(tax)
        if (prev) {
          problemRowIds.add(prev)
          problemRowIds.add(r.id)
        } else {
          seenTaxIds.set(tax, r.id)
        }
      }
    })
    return problemRowIds
  }, [rows])

  const rowHighlights = useMemo(() => {
    return (rows || []).map((r) => {
      if (issues.has(r.id)) return 'error'
      const status = rowStatusById[r.id]
      if (status === 'error') return 'error'
      if (status === 'exists') return 'flag-yellow'
      return null
    })
  }, [rows, issues, rowStatusById])

  const sendTableConfiguration = useCallback(() => {
    if (!iframeReady || !iframeRef.current?.contentWindow) return

    const tableRows = (rows || []).map((row) => columns.map((col) => row[col.key] ?? ''))
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'ht-configure-table',
        columns,
        data: tableRows,
        rowIds: (rows || []).map((r) => r.id),
        rowHighlights
      },
      '*'
    )
  }, [iframeReady, rows, columns, rowHighlights])

  useEffect(() => {
    sendTableConfiguration()
  }, [sendTableConfiguration])

  const handleIframeLoad = useCallback(() => setIframeReady(true), [])

  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data || typeof event.data !== 'object') return

      if (event.data.type === 'ht-data-changed' && Array.isArray(event.data.data)) {
        const updated = event.data.data.map((rowArray, idx) => {
          const obj = { id: event.data.rowIds?.[idx] || generateRowId() }
          columns.forEach((col, colIdx) => {
            obj[col.key] = rowArray[colIdx]
          })
          obj.tax_id = normalizeTaxId(obj.tax_id)
          return obj
        })

        const nonEmpty = updated.filter((r) => !isRowEmpty(r))
        setRows([...nonEmpty, createEmptyRow()])
      }

      if (event.data.type === 'ht-rows-removed' && Array.isArray(event.data.removedIds)) {
        const removedIds = event.data.removedIds.filter((id) => id !== null && id !== undefined)
        if (removedIds.length === 0) return
        const removedSet = new Set(removedIds)
        setRows((prev) => {
          const nextNonEmpty = (prev || []).filter((r) => !removedSet.has(r.id) && !isRowEmpty(r))
          return [...nextNonEmpty, createEmptyRow()]
        })
        setRowStatusById((prev) => {
          const copy = { ...(prev || {}) }
          removedIds.forEach((id) => delete copy[id])
          return copy
        })
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [columns, createEmptyRow, generateRowId])

  const handleBrowseFile = () => {
    if (!fileInputRef.current) return
    fileInputRef.current.value = ''
    fileInputRef.current.click()
  }

  const parseXlsx = async (file) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheetName = workbook.SheetNames?.[0]
    if (!sheetName) return []
    const sheet = workbook.Sheets[sheetName]
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
    if (!Array.isArray(grid) || grid.length === 0) return []

    const findHeaderRow = () => {
      for (let i = 0; i < Math.min(grid.length, 20); i++) {
        const row = grid[i] || []
        const keys = new Set(row.map((c) => headerAliases[normalizeHeader(c)]).filter(Boolean))
        if (REQUIRED_KEYS.every((k) => keys.has(k))) return i
      }
      return 0
    }

    const headerRowIndex = findHeaderRow()
    const headers = (grid[headerRowIndex] || []).map((c) => headerAliases[normalizeHeader(c)] || null)

    const parsed = []
    for (let i = headerRowIndex + 1; i < grid.length; i++) {
      const row = grid[i] || []
      const obj = { id: generateRowId(), supplier_name: '', tax_id: '', custom_condicion_iva: '' }
      headers.forEach((key, colIdx) => {
        if (!key) return
        obj[key] = row[colIdx] ?? ''
      })
      obj.supplier_name = String(obj.supplier_name || '').trim()
      obj.tax_id = normalizeTaxId(obj.tax_id)
      obj.custom_condicion_iva = String(obj.custom_condicion_iva || '').trim()
      if (!isRowEmpty(obj)) parsed.push(obj)
    }
    return parsed
  }

  const handleFileUpload = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      setFileName(file.name)
      try {
        const parsed = await parseXlsx(file)
        setRowStatusById({})
        setRows([...parsed, createEmptyRow()])
        if (parsed.length === 0) {
          showWarning('El archivo no tenía filas válidas')
        } else {
          showSuccess(`Archivo cargado (${parsed.length} proveedores)`)
        }
      } catch (e) {
        console.error('SupplierImport parse error', e)
        showError('No se pudo leer el archivo XLSX')
      }
    },
    [createEmptyRow, showError, showSuccess, showWarning]
  )

  const handleDownloadTemplate = () => {
    try {
      const aoa = [columns.map((c) => c.label), ['', '', '']]
      const worksheet = XLSX.utils.aoa_to_sheet(aoa)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Proveedores')
      XLSX.writeFile(workbook, 'import_proveedores.xlsx')
      showInfo('Plantilla descargada')
    } catch (e) {
      console.error('download template error', e)
      showError('No se pudo generar la plantilla')
    }
  }

  const clearAll = () => {
    setRows([createEmptyRow()])
    setRowStatusById({})
    setFileName('')
  }

  const toImport = useMemo(() => (rows || []).filter((r) => !isRowEmpty(r)), [rows])
  const validToImport = useMemo(
    () => toImport.filter((r) => !issues.has(r.id)),
    [toImport, issues]
  )

  const handleImport = useCallback(async () => {
    if (!API_ROUTES.importSuppliers) {
      showError('Ruta de importación no configurada')
      return
    }

    if (validToImport.length === 0) {
      showWarning('No hay filas válidas para importar')
      return
    }

    setIsImporting(true)
    try {
      const idByOrder = validToImport.map((r) => r.id)
      const bodyRows = validToImport.map((r) => ({
        supplier_name: String(r.supplier_name || '').trim(),
        tax_id: normalizeTaxId(r.tax_id),
        custom_condicion_iva: String(r.custom_condicion_iva || '').trim()
      }))

      const res = await fetchWithAuth(API_ROUTES.importSuppliers, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: bodyRows })
      })
      const data = await res.json()
      if (!res.ok || !data?.success) {
        showError(data?.message || 'Error importando proveedores')
        return
      }

      const nextStatus = {}
      ;(data.results || []).forEach((r) => {
        const rowIdx = (r.row || 0) - 1
        const id = idByOrder[rowIdx]
        if (!id) return
        nextStatus[id] = r.status
      })
      setRowStatusById((prev) => ({ ...(prev || {}), ...nextStatus }))

      const summary = data.summary || {}
      showSuccess(`Proveedores: ${summary.created || 0} creados, ${summary.exists || 0} existentes, ${summary.errors || 0} errores`)
    } catch (e) {
      console.error('import suppliers error', e)
      showError('Error importando proveedores')
    } finally {
      setIsImporting(false)
    }
  }, [fetchWithAuth, showError, showSuccess, showWarning, validToImport])

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="bg-white/70 backdrop-blur-xl shadow-2xl border border-gray-200/60 rounded-3xl overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Truck className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-500">Importación</div>
                <div className="text-xl font-bold text-gray-800">Proveedores</div>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {toImport.length > 0 ? `${toImport.length} filas` : ''}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={handleDownloadTemplate}>
              <Download className="w-4 h-4" />
              Descargar plantilla
            </button>
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={handleBrowseFile}>
              <FileSpreadsheet className="w-4 h-4" />
              Cargar XLSX
            </button>
            {fileName ? (
              <span className="text-xs text-gray-600 px-2 py-1 bg-gray-100 rounded-lg border border-gray-200">
                {fileName}
              </span>
            ) : null}

            <button type="button" className="btn-secondary flex items-center gap-2" onClick={clearAll}>
              <Trash2 className="w-4 h-4" />
              Limpiar
            </button>

            <div className="ml-auto flex items-center gap-3">
              <div className="text-xs text-gray-600">
                Válidas: <span className="font-bold">{validToImport.length}</span>
              </div>
              <button
                type="button"
                className="btn-primary flex items-center gap-2"
                onClick={handleImport}
                disabled={isImporting || validToImport.length === 0}
              >
                <Save className="w-4 h-4" />
                {isImporting ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 flex-1 min-h-0 flex flex-col">
          <iframe
            ref={iframeRef}
            src="/handsontable-demo.html"
            onLoad={handleIframeLoad}
            className="w-full flex-1 min-h-0 border-0 rounded-xl shadow-sm"
            title="Tabla de Proveedores"
          />
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
    </div>
  )
}
