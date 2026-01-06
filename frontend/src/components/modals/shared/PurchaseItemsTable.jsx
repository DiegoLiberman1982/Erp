// --- COMPONENTE COMÚN PARA TABLAS DE ÍTEMS DE COMPRA ---
// Usado por: PurchaseInvoiceModal, PurchaseOrderModal, RemitoModal (Purchase Receipt)
import { Plus, Settings, Trash2, Table, Save, AlertCircle } from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import AsyncSelect from 'react-select/async'
import { components as ReactSelectComponents } from 'react-select'
import { formatDecimalValue } from '../../../utils/decimalInput.js'

/**
 * Helper para detectar si un item es pendiente de mapear
 * Los items pendientes tienen el formato: PEND-xxxxxxx - ABBR
 * o pertenecen al grupo "PENDIENTES DE MAPEAR - ABBR"
 */
const isPendingItem = (item) => {
  if (!item) return false
  const itemCode = (item.item_code || '').trim().toUpperCase()
  const itemGroup = (item.item_group || '').trim().toUpperCase()
  const isStockItem = item.is_stock_item
  
  // Detectar por código PEND-
  if (itemCode.startsWith('PEND-')) return true
  
  // Detectar por grupo PENDIENTES DE MAPEAR
  if (itemGroup.includes('PENDIENTES DE MAPEAR')) return true
  
  // Si tiene código PEND y no es stock item
  if (itemCode.includes('PEND') && isStockItem === 0) return true
  
  return false
}

/**
 * PurchaseItemsTable - Tabla unificada para documentos de compra
 * 
 * @param {Object} props
 * @param {Array} props.items - Array de items (alternativa a formData.items)
 * @param {Object} props.formData - Datos del formulario incluyendo items[] (alternativa a items)
 * @param {Function} props.onItemChange - Callback para cambios en items (alias de handleItemChange)
 * @param {Function} props.handleItemChange - Callback para cambios en items
 * @param {Function} props.onAddItem - Callback para agregar item (alias de addItem)
 * @param {Function} props.addItem - Callback para agregar item
 * @param {Function} props.onRemoveItem - Callback para eliminar item (alias de removeItem)
 * @param {Function} props.removeItem - Callback para eliminar item
 * @param {string} props.activeCompany - Compañía activa
 * @param {Function} props.fetchWithAuth - Función fetch autenticada
 * @param {Function} props.showNotification - Función para mostrar notificaciones
 * 
 * Configuración de columnas:
 * @param {boolean} props.showPricing - Mostrar columnas de precio/IVA/descuento/total (default: true)
 * @param {boolean} props.showWarehouse - Mostrar columna de almacén (default: false)
 * @param {boolean} props.showDiscount - Mostrar columna de descuento (default: true, solo si showPricing)
 * @param {boolean} props.requireWarehouse - Almacén es requerido (default: false)
 * 
 * Datos de referencia:
 * @param {Array} props.availableIVARates - Tasas de IVA disponibles
 * @param {Array} props.availableWarehouses - Almacenes disponibles
 * @param {Array} props.availableUOMs - UOMs disponibles (opcional, se cargan automáticamente si no se proveen)
 * @param {Object} props.selectedPriceListDetails - Detalles de la lista de precios seleccionada
 * @param {string} props.priceListName - Nombre de la lista de precios
 * @param {string} props.defaultIvaRate - Tasa de IVA por defecto
 * 
 * Funcionalidades:
 * @param {Function} props.onRequestQuickCreate - Callback para crear item nuevo
 * @param {Function} props.onOpenItemSettings - Callback para abrir configuración de item
 * @param {Function} props.onSaveItemSettings - Callback para guardar configuración
 * @param {Function} props.onItemSelected - Callback cuando se selecciona un item del dropdown
 * @param {Function} props.onResolvePendingItem - Callback para resolver un item pendiente (PEND-)
 * @param {Function} props.searchItems - Función de búsqueda de items
 * @param {Function} props.fetchItemPrice - Función para obtener precio de item en lista
 */
const PurchaseItemsTable = ({
  // Datos - soporta ambos formatos
  items: itemsProp,
  formData: formDataProp,
  // Callbacks - soporta ambos nombres
  onItemChange,
  handleItemChange: handleItemChangeProp,
  onAddItem,
  addItem: addItemProp,
  onRemoveItem,
  removeItem: removeItemProp,
  // Contexto
  activeCompany,
  fetchWithAuth,
  showNotification,
  // Configuración de columnas
  showPricing = true,
  showWarehouse = false,
  showDiscount = true,
  requireWarehouse = false,
  // Datos de referencia
  availableIVARates = [],
  availableWarehouses = [],
  availableUOMs: availableUOMsProp,
  selectedPriceListDetails = null,
  priceListName = '',
  defaultIvaRate = '',
  // Funcionalidades
  onRequestQuickCreate,
  onOpenItemSettings,
  onSaveItemSettings,
  onItemSelected,
  onResolvePendingItem,
  searchItems,
  fetchItemPrice,
  // Título personalizado
  title = 'Ítems',
  // Formateador de moneda
  formatCurrencyValue
}) => {
  // Normalizar props para soportar ambos formatos
  const items = itemsProp || formDataProp?.items || []
  const resolvedPriceList = priceListName || formDataProp?.price_list || ''
  const handleItemChange = onItemChange || handleItemChangeProp
  const addItem = onAddItem || addItemProp
  const removeItem = onRemoveItem || removeItemProp

  const [localAvailableUOMs, setLocalAvailableUOMs] = useState([])
  const availableUOMs = availableUOMsProp || localAvailableUOMs
  const [pasteMode, setPasteMode] = useState(false)
  const priceFetchCache = useRef(new Set())
  const exchangeRateCache = useRef(new Map())

  // Cargar UOMs disponibles (solo si no se proveen desde props)
  useEffect(() => {
    if (availableUOMsProp && availableUOMsProp.length > 0) return
    const fetchUOMs = async () => {
      try {
        const response = await fetchWithAuth('/api/inventory/uoms')
        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            setLocalAvailableUOMs(data.data || [])
          }
        }
      } catch (error) {
        console.error('Error fetching UOMs:', error)
      }
    }
    fetchUOMs()
  }, [fetchWithAuth, availableUOMsProp])

  // Función para verificar si un item tiene almacén válido
  const hasValidWarehouse = (item) => {
    if (item.warehouse && item.warehouse.trim() !== '') {
      return true
    }
    if (item.item_defaults && Array.isArray(item.item_defaults)) {
      const defaultForCompany = item.item_defaults.find(def => def.company === activeCompany)
      if (defaultForCompany && defaultForCompany.default_warehouse && defaultForCompany.default_warehouse.trim() !== '') {
        return true
      }
    }
    return false
  }

  // Función para remover la abreviatura de la compañía
  const removeCompanyAbbr = (text) => {
    if (!text) return text
    return text.replace(/\s*-\s*[A-Z]{2,}$/, '').trim()
  }

  // Edición “tipo input” arriba del select: permite seleccionar texto y re-buscar al escribir
  const [activeSelect, setActiveSelect] = useState(null) // { index, field }
  const [activeSelectInputValue, setActiveSelectInputValue] = useState('')
  const isActiveSelect = useCallback(
    (index, field) => activeSelect?.index === index && activeSelect?.field === field,
    [activeSelect]
  )

  const clearActiveSelect = useCallback(() => {
    setActiveSelect(null)
    setActiveSelectInputValue('')
  }, [])

  const selectInputId = useCallback((index, field) => `purchase-items-${field}-${index}`, [])

  const handleSelectFocus = useCallback((index, field, currentText) => {
    setActiveSelect({ index, field })
    setActiveSelectInputValue(currentText || '')
    const id = selectInputId(index, field)
    setTimeout(() => {
      const el = document.getElementById(id)
      if (el && typeof el.select === 'function') el.select()
    }, 0)
  }, [selectInputId])

  const TooltipControl = useCallback((props) => {
    const title = props.selectProps?.tooltip || ''
    const nextInnerProps = { ...(props.innerProps || {}), title }
    return <ReactSelectComponents.Control {...props} innerProps={nextInnerProps} />
  }, [])

  const PreviewValueContainer = useCallback((props) => {
    return <ReactSelectComponents.ValueContainer {...props}>{props.children}</ReactSelectComponents.ValueContainer>
  }, [])

  // Función para cargar opciones del AsyncSelect (código)
  const loadCodeOptions = async (inputValue) => {
    if (inputValue.length < 2 || !searchItems) return []
    
    try {
      const results = await searchItems(inputValue)
      return (results || []).map(item => ({
        value: item.name,
        label: item.display_code,
        item: item
      }))
    } catch (error) {
      console.error('Error loading code options:', error)
      return []
    }
  }

  // Función para cargar opciones del AsyncSelect (descripción)
  const loadDescriptionOptions = async (inputValue) => {
    if (inputValue.length < 2 || !searchItems) return []
    
    try {
      const results = await searchItems(inputValue)
      return (results || []).map(item => ({
        value: item.name,
        label: removeCompanyAbbr(item.item_name || item.description),
        item: item
      }))
    } catch (error) {
      console.error('Error loading description options:', error)
      return []
    }
  }

  // Estilos custom para react-select (compacto, truncado y sin empujar ancho de tabla)
  const selectStyles = {
    container: (base) => ({
      ...base,
      width: '100%',
      minWidth: 0,
      maxWidth: '100%'
    }),
    control: (base) => ({
      ...base,
      minHeight: '34px',
      height: '34px',
      fontSize: '0.75rem',
      border: '1px solid #d1d5db',
      borderRadius: '0.375rem',
      boxShadow: 'none',
      backgroundColor: 'white',
      userSelect: 'text',
      overflow: 'hidden',
      width: '100%',
      minWidth: 0,
      maxWidth: '100%',
      '&:hover': { borderColor: '#3b82f6' },
      '&:focus-within': { 
        borderColor: '#3b82f6',
        boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.5)'
      }
    }),
    valueContainer: (base) => ({
      ...base,
      padding: '0rem 0.5rem',
      height: '32px',
      minHeight: '32px',
      alignItems: 'center',
      minWidth: 0,
      overflow: 'hidden',
      userSelect: 'text'
    }),
    input: (base) => ({
      ...base,
      margin: 0,
      padding: 0,
      color: '#1f2937',
      opacity: '1 !important',
      minWidth: '2px',
      width: '2px'
    }),
    singleValue: (base) => ({
      ...base,
      color: '#1f2937',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '100%',
      userSelect: 'text'
    }),
    indicatorsContainer: (base) => ({
      ...base,
      height: '32px'
    }),
    dropdownIndicator: (base) => ({
      ...base,
      padding: '2px'
    }),
    clearIndicator: (base) => ({
      ...base,
      padding: '2px'
    }),
    option: (base, state) => ({
      ...base,
      fontSize: '0.75rem',
      padding: '6px 10px',
      backgroundColor: state.isFocused ? '#dbeafe' : 'white',
      color: '#1f2937',
      cursor: 'pointer'
    }),
    menu: (base) => ({
      ...base,
      zIndex: 9999
    }),
    menuPortal: (base) => ({
      ...base,
      zIndex: 9999
    }),
    placeholder: (base) => ({
      ...base,
      color: '#9ca3af'
    })
  }

  // Handler cuando se selecciona un item desde el select
  const handleSelectItem = async (index, selectedOption) => {
    if (!selectedOption) return
    
    const item = selectedOption.item
    
    // Obtener cuenta de gasto si aplica
    let expenseAccount = item.expense_account || ''
    if (!expenseAccount) {
      try {
        const response = await fetchWithAuth(`/api/resource/Item/${encodeURIComponent(item.name)}`)
        if (response.ok) {
          const fullItemData = await response.json()
          if (fullItemData.data && fullItemData.data.item_defaults) {
            const defaultForCompany = fullItemData.data.item_defaults.find(def => def.company === activeCompany)
            if (defaultForCompany && defaultForCompany.expense_account) {
              expenseAccount = defaultForCompany.expense_account
            } else {
              const anyDefault = fullItemData.data.item_defaults.find(def => def.expense_account)
              if (anyDefault) expenseAccount = anyDefault.expense_account
            }
          }
        }
      } catch (error) {
        console.error('Error fetching full item details:', error)
      }
    }
    
    handleItemChange(index, 'item_code', item.display_code)
    handleItemChange(index, 'item_name', removeCompanyAbbr(item.item_name))
    handleItemChange(index, 'description', removeCompanyAbbr(item.item_name))
    handleItemChange(index, 'uom', item.stock_uom || 'Unit')
    handleItemChange(index, 'expense_account', expenseAccount)
    // Resolver el Item Tax Template correspondiente a Compras (custom_transaction_type === 'Compras')
    try {
      const resp = await fetchWithAuth('/api/tax-templates/resolve-for-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_name: item.name, transaction_type: 'Compras' })
      })

      if (resp && resp.ok) {
        const payload = await resp.json()
        if (payload && payload.success && payload.data) {
          const tpl = payload.data.template_name
          const rate = payload.data.iva_rate
          if (tpl) handleItemChange(index, 'item_tax_template', tpl)
          if (rate !== null && rate !== undefined) handleItemChange(index, 'iva_percent', Number(rate).toFixed(2))
        } else {
          // No matching template for Compras -> leave default (no heuristic/fallback)
        }
      }
    } catch (err) {
      console.error('Error resolving item tax template for purchases:', err)
      // Leave defaults as-is (no fallback)
    }
    
    // Asignar almacén por defecto si corresponde
    if (item.item_defaults && Array.isArray(item.item_defaults)) {
      handleItemChange(index, 'item_defaults', item.item_defaults)
      const defaultForCompany = item.item_defaults.find(def => def.company === activeCompany)
      if (defaultForCompany && defaultForCompany.default_warehouse) {
        handleItemChange(index, 'warehouse', defaultForCompany.default_warehouse)
      }
    }

    // Traer precio de la lista si showPricing está activo
    if (showPricing) {
      await fetchAndApplyPrice(index, item.display_code, item.valuation_rate)
    }

    // Llamar callback de onItemSelected si está definido (para lógica adicional del padre)
    if (onItemSelected) {
      onItemSelected(index, item)
    }
  }

  // Manejo de pegado masivo desde Excel (solo en pasteMode)
  const handlePaste = async (e, index) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const lines = pastedText.split(/\r?\n/).filter(line => line.trim())
    
    if (lines.length === 1) {
      handleItemChange(index, 'item_code', lines[0].trim())
      await searchAndFillItem(index, lines[0].trim())
      return
    }

    // Múltiples líneas
    for (let i = 0; i < lines.length; i++) {
      const targetIndex = index + i
      const code = lines[i].trim()
      
      if (targetIndex >= items.length) {
        await addItem()
      }
      
      await new Promise(resolve => setTimeout(resolve, 50))
      handleItemChange(targetIndex, 'item_code', code)
      await searchAndFillItem(targetIndex, code)
    }
  }

  // Manejo de pegado para cantidades (respetando saltos de celda como tabs)
  const handleQtyPaste = (e, index) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const values = pastedText.split(/\t|\r?\n/).filter(val => val.trim())
    
    for (let i = 0; i < values.length; i++) {
      const targetIndex = index + i
      const qty = values[i].trim()
      
      if (targetIndex >= items.length) {
        addItem()
      }
      
      handleItemChange(targetIndex, 'qty', qty)
    }
  }

  // Buscar item por código y llenar campos
  const searchAndFillItem = async (index, code) => {
    if (code.length < 2 || !searchItems) return
    
    try {
      const results = await searchItems(code)
      const exactMatch = (results || []).find(r => 
        r.display_code?.toLowerCase() === code.toLowerCase() ||
        r.name?.toLowerCase() === code.toLowerCase()
      )
      
      if (exactMatch) {
        handleItemChange(index, 'item_code', exactMatch.display_code)
        handleItemChange(index, 'item_name', removeCompanyAbbr(exactMatch.item_name))
        handleItemChange(index, 'description', removeCompanyAbbr(exactMatch.item_name))
        handleItemChange(index, 'uom', exactMatch.stock_uom || 'Unit')
        // Resolver el Item Tax Template para Compras, si existe
        try {
          const respTpl = await fetchWithAuth('/api/tax-templates/resolve-for-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_name: exactMatch.name, transaction_type: 'Compras' })
          })
          if (respTpl && respTpl.ok) {
            const p = await respTpl.json()
            if (p && p.success && p.data) {
              if (p.data.template_name) handleItemChange(index, 'item_tax_template', p.data.template_name)
              if (p.data.iva_rate !== null && p.data.iva_rate !== undefined) handleItemChange(index, 'iva_percent', Number(p.data.iva_rate).toFixed(2))
            }
          }
        } catch (e) {
          // no fallback - leave defaults
        }
        
        if (exactMatch.item_defaults && Array.isArray(exactMatch.item_defaults)) {
          handleItemChange(index, 'item_defaults', exactMatch.item_defaults)
          const defaultForCompany = exactMatch.item_defaults.find(def => def.company === activeCompany)
          if (defaultForCompany && defaultForCompany.default_warehouse) {
            handleItemChange(index, 'warehouse', defaultForCompany.default_warehouse)
          }
        }
        if (showPricing) {
          fetchAndApplyPrice(index, exactMatch.display_code, exactMatch.valuation_rate)
        }
        
        // Llamar onItemSelected si está definido
        if (onItemSelected) {
          onItemSelected(index, exactMatch)
        }
      }
    } catch (error) {
      console.error('Error searching for item:', error)
    }
  }

  // Helper para traer el precio desde la lista seleccionada
  const fetchAndApplyPrice = async (index, code, currentValuation) => {
    if (!resolvedPriceList || !code || !fetchItemPrice) {
      return
    }

    if (selectedPriceListDetails && selectedPriceListDetails.custom_company && selectedPriceListDetails.custom_company.trim().toLowerCase() !== (activeCompany || '').trim().toLowerCase()) {
      return
    }

    const cacheKey = `${resolvedPriceList}::${code}`
    const currentRate = items[index]?.rate
    if (priceFetchCache.current.has(cacheKey) && currentRate) {
      return
    }

    try {
      // fetchItemPrice puede ser (fetchWithAuth, priceList, code) o simplemente (code)
      const priceData = typeof fetchItemPrice === 'function' 
        ? (fetchItemPrice.length >= 3 
            ? await fetchItemPrice(fetchWithAuth, resolvedPriceList, code)
            : await fetchItemPrice(code))
        : null
      if (priceData && priceData.price_list_rate != null) {
        let price = parseFloat(priceData.price_list_rate)

        // Conversión de moneda si es necesario
        const formCurrency = formDataProp?.currency
        if (selectedPriceListDetails && selectedPriceListDetails.currency && formCurrency !== selectedPriceListDetails.currency) {
          const from = (selectedPriceListDetails.currency || '').toString().trim()
          const to = (formCurrency || '').toString().trim()
          if (!from || !to) {
            throw new Error('No se pudo determinar moneda origen/destino para conversión')
          }

          const cacheKeyRate = `${from}::${to}`
          let rate = exchangeRateCache.current.get(cacheKeyRate)
          if (!rate) {
            const resp = await fetchWithAuth(
              `/api/currency/exchange-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
            )
            const payload = await resp.json().catch(() => ({}))
            if (!resp.ok || payload?.success === false) {
              throw new Error(payload?.message || `No se pudo obtener cotización ${from}/${to} (${resp.status})`)
            }
            const fetched = payload.exchange_rate ?? payload.data?.exchange_rate
            if (!(Number(fetched) > 0)) {
              throw new Error(`Cotización inválida para ${from}/${to}`)
            }
            rate = Number(fetched)
            exchangeRateCache.current.set(cacheKeyRate, rate)
          }

          price = price * rate
        }

        const itemPrice = price.toFixed(2)
        handleItemChange(index, 'rate', itemPrice)
        // Guardar precio original para detectar cambios
        handleItemChange(index, '_price_list_rate', itemPrice)
        if (priceData && priceData.item_price_name) {
          handleItemChange(index, '_item_price_docname', priceData.item_price_name)
        }

        const needsValuation = !currentValuation || currentValuation === '' || currentValuation === '0' || currentValuation === 0
        if (needsValuation) {
          handleItemChange(index, 'valuation_rate', itemPrice)
        }
        priceFetchCache.current.add(cacheKey)
      }
    } catch (error) {
      console.error('Error fetching item price:', error)
      showNotification?.(error?.message || 'Error al obtener precio/cotización', 'error')
    }
  }

  // Buscar item por descripción (match exacto) y llenar campos
  const searchAndFillItemByDescription = async (index, descriptionText) => {
    const text = (descriptionText || '').toString().trim()
    if (text.length < 2 || !searchItems) return

    const normalize = (value) => removeCompanyAbbr((value || '').toString()).trim().toLowerCase()

    try {
      const results = await searchItems(text)
      const normalizedInput = normalize(text)
      const exactMatch = (results || []).find(r => normalize(r.item_name || r.description) === normalizedInput)
      if (exactMatch) {
        await handleSelectItem(index, { item: exactMatch })
      }
    } catch (error) {
      console.error('Error searching for item by description:', error)
    }
  }

  // Commit del texto editado en el select (permite tipear, buscar y resolver al salir)
  const handleSelectBlur = async (index, field) => {
    if (!isActiveSelect(index, field)) return

    const inputText = (activeSelectInputValue || '').toString().trim()
    clearActiveSelect()

    if (field === 'item_code') {
      if (!inputText) {
        handleItemChange(index, 'item_code', '')
        return
      }
      handleItemChange(index, 'item_code', inputText)
      await searchAndFillItem(index, inputText)
      return
    }

    if (!inputText) {
      handleItemChange(index, 'description', '')
      return
    }

    handleItemChange(index, 'description', inputText)
    await searchAndFillItemByDescription(index, inputText)
  }

  // Actualizar precio en la lista de precios
  const updatePriceInPriceList = async (index) => {
    try {
      const item = items[index]
      if (!resolvedPriceList) {
        showNotification?.('No hay lista de precios seleccionada', 'error')
        return
      }
      const payload = {
        mode: 'update',
        existing_price_list: resolvedPriceList,
        company: activeCompany,
        items: [
          {
            item_code: item.item_code || '',
            item_name: item.item_name || item.description || '',
            price: item.rate || 0,
            supplier: item.supplier || undefined
          }
        ]
      }

      const resp = await fetchWithAuth('/api/inventory/purchase-price-lists/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!resp) throw new Error('Sin respuesta del servidor')
      const data = await resp.json()
      if (!resp.ok || data.success === false) {
        throw new Error(data.message || 'No se pudo actualizar el precio en la lista')
      }

      handleItemChange(index, '_price_list_rate', item.rate)
      showNotification?.('Precio actualizado en la lista de precios', 'success')
    } catch (error) {
      console.error('Error updating price in price list:', error)
      showNotification?.(error.message || 'Error actualizando precio', 'error')
    }
  }

  // Intentar completar precios para items que ya existen cuando hay lista seleccionada
  useEffect(() => {
    if (!showPricing || !resolvedPriceList) {
      priceFetchCache.current.clear()
      return
    }
    items.forEach((item, idx) => {
      const code = (item.item_code || '').trim()
      const needsPrice = code && (!item.rate || item.rate === '0' || item.rate === '0.00')
      if (needsPrice) {
        fetchAndApplyPrice(idx, code, item.valuation_rate)
      }
    })
  }, [items, resolvedPriceList, selectedPriceListDetails, showPricing])

  // Limpiar cache al cambiar la lista
  useEffect(() => {
    priceFetchCache.current.clear()
  }, [resolvedPriceList])

  // Determinar si hay algún item que necesite acción en la columna especial
  const showActionColumn = (items || []).some(item => {
    const code = (item.item_code || '').trim()
    // Only consider explicit item_name as indication that the item exists in ERPNext.
    // The description may be a mere user-provided text but does not imply the item exists.
    const hasItemName = (item.item_name || '').toString().trim().length > 0
    const canQuickCreate = typeof onRequestQuickCreate === 'function' && code.length >= 1 && !hasItemName
    const canUpdatePrice = showPricing && item._price_list_rate && Number(item._price_list_rate) !== Number(item.rate)
    return canQuickCreate || canUpdatePrice
  })

  const isSelectEditing = activeSelect?.field === 'item_code' || activeSelect?.field === 'description'
  const showWarehouseCol = showWarehouse && !isSelectEditing
  const showPricingCols = showPricing && !isSelectEditing
  const showActionColumnCol = showActionColumn && !isSelectEditing
  const showOptionsCol = !isSelectEditing

  // Calcular ancho de columnas dinámicamente
  const getColumnWidths = () => {
    const base = {
      code: showPricingCols ? '12%' : '15%',
      description: showPricingCols ? '25%' : '35%',
      qty: '8%',
      uom: '10%'
    }
    if (showWarehouseCol) {
      base.warehouse = '15%'
    }
    if (showPricingCols) {
      base.rate = '10%'
      if (showDiscount) {
        base.discount = '8%'
      }
      base.iva = '8%'
      base.total = '10%'
    }
    return base
  }

  const colWidths = getColumnWidths()

  return (
    <div className="flex-grow flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold text-gray-800">{title}</h3>
          <button 
            onClick={() => setPasteMode(!pasteMode)} 
            className={`p-1.5 rounded transition ${pasteMode ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            title={pasteMode ? "Modo pegado activo - Click para volver a búsqueda" : "Activar modo pegado (para pegar desde Excel)"}
          >
            <Table className="w-4 h-4" />
          </button>
        </div>
        <button onClick={addItem} className="flex items-center gap-2 text-xs font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded-md hover:bg-blue-50">
          <Plus className="w-3 h-3" />
          Agregar Ítem
        </button>
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
        <div className="tabla-items-container">
          <table className="tabla-items">
            <thead className="tabla-items-header">
              <tr>
                <th className="tabla-items-th" style={{ width: colWidths.code }}>Código</th>
                <th className="tabla-items-th" style={{ width: colWidths.description }}>Descripción</th>
                <th className="tabla-items-th tabla-items-th-qty">Cant.</th>
                <th className="tabla-items-th tabla-items-th-uom">Unidad</th>
                {showWarehouseCol && (
                  <th className="tabla-items-th" style={{ width: colWidths.warehouse }}>Almacén</th>
                )}
                {showPricingCols && (
                  <>
                    <th className="tabla-items-th" style={{ width: colWidths.rate, textAlign: 'right' }}>P. Unit.</th>
                    {showDiscount && (
                      <th className="tabla-items-th" style={{ width: colWidths.discount, textAlign: 'right' }}>Desc.%</th>
                    )}
                    <th className="tabla-items-th" style={{ width: colWidths.iva, textAlign: 'right' }}>IVA %</th>
                    <th className="tabla-items-th" style={{ width: colWidths.total, textAlign: 'right' }}>Total</th>
                  </>
                )}
                {showActionColumnCol && (
                  <th className="tabla-items-th" style={{ width: '5%', textAlign: 'center' }}></th>
                )}
                {showOptionsCol && <th className="tabla-items-th tabla-items-th-actions">Opc.</th>}
              </tr>
            </thead>
            <tbody className="tabla-items-body">
              {items.map((item, index) => (
                <tr key={index} className="tabla-items-row">
                  {/* Código */}
                  <td className="tabla-items-td">
                    {pasteMode ? (
                      <input
                        type="text"
                        value={item.item_code}
                        onChange={(e) => handleItemChange(index, 'item_code', e.target.value)}
                        onPaste={(e) => handlePaste(e, index)}
                        onBlur={(e) => searchAndFillItem(index, e.target.value)}
                        className="tabla-items-input"
                        placeholder="Código"
                      />
                    ) : (
                      <AsyncSelect
                        cacheOptions
                        loadOptions={loadCodeOptions}
                        onChange={(option) => {
                          clearActiveSelect()
                          if (option) {
                            handleSelectItem(index, option)
                          } else {
                            handleItemChange(index, 'item_code', '')
                          }
                        }}
                        onInputChange={(value, { action }) => {
                          if (action === 'input-change') {
                            setActiveSelectInputValue(value)
                          }
                          return value
                        }}
                        value={item.item_code ? { value: item.item_code, label: item.item_code } : null}
                        inputId={selectInputId(index, 'item_code')}
                        placeholder="Código"
                        noOptionsMessage={() => "Escribí para buscar..."}
                        loadingMessage={() => "Buscando..."}
                        styles={selectStyles}
                        menuPortalTarget={document.body}
                        isClearable={false}
                        openMenuOnFocus={true}
                        onFocus={() => handleSelectFocus(index, 'item_code', item.item_code || '')}
                        onBlur={() => handleSelectBlur(index, 'item_code')}
                        inputValue={isActiveSelect(index, 'item_code') ? activeSelectInputValue : undefined}
                        controlShouldRenderValue={!isActiveSelect(index, 'item_code')}
                        tooltip={item.item_code || ''}
                        components={{
                          DropdownIndicator: () => null,
                          IndicatorSeparator: () => null,
                          ClearIndicator: () => null,
                          Control: TooltipControl,
                          ValueContainer: PreviewValueContainer
                        }}
                      />
                    )}
                  </td>

                  {/* Descripción */}
                  <td className="tabla-items-td">
                    {pasteMode ? (
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                        className="tabla-items-input"
                        placeholder="Descripción"
                      />
                    ) : (
                      <AsyncSelect
                        cacheOptions
                        loadOptions={loadDescriptionOptions}
                        onChange={(option) => {
                          clearActiveSelect()
                          if (option) {
                            handleSelectItem(index, option)
                          } else {
                            handleItemChange(index, 'description', '')
                          }
                        }}
                        onInputChange={(value, { action }) => {
                          if (action === 'input-change') {
                            setActiveSelectInputValue(value)
                          }
                          return value
                        }}
                        value={(item.description || item.item_name) ? { value: item.description || item.item_name, label: removeCompanyAbbr(item.description || item.item_name) } : null}
                        inputId={selectInputId(index, 'description')}
                        placeholder="Descripción"
                        noOptionsMessage={() => "Escribí para buscar..."}
                        loadingMessage={() => "Buscando..."}
                        styles={selectStyles}
                        menuPortalTarget={document.body}
                        isClearable={false}
                        openMenuOnFocus={true}
                        onFocus={() => handleSelectFocus(index, 'description', removeCompanyAbbr(item.description || item.item_name || ''))}
                        onBlur={() => handleSelectBlur(index, 'description')}
                        inputValue={isActiveSelect(index, 'description') ? activeSelectInputValue : undefined}
                        controlShouldRenderValue={!isActiveSelect(index, 'description')}
                        tooltip={removeCompanyAbbr(item.description || item.item_name || '')}
                        components={{
                          DropdownIndicator: () => null,
                          IndicatorSeparator: () => null,
                          ClearIndicator: () => null,
                          Control: TooltipControl,
                          ValueContainer: PreviewValueContainer
                        }}
                      />
                    )}
                  </td>

                  {/* Cantidad */}
                  <td className="tabla-items-td">
                    <input
                      type="number"
                      value={item.qty}
                      onChange={(e) => handleItemChange(index, 'qty', e.target.value)}
                      onPaste={(e) => handleQtyPaste(e, index)}
                      className="tabla-items-input-qty"
                      placeholder="1"
                    />
                  </td>

                  {/* Unidad */}
                  <td className="tabla-items-td">
                    <select
                      value={item.uom}
                      onChange={(e) => handleItemChange(index, 'uom', e.target.value)}
                      className="tabla-items-select-uom"
                    >
                      {availableUOMs.map(uom => (
                        <option key={uom.name} value={uom.uom_name}>{uom.uom_name}</option>
                      ))}
                    </select>
                  </td>

                  {/* Almacén (opcional) */}
                  {showWarehouseCol && (
                    <td className="tabla-items-td">
                      <select
                        value={item.warehouse || ''}
                        onChange={(e) => handleItemChange(index, 'warehouse', e.target.value)}
                        className="tabla-items-select-uom"
                      >
                        {!requireWarehouse && <option value="">Seleccionar almacén</option>}
                        {availableWarehouses.map(wh => (
                          <option key={wh.name} value={wh.name}>{wh.warehouse_name || wh.name}</option>
                        ))}
                      </select>
                    </td>
                  )}

                  {/* Columnas de precio (opcionales) */}
                  {showPricingCols && (
                    <>
                      {/* Precio Unitario */}
                      <td className="tabla-items-td">
                        <input
                          type="text"
                          value={item.rate}
                          onChange={(e) => handleItemChange(index, 'rate', e.target.value)}
                          onBlur={(e) => {
                            const rawValue = (e.target.value || '').trim()
                            const formattedRate = formatDecimalValue(rawValue)
                            if (formattedRate) {
                              handleItemChange(index, 'rate', formattedRate)
                            } else if (rawValue === '') {
                              handleItemChange(index, 'rate', '')
                            }
                          }}
                          className="tabla-items-input"
                          style={{ textAlign: 'right' }}
                          placeholder="0.00"
                        />
                      </td>

                      {/* Descuento % (opcional) */}
                      {showDiscount && (
                        <td className="tabla-items-td">
                          <input
                            type="text"
                            value={item.discount_percent || '0.00'}
                            onChange={(e) => {
                              // Permitir escribir libremente, normalizar solo al perder foco
                              handleItemChange(index, 'discount_percent', e.target.value)
                            }}
                            onBlur={(e) => {
                              // Normalizar separadores decimales y calcular discount_amount
                              const normalizedValue = (e.target.value || '0').replace(',', '.')
                              const percent = parseFloat(normalizedValue) || 0
                              
                              // Actualizar discount_percent normalizado
                              handleItemChange(index, 'discount_percent', percent.toFixed(2))
                              
                              // Calcular y actualizar discount_amount
                              const qty = parseFloat(item.qty) || 0
                              const rate = parseFloat(item.rate) || 0
                              const discountAmount = (qty * rate) * (percent / 100)
                              handleItemChange(index, 'discount_amount', discountAmount.toFixed(2))
                            }}
                            className="tabla-items-input"
                            style={{ textAlign: 'right' }}
                          />
                        </td>
                      )}

                      {/* IVA % */}
                      <td className="tabla-items-td">
                        {(() => {
                          const rawCurrent = item.iva_percent
                          let currentValue = rawCurrent
                          if (rawCurrent != null) {
                            const mm = rawCurrent.toString().match(/(\d+(?:[\.,]\d+)?)/)
                            if (mm) currentValue = parseFloat(mm[1].replace(',', '.')).toFixed(2)
                          }

                          return (
                            <select
                              value={currentValue ?? ''}
                              onChange={(e) => handleItemChange(index, 'iva_percent', e.target.value)}
                              className="tabla-items-input"
                              style={{ textAlign: 'right', background: 'transparent' }}
                            >
                              {availableIVARates && availableIVARates.length > 0 ? (
                                availableIVARates.map(rate => {
                                  const numericRate = Number(String(rate).replace(',', '.'))
                                  const value = Number.isFinite(numericRate) ? numericRate.toFixed(2) : String(rate)
                                  const label = Number.isFinite(numericRate) ? numericRate.toString() : String(rate)
                                  return (
                                    <option key={label} value={value}>{label}</option>
                                  )
                                })
                              ) : (
                                <option value="" disabled>No hay tasas de IVA</option>
                              )}
                            </select>
                          )
                        })()}
                      </td>

                      {/* Total */}
                      <td className="tabla-items-td" style={{ textAlign: 'right', fontWeight: '600' }}>
                        {formatCurrencyValue ? formatCurrencyValue(item.amount) : item.amount}
                      </td>
                    </>
                  )}

                  {/* Columna de acciones especiales (crear item / actualizar precio) */}
                  {showActionColumnCol && (
                    <td className="tabla-items-td" style={{ textAlign: 'center' }}>
                      {(() => {
                        const code = (item.item_code || '').trim()
                        const hasItemName = (item.item_name || '').toString().trim().length > 0
                        const canQuickCreate = typeof onRequestQuickCreate === 'function' && code.length >= 1 && !hasItemName
                        const canUpdatePrice = showPricing && item._price_list_rate && Number(item._price_list_rate) !== Number(item.rate)
                        
                        if (canQuickCreate) {
                          return (
                            <button
                              type="button"
                              onClick={() => onRequestQuickCreate(item, index)}
                              className="tabla-items-quick-create-btn"
                              aria-label="Crear item"
                              title="Crear item nuevo"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )
                        }
                        
                        if (canUpdatePrice) {
                          return (
                            <button
                              type="button"
                              onClick={() => updatePriceInPriceList(index)}
                              className="p-1 text-emerald-600 hover:text-emerald-800 transition"
                              aria-label="Actualizar precio en lista"
                              title="Actualizar precio en lista de compra"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          )
                        }
                        
                        return null
                      })()}
                    </td>
                  )}

                  {/* Opciones (Settings, Delete) - O botón de resolver para items pendientes */}
                  {showOptionsCol && (
                  <td className="tabla-items-td-actions">
                    <div className="flex items-center justify-center gap-1">
                      {/* Si es un item pendiente (PEND-), mostrar botón de resolver */}
                      {isPendingItem(item) && typeof onResolvePendingItem === 'function' ? (
                        <button 
                          onClick={() => onResolvePendingItem(item, index)} 
                          className="p-1 transition rounded text-amber-500 hover:text-amber-700 border border-amber-300 bg-amber-50 hover:bg-amber-100"
                          title="⚠️ Item pendiente - Click para resolver"
                        >
                          <AlertCircle className="w-4 h-4" />
                        </button>
                      ) : (
                        /* Botón normal de settings */
                        onOpenItemSettings && (
                          <button 
                            onClick={() => onOpenItemSettings(item, index, onSaveItemSettings)} 
                            className={`p-1 transition rounded ${hasValidWarehouse(item) 
                              ? 'text-gray-400 hover:text-blue-600' 
                              : (requireWarehouse || showWarehouse) 
                                ? 'text-red-500 hover:text-red-700 border border-red-300 rounded'
                                : 'text-gray-400 hover:text-blue-600'
                            }`} 
                            title={hasValidWarehouse(item) 
                              ? "Configurar Cuentas" 
                              : (requireWarehouse || showWarehouse) ? "⚠️ Configurar - FALTA ALMACÉN" : "Configurar Cuentas"}
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                        )
                      )}
                      <button onClick={() => removeItem(index)} className="p-1 text-gray-400 hover:text-red-500 transition" title="Eliminar Ítem">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export { isPendingItem }
export default PurchaseItemsTable
