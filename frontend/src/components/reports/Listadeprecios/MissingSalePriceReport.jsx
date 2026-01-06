import React, { useMemo, useState } from 'react'
import API_ROUTES from '../../../apiRoutes'
import { AlertTriangle, FileText, FileSpreadsheet } from 'lucide-react'
import usePriceListReports from './usePriceListReports'

// Use the missing sale prices endpoint
const endpoint = '/api/reports/price-lists/missing-sale-prices'

export default function MissingSalePriceReport() {
  const [search, setSearch] = useState('')

  // Dynamic endpoint with params
  const fullEndpoint = `${endpoint}?search=${encodeURIComponent(search)}`
  const { items: filteredItems, loading, error, exportToCsv, exportToXlsx } = usePriceListReports(fullEndpoint)

  const displayItems = filteredItems

  const exportVisible = () => {
    const rows = displayItems.map(i => ({ item_code: i.item_code, item_name: i.item_name }))
    exportToCsv(rows, 'missing_sale_prices.csv')
  }

  const exportVisibleXlsx = () => {
    const rows = displayItems.map(i => ({ item_code: i.item_code, item_name: i.item_name }))
    exportToXlsx(rows, 'missing_sale_prices.xlsx')
  }

  return (
    <div className="w-full">
      {loading && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-gray-200/30 p-8">
          <div className="flex items-center justify-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mr-4"></div>
            <div className="text-xl font-bold text-gray-900">Cargando items...</div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-red-200/50 p-8 mb-6">
          <div className="text-center">
            <div className="text-lg font-bold text-red-800 mb-4">Error al cargar reporte</div>
            <div className="text-sm text-red-700 mb-4">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-6">
          <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <AlertTriangle className="w-8 h-8 text-yellow-600" />
              <div>
                <h3 className="text-2xl font-black text-gray-900">Items sin precio de venta</h3>
                <p className="text-sm text-gray-600">Filtra, revisa y exporta los items que faltan precio de venta.</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-500">Total sin precio</div>
              <div className="text-2xl font-black text-gray-900">{filteredItems.length}</div>
            </div>
          </div>

          <div className="bg-white/80 rounded-2xl shadow-lg border border-gray-200/40 p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
              <div className="flex items-center gap-3 w-full md:w-auto">
                <input
                  type="text"
                  placeholder="Buscar por código o descripción"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full md:w-80 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={exportVisible}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Exportar CSV"
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  onClick={exportVisibleXlsx}
                  className="p-1 text-green-400 hover:text-green-600 transition-colors"
                  title="Exportar Excel"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              <table className="accounting-table w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-36">Código</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descripción</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayItems.map((it, idx) => (
                    <tr key={it.item_code + idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 w-36 truncate" title={it.item_code}>{it.item_code.length > 18 ? it.item_code.substring(0, 18) + '...' : it.item_code}</td>
                      <td className="px-3 py-2 text-sm text-gray-500 truncate">{it.item_name}</td>
                    </tr>
                  ))}
                  {displayItems.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-6 py-8 text-center text-gray-500">No hay items sin precio según los filtros aplicados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
