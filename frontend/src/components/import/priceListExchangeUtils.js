/**
 * Helper utilities to normalize and prepare price list exchange-rate data
 * Shared by PurchasePriceListTemplate and SalesPriceListManager.
 *
 * Conventions:
 * - ERPNext stores a "custom_exchange_rate" numeric. The system uses -1 to
 *   indicate "use global/system exchange rate" (general mode).
 * - In the UI we expose `exchangeRateMode` with values: 'specific' | 'general'.
 *
 * Exported functions:
 * - normalizePriceListData(priceList, globalRate)
 *   -> returns a shallow copy with `exchangeRateMode` and `displayExchangeRate` added.
 * - getDisplayExchangeRate(priceList, globalRate)
 *   -> returns the effective numeric exchange rate to show/use.
 * - prepareCustomExchangeForSave(exchangeRateMode, exchangeRate)
 *   -> converts UI values into the numeric `custom_exchange_rate` for backend
 *      (returns -1 for general, number >= 0 for specific). Throws on invalid specific.
 */

/**
 * Normalize a price list object received from backend so components can consume
 * consistent fields.
 *
 * @param {Object} priceList - object coming from backend (may contain custom_exchange_rate)
 * @param {number|string} globalRate - numeric global exchange rate to use when mode=general
 * @returns {Object} shallow copy including: exchangeRateMode ('specific'|'general'), displayExchangeRate (number)
 */
export function normalizePriceListData(priceList = {}, globalRate = 1) {
  const out = { ...priceList }
  const raw = priceList.custom_exchange_rate ?? priceList.exchange_rate ?? null

  // Treat string numbers as numbers
  const parsed = raw === null || raw === undefined ? null : parseFloat(raw)

  if (parsed === -1) {
    out.exchangeRateMode = 'general'
    out.displayExchangeRate = Number(globalRate) || 0
  } else if (parsed !== null && !Number.isNaN(parsed)) {
    out.exchangeRateMode = 'specific'
    out.displayExchangeRate = parsed
  } else {
    // If backend did not send any value, default to specific with provided exchange_rate or global
    out.exchangeRateMode = 'specific'
    out.displayExchangeRate = parsed === null ? Number(globalRate) || 0 : parsed
  }

  return out
}

/**
 * Return the effective exchange rate to display/use for a price list.
 * If the priceList indicates general mode (custom_exchange_rate === -1 or exchangeRateMode === 'general')
 * the function returns the provided globalRate.
 *
 * @param {Object} priceList - may include custom_exchange_rate or exchangeRateMode/displayExchangeRate
 * @param {number|string} globalRate
 * @returns {number}
 */
export function getDisplayExchangeRate(priceList = {}, globalRate = 1) {
  if (!priceList) return Number(globalRate) || 0

  // Prefer explicit exchangeRateMode if present
  if (priceList.exchangeRateMode === 'general') return Number(globalRate) || 0
  if (priceList.exchangeRateMode === 'specific') return Number(priceList.displayExchangeRate ?? priceList.custom_exchange_rate ?? priceList.exchange_rate ?? globalRate) || 0

  // Fallback to raw custom_exchange_rate logic
  const raw = priceList.custom_exchange_rate ?? priceList.exchange_rate
  const parsed = raw === undefined || raw === null ? null : parseFloat(raw)
  if (parsed === -1) return Number(globalRate) || 0
  if (parsed !== null && !Number.isNaN(parsed)) return parsed

  return Number(globalRate) || 0
}

/**
 * Prepare the numeric value that should be stored in `custom_exchange_rate` when saving.
 * - If exchangeRateMode === 'general' -> return -1
 * - If 'specific' -> parse exchangeRate to number and validate >= 0
 *
 * @param {'specific'|'general'} exchangeRateMode
 * @param {number|string} exchangeRate
 * @returns {number}
 * @throws {Error} when specific mode has invalid (non-numeric or negative) value
 */
export function prepareCustomExchangeForSave(exchangeRateMode, exchangeRate) {
  if (exchangeRateMode === 'general') return -1

  // specific
  const parsed = typeof exchangeRate === 'number' ? exchangeRate : parseFloat(String(exchangeRate).replace(/,/g, '.'))
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error('exchangeRate must be a number >= 0 for specific mode')
  }
  return parsed
}

/**
 * Convenience mapper used by save handlers to translate UI fields to backend fields.
 * Returns an object with the backend-ready fields (e.g. currency and custom_exchange_rate).
 *
 * @param {Object} opts
 * @param {'specific'|'general'} opts.exchangeRateMode
 * @param {number|string} opts.exchangeRate
 * @param {string} [opts.currency]
 * @returns {Object}
 */
export function mapPriceListMetaForBackend({ exchangeRateMode, exchangeRate, currency }) {
  const meta = {}
  if (currency !== undefined) meta.currency = currency
  meta.custom_exchange_rate = prepareCustomExchangeForSave(exchangeRateMode, exchangeRate)
  return meta
}

export default {
  normalizePriceListData,
  getDisplayExchangeRate,
  prepareCustomExchangeForSave,
  mapPriceListMetaForBackend
}
