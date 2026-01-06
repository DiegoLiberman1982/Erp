import React, { useContext, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, CreditCard, KeyRound, Loader2 } from 'lucide-react'
import Modal from '../../Modal'
import API_ROUTES from '../../../apiRoutes'
import ApiKeyManager from './ApiKeyManager'
import MercadoPagoSettings from './MercadoPagoSettings'
import GeminiSettings from './GeminiSettings'
import { AuthContext } from '../../../AuthProvider'

const DEFAULT_SETTINGS = {
  apiKey: {
    lastGeneratedAt: null,
    lastGeneratedBy: null,
    notes: ''
  },
  mercadopago: {
    enabled: false,
    publicKey: '',
    accessToken: '',
    refreshToken: '',
    userId: '',
    webhookSecret: '',
    testMode: true,
    additionalInfo: '',
    reportPrefix: '',
    reportTimezone: 'GMT-03',
    notificationEmails: '',
    defaultSyncDays: 3,
    lastSyncAt: null,
    lastReportId: '',
    lastSyncRange: null,
    lastSyncCount: 0,
    lastSyncStatus: ''
  },
  gemini: {
    enabled: false,
    apiKey: '',
    projectId: '',
    model: '',
    additionalInfo: ''
  }
}

const SUB_TABS = [
  { id: 'apiKey', label: 'API Key', icon: KeyRound },
  { id: 'mercadopago', label: 'Mercado Pago', icon: CreditCard },
  { id: 'gemini', label: 'Gemini', icon: Bot }
]

const deepClone = (value) => JSON.parse(JSON.stringify(value ?? {}))

const mergeWithDefaults = (incoming) => {
  const base = deepClone(DEFAULT_SETTINGS)
  if (!incoming || typeof incoming !== 'object') {
    return base
  }

  const merged = { ...base }
  Object.keys(incoming).forEach((sectionKey) => {
    const sectionValue = incoming[sectionKey]
    if (sectionValue && typeof sectionValue === 'object' && !Array.isArray(sectionValue)) {
      merged[sectionKey] = { ...(base[sectionKey] || {}), ...sectionValue }
    } else {
      merged[sectionKey] = sectionValue
    }
  })
  return merged
}

const IntegrationsTab = ({ fetchWithAuth, showNotification, confirm }) => {
  const { activeCompany } = useContext(AuthContext) || {}
  const [activeSubTab, setActiveSubTab] = useState('apiKey')
  const [settings, setSettings] = useState(deepClone(DEFAULT_SETTINGS))
  const [originalSettings, setOriginalSettings] = useState(deepClone(DEFAULT_SETTINGS))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [generatingKeys, setGeneratingKeys] = useState(false)
  const [generatedKeys, setGeneratedKeys] = useState(null)
  const [showKeysModal, setShowKeysModal] = useState(false)
  const [showMercadoPagoGuide, setShowMercadoPagoGuide] = useState(false)

  useEffect(() => {
    if (!activeCompany) return
    loadSettings()
  }, [fetchWithAuth, activeCompany])

  const hasChanges = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(originalSettings)
  }, [settings, originalSettings])

  const loadSettings = async () => {
    try {
      if (!activeCompany) {
        return
      }
      setLoading(true)
      setError(null)

      const response = await fetchWithAuth(API_ROUTES.integrations.settings)
      if (!response?.ok) {
        const message = await extractErrorMessage(response)
        setError(message || 'No se pudo cargar la configuracion de integraciones')
        return
      }
      const payload = await response.json()
      const incoming = payload?.data?.settings
      const merged = mergeWithDefaults(incoming)
      setSettings(deepClone(merged))
      setOriginalSettings(deepClone(merged))
    } catch (err) {
      console.error('Error loading integration settings', err)
      setError('Error de conexion al cargar las integraciones')
    } finally {
      setLoading(false)
    }
  }

  const handleFieldChange = (section, field, value) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] || {}),
        [field]: value
      }
    }))
  }

  const handleReset = async () => {
    if (!hasChanges) return
    const confirmed = await confirm({
      title: 'Descartar cambios',
      message: 'Estas seguro de descartar los cambios pendientes de esta seccion?',
      confirmText: 'Descartar',
      type: 'danger'
    })
    if (!confirmed) return
    setSettings(deepClone(originalSettings))
  }

  const handleSave = async () => {
    if (!hasChanges) return

    try {
      setSaving(true)
      setError(null)

      const response = await fetchWithAuth(API_ROUTES.integrations.settings, {
        method: 'PUT',
        body: JSON.stringify({ settings })
      })

      if (!response?.ok) {
        const message = await extractErrorMessage(response)
        setError(message || 'No se pudo guardar la configuracion')
        showNotification(message || 'No se pudo guardar la configuracion', 'error')
        return
      }

      const payload = await response.json()
      const normalized = mergeWithDefaults(payload?.data?.settings || settings)
      setSettings(deepClone(normalized))
      setOriginalSettings(deepClone(normalized))
      showNotification('Integraciones guardadas correctamente', 'success')
    } catch (err) {
      console.error('Error saving integration settings', err)
      setError('Error de conexion al guardar las integraciones')
      showNotification('No se pudo guardar la configuracion', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleGenerateApiKeys = async () => {
    const confirmed = await confirm({
      title: 'Generar nueva API Key',
      message: 'Este proceso revoca cualquier API Key previa. Si tienes integraciones activas deberas actualizar las credenciales nuevas manualmente. Deseas continuar?',
      confirmText: 'Generar',
      type: 'warning'
    })

    if (!confirmed) return

    try {
      setGeneratingKeys(true)
      const response = await fetchWithAuth(API_ROUTES.integrations.generateApiKey, {
        method: 'POST'
      })

      if (!response?.ok) {
        const message = await extractErrorMessage(response)
        showNotification(message || 'No se pudo generar la API Key', 'error')
        return
      }

      const payload = await response.json()
      const keyData = payload?.data
      if (keyData) {
        setGeneratedKeys(keyData)
        setShowKeysModal(true)
        showNotification('API Key generada correctamente', 'success')
        setSettings((prev) => ({
          ...prev,
          apiKey: {
            ...(prev.apiKey || {}),
            lastGeneratedAt: keyData.generated_at,
            lastGeneratedBy: keyData.generated_for
          }
        }))
      }
    } catch (err) {
      console.error('Error generating API key', err)
      showNotification('No se pudo generar la API Key', 'error')
    } finally {
      setGeneratingKeys(false)
    }
  }

  const handleKeysAcknowledged = () => {
    setShowKeysModal(false)
    setGeneratedKeys(null)
  }

  const handleCopyToClipboard = async (value) => {
    if (!value) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        showNotification('Dato copiado al portapapeles', 'success')
      }
    } catch (err) {
      console.error('Clipboard error', err)
      showNotification('No se pudo copiar el dato', 'error')
    }
  }

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <p>Cargando configuracion de integraciones...</p>
        </div>
      )
    }

    if (activeSubTab === 'apiKey') {
      return (
        <ApiKeyManager
          metadata={settings.apiKey}
          generating={generatingKeys}
          onGenerate={handleGenerateApiKeys}
          onNotesChange={(value) => handleFieldChange('apiKey', 'notes', value)}
        />
      )
    }

    if (activeSubTab === 'mercadopago') {
      return (
        <MercadoPagoSettings
          data={settings.mercadopago}
          onChange={(field, value) => handleFieldChange('mercadopago', field, value)}
          onShowGuide={() => setShowMercadoPagoGuide(true)}
        />
      )
    }

    return (
      <GeminiSettings
        data={settings.gemini}
        onChange={(field, value) => handleFieldChange('gemini', field, value)}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-sky-100 via-white to-emerald-50 border border-sky-100 rounded-3xl p-6 shadow-inner">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">Integraciones</p>
          <h2 className="text-2xl font-bold text-gray-800">Centraliza tus credenciales externas</h2>
          <p className="text-sm text-gray-600">
            Administramos los datos que ERPNext no expone de forma segura. Genera nuevas API Keys bajo demanda
            y documenta las credenciales de Mercado Pago, Gemini y los siguientes conectores.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl">
          <AlertTriangle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white/80 backdrop-blur rounded-3xl border border-gray-200 shadow-xl overflow-hidden">
        <div className="flex flex-wrap border-b border-gray-200 bg-gray-50/60">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeSubTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all ${
                  isActive
                    ? 'text-blue-600 border-b-2 border-blue-500 bg-white'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
        <div className="p-6">
          {renderContent()}
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 border border-dashed border-gray-300 rounded-2xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span>No almacenamos las API Keys generadas. Es responsabilidad del usuario guardarlas de inmediato.</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="px-5 py-3 rounded-2xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition disabled:opacity-50"
            onClick={handleReset}
            disabled={!hasChanges || saving}
          >
            Revertir cambios
          </button>
          <button
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-500 text-white font-semibold shadow-lg hover:shadow-xl flex items-center gap-2 transition disabled:opacity-60"
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar integraciones
          </button>
        </div>
      </div>

      <Modal
        isOpen={showKeysModal && !!generatedKeys}
        onClose={handleKeysAcknowledged}
        title="API Key generada"
        subtitle="Anota estos datos antes de cerrar"
        size="md"
      >
        {generatedKeys && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Esta clave fue emitida por ERPNext y reemplaza cualquier credencial anterior. Copiala y compartila solo
              con las integraciones que corresponden.
            </p>
            <div className="bg-gray-900 text-green-200 font-mono text-sm rounded-xl px-4 py-3 flex flex-col gap-1">
              <div className="text-gray-400 uppercase text-xs">API Key</div>
              <div className="flex items-center justify-between gap-4">
                <span className="truncate">{generatedKeys.api_key}</span>
                <button
                  onClick={() => handleCopyToClipboard(generatedKeys.api_key)}
                  className="text-xs font-semibold text-emerald-300 hover:text-emerald-200"
                >
                  Copiar
                </button>
              </div>
            </div>
            <div className="bg-gray-900 text-amber-200 font-mono text-sm rounded-xl px-4 py-3 flex flex-col gap-1">
              <div className="text-gray-400 uppercase text-xs">API Secret</div>
              <div className="flex items-center justify-between gap-4">
                <span className="truncate">{generatedKeys.api_secret}</span>
                <button
                  onClick={() => handleCopyToClipboard(generatedKeys.api_secret)}
                  className="text-xs font-semibold text-yellow-200 hover:text-yellow-100"
                >
                  Copiar
                </button>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              Emitida para <span className="font-semibold text-gray-700">{generatedKeys.generated_for}</span> el{' '}
              <span className="font-semibold text-gray-700">
                {formatDate(generatedKeys.generated_at)}
              </span>
            </div>
            <button
              className="w-full px-4 py-3 rounded-2xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 transition"
              onClick={handleKeysAcknowledged}
            >
              Ya guarde mis credenciales
            </button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showMercadoPagoGuide}
        onClose={() => setShowMercadoPagoGuide(false)}
        title="Cómo obtener las credenciales de Mercado Pago"
        subtitle="Guía rápida para generar el Access Token y Public Key"
        size="lg"
      >
        <div className="space-y-4 text-sm text-gray-700">
          <p>
            Necesitamos el <strong>Access Token</strong> y la <strong>Public Key</strong> de la cuenta de Mercado Pago que se
            va a conciliar. Seguí estos pasos:
          </p>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              Ingresá a <a href="https://www.mercadopago.com.ar/developers" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Mercado Pago Developers</a> con el usuario de la cuenta que
              vamos a sincronizar.
            </li>
            <li>
              En el menú superior elegí <strong>Tu cuenta &gt; Credenciales</strong>. Si la cuenta maneja más de un negocio,
              asegurate de seleccionar el <em>User ID</em> correcto antes de copiar las claves.
            </li>
            <li>
              En la sección de <strong>Credenciales de producción</strong> copiá los valores de <strong>Public Key</strong> y <strong>Access Token</strong> y pegá cada uno en este panel.
              Si el Access Token aparece oculto, hacé clic en “Mostrar” y confirmá con el segundo factor.
            </li>
            <li>
              Si todavía no generaste credenciales de producción, presioná <em>Generar credenciales</em> y seguí los pasos de Mercado Pago (te pedirá validar identidad del titular).
            </li>
          </ol>
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-xs text-blue-800">
            Recordá que nosotros automatizamos la creación de reportes Account Money vía API, por lo que no hace falta programar
            reportes ni descargarlos manualmente: solo necesitamos estas credenciales para ingresar.
          </div>
          <div className="text-right">
            <button
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition"
              onClick={() => setShowMercadoPagoGuide(false)}
            >
              Entendido
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

const extractErrorMessage = async (response) => {
  if (!response) return null
  try {
    const data = await response.json()
    return data?.message || data?.error
  } catch (err) {
    return null
  }
}

const formatDate = (value) => {
  if (!value) return 'Nunca generado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export default IntegrationsTab
