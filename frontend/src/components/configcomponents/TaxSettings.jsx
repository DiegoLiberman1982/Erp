import React, { useState, useContext, useEffect, useMemo, useCallback } from 'react'
import { FileText, Edit, Save, X, ChevronDown, ChevronRight, MapPin, Building2, Settings2 } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import useTaxTemplates from '../../hooks/useTaxTemplates'
import API_ROUTES from '../../apiRoutes'
import Modal from '../Modal'

// Helper para remover la abreviatura de empresa del nombre de cuenta
// Ejemplo: "1.1.4.01.04.24 - Percepciones IIBB - CABA - ANC" -> "1.1.4.01.04.24 - Percepciones IIBB - CABA"
const removeCompanyAbbr = (accountName, companyAbbr) => {
  if (!accountName || !companyAbbr) return accountName
  const suffix = ` - ${companyAbbr}`
  if (accountName.endsWith(suffix)) {
    return accountName.slice(0, -suffix.length)
  }
  return accountName
}

// Mapa de códigos de provincia a nombres
const PROVINCE_NAMES = {
  '901': 'CABA',
  '902': 'Buenos Aires',
  '903': 'Catamarca',
  '904': 'Córdoba',
  '905': 'Corrientes',
  '906': 'Chaco',
  '907': 'Chubut',
  '908': 'Entre Ríos',
  '909': 'Formosa',
  '910': 'Jujuy',
  '911': 'La Pampa',
  '912': 'La Rioja',
  '913': 'Mendoza',
  '914': 'Misiones',
  '915': 'Neuquén',
  '916': 'Río Negro',
  '917': 'Salta',
  '918': 'San Juan',
  '919': 'San Luis',
  '920': 'Santa Cruz',
  '921': 'Santa Fe',
  '922': 'Santiago del Estero',
  '923': 'Tierra del Fuego',
  '924': 'Tucumán'
}

const TaxSettings = ({ onEditTemplate }) => {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editedData, setEditedData] = useState({})
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const [fiscalYearData, setFiscalYearData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ivaAccounts, setIvaAccounts] = useState({ debitoFiscal: null, creditoFiscal: null })
  const [taxTemplates, setTaxTemplates] = useState([])
  const [showAccountDropdown, setShowAccountDropdown] = useState({})
  const [accountSearchResults, setAccountSearchResults] = useState({})
  const [editingAccount, setEditingAccount] = useState(null)

  // Tax Account Map state
  const [taxAccountMaps, setTaxAccountMaps] = useState([])
  const [showTaxAccountModal, setShowTaxAccountModal] = useState(false)
  const [taxAccountModalType, setTaxAccountModalType] = useState(null) // 'PERCEPCION_IIBB', 'RETENCION_IIBB', 'PERCEPCION_IVA', 'RETENCION_IVA', 'PERCEPCION_GANANCIAS', 'RETENCION_GANANCIAS'
  const [taxAccountModalTransaction, setTaxAccountModalTransaction] = useState(null) // 'purchase' o 'sale'
  const [editingTaxMap, setEditingTaxMap] = useState(null)
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [accountSearch, setAccountSearch] = useState('')
  const [savingTaxMap, setSavingTaxMap] = useState(false)

  // Collapsed sections for templates
  const [collapsedSections, setCollapsedSections] = useState({
    salesTemplates: true,
    purchaseTemplates: true
  })

  const { fetchWithAuth, activeCompany: activeCompanyFromContext } = useContext(AuthContext)
  const { showNotification } = useNotification()
  const { templates: taxTemplatesFromHook, sales: taxSales, purchase: taxPurchase, loading: taxTemplatesLoading, error: taxTemplatesError, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)

  // Filtrar cuentas disponibles excluyendo las que ya están asignadas a otros mappings
  const filteredAvailableAccounts = useMemo(() => {
    if (!availableAccounts || availableAccounts.length === 0) return []
    
    // Obtener todas las cuentas ya asignadas en otros mappings (excepto el que estamos editando)
    const assignedAccounts = new Set(
      taxAccountMaps
        .filter(m => m.account && m.name !== editingTaxMap)
        .map(m => m.account)
    )
    
    // También incluir la cuenta actual del mapping que estamos editando (si existe)
    const currentMap = taxAccountMaps.find(m => m.name === editingTaxMap)
    const currentAccount = currentMap?.account
    
    return availableAccounts.filter(a => 
      !assignedAccounts.has(a.name) || a.name === currentAccount
    )
  }, [availableAccounts, taxAccountMaps, editingTaxMap])

  useEffect(() => {
    if (taxTemplatesFromHook && Array.isArray(taxTemplatesFromHook)) {
      setTaxTemplates(taxTemplatesFromHook)
    }
  }, [taxTemplatesFromHook])

  // Cargar detalles de la empresa activa
  useEffect(() => {
    if (activeCompanyFromContext) {
      fetchCompanyDetails(activeCompanyFromContext)
      fetchIVAAccounts()
      fetchTaxTemplates()
      fetchTaxAccountMaps()
    }
  }, [activeCompanyFromContext])

  // Cargar fiscal year después de que se carguen los detalles de la empresa
  useEffect(() => {
    if (activeCompanyFromContext && !fiscalYearData) {
      fetchFiscalYearDetails()
    }
  }, [activeCompanyFromContext, fiscalYearData])

  // Función para obtener los datos detallados de la empresa
  const fetchCompanyDetails = async (companyName) => {
    try {
      setLoading(true)
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}`)
      if (response.ok) {
        const data = await response.json()

        setActiveCompanyDetails(data.data)
      } else {
        console.error('Error fetching company details:', response.status)
      }
    } catch (error) {
      console.error('Error fetching company details:', error)
    } finally {
      setLoading(false)
    }
  }

  // Función para cargar Tax Account Maps
  const fetchTaxAccountMaps = async () => {
    if (!activeCompanyFromContext) return
    try {
      const response = await fetchWithAuth(`${API_ROUTES.taxAccountMap}?company=${encodeURIComponent(activeCompanyFromContext)}`)
      if (response.ok) {
        const data = await response.json()
        setTaxAccountMaps(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching tax account maps:', error)
    }
  }

  // Función para cargar cuentas disponibles para el modal
  const fetchAvailableAccounts = async (rootType = 'Asset') => {
    if (!activeCompanyFromContext) return
    try {
      const endpoint = rootType === 'Liability' 
        ? API_ROUTES.taxAccountMapLiabilityAccounts 
        : API_ROUTES.taxAccountMapAccounts
      const response = await fetchWithAuth(`${endpoint}?company=${encodeURIComponent(activeCompanyFromContext)}&search=${encodeURIComponent(accountSearch)}`)
      if (response.ok) {
        const data = await response.json()
        setAvailableAccounts(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
  }

  // Función para cargar las cuentas de IVA desde las plantillas de Item Tax Templates
  const fetchIVAAccounts = async () => {
    try {
      let allTemplates = taxTemplatesFromHook || []
      if (!allTemplates || allTemplates.length === 0) {
        const loaded = await refreshTaxTemplates()
        allTemplates = (loaded && loaded.templates) || []
      }
      if (allTemplates && allTemplates.length > 0) {
        let debitoFiscal = null
        let creditoFiscal = null
        for (const template of allTemplates) {
          if (template.accounts && template.accounts.length > 0) {
            const taxType = template.accounts[0]
            const title = template.title || ''
            const cleanAccountName = extractCleanAccountName(taxType)
            if (title.includes('Ventas') && !debitoFiscal) {
              debitoFiscal = cleanAccountName
            } else if (title.includes('Compras') && !creditoFiscal) {
              creditoFiscal = cleanAccountName
            }
          }
        }
        setIvaAccounts({ debitoFiscal, creditoFiscal })
      }
    } catch (error) {
      console.error('Error fetching IVA accounts:', error)
    }
  }

  // Función para cargar las plantillas de Item Tax Templates
  const fetchTaxTemplates = async () => {
    try {
      const loaded = await refreshTaxTemplates()
      if (loaded && loaded.success) {
        setTaxTemplates(loaded.templates || [])
      } else {
        setTaxTemplates([])
      }
    } catch (error) {
      console.error('Error fetching tax templates:', error)
      setTaxTemplates([])
    }
  }

  // Función para extraer el nombre limpio del template (sin siglas de empresa)
  const extractCleanTemplateName = (templateName) => {
    // Remover " - XXX" del final donde XXX son siglas
    return templateName.replace(/\s*-\s*[A-Z]{2,}$/, '')
  }

  // Función para extraer el nombre limpio de la cuenta (sin códigos ni siglas)
  const extractCleanAccountName = (account) => {
    if (!account) return ''
    if (typeof account === 'string') {
      // Extraer el nombre del medio: formato "código - nombre - sufijo"
      const match = account.match(/^\d+(\.\d+)*\s*-\s*(.+?)\s*-\s*.+$/)
      if (match) {
        // Remover siglas de empresa del final si existen
        return match[2].trim().replace(/\s*-\s*[A-Z]{2,}$/, '')
      }
      return account.replace(/\s*-\s*[A-Z]{2,}$/, '')
    }
    // Si es un objeto, usar account_name y extraer solo el nombre
    const fullName = account.account_name || account.name || ''
    const match = fullName.match(/^\d+(\.\d+)*\s*-\s*(.+?)\s*-\s*.+$/)
    if (match) {
      return match[2].trim().replace(/\s*-\s*[A-Z]{2,}$/, '')
    }
    return fullName.replace(/\s*-\s*[A-Z]{2,}$/, '')
  }

  // Función para obtener los datos del Fiscal Year
  const fetchFiscalYearDetails = async () => {
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompanyFromContext)}/fiscal-year`)
      if (response.ok) {
        const data = await response.json()
        setFiscalYearData(data.data)
      } else {
        setFiscalYearData(null)
      }
    } catch (error) {
      console.error('Error fetching fiscal year details:', error)
      setFiscalYearData(null)
    }
  }

  // Función para calcular el mes de cierre desde el Fiscal Year
  const getMesCierreFromFiscalYear = () => {
    if (!fiscalYearData) return 'No disponible'

    const yearEndDate = fiscalYearData.year_end_date
    if (!yearEndDate) return 'No disponible'

    const month = yearEndDate.split('-')[1]
    const monthNames = {
      '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
      '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
      '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
    }

    return monthNames[month] || 'No disponible'
  }

  // Helper to extract a display name for accounts
  // Helper to extract a simplified display name for accounts
  const extractAccountName = (account) => {
    if (!account) return ''
    if (typeof account === 'string') {
      // Extraer el nombre del medio: formato "código - nombre - sufijo"
      const match = account.match(/^\d+(\.\d+)*\s*-\s*(.+?)\s*-\s*.+$/)
      return match ? match[2].trim() : account
    }
    // Si es un objeto, usar account_name y extraer solo el nombre
    const fullName = account.account_name || account.name || ''
    const match = fullName.match(/^\d+(\.\d+)*\s*-\s*(.+?)\s*-\s*.+$/)
    return match ? match[2].trim() : fullName
  }

  // Función para iniciar la edición
  const startEditing = () => {
    const initialData = {
      tax_id: activeCompanyDetails?.tax_id || activeCompanyDetails?.cuit || '',
      numeroIIBB: activeCompanyDetails?.custom_ingresos_brutos || '',
      cbu: activeCompanyDetails?.cbu || '',
      mesCierreContable: getMesCierreValueFromFiscalYear(),
      inscriptoConvenioMultilateral: activeCompanyDetails?.custom_convenio_multilateral || false,
      condicionIVA: activeCompanyDetails?.custom_condicion_iva || '',
      condicionIngresosBrutos: activeCompanyDetails?.custom_condicion_ingresos_brutos || '',
      jurisdiccionesIIBB: activeCompanyDetails?.custom_jurisdicciones_iibb || '',
      condicionGanancias: activeCompanyDetails?.custom_condicion_ganancias || '',
      percepcionesCompra: activeCompanyDetails?.custom_percepciones_compra || '',
      retencionesCompra: activeCompanyDetails?.custom_retenciones_compra || '',
      percepcionesVenta: activeCompanyDetails?.custom_percepciones_venta || '',
      retencionesVenta: activeCompanyDetails?.custom_retenciones_venta || '',
      debitoFiscal: ivaAccounts.debitoFiscal || activeCompanyDetails?.custom_debito_fiscal || '',
      creditoFiscal: ivaAccounts.creditoFiscal || activeCompanyDetails?.custom_credito_fiscal || ''
    }

    // Si es Monotributista, forzar condición de ganancias como Exento
    if (initialData.condicionIVA === 'Monotributista') {
      initialData.condicionGanancias = 'Exento'
    }

    setEditedData(initialData)
    setEditing(true)
  }

  // Función para manejar cambios en los campos fiscales
  const handleTaxFieldChange = (field, value) => {
    setEditedData(prev => {
      const newData = { ...prev, [field]: value }

      // Si cambia la condición IVA a Monotributista, la condición de ganancias debe ser Exento
      if (field === 'condicionIVA' && value === 'Monotributista') {
        newData.condicionGanancias = 'Exento'
      }

      return newData
    })
  }

  // Función para calcular el valor del mes de cierre desde el Fiscal Year
  const getMesCierreValueFromFiscalYear = () => {
    if (!fiscalYearData) return ''

    const yearEndDate = fiscalYearData.year_end_date
    if (!yearEndDate) return ''

    return yearEndDate.split('-')[1]
  }

  // Función para cancelar la edición
  const cancelEditing = () => {
    setEditing(false)
    setEditedData({})
    setEditingAccount(null) // Reset account editing state
  }

  // Función para guardar cambios
  const saveChanges = async () => {
    if (!activeCompanyFromContext) return

    try {
      setSaving(true)
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompanyFromContext)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: editedData
        })
      })

      if (response.ok) {
        const result = await response.json()
        setEditing(false)
        setEditedData({})
        setEditingAccount(null)
        setActiveCompanyDetails(result.data)
        setFiscalYearData(null)  // Reset fiscal year data to force reload
        showNotification('Datos impositivos actualizados correctamente', 'success')
      } else {
        const errorData = await response.json()
        showNotification(`Error al actualizar datos impositivos: ${errorData.message}`, 'error')
      }
    } catch (error) {
      console.error('Error saving tax data:', error)
      showNotification('Error al guardar los cambios', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Funciones para búsqueda predictiva de cuentas
  const searchAccounts = async (query, fieldName) => {
    if (!query || query.length < 2) {
      setAccountSearchResults(prev => ({ ...prev, [fieldName]: [] }))
      return
    }

    try {
      const response = await fetchWithAuth(`/api/accounts?search=${encodeURIComponent(query)}&limit=10`)
      if (response.ok) {
        const data = await response.json()
        setAccountSearchResults(prev => ({ ...prev, [fieldName]: data.data || [] }))
      }
    } catch (error) {
      console.error('Error searching accounts:', error)
    }
  }

  const selectAccount = (account, fieldName) => {
    // Guardar el nombre completo de la cuenta (account_name) para que ERPNext lo encuentre
    setEditedData(prev => ({ ...prev, [fieldName]: account.account_name || account.name }))
    setAccountSearchResults(prev => ({ ...prev, [fieldName]: [] }))
    setShowAccountDropdown(prev => ({ ...prev, [fieldName]: false }))
  }

  const handleAccountInputChange = (fieldName, value) => {
    setEditedData(prev => ({ ...prev, [fieldName]: value }))
    searchAccounts(value, fieldName)
  }

  const handleAccountFocus = (fieldName) => {
    setShowAccountDropdown(prev => ({ ...prev, [fieldName]: true }))
  }

  // Función para iniciar la edición de un template
  const startEditingTemplate = (template) => {
    setEditingTemplate({
      ...template,
      accounts: template.accounts || []
    })
  }

  // Función para cancelar la edición de template
  const cancelEditingTemplate = () => {
    setEditingTemplate(null)
  }

  // Función para guardar cambios en template
  const saveTemplateChanges = async () => {
    if (!editingTemplate) return

    try {
      setSaving(true)
        const response = await fetchWithAuth(`${API_ROUTES.taxTemplates}/${encodeURIComponent(editingTemplate.name)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            accounts: editingTemplate.accounts
          })
        })

      if (response.ok) {
        const result = await response.json()
        // Actualizar la lista de templates
        await fetchTaxTemplates()
        // Actualizar las cuentas de IVA
        await fetchIVAAccounts()
        setEditingTemplate(null)
        showNotification('Plantilla de impuesto actualizada correctamente', 'success')
      } else {
        const errorData = await response.json()
        showNotification(`Error al actualizar plantilla: ${errorData.message}`, 'error')
      }
    } catch (error) {
      console.error('Error saving template:', error)
      showNotification('Error al guardar los cambios en la plantilla', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Función para actualizar la cuenta de un impuesto en el template
  const updateTemplateTaxAccount = (accountIndex, accountName) => {
    setEditingTemplate(prev => ({
      ...prev,
      accounts: prev.accounts.map((account, index) =>
        index === accountIndex ? accountName : account
      )
    }))
  }

  // Función para buscar cuentas para templates
  const searchAccountsForTemplate = async (query, templateName) => {
    if (!query || query.length < 2) {
      setTemplateSearchResults(prev => ({ ...prev, [templateName]: [] }))
      return
    }

    try {
      const response = await fetchWithAuth(`/api/accounts?search=${encodeURIComponent(query)}&limit=10`)
      if (response.ok) {
        const data = await response.json()
        setTemplateSearchResults(prev => ({ ...prev, [templateName]: data.data || [] }))
      }
    } catch (error) {
      console.error('Error searching accounts for template:', error)
    }
  }

  const selectAccountForTemplate = (account, templateName) => {
    // Guardar el nombre completo de la cuenta
    setEditingTemplate(prev => ({
      ...prev,
      taxes: prev.taxes.map((tax, index) => ({
        ...tax,
        account_head: account.account_name || account.name,
        tax_type: account.account_name || account.name
      }))
    }))
    setTemplateSearchResults(prev => ({ ...prev, [templateName]: [] }))
  }

  // Abrir modal de Tax Account Map
  const openTaxAccountModal = (perceptionType, transactionType) => {
    setTaxAccountModalType(perceptionType)
    setTaxAccountModalTransaction(transactionType)
    setAccountSearch('')
    setEditingTaxMap(null)
    // Cargar cuentas según el tipo de transacción
    // Percepciones de compra -> Activo (crédito fiscal)
    // Percepciones de venta -> Pasivo (débito fiscal)
    const rootType = transactionType === 'sale' ? 'Liability' : 'Asset'
    fetchAvailableAccounts(rootType)
    // Recargar tax account maps por si hay cambios
    fetchTaxAccountMaps()
    setShowTaxAccountModal(true)
  }

  // Guardar cambio de cuenta en Tax Account Map
  const saveTaxAccountChange = async (mapName, newAccount) => {
    try {
      setSavingTaxMap(true)
      const response = await fetchWithAuth(`${API_ROUTES.taxAccountMap}/${encodeURIComponent(mapName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: newAccount })
      })
      if (response.ok) {
        showNotification('Cuenta actualizada correctamente', 'success')
        await fetchTaxAccountMaps()
        setEditingTaxMap(null)
      } else {
        const errorData = await response.json()
        showNotification(`Error al actualizar: ${errorData.message}`, 'error')
      }
    } catch (error) {
      console.error('Error saving tax account:', error)
      showNotification('Error al guardar', 'error')
    } finally {
      setSavingTaxMap(false)
    }
  }

  // Filtrar maps por tipo
  const getFilteredMaps = (perceptionType, transactionType) => {
    return taxAccountMaps.filter(m => 
      m.perception_type === perceptionType && 
      m.transaction_type === transactionType
    ).sort((a, b) => (a.province_code || '').localeCompare(b.province_code || ''))
  }

  // Toggle section collapse
  const toggleSection = (section) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  // Generar título para el modal de Tax Account Map
  const getTaxAccountModalTitle = () => {
    const typeLabels = {
      'PERCEPCION_IIBB': 'Percepciones IIBB',
      'RETENCION_IIBB': 'Retenciones IIBB',
      'PERCEPCION_IVA': 'Percepciones IVA',
      'RETENCION_IVA': 'Retenciones IVA',
      'PERCEPCION_GANANCIAS': 'Percepciones Ganancias',
      'RETENCION_GANANCIAS': 'Retenciones Ganancias'
    }
    return typeLabels[taxAccountModalType] || taxAccountModalType
  }

  // Separar templates de ventas y compras
  const salesTemplates = useMemo(() => 
    taxTemplates.filter(t => t.title?.includes('Ventas')), 
    [taxTemplates]
  )
  const purchaseTemplates = useMemo(() => 
    taxTemplates.filter(t => t.title?.includes('Compras')), 
    [taxTemplates]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        <span className="ml-3 text-gray-600">Cargando datos impositivos...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Datos Impositivos</h2>
          <p className="text-gray-600 font-medium">Información fiscal y tributaria de la empresa</p>
        </div>
      </div>

      {activeCompanyFromContext ? (
        <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
          {editing ? (
            <div className="space-y-6">
              {/* Formulario de edición */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">CUIT</label>
                  <input
                    type="text"
                    value={editedData.tax_id || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, tax_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Ej: 20-12345678-9"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Número IIBB</label>
                  <input
                    type="text"
                    value={editedData.numeroIIBB || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, numeroIIBB: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Ej: 123456789"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">CBU</label>
                  <input
                    type="text"
                    value={editedData.cbu || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, cbu: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Ej: 1234567890123456789012"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Mes de Cierre Contable</label>
                  <select
                    value={editedData.mesCierreContable || ''}
                    onChange={(e) => setEditedData(prev => ({ ...prev, mesCierreContable: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Seleccionar mes...</option>
                    <option value="01">Enero</option>
                    <option value="02">Febrero</option>
                    <option value="03">Marzo</option>
                    <option value="04">Abril</option>
                    <option value="05">Mayo</option>
                    <option value="06">Junio</option>
                    <option value="07">Julio</option>
                    <option value="08">Agosto</option>
                    <option value="09">Septiembre</option>
                    <option value="10">Octubre</option>
                    <option value="11">Noviembre</option>
                    <option value="12">Diciembre</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="flex items-center mt-4">
                    <input
                      type="checkbox"
                      checked={editedData.inscriptoConvenioMultilateral || false}
                      onChange={(e) => setEditedData(prev => ({ ...prev, inscriptoConvenioMultilateral: e.target.checked }))}
                      className="mr-2"
                    />
                    <span className="text-sm font-medium text-gray-700">Inscripto en Convenio Multilateral</span>
                  </label>
                </div>
              </div>

              {/* Condiciones Fiscales */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-black text-gray-900 mb-4">Condiciones Fiscales</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Condición frente al IVA</label>
                    <select
                      value={editedData.condicionIVA || ''}
                      onChange={(e) => handleTaxFieldChange('condicionIVA', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Seleccionar...</option>
                      <option value="Responsable Inscripto">Responsable Inscripto</option>
                      {activeCompanyDetails?.custom_personeria === 'Unipersonal' && (
                        <option value="Monotributista">Monotributista</option>
                      )}
                      <option value="Exento">Exento</option>
                    </select>
                    {activeCompanyDetails?.custom_personeria !== 'Unipersonal' && editedData.condicionIVA === 'Monotributista' && (
                      <p className="text-xs text-red-500 mt-1">La condición Monotributista solo está disponible para Unipersonal</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Condición Ingresos Brutos</label>
                    <select
                      value={editedData.condicionIngresosBrutos || ''}
                      onChange={(e) => setEditedData(prev => ({ ...prev, condicionIngresosBrutos: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Seleccionar...</option>
                      <option value="Inscripto">Inscripto</option>
                      <option value="Exento">Exento</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Jurisdicciones IIBB</label>
                    <textarea
                      value={editedData.jurisdiccionesIIBB || ''}
                      onChange={(e) => setEditedData(prev => ({ ...prev, jurisdiccionesIIBB: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ej: CABA, Buenos Aires, Córdoba (separadas por coma)"
                      rows="2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Condición Ganancias</label>
                    <select
                      value={editedData.condicionGanancias || ''}
                      onChange={(e) => setEditedData(prev => ({ ...prev, condicionGanancias: e.target.value }))}
                      disabled={editedData.condicionIVA === 'Monotributista'}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                        editedData.condicionIVA === 'Monotributista' ? 'bg-gray-100 cursor-not-allowed' : ''
                      }`}
                    >
                      <option value="">Seleccionar...</option>
                      <option value="Inscripto">Inscripto</option>
                      <option value="Exento">Exento</option>
                    </select>
                    {editedData.condicionIVA === 'Monotributista' && (
                      <p className="text-xs text-gray-500 mt-1">Los monotributistas son siempre exentos de ganancias</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Cuentas contables para IVA */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-black text-gray-900 mb-4">Cuentas Contables para IVA</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Percepciones de Compra */}
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Percepciones de Compra</label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Buscar cuenta..."
                        value={editedData.percepcionesCompra || ''}
                        onChange={(e) => handleAccountInputChange('percepcionesCompra', e.target.value)}
                        onFocus={() => handleAccountFocus('percepcionesCompra')}
                        onBlur={() => setTimeout(() => setShowAccountDropdown(prev => ({ ...prev, percepcionesCompra: false })), 200)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {showAccountDropdown['percepcionesCompra'] && accountSearchResults['percepcionesCompra']?.length > 0 && (
                        <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto mt-1">
                          {accountSearchResults['percepcionesCompra'].map((acc) => (
                            <div
                              key={acc.name}
                              onClick={() => setEditedData(prev => ({ ...prev, percepcionesCompra: acc.name }))}
                              className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                            >
                              <div className="font-medium">{extractAccountName(acc)}</div>
                              <div className="text-xs text-gray-500">{acc.name}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Retenciones de Compra */}
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Retenciones de Compra</label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Buscar cuenta..."
                        value={editedData.retencionesCompra || ''}
                        onChange={(e) => handleAccountInputChange('retencionesCompra', e.target.value)}
                        onFocus={() => handleAccountFocus('retencionesCompra')}
                        onBlur={() => setTimeout(() => setShowAccountDropdown(prev => ({ ...prev, retencionesCompra: false })), 200)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {showAccountDropdown['retencionesCompra'] && accountSearchResults['retencionesCompra']?.length > 0 && (
                        <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto mt-1">
                          {accountSearchResults['retencionesCompra'].map((acc) => (
                            <div
                              key={acc.name}
                              onClick={() => setEditedData(prev => ({ ...prev, retencionesCompra: acc.name }))}
                              className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                            >
                              <div className="font-medium">{extractAccountName(acc)}</div>
                              <div className="text-xs text-gray-500">{acc.name}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Percepciones de Venta */}
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Percepciones de Venta</label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Buscar cuenta..."
                        value={editedData.percepcionesVenta || ''}
                        onChange={(e) => handleAccountInputChange('percepcionesVenta', e.target.value)}
                        onFocus={() => handleAccountFocus('percepcionesVenta')}
                        onBlur={() => setTimeout(() => setShowAccountDropdown(prev => ({ ...prev, percepcionesVenta: false })), 200)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {showAccountDropdown['percepcionesVenta'] && accountSearchResults['percepcionesVenta']?.length > 0 && (
                        <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto mt-1">
                          {accountSearchResults['percepcionesVenta'].map((acc) => (
                            <div
                              key={acc.name}
                              onClick={() => setEditedData(prev => ({ ...prev, percepcionesVenta: acc.name }))}
                              className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                            >
                              <div className="font-medium">{extractAccountName(acc)}</div>
                              <div className="text-xs text-gray-500">{acc.name}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Retenciones de Venta */}
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Retenciones de Venta</label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Buscar cuenta..."
                        value={editedData.retencionesVenta || ''}
                        onChange={(e) => handleAccountInputChange('retencionesVenta', e.target.value)}
                        onFocus={() => handleAccountFocus('retencionesVenta')}
                        onBlur={() => setTimeout(() => setShowAccountDropdown(prev => ({ ...prev, retencionesVenta: false })), 200)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {showAccountDropdown['retencionesVenta'] && accountSearchResults['retencionesVenta']?.length > 0 && (
                        <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto mt-1">
                          {accountSearchResults['retencionesVenta'].map((acc) => (
                            <div
                              key={acc.name}
                              onClick={() => setEditedData(prev => ({ ...prev, retencionesVenta: acc.name }))}
                              className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                            >
                              <div className="font-medium">{extractAccountName(acc)}</div>
                              <div className="text-xs text-gray-500">{acc.name}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>

              {/* Botones de acción */}
              <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                <button
                  onClick={cancelEditing}
                  className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveChanges}
                  disabled={saving}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Guardar Cambios
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Vista de solo lectura */
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">CUIT:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.tax_id || activeCompanyDetails?.cuit || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Número IIBB:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.custom_ingresos_brutos || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">CBU:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.cbu || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Mes de Cierre Contable:</label>
                    <p className="text-gray-900 font-bold">{getMesCierreFromFiscalYear()}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-black text-gray-700 mb-1">Convenio Multilateral:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.custom_convenio_multilateral ? 'Sí' : 'No'}</p>
                  </div>
                </div>

                {/* Condiciones Fiscales - Vista de solo lectura */}
                <div className="border-t border-gray-200 pt-6 mt-6">
                  <h3 className="text-lg font-black text-gray-900 mb-4">Condiciones Fiscales</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-black text-gray-700 mb-1">Condición IVA:</label>
                      <p className="text-gray-900 font-bold">{activeCompanyDetails?.custom_condicion_iva || 'No disponible'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-black text-gray-700 mb-1">Condición Ingresos Brutos:</label>
                      <p className="text-gray-900 font-bold">{activeCompanyDetails?.custom_condicion_ingresos_brutos || 'No disponible'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-black text-gray-700 mb-1">Jurisdicciones IIBB:</label>
                      <p className="text-gray-900 font-bold">{activeCompanyDetails?.custom_jurisdicciones_iibb || 'No disponible'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-black text-gray-700 mb-1">Condición Ganancias:</label>
                      <p className="text-gray-900 font-bold">{activeCompanyDetails?.custom_condicion_ganancias || 'No disponible'}</p>
                    </div>
                  </div>
                </div>

                {/* Mapeo de Cuentas para Percepciones/Retenciones */}
                <div className="border-t border-gray-200 pt-6 mt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <Settings2 className="w-5 h-5 text-gray-600" />
                      <h3 className="text-lg font-black text-gray-900">Mapeo de Cuentas Contables</h3>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {/* Percepciones IIBB - Compras */}
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <MapPin className="w-4 h-4 text-blue-500" />
                          <span className="font-bold text-gray-900 text-sm">Percepciones IIBB</span>
                        </div>
                        <button
                          onClick={() => openTaxAccountModal('PERCEPCION_IIBB', 'purchase')}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Editar
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        {getFilteredMaps('PERCEPCION_IIBB', 'purchase').length} provincias configuradas
                      </p>
                    </div>

                    {/* Retenciones IIBB - Ventas */}
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <MapPin className="w-4 h-4 text-green-500" />
                          <span className="font-bold text-gray-900 text-sm">Retenciones IIBB</span>
                        </div>
                        <button
                          onClick={() => openTaxAccountModal('RETENCION_IIBB', 'sale')}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Editar
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        {getFilteredMaps('RETENCION_IIBB', 'sale').length} provincias configuradas
                      </p>
                    </div>

                    {/* Percepciones IVA - Compras */}
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Building2 className="w-4 h-4 text-purple-500" />
                          <span className="font-bold text-gray-900 text-sm">Percepciones IVA</span>
                        </div>
                        <button
                          onClick={() => openTaxAccountModal('PERCEPCION_IVA', 'purchase')}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Editar
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        {getFilteredMaps('PERCEPCION_IVA', 'purchase').length} configuraciones
                      </p>
                    </div>

                    {/* Retenciones IVA - Ventas */}
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Building2 className="w-4 h-4 text-indigo-500" />
                          <span className="font-bold text-gray-900 text-sm">Retenciones IVA</span>
                        </div>
                        <button
                          onClick={() => openTaxAccountModal('RETENCION_IVA', 'sale')}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Editar
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        {getFilteredMaps('RETENCION_IVA', 'sale').length} configuraciones
                      </p>
                    </div>

                    {/* Percepciones Ganancias - Compras */}
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Building2 className="w-4 h-4 text-orange-500" />
                          <span className="font-bold text-gray-900 text-sm">Percepciones Ganancias</span>
                        </div>
                        <button
                          onClick={() => openTaxAccountModal('PERCEPCION_GANANCIAS', 'purchase')}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Editar
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        {getFilteredMaps('PERCEPCION_GANANCIAS', 'purchase').length} configuraciones
                      </p>
                    </div>

                    {/* Retenciones Ganancias - Ventas */}
                    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Building2 className="w-4 h-4 text-red-500" />
                          <span className="font-bold text-gray-900 text-sm">Retenciones Ganancias</span>
                        </div>
                        <button
                          onClick={() => openTaxAccountModal('RETENCION_GANANCIAS', 'sale')}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Editar
                        </button>
                      </div>
                      <p className="text-xs text-gray-500">
                        {getFilteredMaps('RETENCION_GANANCIAS', 'sale').length} configuraciones
                      </p>
                    </div>
                  </div>
                </div>

                {/* Item Tax Templates - Vista mejorada con secciones colapsables */}
                <div className="border-t border-gray-200 pt-6 mt-6">
                  <h3 className="text-lg font-black text-gray-900 mb-4">Plantillas de Impuestos para Artículos</h3>
                  
                  {/* Templates de Ventas */}
                  <div className="mb-3">
                    <button
                      onClick={() => toggleSection('salesTemplates')}
                      className="flex items-center justify-between w-full bg-green-50 hover:bg-green-100 rounded-lg px-4 py-2.5 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        {collapsedSections.salesTemplates ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        <span className="font-bold text-green-800">IVA Ventas</span>
                        <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">{salesTemplates.length} plantillas</span>
                      </div>
                    </button>
                    {!collapsedSections.salesTemplates && (
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mt-2 pl-6">
                        {salesTemplates.map((template) => (
                          <div key={template.name} className="bg-white rounded-lg p-2 border border-green-200 flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-900 truncate">{extractCleanTemplateName(template.title)}</span>
                            <button
                              onClick={() => onEditTemplate && onEditTemplate(template)}
                              className="text-green-600 hover:text-green-800 text-xs font-medium ml-1"
                              title="Editar plantilla"
                            >
                              <Edit className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Templates de Compras */}
                  <div>
                    <button
                      onClick={() => toggleSection('purchaseTemplates')}
                      className="flex items-center justify-between w-full bg-blue-50 hover:bg-blue-100 rounded-lg px-4 py-2.5 transition-colors"
                    >
                      <div className="flex items-center space-x-2">
                        {collapsedSections.purchaseTemplates ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        <span className="font-bold text-blue-800">IVA Compras</span>
                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">{purchaseTemplates.length} plantillas</span>
                      </div>
                    </button>
                    {!collapsedSections.purchaseTemplates && (
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mt-2 pl-6">
                        {purchaseTemplates.map((template) => (
                          <div key={template.name} className="bg-white rounded-lg p-2 border border-blue-200 flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-900 truncate">{extractCleanTemplateName(template.title)}</span>
                            <button
                              onClick={() => onEditTemplate && onEditTemplate(template)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium ml-1"
                              title="Editar plantilla"
                            >
                              <Edit className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Botones de editar */}
              <div className="flex flex-col space-y-2 ml-4">
                <button
                  onClick={startEditing}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                  title="Editar datos impositivos"
                >
                  <Edit className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🏢</div>
          <h3 className="text-xl font-black text-gray-900 mb-2">No hay empresa activa</h3>
          <p className="text-gray-600 font-medium">Selecciona una empresa para ver los datos impositivos</p>
        </div>
      )}

      {/* Modal para editar Tax Account Map */}
      {showTaxAccountModal && (
        <Modal
          isOpen={showTaxAccountModal}
          onClose={() => setShowTaxAccountModal(false)}
          title={getTaxAccountModalTitle()}
          size="lg"
        >
          <div className="p-4">
            {/* Lista de mappings */}
            <div className="max-h-96 overflow-y-auto space-y-2">
              {getFilteredMaps(taxAccountModalType, taxAccountModalTransaction).length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-2">No hay configuraciones para este tipo.</p>
                  <p className="text-xs text-gray-400">
                    Ejecute el bootstrap de configuración AFIP para crear los mapeos por defecto.
                  </p>
                </div>
              ) : (
                getFilteredMaps(taxAccountModalType, taxAccountModalTransaction).map((map) => (
                  <div key={map.name} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="font-medium text-gray-900">
                          {PROVINCE_NAMES[map.province_code] || map.province_code || 'General'}
                        </span>
                      </div>
                      {editingTaxMap === map.name ? (
                        <div className="mt-2">
                          <select
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            value={map.account || ''}
                            onChange={(e) => saveTaxAccountChange(map.name, e.target.value)}
                            disabled={savingTaxMap}
                          >
                            {filteredAvailableAccounts.map(a => (
                              <option key={a.name} value={a.name}>
                                {removeCompanyAbbr(a.name, activeCompanyDetails?.abbr)}
                              </option>
                            ))}
                          </select>
                          {savingTaxMap && (
                            <p className="text-xs text-blue-500 mt-1">Guardando...</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 truncate mt-1" title={removeCompanyAbbr(map.account, activeCompanyDetails?.abbr)}>
                          {removeCompanyAbbr(map.account, activeCompanyDetails?.abbr) || 'Sin cuenta asignada'}
                        </p>
                      )}
                    </div>
                    <div className="ml-2 flex-shrink-0">
                      {editingTaxMap === map.name ? (
                        <button
                          onClick={() => setEditingTaxMap(null)}
                          className="text-gray-500 hover:text-gray-700 p-1"
                          title="Cancelar"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingTaxMap(map.name)
                            const rootType = taxAccountModalTransaction === 'sale' ? 'Liability' : 'Asset'
                            fetchAvailableAccounts(rootType)
                          }}
                          className="text-blue-600 hover:text-blue-800 p-1"
                          title="Editar cuenta"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowTaxAccountModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default TaxSettings