import React, { useEffect, useState, useContext } from 'react'
import API_ROUTES from '../../apiRoutes'
import Modal from '../Modal'
import { AuthContext } from '../../AuthProvider'

export default function ExchangeRateHistoryModal({ isOpen, onClose, currency, toCurrency, onSaved }) {
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState([])
  const [editing, setEditing] = useState(null)
  const [rateValue, setRateValue] = useState('')
  const [dateValue, setDateValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    // If modal opened without a currency, do not attempt fetch — show explicit message instead
    if (!currency || !toCurrency) {
      setEntries([])
      return
    }
    fetchHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currency, toCurrency])

  const { fetchWithAuth } = useContext(AuthContext)

  const fetchHistory = async () => {
    try {
      setLoading(true)
      const path = `${API_ROUTES.currencyExchange.base}/history?currency=${encodeURIComponent(currency)}&to=${encodeURIComponent(toCurrency)}&limit=50`
      const resp = await fetchWithAuth(path)
      if (!resp || !resp.ok) {
        // If unauthorized, fetchWithAuth may have already handled logout; show nothing
        console.warn('Failed to fetch exchange history, status:', resp ? resp.status : 'no-response')
        setEntries([])
        return
      }
      const data = await resp.json()
      if (data && data.success) {
        setEntries(data.data || [])
      } else {
        setEntries([])
      }
    } catch (err) {
      console.error('Error fetching exchange history:', err)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  const startEdit = (entry) => {
    setEditing(entry)
    setRateValue(String(entry.exchange_rate || ''))
    setDateValue(entry.date || '')
  }

  const cancelEdit = () => {
    setEditing(null)
    setRateValue('')
    setDateValue('')
  }

  const saveEdit = async () => {
    if (!editing) return
    try {
      setSaving(true)
      const resolvedToCurrency = (editing.to_currency || toCurrency || '').toString().trim()
      if (!resolvedToCurrency) {
        alert('Error: registro sin to_currency (no se guardará sin moneda destino)')
        return
      }
      const payload = {
        from_currency: editing.from_currency || currency,
        to_currency: resolvedToCurrency,
        exchange_rate: Number(rateValue) || 0,
        date: dateValue || editing.date
      }
      const resp = await fetchWithAuth(API_ROUTES.currencyExchange.upsert, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!resp || !resp.ok) {
        const err = await (resp && resp.json ? resp.json().catch(() => ({})) : Promise.resolve({}))
        alert(err.message || `Error saving (status ${resp ? resp.status : 'no-response'})`)
        return
      }

      const data = await resp.json()
      if (data && data.success) {
        await fetchHistory()
        cancelEdit()
        if (typeof onSaved === 'function') onSaved()
      } else {
        alert(data.message || 'Error saving')
      }
    } catch (err) {
      console.error('Error saving exchange rate:', err)
      alert('Error de conexión')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Historial de cotizaciones — ${currency}/${toCurrency || '?'}`} size="md">
      <div>
        {loading ? (
          <div>Cargando...</div>
        ) : (
          <div className="space-y-3">
            {!currency || !toCurrency ? (
              <div className="text-sm text-red-500">Moneda no especificada — seleccione moneda origen y destino antes de abrir el historial</div>
            ) : entries.length === 0 ? (
              <div className="text-sm text-gray-500">No hay registros</div>
            ) : (
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr>
                    <th className="text-left">Fecha</th>
                    <th className="text-left">Tasa ({toCurrency})</th>
                    <th className="text-left">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.name} className="border-t">
                      <td className="py-2">{e.date}</td>
                      <td className="py-2">{e.exchange_rate}</td>
                      <td className="py-2">
                        <button onClick={() => startEdit(e)} className="btn-secondary text-xs">Editar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {editing && (
              <div className="mt-4 p-3 bg-gray-50 rounded">
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-xs text-gray-600">Fecha</label>
                    <input type="date" value={dateValue} onChange={e => setDateValue(e.target.value)} className="w-full px-2 py-1 border rounded" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600">Tasa ({toCurrency})</label>
                    <input type="number" value={rateValue} onChange={e => setRateValue(e.target.value)} className="w-full px-2 py-1 border rounded" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} disabled={saving} className="btn-action-primary">{saving ? 'Guardando...' : 'Guardar'}</button>
                    <button onClick={cancelEdit} className="btn-secondary">Cancelar</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
