import React, { useContext, useEffect, useMemo, useState } from 'react'
import { Globe2, Settings, ShieldCheck, Clock3, RefreshCw, Save, MapPin, Mail, TrendingUp } from 'lucide-react'
import { AuthContext } from '../../AuthProvider'
import { useNotification } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import InflationIndicesTab from './InflationIndicesTab'

const CHECK_FIELDS = [
  'enable_onboarding',
  'setup_complete',
  'disable_document_sharing',
  'use_number_format_from_currency',
  'apply_strict_user_permissions',
  'allow_older_web_view_links',
  'deny_multiple_sessions'
]

const RECOMMENDED_SYSTEM = {
  currency: '',
  country: 'Argentina',
  time_zone: 'America/Argentina/Buenos_Aires',
  // Use language 'name' / code which is the Language doc name in ERPNext
  language: 'es-AR',
  deny_multiple_sessions: true,
  setup_complete: true
}

const RECOMMENDED_GLOBAL = {
  default_currency: '',
  country: 'Argentina'
}

const ROUNDING_LABELS = {
  "Banker's Rounding": 'Redondeo bancario',
  'Round Half Up': 'Redondeo a 0.5 hacia arriba',
  'Round Half Down': 'Redondeo a 0.5 hacia abajo',
  'Round Up': 'Redondeo hacia arriba',
  'Round Down': 'Redondeo hacia abajo'
}

const SystemSettings = () => {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useNotification()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('general')
  const [systemSettings, setSystemSettings] = useState({})
  const [globalDefaults, setGlobalDefaults] = useState({})
  const [options, setOptions] = useState({})
  const [siteBaseUrl, setSiteBaseUrl] = useState('')
  const [original, setOriginal] = useState({ systemSettings: {}, globalDefaults: {} })

  const clone = (obj) => JSON.parse(JSON.stringify(obj || {}))

  const normalizeChecks = (values) => {
    const copy = { ...values }
    CHECK_FIELDS.forEach((field) => {
      if (field in copy) {
        copy[field] = !!copy[field]
      }
    })
    return copy
  }

  const loadSettings = async () => {
    try {
      setLoading(true)
      const response = await fetchWithAuth(API_ROUTES.systemSettings)
      if (!response.ok) {
        showNotification('No se pudo cargar la configuracion del sistema', 'error')
        return
      }
      const payload = await response.json()
      if (!payload.success) {
        showNotification(payload.message || 'No se pudo cargar la configuracion', 'error')
        return
      }

      const data = payload.data || {}
      const sys = normalizeChecks(data.system_settings || {})
      if (!sys.app_name && data.site_base_url) {
        sys.app_name = data.site_base_url
      }

      const globals = data.global_defaults || {}
      setSystemSettings(sys)
      setGlobalDefaults(globals)
      setOptions(data.options || {})
      setSiteBaseUrl(data.site_base_url || '')
      setOriginal({ systemSettings: clone(sys), globalDefaults: clone(globals) })
    } catch (error) {
      console.error('Error loading system settings', error)
      showNotification('Error de conexion al cargar la configuracion', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const isDirty = useMemo(() => {
    return (
      JSON.stringify(systemSettings) !== JSON.stringify(original.systemSettings) ||
      JSON.stringify(globalDefaults) !== JSON.stringify(original.globalDefaults)
    )
  }, [systemSettings, globalDefaults, original])

  const handleSystemChange = (field, value) => {
    setSystemSettings((prev) => ({ ...prev, [field]: value }))
  }

  const handleGlobalChange = (field, value) => {
    setGlobalDefaults((prev) => ({ ...prev, [field]: value }))
  }

  const applyRecommended = () => {
    setSystemSettings((prev) => ({
      ...prev,
      ...RECOMMENDED_SYSTEM,
      app_name: prev.app_name || siteBaseUrl || prev.app_name
    }))
    setGlobalDefaults((prev) => ({
      ...prev,
      ...RECOMMENDED_GLOBAL
    }))
    showNotification('Valores recomendados aplicados. Recorda guardar los cambios.', 'info')
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const response = await fetchWithAuth(API_ROUTES.systemSettings, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          system_settings: systemSettings,
          global_defaults: globalDefaults
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        showNotification(errorData.message || 'No se pudo guardar la configuracion', 'error')
        return
      }

      const payload = await response.json()
      if (!payload.success) {
        showNotification(payload.message || 'No se pudo guardar la configuracion', 'error')
        return
      }

      const updatedSys = normalizeChecks((payload.data || {}).system_settings || systemSettings)
      const updatedGlobals = (payload.data || {}).global_defaults || globalDefaults
      setSystemSettings(updatedSys)
      setGlobalDefaults(updatedGlobals)
      setOriginal({ systemSettings: clone(updatedSys), globalDefaults: clone(updatedGlobals) })
      showNotification('Configuracion guardada correctamente', 'success')
    } catch (error) {
      console.error('Error saving system settings', error)
      showNotification('Error al guardar la configuracion', 'error')
    } finally {
      setSaving(false)
    }
  }

  const normalizeOptions = (values, field) => {
    let entries = []

    if (Array.isArray(values)) {
      entries = values
    } else if (typeof values === 'string') {
      entries = values.split(/[\n,]/)
    } else if (values && typeof values === 'object') {
      entries = Object.values(values)
    }

    const flat = (entries || [])
      .map((opt) => (typeof opt === 'string' ? opt.trim() : opt))
      .filter(Boolean)

    return flat.map((opt) => {
      if (typeof opt === 'object' && opt.value) {
        return { value: opt.value, label: opt.label || opt.value }
      }
      const label =
        field === 'rounding_method'
          ? ROUNDING_LABELS[opt] || opt
          : opt
      return { value: opt, label }
    })
  }

  const renderSelect = (label, field, value, onChange, values = [], placeholder = 'Selecciona una opcion') => {
    const safeOptions = normalizeOptions(values, field)
    // Garantizar que el valor actual aparezca como opci�n seleccionable
    if (value && !safeOptions.find((opt) => opt.value === value)) {
      safeOptions.unshift({ value, label: value })
    }

    return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-gray-700">{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(field, e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
      >
        <option value="">{placeholder}</option>
        {safeOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )}

  const renderInput = (label, field, value, onChange, type = 'text', placeholder = '') => (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-gray-700">{label}</label>
      <input
        type={type}
        value={value === undefined || value === null ? '' : value}
        onChange={(e) => {
          if (type === 'number') {
            const raw = e.target.value
            const parsed = raw === '' ? '' : Number(raw)
            onChange(field, Number.isNaN(parsed) ? '' : parsed)
          } else {
            onChange(field, e.target.value)
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
      />
    </div>
  )

  const renderToggle = (label, field, value) => (
    <button
      type="button"
      onClick={() => handleSystemChange(field, !value)}
      className={`flex items-center justify-between rounded-xl border px-4 py-2 text-sm font-semibold shadow-sm transition ${
        value ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-700'
      }`}
    >
      <span>{label}</span>
      <span
        className={`h-5 w-10 rounded-full border ${value ? 'border-green-500 bg-green-500/30' : 'border-gray-300 bg-gray-100'}`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white shadow transition ${value ? 'translate-x-5' : 'translate-x-1'}`}
        />
      </span>
    </button>
  )

  const renderGeneralTab = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12 text-gray-600">
          <RefreshCw className="mr-3 h-5 w-5 animate-spin" />
          Cargando configuracion del sistema...
        </div>
      )
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 rounded-3xl bg-white/70 p-6 shadow-2xl border border-gray-200/60">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-lg font-black text-gray-900">
                <Settings className="h-5 w-5 text-indigo-600" />
                Configuracion del Sistema
              </div>
              <p className="text-sm text-gray-600">
                Define los valores globales que ERPNext usa para idioma, moneda, zona horaria y seguridad.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {siteBaseUrl && (
                <div className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 border border-indigo-100">
                  Base del sitio: {siteBaseUrl}
                </div>
              )}
              <button type="button" className="btn-secondary" onClick={applyRecommended}>
                Aplicar valores sugeridos
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="rounded-3xl bg-white/80 p-6 shadow-xl border border-gray-200/60">
              <div className="flex items-center gap-2 text-base font-black text-gray-900">
                <Globe2 className="h-5 w-5 text-sky-600" />
                Localizacion
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {renderInput('Nombre de la app / sitio', 'app_name', systemSettings.app_name, handleSystemChange, 'text', 'Nombre visible en correos')}
                {renderSelect('Pais', 'country', systemSettings.country, handleSystemChange, options.countries || [])}
                {renderSelect('Idioma', 'language', systemSettings.language, handleSystemChange, options.languages || [])}
                {renderSelect('Moneda', 'currency', systemSettings.currency, handleSystemChange, options.currencies || [])}
                {renderSelect('Zona horaria', 'time_zone', systemSettings.time_zone, handleSystemChange, options.time_zones || [])}
                {renderSelect('Formato de fecha', 'date_format', systemSettings.date_format, handleSystemChange, options.date_formats || [])}
                {renderSelect('Formato de hora', 'time_format', systemSettings.time_format, handleSystemChange, options.time_formats || [])}
                {renderSelect('Primer dia de la semana', 'first_day_of_the_week', systemSettings.first_day_of_the_week, handleSystemChange, options.first_day_of_the_week || [])}
                {renderSelect('Formato numerico', 'number_format', systemSettings.number_format, handleSystemChange, options.number_formats || [])}
                {renderSelect('Precision para decimales', 'float_precision', systemSettings.float_precision, handleSystemChange, options.float_precision || [])}
                {renderSelect('Precision para moneda', 'currency_precision', systemSettings.currency_precision, handleSystemChange, options.currency_precision || [])}
                {renderSelect('Metodo de redondeo', 'rounding_method', systemSettings.rounding_method, handleSystemChange, options.rounding_method || [])}
              </div>
              <div className="mt-6 grid gap-3 lg:grid-cols-2">
                {renderToggle('Usar formato numerico de la moneda', 'use_number_format_from_currency', systemSettings.use_number_format_from_currency)}
                {renderToggle('Deshabilitar comparticion de documentos', 'disable_document_sharing', systemSettings.disable_document_sharing)}
              </div>
            </div>

            <div className="rounded-3xl bg-white/80 p-6 shadow-xl border border-gray-200/60">
              <div className="flex items-center gap-2 text-base font-black text-gray-900">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                Seguridad y sesiones
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {renderInput(
                  'Vencimiento de sesion (horas)',
                  'session_expiry',
                  systemSettings.session_expiry,
                  handleSystemChange,
                  'number',
                  'Ej: 12'
                )}
                {renderInput(
                  'Vencimiento de claves de comparticion (dias)',
                  'document_share_key_expiry',
                  systemSettings.document_share_key_expiry,
                  handleSystemChange,
                  'number',
                  'Ej: 7'
                )}
                {renderToggle('Denegar sesiones multiples', 'deny_multiple_sessions', systemSettings.deny_multiple_sessions)}
                {renderToggle('Aplicar permisos estrictos', 'apply_strict_user_permissions', systemSettings.apply_strict_user_permissions)}
                {renderToggle('Permitir web view antiguos', 'allow_older_web_view_links', systemSettings.allow_older_web_view_links)}
                {renderToggle('Habilitar onboarding', 'enable_onboarding', systemSettings.enable_onboarding)}
                {renderToggle('Marcar setup como completo', 'setup_complete', systemSettings.setup_complete)}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl bg-white/80 p-6 shadow-xl border border-gray-200/60">
              <div className="flex items-center gap-2 text-base font-black text-gray-900">
                <Mail className="h-5 w-5 text-amber-600" />
                Plantillas y branding
              </div>
              <div className="mt-4 grid gap-4">
                {renderSelect(
                  'Template de bienvenida',
                  'welcome_email_template',
                  systemSettings.welcome_email_template,
                  handleSystemChange,
                  options.email_templates || [],
                  'Selecciona plantilla de email'
                )}
                {renderSelect(
                  'Template de reseteo de clave',
                  'reset_password_template',
                  systemSettings.reset_password_template,
                  handleSystemChange,
                  options.email_templates || [],
                  'Selecciona plantilla de email'
                )}
              </div>
            </div>

            <div className="rounded-3xl bg-white/80 p-6 shadow-xl border border-gray-200/60">
              <div className="flex items-center gap-2 text-base font-black text-gray-900">
                <MapPin className="h-5 w-5 text-rose-600" />
                Global Defaults
              </div>
              <div className="mt-4 grid gap-4">
                {renderSelect(
                  'Pais por defecto',
                  'country',
                  globalDefaults.country,
                  handleGlobalChange,
                  options.countries || []
                )}
                {renderSelect(
                  'Moneda por defecto',
                  'default_currency',
                  globalDefaults.default_currency,
                  handleGlobalChange,
                  options.currencies || []
                )}
                {renderSelect(
                  'Unidad de distancia',
                  'default_distance_unit',
                  globalDefaults.default_distance_unit,
                  handleGlobalChange,
                  options.distance_units || []
                )}
              </div>
            </div>

            <div className="rounded-3xl bg-white/80 p-4 shadow-xl border border-gray-200/60 flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm text-gray-700">
                <Clock3 className="h-5 w-5 text-indigo-500" />
                <div>
                  <div className="font-semibold text-gray-900">Cambios pendientes</div>
                  <div className="text-xs text-gray-600">
                    Guarda para aplicar en ERPNext. Los valores sugeridos se pueden ajustar antes de confirmar.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary flex items-center gap-2"
                disabled={!isDirty || saving}
                onClick={handleSave}
              >
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Guardando...' : 'Guardar configuracion'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="tabs-container">
        <div className="tab-nav">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`tab-button ${activeTab === 'general' ? 'active' : ''}`}
          >
            <Settings className="h-4 w-4" />
            Ajustes del sistema
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inflacion')}
            className={`tab-button ${activeTab === 'inflacion' ? 'active' : ''}`}
          >
            <TrendingUp className="h-4 w-4" />
            Indices de inflacion (AR)
          </button>
        </div>
      </div>

      {activeTab === 'general' ? renderGeneralTab() : <InflationIndicesTab />}
    </div>
  )
}

export default SystemSettings
