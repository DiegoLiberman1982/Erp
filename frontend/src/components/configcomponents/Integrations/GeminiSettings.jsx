import React from 'react'
import { Bot, Sparkles, ToggleRight } from 'lucide-react'

const GeminiSettings = ({ data, onChange }) => {
  const settings = data || {}
  const handleTextChange = (field) => (event) => onChange(field, event.target.value)
  const handleToggle = (field) => (event) => onChange(field, event.target.checked)

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-slate-50 to-purple-50 border border-purple-100 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <Bot className="w-5 h-5 text-purple-600 mt-1" />
          <div>
            <p className="text-sm font-semibold text-purple-800">Gemini y servicios de IA</p>
            <p className="text-xs text-purple-600 mt-1">
              Centraliza la API Key de Google AI Studio para reutilizarla en asistentes o automatizaciones recien creadas.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <ToggleRight className="w-4 h-4 text-purple-500" />
            Integracion activa
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Usa esta bandera para habilitar o pausar el consumo de Gemini desde el backend.
          </p>
        </div>
        <label className="integrations-toggle">
          <input
            type="checkbox"
            className="integrations-toggle-input"
            checked={!!settings.enabled}
            onChange={handleToggle('enabled')}
          />
          <span className={`toggle-switch ${settings.enabled ? 'on' : ''}`} aria-hidden="true" />
        </label>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">API Key</label>
        <input
          type="text"
          value={settings.apiKey || ''}
          onChange={handleTextChange('apiKey')}
          className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-purple-200"
          placeholder="AIza..."
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Project ID</label>
          <input
            type="text"
            value={settings.projectId || ''}
            onChange={handleTextChange('projectId')}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-purple-200"
            placeholder="proyecto-gemini"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Modelo preferido</label>
          <input
            type="text"
            value={settings.model || ''}
            onChange={handleTextChange('model')}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-purple-200"
            placeholder="gemini-pro, gemini-1.5, etc."
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Notas o prompts recomendados</label>
        <textarea
          rows={4}
          value={settings.additionalInfo || ''}
          onChange={handleTextChange('additionalInfo')}
          className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-purple-200 bg-white resize-none"
          placeholder="Describe que servicios usan esta API o que prompts iniciales deben configurarse."
        />
      </div>

      <div className="text-xs text-gray-500 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-400" />
        Recuerda rotar las claves periodicamente y registrar a los usuarios que tienen acceso.
      </div>
    </div>
  )
}

export default GeminiSettings
