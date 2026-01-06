import afipCodes from '../../../shared/afip_codes.json'

const aliasMap = (() => {
  const raw = afipCodes.alias_to_tipo || {}
  const normalizedEntries = {}
  const register = (key, value) => {
    const normalizedKey = normalizeValue(key)
    if (normalizedKey && value) {
      normalizedEntries[normalizedKey] = String(value || '').toUpperCase()
    }
  }
  Object.entries(raw).forEach(([key, value]) => register(key, value))
  ;(afipCodes.tipos_comprobante || []).forEach(entry => {
    if (entry?.descripcion && entry?.tipo) {
      register(entry.descripcion, entry.tipo)
    }
  })
  return normalizedEntries
})()

const tipoDescripcionMap = (() => {
  const map = {}
  ;(afipCodes.tipos_comprobante || []).forEach(entry => {
    if (entry?.tipo) {
      map[entry.tipo] = entry.descripcion || entry.tipo
    }
  })
  return map
})()

const knownTipos = new Set(
  (afipCodes.tipos_comprobante || [])
    .map(entry => (entry?.tipo ? String(entry.tipo).toUpperCase() : null))
    .filter(Boolean)
)

const CREDIT_NOTE_TYPES = new Set(['NCC', 'NCE', 'TNC'])
const DEBIT_NOTE_TYPES = new Set(['NDB', 'NDE', 'TND'])

const siglasConfig = (afipCodes.naming_conventions && afipCodes.naming_conventions.siglas) || {}
const prefixConfig = (afipCodes.naming_conventions && afipCodes.naming_conventions.prefixes) || {}

const fallbacks = {
  payment: 'PAG',
  journal: 'AS'
}

const siglaReverseMap = (() => {
  const reverse = {}
  const add = (sigla, info) => {
    if (!sigla) return
    const key = sigla.toString().toUpperCase()
    if (!reverse[key]) {
      reverse[key] = { tipos: new Set([info.tipo]), scopes: new Set([info.scope]) }
      return
    }
    reverse[key].scopes.add(info.scope)
    reverse[key].tipos.add(info.tipo)
  }

  Object.entries(siglasConfig || {}).forEach(([tipo, entry]) => {
    if (!entry) return
    if (entry.venta) add(entry.venta, { tipo, scope: 'venta' })
    if (entry.compra) add(entry.compra, { tipo, scope: 'compra' })
  })

  return reverse
})()

const prefixScopeMap = (() => {
  const map = {}
  const add = (prefix, scope) => {
    if (!prefix) return
    const key = prefix.toString().toUpperCase()
    map[key] = scope
  }

  const ventas = prefixConfig.ventas || {}
  const compras = prefixConfig.compras || {}
  const pagos = prefixConfig.pagos || {}
  const ordenes = prefixConfig.ordenes || {}

  add(ventas.electronico, 'venta')
  add(ventas.manual, 'venta')
  add(compras.default, 'compra')

  if (pagos.ventas) {
    add(pagos.ventas.electronico, 'venta')
    add(pagos.ventas.manual, 'venta')
  }
  if (pagos.compras) {
    add(pagos.compras.default, 'compra')
  }

  add(ordenes.compra, 'compra')
  add(ordenes.venta, 'venta')
  add(ordenes.presupuesto_venta, 'venta')

  return map
})()

function normalizeValue(value) {
  if (!value) return ''
  const normalized = value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
  return normalized.replace(/[\u0300-\u036f]/g, '')
}

export function getAfipTipoFromLabel(label) {
  if (!label) return null
  const normalized = normalizeValue(label)
  if (normalized in aliasMap) {
    return aliasMap[normalized]
  }

  const upper = label.toString().toUpperCase()
  const siglaInfo = siglaReverseMap[upper]
  if (siglaInfo) {
    const tipos = Array.from(siglaInfo.tipos || [])
    if (tipos.length === 1) {
      return String(tipos[0] || '').toUpperCase()
    }
    return null
  }

  if (upper.length === 3 && knownTipos.has(upper)) {
    return upper
  }

  if (upper.includes('-')) {
    const parts = upper.split('-')
    if (parts.length >= 2) {
      const candidate = parts[1]
      if (knownTipos.has(candidate)) {
        return candidate
      }
    }
  }

  return null
}

export function getAfipDescriptionFromTipo(tipo) {
  if (!tipo) return null
  return tipoDescripcionMap[tipo] || null
}

export function isCreditNoteLabel(label) {
  const tipo = getAfipTipoFromLabel(label)
  if (!tipo) return false
  return CREDIT_NOTE_TYPES.has(tipo)
}

export function isDebitNoteLabel(label) {
  const tipo = getAfipTipoFromLabel(label)
  if (!tipo) return false
  return DEBIT_NOTE_TYPES.has(tipo)
}

export function mapVoucherTypeToSigla(label, { scope = 'ventas' } = {}) {
  if (!label) return label
  const normalizedScope = scope === 'compra' || scope === 'purchase' ? 'compra' : 'venta'
  const tipo = getAfipTipoFromLabel(label)

  if (!tipo) {
    const normalized = normalizeValue(label)
    if (normalized.includes('payment') || normalized.includes('pago')) {
      return fallbacks.payment
    }
    if (normalized.includes('journal') || normalized.includes('asiento')) {
      return fallbacks.journal
    }
    return label
  }

  const scopeKey = normalizedScope === 'compra' ? 'compra' : 'venta'
  const configEntry = siglasConfig[tipo]
  if (configEntry && configEntry[scopeKey]) {
    return configEntry[scopeKey]
  }

  const base = tipo.startsWith('FAC') || tipo.startsWith('FCE') ? 'FC'
    : tipo.startsWith('NC') ? 'NC'
    : tipo.startsWith('ND') ? 'ND'
    : tipo
  const suffix = scopeKey === 'venta' ? 'V' : 'C'
  return `${base}${suffix}`
}

export function getSalesNamingPrefix(isElectronic = true) {
  const ventas = prefixConfig.ventas || {}
  return ventas[isElectronic ? 'electronico' : 'manual'] || (isElectronic ? 'VE' : 'VM')
}

export function getPurchaseNamingPrefix() {
  const compras = prefixConfig.compras || {}
  return compras.default || 'CC'
}

export function getPaymentNamingPrefix({ isSales = true, isElectronic = true } = {}) {
  const pagos = prefixConfig.pagos || {}
  if (isSales) {
    const ventas = pagos.ventas || {}
    return ventas[isElectronic ? 'electronico' : 'manual'] || getSalesNamingPrefix(isElectronic)
  }
  const compras = pagos.compras || {}
  return compras.default || getPurchaseNamingPrefix()
}

export function parseAfipComprobanteName(value) {
  if (!value) return { scope: null, tipo: null, sigla: null, prefix: null }

  const raw = value.toString().trim()
  const parts = raw
    .toUpperCase()
    .split('-')
    .map(p => p.trim())
    .filter(Boolean)

  if (parts.length === 0) return { scope: null, tipo: null, sigla: null, prefix: null }

  const prefix = parts[0] || null
  const scopeFromPrefix = prefix && prefixScopeMap[prefix] ? prefixScopeMap[prefix] : null

  let sigla = null
  let tipo = null
  let scopeFromSigla = null

  for (const part of parts) {
    const entry = siglaReverseMap[part]
    if (!entry) continue
    sigla = part
    tipo = entry.tipo || null
    if (entry.scopes && entry.scopes.size === 1) {
      scopeFromSigla = Array.from(entry.scopes)[0]
    }
    break
  }

  if (!tipo) {
    tipo = getAfipTipoFromLabel(raw)
  }

  return {
    scope: scopeFromSigla || scopeFromPrefix || null,
    tipo: tipo || null,
    sigla,
    prefix
  }
}
