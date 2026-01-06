import React, { useState, useEffect, useContext } from 'react'
import { Settings, Save } from 'lucide-react'
import Select from 'react-select'
import Modal from '../Modal.jsx'
import { AuthContext } from '../../AuthProvider'
import { fetchWarehouses } from '../../apiUtils.js'

const normalizeIsStockItem = (value) => {
  if (value === undefined || value === null || value === '') return null
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'boolean') return value
  const normalized = String(value).toLowerCase().trim()
  if (normalized === 'producto' || normalized === 'stock' || normalized === 'true') return true
  if (normalized === 'servicio' || normalized === 'service' || normalized === 'false') return false
  return null
}

const ItemSettingsModal = ({ isOpen, onClose, item, customer, onSaveSettings }) => {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const [settings, setSettings] = useState({
    expense_account: '',
    warehouse: '',
    cost_center: '',
    valuation_rate: ''
  })
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [availableWarehouses, setAvailableWarehouses] = useState([])
  const [availableCostCenters, setAvailableCostCenters] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resolvedIsStockItem, setResolvedIsStockItem] = useState(null)

  const isStockItem = normalizeIsStockItem(item?.is_stock_item ?? resolvedIsStockItem)
  const shouldShowWarehouse = isStockItem === true

  // Cargar datos disponibles cuando se abre el modal
  useEffect(() => {
    if (isOpen && item && activeCompany) {
      loadAvailableData()
      loadCompanyDetails()
      
      // Implementar jerarquía de cuentas de gastos
      let selectedExpenseAccount = ''
      
      // 1. Verificar si hay cuenta específica del item (manual override)
      if (item.expense_account) {
        selectedExpenseAccount = item.expense_account
      } else if (item.custom_expense_account) {
        selectedExpenseAccount = item.custom_expense_account
      }
      // 2. Verificar item_defaults para la compañía
      else if (item.item_defaults?.find(defaultItem => defaultItem.company === activeCompany)?.expense_account) {
        selectedExpenseAccount = item.item_defaults.find(defaultItem => defaultItem.company === activeCompany).expense_account
      }
      // 3. Verificar cuenta del proveedor (supplier)
      else if (customer?.default_expense_account) {
        selectedExpenseAccount = customer.default_expense_account
      }
      // 4. Verificar cuenta del grupo de proveedores
      else if (customer?.supplier_group) {
        // Aquí necesitaríamos obtener la información del grupo de proveedores
        // Por ahora, dejamos vacío hasta implementar la lógica del grupo
      }
      
      setSettings(prev => ({ ...prev, expense_account: selectedExpenseAccount }))

      // Establecer warehouse por defecto desde item_defaults
      const defaultWarehouse = item.item_defaults?.find(defaultItem =>
        defaultItem.company === activeCompany
      )?.default_warehouse
      if (item.warehouse) {
        setSettings(prev => ({ ...prev, warehouse: item.warehouse }))
      } else if (defaultWarehouse) {
        setSettings(prev => ({ ...prev, warehouse: defaultWarehouse }))
      }

      if (item.cost_center) {
        setSettings(prev => ({ ...prev, cost_center: item.cost_center }))
      }

      // Initialize valuation_rate
      if (item.valuation_rate) {
        setSettings(prev => ({ ...prev, valuation_rate: item.valuation_rate }))
      } else if (item.rate) {
        // If no valuation_rate but has rate, use rate as default
        setSettings(prev => ({ ...prev, valuation_rate: item.rate }))
      }
    }
  }, [isOpen, item, customer, activeCompany])

  useEffect(() => {
    if (!isOpen) {
      setResolvedIsStockItem(null)
      return
    }

    if (!item) return
    const localIsStock = normalizeIsStockItem(item.is_stock_item)
    if (localIsStock !== null) {
      setResolvedIsStockItem(null)
      return
    }

    const itemKey = (item.item_code || item.name || item.item_name || '').toString().trim()
    if (!itemKey || typeof fetchWithAuth !== 'function') return

    let cancelled = false
    const fetchIsStockItem = async () => {
      try {
        const resp = await fetchWithAuth(
          `/api/resource/Item/${encodeURIComponent(itemKey)}?fields=${encodeURIComponent(JSON.stringify(['is_stock_item']))}`
        )
        if (!resp || !resp.ok) return
        const json = await resp.json()
        if (cancelled) return
        if (json && json.data && Object.prototype.hasOwnProperty.call(json.data, 'is_stock_item')) {
          setResolvedIsStockItem(json.data.is_stock_item)
        }
      } catch (e) {
        // ignore
      }
    }

    fetchIsStockItem()
    return () => {
      cancelled = true
    }
  }, [fetchWithAuth, isOpen, item?.item_code, item?.item_name, item?.name])

  const loadAvailableData = async () => {
    setLoading(true)
    try {
      // Cargar cuentas (no grupo). Incluye también cuentas hoja de Activo, etc.
      const accountsResponse = await fetchWithAuth('/api/accounts?limit=5000')
      const accountsData = await accountsResponse.json()
      const accounts = accountsData.data || []
      setAvailableAccounts(
        accounts.filter(account => {
          if (account.is_group) return false
          const accountType = (account.account_type || '').toString().trim().toLowerCase()
          return accountType !== 'cost of goods sold'
        })
      )

      // Cargar almacenes disponibles usando la nueva API agrupada
      console.log('--- ItemSettingsModal: loading warehouses using grouped API')
      const warehouseData = await fetchWarehouses(fetchWithAuth, activeCompany)
      console.log('--- ItemSettingsModal: warehouses loaded', warehouseData.flat.length, 'warehouses')
      setAvailableWarehouses(warehouseData.flat.filter(warehouse => !warehouse.is_consignment_variant))

      // Cargar centros de costo disponibles usando la API local
      const costCentersResponse = await fetchWithAuth('/api/cost-centers?limit=1000')
      const costCentersData = await costCentersResponse.json()
      setAvailableCostCenters(costCentersData.data || [])
    } catch (error) {
      console.error('Error loading available data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCompanyDetails = async () => {
    try {
      const companyResponse = await fetchWithAuth('/api/active-company')
      if (companyResponse.ok) {
        const companyData = await companyResponse.json()
        const companyDetails = companyData.data?.company_details
        
        // Si no hay cuenta seleccionada aún, usar la cuenta por defecto de la compañía
        if (companyDetails?.default_expense_account) {
          setSettings(prev => {
            if (prev.expense_account) return prev
            return { ...prev, expense_account: companyDetails.default_expense_account }
          })
        }
        // Usar almacén por defecto de la compañía solo si el ítem no tiene uno asignado
        setSettings(prev => {
          if (prev.warehouse) {
            return prev
          }
          if (companyDetails?.custom_default_warehouse) {
            return { ...prev, warehouse: companyDetails.custom_default_warehouse }
          }
          return prev
        })
      }
    } catch (error) {
      console.error('Error loading company details:', error)
    }
  }

  const handleSave = async () => {
    if (!item) return

    setSaving(true)
    try {
      // Llamar a la función callback para guardar la configuración
      if (onSaveSettings) {
        const payload = shouldShowWarehouse ? settings : { ...settings, warehouse: '' }
        onSaveSettings(payload)
      }
      onClose()
    } catch (error) {
      console.error('Error saving item settings:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }))
  }

  if (!isOpen) {
    return null
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configuración del Item"
      subtitle={item?.item_name || item?.name}
      size="md"
    >
      <div className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <>
            {/* Cuenta de Gastos */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cuenta de Gastos
              </label>
              <Select
                value={availableAccounts.find(acc => acc.name === settings.expense_account) ?
                  { value: settings.expense_account, label: availableAccounts.find(acc => acc.name === settings.expense_account).account_name } : null}
                onChange={(selectedOption) => handleChange('expense_account', selectedOption ? selectedOption.value : '')}
                options={availableAccounts.map((account) => ({
                  value: account.name,
                  label: account.account_name
                }))}
                placeholder="Seleccionar cuenta de gastos..."
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

            {/* Almacén */}
            {shouldShowWarehouse && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Almacén
              </label>
              <Select
                value={availableWarehouses && Array.isArray(availableWarehouses) && availableWarehouses.find(wh => wh.name === settings.warehouse) ?
                  { value: settings.warehouse, label: availableWarehouses.find(wh => wh.name === settings.warehouse).warehouse_name + (availableWarehouses.find(wh => wh.name === settings.warehouse).has_consignment ? ' 📦' : '') } : null}
                onChange={(selectedOption) => handleChange('warehouse', selectedOption ? selectedOption.value : '')}
                options={availableWarehouses && Array.isArray(availableWarehouses) ? availableWarehouses.map((warehouse) => ({
                  value: warehouse.name,
                  label: warehouse.warehouse_name + (warehouse.has_consignment ? ' 📦' : '')
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
              <p className="text-xs text-gray-500 mt-1">
                Almacén específico para este item.
              </p>
            </div>
            )}

            {/* Centro de Costo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Centro de Costo
              </label>
              <Select
                value={availableCostCenters.find(cc => cc.name === settings.cost_center) ?
                  { value: settings.cost_center, label: availableCostCenters.find(cc => cc.name === settings.cost_center).cost_center_name } : null}
                onChange={(selectedOption) => handleChange('cost_center', selectedOption ? selectedOption.value : '')}
                options={availableCostCenters.map((costCenter) => ({
                  value: costCenter.name,
                  label: costCenter.cost_center_name
                }))}
                placeholder="Seleccionar centro de costo..."
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

            {/* Valoración de Inventario */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Valoración de Inventario
              </label>
              <input
                type="text"
                value={settings.valuation_rate}
                onChange={(e) => handleChange('valuation_rate', e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                Costo unitario para valuación de inventario. Si está vacío, se usará el precio de compra.
              </p>
            </div>

            {/* Footer Buttons */}
            <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Guardando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Guardar Configuración
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default ItemSettingsModal
