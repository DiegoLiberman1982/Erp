import React, { useState, useEffect, useContext, useRef, useCallback, useMemo } from 'react'
import { AuthContext } from '../../../AuthProvider.jsx'
import { NotificationContext } from '../../../contexts/NotificationContext.jsx'
import { useConfirm } from '../../../hooks/useConfirm.jsx'
import API_ROUTES from '../../../apiRoutes.js'
import { ChevronUp, ChevronDown, Plus, Trash2, Save, FileText, DollarSign, X, Minimize2, Maximize2, Settings, CheckCircle } from 'lucide-react'
import SalesItemSettingsModal from '../SalesItemSettingsModal.jsx'
import afipCodes from '../../../../../shared/afip_codes.json'

// Import separated functions
import { formatCurrency, formatNumber, getDefaultIVARate, getMetodoNumeracionFromTalonario, parseMetodoNumeracionAfip } from './invoiceModalUtils.js'
import { getIvaRatesFromTemplates } from '../../../utils/taxTemplates'
import {
  calculateItemAmount,
  calculateSubtotal,
  calculateNetGravado,
  calculateTotalIVA,
  calculateTotal,
  calculateDueDate
} from './invoiceModalCalculations.js'
import {
  createHandleInputChange,
  createHandleItemChange,
  createAddItem,
  createRemoveItem
} from './invoiceModalHandlers.js'
import {
  fetchExchangeRate,
  fetchPaymentTerms,
  fetchActiveCompanyDetails,
  searchAccounts,
  determineComprobanteOptions,
  fetchAvailableTalonarios,
  fetchAvailableWarehouses,
  fetchSalesPriceLists,
  fetchNextConfirmedNumber
} from './invoiceModalApi.js'

import {
  isCreditNote,
  fetchUnpaidInvoices,
  fetchInvoiceDetails,
  createHandleUnpaidInvoiceSelection,
  createHandleUnpaidInvoiceAmountChange,
  addItemsFromAssociatedInvoices
} from './invoiceModalCreditNotes.js'

import InvoiceModalHeader from './InvoiceModalHeader.jsx'
import UnpaidInvoicesSection from './UnpaidInvoicesSection.jsx'
import { SalesItemsTable } from '../shared'
import InvoiceSummary from './InvoiceSummary.jsx'
import StockErrorModal from './StockErrorModal.jsx'

// Import extractItemCodeDisplay utility
import { extractItemCodeDisplay } from '../../InventoryPanel/inventoryUtils.js'
import useTaxTemplates from '../../../hooks/useTaxTemplates'
import DocumentLinkerModal from '../DocumentLinker/DocumentLinkerModal.jsx'
import { buildSalesInvoicePatchFromDocument } from '../../../utils/documentLinkingTransforms.js'

// Función helper para determinar qué campo de metodo_numeracion usar basado en el tipo de comprobante
const getMetodoNumeracionField = (invoiceType) => {
  if (!invoiceType) return 'metodo_numeracion_factura_venta'
  
  const invoiceTypeLower = invoiceType.toLowerCase()
  
  if (invoiceTypeLower.includes('crédito') || invoiceTypeLower.includes('credito')) {
    return 'metodo_numeracion_nota_credito'
  } else if (invoiceTypeLower.includes('débito') || invoiceTypeLower.includes('debito')) {
    return 'metodo_numeracion_nota_debito'
  } else {
    return 'metodo_numeracion_factura_venta'
  }
}

// Helpers to access shared AFIP codes
const getCodesByTipo = (tipo) => {
  if (!tipo) return []
  return Object.entries(afipCodes.comprobantes || {})
    .filter(([, info]) => info && info.tipo && String(info.tipo).toUpperCase() === String(tipo).toUpperCase())
    .map(([code]) => String(code).padStart(3, '0'))
    .sort((a, b) => parseInt(a) - parseInt(b))
}

const pickCodeByLetter = (tipo, letra) => {
  const codes = getCodesByTipo(tipo)
  if (!codes || codes.length === 0) return null
  const index = letra === 'A' ? 0 : letra === 'B' ? 1 : letra === 'C' ? 2 : 0
  return codes[index] || codes[0]
}

// Función helper para detectar tipo de comprobante desde el nombre (incluyendo nombres temporales)
const detectDocumentTypeFromName = (documentName) => {
  if (!documentName) return null
  
  const name = documentName.toString()
  
  // Detectar nombres temporales de borradores
  if (name.startsWith('DRAFT-')) {
    const cleanName = name.replace('DRAFT-', '')
    if (cleanName.includes('-NDC-')) return 'Nota de Crédito'
    if (cleanName.includes('-NDB-')) return 'Nota de Débito'
    if (cleanName.includes('-FAC-')) return 'Factura'
    return null
  }
  
  // Detectar nombres confirmados normales
  if (name.includes('-NDC-')) return 'Nota de Crédito'
  if (name.includes('-NDB-')) return 'Nota de Débito'
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

const TALONARIO_TYPES_FOR_INVOICES = [
  'TALONARIOS DE RESGUARDO',
  'FACTURA ELECTRONICA',
  'COMPROBANTES DE EXPORTACION ELECTRONICOS'
]

const DEFAULT_ALLOWED_LETTERS = ['A', 'B', 'C', 'E', 'M', 'X', 'T', 'R']

const normalizeConditionValue = (value) => {
  if (!value) return ''
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

const getAllowedLettersForCondition = (condition) => {
  const normalized = normalizeConditionValue(condition)
  if (!normalized) {
    return DEFAULT_ALLOWED_LETTERS
  }

  if (normalized.includes('RESPONSABLE INSCRIPTO') || normalized.includes('MONOTRIBUT')) {
    return ['A', 'B', 'C', 'E', 'M', 'X', 'T']
  }

  if (normalized.includes('CONSUMIDOR FINAL') || normalized.includes('EXENTO')) {
    return ['B', 'C', 'X']
  }

  return DEFAULT_ALLOWED_LETTERS
}

const talonarioMatchesAllowedType = (talonario) => {
  const type = normalizeConditionValue(talonario?.tipo_de_talonario)
  return TALONARIO_TYPES_FOR_INVOICES.includes(type)
}

const talonarioHasAllowedLetter = (talonario, allowedLettersSet) => {
  if (!talonario || !Array.isArray(talonario.letras) || talonario.letras.length === 0) {
    return false
  }

  return talonario.letras.some(entry => {
    const letterValue = normalizeConditionValue(entry?.letra)
    return allowedLettersSet.has(letterValue)
  })
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

const getNowMs = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

const formatDurationSeconds = (ms) => (ms / 1000).toFixed(2)

// Hook para loggear tiempos clave del modal en la consola
const useInvoiceModalPerformanceLogger = (isOpen) => {
  const startTimeRef = useRef(null)
  const stepCounterRef = useRef(0)

  useEffect(() => {
    if (isOpen) {
      startTimeRef.current = getNowMs()
      stepCounterRef.current = 0
      console.log('[InvoiceModal][Perf] Modal abierto, cronometro iniciado')
    } else if (startTimeRef.current) {
      const totalSeconds = formatDurationSeconds(getNowMs() - startTimeRef.current)
      console.log(`[InvoiceModal][Perf] Modal cerrado. Tiempo total ${totalSeconds}s`)
      startTimeRef.current = null
      stepCounterRef.current = 0
    }
  }, [isOpen])

  const logStep = useCallback((label, extraData = null) => {
    const now = getNowMs()
    if (!startTimeRef.current) {
      startTimeRef.current = now
    }
    const relativeSeconds = formatDurationSeconds(now - startTimeRef.current)
    const stepId = ++stepCounterRef.current
    if (extraData !== null) {
      console.log(`[InvoiceModal][Perf][${stepId}][+${relativeSeconds}s] ${label}`, extraData)
    } else {
      console.log(`[InvoiceModal][Perf][${stepId}][+${relativeSeconds}s] ${label}`)
    }
  }, [])

  const timeAsyncStep = useCallback(async (label, fn, extraData = null) => {
    logStep(`Inicio: ${label}`, extraData)
    const stepStart = getNowMs()
    try {
      const result = await fn()
      const durationSeconds = formatDurationSeconds(getNowMs() - stepStart)
      console.log(`[InvoiceModal][Perf] Fin: ${label} en ${durationSeconds}s`)
      return result
    } catch (error) {
      const durationSeconds = formatDurationSeconds(getNowMs() - stepStart)
      console.error(`[InvoiceModal][Perf] Error en ${label} tras ${durationSeconds}s`, error)
      throw error
    }
  }, [logStep])

  return { logStep, timeAsyncStep }
}

// Use central mapping from shared/afip_codes.json
const mapAfipToDocType = (codigoAfip) => {
  if (!codigoAfip && codigoAfip !== 0) return 'FAC'
  const key = String(codigoAfip).padStart(3, '0')
  const info = (afipCodes.comprobantes || {})[key] || {}
  return info.tipo || 'FAC'
}

// Caches para evitar llamadas repetidas durante la sesión
const invoiceStaticCacheStore = {
  perCompany: new Map(),
  perCompanyInflight: new Map(),
  global: new Map(),
  globalInflight: new Map(),
  customers: new Map()
}

const ensureCompanyMap = (store, company) => {
  if (!company) {
    throw new Error('Company scope requerido para este cache')
  }
  if (!store.has(company)) {
    store.set(company, new Map())
  }
  return store.get(company)
}

const fetchStaticDatasetWithCache = (key, fetcher, company = null) => {
  const isCompanyScoped = !!company
  const dataMap = isCompanyScoped
    ? ensureCompanyMap(invoiceStaticCacheStore.perCompany, company)
    : invoiceStaticCacheStore.global

  if (dataMap.has(key)) {
    return Promise.resolve(dataMap.get(key))
  }

  const inflightMap = isCompanyScoped
    ? ensureCompanyMap(invoiceStaticCacheStore.perCompanyInflight, company)
    : invoiceStaticCacheStore.globalInflight

  if (inflightMap.has(key)) {
    return inflightMap.get(key)
  }

  const promise = (async () => {
    const result = await fetcher()
    dataMap.set(key, result)
    inflightMap.delete(key)
    return result
  })().catch(error => {
    inflightMap.delete(key)
    throw error
  })

  inflightMap.set(key, promise)
  return promise
}

/**
 * Invalidate a specific cache key for a company (or global if company is null)
 */
const invalidateCacheKey = (key, company = null) => {
  if (company) {
    const dataMap = invoiceStaticCacheStore.perCompany.get(company)
    if (dataMap) {
      dataMap.delete(key)
    }
  } else {
    invoiceStaticCacheStore.global.delete(key)
  }
}

const cacheCustomerDetails = (customerName, details) => {
  if (!customerName || !details) return
  invoiceStaticCacheStore.customers.set(customerName, details)
}

const getCachedCustomerDetails = (customerName) => {
  if (!customerName) return null
  return invoiceStaticCacheStore.customers.get(customerName) || null
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
        console.log('--- Invoice number: confirmed number retrieved')
        return data.data.next_confirmed_number
      }
    }
    
    console.warn('--- Invoice number: backend did not return next number')
    return null
    
  } catch (error) {
    console.error('Error obteniendo próximo número confirmado:', error)
    return null
  }
}

// --- COMPONENTE MODAL (Integrado) ---
const Modal = ({
  isOpen,
  onClose,
  title,
  subtitle = '',
  children,
  initialPosition = { x: 200, y: 50 },
  size = 'default'
}) => {
  const [isMinimized, setIsMinimized] = useState(false)
  const [position, setPosition] = useState(initialPosition)
  const [isDragging, setIsDragging] = useState(false)
  const modalRef = useRef(null)
  const dragRef = useRef({ offsetX: 0, offsetY: 0 })

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.modal-header') && !e.target.closest('button')) {
      const startX = e.clientX
      const startY = e.clientY
      dragRef.current = {
        offsetX: startX - position.x,
        offsetY: startY - position.y
      }
      setIsDragging(true)
      e.preventDefault()
      e.stopPropagation()
    }
  }, [position])

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !modalRef.current) return
    const newX = e.clientX - dragRef.current.offsetX
    const newY = e.clientY - dragRef.current.offsetY
    const maxX = window.innerWidth - modalRef.current.offsetWidth
    const maxY = window.innerHeight - modalRef.current.offsetHeight
    const clampedX = Math.max(0, Math.min(newX, maxX))
    const clampedY = Math.max(0, Math.min(newY, maxY))
    setPosition({ x: clampedX, y: clampedY })
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  if (!isOpen) return null

  const modalClasses = {
    default: 'w-11/12 max-w-7xl h-auto max-h-[90vh]',
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/10 z-40" style={{ pointerEvents: 'none' }} />
      <div
        ref={modalRef}
        className={`fixed bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl rounded-2xl z-50 flex flex-col transition-all duration-300 pointer-events-auto ${isMinimized ? 'w-80 h-16' : modalClasses[size]}`}
        style={{ top: 0, left: 0, transform: `translate(${position.x}px, ${position.y}px)`, willChange: isDragging ? 'transform' : 'auto', transition: isDragging ? 'none' : 'transform 0.1s ease-out' }}
      >
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-300/60 modal-header bg-gray-100/90 rounded-t-2xl flex-shrink-0" onMouseDown={handleMouseDown} style={{ cursor: 'grab' }}>
          <div className="flex flex-col">
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-bold text-gray-800">{title}</h3>
            </div>
            {subtitle && (
              <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button onClick={() => setIsMinimized(!isMinimized)} className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-200/70 rounded-lg transition-all duration-300" title={isMinimized ? 'Maximizar' : 'Minimizar'}>
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-100/70 rounded-lg transition-all duration-300" title="Cerrar">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {!isMinimized && <div className="p-4 overflow-hidden flex-grow">{children}</div>}
      </div>
    </>
  )
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

const InvoiceModal = ({
  isOpen,
  onClose,
  onSave,
  selectedCustomer,
  editingData,
  unpaidInvoicesCount,
  prefetchedCustomerDetails = null,
  prefillData = null,
  onPrefillConsumed,
  prefetchedTalonarios = null // Talonarios pre-cargados desde el componente padre
}) => {
  const { showNotification } = useContext(NotificationContext)
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { templates: taxTemplatesFromHook, sales: taxSales, purchase: taxPurchase, loading: taxTemplatesLoading, error: taxTemplatesError, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)
  const { confirm, ConfirmDialog } = useConfirm()
  const { logStep, timeAsyncStep } = useInvoiceModalPerformanceLogger(isOpen)
  const [companyCurrency, setCompanyCurrency] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [customerDetails, setCustomerDetails] = useState(null)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [availableWarehouses, setAvailableWarehouses] = useState([])
  const [availablePriceLists, setAvailablePriceLists] = useState([])
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
  const [availableIVARates, setAvailableIVARates] = useState([])
  const [itemSettingsModal, setItemSettingsModal] = useState({ isOpen: false, itemIndex: null, item: null })
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

  const customerPaymentTermName = useMemo(() => {
    if (!customerDetails || typeof customerDetails.payment_terms !== 'string') {
      return ''
    }
    return customerDetails.payment_terms.trim()
  }, [customerDetails?.payment_terms])
  const customerHasPaymentTerm = Boolean(customerPaymentTermName)

  // Estado para determinar si es nota de crédito
  const [documentIsCreditNote, setDocumentIsCreditNote] = useState(false)
  const [talonariosFetchCompleted, setTalonariosFetchCompleted] = useState(false)
  const noTalonarioWarningShownRef = useRef(false)
  // Ref to track loaded unpaid invoices and prevent duplicate fetches
  const unpaidInvoicesLoadedRef = useRef({ customer: null, invoiceType: null })
  // Evita que el modal "se resetee" cuando el padre consume `prefillData`
  const prefillAppliedRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      prefillAppliedRef.current = false
    }
  }, [isOpen])

  const allowedCustomerLetters = useMemo(() => {
    return getAllowedLettersForCondition(customerDetails?.custom_condicion_iva || '')
  }, [customerDetails?.custom_condicion_iva])

  const getTalonarioByPuntoVenta = useCallback((puntoVenta) => {
    if (!puntoVenta) {
      return null
    }

    return filteredTalonarios.find(t => t.punto_de_venta === puntoVenta) || null
  }, [filteredTalonarios])

  const getTalonarioByName = useCallback((talonarioName) => {
    if (!talonarioName) {
      return null
    }

    return filteredTalonarios.find(t => t.name === talonarioName) || null
  }, [filteredTalonarios])

  // Filtrar talonarios según tipo de talonario y condición IVA del cliente
  useEffect(() => {
    if (!isOpen) {
      setFilteredTalonarios(prev => prev.length === 0 ? prev : [])
      return
    }

    if (!talonariosFetchCompleted) {
      return
    }

    if (!Array.isArray(availableTalonarios) || availableTalonarios.length === 0) {
      setFilteredTalonarios(prev => prev.length === 0 ? prev : [])
      // IMPORTANTE: Solo mostrar error si la carga ya terminó (evita falso positivo al abrir modal)
      if (selectedCustomer && talonariosFetchCompleted && companyDataLoaded && !noTalonarioWarningShownRef.current) {
        console.error('❌ [InvoiceModal] ERROR: No se encontraron talonarios configurados', {
          isOpen,
          talonariosFetchCompleted,
          availableTalonarios_length: availableTalonarios?.length || 0,
          availableTalonarios_isArray: Array.isArray(availableTalonarios),
          selectedCustomer,
          noTalonarioWarningShownRef: noTalonarioWarningShownRef.current
        })
        showNotification('No se encontraron talonarios configurados. Configure un talonario.', 'error')
        noTalonarioWarningShownRef.current = true
      }
      return
    }

    const allowedSet = new Set(allowedCustomerLetters.map(letter => letter.toUpperCase()))
    const filtered = availableTalonarios.filter(talonario => {
      if (!talonarioMatchesAllowedType(talonario)) {
        return false
      }

      if (allowedSet.size === 0) {
        return true
      }

      return talonarioHasAllowedLetter(talonario, allowedSet)
    })

    // Only update if the filtered list actually changed
    setFilteredTalonarios(prev => {
      if (prev.length !== filtered.length) return filtered
      const prevNames = prev.map(t => t.name).sort().join(',')
      const filteredNames = filtered.map(t => t.name).sort().join(',')
      return prevNames === filteredNames ? prev : filtered
    })

    if (filtered.length === 0 && selectedCustomer && talonariosFetchCompleted && companyDataLoaded && !noTalonarioWarningShownRef.current) {
      console.error('❌ [InvoiceModal] ERROR: No se encontraron talonarios compatibles con la condición IVA', {
        isOpen,
        talonariosFetchCompleted,
        availableTalonarios_length: availableTalonarios?.length || 0,
        filtered_length: filtered.length,
        allowedCustomerLetters,
        allowedSet: Array.from(allowedSet),
        selectedCustomer,
        availableTalonarios: availableTalonarios.map(t => ({
          name: t.name,
          punto_de_venta: t.punto_de_venta,
          letras_json: t.letras_json,
          tipo_de_talonario: t.tipo_de_talonario
        }))
      })
      showNotification('No se encontraron talonarios compatibles con la condición IVA del cliente. Configure un talonario.', 'error')
      noTalonarioWarningShownRef.current = true
    } else if (filtered.length > 0) {
      noTalonarioWarningShownRef.current = false
    }

    if (isEditing && selectedPuntoVenta && !filtered.some(t => t.punto_de_venta === selectedPuntoVenta)) {
      showNotification('El talonario asignado a la factura no es válido con la condición IVA actual. Configure un talonario.', 'error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    talonariosFetchCompleted,
    availableTalonarios,
    allowedCustomerLetters,
    selectedCustomer,
    isEditing,
    selectedPuntoVenta
  ])

  // Estados para loading de operaciones
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLoadingComprobantes, setIsLoadingComprobantes] = useState(false)

  // Estados para modal de warning cuando se guarda como borrador
  const [showDraftWarningModal, setShowDraftWarningModal] = useState(false)
  const [draftWarningMessage, setDraftWarningMessage] = useState('')
  const [draftWarningType, setDraftWarningType] = useState('general')

  // Estados para modal de error de stock insuficiente
  const [showStockErrorModal, setShowStockErrorModal] = useState(false)
  const [stockErrorData, setStockErrorData] = useState(null)

  // Estados para controlar carga de datos y evitar duplicados
  const [companyDataLoaded, setCompanyDataLoaded] = useState(false)
  const [customerDataLoaded, setCustomerDataLoaded] = useState(false)
  const [comprobanteOptionsLoaded, setComprobanteOptionsLoaded] = useState(false)

  // Estado para facturas impagas (para notas de crédito)
  const [unpaidInvoices, setUnpaidInvoices] = useState([])
  const [conciliationSummaries, setConciliations] = useState([])
  const [selectedUnpaidInvoices, setSelectedUnpaidInvoices] = useState([])
  const [importedInvoicesKey, setImportedInvoicesKey] = useState('')
  const [showDocumentLinker, setShowDocumentLinker] = useState(false)
  // Ref to preserve invoice_type selected by the user while using the DocumentLinker
  const preservedInvoiceTypeRef = useRef(null)
  // Ref to temporarily suppress automatic comprobante option refresh while linking
  const suppressComprobanteRefreshRef = useRef(false)
  // Optional expiry timestamp to keep suppression active for a short period after restore
  const suppressComprobanteUntilRef = useRef(0)

  const [formData, setFormData] = useState({
    posting_date: new Date().toISOString().split('T')[0],
    due_date: new Date().toISOString().split('T')[0],
    invoice_number: '0001',
    invoice_type: 'Factura Electrónica',
    voucher_type: 'Fa',
    invoice_category: 'A',
    punto_de_venta: '',
    status: 'Confirmada',
    title: '',
    customer: selectedCustomer || '',
    currency: companyCurrency,
    exchange_rate: 1,
    price_list: '',
    sales_condition_type: 'Contado',
    sales_condition_amount: '',
    sales_condition_days: '',
    metodo_numeracion_factura_venta: '',
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
      account: ''
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

  const hasSalesOrderReference = useCallback((items = []) => {
    if (!Array.isArray(items)) return false
    return items.some(item => {
      if (!item) return false
      return Boolean(
        item.sales_order ||
        item.sales_order_item ||
        item.sales_order_detail ||
        item.so_detail ||
        item.__source_sales_order ||
        item.__source_so_detail
      )
    })
  }, [])

  const [forceSalesOrderConfirmation, setForceSalesOrderConfirmation] = useState(false)

  useEffect(() => {
    setForceSalesOrderConfirmation(hasSalesOrderReference(formData.items))
  }, [formData.items, hasSalesOrderReference])

  useEffect(() => {
    if (forceSalesOrderConfirmation && formData.status !== 'Confirmada') {
      setFormData(prev => ({
        ...prev,
        status: 'Confirmada'
      }))
    }
  }, [forceSalesOrderConfirmation, formData.status])

  // Caché para evitar llamadas repetitivas a getNextAvailableNumber
  const numberCacheRef = useRef(new Map())
  // Ref to track last processed invoice type/category to avoid duplicate regenerations
  const lastMetodoGenerationRef = useRef({ category: null, type: null, puntoVenta: null })
  // Ref to track last exchange rate fetch to avoid duplicate fetches
  const lastExchangeRateFetchRef = useRef({ currency: null, postingDate: null })
  // Ref to track last processed comprobante option to avoid duplicate processing
  const lastComprobanteOptionRef = useRef(null)

  // Función helper con caché para obtener próximo número
  const getCachedNextNumber = async (talonario, letra, tipoComprobante = null, excludeName = null) => {
    if (!talonario) throw new Error('Talonario no disponible')
    const cacheKey = `${talonario.name}-${letra}${tipoComprobante ? `-${tipoComprobante}` : ''}${excludeName ? `-exclude:${excludeName}` : ''}`
    const docType = mapAfipToDocType(tipoComprobante)
    const lastNumbersMap = talonario.last_numbers_map || {}
    const mapKey = docType && letra ? `${docType}-${letra}` : null
    
    if (numberCacheRef.current.has(cacheKey)) {
      return numberCacheRef.current.get(cacheKey)
    }

    if (mapKey && Object.prototype.hasOwnProperty.call(lastNumbersMap, mapKey)) {
      const lastUsed = parseInt(lastNumbersMap[mapKey], 10)
      const nextLocalNumber = (Number.isNaN(lastUsed) ? 0 : lastUsed) + 1
      numberCacheRef.current.set(cacheKey, nextLocalNumber)
      return nextLocalNumber
    }

    if (typeof talonario.ultimo_numero_utilizado !== 'undefined' && talonario.ultimo_numero_utilizado !== null) {
      const lastUsed = parseInt(talonario.ultimo_numero_utilizado, 10)
      const nextLocalNumber = (Number.isNaN(lastUsed) ? 0 : lastUsed) + 1
      numberCacheRef.current.set(cacheKey, nextLocalNumber)
      return nextLocalNumber
    }

    const nextNumber = await getNextAvailableNumber(talonario, letra, fetchWithAuth, tipoComprobante, excludeName)
    if (nextNumber == null) {
      throw new Error('No se pudo obtener el próximo número')
    }
    numberCacheRef.current.set(cacheKey, nextNumber)
    return nextNumber
  }

  // Reset states when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCompanyDataLoaded(false)
      setCustomerDataLoaded(false)
      setComprobanteOptionsLoaded(false)
      setIsLoadingComprobantes(false)
      numberCacheRef.current.clear()
      noTalonarioWarningShownRef.current = false
      unpaidInvoicesLoadedRef.current = { customer: null, isCreditNote: false }
      lastMetodoGenerationRef.current = { category: null, type: null, puntoVenta: null }
      lastExchangeRateFetchRef.current = { currency: null, postingDate: null }
      lastComprobanteOptionRef.current = null
      setTalonariosFetchCompleted(false)
    } else {
      // Reset customer data when modal opens and start loading
      setCustomerDataLoaded(false)
      setIsLoadingComprobantes(true) // Show loading spinner from the start
    }
  }, [isOpen])

  // Reset customer data when customer changes y usar caché cuando esté disponible
  useEffect(() => {
    setComprobanteOptionsLoaded(false)
    if (!selectedCustomer) {
      setCustomerDataLoaded(false)
      setCustomerDetails(null)
      return
    }

    const cached = getCachedCustomerDetails(selectedCustomer)
    if (cached) {
      setCustomerDetails(cached)
      setCustomerDataLoaded(true)
    } else {
      setCustomerDataLoaded(false)
    }
  }, [selectedCustomer])

  // Reset comprobante options when credit-note context changes
  useEffect(() => {
    setComprobanteOptionsLoaded(false)
  }, [documentIsCreditNote, unpaidInvoicesCount])

  // Marcar talonarios como cargados después de que availableTalonarios se actualice
  useEffect(() => {
    console.log('🔄 [InvoiceModal] useEffect talonariosFetchCompleted ejecutado:', {
      companyDataLoaded,
      isOpen,
      availableTalonarios_length: availableTalonarios.length
    })
    
    if (companyDataLoaded && isOpen) {
      // Ya no necesitamos setTimeout aquí porque companyDataLoaded se establece después de availableTalonarios
      console.log('🔔 [InvoiceModal] Estableciendo talonariosFetchCompleted inmediatamente')
      setTalonariosFetchCompleted(true)
    }
  }, [companyDataLoaded, isOpen, availableTalonarios.length])

  // Inyectar detalles de cliente pre-cargados (por ejemplo, desde CustomerPanel)
  useEffect(() => {
    if (!selectedCustomer || !prefetchedCustomerDetails) return

    const matchesSelected =
      prefetchedCustomerDetails.name === selectedCustomer ||
      prefetchedCustomerDetails.customer_name === selectedCustomer

    if (matchesSelected) {
      cacheCustomerDetails(selectedCustomer, prefetchedCustomerDetails)
      setCustomerDetails(prefetchedCustomerDetails)
      setCustomerDataLoaded(true)
    }
  }, [prefetchedCustomerDetails, selectedCustomer])

  // Initialize handlers using imported functions
  const handleInputChange = createHandleInputChange(
    setFormData,
    (currency) => fetchExchangeRate(
      currency,
      formData.posting_date,
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
    companyCurrency
  )

  const handleItemChange = createHandleItemChange(setFormData)
  const addItem = createAddItem(setFormData, customerDetails, activeCompanyDetails, rateToTemplateMap)
  const removeItem = createRemoveItem(setFormData, formData.items)

  // Handler for unpaid invoice selection in credit notes
  const handleUnpaidInvoiceSelection = createHandleUnpaidInvoiceSelection(setFormData, unpaidInvoices, showNotification)
  const handleUnpaidInvoiceAmountChange = createHandleUnpaidInvoiceAmountChange(setFormData)

  // Get company data on mount (only once per modal open) con cache de datasets
  useEffect(() => {
    const getCompanyInfo = async () => {
      if (companyDataLoaded) {
        logStep('Datos de empresa ya estaban cargados, se omite la llamada')
        return
      }

      try {
        await timeAsyncStep('Carga de datos de empresa', async () => {
          console.log('🛣️ [InvoiceModal] API_ROUTES.activeCompany:', API_ROUTES.activeCompany)
          const companyResponse = await fetchWithAuth(API_ROUTES.activeCompany)
          console.log('📡 [InvoiceModal] companyResponse:', companyResponse.ok, companyResponse.status)
          if (!companyResponse.ok) {
            console.log('❌ [InvoiceModal] companyResponse not ok, status:', companyResponse.status)
            setTimeout(() => setTalonariosFetchCompleted(true), 0)
            return
          }

          const companyData = await companyResponse.json()
          console.log('📊 [InvoiceModal] companyData:', companyData)
          if (!companyData.success) {
            console.log('❌ [InvoiceModal] companyData not success, response:', companyData)
            setTimeout(() => setTalonariosFetchCompleted(true), 0)
            return
          }

          setCompanyCurrency(companyData.data.company_details?.default_currency || '')
          const localCompanyName = companyData.data.active_company
          console.log('🏢 [InvoiceModal] localCompanyName:', localCompanyName, 'companyCurrency:', companyCurrency)
          setCompanyName(localCompanyName)

          if (localCompanyName) {
            console.log('📍 [InvoiceModal] localCompanyName encontrado:', localCompanyName)
            try {
              // Usar talonarios del caché si están disponibles
              let talonariosPromise
              if (prefetchedTalonarios && Array.isArray(prefetchedTalonarios) && prefetchedTalonarios.length > 0) {
                talonariosPromise = Promise.resolve(prefetchedTalonarios)
              } else {
                talonariosPromise = fetchStaticDatasetWithCache(
                  'talonarios',
                  () => timeAsyncStep('Carga de talonarios disponibles', () =>
                    fetchAvailableTalonarios(localCompanyName, fetchWithAuth)
                  ),
                  localCompanyName
                )
              }

              console.log('⏳ [InvoiceModal] Iniciando Promise.all para cargar todos los datos...')
              const [
                companyDetailsResult,
                talonariosResult,
                warehousesResult,
                accountsResult,
                priceListsResult,
                taxTemplatesResult,
                paymentTermsResult
              ] = await Promise.all([
                fetchStaticDatasetWithCache(
                  'companyDetails',
                  () => timeAsyncStep(`Detalles de empresa ${localCompanyName}`, () =>
                    fetchActiveCompanyDetails(localCompanyName, fetchWithAuth)
                  ),
                  localCompanyName
                ),
                talonariosPromise,
                fetchStaticDatasetWithCache(
                  'warehouses',
                  () => timeAsyncStep('Carga de warehouses disponibles', () =>
                    fetchAvailableWarehouses(localCompanyName, fetchWithAuth)
                  ),
                  localCompanyName
                ),
                fetchStaticDatasetWithCache(
                  'accounts',
                  () => timeAsyncStep('Carga de cuentas contables', async () => {
                    const accountsResponse = await fetchWithAuth(API_ROUTES.accounts)
                    if (accountsResponse.ok) {
                      const accountsData = await accountsResponse.json()
                      if (accountsData.success) {
                        return accountsData.data || []
                      }
                    }
                    return []
                  }),
                  localCompanyName
                ),
                fetchStaticDatasetWithCache(
                  'salesPriceLists',
                  () => timeAsyncStep('Carga de listas de precios de venta', () =>
                    fetchSalesPriceLists(fetchWithAuth, API_ROUTES.salesPriceLists)
                  ),
                  localCompanyName
                ),
                fetchStaticDatasetWithCache(
                  'taxTemplates',
                  () => timeAsyncStep('Carga de plantillas de impuestos', async () => {
                      // Use shared hook to load/refresh tax templates
                      const loaded = await refreshTaxTemplates()
                      return loaded || null
                  }),
                  localCompanyName
                ),
                fetchStaticDatasetWithCache(
                  'paymentTerms',
                  () => timeAsyncStep('Carga de condiciones de pago', () =>
                    fetchPaymentTerms(fetchWithAuth, API_ROUTES)
                  ),
                  null
                )
              ])

              if (companyDetailsResult) {
                setActiveCompanyDetails(companyDetailsResult)
              }

              if (Array.isArray(talonariosResult)) {
                setAvailableTalonarios(talonariosResult)
                setCompanyDataLoaded(true)
              } else {
                setAvailableTalonarios([])
                setCompanyDataLoaded(true)
              }

              if (Array.isArray(warehousesResult)) {
                setAvailableWarehouses(warehousesResult)
              }

              if (Array.isArray(accountsResult)) {
                setAvailableAccounts(accountsResult)
              }

              if (Array.isArray(priceListsResult)) {
                setAvailablePriceLists(priceListsResult)
              }

              if (taxTemplatesResult) {
                const templatesArr = (taxTemplatesResult.templates || taxTemplatesResult.data) || []
                setTaxTemplates(templatesArr)
                setRateToTemplateMap(taxTemplatesResult.rate_to_template_map || taxTemplatesResult.rateToTemplateMap || {})

                const finalRates = getIvaRatesFromTemplates(templatesArr)
                console.log('--- Available IVA rates extracted:', finalRates)
                setAvailableIVARates(finalRates)
              } else {
                console.log('--- No taxTemplatesResult received')
              }

            if (Array.isArray(paymentTermsResult)) {
              setPaymentTerms(paymentTermsResult)
            }
            
            console.log('✅ [InvoiceModal] Todos los datos cargados, estableciendo companyDataLoaded = true')
          } catch (innerError) {
            console.error('Error cargando datos de empresa:', innerError)
          }
        } else {
          console.warn('⚠️ [InvoiceModal] No hay localCompanyName, estableciendo talonarios vacío')
          setAvailableTalonarios([])
          setCompanyDataLoaded(true)
        }
      })
    } catch (error) {
      console.error('Error getting company info:', error)
      setAvailableTalonarios([])
      setCompanyDataLoaded(true)
    }
  }

    if (isOpen && !companyDataLoaded) {
      getCompanyInfo()
    }
  }, [isOpen, companyDataLoaded, fetchWithAuth, logStep, timeAsyncStep, prefetchedTalonarios])

  // Get customer details when customer changes
  useEffect(() => {
    const getCustomerInfo = async () => {
      if (!selectedCustomer || customerDataLoaded || selectedCustomer === 'new') {
        logStep('Carga de cliente omitida', {
          noSelectedCustomer: !selectedCustomer,
          alreadyLoaded: customerDataLoaded,
          isNew: selectedCustomer === 'new'
        })
        return
      }

      try {
        await timeAsyncStep(`Carga de datos de cliente ${selectedCustomer}`, async () => {
          const customerResponse = await fetchWithAuth(`${API_ROUTES.customers}/${encodeURIComponent(selectedCustomer)}`)

          if (customerResponse.ok) {
            const customerData = await customerResponse.json()

          if (customerData.success) {
            setCustomerDetails(customerData.data)
            cacheCustomerDetails(selectedCustomer, customerData.data)

              if (!editingData) {
                // Set price list from customer if available
                if (customerData.data?.price_list) {
                  console.log('[InvoiceModal] Setting price_list to:', customerData.data.price_list)
                  setFormData(prev => ({
                    ...prev,
                    price_list: customerData.data.price_list
                  }))
                } else {
                  console.log('[InvoiceModal] No price_list found in customer data, trying customer group default')

                  // If the customer doesn't have an explicit price_list, try to inherit from the customer group
                  try {
                    const groupName = customerData.data?.customer_group
                    if (groupName) {
                      const groupResp = await fetchWithAuth(`/api/resource/Customer%20Group/${encodeURIComponent(groupName)}`)
                      if (groupResp && groupResp.ok) {
                        const groupResult = await groupResp.json()
                        const groupDetails = groupResult.data
                        if (groupDetails && groupDetails.default_price_list) {
                          console.log('[InvoiceModal] Inheriting price_list from customer group:', groupDetails.default_price_list)
                          setFormData(prev => ({ ...prev, price_list: groupDetails.default_price_list }))
                        } else {
                          console.log('[InvoiceModal] Customer group has no default_price_list')
                        }
                      } else {
                        console.log('[InvoiceModal] Failed to fetch customer group details', groupResp && groupResp.status)
                      }
                    } else {
                      console.log('[InvoiceModal] Customer has no customer_group to inherit from')
                    }
                  } catch (err) {
                    console.error('[InvoiceModal] Error fetching customer group details:', err)
                  }
                }
              } else {
                console.log('[InvoiceModal] Editing mode, not setting price_list')
              }
            } else {
              console.log('[InvoiceModal] Customer data not successful:', customerData)
            }
          } else {
            console.log('[InvoiceModal] Customer response not ok:', customerResponse.status)
          }
        })
        setCustomerDataLoaded(true)
      } catch (error) {
        console.error('[InvoiceModal] Error getting customer info:', error)
      }
    }

    getCustomerInfo()
  }, [selectedCustomer, customerDataLoaded, editingData, isOpen, fetchWithAuth, logStep, timeAsyncStep])

  // Determine comprobante options when customer or document type changes
  useEffect(() => {
    const loadComprobanteOptions = async () => {
      // If an explicit suppression is active (user is linking documents), skip immediately
      const now = Date.now()
      if (suppressComprobanteRefreshRef.current && suppressComprobanteUntilRef.current > now) {
        console.log('[InvoiceModal] Skipping comprobante determination because suppression flag is active and not expired', {
          preservedInvoiceType: preservedInvoiceTypeRef.current,
          suppress_until: new Date(suppressComprobanteUntilRef.current).toISOString(),
          now: new Date(now).toISOString(),
          companyDataLoaded,
          selectedCustomer,
          comprobanteOptionsLoaded,
          talonariosFetchCompleted
        })
        return
      }
      // If suppression timestamp expired, clear flags
      if (suppressComprobanteRefreshRef.current && suppressComprobanteUntilRef.current <= now) {
        console.log('[InvoiceModal] Suppression expired, clearing flags', { now: new Date(now).toISOString() })
        suppressComprobanteRefreshRef.current = false
        suppressComprobanteUntilRef.current = 0
      }

      if (!companyDataLoaded || !selectedCustomer || comprobanteOptionsLoaded || !talonariosFetchCompleted) {
        logStep('Opciones de comprobante omitidas', {
          companyDataLoaded,
          selectedCustomer,
          comprobanteOptionsLoaded
        })
        return
      }
      
      try {
        if (suppressComprobanteRefreshRef.current) {
          logStep('Opciones de comprobante omitidas por supresión', { suppressed: true })
          return
        }
        await timeAsyncStep('Determinacion de comprobantes disponibles', async () => {
          setIsLoadingComprobantes(true)
          
          // Si no hay talonarios, mostrar mensaje de error directamente
          if (availableTalonarios.length === 0) {
            setComprobanteOptions([])
            setAvailableLetters([])
            setAvailableComprobantes([])
            // Do not clear the invoice_type if the user explicitly selected a credit note
            setFormData(prev => {
              const current = (prev.invoice_type || '').toString().toLowerCase()
              const isCredit = isCreditNote(current)
              if (isCredit) return prev
              return { ...prev, invoice_type: '', invoice_category: '' }
            })
            setSelectedComprobanteOption(null)
            showNotification('No se encontraron talonarios configurados para esta empresa. Por favor, configure los talonarios en la sección de Configuración.', 'error')
            setIsLoadingComprobantes(false)
            setComprobanteOptionsLoaded(true)
            return
          }
          
          await determineComprobanteOptions(
            selectedCustomer,
            companyName,
            documentIsCreditNote ? 1 : unpaidInvoicesCount,
            fetchWithAuth,
            setComprobanteOptions,
            setAvailableLetters,
            setAvailableComprobantes,
            setFormData,
            setSelectedComprobanteOption,
            formData.invoice_type,
            isEditing ? editingData?.name : null,
            showNotification
          )
          setIsLoadingComprobantes(false)
          setComprobanteOptionsLoaded(true)
        })
      } catch (error) {
        console.error('Error determining comprobante options:', error)
        setIsLoadingComprobantes(false)
        setComprobanteOptionsLoaded(true) // Marcar como loaded para evitar loops
      }
    }

    loadComprobanteOptions()
  }, [companyDataLoaded, selectedCustomer, companyName, documentIsCreditNote, unpaidInvoicesCount, comprobanteOptionsLoaded, isEditing, editingData?.name, fetchWithAuth, availableTalonarios.length, logStep, timeAsyncStep, talonariosFetchCompleted])

  // Effect to load unpaid invoices when credit note is selected
  useEffect(() => {
    const isCreditNoteNow = isCreditNote(formData.invoice_type)
    const loadKey = `${selectedCustomer}|${isCreditNoteNow}`
    const lastLoadKey = `${unpaidInvoicesLoadedRef.current.customer}|${unpaidInvoicesLoadedRef.current.isCreditNote}`
    
    // Skip if already processed for this customer + type combination
    if (loadKey === lastLoadKey) {
      return
    }
    
    const loadUnpaidInvoices = async () => {
      if (isOpen && selectedCustomer && isCreditNoteNow) {
        unpaidInvoicesLoadedRef.current = { customer: selectedCustomer, isCreditNote: true }
        await fetchUnpaidInvoices(selectedCustomer, fetchWithAuth, setUnpaidInvoices, setConciliations, showNotification)
      } else {
        // Only clear if we actually have something to clear
        if (unpaidInvoicesLoadedRef.current.customer !== null || unpaidInvoicesLoadedRef.current.isCreditNote !== false) {
          unpaidInvoicesLoadedRef.current = { customer: null, isCreditNote: false }
          setUnpaidInvoices([])
          setSelectedUnpaidInvoices([])
          setImportedInvoicesKey('')
        }
      }
    }

    loadUnpaidInvoices()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedCustomer, formData.invoice_type, fetchWithAuth])

  // Effect to calculate credit note total when selected amounts change
  useEffect(() => {
    if (isCreditNote(formData.invoice_type) && formData.selected_unpaid_invoices && formData.selected_unpaid_invoices.length > 0) {
      const total = formData.selected_unpaid_invoices.reduce((sum, invoice) => {
        return sum + parseFloat(invoice.amount || 0)
      }, 0)
      setFormData(prev => ({
        ...prev,
        // Mostrar el total como positivo (mismo comportamiento que en otros módulos)
        credit_note_total: Math.abs(total).toFixed(2)
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        credit_note_total: '0.00'
      }))
    }
  }, [formData.selected_unpaid_invoices, formData.invoice_type])

  // Effect to set default customer account in items when customer details are loaded
  useEffect(() => {
    // La cuenta de débito se maneja a nivel de factura (debit_to), no por item
    // La cuenta de ingresos se determina automáticamente por el backend
  }, [customerDetails])

  // Effect to set default IVA rate in items when customer details are loaded
  useEffect(() => {
    if (customerDetails && !isEditing) {

      // Compute normalized default IVA from customer/company using utility
      const defaultIVARate = getDefaultIVARate(customerDetails, activeCompanyDetails, rateToTemplateMap)

      if (defaultIVARate) {
        setFormData(prev => ({
          ...prev,
          items: prev.items.map(item => {
            // Only update items that still have the module defaults
            const current = (item.iva_percent || '').toString()
            if (current === '21.00' || current === '21') {
              return { ...item, iva_percent: defaultIVARate }
            }
            // If item has a string like '21% IVA (Ventas) - DELP', try to normalize
            const m = current.match(/(\d+(?:[\.,]\d+)?)/)
            if (m) {
              const n = parseFloat(m[1].replace(',', '.'))
              if (!isNaN(n)) return { ...item, iva_percent: n.toFixed(2) }
            }
            return item
          })
        }))
      }
    }
  }, [customerDetails, activeCompanyDetails, rateToTemplateMap, isEditing])

  // Effect to set default punto de venta when talonarios are loaded
  useEffect(() => {
    if (!talonariosFetchCompleted || filteredTalonarios.length === 0) {
      return
    }

    if (filteredTalonarios.length === 1 && !isEditing) {
      const defaultTalonario = filteredTalonarios[0]

      setSelectedPuntoVenta(defaultTalonario.punto_de_venta)
      setFormData(prev => {
        return {
          ...prev,
          punto_de_venta: defaultTalonario.punto_de_venta,
          invoice_number: prev.invoice_number === '00000001'
            ? (defaultTalonario.numero_de_inicio?.toString().padStart(8, '0') || '00000001')
            : prev.invoice_number,
          metodo_numeracion_factura_venta: getMetodoNumeracionFromTalonario(defaultTalonario, formData.invoice_type)
        }
      })
    } else if (filteredTalonarios.length > 1 && !selectedPuntoVenta && !isEditing) {
      const defaultTalonario = filteredTalonarios.find(t => t.por_defecto === 1) || filteredTalonarios[0]

      setSelectedPuntoVenta(defaultTalonario.punto_de_venta)
      setFormData(prev => {
        return {
          ...prev,
          punto_de_venta: defaultTalonario.punto_de_venta,
          invoice_number: prev.invoice_number === '00000001'
            ? (defaultTalonario.numero_de_inicio?.toString().padStart(8, '0') || '00000001')
            : prev.invoice_number,
          metodo_numeracion_factura_venta: getMetodoNumeracionFromTalonario(defaultTalonario, formData.invoice_type)
        }
      })
    }
  }, [filteredTalonarios, talonariosFetchCompleted, isEditing, selectedPuntoVenta, formData.invoice_type, setFormData])
  // Effect to regenerate metodo_numeracion_factura_venta when category or type changes
  useEffect(() => {
    // Solo regenerar si no estamos editando y tenemos un punto de venta seleccionado
    if (!talonariosFetchCompleted) {
      return
    }
    if (!isEditing && selectedPuntoVenta && formData.invoice_category && formData.invoice_type) {
      // Skip if we already processed this exact combination to avoid loops
      const lastGen = lastMetodoGenerationRef.current
      if (
        lastGen.category === formData.invoice_category &&
        lastGen.type === formData.invoice_type &&
        lastGen.puntoVenta === selectedPuntoVenta
      ) {
        return
      }
      
      const currentTalonario = getTalonarioByPuntoVenta(selectedPuntoVenta)
      
      if (currentTalonario) {
        // Update ref BEFORE the async operation to prevent re-entry
        lastMetodoGenerationRef.current = {
          category: formData.invoice_category,
          type: formData.invoice_type,
          puntoVenta: selectedPuntoVenta
        }
        
        // Determinar prefijo FE/FM según el tipo de factura y configuración del talonario
        let prefix = 'FM'  // Default a manual
        if (formData.invoice_type === 'Factura Electrónica') {
          prefix = 'FE'
        } else {
          // Para cualquier otro tipo (incluyendo "Factura"), usar el flag del talonario
          prefix = currentTalonario.factura_electronica === 1 || currentTalonario.factura_electronica === true ? 'FE' : 'FM'
        }

        // Determinar tipo base según el tipo de factura actual
        let tipoBase = 'FAC'  // Default
        if (formData.invoice_type === 'Factura' || formData.invoice_type === 'Factura Electrónica') {
          tipoBase = 'FAC'
        } else if (formData.invoice_type === 'Nota de Crédito') {
          tipoBase = 'NDC'
        } else if (formData.invoice_type === 'Nota de Débito') {
          tipoBase = 'NDB'
        } else if (formData.invoice_type === 'Recibo') {
          tipoBase = 'REC'
        }

        // Usar la letra actual del formulario
        const letra = formData.invoice_category

        // Formatear punto de venta (5 dígitos) y calcular el siguiente número disponible (8 dígitos)
        const puntoVenta = String(currentTalonario.punto_de_venta).padStart(5, '0')
        
        // Obtener el siguiente número de forma async
        const updateNumberAndMetodoForCurrent = async () => {
          try {
            // Determinar código AFIP según tipo y letra
            let tipoComprobante = null
            // Map tipoBase + letra -> canonical AFIP code using shared mapping
            if (tipoBase === 'NDC') {
              tipoComprobante = pickCodeByLetter('NDC', letra)
            } else if (tipoBase === 'NDB') {
              tipoComprobante = pickCodeByLetter('NDB', letra)
            } else if (tipoBase === 'FAC') {
              tipoComprobante = pickCodeByLetter('FAC', letra)
            } else if (tipoBase === 'REC') {
              tipoComprobante = pickCodeByLetter('REC', letra)
            }
            
            const nextNumber = await getCachedNextNumber(currentTalonario, letra, tipoComprobante, isEditing ? editingInvoiceFullName : null)
            const numeroInicio = String(nextNumber).padStart(8, '0')

            // Generar el método de numeración
            const metodoNumeracion = `${prefix}-${tipoBase}-${letra}-${puntoVenta}-${numeroInicio}`

            // IMPORTANTE: Siempre usar el método generado que tiene el tipo y letra correctos
            // Solo como referencia, verificar si el talonario tiene campos específicos para NC/ND
            // pero NO usarlos porque pueden tener valores incorrectos
            const metodoToUse = metodoNumeracion

            setFormData(prev => ({
              ...prev,
              invoice_number: String(nextNumber).padStart(8, '0'),
              metodo_numeracion_factura_venta: metodoToUse
            }))
          } catch (error) {
            console.error('Error actualizando número de factura:', error)
            showNotification('No se pudo obtener la numeración del talonario seleccionado. Configure un talonario.', 'error')
          }
        }
        
        updateNumberAndMetodoForCurrent()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.invoice_category, formData.invoice_type, selectedPuntoVenta, talonariosFetchCompleted, isEditing])

  // Effect to set default payment term when payment terms are loaded
  useEffect(() => {
    if (customerHasPaymentTerm) {
      setFormData(prev => {
        if (prev.sales_condition_type === customerPaymentTermName) {
          return prev
        }
        return {
          ...prev,
          sales_condition_type: customerPaymentTermName
        }
      })
      return
    }

    if (paymentTerms.length > 0 && !isEditing) {
      // Find "Contado" or use the first available term
      const contadoTerm = paymentTerms.find(term =>
        term.template_name?.toLowerCase().includes('contado') ||
        term.name?.toLowerCase().includes('contado')
      )
      const defaultTerm = contadoTerm || paymentTerms[0]

      if (defaultTerm && formData.sales_condition_type !== defaultTerm.name) {
        setFormData(prev => ({
          ...prev,
          sales_condition_type: defaultTerm.name
        }))
      }
    }
  }, [paymentTerms, isEditing, customerHasPaymentTerm, customerPaymentTermName, formData.sales_condition_type])

  // Effect to calculate due date when payment term or posting date changes
  useEffect(() => {
    if (!customerHasPaymentTerm) {
      return
    }
    if (formData.posting_date) {
      const dueDate = calculateDueDate(
        customerPaymentTermName || formData.sales_condition_type,
        formData.posting_date,
        paymentTerms
      )
      if (dueDate && dueDate > formData.posting_date && dueDate !== formData.due_date) {
        setFormData(prev => ({ ...prev, due_date: dueDate }))
      }
    }
  }, [
    customerHasPaymentTerm,
    customerPaymentTermName,
    formData.sales_condition_type,
    formData.posting_date,
    formData.due_date,
    paymentTerms
  ])

  // Debug: Log when editingData changes
  useEffect(() => {
    // Trigger effect for dependency tracking
  }, [editingData])

  // Effect to initialize exchange rate when modal opens or currency changes
  useEffect(() => {
    if (isOpen && formData.currency && companyCurrency) {
      // Skip if already fetched for this currency + date combination
      const lastFetch = lastExchangeRateFetchRef.current
      if (
        lastFetch.currency === formData.currency &&
        lastFetch.postingDate === formData.posting_date &&
        lastFetch.baseCurrency === companyCurrency
      ) {
        return
      }
      
      lastExchangeRateFetchRef.current = {
        currency: formData.currency,
        postingDate: formData.posting_date,
        baseCurrency: companyCurrency
      }
      fetchExchangeRate(
        formData.currency,
        formData.posting_date,
        companyCurrency,
        setExchangeRate,
        setExchangeRateDate,
        setFormData,
        setIsLoadingExchangeRate,
        showNotification,
        fetchWithAuth
      )
    }
  }, [isOpen, formData.currency, formData.posting_date, companyCurrency, fetchWithAuth, showNotification])

  // Effect to update comprobante selection when letter changes
  // Effect to fetch fresh invoice data when editing
  useEffect(() => {
    if (isEditing && editingData && editingData.name && isOpen) {
      const fetchFreshInvoiceData = async () => {
        try {
          await timeAsyncStep(`Refresco de factura ${editingData.name}`, async () => {
            const response = await fetchWithAuth(`/api/invoices/${editingData.name}`)
            if (response.ok) {
              const result = await response.json()
              setFreshInvoiceData(result.data)
            } else {
              console.error('Failed to fetch fresh invoice data')
              setFreshInvoiceData(editingData) // fallback to provided data
            }
          })
        } catch (error) {
          console.error('Error fetching fresh invoice data:', error)
          setFreshInvoiceData(editingData) // fallback
        }
      }
      fetchFreshInvoiceData()
    } else {
      setFreshInvoiceData(null)
    }
  }, [isEditing, editingData?.name, isOpen, fetchWithAuth, timeAsyncStep, prefillData])

  useEffect(() => {
    if (!prefillData || !isOpen || isEditing) {
      return
    }
    prefillAppliedRef.current = true
    const patch = prefillData
    const patchHasSalesOrder = hasSalesOrderReference(patch.items)
    setFormData(prev => ({
      ...prev,
      posting_date: patch.posting_date || prev.posting_date || new Date().toISOString().split('T')[0],
      customer: patch.customer || prev.customer || selectedCustomer || '',
      company: patch.company || prev.company || companyName || activeCompany || '',
        currency: patch.currency || prev.currency,
        price_list: patch.price_list || prev.price_list,
        taxes: patch.taxes && patch.taxes.length ? patch.taxes : prev.taxes,
        items: (patch.items && patch.items.length > 0) ? patch.items : prev.items,
        status: patchHasSalesOrder ? 'Confirmada' : 'Borrador',
        sourceSalesOrder: patch.sourceSalesOrder || prev.sourceSalesOrder || ''
      }))
      onPrefillConsumed?.()
  }, [prefillData, isOpen, isEditing, selectedCustomer, companyName, activeCompany, onPrefillConsumed, hasSalesOrderReference])

  // Effect to handle editing data
  useEffect(() => {
    const dataToUse = freshInvoiceData || editingData
    
    // Determinar tipos de comprobante - ahora también desde el nombre (incluyendo temporales)
    const creditNoteFromTotal = dataToUse && dataToUse?.total < 0
    const creditNoteFromName = dataToUse && isCreditNoteFromName(dataToUse?.name)
    const debitNoteFromName = dataToUse && isDebitNoteFromName(dataToUse?.name)
    const detectedTypeFromName = dataToUse && detectDocumentTypeFromName(dataToUse?.name)
    
    // Priorizar detección desde el nombre para manejar borradores correctamente
    const creditNote = creditNoteFromName || creditNoteFromTotal
    const debitNote = debitNoteFromName
    
    setDocumentIsCreditNote(creditNote)
    
    if (dataToUse && isOpen) {
      
      setIsEditing(true)
      setEditingInvoiceNo(truncateInvoiceNumber(dataToUse?.name))
      setEditingInvoiceFullName(dataToUse?.name) // Guardar nombre completo para API

      const metodoNumeracionValue = creditNote
        ? (dataToUse?.metodo_numeracion_nota_credito || dataToUse?.metodo_numeracion_factura_venta || '')
        : (debitNote
          ? (dataToUse?.metodo_numeracion_nota_debito || dataToUse?.metodo_numeracion_factura_venta || '')
          : (dataToUse?.metodo_numeracion_factura_venta || ''))

      const parsedMetodo = parseMetodoNumeracionAfip(metodoNumeracionValue)
      const parsedInvoiceNumber = parsedMetodo?.numero || null
      const parsedLetter = parsedMetodo?.letra || null
      const parsedPuntoVenta = parsedMetodo?.puntoDeVenta || null

      if (parsedPuntoVenta) {
        setSelectedPuntoVenta(parsedPuntoVenta)
      }
      setFormData({
        posting_date: dataToUse?.posting_date,
        due_date: dataToUse?.due_date || '',
        invoice_number: parsedInvoiceNumber || (debitNote ? extractDebitNoteNumber(dataToUse?.name).padStart(8, '0') : ((truncateInvoiceNumber(dataToUse?.name) || '0001').padStart(8, '0'))),
        invoice_type: detectedTypeFromName || (creditNote ? 'Nota de Crédito' : (debitNote ? 'Nota de Débito' : (dataToUse?.invoice_type || 'Factura Electrónica'))),
        voucher_type: parsedLetter || dataToUse?.voucher_type || 'Fa',
        invoice_category: parsedLetter || dataToUse?.invoice_category || 'A',
        punto_de_venta: parsedPuntoVenta || dataToUse?.punto_de_venta || '',
        status: dataToUse?.docstatus === 1 ? 'Confirmada' : 'Borrador',
        title: dataToUse?.title || '',
        customer: dataToUse?.customer || selectedCustomer || '',
        company: dataToUse?.company || companyName || activeCompany || '',
        currency: dataToUse?.currency || companyCurrency,
        sourceSalesOrder: dataToUse?.sourceSalesOrder || '',
        exchange_rate: dataToUse?.exchange_rate || 1,
        price_list: dataToUse?.price_list || '',
        sales_condition_type: dataToUse?.sales_condition_type || 'A',
        sales_condition_amount: dataToUse?.sales_condition_amount || '',
        sales_condition_days: dataToUse?.sales_condition_days || '',
        metodo_numeracion_factura_venta: metodoNumeracionValue,
        items: dataToUse?.items ? dataToUse.items.map(item => {
          // NO usar fallbacks - si no viene la tasa correcta, dejarla como está
          let normalizedIVAPercent = item.iva_percent
          
          if (item.iva_percent !== null && item.iva_percent !== undefined && item.iva_percent !== '') {
            // Convertir a string si es número
            if (typeof item.iva_percent === 'number') {
              normalizedIVAPercent = item.iva_percent.toString()
            } else if (typeof item.iva_percent === 'string') {
              normalizedIVAPercent = item.iva_percent
            }
          } else {
            normalizedIVAPercent = '21'  // Por defecto 21% si no viene del backend
          }
          
          return {
          item_code: (item.item_code || item.item_name || '').toString(),
          item_name: (item.item_name || item.item_code || '').toString(),
          description: (item.description || item.item_name || '').toString(),
          qty: (item.qty != null ? item.qty.toString() : '1'),
          rate: (item.rate != null ? item.rate.toString() : '0.00'),
          discount_amount: (item.discount_amount != null ? item.discount_amount.toString() : '0.00'),
          iva_percent: normalizedIVAPercent,
          amount: (item.amount != null ? item.amount.toString() : '0.00'),
          warehouse: (item.warehouse || '').toString(),
          cost_center: (item.cost_center || '').toString(),
          uom: (item.uom || 'Unidad').toString(),
          account: (item.account || '').toString()
          }
        }) : Array.from({ length: 3 }, () => ({
          item_code: '',
          item_name: '',
          description: '',
          qty: '1',
          rate: '0.00',
          discount_amount: '0.00',
          iva_percent: '21',
          amount: '0.00'
        })),
        taxes: dataToUse.taxes || [],
        discount_amount: dataToUse.discount_amount?.toString() || '0.00',
        net_gravado: dataToUse.net_gravado?.toString() || '0.00',
        net_no_gravado: dataToUse.net_no_gravado?.toString() || '0.00',
        total_iva: dataToUse.total_iva?.toString() || '0.00',
        percepcion_iva: dataToUse.percepcion_iva?.toString() || '0.00',
        percepcion_iibb: dataToUse.percepcion_iibb?.toString() || '0.00'
      })

      // If it's a credit note and has return_against, load the related invoice
      const returnAgainst = dataToUse.return_against || editingData.return_against
      if (creditNote && returnAgainst) {
        const loadRelatedInvoice = async () => {
          const relatedInvoice = await fetchInvoiceDetails(returnAgainst, fetchWithAuth)
          if (relatedInvoice) {
            console.log('Related invoice loaded:', relatedInvoice)
            // Set as selected unpaid invoice in formData
            const appliedAmount = Math.abs(dataToUse.grand_total || dataToUse.total || 0)
            setFormData(prev => ({
              ...prev,
              selected_unpaid_invoices: [{
                name: relatedInvoice.name,
                amount: appliedAmount,
                allocated_amount: appliedAmount
              }],
              credit_note_total: appliedAmount.toString()
            }))
          } else {
            console.log('No related invoice found')
          }
        }
        loadRelatedInvoice()
      }

      // Actualizar la fecha de la cotización con la fecha de la factura
      if (dataToUse.posting_date) {
        setExchangeRateDate(dataToUse.posting_date)
      }
    } else if (isOpen && !dataToUse && !prefillData && !prefillAppliedRef.current) {
      
      // Reset editing states for new invoice
      setIsEditing(false)
      setEditingInvoiceNo(null)
      setEditingInvoiceFullName(null)
      // Only reset selectedPuntoVenta if there are multiple talonarios
      if (filteredTalonarios.length !== 1) {
        setSelectedPuntoVenta('') // Reset para que se auto-seleccione un talonario permitido
      }
      
      // Reset form for new invoice
      setFormData({
        posting_date: new Date().toISOString().split('T')[0],
        due_date: '',
        invoice_number: '00000001',
        invoice_type: 'Factura Electrónica',
        voucher_type: 'Fa',
        invoice_category: 'A',
        punto_de_venta: '',
        // Default new invoices to Confirmada per UX requirement
        status: 'Confirmada',
        title: '',
        customer: selectedCustomer || '',
        company: companyName || activeCompany || '',
        currency: companyCurrency,
        sourceSalesOrder: '',
        price_list: '',
        sales_condition_type: 'A',
        sales_condition_amount: '',
        sales_condition_days: '',
        metodo_numeracion_factura_venta: '',
        // Initialize items and set IVA percent based on customer/company defaults (normalized)
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
          iva_percent: getDefaultIVARate(customerDetails, activeCompanyDetails, rateToTemplateMap) || '21.00',
          amount: '0.00',
          account: ''
        })),
        taxes: [],
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
  }, [freshInvoiceData, editingData, isOpen, selectedCustomer, companyCurrency])

  // Effect to regenerate metodo_numeracion_factura_venta when editing and it's empty
  useEffect(() => {
    if (!isOpen) return
    // Evitar warnings al abrir: esperar a que carguen compañía + talonarios
    if (!companyDataLoaded || !talonariosFetchCompleted) return

    if (isEditing && isCreditNote(formData.invoice_type) && (!formData.metodo_numeracion_factura_venta || formData.metodo_numeracion_factura_venta.trim() === '') && selectedPuntoVenta) {
      const currentTalonario = getTalonarioByPuntoVenta(selectedPuntoVenta)
      
      if (currentTalonario) {
        // Determinar prefijo FE/FM según el tipo de factura y configuración del talonario
        let prefix = 'FM'  // Default a manual
        if (formData.invoice_type === 'Factura Electrónica') {
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
      } else if (!noTalonarioWarningShownRef.current) {
        showNotification('El talonario asignado a la factura no está disponible. Configure un talonario.', 'error')
        noTalonarioWarningShownRef.current = true
      }
    }
  }, [isOpen, companyDataLoaded, talonariosFetchCompleted, isEditing, formData.invoice_type, formData.metodo_numeracion_factura_venta, selectedPuntoVenta, formData.invoice_category, formData.invoice_number, getTalonarioByPuntoVenta])

  // Effect to select correct comprobante option when editing
  useEffect(() => {
    if (isEditing && comprobanteOptions.length > 0 && formData.invoice_type && (!selectedComprobanteOption || selectedComprobanteOption.descripcion !== formData.invoice_type)) {
      // Find the option that matches the current invoice_type
      const matchingOption = comprobanteOptions.find(option =>
        option.descripcion === formData.invoice_type
      )

      if (matchingOption) {
        console.log('Found matching option:', matchingOption)
        setSelectedComprobanteOption(matchingOption)
        
        // Para edición, actualizar con la información del talonario
        const updateData = {
          voucher_type: matchingOption.letra,
          invoice_category: matchingOption.letra,
          punto_de_venta: matchingOption.punto_de_venta
        }
        
        setFormData(prev => ({
          ...prev,
          ...updateData
        }))
      } else {
        console.warn('No matching comprobante option found for:', formData.invoice_type)
      }
    }
  }, [comprobanteOptions, isEditing, formData.invoice_type, selectedComprobanteOption])

  // When editing, enforce talonario/letra/punto_venta based on metodo_numeracion_factura_venta.
  // This avoids falling back to a default "X / 00001" option before the edited doc is fully hydrated.
  useEffect(() => {
    if (!isOpen || !isEditing) return
    if (!Array.isArray(comprobanteOptions) || comprobanteOptions.length === 0) return

    const parsed = parseMetodoNumeracionAfip(formData.metodo_numeracion_factura_venta)
    if (!parsed) return

    const pv = parsed.puntoDeVenta
    const letra = parsed.letra

    const siglas = afipCodes?.naming_conventions?.siglas || {}
    const aliasToTipo = afipCodes?.alias_to_tipo || {}
    const docCode = String(parsed.tipo || '').trim().toUpperCase()

    let canonicalDoc = null
    for (const [canon, sides] of Object.entries(siglas)) {
      if (!canon) continue
      if (canon === docCode) {
        canonicalDoc = canon
        break
      }
      if (String(sides?.venta || '').trim().toUpperCase() === docCode) {
        canonicalDoc = canon
        break
      }
      if (String(sides?.compra || '').trim().toUpperCase() === docCode) {
        canonicalDoc = canon
        break
      }
    }
    if (!canonicalDoc) {
      const aliasHit = aliasToTipo[String(docCode || '').toLowerCase()]
      if (aliasHit) {
        canonicalDoc = String(aliasHit).trim().toUpperCase()
      }
    }

    let matchKind = null
    if (canonicalDoc) {
      if (canonicalDoc.startsWith('NC') || canonicalDoc === 'TNC') matchKind = 'credito'
      else if (canonicalDoc.startsWith('ND') || canonicalDoc === 'TND') matchKind = 'debito'
      else if (canonicalDoc.startsWith('FA') || canonicalDoc === 'TIQ' || canonicalDoc === 'TFA') matchKind = 'factura'
    } else {
      // Compatibilidad: algunos flujos generan NDC/NDD (no figuran como canonical en afip_codes)
      if (docCode === 'NDC') matchKind = 'credito'
      if (docCode === 'NDD') matchKind = 'debito'
      if (docCode === 'FAC') matchKind = 'factura'
    }

    const byMeta = comprobanteOptions.filter(opt =>
      String(opt.punto_de_venta || '').padStart(5, '0') === pv &&
      String(opt.letra || '').trim() === letra
    )

    const matchingOption = (byMeta.find(opt => {
      if (!matchKind) return false
      const desc = (opt.descripcion || '').toLowerCase()
      if (matchKind === 'factura') return desc.includes('factura')
      if (matchKind === 'credito') return desc.includes('crédito') || desc.includes('credito')
      if (matchKind === 'debito') return desc.includes('débito') || desc.includes('debito')
      return false
    }) || byMeta[0]) || null

    if (!matchingOption) return

    const alreadyOk =
      String(formData.punto_de_venta || '').padStart(5, '0') === pv &&
      String(formData.invoice_category || '').trim() === letra &&
      String(formData.invoice_number || '').padStart(8, '0') === parsed.numero &&
      selectedComprobanteOption?.descripcion === matchingOption.descripcion &&
      String(selectedComprobanteOption?.punto_de_venta || '').padStart(5, '0') === pv &&
      String(selectedComprobanteOption?.letra || '').trim() === letra

    if (alreadyOk) return

    setSelectedComprobanteOption(matchingOption)
    setSelectedPuntoVenta(pv)
    setFormData(prev => ({
      ...prev,
      voucher_type: letra,
      invoice_category: letra,
      punto_de_venta: pv,
      invoice_number: parsed.numero,
      invoice_type: matchingOption.descripcion || prev.invoice_type
    }))
  }, [isOpen, isEditing, comprobanteOptions, formData.metodo_numeracion_factura_venta, formData.invoice_category, formData.punto_de_venta, formData.invoice_number, selectedComprobanteOption])

  // Fetch next number on demand when comprobante option changes
  useEffect(() => {
    if (!isOpen || !selectedComprobanteOption || !talonariosFetchCompleted) return
    if (filteredTalonarios.length === 0) return

    // Create a key to track if we've already processed this comprobante option
    const optionKey = `${selectedComprobanteOption.talonario}-${selectedComprobanteOption.letra}-${selectedComprobanteOption.tipo_comprobante}-${selectedComprobanteOption.punto_de_venta}`
    if (lastComprobanteOptionRef.current === optionKey) {
      return // Already processed this exact option
    }
    lastComprobanteOptionRef.current = optionKey

    const talonario = getTalonarioByName(selectedComprobanteOption.talonario)
    if (!talonario) {
      return
    }

    const isDraftContext = !isEditing || editingData?.docstatus === 0
    const isAutomaticNumbering = selectedComprobanteOption.numeracion_automatica
    setSelectedPuntoVenta(selectedComprobanteOption.punto_de_venta)
    const currentIsCreditNote = isCreditNote(formData.invoice_type)

    if (isAutomaticNumbering) {
      if (isDraftContext) {
        setFormData(prev => ({
          ...prev,
          invoice_number: '',
          // Respect a preserved manual invoice_type selection or an existing credit note type when present
          invoice_type: (preservedInvoiceTypeRef.current || currentIsCreditNote) ? prev.invoice_type : selectedComprobanteOption.descripcion,
          invoice_category: selectedComprobanteOption.letra,
          punto_de_venta: selectedComprobanteOption.punto_de_venta
        }))
        if (preservedInvoiceTypeRef.current) {
          console.log('[InvoiceModal] Skipped automatic invoice_type assignment due to preserved selection (isAutomaticNumbering)', { preserved: preservedInvoiceTypeRef.current })
        } else {
          console.log('[InvoiceModal] Automatic invoice_type assigned (isAutomaticNumbering)', { invoice_type: selectedComprobanteOption.descripcion })
        }
      }
      return
    }

    if (!isDraftContext) return

    let cancelled = false

    const assignNextNumber = async () => {
      try {
        let nextNumber = selectedComprobanteOption.proximo_numero
        if (nextNumber == null) {
          nextNumber = await getCachedNextNumber(
            talonario,
            selectedComprobanteOption.letra,
            selectedComprobanteOption.tipo_comprobante,
            isEditing ? editingInvoiceFullName : null
          )
        }

        if (cancelled) return
        if (nextNumber == null) {
          showNotification('No se pudo obtener la numeración del talonario seleccionado. Configure un talonario.', 'error')
          return
        }

        const formatted = String(nextNumber).padStart(8, '0')
        setFormData(prev => ({
          ...prev,
          invoice_number: formatted,
          // Respect a preserved manual invoice_type selection or an existing credit note type when present
          invoice_type: (preservedInvoiceTypeRef.current || currentIsCreditNote) ? prev.invoice_type : selectedComprobanteOption.descripcion,
          invoice_category: selectedComprobanteOption.letra,
          punto_de_venta: selectedComprobanteOption.punto_de_venta
        }))
        if (preservedInvoiceTypeRef.current || currentIsCreditNote) {
          console.log('[InvoiceModal] Skipped invoice_type overwrite after fetching next number due to preserved selection or existing credit note', { preserved: preservedInvoiceTypeRef.current, currentIsCreditNote })
        } else {
          console.log('[InvoiceModal] invoice_type set after fetching next number', { invoice_type: selectedComprobanteOption.descripcion })
        }
        setSelectedPuntoVenta(selectedComprobanteOption.punto_de_venta)
      } catch (error) {
        console.error('Error asignando número de comprobante:', error)
        showNotification('No se pudo obtener la numeración del talonario seleccionado. Configure un talonario.', 'error')
      }
    }

    assignNextNumber()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedComprobanteOption,
    isEditing,
    editingInvoiceFullName,
    editingData?.docstatus,
    isOpen,
    talonariosFetchCompleted,
    filteredTalonarios.length,
    getTalonarioByName
  ])

  // Effect to recalculate totals when items change
  useEffect(() => {
    // Recalculate all item amounts
    setFormData(prev => ({
      ...prev,
      items: prev.items.map(item => ({
        ...item,
        amount: calculateItemAmount(item)
      }))
    }))
  }, [JSON.stringify(formData.items)]) // Use JSON.stringify to compare deep equality

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

  const handleSave = async () => {
    // Validations
    if (!formData.customer.trim()) {
      showNotification('Debe seleccionar un cliente', 'error')
      return
    }

    // Generar título por defecto si está vacío
    if (!formData.title.trim()) {
      const today = new Date()
      const dateStr = today.toLocaleDateString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      const customerName = customerDetails?.customer_name || selectedCustomer || 'Cliente'
      const defaultTitle = `${dateStr} - ${customerName}`
      handleInputChange('title', defaultTitle)
      // Actualizar formData inmediatamente para la validación
      formData.title = defaultTitle
    }

    const validItems = formData.items.filter(item =>
      (item.item_code && item.item_code.trim() !== '') || (item.description && item.description.trim() !== '')
    )

    if (validItems.length === 0) {
      showNotification('Debe agregar al menos un ítem con código o descripción a la factura', 'error')
      return
    }

    const total = calculateTotal(formData.items, formData)

    // Para facturas normales, el total debe ser positivo (mayor a cero)
    // Nota: Para notas de crédito, los valores se muestran positivos en el frontend
    // y el backend se encarga de convertirlos a negativos
    if (!isCreditNote(formData.invoice_type) && total <= 0) {
      showNotification('El total de la factura debe ser mayor a cero', 'error')
      return
    }

    // Construir el método de numeración correcto basado en los datos actuales del formulario
    const metodoNumeracionField = getMetodoNumeracionField(formData.invoice_type)
    let metodoNumeracionValue = formData[metodoNumeracionField] || formData.metodo_numeracion_factura_venta || ''

    // Si el método de numeración está vacío, construirlo basado en los datos del formulario
    if ((!metodoNumeracionValue || metodoNumeracionValue.trim() === '') && formData.status === 'Confirmada') {
      // Determinar prefijo (FE o FM)
      const prefix = 'FE' // Por defecto Factura Electrónica
      
      // Determinar tipo base según el tipo de documento
      let tipoBase = 'FAC'
      if (formData.invoice_type === 'Nota de Crédito') {
        tipoBase = 'NDC'
      } else if (formData.invoice_type === 'Nota de Débito') {
        tipoBase = 'NDB'
      } else if (formData.invoice_type === 'Recibo') {
        tipoBase = 'REC'
      }
      
      // Usar los datos actuales del formulario
      const letra = formData.invoice_category || 'A'
      const puntoVenta = String(formData.punto_de_venta || '00001').padStart(5, '0')
      const numeroDocumento = String(formData.invoice_number || '1').padStart(8, '0')
      
      // Construir el método de numeración
      metodoNumeracionValue = `${prefix}-${tipoBase}-${letra}-${puntoVenta}-${numeroDocumento}`
      
      console.log('� CONSTRUYENDO metodo_numeracion desde datos del formulario:', {
        prefix,
        tipoBase,
        letra,
        puntoVenta,
        numeroDocumento,
        result: metodoNumeracionValue
      })
    }

    if (formData.status === 'Confirmada') {
      console.log('�🔍 METODO NUMERACION - Validating:', {
        metodoNumeracionField,
        metodoNumeracionValue,
        invoice_type: formData.invoice_type,
        isEditing: isEditing,
        editingInvoiceNo: editingInvoiceNo,
        formData_invoice_number: formData.invoice_number,
        formData_punto_de_venta: formData.punto_de_venta,
        formData_invoice_category: formData.invoice_category,
        formData_metodo_numeracion_factura_venta: formData.metodo_numeracion_factura_venta,
        formData_metodo_numeracion_nota_credito: formData.metodo_numeracion_nota_credito,
        formData_metodo_numeracion_nota_debito: formData.metodo_numeracion_nota_debito
      })

      if (!metodoNumeracionValue || metodoNumeracionValue.trim() === '') {
        showNotification('Error interno: No se pudo determinar el método de numeración. Verifique la configuración del talonario.', 'error')
        return
      }

      // Validar formato del método de numeración
      if (metodoNumeracionValue.split('-').length < 5) {
        showNotification('Error: El método de numeración del talonario seleccionado tiene un formato inválido.', 'error')
        return
      }
    }    setIsSaving(true)
    try {
      let saveData
      let apiEndpoint

      if (isCreditNote(formData.invoice_type)) {
        // Para notas de crédito, usar el endpoint específico
        apiEndpoint = '/api/credit-debit-notes'

        // If editing, append the note name to the URL
        if (isEditing && editingInvoiceFullName) {
          apiEndpoint += `/${editingInvoiceFullName}`
        }

        // Preparar datos específicos para nota de crédito
        const primaryInvoice = formData.selected_unpaid_invoices && formData.selected_unpaid_invoices.length > 0
          ? formData.selected_unpaid_invoices[0].name
          : null

        // Asegurar que due_date sea siempre >= posting_date
        let finalDueDateCredit = formData.due_date || formData.posting_date
        if (finalDueDateCredit < formData.posting_date) {
          console.warn('⚠️  due_date was before posting_date in credit note, adjusting to posting_date')
          finalDueDateCredit = formData.posting_date
        }

        saveData = {
          data: {
            customer: formData.customer,
            company: companyName || activeCompany || '',
            posting_date: formData.posting_date,
            due_date: finalDueDateCredit,
            ...(primaryInvoice && { return_against: primaryInvoice }), // Solo incluir si hay factura relacionada
            is_return: 1, // Marcar como nota de crédito/débito
            title: formData.title,
            currency: formData.currency,
            invoice_number: (formData.invoice_number ?? '').toString().replace(/[^\d]/g, '').padStart(8, '0'),
            invoice_type: formData.invoice_type,
            punto_de_venta: formData.punto_de_venta,
            voucher_type_code: 'NC', // Para notas de crédito usar 'NC'
            invoice_category: formData.invoice_category,
            metodo_numeracion_factura_venta: metodoNumeracionValue, // Usar el método de numeración correcto basado en el tipo
            status: 'Return', // Para notas de crédito usar 'Return' en lugar de 'Borrador'/'Confirmada'
            docstatus: formData.status === 'Confirmada' ? 1 : (formData.status === 'Anulada' ? 2 : 0), // Agregar docstatus para confirmar/cancelar
            price_list: formData.price_list,
            items: validItems.map(item => ({
              item_code: extractItemCodeDisplay(item.item_code),
              item_name: item.item_name,
              description: item.description,
              warehouse: item.warehouse,
              cost_center: item.cost_center,
              uom: item.uom,
              qty: parseFloat(item.qty) || 1,
              rate: parseFloat(item.rate) || 0,
              discount_percent: parseFloat(item.discount_percent) || 0,
              iva_percent: parseFloat(item.iva_percent) || 21,
              amount: parseFloat(item.amount) || 0,
              account: item.account,
              income_account: item.income_account,
              delivery_note: item.delivery_note || item.against_delivery_note || '',
              dn_detail: item.dn_detail || item.delivery_note_item || '',
              sales_order: item.sales_order || item.against_sales_order || item.__source_sales_order || formData.sourceSalesOrder || '',
              so_detail: item.so_detail || item.sales_order_item || item.__source_so_detail || '',
              sales_order_item: item.sales_order_item || item.so_detail || item.__source_so_detail || ''
            })),
            discount_amount: parseFloat(formData.discount_amount) || 0,
            net_gravado: parseFloat(formData.net_gravado) || 0,
            net_no_gravado: parseFloat(formData.net_no_gravado) || 0,
            total_iva: parseFloat(formData.total_iva) || 0,
            percepcion_iva: parseFloat(formData.percepcion_iva) || 0,
            percepcion_iibb: parseFloat(formData.percepcion_iibb) || 0,
            sales_condition_type: formData.sales_condition_type,
            sales_condition_amount: formData.sales_condition_amount,
            sales_condition_days: formData.sales_condition_days,
            // Campos específicos de nota de crédito
            selected_unpaid_invoices: formData.selected_unpaid_invoices || [],
            credit_note_total: parseFloat(formData.credit_note_total) || 0
          },
          isEditing: isEditing
        }

        // If editing, include the invoice number
        if (isEditing && editingInvoiceFullName) {
          saveData.data.name = editingInvoiceFullName
        } else if (!isEditing) {
          // Para nuevas notas de crédito/débito en borrador, sugerir un nombre temporal
          if (formData.status !== 'Confirmada' && metodoNumeracionValue) {
            const tempName = `DRAFT-${metodoNumeracionValue}`
            saveData.data.temp_name = tempName
            console.log('🆕 Creating new credit/debit note draft - suggesting temp name:', tempName)
          }
        }
      } else {
        // Para facturas normales, usar el endpoint estándar
        apiEndpoint = '/api/invoices'

        // If editing, append the invoice name to the URL
        if (isEditing && editingInvoiceFullName) {
          apiEndpoint += `/${editingInvoiceFullName}`
        }

        // Asegurar que due_date sea siempre >= posting_date
        let finalDueDate = formData.due_date || formData.posting_date
        if (finalDueDate < formData.posting_date) {
          console.warn('⚠️  due_date was before posting_date, adjusting to posting_date')
          finalDueDate = formData.posting_date
        }

        saveData = {
          data: {
            voucher_type: "Sales Invoice",
            posting_date: formData.posting_date,
            due_date: finalDueDate,
            company: companyName || activeCompany || '',
            customer: formData.customer,
            title: formData.title,
            currency: formData.currency,
            invoice_number: (formData.invoice_number ?? '').toString().replace(/[^\d]/g, '').padStart(8, '0'),
            invoice_type: formData.invoice_type,
            punto_de_venta: formData.punto_de_venta,
            voucher_type_code: formData.voucher_type,
            invoice_category: formData.invoice_category,
            docstatus: formData.status === 'Confirmada' ? 1 : 0,
            save_as_draft: formData.status === 'Borrador',
            price_list: formData.price_list,
            metodo_numeracion_factura_venta: metodoNumeracionValue,
            items: validItems.map(item => ({
              item_code: extractItemCodeDisplay(item.item_code),
              item_name: item.item_name,
              description: item.description,
              warehouse: item.warehouse,
              cost_center: item.cost_center,
              uom: item.uom,
              qty: parseFloat(item.qty) || 1,
              rate: parseFloat(item.rate) || 0,
              discount_percent: parseFloat(item.discount_percent) || 0,
              iva_percent: parseFloat(item.iva_percent) || 21,
              amount: parseFloat(item.amount) || 0,
              account: item.account,
              income_account: item.income_account,
              delivery_note: item.delivery_note || item.against_delivery_note || '',
              dn_detail: item.dn_detail || item.delivery_note_item || '',
              sales_order: item.sales_order || item.against_sales_order || item.__source_sales_order || formData.sourceSalesOrder || '',
              so_detail: item.so_detail || item.sales_order_item || item.__source_so_detail || '',
              sales_order_item: item.sales_order_item || item.so_detail || item.__source_so_detail || ''
            })),
            discount_amount: parseFloat(formData.discount_amount) || 0,
            net_gravado: parseFloat(formData.net_gravado) || 0,
            net_no_gravado: parseFloat(formData.net_no_gravado) || 0,
            total_iva: parseFloat(formData.total_iva) || 0,
            percepcion_iva: parseFloat(formData.percepcion_iva) || 0,
            percepcion_iibb: parseFloat(formData.percepcion_iibb) || 0,
            sales_condition_type: formData.sales_condition_type,
            sales_condition_amount: formData.sales_condition_amount,
            sales_condition_days: formData.sales_condition_days,
            require_sales_order_links: forceSalesOrderConfirmation
          },
          isEditing: isEditing
        }

        console.log('🔍 STATUS DEBUGGING:', {
          'formData.status': formData.status,
          'docstatus in saveData': saveData.data.docstatus,
          'save_as_draft in saveData': saveData.data.save_as_draft
        })

        // If editing, include the invoice number
        if (isEditing) {
          // Para documentos CONFIRMADOS, usar el número del formulario (no del borrador original)
          if (formData.status === 'Confirmada' && editingInvoiceFullName) {
            // Si estamos confirmando un borrador, usar el nombre del borrador original como base
            // pero el número real vendrá del formData.invoice_number
            saveData.data.name = editingInvoiceFullName
            console.log('🔄 Confirming draft - using original draft name:', editingInvoiceFullName)
          } else if (editingInvoiceFullName) {
            // Para otras ediciones (manteniendo borrador), usar el nombre completo
            saveData.data.name = editingInvoiceFullName
            console.log('🔄 Editing draft - using full name:', editingInvoiceFullName)
          } else {
            console.log('🆕 Creating new invoice - NOT setting name field')
          }
        } else {
          // Para nuevos borradores, sugerir un nombre temporal basado en el método de numeración
          // Esto permitirá identificar el tipo de comprobante al editar
          if (formData.status === 'Borrador' && metodoNumeracionValue) {
            const tempName = `DRAFT-${metodoNumeracionValue}`
            saveData.data.temp_name = tempName
            console.log('🆕 Creating new draft - suggesting temp name:', tempName)
          } else {
            console.log('🆕 Creating new invoice - NOT setting name field')
          }
        }
      }

      // Llamar al endpoint correspondiente
      console.log(`🚀 --- ${isEditing ? 'Editando' : 'Creando nueva'} ${isCreditNote(formData.invoice_type) ? 'nota de crédito/débito' : 'factura'} ---`)
      console.log('📡 Endpoint:', apiEndpoint)
      console.log('📤 Datos enviados:', JSON.stringify(saveData, null, 2))

      const response = await fetchWithAuth(apiEndpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(saveData)
      })

      console.log('📥 Response status:', response.status)
      console.log('📥 Response headers:', Object.fromEntries(response.headers.entries()))

      if (response.ok) {
        const result = await response.json()
        console.log('✅ Response OK:', result)
        console.log('🔍 DEBUGGING WARNING:', {
          hasWarning: !!result.warning,
          warningType: typeof result.warning,
          warningKeys: result.warning ? Object.keys(result.warning) : null,
          warningContent: result.warning
        })
        
        if (result.success) {
          // Check if invoice was saved as draft due to missing data
          if (result.warning) {
            console.log('⚠️ WARNING DETECTED - showing draft warning modal')
            
            // Extract warning message and type - could be a string or object
            let warningMessage = 'Datos incompletos detectados'
            let warningType = 'general'
            if (typeof result.warning === 'string') {
              warningMessage = result.warning
            } else if (result.warning.message) {
              warningMessage = result.warning.message
            } else if (result.warning.details) {
              warningMessage = result.warning.details
            }
            
            if (result.warning && result.warning.type) {
              warningType = result.warning.type
            }
            
            setDraftWarningMessage(warningMessage)
            setDraftWarningType(warningType)
            setShowDraftWarningModal(true)
            
            // Don't close modal when saved as draft - user needs to fix issues
            // Reset editing state for new invoices to prevent infinite loops
            if (!isEditing) {
              setIsEditing(false)
              setEditingInvoiceNo(null)
              setEditingInvoiceFullName(null)
              setFreshInvoiceData(null)
            }
            
            // Don't call onClose() - keep modal open so user can fix issues
          } else {
            console.log('✅ NO WARNING - normal success notification')
            // Si es nota de crédito y hay facturas seleccionadas, intentar conciliar
            if (isCreditNote(formData.invoice_type) && formData.selected_unpaid_invoices && formData.selected_unpaid_invoices.length > 0) {
              try {
                const createdName = result.data && (result.data.name || result.data?.name)
                if (createdName) {
                  // Determinar si las facturas seleccionadas pertenecen a más de una conciliación
                  const selectedConcIds = new Set(
                    (formData.selected_unpaid_invoices || [])
                      .map(s => {
                        const inv = unpaidInvoices.find(u => u.name === s.name)
                        return inv ? inv.custom_conciliation_id : null
                      })
                      .filter(Boolean)
                  )

                  if (selectedConcIds.size > 1) {
                    showNotification('No se puede aplicar una nota de crédito para dos conciliaciones diferentes', 'error')
                  } else {
                    const payload = {
                      credit_note: createdName,
                      customer: formData.customer,
                      company: companyName || activeCompany,
                      allocations: (formData.selected_unpaid_invoices || []).map(s => ({ invoice: s.name }))
                    }
                    if (selectedConcIds.size === 1) {
                      payload.conciliation_id = Array.from(selectedConcIds)[0]
                    }

                    const recResp = await fetchWithAuth('/api/reconcile/credit-note', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload)
                    })

                    if (recResp && recResp.ok) {
                      const recResult = await recResp.json()
                      if (recResult.success) {
                        showNotification('Conciliación aplicada correctamente', 'success')
                      } else {
                        showNotification(`La nota se creó pero no se pudo conciliar: ${recResult.message || 'error'}`, 'warning')
                      }
                    } else {
                      showNotification('La nota se creó pero se produjo un error al intentar conciliar', 'warning')
                    }
                  }
                }
              } catch (err) {
                console.error('Error intentando conciliar credit note:', err)
                showNotification('La nota se creó pero ocurrió un error durante la conciliación', 'warning')
              }
            }

            // Normal successful save
            showNotification(
              isCreditNote(formData.invoice_type)
                ? `Nota de crédito ${isEditing ? 'actualizada' : 'creada'} exitosamente`
                : `Factura ${isEditing ? 'actualizada' : 'creada'} exitosamente`,
              'success'
            )
            
            // Reset editing state for new invoices/credit notes to prevent infinite loops
            if (!isEditing) {
              setIsEditing(false)
              setEditingInvoiceNo(null)
              setEditingInvoiceFullName(null)
              setFreshInvoiceData(null)
            }
            
            onClose()
          }
        } else {
          console.log('❌ Response success=false:', result)
          
          // Verificar si es un error de stock insuficiente
          if (result.error_type === 'negative_stock' && result.stock_error) {
            console.log('📦 Stock error detected, showing modal:', result.stock_error)
            setStockErrorData(result.stock_error)
            setShowStockErrorModal(true)
          } else {
            showNotification(result.message || 'Error al guardar', 'error')
          }
        }
      } else {
        let errorData
        try {
          const textResponse = await response.text()
          console.log('❌ Response ERROR (TEXT):', textResponse)
          // Try to parse as JSON
          try {
            errorData = JSON.parse(textResponse)
          } catch {
            errorData = { message: textResponse || 'Error desconocido' }
          }
        } catch (parseError) {
          console.log('❌ Error reading response:', parseError)
          errorData = { message: 'Error desconocido' }
        }

        console.log('💥 Error completo:', {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          errorData
        })

        // Verificar si es un error de stock insuficiente (puede venir con status 417)
        if (errorData.error_type === 'negative_stock' && errorData.stock_error) {
          console.log('📦 Stock error detected (from HTTP error), showing modal:', errorData.stock_error)
          setStockErrorData(errorData.stock_error)
          setShowStockErrorModal(true)
        } else {
          showNotification(errorData.message || 'Error al guardar', 'error')
        }
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!isEditing || !editingInvoiceFullName) {
      showNotification('No hay factura para eliminar', 'error')
      return
    }

    const confirmed = await confirm({
      title: 'Eliminar Factura',
      message: `¿Estás seguro de que quieres eliminar la factura "${editingInvoiceFullName}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'error'
    })

    if (!confirmed) return

    setIsDeleting(true)

    try {
      const response = await fetchWithAuth(`${API_ROUTES.invoices}/${editingInvoiceFullName}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        showNotification('Factura eliminada exitosamente', 'success')
        onClose()
      } else {
        const errorData = await response.json()
        showNotification(`Error al eliminar factura: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error deleting invoice:', error)
      showNotification('Error al eliminar factura', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  const openItemSettingsModal = async (item, index) => {
    // If item doesn't include is_stock_item, fetch minimal full details so the modal can decide fields to show
    let finalItem = item
    try {
      if (item && (item.is_stock_item === undefined || item.is_stock_item === null) && fetchWithAuth) {
        const itemKey = encodeURIComponent(item.name || item.item_code || '')
        if (itemKey) {
          const resp = await fetchWithAuth('/api/resource/Item/' + itemKey + "?fields=" + encodeURIComponent(JSON.stringify(['is_stock_item'])))
          if (resp.ok) {
            const json = await resp.json()
            if (json && json.data && Object.prototype.hasOwnProperty.call(json.data, 'is_stock_item')) {
              finalItem = { ...(item || {}), ...json.data }
            }
          }
        }
      }
    } catch (err) {
      console.debug('Could not fetch extra item details for modal, proceeding with original item', err)
    }

    setItemSettingsModal({
      isOpen: true,
      itemIndex: index,
      item: finalItem
    })
  }

  const closeItemSettingsModal = () => {
    setItemSettingsModal({
      isOpen: false,
      itemIndex: null,
      item: null
    })
  }

  const handleSaveItemSettings = (itemIndex, settings) => {
    console.log('💾 Guardando configuración del ítem:', itemIndex, settings)
    
    // Actualizar el ítem con la configuración guardada
    setFormData(prevFormData => ({
      ...prevFormData,
      items: prevFormData.items.map((item, index) => 
        index === itemIndex 
          ? {
              ...item,
              income_account: settings?.income_account ?? item.income_account,
              warehouse: settings?.warehouse ?? item.warehouse,
              cost_center: settings?.cost_center ?? item.cost_center,
              valuation_rate: settings?.valuation_rate ?? item.valuation_rate
            }
          : item
      )
    }))
    
    console.log('✅ Configuración del ítem guardada correctamente')
  }

  const resetForm = () => {
    const defaultIVARate = getDefaultIVARate()
    prefillAppliedRef.current = false
    setFormData({
      posting_date: new Date().toISOString().split('T')[0],
      due_date: '',
      invoice_number: '00000001',
      invoice_type: 'Factura Electrónica',
      voucher_type: 'Fa',
      invoice_category: 'A',
      status: 'Borrador',
      title: '',
      customer: selectedCustomer || '',
      currency: companyCurrency,
      exchange_rate: 1,
      price_list: '',
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
        account: '' // La cuenta de ingresos se determina automáticamente por el backend
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
    setForceSalesOrderConfirmation(false)
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

  const removeAssociatedDocument = (index) => {
    setSalesConditionData(prev => ({
      ...prev,
      associated_documents: prev.associated_documents.filter((_, i) => i !== index)
    }))
  }

  const handleLinkedDocumentsImport = useCallback(({ mergeStrategy, linkedDocuments, multiMakeResult }) => {
    const isCreditNoteMode = isCreditNote(formData.invoice_type)

    if (multiMakeResult && multiMakeResult.combined_document) {
      const patch = buildSalesInvoicePatchFromDocument(multiMakeResult.combined_document)
      const invoiceSummaries = multiMakeResult.invoice_summaries || []
      const normalizedSelections = invoiceSummaries.map(summary => {
        const amount = Math.abs(parseFloat(summary.suggested_amount) || 0)
        return {
          name: summary.return_against || summary.source_name,
          amount,
          allocated_amount: amount
        }
      })
      const totalSelected = normalizedSelections.reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)

      setFormData(prev => ({
        ...prev,
        posting_date: patch.posting_date || prev.posting_date,
        // Keep customer and company unchanged for credit notes
        currency: patch.currency || prev.currency,
        price_list: patch.price_list || prev.price_list,
        taxes: patch.taxes && patch.taxes.length ? patch.taxes : prev.taxes,
        items: patch.items && patch.items.length ? patch.items : prev.items,
        selected_unpaid_invoices: normalizedSelections,
        credit_note_total: totalSelected ? totalSelected.toString() : prev.credit_note_total
      }))

      // Ensure we preserve credit note mode if we started in that mode
      if (isCreditNoteMode) {
        setFormData(prev => ({ ...prev, invoice_type: 'Nota de Crédito' }))
      }
      
      // Restore user's preserved invoice_type and selected comprobante option (if any)
      const preserved = preservedInvoiceTypeRef.current
      if (preserved) {
        console.log('[InvoiceModal] Restoring preserved invoice_type (multiMakeResult)', { preserved })
        setFormData(prev => ({ ...prev, invoice_type: preserved }))
        const matching = comprobanteOptions.find(opt => opt.descripcion === preserved)
        if (matching) {
          console.log('[InvoiceModal] Re-selecting comprobante option after restore (multiMakeResult)', { option: matching.descripcion })
          setSelectedComprobanteOption(matching)
        }
        // Keep preserved value for a short while to avoid race with effects that react to option change
        console.log('[InvoiceModal] Scheduling clear of preserved invoice_type (multiMakeResult) in 2000ms')
        setTimeout(() => { preservedInvoiceTypeRef.current = null; console.log('[InvoiceModal] Cleared preserved invoice_type (multiMakeResult)') }, 2000)
      }
      // Re-enable automatic comprobante refresh after a short delay to avoid races
      const extendUntil = Date.now() + 1500
      suppressComprobanteRefreshRef.current = true
      suppressComprobanteUntilRef.current = extendUntil
      console.log('[InvoiceModal] Extending suppression shortly after multiMakeResult', { extend_until: new Date(extendUntil).toISOString() })
      showNotification('Nota de credito generada desde facturas con saldo', 'success')
      return
    }

    if (!linkedDocuments || linkedDocuments.length === 0) {
      showNotification('Selecciona al menos un documento para importar', 'warning')
      return
    }

    const patches = linkedDocuments
      .map(entry => buildSalesInvoicePatchFromDocument(entry.document))
      .filter(patch => patch && Array.isArray(patch.items) && patch.items.length > 0)

    if (patches.length === 0) {
      showNotification('Los documentos seleccionados no tienen items pendientes', 'warning')
      return
    }

    const reference = patches[0]
    const importedItems = patches.flatMap(patch => patch.items || [])
    const primaryLinkedSalesOrder = linkedDocuments.find(entry => entry.relation === 'sales_invoice_from_sales_order')?.sourceName || ''
    const creditSources = linkedDocuments.filter(entry => entry.relation === 'sales_credit_note_from_invoice')
    const creditSelections = creditSources.map(entry => {
      const amount = Math.abs(parseFloat(entry.document?.grand_total ?? entry.document?.rounded_total ?? 0))
      return {
        name: entry.sourceName,
        amount,
        allocated_amount: amount
      }
    })

    setFormData(prev => {
      const preservedItems = mergeStrategy === 'append'
        ? (prev.items || []).filter(item => item.item_code || item.description)
        : []

      const importedHasSalesOrder = hasSalesOrderReference(importedItems)
      const mergedItems = [...preservedItems, ...importedItems]
      const totalCreditAmount = creditSelections.reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0)

      return {
        ...prev,
        posting_date: reference.posting_date || prev.posting_date,
        customer: reference.customer || prev.customer,
        company: reference.company || prev.company,
        currency: reference.currency || prev.currency,
        taxes: reference.taxes && reference.taxes.length ? reference.taxes : prev.taxes,
        items: mergedItems,
        sourceSalesOrder: primaryLinkedSalesOrder || prev.sourceSalesOrder || '',
        selected_unpaid_invoices: creditSelections.length ? creditSelections : prev.selected_unpaid_invoices,
        credit_note_total: creditSelections.length ? totalCreditAmount.toString() : prev.credit_note_total
      }
    })

    // Re-assert credit note type if we were in credit note mode
    if (isCreditNoteMode) {
      setFormData(prev => ({ ...prev, invoice_type: 'Nota de Crédito' }))
    }

    // Restore user's preserved invoice_type and selected comprobante option (if any)
    const preserved2 = preservedInvoiceTypeRef.current
    if (preserved2) {
      console.log('[InvoiceModal] Restoring preserved invoice_type (linkedDocuments)', { preserved: preserved2 })
      setFormData(prev => ({ ...prev, invoice_type: preserved2 }))
      const matching2 = comprobanteOptions.find(opt => opt.descripcion === preserved2)
      if (matching2) {
        console.log('[InvoiceModal] Re-selecting comprobante option after restore (linkedDocuments)', { option: matching2.descripcion })
        setSelectedComprobanteOption(matching2)
      }
      // Keep preserved value for a short while to avoid race with effects that react to option change
      console.log('[InvoiceModal] Scheduling clear of preserved invoice_type (linkedDocuments) in 2000ms')
      setTimeout(() => { preservedInvoiceTypeRef.current = null; console.log('[InvoiceModal] Cleared preserved invoice_type (linkedDocuments)') }, 2000)
    }
    // Re-enable automatic comprobante refresh after a short delay to avoid races
    const extendUntil2 = Date.now() + 1500
    suppressComprobanteRefreshRef.current = true
    suppressComprobanteUntilRef.current = extendUntil2
    console.log('[InvoiceModal] Extending suppression shortly after linkedDocuments import', { extend_until: new Date(extendUntil2).toISOString() })
    showNotification(isCreditNoteMode ? 'Nota de credito generada desde facturas con saldo' : 'Items importados desde documentos vinculados', 'success')
  }, [setFormData, showNotification, hasSalesOrderReference, formData.invoice_type])

  const subtitle = (customerDetails?.customer_name || selectedCustomer)
    ? `${customerDetails?.customer_name || selectedCustomer}${customerDetails?.tax_id ? ` · CUIT: ${customerDetails.tax_id}` : ''}`
    : ''

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? `${editingInvoiceFullName && editingInvoiceFullName.includes('NDB') ? 'Editar Nota de débito' : 'Editar Factura'} - ${truncateInvoiceNumber(editingInvoiceNo)}` : `Nueva Factura`} subtitle={subtitle} size="default">
          <div className="flex flex-col md:flex-row gap-4 h-full overflow-hidden">
            <div className="flex-grow flex flex-col gap-4 overflow-y-auto">
              {/* SECCIÓN SUPERIOR COMPACTA */}
              <InvoiceModalHeader
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
                showSalesConditionField={customerHasPaymentTerm}
                isSalesConditionLocked={customerHasPaymentTerm}
                lockedSalesConditionName={customerPaymentTermName}
                allowDueDateEdit={!customerHasPaymentTerm}
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
                availablePriceLists={availablePriceLists}
                isLoadingComprobantes={isLoadingComprobantes}
                statusLocked={forceSalesOrderConfirmation}
                companyCurrency={companyCurrency}
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
                onUseSelection={() => {
                  // Preserve user's invoice_type selection and suppress automatic comprobante refresh
                  preservedInvoiceTypeRef.current = formData.invoice_type
                  const until = Date.now() + 5000
                  suppressComprobanteRefreshRef.current = true
                  suppressComprobanteUntilRef.current = until
                  console.log('[InvoiceModal] Preserving invoice_type and enabling suppression (UnpaidInvoicesSection)', { preserved: preservedInvoiceTypeRef.current, suppress_until: new Date(until).toISOString() })
                  setShowDocumentLinker(true)
                }}
              />

              {/* TABLA DE ÍTEMS */}
              <SalesItemsTable
                formData={formData}
                handleItemChange={handleItemChange}
                addItem={addItem}
                removeItem={removeItem}
                availableIVARates={availableIVARates}
                onOpenItemSettings={openItemSettingsModal}
                activeCompany={activeCompany}
                fetchWithAuth={fetchWithAuth}
                availableWarehouses={availableWarehouses}
                onSaveItemSettings={handleSaveItemSettings}
                showNotification={showNotification}
                showStockWarnings={true}
                priceListName={formData.price_list}
              />
            </div>        
            {/* Calcular totales para el resumen */}
            {(() => {
              const totals = {
                subtotal: calculateNetGravado(formData.items),
                discount: parseFloat(formData.discount_amount) || 0,
                iva: calculateTotalIVA(formData.items),
                total: calculateTotal(formData.items, formData)
              }
              
              return (
                <aside className="w-full md:w-80 flex-shrink-0">
                  <InvoiceSummary
                    formData={formData}
                    totals={totals}
                    formatCurrency={formatCurrency}
                    handleSave={handleSave}
                    handleDelete={handleDelete}
                    editingData={editingData}
                    isSaving={isSaving}
                    isDeleting={isDeleting}
                    isLoadingComprobantes={isLoadingComprobantes}
                    comprobanteOptionsLoaded={comprobanteOptionsLoaded}
                    onLinkDocuments={() => {
                        preservedInvoiceTypeRef.current = formData.invoice_type
                        const until2 = Date.now() + 5000
                        suppressComprobanteRefreshRef.current = true
                        suppressComprobanteUntilRef.current = until2
                        console.log('[InvoiceModal] Preserving invoice_type and enabling suppression (InvoiceSummary)', { preserved: preservedInvoiceTypeRef.current, suppress_until: new Date(until2).toISOString() })
                      setShowDocumentLinker(true)
                    }}
                  />
                </aside>
              )
            })()}
        
      </div>

      <SalesItemSettingsModal
        isOpen={itemSettingsModal.isOpen}
        item={itemSettingsModal.item}
        itemIndex={itemSettingsModal.itemIndex}
        onClose={closeItemSettingsModal}
        onSave={handleSaveItemSettings}
        availableWarehouses={availableWarehouses}
        fetchWithAuth={fetchWithAuth}
      />

      {/* Modal de Condición de Venta MiPyME */}
      {showSalesConditionModal && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setShowSalesConditionModal(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[70] w-full max-w-2xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">Configurar Opciones de Transmisión MiPyME</h3>
                <button onClick={() => setShowSalesConditionModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Opción de Transmisión *</label>
                  <select
                    value={salesConditionData.transmission_option}
                    onChange={(e) => handleSalesConditionChange('transmission_option', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Seleccionar opción</option>
                    <option value="Transferencia Sistema de Circulación Abierta">Transferencia Sistema de Circulación Abierta</option>
                    <option value="Agente de Depósito Colectivo">Agente de Depósito Colectivo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">CBU de la Empresa</label>
                  <input
                    type="text"
                    value={salesConditionData.cbu}
                    onChange={(e) => handleSalesConditionChange('cbu', e.target.value)}
                    placeholder="0000000000000000000000"
                    maxLength="22"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">Ingrese el CBU de 22 dígitos de la empresa</p>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Información MiPyME</h4>
                  <div className="text-sm text-gray-700 space-y-1">
                    <p>• Transferencia Sistema de Circulación Abierta: Para operaciones con circulación abierta</p>
                    <p>• Agente de Depósito Colectivo: Para operaciones con agentes de depósito</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowSalesConditionModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200">Cancelar</button>
                <button onClick={() => { showNotification('Configuración FCE guardada correctamente', 'success'); setShowSalesConditionModal(false); }} className="px-4 py-2 text-sm font-bold text-black bg-blue-600 border border-blue-600 rounded-lg hover:bg-blue-700">Aplicar Configuración</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal de advertencia cuando se guarda como borrador */}
      {showDraftWarningModal && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[2147483646] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-8">
                <div className="flex items-center mb-6">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-xl font-bold text-gray-900">Factura Guardada como Borrador</h3>
                    <p className="text-sm text-gray-600 mt-1">La factura no se pudo emitir debido a datos incompletos</p>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h4 className="text-sm font-medium text-yellow-800">Problemas detectados:</h4>
                      <div className="mt-2 text-sm text-yellow-700">
                        {draftWarningType === 'valuation_rate_missing' ? (
                          <div className="space-y-2">
                            <p className="font-medium">Esto es raro porque no podés dar de alta un item con stock sin el valuation rate.</p>
                            <p>Si por alguna razón misteriosa estás vendiendo algo que no está inventariado, le tenés que poner un precio. Puede buscarlo en base a la lista de precios del proveedor o si hay alguien en el lugar que se acuerda cuánto vale eso, que haga memoria y se le pone un número aproximado.</p>
                            <p className="font-medium">No podés vender un producto que no sabés cuánto te costó adquirirlo... hace 7000 años ya se sabía esto.</p>
                          </div>
                        ) : (
                          <p className="whitespace-pre-line">{draftWarningMessage}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h4 className="text-sm font-medium text-blue-800">¿Qué hacer ahora?</h4>
                      <div className="mt-2 text-sm text-blue-700">
                        {draftWarningType === 'valuation_rate_missing' ? (
                          <ul className="list-disc list-inside space-y-1">
                            <li>Revisá si el item realmente existe en el inventario y tiene valuation rate configurado</li>
                            <li>Si no existe, crealo primero con su precio de costo antes de venderlo</li>
                            <li>Si es un item único o especial, asignale un precio de costo aproximado basado en listas de proveedores o memoria</li>
                            <li>Una vez configurado el valuation rate, podrás confirmar la factura</li>
                          </ul>
                        ) : (
                          <ul className="list-disc list-inside space-y-1">
                            <li>Complete los datos faltantes en la factura</li>
                            <li>Verifique que todos los items tengan cuentas contables asignadas</li>
                            <li>Asegúrese de que los precios y cantidades sean correctos</li>
                            <li>Una vez completado, podrá confirmar la factura</li>
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowDraftWarningModal(false)}
                    className="px-6 py-3 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-xl hover:bg-gray-200 transition-colors duration-200"
                  >
                    Entendido, editar factura
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal de error de stock insuficiente */}
      <StockErrorModal 
        isOpen={showStockErrorModal && stockErrorData}
        onClose={() => {
          setShowStockErrorModal(false)
          setStockErrorData(null)
        }}
        stockErrorData={stockErrorData}
        extractItemCodeDisplay={extractItemCodeDisplay}
      />

      <ConfirmDialog />
    </Modal>

    <DocumentLinkerModal
      isOpen={showDocumentLinker}
      onClose={() => setShowDocumentLinker(false)}
      context="sales_invoice"
      customerName={formData.customer || selectedCustomer || ''}
      invoiceType={formData.invoice_type}
      company={companyName || activeCompany || ''}
      fetchWithAuth={fetchWithAuth}
      showNotification={showNotification}
      onLinked={handleLinkedDocumentsImport}
    />
    </>
  )
}

export default InvoiceModal
