import React from 'react'
import { Building2, FileText, Users, Receipt, Wallet, Archive, Mail, Check, Printer, PlugZap } from 'lucide-react'

const TabsNavigation = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { id: 'empresas', label: 'Empresas', icon: Building2, color: 'text-blue-600' },
    { id: 'datosImpositivos', label: 'Datos Impositivos', icon: FileText, color: 'text-green-600' },
    { id: 'clientesProveedores', label: 'Clientes y Proveedores', icon: Users, color: 'text-orange-600' },
    { id: 'talonarios', label: 'Talonarios', icon: Receipt, color: 'text-red-600' },
    { id: 'tesoreria', label: 'Tesoreria', icon: Wallet, color: 'text-yellow-600' },
    { id: 'centrosCostos', label: 'Inventario y Centro de Costos', icon: Archive, color: 'text-purple-600' },
    { id: 'comunicaciones', label: 'Comunicaciones', icon: Mail, color: 'text-purple-600' },
    { id: 'formatosDocumentos', label: 'Formatos de Documentos', icon: Printer, color: 'text-cyan-600' },
    { id: 'integraciones', label: 'Integraciones', icon: PlugZap, color: 'text-amber-600' },
    { id: 'configuracionInicial', label: 'Configuracion Inicial', icon: Check, color: 'text-indigo-600' },
  ]

  return (
    <div className="tabs-container">
      <nav className="tab-nav">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            >
              <Icon className={`w-4 h-4 ${tab.color}`} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default TabsNavigation
