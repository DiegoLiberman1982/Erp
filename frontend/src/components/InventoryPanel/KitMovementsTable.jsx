import React, { useEffect, useMemo, useState } from 'react'
import { Package, BarChart3, Warehouse, Clock } from 'lucide-react'
import { formatDate, formatCurrency, formatNumber, mapVoucherTypeToSigla, extractItemCodeDisplay, formatVoucherNo } from './inventoryUtils'

/**
 * Tabla de movimientos de inventario para kits - muestra los movimientos
 * de cada componente del kit con una columna adicional para identificar el componente.
 */
export default function KitMovementsTable({ movements, selectedKit, movementWarehouseTab, warehouses, openRemitoForEdit }) {
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 15

  const isConsignmentWarehouseName = (name) => {
    const s = (name || '').toString()
    return s.includes('__CON[') || s.includes('__VCON[')
  }

  // Resetear a la primera pagina cuando cambia el kit, el filtro de deposito o los datos
  useEffect(() => {
    setCurrentPage(1)
  }, [selectedKit, movementWarehouseTab, movements])

  // Filtrar por deposito/tab seleccionado y ocultar Stock Reconciliation con qty=0
  const filteredMovements = useMemo(() => {
    // Backend already filters by docstatus=1 and is_cancelled=0, so we only need to:
    // 1. Include reservations (is_reservation: true) always
    // 2. Hide Stock Reconciliation with qty=0
    const baseMovements = Array.isArray(movements)
      ? movements.filter(m => {
          // Las reservas siempre se incluyen
          if (m.is_reservation) return true
          // Ocultar Stock Reconciliation con qty = 0
          const qty = Number(m?.actual_qty)
          const voucherType = (m?.voucher_type || '').toString().toLowerCase()
          const isStockReconciliation = voucherType === 'stock reconciliation' || voucherType.includes('reconciliation')
          if (!isNaN(qty) && qty === 0 && isStockReconciliation) return false
          return true
        })
      : []
    if (movementWarehouseTab === 'all') return baseMovements
    if (movementWarehouseTab === 'own') {
      return baseMovements.filter(m => !isConsignmentWarehouseName(m?.warehouse))
    }
    if (movementWarehouseTab === 'consignment') {
      return baseMovements.filter(m => isConsignmentWarehouseName(m?.warehouse))
    }

    const norm = (s) => (s || '').toString().trim().toUpperCase()
    const tabNorm = norm(movementWarehouseTab)

    return baseMovements.filter(m => {
      // For any specific base-warehouse tab, exclude consignment variants.
      if (isConsignmentWarehouseName(m?.warehouse)) return false

      const mw = m.warehouse || ''
      const mwNorm = norm(mw)
      if (mwNorm === tabNorm) return true
      if (mw.includes('__')) {
        const basePrefix = mw.split('__')[0].trim()
        if (norm(basePrefix) === tabNorm) return true
        if (norm(basePrefix).includes(tabNorm) || tabNorm.includes(norm(basePrefix))) return true
      }
      if (mwNorm.includes(tabNorm) || tabNorm.includes(mwNorm)) return true
      return false
    })
  }, [movements, movementWarehouseTab])

  // Sin kit seleccionado
  if (!selectedKit || selectedKit === 'new') {
    return (
      <div className="text-center py-12 text-gray-500">
        <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>Selecciona un kit del panel izquierdo para ver los movimientos de sus componentes</p>
      </div>
    )
  }

  // Sin movimientos totales
  if (!movements || movements.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No hay movimientos registrados para los componentes de este kit</p>
      </div>
    )
  }

  if (filteredMovements.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Warehouse className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No hay movimientos en este deposito</p>
      </div>
    )
  }

  const totalPages = Math.max(Math.ceil(filteredMovements.length / itemsPerPage), 1)
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const pageMovements = filteredMovements.slice(startIndex, endIndex)

  const handleRowClick = (movement) => {
    try {
      if (!movement) return
      const voucherNo = movement.voucher_no || movement.voucher || movement.voucher_name
      const vtype = (movement.voucher_type || '').toString().toLowerCase()
      const isRemitoType = vtype.includes('remito') || vtype.includes('purchase receipt') || vtype.includes('receipt') || vtype.includes('delivery')
      if (voucherNo && isRemitoType && typeof openRemitoForEdit === 'function') {
        openRemitoForEdit(voucherNo)
      }
    } catch (e) {
      console.error('Error handling movement row click', e)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Fecha
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Componente
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Deposito
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Descripcion
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                TipoDoc
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Precio
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cantidad
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pageMovements.map((movement, index) => {
              const isReservation = movement.is_reservation === true
              // Extraer el código del componente del kit
              const componentCode = movement.kit_item_code || movement.item_code || ''
              const displayComponentCode = extractItemCodeDisplay(componentCode)
              
              return (
                <tr 
                  key={index} 
                  className={`hover:bg-gray-50 cursor-pointer ${isReservation ? 'bg-amber-50' : ''}`} 
                  onClick={() => handleRowClick(movement)}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {isReservation ? (
                      <span className="inline-flex items-center text-amber-600" title="Reserva de stock activa">
                        <Clock className="w-4 h-4 mr-1" />
                        Reservado
                      </span>
                    ) : (
                      formatDate(movement.posting_date)
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800" title={componentCode}>
                      {displayComponentCode || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {(() => {
                      const norm = (s) => (s || '').toString().trim().toUpperCase()
                      const mw = (movement.warehouse || '')
                      const nmw = norm(mw)

                      const warehouse = (warehouses || []).find(w => {
                        try {
                          const wn = norm(w.name)
                          const wlabel = norm(w.warehouse_name || w.display_name || '')
                          if (wn === nmw || wlabel === nmw) return true

                          if (mw.includes('__')) {
                            const basePrefix = mw.split('__')[0].trim()
                            const baseNorm = norm(basePrefix)
                            if (wn.includes(baseNorm) || wlabel.includes(baseNorm)) return true
                          }

                          if (wn.includes(nmw) || nmw.includes(wn)) return true
                        } catch (e) {
                          return false
                        }
                        return false
                      })

                      if (!warehouse) return (movement.warehouse || '-')

                      const isConsignment = Boolean(warehouse.has_consignment || warehouse.is_consignment_variant || warehouse.consignment_count)

                      return (
                        <span className="inline-flex items-center" title={isConsignment ? 'Consignacion' : ''}>
                          {isConsignment ? <Package className="w-4 h-4 mr-2 text-green-600" /> : null}
                          <span>{warehouse.warehouse_name}</span>
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900" title={movement.voucher_no || ''}>
                    {formatVoucherNo(movement.voucher_no)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {isReservation ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                        RESERVA
                      </span>
                    ) : (
                      mapVoucherTypeToSigla(movement.voucher_type)
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                    {isReservation ? '-' : formatCurrency(movement.incoming_rate || movement.valuation_rate)}
                  </td>
                  <td className={`px-4 py-3 whitespace-nowrap text-sm font-medium text-right ${
                    isReservation 
                      ? 'text-amber-600' 
                      : movement.actual_qty > 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {isReservation ? (
                      <span title="Cantidad reservada pendiente de entrega">
                        -{formatNumber(movement.reserved_qty)}
                      </span>
                    ) : (
                      <>
                        {movement.actual_qty > 0 ? '+' : ''}{formatNumber(movement.actual_qty)}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200">
        <div className="text-sm text-gray-700">
          Pagina {safePage} de {totalPages} · Mostrando {filteredMovements.length === 0 ? 0 : startIndex + 1} a {Math.min(endIndex, filteredMovements.length)} de {filteredMovements.length} movimientos
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCurrentPage(safePage - 1)}
            disabled={safePage === 1}
            className="px-3 py-1 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anterior
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum
            if (totalPages <= 5) {
              pageNum = i + 1
            } else if (safePage <= 3) {
              pageNum = i + 1
            } else if (safePage >= totalPages - 2) {
              pageNum = totalPages - 4 + i
            } else {
              pageNum = safePage - 2 + i
            }
            return (
              <button
                key={pageNum}
                onClick={() => setCurrentPage(pageNum)}
                className={`px-3 py-1 text-sm font-medium rounded-md ${
                  safePage === pageNum
                    ? 'text-blue-600 bg-blue-50 border border-blue-500'
                    : 'text-gray-500 bg-white border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {pageNum}
              </button>
            )
          })}
          <button
            onClick={() => setCurrentPage(safePage + 1)}
            disabled={safePage === totalPages}
            className="px-3 py-1 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  )
}
