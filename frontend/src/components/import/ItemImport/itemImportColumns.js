// ============================================
// CONFIGURACIÓN DE COLUMNAS PARA ITEM IMPORT
// ============================================

// Helper para obtener opciones de columna
export const getColumnOptions = (
  columnKey,
  itemGroups = [],
  uoms = [],
  warehouses = [],
  availableExpenseAccounts = [],
  availableIncomeAccounts = [],
  taxTemplateOptions = []
) => {
  if (columnKey === 'item_group') {
    return itemGroups.map(g => ({ value: g.name, label: g.item_group_name }))
  }
  if (columnKey === 'stock_uom') {
    return uoms.map(u => ({ value: u.name, label: u.uom_name }))
  }
  if (columnKey === 'default_warehouse' || columnKey === 'warehouse') {
    return Array.isArray(warehouses) ? warehouses.map(w => ({ value: w.name, label: w.warehouse_name })) : []
  }
  if (columnKey === 'expense_account') {
    return availableExpenseAccounts.map(account => ({ value: account.name, label: account.account_name }))
  }
  if (columnKey === 'income_account') {
    return availableIncomeAccounts.map(account => ({ value: account.name, label: account.account_name }))
  }
  if (columnKey === 'iva_template') {
    return Array.isArray(taxTemplateOptions) ? taxTemplateOptions : []
  }
  return []
}

export const getColumns = ({
  importMode,
  inputMode,
  hasLoadedData,
  itemGroups,
  uoms,
  warehouses,
  availableExpenseAccounts,
  availableIncomeAccounts,
  taxTemplateOptions = []
}) => {
  // Helper para obtener opciones de columna (usando la función exportada)
  const getColumnOptionsLocal = (columnKey) => getColumnOptions(columnKey, itemGroups, uoms, warehouses, availableExpenseAccounts, availableIncomeAccounts, taxTemplateOptions)

  const currentInputMode = inputMode[importMode] || 'all'

  // ========================================
  // MODO STOCK
  // ========================================
  if (importMode === 'stock') {
    if (currentInputMode === 'paste') {
      return [
        { 
          key: 'selected', 
          label: 'Sel.', 
          fullLabel: 'Seleccionar',
          required: false, 
          type: 'checkbox',
          tooltip: 'Seleccionar item para eliminación',
          canClearColumn: false,
          readonly: false,
          width: 50
        },
        { 
          key: 'item_code', 
          label: 'SKU', 
          fullLabel: 'Código de Item',
          required: true, 
          type: 'text',
          tooltip: 'Pega códigos de items (SKUs) para cargar sus datos de stock',
          canClearColumn: true
        },
        { 
          key: 'item_name', 
          label: 'Nombre', 
          fullLabel: 'Nombre del Item',
          required: true, 
          type: 'text',
          tooltip: 'Nombre del Item',
          readonly: true,
          canClearColumn: true
        },
        { 
          key: 'current_stock', 
          label: 'Stock Actual', 
          fullLabel: 'Stock Actual',
          required: false, 
          type: 'number',
          tooltip: 'Stock actual en inventario',
          readonly: true,
          canClearColumn: true,
          minWidth: '80px'
        },
        { 
          key: 'new_stock', 
          label: 'Nuevo Stock', 
          fullLabel: 'Nuevo Stock',
          required: false, 
          type: 'number',
          tooltip: 'Nuevo stock a establecer',
          canClearColumn: true,
          minWidth: '80px'
        },
        { 
          key: 'valuation_rate', 
          label: 'Costo', 
          fullLabel: 'Precio de Costo',
          required: false, 
          type: 'number',
          tooltip: 'Precio de Costo: Valor unitario para valoración de inventario (opcional en gestión de stock)',
          canClearColumn: true,
          minWidth: '100px'
        }
      ]
    }
    return [
      { 
        key: 'selected', 
        label: 'Sel.', 
        fullLabel: 'Seleccionar',
        required: false, 
        type: 'checkbox',
        tooltip: 'Seleccionar item para eliminación',
        canClearColumn: false,
        readonly: false,
        width: 50
      },
      { 
        key: 'item_code', 
        label: 'SKU', 
        fullLabel: 'Código de Item',
        required: true, 
        type: 'text',
        tooltip: 'Código de Item (SKU)',
        readonly: true,
        canClearColumn: true
      },
      { 
        key: 'item_name', 
        label: 'Nombre', 
        fullLabel: 'Nombre del Item',
        required: true, 
        type: 'text',
        tooltip: 'Nombre del Item',
        readonly: true,
        canClearColumn: true
      },
      { 
        key: 'current_stock', 
        label: 'Stock Actual', 
        fullLabel: 'Stock Actual',
        required: false, 
        type: 'number',
        tooltip: 'Stock actual en inventario',
        readonly: true,
        canClearColumn: true,
        minWidth: '80px'
      },
      { 
        key: 'new_stock', 
        label: 'Nuevo Stock', 
        fullLabel: 'Nuevo Stock',
        required: false, 
        type: 'number',
        tooltip: 'Nuevo stock a establecer',
        canClearColumn: true,
        minWidth: '80px'
      },
      { 
        key: 'valuation_rate', 
        label: 'Costo', 
        fullLabel: 'Precio de Costo',
        required: false, 
        type: 'number',
        tooltip: 'Precio de Costo: Valor unitario para valoración de inventario (opcional en gestión de stock)',
        canClearColumn: true,
        minWidth: '100px'
      }
    ]
  }

  // ========================================
  // MODO BULK-UPDATE-FIELDS
  // ========================================
  if (importMode === 'bulk-update-fields') {
    if (currentInputMode === 'paste') {
      return [
        { 
          key: 'selected', 
          label: 'Sel.', 
          fullLabel: 'Seleccionar',
          required: false, 
          type: 'checkbox',
          tooltip: 'Seleccionar item para eliminación',
          canClearColumn: false,
          readonly: false,
          width: 50
        },
        { 
          key: 'item_code', 
          label: 'SKU', 
          fullLabel: 'Código de Item',
          required: true, 
          type: 'text',
          tooltip: 'Pega códigos de items (SKUs) para cargar sus datos y actualizar campos masivamente',
          canClearColumn: true
        },
        { 
          key: 'item_name', 
          label: 'Nombre', 
          fullLabel: 'Nombre del Item',
          required: false, 
          type: 'text',
          tooltip: 'Nombre del Item',
          readonly: true,
          canClearColumn: true
        },
        { 
          key: 'item_group', 
          label: 'Categoría', 
          fullLabel: 'Categoría del Producto',
          required: false, 
          type: 'text',
          tooltip: 'Categoría del producto',
          readonly: true,
          canClearColumn: true
        }
      ]
    }
    return [
      { 
        key: 'selected', 
        label: 'Sel.', 
        fullLabel: 'Seleccionar',
        required: false, 
        type: 'checkbox',
        tooltip: 'Seleccionar item para eliminación',
        canClearColumn: false,
        readonly: false,
        width: 50
      },
      { 
        key: 'item_code', 
        label: 'SKU', 
        fullLabel: 'Código de Item',
        required: true, 
        type: 'text',
        tooltip: 'Código de Item (SKU)',
        readonly: true,
        canClearColumn: true
      },
      { 
        key: 'item_name', 
        label: 'Nombre', 
        fullLabel: 'Nombre del Item',
        required: false, 
        type: 'text',
        tooltip: 'Nombre del Item',
        readonly: true,
        canClearColumn: true
      },
      { 
        key: 'item_group', 
        label: 'Categoría', 
        fullLabel: 'Categoría del Producto',
        required: false, 
        type: 'text',
        tooltip: 'Categoría del producto',
        readonly: true,
        canClearColumn: true
      }
    ]
  }

  // ========================================
  // MODO UPDATE-WITH-DEFAULTS
  // ========================================
  if (importMode === 'update-with-defaults') {
    if (currentInputMode === 'paste') {
      return [
        { 
          key: 'selected', 
          label: 'Sel.', 
          fullLabel: 'Seleccionar',
          required: false, 
          type: 'checkbox',
          tooltip: 'Seleccionar item para eliminación',
          canClearColumn: false,
          readonly: false,
          width: 50
        },
        { 
          key: 'item_code', 
          label: 'SKU', 
          fullLabel: 'Código de Item',
          required: true, 
          type: 'text',
          tooltip: 'Pega códigos de items (SKUs) para cargar sus datos y actualizar con defaults',
          canClearColumn: true
        },
        { 
          key: 'item_name', 
          label: 'Nombre', 
          fullLabel: 'Nombre del Item',
          required: false, 
          type: 'text',
          tooltip: 'Nombre del Item: Nombre descriptivo (opcional en actualización)',
          canClearColumn: true,
          readonly: true
        },
        { 
          key: 'description', 
          label: 'Descripción',
          required: false, 
          type: 'textarea',
          tooltip: 'Descripción: Descripción detallada del item (opcional)',
          canClearColumn: true,
          readonly: true
        },
        { 
          key: 'item_group', 
          label: 'Categoría', 
          fullLabel: 'Categoría del Producto',
          required: false, 
          type: 'text',
          tooltip: 'Categoría: Clasificación del producto (opcional en actualización)',
          canClearColumn: true,
          readonly: true
        },
        { 
          key: 'brand', 
          label: 'Marca', 
          required: false, 
          type: 'text',
          tooltip: 'Marca: Marca del producto (opcional)',
          canClearColumn: true,
          readonly: true
        },
        {
          key: 'iva_template',
          label: 'IVA',
          fullLabel: 'Item Tax Template',
          required: false,
          type: 'select',
          tooltip: 'Plantilla de impuestos (IVA) para el Item',
          canClearColumn: true,
          options: getColumnOptionsLocal('iva_template')
        },
        { 
          key: 'default_warehouse', 
          label: 'Almacén Def.', 
          fullLabel: 'Almacén por Defecto',
          required: false, 
          type: 'select',
          tooltip: 'Almacén por Defecto: Almacén principal donde se almacena el producto',
          canClearColumn: true,
          options: getColumnOptionsLocal('default_warehouse')
        },
        { 
          key: 'expense_account', 
          label: 'Cuenta Gasto', 
          fullLabel: 'Cuenta de Gastos',
          required: false, 
          type: 'select',
          tooltip: 'Cuenta de Gastos: Cuenta contable para gastos relacionados con este item',
          canClearColumn: true,
          options: getColumnOptionsLocal('expense_account')
        },
        { 
          key: 'income_account', 
          label: 'Cuenta Ingreso', 
          fullLabel: 'Cuenta de Ingresos',
          required: false, 
          type: 'select',
          tooltip: 'Cuenta de Ingresos: Cuenta contable para ingresos por venta de este item',
          canClearColumn: true,
          options: getColumnOptionsLocal('income_account')
        }
      ]
    }
    return [
      { 
        key: 'selected', 
        label: 'Sel.', 
        fullLabel: 'Seleccionar',
        required: false, 
        type: 'checkbox',
        tooltip: 'Seleccionar item para eliminación',
        canClearColumn: false,
        readonly: false,
        width: 50
      },
      { 
        key: 'item_code', 
        label: 'SKU', 
        fullLabel: 'Código de Item',
        required: true, 
        type: 'text',
        tooltip: 'Código de Item (SKU): Identificador único del item a actualizar',
        canClearColumn: true,
        readonly: true
      },
      { 
        key: 'item_name', 
        label: 'Nombre', 
        fullLabel: 'Nombre del Item',
        required: false, 
        type: 'text',
        tooltip: 'Nombre del Item: Nombre descriptivo (opcional en actualización)',
        canClearColumn: true,
        readonly: true
      },
      { 
        key: 'description', 
        label: 'Descripción',
        required: false, 
        type: 'textarea',
        tooltip: 'Descripción: Descripción detallada del item (opcional)',
        canClearColumn: true,
        readonly: true
      },
      { 
        key: 'item_group', 
        label: 'Categoría', 
        fullLabel: 'Categoría del Producto',
        required: false, 
        type: 'text',
        tooltip: 'Categoría: Clasificación del producto (opcional en actualización)',
        canClearColumn: true,
        readonly: true
      },
        { 
          key: 'brand', 
          label: 'Marca', 
          required: false, 
          type: 'text',
          tooltip: 'Marca: Marca del producto (opcional)',
          canClearColumn: true,
          readonly: true
        },
        {
          key: 'iva_template',
          label: 'IVA',
          fullLabel: 'Item Tax Template',
          required: false,
          type: 'select',
          tooltip: 'Plantilla de impuestos (IVA) para el Item',
          canClearColumn: true,
          options: getColumnOptionsLocal('iva_template')
        },
        { 
          key: 'default_warehouse', 
          label: 'Almacén Def.', 
          fullLabel: 'Almacén por Defecto',
        required: false, 
        type: 'select',
        tooltip: 'Almacén por Defecto: Almacén principal donde se almacena el producto',
        canClearColumn: true,
        options: getColumnOptionsLocal('default_warehouse')
      },
      { 
        key: 'expense_account', 
        label: 'Cuenta Gasto', 
        fullLabel: 'Cuenta de Gastos',
        required: false, 
        type: 'select',
        tooltip: 'Cuenta de Gastos: Cuenta contable para gastos relacionados con este item',
        canClearColumn: true,
        options: getColumnOptionsLocal('expense_account')
      },
      { 
        key: 'income_account', 
        label: 'Cuenta Ingreso', 
        fullLabel: 'Cuenta de Ingresos',
        required: false, 
        type: 'select',
        tooltip: 'Cuenta de Ingresos: Cuenta contable para ingresos por venta de este item',
        canClearColumn: true,
        options: getColumnOptionsLocal('income_account')
      }
    ]
  }

  // ========================================
  // MODO UPDATE (paste mode)
  // ========================================
  if (importMode === 'update' && currentInputMode === 'paste') {
    return [
      { 
        key: 'selected', 
        label: 'Sel.', 
        fullLabel: 'Seleccionar',
        required: false, 
        type: 'checkbox',
        tooltip: 'Seleccionar item para eliminación',
        canClearColumn: false,
        readonly: false,
        width: 50
      },
      { 
        key: 'item_code', 
        label: 'SKU', 
        fullLabel: 'Código de Item',
        required: true, 
        type: 'text',
        tooltip: 'Código de Item (SKU): Identificador único del item a actualizar',
        canClearColumn: true,
        readonly: hasLoadedData
      },
      { 
        key: 'item_name', 
        label: 'Nombre', 
        fullLabel: 'Nombre del Item',
        required: false, 
        type: 'text',
        tooltip: 'Nombre del Item: Nombre descriptivo (opcional en actualización)',
        canClearColumn: true,
        readonly: true
      },
      { 
        key: 'description', 
        label: 'Descripción',
        required: false, 
        type: 'textarea',
        tooltip: 'Descripción: Descripción detallada del item (opcional)',
        canClearColumn: true,
        readonly: !hasLoadedData
      },
      { 
        key: 'item_group', 
        label: 'Categoría', 
        fullLabel: 'Categoría del Producto',
        required: false, 
        type: 'text',
        tooltip: 'Categoría: Clasificación del producto (opcional en actualización)',
        canClearColumn: true,
        readonly: !hasLoadedData
      },
      { 
        key: 'stock_uom', 
        label: 'UOM', 
        fullLabel: 'Unidad de Medida',
        required: false, 
        type: 'validated-text',
        tooltip: 'UOM (Unidad de Medida): Valores válidos: Unit, Kg, Litro, Caja, etc.',
        canClearColumn: true,
        validationSource: 'uoms',
        readonly: !hasLoadedData
      },
      { 
        key: 'is_stock_item', 
        label: 'Tipo', 
        required: false,
        type: 'select',
        tooltip: 'Tipo: Producto (mantiene inventario) o Servicio (no mantiene inventario)',
        canClearColumn: true,
        options: [
          { value: 'Producto', label: 'Producto' },
          { value: 'Servicio', label: 'Servicio' }
        ],
        readonly: !hasLoadedData
      },
      { 
        key: 'brand', 
        label: 'Marca', 
        required: false, 
        type: 'text',
        tooltip: 'Marca: Marca del producto (opcional)',
        canClearColumn: true,
        readonly: !hasLoadedData
      },
      {
        key: 'iva_template',
        label: 'IVA',
        fullLabel: 'Item Tax Template',
        required: true,
        type: 'select',
        tooltip: 'Plantilla de impuestos (IVA) asignada al Item',
        canClearColumn: true,
        options: getColumnOptionsLocal('iva_template'),
        readonly: !hasLoadedData
      },
      {
        key: 'platform',
        label: 'Plataforma',
        fullLabel: 'Plataforma',
        required: false,
        type: 'select',
        options: [
          { value: 'mercadolibre', label: 'Mercado Libre' },
          { value: 'amazon', label: 'Amazon' },
          { value: 'ebay', label: 'eBay' },
          { value: 'shopify', label: 'Shopify' },
          { value: 'woocommerce', label: 'WooCommerce' },
          { value: 'tienda_nube', label: 'Tienda Nube' },
          { value: 'otro', label: 'Otro' }
        ],
        tooltip: 'Plataforma: Selecciona la plataforma donde se vende el producto',
        canClearColumn: true,
        readonly: !hasLoadedData
      },
      { 
        key: 'url', 
        label: 'URL', 
        fullLabel: 'Enlace del Producto',
        required: false, 
        type: 'text',
        tooltip: 'URL: Enlace directo al producto en la plataforma seleccionada',
        canClearColumn: true,
        readonly: !hasLoadedData
      }
    ]
  }

  // ========================================
  // MODO INSERT / UPDATE (all mode)
  // ========================================
  return [
    { 
      key: 'selected', 
      label: 'Sel.', 
      fullLabel: 'Seleccionar',
      required: false, 
      type: 'checkbox',
      tooltip: 'Seleccionar item para eliminación',
      canClearColumn: false,
      readonly: false,
      width: 50
    },
    { 
      key: 'item_code', 
      label: 'SKU', 
      fullLabel: 'Código de Item',
      required: true, 
      type: 'text',
      tooltip: 'Código de Item (SKU): Código único del item. Se puede generar automáticamente con patrón.',
      canAutoGenerate: true,
      canCopyColumn: true,
      canClearColumn: true,
      defaultPattern: 'SC-AAA0001',
      readonly: importMode === 'update'
    },
    { 
      key: 'item_name', 
      label: 'Nombre', 
      fullLabel: 'Nombre del Item',
      required: true, 
      type: 'text',
      tooltip: 'Nombre del Item: Nombre descriptivo del producto o servicio',
      canClearColumn: true
    },
    { 
      key: 'description', 
      label: 'Descripción',
      required: false, 
      type: 'textarea',
      tooltip: 'Descripción: Descripción detallada del item (opcional)',
      canClearColumn: true
    },
    { 
      key: 'item_group', 
      label: 'Categoría', 
      fullLabel: 'Categoría del Producto',
      required: true, 
      type: 'text',
      tooltip: 'Categoría: Clasificación del producto (Ej: Ruedas, Asientos, Cascos, Cuadros). Escribe libremente, las nuevas se crearán automáticamente.',
      canSetDefault: true,
      canClearColumn: true
    },
    { 
      key: 'stock_uom', 
      label: 'UOM', 
      fullLabel: 'Unidad de Medida',
      required: true, 
      type: 'select',
      tooltip: 'UOM (Unidad de Medida): Selecciona de la lista de unidades disponibles.',
      canSetDefault: true,
      canClearColumn: true,
      options: uoms.map(uom => ({ value: uom.name, label: uom.uom_name }))
    },
    { 
      key: 'is_stock_item', 
      label: 'Tipo', 
      required: true,
      type: 'select',
      tooltip: 'Tipo: Producto (mantiene inventario) o Servicio (no mantiene inventario)',
      canSetDefault: true,
      canClearColumn: true,
      options: [
        { value: 'Producto', label: 'Producto' },
        { value: 'Servicio', label: 'Servicio' }
      ]
    },
    { 
      key: 'brand', 
      label: 'Marca', 
      required: false, 
      type: 'text',
      tooltip: 'Marca: Marca del producto (Ej: Shimano, Specialized, Trek)',
      canClearColumn: true
    },
    {
      key: 'iva_template',
      label: 'IVA',
      fullLabel: 'Item Tax Template',
      required: true,
      type: 'select',
      tooltip: 'Plantilla de impuestos (IVA) a asignar en el Item',
      canSetDefault: true,
      canClearColumn: true,
      options: getColumnOptionsLocal('iva_template')
    },
    {
      key: 'platform',
      label: 'Plataforma',
      fullLabel: 'Plataforma',
      required: false, 
      type: 'select',
      options: [
        { value: 'mercadolibre', label: 'Mercado Libre' },
        { value: 'amazon', label: 'Amazon' },
        { value: 'ebay', label: 'eBay' },
        { value: 'shopify', label: 'Shopify' },
        { value: 'woocommerce', label: 'WooCommerce' },
        { value: 'tienda_nube', label: 'Tienda Nube' },
        { value: 'otro', label: 'Otro' }
      ],
      tooltip: 'Plataforma: Selecciona la plataforma donde se vende el producto',
      canSetDefault: true,
      canClearColumn: true
    },
    { 
      key: 'url', 
      label: 'URL', 
      fullLabel: 'Enlace del Producto',
      required: false, 
      type: 'text',
      tooltip: 'URL: Enlace directo al producto en la plataforma seleccionada',
      canClearColumn: true
    }
  ]
}
