import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownCircle, DollarSign, Loader2 } from 'lucide-react'
import API_ROUTES from '../../apiRoutes'
import { CUSTOMER_INVOICE_PAGE_SIZE } from './constants'

export default function CustomerInvoicesTable({
  items = [],
  invoiceTab,
  invoiceTablePage,
  handleInvoiceTablePageChange,
  fetchWithAuth,
  bulkOptions = {},
  extraOptions = {},
  expandedConciliationRows = {},
  toggleConciliationRow = () => {},
  isInvoiceVoucherType = () => false,
  isPaymentVoucherType = () => false,
  isCreditVoucherType = () => false,
  isDebitVoucherType = () => false,
  formatDate = () => '',
  formatBalance = () => 0,
  truncateDescription = value => value,
  formatVoucherNumber = value => value,
  mapVoucherTypeToSigla = () => '',
  downloadDocumentPdf = () => {},
  handleDeleteInvoice = () => {},
  downloadingDocuments = {},
  handleOpenInvoice = () => {},
  handleOpenPayment = () => {}
}) {
  const {
    isBulkMode = false,
    selectedItems,
    onToggleRow,
    onToggleAll,
    documentsForSelection,
    isProcessing = false,
    canSelectRow
  } = bulkOptions

  const {
    summaryGroups = [],
    onOpenConciliationDocument = () => {}
  } = extraOptions || {}

  const selectedSet = selectedItems instanceof Set
    ? selectedItems
    : new Set(selectedItems || [])

  const hasSummaryGroups = !isBulkMode && Array.isArray(summaryGroups) && summaryGroups.length > 0

  const conciliatedDocIds = new Set()
  if (hasSummaryGroups) {
    summaryGroups.forEach(group => {
      (group.documents || []).forEach(doc => {
        const id = doc.name || doc.erpnext_name || doc.voucher_no
        if (id) conciliatedDocIds.add(id)
      })
    })
  }

  const normalizeNumber = (value) => {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : 0
  }

  const getDocumentDescriptionRaw = (doc) => {
    if (!doc) return ''
    const candidate = doc.remarks || doc.description || doc.voucher_description
    if (!candidate) return ''
    return candidate.toString().trim()
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

  const [searchByTab, setSearchByTab] = useState({})
  const searchQuery = (searchByTab?.[invoiceTab] || '').toString()
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const showSummaryRows = hasSummaryGroups && !normalizedSearchQuery

  const [itemMatchedParents, setItemMatchedParents] = useState(null)
  const [itemSearchLoading, setItemSearchLoading] = useState(false)
  const [itemSearchError, setItemSearchError] = useState(null)
  const itemSearchCacheRef = useRef(new Map())
  const itemSearchAbortRef = useRef(null)
  const searchQueryRef = useRef(normalizedSearchQuery)
  searchQueryRef.current = normalizedSearchQuery

  const isPaymentLikeDoc = useCallback((doc) => {
    if (!doc) return false
    if (doc.itemType === 'payment') return true
    const typeHint = doc.voucher_type || doc.doctype || ''
    if (typeHint === 'Payment Entry') return true
    if (typeof isPaymentVoucherType === 'function' && isPaymentVoucherType(typeHint)) return true
    return false
  }, [isPaymentVoucherType])

  const isSalesInvoiceLikeDoc = useCallback((doc) => {
    if (!doc) return false
    if (isPaymentLikeDoc(doc)) return false
    const typeHint = doc.voucher_type || doc.doctype || ''
    if (typeHint === 'Sales Invoice') return true
    if (typeof isInvoiceVoucherType === 'function' && isInvoiceVoucherType(typeHint)) return true
    if (typeof isCreditVoucherType === 'function' && isCreditVoucherType(typeHint)) return true
    if (typeof isDebitVoucherType === 'function' && isDebitVoucherType(typeHint)) return true
    return false
  }, [isCreditVoucherType, isDebitVoucherType, isInvoiceVoucherType, isPaymentLikeDoc])

  const parentInvoiceNames = useMemo(() => {
    const list = Array.isArray(items) ? items : []
    const names = []
    list.forEach((doc) => {
      if (!isSalesInvoiceLikeDoc(doc)) return
      const id = doc.erpnext_name || doc.name || doc.voucher_no
      if (id) names.push(String(id))
    })
    return names
  }, [isSalesInvoiceLikeDoc, items])

  const shouldSearchItems = useMemo(() => {
    if (!fetchWithAuth) return false
    if (!normalizedSearchQuery || normalizedSearchQuery.length < 3) return false
    return /[a-zA-Z]/.test(normalizedSearchQuery)
  }, [fetchWithAuth, normalizedSearchQuery])

  const itemSearchDebugEnabled = false

  useEffect(() => {
    setItemMatchedParents(null)
    setItemSearchError(null)
    setItemSearchLoading(false)
  }, [invoiceTab])

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
        const response = await fetchWithAuth(API_ROUTES.salesInvoiceItemsSearch, {
          method: 'POST',
          body: JSON.stringify({
            parents: parentInvoiceNames,
            query: normalizedSearchQuery,
            limit: 2000
          }),
          signal: controller.signal
        })
        if (!response || typeof response.json !== 'function') {
          const maybeError = response?.error
          if (maybeError?.name === 'AbortError') return
          throw maybeError || new Error('Error de conexión')
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
          console.debug('[CustomerInvoicesTable] Item search OK', {
            query: normalizedSearchQuery,
            parentsInCache: parentInvoiceNames.length,
            matchedParents: nextSet.size,
            sampleParents: parentInvoiceNames.slice(0, 6)
          })
        }
      } catch (error) {
        if (error?.name === 'AbortError') return
        console.error('[CustomerInvoicesTable] Item search error', error)
        setItemSearchError(error?.message || 'Error buscando items')
        setItemMatchedParents(null)
      } finally {
        setItemSearchLoading(false)
      }
    }, 400)

    return () => clearTimeout(handle)
  }, [fetchWithAuth, normalizedSearchQuery, parentInvoiceNames, shouldSearchItems])

  const filteredItems = showSummaryRows
    ? items.filter(item => {
        const id = item.name || item.erpnext_name || item.voucher_no
        return !conciliatedDocIds.has(id)
      })
    : items

  const filteredBySearch = useMemo(() => {
    if (!normalizedSearchQuery) return filteredItems

    const query = normalizedSearchQuery
    const numericQueryString = query.replace(/[^\d.-]/g, '')
    const numericQuery = Number(numericQueryString)
    const isNumericLikeQuery = /^[\d.,-]+$/.test(query)
    const hasNumericQuery = isNumericLikeQuery && Number.isFinite(numericQuery) && query.replace(/[^\d]/g, '').length > 0
    const queryDateIso = normalizeDateToIso(query)

    return (filteredItems || []).filter((doc) => {
      if (!doc) return false
      const docIdentifier = doc.erpnext_name || doc.name || doc.voucher_no || ''
      const dateCandidates = [
        doc.posting_date,
        doc.fecha,
        doc.due_date,
        doc.transaction_date
      ]
      const dateTokens = dateCandidates.flatMap(expandDateTokens).map(v => String(v).toLowerCase())
      const desc = getDocumentDescriptionRaw(doc).toLowerCase()
      const amountRaw = doc.base_grand_total ?? doc.grand_total ?? doc.base_paid_amount ?? doc.amount ?? doc.total ?? ''
      const amountText = String(amountRaw).toLowerCase()
      const voucherText = String(docIdentifier).toLowerCase()

      const localMatch = voucherText.includes(query)
        || dateTokens.some(token => token.includes(query))
        || (queryDateIso ? dateTokens.includes(queryDateIso) : false)
        || desc.includes(query)
        || amountText.includes(query)
        || (hasNumericQuery && Number.isFinite(Number(amountRaw)) && String(Number(amountRaw)).includes(String(numericQuery)))

      if (doc.itemType === 'payment') {
        return localMatch
      }

      const itemMatch = isSalesInvoiceLikeDoc(doc) && itemMatchedParents instanceof Set && itemMatchedParents.has(String(docIdentifier))
      return localMatch || itemMatch
    })
  }, [expandDateTokens, filteredItems, getDocumentDescriptionRaw, isSalesInvoiceLikeDoc, itemMatchedParents, normalizeDateToIso, normalizedSearchQuery])

  const showEmptyState = filteredBySearch.length === 0 && !showSummaryRows

  let summaryRunningBalance = 0
  const summaryRowsData = showSummaryRows
    ? summaryGroups.map((group, groupIndex) => {
        const documents = Array.isArray(group.documents) ? group.documents : []
        

        
        // Calcular totales aplicando la lógica específica para pagos y facturas
        let totalSum = 0
        let paidSum = 0
        let outstandingSum = 0
        
        documents.forEach(doc => {
          const isPaymentDoc = doc.doctype === 'Payment Entry' || doc.voucher_type === 'Payment Entry'
          
          if (isPaymentDoc) {
            // Para pagos
            const paidAmount = Number(doc.base_paid_amount ?? doc.base_grand_total ?? doc.amount ?? 0) || 0
            const unallocated = Number(doc.base_outstanding_amount ?? doc.outstanding ?? 0) || 0
            
            totalSum += -paidAmount  // Negativo porque reduce la deuda
            paidSum += -(paidAmount - Math.abs(unallocated))  // NEGATIVO: lo asignado
            outstandingSum += unallocated  // Lo sin asignar (negativo)
          } else {
            // Para facturas/NC
            const amount = Number(doc.base_grand_total ?? doc.amount ?? doc.grand_total ?? 0) || 0
            const outstanding = Number(doc.base_outstanding_amount ?? doc.outstanding ?? doc.outstanding_amount ?? 0) || 0
            
            totalSum += amount
            paidSum += amount - outstanding
            outstandingSum += outstanding
          }
        })
        
        summaryRunningBalance += outstandingSum
        return {
          group,
          documents,
          outstandingSum,
          totalSum,
          paidSum,
          runningBalance: summaryRunningBalance
        }
      })
    : []

  let runningBalance = summaryRunningBalance
  const itemsWithBalance = filteredBySearch.map(item => {
    const docIdentifier = item.erpnext_name || item.name
    let amount
    let outstanding
    let paid
    let balance
    let totalInCompanyCurrency

    if (item.itemType === 'payment') {
      // Para pagos: usar base_paid_amount (moneda base de la empresa)
      const paidAmount = normalizeNumber(item.base_paid_amount ?? item.paid_amount ?? 0)
      const unallocated = normalizeNumber(item.base_outstanding_amount ?? item.outstanding_amount ?? 0)
      
      // Para pagos:
      // - Total: monto del pago (negativo para mostrar que reduce deuda)
      // - Aplicado: monto asignado a facturas = -(paidAmount - abs(unallocated)) NEGATIVO
      // - Saldo: monto sin asignar (negativo)
      amount = -paidAmount  // Negativo porque reduce la deuda
      paid = -(paidAmount - Math.abs(unallocated))  // NEGATIVO: lo que ya se aplicó a facturas
      balance = unallocated  // Lo que queda sin aplicar (negativo)
      outstanding = Math.abs(unallocated)
      totalInCompanyCurrency = -paidAmount
    } else {
      // Para facturas: el backend YA envía base_grand_total y base_outstanding_amount en moneda base de la empresa
      // NO hacer conversiones adicionales
      const total = normalizeNumber(item.base_grand_total ?? item.grand_total ?? 0)
      const outstandingAmount = normalizeNumber(item.base_outstanding_amount ?? item.outstanding_amount ?? 0)

      amount = total
      outstanding = invoiceTab === 'draft' ? total : outstandingAmount

      if (invoiceTab === 'draft') {
        paid = 0
        balance = total
      } else {
        paid = total - outstandingAmount
        balance = outstandingAmount
      }
      totalInCompanyCurrency = total
    }

    runningBalance += balance
    return {
      ...item,
      paid,
      balance,
      runningBalance,
      docIdentifier,
      totalInCompanyCurrency: totalInCompanyCurrency
    }
  })

  const selectionItems = Array.isArray(documentsForSelection) ? documentsForSelection : items
  const selectableItems = canSelectRow ? selectionItems.filter(canSelectRow) : selectionItems
  const allSelected = isBulkMode && selectableItems.length > 0 && selectableItems.every(item => {
    const docIdentifier = item.erpnext_name || item.name
    return docIdentifier && selectedSet.has(docIdentifier)
  })

  const totalItems = itemsWithBalance.length
  const totalPages = Math.max(1, Math.ceil(totalItems / CUSTOMER_INVOICE_PAGE_SIZE))
  const currentPage = Math.min(invoiceTablePage, totalPages)
  const startIndex = (currentPage - 1) * CUSTOMER_INVOICE_PAGE_SIZE
  const paginatedItems = itemsWithBalance.slice(startIndex, startIndex + CUSTOMER_INVOICE_PAGE_SIZE)
  const hasPagination = totalItems > CUSTOMER_INVOICE_PAGE_SIZE
  const startItemNumber = Math.min(startIndex + 1, totalItems)
  const endItemNumber = Math.min(startIndex + paginatedItems.length, totalItems)

    const headerCellClass = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'
    const currencyHeaderClass = 'px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider'
    const rightHeaderClass = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider'
    const baseBodyCellClass = 'px-6 py-3 whitespace-nowrap text-sm'
    const bodyCellClass = `${baseBodyCellClass} text-gray-900`
    const bodyCellRight = `${baseBodyCellClass} text-gray-900 text-right`
    const mutedBodyCellClass = `${baseBodyCellClass} text-gray-700`
    const mutedBodyCellRight = `${baseBodyCellClass} text-gray-700 text-right`
    const secondaryBodyCellClass = `${baseBodyCellClass} text-gray-600`

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              const value = e.target.value ?? ''
              setSearchByTab((prev) => ({ ...(prev || {}), [invoiceTab]: value }))
            }}
            placeholder="Buscar por comprobante, fecha, descripción, monto o item..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
          {itemSearchLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
          )}
          {!!searchQuery && (
            <button
              type="button"
              onClick={() => setSearchByTab((prev) => ({ ...(prev || {}), [invoiceTab]: '' }))}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
              title="Limpiar búsqueda"
            >
              Limpiar
            </button>
          )}
        </div>
        {itemSearchDebugEnabled && normalizedSearchQuery && (
          <div className="mt-2 text-[11px] text-gray-500">
            query={normalizedSearchQuery}
          </div>
        )}
        {shouldSearchItems && itemSearchError && (
          <div className="mt-2 text-xs text-red-600">{itemSearchError}</div>
        )}
        {itemSearchDebugEnabled && shouldSearchItems && itemMatchedParents instanceof Set && !itemSearchLoading && !itemSearchError && (
          <div className="mt-2 text-xs text-gray-500">
            Coincidencias por items: {itemMatchedParents.size}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto w-full">
        {showEmptyState ? (
          <div className="text-center py-12 text-gray-500">
            <div className="text-4xl mb-4">📄</div>
            <p>{normalizedSearchQuery ? 'No hay resultados para tu búsqueda' : `No hay ${invoiceTab === 'draft' ? 'borradores' : 'facturas pendientes'}`}</p>
          </div>
        ) : null}
        {!showEmptyState && (
        <table className="accounting-table min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {isBulkMode && (
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                  <input
                    type="checkbox"
                    className="form-checkbox h-4 w-4 text-red-600"
                    checked={allSelected}
                    onChange={(e) => onToggleAll && onToggleAll(e.target.checked)}
                    disabled={isProcessing || selectableItems.length === 0}
                  />
                </th>
              )}
              <th className={headerCellClass}>
                Nº
              </th>
              <th className={headerCellClass}>
                Tipo
              </th>
              <th className={headerCellClass}>
                Fecha
              </th>
              <th className={headerCellClass}>
                Descripción
              </th>
              { /* 'Relación' header removed for cuenta corriente */ }
              <th className={currencyHeaderClass}>
                <DollarSign className="w-4 h-4 mx-auto" />
              </th>
              <th className={rightHeaderClass}>
                Total
              </th>
                {invoiceTab !== 'draft' && (
                  <th className={rightHeaderClass}>
                    Aplicado
                  </th>
                )}
                {invoiceTab !== 'draft' && (
                  <th className={rightHeaderClass}>
                    Saldo
                  </th>
                )}
                {invoiceTab !== 'draft' && (
                  <th className={rightHeaderClass}>
                    Acumulado
                  </th>
                )}
              {invoiceTab !== 'draft' && (
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  PDF
                </th>
              )}
              {invoiceTab === 'draft' && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acciones
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {showSummaryRows && summaryRowsData.map(({ group, documents, outstandingSum, totalSum, paidSum, runningBalance: groupRunningBalance }) => {
              const groupId = group.conciliation_id
              const isExpanded = !!expandedConciliationRows[groupId]
              const firstDoc = documents[0] || {}
              
              return (
                <React.Fragment key={`cust-conc-${groupId}`}>
                    <tr
                      className="bg-yellow-50 hover:bg-yellow-200 cursor-pointer"
                      onClick={() => toggleConciliationRow(groupId)}
                    >
                      {isBulkMode && <td className="px-3 py-3" />}
                      <td className={mutedBodyCellClass}>
                        Conciliación
                        <span className="ml-2 text-xs text-gray-600">
                          ({documents.length})
                        </span>
                      </td>
                      <td className={mutedBodyCellClass}>CON</td>
                      <td className={mutedBodyCellClass}>
                        {formatDate(firstDoc.posting_date)}
                      </td>
                      <td className={`${mutedBodyCellClass} max-w-xs truncate text-left`} title={getDocumentDescriptionRaw(firstDoc)}>
                        {truncateDescription(getDocumentDescriptionRaw(firstDoc))}
                      </td>
                      <td className={mutedBodyCellClass}>-</td>
                      <td className={mutedBodyCellRight}>
                        {formatBalance(totalSum)}
                      </td>
                      {invoiceTab !== 'draft' && (
                        <>
                          <td className={mutedBodyCellRight}>
                            {formatBalance(paidSum)}
                          </td>
                          <td className={mutedBodyCellRight}>
                            {formatBalance(outstandingSum)}
                          </td>
                          <td className={mutedBodyCellRight}>
                            {formatBalance(groupRunningBalance)}
                          </td>
                          <td className="px-4 py-3" />
                        </>
                      )}
                      {invoiceTab === 'draft' && (
                        <td className="px-6 py-3 text-sm text-indigo-700 text-left">-</td>
                      )}
                    </tr>
                  {isExpanded && documents.map((doc) => {
                    const voucherNo = doc.voucher_no || doc.name
                   
                    // Determinar si es pago basado en doctype o voucher_type
                    const isPaymentDoc = doc.doctype === 'Payment Entry' || doc.voucher_type === 'Payment Entry'
                    
                    let docAmount, docOutstanding, docPaid
                    
                    if (isPaymentDoc) {
                      // Para pagos: usar base_paid_amount y base_outstanding_amount
                      const paidAmount = Number(doc.base_paid_amount ?? doc.base_grand_total ?? doc.amount ?? 0) || 0
                      const unallocated = Number(doc.base_outstanding_amount ?? doc.outstanding ?? 0) || 0
                      
                      docAmount = -paidAmount  // Negativo porque reduce la deuda
                      docPaid = -(paidAmount - Math.abs(unallocated))  // NEGATIVO: lo asignado
                      docOutstanding = unallocated  // Lo sin asignar (negativo)
                    } else {
                      // Para facturas/NC: usar base_grand_total y base_outstanding_amount
                      docAmount = Number(doc.base_grand_total ?? doc.amount ?? doc.grand_total ?? doc.paid_amount ?? doc.total ?? 0) || 0
                      docOutstanding = Number(doc.base_outstanding_amount ?? doc.outstanding ?? doc.outstanding_amount ?? doc.unallocated_amount ?? doc.balance ?? 0) || 0
                      docPaid = docAmount - docOutstanding
                    }
                    
                    const docTypeHint = doc.voucher_type || doc.doctype
                    const isDocClickable = (
                      isInvoiceVoucherType(docTypeHint) ||
                      isPaymentVoucherType(docTypeHint) ||
                      isCreditVoucherType(docTypeHint) ||
                      isDebitVoucherType(docTypeHint)
                    )
                    const docDescriptionRaw = getDocumentDescriptionRaw(doc)
                    const docDescriptionDisplay = docDescriptionRaw ? truncateDescription(docDescriptionRaw) : ''
                    
                    return (
                    <tr
                      key={`cust-conc-${groupId}-${voucherNo}`}
                      className={`bg-yellow-100 ${isDocClickable ? 'cursor-pointer hover:bg-yellow-200' : ''}`}
                      onClick={isDocClickable ? () => onOpenConciliationDocument(voucherNo, docTypeHint) : undefined}
                      title={isDocClickable ? 'Click para abrir documento' : ''}
                    >
                      {isBulkMode && <td className="px-3 py-3" />}
                      <td className={bodyCellClass}>{formatVoucherNumber(voucherNo)}</td>
                      <td className={secondaryBodyCellClass}>{mapVoucherTypeToSigla(doc.voucher_type || doc.doctype)}</td>
                      <td className={secondaryBodyCellClass}>{formatDate(doc.posting_date)}</td>
                          <td
                            className={`${secondaryBodyCellClass} max-w-xs truncate text-left`}
                            title={docDescriptionRaw}
                          >
                            {docDescriptionDisplay}
                          </td>
                      <td className={secondaryBodyCellClass}>-</td>
                      <td className={bodyCellRight}>{formatBalance(docAmount)}</td>
                      {invoiceTab !== 'draft' && (
                        <>
                          <td className={bodyCellRight}>{formatBalance(docPaid)}</td>
                          <td className={bodyCellRight}>{formatBalance(docOutstanding)}</td>
                          <td className={bodyCellRight}>{formatBalance(docOutstanding)}</td>
                          <td className="px-4 py-3 text-center relative" onClick={(e) => e.stopPropagation()}>
                            {doc.doctype === 'Sales Invoice' && (
                              <button
                                type="button"
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded-full border border-gray-200 text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  downloadDocumentPdf({
                                    docType: doc.doctype,
                                    docName: voucherNo,
                                    suggestedFileName: formatVoucherNumber(voucherNo)
                                  })
                                }}
                              >
                                <ArrowDownCircle className="w-6 h-6" />
                              </button>
                            )}
                          </td>
                        </>
                      )}
                      {invoiceTab === 'draft' && (
                        <td className={`${secondaryBodyCellClass} text-left`}>
                          <button
                            type="button"
                            className="text-blue-600 hover:text-blue-800 text-xs"
                            onClick={() => onOpenConciliationDocument(voucherNo, doc.doctype || doc.voucher_type)}
                          >
                            Ver
                          </button>
                        </td>
                      )}
                    </tr>
                    )
                  })}
                </React.Fragment>
              )
            })}
            {paginatedItems.map((item, index) => {
              const docIdentifier = item.docIdentifier || item.erpnext_name || item.name
              const isPayment = item.itemType === 'payment'
              const itemDescriptionRaw = getDocumentDescriptionRaw(item)
              const itemDescriptionDisplay = itemDescriptionRaw ? truncateDescription(itemDescriptionRaw) : ''
              const rowSelectable = !canSelectRow || canSelectRow(item)
              const canOpen = Boolean(docIdentifier)
              return (
                  <tr
                    key={index}
                    className={`hover:bg-gray-50 ${canOpen ? 'cursor-pointer' : ''}`}
                    onClick={canOpen ? () => (isPayment ? handleOpenPayment(docIdentifier) : handleOpenInvoice(docIdentifier)) : undefined}
                    title={canOpen ? (isPayment ? 'Click para abrir el pago' : 'Click para abrir la factura') : ''}
                  >
                    {isBulkMode && (
                      <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="form-checkbox h-4 w-4 text-red-600"
                          checked={rowSelectable && selectedSet.has(docIdentifier)}
                          onChange={(e) => {
                            e.stopPropagation()
                            if (rowSelectable) {
                              onToggleRow && onToggleRow(docIdentifier, e.target.checked)
                            }
                          }}
                          disabled={!rowSelectable || isProcessing}
                        />
                      </td>
                    )}
                    <td className={bodyCellClass}>
                      {formatVoucherNumber(docIdentifier || item.name)}
                    </td>
                    <td className={secondaryBodyCellClass}>
                      {(() => {
                        if (isPayment) return mapVoucherTypeToSigla('Pago')
                        let voucherType = 'Factura'
                        if (item.is_return || item.status === 'Return') {
                          voucherType = 'Nota de Crédito'
                        } else if (item.name && item.name.includes('NDB')) {
                          voucherType = 'Nota de Débito'
                        } else if (item.invoice_type) {
                          voucherType = item.invoice_type
                        }
                        return mapVoucherTypeToSigla(voucherType)
                      })()}
                    </td>
                    <td className={secondaryBodyCellClass}>
                      {formatDate(item.posting_date)}
                    </td>
                    <td
                      className={`${secondaryBodyCellClass} max-w-xs truncate text-left`}
                      title={itemDescriptionRaw}
                    >
                      {itemDescriptionDisplay}
                    </td>
                    <td className={bodyCellClass}>-</td>
                    <td className={bodyCellRight}>
                      {formatBalance(item.totalInCompanyCurrency ?? (isPayment ? item.paid_amount : item.grand_total))}
                    </td>
                    {invoiceTab !== 'draft' && (
                      <>
                        <td className={bodyCellRight}>
                          {formatBalance(item.paid)}
                        </td>
                        <td className={bodyCellRight}>
                          {formatBalance(item.balance)}
                        </td>
                        <td className={`${bodyCellRight} font-medium`}>
                          {formatBalance(item.runningBalance)}
                        </td>
                        <td className="px-4 py-3 text-center relative" onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const pdfDocType = isPayment ? 'Payment Entry' : (docIdentifier ? 'Sales Invoice' : null)
                            if (!pdfDocType || !docIdentifier) {
                              return <span className="text-xs text-gray-400">-</span>
                            }
                            const isPdfDownloading = Boolean(downloadingDocuments[docIdentifier])
                            return (
                              <button
                                type="button"
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded-full border border-gray-200 text-gray-600 hover:text-blue-600 hover:border-blue-400 transition-colors disabled:opacity-50"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  downloadDocumentPdf({
                                    docType: pdfDocType,
                                    docName: docIdentifier,
                                    suggestedFileName: formatVoucherNumber(docIdentifier)
                                  })
                                }}
                                disabled={isPdfDownloading}
                              >
                                {isPdfDownloading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <ArrowDownCircle className="w-2.5 h-2.5" />
                                )}
                              </button>
                            )
                          })()}
                        </td>
                      </>
                    )}
                    {invoiceTab === 'draft' && (
                      <td className={secondaryBodyCellClass}>
                        {isPayment ? (
                          <span>Pago en borrador</span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteInvoice(docIdentifier)
                            }}
                            className="text-red-600 hover:text-red-900 p-1"
                            title="Eliminar factura borrador"
                          >
                            X
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
              )
            })}
          </tbody>
        </table>
        )}
      </div>
      {!showEmptyState && hasPagination && (
        <div className="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200 sm:px-6">
          <div className="flex items-center">
            <p className="text-sm text-gray-700">
              Mostrando{' '}
              <span className="font-medium">{startItemNumber}</span>{' '}
              a{' '}
              <span className="font-medium">{endItemNumber}</span>{' '}
              de{' '}
              <span className="font-medium">{totalItems}</span>{' '}
              resultados
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleInvoiceTablePageChange(currentPage - 1)}
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
                    onClick={() => handleInvoiceTablePageChange(i)}
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
              onClick={() => handleInvoiceTablePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="relative inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
