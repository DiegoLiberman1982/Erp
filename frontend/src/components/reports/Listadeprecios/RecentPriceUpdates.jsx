import React, { useMemo } from 'react'
import usePriceListReports from './usePriceListReports'
import API_ROUTES from '../../../apiRoutes'
import { Clock, User, Tag } from 'lucide-react'

function pad(n) {
  return String(n).padStart(2, '0')
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function RecentPriceUpdates() {
  const endpoint = API_ROUTES.priceListReports?.recentUpdates ?? '/api/reports/price-recent-updates'
  const { items, loading, error, refresh } = usePriceListReports(endpoint)

  const sorted = useMemo(() => {
    const arr = (items || []).slice()
    arr.sort((a, b) => {
      const da = a.last_modified ? new Date(a.last_modified) : new Date(0)
      const db = b.last_modified ? new Date(b.last_modified) : new Date(0)
      return db - da
    })
    return arr
  }, [items])

  const detectType = (raw) => {
    if (!raw) return 'venta'
    if (raw.purchase_rate !== undefined || raw.purchase_price !== undefined) return 'compra'
    // fallback: if price_list_name contains purchase
    const pl = (raw.price_list_name || raw.price_list || '').toString().toLowerCase()
    if (pl.includes('purchase') || pl.includes('compra')) return 'compra'
    return 'venta'
  }

  return (
    <div className="p-4 rounded-2xl bg-white/80 border border-white/15 shadow">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <Clock className="w-5 h-5 text-gray-700" />
          <div>
            <div className="text-lg font-black">Últimas actualizaciones de precios</div>
            <div className="text-xs text-gray-500">Timeline de cambios recientes en listas de precios</div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start space-x-4 animate-pulse">
              <div className="w-20 h-8 bg-gray-200 rounded">&nbsp;</div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
                <div className="h-6 bg-gray-200 rounded w-2/3 mt-2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && <div className="text-red-600">Error: {error}</div>}

      {!loading && !error && (
        <div className="max-h-96 overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Fecha</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider flex-1">Producto</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-36">Código</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Usuario</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">Tipo</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sorted.map((it, idx) => {
                const raw = it.raw || it
                const when = it.last_modified || raw.modified || raw.updated_at || raw.updatedAt
                const user = raw.modified_by || raw.user || raw.updated_by || raw.modified_by_user || '—'
                const type = detectType(raw)

                return (
                  <tr key={(it.item_code || '') + idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 w-24">{formatDate(when)}</td>
                    <td className="px-3 py-2 text-sm text-gray-500 truncate flex-1">{it.item_name || raw.item_name || raw.description || 'Sin nombre'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 w-36 truncate" title={it.item_code || raw.item_code || raw.item || raw.code}>{(it.item_code || raw.item_code || raw.item || raw.code || '').length > 18 ? (it.item_code || raw.item_code || raw.item || raw.code || '').substring(0, 18) + '...' : (it.item_code || raw.item_code || raw.item || raw.code || '')}</td>
                    <td className="px-3 py-2 text-sm text-gray-500 w-24 truncate">{user}</td>
                    <td className="px-3 py-2 text-sm text-gray-500 w-16">{type}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <div className="text-center text-gray-500 mt-4">No hay actualizaciones recientes.</div>
          )}
        </div>
      )}
    </div>
  )
}
