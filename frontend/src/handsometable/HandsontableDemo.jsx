import React, { useEffect, useMemo, useRef } from 'react';
import Handsontable from "handsontable";
import "handsontable/dist/handsontable.full.min.css";
import "@handsontable/pikaday/css/pikaday.css";
import { attachClampRenderer } from "./handsontable-renderers";


// choose cell types you want to use and import them
import {
  registerCellType,
  CheckboxCellType,
  DateCellType,
  DropdownCellType,
  NumericCellType,
} from "handsontable/cellTypes";
import { registerLanguageDictionary, esMX } from "handsontable/i18n";

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
registerLanguageDictionary(esMX);

// Datos de ejemplo vacíos - se pueden pasar como props en el futuro
// const data = [];

const ODD_ROW_CLASS = "odd";

function addClassesToRows(TD, row, column, prop, value, cellProperties) {
  // Adding classes to `TR` just while rendering first visible `TD` element
  if (column !== 0) {
    return;
  }

  const parentElement = TD.parentElement;

  if (parentElement === null) {
    return;
  }

  // Add class to odd TRs
  if (row % 2 === 0) {
    parentElement.classList.add(ODD_ROW_CLASS);
  } else {
    parentElement.classList.remove(ODD_ROW_CLASS);
  }
}

export default function HandsontableDemo({ 
  columns = [], 
  data = [], 
  onDataChange, 
  title = "Tabla Base de Gestión", 
  subtitle = "Tabla interactiva para gestión de datos", 
  icon = "📊",
  showHeader = true,
  settings = {}
}) {
  const hotRef = useRef(null);
  const containerRef = useRef(null);
  const columnsRef = useRef(columns);
  const onDataChangeRef = useRef(onDataChange);
  const settingsRef = useRef(settings);
  const internalChangeRef = useRef(false);

  const dataArray = useMemo(
    () => data.map(row => columns.map(col => row[col.key] ?? '')),
    [data, columns]
  );

  const buildColumnsConfig = (cols) =>
    cols.map((c, idx) => {
      const columnConfig = {
        data: idx,
        type: c.type === 'number'
          ? 'numeric'
          : c.type === 'select'
            ? 'dropdown'
            : c.type === 'checkbox'
              ? 'checkbox'
              : 'text',
        readOnly: c.readonly || false,
        source: c.type === 'select' && c.options ? c.options.map(o => o.label) : undefined,
      };
      return attachClampRenderer(columnConfig, c);
    });

  const applyHeaderTooltip = (col, TH) => {
    if (col < 0) return;
    TH.classList.remove('hot-tooltip');
    TH.removeAttribute('data-tooltip');
    const column = columnsRef.current[col];
    if (column?.headerTooltip) {
      TH.classList.add('hot-tooltip');
      TH.setAttribute('data-tooltip', column.headerTooltip);
    }
    TH.setAttribute('title', '');
  };

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  useEffect(() => {
    settingsRef.current = settings;
    if (hotRef.current && settings && Object.keys(settings).length > 0) {
      hotRef.current.updateSettings(settings);
    }
  }, [settings]);

  useEffect(() => {
    if (containerRef.current && !hotRef.current) {
      hotRef.current = new Handsontable(containerRef.current, {
        data: dataArray,
        height: settingsRef.current?.height ?? 450,
        colWidths: columnsRef.current.map(() => 120),
        colHeaders: columnsRef.current.map(c => c.label || c.key),
        columns: buildColumnsConfig(columnsRef.current),
        dropdownMenu: true,
        language: esMX.languageCode,
        hiddenColumns: {
          indicators: true
        },
        contextMenu: true,
        multiColumnSorting: true,
        filters: true,
        rowHeaders: true,
        manualRowMove: true,
        navigableHeaders: true,
        autoWrapCol: true,
        headerClassName: 'htLeft',
        beforeRenderer: addClassesToRows,
        afterChange: (changes, source) => {
          if (!changes || source === 'loadData') return;
          if (!onDataChangeRef.current) return;
          const newDataArray = hotRef.current.getData();
          const newData = newDataArray.map(rowArray => {
            const obj = {};
            columnsRef.current.forEach((col, idx) => {
              obj[col.key] = rowArray[idx];
            });
            return obj;
          });
          internalChangeRef.current = true;
          onDataChangeRef.current(newData);
        },
        afterGetColHeader: (col, TH) => {
          applyHeaderTooltip(col, TH);
        },
        licenseKey: "non-commercial-and-evaluation",
        ...settingsRef.current
      });

      console.log(`Handsontable: v${Handsontable.version} (${Handsontable.buildDate})`);
    }

    return () => {
      if (hotRef.current) {
        hotRef.current.destroy();
        hotRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (hotRef.current) {
      hotRef.current.updateSettings({
        columns: buildColumnsConfig(columns),
        colHeaders: columns.map(c => c.label || c.key),
      });
      hotRef.current.render();
    }
  }, [columns]);

  useEffect(() => {
    if (!hotRef.current) return;
    if (internalChangeRef.current) {
      internalChangeRef.current = false;
      return;
    }
    hotRef.current.loadData(dataArray);
  }, [dataArray]);

  return showHeader ? (
    <div className="h-full flex flex-col bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          
          {/* Título a la izquierda */}
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-xl flex items-center justify-center">
              <span className="text-2xl">{icon}</span>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">Tabla</div>
              <div className="text-xl font-bold text-gray-800">{title}</div>
            </div>
          </div>

          {/* Tip a la derecha */}
          <div className="flex items-center">
            <div className="text-sm text-gray-600">
              💡 Tip: Copia columnas de Excel (Ctrl+C) y pégalas en cualquier celda (Ctrl+V)
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div ref={containerRef} className="handsontable-container"></div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
          .handsontable-container table.htCore tr.odd td {
            background: #fafbff;
          }

          .handsontable-container .handsontable .green {
            background: #37bc6c;
            font-weight: bold;
          }

          .handsontable-container .handsontable .orange {
            background: #fcb515;
            font-weight: bold;
          }

          .handsontable-container .hot-tooltip {
            position: relative;
          }

          .handsontable-container .hot-tooltip::after {
            content: attr(data-tooltip);
            position: absolute;
            top: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            background: #111827;
            color: #f9fafb;
            font-weight: 700;
            font-size: 11px;
            line-height: 1.2;
            padding: 8px 10px;
            border-radius: 0.35rem;
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.35);
            opacity: 0;
            pointer-events: none;
            white-space: normal;
            width: 240px;
            z-index: 30;
            transition: opacity 0.15s ease;
          }

          .handsontable-container .hot-tooltip:hover::after {
            opacity: 1;
          }
        `
      }} />
    </div>
  ) : (
    <div className="flex-1 p-6 overflow-auto">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div ref={containerRef} className="handsontable-container"></div>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        💡 Tip: Copia columnas de Excel (Ctrl+C) y pégalas en cualquier celda (Ctrl+V)
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
          .handsontable-container table.htCore tr.odd td {
            background: #fafbff;
          }

          .handsontable-container .handsontable .green {
            background: #37bc6c;
            font-weight: bold;
          }

          .handsontable-container .handsontable .orange {
            background: #fcb515;
            font-weight: bold;
          }

          .handsontable-container .hot-tooltip {
            position: relative;
          }

          .handsontable-container .hot-tooltip::after {
            content: attr(data-tooltip);
            position: absolute;
            top: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            background: #111827;
            color: #f9fafb;
            font-weight: 700;
            font-size: 11px;
            line-height: 1.2;
            padding: 8px 10px;
            border-radius: 0.35rem;
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.35);
            opacity: 0;
            pointer-events: none;
            white-space: normal;
            width: 240px;
            z-index: 30;
            transition: opacity 0.15s ease;
          }

          .handsontable-container .hot-tooltip:hover::after {
            opacity: 1;
          }
        `
      }} />
    </div>
  );
}
