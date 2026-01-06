import React, { useContext, useEffect, useState } from 'react'
import { ClipboardList, RefreshCcw, TrendingUp, AlertCircle } from 'lucide-react'
import { AuthContext } from '../../AuthProvider.jsx'
import API_ROUTES from '../../apiRoutes.js'

const SalesOrdersWidget = ({ onOpenCustomer }) => {
  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadMetrics = async () => {
    try {
      setLoading(true)
      setError(null)
      const endpoint = activeCompany
        ? `${API_ROUTES.salesOrdersMetrics}?company=${encodeURIComponent(activeCompany)}`
        : API_ROUTES.salesOrdersMetrics
      const response = await fetchWithAuth(endpoint)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'No se pudieron obtener los pedidos')
      }
      setMetrics(data.data)
    } catch (err) {
      console.error('Error loading sales order metrics:', err)
      setError(err.message || 'Error al cargar pedidos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMetrics()
  }, [activeCompany])

  return (
    <div className="p-6 bg-white/80 rounded-2xl shadow-lg border border-gray-200/40 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-gray-500">Pedidos recibidos</p>
          <h3 className="text-xl font-black text-gray-900">Sales Orders</h3>
        </div>
        <button
          type="button"
          onClick={loadMetrics}
          className="inline-flex items-center rounded-full border border-gray-200 text-gray-500 hover:text-gray-900 px-2 py-1 text-xs"
        >
          <RefreshCcw className="w-4 h-4 mr-1" />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center text-sm text-red-600">
          <AlertCircle className="w-6 h-6 mb-2" />
          {error}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-2xl border border-green-100 bg-green-50/70 p-3 text-center">
              <p className="text-xs uppercase text-green-600">Abiertos</p>
              <p className="text-2xl font-black text-green-900">{metrics?.open ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3 text-center">
              <p className="text-xs uppercase text-blue-600">Hoy</p>
              <p className="text-2xl font-black text-blue-900">{metrics?.today ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-red-100 bg-red-50/70 p-3 text-center">
              <p className="text-xs uppercase text-red-600">Cancelados</p>
              <p className="text-2xl font-black text-red-900">{metrics?.cancelled ?? 0}</p>
            </div>
          </div>
          <div className="flex items-center justify-between pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              Últimos pedidos
            </div>
            <ClipboardList className="w-4 h-4 text-gray-400" />
          </div>
          <div className="flex-1 mt-2 overflow-y-auto">
            {metrics?.recent && metrics.recent.length > 0 ? (
              <ul className="space-y-3">
                {metrics.recent.map((order) => (
                  <li
                    key={order.name}
                    onClick={() => onOpenCustomer ? onOpenCustomer(order.customer, order.name) : null}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenCustomer && onOpenCustomer(order.customer, order.name) }}
                    className="rounded-xl border border-gray-100 px-3 py-2 bg-white/70 cursor-pointer hover:shadow-md focus:shadow-md"
                  >
                    <div className="flex items-center justify-between text-sm font-semibold text-gray-900">
                      <span>{order.customer}</span>
                      <span>${Number(order.grand_total || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                      <span>{order.delivery_date || order.transaction_date || ''}</span>
                      <span>{order.status || 'Pendiente'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 text-center py-6">Todavía no registramos pedidos.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default SalesOrdersWidget
