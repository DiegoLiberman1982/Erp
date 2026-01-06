export const stripAbbr = (code) => {
  if (!code) return code
  const idx = code.lastIndexOf(' - ')
  return idx === -1 ? code : code.substring(0, idx)
}

export const addAbbr = (code) => {
  if (!code) return code
  return code
}

export const normalizePriceInput = (value, options = {}) => {
  const { decimalSeparator = 'auto' } = options
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : ''
  }

  if (value === undefined || value === null) {
    return ''
  }

  const raw = typeof value === 'string' ? value.trim() : String(value).trim()
  if (!raw) return ''

  // Remove currency symbols/letters/spaces, keep only digits and separators
  let cleaned = raw
    .replace(/[$€£¥%]/gi, '')
    .replace(/[A-Za-z]/g, '')
    .replace(/[\s\u00A0_]/g, '')
    .replace(/[^0-9.,-]/g, '')

  const isNegative = cleaned.startsWith('-')
  cleaned = cleaned.replace(/-/g, '')

  if (!cleaned || !/\d/.test(cleaned)) {
    return ''
  }

  const lastDotIndex = cleaned.lastIndexOf('.')
  const lastCommaIndex = cleaned.lastIndexOf(',')
  let decimalSeparatorChar = null

  if (decimalSeparator === 'dot') {
    decimalSeparatorChar = '.'
  } else if (decimalSeparator === 'comma') {
    decimalSeparatorChar = ','
  } else if (lastDotIndex !== -1 && lastCommaIndex !== -1) {
    decimalSeparatorChar = lastDotIndex > lastCommaIndex ? '.' : ','
  } else if (lastDotIndex !== -1) {
    decimalSeparatorChar = '.'
  } else if (lastCommaIndex !== -1) {
    decimalSeparatorChar = ','
  }

  let integerPart = cleaned
  let decimalPart = ''

  if (decimalSeparatorChar && cleaned.includes(decimalSeparatorChar)) {
    const splitIndex = decimalSeparatorChar === '.' ? lastDotIndex : lastCommaIndex
    integerPart = cleaned.slice(0, splitIndex)
    decimalPart = cleaned.slice(splitIndex + 1)
  }

  integerPart = integerPart.replace(/[.,]/g, '')
  decimalPart = decimalPart.replace(/[.,]/g, '')

  if (!integerPart) {
    integerPart = '0'
  }

  const normalizedInt = integerPart.replace(/^0+(?=\d)/, '') || '0'

  if (decimalPart) {
    const decimals = decimalPart.slice(0, 4).replace(/0+$/, '') || decimalPart.slice(0, 2)
    const normalizedDecimals = decimals || '0'
    return `${isNegative ? '-' : ''}${normalizedInt}.${normalizedDecimals}`
  }

  return `${isNegative ? '-' : ''}${normalizedInt}`
}

export const toNumberValue = (value) => {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') return value
  const parsed = parseFloat(String(value))
  return Number.isNaN(parsed) ? 0 : parsed
}

export const normalizeSku = (value) => {
  if (!value) return ''
  return value.toString().trim().replace(/\s+/g, '').toUpperCase()
}

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
