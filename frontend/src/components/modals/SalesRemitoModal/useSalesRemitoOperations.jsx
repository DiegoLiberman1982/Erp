// --- HOOK DE OPERACIONES PARA REMITOS DE VENTA ---
import { useCallback } from 'react'
import API_ROUTES from '../../../apiRoutes.js'
import { getRemitoTypeSigla } from './salesRemitoModalUtils.js'

const parseFrappeServerMessages = (payload) => {
  if (!payload || typeof payload !== 'object') return []
  const raw = payload._server_messages || payload._messages
  if (!raw) return []

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        if (!entry) return null
        if (typeof entry === 'string') {
          try {
            const parsedEntry = JSON.parse(entry)
            return parsedEntry?.message || entry
          } catch {
            return entry
          }
        }
        if (typeof entry === 'object') {
          return entry.message || JSON.stringify(entry)
        }
        return String(entry)
      })
      .filter(Boolean)
  } catch {
    return [String(raw)]
  }
}

const extractErrorMessage = (payload, fallbackText) => {
  const serverMessages = parseFrappeServerMessages(payload)
  if (serverMessages.length > 0) return serverMessages[0]
  if (payload?.message) return String(payload.message)
  if (payload?.exception) return String(payload.exception)
  if (payload?.exc_type) return String(payload.exc_type)
  if (fallbackText) return String(fallbackText)
  return 'Error al guardar el remito'
}

const normalizePuntoDeVenta = (value) => {
  const numeric = String(value || '').replace(/[^0-9]/g, '')
  return numeric.padStart(5, '0').slice(-5)
}

const normalizeRemitoNumber = (value) => {
  const numeric = String(value || '').replace(/[^0-9]/g, '')
  return numeric.padStart(8, '0').slice(-8)
}

const useSalesRemitoOperations = ({
  formData,
  setFormData,
  activeCompany,
  fetchWithAuth,
  setIsLoading,
  setShowNotification,
  onClose,
  isEditing,
  existingRemitoName,
  onSaved
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
          propiedad: 'Propio',
          warehouse: ''
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

  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }, [setFormData])

  const validateForm = useCallback(() => {
    if (!formData.customer) {
      setShowNotification('Debes seleccionar un cliente', 'error')
      return false
    }

    if (!formData.posting_date) {
      setShowNotification('Fecha es requerida', 'error')
      return false
    }

    if (!isEditing && !formData.talonario_name) {
      setShowNotification('Debes seleccionar un talonario de remitos', 'error')
      return false
    }

    if (!Array.isArray(formData.items) || formData.items.length === 0) {
      setShowNotification('Debe agregar al menos un item', 'error')
      return false
    }

    for (let i = 0; i < formData.items.length; i++) {
      const item = formData.items[i]
      if (!item.item_code || item.item_code.trim() === '') {
        setShowNotification(`Item ${i + 1}: Código es requerido`, 'error')
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
      if (!item.warehouse) {
        setShowNotification(`Item ${i + 1}: Debe seleccionar un depósito`, 'error')
        return false
      }
    }

    return true
  }, [formData, isEditing, setShowNotification])

  const serializeWarehouseGroup = useCallback((group) => {
    if (!group || typeof group !== 'object') return null
    const entries = Array.isArray(group.entries)
      ? group.entries.map(entry => ({
          name: entry.name,
          warehouse_name: entry.warehouse_name,
          role: entry.role,
          is_consignment_variant: Boolean(entry.is_consignment_variant)
        }))
      : []

    return {
      key: group.key || group.warehouse_name,
      warehouse_name: group.warehouse_name || group.key,
      entries
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (!validateForm()) return

    try {
      setIsLoading(true)

      const puntoVentaFormatted = normalizePuntoDeVenta(formData.punto_de_venta || '')
      const remitoNumberFormatted = normalizeRemitoNumber(formData.remito_number || '')
      const remitoLetter = (formData.remito_letter || 'R').toUpperCase()
      const typeSigla = getRemitoTypeSigla(formData.comprobante_type || 'Remito')
      const baseCode = `REM-${typeSigla}-${remitoLetter}-${puntoVentaFormatted}-${remitoNumberFormatted}`

      const statusLower = String(formData.status || '').toLowerCase()
      const isDevolucion = statusLower.includes('devoluci')
      if (isDevolucion && !String(formData.return_against || '').trim()) {
        setShowNotification('Para guardar una devolución primero tenés que relacionarla con un remito anterior (Return Against).', 'warning')
        return
      }

      const remitoData = {
        posting_date: formData.posting_date,
        comprobante_type: formData.comprobante_type,
        punto_de_venta: puntoVentaFormatted,
        remito_number: remitoNumberFormatted,
        customer: formData.customer,
        company: activeCompany,
        status: formData.status,
        title: formData.title,
        talonario_name: formData.talonario_name,
        remito_letter: remitoLetter,
        base_code: baseCode,
        is_return: isDevolucion ? 1 : 0,
        ...(isDevolucion ? { return_against: formData.return_against || undefined } : {}),
        items: formData.items.map(item => {
          const serializedGroup = serializeWarehouseGroup(item.warehouse_group)
          const dnDetail = item.dn_detail || item.delivery_note_item || undefined
          return {
            item_code: item.item_code,
            description: item.description,
            qty: isDevolucion ? -Math.abs(parseFloat(item.qty)) : Math.abs(parseFloat(item.qty)),
            uom: item.uom,
            propiedad: item.propiedad,
            warehouse: item.warehouse,
            warehouse_group: serializedGroup,
            ...(isDevolucion && dnDetail ? { dn_detail: dnDetail, delivery_note_item: dnDetail } : {})
          }
        })
      }

      const method = isEditing ? 'PUT' : 'POST'
      const endpoint = isEditing ? API_ROUTES.salesRemitoByName(existingRemitoName) : API_ROUTES.salesRemitos

      const response = await fetchWithAuth(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(remitoData)
      })

      if (!response || typeof response.ok !== 'boolean') {
        const message = response?.error?.message || 'Error de conexión al guardar el remito'
        console.error('[SalesRemitoModal] Save request failed (non-Response):', {
          endpoint,
          method,
          response
        })
        setShowNotification(message, 'error')
        return
      }

      if (!response.ok) {
        let errorPayload = {}
        let errorText = null
        try {
          errorPayload = await response.json().catch(() => ({}))
        } catch {
          errorPayload = {}
        }
        if ((!errorPayload || Object.keys(errorPayload).length === 0) && typeof response.text === 'function') {
          errorText = await response.text().catch(() => null)
        }
        const message = extractErrorMessage(errorPayload, errorText)
        console.error('[SalesRemitoModal] Save error:', {
          endpoint,
          method,
          status: response.status,
          errorPayload,
          errorText,
          remitoData
        })
        setShowNotification(message, 'error')
        return
      }

      const result = await response.json()
      const successMessage = isEditing ? 'Remito de venta actualizado' : 'Remito de venta creado'
      setShowNotification(successMessage, 'success')

      onClose()
      if (onSaved) {
        onSaved(result)
      }
    } catch (error) {
      console.error('Error guardando remito de venta:', error)
      setShowNotification('Error de conexión al guardar el remito', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [
    activeCompany,
    existingRemitoName,
    fetchWithAuth,
    formData,
    isEditing,
    onClose,
    onSaved,
    setIsLoading,
    setShowNotification,
    serializeWarehouseGroup,
    validateForm
  ])

  return {
    addItem,
    removeItem,
    handleInputChange,
    handleSave
  }
}

export default useSalesRemitoOperations
