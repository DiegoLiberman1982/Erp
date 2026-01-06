// Central toggle/mapping for backend API routes.
// When you migrate backend endpoints, update this file to enable or remap routes.

const API_ROUTES = {
  // If false, frontend won't call the legacy endpoint and will use empty data/placeholders.
  customers: '/api/customers',
  suppliers: '/api/suppliers',
  currencies: '/api/currencies',
  activeCompany: '/api/active-company',
  subscriptions: '/api/subscriptions',
  subscriptionPlans: '/api/subscription-plans',
  subscriptionsBulk: '/api/subscriptions/bulk',
  subscriptionsBulkCancel: '/api/subscriptions/bulk-cancel',
  subscriptionPlansBulk: '/api/subscription-plans/bulk',
  fiscalYears: '/api/fiscal-years',
  customerInvoices: '/api/customer-invoices',
  customerPayments: '/api/pagos/customer-payments',
  customerStatements: '/api/customer-statements',
  supplierStatements: (supplierName, company) => `/api/suppliers/${encodeURIComponent(supplierName)}/statements${company ? `?company=${encodeURIComponent(company)}` : ''}`,
  invoices: '/api/invoices',
  bulkSalesInvoicesRemoval: '/api/invoices/bulk-removal',
  bulkPaymentEntriesRemoval: '/api/payments/bulk-removal',
  salesInvoiceImport: '/api/invoices/import-afip',
  purchaseInvoiceImport: '/api/purchase-invoices/import-afip',
  validateAfipTalonarios: '/api/invoices/afip/validate-talonarios',
  
  // Document validation
  validateDuplicate: '/api/validate/duplicate-check',
  validateBulkDuplicates: '/api/validate/bulk-duplicate-check',

  // Party import
  importCustomers: '/api/import/customers',
  importSuppliers: '/api/import/suppliers',
  
  purchaseInvoices: '/api/purchase-invoices',
  bulkPurchaseInvoicesRemoval: '/api/purchase-invoices/bulk-removal',
  salesOrders: '/api/sales-orders',
  salesOrder: (name) => `/api/sales-orders/${encodeURIComponent(name)}`,
  salesOrderCancel: (name) => `/api/sales-orders/${encodeURIComponent(name)}/cancel`,
  salesOrdersMetrics: '/api/sales-orders/metrics',
  itemGroups: '/api/inventory/item-groups',
  itemGroupsBulkDelete: '/api/inventory/item-groups/bulk-delete',
  taxSettings: '/api/tax-settings',
  taxTemplates: '/api/tax-templates',
  taxAccountMap: '/api/tax-account-map',
  taxAccountMapAccounts: '/api/tax-account-map/accounts',
  taxAccountMapLiabilityAccounts: '/api/tax-account-map/liability-accounts',
  setupCompanyInitialization: '/api/setup/company-initialization',
  setupStatus: '/api/setup/status',
  setupAssignTaxAccount: '/api/setup/assign-tax-account',
  setupCreateTaxTemplate: '/api/setup/create-tax-template',
  setupAssignTemplateToItem: '/api/setup/assign-template-to-item',
  setupTaxTemplates: '/api/setup/sales-tax-templates',
  setupItems: '/api/setup/items',
  setupTaxAccounts: '/api/setup/tax-accounts',
  setupAssignPurchaseAccount: '/api/setup/assign-purchase-account',
  setupAssignSalesAccount: '/api/setup/assign-sales-account',
  setupCreateIvaCustomFields: '/api/setup/create-iva-custom-fields',
  setupCreateReconciliationCustomFields: '/api/setup/create-reconciliation-custom-fields',
  setupCreateItemCustomFields: '/api/setup/create-item-custom-fields',
  setupCreateCompanyFilterFields: '/api/setup/create-company-filter-fields',
  setupCreatePriceListCustomFields: '/api/setup/create-price-list-custom-fields',
  setupCreateAllCustomFields: '/api/setup/create-all-custom-fields',
  systemSettings: '/api/system-settings',
  inflationIndices: {
    list: '/api/inflation-indices',
    bulk: '/api/inflation-indices/bulk'
  },
  inflationAdjustment: '/api/inflation/adjust',

  // Setup2 routes (AFIP configuration)
  setup2CreateCustomFields: '/api/setup2/create-custom-fields',
  setup2CreateAfipDoctypes: '/api/setup2/create-afip-doctypes',
  setup2CreateAfipRecords: '/api/setup2/create-afip-records',
  setup2CreateNamingSeries: '/api/setup2/create-naming-series',
  setup2InitializeAfipSetup: '/api/setup2/initialize-afip-setup',
  orders: false,
  adminInfo: false,

  // Integraciones
  integrations: {
    settings: '/api/integrations/settings',
    generateApiKey: '/api/integrations/api-key',
  },

  mercadopago: {
    sync: '/api/mercadopago/sync',
    accountSync: (accountName) => `/api/treasury-accounts/${encodeURIComponent(accountName)}/mercadopago-sync`,
  },

  bankMatching: {
    enableAuto: '/api/bank-matching/enable-auto',
    suggestions: (transactionName) => `/api/bank-transactions/${encodeURIComponent(transactionName)}/suggestions`,
    reconcile: (transactionName) => `/api/bank-transactions/${encodeURIComponent(transactionName)}/reconcile`,
    unreconcile: (transactionName) => `/api/bank-transactions/${encodeURIComponent(transactionName)}/unreconcile`,
    deleteBankTransaction: (transactionName) => `/api/bank-transactions/${encodeURIComponent(transactionName)}`
  },

  // Bank movements import
  bankMovementsImport: '/api/bank-movements/import',
  bankMovementsValidate: '/api/bank-movements/import/validate',
  bankMovementsImportTemplate: '/api/bank-movements/import-template',

  // Accounting routes
  accounts: '/api/accounts',
  accountDetails: '/api/accounts/',
  journalEntries: '/api/journal-entries',
  journalEntryDetails: '/api/journal-entries/',
  glEntries: '/api/gl-entries',
  trialBalance: '/api/trial-balance',
  fiscalYears: '/api/fiscal-years',
  costCenters: '/api/cost-centers',

  // Exchange rates routes
  exchangeRates: '/api/cotizaciones',
  exchangeRate: '/api/cotizaciones/',
  // Currency exchange management
  currencyExchange: {
    base: '/api/currency-exchange',
    // Get latest rate for a currency (helper will interpolate)
    latest: (currency) => `/api/currency-exchange/latest?currency=${encodeURIComponent(currency)}`,
    // Upsert (create or update) a currency exchange record
    upsert: '/api/currency-exchange',
    // Delete by record name/identifier
    delete: (name) => `/api/currency-exchange/${encodeURIComponent(name)}`,
  },

  // Price list automation endpoints
  priceListAutomation: {
    base: '/api/price-list-automation',
    settings: '/api/price-list-automation/settings',
    // Helper to address formulas/settings for a specific price list
    formulas: (priceListName) => `/api/price-list-automation/settings/${encodeURIComponent(priceListName)}`,
    // Endpoint to apply formulas in bulk
    bulkApply: '/api/price-list-automation/apply',
    // Helper to query automation config by company (keeps backward compatibility)
    byCompany: (company) => `/api/price-list-automation?company=${encodeURIComponent(company)}`,
  },

  calculator: {
    formulaHistory: '/api/calculator/formula-history',
  },

  reports: {
    iva: '/api/reports/iva',
    percepciones: '/api/reports/percepciones',
  },

  // Credit/Debit notes routes
  creditDebitNotes: '/api/credit-debit-notes',
  creditDebitNote: '/api/credit-debit-notes/',
  creditDebitNotesMultiMake: '/api/credit-debit-notes/multi-make',

  // Pagos routes
  pagos: '/api/pagos',

  // Payment terms routes
  paymentTermsTemplates: '/api/payment-terms-templates',
  paymentTermsListWithDetails: '/api/payment-terms-list-with-details',
  paymentTermsTemplateDetails: '/api/payment-terms-templates/',
  createStandardPaymentTerms: '/api/create-standard-payment-terms',

  // Groups routes
  customerGroups: '/api/customer-groups',
  supplierGroups: '/api/supplier-groups',

  // Addresses routes
  customerAddresses: '/api/customers/',
  addresses: '/api/addresses',
  addressDetails: '/api/addresses/',

  // Comprobantes routes
  comprobantes: '/api/comprobantes',
  determineComprobanteOptions: '/api/comprobantes/determine-options',

  // Document formats (print/email templates)
  documentFormats: {
    base: '/api/document-formats',
    template: (docKey) => `/api/document-formats/${encodeURIComponent(docKey)}`,
    preview: (docKey) => `/api/document-formats/${encodeURIComponent(docKey)}/preview`,
    emailTemplate: (docKey) => `/api/document-formats/${encodeURIComponent(docKey)}/email-template`,
    letterhead: '/api/document-formats/letterhead',
    logo: '/api/document-formats/logo',
    pdf: (docType, name) =>
      `/api/document-formats/${encodeURIComponent(docType)}/pdf/${encodeURIComponent(name)}`,
  },

  // AFIP lookup routes
  afipData: '/api/afip/afip-data/',

  // Reconciliation routes
  reconcile: '/api/reconcile',
  reconcileCreditNote: '/api/reconcile/credit-note',
  reconcileMultiDocument: '/api/reconcile/multi-document',
  reconciliations: (customer, company) => `/api/reconciliations?customer=${encodeURIComponent(customer)}&company=${encodeURIComponent(company)}`,
  customerReconciliations: (customer, company) => `/api/reconciliations?customer=${encodeURIComponent(customer)}&company=${encodeURIComponent(company)}`,

  // Supplier Reconciliation routes
  supplierReconciliations: (supplier, company) => `/api/supplier-reconciliations?supplier=${encodeURIComponent(supplier)}&company=${encodeURIComponent(company)}`,
  supplierReconcileMultiDocument: '/api/supplier-reconcile/multi-document',

  // Inventory routes
  inventory: '/api/inventory',
  inventoryKits: '/api/inventory/kits',
  inventoryKitByName: (kit) => `/api/inventory/kits/${encodeURIComponent(kit)}`,
  inventoryKitMovements: (kit) => `/api/inventory/kits/${encodeURIComponent(kit)}/movements`,
  bulkImportItems: '/api/inventory/items/bulk-import',
  bulkImportItemsWithIva: '/api/items/bulk-import-with-iva',
  quickCreateItem: '/api/inventory/items/quick-create',
  bulkUpdateItemsWithDefaults: '/api/inventory/items/bulk-update-with-defaults',
  bulkFetchItems: '/api/inventory/items/bulk-fetch',
  bulkDeleteItems: '/api/inventory/items/bulk-delete',
  bulkUpdateValuationRates: '/api/inventory/items/bulk-update-valuation-rates',
  
  // ERPNext Server Scripts routes
  erpnextScripts: {
    checkEnabled: '/api/erpnext-scripts/check-enabled',
    ensureBulkIva: '/api/erpnext-scripts/ensure-bulk-iva',
    bulkUpdateIva: '/api/erpnext-scripts/bulk-update-iva'
  },
  
  uoms: '/api/inventory/uoms',
  
  // Brands routes
  brands: '/api/brands',
  
  // Warehouses routes
  warehouses: '/api/inventory/warehouses', // LEGACY: Use configWarehousesMerged instead
  warehouse: '/api/inventory/warehouses/',
  warehouseTypes: '/api/inventory/warehouse-types',
  
  // Warehouse configuration routes (merged views)
  configWarehousesMerged: '/api/config/warehouses/merged',
  configWarehousesEnsure: '/api/config/warehouses/ensure',
  
  // Stock warehouse routes
  stockWarehouseTabs: '/api/stock/warehouse-tabs',
  stockWarehouseTabItems: '/api/stock/warehouse-tab-items',
  stockTransfer: '/api/stock/transfer',
  warehouseTransfer: '/api/stock/warehouse-transfer',
  itemWarehouseQty: '/api/stock/item-warehouse-qty',
  
  // Remitos routes
  remitos: '/api/remitos',
  bulkRemitosRemoval: '/api/remitos/bulk-removal',
  supplierPurchaseReceipts: (supplierName, page = 1, pageSize = 20, docstatus) => {
    let url = `/api/suppliers/${encodeURIComponent(supplierName)}/purchase-receipts?page=${page}&page_size=${pageSize}`
    if (docstatus !== undefined && docstatus !== null) {
      url += `&docstatus=${encodeURIComponent(docstatus)}`
    }
    return url
  },
  remitoByName: (remitoName) => `/api/remitos/${encodeURIComponent(remitoName)}`,
  salesRemitos: '/api/sales-remitos',
  salesRemitoByName: (remitoName) => `/api/sales-remitos/${encodeURIComponent(remitoName)}`,
  talonarioNextRemitoNumber: (talonarioName) => `/api/talonarios/${encodeURIComponent(talonarioName)}/next-remito-number`,
  customerDeliveryNotes: (customerName, page = 1, pageSize = 20) => `/api/customers/${encodeURIComponent(customerName)}/delivery-notes?page=${page}&page_size=${pageSize}`,
  salesQuotations: '/api/sales-quotations',
  salesQuotationByName: (name) => `/api/sales-quotations/${encodeURIComponent(name)}`,
  customerSalesOrders: (customerName, page = 1, pageSize = 20, company, hideBilled = true) => {
    const params = new URLSearchParams({
      status: 'open',
      page: page.toString(),
      limit: pageSize.toString(),
      hide_billed: hideBilled ? '1' : '0'
    })
    if (customerName) {
      params.append('customer', customerName)
    }
    if (company) {
      params.append('company', company)
    }
    return `/api/sales-orders?${params.toString()}`
  },
  purchaseOrders: '/api/purchase-orders',
  purchaseOrderByName: (name) => `/api/purchase-orders/${encodeURIComponent(name)}`,
  purchaseOrderCancel: (name) => `/api/purchase-orders/${encodeURIComponent(name)}/cancel`,
  supplierPurchaseOrders: (supplierName, page = 1, pageSize = 20, company, docstatus) => {
    let url = `/api/suppliers/${encodeURIComponent(supplierName)}/purchase-orders?page=${page}&page_size=${pageSize}`
    if (company) {
      url += `&company=${encodeURIComponent(company)}`
    }
    if (docstatus !== undefined && docstatus !== null) {
      url += `&docstatus=${encodeURIComponent(docstatus)}`
    }
    return url
  },
  purchaseOrderSuggestions: (supplierName, company) => `/api/purchase-orders/suggestions?supplier=${encodeURIComponent(supplierName)}&company=${encodeURIComponent(company)}`,
  documentLinking: {
    make: '/api/document-linking/make'
  },

  // Subscriptions routes
  subscriptions: '/api/subscriptions',
  subscriptionsBulk: '/api/subscriptions/bulk',
  subscriptionsBulkCancel: '/api/subscriptions/bulk-cancel',
  subscriptionCustomers: '/api/subscriptions/customers',
  customerSubscriptions: (customerName) => `/api/customers/${encodeURIComponent(customerName)}/subscriptions`,
  subscriptionPlans: '/api/subscription-plans',
  subscriptionPlansBulk: '/api/subscription-plans/bulk',
  subscriptionByName: (subscriptionName) => `/api/subscriptions/${encodeURIComponent(subscriptionName)}`,

  // Document item search (restricted to provided parent docs)
  salesInvoiceItemsSearch: '/api/sales-invoice-items/search',
  documentItemsSearch: '/api/document-items/search',

  // User preferences routes
  inventoryTabPreference: '/api/user-preferences/inventory-tab',

  // Sales price lists routes
  salesPriceLists: '/api/sales-price-lists',
  salesPriceList: '/api/sales-price-lists/',
  salesPriceListKits: '/api/sales-price-lists/kits',
  calculateSalesFromPurchase: '/api/sales-price-lists/calculate-from-purchase',
  calculateSalesFromCost: '/api/sales-price-lists/calculate-from-cost',
  applySalesFormula: '/api/sales-price-lists/apply-formula',
  bulkSaveSalesPriceList: '/api/sales-price-lists/bulk-save',
  bulkSaveSalesPriceListProgress: '/api/sales-price-lists/bulk-save-progress/',
  salesPriceListImport: '/api/sales-price-lists/import-data',
  salesPriceListImportProgress: '/api/sales-price-lists/import-progress/',
  salesPriceListStatus: '/api/sales-price-lists/',

  // Purchase price lists routes
  purchasePriceLists: '/api/inventory/purchase-price-lists/all',
  supplierPurchasePriceLists: (supplierName) => `/api/inventory/purchase-price-lists/supplier/${encodeURIComponent(supplierName)}`,
  purchasePriceList: '/api/inventory/purchase-price-lists/',
  purchasePriceListPrices: '/api/inventory/purchase-price-lists/',
  purchasePriceListStatus: '/api/inventory/purchase-price-lists/',

  // Price list reports (backend report endpoints)
  priceListReports: {
    base: '/api/reports/price-lists',
    summary: '/api/reports/price-lists/summary',
    missingSalePrices: '/api/reports/price-lists/missing-sale-prices',
    missingPurchasePrices: '/api/reports/price-lists/missing-purchase-prices',
    priceVariance: '/api/reports/price-lists/price-variance',
    recentUpdates: '/api/reports/price-lists/recent-updates',
    // helper to build a missingSalePrices URL with price_list query
    missingSaleFor: (priceList) => `/api/reports/price-lists/missing-sale-prices?price_list=${encodeURIComponent(priceList)}`,
    missingPurchaseFor: (priceList) => `/api/reports/price-lists/missing-purchase-prices?price_list=${encodeURIComponent(priceList)}`,
  },

  // Notifications routes
  notifications: '/api/notifications',

  // User management routes
  users: '/api/users',
  userDetails: '/api/users/',
  userCompanies: '/api/users/',
  roles: '/api/roles',

  // Drive templates routes
  createSalesPriceListTemplate: '/api/create_sales_price_list_template',
  createPurchasePriceListTemplate: '/api/create_purchase_price_list_template',
  getTemplates: '/api/get_templates/',
  fixTemplatePermissions: '/api/fix_template_permissions/',
};

export default API_ROUTES;
