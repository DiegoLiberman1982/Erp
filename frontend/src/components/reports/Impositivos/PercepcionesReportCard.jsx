import React, { useContext, useState, useEffect, useMemo } from 'react'
import { FileSpreadsheet, FileText, Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Filter } from 'lucide-react'

import { AuthContext } from '../../../AuthProvider'
import API_ROUTES from '../../../apiRoutes'

const MONTH_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: '1', label: 'Enero' },
  { value: '2', label: 'Febrero' },
  { value: '3', label: 'Marzo' },
  { value: '4', label: 'Abril' },
  { value: '5', label: 'Mayo' },
  { value: '6', label: 'Junio' },
  { value: '7', label: 'Julio' },
  { value: '8', label: 'Agosto' },
  { value: '9', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' },
]

const PERCEPTION_TYPES = [
  { value: '', label: 'Todos los tipos' },
  { value: 'INGRESOS_BRUTOS', label: 'Ingresos Brutos' },
  { value: 'IVA', label: 'IVA' },
  { value: 'GANANCIAS', label: 'Ganancias' },
]

const currentYear = new Date().getFullYear()

const buildYearOptions = (baseYear, span = 6) => {
  return Array.from({ length: span }).map((_, idx) => {
    const yearValue = String(baseYear - idx)
    return { value: yearValue, label: yearValue }
  })
}

const YEAR_OPTIONS = buildYearOptions(currentYear, 8)

const ICON_BUTTON_BASE =
  'inline-flex items-center justify-center rounded-full border transition-colors w-11 h-11 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'

// Formateador de moneda
const formatCurrency = (value) => {
  if (value === null || value === undefined) return '-'
  const num = parseFloat(value)
  if (isNaN(num)) return '-'
  return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Componente de resumen por tipo
function PerceptionTypeSummary({ data }) {
  const summaryByType = useMemo(() => {
    if (!data?.rows) return []
    
    const grouped = {}
    for (const row of data.rows) {
      const type = row.perception_type || 'SIN_TIPO'
      if (!grouped[type]) {
        grouped[type] = { type, count: 0, total: 0 }
      }
      grouped[type].count += 1
      grouped[type].total += parseFloat(row.total_amount) || 0
    }
    
    return Object.values(grouped).sort((a, b) => b.total - a.total)
  }, [data])

  if (!summaryByType.length) return null

  const typeLabels = {
    'INGRESOS_BRUTOS': 'Ingresos Brutos',
    'IVA': 'IVA',
    'GANANCIAS': 'Ganancias',
    'SIN_TIPO': 'Sin tipo'
  }

  const typeColors = {
    'INGRESOS_BRUTOS': 'bg-blue-100 text-blue-800 border-blue-200',
    'IVA': 'bg-purple-100 text-purple-800 border-purple-200',
    'GANANCIAS': 'bg-amber-100 text-amber-800 border-amber-200',
    'SIN_TIPO': 'bg-gray-100 text-gray-800 border-gray-200'
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {summaryByType.map(({ type, count, total }) => (
        <div 
          key={type} 
          className={`rounded-2xl border px-4 py-3 ${typeColors[type] || typeColors['SIN_TIPO']}`}
        >
          <div className="text-xs uppercase tracking-widest font-semibold opacity-70">
            {typeLabels[type] || type}
          </div>
          <div className="text-xl font-black mt-1">
            $ {formatCurrency(total)}
          </div>
          <div className="text-xs mt-1 opacity-70">
            {count} {count === 1 ? 'percepción' : 'percepciones'}
          </div>
        </div>
      ))}
    </div>
  )
}

// Componente de resumen por provincia (solo para IIBB)
function PerceptionProvinceSummary({ data, expanded, onToggle }) {
  const summaryByProvince = useMemo(() => {
    if (!data?.rows) return []
    
    const grouped = {}
    for (const row of data.rows) {
      if (row.perception_type !== 'INGRESOS_BRUTOS') continue
      
      const province = row.province_name || row.province_code || 'Sin provincia'
      if (!grouped[province]) {
        grouped[province] = { province, count: 0, total: 0 }
      }
      grouped[province].count += 1
      grouped[province].total += parseFloat(row.total_amount) || 0
    }
    
    return Object.values(grouped).sort((a, b) => b.total - a.total)
  }, [data])

  if (!summaryByProvince.length) return null

  const visibleItems = expanded ? summaryByProvince : summaryByProvince.slice(0, 5)
  const hasMore = summaryByProvince.length > 5

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-widest">
          Percepciones IIBB por Provincia
        </h4>
        {hasMore && (
          <button
            onClick={onToggle}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                Ver todas ({summaryByProvince.length})
              </>
            )}
          </button>
        )}
      </div>
      
      <div className="grid gap-2">
        {visibleItems.map(({ province, count, total }) => (
          <div 
            key={province}
            className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2 border border-gray-100"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-900">{province}</span>
              <span className="text-xs text-gray-500">({count})</span>
            </div>
            <span className="text-sm font-bold text-gray-900">
              $ {formatCurrency(total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Tabla de detalle de percepciones
function PerceptionDetailTable({ data, loading }) {
  const [sortField, setSortField] = useState('posting_date')
  const [sortAsc, setSortAsc] = useState(false)

  const sortedRows = useMemo(() => {
    if (!data?.rows) return []
    
    return [...data.rows].sort((a, b) => {
      let aVal = a[sortField]
      let bVal = b[sortField]
      
      if (sortField === 'total_amount' || sortField === 'percentage') {
        aVal = parseFloat(aVal) || 0
        bVal = parseFloat(bVal) || 0
      }
      
      if (aVal < bVal) return sortAsc ? -1 : 1
      if (aVal > bVal) return sortAsc ? 1 : -1
      return 0
    })
  }, [data, sortField, sortAsc])

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Cargando percepciones...</span>
      </div>
    )
  }

  if (!sortedRows.length) {
    return (
      <div className="text-center py-12 text-gray-500">
        No se encontraron percepciones para el período seleccionado
      </div>
    )
  }

  const typeLabels = {
    'INGRESOS_BRUTOS': 'IIBB',
    'IVA': 'IVA',
    'GANANCIAS': 'Ganancias'
  }

  const typeBadgeColors = {
    'INGRESOS_BRUTOS': 'bg-blue-100 text-blue-700',
    'IVA': 'bg-purple-100 text-purple-700',
    'GANANCIAS': 'bg-amber-100 text-amber-700'
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th 
              className="text-left py-3 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
              onClick={() => handleSort('posting_date')}
            >
              Fecha {sortField === 'posting_date' && (sortAsc ? '↑' : '↓')}
            </th>
            <th 
              className="text-left py-3 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
              onClick={() => handleSort('document_name')}
            >
              Comprobante {sortField === 'document_name' && (sortAsc ? '↑' : '↓')}
            </th>
            <th 
              className="text-left py-3 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
              onClick={() => handleSort('supplier_name')}
            >
              Proveedor {sortField === 'supplier_name' && (sortAsc ? '↑' : '↓')}
            </th>
            <th 
              className="text-center py-3 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
              onClick={() => handleSort('perception_type')}
            >
              Tipo {sortField === 'perception_type' && (sortAsc ? '↑' : '↓')}
            </th>
            <th 
              className="text-left py-3 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
              onClick={() => handleSort('province_name')}
            >
              Provincia {sortField === 'province_name' && (sortAsc ? '↑' : '↓')}
            </th>
            <th 
              className="text-right py-3 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
              onClick={() => handleSort('percentage')}
            >
              % {sortField === 'percentage' && (sortAsc ? '↑' : '↓')}
            </th>
            <th 
              className="text-right py-3 px-2 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
              onClick={() => handleSort('total_amount')}
            >
              Importe {sortField === 'total_amount' && (sortAsc ? '↑' : '↓')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, idx) => (
            <tr 
              key={`${row.document_name}-${row.perception_type}-${idx}`}
              className={`border-b border-gray-100 hover:bg-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
            >
              <td className="py-2 px-2 text-gray-900">{row.posting_date}</td>
              <td className="py-2 px-2 text-gray-900 font-medium">{row.document_label || row.document_name}</td>
              <td className="py-2 px-2 text-gray-700">{row.supplier_name || '-'}</td>
              <td className="py-2 px-2 text-center">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${typeBadgeColors[row.perception_type] || 'bg-gray-100 text-gray-700'}`}>
                  {typeLabels[row.perception_type] || row.perception_type}
                </span>
              </td>
              <td className="py-2 px-2 text-gray-700">
                {row.perception_type === 'INGRESOS_BRUTOS' 
                  ? (row.province_name || row.province_code || '-')
                  : '-'
                }
              </td>
              <td className="py-2 px-2 text-right text-gray-700">
                {row.percentage ? `${row.percentage}%` : '-'}
              </td>
              <td className="py-2 px-2 text-right font-semibold text-gray-900">
                $ {formatCurrency(row.total_amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 font-semibold">
            <td colSpan={6} className="py-3 px-2 text-right text-gray-700">
              Total ({sortedRows.length} percepciones):
            </td>
            <td className="py-3 px-2 text-right text-gray-900">
              $ {formatCurrency(data?.totals?.total || 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default function PercepcionesReportCard() {
  const { fetchWithAuth } = useContext(AuthContext)

  const [perceptionType, setPerceptionType] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedYear, setSelectedYear] = useState(String(currentYear))
  const [downloading, setDownloading] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [provincesExpanded, setProvincesExpanded] = useState(false)
  const [showDetail, setShowDetail] = useState(false)

  const endpoint = API_ROUTES?.reports?.percepciones || '/api/reports/percepciones'

  // Cargar datos cuando cambian los filtros
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setStatus(null)
      
      try {
        const params = new URLSearchParams({ year: selectedYear })
        if (selectedMonth) params.append('month', selectedMonth)
        if (perceptionType) params.append('perception_type', perceptionType)
        
        const response = await fetchWithAuth(`${endpoint}?${params.toString()}`)
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData?.message || 'Error al cargar percepciones')
        }
        
        const result = await response.json()
        if (result.success) {
          setData(result.data)
        } else {
          throw new Error(result.message || 'Error al cargar percepciones')
        }
      } catch (error) {
        setStatus({ type: 'error', message: error.message })
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [selectedMonth, selectedYear, perceptionType, fetchWithAuth, endpoint])

  const handleDownload = async (format) => {
    if (downloading) return
    setStatus(null)
    setDownloading(format)
    
    try {
      const params = new URLSearchParams({
        year: selectedYear,
        format,
      })
      if (selectedMonth) params.append('month', selectedMonth)
      if (perceptionType) params.append('perception_type', perceptionType)

      const url = `${endpoint}?${params.toString()}`
      const response = await fetchWithAuth(url, { method: 'GET' })

      if (!response.ok) {
        let message = 'No se pudo descargar el reporte'
        try {
          const errorData = await response.json()
          message = errorData?.message || message
        } catch (parseError) {
          // ignore json parse errors
        }
        throw new Error(message)
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const suffix = format === 'pdf' ? 'pdf' : 'xlsx'
      const periodLabel = selectedMonth 
        ? `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}`
        : selectedYear
      const filename = `Percepciones_${periodLabel}.${suffix}`

      const link = document.createElement('a')
      link.href = downloadUrl
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)

      setStatus({ type: 'success', message: `Reporte descargado: ${filename}` })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Descarga fallida' })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="w-full">
      <div className="bg-white/75 backdrop-blur-xl shadow-xl rounded-3xl border border-gray-200/40 p-5 space-y-5">
        {/* Header */}
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.35em] text-gray-500 font-semibold">Impositivos</p>
          <h2 className="text-2xl font-black text-gray-900">Reporte de Percepciones</h2>
          <p className="text-sm text-gray-600">
            Visualiza las percepciones sufridas (IIBB, IVA, Ganancias) en facturas de compra.
          </p>
        </div>

        {/* Filtros */}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Tipo</label>
            <select
              className="w-full border border-gray-200 rounded-2xl px-3 py-2.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={perceptionType}
              onChange={(e) => setPerceptionType(e.target.value)}
            >
              {PERCEPTION_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Mes</label>
            <select
              className="w-full border border-gray-200 rounded-2xl px-3 py-2.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Año</label>
            <select
              className="w-full border border-gray-200 rounded-2xl px-3 py-2.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {YEAR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Descargar</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleDownload('pdf')}
                disabled={loading || downloading}
                className={`${ICON_BUTTON_BASE} flex-1 ${
                  !loading ? 'border-gray-200 text-blue-600 hover:bg-blue-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'
                }`}
                aria-label="Descargar en PDF"
              >
                {downloading === 'pdf' ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => handleDownload('xlsx')}
                disabled={loading || downloading}
                className={`${ICON_BUTTON_BASE} flex-1 ${
                  !loading ? 'border-gray-200 text-emerald-600 hover:bg-emerald-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'
                }`}
                aria-label="Descargar en Excel"
              >
                {downloading === 'xlsx' ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Status message */}
        {status && (
          <div
            className={`flex items-center gap-2 rounded-2xl px-4 py-3 ${
              status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'
            }`}
          >
            {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span className="text-sm">{status.message}</span>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-500">Cargando datos...</span>
          </div>
        )}

        {/* Resumen por tipo */}
        {!loading && data && (
          <PerceptionTypeSummary data={data} />
        )}

        {/* Resumen por provincia */}
        {!loading && data && (
          <PerceptionProvinceSummary 
            data={data} 
            expanded={provincesExpanded}
            onToggle={() => setProvincesExpanded(!provincesExpanded)}
          />
        )}

        {/* Toggle para ver detalle */}
        {!loading && data?.rows?.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              {showDetail ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  Ocultar detalle
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  Ver detalle de percepciones ({data.rows.length})
                </>
              )}
            </button>
          </div>
        )}

        {/* Tabla de detalle */}
        {!loading && showDetail && data && (
          <PerceptionDetailTable data={data} loading={loading} />
        )}
      </div>
    </div>
  )
}
