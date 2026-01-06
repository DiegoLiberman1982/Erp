import React, { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', type = 'warning' }) => {
  const [isExiting, setIsExiting] = useState(false)

  const handleClose = () => {
    setIsExiting(true)
    setTimeout(() => {
      onClose()
      setIsExiting(false)
    }, 300)
  }

  const handleConfirm = () => {
    onConfirm()
    handleClose()
  }

  if (!isOpen) return null

  const getIcon = () => {
    switch (type) {
      case 'error':
        return <AlertTriangle className="w-6 h-6 text-red-500" />
      case 'success':
        return <AlertTriangle className="w-6 h-6 text-green-500" />
      case 'info':
        return <AlertTriangle className="w-6 h-6 text-blue-500" />
      default:
        return <AlertTriangle className="w-6 h-6 text-yellow-500" />
    }
  }

  const confirmVariantClass = () => {
    if (type === 'error') return 'error'
    if (type === 'success') return 'success'
    return 'warning'
  }

  return (
    <div className="confirm-modal-overlay">
      <div className={`confirm-modal-content ${isExiting ? 'exiting' : ''}`}>
        <div className="confirm-modal-header">
          <div className="confirm-modal-title-section">
            {getIcon()}
            <h3 className="confirm-modal-title">{title}</h3>
          </div>
          <button
            onClick={handleClose}
            className="confirm-modal-close-btn"
            aria-label="Cerrar"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="confirm-modal-body">
          <p className="confirm-modal-message">{message}</p>
        </div>

        <div className="confirm-modal-footer">
          <button
            onClick={handleClose}
            className="confirm-modal-btn-cancel"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={`confirm-modal-btn-confirm ${confirmVariantClass()}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
