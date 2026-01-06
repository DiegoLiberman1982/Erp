import React, { useState, useContext, useCallback, useEffect } from 'react'
import { AlertTriangle, Lock, Calendar, TrendingUp, CheckCircle2, XCircle } from 'lucide-react'
import Modal from '../Modal'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'

/**
 * Modal para cerrar un mes específico de una cuenta bancaria
 * Valida que los saldos coincidan antes de permitir el cierre
 */
export default function MonthClosureModal({ 
  isOpen, 
  onClose, 
  accountName, 
  availableMonths = [],
  onMonthClosed 
}) {
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [monthBalances, setMonthBalances] = useState(null)
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [closing, setClosing] = useState(false)
  const { fetchWithAuth } = useContext(AuthContext)
  const { showError, showSuccess, showWarning } = useNotification()

  // Resetear estado cuando cambia el mes seleccionado
  useEffect(() => {
    setMonthBalances(null)
  }, [selectedMonth])

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '$0.00'
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2
    }).format(value)
  }

  const formatMonthName = (month) => {
    const months = {
      1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
      5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
      9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre'
    }
    return months[month] || `Mes ${month}`
  }

  // Obtener saldos del mes seleccionado
  const fetchMonthBalances = useCallback(async () => {
    if (!selectedMonth) return

    setLoadingBalances(true)
    try {
      const response = await fetchWithAuth('/api/month-closure/month-balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_name: accountName,
          year: selectedMonth.year,
          month: selectedMonth.month
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error obteniendo saldos del mes')
      }

      const data = await response.json()
      if (data.success) {
        setMonthBalances(data)
      } else {
        throw new Error(data.message || 'Error en respuesta del servidor')
      }
    } catch (error) {
      console.error('Error fetching month balances:', error)
      showError(`Error obteniendo saldos: ${error.message}`)
      setMonthBalances(null)
    } finally {
      setLoadingBalances(false)
    }
  }, [selectedMonth, accountName, fetchWithAuth, showError])

  // Cargar saldos cuando se selecciona un mes
  useEffect(() => {
    if (selectedMonth) {
      fetchMonthBalances()
    }
  }, [selectedMonth, fetchMonthBalances])

  const handleMonthSelect = (month) => {
    setSelectedMonth({
      year: month.year,
      month: month.month,
      month_name: formatMonthName(month.month),
      last_day: month.last_day
    })
  }

  const handleCloseMonth = async () => {
    if (!selectedMonth || !monthBalances) return

    // Verificar que los saldos coincidan
    if (!monthBalances.balances_match) {
      showWarning('Los saldos no coinciden. No se puede cerrar el mes.')
      return
    }

    setClosing(true)
    try {
      const response = await fetchWithAuth('/api/month-closure/close-month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_name: accountName,
          year: selectedMonth.year,
          month: selectedMonth.month
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error cerrando mes')
      }

      const data = await response.json()
      if (data.success) {
        showSuccess(data.message || 'Mes cerrado exitosamente')
        if (onMonthClosed) {
          onMonthClosed()
        }
        onClose()
      } else {
        throw new Error(data.message || 'Error en respuesta del servidor')
      }
    } catch (error) {
      console.error('Error closing month:', error)
      showError(`Error cerrando mes: ${error.message}`)
    } finally {
      setClosing(false)
    }
  }

  const balanceDifference = monthBalances ? Math.abs(monthBalances.accounting_balance - monthBalances.bank_balance) : 0
  const balancesMatch = monthBalances?.balances_match || false

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cerrar Mes"
      subtitle={`Cuenta: ${accountName}`}
      size="md"
    >
      <div className="space-y-4">
        {/* Selección de Mes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Seleccionar Mes a Cerrar
          </label>
          
          {availableMonths.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
              {availableMonths.map((month) => (
                <button
                  key={`${month.year}-${month.month}`}
                  onClick={() => handleMonthSelect(month)}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    selectedMonth?.year === month.year && selectedMonth?.month === month.month
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span className="font-medium text-sm text-gray-900">
                      {formatMonthName(month.month)} {month.year}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{month.last_day}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-500">No hay meses disponibles para cerrar</p>
              <p className="text-xs text-gray-400 mt-1">
                Todos los meses con movimientos ya están cerrados
              </p>
            </div>
          )}
        </div>

        {/* Saldos del Mes Seleccionado */}
        {selectedMonth && (
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">
              Saldos al {selectedMonth.last_day}
            </h4>

            {loadingBalances ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : monthBalances ? (
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-blue-700">Saldo Contable</span>
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                  </div>
                  <p className="text-lg font-bold text-blue-900">
                    {formatCurrency(monthBalances.accounting_balance)}
                  </p>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-green-700">Saldo Bank Transactions</span>
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  </div>
                  <p className="text-lg font-bold text-green-900">
                    {formatCurrency(monthBalances.bank_balance)}
                  </p>
                </div>

                {/* Estado de Coincidencia */}
                {balancesMatch ? (
                  <div className="bg-green-50 border-2 border-green-500 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="text-sm font-semibold text-green-900">
                          Los saldos coinciden
                        </p>
                        <p className="text-xs text-green-700">
                          Puede proceder a cerrar el mes
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-red-50 border-2 border-red-500 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <XCircle className="w-5 h-5 text-red-600" />
                      <div>
                        <p className="text-sm font-semibold text-red-900">
                          Los saldos NO coinciden
                        </p>
                        <p className="text-xs text-red-700">
                          Diferencia: {formatCurrency(balanceDifference)}
                        </p>
                      </div>
                    </div>
                    <div className="bg-red-100 rounded p-2 mt-2">
                      <p className="text-xs text-red-800">
                        <AlertTriangle className="w-3 h-3 inline mr-1" />
                        No se puede cerrar el mes hasta que los saldos coincidan
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500">Seleccione un mes para ver los saldos</p>
              </div>
            )}
          </div>
        )}

        {/* Advertencia */}
        {selectedMonth && balancesMatch && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-900 mb-1">
                  Advertencia: Acción Irreversible
                </p>
                <p className="text-xs text-amber-800">
                  Al cerrar este mes, no se podrán crear ni modificar movimientos con fecha
                  igual o anterior al <strong>{selectedMonth.last_day}</strong>.
                  Esta acción requiere permisos especiales para ser revertida.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Botones */}
        <div className="flex gap-3 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="confirm-modal-btn-cancel flex-1"
            disabled={closing}
          >
            Cancelar
          </button>
          <button
            onClick={handleCloseMonth}
            disabled={!selectedMonth || !balancesMatch || closing || loadingBalances}
            className={`confirm-modal-btn-confirm flex-1 flex items-center justify-center gap-2 ${
              !selectedMonth || !balancesMatch ? 'opacity-50 cursor-not-allowed' : 'error'
            }`}
          >
            {closing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Cerrando...
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                Cerrar Mes
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
