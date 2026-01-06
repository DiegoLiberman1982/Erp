// --- UTILIDADES PARA EL MODAL DE REMITOS DE VENTA ---

// Normaliza datos provenientes de ERP para prellenar el formulario
export const normalizeSalesRemitoData = (erpData) => {
  let punto = erpData.punto_de_venta || ''
  let remitoNumber = erpData.remito_number || ''
  if ((!punto || !remitoNumber) && erpData.name) {
    const parts = erpData.name.split('-')
    if (parts.length >= 2) {
      const maybePoint = parts[parts.length - 2]
      const maybeNumber = parts[parts.length - 1]
      if (!punto) punto = maybePoint
      if (!remitoNumber) remitoNumber = maybeNumber
    }
  }
  const remitoNumberClean = String(remitoNumber || '').replace(/[^0-9]/g, '')
  const remitoNumberTrimmed = remitoNumberClean.slice(0, 8) || ''

  return {
    posting_date: erpData.posting_date || '',
    comprobante_type: erpData.comprobante_type || 'Remito',
    punto_de_venta: punto || '',
    remito_number: remitoNumberTrimmed,
    customer: erpData.customer || '',
    title: erpData.title || '',
    return_against: erpData.return_against || '',
    talonario_name: erpData.talonario_name || '',
    remito_letter: erpData.remito_letter || 'R',
    docstatus: erpData.docstatus ?? 0,
    // Normalize ERP status. Prefer the explicit status returned by ERP; fallback:
    // - docstatus === 1 -> 'Completado'
    // - otherwise 'Borrador'
    status: erpData.status || (erpData.docstatus === 1 ? 'Completado' : 'Borrador'),
    items: Array.isArray(erpData.items)
      ? erpData.items.map(item => ({
          item_code: item.item_code || '',
          description: item.description || '',
          qty: Math.abs(item.qty || 1),
          uom: item.uom || 'Unit',
          propiedad: item.propiedad || 'Propio',
          warehouse: item.warehouse || '',
          // Linking para devoluciones (contra el remito original)
          dn_detail: item.dn_detail || item.delivery_note_item || item.name || ''
        }))
      : []
  }
}

// Crea la estructura inicial del formulario
export const createInitialSalesFormData = () => ({
  posting_date: new Date().toISOString().split('T')[0],
  comprobante_type: 'Remito',
  punto_de_venta: '',
  remito_number: '',
  docstatus: 0,
  customer: '',
  title: '',
  return_against: '',
  talonario_name: '',
  remito_letter: 'R',
  // Default for new sales remitos should be 'Por facturar' (ERPNext-accepted)
  status: 'Por facturar',
  items: [
    {
      item_code: '',
      description: '',
      qty: 1,
      uom: 'Unit',
      propiedad: 'Propio',
      warehouse: ''
    }
  ]
})

export const getRemitoTypeSigla = (comprobanteType) => {
  if (!comprobanteType) return 'REM'
  const normalized = comprobanteType.trim().toLowerCase()
  if (normalized.includes('devol')) return 'DEV'
  if (normalized.includes('consig')) return 'CON'
  if (normalized.includes('servicio')) return 'SRV'
  return comprobanteType
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase() || 'REM'
}
