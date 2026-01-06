// --- UTILIDADES GENERALES PARA EL MODAL DE REMITOS ---

// Formatear fecha para display
export const formatDate = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

// Validar que un item tenga todos los campos requeridos
export const validateItem = (item) => {
  const errors = []

  if (!item.item_code || item.item_code.trim() === '') {
    errors.push('Código del item es requerido')
  }

  if (!item.description || item.description.trim() === '') {
    errors.push('Descripción es requerida')
  }

  if (!item.qty || parseFloat(item.qty) <= 0) {
    errors.push('Cantidad debe ser mayor a 0')
  }

  if (!item.warehouse || item.warehouse.trim() === '') {
    errors.push('Almacén es requerido')
  }

  return errors
}

// Calcular totales del remito (solo para información, sin precios)
export const calculateTotals = (items) => {
  let totalItems = 0
  let totalQuantity = 0

  items.forEach(item => {
    totalItems += 1
    totalQuantity += parseFloat(item.qty) || 0
  })

  return {
    totalItems,
    totalQuantity: totalQuantity.toFixed(2)
  }
}

// Normalizar datos de ERP para edición
export const normalizeRemitoData = (erpData) => {
  // Try to extract punto_de_venta (middle) and remito_number (last) from name if missing
  let punto = erpData.punto_de_venta || ''
  let remNum = erpData.remito_number || ''
  if ((!punto || !remNum) && erpData.name) {
    const rawName = String(erpData.name)
    // Expected: CC-REM-R-02024-00005010 + optional internal suffix
    const match = rawName.match(/^[A-Z]{2,}-REM-R-(\d{5})-(\d+)$/)
    if (match) {
      const pdv = match[1]
      const digits = match[2]
      const visible = digits.length > 8 ? digits.slice(0, -5) : digits
      if (!punto) punto = pdv
      if (!remNum) remNum = visible
    }
  }
  const remNumClean = String(remNum || '').replace(/[^0-9]/g, '')
  const remNumTrimmed = remNumClean.slice(0, 8) || ''

  // Determinar estado basado en is_return y docstatus
  const isReturn = parseInt(erpData.is_return, 10) === 1
  const docstatus = erpData.docstatus ?? 0
  
  // Resolver el estado para el select
  let resolvedStatus = erpData.status || ''
  if (!resolvedStatus || resolvedStatus === 'To Bill' || resolvedStatus === 'Completed') {
    // Mapear según is_return
    if (docstatus === 2) {
      resolvedStatus = 'Cancelado'
    } else if (isReturn) {
      resolvedStatus = 'Devolución emitida'
    } else {
      resolvedStatus = 'Por facturar'
    }
  }

	    return {
	      posting_date: erpData.posting_date || '',
	      comprobante_type: erpData.comprobante_type || 'Remito',
	      punto_de_venta: punto || '',
	      remito_number: remNumTrimmed,
	      name: erpData.name || '',
	      supplier: erpData.supplier || '',
	      title: erpData.title || '',
	      return_against: erpData.return_against || '',
	      docstatus: docstatus,
	      is_return: isReturn ? 1 : 0,
	      status: resolvedStatus,
	      items: erpData.items ? erpData.items.map(item => ({
	        item_code: item.item_code || '',
	        item_name: item.item_name || item.item_code || '',
	        description: item.description || '',
	        // Mostrar cantidades positivas en el UI aunque ERPNext las guarde negativas para devoluciones
	        qty: Math.abs(item.qty || 0),  // Changed from || 1 to || 0 to preserve original qty
	        uom: item.uom || 'Unit',
	        propiedad: item.propiedad || 'Propio',
	        warehouse: item.warehouse || '',
	        purchase_order: item.purchase_order || item.po || '',
	        purchase_order_item: item.purchase_order_item || item.po_detail || item.purchase_order_item || '',
	        // Linking para devoluciones (contra el remito original)
	        pr_detail: item.pr_detail || item.purchase_receipt_item || item.name || ''
	      })) : []
	    }
	  }

// Crear estructura inicial del formulario
export const createInitialFormData = () => {
	  return {
	    posting_date: new Date().toISOString().split('T')[0],
	    comprobante_type: 'Remito',
	    punto_de_venta: '',
	    remito_number: '',
	    supplier: '',
	    title: '',
	    return_against: '',
	    // Default to 'Por facturar' for newly created supplier remitos as well
	    status: 'Por facturar',
	    items: [
	      {
	        item_code: '',
	        description: '',
        qty: 0,  // Changed from 1 to 0 for consistency
        uom: 'Unit',
        propiedad: 'Propio',
        warehouse: ''
      }
    ]
  }
}
