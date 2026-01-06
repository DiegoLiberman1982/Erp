import { useState, useEffect, useCallback } from 'react'
import { fetchTaxTemplates } from '../apiUtils'

// Simple module-level cache
const CACHE = {
  data: null,
  ts: 0
}
const CACHE_TTL = 300 * 1000 // 5 minutes

export default function useTaxTemplates(fetchWithAuth, options = { auto: true }) {
  const [templates, setTemplates] = useState([])
  const [sales, setSales] = useState([])
  const [purchase, setPurchase] = useState([])
  const [rateToTemplateMap, setRateToTemplateMap] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const now = Date.now()
      // Use local cache only if not forcing
      if (!force && CACHE.data && (now - CACHE.ts) < CACHE_TTL) {
        const cached = CACHE.data
        setTemplates(cached.templates || [])
        setSales(cached.sales || [])
        setPurchase(cached.purchase || [])
        setRateToTemplateMap(cached.rate_to_template_map || {})
        setLoading(false)
        console.log('--- useTaxTemplates: using local cache')
        return cached
      }

      // Pass force parameter to bypass backend cache as well
      const result = await fetchTaxTemplates(fetchWithAuth, force)
      if (result && result.success) {
        CACHE.data = result
        CACHE.ts = Date.now()
        setTemplates(result.templates || [])
        setSales(result.sales || [])
        setPurchase(result.purchase || [])
        setRateToTemplateMap(result.rate_to_template_map || {})
        setLoading(false)
        console.log('--- useTaxTemplates: loaded from backend', result.templates?.length, 'templates')
        return result
      } else {
        setError('Failed to load tax templates')
        setLoading(false)
        return null
      }
    } catch (err) {
      setError(err.message || String(err))
      setLoading(false)
      return null
    }
  }, [fetchWithAuth])

  useEffect(() => {
    // Allow callers to disable automatic loading on mount by passing options.auto = false
    if (options && options.auto === false) return
    if (fetchWithAuth) load()
  }, []) // Removido fetchWithAuth de dependencias para evitar loop infinito

  const refresh = useCallback(() => load(true), [load])
  const invalidate = useCallback(() => {
    CACHE.data = null
    CACHE.ts = 0
  }, [])

  return {
    templates,
    sales,
    purchase,
    rateToTemplateMap,
    loading,
    error,
    refresh,
    invalidate
  }
}
