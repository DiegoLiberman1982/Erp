// purchaseInvoiceModalHandlers.js - Event handlers for PurchaseInvoiceModal

import { calculateItemAmount } from './purchaseInvoiceModalCalculations.js'
import { getDefaultIVARate } from './purchaseInvoiceModalUtils.js'
import { fetchPurchasePriceListDetails } from './purchaseInvoiceModalApi.js'
import { normalizeDecimalInput } from '../../../utils/decimalInput.js'
import { clampSelectedInvoicesToCreditLimit } from './purchaseInvoiceModalCreditNotes.js'

/**
 * Creates a handler for input changes in the form
 * @param {Function} setFormData - State setter for form data
 * @param {Function} fetchExchangeRate - Function to fetch exchange rate
 * @param {Function} setExchangeRateDate - State setter for exchange rate date
 * @param {Object} formData - Current form data
 * @param {Function} fetchWithAuth - Authenticated fetch function
 * @param {Function} setSelectedPriceListDetails - State setter for price list details
 * @param {Function} showNotification - Notification function
 * @returns {Function} Input change handler
 */
export const createHandleInputChange = (
  setFormData,
  fetchExchangeRate,
  setExchangeRateDate,
  formData,
  fetchWithAuth,
  setSelectedPriceListDetails,
  showNotification,
  companyCurrency
) => {
  return async (field, value) => {
    setFormData(prev => {
      const nextForm = {
        ...prev,
        [field]: value
      }

      if (field === 'discount_amount' && (nextForm.selected_unpaid_invoices?.length || 0) > 0) {
        const { selected_unpaid_invoices, credit_note_total } = clampSelectedInvoicesToCreditLimit(nextForm)
        nextForm.selected_unpaid_invoices = selected_unpaid_invoices
        nextForm.credit_note_total = credit_note_total
      }

      return nextForm
    })

    // Si cambia la moneda, obtener la tasa de cambio automáticamente
    if (field === 'currency') {
      fetchExchangeRate(value)
    }

    // Si cambia la fecha de emisión y la moneda no es la base, actualizar la fecha de la cotización
    if (field === 'bill_date' && formData.currency && companyCurrency && formData.currency !== companyCurrency) {
      setExchangeRateDate(value)
    }

    // Si cambia la lista de precios, obtener los detalles de la lista seleccionada
    if (field === 'price_list') {
      if (value) {
        try {
          const priceListDetails = await fetchPurchasePriceListDetails(fetchWithAuth, value)
          setSelectedPriceListDetails(priceListDetails)
          console.log('Selected price list details:', priceListDetails)
        } catch (error) {
          console.error('Error fetching price list details:', error)
          setSelectedPriceListDetails(null)
          showNotification('Error al obtener detalles de la lista de precios', 'error')
        }
      } else {
        setSelectedPriceListDetails(null)
      }
    }
  }
}

/**
 * Creates a handler for item changes
 * @param {Function} setFormData - State setter for form data
 * @param {string} invoiceCurrency - Current invoice currency
 * @param {number} invoiceExchangeRate - Current invoice exchange rate
 * @param {Object} selectedPriceListDetails - Details of selected price list
 * @returns {Function} Item change handler
 */
export const createHandleItemChange = (
  setFormData,
  invoiceCurrency,
  invoiceExchangeRate,
  selectedPriceListDetails,
  ivaRateAccountMap = {}
) => {
  return (index, field, value) => {
    setFormData(prev => {
      const updatedItems = prev.items.map((item, i) => {
        if (i === index) {
          // Asegurar que el valor sea siempre un string válido
          let safeValue = (value != null ? value.toString() : '')
          let ivaSelectionPayload = null

          if (field === 'qty') {
            // Mostrar cantidades en positivo independientemente del tipo de comprobante
            const numValue = parseFloat(safeValue) || 0
            safeValue = Math.abs(numValue).toString()
          } else if (field === 'rate') {
            safeValue = normalizeDecimalInput(safeValue)
          } else if (field === 'discount_amount') {
            safeValue = normalizeDecimalInput(safeValue)
          } else if (field === 'iva_percent') {
            const numericPercent = parseFloat(safeValue) || 0
            const normalizedPercent = numericPercent.toFixed(2)
            safeValue = normalizedPercent

            const account = (() => {
              if (!ivaRateAccountMap || typeof ivaRateAccountMap !== 'object') return null
              const key = normalizedPercent
              if (ivaRateAccountMap[key]) return ivaRateAccountMap[key]
              const fallbackKey = numericPercent.toString()
              if (ivaRateAccountMap[fallbackKey]) return ivaRateAccountMap[fallbackKey]
              return null
            })()

            ivaSelectionPayload = { account, percent: numericPercent }
          }
          
          // Crear el item actualizado con el nuevo valor
          const updatedItem = {
            ...item,
            [field]: safeValue
          }

          if (field === 'iva_percent') {
            if (ivaSelectionPayload && ivaSelectionPayload.account) {
              const payload = {}
              payload[ivaSelectionPayload.account] = ivaSelectionPayload.percent
              updatedItem.item_tax_rate = JSON.stringify(payload)
              updatedItem.item_tax_template = ''
            } else if (ivaSelectionPayload) {
              updatedItem.item_tax_rate = ''
            }
          }

          // Asegurar que todos los campos requeridos tengan valores por defecto
          updatedItem.item_code = updatedItem.item_code || ''
          updatedItem.item_name = updatedItem.item_name || ''
          updatedItem.description = updatedItem.description || ''
          updatedItem.warehouse = updatedItem.warehouse || ''
          updatedItem.cost_center = updatedItem.cost_center || ''
          updatedItem.uom = updatedItem.uom || 'Unidad'
          updatedItem.account = updatedItem.account || ''

          const qtyValue = parseFloat(updatedItem.qty) || 0
          const rateValue = parseFloat(updatedItem.rate) || 0
          const subtotal = qtyValue * rateValue

          if (field === 'discount_percent') {
            const percentVal = parseFloat(safeValue) || 0
            const calcDiscount = subtotal * (percentVal / 100)
            updatedItem.discount_percent = percentVal.toString()
            updatedItem.discount_percentage = updatedItem.discount_percent
            updatedItem.discount_amount = calcDiscount.toFixed(2)
          } else if (field === 'discount_amount') {
            const discountVal = parseFloat(safeValue) || 0
            const percent = subtotal > 0 ? (discountVal / subtotal) * 100 : 0
            updatedItem.discount_amount = discountVal.toFixed(2)
            updatedItem.discount_percent = percent.toFixed(2)
            updatedItem.discount_percentage = updatedItem.discount_percent
          } else if (['qty', 'rate'].includes(field)) {
            const percentVal = parseFloat(updatedItem.discount_percent) || 0
            if (percentVal) {
              const calcDiscount = subtotal * (percentVal / 100)
              updatedItem.discount_amount = calcDiscount.toFixed(2)
            } else {
              const discountVal = parseFloat(updatedItem.discount_amount) || 0
              if (discountVal && subtotal > 0) {
                const percent = (discountVal / subtotal) * 100
                updatedItem.discount_percent = percent.toFixed(2)
                updatedItem.discount_percentage = updatedItem.discount_percent
              }
            }
          }

          // Auto-calculate amount when relevant fields change
          if (['qty', 'rate', 'discount_amount', 'discount_percent', 'iva_percent'].includes(field)) {
            updatedItem.amount = calculateItemAmount(updatedItem, invoiceCurrency, invoiceExchangeRate, selectedPriceListDetails)
          }

          return updatedItem
        }
        return item
      })

      const nextForm = {
        ...prev,
        items: updatedItems
      }

      if ((nextForm.selected_unpaid_invoices?.length || 0) > 0) {
        const { selected_unpaid_invoices, credit_note_total } = clampSelectedInvoicesToCreditLimit(nextForm)
        nextForm.selected_unpaid_invoices = selected_unpaid_invoices
        nextForm.credit_note_total = credit_note_total
      }

      return nextForm
    })
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
    setFormData(prev => {
      const newItems = [
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
          account: '',
          item_tax_template: '',
          item_tax_rate: ''
        }
      ]

      const nextForm = {
        ...prev,
        items: newItems
      }

      if ((nextForm.selected_unpaid_invoices?.length || 0) > 0) {
        const { selected_unpaid_invoices, credit_note_total } = clampSelectedInvoicesToCreditLimit(nextForm)
        nextForm.selected_unpaid_invoices = selected_unpaid_invoices
        nextForm.credit_note_total = credit_note_total
      }

      return nextForm
    })
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
      setFormData(prev => {
        const filteredItems = prev.items.filter((_, i) => i !== index)
        const nextForm = {
          ...prev,
          items: filteredItems
        }

        if ((nextForm.selected_unpaid_invoices?.length || 0) > 0) {
          const { selected_unpaid_invoices, credit_note_total } = clampSelectedInvoicesToCreditLimit(nextForm)
          nextForm.selected_unpaid_invoices = selected_unpaid_invoices
          nextForm.credit_note_total = credit_note_total
        }

        return nextForm
      })
    }
  }
}
