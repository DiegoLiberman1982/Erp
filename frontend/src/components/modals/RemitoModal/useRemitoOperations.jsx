// --- HOOK PARA MANEJAR OPERACIONES DEL MODAL DE REMITOS ---
import { useCallback, useRef } from 'react'
import API_ROUTES from '../../../apiRoutes.js'

const useRemitoOperations = ({
  formData,
  setFormData,
  activeCompany,
  fetchWithAuth,
  setIsLoading,
  setShowNotification,
  onClose,
  setSupplierDetails,
  // Nuevos parámetros para edición
  isEditing,
  existingRemitoName,
  onSaved
}) => {

  const companyAbbrRef = useRef(null)

  const getCompanyAbbr = useCallback(async () => {
    if (companyAbbrRef.current) {
      return companyAbbrRef.current
    }
    try {
      const response = await fetchWithAuth('/api/active-company')
      if (response && response.ok) {
        const data = await response.json()
        const abbr = data?.data?.company_details?.abbr || null
        if (abbr) {
          companyAbbrRef.current = abbr
        }
        return abbr
      }
    } catch (error) {
      console.error('Error fetching company abbr:', error)
    }
    return null
  }, [fetchWithAuth])

  const appendWarehouseAbbr = useCallback((warehouse, abbr) => {
    if (!warehouse) return warehouse
    if (!abbr) return warehouse
    const suffix = ` - ${abbr}`
    return warehouse.endsWith(suffix) ? warehouse : `${warehouse}${suffix}`
  }, [])

  // Agregar un nuevo item vacío
  const addItem = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          item_code: '',
          description: '',
          qty: 1,
          uom: 'Unit',
          propiedad: 'Propio',
          warehouse: ''
        }
      ]
    }))
  }, [setFormData])

  // Remover un item por índice
  const removeItem = useCallback((index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }))
  }, [setFormData])

  // Cambiar un campo de un item
  const handleItemChange = useCallback((index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    }))
  }, [setFormData])

  // Cambiar un campo del formulario principal
  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }, [setFormData])

  // Validar el formulario antes de guardar
  const validateForm = useCallback(() => {
    if (!formData.posting_date) {
      // showNotification expects (message, type)
      setShowNotification('Fecha es requerida', 'error')
      return false
    }

    if (!formData.items || formData.items.length === 0) {
      setShowNotification('Debe agregar al menos un ítem', 'error')
      return false
    }

    // Validar items
    for (let i = 0; i < formData.items.length; i++) {
      const item = formData.items[i]
        if (!item.item_code || item.item_code.trim() === '') {
        setShowNotification(`Item ${i + 1}: Código del ítem es requerido`, 'error')
        return false
      }
      if (!item.description || item.description.trim() === '') {
        setShowNotification(`Item ${i + 1}: Descripción es requerida`, 'error')
        return false
      }
      if (!item.qty || parseFloat(item.qty) <= 0) {
        setShowNotification(`Item ${i + 1}: Cantidad debe ser mayor a 0`, 'error')
        return false
      }
      if (!item.propiedad) {
        setShowNotification(`Item ${i + 1}: Propiedad es requerida`, 'error')
        return false
      }
      if (!item.warehouse) {
        setShowNotification(`Item ${i + 1}: Almacén es requerido`, 'error')
        return false
      }
    }

    const statusLower = String(formData.status || '').toLowerCase()
    const isDevolucion = statusLower.includes('devolución') || statusLower.includes('devolucion')
    if (isDevolucion && !String(formData.return_against || '').trim()) {
      setShowNotification('Para guardar una devolución primero tenés que relacionarla con un remito anterior (Return Against).', 'warning')
      return false
    }

    return true
  }, [formData, setShowNotification])

  // Guardar el remito
  const handleSave = useCallback(async () => {
    if (!validateForm()) return

    try {
      setIsLoading(true)

      // Construir naming_series: CC-REM-R-XXXXX-XXXXXXXX
      const puntoVenta = formData.punto_de_venta || '00000'
      const remitoNumber = formData.remito_number || '00000000'
      
      // Asegurar que punto_de_venta tenga 5 dígitos
      const puntoVentaFormatted = puntoVenta.padStart(5, '0').slice(-5)
      // Asegurar que remito_number tenga 8 dígitos  
      const remitoNumberFormatted = remitoNumber.padStart(8, '0').slice(-8)
      
      // Standard: CC-REM-R-(punto de venta)-(numero)
      const namingSeries = `CC-REM-R-${puntoVentaFormatted}-${remitoNumberFormatted}`

      const companyAbbr = await getCompanyAbbr()
      const statusLower = String(formData.status || '').toLowerCase()
      const isDevolucion = statusLower.includes('devolución') || statusLower.includes('devolucion')
      const normalizedItems = formData.items.map(item => {
        const purchaseOrderRef = item.purchase_order || formData.linked_purchase_order || undefined
        const purchaseOrderItemRef = item.purchase_order_item || item.po_detail || item.po || undefined
        const prDetail = item.pr_detail || item.purchase_receipt_item || undefined
        return {
          item_code: item.item_code,
          description: item.description,
          // Si es devolución enviar qty negativo; siempre usar valor absoluto del input
          qty: isDevolucion ? -Math.abs(parseFloat(item.qty)) : Math.abs(parseFloat(item.qty)),
          uom: item.uom,
          propiedad: item.propiedad,
          warehouse: appendWarehouseAbbr(item.warehouse, companyAbbr),
          ...(isDevolucion && prDetail ? { pr_detail: prDetail, purchase_receipt_item: prDetail } : {}),
          ...(purchaseOrderRef ? { purchase_order: purchaseOrderRef } : {}),
          ...(purchaseOrderItemRef ? { purchase_order_item: purchaseOrderItemRef } : {})
        }
      })

      // Determinar is_return basado en el estado seleccionado
      const isCancelado = statusLower === 'cancelado'

      // TODO: Confirm with backend expectations: items qty should be negative for returns
      console.log('📤 Datos JSON enviados (pre):', {
        posting_date: formData.posting_date,
        supplier: formData.supplier,
        is_return: isDevolucion ? 1 : 0,
        items: normalizedItems
      })

      const remitoData = {
        posting_date: formData.posting_date,
        comprobante_type: formData.comprobante_type,
        supplier: formData.supplier,
        company: activeCompany,
        status: formData.status,
        is_return: isDevolucion ? 1 : 0,
        ...(isDevolucion ? { return_against: formData.return_against || undefined } : {}),
        ...(isCancelado ? { docstatus: 2 } : {}),
        naming_series: namingSeries,
        items: normalizedItems
      }

      if (formData.linked_purchase_order) {
        remitoData.purchase_order = formData.linked_purchase_order
      }

      console.log('📤 Saving remito:', remitoData)

      // Determinar método HTTP y endpoint basado en modo edición
      const method = isEditing ? 'PUT' : 'POST'
      const endpoint = isEditing ? API_ROUTES.remitoByName(existingRemitoName) : API_ROUTES.remitos

      const response = await fetchWithAuth(endpoint, {
        method: method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(remitoData)
      })

      if (response.ok) {
        const result = await response.json()
        console.log('✅ Remito saved successfully:', result)

        const successMessage = isEditing ? 'Remito actualizado exitosamente' : 'Remito guardado exitosamente'
        setShowNotification(successMessage, 'success')

        // Mostrar info sobre warehouses auto-creados si existen (soporta varias formas de payload del backend)
        const autoCreatedFromFeedback = result?.feedback?.auto_created_warehouses
        const autoCreatedFromData = result?.data?.warehouses_created || result?.data?.auto_created_warehouses
        const autoCreated = Array.isArray(autoCreatedFromFeedback) ? autoCreatedFromFeedback : (Array.isArray(autoCreatedFromData) ? autoCreatedFromData : null)

        if (autoCreated && autoCreated.length > 0) {
          const warehouses = autoCreated.join(', ')
          setShowNotification(`Almacenes auto-creados: ${warehouses}`, 'info')
        }

        onClose()
        
        // Llamar a onSaved si está definido para refrescar la lista
        if (onSaved) {
          onSaved()
        }
      } else {
        // Manejar respuestas no-ok con robustez (puede no ser Response si fetchWithAuth devolvió objeto de error)
        let errorPayload = { message: `Error al guardar el remito (status ${response?.status || 'no-response'})` }
        try {
          if (response && typeof response.json === 'function') {
            const parsed = await response.json()
            errorPayload = parsed || errorPayload
          } else if (response && response.error) {
            errorPayload = { message: response.error.message || String(response.error) }
          } else if (response && typeof response.text === 'function') {
            const text = await response.text().catch(() => null)
            if (text) errorPayload = { message: text }
          }
        } catch (parseErr) {
          console.error('❌ Error parsing error response for remito save:', parseErr)
        }

        console.error('❌ Error saving remito:', errorPayload, 'response:', response)
        setShowNotification(errorPayload.message || `Error al guardar el remito (status ${response?.status})`, 'error')
      }
    } catch (error) {
      console.error('❌ Error saving remito:', error)
      setShowNotification('Error de conexión al guardar el remito', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [formData, activeCompany, fetchWithAuth, setIsLoading, setShowNotification, onClose, validateForm, isEditing, existingRemitoName, onSaved])

  // Abrir configuración de item (para warehouse)
  const handleOpenItemSettings = useCallback((item, index, onSaveItemSettings) => {
    // Implementar lógica para abrir modal de configuración de warehouse
    console.log('Opening item settings for item:', item, 'at index:', index)
    // Por ahora solo mostrar notificación
    setShowNotification('Funcionalidad de configuración próximamente', 'info')
  }, [setShowNotification])

  return {
    addItem,
    removeItem,
    handleItemChange,
    handleInputChange,
    handleSave,
    handleOpenItemSettings
  }
}

export default useRemitoOperations
