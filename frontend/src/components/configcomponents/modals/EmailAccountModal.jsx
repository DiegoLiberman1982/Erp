import React, { useState, useEffect } from 'react'
import { Save, X } from 'lucide-react'
import Modal from '../../Modal'

const EmailAccountModal = ({
  isOpen,
  onClose,
  editingEmailAccount,
  onSave,
  fetchWithAuth,
  showSuccess,
  showError
}) => {
  const [saving, setSaving] = useState(false)
  const [emailAccountsCount, setEmailAccountsCount] = useState(0)
  const [disableDefaultCheckbox, setDisableDefaultCheckbox] = useState(false)
  const [emailFormData, setEmailFormData] = useState({
    email_id: '',
    email_account_name: '',
    service: 'GMail',
    enable_outgoing: true,
    default_outgoing: false,
    login_id: '',
    password: '',
    smtp_server: '',
    smtp_port: 587,
    use_tls: true,
    email_sync_option: 'TODOS'
  })

  // Reset form when modal opens/closes or editing account changes
  useEffect(() => {
    if (isOpen) {
      // Al abrir el modal, cargar la cantidad de cuentas para decidir si se debe
      // deshabilitar la opción "default_outgoing" cuando solo exista una cuenta
      ;(async () => {
        try {
          if (fetchWithAuth) {
            const resp = await fetchWithAuth('/api/communications/email-accounts?fields=["name"]&limit_page_length=100')
            if (resp && resp.ok) {
              const json = await resp.json()
              const count = (json?.data || []).length
              setEmailAccountsCount(count)
              // Si estamos editando y solo hay 1 cuenta, forzamos predeterminado y deshabilitamos la casilla
              if (editingEmailAccount && count <= 1) {
                setDisableDefaultCheckbox(true)
              } else {
                setDisableDefaultCheckbox(false)
              }
            }
          }
        } catch (e) {
          console.error('Error fetching email accounts count:', e)
          setEmailAccountsCount(0)
          setDisableDefaultCheckbox(false)
        }
      })()

      if (editingEmailAccount) {
        setEmailFormData({
          email_id: editingEmailAccount.email_id || '',
          email_account_name: editingEmailAccount.email_account_name || '',
          service: editingEmailAccount.service || 'GMail',
          enable_outgoing: editingEmailAccount.enable_outgoing === 1,
          default_outgoing: editingEmailAccount.default_outgoing === 1,
          login_id: editingEmailAccount.login_id || '',
          password: '', // No mostrar password existente por seguridad
          smtp_server: editingEmailAccount.smtp_server || '',
          smtp_port: editingEmailAccount.smtp_port || 587,
          use_tls: editingEmailAccount.use_tls === 1,
          email_sync_option: editingEmailAccount.email_sync_option || 'TODOS'
        })
      } else {
        // Para nueva cuenta, inicializar con configuración SMTP por defecto para GMail
        const defaultSMTP = getSMTPSettings('GMail')
        setEmailFormData({
          email_id: '',
          email_account_name: '',
          service: 'GMail',
          enable_outgoing: true,
          default_outgoing: false,
          login_id: '',
          password: '',
          smtp_server: defaultSMTP.server,
          smtp_port: defaultSMTP.port,
          use_tls: defaultSMTP.use_tls,
          email_sync_option: 'TODOS'
        })
      }
    }
  }, [isOpen, editingEmailAccount])

  // Si deshabilitamos la casilla de default porque solo hay 1 cuenta, forzamos el valor en el formulario
  useEffect(() => {
    if (disableDefaultCheckbox) {
      setEmailFormData(prev => ({ ...prev, default_outgoing: true }))
    }
  }, [disableDefaultCheckbox])

  const handleEmailFormChange = (field, value) => {
    if (field === 'service') {
      // Cuando cambia el service, actualizar también la configuración SMTP
      const smtpSettings = getSMTPSettings(value)
      setEmailFormData(prev => ({
        ...prev,
        [field]: value,
        smtp_server: smtpSettings.server,
        smtp_port: smtpSettings.port,
        use_tls: smtpSettings.use_tls
      }))
    } else {
      setEmailFormData(prev => ({
        ...prev,
        [field]: value
      }))

      // Auto-fill login_id si es igual al email_id
      if (field === 'email_id' && !emailFormData.login_id) {
        setEmailFormData(prev => ({
          ...prev,
          login_id: value
        }))
      }
    }
  }

  const getSMTPSettings = (service) => {
    const settings = {
      'GMail': { server: 'smtp.gmail.com', port: 587, use_tls: true },
      'Outlook': { server: 'smtp-mail.outlook.com', port: 587, use_tls: true },
      'Yahoo': { server: 'smtp.mail.yahoo.com', port: 587, use_tls: true },
      'Custom': { server: '', port: 587, use_tls: true }
    }
    return settings[service] || settings['Custom']
  }

  const handleSaveEmailAccount = async () => {
    // Validación básica
    if (!emailFormData.email_id || !emailFormData.email_account_name) {
      showError('Email y nombre de cuenta son obligatorios')
      return
    }

    if (!emailFormData.password && !editingEmailAccount) {
      showError('La contraseña es obligatoria para nuevas cuentas')
      return
    }

    try {
      setSaving(true)

      const method = editingEmailAccount ? 'PUT' : 'POST'
      const url = editingEmailAccount
        ? `/api/communications/email-accounts/${editingEmailAccount.name}`
        : '/api/communications/email-accounts'

      const response = await fetchWithAuth(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...emailFormData,
          enable_outgoing: emailFormData.enable_outgoing ? 1 : 0,
          default_outgoing: disableDefaultCheckbox ? 1 : (emailFormData.default_outgoing ? 1 : 0),
          use_tls: emailFormData.use_tls ? 1 : 0
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showSuccess(data.message || `Cuenta de email ${editingEmailAccount ? 'actualizada' : 'creada'} exitosamente`)
          onClose()
          if (onSave) onSave()
        } else {
          showError(data.message || 'Error al guardar cuenta de email')
        }
      } else {
        showError('Error al guardar cuenta de email')
      }
    } catch (error) {
      console.error('Error saving email account:', error)
      showError('Error al guardar cuenta de email')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (!saving) {
      onClose()
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editingEmailAccount ? 'Editar Cuenta de Email' : 'Nueva Cuenta de Email'}
      size="md"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Email y Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email *
            </label>
            <input
              type="email"
              value={emailFormData.email_id}
              onChange={(e) => handleEmailFormChange('email_id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="noreply@tuempresa.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nombre de Cuenta *
            </label>
            <input
              type="text"
              value={emailFormData.email_account_name}
              onChange={(e) => handleEmailFormChange('email_account_name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Notificaciones"
            />
          </div>
        </div>

        {/* Servicio */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Servicio
          </label>
          <select
            value={emailFormData.service}
            onChange={(e) => handleEmailFormChange('service', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="GMail">GMail</option>
            <option value="Outlook">Outlook</option>
            <option value="Yahoo">Yahoo</option>
            <option value="Custom">Personalizado</option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Login ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Usuario/Login ID
            </label>
            <input
              type="text"
              value={emailFormData.login_id}
              onChange={(e) => handleEmailFormChange('login_id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="usuario@dominio.com"
            />
          </div>
          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contraseña {!editingEmailAccount && '*'}
            </label>
            <input
              type="password"
              value={emailFormData.password}
              onChange={(e) => handleEmailFormChange('password', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={editingEmailAccount ? "Dejar vacío para mantener actual" : "App Password para Gmail"}
            />
          </div>
        </div>

        {/* Configuración SMTP */}
        <div className="border-t pt-6">
          <h4 className="text-lg font-medium text-gray-900 mb-4">
            Configuración SMTP
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Servidor SMTP
              </label>
              <input
                type="text"
                value={emailFormData.smtp_server}
                onChange={(e) => handleEmailFormChange('smtp_server', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="smtp.gmail.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Puerto
              </label>
              <input
                type="number"
                value={emailFormData.smtp_port}
                onChange={(e) => handleEmailFormChange('smtp_port', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-center">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={emailFormData.use_tls}
                  onChange={(e) => handleEmailFormChange('use_tls', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Usar TLS</span>
              </label>
            </div>
          </div>
        </div>

        {/* Opciones */}
        <div className="border-t pt-6">
          <h4 className="text-lg font-medium text-gray-900 mb-4">
            Opciones
          </h4>
          <div className="space-y-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={emailFormData.enable_outgoing}
                onChange={(e) => handleEmailFormChange('enable_outgoing', e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">Habilitar envío de emails</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={emailFormData.default_outgoing || (disableDefaultCheckbox && true)}
                onChange={(e) => handleEmailFormChange('default_outgoing', e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                disabled={disableDefaultCheckbox}
              />
              <span className="ml-2 text-sm text-gray-700">Establecer como cuenta predeterminada</span>
              {disableDefaultCheckbox && (
                <span className="ml-3 text-xs text-gray-500">(No modificable: única cuenta configurada)</span>
              )}
            </label>
          </div>
        </div>

        {/* Botones */}
        <div className="flex justify-end gap-3 pt-6 border-t">
          <button
            onClick={handleClose}
            className="btn-secondary"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveEmailAccount}
            className="btn-action-primary flex items-center gap-2"
            disabled={saving}
          >
            {saving ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default EmailAccountModal