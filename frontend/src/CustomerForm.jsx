import React, { useState } from 'react'

export default function CustomerForm({ onClose, onCreate }){
  // Basic info
  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [cuit, setCuit] = useState('')
  const [ibbNumber, setIbbNumber] = useState('')
  const [address, setAddress] = useState('')

  // Configuration
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [currency, setCurrency] = useState('')
  const [taxCondition, setTaxCondition] = useState('Responsable Inscripto')
  const [notes, setNotes] = useState('')

  const [activeTab, setActiveTab] = useState('basic')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e)=>{
    e && e.preventDefault()
    setSaving(true); setError(null)
    const payload = {
      name,
      business_name: businessName,
      cuit,
      ibb_number: ibbNumber,
      address,
      email,
      phone,
      ...(currency ? { currency } : {}),
      tax_condition: taxCondition,
      notes,
    }

    try{
      await onCreate(payload)
      onClose()
    }catch(err){ setError(err.message || 'Error') }
    setSaving(false)
  }

  const tabButton = (id, label) => (
    <button 
      type="button" 
      onClick={()=>setActiveTab(id)} 
      className={`px-3 py-2 rounded-lg font-bold transition-colors duration-200 ${
        activeTab===id 
          ? 'bg-gray-900 text-white border border-gray-900' 
          : 'bg-transparent text-gray-900 border border-transparent hover:bg-gray-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex gap-2">
          {tabButton('basic','Básicos')}
          {tabButton('config','Configuración')}
        </div>
      </div>

      <div className="min-h-48">
        {activeTab==='basic' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Nombre</label>
              <input value={name} onChange={e=>setName(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Razón social</label>
                <input value={businessName} onChange={e=>setBusinessName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">CUIT</label>
                <input value={cuit} onChange={e=>setCuit(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Nº IBB</label>
                <input value={ibbNumber} onChange={e=>setIbbNumber(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Dirección</label>
                <input value={address} onChange={e=>setAddress(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
              </div>
            </div>
          </div>
        )}

        {activeTab==='config' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Email</label>
                <input value={email} onChange={e=>setEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Teléfono</label>
                <input value={phone} onChange={e=>setPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Moneda</label>
                <input value={currency} onChange={e=>setCurrency(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Condición frente al IVA</label>
                <select value={taxCondition} onChange={e=>setTaxCondition(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-transparent">
                  <option>Responsable Inscripto</option>
                  <option>Monotributo</option>
                  <option>Exento</option>
                  <option>Consumidor Final</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Notas internas</label>
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg h-20 focus:ring-2 focus:ring-gray-500 focus:border-transparent" />
            </div>
          </div>
        )}
      </div>

      {error && <div className="text-red-600 font-medium">{error}</div>}

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors duration-200">
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200">
          {saving? 'Guardando...' : 'Crear'}
        </button>
      </div>
    </form>
  )
}
