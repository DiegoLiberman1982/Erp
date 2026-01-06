import React, { useState, useContext } from 'react'
import { AuthContext } from '../AuthProvider'
import { NotificationContext } from '../contexts/NotificationContext'
import { Upload, FileSpreadsheet, Users, Package, Truck, ChevronRight, DollarSign, ShoppingCart, TrendingUp, FileText } from 'lucide-react'
import ItemImport from './import/ItemImport'
import PurchasePriceListTemplate from './import/PurchasePriceListTemplate'
import SalesPriceListManager from './import/SalesPriceListManager'
import SalesInvoiceImport from './import/SalesInvoiceImport'
import PurchaseInvoiceImport from './import/PurchaseInvoiceImport'
import CustomerImport from './import/CustomerImport'
import SupplierImport from './import/SupplierImport'

export default function ImportPanel({ sidebarOpen, onCollapseSidebar }) {
  const [activeSection, setActiveSection] = useState('items') // 'items', 'customers', 'suppliers'
  const [sectionCollapsed, setSectionCollapsed] = useState(true) // Nueva estado para colapsar la sección
  const { activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)

  // Colapsar sidebar y sección automáticamente al entrar
  React.useEffect(() => {
    if (sidebarOpen && onCollapseSidebar) {
      onCollapseSidebar()
    }
    setSectionCollapsed(true) // Colapsar la sección automáticamente
  }, [])

  React.useEffect(() => {
    const handleOpenImportSection = (event) => {
      const section = event?.detail?.section
      if (section) {
        setActiveSection(section)
        setSectionCollapsed(false)
      }
    }

    window.addEventListener('openImportSection', handleOpenImportSection)
    return () => {
      window.removeEventListener('openImportSection', handleOpenImportSection)
    }
  }, [])

  const sections = [
    {
      id: 'items',
      name: 'Items de Inventario',
      icon: Package,
      description: 'Importar productos y servicios',
      component: ItemImport
    },
    {
      id: 'sales_invoices',
      name: 'Facturas de Venta',
      icon: FileText,
      description: 'Importar comprobantes AFIP con docstatus 1',
      component: SalesInvoiceImport
    },
    {
      id: 'purchase_invoices',
      name: 'Facturas de Compra',
      icon: FileSpreadsheet,
      description: 'Importar comprobantes AFIP (CSV/XLSX) con docstatus 1',
      component: PurchaseInvoiceImport
    },
    {
      id: 'purchase_prices',
      name: 'Precios de Compra',
      icon: ShoppingCart,
      description: 'Listas de precios de compra desde templates',
      component: PurchasePriceListTemplate
    },
    {
      id: 'sales_prices',
      name: 'Precios de Venta',
      icon: TrendingUp,
      description: 'Listas de precios de venta',
      component: SalesPriceListManager
    },
    {
      id: 'customers',
      name: 'Clientes',
      icon: Users,
      description: 'Importar clientes',
      component: CustomerImport
    },
    {
      id: 'suppliers',
      name: 'Proveedores',
      icon: Truck,
      description: 'Importar proveedores',
      component: SupplierImport
    }
  ]

  const ActiveComponent = sections.find(s => s.id === activeSection)?.component


  return (
    <div className="h-full flex gap-6">
      {/* Panel izquierdo - Secciones */}
      <div className={`bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden transition-all duration-300 ${
        sectionCollapsed ? 'w-16' : 'w-80'
      }`}>
        {sectionCollapsed ? (
          // Vista colapsada - solo iconos
          <div className="p-4 flex flex-col items-center gap-4">
            <button
              onClick={() => setSectionCollapsed(false)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors duration-200"
              title="Expandir sección de importación"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex flex-col gap-3">
              {sections.map(section => {
                const Icon = section.icon
                return (
                  <button
                    key={section.id}
                    onClick={() => !section.disabled && setActiveSection(section.id)}
                    disabled={section.disabled}
                    className={`p-3 rounded-lg transition-all duration-200 ${
                      activeSection === section.id
                        ? 'bg-blue-50 border-2 border-blue-500 text-blue-600 shadow-md'
                        : section.disabled
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    title={section.name}
                  >
                    <Icon className="w-5 h-5" />
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          // Vista expandida - contenido completo
          <>
            <div className="accounting-card-title">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Upload className="w-5 h-5 text-blue-600" />
                  <h3 className="text-lg font-black text-gray-900">Importación de Datos</h3>
                </div>
                <button
                  onClick={() => setSectionCollapsed(true)}
                  className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors duration-200"
                  title="Colapsar sección"
                >
                  <ChevronRight className="w-5 h-5 text-gray-600 rotate-180" />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-2">
              {sections.map(section => {
                const Icon = section.icon
                return (
                  <button
                    key={section.id}
                    onClick={() => !section.disabled && setActiveSection(section.id)}
                    disabled={section.disabled}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-300 ${
                      activeSection === section.id
                        ? 'bg-blue-50 border-blue-500 shadow-md'
                        : section.disabled
                        ? 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
                        : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${
                        activeSection === section.id
                          ? 'bg-blue-500 text-white'
                          : section.disabled
                          ? 'bg-gray-300 text-gray-500'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className={`font-bold text-sm ${
                            activeSection === section.id ? 'text-blue-900' : 'text-gray-900'
                          }`}>
                            {section.name}
                          </h4>
                          {section.comingSoon && (
                            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-medium">
                              Próximamente
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">{section.description}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Información adicional */}
            <div className="p-4 border-t border-gray-200">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <h4 className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  Consejos de Importación
                </h4>
                <ul className="text-xs text-blue-800 space-y-1">
                  <li>• Completa los campos obligatorios (*)</li>
                  <li>• Usa patrones para generar datos automáticos</li>
                  <li>• Revisa antes de importar</li>
                  <li>• Los errores se mostrarán en rojo</li>
                </ul>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Panel derecho - Componente activo */}
      <div className="flex-1 min-w-0">
        {ActiveComponent ? (
          <ActiveComponent />
        ) : (
          <div className="h-full flex items-center justify-center bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30">
            <div className="text-center text-gray-500">
              <FileSpreadsheet className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-semibold">Esta sección estará disponible pronto</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
