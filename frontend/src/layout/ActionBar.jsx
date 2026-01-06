import React from 'react'
import { CheckCircle, Eye } from 'lucide-react'

export default function ActionBar({selectedCount, onClear, onPrepare}){
  if(!selectedCount) return null
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 border border-gray-700/60 rounded-3xl p-6 flex items-center justify-between shadow-2xl backdrop-blur-sm">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-gradient-to-r from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center shadow-lg">
            <CheckCircle className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold text-white">{selectedCount} pedido{selectedCount!==1 ? 's' : ''} seleccionado{selectedCount!==1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center space-x-4">
          <button onClick={onClear} className="text-sm text-gray-300 hover:text-white font-bold transition-colors duration-200">Desseleccionar todos</button>
          <button onClick={onPrepare} className="inline-flex items-center px-8 py-4 border border-transparent text-sm font-black rounded-2xl text-white bg-gradient-to-r from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 transition-all duration-300 shadow-2xl hover:shadow-3xl hover:scale-105">
            <Eye className="w-5 h-5 mr-2" />
            Preparar Seleccionados
          </button>
        </div>
      </div>
    </div>
  )
}
