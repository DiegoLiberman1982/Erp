import { useState } from 'react'
import { addCompanyAbbrToSupplier } from '../../../Supplierpanel/supplierHandlers'
import { isPendingItem } from '../../shared'
import { getAfipTipoFromLabel } from '../../../../utils/comprobantes'
import afipCodes from '../../../../../../shared/afip_codes.json'

// Helper function to check if any items are pending
const hasPendingItems = (items) => {
  if (!Array.isArray(items)) return false
  return items.some(item => isPendingItem(item))
}

const resolvePurchaseDocTypeCode = (invoiceTypeRaw = '') => {
  const tipo = getAfipTipoFromLabel(invoiceTypeRaw)
  return tipo || 'FAC'
}

const normalizeItemDiscount = (item, qtyValue, rateValue) => {
  const subtotal = qtyValue * rateValue
  let discountPercent = parseFloat(item.discount_percent ?? item.discount_percentage) || 0
  let discountAmount = parseFloat(item.discount_amount) || 0

  if (subtotal <= 0) {
    return { subtotal, discountAmount: 0, discountPercent: 0, netAmount: 0 }
  }

  if (discountPercent && !discountAmount) {
    discountAmount = subtotal * (discountPercent / 100)
  } else if (!discountPercent && discountAmount) {
    discountPercent = (discountAmount / subtotal) * 100
  }

  if (!Number.isFinite(discountPercent) || discountPercent < 0) discountPercent = 0
  if (discountPercent > 100) discountPercent = 100

  if (!Number.isFinite(discountAmount) || discountAmount < 0) discountAmount = 0
  if (discountAmount > subtotal) discountAmount = subtotal

  const normalizedDiscountAmount = Number(discountAmount.toFixed(2))
  const normalizedDiscountPercent = Number(discountPercent.toFixed(6))
  const netAmount = Math.max(subtotal - normalizedDiscountAmount, 0)

  return {
    subtotal,
    discountAmount: normalizedDiscountAmount,
    discountPercent: normalizedDiscountPercent,
    netAmount
  }
}

const resolveCompanyAllocationAmount = (doc = {}) => {
  const preferredKeys = [
    'amount_in_company_currency',
    'allocated_amount_in_company_currency',
    'outstanding_in_company_currency',
    'outstanding_amount_in_company_currency',
    'base_outstanding_amount',
    'base_grand_total'
  ]
  for (const key of preferredKeys) {
    if (doc[key] === undefined || doc[key] === null || doc[key] === '') continue
    const parsed = Number(doc[key])
    if (Number.isFinite(parsed)) {
      return Math.abs(parsed)
    }
  }
  const fallbackKeys = ['amount', 'allocated_amount', 'outstanding_amount', 'grand_total']
  for (const key of fallbackKeys) {
    if (doc[key] === undefined || doc[key] === null || doc[key] === '') continue
    const parsed = Number(doc[key])
    if (Number.isFinite(parsed)) {
      return Math.abs(parsed)
    }
  }
  return 0
}

export const usePurchaseInvoiceOperations = (
  formData,
  setFormData,
  isEditing,
  editingInvoiceFullName,
  supplierDetails,
  selectedSupplier,
  fetchWithAuth,
  showNotification,
  onClose,
  onDelete,
  onSaved,
  calculateTotal,
  isCreditNote,
  companyCurrency
) => {
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

    const handleSave = async () => {
    // Validations
    if (!formData.supplier.trim()) {
      showNotification('Debe seleccionar un proveedor', 'error')
      return
    }

    // Check for pending items that need resolution
    if (hasPendingItems(formData.items)) {
      showNotification('Hay ítems pendientes de mapear. Hacé clic en el ícono de alerta para resolverlos antes de guardar.', 'warning')
      return
    }

    // Generar título por defecto si está vacío
    if (!formData.title.trim()) {
      const today = new Date()
      const dateStr = today.toLocaleDateString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      const supplierName = supplierDetails?.supplier_name || selectedSupplier || 'Proveedor'
      const defaultTitle = `${dateStr} - ${supplierName}`
      setFormData(prev => ({ ...prev, title: defaultTitle }))
    }

    const validItems = formData.items.filter(item =>
      (item.item_code && item.item_code.trim() !== '') || (item.description && item.description.trim() !== '')
    )

    if (validItems.length === 0) {
      showNotification('Debe agregar al menos un ítem con código o descripción a la factura', 'error')
      return
    }

    const resolvedCompanyCurrency = (companyCurrency || '').toString().trim()
    const resolvedInvoiceCurrency = (formData.currency || '').toString().trim()

    if (!resolvedInvoiceCurrency) {
      showNotification('Debe seleccionar una moneda', 'error')
      return
    }

    if (!resolvedCompanyCurrency) {
      showNotification('La empresa no tiene moneda por defecto definida', 'error')
      return
    }

    const needsConversion = resolvedInvoiceCurrency !== resolvedCompanyCurrency
    const parsedExchangeRate = parseFloat(formData.exchange_rate)
    if (needsConversion && !(Number.isFinite(parsedExchangeRate) && parsedExchangeRate > 0)) {
      showNotification('Debe ingresar una cotización válida para la moneda seleccionada', 'error')
      return
    }

    const total = calculateTotal(formData.items, formData)

    const normalizedSelectedInvoices = (formData.selected_unpaid_invoices || [])
      .map((invoice, index) => {
        if (!invoice) return null
        const voucherNo = (invoice.voucher_no || invoice.name || '').trim()
        if (!voucherNo) return null
        const allocationAmount = resolveCompanyAllocationAmount(invoice)
        if (allocationAmount <= 0) return null
        const normalizedAmount = parseFloat(allocationAmount.toFixed(2))

        return {
          name: voucherNo,
          voucher_no: voucherNo,
          amount: normalizedAmount,
          allocated_amount: normalizedAmount,
          currency: (invoice.currency || resolvedInvoiceCurrency || '').toString().trim(),
          posting_date: invoice.posting_date || null,
          source_name: invoice.return_against || invoice.source_name || voucherNo,
          sequence: index
        }
      })
      .filter(Boolean)

    const appliedCreditTotal = normalizedSelectedInvoices.reduce((sum, entry) => sum + (entry.amount || 0), 0)

    // Validación diferente para notas de crédito vs facturas normales
    // Frontend shows credit note numbers as positive; backend expects negative totals.
    // Require a positive total in the form for credit notes, then send negative values to the API.
    if (isCreditNote(formData.invoice_type)) {
      if (total <= 0) {
        showNotification('El total de la nota de crédito debe ser mayor a cero', 'error')
        return
      }
    } else {
      if (total <= 0) {
        showNotification('El total de la factura debe ser mayor a cero', 'error')
        return
      }
    }

    const requiresMetodoNumeracion = (formData.status || '').toLowerCase() === 'confirmada'
    let metodoNumeracionValue = ''
    if (requiresMetodoNumeracion) {
      const rawPuntoVenta = (formData.punto_de_venta || '').toString().replace(/\D/g, '')
      const rawInvoiceNumber = (formData.invoice_number || '').toString().replace(/\D/g, '')

      if (!rawPuntoVenta) {
        showNotification('Debe completar el punto de venta (5 dígitos) para confirmar la factura', 'error')
        return
      }

      if (!rawInvoiceNumber) {
        showNotification('Debe completar el número de comprobante (8 dígitos) para confirmar la factura', 'error')
        return
      }

      const paddedPuntoVenta = rawPuntoVenta.padStart(5, '0')
      const paddedInvoiceNumber = rawInvoiceNumber.padStart(8, '0')
      const typeCode = resolvePurchaseDocTypeCode(formData.invoice_type || 'Factura')
      const letter = (formData.invoice_category || 'A').toString().trim().toUpperCase() || 'A'
      // Use the purchase prefix defined in shared/afip_codes.json. Do not fall back silently.
      const purchasePrefix = afipCodes?.naming_conventions?.prefixes?.compras?.default
      if (!purchasePrefix) {
        showNotification('Configuración AFIP inválida: prefijo de compras no encontrado en shared/afip_codes.json', 'error')
        setIsSaving(false)
        return
      }
      const prefix = String(purchasePrefix).toString().trim()
      metodoNumeracionValue = `${prefix}-${typeCode}-${letter}-${paddedPuntoVenta}-${paddedInvoiceNumber}`
    }

    setIsSaving(true)
    try {
      // Shortcut: If user is editing an existing invoice and set status to 'Anulada' / cancel
      const isCancelStatus = (s) => {
        if (!s && s !== 0) return false
        const st = String(s).trim().toLowerCase()
        return ['anulada', 'anulado', 'cancelada', 'cancelado', 'cancelled'].includes(st)
      }

      if (isEditing && isCancelStatus(formData.status) && editingInvoiceFullName) {
        // Only send the minimal payload that backend expects for cancellation detection
        const cancelPayload = {
          data: {
            status: formData.status,
            docstatus: 2
          }
        }

        const apiEndpoint = isCreditNote(formData.invoice_type)
          ? `/api/credit-debit-notes/${editingInvoiceFullName}`
          : `/api/purchase-invoices/${editingInvoiceFullName}`

        console.log('📡 Sending minimal cancel payload for invoice', editingInvoiceFullName, cancelPayload)

        const cancelResponse = await fetchWithAuth(apiEndpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cancelPayload)
        })

        if (cancelResponse.ok) {
          const res = await cancelResponse.json()
          if (res.success) {
            showNotification('Factura anulada correctamente', 'success')
            try {
              if (onSaved) onSaved(res.data)
            } catch (e) {
              console.warn('onSaved callback error:', e)
            }
            onClose()
            return
          }
          showNotification(res.message || 'Error anulando factura', 'error')
          return
        } else {
          try {
            const err = await cancelResponse.json()
            showNotification(err.message || 'Error anulando factura', 'error')
          } catch (e) {
            showNotification('Error anulando factura', 'error')
          }
          return
        }
      }
      let saveData
      let apiEndpoint

      if (isCreditNote(formData.invoice_type)) {
        apiEndpoint = '/api/credit-debit-notes'
        if (isEditing && editingInvoiceFullName) {
          apiEndpoint += `/${editingInvoiceFullName}`
        }

        saveData = {
          data: {
            supplier: await addCompanyAbbrToSupplier(formData.supplier, fetchWithAuth),
            company: formData.company || '',
            posting_date: formData.posting_date,
            bill_date: formData.bill_date || formData.posting_date,
             due_date: formData.due_date || formData.bill_date || formData.posting_date,
             set_posting_time: 1,
             is_return: 1,
              title: formData.title,
              currency: resolvedInvoiceCurrency,
              conversion_rate: needsConversion ? parsedExchangeRate : 1,
              invoice_number: formData.invoice_number,
              invoice_type: formData.invoice_type,
              punto_de_venta: formData.punto_de_venta,
            voucher_type_code: 'NC',
            invoice_category: formData.invoice_category,
            metodo_numeracion_factura_venta: metodoNumeracionValue || undefined,
            status: formData.status && formData.status.trim() !== '' ? formData.status : 'Confirmada',
            docstatus: formData.status === 'Confirmada' ? 1 : 0,
            price_list: formData.price_list,
            return_against: formData.return_against || undefined,
            items: validItems.map(item => {
              const qtyRaw = parseFloat(item.qty)
              const qtyValue = Number.isFinite(qtyRaw) ? qtyRaw : 0
              const qtyMagnitude = Math.abs(qtyValue)
              const rateValue = parseFloat(item.rate) || 0
              const { discountAmount, discountPercent, netAmount } = normalizeItemDiscount(item, qtyMagnitude, rateValue)
              const taxRatePayload = item.item_tax_rate || ''
              const effectiveTemplate = taxRatePayload ? '' : (item.item_tax_template || '')

              return {
                item_code: item.item_code,
                item_name: item.item_name,
                description: item.description,
                warehouse: item.warehouse,
                cost_center: item.cost_center,
                uom: item.uom,
                qty: qtyValue || -qtyMagnitude,
                rate: rateValue,
                discount_percent: discountPercent,
                discount_percentage: discountPercent,
                discount_amount: -Math.abs(discountAmount),
                iva_percent: parseFloat(item.iva_percent) || 21,
                amount: -Math.abs(netAmount),
                account: item.account,
                expense_account: item.expense_account,
                valuation_rate: parseFloat(item.valuation_rate) || rateValue,
                item_tax_template: effectiveTemplate,
                item_tax_rate: taxRatePayload,
                purchase_receipt: item.purchase_receipt || '',
                pr_detail: item.pr_detail || '',
                purchase_receipt_item: item.purchase_receipt_item || item.pr_detail || '',
                purchase_order: item.purchase_order || '',
                po_detail: item.po_detail || '',
                purchase_order_item: item.purchase_order_item || item.po_detail || ''
              }
            }),
            // Send summary amounts as negative values for credit notes
            discount_amount: -(Math.abs(parseFloat(formData.discount_amount) || 0)),
            net_gravado: -(Math.abs(parseFloat(formData.net_gravado) || 0)),
            net_no_gravado: -(Math.abs(parseFloat(formData.net_no_gravado) || 0)),
            total_iva: -(Math.abs(parseFloat(formData.total_iva) || 0)),
            percepcion_iva: -(Math.abs(parseFloat(formData.percepcion_iva) || 0)),
            percepcion_iibb: -(Math.abs(parseFloat(formData.percepcion_iibb) || 0)),
            perceptions: formData.perceptions || [], // Nuevo modelo unificado de percepciones
            sales_condition_type: formData.sales_condition_type,
            sales_condition_amount: formData.sales_condition_amount,
            sales_condition_days: formData.sales_condition_days,
            credit_note_total: -(Math.abs(appliedCreditTotal > 0 ? appliedCreditTotal : total)),
            selected_unpaid_invoices: normalizedSelectedInvoices
          },
          isEditing: isEditing
        }

        if (isEditing && editingInvoiceFullName) {
          saveData.data.name = editingInvoiceFullName
        }
      } else {
        apiEndpoint = '/api/purchase-invoices'
        if (isEditing && editingInvoiceFullName) {
          apiEndpoint += `/${editingInvoiceFullName}`
        }

        saveData = {
          data: {
            voucher_type: "Purchase Invoice",
            posting_date: formData.posting_date,
            bill_date: formData.bill_date || formData.posting_date,
            due_date: formData.due_date || formData.bill_date || formData.posting_date,
             set_posting_time: 1,
             company: formData.company || '',
             supplier: await addCompanyAbbrToSupplier(formData.supplier, fetchWithAuth),
              title: formData.title,
              currency: resolvedInvoiceCurrency,
              conversion_rate: needsConversion ? parsedExchangeRate : 1,
              invoice_number: formData.invoice_number,
              invoice_type: formData.invoice_type,
              punto_de_venta: formData.punto_de_venta,
            voucher_type_code: formData.invoice_category,
            invoice_category: formData.invoice_category,
            docstatus: formData.status === 'Confirmada' ? 1 : 0,
            save_as_draft: formData.status === 'Borrador',
            price_list: formData.price_list,
            return_against: formData.return_against || undefined,
            metodo_numeracion_factura_venta: metodoNumeracionValue || undefined,
            items: validItems.map(item => {
              const qtyValue = Math.abs(parseFloat(item.qty) || 0)
              const rateValue = parseFloat(item.rate) || 0
              const { discountAmount, discountPercent, netAmount } = normalizeItemDiscount(item, qtyValue, rateValue)
              const taxRatePayload = item.item_tax_rate || ''
              const effectiveTemplate = taxRatePayload ? '' : (item.item_tax_template || '')

              return {
                item_code: item.item_code,
                item_name: item.item_name,
                description: item.description,
                warehouse: item.warehouse,
                cost_center: item.cost_center,
                uom: item.uom,
                qty: qtyValue,
                rate: rateValue,
                discount_percent: discountPercent,
                discount_percentage: discountPercent,
                discount_amount: discountAmount,
                iva_percent: parseFloat(item.iva_percent) || 21,
                amount: netAmount,
                account: item.account,
                expense_account: item.expense_account,
                valuation_rate: parseFloat(item.valuation_rate) || rateValue,
                item_tax_template: effectiveTemplate,
                item_tax_rate: taxRatePayload,
                purchase_receipt: item.purchase_receipt || '',
                pr_detail: item.pr_detail || '',
                purchase_receipt_item: item.purchase_receipt_item || item.pr_detail || '',
                purchase_order: item.purchase_order || '',
                po_detail: item.po_detail || '',
                purchase_order_item: item.purchase_order_item || item.po_detail || ''
              }
            }),
            discount_amount: parseFloat(formData.discount_amount) || 0,
            net_gravado: parseFloat(formData.net_gravado) || 0,
            net_no_gravado: parseFloat(formData.net_no_gravado) || 0,
            total_iva: parseFloat(formData.total_iva) || 0,
            percepcion_iva: parseFloat(formData.percepcion_iva) || 0,
            percepcion_iibb: parseFloat(formData.percepcion_iibb) || 0,
            perceptions: formData.perceptions || [], // Nuevo modelo unificado de percepciones
            sales_condition_type: formData.sales_condition_type,
            sales_condition_amount: formData.sales_condition_amount,
            sales_condition_days: formData.sales_condition_days
          },
          isEditing: isEditing
        }

        if (isEditing) {
          if (formData.status === 'Confirmada' && editingInvoiceFullName) {
            saveData.data.name = editingInvoiceFullName
          } else if (editingInvoiceFullName) {
            saveData.data.name = editingInvoiceFullName
          }
        }
      }

      const response = await fetchWithAuth(apiEndpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(saveData)
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          showNotification(
            isCreditNote(formData.invoice_type)
              ? `Nota de crédito ${isEditing ? 'actualizada' : 'creada'} exitosamente`
              : `Factura ${isEditing ? 'actualizada' : 'creada'} exitosamente`,
            'success'
          )
          // Notify parent that invoice was saved/updated so it can refresh UI
          try {
            if (onSaved) onSaved(result.data)
          } catch (e) {
            console.warn('onSaved callback error:', e)
          }

          onClose()
        } else {
          showNotification(result.message || 'Error al guardar', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al guardar', 'error')
      }
    } catch (error) {
      console.error('Error saving invoice:', error)
      showNotification('Error al guardar', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (editingInvoiceNo) => {
    console.log('🗑️ OPERATIONS: Eliminando factura con nombre:', editingInvoiceNo)
    console.log('   Tipo de dato:', typeof editingInvoiceNo)
    console.log('   Longitud:', editingInvoiceNo?.length)

    if (!isEditing || !editingInvoiceNo) {
      showNotification('No hay factura para eliminar', 'error')
      return
    }

    setIsDeleting(true)
    try {
      console.log('📡 Enviando DELETE request a:', `/api/purchase-invoices/${editingInvoiceNo}`)
      const response = await fetchWithAuth(`/api/purchase-invoices/${editingInvoiceNo}`, {
        method: 'DELETE',
      })

      console.log('📡 Respuesta del servidor:', response.status, response.statusText)

      if (response.ok) {
        console.log('✅ Factura eliminada exitosamente')
        showNotification('Factura eliminada exitosamente', 'success')
        onClose()
        // Llamar al callback de eliminación para refrescar datos
        if (onDelete) {
          console.log('🔄 Ejecutando callback onDelete para refrescar datos')
          onDelete()
        }
      } else {
        const errorData = await response.json()
        console.error('❌ Error al eliminar factura:', errorData)
        showNotification(`Error al eliminar factura: ${errorData.message || 'Error desconocido'}`, 'error')
      }
    } catch (error) {
      console.error('💥 Error deleting invoice:', error)
      showNotification('Error al eliminar factura', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  return {
    isSaving,
    setIsSaving,
    isDeleting,
    setIsDeleting,
    handleSave,
    handleDelete
  }
}
