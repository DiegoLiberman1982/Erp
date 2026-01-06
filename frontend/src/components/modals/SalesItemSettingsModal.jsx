import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import Modal from '../Modal.jsx'
import { AuthContext } from '../../AuthProvider.jsx'

const resolveBaseWarehouseFromVariant = (warehouseName) => {
  const raw = (warehouseName || '').toString()
  if (!raw) return ''

  let base = ''
  if (raw.includes('__CON[')) base = raw.split('__CON[')[0]
  else if (raw.includes('__VCON[')) base = raw.split('__VCON[')[0]
  else return ''

  const abbrMatch = raw.match(/\s-\s([A-Z]{2,})$/)
  const abbr = abbrMatch ? abbrMatch[1] : ''
  return abbr ? `${base} - ${abbr}` : base
}

const defaultForm = {
  income_account: '',
  warehouse: '',
  cost_center: '',
  valuation_rate: '',
  propiedad: 'Propio'
}

const SalesItemSettingsModal = ({
  isOpen,
  onClose,
  item,
  itemIndex,
  onSave,
  fetchWithAuth: fetchWithAuthProp,
  availableWarehouses = [],
  showPropiedad = false,
  propiedadOptions = ['Propio', 'Consignación', 'Mercadería en local del proveedor']
}) => {
  const authContext = useContext(AuthContext)
  const fetchWithAuth = fetchWithAuthProp || authContext?.fetchWithAuth
  const [formValues, setFormValues] = useState(defaultForm)
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [availableCostCenters, setAvailableCostCenters] = useState([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [loadError, setLoadError] = useState(null)

  const normalizedWarehouses = useMemo(() => {
    return (availableWarehouses || []).filter((warehouse) => !warehouse?.is_consignment_variant)
  }, [availableWarehouses])

  const normalizeWarehouseSelection = useCallback((warehouseValue) => {
    const value = (warehouseValue || '').toString()
    if (!value) return ''
    if (normalizedWarehouses.some((w) => w?.name === value)) return value

    const baseCandidate = resolveBaseWarehouseFromVariant(value)
    if (baseCandidate && normalizedWarehouses.some((w) => w?.name === baseCandidate)) return baseCandidate

    return value
  }, [normalizedWarehouses])

  useEffect(() => {
    if (isOpen) {
      const initialWarehouse = normalizeWarehouseSelection(
        item?.warehouse || (normalizedWarehouses && normalizedWarehouses.length > 0 ? normalizedWarehouses[0].name : '')
      )
      // Initialize with any explicit item warehouse; if missing pick the first available warehouse as a sensible default
      setFormValues({
        income_account: item?.income_account || '',
        warehouse: initialWarehouse,
        cost_center: item?.cost_center || '',
        valuation_rate: item?.valuation_rate || item?.rate || '',
        ...(showPropiedad ? { propiedad: item?.propiedad || 'Propio' } : {})
      })
      loadOptions()
    } else {
      setLoadError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item, availableWarehouses, normalizeWarehouseSelection, normalizedWarehouses])

  useEffect(() => {
    const loadCompanyDefaults = async () => {
      if (!isOpen || !fetchWithAuth) return
      try {
        const response = await fetchWithAuth('/api/active-company')
        if (response?.ok) {
          const payload = await response.json()
            const companyWarehouse = payload?.data?.company_details?.custom_default_warehouse
            // Prefer existing item warehouse; otherwise prefer company default; if neither, fall back to first available warehouse
            if (companyWarehouse) {
              const normalized = normalizeWarehouseSelection(companyWarehouse)
              setFormValues((prev) => prev.warehouse ? prev : { ...prev, warehouse: normalized })
            } else if (!formValues.warehouse && Array.isArray(availableWarehouses) && availableWarehouses.length > 0) {
              const first = normalizeWarehouseSelection(normalizedWarehouses[0]?.name || availableWarehouses[0].name)
              setFormValues((prev) => prev.warehouse ? prev : { ...prev, warehouse: first })
            }
        }
      } catch (error) {
        console.error('Error loading company defaults for sales item settings:', error)
      }
    }

    loadCompanyDefaults()
  }, [fetchWithAuth, isOpen, availableWarehouses, formValues, normalizeWarehouseSelection, normalizedWarehouses])

  const loadOptions = async () => {
    if (!fetchWithAuth) return
    setIsLoadingOptions(true)
    setLoadError(null)
    try {
      const [accountsResponse, costCentersResponse] = await Promise.all([
        fetchWithAuth('/api/accounts?root_type=Income&limit=1000'),
        fetchWithAuth('/api/cost-centers?limit=1000')
      ])
      if (accountsResponse.ok) {
        const accountsData = await accountsResponse.json()
        setAvailableAccounts(accountsData.data || [])
      } else {
        setAvailableAccounts([])
      }
      if (costCentersResponse.ok) {
        const costCentersData = await costCentersResponse.json()
        setAvailableCostCenters(costCentersData.data || [])
      } else {
        setAvailableCostCenters([])
      }
    } catch (error) {
      console.error('Error loading item configuration options:', error)
      setLoadError('No pudimos cargar todas las opciones. Intentá nuevamente.')
    } finally {
      setIsLoadingOptions(false)
    }
  }

  const warehouseOptions = useMemo(() => {
    return (normalizedWarehouses || []).map((warehouse) => ({
      value: warehouse.name,
      label: (warehouse.warehouse_name || warehouse.display_name || warehouse.name) + (warehouse.has_consignment ? ' 📦' : '')
    }))
  }, [normalizedWarehouses])

  const handleChange = (field, value) => {
    setFormValues((prev) => ({
      ...prev,
      [field]: value
    }))
  }

  // Determine whether the current item is a stock item (product) or a service.
  // item.is_stock_item can be 1/0, boolean, or localized string like 'Producto'/'Servicio'.
  const isStockItem = useMemo(() => {
    const v = item?.is_stock_item
    if (v === undefined || v === null) return true // default to product when unknown
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return Number(v) !== 0
    if (typeof v === 'string') {
      const s = v.toLowerCase().trim()
      if (s === 'producto' || s === 'product' || s === '1' || s === 'true') return true
      if (s === 'servicio' || s === 'service' || s === '0' || s === 'false') return false
      // fallback: consider it a product unless explicitly mentions 'serv'
      return !s.includes('serv')
    }
    return Boolean(v)
  }, [item])

  const handleSubmit = () => {
    // Prevent saving if warehouse isn't selected for stock items
    if (isStockItem && (!formValues.warehouse || formValues.warehouse.trim() === '')) {
      setLoadError('Seleccioná un almacén antes de guardar la configuración del ítem')
      return
    }

    if (typeof onSave === 'function' && itemIndex !== null && itemIndex !== undefined) {
      const payload = { ...formValues }
      if (!showPropiedad) delete payload.propiedad
      onSave(itemIndex, payload)
    }
    onClose?.()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configuración del Item"
      subtitle={item ? `${item.item_code || ''} ${item.description || ''}`.trim() : ''}
      size="md"
    >
      <div className="space-y-6">

        {loadError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {loadError}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta de Ingresos</label>
          <select
            value={formValues.income_account}
            onChange={(e) => handleChange('income_account', e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="">Seleccionar cuenta…</option>
            {availableAccounts.map((account) => (
              <option key={account.name} value={account.name}>
                {account.account_name || account.name}
              </option>
            ))}
          </select>
        </div>

        {isStockItem && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Almacén</label>
            <select
              value={formValues.warehouse}
              onChange={(e) => handleChange('warehouse', e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              {warehouseOptions.map((wh) => (
                <option key={wh.value} value={wh.value}>
                  {wh.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Almacén específico para este ítem. (No puede permanecer vacío)</p>
            {!formValues.warehouse && (
              <p className="text-xs text-red-600 mt-1">Debe seleccionar un almacén para este ítem</p>
            )}
          </div>
        )}

        {showPropiedad && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Propiedad</label>
            <select
              value={formValues.propiedad || 'Propio'}
              onChange={(e) => handleChange('propiedad', e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              {(propiedadOptions || []).map((option) => (
                <option key={String(option)} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Si marcás consignación, el remito se imputará al almacén CON/VCON correspondiente.</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Centro de Costo</label>
          <select
            value={formValues.cost_center}
            onChange={(e) => handleChange('cost_center', e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="">Seleccionar centro de costo…</option>
            {availableCostCenters.map((cc) => (
              <option key={cc.name} value={cc.name}>
                {cc.cost_center_name || cc.name}
              </option>
            ))}
          </select>
        </div>

        {isStockItem && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Valoración de Inventario</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formValues.valuation_rate}
              onChange={(e) => handleChange('valuation_rate', e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="0.00"
            />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={(isStockItem && !formValues.warehouse) || isLoadingOptions}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default SalesItemSettingsModal
