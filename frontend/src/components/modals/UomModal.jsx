import React, { useState, useContext } from 'react'
import { AuthContext } from '../../AuthProvider'
import { NotificationContext } from '../../contexts/NotificationContext'
import Modal from '../Modal'
import { X, Plus } from 'lucide-react'

export default function UomModal({ isOpen, onClose, onUomAdded }) {
  const [uomName, setUomName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!uomName.trim()) {
      showNotification('El nombre de la unidad de medida es requerido', 'error')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetchWithAuth('/api/uoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uom_name: uomName.trim(),
          must_be_whole_number: 0, // Por defecto permite decimales
          enabled: 1
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Unidad de medida creada exitosamente', 'success')
          setUomName('')
          onUomAdded && onUomAdded(data.data)
          onClose()
        } else {
          showNotification(data.message || 'Error al crear la unidad de medida', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al crear la unidad de medida', 'error')
      }
    } catch (error) {
      console.error('Error creating UOM:', error)
      showNotification('Error al crear la unidad de medida', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setUomName('')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Agregar Unidad de Medida"
      subtitle="Crear una nueva unidad de medida para el sistema"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Nombre de la Unidad de Medida *
          </label>
          <input
            type="text"
            value={uomName}
            onChange={(e) => setUomName(e.target.value)}
            placeholder="Ej: Kilogramo, Litro, Metro, etc."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isSubmitting}
            autoFocus
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !uomName.trim()}
            className="px-4 py-2 bg-gray-100 text-black border border-gray-300 rounded-lg hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors duration-200 flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
                Creando...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Crear Unidad
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}