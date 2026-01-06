// useSupplierCache.js - Hook personalizado para cachear detalles de proveedores
import { useState, useEffect, useRef, useCallback } from 'react'
import { addCompanyAbbrToSupplier } from '../../Supplierpanel/supplierHandlers'

/**
 * Hook personalizado para cachear detalles de proveedores
 * Evita llamadas API repetidas para el mismo proveedor
 */
export const useSupplierCache = (fetchWithAuth) => {
  const cacheRef = useRef(new Map())
  const [loadingSuppliers, setLoadingSuppliers] = useState(new Set())

  const getSupplierDetails = useCallback(async (supplierName) => {
    if (!supplierName) return null

    // Verificar si ya está en caché
    if (cacheRef.current.has(supplierName)) {
      console.log('📦 Usando detalles de proveedor desde caché:', supplierName)
      return cacheRef.current.get(supplierName)
    }

    // Verificar si ya se está cargando
    if (loadingSuppliers.has(supplierName)) {
      console.log('⏳ Proveedor ya se está cargando:', supplierName)
      return null
    }

    // Marcar como cargando
    setLoadingSuppliers(prev => new Set(prev).add(supplierName))

    try {
      const response = await fetchWithAuth(`/api/suppliers/${encodeURIComponent(await addCompanyAbbrToSupplier(supplierName, fetchWithAuth))}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Cachear el resultado
          cacheRef.current.set(supplierName, data.supplier)
          console.log('✅ Detalles de proveedor cacheados:', supplierName)
          return data.supplier
        }
      }
      console.error('❌ Error obteniendo detalles de proveedor:', supplierName)
      return null
    } catch (error) {
      console.error('❌ Error obteniendo detalles de proveedor:', error)
      return null
    } finally {
      // Remover de loading
      setLoadingSuppliers(prev => {
        const newSet = new Set(prev)
        newSet.delete(supplierName)
        return newSet
      })
    }
  }, [fetchWithAuth, loadingSuppliers])

  const clearCache = useCallback(() => {
    cacheRef.current.clear()
    setLoadingSuppliers(new Set())
  }, [])

  // Limpiar caché cuando el componente se desmonta
  useEffect(() => {
    return () => {
      cacheRef.current.clear()
    }
  }, [])

  return { getSupplierDetails, clearCache }
}