import React, { useState, useEffect } from 'react'
import { Save } from 'lucide-react'
import Modal from '../Modal'

const ExpenseMappingModal = ({
  isOpen,
  onClose,
  mapping,
  onSave,
  fetchWithAuth,
  showNotification
}) => {
  const [formData, setFormData] = useState({
    nombre: '',
    cuenta_contable: '',
    cuenta_contable_code: '',
    desde: '',
    hasta: '',
    usage_context: '',
    mode_of_payment: '',
    direction: '',
    priority: ''
  })

  const [saving, setSaving] = useState(false)
  const [accountSearchResults, setAccountSearchResults] = useState([])
  const [showAccountDropdown, setShowAccountDropdown] = useState(false)
  const [modeOfPaymentResults, setModeOfPaymentResults] = useState([])
  const [showModeOfPaymentDropdown, setShowModeOfPaymentDropdown] = useState(false)

  useEffect(() => {
    if (mapping) {
      setFormData({
        nombre: mapping.nombre || '',
        cuenta_contable: mapping.cuenta_contable || '',
        cuenta_contable_code: mapping.cuenta_contable_name || mapping.cuenta_contable || '',
        desde: mapping.desde || '',
        hasta: mapping.hasta || '',
        usage_context: mapping.usage_context || '',
        mode_of_payment: mapping.mode_of_payment || '',
        direction: mapping.direction || '',
        priority: mapping.priority || ''
      })
    } else {
      setFormData({
        nombre: '',
        cuenta_contable: '',
        cuenta_contable_code: '',
        desde: '',
        hasta: '',
        usage_context: '',
        mode_of_payment: '',
        direction: '',
        priority: ''
      })
    }
  }, [mapping])

  const searchAccounts = async (query) => {
    if (!query || query.length < 2) {
      setAccountSearchResults([])
      return
    }

    try {
      const response = await fetchWithAuth(`/api/accounts?search=${encodeURIComponent(query)}&limit=10`)
      if (response.ok) {
        const data = await response.json()
        setAccountSearchResults(data.data || [])
      }
    } catch (error) {
      console.error('Error searching accounts:', error)
    }
  }

  const searchModeOfPayment = async (query) => {
    if (!query || query.length < 2) {
      setModeOfPaymentResults([])
      return
    }

    try {
      const response = await fetchWithAuth(`/api/mode-of-payment?search=${encodeURIComponent(query)}&limit=10`)
      if (response.ok) {
        const data = await response.json()
        setModeOfPaymentResults(data.data || [])
      }
    } catch (error) {
      console.error('Error searching mode of payment:', error)
    }
  }

  const getAccountDisplayName = (account) => {
    if (!account) return ''
    const fullName = account.account_name || account.name || ''
    const parts = fullName.split(' - ')
    return parts.length >= 2 ? parts[1] : fullName
  }

  const selectAccount = (account) => {
    const displayName = getAccountDisplayName(account)
    setFormData(prev => ({ 
      ...prev, 
      cuenta_contable: displayName,
      cuenta_contable_code: account.name 
    }))
    setAccountSearchResults([])
    setShowAccountDropdown(false)
  }

  const selectModeOfPayment = (mode) => {
    setFormData(prev => ({ ...prev, mode_of_payment: mode.name }))
    setModeOfPaymentResults([])
    setShowModeOfPaymentDropdown(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.nombre || !formData.cuenta_contable) {
      showNotification('El nombre y la cuenta contable son obligatorios', 'error')
      return
    }

    setSaving(true)
    try {
      const dataToSend = {
        ...formData,
        cuenta_contable: formData.cuenta_contable_code || formData.cuenta_contable
      }
      await onSave(dataToSend)
      onClose()
    } catch (error) {
      console.error('Error saving expense mapping:', error)
      showNotification('Error al guardar el mapeo', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mapping ? 'Editar Mapeo de Cuenta' : 'Nuevo Mapeo de Cuenta'}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Nombre */}
          <div>
            <label className="block text-sm font-black text-gray-700 mb-2">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.nombre}
              onChange={(e) => setFormData(prev => ({ ...prev, nombre: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Nombre descriptivo del mapeo"
              required
            />
          </div>

          {/* Cuenta Contable */}
          <div>
            <label className="block text-sm font-black text-gray-700 mb-2">
              Cuenta Contable <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={formData.cuenta_contable}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, cuenta_contable: e.target.value }))
                  searchAccounts(e.target.value)
                }}
                onFocus={() => setShowAccountDropdown(true)}
                onBlur={() => setTimeout(() => setShowAccountDropdown(false), 200)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Buscar cuenta contable"
                required
              />
              {showAccountDropdown && accountSearchResults.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto">
                  {accountSearchResults.map((acc) => (
                    <div
                      key={acc.name}
                      onClick={() => selectAccount(acc)}
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

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-black text-gray-700 mb-2">Desde</label>
              <input
                type="date"
                value={formData.desde}
                onChange={(e) => setFormData(prev => ({ ...prev, desde: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-2">Hasta</label>
              <input
                type="date"
                value={formData.hasta}
                onChange={(e) => setFormData(prev => ({ ...prev, hasta: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Usage Context */}
          <div>
            <label className="block text-sm font-black text-gray-700 mb-2">Contexto de Uso</label>
            <select
              value={formData.usage_context}
              onChange={(e) => setFormData(prev => ({ ...prev, usage_context: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Seleccionar...</option>
              <option value="bank_reconciliation">Conciliación Bancaria</option>
              <option value="manual_payment">Pago Manual</option>
              <option value="bank_charges">Cargos Bancarios</option>
              <option value="tax">Impuestos</option>
              <option value="payroll">Nómina</option>
              <option value="other">Otro</option>
            </select>
          </div>

          {/* Mode of Payment */}
          <div>
            <label className="block text-sm font-black text-gray-700 mb-2">Modo de Pago</label>
            <div className="relative">
              <input
                type="text"
                value={formData.mode_of_payment}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, mode_of_payment: e.target.value }))
                  searchModeOfPayment(e.target.value)
                }}
                onFocus={() => setShowModeOfPaymentDropdown(true)}
                onBlur={() => setTimeout(() => setShowModeOfPaymentDropdown(false), 200)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Buscar modo de pago"
              />
              {showModeOfPaymentDropdown && modeOfPaymentResults.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto">
                  {modeOfPaymentResults.map((mode) => (
                    <div
                      key={mode.name}
                      onClick={() => selectModeOfPayment(mode)}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                    >
                      {mode.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Direction y Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-black text-gray-700 mb-2">Dirección</label>
              <select
                value={formData.direction}
                onChange={(e) => setFormData(prev => ({ ...prev, direction: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Seleccionar...</option>
                <option value="In">Entrada</option>
                <option value="Out">Salida</option>
                <option value="Both">Ambos</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-black text-gray-700 mb-2">Prioridad</label>
              <input
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
            </div>
          </div>
        </div>

        {/* Botones */}
        <div className="flex justify-end space-x-4 mt-8 pt-6 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all duration-300"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-secondary"
            disabled={saving}
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Guardando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Guardar
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default ExpenseMappingModal
