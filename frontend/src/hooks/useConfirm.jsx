import { useState } from 'react'
import ConfirmModal from '../components/modals/ConfirmModal'

export const useConfirm = () => {
  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    type: 'warning'
  })

  const confirm = (...args) => {
    // Accept usages:
    // - confirm({ title, message, ... })
    // - confirm(title, message, type, onConfirm, onCancel, confirmText, cancelText)
    // - convenience shorthand: confirm(title, onConfirm)
    let options = {}
    if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'function') {
      // Shorthand: confirm(title, onConfirm)
      options = { title: args[0], message: '', onConfirm: args[1] }
    } else if (args.length === 1 && typeof args[0] === 'object') {
      options = args[0]
    } else {
      const [title, message, type = 'warning', onConfirm, onCancel, confirmText = 'Confirmar', cancelText = 'Cancelar'] = args
      options = { title, message, type, onConfirm, onCancel, confirmText, cancelText }
    }

    const {
      title,
      message,
      onConfirm = () => {},
      onCancel = () => {},
      confirmText = 'Confirmar',
      cancelText = 'Cancelar',
      type = 'warning'
    } = options

    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        title: title || '',
        message: message || '',
        onConfirm: () => {
          if (typeof onConfirm === 'function') {
            onConfirm()
          }
          resolve(true)
        },
        onCancel: () => {
          if (typeof onCancel === 'function') {
            onCancel()
          }
          resolve(false)
        },
        confirmText,
        cancelText,
        type
      })
    })
  }

  const closeConfirm = () => {
    setConfirmState(prev => ({ ...prev, isOpen: false }))
  }

  const ConfirmDialog = () => (
    <ConfirmModal
      isOpen={confirmState.isOpen}
      onClose={closeConfirm}
      onConfirm={confirmState.onConfirm}
      title={confirmState.title}
      message={confirmState.message}
      confirmText={confirmState.confirmText}
      cancelText={confirmState.cancelText}
      type={confirmState.type}
    />
  )

  return {
    confirm,
    ConfirmDialog
  }
}