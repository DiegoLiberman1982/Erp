import React, { useState, useEffect } from 'react'
import { Wallet, Save, Edit, Plus, Trash2, FileText } from 'lucide-react'
import ExpenseMappingModal from './ExpenseMappingModal'

const TreasuryTab = ({
  activeCompanyFromContext,
  activeCompanyDetails,
  accountsSettings,
  setAccountsSettings,
  fetchWithAuth,
  showNotification,
  editingCompany,
  setEditingCompany,
  editedData,
  setEditedData,
  accountSearchResults,
  setAccountSearchResults,
  showAccountDropdown,
  setShowAccountDropdown,
  handleSaveCompany,
  saving
}) => {
  // Estado para mapeos de cuentas
  const [expenseMappings, setExpenseMappings] = useState([])
  const [loadingMappings, setLoadingMappings] = useState(false)
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [selectedMapping, setSelectedMapping] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [mappingToDelete, setMappingToDelete] = useState(null)

  // Cargar mapeos al montar el componente
  useEffect(() => {
    if (activeCompanyFromContext) {
      loadExpenseMappings()
    }
  }, [activeCompanyFromContext])

  const loadExpenseMappings = async () => {
    setLoadingMappings(true)
    try {
      const response = await fetchWithAuth('/api/expense-mappings')
      if (response.ok) {
        const data = await response.json()
        setExpenseMappings(data.data || [])
      }
    } catch (error) {
      console.error('Error loading expense mappings:', error)
      showNotification('Error al cargar los mapeos de cuentas', 'error')
    } finally {
      setLoadingMappings(false)
    }
  }

  const handleSaveMapping = async (mappingData) => {
    try {
      const method = selectedMapping ? 'PUT' : 'POST'
      const endpoint = selectedMapping 
        ? `/api/expense-mappings/${encodeURIComponent(selectedMapping.name)}`
        : '/api/expense-mappings'

      const response = await fetchWithAuth(endpoint, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mappingData)
      })

      if (response.ok) {
        showNotification(
          selectedMapping ? 'Mapeo actualizado correctamente' : 'Mapeo creado correctamente',
          'success'
        )
        await loadExpenseMappings()
        setShowMappingModal(false)
        setSelectedMapping(null)
      } else {
        const error = await response.json()
        showNotification(error.message || 'Error al guardar el mapeo', 'error')
      }
    } catch (error) {
      console.error('Error saving mapping:', error)
      showNotification('Error al guardar el mapeo', 'error')
    }
  }

  const handleDeleteMapping = async () => {
    if (!mappingToDelete) return

    try {
      const response = await fetchWithAuth(
        `/api/expense-mappings/${encodeURIComponent(mappingToDelete.name)}`,
        { method: 'DELETE' }
      )

      if (response.ok) {
        showNotification('Mapeo eliminado correctamente', 'success')
        await loadExpenseMappings()
      } else {
        const error = await response.json()
        showNotification(error.message || 'Error al eliminar el mapeo', 'error')
      }
    } catch (error) {
      console.error('Error deleting mapping:', error)
      showNotification('Error al eliminar el mapeo', 'error')
    } finally {
      setShowDeleteConfirm(false)
      setMappingToDelete(null)
    }
  }

  const getUsageContextLabel = (context) => {
    const labels = {
      'bank_reconciliation': 'Conciliación Bancaria',
      'manual_payment': 'Pago Manual',
      'bank_charges': 'Cargos Bancarios',
      'tax': 'Impuestos',
      'payroll': 'Nómina',
      'other': 'Otro'
    }
    return labels[context] || context
  }

  const getDirectionLabel = (direction) => {
    const labels = {
      'In': 'Entrada',
      'Out': 'Salida',
      'Both': 'Ambos'
    }
    return labels[direction] || direction
  }

  // Helper to extract a display name for accounts (keeps compatibility)
  const extractAccountName = (account) => {
    if (!account) return ''
    // If account is an object with readable name
    if (typeof account === 'object') {
      const fullName = account.account_name || account.name || ''
      // Extract just the account name from format like "5.1.8.03.00 - Ajuste de Existencia - DELP"
      const parts = fullName.split(' - ')
      return parts.length >= 2 ? parts[1] : fullName
    }
    // If it's a string, extract the readable name from format like "5.1.8.03.00 - Ajuste de Existencia - DELP"
    if (typeof account === 'string') {
      const parts = account.split(' - ')
      return parts.length >= 2 ? parts[1] : account
    }
    return account
  }

  // Helper to get clean account display name for dropdowns
  const getAccountDisplayName = (account) => {
    if (!account) return ''
    const fullName = account.account_name || account.name || ''
    const parts = fullName.split(' - ')
    return parts.length >= 2 ? parts[1] : fullName
  }

  // Funciones para búsqueda predictiva de cuentas
  const searchAccounts = async (query, fieldName) => {
    if (!query || query.length < 2) {
      setAccountSearchResults(prev => ({ ...prev, [fieldName]: [] }))
      return
    }

    try {
      const response = await fetchWithAuth(`/api/accounts?search=${encodeURIComponent(query)}&limit=10`)
      if (response.ok) {
        const data = await response.json()
        setAccountSearchResults(prev => ({ ...prev, [fieldName]: data.data || [] }))
      }
    } catch (error) {
      console.error('Error searching accounts:', error)
    }
  }

  const selectAccount = (account, fieldName) => {
    // Guardar el nombre legible para mostrar, pero el código real se guarda en un campo separado
    const displayName = getAccountDisplayName(account)
    setEditedData(prev => ({ 
      ...prev, 
      [fieldName]: displayName,
      [`${fieldName}_code`]: account.name 
    }))
    setAccountSearchResults(prev => ({ ...prev, [fieldName]: [] }))
    setShowAccountDropdown(prev => ({ ...prev, [fieldName]: false }))
  }

  const handleAccountInputChange = (fieldName, value) => {
    setEditedData(prev => ({ ...prev, [fieldName]: value }))
    searchAccounts(value, fieldName)
  }

  const handleAccountFocus = (fieldName) => {
    setShowAccountDropdown(prev => ({ ...prev, [fieldName]: true }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-2xl flex items-center justify-center shadow-lg">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Tesorería</h2>
            <p className="text-gray-600 font-medium">Cuentas de efectivo y tesorería</p>
          </div>
        </div>
      </div>

      {activeCompanyFromContext && (
        <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50">
          {editingCompany === activeCompanyFromContext ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Efectivo:</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={editedData.default_cash_account || ''}
                      onChange={(e) => handleAccountInputChange('default_cash_account', e.target.value)}
                      onFocus={() => handleAccountFocus('default_cash_account')}
                      onBlur={() => setTimeout(() => setShowAccountDropdown(prev => ({ ...prev, default_cash_account: false })), 200)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Cuenta de efectivo"
                    />
                    {/* Dropdown de resultados */}
                    {showAccountDropdown['default_cash_account'] && accountSearchResults['default_cash_account']?.length > 0 && (
                      <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto">
                        {accountSearchResults['default_cash_account'].map((acc) => (
                          <div
                            key={acc.name}
                            onClick={() => selectAccount(acc, 'default_cash_account')}
                            className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                          >
                            <div className="font-medium">{getAccountDisplayName(acc)}</div>
                            <div className="text-xs text-gray-500">{acc.name}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Ganancias/Pérdidas por Cambio:</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={editedData.exchange_gain_loss_account || ''}
                      onChange={(e) => handleAccountInputChange('exchange_gain_loss_account', e.target.value)}
                      onFocus={() => handleAccountFocus('exchange_gain_loss_account')}
                      onBlur={() => setTimeout(() => setShowAccountDropdown(prev => ({ ...prev, exchange_gain_loss_account: false })), 200)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Cuenta de ganancias/pérdidas por cambio"
                    />
                    {/* Dropdown de resultados */}
                    {showAccountDropdown['exchange_gain_loss_account'] && accountSearchResults['exchange_gain_loss_account']?.length > 0 && (
                      <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto">
                        {accountSearchResults['exchange_gain_loss_account'].map((acc) => (
                          <div
                            key={acc.name}
                            onClick={() => selectAccount(acc, 'exchange_gain_loss_account')}
                            className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                          >
                            <div className="font-medium">{getAccountDisplayName(acc)}</div>
                            <div className="text-xs text-gray-500">{acc.name}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Redondeo:</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={editedData.round_off_account || ''}
                      onChange={(e) => handleAccountInputChange('round_off_account', e.target.value)}
                      onFocus={() => handleAccountFocus('round_off_account')}
                      onBlur={() => setTimeout(() => setShowAccountDropdown(prev => ({ ...prev, round_off_account: false })), 200)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Cuenta de redondeo"
                    />
                    {/* Dropdown de resultados */}
                    {showAccountDropdown['round_off_account'] && accountSearchResults['round_off_account']?.length > 0 && (
                      <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto">
                        {accountSearchResults['round_off_account'].map((acc) => (
                          <div
                            key={acc.name}
                            onClick={() => selectAccount(acc, 'round_off_account')}
                            className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                          >
                            <div className="font-medium">{getAccountDisplayName(acc)}</div>
                            <div className="text-xs text-gray-500">{acc.name}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Checkbox Multimoneda */}
              <div className="flex items-center space-x-3 pt-4 border-t border-gray-200">
                <input
                  type="checkbox"
                  id="allow_multi_currency"
                  checked={accountsSettings?.allow_multi_currency_invoices_against_single_party_account || false}
                  onChange={async (e) => {
                    const newValue = e.target.checked
                    setAccountsSettings(prev => ({ ...prev, allow_multi_currency_invoices_against_single_party_account: newValue }))
                    // Guardar automáticamente cuando cambie
                    try {
                      const response = await fetchWithAuth('/api/accounts-settings', {
                        method: 'PUT',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          data: { ...accountsSettings, allow_multi_currency_invoices_against_single_party_account: newValue }
                        })
                      })
                      if (response.ok) {
                        const data = await response.json()
                        if (data.success) {
                          setAccountsSettings(data.data)
                          showNotification('Configuración de multimoneda guardada correctamente', 'success')
                        }
                      }
                    } catch (err) {
                      console.error('Error saving multi-currency setting:', err)
                      showNotification('Error al guardar configuración de multimoneda', 'error')
                    }
                  }}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <label htmlFor="allow_multi_currency" className="text-sm font-medium text-gray-700">
                  Habilitar multimoneda
                </label>
                <div className="text-xs text-gray-500 ml-2">
                  Permite crear asientos contables en diferentes monedas
                </div>
              </div>

              <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                <button
                  onClick={() => {
                    setEditingCompany(null)
                    setEditedData({})
                  }}
                  className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleSaveCompany(editingCompany, editedData)}
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
                      Guardar Cambios
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Efectivo:</label>
                    <p className="text-gray-900 font-bold">{extractAccountName(activeCompanyDetails?.default_cash_account) || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Ganancias/Pérdidas por Cambio:</label>
                    <p className="text-gray-900 font-bold">{extractAccountName(activeCompanyDetails?.exchange_gain_loss_account) || 'No disponible'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-black text-gray-700 mb-1">Cuenta de Redondeo:</label>
                    <p className="text-gray-900 font-bold">{extractAccountName(activeCompanyDetails?.round_off_account) || 'No disponible'}</p>
                  </div>
                </div>

                {/* Multimoneda */}
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={accountsSettings?.allow_multi_currency_invoices_against_single_party_account || false}
                      disabled
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded"
                    />
                    <label className="text-sm font-medium text-gray-700">
                      Multimoneda habilitada
                    </label>
                    <div className="text-xs text-gray-500 ml-2">
                      {accountsSettings?.allow_multi_currency_invoices_against_single_party_account ? 'La empresa permite facturas en múltiples monedas' : 'La empresa solo permite facturas en la moneda principal'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col space-y-2 ml-4">
                <button
                  onClick={() => {
                    setEditingCompany(activeCompanyFromContext)
                    setEditedData({
                      default_cash_account: extractAccountName(activeCompanyDetails?.default_cash_account) || '',
                      default_cash_account_code: activeCompanyDetails?.default_cash_account || '',
                      exchange_gain_loss_account: extractAccountName(activeCompanyDetails?.exchange_gain_loss_account) || '',
                      exchange_gain_loss_account_code: activeCompanyDetails?.exchange_gain_loss_account || '',
                      round_off_account: extractAccountName(activeCompanyDetails?.round_off_account) || '',
                      round_off_account_code: activeCompanyDetails?.round_off_account || '',
                      allow_multi_currency_invoices_against_single_party_account: accountsSettings?.allow_multi_currency_invoices_against_single_party_account || false
                    })
                  }}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                  title="Editar cuentas de tesorería"
                >
                  <Edit className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sección de Mapeo de Cuentas de Gastos */}
      {activeCompanyFromContext && (
        <div className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 rounded-2xl p-6 border border-gray-200/50 mt-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-black text-gray-900">Mapeo de Cuentas de Gastos</h3>
                <p className="text-sm text-gray-600 font-medium">Gestión de mapeo de cuentas contables</p>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedMapping(null)
                setShowMappingModal(true)
              }}
              className="btn-secondary"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nuevo Mapeo
            </button>
          </div>

          {loadingMappings ? (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
          ) : expenseMappings.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 font-medium">No hay mapeos configurados</p>
              <p className="text-sm text-gray-400 mt-2">Crea tu primer mapeo de cuenta de gastos</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">
                      Nombre
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">
                      Cuenta Contable
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">
                      Contexto
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">
                      Dirección
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">
                      Prioridad
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-black text-gray-700 uppercase tracking-wider">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {expenseMappings.map((mapping) => (
                    <tr key={mapping.name} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-gray-900">{mapping.nombre}</div>
                        {(mapping.desde || mapping.hasta) && (
                          <div className="text-xs text-gray-500">
                            {mapping.desde && `Desde: ${mapping.desde}`}
                            {mapping.desde && mapping.hasta && ' | '}
                            {mapping.hasta && `Hasta: ${mapping.hasta}`}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{mapping.cuenta_contable}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {mapping.usage_context ? getUsageContextLabel(mapping.usage_context) : '-'}
                        </div>
                        {mapping.mode_of_payment && (
                          <div className="text-xs text-gray-500">Modo: {mapping.mode_of_payment}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {mapping.direction ? getDirectionLabel(mapping.direction) : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{mapping.priority || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => {
                              setSelectedMapping(mapping)
                              setShowMappingModal(true)
                            }}
                            className="text-blue-600 hover:text-blue-900"
                            title="Editar"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setMappingToDelete(mapping)
                              setShowDeleteConfirm(true)
                            }}
                            className="text-red-600 hover:text-red-900"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal para crear/editar mapeo */}
      <ExpenseMappingModal
        isOpen={showMappingModal}
        onClose={() => {
          setShowMappingModal(false)
          setSelectedMapping(null)
        }}
        mapping={selectedMapping}
        onSave={handleSaveMapping}
        fetchWithAuth={fetchWithAuth}
        showNotification={showNotification}
      />

      {/* Modal de confirmación de eliminación */}
      {showDeleteConfirm && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal-content">
            <div className="confirm-modal-header">
              <div className="confirm-modal-title-section">
                <Trash2 className="w-6 h-6 text-red-500" />
                <h3 className="confirm-modal-title">Confirmar Eliminación</h3>
              </div>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setMappingToDelete(null)
                }}
                className="confirm-modal-close-btn"
              >
                ×
              </button>
            </div>
            <div className="confirm-modal-body">
              <p className="confirm-modal-message">
                ¿Está seguro de que desea eliminar el mapeo "{mappingToDelete?.nombre}"?
              </p>
              <p className="text-sm text-gray-500 mt-2">Esta acción no se puede deshacer.</p>
            </div>
            <div className="confirm-modal-footer">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false)
                  setMappingToDelete(null)
                }}
                className="confirm-modal-btn-cancel"
              >
                Cancelar
              </button>
              <button onClick={handleDeleteMapping} className="confirm-modal-btn-confirm error">
                <Trash2 className="w-4 h-4 mr-2" />
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TreasuryTab