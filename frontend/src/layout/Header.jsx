import React, { useEffect, useState, useContext, useRef } from 'react'
/* Lines 2-7 omitted */
import NotificationPanel from '../components/Notificaciones/NotificationPanel'
import { createPortal } from 'react-dom'
import { AuthContext } from '../AuthProvider'
import { useNotification } from '../contexts/NotificationContext'
import { Package, Bell, Settings, User, LogOut, Menu, Shield, UserCog, Server } from 'lucide-react'
import { useAdminInfo } from '../hooks/useAdminInfo'

export default function Header({ onToggleSidebar, onOpenUserProfile, onOpenNotifications, onOpenSettings = () => {} }){
  const { fetchWithAuth, logout, user, isAuthenticated, activeCompany, getActiveCompany, setActiveCompanyForUser, clearActiveCompany, availableCompanies, companiesLoading, loadAvailableCompanies, refreshCompanies, hasFeatureAccess = () => true } = useContext(AuthContext)
  const { showInfo, showError } = useNotification()
  const [username, setUsername] = useState('Usuario')
  const [showNotifications, setShowNotifications] = useState(false)
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [showCompanySelector, setShowCompanySelector] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const companySelectorRef = useRef(null)
  const notificationButtonRef = useRef(null)
  const [notifications, setNotifications] = useState([])
  const [notificationsCount, setNotificationsCount] = useState(0)
  const [loadingNotifications, setLoadingNotifications] = useState(false)
  
  // Hook para información de admin
  const { 
    adminInfo, 
    loading: adminLoading, 
    getUsersForImpersonation,
    startImpersonation,
    stopImpersonation,
    getTenantInfo
  } = useAdminInfo()
  // Safely format tenant label (tenant may be an object)
  const tenantLabel = adminInfo && adminInfo.tenant
    ? (typeof adminInfo.tenant === 'string'
        ? adminInfo.tenant
        : (adminInfo.tenant.name || adminInfo.tenant.schema || JSON.stringify(adminInfo.tenant)))
    : 'Sistema Principal (public)'
  // Safely format user label
  const safeText = (v) => {
    if (v == null) return ''
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (typeof v === 'object') {
      return v.username || v.name || v.email || JSON.stringify(v)
    }
    return String(v)
  }
  const userLabel = adminInfo && adminInfo.user ? safeText(adminInfo.user) : username

  // Función para cargar notificaciones
  const loadNotifications = async () => {
    if (!isAuthenticated || !hasFeatureAccess('notifications')) return

    setLoadingNotifications(true)
    try {
      const response = await fetchWithAuth('/api/notifications')
      if (response.ok) {
        const data = await response.json()
        setNotifications(data.data || [])
        setNotificationsCount(data.unread_count || 0)
      }
    } catch (error) {
      console.error('Error loading notifications:', error)
    } finally {
      setLoadingNotifications(false)
    }
  }

  // Función para cambiar la empresa activa
  const handleCompanyChange = async (companyName) => {
    console.log('handleCompanyChange called with:', companyName);
    try {
      console.log('Calling setActiveCompanyForUser...');
      const success = await setActiveCompanyForUser(companyName)
      console.log('setActiveCompanyForUser result:', success);
      if (success) {
        setShowCompanySelector(false)
        // Refrescar la página para evitar datos de otra compañía
        window.location.reload()
      }
    } catch (error) {
      console.error('Error cambiando empresa activa:', error)
    }
  }

  // Función para limpiar la empresa activa
  const handleClearActiveCompany = async () => {
    try {
      const success = await clearActiveCompany()
      if (success) {
        setShowCompanySelector(false)
        // Refrescar la página para evitar datos de otra compañía
        window.location.reload()
      }
    } catch (error) {
      console.error('Error limpiando empresa activa:', error)
    }
  }

  const doLogout = async ()=>{
    // Call server logout to clear session cookie, then clear local tokens and reload
    try{ await logout() }catch(e){}
  }

  // useEffect para actualizar el nombre de usuario
  useEffect(() => {
    console.log('🔍 HEADER: useEffect triggered - isAuthenticated:', isAuthenticated, 'user:', user);
    if (isAuthenticated && user) {
      setUsername(user.username || user.email || 'Usuario')
      // Cargar notificaciones iniciales
      loadNotifications()
    } else {
      setUsername('Usuario')
      setNotifications([])
      setNotificationsCount(0)
    }

  }, [isAuthenticated, user])

  useEffect(() => {
    if (!hasFeatureAccess('notifications')) {
      setShowNotifications(false)
    }
  }, [hasFeatureAccess])


  // useEffect para recargar notificaciones periódicamente
  useEffect(() => {
    if (!isAuthenticated) return

    const interval = setInterval(() => {
      loadNotifications()
    }, 30000) // Cada 30 segundos

    return () => clearInterval(interval)
  }, [isAuthenticated])

  // useEffect para cargar empresas disponibles y manejar lógica de una sola empresa
  useEffect(() => {
    if (availableCompanies.length === 1 && !activeCompany) {
      // Si hay una sola empresa y no hay empresa activa, activarla automáticamente
      const singleCompany = availableCompanies[0]
      handleCompanyChange(singleCompany.name)
    }
  }, [availableCompanies, activeCompany])

  // useEffect para cerrar selector si hay una sola empresa
  useEffect(() => {
    if (showCompanySelector && availableCompanies.length === 1) {
      setShowCompanySelector(false)
    }
  }, [availableCompanies, showCompanySelector])

  // useEffect para calcular la posición del dropdown
  useEffect(() => {
    const updatePosition = () => {
      if (companySelectorRef.current) {
        const rect = companySelectorRef.current.getBoundingClientRect()
        setDropdownPosition({
          top: rect.bottom + 8,
          left: rect.left
        })
      }
    }

    if (showCompanySelector) {
      updatePosition()
    }

    // Update position on window resize
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [showCompanySelector])

  // useEffect para cerrar dropdowns al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Para el selector de empresa, verificar tanto el contenedor como el portal
      const companySelector = event.target.closest('.company-selector');
      const companyDropdown = event.target.closest('.company-dropdown');
      
      if (!companySelector && !companyDropdown) {
        setShowCompanySelector(false);
      }
      
      // Para el panel de admin
      if (!event.target.closest('.admin-panel')) {
        setShowAdminPanel(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="header-wrapper">
      <div className="header-gradient-elegant backdrop-blur-xl border-b border-gray-200/50 shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-5">
          <div className="flex items-center">
            <button 
              onClick={onToggleSidebar}
              className="p-4 text-white/80 hover:text-white hover:bg-white/20 rounded-2xl mr-4 transition-all duration-300 hover:shadow-xl hover:scale-110 transform hover:-translate-y-1 border border-white/20 hover:border-white/40 lg:hidden"
            >
              <Menu className="w-6 h-6" />
            </button>
            
            <div className="flex-shrink-0">
              <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-2xl shadow-black/20 border border-white/30">
                <Package className="w-8 h-8 text-white" />
              </div>
            </div>
            <div className="ml-5">
              <h1 className="text-3xl font-black bg-gradient-to-r from-white via-white to-white bg-clip-text text-transparent">Flowint</h1>
              <p className="text-sm text-white/80 font-medium">ERP inteligente</p>
            </div>
          </div>

          <div className="flex items-center space-x-5">
            {/* Company Selector */}
            {hasFeatureAccess('company-switcher') && (
            <div className="relative company-selector" ref={companySelectorRef}>
              <button
                onClick={() => {
                  if (availableCompanies.length > 1) {
                    setShowCompanySelector(!showCompanySelector)
                  } else if (availableCompanies.length === 0) {
                    loadAvailableCompanies()
                    setShowCompanySelector(true)
                  }
                }}
                className={`hidden sm:flex items-center text-sm text-white/90 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-full transition-all duration-300 hover:shadow-lg backdrop-blur-sm border border-white/20 hover:border-white/40 ${
                  availableCompanies.length !== 1 ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                <span className="font-bold text-white">{activeCompany || 'Empresa (seleccione)'}</span>
                <div className="w-2.5 h-2.5 bg-white/80 rounded-full animate-pulse ml-3 shadow-lg shadow-white/40"></div>
                {/* Solo mostrar el icono de dropdown si hay más de una empresa */}
                {availableCompanies.length > 1 && (
                  <svg className="w-4 h-4 ml-2 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>

              {showCompanySelector && (availableCompanies.length > 0 || companiesLoading) && 
                createPortal(
                  <div 
                    className="fixed w-80 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl py-2 z-[2147483647] border border-white/20 max-h-96 overflow-y-auto company-dropdown"
                    style={{
                      top: `${dropdownPosition.top}px`,
                      left: `${dropdownPosition.left}px`
                    }}
                  >
                    <div className="py-2">
                      {companiesLoading ? (
                        <div className="px-5 py-3 text-sm text-gray-500 text-center">
                          Cargando empresas...
                        </div>
                      ) : availableCompanies.length === 0 ? (
                        <div className="px-5 py-3 text-sm text-gray-500 text-center">
                          No hay empresas disponibles
                        </div>
                      ) : (
                        <>
                          {availableCompanies.map((company) => (
                            <button
                              key={company.name}
                              onClick={() => handleCompanyChange(company.name)}
                              className={`w-full px-5 py-3 text-left text-sm hover:bg-gray-50/70 transition-colors duration-200 flex items-center justify-between ${
                                activeCompany === company.name ? 'bg-blue-50/70 text-blue-700' : 'text-gray-700'
                              }`}
                            >
                              <div>
                                <div className="font-medium">{company.name}</div>
                                <div className="text-xs text-gray-500">
                                  {company.company_name || company.name}
                                </div>
                              </div>
                              {activeCompany === company.name && (
                                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              )}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>,
                  document.body
                )
              }
            </div>
            )}

            {/* Admin Panel - Solo mostrar si es admin */}
            {adminInfo && adminInfo.user && adminInfo.user.is_staff && (
              <div className="relative admin-panel">
                <button
                  onClick={() => setShowAdminPanel(!showAdminPanel)}
                  className="flex items-center space-x-2 px-4 py-2 text-sm font-bold text-white bg-white/20 hover:bg-white/30 rounded-xl transition-all duration-300 hover:shadow-lg hover:scale-105 border border-white/20 hover:border-white/40 backdrop-blur-sm"
                >
                  <Shield className="w-4 h-4" />
                  <span>Admin</span>
                  <span className="text-xs bg-white/30 text-white px-2 py-1 rounded-full backdrop-blur-sm">
                    {userLabel}
                  </span>
                </button>
                
                {showAdminPanel && (
                  <div className="absolute right-0 mt-3 w-80 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl py-2 z-50 border border-gray-200/50">
                    <div className="px-5 py-4 border-b border-gray-200/50">
                      <div className="text-sm font-bold text-gray-900">Panel de Administrador</div>
                      <div className="text-xs text-gray-600 mt-1">
                        Usuario: <span className="font-semibold">{adminInfo.user.username}</span>
                      </div>
                      <div className="text-xs text-gray-600">
                        Tenant: <span className="font-semibold">{tenantLabel}</span>
                      </div>
                    </div>
                    
                    <div className="py-2">
                      <button 
                        onClick={() => window.open('/admin/', '_blank')}
                        className="w-full px-5 py-3 text-left text-sm text-gray-700 hover:bg-gray-50/70 transition-colors duration-200 flex items-center space-x-3"
                      >
                        <Settings className="w-4 h-4" />
                        <span className="font-semibold">🔧 Ir al Admin de Django</span>
                      </button>
                      
                      <button 
                        onClick={async () => {
                          try {
                            const users = await getUsersForImpersonation();
                            console.log('Usuarios disponibles:', users);
                            showInfo('Función de impersonación - Ver consola para usuarios disponibles', 7000);
                          } catch (error) {
                            console.error('Error al obtener usuarios:', error);
                            showError('Error al obtener usuarios para impersonación');
                          }
                        }}
                        className="w-full px-5 py-3 text-left text-sm text-gray-700 hover:bg-gray-50/70 transition-colors duration-200 flex items-center space-x-3"
                      >
                        <UserCog className="w-4 h-4" />
                        <span className="font-semibold">👤 Impersonar Usuarios</span>
                      </button>
                      
                      <button 
                        onClick={async () => {
                          try {
                            const tenantInfo = await getTenantInfo();
                            console.log('Información del tenant:', tenantInfo);
                            showInfo('Información del tenant - Ver consola para detalles', 7000);
                          } catch (error) {
                            console.error('Error al obtener info del tenant:', error);
                            showError('Error al obtener información del tenant');
                          }
                        }}
                        className="w-full px-5 py-3 text-left text-sm text-gray-700 hover:bg-gray-50/70 transition-colors duration-200 flex items-center space-x-3"
                      >
                        <Server className="w-4 h-4" />
                        <span className="font-semibold">🏢 Info del Tenant</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasFeatureAccess('notifications') && (
            <div className="relative">
              <button
                ref={notificationButtonRef}
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-4 text-white/80 hover:text-white hover:bg-white/20 rounded-2xl relative transition-all duration-300 hover:shadow-xl hover:scale-110 transform hover:-translate-y-1 border border-white/20 hover:border-white/40"
              >
                <Bell className="w-6 h-6" />
                {notificationsCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-6 h-6 bg-white text-gray-900 text-xs rounded-full flex items-center justify-center shadow-lg font-bold border-2 border-gray-900/20">
                    {notificationsCount}
                  </span>
                )}
              </button>
            </div>
            )}

            {hasFeatureAccess('header-settings') && (
            <button 
              onClick={onOpenSettings}
              className="p-4 text-white/80 hover:text-white hover:bg-white/20 rounded-2xl transition-all duration-300 hover:shadow-xl hover:scale-110 transform hover:-translate-y-1 border border-white/20 hover:border-white/40">
              <Settings className="w-6 h-6" />
            </button>
            )}

            <button 
              onClick={onOpenUserProfile}
              className="p-4 text-white/80 hover:text-white hover:bg-white/20 rounded-2xl transition-all duration-300 hover:shadow-xl hover:scale-110 transform hover:-translate-y-1 border border-white/20 hover:border-white/40"
            >
              <User className="w-6 h-6" />
            </button>

            <button 
              onClick={doLogout}
              className="p-4 text-white/80 hover:text-red-400 hover:bg-red-500/20 rounded-2xl transition-all duration-300 hover:shadow-xl hover:scale-110 transform hover:-translate-y-1 border border-white/20 hover:border-red-400/50"
            >
              <LogOut className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
      </div>

      {/* Notification Panel */}
      {hasFeatureAccess('notifications') && (
        <NotificationPanel
          isOpen={showNotifications}
          onClose={() => setShowNotifications(false)}
          notificationsCount={notificationsCount}
          onToggle={() => setShowNotifications(!showNotifications)}
          buttonRef={notificationButtonRef}
          onNotificationClick={onOpenNotifications}
        />
      )}
    </div>
  )
}
