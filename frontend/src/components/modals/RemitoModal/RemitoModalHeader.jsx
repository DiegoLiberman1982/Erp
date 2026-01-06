import React, { useEffect } from 'react'
// --- COMPONENTE PARA LA SECCI-N SUPERIOR DEL MODAL DE REMITOS ---
const RemitoModalHeader = ({
  formData,
  handleInputChange,
  supplierDetails,
  FormField,
  availableTalonarios,
  selectedPuntoVenta,
  setSelectedPuntoVenta,
  fetchWithAuth,
  propSupplierDetails,
  isEditing
}) => {
  useEffect(() => {
    console.log('- [RemitoModalHeader] Form data recibida:', {
      posting_date: formData.posting_date,
      punto_de_venta: formData.punto_de_venta,
      remito_number: formData.remito_number,
      supplier: formData.supplier,
      status: formData.status,
      isEditing
    })
  }, [formData, isEditing])

  // Generar t-tulo autom-tico si no hay t-tulo personalizado
  const generateAutoTitle = () => {
    const supplierName = propSupplierDetails?.supplier_name || formData.supplier || 'Proveedor'
    const date = formData.posting_date ? new Date(formData.posting_date).toLocaleDateString('es-AR') : ''
    const number = formData.remito_number || ''
    return `${supplierName} - ${date} - ${number}`.trim()
  }

  const displayTitle = formData.title || generateAutoTitle()

  const formatStatusLabel = (status) => {
    // Prefer to derive the label from the status value itself so option labels don't
    // get forced by the parent docstatus (which was causing duplicate labels).
    const lower = String(status || '').trim().toLowerCase()
    if (!lower) {
      // Fallback to docstatus-based label only when status value is empty
      const docstatus = Number(formData.docstatus)
      if (docstatus === 1) return 'Confirmado'
      if (docstatus === 2) return 'Cancelado'
      return '(sin estado)'
    }

    if (['completed', 'completado', 'submitted', 'confirmado', 'confirmada', 'confirmed'].includes(lower)) return 'Confirmado'
    if (['cancelado', 'anulado', 'cancelada', 'cancelled', 'canceled'].includes(lower)) return 'Cancelado'
    if (['draft', 'borrador'].includes(lower)) return 'Borrador'
    return status
  }

  const resolveStatusOptions = () => {
    // Creation: only allow 'Por facturar' or 'Devolución emitida'
    if (!isEditing) {
      return ['Por facturar', 'Devolución emitida']
    }

    // Editing: always show the three valid options (sin 'Confirmado')
    // El usuario puede cambiar entre Por facturar / Devolución emitida (cambia is_return)
    // o pasar a Cancelado (cambia docstatus a 2)
    return ['Por facturar', 'Devolución emitida', 'Cancelado']
  }

  const statusOptions = resolveStatusOptions()
  const displayRemitoNumber = String(formData.remito_number || '')
    .replace(/[^0-9]/g, '')
    .slice(0, 8)

  useEffect(() => {
    const label = formatStatusLabel ? formatStatusLabel(formData.status) : formData.status
    console.log('[RemitoModalHeader] remito_number raw -> display', formData.remito_number, '->', displayRemitoNumber)
    console.log('[RemitoModalHeader] docstatus/status/label', formData.docstatus, formData.status, label)
  }, [formData.remito_number, formData.docstatus, formData.status, displayRemitoNumber])

  return (


    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3 bg-white border border-gray-200 rounded-2xl p-4">
          {/* Fecha (2/12) */}
          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold text-gray-500 mb-1">Fecha</label>
            <input
              type="date"
              value={formData.posting_date || ''}
              onChange={(e) => handleInputChange('posting_date', e.target.value)}
              className="w-full h-8 text-xs px-2 border border-gray-300 rounded-md bg-white"
            />
          </div>

          {/* Comprobante (4/12) */}
          <div className="md:col-span-4">
            <label className="block text-[11px] font-bold text-gray-500 mb-1">Comprobante</label>
            <div className="grid grid-cols-12 gap-1">
              <select
                value={formData.comprobante_type || 'Remito'}
                onChange={(e) => handleInputChange('comprobante_type', e.target.value)}
                className="col-span-3 h-8 text-xs text-center font-semibold px-2 border border-gray-300 bg-white rounded-md"
              >
                <option value="Remito">Remito</option>
              </select>
              <input
                type="text"
                value={formData.punto_de_venta || ''}
                onChange={(e) => {
                  let value = e.target.value.replace(/[^0-9]/g, '') // Only allow numbers
                  if (value.length > 5) {
                    value = value.slice(0, 5)
                  }
                  handleInputChange('punto_de_venta', value)
                }}
                placeholder="XXXXX"
                className="col-span-3 h-8 text-xs text-center px-2 border border-gray-300 rounded-md"
              />
              <input
                type="text"
                value={displayRemitoNumber}
                onChange={(e) => {
                  let value = e.target.value.replace(/[^0-9]/g, '') // Only allow numbers
                  if (value.length > 8) {
                    value = value.slice(0, 8)
                  }
                  console.log('[RemitoModalHeader] onChange remito_number input ->', value)
                  handleInputChange('remito_number', value)
                }}
                placeholder="XXXXXXXX"
                className="col-span-6 h-8 text-xs px-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>

          {/* Proveedor shown in modal subtitle (removed inline input) */}

          {/* Estado (2/12) */}
          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold text-gray-500 mb-1">Estado</label>
            <select
              value={formData.status ?? ''}
            onChange={(e) => handleInputChange('status', e.target.value)}
            className="w-full h-8 text-xs px-2 border border-gray-300 rounded-md bg-white"
          >
            {statusOptions.map(status => (
              <option key={String(status)} value={status}>
                {formatStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>

          {/* T-tulo Remito - forzado a segunda l-nea */}
          <div className="md:col-span-12 md:col-start-1 md:row-start-2">
            <label className="block text-[11px] font-bold text-gray-500 mb-1">T-tulo Remito</label>
            <input
              type="text"
              value={displayTitle}
              onChange={(e) => handleInputChange('title', e.target.value)}
              placeholder={generateAutoTitle()}
              className="w-full h-8 text-xs px-2 border border-gray-300 rounded-md"
            />
          </div>
        </div>


  )
}

export default RemitoModalHeader

