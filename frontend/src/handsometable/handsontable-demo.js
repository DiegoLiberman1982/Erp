import Handsontable from "handsontable";
// importar CSS base de Handsontable
import "handsontable/styles/handsontable.min.css";
// importar el tema Horizon (asegura apariencia igual que el demo)
import "handsontable/styles/ht-theme-horizon.min.css";
import "@handsontable/pikaday/css/pikaday.css";

import { generateExampleData, isArabicDemoEnabled } from "./handsontable-utils.js";
import "./handsontable-styles.css";
import { registerLanguageDictionary, arAR, esMX } from "handsontable/i18n";
import { attachClampRenderer } from "./handsontable-renderers.js";

// choose cell types you want to use and import them
import {
  registerCellType,
  CheckboxCellType,
  DateCellType,
  DropdownCellType,
  NumericCellType,
} from "handsontable/cellTypes";

// Global flags to silence change events during clears/loads; start silenced until first configure
window.htSuppressChanges = true;
window.htClearingData = true;

import {
  registerPlugin,
  AutoColumnSize,
  ContextMenu,
  CopyPaste,
  DropdownMenu,
  Filters,
  HiddenColumns,
  HiddenRows,
  ManualRowMove,
  MultiColumnSorting,
  UndoRedo,
} from 'handsontable/plugins';

// register imported cell types and plugins
registerPlugin(AutoColumnSize);
registerPlugin(ContextMenu);
registerPlugin(CopyPaste);
registerPlugin(DropdownMenu);
registerPlugin(Filters);
registerPlugin(HiddenColumns);
registerPlugin(HiddenRows);
registerPlugin(ManualRowMove);
registerPlugin(MultiColumnSorting);
registerPlugin(UndoRedo);

// register imported cell types and plugins
registerCellType(DateCellType);
registerCellType(DropdownCellType);
registerCellType(CheckboxCellType);
registerCellType(NumericCellType);

registerLanguageDictionary(arAR);
registerLanguageDictionary(esMX);

import { addClassesToRows } from "./handsontable-hooks.js";

const example = document.getElementById("example");

// Auth alert/block flags (declared early so helpers can use them)
let _ht_auth_alert_shown = false;
let _ht_auth_blocked = false;

// Load full items list once and perform local matching
let _ht_items_list = null; // cached array of items
window.currentColumns = null; // for dynamic table configuration
window.currentRowIds = null;
let _lastTempTooltip = null;

const resolveColumnType = (type) => {
  if (!type) return 'text';
  const normalized = type.toString().toLowerCase();
  if (normalized === 'checkbox') return 'checkbox';
  if (normalized === 'number' || normalized === 'numeric') return 'numeric';
  if (normalized === 'select' || normalized === 'dropdown') return 'dropdown';
  return 'text';
};
async function ensureItemsList() {
  if (_ht_items_list) return _ht_items_list;
  if (_ht_auth_blocked) return [];

  // If inside iframe, ask parent for the single list
  if (window.parent && window.parent !== window) {
    const id = `ht_items_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
    return new Promise((resolve) => {
      const onMessage = (ev) => {
        try {
          const msg = ev.data || {};
          if (msg && msg.type === 'ht-items-list-result' && msg.id === id) {
            window.removeEventListener('message', onMessage);
            if (msg.success && Array.isArray(msg.data)) {
              _ht_items_list = msg.data;
              resolve(_ht_items_list);
            } else {
              resolve([]);
            }
          }
          if (msg.type === 'ht-clear-focus') {
            try {
              // clear selection
              try { hot.deselectCell(); } catch (e) {}
              // remove tooltip if any
              try { if (_lastTempTooltip && _lastTempTooltip.parentNode) _lastTempTooltip.remove(); _lastTempTooltip = null } catch (e) {}
            } catch (e) { console.debug('ht-clear-focus error', e) }
          }
        } catch (e) { resolve([]); }
      };
      window.addEventListener('message', onMessage);
      window.parent.postMessage({ type: 'ht-get-items-list', id }, '*');
      setTimeout(() => { try { window.removeEventListener('message', onMessage); } catch (e) {} ; resolve([]); }, 10000);
    });
  }

  // Standalone fallback: direct fetch full list
  try {
    const res = await fetch(`/api/inventory/items`, { credentials: 'include' });
    if (res.status === 401) {
      _ht_auth_blocked = true;
      showAuthNeededAlert();
      return [];
    }
    if (!res.ok) return [];
    const body = await res.json();
    if (body && body.success && Array.isArray(body.data)) {
      _ht_items_list = body.data;
      return _ht_items_list;
    }
    return [];
  } catch (err) {
    console.error('ensureItemsList error', err);
    return [];
  }
}

// No remote search: matching will be done locally against the cached items list

function showAuthNeededAlert() {
  if (_ht_auth_alert_shown) return;
  _ht_auth_alert_shown = true;
  try {
    const a = document.createElement('div');
    a.style.position = 'fixed';
    a.style.right = '16px';
    a.style.top = '16px';
    a.style.zIndex = 99999;
    a.style.background = '#fff3cd';
    a.style.border = '1px solid #ffeeba';
    a.style.color = '#856404';
    a.style.padding = '10px 14px';
    a.style.borderRadius = '6px';
    a.style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)';
    a.innerText = 'Sesión no autenticada: inicia sesión en la aplicación para que la búsqueda de SKUs funcione.';
    document.body.appendChild(a);
    setTimeout(() => { try { a.remove(); } catch (e) {} }, 8000);
  } catch (e) {
    // ignore DOM errors
  }
}

// show a small temporary tooltip near a cell (TD element)
function showTempTooltip(tdElement, text) {
  try {
    const rect = tdElement.getBoundingClientRect()
    const tip = document.createElement('div')
    tip.className = 'ht-temp-tooltip'
    tip.innerText = text
    tip.style.position = 'fixed'
    tip.style.left = `${rect.left + window.scrollX}px`
    tip.style.top = `${rect.top + window.scrollY - 36}px`
    tip.style.zIndex = 999999
    document.body.appendChild(tip)
    // clear previous tooltip if any
    try { if (_lastTempTooltip && _lastTempTooltip.parentNode) _lastTempTooltip.remove() } catch (e) {}
    _lastTempTooltip = tip
    setTimeout(() => { try { if (tip.parentNode && _lastTempTooltip === tip) _lastTempTooltip.remove() } catch (e) {} }, 4000)
  } catch (e) { console.debug('showTempTooltip error', e) }
}

// Función para remover caracteres invisibles y contarlos
function cleanInvisibleChars(value) {
  if (value === null || value === undefined) return { cleaned: value, removedCount: 0 };

  const original = String(value);
  let cleaned = original;

  // Contador de caracteres removidos
  let removedCount = 0;

  // 1. Remover espacios al inicio y final
  const trimmed = cleaned.trim();
  if (trimmed !== cleaned) {
    removedCount += (cleaned.length - trimmed.length);
    cleaned = trimmed;
  }

  // 2. Remover caracteres de control comunes (\t, \n, \r, etc.)
  const withoutControlChars = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  if (withoutControlChars !== cleaned) {
    removedCount += (cleaned.length - withoutControlChars.length);
    cleaned = withoutControlChars;
  }

  // 3. Remover comillas emparejadas al inicio y final (común al copiar desde CSV/Excel)
  //     * IMPORTANT: do not remove single/trailing quotes (e.g. inches symbol: 27,5")
  //     * Only strip quotes when both start and end are quotes and they match ("text" or 'text')
  if (cleaned.length > 1) {
    const first = cleaned.charAt(0);
    const last = cleaned.charAt(cleaned.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      // remove only the first and last character
      const withoutPairedQuotes = cleaned.slice(1, cleaned.length - 1);
      removedCount += (cleaned.length - withoutPairedQuotes.length);
      cleaned = withoutPairedQuotes;
    }
  }

  // 4. Remover otros caracteres invisibles Unicode comunes
  const withoutInvisibleUnicode = cleaned.replace(/[\u200B-\u200F\u2028-\u202F\u205F-\u206F]/g, '');
  if (withoutInvisibleUnicode !== cleaned) {
    removedCount += (cleaned.length - withoutInvisibleUnicode.length);
    cleaned = withoutInvisibleUnicode;
  }

  return { cleaned, removedCount };
}

// Función para mostrar notificación de caracteres invisibles removidos
function showInvisibleCharsNotification(count, cellElement) {
  if (count > 0) {
    const message = count === 1 ? '1 carácter invisible removido' : `${count} caracteres invisibles removidos`;
    showTempTooltip(cellElement, message);
  }
}

// Minimal chooser modal for multiple matches
function ensureChooserModal() {
  let modal = document.getElementById('ht-sku-chooser');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'ht-sku-chooser';
  modal.style.position = 'fixed';
  modal.style.left = '50%';
  modal.style.top = '50%';
  modal.style.transform = 'translate(-50%,-50%)';
  modal.style.zIndex = 9999;
  modal.style.minWidth = '320px';
  modal.style.maxWidth = '90vw';
  modal.style.maxHeight = '60vh';
  modal.style.overflow = 'auto';
  modal.style.background = 'white';
  modal.style.border = '1px solid #ddd';
  modal.style.boxShadow = '0 6px 24px rgba(0,0,0,0.15)';
  modal.style.padding = '8px';
  modal.style.borderRadius = '6px';

  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.style.marginBottom = '8px';
  title.innerText = 'Seleccionar ítem';
  modal.appendChild(title);

  const list = document.createElement('div');
  list.id = 'ht-sku-chooser-list';
  modal.appendChild(list);

  const close = document.createElement('button');
  close.innerText = 'Cerrar';
  close.style.marginTop = '8px';
  close.onclick = () => modal.remove();
  modal.appendChild(close);

  document.body.appendChild(modal);
  return modal;
}

function showChooser(matches, onPick) {
  const modal = ensureChooserModal();
  const list = modal.querySelector('#ht-sku-chooser-list');
  list.innerHTML = '';
  if (!matches || matches.length === 0) {
    const empty = document.createElement('div');
    empty.innerText = 'No se encontraron resultados.';
    list.appendChild(empty);
  }

  matches.forEach(m => {
    const row = document.createElement('div');
    row.style.padding = '6px 8px';
    row.style.borderBottom = '1px solid #f0f0f0';
    row.style.cursor = 'pointer';
    row.onmouseenter = () => row.style.background = '#f7f7f7';
    row.onmouseleave = () => row.style.background = 'transparent';

    const code = document.createElement('div');
    code.style.fontWeight = '600';
    code.innerText = m.item_code || m.name || '';
    row.appendChild(code);

    const name = document.createElement('div');
    name.style.fontSize = '12px';
    name.style.color = '#333';
    name.innerText = m.item_name || '';
    row.appendChild(name);

    const price = document.createElement('div');
    price.style.fontSize = '12px';
    price.style.color = '#666';
    price.innerText = 'Precio: ' + ((m.standard_rate !== undefined && m.standard_rate !== null) ? m.standard_rate : (m.valuation_rate !== undefined && m.valuation_rate !== null ? m.valuation_rate : '-'));
    row.appendChild(price);

    row.onclick = () => {
      try { modal.remove(); } catch (e) {}
      onPick(m);
    };

    list.appendChild(row);
  });
}

const hot = new Handsontable(example, {
  data: Array(20).fill().map(() => ['', '', '', '', '', '', '']), // 20 filas vacías con 7 columnas
  layoutDirection: isArabicDemoEnabled() ? "rtl" : "ltr",
  language: isArabicDemoEnabled() ? arAR.languageCode : esMX.languageCode,
  themeName: 'ht-theme-horizon',
  width: '100%',
  height: '100%',
  stretchH: 'all',
  colWidths: [120, 200, 120, 120, 120, 120, 120],
  colHeaders: [
    "SKU",
    "Nombre",
    "Categoría",
    "Marca",
    "Precio Actual",
    "Precio Compra",
    "Nuevo Precio"
  ],
  columns: [
    attachClampRenderer({ data: 0, type: "text" }),
    attachClampRenderer({ data: 1, type: "text", readOnly: true }), // Nombre - no editable
    attachClampRenderer({ data: 2, type: "text", readOnly: true }), // Categoría - no editable
    attachClampRenderer({ data: 3, type: "text", readOnly: true }), // Marca - no editable
    {
      data: 4,
      type: "numeric",
      readOnly: true,
      numericFormat: { pattern: '0.00' },
      className: 'htRight'
    }, // Precio Actual - no editable, alineado a la derecha, 2 decimales
    {
      data: 5,
      type: "numeric",
      readOnly: true,
      numericFormat: { pattern: '0.00' },
      className: 'htRight'
    }, // Precio Compra - no editable, muestra precio de compra (convertido si aplica)
    {
      data: 6,
      type: "text",
      className: 'htRight'
    } // Nuevo Precio - texto para conservar formato original y alineado a la derecha
  ],
  // When the user types/pastes an SKU in column 0, fetch item details and populate Nombre and Precio existente
  afterChange: async function (changes, source) {
    if (!changes || source === 'loadData' || window.htSuppressChanges || window.htClearingData) return;

    // Procesar limpieza de caracteres invisibles para todos los cambios
    let totalInvisibleCharsRemoved = 0;
    const cellsWithInvisibleChars = [];

    for (const change of changes) {
      const [row, prop, oldValue, newValue] = change;

      // Solo procesar si hay un nuevo valor y es diferente al anterior
      if (newValue !== null && newValue !== undefined && String(newValue) !== String(oldValue)) {
        const { cleaned, removedCount } = cleanInvisibleChars(newValue);

        if (removedCount > 0) {
          // Aplicar el valor limpiado a la celda
          hot.setDataAtCell(row, prop, cleaned, 'cleanInvisibleChars');

          // Acumular estadísticas
          totalInvisibleCharsRemoved += removedCount;

          // Guardar referencia a la celda para mostrar notificación
          try {
            const cellElement = hot.getCell(row, prop);
            if (cellElement) {
              cellsWithInvisibleChars.push({ element: cellElement, count: removedCount });
            }
          } catch (e) {
            // Ignorar errores al obtener el elemento de la celda
          }
        }
      }
    }

    // Mostrar notificación si se removieron caracteres invisibles
    if (totalInvisibleCharsRemoved > 0) {
      // Mostrar notificación en la primera celda afectada
      if (cellsWithInvisibleChars.length > 0) {
        const firstCell = cellsWithInvisibleChars[0];
        showInvisibleCharsNotification(totalInvisibleCharsRemoved, firstCell.element);
      }
    }

    // Send ht-cell-changed for manual edits in checkbox (column 0) and Nuevo Precio column (index 6)
    // But skip if this is part of a batch formula application
    let isBatchFormulaUpdate = false
    for (const change of changes) {
      const [row, prop, oldValue, newValue] = change
      if (prop === 6 && source === 'formula-application') {
        isBatchFormulaUpdate = true
        break
      }
    }
    
    if (!isBatchFormulaUpdate) {
      for (const change of changes) {
        const [row, prop, oldValue, newValue] = change;
        
        // Get rowId for this row
        const rowId = Array.isArray(window.currentRowIds) && window.currentRowIds[row] !== undefined 
          ? window.currentRowIds[row] 
          : row + 1;
        
        // Handle checkbox selection (column 0)
        if (prop === 0 || prop === '0') {
          const colKey = window.currentColumns && window.currentColumns[0] ? window.currentColumns[0].key : 'selected';
          console.log('IFRAME: ht-cell-changed (checkbox) sending value:', newValue, 'for row', row, 'rowId:', rowId);
          window.parent.postMessage({
            type: 'ht-cell-changed',
            rowIndex: row,
            rowId: rowId,
            colKey: colKey,
            value: newValue
          }, '*');
        }
        
        // Handle price changes (column 6) - only for manual edits, not formula applications
        if (prop === 6 || prop === '6') {
          console.log('IFRAME: ht-cell-changed sending value:', newValue, 'for row', row, 'prop', prop, 'oldValue:', oldValue);
          const colKey = window.currentColumns && window.currentColumns[6] ? window.currentColumns[6].key : 'valor';
          window.parent.postMessage({
            type: 'ht-cell-changed',
            rowIndex: row,
            rowId: rowId,
            colKey: colKey,
            value: newValue
          }, '*');
        }
      }
    }

    if (!window.htClearingData && !window.htSuppressChanges) {
      try {
        window.parent.postMessage({ type: 'ht-processing-start' }, '*');
      } catch (err) {
        // ignore
      }
    }

    console.log('🔍 IFRAME: Procesando cambios:', changes.map(c => ({ row: c[0], prop: c[1], oldVal: c[2], newVal: c[3] })))

    const emitTableSnapshot = (pasteInSkuFlag) => {
      try {
        if (!window.currentColumns) {
          return;
        }

        const newDataArray = hot.getData();

        // Preserve intermediate blanks by only trimming trailing empty rows
        let lastNonEmptyIndex = -1;
        for (let i = newDataArray.length - 1; i >= 0; i--) {
          const rowArr = newDataArray[i] || [];
          const isEmpty = rowArr.every(c => c === null || c === undefined || String(c).trim() === '');
          if (!isEmpty) {
            lastNonEmptyIndex = i;
            break;
          }
        }

        const payloadData = [];
        const payloadRowIds = [];
        const limit = lastNonEmptyIndex === -1 ? 0 : lastNonEmptyIndex + 1;
        for (let i = 0; i < limit; i++) {
          const rowArr = newDataArray[i] || [];
          payloadData.push(rowArr);
          if (Array.isArray(window.currentRowIds) && window.currentRowIds[i] !== undefined) {
            payloadRowIds.push(window.currentRowIds[i]);
          } else {
            payloadRowIds.push(null);
          }
        }

        if (!window.htClearingData && !window.htSuppressChanges) {
          console.log(`IFRAME: emitting ht-data-changed with ${payloadData.length} rows, pasteInSku=${!!pasteInSkuFlag}`)
          console.log(`IFRAME: rowIds being sent:`, payloadRowIds)
          console.log(`IFRAME: window.currentRowIds:`, window.currentRowIds)
          window.parent.postMessage({
            type: 'ht-data-changed',
            data: payloadData,
            rowIds: payloadRowIds.length > 0 ? payloadRowIds : null,
            rowHighlights: (Array.isArray(window.currentRowHighlights) && window.currentRowHighlights.length > 0)
              ? payloadRowIds.map((rId, i) => {
                  if (Array.isArray(window.currentRowIds)) {
                    const origIdx = window.currentRowIds.indexOf(rId);
                    if (origIdx !== -1 && Array.isArray(window.currentRowHighlights)) return window.currentRowHighlights[origIdx] || null;
                  }
                  return window.currentRowHighlights && window.currentRowHighlights[i] ? window.currentRowHighlights[i] : null
                }) : null,
            pasteInSku: !!pasteInSkuFlag
          }, '*');
        }

        if (pasteInSkuFlag) {
          console.log('🔍 IFRAME: Enviando payloadData[0]:', payloadData[0], 'selected value:', payloadData[0] ? payloadData[0][0] : 'N/A');
        }
        // Log summary for debug
        if (payloadData.length > 0) {
          try {
            const firstRow = payloadData[0]
            console.log(`IFRAME: payload sample columns (${firstRow.length}):`, firstRow.slice(0, 6))
          } catch (e) { /* ignore */ }
        }
      } catch (error) {
        console.debug('emitTableSnapshot error', error);
      }
    }
    
    // Check if there are SKU changes (find item_code column dynamically)
    let itemCodeColIndex = -1;
    if (window.currentColumns) {
      itemCodeColIndex = window.currentColumns.findIndex(col => col.key === 'item_code');
    }
    
    const skuChanges = changes.filter(change => {
      const [row, prop] = change;
      return prop === itemCodeColIndex;
    });

    console.log('🔍 IFRAME: itemCodeColIndex:', itemCodeColIndex, 'skuChanges:', skuChanges.length)

    if (skuChanges.length === 0 || itemCodeColIndex === -1) {
      // Nada que resolver de SKUs, pero igualmente enviar snapshot para reflejar ediciones (fórmulas, precios, etc.)
      emitTableSnapshot(false);
      return;
    }

    if (skuChanges.length > 0 && itemCodeColIndex !== -1) {
      // Find column indices dynamically
      const itemNameColIndex = window.currentColumns ? window.currentColumns.findIndex(col => col.key === 'item_name') : 1;
      const itemGroupColIndex = window.currentColumns ? window.currentColumns.findIndex(col => col.key === 'item_group') : 2;
      const brandColIndex = window.currentColumns ? window.currentColumns.findIndex(col => col.key === 'brand') : 3;
      const valuationRateColIndex = window.currentColumns ? window.currentColumns.findIndex(col => col.key === 'valuation_rate') : 4;
      
      // Process SKUs: build map and lookup items
      const skuMap = {}; // sku -> [row,...]

      const rowsToClear = [];
      for (const change of skuChanges) {
        const [row, prop, oldValue, newValue] = change;
        const sku = String(newValue || '').trim();
        if (!sku) {
          rowsToClear.push(row);
          continue;
        }
        skuMap[sku] = skuMap[sku] || [];
        skuMap[sku].push(row);
      }

      console.log('IFRAME: Processing SKUs:', Object.keys(skuMap));
      // debug how many items we have available for matching
      try {
        const items = await ensureItemsList()
        console.log(`IFRAME: ensureItemsList returned ${Array.isArray(items) ? items.length : 0} items`)
      } catch (e) {
        console.debug('IFRAME: ensureItemsList failed for debug', e)
      }

      // Ensure we have the full items list and perform local matching only
      const itemsList = await ensureItemsList();
      const mapByDisplayCode = {};
      // Create a mapping: exact item_code -> item (no simplified versions)
      for (const it of itemsList || []) {
        const code = it.item_code || it.name || '';
        // Only map exact codes, no simplified versions
        mapByDisplayCode[code] = it;
      }

      const isPasteEvent = source && String(source).toLowerCase().includes('paste')
      if (isPasteEvent) console.log('IFRAME: Detected paste source - suppressing local fills for SKUs and deferring to parent')

      hot.batch(() => {
        console.log('IFRAME: Applying hot.setDataAtCell updates for SKUs:', Object.keys(skuMap), 'isPasteEvent=', isPasteEvent)
        rowsToClear.forEach(row => {
          if (itemNameColIndex !== -1) hot.setDataAtCell(row, itemNameColIndex, '', 'loadData');
          if (itemGroupColIndex !== -1) hot.setDataAtCell(row, itemGroupColIndex, '', 'loadData');
          if (brandColIndex !== -1) hot.setDataAtCell(row, brandColIndex, '', 'loadData');
          if (valuationRateColIndex !== -1) hot.setDataAtCell(row, valuationRateColIndex, '', 'loadData');
        });

        for (const sku of Object.keys(skuMap)) {
          const it = mapByDisplayCode[sku];
          if (!it) {
            skuMap[sku].forEach(r => {
              if (itemNameColIndex !== -1) hot.setDataAtCell(r, itemNameColIndex, '', 'loadData');
              if (itemGroupColIndex !== -1) hot.setDataAtCell(r, itemGroupColIndex, '', 'loadData');
              if (brandColIndex !== -1) hot.setDataAtCell(r, brandColIndex, '', 'loadData');
              if (valuationRateColIndex !== -1) hot.setDataAtCell(r, valuationRateColIndex, '', 'loadData');
            });
            continue;
          }
          const name = it.item_name || it.item_name || it.name || '';
          const categoria = it.item_group || '';
          const marca = it.brand || '';
          const price = (it.standard_rate !== undefined && it.standard_rate !== null)
            ? it.standard_rate
            : (it.valuation_rate !== undefined && it.valuation_rate !== null ? it.valuation_rate : '');
          if (!isPasteEvent) {
            skuMap[sku].forEach(r => {
              if (itemNameColIndex !== -1) hot.setDataAtCell(r, itemNameColIndex, name, 'loadData');
              if (itemGroupColIndex !== -1) hot.setDataAtCell(r, itemGroupColIndex, categoria, 'loadData');
              if (brandColIndex !== -1) hot.setDataAtCell(r, brandColIndex, marca, 'loadData');
              if (valuationRateColIndex !== -1) hot.setDataAtCell(r, valuationRateColIndex, price, 'loadData');
              // leave purchase price empty for now; it may be filled by ht-load-items messages
            });
          } else {
            console.log('IFRAME: paste detected - skipping hot.setDataAtCell for SKU', sku)
          }
        }
      });

      console.log('IFRAME: After processing SKUs, row 0 data:', hot.getDataAtRow(0));
      // Provide a short sample of updated rows for debug
      try {
        const sample = Object.keys(skuMap).slice(0, 5).map(sku => ({ sku, rows: skuMap[sku] }))
        console.log('IFRAME: SKU->rows sample after updates:', sample)
      } catch (e) { /* ignore */ }

      // Send updated table data to parent after processing
      setTimeout(() => emitTableSnapshot(true), 0);
    } else {
      // No SKU changes, send current table data if configured
      console.log('🔍 IFRAME: No SKU changes, sending ht-data-changed')
      if (window.currentColumns) {
        setTimeout(() => emitTableSnapshot(false), 0);
      }
    }
  },
  dropdownMenu: true,
  hiddenColumns: {
    indicators: true
  },
  contextMenu: true,
  multiColumnSorting: true,
  filters: true,
  afterFilter: function() {
    // When filters change, send info about which rows are visible
    try {
      // Get all current row IDs and check which ones are visible
      const filtersPlugin = hot.getPlugin('filters');
      const totalRows = hot.countRows();
      const visibleRowIds = [];
      
      if (window.currentColumns && Array.isArray(window.currentRowIds)) {
        // Collect visible row IDs by checking each physical row
        for (let physicalRow = 0; physicalRow < totalRows; physicalRow++) {
          // Check if row is hidden by filters
          const isHidden = filtersPlugin && filtersPlugin.isRowHidden(physicalRow);
          if (!isHidden && window.currentRowIds[physicalRow] !== undefined) {
            const rowArr = hot.getDataAtRow(physicalRow) || [];
            const isEmpty = rowArr.every(c => c === null || c === undefined || String(c).trim() === '');
            if (!isEmpty) {
              visibleRowIds.push(window.currentRowIds[physicalRow]);
            }
          }
        }
        
        console.log('FILTER: afterFilter - visible row IDs:', visibleRowIds.length, 'of', window.currentRowIds.length);
        
        // Send message with visible row IDs
        window.parent.postMessage({
          type: 'ht-filter-applied',
          visibleRowIds: visibleRowIds,
          totalRowCount: window.currentRowIds.length
        }, '*');
      } else {
        // Fallback: send only counts when not in dynamic mode
        let visible = 0;
        const data = hot.getData();
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const isEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
          if (!isEmpty) visible++;
        }
        window.parent.postMessage({ type: 'ht-filters-changed', filteredRowCount: visible, totalRowCount: totalRows }, '*');
      }
    } catch (e) {
      console.debug('afterFilter error', e);
    }
  },
  rowHeaders: true,
  manualRowMove: true,
  navigableHeaders: true,
  autoWrapCol: true,
  headerClassName: 'htLeft',
  undoRedo: true,
  beforeRenderer: addClassesToRows,
  // Detectar valores ambiguos ANTES de que Handsontable los parsee
  beforePaste: function(data, coords) {
    try {
      // Función para detectar formato decimal ambiguo
      // Un valor como "22.000" o "7,500" es ambiguo porque podría ser:
      // - 22000 (miles con separador de miles) o 22.0 (decimal)
      // - 7500 (miles con separador de miles) o 7.5 (decimal)
      const detectAmbiguous = (value) => {
        if (value === undefined || value === null) return null
        const raw = String(value).trim()
        if (!raw) return null
        const cleaned = raw.replace(/[^0-9.,-]/g, '')
        if (!cleaned) return null
        
        const hasDot = cleaned.includes('.')
        const hasComma = cleaned.includes(',')
        if (!hasDot && !hasComma) return null
        
        // Si tiene ambos, el último es el decimal (no ambiguo)
        if (hasDot && hasComma) return null
        
        const separatorChar = hasDot ? '.' : ','
        const fragments = cleaned.split(separatorChar)
        const decimals = fragments.length > 1 ? fragments[fragments.length - 1] : ''
        
        // Es ambiguo si:
        // - decimals.length === 0 (termina en separador, ej: "100.")
        // - decimals.length === 3 y son todos dígitos (podría ser separador de miles)
        const isAmbiguous = decimals.length === 0 || (decimals.length === 3 && /^\d{3}$/.test(decimals))
        
        if (!isAmbiguous) return null
        
        return {
          ambiguous: true,
          suspected: separatorChar === '.' ? 'comma' : 'dot',
          sample: raw
        }
      }
      
      const ambiguousSamples = []
      let suggestedSeparator = null
      
      // Log todos los datos que se van a pegar para debug
      console.log('IFRAME: beforePaste received data with', data.length, 'rows')
      if (data.length > 0 && data[0]) {
        console.log('IFRAME: beforePaste first row sample:', data[0].slice(0, 5))
      }
      
      // Revisar todos los datos que se van a pegar
      data.forEach((row, rowIdx) => {
        row.forEach((cellValue, colIdx) => {
          if (cellValue !== undefined && cellValue !== null && cellValue !== '') {
            const detection = detectAmbiguous(cellValue)
            if (detection?.ambiguous) {
              console.log('IFRAME: beforePaste found ambiguous at row', rowIdx, 'col', colIdx, ':', cellValue)
              ambiguousSamples.push(detection.sample)
              if (!suggestedSeparator && detection.suspected) {
                suggestedSeparator = detection.suspected
              }
            }
          }
        })
      })
      
      // Si hay valores ambiguos, notificar al padre ANTES de que se procesen
      if (ambiguousSamples.length > 0) {
        console.log('IFRAME: beforePaste detected ambiguous values:', ambiguousSamples.slice(0, 10))
        console.log('IFRAME: beforePaste suggested separator:', suggestedSeparator)
        try {
          window.parent.postMessage({
            type: 'ht-decimal-format-detected',
            samples: ambiguousSamples.slice(0, 6),
            suspected: suggestedSeparator,
            timestamp: Date.now()
          }, '*')
          console.log('IFRAME: ht-decimal-format-detected message sent successfully')
        } catch (postErr) {
          console.error('IFRAME: Failed to post decimal-format-detected message:', postErr)
        }
      } else {
        console.log('IFRAME: beforePaste - no ambiguous values detected in', data.length, 'rows')
      }
    } catch (e) {
      console.error('IFRAME: beforePaste ambiguous detection error:', e)
    }
    // No cancelar el paste, solo detectar
  },
  afterRemoveRow: function (index, amount, physicalRows, source) {
    console.log('??? IFRAME: afterRemoveRow disparado, index:', index, 'amount:', amount, 'source:', source)
    try {
      const removedRowIndexes = Array.isArray(physicalRows) && physicalRows.length > 0
        ? physicalRows
        : Array.from({ length: amount }, (_, i) => index + i)

      const removedIds = []
      if (Array.isArray(window.currentRowIds)) {
        removedRowIndexes.forEach(rowIdx => {
          if (rowIdx >= 0 && rowIdx < window.currentRowIds.length) {
            removedIds.push(window.currentRowIds[rowIdx])
          } else {
            removedIds.push(null)
          }
        })
        const sorted = [...removedRowIndexes].sort((a, b) => b - a)
        sorted.forEach(rowIdx => {
          if (rowIdx >= 0 && rowIdx < window.currentRowIds.length) {
            window.currentRowIds.splice(rowIdx, 1)
          }
          if (Array.isArray(window.currentRowHighlights) && rowIdx >= 0 && rowIdx < window.currentRowHighlights.length) {
            window.currentRowHighlights.splice(rowIdx, 1)
          }
        })
      } else {
        removedRowIndexes.forEach(rowIdx => removedIds.push(rowIdx))
      }

      window.parent.postMessage({
        type: 'ht-rows-removed',
        removedIds,
        removedRows: removedRowIndexes
      }, '*')
    } catch (e) { console.debug('afterRemoveRow hook error', e); }
  },
  licenseKey: "non-commercial-and-evaluation"
});

console.log(`Handsontable: v${Handsontable.version} (${Handsontable.buildDate})`);

// Listen for parent messages to load computed items into the table
window.addEventListener('message', async (ev) => {
  try {
    const msg = ev.data || {};
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'ht-init' && msg.config) {
      // Initialize table with configuration
      const config = msg.config;
      if (config.columns) {
        const cols = config.columns.map((c, idx) => {
          const columnConfig = {
            data: idx,
            type: resolveColumnType(c.type),
            readOnly: c.readOnly || false
          };
          return attachClampRenderer(columnConfig, c);
        });

        hot.updateSettings({
          colHeaders: config.columns.map(c => c.title),
          columns: cols,
          data: config.data || []
        });
      }
    }

    if (msg.type === 'ht-clear-table') {
      window.htSuppressChanges = true
      window.htClearingData = true
        // Clear table data but keep columns configuration
        const columnCount = window.currentColumns ? window.currentColumns.length : 7
        const emptyData = [];
        for (let i = 0; i < 20; i++) {
          const emptyRow = Array(columnCount).fill('')
          emptyData.push(emptyRow);
        }
        hot.loadData(emptyData);
        // Also clear stored rowIds
        window.currentRowIds = null
        window.currentRowHighlights = null
        try {
          hot.clear();
          hot.deselectCell();
        } catch (e) {
          // ignore
        }
        console.log('IFRAME: Table cleared, ready for new data')
        // Rehabilitar ediciones tras un breve lapso para permitir pegado/manual cuando no llegue un ht-load-items
        setTimeout(() => { window.htSuppressChanges = false; window.htClearingData = false }, 150)
      }

    if (msg.type === 'ht-load-items' && Array.isArray(msg.items)) {
      window.htSuppressChanges = true
      window.htClearingData = true
      // Ensure we have the items list to resolve names/prices
      const itemsList = await ensureItemsList();
      const mapByCode = {};
      for (const it of itemsList || []) {
        // Only map exact codes, no simplified versions
        mapByCode[it.item_code || it.name || ''] = it;
      }

      // Determine the active column layout (fallback to default structure)
      const activeColumns = (Array.isArray(window.currentColumns) && window.currentColumns.length > 0)
        ? window.currentColumns
        : [
            { key: 'item_code' },
            { key: 'item_name' },
            { key: 'item_group' },
            { key: 'brand' },
            { key: 'existing_price' },
            { key: 'purchase_price' },
            { key: 'new_price' }
          ];

      const columnCount = activeColumns.length;

      // Prepare rows according to the configured columns
      // helper to coerce incoming values to numbers (fallback 0)
      const toNumber = (v) => {
        if (v === undefined || v === null || v === '') return 0
        if (typeof v === 'number') return v
        const n = parseFloat(String(v))
        return isNaN(n) ? 0 : n
      }

      const rows = msg.items.map((item) => {
        const sku = item.item_code || item.sku || '';
        const matched = mapByCode[sku] || null;
        const name = item.item_name || matched?.item_name || matched?.name || '';
        const categoria = item.item_group || matched?.item_group || '';
        const marca = item.brand || matched?.brand || '';
        const existing = toNumber(item.existing_price !== undefined ? item.existing_price : matched?.valuation_rate || '');
        const purchase = toNumber(item.purchase_price !== undefined ? item.purchase_price : (item.purchase_price_converted !== undefined ? item.purchase_price_converted : ''));
        const newPriceRaw = item.new_price !== undefined && item.new_price !== null ? item.new_price : '';
        const newPriceDisplay = newPriceRaw === '' ? '' : newPriceRaw.toString();
        const newPriceNumber = toNumber(item.new_price !== undefined ? item.new_price : '');

        // Map values per column key so we can support custom layouts
          const valueByKey = {
          item_code: sku,
          sku,
          item_name: name,
          item_group: categoria,
          category: categoria,
          brand: marca,
          existing_price: existing,
          valuation_rate: existing,
          purchase_price: purchase,
          purchase_price_converted: purchase,
          valor: newPriceNumber,
          new_price: newPriceDisplay,
          price: newPriceNumber
        };

        return activeColumns.map(col => {
          const key = col?.key;
          if (!key) {
            return '';
          }
          if (Object.prototype.hasOwnProperty.call(valueByKey, key)) {
            return valueByKey[key];
          }
          if (Object.prototype.hasOwnProperty.call(item, key)) {
            return item[key];
          }
          if (matched && Object.prototype.hasOwnProperty.call(matched, key)) {
            return matched[key];
          }
          return '';
        });
      });

      // Replace table data (keep at least 20 rows)
      const minRows = Math.max(20, rows.length);
      const tableData = rows.slice(0, minRows);
      const emptyRow = Array.from({ length: columnCount }, () => '');
      while (tableData.length < minRows) tableData.push([...emptyRow]);

      console.log('IFRAME: ht-load-items applying rows:', rows.length, 'columns:', columnCount);
      hot.loadData(tableData);

      if (Array.isArray(msg.rowIds)) {
        const rowIds = msg.rowIds.slice()
        while (rowIds.length < tableData.length) {
          rowIds.push(null)
        }
        window.currentRowIds = rowIds
      } else {
        window.currentRowIds = null
      }

      if (Array.isArray(msg.rowHighlights)) {
        const highlights = msg.rowHighlights.slice()
        while (highlights.length < tableData.length) {
          highlights.push(null)
        }
        window.currentRowHighlights = highlights
      } else {
        window.currentRowHighlights = null
      }

      setTimeout(() => { window.htSuppressChanges = false; window.htClearingData = false }, 800)
    }

    if (msg.type === 'ht-configure-table' && msg.columns && msg.data) {
      // Configurar columnas dinámicamente
      const cols = msg.columns.map((c, idx) => {
        const columnType = resolveColumnType(c.type);
        const columnOptions = Array.isArray(c.options) ? c.options : [];
        const dropdownValues = columnOptions.map(opt => {
          if (opt && typeof opt === 'object') {
            return opt.value != null ? opt.value : (opt.label != null ? opt.label : '');
          }
          return opt || '';
        });
        const columnConfig = {
          data: idx,
          type: columnType,
          readOnly: c.readonly || false,
          numericFormat: columnType === 'numeric'
            ? (c.numericFormat || { pattern: '0.00' })
            : undefined,
          className: c.className || undefined,
        };
        if (columnType === 'dropdown' && dropdownValues.length > 0) {
          columnConfig.source = dropdownValues;
          columnConfig.strict = true;
          columnConfig.allowInvalid = false;
        }
        return attachClampRenderer(columnConfig, c);
      });
      const hiddenColumnsSetting = { indicators: true };
      if (Array.isArray(msg.hiddenColumns) && msg.hiddenColumns.length > 0) {
        hiddenColumnsSetting.columns = msg.hiddenColumns;
      }

      hot.updateSettings({
        colHeaders: msg.columns.map(c => c.label),
        columns: cols,
        colWidths: msg.columns.map(c => c.width || 120), // Use width if provided
        hiddenColumns: hiddenColumnsSetting,
        cells: function(row, col) {
          return { readOnly: window.loadingData || false };
        },
        afterGetColHeader: function(col, TH) {
          if (window.currentColumns && window.currentColumns[col] && window.currentColumns[col].key === 'delete_selection') {
            console.log('DEBUG: Setting up checkbox header for delete_selection column');
            TH.innerHTML = '<input type="checkbox" />';
            const checkbox = TH.querySelector('input[type="checkbox"]');
            if (checkbox) {
              checkbox.checked = window.currentSelectAll || false;
              checkbox.addEventListener('change', function() {
                window.parent.postMessage({ type: 'ht-toggle-select-all' }, '*');
              });
            }
            TH.classList.remove('hot-tooltip');
            TH.removeAttribute('data-tooltip');
            TH.setAttribute('title', '');
          } else {
            const columnConfig = window.currentColumns && window.currentColumns[col] ? window.currentColumns[col] : null;
            const tooltipText = columnConfig && columnConfig.headerTooltip ? columnConfig.headerTooltip : '';
            if (tooltipText) {
              TH.classList.add('hot-tooltip');
              TH.setAttribute('data-tooltip', tooltipText);
              TH.setAttribute('title', tooltipText);
            } else {
              TH.classList.remove('hot-tooltip');
              TH.removeAttribute('data-tooltip');
              TH.setAttribute('title', '');
            }
          }
        }
      });

      // Cargar datos
      hot.loadData(msg.data);

      // Guardar rowIds si vienen (para mapear cambios posteriores)
      if (Array.isArray(msg.rowIds)) {
        window.currentRowIds = msg.rowIds
      } else {
        // If not provided, clear
        window.currentRowIds = null
      }

      // Guardar rowHighlights si vienen (por fila)
      if (Array.isArray(msg.rowHighlights)) {
        // Trim or extend to match data length
        const dataLen = Array.isArray(msg.data) ? msg.data.length : 0
        window.currentRowHighlights = msg.rowHighlights.slice(0, dataLen)
        while (window.currentRowHighlights.length < dataLen) window.currentRowHighlights.push(null)
      } else {
        window.currentRowHighlights = null
      }

      // Guardar columnas para afterChange
      window.currentColumns = msg.columns;

      // Guardar loadingData para controlar readOnly
      window.loadingData = msg.loadingData || false;

      // Guardar selectAll si viene
      window.currentSelectAll = msg.selectAll || false;

      setTimeout(() => { window.htSuppressChanges = false; window.htClearingData = false }, 300)
    }

    if (msg.type === 'ht-focus-cell') {
      try {
        const r = Number.isFinite(msg.rowIndex) ? msg.rowIndex : null
        const c = Number.isFinite(msg.colIndex) ? msg.colIndex : null
        const message = msg.message || ''
        if (r == null || c == null) return

        // If table has fewer rows than r, ensure there are enough rows
        const totalRows = hot.countRows()
        if (r >= totalRows) {
          // extend table by adding empty rows
          const add = r - totalRows + 1
          for (let i = 0; i < add; i++) hot.alter('insert_row')
        }

        hot.selectCell(r, c)
        hot.scrollViewportTo(r, c)

        // Show temporary tooltip near the cell
        try {
          const td = hot.getCell(r, c)
          if (td) {
            showTempTooltip(td, message)
          }
        } catch (e) {}
      } catch (e) { console.debug('ht-focus-cell error', e) }
    }

    // Apply formula to rows: expects msg.formula as string
    if (msg.type === 'ht-apply-formula' && msg.formula) {
      try {
        const formula = String(msg.formula || '').trim()
        if (!formula) return

        // Find column indices dynamically
        const existingPriceColIndex = window.currentColumns ? window.currentColumns.findIndex(col => col.key === 'existing_price') : 4
        const purchasePriceColIndex = window.currentColumns ? window.currentColumns.findIndex(col => col.key === 'purchase_price') : 5
        const valorColIndex = window.currentColumns ? window.currentColumns.findIndex(col => col.key === 'valor' || col.key === 'new_price') : 6

        const replaceLogicalOperators = (expression) => (
          expression.replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||')
        )

        const replaceIF = (expression) => {
          let output = ''
          let cursor = 0
          const upperExpr = expression.toUpperCase()
          while (cursor < expression.length) {
            const idx = upperExpr.indexOf('IF(', cursor)
            if (idx === -1) {
              output += expression.slice(cursor)
              break
            }
            output += expression.slice(cursor, idx)
            let pos = idx + 3
            let depth = 1
            while (pos < expression.length && depth > 0) {
              if (expression[pos] === '(') depth++
              else if (expression[pos] === ')') depth--
              pos++
            }
            const inside = expression.slice(idx + 3, pos - 1)
            const parts = []
            let buf = ''
            let d = 0
            for (let j = 0; j < inside.length; j++) {
              const ch = inside[j]
              if (ch === '(') {
                d++
                buf += ch
              } else if (ch === ')') {
                d--
                buf += ch
              } else if (ch === ',' && d === 0) {
                parts.push(buf.trim())
                buf = ''
              } else {
                buf += ch
              }
            }
            if (buf.length) parts.push(buf.trim())
            if (parts.length !== 3) {
              output += `IF(${inside})`
            } else {
              output += `(( ${parts[0]} ) ? ( ${parts[1]} ) : ( ${parts[2]} ))`
            }
            cursor = pos
          }
          return output
        }

        const validateBooleanOperatorsUsage = (originalExpr) => {
          const hasLogical = /\bAND\b|\bOR\b/i.test(originalExpr)
          if (!hasLogical) return true
          return /[<>!=]=?|===|!==/.test(originalExpr)
        }

        // Safe-ish evaluator: replace variables and allow Math.* functions plus logical operators
        const evaluateForRow = (expr, actual, compra) => {
          try {
            if (!expr || typeof expr !== 'string') return null

            if (!validateBooleanOperatorsUsage(expr)) {
              return null
            }

            let replaced = replaceIF(String(expr))
            replaced = replaceLogicalOperators(replaced)

            const actualValue = parseFloat(actual) || 0
            const compraValue = parseFloat(compra) || 0

            replaced = replaced
              .replace(/price\.actual/gi, `(${actualValue})`)
              .replace(/price\.compra/gi, `(${compraValue})`)
              .replace(/\bprice\b/gi, `(${actualValue})`)

            const sanitized = replaced.replace(/[^0-9+\-*/().,\sA-Za-z?<>!=&|:]/g, ' ')
            const res = new Function('return ' + sanitized)()
            if (typeof res !== 'number' || !isFinite(res) || isNaN(res)) return null
            return res
          } catch (err) {
            console.debug('ht-apply-formula evaluateForRow error', err)
            return null
          }
        }

        const data = hot.getData()
        const updated = []
        for (let r = 0; r < data.length; r++) {
          const row = data[r] || []
          // Use dynamic indices
          const actual = parseFloat(row[existingPriceColIndex]) || 0
          const compra = parseFloat(row[purchasePriceColIndex]) || 0
          const result = evaluateForRow(formula, actual, compra)
          if (result === null) {
            // don't overwrite if formula invalid for this row
            updated.push(row)
            continue
          }
          // set rounded value with 2 decimals
          const rounded = Math.round((result + Number.EPSILON) * 100) / 100
          // include updated row in payload - construct manually to ensure calculated price is included
          const newRow = [...row]
          newRow[valorColIndex] = rounded
          updated.push(newRow)
        }

        // Apply all changes to Handsontable at once (this will trigger afterChange but we'll skip individual messages)
        hot.batch(() => {
          for (let r = 0; r < updated.length; r++) {
            const newRow = updated[r]
            const originalRow = data[r] || []
            if (newRow[valorColIndex] !== originalRow[valorColIndex]) {
              hot.setDataAtCell(r, valorColIndex, newRow[valorColIndex], 'formula-application')
            }
          }
        })

        // Notify parent with updated rows (trim empty trailing rows)
        try {
          const payload = []
          const payloadRowIds = []
          for (let i = 0; i < updated.length; i++) {
            const row = updated[i]
            const isEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '')
            if (!isEmpty) {
              payload.push(row)
              // Generate rowId if not available
              if (Array.isArray(window.currentRowIds) && window.currentRowIds[i] !== undefined) {
                payloadRowIds.push(window.currentRowIds[i])
              } else {
                payloadRowIds.push(`formula-row-${i}`)
              }
            }
          }
          window.parent.postMessage({ 
            type: 'ht-data-changed', 
            data: payload, 
            rowIds: payloadRowIds.length > 0 ? payloadRowIds : null,
            formulaApplied: true // Flag to indicate this came from formula application
          }, '*')
        } catch (e) {
          // ignore
        }
      } catch (e) {
        console.debug('ht-apply-formula handler error', e)
      }
    }
  } catch (e) {
    console.debug('Error handling message', e);
  }
});
