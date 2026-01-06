import API_ROUTES from '../apiRoutes.js'
import { normalizeSalesRemitoData } from '../components/modals/SalesRemitoModal/salesRemitoModalUtils.js'

const LOG_PREFIX = '🟣 [SalesRemitoDataPrep]'

const ensureSuccessResponse = async (response) => {
  if (!response.ok) {
    let errorMessage = 'Error al cargar remito'
    try {
      const errorData = await response.json()
      errorMessage = errorData.message || errorMessage
    } catch (error) {
      console.error(`${LOG_PREFIX} Error parsing response`, error)
    }
    throw new Error(errorMessage)
  }

  const payload = await response.json()
  if (!payload.success || !payload.remito) {
    throw new Error(payload.message || 'No se encontraron datos del remito')
  }

  return payload.remito
}

export const fetchSalesRemitoRecord = async (remitoName, fetchWithAuth) => {
  const response = await fetchWithAuth(API_ROUTES.salesRemitoByName(remitoName))
  return ensureSuccessResponse(response)
}

export const prepareSalesRemitoModalPayload = async (remitoName, fetchWithAuth) => {
  console.log(`${LOG_PREFIX} Preparando datos para`, remitoName)
  const remitoRecord = await fetchSalesRemitoRecord(remitoName, fetchWithAuth)
  const normalizedFormData = normalizeSalesRemitoData(remitoRecord)

  return {
    name: remitoRecord.name,
    remito: remitoRecord,
    normalizedFormData,
    summary: {
      customer: remitoRecord.customer,
      posting_date: remitoRecord.posting_date,
      items: remitoRecord.items?.length || 0,
      status: normalizedFormData.status
    }
  }
}
