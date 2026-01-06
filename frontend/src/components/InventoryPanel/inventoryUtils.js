// inventoryUtils.js - Utilidades para el componente InventoryPanel
import { mapVoucherTypeToSigla as baseMapVoucherTypeToSigla } from '../../utils/comprobantes'

/**
 * Formatea un valor como moneda
 * @param {number} value - Valor a formatear
 * @returns {string} Valor formateado como moneda
 */
export const formatCurrency = (value, currency = '') => {
  const resolvedCurrency = String(currency || '').trim()
  const number = Number(value || 0)
  return new Intl.NumberFormat('es-AR', {
    ...(resolvedCurrency ? { style: 'currency', currency: resolvedCurrency } : {}),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(number) ? number : 0)
}

/**
 * Formatea un número con separadores de miles
 * @param {number} value - Valor a formatear
 * @returns {string} Número formateado
 */
export const formatNumber = (value) => {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0)
}

/**
 * Formatea una fecha para display
 * @param {string} dateString - Fecha en formato string
 * @returns {string} Fecha formateada
 */
export const formatDate = (dateString) => {
  if (!dateString) return 'N/A'
  const date = new Date(dateString)
  return date.toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

/**
 * Extrae el nombre display de una cuenta (remueve prefijos)
 * @param {string|Object} account - Nombre completo de la cuenta o objeto cuenta
 * @returns {string} Nombre display de la cuenta
 */
export const extractAccountName = (account) => {
  if (!account) return ''
  if (typeof account === 'string') {
    const match = account.match(/^\d+\.\d+\.\d+\.\d+\.\d+\s*-\s*(.+?)\s*-\s*\w+$/)
    return match ? match[1].trim() : account
  }
  const fullName = account.account_name || account.name || ''
  const match = fullName.match(/^\d+\.\d+\.\d+\.\d+\.\d+\s*-\s*(.+?)\s*-\s*\w+$/)
  return match ? match[1].trim() : fullName
}

/**
 * Extrae el nombre display de un grupo de items (remueve abreviatura de compañía)
 * @param {Object|string} itemGroup - Grupo de item (objeto o string)
 * @returns {string} Nombre display del grupo
 */
export const extractItemGroupName = (itemGroup) => {
  if (!itemGroup) return ''
  // If it's an object (from itemGroups array), extract the name
  if (typeof itemGroup === 'object') {
    const fullName = itemGroup.item_group_name || itemGroup.name || ''
    // Remove company abbr from the end: "Name - ABBR" -> "Name"
    const match = fullName.match(/^(.+?)\s*-\s*[A-Z]{2,}$/)
    return match ? match[1].trim() : fullName
  }
  // If it's a string (from itemDetails), apply the same logic
  const match = String(itemGroup).match(/^(.+?)\s*-\s*[A-Z]{2,}$/)
  return match ? match[1].trim() : itemGroup
}

/**
 * Extrae el código de item para display (oculta la sigla de compañía)
 * @param {string} itemCode - Código completo del item
 * @returns {string} Código display del item
 */
export const extractItemCodeDisplay = (itemCode) => {
  if (!itemCode) return ''
  // If code ends with ' - ABBR' or ' - ABC' (uppercase letters), strip that part for display
  const match = String(itemCode).match(/^(.+?)\s*-\s*[A-Z]{2,}$/)
  return match ? match[1].trim() : itemCode
}

/**
 * Mapea tipos de comprobante a siglas
 * @param {string} voucherType - Tipo de comprobante
 * @returns {string} Sigla del tipo de comprobante
 */
export const mapVoucherTypeToSigla = (voucherType, options = {}) => {
  if (!voucherType) return voucherType
  const typeMapping = {
    'Stock Entry': 'MOV',
    'Purchase Receipt': 'REM',
    'Delivery Note': 'REM'
  }
  if (typeMapping[voucherType]) {
    return typeMapping[voucherType]
  }
  const scope =
    typeof voucherType === 'string' && /purchase|compra/i.test(voucherType)
      ? 'compra'
      : (options.scope || 'ventas')
  return baseMapVoucherTypeToSigla(voucherType, { ...options, scope })
}

/**
 * Formatea el número de voucher para display
 * Números con sufijo interno de ERPNext se muestran sin los últimos 5 dígitos internos
 * Ejemplo: CC-REM-R-02025-0000000200001 -> CC-REM-R-02025-00000002
 * @param {string} voucherNo - Número de voucher completo
 * @returns {string} Número de voucher formateado para display
 */
export const formatVoucherNo = (voucherNo) => {
  if (!voucherNo) return '-'
  const str = String(voucherNo)
  const parts = str.split('-')
  if (parts.length < 2) return str

  const last = parts[parts.length - 1]
  // ERPNext suele anexar 5 dígitos "internos" al final del último segmento numérico.
  if (/^\d+$/.test(last) && last.length > 8) {
    parts[parts.length - 1] = last.slice(0, -5)
    return parts.join('-')
  }

  return str
}

/**
 * Obtiene ícono y colores de plataforma para enlaces
 * @param {string} platform - Nombre de la plataforma
 * @returns {Object} Objeto con estilos de la plataforma
 */
export const getPlatformStyle = (platform) => {
  const styles = {
    mercadolibre: {
      icon: '🛒',
      bg: 'from-yellow-400 to-orange-500',
      text: 'Mercado Libre',
      description: 'Compra y venta online'
    },
    amazon: {
      icon: '📦',
      bg: 'from-blue-500 to-blue-600',
      text: 'Amazon',
      description: 'Tienda global'
    },
    ebay: {
      icon: '💰',
      bg: 'from-red-500 to-red-600',
      text: 'eBay',
      description: 'Subastas y compras'
    },
    aliexpress: {
      icon: '🚚',
      bg: 'from-orange-500 to-red-500',
      text: 'AliExpress',
      description: 'Importaciones'
    },
    shopify: {
      icon: '🛍️',
      bg: 'from-green-500 to-green-600',
      text: 'Shopify',
      description: 'Tienda propia'
    },
    woocommerce: {
      icon: '🛒',
      bg: 'from-purple-500 to-purple-600',
      text: 'WooCommerce',
      description: 'E-commerce'
    },
    website: {
      icon: '🌐',
      bg: 'from-gray-500 to-gray-600',
      text: 'Sitio Web',
      description: 'Página web'
    },
    other: {
      icon: '🔗',
      bg: 'from-indigo-500 to-indigo-600',
      text: 'Otro',
      description: 'Enlace externo'
    }
  };
  return styles[platform] || styles.other;
}
