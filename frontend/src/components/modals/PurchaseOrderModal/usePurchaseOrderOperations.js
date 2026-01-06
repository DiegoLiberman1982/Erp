import { useCallback } from 'react'
import API_ROUTES from '../../../apiRoutes'

const statusMap = {
  'Borrador': 'Draft',
  'En espera': 'On Hold',
  'Para recibir y pagar': 'To Receive and Bill',
  'Por facturar': 'To Bill',
  'Recibir': 'To Receive',
  'Completado': 'Completed',
  'Cancelado': 'Cancelled',
  'Cerrado': 'Closed',
  'Enviado': 'Delivered'
}

const usePurchaseOrderOperations = ({
  formData,
  setFormData,
  fetchWithAuth,
  showNotification,
  supplierDetails,
  activeCompany,
  onClose,
  onSaved,
  editingData // Nueva prop para saber si estamos editando
}) => {
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
          rate: '',
          warehouse: '',
          schedule_date: prev.schedule_date,
          iva_percent: '21.00',
          discount_percent: '0.00',
          discount_amount: '0.00',
          amount: '0.00'
        }
      ]
    }))
  }, [setFormData])

  const removeItem = useCallback((index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }))
  }, [setFormData])

  const handleItemChange = useCallback((index, field, value) => {
    setFormData(prev => {
      const items = [...prev.items]
      const current = { ...items[index], [field]: value }
      
      // Recalcular amount cuando cambian qty, rate, iva_percent o descuento
      if (['qty', 'rate', 'iva_percent', 'discount_percent', 'discount_amount'].includes(field)) {
        const qty = parseFloat(field === 'qty' ? value : current.qty) || 0
        const rate = parseFloat(field === 'rate' ? value : current.rate) || 0
        const ivaPercent = parseFloat(field === 'iva_percent' ? value : current.iva_percent) || 21.00

        const subtotal = qty * rate

        // Determine discount amount: if discount_amount provided use it, else compute from discount_percent
        let discountAmount = parseFloat(field === 'discount_amount' ? value : current.discount_amount) || 0
        let discountPercent = parseFloat(field === 'discount_percent' ? value : current.discount_percent)
        if ((isNaN(discountPercent) || discountPercent === null) && subtotal > 0) {
          discountPercent = 0
        }
        if ((!discountAmount || discountAmount === 0) && discountPercent) {
          discountAmount = subtotal * (discountPercent / 100)
        }

        // Normalize discount fields
        current.discount_amount = discountAmount.toFixed(2)
        current.discount_percent = (Number.isFinite(Number(discountPercent)) ? Number(discountPercent).toFixed(2) : '0.00')

        const taxable = Math.max(0, subtotal - discountAmount)
        const ivaAmount = taxable * (ivaPercent / 100)
        const amount = taxable + ivaAmount
        current.amount = amount.toFixed(2)
      }
      
      items[index] = current
      return { ...prev, items }
    })
  }, [setFormData])

    const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }, [setFormData])

  const cancelAndDeletePurchaseOrder = useCallback(
    async (poName, { reason, docstatus } = {}) => {
      if (!poName) {
        showNotification('Orden no v�lida para cancelar', 'error')
        return false
      }
      try {
        if (docstatus === 1 || docstatus === undefined) {
          const cancelResponse = await fetchWithAuth(API_ROUTES.purchaseOrderCancel(poName), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason || 'Modificada - Nueva versi�n creada' })
          })
          const cancelResult = await cancelResponse.json().catch(() => ({}))
          if (!cancelResponse.ok || cancelResult.success === false) {
            showNotification(cancelResult.message || 'Error al cancelar la orden original', 'error')
            return false
          }
        }

        const deleteResponse = await fetchWithAuth(API_ROUTES.purchaseOrderByName(poName), {
          method: 'DELETE'
        })
        const deleteResult = await deleteResponse.json().catch(() => ({}))
        if (!deleteResponse.ok || deleteResult.success === false) {
          showNotification(deleteResult.message || 'Error al eliminar la orden cancelada', 'warning')
          return false
        }
        return true
      } catch (error) {
        console.error('Error cancelling/deleting purchase order:', error)
        showNotification('Error de conexi�n al cancelar la orden', 'error')
        return false
      }
    },
    [fetchWithAuth, showNotification]
  )

  const handleSave = useCallback(async () => {
    if (!supplierDetails && !formData.supplier) {
      showNotification('Seleccioná un proveedor válido', 'warning')
      return
    }

    if (!Array.isArray(formData.items) || formData.items.length === 0) {
      showNotification('Agregá al menos un ítem', 'error')
      return
    }

    const invalidItem = formData.items.find((item, idx) => {
      if (!item.item_code) {
        showNotification(`El item ${idx + 1} necesita código`, 'error')
        return true
      }
      if (!item.qty || Number(item.qty) <= 0) {
        showNotification(`El item ${idx + 1} necesita cantidad válida`, 'error')
        return true
      }
      return false
    })

    if (invalidItem) {
      return
    }

    try {
      const payload = {
        supplier: supplierDetails?.supplier_name || formData.supplier,
        company: activeCompany,
        transaction_date: formData.transaction_date,
        schedule_date: formData.schedule_date,
        docstatus: 1,
        status: statusMap[formData.status] || formData.status,
        sales_condition_type: formData.sales_condition_type || '',
        description: formData.description || '',
        currency: formData.currency,
        price_list: formData.price_list,
        buying_price_list: formData.price_list || formData.buying_price_list || null,
        notes: formData.notes,
        items: formData.items.map(item => ({
          item_code: item.item_code,
          description: item.description,
          qty: Number(item.qty),
          uom: item.uom,
          rate: item.rate === '' ? null : Number(item.rate),
          warehouse: item.warehouse,
          schedule_date: item.schedule_date || formData.schedule_date,
          conversion_factor: item.conversion_factor || 1,
          item_tax_template: item.item_tax_template || null,
          discount_percent: item.discount_percent ? Number(item.discount_percent) : 0,
          discount_amount: item.discount_amount ? Number(item.discount_amount) : 0
        }))
      }

      // Si estamos editando, crear nueva orden y cancelar la original
      if (editingData && editingData.name) {
        // Crear nueva orden
        const createResponse = await fetchWithAuth(API_ROUTES.purchaseOrders, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        const createResult = await createResponse.json().catch(() => ({}))
        if (!createResponse.ok || createResult.success === false) {
          showNotification(createResult.message || 'Error al crear la nueva orden de compra', 'error')
          return
        }

        const cancelled = await cancelAndDeletePurchaseOrder(editingData.name, {
          reason: 'Modificada - Nueva versi�n creada',
          docstatus: editingData.docstatus
        })
        if (cancelled) {
          showNotification('Orden de compra modificada (nueva versi�n creada, original cancelada)', 'success')
        } else {
          showNotification('Nueva orden creada pero no se pudo cancelar la versi�n anterior', 'warning')
        }

        if (typeof onSaved === 'function') {
          await onSaved(createResult)
        }
      } else {
        // Creación normal
        const response = await fetchWithAuth(API_ROUTES.purchaseOrders, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        const result = await response.json().catch(() => ({}))
        if (!response.ok || result.success === false) {
          showNotification(result.message || 'Error al crear la orden de compra', 'error')
          return
        }

        showNotification('Orden de compra creada', 'success')
        if (typeof onSaved === 'function') {
          await onSaved(result)
        }
      }

      if (onClose) {
        onClose()
      }
    } catch (error) {
      console.error('Error guardando purchase order:', error)
      showNotification('Error de conexión al guardar la orden', 'error')
    }
  }, [activeCompany, fetchWithAuth, formData, onClose, onSaved, showNotification, supplierDetails, editingData, cancelAndDeletePurchaseOrder])

  const handleCancel = useCallback(async () => {
    if (!editingData?.name) {
      showNotification('No se puede eliminar esta orden', 'warning')
      return
    }

    try {
      const success = await cancelAndDeletePurchaseOrder(editingData.name, {
        reason: 'Eliminada desde el panel',
        docstatus: editingData.docstatus
      })
      if (!success) {
        return
      }

      showNotification('Orden de compra anulada correctamente', 'success')

      if (typeof onSaved === 'function') {
        await onSaved()
      }

      if (typeof onClose === 'function') {
        onClose()
      }
    } catch (error) {
      console.error('Error cancelling purchase order:', error)
      showNotification('Error de conexi�n al anular la orden', 'error')
    }
  }, [editingData, cancelAndDeletePurchaseOrder, showNotification, onClose])

  return {
    addItem,
    removeItem,
    handleItemChange,
    handleInputChange,
    handleSave,
    handleCancel
  }
}

export default usePurchaseOrderOperations
