import React from 'react'
import { Clock, KeyRound, ShieldAlert } from 'lucide-react'

const ApiKeyManager = ({ metadata, generating, onGenerate, onNotesChange }) => {
  const lastGeneratedAt = metadata?.lastGeneratedAt
  const lastGeneratedBy = metadata?.lastGeneratedBy
  const notes = metadata?.notes || ''

  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="p-5 rounded-2xl border border-amber-200 bg-amber-50">
          <div className="flex items-center gap-3 mb-3 text-amber-600">
            <ShieldAlert className="w-5 h-5" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide">Advertencia</p>
              <p className="text-xs text-amber-800">ERPNext solo expone la API Key una vez</p>
            </div>
          </div>
          <p className="text-sm text-amber-900 leading-relaxed">
            Cada generacion invalida la clave anterior. Al cerrar este cuadro no podremos mostrarte el secreto nuevamente,
            por lo que debes copiarlo y distribuirlo en tus integraciones inmediatamente.
          </p>
        </div>
        <div className="p-5 rounded-2xl border border-blue-200 bg-blue-50">
          <div className="flex items-center gap-3 mb-3 text-blue-700">
            <Clock className="w-5 h-5" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide">Ultima generacion</p>
              <p className="text-xs text-blue-600">Controla cuando se emitio la ultima API Key</p>
            </div>
          </div>
          <p className="text-sm text-blue-900">
            Fecha: <span className="font-semibold">{formatDate(lastGeneratedAt)}</span>
          </p>
          <p className="text-sm text-blue-900 mt-1">
            Usuario: <span className="font-semibold">{lastGeneratedBy || 'Sin registro'}</span>
          </p>
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-500" />
              Generar nueva API Key
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Confirmaremos antes de continuar y te mostraremos las nuevas credenciales.
            </p>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className={`btn-secondary integrations-generate-btn${generating ? ' is-loading' : ''}`}
          >
            {generating && (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 10-8 8z" />
              </svg>
            )}
            {generating ? 'Generando...' : 'Generar y mostrar'}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Notas internas</label>
        <textarea
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          rows={4}
          className="w-full rounded-2xl border border-gray-300 focus:ring-2 focus:ring-blue-200 focus:border-blue-300 px-4 py-3 text-sm bg-white resize-none"
          placeholder="Documenta donde se uso esta API Key o referencia alguna integracion externa."
        />
      </div>
    </div>
  )
}

const formatDate = (value) => {
  if (!value) return 'Nunca generado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export default ApiKeyManager
