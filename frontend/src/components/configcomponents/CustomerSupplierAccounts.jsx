import React, { useState, useContext, useEffect, useRef } from 'react'
import { Users, Edit, Save, Plus, Trash2, X, FolderOpen, Folder, Info, Calculator } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'
import API_ROUTES from '../../apiRoutes'
import usePriceListAutomation from '../../hooks/usePriceListAutomation'
import Select from 'react-select'
import ExchangeRateHistoryModal from './ExchangeRateHistoryModal'

const CustomerSupplierAccounts = ({ 
  onSave,
  showCustomerGroupModal,
  showSupplierGroupModal,
  editingGroup,
  groupFormData,
  savingGroup,
  onOpenCustomerGroupModal,
  onCloseCustomerGroupModal,
  onOpenSupplierGroupModal,
  onCloseSupplierGroupModal,
  onSaveGroup,
  onGroupFormDataChange
  , onRequestOpenCalculator,
  onOpenExchangeHistory
}) => {
  const { fetchWithAuth, activeCompany: activeCompanyFromContext } = useContext(AuthContext)
  const { showNotification } = useNotification()
  const { confirm, ConfirmDialog } = useConfirm()

  const [activeCompanyDetails, setActiveCompanyDetails] = useState(null)
  const [editingCompany, setEditingCompany] = useState(null)
  const [editedData, setEditedData] = useState({})
  const [saving, setSaving] = useState(false)

  // Estados para listas de cuentas disponibles
  const [availableAssetAccounts, setAvailableAssetAccounts] = useState([])
  const [availableLiabilityAccounts, setAvailableLiabilityAccounts] = useState([])
  const [availableIncomeAccounts, setAvailableIncomeAccounts] = useState([])
  const [availableExpenseAccounts, setAvailableExpenseAccounts] = useState([])

  // Estados para condiciones de pago
  const [paymentTermsTemplates, setPaymentTermsTemplates] = useState([])
  const [loadingPaymentTerms, setLoadingPaymentTerms] = useState(false)

  // Estados para grupos de clientes y proveedores
  const [customerGroups, setCustomerGroups] = useState([])
  const [supplierGroups, setSupplierGroups] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(false)

  // Estados para listas de precios
  const [salesPriceLists, setSalesPriceLists] = useState([])
  const [purchasePriceLists, setPurchasePriceLists] = useState([])
  const [loadingPriceLists, setLoadingPriceLists] = useState(false)

  // Exchange rate UI state
  const [currencies, setCurrencies] = useState([])
  const [loadingCurrencies, setLoadingCurrencies] = useState(false)
  const [exchangeCurrency, setExchangeCurrency] = useState(null)
  const [exchangeRateValue, setExchangeRateValue] = useState('')
  const [exchangeDate, setExchangeDate] = useState(new Date().toISOString().slice(0,10))
  const [savingExchange, setSavingExchange] = useState(false)
  const [isLoadingExchangeRate, setIsLoadingExchangeRate] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  // Price list automation state
  const [automationEnabled, setAutomationEnabled] = useState(false)
  const [priceListAutomationConfig, setPriceListAutomationConfig] = useState({})
  const [loadingAutomationConfig, setLoadingAutomationConfig] = useState(false)
  const [savingAutomationConfig, setSavingAutomationConfig] = useState(false)
  // Hook helper for persisting automation settings to /settings endpoints
  const { saveGlobalSettings, savePriceListSettings } = usePriceListAutomation()

  // (Calculator modal is rendered by parent ConfigurationSettings to avoid stacking issues)

  // Estados para edición inline de grupos
  const [editingCustomerGroup, setEditingCustomerGroup] = useState(null)
  const [editingSupplierGroup, setEditingSupplierGroup] = useState(null)
  const [customerGroupData, setCustomerGroupData] = useState({})
  const [supplierGroupData, setSupplierGroupData] = useState({})
  const [savingGroupSettings, setSavingGroupSettings] = useState(false)

  // Cargar detalles de la empresa activa
  useEffect(() => {
    if (activeCompanyFromContext) {
      fetchCompanyDetails(activeCompanyFromContext)
      fetchAvailableAccounts()
      loadGroups()
      loadPriceLists()
      fetchCurrencies()
      fetchAutomationConfig()
    }
  }, [activeCompanyFromContext])

  // Listen for exchangeRateUpdated events (emitted by dashboard widget) to refresh related data
  useEffect(() => {
    const handler = (e) => {
      // Refresh currencies and automation config to reflect any changes
      fetchCurrencies()
      fetchAutomationConfig()
      if (activeCompanyFromContext) fetchCompanyDetails(activeCompanyFromContext)
    }
    window.addEventListener('exchangeRateUpdated', handler)
    return () => window.removeEventListener('exchangeRateUpdated', handler)
  }, [activeCompanyFromContext])

  // Función para procesar la jerarquía de grupos correctamente
  const processGroupHierarchy = (groups, type) => {
    const nameField = 'name'
    const parentField = 'old_parent'
    
    // Crear un mapa para acceso rápido
    const groupMap = {}
    groups.forEach(group => {
      groupMap[group.name] = { ...group }
    })
    
    // Identificar grupos raíz (top-level) sin hardcodeos
    const rootGroups = groups.filter(g => !g[parentField])
    if (rootGroups.length === 0) {
      console.error(`No se encontró ningún grupo raíz para ${type} (no hay registros sin padre)`)
    } else {
      console.log(`Grupos raíz para ${type}: ${rootGroups.length}`, rootGroups.map(g => g[nameField]))
    }

    // Asegurar que los grupos raíz no tengan padre
    rootGroups.forEach(root => {
      root[parentField] = null
    })
    
    // Corregir referencias a padres que no existen - REMOVER FALLBACK
    groups.forEach(group => {
      if (group[parentField] && !groupMap[group[parentField]]) {
        console.error(`Grupo ${group[nameField]} tiene padre inexistente: ${group[parentField]} - REMOVIENDO REFERENCIA INVÁLIDA`)
        delete group[parentField] // En lugar de asignar a raíz, eliminar la referencia inválida
      }
    })
    
    return groups
  }

      // Cargar grupos de clientes y proveedores
      const loadGroups = async () => {
        try {
          setLoadingGroups(true)

          // Cargar grupos de clientes (sin hardcodear limit_page_length)
          const customerResponse = await fetchWithAuth('/api/customer-groups')
          if (customerResponse.ok) {
            const customerData = await customerResponse.json()
            console.log('Datos de customer groups del backend:', customerData.data)
            if (customerData.success) {
              // Procesar jerarquía correctamente
              const processedCustomerGroups = processGroupHierarchy(customerData.data, 'customer')
              console.log('Grupos de clientes procesados:', processedCustomerGroups)
              setCustomerGroups(processedCustomerGroups)
            } else {
              console.error('Error en respuesta de customer groups:', customerData)
            }
          } else {
            console.error('Error HTTP cargando customer groups:', customerResponse.status)
          }

          // Cargar grupos de proveedores (sin hardcodear limit_page_length)
          const supplierResponse = await fetchWithAuth('/api/supplier-groups')
          if (supplierResponse.ok) {
            const supplierData = await supplierResponse.json()
            console.log('Datos de supplier groups del backend:', supplierData.data)
            if (supplierData.success) {
              // Procesar jerarquía correctamente
              const processedSupplierGroups = processGroupHierarchy(supplierData.data, 'supplier')
              console.log('Grupos de proveedores procesados:', processedSupplierGroups)
              setSupplierGroups(processedSupplierGroups)
            } else {
              console.error('Error en respuesta de supplier groups:', supplierData)
            }
          } else {
            console.error('Error HTTP cargando supplier groups:', supplierResponse.status)
          }
        } catch (error) {
          console.error('Error loading groups:', error)
          showNotification('Error al cargar los grupos', 'error')
        } finally {
          setLoadingGroups(false)
        }
      }

  // Función para cargar listas de precios
  const loadPriceLists = async () => {
    try {
      setLoadingPriceLists(true)

      // Cargar listas de precios de venta
      const salesResponse = await fetchWithAuth('/api/sales-price-lists')
      if (salesResponse.ok) {
        const salesData = await salesResponse.json()
        if (salesData.success) {
          setSalesPriceLists(salesData.data || [])
        }
      }

      // Cargar listas de precios de compra
      const purchaseResponse = await fetchWithAuth('/api/inventory/purchase-price-lists/all')
      if (purchaseResponse.ok) {
        const purchaseData = await purchaseResponse.json()
        if (purchaseData.success) {
          setPurchasePriceLists(purchaseData.data || [])
        }
      }
    } catch (error) {
      console.error('Error loading price lists:', error)
    } finally {
      setLoadingPriceLists(false)
    }
  }

  // Cargar monedas disponibles
  const fetchCurrencies = async () => {
    try {
      setLoadingCurrencies(true)
      const resp = await fetchWithAuth('/api/currencies')
      if (resp.ok) {
        const data = await resp.json()
        if (data.success) setCurrencies(data.data || [])
      }
    } catch (err) {
      console.error('Error fetching currencies:', err)
    } finally {
      setLoadingCurrencies(false)
    }
  }

  // Cargar configuración de automatización de listas de precios
  const fetchAutomationConfig = async () => {
    if (!activeCompanyFromContext) return
    try {
      setLoadingAutomationConfig(true)
      // Use the canonical settings endpoint which returns price_lists with their fields
      const url = `${API_ROUTES.priceListAutomation.settings}?type=sales`
      const resp = await fetchWithAuth(url)
      if (resp.ok) {
        const data = await resp.json()
        if (data.success) {
          // backend returns { success: true, data: { price_lists: [...] } }
          setAutomationEnabled(Boolean(data.data?.enabled))
          const cfg = {}
          const lists = data.data?.price_lists || data.data?.lists || []
          lists.forEach(l => {
            // Key by the internal name (l.name) so it matches pl.name used in the Price Lists array
            const key = l.name || l.price_list_name
            cfg[key] = {
              enabled: !!(l.auto_update_enabled || l.enabled),
              formula: l.auto_update_formula || l.formula || '',
              last_updated_by: l.last_updated_by || null,
              last_updated_at: l.last_updated_at || null
            }
          })
          setPriceListAutomationConfig(cfg)
        }
      }
    } catch (err) {
      console.error('Error fetching automation config:', err)
    } finally {
      setLoadingAutomationConfig(false)
    }
  }

  const openCalculatorFor = (priceListName) => {
    // Delegate opening calculator to parent so the modal is mounted at a higher level
    const cfg = priceListAutomationConfig[priceListName] || { formula: '' }
    if (typeof onRequestOpenCalculator === 'function') {
      onRequestOpenCalculator(priceListName, cfg.formula || '', async (formula) => {
        // callback from parent when modal Apply is clicked
        setPriceListAutomationConfig(prev => ({
          ...prev,
          [priceListName]: {
            ...(prev[priceListName] || {}),
            formula: formula || ''
          }
        }))

        // Persist formula immediately to backend for this price list
        try {
          await savePriceListSettings(priceListName, { formula })
          showNotification('Fórmula guardada en la lista de precios', 'success')
        } catch (err) {
          console.error('Error saving formula for price list:', err)
          showNotification(err?.message || 'Error guardando la fórmula en backend', 'error')
        }
      }, 'autoPriceList')
    }
  }

  const applyFormula = (formula) => {
    // kept for compatibility if ever used locally; prefer parent-managed modal
    return
  }

  const handleTogglePriceList = (priceListName) => {
    const cfg = priceListAutomationConfig[priceListName] || { formula: '' }
    const willEnable = !((cfg || {}).enabled)
    // Validation: cannot enable automation for a price list without a formula
    if (willEnable && !(cfg.formula && cfg.formula.trim())) {
      showNotification('No se puede activar la automatización sin una fórmula para esta lista de precios', 'error')
      return
    }
    setPriceListAutomationConfig(prev => ({
      ...prev,
      [priceListName]: {
        ...(prev[priceListName] || {}),
        enabled: !((prev[priceListName] || {}).enabled)
      }
    }))
  }

  const handleToggleGlobal = (checked) => {
    // If enabling global automation make sure at least one price list has a formula
    if (checked) {
      const anyWithFormula = Object.values(priceListAutomationConfig).some(cfg => cfg && cfg.formula && cfg.formula.trim())
      if (!anyWithFormula) {
        showNotification('No se puede activar la automatización global sin al menos una fórmula definida en alguna lista de precios', 'error')
        return
      }
    }
    setAutomationEnabled(checked)
  }

  const saveAutomationConfig = async () => {
    if (!activeCompanyFromContext) return
    try {
      setSavingAutomationConfig(true)

      // Validate global toggle: if enabled, ensure at least one formula exists
      if (automationEnabled) {
        const anyWithFormula = Object.values(priceListAutomationConfig).some(cfg => cfg && cfg.formula && cfg.formula.trim())
        if (!anyWithFormula) {
          showNotification('No se puede activar la automatización global sin al menos una fórmula definida en alguna lista de precios', 'error')
          setSavingAutomationConfig(false)
          return
        }
      }

      const priceListsPayload = Object.keys(priceListAutomationConfig).map(name => ({
        name,
        auto_update_enabled: !!priceListAutomationConfig[name].enabled,
        formula: priceListAutomationConfig[name].formula || ''
      }))

      // Use centralized hook which talks to /api/price-list-automation/settings
      await saveGlobalSettings(automationEnabled, priceListsPayload)
      showNotification('Configuración de automatización guardada', 'success')
    } catch (err) {
      console.error('Error saving automation config:', err)
      showNotification(err?.message || 'Error guardando configuración', 'error')
    } finally {
      setSavingAutomationConfig(false)
    }
  }

  const saveExchangeRate = async () => {
    try {
      setSavingExchange(true)
      // Backend expects: from_currency, to_currency, exchange_rate, date
      const payload = {
        from_currency: exchangeCurrency?.name || exchangeCurrency?.code || exchangeCurrency,
        to_currency: activeCompanyDetails?.default_currency || '',
        exchange_rate: Number(exchangeRateValue) || 0,
        date: exchangeDate
      }
      const resp = await fetchWithAuth(API_ROUTES.currencyExchange.upsert, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (resp.ok) {
        const data = await resp.json()
        if (data.success) showNotification('Tipo de cambio guardado y sincronizado con el dashboard', 'success')
        else showNotification(data.message || 'Error guardando tipo de cambio', 'error')
      } else {
        const err = await resp.json()
        showNotification(err.message || 'Error guardando tipo de cambio', 'error')
      }
    } catch (err) {
      console.error('Error saving exchange rate:', err)
      showNotification('Error de conexión', 'error')
    } finally {
      setSavingExchange(false)
    }
  }

  // Fetch Exchange Rates (ERPNext) for a currency and populate the exchange input
  const handleFetchExchangeRate = async (currency) => {
    if (!currency) return showNotification('Seleccione una moneda', 'error')
    const companyCurrency = (activeCompanyDetails?.default_currency || '').toUpperCase()
    if (!companyCurrency) return showNotification('La empresa no tiene moneda por defecto definida', 'error')
    if ((currency || '').toUpperCase() === companyCurrency) return showNotification(`${companyCurrency} tiene cotización 1`, 'info')

    try {
      setIsLoadingExchangeRate(true)
      const resp = await fetchWithAuth(`${API_ROUTES.currencyExchange.latest(currency)}&to=${encodeURIComponent(companyCurrency)}`)
      const data = await (resp && resp.json ? resp.json().catch(() => ({})) : Promise.resolve({}))
      if (!resp || !resp.ok || data?.success === false) {
        throw new Error(data?.message || `Error HTTP ${resp ? resp.status : 'no-response'}`)
      }
      const rate = data?.data?.exchange_rate
      if (!(Number(rate) > 0)) {
        throw new Error(`No hay cotización cargada para ${currency}/${companyCurrency}`)
      }
      setExchangeRateValue(String(rate))
      setExchangeDate(data?.data?.date || new Date().toISOString().slice(0, 10))
      showNotification(`Cotización ${currency}/${companyCurrency} actualizada`, 'success')
    } catch (err) {
      console.error('Error fetching exchange rate:', err)
      showNotification(err?.message || 'Error al obtener la cotización', 'error')
    } finally {
      setIsLoadingExchangeRate(false)
    }
  }

  // Función para obtener detalles de la empresa
  const fetchCompanyDetails = async (companyName) => {
    try {
      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(companyName)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setActiveCompanyDetails(data.data)
        }
      }
    } catch (error) {
      console.error('Error fetching company details:', error)
    }
  }

  // Función para obtener cuentas disponibles
  const fetchAvailableAccounts = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.accounts)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Filtrar cuentas por cobrar (account_type = "Receivable")
          const receivableAccounts = data.data.filter(account => 
            account.account_type === 'Receivable' && 
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          )
          setAvailableAssetAccounts(receivableAccounts || [])
          
          // Filtrar cuentas por pagar (account_type = "Payable")
          const payableAccounts = data.data.filter(account => 
            account.account_type === 'Payable' && 
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          )
          setAvailableLiabilityAccounts(payableAccounts || [])
          
          // Filtrar cuentas de ingresos (para cuentas de ingresos)
          const incomeAccounts = data.data.filter(account => 
            account.root_type === 'Income' && 
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          )
          setAvailableIncomeAccounts(incomeAccounts || [])

          // Filtrar cuentas de gastos (para proveedores)
          const expenseAccounts = data.data.filter(account => 
            (account.root_type === 'Expense' || account.account_type === 'Stock') && 
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          )
          setAvailableExpenseAccounts(expenseAccounts || [])
        }
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
  }

  // Función para extraer el nombre de cuenta
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

  // Función para guardar los cambios
  const handleSave = async () => {
    try {
      setSaving(true)

      const dataToSave = {
        default_receivable_account: editedData.default_receivable_account_code || editedData.default_receivable_account,
        default_payable_account: editedData.default_payable_account_code || editedData.default_payable_account,
        default_income_account: editedData.default_income_account_code || editedData.default_income_account
        // default_payment_terms removido - se maneja a nivel de grupos
      }

      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(editingCompany)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: dataToSave })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Cuentas de clientes y proveedores actualizadas correctamente', 'success')
          setEditingCompany(null)
          setEditedData({})
          // Recargar detalles de la empresa
          await fetchCompanyDetails(activeCompanyFromContext)
          // Notificar al componente padre
          if (onSave) onSave()
        } else {
          showNotification(`Error: ${data.message}`, 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(`Error: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('Error saving accounts:', error)
      showNotification('Error de conexión', 'error')
    } finally {
      setSaving(false)
    }
  }

  const startEditing = () => {
    setEditingCompany(activeCompanyFromContext)
    setEditedData({
      default_receivable_account: extractAccountName(activeCompanyDetails?.default_receivable_account) || '',
      default_receivable_account_code: activeCompanyDetails?.default_receivable_account || '',
      default_payable_account: extractAccountName(activeCompanyDetails?.default_payable_account) || '',
      default_payable_account_code: activeCompanyDetails?.default_payable_account || '',
      default_income_account: extractAccountName(activeCompanyDetails?.default_income_account) || '',
      default_income_account_code: activeCompanyDetails?.default_income_account || ''
      // default_payment_terms removido - se maneja a nivel de grupos
    })
  }

  const cancelEditing = () => {
    setEditingCompany(null)
    setEditedData({})
  }

  // Funciones para manejar grupos - ACTUALIZADAS PARA USAR PROPS
  const handleDeleteGroup = async (group, isCustomer = true) => {
    const confirmed = await confirm({
      title: 'Eliminar Grupo',
      message: `¿Estás seguro de que quieres eliminar el grupo "${group.name}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'error'
    })

    if (!confirmed) {
      return
    }

    try {
      const endpoint = isCustomer ? API_ROUTES.customerGroups : API_ROUTES.supplierGroups
      const response = await fetchWithAuth(`${endpoint}/${group.name}`, {
        method: 'DELETE'
      })

      if (response.ok || response.status === 202) {
        const result = await response.json()
        if (result.success) {
          showNotification(`Grupo ${isCustomer ? 'de clientes' : 'de proveedores'} eliminado correctamente`, 'success')
          loadGroups() // Recargar grupos
        } else {
          showNotification(result.message || 'Error al eliminar el grupo', 'error')
        }
      } else {
        const errorData = await response.json()
        let errorMessage = errorData.message || 'Error al eliminar el grupo'
        
        // Mejorar mensajes de error específicos
        if (errorData.message && errorData.message.includes('Cannot delete or cancel because')) {
          if (errorData.message.includes('is linked with')) {
            errorMessage = 'No se puede eliminar el grupo porque tiene clientes/proveedores asociados. Primero debe reasignar o eliminar los registros asociados.'
          } else if (errorData.message.includes('has child nodes')) {
            errorMessage = 'No se puede eliminar el grupo porque tiene subgrupos. Primero debe eliminar o reasignar los subgrupos.'
          }
        }
        
        showNotification(errorMessage, 'error')
      }
    } catch (error) {
      console.error('Error deleting group:', error)
      showNotification('Error de conexión', 'error')
    }
  }

  // Funciones para edición inline de grupos
  const startEditingCustomerGroup = (group) => {
    setEditingCustomerGroup(group.name)
    setCustomerGroupData({
      payment_terms: group.payment_terms || '',
      default_price_list: group.default_price_list || ''
    })
  }

  const startEditingSupplierGroup = (group) => {
    setEditingSupplierGroup(group.name)
    setSupplierGroupData({
      payment_terms: group.payment_terms || '',
      default_price_list: group.default_price_list || ''
    })
  }

  const cancelEditingCustomerGroup = () => {
    setEditingCustomerGroup(null)
    setCustomerGroupData({})
  }

  const cancelEditingSupplierGroup = () => {
    setEditingSupplierGroup(null)
    setSupplierGroupData({})
  }

  const handleSaveCustomerGroupSettings = async (group) => {
    try {
      setSavingGroupSettings(true)

      const data = {
        data: {
          payment_terms: customerGroupData.payment_terms || null,
          default_price_list: customerGroupData.default_price_list || null
        }
      }

      const response = await fetchWithAuth(`${API_ROUTES.customerGroups}/${group.name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          showNotification('Configuración del grupo de clientes guardada correctamente', 'success')
          setEditingCustomerGroup(null)
          setCustomerGroupData({})
          loadGroups() // Recargar grupos
        } else {
          showNotification(result.message || 'Error al guardar la configuración', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al guardar la configuración', 'error')
      }
    } catch (error) {
      console.error('Error saving customer group settings:', error)
      showNotification('Error de conexión', 'error')
    } finally {
      setSavingGroupSettings(false)
    }
  }

  const handleOpenCustomerGroupModal = async (group) => {
    try {
      const response = await fetchWithAuth('/api/resource/Customer Group/' + group.name)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          console.log('Datos completos del grupo de clientes:', data.data)
          onOpenCustomerGroupModal && onOpenCustomerGroupModal(data.data)
        } else {
          showNotification('Error al obtener datos del grupo', 'error')
        }
      } else {
        showNotification('Error al obtener datos del grupo', 'error')
      }
    } catch (error) {
      console.error('Error fetching group details:', error)
      showNotification('Error de conexión', 'error')
    }
  }

  const handleOpenSupplierGroupModal = async (group) => {
    try {
      const response = await fetchWithAuth('/api/resource/Supplier Group/' + group.name)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          console.log('Datos completos del grupo de proveedores:', data.data)
          onOpenSupplierGroupModal && onOpenSupplierGroupModal(data.data)
        } else {
          showNotification('Error al obtener datos del grupo', 'error')
        }
      } else {
        showNotification('Error al obtener datos del grupo', 'error')
      }
    } catch (error) {
      console.error('Error fetching group details:', error)
      showNotification('Error de conexión', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
          <Users className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Clientes y Proveedores</h2>
          <p className="text-gray-600 font-medium">Cuentas contables y configuración de grupos para clientes y proveedores</p>
        </div>
      </div>

      {/* Contenido principal */}
      {/* Sección de Cuentas Contables */}
      {activeCompanyFromContext && (
        <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50 mb-8">
          {editingCompany === activeCompanyFromContext ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Cuentas a Cobrar:</label>
                  <Select
                    value={availableAssetAccounts.find(acc => acc.name === editedData.default_receivable_account_code) ?
                      { value: editedData.default_receivable_account_code, label: extractAccountName(availableAssetAccounts.find(acc => acc.name === editedData.default_receivable_account_code)) } : null}
                    onChange={(selectedOption) => {
                      setEditedData(prev => ({
                        ...prev,
                        default_receivable_account: selectedOption ? extractAccountName(availableAssetAccounts.find(acc => acc.name === selectedOption.value)) : '',
                        default_receivable_account_code: selectedOption ? selectedOption.value : ''
                      }))
                    }}
                    options={availableAssetAccounts.map((account) => ({
                      value: account.name,
                      label: extractAccountName(account)
                    }))}
                    placeholder="Seleccionar cuenta..."
                    isClearable
                    isSearchable
                    className="w-full"
                    classNamePrefix="react-select"
                    styles={{
                      control: (provided, state) => ({
                        ...provided,
                        border: '1px solid #d1d5db',
                        borderRadius: '0.5rem',
                        padding: '0.125rem',
                        '&:hover': {
                          borderColor: '#3b82f6'
                        },
                        boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                      }),
                      option: (provided, state) => ({
                        ...provided,
                        backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                        color: state.isSelected ? 'white' : '#374151'
                      }),
                      menu: (provided) => ({
                        ...provided,
                        zIndex: 99999
                      }),
                      menuPortal: (provided) => ({
                        ...provided,
                        zIndex: 99999
                      })
                    }}
                    menuPortalTarget={document.body}
                  />
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Cuentas a Pagar:</label>
                  <Select
                    value={availableLiabilityAccounts.find(acc => acc.name === editedData.default_payable_account_code) ? 
                      { value: editedData.default_payable_account_code, label: extractAccountName(availableLiabilityAccounts.find(acc => acc.name === editedData.default_payable_account_code)) } : null}
                    onChange={(selectedOption) => {
                      setEditedData(prev => ({
                        ...prev,
                        default_payable_account: selectedOption ? extractAccountName(availableLiabilityAccounts.find(acc => acc.name === selectedOption.value)) : '',
                        default_payable_account_code: selectedOption ? selectedOption.value : ''
                      }))
                    }}
                    options={availableLiabilityAccounts.map((account) => ({
                      value: account.name,
                      label: extractAccountName(account)
                    }))}
                    placeholder="Seleccionar cuenta..."
                    isClearable
                    isSearchable
                    className="w-full"
                    classNamePrefix="react-select"
                    styles={{
                      control: (provided, state) => ({
                        ...provided,
                        border: '1px solid #d1d5db',
                        borderRadius: '0.5rem',
                        padding: '0.125rem',
                        '&:hover': {
                          borderColor: '#3b82f6'
                        },
                        boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                      }),
                      option: (provided, state) => ({
                        ...provided,
                        backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                        color: state.isSelected ? 'white' : '#374151'
                      }),
                      menu: (provided) => ({
                        ...provided,
                        zIndex: 99999
                      }),
                      menuPortal: (provided) => ({
                        ...provided,
                        zIndex: 99999
                      })
                    }}
                    menuPortalTarget={document.body}
                  />
                </div>
              </div>

              {/* Campo para cuenta de ingresos por defecto */}
              <div>
                <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Ingresos por Defecto:</label>
                <Select
                  value={availableIncomeAccounts.find(acc => acc.name === editedData.default_income_account_code) ?
                    { value: editedData.default_income_account_code, label: extractAccountName(availableIncomeAccounts.find(acc => acc.name === editedData.default_income_account_code)) } : null}
                  onChange={(selectedOption) => {
                    setEditedData(prev => ({
                      ...prev,
                      default_income_account: selectedOption ? extractAccountName(availableIncomeAccounts.find(acc => acc.name === selectedOption.value)) : '',
                      default_income_account_code: selectedOption ? selectedOption.value : ''
                    }))
                  }}
                  options={availableIncomeAccounts.map((account) => ({
                    value: account.name,
                    label: extractAccountName(account)
                  }))}
                  placeholder="Seleccionar cuenta..."
                  isClearable
                  isSearchable
                  className="w-full"
                  classNamePrefix="react-select"
                  styles={{
                    control: (provided, state) => ({
                      ...provided,
                      border: '1px solid #d1d5db',
                      borderRadius: '0.5rem',
                      padding: '0.125rem',
                      '&:hover': {
                        borderColor: '#3b82f6'
                      },
                      boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                    }),
                    option: (provided, state) => ({
                      ...provided,
                      backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                      color: state.isSelected ? 'white' : '#374151'
                    }),
                    menu: (provided) => ({
                      ...provided,
                      zIndex: 99999
                    }),
                    menuPortal: (provided) => ({
                      ...provided,
                      zIndex: 99999
                    })
                  }}
                  menuPortalTarget={document.body}
                />
              </div>

              {/* Campo de condición de pago por defecto - REMOVIDO */}
              {/* Se maneja ahora a nivel de grupos */}

              <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                <button
                  onClick={cancelEditing}
                  className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
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
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white/60 rounded-lg p-4 border border-gray-200">
                    <h4 className="font-bold text-gray-900 mb-2">Cuenta de Cuentas a Cobrar</h4>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Cuenta asignada</label>
                        <p className="text-sm font-bold text-gray-900">{extractAccountName(activeCompanyDetails?.default_receivable_account) || 'No disponible'}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Tipo</label>
                        <p className="text-sm font-bold text-gray-900">Activo</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-4 border border-gray-200">
                    <h4 className="font-bold text-gray-900 mb-2">Cuenta de Cuentas a Pagar</h4>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Cuenta asignada</label>
                        <p className="text-sm font-bold text-gray-900">{extractAccountName(activeCompanyDetails?.default_payable_account) || 'No disponible'}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Tipo</label>
                        <p className="text-sm font-bold text-gray-900">Pasivo</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mostrar cuenta de ingresos por defecto */}
                <div className="mt-6 bg-white/60 rounded-lg p-4 border border-gray-200">
                  <h4 className="font-bold text-gray-900 mb-2">Cuenta de Ingresos por Defecto</h4>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Cuenta asignada</label>
                      <p className="text-sm font-bold text-gray-900">{extractAccountName(activeCompanyDetails?.default_income_account) || 'No disponible'}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Tipo</label>
                      <p className="text-sm font-bold text-gray-900">Ingreso</p>
                    </div>
                  </div>
                </div>

                {/* Mostrar condición de pago por defecto - REMOVIDO */}
                {/* Se maneja ahora a nivel de grupos */}
              </div>
              <div className="flex flex-col space-y-2 ml-4">
                <button
                  onClick={startEditing}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                  title="Editar cuentas de clientes/proveedores"
                >
                  <Edit className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tasas de cambio generales */}
      {activeCompanyFromContext && (
        <div className="bg-gradient-to-r from-blue-50/80 to-blue-100/80 rounded-2xl p-6 border border-blue-200/50 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-black text-gray-900">Tasas de cambio generales</h3>
              <p className="text-sm text-gray-600">Sincroniza el tipo de cambio general usado en el dashboard</p>
            </div>
            <div className="text-sm text-gray-500">Tip: el valor se sincroniza con el dashboard</div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="bg-white rounded-lg p-4 border border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Moneda</label>
                <Select
                  value={exchangeCurrency ? { value: exchangeCurrency.name || exchangeCurrency.code, label: exchangeCurrency.currency_name || exchangeCurrency.name || exchangeCurrency } : null}
                  onChange={(opt) => {
                    const cur = currencies.find(c => c.name === opt?.value || c.code === opt?.value) || { name: opt?.value }
                    setExchangeCurrency(cur)
                  }}
                  options={currencies.map(c => ({ value: c.name || c.code, label: `${c.currency_name || c.name} (${c.symbol || c.name})` }))}
                  placeholder="Seleccionar moneda..."
                  isClearable
                  isSearchable
                  classNamePrefix="react-select"
                  menuPortalTarget={document.body}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de cambio</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={exchangeRateValue}
                    onChange={e => setExchangeRateValue(e.target.value)}
                    className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    onClick={() => handleFetchExchangeRate(exchangeCurrency?.name || exchangeCurrency?.code)}
                    disabled={isLoadingExchangeRate}
                    className="inline-flex items-center justify-center w-9 h-9 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded-lg transition-colors duration-200 exchange-rate-btn"
                    title="Obtener cotización del BCRA"
                    style={{ minWidth: '36px', minHeight: '36px' }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-4 h-4 ${isLoadingExchangeRate ? 'animate-spin' : ''}`}>
                      <path d="M12 15V3"></path>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <path d="m7 10 5 5 5-5"></path>
                    </svg>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Fecha efectiva</label>
                <input
                  type="date"
                  value={exchangeDate}
                  onChange={e => setExchangeDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400"
                />
              </div>

              <div className="flex items-end justify-end">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      // Require a selected currency — be strict and explicit
                      const cur = exchangeCurrency?.name || exchangeCurrency?.code || (exchangeCurrency && (exchangeCurrency.value || exchangeCurrency))
                      if (!cur) {
                        showNotification('Seleccione una moneda antes de abrir el historial', 'error')
                        return
                      }
                      // Prefer parent-provided opener; fall back to local modal for backwards compatibility
                      if (typeof onOpenExchangeHistory === 'function') {
                        onOpenExchangeHistory(cur)
                      } else {
                        setIsHistoryOpen(true)
                      }
                    }}
                    className="btn-secondary"
                    title="Historial de cotizaciones"
                  >
                    Historial
                  </button>
                  <button
                    onClick={saveExchangeRate}
                    disabled={savingExchange}
                    className="btn-action-primary"
                  >
                    {savingExchange ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sección Listas de precios automáticas */}
  <div className="bg-gradient-to-r from-blue-50/80 to-blue-100/80 rounded-2xl p-6 border border-blue-200/50 mb-6">
          <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-black text-gray-900">Listas de precios automáticas</h3>
            <p className="text-sm text-gray-600">Automatiza la actualización de listas de precios de venta</p>
          </div>
          <div className="flex items-center space-x-3">
            <label className="text-sm text-gray-500">Automatización global</label>
            <label className="inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only" checked={automationEnabled} onChange={e => handleToggleGlobal(e.target.checked)} />
              <span className={`toggle-switch ${automationEnabled ? 'on' : ''}`}></span>
            </label>
          </div>
        </div>

  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 max-h-72 overflow-y-auto">
          {loadingPriceLists || loadingAutomationConfig ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="space-y-2">
              {salesPriceLists.length === 0 ? (
                <div className="text-sm text-gray-500">No hay listas de precios de venta</div>
              ) : (
                salesPriceLists.map(pl => {
                  const cfg = priceListAutomationConfig[pl.name] || { enabled: false, formula: '' }
                  return (
                    <div key={pl.name} className="flex items-center justify-between p-3 border border-gray-100 rounded-md bg-white">
                      <div className="flex items-center space-x-3">
                        <input type="checkbox" checked={!!cfg.enabled} onChange={() => handleTogglePriceList(pl.name)} className="w-4 h-4 text-indigo-600 bg-white border-gray-300 rounded focus:ring-0" />
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{pl.price_list_name || pl.name}</div>
                          <div className="text-xs text-gray-500">Moneda: {pl.currency || pl.price_currency || '—'}</div>
                          {/* Mostrar la fórmula asociada si existe */}
                          {cfg && cfg.formula ? (
                            <div className="text-xs font-mono text-gray-700 mt-1">Fórmula: <span className="text-gray-600">{cfg.formula}</span></div>
                          ) : null}
                        </div>
                      </div>

                        <div className="flex items-center space-x-3">
                        <div className="text-xs text-gray-500">
                          {cfg.last_updated_at ? (
                            <span>Última: {new Date(cfg.last_updated_at).toLocaleString()} • {cfg.last_updated_by || '—'}</span>
                          ) : <span className="italic">Sin historial</span>}
                        </div>
                        <button
                          onClick={() => openCalculatorFor(pl.name)}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-gray-100 rounded-md transition-colors"
                          title="Abrir calculadora"
                        >
                          <Calculator className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={saveAutomationConfig} disabled={savingAutomationConfig} className="px-6 py-2 bg-green-600 text-white rounded-2xl font-black hover:bg-green-500 disabled:opacity-60">
            {savingAutomationConfig ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {/* Sección de Grupos de Clientes */}
      <div className="bg-gradient-to-r from-blue-50/80 to-blue-100/80 rounded-2xl p-6 border border-blue-200/50 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-black text-gray-900">Grupos de Clientes</h3>
            <p className="text-sm text-gray-600">Gestión de la jerarquía de grupos de clientes</p>
            {activeCompanyDetails && (
              <p className="text-xs text-gray-500 mt-1">Empresa: <span className="font-medium">{activeCompanyDetails.company_name || activeCompanyDetails.name}</span></p>
            )}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={loadGroups}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
              title="Recargar grupos"
            >
              ↻
            </button>
            <button
              onClick={() => onOpenCustomerGroupModal && onOpenCustomerGroupModal()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nuevo Grupo de Clientes
            </button>
          </div>
        </div>

        <div className="mb-4">
          <Info 
            className="w-4 h-4 text-blue-600 cursor-help" 
            title="Configuración de Grupos de Clientes: Configure listas de precios de venta y condiciones de pago que se aplicarán automáticamente a nuevos clientes asignados a cada grupo. Los grupos padre (is_group: 1) se usan para jerarquías pero no se pueden configurar individualmente."
          />
        </div>

        {loadingGroups ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
            {customerGroups.length > 0 ? (
              <div className="space-y-2">
                {/* Renderizar jerarquía */}
                {(() => {
                  const rootGroups = customerGroups.filter(group => !group.old_parent)
                  
                  return rootGroups.map(root => (
                    <div key={root.name} className="space-y-1">
                      {/* Grupo raíz */}
                      <div className="flex items-center space-x-2 font-semibold text-gray-800 bg-blue-100 px-3 py-2 rounded">
                        <span>📁</span>
                        <span>{root.name}</span>
                      </div>
                      
                      {/* Grupos hijos del raíz */}
                      {customerGroups.filter(group => group.old_parent === root.name).map((child) => (
                        <div key={child.name} className="flex items-center justify-between ml-6 text-gray-700 bg-white px-3 py-1 rounded border-l-2 border-blue-200">
                          <div className="flex items-center space-x-2">
                            <span>{child.is_group === 1 ? '📁' : '📄'}</span>
                            <span>{child.name}</span>
                          </div>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleOpenCustomerGroupModal(child)}
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Editar grupo"
                            >
                              <Edit className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteGroup(child, true)}
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                              title="Eliminar grupo"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                      
                      {/* Grupos hijos de hijos (nivel 2) */}
                      {customerGroups.filter(group => group.old_parent && group.old_parent !== root.name).map((grandchild) => {
                        const parent = customerGroups.find(g => g.name === grandchild.old_parent)
                        if (parent && parent.old_parent === root.name) {
                          return (
                            <div key={grandchild.name} className="flex items-center justify-between ml-12 text-gray-600 bg-gray-50 px-3 py-1 rounded border-l-2 border-gray-300">
                              <div className="flex items-center space-x-2">
                                <span>{grandchild.is_group === 1 ? '📁' : '📄'}</span>
                                <span>{grandchild.name}</span>
                              </div>
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => handleOpenCustomerGroupModal(grandchild)}
                                  className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                                  title="Editar grupo"
                                >
                                  <Edit className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleDeleteGroup(grandchild, true)}
                                  className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                                  title="Eliminar grupo"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          )
                        }
                        return null
                      })}
                    </div>
                  ))
                })()}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No hay grupos de clientes configurados</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sección de Grupos de Proveedores */}
      <div className="bg-gradient-to-r from-green-50/80 to-green-100/80 rounded-2xl p-6 border border-green-200/50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-black text-gray-900">Grupos de Proveedores</h3>
            <p className="text-sm text-gray-600">Gestión de la jerarquía de grupos de proveedores</p>
            {activeCompanyDetails && (
              <p className="text-xs text-gray-500 mt-1">Empresa: <span className="font-medium">{activeCompanyDetails.company_name || activeCompanyDetails.name}</span></p>
            )}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={loadGroups}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
              title="Recargar grupos"
            >
              ↻
            </button>
            <button
              onClick={() => onOpenSupplierGroupModal && onOpenSupplierGroupModal()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nuevo Grupo de Proveedores
            </button>
          </div>
        </div>

        <div className="mb-4">
          <Info 
            className="w-4 h-4 text-green-600 cursor-help" 
            title="Configuración de Grupos de Proveedores: Configure condiciones de pago que se aplicarán automáticamente a nuevos proveedores asignados a cada grupo. Los grupos padre (is_group: 1) se usan para jerarquías pero no se pueden configurar individualmente."
          />
        </div>

        {loadingGroups ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
            {supplierGroups.length > 0 ? (
              <div className="space-y-2">
                {/* Renderizar jerarquía */}
                {(() => {
                  const rootGroups = supplierGroups.filter(group => !group.old_parent)
                  
                  return rootGroups.map(root => (
                    <div key={root.name} className="space-y-1">
                      {/* Grupo raíz */}
                      <div className="flex items-center space-x-2 font-semibold text-gray-800 bg-green-100 px-3 py-2 rounded">
                        <span>📁</span>
                        <span>{root.name}</span>
                      </div>
                      
                      {/* Grupos hijos del raíz */}
                      {supplierGroups.filter(group => group.old_parent === root.name).map((child) => (
                        <div key={child.name} className="flex items-center justify-between ml-6 text-gray-700 bg-white px-3 py-1 rounded border-l-2 border-green-200">
                          <div className="flex items-center space-x-2">
                            <span>{child.is_group === 1 ? '📁' : '📄'}</span>
                            <span>{child.name}</span>
                          </div>
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleOpenSupplierGroupModal(child)}
                              className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                              title="Editar grupo"
                            >
                              <Edit className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteGroup(child, false)}
                              className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                              title="Eliminar grupo"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                      
                      {/* Grupos hijos de hijos (nivel 2) */}
                      {supplierGroups.filter(group => group.old_parent && group.old_parent !== root.name).map((grandchild) => {
                        const parent = supplierGroups.find(g => g.name === grandchild.old_parent)
                        if (parent && parent.old_parent === root.name) {
                          return (
                            <div key={grandchild.name} className="flex items-center justify-between ml-12 text-gray-600 bg-gray-50 px-3 py-1 rounded border-l-2 border-gray-300">
                              <div className="flex items-center space-x-2">
                                <span>{grandchild.is_group === 1 ? '📁' : '📄'}</span>
                                <span>{grandchild.name}</span>
                              </div>
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => handleOpenSupplierGroupModal(grandchild)}
                                  className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                                  title="Editar grupo"
                                >
                                  <Edit className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleDeleteGroup(grandchild, false)}
                                  className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                                  title="Eliminar grupo"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          )
                        }
                        return null
                      })}
                    </div>
                  ))
                })()}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No hay grupos de proveedores configurados</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de confirmación */}
      {isHistoryOpen && (
        <ExchangeRateHistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          currency={exchangeCurrency?.name || exchangeCurrency?.code}
          toCurrency={activeCompanyDetails?.default_currency || ''}
        />
      )}
      <ConfirmDialog />
    </div>
  )
}

export default CustomerSupplierAccounts
