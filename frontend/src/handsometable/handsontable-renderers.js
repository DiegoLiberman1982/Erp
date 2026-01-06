import Handsontable from "handsontable";

const CLAMP_RENDERER_NAME = "hotClampRenderer";
let clampRendererRegistered = false;

const isTextLike = (type) => {
  if (!type) return true;
  const normalized = type.toString().toLowerCase();
  return normalized === "text" || normalized === "string";
};

const shouldClampColumn = (columnConfig = {}, columnMeta = {}) => {
  if (columnConfig.renderer || columnMeta.renderer) {
    return false;
  }

  if (columnMeta?.disableClamp === true || columnMeta?.allowFullText === true) {
    return false;
  }

  return isTextLike(columnConfig.type);
};

const registerClampRenderer = () => {
  if (clampRendererRegistered) return;

  Handsontable.renderers.registerRenderer(CLAMP_RENDERER_NAME, function clampRenderer(
    instance,
    td,
    row,
    column,
    prop,
    value,
    cellProperties
  ) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);

    const textValue = td.textContent ?? "";
    let wrapper = td.querySelector(".hot-cell-clamp");
    if (!wrapper) {
      const doc = (instance && instance.rootDocument) || (td && td.ownerDocument) || document;
      wrapper = doc.createElement("div");
      wrapper.className = "hot-cell-clamp";
    }

    Handsontable.dom.empty(td);
    wrapper.textContent = textValue;
    const shouldShowTooltip =
      !!textValue &&
      (cellProperties?.readOnly === true || cellProperties?.readOnly === "true") &&
      textValue.length > 41;
    if (shouldShowTooltip) {
      td.classList.add("hot-cell-tooltip");
      td.setAttribute("data-tooltip", textValue);
      console.debug("[Handsontable] Tooltip activado:", textValue);
    } else {
      td.classList.remove("hot-cell-tooltip");
      td.removeAttribute("data-tooltip");
    }
    td.appendChild(wrapper);
  });

  clampRendererRegistered = true;
};

export const attachClampRenderer = (columnConfig = {}, columnMeta = {}) => {
  registerClampRenderer();
  if (shouldClampColumn(columnConfig, columnMeta)) {
    columnConfig.renderer = CLAMP_RENDERER_NAME;
  }
  return columnConfig;
};

export { CLAMP_RENDERER_NAME };
