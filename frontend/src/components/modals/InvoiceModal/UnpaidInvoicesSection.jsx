import React, { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'

const preferAmount = (source = {}, keys = []) => {
  for (const key of keys) {
    const value = source[key]
    if (value === undefined || value === null || value === '') continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 0
}

const getInvoiceTotalValue = (invoice = {}) => {
  return preferAmount(invoice, [
    'total_in_company_currency',
    'grand_total_in_company_currency',
    'base_grand_total',
    'base_total',
    'grand_total',
    'total',
    'amount'
  ])
}

const getInvoiceOutstandingValue = (invoice = {}) => {
  return preferAmount(invoice, [
    'outstanding_in_company_currency',
    'outstanding_amount_in_company_currency',
    'base_outstanding_amount',
    'balance_in_company_currency',
    'outstanding_amount',
    'balance',
    'amount'
  ])
}

const getConciliationNetValue = (group = {}) => {
  return preferAmount(group, [
    'net_amount_in_company_currency',
    'base_net_amount',
    'net_amount'
  ])
}

const getDocumentAmountValue = (doc = {}) => {
  return preferAmount(doc, [
    'amount_in_company_currency',
    'base_grand_total',
    'base_total',
    'total_in_company_currency',
    'amount',
    'total'
  ])
}

const getDocumentOutstandingValue = (doc = {}, unpaidInvoices = []) => {
  const related = unpaidInvoices.find(inv => inv.name === (doc.voucher_no || doc.name))
  if (related) {
    return getInvoiceOutstandingValue(related)
  }
  return preferAmount(doc, [
    'outstanding_in_company_currency',
    'outstanding_amount_in_company_currency',
    'base_outstanding_amount',
    'outstanding',
    'amount'
  ])
}

// --- COMPONENTE PARA LA SECCIÓN DE FACTURAS PENDIENTES ---
const UnpaidInvoicesSection = ({
  isCreditNote,
  formData,
  unpaidInvoices,
  conciliationSummaries = [],
  handleUnpaidInvoiceSelection,
  handleUnpaidInvoiceAmountChange,
  formatCurrency,
  onUseSelection,
  title = 'Facturas Pendientes para Asociar'
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedConciliations, setExpandedConciliations] = useState({})
  // Debug: log when formData.selected_unpaid_invoices or credit_note_total change
  useEffect(() => {
    try {
      console.log('[UnpaidInvoicesSection] props formData changed', {
        credit_note_total: formData.credit_note_total,
        selected_unpaid_invoices: formData.selected_unpaid_invoices
      })
    } catch (err) {
      console.error('[UnpaidInvoicesSection] error logging props', err)
    }
  }, [formData.selected_unpaid_invoices, formData.credit_note_total])

  if (!isCreditNote(formData.invoice_type)) {
    return null
  }

  // Filtrar facturas basado en el término de búsqueda
  // Además, excluir facturas que pertenezcan a una conciliación ya agrupada
  const visibleConciliations = (conciliationSummaries || []).filter(g => Math.abs(Number(g.net_amount || 0)) >= 0.01)

  const conciliatedInvoiceNames = new Set()
  visibleConciliations.forEach(group => {
    (group.documents || []).forEach(d => conciliatedInvoiceNames.add(d.voucher_no || d.name))
  })

  const filteredInvoices = unpaidInvoices.filter(invoice => {
    const matchesSearch = searchTerm === '' ||
      invoice.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (invoice.customer_name && invoice.customer_name.toLowerCase().includes(searchTerm.toLowerCase()))
    if (!matchesSearch) return false
    if (conciliatedInvoiceNames.has(invoice.name)) return false
    return getInvoiceOutstandingValue(invoice) > 0
  })

  return (
    <div className="mt-4 p-4 border border-gray-200 rounded-2xl bg-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Buscar..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {(visibleConciliations && visibleConciliations.length > 0) || filteredInvoices.length > 0 ? (
        <div className="max-h-40 overflow-y-auto">
          <table className="tabla-items">
            <thead className="tabla-items-header">
              <tr>
                <th className="tabla-items-th">Seleccionar</th>
                <th className="tabla-items-th">Factura / Conciliación</th>
                <th className="tabla-items-th">Fecha</th>
                <th className="tabla-items-th text-right">Total</th>
                <th className="tabla-items-th text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody className="tabla-items-body">
              {visibleConciliations.map((group) => {
                const concId = group.conciliation_id
                // Only consider group documents that are present in the unpaidInvoices list
                const groupDocNames = (group.documents || []).map(d => d.voucher_no || d.name)
                const availableGroupDocs = groupDocNames.filter(name => unpaidInvoices.some(inv => inv.name === name))
                const isChecked = availableGroupDocs.length > 0 && availableGroupDocs.every(name => formData.selected_unpaid_invoices?.some(s => s.name === name))
                const net = getConciliationNetValue(group)
                return (
                  <React.Fragment key={`conc-${concId}`}>
                    <tr className="tabla-items-row">
                      <td className="tabla-items-td">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const willSelect = e.target.checked
                            // Log conciliation details and how the total seleccionado is calculated
                            try {
                              const docs = (group.documents || []).map(d => ({
                                name: d.voucher_no || d.name,
                                outstanding: getDocumentOutstandingValue(d, unpaidInvoices)
                              }))
                              const groupSum = docs.reduce((s, x) => s + x.outstanding, 0)
                              const currentTotal = parseFloat(formData.credit_note_total || 0)
                              let projectedTotal = currentTotal
                              if (willSelect) {
                                // In our handler selecting a conciliation replaces existing selections
                                projectedTotal = Math.abs(groupSum)
                              } else {
                                // Unselecting removes group docs from current selection
                                const remaining = (formData.selected_unpaid_invoices || []).filter(si => !docs.some(d => d.name === si.name))
                                projectedTotal = Math.abs(remaining.reduce((s, si) => s + (parseFloat(si.amount) || 0), 0))
                              }
                              // Structured log for easy debugging
                              console.log('[UnpaidInvoicesSection] Conciliation toggle', {
                                conciliation_id: concId,
                                conciliation_net_from_summary: group.net_amount || 0,
                                documents: docs,
                                groupSumSigned: groupSum,
                                currentCreditNoteTotal: currentTotal,
                                willSelect,
                                projectedCreditNoteTotal: projectedTotal
                              })
                            } catch (err) {
                              console.error('Error logging conciliation details:', err)
                            }

                            handleUnpaidInvoiceSelection(`CONC|${concId}`, e.target.checked, group)
                          }}
                          disabled={availableGroupDocs.length === 0}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50"
                        />
                      </td>
                      <td className="tabla-items-td font-medium text-gray-900">
                        <div className="flex items-center justify-between">
                          <div>Conciliación {concId} <span className="text-xs text-gray-500">({(group.documents||[]).length} doc)</span></div>
                          <button className="text-gray-600 p-1" onClick={() => setExpandedConciliations(prev => ({...prev, [concId]: !prev[concId]}))} aria-label={expandedConciliations[concId] ? 'Ocultar' : 'Ver'}>
                            {expandedConciliations[concId] ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                          </button>
                        </div>
                      </td>
                      <td className="tabla-items-td text-gray-600">
                        {group.posting_date ? new Date(group.posting_date).toLocaleDateString('es-AR') : '-'}
                      </td>
                      <td className="tabla-items-td text-right font-medium">
                        {formatCurrency(net)}
                      </td>
                      <td className="tabla-items-td text-right font-semibold text-gray-700">
                        {formatCurrency(net)}
                      </td>
                    </tr>

                    {expandedConciliations[concId] && (group.documents || []).map((d, i) => (
                      <tr key={`conc-${concId}-${i}`} className="tabla-items-row">
                        <td className="tabla-items-td" />
                        <td className="tabla-items-td font-medium text-gray-900">{d.voucher_no}</td>
                        <td className="tabla-items-td text-gray-600">{d.posting_date ? new Date(d.posting_date).toLocaleDateString('es-AR') : '-'}</td>
                        <td className="tabla-items-td text-right font-medium">{formatCurrency(d.amount)}</td>
                        <td className="tabla-items-td text-right font-semibold text-gray-700">{formatCurrency(d.outstanding)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}

              {filteredInvoices.map((invoice, index) => {
                const isSelected = formData.selected_unpaid_invoices?.some(item => item.name === invoice.name) || false

                return (
                  <tr key={`${invoice.name}-${index}`} className="tabla-items-row">
                    <td className="tabla-items-td">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => handleUnpaidInvoiceSelection(invoice.name, e.target.checked)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    </td>
                    <td className="tabla-items-td font-medium text-gray-900">
                      {invoice.name}
                    </td>
                    <td className="tabla-items-td text-gray-600">
                      {invoice.posting_date ? new Date(invoice.posting_date).toLocaleDateString('es-AR') : '-'}
                    </td>
                    <td className="tabla-items-td text-right font-medium">
                      {formatCurrency(invoice.grand_total || invoice.outstanding_amount)}
                    </td>
                    <td className="tabla-items-td text-right font-semibold text-gray-700">
                      {formatCurrency(invoice.outstanding_amount)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-gray-600 text-center py-4">
          {searchTerm ? 'No se encontraron facturas que coincidan con la búsqueda' : 'No hay facturas pendientes para este cliente'}
        </div>
      )}

      {formData.selected_unpaid_invoices && formData.selected_unpaid_invoices.length > 0 && (
        <div className="mt-3 p-2 bg-gray-100 rounded flex justify-between items-center">
          <div className="text-sm font-semibold text-gray-800">
            Total seleccionado: {formatCurrency(formData.credit_note_total || '0')}
          </div>
        </div>
      )}
    </div>
  )
}

export default UnpaidInvoicesSection
