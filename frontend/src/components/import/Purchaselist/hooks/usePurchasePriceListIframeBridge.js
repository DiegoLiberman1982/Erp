import { useEffect, useRef, useCallback } from 'react'
import API_ROUTES from '../../../../apiRoutes'
import { getDuplicateCodes } from '../../ItemImport/itemImportHelpers'
import {
  countSaveableItems as _countSaveableItems,
  toggleSelectAllSet
} from '../../../../handsometable/utils/tableFilters'
import {
  addAbbr,
  normalizePriceInput,
  normalizeSku,
  sleep
} from '../utils/purchasePriceListHelpers'

const LARGE_PASTE_THRESHOLD = 500
const BULK_DETAILS_CHUNK_SIZE = 250
const BULK_DETAILS_YIELD_MS = 10

const detectAmbiguousDecimalFormat = (value) => {
  if (value === undefined || value === null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9.,-]/g, '')
  if (!cleaned) return null

  const hasDot = cleaned.includes('.')
  const hasComma = cleaned.includes(',')
  if (!hasDot && !hasComma) return null

  if (hasDot && hasComma) {
    return null
  }

  const separatorChar = hasDot ? '.' : ','
  const fragments = cleaned.split(separatorChar)
  const decimals = fragments.length > 1 ? fragments[fragments.length - 1] : ''
  const isAmbiguous = decimals.length === 0 || (decimals.length === 3 && /^\d{3}$/.test(decimals))

  if (!isAmbiguous) {
    return null
  }

  return {
    ambiguous: true,
    suspected: separatorChar === '.' ? 'comma' : 'dot',
    sample: raw
  }
}

export default function usePurchasePriceListIframeBridge({
  iframeRef,
  items,
  setItems,
  selectedRows,
  setSelectedRows,
  setVisibleRowIds,
  fetchWithAuth,
  activeCompany,
  selectedPriceList,
  showNotification,
  visibleItems,
  onBulkDetailsStart,
  onBulkDetailsEnd,
  onDecimalFormatRequest,
  decimalSeparator = 'auto'
}) {
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const selectedPriceListRef = useRef(selectedPriceList)
  useEffect(() => {
    selectedPriceListRef.current = selectedPriceList
  }, [selectedPriceList])

  const activeCompanyRef = useRef(activeCompany)
  useEffect(() => {
    activeCompanyRef.current = activeCompany
  }, [activeCompany])

  const fetchWithAuthRef = useRef(fetchWithAuth)
  useEffect(() => {
    fetchWithAuthRef.current = fetchWithAuth
  }, [fetchWithAuth])

  const showNotificationRef = useRef(showNotification)
  useEffect(() => {
    showNotificationRef.current = showNotification
  }, [showNotification])

  const decimalFormatRequestRef = useRef(onDecimalFormatRequest)
  useEffect(() => {
    decimalFormatRequestRef.current = onDecimalFormatRequest
  }, [onDecimalFormatRequest])

  const decimalSeparatorRef = useRef(decimalSeparator)
  useEffect(() => {
    decimalSeparatorRef.current = decimalSeparator
  }, [decimalSeparator])

  const bulkStartRef = useRef(onBulkDetailsStart)
  const bulkEndRef = useRef(onBulkDetailsEnd)
  useEffect(() => {
    bulkStartRef.current = onBulkDetailsStart
    bulkEndRef.current = onBulkDetailsEnd
  }, [onBulkDetailsStart, onBulkDetailsEnd])

  const selectedRowsRef = useRef(selectedRows)
  useEffect(() => {
    selectedRowsRef.current = selectedRows
  }, [selectedRows])

  const visibleItemsRef = useRef(visibleItems)
  useEffect(() => {
    visibleItemsRef.current = visibleItems
  }, [visibleItems])

  const rowIdCounterRef = useRef(1)
  useEffect(() => {
    const snapshot = itemsRef.current || []
    const maxNumericId = snapshot.reduce((max, item) => {
      if (typeof item?.id === 'number' && item.id > max) {
        return item.id
      }
      return max
    }, 0)
    if (maxNumericId + 1 > rowIdCounterRef.current) {
      rowIdCounterRef.current = maxNumericId + 1
    }
  }, [items])

  const generateRowId = useCallback(() => {
    const nextId = rowIdCounterRef.current++
    if (!Number.isFinite(nextId)) {
      rowIdCounterRef.current = 1
      return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
    return nextId
  }, [])

  const bulkDetailsTokenRef = useRef(0)
  const cancelInFlight = useCallback(() => {
    bulkDetailsTokenRef.current = Date.now()
    bulkEndRef.current?.()
  }, [])

  const syncIframeData = (itemsToSync) => {
    if (!Array.isArray(itemsToSync) || itemsToSync.length === 0) {
      return
    }

    try {
      const iframeWindow = iframeRef?.current?.contentWindow
      if (!iframeWindow) {
        return
      }

      const duplicates = getDuplicateCodes(itemsToSync)
      const duplicateSet = new Set(duplicates)

      const rowHighlights = itemsToSync.map(it => {
        if (it.item_code && duplicateSet.has(it.item_code)) return 'duplicate'
        if (it.errors && Object.keys(it.errors).some(k => it.errors[k])) return 'error'
        return null
      })

      const payload = itemsToSync.map(it => {
        const existingValue = (() => {
          const existing = typeof it.existing_price === 'number' ? it.existing_price : parseFloat(it.existing_price)
          if (Number.isFinite(existing)) {
            return existing
          }
          const original = typeof it.original_price === 'number' ? it.original_price : parseFloat(it.original_price)
          return Number.isFinite(original) ? original : 0
        })()

        const newValue = (() => {
          if (typeof it.raw_new_price === 'string' && it.raw_new_price.trim() !== '') {
            return it.raw_new_price
          }
          const price = typeof it.price === 'number' ? it.price : parseFloat(it.price)
          if (Number.isFinite(price) && price !== 0) {
            return price.toString()
          }
          return ''
        })()

        return {
          selected: selectedRowsRef.current.has(it.id),
          item_code: it.item_code,
          existing_price: existingValue,
          new_price: newValue,
          item_group: it.item_group,
          brand: it.brand,
          item_name: it.item_name
        }
      })
      const rowIds = itemsToSync.map(it => (it && Object.prototype.hasOwnProperty.call(it, 'id')) ? it.id : null)

      iframeWindow.postMessage({
        type: 'ht-load-items',
        items: payload,
        rowIds,
        rowHighlights
      }, '*')
    } catch (error) {
      console.debug('Error updating iframe with item details', error)
    }
  }

  const scheduleIframeSync = (itemsToSync) => {
    if (!Array.isArray(itemsToSync) || itemsToSync.length === 0) {
      return
    }

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => syncIframeData(itemsToSync))
    } else {
      setTimeout(() => syncIframeData(itemsToSync), 0)
    }
  }

  const applyBulkDetailResults = (bulkItems) => {
    if (!Array.isArray(bulkItems) || bulkItems.length === 0) {
      return
    }

    const itemsDataMap = {}
    bulkItems.forEach(itemData => {
      const cleanCode = normalizeSku(itemData.item_code)
      const erpCode = normalizeSku(itemData.erp_item_code)
      if (cleanCode) {
        itemsDataMap[cleanCode] = itemData
      }
      if (erpCode) {
        itemsDataMap[erpCode] = itemData
      }
    })

    setItems(prevItems => {
      if (!prevItems || prevItems.length === 0) {
        return prevItems
      }

      let modified = false
      const nextItems = prevItems.map(item => {
        const lookupCode = normalizeSku(item.item_code)
        const lookupErpCode = normalizeSku(item.erp_item_code)
        const itemData = itemsDataMap[lookupCode] || itemsDataMap[lookupErpCode]

        if (!itemData || !itemData.found) {
          if (!item.erp_item_code) {
            const fallbackCode = addAbbr(item.item_code)
            if (fallbackCode && fallbackCode !== item.erp_item_code) {
              modified = true
              return { ...item, erp_item_code: fallbackCode }
            }
          }
          return item
        }

        const updatedItem = { ...item }
        if (itemData.item_name && itemData.item_name !== item.item_name) {
          updatedItem.item_name = itemData.item_name
        }
        if (itemData.item_group && itemData.item_group !== item.item_group) {
          updatedItem.item_group = itemData.item_group
        }
        if (itemData.brand && itemData.brand !== item.brand) {
          updatedItem.brand = itemData.brand
        }
        if (itemData.erp_item_code && itemData.erp_item_code !== item.erp_item_code) {
          updatedItem.erp_item_code = itemData.erp_item_code
        } else if (!updatedItem.erp_item_code) {
          updatedItem.erp_item_code = addAbbr(updatedItem.item_code)
        }
        if (itemData.existing_price !== undefined && itemData.existing_price !== null) {
          updatedItem.existing_price = itemData.existing_price
        } else if (updatedItem.existing_price === undefined) {
          updatedItem.existing_price = 0
        }

        if (
          updatedItem.item_name !== item.item_name ||
          updatedItem.item_group !== item.item_group ||
          updatedItem.brand !== item.brand ||
          updatedItem.existing_price !== item.existing_price ||
          updatedItem.erp_item_code !== item.erp_item_code
        ) {
          modified = true
          return updatedItem
        }

        return item
      })

      if (modified) {
        itemsRef.current = nextItems
        scheduleIframeSync(nextItems)
        return nextItems
      }

      return prevItems
    })
  }

  const scheduleBulkDetailsFetch = (codes, { pasteInSku = false } = {}) => {
    if (!Array.isArray(codes) || codes.length === 0) {
      return
    }

    const authFetch = fetchWithAuthRef.current
    if (!authFetch) {
      console.error('PurchasePriceListTemplate: fetchWithAuth no disponible para bulk-details')
      return
    }

    const filteredCodes = Array.from(new Set(codes.map(code => (code ?? '').toString().trim()).filter(code => code)))
    if (filteredCodes.length === 0) {
      return
    }

    bulkStartRef.current?.('Buscando SKUs y precios anteriores...')

    const requestToken = Date.now()
    bulkDetailsTokenRef.current = requestToken

    const shouldChunk = filteredCodes.length > LARGE_PASTE_THRESHOLD
    const chunkSize = shouldChunk ? BULK_DETAILS_CHUNK_SIZE : filteredCodes.length

    let totalFound = 0
    let totalNotFound = 0
    let encounteredError = false
    const aggregatedResults = []

    const runChunks = async () => {
      for (let start = 0; start < filteredCodes.length; start += chunkSize) {
        if (bulkDetailsTokenRef.current !== requestToken) {
          return
        }

        const chunk = filteredCodes.slice(start, start + chunkSize)
        const bulkPayload = {
          item_codes: chunk,
          company: activeCompanyRef.current,
          price_list: selectedPriceListRef.current || undefined
        }

        try {
          const response = await authFetch(`${API_ROUTES.inventory}/items/bulk-details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bulkPayload)
          })

          if (!response.ok) {
            encounteredError = true
            console.error('PurchasePriceListTemplate: bulk-details chunk status:', response.status)
            break
          }

          const bulkData = await response.json()
          if (bulkData.success && Array.isArray(bulkData.data)) {
            totalFound += bulkData.data.filter(d => d.found).length
            totalNotFound += bulkData.data.filter(d => !d.found).length
            aggregatedResults.push(...bulkData.data)
          } else {
            encounteredError = true
            console.error('PurchasePriceListTemplate: bulk-details chunk respuesta inválida')
            break
          }
        } catch (error) {
          encounteredError = true
          console.error('Error fetching bulk item details chunk:', error)
          break
        }

        if (shouldChunk && start + chunkSize < filteredCodes.length) {
          await sleep(BULK_DETAILS_YIELD_MS)
        }
      }
    }

    runChunks()
      .then(() => {
        if (bulkDetailsTokenRef.current !== requestToken) {
          return
        }
        if (encounteredError) {
          showNotificationRef.current?.('Error al procesar items', 'error')
        } else {
          applyBulkDetailResults(aggregatedResults)
          showNotificationRef.current?.(`Procesamiento completado. ${totalFound} items encontrados, ${totalNotFound} no encontrados.`, 'success')
        }
      })
      .catch(error => {
        if (bulkDetailsTokenRef.current !== requestToken) {
          return
        }
        console.error('PurchasePriceListTemplate: bulk-details processing error:', error)
        showNotificationRef.current?.('Error al procesar items', 'error')
      })
      .finally(() => {
        if (bulkDetailsTokenRef.current !== requestToken) {
          return
        }
        bulkEndRef.current?.()
      })
  }

  useEffect(() => {
    const handleMessage = (event) => {
      try {
        if (!event?.data || typeof event.data !== 'object') {
          return
        }

        if (event.data.type === 'ht-processing-start') {
          bulkStartRef.current?.('Procesando cambios en la tabla...')
          return
        }


if (event.data.type === 'ht-data-changed') {
  bulkStartRef.current?.('Procesando cambios en la tabla...')
  const incomingItems = event.data.items || event.data.data
  if (!Array.isArray(incomingItems) || incomingItems.length === 0) {
    bulkEndRef.current?.()
    return
  }
  const ambiguousSamples = []
  let suggestedSeparator = null

  const normalizeRowArray = (rowArray = []) => ({
    selected: rowArray[0] || false,
    item_code: rowArray[1] || '',
    item_name: rowArray[2] || '',
    item_group: rowArray[3] || '',
    brand: rowArray[4] || '',
    existing_price: rowArray[5] || '',
    new_price: rowArray[6] || ''
  })

  const rawItems = event.data.items
    ? incomingItems
    : incomingItems.map(row => normalizeRowArray(row))

  const rowIds = Array.isArray(event.data.rowIds) ? event.data.rowIds : null
  const existingItemsSnapshot = itemsRef.current || []
  const idToIndex = new Map(existingItemsSnapshot.map((item, idx) => [item.id, idx]))
  const updates = []
  const appendedItems = []
  let hasRealChanges = false
  let needsIframeSync = false

  const mapIncomingToItem = (incoming, existingItem = null, providedId = null) => {
    const rawCode = (incoming.item_code ?? existingItem?.item_code ?? '').toString().trim()
    const hasNewPriceInput = incoming.new_price !== undefined && incoming.new_price !== null && incoming.new_price !== ''
    if (hasNewPriceInput && decimalSeparatorRef.current === 'auto') {
      const detection = detectAmbiguousDecimalFormat(incoming.new_price)
      if (detection?.ambiguous) {
        ambiguousSamples.push(detection.sample)
        if (!suggestedSeparator && detection.suspected) {
          suggestedSeparator = detection.suspected
        }
      }
    }
    const normalizedPriceInput = normalizePriceInput(incoming.new_price, { decimalSeparator: decimalSeparatorRef.current })
    const previousPriceValue = Number.isFinite(existingItem?.price) ? existingItem.price : 0
    const parsedPrice = hasNewPriceInput ? parseFloat(normalizedPriceInput) : previousPriceValue
    const finalPrice = Number.isFinite(parsedPrice) ? parsedPrice : previousPriceValue
    const rawNewPrice = hasNewPriceInput
      ? (incoming.new_price ?? '').toString()
      : (existingItem?.raw_price_input || existingItem?.raw_new_price || '')
    const displayNewPrice = hasNewPriceInput
      ? (normalizedPriceInput || rawNewPrice)
      : (existingItem?.raw_new_price || '')
    if (displayNewPrice !== rawNewPrice) {
      needsIframeSync = true
    }

    const mergedErrors = { ...(existingItem?.errors || {}) }
    if (hasNewPriceInput && (finalPrice <= 0 || Number.isNaN(finalPrice))) {
      mergedErrors.price = 'Precio invalido'
    } else {
      delete mergedErrors.price
    }

    const parsedExistingInput =
      incoming.existing_price !== undefined && incoming.existing_price !== null && incoming.existing_price !== ''
        ? parseFloat(normalizePriceInput(incoming.existing_price, { decimalSeparator: decimalSeparatorRef.current }))
        : NaN

    const originalPrice =
      Number.isFinite(parsedExistingInput)
        ? parsedExistingInput
        : (Number.isFinite(existingItem?.original_price)
            ? existingItem.original_price
            : (Number.isFinite(existingItem?.existing_price)
                ? existingItem.existing_price
                : 0))

    const currentExistingPrice =
      Number.isFinite(parsedExistingInput)
        ? parsedExistingInput
        : (Number.isFinite(existingItem?.existing_price)
            ? existingItem.existing_price
            : originalPrice)

    const fallbackErpCode = addAbbr(rawCode)
    const resolvedId = existingItem?.id ?? providedId ?? generateRowId()

    const nextItem = {
      ...(existingItem || {}),
      id: resolvedId,
      item_code: rawCode,
      item_name: incoming.item_name || existingItem?.item_name || '',
      item_group: incoming.item_group || existingItem?.item_group || '',
      brand: incoming.brand || existingItem?.brand || '',
      price: finalPrice,
      original_price: originalPrice,
      existing_price: currentExistingPrice,
      erp_item_code: existingItem?.erp_item_code || incoming.erp_item_code || fallbackErpCode,
      item_price_name: existingItem?.item_price_name,
      errors: mergedErrors,
      raw_new_price: displayNewPrice,
      raw_price_input: rawNewPrice
    }

    const hasMeaningfulData = rawCode ||
      (incoming.item_name && incoming.item_name.toString().trim() !== '') ||
      hasNewPriceInput ||
      Number.isFinite(parsedExistingInput)

    if (!hasMeaningfulData && !existingItem) {
      return null
    }

    return nextItem
  }

  const didItemChange = (nextItem, prevItem = null) => {
    if (!prevItem) return true
    const comparableKeys = ['item_code', 'item_name', 'item_group', 'brand', 'price', 'existing_price', 'erp_item_code']
    return comparableKeys.some(key => {
      const prevValue = prevItem?.[key]
      const nextValue = nextItem?.[key]
      if (typeof prevValue === 'number' || typeof nextValue === 'number') {
        return Number(prevValue ?? 0) !== Number(nextValue ?? 0)
      }
      return (prevValue ?? '') !== (nextValue ?? '')
    })
  }

  rawItems.forEach((incomingRow, index) => {
    const targetId = rowIds && index < rowIds.length ? rowIds[index] : null
    let targetIndex = null
    let existingItem = null

    if (targetId !== null && targetId !== undefined && idToIndex.has(targetId)) {
      targetIndex = idToIndex.get(targetId)
      existingItem = existingItemsSnapshot[targetIndex]
    } else if (existingItemsSnapshot[index]) {
      targetIndex = index
      existingItem = existingItemsSnapshot[index]
    }

    const processedItem = mapIncomingToItem(incomingRow, existingItem, targetId)
    if (!processedItem) {
      return
    }

    if (didItemChange(processedItem, existingItem)) {
      hasRealChanges = true
    }

    if (targetIndex !== null && targetIndex !== undefined) {
      updates.push({ index: targetIndex, item: processedItem })
    } else {
      appendedItems.push(processedItem)
      hasRealChanges = true
    }
  })

  if (!hasRealChanges && appendedItems.length === 0) {
    bulkEndRef.current?.()
    return
  }

  let nextItems = existingItemsSnapshot.slice()
  updates.forEach(({ index, item }) => {
    nextItems[index] = item
  })
  if (appendedItems.length > 0) {
    nextItems = nextItems.concat(appendedItems)
  }

  const uniqueCodes = [...new Set(nextItems.map(item => item.item_code).filter(code => code))]
  const shouldFetchDetails = !!event.data.pasteInSku
  if (uniqueCodes.length > 0 && shouldFetchDetails) {
    showNotificationRef.current?.(`Procesando ${uniqueCodes.length} items...`, 'info')
    scheduleBulkDetailsFetch(uniqueCodes, { pasteInSku: event.data.pasteInSku })
  }

  let processedItems = nextItems
  try {
    const duplicateCodes = getDuplicateCodes(nextItems)
    if (duplicateCodes && duplicateCodes.length > 0) {
      const dupSet = new Set(duplicateCodes)
      const dupCount = nextItems.filter(it => it.item_code && dupSet.has(it.item_code)).length
      processedItems = nextItems.map(row => {
        const mergedErrors = { ...(row.errors || {}) }
        if (row.item_code && dupSet.has(row.item_code)) {
          mergedErrors.item_code = `Duplicado: codigo ${row.item_code}`
        } else if (mergedErrors.item_code && String(mergedErrors.item_code).startsWith('Duplicado: codigo')) {
          mergedErrors.item_code = null
        }
        return { ...row, errors: mergedErrors }
      })
      showNotificationRef.current?.(`Se detectaron ${dupCount} fila(s) con codigos duplicados.`, 'warning')
    }
  } catch (dupErr) {
    console.debug('Error detecting duplicate codes:', dupErr)
  }

  itemsRef.current = processedItems
  setItems(processedItems)
  if (needsIframeSync) {
    scheduleIframeSync(processedItems)
  }
  // No sincronizamos inmediatamente de vuelta al iframe para no perder filtros ni duplicar filas;
  // la tabla ya tiene los cambios originados en el iframe. Se sincroniza luego al aplicar bulk details.
  console.log('PurchasePriceListTemplate: ht-data-changed processing completed, items:', processedItems.length)
  console.log('PurchasePriceListTemplate: Final items provisional count:', _countSaveableItems(processedItems))
  if (decimalSeparatorRef.current === 'auto' && ambiguousSamples.length > 0) {
    decimalFormatRequestRef.current?.({
      samples: ambiguousSamples.slice(0, 6),
      suspected: suggestedSeparator
    })
  }
  // Cerrar loading cuando no se disparó un fetch de detalles (edición de precios/filtros sin pegar SKUs).
  if (!shouldFetchDetails || !uniqueCodes || uniqueCodes.length === 0) {
    bulkEndRef.current?.()
  }
        } else {
          const { type, ...msg } = event.data
          switch (type) {
            case 'ht-toggle-select-all':
              setSelectedRows(prev => toggleSelectAllSet(prev, visibleItemsRef.current || []))
              break
            case 'ht-rows-removed': {
              const idsToRemove = Array.isArray(msg.removedIds)
                ? msg.removedIds.filter(id => id !== null && id !== undefined)
                : []
              if (idsToRemove.length > 0) {
                setItems(prev => {
                  const next = prev.filter(item => !idsToRemove.includes(item.id))
                  itemsRef.current = next
                  return next
                })
                setSelectedRows(prev => {
                  const next = new Set(prev)
                  idsToRemove.forEach(id => next.delete(id))
                  return next
                })
              } else if (Array.isArray(msg.removedRows) && msg.removedRows.length > 0) {
                const rowsToRemove = new Set(msg.removedRows)
                setItems(prev => {
                  const next = prev.filter((_, idx) => !rowsToRemove.has(idx))
                  itemsRef.current = next
                  return next
                })
              }
              break
            }
            case 'ht-cell-changed':
              if (msg.colKey === 'selected') {
                const itemId = msg.rowId !== undefined ? msg.rowId : (msg.rowIndex + 1)
                setSelectedRows(prev => {
                  const next = new Set(prev)
                  if (msg.value) {
                    next.add(itemId)
                  } else {
                    next.delete(itemId)
                  }
                  return next
                })
              }
              break
            case 'ht-filter-applied':
              if (Array.isArray(msg.visibleRowIds)) {
                setVisibleRowIds(msg.visibleRowIds)
              } else {
                setVisibleRowIds(null)
              }
              break
            case 'ht-bulk-details-request':
              if (Array.isArray(msg.codes)) {
                scheduleBulkDetailsFetch(msg.codes, { pasteInSku: msg.pasteInSku })
              }
              break
            default:
              break
          }
        }
      } catch (err) {
        console.error('Error in iframe message handler:', err)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [setItems, setSelectedRows, setVisibleRowIds])

  useEffect(() => {
    const initializeTable = () => {
      try {
        if (iframeRef && iframeRef.current && iframeRef.current.contentWindow) {
          const columns = [
            { key: 'selected', label: 'Sel.', type: 'checkbox', width: 44, readonly: false },
            { key: 'item_code', label: 'SKU', readonly: false },
            { key: 'item_name', label: 'Nombre', readonly: true },
            { key: 'item_group', label: 'Categoría', readonly: true },
            { key: 'brand', label: 'Marca', readonly: true },
            { key: 'existing_price', label: 'Precio Actual', type: 'number', readonly: true },
            { key: 'new_price', label: 'Nuevo Precio', type: 'text', className: 'htRight' }
          ]

          const data = [
            [false, '', '', '', '', '', ''],
            [false, '', '', '', '', '', ''],
            [false, '', '', '', '', '', ''],
            [false, '', '', '', '', '', ''],
            [false, '', '', '', '', '', '']
          ]

          iframeRef.current.contentWindow.postMessage({
            type: 'ht-configure-table',
            columns,
            data
          }, '*')
        }
      } catch (e) {
        console.debug('Error initializing table', e)
      }
    }

    const timer = setTimeout(initializeTable, 1000)
    return () => clearTimeout(timer)
  }, [iframeRef])

  return {
    itemsRef,
    scheduleIframeSync,
    cancelInFlight
  }
}
