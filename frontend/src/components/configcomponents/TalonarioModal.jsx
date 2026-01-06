import React, { useState, useContext, useEffect } from 'react'
import afipCodes from '../../../../shared/afip_codes.json'
import { Save } from 'lucide-react'
import Modal from '../Modal'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'

const TalonarioModal = ({ isOpen, onClose, talonario = null, onSave }) => {
  const { fetchWithAuth, activeCompany: activeCompanyFromContext } = useContext(AuthContext)
  const { showNotification } = useNotification()

  // Estados para modal de talonarios
  const [talonarioFormData, setTalonarioFormData] = useState({
    name: '',
    descripcion: 'Talonario electrónico',
    punto_de_venta: '00001',
    letras: [], // Cambiado de 'letra' a 'letras' como tabla hija
    tipo_de_talonario: 'FACTURA ELECTRONICA',
    tipo_de_comprobante_afip: [],
    numero_de_inicio: '00000001',
    numero_de_fin: '99999999',
    tipo_numeracion: 'Automática',
    por_defecto: false,
    factura_electronica: true,
    metodo_numeracion_factura_venta: '',
    metodo_numeracion_nota_debito: '',
    metodo_numeracion_nota_credito: '',
    tipo_comprobante_orden_pago: '',
    tipo_comprobante_recibo: '',
    tipo_comprobante_remito: '',
    tipo_comprobante_factura_electronica: '',
    possibleLetters: '',
    docstatus: 0
  })
  const [isCreatingTalonario, setIsCreatingTalonario] = useState(false)
  const [selectedTalonario, setSelectedTalonario] = useState(null)
  const [isProcessingDisable, setIsProcessingDisable] = useState(false)

  // Estados para lógica de talonarios
  const [companyCondicionIVA, setCompanyCondicionIVA] = useState('')
  const [availableComprobanteTypes, setAvailableComprobanteTypes] = useState([])
  const [filteredComprobanteTypes, setFilteredComprobanteTypes] = useState([])
  const [availableLetras, setAvailableLetras] = useState([])

  // Estados para tipos de talonarios disponibles
  const [availableTalonarioTypes, setAvailableTalonarioTypes] = useState({
    electronic_types: [],
    physical_types: [],
    all_types: []
  })

  // Estados para últimos números utilizados
  const [ultimosNumeros, setUltimosNumeros] = useState([])
  const [loadingUltimosNumeros, setLoadingUltimosNumeros] = useState(false)
  const getDocstatusBadge = (docstatus) => {
    switch (docstatus) {
      case 1:
        return { label: 'Activo', classes: 'bg-green-100 text-green-800' }
      case 2:
        return { label: 'Deshabilitado', classes: 'bg-gray-200 text-gray-600' }
      default:
      return { label: 'Borrador', classes: 'bg-yellow-100 text-yellow-800' }
    }
  }

  const sanitizeResguardoLetters = (letters = []) => {
    if (!Array.isArray(letters) || letters.length === 0) {
      return []
    }

    const firstValid = letters.find(letter => letter && letter.letra)
    if (!firstValid) {
      return []
    }

    const normalizedLetter = firstValid.letra?.toString().trim().toUpperCase()
    if (!normalizedLetter) {
      return []
    }

    return [{ ...firstValid, letra: normalizedLetter }]
  }

  // Cargar condición IVA y tipos de comprobante cuando se abre el modal
  useEffect(() => {
    if (isOpen && activeCompanyFromContext) {
      loadCompanyCondicionIVA(activeCompanyFromContext)
      loadAvailableComprobanteTypes()
      loadAvailableLetras()
      loadAvailableTalonarioTypes()
      
      // Cargar últimos números si estamos editando un talonario
      if (talonario && talonario.name) {
        loadUltimosNumeros(talonario.name)
      }
    }
  }, [isOpen, activeCompanyFromContext, talonario])

  // Limpiar últimos números cuando cambia el modo del modal
  useEffect(() => {
    if (isOpen) {
      if (!talonario) {
        // Modo creación - limpiar últimos números
        setUltimosNumeros([])
      }
    }
  }, [isOpen, talonario])

  // Inicializar datos del formulario cuando se abre el modal
  useEffect(() => {
    if (isOpen) {
      if (talonario) {
        // Modo edición
        setSelectedTalonario(talonario)
        const mappedLetters = (talonario.letras || []).map(letra => ({
          ...letra,
          letra: letra.letra // asegurar que tenga el campo correcto
        }))
        const safeLetters = talonario.tipo_de_talonario === 'TALONARIOS DE RESGUARDO'
          ? sanitizeResguardoLetters(mappedLetters)
          : mappedLetters

        setTalonarioFormData({
          name: talonario.name || '',
          descripcion: talonario.descripcion || '',
          punto_de_venta: talonario.punto_de_venta || '',
          letras: safeLetters,
          tipo_de_talonario: talonario.tipo_de_talonario || '',
          tipo_de_comprobante_afip: (talonario.tipo_de_comprobante_afip || []).map(tc => ({
            ...tc,
            tipo_comprobante: tc.codigo_afip || tc.tipo_comprobante // normalizar el campo
          })),
          numero_de_inicio: talonario.numero_de_inicio || '',
          numero_de_fin: talonario.numero_de_fin || '',
          tipo_numeracion: talonario.factura_electronica ? 'Automática' : (talonario.tipo_numeracion || ''),
          por_defecto: talonario.por_defecto || false,
          factura_electronica: talonario.factura_electronica || false,
          metodo_numeracion_factura_venta: talonario.metodo_numeracion_factura_venta || '',
          metodo_numeracion_nota_debito: talonario.metodo_numeracion_nota_debito || '',
          metodo_numeracion_nota_credito: talonario.metodo_numeracion_nota_credito || '',
          tipo_comprobante_orden_pago: talonario.tipo_comprobante_orden_pago || '',
          tipo_comprobante_recibo: talonario.tipo_comprobante_recibo || '',
          tipo_comprobante_remito: talonario.tipo_comprobante_remito || '',
          tipo_comprobante_factura_electronica: talonario.tipo_comprobante_factura_electronica || '',
          possibleLetters: getPossibleLetters(talonario.tipo_de_talonario || '', companyCondicionIVA).join(', '),
          docstatus: talonario.docstatus ?? 0
        })
        setIsCreatingTalonario(false)
      } else {
        // Modo creación
        setSelectedTalonario(null)
        setTalonarioFormData({
          name: '',
          descripcion: '',
          punto_de_venta: '',
          letras: [], // Cambiado de 'letra' a 'letras'
          tipo_de_talonario: availableTalonarioTypes.electronic_types?.[0] || 'FACTURA ELECTRONICA',
          tipo_de_comprobante_afip: [],
          numero_de_inicio: '',
          numero_de_fin: '',
          tipo_numeracion: 'Automática', // Por defecto automática para electrónicos
          por_defecto: false,
          factura_electronica: true,
          metodo_numeracion_factura_venta: '',
          metodo_numeracion_nota_debito: '',
          metodo_numeracion_nota_credito: '',
          tipo_comprobante_orden_pago: '',
          tipo_comprobante_recibo: '',
          tipo_comprobante_remito: '',
          tipo_comprobante_factura_electronica: '',
          possibleLetters: '',
          docstatus: 0
        })
        setIsCreatingTalonario(true)
      }
    }
  }, [isOpen, talonario])

  // Función para cargar condición IVA de la compañía
  const loadCompanyCondicionIVA = async (companyName) => {
    try {
      const response = await fetchWithAuth(`/api/companies/${companyName}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const condicionIVA = data.data?.custom_condicion_iva || ''
          console.log('Condición IVA cargada:', condicionIVA)
          setCompanyCondicionIVA(condicionIVA)
        } else {
          console.log('Error en respuesta de compañía:', data)
        }
      } else {
        console.log('Error en fetch de compañía:', response.status)
      }
    } catch (err) {
      console.error('Error loading company condicion IVA:', err)
    }
  }

  // Función para cargar tipos de comprobante disponibles
  const loadAvailableComprobanteTypes = async () => {
    try {
      console.log('Cargando tipos de comprobante AFIP...')
      const response = await fetchWithAuth('/api/resource/Tipo Comprobante AFIP?fields=["name","codigo_afip","descripcion"]&limit=1000')
      console.log('Respuesta de tipos de comprobante:', response.status, response.ok)
      if (response.ok) {
        const data = await response.json()
        console.log('Datos de tipos de comprobante:', data)
        if (data.success) {
          // Filtrar tipos con descripción válida (no vacía y no solo "-")
          const filteredTypes = (data.data || [])
            .filter(type => type.codigo_afip && String(type.codigo_afip).trim() !== '')
            .map(type => ({
              ...type,
              descripcion: (type.descripcion && String(type.descripcion).trim() && String(type.descripcion).trim() !== '-' && String(type.descripcion).trim().toLowerCase() !== 'desconocido')
                ? type.descripcion
                : (afipCodes.comprobantes?.[String(type.codigo_afip).padStart(3, '0')]?.description || type.descripcion)
            }))
            .sort((a, b) => parseInt(a.codigo_afip) - parseInt(b.codigo_afip))
          console.log('Tipos filtrados:', filteredTypes.length, filteredTypes)
          setAvailableComprobanteTypes(filteredTypes)
        } else {
          console.log('Respuesta no success:', data)
        }
      } else {
        console.log('Respuesta no ok:', response.status)
      }
    } catch (err) {
      console.error('Error loading comprobante types:', err)
    }
  }

  // Función para cargar letras disponibles
  const loadAvailableLetras = async () => {
    try {
      const response = await fetchWithAuth('/api/resource/DocType/Talonario')
      if (response.ok) {
        const letrasData = await response.json()
        // Extraer las opciones del campo 'letra'
        const letraField = letrasData.data?.fields?.find(field => field.fieldname === 'letra')
        if (letraField && letraField.options) {
          const letras = letraField.options.split('\n').filter(letra => letra.trim())
          setAvailableLetras(letras)
        }
      }
    } catch (err) {
      console.error('Error loading available letras:', err)
    }
  }

  // Función para cargar tipos de talonarios disponibles
  const loadAvailableTalonarioTypes = async () => {
    try {
      console.log('Cargando tipos de talonarios disponibles...')
      const response = await fetchWithAuth('/api/talonarios/types')
      console.log('Respuesta de tipos de talonarios:', response.status, response.ok)
      if (response.ok) {
        const data = await response.json()
        console.log('Datos de tipos de talonarios:', data)
        if (data.success) {
          setAvailableTalonarioTypes(data.data)
        } else {
          console.log('Respuesta no success:', data)
        }
      } else {
        console.log('Respuesta no ok:', response.status)
      }
    } catch (err) {
      console.error('Error loading talonario types:', err)
    }
  }

  // Función para cargar últimos números utilizados de un talonario
  const loadUltimosNumeros = async (talonarioName) => {
    if (!talonarioName) return
    
    setLoadingUltimosNumeros(true)
    try {
      console.log('Cargando últimos números del talonario:', talonarioName)
      const response = await fetchWithAuth(`/api/talonarios/${talonarioName}/ultimos-numeros`)
      console.log('Respuesta de últimos números:', response.status, response.ok)
      
      if (response.ok) {
        const data = await response.json()
        console.log('Datos de últimos números:', data)
        if (data.success) {
          setUltimosNumeros(data.data.ultimos_numeros || [])
        } else {
          console.log('Respuesta no success para últimos números:', data)
          setUltimosNumeros([])
        }
      } else {
        console.log('Respuesta no ok para últimos números:', response.status)
        setUltimosNumeros([])
      }
    } catch (err) {
      console.error('Error loading ultimos numeros:', err)
      setUltimosNumeros([])
    } finally {
      setLoadingUltimosNumeros(false)
    }
  }

  // Función para obtener letras posibles según tipo de talonario y condición IVA
  const getPossibleLetters = (tipoTalonario, condicionIVA) => {
    const isResponsableInscripto = condicionIVA === 'Responsable Inscripto'
    const isMonotributista = condicionIVA === 'Monotributista'
    const isExento = condicionIVA === 'Exento'

    switch (tipoTalonario) {
      case 'REMITOS ELECTRONICOS':
        return ['R']
      case 'FACTURA ELECTRONICA':
        if (isResponsableInscripto) return ['A', 'B', 'M']
        if (isMonotributista || isExento) return ['C']
        return []
      case 'COMPROBANTES DE EXPORTACION ELECTRONICOS':
        return ['E']
      case 'REMITOS':
        return ['R']
      case 'TALONARIOS DE RESGUARDO':
        if (isResponsableInscripto) return ['A', 'B', 'M', 'X']
        if (isMonotributista || isExento) return ['C', 'X']
        return ['X']
      case 'TICKETEADORA FISCAL':
        if (isResponsableInscripto) return ['A', 'B', 'M']
        if (isMonotributista || isExento) return ['C']
        return []
      case 'RECIBOS':
        return ['X']
      case 'ORDENES DE COMPRA':
        return ['X']
      default:
        return []
    }
  }

  // Función para filtrar tipos de comprobante según tipo de talonario y condición IVA
  const filterComprobanteTypes = (tipoTalonario, condicionIVA, possibleLetters) => {
    console.log('Filtrando tipos:', { tipoTalonario, condicionIVA, possibleLetters, availableCount: availableComprobanteTypes.length })

    // Órdenes de Compra y Recibos no tienen relación con tipos de comprobantes AFIP
    if (tipoTalonario === 'ORDENES DE COMPRA' || tipoTalonario === 'RECIBOS') {
      console.log(`${tipoTalonario}: no tiene relación con tipos de comprobantes AFIP`)
      return []
    }

    if (!tipoTalonario || !availableComprobanteTypes.length) return []

    const isResponsableInscripto = condicionIVA === 'Responsable Inscripto'
    const isMonotributista = condicionIVA === 'Monotributista'
    const isExento = condicionIVA === 'Exento'

    let allowedCodes = []

    switch (tipoTalonario) {
      case 'REMITOS ELECTRONICOS':
        // Keep electronic remitos focused: only AFIP 088 is the standard electronic remito
        allowedCodes = getCodesByTipo('REM').filter(c => c === '088')
        break
      case 'COMPROBANTES DE EXPORTACION ELECTRONICOS':
        // Export types are specific AFIP comprobantes (search shared mapping for 'Export')
        allowedCodes = Object.entries(afipCodes.comprobantes || {})
          .filter(([, info]) => info && info.description && String(info.description).toLowerCase().includes('export'))
          .map(([code]) => String(code).padStart(3, '0'))
        break
        break
      case 'FACTURA ELECTRONICA':
        if (isResponsableInscripto) {
          // A -> invoices, credit notes, debit notes, receipts
          if (possibleLetters.includes('A')) allowedCodes.push(...getCodesByTipo('FAC'), ...getCodesByTipo('NCC'), ...getCodesByTipo('NDB'), ...getCodesByTipo('REC'))
          // B -> invoices, credit notes, orders, remitos
          if (possibleLetters.includes('B')) allowedCodes.push(...getCodesByTipo('FAC'), ...getCodesByTipo('NCC'), ...getCodesByTipo('ORD'), ...getCodesByTipo('REM'))
          // M -> order-related codes
          if (possibleLetters.includes('M')) allowedCodes.push(...getCodesByTipo('ORD'))
        } else if (isMonotributista || isExento) {
          // Simpler selection for monotributo/exento
          allowedCodes = [...getCodesByTipo('FAC'), ...getCodesByTipo('NCC'), ...getCodesByTipo('NDB'), ...getCodesByTipo('REC')]
        }
        break
        case 'REMITOS':
          // All remito codes available. If this talonario is not electronic, exclude the electronic remito (088).
          allowedCodes = getCodesByTipo('REM')
          if (!talonarioFormData.factura_electronica) {
            allowedCodes = allowedCodes.filter(c => c !== '088')
          }
        break
      case 'TALONARIOS DE RESGUARDO':
        // Similar to invoices but more permissive (resguardo can be mixed)
        if (isResponsableInscripto) {
          if (possibleLetters.includes('A')) allowedCodes.push(...getCodesByTipo('FAC'), ...getCodesByTipo('NCC'), ...getCodesByTipo('NDB'), ...getCodesByTipo('REC'))
          if (possibleLetters.includes('B')) allowedCodes.push(...getCodesByTipo('FAC'), ...getCodesByTipo('NCC'), ...getCodesByTipo('ORD'), ...getCodesByTipo('REM'))
          if (possibleLetters.includes('M')) allowedCodes.push(...getCodesByTipo('ORD'))
        } else if (isMonotributista || isExento) {
          allowedCodes = [...getCodesByTipo('FAC'), ...getCodesByTipo('NCC'), ...getCodesByTipo('NDB'), ...getCodesByTipo('REC')]
        }
        // Additionally, always include any AFIP comprobante explicitly marked with letra 'X'
        // This ensures that special comprobantes like Factura X (ej: 999) are available
        // for Talonarios de Resguardo even if their "tipo" doesn't match the usual groups.
        try {
          const xCodes = Object.entries(afipCodes.comprobantes || {})
            .filter(([, info]) => info && String(info.letra || '').toUpperCase() === 'X')
            .map(([code]) => String(code).padStart(3, '0'))
          allowedCodes.push(...xCodes)
        } catch (e) {
          console.warn('Error while appending X-letter AFIP codes:', e)
        }
        break
      case 'TICKETEADORA FISCAL':
        // Ticketera combinations: combine remitos, credit/debit/informes/tique types
        if (isResponsableInscripto) {
          if (possibleLetters.includes('A')) allowedCodes.push(...getCodesByTipo('REM'), ...getCodesByTipo('NCC'), ...getCodesByTipo('NDB'), ...getCodesByTipo('INF'), ...getCodesByTipo('TIQ'))
          if (possibleLetters.includes('B')) allowedCodes.push(...getCodesByTipo('REM'), ...getCodesByTipo('NCC'), ...getCodesByTipo('NDB'))
          if (possibleLetters.includes('M')) allowedCodes.push(...getCodesByTipo('NDB'), ...getCodesByTipo('INF'), ...getCodesByTipo('TIQ'))
        } else if (isMonotributista || isExento) {
          allowedCodes = [...getCodesByTipo('FAC'), ...getCodesByTipo('NCC'), ...getCodesByTipo('NDB')]
        }
        // Always include Informe/Tique related codes
        allowedCodes.push(...getCodesByTipo('INF'), ...getCodesByTipo('TIQ'))
        break
        break
      default:
        return []
    }

    // If not electronic talonario, exclude known electronic-only codes globally
    // Deduplicate allowed codes (some pushes may include duplicates)
    try {
      allowedCodes = Array.from(new Set(allowedCodes.map(c => String(c).padStart(3, '0'))))
    } catch (e) {
      // fallback: keep as-is
      console.warn('Error deduping allowedCodes:', e)
    }

    // Excluir códigos que no corresponden a talonarios (p.ej. Despacho de Importación 066)
    try {
      allowedCodes = allowedCodes.filter(c => c !== '066')
    } catch (e) {
      console.warn('Error filtering out excluded AFIP codes:', e)
    }

    if (!talonarioFormData.factura_electronica) {
      allowedCodes = allowedCodes.filter(c => c !== '088')
    }
    console.log('Códigos permitidos:', allowedCodes)
    const filtered = availableComprobanteTypes.filter(type => allowedCodes.includes(String(type.codigo_afip).padStart(3, '0')))
    console.log('Tipos filtrados:', filtered.length)
    return filtered
  }

  // useEffect para actualizar letras y comprobantes cuando cambia tipo_de_talonario
  useEffect(() => {
    if (talonarioFormData.tipo_de_talonario) {
      // Usar condición IVA si está disponible, sino asumir Responsable Inscripto por defecto
      const currentCondicionIVA = companyCondicionIVA || 'Responsable Inscripto'
      const possibleLetters = getPossibleLetters(talonarioFormData.tipo_de_talonario, currentCondicionIVA)
      setTalonarioFormData(prev => ({ ...prev, possibleLetters: possibleLetters.join(', ') }))
      const filtered = filterComprobanteTypes(talonarioFormData.tipo_de_talonario, currentCondicionIVA, possibleLetters)
      setFilteredComprobanteTypes(filtered)

      // Auto-select single comprobarte if only one option exists and we're in creation mode
      if (filtered.length === 1 && isCreatingTalonario) {
        const onlyCode = filtered[0].codigo_afip
        setTalonarioFormData(prev => {
          if (!prev.tipo_de_comprobante_afip || prev.tipo_de_comprobante_afip.length === 0) {
            return { ...prev, tipo_de_comprobante_afip: [{ tipo_comprobante: onlyCode, doctype: 'Talonario Comprobante' }] }
          }
          return prev
        })
      }

      // Configurar automáticamente según el tipo de talonario
      if (talonarioFormData.factura_electronica) {
        // Talonarios electrónicos: setear automáticamente todas las letras
        const letrasAuto = possibleLetters.map(letra => ({ letra: letra, doctype: 'Talonario Letra' }))
        setTalonarioFormData(prev => ({
          ...prev,
          letras: letrasAuto
        }))
        if (filtered.length > 0) {
          const comprobantesAuto = filtered.map(type => ({ tipo_comprobante: type.codigo_afip, doctype: 'Talonario Comprobante' }))
          setTalonarioFormData(prev => ({
            ...prev,
            tipo_de_comprobante_afip: comprobantesAuto
          }))
        }
      } else if (talonarioFormData.tipo_de_talonario === 'TALONARIOS DE RESGUARDO') {
        // Talonarios de resguardo: derive letter from selected Tipo de Comprobante AFIP
        // If only one filtered comprobante exists, auto-select it and map letter
        if (filtered.length === 1) {
          const onlyCode = filtered[0].codigo_afip
          const mapped = afipCodes.comprobantes?.[String(onlyCode).padStart(3, '0')] || {}
          const derivedLetter = mapped.letra || (possibleLetters.length === 1 ? possibleLetters[0] : '')
          setTalonarioFormData(prev => ({
            ...prev,
            tipo_de_comprobante_afip: [{ tipo_comprobante: onlyCode, doctype: 'Talonario Comprobante' }],
            letras: derivedLetter ? [{ letra: derivedLetter, doctype: 'Talonario Letra' }] : []
          }))
        } else {
          setTalonarioFormData(prev => ({
            ...prev,
            tipo_de_comprobante_afip: prev.tipo_de_comprobante_afip || [],
            letras: sanitizeResguardoLetters(prev.letras)
          }))
        }
      } else if (talonarioFormData.tipo_de_talonario === 'ORDENES DE COMPRA' || talonarioFormData.tipo_de_talonario === 'RECIBOS') {
        // Órdenes de compra y recibos: limpiar tipos de comprobante y setear letra X automáticamente
        setTalonarioFormData(prev => ({
          ...prev,
          tipo_de_comprobante_afip: [],
          letras: [{ letra: 'X', doctype: 'Talonario Letra' }]
        }))
      } else if (!talonarioFormData.factura_electronica && possibleLetters.length > 0) {
        // Talonarios físicos: preseleccionar letras y tipos de comprobante disponibles automáticamente
        const letrasAuto = possibleLetters.map(letra => ({ letra: letra, doctype: 'Talonario Letra' }))
        const comprobantesAuto = filtered.length > 0 ? filtered.map(type => ({ tipo_comprobante: type.codigo_afip, doctype: 'Talonario Comprobante' })) : []
        setTalonarioFormData(prev => ({
          ...prev,
          letras: letrasAuto,
          tipo_de_comprobante_afip: comprobantesAuto
        }))
      }
    } else {
      setFilteredComprobanteTypes([])
      setTalonarioFormData(prev => ({ ...prev, possibleLetters: '' }))
    }
  }, [talonarioFormData.tipo_de_talonario, companyCondicionIVA, availableComprobanteTypes, talonarioFormData.factura_electronica])

  // Función para manejar cambios en el formulario
  const handleTalonarioFormChange = (field, value) => {
    setTalonarioFormData(prev => ({ ...prev, [field]: value }))

  }

  // Función para agregar tipo de comprobante
  const handleAddComprobanteType = (tipoComprobante) => {
    if (tipoComprobante && !talonarioFormData.tipo_de_comprobante_afip.some(tc => tc.tipo_comprobante === tipoComprobante)) {
      setTalonarioFormData(prev => ({
        ...prev,
        tipo_de_comprobante_afip: [...prev.tipo_de_comprobante_afip, { tipo_comprobante: tipoComprobante }]
      }))
    }
  }

  // Función para remover tipo de comprobante
  const handleRemoveComprobanteType = (tipoComprobante) => {
    setTalonarioFormData(prev => ({
      ...prev,
      tipo_de_comprobante_afip: prev.tipo_de_comprobante_afip.filter(tc => tc.tipo_comprobante !== tipoComprobante)
    }))
  }

  // Use central mapping from shared/afip_codes.json
  // Import the JSON mapping at build-time so the frontend always uses the canonical mapping
  const mapAfipToDocType = (codigoAfip) => {
    if (!codigoAfip && codigoAfip !== 0) return ''
    const key = String(codigoAfip).padStart(3, '0')
    const info = (afipCodes.comprobantes || {})[key] || {}
    return info.tipo || ''
  }

  // Return an array of AFIP codes (3-digit strings) for a given short tipo
  const getCodesByTipo = (tipo) => {
    if (!tipo) return []
    return Object.entries(afipCodes.comprobantes || {})
      .filter(([, info]) => info && info.tipo && String(info.tipo).toUpperCase() === String(tipo).toUpperCase())
      .map(([code]) => String(code).padStart(3, '0'))
  }

  // Return a friendly description for a comprobante code using ERPNext value or shared afip mapping as a fallback
  const getComprobanteDescription = (codigoAfip, fallbackDesc) => {
    const code = String(codigoAfip || '').padStart(3, '0')
    const descFromErp = fallbackDesc && String(fallbackDesc).trim()
    if (descFromErp && descFromErp !== '-' && descFromErp.toLowerCase() !== 'desconocido') {
      return descFromErp
    }
    return afipCodes.comprobantes?.[code]?.description || (descFromErp || 'Desconocido')
  }

  const generateNumerationMethod = (tipoComprobante, letra, puntoVenta, numeroInicio) => {
    // Determinar prefijo FE/FM
    const isElectronic = talonarioFormData.factura_electronica
    const prefix = isElectronic ? 'FE' : 'FM'

    // Determine tipo corto directly from the shared mapping
    const tipoCorto = mapAfipToDocType(tipoComprobante) || 'DOC'

    // Formatear punto de venta (5 dígitos) y número (8 dígitos)
    const puntoVentaFormatted = puntoVenta ? puntoVenta.toString().padStart(5, '0') : '00000'
    const numeroFormatted = numeroInicio ? numeroInicio.toString().padStart(8, '0') : '00000000'

    // Generar método: FE/FM + TIPO + LETRA + PUNTO_VENTA + NUMERO
    return `${prefix}${tipoCorto}${letra}${puntoVentaFormatted}${numeroFormatted}`
  }

  const currentDocstatus = selectedTalonario?.docstatus ?? talonarioFormData.docstatus ?? 0
  const docstatusBadge = getDocstatusBadge(currentDocstatus)

  // Función para guardar talonario
  const handleSaveTalonario = async () => {
    if (!activeCompanyFromContext) return

    // Validar campos obligatorios
    if (!talonarioFormData.descripcion.trim()) {
      showNotification('La descripción del talonario es obligatoria', 'error')
      return
    }
    if (!talonarioFormData.punto_de_venta.trim()) {
      showNotification('El punto de venta es obligatorio', 'error')
      return
    }
    if (!talonarioFormData.numero_de_inicio.trim()) {
      showNotification('El número de inicio es obligatorio', 'error')
      return
    }
    if (!talonarioFormData.numero_de_fin.trim()) {
      showNotification('El número de fin es obligatorio', 'error')
      return
    }

    try {
      const method = isCreatingTalonario ? 'POST' : 'PUT'
      const url = isCreatingTalonario
        ? '/api/resource/Talonario'
        : `/api/resource/Talonario/${selectedTalonario.name}`

      // Para creación, no enviar 'name' ya que se genera automáticamente
      const { name, docstatus, ...dataWithoutMeta } = talonarioFormData
      
      // Aplicar padding con ceros a punto_de_venta y numero_de_fin
      const paddedData = {
        ...dataWithoutMeta,
        punto_de_venta: talonarioFormData.punto_de_venta ? talonarioFormData.punto_de_venta.toString().padStart(5, '0') : '',
        numero_de_fin: talonarioFormData.numero_de_fin ? talonarioFormData.numero_de_fin.toString().padStart(8, '0') : '',
        numero_de_inicio: talonarioFormData.numero_de_inicio ? talonarioFormData.numero_de_inicio.toString().padStart(8, '0') : ''
      }
      // Generar métodos de numeración dinámicos basados en los tipos de comprobante
      const numerationMethods = {}

      const effectiveLetters = talonarioFormData.tipo_de_talonario === 'TALONARIOS DE RESGUARDO'
        ? sanitizeResguardoLetters(talonarioFormData.letras)
        : talonarioFormData.letras

      // Para cada tipo de comprobante AFIP configurado, generar método de numeración
      if (talonarioFormData.tipo_de_comprobante_afip && talonarioFormData.tipo_de_comprobante_afip.length > 0) {
        talonarioFormData.tipo_de_comprobante_afip.forEach(tc => {
          const tipoComprobante = tc.tipo_comprobante
          // Para cada letra configurada, generar método
          if (effectiveLetters && effectiveLetters.length > 0) {
            effectiveLetters.forEach(letraItem => {
              const letra = letraItem.letra
              const method = generateNumerationMethod(
                tipoComprobante,
                letra,
                talonarioFormData.punto_de_venta,
                talonarioFormData.numero_de_inicio
              )

              // Asignar al campo correspondiente según el tipo de comprobante
              if (getCodesByTipo('FAC').includes(tipoComprobante)) {
                // Facturas
                numerationMethods.metodo_numeracion_factura_venta = method
              } else if (getCodesByTipo('NCC').includes(tipoComprobante)) {
                // Notas de Crédito
                numerationMethods.metodo_numeracion_nota_credito = method
              } else if (getCodesByTipo('NDB').includes(tipoComprobante)) {
                // Notas de Débito
                numerationMethods.metodo_numeracion_nota_debito = method
              } else if (getCodesByTipo('REC').includes(tipoComprobante)) {
                // Recibos
                numerationMethods.tipo_comprobante_recibo = method
              } else if (getCodesByTipo('ORD').includes(tipoComprobante)) {
                // Órdenes de Pago
                numerationMethods.tipo_comprobante_orden_pago = method
              } else if (getCodesByTipo('REM').includes(tipoComprobante)) {
                // Remitos
                numerationMethods.tipo_comprobante_remito = method
              } else if (getCodesByTipo('INF').includes(tipoComprobante) || getCodesByTipo('TIQ').includes(tipoComprobante)) {
                // Informes/Tiques
                numerationMethods.tipo_comprobante_factura_electronica = method
              }
            })
          }
        })
      }
      
      // Convertir letras y tipo_de_comprobante_afip a formato de tabla hija correcto
      const processedData = {
        ...(isCreatingTalonario ? paddedData : { ...talonarioFormData, ...paddedData }),
        compania: activeCompanyFromContext,
        // Incluir métodos de numeración generados dinámicamente
        ...numerationMethods,
        letras: effectiveLetters.map(letraItem => ({
          ...(letraItem.name && { name: letraItem.name }), // Incluir name si existe
          letra: letraItem.letra,
          doctype: 'Talonario Letra'
        })),
        // Cachear letras en formato JSON para consultas rápidas (letras_json)
        letras_json: JSON.stringify((effectiveLetters || []).map(l => (l.letra || '').toString().trim().toUpperCase()).filter(Boolean)),
        // Incluir tipo_de_comprobante_afip siempre como array (con "999" si no hay elementos)
        // tipo_de_comprobante_afip: include both codigo_afip and tipo_documento (ERPNext expects Tipo Documento)
        // tipo_de_comprobante_afip: include codigo_afip and optionally tipo_documento for electronic talonarios
        tipo_de_comprobante_afip: talonarioFormData.tipo_de_comprobante_afip.length > 0 
          ? talonarioFormData.tipo_de_comprobante_afip.map(tc => {
              const item = {
                ...(tc.name && { name: tc.name }),
                codigo_afip: tc.tipo_comprobante,
                doctype: 'Talonario Comprobante'
              }

              // Determine if this talonario is an "electronic" talonario (FACTURA ELECTRONICA, REMITOS ELECTRONICOS, etc)
              const talonarioType = (talonarioFormData.tipo_de_talonario || '').toString().toUpperCase()
              const isElectronic = !!talonarioFormData.factura_electronica || talonarioType.includes('ELECTRONIC') || talonarioType.includes('ELECTR')

              // Only include tipo_documento when ERPNext expects it for electronic talonarios;
              // for plain (non-electronicos) remitos there is no tipo_documento and we should omit it.
              if (isElectronic) {
                const mapped = mapAfipToDocType(tc.tipo_comprobante)
                if (mapped) item.tipo_documento = mapped
              }

              return item
            })
          : [{ codigo_afip: '999', doctype: 'Talonario Comprobante' }]
      }
      
      // Remove any UI-only fields that must not be sent to ERPNext (possibleLetters is redundant)
      if (processedData.hasOwnProperty('possibleLetters')) {
        delete processedData.possibleLetters
      }

      const dataToSend = {
        data: processedData
      }

      const response = await fetchWithAuth(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend)
      })

      console.log('Respuesta del guardado:', response.status, response.statusText, response.ok)
      console.log('URL:', url)
      console.log('Método:', method)
      console.log('Datos enviados:', dataToSend)

      if (response.ok) {
        const result = await response.json()
        console.log('Resultado exitoso:', result)
        showNotification(
          isCreatingTalonario ? 'Talonario creado correctamente' : 'Talonario actualizado correctamente',
          'success'
        )
        onSave && onSave(result.data)
        onClose()
      } else {
        let errorMessage = `Error ${response.status}: ${response.statusText}`
        try {
          const errorData = await response.json()
          console.log('Datos de error:', errorData)
          errorMessage = errorData.message || errorData.error || errorMessage
        } catch (e) {
          console.log('No se pudo parsear error como JSON:', e)
          try {
            const textError = await response.text()
            console.log('Error como texto:', textError)
            errorMessage = textError || errorMessage
          } catch (e2) {
            console.log('Tampoco se pudo obtener como texto:', e2)
          }
        }
        showNotification(`Error al ${isCreatingTalonario ? 'crear' : 'actualizar'} talonario: ${errorMessage}`, 'error')
      }
    } catch (error) {
      console.error('Error saving talonario:', error)
      showNotification('Error al guardar los cambios', 'error')
    }
  }

  const handleDisableTalonario = async () => {
    if (!selectedTalonario?.name || isProcessingDisable) return
    const confirmed = window.confirm('El talonario se cancelará y no podrá utilizarse para emitir documentos. ¿Desea continuar?')
    if (!confirmed) return

    try {
      setIsProcessingDisable(true)
      const response = await fetchWithAuth(`/api/talonarios/${selectedTalonario.name}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ docstatus: 2 })
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.success === false) {
        showNotification(payload.message || 'No se pudo deshabilitar el talonario', 'error')
        return
      }

      showNotification(payload.message || 'Talonario deshabilitado correctamente', 'success')
      if (onSave) {
        onSave()
      }
      onClose()
    } catch (error) {
      console.error('Error disabling talonario:', error)
      showNotification('Error de conexión al deshabilitar el talonario', 'error')
    } finally {
      setIsProcessingDisable(false)
    }
  }

  // Función para cerrar modal
  const handleCloseModal = () => {
    setTalonarioFormData({
      name: '',
      descripcion: '',
      punto_de_venta: '',
      letras: [], // Cambiado de 'letra' a 'letras'
      tipo_de_talonario: availableTalonarioTypes.electronic_types?.[0] || 'FACTURA ELECTRONICA',
      tipo_de_comprobante_afip: [],
      numero_de_inicio: '',
      numero_de_fin: '',
      tipo_numeracion: 'Automática', // Reset a automática para electrónicos
      por_defecto: false,
      factura_electronica: true,
      metodo_numeracion_factura_venta: '',
      metodo_numeracion_nota_debito: '',
      metodo_numeracion_nota_credito: '',
      tipo_comprobante_orden_pago: '',
      tipo_comprobante_recibo: '',
      tipo_comprobante_remito: '',
      tipo_comprobante_factura_electronica: '',
      possibleLetters: ''
    })
    setSelectedTalonario(null)
    setUltimosNumeros([]) // Limpiar últimos números
    setLoadingUltimosNumeros(false)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCloseModal}
      title={isCreatingTalonario ? 'Crear Nuevo Talonario' : 'Editar Talonario'}
      size="default"
    >
      <div className="space-y-6">
        {!isCreatingTalonario && (
          <div className="flex justify-end">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${docstatusBadge.classes}`}>
              {docstatusBadge.label}
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Datos básicos */}
          <div className="space-y-4">
            <h5 className="text-md font-medium text-gray-900">Datos Talonario</h5>
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={talonarioFormData.factura_electronica}
                onChange={(e) => {
                  const isElectronic = e.target.checked
                  handleTalonarioFormChange('factura_electronica', isElectronic)
                  // Reset tipo_de_talonario cuando cambia el checkbox
                  if (isElectronic) {
                    // Si se marca como electrónico, seleccionar FACTURA ELECTRONICA
                    handleTalonarioFormChange('tipo_de_talonario', 'FACTURA ELECTRONICA')
                    handleTalonarioFormChange('tipo_numeracion', 'Automática') // Forzar automática para electrónicos
                  } else {
                    // Si se desmarca, seleccionar automáticamente la primera opción física disponible y limpiar letras/comprobantes
                    const firstPhysicalType = availableTalonarioTypes.physical_types?.[0] || 'REMITOS'
                    handleTalonarioFormChange('tipo_de_talonario', firstPhysicalType)
                    handleTalonarioFormChange('tipo_numeracion', '') // Permitir selección manual para físicos
                    // Limpiar letras y tipos de comprobante para físicos
                    setTalonarioFormData(prev => ({
                      ...prev,
                      letras: [],
                      tipo_de_comprobante_afip: []
                    }))
                  }
                }}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              <span className="ml-2 block text-sm text-gray-900">Talonario electronico</span>
            </label>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Descripción Talonario</label>
              <input
                type="text"
                value={talonarioFormData.descripcion}
                onChange={(e) => handleTalonarioFormChange('descripcion', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Número de Inicio</label>
              <input
                type="number"
                value={talonarioFormData.numero_de_inicio}
                onChange={(e) => {
                  const value = e.target.value
                  // Limitar a 8 dígitos máximo
                  if (value.length <= 8) {
                    handleTalonarioFormChange('numero_de_inicio', value)
                  }
                }}
                max="99999999"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Número de Fin</label>
              <input
                type="number"
                value={talonarioFormData.numero_de_fin}
                onChange={(e) => {
                  const value = e.target.value
                  // Limitar a 8 dígitos máximo
                  if (value.length <= 8) {
                    handleTalonarioFormChange('numero_de_fin', value)
                  }
                }}
                max="99999999"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Tipo de Numeración</label>
              <select
                value={talonarioFormData.tipo_numeracion}
                onChange={(e) => handleTalonarioFormChange('tipo_numeracion', e.target.value)}
                disabled={talonarioFormData.factura_electronica}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${talonarioFormData.factura_electronica ? 'bg-gray-100 cursor-not-allowed' : ''}`}
              >
                <option value="">Seleccionar...</option>
                <option value="Automática">Automática</option>
                <option value="Manual">Manual</option>
              </select>
              {talonarioFormData.factura_electronica && (
                <p className="text-xs text-gray-500 mt-1">Los talonarios electrónicos siempre usan numeración automática</p>
              )}
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={talonarioFormData.por_defecto}
                onChange={(e) => handleTalonarioFormChange('por_defecto', e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              <label className="ml-2 block text-sm text-gray-900">Talonario por defecto</label>
            </div>
          </div>

          {/* Asociación y configuración */}
          <div className="space-y-4">
            <h5 className="text-md font-medium text-gray-900">Asociar a Punto de Venta</h5>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Tipo de Talonario</label>
              <select
                value={talonarioFormData.tipo_de_talonario}
                onChange={(e) => handleTalonarioFormChange('tipo_de_talonario', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">
                  {talonarioFormData.factura_electronica ? 'Seleccionar tipo electrónico...' : 'Seleccionar tipo físico...'}
                </option>
                {talonarioFormData.factura_electronica ? (
                  // Opciones electrónicas
                  availableTalonarioTypes.electronic_types?.map((tipo) => (
                    <option key={tipo} value={tipo}>{tipo}</option>
                  ))
                ) : (
                  // Opciones físicas
                  availableTalonarioTypes.physical_types?.map((tipo) => (
                    <option key={tipo} value={tipo}>{tipo}</option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Punto de Venta</label>
              <input
                type="text"
                value={talonarioFormData.punto_de_venta}
                onChange={(e) => handleTalonarioFormChange('punto_de_venta', e.target.value)}
                title="Número de punto de venta asignado por AFIP (ej: 0001)"
                maxLength="5"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Letras</label>
              {talonarioFormData.factura_electronica ? (
                // Talonarios electrónicos: mostrar automáticamente sin modificar
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {talonarioFormData.letras.map((letraItem, index) => (
                      <span key={index} className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                        {letraItem.letra}
                      </span>
                    ))}
                  </div>
                  {talonarioFormData.letras.length === 0 && (
                    <p className="text-xs text-gray-500">No hay letras disponibles para esta configuración. Verifique la condición IVA de la compañía.</p>
                  )}
                  {talonarioFormData.letras.length > 0 && (
                    <p className="text-xs text-gray-500">Las letras se determinan automáticamente según el tipo de talonario y condición IVA</p>
                  )}
                </div>
              ) : talonarioFormData.tipo_de_talonario === 'TALONARIOS DE RESGUARDO' ? (
                // Talonarios de resguardo: la letra se deriva del Tipo de Comprobante AFIP seleccionado
                (() => {
                  const selectedTipo = talonarioFormData.tipo_de_comprobante_afip?.[0]?.tipo_comprobante || ''
                  const selectedInfo = filteredComprobanteTypes.find(t => t.codigo_afip === selectedTipo)
                  const mapped = selectedTipo ? afipCodes.comprobantes?.[String(selectedTipo).padStart(3, '0')] : null
                  const derivedLetter = mapped?.letra || (selectedInfo?.descripcion && (selectedInfo.descripcion.match(/\b([A-Z])\b/) || [])[1])

                  return (
                    <div className="space-y-2">
                      {derivedLetter ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">{derivedLetter}</span>
                          <span className="text-sm text-gray-700">Letra derivada del tipo: {selectedInfo ? `${selectedInfo.codigo_afip} - ${selectedInfo.descripcion}` : selectedTipo}</span>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">Seleccione un Tipo de Comprobante AFIP para asignar la letra</div>
                      )}
                      <p className="text-xs text-gray-500 mt-1">Los talonarios de resguardo derivan la letra desde el comprobante AFIP seleccionado</p>
                    </div>
                  )
                })()
              ) : (
                // Talonarios físicos: mostrar según cantidad de opciones disponibles
                (() => {
                  const possibleLettersArray = talonarioFormData.possibleLetters.split(', ').filter(l => l.trim())
                  const hasSingleLetter = possibleLettersArray.length === 1
                  const hasSingleComprobante = filteredComprobanteTypes.length === 1
                  
                  return (
                    <div className="space-y-2">
                      {/* Lista de letras seleccionadas */}
                      <div className="flex flex-wrap gap-2">
                        {talonarioFormData.letras.map((letraItem, index) => (
                          <span key={index} className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                            {letraItem.letra}
                            {!hasSingleLetter && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTalonarioFormData(prev => ({
                                    ...prev,
                                    letras: prev.letras.filter((_, i) => i !== index)
                                  }))
                                }}
                                className="ml-1 text-blue-600 hover:text-blue-800"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      {/* Selector para agregar nuevas letras (solo si hay múltiples opciones) */}
                      {!hasSingleLetter && (
                        <select
                          onChange={(e) => {
                            if (e.target.value && !talonarioFormData.letras.some(l => l.letra === e.target.value)) {
                              setTalonarioFormData(prev => ({
                                ...prev,
                                letras: [...prev.letras, { letra: e.target.value, doctype: 'Talonario Letra' }]
                              }))
                              e.target.value = '' // Reset select
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="">Seleccionar letra...</option>
                          {possibleLettersArray.map((letra, index) => (
                            <option key={index} value={letra}>{letra}</option>
                          ))}
                        </select>
                      )}
                      {!hasSingleLetter && (
                        <p className="text-xs text-gray-500 mt-1">Selecciona las letras correspondientes para este talonario</p>
                      )}
                    </div>
                  )
                })()
              )}
            </div>

            {/* Últimos Números Utilizados - Solo mostrar en modo edición */}
            {!isCreatingTalonario && selectedTalonario && (
              <div>
                <label className="block text-sm font-black text-gray-700 mb-2">
                  Últimos Números Utilizados
                </label>
                {loadingUltimosNumeros ? (
                  <div className="text-sm text-gray-500 italic">Cargando últimos números...</div>
                ) : ultimosNumeros.length > 0 ? (
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <div className="text-xs text-gray-600 font-medium mb-2">
                      Punto de Venta: {selectedTalonario.punto_de_venta}
                    </div>
                    <div className="grid gap-2">
                      {ultimosNumeros.map((numero, index) => (
                        <div key={index} className="flex justify-between items-center bg-white rounded px-3 py-2 border border-gray-200">
                          <div className="text-sm">
                            <span className="font-medium text-gray-900">
                              {numero.tipo_documento} {numero.letra}
                            </span>
                            {numero.metodo_numeracion && (
                              <span className="ml-2 text-xs text-gray-500">
                                ({numero.metodo_numeracion})
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-gray-900">
                              Último: {numero.ultimo_numero_utilizado.toLocaleString('es-AR', {minimumIntegerDigits: 8, useGrouping: false})}
                            </div>
                            <div className="text-xs text-blue-600">
                              Siguiente: {numero.siguiente_numero.toLocaleString('es-AR', {minimumIntegerDigits: 8, useGrouping: false})}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      Estos números se actualizan automáticamente con cada factura emitida
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-500 italic">
                    No hay secuencias de numeración configuradas para este talonario
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Tipos de Comprobante AFIP</label>
              {talonarioFormData.tipo_de_talonario === 'ORDENES DE COMPRA' || talonarioFormData.tipo_de_talonario === 'RECIBOS' ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 italic">
                    {talonarioFormData.tipo_de_talonario === 'ORDENES DE COMPRA' 
                      ? 'Las órdenes de compra no tienen relación con tipos de comprobantes AFIP.'
                      : 'Los recibos no tienen relación con tipos de comprobantes AFIP.'
                    }
                  </p>
                </div>
              ) : talonarioFormData.factura_electronica ? (
                // Talonarios electrónicos: mostrar automáticamente sin modificar
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {filteredComprobanteTypes.map((type) => (
                      <span key={type.name} className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
                        {type.codigo_afip} - {getComprobanteDescription(type.codigo_afip, type.descripcion)}
                      </span>
                    ))}
                  </div>
                  {filteredComprobanteTypes.length === 0 && (
                    <p className="text-xs text-gray-500">No hay tipos de comprobante disponibles para esta configuración. Verifique la condición IVA de la compañía.</p>
                  )}
                  {filteredComprobanteTypes.length > 0 && (
                    <p className="text-xs text-gray-500">Los tipos de comprobante se determinan automáticamente según el tipo de talonario y condición IVA</p>
                  )}
                </div>
              ) : talonarioFormData.tipo_de_talonario === 'TALONARIOS DE RESGUARDO' ? (
                // Talonarios de resguardo: mostrar mensaje especial si letra X, select si múltiples opciones, badge si una sola
                (() => {
                  const selectedLetter = talonarioFormData.letras[0]?.letra
                  const isLetterX = selectedLetter === 'X'
                  
                  if (isLetterX) {
                    // Para letra X, mostrar mensaje especial
                    return (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-500 italic">
                          Los Talonarios de resguardo con letra X no tienen relación con tipos de comprobantes AFIP.
                        </p>
                      </div>
                    )
                  }
                  
                  const hasMultipleOptions = filteredComprobanteTypes.length > 1
                  
                  return (
                    <div className="space-y-2">
                      {hasMultipleOptions ? (
                        <select
                          value={talonarioFormData.tipo_de_comprobante_afip[0]?.tipo_comprobante || ''}
                          onChange={(e) => {
                            const newCode = e.target.value
                            if (newCode) {
                              const codeKey = String(newCode).padStart(3, '0')
                              const mapped = afipCodes.comprobantes?.[codeKey]
                              const derivedLetter = mapped?.letra || null
                              setTalonarioFormData(prev => ({
                                ...prev,
                                tipo_de_comprobante_afip: [{ tipo_comprobante: newCode, doctype: 'Talonario Comprobante' }],
                                letras: derivedLetter ? [{ letra: derivedLetter, doctype: 'Talonario Letra' }] : []
                              }))
                            } else {
                              setTalonarioFormData(prev => ({
                                ...prev,
                                tipo_de_comprobante_afip: [],
                                letras: []
                              }))
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          {filteredComprobanteTypes.length > 1 && <option value="">Seleccionar tipo de comprobante...</option>}
                          {filteredComprobanteTypes.map((type) => (
                            <option key={type.name} value={type.codigo_afip}>
                                {type.codigo_afip} - {getComprobanteDescription(type.codigo_afip, type.descripcion)}
                              </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {talonarioFormData.tipo_de_comprobante_afip.map((tc, index) => {
                            const typeInfo = filteredComprobanteTypes.find(t => t.codigo_afip === tc.tipo_comprobante)
                            return (
                              <span key={index} className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                                {tc.tipo_comprobante} - {getComprobanteDescription(typeInfo?.codigo_afip || tc.tipo_comprobante, typeInfo?.descripcion)}
                              </span>
                            )
                          })}
                        </div>
                      )}
                      <p className="text-xs text-gray-500 mt-1">Los talonarios de resguardo solo permiten un tipo de comprobante AFIP</p>
                    </div>
                  )
                })()
              ) : (
                // Talonarios físicos: mostrar según cantidad de opciones disponibles
                (() => {
                  const hasSingleComprobante = filteredComprobanteTypes.length === 1
                  
                  return (
                    <div className="space-y-2">
                      {/* Lista de tipos seleccionados */}
                      <div className="flex flex-wrap gap-2">
                        {talonarioFormData.tipo_de_comprobante_afip.map((tc, index) => {
                          const typeInfo = filteredComprobanteTypes.find(t => t.codigo_afip === tc.tipo_comprobante)
                          return (
                            <span key={index} className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                              {tc.tipo_comprobante} - {getComprobanteDescription(typeInfo?.codigo_afip || tc.tipo_comprobante, typeInfo?.descripcion)}
                              {!hasSingleComprobante && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveComprobanteType(tc.tipo_comprobante)}
                                  className="ml-1 text-blue-600 hover:text-blue-800"
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          )
                        })}
                      </div>
                      {/* Selector para agregar nuevos tipos (solo si hay múltiples opciones) */}
                      {!hasSingleComprobante && (
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAddComprobanteType(e.target.value)
                              e.target.value = '' // Reset select
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          {filteredComprobanteTypes.length > 1 && <option value="">Seleccionar tipo de comprobante...</option>}
                          {filteredComprobanteTypes.map((type) => (
                            <option key={type.name} value={type.codigo_afip}>
                              {type.codigo_afip} - {getComprobanteDescription(type.codigo_afip, type.descripcion)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )
                })()
              )}
            </div>
          </div>
        </div>

        {/* Botones */}
        <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
          {!isCreatingTalonario && currentDocstatus < 2 && (
            <button
              onClick={handleDisableTalonario}
              disabled={isProcessingDisable}
              className="px-6 py-3 border border-red-200 text-red-700 font-bold rounded-2xl hover:bg-red-50 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isProcessingDisable ? 'Deshabilitando...' : 'Deshabilitar'}
            </button>
          )}
          <button
            onClick={handleCloseModal}
            className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveTalonario}
            className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
          >
            <Save className="w-4 h-4 mr-2" />
            {isCreatingTalonario ? 'Crear' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default TalonarioModal
