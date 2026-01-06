import React from 'react'

export default function Tabs({ activeTab, setActiveTab, orders = [] }) {
  const tabs = [
    { id: 'pendientes', label: 'Pendientes', count: orders.filter(o => o.estado === 'pendiente').length },
    { id: 'proceso', label: 'En Proceso', count: orders.filter(o => o.estado === 'proceso').length },
    { id: 'terminados', label: 'Terminados', count: orders.filter(o => o.estado === 'terminado').length }
  ]

  return (
    <div className="border-b border-gray-300/50 mb-8">
      <nav className="-mb-px flex space-x-8">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-4 px-4 border-b-4 font-bold text-sm flex items-center space-x-3 transition-all duration-300 ${
              activeTab === tab.id
                ? 'border-gray-700 text-gray-900 bg-gray-100/60 shadow-lg'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-400 hover:bg-gray-50/60'
            } rounded-t-2xl`}
          >
            <span className="text-lg">{tab.label}</span>
            <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-black shadow-lg ${
              activeTab === tab.id 
                ? 'bg-gradient-to-r from-gray-700 to-gray-900 text-white' 
                : 'bg-gradient-to-r from-gray-200 to-gray-300 text-gray-700'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </nav>
    </div>
  )
}
