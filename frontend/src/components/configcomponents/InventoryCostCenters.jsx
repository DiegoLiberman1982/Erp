import React, { useState, useEffect, useContext } from 'react'
import { Archive, Edit, Save, Plus, Warehouse, MapPin, Phone, Mail, Trash2, X, Settings, ChevronDown, ChevronUp, Star } from 'lucide-react'
import API_ROUTES from '../../apiRoutes'
import { NotificationContext } from '../../contexts/NotificationContext'
import { AuthContext } from '../../AuthProvider'
import { useConfirm } from '../../hooks/useConfirm'
import ItemGroups from './InventoryCostCenters/ItemGroups'
import Select from 'react-select'

const InventoryCostCenters = ({
  activeCompanyDetails,
  editingCompany,
  editedData,
  setEditedData,
  setEditingCompany,
  handleSaveCompany,
  saving,
  searchAccounts,
  selectAccount,
  extractAccountName,
  accountSearchResults,
  showAccountDropdown,
  setShowAccountDropdown,
  handleAccountInputChange,
  handleAccountFocus,
  onOpenCostCenterModal,
  costCenters: propCostCenters,
  reloadCostCenters,
  warehouses,
  warehouseTypes,
  onReloadWarehouseTypes,
  onOpenWarehouseModal,
  onDeleteWarehouse,
  onOpenItemGroupModal,
  itemGroups,
  reloadItemGroups,
  onOpenGroupItemsModal
}) => {
  const { showNotification } = useContext(NotificationContext)
  const { fetchWithAuth } = useContext(AuthContext)
  const { confirm, ConfirmDialog } = useConfirm()
  // Estados para formas impositivas y comerciales
  const [valuationMethod, setValuationMethod] = useState('Moving Average')
  const [commercialForm, setCommercialForm] = useState('Retail')
  const [stockSettings, setStockSettings] = useState(null)
  const [savingStockSettings, setSavingStockSettings] = useState(false)

  // Estados para listas de cuentas disponibles
  const [availableAssetAccounts, setAvailableAssetAccounts] = useState([])
  const [availableLiabilityAccounts, setAvailableLiabilityAccounts] = useState([])
  const [availableExpenseAccounts, setAvailableExpenseAccounts] = useState([])
  const [availableWarehouses, setAvailableWarehouses] = useState([])

  // Cargar stock settings al montar
  useEffect(() => {
    const loadStockSettings = async () => {
      try {
              const response = await fetchWithAuth('/api/stock-settings')
        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            setStockSettings(data.data)
            setValuationMethod(data.data.valuation_method || 'Moving Average')
          }
        }
      } catch (error) {
        console.error('Error loading stock settings:', error)
      }
    }

    loadStockSettings()
  }, [fetchWithAuth])

  // Función para obtener cuentas disponibles
  const fetchAvailableAccounts = async () => {
    try {
      const response = await fetchWithAuth(API_ROUTES.accounts)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Filtrar cuentas de activo (para inventario)
          const assetAccounts = data.data.filter(account => 
            account.root_type === 'Asset' && 
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          )
          setAvailableAssetAccounts(assetAccounts || [])
          
          // Filtrar cuentas de pasivo (para stock recibido no facturado)
          const liabilityAccounts = data.data.filter(account => 
            account.root_type === 'Liability' && 
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          )
          setAvailableLiabilityAccounts(liabilityAccounts || [])
          
          // Filtrar cuentas de gastos (para ajustes de stock)
          const expenseAccounts = data.data.filter(account => 
            account.root_type === 'Expense' && 
            !account.is_group // Solo cuentas hoja, no sumarizadoras
          )
          setAvailableExpenseAccounts(expenseAccounts || [])
        }
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
  }

  // Función para obtener warehouses disponibles
  const fetchAvailableWarehouses = async () => {
    if (!activeCompanyDetails?.name) return

    try {
      const response = await fetchWithAuth('/api/inventory/warehouses?company=' + encodeURIComponent(activeCompanyDetails.name))
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Handle new grouped response format - use flat list for selection
          const warehousesList = (data.data || []).filter(w => (w?.disabled ?? 0) !== 1)
          setAvailableWarehouses(warehousesList)
        }
      }
    } catch (error) {
      console.error('Error fetching warehouses:', error)
    }
  }

  // Cargar cuentas disponibles al montar
  useEffect(() => {
    fetchAvailableAccounts()
  }, [fetchWithAuth])

  // Cargar warehouses disponibles cuando cambia activeCompanyDetails
  useEffect(() => {
    if (activeCompanyDetails?.name) {
      fetchAvailableWarehouses()
    }
  }, [activeCompanyDetails?.name, fetchWithAuth])

  // Inicializar commercialForm cuando se carga la compañía para editar
  useEffect(() => {
    if (editingCompany && editedData) {
      setCommercialForm(editedData.commercial_form || 'Retail')
    }
  }, [editingCompany, editedData])

  // Debug: Log warehouseTypes cuando cambian
  useEffect(() => {
    if (warehouseTypes && warehouseTypes.length > 0) {
      warehouseTypes.forEach((type, index) => {
      })
    }
  }, [warehouseTypes])

  // Usar costCenters de props, con fallback a estado local para compatibilidad
  const costCenters = propCostCenters || []

  // Estados para centros de costo (solo para búsqueda)
  const [costCenterSearchResults, setCostCenterSearchResults] = useState({})
  const [showCostCenterDropdown, setShowCostCenterDropdown] = useState({})

  // Estados para gestión de tipos de almacenes
  const [isAddingNewWarehouseType, setIsAddingNewWarehouseType] = useState(false)
  const [warehouseTypeFormData, setWarehouseTypeFormData] = useState({
    warehouse_type_name: ''
  })
  const [savingWarehouseType, setSavingWarehouseType] = useState(false)

  // Estados para controlar la expansión/colapso de secciones
  const [costCentersExpanded, setCostCentersExpanded] = useState(false)
  const [warehousesExpanded, setWarehousesExpanded] = useState(false)
  const [itemGroupsExpanded, setItemGroupsExpanded] = useState(false)
  const [warehouseTypesExpanded, setWarehouseTypesExpanded] = useState(false)

  // Estados para selección de grupos de items
  const [selectedGroups, setSelectedGroups] = useState(new Set())
  const [selectedSubGroups, setSelectedSubGroups] = useState(new Set())

  // Función para manejar selección de grupos
  const handleGroupSelection = (groupName, isSelected) => {
    if (isSelected) {
      // Si se selecciona un grupo, deseleccionar todos los subgrupos
      setSelectedGroups(prev => new Set([...prev, groupName]))
      setSelectedSubGroups(new Set())
    } else {
      setSelectedGroups(prev => {
        const newSet = new Set(prev)
        newSet.delete(groupName)
        return newSet
      })
    }
  }

  // Función para manejar selección de subgrupos
  const handleSubGroupSelection = (subGroupName, isSelected) => {
    if (isSelected) {
      // Si se selecciona un subgrupo, deseleccionar todos los grupos
      setSelectedSubGroups(prev => new Set([...prev, subGroupName]))
      setSelectedGroups(new Set())
    } else {
      setSelectedSubGroups(prev => {
        const newSet = new Set(prev)
        newSet.delete(subGroupName)
        return newSet
      })
    }
  }

  // Función para agrupar elementos seleccionados
  const handleGroupItems = () => {
    if (onOpenGroupItemsModal) {
      const selectedGroupsArray = Array.from(selectedGroups)
      const selectedSubGroupsArray = Array.from(selectedSubGroups)
      onOpenGroupItemsModal(selectedGroupsArray, selectedSubGroupsArray)
    }
  }

  // Función para eliminar un grupo
  const handleDeleteItemGroup = async (groupName) => {
    const confirmed = await confirm({
      title: 'Eliminar Grupo',
      message: `¿Estás seguro de que quieres eliminar el grupo "${groupName}"?`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'danger'
    })

    if (!confirmed) {
      return
    }

    try {
      const response = await fetchWithAuth(`/api/item-groups/${groupName}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Grupo eliminado exitosamente', 'success')
          // Recargar grupos
          if (reloadItemGroups) {
            reloadItemGroups()
          }
        } else {
          showNotification(data.message || 'Error al eliminar grupo', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al eliminar grupo', 'error')
      }
    } catch (error) {
      console.error('Error deleting item group:', error)
      showNotification('Error al eliminar grupo', 'error')
    }
  }

  // Función para eliminar grupos seleccionados en masa
  const handleBulkDeleteGroups = async () => {
    const selectedCount = (selectedGroups?.size || 0) + (selectedSubGroups?.size || 0)
    if (!selectedCount) {
      showNotification('No hay grupos seleccionados', 'warning')
      return
    }

    const confirmed = await confirm({
      title: 'Eliminar grupos seleccionados',
      message: `¿Estás seguro de que quieres eliminar ${selectedCount} grupos de items seleccionados? Esta acción es irreversible.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      type: 'danger'
    })

    if (!confirmed) return

    try {
      const toDelete = [...(selectedGroups || []), ...(selectedSubGroups || [])]
      const response = await fetchWithAuth(API_ROUTES.itemGroupsBulkDelete, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_names: toDelete })
      })

      if (!response) throw new Error('No response from server')

      if (!response.ok) {
        const txt = await response.text()
        showNotification(`Error borrando grupos: ${txt}`, 'error')
        return
      }

      const data = await response.json()
      if (!data.success) {
        showNotification(data.message || 'Error borrando grupos', 'error')
        return
      }

      const results = data.data && data.data.results ? data.data.results : []
      const deletedCount = data.data?.deleted_count || 0
      const failed = results.filter(r => !r.success)

      // Clear selections
      setSelectedGroups(new Set())
      setSelectedSubGroups(new Set())

      // Reload groups list
      await reloadCostCentersLocal()

      if (failed.length > 0) {
        showNotification(`${deletedCount} grupos eliminados. ${failed.length} fallaron. Revisa logs.`, 'warning')
      } else {
        showNotification(`${deletedCount} grupos eliminados correctamente`, 'success')
      }

    } catch (err) {
      console.error('bulk delete groups error', err)
      showNotification('Error interno borrando grupos', 'error')
    }
  }

  // Opciones para formas impositivas (valuation methods)
  const valuationOptions = [
    { value: 'Moving Average', label: 'Promedio Ponderado (Moving Average)' },
    { value: 'FIFO', label: 'Primero en Entrar, Primero en Salir (FIFO)' },
    { value: 'LIFO', label: 'Último en Entrar, Primero en Salir (LIFO)' }
  ]

  // Opciones para formas comerciales
  const commercialOptions = [
    { value: 'Retail', label: 'Minorista (Retail)' },
    { value: 'Wholesale', label: 'Mayorista (Wholesale)' },
    { value: 'Manufacturing', label: 'Manufactura' },
    { value: 'Service', label: 'Servicio' }
  ]

  // Función para buscar centros de costo
  const searchCostCenters = async (query) => {
    if (!query || query.length < 2) {
      setCostCenterSearchResults({})
      return
    }

    try {
      const response = await fetchWithAuth(`/api/cost-centers?search=${encodeURIComponent(query)}&limit=10`)

      if (response.ok) {
        const data = await response.json()
        setCostCenterSearchResults({ cost_center: data.data || [] })
      }
    } catch (error) {
      console.error('Error searching cost centers:', error)
    }
  }

  // Función para seleccionar centro de costo
  const selectCostCenter = (costCenter) => {
    setEditedData(prev => ({ ...prev, cost_center: costCenter.name }))
    setCostCenterSearchResults({})
    setShowCostCenterDropdown({ cost_center: false })
  }

  // Función para manejar cambios en el input de centro de costo
  const handleCostCenterInputChange = (value) => {
    setEditedData(prev => ({ ...prev, cost_center: value }))
    searchCostCenters(value)
  }

  // Función para manejar foco en el input de centro de costo
  const handleCostCenterFocus = () => {
    setShowCostCenterDropdown({ cost_center: true })
  }

  // Cargar centros de costo al montar el componente
  useEffect(() => {
    if (reloadCostCenters && (!propCostCenters || propCostCenters.length === 0)) {
      reloadCostCenters()
    }
  }, [reloadCostCenters, propCostCenters])

  // Función para recargar centros de costo (llamada después de crear/editar)
  const reloadCostCentersLocal = async () => {
    if (reloadCostCenters) {
      await reloadCostCenters()
    }
  }

  const handleOpenWarehouseModal = (warehouse = null) => {
    if (onOpenWarehouseModal) {
      onOpenWarehouseModal(warehouse)
    }
  }

  const handleDeleteWarehouse = async (warehouseName) => {
    onDeleteWarehouse(warehouseName)
  }

  // Toggle the company's default warehouse (custom_default_warehouse)
  const handleToggleDefaultWarehouse = async (warehouseName) => {
    try {
      if (!activeCompanyDetails?.name) {
        showNotification('Compañía activa desconocida', 'error')
        return
      }

      // Determine current default warehouse (company custom field or stockSettings fallback)
      const currentDefault = (activeCompanyDetails && activeCompanyDetails.custom_default_warehouse) || (stockSettings && stockSettings.default_warehouse) || ''

      // If clicking the currently selected default, we remove it (set empty), otherwise set this warehouse
      const target = (currentDefault === warehouseName) ? '' : warehouseName

      const response = await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompanyDetails.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { default_warehouse: target } })
      })

      if (!response) throw new Error('No response from server')

      if (!response.ok) {
        const txt = await response.text()
        showNotification(txt || 'Error actualizando almacén por defecto', 'error')
        return
      }

      const data = await response.json()
      if (!data.success) {
        showNotification(data.message || 'Error actualizando almacén por defecto', 'error')
        return
      }

      // Update local state so UI reflects change
      const newDefault = target || ''
      setStockSettings(prev => ({ ...(prev || {}), default_warehouse: newDefault }))

      if (editingCompany) {
        setEditedData(prev => ({ ...(prev || {}), default_warehouse: newDefault }))
      }

      showNotification(newDefault ? 'Almacén por defecto actualizado' : 'Almacén por defecto removido', 'success')
      // Refresh available warehouses to keep labels up-to-date
      fetchAvailableWarehouses()
    } catch (error) {
      console.error('Error toggling default warehouse:', error)
      showNotification('Error interno actualizando almacén por defecto', 'error')
    }
  }

  // Funciones para gestión de tipos de almacenes
  const handleStartAddWarehouseType = () => {
    setIsAddingNewWarehouseType(true)
    setWarehouseTypeFormData({
      warehouse_type_name: ''
    })
  }

  const handleCancelAddWarehouseType = () => {
    setIsAddingNewWarehouseType(false)
    setWarehouseTypeFormData({
      warehouse_type_name: ''
    })
  }

  const handleSaveWarehouseType = async () => {
    if (!warehouseTypeFormData.warehouse_type_name.trim()) {
      showNotification('El nombre del tipo de almacén es obligatorio', 'error')
      return
    }

    setSavingWarehouseType(true)
    try {
      const response = await fetchWithAuth('/api/inventory/warehouse-types', {
        method: 'POST',
        body: JSON.stringify({ data: warehouseTypeFormData })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Tipo de almacén creado exitosamente', 'success')
          handleCancelAddWarehouseType()
          // Recargar tipos de almacenes sin recargar la página
          if (onReloadWarehouseTypes) {
            onReloadWarehouseTypes()
          }
        } else {
          showNotification(data.message || 'Error al guardar tipo de almacén', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al guardar tipo de almacén', 'error')
      }
    } catch (error) {
      console.error('Error saving warehouse type:', error)
      showNotification('Error al guardar tipo de almacén', 'error')
    } finally {
      setSavingWarehouseType(false)
    }
  }

  const handleSaveStockSettings = async () => {
    setSavingStockSettings(true)
    try {
      const response = await fetchWithAuth('/api/stock-settings', {
        method: 'PUT',
        body: JSON.stringify({
          data: {
            valuation_method: valuationMethod
          }
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Configuración de valoración guardada exitosamente', 'success')
          setStockSettings(prev => ({ ...prev, valuation_method: valuationMethod }))
        } else {
          showNotification(data.message || 'Error al guardar configuración de valoración', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al guardar configuración de valoración', 'error')
      }
    } catch (error) {
      console.error('Error saving stock settings:', error)
      showNotification('Error al guardar configuración de valoración', 'error')
    } finally {
      setSavingStockSettings(false)
    }
  }

  // Actualizar editedData cuando cambien las formas
  useEffect(() => {
    if (editingCompany) {
      setEditedData(prev => ({
        ...prev,
        commercial_form: commercialForm
      }))
    }
  }, [commercialForm, editingCompany, setEditedData])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
            <Archive className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Inventario y Centro de Costos</h2>
            <p className="text-gray-600 font-medium">Configuración de inventario, centros de costos y valoración</p>
          </div>
        </div>
      </div>

      {activeCompanyDetails && (
        <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
          {editingCompany ? (
            <div className="space-y-6">
              {/* Formas Impositivas y Comerciales */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Forma Impositiva de Valoración:</label>
                  <select
                    value={valuationMethod}
                    onChange={(e) => setValuationMethod(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {valuationOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Forma Comercial:</label>
                  <select
                    value={commercialForm}
                    onChange={(e) => setCommercialForm(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {commercialOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Almacén por Defecto */}
              <div>
                <label className="block text-sm font-black text-gray-700 mb-1">Almacén por Defecto:</label>
                <Select
                  value={availableWarehouses && Array.isArray(availableWarehouses) && availableWarehouses.find(w => w.name === editedData.default_warehouse) ?
                    { value: editedData.default_warehouse, label: availableWarehouses.find(w => w.name === editedData.default_warehouse).warehouse_name } : null}
                  onChange={(selectedOption) => {
                    setEditedData(prev => ({
                      ...prev,
                      default_warehouse: selectedOption ? selectedOption.value : ''
                    }))
                  }}
                  options={availableWarehouses && Array.isArray(availableWarehouses) ? availableWarehouses.map((warehouse) => ({
                    value: warehouse.name,
                    label: warehouse.warehouse_name || warehouse.name
                  })) : []}
                  placeholder="Seleccionar almacén..."
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

              {/* Campos de Centros de Costos e Inventario */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Inventario:</label>
                  <Select
                    value={availableAssetAccounts.find(acc => acc.name === editedData.default_inventory_account_code) ?
                      { value: editedData.default_inventory_account_code, label: extractAccountName(availableAssetAccounts.find(acc => acc.name === editedData.default_inventory_account_code)) } : null}
                    onChange={(selectedOption) => {
                      setEditedData(prev => ({
                        ...prev,
                        default_inventory_account: selectedOption ? extractAccountName(availableAssetAccounts.find(acc => acc.name === selectedOption.value)) : '',
                        default_inventory_account_code: selectedOption ? selectedOption.value : ''
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
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Ajuste de Stock:</label>
                  <Select
                    value={availableExpenseAccounts.find(acc => acc.name === editedData.stock_adjustment_account_code) ?
                      { value: editedData.stock_adjustment_account_code, label: extractAccountName(availableExpenseAccounts.find(acc => acc.name === editedData.stock_adjustment_account_code)) } : null}
                    onChange={(selectedOption) => {
                      setEditedData(prev => ({
                        ...prev,
                        stock_adjustment_account: selectedOption ? extractAccountName(availableExpenseAccounts.find(acc => acc.name === selectedOption.value)) : '',
                        stock_adjustment_account_code: selectedOption ? selectedOption.value : ''
                      }))
                    }}
                    options={availableExpenseAccounts.map((account) => ({
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
                  <p className="text-xs text-gray-500 mt-1">Solo cuentas de egresos</p>
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Stock Recibido No Facturado:</label>
                  <Select
                    value={availableLiabilityAccounts.find(acc => acc.name === editedData.stock_received_but_not_billed_code) ?
                      { value: editedData.stock_received_but_not_billed_code, label: extractAccountName(availableLiabilityAccounts.find(acc => acc.name === editedData.stock_received_but_not_billed_code)) } : null}
                    onChange={(selectedOption) => {
                      setEditedData(prev => ({
                        ...prev,
                        stock_received_but_not_billed: selectedOption ? extractAccountName(availableLiabilityAccounts.find(acc => acc.name === selectedOption.value)) : '',
                        stock_received_but_not_billed_code: selectedOption ? selectedOption.value : ''
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
                  <p className="text-xs text-gray-500 mt-1">Solo cuentas de pasivo</p>
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Compras (Gastos):</label>
                  <Select
                    value={availableExpenseAccounts.find(acc => acc.name === editedData.default_expense_account_code) ?
                      { value: editedData.default_expense_account_code, label: extractAccountName(availableExpenseAccounts.find(acc => acc.name === editedData.default_expense_account_code)) } : null}
                    onChange={(selectedOption) => {
                      setEditedData(prev => ({
                        ...prev,
                        default_expense_account: selectedOption ? extractAccountName(availableExpenseAccounts.find(acc => acc.name === selectedOption.value)) : '',
                        default_expense_account_code: selectedOption ? selectedOption.value : ''
                      }))
                    }}
                    options={availableExpenseAccounts.map((account) => ({
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
                  <p className="text-xs text-gray-500 mt-1">Solo cuentas de gastos</p>
                </div>
                <div className="md:col-span-2">
                  <label className="flex items-center mt-4">
                    <input
                      type="checkbox"
                      checked={editedData.enable_perpetual_inventory || false}
                      onChange={(e) => setEditedData(prev => ({ ...prev, enable_perpetual_inventory: e.target.checked }))}
                      className="mr-2"
                    />
                    <span className="text-sm font-medium text-gray-700">Inventario Perpetuo</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                <button
                  onClick={() => {
                    setEditingCompany(null)
                    setEditedData({})
                  }}
                  className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    try {
                      // Guardar configuración de compañía
                      const companySuccess = await handleSaveCompany(editingCompany, editedData)
                      // Guardar configuración de stock
                      await handleSaveStockSettings()

                      // Siempre volver al modo vista después de guardar (independientemente del resultado)
                      setEditingCompany(null)
                      setEditedData({})
                    } catch (error) {
                      console.error('Error saving:', error)
                      // En caso de error, mostrar notificación pero no cambiar el estado
                      showNotification('Error al guardar los cambios', 'error')
                    }
                  }}
                  disabled={saving || savingStockSettings}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
                >
                  {(saving || savingStockSettings) ? (
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Forma Impositiva de Valoración:</label>
                    <p className="text-gray-900 font-bold">{stockSettings?.valuation_method || 'Moving Average'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Forma Comercial:</label>
                    <p className="text-gray-900 font-bold">{activeCompanyDetails?.commercial_form || 'Retail'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Almacén por Defecto:</label>
                    <p className="text-gray-900 font-bold">
                      {stockSettings?.default_warehouse 
                        ? (() => {
                            const warehouse = availableWarehouses && Array.isArray(availableWarehouses) && availableWarehouses.find(w => w.name === stockSettings.default_warehouse)
                            return warehouse ? (warehouse.warehouse_name || warehouse.name) : stockSettings.default_warehouse
                          })()
                        : 'No disponible'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Inventario:</label>
                    <p className="text-gray-900 font-bold">{extractAccountName(activeCompanyDetails?.default_inventory_account) || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Ajuste de Stock:</label>
                    <p className="text-gray-900 font-bold">{extractAccountName(activeCompanyDetails?.stock_adjustment_account) || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Stock Recibido No Facturado:</label>
                    <p className="text-gray-900 font-bold">{extractAccountName(activeCompanyDetails?.stock_received_but_not_billed) || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Compras (Gastos):</label>
                    <p className="text-gray-900 font-bold">{extractAccountName(activeCompanyDetails?.default_expense_account) || 'No disponible'}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col space-y-2 ml-4">
                <button
                  onClick={() => {
                    setEditingCompany(activeCompanyDetails.name)
                    setEditedData({
                      valuation_method: activeCompanyDetails?.valuation_method || 'Moving Average',
                      commercial_form: activeCompanyDetails?.commercial_form || 'Retail',
                      default_warehouse: stockSettings?.default_warehouse || '',
                      default_inventory_account: extractAccountName(activeCompanyDetails?.default_inventory_account) || '',
                      default_inventory_account_code: activeCompanyDetails?.default_inventory_account || '',
                      stock_adjustment_account: extractAccountName(activeCompanyDetails?.stock_adjustment_account) || '',
                      stock_adjustment_account_code: activeCompanyDetails?.stock_adjustment_account || '',
                      stock_received_but_not_billed: extractAccountName(activeCompanyDetails?.stock_received_but_not_billed) || '',
                      stock_received_but_not_billed_code: activeCompanyDetails?.stock_received_but_not_billed || '',
                      default_expense_account: activeCompanyDetails?.default_expense_account || '',
                      default_expense_account_code: activeCompanyDetails?.default_expense_account || '',
                      round_off_cost_center: extractAccountName(activeCompanyDetails?.round_off_cost_center) || '',
                      round_off_cost_center_code: activeCompanyDetails?.round_off_cost_center || '',
                      enable_perpetual_inventory: activeCompanyDetails?.enable_perpetual_inventory || false
                    })
                    setValuationMethod(stockSettings?.valuation_method || 'Moving Average')
                    setCommercialForm(activeCompanyDetails?.commercial_form || 'Retail')
                  }}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                  title="Editar inventario y centros de costos"
                >
                  <Edit className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* Sección de Jerarquía de Centros de Costo - Siempre visible */}
          <div className="border-t border-gray-200 pt-6 mt-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCostCentersExpanded(!costCentersExpanded)}
                className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 transition-colors duration-200 flex-1 text-left"
              >
                {costCentersExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-black text-gray-900">Centros de Costo</h3>
                  <p className="text-sm text-gray-600">Gestión de la jerarquía de centros de costo</p>
                </div>
              </button>
              <button
                type="button"
                onClick={onOpenCostCenterModal}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 ml-4"
              >
                <Plus className="w-4 h-4 mr-2" />
                Nuevo Centro de Costo
              </button>
            </div>

            {/* Jerarquía Visual */}
            {costCentersExpanded && (
              <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
                {costCenters.length > 0 ? (
                  <div className="space-y-2">
                    {/* Centros padre (grupos) */}
                    {costCenters.filter(cc => cc.is_group === 1).map((parent) => (
                      <div key={parent.name} className="space-y-1">
                        <div className="flex items-center space-x-2 font-semibold text-gray-800 bg-blue-100 px-3 py-2 rounded">
                          <span>📁</span>
                          <span>{parent.cost_center_name}</span>
                        </div>
                        {/* Centros hijos */}
                        {costCenters.filter(cc => cc.parent_cost_center === parent.name && cc.is_group === 0).map((child) => (
                          <div key={child.name} className="flex items-center space-x-2 ml-6 text-gray-700 bg-white px-3 py-1 rounded border-l-2 border-blue-200">
                            <span>📄</span>
                            <span>{child.cost_center_name}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {/* Centros sin padre */}
                    {costCenters.filter(cc => !cc.parent_cost_center && cc.is_group === 0).map((orphan) => (
                      <div key={orphan.name} className="flex items-center space-x-2 text-gray-700 bg-white px-3 py-1 rounded">
                        <span>📄</span>
                        <span>{orphan.cost_center_name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500 mb-4">No hay centros de costo configurados</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sección de Warehouses */}
          <div className="border-t border-gray-200 pt-6 mt-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setWarehousesExpanded(!warehousesExpanded)}
                className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 transition-colors duration-200 flex-1 text-left"
              >
                {warehousesExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-black text-gray-900">Almacenes</h3>
                  <p className="text-sm text-gray-600">Gestión de almacenes y depósitos</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleOpenWarehouseModal(null)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 ml-4"
              >
                <Plus className="w-4 h-4 mr-2" />
                Nuevo Almacén
              </button>
            </div>

            {/* Jerarquía Visual de Warehouses */}
            {warehousesExpanded && (
              <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                {warehouses === undefined ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
                    <p className="text-gray-500">Cargando almacenes...</p>
                  </div>
                ) : warehouses && warehouses.length > 0 ? (
                  <div className="space-y-2">
                    {/* Agrupar warehouses por parent_warehouse */}
                    {(() => {
                      // Separar warehouses por grupo y filtrar variantes
                      const visibleWarehouses = (warehouses && Array.isArray(warehouses))
                        ? warehouses.filter(w => (w?.disabled ?? 0) !== 1)
                        : []
                      const groupWarehouses = visibleWarehouses.filter(w => w.is_group == 1)
                      const childWarehouses = visibleWarehouses.filter(w => w.is_group != 1 && !w.is_consignment_variant)

                      // Crear estructura anidada
                      const groupedByParent = {}

                      // Primero agregar los grupos
                      groupWarehouses.forEach(group => {
                        groupedByParent[group.name] = {
                          group,
                          children: []
                        }
                      })

                      // Luego agregar los hijos a sus padres (excluyendo variantes)
                      childWarehouses.forEach(child => {
                        const parentName = child.parent_warehouse
                        if (parentName && groupedByParent[parentName]) {
                          groupedByParent[parentName].children.push(child)
                        } else {
                          // Si no tiene padre conocido, crear un grupo "Sin Grupo"
                          if (!groupedByParent['Sin Grupo']) {
                            groupedByParent['Sin Grupo'] = {
                              group: null,
                              children: []
                            }
                          }
                          groupedByParent['Sin Grupo'].children.push(child)
                        }
                      })

                      // Renderizar la estructura anidada
                      return Object.entries(groupedByParent).map(([parentName, { group, children }]) => (
                        <div key={parentName} className="space-y-1">
                          {/* Grupo padre */}
                          {group && (
                            <div className="flex items-center space-x-2 font-bold text-gray-900 bg-blue-100 px-3 py-2 rounded">
                              <span>📁</span>
                              <span>{group.warehouse_name}</span>
                              <span className="text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full">GRUPO</span>
                            </div>
                          )}

                          {/* Warehouses hijos */}
                          {children.map((warehouse) => (
                            <div key={warehouse.name} className={`flex items-center space-x-2 ml-6 text-gray-800 px-3 py-2 rounded border-l-4 ${
                              warehouse.has_consignment ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-300'
                            }`}>
                              <span>🏭</span>
                              <span>{warehouse.warehouse_name}</span>
                              {(((stockSettings && stockSettings.default_warehouse) ? stockSettings.default_warehouse : (activeCompanyDetails && activeCompanyDetails.custom_default_warehouse)) === warehouse.name) && (
                                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full ml-2">POR DEFECTO</span>
                              )}
                              {warehouse.has_consignment && (
                                <span className="text-xs bg-orange-200 text-orange-800 px-2 py-1 rounded-full">
                                  📦 Con productos en consignación
                                </span>
                              )}
                              <div className="flex space-x-1 ml-auto items-center">
                                {/* Default selector: left of edit/delete - toggles company's default warehouse */}
                                <button
                                  onClick={() => handleToggleDefaultWarehouse && handleToggleDefaultWarehouse(warehouse.name)}
                                    className={`p-1 transition-colors duration-200 ${((stockSettings && stockSettings.default_warehouse) ? stockSettings.default_warehouse : (activeCompanyDetails && activeCompanyDetails.custom_default_warehouse)) === warehouse.name ? 'text-yellow-600 hover:text-yellow-700' : 'text-gray-400 hover:text-yellow-500'}`}
                                    title={((stockSettings && stockSettings.default_warehouse) ? stockSettings.default_warehouse : (activeCompanyDetails && activeCompanyDetails.custom_default_warehouse)) === warehouse.name ? 'Quitar almacén por defecto' : 'Marcar como almacén por defecto'}
                                >
                                  <Star className="w-3 h-3" />
                                </button>

                                <button
                                  onClick={() => handleOpenWarehouseModal(warehouse)}
                                  className="p-1 text-gray-400 hover:text-blue-600 transition-colors duration-200"
                                  title="Editar almacén"
                                >
                                  <Edit className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => onDeleteWarehouse(warehouse)}
                                  className="p-1 text-gray-400 hover:text-red-600 transition-colors duration-200"
                                  title="Eliminar almacén"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))
                    })()}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Warehouse className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 mb-4">No hay almacenes configurados</p>
                    <button
                      onClick={() => handleOpenWarehouseModal(null)}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Crear primer almacén
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sección de Tipos de Almacenes */}
          <div className="border-t border-gray-200 pt-6 mt-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setWarehouseTypesExpanded(!warehouseTypesExpanded)}
                className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 transition-colors duration-200 flex-1 text-left"
              >
                {warehouseTypesExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-black text-gray-900">Tipos de Almacenes</h3>
                  <p className="text-sm text-gray-600">Gestión de tipos de almacenes disponibles</p>
                </div>
              </button>
              <button
                type="button"
                onClick={handleStartAddWarehouseType}
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 ml-4 ${isAddingNewWarehouseType ? 'hidden' : ''}`}
              >
                <Plus className="w-4 h-4 mr-2" />
                Nuevo Tipo
              </button>
            </div>

            {/* Lista de Tipos de Almacenes */}
            {warehouseTypesExpanded && (
              <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
                {warehouseTypes && warehouseTypes.length > 0 ? (
                  <div className="space-y-2">
                    {isAddingNewWarehouseType && (
                      <div className="flex items-center justify-between bg-white px-4 py-3 rounded-lg border border-gray-200">
                        <div className="flex items-center space-x-3">
                          <Settings className="w-5 h-5 text-purple-600" />
                          <input
                            type="text"
                            value={warehouseTypeFormData.warehouse_type_name || ''}
                            onChange={(e) => setWarehouseTypeFormData(prev => ({
                              ...prev,
                              warehouse_type_name: e.target.value
                            }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveWarehouseType()
                              } else if (e.key === 'Escape') {
                                handleCancelAddWarehouseType()
                              }
                            }}
                            className="flex-1 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            placeholder="Nombre del nuevo tipo de almacén"
                            autoFocus
                          />
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={handleSaveWarehouseType}
                            disabled={savingWarehouseType || !warehouseTypeFormData.warehouse_type_name?.trim()}
                            className="p-1 text-green-600 hover:text-green-800 transition-colors duration-200"
                            title="Guardar"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelAddWarehouseType}
                            disabled={savingWarehouseType}
                            className="p-1 text-gray-600 hover:text-gray-800 transition-colors duration-200"
                            title="Cancelar"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                    {warehouseTypes.map((type) => {

                      return (
                        <div key={type.name} className="flex items-center justify-between bg-white px-4 py-3 rounded-lg border border-gray-200">
                          <div className="flex items-center space-x-3">
                            <Settings className="w-5 h-5 text-purple-600" />
                            <span className="font-medium text-gray-900">{type.warehouse_type_name || type.name}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Settings className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 mb-4">No hay tipos de almacenes configurados</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sección de Grupos de Items */}
          <div className="border-t border-gray-200 pt-6 mt-6">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setItemGroupsExpanded(!itemGroupsExpanded)}
                className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 transition-colors duration-200 flex-1 text-left"
              >
                {itemGroupsExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-black text-gray-900">Grupos de Items</h3>
                  <p className="text-sm text-gray-600">Gestión de la jerarquía de grupos de items</p>
                </div>
              </button>
                <div className="flex items-center space-x-3 ml-4">
                <button
                  onClick={handleGroupItems}
                  disabled={selectedGroups.size === 0 && selectedSubGroups.size === 0}
                  className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 ${
                    selectedGroups.size > 0 || selectedSubGroups.size > 0
                      ? 'text-white bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2'
                      : 'text-gray-400 bg-gray-200 cursor-not-allowed'
                  }`}
                >
                  AGRUPAR
                </button>
                {/* Bulk delete button - appears beside AGRUPAR */}
                <button
                  onClick={handleBulkDeleteGroups}
                  disabled={selectedGroups.size === 0 && selectedSubGroups.size === 0}
                  title={selectedGroups.size + selectedSubGroups.size > 0 ? `Eliminar ${selectedGroups.size + selectedSubGroups.size} elementos seleccionados` : 'No hay grupos seleccionados'}
                  className={`bulk-delete-toggle inline-flex items-center px-3 py-2 border rounded-lg text-sm font-medium transition-all duration-200 ${selectedGroups.size + selectedSubGroups.size > 0 ? 'active text-white bg-red-600 hover:from-red-500 hover:to-red-600' : 'text-gray-400 bg-gray-200 cursor-not-allowed'}`}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  <span className="bulk-delete-count">{selectedGroups.size + selectedSubGroups.size || ''}</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenItemGroupModal}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nuevo Grupo de Items
                </button>
              </div>
            </div>

            {/* ItemGroups Component */}
            {itemGroupsExpanded && (
              <ItemGroups
                activeCompanyDetails={activeCompanyDetails}
                onOpenItemGroupModal={onOpenItemGroupModal}
                itemGroups={itemGroups}
                reloadItemGroups={reloadItemGroups}
                selectedGroups={selectedGroups}
                selectedSubGroups={selectedSubGroups}
                handleGroupSelection={handleGroupSelection}
                handleSubGroupSelection={handleSubGroupSelection}
                handleDeleteItemGroup={handleDeleteItemGroup}
              />
            )}
          </div>
        </div>
      )}

      <ConfirmDialog />
    </div>
  )
}

export default InventoryCostCenters
