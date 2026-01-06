import React, { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Edit2, Save, X } from 'lucide-react'

const toNumberOrUndefined = (value) => {
  if (value === null || value === undefined || value === '') return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

const buildGenerateInvoiceAtValue = (mode) => {
  if (mode === 'start') return 'Beginning of the current subscription period'
  return 'End of the current subscription period'
}

export default function CustomerSubscriptionsCard({
  customerSubscriptions,
  formatBalance,
  subscriptionMutations = {},
  onCancelSubscription,
  onUpdateSubscription
}) {
  const list = useMemo(() => (Array.isArray(customerSubscriptions) ? customerSubscriptions : []), [customerSubscriptions])
  const [expanded, setExpanded] = useState(() => new Set())
  const [editingName, setEditingName] = useState(null)
  const [draft, setDraft] = useState({})

  const toggleExpanded = useCallback((name) => {
    if (!name) return
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const startEdit = useCallback((sub) => {
    if (!sub?.name) return
    setEditingName(sub.name)
    setDraft({
      status: sub.status || '',
      start_date: sub.start_date || '',
      end_date: sub.end_date || '',
      generate_invoice_at: sub.generate_invoice_at || 'end',
      align_day_of_month: sub.align_day_of_month ?? '',
      trial_days: sub.trial_days ?? '',
      discount_percent: sub.discount_percent ?? ''
    })
    setExpanded(prev => {
      const next = new Set(prev)
      next.add(sub.name)
      return next
    })
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingName(null)
    setDraft({})
  }, [])

  if (!list.length) return null

  return (
    <div className="mb-4 bg-blue-50 border border-blue-200 rounded-2xl p-4">
      <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-2">Suscripciones</p>
      <div className="space-y-3">
        {list.map((sub) => {
          const subName = sub?.name
          if (!subName) return null
          const isExpanded = expanded.has(subName)
          const isEditing = editingName === subName
          const mutation = subscriptionMutations[subName]
          const isBusy = mutation === 'cancelling' || mutation === 'updating'
          const statusLabel = sub.status || 'Activa'
          const statusColor = statusLabel.toLowerCase().includes('cancel')
            ? 'bg-red-100 text-red-700'
            : statusLabel.toLowerCase().includes('trial')
              ? 'bg-yellow-100 text-yellow-700'
              : 'bg-green-100 text-green-700'
          const amountValue = sub.amount ?? sub.recurring_amount ?? sub.grand_total
          const planName = sub.plan || sub.plan_name || ''
          return (
            <div key={subName} className="bg-white rounded-xl border border-blue-100 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleExpanded(subName)}
                className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-blue-50/50"
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">Suscripción: {subName}</div>
                  <div className="text-xs text-gray-600 truncate">
                    {planName ? `Plan: ${planName}` : 'Sin plan'}
                    {sub.start_date ? ` | Desde ${sub.start_date}` : ''}
                    {sub.end_date ? ` hasta ${sub.end_date}` : ''}
                    {sub.generate_invoice_at ? ` | Factura: ${sub.generate_invoice_at}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                    {statusLabel}
                  </span>
                  {amountValue !== undefined && amountValue !== null && amountValue !== '' ? (
                    <span className="text-sm font-semibold text-gray-900">
                      {formatBalance ? formatBalance(amountValue) : amountValue}
                    </span>
                  ) : null}
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4">
                  <div className="flex items-center justify-between gap-3 mt-1">
                    <div className="text-xs text-gray-500">
                      {isExpanded ? 'Click para colapsar' : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => startEdit(sub)}
                          className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                          disabled={isBusy || typeof onUpdateSubscription !== 'function'}
                        >
                          <Edit2 className="w-3 h-3" />
                          Editar
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              if (typeof onUpdateSubscription !== 'function') return
                              const alignDay = toNumberOrUndefined(draft.align_day_of_month)
                              const trialDays = toNumberOrUndefined(draft.trial_days)
                              const discountPercent = toNumberOrUndefined(draft.discount_percent)
                              const payload = {
                                status: draft.status || undefined,
                                start_date: draft.start_date || undefined,
                                end_date: draft.end_date === '' ? null : draft.end_date || undefined,
                                follow_calendar_months_day: alignDay,
                                trial_period_days: trialDays,
                                additional_discount_percentage: discountPercent,
                                generate_invoice_at: buildGenerateInvoiceAtValue(draft.generate_invoice_at || 'end')
                              }
                              Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key])
                              try {
                                await onUpdateSubscription(subName, payload)
                                cancelEdit()
                              } catch (e) {
                                // Keep the form open so the user can retry/correct values.
                              }
                            }}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-50"
                            disabled={isBusy || mutation === 'updating'}
                          >
                            <Save className="w-3 h-3" />
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            disabled={isBusy}
                          >
                            <X className="w-3 h-3" />
                            Cancelar
                          </button>
                        </>
                      )}

                      {typeof onCancelSubscription === 'function' && (
                        <button
                          type="button"
                          onClick={() => onCancelSubscription(subName)}
                          className="px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                          disabled={isBusy || mutation === 'cancelling'}
                        >
                          {mutation === 'cancelling' ? 'Cancelando...' : 'Cancelar suscripción'}
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Estado</span>
                        <select
                          value={draft.status || ''}
                          onChange={(e) => setDraft(prev => ({ ...prev, status: e.target.value }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          <option value="">(sin cambios)</option>
                          <option value="Active">Active</option>
                          <option value="Cancelled">Cancelled</option>
                          <option value="Trial">Trial</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Generar factura</span>
                        <select
                          value={draft.generate_invoice_at || 'end'}
                          onChange={(e) => setDraft(prev => ({ ...prev, generate_invoice_at: e.target.value }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                          <option value="end">Fin del período</option>
                          <option value="start">Inicio del período</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Inicio</span>
                        <input
                          type="date"
                          value={draft.start_date || ''}
                          onChange={(e) => setDraft(prev => ({ ...prev, start_date: e.target.value }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Fin</span>
                        <input
                          type="date"
                          value={draft.end_date || ''}
                          onChange={(e) => setDraft(prev => ({ ...prev, end_date: e.target.value }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Día alineado</span>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={draft.align_day_of_month ?? ''}
                          onChange={(e) => setDraft(prev => ({ ...prev, align_day_of_month: e.target.value }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Trial (días)</span>
                        <input
                          type="number"
                          min="0"
                          value={draft.trial_days ?? ''}
                          onChange={(e) => setDraft(prev => ({ ...prev, trial_days: e.target.value }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Descuento (%)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.discount_percent ?? ''}
                          onChange={(e) => setDraft(prev => ({ ...prev, discount_percent: e.target.value }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </label>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-gray-600">Plan</span>
                        <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50">
                          {planName || '-'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
