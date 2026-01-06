import React, { createContext, useContext, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

const NotificationContext = createContext();

export { NotificationContext };

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const showNotification = (message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random();
    const notification = { id, message, type, duration };
    
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        removeNotification(id);
      }, duration);
    }
    
    return id;
  };

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const showSuccess = (message, duration = 5000) => showNotification(message, 'success', duration);
  const showError = (message, duration = 5000) => showNotification(message, 'error', duration);
  const showWarning = (message, duration = 5000) => showNotification(message, 'warning', duration);
  const showInfo = (message, duration = 5000) => showNotification(message, 'info', duration);

  const NotificationContainer = () => (
    <>
      {notifications.map(notification => (
        <Notification
          key={notification.id}
          notification={notification}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </>
  );

  const value = {
    showNotification,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    removeNotification
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationContainer />
    </NotificationContext.Provider>
  );
};

const Notification = ({ notification, onClose }) => {
  const [isExiting, setIsExiting] = useState(false);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getStyles = () => {
    const baseStyles = "fixed z-[2147483647] max-w-sm w-full bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border p-4 transition-all duration-300 transform";
    
    // Position notifications from top-right, stacking them
    // For now using fixed positioning, can be enhanced later with dynamic stacking
    
    switch (notification.type) {
      case 'success':
        return `${baseStyles} border-green-200/50 top-4 right-4`;
      case 'error':
        return `${baseStyles} border-red-200/50 top-4 right-4`;
      case 'warning':
        return `${baseStyles} border-yellow-200/50 top-4 right-4`;
      default:
        return `${baseStyles} border-blue-200/50 top-4 right-4`;
    }
  };

  return (
    <div className={`${getStyles()} ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}`}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          {getIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {notification.message}
          </p>
        </div>
        <div className="flex-shrink-0">
          <button
            onClick={handleClose}
            className="inline-flex text-gray-400 hover:text-gray-600 transition-colors duration-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
