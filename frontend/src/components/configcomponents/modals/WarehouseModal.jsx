import React from 'react'
import Modal from '../../Modal'
import { Save } from 'lucide-react'

const WarehouseModal = ({
  isOpen,
  onClose,
  editingWarehouse,
  warehouseFormData,
  onFormChange,
  onSave,
  saving,
  warehouseTypes,
  warehouses,
  activeCompanyDetails
}) => {
  // Detect if this is a CON/VCON variant warehouse
  const isConsignmentVariant = () => {
    if (!editingWarehouse || !editingWarehouse.name) return false
    // Check if the warehouse name contains __CON[ or __VCON[
    return /__\b(CON|VCON)\b\[/.test(editingWarehouse.name)
  }

  const isVariant = isConsignmentVariant()
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingWarehouse ? 'Editar Almacén' : 'Crear Nuevo Almacén'}
      subtitle={activeCompanyDetails ? `Empresa: ${activeCompanyDetails.company_name || activeCompanyDetails.name}` : ''}
      size="lg"
    >
      <div className="space-y-4">
        {isVariant && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-medium text-blue-800">Variante de Consignación</h4>
                <p className="text-sm text-blue-700 mt-1">
                  Este es un almacén de consignación (CON) o venta en local del proveedor (VCON).
                  El nombre visible y la jerarquía se heredan automáticamente del almacén base OWN correspondiente.
                  Solo se puede modificar la información de contacto y ubicación.
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">
              Nombre del Almacén *
              {isVariant && <span className="text-xs text-blue-600 font-normal ml-2">(Heredado del almacén base)</span>}
            </label>
            <input
              type="text"
              value={warehouseFormData.warehouse_name}
              onChange={(e) => onFormChange({ ...warehouseFormData, warehouse_name: e.target.value })}
              disabled={isVariant}
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                isVariant ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
              }`}
              placeholder={isVariant ? "Se hereda del almacén base OWN" : "Ej: Almacén Principal"}
            />
            {isVariant && (
              <p className="text-xs text-gray-500 mt-1">
                Las variantes de consignación heredan el nombre del almacén base OWN
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Tipo de Almacén</label>
            <select
              value={warehouseFormData.warehouse_type}
              onChange={(e) => onFormChange({ ...warehouseFormData, warehouse_type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent relative z-60"
            >
              <option value="">Seleccionar tipo de almacén...</option>
              {warehouseTypes.map(type => {
                return (
                  <option key={type.name} value={type.name}>
                    {type.warehouse_type_name || type.name}
                  </option>
                )
              })}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Dirección</label>
            <input
              type="text"
              value={warehouseFormData.address}
              onChange={(e) => onFormChange({ ...warehouseFormData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Dirección del almacén"
            />
          </div>

          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Ciudad</label>
            <input
              type="text"
              value={warehouseFormData.city}
              onChange={(e) => onFormChange({ ...warehouseFormData, city: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ciudad"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Estado/Provincia</label>
            <input
              type="text"
              value={warehouseFormData.state}
              onChange={(e) => onFormChange({ ...warehouseFormData, state: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Estado o provincia"
            />
          </div>

          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">País</label>
            <input
              type="text"
              value={warehouseFormData.country}
              onChange={(e) => onFormChange({ ...warehouseFormData, country: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="País"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Teléfono</label>
            <input
              type="text"
              value={warehouseFormData.phone_no}
              onChange={(e) => onFormChange({ ...warehouseFormData, phone_no: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Número de teléfono"
            />
          </div>

          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={warehouseFormData.email_id}
              onChange={(e) => onFormChange({ ...warehouseFormData, email_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="email@empresa.com"
            />
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={warehouseFormData.is_group === 1}
              onChange={(e) => onFormChange({ ...warehouseFormData, is_group: e.target.checked ? 1 : 0 })}
              className="mr-2"
            />
            <span className="text-sm font-medium text-gray-700">Es un grupo de almacenes</span>
          </label>
        </div>

        {warehouseFormData.is_group === 0 && (
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">
              Almacén Padre (opcional)
              {isVariant && <span className="text-xs text-blue-600 font-normal ml-2">(Heredado del almacén base)</span>}
            </label>
            <select
              value={warehouseFormData.parent_warehouse}
              onChange={(e) => onFormChange({ ...warehouseFormData, parent_warehouse: e.target.value })}
              disabled={isVariant}
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                isVariant ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
              }`}
            >
              <option value="">
                {isVariant ? "Se hereda del almacén base OWN" : "Seleccionar almacén padre..."}
              </option>
              {warehouses.filter(w => w.is_group === 1).map(warehouse => (
                <option key={warehouse.name} value={warehouse.name}>
                  {warehouse.warehouse_name}
                </option>
              ))}
            </select>
            {isVariant && (
              <p className="text-xs text-gray-500 mt-1">
                Las variantes de consignación heredan la jerarquía del almacén base OWN
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200 mt-6">
        <button
          onClick={onClose}
          className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
          disabled={saving}
        >
          Cancelar
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Guardando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              {editingWarehouse ? 'Actualizar' : 'Crear'} Almacén
            </>
          )}
        </button>
      </div>
    </Modal>
  )
}

export default WarehouseModal