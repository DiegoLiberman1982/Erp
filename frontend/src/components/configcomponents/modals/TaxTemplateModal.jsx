import React from 'react'
import Modal from '../../Modal'

const TaxTemplateModal = ({
  isOpen,
  editingTemplate,
  onClose,
  onUpdateAccount,
  onSave,
  saving,
  taxAccounts,
  extractCleanAccountName,
  getAccountDisplayName
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Editar cuentas de ${editingTemplate ? editingTemplate.title : ''}`}
      size="small"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta asignada</label>
          <select
            value={editingTemplate?.accounts?.[0] ? extractCleanAccountName(editingTemplate.accounts[0]) : ''}
            onChange={(e) => onUpdateAccount(0, e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Seleccionar cuenta...</option>
            {taxAccounts.map((taxAccount) => (
              <option key={taxAccount.name} value={taxAccount.account_name || taxAccount.name}>
                {getAccountDisplayName(taxAccount)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end space-x-4 mt-6">
        <button
          onClick={onClose}
          className="px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300"
        >
          Cancelar
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all duration-300 disabled:bg-gray-400"
        >
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}

export default TaxTemplateModal