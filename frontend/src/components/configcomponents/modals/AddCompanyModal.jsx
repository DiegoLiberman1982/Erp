import React from 'react'
import Modal from '../../Modal'
import { Search } from 'lucide-react'

const AddCompanyModal = ({
  isOpen,
  onClose,
  newCompany,
  onCompanyChange,
  onSearchAfip,
  onCreateCompany,
  consultingAfip
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Agregar Nueva Empresa"
      size="default"
    >
      {/* Limitar altura del modal y permitir scroll interno si el contenido es largo */}
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Nombre de la Empresa *</label>
            <input
              type="text"
              value={newCompany.name}
              onChange={(e) => onCompanyChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ej: MiEmpresa"
            />
          </div>
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Razón Social *</label>
            <input
              type="text"
              value={newCompany.razonSocial}
              onChange={(e) => onCompanyChange('razonSocial', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ej: Mi Empresa S.A."
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-black text-gray-700 mb-1">Domicilio Fiscal *</label>
            <input
              type="text"
              value={newCompany.domicilio}
              onChange={(e) => onCompanyChange('domicilio', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Calle, número, piso, departamento"
            />
          </div>
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">País</label>
            <input
              type="text"
              value={newCompany.pais}
              onChange={(e) => onCompanyChange('pais', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ej: ARGENTINA"
            />
          </div>
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Ciudad</label>
            <input
              type="text"
              value={newCompany.localidad}
              onChange={(e) => onCompanyChange('localidad', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ej: Buenos Aires"
            />
          </div>
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Provincia/Estado</label>
            <input
              type="text"
              value={newCompany.provincia}
              onChange={(e) => onCompanyChange('provincia', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ej: Buenos Aires"
            />
          </div>
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Código Postal</label>
            <input
              type="text"
              value={newCompany.codigoPostal}
              onChange={(e) => onCompanyChange('codigoPostal', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ej: 1000"
            />
          </div>
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">CUIT *</label>
            <div className="relative">
              <input
                type="text"
                value={newCompany.cuit}
                onChange={(e) => onCompanyChange('cuit', e.target.value)}
                className="w-full pr-12 px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
                placeholder="Ej: 20-12345678-9"
              />
              <button
                type="button"
                onClick={() => onSearchAfip(newCompany.cuit)}
                disabled={consultingAfip}
                className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-600 hover:text-white hover:bg-blue-600 px-2 ml-1 rounded-r-md border-l border-gray-200 disabled:opacity-50"
                title={consultingAfip ? "Consultando AFIP..." : "Buscar en AFIP"}
              >
                {consultingAfip ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-black text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={newCompany.email}
              onChange={(e) => onCompanyChange('email', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ej: contacto@empresa.com"
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-black text-gray-700 mb-1">Personería</label>
          <select
            value={newCompany.personeria}
            onChange={(e) => onCompanyChange('personeria', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Seleccionar Personería...</option>
            <option value="Sociedad Colectiva (SC)">Sociedad Colectiva (SC)</option>
            <option value="Sociedad en Comandita Simple (SCS)">Sociedad en Comandita Simple (SCS)</option>
            <option value="Sociedad de Capital e Industria (SCI)">Sociedad de Capital e Industria (SCI)</option>
            <option value="Sociedad de Responsabilidad Limitada (S.R.L.)">Sociedad de Responsabilidad Limitada (S.R.L.)</option>
            <option value="Sociedad Anónima (S.A.)">Sociedad Anónima (S.A.)</option>
            <option value="Sociedad por Acciones Simplificada (S.A.S.)">Sociedad por Acciones Simplificada (S.A.S.)</option>
            <option value="Sociedad en Comandita por Acciones (SCA)">Sociedad en Comandita por Acciones (SCA)</option>
            <option value="Sociedad Anónima Unipersonal (S.A.U.)">Sociedad Anónima Unipersonal (S.A.U.)</option>
            <option value="Monotributista">Monotributista</option>
            <option value="Unipersonal">Unipersonal</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-black text-gray-700 mb-1">Mes de Cierre Contable *</label>
          <select
            value={newCompany.mesCierreContable}
            onChange={(e) => onCompanyChange('mesCierreContable', e.target.value)}
            disabled={newCompany.personeria === 'Unipersonal' || (newCompany.cuit && newCompany.cuit.replace(/[-\s]/g, '').startsWith('2'))}
            className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              newCompany.personeria === 'Unipersonal' || (newCompany.cuit && newCompany.cuit.replace(/[-\s]/g, '').startsWith('2'))
                ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                : ''
            }`}
          >
            <option value="">Seleccionar mes...</option>
            <option value="1">Enero</option>
            <option value="2">Febrero</option>
            <option value="3">Marzo</option>
            <option value="4">Abril</option>
            <option value="5">Mayo</option>
            <option value="6">Junio</option>
            <option value="7">Julio</option>
            <option value="8">Agosto</option>
            <option value="9">Septiembre</option>
            <option value="10">Octubre</option>
            <option value="11">Noviembre</option>
            <option value="12">Diciembre</option>
          </select>
          {(newCompany.personeria === 'Unipersonal' || (newCompany.cuit && newCompany.cuit.replace(/[-\s]/g, '').startsWith('2'))) && (
            <p className="text-xs text-blue-600 mt-1">mes de cierre fijo en Diciembre</p>
          )}
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-black text-gray-700 mb-1">Condición frente al IVA</label>
          <select
            value={newCompany.condicionIVA}
            onChange={(e) => onCompanyChange('condicionIVA', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Seleccionar...</option>
            <option value="Responsable Inscripto">Responsable Inscripto</option>
            {newCompany.personeria === 'Unipersonal' && (
              <option value="Monotributista">Monotributista</option>
            )}
            <option value="Exento">Exento</option>
            <option value="Consumidor Final">Consumidor Final</option>
          </select>
          {newCompany.personeria !== 'Unipersonal' && newCompany.condicionIVA === 'Monotributista' && (
            <p className="text-xs text-red-500 mt-1">La condición Monotributista solo está disponible para Unipersonal</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-black text-gray-700 mb-1">Detalles de Registro</label>
          <textarea
            value={newCompany.registration_details}
            onChange={(e) => onCompanyChange('registration_details', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Información adicional sobre la empresa..."
            rows="2"
          />
        </div>
      </div>

      <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
        <button
          onClick={onClose}
          className="btn-manage-addresses"
        >
          Cancelar
        </button>
        <button
          onClick={onCreateCompany}
          className="btn-manage-addresses"
        >
          Crear Empresa
        </button>
      </div>
    </Modal>
  )
}

export default AddCompanyModal