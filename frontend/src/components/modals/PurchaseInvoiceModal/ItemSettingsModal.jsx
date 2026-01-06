import React from 'react'
import { X } from 'lucide-react'

const ItemSettingsModal = ({ isOpen, onClose, item }) => {
  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[70] w-full max-w-lg">
        <div className="p-6 border-b">
          <h3 className="text-lg font-bold">Configurar Ítem: {item.description}</h3>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta Contable</label>
            <input
              type="text"
              placeholder="Buscar cuenta..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Centro de Costo</label>
            <select className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
              <option>Principal</option>
              <option>Administración</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Almacén</label>
            <select className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white">
              <option>No aplica (Servicio)</option>
              <option>Depósito Central</option>
            </select>
          </div>
        </div>
        <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300">
            Cancelar
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700">
            Guardar Cambios
          </button>
        </div>
      </div>
    </>
  )
}

export default ItemSettingsModal