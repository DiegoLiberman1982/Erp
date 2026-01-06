import React, { useState, useEffect } from 'react'
import { X, Search } from 'lucide-react'

const SalesConditionModal = ({ isOpen, onClose, onSelect, currentValue }) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [salesConditions, setSalesConditions] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadSalesConditions()
    }
  }, [isOpen])

  const loadSalesConditions = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/sales-conditions')
      if (response.ok) {
        const data = await response.json()
        setSalesConditions(data || [])
      }
    } catch (error) {
      console.error('Error loading sales conditions:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredConditions = salesConditions.filter(condition =>
    condition.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    condition.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleSelect = (condition) => {
    onSelect(condition)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Seleccionar Condición de Venta</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Buscar condición de venta..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredConditions.map((condition) => (
                <div
                  key={condition.name}
                  onClick={() => handleSelect(condition)}
                  className={`p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${
                    currentValue?.name === condition.name ? 'bg-blue-50 border-blue-300' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-gray-900">{condition.name}</h4>
                      {condition.description && (
                        <p className="text-sm text-gray-600 mt-1">{condition.description}</p>
                      )}
                    </div>
                    {currentValue?.name === condition.name && (
                      <div className="text-blue-600 font-medium text-sm">Seleccionado</div>
                    )}
                  </div>
                </div>
              ))}
              {filteredConditions.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  {searchTerm ? 'No se encontraron condiciones que coincidan con la búsqueda' : 'No hay condiciones de venta disponibles'}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

export default SalesConditionModal