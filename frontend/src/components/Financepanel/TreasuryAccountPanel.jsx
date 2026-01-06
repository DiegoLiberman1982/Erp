import React from 'react'
import Select from 'react-select'
import CreatableSelect from 'react-select/creatable'
import { FileText, Edit, Trash2, Save, CloudDownload } from 'lucide-react'

export default function TreasuryAccountPanel({
  isEditingAccount,
  selectedTreasuryAccount,
  accountDetails,
  handleEditAccount,
  handleDeleteAccount,
  editedAccountData,
  handleEditChange,
  handleCancelEdit,
  handleCreateAccount,
  handleSaveAccount,
  savingAccount,
  loadingAccounts,
  accountingOptions,
  loadingBanks,
  bankOptions,
  getAccountTypeLabel,
  formatBalance,
  handleMercadoPagoAutoSyncToggle,
  updatingMercadoPagoAutoSync,
  syncingMercadoPago,
  handleMercadoPagoSync,
  isMercadoPagoAccount,
  normalizeText
}) {
  const renderTitle = () => {
    if (isEditingAccount && selectedTreasuryAccount === 'new') {
      return 'Nueva Cuenta'
    }
    if (selectedTreasuryAccount) {
      const displayName = accountDetails?.bank_account_name || accountDetails?.account_name || accountDetails?.mode_of_payment || accountDetails?.name
      return `Cuenta: ${displayName}`
    }
    return 'Selecciona una cuenta'
  }

  return (
    <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden">
      <div className="accounting-card-title">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-black text-gray-900">{renderTitle()}</h3>
          </div>
          {selectedTreasuryAccount && !isEditingAccount && selectedTreasuryAccount !== 'new' && (
            <div className="flex gap-2">
              <button
                className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100/80 rounded-xl transition-all duration-300"
                title="Editar cuenta"
                onClick={handleEditAccount}
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                className="p-2 text-red-600 hover:text-red-800 hover:bg-red-100/80 rounded-xl transition-all duration-300"
                title="Eliminar cuenta"
                onClick={handleDeleteAccount}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-4">
        {isEditingAccount ? (
          <AccountEditor
            editedAccountData={editedAccountData}
            handleEditChange={handleEditChange}
            handleCancelEdit={handleCancelEdit}
            handleCreateAccount={handleCreateAccount}
            handleSaveAccount={handleSaveAccount}
            savingAccount={savingAccount}
            selectedTreasuryAccount={selectedTreasuryAccount}
            loadingAccounts={loadingAccounts}
            accountingOptions={accountingOptions}
            loadingBanks={loadingBanks}
            bankOptions={bankOptions}
            normalizeText={normalizeText}
          />
        ) : accountDetails ? (
          <AccountDetails
            accountDetails={accountDetails}
            getAccountTypeLabel={getAccountTypeLabel}
            formatBalance={formatBalance}
            handleMercadoPagoAutoSyncToggle={handleMercadoPagoAutoSyncToggle}
            updatingMercadoPagoAutoSync={updatingMercadoPagoAutoSync}
            syncingMercadoPago={syncingMercadoPago}
            handleMercadoPagoSync={handleMercadoPagoSync}
            isMercadoPagoAccount={isMercadoPagoAccount}
          />
        ) : (
          <div className="text-center py-12 text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Selecciona una cuenta de tesorería para ver sus detalles</p>
          </div>
        )}
      </div>
    </div>
  )
}

function AccountEditor({
  editedAccountData,
  handleEditChange,
  handleCancelEdit,
  handleCreateAccount,
  handleSaveAccount,
  savingAccount,
  selectedTreasuryAccount,
  loadingAccounts,
  accountingOptions,
  loadingBanks,
  bankOptions,
  normalizeText
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de cuenta</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'bank', label: 'Cuenta Bancaria' },
            { value: 'cash', label: 'Caja' },
            { value: 'cheque', label: 'Cheque' },
            { value: 'tarjeta_debito', label: 'Tarjeta Débito' },
            { value: 'tarjeta_credito', label: 'Tarjeta Crédito' }
          ].map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleEditChange('type', option.value)}
              className={`flex items-center justify-center px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ${
                editedAccountData.type === option.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {editedAccountData.type === option.value ? (
                <span className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs mr-2">
                  ✓
                </span>
              ) : (
                <span className="w-4 h-4 rounded-full border border-gray-300 mr-2"></span>
              )}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {editedAccountData.type !== 'cash' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Banco</label>
          {loadingBanks ? (
            <div className="flex items-center justify-center py-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              <span className="ml-2 text-sm text-gray-600">Cargando bancos...</span>
            </div>
          ) : (
            <CreatableSelect
              value={(() => {
                const bankNameToFind = editedAccountData.bank_name ? editedAccountData.bank_name.split(' - ')[0].trim() : ''
                const normalizedBankName = normalizeText(bankNameToFind)
                const foundBank = bankOptions.find((bank) => bank.normalizedName === normalizedBankName)
                if (foundBank) {
                  return { value: foundBank.value, label: foundBank.name }
                }
                if (bankNameToFind) {
                  return { value: editedAccountData.bank_name, label: bankNameToFind }
                }
                return null
              })()}
              onChange={(selectedOption) => {
                console.log('DEBUG: CreatableSelect onChange - selectedOption:', selectedOption)
                const newBankName = selectedOption ? selectedOption.value : ''
                console.log('DEBUG: CreatableSelect onChange - setting bank_name to:', newBankName)
                handleEditChange('bank_name', newBankName)
              }}
              options={bankOptions.map((bank) => ({
                value: bank.value,
                label: bank.name
              }))}
              placeholder="Seleccionar o crear banco"
              isClearable
              isSearchable
              formatCreateLabel={(inputValue) => `Crear banco: "${inputValue}"`}
              className="w-full"
              classNamePrefix="react-select"
              styles={{
                control: (provided, state) => ({
                  ...provided,
                  border: '1px solid #d1d5db',
                  borderRadius: '0.5rem',
                  padding: '0.125rem',
                  '&:hover': {
                    borderColor: '#3b82f6'
                  },
                  boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
                }),
                option: (provided, state) => ({
                  ...provided,
                  backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                  color: state.isSelected ? 'white' : '#374151'
                }),
                menu: (provided) => ({
                  ...provided,
                  zIndex: 99999
                }),
                menuPortal: (provided) => ({
                  ...provided,
                  zIndex: 99999
                })
              }}
              menuPortalTarget={document.body}
            />
          )}
          <p className="mt-2 text-xs text-gray-500">
            Si el banco no existe en la lista, escribe el nombre y presiona Enter para crearlo.
          </p>
        </div>
      )}

      {editedAccountData.type !== 'cash' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Nro. de cuenta</label>
          <input
            type="text"
            value={editedAccountData.account_number || ''}
            onChange={(e) => handleEditChange('account_number', e.target.value)}
            placeholder="Número de cuenta (opcional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Cuenta Contable *</label>
        {loadingAccounts ? (
          <div className="flex items-center justify-center py-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            <span className="ml-2 text-sm text-gray-600">Cargando cuentas...</span>
          </div>
        ) : (
          <Select
            value={accountingOptions.find(opt => opt.value === editedAccountData.accounting_account) || null}
            onChange={(selectedOption) => handleEditChange('accounting_account', selectedOption ? selectedOption.value : '')}
            options={accountingOptions}
            placeholder="Seleccionar cuenta contable"
            isClearable
            isSearchable
            className="w-full"
            classNamePrefix="react-select"
            styles={{
              control: (provided, state) => ({
                ...provided,
                border: '1px solid #d1d5db',
                borderRadius: '0.5rem',
                padding: '0.125rem',
                '&:hover': {
                  borderColor: '#3b82f6'
                },
                boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none'
              }),
              option: (provided, state) => ({
                ...provided,
                backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#eff6ff' : 'white',
                color: state.isSelected ? 'white' : '#374151'
              }),
              menu: (provided) => ({
                ...provided,
                zIndex: 99999
              }),
              menuPortal: (provided) => ({
                ...provided,
                zIndex: 99999
              })
            }}
            menuPortalTarget={document.body}
          />
        )}
        <p className="mt-2 text-xs text-gray-500">
          Solo se listan cuentas contables de tipo {editedAccountData.type === 'cash' ? 'Caja' : 'Bancos'}. Si no ves la cuenta, edítala en el Plan de Cuentas y asignale ese tipo.
        </p>
      </div>

      <div className="flex gap-2 pt-4">
        <button
          onClick={handleCancelEdit}
          disabled={savingAccount}
          className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all duration-300"
        >
          Cancelar
        </button>
        <button
          onClick={selectedTreasuryAccount === 'new' ? handleCreateAccount : handleSaveAccount}
          disabled={savingAccount}
          className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-black rounded-xl text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 disabled:bg-gray-400 disabled:text-white disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
        >
          {savingAccount ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Guardando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Guardar
            </>
          )}
        </button>
      </div>
    </div>
  )
}

function AccountDetails({
  accountDetails,
  getAccountTypeLabel,
  formatBalance,
  handleMercadoPagoAutoSyncToggle,
  updatingMercadoPagoAutoSync,
  syncingMercadoPago,
  handleMercadoPagoSync,
  isMercadoPagoAccount
}) {
  const bankAccountDisplayName = accountDetails.bank_account_name || accountDetails.mode_of_payment || accountDetails.name
  const accountingAccountDisplayName = accountDetails.account_name || accountDetails.accounting_account || accountDetails.name

  return (
    <div className="space-y-3">
      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
        <span className="text-sm font-semibold text-gray-600">Nombre:</span>
        <span className="text-gray-900 font-medium ml-2">{bankAccountDisplayName || 'Sin nombre'}</span>
      </div>
      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
        <span className="text-sm font-semibold text-gray-600">Cuenta contable:</span>
        <span className="text-gray-900 font-medium ml-2">{accountingAccountDisplayName || 'No especificado'}</span>
      </div>
      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
        <span className="text-sm font-semibold text-gray-600">Tipo:</span>
        <span className="text-gray-900 font-medium ml-2">{getAccountTypeLabel(accountDetails.type)}</span>
      </div>
      {(accountDetails.type === 'bank_account' || accountDetails.type === 'credit_card') && (
        <>
          <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
            <span className="text-sm font-semibold text-gray-600">Banco:</span>
            <span className="text-gray-900 font-medium ml-2">{accountDetails.bank_name || 'No especificado'}</span>
          </div>
          <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
            <span className="text-sm font-semibold text-gray-600">Número de cuenta:</span>
            <span className="text-gray-900 font-medium ml-2">{accountDetails.account_number || 'No especificado'}</span>
          </div>
        </>
      )}
      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
        <span className="text-sm font-semibold text-gray-600">Saldo actual:</span>
        <span className="text-gray-900 font-medium ml-2">{formatBalance(accountDetails.balance)}</span>
      </div>
      <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
        <span className="text-sm font-semibold text-gray-600">Moneda:</span>
        <span className={`font-medium ml-2 ${!accountDetails.currency ? 'text-red-600' : 'text-gray-900'}`} title="Este dato se toma de la cuenta contable">
          {accountDetails.currency || '⚠️ Sin moneda configurada'}
        </span>
      </div>
      {accountDetails.description && (
        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
          <span className="text-sm font-semibold text-gray-600">Descripción:</span>
          <span className="text-gray-900 font-medium ml-2">{accountDetails.description}</span>
        </div>
      )}

      {isMercadoPagoAccount && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-orange-900">Sincronización Mercado Pago</p>
              <p className="text-xs text-orange-700">Descarga los movimientos del reporte Account Money para esta cuenta bancaria.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500"
                checked={!!accountDetails.mercadopago_auto_sync}
                onChange={handleMercadoPagoAutoSyncToggle}
                disabled={updatingMercadoPagoAutoSync || syncingMercadoPago}
              />
              Auto Sync
            </label>
          </div>
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <button
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-pink-500 shadow hover:shadow-lg transition disabled:opacity-50"
              onClick={() => handleMercadoPagoSync()}
              disabled={syncingMercadoPago}
            >
              {syncingMercadoPago ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Sincronizando...
                </>
              ) : (
                <>
                  <CloudDownload className="w-4 h-4 mr-2" />
                  Sincronizar movimientos
                </>
              )}
            </button>
            <div className="text-xs text-orange-700">
              {accountDetails.mercadopago_last_sync_at
                ? `Ultima sync: ${new Date(accountDetails.mercadopago_last_sync_at).toLocaleString()}`
                : 'Todavía no se importaron movimientos'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
