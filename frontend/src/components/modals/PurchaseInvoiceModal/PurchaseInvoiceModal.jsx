import React, { useState, useEffect, useContext, useRef, useCallback, useMemo } from 'react'
import { AuthContext } from '../../../AuthProvider.jsx'
import { NotificationContext } from '../../../contexts/NotificationContext.jsx'
import { useConfirm } from '../../../hooks/useConfirm.jsx'
import API_ROUTES from '../../../apiRoutes.js'
import { ChevronUp, ChevronDown, Plus, Trash2, Save, FileText, DollarSign, X, Move, Minimize2, Maximize2, Settings, CheckCircle } from 'lucide-react'
import afipCodes from '../../../../../shared/afip_codes.json'

// Import separated functions
import { formatCurrency, formatNumber, getDefaultIVARate, getMetodoNumeracionFromTalonario, normalizePurchaseInvoiceItemPricing } from './purchaseInvoiceModalUtils.js'
import {
  calculateItemAmount,
  calculateSubtotal,
  calculateNetGravado,
  calculateTotalIVA,
  calculateTotal,
  calculateDueDate
} from './purchaseInvoiceModalCalculations.js'
import {
  createHandleInputChange,
  createHandleItemChange,
  createAddItem,
  createRemoveItem
} from './purchaseInvoiceModalHandlers.js'
import {
  fetchExchangeRate,
  fetchPaymentTerms,
  fetchActiveCompanyDetails,
  searchAccounts,
  determineComprobanteOptions,
  fetchAvailableTalonarios,
  filterTalonariosByComprobanteType,
  fetchAvailableWarehouses,
  fetchAvailablePurchasePriceLists,
  fetchPurchasePriceListDetails,
  parseMetodoNumeracion,
  getInvoiceTypeFromParsedType,
  searchItems,
  fetchItemPriceInPriceList
} from './purchaseInvoiceModalApi.js'

import {
  isCreditNote,
  fetchUnpaidInvoices,
  fetchInvoiceDetails,
  createHandleUnpaidInvoiceSelection,
  createHandleUnpaidInvoiceAmountChange,
  addItemsFromAssociatedInvoices,
  clampSelectedInvoicesToCreditLimit
} from './purchaseInvoiceModalCreditNotes.js'

import PurchaseInvoiceModalContainer from './PurchaseInvoiceModalContainer.jsx'
import { usePurchaseInvoiceEffects } from './hooks/usePurchaseInvoiceEffects.js'
import { usePurchaseInvoiceOperations } from './hooks/usePurchaseInvoiceOperations.js'
import { useSupplierCache } from './useSupplierCache.js'
import { useStaticDataCache } from './useStaticDataCache.js'
import useCurrencies from '../../../hooks/useCurrencies.js'

// Import missing components
import PurchaseInvoiceModalHeader from './PurchaseInvoiceModalHeader.jsx'
import UnpaidInvoicesSection from '../InvoiceModal/UnpaidInvoicesSection.jsx'
import { PurchaseItemsTable, isPendingItem } from '../shared'
import PurchaseInvoiceSummary from './PurchaseInvoiceSummary.jsx'
import SalesConditionModal from './SalesConditionModal.jsx'
import DocumentLinkerModal from '../DocumentLinker/DocumentLinkerModal.jsx'
import QuickItemCreateModal from '../QuickItemCreateModal/QuickItemCreateModal.jsx'
import PendingItemResolveModal from '../PendingItemResolveModal/PendingItemResolveModal.jsx'
import ItemSettingsModal from '../ItemSettingsModal.jsx'
import { buildPurchaseInvoicePatchFromDocument } from '../../../utils/documentLinkingTransforms.js'
import { getAfipTipoFromLabel, getAfipDescriptionFromTipo, isCreditNoteLabel, isDebitNoteLabel } from '../../../utils/comprobantes'

/**
 * Verifica si hay items pendientes de mapear en la lista
 */
const hasPendingItems = (items) => {
  if (!Array.isArray(items)) return false
  return items.some(item => isPendingItem(item))
}

const normalizeInvoiceTypeLabel = (rawValue, { creditNote = false, debitNote = false } = {}) => {
  const value = (rawValue || '').toString().trim()
  const detectedTipo = getAfipTipoFromLabel(value)
  if (creditNote || isCreditNoteLabel(value) || (detectedTipo && detectedTipo.startsWith('NC'))) {
    return 'Nota de Crédito'
  }
  if (debitNote || isDebitNoteLabel(value) || (detectedTipo && detectedTipo.startsWith('ND'))) {
    return 'Nota de Débito'
  }
  if (detectedTipo) {
    return getAfipDescriptionFromTipo(detectedTipo) || value || 'Factura'
  }
  return value || 'Factura'
}

// Función helper para quitar la abreviatura de la empresa de los códigos de item
const stripAbbr = (code) => {
  if (!code) return code
  // Si el código termina con ' - ABBR' o ' - ABC' (letras mayúsculas), quitar esa parte
  const abbrPattern = /\s-\s[A-Z]{3,}$/
  return code.replace(abbrPattern, '').trim()
}

// Función helper para detectar tipo de comprobante desde el nombre (incluyendo nombres temporales)
const detectDocumentTypeFromName = (documentName) => {
  if (!documentName) return null
  
  const name = documentName.toString()
  
  // Detectar nombres temporales de borradores
  if (name.startsWith('DRAFT-')) {
    const cleanName = name.replace('DRAFT-', '')
  if (cleanName.includes('-NDC-') || cleanName.includes('-NCC-')) return 'Nota de Crédito'
  if (cleanName.includes('-NDB-')) return 'Nota de Débito'
    if (cleanName.includes('-TIQ-')) return 'Ticket'
    if (cleanName.includes('-FAC-')) return 'Factura'
    return null
  }
  
  // Detectar nombres confirmados normales
  if (name.includes('-NDC-') || name.includes('-NCC-')) return 'Nota de Crédito'
  if (name.includes('-NDB-')) return 'Nota de Débito'
  if (name.includes('-TIQ-')) return 'Ticket'
  if (name.includes('-FAC-')) return 'Factura'
  
  return null
}

// Función helper para detectar si es nota de crédito desde el nombre (incluyendo temporales)
const isCreditNoteFromName = (documentName) => {
  const detectedType = detectDocumentTypeFromName(documentName)
  return detectedType === 'Nota de Crédito'
}

// Función helper para detectar si es nota de débito desde el nombre (incluyendo temporales)
const isDebitNoteFromName = (documentName) => {
  const detectedType = detectDocumentTypeFromName(documentName)
  return detectedType === 'Nota de Débito'
}

// Función helper para truncar el nombre de factura a los primeros 23 caracteres
const truncateInvoiceNumber = (invoiceName) => {
  if (!invoiceName) return invoiceName

  // Si es un número puro (borrador con numeración nativa de ERPNext), devolverlo tal cual
  if (/^\d+$/.test(invoiceName)) {
    return invoiceName
  }

  // Para facturas con talonarios, mostrar solo los primeros 23 caracteres
  // Ejemplo: 'FM-FAC-A-00003-0000000100003' -> 'FM-FAC-A-00003-00000001'
  if (invoiceName.includes('-') && invoiceName.split('-').length >= 5) {
    const parts = invoiceName.split('-')
    // Mantener los primeros 4 grupos y truncar el último a 8 caracteres
    const result = parts.slice(0, 4).join('-') + '-' + parts[4].substring(0, 8)
    return result
  }

  // Si no tiene el formato esperado, intentar extraer solo números
  // Ejemplo: '0000000100001' -> '00000001' (primeros 8 dígitos)
  const numbersOnly = invoiceName.replace(/\D/g, '')
  if (numbersOnly.length > 8) {
    const result = numbersOnly.substring(0, 8)
    return result
  }

  return invoiceName
}

// Función helper para extraer el número de factura de notas de débito
const extractDebitNoteNumber = (invoiceName) => {
  if (!invoiceName) return invoiceName
  // Para nombres temporales de borradores (DRAFT-...)
  if (invoiceName.startsWith('DRAFT-')) {
    // Extraer el número del método de numeración temporal
    // Ejemplo: 'DRAFT-FE-NDB-A-00003-0000000200001' -> '00000002'
    const parts = invoiceName.split('-')
    if (parts.length >= 6) {
      const numeroCompleto = parts[5] // '0000000200001'
      // Tomar los primeros 8 dígitos como el número base
      return numeroCompleto.substring(0, 8).padStart(8, '0') // '00000002'
    }
  }
  // Para notas de débito confirmadas, extraer solo el último número
  // Ejemplo: 'FM-NDB-A-00003-00000001' -> '00000001'
  if (invoiceName.includes('NDB') && invoiceName.includes('-')) {
    const parts = invoiceName.split('-')
    return parts[parts.length - 1] // Última parte es el número
  }
  // Para otros casos, usar truncateInvoiceNumber
  return truncateInvoiceNumber(invoiceName)
}

// Mapeo de códigos numéricos de provincia a códigos ISO
const NUMERIC_TO_ISO_PROVINCE = {
  '901': 'AR-C',  // CABA
  '902': 'AR-B',  // Buenos Aires
  '903': 'AR-K',  // Catamarca
  '904': 'AR-X',  // Córdoba
  '905': 'AR-W',  // Corrientes
  '906': 'AR-H',  // Chaco
  '907': 'AR-U',  // Chubut
  '908': 'AR-E',  // Entre Ríos
  '909': 'AR-P',  // Formosa
  '910': 'AR-Y',  // Jujuy
  '911': 'AR-L',  // La Pampa
  '912': 'AR-F',  // La Rioja
  '913': 'AR-M',  // Mendoza
  '914': 'AR-N',  // Misiones
  '915': 'AR-Q',  // Neuquén
  '916': 'AR-R',  // Río Negro
  '917': 'AR-A',  // Salta
  '918': 'AR-J',  // San Juan
  '919': 'AR-D',  // San Luis
  '920': 'AR-Z',  // Santa Cruz
  '921': 'AR-S',  // Santa Fe
  '922': 'AR-G',  // Santiago del Estero
  '923': 'AR-V',  // Tierra del Fuego
  '924': 'AR-T',  // Tucumán
}

// Normalizar código de provincia: convertir numérico a ISO si es necesario
const normalizeProvinceCodeToISO = (code) => {
  if (!code) return null
  // Si ya es ISO, retornarlo
  if (code.startsWith && code.startsWith('AR-')) return code
  // Si es numérico, convertir a ISO
  return NUMERIC_TO_ISO_PROVINCE[code] || code
}

const toPositiveNumber = (value) => {
  const parsed = parseFloat(value)
  if (Number.isNaN(parsed)) return value === '' ? '' : 0
  const normalized = Math.abs(parsed)
  if (typeof value === 'string') {
    return normalized.toString()
  }
  return normalized
}

// Función helper para extraer percepciones del array de taxes usando custom fields del nuevo modelo
// Los taxes que son percepciones tienen custom_is_perception = 1 y custom_perception_type definido
const extractPerceptionsFromTaxes = (taxes) => {
  if (!taxes || !Array.isArray(taxes)) return []
  
  return taxes
    .filter(tax => tax.custom_is_perception === 1 || tax.custom_is_perception === true)
    .map(tax => ({
      perception_type: tax.custom_perception_type || 'IVA',
      scope: tax.custom_perception_scope || 'INTERNA',
      province_code: normalizeProvinceCodeToISO(tax.custom_province_code),
      regimen_code: tax.custom_regimen_code || '',
      percentage: toPositiveNumber(tax.custom_percentage) || null,
      base_amount: toPositiveNumber(tax.tax_amount_after_discount_amount) || toPositiveNumber(tax.base_total) || null,
      total_amount: toPositiveNumber(tax.tax_amount) || 0
    }))
}

// Normaliza cantidades y totales negativos de notas de cr‚dito para mostrarlos positivos en el UI
const normalizeCreditNoteDataForUI = (data) => {
  if (!data || typeof data !== 'object') return data

  const toPositive = (value) => {
    if (value === null || value === undefined || value === '') return value
    const num = parseFloat(value)
    if (Number.isNaN(num)) return value
    const normalized = Math.abs(num)
    return typeof value === 'string' ? normalized.toString() : normalized
  }

  const normalizedItems = (data.items || []).map(item => ({
    ...item,
    qty: toPositive(item.qty),
    amount: toPositive(item.amount),
    discount_amount: toPositive(item.discount_amount)
  }))

  const normalizedSelectedInvoices = (data.selected_unpaid_invoices || []).map(entry => ({
    ...entry,
    amount: toPositive(entry.amount),
    allocated_amount: toPositive(entry.allocated_amount)
  }))

  const normalizedPerceptions = (data.perceptions || []).map(perception => ({
    ...perception,
    percentage: toPositive(perception.percentage),
    base_amount: toPositive(perception.base_amount),
    total_amount: toPositive(perception.total_amount)
  }))

  const summaryFields = {}
  ;[
    'discount_amount',
    'net_gravado',
    'net_no_gravado',
    'total_iva',
    'percepcion_iva',
    'percepcion_iibb',
    'credit_note_total',
    'grand_total',
    'outstanding_amount'
  ].forEach(key => {
    if (key in data) {
      summaryFields[key] = toPositive(data[key])
    }
  })

  return {
    ...data,
    ...summaryFields,
    items: normalizedItems,
    selected_unpaid_invoices: normalizedSelectedInvoices,
    perceptions: normalizedPerceptions
  }
}

// Función helper para calcular el siguiente número disponible para un talonario
// ACTUALIZADO: Ahora usa solo facturas confirmadas, no borradores
const getNextAvailableNumber = async (talonario, letra = 'A', fetchWithAuth, tipoComprobante = null, excludeName = null) => {
  try {
    // Consultar el backend para obtener el próximo número basado en facturas confirmadas
    const requestData = {
      talonario_name: talonario.name,
      letra: letra
    }
    
    // Agregar tipo_comprobante si se especifica
    if (tipoComprobante) {
      requestData.tipo_comprobante = tipoComprobante
    }
    
    // Agregar exclude_name si se especifica (para excluir documento actual al editar)
    if (excludeName) {
      requestData.exclude_name = excludeName
    }
    
    const response = await fetchWithAuth('/api/comprobantes/next-confirmed-number', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData)
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        return data.data.next_confirmed_number
      }
    }
    
    // Fallback en caso de error: usar numero_de_inicio
    return talonario.numero_de_inicio || 1
    
  } catch (error) {
    // Fallback en caso de error: usar numero_de_inicio
    return talonario.numero_de_inicio || 1
  }
}

// --- COMPONENTE AUXILIAR FORMFIELD ---
const FormField = ({ label, children, className = '' }) => (
    <div className={className}>
      <label className="block text-[11px] font-bold text-gray-500 mb-1 tracking-wide">{label}</label>
      {children}
    </div>
)

const inputStyle = "w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent transition h-7"
const selectStyle = `${inputStyle} bg-white`

const PurchaseInvoiceModal = ({ isOpen, onClose, onSave, onDelete, onSaved, selectedSupplier, editingData, unpaidInvoicesCount, handleOpenItemSettings }) => {
  const { showNotification } = useContext(NotificationContext)
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  
  // Hook para confirmaciones
  const { confirm, ConfirmDialog } = useConfirm()
  
  // Hooks de caché personalizados
  const { getSupplierDetails } = useSupplierCache(fetchWithAuth)
  const { 
    getWarehouses, 
    getPurchasePriceLists, 
    getTalonarios, 
    getPaymentTerms, 
    getTaxTemplates,
    clearCache: clearStaticDataCache 
  } = useStaticDataCache(fetchWithAuth)
  const { currencies, loading: currenciesLoading } = useCurrencies()

  const [companyCurrency, setCompanyCurrency] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [supplierDetails, setsupplierDetails] = useState(null)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [availableWarehouses, setAvailableWarehouses] = useState([])
  const [isEditing, setIsEditing] = useState(false)
  const [editingInvoiceNo, setEditingInvoiceNo] = useState(null)
  const [editingInvoiceFullName, setEditingInvoiceFullName] = useState(null) // Nombre completo para API
  const [showSalesConditionModal, setShowSalesConditionModal] = useState(false)
  const [salesConditionData, setSalesConditionData] = useState({
    condition: 'Contado',
    transmission_option: 'Transferencia Sistema de Circulación Abierta',
    cbu: '',
    associated_documents: [],
    date_from: '',
    date_to: ''
  })

  // Estados para búsqueda predictiva de cuentas
  const [accountSearchResults, setAccountSearchResults] = useState({})
  const [showAccountDropdown, setShowAccountDropdown] = useState({})
  const [taxTemplates, setTaxTemplates] = useState([])
  const [rateToTemplateMap, setRateToTemplateMap] = useState({})
  const [ivaRateAccountMap, setIvaRateAccountMap] = useState({})
  const [availableIVARates, setAvailableIVARates] = useState([])
  const [exchangeRate, setExchangeRate] = useState(1)
  const [exchangeRateDate, setExchangeRateDate] = useState('')
  const [isLoadingExchangeRate, setIsLoadingExchangeRate] = useState(false)
  const [freshInvoiceData, setFreshInvoiceData] = useState(null)
  const [paymentTerms, setPaymentTerms] = useState([])
  const [comprobanteOptions, setComprobanteOptions] = useState([])
  const [selectedComprobanteOption, setSelectedComprobanteOption] = useState(null)
  const [availableLetters, setAvailableLetters] = useState([])
  const [availableComprobantes, setAvailableComprobantes] = useState([])
  const [availableTalonarios, setAvailableTalonarios] = useState([])
  const [filteredTalonarios, setFilteredTalonarios] = useState([])
  const [selectedPuntoVenta, setSelectedPuntoVenta] = useState('')
  const [availablePriceLists, setAvailablePriceLists] = useState([])
  const [selectedPriceListDetails, setSelectedPriceListDetails] = useState(null)

  // Caché para evitar llamadas repetitivas a getNextAvailableNumber
  const numberCacheRef = useRef(new Map())
  const unpaidInvoicesLoadedRef = useRef({ supplier: null, isCreditNote: false })

  // Ref to prevent duplicate exchange rate fetches
  const exchangeRateFetchRef = useRef(false)

  // Estado para determinar si es nota de crédito
  const [documentIsCreditNote, setDocumentIsCreditNote] = useState(false)

  // Estados para loading de operaciones (provided by operations hook)
  // const [isSaving, setIsSaving] = useState(false) - Now from operations hook
  // const [isDeleting, setIsDeleting] = useState(false) - Now from operations hook

  // Estados para notas de crédito
  const [unpaidInvoices, setUnpaidInvoices] = useState([])
  const [conciliationSummaries, setConciliations] = useState([])
  const [selectedUnpaidInvoices, setSelectedUnpaidInvoices] = useState([])
  const [importedInvoicesKey, setImportedInvoicesKey] = useState('')
  const [showDocumentLinker, setShowDocumentLinker] = useState(false)
  const [quickItemContext, setQuickItemContext] = useState(null)
  const [pendingItemModal, setPendingItemModal] = useState({ isOpen: false, item: null, itemIndex: null })
  const [itemSettingsModal, setItemSettingsModal] = useState({ isOpen: false, item: null, itemIndex: null, customer: null, onSaveItemSettings: null })

  const supplierPaymentTermName = useMemo(() => {
    if (!supplierDetails || typeof supplierDetails.payment_terms !== 'string') {
      return ''
    }
    return supplierDetails.payment_terms.trim()
  }, [supplierDetails?.payment_terms])
  const supplierHasPaymentTerm = Boolean(supplierPaymentTermName)

  const [formData, setFormData] = useState({
    bill_date: new Date().toISOString().split('T')[0],
    posting_date: new Date().toISOString().split('T')[0],
    due_date: new Date().toISOString().split('T')[0],
    invoice_number: '00000001',
    invoice_type: 'Factura',
    voucher_type: 'Purchase Invoice',
    invoice_category: 'A',
    punto_de_venta: '',
    status: 'Confirmada',
    title: '',
    supplier: selectedSupplier || '',
    currency: companyCurrency,
    exchange_rate: 1,
    price_list: '',
    sales_condition_type: 'Contado',
    sales_condition_amount: '',
    sales_condition_days: '',
    metodo_numeracion_factura_venta: '',
    return_against: '',
    items: Array.from({ length: 3 }, () => ({
      item_code: '',
      item_name: '',
      description: '',
      warehouse: '',
      cost_center: '',
      uom: 'Unidad',
      qty: '1',
      rate: '0.00',
      discount_percent: '0.00',
      iva_percent: '21.00',
      amount: '0.00',
      account: '',
      item_tax_template: '',
      item_tax_rate: ''
    })),
    taxes: [],
    discount_amount: '0.00',
    net_gravado: '0.00',
    net_no_gravado: '0.00',
    total_iva: '0.00',
    percepcion_iva: '0.00',
    percepcion_iibb: '0.00',
    selected_unpaid_invoices: [],
    credit_note_total: '0.00'
  })

  // Custom hooks for effects and operations
  const {
    numberCacheRef: effectsNumberCacheRef,
    exchangeRateFetchRef: effectsExchangeRateFetchRef
  } = usePurchaseInvoiceEffects(
    isOpen,
    selectedSupplier,
    formData,
    isEditing,
    editingData,
    paymentTerms,
    availableTalonarios,
    comprobanteOptions,
    selectedComprobanteOption,
    companyCurrency,
    companyName,
    availablePriceLists,
    supplierDetails,
    activeCompanyDetails,
    rateToTemplateMap,
    fetchWithAuth,
    getSupplierDetails,
    getWarehouses,
    getPurchasePriceLists,
    getTalonarios,
    getPaymentTerms,
    getTaxTemplates,
    clearStaticDataCache,
    determineComprobanteOptions,
    filterTalonariosByComprobanteType,
    fetchPurchasePriceListDetails,
    getDefaultIVARate,
    calculateDueDate,
    calculateItemAmount,
    setFormData,
    setCompanyCurrency,
    setCompanyName,
    setsupplierDetails,
    setActiveCompanyDetails,
    setAvailableWarehouses,
    setAvailableTalonarios,
    setPaymentTerms,
    setTaxTemplates,
    setRateToTemplateMap,
    setIvaRateAccountMap,
    setAvailableIVARates,
    setAvailablePriceLists,
    setSelectedPriceListDetails,
    setFilteredTalonarios,
    setComprobanteOptions,
    setAvailableLetters,
    setAvailableComprobantes,
    setSelectedComprobanteOption,
    setExchangeRate,
    setExchangeRateDate,
    setIsLoadingExchangeRate,
    setFreshInvoiceData,
    setDocumentIsCreditNote,
    setUnpaidInvoices,
    setImportedInvoicesKey,
    showNotification
  )

  const {
    isSaving,
    setIsSaving,
    isDeleting,
    setIsDeleting,
    handleSave,
    handleDelete: operationsHandleDelete
  } = usePurchaseInvoiceOperations(
    formData,
    setFormData,
    isEditing,
    editingInvoiceFullName,
    supplierDetails,
    selectedSupplier,
    fetchWithAuth,
    showNotification,
    onClose,
    onDelete,
    onSaved,
    calculateTotal,
    isCreditNote,
    companyCurrency
  )

  // Initialize handlers using imported functions
  const handleInputChange = createHandleInputChange(
    setFormData,
    (currency) => fetchExchangeRate(
      currency,
      formData.bill_date || formData.posting_date,
      companyCurrency,
      setExchangeRate,
      setExchangeRateDate,
      setFormData,
      setIsLoadingExchangeRate,
      showNotification,
      fetchWithAuth
    ),
    setExchangeRateDate,
    formData,
    fetchWithAuth,
    setSelectedPriceListDetails,
    showNotification,
    companyCurrency
  )

  const handleItemChange = createHandleItemChange(
    setFormData,
    formData.currency,
    formData.exchange_rate,
    selectedPriceListDetails,
    ivaRateAccountMap
  )
  const addItem = createAddItem(setFormData, supplierDetails, activeCompanyDetails, rateToTemplateMap)
  const removeItem = createRemoveItem(setFormData, formData.items)

  // Wrapper para searchItems que incluye activeCompany y fetchWithAuth
  const handleSearchItems = useCallback(async (query) => {
    return new Promise((resolve) => {
      searchItems(query, activeCompany, fetchWithAuth, (results) => {
        resolve(results || [])
      }, () => {})
    })
  }, [activeCompany, fetchWithAuth])

  // Handler for unpaid invoice selection in credit notes
  const handleUnpaidInvoiceSelection = createHandleUnpaidInvoiceSelection(setFormData, unpaidInvoices, showNotification)
  const handleUnpaidInvoiceAmountChange = createHandleUnpaidInvoiceAmountChange()

  // Memoizar funciones de cálculo para evitar recreaciones
  const memoizedCalculateDueDate = useCallback((conditionType, postingDate, terms) => {
    return calculateDueDate(conditionType, postingDate, terms)
  }, [])

  const memoizedCalculateItemAmount = useCallback((item, currency, exchangeRate, priceListDetails) => {
    return calculateItemAmount(item, currency, exchangeRate, priceListDetails)
  }, [])

  const memoizedCalculateNetGravado = useCallback((items) => {
    return calculateNetGravado(items)
  }, [])

  const memoizedCalculateTotalIVA = useCallback((items) => {
    return calculateTotalIVA(items)
  }, [])

  const memoizedCalculateTotal = useCallback((items, formData) => {
    return calculateTotal(items, formData)
  }, [])

  // Effect to clear editing data when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false)
      setEditingInvoiceNo(null)
      setEditingInvoiceFullName(null)
      setFreshInvoiceData(null)
      setDocumentIsCreditNote(false)
      setSelectedComprobanteOption(null)
      setAvailableLetters([])
      setAvailableComprobantes([])
      setComprobanteOptions([])
      setFilteredTalonarios([])
      setSelectedPuntoVenta('')
      setAvailablePriceLists([])
      setSelectedPriceListDetails(null)
      setAccountSearchResults({})
      setShowAccountDropdown({})
      setTaxTemplates([])
      setRateToTemplateMap({})
      setAvailableIVARates([])
      setUnpaidInvoices([])
      setConciliations([])
      setSelectedUnpaidInvoices([])
      setImportedInvoicesKey('')
      setSalesConditionData({
        condition: 'Contado',
        transmission_option: 'Transferencia Sistema de Circulación Abierta',
        cbu: '',
        associated_documents: [],
        date_from: '',
        date_to: ''
      })
      setShowSalesConditionModal(false)
      setIsSaving(false)
      setIsDeleting(false)
      // Clear number cache
      numberCacheRef.current.clear()
      unpaidInvoicesLoadedRef.current = { supplier: null, isCreditNote: false }
      // Clear custom caches
      clearStaticDataCache()
    }
  }, [isOpen, clearStaticDataCache])

  // Effect to load unpaid invoices and conciliations when working on credit notes
  useEffect(() => {
    const isCreditNoteNow = isCreditNote(formData.invoice_type)
    const loadKey = `${selectedSupplier}|${isCreditNoteNow}`
    const lastLoadKey = `${unpaidInvoicesLoadedRef.current.supplier}|${unpaidInvoicesLoadedRef.current.isCreditNote}`
    if (loadKey === lastLoadKey) {
      return
    }

    const loadUnpaidInvoices = async () => {
      if (isOpen && selectedSupplier && isCreditNoteNow) {
        unpaidInvoicesLoadedRef.current = { supplier: selectedSupplier, isCreditNote: true }
        await fetchUnpaidInvoices(
          selectedSupplier,
          fetchWithAuth,
          setUnpaidInvoices,
          setConciliations,
          showNotification
        )
      } else if (unpaidInvoicesLoadedRef.current.supplier !== null || unpaidInvoicesLoadedRef.current.isCreditNote !== false) {
        unpaidInvoicesLoadedRef.current = { supplier: null, isCreditNote: false }
        setUnpaidInvoices([])
        setSelectedUnpaidInvoices([])
        setConciliations([])
      }
    }

    loadUnpaidInvoices()
  }, [isOpen, selectedSupplier, formData.invoice_type, fetchWithAuth, showNotification])



  // Effect to update comprobante selection when letter changes
  // Effect to handle editing data
  useEffect(() => {
    const rawData = freshInvoiceData || editingData

    // Determinar tipos de comprobante - ahora tambi‚n desde el nombre (incluyendo temporales)
    const creditNoteFromTotal = rawData && rawData?.total < 0
    const creditNoteFromName = rawData && isCreditNoteFromName(rawData?.name)
    const debitNoteFromName = rawData && isDebitNoteFromName(rawData?.name)
    const detectedTypeFromName = rawData && detectDocumentTypeFromName(rawData?.name)

    // Priorizar detecci¢n desde el nombre para manejar borradores correctamente
    const creditNote = creditNoteFromName || creditNoteFromTotal
    const debitNote = debitNoteFromName
    const dataToUse = creditNote ? normalizeCreditNoteDataForUI(rawData) : rawData
    
    setDocumentIsCreditNote(creditNote)
    

      if (dataToUse && isOpen) {


      setIsEditing(true)
      setEditingInvoiceNo(truncateInvoiceNumber(dataToUse?.name))
      setEditingInvoiceFullName(dataToUse?.name) // Guardar nombre completo para API

      // Parse metodo_numeracion_factura_venta if it exists, or fallback to parsing the name field for editing
      let parsedMetodoNumeracion = null;
      let metodoNumeracion = creditNote ?
        (dataToUse?.metodo_numeracion_nota_credito || dataToUse?.metodo_numeracion_factura_venta || '') :
        (debitNote ? (dataToUse?.metodo_numeracion_nota_debito || dataToUse?.metodo_numeracion_factura_venta || '') :
        (dataToUse?.metodo_numeracion_factura_venta || ''));

      // For editing, if metodo_numeracion fields are empty but name contains the format, use the name
      if ((!metodoNumeracion || metodoNumeracion.trim() === '') && dataToUse?.name && dataToUse.name.includes('-') && dataToUse.name.split('-').length >= 5) {
        metodoNumeracion = dataToUse.name;
      }



      if (metodoNumeracion && metodoNumeracion.trim() !== '') {
        parsedMetodoNumeracion = parseMetodoNumeracion(metodoNumeracion);
        
        // Handle special case where numero has extra digits (truncate to 8 digits for invoice number)
        if (parsedMetodoNumeracion && parsedMetodoNumeracion.numero && parsedMetodoNumeracion.numero.length > 8) {
          parsedMetodoNumeracion.numero = parsedMetodoNumeracion.numero.substring(0, 8);
        }
        
      } else {
        console.log('❌ NO METODO_NUMERACION TO PARSE - using fallback values');
      }

      // Obtener detalles del supplier usando caché para determinar opciones de comprobante
      const loadSupplierAndComprobanteOptions = async () => {
        let supplierIVACondition = null
        if (dataToUse?.supplier) {
          const supplierData = await getSupplierDetails(dataToUse.supplier)
          if (supplierData) {
            supplierIVACondition = supplierData.custom_condicion_iva
            setsupplierDetails(supplierData) // Actualizar detalles del supplier
          }
        }

        // Determinar opciones de comprobante basadas en la condición IVA del supplier
        // Usa tipos_comprobante y uso_comprobante de afip_codes.json
        determineComprobanteOptions(
          supplierIVACondition,
          setComprobanteOptions,
          setAvailableLetters,
          setAvailableComprobantes,
          setFormData,
          setSelectedComprobanteOption,
          true, // isEditing = true
          afipCodes
        )
      }

      // Ejecutar carga de supplier y opciones de comprobante
      loadSupplierAndComprobanteOptions()

      const normalizedBillDate = dataToUse?.bill_date || dataToUse?.posting_date || new Date().toISOString().split('T')[0]
      const normalizedPostingDate = dataToUse?.posting_date || normalizedBillDate

      setFormData({
        bill_date: normalizedBillDate,
        posting_date: normalizedPostingDate,
        due_date: dataToUse?.due_date || '',
        invoice_number: parsedMetodoNumeracion?.numero || (debitNote ? extractDebitNoteNumber(dataToUse?.name) : '00000001'),
        invoice_type: normalizeInvoiceTypeLabel(
          parsedMetodoNumeracion
            ? getInvoiceTypeFromParsedType(parsedMetodoNumeracion.type)
            : (detectedTypeFromName || (creditNote ? 'Nota de Crédito' : (debitNote ? 'Nota de Débito' : (dataToUse?.invoice_type || 'Factura')))),
          { creditNote, debitNote }
        ),
        voucher_type: parsedMetodoNumeracion?.letter || dataToUse?.voucher_type || 'Fa',
        invoice_category: parsedMetodoNumeracion?.letter || dataToUse?.invoice_category || 'A',
        punto_de_venta: parsedMetodoNumeracion?.punto_venta || dataToUse?.punto_de_venta || '00001',
        status: dataToUse?.docstatus === 1 ? 'Confirmada' : 'Borrador',
        title: dataToUse?.title || '',
        supplier: dataToUse?.supplier || selectedSupplier || '',
        company: dataToUse?.company || companyName || activeCompany || '',
        currency: dataToUse?.currency || companyCurrency,
        exchange_rate: parseFloat(dataToUse?.conversion_rate) || 1,
        price_list: dataToUse?.price_list || '',
        sales_condition_type: dataToUse?.sales_condition_type || 'A',
        sales_condition_amount: dataToUse?.sales_condition_amount || '',
        sales_condition_days: dataToUse?.sales_condition_days || '',
        metodo_numeracion_factura_venta: metodoNumeracion,
        return_against: dataToUse?.return_against || '',
        items: dataToUse?.items ? dataToUse.items.map(item => {
          const { baseRate, netRate, discountAmount, discountPercent } = normalizePurchaseInvoiceItemPricing(item)
          let normalizedIVAPercent = item.iva_percent
          if (item.iva_percent !== null && item.iva_percent !== undefined && item.iva_percent !== '') {
            normalizedIVAPercent = typeof item.iva_percent === 'number' ? item.iva_percent.toString() : item.iva_percent
          } else {
            normalizedIVAPercent = '21'
          }
          const qtyNum = parseFloat(item.qty) || 0
          const ivaNumeric = parseFloat(normalizedIVAPercent) || 0
          const taxable = Math.max(0, qtyNum * netRate)
          const ivaAmount = taxable * (ivaNumeric / 100)
          const amountValue = (taxable + ivaAmount).toFixed(2)

          return {
            item_code: stripAbbr((item.item_code || item.item_name || '').toString()),
            item_name: (item.item_name || item.item_code || '').toString(),
            description: (item.description || item.item_name || '').toString(),
            qty: (item.qty != null ? item.qty.toString() : '1'),
            rate: baseRate ? baseRate.toFixed(2) : (item.rate != null ? parseFloat(item.rate).toFixed(2) : '0.00'),
            net_rate_value: netRate ? netRate.toFixed(2) : '',
            discount_percent: Number(discountPercent || 0).toFixed(2),
            discount_amount: discountAmount.toFixed(2),
            iva_percent: normalizedIVAPercent,
            amount: amountValue,
            warehouse: (item.warehouse || '').toString(),
            cost_center: (item.cost_center || '').toString(),
            uom: (item.uom || 'Unidad').toString(),
            account: (item.account || '').toString(),
            expense_account: (item.expense_account || '').toString(),
            valuation_rate: item.valuation_rate != null ? item.valuation_rate.toString() : '',
            item_tax_template: (item.item_tax_template || '').toString()
          }
        }) : Array.from({ length: 3 }, () => ({
          item_code: '',
          item_name: '',
          description: '',
          qty: '1',
          rate: '0.00',
          discount_amount: '0.00',
          iva_percent: '21',
          amount: '0.00',
          item_tax_template: '',
          expense_account: '',
          valuation_rate: ''
        })),
        taxes: dataToUse.taxes || [],
        // Extraer percepciones del array taxes usando custom fields del nuevo modelo
        perceptions: extractPerceptionsFromTaxes(dataToUse.taxes || []),
        discount_amount: dataToUse.discount_amount?.toString() || '0.00',
        net_gravado: dataToUse.net_gravado?.toString() || '0.00',
        net_no_gravado: dataToUse.net_no_gravado?.toString() || '0.00',
        total_iva: dataToUse.total_iva?.toString() || '0.00',
        percepcion_iva: dataToUse.percepcion_iva?.toString() || '0.00',
        percepcion_iibb: dataToUse.percepcion_iibb?.toString() || '0.00'
      })

      // If it's a credit note and has return_against, load the related invoice
      const returnAgainst = dataToUse?.return_against || editingData?.return_against
      if (creditNote && returnAgainst) {
        const loadRelatedInvoice = async () => {
          const relatedInvoice = await fetchInvoiceDetails(returnAgainst, fetchWithAuth)
          if (relatedInvoice) {
            // Set as selected unpaid invoice in formData
            const appliedAmount = Math.abs(dataToUse.grand_total || dataToUse.total || 0)
            setFormData(prev => ({
              ...prev,
              selected_unpaid_invoices: [{
                name: relatedInvoice.name,
                amount: appliedAmount,
                allocated_amount: appliedAmount
              }],
              credit_note_total: appliedAmount.toString(),
              return_against: relatedInvoice.name
            }))
          } else {
            console.log('No related invoice found')
          }
        }
        loadRelatedInvoice()
      } else {
        console.log('Not loading related invoice - creditNote:', creditNote, 'returnAgainst:', returnAgainst)
      }

      // Actualizar la fecha de la cotización con la fecha de la factura
      if (dataToUse.bill_date || dataToUse.posting_date) {
        setExchangeRateDate(dataToUse.bill_date || dataToUse.posting_date)
      }
    } else if (isOpen && !dataToUse) {

      
      // Reset editing states for new invoice
      setIsEditing(false)
      setEditingInvoiceNo(null)
      setEditingInvoiceFullName(null)
      // For purchase invoices, don't reset selectedPuntoVenta to avoid auto-selection issues
      // This logic is residual from sales invoices
      
      // Reset form for new invoice
      setFormData({
        bill_date: new Date().toISOString().split('T')[0],
        posting_date: new Date().toISOString().split('T')[0],
        due_date: '',
        invoice_number: '00000001',
        invoice_type: 'Factura',
        voucher_type: 'Fa',
        invoice_category: 'A',
        status: 'Confirmada', // <-- Cambiar de 'Borrador' a 'Confirmada' por defecto
        title: '',
        supplier: selectedSupplier || '',
        company: companyName || activeCompany || '',
        currency: companyCurrency,
        exchange_rate: 1,
        price_list: '',
        sales_condition_type: 'A',
        sales_condition_amount: '',
        sales_condition_days: '',
        metodo_numeracion_factura_venta: '',
        return_against: '',
        // Initialize items and set IVA percent based on supplier/company defaults (normalized)
        items: Array.from({ length: 3 }, () => ({
          item_code: '',
          item_name: '',
          description: '',
          warehouse: '',
          cost_center: '',
          uom: 'Unidad',
          qty: '1',
          rate: '0.00',
          discount_percent: '0.00',
          iva_percent: getDefaultIVARate(supplierDetails, activeCompanyDetails, rateToTemplateMap) || '21.00',
          amount: '0.00',
          account: '', // La cuenta de ingresos se determina automáticamente por el backend
          item_tax_template: ''
        })),
        taxes: [],
        perceptions: [], // Nuevo modelo unificado de percepciones
        discount_amount: '0.00',
        net_gravado: '0.00',
        net_no_gravado: '0.00',
        total_iva: '0.00',
        percepcion_iva: '0.00',
        percepcion_iibb: '0.00'
      })

      // Para nueva factura, usar la fecha actual para la cotización
      setExchangeRateDate(new Date().toISOString().split('T')[0])
    }
  }, [freshInvoiceData, editingData, isOpen, selectedSupplier, companyCurrency])

  // Effect to regenerate metodo_numeracion_factura_venta when editing and it's empty
  useEffect(() => {
    if (isEditing && isCreditNote(formData.invoice_type) && (!formData.metodo_numeracion_factura_venta || formData.metodo_numeracion_factura_venta.trim() === '') && selectedPuntoVenta && availableTalonarios.length > 0) {
      const currentTalonario = availableTalonarios.find(t => t.punto_de_venta === selectedPuntoVenta)
      
      if (currentTalonario) {
        // Determinar prefijo FE/FM según el tipo de factura y configuración del talonario
        let prefix = 'FM'  // Default a manual
        if (formData.invoice_type === 'Factura') {
          prefix = 'FE'
        } else {
          // Para cualquier otro tipo (incluyendo "Factura"), usar el flag del talonario
          prefix = currentTalonario.factura_electronica === 1 || currentTalonario.factura_electronica === true ? 'FE' : 'FM'
        }

        // Determinar tipo base según el tipo de factura actual
        let tipoBase = 'NDC'  // Para notas de crédito

        // Usar la letra actual del formulario
        const letra = formData.invoice_category

        // Formatear punto de venta (5 dígitos)
        const puntoVenta = String(currentTalonario.punto_de_venta).padStart(5, '0')
        
        // Para edición, usar el número actual de la factura
        const numeroActual = formData.invoice_number || '00000001'
        const numeroInicio = numeroActual.toString().padStart(8, '0')

        // Generar el método de numeración
        const metodoNumeracion = `${prefix}-${tipoBase}-${letra}-${puntoVenta}-${numeroInicio}`

        // IMPORTANTE: Siempre usar el método generado con el tipo y letra correctos
        const metodoToUse = metodoNumeracion

        setFormData(prev => ({
          ...prev,
          metodo_numeracion_factura_venta: metodoToUse
        }))
      }
    }
  }, [isEditing, formData.invoice_type, formData.metodo_numeracion_factura_venta, selectedPuntoVenta, availableTalonarios, formData.invoice_category, formData.invoice_number])

  const formatCurrency = (amount) => {
    const numAmount = parseFloat(amount) || 0
    const resolvedCurrency = (formData.currency || companyCurrency || '').toString().trim()
    if (!resolvedCurrency) {
      return new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(numAmount)
    }
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: resolvedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numAmount)
  }

  const formatNumber = (amount) => {
    const numAmount = parseFloat(amount) || 0
    return new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numAmount)
  }

  const handleAccountInputChange = (itemIndex, value) => {
    // Update the item account
    handleItemChange(itemIndex, 'account', value)
    
    if (value.length >= 3) {
      searchAccounts(value, itemIndex, fetchWithAuth, setAccountSearchResults, setShowAccountDropdown)
    } else {
      setAccountSearchResults(prev => ({ ...prev, [itemIndex]: [] }))
      setShowAccountDropdown(prev => ({ ...prev, [itemIndex]: false }))
    }
  }

  const handleAccountFocus = (itemIndex) => {
    const currentValue = formData.items[itemIndex]?.account || ''
    if (currentValue.length >= 3) {
      searchAccounts(currentValue, itemIndex, fetchWithAuth, setAccountSearchResults, setShowAccountDropdown)
    } else {
      setShowAccountDropdown(prev => ({ ...prev, [itemIndex]: false }))
    }
  }

  const selectAccount = (account, itemIndex) => {
    handleItemChange(itemIndex, 'account', account.name)
    setShowAccountDropdown(prev => ({ ...prev, [itemIndex]: false }))
    setAccountSearchResults(prev => ({ ...prev, [itemIndex]: [] }))
  }

  // handleSave function now provided by operations hook

  const handleDelete = async () => {
    if (!isEditing || !editingInvoiceNo) {
      showNotification('No hay factura para eliminar', 'error')
      return
    }



    const confirmed = await confirm({
      title: 'Eliminar Factura',
      message: `¿Estás seguro de que quieres eliminar la factura "${editingInvoiceFullName}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      type: 'error'
    })

    if (confirmed) {
      // Use the delete function from operations hook with the full name
      await operationsHandleDelete(editingInvoiceFullName)
    }
  }

  const resetForm = () => {
    const defaultIVARate = getDefaultIVARate()
    setFormData({
      bill_date: new Date().toISOString().split('T')[0],
      posting_date: new Date().toISOString().split('T')[0],
      due_date: '',
      invoice_number: '0001',
      invoice_type: 'Factura',
      voucher_type: 'Fa',
      invoice_category: 'A',
      status: 'Confirmada', // <-- Cambiar de 'Borrador' a 'Confirmada' por defecto
      title: '',
      supplier: selectedSupplier || '',
      currency: companyCurrency,
      exchange_rate: 1,
      price_list: '',
      return_against: '',
      items: Array.from({ length: 3 }, () => ({
        item_code: '',
        item_name: '',
        description: '',
        warehouse: '',
        cost_center: '',
        uom: 'Unidad',
        qty: '1',
        rate: '0.00',
        discount_percent: '0.00',
        iva_percent: defaultIVARate,
        amount: '0.00',
        account: '', // La cuenta de ingresos se determina automáticamente por el backend
        item_tax_template: ''
      })),
      taxes: [],
      discount_amount: '0.00',
      net_gravado: '0.00',
      net_no_gravado: '0.00',
      total_iva: '0.00',
      percepcion_iva: '0.00',
      percepcion_iibb: '0.00'
    })
    setIsEditing(false)
    setEditingInvoiceNo(null)
    setEditingInvoiceFullName(null)
    setImportedInvoicesKey('') // Limpiar el estado de importación
  }

  const handleSalesConditionChange = (field, value) => {
    setSalesConditionData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const addAssociatedDocument = () => {
    setSalesConditionData(prev => ({
      ...prev,
      associated_documents: [
        ...prev.associated_documents,
        { voucher_type: '', voucher_no: '' }
      ]
    }))
  }

  const updateAssociatedDocument = (index, field, value) => {
    setSalesConditionData(prev => ({
      ...prev,
      associated_documents: prev.associated_documents.map((doc, i) =>
        i === index ? { ...doc, [field]: value } : doc
      )
    }))
  }

  const handleSaveItemSettings = (itemIndex, settings) => {
    
    // Actualizar el ítem con la configuración guardada
    setFormData(prevFormData => ({
      ...prevFormData,
      items: prevFormData.items.map((item, index) => 
        index === itemIndex 
          ? {
              ...item,
              expense_account: settings.expense_account || item.expense_account,
              warehouse: settings.warehouse || item.warehouse,
              cost_center: settings.cost_center || item.cost_center,
              valuation_rate: settings.valuation_rate || item.valuation_rate
            }
          : item
      )
    }))
    
  }

  const fallbackHandleOpenItemSettings = useCallback((item, itemIndex, onSaveItemSettings) => {
    setItemSettingsModal({
      isOpen: true,
      item,
      itemIndex,
      customer: supplierDetails || null,
      onSaveItemSettings: typeof onSaveItemSettings === 'function' ? onSaveItemSettings : null
    })
  }, [supplierDetails])

  const handleLinkedDocumentsImport = useCallback(({ mergeStrategy, linkedDocuments, multiMakeResult }) => {
    const isCreditNoteImport = isCreditNote(formData.invoice_type)

    if (multiMakeResult && multiMakeResult.combined_document) {
      const baseCombinedDoc = multiMakeResult.combined_document || {}
      const combinedDoc = isCreditNoteImport ? normalizeCreditNoteDataForUI(baseCombinedDoc) : baseCombinedDoc
      const invoiceSummaries = multiMakeResult.invoice_summaries || []

      const normalizedItems = (combinedDoc.items || []).map(item => ({
        item_code: item.item_code || '',
        item_name: item.item_name || '',
        description: item.description || '',
        qty: item.qty != null ? item.qty.toString() : '1',
        rate: item.rate != null ? item.rate.toString() : '0.00',
        discount_percent: (
          item.discount_percent != null
            ? item.discount_percent
            : item.discount_percentage != null
              ? item.discount_percentage
              : '0.00'
        ).toString(),
        discount_amount: item.discount_amount != null ? item.discount_amount.toString() : '0.00',
        iva_percent: item.iva_percent != null ? item.iva_percent.toString() : '21',
        amount: item.amount != null ? item.amount.toString() : '0.00',
        warehouse: item.warehouse || '',
        cost_center: item.cost_center || '',
        uom: item.uom || 'Unidad',
        account: item.account || '',
        expense_account: item.expense_account || '',
        item_tax_template: item.item_tax_template || '',
        item_tax_rate: item.item_tax_rate || '',
        purchase_receipt: item.purchase_receipt || '',
        pr_detail: item.pr_detail || item.purchase_receipt_item || '',
        purchase_receipt_item: item.purchase_receipt_item || '',
        purchase_order: item.purchase_order || '',
        po_detail: item.po_detail || item.purchase_order_item || '',
        purchase_order_item: item.purchase_order_item || '',
        purchase_invoice_item: item.purchase_invoice_item || item.name || ''
      }))

      let unpaidSelections = invoiceSummaries.map(summary => ({
        name: summary.return_against || summary.source_name,
        amount: summary.suggested_amount || 0,
        allocated_amount: summary.suggested_amount || 0
      }))
      if (isCreditNoteImport) {
        unpaidSelections = normalizeCreditNoteDataForUI({ selected_unpaid_invoices: unpaidSelections }).selected_unpaid_invoices || unpaidSelections
      }
      const totalSelected = unpaidSelections.reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)
      const taxesFromDoc = Array.isArray(combinedDoc.taxes) ? combinedDoc.taxes : []
      const normalizedPerceptions = extractPerceptionsFromTaxes(taxesFromDoc)

      setFormData(prev => {
        const baseForm = {
          ...prev,
          supplier: combinedDoc.supplier || prev.supplier,
          company: combinedDoc.company || prev.company || companyName || activeCompany,
          currency: combinedDoc.currency || prev.currency,
          price_list: combinedDoc.buying_price_list || prev.price_list,
          taxes: taxesFromDoc.length ? taxesFromDoc : prev.taxes,
          perceptions: normalizedPerceptions,
          items: normalizedItems.length > 0 ? normalizedItems : prev.items,
          discount_amount: (combinedDoc.discount_amount != null ? combinedDoc.discount_amount : prev.discount_amount || 0).toString(),
          net_gravado: (combinedDoc.net_gravado != null
            ? combinedDoc.net_gravado
            : (combinedDoc.net_total != null ? combinedDoc.net_total : prev.net_gravado || 0)).toString(),
          net_no_gravado: (combinedDoc.net_no_gravado != null ? combinedDoc.net_no_gravado : prev.net_no_gravado || 0).toString(),
          total_iva: (combinedDoc.total_iva != null
            ? combinedDoc.total_iva
            : (combinedDoc.total_taxes_and_charges != null ? combinedDoc.total_taxes_and_charges : prev.total_iva || 0)).toString(),
          percepcion_iva: (combinedDoc.percepcion_iva != null ? combinedDoc.percepcion_iva : prev.percepcion_iva || 0).toString(),
          percepcion_iibb: (combinedDoc.percepcion_iibb != null ? combinedDoc.percepcion_iibb : prev.percepcion_iibb || 0).toString(),
          selected_unpaid_invoices: unpaidSelections,
          credit_note_total: totalSelected.toString()
        }
        const { selected_unpaid_invoices, credit_note_total } = clampSelectedInvoicesToCreditLimit(baseForm)
        return {
          ...baseForm,
          selected_unpaid_invoices,
          credit_note_total
        }
      })

      showNotification('Nota de crédito generada desde facturas seleccionadas', 'success')
      return
    }

    if (!linkedDocuments || linkedDocuments.length === 0) {
      showNotification('Seleccioná al menos un documento para importar', 'warning')
      return
    }

    const patches = linkedDocuments
      .map(entry => buildPurchaseInvoicePatchFromDocument(entry.document))
      .filter(patch => patch && Array.isArray(patch.items) && patch.items.length > 0)

    if (patches.length === 0) {
      showNotification('Los documentos seleccionados no tienen ítems pendientes', 'warning')
      return
    }

    const reference = patches[0]
    let importedItems = patches.flatMap(patch => patch.items || [])
    const aggregatedTaxes = patches.reduce((acc, patch) => {
      if (Array.isArray(patch.taxes) && patch.taxes.length) {
        return acc.concat(patch.taxes)
      }
      return acc
    }, [])
    const mergedTaxes = aggregatedTaxes.length ? aggregatedTaxes : (reference.taxes || [])
    const normalizedAggregatedPerceptions = extractPerceptionsFromTaxes(mergedTaxes)
    if (isCreditNoteImport) {
      const normalized = normalizeCreditNoteDataForUI({ items: importedItems })
      importedItems = normalized.items || importedItems
    }
    const normalizeName = (val) => (val || '').trim().toLowerCase()
    const isPriceListAllowed = (plName) => {
      if (!plName) return false
      return availablePriceLists.some(pl =>
        normalizeName(pl.name) === normalizeName(plName) &&
        (!pl.custom_company || normalizeName(pl.custom_company) === normalizeName(companyName || activeCompany))
      )
    }

    setFormData(prev => {
      const preservedItems = mergeStrategy === 'append'
        ? (prev.items || []).filter(item => item.item_code || item.description)
        : []

      const mergedItems = [...preservedItems, ...importedItems]

      const baseForm = {
        ...prev,
        bill_date: reference.bill_date || reference.posting_date || prev.bill_date || prev.posting_date,
        posting_date: reference.posting_date || prev.posting_date,
        supplier: reference.supplier || prev.supplier,
        company: reference.company || prev.company,
        currency: reference.currency || prev.currency,
        price_list: isPriceListAllowed(reference.price_list) ? reference.price_list : prev.price_list,
        taxes: mergedTaxes.length ? mergedTaxes : prev.taxes,
        perceptions: normalizedAggregatedPerceptions,
        status: 'Confirmada',
        items: mergedItems,
        percepcion_iva: (reference.percepcion_iva != null ? reference.percepcion_iva : prev.percepcion_iva || 0).toString(),
        percepcion_iibb: (reference.percepcion_iibb != null ? reference.percepcion_iibb : prev.percepcion_iibb || 0).toString()
      }

      if ((baseForm.selected_unpaid_invoices?.length || 0) > 0) {
        const { selected_unpaid_invoices, credit_note_total } = clampSelectedInvoicesToCreditLimit(baseForm)
        return {
          ...baseForm,
          selected_unpaid_invoices,
          credit_note_total
        }
      }

      return baseForm
    })

    showNotification('Ítems importados desde documentos vinculados', 'success')
  }, [setFormData, showNotification, availablePriceLists, companyName, activeCompany, formData.invoice_type])

  const handleRequestQuickCreate = useCallback((item, index) => {
    const supplierValue = formData.supplier || selectedSupplier
    if (!supplierValue) {
      showNotification('Seleccioná un proveedor antes de crear un item nuevo', 'warning')
      return
    }
    setQuickItemContext({
      index,
      item,
      rate: item?.rate,
      description: item?.description,
      code: item?.item_code
    })
  }, [formData.supplier, selectedSupplier, showNotification])

  const handleQuickItemCreated = useCallback((result) => {
    if (!quickItemContext) return
    const { index } = quickItemContext
    if (typeof index !== 'number') return

    const createdItem = result?.item || {}
    const purchasePrice = result?.purchase_price
    const resolvedRate = purchasePrice?.price_list_rate ?? quickItemContext.rate
    const existingItem = formData.items?.[index] || {}

    const updates = {
      item_code: createdItem.item_code || quickItemContext.item?.item_code || existingItem.item_code || '',
      item_name: createdItem.item_name || quickItemContext.item?.item_name || existingItem.item_name || '',
      description: createdItem.description || createdItem.item_name || quickItemContext.item?.description || existingItem.description || '',
      uom: createdItem.stock_uom || existingItem.uom || 'Unidad',
      item_tax_template: createdItem.item_tax_template || existingItem.item_tax_template || ''
    }

    if (resolvedRate !== undefined && resolvedRate !== null && !Number.isNaN(Number(resolvedRate))) {
      const formattedRate = Number(resolvedRate).toFixed(2)
      updates.rate = formattedRate
      updates.valuation_rate = formattedRate
    }

    Object.entries(updates).forEach(([field, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        handleItemChange(index, field, value.toString())
      }
    })

    if (createdItem.item_defaults && Array.isArray(createdItem.item_defaults)) {
      handleItemChange(index, 'item_defaults', createdItem.item_defaults)
      const defaultForCompany = createdItem.item_defaults.find(def => def.company === activeCompany)
      if (defaultForCompany?.default_warehouse) {
        handleItemChange(index, 'warehouse', defaultForCompany.default_warehouse)
      }
    }

    setQuickItemContext(null)
  }, [quickItemContext, handleItemChange, formData.items, activeCompany])

  // ===== Pending Item Resolution Handlers =====
  const handleResolvePendingItem = useCallback((item, index) => {
    const supplierValue = formData.supplier || selectedSupplier
    if (!supplierValue) {
      showNotification('Seleccioná un proveedor antes de resolver el item pendiente', 'warning')
      return
    }
    setPendingItemModal({
      isOpen: true,
      item,
      itemIndex: index
    })
  }, [formData.supplier, selectedSupplier, showNotification])

  const handlePendingItemResolved = useCallback((result) => {
    if (!pendingItemModal.item || pendingItemModal.itemIndex === null) return
    
    const { itemIndex } = pendingItemModal
    const createdItem = result?.item || {}
    
    // Update the item in the form with the new created item data
    const existingItem = formData.items?.[itemIndex] || {}
    
    const updates = {
      item_code: createdItem.item_code || existingItem.item_code || '',
      item_name: createdItem.item_name || existingItem.item_name || '',
      description: createdItem.description || createdItem.item_name || existingItem.description || '',
      uom: createdItem.stock_uom || existingItem.uom || 'Unidad',
      item_tax_template: createdItem.item_tax_template || existingItem.item_tax_template || ''
    }
    
    // Apply all updates to the item
    Object.entries(updates).forEach(([field, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        handleItemChange(itemIndex, field, value.toString())
      }
    })
    
    // Handle item defaults if present
    if (createdItem.item_defaults && Array.isArray(createdItem.item_defaults)) {
      handleItemChange(itemIndex, 'item_defaults', createdItem.item_defaults)
      const defaultForCompany = createdItem.item_defaults.find(def => def.company === activeCompany)
      if (defaultForCompany?.default_warehouse) {
        handleItemChange(itemIndex, 'warehouse', defaultForCompany.default_warehouse)
      }
    }
    
    setPendingItemModal({ isOpen: false, item: null, itemIndex: null })
    showNotification('Item resuelto correctamente', 'success')
  }, [pendingItemModal, handleItemChange, formData.items, activeCompany, showNotification])

  const editingTypeFromName = editingInvoiceFullName ? detectDocumentTypeFromName(editingInvoiceFullName) : null
  const normalizedInvoiceTypeLabel = (formData.invoice_type || '').toString().toLowerCase()
  const hasCreditKeyword = normalizedInvoiceTypeLabel.includes('crédito') || normalizedInvoiceTypeLabel.includes('credito')
  const hasDebitKeyword = normalizedInvoiceTypeLabel.includes('débito') || normalizedInvoiceTypeLabel.includes('debito')
  const isCreditDocument = Boolean(documentIsCreditNote || editingTypeFromName === 'Nota de Crédito' || hasCreditKeyword)
  const isDebitDocument = Boolean(
    (editingInvoiceFullName && editingInvoiceFullName.includes('NDB')) ||
    editingTypeFromName === 'Nota de Débito' ||
    hasDebitKeyword
  )
  const modalDocumentLabel = isCreditDocument ? 'Nota de crédito' : (isDebitDocument ? 'Nota de débito' : 'Factura')
  const modalTitlePrefix = isEditing ? `Editar ${modalDocumentLabel}` : `Nueva ${modalDocumentLabel}`
  const modalTitle = isEditing && editingInvoiceNo ? `${modalTitlePrefix} - ${truncateInvoiceNumber(editingInvoiceNo)}` : modalTitlePrefix

  return (
    <>
    <PurchaseInvoiceModalContainer
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      subtitle={
        supplierDetails?.supplier_name || selectedSupplier
          ? `${supplierDetails?.supplier_name || selectedSupplier}${supplierDetails?.tax_id ? ` · CUIT: ${supplierDetails.tax_id}` : ''}`
          : ''
      }
      size="default"
    >
          <div className="flex flex-col md:flex-row gap-4 h-full overflow-hidden">
            <div className="flex-grow flex flex-col gap-4 overflow-y-auto">
              {/* SECCIÓN SUPERIOR COMPACTA */}
              <PurchaseInvoiceModalHeader
                formData={formData}
                handleInputChange={handleInputChange}
                availableLetters={availableLetters}
                availableComprobantes={availableComprobantes}
                comprobanteOptions={comprobanteOptions}
                setSelectedComprobanteOption={setSelectedComprobanteOption}
                setFormData={setFormData}
                setAvailableComprobantes={setAvailableComprobantes}
                paymentTerms={paymentTerms}
                exchangeRateDate={exchangeRateDate}
                showSalesConditionField={supplierHasPaymentTerm}
                isSalesConditionLocked={supplierHasPaymentTerm}
                lockedSalesConditionName={supplierPaymentTermName}
                allowDueDateEdit={!supplierHasPaymentTerm}
                salesConditionData={salesConditionData}
                setSalesConditionData={setSalesConditionData}
                setShowSalesConditionModal={setShowSalesConditionModal}
                isCreditNote={isCreditNote}
                formatCurrency={formatCurrency}
                FormField={FormField}
                isEditing={isEditing}
                availableTalonarios={filteredTalonarios}
                selectedPuntoVenta={selectedPuntoVenta}
                setSelectedPuntoVenta={setSelectedPuntoVenta}
                fetchWithAuth={fetchWithAuth}
                availablePriceLists={availablePriceLists}
                selectedPriceListDetails={selectedPriceListDetails}
                currencies={currencies}
                currenciesLoading={currenciesLoading}
                companyCurrency={companyCurrency}
              />


              {/* TABLA DE ÍTEMS */}
              <PurchaseItemsTable
                formData={formData}
                handleItemChange={handleItemChange}
                addItem={addItem}
                removeItem={removeItem}
                activeCompany={activeCompany}
                fetchWithAuth={fetchWithAuth}
                showNotification={showNotification}
                // Configuración de columnas para factura de compra
                showPricing={true}
                showWarehouse={false}
                showDiscount={true}
                requireWarehouse={false}
                // Datos de referencia
                availableIVARates={availableIVARates}
                availableWarehouses={availableWarehouses}
                selectedPriceListDetails={selectedPriceListDetails}
                // Funcionalidades
                onRequestQuickCreate={handleRequestQuickCreate}
                onOpenItemSettings={handleOpenItemSettings || fallbackHandleOpenItemSettings}
                onSaveItemSettings={handleSaveItemSettings}
                onResolvePendingItem={handleResolvePendingItem}
                searchItems={handleSearchItems}
                fetchItemPrice={fetchItemPriceInPriceList}
                title="Ítems"
              />

              {/* SECCIÓN DE FACTURAS PENDIENTES PARA NOTAS DE CRÉDITO */}
              <UnpaidInvoicesSection
                isCreditNote={isCreditNote}
                formData={formData}
                unpaidInvoices={unpaidInvoices}
                conciliationSummaries={conciliationSummaries}
                handleUnpaidInvoiceSelection={handleUnpaidInvoiceSelection}
                handleUnpaidInvoiceAmountChange={handleUnpaidInvoiceAmountChange}
                formatCurrency={formatCurrency}
              />

            </div>        
            {/* Calcular totales para el resumen */}
            {(() => {
              const lineSubtotal = (formData.items || []).reduce((acc, item) => {
                const qty = parseFloat(item.qty) || 0
                const rate = parseFloat(item.rate) || 0
                return acc + (qty * rate)
              }, 0)
              const lineDiscountTotal = (formData.items || []).reduce((acc, item) => acc + (parseFloat(item.discount_amount) || 0), 0)
              const invoiceLevelDiscount = parseFloat(formData.discount_amount) || 0
              const totals = {
                subtotal: lineSubtotal,
                discount: lineDiscountTotal + invoiceLevelDiscount,
                iva: memoizedCalculateTotalIVA(formData.items),
                total: memoizedCalculateTotal(formData.items, formData)
              }
              
              return (
                <PurchaseInvoiceSummary
                  formData={formData}
                  totals={totals}
                  formatCurrency={formatCurrency}
                  handleSave={handleSave}
                  handleDelete={handleDelete}
                  editingData={editingData}
                  isSaving={isSaving}
                  isDeleting={isDeleting}
                  setFormData={setFormData}
                  onLinkDocuments={() => setShowDocumentLinker(true)}
                />
              )
            })()}
        
      </div>

      {/* Diálogo de confirmación */}
      <ConfirmDialog />

      {/* Modal de Condición de Venta MiPyME */}
      <SalesConditionModal
        isOpen={showSalesConditionModal}
        onClose={() => setShowSalesConditionModal(false)}
        onSelect={(condition) => {
          setFormData(prev => ({ ...prev, sales_condition_type: condition.name }))
          showNotification('Condición de venta seleccionada correctamente', 'success')
        }}
        currentValue={{ name: formData.sales_condition_type }}
      />
    </PurchaseInvoiceModalContainer>

      <DocumentLinkerModal
        isOpen={showDocumentLinker}
        onClose={() => setShowDocumentLinker(false)}
        context="purchase_invoice"
        supplierName={formData.supplier || selectedSupplier || ''}
        invoiceType={formData.invoice_type}
        company={companyName || activeCompany || ''}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
        onLinked={handleLinkedDocumentsImport}
      />

      <QuickItemCreateModal
        isOpen={Boolean(quickItemContext)}
        onClose={() => setQuickItemContext(null)}
        fetchWithAuth={fetchWithAuth}
        activeCompany={activeCompany}
        supplier={formData.supplier || selectedSupplier || ''}
        initialItemCode={quickItemContext?.item?.item_code || quickItemContext?.code || ''}
        initialDescription={quickItemContext?.item?.description || quickItemContext?.description || ''}
        initialRate={quickItemContext?.item?.rate || quickItemContext?.rate || ''}
        suggestedPriceList={formData.price_list || supplierDetails?.custom_default_price_list || ''}
        defaultCurrency={formData.currency || companyCurrency}
        initialUom={quickItemContext?.item?.uom || quickItemContext?.item?.stock_uom || 'Unidad'}
        availablePriceLists={availablePriceLists}
        showNotification={showNotification}
        onCreated={handleQuickItemCreated}
        contextLabel="Factura de compra"
      />

      <PendingItemResolveModal
        isOpen={pendingItemModal.isOpen}
        onClose={() => setPendingItemModal({ isOpen: false, item: null, itemIndex: null })}
        fetchWithAuth={fetchWithAuth}
        activeCompany={activeCompany}
        pendingItem={pendingItemModal.item}
        showNotification={showNotification}
        onResolved={handlePendingItemResolved}
      />

      <ItemSettingsModal
        isOpen={itemSettingsModal.isOpen}
        onClose={() => setItemSettingsModal({ isOpen: false, item: null, itemIndex: null, customer: null, onSaveItemSettings: null })}
        item={itemSettingsModal.item}
        customer={itemSettingsModal.customer}
        onSaveSettings={(settings) => {
          if (itemSettingsModal.onSaveItemSettings) {
            itemSettingsModal.onSaveItemSettings(itemSettingsModal.itemIndex, settings)
          } else {
            handleSaveItemSettings(itemSettingsModal.itemIndex, settings)
          }
          setItemSettingsModal({ isOpen: false, item: null, itemIndex: null, customer: null, onSaveItemSettings: null })
        }}
      />
    </>
  )
}

export default PurchaseInvoiceModal
