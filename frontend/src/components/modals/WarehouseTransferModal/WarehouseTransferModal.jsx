import React, { useState, useEffect, useRef, useContext } from 'react'
import Modal from '../../Modal.jsx'
import { ArrowRightLeft, Search, Plus, Trash2, AlertTriangle, Check } from 'lucide-react'
import { AuthContext } from '../../../AuthProvider'
import { NotificationContext } from '../../../contexts/NotificationContext'
import API_ROUTES from '../../../apiRoutes'

// Función auxiliar para obtener la posición absoluta de un elemento
const getElementPosition = (element) => {
  let top = 0, left = 0
  do {
    top += element.offsetTop || 0
    left += element.offsetLeft || 0
    element = element.offsetParent
  } while (element)
  return { top, left }
}

// Función para quitar la abreviatura de la empresa del nombre
const removeCompanyAbbr = (text) => {
  if (!text) return ''
  // Patrón: texto que termina con " - XXX" donde XXX es la abreviatura
  const abbrPattern = /\s+-\s+[A-Z0-9]+$/i
  return text.replace(abbrPattern, '').trim()
}

const WarehouseTransferModal = ({
  isOpen,
  onClose,
  activeCompany,
  onTransferComplete
}) => {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  
  // Estados del formulario
  const [sourceWarehouse, setSourceWarehouse] = useState('')
  const [targetWarehouse, setTargetWarehouse] = useState('')
  const [items, setItems] = useState([{ item_code: '', description: '', source_qty: 0, transfer_qty: '' }])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  
  // Estado para almacenes de la compañía
  const [availableWarehouses, setAvailableWarehouses] = useState([])
  const [loadingWarehouses, setLoadingWarehouses] = useState(false)
  
  // Estados para búsqueda de items
  const [itemSearchResults, setItemSearchResults] = useState([])
  const [showItemDropdown, setShowItemDropdown] = useState(false)
  const [activeItemIndex, setActiveItemIndex] = useState(null)
  const [searchTimeout, setSearchTimeout] = useState(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const dropdownRef = useRef(null)

  // Cargar warehouses cuando se abre el modal
  useEffect(() => {
    if (isOpen && activeCompany) {
      loadWarehouses()
    }
  }, [isOpen, activeCompany])

  const loadWarehouses = async () => {
    setLoadingWarehouses(true)
    try {
      const response = await fetchWithAuth(`/api/inventory/warehouses?company=${encodeURIComponent(activeCompany)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const warehouses = data.data || []
          // Procesar para asegurar nombres de display
          const processed = warehouses.map(wh => ({
            ...wh,
            warehouse_name: wh.warehouse_name || wh.display_name || wh.name,
            display_name: wh.display_name || wh.warehouse_name || wh.name
          }))
          setAvailableWarehouses(processed)
        }
      }
    } catch (error) {
      console.error('Error loading warehouses:', error)
      showNotification('Error al cargar almacenes', 'error')
    } finally {
      setLoadingWarehouses(false)
    }
  }

  // Resetear al abrir
  useEffect(() => {
    if (isOpen) {
      setSourceWarehouse('')
      setTargetWarehouse('')
      setItems([{ item_code: '', description: '', source_qty: 0, transfer_qty: '' }])
      setLoading(false)
      setSubmitting(false)
    }
  }, [isOpen])

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowItemDropdown(false)
        setActiveItemIndex(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cuando cambia el almacén origen, actualizar cantidades disponibles
  useEffect(() => {
    if (sourceWarehouse && items.some(it => it.item_code)) {
      fetchItemQuantities()
    }
  }, [sourceWarehouse])

  const fetchItemQuantities = async () => {
    const codesWithData = items.filter(it => it.item_code).map(it => it.item_code)
    if (codesWithData.length === 0 || !sourceWarehouse) return

    try {
      const response = await fetchWithAuth(API_ROUTES.itemWarehouseQty, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: activeCompany,
          warehouse: sourceWarehouse,
          item_codes: codesWithData
        })
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          setItems(prev => prev.map(item => {
            if (item.item_code && result.data[item.item_code]) {
              return { ...item, source_qty: result.data[item.item_code].available_qty }
            }
            return item
          }))
        }
      }
    } catch (error) {
      console.error('Error fetching item quantities:', error)
    }
  }

  const calculateDropdownPosition = (inputElement) => {
    if (!inputElement) return { top: 0, left: 0, width: 0 }

    const rect = inputElement.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const dropdownHeight = 192

    const spaceBelow = viewportHeight - rect.bottom
    const absPos = getElementPosition(inputElement)

    let top = absPos.top + inputElement.offsetHeight + 2 - window.scrollY
    if (spaceBelow < 200) {
      top = absPos.top - dropdownHeight - 2 - window.scrollY
    }

    return {
      top,
      left: absPos.left - window.scrollX,
      width: inputElement.offsetWidth
    }
  }

  const handleItemSearch = async (index, query, inputElement) => {
    if (searchTimeout) clearTimeout(searchTimeout)

    const timeout = setTimeout(async () => {
      if (query.length >= 2) {
        setActiveItemIndex(index)
        const position = calculateDropdownPosition(inputElement)
        setDropdownPosition(position)

        try {
          const params = new URLSearchParams()
          params.set('company', activeCompany)
          params.set('query', query)
          params.set('field', 'item_code')
          
          const response = await fetchWithAuth(`/api/inventory/search-items?${params.toString()}`)
          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              // Solo mostrar items de stock (productos)
              const stockItems = (result.data || []).filter(item => item.is_stock_item === 1)
              setItemSearchResults(stockItems.map(item => ({
                item_code: item.item_code,
                display_code: item.display_code || item.item_code,
                item_name: item.item_name || item.description || '',
                stock_uom: item.stock_uom || 'Unit'
              })))
              setShowItemDropdown(true)
            }
          }
        } catch (error) {
          console.error('Error searching items:', error)
        }
      } else {
        setItemSearchResults([])
        setShowItemDropdown(false)
      }
    }, 300)

    setSearchTimeout(timeout)
    handleItemChange(index, 'item_code', query)
  }

  const selectItem = async (index, item) => {
    const updatedItems = [...items]
    updatedItems[index] = {
      ...updatedItems[index],
      item_code: item.display_code,
      description: removeCompanyAbbr(item.item_name),
      uom: item.stock_uom,
      source_qty: 0
    }
    setItems(updatedItems)
    setShowItemDropdown(false)
    setActiveItemIndex(null)

    // Obtener cantidad del almacén origen si está seleccionado
    if (sourceWarehouse) {
      try {
        const response = await fetchWithAuth(API_ROUTES.itemWarehouseQty, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: activeCompany,
            warehouse: sourceWarehouse,
            item_codes: [item.display_code]
          })
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success && result.data[item.display_code]) {
            setItems(prev => prev.map((it, i) => 
              i === index 
                ? { ...it, source_qty: result.data[item.display_code].available_qty }
                : it
            ))
          }
        }
      } catch (error) {
        console.error('Error fetching item quantity:', error)
      }
    }
  }

  const handleItemChange = (index, field, value) => {
    setItems(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ))
  }

  const addItem = () => {
    setItems(prev => [...prev, { item_code: '', description: '', source_qty: 0, transfer_qty: '' }])
  }

  const removeItem = (index) => {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  // Función auxiliar para buscar un item por código (usa la misma API que InvoiceModal)
  const searchItemByCode = async (code) => {
    try {
      const params = new URLSearchParams()
      params.set('company', activeCompany)
      params.set('query', code)
      params.set('field', 'item_code')
      
      const response = await fetchWithAuth(`/api/inventory/search-items?${params.toString()}`)
      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          const stockItems = (result.data || []).filter(item => item.is_stock_item === 1)
          // Buscar coincidencia exacta por código
          const exactMatch = stockItems.find(r =>
            (r.display_code || '').toLowerCase() === code.toLowerCase() ||
            (r.item_code || '').toLowerCase() === code.toLowerCase()
          )
          return exactMatch || null
        }
      }
    } catch (error) {
      console.error('Error searching item:', error)
    }
    return null
  }

  // Manejo de pegado desde Excel - reescrito para manejar estado asíncrono
  const handlePaste = async (e, index, field) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const lines = pastedText.split(/\r?\n/).filter(line => line.trim())

    if (lines.length === 0) return

    // Para una sola línea, manejar normalmente
    if (lines.length === 1) {
      const value = lines[0].split(/\t/)[0].trim()
      if (field === 'item_code' && value.length >= 2) {
        // Buscar el item y actualizar con descripción
        const foundItem = await searchItemByCode(value)
        if (foundItem) {
          setItems(prev => prev.map((it, i) => 
            i === index 
              ? {
                  ...it,
                  item_code: foundItem.display_code || foundItem.item_code,
                  description: removeCompanyAbbr(foundItem.item_name || foundItem.description || ''),
                  uom: foundItem.stock_uom || 'Unit'
                }
              : it
          ))
          // Después de actualizar, obtener cantidad si hay warehouse seleccionado
          if (sourceWarehouse) {
            setTimeout(() => fetchItemQuantities(), 100)
          }
        } else {
          handleItemChange(index, field, value)
        }
      } else if (field === 'transfer_qty') {
        handleItemChange(index, field, value.replace(',', '.'))
      } else {
        handleItemChange(index, field, value)
      }
      return
    }

    // Para múltiples líneas, construir el nuevo array de items
    const newItems = []
    const searchResults = []

    // Procesar cada línea
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]
      const firstCell = rawLine.split(/\t/)[0].trim()
      
      if (field === 'item_code' && firstCell.length >= 1) {
        searchResults.push({ index: index + i, code: firstCell })
      }
    }

    // Primero, expandir el array de items si es necesario
    setItems(prev => {
      const newArray = [...prev]
      const totalNeeded = index + lines.length
      while (newArray.length < totalNeeded) {
        newArray.push({ item_code: '', description: '', source_qty: 0, transfer_qty: '' })
      }
      
      // Actualizar con los valores pegados
      for (let i = 0; i < lines.length; i++) {
        const targetIdx = index + i
        const rawLine = lines[i]
        const value = rawLine.split(/\t/)[0].trim()
        
        if (field === 'transfer_qty') {
          newArray[targetIdx] = { ...newArray[targetIdx], [field]: value.replace(',', '.') }
        } else {
          newArray[targetIdx] = { ...newArray[targetIdx], [field]: value }
        }
      }
      
      return newArray
    })

    // Si estamos pegando códigos, buscar cada uno y actualizar con descripciones
    if (field === 'item_code' && searchResults.length > 0) {
      // Pequeña espera para que el estado se actualice
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Recolectar todos los items encontrados para luego obtener cantidades
      const foundItemCodes = []
      
      // Buscar cada código
      for (const { index: targetIdx, code } of searchResults) {
        if (code.length >= 2) {
          const foundItem = await searchItemByCode(code)
          if (foundItem) {
            const displayCode = foundItem.display_code || foundItem.item_code
            foundItemCodes.push(displayCode)
            
            setItems(prev => prev.map((it, i) => 
              i === targetIdx 
                ? {
                    ...it,
                    item_code: displayCode,
                    description: removeCompanyAbbr(foundItem.item_name || foundItem.description || ''),
                    uom: foundItem.stock_uom || 'Unit'
                  }
                : it
            ))
          }
        }
      }
      
      // Obtener cantidades para todos los items encontrados
      if (sourceWarehouse && foundItemCodes.length > 0) {
        // Esperar un poco para que todos los setItems se procesen
        await new Promise(resolve => setTimeout(resolve, 200))
        
        try {
          const response = await fetchWithAuth(API_ROUTES.itemWarehouseQty, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company: activeCompany,
              warehouse: sourceWarehouse,
              item_codes: foundItemCodes
            })
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              setItems(prev => prev.map(item => {
                if (item.item_code && result.data[item.item_code]) {
                  return { ...item, source_qty: result.data[item.item_code].available_qty }
                }
                return item
              }))
            }
          }
        } catch (error) {
          console.error('Error fetching item quantities after paste:', error)
        }
      }
    }
  }

  const validateForm = () => {
    if (!sourceWarehouse) {
      showNotification('Selecciona el almacén de origen', 'warning')
      return false
    }
    if (!targetWarehouse) {
      showNotification('Selecciona el almacén de destino', 'warning')
      return false
    }
    if (sourceWarehouse === targetWarehouse) {
      showNotification('El almacén origen y destino no pueden ser el mismo', 'warning')
      return false
    }

    const validItems = items.filter(item => item.item_code && parseFloat(item.transfer_qty) > 0)
    if (validItems.length === 0) {
      showNotification('Agrega al menos un item con cantidad a transferir', 'warning')
      return false
    }

    // Validar que las cantidades no excedan el stock disponible
    for (const item of validItems) {
      const transferQty = parseFloat(item.transfer_qty)
      if (transferQty > item.source_qty) {
        showNotification(`La cantidad a transferir de "${item.item_code}" (${transferQty}) excede el stock disponible (${item.source_qty})`, 'error')
        return false
      }
    }

    return true
  }

  const handleSubmit = async () => {
    if (!validateForm()) return

    setSubmitting(true)
    try {
      const validItems = items
        .filter(item => item.item_code && parseFloat(item.transfer_qty) > 0)
        .map(item => ({
          item_code: item.item_code,
          qty: parseFloat(item.transfer_qty),
          uom: item.uom || 'Unit'
        }))

      const response = await fetchWithAuth(API_ROUTES.warehouseTransfer, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: activeCompany,
          source_warehouse: sourceWarehouse,
          target_warehouse: targetWarehouse,
          items: validItems
        })
      })

      const result = await response.json()

      if (response.ok && result.success) {
        showNotification(`Transferencia creada exitosamente: ${result.data?.name || ''}`, 'success')
        if (onTransferComplete) {
          onTransferComplete()
        }
        onClose()
      } else {
        showNotification(result.message || 'Error al crear la transferencia', 'error')
      }
    } catch (error) {
      console.error('Error creating transfer:', error)
      showNotification('Error al procesar la transferencia', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const formatNumber = (value) => {
    const numericValue = typeof value === 'number' ? value : parseFloat(value)
    if (!Number.isFinite(numericValue)) return '0'
    return numericValue.toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Transferencia entre Almacenes"
      subtitle="Mover mercadería de un almacén a otro"
      size="lg"
    >
      <div className="flex flex-col h-full max-h-[70vh]">
        {/* Selectores de almacén */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Almacén Origen
              <span className="ml-1 text-gray-400 font-normal text-xs" title="Almacén de donde se sacará la mercadería">ⓘ</span>
            </label>
            <select
              value={sourceWarehouse}
              onChange={(e) => setSourceWarehouse(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm"
              disabled={loadingWarehouses}
            >
              <option value="">{loadingWarehouses ? 'Cargando...' : 'Seleccionar almacén origen'}</option>
              {availableWarehouses.map(wh => (
                <option key={wh.name} value={wh.name}>
                  {wh.warehouse_name || wh.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Almacén Destino
              <span className="ml-1 text-gray-400 font-normal text-xs" title="Almacén donde se enviará la mercadería">ⓘ</span>
            </label>
            <select
              value={targetWarehouse}
              onChange={(e) => setTargetWarehouse(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm"
              disabled={loadingWarehouses}
            >
              <option value="">{loadingWarehouses ? 'Cargando...' : 'Seleccionar almacén destino'}</option>
              {availableWarehouses.filter(wh => wh.name !== sourceWarehouse).map(wh => (
                <option key={wh.name} value={wh.name}>
                  {wh.warehouse_name || wh.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabla de items */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-bold text-gray-800">Items a Transferir</h4>
            <button 
              onClick={addItem} 
              className="flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-800 px-2 py-1 rounded-md hover:bg-violet-50"
            >
              <Plus className="w-3 h-3" />
              Agregar Ítem
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden flex-1">
            <div className="tabla-items-container" style={{ maxHeight: '280px' }}>
              <table className="tabla-items">
                <thead className="tabla-items-header">
                  <tr>
                    <th className="tabla-items-th" style={{ width: '25%' }}>SKU</th>
                    <th className="tabla-items-th" style={{ width: '35%' }}>Nombre</th>
                    <th className="tabla-items-th" style={{ width: '15%', textAlign: 'right' }}>
                      Cant. Disponible
                      <span className="ml-1 text-gray-400 font-normal text-xs" title="Cantidad disponible en el almacén origen">ⓘ</span>
                    </th>
                    <th className="tabla-items-th" style={{ width: '15%', textAlign: 'right' }}>
                      Cant. a Transferir
                    </th>
                    <th className="tabla-items-th" style={{ width: '10%', textAlign: 'center' }}>Acc.</th>
                  </tr>
                </thead>
                <tbody className="tabla-items-body">
                  {items.map((item, index) => {
                    const transferQty = parseFloat(item.transfer_qty) || 0
                    const sourceQty = item.source_qty || 0
                    const exceedsStock = transferQty > sourceQty && sourceQty > 0

                    return (
                      <tr key={index} className="tabla-items-row">
                        <td className="tabla-items-td">
                          <input
                            type="text"
                            value={item.item_code || ''}
                            onChange={(e) => handleItemSearch(index, e.target.value, e.target)}
                            onPaste={(e) => handlePaste(e, index, 'item_code')}
                            className="tabla-items-input"
                            placeholder="Código SKU"
                          />
                        </td>
                        <td className="tabla-items-td">
                          <input
                            type="text"
                            value={item.description || ''}
                            readOnly
                            className="tabla-items-input bg-gray-50"
                            placeholder="Se completa automáticamente"
                          />
                        </td>
                        <td className="tabla-items-td">
                          <div className={`text-right text-sm font-medium ${sourceQty > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                            {sourceQty > 0 ? formatNumber(sourceQty) : '-'}
                          </div>
                        </td>
                        <td className="tabla-items-td">
                          <input
                            type="number"
                            value={item.transfer_qty || ''}
                            onChange={(e) => handleItemChange(index, 'transfer_qty', e.target.value)}
                            onPaste={(e) => handlePaste(e, index, 'transfer_qty')}
                            className={`tabla-items-input text-right ${exceedsStock ? 'border-red-500 bg-red-50' : ''}`}
                            placeholder="0"
                            min="0"
                            max={sourceQty || undefined}
                            step="1"
                          />
                          {exceedsStock && (
                            <div className="text-xs text-red-500 mt-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Excede stock
                            </div>
                          )}
                        </td>
                        <td className="tabla-items-td-actions">
                          <button 
                            onClick={() => removeItem(index)} 
                            className="p-1 text-gray-400 hover:text-red-500 transition" 
                            title="Eliminar Ítem"
                            disabled={items.length <= 1}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !sourceWarehouse || !targetWarehouse}
            className="btn-secondary flex items-center gap-2"
          >
            {submitting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Procesando...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Confirmar Transferencia
              </>
            )}
          </button>
        </div>

        {/* Dropdown flotante fuera de la tabla */}
        {showItemDropdown && itemSearchResults.length > 0 && (
          <div
            ref={dropdownRef}
            className="fixed z-[2147483647] bg-white border border-gray-300 rounded-md shadow-2xl max-h-48 overflow-y-auto"
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width * 2}px`
            }}
          >
            {itemSearchResults.map((result, resultIndex) => (
              <div
                key={resultIndex}
                className="px-3 py-2 hover:bg-violet-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                onClick={() => selectItem(activeItemIndex, result)}
              >
                <div className="font-medium text-xs text-gray-900">{result.display_code}</div>
                <div className="text-xs text-gray-600">{result.item_name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default WarehouseTransferModal
