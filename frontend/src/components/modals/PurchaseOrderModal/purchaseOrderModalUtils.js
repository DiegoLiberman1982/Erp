const reverseStatusMap = {
  'Draft': 'Borrador',
  'On Hold': 'En espera',
  'To Receive and Bill': 'Para recibir y pagar',
  'To Bill': 'Por facturar',
  'To Receive': 'Recibir',
  'Completed': 'Completado',
  'Cancelled': 'Cancelado',
  'Closed': 'Cerrado',
  'Delivered': 'Enviado'
}

export const createInitialPurchaseOrderData = ({ supplier = '', company = '' }) => {
  const today = new Date().toISOString().split('T')[0]
  return {
    supplier,
    company,
    sales_condition_type: '',
    transaction_date: today,
    schedule_date: today,
    currency: '',
    status: 'Para recibir y pagar',
    price_list: '',
    notes: '',
    items: [
      {
        item_code: '',
        description: '',
        qty: 1,
        uom: 'Unit',
        rate: '',
        warehouse: '',
        schedule_date: today,
        iva_percent: '21.00',
        discount_percent: '0.00',
        discount_amount: '0.00',
        item_tax_template: '',
        amount: '0.00'
      }
    ]
  }
}

const normalizeRateData = (item) => {
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

export const normalizePurchaseOrderData = (poData) => {
  if (!poData) return createInitialPurchaseOrderData({})
  return {
    supplier: poData.supplier || '',
    company: poData.company || '',
    sales_condition_type: poData.sales_condition_type || '',
    transaction_date: poData.transaction_date || new Date().toISOString().split('T')[0],
    schedule_date: poData.schedule_date || poData.transaction_date || new Date().toISOString().split('T')[0],
    currency: poData.currency || '',
    status: reverseStatusMap[poData.status] || poData.status || 'Para recibir y pagar',
    price_list: poData.buying_price_list || '',
    notes: poData.remarks || '',
    items: Array.isArray(poData.items) && poData.items.length
      ? poData.items.map(item => {
          const qty = parseFloat(item.qty) || 0
          const { baseRate, netRate, discountAmount, discountPercent } = normalizeRateData(item)
          const ivaPercent = parseFloat(item.iva_percent ?? item.tax_rate) || 21
          const taxable = Math.max(0, qty * netRate)
          const ivaAmount = taxable * (ivaPercent / 100)
          const amount = taxable + ivaAmount

          return {
            item_code: item.item_code || '',
            description: item.description || '',
            qty: item.qty || 1,
            uom: item.uom || 'Unit',
            rate: baseRate ? baseRate.toFixed(2) : '',
            net_rate_value: netRate ? netRate.toFixed(2) : '',
            warehouse: item.warehouse || '',
            schedule_date: item.schedule_date || poData.schedule_date,
            iva_percent: parseFloat(ivaPercent).toFixed(2),
            discount_percent: Number(discountPercent || 0).toFixed(2),
            discount_amount: discountAmount.toFixed(2),
            item_tax_template: item.item_tax_template || '',
            conversion_factor: item.conversion_factor || 1,
            amount: amount.toFixed(2)
          }
        })
      : [{
          item_code: '',
          description: '',
          qty: 1,
          uom: 'Unit',
          rate: '',
          warehouse: '',
          schedule_date: poData.schedule_date || new Date().toISOString().split('T')[0],
          iva_percent: '21.00',
          discount_percent: '0.00',
          discount_amount: '0.00',
          item_tax_template: '',
          amount: '0.00'
        }]
  }
}
