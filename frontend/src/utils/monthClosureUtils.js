/**
 * Utilidades para gestión de cierre mensual de cuentas bancarias
 */

/**
 * Formatea un valor monetario en formato argentino
 */
export const formatCurrency = (value) => {
  if (value === null || value === undefined) return '$0.00'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2
  }).format(value)
}

/**
 * Formatea el nombre del mes en español
 */
export const formatMonthName = (month) => {
  const months = {
    1: 'Enero',
    2: 'Febrero',
    3: 'Marzo',
    4: 'Abril',
    5: 'Mayo',
    6: 'Junio',
    7: 'Julio',
    8: 'Agosto',
    9: 'Septiembre',
    10: 'Octubre',
    11: 'Noviembre',
    12: 'Diciembre'
  }
  return months[month] || `Mes ${month}`
}

/**
 * Obtiene el último día de un mes
 */
export const getLastDayOfMonth = (year, month) => {
  const date = new Date(year, month, 0)
  return date.getDate()
}

/**
 * Formatea una fecha en formato YYYY-MM-DD
 */
export const formatDate = (year, month, day) => {
  const monthStr = month.toString().padStart(2, '0')
  const dayStr = day.toString().padStart(2, '0')
  return `${year}-${monthStr}-${dayStr}`
}

/**
 * Obtiene el primer día del mes en formato YYYY-MM-DD
 */
export const getFirstDayOfMonthStr = (year, month) => {
  return formatDate(year, month, 1)
}

/**
 * Obtiene el último día del mes en formato YYYY-MM-DD
 */
export const getLastDayOfMonthStr = (year, month) => {
  const lastDay = getLastDayOfMonth(year, month)
  return formatDate(year, month, lastDay)
}

/**
 * Verifica si dos saldos coinciden (con tolerancia de centavos)
 */
export const balancesMatch = (balance1, balance2, tolerance = 0.01) => {
  return Math.abs(balance1 - balance2) < tolerance
}

/**
 * Calcula la diferencia entre dos saldos
 */
export const calculateBalanceDifference = (balance1, balance2) => {
  return Math.abs(balance1 - balance2)
}

/**
 * Determina si un mes está cerrado basado en la fecha de cierre
 */
export const isMonthClosed = (year, month, lockDate) => {
  if (!lockDate) return false
  
  const lastDay = getLastDayOfMonthStr(year, month)
  const lastDayDate = new Date(lastDay)
  const lockDateObj = new Date(lockDate)
  
  return lastDayDate <= lockDateObj
}

/**
 * Agrupa meses por año
 */
export const groupMonthsByYear = (months) => {
  const grouped = {}
  
  months.forEach(month => {
    if (!grouped[month.year]) {
      grouped[month.year] = []
    }
    grouped[month.year].push(month)
  })
  
  return grouped
}

/**
 * Ordena meses de más reciente a más antiguo
 */
export const sortMonthsDescending = (months) => {
  return [...months].sort((a, b) => {
    if (a.year !== b.year) {
      return b.year - a.year
    }
    return b.month - a.month
  })
}

/**
 * Ordena meses de más antiguo a más reciente
 */
export const sortMonthsAscending = (months) => {
  return [...months].sort((a, b) => {
    if (a.year !== b.year) {
      return a.year - b.year
    }
    return a.month - b.month
  })
}

/**
 * Filtra meses que no están cerrados
 */
export const filterOpenMonths = (months) => {
  return months.filter(month => !month.is_closed)
}

/**
 * Filtra meses que están cerrados
 */
export const filterClosedMonths = (months) => {
  return months.filter(month => month.is_closed)
}

/**
 * Obtiene el mes más reciente de una lista
 */
export const getMostRecentMonth = (months) => {
  if (!months || months.length === 0) return null
  
  const sorted = sortMonthsDescending(months)
  return sorted[0]
}

/**
 * Obtiene el mes más antiguo de una lista
 */
export const getOldestMonth = (months) => {
  if (!months || months.length === 0) return null
  
  const sorted = sortMonthsAscending(months)
  return sorted[0]
}

/**
 * Valida si se puede cerrar un mes (sin meses abiertos anteriores)
 */
export const canCloseMonth = (targetMonth, allMonths) => {
  const openMonths = filterOpenMonths(allMonths)
  
  // Verificar si hay meses abiertos anteriores al que queremos cerrar
  const hasOpenPreviousMonths = openMonths.some(month => {
    if (month.year < targetMonth.year) return true
    if (month.year === targetMonth.year && month.month < targetMonth.month) return true
    return false
  })
  
  return !hasOpenPreviousMonths
}

/**
 * Genera un mensaje de error descriptivo para cierre de mes
 */
export const getCloseMonthError = (targetMonth, allMonths) => {
  if (!canCloseMonth(targetMonth, allMonths)) {
    return 'No se puede cerrar este mes porque hay meses anteriores que aún están abiertos. Debe cerrar los meses en orden cronológico.'
  }
  return null
}

/**
 * Obtiene estadísticas de cierre de meses
 */
export const getMonthClosureStats = (months) => {
  const total = months.length
  const closed = filterClosedMonths(months).length
  const open = filterOpenMonths(months).length
  const percentClosed = total > 0 ? (closed / total) * 100 : 0
  
  return {
    total,
    closed,
    open,
    percentClosed: Math.round(percentClosed)
  }
}

/**
 * Formatea una fecha de cierre para mostrar
 */
export const formatLockDate = (lockDate) => {
  if (!lockDate) return 'Sin fecha de cierre'
  
  const date = new Date(lockDate)
  const day = date.getDate()
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  
  return `${day}/${month}/${year}`
}

/**
 * Genera el texto para el motivo de cierre
 */
export const generateLockReason = (year, month) => {
  const monthName = formatMonthName(month)
  return `Conciliación cerrada ${monthName}/${year}`
}
