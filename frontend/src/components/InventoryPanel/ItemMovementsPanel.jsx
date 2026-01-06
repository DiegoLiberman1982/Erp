import React, { useEffect } from 'react'
import { BarChart3 } from 'lucide-react'
import MovementsTable from './MovementsTable'

const ItemMovementsPanel = ({
  selectedItem,
  itemMovements,
  movementWarehouseTab,
  warehouses,
  setMovementWarehouseTab,
  openRemitoForEdit,
  openStockReconciliation
}) => {
  const baseWarehouses = Array.isArray(warehouses) ? warehouses.filter(w => !w?.is_consignment_variant) : []
  const hasConsignmentFromMovements = Array.isArray(itemMovements)
    ? itemMovements.some(m =>
        (m?.warehouse || '').toString().includes('__CON[') ||
        (m?.warehouse || '').toString().includes('__VCON[')
      )
    : false
  const showConsignmentTab = hasConsignmentFromMovements

  useEffect(() => {
    if (movementWarehouseTab === 'consignment' && !showConsignmentTab) {
      setMovementWarehouseTab('all')
    }
  }, [movementWarehouseTab, showConsignmentTab, setMovementWarehouseTab])

  return (
    <div className="flex-1 bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden min-w-0 flex flex-col min-h-0 h-full">
      <div className="accounting-card-title">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-black text-gray-900">
              Movimientos de Inventario del Item
            </h3>
          </div>
        </div>
      </div>

      {/* Pestañas de almacenes */}
      {selectedItem && selectedItem !== 'new' && itemMovements.length > 0 && (
        <nav className="tab-nav border-b border-gray-200">
          <button
            onClick={() => setMovementWarehouseTab('all')}
            className={`tab-button ${movementWarehouseTab === 'all' ? 'active' : ''}`}
          >
            Todos los almacenes
          </button>
          {showConsignmentTab && (
            <>
              <button
                onClick={() => setMovementWarehouseTab('consignment')}
                className={`tab-button ${movementWarehouseTab === 'consignment' ? 'active' : ''}`}
              >
                Consignación
              </button>
            </>
          )}
          {baseWarehouses.map(warehouse => (
            <button
              key={warehouse.name}
              onClick={() => setMovementWarehouseTab(warehouse.name)}
              className={`tab-button ${movementWarehouseTab === warehouse.name ? 'active' : ''}`}
            >
              {warehouse.warehouse_name}
            </button>
          ))}
        </nav>
      )}

      <div className="flex-1 p-6 overflow-hidden">
        <MovementsTable
          movements={itemMovements}
          selectedItem={selectedItem}
          movementWarehouseTab={movementWarehouseTab}
          warehouses={warehouses}
          openRemitoForEdit={openRemitoForEdit}
          openStockReconciliation={openStockReconciliation}
          hideZeroMovements={true}
        />
      </div>
    </div>
  )
}

export default ItemMovementsPanel
