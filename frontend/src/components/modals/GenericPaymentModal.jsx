import React, { useState, useContext, useEffect } from 'react'
import { Save, Calendar, FileText, Trash2 } from 'lucide-react'
import Modal from '../Modal'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'
import API_ROUTES from '../../apiRoutes'

/**
 * Modal simple para visualizar y editar Payment Entries genéricos
 * (aquellos que no son pagos a proveedores ni cobros a clientes)
 * Como: canjes entre cuentas, pagos de sueldos, impuestos al débito bancario, etc.
 */
const GenericPaymentModal = ({
  isOpen,
  onClose,
  paymentData,
  onSave
}) => {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useNotification()
  const { confirm, ConfirmDialog } = useConfirm()

  const [loading, setLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    posting_date: '',
    remarks: '',
    paid_from: '',
    paid_to: '',
    paid_amount: 0,
    received_amount: 0
  })

  // Cargar datos al abrir el modal
  useEffect(() => {
    if (isOpen && paymentData) {
      setFormData({
        posting_date: paymentData.posting_date || '',
        remarks: paymentData.remarks || '',
        paid_from: paymentData.paid_from || '',
        paid_to: paymentData.paid_to || '',
        paid_amount: paymentData.paid_amount || 0,
        received_amount: paymentData.received_amount || 0
      })
      setIsEditing(false)
    }
  }, [isOpen, paymentData])

  const handleSave = async () => {
    if (!paymentData?.name) {
      showNotification('No se puede guardar: falta el identificador del pago', 'error')
      return
    }

    setLoading(true)
    try {
      const response = await fetchWithAuth(
        `${API_ROUTES.pagos}/${encodeURIComponent(paymentData.name)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            posting_date: formData.posting_date,
            remarks: formData.remarks,
            paid_from: formData.paid_from,
            paid_to: formData.paid_to,
            paid_amount: parseFloat(formData.paid_amount) || 0,
            received_amount: parseFloat(formData.received_amount) || 0
          })
        }
      )

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Pago actualizado correctamente', 'success')
          if (onSave) {
            onSave(data.data)
          }
          onClose()
        } else {
          showNotification(data.message || 'Error al actualizar el pago', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al actualizar el pago', 'error')
      }
    } catch (error) {
      console.error('Error saving payment:', error)
      showNotification('Error al guardar el pago', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!paymentData?.name) {
      showNotification('No se puede borrar: falta el identificador del pago', 'error')
      return
    }
    if (paymentData?.docstatus === 2) {
      showNotification('El pago ya está cancelado', 'info')
      return
    }

    const confirmed = await confirm({
      title: 'Confirmar cancelación',
      message: `¿Cancelar el pago ${paymentData.name}?\n\nEsta acción lo pasará a estado Cancelado (docstatus = 2).`,
      type: 'error',
      confirmText: 'Cancelar pago',
      cancelText: 'No'
    })
    if (!confirmed) return

    setLoading(true)
    try {
      showNotification(`Cancelando pago ${paymentData.name}...`, 'warning', 2500)
      const response = await fetchWithAuth(
        `${API_ROUTES.pagos}/${encodeURIComponent(paymentData.name)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            status: 'Cancelado'
          })
        }
      )

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification('Pago cancelado correctamente', 'success')
          if (onSave) {
            onSave({ ...paymentData, docstatus: 2 })
          }
          onClose()
        } else {
          showNotification(data.message || 'Error al cancelar el pago', 'error')
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al cancelar el pago', 'error')
      }
    } catch (error) {
      console.error('Error deleting payment:', error)
      showNotification('Error al cancelar el pago', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    // Restaurar datos originales
    if (paymentData) {
      setFormData({
        posting_date: paymentData.posting_date || '',
        remarks: paymentData.remarks || '',
        paid_from: paymentData.paid_from || '',
        paid_to: paymentData.paid_to || '',
        paid_amount: paymentData.paid_amount || 0,
        received_amount: paymentData.received_amount || 0
      })
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return ''
    const [year, month, day] = dateString.split('-')
    return `${day}-${month}-${year}`
  }

  const formatCurrency = (value) => {
    const num = parseFloat(value) || 0
    return `$${num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pago Genérico"
      subtitle={paymentData?.name || 'Detalles del pago'}
      size="md"
    >
      <div className="space-y-6">
        {/* Información básica */}
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fecha
              </label>
              {isEditing ? (
                <input
                  type="date"
                  value={formData.posting_date}
                  onChange={(e) => setFormData({ ...formData, posting_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              ) : (
                <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span className="text-gray-900 font-medium">
                      {formatDate(formData.posting_date)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Estado
              </label>
              <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold ${
                  paymentData?.docstatus === 1 
                    ? 'bg-green-100 text-green-800' 
                    : paymentData?.docstatus === 2
                    ? 'bg-red-100 text-red-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {paymentData?.docstatus === 1 ? 'Confirmado' : paymentData?.docstatus === 2 ? 'Cancelado' : 'Borrador'}
                </span>
              </div>
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Descripción
            </label>
            {isEditing ? (
              <textarea
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Descripción del pago..."
              />
            ) : (
              <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-gray-900 whitespace-pre-wrap">
                  {formData.remarks || 'Sin descripción'}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Cuentas y montos */}
        <section className="space-y-4">
          <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            Cuentas contables
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cuenta de origen (Paid From)
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={formData.paid_from}
                  onChange={(e) => setFormData({ ...formData, paid_from: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Cuenta de origen..."
                />
              ) : (
                <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-gray-900 text-sm">
                    {formData.paid_from || 'No especificada'}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cuenta de destino (Paid To)
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={formData.paid_to}
                  onChange={(e) => setFormData({ ...formData, paid_to: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Cuenta de destino..."
                />
              ) : (
                <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-gray-900 text-sm">
                    {formData.paid_to || 'No especificada'}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Monto pagado
              </label>
              <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-gray-900 font-semibold">
                  {formatCurrency(formData.paid_amount)}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Monto recibido
              </label>
              <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-gray-900 font-semibold">
                  {formatCurrency(formData.received_amount)}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Botones de acción */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-gray-200">
          {isEditing ? (
            <>
              <div />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all duration-200"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {loading ? (
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
            </>
          ) : (
            <>
              <div>
                {paymentData?.docstatus !== 2 && (
                  <button
                    onClick={handleDelete}
                    disabled={loading}
                    title="Cancelar pago"
                    className="inline-flex items-center justify-center w-10 h-10 border border-red-200 text-red-700 rounded-xl hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all duration-200"
                >
                  Cerrar
                </button>
                {paymentData?.docstatus !== 2 && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-200"
                  >
                    Editar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog />
    </Modal>
  )
}

export default GenericPaymentModal
