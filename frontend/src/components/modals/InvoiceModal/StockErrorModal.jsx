import React from 'react'
import Modal from '../../Modal.jsx'
import { Package } from 'lucide-react'

/**
 * Helper para quitar la abbreviatura de compañía de un string
 * @param {string} str - String con posible abbreviatura (ej: "ALMACEN CENTRAL - ANC")
 * @returns {string} String sin abbreviatura
 */
const removeCompanyAbbr = (str) => {
  if (!str) return ''
  // Si termina con " - ABBR" (2-4 letras mayúsculas), quitarlo
  const match = String(str).match(/^(.+?)\s*-\s*[A-Z]{2,4}$/)
  return match ? match[1].trim() : str
}

/**
 * Modal para mostrar errores de stock insuficiente con alternativas
 * Usa el componente Modal base para mantener consistencia visual
 */
const StockErrorModal = ({ 
  isOpen, 
  onClose, 
  stockErrorData, 
  extractItemCodeDisplay 
}) => {
  if (!isOpen || !stockErrorData) return null

  // Preparar el nombre del item sin abbreviatura
  const itemDisplay = stockErrorData.item_name 
    ? removeCompanyAbbr(stockErrorData.item_name)
    : extractItemCodeDisplay 
      ? extractItemCodeDisplay(stockErrorData.item_code)
      : removeCompanyAbbr(stockErrorData.item_code)

  // Preparar el nombre del almacén sin abbreviatura
  const warehouseDisplay = removeCompanyAbbr(stockErrorData.warehouse)

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Stock Insuficiente"
      subtitle="La factura se guardó como borrador"
      size="md"
    >
      <div className="space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
        {/* Problema detectado */}
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Package className="w-5 h-5 text-red-600" />
              </div>
            </div>
            <div className="ml-3">
              <h4 className="text-sm font-medium text-red-800">Problema detectado:</h4>
              <div className="mt-2 text-sm text-red-700 space-y-1">
                <p>
                  Se necesitan <strong>{stockErrorData.required_qty}</strong> unidades de{' '}
                  <strong>{itemDisplay}</strong>
                </p>
                <p>
                  en almacén: <strong>{warehouseDisplay}</strong>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Alternativas disponibles */}
        {stockErrorData.alternative_warehouses && stockErrorData.alternative_warehouses.length > 0 ? (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 w-full">
                <h4 className="text-sm font-medium text-blue-800">
                  {stockErrorData.has_enough_combined 
                    ? `✅ Hay ${stockErrorData.total_available_elsewhere} unidades en otros almacenes (suficiente)`
                    : `⚠️ Solo hay ${stockErrorData.total_available_elsewhere} unidades en otros almacenes (no alcanza)`
                  }
                </h4>
                <div className="mt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-blue-800">
                        <th className="pb-2">Almacén</th>
                        <th className="pb-2 text-right">Disponible</th>
                      </tr>
                    </thead>
                    <tbody className="text-blue-700">
                      {stockErrorData.alternative_warehouses.map((wh, idx) => (
                        <tr key={idx} className="border-t border-blue-100">
                          <td className="py-2">{removeCompanyAbbr(wh.warehouse)}</td>
                          <td className="py-2 text-right font-medium">{wh.available_qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h4 className="text-sm font-medium text-orange-800">Sin alternativas</h4>
                <p className="mt-1 text-sm text-orange-700">
                  No hay stock disponible de este producto en ningún otro almacén.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Qué hacer */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h4 className="text-sm font-medium text-gray-800">¿Qué hacer?</h4>
              <ul className="mt-2 text-sm text-gray-700 list-disc list-inside space-y-1">
                <li>La factura se guardó como <strong>borrador</strong></li>
                <li>Ingresá el stock faltante (remito de compra, ajuste, transferencia)</li>
                {stockErrorData.has_enough_combined && (
                  <li>O cambiá el almacén del item en la factura a uno que tenga stock</li>
                )}
                <li>Cuando esté listo, volvé a abrir el borrador y confirmá</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Botón de cerrar */}
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="btn-secondary px-6 py-2.5 text-sm font-medium"
          >
            Entendido
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default StockErrorModal
