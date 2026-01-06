import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, X, Check, Trash2, Edit2 } from 'lucide-react'
import ProvinciaSvgIcon from '../../iconos/ProvinciaSvgIcon'
import { useNotification } from '../../../contexts/NotificationContext'

// Mapeo de códigos ISO de provincias a nombres
const PROVINCE_MAP = {
  'AR-B': 'Buenos Aires',
  'AR-C': 'CABA',
  'AR-K': 'Catamarca',
  'AR-H': 'Chaco',
  'AR-U': 'Chubut',
  'AR-X': 'Córdoba',
  'AR-W': 'Corrientes',
  'AR-E': 'Entre Ríos',
  'AR-P': 'Formosa',
  'AR-Y': 'Jujuy',
  'AR-L': 'La Pampa',
  'AR-F': 'La Rioja',
  'AR-M': 'Mendoza',
  'AR-N': 'Misiones',
  'AR-Q': 'Neuquén',
  'AR-R': 'Río Negro',
  'AR-A': 'Salta',
  'AR-J': 'San Juan',
  'AR-D': 'San Luis',
  'AR-Z': 'Santa Cruz',
  'AR-S': 'Santa Fe',
  'AR-G': 'Santiago del Estero',
  'AR-V': 'Tierra del Fuego',
  'AR-T': 'Tucumán'
}

// Mapeo inverso: nombre de provincia a código ISO
const PROVINCE_NAME_TO_CODE = Object.entries(PROVINCE_MAP).reduce((acc, [code, name]) => {
  acc[name] = code
  acc[name.toUpperCase()] = code
  acc[name.toLowerCase()] = code
  return acc
}, {})

// Tipos de percepción disponibles
const PERCEPTION_TYPES = [
  { value: 'IVA', label: 'Per. IVA', requiresProvince: false },
  { value: 'INGRESOS_BRUTOS', label: 'Per. IIBB', requiresProvince: true },
  { value: 'GANANCIAS', label: 'Per. Ganancias', requiresProvince: false }
]

// Modal para agregar/editar percepciones
const PercepcionModal = ({ isOpen, onClose, onSave, initialData = null, editIndex = null }) => {
  const { showWarning } = useNotification()
  const [formData, setFormData] = useState({
    perception_type: 'IVA',
    scope: 'INTERNA',
    province_code: '',
    regimen_code: '',
    percentage: '',
    base_amount: '',
    total_amount: ''
  })

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData({
          perception_type: initialData.perception_type || 'IVA',
          scope: initialData.scope || 'INTERNA',
          province_code: initialData.province_code || '',
          regimen_code: initialData.regimen_code || '',
          percentage: initialData.percentage || '',
          base_amount: initialData.base_amount || '',
          total_amount: initialData.total_amount || ''
        })
      } else {
        setFormData({
          perception_type: 'IVA',
          scope: 'INTERNA',
          province_code: '',
          regimen_code: '',
          percentage: '',
          base_amount: '',
          total_amount: ''
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

    const maxX = window.innerWidth - (modalRef.current?.offsetWidth || 500)
    const maxY = window.innerHeight - (modalRef.current?.offsetHeight || 300)

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
          newData.total_amount = ((base * pct) / 100).toFixed(2)
        }
      }
      
      // Limpiar provincia si el tipo no la requiere
      if (field === 'perception_type') {
        const typeConfig = PERCEPTION_TYPES.find(t => t.value === value)
        if (!typeConfig?.requiresProvince) {
          newData.province_code = ''
        }
      }
      
      return newData
    })
  }

  const handleSave = () => {
    const typeConfig = PERCEPTION_TYPES.find(t => t.value === formData.perception_type)
    
    // Validar provincia requerida para IIBB
    if (typeConfig?.requiresProvince && !formData.province_code) {
      showWarning('Debe seleccionar una jurisdicción para percepciones de Ingresos Brutos')
      return
    }
    
    // Validar que no haya provincia para IVA/Ganancias
    if (!typeConfig?.requiresProvince && formData.province_code) {
      showWarning('Las percepciones de IVA y Ganancias no deben tener jurisdicción')
      return
    }

    const perception = {
      perception_type: formData.perception_type,
      scope: formData.scope || 'INTERNA',
      province_code: formData.province_code || null,
      regimen_code: formData.regimen_code || '',
      percentage: parseFloat(formData.percentage) || null,
      base_amount: parseFloat(formData.base_amount) || null,
      total_amount: parseFloat(formData.total_amount) || 0
    }

    onSave(perception, editIndex)
    onClose()
  }

  const handleClose = () => {
    setFormData({
      perception_type: 'IVA',
      scope: 'INTERNA',
      province_code: '',
      regimen_code: '',
      percentage: '',
      base_amount: '',
      total_amount: ''
    })
    setPosition({ x: 0, y: 0 })
    onClose()
  }

  const currentType = PERCEPTION_TYPES.find(t => t.value === formData.perception_type)
  const showProvinceField = currentType?.requiresProvince

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999999999]">
      <div 
        ref={modalRef}
        className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl rounded-2xl p-6 w-[500px] cursor-move"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
        onMouseDown={handleMouseDown}
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="text-sm font-semibold text-gray-800">
              {editIndex !== null ? 'Editar Percepción' : 'Nueva Percepción'}
            </h3>
            <button
              onClick={handleClose}
              className="text-gray-500 hover:text-gray-700"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tipo de percepción */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
              <select
                value={formData.perception_type}
                onChange={(e) => handleInputChange('perception_type', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
              >
                {PERCEPTION_TYPES.map(type => (
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
          </div>

          {/* Campos numéricos */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Base Imponible</label>
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
              <label className="block text-xs font-medium text-gray-700 mb-1">Alícuota %</label>
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
              <label className="block text-xs font-medium text-gray-700 mb-1">Importe</label>
              <input
                type="number"
                step="0.01"
                value={formData.total_amount}
                onChange={(e) => handleInputChange('total_amount', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Régimen</label>
              <input
                type="text"
                value={formData.regimen_code}
                onChange={(e) => handleInputChange('regimen_code', e.target.value)}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 h-7"
                placeholder="Código"
              />
            </div>
          </div>

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

// Componente principal de sección de percepciones
const PercepcionesSection = ({ formData, setFormData, minimal = false }) => {
  const [showModal, setShowModal] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [editingData, setEditingData] = useState(null)

  // Obtener percepciones del formData
  const perceptions = formData.perceptions || []

  // Calcular totales por tipo
  const totalsByType = perceptions.reduce((acc, p) => {
    const type = p.perception_type || 'OTROS'
    acc[type] = (acc[type] || 0) + Math.abs(parseFloat(p.total_amount) || 0)
    return acc
  }, {})

  const totalPerceptions = Object.values(totalsByType).reduce((sum, val) => sum + val, 0)

  const handleAddPerception = () => {
    setEditingIndex(null)
    setEditingData(null)
    setShowModal(true)
  }

  const handleEditPerception = (index) => {
    setEditingIndex(index)
    setEditingData(perceptions[index])
    setShowModal(true)
  }

  const handleDeletePerception = (index) => {
    const newPerceptions = perceptions.filter((_, i) => i !== index)
    setFormData(prev => ({ ...prev, perceptions: newPerceptions }))
  }

  const handleSavePerception = (perception, editIndex) => {
    if (editIndex !== null) {
      // Editar existente
      const newPerceptions = [...perceptions]
      newPerceptions[editIndex] = perception
      setFormData(prev => ({ ...prev, perceptions: newPerceptions }))
    } else {
      // Agregar nueva
      setFormData(prev => ({
        ...prev,
        perceptions: [...(prev.perceptions || []), perception]
      }))
    }
  }

  const getPerceptionLabel = (perception) => {
    const typeConfig = PERCEPTION_TYPES.find(t => t.value === perception.perception_type)
    let label = typeConfig?.label || perception.perception_type
    
    if (perception.province_code && PROVINCE_MAP[perception.province_code]) {
      label += ` - ${PROVINCE_MAP[perception.province_code]}`
    }
    
    return label
  }

  const formatAmount = (amount) => {
    return Math.abs(parseFloat(amount) || 0).toFixed(2)
  }

  // Modo minimal (para el sidebar summary)
  if (minimal) {
    return (
      <>
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">Percepciones</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-gray-600 text-right min-w-[72px] inline-block">{formatAmount(totalPerceptions)}</span>
              <button
                onClick={handleAddPerception}
                className="flex items-center justify-center w-7 h-7 text-black bg-transparent border border-gray-300 rounded hover:bg-gray-100"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Lista compacta de percepciones */}
          {perceptions.length > 0 && (
            <div className="mt-2 space-y-1">
              {perceptions.map((perception, index) => (
                <div key={index} className="flex items-center justify-between text-xs text-gray-600 py-1 px-2 bg-gray-50 rounded group">
                  <div className="flex items-center gap-1">
                    {perception.province_code && (
                      <ProvinciaSvgIcon provinciaName={PROVINCE_MAP[perception.province_code]} size={12} />
                    )}
                    <span className="truncate">{getPerceptionLabel(perception)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-right min-w-[72px] inline-block">{formatAmount(perception.total_amount)}</span>
                    <button
                      onClick={() => handleEditPerception(index)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-blue-600 transition"
                    >
                      <Edit2 size={10} />
                    </button>
                    <button
                      onClick={() => handleDeletePerception(index)}
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

        <PercepcionModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSave={handleSavePerception}
          initialData={editingData}
          editIndex={editingIndex}
        />
      </>
    )
  }

  // Modo completo (card independiente)
  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Percepciones</h3>
          <button
            onClick={handleAddPerception}
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition"
          >
            <Plus size={14} />
            Agregar
          </button>
        </div>

        {perceptions.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4">
            No hay percepciones agregadas
          </p>
        ) : (
          <div className="space-y-2">
            {perceptions.map((perception, index) => (
              <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg group">
                <div className="flex items-center gap-2">
                  {perception.province_code && (
                    <ProvinciaSvgIcon provinciaName={PROVINCE_MAP[perception.province_code]} size={16} />
                  )}
                  <div>
                    <p className="text-xs font-medium text-gray-800">
                      {getPerceptionLabel(perception)}
                    </p>
                    {perception.percentage && (
                      <p className="text-xs text-gray-500">
                        Base: {formatAmount(perception.base_amount)} × {Math.abs(parseFloat(perception.percentage) || 0)}%
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-medium text-gray-800 text-right min-w-[80px] inline-block">
                    {formatAmount(perception.total_amount)}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={() => handleEditPerception(index)}
                      className="p-1 text-gray-400 hover:text-blue-600 transition"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDeletePerception(index)}
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
                const typeConfig = PERCEPTION_TYPES.find(t => t.value === type)
                return (
                  <div key={type} className="flex justify-between text-xs text-gray-600">
                    <span>{typeConfig?.label || type}</span>
                    <span className="font-mono text-right min-w-[72px] inline-block">{formatAmount(total)}</span>
                  </div>
                )
              })}
              <div className="flex justify-between text-sm font-medium text-gray-800 pt-1">
                <span>Total Percepciones</span>
                <span className="font-mono text-right min-w-[80px] inline-block">{formatAmount(totalPerceptions)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <PercepcionModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSavePerception}
        initialData={editingData}
        editIndex={editingIndex}
      />
    </>
  )
}

export default PercepcionesSection
