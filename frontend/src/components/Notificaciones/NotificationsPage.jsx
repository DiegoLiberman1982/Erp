import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { AuthContext } from '../../AuthProvider';
import { useNotification } from '../../contexts/NotificationContext';
import { Bell, CheckCircle, XCircle, AlertCircle, Clock, ArrowLeft, Check, X, Filter } from 'lucide-react';

const NotificationsPage = ({ onClose, selectedNotification }) => {
  console.log('🔍 FRONTEND: NotificationsPage component mounted/updated');

  const { fetchWithAuth } = useContext(AuthContext);
  const { showInfo, showError } = useNotification();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // all, unread, read
  const [selectedNotificationDetail, setSelectedNotificationDetail] = useState(selectedNotification || null);
  const [notificationDetails, setNotificationDetails] = useState({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const notificationDetailsRef = useRef(notificationDetails);

  useEffect(() => {
    notificationDetailsRef.current = notificationDetails;
  }, [notificationDetails]);

  // Cargar notificaciones
  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth('/api/notifications');
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.data || []);
      } else {
        showError('Error al cargar notificaciones');
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
      showError('Error al cargar notificaciones');
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId) => {
    console.log(`[FRONTEND] NotificationsPage - Marcando notificación ${notificationId} como leída`);
    try {
      const response = await fetchWithAuth(`/api/notifications/${notificationId}/read`, {
        method: 'POST'
      });
      console.log(`[FRONTEND] NotificationsPage - Respuesta del servidor: ${response.status}`);
      if (response.ok) {
        const result = await response.json();
        console.log(`[FRONTEND] NotificationsPage - Resultado:`, result);
        // Actualizar el estado local
        setNotifications(prev => {
          const updated = prev.map(notif =>
            notif.id === notificationId ? { ...notif, read: true } : notif
          );
          console.log(`[FRONTEND] NotificationsPage - Notificaciones actualizadas:`, updated);
          return updated;
        });
        showInfo('Notificación marcada como leída');
      } else {
        console.error(`[FRONTEND] NotificationsPage - Error en respuesta: ${response.status} - ${response.statusText}`);
        showError('Error al marcar notificación como leída');
      }
    } catch (error) {
      console.error('[FRONTEND] NotificationsPage - Error marking notification as read:', error);
      showError('Error al marcar notificación como leída');
    }
  };

  const markAllAsRead = async () => {
    try {
      // Marcar todas las notificaciones no leídas como leídas
      const unreadNotifications = notifications.filter(n => !n.read);
      for (const notification of unreadNotifications) {
        await markAsRead(notification.id);
      }
      showInfo('Todas las notificaciones marcadas como leídas');
    } catch (error) {
      showError('Error al marcar todas las notificaciones como leídas');
    }
  };

  const loadNotificationDetails = useCallback(async (notificationId) => {
    if (!notificationId || notificationDetailsRef.current[notificationId]) {
      return; // Ya cargados o selección inválida
    }

    setLoadingDetails(true);
    try {
      const response = await fetchWithAuth(`/api/notifications/${notificationId}/details`);
      if (response.ok) {
        const data = await response.json();
        setNotificationDetails(prev => ({
          ...prev,
          [notificationId]: data.details
        }));
      } else {
        showError('Error al cargar detalles de la notificación');
      }
    } catch (error) {
      console.error('Error loading notification details:', error);
      showError('Error al cargar detalles de la notificación');
    } finally {
      setLoadingDetails(false);
    }
  }, [fetchWithAuth, showError]);

  useEffect(() => {
    if (selectedNotificationDetail) {
      loadNotificationDetails(selectedNotificationDetail.id);
    }
  }, [selectedNotificationDetail, loadNotificationDetails]);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'partially successful':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      default:
        return <Clock className="w-5 h-5 text-blue-500" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'border-green-200 bg-green-50';
      case 'error':
        return 'border-red-200 bg-red-50';
      case 'partially successful':
        return 'border-yellow-200 bg-yellow-50';
      default:
        return 'border-blue-200 bg-blue-50';
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString('es-AR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Filtrar notificaciones
  const filteredNotifications = notifications.filter(notification => {
    if (filter === 'unread') return !notification.read;
    if (filter === 'read') return notification.read;
    return true;
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="h-full flex flex-col gap-6">
      {/* Main Content */}
      <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200/50">
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
              title="Volver"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Bell className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900">Centro de Notificaciones</h1>
              <p className="text-sm text-gray-600 font-medium">
                {unreadCount > 0 ? `${unreadCount} notificaciones sin leer` : 'Todas las notificaciones leídas'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Filtros */}
            <div className="flex items-center space-x-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">Todas</option>
                <option value="unread">Sin leer</option>
                <option value="read">Leídas</option>
              </select>
            </div>

            {/* Marcar todas como leídas */}
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
              >
                <Check className="w-4 h-4 mr-2" />
                Marcar todas como leídas
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600 font-medium">Cargando notificaciones...</p>
              </div>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bell className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {filter === 'all' ? 'No hay notificaciones' :
                 filter === 'unread' ? 'No hay notificaciones sin leer' :
                 'No hay notificaciones leídas'}
              </h3>
              <p className="text-gray-500 text-center">
                {filter === 'all' ? 'Las notificaciones de importaciones aparecerán aquí.' :
                 filter === 'unread' ? 'Todas las notificaciones han sido leídas.' :
                 'No hay notificaciones leídas aún.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`border rounded-2xl p-6 transition-all duration-300 hover:shadow-lg cursor-pointer ${
                    selectedNotificationDetail?.id === notification.id
                      ? 'ring-2 ring-blue-500 shadow-lg'
                      : getStatusColor(notification.status)
                  } ${!notification.read ? 'border-l-4 border-l-blue-500' : ''}`}
                  onClick={() => {
                    const newSelected = selectedNotificationDetail?.id === notification.id ? null : notification;
                    setSelectedNotificationDetail(newSelected);
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4 flex-1">
                      <div className="flex-shrink-0">
                        {getStatusIcon(notification.status)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-1">
                              {notification.title}
                            </h3>
                            <p className="text-gray-700 mb-3">
                              {notification.message}
                            </p>
                            <div className="flex items-center space-x-4 text-sm text-gray-500">
                              <span>{formatTimestamp(notification.timestamp)}</span>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                notification.status === 'completed' ? 'bg-green-100 text-green-800' :
                                notification.status === 'error' ? 'bg-red-100 text-red-800' :
                                notification.status === 'partially successful' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {notification.status === 'completed' ? 'Completado' :
                                 notification.status === 'error' ? 'Error' :
                                 notification.status === 'partially successful' ? 'Parcial' :
                                 'En proceso'}
                              </span>
                            </div>
                          </div>
                          {!notification.read && (
                            <div className="flex-shrink-0">
                              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Detalles expandidos cuando está seleccionado */}
                  {selectedNotificationDetail?.id === notification.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-gray-50 rounded-lg p-4">
                          <h4 className="text-sm font-bold text-gray-900 mb-2">Detalles de la Importación</h4>
                          {loadingDetails ? (
                            <div className="flex items-center justify-center py-4">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                            </div>
                          ) : notificationDetails[notification.id] ? (
                            <div className="space-y-2 text-sm">
                              <div><span className="font-medium">ID:</span> {notificationDetails[notification.id].import_name}</div>
                              <div><span className="font-medium">Tipo:</span> {notificationDetails[notification.id].import_type || 'N/A'}</div>
                              <div><span className="font-medium">Estado:</span> {notificationDetails[notification.id].status}</div>
                              <div><span className="font-medium">Doctype:</span> {notificationDetails[notification.id].reference_doctype || 'N/A'}</div>
                              <div><span className="font-medium">Total filas:</span> {notificationDetails[notification.id].total_rows || 0}</div>
                              <div><span className="font-medium">Exitosos:</span> {notificationDetails[notification.id].successful_imports || 0}</div>
                              <div><span className="font-medium">Fallidos:</span> {notificationDetails[notification.id].failed_imports || 0}</div>
                              <div><span className="font-medium">Payload count:</span> {notificationDetails[notification.id].payload_count || 0}</div>
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">Cargando detalles...</div>
                          )}
                        </div>
                        <div className="bg-gray-50 rounded-lg p-4">
                          <h4 className="text-sm font-bold text-gray-900 mb-2">Fechas</h4>
                          <div className="space-y-2 text-sm">
                            <div><span className="font-medium">Creado:</span> {notification.details?.creation ? new Date(notification.details.creation).toLocaleString('es-AR') : 'N/A'}</div>
                            <div><span className="font-medium">Modificado:</span> {notification.details?.modified ? new Date(notification.details.modified).toLocaleString('es-AR') : 'N/A'}</div>
                          </div>
                          {notificationDetails[notification.id]?.errors && notificationDetails[notification.id].errors.length > 0 && (
                            <div className="mt-4">
                              <h4 className="text-sm font-bold text-gray-900 mb-2">Errores</h4>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {notificationDetails[notification.id].errors.map((error, index) => (
                                  <div key={index} className="text-xs bg-red-50 p-2 rounded border-l-2 border-red-200">
                                    <div><strong>Fila {error.row_index}:</strong> {error.error_message}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {notificationDetails[notification.id]?.template_warnings && notificationDetails[notification.id].template_warnings.length > 0 && (
                            <div className="mt-4">
                              <h4 className="text-sm font-bold text-gray-900 mb-2">Advertencias</h4>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {notificationDetails[notification.id].template_warnings.map((warning, index) => (
                                  <div key={index} className="text-xs bg-yellow-50 p-2 rounded border-l-2 border-yellow-200">
                                    {warning}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <h4 className="text-sm font-bold text-gray-900 mb-2 mt-4">Acciones</h4>
                          <div className="space-y-2">
                            {!notification.read && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsRead(notification.id);
                                }}
                                className="w-full inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                              >
                                <Check className="w-4 h-4 mr-2" />
                                Marcar como leída
                              </button>
                            )}
                            <button
                              onClick={() => setSelectedNotificationDetail(null)}
                              className="w-full inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                            >
                              <X className="w-4 h-4 mr-2" />
                              Cerrar detalles
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationsPage;
