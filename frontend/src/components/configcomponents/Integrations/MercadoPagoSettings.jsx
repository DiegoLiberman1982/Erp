import React from 'react'
import { Activity, CreditCard, Shield, Clock, CloudDownload, Info } from 'lucide-react'

const MercadoPagoSettings = ({ data, onChange, onShowGuide }) => {
  const settings = data || {}
  const handleTextChange = (field) => (event) => onChange(field, event.target.value)
  const handleToggle = (field) => (event) => onChange(field, event.target.checked)

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-orange-50 to-rose-50 border border-orange-100 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <CreditCard className="w-5 h-5 text-orange-500 mt-1" />
          <div>
            <p className="text-sm font-semibold text-orange-700">Configura las credenciales de Mercado Pago</p>
            <p className="text-xs text-orange-600 mt-1">
              Guarda el access token productivo y el modo test en un unico lugar para sincronizar tus cobros futuros.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onShowGuide}
          className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-orange-700 hover:text-orange-900"
        >
          <Info className="w-4 h-4" />
          Cómo obtener las credenciales
        </button>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-500" />
              Integracion activa
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Habilita o deshabilita el uso de Mercado Pago en los modulos que consumen esta configuracion.
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

        <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" />
              Modo test
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Conserva un token independiente para pruebas y evita tocar tu cuenta productiva.
            </p>
          </div>
          <label className="integrations-toggle">
            <input
              type="checkbox"
              className="integrations-toggle-input"
              checked={!!settings.testMode}
              onChange={handleToggle('testMode')}
            />
            <span className={`toggle-switch ${settings.testMode ? 'on' : ''}`} aria-hidden="true" />
          </label>
        </div>
      </div>

      {settings.lastSyncAt && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-blue-600" />
            <div>
              <p className="text-sm font-semibold text-blue-800">Última sincronización</p>
              <p className="text-xs text-blue-700">
                {new Date(settings.lastSyncAt).toLocaleString()} — {settings.lastSyncCount || 0} movimientos nuevos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-blue-700">
            <CloudDownload className="w-4 h-4" />
            {settings.lastReportId ? `Reporte #${settings.lastReportId}` : 'Reporte no informado'}
          </div>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Public Key</label>
          <input
            type="text"
            value={settings.publicKey || ''}
            onChange={handleTextChange('publicKey')}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-orange-200"
            placeholder="APP_USR-xxxx"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Access Token</label>
          <input
            type="text"
            value={settings.accessToken || ''}
            onChange={handleTextChange('accessToken')}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-orange-200"
            placeholder="APP_USR-xxxx"
          />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Refresh Token</label>
          <input
            type="text"
            value={settings.refreshToken || ''}
            onChange={handleTextChange('refreshToken')}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-orange-200"
            placeholder="Opcional segun flujo OAuth"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">User ID</label>
          <input
            type="text"
            value={settings.userId || ''}
            onChange={handleTextChange('userId')}
            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-orange-200"
            placeholder="ID de la cuenta asociada"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Webhook Secret</label>
        <input
          type="text"
          value={settings.webhookSecret || ''}
          onChange={handleTextChange('webhookSecret')}
          className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-orange-200"
          placeholder="Firma para validar notificaciones"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Notas externas o alcance</label>
        <textarea
          value={settings.additionalInfo || ''}
          onChange={handleTextChange('additionalInfo')}
          rows={4}
          className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-orange-200 bg-white resize-none"
          placeholder="Incluye enlaces a tableros de Mercado Pago, usuarios involucrados o cualquier aclaracion."
        />
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-xs text-blue-800">
        No hace falta configurar manualmente los reportes Account Money: el sistema los solicita, descarga y procesa vía API
        cada vez que sincronizas una cuenta de Mercado Pago.
      </div>
    </div>
  )
}

export default MercadoPagoSettings
