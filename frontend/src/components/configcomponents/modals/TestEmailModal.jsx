import React, { useState } from 'react'
import { TestTube, Info } from 'lucide-react'
import Modal from '../../Modal'

const TestEmailModal = ({
  isOpen,
  onClose,
  emailAccount,
  onTest,
  testing
}) => {
  const [testEmail, setTestEmail] = useState('')

  const handleClose = () => {
    if (!testing) {
      setTestEmail('')
      onClose()
    }
  }

  const handleTest = async () => {
    if (!testEmail) {
      return
    }

    await onTest(testEmail)
    setTestEmail('')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Probar Configuración de Email"
      size="sm"
    >
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email de destino para la prueba
          </label>
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="tuemail@ejemplo.com"
          />
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p>
                Se enviará un email de prueba a la dirección especificada para verificar
                que la configuración funcione correctamente.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="btn-secondary"
            disabled={testing}
          >
            Cancelar
          </button>
          <button
            onClick={handleTest}
            className="btn-action-primary flex items-center gap-2"
            disabled={testing || !testEmail}
          >
            {testing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            {testing ? 'Enviando...' : 'Enviar Prueba'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default TestEmailModal