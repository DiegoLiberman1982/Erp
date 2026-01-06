// Helper functions to normalize decimal inputs coming from text fields

/**
 * Normalizes a raw string value so it only contains digits and a single decimal separator.
 * Supports both '.' and ',' as decimal separators and keeps trailing decimals if requested.
 *
 * @param {string|number} rawValue
 * @param {Object} [options]
 * @param {boolean} [options.keepTrailingDecimal=true] - Preserve trailing '.' if there are no decimals yet
 * @returns {string} Normalized value ready to be stored in state
 */
export const normalizeDecimalInput = (rawValue, { keepTrailingDecimal = true } = {}) => {
  if (rawValue == null) return ''

  const stringValue = rawValue.toString().trim()
  if (stringValue === '') return ''

  const cleaned = stringValue.replace(/[^\d.,-]/g, '')
  if (cleaned === '') return ''

  const unsigned = cleaned.replace(/-/g, '')
  const lastDot = unsigned.lastIndexOf('.')
  const lastComma = unsigned.lastIndexOf(',')
  const separatorIndex = Math.max(lastDot, lastComma)

  if (separatorIndex === -1) {
    const digitsOnly = unsigned.replace(/\D/g, '')
    return digitsOnly
  }

  const integerPartRaw = unsigned.slice(0, separatorIndex)
  const decimalPartRaw = unsigned.slice(separatorIndex + 1)
  const integerDigits = integerPartRaw.replace(/\D/g, '')
  const decimalDigits = decimalPartRaw.replace(/\D/g, '')

  if (decimalDigits.length === 0) {
    if (!keepTrailingDecimal) {
      return integerDigits
    }
    return (integerDigits || '0') + '.'
  }

  return `${integerDigits || '0'}.${decimalDigits}`
}

/**
 * Formats a raw value into a fixed precision decimal string.
 *
 * @param {string|number} rawValue
 * @param {number} [fractionDigits=2]
 * @returns {string} Formatted decimal value or empty string when invalid
 */
export const formatDecimalValue = (rawValue, fractionDigits = 2) => {
  const normalized = normalizeDecimalInput(rawValue, { keepTrailingDecimal: false })
  if (normalized === '') return ''

  const parsed = parseFloat(normalized)
  if (!Number.isFinite(parsed)) return ''

  return parsed.toFixed(fractionDigits)
}
