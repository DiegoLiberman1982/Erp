import React from 'react'
import Modal from '../../Modal'
import { Archive } from 'lucide-react'

const GroupItemsModal = ({
  isOpen,
  onClose,
  selectedItemGroups,
  targetParentGroup,
  onTargetChange,
  onGroup,
  grouping,
  itemGroups
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Agrupar Grupos de Items"
      subtitle={`Agrupar ${selectedItemGroups.length} items seleccionados`}
      size="lg"
    >
      <div className="space-y-6">
        {/* Lista de items seleccionados */}
        <div>
          <h3 className="text-lg font-bold text-gray-900 mb-4">Items a agrupar:</h3>
          <div className="bg-gray-50 rounded-lg p-4 max-h-40 overflow-y-auto">
            {selectedItemGroups && selectedItemGroups.length > 0 ? (
              selectedItemGroups.map((itemName, index) => {
                // Buscar el objeto completo para mostrar el nombre legible
                const itemObject = itemGroups.find(group => group.name === itemName)
                return (
                  <div key={itemName || index} className="flex items-center space-x-2 py-1">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="text-sm text-gray-700">{itemObject?.item_group_name || itemName}</span>
                  </div>
                )
              })
            ) : (
              <div className="text-center py-4 text-gray-500">
                <p>No hay items seleccionados</p>
              </div>
            )}
          </div>
        </div>

        {/* Selector de grupo padre */}
        <div>
          <label className="block text-sm font-black text-gray-700 mb-1">Seleccionar Grupo Padre *</label>
          <select
            value={targetParentGroup}
            onChange={(e) => onTargetChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Seleccionar grupo padre...</option>
            {itemGroups
              .filter(group => group.is_group === 1)
              .map((group) => (
                <option key={group.name} value={group.name}>
                  {group.item_group_name || group.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200 mt-6">
        <button
          onClick={onClose}
          className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
          disabled={grouping}
        >
          Cancelar
        </button>
        <button
          onClick={onGroup}
          disabled={grouping || !targetParentGroup}
          className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
        >
          {grouping ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Agrupando...
            </>
          ) : (
            <>
              <Archive className="w-4 h-4 mr-2" />
              Agrupar Items
            </>
          )}
        </button>
      </div>
    </Modal>
  )
}

export default GroupItemsModal