import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { TrendingUp, RefreshCw, Save, Plus, ExternalLink, AlertCircle } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'

const buildEmptyRow = () => ({
  id: `inflacion-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  periodo: '',
  ipc_nacional: '',
  fuente: 'FACPCE'
})

const normalizeNumber = (value) => {
  if (value === null || value === undefined || value === '') return ''
  const text = typeof value === 'string' ? value.replace(',', '.').trim() : value
  const parsed = parseFloat(text)
  if (!Number.isFinite(parsed)) return ''
  return Number(parsed.toFixed(4))
}

const hasContent = (row) => {
  if (!row) return false
  const periodo = (row.periodo || '').trim()
  const ipcVal = row.ipc_nacional
  return periodo !== '' || (ipcVal !== '' && ipcVal !== null && ipcVal !== undefined)
}

const ensureTrailingBlank = (rows) => {
  const safeRows = Array.isArray(rows) ? [...rows] : []
  if (safeRows.length === 0 || hasContent(safeRows[safeRows.length - 1])) {
    safeRows.push(buildEmptyRow())
  }
  return safeRows
}

const compactRows = (rows) =>
  (rows || [])
    .filter((row) => hasContent(row))
    .map((row) => ({
      id: row.id || row.name || row.periodo,
      name: row.name || row.id || row.periodo,
      periodo: (row.periodo || '').trim(),
      ipc_nacional: normalizeNumber(row.ipc_nacional),
      fuente: row.fuente || 'FACPCE'
    }))

export default function InflationIndicesTab() {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useNotification()

  const [rows, setRows] = useState(() => ensureTrailingBlank([]))
  const [originalRows, setOriginalRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [iframeReady, setIframeReady] = useState(false)

  const iframeRef = useRef(null)
  const rowsRef = useRef(rows)

  const columns = useMemo(
    () => [
      { key: 'periodo', label: 'Periodo', type: 'text', width: 140 },
      {
        key: 'ipc_nacional',
        label: 'IPC Nacional',
        type: 'numeric',
        width: 140,
        className: 'htRight htNumeric text-right',
        numericFormat: { pattern: '0.0000' }
      },
      { key: 'fuente', label: 'Fuente', type: 'text', width: 160, readOnly: true }
    ],
    []
  )

  const isDirty = useMemo(() => {
    return JSON.stringify(compactRows(rows)) !== JSON.stringify(compactRows(originalRows))
  }, [rows, originalRows])

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const mapApiRows = (data) => {
    if (!Array.isArray(data)) return ensureTrailingBlank([])
    const mapped = data.map((row) => {
      const periodo = row.periodo || ''
      return {
        id: periodo || row.name || buildEmptyRow().id,
        name: periodo || row.name,
        periodo,
        ipc_nacional: normalizeNumber(row.ipc_nacional),
        fuente: row.fuente || 'FACPCE'
      }
    })
    return ensureTrailingBlank(mapped)
  }

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetchWithAuth(API_ROUTES.inflationIndices.list)
      if (!response.ok) {
        showNotification('No se pudieron cargar los indices de inflacion', 'error')
        return
      }
      const payload = await response.json()
      if (!payload.success) {
        showNotification(payload.message || 'Error cargando indices', 'error')
        return
      }
      const mapped = mapApiRows(payload.data || [])
      setRows(mapped)
      setOriginalRows(compactRows(mapped))
    } catch (err) {
      console.error('Error fetching inflation indices', err)
      showNotification('Error de conexion al cargar indices', 'error')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth, showNotification])

  useEffect(() => {
    loadData()
  }, [loadData])

  const sendTableConfiguration = useCallback(() => {
    if (!iframeReady || !iframeRef.current || !iframeRef.current.contentWindow) return
    const tableData = (rows || []).map((row) => [
      row.periodo || '',
      row.ipc_nacional === '' || row.ipc_nacional === null || row.ipc_nacional === undefined
        ? ''
        : Number(row.ipc_nacional),
      row.fuente || ''
    ])
    const rowIds = (rows || []).map((row) => row.id || row.name || row.periodo || '')
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'ht-configure-table',
        columns,
        data: tableData,
        rowIds
      },
      '*'
    )
  }, [columns, iframeReady, rows])

  useEffect(() => {
    sendTableConfiguration()
  }, [sendTableConfiguration])

  useEffect(() => {
    const handler = (event) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      const msg = event.data || {}
      if (msg.type === 'ht-data-changed' && Array.isArray(msg.data)) {
        const incomingRows = msg.data.map((rowArr, idx) => {
          const current = rowsRef.current[idx] || buildEmptyRow()
          return {
            ...current,
            id: (msg.rowIds && msg.rowIds[idx]) || current.id || current.name || current.periodo || buildEmptyRow().id,
            periodo: (rowArr[0] || '').toString().trim(),
            ipc_nacional: normalizeNumber(rowArr[1]),
            fuente: (rowArr[2] || current.fuente || 'FACPCE').toString()
          }
        })
        setRows(ensureTrailingBlank(incomingRows))
      }
      if (msg.type === 'ht-rows-removed' && Array.isArray(msg.removedRows)) {
        setRows((prev) => {
          const filtered = prev.filter((_, idx) => !msg.removedRows.includes(idx))
          return ensureTrailingBlank(filtered)
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleAddRow = () => {
    setRows((prev) => ensureTrailingBlank([...prev, buildEmptyRow()]))
  }

  const handleSave = async () => {
    const payloadRows = compactRows(rows)
    if (payloadRows.length === 0) {
      showNotification('No hay datos para guardar', 'warning')
      return
    }
    const invalidRow = payloadRows.find(
      (row) => !row.periodo || row.ipc_nacional === '' || row.ipc_nacional === null
    )
    if (invalidRow) {
      showNotification('Completa periodo e IPC en todas las filas', 'error')
      return
    }

    try {
      setSaving(true)
      const response = await fetchWithAuth(API_ROUTES.inflationIndices.bulk, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payloadRows })
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        showNotification(payload.message || 'No se pudieron guardar los indices', 'error')
        return
      }

      const updatedRows = mapApiRows(payload.data?.rows || payload.data || [])
      setRows(updatedRows)
      setOriginalRows(compactRows(updatedRows))

      if (payload.data?.failed && payload.data.failed.length) {
        showNotification(
          `${payload.message || 'Guardado parcial'} (errores: ${payload.data.failed.length})`,
          'warning'
        )
      } else {
        showNotification(payload.message || 'Indices guardados', 'success')
      }
    } catch (err) {
      console.error('Error saving inflation indices', err)
      showNotification('Error al guardar los indices', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white/80 p-6 shadow-xl border border-gray-200/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-indigo-50 p-3 border border-indigo-100">
              <TrendingUp className="h-6 w-6 text-indigo-700" />
            </div>
            <div>
              <div className="text-xl font-black text-gray-900">Indices de inflacion (Argentina)</div>
              <p className="text-sm text-gray-600">
                Serie mensual de IPC nacional usada para ajustes por inflacion. Fuente oficial:{' '}
                <a
                  href="https://www.facpce.org.ar/indices-facpce/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-indigo-700 font-semibold hover:underline"
                >
                  FACPCE
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary flex items-center gap-2"
              onClick={loadData}
              disabled={loading || saving}
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recargar
            </button>
            <button
              type="button"
              className="btn-secondary flex items-center gap-2"
              onClick={handleAddRow}
              disabled={saving}
            >
              <Plus className="h-4 w-4" />
              Agregar fila
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-2"
              onClick={handleSave}
              disabled={saving || !isDirty}
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 border border-gray-200">
            <AlertCircle className="h-3 w-3 text-gray-500" />
            Usa formato ene-93 o YYYY-MM para el periodo.
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 border border-green-200 text-green-700">
            {compactRows(rows).length} registros
          </span>
          {isDirty && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
              Cambios sin guardar
            </span>
          )}
        </div>
      </div>

      <div className="rounded-3xl bg-white/80 p-4 shadow-lg border border-gray-200/70">
        <div className="h-[560px] rounded-2xl border border-gray-100 shadow-inner overflow-hidden">
          <iframe
            ref={iframeRef}
            src="/handsontable-demo.html"
            title="Tabla indices inflacion"
            className="w-full h-full border-0"
            onLoad={() => setIframeReady(true)}
          />
        </div>
      </div>
    </div>
  )
}
