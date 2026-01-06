import React, { useState } from 'react'
import { BarChart3, Calculator, Check, Building2, Receipt, Search, ArrowUpDown, ArrowUp, ArrowDown, FileSpreadsheet, Sparkles, Undo2, Loader2, Link2, CheckCircle2, Trash2, FileText, RefreshCcw } from 'lucide-react'
import MonthClosurePanel from './MonthClosurePanel'

export default function ConciliationPanel({
  selectedTreasuryAccount,
  accountDetails,
  conciliationTab,
  setConciliationTab,
  reconciledGroups,
  reconciledTotals,
  handleReconcile,
  selectedBankMovements,
  selectedAccountingMovements,
  bankSearch,
  setBankSearch,
  accountingSearch,
  setAccountingSearch,
  bankSort,
  accountingSort,
  handleSort,
  filteredBankMovements,
  filteredAccountingMovements,
  handleSelectAll,
  handleSelectMovement,
  formatDate,
  formatBalance,
  dateMismatchInfo,
  dateMismatchAcknowledged,
  onAcknowledgeDateMismatch,
  onRequestImport,
  onRequestAutoMatch,
  onRequestRegisterPayment,
  onRequestConvertBankTransactions,
  autoMatchLoading,
  onUndoReconciliation,
  undoingTransactionId,
  pendingUnreconciles,
  onToggleReconciled,
  onSaveReconciledChanges,
  savingReconciledChanges,
  onRequestDelete,
  pendingDateRange,
  onDateInputChange,
  onApplyDateRange,
  dateRangeError,
  refreshingMovements,
  bankPage,
  onChangeBankPage,
  bankHasMore,
  accountingPage,
  onChangeAccountingPage,
  accountingHasMore,
  bankLoading,
  accountingLoading,
  pageSize = 50
}) {
  const [bankColumnWidths, setBankColumnWidths] = useState({
    date: 98,
    code: 98,
    description: 205,
    amount: 160,
    matches: 260,
    actions: 160
  })
  const [accountingColumnWidths, setAccountingColumnWidths] = useState({
    date: 98,
    type: 98,
    description: 205,
    amount: 160
  })
  const disabledDateControls = !selectedTreasuryAccount || selectedTreasuryAccount === 'new'
  const accountDisplayName = selectedTreasuryAccount
    ? (accountDetails?.bank_account_name || accountDetails?.account_name || accountDetails?.mode_of_payment || 'Cuenta seleccionada')
    : 'Selecciona una cuenta'
  const showingReconciled = conciliationTab === 'reconciled'
  const pendingSet = pendingUnreconciles instanceof Set ? pendingUnreconciles : new Set()
  const hasPendingReconciledChanges = pendingSet.size > 0
  const showDateMismatchWarning = Boolean(dateMismatchInfo?.hasMismatch)
  const manualReconcileDisabled = selectedBankMovements.size === 0 ||
    selectedAccountingMovements.size === 0 ||
    (showDateMismatchWarning && !dateMismatchAcknowledged)
  const fromInputId = 'finance-panel-date-from'
  const toInputId = 'finance-panel-date-to'

  const formatMonthLabel = (monthKey) => {
    if (!monthKey) return 'mes sin fecha'
    const [year, month] = monthKey.split('-')
    if (!year || !month) return monthKey
    const date = new Date(Number(year), Number(month) - 1, 1)
    if (Number.isNaN(date.getTime())) return monthKey
    return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  }
  const bankMonthLabels = (dateMismatchInfo?.bankMonths || []).map(formatMonthLabel)
  const accountingMonthLabels = (dateMismatchInfo?.accountingMonths || []).map(formatMonthLabel)

  const startColumnResize = (event, table, columnKey) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const widths = table === 'bank' ? bankColumnWidths : accountingColumnWidths
    const startWidth = widths[columnKey]
    const minWidth = 90
    const maxWidth = 640

    const handleMouseMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta))
      if (table === 'bank') {
        setBankColumnWidths(prev => ({ ...prev, [columnKey]: nextWidth }))
      } else {
        setAccountingColumnWidths(prev => ({ ...prev, [columnKey]: nextWidth }))
      }
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const renderResizeHandle = (tableKey, columnKey) => (
    <span
      className="absolute top-0 right-0 h-full w-3 cursor-col-resize flex items-center justify-center z-10"
      onMouseDown={(event) => startColumnResize(event, tableKey, columnKey)}
    >
      <span className="w-px h-3/4 bg-gray-400"></span>
    </span>
  )

  const renderHeaderCell = (tableKey, columnKey, { label, sortable = false, align = 'left' }) => {
    const widths = tableKey === 'bank' ? bankColumnWidths : accountingColumnWidths
    const sortState = tableKey === 'bank' ? bankSort : accountingSort
    const width = widths[columnKey] ?? 180
    const isActive = sortable && sortState.field === columnKey
    const icon = sortable
      ? isActive
        ? (sortState.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
        : <ArrowUpDown className="w-3 h-3 opacity-50" />
      : null

    const handleClick = sortable ? () => handleSort(tableKey, columnKey) : undefined
    const alignmentClass = align === 'right' ? 'text-right justify-end' : 'text-left'

    return (
      <th
        className={`relative px-4 py-2 text-xs font-medium text-gray-500 uppercase ${
          sortable ? 'cursor-pointer hover:bg-gray-200 transition-colors' : ''
        } ${align === 'right' ? 'text-right' : 'text-left'}`}
        style={{ width: `${width}px` }}
        key={`${tableKey}-${columnKey}`}
      >
        <div
          className={`flex items-center gap-1 select-none ${alignmentClass}`}
          onClick={handleClick}
        >
          {label}
          {icon}
        </div>
        {renderResizeHandle(tableKey, columnKey)}
      </th>
    )
  }

  const renderDataCell = (tableKey, columnKey, content, { align = 'left', className = '' } = {}) => {
    const widths = tableKey === 'bank' ? bankColumnWidths : accountingColumnWidths
    const width = widths[columnKey] ?? 160
    return (
      <td
        className={`px-4 py-2 text-sm whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
        style={{ width: `${width}px`, minWidth: '60px', maxWidth: '640px' }}
      >
        <span className={`block truncate ${align === 'right' ? 'text-right' : ''}`}>{content}</span>
      </td>
    )
  }

  const renderPaginationControls = (label, page, hasMore, onChangePage, loading) => {
    if (!onChangePage) return null
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-gray-600 mt-2">
        <span> {label} · Página {page}{pageSize ? ` · Máx ${pageSize} por página` : ''}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChangePage(page - 1)}
            disabled={loading || page <= 1}
            className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => onChangePage(page + 1)}
            disabled={loading || !hasMore}
            className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Siguiente
          </button>
        </div>
      </div>
    )
  }

  // Attempt to fix mojibake / wrong text encoding produced when backend/clients
  // decoded UTF-8 bytes as Latin-1. If the string looks fine we return it
  // untouched for performance.
  const fixTextEncoding = (value) => {
    if (!value || typeof value !== 'string') return value
    // quick check for common mojibake indicators
    if (!/[ÃÂ¿�]/.test(value)) return value
    try {
      const bytes = Uint8Array.from([...value].map((c) => c.charCodeAt(0)))
      const decoded = new TextDecoder('utf-8').decode(bytes)
      return decoded || value
    } catch (e) {
      return value
    }
  }

  // Heuristic fixes for replacement char U+FFFD when the original byte was lost
  // Map common Spanish words that frequently lose accents in transfer
  const fixReplacementChars = (text) => {
    if (!text || typeof text !== 'string') return text
    if (!text.includes('\uFFFD') && !text.includes('�')) return text
    const map = [
      [/transacci[\uFFFD�]n/gi, 'transacción'],
      [/acci[\uFFFD�]n/gi, 'acción'],
      [/informaci[\uFFFD�]n/gi, 'información'],
      [/funci[\uFFFD�]n/gi, 'función'],
      [/recepci[\uFFFD�]n/gi, 'recepción'],
      [/naci[\uFFFD�]n/gi, 'nación'],
      [/operaci[\uFFFD�]n/gi, 'operación'],
      [/referenci[\uFFFD�]n/gi, 'referenciación']
    ]
    let out = text
    for (const [re, repl] of map) {
      out = out.replace(re, repl)
    }
    // Fallback: replace standalone replacement char with 'ó' when surrounded by vowels/consonants heuristically
    out = out.replace(/([a-zA-Z])[ -]*[\uFFFD�]([a-zA-Z])/g, '$1ó$2')
    return out
  }

  const renderMatches = (movement) => {
    const matches =
      (Array.isArray(movement?.matched_vouchers) && movement.matched_vouchers) ||
      (Array.isArray(movement?.linked_payments) && movement.linked_payments) ||
      (Array.isArray(movement?.references) && movement.references) ||
      []
    if (!matches.length) {
      return <span className="text-xs text-gray-400">Sin vouchers vinculados</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {matches.map((match, index) => {
          const docLabel =
            match.payment_document ||
            match.payment_doctype ||
            match.reference_doctype ||
            'Documento'
          const docName =
            match.payment_entry ||
            match.payment_name ||
            match.reference_name ||
            match.voucher_no ||
            `#${index + 1}`
          const cleanDocLabel = fixTextEncoding(docLabel)
          const cleanDocName = fixTextEncoding(docName)
          const matchAmount = match.amount || match.allocated_amount
          return (
            <span
              key={`${docLabel}-${docName}-${index}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold"
            >
              <Link2 className="w-3 h-3" />
                  {cleanDocLabel}: {cleanDocName}
              {matchAmount ? (
                <span className="text-[10px] text-gray-500">
                  ({formatBalance(matchAmount)})
                </span>
              ) : null}
            </span>
          )
        })}
      </div>
    )
  }

  const renderReconciledTable = () => {
    if (!reconciledGroups || reconciledGroups.length === 0) {
      return (
        <div className="text-center py-10 text-gray-500 bg-white rounded-2xl border border-dashed border-gray-200">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500" />
          <p>No se encontraron conciliaciones para mostrar.</p>
        </div>
      )
    }

    return (
      <div className="bg-gray-50 rounded-2xl border border-gray-200 flex flex-col" style={{ height: 'calc(100vh - 420px)', minHeight: '400px' }}>
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="min-w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '120px' }} />
              <col style={{ width: '280px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '72px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '280px' }} />
              <col style={{ width: '120px' }} />
            </colgroup>
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase" style={{ width: '120px' }}>Fecha</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase">Descripción Bancaria</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase text-right" style={{ width: '120px' }}>($)</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase text-center" style={{ width: '72px' }}>Estado</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase" style={{ width: '172px' }}>Fecha</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase">Descripción Comprobante</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase text-right">($)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {reconciledGroups.map((group, groupIndex) => {
                const groupKey = `group-${groupIndex}`
                if (group.type === 'voucher') {
                  // Many banks to 1 voucher
                  const bankMovements = group.bankMovements || []
                  const voucher = group.voucher
                  const accountingMovement = group.accountingMovement
                  const rowSpan = bankMovements.length
                  const voucherTotal = voucher?.amount || 0
                  const bankTotal = bankMovements.reduce((sum, m) => sum + (m?.amount || 0), 0)
                  return (
                    <React.Fragment key={groupKey}>
                      {bankMovements.map((bankMovement, bankIndex) => {
                        const voucherDate =
                          voucher?.date ||
                          voucher?.raw?.posting_date ||
                          voucher?.raw?.date ||
                          ''
                        const voucherDescription =
                          accountingMovement?.description ||
                          `${voucher?.docType || ''} ${voucher?.docName || ''}`.trim() ||
                          'Sin descripción'
                        const voucherAmount = voucher?.amount || 0
                        return (
                          <tr key={`${groupKey}-bank-${bankIndex}`}>
                            <td className="px-4 py-2 text-sm text-gray-900 align-top whitespace-nowrap" style={{ width: '120px' }}>
                              {formatDate(bankMovement.date)}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-600 align-top">
                                  <div
                                    className="hot-tooltip"
                                    data-tooltip={fixReplacementChars(fixTextEncoding(bankMovement.description)) || ''}
                                  >
                                    <span className="block truncate" style={{ maxWidth: '100%', display: 'block' }}>
                                      {fixReplacementChars(fixTextEncoding(bankMovement.description)) || 'Sin descripción'}
                                    </span>
                                  </div>
                                  {bankMovement.description && bankMovement.description.includes('\uFFFD') && (
                                    (() => {
                                      try {
                                        console.debug('CONCILIATION DEBUG - raw remarks:', bankMovement.description)
                                        const codes = Array.from(bankMovement.description).map(c => c.charCodeAt(0))
                                        console.debug('CONCILIATION DEBUG - codepoints:', codes)
                                      } catch (e) {
                                        console.debug('CONCILIATION DEBUG - error logging remarks', e)
                                      }
                                      return null
                                    })()
                                  )}
                            </td>
                            <td className="px-4 py-2 text-sm font-semibold text-right text-gray-900 align-top">
                              {`${bankMovement.type === 'credit' ? '+' : ''}${formatBalance(bankMovement.amount)}`}
                            </td>
                            {bankIndex === 0 && (
                              <td rowSpan={rowSpan} className="px-4 py-2 text-center align-top">
                                <div className="flex items-center justify-center h-full">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                                    checked={bankMovements.every(bm => !pendingSet.has(bm.id))}
                                    onChange={(event) => {
                                      // Toggle all bank movements in this group
                                      bankMovements.forEach(bm => {
                                        onToggleReconciled && onToggleReconciled(bm.id, event.target.checked)
                                      })
                                    }}
                                  />
                                </div>
                              </td>
                            )}
                            {bankIndex === 0 && (
                              <td rowSpan={rowSpan} className="px-4 py-2 text-sm text-gray-900 whitespace-nowrap" style={{ width: '120px' }}>
                                {voucherDate ? formatDate(voucherDate) : '—'}
                              </td>
                            )}
                            {bankIndex === 0 && (
                              <td rowSpan={rowSpan} className="px-4 py-2 text-sm text-gray-600">
                                <div
                                  className="hot-tooltip"
                                  data-tooltip={fixTextEncoding(voucherDescription) || ''}
                                >
                                  <span className="block truncate" style={{ maxWidth: '100%', display: 'block' }}>
                                    {fixTextEncoding(voucherDescription)}
                                  </span>
                                </div>
                              </td>
                            )}
                            {bankIndex === 0 && (
                              <td rowSpan={rowSpan} className="px-4 py-2 text-sm font-semibold text-right text-gray-900">
                                {formatBalance(voucherAmount)}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                      {bankMovements.length > 1 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-gray-600 text-right">
                            Total Bancario: {formatBalance(bankTotal)}
                          </td>
                          <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-gray-600 text-right">
                            Total Comprobante: {formatBalance(voucherTotal)}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td colSpan={8} className="bg-gray-50 h-px p-0" />
                      </tr>
                    </React.Fragment>
                  )
                } else if (group.type === 'bank') {
                  // 1 bank to many vouchers or 1:1
                  const bankMovement = group.bankMovement
                  const vouchers = group.vouchers || []
                  const rowSpan = vouchers.length
                  const bankTotal = bankMovement?.amount || 0
                  const voucherTotal = vouchers.reduce((sum, v) => sum + (v?.amount || 0), 0)
                  return (
                    <React.Fragment key={groupKey}>
                      {vouchers.map((voucher, voucherIndex) => {
                        const voucherDate =
                          voucher?.date ||
                          voucher?.raw?.posting_date ||
                          voucher?.raw?.date ||
                          ''
                        const voucherDescription =
                          `${voucher?.docType || ''} ${voucher?.docName || ''}`.trim() ||
                          'Sin descripción'
                        const voucherAmount = voucher?.amount || 0
                        return (
                          <tr key={`${groupKey}-voucher-${voucherIndex}`}>
                            {voucherIndex === 0 && (
                              <>
                                <td rowSpan={rowSpan} className="px-4 py-2 text-sm text-gray-900 align-top whitespace-nowrap" style={{ width: '120px' }}>
                                  {formatDate(bankMovement.date)}
                                </td>
                                <td rowSpan={rowSpan} className="px-4 py-2 text-sm text-gray-600 align-top">
                                      <div
                                        className="hot-tooltip"
                                        data-tooltip={fixReplacementChars(fixTextEncoding(bankMovement.description)) || ''}
                                      >
                                        <span className="block truncate" style={{ maxWidth: '100%', display: 'block' }}>
                                          {fixReplacementChars(fixTextEncoding(bankMovement.description)) || 'Sin descripción'}
                                        </span>
                                      </div>
                                      {bankMovement.description && bankMovement.description.includes('\uFFFD') && (
                                        (() => {
                                          try {
                                            console.debug('CONCILIATION DEBUG - raw remarks:', bankMovement.description)
                                            const codes = Array.from(bankMovement.description).map(c => c.charCodeAt(0))
                                            console.debug('CONCILIATION DEBUG - codepoints:', codes)
                                          } catch (e) {
                                            console.debug('CONCILIATION DEBUG - error logging remarks', e)
                                          }
                                          return null
                                        })()
                                      )}
                                </td>
                                <td rowSpan={rowSpan} className="px-4 py-2 text-sm font-semibold text-right text-gray-900 align-top">
                                  {`${bankMovement.type === 'credit' ? '+' : ''}${formatBalance(bankMovement.amount)}`}
                                </td>
                                <td rowSpan={rowSpan} className="px-4 py-2 text-center align-top">
                                  <div className="flex items-center justify-center h-full">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                                      checked={!pendingSet.has(bankMovement.id)}
                                      onChange={(event) => {
                                        onToggleReconciled && onToggleReconciled(bankMovement.id, event.target.checked)
                                      }}
                                    />
                                  </div>
                                </td>
                              </>
                            )}
                            <td className="px-4 py-2 text-sm text-gray-900 whitespace-nowrap" style={{ width: '120px' }}>
                              {voucherDate ? formatDate(voucherDate) : '—'}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-600">
                              <div
                                className="hot-tooltip"
                                data-tooltip={fixTextEncoding(voucherDescription) || ''}
                              >
                                <span className="block truncate" style={{ maxWidth: '100%', display: 'block' }}>
                                  {fixTextEncoding(voucherDescription)}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-sm font-semibold text-right text-gray-900">
                              {formatBalance(voucherAmount)}
                            </td>
                          </tr>
                        )
                      })}
                      {vouchers.length > 1 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-gray-600 text-right">
                            Total Bancario: {formatBalance(bankTotal)}
                          </td>
                          <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-gray-600 text-right">
                            Total Comprobante: {formatBalance(voucherTotal)}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td colSpan={8} className="bg-gray-50 h-px p-0" />
                      </tr>
                    </React.Fragment>
                  )
                }
                return null
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="conciliation-panel flex-1 bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden">
      <div className="accounting-card-title">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-black text-gray-900">
              Conciliación - {accountDisplayName}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {onRequestRegisterPayment && (
              <button
                type="button"
                onClick={onRequestRegisterPayment}
                disabled={!selectedTreasuryAccount}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-200 text-violet-700 bg-violet-50 font-semibold text-sm hover:bg-violet-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">Registrar Pago</span>
              </button>
            )}
            {onRequestAutoMatch && (
              <button
                type="button"
                onClick={onRequestAutoMatch}
                disabled={!selectedTreasuryAccount || autoMatchLoading}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-200 text-purple-700 bg-purple-50 font-semibold text-sm hover:bg-purple-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {autoMatchLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">Matches automáticos</span>
              </button>
            )}
          </div>
        </div>

        {selectedTreasuryAccount && selectedTreasuryAccount !== 'new' && (
          <nav className="tab-nav">
            <button
              onClick={() => setConciliationTab('unreconciled')}
              className={`tab-button ${conciliationTab === 'unreconciled' ? 'active' : ''}`}
            >
              Conciliar
            </button>
            <button
              onClick={() => setConciliationTab('reconciled')}
              className={`tab-button ${conciliationTab === 'reconciled' ? 'active' : ''}`}
            >
              Conciliados
            </button>
          </nav>
        )}
        {selectedTreasuryAccount && selectedTreasuryAccount !== 'new' && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor={fromInputId} className="text-xs font-semibold text-gray-600">
                Desde
              </label>
              <input
                id={fromInputId}
                type="date"
                value={pendingDateRange?.from || ''}
                onChange={(event) => onDateInputChange && onDateInputChange('from', event.target.value)}
                disabled={disabledDateControls}
                className="h-9 px-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor={toInputId} className="text-xs font-semibold text-gray-600">
                Hasta
              </label>
              <input
                id={toInputId}
                type="date"
                value={pendingDateRange?.to || ''}
                onChange={(event) => onDateInputChange && onDateInputChange('to', event.target.value)}
                disabled={disabledDateControls}
                className="h-9 px-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              />
            </div>
            <button
              type="button"
              onClick={() => onApplyDateRange && onApplyDateRange()}
              disabled={disabledDateControls || refreshingMovements}
              className="inline-flex items-center justify-center p-2 rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
              title="Actualizar movimientos"
              aria-label="Actualizar movimientos"
            >
              {refreshingMovements ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCcw className="w-4 h-4" />
              )}
            </button>
            {dateRangeError ? (
              <span className="text-xs text-red-600">{dateRangeError}</span>
            ) : null}
          </div>
        )}
      </div>

      <div className="p-4">
        {!selectedTreasuryAccount || selectedTreasuryAccount === 'new' ? (
          <div className="text-center py-12 text-gray-500">
            <Calculator className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Selecciona una cuenta de tesorería para ver la conciliación</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-xl p-4 border border-blue-200 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <Check className="w-5 h-5 text-green-600" />
                Conciliación Realizada
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-gray-700">Bancario:</span>
                  <span className="text-blue-600 font-bold">{formatBalance(reconciledTotals.bankTotal)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-gray-700">Contable:</span>
                  <span className="text-green-600 font-bold">{formatBalance(reconciledTotals.accountingTotal)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-gray-700">Diferencia:</span>
                  <span className={`font-bold ${reconciledTotals.difference === 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatBalance(reconciledTotals.difference)}
                  </span>
                </span>
              </div>
              {showDateMismatchWarning && (
                <div className="w-full p-3 rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                  <p className="font-semibold">Fechas fuera de mes</p>
                  <p className="mt-1 text-xs sm:text-sm">
                    Los movimientos bancarios ({bankMonthLabels.join(', ') || 'sin fecha'}) no coinciden con las fechas de los comprobantes contables ({accountingMonthLabels.join(', ') || 'sin fecha'}).
                    Ajusta la fecha del comprobante para mantener los saldos alineados o confirma que asumes la conciliacion fuera de mes.
                  </p>
                  <label className="mt-3 flex items-start gap-2 text-xs sm:text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                      checked={dateMismatchAcknowledged}
                      onChange={(event) => onAcknowledgeDateMismatch && onAcknowledgeDateMismatch(event.target.checked)}
                    />
                    <span>
                      Confirmo que procedo igual y acepto que esta conciliacion fuera de mes quedara registrada a mi nombre para futuras revisiones.
                    </span>
                  </label>
                </div>
              )}
              {showingReconciled ? (
                <div className="flex flex-col items-end gap-1 ml-auto">
                  <button
                    type="button"
                    onClick={onSaveReconciledChanges}
                    disabled={!hasPendingReconciledChanges || savingReconciledChanges}
                    className="btn-primary"
                  >
                    {savingReconciledChanges ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-2" />
                    )}
                    {savingReconciledChanges ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-1 ml-auto">
                  <button
                    onClick={handleReconcile}
                    disabled={manualReconcileDisabled}
                    className="btn-secondary"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Conciliar Seleccionados
                  </button>
                </div>
              )}
            </div>

            {conciliationTab === 'reconciled' ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Tabla de conciliados - 2/3 del ancho */}
                <div className="lg:col-span-2">
                  {renderReconciledTable()}
                </div>
                
                {/* Panel de cierre de mes - 1/3 del ancho */}
                <div className="lg:col-span-1">
                  <MonthClosurePanel
                    selectedAccountId={selectedTreasuryAccount}
                    selectedAccountName={accountDetails?.accounting_account || accountDetails?.account_name}
                    onMonthClosed={() => {
                      // Callback cuando se cierra un mes
                      // Podríamos recargar datos si es necesario
                      console.log('Mes cerrado exitosamente')
                    }}
                  />
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-600" />
                    Movimientos Bancarios
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onRequestImport && onRequestImport()}
                      disabled={!selectedTreasuryAccount || !onRequestImport}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 font-semibold text-sm hover:bg-emerald-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      <span className="hidden sm:inline">Importar</span>
                    </button>
                    {selectedBankMovements.size > 0 && selectedAccountingMovements.size === 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => onRequestConvertBankTransactions && onRequestConvertBankTransactions()}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-200 text-violet-700 bg-violet-50 font-semibold text-sm hover:bg-violet-100 transition"
                        >
                          <Receipt className="w-4 h-4" />
                          <span className="hidden sm:inline">Convertir a...</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRequestDelete && onRequestDelete()}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-red-700 bg-red-50 font-semibold text-sm hover:bg-red-100 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="hidden sm:inline">Eliminar</span>
                        </button>
                      </>
                    )}
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Buscar..."
                        value={bankSearch}
                        onChange={(e) => setBankSearch(e.target.value)}
                        className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    {bankLoading && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Actualizando...
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '48px' }} />
                        <col style={{ width: `${bankColumnWidths.date}px` }} />
                        <col style={{ width: `${bankColumnWidths.code}px` }} />
                        <col style={{ width: `${bankColumnWidths.description}px` }} />
                        <col style={{ width: `${bankColumnWidths.amount}px` }} />
                        {showingReconciled && (
                          <>
                            <col style={{ width: `${bankColumnWidths.matches}px` }} />
                            <col style={{ width: `${bankColumnWidths.actions}px` }} />
                          </>
                        )}
                      </colgroup>
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left">
                            <input
                              type="checkbox"
                              checked={selectedBankMovements.size === filteredBankMovements.length && filteredBankMovements.length > 0}
                              onChange={(e) => handleSelectAll('bank', filteredBankMovements, e.target.checked)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          </th>
                          {renderHeaderCell('bank', 'date', { label: 'Fecha', sortable: true })}
                          {renderHeaderCell('bank', 'code', { label: 'Código' })}
                          {renderHeaderCell('bank', 'description', { label: 'Descripción', sortable: true })}
                          {renderHeaderCell('bank', 'amount', { label: 'Monto ($)', sortable: true, align: 'right' })}
                          {showingReconciled && renderHeaderCell('bank', 'matches', { label: 'Matches' })}
                          {showingReconciled && (
                            <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase text-right">
                              Acción
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredBankMovements.map((movement, index) => (
                          <tr key={movement.id || index} className={`hover:bg-gray-50 ${selectedBankMovements.has(movement.id) ? 'bg-blue-50' : ''}`}>
                            <td className="px-4 py-2">
                              <input
                                type="checkbox"
                                checked={selectedBankMovements.has(movement.id)}
                                onChange={(e) => handleSelectMovement('bank', movement.id, e.target.checked)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            {renderDataCell('bank', 'date', formatDate(movement.date))}
                            {renderDataCell('bank', 'code', movement.reference || movement.id, { className: 'text-gray-500' })}
                            {renderDataCell('bank', 'description', fixTextEncoding(movement.description) || 'Sin descripción', { className: 'text-gray-500' })}
                            {renderDataCell('bank', 'amount', `${movement.type === 'credit' ? '+' : ''}${formatBalance(movement.amount)}`, { align: 'right', className: movement.type === 'credit' ? 'text-green-600' : 'text-red-600' })}
                            {showingReconciled && (
                              <td className="px-4 py-2 text-sm whitespace-normal" style={{ width: `${bankColumnWidths.matches}px` }}>
                                {renderMatches(movement)}
                              </td>
                            )}
                            {showingReconciled && (
                              <td className="px-4 py-2 text-sm text-right" style={{ width: `${bankColumnWidths.actions}px` }}>
                                <button
                                  type="button"
                                  onClick={() => onUndoReconciliation && onUndoReconciliation(movement.id)}
                                  disabled={!onUndoReconciliation || undoingTransactionId === movement.id}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 text-xs font-semibold hover:bg-red-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {undoingTransactionId === movement.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Undo2 className="w-3 h-3" />
                                  )}
                                  Deshacer
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {renderPaginationControls('Movimientos bancarios', bankPage || 1, bankHasMore, onChangeBankPage, bankLoading)}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-green-600" />
                    Movimientos Contables
                  </h4>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Buscar..."
                        value={accountingSearch}
                        onChange={(e) => setAccountingSearch(e.target.value)}
                        className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    {accountingLoading && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Actualizando...
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '48px' }} />
                        <col style={{ width: `${accountingColumnWidths.date}px` }} />
                        <col style={{ width: `${accountingColumnWidths.type}px` }} />
                        <col style={{ width: `${accountingColumnWidths.description}px` }} />
                        <col style={{ width: `${accountingColumnWidths.amount}px` }} />
                      </colgroup>
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left">
                            <input
                              type="checkbox"
                              checked={selectedAccountingMovements.size === filteredAccountingMovements.length && filteredAccountingMovements.length > 0}
                              onChange={(e) => handleSelectAll('accounting', filteredAccountingMovements, e.target.checked)}
                              className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                            />
                          </th>
                          {renderHeaderCell('accounting', 'date', { label: 'Fecha', sortable: true })}
                          {renderHeaderCell('accounting', 'type', { label: 'Tipo' })}
                          {renderHeaderCell('accounting', 'description', { label: 'Descripción', sortable: true })}
                          {renderHeaderCell('accounting', 'amount', { label: 'Total ($)', sortable: true, align: 'right' })}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredAccountingMovements.map((movement, index) => {
                          const movementType = movement.voucher_type === 'Payment Entry' ? 'Pago' : 'Asiento'
                          const total = (movement.debit || 0) - (movement.credit || 0)
                          const totalValue = `${total >= 0 ? '+' : ''}${formatBalance(Math.abs(total))}`

                          return (
                            <tr key={movement.name || index} className={`hover:bg-gray-50 ${selectedAccountingMovements.has(movement.name) ? 'bg-green-50' : ''}`}>
                              <td className="px-4 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedAccountingMovements.has(movement.name)}
                                  onChange={(e) => handleSelectMovement('accounting', movement.name, e.target.checked)}
                                  className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                                />
                              </td>
                              {renderDataCell('accounting', 'date', formatDate(movement.date))}
                              {renderDataCell('accounting', 'type', movementType, { className: 'text-gray-500' })}
                              {renderDataCell('accounting', 'description', fixTextEncoding(movement.description) || 'Sin descripción', { className: 'text-gray-500' })}
                              {renderDataCell('accounting', 'amount', totalValue, { align: 'right', className: total >= 0 ? 'text-green-600' : 'text-red-600' })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {renderPaginationControls('Movimientos contables', accountingPage || 1, accountingHasMore, onChangeAccountingPage, accountingLoading)}
                </div>
              </div>
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
