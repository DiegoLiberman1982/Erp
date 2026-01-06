import React, { useState, useContext, useEffect } from 'react'
import { Mail, Plus, Edit, Trash2, Info } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import { useConfirm } from '../../hooks/useConfirm'
import EmailAccountModal from './modals/EmailAccountModal'

const EmailConfiguration = ({ onOpenEmailAccountModal, refreshTrigger }) => {
  const [emailAccounts, setEmailAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification, showSuccess, showError, showWarning, showInfo } = useNotification()
  const { confirm, ConfirmDialog } = useConfirm()

  // Cargar cuentas de email al montar el componente
  useEffect(() => {
    fetchEmailAccounts()
  }, [])

  // Refrescar cuando cambie el trigger
  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchEmailAccounts()
    }
  }, [refreshTrigger])

  const fetchEmailAccounts = async () => {
    try {
      setLoading(true)
      const response = await fetchWithAuth('/api/communications/email-accounts')

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setEmailAccounts(data.data || [])
        } else {
          showError(data.message || 'Error al cargar cuentas de email')
        }
      } else {
        showError('Error al cargar cuentas de email')
      }
    } catch (error) {
      console.error('Error fetching email accounts:', error)
      showError('Error al cargar cuentas de email')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteEmailAccount = async (emailAccount) => {
    const confirmed = await confirm(
      'Eliminar cuenta de email',
      `¿Estás seguro de que quieres eliminar la cuenta "${emailAccount.email_account_name}"?`,
      'error'
    )

    if (!confirmed) return

    try {
      const response = await fetchWithAuth(`/api/communications/email-accounts/${emailAccount.name}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showSuccess(data.message || 'Cuenta de email eliminada exitosamente')
          fetchEmailAccounts()
        } else {
          showError(data.message || 'Error al eliminar cuenta de email')
        }
      } else {
        showError('Error al eliminar cuenta de email')
      }
    } catch (error) {
      console.error('Error deleting email account:', error)
      showError('Error al eliminar cuenta de email')
    }
  }

  const getServiceIcon = (service) => {
    const icons = {
      'GMail': '📧',
      'Outlook': '📧',
      'Yahoo': '📧',
      'Custom': '⚙️'
    }
    return icons[service] || '📧'
  }

  const getStatusBadge = (account) => {
    if (account.default_outgoing) {
      return <span className="badge badge-success">Predeterminado</span>
    }
    if (account.enable_outgoing) {
      return <span className="badge">Activo</span>
    }
    return <span className="badge-pendientes">Inactivo</span>
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Mail className="w-8 h-8 text-blue-600" />
            Configuración de Email
          </h2>
          <p className="text-gray-600 mt-1">
            Configura las cuentas de email para envío de notificaciones y comunicaciones
          </p>
        </div>
        <button
          onClick={() => onOpenEmailAccountModal()}
          className="btn-action-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Nueva Cuenta
        </button>
      </div>

      {/* Lista de cuentas de email */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Cuentas de Email Configuradas
          </h3>

          {emailAccounts.length === 0 ? (
            <div className="text-center py-12">
              <Mail className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h4 className="text-lg font-medium text-gray-900 mb-2">
                No hay cuentas de email configuradas
              </h4>
              <p className="text-gray-600 mb-4">
                Crea tu primera cuenta de email para poder enviar notificaciones
              </p>
              <button
                onClick={() => onOpenEmailAccountModal()}
                className="btn-action-primary"
              >
                Configurar primera cuenta
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {emailAccounts.map((account) => (
                <div
                  key={account.name}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="text-2xl">
                      {getServiceIcon(account.service)}
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900">
                        {account.email_account_name}
                      </h4>
                      <p className="text-sm text-gray-600">
                        {account.email_id}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {getStatusBadge(account)}
                        <span className="text-xs text-gray-500">
                          {account.service}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenEmailAccountModal(account)}
                      className="p-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteEmailAccount(account)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Información de ayuda */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <h4 className="font-medium text-blue-900 mb-2">
              Configuración de Gmail
            </h4>
            <div className="text-sm text-blue-800 space-y-2">
              <p>
                <strong>App Password:</strong> Para Gmail, no uses tu contraseña normal.
                Crea una "App Password" en Google Account → Security → 2-Step Verification → App Passwords.
              </p>
              <p>
                <strong>Configuración automática:</strong> Selecciona "GMail" como servicio y el sistema
                configurará automáticamente el servidor SMTP.
              </p>
              <p>
                <strong>Email predeterminado:</strong> Marca solo una cuenta como "Predeterminado"
                para envío de emails del sistema.
              </p>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog />
    </div>
  )
}

export default EmailConfiguration