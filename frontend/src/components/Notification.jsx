import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

const Notification = ({
  message,
  type = 'info',
  duration = 5000,
  onClose,
  children = null,
  actions = null,
  variant = 'toast',
  hideCloseButton = false,
  className = ''
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose && onClose();
    }, 300);
  };

  if (!isVisible) return null;

  const getIcon = () => {
    switch (type) {
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
    const positionClasses = variant === 'toast' ? 'fixed top-4 right-4 z-[2147483647]' : 'relative w-full';
    const baseStyles = `${positionClasses} max-w-sm w-full bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 p-4 transition-all duration-300`;
    
    switch (type) {
      case 'success':
        return `${baseStyles} border-green-200/50`;
      case 'error':
        return `${baseStyles} border-red-200/50`;
      case 'warning':
        return `${baseStyles} border-yellow-200/50`;
      default:
        return `${baseStyles} border-blue-200/50`;
    }
  };

  const animationClass = () => {
    if (variant === 'toast') {
      return isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0';
    }
    return isExiting ? 'opacity-0 scale-95' : 'opacity-100 scale-100';
  };

  return (
    <div className={`${getStyles()} ${animationClass()} ${className}`}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          {getIcon()}
        </div>
        <div className="flex-1 min-w-0">
          {children ? (
            children
          ) : (
            <p className="text-sm font-medium text-gray-900">
              {message}
            </p>
          )}
        </div>
        {!hideCloseButton && (
          <div className="flex-shrink-0">
            <button
              onClick={handleClose}
              className="inline-flex text-gray-400 hover:text-gray-600 transition-colors duration-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      {actions && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {actions}
        </div>
      )}
    </div>
  );
};

// Hook personalizado para manejar notificaciones
export const useNotification = () => {
  const [notifications, setNotifications] = useState([]);

  const showNotification = (message, type = 'info', duration = 5000) => {
    const id = Date.now() + Math.random();
    const notification = { id, message, type, duration };
    
    setNotifications(prev => [...prev, notification]);
    
    return id;
  };

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const NotificationContainer = () => (
    <div className="fixed top-0 right-0 z-[2147483647] p-4 space-y-2">
      {notifications.map(notification => (
        <Notification
          key={notification.id}
          message={notification.message}
          type={notification.type}
          duration={notification.duration}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </div>
  );

  return {
    showNotification,
    removeNotification,
    NotificationContainer
  };
};

export default Notification;
