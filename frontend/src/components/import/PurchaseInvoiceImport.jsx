import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Edit2, FileSpreadsheet, FileText, ListChecks, Plus, Save, Trash2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import afipCodes from '../../../../shared/afip_codes.json'
import loadingGif from '../../media/Carga1.gif'
import useTaxTemplates from '../../hooks/useTaxTemplates'
import { getIvaRatesFromTemplates } from '../../utils/taxTemplates'
import Modal from '../Modal.jsx'
import ProvinciaSvgIcon from '../iconos/ProvinciaSvgIcon'

const PROVINCE_MAP = {
  'AR-B': 'Buenos Aires',
  'AR-C': 'CABA',
  'AR-K': 'Catamarca',
  'AR-H': 'Chaco',
  'AR-U': 'Chubut',
  'AR-X': 'Córdoba',
  'AR-W': 'Corrientes',
  'AR-E': 'Entre Ríos',
  'AR-P': 'Formosa',
  'AR-Y': 'Jujuy',
  'AR-L': 'La Pampa',
  'AR-F': 'La Rioja',
  'AR-M': 'Mendoza',
  'AR-N': 'Misiones',
  'AR-Q': 'Neuquén',
  'AR-R': 'Río Negro',
  'AR-A': 'Salta',
  'AR-J': 'San Juan',
  'AR-D': 'San Luis',
  'AR-Z': 'Santa Cruz',
  'AR-S': 'Santa Fe',
  'AR-G': 'Santiago del Estero',
  'AR-V': 'Tierra del Fuego',
  'AR-T': 'Tucumán'
}

const PROVINCE_OPTIONS = Object.entries(PROVINCE_MAP).map(([code, name]) => ({ code, name }))

const ProvinceSelect = ({ value, onChange, placeholder = 'Seleccionar...' }) => {
  const [isOpen, setIsOpen] = useState(false)
  const selectRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (selectRef.current && !selectRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedName = value ? (PROVINCE_MAP[value] || value) : ''

  return (
    <div ref={selectRef} className="relative">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent transition h-7 bg-white cursor-pointer flex items-center justify-between"
      >
        <div className="flex items-center gap-2 min-w-0">
          {value ? <ProvinciaSvgIcon provinciaName={selectedName} size={14} /> : null}
          <span className="truncate text-gray-700">{selectedName || placeholder}</span>
        </div>
        <span className="text-gray-500">▾</span>
      </div>
      {isOpen && (
        <div className="absolute top-full left-0 bg-white border border-gray-300 rounded-md shadow-lg z-50 max-h-56 overflow-y-auto w-max min-w-full">
          <div
            onClick={() => { onChange(''); setIsOpen(false) }}
            className="px-2 py-1 text-xs hover:bg-gray-100 cursor-pointer"
          >
            <span>{placeholder}</span>
          </div>
          {PROVINCE_OPTIONS.map((opt) => (
            <div
              key={opt.code}
              onClick={() => { onChange(opt.code); setIsOpen(false) }}
              className="px-2 py-1 text-xs hover:bg-gray-100 cursor-pointer flex items-center gap-2"
            >
              <ProvinciaSvgIcon provinciaName={opt.name} size={14} />
              <span>{opt.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const headerAliasesCsv = {
  'fecha de emisi¢n': 'fecha_emision',
  'fecha de emisión': 'fecha_emision',
  'tipo de comprobante': 'tipo_comprobante',
  'punto de venta': 'punto_venta',
  'n£mero de comprobante': 'numero_desde',
  'número de comprobante': 'numero_desde',
  'tipo doc. vendedor': 'tipo_doc_vendedor',
  'tipo doc vendedor': 'tipo_doc_vendedor',
  'nro. doc. vendedor': 'nro_doc_vendedor',
  'nro doc vendedor': 'nro_doc_vendedor',
  'denominaci¢n vendedor': 'denominacion_vendedor',
  'denominación vendedor': 'denominacion_vendedor',
  'importe total': 'importe_total',
  'moneda original': 'moneda',
  'tipo de cambio': 'tipo_cambio',
  'importe no gravado': 'neto_no_gravado',
  'importe exento': 'exentas',
  'cr‚dito fiscal computable': 'total_iva',
  'crédito fiscal computable': 'total_iva',
  'importe de per. o pagos a cta. de otros imp. nac.': 'percepcion_otros_imp_nac',
  'importe de percepciones de ingresos brutos': 'percepcion_iibb',
  'importe de impuestos municipales': 'impuestos_municipales',
  'importe de percepciones o pagos a cuenta de iva': 'percepcion_iva',
  'importe de impuestos internos': 'impuestos_internos',
  'importe otros tributos': 'otros_tributos',
  'neto gravado iva 0%': 'neto_iva_0',
  'neto gravado iva 2,5%': 'neto_iva_25',
  'neto gravado iva 5%': 'neto_iva_5',
  'neto gravado iva 10,5%': 'neto_iva_105',
  'neto gravado iva 21%': 'neto_iva_21',
  'neto gravado iva 27%': 'neto_iva_27',
  'total neto gravado': 'neto_total',
  'total iva': 'total_iva'
}

const headerAliasesXlsx = {
  'fecha': 'fecha_emision',
  'tipo': 'tipo_comprobante',
  'punto de venta': 'punto_venta',
  'número desde': 'numero_desde',
  'numero desde': 'numero_desde',
  'número hasta': 'numero_hasta',
  'numero hasta': 'numero_hasta',
  'cód. autorización': 'cod_autorizacion',
  'cod. autorización': 'cod_autorizacion',
  'cod. autorizacion': 'cod_autorizacion',
  'tipo doc. emisor': 'tipo_doc_vendedor',
  'nro. doc. emisor': 'nro_doc_vendedor',
  'denominación emisor': 'denominacion_vendedor',
  'tipo cambio': 'tipo_cambio',
  'moneda': 'moneda',
  'imp. neto gravado': 'neto_total',
  'imp. neto no gravado': 'neto_no_gravado',
  'imp. op. exentas': 'exentas',
  'otros tributos': 'otros_tributos',
  'iva': 'total_iva',
  'imp. total': 'importe_total'
}

const normalizeHeader = (header) => {
  if (!header) return ''
  return String(header)
    .toLowerCase()
    .replace(/"/g, '')
    .trim()
}

const parseDecimal = (value) => {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'number') return Number.isFinite(value) ? value : ''
  const raw = String(value).trim()
  if (!raw) return ''
  const normalized = raw.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : ''
}

const parseTipoComprobante = (value) => {
  if (value === undefined || value === null) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const match = raw.match(/^(\d+)/)
  return match ? match[1] : raw
}

const getAfipComprobanteMeta = (tipoComprobante) => {
  const code = String(tipoComprobante || '').trim()
  if (!code) return null
  const padded = code.padStart(3, '0')
  const meta = afipCodes.comprobantes ? afipCodes.comprobantes[padded] : null
  if (!meta) return null
  return {
    tipo: meta.tipo ? String(meta.tipo).toUpperCase() : null,
    letra: meta.letra ? String(meta.letra).toUpperCase() : null,
    description: meta.description || null
  }
}

const isMonotributoLetraC = (tipoComprobante) => {
  const meta = getAfipComprobanteMeta(tipoComprobante)
  return !!meta && meta.letra === 'C'
}

const DOC_TYPE_LABEL_TO_CODE = {
  cuit: '80',
  cuil: '86',
  dni: '96'
}

const parseDocType = (value) => {
  if (!value) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  if (/^\d+$/.test(raw)) return raw
  const normalized = raw.toLowerCase()
  return DOC_TYPE_LABEL_TO_CODE[normalized] || raw
}

const KNOWN_IVA_RATES = [0, 2.5, 5, 10.5, 21, 27]

const guessIvaRate = (neto, iva) => {
  const net = Number(neto || 0)
  const tax = Number(iva || 0)
  if (!Number.isFinite(net) || !Number.isFinite(tax) || net === 0) {
    return null
  }
  const rawRate = (tax / net) * 100
  let best = null
  let bestDiff = Infinity
  KNOWN_IVA_RATES.forEach(rate => {
    const diff = Math.abs(rawRate - rate)
    if (diff < bestDiff) {
      bestDiff = diff
      best = rate
    }
  })
  return bestDiff <= 0.3 ? best : null
}

const getNetColumnKeyForRate = (rate) => {
  const numeric = Number(String(rate).replace(',', '.'))
  if (!Number.isFinite(numeric)) return null
  const normalized = numeric % 1 === 0 ? numeric.toString() : numeric.toString().replace('.', '')
  return `neto_iva_${normalized}`
}

const isRateAvailable = (rate, availableRates = []) => {
  const numeric = Number(rate)
  if (!Number.isFinite(numeric)) return false
  return availableRates.some(r => Math.abs(Number(r) - numeric) <= 0.0001)
}

const parseCsvContent = (content) => {
  if (!content) return []
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const delimiter = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(delimiter).map(h => normalizeHeader(h)).filter(Boolean)

  const rows = lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(delimiter).map(cell => cell.replace(/^"+|"+$/g, '').trim())
    const row = { id: rowIndex + 1 }

    headers.forEach((header, idx) => {
      const key = headerAliasesCsv[header] || header.replace(/\s+/g, '_')
      const value = cells[idx] ?? ''

      const numericKeys = [
        'tipo_cambio',
        'neto_iva_0',
        'neto_iva_25',
        'neto_iva_5',
        'neto_iva_105',
        'neto_iva_21',
        'neto_iva_27',
        'neto_total',
        'neto_no_gravado',
        'exentas',
        'percepcion_otros_imp_nac',
        'percepcion_iibb',
        'impuestos_municipales',
        'percepcion_iva',
        'impuestos_internos',
        'otros_tributos',
        'total_iva',
        'importe_total'
      ]

      if (numericKeys.includes(key)) {
        row[key] = parseDecimal(value)
      } else if (key === 'tipo_comprobante') {
        row[key] = parseTipoComprobante(value)
      } else if (key === 'tipo_doc_vendedor') {
        row[key] = parseDocType(value)
      } else if (key === 'fecha_emision' && value) {
        const parts = String(value).split('-')
        if (parts.length === 3) {
          row[key] = `${parts[2]}/${parts[1]}/${parts[0]}`
        } else {
          row[key] = value
        }
      } else {
        row[key] = value
      }
    })

    return row
  })

  return rows.filter(row => Object.values(row).some(v => v !== '' && v !== undefined))
}

const parseXlsxContent = (arrayBuffer) => {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const sheetName = workbook.SheetNames?.[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
  if (!Array.isArray(grid) || grid.length === 0) return []

  let headerRowIndex = -1
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const row = grid[i] || []
    const normalized = row.map(cell => normalizeHeader(cell))
    if (normalized.includes('fecha') && normalized.includes('tipo') && normalized.includes('punto de venta')) {
      headerRowIndex = i
      break
    }
  }
  if (headerRowIndex === -1) return []

  const headerRow = grid[headerRowIndex].map(cell => normalizeHeader(cell))
  const dataRows = grid.slice(headerRowIndex + 1).filter(r => Array.isArray(r) && r.some(v => v !== '' && v != null))

  const rows = dataRows.map((values, idx) => {
    const row = { id: idx + 1 }
    headerRow.forEach((header, colIndex) => {
      const key = headerAliasesXlsx[header] || header.replace(/\s+/g, '_')
      const value = values[colIndex] ?? ''

      const numericKeys = [
        'punto_venta',
        'numero_desde',
        'numero_hasta',
        'tipo_cambio',
        'neto_total',
        'neto_no_gravado',
        'exentas',
        'otros_tributos',
        'total_iva',
        'importe_total',
        'nro_doc_vendedor',
        'cod_autorizacion'
      ]

      if (numericKeys.includes(key)) {
        row[key] = parseDecimal(value)
      } else if (key === 'tipo_comprobante') {
        row[key] = parseTipoComprobante(value)
      } else if (key === 'tipo_doc_vendedor') {
        row[key] = parseDocType(value)
      } else {
        row[key] = value
      }
    })

    // Derivar netos por alícuota si el XLSX no los trae.
    const guessedRate = guessIvaRate(row.neto_total, row.total_iva)
    if (row.neto_total && guessedRate !== null) {
      const netKey = getNetColumnKeyForRate(guessedRate)
      if (netKey) {
        row[netKey] = row.neto_total
      }
    } else if (row.neto_total && !row.total_iva) {
      row.neto_iva_0 = row.neto_total
    }

    if (!row.moneda) {
      row.moneda = '$'
    }
    if (!row.tipo_cambio) {
      row.tipo_cambio = 1
    }

    return row
  })

  return rows
}

// Build afipDocTypes from shared/afip_codes.json (document_types)
const afipDocTypes = (afipCodes.document_types || []).map(dt => ({
  value: String(dt.code),
  label: `${dt.code} - ${dt.description}`
}))

export default function PurchaseInvoiceImport() {
  const { isAuthenticated, activeCompany, fetchWithAuth } = useContext(AuthContext)
  const { showSuccess, showWarning, showInfo, showError } = useNotification()
  const { templates: taxTemplates } = useTaxTemplates(fetchWithAuth)
  const ivaRates = useMemo(() => getIvaRatesFromTemplates(taxTemplates), [taxTemplates])

  const [dueDays, setDueDays] = useState(30)
  const [tableData, setTableData] = useState([])
  const tableDataRef = useRef([])
  const [fileName, setFileName] = useState('')
  const [isParsingFile, setIsParsingFile] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [rowIssues, setRowIssues] = useState([])
  const [ivaPreview, setIvaPreview] = useState({})
  const fileInputRef = useRef(null)
  const iframeRef = useRef(null)
  const [iframeReady, setIframeReady] = useState(false)

  useEffect(() => {
    tableDataRef.current = tableData
  }, [tableData])

  const resolveDocTypeCode = useCallback((value) => {
    if (!value) return ''
    const str = String(value).trim()
    const found = afipDocTypes.find(dt => dt.value === str || dt.label === str)
    if (found) return found.value
    const parts = str.split('-')
    if (parts.length > 0) return parts[0].trim()
    return str
  }, [])

  useEffect(() => {
    if (!tableData || tableData.length === 0) {
      setRowIssues([])
      setIvaPreview({})
      return
    }

    const issues = []
    tableData.forEach((row, idx) => {
      if (!row.tipo_comprobante || String(row.tipo_comprobante).trim() === '') {
        issues.push({ row: idx + 1, message: 'Tipo de comprobante requerido' })
      }
      if (!row.punto_venta || String(row.punto_venta).trim() === '') {
        issues.push({ row: idx + 1, message: 'Punto de venta requerido' })
      }
      if (!row.nro_doc_vendedor || String(row.nro_doc_vendedor).trim() === '') {
        issues.push({ row: idx + 1, message: 'CUIT/DNI del proveedor requerido' })
      }

      const tipoRaw = String(row.tipo_comprobante || '').trim()
      if (tipoRaw) {
        const tipoKey = tipoRaw.padStart(3, '0')
        if (!afipCodes?.comprobantes?.[tipoKey]) {
          issues.push({ row: idx + 1, message: `Tipo de comprobante AFIP no mapeado: ${tipoRaw}` })
        }
      }

      const hasAnyBreakdown = [
        row.neto_iva_0,
        row.neto_iva_25,
        row.neto_iva_5,
        row.neto_iva_105,
        row.neto_iva_21,
        row.neto_iva_27
      ].some(v => Number(v || 0) !== 0)

      const netoCero =
        Number(row.neto_iva_0 || 0) +
        Number(row.neto_no_gravado || 0) +
        Number(row.exentas || 0) +
        Number(row.otros_tributos || 0)

      if (netoCero !== 0 && !isRateAvailable(0, ivaRates)) {
        issues.push({ row: idx + 1, message: 'No hay Item Tax Template configurado para IVA 0%' })
      }

      const breakdownRates = [
        { key: 'neto_iva_25', rate: 2.5 },
        { key: 'neto_iva_5', rate: 5 },
        { key: 'neto_iva_105', rate: 10.5 },
        { key: 'neto_iva_21', rate: 21 },
        { key: 'neto_iva_27', rate: 27 }
      ]

      breakdownRates.forEach(({ key, rate }) => {
        if (Number(row[key] || 0) !== 0 && !isRateAvailable(rate, ivaRates)) {
          issues.push({ row: idx + 1, message: `No hay Item Tax Template configurado para IVA ${rate}%` })
        }
      })

      const percepcionOtros = Number(row.percepcion_otros_imp_nac || 0) || 0
      if (percepcionOtros > 0) {
        const tipo = String(row.percepcion_otros_tipo || 'IVA').trim().toUpperCase()
        if (tipo !== 'IVA' && tipo !== 'GANANCIAS') {
          issues.push({ row: idx + 1, message: 'Tipo de percepción Otros Imp. Nac. inválido (IVA o GANANCIAS)' })
        }
      }

      const percepcionIibb = Number(row.percepcion_iibb || 0) || 0
      if (percepcionIibb > 0) {
        const allocations = Array.isArray(row.percepcion_iibb_allocations) ? row.percepcion_iibb_allocations : []
        if (allocations.length === 0) {
          issues.push({ row: idx + 1, message: 'Debe configurar jurisdicción para percepción IIBB' })
        } else {
          const missingProvince = allocations.some(a => !a || !String(a.province_code || '').trim())
          if (missingProvince) {
            issues.push({ row: idx + 1, message: 'Debe seleccionar jurisdicción para percepción IIBB' })
          }
          const sum = allocations.reduce((acc, a) => acc + (Number(a?.total_amount || 0) || 0), 0)
          if (Math.abs(sum - percepcionIibb) > 0.01) {
            issues.push({ row: idx + 1, message: 'La suma de percepciones IIBB por provincia no coincide con el total' })
          }
        }
      }

      const otrosTributos = Number(row.otros_tributos || 0) || 0
      if (otrosTributos > 0) {
        const allocations = Array.isArray(row.otros_tributos_allocations) ? row.otros_tributos_allocations : []
        if (allocations.length === 0) {
          issues.push({ row: idx + 1, message: 'Debe clasificar Importe Otros Tributos (o dejarlo como OTRO)' })
        } else {
          const normalized = allocations.map(a => ({
            classification: String(a?.classification || '').trim().toUpperCase(),
            province_code: String(a?.province_code || '').trim(),
            total_amount: Number(a?.total_amount || 0) || 0
          })).filter(a => a.classification || a.province_code || a.total_amount)

          const validClasses = new Set(['OTRO', 'IIBB', 'IVA', 'GANANCIAS'])
          if (normalized.some(a => !validClasses.has(a.classification))) {
            issues.push({ row: idx + 1, message: 'Clasificación inválida en Otros Tributos' })
          }
          const missingProvince = normalized.some(a => a.classification === 'IIBB' && (Number(a.total_amount || 0) || 0) > 0 && !a.province_code)
          if (missingProvince) {
            issues.push({ row: idx + 1, message: 'Debe seleccionar jurisdicción para IIBB en Otros Tributos' })
          }
          const sum = normalized.reduce((acc, a) => acc + (Number(a?.total_amount || 0) || 0), 0)
          if (Math.abs(sum - otrosTributos) > 0.01) {
            issues.push({ row: idx + 1, message: 'La suma de Otros Tributos no coincide con el total' })
          }
        }
      }

      if (!hasAnyBreakdown && row.neto_total && row.total_iva) {
        const guessed = guessIvaRate(row.neto_total, row.total_iva)
        if (guessed === null) {
          issues.push({ row: idx + 1, message: 'No se pudo inferir alícuota de IVA (ajusta netos por tasa)' })
        } else if (!isRateAvailable(guessed, ivaRates)) {
          issues.push({ row: idx + 1, message: `No hay Item Tax Template configurado para IVA ${guessed}%` })
        }
      }
    })
    setRowIssues(issues)

    const rateDescriptors = ivaRates.map(rate => ({
      label: `${rate}%`,
      fieldKey: getNetColumnKeyForRate(rate)
    })).filter(desc => !!desc.fieldKey)

    const preview = {}
    rateDescriptors.forEach(({ label }) => {
      preview[label] = 0
    })
    preview['Exento/No Gravado'] = 0

    tableData.forEach(row => {
      const add = (key, val) => {
        const n = Number(val || 0)
        if (!Number.isFinite(n)) return
        preview[key] = (preview[key] || 0) + n
      }
      rateDescriptors.forEach(({ label, fieldKey }) => {
        add(label, row[fieldKey])
      })
      add('Exento/No Gravado', row.neto_no_gravado)
      add('Exento/No Gravado', row.exentas)
      add('Exento/No Gravado', row.otros_tributos)
    })
    setIvaPreview(preview)
  }, [tableData, ivaRates])

  const columns = useMemo(() => ([
    { key: 'fecha_emision', label: 'Fecha', type: 'date', width: 100, dateFormat: 'DD/MM/YYYY', correctFormat: true },
    { key: 'tipo_comprobante', label: 'Tipo Cbte', type: 'text', width: 90 },
    { key: 'punto_venta', label: 'Pto Venta', type: 'text', width: 90 },
    { key: 'numero_desde', label: 'Número', type: 'text', width: 110 },
    { key: 'numero_hasta', label: 'Número Hasta', type: 'text', width: 110 },
    { key: 'cod_autorizacion', label: 'CAE', type: 'text', width: 140 },
    { key: 'tipo_doc_vendedor', label: 'Tipo Doc', type: 'dropdown', options: afipDocTypes, width: 120 },
    { key: 'nro_doc_vendedor', label: 'CUIT/DNI', type: 'text', width: 120 },
    { key: 'denominacion_vendedor', label: 'Proveedor', type: 'text', width: 220 },
    { key: 'tipo_cambio', label: 'T.C.', type: 'numeric', width: 80 },
    { key: 'moneda', label: 'Mon', type: 'text', width: 60 },
    { key: 'neto_iva_0', label: 'N. 0%', type: 'numeric', width: 90 },
    { key: 'neto_no_gravado', label: 'No Gravado', type: 'numeric', width: 100 },
    { key: 'exentas', label: 'Exentas', type: 'numeric', width: 90 },
    { key: 'otros_tributos', label: 'Otros Trib.', type: 'numeric', width: 100 },
    { key: 'neto_iva_25', label: 'N. 2,5%', type: 'numeric', width: 90 },
    { key: 'neto_iva_5', label: 'N. 5%', type: 'numeric', width: 90 },
    { key: 'neto_iva_105', label: 'N. 10,5%', type: 'numeric', width: 90 },
    { key: 'neto_iva_21', label: 'N. 21%', type: 'numeric', width: 90 },
    { key: 'neto_iva_27', label: 'N. 27%', type: 'numeric', width: 90 },
    { key: 'neto_total', label: 'N. Total', type: 'numeric', width: 100, readonly: true },
    { key: 'total_iva', label: 'Total IVA', type: 'numeric', width: 100, readonly: true },
    { key: 'importe_total', label: 'Total', type: 'numeric', width: 100, readonly: true }
  ]), [])

  const handleFileUpload = useCallback((event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setIsParsingFile(true)

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')
        const parsed = isXlsx ? parseXlsxContent(reader.result) : parseCsvContent(reader.result)

        // Completar totals si faltan en XLSX (a veces vienen en blanco)
        const normalized = parsed.map(row => {
          const totalFromFile = row.importe_total !== '' && row.importe_total !== undefined ? row.importe_total : ''
          const hasAnyNetoDetail =
            Number(row.neto_iva_0 || 0) !== 0 ||
            Number(row.neto_iva_25 || 0) !== 0 ||
            Number(row.neto_iva_5 || 0) !== 0 ||
            Number(row.neto_iva_105 || 0) !== 0 ||
            Number(row.neto_iva_21 || 0) !== 0 ||
            Number(row.neto_iva_27 || 0) !== 0 ||
            Number(row.neto_no_gravado || 0) !== 0 ||
            Number(row.exentas || 0) !== 0 ||
            Number(row.otros_tributos || 0) !== 0

          const neto =
            Number(row.neto_iva_0 || 0) +
            Number(row.neto_iva_25 || 0) +
            Number(row.neto_iva_5 || 0) +
            Number(row.neto_iva_105 || 0) +
            Number(row.neto_iva_21 || 0) +
            Number(row.neto_iva_27 || 0)
          const nonTaxed =
            Number(row.neto_no_gravado || 0) +
            Number(row.exentas || 0) +
            Number(row.otros_tributos || 0) +
            Number(row.impuestos_municipales || 0) +
            Number(row.impuestos_internos || 0)

          const netoTotal = row.neto_total !== '' && row.neto_total !== undefined ? row.neto_total : (neto || '')
          const ivaTotal = row.total_iva !== '' && row.total_iva !== undefined ? row.total_iva : ''
          const total = totalFromFile
          const percepcionOtros = Number(row.percepcion_otros_imp_nac || 0) || 0
          const percepcionIibb = Number(row.percepcion_iibb || 0) || 0

          const existingAllocations = Array.isArray(row.percepcion_iibb_allocations)
            ? row.percepcion_iibb_allocations
            : []

          const treatAsLetraC = isMonotributoLetraC(row.tipo_comprobante)
          const shouldDeriveFromTotalOnly = treatAsLetraC && Number.isFinite(totalFromFile) && !hasAnyNetoDetail && (netoTotal === '' || netoTotal === undefined) && (ivaTotal === '' || ivaTotal === undefined)

          return {
            ...row,
            tipo_doc_vendedor: resolveDocTypeCode(row.tipo_doc_vendedor),
            neto_no_gravado: Number(row.neto_no_gravado || 0) + Number(row.impuestos_municipales || 0) + Number(row.impuestos_internos || 0),
            neto_iva_0: shouldDeriveFromTotalOnly ? totalFromFile : row.neto_iva_0,
            neto_total: shouldDeriveFromTotalOnly ? totalFromFile : netoTotal,
            total_iva: shouldDeriveFromTotalOnly ? 0 : ivaTotal,
            importe_total: total || (Number.isFinite(netoTotal) && Number.isFinite(ivaTotal) ? (netoTotal + ivaTotal + nonTaxed) : total),
            percepcion_otros_imp_nac: percepcionOtros,
            percepcion_otros_tipo: row.percepcion_otros_tipo || 'IVA',
            percepcion_iibb: percepcionIibb,
            percepcion_iva: Number(row.percepcion_iva || 0) || 0,
            percepcion_iibb_allocations: existingAllocations.length > 0
              ? existingAllocations
              : (percepcionIibb > 0 ? [{ province_code: '', total_amount: percepcionIibb }] : [])
            ,
            otros_tributos_allocations: (() => {
              const otros = Number(row.otros_tributos || 0) || 0
              const existing = Array.isArray(row.otros_tributos_allocations) ? row.otros_tributos_allocations : []
              if (existing.length > 0) return existing
              return otros > 0 ? [{ classification: 'OTRO', province_code: '', total_amount: otros }] : []
            })()
          }
        })

        setTableData(normalized)
        if (normalized.length === 0) {
          showWarning('El archivo no tenía comprobantes válidos')
        } else {
          showSuccess(`Archivo cargado (${normalized.length} comprobantes)`)
        }
      } catch (error) {
        console.error('Error parsing AFIP file:', error)
        showError('No se pudo leer el archivo')
      } finally {
        setIsParsingFile(false)
      }
    }
    reader.onerror = () => {
      setIsParsingFile(false)
      showError('No se pudo leer el archivo')
    }

    const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')
    if (isXlsx) {
      reader.readAsArrayBuffer(file)
    } else {
      reader.readAsText(file, 'utf-8')
    }
  }, [resolveDocTypeCode, showError, showSuccess, showWarning])

  const handleBrowseFile = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const generateRowId = useCallback(() => `purchase-invoice-row-${Date.now()}-${Math.random().toString(16).slice(2)}`, [])

  const rowHighlights = useMemo(() => {
    if (!tableData || tableData.length === 0) return []
    const issueSet = new Set(rowIssues.map(issue => issue.row))
    return tableData.map((_, idx) => (issueSet.has(idx + 1) ? 'error' : null))
  }, [rowIssues, tableData])

  const sendTableConfiguration = useCallback(() => {
    if (!iframeReady || !iframeRef.current?.contentWindow) return

    const tableRows = tableData.map((row) =>
      columns.map(col => row[col.key] ?? '')
    )

    iframeRef.current.contentWindow.postMessage({
      type: 'ht-configure-table',
      columns: columns,
      data: tableRows,
      rowIds: tableData.map(row => row.id || generateRowId()),
      rowHighlights
    }, '*')
  }, [columns, generateRowId, iframeReady, rowHighlights, tableData])

  useEffect(() => {
    sendTableConfiguration()
  }, [sendTableConfiguration])

  const handleIframeLoad = useCallback(() => {
    setIframeReady(true)
  }, [])

  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data || typeof event.data !== 'object') return

      if (event.data.type === 'ht-data-changed' && Array.isArray(event.data.data)) {
        const prevRows = Array.isArray(tableDataRef.current) ? tableDataRef.current : []
        const prevById = new Map(prevRows.map(r => [r.id, r]))
        const updatedData = event.data.data.map((row, idx) => {
          const rowId = event.data.rowIds?.[idx] || idx + 1
          const prev = prevById.get(rowId) || {}
          const obj = { ...prev, id: rowId }
          columns.forEach((col, colIdx) => {
            const cellValue = row[colIdx]
            if (col.type === 'numeric') {
              obj[col.key] = parseDecimal(cellValue)
            } else {
              obj[col.key] = cellValue
            }
          })

          obj.tipo_comprobante = parseTipoComprobante(obj.tipo_comprobante)
          obj.tipo_doc_vendedor = resolveDocTypeCode(obj.tipo_doc_vendedor)

          const otrosTributos = Number(obj.otros_tributos || 0) || 0
          if (otrosTributos > 0 && (!Array.isArray(obj.otros_tributos_allocations) || obj.otros_tributos_allocations.length === 0)) {
            obj.otros_tributos_allocations = [{ classification: 'OTRO', province_code: '', total_amount: otrosTributos }]
          }

          return obj
        }).filter(row => {
          return Object.entries(row).some(([k, v]) => k !== 'id' && v !== '' && v !== undefined && v !== null)
        })

        setTableData(updatedData)
      }

      if (event.data.type === 'ht-rows-removed' && Array.isArray(event.data.removedIds)) {
        const removedIds = event.data.removedIds.filter(id => id !== null && id !== undefined)
        if (removedIds.length === 0) {
          const removedRows = Array.isArray(event.data.removedRows) ? event.data.removedRows : []
          const idxs = new Set(removedRows)
          setTableData((prev) => prev.filter((_, idx) => !idxs.has(idx)))
        } else {
          const idSet = new Set(removedIds)
          setTableData((prev) => prev.filter(r => !idSet.has(r.id)))
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [columns, resolveDocTypeCode])

  const invalidRowNumbers = useMemo(() => new Set((rowIssues || []).map(issue => issue.row)), [rowIssues])
  const issueRowCount = useMemo(() => invalidRowNumbers.size, [invalidRowNumbers])

  const validRows = useMemo(() => {
    if (!tableData || tableData.length === 0) return []
    return tableData.filter((row, idx) => {
      const rowNumber = idx + 1
      if (invalidRowNumbers.has(rowNumber)) return false
      const hasTipo = row.tipo_comprobante && String(row.tipo_comprobante).trim() !== ''
      const hasPto = row.punto_venta && String(row.punto_venta).trim() !== ''
      const hasDoc = row.nro_doc_vendedor && String(row.nro_doc_vendedor).trim() !== ''
      return hasTipo && hasPto && hasDoc
    })
  }, [invalidRowNumbers, tableData])

  const validCount = useMemo(() => validRows.length, [validRows])

  const rowsWithPerceptions = useMemo(() => {
    if (!tableData || tableData.length === 0) return []
    return tableData
      .map((row, idx) => ({ row, rowNumber: idx + 1 }))
      .filter(({ row }) =>
        (Number(row.percepcion_otros_imp_nac || 0) || 0) > 0 ||
        (Number(row.percepcion_iibb || 0) || 0) > 0 ||
        (Number(row.percepcion_iva || 0) || 0) > 0 ||
        (Number(row.otros_tributos || 0) || 0) > 0
      )
  }, [tableData])

  const [isPerceptionsModalOpen, setIsPerceptionsModalOpen] = useState(false)
  const [editingPerceptionRowId, setEditingPerceptionRowId] = useState(null)
  const [selectedPerceptionRowIds, setSelectedPerceptionRowIds] = useState([])
  const [bulkIibbProvinceCode, setBulkIibbProvinceCode] = useState('')
  const editingPerceptionRow = useMemo(
    () => (editingPerceptionRowId ? tableData.find(r => r.id === editingPerceptionRowId) : null),
    [editingPerceptionRowId, tableData]
  )
  const [perceptionOtrosTipoDraft, setPerceptionOtrosTipoDraft] = useState('IVA')
  const [iibbAllocationsDraft, setIibbAllocationsDraft] = useState([])
  const [otrosTributosAllocationsDraft, setOtrosTributosAllocationsDraft] = useState([])

  useEffect(() => {
    if (!editingPerceptionRow) return

    const otrosTipo = String(editingPerceptionRow.percepcion_otros_tipo || 'IVA').trim().toUpperCase()
    setPerceptionOtrosTipoDraft(otrosTipo === 'GANANCIAS' ? 'GANANCIAS' : 'IVA')

    const iibbAmount = Number(editingPerceptionRow.percepcion_iibb || 0) || 0
    const allocations = Array.isArray(editingPerceptionRow.percepcion_iibb_allocations)
      ? editingPerceptionRow.percepcion_iibb_allocations
      : []

    if (allocations.length > 0) {
      setIibbAllocationsDraft(allocations.map(a => ({
        province_code: String(a?.province_code || '').trim(),
        total_amount: Number(a?.total_amount || 0) || 0
      })))
    } else if (iibbAmount > 0) {
      setIibbAllocationsDraft([{ province_code: '', total_amount: iibbAmount }])
    } else {
      setIibbAllocationsDraft([])
    }

    const otrosTributosAmount = Number(editingPerceptionRow.otros_tributos || 0) || 0
    const otrosAllocations = Array.isArray(editingPerceptionRow.otros_tributos_allocations)
      ? editingPerceptionRow.otros_tributos_allocations
      : []

    if (otrosAllocations.length > 0) {
      setOtrosTributosAllocationsDraft(otrosAllocations.map(a => ({
        classification: String(a?.classification || '').trim().toUpperCase(),
        province_code: String(a?.province_code || '').trim(),
        total_amount: Number(a?.total_amount || 0) || 0
      })))
    } else if (otrosTributosAmount > 0) {
      setOtrosTributosAllocationsDraft([{ classification: 'OTRO', province_code: '', total_amount: otrosTributosAmount }])
    } else {
      setOtrosTributosAllocationsDraft([])
    }
  }, [editingPerceptionRow])

  useEffect(() => {
    if (!isPerceptionsModalOpen) {
      setSelectedPerceptionRowIds([])
    }
  }, [isPerceptionsModalOpen])

  const selectedPerceptionRowIdSet = useMemo(
    () => new Set(selectedPerceptionRowIds),
    [selectedPerceptionRowIds]
  )

  const iibbRowIdsInPerceptionsModal = useMemo(() => {
    return rowsWithPerceptions
      .filter(({ row }) => (Number(row.percepcion_iibb || 0) || 0) > 0)
      .map(({ row }) => row.id)
      .filter((id) => id !== null && id !== undefined)
  }, [rowsWithPerceptions])

  const allIibbSelected = useMemo(() => {
    if (iibbRowIdsInPerceptionsModal.length === 0) return false
    return iibbRowIdsInPerceptionsModal.every((id) => selectedPerceptionRowIdSet.has(id))
  }, [iibbRowIdsInPerceptionsModal, selectedPerceptionRowIdSet])

  const togglePerceptionRowSelected = useCallback((rowId) => {
    setSelectedPerceptionRowIds((prev) => {
      const set = new Set(prev)
      if (set.has(rowId)) set.delete(rowId)
      else set.add(rowId)
      return Array.from(set)
    })
  }, [])

  const toggleSelectAllIibbRows = useCallback((shouldSelect) => {
    setSelectedPerceptionRowIds((prev) => {
      const set = new Set(prev)
      if (shouldSelect) {
        iibbRowIdsInPerceptionsModal.forEach((id) => set.add(id))
      } else {
        iibbRowIdsInPerceptionsModal.forEach((id) => set.delete(id))
      }
      return Array.from(set)
    })
  }, [iibbRowIdsInPerceptionsModal])

  const setRowIibbProvince = useCallback((rowId, provinceCode) => {
    setTableData((prev) => prev.map((row) => {
      if (row.id !== rowId) return row
      const iibb = Number(row.percepcion_iibb || 0) || 0
      if (iibb <= 0) return row
      return {
        ...row,
        percepcion_iibb_allocations: [{ province_code: provinceCode, total_amount: iibb }]
      }
    }))
  }, [])

  const applyBulkIibbProvince = useCallback(() => {
    const provinceCode = String(bulkIibbProvinceCode || '').trim()
    if (!provinceCode) {
      showWarning('Seleccione una provincia para aplicar a IIBB')
      return
    }

    if (selectedPerceptionRowIds.length === 0) {
      showWarning('Seleccione al menos una fila con IIBB')
      return
    }

    const selectedSet = new Set(selectedPerceptionRowIds)
    const selectedRows = tableData.filter((row) => selectedSet.has(row.id))
    const rowsWithIibb = selectedRows.filter((row) => (Number(row.percepcion_iibb || 0) || 0) > 0)

    const splitRows = rowsWithIibb.filter((row) => {
      const allocations = Array.isArray(row.percepcion_iibb_allocations) ? row.percepcion_iibb_allocations : []
      const normalized = allocations
        .map(a => ({ province_code: String(a?.province_code || '').trim(), total_amount: Number(a?.total_amount || 0) || 0 }))
        .filter(a => a.province_code || a.total_amount)
      return normalized.length > 1
    })

    const applyIds = new Set(rowsWithIibb
      .filter((row) => !splitRows.some(s => s.id === row.id))
      .map((row) => row.id))

    setTableData((prev) => prev.map((row) => {
      if (!applyIds.has(row.id)) return row
      const iibb = Number(row.percepcion_iibb || 0) || 0
      if (iibb <= 0) return row
      return {
        ...row,
        percepcion_iibb_allocations: [{ province_code: provinceCode, total_amount: iibb }]
      }
    }))

    if (applyIds.size > 0) {
      showSuccess(`Provincia aplicada a ${applyIds.size} fila(s) con IIBB`)
    }
    if (splitRows.length > 0) {
      showWarning(`Se omitieron ${splitRows.length} fila(s) con IIBB dividido (usa "Configurar")`)
    }
  }, [bulkIibbProvinceCode, selectedPerceptionRowIds, showSuccess, showWarning, tableData])

  const buildPerceptionsPayload = useCallback((row) => {
    const perceptions = []

    const percepcionOtros = Number(row.percepcion_otros_imp_nac || 0) || 0
    if (percepcionOtros > 0) {
      const tipo = String(row.percepcion_otros_tipo || 'IVA').trim().toUpperCase()
      perceptions.push({
        perception_type: tipo === 'GANANCIAS' ? 'GANANCIAS' : 'IVA',
        scope: 'INTERNA',
        province_code: null,
        regimen_code: '',
        percentage: null,
        base_amount: null,
        total_amount: percepcionOtros
      })
    }

    const percepcionIva = Number(row.percepcion_iva || 0) || 0
    if (percepcionIva > 0) {
      perceptions.push({
        perception_type: 'IVA',
        scope: 'INTERNA',
        province_code: null,
        regimen_code: '',
        percentage: null,
        base_amount: null,
        total_amount: percepcionIva
      })
    }

    const percepcionIibb = Number(row.percepcion_iibb || 0) || 0
    if (percepcionIibb > 0) {
      const allocations = Array.isArray(row.percepcion_iibb_allocations) ? row.percepcion_iibb_allocations : []
      allocations.forEach((allocation) => {
        const provinceCode = String(allocation?.province_code || '').trim()
        const amount = Number(allocation?.total_amount || 0) || 0
        if (!provinceCode || !amount) return
        perceptions.push({
          perception_type: 'INGRESOS_BRUTOS',
          scope: 'INTERNA',
          province_code: provinceCode,
          regimen_code: '',
          percentage: null,
          base_amount: null,
          total_amount: amount
        })
      })
    }

    const otrosTributos = Number(row.otros_tributos || 0) || 0
    if (otrosTributos > 0) {
      const allocations = Array.isArray(row.otros_tributos_allocations) ? row.otros_tributos_allocations : []
      allocations.forEach((allocation) => {
        const classification = String(allocation?.classification || '').trim().toUpperCase()
        const amount = Number(allocation?.total_amount || 0) || 0
        if (!amount) return
        if (classification === 'OTRO') return

        if (classification === 'IIBB') {
          const provinceCode = String(allocation?.province_code || '').trim()
          if (!provinceCode) return
          perceptions.push({
            perception_type: 'INGRESOS_BRUTOS',
            scope: 'INTERNA',
            province_code: provinceCode,
            regimen_code: '',
            percentage: null,
            base_amount: null,
            total_amount: amount
          })
          return
        }

        if (classification === 'IVA' || classification === 'GANANCIAS') {
          perceptions.push({
            perception_type: classification,
            scope: 'INTERNA',
            province_code: null,
            regimen_code: '',
            percentage: null,
            base_amount: null,
            total_amount: amount
          })
        }
      })
    }

    return perceptions
  }, [])

  const savePerceptionsConfig = () => {
    if (!editingPerceptionRow) return

    const percepcionIibb = Number(editingPerceptionRow.percepcion_iibb || 0) || 0
    const sanitizedAllocations = (Array.isArray(iibbAllocationsDraft) ? iibbAllocationsDraft : [])
      .map(a => ({
        province_code: String(a?.province_code || '').trim(),
        total_amount: Number(a?.total_amount || 0) || 0
      }))
      .filter(a => a.province_code || a.total_amount)

    if (percepcionIibb > 0) {
      if (sanitizedAllocations.length === 0) {
        showWarning('Debe configurar jurisdicción para percepción IIBB')
        return
      }
      if (sanitizedAllocations.some(a => !a.province_code)) {
        showWarning('Debe seleccionar jurisdicción para percepción IIBB')
        return
      }
      const sum = sanitizedAllocations.reduce((acc, a) => acc + (Number(a.total_amount || 0) || 0), 0)
      if (Math.abs(sum - percepcionIibb) > 0.01) {
        showWarning('La suma por provincias debe coincidir con el total de IIBB')
        return
      }
    }

    const otrosTributos = Number(editingPerceptionRow.otros_tributos || 0) || 0
    const sanitizedOtrosAllocations = (Array.isArray(otrosTributosAllocationsDraft) ? otrosTributosAllocationsDraft : [])
      .map(a => ({
        classification: String(a?.classification || '').trim().toUpperCase(),
        province_code: String(a?.province_code || '').trim(),
        total_amount: Number(a?.total_amount || 0) || 0
      }))
      .filter(a => a.classification || a.province_code || a.total_amount)

    if (otrosTributos > 0) {
      if (sanitizedOtrosAllocations.length === 0) {
        showWarning('Debe clasificar Importe Otros Tributos (o dejarlo como OTRO)')
        return
      }

      const validClasses = new Set(['OTRO', 'IIBB', 'IVA', 'GANANCIAS'])
      if (sanitizedOtrosAllocations.some(a => !validClasses.has(a.classification))) {
        showWarning('Clasificación inválida en Otros Tributos (OTRO/IIBB/IVA/GANANCIAS)')
        return
      }

      const iibbLines = sanitizedOtrosAllocations.filter(a => a.classification === 'IIBB' && a.total_amount)
      if (iibbLines.some(a => !a.province_code)) {
        showWarning('Debe seleccionar jurisdicción para IIBB en Otros Tributos')
        return
      }

      const sum = sanitizedOtrosAllocations.reduce((acc, a) => acc + (Number(a.total_amount || 0) || 0), 0)
      if (Math.abs(sum - otrosTributos) > 0.01) {
        showWarning('La suma de Otros Tributos clasificados debe coincidir con el total')
        return
      }
    }

    setTableData(prev => prev.map(row => {
      if (row.id !== editingPerceptionRowId) return row
      return {
        ...row,
        percepcion_otros_tipo: perceptionOtrosTipoDraft,
        percepcion_iibb_allocations: sanitizedAllocations,
        otros_tributos_allocations: sanitizedOtrosAllocations
      }
    }))
    setEditingPerceptionRowId(null)
  }

  const handleImport = async () => {
    if (!activeCompany) {
      showError('Seleccione una compañía antes de importar')
      return
    }
    if (!tableData || tableData.length === 0) {
      showError('No hay comprobantes para importar')
      return
    }
    if (validCount <= 0) {
      showWarning('No hay comprobantes v lidos para importar')
      return
    }
    if (false && rowIssues.length > 0) {
      showWarning(`Hay ${rowIssues.length} problemas en la tabla. Corrígelos antes de importar.`)
      return
    }

    setIsImporting(true)
    try {
      // En compras NO validamos talonarios: cada proveedor tiene su propia numeración.
      const skipped = (tableData?.length || 0) - (validRows?.length || 0)
      if (skipped > 0) {
        showWarning(`Se omitir n ${skipped} fila(s) con errores`)
      }
      /* const validationPayload = {
        company: activeCompany,
        invoices: validRows.map(row => ({
          punto_venta: row.punto_venta,
          tipo_comprobante: row.tipo_comprobante
        }))
      }

      const validationResp = await fetchWithAuth(API_ROUTES.validateAfipTalonarios, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validationPayload)
      })
      const validationData = await validationResp.json().catch(() => ({}))
      if (!validationResp.ok) {
        showError(validationData.message || 'Error al validar talonarios')
        setIsImporting(false)
        return
      }
      if (!validationData.valid) {
        let errorMsg = validationData.message || 'Faltan talonarios para importar'
        if (validationData.missing_talonarios && validationData.missing_talonarios.length > 0) {
          errorMsg += '\n\nTalonarios faltantes o incompletos:\n'
          validationData.missing_talonarios.forEach(missing => {
            errorMsg += `\n• Punto de Venta: ${missing.punto_venta}, Tipo Comprobante: ${missing.tipo_comprobante}`
            errorMsg += `\n  ${missing.message}`
            errorMsg += `\n  (${missing.count} comprobantes afectados)`
          })
        }
        showError(errorMsg)
        setIsImporting(false)
        return
      }

      */

      const payload = {
        company: activeCompany,
        due_days: dueDays,
        invoices: validRows.map(row => ({
          fecha_emision: row.fecha_emision,
          tipo_comprobante: row.tipo_comprobante,
          punto_venta: row.punto_venta,
          numero_desde: row.numero_desde,
          numero_hasta: row.numero_hasta,
          cod_autorizacion: row.cod_autorizacion,
          tipo_doc_vendedor: resolveDocTypeCode(row.tipo_doc_vendedor),
          nro_doc_vendedor: row.nro_doc_vendedor,
          denominacion_vendedor: row.denominacion_vendedor,
          tipo_cambio: row.tipo_cambio,
          moneda: row.moneda,
          neto_iva_0: row.neto_iva_0,
          neto_no_gravado: row.neto_no_gravado,
          exentas: row.exentas,
          otros_tributos: row.otros_tributos,
          neto_iva_25: row.neto_iva_25,
          neto_iva_5: row.neto_iva_5,
          neto_iva_105: row.neto_iva_105,
          neto_iva_21: row.neto_iva_21,
          neto_iva_27: row.neto_iva_27,
          neto_total: row.neto_total,
          total_iva: row.total_iva,
          importe_total: row.importe_total,
          otros_tributos_allocations: Array.isArray(row.otros_tributos_allocations) ? row.otros_tributos_allocations : [],
          perceptions: buildPerceptionsPayload(row)
        }))
      }

      const importResp = await fetchWithAuth(API_ROUTES.purchaseInvoiceImport, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await importResp.json().catch(() => ({}))
      if (!importResp.ok) {
        showError(data.message || 'Error al importar comprobantes')
        return
      }
      if (data.success) {
        showSuccess(data.message || 'Importación completada')
        setTableData([])
        setFileName('')
        setRowIssues([])
        setIvaPreview({})
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'ht-configure-table',
            columns: columns,
            data: [],
            rowIds: [],
            rowHighlights: []
          }, '*')
        }

        if (data.warnings && data.warnings.length > 0) {
          const warningMessages = data.warnings.map(w => {
            const invoiceName = w.invoice_name || 'N/A'
            return `• ${invoiceName}: ${w.error}`
          }).join('\n')
          showWarning(`Advertencias de totales:\n${warningMessages}`)
        }
      } else {
        showWarning(data.message || 'Importación con advertencias')
      }

      if (data.errors && data.errors.length > 0) {
        const errorMessages = data.errors.slice(0, 5).map(e => {
          const desc = e.row?.denominacion_vendedor || 'Fila desconocida'
          return `• ${desc}: ${e.error}`
        }).join('\n')
        const moreCount = data.errors.length > 5 ? `\n... y ${data.errors.length - 5} más` : ''
        showError(`Errores en ${data.errors.length} comprobantes:\n${errorMessages}${moreCount}`)
      }
    } catch (err) {
      console.error('AFIP purchase import error', err)
      showError('No se pudo importar los comprobantes')
    } finally {
      setIsImporting(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-600">
          <div className="text-lg font-semibold mb-2">Autenticación requerida</div>
          <p>Inicia sesión para importar comprobantes de compra.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-5 relative">
      {isImporting && (
        <div className="absolute inset-0 z-50 flex items-center justify-center px-6">
          <div className="bg-white/90 backdrop-blur-lg shadow-2xl border border-gray-200/60 rounded-2xl px-8 py-6 flex flex-col items-center gap-4 max-w-md w-full text-center">
            <div className="w-28 h-28 rounded-xl overflow-hidden border border-blue-100 bg-blue-50 flex items-center justify-center">
              <img src={loadingGif} alt="Importando" className="w-full h-full object-contain" />
            </div>
            <div className="text-base font-semibold text-gray-800">Importando comprobantes...</div>
            <div className="text-sm text-gray-600 leading-snug">
              Esto puede tardar unos segundos mientras procesamos las facturas y las guardamos en el sistema.
            </div>
          </div>
        </div>
      )}

      <div className="bg-white/70 backdrop-blur-xl shadow-2xl border border-gray-200/60 rounded-3xl overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileSpreadsheet className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-500">Gestión</div>
                <div className="text-xl font-bold text-gray-800">Facturas de Compra - Importación AFIP</div>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {tableData.length > 0 ? `${tableData.length} comprobantes` : ''}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              className="btn-secondary flex items-center justify-center gap-2"
              onClick={handleBrowseFile}
              disabled={isParsingFile}
            >
              <FileText className="w-4 h-4" />
              {isParsingFile ? 'Cargando...' : 'Cargar CSV/XLSX AFIP'}
            </button>

            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50">
              <span className="text-sm text-gray-700 select-none">Vencimiento (días)</span>
              <input
                type="number"
                value={dueDays}
                min={0}
                onChange={(e) => setDueDays(Number(e.target.value || 0))}
                className="h-6 w-20 px-2 rounded-md border border-gray-200 bg-white text-sm"
              />
            </div>

            <button
              type="button"
              className="btn-secondary flex items-center justify-center gap-2"
              onClick={() => setIsPerceptionsModalOpen(true)}
              disabled={rowsWithPerceptions.length === 0}
              title="Configurar percepciones antes de importar"
            >
              <AlertTriangle className="w-4 h-4" />
              Percepciones {rowsWithPerceptions.length > 0 ? `(${rowsWithPerceptions.length})` : ''}
            </button>

            {fileName && (
              <span className="text-xs text-gray-600 px-2 py-1 bg-gray-100 rounded-lg border border-gray-200">
                {fileName}
              </span>
            )}

            {rowIssues.length > 0 && (
              <div className="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
                <ListChecks className="w-4 h-4" />
                <span>Faltan datos en {issueRowCount} fila(s)</span>
              </div>
            )}

            <div className="ml-auto flex flex-col justify-end">
              <button
                type="button"
                className="btn-primary flex items-center justify-center gap-2"
                onClick={handleImport}
                disabled={isImporting || validCount <= 0}
                title="Guardar facturas en ERPNext"
              >
                <Save className="w-4 h-4" />
                <span>{isImporting ? 'Procesando...' : `Guardar (${validCount || 0})`}</span>
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
            title="Tabla de Comprobantes"
          />

          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 flex-shrink-0">
            {Object.entries(ivaPreview).map(([label, value]) => (
              <div key={label} className="bg-white/80 border border-gray-200 rounded-2xl p-3 shadow-sm">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-lg font-bold text-gray-900">
                  {Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        isOpen={isPerceptionsModalOpen}
        onClose={() => setIsPerceptionsModalOpen(false)}
        title="Percepciones"
        subtitle="Configura IVA/Ganancias y jurisdicciones IIBB antes de importar"
        size="lg"
      >
        {rowsWithPerceptions.length === 0 ? (
          <div className="text-sm text-gray-600">No hay percepciones detectadas en el archivo.</div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-gray-600">
              Filas con percepciones: {rowsWithPerceptions.length}. Las filas con IIBB requieren jurisdicción para poder importarse.
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-600">Provincia IIBB</div>
                <div className="w-56">
                  <ProvinceSelect value={bulkIibbProvinceCode} onChange={setBulkIibbProvinceCode} placeholder="Seleccionar..." />
                </div>
              </div>

              <button
                type="button"
                className="btn-secondary text-xs flex items-center gap-2"
                onClick={applyBulkIibbProvince}
                disabled={!bulkIibbProvinceCode || selectedPerceptionRowIds.length === 0}
              >
                Aplicar a seleccionadas
              </button>

              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => toggleSelectAllIibbRows(!allIibbSelected)}
                disabled={iibbRowIdsInPerceptionsModal.length === 0}
              >
                {allIibbSelected ? 'Quitar selecci▋n' : 'Seleccionar todas IIBB'}
              </button>

              <div className="ml-auto text-xs text-gray-500">
                Seleccionadas: {selectedPerceptionRowIds.length}
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl">
              <div className="max-h-[52vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left">
                    <th className="p-2 w-10">
                      <input
                        type="checkbox"
                        checked={allIibbSelected}
                        disabled={iibbRowIdsInPerceptionsModal.length === 0}
                        onChange={(e) => toggleSelectAllIibbRows(e.target.checked)}
                      />
                    </th>
                    <th className="p-2">Fila</th>
                    <th className="p-2">Proveedor</th>
                    <th className="p-2">Otros Imp. Nac.</th>
                    <th className="p-2">Percep. IVA</th>
                    <th className="p-2">Tipo</th>
                    <th className="p-2">IIBB</th>
                    <th className="p-2">Otros Trib.</th>
                    <th className="p-2">Provincia (IIBB)</th>
                    <th className="p-2">Jurisdicciones</th>
                    <th className="p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithPerceptions.map(({ row, rowNumber }) => {
                    const otros = Number(row.percepcion_otros_imp_nac || 0) || 0
                    const otrosTipo = String(row.percepcion_otros_tipo || 'IVA').trim().toUpperCase()
                    const percepIva = Number(row.percepcion_iva || 0) || 0
                    const iibb = Number(row.percepcion_iibb || 0) || 0
                    const allocations = Array.isArray(row.percepcion_iibb_allocations) ? row.percepcion_iibb_allocations : []
                    const otrosTributos = Number(row.otros_tributos || 0) || 0
                    const otrosAllocations = Array.isArray(row.otros_tributos_allocations) ? row.otros_tributos_allocations : []
                    const otrosClasificados = otrosAllocations.filter(a => String(a?.classification || '').trim().toUpperCase() !== 'OTRO')
                    const otrosStatus = otrosTributos <= 0 ? '' : (otrosClasificados.length > 0 ? 'Clasificado' : 'Sin clasificar')
                    const normalizedAllocations = allocations
                      .map(a => ({ province_code: String(a?.province_code || '').trim(), total_amount: Number(a?.total_amount || 0) || 0 }))
                      .filter(a => a.province_code || a.total_amount)
                    const allocationSum = normalizedAllocations.reduce((acc, a) => acc + (Number(a?.total_amount || 0) || 0), 0)
                    const iibbReady = iibb <= 0 || (normalizedAllocations.length > 0 && normalizedAllocations.every(a => String(a?.province_code || '').trim()) && Math.abs(allocationSum - iibb) <= 0.01)
                    const isSplit = normalizedAllocations.length > 1
                    const singleProvince = normalizedAllocations.length === 1 ? normalizedAllocations[0]?.province_code : ''
                    const canSelect = iibb > 0 && row.id !== null && row.id !== undefined
                    const isSelected = canSelect && selectedPerceptionRowIdSet.has(row.id)

                    return (
                      <tr key={row.id || rowNumber} className={`border-t ${iibb > 0 && !iibbReady ? 'bg-amber-50' : ''}`}>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={!!isSelected}
                            disabled={!canSelect}
                            onChange={() => togglePerceptionRowSelected(row.id)}
                          />
                        </td>
                        <td className="p-2 text-gray-700">{rowNumber}</td>
                        <td className="p-2 text-gray-800">{row.denominacion_vendedor || ''}</td>
                        <td className="p-2">{otros ? otros.toFixed(2) : ''}</td>
                        <td className="p-2">{percepIva ? percepIva.toFixed(2) : ''}</td>
                        <td className="p-2">{otros ? (otrosTipo === 'GANANCIAS' ? 'Ganancias' : 'IVA') : ''}</td>
                        <td className="p-2">{iibb ? iibb.toFixed(2) : ''}</td>
                        <td className="p-2">
                          {otrosTributos ? (
                            <span className={`text-xs ${otrosStatus === 'Sin clasificar' ? 'text-amber-700' : 'text-gray-700'}`}>
                              {otrosTributos.toFixed(2)} {otrosStatus ? `(${otrosStatus})` : ''}
                            </span>
                          ) : ''}
                        </td>
                        <td className="p-2">
                          {iibb <= 0 ? '' : isSplit ? (
                            <span className="text-xs text-gray-600">Dividido</span>
                          ) : (
                            <div className="w-44">
                              <ProvinceSelect value={singleProvince} onChange={(code) => setRowIibbProvince(row.id, code)} placeholder="Provincia..." />
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          {iibb <= 0 ? '' : iibbReady ? 'OK' : 'Falta configurar'}
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="btn-secondary text-xs flex items-center gap-2"
                            onClick={() => setEditingPerceptionRowId(row.id)}
                          >
                            <Edit2 className="w-4 h-4" />
                            Configurar
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!editingPerceptionRow}
        onClose={() => setEditingPerceptionRowId(null)}
        title="Configurar percepciones"
        subtitle={editingPerceptionRow ? `Proveedor: ${editingPerceptionRow.denominacion_vendedor || ''}` : ''}
        size="md"
      >
        {!editingPerceptionRow ? null : (
          <div className="space-y-4">
            {(Number(editingPerceptionRow.percepcion_otros_imp_nac || 0) || 0) > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-gray-800">Otros Imp. Nac.</div>
                <div className="grid grid-cols-2 gap-3 items-center">
                  <div className="text-sm text-gray-700">
                    Importe: {(Number(editingPerceptionRow.percepcion_otros_imp_nac || 0) || 0).toFixed(2)}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Tipo</label>
                    <select
                      value={perceptionOtrosTipoDraft}
                      onChange={(e) => setPerceptionOtrosTipoDraft(e.target.value)}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md h-7 bg-white"
                    >
                      <option value="IVA">IVA</option>
                      <option value="GANANCIAS">Ganancias</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {(Number(editingPerceptionRow.percepcion_iibb || 0) || 0) > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-gray-800">Percepciones IIBB</div>
                <div className="text-sm text-gray-700">
                  Total: {(Number(editingPerceptionRow.percepcion_iibb || 0) || 0).toFixed(2)}
                </div>

                <div className="space-y-2">
                  {iibbAllocationsDraft.map((alloc, idx) => (
                    <div key={`${idx}-${alloc.province_code || 'prov'}`} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-7">
                        <ProvinceSelect
                          value={alloc.province_code}
                          onChange={(code) => {
                            setIibbAllocationsDraft(prev => prev.map((p, i) => i === idx ? { ...p, province_code: code } : p))
                          }}
                          placeholder="Jurisdicción"
                        />
                      </div>
                      <div className="col-span-4">
                        <input
                          type="number"
                          step="0.01"
                          value={alloc.total_amount}
                          onChange={(e) => {
                            const val = Number(e.target.value || 0) || 0
                            setIibbAllocationsDraft(prev => prev.map((p, i) => i === idx ? { ...p, total_amount: val } : p))
                          }}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md h-7"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          type="button"
                          className="flex items-center justify-center w-7 h-7 text-gray-600 hover:text-red-600 hover:bg-red-100/70 rounded-xl transition-all duration-300"
                          onClick={() => setIibbAllocationsDraft(prev => prev.filter((_, i) => i !== idx))}
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs flex items-center gap-2"
                      onClick={() => setIibbAllocationsDraft(prev => [...prev, { province_code: '', total_amount: 0 }])}
                    >
                      <Plus className="w-4 h-4" />
                      Agregar provincia
                    </button>
                    <div className="text-xs text-gray-600">
                      Suma: {iibbAllocationsDraft.reduce((acc, a) => acc + (Number(a?.total_amount || 0) || 0), 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(Number(editingPerceptionRow.otros_tributos || 0) || 0) > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-gray-800">Otros Tributos</div>
                <div className="text-sm text-gray-700">
                  Total: {(Number(editingPerceptionRow.otros_tributos || 0) || 0).toFixed(2)}
                </div>

                <div className="space-y-2">
                  {otrosTributosAllocationsDraft.map((alloc, idx) => (
                    <div key={`${idx}-${alloc.classification || 'class'}`} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <label className="block text-[11px] text-gray-600 mb-1">Clasificación</label>
                        <select
                          value={alloc.classification}
                          onChange={(e) => {
                            const next = String(e.target.value || '').toUpperCase()
                            setOtrosTributosAllocationsDraft(prev => prev.map((p, i) => i === idx ? { ...p, classification: next, province_code: next === 'IIBB' ? p.province_code : '' } : p))
                          }}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md h-7 bg-white"
                        >
                          <option value="OTRO">Otro / No gravado</option>
                          <option value="IIBB">Percepción IIBB</option>
                          <option value="IVA">Percepción IVA</option>
                          <option value="GANANCIAS">Percepción Ganancias</option>
                        </select>
                      </div>

                      <div className="col-span-5">
                        <label className="block text-[11px] text-gray-600 mb-1">Jurisdicción</label>
                        {String(alloc.classification || '').toUpperCase() === 'IIBB' ? (
                          <ProvinceSelect
                            value={alloc.province_code}
                            onChange={(code) => {
                              setOtrosTributosAllocationsDraft(prev => prev.map((p, i) => i === idx ? { ...p, province_code: code } : p))
                            }}
                            placeholder="Jurisdicción"
                          />
                        ) : (
                          <div className="h-7 px-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-500 flex items-center">
                            No aplica
                          </div>
                        )}
                      </div>

                      <div className="col-span-2">
                        <label className="block text-[11px] text-gray-600 mb-1">Importe</label>
                        <input
                          type="number"
                          step="0.01"
                          value={alloc.total_amount}
                          onChange={(e) => {
                            const val = Number(e.target.value || 0) || 0
                            setOtrosTributosAllocationsDraft(prev => prev.map((p, i) => i === idx ? { ...p, total_amount: val } : p))
                          }}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md h-7"
                        />
                      </div>

                      <div className="col-span-1 flex justify-end pt-5">
                        <button
                          type="button"
                          className="flex items-center justify-center w-7 h-7 text-gray-600 hover:text-red-600 hover:bg-red-100/70 rounded-xl transition-all duration-300"
                          onClick={() => setOtrosTributosAllocationsDraft(prev => prev.filter((_, i) => i !== idx))}
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs flex items-center gap-2"
                      onClick={() => setOtrosTributosAllocationsDraft(prev => [...prev, { classification: 'OTRO', province_code: '', total_amount: 0 }])}
                    >
                      <Plus className="w-4 h-4" />
                      Agregar línea
                    </button>
                    <div className="text-xs text-gray-600">
                      Suma: {otrosTributosAllocationsDraft.reduce((acc, a) => acc + (Number(a?.total_amount || 0) || 0), 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <button type="button" className="btn-secondary" onClick={() => setEditingPerceptionRowId(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={savePerceptionsConfig}>
                Guardar
              </button>
            </div>
          </div>
        )}
      </Modal>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFileUpload}
        className="hidden"
      />
    </div>
  )
}
