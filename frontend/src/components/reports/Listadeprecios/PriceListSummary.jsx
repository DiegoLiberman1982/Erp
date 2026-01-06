import React from 'react'
import { Tag, TrendingUp } from 'lucide-react'

/**
 * PriceListSummary
 * Props:
 *  - stats: Array<{ id?, title, value, description?, icon? }>
 *  - isLoading: boolean
 */
export default function PriceListSummary({ stats = [], isLoading = false }) {
  // Loading skeleton
  if (isLoading) {
    const skeletons = Array.from({ length: 4 })
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {skeletons.map((_, i) => (
          <div key={i} className="p-6 bg-white/80 rounded-2xl shadow-lg border border-gray-200/40">
            <div className="animate-pulse flex items-center gap-4">
              <div className="w-12 h-12 bg-gray-200 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-6 bg-gray-200 rounded w-2/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!Array.isArray(stats) || stats.length === 0) {
    return null
  }

  const renderIcon = (icon) => {
    if (!icon) return <Tag className="w-6 h-6 text-blue-600" />
    if (typeof icon === 'function') return React.createElement(icon, { className: 'w-6 h-6 text-gray-700' })
    switch (String(icon)) {
      case 'trending':
        return <TrendingUp className="w-6 h-6 text-green-600" />
      case 'tag':
      default:
        return <Tag className="w-6 h-6 text-blue-600" />
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat, idx) => (
        <div key={stat.id || stat.title || idx} className="p-6 bg-white/80 rounded-2xl shadow-lg border border-gray-200/40 flex items-center gap-4">
          <div className="flex-none">
            <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-gray-50">
              {renderIcon(stat.icon)}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-sm text-gray-500">{stat.title}</div>
            <div className="text-2xl font-black text-gray-900">{stat.value ?? '--'}</div>
            {stat.description ? <div className="text-xs text-gray-500 mt-1">{stat.description}</div> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
