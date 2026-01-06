import React, { useState, useEffect, useContext, useRef } from 'react'
import { AuthContext } from '../../AuthProvider'
import { NotificationContext } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import { Bell, CheckCircle, XCircle, AlertCircle, Clock, X } from 'lucide-react'
import { createPortal } from 'react-dom'

const NotificationPanel = ({ isOpen, onClose, notificationsCount, onToggle, buttonRef, onNotificationClick }) => {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)

  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const panelRef = useRef(null)

  // Calcular posición del dropdown
  useEffect(() => {
    if (isOpen && buttonRef?.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left
      })
    }
  }, [isOpen, buttonRef])

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target) && buttonRef.current && !buttonRef.current.contains(event.target)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      loadNotifications() // Cargar notificaciones cuando se abre
    }

    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose, buttonRef])

  const loadNotifications = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(API_ROUTES.notifications)
      if (response.ok) {
        const data = await response.json()
        setNotifications(data.data || [])
        setUnreadCount(data.unread_count || 0)
      } else {
        showNotification('Error al cargar notificaciones', 'error')
      }
    } catch (error) {
      console.error('Error loading notifications:', error)
      showNotification('Error al cargar notificaciones', 'error')
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (notificationId) => {
    console.log(`[FRONTEND] Marcando notificación ${notificationId} como leída`);
    try {
      const response = await fetchWithAuth(`${API_ROUTES.notifications}/${notificationId}/read`, {
        method: 'POST'
      });
      console.log(`[FRONTEND] Respuesta del servidor: ${response.status}`);
      if (response.ok) {
        const result = await response.json();
        console.log(`[FRONTEND] Resultado:`, result);
        // Actualizar el estado local
        setNotifications(prev => {
          const updated = prev.map(notif =>
            notif.id === notificationId ? { ...notif, read: true } : notif
          );
          console.log(`[FRONTEND] Notificaciones actualizadas:`, updated);
          return updated;
        });
        setUnreadCount(prev => {
          const newCount = Math.max(0, prev - 1);
          console.log(`[FRONTEND] Nuevo contador de no leídas: ${newCount}`);
          return newCount;
        });
      } else {
        console.error(`[FRONTEND] Error en respuesta: ${response.status} - ${response.statusText}`);
      }
    } catch (error) {
      console.error('[FRONTEND] Error marking notification as read:', error);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'partially successful':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />
      default:
        return <Clock className="w-4 h-4 text-blue-500" />
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'border-green-200 bg-green-50'
      case 'error':
        return 'border-red-200 bg-red-50'
      case 'partially successful':
        return 'border-yellow-200 bg-yellow-50'
      default:
        return 'border-blue-200 bg-blue-50'
    }
  }

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    return date.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (!isOpen) return null

  return createPortal(
    <div
      ref={panelRef}
      className="fixed w-96 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 z-[2147483647] max-h-96 overflow-hidden"
      style={{
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200/50">
        <div
          className="flex items-center gap-3 cursor-pointer hover:bg-gray-50/70 rounded-lg p-2 -m-2 transition-colors"
          onClick={() => {
            onClose() // Cerrar el panel
            if (onNotificationClick) {
              onNotificationClick(null) // Ir a la página general sin notificación específica
            }
          }}
        >
          <div className="p-2 bg-blue-100 rounded-lg">
            <Bell className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">Notificaciones</h3>
            <p className="text-xs text-gray-600">
              {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todas leídas'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <Bell className="w-8 h-8 text-gray-300 mb-3" />
            <h4 className="text-sm font-medium text-gray-900 mb-1">No hay notificaciones</h4>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-3 hover:bg-gray-50/70 transition-colors cursor-pointer ${
                  !notification.read ? 'bg-blue-50/30' : ''
                }`}
                onClick={() => {
                  if (!notification.read) {
                    markAsRead(notification.id)
                  }
                  onClose() // Cerrar el panel
                  if (onNotificationClick) {
                    onNotificationClick(notification) // Pasar la notificación completa
                  }
                }}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 mt-0.5">
                    {getStatusIcon(notification.status)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <h4 className="text-xs font-semibold text-gray-900 truncate">
                        {notification.title}
                      </h4>
                      {!notification.read && (
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0 mt-0.5"></div>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 mt-0.5">
                      {notification.message}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="p-3 border-t border-gray-200/50 bg-gray-50/50">
          <button
            onClick={loadNotifications}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Bell className="w-3 h-3" />
            Actualizar
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}

export default NotificationPanel