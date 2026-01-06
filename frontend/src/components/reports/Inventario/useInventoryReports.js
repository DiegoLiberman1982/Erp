import { useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { AuthContext } from '../../../AuthProvider'
import * as XLSX from 'xlsx'

/**
 * Hook personalizado para reportes de inventario
 * Similar a usePriceListReports pero adaptado para inventario
 * 
 * @param {string} endpoint - Endpoint del reporte
 * @param {object} options - Opciones de configuración { params, autoFetch }
 * @returns {object} - { data, loading, error, refresh, exportToCsv, exportToXlsx }
 */
export default function useInventoryReports(endpoint, options = {}) {
  const { fetchWithAuth } = useContext(AuthContext) || {}
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const autoFetch = options.autoFetch !== false
  const paramsRef = useRef(options.params || {})
  
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])
  
  const fetchData = useCallback(async (customParams = null) => {
    if (!endpoint || !fetchWithAuth) return
    
    const params = customParams || paramsRef.current
    
    if (mountedRef.current) {
      setLoading(true)
      setError(null)
    }
    
    try {
      const queryString = new URLSearchParams(params).toString()
      const url = queryString ? `${endpoint}?${queryString}` : endpoint
      
      console.debug('[useInventoryReports] Fetching:', url)
      
      const resp = await fetchWithAuth(url)
      
      if (!resp.ok) {
        throw new Error(`Error ${resp.status}: ${resp.statusText}`)
      }
      
      const payload = await resp.json()
      const items = payload?.data || []
      
      console.debug('[useInventoryReports] Items received:', items.length)
      
      if (mountedRef.current) {
        setData(items)
      }
    } catch (e) {
      console.error('[useInventoryReports] Error:', e)
      if (mountedRef.current) {
        setError(String(e))
        setData([])
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [endpoint, fetchWithAuth])
  
  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      fetchData()
    }
  }, [autoFetch, fetchData])
  
  const refresh = useCallback((newParams = null) => {
    if (newParams) {
      paramsRef.current = { ...paramsRef.current, ...newParams }
    }
    return fetchData(paramsRef.current)
  }, [fetchData])
  
  const exportToCsv = useCallback((filename = 'report.csv', rows = null) => {
    const exportData = rows || data
    if (!exportData || exportData.length === 0) {
      console.warn('No data to export')
      return
    }
    
    const headers = Object.keys(exportData[0])
    const lines = [headers.join(',')]
    
    for (const row of exportData) {
      const values = headers.map(h => {
        const val = row[h]
        if (val === null || val === undefined) return ''
        const str = String(val)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      lines.push(values.join(','))
    }
    
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }, [data])
  
  const exportToXlsx = useCallback((filename = 'report.xlsx', rows = null) => {
    const exportData = rows || data
    if (!exportData || exportData.length === 0) {
      console.warn('No data to export')
      return
    }
    
    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Datos')
    XLSX.writeFile(wb, filename)
  }, [data])
  
  return {
    data,
    loading,
    error,
    refresh,
    fetchData,
    exportToCsv,
    exportToXlsx
  }
}
