import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ClipboardList,
  Truck,
  Receipt,
  FileText,
  FileSpreadsheet,
  Printer,
  Eye,
  RefreshCw,
  Loader2,
  Save,
  Upload
} from 'lucide-react'
import DocumentTypeList from './DocumentTypeList'
import EmailTemplateEditor from './EmailTemplateEditor'
import API_ROUTES from '../../../apiRoutes'
import Modal from '../../Modal'

const DOCUMENT_TYPES = [
  {
    id: 'purchase-order',
    label: 'Orden de Compra',
    docType: 'Purchase Order',
    description: 'Pedidos de compra emitidos a proveedores',
    icon: ClipboardList,
    defaultEmailSubject: 'Orden de Compra {{ doc.name }} - {{ doc.company }}',
    defaultEmailBody: `Hola {{ supplier_name or doc.supplier_name }},\nAdjuntamos la orden de compra {{ doc.name }} correspondiente a {{ doc.company }}.\n\nGracias,\n{{ doc.company }}`,
    channels: ['proveedor'],
    sampleData: {
      company: 'Demo Industrial S.A.',
      name: 'OC-00045',
      supplier_name: 'Proveedor Demo SRL',
      posting_date: '2025-11-13',
      schedule_date: '2025-11-20',
      items: [
        { item_code: 'MAT-001', item_name: 'Materia Prima A', qty: 10, rate: 2800, amount: 28000 },
        { item_code: 'MAT-020', item_name: 'Cartón Especial', qty: 5, rate: 3800, amount: 19000 }
      ],
      net_total: 47000,
      grand_total: 56870,
      tax_id: '30-12345678-9',
      address_display: 'Av. Siempre Viva 123, CABA'
    }
  },
  {
    id: 'sales-delivery-note',
    label: 'Remito de Venta',
    docType: 'Delivery Note',
    description: 'Remitos emitidos a clientes',
    icon: Truck,
    defaultEmailSubject: 'Remito {{ doc.name }} - {{ doc.customer_name }}',
    defaultEmailBody: `Hola {{ doc.customer_name }},\nAdjuntamos el remito {{ doc.name }} del pedido enviado el {{ frappe.utils.formatdate(doc.posting_date) }}.`,
    channels: ['cliente'],
    sampleData: {
      company: 'Demo Industrial S.A.',
      name: 'REM-VTA-00087',
      customer_name: 'Cliente Demo SRL',
      posting_date: '2025-11-13',
      address_display: 'Parque Industrial 300, Rosario, Santa Fe',
      items: [
        { item_code: 'PRD-001', item_name: 'Producto AA', qty: 8, rate: 4500, amount: 36000 },
        { item_code: 'PRD-222', item_name: 'Producto BB', qty: 12, rate: 2200, amount: 26400 }
      ],
      total_qty: 20,
      net_total: 62400,
      grand_total: 75504,
      tax_id: '30-87654321-7'
    }
  },
  {
    id: 'sales-invoice',
    label: 'Factura de Venta',
    docType: 'Sales Invoice',
    description: 'Facturas emitidas a clientes (AFIP)',
    icon: Receipt,
    defaultEmailSubject: 'Factura {{ doc.name }} - {{ doc.company }}',
    defaultEmailBody: `Hola {{ doc.customer_name }},\nAdjuntamos la factura {{ doc.name }} emitida el {{ frappe.utils.formatdate(doc.posting_date) }}.`,
    channels: ['cliente'],
    sampleData: {
      company: 'Demo Industrial S.A.',
      name: 'FAC-A-0002-00002345',
      customer_name: 'Cliente Demo SRL',
      posting_date: '2025-11-13',
      address_display: 'Av. Pellegrini 400, Rosario',
      items: [
        { item_code: 'SERV-001', item_name: 'Servicio Mensual', qty: 1, rate: 120000, amount: 120000 },
        { item_code: 'SERV-002', item_name: 'Implementación', qty: 1, rate: 60000, amount: 60000 }
      ],
      net_total: 180000,
      grand_total: 217800,
      total_taxes_and_charges: 37800,
      tax_id: '30-99999999-0',
      custom_cae: '73583287491324',
      custom_cae_vto: '2025-11-30'
    }
  },
  {
    id: 'sales-receipt',
    label: 'Recibo de Venta',
    docType: 'Payment Entry',
    description: 'Recibos cobrados a clientes',
    icon: FileText,
    defaultEmailSubject: 'Recibo {{ doc.name }} - {{ doc.company }}',
    defaultEmailBody: `Hola {{ doc.party_name }},\nAdjuntamos el recibo {{ doc.name }} correspondiente al pago registrado.`,
    channels: ['cliente'],
    sampleData: {
      company: 'Demo Industrial S.A.',
      name: 'REC-CLI-00034',
      posting_date: '2025-11-13',
      party_name: 'Cliente Demo SRL',
      references: [
        { reference_doctype: 'Sales Invoice', reference_name: 'FAC-A-0002-00002345', total_amount: 217800, allocated_amount: 217800 }
      ],
      paid_amount: 217800,
      received_amount: 217800,
      mode_of_payment: 'Transferencia Bancaria'
    }
  },
  {
    id: 'purchase-receipt',
    label: 'Recibo de Compra',
    docType: 'Purchase Receipt',
    description: 'Recepción de mercadería de proveedores',
    icon: FileSpreadsheet,
    defaultEmailSubject: 'Recibo de Compra {{ doc.name }} - {{ doc.company }}',
    defaultEmailBody: `Hola {{ doc.supplier_name }},\nAdjuntamos el recibo de compra {{ doc.name }} generado en {{ doc.company }}.`,
    channels: ['proveedor'],
    sampleData: {
      company: 'Demo Industrial S.A.',
      name: 'RC-00012',
      supplier_name: 'Proveedor Demo SRL',
      posting_date: '2025-11-13',
      items: [
        { item_code: 'MAT-001', item_name: 'Materia Prima A', qty: 20, received_qty: 20 },
        { item_code: 'MAT-020', item_name: 'Cartón Especial', qty: 10, received_qty: 10 }
      ],
      total_qty: 30,
      net_total: 92000,
      grand_total: 111320
    }
  }
]

const BASE_TEMPLATE_HTML = `<div class="print-format">
  <style>
    .print-format {
      font-family: 'Inter', Arial, sans-serif;
      font-size: 11px;
      color: #111827;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #111827;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .doc-header h1 {
      font-size: 20px;
      margin: 0;
    }
    .meta-table {
      width: 100%;
      margin-top: 16px;
      border-collapse: collapse;
    }
    .meta-table th {
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
      padding-bottom: 4px;
    }
    .meta-table td {
      padding: 6px 4px;
      border-top: 1px solid #e5e7eb;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    .items-table th, .items-table td {
      padding: 8px 6px;
      border-bottom: 1px solid #e5e7eb;
    }
    .items-table th {
      font-size: 10px;
      text-transform: uppercase;
      background-color: #f9fafb;
    }
    .totals {
      margin-top: 20px;
      text-align: right;
    }
    .totals p {
      margin: 4px 0;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 9999px;
      background: #eef2ff;
      color: #3730a3;
      font-size: 10px;
      text-transform: uppercase;
    }
  </style>

  <div class="doc-header">
    <div>
      <div class="badge">{{ doc.company }}</div>
      <h1>{{ doc.name }}</h1>
      <p>{{ doc.posting_date or frappe.utils.nowdate() }}</p>
    </div>
    <div style="text-align:right">
      <p><strong>Cliente / Proveedor:</strong> {{ doc.customer_name or doc.supplier_name }}</p>
      <p><strong>CUIT:</strong> {{ doc.tax_id or '00-00000000-0' }}</p>
      <p><strong>Dirección:</strong> {{ doc.address_display }}</p>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th>Código</th>
        <th>Descripción</th>
        <th style="text-align:right">Cantidad</th>
        <th style="text-align:right">Precio</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      {% for item in doc.items %}
      <tr>
        <td>{{ item.item_code }}</td>
        <td>{{ item.item_name or item.description }}</td>
        <td style="text-align:right">{{ item.qty or item.received_qty }}</td>
        <td style="text-align:right">{{ frappe.utils.fmt_money(item.rate or 0, currency=doc.currency) }}</td>
        <td style="text-align:right">{{ frappe.utils.fmt_money(item.amount or (item.rate * item.qty), currency=doc.currency) }}</td>
      </tr>
      {% endfor %}
    </tbody>
  </table>

  <div class="totals">
    <p><strong>Subtotal:</strong> {{ frappe.utils.fmt_money(doc.net_total or 0, currency=doc.currency) }}</p>
    {% if doc.total_taxes_and_charges %}
      <p><strong>Impuestos:</strong> {{ frappe.utils.fmt_money(doc.total_taxes_and_charges, currency=doc.currency) }}</p>
    {% endif %}
    <p style="font-size:18px"><strong>Total:</strong> {{ frappe.utils.fmt_money(doc.grand_total or doc.net_total, currency=doc.currency) }}</p>
  </div>
</div>`

const buildDefaultTemplates = () =>
  DOCUMENT_TYPES.reduce((acc, doc) => {
    acc[doc.id] = {
      formatName: `${doc.label} HTML`,
      erpnextFormat: `${doc.docType} HTML`,
      html: BASE_TEMPLATE_HTML,
      css: '',
      letterhead: true,
      notes: '',
      previewSample: doc.sampleData,
      updatedAt: null,
      dirty: false
    }
    return acc
  }, {})

const buildDefaultEmails = () =>
  DOCUMENT_TYPES.reduce((acc, doc) => {
    acc[doc.id] = {
      enabled: true,
      subject: doc.defaultEmailSubject,
      body: doc.defaultEmailBody,
      cc: '',
      bcc: '',
      updatedAt: null,
      dirty: false
    }
    return acc
  }, {})

const interpolateSampleData = (templateHtml, sample = {}) => {
  if (!templateHtml) return ''
  return templateHtml.replace(/{{\s*doc\.([\w_]+)\s*}}/g, (_, key) => {
    return sample[key] !== undefined ? sample[key] : `{{ doc.${key} }}`
  })
}

const buildClientPreview = (template = {}, docMeta = {}) => {
  return interpolateSampleData(
    template.html || BASE_TEMPLATE_HTML,
    docMeta.sampleData || {}
  )
}

const DocumentFormatsTab = ({ fetchWithAuth, showNotification, enableServerPreview = false }) => {
  const [templates, setTemplates] = useState(buildDefaultTemplates)
  const [emailTemplates, setEmailTemplates] = useState(buildDefaultEmails)
  const [selectedDocument, setSelectedDocument] = useState(DOCUMENT_TYPES[0].id)
  const [loading, setLoading] = useState(false)
  const [previewState, setPreviewState] = useState({ status: 'idle', html: '' })
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
  const [previewDocumentMeta, setPreviewDocumentMeta] = useState(null)
  const [savingFormatId, setSavingFormatId] = useState(null)
  const [savingEmailId, setSavingEmailId] = useState(null)
  const [letterheadData, setLetterheadData] = useState(null)
  const [letterheadForm, setLetterheadForm] = useState(null)
  const [loadingLetterhead, setLoadingLetterhead] = useState(false)
  const [savingLetterhead, setSavingLetterhead] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInputRef = useRef(null)

  useEffect(() => {
    const loadExistingConfig = async () => {
      if (!fetchWithAuth || !API_ROUTES.documentFormats?.base) {
        return
      }
      setLoading(true)
      try {
        const response = await fetchWithAuth(API_ROUTES.documentFormats.base)
        if (response.ok) {
          const payload = await response.json().catch(() => ({}))
          const serverTemplates = payload?.data?.formats || {}
          const serverEmails = payload?.data?.emails || {}
          setTemplates((prev) => {
            const merged = { ...prev }
            Object.entries(serverTemplates).forEach(([docId, template]) => {
              merged[docId] = {
                ...prev[docId],
                ...template,
                dirty: false
              }
            })
            return merged
          })
          setEmailTemplates((prev) => {
            const merged = { ...prev }
            Object.entries(serverEmails).forEach(([docId, template]) => {
              merged[docId] = {
                ...prev[docId],
                ...template,
                dirty: false
              }
            })
            return merged
          })
        }
      } catch (error) {
        console.warn('[DocumentFormatsTab] Error loading config', error)
      } finally {
        setLoading(false)
      }
    }

    loadExistingConfig()
  }, [fetchWithAuth])

  const currentDocument = useMemo(
    () => DOCUMENT_TYPES.find((doc) => doc.id === selectedDocument),
    [selectedDocument]
  )
  const currentTemplate = templates[selectedDocument]
  const currentEmailTemplate = emailTemplates[selectedDocument]

  const summaries = useMemo(() => {
    return DOCUMENT_TYPES.reduce((acc, doc) => {
      const template = templates[doc.id]
      acc[doc.id] = {
        formatStatus: template?.html ? 'ready' : 'missing',
        updatedAt: template?.updatedAt,
        messages: template?.dirty ? ['Cambios sin guardar'] : []
      }
      return acc
    }, {})
  }, [templates])

  const handleTemplateFieldChange = (docId, field, value) => {
    setTemplates((prev) => ({
      ...prev,
      [docId]: {
        ...prev[docId],
        [field]: value,
        dirty: true
      }
    }))
  }

  const handleEmailTemplateChange = (docId, template) => {
    setEmailTemplates((prev) => ({
      ...prev,
      [docId]: {
        ...prev[docId],
        ...template,
        dirty: true
      }
    }))
  }

  const syncLetterheadForm = useCallback((data) => {
    if (!data) {
      setLetterheadData(null)
      setLetterheadForm(null)
      return
    }
    const normalized = {
      name: data.name || '',
      letter_head_name: data.letter_head_name || data.name || '',
      company: data.company || '',
      source: data.source || 'HTML',
      header: data.header || data.content || '',
      footer: data.footer || '',
      image: data.image || data.header_image || '',
      imageAbsolute: data.absolute_image_url || data.image || '',
      footerImage: data.footer_image || '',
      footerImageAbsolute: data.absolute_footer_image_url || data.footer_image || '',
      is_default: data.is_default !== 0
    }
    setLetterheadData(normalized)
    setLetterheadForm(normalized)
  }, [])

  const loadLetterhead = useCallback(async () => {
    if (!fetchWithAuth || !API_ROUTES.documentFormats?.letterhead) return
    setLoadingLetterhead(true)
    try {
      const response = await fetchWithAuth(API_ROUTES.documentFormats.letterhead)
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success !== false) {
        syncLetterheadForm(payload.data || null)
      } else {
        showNotification && showNotification(payload.message || 'No pudimos cargar el letterhead', 'error')
      }
    } catch (error) {
      console.error('[DocumentFormats] Error fetching letterhead', error)
      showNotification && showNotification('No pudimos cargar el membrete', 'error')
    } finally {
      setLoadingLetterhead(false)
    }
  }, [fetchWithAuth, showNotification, syncLetterheadForm])

  const buildImageHeaderHtml = useCallback((logoUrl, companyName) => {
    const safeName = companyName || letterheadForm?.letter_head_name || 'Logo'
    if (!logoUrl) {
      return "<div style='text-align:left; padding:8px 0; font-weight:600; font-size:16px;'>Define un logo para tus comprobantes</div>"
    }
    return `<div style="text-align: left;"><img src="${logoUrl}" alt="${safeName}" style="height:80px;object-fit:contain;display:block;" /></div>`
  }, [letterheadForm?.letter_head_name])

  useEffect(() => {
    loadLetterhead()
  }, [loadLetterhead])

  const handleLetterheadFieldChange = (field, value) => {
    setLetterheadForm((prev) => {
      const next = {
        ...(prev || {}),
        [field]: value
      }
      if (field === 'image') {
        next.imageAbsolute = value?.startsWith('http') ? value : (next.imageAbsolute || value)
      }
      const effectiveSource = field === 'source' ? value : next.source
      if (effectiveSource === 'Image') {
        if (field === 'image' || field === 'source') {
          next.header = buildImageHeaderHtml(
            field === 'image' ? value : next.image,
            next.letter_head_name
          )
        }
      }
      return next
    })
  }

  const handleLogoUpload = async (file) => {
    if (!file || !fetchWithAuth) return
    setUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetchWithAuth(API_ROUTES.documentFormats.logo, {
        method: 'POST',
        body: formData,
        headers: {}
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success !== false) {
        const relativeUrl = payload.data?.file_url
        const absoluteUrl = payload.data?.absolute_file_url || relativeUrl
        if (relativeUrl) {
          const newHeader = buildImageHeaderHtml(relativeUrl, letterheadForm?.letter_head_name)
          setLetterheadForm((prev) => ({
            ...(prev || {}),
            image: relativeUrl,
            imageAbsolute: absoluteUrl,
            header: (prev?.source || 'HTML') === 'Image' ? newHeader : prev?.header
          }))
          await handleSaveLetterhead({
            image: relativeUrl,
            header: (letterheadForm?.source || 'HTML') === 'Image' ? newHeader : letterheadForm?.header
          })
        }
      } else {
        showNotification && showNotification(payload.message || 'No pudimos subir el logo', 'error')
      }
    } catch (error) {
      console.error('[DocumentFormats] Error uploading logo', error)
      showNotification && showNotification('No pudimos subir el logo', 'error')
    } finally {
      setUploadingLogo(false)
      if (logoInputRef.current) {
        logoInputRef.current.value = ''
      }
    }
  }

  const handleSaveLetterhead = async (overrides = {}) => {
    const formData = { ...(letterheadForm || {}), ...overrides }
    if (!formData.letter_head_name) {
      formData.letter_head_name = `${formData.company || 'Mi Empresa'} Letterhead`
    }
    if (!fetchWithAuth) return
    setLetterheadForm(formData)
    setSavingLetterhead(true)
    try {
      const response = await fetchWithAuth(API_ROUTES.documentFormats.letterhead, {
        method: 'POST',
        body: JSON.stringify({
          ...formData,
          is_default: formData.is_default !== false
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success !== false) {
        syncLetterheadForm(payload.data || formData)
        showNotification && showNotification('Letter head guardado', 'success')
      } else {
        showNotification && showNotification(payload.message || 'No pudimos guardar el letter head', 'error')
      }
    } catch (error) {
      console.error('[DocumentFormats] Error saving letterhead', error)
      showNotification && showNotification('No pudimos guardar el letter head', 'error')
    } finally {
      setSavingLetterhead(false)
    }
  }

  const handlePreview = async (docId) => {
    const template = templates[docId]
    const docDef = DOCUMENT_TYPES.find((doc) => doc.id === docId)
    if (!template || !docDef) return

    setPreviewDocumentMeta(docDef)
    setIsPreviewModalOpen(true)
    setPreviewState({ status: 'loading', html: '' })

    const canUseServerPreview = enableServerPreview && fetchWithAuth && API_ROUTES.documentFormats?.preview
    if (canUseServerPreview) {
      try {
        const response = await fetchWithAuth(API_ROUTES.documentFormats.preview(docId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            html: template.html,
            css: template.css,
            docType: docDef.docType,
            sampleData: docDef.sampleData
          })
        })
        if (response.ok) {
          const payload = await response.json().catch(() => ({}))
          setPreviewState({ status: 'ready', html: payload?.data?.html || '' })
          return
        }
      } catch (error) {
        console.warn('[DocumentFormatsTab] preview error, using client renderer', error)
      }
    }

    setPreviewState({
      status: 'ready',
      html: buildClientPreview(template, docDef)
    })
  }

  const handleSaveTemplate = async (docId) => {
    if (!fetchWithAuth || !API_ROUTES.documentFormats?.template) return
    const template = templates[docId]
    const docMeta = DOCUMENT_TYPES.find((doc) => doc.id === docId)
    if (!template || !docMeta) return

    setSavingFormatId(docId)
    try {
      const response = await fetchWithAuth(API_ROUTES.documentFormats.template(docId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: docMeta.docType,
          formatName: template.formatName,
          erpnextFormat: template.erpnextFormat,
          letterhead: template.letterhead,
          html: template.html,
          css: template.css,
          notes: template.notes
        })
      })
      if (!response.ok) {
        throw new Error('Error guardando formato')
      }
      setTemplates((prev) => ({
        ...prev,
        [docId]: {
          ...prev[docId],
          dirty: false,
          updatedAt: new Date().toISOString()
        }
      }))
      showNotification && showNotification('Formato guardado', 'success')
    } catch (error) {
      console.error('[DocumentFormatsTab] save template error', error)
      showNotification && showNotification('No se pudo guardar el formato', 'error')
    } finally {
      setSavingFormatId(null)
    }
  }

  const handleSaveEmailTemplate = async (docId) => {
    if (!fetchWithAuth || !API_ROUTES.documentFormats?.emailTemplate) return
    const template = emailTemplates[docId]
    const docMeta = DOCUMENT_TYPES.find((doc) => doc.id === docId)
    if (!template || !docMeta) return

    setSavingEmailId(docId)
    try {
      const response = await fetchWithAuth(API_ROUTES.documentFormats.emailTemplate(docId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: docMeta.docType,
          subject: template.subject,
          body: template.body,
          enabled: template.enabled,
          cc: template.cc,
          bcc: template.bcc
        })
      })
      if (!response.ok) {
        throw new Error('Error guardando plantilla de email')
      }
      setEmailTemplates((prev) => ({
        ...prev,
        [docId]: {
          ...prev[docId],
          dirty: false,
          updatedAt: new Date().toISOString()
        }
      }))
      showNotification && showNotification('Plantilla de email guardada', 'success')
    } catch (error) {
      console.error('[DocumentFormatsTab] save email template error', error)
      showNotification && showNotification('No se pudo guardar la plantilla de email', 'error')
    } finally {
      setSavingEmailId(null)
    }
  }

  const handleClosePreviewModal = () => {
    setIsPreviewModalOpen(false)
    setPreviewState({ status: 'idle', html: '' })
    setPreviewDocumentMeta(null)
  }

  if (!currentDocument) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Formatos & PDFs</p>
          <h2 className="text-2xl font-black text-gray-900">Documentos configurables</h2>
          <p className="text-sm text-gray-500">
            Mantené centralizados los formatos HTML de tus comprobantes y las plantillas de emails que acompañan los PDFs.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <DocumentTypeList
              documents={DOCUMENT_TYPES}
              selectedId={selectedDocument}
              onSelect={setSelectedDocument}
              summaries={summaries}
              loading={loading}
            />
          </div>
          <div className="lg:col-span-2 space-y-6">
            <section className="p-5 bg-white rounded-3xl border border-gray-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Printer className="w-4 h-4 text-blue-600" />
                    {currentDocument.label}
                  </p>
                  <p className="text-xs text-gray-500">{currentDocument.description}</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary gap-2"
                  onClick={() => handlePreview(selectedDocument)}
                >
                  <Eye className="w-4 h-4" />
                  Vista previa
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1 text-xs font-semibold text-gray-600">
                  Nombre del formato
                  <input
                    type="text"
                    value={currentTemplate?.formatName || ''}
                    onChange={(e) => handleTemplateFieldChange(selectedDocument, 'formatName', e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold text-gray-600">
                  Nombre en ERPNext
                  <input
                    type="text"
                    value={currentTemplate?.erpnextFormat || ''}
                    onChange={(e) => handleTemplateFieldChange(selectedDocument, 'erpnextFormat', e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                  />
                </label>
              </div>

              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-600">
                  <input
                    type="checkbox"
                    checked={Boolean(currentTemplate?.letterhead)}
                    onChange={(e) => handleTemplateFieldChange(selectedDocument, 'letterhead', e.target.checked)}
                    className="rounded text-blue-600 border-gray-300"
                  />
                  Incluir membrete
                </label>
                <span className="text-[11px] text-gray-500">Solo se guardarán formatos HTML (con Jinja).</span>
              </div>

              <label className="space-y-2 text-xs font-semibold text-gray-600">
                HTML / Jinja
                <textarea
                  rows={18}
                  value={currentTemplate?.html || ''}
                  onChange={(e) => handleTemplateFieldChange(selectedDocument, 'html', e.target.value)}
                  className="w-full font-mono text-xs border border-gray-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                  spellCheck={false}
                />
              </label>

              <label className="space-y-2 text-xs font-semibold text-gray-600">
                CSS opcional
                <textarea
                  rows={4}
                  value={currentTemplate?.css || ''}
                  onChange={(e) => handleTemplateFieldChange(selectedDocument, 'css', e.target.value)}
                  className="w-full font-mono text-xs border border-gray-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                  spellCheck={false}
                  placeholder=".print-format h1 { font-size: 24px; }"
                />
              </label>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="btn-secondary gap-2"
                  onClick={() => handlePreview(selectedDocument)}
                >
                  <RefreshCw className="w-4 h-4" />
                  Actualizar vista previa
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveTemplate(selectedDocument)}
                  disabled={savingFormatId === selectedDocument}
                  className={`btn-primary gap-2 ${savingFormatId === selectedDocument ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {savingFormatId === selectedDocument ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Guardar Formato
                    </>
                  )}
                </button>
              </div>
            </section>

            <EmailTemplateEditor
              template={currentEmailTemplate}
              onChange={(next) => handleEmailTemplateChange(selectedDocument, next)}
              onSave={() => handleSaveEmailTemplate(selectedDocument)}
              saving={savingEmailId === selectedDocument}
            />

            <section className="p-5 bg-white rounded-3xl border border-gray-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Logo y Letter Head</p>
                  <p className="text-xs text-gray-500">
                    Definí el logo y el HTML que se insertan antes/después de cada PDF.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp,image/gif"
                    className="hidden"
                    ref={logoInputRef}
                    onChange={(event) => handleLogoUpload(event.target.files?.[0])}
                  />
                  <button
                    type="button"
                    className="btn-secondary gap-2"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo || loadingLetterhead}
                  >
                    {uploadingLogo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Subiendo...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Subir logo
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary gap-2"
                    onClick={loadLetterhead}
                    disabled={loadingLetterhead}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Recargar
                  </button>
                </div>
              </div>

              {letterheadForm ? (
                <div className="space-y-4">
                  <div className="flex flex-col lg:flex-row gap-4">
                    <div className="lg:w-1/3 space-y-3">
                      <div className="border border-dashed border-gray-300 rounded-2xl h-36 flex items-center justify-center bg-gray-50">
                        {letterheadForm.image || letterheadForm.imageAbsolute ? (
                          <img
                            src={letterheadForm.imageAbsolute || letterheadForm.image}
                            alt="Logo de la empresa"
                            className="max-h-28 object-contain"
                          />
                        ) : (
                          <span className="text-xs text-gray-500 text-center px-4">
                            Aún no definiste un logo para los PDF
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500">
                        Este logo se usa en todos los formatos HTML y en el membrete estándar de ERPNext.
                      </p>
                    </div>
                    <div className="flex-1 space-y-3">
                      <label className="space-y-1 text-xs font-semibold text-gray-600">
                        Nombre del membrete
                        <input
                          type="text"
                          value={letterheadForm.letter_head_name || ''}
                          onChange={(e) => handleLetterheadFieldChange('letter_head_name', e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                        />
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-gray-600">
                        Tipo de contenido
                        <select
                          value={letterheadForm.source || 'HTML'}
                          onChange={(e) => handleLetterheadFieldChange('source', e.target.value)}
                          className="w-full text-sm border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-blue-200 focus:border-blue-500 bg-white"
                        >
                          <option value="HTML">HTML con logo</option>
                          <option value="Image">Solo imagen</option>
                        </select>
                      </label>
                      {letterheadForm.source !== 'Image' && (
                        <label className="space-y-1 text-xs font-semibold text-gray-600">
                          HTML del encabezado
                          <textarea
                            rows={4}
                            value={letterheadForm.header || ''}
                            onChange={(e) => handleLetterheadFieldChange('header', e.target.value)}
                            className="w-full font-mono text-xs border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                          />
                        </label>
                      )}
                      <label className="space-y-1 text-xs font-semibold text-gray-600">
                        HTML del pie
                        <textarea
                          rows={3}
                          value={letterheadForm.footer || ''}
                          onChange={(e) => handleLetterheadFieldChange('footer', e.target.value)}
                          className="w-full font-mono text-xs border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={loadLetterhead}
                      disabled={loadingLetterhead}
                    >
                      Descartar cambios
                    </button>
                    <button
                      type="button"
                      className={`btn-primary gap-2 ${savingLetterhead ? 'opacity-70 cursor-not-allowed' : ''}`}
                      onClick={() => handleSaveLetterhead()}
                      disabled={savingLetterhead}
                    >
                      {savingLetterhead ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Guardando...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Guardar letter head
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center text-sm text-gray-500 py-8">
                  {loadingLetterhead ? 'Cargando datos del membrete...' : 'Aún no hay un letter head disponible.'}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
      <Modal
        isOpen={isPreviewModalOpen}
        onClose={handleClosePreviewModal}
        title={`Vista previa · ${previewDocumentMeta?.label || ''}`}
        size="xl"
      >
        <div className="flex flex-col gap-3 h-[70vh]">
          {previewState.status === 'loading' ? (
            <div className="flex flex-1 items-center justify-center text-gray-500">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Renderizando vista previa...
            </div>
          ) : previewState.html ? (
            <div className="flex-1 border border-gray-200 rounded-2xl overflow-auto p-4 bg-white">
              <div dangerouslySetInnerHTML={{ __html: previewState.html }} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-400 text-sm text-center">
              Prepará el formato y presioná “Vista previa” para ver el resultado.
            </div>
          )}
          <div className="text-xs text-gray-500">
            Esta vista usa datos de ejemplo. Cuando el backend esté listo, se puede habilitar el render del servidor para validar con ERPNext.
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default DocumentFormatsTab
