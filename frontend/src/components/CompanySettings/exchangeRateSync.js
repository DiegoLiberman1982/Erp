// Lightweight helpers to emit and listen to exchange rate updates across panels
// This is a small wrapper around window CustomEvent so other modules can import
// and use a single API instead of directly manipulating window events.

export function emitExchangeRateUpdated(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent('exchangeRateUpdated', { detail }))
  } catch (err) {
    // Some older environments may restrict CustomEvent constructor; fallback
    const evt = document.createEvent('CustomEvent')
    evt.initCustomEvent('exchangeRateUpdated', true, true, detail)
    window.dispatchEvent(evt)
  }
}

export function onExchangeRateUpdated(callback) {
  const handler = (ev) => {
    // ev.detail contains the payload
    try {
      callback(ev.detail)
    } catch (e) {
      // swallow callback errors to avoid breaking global handler
      // caller should handle their own errors
      // console.error(e)
    }
  }
  window.addEventListener('exchangeRateUpdated', handler)
  return () => window.removeEventListener('exchangeRateUpdated', handler)
}

export default {
  emitExchangeRateUpdated,
  onExchangeRateUpdated
}
