import React, { useContext, useState } from 'react'
import { FileSpreadsheet, FileText, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

import { AuthContext } from '../../../AuthProvider'
import API_ROUTES from '../../../apiRoutes'

const MONTH_OPTIONS = [
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

const REPORT_TYPES = [
  { value: 'compras', label: 'Compras' },
  { value: 'ventas', label: 'Ventas' },
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

export default function IvaReportCard() {
  const { fetchWithAuth } = useContext(AuthContext)
  const initialMonth = String(new Date().getMonth() + 1)

  const [reportType, setReportType] = useState('compras')
  const [selectedMonth, setSelectedMonth] = useState(initialMonth)
  const [selectedYear, setSelectedYear] = useState(String(currentYear))
  const [downloading, setDownloading] = useState(null)
  const [status, setStatus] = useState(null)

  const endpoint = API_ROUTES?.reports?.iva || '/api/reports/iva'

  const monthIsSelected = Boolean(selectedMonth)
  const yearIsSelected = Boolean(selectedYear)
  const readyToDownload = monthIsSelected && yearIsSelected && Boolean(reportType)

  const handleDownload = async (format) => {
    if (!readyToDownload || downloading) return
    setStatus(null)
    setDownloading(format)
    try {
      const params = new URLSearchParams({
        type: reportType,
        month: selectedMonth,
        year: selectedYear,
        format,
      })

      const url = `${endpoint}?${params.toString()}`
      const response = await fetchWithAuth(url, { method: 'GET' })

      if (!response.ok) {
        let message = 'No se pudo descargar el libro IVA'
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
      const label = reportType === 'ventas' ? 'IVA_Ventas' : 'IVA_Compras'
      const paddedMonth = selectedMonth.toString().padStart(2, '0')
      const filename = `${label}_${selectedYear}-${paddedMonth}.${suffix}`

      const link = document.createElement('a')
      link.href = downloadUrl
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)

      setStatus({ type: 'success', message: `Descargaste ${label} ${selectedYear}-${paddedMonth}` })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Descarga fallida' })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="w-full lg:max-w-3xl xl:w-1/2">
      <div className="bg-white/75 backdrop-blur-xl shadow-xl rounded-3xl border border-gray-200/40 p-5 space-y-5">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.35em] text-gray-500 font-semibold">Impositivos</p>
          <h2 className="text-2xl font-black text-gray-900">Reportes IVA</h2>
          <p className="text-sm text-gray-600">Emiti los libros IVA de la compania. Se excluyen los comprobantes con letra X.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Tipo</label>
            <select
              className="w-full border border-gray-200 rounded-2xl px-3 py-2.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={reportType}
              onChange={(event) => setReportType(event.target.value)}
            >
              {REPORT_TYPES.map((option) => (
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
              onChange={(event) => setSelectedMonth(event.target.value)}
            >
              {MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Anio</label>
            <select
              className="w-full border border-gray-200 rounded-2xl px-3 py-2.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
            >
              {YEAR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleDownload('pdf')}
              disabled={!readyToDownload || downloading === 'xlsx' || downloading === 'pdf'}
              className={`${ICON_BUTTON_BASE} ${
                readyToDownload ? 'border-gray-200 text-blue-600 hover:bg-blue-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'
              }`}
              aria-label="Descargar libro IVA en PDF"
            >
              {downloading === 'pdf' ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => handleDownload('xlsx')}
              disabled={!readyToDownload || downloading === 'pdf' || downloading === 'xlsx'}
              className={`${ICON_BUTTON_BASE} ${
                readyToDownload ? 'border-gray-200 text-emerald-600 hover:bg-emerald-50' : 'border-gray-100 text-gray-300 cursor-not-allowed'
              }`}
              aria-label="Descargar libro IVA en Excel"
            >
              {downloading === 'xlsx' ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
            </button>
          </div>
        </div>

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
      </div>
    </div>
  )
}
