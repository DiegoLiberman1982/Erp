import React, { useMemo, useState, useContext, useEffect } from 'react'
import { AuthContext } from '../../../AuthProvider'
import { Package, FileSpreadsheet, Search, X } from 'lucide-react'
import useInventoryReports from './useInventoryReports'
import { useNotification } from '../../../contexts/NotificationContext'
import { fetchWarehouses } from '../../../apiUtils'
import Select from 'react-select'

export default function StockByWarehouse() {
  const { fetchWithAuth, activeCompany, selectedCompany } = useContext(AuthContext)
  const company = selectedCompany || activeCompany
  const { showError, showSuccess } = useNotification()

  const [warehouses, setWarehouses] = useState([]) // base warehouses only (no CON/VCON variants)
  const [selectedWarehouses, setSelectedWarehouses] = useState([])

  const [searchTerm, setSearchTerm] = useState('')
  const [loadingWarehouses, setLoadingWarehouses] = useState(false)

  const {
    data: stockData,
    loading,
    error,
    refresh,
    exportToXlsx
  } = useInventoryReports('/api/reports/inventory/stock-by-warehouse', {
    autoFetch: false,
    params: { company }
  })

  useEffect(() => {
    if (!company) {
      setWarehouses([])
      setSelectedWarehouses([])
      return
    }

    const load = async () => {
      setLoadingWarehouses(true)
      try {
        const warehouseData = await fetchWarehouses(fetchWithAuth, company)
        const baseWarehouses = (warehouseData.flat || []).filter(wh => !wh.is_consignment_variant)
        setWarehouses(baseWarehouses)
      } catch (err) {
        console.error('Error loading warehouses:', err)
        showError('Error al cargar almacenes')
        setWarehouses([])
      } finally {
        setLoadingWarehouses(false)
      }
    }

    load()
    refresh({ company })
  }, [company, fetchWithAuth, refresh, showError])

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

  const filteredData = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return (stockData || []).filter(item => {
      const matchesWarehouse = expandedWarehouseNames.size === 0 || expandedWarehouseNames.has(item.warehouse)
      const matchesSearch = !term ||
        (item.item_code || '').toLowerCase().includes(term) ||
        (item.item_name || '').toLowerCase().includes(term)
      return matchesWarehouse && matchesSearch
    })
  }, [stockData, expandedWarehouseNames, searchTerm])

  const stats = useMemo(() => ({
    totalItems: new Set(filteredData.map(i => i.item_code)).size,
    totalWarehouses: new Set(filteredData.map(i => i.warehouse)).size,
    totalValue: filteredData.reduce((sum, i) => sum + (i.stock_value || 0), 0),
    totalQty: filteredData.reduce((sum, i) => sum + (i.actual_qty || 0), 0)
  }), [filteredData])

  const handleExportExcel = async () => {
    if (filteredData.length === 0) return
    try {
      exportToXlsx(`Stock_por_Almacen_${new Date().toISOString().split('T')[0]}.xlsx`, filteredData)
      showSuccess('Archivo Excel descargado exitosamente')
    } catch (err) {
      console.error('Error exporting to Excel:', err)
      showError('Error al exportar a Excel')
    }
  }

  return (
    <div className="w-full">
      <div className="bg-white/80 rounded-2xl shadow-lg border border-gray-200/40 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Package className="w-6 h-6 text-blue-600" />
            <h3 className="text-xl font-bold text-gray-900">Stock por Almacén</h3>
          </div>
          <button
            onClick={handleExportExcel}
            disabled={loading || filteredData.length === 0}
            className="btn-secondary flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Excel
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-sm text-gray-600">Items Únicos</div>
            <div className="text-2xl font-bold text-blue-600">{stats.totalItems}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <div className="text-sm text-gray-600">Almacenes</div>
            <div className="text-2xl font-bold text-green-600">{stats.totalWarehouses}</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3">
            <div className="text-sm text-gray-600">Cantidad Total</div>
            <div className="text-2xl font-bold text-purple-600">{stats.totalQty.toFixed(2)}</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3">
            <div className="text-sm text-gray-600">Valor Total</div>
            <div className="text-2xl font-bold text-orange-600">
              ${stats.totalValue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Select
              isMulti
              isClearable
              isDisabled={!company || loadingWarehouses}
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

          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar item..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center text-sm text-gray-600">
            {loadingWarehouses ? 'Cargando almacenes...' : 'Filtros en vivo'}
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-gray-50 rounded-lg border border-gray-200">
            {selectedWarehouses.length === 0 ? (
              <span className="text-sm text-gray-500">Incluye todos los almacenes (y sus consignaciones)</span>
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
        </div>
      </div>

      {loading && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 p-8">
          <div className="flex items-center justify-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mr-4"></div>
            <div className="text-xl font-bold text-gray-900">Cargando stock...</div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-red-200/50 p-8">
          <div className="text-center">
            <div className="text-lg font-bold text-red-800 mb-4">Error al cargar stock</div>
            <div className="text-sm text-red-700">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && filteredData.length > 0 && (
        <div className="bg-white/80 rounded-2xl shadow-lg border border-gray-200/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Código</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Nombre</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Almacén</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Actual</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Reservada</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Disponible</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Proyectada</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">UOM</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Valor Unit.</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Valor Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredData.map((item, idx) => (
                  <tr key={`${item.item_code}-${item.warehouse}-${idx}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.item_code}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.item_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.warehouse}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 font-medium">{Number(item.actual_qty || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-orange-600">{Number(item.reserved_qty || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-green-600 font-medium">{Number(item.available_qty || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700">{Number(item.projected_qty || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{item.stock_uom}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700">${Number(item.valuation_rate || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 font-medium">
                      ${Number(item.stock_value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
            <div className="text-sm text-gray-600">
              Mostrando <span className="font-semibold">{filteredData.length}</span> registros
            </div>
          </div>
        </div>
      )}

      {!loading && !error && filteredData.length === 0 && (
        <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 p-12">
          <div className="text-center">
            <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">Sin resultados</h3>
            <p className="text-gray-600">No se encontraron items con stock para los filtros seleccionados.</p>
          </div>
        </div>
      )}
    </div>
  )
}
