const normalizeText = (value = '') =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export const TEMPLATE_TYPES = {
  SALES: 'sales',
  PURCHASE: 'purchase'
}

export const templateMatchesType = (template, type = TEMPLATE_TYPES.SALES) => {
  if (!template) {
    return false
  }

  const combined = normalizeText(`${template.name || ''} ${template.title || ''}`)

  if (type === TEMPLATE_TYPES.PURCHASE) {
    return combined.includes('compras') || combined.includes('purchase') || combined.includes('credito')
  }

  return combined.includes('ventas') || combined.includes('sales') || combined.includes('debito')
}

export const getIvaRatesFromTemplates = (templates = []) => {
  const rates = new Set()
  templates.forEach(template => {
    ;(template.iva_rates || []).forEach(rateValue => {
      const numeric = Number(String(rateValue).replace(',', '.'))
      if (Number.isFinite(numeric)) {
        rates.add(Number(numeric.toFixed(4)))
      }
    })
  })
  return Array.from(rates).sort((a, b) => a - b)
}
