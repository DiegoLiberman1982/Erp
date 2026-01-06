import { useState, useCallback, useContext, useEffect } from 'react'
import { AuthContext } from '../AuthProvider'
import API_ROUTES from '../apiRoutes'
import { useNotification } from '../contexts/NotificationContext'

/**
 * usePriceListAutomation
 * Encapsula llamadas a la API de automatización de listas de precios:
 * - fetch settings
 * - save global settings and per-price-list settings
 * - applyAutomaticUpdates (POST /apply)
 * Provee estados loading/error y notificaciones via NotificationContext.
 */
const usePriceListAutomation = () => {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showSuccess, showError, showInfo } = useNotification()

  const [settings, setSettings] = useState({ price_lists: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [applying, setApplying] = useState(false)

  const fetchSettings = useCallback(async (opts = {}) => {
    setLoading(true)
    setError(null)
    try {
      // Optionally pass list type (sales/purchase) as query param
      const type = opts.type || 'sales'
      const url = `${API_ROUTES.priceListAutomation.settings}?type=${encodeURIComponent(type)}`
      const resp = await fetchWithAuth(url)
      if (resp.ok) {
        const data = await resp.json()
        if (data.success) {
          // Backend returns { success: true, data: { price_lists: [...] } }
          setSettings(data.data || { price_lists: [] })
          return data.data
        }
        throw new Error(data.message || 'Error fetching settings')
      } else {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${resp.status}`)
      }
    } catch (err) {
      setError(err.message)
      showError(`Error cargando configuración: ${err.message}`)
      return null
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth, showError])

  const saveGlobalSettings = useCallback(async (autoEnabled, priceLists = []) => {
    setLoading(true)
    setError(null)
    try {
      const payload = {
        auto_enabled: !!autoEnabled,
        price_lists: priceLists.map(pl => ({
          name: pl.name || pl.price_list_name || pl.priceListName,
          auto_update_enabled: !!pl.auto_update_enabled || !!pl.enabled,
          formula: pl.auto_update_formula || pl.formula || ''
        }))
      }

      const resp = await fetchWithAuth(API_ROUTES.priceListAutomation.settings, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (resp.ok) {
        const data = await resp.json()
        if (data.success) {
          showSuccess('Configuración guardada')
          // refresh local settings
          await fetchSettings()
          return data
        }
        throw new Error(data.message || 'Error saving settings')
      } else {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${resp.status}`)
      }
    } catch (err) {
      setError(err.message)
      showError(`Error guardando configuración: ${err.message}`)
      throw err
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth, fetchSettings, showError, showSuccess])

  const savePriceListSettings = useCallback(async (priceListName, { enabled, formula }) => {
    setLoading(true)
    setError(null)
    try {
      const payload = {
        auto_update_enabled: enabled === undefined ? undefined : !!enabled,
        formula: formula === undefined ? undefined : formula
      }
      const resp = await fetchWithAuth(API_ROUTES.priceListAutomation.formulas(priceListName), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (resp.ok) {
        const data = await resp.json()
        if (data.success) {
          showSuccess('Configuración de lista guardada')
          await fetchSettings()
          return data
        }
        throw new Error(data.message || 'Error saving price list settings')
      } else {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${resp.status}`)
      }
    } catch (err) {
      setError(err.message)
      showError(`Error guardando lista: ${err.message}`)
      throw err
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth, fetchSettings, showError, showSuccess])

  const applyAutomaticUpdates = useCallback(async (purchaseItems = [], opts = {}) => {
    setApplying(true)
    setError(null)
    try {
      const payload = {
        items: purchaseItems,
        type: opts.type || 'sales'
      }

      const resp = await fetchWithAuth(API_ROUTES.priceListAutomation.bulkApply, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (resp.status === 202 || resp.ok) {
        const data = await resp.json()
        showInfo('Proceso iniciado. Revisa el estado en el dashboard de importes.')
        return data
      } else {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${resp.status}`)
      }
    } catch (err) {
      setError(err.message)
      showError(`Error aplicando actualizaciones: ${err.message}`)
      throw err
    } finally {
      setApplying(false)
    }
  }, [fetchWithAuth, showError, showInfo])

  // Subscribe to global exchange rate updates so automation settings can refresh
  useEffect(() => {
    const handler = (e) => {
      try {
        const d = (e && e.detail) || {}
        const currency = d.currency
        const rate = d.rate
        // Inform user and refresh settings so lists using "general" mode can recalc
        showInfo(`Tasa global actualizada${currency ? ` (${currency})` : ''}. Refrescando configuración...`)
        // Refresh settings for the default type; components may call fetchSettings with specific type
        // but this ensures automation hook instances update after a global rate change.
        fetchSettings().catch(() => {})
      } catch (err) {
        // swallow
      }
    }

    window.addEventListener('globalExchangeRateUpdated', handler)
    return () => window.removeEventListener('globalExchangeRateUpdated', handler)
  }, [fetchSettings, showInfo])

  return {
    settings,
    loading,
    error,
    applying,
    fetchSettings,
    saveGlobalSettings,
    savePriceListSettings,
    applyAutomaticUpdates
  }
}

export default usePriceListAutomation
