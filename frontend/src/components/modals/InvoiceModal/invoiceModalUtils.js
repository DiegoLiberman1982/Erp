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
    console.log('--- IVA: using direct rate')

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
    console.log('--- IVA: template found for 21.00')
    return '21.00'
  }

  // Fallback to 21.00
  return '21.00'
}

/**
 * Helper function to get the appropriate metodo_numeracion from talonario based on document type
 * @param {Object} talonario - Talonario object with different numeracion methods
 * @param {string} invoiceType - Type of invoice/document
 * @returns {string} Appropriate metodo_numeracion
 */
export const getMetodoNumeracionFromTalonario = (talonario, invoiceType) => {
  if (!talonario) return ''
  
  const isCreditNote = invoiceType && (invoiceType.toLowerCase().includes('crédito') || invoiceType.toLowerCase().includes('credito'))
  const isDebitNote = invoiceType && (invoiceType.toLowerCase().includes('débito') || invoiceType.toLowerCase().includes('debito'))
  
  if (isCreditNote) {
    return talonario.metodo_numeracion_nota_credito || talonario.metodo_numeracion_factura_venta || ''
  } else if (isDebitNote) {
    return talonario.metodo_numeracion_nota_debito || talonario.metodo_numeracion_factura_venta || ''
  } else {
    return talonario.metodo_numeracion_factura_venta || ''
  }
}

export const parseMetodoNumeracionAfip = (rawMetodo) => {
  if (!rawMetodo || typeof rawMetodo !== 'string') return null

  const trimmed = rawMetodo.trim()
  if (!trimmed) return null

  const metodo = trimmed.startsWith('DRAFT-') ? trimmed.slice('DRAFT-'.length) : trimmed
  const parts = metodo.split('-').filter(Boolean)

  // Expected: FE-FAC-A-00004-00000001 (or FM-NDC-A-00004-00000001, etc.)
  if (parts.length < 5) return null

  const [prefix, tipo, letra, puntoDeVentaRaw, numeroRaw] = parts.slice(-5)
  const puntoDeVenta = String(puntoDeVentaRaw || '').padStart(5, '0')
  const numero = String(numeroRaw || '').padStart(8, '0')

  if (!prefix || !tipo || !letra) return null
  if (!/^\d{5}$/.test(puntoDeVenta)) return null
  if (!/^\d{8}$/.test(numero)) return null

  return {
    prefix,
    tipo,
    letra,
    puntoDeVenta,
    numero
  }
}

/**
 * Normalizes text for search purposes: converts to lowercase and removes accents
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
export const normalizeText = (text) => {
  if (!text) return ''
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s]/g, ' ') // Replace special chars with spaces
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim()
}
