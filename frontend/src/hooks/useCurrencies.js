import { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../AuthProvider'
import { NotificationContext } from '../contexts/NotificationContext'

// Hook para obtener monedas desde el backend (/api/currencies)
export default function useCurrencies() {
  const { fetchWithAuth } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const [currencies, setCurrencies] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchWithAuth('/api/currencies')
      if (!res) throw new Error('No response')
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Status ${res.status}: ${body}`)
      }
      const data = await res.json()
      if (!data.success) {
        throw new Error(data.message || 'Failed to load currencies')
      }
      setCurrencies(data.data || [])
    } catch (err) {
      console.error('useCurrencies load error:', err)
      setError(err)
      // Notify but do not apply any fallback currency values
      try {
        showNotification && showNotification('Error cargando monedas desde el servidor', 'error')
      } catch (e) {
        // ignore
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { currencies, loading, error, reload: load }
}
