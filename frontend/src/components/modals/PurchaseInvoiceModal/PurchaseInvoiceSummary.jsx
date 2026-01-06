// --- COMPONENTE PARA EL RESUMEN LATERAL ---
import { Save, Trash2, Link2 } from 'lucide-react'
import PercepcionesSection from './PercepcionesSection.jsx'

const PurchaseInvoiceSummary = ({
  formData,
  totals,
  formatCurrency,
  handleSave,
  handleDelete,
  editingData,
  isSaving,
  isDeleting,
  setFormData,
  onLinkDocuments
}) => {
  const isEditing = !!editingData
  
  // Calcular total de percepciones del nuevo modelo unificado
  const totalPerceptions = (formData.perceptions || []).reduce(
    (total, p) => total + (parseFloat(p.total_amount) || 0), 
    0
  )

  return (
    <div className="w-full md:w-64 lg:w-72 flex-shrink-0 bg-white rounded-2xl p-5 border border-gray-200 flex flex-col">
      <div className="flex justify-between items-center mb-3">
         <h3 className="text-base font-extrabold text-gray-800">Resumen</h3>
      </div>

      {/* SECCIÓN DE PERCEPCIONES UNIFICADA */}
      <PercepcionesSection
        formData={formData}
        setFormData={setFormData}
        minimal={true}
      />

      <div className="space-y-2 flex-grow text-xs">
        <div className="flex justify-between items-center text-gray-600"><span className="font-medium">Subtotal</span><span className="font-mono">{formatCurrency(totals.subtotal)} {formData.currency}</span></div>
        <div className="flex justify-between items-center text-gray-600"><span className="font-medium">Descuento</span><span className="font-mono text-green-600">- {formatCurrency(totals.discount)} {formData.currency}</span></div>
        <div className="flex justify-between items-center text-gray-600"><span className="font-medium">IVA</span><span className="font-mono">+ {formatCurrency(totals.iva)} {formData.currency}</span></div>
        {totalPerceptions > 0 && (
          <div className="flex justify-between items-center text-gray-600"><span className="font-medium">Percepciones</span><span className="font-mono">+ {formatCurrency(totalPerceptions)} {formData.currency}</span></div>
        )}
        <div className="pt-2 border-t border-gray-200 flex justify-between items-center mt-2">
          <span className="text-sm font-bold text-gray-800">Total</span>
          <span className="text-lg font-bold text-blue-600 font-mono">{formatCurrency(totals.total)} {formData.currency}</span>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {onLinkDocuments && (
          <button
            type="button"
            onClick={onLinkDocuments}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-bold rounded-lg text-blue-600 border border-blue-200 hover:bg-blue-50 disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" />
            Relacionar con...
          </button>
        )}
         <button onClick={handleSave} disabled={isSaving} className="btn-manage-addresses w-full flex items-center justify-center gap-2">
           <Save className="w-4 h-4" />
           {isSaving ? 'Guardando...' : (isEditing ? 'Actualizar' : 'Guardar')}
         </button>
         {isEditing && (
           <button onClick={handleDelete} disabled={isDeleting} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-bold rounded-lg text-red-600 bg-red-100 hover:bg-red-200 disabled:opacity-50">
             <Trash2 className="w-4 h-4" />
             {isDeleting ? 'Eliminando...' : 'Eliminar'}
           </button>
         )}
      </div>
    </div>
  )
}

export default PurchaseInvoiceSummary
