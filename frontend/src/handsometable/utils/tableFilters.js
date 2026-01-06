// Shared table filtering utilities (moved under handsometable for table-related helpers)
export const defaultSaveablePredicate = (item) => {
  const hasName = item.item_name && item.item_name.toString().trim() !== ''
  const hasPrice = (item.price !== undefined && item.price !== null) ? Number(item.price) > 0 : false
  const hasNoErrors = !item.errors?.price
  return hasName && hasPrice && hasNoErrors
}

export function countSaveableItems(list = [], { predicate = defaultSaveablePredicate } = {}) {
  if (!Array.isArray(list)) return 0
  return list.filter(predicate).length
}

// Compute visible items according to shared filter rules
// Supports special 'duplicates' handling when importMode === 'insert' (hides rows with existing-item errors)
export function computeVisibleItems(items = [], { activeFilter = 'none', selectedRows = new Set(), visibleRowIds = null, importMode = null } = {}) {
  let filtered = items || []

  if (activeFilter === 'selected') {
    filtered = filtered.filter(item => selectedRows.has(item.id))
  } else if (activeFilter === 'with-price') {
    filtered = filtered.filter(item => (item.price !== undefined && item.price !== null) && Number(item.price) > 0)
  } else if (activeFilter === 'without-price') {
    filtered = filtered.filter(item => !item.price || Number(item.price) <= 0)
  } else if (activeFilter === 'changed') {
    filtered = filtered.filter(item => {
      const originalPrice = item.original_price ?? item.existing_price ?? 0
      return Math.abs((Number(item.price) || 0) - Number(originalPrice)) > 0.01
    })
  } else if (activeFilter === 'duplicates') {
    // For generic tables, duplicates filtering may mean slightly different things.
    // Keep parity with ItemImport: when importMode === 'insert', hide rows that already exist (errors.item_code contains 'ya existe')
    if (importMode === 'insert') {
      filtered = filtered.filter(row => !(row.errors?.item_code && row.errors.item_code.includes('ya existe')))
    }
    // Otherwise, default behavior is no-op (could be extended per-table)
  }

  if (visibleRowIds !== null && Array.isArray(visibleRowIds)) {
    const visibleSet = new Set(visibleRowIds)
    filtered = filtered.filter(item => visibleSet.has(item.id))
  }

  return filtered
}

export function getSaveableCount({ items = [], visibleItems = [], visibleRowIds = null, predicate } = {}) {
  const itemsToCount = visibleRowIds !== null ? visibleItems : items
  return countSaveableItems(itemsToCount, { predicate })
}

export function buildFilterChangeAction(newFilter, { activeFilter, selectedRows, items, visibleItems } = {}) {
  if (newFilter === activeFilter) return { changed: false }

  if (newFilter === 'selected') {
    const selectionCount = selectedRows ? selectedRows.size : 0
    if (selectionCount === 0) {
      return {
        changed: true,
        newActiveFilter: 'none',
        notify: { message: 'Selecciona al menos una fila para mostrar solo los seleccionados', level: 'warning' },
        filteredCount: null,
        shouldSync: false
      }
    }
    return {
      changed: true,
      newActiveFilter: 'selected',
      notify: { message: `Mostrando ${selectionCount} item(s) seleccionados`, level: 'info' },
      filteredCount: selectionCount,
      shouldSync: true
    }
  }

  if (newFilter === 'with-price') {
    const withPriceCount = (items || []).filter(item => (item.price !== undefined && item.price !== null) && Number(item.price) > 0).length
    return {
      changed: true,
      newActiveFilter: 'with-price',
      notify: { message: `Mostrando ${withPriceCount} item(s) con precio`, level: 'info' },
      filteredCount: withPriceCount,
      shouldSync: true
    }
  }

  if (newFilter === 'without-price') {
    const withoutPriceCount = (items || []).filter(item => !item.price || Number(item.price) <= 0).length
    return {
      changed: true,
      newActiveFilter: 'without-price',
      notify: { message: `Mostrando ${withoutPriceCount} item(s) sin precio`, level: 'info' },
      filteredCount: withoutPriceCount,
      shouldSync: true
    }
  }

  if (newFilter === 'changed') {
    const changedCount = (items || []).filter(item => {
      const originalPrice = item.original_price ?? item.existing_price ?? 0
      return Math.abs((Number(item.price) || 0) - Number(originalPrice)) > 0.01
    }).length
    return {
      changed: true,
      newActiveFilter: 'changed',
      notify: { message: `Mostrando ${changedCount} item(s) modificados`, level: 'info' },
      filteredCount: changedCount,
      shouldSync: true
    }
  }

  if (newFilter === 'duplicates') {
    // For duplicates, we cannot compute a generic count without table-specific rules.
    // Return change=true and let the caller decide whether to sync and what message to display.
    return {
      changed: true,
      newActiveFilter: 'duplicates',
      notify: null,
      filteredCount: null,
      shouldSync: true
    }
  }

  // None or fallback
  return {
    changed: activeFilter !== 'none',
    newActiveFilter: 'none',
    notify: activeFilter !== 'none' ? { message: 'Mostrando todos los items', level: 'info' } : null,
    filteredCount: null,
    shouldSync: false
  }
}

export function toggleSelectAllSet(prevSet = new Set(), visibleItems = []) {
  const next = new Set(prevSet)
  const visibleIds = visibleItems.map(item => item.id)
  if (visibleIds.length === 0) return next
  const allSelected = visibleIds.every(id => next.has(id))
  if (allSelected) {
    visibleIds.forEach(id => next.delete(id))
  } else {
    visibleIds.forEach(id => next.add(id))
  }
  return next
}

export function resetSelectionState(setSelectedRows, setSelectAll, setActiveFilter, setFilteredRowCount) {
  if (typeof setSelectedRows === 'function') setSelectedRows(new Set())
  if (typeof setSelectAll === 'function') setSelectAll(false)
  if (typeof setActiveFilter === 'function') setActiveFilter('none')
  if (typeof setFilteredRowCount === 'function') setFilteredRowCount(null)
}

// Count rows that have an 'existing item' error (ItemImport convention: errors.item_code includes 'ya existe')
export function countExistingItemErrors(items = []) {
  if (!Array.isArray(items)) return 0
  return items.filter(row => row.item_code && row.errors?.item_code && row.errors.item_code.includes('ya existe')).length
}

// Count how many of the provided rows are selected according to a Set of selected row IDs
export function countVisibleSelected(rows = [], selectedRows = new Set()) {
  if (!Array.isArray(rows)) return 0
  if (!(selectedRows instanceof Set)) return 0
  return rows.filter(row => selectedRows.has(row.id)).length
}

