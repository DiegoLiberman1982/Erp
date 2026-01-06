import React, { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { Plus, X, Edit2, Trash2, HelpCircle } from 'lucide-react'
import ProvinciaSvgIcon from '../../iconos/ProvinciaSvgIcon'
import { AuthContext } from '../../../AuthProvider'
import { useNotification } from '../../../contexts/NotificationContext'

// Mapeo de códigos jurisdicción AFIP a nombres (del archivo argentina_withholdings.json)
const PROVINCE_MAP = {
  '901': 'Ciudad Autónoma de Buenos Aires',
  '902': 'Buenos Aires',
  '903': 'Catamarca',
  '904': 'Córdoba',
  '905': 'Corrientes',
  '906': 'Chaco',
  '907': 'Chubut',
  '908': 'Entre Ríos',
  '909': 'Formosa',
  '910': 'Jujuy',
  '911': 'La Pampa',
  '912': 'La Rioja',
  '913': 'Mendoza',
  '914': 'Misiones',
  '915': 'Neuquén',
  '916': 'Río Negro',
  '917': 'Salta',
  '918': 'San Juan',
  '919': 'San Luis',
  '920': 'Santa Cruz',
  '921': 'Santa Fe',
  '922': 'Santiago del Estero',
  '923': 'Tierra del Fuego',
  '924': 'Tucumán'
}

// Mapeo inverso para icono de provincia (nombre corto)
const PROVINCE_SHORT_NAME = {
  '901': 'CABA',
  '902': 'Buenos Aires',
  '903': 'Catamarca',
  '904': 'Córdoba',
  '905': 'Corrientes',
  '906': 'Chaco',
  '907': 'Chubut',
  '908': 'Entre Ríos',
  '909': 'Formosa',
  '910': 'Jujuy',
  '911': 'La Pampa',
  '912': 'La Rioja',
  '913': 'Mendoza',
  '914': 'Misiones',
  '915': 'Neuquén',
  '916': 'Río Negro',
  '917': 'Salta',
  '918': 'San Juan',
  '919': 'San Luis',
  '920': 'Santa Cruz',
  '921': 'Santa Fe',
  '922': 'Santiago del Estero',
  '923': 'Tierra del Fuego',
  '924': 'Tucumán'
}

// Tipos de retención disponibles
const WITHHOLDING_TYPES = [
  { value: 'INGRESOS_BRUTOS', label: 'Retención IIBB', requiresProvince: true },
  { value: 'IVA', label: 'Retención IVA', requiresProvince: false },
  { value: 'GANANCIAS', label: 'Retención Ganancias', requiresProvince: false },
  { value: 'SUSS', label: 'Retención SUSS', requiresProvince: false }
]

// Regímenes por tipo
const REGIMENS = {
  IVA: [
    { value: 'RG2126', label: 'RG 2126 (Régimen General)' },
    { value: 'RG4815', label: 'RG 4815 (Aduanera)' },
    { value: 'RG830', label: 'RG 830' }
  ],
  INGRESOS_BRUTOS: [
    { value: 'RG18', label: 'Régimen General' },
    { value: 'CM', label: 'Convenio Multilateral' },
    { value: 'SIRCREB', label: 'SIRCREB' }
  ],
  GANANCIAS: [
    { value: 'RG830', label: 'RG 830 (Régimen General)' },
    { value: 'RG4815', label: 'RG 4815 (Aduanera)' }
  ],
  SUSS: [
    { value: 'RG79', label: 'RG 79' }
  ]
}

// Modal para agregar/editar retenciones
const RetencionModal = ({ 
  isOpen, 
  onClose, 
  onSave, 
  initialData = null, 
  editIndex = null,
  invoiceOptions = []
}) => {
  const { showWarning } = useNotification()
  const [formData, setFormData] = useState({
    tax_type: 'INGRESOS_BRUTOS',
    province_code: '',
    regimen: '',
    certificate_number: '',
    base_amount: '',
    percentage: '',
    amount: '',
    sales_invoice: ''
  })

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData({
          tax_type: initialData.tax_type || 'INGRESOS_BRUTOS',
          province_code: initialData.province_code || '',
          regimen: initialData.regimen || '',
          certificate_number: initialData.certificate_number || '',
          base_amount: initialData.base_amount || '',
          percentage: initialData.percentage || '',
          amount: initialData.amount || '',
          sales_invoice: initialData.sales_invoice || ''
        })
      } else {
        setFormData({
          tax_type: 'INGRESOS_BRUTOS',
          province_code: '',
          regimen: '',
          certificate_number: '',
          base_amount: '',
          percentage: '',
          amount: '',
          sales_invoice: ''
        })
      }
    }
  }, [isOpen, initialData])

  // Estado para drag
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const modalRef = useRef(null)

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('input') || e.target.closest('button') || e.target.closest('select')) return
    
    setIsDragging(true)
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    })
    e.preventDefault()
  }, [position])

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return

    const newX = e.clientX - dragStart.x
    const newY = e.clientY - dragStart.y

    const maxX = window.innerWidth - (modalRef.current?.offsetWidth || 550)
    const maxY = window.innerHeight - (modalRef.current?.offsetHeight || 350)

    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY))
    })
  }, [isDragging, dragStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleInputChange = (field, value) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value }
      
      // Auto-calcular importe cuando cambian base_amount o percentage
      if (field === 'base_amount' || field === 'percentage') {
        const base = parseFloat(field === 'base_amount' ? value : prev.base_amount) || 0
        const pct = parseFloat(field === 'percentage' ? value : prev.percentage) || 0
        if (base > 0 && pct > 0) {
          newData.amount = ((base * pct) / 100).toFixed(2)
        }
      }
      
      // Limpiar provincia si el tipo no la requiere
      if (field === 'tax_type') {
        const typeConfig = WITHHOLDING_TYPES.find(t => t.value === value)
        if (!typeConfig?.requiresProvince) {
          newData.province_code = ''
        }
        // Limpiar régimen al cambiar tipo
        newData.regimen = ''
      }
      
      return newData
    })
  }

  const handleSave = () => {
    const typeConfig = WITHHOLDING_TYPES.find(t => t.value === formData.tax_type)
    
    // Validar monto obligatorio
    const amount = parseFloat(formData.amount) || 0
    if (amount <= 0) {
      showWarning('El importe de la retención es obligatorio y debe ser mayor a cero')
      return
    }
    
    // Validar provincia requerida para IIBB
    if (typeConfig?.requiresProvince && !formData.province_code) {
      showWarning('Debe seleccionar una jurisdicción para retenciones de Ingresos Brutos')
      return
    }
    
    // Validar que no haya provincia para IVA/Ganancias/SUSS
    if (!typeConfig?.requiresProvince && formData.province_code) {
      showWarning('Las retenciones de IVA, Ganancias y SUSS no deben tener jurisdicción')
      return
    }

    const withholding = {
      tax_type: formData.tax_type,
      province_code: formData.province_code || null,
      regimen: formData.regimen || null,
      certificate_number: formData.certificate_number || null,
      base_amount: parseFloat(formData.base_amount) || null,
      percentage: parseFloat(formData.percentage) || null,
      amount: amount,
      sales_invoice: formData.sales_invoice || null
    }

    onSave(withholding, editIndex)
    onClose()
  }

  const handleClose = () => {
    setFormData({
      tax_type: 'INGRESOS_BRUTOS',
      province_code: '',
      regimen: '',
      certificate_number: '',
      base_amount: '',
      percentage: '',
      amount: '',
      sales_invoice: ''
    })
    setPosition({ x: 0, y: 0 })
    onClose()
  }

  const currentType = WITHHOLDING_TYPES.find(t => t.value === formData.tax_type)
  const showProvinceField = currentType?.requiresProvince
  const availableRegimens = REGIMENS[formData.tax_type] || []

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999999999]">
      <div 
        ref={modalRef}
        className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl rounded-2xl p-6 w-[550px] cursor-move"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
        onMouseDown={handleMouseDown}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              {editIndex !== null ? 'Editar Retención' : 'Nueva Retención'}
            </h3>
            <button
              onClick={handleClose}
              className="text-gray-500 hover:text-gray-700"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tipo de retención y Jurisdicción */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
              <select
                value={formData.tax_type}
                onChange={(e) => handleInputChange('tax_type', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
              >
                {WITHHOLDING_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            {/* Jurisdicción (solo para IIBB) */}
            {showProvinceField && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Jurisdicción</label>
                <select
                  value={formData.province_code}
                  onChange={(e) => handleInputChange('province_code', e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
                >
                  <option value="">Seleccionar...</option>
                  {Object.entries(PROVINCE_MAP).map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Régimen */}
            {!showProvinceField && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Régimen</label>
                <select
                  value={formData.regimen}
                  onChange={(e) => handleInputChange('regimen', e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
                >
                  <option value="">Seleccionar...</option>
                  {availableRegimens.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Segunda fila: Régimen para IIBB y Nro Certificado */}
          <div className="grid grid-cols-2 gap-4">
            {showProvinceField && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Régimen</label>
                <select
                  value={formData.regimen}
                  onChange={(e) => handleInputChange('regimen', e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
                >
                  <option value="">Seleccionar...</option>
                  {availableRegimens.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div className={showProvinceField ? '' : 'col-span-2'}>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nro. Certificado</label>
              <input
                type="text"
                value={formData.certificate_number}
                onChange={(e) => handleInputChange('certificate_number', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
                placeholder="Número de certificado"
              />
            </div>
          </div>

          {/* Campos numéricos */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Base Imponible
                <span className="text-gray-400 text-[10px] ml-1">(opcional)</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.base_amount}
                onChange={(e) => handleInputChange('base_amount', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Alícuota %
                <span className="text-gray-400 text-[10px] ml-1">(opcional)</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.percentage}
                onChange={(e) => handleInputChange('percentage', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Importe
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => handleInputChange('amount', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7 font-medium"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          {/* Factura asociada (opcional) */}
          {invoiceOptions.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Factura asociada
                <span className="text-gray-400 text-[10px] ml-1">(opcional)</span>
              </label>
              <select
                value={formData.sales_invoice}
                onChange={(e) => handleInputChange('sales_invoice', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
              >
                <option value="">Sin asociar</option>
                {invoiceOptions.map(inv => (
                  <option key={inv.name} value={inv.name}>{inv.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
            >
              {editIndex !== null ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Componente principal de sección de retenciones
const RetencionesSection = ({ 
  withholdings = [], 
  onWithholdingsChange, 
  invoiceOptions = [],
  minimal = false 
}) => {
  const [showModal, setShowModal] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [editingData, setEditingData] = useState(null)

  // Calcular totales por tipo
  const totalsByType = withholdings.reduce((acc, w) => {
    const type = w.tax_type || 'OTROS'
    acc[type] = (acc[type] || 0) + (parseFloat(w.amount) || 0)
    return acc
  }, {})

  const totalWithholdings = Object.values(totalsByType).reduce((sum, val) => sum + val, 0)

  const handleAddWithholding = () => {
    setEditingIndex(null)
    setEditingData(null)
    setShowModal(true)
  }

  const handleEditWithholding = (index) => {
    setEditingIndex(index)
    setEditingData(withholdings[index])
    setShowModal(true)
  }

  const handleDeleteWithholding = (index) => {
    const newWithholdings = withholdings.filter((_, i) => i !== index)
    onWithholdingsChange(newWithholdings)
  }

  const handleSaveWithholding = (withholding, editIndex) => {
    if (editIndex !== null) {
      // Editar existente
      const newWithholdings = [...withholdings]
      newWithholdings[editIndex] = withholding
      onWithholdingsChange(newWithholdings)
    } else {
      // Agregar nueva
      onWithholdingsChange([...withholdings, withholding])
    }
  }

  const getWithholdingLabel = (withholding) => {
    const typeConfig = WITHHOLDING_TYPES.find(t => t.value === withholding.tax_type)
    let label = typeConfig?.label || withholding.tax_type
    
    if (withholding.province_code && PROVINCE_SHORT_NAME[withholding.province_code]) {
      label += ` - ${PROVINCE_SHORT_NAME[withholding.province_code]}`
    }
    
    return label
  }

  const formatAmount = (amount) => {
    return (parseFloat(amount) || 0).toFixed(2)
  }

  // Modo minimal (para el sidebar summary)
  if (minimal) {
    return (
      <>
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-gray-700">Retenciones</span>
              <div className="group relative">
                <HelpCircle size={12} className="text-gray-400 cursor-help" />
                <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block w-48 p-2 text-xs bg-gray-800 text-white rounded-lg shadow-lg z-50">
                  Retenciones sufridas por el cliente que actúa como agente de retención. Se registran como crédito fiscal.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-gray-600">{formatAmount(totalWithholdings)}</span>
              <button
                onClick={handleAddWithholding}
                className="flex items-center justify-center w-7 h-7 text-black bg-transparent border border-gray-300 rounded hover:bg-gray-100"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Lista compacta de retenciones */}
          {withholdings.length > 0 && (
            <div className="mt-2 space-y-1">
              {withholdings.map((withholding, index) => (
                <div key={index} className="flex items-center justify-between text-xs text-gray-600 py-1 px-2 bg-gray-50 rounded group">
                  <div className="flex items-center gap-1">
                    {withholding.province_code && (
                      <ProvinciaSvgIcon provinciaName={PROVINCE_SHORT_NAME[withholding.province_code]} size={12} />
                    )}
                    <span className="truncate max-w-[120px]">{getWithholdingLabel(withholding)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono">{formatAmount(withholding.amount)}</span>
                    <button
                      onClick={() => handleEditWithholding(index)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-blue-600 transition"
                    >
                      <Edit2 size={10} />
                    </button>
                    <button
                      onClick={() => handleDeleteWithholding(index)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-600 transition"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <RetencionModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSave={handleSaveWithholding}
          initialData={editingData}
          editIndex={editingIndex}
          invoiceOptions={invoiceOptions}
        />
      </>
    )
  }

  // Modo completo (card independiente)
  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Retenciones</h3>
            <div className="group relative">
              <HelpCircle size={14} className="text-gray-400 cursor-help" />
              <div className="absolute left-0 top-full mt-1 hidden group-hover:block w-56 p-2 text-xs bg-gray-800 text-white rounded-lg shadow-lg z-50">
                Retenciones sufridas cuando el cliente actúa como agente de retención. Se descuentan del cobro y se registran como crédito fiscal en el activo.
              </div>
            </div>
          </div>
          <button
            onClick={handleAddWithholding}
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition"
          >
            <Plus size={14} />
            Agregar
          </button>
        </div>

        {withholdings.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4">
            No hay retenciones registradas
          </p>
        ) : (
          <div className="space-y-2">
            {withholdings.map((withholding, index) => (
              <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg group">
                <div className="flex items-center gap-2">
                  {withholding.province_code && (
                    <ProvinciaSvgIcon provinciaName={PROVINCE_SHORT_NAME[withholding.province_code]} size={16} />
                  )}
                  <div>
                    <p className="text-xs font-medium text-gray-800">
                      {getWithholdingLabel(withholding)}
                    </p>
                    <div className="flex gap-2 text-xs text-gray-500">
                      {withholding.percentage && (
                        <span>
                          Base: {formatAmount(withholding.base_amount)} × {withholding.percentage}%
                        </span>
                      )}
                      {withholding.certificate_number && (
                        <span>Cert: {withholding.certificate_number}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-medium text-gray-800">
                    {formatAmount(withholding.amount)}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={() => handleEditWithholding(index)}
                      className="p-1 text-gray-400 hover:text-blue-600 transition"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteWithholding(index)}
                      className="p-1 text-gray-400 hover:text-red-600 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Totales por tipo */}
            <div className="border-t pt-2 mt-2 space-y-1">
              {Object.entries(totalsByType).map(([type, total]) => {
                const typeConfig = WITHHOLDING_TYPES.find(t => t.value === type)
                return (
                  <div key={type} className="flex justify-between text-xs text-gray-600">
                    <span>{typeConfig?.label || type}</span>
                    <span className="font-mono">{formatAmount(total)}</span>
                  </div>
                )
              })}
              <div className="flex justify-between text-sm font-medium text-gray-800 pt-1">
                <span>Total Retenciones</span>
                <span className="font-mono">{formatAmount(totalWithholdings)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <RetencionModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSaveWithholding}
        initialData={editingData}
        editIndex={editingIndex}
        invoiceOptions={invoiceOptions}
      />
    </>
  )
}

export default RetencionesSection
