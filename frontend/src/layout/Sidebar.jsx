import React, { useContext } from 'react'
import { Home, Users, Package, DollarSign, Settings, FileText, Menu, Calculator, Warehouse, Upload } from 'lucide-react'
import { AuthContext } from '../AuthProvider'

export default function Sidebar({ view, setView, sidebarOpen, onToggleSidebar, setupCompleted = false }){
  const { hasFeatureAccess = () => true } = useContext(AuthContext)
  const allItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'customers', label: 'Clientes', icon: Users },
    { id: 'orders', label: 'Proveedores', icon: Package },
    { id: 'inventory', label: 'Inventario', icon: Warehouse },
    { id: 'import', label: 'Importación', icon: Upload },
    { id: 'finance', label: 'Finanzas', icon: DollarSign },
    { id: 'accounting', label: 'Contabilidad', icon: Calculator },
    { id: 'reports', label: 'Reportes', icon: FileText },
    { id: 'settings', label: 'Configuración', icon: Settings },
  ]

  const permittedItems = allItems.filter(item => hasFeatureAccess(item.id))
  let items = setupCompleted
    ? permittedItems
    : permittedItems.filter(item => item.id === 'settings')

  if (setupCompleted && items.length === 0) {
    items = permittedItems
  }

  if (!setupCompleted && items.length === 0) {
    const settingsOnly = allItems.find(item => item.id === 'settings' && hasFeatureAccess(item.id))
    items = settingsOnly ? [settingsOnly] : []
  }

  return (
    <aside className={`bg-gradient-to-b from-white/95 via-gray-50/90 to-white/95 backdrop-blur-xl border-r border-gray-300/60 shadow-2xl transition-all duration-300 flex flex-col h-screen ${
      sidebarOpen ? 'w-64' : 'w-16'
    }`}>
      {/* Header con botón de colapsar */}
      <div className={`border-b border-gray-200/50 ${sidebarOpen ? 'p-6' : 'p-4'}`}>
        <div className={`flex items-center justify-between ${sidebarOpen ? '' : 'justify-center'}`}>
          <h3 className={`text-lg font-black text-gray-900 ${sidebarOpen ? '' : 'hidden'}`}>Menú</h3>
          <button 
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? 'Colapsar sidebar' : 'Expandir sidebar'}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Navegación principal - flex-1 para ocupar espacio disponible */}
      <div className={`flex-1 ${sidebarOpen ? 'p-6' : 'p-4'}`}>
        <nav className="space-y-3">
          {items.length === 0 ? (
            <div className="text-xs text-gray-500 bg-white/60 border border-gray-200/70 rounded-2xl p-4">
              No tenés accesos habilitados en este menú según tus permisos.
            </div>
          ) : (
            items.map(item => {
              const Icon = item.icon
              const isActive = view === item.id
              return (
                <button 
                  key={item.id} 
                  onClick={()=>setView(item.id)} 
                  className={`w-full group border border-transparent text-sm font-black rounded-2xl transition-all duration-300 flex items-center ${sidebarOpen ? 'text-left px-6 py-4 space-x-4' : 'justify-center py-4'} ${
                    isActive 
                      ? 'bg-black text-gray-700 shadow-2xl border-gray-600/50' 
                      : 'bg-white/90 text-gray-700 border-gray-200/50 hover:bg-black hover:shadow-2xl hover:border-gray-600/50 focus:outline-none focus:ring-2 focus:ring-black/30'
                  }`}
                >
                  <div className={`p-2 rounded-xl transition-all duration-300 ${
                    isActive 
                      ? 'bg-black/60' 
                      : 'bg-gray-100/80'
                  } group-hover:bg-black/60`}>
                    <Icon className={`${isActive ? 'w-5 h-5 text-white' : 'w-5 h-5 text-gray-700 group-hover:text-white'}`} />
                  </div>
                  {sidebarOpen && <span className="text-base">{item.label}</span>}
                </button>
              )
            })
          )}
        </nav>
      </div>
      
      {/* Footer de la sidebar */}
      <div className={`border-t border-gray-200/50 ${sidebarOpen ? 'p-6' : 'p-4'}`}>
        <div className={`text-xs text-gray-500 text-center ${sidebarOpen ? '' : 'hidden'}`}>
          <p>c 2025 Flowint</p>
          <p>Sistema ERP</p>
        </div>
      </div>
    </aside>
  )
}
