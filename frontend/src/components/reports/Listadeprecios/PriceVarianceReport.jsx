import React, { useState, useMemo } from 'react'
import usePriceListReports from './usePriceListReports'
import API_ROUTES from '../../../apiRoutes'
import { AlertTriangle, Download } from 'lucide-react'

function getNumberFromRaw(raw, candidates = []) {
  for (const key of candidates) {
    if (raw && raw[key] !== undefined && raw[key] !== null) {
      const n = Number(raw[key])
      if (!Number.isNaN(n)) return n
    }
  }
  return null
}

function Badge({ pct }) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) {
    return <span className="px-2 py-1 rounded-full bg-gray-200 text-xs">—</span>
  }
  if (pct <= 0) return <span className="px-2 py-1 rounded-full bg-red-200 text-red-800 text-xs">Neg {pct.toFixed(1)}%</span>
  if (pct > 0 && pct < 10) return <span className="px-2 py-1 rounded-full bg-yellow-200 text-yellow-800 text-xs">Bajo {pct.toFixed(1)}%</span>
  return <span className="px-2 py-1 rounded-full bg-green-200 text-green-800 text-xs">OK {pct.toFixed(1)}%</span>
}

export default function PriceVarianceReport() {
  // prefer configured route, fallback to sensible default
  const endpoint = API_ROUTES.priceListReports?.priceVariance ?? '/api/reports/price-variance'
  const { items: rawItems, loading, error, refresh } = usePriceListReports(endpoint)

  // sort
  const [sortDir, setSortDir] = useState('desc')

  // margin filters (percent)
  const [minPct, setMinPct] = useState(-100)
  const [maxPct, setMaxPct] = useState(1000)

  // derive rows with sale, purchase, margin and pct
  const rows = useMemo(() => {
    return rawItems.map((it) => {
      const raw = it.raw || it
      // try common keys for sale and purchase
      const sale = getNumberFromRaw(raw, ['sale_price', 'sale_rate', 'price', 'price_list_rate', 'sale_price_rate', 'selling_price'])
      const purchase = getNumberFromRaw(raw, ['purchase_price', 'purchase_rate', 'cost', 'valuation_rate'])
      const margin = (sale !== null && purchase !== null) ? sale - purchase : null
      const marginPct = (sale !== null && sale !== 0 && margin !== null) ? (margin / sale) * 100 : null
      return {
        item_code: it.item_code || it.itemCode || raw.item_code || raw.item || raw.code || '',
        item_name: it.item_name || raw.item_name || raw.description || '',
        sale,
        purchase,
        margin,
        marginPct,
        raw,
      }
    })
  }, [rawItems])

  // filtered
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (r.marginPct === null || r.marginPct === undefined || Number.isNaN(r.marginPct)) return false
      if (r.marginPct < minPct) return false
      if (r.marginPct > maxPct) return false
      return true
    })
  }, [rows, minPct, maxPct])

  // totals
  const totals = useMemo(() => {
    let neg = 0, low = 0, healthy = 0
    for (const r of rows) {
      const p = r.marginPct
      if (p === null || p === undefined || Number.isNaN(p)) continue
      if (p <= 0) neg++
      else if (p > 0 && p < 10) low++
      else healthy++
    }
    return { neg, low, healthy }
  }, [rows])

  // sorting
  const sorted = useMemo(() => {
    const arr = filtered.slice()
    arr.sort((a, b) => {
      const va = a.marginPct ?? -Infinity
      const vb = b.marginPct ?? -Infinity
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return arr
  }, [filtered, sortDir])

  const toggleSort = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))

  const exportCsv = () => {
    const headers = ['item_code', 'item_name', 'sale', 'purchase', 'margin', 'marginPct']
    const lines = [headers.join(',')]
    for (const r of sorted) {
      const vals = [r.item_code, r.item_name, r.sale, r.purchase, r.margin, r.marginPct !== null ? r.marginPct.toFixed(2) : '']
        .map((v) => `"${String(v ?? '') .replace(/"/g, '""')}"`)
      lines.push(vals.join(','))
    }
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.setAttribute('download', `price-variance-${new Date().toISOString()}.csv`)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 rounded-2xl bg-white/80 border border-white/15 shadow space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <AlertTriangle className="w-6 h-6 text-gray-700" />
          <div>
            <div className="text-lg font-black">Price Variance</div>
            <div className="text-xs text-gray-500">Márgenes calculados como (venta - compra) y porcentaje relativo a la venta</div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button onClick={exportCsv} className="inline-flex items-center space-x-2 px-3 py-1 rounded-md bg-indigo-600 text-white text-sm">
            <Download className="w-4 h-4" />
            <span>Exportar CSV</span>
          </button>
          <button onClick={refresh} className="px-3 py-1 rounded-md border bg-white/90 text-sm">Actualizar</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="p-3 rounded-lg bg-white/90 border border-white/10 text-sm">
          <div className="text-xs text-gray-500">Negativos</div>
          <div className="text-xl font-black text-red-600">{totals.neg}</div>
        </div>
        <div className="p-3 rounded-lg bg-white/90 border border-white/10 text-sm">
          <div className="text-xs text-gray-500">Bajos (&lt;10%)</div>
          <div className="text-xl font-black text-yellow-700">{totals.low}</div>
        </div>
        <div className="p-3 rounded-lg bg-white/90 border border-white/10 text-sm">
          <div className="text-xs text-gray-500">Saludables (&ge;10%)</div>
          <div className="text-xl font-black text-green-600">{totals.healthy}</div>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <label className="text-xs text-gray-600">Min %</label>
          <input type="number" value={minPct} onChange={(e) => setMinPct(Number(e.target.value))} className="w-24 p-1 rounded border" />
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-xs text-gray-600">Max %</label>
          <input type="number" value={maxPct} onChange={(e) => setMaxPct(Number(e.target.value))} className="w-24 p-1 rounded border" />
        </div>
        <div className="text-xs text-gray-500">Resultados: {sorted.length}</div>
        <div className="ml-auto text-sm">
          <button onClick={toggleSort} className="px-2 py-1 rounded border">Ordenar por margen ({sortDir})</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Item</th>
              <th className="p-2">Venta</th>
              <th className="p-2">Compra</th>
              <th className="p-2">Margen</th>
              <th className="p-2">%</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => (
              <tr key={r.item_code + idx} className="border-b last:border-b-0">
                <td className="p-2">{r.item_code} — <span className="text-xs text-gray-500">{r.item_name}</span></td>
                <td className="p-2">{r.sale !== null ? r.sale : '—'}</td>
                <td className="p-2">{r.purchase !== null ? r.purchase : '—'}</td>
                <td className="p-2">{r.margin !== null ? r.margin.toFixed(2) : '—'}</td>
                <td className="p-2"><Badge pct={r.marginPct} /></td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-500">No hay resultados para los filtros seleccionados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error ? <div className="text-red-600">Error: {error}</div> : null}
      {loading ? <div className="text-sm text-gray-500">Cargando...</div> : null}
    </div>
  )
}
