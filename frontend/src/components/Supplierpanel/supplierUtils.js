// supplierUtils.js - Utilidades para el panel de proveedores
import { mapVoucherTypeToSigla as mapVoucherSigla, getAfipTipoFromLabel, isCreditNoteLabel, isDebitNoteLabel } from '../../utils/comprobantes'

/**
 * Formatea un balance como moneda argentina
 * @param {number} balance - El balance a formatear
 * @returns {string} Balance formateado
 */
export const formatBalance = (balance) => {
  if (balance === null || balance === undefined || balance === 0) return '$0,00'
  return `$${balance.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Formatea un monto mostrando el código de moneda al frente.
 * @param {number|string} balance - Monto a formatear
 * @param {string} currencyCode - Código de moneda 
 * @returns {string} Ej: "USD 3.630,00"
 */
export const formatCurrencyValue = (balance, currencyCode = '') => {
  const numeric = Number(balance)
  const amount = Number.isFinite(numeric) ? numeric : 0
  const formatted = amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const label = (currencyCode || '').toString().trim().toUpperCase()
  return `${label} ${formatted}`
}

/**
 * Formatea el número de comprobante según el nuevo formato
 * @param {string} voucherNo - Número de comprobante
 * @returns {string} Número formateado
 */
export const formatVoucherNumber = (voucherNo) => {
  if (!voucherNo) return voucherNo
  // Ejemplo: "FE-FAC-A-00003-00000001" -> "A 00003 00000001"
  const parts = voucherNo.split('-')
  if (parts.length >= 5) {
    const letra = parts[2] // A
    const numero1 = parts[3] // 00003
    const numero2 = parts[4].substring(0, 8) // 00000001 (solo primeros 8 dígitos)
    return `${letra} ${numero1} ${numero2}`
  }
  return voucherNo // Si no tiene el formato esperado, devolver original
}

/**
 * Mapea tipos de comprobante a siglas
 * @param {string} voucherType - Tipo de comprobante
 * @returns {string} Sigla correspondiente
 */
export const mapVoucherTypeToSigla = (voucherType, options = {}) =>
  mapVoucherSigla(voucherType, { scope: 'compra', ...options })

/**
 * Trunca descripción a máximo de caracteres
 * @param {string} description - Descripción a truncar
 * @param {number} maxLength - Longitud máxima (default 24)
 * @returns {string} Descripción truncada
 */
export const truncateDescription = (description, maxLength = 24) => {
  if (!description) return description
  if (description.length <= maxLength) return description
  return description.substring(0, maxLength) + '...'
}

/**
 * Detecta si es un tipo de voucher de factura
 * @param {string} voucherType - Tipo de voucher
 * @returns {boolean} True si es factura
 */
export const isInvoiceVoucherType = (voucherType) => {
  if (!voucherType) return false
  const tipo = getAfipTipoFromLabel(voucherType)
  if (!tipo) return false
  return tipo === 'FAC' || tipo === 'FCE'
}

/**
 * Detecta si es un tipo de voucher de pago
 * @param {string} voucherType - Tipo de voucher
 * @returns {boolean} True si es pago
 */
export const isPaymentVoucherType = (voucherType) => {
  if (!voucherType) return false
  return /payment|pago|receipt|payment entry/i.test(voucherType)
}

/**
 * Detecta si es un tipo de voucher de crédito
 * @param {string} voucherType - Tipo de voucher
 * @returns {boolean} True si es crédito
 */
export const isCreditVoucherType = (voucherType) => {
  if (!voucherType) return false
  return isCreditNoteLabel(voucherType)
}

/**
 * Detecta si es un tipo de voucher de débito
 * @param {string} voucherType - Tipo de voucher
 * @returns {boolean} True si es débito
 */
export const isDebitVoucherType = (voucherType) => {
  if (!voucherType) return false
  return isDebitNoteLabel(voucherType)
}

/**
 * Formatea una fecha de YYYY-MM-DD a DD-MM-YYYY
 * @param {string} dateString - Fecha en formato YYYY-MM-DD
 * @returns {string} Fecha formateada
 */
export const formatDate = (dateString) => {
  if (!dateString) return 'No especificada'
  const [year, month, day] = dateString.split('-')
  return `${day}-${month}-${year}`
}

/**
 * Verifica si un valor tiene contenido válido
 * @param {*} value - Valor a verificar
 * @returns {boolean} True si tiene valor válido
 */
export const hasValue = (value) => {
  return value && value !== 'No especificado' && value !== 'No especificada' && value !== '';
}

/**
 * Retorna el tipo de ícono apropiado según si el campo tiene valor
 * @param {*} value - Valor del campo
 * @returns {string} 'check' o 'empty'
 */
export const getFieldIcon = (value) => {
  return hasValue(value) ? 'check' : 'empty'
}

/**
 * Extrae la descripción de una cuenta del nombre completo
 * @param {string} accountName - Nombre completo de la cuenta
 * @returns {string} Descripción de la cuenta
 */
export const extractAccountDescription = (accountName) => {
  if (!accountName) return 'No especificada'

  // Permitir que accountName sea un objeto con account_name o name
  const normalizedName = typeof accountName === 'string'
    ? accountName
    : accountName.account_name || accountName.name || ''

  if (!normalizedName || typeof normalizedName !== 'string') {
    return 'No especificada'
  }

  const parts = normalizedName.split(' - ')
  return parts.length >= 3 ? parts[1] : normalizedName
}
