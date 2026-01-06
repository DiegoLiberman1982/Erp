// --- Utilidades para preparar datos de remitos antes de abrir el modal ---
import API_ROUTES from '../apiRoutes.js'
import { normalizeRemitoData } from '../components/modals/RemitoModal/remitoModalUtils.js'

const LOG_PREFIX = '🧩 [RemitoDataPreparation]'

const ensureSuccessResponse = async (response) => {
  if (!response.ok) {
    let errorMessage = 'Error al cargar remito'
    try {
      const errorData = await response.json()
      errorMessage = errorData.message || errorMessage
    } catch (_) {}
    throw new Error(errorMessage)
  }

  const payload = await response.json()
  if (!payload.success || !payload.remito) {
    throw new Error(payload.message || 'No se encontraron datos del remito')
  }

  return payload.remito
}

export const fetchRemitoRecord = async (remitoName, fetchWithAuth) => {
  const response = await fetchWithAuth(API_ROUTES.remitoByName(remitoName))
  return ensureSuccessResponse(response)
}

export const prepareRemitoModalPayload = async (remitoName, fetchWithAuth) => {
  console.log(`${LOG_PREFIX} Preparando datos para`, remitoName)
  const remitoRecord = await fetchRemitoRecord(remitoName, fetchWithAuth)

  const normalizedFormData = normalizeRemitoData(remitoRecord)

  const payload = {
    name: remitoRecord.name,
    remito: remitoRecord,
    normalizedFormData,
    summary: {
      supplier: remitoRecord.supplier,
      posting_date: remitoRecord.posting_date,
      items: remitoRecord.items?.length || 0,
      status: normalizedFormData.status
    }
  }

  console.log(`${LOG_PREFIX} Datos listos`, {
    name: payload.name,
    items: payload.summary.items,
    status: payload.summary.status
  })

  return payload
}
