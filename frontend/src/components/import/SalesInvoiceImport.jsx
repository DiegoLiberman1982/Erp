import React, { useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react'
import { AlertTriangle, FileSpreadsheet, FileText, ListChecks, Save } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import afipCodes from '../../../../shared/afip_codes.json'
import loadingGif from '../../media/Carga1.gif'
import useTaxTemplates from '../../hooks/useTaxTemplates'
import { getIvaRatesFromTemplates } from '../../utils/taxTemplates'

const headerAliases = {
  // Headers exactos como vienen en el CSV de AFIP (con puntos, acentos y comas)
  'fecha de emisión': 'fecha_emision',
  'tipo de comprobante': 'tipo_comprobante',
  'punto de venta': 'punto_venta',
  'número desde': 'numero_desde',
  'número hasta': 'numero_hasta',
  'cód. autorización': 'cod_autorizacion',
  'tipo doc. receptor': 'tipo_doc_receptor',
  'nro. doc. receptor': 'nro_doc_receptor',
  'denominación receptor': 'denominacion_receptor',
  'tipo cambio': 'tipo_cambio',
  'moneda': 'moneda',
  'imp. neto gravado iva 0%': 'neto_iva_0',
  'iva 2,5%': 'iva_25_col',
  'imp. neto gravado iva 2,5%': 'neto_iva_25',
  'iva 5%': 'iva_5_col',
  'imp. neto gravado iva 5%': 'neto_iva_5',
  'iva 10,5%': 'iva_105_col',
  'imp. neto gravado iva 10,5%': 'neto_iva_105',
  'iva 21%': 'iva_21_col',
  'imp. neto gravado iva 21%': 'neto_iva_21',
  'iva 27%': 'iva_27_col',
  'imp. neto gravado iva 27%': 'neto_iva_27',
  'imp. neto gravado total': 'neto_total',
  'imp. neto no gravado': 'neto_no_gravado',
  'imp. op. exentas': 'exentas',
  'otros tributos': 'otros_tributos',
  'total iva': 'total_iva',
  'imp. total': 'importe_total',
  
  // Variantes sin puntos (por si acaso)
  'fecha de emision': 'fecha_emision',
  'numero desde': 'numero_desde',
  'numero hasta': 'numero_hasta',
  'cod autorizacion': 'cod_autorizacion',
  'tipo doc receptor': 'tipo_doc_receptor',
  'nro doc receptor': 'nro_doc_receptor',
  'denominacion receptor': 'denominacion_receptor',
  'imp neto gravado iva 0%': 'neto_iva_0',
  'iva 25%': 'iva_25_col',
  'imp neto gravado iva 25%': 'neto_iva_25',
  'imp neto gravado iva 5%': 'neto_iva_5',
  'iva 105%': 'iva_105_col',
  'imp neto gravado iva 105%': 'neto_iva_105',
  'imp neto gravado iva 21%': 'neto_iva_21',
  'imp neto gravado iva 27%': 'neto_iva_27',
  'imp neto gravado total': 'neto_total',
  'imp neto no gravado': 'neto_no_gravado',
  'imp op exentas': 'exentas',
  'imp total': 'importe_total'
}

const normalizeHeader = (header) => {
  if (!header) return ''
  return header
    .toLowerCase()
    .replace(/"/g, '')
    .trim()
}

const parseDecimal = (value) => {
  if (value === undefined || value === null || value === '') return ''
  const raw = String(value).trim()
  if (!raw) return ''
  // El CSV de AFIP usa coma como separador decimal
  const normalized = raw.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : ''
}

const formatRateLabel = (rate) => {
  if (rate === undefined || rate === null) return ''
  const numeric = Number(String(rate).replace(',', '.'))
  if (!Number.isFinite(numeric)) return ''
  return `${numeric.toString()}%`
}

const getNetColumnKeyForRate = (rate) => {
  const numeric = Number(String(rate).replace(',', '.'))
  if (!Number.isFinite(numeric)) return null
  const normalized = numeric % 1 === 0 ? numeric.toString() : numeric.toString().replace('.', '')
  return `neto_iva_${normalized}`
}

const parseCsvContent = (content) => {
  if (!content) return []
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const delimiter = lines[0].includes(';') ? ';' : ','
  const headers = lines[0]
    .split(delimiter)
    .map(h => normalizeHeader(h))
    .filter(Boolean)

  console.log('CSV Headers detectados:', headers)
  console.log('Mapeo de headers:')
  headers.forEach(h => {
    const mapped = headerAliases[h] || h.replace(/\s+/g, '_')
    console.log(`  "${h}" -> "${mapped}"`)
  })

  const rows = lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(delimiter).map(cell => cell.replace(/^"+|"+$/g, '').trim())
    const row = { id: rowIndex + 1 }

    headers.forEach((header, idx) => {
      const key = headerAliases[header] || header.replace(/\s+/g, '_')
      const value = cells[idx] ?? ''
      
      // Detectar columnas numéricas por su key
      const numericKeys = ['tipo_cambio', 'neto_iva_0', 'neto_iva_25', 'neto_iva_5', 'neto_iva_105', 
                          'neto_iva_21', 'neto_iva_27', 'neto_total', 'neto_no_gravado', 'exentas', 
                          'otros_tributos', 'total_iva', 'importe_total']
      
      if (numericKeys.includes(key)) {
        row[key] = parseDecimal(value)
      } else if (key === 'fecha_emision' && value) {
        // Convertir fecha de YYYY-MM-DD a DD/MM/YYYY
        const parts = value.split('-')
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

  console.log('Primera fila parseada:', rows[0])

  return rows.filter(row => Object.values(row).some(v => v !== '' && v !== undefined))
}

// Build afipDocTypes from shared/afip_codes.json (document_types)
const afipDocTypes = (afipCodes.document_types || []).map(dt => ({ value: String(dt.code), label: `${dt.code} - ${dt.description}` }))

export default function SalesInvoiceImport() {
  const { isAuthenticated, activeCompany, fetchWithAuth } = useContext(AuthContext)
  const { showSuccess, showWarning, showInfo, showError } = useNotification()
  const { templates: taxTemplates } = useTaxTemplates(fetchWithAuth)
  const ivaRates = useMemo(() => getIvaRatesFromTemplates(taxTemplates), [taxTemplates])

  const [preventElectronic, setPreventElectronic] = useState(true)
  const [tableData, setTableData] = useState([])
  const [csvFileName, setCsvFileName] = useState('')
  const [isParsingCsv, setIsParsingCsv] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [rowIssues, setRowIssues] = useState([])
  const [ivaPreview, setIvaPreview] = useState({})
  const fileInputRef = useRef(null)
  const iframeRef = useRef(null)
  const [iframeReady, setIframeReady] = useState(false)

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
    })
    setRowIssues(issues)

    const rateDescriptors = ivaRates.map(rate => ({
      label: formatRateLabel(rate),
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
    { key: 'numero_desde', label: 'Nro Desde', type: 'text', width: 100 },
    { key: 'numero_hasta', label: 'Nro Hasta', type: 'text', width: 100 },
    { key: 'cod_autorizacion', label: 'CAE', type: 'text', width: 140 },
    { key: 'tipo_doc_receptor', label: 'Tipo Doc', type: 'dropdown', options: afipDocTypes, width: 100 },
    { key: 'nro_doc_receptor', label: 'CUIT/DNI', type: 'text', width: 120 },
    { key: 'denominacion_receptor', label: 'Cliente', type: 'text', width: 200 },
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

  const handleCsvUpload = useCallback((event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setCsvFileName(file.name)
    setIsParsingCsv(true)

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = parseCsvContent(reader.result)
        setTableData(parsed)
        if (parsed.length === 0) {
          showWarning('El CSV no tenía comprobantes válidos')
        } else {
          showSuccess(`CSV cargado (${parsed.length} comprobantes)`)
        }
      } catch (error) {
        console.error('Error parsing AFIP CSV:', error)
        showError('No se pudo leer el CSV de AFIP')
      } finally {
        setIsParsingCsv(false)
      }
    }
    reader.onerror = () => {
      setIsParsingCsv(false)
      showError('No se pudo leer el archivo CSV')
    }
    reader.readAsText(file, 'utf-8')
  }, [showError, showSuccess])

  const handleBrowseFile = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const generateRowId = useCallback(() => `invoice-row-${Date.now()}-${Math.random().toString(16).slice(2)}`, [])

  const rowHighlights = useMemo(() => {
    if (!tableData || tableData.length === 0) return []
    const issueSet = new Set((rowIssues || []).map(issue => issue.row))
    return tableData.map((_, idx) => (issueSet.has(idx + 1) ? 'error' : null))
  }, [rowIssues, tableData])

  const sendTableConfiguration = useCallback(() => {
    if (!iframeReady || !iframeRef.current?.contentWindow) return

    // Convertir datos de objetos a arrays según el orden de las columnas
    const tableRows = tableData.map((row) => 
      columns.map(col => row[col.key] ?? '')
    )

    console.log('SalesInvoiceImport: Enviando configuración de tabla al iframe')
    console.log('SalesInvoiceImport: Columnas:', columns.length)
    console.log('SalesInvoiceImport: Filas:', tableRows.length)
    console.log('SalesInvoiceImport: Primera fila ejemplo:', tableRows[0])

    iframeRef.current.contentWindow.postMessage({
      type: 'ht-configure-table',
      columns: columns,
      data: tableRows,
      rowIds: tableData.map(row => row.id || generateRowId()),
      rowHighlights
    }, '*')
  }, [iframeReady, tableData, columns, generateRowId, rowHighlights])

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
        console.log('SalesInvoiceImport: Recibido ht-data-changed del iframe')
        console.log('SalesInvoiceImport: Filas recibidas:', event.data.data.length)
        
        // Convertir arrays de vuelta a objetos
        const updatedData = event.data.data.map((row, idx) => {
          const obj = { id: event.data.rowIds?.[idx] || idx + 1 }
          columns.forEach((col, colIdx) => {
            obj[col.key] = row[colIdx]
          })
          return obj
        }).filter(row => {
          // Filtrar filas completamente vacías (ignorar sólo la propiedad `id`)
          // Si dejamos `id` en la comprobación, las filas borradas desde Handsontable
          // quedan porque siempre tienen un id. Por eso comprobamos que alguna
          // otra propiedad tenga valor.
          return Object.entries(row).some(([k, v]) => k !== 'id' && v !== '' && v !== undefined && v !== null)
        })
        
        console.log('SalesInvoiceImport: Objetos convertidos:', updatedData.length)
        setTableData(updatedData)
      }

      // Handsontable iframe notifies parent when rows are removed using ht-rows-removed
      if (event.data.type === 'ht-rows-removed' && Array.isArray(event.data.removedIds)) {
        console.log('SalesInvoiceImport: received ht-rows-removed', event.data.removedIds)
        const removedIds = event.data.removedIds.filter(id => id !== null && id !== undefined)
        if (removedIds.length === 0) {
          // If removedIds are all null, we can't map by id reliably; try to use removedRows indexes
          const removedRows = Array.isArray(event.data.removedRows) ? event.data.removedRows : []
          // Remove by index: build a set of indexes to remove and filter by index
          const idxs = new Set(removedRows)
          setTableData((prev) => prev.filter((_, idx) => !idxs.has(idx)))
        } else {
          // Remove rows by their ids
          const idSet = new Set(removedIds)
          setTableData((prev) => prev.filter(r => !idSet.has(r.id)))
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [columns])

  const handleToggleElectronic = (checked) => {
    setPreventElectronic(checked)
    if (!checked) {
      showWarning('Si habilitas la generación electrónica se enviará a AFIP y no se podrá deshacer.')
    }
  }

  const handleAfipImport = async () => {
    if (!tableData || tableData.length === 0) {
      showWarning('Carga al menos un comprobante antes de importar')
      return
    }
    if (validCount <= 0) {
      showWarning('No hay comprobantes v lidos para importar')
      return
    }
    if (false && rowIssues.length > 0) {
      showWarning('Revisa los campos obligatorios: tipo de comprobante y punto de venta')
      return
    }

    setIsImporting(true)

    try {
      const skipped = (tableData?.length || 0) - (validRows?.length || 0)
      if (skipped > 0) {
        showWarning(`Se omitir n ${skipped} fila(s) con errores`)
      }
      // Paso 1: Validar talonarios antes de importar
      const validationPayload = {
        company: activeCompany,
        invoices: validRows.map(row => ({
          punto_venta: row.punto_venta,
          tipo_comprobante: row.tipo_comprobante
        }))
      }

      console.log('Validando talonarios antes de importar...')
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

      // Si la validación falló, mostrar errores detallados
      if (!validationData.valid) {
        let errorMsg = validationData.message || 'Faltan talonarios para importar las facturas'
        
        if (validationData.missing_talonarios && validationData.missing_talonarios.length > 0) {
          errorMsg += '\n\nTalonarios faltantes o incompletos:\n'
          validationData.missing_talonarios.forEach(missing => {
            errorMsg += `\n• Punto de Venta: ${missing.punto_venta}, Tipo Comprobante: ${missing.tipo_comprobante}`
            errorMsg += `\n  ${missing.message}`
            errorMsg += `\n  (${missing.count} facturas afectadas)`
          })
          errorMsg += '\n\nPor favor, crea los talonarios necesarios en Configuración > Talonarios antes de importar.'
        }

        showError(errorMsg)
        setIsImporting(false)
        return
      }

      console.log(`Validación exitosa. ${validationData.talonarios_count} talonarios encontrados.`)

      // Paso 2: Si la validación fue exitosa, proceder con la importación
      const payload = {
        prevent_electronic: preventElectronic,
        company: activeCompany,
        invoices: validRows.map(row => ({
          fecha_emision: row.fecha_emision,
          tipo_comprobante: row.tipo_comprobante,
          punto_venta: row.punto_venta,
          numero_desde: row.numero_desde,
          numero_hasta: row.numero_hasta,
          cod_autorizacion: row.cod_autorizacion,
          tipo_doc_receptor: resolveDocTypeCode(row.tipo_doc_receptor),
          nro_doc_receptor: row.nro_doc_receptor,
          denominacion_receptor: row.denominacion_receptor,
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
          total_iva: row.total_iva,
          importe_total: row.importe_total
        }))
      }

      const importResp = await fetchWithAuth(API_ROUTES.salesInvoiceImport, {
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
        showSuccess(data.message || 'Importación de comprobantes completada')
        // Limpiar la tabla después de una importación exitosa
        setTableData([])
        setCsvFileName('')
        // Enviar tabla vacía al iframe
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'ht-configure-table',
            columns: columns,
            data: [],
            rowIds: [],
            rowHighlights: []
          }, '*')
        }
        
        // Mostrar advertencias de validación de totales si las hay
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
          const desc = e.row?.denominacion_receptor || 'Fila desconocida'
          return `• ${desc}: ${e.error}`
        }).join('\n')
        const moreCount = data.errors.length > 5 ? `\n... y ${data.errors.length - 5} más` : ''
        showError(`Errores en ${data.errors.length} comprobantes:\n${errorMessages}${moreCount}`)
      }
    } catch (err) {
      console.error('AFIP import error', err)
      showError('No se pudo importar los comprobantes')
    } finally {
      setIsImporting(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="h-full flex items-center justify-center bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30">
        <div className="text-center text-gray-500">
          <div className="text-lg font-semibold mb-2">Autenticación requerida</div>
          <p>Inicia sesión para importar comprobantes de venta.</p>
        </div>
      </div>
    )
  }

  const invalidRowNumbers = useMemo(() => new Set((rowIssues || []).map(issue => issue.row)), [rowIssues])
  const issueRowCount = useMemo(() => invalidRowNumbers.size, [invalidRowNumbers])

  const validRows = useMemo(() => {
    if (!tableData || tableData.length === 0) return []
    return tableData.filter((row, idx) => {
      const rowNumber = idx + 1
      if (invalidRowNumbers.has(rowNumber)) return false
      const hasTipo = row.tipo_comprobante && String(row.tipo_comprobante).trim() !== ''
      const hasPto = row.punto_venta && String(row.punto_venta).trim() !== ''
      return hasTipo && hasPto
    })
  }, [invalidRowNumbers, tableData])

  const validCount = useMemo(() => validRows.length, [validRows])

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
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="text-sm font-medium text-gray-500">Gestión</div>
                <div className="text-xl font-bold text-gray-800">Facturas de Venta - Importación AFIP</div>
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
              disabled={isParsingCsv}
            >
              <FileSpreadsheet className="w-4 h-4" />
              {isParsingCsv ? 'Cargando...' : 'Cargar CSV AFIP'}
            </button>

            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50">
              <input
                type="checkbox"
                id="preventElectronic"
                checked={preventElectronic}
                onChange={(e) => handleToggleElectronic(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="preventElectronic" className="text-sm text-gray-700 cursor-pointer select-none">
                No genera facturas electrónicas
              </label>
            </div>

            {csvFileName && (
              <span className="text-xs text-gray-600 px-2 py-1 bg-gray-100 rounded-lg border border-gray-200">
                {csvFileName}
              </span>
            )}

            {rowIssues.length > 0 && (
              <div className="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
                <ListChecks className="w-4 h-4" />
                <span>Faltan datos en {issueRowCount} fila(s)</span>
              </div>
            )}

            {!preventElectronic && tableData.length > 0 && (
              <div className="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>Se enviará a AFIP (no se puede deshacer)</span>
              </div>
            )}

            <div className="ml-auto flex flex-col justify-end">
              <button
                type="button"
                className="btn-primary flex items-center justify-center gap-2"
                onClick={handleAfipImport}
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleCsvUpload}
        className="hidden"
      />
    </div>
  )
}
