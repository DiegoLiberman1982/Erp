import React from 'react'
import { Calculator, Plus, CloudDownload } from 'lucide-react'

export default function TreasuryAccountsList({
  loading,
  treasuryAccounts,
  selectedTreasuryAccount,
  onSelectAccount,
  onAddAccount,
  getAccountTypeIcon,
  getAccountTypeLabel,
  handleMercadoPagoSync,
  syncingMercadoPago
}) {
  return (
    <div className="bg-white/70 backdrop-blur-xl shadow-2xl rounded-3xl border border-gray-200/30 overflow-hidden flex flex-col">
      <div className="accounting-card-title">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <Calculator className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-black text-gray-900">Cuentas de Tesorería</h3>
          </div>
          <button
            onClick={onAddAccount}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-bold rounded-xl text-white bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-600 hover:to-gray-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105"
          >
            <Plus className="w-4 h-4 mr-2" />
            Nueva
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">Cargando cuentas...</span>
          </div>
        ) : (
          <div className="space-y-2">
            {treasuryAccounts.map(account => {
              const accountKey = account.id
              return (
                <div
                  key={accountKey}
                  className={`flex items-center justify-between py-3 px-4 rounded-lg cursor-pointer transition-all duration-200 hover:bg-gray-50 ${
                    selectedTreasuryAccount === accountKey ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                  }`}
                  onClick={() => onSelectAccount(accountKey)}
                >
                  <div className="flex items-center gap-3">
                    {getAccountTypeIcon(account.type)}
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {account.bank_account_name || account.mode_of_payment}
                      </div>
                      <div className="text-xs text-gray-500">
                        {getAccountTypeLabel(account.type)}
                      </div>
                    </div>
                  </div>
                  {account.is_mercadopago_bank && (
                    <button
                      type="button"
                      className="action-chip"
                      style={{ '--chip-accent': 'linear-gradient(135deg, #059669, #10b981)' }}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleMercadoPagoSync({ trigger: 'quick-card', account })
                      }}
                      disabled={syncingMercadoPago}
                    >
                      <span className="action-chip-icon">
                        <CloudDownload className="action-chip-icon-svg" />
                      </span>
                      <span className="action-chip-body">
                        <span className="action-chip-label">Mercado Pago</span>
                        <span className="action-chip-value">Sincronizar</span>
                      </span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
