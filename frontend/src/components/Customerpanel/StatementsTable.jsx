import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DollarSign, Loader2 } from 'lucide-react'
import API_ROUTES from '../../apiRoutes'

const normalizeNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

const normalizeDateToIso = (value) => {
  if (!value) return null
  const raw = String(value).trim()
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return raw

  const dmyMatch = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
  if (!dmyMatch) return null
  const day = dmyMatch[1]
  const month = dmyMatch[2]
  const year = dmyMatch[3]
  return `${year}-${month}-${day}`
}

const expandDateTokens = (value) => {
  if (!value) return []
  const iso = normalizeDateToIso(value)
  if (!iso) return [String(value)]
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return [String(value)]
  const year = match[1]
  const month = match[2]
  const day = match[3]
  return [iso, `${day}-${month}-${year}`, `${day}/${month}/${year}`]
}

const resolvePaymentAmount = (statement, debit = 0, credit = 0) => {
  const candidates = [
    statement?.base_paid_amount,
    statement?.paid_amount,
    statement?.amount,
    debit,
    credit
  ]

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue
    const numeric = Number(candidate)
    if (Number.isFinite(numeric) && numeric !== 0) {
      return numeric
    }
  }

  const fallback = statement?.base_paid_amount ?? statement?.amount ?? debit ?? credit ?? 0
  const fallbackNumeric = Number(fallback)
  return Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0
}

const calculateStatementTotals = (statement) => {
  const isPaymentDoc = statement.voucher_type === 'Payment Entry' || statement.doctype === 'Payment Entry'
  const isCreditNote = statement.voucher_type === 'Nota de Crédito' || statement.is_return
  const baseGrandTotal = normalizeNumber(statement.base_grand_total ?? statement.grand_total ?? statement.amount ?? 0)
  const baseOutstanding = normalizeNumber(statement.base_outstanding_amount ?? statement.outstanding_amount ?? statement.outstanding ?? 0)
  const debitValue = normalizeNumber(statement.debit)
  const creditValue = normalizeNumber(statement.credit)

  if (isPaymentDoc) {
    const paymentValue = resolvePaymentAmount(statement, debitValue, creditValue)
    const unallocated = normalizeNumber(statement.unallocated_amount ?? 0)
    const total = -paymentValue
    const paid = -(paymentValue - Math.abs(unallocated))
    const balance = total - paid
    return { total, paid, balance }
  }

  if (isCreditNote) {
    const resolvedPaid = normalizeNumber(statement.base_paid_amount ?? statement.paid_amount ?? (baseGrandTotal - baseOutstanding))
    return { total: baseGrandTotal, paid: resolvedPaid, balance: baseOutstanding }
  }

  const invoiceAmount = Math.max(baseGrandTotal, Math.abs(creditValue), Math.abs(debitValue))
  const outstandingValue = normalizeNumber(statement.base_outstanding_amount ?? statement.outstanding_amount ?? statement.outstanding ?? baseOutstanding)
  const explicitPaid = normalizeNumber(statement.base_paid_amount ?? statement.paid_amount ?? statement.normalized_paid ?? statement.allocated_amount ?? 0)
  const paidValue = explicitPaid !== 0 ? explicitPaid : (invoiceAmount - outstandingValue)
  return { total: invoiceAmount, paid: paidValue, balance: outstandingValue }
}

export default function StatementsTable({
  statements,
  hasMoreStatements,
  loadingMoreStatements,
  loadMoreStatements,
  fetchWithAuth,
  itemSearchConfig = null,
  formatBalance,
  formatDate,
  formatVoucherNumber,
  mapVoucherTypeToSigla,
  truncateDescription,
  isInvoiceVoucherType,
  isPaymentVoucherType,
  isCreditVoucherType,
  isDebitVoucherType,
  openStatementEntry,
  companyCurrency = '',
  pagination = null,
  onPageChange = () => {},
  conciliationGroups = [],
  onOpenConciliationDocument = () => {}
}) {
  const resolvedItemSearchConfig = useMemo(() => {
    const candidate = itemSearchConfig && typeof itemSearchConfig === 'object' ? itemSearchConfig : {}
    const enabled = candidate.enabled !== false
    const childDoctype = (candidate.childDoctype || 'Sales Invoice Item').toString()
    const parentDoctype = (candidate.parentDoctype || 'Sales Invoice').toString()
    const parentfield = (candidate.parentfield || 'items').toString()
    const limit = Number.isFinite(Number(candidate.limit)) ? Number(candidate.limit) : 2000
    return {
      enabled,
      childDoctype,
      parentDoctype,
      parentfield,
      limit
    }
  }, [itemSearchConfig])

  const [expandedGroups, setExpandedGroups] = useState({})
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const showSummaryRows = Array.isArray(conciliationGroups) && conciliationGroups.length > 0 && !normalizedSearchQuery

  const [itemMatchedParents, setItemMatchedParents] = useState(null)
  const [itemSearchLoading, setItemSearchLoading] = useState(false)
  const [itemSearchError, setItemSearchError] = useState(null)
  const itemSearchCacheRef = useRef(new Map())
  const itemSearchAbortRef = useRef(null)
  const searchQueryRef = useRef(normalizedSearchQuery)
  searchQueryRef.current = normalizedSearchQuery
  const itemSearchDebugEnabled = false

  const isPaymentLikeDoc = useMemo(() => {
    return (doc) => {
      if (!doc) return false
      const typeHint = doc.voucher_type || doc.doctype || ''
      if (typeHint === 'Payment Entry') return true
      if (typeof isPaymentVoucherType === 'function' && isPaymentVoucherType(typeHint)) return true
      return false
    }
  }, [isPaymentVoucherType])

  const isParentDoc = useMemo(() => {
    return (doc) => {
      if (!doc) return false
      if (isPaymentLikeDoc(doc)) return false
      const parentDoctype = resolvedItemSearchConfig.parentDoctype
      const candidates = [doc.voucher_type, doc.doctype].filter(Boolean).map(String)
      return candidates.includes(parentDoctype)
    }
  }, [isPaymentLikeDoc, resolvedItemSearchConfig.parentDoctype])

  const parentInvoiceNames = useMemo(() => {
    const list = Array.isArray(statements) ? statements : []
    const names = []
    const seen = new Set()
    list.forEach((doc) => {
      if (!isParentDoc(doc)) return
      const id = doc.voucher_no || doc.erpnext_name || doc.name
      if (!id) return
      const key = String(id)
      if (seen.has(key)) return
      seen.add(key)
      names.push(key)
    })
    return names
  }, [isParentDoc, statements])

  const shouldSearchItems = useMemo(() => {
    if (!resolvedItemSearchConfig.enabled) return false
    if (!fetchWithAuth) return false
    if (!normalizedSearchQuery || normalizedSearchQuery.length < 3) return false
    if (/[a-zA-Z]/.test(normalizedSearchQuery)) return true
    if (/-/.test(normalizedSearchQuery) && normalizedSearchQuery.length >= 3) return true
    const digitsOnly = /^[0-9]+$/.test(normalizedSearchQuery)
    return digitsOnly && normalizedSearchQuery.length >= 5
  }, [fetchWithAuth, normalizedSearchQuery, resolvedItemSearchConfig.enabled])

  const conciliatedDocIds = new Set()
  if (showSummaryRows) {
    conciliationGroups.forEach(group => {
      (group.documents || []).forEach(doc => {
        const id = doc.name || doc.erpnext_name || doc.voucher_no
        if (id) conciliatedDocIds.add(id)
      })
    })
  }
  const statementsWithoutSummaryFilter = showSummaryRows ? statements.filter(statement => {
    const id = statement.voucher_no || statement.name
    return !conciliatedDocIds.has(id)
  }) : statements

  const getStatementDescriptionRaw = (doc) => {
    if (!doc) return ''
    const candidate = doc.remarks || doc.description || doc.voucher_description || doc.title
    if (!candidate) return ''
    return candidate.toString().trim()
  }

  const filteredStatements = useMemo(() => {
    if (!normalizedSearchQuery) return statementsWithoutSummaryFilter || []

    const query = normalizedSearchQuery
    const numericQueryString = query.replace(/[^\d.-]/g, '')
    const numericQuery = Number(numericQueryString)
    const isNumericLikeQuery = /^[\d.,-]+$/.test(query)
    const hasNumericQuery = isNumericLikeQuery && Number.isFinite(numericQuery) && query.replace(/[^\d]/g, '').length > 0
    const queryDateIso = normalizeDateToIso(query)

    return (statementsWithoutSummaryFilter || []).filter((doc) => {
      if (!doc) return false
      const docIdentifier = doc.voucher_no || doc.erpnext_name || doc.name || ''
      const idCandidates = [
        doc.voucher_no,
        doc.erpnext_name,
        doc.name
      ]
        .filter(Boolean)
        .map(v => String(v))
      const dateCandidates = [
        doc.posting_date,
        doc.transaction_date,
        doc.due_date,
        doc.date
      ]
      const dateTokens = dateCandidates.flatMap(expandDateTokens).map(v => String(v).toLowerCase())
      const desc = getStatementDescriptionRaw(doc).toLowerCase()
      const totals = calculateStatementTotals(doc)
      const amountCandidatesRaw = [
        doc.base_grand_total,
        doc.grand_total,
        doc.total,
        doc.total_amount,
        doc.amount,
        doc.base_paid_amount,
        doc.paid_amount,
        doc.paid,
        doc.normalized_paid,
        doc.base_outstanding_amount,
        doc.outstanding_amount,
        doc.outstanding,
        doc.balance,
        doc.debit,
        doc.credit,
        totals?.total,
        totals?.paid,
        totals?.balance
      ]
      const amountText = amountCandidatesRaw
        .filter(v => v !== undefined && v !== null && v !== '')
        .map(v => String(v))
        .join(' ')
        .toLowerCase()
      const voucherText = String(docIdentifier).toLowerCase()

      const localMatch = voucherText.includes(query)
        || dateTokens.some(token => token.includes(query))
        || (queryDateIso ? dateTokens.includes(queryDateIso) : false)
        || desc.includes(query)
        || amountText.includes(query)
        || (
          hasNumericQuery && amountCandidatesRaw.some((candidate) => {
            if (candidate === undefined || candidate === null || candidate === '') return false
            const numericCandidate = Number(candidate)
            return Number.isFinite(numericCandidate) && String(numericCandidate).includes(String(numericQuery))
          })
        )
        || (
          typeof formatBalance === 'function' && amountCandidatesRaw.some((candidate) => {
            if (candidate === undefined || candidate === null || candidate === '') return false
            return String(formatBalance(normalizeNumber(candidate)) || '').toLowerCase().includes(query)
          })
        )

      if (isPaymentLikeDoc(doc)) {
        return localMatch
      }

      const itemMatch = isParentDoc(doc)
        && itemMatchedParents instanceof Set
        && idCandidates.some(candidate => itemMatchedParents.has(candidate))

      return localMatch || itemMatch
    })
  }, [formatBalance, isParentDoc, isPaymentLikeDoc, itemMatchedParents, normalizedSearchQuery, statementsWithoutSummaryFilter])

  useEffect(() => {
    if (!shouldSearchItems) {
      if (itemSearchAbortRef.current) {
        itemSearchAbortRef.current.abort()
        itemSearchAbortRef.current = null
      }
      setItemMatchedParents(null)
      setItemSearchError(null)
      setItemSearchLoading(false)
      return
    }

    if (!parentInvoiceNames.length) {
      setItemMatchedParents(new Set())
      return
    }

    const parentsKey = parentInvoiceNames.join('|')
    const cacheKey = `${parentsKey}::${normalizedSearchQuery}`
    const cached = itemSearchCacheRef.current.get(cacheKey)
    if (cached) {
      setItemMatchedParents(cached)
      setItemSearchError(null)
      setItemSearchLoading(false)
      return
    }

    const handle = setTimeout(async () => {
      if (searchQueryRef.current !== normalizedSearchQuery) return

      if (itemSearchAbortRef.current) {
        itemSearchAbortRef.current.abort()
      }
      const controller = new AbortController()
      itemSearchAbortRef.current = controller

      setItemSearchLoading(true)
      setItemSearchError(null)

      try {
        const response = await fetchWithAuth(API_ROUTES.documentItemsSearch, {
          method: 'POST',
          body: JSON.stringify({
            child_doctype: resolvedItemSearchConfig.childDoctype,
            parent_doctype: resolvedItemSearchConfig.parentDoctype,
            parentfield: resolvedItemSearchConfig.parentfield,
            parents: parentInvoiceNames,
            query: normalizedSearchQuery,
            limit: resolvedItemSearchConfig.limit
          }),
          signal: controller.signal
        })

        if (!response || typeof response.json !== 'function') {
          const maybeError = response?.error
          if (maybeError?.name === 'AbortError') return
          throw maybeError || new Error('Error de conexiÛn')
        }

        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) {
          throw new Error(payload.message || `Error HTTP ${response.status}`)
        }

        const parents = Array.isArray(payload.parents) ? payload.parents : []
        const nextSet = new Set(parents.map(String))
        itemSearchCacheRef.current.set(cacheKey, nextSet)
        setItemMatchedParents(nextSet)

        if (itemSearchDebugEnabled) {
          console.debug('[StatementsTable] Item search OK', {
            query: normalizedSearchQuery,
            parentsInCache: parentInvoiceNames.length,
            matchedParents: nextSet.size
          })
        }
      } catch (error) {
        if (error?.name === 'AbortError') return
        console.error('[StatementsTable] Item search error', error)
        setItemSearchError(error?.message || 'Error buscando items')
        setItemMatchedParents(null)
      } finally {
        setItemSearchLoading(false)
      }
    }, 400)

    return () => clearTimeout(handle)
  }, [fetchWithAuth, normalizedSearchQuery, parentInvoiceNames, resolvedItemSearchConfig, shouldSearchItems])

  const summaryRowsData = (() => {
    if (!showSummaryRows) return []
    let running = 0
    return conciliationGroups.map(group => {
      const groupId = group.conciliation_id
      const documents = Array.isArray(group.documents) ? group.documents : []
      const groupDate = (documents[0] || {}).posting_date || group.posting_date
      let totalSum = 0
      let paidSum = 0
      let saldoValue = 0

      documents.forEach(doc => {
        const docTotals = calculateStatementTotals(doc)
        totalSum += normalizeNumber(docTotals.total)
        paidSum += normalizeNumber(docTotals.paid)
        saldoValue += normalizeNumber(docTotals.balance)
      })

      running += saldoValue

      return {
        groupId,
        documents,
        groupDate,
        summaryCurrency: companyCurrency,
        totalSum,
        paidSum,
        saldoValue,
        runningBalance: running
      }
    })
  })()
  const summaryBaseRunningBalance = summaryRowsData.length > 0 ? summaryRowsData[summaryRowsData.length - 1].runningBalance : 0

  const isEmptyState = filteredStatements.length === 0 && !showSummaryRows

  const statementsWithBalance = (() => {
    let runningBalance = 0
    return filteredStatements.map(statement => {
      const { total, paid, balance } = calculateStatementTotals(statement)
      runningBalance += balance
      return {
        ...statement,
        total,
        paid,
        balance,
        runningBalance
      }
    })
  })()

  const usePagination = Boolean(pagination && pagination.pageSize)
  const pageSize = usePagination ? Math.max(1, pagination.pageSize) : (statementsWithBalance.length || 1)
  const totalItems = statementsWithBalance.length
  const totalPages = usePagination ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1
  const currentPage = usePagination ? Math.min(Math.max(pagination.page || 1, 1), totalPages) : 1
  const startIndex = usePagination ? (currentPage - 1) * pageSize : 0
  const paginatedStatements = usePagination
    ? statementsWithBalance.slice(startIndex, startIndex + pageSize)
    : statementsWithBalance
  const showPaginationControls = usePagination && totalItems > pageSize
  const startItemNumber = showPaginationControls ? Math.min(startIndex + 1, totalItems) : 1
  const endItemNumber = showPaginationControls ? Math.min(startIndex + paginatedStatements.length, totalItems) : totalItems
  const toggleGroup = (groupId) => {
    if (!groupId) return
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }
  const resolveSigla = (rawType, fallback) => mapVoucherTypeToSigla(rawType || fallback)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value ?? '')}
            placeholder="Buscar por comprobante, fecha, descripci¢n o monto..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          {itemSearchLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
          )}
          {!!searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
              title="Limpiar b£squeda"
            >
              Limpiar
            </button>
          )}
        </div>
        {shouldSearchItems && itemSearchError && (
          <div className="mt-2 text-xs text-red-600">{itemSearchError}</div>
        )}
      </div>
      {isEmptyState ? (
        <div className="text-center py-12 text-gray-500 flex-1">
          <div className="text-4xl mb-4">🔎</div>
          <p>{normalizedSearchQuery ? 'No hay resultados para tu b£squeda' : 'No hay movimientos en la cuenta corriente'}</p>
        </div>
      ) : (
        <>
        <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <table className="accounting-table min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Nº
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tipo
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Descripción
                </th>
                { /* Removed 'Relación' column as requested */ }
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <DollarSign className="w-4 h-4 mx-auto" />
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Aplicado
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Saldo
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acumulado
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {summaryRowsData.map((summaryRow) => {
                const {
                  groupId,
                  documents,
                  groupDate,
                  summaryCurrency,
                  totalSum,
                  paidSum,
                  saldoValue,
                  runningBalance: summaryRunningBalance
                } = summaryRow
                const isExpanded = !!expandedGroups[groupId]
                return (
                  <React.Fragment key={`statement-conc-${groupId}`}>
                    <tr
                      className="bg-yellow-50 hover:bg-yellow-200 cursor-pointer"
                      onClick={() => toggleGroup(groupId)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        Conciliación
                        <span className="ml-2 text-xs text-gray-600">
                          ({documents.length})
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">CON</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{formatDate(groupDate)}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">Conciliación</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{summaryCurrency}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">
                        {formatBalance(totalSum)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">
                        {formatBalance(paidSum)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">
                        {formatBalance(saldoValue)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right">
                        {formatBalance(summaryRunningBalance)}
                      </td>
                    </tr>
                    {isExpanded && documents.map((doc) => {
                      const voucherNo = doc.voucher_no || doc.name
                      const docTypeHint = doc.voucher_type || doc.doctype
                      const docTotals = calculateStatementTotals(doc)
                      const docCurrency = companyCurrency
                      const isDocClickable = (isInvoiceVoucherType(docTypeHint) || isPaymentVoucherType(docTypeHint) || isCreditVoucherType(docTypeHint) || isDebitVoucherType(docTypeHint))
                      const docDescriptionRaw = getStatementDescriptionRaw(doc)
                      const docDescriptionDisplay = docDescriptionRaw ? truncateDescription(docDescriptionRaw) : ''
                      return (
                        <tr
                          key={`statement-conc-${groupId}-${voucherNo}`}
                          className={`bg-yellow-100 ${isDocClickable ? 'cursor-pointer hover:bg-yellow-200' : ''}`}
                          onClick={isDocClickable ? () => onOpenConciliationDocument(voucherNo, docTypeHint) : undefined}
                          title={isDocClickable ? 'Click para abrir documento' : ''}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatVoucherNumber(voucherNo)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{resolveSigla(doc.voucher_type || doc.doctype, doc.voucher_no)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{formatDate(doc.posting_date)}</td>
                          <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate text-left" title={docDescriptionRaw}>
                            {docDescriptionDisplay}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{docCurrency}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{formatBalance(docTotals.total)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{formatBalance(docTotals.paid)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{formatBalance(docTotals.balance)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">{formatBalance(docTotals.balance)}</td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                )
              })}
              {paginatedStatements.map((statement, index) => {
                const statementCurrency = companyCurrency
                const statementAccumulated = summaryBaseRunningBalance + (statement.runningBalance || 0)
                const statementDescriptionRaw = getStatementDescriptionRaw(statement)
                const statementDescriptionDisplay = statementDescriptionRaw ? truncateDescription(statementDescriptionRaw) : ''
                return (
                  <tr
                    key={index}
                    className={`hover:bg-gray-50 ${(isInvoiceVoucherType(statement.voucher_type) || isPaymentVoucherType(statement.voucher_type) || isCreditVoucherType(statement.voucher_type) || isDebitVoucherType(statement.voucher_type)) ? 'cursor-pointer' : ''}`}
                    onClick={(isInvoiceVoucherType(statement.voucher_type) || isPaymentVoucherType(statement.voucher_type) || isCreditVoucherType(statement.voucher_type) || isDebitVoucherType(statement.voucher_type)) ? () => { console.log('[CustomerPanel] statement row clicked', statement.voucher_no, statement.voucher_type); openStatementEntry(statement.voucher_no, statement.voucher_type) } : undefined}
                    title={(isInvoiceVoucherType(statement.voucher_type) || isPaymentVoucherType(statement.voucher_type) || isCreditVoucherType(statement.voucher_type) || isDebitVoucherType(statement.voucher_type)) ? 'Click para abrir documento' : ''}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-left">
                      {formatVoucherNumber(statement.voucher_no)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 text-left">
                      {resolveSigla(statement.voucher_type, statement.voucher_no)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 text-left">
                      {formatDate(statement.posting_date)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate text-left" title={statementDescriptionRaw}>
                      {statementDescriptionDisplay}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-left">
                      {statementCurrency}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatBalance(statement.total)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatBalance(statement.paid)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatBalance(statement.balance)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                      {formatBalance(statementAccumulated)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totales y paginación - fijos en la parte inferior */}
      <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
        {showPaginationControls && (
          <div className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-2xl mt-4 sm:px-6">
            <div className="flex items-center">
              <p className="text-sm text-gray-700">
                Mostrando{' '}
                <span className="font-medium">{startItemNumber}</span>{' '}
                a{' '}
                <span className="font-medium">{endItemNumber}</span>{' '}
                de{' '}
                <span className="font-medium">{totalItems}</span>{' '}
                movimientos
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              {(() => {
                const pages = []
                let startPage = Math.max(1, currentPage - 2)
                let endPage = Math.min(totalPages, currentPage + 2)
                if (endPage - startPage < 4) {
                  if (startPage === 1) {
                    endPage = Math.min(totalPages, startPage + 4)
                  } else if (endPage === totalPages) {
                    startPage = Math.max(1, endPage - 4)
                  }
                }
                for (let i = startPage; i <= endPage; i++) {
                  pages.push(
                    <button
                      key={i}
                      onClick={() => onPageChange(i)}
                      className={`relative inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                        i === currentPage
                          ? 'text-blue-600 bg-blue-50 border-blue-500'
                          : 'text-gray-500 bg-white border-gray-300 hover:bg-gray-50'
                      } border`}
                    >
                      {i}
                    </button>
                  )
                }
                return pages
              })()}
              <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {/* Botón de paginación */}
        {hasMoreStatements && (
          <div className="flex justify-center mt-4">
            <button
              onClick={loadMoreStatements}
              disabled={loadingMoreStatements}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMoreStatements ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Cargando...
                </>
              ) : (
                <>
                  Cargar más movimientos
                </>
              )}
            </button>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  )
}
