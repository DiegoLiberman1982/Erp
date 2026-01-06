import React from 'react'
import { Mail, Save } from 'lucide-react'

const defaultTemplate = {
  enabled: true,
  subject: '',
  body: '',
  cc: '',
  bcc: ''
}

const EmailTemplateEditor = ({
  template = defaultTemplate,
  onChange,
  onSave,
  saving
}) => {
  const handleChange = (field, value) => {
    onChange && onChange({
      ...template,
      [field]: value
    })
  }

  return (
    <section className="p-5 bg-white rounded-3xl border border-gray-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-indigo-600" />
            Plantilla de Email
          </p>
          <p className="text-xs text-gray-500">Definí el asunto y contenido del correo que acompaña el PDF.</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <span className="mr-2 text-xs font-medium text-gray-600">Email automático</span>
          <input
            type="checkbox"
            className="sr-only peer"
            checked={template.enabled}
            onChange={(e) => handleChange('enabled', e.target.checked)}
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-indigo-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:h-5 after:w-5 after:rounded-full after:transition-all relative" />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1 text-xs font-semibold text-gray-600">
          Asunto
          <input
            type="text"
            value={template.subject}
            onChange={(e) => handleChange('subject', e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500"
            placeholder="Ej: {{ doc.company }} - {{ doc.name }}"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs font-semibold text-gray-600">
            CC
            <input
              type="text"
              value={template.cc || ''}
              onChange={(e) => handleChange('cc', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500"
              placeholder="cc@mail.com"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-gray-600">
            BCC
            <input
              type="text"
              value={template.bcc || ''}
              onChange={(e) => handleChange('bcc', e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-2xl px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500"
              placeholder="bcc@mail.com"
            />
          </label>
        </div>
      </div>

      <label className="space-y-1 text-xs font-semibold text-gray-600">
        Contenido del correo
        <textarea
          rows={6}
          value={template.body}
          onChange={(e) => handleChange('body', e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 resize-none"
          placeholder={`Hola {{ recipient_name }},\nAdjuntamos el comprobante {{ doc.name }} correspondiente a {{ doc.customer_name }}.`}
        />
      </label>

      <div className="flex items-center justify-between pt-2">
        <p className="text-[11px] text-gray-500">
          Podés usar variables como{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{ doc.name }}'}</code> o{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{ doc.company }}'}</code>.
        </p>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={`btn-primary gap-2 ${saving ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          <Save className="w-4 h-4" />
          {saving ? 'Guardando...' : 'Guardar Plantilla'}
        </button>
      </div>
    </section>
  )
}

export default EmailTemplateEditor
