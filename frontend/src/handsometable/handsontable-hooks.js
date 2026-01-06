import Handsontable from "handsontable";
import { ODD_ROW_CLASS } from "./handsontable-constants.js";

export function addClassesToRows(TD, row, column, prop, value, cellProperties) {
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
    Handsontable.dom.addClass(parentElement, ODD_ROW_CLASS);
  } else {
    Handsontable.dom.removeClass(parentElement, ODD_ROW_CLASS);
  }

  // Apply highlight classes from parent via window.currentRowHighlights
  try {
    const highlights = Array.isArray(window.currentRowHighlights) ? window.currentRowHighlights : null;
    const highlightClassMap = {
      duplicate: 'ht-row-duplicate',
      error: 'ht-row-error',
      'flag-yellow': 'ht-row-flag-yellow',
      'flag-orange': 'ht-row-flag-orange',
      'flag-red': 'ht-row-flag-red'
    };
    const resetClasses = Object.values(highlightClassMap);
    if (highlights && highlights[row]) {
      const h = highlights[row];
      resetClasses.forEach(cls => Handsontable.dom.removeClass(parentElement, cls));
      const className = highlightClassMap[h];
      if (className) {
        Handsontable.dom.addClass(parentElement, className);
      }
    } else {
      resetClasses.forEach(cls => Handsontable.dom.removeClass(parentElement, cls));
    }
  } catch (e) {
    // ignore
  }
}
