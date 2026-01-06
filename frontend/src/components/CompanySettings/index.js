// Central exports for Company / Configuration related panels
// Exposes CustomerSupplierAccounts and a small exchange-rate sync helper

import CustomerSupplierAccounts from '../configcomponents/CustomerSupplierAccounts'
import { emitExchangeRateUpdated, onExchangeRateUpdated } from './exchangeRateSync'

export { CustomerSupplierAccounts, emitExchangeRateUpdated, onExchangeRateUpdated }

export default CustomerSupplierAccounts
