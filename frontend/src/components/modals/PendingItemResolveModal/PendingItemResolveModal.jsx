/**
 * PendingItemResolveModal
 * 
 * Modal para resolver items marcados como PEND-xxxxx por integraciones externas.
 * Permite al usuario:
 * 1. Crear el item como servicio (sin stock)
 * 2. Crear el item como producto con stock inicial
 */
import React, { useState, useEffect, useMemo } from 'react'
import { AlertTriangle, Package, FileText, Save, Loader2, Info } from 'lucide-react'
import Modal from '../../Modal.jsx'
import CreatableSelect from 'react-select/creatable'
import { fetchWarehouses } from '../../../apiUtils.js'

const normalizeText = (value = '') => value.toString().trim().toLowerCase()

const cleanItemGroupLabel = (value = '') => {
  if (!value) return ''
  return value.replace(/\s*-\s*[A-Z0-9]{1,5}$/, '').trim() || value
}

const PendingItemResolveModal = ({
  isOpen,
  onClose,
  fetchWithAuth,
  activeCompany,
  showNotification,
  // Datos del item pendiente
  pendingItem,
  // Cantidad sugerida del documento original
  suggestedQty = 1,
  // Callback cuando se resuelve el item
  onResolved
}) => {
  const [mode, setMode] = useState(null) // 'service' | 'stock'
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadingRefs, setLoadingRefs] = useState(false)
  
  // Datos de referencia
  const [itemGroups, setItemGroups] = useState([])
  const [uoms, setUoms] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [brands, setBrands] = useState([])
  
  // Formulario
  const [formValues, setFormValues] = useState({
    item_code: '',
    item_name: '',
    description: '',
    item_group: '',
    stock_uom: 'Unidad',
    brand: '',
    // Para modo stock
    initial_qty: '',
    warehouse: '',
    valuation_rate: ''
  })
  const [errors, setErrors] = useState({})

  // Extraer info del item pendiente
  const extractPendingInfo = (item) => {
    if (!item) return { cleanCode: '', name: '', description: '', rate: 0 }
    
    const itemCode = item.item_code || ''
    // Remover PEND- del código y la abreviatura de empresa
    let cleanCode = itemCode.replace(/^PEND-/i, '')
    cleanCode = cleanCode.replace(/\s*-\s*[A-Z]{2,}$/, '').trim()
    
    return {
      cleanCode,
      name: item.item_name || item.description || cleanCode,
      description: item.description || item.item_name || '',
      rate: parseFloat(item.rate) || 0
    }
  }

  const pendingInfo = useMemo(() => extractPendingInfo(pendingItem), [pendingItem])

  // Resetear form cuando se abre el modal
  useEffect(() => {
    if (!isOpen) {
      setMode(null)
      setErrors({})
      return
    }
    
    setFormValues({
      item_code: pendingInfo.cleanCode,
      item_name: pendingInfo.name,
      description: pendingInfo.description,
      item_group: '',
      stock_uom: 'Unidad',
      brand: '',
      initial_qty: suggestedQty.toString(),
      warehouse: '',
      valuation_rate: pendingInfo.rate ? pendingInfo.rate.toFixed(2) : ''
    })
    setErrors({})
  }, [isOpen, pendingInfo, suggestedQty])

  // Cargar datos de referencia
  useEffect(() => {
    if (!isOpen) return
    
    const fetchData = async () => {
      setLoadingRefs(true)
      try {
        const promises = []
        
        // Item Groups
        const groupParams = new URLSearchParams({ kind: 'leafs' })
        if (activeCompany) {
          groupParams.set('company', activeCompany)
        }
        promises.push(
          fetchWithAuth(`/api/inventory/item-groups?${groupParams.toString()}`)
            .then(res => res.json())
            .then(data => setItemGroups(Array.isArray(data.data) ? data.data : []))
            .catch(() => setItemGroups([]))
        )
        
        // UOMs
        promises.push(
          fetchWithAuth('/api/inventory/uoms')
            .then(res => res.json())
            .then(data => setUoms(Array.isArray(data.data) ? data.data : []))
            .catch(() => setUoms([]))
        )
        
        // Warehouses - usar la función centralizada que agrupa almacenes de consignación
        promises.push(
          fetchWarehouses(fetchWithAuth, activeCompany)
            .then(warehouseData => {
              // warehouseData tiene { flat, grouped, all }
              // flat incluye todos los warehouses con warehouse_name y display_name
              setWarehouses(warehouseData.flat || [])
            })
            .catch(() => setWarehouses([]))
        )
        
        // Brands
        promises.push(
          fetchWithAuth('/api/brands')
            .then(res => res.json())
            .then(data => setBrands(Array.isArray(data.data) ? data.data : []))
            .catch(() => setBrands([]))
        )
        
        await Promise.all(promises)
      } catch (error) {
        console.error('Error cargando datos de referencia:', error)
      } finally {
        setLoadingRefs(false)
      }
    }
    
    fetchData()
  }, [isOpen, fetchWithAuth, activeCompany])

  const handleChange = (field, value) => {
    setFormValues(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: null }))
  }

  const optionGroups = useMemo(() => {
    const normalized = (itemGroups || [])
      .map(group => {
        const value = group?.name || group?.item_group_name || ''
        if (!value) return null
        const rawLabel = group?.item_group_name || group?.name || ''
        return {
          value,
          label: cleanItemGroupLabel(rawLabel) || rawLabel || value
        }
      })
      .filter(Boolean)
    
    return normalized.sort((a, b) => (a.label || '').localeCompare(b.label || ''))
  }, [itemGroups])

  const brandOptions = useMemo(() => (
    (brands || []).map(brand => ({
      value: brand?.name || brand?.brand || '',
      label: brand?.brand || brand?.name || ''
    })).filter(option => option.value)
  ), [brands])

  const uomOptions = useMemo(() => (
    uoms.map(uom => ({
      value: uom.name || uom.uom_name,
      label: uom.uom_name || uom.name
    }))
  ), [uoms])

  const warehouseOptions = useMemo(() => (
    warehouses.map(wh => ({
      value: wh.name,
      label: wh.warehouse_name || wh.name
    }))
  ), [warehouses])

  const categorySelectValue = formValues.item_group
    ? { value: formValues.item_group, label: cleanItemGroupLabel(formValues.item_group) || formValues.item_group }
    : null

  const brandSelectValue = formValues.brand
    ? { value: formValues.brand, label: formValues.brand }
    : null

  const validate = () => {
    const validationErrors = {}
    
    if (!formValues.item_code.trim()) {
      validationErrors.item_code = 'Ingresá un código'
    }
    if (!formValues.item_name.trim()) {
      validationErrors.item_name = 'Ingresá un nombre'
    }
    if (!formValues.item_group.trim()) {
      validationErrors.item_group = 'Seleccioná la categoría'
    }
    if (!formValues.stock_uom.trim()) {
      validationErrors.stock_uom = 'Seleccioná la unidad'
    }
    
    if (mode === 'stock') {
      if (!formValues.warehouse) {
        validationErrors.warehouse = 'Seleccioná el almacén'
      }
      const qty = parseFloat(formValues.initial_qty)
      if (!qty || qty < suggestedQty) {
        validationErrors.initial_qty = `La cantidad debe ser al menos ${suggestedQty}`
      }
      if (!formValues.valuation_rate || parseFloat(formValues.valuation_rate) <= 0) {
        validationErrors.valuation_rate = 'Ingresá el costo unitario'
      }
    }
    
    return validationErrors
  }

  const handleSubmit = async () => {
    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    if (!activeCompany) {
      showNotification?.('No se detectó la compañía activa', 'error')
      return
    }

    if (!pendingItem?.item_code) {
      showNotification?.('No se detectó el item pendiente', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        company: activeCompany,
        pending_item_code: pendingItem.item_code,
        mode: mode, // 'service' or 'stock'
        item: {
          item_code: formValues.item_code.trim(),
          item_name: formValues.item_name.trim(),
          description: formValues.description.trim() || formValues.item_name.trim(),
          item_group: formValues.item_group,
          stock_uom: formValues.stock_uom || 'Unidad',
          brand: formValues.brand || '',
          is_stock_item: mode === 'stock' ? 1 : 0
        }
      }

      // Si es modo stock, incluir datos de stock inicial
      if (mode === 'stock') {
        payload.stock = {
          warehouse: formValues.warehouse,
          qty: parseFloat(formValues.initial_qty),
          valuation_rate: parseFloat(formValues.valuation_rate)
        }
      }

      const response = await fetchWithAuth('/api/pending-items/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      let data = {}
      try {
        data = await response.json()
      } catch (e) {
        data = {}
      }

      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'No se pudo resolver el item pendiente')
      }

      showNotification?.('Item creado correctamente', 'success')
      onResolved?.(data.data)
      onClose()
    } catch (error) {
      console.error('Error resolviendo item pendiente:', error)
      showNotification?.(error.message || 'Error al crear el item', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resolver Item Pendiente"
      size="md"
    >
      <div className="flex flex-col gap-4">
        {/* Alerta informativa */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold mb-1">Este item fue detectado por una integración externa</p>
            <p className="text-amber-700">
              El producto <strong>{pendingInfo.name}</strong> no existía en el inventario cuando se creó este documento.
              Elegí cómo querés crearlo para poder continuar.
            </p>
          </div>
        </div>

        {/* Selector de modo */}
        {!mode && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setMode('service')}
              className="flex flex-col items-center gap-3 p-6 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition group"
            >
              <FileText className="w-10 h-10 text-gray-400 group-hover:text-blue-600" />
              <div className="text-center">
                <p className="font-semibold text-gray-800 group-hover:text-blue-800">Servicio</p>
                <p className="text-xs text-gray-500 mt-1">No maneja stock. Ideal para servicios o productos que no se inventarían.</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode('stock')}
              className="flex flex-col items-center gap-3 p-6 border-2 border-gray-200 rounded-xl hover:border-emerald-400 hover:bg-emerald-50 transition group"
            >
              <Package className="w-10 h-10 text-gray-400 group-hover:text-emerald-600" />
              <div className="text-center">
                <p className="font-semibold text-gray-800 group-hover:text-emerald-800">Producto con Stock</p>
                <p className="text-xs text-gray-500 mt-1">Maneja inventario. Debés ingresar la cantidad inicial.</p>
              </div>
            </button>
          </div>
        )}

        {/* Formulario según modo */}
        {mode && (
          <>
            <div className="flex items-center gap-2 mb-2">
              {mode === 'service' ? (
                <FileText className="w-5 h-5 text-blue-600" />
              ) : (
                <Package className="w-5 h-5 text-emerald-600" />
              )}
              <span className="font-semibold text-gray-800">
                {mode === 'service' ? 'Crear como Servicio' : 'Crear como Producto con Stock'}
              </span>
              <button
                type="button"
                onClick={() => setMode(null)}
                className="ml-auto text-xs text-blue-600 hover:underline"
              >
                Cambiar
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Código */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Código</label>
                <input
                  type="text"
                  value={formValues.item_code}
                  onChange={(e) => handleChange('item_code', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.item_code && <p className="mt-1 text-xs text-red-500">{errors.item_code}</p>}
              </div>

              {/* Nombre */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre</label>
                <input
                  type="text"
                  value={formValues.item_name}
                  onChange={(e) => handleChange('item_name', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {errors.item_name && <p className="mt-1 text-xs text-red-500">{errors.item_name}</p>}
              </div>

              {/* Descripción */}
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Descripción</label>
                <textarea
                  value={formValues.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>

              {/* Categoría */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Categoría</label>
                <CreatableSelect
                  value={categorySelectValue}
                  onChange={(selected) => handleChange('item_group', selected?.value || '')}
                  onCreateOption={(inputValue) => {
                    handleChange('item_group', inputValue)
                    setItemGroups(prev => [...prev, { name: inputValue, item_group_name: inputValue }])
                  }}
                  options={optionGroups}
                  placeholder="Seleccionar categoría"
                  classNamePrefix="react-select"
                  menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                  menuPosition="fixed"
                  styles={{ menuPortal: base => ({ ...base, zIndex: 99999 }) }}
                  isLoading={loadingRefs}
                />
                {errors.item_group && <p className="mt-1 text-xs text-red-500">{errors.item_group}</p>}
              </div>

              {/* Unidad */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Unidad</label>
                <select
                  value={formValues.stock_uom}
                  onChange={(e) => handleChange('stock_uom', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Seleccionar</option>
                  {uomOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {errors.stock_uom && <p className="mt-1 text-xs text-red-500">{errors.stock_uom}</p>}
              </div>

              {/* Marca */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Marca (opcional)</label>
                <CreatableSelect
                  value={brandSelectValue}
                  onChange={(selected) => handleChange('brand', selected?.value || '')}
                  onCreateOption={(inputValue) => {
                    handleChange('brand', inputValue)
                    setBrands(prev => [...prev, { name: inputValue, brand: inputValue }])
                  }}
                  options={brandOptions}
                  placeholder="Sin marca"
                  classNamePrefix="react-select"
                  menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                  menuPosition="fixed"
                  isClearable
                  styles={{ menuPortal: base => ({ ...base, zIndex: 99999 }) }}
                  isLoading={loadingRefs}
                />
              </div>

              {/* Campos adicionales para modo stock */}
              {mode === 'stock' && (
                <>
                  <div className="md:col-span-2 border-t border-gray-200 pt-4 mt-2">
                    <div className="flex items-center gap-2 mb-3">
                      <Info className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-semibold text-gray-700">Stock Inicial</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      Se creará un ingreso de stock automático con los siguientes datos.
                    </p>
                  </div>

                  {/* Almacén */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Almacén</label>
                    <select
                      value={formValues.warehouse}
                      onChange={(e) => handleChange('warehouse', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Seleccionar almacén</option>
                      {warehouseOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {errors.warehouse && <p className="mt-1 text-xs text-red-500">{errors.warehouse}</p>}
                  </div>

                  {/* Cantidad inicial */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">
                      Cantidad inicial (mín. {suggestedQty})
                    </label>
                    <input
                      type="number"
                      min={suggestedQty}
                      value={formValues.initial_qty}
                      onChange={(e) => handleChange('initial_qty', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {errors.initial_qty && <p className="mt-1 text-xs text-red-500">{errors.initial_qty}</p>}
                  </div>

                  {/* Costo unitario */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Costo unitario</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formValues.valuation_rate}
                      onChange={(e) => handleChange('valuation_rate', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {errors.valuation_rate && <p className="mt-1 text-xs text-red-500">{errors.valuation_rate}</p>}
                  </div>
                </>
              )}
            </div>

            {/* Botones de acción */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 mt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50"
                disabled={isSubmitting}
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-70 ${
                  mode === 'stock'
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500'
                }`}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Crear Item
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

export default PendingItemResolveModal
