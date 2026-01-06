import { useState, useEffect, useMemo } from 'react'
import { Save } from 'lucide-react'
import Modal from '../../Modal.jsx'
import { quickCreateItem } from '../../../api/itemQuickCreateApi.js'
import useCurrencies from '../../../hooks/useCurrencies'
import CreatableSelect from 'react-select/creatable'

const initialState = {
  item_code: '',
  item_name: '',
  description: '',
  item_group: '',
  stock_uom: '',
  is_stock_item: 'Producto',
  brand: '',
  platform: '',
  url: '',
  purchase_price: '',
  price_list: '',
  currency: '',
  sync_sales_prices: true
}

const normalizeText = (value = '') => value.toString().trim().toLowerCase()

const cleanItemGroupLabel = (value = '') => {
  if (!value) return ''
  return value.replace(/\s*-\s*[A-Z0-9]{1,5}$/, '').trim() || value
}

const QuickItemCreateModal = ({
  isOpen,
  onClose,
  fetchWithAuth,
  activeCompany,
  supplier,
  initialItemCode = '',
  initialDescription = '',
  initialRate = '',
  suggestedPriceList = '',
  defaultCurrency = '',
  initialUom = 'Unidad',
  availablePriceLists = [],
  showNotification,
  onCreated,
  contextLabel = 'Documento'
}) => {
  const [formValues, setFormValues] = useState(initialState)
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadingRefs, setLoadingRefs] = useState(false)
  const [itemGroups, setItemGroups] = useState([])
  const [uoms, setUoms] = useState([])
  const [priceLists, setPriceLists] = useState(availablePriceLists || [])
  const [brands, setBrands] = useState([])
  // Track whether the user created a custom item group and its temporary name
  const [isCustomItemGroup, setIsCustomItemGroup] = useState(false)
  const [customItemGroupName, setCustomItemGroupName] = useState('')
  const { currencies, loading: currenciesLoading } = useCurrencies()

  useEffect(() => {
    if (availablePriceLists && availablePriceLists.length > 0) {
      setPriceLists(availablePriceLists)
    }
  }, [availablePriceLists])

  useEffect(() => {
    if (!isOpen) return
    setFormValues(prev => ({
      ...initialState,
      item_code: initialItemCode || '',
      // Prefill item_name from initialDescription if present (user requested)
      item_name: (initialDescription && initialDescription.trim()) ? initialDescription : (initialItemCode || ''),
      description: initialDescription || '',
      purchase_price: initialRate ? Number(initialRate).toFixed(2) : '',
      price_list: suggestedPriceList || '',
      currency: defaultCurrency || '',
      stock_uom: initialUom || 'Unidad',
      brand: ''
    }))
    setErrors({})
    // Reset custom group flags when the modal opens
    setIsCustomItemGroup(false)
    setCustomItemGroupName('')
  }, [isOpen, initialItemCode, initialDescription, initialRate, suggestedPriceList, defaultCurrency])

  useEffect(() => {
    if (!isOpen) return
    const fetchData = async () => {
      setLoadingRefs(true)
      try {
        const promises = []
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
        promises.push(
          fetchWithAuth('/api/inventory/uoms')
            .then(res => res.json())
            .then(data => setUoms(Array.isArray(data.data) ? data.data : []))
            .catch(() => setUoms([]))
        )
        if (!availablePriceLists || availablePriceLists.length === 0) {
          promises.push(
            fetchWithAuth('/api/inventory/purchase-price-lists/all')
              .then(res => res.json())
              .then(data => setPriceLists(Array.isArray(data.data) ? data.data : []))
              .catch(() => setPriceLists([]))
          )
        } else {
          setPriceLists(availablePriceLists)
        }
        promises.push(
          fetchWithAuth('/api/brands')
            .then(res => res.json())
            .then(data => setBrands(Array.isArray(data.data) ? data.data : []))
            .catch(() => setBrands([]))
        )
        await Promise.all(promises)
      } catch (error) {
        console.error('Error cargando datos de referencia para QuickItemCreateModal:', error)
      } finally {
        setLoadingRefs(false)
      }
    }
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const currencyOptions = useMemo(() => {
    const parsed = (currencies || []).map((currency) => ({
      value: currency?.name || '',
      label: currency?.name || ''
    })).filter(option => option.value)

    if (parsed.length === 0) {
      return currenciesLoading ? [] : []
    }

    return parsed
  }, [currencies, currenciesLoading])

  useEffect(() => {
    if (!isOpen) return
    if (currencyOptions.length === 0) return

    setFormValues(prev => {
      let desired = prev.currency || defaultCurrency || currencyOptions[0].value

      if (defaultCurrency && currencyOptions.some(opt => opt.value === defaultCurrency)) {
        desired = defaultCurrency
      }

      if (!currencyOptions.some(opt => opt.value === desired)) {
        desired = currencyOptions[0].value
      }

      if (!desired || prev.currency === desired) {
        return prev
      }

      return { ...prev, currency: desired }
    })
  }, [currencyOptions, defaultCurrency, isOpen])

  const handleChange = (field, value) => {
    setFormValues(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: null }))
  }

  const optionGroups = useMemo(() => {
    const normalizedGroups = (itemGroups || [])
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

    return normalizedGroups.sort((a, b) => {
      const labelA = a.label || ''
      const labelB = b.label || ''
      return labelA.localeCompare(labelB)
    })
  }, [itemGroups])

  const brandOptions = useMemo(() => (
    (brands || []).map(brand => ({
      value: brand?.name || brand?.brand || '',
      label: brand?.brand || brand?.name || ''
    })).filter(option => option.value)
  ), [brands])

  const categorySelectValue = formValues.item_group
    ? { value: formValues.item_group, label: cleanItemGroupLabel(formValues.item_group) || formValues.item_group }
    : null

  const brandSelectValue = formValues.brand
    ? { value: formValues.brand, label: formValues.brand }
    : null

  const uomOptions = useMemo(() => {
    return uoms.map(uom => ({
      value: uom.name || uom.uom_name,
      label: uom.uom_name || uom.name
    }))
  }, [uoms])

  const availablePriceListOptions = useMemo(() => {
    return priceLists.map(list => ({
      value: list.name || list.price_list_name,
      label: list.price_list_name || list.name
    }))
  }, [priceLists])

  const validate = () => {
    const validationErrors = {}
    if (!formValues.item_code.trim()) {
      validationErrors.item_code = 'Ingresá un código'
    }
    if (!formValues.item_name.trim()) {
      validationErrors.item_name = 'Ingresá un nombre para el item'
    }
    if (!formValues.item_group.trim()) {
      validationErrors.item_group = 'Seleccioná la categoría'
    }
    if (!formValues.stock_uom.trim()) {
      validationErrors.stock_uom = 'Seleccioná la unidad'
    }
    if (!formValues.purchase_price || Number.isNaN(Number(formValues.purchase_price))) {
      validationErrors.purchase_price = 'Ingresá un precio de compra'
    } else if (Number(formValues.purchase_price) <= 0) {
      validationErrors.purchase_price = 'El precio debe ser mayor a 0'
    }
    if (!formValues.price_list.trim()) {
      validationErrors.price_list = 'Seleccioná la lista de precios'
    }
    if (!formValues.currency || (currencyOptions.length > 0 && !currencyOptions.some(option => option.value === formValues.currency))) {
      validationErrors.currency = 'Seleccioná la moneda'
    }
    return validationErrors
  }

  const findMatchingItemGroup = (value) => {
    if (!value) return null
    const target = normalizeText(value)
    return optionGroups.find(group =>
      normalizeText(group.value) === target ||
      normalizeText(group.label) === target
    ) || null
  }

  const createRemoteItemGroup = async (groupName) => {
    if (!activeCompany) {
      throw new Error('Seleccioná la compañía antes de crear categorías nuevas')
    }

    const response = await fetchWithAuth('/api/inventory/item-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_group_name: groupName,
        is_group: 0,
        custom_company: activeCompany
      })
    })

    let data = {}
    try {
      if (!response) {
        throw new Error('Sin respuesta del servidor')
      }
      data = await response.json()
    } catch (error) {
      data = {}
    }

    if (!response || !response.ok || data.success === false) {
      throw new Error(data?.message || 'No se pudo crear la categoría')
    }

    const created = data.data || {}
    setItemGroups(prev => [...prev, created])
    setFormValues(prev => ({ ...prev, item_group: created.name || created.item_group_name || groupName }))
    // Clear custom flags after successful creation
    setIsCustomItemGroup(false)
    setCustomItemGroupName('')
    return created.name || created.item_group_name || groupName
  }

  const resolveItemGroupDocName = async (value) => {
    const trimmed = (value || '').trim()
    if (!trimmed) {
      throw new Error('Seleccioná la categoría')
    }

    const match = findMatchingItemGroup(trimmed)
    if (match) {
      if (match.value !== formValues.item_group) {
        setFormValues(prev => ({ ...prev, item_group: match.value }))
      }
      setIsCustomItemGroup(false)
      setCustomItemGroupName('')
      return match.value
    }

    return await createRemoteItemGroup(trimmed)
  }

  const findMatchingBrand = (value) => {
    if (!value) return null
    const target = normalizeText(value)
    return brandOptions.find(option =>
      normalizeText(option.value) === target ||
      normalizeText(option.label) === target
    ) || null
  }

  const createBrandIfNeeded = async (brandName) => {
    const trimmed = brandName.trim()
    if (!trimmed) {
      throw new Error('Ingresá el nombre de la marca')
    }

    const response = await fetchWithAuth('/api/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: trimmed })
    })

    let data = {}
    try {
      data = await response.json()
    } catch (error) {
      data = {}
    }

    if (!response || !response.ok || data.success === false) {
      throw new Error(data?.message || 'No se pudo crear la marca')
    }

    const createdBrand = data.data || {}
    setBrands(prev => [...prev, createdBrand])
    setFormValues(prev => ({ ...prev, brand: createdBrand.name || createdBrand.brand || trimmed }))
    return createdBrand.name || createdBrand.brand || trimmed
  }

  const resolveBrandValue = async (value) => {
    const trimmed = (value || '').trim()
    if (!trimmed) {
      return ''
    }

    const match = findMatchingBrand(trimmed)
    if (match) {
      if (match.value !== formValues.brand) {
        setFormValues(prev => ({ ...prev, brand: match.value }))
      }
      return match.value
    }

    return await createBrandIfNeeded(trimmed)
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

    setIsSubmitting(true)
    try {
      const finalItemGroup = await resolveItemGroupDocName(formValues.item_group)
      const resolvedBrand = await resolveBrandValue(formValues.brand)

      const payload = {
        company: activeCompany,
        supplier,
        price_list: formValues.price_list,
        currency: formValues.currency || '',
        price_list_rate: Number(formValues.purchase_price),
        sync_sales_prices: formValues.sync_sales_prices,
        item: {
          item_code: formValues.item_code.trim(),
          item_name: formValues.item_name.trim(),
          description: formValues.description.trim(),
          item_group: finalItemGroup,
          stock_uom: formValues.stock_uom || initialUom || 'Unidad',
          is_stock_item: formValues.is_stock_item,
          brand: resolvedBrand,
          platform: formValues.platform,
          url: formValues.url
        }
      }

      const result = await quickCreateItem(fetchWithAuth, payload)
      showNotification?.('Item creado y agregado a la lista de precios', 'success')
      onCreated?.(result)
      onClose()
    } catch (error) {
      console.error('QuickItemCreateModal error:', error)
      showNotification?.(error.message || 'No se pudo crear el item', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Crear item desde documento"
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">
          {contextLabel}: {supplier || 'Proveedor no seleccionado'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Descripción</label>
            <textarea
              value={formValues.description}
              onChange={(e) => handleChange('description', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Categoría</label>
            <CreatableSelect
              value={categorySelectValue}
              onChange={(selected) => handleChange('item_group', selected?.value || '')}
              onCreateOption={(inputValue) => {
                handleChange('item_group', inputValue)
                setItemGroups(prev => [...prev, { name: inputValue, item_group_name: inputValue }])
                // Mark that user created a custom item group (temporarily)
                setIsCustomItemGroup(true)
                setCustomItemGroupName(inputValue)
              }}
              options={optionGroups}
              placeholder="Seleccionar categoría"
              classNamePrefix="react-select"
              menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
              menuPosition="fixed"
              styles={{
                menuPortal: base => ({ ...base, zIndex: 99999 })
              }}
            />
            {errors.item_group && <p className="mt-1 text-xs text-red-500">{errors.item_group}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Unidad (UOM)</label>
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
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Tipo</label>
            <select
              value={formValues.is_stock_item}
              onChange={(e) => handleChange('is_stock_item', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="Producto">Producto (maneja stock)</option>
              <option value="Servicio">Servicio</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Precio de compra</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formValues.purchase_price}
              onChange={(e) => handleChange('purchase_price', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.purchase_price && <p className="mt-1 text-xs text-red-500">{errors.purchase_price}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Moneda</label>
            <select
              value={formValues.currency}
              onChange={(e) => handleChange('currency', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              disabled={currencyOptions.length === 0}
            >
              {currenciesLoading && (
                <option value="">Cargando monedas...</option>
              )}
              {!currenciesLoading && currencyOptions.length === 0 && (
                <option value="">No hay monedas disponibles</option>
              )}
              {!currenciesLoading && currencyOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errors.currency && <p className="mt-1 text-xs text-red-500">{errors.currency}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Lista de compra</label>
            <select
              value={formValues.price_list}
              onChange={(e) => handleChange('price_list', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              disabled={loadingRefs}
            >
              <option value="">Seleccionar lista</option>
              {availablePriceListOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errors.price_list && <p className="mt-1 text-xs text-red-500">{errors.price_list}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Marca</label>
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
              styles={{
                menuPortal: base => ({ ...base, zIndex: 99999 })
              }}
            />
            {errors.brand && <p className="mt-1 text-xs text-red-500">{errors.brand}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Plataforma</label>
            <input
              type="text"
              value={formValues.platform}
              onChange={(e) => handleChange('platform', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1">URL</label>
            <input
              type="text"
              value={formValues.url}
              onChange={(e) => handleChange('url', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://"
            />
          </div>
          <div className="md:col-span-2 flex items-center gap-2 mt-2">
            <input
              id="sync-sales-prices"
              type="checkbox"
              checked={formValues.sync_sales_prices}
              onChange={(e) => handleChange('sync_sales_prices', e.target.checked)}
            />
            <label htmlFor="sync-sales-prices" className="text-sm text-gray-700">
              Actualizar automáticamente las listas de precios de venta (si están configuradas)
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50"
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-70"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              'Creando...'
            ) : (
              <>
                <Save className="w-4 h-4" />
                Crear item
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default QuickItemCreateModal
