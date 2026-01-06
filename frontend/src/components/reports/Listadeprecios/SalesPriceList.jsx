import React, { useState, useContext } from 'react'
import API_ROUTES from '../../../apiRoutes'
import { DollarSign, FileText, FileSpreadsheet } from 'lucide-react'
import usePriceListReports from './usePriceListReports'
import { AuthContext } from '../../../AuthProvider'

export default function SalesPriceList() {
  const [search, setSearch] = useState('')
  const { fetchWithAuth } = useContext(AuthContext)

  // Use the sales price lists endpoint
  const endpoint = API_ROUTES.salesPriceLists || '/api/sales-price-lists'
  const { items: filteredItems, loading, error, exportToCsv, exportToXlsx } = usePriceListReports(endpoint)

  // Get unique price lists and filter by search
  const uniquePriceLists = [...new Set(filteredItems.map(item => item.price_list_name))]
    .filter(name => name.toLowerCase().includes(search.toLowerCase()))
    .sort()

  // Calculate stats for each price list
  const priceListStats = uniquePriceLists.map(priceListName => {
    const listItems = filteredItems.filter(item => item.price_list_name === priceListName)
    return {
      name: priceListName,
      itemCount: listItems.length,
      totalValue: listItems.reduce((sum, item) => sum + (item.price_list_rate * item.qty || 0), 0)
    }
  })

  const exportCsvForList = (priceListName) => {
    const listItems = filteredItems.filter(item => item.price_list_name === priceListName)
    exportToCsv(listItems, `lista_precios_venta_${priceListName}.csv`)
  }

  const exportXlsxForList = async (priceListName) => {
    try {
      const params = new URLSearchParams()
      params.append('price_list', priceListName)
      
      const response = await fetchWithAuth(`/api/reports/price-lists/export-sales-xlsx?${params.toString()}`)
      
      if (!response.ok) {
        throw new Error('Failed to download Excel file')
      }

      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `Lista_Precios_Venta_${priceListName}.xlsx`
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '')
        }
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Error downloading Excel file:', err)
      alert('Error al descargar el archivo Excel. Por favor intente nuevamente.')
    }
  }

  return (
    <div className="w-full">
      {loading && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-gray-200/30 p-8">
          <div className="flex items-center justify-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mr-4"></div>
            <div className="text-xl font-bold text-gray-900">Cargando lista de precios de venta...</div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-red-200/50 p-8 mb-6">
          <div className="text-center">
            <div className="text-lg font-bold text-red-800 mb-4">Error al cargar lista de precios</div>
            <div className="text-sm text-red-700 mb-4">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-6">
          <div className="bg-white/80 rounded-2xl shadow-lg border border-gray-200/40 p-4">
            <h4 className="text-lg font-bold text-gray-900 mb-4">Lista de Precios de Venta</h4>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
              <div className="flex items-center gap-3 w-full md:w-auto">
                <input
                  type="text"
                  placeholder="Buscar por nombre de lista"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full md:w-80 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              <div className="min-w-full">
                {/* Headers */}
                <div className="bg-gray-100 sticky top-0 z-10 border-b border-gray-200">
                  <div className="px-3 py-2 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">Lista de Precios</div>
                      <div className="w-24 text-center">Items</div>
                      <div className="w-32 text-right">Valor Total</div>
                      <div className="w-24 text-center">Acciones</div>
                    </div>
                  </div>
                </div>

                {/* Filas de datos */}
                <div className="bg-white divide-y divide-gray-200">
                  {priceListStats.map((stat) => (
                    <div
                      key={stat.name}
                      className="hover:bg-gray-50 px-3 py-2 flex items-center transition-all duration-200"
                    >
                      <div className="flex-1 text-sm font-medium text-gray-900 truncate">
                        {stat.name}
                      </div>
                      <div className="w-24 text-sm text-gray-500 text-center">
                        {stat.itemCount}
                      </div>
                      <div className="w-32 text-sm text-gray-900 text-right">
                        ${stat.totalValue.toFixed(2)}
                      </div>
                      <div className="w-24 text-sm text-gray-500 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => exportCsvForList(stat.name)}
                            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                            title="Exportar CSV"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => exportXlsxForList(stat.name)}
                            className="p-1 text-green-400 hover:text-green-600 transition-colors"
                            title="Exportar Excel"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {priceListStats.length === 0 && (
                    <div className="px-3 py-8 text-center text-gray-500">
                      No hay listas de precios disponibles.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}