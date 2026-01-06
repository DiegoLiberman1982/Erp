const asString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback
  return typeof value === 'number' ? value.toString() : `${value}`
}

const asNumberString = (value, fallback = '0.00') => {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = typeof value === 'number' ? value : parseFloat(value)
  if (Number.isNaN(numeric)) return fallback
  return numeric.toString()
}

const asPositiveNumberString = (value, fallback = '0.00') => {
  const raw = asNumberString(value, fallback)
  const numeric = parseFloat(raw)
  if (Number.isNaN(numeric)) return raw
  const positive = Math.abs(numeric)
  return Number.isInteger(positive) ? positive.toString() : positive.toString()
}

const mapPurchaseInvoiceItem = (item = {}) => ({
  item_code: item.item_code || '',
  item_name: item.item_name || item.item_code || '',
  description: item.description || item.item_name || '',
  qty: asNumberString(item.qty, '1'),
  rate: asNumberString(item.rate ?? item.base_rate ?? item.price_list_rate ?? 0),
  discount_percent: asNumberString(item.discount_percent ?? item.discount_percentage ?? 0, '0'),
  iva_percent: asNumberString(item.iva_percent ?? item.rate_iva ?? 21, '21'),
  amount: asNumberString(item.amount ?? item.base_amount ?? 0),
  warehouse: item.warehouse || '',
  cost_center: item.cost_center || '',
  uom: item.uom || item.stock_uom || 'Unidad',
  account: item.account || item.expense_account || '',
  expense_account: item.expense_account || '',
  valuation_rate: asNumberString(item.valuation_rate ?? item.rate ?? 0),
  // Campos de vinculación con órdenes de compra
  purchase_order: item.purchase_order || '',
  purchase_order_item: item.purchase_order_item || item.po_detail || '',
  po_detail: item.po_detail || item.purchase_order_item || '',
  // Campos de vinculación con remitos de compra
  purchase_receipt: item.purchase_receipt || '',
  pr_detail: item.pr_detail || item.purchase_receipt_item || '',
  purchase_receipt_item: item.purchase_receipt_item || item.pr_detail || ''
})

const mapSalesInvoiceItem = (item = {}, options = {}) => {
  const numberMapper = options.forcePositive ? asPositiveNumberString : asNumberString
  const sales_order = item.sales_order || item.against_sales_order || ''
  const so_detail = item.so_detail || item.sales_order_item || ''
  return {
    item_code: item.item_code || '',
    item_name: item.item_name || item.item_code || '',
    description: item.description || item.item_name || '',
    qty: numberMapper(item.qty, '1'),
    rate: numberMapper(item.rate ?? item.base_rate ?? item.net_rate ?? 0),
    discount_percent: numberMapper(item.discount_percent ?? item.discount_percentage ?? 0, '0'),
    iva_percent: asNumberString(item.iva_percent ?? item.rate_iva ?? 21, '21'),
    amount: numberMapper(item.amount ?? item.base_amount ?? 0),
    warehouse: item.warehouse || '',
    cost_center: item.cost_center || '',
    uom: item.uom || item.stock_uom || 'Unidad',
    account: item.income_account || '',
    income_account: item.income_account || '',
    delivery_note: item.delivery_note || item.against_delivery_note || item.parent || '',
    dn_detail: item.dn_detail || item.delivery_note_item || item.detail || '',
    sales_order,
    so_detail,
    sales_order_item: item.sales_order_item || item.so_detail || '',
    __source_sales_order: sales_order,
    __source_so_detail: so_detail
  }
}

export const buildPurchaseInvoicePatchFromDocument = (document = {}) => ({
  posting_date: document.posting_date || '',
  supplier: document.supplier || '',
  company: document.company || '',
  currency: document.currency || '',
  price_list: document.buying_price_list || document.price_list || '',
  taxes: document.taxes || [],
  items: (document.items || []).map(mapPurchaseInvoiceItem)
})

export const buildSalesInvoicePatchFromDocument = (document = {}) => {
  const forcePositive = Boolean(
    document.is_return ||
    (typeof document.name === 'string' && document.name.includes('NDC'))
  )
  return {
    posting_date: document.posting_date || '',
    customer: document.customer || '',
    company: document.company || '',
    currency: document.currency || '',
    price_list: document.selling_price_list || document.price_list || '',
    taxes: document.taxes || [],
    items: (document.items || []).map(item =>
      mapSalesInvoiceItem(item, { forcePositive })
    )
  }
}

const mapSalesOrderItem = (item = {}) => ({
  item_code: item.item_code || '',
  item_name: item.item_name || item.item_code || '',
  description: item.description || item.item_name || '',
  qty: asNumberString(item.qty, '1'),
  uom: item.uom || item.stock_uom || 'Unit',
  rate: asNumberString(item.rate ?? item.base_rate ?? item.price_list_rate ?? 0),
  discount_amount: asNumberString((item.discount_amount ?? item.discount) || 0, '0'),
  iva_percent: asNumberString(item.iva_percent ?? item.rate_iva ?? 21, '21'),
  amount: asNumberString(item.amount ?? item.base_amount ?? 0),
  warehouse: item.warehouse || '',
  schedule_date: item.schedule_date || item.delivery_date || '',
  income_account: item.income_account || '',
  cost_center: item.cost_center || '',
  valuation_rate: asNumberString(item.valuation_rate ?? item.rate ?? 0),
  item_defaults: item.item_defaults || [],
  item_tax_template: item.item_tax_template || '',
  item_tax_rate: item.item_tax_rate || '',
  sales_order: item.sales_order || '',
  so_detail: item.so_detail || item.sales_order_item || '',
  quotation: item.prevdoc_docname || item.quotation || '',
  quotation_item: item.prevdoc_detail_docname || item.quotation_item || ''
})

const mapDeliveryNoteItem = (item = {}) => ({
  item_code: item.item_code || '',
  description: item.description || item.item_name || '',
  qty: parseFloat(item.qty != null ? item.qty : 1) || 1,
  uom: item.uom || item.stock_uom || 'Unit',
  propiedad: item.propiedad || item.custom_propiedad || 'Propio',
  warehouse: item.warehouse || '',
  warehouse_group: null,
  dn_detail: item.dn_detail || item.delivery_note_item || item.name || ''
})

export const buildSalesOrderPatchFromDocument = (document = {}) => ({
  transaction_date: document.transaction_date || document.posting_date || '',
  receiving_date: document.receiving_date || document.delivery_date || document.posting_date || '',
  customer: document.customer || '',
  company: document.company || '',
  price_list: document.selling_price_list || document.price_list || '',
  currency: document.currency || '',
  items: (document.items || []).map(mapSalesOrderItem)
})

export const buildDeliveryNotePatchFromDocument = (document = {}) => ({
  posting_date: document.posting_date || '',
  customer: document.customer || '',
  company: document.company || '',
  status: document.status || 'Por facturar',
  comprobante_type: document.comprobante_type || 'Remito',
  items: (document.items || []).map(mapDeliveryNoteItem)
})
