import React from 'react'
import { Package, Plus, Lock, Unlock, Package2, PackagePlus, Trash2, ArrowRightLeft } from 'lucide-react'
import { formatNumber, extractItemCodeDisplay } from './inventoryUtils'

export default function ItemListPanel({
  items,
  loading,
  itemSearch,
  itemTypeTab,
  defaultItemTypeTab,
  warehouseTabs,
  selectedWarehouseTab,
  warehouseTabItems,
  sortField,
  sortDirection,
  filters,
  currentPage,
  itemsPerPage,
  selectedItem,
  itemDetailsCache,
  warehouses,
  handleSearchChange,
  setItemTypeTab,
  toggleDefaultTab,
  setSelectedWarehouseTab,
  handleSort,
  handleFilterChange,
  handlePageChange,
  setSelectedItem,
  handleAddItem,
  getPaginatedItems,
  isKitMode = false,
  // multi-select bulk delete props
  bulkModeActive = false,
  onToggleBulkMode = () => {},
  selectedForDelete = new Set(),
  onToggleSelectItem = () => {},
  onToggleSelectAll = () => {},
  onBulkDelete = () => {},
  onSelectKitsTab,
  // warehouse transfer prop
  onOpenWarehouseTransfer = null
}) {
  return (
    <div className="w-1/3 bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden flex flex-col min-h-0 h-full">
      <div className="accounting-card-title">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-black text-gray-900">
              {isKitMode ? 'Listado de Kits' : 'Listado de Items de Inventario'}
            </h3>
          </div>
          <button
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
            onClick={handleAddItem}
          >
            <Plus className="w-4 h-4 mr-2" />
            {isKitMode ? 'Agregar Kit' : 'Agregar Item'}
          </button>
        </div>
      </div>

      {/* Campo de búsqueda */}
      <div className="px-4 py-2 border-b border-gray-200">
        <input
          type="text"
          placeholder={isKitMode ? 'Buscar kit...' : 'Buscar item...'}
          value={itemSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        />
      </div>

      <nav className="tab-nav border-b border-gray-200 flex items-center">
        <div
          onClick={() => setItemTypeTab('services')}
          className={`tab-button ${itemTypeTab === 'services' ? 'active' : ''}`}
        >
          <span>Servicios</span>
          <span
            onClick={(e) => {
              e.stopPropagation()
              toggleDefaultTab()
            }}
            className="ml-2 p-1 hover:bg-gray-100 rounded transition-colors cursor-pointer"
            title={defaultItemTypeTab === 'services' ? 'Tab por defecto' : 'Establecer como tab por defecto'}
          >
            {defaultItemTypeTab === 'services' ? (
              <Lock className="w-3 h-3 text-blue-600" />
            ) : (
              <Unlock className="w-3 h-3 text-gray-400" />
            )}
          </span>
        </div>
        <div
          onClick={() => setItemTypeTab('products')}
          className={`tab-button ${itemTypeTab === 'products' ? 'active' : ''}`}
        >
          <span>Productos</span>
          <span
            onClick={(e) => {
              e.stopPropagation()
              toggleDefaultTab()
            }}
            className="ml-2 p-1 hover:bg-gray-100 rounded transition-colors cursor-pointer"
            title={defaultItemTypeTab === 'products' ? 'Tab por defecto' : 'Establecer como tab por defecto'}
          >
            {defaultItemTypeTab === 'products' ? (
              <Lock className="w-3 h-3 text-blue-600" />
            ) : (
              <Unlock className="w-3 h-3 text-gray-400" />
            )}
          </span>
        </div>
        <div
          onClick={() => {
            if (onSelectKitsTab) return onSelectKitsTab()
            return setItemTypeTab('kits')
          }}
          className={`tab-button ${itemTypeTab === 'kits' ? 'active' : ''}`}
        >
          <PackagePlus className="w-3 h-3 mr-1" />
          <span>Kits</span>
        </div>
        <div className="ml-auto pr-3 flex items-center gap-1">
          {/* Botón de transferencia entre almacenes - solo visible en modo productos */}
          {itemTypeTab === 'products' && onOpenWarehouseTransfer && (
            <button
              title="Transferencia entre almacenes"
              onClick={onOpenWarehouseTransfer}
              className="p-2 rounded-md hover:bg-violet-50 transition-colors"
            >
              <ArrowRightLeft className="w-4 h-4 text-violet-600" />
            </button>
          )}
          <button
            title={bulkModeActive ? 'Confirmar borrado masivo / Cancelar' : 'Modo borrado masivo'}
            onClick={onToggleBulkMode}
            className={`p-2 rounded-md hover:bg-gray-100 transition-colors ${bulkModeActive ? 'bg-red-50 border border-red-200' : ''}`}
          >
            <Trash2 className={`w-4 h-4 ${bulkModeActive ? 'text-red-600' : 'text-gray-600'}`} />
          </button>
        </div>
      </nav>

      {/* Warehouse Tabs Navigation */}
      {warehouseTabs.length > 0 && (
        <nav className="tab-nav border-b border-gray-200">
          {warehouseTabs.map(tab => (
            <div
              key={tab.base_code}
              onClick={() => setSelectedWarehouseTab(tab.base_code)}
              className={`tab-button ${selectedWarehouseTab === tab.base_code ? 'active' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span>{tab.base_code}</span>
                {(tab.qty_con > 0 || tab.qty_vcon > 0) && (
                  <Package2 className="w-3 h-3 text-orange-500" />
                )}
                <div className="flex gap-1">
                  {tab.qty_own > 0 && (
                    <span className="px-1 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                      OWN:{tab.qty_own}
                    </span>
                  )}
                  {tab.qty_con > 0 && (
                    <span className="px-1 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">
                      CON:{tab.qty_con}
                    </span>
                  )}
                  {tab.qty_vcon > 0 && (
                    <span className="px-1 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                      VCON:{tab.qty_vcon}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </nav>
      )}

      <div className="flex-1 p-6 overflow-hidden min-h-0 flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">Cargando items...</span>
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden">
            {/* table area - allow horizontal scroll only, no vertical scroll */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
            {/* Tabla de items (compacta: una sola línea por item) */}
            <div className="min-w-full">
              {/* Headers con ordenamiento - Primera fila */}
              <div className="bg-gray-100 sticky top-0 z-10 border-b border-gray-200">
                <div className="px-3 py-2 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  <div className="flex items-center gap-3">
                    {bulkModeActive && (() => {
                      const { items: headerVisibleItems } = getPaginatedItems()
                      const allSelected = headerVisibleItems && headerVisibleItems.length > 0 && headerVisibleItems.every(it => selectedForDelete.has(it.erp_item_code || it.name || it.item_code || ''))
                      return (
                        <div className="w-8 flex items-center justify-center">
                          <input
                            type="checkbox"
                            className="form-checkbox h-4 w-4 text-blue-600"
                            onChange={(e) => onToggleSelectAll(e.target.checked)}
                            checked={allSelected}
                            aria-label="Seleccionar todos"
                          />
                        </div>
                      )
                    })()}
                    <div className="w-40">
                      <div
                        className="cursor-pointer hover:text-blue-600 flex items-center gap-1"
                        onClick={() => handleSort('item_code')}
                      >
                        Código
                        {sortField === 'item_code' && (
                          <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div
                        className="cursor-pointer hover:text-blue-600 flex items-center gap-1"
                        onClick={() => handleSort('description')}
                      >
                        Descripción
                        {sortField === 'description' && (
                          <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </div>
                    <div className="w-28 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isKitMode ? 'Componentes' : 'Disponible'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Filtros - Segunda fila (ocultos en modo kits porque son específicos de items) */}
              {!isKitMode && (
                <div className="bg-gray-50 border-b border-gray-200">
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <div className="w-40">
                        <input
                          type="text"
                          placeholder="Filtrar código..."
                          value={filters.item_code}
                          onChange={(e) => handleFilterChange('item_code', e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div className="flex-1">
                        <input
                          type="text"
                          placeholder="Filtrar descripción..."
                          value={filters.description}
                          onChange={(e) => handleFilterChange('description', e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div className="w-28">
                        {/* Espacio vacío para mantener alineación */}
                      </div>
                    </div>
                  </div>
                </div>
              )}
                <div className="bg-white divide-y divide-gray-200">
                  {(() => {
                    const { items: paginatedItems } = getPaginatedItems()
                    return paginatedItems.map(item => {
                      const rowId = isKitMode ? (item.name || item.new_item_code || item.item_code) : extractItemCodeDisplay(item.item_code)
                      // Use a unique, stable React key (erp_item_code or name) to avoid duplicate key warnings.
                      const reactKey = item.erp_item_code || item.name || rowId
                      return (
                        <div
                          key={reactKey}
                          data-row-id={rowId}
                          className={`cursor-pointer transition-all duration-200 hover:bg-gray-100 px-3 py-2 flex items-center ${selectedItem === rowId ? 'selected bg-gray-200 border-l-4 border-gray-600' : ''}`}
                          onClick={() => { if (!bulkModeActive) setSelectedItem(rowId) }}
                        >
                        {bulkModeActive && (
                          <div className="w-8 flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={selectedForDelete.has(reactKey)}
                              onChange={(e) => {
                                e.stopPropagation()
                                onToggleSelectItem(reactKey)
                              }}
                              className="form-checkbox h-4 w-4 text-blue-600"
                              aria-label={`Select ${reactKey}`}
                            />
                          </div>
                        )}

                        <div className="w-40 text-sm font-medium text-gray-900 truncate">
                          {isKitMode ? extractItemCodeDisplay(item.name || item.new_item_code || item.item_code) : extractItemCodeDisplay(item.item_code)}
                        </div>
                        <div className="flex-1 text-sm text-gray-900 truncate">
                          {isKitMode
                            ? (
                                // Use only the kit-level `description` field (no fallbacks).
                                // If it's empty or missing, render nothing.
                                (item.description && item.description.toString().trim()) || ''
                              )
                            : (item.item_name || item.description)}
                        </div>
                        <div className="w-28 text-sm font-semibold text-gray-900 text-right">
                          {isKitMode ? (item.available_qty ?? 0) : (
                            item.is_stock_item ? (() => {
                              // Buscar el item en warehouseTabItems para mostrar cantidades fusionadas
                              const tabItem = warehouseTabItems.find(tabItem => tabItem.item_code === item.item_code)
                              if (tabItem) {
                                const { qty_own = 0, qty_con = 0, qty_vcon = 0, qty_total = 0 } = tabItem
                                return (
                                  <div className="flex flex-col items-end text-xs">
                                    <div className="font-bold">{formatNumber(qty_total)}</div>
                                    {(qty_con > 0 || qty_vcon > 0) && (
                                      <div className="flex gap-1 text-gray-500">
                                        {qty_own > 0 && <span>OWN:{qty_own}</span>}
                                        {qty_con > 0 && <span>CON:{qty_con}</span>}
                                        {qty_vcon > 0 && <span>VCON:{qty_vcon}</span>}
                                      </div>
                                    )}
                                  </div>
                                )
                              }
                              // Fallback al cache anterior si no está en warehouseTabItems
                              return formatNumber(itemDetailsCache[item.item_code] || 0)
                            })() : '-'
                          )}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>

            {/* Controles de paginación (siempre visibles at bottom) */}
            {(() => {
              const { totalItems, totalPages } = getPaginatedItems()
              const safeTotalPages = Math.max(totalPages || 1, 1)
              const start = totalItems === 0 ? 0 : Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)
              const end = Math.min(currentPage * itemsPerPage, totalItems)
              return (
                <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200">
                  <div className="text-sm text-gray-700">
                    Página {currentPage} de {safeTotalPages}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Anterior
                    </button>

                    {/* Números de página */}
                    {Array.from({ length: Math.min(5, safeTotalPages) }, (_, i) => {
                      let pageNum
                      if (safeTotalPages <= 5) {
                        pageNum = i + 1
                      } else if (currentPage <= 3) {
                        pageNum = i + 1
                      } else if (currentPage >= safeTotalPages - 2) {
                        pageNum = safeTotalPages - 4 + i
                      } else {
                        pageNum = currentPage - 2 + i
                      }

                      return (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`px-3 py-1 text-sm font-medium rounded-md ${
                            currentPage === pageNum
                              ? 'text-blue-600 bg-blue-50 border border-blue-500'
                              : 'text-gray-500 bg-white border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      )
                    })}

                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === safeTotalPages}
                      className="px-3 py-1 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )
            })()}
          
          </div>
          </div>
        )}
      </div>
    </div>
  )
}
