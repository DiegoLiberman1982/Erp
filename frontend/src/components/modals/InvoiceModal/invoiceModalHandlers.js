// invoiceModalHandlers.js - Event handlers for InvoiceModal

import { calculateItemAmount } from './invoiceModalCalculations.js'
import { getDefaultIVARate } from './invoiceModalUtils.js'
import { normalizeDecimalInput } from '../../../utils/decimalInput.js'

/**
 * Creates a handler for input changes in the form
 * @param {Function} setFormData - State setter for form data
 * @param {Function} fetchExchangeRate - Function to fetch exchange rate
 * @param {Function} setExchangeRateDate - State setter for exchange rate date
 * @param {Object} formData - Current form data
 * @returns {Function} Input change handler
 */
export const createHandleInputChange = (setFormData, fetchExchangeRate, setExchangeRateDate, formData, baseCurrency) => {
  return (field, value) => {
    // Formatear invoice_number con ceros a la izquierda
    let formattedValue = value
    if (field === 'invoice_number') {
      // Convertir a número, luego formatear con 8 dígitos
      const digits = (value ?? '').toString().replace(/[^\d]/g, '').slice(0, 8)
      formattedValue = digits
    }

    setFormData(prev => ({
      ...prev,
      [field]: formattedValue
    }))

    // Si cambia la moneda, obtener la tasa de cambio automáticamente
    if (field === 'currency') {
      fetchExchangeRate(value)
    }

    // Si cambia la fecha de emisión y la moneda no es la base, actualizar la fecha de la cotización
    if (field === 'posting_date' && formData.currency && baseCurrency && formData.currency !== baseCurrency) {
      setExchangeRateDate(value)
    }
  }
}

/**
 * Creates a handler for item changes
 * @param {Function} setFormData - State setter for form data
 * @returns {Function} Item change handler
 */
export const createHandleItemChange = (setFormData) => {
  return (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => {
        if (i === index) {
          // Asegurar que el valor sea siempre un string válido
          let safeValue = (value != null ? value.toString() : '')
          
          // LÓGICA DE SIGNOS SEGÚN TIPO DE COMPROBANTE
          const isCreditNote = prev.invoice_type && (
            prev.invoice_type.toLowerCase().includes('crédito') || 
            prev.invoice_type.toLowerCase().includes('credito')
          )
          
          if (field === 'qty') {
            // Quantities should always be stored as positive numbers in the UI.
            // Previously we forced negative quantities for credit notes which
            // caused the behavior you reported (editing flipped sign). Keep
            // quantities positive and let amount/total logic or backend handle
            // sign/negation for credit notes when necessary.
            const numValue = parseFloat(safeValue) || 0
            safeValue = Math.abs(numValue).toString()
          } else if (field === 'rate') {
            safeValue = normalizeDecimalInput(safeValue)
          }
          
          // Crear el item actualizado con el nuevo valor
          const updatedItem = {
            ...item,
            [field]: safeValue
          }

          // Asegurar que todos los campos requeridos tengan valores por defecto
          updatedItem.item_code = updatedItem.item_code || ''
          updatedItem.item_name = updatedItem.item_name || ''
          updatedItem.description = updatedItem.description || ''
          updatedItem.warehouse = updatedItem.warehouse || ''
          updatedItem.cost_center = updatedItem.cost_center || ''
          updatedItem.uom = updatedItem.uom || 'Unidad'
          updatedItem.account = updatedItem.account || ''

          // Auto-calculate amount when relevant fields change
          if (['qty', 'rate', 'discount_amount', 'iva_percent'].includes(field)) {
            updatedItem.amount = calculateItemAmount(updatedItem)
          }

          return updatedItem
        }
        return item
      })
    }))
  }
}

/**
 * Creates a handler for adding new items
 * @param {Function} setFormData - State setter for form data
 * @param {Object} customerDetails - Customer details
 * @param {Object} activeCompanyDetails - Active company details
 * @param {Object} rateToTemplateMap - Rate to template mapping
 * @returns {Function} Add item handler
 */
export const createAddItem = (setFormData, customerDetails, activeCompanyDetails, rateToTemplateMap) => {
  return () => {
    const defaultIVARate = getDefaultIVARate(customerDetails, activeCompanyDetails, rateToTemplateMap)
    setFormData(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          item_code: '',
          item_name: '',
          description: '',
          warehouse: '',
          cost_center: '',
          uom: 'Unidad',
          qty: '1',
          rate: '0.00',
          discount_amount: '0.00',
          iva_percent: defaultIVARate,
          amount: '0.00',
          account: '' // La cuenta de ingresos se determina automáticamente por el backend
        }
      ]
    }))
  }
}

/**
 * Creates a handler for removing items
 * @param {Function} setFormData - State setter for form data
 * @param {Array} items - Current items array
 * @returns {Function} Remove item handler
 */
export const createRemoveItem = (setFormData, items) => {
  return (index) => {
    if (items.length > 1) {
      setFormData(prev => ({
        ...prev,
        items: prev.items.filter((_, i) => i !== index)
      }))
    }
  }
}
