import React, { useState, useEffect, useContext } from 'react'
import { X, AlertTriangle, DollarSign, Calendar, FileText, Building2 } from 'lucide-react'
import { AuthContext } from '../../../AuthProvider'
import { NotificationContext } from '../../../contexts/NotificationContext'
import Modal from '../../Modal'



const UnpaidMovementModal = ({
  isOpen,
  onClose,
  onSave,
  mode = 'MANUAL',
  selectedBankTransactions = [],
  bankAccount = null,
  variant = 'generic'
}) => {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification, showSuccess, showError } = useContext(NotificationContext)

  // Estados principales
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  
  // Estados para cuentas bancarias
  const [treasuryAccounts, setTreasuryAccounts] = useState([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  // Estado del formulario
  const [formData, setFormData] = useState({
    bank_account: bankAccount || '',
    posting_date: new Date().toISOString().split('T')[0],
    amount: '0.00',
    contra_cuenta: '',
    party_type: '',
    party: ''
  })

  // Calcular valores derivados cuando está en modo BANCO
  const bankModeCalculations = React.useMemo(() => {
    if (mode !== 'BANCO' || !selectedBankTransactions.length) {
      return { totalDeposit: 0, totalWithdrawal: 0, netAmount: 0, hasMixedTransactions: false }
    }

    const totalDeposit = selectedBankTransactions.reduce((sum, t) => sum + (parseFloat(t.deposit) || 0), 0)
    const totalWithdrawal = selectedBankTransactions.reduce((sum, t) => sum + (parseFloat(t.withdrawal) || 0), 0)
    const netAmount = totalDeposit - totalWithdrawal
    const hasMixedTransactions = totalDeposit > 0 && totalWithdrawal > 0

    return { totalDeposit, totalWithdrawal, netAmount, hasMixedTransactions }
  }, [mode, selectedBankTransactions])

  // Cargar datos iniciales solo cuando se abre el modal por primera vez
  useEffect(() => {
    if (!isOpen) return

    // Solo cargar cuentas si no las tenemos ya
    if (treasuryAccounts.length === 0) {
      loadTreasuryAccounts()
    }

    if (mode === 'BANCO' && selectedBankTransactions.length > 0) {
      // Calcular valores directamente aquí para evitar dependencias del useMemo
      const totalDeposit = selectedBankTransactions.reduce((sum, t) => sum + (parseFloat(t.deposit) || 0), 0)
      const totalWithdrawal = selectedBankTransactions.reduce((sum, t) => sum + (parseFloat(t.withdrawal) || 0), 0)
      const netAmount = totalDeposit - totalWithdrawal
      
      setFormData(prev => ({
        ...prev,
        amount: Math.abs(netAmount).toFixed(2),
        bank_account: bankAccount || prev.bank_account,
        posting_date: selectedBankTransactions[0]?.date || prev.posting_date
      }))
    } else {
      // Reset para modo MANUAL
      setFormData({
        bank_account: bankAccount || '',
        posting_date: new Date().toISOString().split('T')[0],
        amount: '0.00',
        contra_cuenta: '',
        party_type: '',
        party: ''
      })
    }
  }, [isOpen, mode, selectedBankTransactions, bankAccount])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      await Promise.all([
        loadTreasuryAccounts()
      ])
    } catch (error) {
      showError('Error al cargar datos iniciales')
    } finally {
      setLoading(false)
    }
  }

  

  const loadTreasuryAccounts = async () => {
    // Evitar llamadas duplicadas si ya tenemos cuentas
    if (treasuryAccounts.length > 0) return
    
    setLoadingAccounts(true)
    try {
      const response = await fetchWithAuth('/api/treasury-accounts', {
        method: 'GET',
        headers: { 'X-Active-Company': activeCompany }
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setTreasuryAccounts(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error loading treasury accounts:', error)
    } finally {
      setLoadingAccounts(false)
    }
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleAmountChange = (value) => {
    // Solo permitir en modo MANUAL
    if (mode === 'MANUAL') {
      setFormData(prev => ({ ...prev, amount: value }))
    }
  }

  const handleAmountBlur = () => {
    const numValue = parseFloat(formData.amount) || 0
    setFormData(prev => ({ ...prev, amount: numValue.toFixed(2) }))
  }

  const validateForm = () => {
    const errors = []
    if (!formData.bank_account) {
      errors.push('Debe seleccionar cuenta bancaria')
    }

    if (variant === 'cash_exchange') {
      if (!formData.contra_cuenta) {
        errors.push('Debe seleccionar una cuenta contrapartida')
      } else if (formData.contra_cuenta === formData.bank_account) {
        errors.push('La cuenta contrapartida debe ser distinta de la cuenta seleccionada')
      }
    }

    const amount = parseFloat(formData.amount) || 0
    if (amount <= 0) {
      errors.push('El importe debe ser mayor a cero')
    }

    if (mode === 'BANCO' && selectedBankTransactions.length === 0) {
      errors.push('No hay movimientos bancarios seleccionados')
    }

    if (!formData.posting_date) {
      errors.push('Debe indicar la fecha')
    }

    return errors
  }

  const handleSave = async () => {
    const errors = validateForm()
    if (errors.length > 0) {
      showError(errors.join(', '))
      return
    }

    setSaving(true)
    try {
      const selectedAccount = treasuryAccounts.find(acc => acc.name === formData.bank_account)
      const selectedContraAccount = treasuryAccounts.find(acc => acc.name === formData.contra_cuenta)
      const payload = {
        mode,
        variant,
        ...formData,
        bank_account_docname: selectedAccount?.bank_account_id || null,
        bank_account_display_name: selectedAccount?.account_name || null,
        contra_account_docname: selectedContraAccount?.bank_account_id || null,
        contra_account_display_name: selectedContraAccount?.account_name || null,
        selected_bank_transactions: mode === 'BANCO' ? selectedBankTransactions.map(t => ({
          name: t.name,
          deposit: t.deposit || 0,
          withdrawal: t.withdrawal || 0,
          date: t.date,
          reference_number: t.reference_number || t.transaction_id || ''
        })) : []
      }

      const response = await fetchWithAuth('/api/unpaid-movements/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Active-Company': activeCompany
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al crear movimiento')
      }

      const result = await response.json()
      if (result.success) {
        showSuccess(mode === 'BANCO' 
          ? `Movimiento creado y conciliado: ${result.payment_name}`
          : `Movimiento creado: ${result.payment_name}`
        )
        
        if (onSave) {
          onSave(result)
        }
        
        onClose()
      } else {
        throw new Error(result.message || 'Error desconocido')
      }
    } catch (error) {
      console.error('Error saving unpaid movement:', error)
      showError(error.message || 'Error al guardar movimiento')
    } finally {
      setSaving(false)
    }
  }

  const canConfirm = () => {
    const amount = parseFloat(formData.amount) || 0
    if (variant === 'cash_exchange') {
      return amount > 0 && formData.bank_account && formData.contra_cuenta && formData.contra_cuenta !== formData.bank_account
    }
    return amount > 0 && formData.bank_account
  }

  const modalTitle = React.useMemo(() => {
    if (variant === 'cash_exchange') {
      return 'Canje entre cajas'
    }
    return mode === 'BANCO' ? 'Convertir a Comprobantes Internos' : 'Comprobantes Internos'
  }, [mode, variant])

  if (!isOpen) return null

  const { netAmount, hasMixedTransactions } = bankModeCalculations
  const isAmountReadOnly = mode === 'BANCO'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="large"
    >
      <div className="space-y-6 p-6">
        {/* Alertas de modo BANCO */}
        {mode === 'BANCO' && (
          <div className="space-y-3">
            {hasMixedTransactions && (
              <div className="flex items-start gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-yellow-800">
                  <strong>Selección mixta:</strong> Hay depósitos y retiros. Se procesará por importe neto.
                </div>
              </div>
            )}
            
            {/* Modo conciliación info removed as requested */}

            {netAmount === 0 && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-800">
                  <strong>Importe neto cero:</strong> No se puede procesar. Los depósitos y retiros se anulan entre sí.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Formulario */}
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando datos...</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {/* (Tipo de movimiento y categoría eliminados — no aplican en canje) */}

            {/* Cuenta Bancaria */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cuenta Bancaria *
              </label>
              <select
                value={formData.bank_account}
                onChange={(e) => handleInputChange('bank_account', e.target.value)}
                disabled={mode === 'BANCO'}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent ${
                  mode === 'BANCO' ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
              >
                <option value="">Seleccionar cuenta...</option>
                {treasuryAccounts.map(acc => (
                  <option key={acc.id} value={acc.name}>
                    {acc.display_name || acc.account_name || acc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Fecha */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha *
              </label>
              <input
                type="date"
                value={formData.posting_date}
                onChange={(e) => handleInputChange('posting_date', e.target.value)}
                disabled={mode === 'BANCO' || variant === 'cash_exchange'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>

            {/* Importe */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Importe *
                {isAmountReadOnly && (
                  <span className="text-xs text-gray-500 font-normal">(calculado automáticamente)</span>
                )}
              </label>
              <input
                type="text"
                value={formData.amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                onBlur={handleAmountBlur}
                readOnly={isAmountReadOnly}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent text-right font-mono ${
                  isAmountReadOnly ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
                placeholder="0.00"
              />
            </div>

            {/* Contra Cuenta (opcional) */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cuenta Contrapartida {variant === 'cash_exchange' ? '*' : ''}
              </label>
              {variant === 'cash_exchange' ? (
                <select
                  value={formData.contra_cuenta}
                  onChange={(e) => handleInputChange('contra_cuenta', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                >
                  <option value="">Seleccionar cuenta contrapartida...</option>
                  {treasuryAccounts
                    .filter(acc => acc.name !== formData.bank_account)
                    .map(acc => (
                      <option key={acc.id} value={acc.name}>
                        {acc.display_name || acc.account_name || acc.name}
                      </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={formData.contra_cuenta}
                  onChange={(e) => handleInputChange('contra_cuenta', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  placeholder="Cuenta contrapartida (opcional)"
                />
              )}
            </div>

            {/* Observaciones eliminadas para canje entre cajas */}
          </div>
        )}

        {/* Acciones */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canConfirm() || loading}
            className="btn-secondary flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Procesando...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                {mode === 'BANCO' ? 'Crear y Conciliar' : 'Crear Movimiento'}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default UnpaidMovementModal
