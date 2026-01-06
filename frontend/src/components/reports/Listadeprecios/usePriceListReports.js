import { useContext, useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { AuthContext } from '../../../AuthProvider'
import * as XLSX from 'xlsx'

/**
 * Clean usePriceListReports hook
 * - endpoint: string
 * - options: { initialFilter, initialSearch, rateField }
 * Returns: { items, rawItems, loading, error, availablePriceLists, exportToCsv, filterByList, search, refresh }
 */
export default function usePriceListReports(endpoint, options = {}) {
  const { fetchWithAuth } = useContext(AuthContext) || {}
  const [rawItems, setRawItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [listFilter, setListFilter] = useState(options.initialFilter || '')
  const [searchTerm, setSearchTerm] = useState(options.initialSearch || '')
  const rateField = options.rateField || null

  // Keep a ref to the latest fetchWithAuth to avoid recreating callbacks/effects
  // useRef keeps a stable object across renders; we update .current when identity changes
  const fetchRef = useRef(fetchWithAuth)
  useEffect(() => { fetchRef.current = fetchWithAuth }, [fetchWithAuth])

  // Mounted flag to avoid setting state after unmount
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  // Refs to avoid refetch loops: track if a fetch is in-flight and last fetched endpoint
  const isFetchingRef = useRef(false)
  const lastFetchedEndpointRef = useRef(null)
  // Keep a ref copy of rawItems to make fetch decisions without adding state deps
  const rawItemsRef = useRef(rawItems)
  useEffect(() => { rawItemsRef.current = rawItems }, [rawItems])

  const normalize = useCallback((r) => {
    if (!r) return null
    const item_code = r.item_code || r.item || r.code || r.name || ''
    const item_name = r.item_name || r.itemName || r.description || r.name || ''
    const price = rateField ? (r[rateField] ?? r.rate ?? r.price ?? null) : (r.price_list_rate ?? r.rate ?? r.price ?? r.purchase_rate ?? null)
    const price_list_name = r.price_list || r.price_list_name || r.priceList || r.list_name || ''
    const currency = r.currency || r.price_currency || ''
    const last_modified = r.modified || r.last_modified || r.updated_at || r.updatedAt || ''

    return {
      raw: r,
      item_code,
      item_name,
      price,
      price_list_name,
      currency,
      last_modified,
    }
  }, [rateField])

  const fetchData = useCallback(async () => {
    if (!endpoint) return
    // Avoid triggering concurrent fetches or refetching the same endpoint when we already have data
    if (isFetchingRef.current) return
    if (lastFetchedEndpointRef.current === endpoint && Array.isArray(rawItemsRef.current) && rawItemsRef.current.length > 0) return

    const f = fetchRef.current || fetchWithAuth
    if (!f) {
      if (mountedRef.current) setError('fetchWithAuth not available')
      return
    }
    if (mountedRef.current) {
      setLoading(true)
      setError(null)
    }
    isFetchingRef.current = true
    try {
      // Debugging: log fetch attempts
      // eslint-disable-next-line no-console
      console.debug('[usePriceListReports] fetchData start', { endpoint, isFetching: isFetchingRef.current, lastFetched: lastFetchedEndpointRef.current })
      const resp = await f(endpoint)
      let payload = resp
      if (resp && typeof resp.json === 'function') {
        try { payload = await resp.json() } catch (e) { /* ignore */ }
      }
      const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []))
      // Only set state if items changed to avoid unnecessary re-renders / loops
      let shouldUpdate = true
      try {
        const prev = rawItemsRef.current || []
        if (Array.isArray(prev) && Array.isArray(items) && prev.length === items.length) {
          const a = JSON.stringify(prev)
          const b = JSON.stringify(items)
          if (a === b) shouldUpdate = false
        }
      } catch (e) {
        // fall back to updating
        shouldUpdate = true
      }
      // Debugging: log decision
      // eslint-disable-next-line no-console
      console.debug('[usePriceListReports] fetchData result', { endpoint, itemsLen: Array.isArray(items) ? items.length : 0, shouldUpdate })
      if (mountedRef.current && shouldUpdate) setRawItems(items)
      lastFetchedEndpointRef.current = endpoint
      lastFetchedEndpointRef.current = endpoint
    } catch (e) {
      if (mountedRef.current) {
        setError(String(e))
        setRawItems([])
      }
    } finally {
      if (mountedRef.current) setLoading(false)
      isFetchingRef.current = false
    }
  }, [endpoint])

  // Run fetch on mount and whenever endpoint changes. We intentionally
  // avoid including `fetchWithAuth` directly in the effect dependencies
  // (it is tracked via fetchRef) to prevent re-running when the auth
  // helper identity changes on every render.
  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint])

  const normalizedItems = useMemo(() => rawItems.map(normalize).filter(Boolean), [rawItems, normalize])

  const availablePriceLists = useMemo(() => {
    const s = new Set()
    normalizedItems.forEach(it => { if (it && it.price_list_name) s.add(it.price_list_name) })
    return Array.from(s)
  }, [normalizedItems])

  const filteredItems = useMemo(() => {
    const term = (searchTerm || '').toString().toLowerCase().trim()
    return normalizedItems.filter(it => {
      if (!it) return false
      if (listFilter && listFilter !== '' && it.price_list_name !== listFilter) return false
      if (!term) return true
      return (
        (it.item_code && it.item_code.toString().toLowerCase().includes(term)) ||
        (it.item_name && it.item_name.toString().toLowerCase().includes(term)) ||
        (it.price_list_name && it.price_list_name.toString().toLowerCase().includes(term))
      )
    })
  }, [normalizedItems, listFilter, searchTerm])

  const exportToCsv = useCallback((filename = 'report.csv', rows = null) => {
    const data = Array.isArray(rows) ? rows : filteredItems
    if (!data || data.length === 0) return null
    const headers = ['item_code', 'item_name', 'price', 'price_list_name', 'currency', 'last_modified']
    const lines = [headers.join(',')]
    for (const r of data) {
      const vals = headers.map((h) => {
        const v = r[h] ?? (r.raw && (r.raw[h] ?? '')) ?? ''
        const cell = v === null || v === undefined ? '' : String(v)
        return `"${cell.replace(/"/g, '""')}"`
      })
      lines.push(vals.join(','))
    }
    const csv = lines.join('\n')
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.setAttribute('download', filename)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      return true
    } catch (e) {
      console.error('exportToCsv error', e)
      return false
    }
  }, [filteredItems])

  const exportToXlsx = useCallback((rows = null, filename = 'report.xlsx') => {
    const data = Array.isArray(rows) ? rows : filteredItems
    if (!data || data.length === 0) return null

    // Ensure filename is a string
    const validFilename = typeof filename === 'string' ? filename : 'report.xlsx'

    // Transform data to worksheet format
    const worksheetData = data.map(r => ({
      'Código': r.item_code || '',
      'Descripción': r.item_name || '',
      'Precio': r.price || '',
      'Lista de Precios': r.price_list_name || '',
      'Moneda': r.currency || '',
      'Última Modificación': r.last_modified || ''
    }))

    try {
      const worksheet = XLSX.utils.json_to_sheet(worksheetData)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Datos')

      // Generate and download the file
      XLSX.writeFile(workbook, validFilename)
      return true
    } catch (e) {
      console.error('exportToXlsx error', e)
      return false
    }
  }, [filteredItems])

  const filterByList = useCallback((name) => setListFilter(name), [])
  const search = useCallback((term) => setSearchTerm(term), [])
  const refresh = useCallback(() => fetchData(), [fetchData])

  return {
    items: filteredItems,
    rawItems,
    loading,
    error,
    availablePriceLists,
    exportToCsv,
    exportToXlsx,
    filterByList,
    search,
    refresh,
  }
}
