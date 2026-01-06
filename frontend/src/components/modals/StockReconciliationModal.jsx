import React, { useEffect, useMemo, useState } from 'react'
import { Info, Trash2 } from 'lucide-react'
import Modal from '../Modal.jsx'
import API_ROUTES from '../../apiRoutes'
import { formatCurrency, formatDate, formatNumber } from '../InventoryPanel/inventoryUtils'

const stripCompanyAbbrSuffix = (value) => {
  if (!value) return ''
  return String(value).replace(/\s*-\s*[A-Z]{2,}\s*$/, '').trim()
}

const getDocstatusLabel = (docstatus) => {
  if (docstatus === 0) return 'Borrador'
  if (docstatus === 1) return 'Confirmado'
  if (docstatus === 2) return 'Cancelado'
  return String(docstatus ?? '')
}

export default function StockReconciliationModal({
  isOpen,
  onClose,
  reconciliationName,
  fetchWithAuth,
  confirm,
  showNotification,
  onCancelled
}) {
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [data, setData] = useState(null)

  const isCancelled = Number(data?.docstatus) === 2
  const items = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data])

  useEffect(() => {
    const run = async () => {
      if (!isOpen || !reconciliationName || typeof fetchWithAuth !== 'function') {
        setData(null)
        return
      }

      try {
        setLoading(true)
        const response = await fetchWithAuth(`${API_ROUTES.inventory}/stock-reconciliation/${encodeURIComponent(reconciliationName)}`)
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.message || `Error ${response.status}: ${response.statusText}`)
        }
        const payload = await response.json().catch(() => ({}))
        if (!payload?.success) {
          throw new Error(payload?.message || 'No se pudo obtener el Stock Reconciliation')
        }
        setData(payload.data || null)
      } catch (e) {
        console.error('Error fetching Stock Reconciliation:', e)
        showNotification?.(e.message || 'Error al obtener el Stock Reconciliation', 'error')
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [isOpen, reconciliationName, fetchWithAuth, showNotification])

  const handleCancel = async () => {
    if (!reconciliationName || cancelling || isCancelled) return

    const ok = typeof confirm === 'function'
      ? await confirm({
          title: 'Cancelar Stock Reconciliation',
          message: `¿Querés cancelar ${reconciliationName}? (esto hace docstatus=2)`,
          type: 'error',
          confirmText: 'Cancelar',
          cancelText: 'Volver'
        })
      : true

    if (!ok) return

    try {
      setCancelling(true)
      const response = await fetchWithAuth(`${API_ROUTES.inventory}/stock-reconciliation/${encodeURIComponent(reconciliationName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docstatus: 2 })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || `Error ${response.status}: ${response.statusText}`)
      }

      const payload = await response.json().catch(() => ({}))
      if (!payload?.success) {
        throw new Error(payload?.message || 'No se pudo cancelar el Stock Reconciliation')
      }

      showNotification?.(payload?.message || 'Stock Reconciliation cancelado', 'success')
      onCancelled?.(reconciliationName)
      onClose?.()
    } catch (e) {
      console.error('Error cancelling Stock Reconciliation:', e)
      showNotification?.(e.message || 'Error al cancelar el Stock Reconciliation', 'error')
    } finally {
      setCancelling(false)
    }
  }

  const handleGoToStockManagement = (e) => {
    e?.preventDefault?.()
    try {
      window.dispatchEvent(new CustomEvent('openImportStockManagement'))
    } catch (err) {
      try {
        const ev = document.createEvent('CustomEvent')
        ev.initCustomEvent('openImportStockManagement', true, true, null)
        window.dispatchEvent(ev)
      } catch (e2) {}
    }
    onClose?.()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Stock Reconciliation"
      subtitle={reconciliationName || ''}
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Info
              className="w-4 h-4 text-gray-500"
              title="Si querés modificarlo, andá a Importación → Items → Gestión de stock."
              aria-label="Si querés modificarlo, andá a Importación → Items → Gestión de stock."
            />
            <span className="text-sm text-gray-600">
              Si querés modificarlo:{" "}
              <a
                href="#import-stock-management"
                onClick={handleGoToStockManagement}
                className="text-blue-700 underline font-semibold"
              >
                Ir a Gestión de stock
              </a>
            </span>
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleCancel}
            disabled={loading || cancelling || isCancelled}
            title={isCancelled ? 'Ya está cancelado' : 'Cancelar (docstatus=2)'}
          >
            <Trash2 className="w-4 h-4" />
            {cancelling ? 'Cancelando…' : 'Borrar (Cancelar)'}
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-600">Cargando…</div>
        ) : !data ? (
          <div className="text-sm text-gray-600">No hay datos para mostrar.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl border border-gray-200 bg-white">
                <div className="text-xs text-gray-500">Estado</div>
                <div className="text-sm font-semibold text-gray-900">{getDocstatusLabel(data.docstatus)}</div>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 bg-white">
                <div className="text-xs text-gray-500">Fecha</div>
                <div className="text-sm font-semibold text-gray-900">{formatDate(data.posting_date)}</div>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 bg-white">
                <div className="text-xs text-gray-500">Diferencia</div>
                <div className="text-sm font-semibold text-gray-900">{formatCurrency(data.difference_amount)}</div>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 bg-white md:col-span-2">
                <div className="text-xs text-gray-500">Cuenta ajuste</div>
                <div className="text-sm font-semibold text-gray-900 break-words">{stripCompanyAbbrSuffix(data.expense_account) || '-'}</div>
              </div>
              <div className="p-3 rounded-xl border border-gray-200 bg-white">
                <div className="text-xs text-gray-500">Centro de costo</div>
                <div className="text-sm font-semibold text-gray-900 break-words">{stripCompanyAbbrSuffix(data.cost_center) || '-'}</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Depósito</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cantidad</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Valuación</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Importe</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Dif. Cant.</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Dif. $</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 text-sm text-gray-600 text-center">
                        Sin items.
                      </td>
                    </tr>
                  ) : (
                    items.map((it) => (
                      <tr key={it.name || `${it.item_code}-${it.warehouse}`}>
                        <td className="px-4 py-2 text-sm text-gray-900">{stripCompanyAbbrSuffix(it.item_code) || it.item_name || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-700">{stripCompanyAbbrSuffix(it.warehouse) || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{formatNumber(it.qty)}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{formatCurrency(it.valuation_rate)}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{formatCurrency(it.amount)}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{formatNumber(it.quantity_difference)}</td>
                        <td className="px-4 py-2 text-sm text-gray-900 text-right">{formatCurrency(it.amount_difference)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
