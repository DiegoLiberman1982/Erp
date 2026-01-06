import React, {useEffect, useState, useContext, useCallback} from 'react'
import AuthProvider, { AuthContext } from './AuthProvider'
import { NotificationProvider, useNotification } from './contexts/NotificationContext'
import Login from './Login'
import UpdatePassword from './components/UpdatePassword'
import CustomerForm from './CustomerForm'
import Header from './layout/Header'
import Sidebar from './layout/Sidebar'
import Main from './layout/Main'

function LoggedApp(){
  const [view, setView] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [customers, setCustomers] = useState([])
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [setupCompleted, setSetupCompleted] = useState(false)
  const [selectedNotification, setSelectedNotification] = useState(null)
  const { fetchWithAuth, hasFeatureAccess = () => true } = useContext(AuthContext)
  const { showError } = useNotification()

  useEffect(()=>{
    // Ya no cargamos clientes al inicio - se hace en CustomerPanel con paginación
    // para mejor rendimiento y evitar errores 500 con muchos clientes
  },[])

  // Verificar si la configuración inicial está completa
  useEffect(() => {
    const checkSetupStatus = async () => {
      try {
        const response = await fetchWithAuth('/api/active-company')
        if (response.ok) {
          const data = await response.json()
          // Si hay una compañía activa, la configuración está completa
          setSetupCompleted(data.success && data.data && data.data.active_company)
        }
      } catch (error) {
        console.error('Error checking setup status:', error)
        setSetupCompleted(false)
      }
    }

    checkSetupStatus()
  }, [fetchWithAuth])

  const handleViewChange = useCallback((nextView) => {
    if (!hasFeatureAccess(nextView)) {
      showError('No tenés permisos para acceder a esta sección')
      return
    }
    setView(nextView)
  }, [hasFeatureAccess, showError])

  useEffect(() => {
    const handleOpenImportStockManagement = () => {
      if (!hasFeatureAccess('import')) {
        showError('No ten‚s permisos para acceder a esta secci¢n')
        return
      }
      setView('import')
      setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent('openImportSection', { detail: { section: 'items' } }))
          window.dispatchEvent(new CustomEvent('openItemImportMode', { detail: { mode: 'stock' } }))
        } catch (err) {
          try {
            const ev1 = document.createEvent('CustomEvent')
            ev1.initCustomEvent('openImportSection', true, true, { section: 'items' })
            window.dispatchEvent(ev1)
          } catch (e1) {}
          try {
            const ev2 = document.createEvent('CustomEvent')
            ev2.initCustomEvent('openItemImportMode', true, true, { mode: 'stock' })
            window.dispatchEvent(ev2)
          } catch (e2) {}
        }
      }, 200)
    }

    window.addEventListener('openImportStockManagement', handleOpenImportStockManagement)
    return () => {
      window.removeEventListener('openImportStockManagement', handleOpenImportStockManagement)
    }
  }, [hasFeatureAccess, showError])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200" style={{fontFamily:'Inter, system-ui, sans-serif'}}>
      <Header
        onToggleSidebar={()=>setSidebarOpen(!sidebarOpen)}
        onOpenUserProfile={() => handleViewChange('user-profile')}
        onOpenNotifications={(notification) => {
          setSelectedNotification(notification)
          handleViewChange('notifications')
        }}
        onOpenSettings={() => handleViewChange('system-settings')}
      />

      <div className="flex">
        <Sidebar view={view} setView={handleViewChange} sidebarOpen={sidebarOpen} onToggleSidebar={()=>setSidebarOpen(!sidebarOpen)} setupCompleted={setupCompleted} />
        <Main view={view} setView={handleViewChange} sidebarOpen={sidebarOpen} onCollapseSidebar={() => setSidebarOpen(false)} selectedNotification={selectedNotification} />
      </div>
    </div>
  )
}

// login component moved to src/Login.jsx

function App(){
  return (
    <NotificationProvider>
      <AuthProvider>
        <InnerApp />
      </AuthProvider>
    </NotificationProvider>
  )
}

function InnerApp(){
  const { isAuthenticated, loading } = useContext(AuthContext)
  const [isPasswordReset, setIsPasswordReset] = useState(false)

  useEffect(() => {
    // Check if this is a password reset URL
    const urlParams = new URLSearchParams(window.location.search)
    const hash = window.location.hash
    const resetKey = urlParams.get('key')
    
    if (resetKey || hash === '#update-password') {
      setIsPasswordReset(true)
    }
  }, [])

  // Show password reset page if key parameter is present (without AuthProvider)
  if (isPasswordReset) {
    return (
      <NotificationProvider>
        <UpdatePassword onClose={() => setIsPasswordReset(false)} />
      </NotificationProvider>
    )
  }

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          <p className="mt-4 text-gray-600 font-medium">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) return <Login />
  return <LoggedApp />
}

export default App
