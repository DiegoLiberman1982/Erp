import React, { useState, useEffect, useContext, useCallback } from 'react'
import { Lock, Unlock, Calendar, TrendingUp, Loader2 } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import MonthClosureModal from './MonthClosureModal'

/**
 * Panel de resumen y cierre mensual de cuenta bancaria
 * Muestra saldos y permite cerrar períodos mensuales
 */
export default function MonthClosurePanel({ selectedAccountId, selectedAccountName, onMonthClosed }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification, showError, showSuccess } = useNotification()

  // Cargar resumen de la cuenta
  const fetchAccountSummary = useCallback(async () => {
    if (!selectedAccountId || !selectedAccountName) {
      setSummary(null)
      return
    }

    setLoading(true)
    try {
      const response = await fetchWithAuth(
        `/api/month-closure/account-summary/${encodeURIComponent(selectedAccountName)}`
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error cargando resumen de cuenta')
      }

      const data = await response.json()
      if (data.success) {
        setSummary(data)
      } else {
        throw new Error(data.message || 'Error en respuesta del servidor')
      }
    } catch (error) {
      console.error('Error fetching account summary:', error)
      showError(`Error cargando resumen: ${error.message}`)
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, selectedAccountName, fetchWithAuth, showError])

  // Recargar cuando cambia la cuenta seleccionada
  useEffect(() => {
    fetchAccountSummary()
  }, [fetchAccountSummary])

  const handleOpenModal = () => {
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleMonthClosed = async () => {
    setIsModalOpen(false)
    showSuccess('Mes cerrado exitosamente')
    // Recargar resumen
    await fetchAccountSummary()
    // Notificar al componente padre
    if (onMonthClosed) {
      onMonthClosed()
    }
  }

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

  if (!selectedAccountId) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 h-full flex items-center justify-center">
        <div className="text-center text-gray-500">
          <Calendar className="w-12 h-12 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">Seleccione una cuenta para ver el resumen</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 h-full flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p className="text-sm">No se pudo cargar el resumen</p>
        </div>
      </div>
    )
  }

  const balanceDifference = Math.abs(summary.accounting_balance - summary.bank_balance)
  const balancesMatch = balanceDifference < 0.01

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-lg p-4 h-full flex flex-col">
        {/* Header */}
        <div className="mb-4 pb-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Resumen de Cuenta</h3>
          <p className="text-xs text-gray-500 truncate" title={summary.account_name}>
            {summary.account_name}
          </p>
        </div>

        {/* Saldos */}
        <div className="space-y-3 mb-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-blue-700">Saldo Contable</span>
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-lg font-bold text-blue-900">
              {formatCurrency(summary.accounting_balance)}
            </p>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-green-700">Saldo Bank Transactions</span>
              <TrendingUp className="w-4 h-4 text-green-600" />
            </div>
            <p className="text-lg font-bold text-green-900">
              {formatCurrency(summary.bank_balance)}
            </p>
          </div>

          {!balancesMatch && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
              <p className="text-xs text-amber-700">
                <span className="font-semibold">Diferencia:</span> {formatCurrency(balanceDifference)}
              </p>
            </div>
          )}
        </div>

        {/* Botón Cerrar Mes */}
        <div className="mb-4">
          <button
            onClick={handleOpenModal}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <Lock className="w-4 h-4" />
            Cerrar Mes
          </button>
        </div>

        {/* Lista de Meses */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <h4 className="text-xs font-semibold text-gray-700 mb-2">Estado de Meses</h4>
          
          {summary.months && summary.months.length > 0 ? (
            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
              <div className="divide-y divide-gray-200">
                {summary.months.map((month) => (
                  <div
                    key={`${month.year}-${month.month}`}
                    className={`p-2 flex items-center justify-between hover:bg-gray-50 transition-colors ${
                      month.is_closed ? 'bg-gray-50' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {formatMonthName(month.month)} {month.year}
                      </p>
                      <p className="text-xs text-gray-500">{month.last_day}</p>
                    </div>
                    <div className="ml-2 flex-shrink-0">
                      {month.is_closed ? (
                        <div className="flex items-center gap-1 text-red-600">
                          <Lock className="w-4 h-4" />
                          <span className="text-xs font-medium">Cerrado</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-green-600">
                          <Unlock className="w-4 h-4" />
                          <span className="text-xs font-medium">Abierto</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 border border-gray-200 rounded-lg flex items-center justify-center">
              <p className="text-xs text-gray-500">No hay meses con movimientos</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Cierre de Mes */}
      {isModalOpen && (
        <MonthClosureModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          accountName={selectedAccountName}
          availableMonths={summary.months?.filter(m => !m.is_closed) || []}
          onMonthClosed={handleMonthClosed}
        />
      )}
    </>
  )
}
