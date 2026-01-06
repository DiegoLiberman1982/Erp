// --- COMPONENTE PARA EL RESUMEN LATERAL ---
import { Save, X, Loader2, Link2 } from 'lucide-react'
import { calculateTotals } from './remitoModalUtils.js'

const RemitoSummary = ({
  formData,
  isLoading,
  onSave,
  onClose,
  isEditing,
  onLinkDocuments,
  linkDocumentsDisabled = false
}) => {
  const totals = calculateTotals(formData.items)
  const statusLower = String(formData?.status || '').toLowerCase()
  const isReturn = statusLower.includes('devoluci')
  const missingReturnAgainst = isReturn && !String(formData?.return_against || '').trim()
  const saveDisabled = isLoading || missingReturnAgainst

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-200 flex flex-col h-full">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-base font-extrabold text-gray-800">Resumen</h3>
      </div>
      <div className="space-y-2 flex-grow text-xs">
        <div className="flex justify-between items-center text-gray-600">
          <span className="font-medium">Total ítems</span>
          <span className="font-mono">{totals.totalItems}</span>
        </div>
        <div className="flex justify-between items-center text-gray-600">
          <span className="font-medium">Cantidad total</span>
          <span className="font-mono">{totals.totalQuantity}</span>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {missingReturnAgainst && (
          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs">
            Estás creando una devolución. Tenés que <span className="font-semibold">Relacionar con...</span> un remito anterior (Return Against) o no vas a poder guardar.
          </div>
        )}
        {onLinkDocuments && (
          <button
            type="button"
            onClick={onLinkDocuments}
            disabled={isLoading || linkDocumentsDisabled}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-bold rounded-lg text-blue-600 border border-blue-200 hover:bg-blue-50 disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" />
            Relacionar con...
          </button>
        )}
        <button
          onClick={onSave}
          disabled={saveDisabled}
          className="btn-remito w-full flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {isEditing ? 'Actualizar Remito' : 'Guardar Remito'}
            </>
          )}
        </button>
        <button
          onClick={onClose}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-bold rounded-lg text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
        >
          <X className="w-4 h-4" />
          Cancelar
        </button>
      </div>
    </div>
  )
}

export default RemitoSummary
