// invoiceModalCalculations.js - Calculation functions for InvoiceModal

/**
 * Calculates the total amount for an item including IVA and currency conversion
 * @param {Object} item - The item object with qty, rate, discount_amount, iva_percent
 * @param {string} invoiceCurrency - Currency of the invoice (defaults to empty string)
 * @param {number} invoiceExchangeRate - Exchange rate of the invoice
 * @param {Object} priceListDetails - Details of the selected price list (currency, exchange_rate)
 * @returns {string} The calculated amount as a string with 2 decimal places
 */
export const calculateItemAmount = (item, invoiceCurrency = '', invoiceExchangeRate = 1, priceListDetails = null) => {
  let rate = parseFloat(item.rate || '0') || 0

  // Note: Currency conversion is already applied when fetching the price from the price list
  // No additional conversion needed here

  const qty = parseFloat(item.qty || '0') || 0
  let discountAmount = parseFloat(item.discount_amount || '0') || 0
  const ivaPercent = parseFloat(item.iva_percent || '0') || 0

  // Calculate subtotal before discount
  const subtotal = qty * rate
  if (discountAmount < 0) discountAmount = 0
  if (discountAmount > subtotal) discountAmount = subtotal
  // Apply discount
  const afterDiscount = subtotal - discountAmount
  // Calculate IVA
  const ivaAmount = afterDiscount * (ivaPercent / 100)
  // Final amount
  return (afterDiscount + ivaAmount).toFixed(2)
}

/**
 * Calculates the subtotal of all valid items
 * @param {Array} items - Array of item objects
 * @returns {number} The subtotal amount
 */
export const calculateSubtotal = (items) => {
  return items
    .filter(item => (item.item_code && item.item_code.trim() !== '') || (item.description && item.description.trim() !== ''))
    .reduce((total, item) => total + (parseFloat(item.amount) || 0), 0)
}

/**
 * Calculates the net gravado (taxable amount before IVA)
 * @param {Array} items - Array of item objects
 * @returns {number} The net gravado amount
 */
export const calculateNetGravado = (items) => {
  return items
    .filter(item => (item.item_code && item.item_code.trim() !== '') || (item.description && item.description.trim() !== ''))
    .reduce((total, item) => {
      const qty = parseFloat(item.qty) || 0
      const rate = parseFloat(item.rate) || 0
      let discountAmount = parseFloat(item.discount_amount) || 0
      const subtotal = qty * rate
      if (discountAmount < 0) discountAmount = 0
      if (discountAmount > subtotal) discountAmount = subtotal
      return total + (subtotal - discountAmount)
    }, 0)
}

/**
 * Calculates the total IVA amount
 * @param {Array} items - Array of item objects
 * @returns {number} The total IVA amount
 */
export const calculateTotalIVA = (items) => {
  return items
    .filter(item => (item.item_code && item.item_code.trim() !== '') || (item.description && item.description.trim() !== ''))
    .reduce((total, item) => {
      const qty = parseFloat(item.qty) || 0
      const rate = parseFloat(item.rate) || 0
      let discountAmount = parseFloat(item.discount_amount) || 0
      const ivaPercent = parseFloat(item.iva_percent) || 0
      const subtotal = qty * rate
      if (discountAmount < 0) discountAmount = 0
      if (discountAmount > subtotal) discountAmount = subtotal
      const afterDiscount = subtotal - discountAmount
      const ivaAmount = afterDiscount * (ivaPercent / 100)
      return total + ivaAmount
    }, 0)
}

/**
 * Calculates the total invoice amount
 * @param {Array} items - Array of item objects
 * @param {Object} formData - Form data object with discount_amount and perceptions array
 * @returns {number} The total amount
 */
export const calculateTotal = (items, formData) => {
  const netGravado = calculateNetGravado(items)
  const iva = calculateTotalIVA(items)
  const discount = parseFloat(formData.discount_amount) || 0
  
  // Sumar todas las percepciones del nuevo modelo unificado
  const totalPerceptions = (formData.perceptions || []).reduce(
    (total, p) => total + (parseFloat(p.total_amount) || 0), 
    0
  )
  
  return netGravado + iva - discount + totalPerceptions
}

/**
 * Calculates the due date based on payment term and posting date
 * @param {string} paymentTermName - Name of the payment term
 * @param {string} postingDate - Posting date in YYYY-MM-DD format
 * @param {Array} paymentTerms - Array of payment term objects
 * @returns {string} Due date in YYYY-MM-DD format
 */
export const calculateDueDate = (paymentTermName, postingDate, paymentTerms) => {
  if (!postingDate) return ''

  // Find the selected payment term
  const selectedTerm = paymentTerms.find(term => term.name === paymentTermName)

  let creditDays = 0 // Default to 0 days (Contado)

  if (selectedTerm && selectedTerm.terms && selectedTerm.terms.length > 0) {
    creditDays = selectedTerm.terms[0].credit_days || 0
  } else if (paymentTermName && paymentTermName.toLowerCase().includes('contado')) {
    // If it's "Contado" but not found in payment terms, assume 0 days
    creditDays = 0
  }

  // Calculate due date by adding credit days to posting date
  const postingDateObj = new Date(postingDate)
  postingDateObj.setDate(postingDateObj.getDate() + creditDays)

  return postingDateObj.toISOString().split('T')[0]
}
