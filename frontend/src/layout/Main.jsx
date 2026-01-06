import React, { useEffect, useState, useContext, useMemo } from 'react'
import { AuthContext } from '../AuthProvider'
import API_ROUTES from '../apiRoutes'
import OrdersList from './OrdersList'
import Tabs from './Tabs'
import ConfigurationSettings from '../components/ConfigurationSettings'
import ExchangeRateWidget from '../components/dashboard/ExchangeRateWidget'
import SalesOrdersWidget from '../components/dashboard/SalesOrdersWidget'
import UserProfilePage from '../components/UserProfilePage'
import NotificationsPage from '../components/Notificaciones/NotificationsPage'
import CustomerPanel from '../components/CustomerPanel'
import SupplierPanel from '../components/SupplierPanel'
import AccountingPanel from '../components/AccountingPanel'
import FinancePanel from '../components/FinancePanel'
import InventoryPanel from '../components/InventoryPanel'
import ImportPanel from '../components/ImportPanel'
import ReportsPage from '../components/ReportsPage'
import SystemSettings from '../components/configcomponents/SystemSettings'

export default function Main({ view, setView, sidebarOpen, onCollapseSidebar, selectedNotification }){
  const [orders, setOrders] = useState([]) // Ensure orders is always an array
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('pendientes')
  const { fetchWithAuth, hasFeatureAccess = () => true } = useContext(AuthContext)
  const canView = useMemo(() => hasFeatureAccess(view), [hasFeatureAccess, view])

  // Fetch orders from API
  const fetchOrders = async () => {
    try {
      if (!API_ROUTES.orders) {
        // Backend no longer exposes orders endpoint: show empty list
        setOrders([])
        return
      }
      setLoading(true)
      setError(null)
      const response = await fetchWithAuth('/api/orders/')
      if (response.ok) {
        const data = await response.json()
        // Ensure data is always an array
        setOrders(Array.isArray(data) ? data : [])
      } else {
        throw new Error(`Failed to fetch orders: ${response.status}`)
      }
    } catch (err) {
      console.error('Error fetching orders:', err)
      setError(err.message)
      setOrders([]) // Set empty array on error
    } finally {
      setLoading(false)
    }
  }

  // Fetch customers from API
  const fetchCustomers = async () => {
    // This function is now handled by CustomerManagement component
  }

  // Load data on component mount and when view changes
  useEffect(() => {
    if (view === 'dashboard' && hasFeatureAccess('dashboard')) {
      fetchOrders()
    }
  }, [view, hasFeatureAccess])

  if (!canView) {
    return (
      <main className="flex-1 p-8">
        <div className="max-w-3xl mx-auto bg-white/80 rounded-3xl border border-red-100 shadow-lg p-10 text-center">
          <div className="text-2xl font-black text-red-600 mb-4">Acceso restringido</div>
          <p className="text-gray-600">
            No tenés permisos para abrir <span className="font-semibold">{view}</span>. Pedile a un administrador que te asigne los roles necesarios.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 p-8">
      {view==='dashboard' && (
        <div className="max-w-7xl mx-auto">
          {/* Loading state */}
          {loading && (
            <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-gray-200/30 p-8">
              <div className="flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mr-4"></div>
                <div className="text-xl font-bold text-gray-900">Cargando pedidos...</div>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-red-200/50 p-8 mb-6">
              <div className="text-center">
                <div className="text-lg font-bold text-red-800 mb-4">Error al cargar pedidos</div>
                <div className="text-sm text-red-700 mb-4">{error}</div>
                <button 
                  onClick={fetchOrders}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
                >
                  Reintentar
                </button>
              </div>
            </div>
          )}

          {/* Content when not loading: show chart placeholders (no counts/table) */}
          {!loading && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 my-6">
                <div className="col-span-1 sm:col-span-2 lg:col-span-1">
                  <ExchangeRateWidget />
                </div>
                <div className="col-span-1">
                    <SalesOrdersWidget onOpenCustomer={(customerName, orderName) => {
                      setView('customers')
                      // give the customers panel a moment to mount, then dispatch event
                      setTimeout(() => {
                        try {
                          window.dispatchEvent(new CustomEvent('openCustomerWithOrder', { detail: { customerName, orderName } }))
                        } catch (err) {
                          // fallback for older browsers
                          const ev = document.createEvent('CustomEvent')
                          ev.initCustomEvent('openCustomerWithOrder', true, true, { customerName, orderName })
                          window.dispatchEvent(ev)
                        }
                      }, 150)
                    }} />
                  </div>
                <div className="p-6 bg-white/80 rounded-2xl shadow-lg border border-gray-200/40">
                  <div className="text-sm font-black text-gray-800 mb-2"></div>
                  <div className="h-40 bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg flex items-center justify-center text-gray-400">Placeholder gráfico</div>
                </div>
              </div>

              <div className="mt-6">

                <OrdersList 
                  orders={orders}
                  activeTab={activeTab}
                  onOrderUpdate={fetchOrders}
                />
              </div>
            </>
          )}
        </div>
      )}

      {view==='customers' && (
        <CustomerPanel />
      )}

      {view==='orders' && (
        <SupplierPanel />
      )}

      {view==='finance' && (
        <FinancePanel />
      )}

      {view==='accounting' && (
        <AccountingPanel />
      )}

      {view==='inventory' && (
        <InventoryPanel />
      )}

      {view==='import' && (
        <ImportPanel sidebarOpen={sidebarOpen} onCollapseSidebar={onCollapseSidebar} />
      )}

      {view==='reports' && (
        <div className="space-y-6">
          <ReportsPage>
            {/* PriceListReports */}
          </ReportsPage>
        </div>
      )}

      {view==='settings' && (
        <ConfigurationSettings />
      )}

      {view==='system-settings' && (
        <SystemSettings />
      )}

      {view==='user-profile' && (
        <UserProfilePage onClose={() => setView('dashboard')} />
      )}

      {view==='notifications' && (
        <NotificationsPage
          onClose={() => setView('dashboard')}
          selectedNotification={selectedNotification}
        />
      )}
    </main>
  )
}
