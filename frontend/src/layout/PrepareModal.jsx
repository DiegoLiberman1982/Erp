import React, { useState, useRef, useEffect } from 'react'
import { X, Move, Maximize2, Minimize2 } from 'lucide-react'

export default function PrepareModal({ selectedOrder, onClose, onSave }) {
  const [modalMinimized, setModalMinimized] = useState(false)
  const [modalPosition, setModalPosition] = useState({ x: 150, y: 150 })
  const [isDragging, setIsDragging] = useState(false)
  const modalRef = useRef(null)
  const dragRef = useRef({ offsetX: 0, offsetY: 0 })

  const handleMouseDown = (e) => {
    if (e.target.closest('.modal-content')) return
    setIsDragging(true)
    const rect = modalRef.current.getBoundingClientRect()
    dragRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top
    }
  }

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging && modalRef.current) {
        const newX = e.clientX - dragRef.current.offsetX
        const newY = e.clientY - dragRef.current.offsetY
        
        const maxX = window.innerWidth - modalRef.current.offsetWidth
        const maxY = window.innerHeight - modalRef.current.offsetHeight
        
        setModalPosition({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY))
        })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  return (
    <div
      ref={modalRef}
      className={`fixed bg-white/95 backdrop-blur-xl border border-white/30 shadow-2xl rounded-2xl z-50 transition-all duration-300 ${
        modalMinimized ? 'w-80 h-16' : 'w-11/12 max-w-6xl h-5/6'
      }`}
      style={{
        left: `${modalPosition.x}px`,
        top: `${modalPosition.y}px`,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
    >
      {/* Modal Header */}
      <div
        className="flex justify-between items-center p-6 border-b border-gray-300/60 cursor-grab active:cursor-grabbing bg-gradient-to-r from-gray-100/90 to-gray-200/90 rounded-t-2xl"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center space-x-4">
          <Move className="w-6 h-6 text-gray-600" />
          <div>
            <h3 className="text-xl font-black text-gray-900">
              {selectedOrder.isMultiple ? 'Preparar Múltiples Pedidos' : `Preparar Pedido: ${selectedOrder.id}`}
            </h3>
            {!modalMinimized && (
              <p className="text-sm text-gray-700 font-semibold">Cliente: {selectedOrder.cliente}</p>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setModalMinimized(!modalMinimized)}
            className="p-3 text-gray-600 hover:text-gray-800 hover:bg-gray-200/70 rounded-xl transition-all duration-300 hover:scale-110"
          >
            {modalMinimized ? <Maximize2 className="w-5 h-5" /> : <Minimize2 className="w-5 h-5" />}
          </button>
          <button
            onClick={onClose}
            className="p-3 text-gray-600 hover:text-red-600 hover:bg-red-100/70 rounded-xl transition-all duration-300 hover:scale-110"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Modal Content */}
      {!modalMinimized && (
        <div className="modal-content p-6 overflow-hidden flex flex-col h-full">
          {selectedOrder.isMultiple && (
            <div className="mb-6 p-4 bg-gray-100/80 rounded-2xl border border-gray-300/40 shadow-lg">
              <p className="text-sm text-gray-800 font-bold">
                ⚡ Preparando {selectedOrder.originalOrders?.length || 0} pedidos simultáneamente
              </p>
            </div>
          )}

          <div className="overflow-auto flex-1">
            {selectedOrder.isMultiple ? (
              // Vista para múltiples pedidos
              <div className="border-2 border-gray-400/60 rounded-2xl overflow-hidden shadow-2xl">
                <div className="p-6">
                  <h4 className="text-lg font-black text-gray-900 mb-4">Pedidos incluidos:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {selectedOrder.originalOrders?.map(order => (
                      <div key={order.id} className="bg-white/80 rounded-xl p-4 shadow-lg border border-gray-200/50">
                        <div className="font-black text-gray-900">{order.id}</div>
                        <div className="text-sm text-gray-600 font-medium">{order.cliente}</div>
                        <div className="text-xs text-gray-500 mt-2">{order.items?.length || 0} items</div>
                      </div>
                    )) || []}
                  </div>
                </div>
              </div>
            ) : (
              // Vista normal para un solo pedido
              <div className="border-2 border-gray-400/60 rounded-2xl overflow-hidden shadow-2xl">
                <table className="min-w-full divide-y divide-gray-400/60">
                  <thead className="bg-gradient-to-r from-gray-200/90 to-gray-300/90">
                    <tr>
                      <th className="px-8 py-5 text-left text-xs font-black text-gray-800 uppercase tracking-wider">SKU</th>
                      <th className="px-8 py-5 text-left text-xs font-black text-gray-800 uppercase tracking-wider">Descripción</th>
                      <th className="px-8 py-5 text-left text-xs font-black text-gray-800 uppercase tracking-wider">Solicitado</th>
                      <th className="px-8 py-5 text-left text-xs font-black text-gray-800 uppercase tracking-wider">Preparado</th>
                      <th className="px-8 py-5 text-left text-xs font-black text-gray-800 uppercase tracking-wider">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white/90 divide-y divide-gray-300/60">
                    {selectedOrder.items?.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-100/60 transition-all duration-300">
                        <td className="px-8 py-5 whitespace-nowrap text-sm font-black text-gray-900">{item.sku}</td>
                        <td className="px-8 py-5 whitespace-nowrap text-sm text-gray-800 font-bold">{item.descripcion}</td>
                        <td className="px-8 py-5 whitespace-nowrap text-sm text-gray-700 font-black">{item.solicitado}</td>
                        <td className="px-8 py-5 whitespace-nowrap">
                          <input
                            type="number"
                            min="0"
                            max={item.solicitado}
                            defaultValue={item.preparado}
                            className="w-28 px-4 py-3 border-2 border-gray-300 rounded-xl text-sm font-black text-center focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-gray-600 bg-white/95 hover:border-gray-400 transition-all duration-300 shadow-lg"
                          />
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap">
                          {item.preparado === item.solicitado ? (
                            <span className="inline-flex px-4 py-2 text-xs font-black rounded-full bg-gradient-to-r from-green-200 to-green-300 text-green-900 shadow-lg">
                              ✅ Completo
                            </span>
                          ) : item.preparado > 0 ? (
                            <span className="inline-flex px-4 py-2 text-xs font-black rounded-full bg-gradient-to-r from-yellow-200 to-yellow-300 text-yellow-900 shadow-lg">
                              ⏳ Parcial
                            </span>
                          ) : (
                            <span className="inline-flex px-4 py-2 text-xs font-black rounded-full bg-gradient-to-r from-gray-200 to-gray-300 text-gray-700 shadow-lg">
                              ⏸️ Pendiente
                            </span>
                          )}
                        </td>
                      </tr>
                    )) || []}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200/40 bg-gradient-to-r from-gray-50/60 to-gray-100/60 -mx-6 -mb-6 px-6 pb-6 backdrop-blur-sm">
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-700 font-semibold">
                {selectedOrder.isMultiple 
                  ? `⚡ Preparando ${selectedOrder.originalOrders?.length || 0} pedidos simultáneamente`
                  : '🚀 Una vez completado, se enviará automáticamente a logística'
                }
              </div>
              <div className="flex space-x-4">
                <button
                  onClick={onClose}
                  className="px-6 py-3 border-2 border-gray-300 rounded-xl text-sm font-bold text-gray-700 bg-white/90 hover:bg-gray-50/90 transition-all duration-300 hover:shadow-lg hover:scale-105"
                >
                  Cancelar
                </button>
                <button
                  onClick={onSave}
                  className="px-6 py-3 border border-transparent rounded-xl shadow-lg text-sm font-bold text-white bg-gradient-to-r from-gray-700 via-gray-800 to-gray-900 hover:from-gray-600 hover:via-gray-700 hover:to-gray-800 transition-all duration-300 hover:shadow-xl transform hover:scale-105"
                >
                  {selectedOrder.isMultiple ? '🚀 Preparar y Enviar Pedidos' : '🚀 Preparar y Enviar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}