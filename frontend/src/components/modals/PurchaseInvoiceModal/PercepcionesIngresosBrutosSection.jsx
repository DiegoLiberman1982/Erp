import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, X, Check } from 'lucide-react'
import ProvinciaSvgIcon from '../../iconos/ProvinciaSvgIcon'

// Modal simple para configurar percepción IIBB
const PercepcionIIBBModal = ({ isOpen, onClose, onSave, initialData = {} }) => {
  const [formData, setFormData] = useState({
    base_imponible: initialData.base_imponible || '',
    alicuota: initialData.alicuota || '',
    regimen: initialData.regimen || ''
  })

  // Estado para drag
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const modalRef = useRef(null)

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('input') || e.target.closest('button')) return // No drag si hace click en inputs o botones
    
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

    // Limitar el movimiento dentro de la pantalla
    const maxX = window.innerWidth - (modalRef.current?.offsetWidth || 384)
    const maxY = window.innerHeight - (modalRef.current?.offsetHeight || 200)

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
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleSave = () => {
    const baseImponible = parseFloat(formData.base_imponible) || 0
    const alicuota = parseFloat(formData.alicuota) || 0
    const importe = (baseImponible * alicuota) / 100

    onSave({
      ...formData,
      importe: importe
    })
    onClose()
  }

  const handleClose = () => {
    setFormData({
      base_imponible: '',
      alicuota: '',
      regimen: ''
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999999999]">
      <div 
        ref={modalRef}
        className="bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl rounded-2xl p-6 w-96 cursor-move"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
        onMouseDown={handleMouseDown}
      >
        <div className="space-y-4">
          {/* Headers sin línea separadora */}
          <div className="grid grid-cols-4 gap-4 text-sm font-medium text-gray-700">
            <div>Base Imponible</div>
            <div>Alícuota %</div>
            <div>Régimen</div>
            <div></div> {/* Espacio para los botones */}
          </div>

          {/* Inputs y botones en la misma fila */}
          <div className="grid grid-cols-4 gap-4 items-center">
            <input
              type="number"
              step="0.01"
              value={formData.base_imponible}
              onChange={(e) => handleInputChange('base_imponible', e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent transition h-7"
              placeholder="0.00"
            />

            <input
              type="number"
              step="0.01"
              value={formData.alicuota}
              onChange={(e) => handleInputChange('alicuota', e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent transition h-7"
              placeholder="0.00"
            />

            <input
              type="text"
              value={formData.regimen}
              onChange={(e) => handleInputChange('regimen', e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent transition h-7"
              placeholder="Régimen"
            />

            {/* Botones con iconos en la misma fila */}
            <div className="flex justify-center gap-2">
              <button
                onClick={handleClose}
                className="flex items-center justify-center w-7 h-7 text-gray-600 hover:text-red-600 hover:bg-red-100/70 rounded-xl transition-all duration-300"
                title="Cancelar"
              >
                <X size={14} />
              </button>
              <button
                onClick={handleSave}
                className="flex items-center justify-center w-7 h-7 text-gray-600 hover:text-green-600 hover:bg-green-100/70 rounded-xl transition-all duration-300"
                title="Guardar"
              >
                <Check size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const PercepcionesIngresosBrutosSection = ({ formData, setFormData, minimal = false }) => {
  const [showModal, setShowModal] = useState(false)
  const [selectedJurisdiccion, setSelectedJurisdiccion] = useState('')

  // Lista de jurisdicciones comunes para IIBB
  const jurisdicciones = [
    'Buenos Aires',
    'CABA',
    'Córdoba',
    'Santa Fe',
    'Mendoza',
    'Tucumán',
    'Entre Ríos',
    'Salta',
    'Chaco',
    'Corrientes',
    'Misiones',
    'San Juan',
    'Jujuy',
    'Río Negro',
    'Formosa',
    'Neuquén',
    'Chubut',
    'San Luis',
    'Catamarca',
    'La Rioja',
    'La Pampa',
    'Santa Cruz',
    'Santiago del Estero',
    'Tierra del Fuego'
  ]

  // Componente select personalizado para mostrar iconos
  const CustomSelect = ({ value, onChange, options, placeholder = '' }) => {
    const [isOpen, setIsOpen] = useState(false)
    const selectRef = useRef(null)

    useEffect(() => {
      const handleClickOutside = (event) => {
        if (selectRef.current && !selectRef.current.contains(event.target)) {
          setIsOpen(false)
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleSelect = (optionValue) => {
      onChange(optionValue)
      setIsOpen(false)
    }

    return (
      <div ref={selectRef} className="relative">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent transition h-7 bg-white cursor-pointer flex items-center justify-between"
        >
          <div className="flex items-center gap-1">
            <ProvinciaSvgIcon provinciaName={value} size={14} />
          </div>
          <span className="text-gray-500">▼</span>
        </div>
        {isOpen && (
          <div className="absolute top-full left-0 bg-white border border-gray-300 rounded-md shadow-lg z-50 max-h-40 overflow-y-auto w-max min-w-full">
            <div
              onClick={() => handleSelect('')}
              className="px-2 py-1 text-xs hover:bg-gray-100 cursor-pointer"
            >
              <span>{placeholder}</span>
            </div>
            {options.map((option) => (
              <div
                key={option}
                onClick={() => handleSelect(option)}
                className="px-2 py-1 text-xs hover:bg-gray-100 cursor-pointer"
              >
                <span>{option}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Calcular el total de percepciones IIBB
  const totalPercepcionesIIBB = (formData.percepciones_ingresos_brutos || []).reduce((total, p) => total + (parseFloat(p.importe) || 0), 0)

  const handleJurisdiccionChange = (value) => {
    setSelectedJurisdiccion(value)
  }

  const handleAmountChange = (value) => {
    const amount = parseFloat(value) || 0

    // Si hay percepciones existentes, actualizar solo el importe total
    // Si no hay percepciones, crear una nueva con el importe especificado
    if ((formData.percepciones_ingresos_brutos || []).length === 0) {
      // Crear una nueva percepción con el importe especificado
      const newPercepcion = {
        descripcion: `Percepción IIBB - ${selectedJurisdiccion || 'Sin jurisdicción'}`,
        base_imponible: 0,
        alicuota: 0,
        importe: amount,
        regimen: '',
        jurisdiccion: selectedJurisdiccion
      }
      setFormData(prev => ({
        ...prev,
        percepciones_ingresos_brutos: [newPercepcion]
      }))
    } else {
      // Actualizar el importe de la primera percepción (o distribuir entre todas)
      const newPercepciones = [...(formData.percepciones_ingresos_brutos || [])]
      if (newPercepciones.length === 1) {
        newPercepciones[0].importe = amount
        newPercepciones[0].jurisdiccion = selectedJurisdiccion
        newPercepciones[0].descripcion = `Percepción IIBB - ${selectedJurisdiccion || 'Sin jurisdicción'}`
      } else {
        // Si hay múltiples percepciones, distribuir proporcionalmente
        const currentTotal = newPercepciones.reduce((total, p) => total + (parseFloat(p.importe) || 0), 0)
        if (currentTotal > 0) {
          const ratio = amount / currentTotal
          newPercepciones.forEach(p => {
            p.importe = (parseFloat(p.importe) || 0) * ratio
          })
        }
      }
      setFormData(prev => ({ ...prev, percepciones_ingresos_brutos: newPercepciones }))
    }
  }

  const handleModalSave = (percepcionData) => {
    // Agregar la nueva percepción al array
    const newPercepcion = {
      descripcion: `Percepción IIBB - ${selectedJurisdiccion || 'Sin jurisdicción'}`,
      base_imponible: parseFloat(percepcionData.base_imponible) || 0,
      alicuota: parseFloat(percepcionData.alicuota) || 0,
      importe: parseFloat(percepcionData.importe) || 0,
      regimen: percepcionData.regimen || '',
      jurisdiccion: selectedJurisdiccion
    }

    setFormData(prev => ({
      ...prev,
      percepciones_ingresos_brutos: [...(prev.percepciones_ingresos_brutos || []), newPercepcion]
    }))
  }

  return (
    <>
      <div className={minimal ? "mb-3" : "bg-white rounded-xl shadow-sm border border-gray-200 p-4"}>
        {!minimal && <h3 className="text-sm font-semibold text-gray-900 mb-3">Percepciones Ingresos Brutos</h3>}

        <div className="flex items-center gap-2">
          {minimal && (
            <span className="text-sm font-medium text-gray-700 min-w-fit">Percepción IIBB</span>
          )}
          <div className="flex-1">
            <CustomSelect
              value={selectedJurisdiccion}
              onChange={handleJurisdiccionChange}
              options={jurisdicciones}
              placeholder=""
            />
          </div>
          <div className="flex-1">
            <input
              type="number"
              step="0.01"
              value={totalPercepcionesIIBB.toFixed(2)}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-transparent transition h-7"
              placeholder="0.00"
            />
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center justify-center w-7 h-7 text-black bg-transparent border border-gray-300 rounded hover:bg-gray-100"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Mostrar resumen de percepciones si hay más de una */}
        {(formData.percepciones_ingresos_brutos || []).length > 1 && (
          <div className="mt-3 text-xs text-gray-600">
            {(formData.percepciones_ingresos_brutos || []).map((percepcion, index) => (
              <div key={index} className="flex justify-between py-1">
                <span>{percepcion.descripcion || `Percepción ${index + 1}`}</span>
                <span>{(parseFloat(percepcion.importe) || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <PercepcionIIBBModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleModalSave}
      />
    </>
  )
}

export default PercepcionesIngresosBrutosSection