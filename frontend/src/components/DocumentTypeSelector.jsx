import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, FileText, Receipt } from 'lucide-react'

export default function DocumentTypeSelector({ onSelectDocumentType, isOpen, onClose }) {
  const [selectedType, setSelectedType] = useState(null)
  const dropdownRef = useRef(null)

  // Tipos de documentos disponibles
  const documentTypes = [
    {
      id: 'remito_compra',
      label: 'Remito de Compra',
      description: 'Recepción de mercadería',
      icon: FileText,
      color: 'blue'
    }
    // Aquí se pueden agregar más tipos en el futuro
  ]

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  const handleSelectType = (type) => {
    setSelectedType(type)
    onSelectDocumentType(type)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full left-0 mt-2 w-80 bg-white/95 backdrop-blur-xl border border-gray-200/60 shadow-2xl rounded-2xl z-50 overflow-hidden"
    >
      <div className="p-4">
        <div className="space-y-2">
          {documentTypes.map((type) => {
            const IconComponent = type.icon
            return (
              <button
                key={type.id}
                onClick={() => handleSelectType(type)}
                className="w-full p-3 text-left hover:bg-gray-50/80 rounded-xl transition-all duration-200 border border-transparent hover:border-gray-200/60 group"
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 bg-${type.color}-100 rounded-lg flex items-center justify-center group-hover:bg-${type.color}-200 transition-colors duration-200`}>
                    <IconComponent className={`w-5 h-5 text-${type.color}-600`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{type.label}</div>
                    <div className="text-sm text-gray-600">{type.description}</div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-gray-400 rotate-[-90deg]" />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}