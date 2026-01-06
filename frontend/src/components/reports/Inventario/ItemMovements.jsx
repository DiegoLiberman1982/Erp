import React, { useMemo, useRef, useState, useContext, useEffect } from 'react'
import { AuthContext } from '../../../AuthProvider'
import { TrendingUp, FileSpreadsheet, X } from 'lucide-react'
import useInventoryReports from './useInventoryReports'
import { useNotification } from '../../../contexts/NotificationContext'
import { fetchWarehouses } from '../../../apiUtils'
import Select from 'react-select'
import AsyncSelect from 'react-select/async'

const isTruthyStockItem = (value) => {
  if (value === 1 || value === '1' || value === true) return true
  const normalized = (value ?? '').toString().trim().toLowerCase()
  return normalized === 'true' || normalized === 'stock' || normalized === 'producto'
}

export default function ItemMovements() {
  const { fetchWithAuth, activeCompany, selectedCompany } = useContext(AuthContext)
  const company = selectedCompany || activeCompany
  const { showError, showSuccess, showWarning } = useNotification()

  const [selectedItems, setSelectedItems] = useState([])
  const [itemSelectInputValue, setItemSelectInputValue] = useState('')

  const [kits, setKits] = useState([])
  const [loadingKits, setLoadingKits] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo)
  const [dateTo, setDateTo] = useState(today)

  const [warehouses, setWarehouses] = useState([]) // base warehouses only (no CON/VCON variants)
  const [selectedWarehouses, setSelectedWarehouses] = useState([])

  const {
    data: movements,
    loading,
    error,
    refresh,
    exportToXlsx
  } = useInventoryReports('/api/reports/inventory/item-movements', {
    autoFetch: false
  })

  useEffect(() => {
    if (!company) {
      setWarehouses([])
      setSelectedWarehouses([])
      setKits([])
      setSelectedItems([])
      setItemSelectInputValue('')
      return
    }

    const load = async () => {
      try {
        const warehouseData = await fetchWarehouses(fetchWithAuth, company)
        const baseWarehouses = (warehouseData.flat || []).filter(wh => !wh.is_consignment_variant)
        setWarehouses(baseWarehouses)
      } catch (e) {
        console.error('Error loading warehouses:', e)
        setWarehouses([])
      }

      try {
        setLoadingKits(true)
        const resp = await fetchWithAuth(`/api/inventory/kits?company=${encodeURIComponent(company)}`)
        if (!resp.ok) throw new Error('Error al cargar kits')
        const json = await resp.json()
        setKits(Array.isArray(json.data) ? json.data : [])
      } catch (e) {
        console.error('Error loading kits:', e)
        setKits([])
      } finally {
        setLoadingKits(false)
      }
    }

    load()
  }, [company, fetchWithAuth])

  const loadItemOptions = async (inputValue) => {
    const term = (inputValue || '').toString().trim()
    if (!company || !term || term.length < 2) return []

    try {
      const itemsResp = await fetchWithAuth(
        `/api/inventory/search-items?company=${encodeURIComponent(company)}&query=${encodeURIComponent(term)}&field=description`
      )
      if (!itemsResp.ok) return []
      const itemsJson = await itemsResp.json()

      const stockItems = (Array.isArray(itemsJson.data) ? itemsJson.data : [])
        .filter(it => isTruthyStockItem(it.is_stock_item))
        .map(it => {
          const code = it.display_code || it.item_code || it.name
          const label = it.item_name || it.description || code
          if (!code) return null
          return { value: `item:${code}`, label: `${code} — ${label}`, kind: 'item', code, name: label }
        })
        .filter(Boolean)
        .slice(0, 20)

      const kitsLocal = (kits || [])
        .map(k => {
          const code = (k.new_item_code || k.name || '').toString().trim()
          const label = (k.description || k.name || k.new_item_code || '').toString().trim()
          if (!code) return null
          return { value: `kit:${code}`, label: `KIT: ${code} — ${label || code}`, kind: 'kit', code, name: label || code }
        })
        .filter(Boolean)
        .filter(k => k.label.toLowerCase().includes(term.toLowerCase()))
        .slice(0, 20)

      const merged = [...stockItems, ...kitsLocal]
      const seen = new Set()
      return merged.filter(opt => {
        if (seen.has(opt.value)) return false
        seen.add(opt.value)
        return true
      })
    } catch (e) {
      console.error('Error loading item options:', e)
      return []
    }
  }

  const addEntry = (entry) => {
    if (!entry?.code) return
    if (selectedItems.some(i => i.code === entry.code)) {
      showWarning('Este item ya está seleccionado')
      return
    }

    setSelectedItems(prev => [...prev, { code: entry.code, name: entry.label || entry.code, kind: entry.kind }])
    showSuccess('Item agregado')
  }

  const removeItem = (code) => {
    setSelectedItems(prev => prev.filter(i => i.code !== code))
  }

  const removeWarehouse = (warehouseName) => {
    setSelectedWarehouses(prev => prev.filter(w => w.name !== warehouseName))
  }

  const expandedWarehouseNames = useMemo(() => {
    const names = new Set()
    for (const w of selectedWarehouses) {
      if (!w?.name) continue
      names.add(w.name)
      const variants = Array.isArray(w.consignment_variants) ? w.consignment_variants : []
      for (const v of variants) {
        const variantName = v?.name
        if (variantName) names.add(variantName)
      }
    }
    return names
  }, [selectedWarehouses])

  const filteredMovements = useMemo(() => {
    if (selectedItems.length === 0) return []
    if (expandedWarehouseNames.size === 0) return movements
    return movements.filter(m => expandedWarehouseNames.has(m.warehouse))
  }, [movements, expandedWarehouseNames, selectedItems.length])

  const refreshDebounceRef = useRef(null)
  useEffect(() => {
    if (!company) return

    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)

    if (selectedItems.length === 0) return
    if (!dateFrom || !dateTo) return

    refreshDebounceRef.current = setTimeout(() => {
      const itemCodes = selectedItems.map(i => i.code).join(',')
      refresh({
        company,
        item_codes: itemCodes,
        from_date: dateFrom,
        to_date: dateTo
      })
    }, 350)

    return () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current)
    }
  }, [company, selectedItems, dateFrom, dateTo, refresh])

  const handleExportExcel = async () => {
    if (selectedItems.length === 0) {
      showWarning('Seleccione al menos un item')
      return
    }

    if (filteredMovements.length === 0) {
      showWarning('No hay movimientos para exportar')
      return
    }

    try {
      exportToXlsx(`Movimientos_Items_${dateFrom}_a_${dateTo}.xlsx`, filteredMovements)
      showSuccess('Archivo Excel descargado exitosamente')
    } catch (err) {
      console.error('Error exporting to Excel:', err)
      showError('Error al exportar a Excel')
    }
  }

  const stats = useMemo(() => {
    const rows = filteredMovements
    return {
      totalMovements: rows.length,
      totalIncoming: rows.filter(m => m.actual_qty > 0).reduce((sum, m) => sum + m.actual_qty, 0),
      totalOutgoing: rows.filter(m => m.actual_qty < 0).reduce((sum, m) => sum + Math.abs(m.actual_qty), 0),
      netChange: rows.reduce((sum, m) => sum + m.actual_qty, 0)
    }
  }, [filteredMovements])

  return (
    <div className="w-full">
      <div className="bg-white/80 rounded-2xl shadow-lg border border-gray-200/40 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-purple-600" />
            <h3 className="text-xl font-bold text-gray-900">Movimientos de Items</h3>
          </div>
          <button
            onClick={handleExportExcel}
            disabled={loading || filteredMovements.length === 0}
            className="btn-secondary flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Excel
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Items / Kits Seleccionados ({selectedItems.length})
          </label>

          <AsyncSelect
            cacheOptions
            defaultOptions={false}
            loadOptions={loadItemOptions}
            value={null}
            inputValue={itemSelectInputValue}
            onInputChange={(val, meta) => {
              if (meta.action === 'input-change') setItemSelectInputValue(val)
              if (meta.action === 'menu-close') setItemSelectInputValue(val || '')
              return val
            }}
            onChange={(opt) => {
              if (!opt) return
              addEntry({ kind: opt.kind, code: opt.code, label: opt.name })
              setItemSelectInputValue('')
            }}
            isDisabled={!company || loadingKits}
            placeholder={company ? 'Buscar item o kit...' : 'Seleccioná empresa'}
            noOptionsMessage={() => (itemSelectInputValue.trim().length < 2 ? 'Escribí al menos 2 letras' : 'Sin resultados')}
            loadingMessage={() => 'Buscando...'}
            styles={{
              control: (base) => ({ ...base, minHeight: 42, borderRadius: 8 }),
              menu: (base) => ({ ...base, zIndex: 60 })
            }}
          />

          <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-gray-50 rounded-lg border border-gray-200">
            {selectedItems.length === 0 ? (
              <span className="text-sm text-gray-500">No hay items seleccionados</span>
            ) : (
              selectedItems.map((item) => (
                <span
                  key={item.code}
                  className="inline-flex items-center gap-2 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-medium"
                >
                  {item.kind === 'kit' ? `KIT: ${item.code}` : item.code}
                  <button onClick={() => removeItem(item.code)} className="hover:bg-purple-200 rounded-full p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Almacenes (Opcional)</label>
            <Select
              isMulti
              isClearable
              isDisabled={!company}
              placeholder={company ? 'Seleccionar almacenes...' : 'Seleccioná empresa'}
              value={selectedWarehouses.map(wh => ({ value: wh.name, label: wh.warehouse_name || wh.name, warehouse: wh }))}
              onChange={(opts) => {
                const next = Array.isArray(opts) ? opts.map(o => o.warehouse).filter(Boolean) : []
                setSelectedWarehouses(next)
              }}
              options={warehouses.map(wh => ({ value: wh.name, label: wh.warehouse_name || wh.name, warehouse: wh }))}
              noOptionsMessage={() => (company ? 'No hay almacenes disponibles' : 'Seleccioná empresa')}
              styles={{
                control: (base) => ({ ...base, minHeight: 42, borderRadius: 8 }),
                menu: (base) => ({ ...base, zIndex: 60 })
              }}
            />
          </div>

          <div className="flex items-end">
            <div className="w-full text-sm text-gray-600">
              {selectedItems.length === 0 ? 'Seleccioná items/kits para generar.' : 'El reporte se actualiza automáticamente.'}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Almacenes Seleccionados ({selectedWarehouses.length})
          </label>
          <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-gray-50 rounded-lg border border-gray-200">
            {selectedWarehouses.length === 0 ? (
              <span className="text-sm text-gray-500">Todos los almacenes</span>
            ) : (
              selectedWarehouses.map((wh) => (
                <span
                  key={wh.name}
                  className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm font-medium"
                >
                  {wh.warehouse_name || wh.name}
                  <button onClick={() => removeWarehouse(wh.name)} className="hover:bg-indigo-200 rounded-full p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))
            )}
          </div>
          {selectedWarehouses.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              Nota: incluye automáticamente los almacenes de consignación (CON/VCON) asociados.
            </div>
          )}
        </div>

        {filteredMovements.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-sm text-gray-600">Total Movimientos</div>
              <div className="text-2xl font-bold text-blue-600">{stats.totalMovements}</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-sm text-gray-600">Entradas</div>
              <div className="text-2xl font-bold text-green-600">+{stats.totalIncoming.toFixed(2)}</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <div className="text-sm text-gray-600">Salidas</div>
              <div className="text-2xl font-bold text-red-600">-{stats.totalOutgoing.toFixed(2)}</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-3">
              <div className="text-sm text-gray-600">Cambio Neto</div>
              <div className={`text-2xl font-bold ${stats.netChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {stats.netChange >= 0 ? '+' : ''}{stats.netChange.toFixed(2)}
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 p-8">
          <div className="flex items-center justify-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mr-4"></div>
            <div className="text-xl font-bold text-gray-900">Cargando movimientos...</div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-red-200/50 p-8">
          <div className="text-center">
            <div className="text-lg font-bold text-red-800 mb-4">Error al cargar movimientos</div>
            <div className="text-sm text-red-700">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && filteredMovements.length > 0 && (
        <div className="bg-white/80 rounded-2xl shadow-lg border border-gray-200/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Fecha</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Almacén</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Cantidad</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Saldo</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Valor Unit.</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Dif. Valor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Tipo Doc.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Nº Doc.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredMovements.map((mov, idx) => (
                  <tr key={`${mov.name}-${idx}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {mov.posting_date}
                      <div className="text-xs text-gray-500">{mov.posting_time}</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{mov.item_code}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{mov.warehouse}</td>
                    <td className={`px-4 py-3 text-sm text-right font-medium ${mov.actual_qty >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {mov.actual_qty >= 0 ? '+' : ''}{mov.actual_qty.toFixed(2)} {mov.stock_uom}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900">
                      {mov.qty_after_transaction.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700">
                      ${mov.valuation_rate.toFixed(2)}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right font-medium ${mov.stock_value_difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ${mov.stock_value_difference.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{mov.voucher_type}</td>
                    <td className="px-4 py-3 text-sm text-blue-600 hover:underline">{mov.voucher_no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
            <div className="text-sm text-gray-600">
              Mostrando <span className="font-semibold">{filteredMovements.length}</span> movimientos
            </div>
          </div>
        </div>
      )}

      {!loading && !error && filteredMovements.length === 0 && selectedItems.length > 0 && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 p-12">
          <div className="text-center">
            <TrendingUp className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">No hay movimientos</h3>
            <p className="text-gray-600">No se encontraron movimientos para los items y fechas seleccionadas.</p>
          </div>
        </div>
      )}
    </div>
  )
}
