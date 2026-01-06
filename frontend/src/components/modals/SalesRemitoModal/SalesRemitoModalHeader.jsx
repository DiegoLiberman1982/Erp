import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

const SalesRemitoModalHeader = ({
  formData,
  handleInputChange,
  remitoTalonarioOptions = [],
  selectedTalonario,
  onTalonarioChange,
  remitoCodePreview = 'REM-REM-R-00000-00000000',
  isFetchingRemitoNumber = false,
  propCustomerDetails,
  isEditing
}) => {
  useEffect(() => {
    console.log('- [SalesRemitoModalHeader] Form data:', {
      posting_date: formData.posting_date,
      punto_de_venta: formData.punto_de_venta,
      remito_number: formData.remito_number,
      customer: formData.customer,
      status: formData.status,
      isEditing
    })
  }, [formData, isEditing])

  const generateAutoTitle = () => {
    const customerName = propCustomerDetails?.customer_name || formData.customer || 'Cliente'
    const date = formData.posting_date ? new Date(formData.posting_date).toLocaleDateString('es-AR') : ''
    const number = formData.remito_number || ''
    return `${customerName} - ${date} - ${number}`.trim()
  }

  const displayTitle = formData.title || generateAutoTitle()

  // ERPNext accepted states for Delivery Note (translated options):
  // "", "Borrador", "Por facturar", "Completado", "Devolución emitida", "Cancelado", "Cerrado"
  const formatStatusLabel = (status) => {
    const docstatus = Number(formData.docstatus)
    if (docstatus === 1) return 'Confirmado'
    if (docstatus === 2) return 'Cancelado'
    const lower = String(status || '').trim().toLowerCase()
    if (lower === 'completed' || lower === 'completado' || lower === 'submitted') return 'Confirmado'
    if (lower === 'draft' || lower === 'borrador') return 'Borrador'
    if (lower === '') return '(sin estado)'
    return status
  }

  const resolveStatusOptions = () => {
    // Creation: only allow 'Por facturar' (to be invoiced) or 'Devolución emitida' (a return)
    if (!isEditing) {
      return ['Por facturar', 'Devolución emitida']
    }

    // Editing: keep current value + allow cancelling
    const current = formData.status ?? ''
    if (String(current).trim().toLowerCase() === 'cancelado') return ['Cancelado']
    // Make sure current appears first, and add Cancelado as an option
    const items = []
    if (current !== '') items.push(current)
    items.push('Cancelado')
    return items
  }

	const statusOptions = resolveStatusOptions()
	const [isRemitoNumberFocused, setIsRemitoNumberFocused] = useState(false)
	const rawRemitoNumber = String(formData.remito_number || '').replace(/[^0-9]/g, '').slice(0, 8)
	const displayRemitoNumber = isRemitoNumberFocused
	  ? rawRemitoNumber
	  : rawRemitoNumber
	      ? rawRemitoNumber.padStart(8, '0')
	      : ''
	const currentStatusLabel = formatStatusLabel(formData.status)

  useEffect(() => {
    console.log('[SalesRemitoModalHeader] remito_number raw -> display', formData.remito_number, '->', displayRemitoNumber)
    console.log('[SalesRemitoModalHeader] docstatus/status/label', formData.docstatus, formData.status, currentStatusLabel)
  }, [formData.remito_number, formData.docstatus, formData.status, displayRemitoNumber, currentStatusLabel])

  const hasTalonarios = remitoTalonarioOptions.length > 0
  const disableTalonarioSelect = isEditing || typeof onTalonarioChange !== 'function'
  const talonarioSummary = selectedTalonario
    ? `${selectedTalonario.punto_de_venta} - ${selectedTalonario.label}`
    : ''


  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-x-4 gap-y-3 p-3 border border-gray-200 rounded-2xl bg-white">
  <div className="md:col-span-1 lg:col-span-3">
        <label className="block text-[11px] font-bold text-gray-500 mb-1">Fecha</label>
        <input
          type="date"
          value={formData.posting_date || ''}
          onChange={(e) => handleInputChange('posting_date', e.target.value)}
          className="w-full h-8 text-xs px-2 border border-gray-300 rounded-md bg-white"
        />
      </div>

  <div className="md:col-span-1 lg:col-span-3">
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

  {/* Cliente shown in modal subtitle; inline read-only input removed */}

      {/* Talonario removed - punto_de_venta moved into the Comprobante inputs below */}

  <div className="md:col-span-2 lg:col-span-6">
        <label className="block text-[11px] font-bold text-gray-500 mb-1">Comprobante</label>
        <div className="grid grid-cols-12 gap-1">
          {/* Fixed letter for remitos */}
          <div className="col-span-1 h-8 flex items-center justify-center text-xs font-semibold border border-gray-300 rounded-md bg-white">R</div>

          {/* Punto de venta - display talonario punto if selected, otherwise editable */}
          <input
            type="text"
            value={selectedTalonario?.punto_de_venta || formData.punto_de_venta || ''}
            onChange={(e) => {
              // Allow editing only when no talonario is preselected
              if (selectedTalonario) return
              let value = e.target.value.replace(/[^0-9]/g, '')
              if (value.length > 5) value = value.slice(0, 5)
              handleInputChange('punto_de_venta', value)
            }}
            placeholder="XXXXX"
            readOnly={Boolean(selectedTalonario)}
            className="col-span-2 h-8 text-xs text-center px-2 border border-gray-300 rounded-md"
          />

          {/* Remito number (full 8 digits) */}
	          <input
	            type="text"
	            value={displayRemitoNumber}
	            onFocus={() => setIsRemitoNumberFocused(true)}
	            onBlur={() => {
	              setIsRemitoNumberFocused(false)
	              const padded = rawRemitoNumber ? rawRemitoNumber.padStart(8, '0') : ''
	              if (padded !== String(formData.remito_number || '')) {
	                handleInputChange('remito_number', padded)
	              }
	            }}
	            onChange={(e) => {
	              let value = e.target.value.replace(/[^0-9]/g, '')
	              if (value.length > 8) value = value.slice(0, 8)
	              console.log('[SalesRemitoModalHeader] onChange remito_number input ->', value)
	              handleInputChange('remito_number', value)
	            }}
	            placeholder="00000000"
	            className="col-span-3 h-8 text-xs px-2 border border-gray-300 rounded-md"
	          />

          {/* spacer to keep layout balanced */}
          <div className="col-span-6" />
        </div>
      </div>

      {/* Numeraci-n preview removed as requested */}

      <div className="md:col-span-12">
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

export default SalesRemitoModalHeader
