// --- FUNCIONES PARA MANEJAR NOTAS DE CRÉDITO ---

import { isCreditNoteLabel } from '../../../utils/comprobantes'

// Determinar si el comprobante seleccionado es una nota de crédito
export const isCreditNote = (invoiceType) => {
  return isCreditNoteLabel(invoiceType)
}

// Cargar facturas pendientes del cliente para notas de crédito
// Ahora fetchUnpaidInvoices también devuelve resúmenes de conciliaciones
export const fetchUnpaidInvoices = async (customer, fetchWithAuth, setUnpaidInvoices, setConciliations, showNotification) => {
  if (!customer) {
    setUnpaidInvoices([])
    setConciliations && setConciliations([])
    return
  }

  try {
    const response = await fetchWithAuth(`/api/customer-statements?customer=${encodeURIComponent(customer)}&page=1&limit=1000`)
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        // Pending invoices (sin balanceados) y conciliaciones resumen
        setUnpaidInvoices(data.pending_invoices || [])
        setConciliations && setConciliations(data.conciliations || [])
      } else {
        setUnpaidInvoices([])
        setConciliations && setConciliations([])
      }
    } else {
      setUnpaidInvoices([])
    }
  } catch (error) {
    console.error('Error fetching unpaid invoices:', error)
    setUnpaidInvoices([])
    showNotification('Error al cargar facturas pendientes', 'error')
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

        // For credit notes, keep quantities positive in the UI so users can edit
        // them naturally; express the negative value via the rate (so qty * rate
        // results in a negative amount) and keep the stored amount negative.
        const itemsWithReference = invoiceDetails.items.map(item => {
          const qty = item.qty ? parseFloat(item.qty) : 1
          const positiveQty = Math.abs(qty)

          // Calcular el precio unitario proporcional basado en el monto aplicado
          let newRate = item.rate
          if (invoiceTotal > 0 && appliedAmount !== 0) {
            // Calcular qué porcentaje del total representa este item
            const itemPercentage = (parseFloat(item.amount) || 0) / invoiceTotal
            // Aplicar ese porcentaje al monto aplicado para obtener el nuevo precio unitario
            const proportionalAmount = appliedAmount * itemPercentage
            // El nuevo precio unitario es el monto proporcional dividido por la cantidad
            // Para notas de crédito, usar un rate negativo para que qty * rate sea negativo
            newRate = -(proportionalAmount / Math.abs(qty))
          } else {
            // Si no hay distribución proporcional, asegurar que el rate sea negativo
            newRate = -(Math.abs(newRate || 0))
          }

          return {
            // Usar exactamente los mismos campos que vienen de la factura original
            item_code: item.item_code,
            item_name: item.item_name,
            description: item.description,
            warehouse: item.warehouse,
            cost_center: item.cost_center,
            uom: item.uom,
            // Mantener la cantidad como positiva para la UI
            qty: positiveQty,
            // Rate negativo para representar la nota de crédito
            rate: newRate,
            discount_percent: item.discount_percent || 0,
            iva_percent: item.iva_percent,
            // Mantener amount negativo para claridad y compatibilidad
            amount: item.amount ? -Math.abs(parseFloat(item.amount) || 0) * (appliedAmount / invoiceTotal) : 0,
            account: item.account
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
    uniqueDocs.push({ name, amount: parseNumericAmount(amount) })
  }

  if (group && Array.isArray(group.documents) && group.documents.length > 0) {
    group.documents.forEach(doc => {
      const name = doc.voucher_no || doc.name
      if (!name) return
      const invoice = unpaidInvoices.find(inv => inv.name === name)
      const amount = invoice?.outstanding_amount ?? doc.outstanding ?? doc.amount ?? 0
      pushDoc(name, amount)
    })
  }

  if (uniqueDocs.length === 0) {
    unpaidInvoices.forEach(inv => {
      if (inv.custom_conciliation_id === concId) {
        pushDoc(inv.name, inv.outstanding_amount)
      }
    })
  }

  return uniqueDocs
}

export const createHandleUnpaidInvoiceSelection = (setFormData, unpaidInvoices, showNotification) => {
  return (invoiceKey, isSelected, group) => {
    // invoiceKey puede ser 'CONC|<id>' para grupos de conciliación o el nombre de la factura
    setFormData(prev => {
      const currentSelected = prev.selected_unpaid_invoices || []
      let newSelected = [...currentSelected]

      if (String(invoiceKey).startsWith('CONC|')) {
        const concId = invoiceKey.split('|')[1]
        const groupDocs = buildConciliationDocs(group, concId, unpaidInvoices)

        if (isSelected) {
          // Replace existing selections with the group invoices (prevent mixing groups)
          // Use the signed outstanding amount (not absolute) so the net equals the conciliation net.
          newSelected = groupDocs
        } else {
          // Remover todas las facturas del grupo
          const ids = new Set(groupDocs.map(i => i.name))
          newSelected = newSelected.filter(item => !ids.has(item.name))
        }
      } else {
        // Selección individual: invoiceKey es el nombre
        const invoice = unpaidInvoices.find(inv => inv.name === invoiceKey)
        if (!invoice) return prev

        if (isSelected) {
          // Verificar que no estemos mezclando conciliaciones distintas
          const selectedConcIds = new Set()
          newSelected.forEach(s => {
            const inv = unpaidInvoices.find(u => u.name === s.name)
            if (inv && inv.custom_conciliation_id) selectedConcIds.add(inv.custom_conciliation_id)
          })
          if (invoice.custom_conciliation_id) selectedConcIds.add(invoice.custom_conciliation_id)
          if (selectedConcIds.size > 1) {
            // No se permite aplicar una nota de crédito a más de una conciliación
            showNotification && showNotification('No se puede aplicar una nota de crédito para dos conciliaciones diferentes', 'error')
            // Devolver prev y no modificar selección
            return prev
          }

          // Keep the sign of outstanding_amount so totals reflect conciliation net
          const amt = parseFloat(invoice.outstanding_amount) || 0
          if (!newSelected.some(item => item.name === invoice.name)) {
            newSelected.push({ name: invoice.name, amount: amt })
          }
        } else {
          newSelected = newSelected.filter(item => item.name !== invoice.name)
        }
      }

      // Calcular total de las facturas seleccionadas (usar outstanding_amount, no edición manual)
      const sumOfSelected = newSelected.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)

      const groupNetValue = group && String(invoiceKey).startsWith('CONC|')
        ? parseFloat(group.net_amount)
        : null

      const totalSelected = (isSelected && groupNetValue !== null && !Number.isNaN(groupNetValue))
        ? groupNetValue
        : sumOfSelected

      // Mostrar el total como valor absoluto positivo (coincide con el neto de la conciliación)
      return {
        ...prev,
        selected_unpaid_invoices: newSelected,
        credit_note_total: Math.abs(totalSelected).toFixed(2)
      }
    })
  }
}

// Crear manejador para cambio de monto personalizado
// Mantener la firma por compatibilidad, pero ya no permitimos editar los montos manualmente
export const createHandleUnpaidInvoiceAmountChange = (setFormData) => {
  return () => {
    // No-op: no permitimos cambios manuales al monto de aplicación desde UI
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