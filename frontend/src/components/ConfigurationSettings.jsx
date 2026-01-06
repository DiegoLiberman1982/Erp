import React, { useState, useContext, useEffect, useRef, useMemo } from 'react'
import { Building2, Plus, Edit, Trash2, Check, X, Upload, FileText, Users, Receipt, Wallet, Archive, Save, MapPin, Search, Mail } from 'lucide-react'
import Modal from './Modal'
import { AuthContext } from '../AuthProvider'
import { useNotification } from '../contexts/NotificationContext'
import { useConfirm } from '../hooks/useConfirm'
import TaxSettings from './configcomponents/TaxSettings'
import InitialConfiguration from './configcomponents/InitialConfiguration'
import CompanyTab from './configcomponents/CompanyTab'
import CustomerSupplierAccounts from './configcomponents/CustomerSupplierAccounts'
import TalonariosTab from './configcomponents/TalonariosTab'
import InventoryCostCenters from './configcomponents/InventoryCostCenters'
import TreasuryTab from './configcomponents/TreasuryTab'
import TabsNavigation from './configcomponents/Main/TabsNavigation'
import ModalsContainer from './configcomponents/Main/ModalsContainer'
import CalculatorModal from './CalculatorModal'
import { getAfipData, validateCuit } from '../apiUtils'
import EmailConfiguration from './configcomponents/EmailConfiguration'
import DocumentFormatsTab from './configcomponents/DocumentFormats/DocumentFormatsTab'
import IntegrationsTab from './configcomponents/Integrations/IntegrationsTab'

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

const ConfigurationSettings = () => {
  const [activeTab, setActiveTab] = useState('empresas')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { fetchWithAuth, activeCompany: activeCompanyFromContext, refreshCompanies } = useContext(AuthContext)
  const { showNotification } = useNotification()
  const { confirm, ConfirmDialog } = useConfirm()

  // Ref para el componente TalonariosTab
  const talonariosTabRef = useRef(null)
  const [fiscalYearData, setFiscalYearData] = useState(null)
  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)

  // States shared across tabs (missing previously)
  const [saving, setSaving] = useState(false)
  const [deletingCompany, setDeletingCompany] = useState(null)
  const [companies, setCompanies] = useState([])
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  // Estados para configuración de cuentas
  const [accountsSettings, setAccountsSettings] = useState(null)
  const [editingCompany, setEditingCompany] = useState(null)
  const [loadingAccountsSettings, setLoadingAccountsSettings] = useState(false)

  // Estados para edición de datos
  const [editedData, setEditedData] = useState({})

  // Estados para búsqueda predictiva de cuentas
  const [accountSearchResults, setAccountSearchResults] = useState({})
  const [showAccountDropdown, setShowAccountDropdown] = useState({})

  // Estados para modal de edición de templates de impuestos
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [taxAccounts, setTaxAccounts] = useState([])

  // Modal control levantado aquí para evitar problemas de stacking/context
  const [companyAddressModal, setCompanyAddressModal] = useState({ open: false, companyName: null })
  // Modal para agregar empresa (controlado en este nivel)
  const [isAddCompanyModalOpen, setIsAddCompanyModalOpen] = useState(false)

  // Estados para modal de talonarios
  const [isTalonarioModalOpen, setIsTalonarioModalOpen] = useState(false)
  const [selectedTalonarioForModal, setSelectedTalonarioForModal] = useState(null)

  // Estados para modal de centros de costo
  const [isCostCenterModalOpen, setIsCostCenterModalOpen] = useState(false)
  const [newCostCenter, setNewCostCenter] = useState({
    cost_center_name: '',
    parent_cost_center: '',
    parent_cost_center_display: '',
    is_group: 0
  })
  const [creatingCostCenter, setCreatingCostCenter] = useState(false)
  const [costCenters, setCostCenters] = useState([])
  const [showParentDropdown, setShowParentDropdown] = useState(false)
  const [parentCostCenters, setParentCostCenters] = useState([])

  // Estados para modal de grupos de items
  const [isItemGroupModalOpen, setIsItemGroupModalOpen] = useState(false)
  const [newItemGroup, setNewItemGroup] = useState({
    item_group_name: '',
    parent_item_group: '',
    parent_item_group_display: '',
    is_group: 0
  })
  const [creatingItemGroup, setCreatingItemGroup] = useState(false)
  const [itemGroups, setItemGroups] = useState([])
  const [showParentItemGroupDropdown, setShowParentItemGroupDropdown] = useState(false)
  const [parentItemGroups, setParentItemGroups] = useState([])
  const [customerGroups, setCustomerGroups] = useState([])
  const [supplierGroups, setSupplierGroups] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(false)

  // Merge parent groups and leaf groups into a single unique list for views
  // that need both (e.g. InventoryCostCenters' ItemGroups component).
  const mergedItemGroups = useMemo(() => {
    const merged = []
    if (parentItemGroups && parentItemGroups.length) merged.push(...parentItemGroups)
    if (itemGroups && itemGroups.length) merged.push(...itemGroups)
    const map = new Map()
    merged.forEach(g => {
      if (!g || !g.name) return
      if (!map.has(g.name)) map.set(g.name, g)
    })
    return Array.from(map.values())
  }, [parentItemGroups, itemGroups])

  // Estados para modal de agrupar grupos de items
  const [isGroupItemsModalOpen, setIsGroupItemsModalOpen] = useState(false)
  const [selectedItemGroups, setSelectedItemGroups] = useState([])
  const [targetParentGroup, setTargetParentGroup] = useState('')
  const [groupingItems, setGroupingItems] = useState(false)

  // Estados para modal de email account
  const [isEmailAccountModalOpen, setIsEmailAccountModalOpen] = useState(false)
  const [editingEmailAccount, setEditingEmailAccount] = useState(null)
  const [emailAccountsRefreshTrigger, setEmailAccountsRefreshTrigger] = useState(0)

  // Estados para modal de prueba de email
  const [testEmailModalData, setTestEmailModalData] = useState({ isOpen: false, emailAccount: null })
  const [testingEmail, setTestingEmail] = useState(false)

  // Estados para listas de precios
  const [salesPriceLists, setSalesPriceLists] = useState([])
  const [purchasePriceLists, setPurchasePriceLists] = useState([])
  const [loadingPriceLists, setLoadingPriceLists] = useState(false)

  // Estados para cuentas disponibles
  const [availableIncomeAccounts, setAvailableIncomeAccounts] = useState([])
  const [availableExpenseAccounts, setAvailableExpenseAccounts] = useState([])

  // Estados para condiciones de pago
  const [paymentTermsTemplates, setPaymentTermsTemplates] = useState([])
  const [loadingPaymentTerms, setLoadingPaymentTerms] = useState(false)
  const [newCompany, setNewCompany] = useState({
    name: '',
    razonSocial: '',
    domicilio: '',
    localidad: '',
    codigoPostal: '',
    provincia: '',
    pais: 'ARGENTINA',
    telefono: '',
    email: '',
    cbu: '',
    cuit: '',
    numeroIIBB: '',
    inscriptoConvenioMultilateral: false,
    mesCierreContable: '',
    logo: null,
    registration_details: '',
    personeria: '',
    condicionIVA: ''
  })

  // Estado para consulta AFIP
  const [consultingAfip, setConsultingAfip] = useState(false)

  // Estados para warehouses
  const [warehouses, setWarehouses] = useState([])
  const [warehouseTypes, setWarehouseTypes] = useState([])
  const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false)
  const [editingWarehouse, setEditingWarehouse] = useState(null)
  const [warehouseFormData, setWarehouseFormData] = useState({
    warehouse_name: '',
    warehouse_type: '',
    is_group: 0,
    parent_warehouse: '',
    account: '',
    address: '',
    city: '',
    state: '',
    country: '',
    phone_no: '',
    email_id: ''
  })
  const [savingWarehouse, setSavingWarehouse] = useState(false)

  // Modal control levantado aquí para evitar problemas de stacking/context
  const [showCustomerGroupModal, setShowCustomerGroupModal] = useState(false)
  const [showSupplierGroupModal, setShowSupplierGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [groupFormData, setGroupFormData] = useState({
    name: '',
    parent_group: '',
    default_price_list: '',
    account: ''
  })
  const [savingGroup, setSavingGroup] = useState(false)

  // Exchange History modal (lifted so it mounts above page content)
  const [isExchangeHistoryOpen, setIsExchangeHistoryOpen] = useState(false)
  const [exchangeHistoryCurrency, setExchangeHistoryCurrency] = useState(null)

  const openExchangeHistoryModal = (currency) => {
    setExchangeHistoryCurrency(currency || null)
    setIsExchangeHistoryOpen(true)
  }

  const closeExchangeHistoryModal = () => {
    setIsExchangeHistoryOpen(false)
    setExchangeHistoryCurrency(null)
  }

  // Calculator modal lifted here so it appears above page content
  const [showCalculatorModal, setShowCalculatorModal] = useState(false)
  const [calculatorTarget, setCalculatorTarget] = useState(null)
  const [calculatorInitialFormula, setCalculatorInitialFormula] = useState('')
  const [calculatorContext, setCalculatorContext] = useState('manualPriceList')
  const applyCalculatorCallbackRef = useRef(null)

  const handleNewCompanyChange = (field, value) => {
    setNewCompany(prev => {
      const updated = { ...prev, [field]: value }

      // Lógica especial para mes de cierre contable
      if (field === 'personeria' || field === 'cuit') {
        const isUnipersonal = updated.personeria === 'Unipersonal'
        const cuitStartsWith2 = updated.cuit && updated.cuit.replace(/[-\s]/g, '').startsWith('2')

        if (isUnipersonal || cuitStartsWith2) {
          // Para Unipersonal o CUIT que empieza con 2, mes de cierre fijo en diciembre
          updated.mesCierreContable = '12'
        } else if (prev.personeria === 'Unipersonal' || (prev.cuit && prev.cuit.replace(/[-\s]/g, '').startsWith('2'))) {
          // Si antes era Unipersonal o CUIT empezaba con 2, y ahora cambió, resetear mes de cierre
          updated.mesCierreContable = ''
        }
      }

      return updated
    })
  }

  const handleSearchAfipCompany = async (cuit) => {
    if (!cuit || !cuit.trim()) {
      showNotification('Por favor ingrese un CUIT', 'error')
      return
    }

    // Limpiar el CUIT y validar
    const cleanCuit = cuit.replace(/[-\s]/g, '')
    if (!validateCuit(cleanCuit)) {
      showNotification('El CUIT ingresado no es válido', 'error')
      return
    }

    setConsultingAfip(true)

    try {
      const result = await getAfipData(cleanCuit, fetchWithAuth)

      if (result.success) {
        const afipData = result.data

        // Parsear la dirección completa para separar componentes
        let parsedAddress = ''
        let parsedCity = afipData.localidad || '' // Usar directamente la localidad de AFIP
        let parsedPostalCode = afipData.codigo_postal || ''
        let parsedProvince = afipData.provincia || ''

        if (afipData.address) {
          // La dirección viene como: "DIRECCIÓN, LOCALIDAD, PROVINCIA, CP: CODIGO_POSTAL"
          const addressParts = afipData.address.split(', ')

          if (addressParts.length >= 1) {
            parsedAddress = addressParts[0].trim() // Primera parte es la dirección
          }

          // Si no tenemos localidad específica, intentar extraerla de la dirección
          if (!parsedCity && addressParts.length >= 2) {
            // Buscar si hay CP: en alguna parte
            const cpIndex = addressParts.findIndex(part => part.includes('CP:'))
            if (cpIndex !== -1) {
              // Extraer código postal si no lo tenemos
              if (!parsedPostalCode) {
                const cpPart = addressParts[cpIndex]
                const cpMatch = cpPart.match(/CP:\s*(\d+)/)
                if (cpMatch) {
                  parsedPostalCode = cpMatch[1]
                }
              }

              // La ciudad es la parte inmediatamente antes del CP
              if (cpIndex > 1) {
                parsedCity = addressParts[cpIndex - 1].trim()
              }
            } else if (addressParts.length >= 2) {
              // No hay CP, la segunda parte podría ser ciudad o ciudad,provincia
              const secondPart = addressParts[1].trim()
              // Si contiene coma, tomar solo la primera parte como ciudad
              parsedCity = secondPart.split(',')[0].trim()
            }
          }

          // Extraer código postal si no lo tenemos
          if (!parsedPostalCode) {
            const cpPart = addressParts.find(part => part.includes('CP:'))
            if (cpPart) {
              const cpMatch = cpPart.match(/CP:\s*(\d+)/)
              if (cpMatch) {
                parsedPostalCode = cpMatch[1]
              }
            }
          }
        }

        // Determinar personería basada en el CUIT
        let personeria = afipData.personeria || ''
        if (cleanCuit.startsWith('2')) {
          personeria = 'Unipersonal'
        }

        // Llenar automáticamente los campos con los datos de AFIP
        const updatedData = {
          ...newCompany,
          name: afipData.business_name || afipData.name, // Copiar también al nombre de la empresa
          razonSocial: afipData.business_name || afipData.name,
          cuit: cleanCuit,
          domicilio: parsedAddress,
          localidad: parsedCity,
          codigoPostal: parsedPostalCode,
          provincia: parsedProvince,
          personeria: personeria,
          pais: afipData.pais || 'ARGENTINA',
          condicionIVA: afipData.tax_condition || '' // Llenar condición IVA
        }

        setNewCompany(updatedData)
        showNotification('Datos de AFIP cargados exitosamente', 'success')
      } else {
        showNotification(result.error, 'error')
      }
    } catch (error) {
      console.error('Error al consultar AFIP:', error)
      showNotification('Error al consultar AFIP', 'error')
    } finally {
      setConsultingAfip(false)
    }
  }

  const handleCreateCompany = async () => {
    // Validaciones obligatorias
    if (!newCompany.name.trim()) {
      showNotification('El nombre de la empresa es obligatorio', 'error')
      return
    }
    if (!newCompany.razonSocial.trim()) {
      showNotification('La razón social es obligatoria', 'error')
      return
    }
    if (!newCompany.cuit || !newCompany.cuit.trim()) {
      showNotification('El CUIT es obligatorio', 'error')
      return
    }
    if (!newCompany.domicilio || !newCompany.domicilio.trim()) {
      showNotification('El Domicilio Fiscal es obligatorio', 'error')
      return
    }
    if (!newCompany.mesCierreContable) {
      showNotification('El Mes de Cierre Contable es obligatorio', 'error')
      return
    }

    const defaultCurrency = (activeCompanyDetails?.default_currency || '').toString().trim()
    if (!defaultCurrency) {
      showNotification('No se pudo determinar la moneda por defecto (defina la moneda default de la empresa activa antes de crear otra)', 'error')
      return
    }

    const companyData = {
      name: newCompany.name.trim(),
      company_name: newCompany.razonSocial.trim(),
      country: newCompany.pais,
      phone_no: newCompany.telefono,
      email: newCompany.email,
      tax_id: newCompany.cuit.trim(),
      registration_details: newCompany.registration_details || `CUIT: ${newCompany.cuit || ''}, IIBB: ${newCompany.numeroIIBB || ''}`,
      default_currency: defaultCurrency,
      // Enviar exactamente la personería seleccionada por el usuario (se gestionan los custom fields desde el backend)
      custom_personeria: newCompany.personeria || '',
      custom_mes_cierre: newCompany.mesCierreContable,
      // Enviar la condición frente al IVA para que quede cuando se crea la empresa
      custom_condicion_iva: newCompany.condicionIVA || ''
    }

    try {
      setSaving(true)
      const result = await createCompany(companyData)
      if (result && result.success) {
        // Crear la dirección fiscal (Billing) usando el domicilio provisto
        try {
          const addressPayload = {
            address_title: 'Dirección Fiscal',
            address_type: 'Billing',
            address_line1: newCompany.domicilio.trim(),
            address_line2: '',
            city: newCompany.localidad || '',
            state: newCompany.provincia || '',
            pincode: newCompany.codigoPostal || '',
            country: newCompany.pais || 'Argentina',
            link_doctype: 'Company',
            link_name: companyData.name
          }

          const addrResp = await fetchWithAuth('/api/addresses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(addressPayload)
          })

          if (addrResp && addrResp.ok) {
            const addrData = await addrResp.json().catch(() => ({}))
            if (addrData.success) {
              showNotification('Empresa y Domicilio Fiscal creados correctamente', 'success')
            } else {
              // Dirección no creada correctamente, pero empresa sí
              showNotification('Empresa creada, pero no se pudo crear la dirección fiscal', 'warning')
            }
          } else {
            showNotification('Empresa creada, pero error al crear dirección fiscal', 'warning')
          }
        } catch (addrErr) {
          console.error('Error creating fiscal address:', addrErr)
          showNotification('Empresa creada, pero error al crear dirección fiscal', 'warning')
        }

        setIsAddCompanyModalOpen(false)
        setNewCompany({
          name: '', razonSocial: '', domicilio: '', localidad: '', codigoPostal: '', provincia: '', pais: 'ARGENTINA', telefono: '', email: '', cbu: '', cuit: '', numeroIIBB: '', inscriptoConvenioMultilateral: false, mesCierreContable: '', logo: null, registration_details: '', personeria: '', condicionIVA: ''
        })
      } else {
        showNotification(result.message || 'Error al crear empresa', 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  // Cargar datos al montar el componente
  useEffect(() => {
    fetchAccountsSettings()
    fetchTaxAccounts()
    fetchWarehouseTypes()
    loadGroups()
    loadPriceLists()
    fetchAvailableAccounts()
    loadPaymentTermsTemplates()
    loadItemGroups()
  }, [])

  // Cargar detalles de la compañía cuando cambia activeCompanyFromContext
  useEffect(() => {
    if (activeCompanyFromContext) {
      fetchCompanyDetails(activeCompanyFromContext)
    } else {
      setActiveCompanyDetails(null)
    }
  }, [activeCompanyFromContext])

  // Cargar warehouses cuando cambia activeCompanyDetails
  useEffect(() => {
    if (activeCompanyDetails?.name) {
      fetchWarehouses()
    }
  }, [activeCompanyDetails?.name])

  // Función para obtener detalles de la empresa
  const fetchCompanyDetails = async (companyName) => {
    try {
      const response = await fetchWithAuth(`/api/companies/${companyName}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setActiveCompanyDetails(data.data)
          // Cargar Fiscal Year si la empresa tiene uno asignado
          if (data.data && data.data.fiscal_year) {
            fetchFiscalYearDetails(data.data.fiscal_year)
          } else {
            setFiscalYearData(null)
          }
        }
      }
    } catch (err) {
      console.error('Error fetching company details:', err)
    }
  }

  // Función para refrescar detalles de la empresa (usada por componentes hijos)
  const refreshCompanyDetails = () => {
    if (activeCompanyFromContext) {
      fetchCompanyDetails(activeCompanyFromContext)
    }
  }

  // Funciones para manejar modal de talonarios
  const handleOpenTalonarioModal = (talonario = null) => {
    setSelectedTalonarioForModal(talonario)
    setIsTalonarioModalOpen(true)
  }

  const handleCloseTalonarioModal = () => {
    setIsTalonarioModalOpen(false)
    setSelectedTalonarioForModal(null)
  }

  const handleTalonarioSave = () => {
    // Refrescar la lista de talonarios
    if (talonariosTabRef.current) {
      talonariosTabRef.current.refreshTalonarios()
    }
  }

  // Funciones para manejar modal de centros de costo
  // Función para cargar centros de costo
  const loadCostCenters = async () => {
    try {
      const response = await fetchWithAuth('/api/cost-centers?limit=1000')
      if (response.ok) {
        const data = await response.json()
        setCostCenters(data.data || [])
      }
    } catch (error) {
      console.error('Error loading cost centers:', error)
      showNotification('Error al cargar centros de costo', 'error')
    }
  }

  // Funciones para manejar modales de grupos de clientes y proveedores
  const openCustomerGroupModal = (group = null) => {
    console.log('openCustomerGroupModal called with group:', group)
    console.log('customerGroups state:', customerGroups)
    if (group) {
      setEditingGroup(group)
      setGroupFormData({
        name: group.name || '',
        parent_group: group.old_parent || '',
        default_price_list: group.default_price_list || '',
        account: group.accounts?.[0]?.account || group.account || '',
        payment_terms: group.payment_terms || '',
        is_group: group.is_group || 0
      })
      console.log('Editing group formData set:', {
        name: group.name || '',
        parent_group: group.old_parent || '',
        default_price_list: group.default_price_list || '',
        account: group.accounts?.[0]?.account || group.account || '',
        payment_terms: group.payment_terms || '',
        is_group: group.is_group || 0
      })
    } else {
      setEditingGroup(null)
      // Buscar el primer grupo padre disponible para asignarlo por defecto
      const defaultParentGroup = customerGroups?.find(group => group.is_group === 1)?.name || ''
      console.log('Creating new group, default parent:', defaultParentGroup)
      setGroupFormData({
        name: '',
        parent_group: defaultParentGroup,
        default_price_list: '',
        account: '',
        payment_terms: '',
        is_group: 0
      })
    }
    setShowCustomerGroupModal(true)
  }

  const closeCustomerGroupModal = () => {
    setShowCustomerGroupModal(false)
    setEditingGroup(null)
    setGroupFormData({
      name: '',
      parent_group: '',
      default_price_list: '',
      account: '',
      payment_terms: '',
      is_group: 0
    })
  }

  const openSupplierGroupModal = (group = null) => {
    if (group) {
      setEditingGroup(group)
      setGroupFormData({
        name: group.name || '',
        parent_group: group.old_parent || '',
        account: group.accounts?.[0]?.account || group.account || '',
        payment_terms: group.payment_terms || '',
        is_group: group.is_group || 0
      })
    } else {
      setEditingGroup(null)
      // Buscar el primer grupo padre disponible para asignarlo por defecto
      const defaultParentGroup = supplierGroups?.find(group => group.is_group === 1)?.name || ''
      setGroupFormData({
        name: '',
        parent_group: defaultParentGroup,
        account: '',
        payment_terms: '',
        is_group: 0
      })
    }
    setShowSupplierGroupModal(true)
  }

  const closeSupplierGroupModal = () => {
    setShowSupplierGroupModal(false)
    setEditingGroup(null)
    setGroupFormData({
      name: '',
      parent_group: '',
      account: '',
      payment_terms: '',
      is_group: 0
    })
  }

  // Handlers to open the Calculator modal from child components
  const handleOpenCalculator = (targetName, initialFormula = '', applyCallback, context = 'manualPriceList') => {
    setCalculatorTarget(targetName)
    setCalculatorInitialFormula(initialFormula || '')
    setCalculatorContext(context)
    applyCalculatorCallbackRef.current = typeof applyCallback === 'function' ? applyCallback : null
    setShowCalculatorModal(true)
  }

  const handleApplyCalculator = (formula) => {
    try {
      if (applyCalculatorCallbackRef.current) {
        applyCalculatorCallbackRef.current(formula)
      }
    } catch (err) {
      console.error('Error applying calculator callback:', err)
    } finally {
      applyCalculatorCallbackRef.current = null
      setShowCalculatorModal(false)
      setCalculatorTarget(null)
      setCalculatorInitialFormula('')
    }
  }

  const handleCloseCalculator = () => {
    applyCalculatorCallbackRef.current = null
    setShowCalculatorModal(false)
    setCalculatorTarget(null)
    setCalculatorInitialFormula('')
  }

  const handleSaveGroup = async (groupType) => {
    if (!groupFormData.name.trim()) {
      showNotification('El nombre del grupo es obligatorio', 'error')
      return
    }

    setSavingGroup(true)

    try {
      const isCustomer = groupType === 'customer'
      const doctype = isCustomer ? 'Customer Group' : 'Supplier Group'
      const endpoint = `/api/resource/${doctype}`

      const groupData = {
        ...(isCustomer ? { customer_group_name: groupFormData.name } : { supplier_group_name: groupFormData.name }),
        [isCustomer ? 'parent_customer_group' : 'parent_supplier_group']: groupFormData.parent_group || null,
        ...(isCustomer ? { default_price_list: groupFormData.default_price_list || null } : {}),
        payment_terms: groupFormData.payment_terms || null,
        is_group: groupFormData.is_group || 0,
        accounts: groupFormData.account ? [{
          account: groupFormData.account,
          company: activeCompanyDetails?.name,
          parent: editingGroup ? editingGroup.name : groupFormData.name,
          parentfield: 'accounts',
          parenttype: isCustomer ? 'Customer Group' : 'Supplier Group',
          doctype: 'Party Account'
        }] : []
      }

      console.log('Enviando datos del grupo:', groupData)

      const url = editingGroup
        ? `${endpoint}/${encodeURIComponent(editingGroup.name)}`
        : endpoint

      const method = editingGroup ? 'PUT' : 'POST'

      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify({ data: groupData })
      })

      console.log('Respuesta del servidor:', response.status, response.statusText)

      if (response.ok) {
        const data = await response.json()
        console.log('Datos de respuesta exitosa:', data)
        if (data.success) {
          showNotification(
            editingGroup ? 'Grupo actualizado exitosamente' : 'Grupo creado exitosamente',
            'success'
          )
          if (isCustomer) {
            closeCustomerGroupModal()
          } else {
            closeSupplierGroupModal()
          }
          // Aquí podrías refrescar la lista de grupos si fuera necesario
        } else {
          console.error('Error en respuesta del servidor:', data)
          showNotification(data.message || 'Error al guardar grupo', 'error')
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        console.error('Error HTTP:', response.status, errorData)
        showNotification(errorData.message || `Error al guardar grupo (${response.status})`, 'error')
      }
    } catch (error) {
      console.error('Error saving group:', error)
      showNotification('Error al guardar grupo', 'error')
    } finally {
      setSavingGroup(false)
    }
  }

  const handleOpenCostCenterModal = async () => {
    setIsCostCenterModalOpen(true)
    // Cargar centros de costo si no están cargados
    if (costCenters.length === 0) {
      await loadCostCenters()
    }

    // Determinar el tipo por defecto basado en si hay grupos existentes
    const hasGroups = costCenters.some(cc => cc.is_group === 1)
    setNewCostCenter(prev => ({
      ...prev,
      is_group: hasGroups ? 0 : 1  // Si no hay grupos, por defecto grupo; si hay, por defecto individual
    }))
  }

  const handleCloseCostCenterModal = () => {
    setIsCostCenterModalOpen(false)
    setNewCostCenter({
      cost_center_name: '',
      parent_cost_center: '',
      parent_cost_center_display: '',
      is_group: 0
    })
    setShowParentDropdown(false)
  }

  // Función para manejar cambios en el input de centro de costo padre
  const handleParentCostCenterInputChange = (value) => {
    setNewCostCenter(prev => ({ ...prev, parent_cost_center_display: value }))
    // Filtrar centros de costo padre (grupos)
    const filtered = costCenters.filter(cc => cc.is_group === 1 && 
      (cc.display_name?.toLowerCase().includes(value.toLowerCase()) || 
       cc.cost_center_name?.toLowerCase().includes(value.toLowerCase())))
    setParentCostCenters(filtered)
    setShowParentDropdown(true)
  }

  // Función para seleccionar centro de costo padre
  const selectParentCostCenter = (costCenter) => {
    setNewCostCenter(prev => ({
      ...prev,
      parent_cost_center: costCenter.name,
      parent_cost_center_display: costCenter.display_name || costCenter.cost_center_name
    }))
    setShowParentDropdown(false)
  }

  // Resetear campos relacionados cuando cambia el tipo
  useEffect(() => {
    if (newCostCenter.is_group === 1) {
      // Si es grupo, limpiar cualquier selección de padre
      setNewCostCenter(prev => ({
        ...prev,
        parent_cost_center: '',
        parent_cost_center_display: ''
      }))
    }
  }, [newCostCenter.is_group])

  const handleCreateCostCenter = async () => {
    if (!newCostCenter.cost_center_name.trim()) {
      showNotification('El nombre del centro de costo es obligatorio', 'error')
      return
    }

    // Validar que si es centro individual, debe tener un padre
    if (newCostCenter.is_group === 0 && !newCostCenter.parent_cost_center) {
      showNotification('Los centros de costo individuales deben pertenecer a un grupo padre', 'error')
      return
    }

    setCreatingCostCenter(true)
    try {
      const response = await fetchWithAuth('/api/cost-centers', {
        method: 'POST',
        body: JSON.stringify({
          cost_center_name: newCostCenter.cost_center_name,
          parent_cost_center: newCostCenter.parent_cost_center || '',
          is_group: newCostCenter.is_group
        })
      })

      if (response.ok) {
        const data = await response.json()
        // Agregar el nuevo centro de costo a la lista
        setCostCenters(prev => [...prev, data.data])
        // Recargar la lista completa para asegurar jerarquía correcta
        await loadCostCenters()
        // Cerrar modal y resetear formulario
        handleCloseCostCenterModal()
        showNotification('Centro de costo creado exitosamente', 'success')
      } else {
        const error = await response.json()
        showNotification(`Error al crear centro de costo: ${error.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error creating cost center:', error)
      showNotification('Error al crear centro de costo', 'error')
    } finally {
      setCreatingCostCenter(false)
    }
  }

  // Funciones para manejar modal de grupos de items
  // Función para cargar grupos de items
  const loadItemGroups = async () => {
    try {
      const response = await fetchWithAuth('/api/item-groups?limit=1000&kind=leafs')
      if (response.ok) {
        const data = await response.json()
        setItemGroups(data.data || [])
      }

      // Also load parent groups for InventoryCostCenters and parent selectors
      try {
        const companyParam = activeCompanyDetails?.name ? `?custom_company=${encodeURIComponent(activeCompanyDetails.name)}&kind=parents` : '?kind=parents'
        const parentsResp = await fetchWithAuth(`/api/item-groups${companyParam}`)
        if (parentsResp.ok) {
          const pData = await parentsResp.json()
          setParentItemGroups(pData.data || [])
        }
      } catch (e) {
        console.error('Error loading parent item groups:', e)
      }
    } catch (error) {
      console.error('Error loading item groups:', error)
      showNotification('Error al cargar grupos de items', 'error')
    }
  }

  const handleOpenItemGroupModal = async (itemGroup = null) => {
    if (itemGroup) {
      // Editar grupo existente
      setNewItemGroup({
        item_group_name: itemGroup.item_group_name || '',
        parent_item_group: itemGroup.parent_item_group || '',
        parent_item_group_display: itemGroup.parent_item_group || '',
        is_group: itemGroup.is_group || 0
      })
      setIsItemGroupModalOpen(true)
    } else {
      // Crear nuevo grupo
      // Cargar grupos de items si no están cargados
      if (itemGroups.length === 0) {
        await loadItemGroups()
      }

      // Determinar el tipo por defecto basado en si hay grupos existentes
      const hasGroups = itemGroups.some(ig => ig.is_group === 1)
      setNewItemGroup(prev => ({
        ...prev,
        is_group: hasGroups ? 0 : 1  // Si no hay grupos, por defecto grupo; si hay, por defecto individual
      }))

      setIsItemGroupModalOpen(true)
    }
  }

  const handleCloseItemGroupModal = () => {
    setIsItemGroupModalOpen(false)
    setNewItemGroup({
      item_group_name: '',
      parent_item_group: '',
      parent_item_group_display: '',
      is_group: 0
    })
    setShowParentItemGroupDropdown(false)
  }

  // Función para manejar cambios en el input de grupo de items padre
  const handleParentItemGroupInputChange = (value) => {
    setNewItemGroup(prev => ({ ...prev, parent_item_group_display: value }))
    // Filtrar grupos de items padre (grupos)
    const filtered = parentItemGroups.filter(ig => ig.is_group === 1 &&
      (ig.item_group_name?.toLowerCase().includes(value.toLowerCase()) ||
       ig.name?.toLowerCase().includes(value.toLowerCase())))
    setParentItemGroups(filtered)
    setShowParentItemGroupDropdown(true)
  }

  // Función para seleccionar grupo de items padre
  const selectParentItemGroup = (itemGroup) => {
    setNewItemGroup(prev => ({
      ...prev,
      parent_item_group: itemGroup.name,
      parent_item_group_display: itemGroup.item_group_name || itemGroup.name
    }))
    setShowParentItemGroupDropdown(false)
  }

  // Resetear campos relacionados cuando cambia el tipo
  useEffect(() => {
    if (newItemGroup.is_group === 1) {
      // Si es grupo, limpiar cualquier selección de padre
      setNewItemGroup(prev => ({
        ...prev,
        parent_item_group: '',
        parent_item_group_display: ''
      }))
    }
  }, [newItemGroup.is_group])

  const handleCreateItemGroup = async () => {
    if (!newItemGroup.item_group_name.trim()) {
      showNotification('El nombre del grupo de items es obligatorio', 'error')
      return
    }

    // Validar que si es grupo individual, debe tener un padre
    if (newItemGroup.is_group === 0 && !newItemGroup.parent_item_group) {
      showNotification('Los grupos de items individuales deben pertenecer a un grupo padre', 'error')
      return
    }

    setCreatingItemGroup(true)
    try {
      const response = await fetchWithAuth('/api/item-groups', {
        method: 'POST',
        body: JSON.stringify({
          item_group_name: newItemGroup.item_group_name,
          parent_item_group: newItemGroup.parent_item_group || '',
          is_group: newItemGroup.is_group,
          custom_company: activeCompanyDetails?.name
        })
      })

      if (response.ok) {
        const data = await response.json()
        // Agregar el nuevo grupo de items a la lista
        setItemGroups(prev => [...prev, data.data])
        // Recargar la lista completa para asegurar jerarquía correcta
        await loadItemGroups()
        // Cerrar modal y resetear formulario
        handleCloseItemGroupModal()
        showNotification('Grupo de items creado exitosamente', 'success')
      } else {
        const error = await response.json()
        showNotification(`Error al crear grupo de items: ${error.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error creating item group:', error)
      showNotification('Error al crear grupo de items', 'error')
    } finally {
      setCreatingItemGroup(false)
    }
  }



  // Funciones para manejar modal de agrupar grupos de items
  const handleOpenGroupItemsModal = (selectedGroups, selectedSubGroups) => {
    console.log('handleOpenGroupItemsModal called with:', { selectedGroups, selectedSubGroups })
    console.log('itemGroups state:', itemGroups)

    // Set the selected items for grouping - use names directly since they are strings
    setSelectedItemGroups(selectedGroups.concat(selectedSubGroups))
    setTargetParentGroup('')
    setIsGroupItemsModalOpen(true)
  }

  const handleCloseGroupItemsModal = () => {
    setIsGroupItemsModalOpen(false)
    setSelectedItemGroups([])
    setTargetParentGroup('')
  }

  const handleGroupItems = async () => {
    if (!targetParentGroup || selectedItemGroups.length === 0) {
      showNotification('Debe seleccionar un grupo padre y tener items seleccionados', 'error')
      return
    }

    setGroupingItems(true)

    try {
      // Agrupar todos los items seleccionados bajo el grupo padre
      const updatePromises = selectedItemGroups.map(async (itemName) => {
        const response = await fetchWithAuth(`/api/item-groups/${encodeURIComponent(itemName)}`, {
          method: 'PUT',
          body: JSON.stringify({
            parent_item_group: targetParentGroup
            // No necesitamos enviar is_group ya que mantenemos el tipo original
          })
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(`Error al actualizar ${itemName}: ${error.message || 'Error desconocido'}`)
        }

        return response.json()
      })

      // Esperar a que todas las actualizaciones se completen
      await Promise.all(updatePromises)

      showNotification(`Se agruparon ${selectedItemGroups.length} items exitosamente bajo "${itemGroups.find(g => g.name === targetParentGroup)?.item_group_name || targetParentGroup}"`, 'success')
      handleCloseGroupItemsModal()
      
      // Recargar los grupos de items para reflejar los cambios
      await loadItemGroups()
    } catch (error) {
      console.error('Error grouping items:', error)
      showNotification(error.message || 'Error al agrupar items', 'error')
    } finally {
      setGroupingItems(false)
    }
  }

  // Funciones para manejar modal de email account
  const handleOpenEmailAccountModal = (emailAccount = null) => {
    setEditingEmailAccount(emailAccount)
    setIsEmailAccountModalOpen(true)
  }

  const handleCloseEmailAccountModal = () => {
    setIsEmailAccountModalOpen(false)
    setEditingEmailAccount(null)
  }

  // Funciones para manejar modal de prueba de email
  const handleOpenTestEmailModal = (emailAccount) => {
    setTestEmailModalData({ isOpen: true, emailAccount })
  }

  const handleCloseTestEmailModal = () => {
    setTestEmailModalData({ isOpen: false, emailAccount: null })
  }

  const handleTestEmail = async (testEmail) => {
    if (!testEmail) {
      showNotification('Debes ingresar un email de destino para la prueba', 'error')
      return
    }

    try {
      setTestingEmail(true)

      const response = await fetchWithAuth('/api/communications/test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email_account: testEmailModalData.emailAccount.name,
          test_email: testEmail
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(data.message || 'Email de prueba enviado exitosamente', 'success')
          handleCloseTestEmailModal()
        } else {
          showNotification(data.message || 'Error al enviar email de prueba', 'error')
        }
      } else {
        showNotification('Error al enviar email de prueba', 'error')
      }
    } catch (error) {
      console.error('Error testing email:', error)
      showNotification('Error al enviar email de prueba', 'error')
    } finally {
      setTestingEmail(false)
    }
  }



  // Funciones para manejar modal de warehouses
  const fetchWarehouses = async (includeGroups = true) => {
    if (!activeCompanyDetails?.name) return

    try {
      console.log('🔍 FRONTEND: Fetching warehouses for company:', activeCompanyDetails.name)
      const response = await fetchWithAuth(`/api/inventory/warehouses?company=${encodeURIComponent(activeCompanyDetails.name)}&include_groups=${includeGroups}`)
      if (response.ok) {
        const data = await response.json()
        console.log('🔍 FRONTEND: Warehouses API response:', data)
        if (data.success) {
          const warehousesList = data.data || []
          console.log('🔍 FRONTEND: Warehouses loaded:', warehousesList.length)
          console.log('🔍 FRONTEND: Warehouses with consignment:', warehousesList.filter(w => w.has_consignment).length)
          setWarehouses(warehousesList)
        }
      }
    } catch (error) {
      console.error('Error fetching warehouses:', error)
    }
  }

  const fetchWarehouseTypes = async () => {
    try {
      const response = await fetchWithAuth('/api/inventory/warehouse-types')

      if (response.ok) {
        const data = await response.json()

        if (data.success) {
          const typesData = data.data || []
          setWarehouseTypes(typesData)


        } else {
          console.error('🔍 FRONTEND: Respuesta no exitosa:', data)
        }
      } else {
        console.error('🔍 FRONTEND: Error HTTP:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('Error fetching warehouse types:', error)
    }
  }

  // Funciones para cargar datos de grupos, listas de precios, cuentas y términos de pago
  const loadGroups = async () => {
    try {
      // Cargar grupos de clientes
      const customerResponse = await fetchWithAuth('/api/resource/Customer Group?fields=["name","is_group","old_parent"]&limit_page_length=1000')
      if (customerResponse.ok) {
        const customerData = await customerResponse.json()
        console.log('Datos de customer groups del backend:', customerData.data)
        if (customerData.success) {
          setCustomerGroups(customerData.data || [])
        } else {
          console.error('Error en respuesta de customer groups:', customerData)
        }
      } else {
        console.error('Error HTTP cargando customer groups:', customerResponse.status)
      }

      // Cargar grupos de proveedores
      const supplierResponse = await fetchWithAuth('/api/resource/Supplier Group?fields=["name","is_group","old_parent"]&limit_page_length=1000')
      if (supplierResponse.ok) {
        const supplierData = await supplierResponse.json()
        console.log('Datos de supplier groups del backend:', supplierData.data)
        if (supplierData.success) {
          setSupplierGroups(supplierData.data || [])
        } else {
          console.error('Error en respuesta de supplier groups:', supplierData)
        }
      } else {
        console.error('Error HTTP cargando supplier groups:', supplierResponse.status)
      }
    } catch (error) {
      console.error('Error loading groups:', error)
    }
  }

  const loadPriceLists = async () => {
    try {
      const [salesResponse, purchaseResponse] = await Promise.all([
        fetchWithAuth('/api/sales-price-lists'),
        fetchWithAuth('/api/inventory/purchase-price-lists/all')
      ])

      if (salesResponse.ok) {
        const salesData = await salesResponse.json()
        if (salesData.success) {
          setSalesPriceLists(salesData.data || [])
        }
      }

      if (purchaseResponse.ok) {
        const purchaseData = await purchaseResponse.json()
        if (purchaseData.success) {
          setPurchasePriceLists(purchaseData.data || [])
        }
      }
    } catch (error) {
      console.error('Error loading price lists:', error)
    }
  }

  const fetchAvailableAccounts = async () => {
    try {
      const response = await fetchWithAuth('/api/accounts?limit=1000')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const accounts = data.data || []
          // Filtrar cuentas de ingresos (Income) y gastos (Expense) - solo cuentas hoja, no sumarizadoras
          const incomeAccounts = accounts.filter(account => account.root_type === 'Income' && !account.is_group)
          const expenseAccounts = accounts.filter(account => account.root_type === 'Expense' && !account.is_group)
          setAvailableIncomeAccounts(incomeAccounts)
          setAvailableExpenseAccounts(expenseAccounts)
        }
      }
    } catch (error) {
      console.error('Error fetching available accounts:', error)
    }
  }

  const loadPaymentTermsTemplates = async () => {
    try {
      const response = await fetchWithAuth('/api/payment-terms-templates')
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setPaymentTermsTemplates(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error loading payment terms templates:', error)
    }
  }

  const handleOpenWarehouseModal = (warehouse = null) => {
    if (warehouse) {
      setEditingWarehouse(warehouse)
      setWarehouseFormData({
        warehouse_name: warehouse.warehouse_name || '',
        warehouse_type: warehouse.warehouse_type || '',
        is_group: warehouse.is_group || 0,
        parent_warehouse: warehouse.parent_warehouse || '',
        account: warehouse.account || '',
        address: warehouse.address || '',
        city: warehouse.city || '',
        state: warehouse.state || '',
        country: warehouse.country || '',
        phone_no: warehouse.phone_no || '',
        email_id: warehouse.email_id || ''
      })
    } else {
      setEditingWarehouse(null)
      setWarehouseFormData({
        warehouse_name: '',
        warehouse_type: '',
        is_group: 0,
        parent_warehouse: '',
        account: '',
        address: '',
        city: '',
        state: '',
        country: '',
        phone_no: '',
        email_id: ''
      })
    }
    setIsWarehouseModalOpen(true)
  }

  const handleCloseWarehouseModal = () => {
    setIsWarehouseModalOpen(false)
    setEditingWarehouse(null)
    setWarehouseFormData({
      warehouse_name: '',
      warehouse_type: '',
      is_group: 0,
      parent_warehouse: '',
      account: '',
      address: '',
      city: '',
      state: '',
      country: '',
      phone_no: '',
      email_id: ''
    })
  }

  const handleSaveWarehouse = async () => {
    if (!warehouseFormData.warehouse_name.trim()) {
      showNotification('El nombre del warehouse es requerido', 'error')
      return
    }

    setSavingWarehouse(true)

    try {
      const warehouseData = {
        ...warehouseFormData,
        company: activeCompanyDetails?.name
      }

      const url = editingWarehouse
        ? `/api/inventory/warehouses/${encodeURIComponent(editingWarehouse.name)}`
        : '/api/inventory/warehouses'

      const method = editingWarehouse ? 'PUT' : 'POST'

      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify(warehouseData)
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(
            editingWarehouse ? 'Warehouse actualizado exitosamente' : 'Warehouse creado exitosamente',
            'success'
          )
          handleCloseWarehouseModal()
          await fetchWarehouses()
        } else {
          showNotification(data.message || 'Error al guardar warehouse', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al guardar warehouse', 'error')
      }
    } catch (error) {
      console.error('Error saving warehouse:', error)
      showNotification('Error al guardar warehouse', 'error')
    } finally {
      setSavingWarehouse(false)
    }
  }

  const handleDeleteWarehouse = async (warehouse) => {
    const confirmed = await confirm({
      title: 'Eliminar Almacén',
      message: `¿Estás seguro de que quieres eliminar "${warehouse.warehouse_name}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'error'
    })

    if (!confirmed) return

    try {
      const response = await fetchWithAuth(`/api/inventory/warehouses/${encodeURIComponent(warehouse.name)}`, {
        method: 'DELETE'
      })

      if (response.ok || response.status === 202) {
        const data = await response.json()
        // Manejar tanto respuestas con data.success como data: "ok"
        if (data.success || data.data === "ok") {
          showNotification(data.message || 'Warehouse eliminado/deshabilitado exitosamente', 'success')
          await fetchWarehouses()
        } else {
          showNotification(data.message || 'Error al eliminar warehouse', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al eliminar warehouse', 'error')
      }
    } catch (error) {
      console.error('Error deleting warehouse:', error)
      showNotification('Error al eliminar warehouse', 'error')
    }
  }

  // Función para obtener los datos del Fiscal Year
  const fetchFiscalYearDetails = async (fiscalYearName) => {
    try {
      const response = await fetchWithAuth(`/api/fiscal-years/${encodeURIComponent(fiscalYearName)}`)

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setFiscalYearData(data.data)
        } else {
          console.log('Fiscal year request failed')
          setFiscalYearData(null)
        }
      } else {
        console.log('Fiscal year response not ok:', response.status)
        setFiscalYearData(null)
      }
    } catch (err) {
      console.error('Error fetching fiscal year:', err)
      setFiscalYearData(null)
    }
  }

  // Helper to extract a display name for accounts (keeps compatibility)
  const extractAccountName = (account) => {
    if (!account) return ''
    // If account is an object with readable name
    if (typeof account === 'object') {
      const fullName = account.account_name || account.name || ''
      // Extract just the account name from format like "5.1.8.03.00 - Ajuste de Existencia - DELP"
      const parts = fullName.split(' - ')
      return parts.length >= 2 ? parts[1] : fullName
    }
    // If it's a string, extract the readable name from format like "5.1.8.03.00 - Ajuste de Existencia - DELP"
    if (typeof account === 'string') {
      const parts = account.split(' - ')
      return parts.length >= 2 ? parts[1] : account
    }
    return account
  }

  // Helper to get clean account display name for dropdowns
  const getAccountDisplayName = (account) => {
    if (!account) return ''
    const fullName = account.account_name || account.name || ''
    const parts = fullName.split(' - ')
    return parts.length >= 2 ? parts[1] : fullName
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
    // Guardar el nombre legible para mostrar, pero el código real se guarda en un campo separado
    const displayName = getAccountDisplayName(account)
    setEditedData(prev => ({ 
      ...prev, 
      [fieldName]: displayName,
      [`${fieldName}_code`]: account.name 
    }))
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

  // Helper to obtain mesCierre (month) value from fiscalYearData
  const getMesCierreValueFromFiscalYear = () => {
    if (!fiscalYearData) return ''
    const yearEndDate = fiscalYearData.year_end_date
    if (!yearEndDate) return ''
    return yearEndDate.split('-')[1]
  }

  // Update company helper used by save flows
  const updateCompany = async (companyName, data) => {
    if (!companyName) return { success: false, message: 'Empresa no especificada' }
    try {
      setSaving(true)
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          // update local details and refresh header companies
          setActiveCompanyDetails(result.data)
          refreshCompanies()
          showNotification('Empresa actualizada exitosamente', 'success')
          setSuccessMessage(result.message || 'Empresa actualizada correctamente')
          setTimeout(() => setSuccessMessage(null), 3000)
          return { success: true, data: result.data, message: result.message }
        }
        return { success: false, message: result.message || 'Error al actualizar empresa' }
      }

      const err = await response.json().catch(() => ({}))
      return { success: false, message: err.message || 'Error al actualizar empresa' }
    } catch (err) {
      console.error('Error updating company:', err)
      return { success: false, message: 'Error de conexión' }
    } finally {
      setSaving(false)
    }
  }

  // Handler wired from UI buttons
  const handleSaveCompany = async (companyName, data) => {
    // Transformar los datos para enviar códigos en lugar de nombres legibles
    const transformedData = { ...data }
    
    // Para campos de cuentas, usar los códigos en lugar de los nombres legibles
    if (transformedData.default_inventory_account_code) {
      transformedData.default_inventory_account = transformedData.default_inventory_account_code
    }
    if (transformedData.stock_adjustment_account_code) {
      transformedData.stock_adjustment_account = transformedData.stock_adjustment_account_code
    }
    if (transformedData.stock_received_but_not_billed_code) {
      transformedData.stock_received_but_not_billed = transformedData.stock_received_but_not_billed_code
    }
    if (transformedData.default_expense_account_code) {
      transformedData.default_expense_account = transformedData.default_expense_account_code
    }
    if (transformedData.round_off_cost_center_code) {
      transformedData.round_off_cost_center = transformedData.round_off_cost_center_code
    }
    
    const result = await updateCompany(companyName, transformedData)
    if (result.success) {
      // No longer need to reset editing state since it's handled in CustomerSupplierAccounts
    } else {
      setError(result.message)
      setSuccessMessage(null)
    }
  }

  // Función para guardar la configuración de cuentas
  const handleSaveAccountsSettings = async () => {
    try {
      setSaving(true)
      const response = await fetchWithAuth('/api/accounts-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: accountsSettings
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAccountsSettings(data.data)
          showNotification('Configuración de cuentas guardada correctamente', 'success')
        } else {
          showNotification('Error al guardar configuración de cuentas', 'error')
        }
      } else {
        showNotification('Error al guardar configuración de cuentas', 'error')
      }
    } catch (err) {
      console.error('Error saving accounts settings:', err)
      showNotification('Error al guardar configuración de cuentas', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Cargar cuentas de tipo Tax para los selects
  const fetchTaxAccounts = async () => {
    try {
      // Obtener todas las cuentas primero
      const response = await fetchWithAuth(`/api/accounts?limit=500`)
      if (response.ok) {
        const data = await response.json()
        // Filtrar solo las cuentas de tipo Tax del lado del cliente
        const taxAccountsFiltered = (data.data || []).filter(account =>
          account.account_type === "Tax" || account.account_type === "tax"
        )
        setTaxAccounts(taxAccountsFiltered)
      }
    } catch (error) {
      console.error('Error fetching tax accounts:', error)
    }
  }

  // Función para iniciar la edición de un template
  const startEditingTemplate = (template) => {
    setEditingTemplate({
      ...template,
      accounts: template.accounts || []
    })
  }

  // Función para actualizar la cuenta de un impuesto en el template
  const updateTemplateTaxAccount = (accountIndex, accountName) => {
    // Buscar la cuenta completa que corresponde al nombre limpio
    const fullAccount = taxAccounts.find(account => 
      extractCleanAccountName(account) === accountName
    )
    
    // Usar el nombre completo de la cuenta, o el nombre limpio si no se encuentra
    const accountToSave = fullAccount ? (fullAccount.account_name || fullAccount.name) : accountName
    
    setEditingTemplate(prev => {
      const currentAccounts = prev.accounts || []
      // Asegurar que el array tenga al menos accountIndex + 1 elementos
      while (currentAccounts.length <= accountIndex) {
        currentAccounts.push('')
      }
      return {
        ...prev,
        accounts: currentAccounts.map((account, index) =>
          index === accountIndex ? accountToSave : account
        )
      }
    })
  }

  // Función para guardar cambios en template
  const saveTemplateChanges = async () => {
    if (!editingTemplate) return

    try {
      setSaving(true)
      const response = await fetchWithAuth(`/api/tax-templates/${encodeURIComponent(editingTemplate.name)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accounts: editingTemplate.accounts
        })
      })

      if (response.ok) {
        setEditingTemplate(null)
        showNotification('Plantilla de impuesto actualizada correctamente', 'success')
        // Aquí podrías refrescar la lista de templates si fuera necesario
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

  // Función para iniciar la edición
  const startEditing = (company) => {
    console.log('startEditing called with:', company)
    console.log('activeCompanyFromContext:', activeCompanyFromContext)
    console.log('activeCompanyDetails:', activeCompanyDetails)

    setEditingCompany(typeof company === 'string' ? company : company.name)
    setEditedData({
      registration_details: activeCompanyDetails?.registration_details || '',
      phone_no: activeCompanyDetails?.phone_no || '',
      country: activeCompanyDetails?.country || '',
      default_currency: activeCompanyDetails?.default_currency || '',
      company_name: activeCompanyDetails?.company_name || '',
      // Datos fiscales
      tax_id: activeCompanyDetails?.tax_id || activeCompanyDetails?.cuit || '',
      numeroIIBB: activeCompanyDetails?.custom_ingresos_brutos || '',
      cbu: activeCompanyDetails?.cbu || '',
      inscriptoConvenioMultilateral: activeCompanyDetails?.custom_convenio_multilateral || false,
      mesCierreContable: getMesCierreValueFromFiscalYear() || '',
      default_warehouse: activeCompanyDetails?.custom_default_warehouse || '',
      // Removemos abbr ya que no se puede cambiar
    })
    setSuccessMessage(null) // Limpiar mensaje de éxito al iniciar edición
    setError(null) // Limpiar errores previos

    console.log('editingCompany set to:', typeof company === 'string' ? company : company.name)
  }

  // Función para cancelar la edición
  const cancelEditing = () => {
    setEditingCompany(null)
    setEditedData({})
  }

  // Función para manejar cambios en los campos de edición
  const handleEditChange = (field, value) => {
    setEditedData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  // Función para verificar si hay cambios
  const hasChanges = () => {
    if (!editingCompany || !activeCompanyDetails) return false

    return Object.keys(editedData).some(key => {
      // Ignorar campos no editables
      if (['abbr', 'name'].includes(key)) return false
      return editedData[key] !== (activeCompanyDetails[key] || '')
    })
  }

  // Función para guardar los cambios
  const saveChanges = async () => {
    if (!editingCompany) return

    // Filtrar campos que no se pueden editar
    const nonEditableFields = ['abbr', 'name']
    const filteredData = { ...editedData }

    // Remover campos no editables
    nonEditableFields.forEach(field => {
      if (field in filteredData) {
        delete filteredData[field]
      }
    })

    // Si no hay cambios después del filtro, mostrar mensaje
    if (!hasChanges()) {
      setError('No hay cambios para guardar')
      return
    }

    const result = await updateCompany(editingCompany, filteredData)
    if (!result.success) {
      setError(result.message)
      setSuccessMessage(null) // Limpiar mensaje de éxito si hay error
    }
  }

  // Función para eliminar una empresa
  const deleteCompany = async (companyName) => {
    // Mostrar notificación de advertencia y proceder con la eliminación
    showNotification(`Eliminando empresa "${companyName}"...`, 'warning', 2000)

    try {
      setDeletingCompany(companyName)
      setError(null)

      const response = await fetchWithAuth(`/api/companies/${companyName}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Remover la empresa de la lista local
          setCompanies(prevCompanies => prevCompanies.filter(company => company.name !== companyName))

          // Si la empresa eliminada era la activa, limpiar la selección
          if (selectedCompany && selectedCompany.name === companyName) {
            setSelectedCompany(null)
          }

          showNotification('Empresa eliminada correctamente', 'success')
          setSuccessMessage(data.message || 'Empresa eliminada correctamente')
          setTimeout(() => setSuccessMessage(null), 3000)
          return { success: true, message: data.message || 'Empresa eliminada correctamente' }
        } else {
          showNotification(data.message || 'Error al eliminar empresa', 'error')
          return { success: false, message: data.message || 'Error al eliminar empresa' }
        }
      } else if (response.status === 401) {
        showNotification('Sesión expirada. Por favor, vuelve a iniciar sesión.', 'error')
        return { success: false, message: 'Sesión expirada. Por favor, vuelve a iniciar sesión.' }
      } else if (response.status === 403) {
        showNotification('No tienes permisos para eliminar esta empresa', 'error')
        return { success: false, message: 'No tienes permisos para eliminar esta empresa' }
      } else {
        showNotification('Error al conectar con el servidor', 'error')
        return { success: false, message: 'Error al conectar con el servidor' }
      }
    } catch (err) {
      console.error('Error deleting company:', err)
      showNotification('Error de conexión', 'error')
      return { success: false, message: 'Error de conexión' }
    } finally {
      setDeletingCompany(null)
    }
  }

  // Función para crear una nueva empresa
  const createCompany = async (companyData, warehouseData = null) => {
    try {
      setError(null)
      const response = await fetchWithAuth('/api/companies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          data: companyData,
          warehouse: warehouseData
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Agregar la nueva empresa a la lista
          setCompanies(prevCompanies => [...prevCompanies, { name: data.data.name, ...data.data }])
          setSuccessMessage(data.message || 'Empresa creada correctamente')
          setTimeout(() => setSuccessMessage(null), 3000)
          // Refrescar la lista de empresas disponibles en el Header
          refreshCompanies()
          return { success: true }
        } else {
          return { success: false, message: data.message || 'Error al crear empresa' }
        }
      } else if (response.status === 401) {
        return { success: false, message: 'Sesión expirada. Por favor, vuelve a iniciar sesión.' }
      } else if (response.status === 409) {
        return { success: false, message: 'Ya existe una empresa con ese nombre' }
      } else {
        return { success: false, message: 'Error al crear empresa' }
      }
    } catch (err) {
      console.error('Error creating company:', err)
      return { success: false, message: 'Error de conexión' }
    }
  }

  // Función para obtener la configuración de cuentas
  const fetchAccountsSettings = async () => {
    try {
      setLoadingAccountsSettings(true)
      const response = await fetchWithAuth('/api/accounts-settings')

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setAccountsSettings(data.data)
        }
      } else {
        console.error('Error fetching accounts settings:', response.status)
      }
    } catch (err) {
      console.error('Error fetching accounts settings:', err)
    } finally {
      setLoadingAccountsSettings(false)
    }
  }

  return (
    <div className="h-full flex flex-col gap-6">
      {/* Tabs */}
      <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30">
        <TabsNavigation activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Content */}
        <div className="p-8">
          {/* Tab Empresas */}
          {activeTab === 'empresas' && (
            <CompanyTab
              onRequestOpenCompanyAddresses={(companyName) => {
                // handled by this component (lifted state)
                setCompanyAddressModal({ open: true, companyName })
              }}
              // Prop to open the Add Company modal (moved to parent)
              onAddCompanyClick={() => setIsAddCompanyModalOpen(true)}
            />
          )}

          {/* Tab Datos Impositivos */}
          {activeTab === 'datosImpositivos' && (
            <TaxSettings onEditTemplate={startEditingTemplate} />
          )}

                    {/* Tab Configuración Inicial */}
          {activeTab === 'configuracionInicial' && (
            <InitialConfiguration />
          )}

          {/* Tab Clientes/Proveedores */}
          {activeTab === 'clientesProveedores' && (
            <CustomerSupplierAccounts
              onSave={refreshCompanyDetails}
              onOpenExchangeHistory={openExchangeHistoryModal}
              showCustomerGroupModal={showCustomerGroupModal}
              showSupplierGroupModal={showSupplierGroupModal}
              editingGroup={editingGroup}
              groupFormData={groupFormData}
              savingGroup={savingGroup}
              onOpenCustomerGroupModal={openCustomerGroupModal}
              onCloseCustomerGroupModal={closeCustomerGroupModal}
              onOpenSupplierGroupModal={openSupplierGroupModal}
              onCloseSupplierGroupModal={closeSupplierGroupModal}
              onSaveGroup={handleSaveGroup}
              onGroupFormDataChange={setGroupFormData}
              onRequestOpenCalculator={handleOpenCalculator}
            />
          )}

          {/* Tab Talonarios */}
          {activeTab === 'talonarios' && (
            <TalonariosTab
              ref={talonariosTabRef}
              onOpenTalonarioModal={handleOpenTalonarioModal}
            />
          )}

          {/* Tab Tesorería */}
          {activeTab === 'tesoreria' && (
            <TreasuryTab
              activeCompanyFromContext={activeCompanyFromContext}
              activeCompanyDetails={activeCompanyDetails}
              accountsSettings={accountsSettings}
              setAccountsSettings={setAccountsSettings}
              fetchWithAuth={fetchWithAuth}
              showNotification={showNotification}
              editingCompany={editingCompany}
              setEditingCompany={setEditingCompany}
              editedData={editedData}
              setEditedData={setEditedData}
              accountSearchResults={accountSearchResults}
              setAccountSearchResults={setAccountSearchResults}
              showAccountDropdown={showAccountDropdown}
              setShowAccountDropdown={setShowAccountDropdown}
              handleSaveCompany={handleSaveCompany}
              saving={saving}
            />
          )}

          {/* Tab Inventario y Centro de Costos */}
          {activeTab === 'centrosCostos' && (
            <InventoryCostCenters
              activeCompanyDetails={activeCompanyDetails}
              editingCompany={editingCompany}
              editedData={editedData}
              setEditedData={setEditedData}
              setEditingCompany={setEditingCompany}
              handleSaveCompany={handleSaveCompany}
              saving={saving}
              searchAccounts={searchAccounts}
              selectAccount={selectAccount}
              extractAccountName={extractAccountName}
              accountSearchResults={accountSearchResults}
              showAccountDropdown={showAccountDropdown}
              setShowAccountDropdown={setShowAccountDropdown}
              handleAccountInputChange={handleAccountInputChange}
              handleAccountFocus={handleAccountFocus}
              onOpenCostCenterModal={handleOpenCostCenterModal}
              costCenters={costCenters}
              reloadCostCenters={loadCostCenters}
              warehouses={warehouses}
              warehouseTypes={warehouseTypes}
              onReloadWarehouseTypes={fetchWarehouseTypes}
              onOpenWarehouseModal={handleOpenWarehouseModal}
              onDeleteWarehouse={handleDeleteWarehouse}
              itemGroups={mergedItemGroups}
              reloadItemGroups={loadItemGroups}
              onOpenItemGroupModal={handleOpenItemGroupModal}
              onOpenGroupItemsModal={handleOpenGroupItemsModal}
            />
          )}

          {/* Tab Comunicaciones */}
          {activeTab === 'comunicaciones' && (
            <EmailConfiguration
              onOpenEmailAccountModal={handleOpenEmailAccountModal}
              onOpenTestEmailModal={handleOpenTestEmailModal}
              refreshTrigger={emailAccountsRefreshTrigger}
            />
          )}

          {/* Tab Formatos de Documentos */}
          {activeTab === 'formatosDocumentos' && (
            <DocumentFormatsTab
              fetchWithAuth={fetchWithAuth}
              showNotification={showNotification}
            />
          )}

          {/* Tab Integraciones */}
          {activeTab === 'integraciones' && (
            <IntegrationsTab
              fetchWithAuth={fetchWithAuth}
              showNotification={showNotification}
              confirm={confirm}
            />
          )}
        </div>
      </div>

      <ModalsContainer
        // CompanyAddressModal props
        companyAddressModal={companyAddressModal}
        setCompanyAddressModal={setCompanyAddressModal}
        activeCompanyFromContext={activeCompanyFromContext}
        fetchWithAuth={fetchWithAuth}
        fetchAccountsSettings={fetchAccountsSettings}

        // AddCompanyModal props
        isAddCompanyModalOpen={isAddCompanyModalOpen}
        setIsAddCompanyModalOpen={setIsAddCompanyModalOpen}
        newCompany={newCompany}
        handleNewCompanyChange={handleNewCompanyChange}
        handleSearchAfipCompany={handleSearchAfipCompany}
        handleCreateCompany={handleCreateCompany}
        consultingAfip={consultingAfip}

        // TalonarioModal props
        isTalonarioModalOpen={isTalonarioModalOpen}
        handleCloseTalonarioModal={handleCloseTalonarioModal}
        selectedTalonarioForModal={selectedTalonarioForModal}
        handleTalonarioSave={handleTalonarioSave}

        // CostCenterModal props
        isCostCenterModalOpen={isCostCenterModalOpen}
        handleCloseCostCenterModal={handleCloseCostCenterModal}
        newCostCenter={newCostCenter}
        setNewCostCenter={setNewCostCenter}
        handleParentCostCenterInputChange={handleParentCostCenterInputChange}
        showParentDropdown={showParentDropdown}
        setShowParentDropdown={setShowParentDropdown}
        parentCostCenters={parentCostCenters}
        selectParentCostCenter={selectParentCostCenter}
        handleCreateCostCenter={handleCreateCostCenter}
        creatingCostCenter={creatingCostCenter}

        // ItemGroupModal props
        isItemGroupModalOpen={isItemGroupModalOpen}
        handleCloseItemGroupModal={handleCloseItemGroupModal}
        newItemGroup={newItemGroup}
        setNewItemGroup={setNewItemGroup}
        handleParentItemGroupInputChange={handleParentItemGroupInputChange}
        showParentItemGroupDropdown={showParentItemGroupDropdown}
        setShowParentItemGroupDropdown={setShowParentItemGroupDropdown}
        parentItemGroups={parentItemGroups}
        selectParentItemGroup={selectParentItemGroup}
        handleCreateItemGroup={handleCreateItemGroup}
        creatingItemGroup={creatingItemGroup}

        // TaxTemplateModal props
        editingTemplate={editingTemplate}
        setEditingTemplate={setEditingTemplate}
        updateTemplateTaxAccount={updateTemplateTaxAccount}
        saveTemplateChanges={saveTemplateChanges}
        saving={saving}
        taxAccounts={taxAccounts}
        extractCleanAccountName={extractCleanAccountName}
        getAccountDisplayName={getAccountDisplayName}

        // WarehouseModal props
        isWarehouseModalOpen={isWarehouseModalOpen}
        handleCloseWarehouseModal={handleCloseWarehouseModal}
        editingWarehouse={editingWarehouse}
        warehouseFormData={warehouseFormData}
        setWarehouseFormData={setWarehouseFormData}
        handleSaveWarehouse={handleSaveWarehouse}
        savingWarehouse={savingWarehouse}
        warehouseTypes={warehouseTypes}
        warehouses={warehouses}
        activeCompanyDetails={activeCompanyDetails}

        // CustomerGroupModal props
        showCustomerGroupModal={showCustomerGroupModal}
        closeCustomerGroupModal={closeCustomerGroupModal}
        editingGroup={editingGroup}
        groupFormData={groupFormData}
        setGroupFormData={setGroupFormData}
        handleSaveGroup={handleSaveGroup}
        savingGroup={savingGroup}
        customerGroups={customerGroups}
        salesPriceLists={salesPriceLists}
        availableIncomeAccounts={availableIncomeAccounts}
        paymentTermsTemplates={paymentTermsTemplates}
        extractAccountName={extractAccountName}

        // SupplierGroupModal props
        showSupplierGroupModal={showSupplierGroupModal}
        closeSupplierGroupModal={closeSupplierGroupModal}
        supplierGroups={supplierGroups}
        availableExpenseAccounts={availableExpenseAccounts}

        // GroupItemsModal props
        isGroupItemsModalOpen={isGroupItemsModalOpen}
        handleCloseGroupItemsModal={handleCloseGroupItemsModal}
        selectedItemGroups={selectedItemGroups}
        targetParentGroup={targetParentGroup}
        setTargetParentGroup={setTargetParentGroup}
        handleGroupItems={handleGroupItems}
        groupingItems={groupingItems}
        itemGroups={itemGroups}

        // EmailAccountModal props
        isEmailAccountModalOpen={isEmailAccountModalOpen}
        handleCloseEmailAccountModal={handleCloseEmailAccountModal}
        editingEmailAccount={editingEmailAccount}
        setEmailAccountsRefreshTrigger={setEmailAccountsRefreshTrigger}
        showNotification={showNotification}

        // TestEmailModal props
        testEmailModalData={testEmailModalData}
        handleCloseTestEmailModal={handleCloseTestEmailModal}
        handleTestEmail={handleTestEmail}
        testingEmail={testingEmail}
        // ExchangeRateHistoryModal props
        isExchangeHistoryOpen={isExchangeHistoryOpen}
        closeExchangeHistoryModal={closeExchangeHistoryModal}
        exchangeHistoryCurrency={exchangeHistoryCurrency}
        onExchangeHistorySaved={() => {
          // Refresh price lists or currency-related data if necessary
          loadPriceLists()
        }}
      />

      <CalculatorModal
        isOpen={showCalculatorModal}
        onClose={handleCloseCalculator}
        onApplyFormula={(formula) => handleApplyCalculator(formula)}
        currentItemsCount={0}
        mode="sales"
        contextType={calculatorContext}
        initialFormula={calculatorInitialFormula}
      />

      <ConfirmDialog />
    </div>
  )
}

export default ConfigurationSettings
