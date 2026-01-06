import React from 'react'
import CompanyAddressModal from '../../modals/CompanyAddressModal'
import AddCompanyModal from '../modals/AddCompanyModal'
import TalonarioModal from '../TalonarioModal'
import CostCenterModal from '../modals/CostCenterModal'
import ItemGroupModal from '../modals/ItemGroupModal'
import TaxTemplateModal from '../modals/TaxTemplateModal'
import WarehouseModal from '../modals/WarehouseModal'
import CustomerGroupModal from '../modals/CustomerGroupModal'
import SupplierGroupModal from '../modals/SupplierGroupModal'
import GroupItemsModal from '../modals/GroupItemsModal'
import EmailAccountModal from '../modals/EmailAccountModal'
import TestEmailModal from '../modals/TestEmailModal'
import ExchangeRateHistoryModal from '../ExchangeRateHistoryModal'

const ModalsContainer = ({
  // CompanyAddressModal props
  companyAddressModal,
  setCompanyAddressModal,
  activeCompanyFromContext,
  fetchWithAuth,
  fetchAccountsSettings,

  // AddCompanyModal props
  isAddCompanyModalOpen,
  setIsAddCompanyModalOpen,
  newCompany,
  handleNewCompanyChange,
  handleSearchAfipCompany,
  handleCreateCompany,
  consultingAfip,

  // TalonarioModal props
  isTalonarioModalOpen,
  handleCloseTalonarioModal,
  selectedTalonarioForModal,
  handleTalonarioSave,

  // CostCenterModal props
  isCostCenterModalOpen,
  handleCloseCostCenterModal,
  newCostCenter,
  setNewCostCenter,
  handleParentCostCenterInputChange,
  showParentDropdown,
  setShowParentDropdown,
  parentCostCenters,
  selectParentCostCenter,
  handleCreateCostCenter,
  creatingCostCenter,

  // ItemGroupModal props
  isItemGroupModalOpen,
  handleCloseItemGroupModal,
  newItemGroup,
  setNewItemGroup,
  handleParentItemGroupInputChange,
  showParentItemGroupDropdown,
  setShowParentItemGroupDropdown,
  parentItemGroups,
  selectParentItemGroup,
  handleCreateItemGroup,
  creatingItemGroup,

  // TaxTemplateModal props
  editingTemplate,
  setEditingTemplate,
  updateTemplateTaxAccount,
  saveTemplateChanges,
  saving,
  taxAccounts,
  extractCleanAccountName,
  getAccountDisplayName,

  // WarehouseModal props
  isWarehouseModalOpen,
  handleCloseWarehouseModal,
  editingWarehouse,
  warehouseFormData,
  setWarehouseFormData,
  handleSaveWarehouse,
  savingWarehouse,
  warehouseTypes,
  warehouses,
  activeCompanyDetails,

  // CustomerGroupModal props
  showCustomerGroupModal,
  closeCustomerGroupModal,
  editingGroup,
  groupFormData,
  setGroupFormData,
  handleSaveGroup,
  savingGroup,
  customerGroups,
  salesPriceLists,
  availableIncomeAccounts,
  paymentTermsTemplates,
  extractAccountName,

  // SupplierGroupModal props
  showSupplierGroupModal,
  closeSupplierGroupModal,
  supplierGroups,
  availableExpenseAccounts,

  // GroupItemsModal props
  isGroupItemsModalOpen,
  handleCloseGroupItemsModal,
  selectedItemGroups,
  targetParentGroup,
  setTargetParentGroup,
  handleGroupItems,
  groupingItems,
  itemGroups,

  // EmailAccountModal props
  isEmailAccountModalOpen,
  handleCloseEmailAccountModal,
  editingEmailAccount,
  setEmailAccountsRefreshTrigger,
  showNotification,

  // TestEmailModal props
  testEmailModalData,
  handleCloseTestEmailModal,
  handleTestEmail,
  testingEmail
  ,
  // ExchangeRateHistoryModal props
  isExchangeHistoryOpen,
  closeExchangeHistoryModal,
  exchangeHistoryCurrency,
  onExchangeHistorySaved
}) => {
  return (
    <>
      {/* Modal de direcciones de compañía (controlado por este nivel) */}
      <CompanyAddressModal
        isOpen={companyAddressModal.open}
        onClose={() => setCompanyAddressModal({ open: false, companyName: null })}
        companyName={companyAddressModal.companyName}
        onSave={async (addressData) => {
          // cerrar modal y refrescar detalles
          setCompanyAddressModal({ open: false, companyName: null })
          if (activeCompanyFromContext) {
            try { await fetchWithAuth(`/api/companies/${encodeURIComponent(activeCompanyFromContext)}`) } catch(e){}
            // re-fetch accounts/settings if needed
            fetchAccountsSettings()
          }
        }}
      />

      {/* Modal para agregar nueva empresa (controlado por ConfigurationSettings) */}
      <AddCompanyModal
        isOpen={isAddCompanyModalOpen}
        onClose={() => setIsAddCompanyModalOpen(false)}
        newCompany={newCompany}
        onCompanyChange={handleNewCompanyChange}
        onSearchAfip={handleSearchAfipCompany}
        onCreateCompany={handleCreateCompany}
        consultingAfip={consultingAfip}
      />

      {/* Modal para talonarios */}
      <TalonarioModal
        isOpen={isTalonarioModalOpen}
        onClose={handleCloseTalonarioModal}
        talonario={selectedTalonarioForModal}
        onSave={handleTalonarioSave}
      />

      {/* Modal para crear centro de costo */}
      <CostCenterModal
        isOpen={isCostCenterModalOpen}
        onClose={handleCloseCostCenterModal}
        newCostCenter={newCostCenter}
        onCostCenterChange={setNewCostCenter}
        onParentInputChange={handleParentCostCenterInputChange}
        onParentFocus={() => setShowParentDropdown(true)}
        onParentBlur={() => setTimeout(() => setShowParentDropdown(false), 200)}
        showParentDropdown={showParentDropdown}
        parentCostCenters={parentCostCenters}
        onSelectParent={selectParentCostCenter}
        onCreate={handleCreateCostCenter}
        creating={creatingCostCenter}
      />

      {/* Modal para crear grupo de items */}
      <ItemGroupModal
        isOpen={isItemGroupModalOpen}
        onClose={handleCloseItemGroupModal}
        newItemGroup={newItemGroup}
        onItemGroupChange={setNewItemGroup}
        onParentInputChange={handleParentItemGroupInputChange}
        onParentFocus={() => setShowParentItemGroupDropdown(true)}
        onParentBlur={() => setTimeout(() => setShowParentItemGroupDropdown(false), 200)}
        showParentDropdown={showParentItemGroupDropdown}
        parentItemGroups={parentItemGroups}
        onSelectParent={selectParentItemGroup}
        onCreate={handleCreateItemGroup}
        creating={creatingItemGroup}
      />

      {/* Modal de edición de template de impuestos */}
      <TaxTemplateModal
        isOpen={!!editingTemplate}
        editingTemplate={editingTemplate}
        onClose={() => setEditingTemplate(null)}
        onUpdateAccount={updateTemplateTaxAccount}
        onSave={saveTemplateChanges}
        saving={saving}
        taxAccounts={taxAccounts}
        extractCleanAccountName={extractCleanAccountName}
        getAccountDisplayName={getAccountDisplayName}
      />

      {/* Modal para crear/editar warehouse */}
      <WarehouseModal
        isOpen={isWarehouseModalOpen}
        onClose={handleCloseWarehouseModal}
        editingWarehouse={editingWarehouse}
        warehouseFormData={warehouseFormData}
        onFormChange={setWarehouseFormData}
        onSave={handleSaveWarehouse}
        saving={savingWarehouse}
        warehouseTypes={warehouseTypes}
        warehouses={warehouses}
        activeCompanyDetails={activeCompanyDetails}
      />

      {/* Modal para grupos de clientes */}
      <CustomerGroupModal
        isOpen={showCustomerGroupModal}
        onClose={closeCustomerGroupModal}
        editingGroup={editingGroup}
        groupFormData={groupFormData}
        onFormChange={setGroupFormData}
        onSave={handleSaveGroup}
        saving={savingGroup}
        customerGroups={customerGroups}
        salesPriceLists={salesPriceLists}
        availableIncomeAccounts={availableIncomeAccounts}
        paymentTermsTemplates={paymentTermsTemplates}
        extractAccountName={extractAccountName}
      />

      {/* Modal para grupos de proveedores */}
      <SupplierGroupModal
        isOpen={showSupplierGroupModal}
        onClose={closeSupplierGroupModal}
        editingGroup={editingGroup}
        groupFormData={groupFormData}
        onFormChange={setGroupFormData}
        onSave={handleSaveGroup}
        saving={savingGroup}
        supplierGroups={supplierGroups}
        availableExpenseAccounts={availableExpenseAccounts}
        paymentTermsTemplates={paymentTermsTemplates}
        extractAccountName={extractAccountName}
      />

      {/* Historial de cotizaciones (Exchange Rate) */}
      <ExchangeRateHistoryModal
        isOpen={!!isExchangeHistoryOpen}
        onClose={closeExchangeHistoryModal}
        currency={exchangeHistoryCurrency}
        toCurrency={activeCompanyDetails?.default_currency || ''}
        onSaved={onExchangeHistorySaved}
      />

      {/* Modal para agrupar grupos de items */}
      <GroupItemsModal
        isOpen={isGroupItemsModalOpen}
        onClose={handleCloseGroupItemsModal}
        selectedItemGroups={selectedItemGroups}
        targetParentGroup={targetParentGroup}
        onTargetChange={setTargetParentGroup}
        onGroup={handleGroupItems}
        grouping={groupingItems}
        itemGroups={itemGroups}
      />

      {/* Modal para crear/editar cuenta de email */}
      <EmailAccountModal
        isOpen={isEmailAccountModalOpen}
        onClose={handleCloseEmailAccountModal}
        editingEmailAccount={editingEmailAccount}
        onSave={() => {
          // Refrescar la lista de cuentas de email
          setEmailAccountsRefreshTrigger(prev => prev + 1)
        }}
        fetchWithAuth={fetchWithAuth}
        showSuccess={showNotification}
        showError={showNotification}
      />

      {/* Modal para probar email */}
      <TestEmailModal
        isOpen={testEmailModalData.isOpen}
        onClose={handleCloseTestEmailModal}
        emailAccount={testEmailModalData.emailAccount}
        onTest={handleTestEmail}
        testing={testingEmail}
      />
    </>
  )
}

export default ModalsContainer
