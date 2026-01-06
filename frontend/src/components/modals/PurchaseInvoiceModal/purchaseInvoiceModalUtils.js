// invoiceModalUtils.js - Utility functions for InvoiceModal

/**
 * Formats a number as currency with proper decimal places and thousand separators
 * @param {number|string} amount - The amount to format
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount) => {
  if (amount === null || amount === undefined || amount === '') return '0.00'
  const num = parseFloat(amount)
  if (isNaN(num)) return '0.00'
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/**
 * Formats a number with proper decimal places
 * @param {number|string} amount - The amount to format
 * @returns {string} Formatted number string
 */
export const formatNumber = (amount) => {
  if (amount === null || amount === undefined || amount === '') return '0.00'
  const num = parseFloat(amount)
  if (isNaN(num)) return '0.00'
  return num.toFixed(2)
}

/**
 * Gets the default IVA rate based on customer and company settings
 * @param {Object} customerDetails - Customer details object
 * @param {Object} activeCompanyDetails - Active company details object
 * @param {Object} rateToTemplateMap - Rate to template mapping
 * @returns {string} Default IVA rate as string
 */
export const getDefaultIVARate = (customerDetails, activeCompanyDetails, rateToTemplateMap) => {

  // Priority: Customer default > Company default > Template mapping > Fallback to 21.00
  let defaultRate = customerDetails?.custom_default_iva_ventas ||
                   activeCompanyDetails?.custom_default_iva_ventas

  if (defaultRate) {
    // If we have a direct rate, try to extract the numeric portion and return a normalized string (e.g. '21.00')
    console.log('🎯 IVA - Using direct rate (raw):', defaultRate)

    // If it's already a number, just format
    if (typeof defaultRate === 'number') {
      return defaultRate.toFixed(2)
    }

    // If it's a string like '21% IVA (Ventas) - DELP' or '21', extract the first numeric token
    if (typeof defaultRate === 'string') {
      const m = defaultRate.match(/(\d+(?:[\.,]\d+)?)/)
      if (m) {
        const num = parseFloat(m[1].replace(',', '.'))
        if (!isNaN(num)) return num.toFixed(2)
      }
      // If no numeric part found, return the raw string as fallback
      return defaultRate.toString()
    }
  }

  // If no direct rate, try to find the template for the default rate
  if (rateToTemplateMap && rateToTemplateMap['21.00']) {
    const templateName = rateToTemplateMap['21.00']
    console.log('🎯 IVA - Found template for 21.00:', templateName)
    return '21.00'
  }

  // Fallback to 21.00
  return '21.00'
}

/**
 * Helper function to get the appropriate metodo_numeracion from talonario based on document type
 * @param {Object} talonario - Talonario object with different numeracion methods
 * @param {string} invoiceType - Type of invoice/document (Factura, Nota de Crédito, Nota de Débito, Ticket)
 * @returns {string} Appropriate metodo_numeracion
 */
export const getMetodoNumeracionFromTalonario = (talonario, invoiceType) => {
  if (!talonario) return ''
  
  const type = (invoiceType || '').toLowerCase()
  const isCreditNote = type.includes('crédito') || type.includes('credito')
  const isDebitNote = type.includes('débito') || type.includes('debito')
  const isTicket = type.includes('ticket')
  
  if (isCreditNote) {
    return talonario.metodo_numeracion_nota_credito || talonario.metodo_numeracion_factura_venta || ''
  } else if (isDebitNote) {
    return talonario.metodo_numeracion_nota_debito || talonario.metodo_numeracion_factura_venta || ''
  } else if (isTicket) {
    return talonario.metodo_numeracion_ticket || talonario.metodo_numeracion_factura_venta || ''
  } else {
    return talonario.metodo_numeracion_factura_venta || ''
  }
}

export const normalizePurchaseInvoiceItemPricing = (item) => {
  const qty = parseFloat(item.qty) || 0
  const netRate = parseFloat(item.rate ?? item.base_rate) || 0
  const providedDiscountAmount = parseFloat(item.discount_amount)
  const rawDiscountPercent = parseFloat(item.discount_percentage ?? item.discount_percent ?? 0)
  const discountPercentFromServer = Number.isFinite(rawDiscountPercent) ? rawDiscountPercent : 0
  const priceListRate = parseFloat(
    item.price_list_rate ??
    item.base_price_list_rate ??
    item.last_purchase_rate
  ) || 0

  let baseRate = priceListRate
  const tolerance = 0.01

  if (!baseRate && netRate > 0) {
    if (Number.isFinite(providedDiscountAmount) && providedDiscountAmount > 0 && qty > 0) {
      baseRate = netRate + (providedDiscountAmount / qty)
    } else if (discountPercentFromServer > 0 && discountPercentFromServer < 100) {
      const factor = 1 - (discountPercentFromServer / 100)
      baseRate = factor > 0 ? netRate / factor : netRate
    } else {
      baseRate = netRate
    }
  }

  if (baseRate <= 0) {
    baseRate = netRate
  }

  const perUnitDiff = baseRate - netRate
  let discountAmount = qty > 0 ? perUnitDiff * qty : 0
  if (Number.isFinite(providedDiscountAmount) && providedDiscountAmount > 0) {
    const expected = perUnitDiff * qty
    if (Math.abs(providedDiscountAmount - expected) <= tolerance * Math.max(1, expected)) {
      discountAmount = providedDiscountAmount
    } else if (qty > 0 && Math.abs(providedDiscountAmount - perUnitDiff) <= tolerance) {
      discountAmount = providedDiscountAmount * qty
    } else {
      discountAmount = providedDiscountAmount
    }
  }

  const finalDiscountPercent = baseRate > 0 && qty > 0
    ? ((baseRate - netRate) / baseRate) * 100
    : discountPercentFromServer

  return {
    baseRate,
    netRate,
    discountAmount,
    discountPercent: finalDiscountPercent
  }
}
