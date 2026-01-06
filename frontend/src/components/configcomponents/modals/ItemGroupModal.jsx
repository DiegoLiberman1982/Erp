import React from 'react'
import Modal from '../../Modal'
import { Save } from 'lucide-react'

const ItemGroupModal = ({
  isOpen,
  onClose,
  newItemGroup,
  onItemGroupChange,
  onParentInputChange,
  onParentFocus,
  onParentBlur,
  showParentDropdown,
  parentItemGroups,
  onSelectParent,
  onCreate,
  creating
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gestión de Grupos de Items"
      subtitle="Crear nuevo grupo de items"
      size="lg"
    >
      <div className="space-y-6">
        {/* Formulario para crear nuevo grupo de items */}
        <div className="border-t border-gray-200 pt-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Crear Nuevo Grupo de Items</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Nombre del Grupo de Items *</label>
              <input
                type="text"
                value={newItemGroup.item_group_name}
                onChange={(e) => onItemGroupChange({ ...newItemGroup, item_group_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Ej: Productos, Servicios, Materias Primas..."
              />
            </div>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Tipo</label>
              <select
                value={newItemGroup.is_group}
                onChange={(e) => onItemGroupChange({ ...newItemGroup, is_group: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={1}>Grupo de Items</option>
                <option value={0}>Grupo de Items Individual</option>
              </select>
            </div>
          </div>
          {newItemGroup.is_group === 0 && (
            <div className="mt-4">
              <label className="block text-sm font-black text-gray-700 mb-1">
                Grupo de Items Padre *
              </label>
              <div className="flex space-x-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={newItemGroup.parent_item_group_display || ''}
                    onChange={(e) => onParentInputChange(e.target.value)}
                    onFocus={onParentFocus}
                    onBlur={onParentBlur}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Seleccionar grupo de items padre..."
                  />
                  {/* Dropdown de grupos padre */}
                  {showParentDropdown && parentItemGroups.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto">
                      {parentItemGroups.map((ig) => (
                        <div
                          key={ig.name}
                          onClick={() => onSelectParent(ig)}
                          className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                        >
                          <div className="font-medium">{ig.item_group_name}</div>
                          <div className="text-xs text-gray-500">{ig.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
          >
            Cancelar
          </button>
          <button
            onClick={onCreate}
            disabled={creating || !newItemGroup.item_group_name.trim()}
            className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
          >
            {creating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Creando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Crear Grupo de Items
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default ItemGroupModal