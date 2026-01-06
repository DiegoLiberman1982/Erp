import React, { useState } from 'react'
import { List, Eye, EyeOff, Plus, AlertCircle, Clock, CheckCircle } from 'lucide-react'
import { useNotification } from '../contexts/NotificationContext'
import PrepareModal from './PrepareModal'

export default function OrdersList({ orders = [], activeTab }) {
  const [selectedOrders, setSelectedOrders] = useState(new Set())
  const [expandedOrders, setExpandedOrders] = useState(new Set())
  const [selectedOrder, setSelectedOrder] = useState(null)
  const { showSuccess } = useNotification()

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

      {/* Orders List - Removed Table */}
      <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden border border-gray-200/30 p-12">
        <div className="text-center">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-2xl font-black text-gray-900 mb-2">Vista de Pedidos</h3>
          <p className="text-gray-600 font-medium">La tabla de pedidos ha sido removida temporalmente.</p>
          <p className="text-sm text-gray-500 mt-2">Mostrando {filteredOrders.length} pedidos en estado: <span className="font-bold">{activeTab}</span></p>
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
