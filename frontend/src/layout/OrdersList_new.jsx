import React, { useState } from 'react'
import { List, Eye, EyeOff, Plus, AlertCircle, Clock, CheckCircle } from 'lucide-react'
import { useNotification } from '../contexts/NotificationContext'
import PrepareModal from './PrepareModal'

export default function OrdersList({ orders, activeTab }) {
  const [selectedOrders, setSelectedOrders] = useState(new Set())
  const [expandedOrders, setExpandedOrders] = useState(new Set())
  const [selectedOrder, setSelectedOrder] = useState(null)
  const { showSuccess } = useNotification()

  const formatDate = (dateString) => {
    if (!dateString) return ''
    const [year, month, day] = dateString.split('-')
    return `${day}-${month}-${year}`
  }

  const filteredOrders = orders.filter(order => {
    switch(activeTab) {
      case 'pendientes': return order.estado === 'pendiente'
      case 'proceso': return order.estado === 'proceso'
      case 'terminados': return order.estado === 'terminado'
      default: return true
    }
  })

  const handleSelectOrder = (orderId) => {
    const newSelected = new Set(selectedOrders)
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId)
    } else {
      newSelected.add(orderId)
    }
    setSelectedOrders(newSelected)
  }

  const handleSelectAll = () => {
    const currentOrders = filteredOrders.map(order => order.id)
    if (selectedOrders.size === currentOrders.length) {
      setSelectedOrders(new Set())
    } else {
      setSelectedOrders(new Set(currentOrders))
    }
  }

  const toggleOrderExpanded = (orderId) => {
    const newExpanded = new Set(expandedOrders)
    if (newExpanded.has(orderId)) {
      newExpanded.delete(orderId)
    } else {
      newExpanded.add(orderId)
    }
    setExpandedOrders(newExpanded)
  }

  const getStatusIcon = (estado) => {
    switch(estado) {
      case 'pendiente': return <AlertCircle className="w-5 h-5 text-orange-500" />
      case 'proceso': return <Clock className="w-5 h-5 text-blue-500" />
      case 'terminado': return <CheckCircle className="w-5 h-5 text-green-500" />
      default: return null
    }
  }

  const getStatusColor = (estado) => {
    switch(estado) {
      case 'pendiente': return 'bg-gradient-to-r from-orange-200 to-orange-300 text-orange-900'
      case 'proceso': return 'bg-gradient-to-r from-gray-300 to-gray-400 text-gray-900'
      case 'terminado': return 'bg-gradient-to-r from-green-200 to-green-300 text-green-900'
      default: return 'bg-gray-200 text-gray-800'
    }
  }

  const prepareSelectedOrders = () => {
    const selectedOrdersData = orders.filter(order => selectedOrders.has(order.id))
    if (selectedOrdersData.length === 1) {
      setSelectedOrder(selectedOrdersData[0])
    } else if (selectedOrdersData.length > 1) {
      // Create a combined order for multiple selection
      const combinedOrder = {
        id: `MULTI-${selectedOrdersData.length}`,
        cliente: `${selectedOrdersData.length} pedidos seleccionados`,
        fecha: new Date().toISOString().split('T')[0],
        estado: 'pendiente',
        isMultiple: true,
        originalOrders: selectedOrdersData,
        items: []
      }
      setSelectedOrder(combinedOrder)
    }
  }

  return (
    <>
      {/* Action bar */}
      {selectedOrders.size > 0 && (
        <div className="mb-6">
          <div className="bg-gradient-to-r from-gray-800 to-gray-900 border border-gray-700/60 rounded-3xl p-6 flex items-center justify-between shadow-2xl backdrop-blur-sm">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-gradient-to-r from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center shadow-lg">
                <CheckCircle className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-white">
                {selectedOrders.size} pedido{selectedOrders.size !== 1 ? 's' : ''} seleccionado{selectedOrders.size !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setSelectedOrders(new Set())}
                className="text-sm text-gray-300 hover:text-white font-bold transition-colors duration-200"
              >
                Desseleccionar todos
              </button>
              <button
                onClick={prepareSelectedOrders}
                className="inline-flex items-center px-8 py-4 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 transition-all duration-300 shadow-2xl hover:shadow-3xl hover:scale-105"
              >
                <Eye className="w-5 h-5 mr-2" />
                Preparar Seleccionados
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Orders List */}
      <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-gray-200/30">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gradient-to-r from-gray-100/90 to-gray-200/90 backdrop-blur-sm">
              <tr>
                <th className="px-8 py-5 text-left text-xs font-black text-gray-700 uppercase tracking-wider">
                  <input
                    type="checkbox"
                    checked={filteredOrders.length > 0 && selectedOrders.size === filteredOrders.length}
                    onChange={handleSelectAll}
                    className="rounded-lg border-gray-400 text-gray-800 focus:ring-gray-600 w-5 h-5 shadow-md"
                  />
                </th>
                <th className="px-8 py-5 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Pedido</th>
                <th className="px-8 py-5 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Cliente</th>
                <th className="px-8 py-5 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Fecha</th>
                <th className="px-8 py-5 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Estado</th>
                <th className="px-8 py-5 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Items</th>
                <th className="px-8 py-5 text-left text-xs font-black text-gray-700 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-300/40">
              {filteredOrders.map((order) => (
                <React.Fragment key={order.id}>
                  <tr className={`hover:bg-gray-100/60 transition-all duration-300 ${selectedOrders.has(order.id) ? 'bg-gray-200/60 shadow-lg' : ''}`}>
                    <td className="px-8 py-5 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(order.id)}
                        onChange={() => handleSelectOrder(order.id)}
                        className="rounded-lg border-gray-400 text-gray-800 focus:ring-gray-600 w-5 h-5 shadow-md"
                      />
                    </td>
                    <td className="px-8 py-5 whitespace-nowrap">
                      <div className="flex items-center">
                        <button
                          onClick={() => toggleOrderExpanded(order.id)}
                          className="mr-3 p-2 hover:bg-gray-200/80 rounded-xl transition-all duration-300 hover:scale-110 group"
                          title={expandedOrders.has(order.id) ? "Ocultar detalles" : "Ver detalles"}
                        >
                          {expandedOrders.has(order.id) ? 
                            <EyeOff className="w-5 h-5 text-gray-600 group-hover:text-gray-800" /> : 
                            <List className="w-5 h-5 text-gray-600 group-hover:text-gray-800" />
                          }
                        </button>
                        <span className="text-sm font-black text-gray-900">{order.id}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5 whitespace-nowrap text-sm font-bold text-gray-800">{order.cliente}</td>
                    <td className="px-8 py-5 whitespace-nowrap text-sm text-gray-600 font-medium">{formatDate(order.fecha)}</td>
                    <td className="px-8 py-5 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(order.estado)}
                        <span className={`inline-flex px-4 py-2 text-xs font-black rounded-full shadow-lg ${getStatusColor(order.estado)}`}>
                          {order.estado.charAt(0).toUpperCase() + order.estado.slice(1)}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-5 whitespace-nowrap text-sm text-gray-600 font-bold">
                      {order.items.length} artículo{order.items.length !== 1 ? 's' : ''}
                    </td>
                    <td className="px-8 py-5 whitespace-nowrap text-sm font-medium space-x-3">
                      <button
                        onClick={() => setSelectedOrder(order)}
                        className="inline-flex items-center px-5 py-3 border border-gray-400/60 shadow-lg text-sm leading-4 font-black rounded-2xl text-gray-800 bg-white/90 hover:bg-gray-100/90 transition-all duration-300 hover:shadow-xl hover:scale-105"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Preparar
                      </button>
                    </td>
                  </tr>
                  {expandedOrders.has(order.id) && (
                    <tr>
                      <td colSpan="7" className="px-8 py-6 bg-gray-50/60 backdrop-blur-sm">
                        <div className="ml-10">
                          <div className="bg-white/80 rounded-2xl p-6 shadow-xl border border-gray-200/50">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-700 uppercase font-black border-b-2 border-gray-300/50">
                                  <th className="text-left py-3">SKU</th>
                                  <th className="text-left py-3">Descripción</th>
                                  <th className="text-left py-3">Solicitado</th>
                                  <th className="text-left py-3">Preparado</th>
                                  <th className="text-left py-3">Estado</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200/60">
                                {order.items.map((item, idx) => (
                                  <tr key={idx} className="hover:bg-gray-100/60 transition-colors duration-200">
                                    <td className="py-3 font-black text-gray-900">{item.sku}</td>
                                    <td className="py-3 text-gray-700 font-semibold">{item.descripcion}</td>
                                    <td className="py-3 text-gray-700 font-bold">{item.solicitado}</td>
                                    <td className="py-3 text-gray-700 font-bold">{item.preparado}</td>
                                    <td className="py-3">
                                      {item.preparado === item.solicitado ? (
                                        <span className="inline-flex px-3 py-1 text-xs font-black rounded-full bg-green-200 text-green-900 shadow-md">
                                          ✅ Completo
                                        </span>
                                      ) : item.preparado > 0 ? (
                                        <span className="inline-flex px-3 py-1 text-xs font-black rounded-full bg-yellow-200 text-yellow-900 shadow-md">
                                          ⏳ Parcial
                                        </span>
                                      ) : (
                                        <span className="inline-flex px-3 py-1 text-xs font-black rounded-full bg-gray-200 text-gray-700 shadow-md">
                                          ⏸️ Pendiente
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Modal Window */}
      {selectedOrder && (
        <PrepareModal 
          selectedOrder={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onSave={() => {
            // Handle save logic here
            showSuccess(`Pedido ${selectedOrder.id} preparado correctamente!`)
            setSelectedOrder(null)
            setSelectedOrders(new Set())
          }}
        />
      )}
    </>
  )
}
