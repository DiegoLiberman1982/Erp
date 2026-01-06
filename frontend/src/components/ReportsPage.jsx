import React, { useContext, useState, useMemo } from 'react';
import { AuthContext } from '../AuthProvider';
import { PriceListSummary, MissingSalePriceReport, MissingPurchasePriceReport, PriceVarianceReport, RecentPriceUpdates, SalesPriceList, PurchasePriceList, usePriceListReports } from './reports/Listadeprecios'
import { StockByWarehouse, ItemMovements } from './reports/Inventario'
import API_ROUTES from '../apiRoutes'
import IvaReportCard from './reports/Impositivos/IvaReportCard'
import PercepcionesReportCard from './reports/Impositivos/PercepcionesReportCard'

// ReportsPage: contenedor principal para reportes de gestión
// - Usa fetchWithAuth del AuthContext para cargar datos iniciales al montarse
// - Renderiza header, tarjetas resumen y un contenedor para children
/**
 * ReportsPage
 * @param {{children?: React.ReactNode, onRefresh?: ()=>void}} props
 * - children: optional children to render inside the reports section
 * - onRefresh: optional callback that will be invoked when the global Refresh button is pressed. If not provided, the page will call the internal hooks' refresh methods.
 */
export default function ReportsPage({ children, onRefresh }) {
  const { fetchWithAuth } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('lista-precios')

  // Fetch shared data for summary: sales and purchase price lists
  const salesEndpoint = API_ROUTES.salesPriceLists || '/api/sales-price-lists'
  const purchaseEndpoint = API_ROUTES.purchasePriceLists || '/api/inventory/purchase-price-lists/all'
  const salesHook = usePriceListReports(salesEndpoint)
  const purchaseHook = usePriceListReports(purchaseEndpoint)

  // Global refresh handler: prefer onRefresh prop, otherwise refresh the local hooks
  const handleRefresh = async () => {
    try {
      if (typeof onRefresh === 'function') {
        onRefresh()
        return
      }

      // Trigger the two main hooks we have here. Other report components use their own hooks.
      if (salesHook && typeof salesHook.refresh === 'function') salesHook.refresh()
      if (purchaseHook && typeof purchaseHook.refresh === 'function') purchaseHook.refresh()
    } catch (e) {
      console.error('Error during ReportsPage refresh', e)
    }
  }

  const summaryStats = useMemo(() => {
    const salesItems = salesHook.items || []
    const purchaseItems = purchaseHook.items || []
    const allPriceLists = new Set([...(salesHook.availablePriceLists || []), ...(purchaseHook.availablePriceLists || [])])

    const itemsWithoutSale = salesItems.filter(i => i.price === null || i.price === undefined || Number(i.price) === 0).length
    const itemsWithoutCost = purchaseItems.filter(i => i.price === null || i.price === undefined || Number(i.price) === 0).length

    return [
      { title: 'Listas de precios', value: allPriceLists.size, description: null, icon: null },
      { title: 'Items sin precio de venta', value: itemsWithoutSale, description: null, icon: null },
      { title: 'Items sin costo', value: itemsWithoutCost, description: 'Items sin precio de compra', icon: null },
      { title: 'Items revisados', value: (salesItems.length + purchaseItems.length), description: 'Total de items analizados', icon: null },
    ]
  }, [salesHook.items, purchaseHook.items, salesHook.availablePriceLists, purchaseHook.availablePriceLists])

  return (
    <div className="w-full">
      <header className="mb-6">
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-gray-200/30 p-6">
          <h1 className="text-2xl font-black text-gray-900">Reportes de gestión</h1>
        </div>
      </header>

      {/* Tabs Navigation */}
      <div className="mb-6">
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30">
          <div className="tabs-container">
            <nav className="tab-nav">
              <button
                onClick={() => setActiveTab('lista-precios')}
                className={`tab-button ${activeTab === 'lista-precios' ? 'active' : ''}`}
              >
                Lista de precios
              </button>
              <button
                onClick={() => setActiveTab('ventas')}
                className={`tab-button ${activeTab === 'ventas' ? 'active' : ''}`}
              >
                Ventas
              </button>
              <button
                onClick={() => setActiveTab('compras')}
                className={`tab-button ${activeTab === 'compras' ? 'active' : ''}`}
              >
                Compras
              </button>
              <button
                onClick={() => setActiveTab('inventario')}
                className={`tab-button ${activeTab === 'inventario' ? 'active' : ''}`}
              >
                Inventario
              </button>
              <button
                onClick={() => setActiveTab('finanzas')}
                className={`tab-button ${activeTab === 'finanzas' ? 'active' : ''}`}
              >
                Finanzas
              </button>
              <button
                onClick={() => setActiveTab('impositivos')}
                className={`tab-button ${activeTab === 'impositivos' ? 'active' : ''}`}
              >
                Impositivos
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-8">
            {activeTab === 'lista-precios' && (
              <div className="space-y-6">
                <PriceListSummary
                  salesHook={salesHook}
                  purchaseHook={purchaseHook}
                  summaryStats={summaryStats}
                  onRefresh={handleRefresh}
                />
                
                {/* Encabezado común para listas de precios */}
                <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 p-6">
                  <h3 className="text-2xl font-black text-gray-900">Listas de Precios</h3>
                  <p className="text-sm text-gray-600 mt-2">Gestión completa de listas de precios de venta y compra por producto.</p>
                </div>
                
                <SalesPriceList />
                <PurchasePriceList />
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-6">
                    <MissingSalePriceReport
                      salesHook={salesHook}
                      purchaseHook={purchaseHook}
                      onRefresh={handleRefresh}
                    />
                    <MissingPurchasePriceReport
                      salesHook={salesHook}
                      purchaseHook={purchaseHook}
                      onRefresh={handleRefresh}
                    />
                  </div>
                  <div className="space-y-6">
                    <PriceVarianceReport
                      salesHook={salesHook}
                      purchaseHook={purchaseHook}
                      onRefresh={handleRefresh}
                    />
                    <RecentPriceUpdates
                      salesHook={salesHook}
                      purchaseHook={purchaseHook}
                      onRefresh={handleRefresh}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'ventas' && (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-500">Reportes de ventas próximamente</p>
              </div>
            )}

            {activeTab === 'compras' && (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-500">Reportes de compras próximamente</p>
              </div>
            )}

            {activeTab === 'inventario' && (
              <div className="space-y-6">
                {/* Encabezado común para reportes de inventario */}
                <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 p-6">
                  <h3 className="text-2xl font-black text-gray-900">Reportes de Inventario</h3>
                  <p className="text-sm text-gray-600 mt-2">Gestión y análisis de stock, movimientos y valorización de inventario.</p>
                </div>
                
                <StockByWarehouse />
                <ItemMovements />
              </div>
            )}

            {activeTab === 'finanzas' && (
              <div className="flex items-center justify-center h-64">
                <p className="text-gray-500">Reportes financieros próximamente</p>
              </div>
            )}

            {activeTab === 'impositivos' && (
              <div className="space-y-6">
                <IvaReportCard />
                <PercepcionesReportCard />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

