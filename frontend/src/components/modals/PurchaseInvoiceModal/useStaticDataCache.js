// useStaticDataCache.js - Hook personalizado para cachear datos estáticos
import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchWarehouses } from '../../../apiUtils.js'
import useTaxTemplates from '../../../hooks/useTaxTemplates'

/**
 * Hook personalizado para cachear datos estáticos que no cambian frecuentemente
 * como warehouses, price lists, payment terms, etc.
 */
export const useStaticDataCache = (fetchWithAuth) => {
  const cacheRef = useRef(new Map())
  const [loadingStates, setLoadingStates] = useState(new Set())

  const getCachedData = useCallback(async (key, fetchFunction, ...args) => {
    // Verificar si ya está en caché
    if (cacheRef.current.has(key)) {
      return cacheRef.current.get(key)
    }

    // Verificar si ya se está cargando
    if (loadingStates.has(key)) {
      return null
      return null
    }

    // Marcar como cargando
    setLoadingStates(prev => new Set(prev).add(key))

    try {
      const result = await fetchFunction(...args)
      if (result) {
        // Cachear el resultado
        cacheRef.current.set(key, result)
        return result
      }
      return null
    } catch (error) {
      console.error('❌ Error cargando datos:', key, error)
      return null
    } finally {
      // Remover de loading
      setLoadingStates(prev => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
    }
  }, [fetchWithAuth, loadingStates])

  const getWarehouses = useCallback(async (companyName) => {
    const key = `warehouses_${companyName}`
    return getCachedData(key, async () => {
      const warehouseData = await fetchWarehouses(fetchWithAuth, companyName)
      return warehouseData.flat
    })
  }, [getCachedData, fetchWithAuth])

  const { templates: taxTemplatesFromHook, refresh: refreshTaxTemplates } = useTaxTemplates(fetchWithAuth)

  const getPurchasePriceLists = useCallback(async (companyName) => {
    const key = `purchase_price_lists_${companyName || 'default'}`
    return getCachedData(key, async () => {
      const query = companyName ? `?company=${encodeURIComponent(companyName)}` : ''
      const response = await fetchWithAuth(`/api/inventory/purchase-price-lists/all${query}`)
      if (response.ok) {
        const data = await response.json()
        return data.success ? data.data : null
      }
      return null
    })
  }, [getCachedData, fetchWithAuth])

  const getTalonarios = useCallback(async (companyName) => {
    const key = `talonarios_${companyName}`
    return getCachedData(key, async () => {
      const response = await fetchWithAuth(`/api/talonarios?compania=${encodeURIComponent(companyName)}&activos=1`)
      if (response.ok) {
        const data = await response.json()
        return data.success ? data.data : null
      }
      return null
    })
  }, [getCachedData, fetchWithAuth])

  const getPaymentTerms = useCallback(async () => {
    const key = 'payment_terms'
    return getCachedData(key, async () => {
      const response = await fetchWithAuth('/api/payment-terms-list-with-details')
      if (response.ok) {
        const data = await response.json()
        return data.success ? data.data : null
      }
      return null
    })
  }, [getCachedData, fetchWithAuth])

  const getTaxTemplates = useCallback(async () => {
    const key = 'tax_templates'
    return getCachedData(key, async () => {
      const loaded = await refreshTaxTemplates()
      if (loaded && loaded.success) {
        return loaded
      }
      return null
    })
  }, [getCachedData, fetchWithAuth])

  const clearCache = useCallback(() => {
    cacheRef.current.clear()
    setLoadingStates(new Set())
  }, [])

  // Limpiar caché cuando el componente se desmonta
  useEffect(() => {
    return () => {
      cacheRef.current.clear()
    }
  }, [])

  return {
    getWarehouses,
    getPurchasePriceLists,
    getTalonarios,
    getPaymentTerms,
    getTaxTemplates,
    clearCache
  }
}
