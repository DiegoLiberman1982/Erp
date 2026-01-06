import React from 'react'
import { FileText, CheckCircle2, CircleDot, AlertTriangle, Loader2 } from 'lucide-react'

const statusConfig = {
  ready: {
    label: 'Configurado',
    icon: CheckCircle2,
    className: 'bg-green-100 text-green-800 border-green-200'
  },
  pending: {
    label: 'Pendiente',
    icon: CircleDot,
    className: 'bg-yellow-50 text-yellow-700 border-yellow-200'
  },
  missing: {
    label: 'Sin formato',
    icon: AlertTriangle,
    className: 'bg-red-50 text-red-700 border-red-200'
  }
}

const DocumentTypeList = ({ documents, selectedId, onSelect, summaries = {}, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Cargando formatos...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {documents.map((doc) => {
        const summary = summaries[doc.id] || {}
        const Icon = doc.icon || FileText
        const statusKey = summary.formatStatus || 'pending'
        const status = statusConfig[statusKey] || statusConfig.pending
        const StatusIcon = status.icon
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => onSelect(doc.id)}
            className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 ${
              selectedId === doc.id
                ? 'border-blue-500 bg-blue-50 shadow-sm'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-xl ${selectedId === doc.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{doc.label}</p>
                    <p className="text-xs text-gray-500">{doc.description}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-full border ${status.className}`}>
                    <StatusIcon className="w-3 h-3" />
                    {status.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-700">
                    {doc.docType}
                  </span>
                  {doc.channels?.map((channel) => (
                    <span
                      key={channel}
                      className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-700 capitalize"
                    >
                      {channel}
                    </span>
                  ))}
                  {summary.updatedAt && (
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-800">
                      Actualizado {new Date(summary.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {summary.messages?.length > 0 && (
              <ul className="mt-2 pl-6 list-disc text-xs text-gray-500 space-y-1">
                {summary.messages.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default DocumentTypeList
