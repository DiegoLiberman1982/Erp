// loggingSetup.js
// Central logging control for the frontend during development.
// Logging is now restored to normal - all console methods work as expected.

(() => {
  if (typeof window === 'undefined') return

  // Save originals (for potential future use)
  if (!window.__origConsole) {
    window.__origConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console)
    }
  }

  // Logging is now restored - no methods are silenced
  // console.log, console.info, console.debug, console.warn, console.error all work normally

  // Remove the icon logger since it's no longer needed
  // window.__iconLogger is removed

  // Also remove the restore function since logging is already normal
  // window.__restoreLogging is removed
})()
