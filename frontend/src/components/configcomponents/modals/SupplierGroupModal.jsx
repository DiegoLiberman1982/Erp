import React from 'react'
import Modal from '../../Modal'
import { Save } from 'lucide-react'

const SupplierGroupModal = ({
  isOpen,
  onClose,
  editingGroup,
  groupFormData,
  onFormChange,
  onSave,
  saving,
  supplierGroups,
  availableExpenseAccounts,
  paymentTermsTemplates,
  extractAccountName
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingGroup ? 'Editar Grupo de Proveedores' : 'Crear Grupo de Proveedores'}
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Nombre del Grupo *</label>
            <input
              type="text"
              value={groupFormData.name}
              onChange={(e) => onFormChange({ ...groupFormData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="Ej: Proveedores Nacionales"
            />
          </div>
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Tipo de Grupo</label>
            <select
              value={groupFormData.is_group || 0}
              onChange={(e) => onFormChange({ ...groupFormData, is_group: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              <option value={0}>Grupo Individual (contiene proveedores)</option>
              <option value={1}>Grupo Padre (contenedor de subgrupos)</option>
            </select>
          </div>
        </div>

        {groupFormData.is_group === 0 && (
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Grupo Padre</label>
            <select
              value={groupFormData.parent_group}
              onChange={(e) => onFormChange({ ...groupFormData, parent_group: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              {supplierGroups?.filter(group => group.is_group === 1 && group.name !== groupFormData.name).map((group) => (
                <option key={group.name} value={group.name}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {groupFormData.is_group === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Gastos por Defecto</label>
              <select
                value={groupFormData.account || ''}
                onChange={(e) => onFormChange({ ...groupFormData, account: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="">Seleccionar cuenta...</option>
                {availableExpenseAccounts?.map((account) => (
                  <option key={account.name} value={account.name}>
                    {extractAccountName(account)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {groupFormData.is_group === 0 && (
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Condición de Pago por Defecto</label>
            <select
              value={groupFormData.payment_terms || ''}
              onChange={(e) => onFormChange({ ...groupFormData, payment_terms: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              <option value="">Seleccionar condición de pago...</option>
              {paymentTermsTemplates?.map((template) => (
                <option key={template.name} value={template.template_name}>
                  {template.template_name}
                </option>
              ))}
            </select>
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
          onClick={() => onSave('supplier')}
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
              {editingGroup ? 'Actualizar' : 'Crear'} Grupo
            </>
          )}
        </button>
      </div>
    </Modal>
  )
}

export default SupplierGroupModal