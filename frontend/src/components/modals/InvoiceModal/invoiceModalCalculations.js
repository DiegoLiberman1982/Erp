// invoiceModalCalculations.js - Calculation functions for InvoiceModal

/**
 * Calculates the total amount for an item including IVA
 * @param {Object} item - The item object with qty, rate, discount_amount, iva_percent
 * @returns {string} The calculated amount as a string with 2 decimal places
 */
export const calculateItemAmount = (item) => {
  const qty = parseFloat(item.qty || '0') || 0
  const rate = parseFloat(item.rate || '0') || 0
  const discountAmount = parseFloat(item.discount_amount || '0') || 0
  const ivaPercent = parseFloat(item.iva_percent || '0') || 0

  // Calculate subtotal before discount
  const subtotal = qty * rate
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
      const discountAmount = parseFloat(item.discount_amount) || 0
      const subtotal = qty * rate
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
      const discountAmount = parseFloat(item.discount_amount) || 0
      const ivaPercent = parseFloat(item.iva_percent) || 0
      const subtotal = qty * rate
      const afterDiscount = subtotal - discountAmount
      const ivaAmount = afterDiscount * (ivaPercent / 100)
      return total + ivaAmount
    }, 0)
}

/**
 * Calculates the total invoice amount
 * @param {Array} items - Array of item objects
 * @param {Object} formData - Form data object with discount_amount, percepcion_iva, percepcion_iibb
 * @returns {number} The total amount
 */
export const calculateTotal = (items, formData) => {
  const netGravado = calculateNetGravado(items)
  const iva = calculateTotalIVA(items)
  const discount = parseFloat(formData.discount_amount) || 0
  const percepcionIVA = parseFloat(formData.percepcion_iva) || 0
  const percepcionIIBB = parseFloat(formData.percepcion_iibb) || 0
  return netGravado + iva - discount + percepcionIVA + percepcionIIBB
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