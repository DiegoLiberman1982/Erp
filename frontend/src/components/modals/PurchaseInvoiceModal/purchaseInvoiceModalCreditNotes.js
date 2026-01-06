// --- FUNCIONES PARA MANEJAR NOTAS DE CRÉDITO ---

import { calculateTotal } from './purchaseInvoiceModalCalculations.js'
import { isCreditNoteLabel } from '../../../utils/comprobantes'

// Determinar si el comprobante seleccionado es una nota de crédito
export const isCreditNote = (invoiceType) => {
  return isCreditNoteLabel(invoiceType)
}

const toPositiveNumber = (value) => {
  const parsed = parseFloat(value)
  if (Number.isNaN(parsed)) return 0
  return Math.max(0, Math.abs(parsed))
}

const resolveCompanyAmount = (source = {}, preferredKeys = [], fallbackKeys = []) => {
  for (const key of preferredKeys) {
    if (source[key] === undefined || source[key] === null || source[key] === '') continue
    const parsed = Number(source[key])
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  for (const key of fallbackKeys) {
    if (source[key] === undefined || source[key] === null || source[key] === '') continue
    const parsed = Number(source[key])
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 0
}

const getOutstandingInCompanyCurrency = (doc = {}) => {
  return resolveCompanyAmount(
    doc,
    [
      'outstanding_in_company_currency',
      'outstanding_amount_in_company_currency',
      'base_outstanding_amount',
      'balance_in_company_currency'
    ],
    ['outstanding_amount', 'amount', 'allocated_amount']
  )
}

// Obtener el tope de importe aplicable según el total mostrado en el resumen
export const getMaxApplicableCreditAmount = (formData = {}) => {
  if (!isCreditNote(formData.invoice_type)) return 0
  const workingItems = Array.isArray(formData.items) ? formData.items : []
  const computedTotal = Math.abs(calculateTotal(workingItems, formData))
  return computedTotal > 0 ? computedTotal : 0
}

// Ajustar los montos de facturas seleccionadas para no superar el tope disponible
export const clampSelectedInvoicesToCreditLimit = (
  formData = {},
  selectedOverride = null,
  itemsOverride = null
) => {
  const selected = Array.isArray(selectedOverride)
    ? selectedOverride
    : (formData.selected_unpaid_invoices || [])
  const workingItems = Array.isArray(itemsOverride) ? itemsOverride : (formData.items || [])
  const availableCapacity = getMaxApplicableCreditAmount({ ...formData, items: workingItems })

  const hasToClamp = isCreditNote(formData.invoice_type) && selected.length > 0 && availableCapacity >= 0
  if (!hasToClamp) {
    const appliedTotal = selected.reduce((sum, entry) => sum + toPositiveNumber(entry.amount), 0)
    return {
      selected_unpaid_invoices: selected,
      credit_note_total: appliedTotal.toFixed(2),
      available_credit_total: availableCapacity
    }
  }

  let remaining = availableCapacity
  const adjustedSelections = selected.map(entry => {
    const requested = toPositiveNumber(entry.amount)
    const allowed = Math.min(requested, remaining)
    remaining -= allowed
    const normalizedAmount = parseFloat(allowed.toFixed(2))
    const updatedEntry = {
      ...entry,
      amount: normalizedAmount
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'allocated_amount')) {
      updatedEntry.allocated_amount = normalizedAmount
    }
    return updatedEntry
  })

  const appliedTotal = adjustedSelections.reduce((sum, entry) => sum + toPositiveNumber(entry.amount), 0)

  return {
    selected_unpaid_invoices: adjustedSelections,
    credit_note_total: appliedTotal.toFixed(2),
    available_credit_total: availableCapacity
  }
}

const pickPrimaryInvoiceName = (selected = []) => {
  if (!Array.isArray(selected) || selected.length === 0) return ''
  const withAmount = selected.find(entry => toPositiveNumber(entry.amount) > 0)
  return (withAmount && withAmount.name) || selected[0].name || ''
}

// Cargar facturas pendientes del cliente para notas de crédito
export const fetchUnpaidInvoices = async (supplier, fetchWithAuth, setUnpaidInvoices, setConciliations, showNotification) => {
  if (!supplier) {
    setUnpaidInvoices([])
    setConciliations && setConciliations([])
    return
  }

  try {
    const response = await fetchWithAuth(`/api/suppliers/${encodeURIComponent(supplier)}/statements?page=1&limit=1000`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        const pending = (data.pending_invoices || []).filter(invoice => Math.abs(parseFloat(invoice.outstanding_amount || 0)) > 0.01)
        setUnpaidInvoices(pending)
        setConciliations && setConciliations(data.conciliations || [])
      } else {
        setUnpaidInvoices([])
        setConciliations && setConciliations([])
      }
    } else {
      setUnpaidInvoices([])
      setConciliations && setConciliations([])
    }
  } catch (error) {
    console.error('Error fetching unpaid invoices:', error)
    setUnpaidInvoices([])
    setConciliations && setConciliations([])
    showNotification && showNotification('Error al cargar facturas pendientes', 'error')
  }
}

// Obtener detalles completos de una factura (incluyendo items)
export const fetchInvoiceDetails = async (invoiceName, fetchWithAuth) => {
  try {
    const response = await fetchWithAuth(`/api/invoices/${encodeURIComponent(invoiceName)}`)
    if (response.ok) {
      const data = await response.json()
      return data.success ? data.data : null
    }
    return null
  } catch (error) {
    console.error('Error fetching invoice details:', error)
    return null
  }
}

// Agregar items de facturas asociadas a la nota de crédito
export const addItemsFromAssociatedInvoices = async (selectedInvoices, fetchWithAuth, setFormData, showNotification) => {
  if (!selectedInvoices || selectedInvoices.length === 0) return

  // Función para obtener facturas ya procesadas desde los items existentes
  const getProcessedInvoices = (currentItems) => {
    const processed = new Set()
    currentItems.forEach(item => {
      if (item.description) {
        // Buscar patrones como "Ref. FACT-XXX:" en las descripciones
        const match = item.description.match(/^Ref\.\s*([^:]+):/)
        if (match) {
          processed.add(match[1].trim())
        }
      }
    })
    return processed
  }

  // Obtener items actuales para detectar duplicados
  const currentItems = await new Promise(resolve => {
    setFormData(prev => {
      resolve([...prev.items])
      return prev
    })
  })

  const processedInvoices = getProcessedInvoices(currentItems)

  // Filtrar solo las facturas que aún no han sido procesadas
  const newInvoices = selectedInvoices.filter(invoice =>
    !processedInvoices.has(invoice.name)
  )

  if (newInvoices.length === 0) return

  try {
    const allItems = []

    // Función para limpiar referencias existentes en la descripción
    const cleanDescription = (description) => {
      if (!description) return ''
      // Remover cualquier referencia existente del tipo "Ref. FACT-XXX: "
      return description.replace(/^Ref\.\s*[^:]+:\s*/, '').trim()
    }

    // Obtener items solo de las facturas nuevas
    for (const selectedInvoice of newInvoices) {
      const invoiceDetails = await fetchInvoiceDetails(selectedInvoice.name, fetchWithAuth)
      if (invoiceDetails && invoiceDetails.items) {
        // Calcular el total de la factura original para distribución proporcional
        const invoiceTotal = invoiceDetails.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
        const appliedAmount = parseFloat(selectedInvoice.amount) || 0

        // Para notas de crédito, usar exactamente los mismos items de la factura original con cantidades negativas
        const itemsWithReference = invoiceDetails.items.map(item => {
          // Para notas de crédito, las cantidades deben ser negativas
          const qty = item.qty ? parseFloat(item.qty) : 1
          const negativeQty = -Math.abs(qty) // Siempre negativo para credit notes

          // Calcular el precio unitario proporcional basado en el monto aplicado
          let newRate = item.rate
          if (invoiceTotal > 0 && appliedAmount !== 0) {
            // Calcular qué porcentaje del total representa este item
            const itemPercentage = (parseFloat(item.amount) || 0) / invoiceTotal
            // Aplicar ese porcentaje al monto aplicado para obtener el nuevo precio unitario
            const proportionalAmount = appliedAmount * itemPercentage
            // El nuevo precio unitario es el monto proporcional dividido por la cantidad (con signo negativo)
            newRate = proportionalAmount / Math.abs(qty)
          }

          return {
            // Usar exactamente los mismos campos que vienen de la factura original
            item_code: item.item_code,
            item_name: item.item_name,
            description: item.description,
            warehouse: item.warehouse,
            cost_center: item.cost_center,
            uom: item.uom,
            // Solo cambiar la cantidad a negativa
            qty: negativeQty,
            rate: newRate,
            discount_percent: item.discount_percent || 0,
            iva_percent: item.iva_percent,
            amount: item.amount ? -Math.abs(parseFloat(item.amount) || 0) * (appliedAmount / invoiceTotal) : 0,
            account: item.account,
            item_tax_template: item.item_tax_template || ''
          }
        })
        allItems.push(...itemsWithReference)
      }
    }

    if (allItems.length > 0) {
      setFormData(prev => {
        const currentItems = [...prev.items]

        // Función para determinar si un item está vacío
        const isEmptyItem = (item) => {
          return (!item.description || item.description.trim() === '') &&
                 (!item.item_code || item.item_code.trim() === '') &&
                 (!item.qty || item.qty === '1' || item.qty === '0') &&
                 (!item.rate || item.rate === '0.00' || item.rate === '0')
        }

        // Encontrar índices de items vacíos
        const emptyItemIndices = []
        currentItems.forEach((item, index) => {
          if (isEmptyItem(item)) {
            emptyItemIndices.push(index)
          }
        })

        // Reemplazar items vacíos primero
        let replacementIndex = 0
        emptyItemIndices.forEach(emptyIndex => {
          if (replacementIndex < allItems.length) {
            currentItems[emptyIndex] = allItems[replacementIndex]
            replacementIndex++
          }
        })

        // Agregar items restantes al final
        const remainingItems = allItems.slice(replacementIndex)
        if (remainingItems.length > 0) {
          currentItems.push(...remainingItems)
        }

        return {
          ...prev,
          items: currentItems
        }
      })

      showNotification(`Se agregaron ${allItems.length} items de ${newInvoices.length} factura(s) nueva(s)`, 'success')
    }
  } catch (error) {
    console.error('Error adding items from associated invoices:', error)
    showNotification('Error al agregar items de facturas asociadas', 'error')
  }
}

// Crear manejador para selección de facturas pendientes
const parseNumericAmount = (value) => {
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

const buildConciliationDocs = (group, concId, unpaidInvoices) => {
  const uniqueDocs = []
  const seen = new Set()

  const pushDoc = (name, amount) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    uniqueDocs.push({ name, amount: Math.abs(parseNumericAmount(amount)) })
  }

  if (group && Array.isArray(group.documents) && group.documents.length > 0) {
    group.documents.forEach(doc => {
      const name = doc.voucher_no || doc.name
      if (!name) return
      const invoice = unpaidInvoices.find(inv => inv.name === name)
      const amount = invoice ? getOutstandingInCompanyCurrency(invoice) : getOutstandingInCompanyCurrency(doc)
      pushDoc(name, amount)
    })
  }

  if (uniqueDocs.length === 0) {
    unpaidInvoices.forEach(inv => {
      if (inv.custom_conciliation_id === concId) {
        pushDoc(inv.name, getOutstandingInCompanyCurrency(inv))
      }
    })
  }

  return uniqueDocs
}

export const createHandleUnpaidInvoiceSelection = (setFormData, unpaidInvoices, showNotification) => {
  return (invoiceKey, isSelected, group) => {
    setFormData(prev => {
      const currentSelected = prev.selected_unpaid_invoices || []
      let newSelected = [...currentSelected]

      if (String(invoiceKey).startsWith('CONC|')) {
        const concId = invoiceKey.split('|')[1]
        const groupDocs = buildConciliationDocs(group, concId, unpaidInvoices)
        if (isSelected) {
          newSelected = groupDocs
        } else {
          const ids = new Set(groupDocs.map(i => i.name))
          newSelected = newSelected.filter(item => !ids.has(item.name))
        }
      } else {
        const invoice = unpaidInvoices.find(inv => inv.name === invoiceKey)
        if (!invoice) return prev

        if (isSelected) {
          const selectedConcIds = new Set()
          newSelected.forEach(s => {
            const inv = unpaidInvoices.find(u => u.name === s.name)
            if (inv && inv.custom_conciliation_id) selectedConcIds.add(inv.custom_conciliation_id)
          })
          if (invoice.custom_conciliation_id) selectedConcIds.add(invoice.custom_conciliation_id)
          if (selectedConcIds.size > 1) {
            showNotification && showNotification('No se puede aplicar una nota de crédito para dos conciliaciones diferentes', 'error')
            return prev
          }

          const amt = Math.abs(getOutstandingInCompanyCurrency(invoice))
          if (!newSelected.some(item => item.name === invoice.name)) {
            newSelected.push({ name: invoice.name, amount: amt })
          }
        } else {
          newSelected = newSelected.filter(item => item.name !== invoice.name)
        }
      }

      const { selected_unpaid_invoices: clampedSelected, credit_note_total } = clampSelectedInvoicesToCreditLimit(
        prev,
        newSelected
      )

      return {
        ...prev,
        selected_unpaid_invoices: clampedSelected,
        credit_note_total,
        return_against: clampedSelected.length > 0 ? pickPrimaryInvoiceName(clampedSelected) : ''
      }
    })
  }
}

export const createHandleUnpaidInvoiceAmountChange = () => {
  return () => {
    // Ya no soportamos cambios manuales de montos en la UI compartida
  }
}

// Función auxiliar para obtener items de nuevas facturas
const fetchItemsFromNewInvoices = async (newInvoices, fetchWithAuth, showNotification) => {
  const allItems = []

  // Función para limpiar referencias existentes en la descripción
  const cleanDescription = (description) => {
    if (!description) return ''
    // Remover cualquier referencia existente del tipo "Ref. FACT-XXX: "
    return description.replace(/^Ref\.\s*[^:]+:\s*/, '').trim()
  }

  // Obtener items solo de las facturas nuevas
  for (const selectedInvoice of newInvoices) {
    const invoiceDetails = await fetchInvoiceDetails(selectedInvoice.name, fetchWithAuth)
    if (invoiceDetails && invoiceDetails.items) {
      // Agregar items con referencia a la factura original
      const itemsWithReference = invoiceDetails.items.map(item => ({
        ...item,
        // Mantener campos originales pero agregar referencia
        original_invoice: selectedInvoice.name,
        original_item_code: item.item_code,
        original_description: item.original_description || item.description,
        // Limpiar descripción existente y agregar nueva referencia
        description: `Ref. ${selectedInvoice.name}: ${cleanDescription(item.description || item.item_name || '')}`,
        // El resto de campos se mantienen igual
        item_code: '', // Dejar vacío para que sea tratado como item manual
        item_name: cleanDescription(item.item_name || item.description || ''),
        warehouse: item.warehouse || '',
        cost_center: item.cost_center || '',
        uom: item.uom || 'Unidad',
        qty: item.qty ? item.qty.toString() : '1',
        rate: item.rate ? item.rate.toString() : '0.00',
        discount_amount: item.discount_amount ? item.discount_amount.toString() : '0.00',
        iva_percent: item.iva_percent ? item.iva_percent.toString() : '21.00',
        amount: item.amount ? item.amount.toString() : '0.00',
        account: item.account || ''
      }))
      allItems.push(...itemsWithReference)
    }
  }

  return allItems
}
