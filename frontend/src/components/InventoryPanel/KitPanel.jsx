import React, { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../../AuthProvider'
import { NotificationContext } from '../../contexts/NotificationContext'
import API_ROUTES from '../../apiRoutes'
import { useConfirm } from '../../hooks/useConfirm'
import { ChevronRight, ChevronDown, Package, Plus, Edit, Trash2, Save, X } from 'lucide-react'
import { extractItemCodeDisplay } from './inventoryUtils'
import Select from 'react-select'
import CreatableSelect from 'react-select/creatable'
import KitDetailsPanel from './KitDetailsPanel'

export default function KitPanel() {
  const [kits, setKits] = useState([])
  const [selectedKit, setSelectedKit] = useState(null)
  const [kitDetails, setKitDetails] = useState(null)
  // separate loading states to avoid refreshing the list when fetching details
  const [kitListLoading, setKitListLoading] = useState(false)
  const [kitDetailsLoading, setKitDetailsLoading] = useState(false)
  const [savingKit, setSavingKit] = useState(false)
  const [kitSearch, setKitSearch] = useState('')
  const [availableItems, setAvailableItems] = useState([])
  const [isEditingKit, setIsEditingKit] = useState(false)
  const [editedKitData, setEditedKitData] = useState({})
  const [itemGroups, setItemGroups] = useState([])
  const [brands, setBrands] = useState([])

  const { fetchWithAuth, activeCompany } = useContext(AuthContext)
  const { showNotification } = useContext(NotificationContext)
  const { confirm, ConfirmDialog } = useConfirm()

  // Cargar kits al montar el componente
  useEffect(() => {
    if (activeCompany) {
      fetchKits()
      fetchAvailableItems()
      fetchItemGroups()
      fetchBrands()
    }
  }, [activeCompany])

  // Cargar detalles cuando se selecciona un kit
  useEffect(() => {
    if (selectedKit && selectedKit !== 'new') {
      fetchKitDetails(selectedKit)
    } else if (selectedKit === 'new') {
      setKitDetails(null)
    }
  }, [selectedKit])

  const fetchKits = async (searchTerm = '') => {
    try {
      setKitListLoading(true)
      let url = `${API_ROUTES.inventoryKits}?company=${encodeURIComponent(activeCompany)}`
      if (searchTerm.trim()) {
        url += `&search=${encodeURIComponent(searchTerm.trim())}`
      }
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          console.debug('KitPanel.fetchKits -> raw kits count', (data.data||[]).length, 'sample:', (data.data||[]).slice(0,3))
          console.debug('KitPanel.fetchKits -> available_qty values:', (data.data||[]).map(k => ({ name: k.name, available_qty: k.available_qty })))
          setKits(data.data || [])
        }
      }
    } catch (error) {
      console.error('Error fetching kits:', error)
      showNotification('Error al cargar kits', 'error')
    } finally {
      setKitListLoading(false)
    }
  }

  const fetchKitDetails = async (kitName) => {
    try {
      setKitDetailsLoading(true)
      const response = await fetchWithAuth(`${API_ROUTES.inventoryKitByName(kitName)}?company=${encodeURIComponent(activeCompany)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setKitDetails(data.data)
        }
      }
    } catch (error) {
      console.error('Error fetching kit details:', error)
      showNotification('Error al cargar detalles del kit', 'error')
    } finally {
      setKitDetailsLoading(false)
    }
  }

  const fetchAvailableItems = async () => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.inventory}/items?company=${encodeURIComponent(activeCompany)}&limit=10000`)
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const items = data.data || []
          // Keep availableItems as raw item objects (item_code, item_name, description)
          setAvailableItems(items)
        }
      }
    } catch (error) {
      console.error('Error fetching available items:', error)
    }
  }

  const fetchItemGroups = async () => {
    try {
      const response = await fetchWithAuth(`${API_ROUTES.itemGroups}?company=${encodeURIComponent(activeCompany)}`)
      if (!response.ok) return
      const data = await response.json()
      if (data.success) {
        const leafGroups = (data.data || []).map(g => g.item_group_name || g.name)
        setItemGroups(leafGroups)
      }
    } catch (e) {
      console.error('Error fetching item groups:', e)
    }
  }

  const fetchBrands = async () => {
    try {
      const resp = await fetchWithAuth(API_ROUTES.brands)
      if (!resp.ok) return
      const data = await resp.json()
      if (data.success) setBrands(data.data || [])
    } catch (e) {
      console.error('Error fetching brands:', e)
    }
  }

  const createBrand = async (brandName) => {
    try {
      const res = await fetchWithAuth(API_ROUTES.brands, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand: brandName }) })
      if (!res.ok) return null
      const data = await res.json()
      if (data.success) {
        setBrands(prev => [...prev, data.data])
        return data.data
      }
      return null
    } catch (e) {
      console.error('Error creating brand:', e)
      return null
    }
  }

  const createItemGroup = async (groupName) => {
    try {
      const response = await fetchWithAuth(API_ROUTES.itemGroups, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_group_name: groupName, parent_item_group: 'All Item Groups', is_group: 0 }) })
      if (!response.ok) return null
      const d = await response.json()
      if (d.success) {
        await fetchItemGroups()
        return d.data
      }
    } catch (e) {
      console.error('Error creating item group:', e)
    }
    return null
  }

  const handleAddKit = () => {
    setSelectedKit('new')
    setIsEditingKit(true)
    setEditedKitData({
      new_item_code: '',
      item_name: '',
      description: '',
      item_group: '',
      brand: '',
      __isNewItemGroup: false,
      items: [ { item_code: '', qty: 1, uom: 'Unit' }, { item_code: '', qty: 1, uom: 'Unit' } ]
    })
  }

  const saveKit = async (validatedData) => {
    try {
      setSavingKit(true)

      // Determine company ABBR from available items if possible
      const companyAbbr = (() => {
        try {
          const candidate = (availableItems || []).find(it => (it.item_code || '').includes(' - '))
          if (candidate) return candidate.item_code.split(' - ').slice(-1)[0]
        } catch (e) { }
        return null
      })()

      // No longer require user to include ABBR in new_item_code; backend will append it

      // Map component display codes to canonical item_code from availableItems
      // NOTE: Do not enforce company suffix here - backend will append it when needed.
      const mappedItems = (validatedData.items || []).map(it => {
        const raw = (it.item_code || '').toString().trim()
        const found = (availableItems || []).find(inv => extractItemCodeDisplay(inv.item_code || inv.name || '') === raw || (inv.item_code || inv.name || '') === raw)
        if (!found) throw new Error(`Componente ${raw} no encontrado en el catálogo`)
        const canonical = found.item_code || found.name || raw
        return { item_code: canonical, qty: it.qty, uom: it.uom || 'Unit' }
      })

      const payload = {
        company: activeCompany,
        custom_company: activeCompany,
        new_item_code: validatedData.new_item_code,
        // parent item name
        item_name: validatedData.item_name || validatedData.description,
        description: validatedData.description,
        items: mappedItems,
        item_group: validatedData.item_group || undefined,
        __isNewItemGroup: !!validatedData.__isNewItemGroup,
        brand: validatedData.brand || undefined
      }

      // Include parent_taxes override if provided by the editor (list of template names)
      if (validatedData.parent_taxes && Array.isArray(validatedData.parent_taxes) && validatedData.parent_taxes.length > 0) {
        payload.parent_taxes = validatedData.parent_taxes
      }

      const isNew = selectedKit === 'new'
      const url = isNew ? API_ROUTES.inventoryKits : API_ROUTES.inventoryKitByName(selectedKit)
      const method = isNew ? 'POST' : 'PUT'

      // Log payload to help debug 400 responses from backend
      try {
        console.debug('KitPanel.saveKit -> outgoing payload:', payload, 'url:', url, 'method:', method)
      } catch (e) {}

      const response = await fetchWithAuth(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          showNotification(`Kit ${isNew ? 'creado' : 'actualizado'} exitosamente`, 'success')
          await fetchKits()
          setSelectedKit(data.data.name || validatedData.new_item_code)
        } else {
          showNotification(data.message || `Error al ${isNew ? 'crear' : 'actualizar'} kit`, 'error')
        }
      } else {
        // Try to extract and log the server error body for easier debugging
        let errorBody = null
        try {
          errorBody = await response.json()
        } catch (e) {
          try {
            errorBody = await response.text()
          } catch (t) {
            errorBody = { raw: 'No se pudo leer el body de error' }
          }
        }
        console.debug('KitPanel.saveKit -> server returned non-OK response', response.status, errorBody)
        // Mostrar mensaje específico de ERPNext si está disponible
        const errorMessage = (errorBody && (errorBody.message || errorBody.error)) || `Error al ${isNew ? 'crear' : 'actualizar'} kit`
        showNotification(errorMessage, 'error')
      }
    } catch (error) {
      console.error('Error saving kit:', error)
      showNotification(`Error al guardar kit`, 'error')
    } finally {
      setSavingKit(false)
    }
  }

  const handleDeleteKit = async () => {
    if (!selectedKit || selectedKit === 'new') return

    const confirmed = await confirm({
      title: 'Eliminar Kit',
      message: `¿Estás seguro de que deseas eliminar el kit ${selectedKit}? Esta acción no se puede deshacer.`
    })

    if (!confirmed) return

    try {
      const response = await fetchWithAuth(API_ROUTES.inventoryKitByName(selectedKit), {
        method: 'DELETE'
      })

      if (response.ok) {
        showNotification('Kit eliminado exitosamente', 'success')
        await fetchKits()
        setSelectedKit(null)
        setKitDetails(null)
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al eliminar kit', 'error')
      }
    } catch (error) {
      console.error('Error deleting kit:', error)
      showNotification('Error al eliminar kit', 'error')
    }
  }

  // Delete a specific kit row (from the list) — prevent row selection propagation
  const handleDeleteKitRow = async (kitName, e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
    if (!kitName) return
    const confirmed = await confirm({
      title: 'Eliminar Kit',
      message: `¿Estás seguro de que deseas eliminar el kit ${kitName}? Esta acción no se puede deshacer.`
    })
    if (!confirmed) return

    try {
      const response = await fetchWithAuth(API_ROUTES.inventoryKitByName(kitName), { method: 'DELETE' })
      if (response.ok) {
        showNotification('Kit eliminado exitosamente', 'success')
        await fetchKits()
        // If the deleted kit is currently selected, clear details
        if (selectedKit === kitName) {
          setSelectedKit(null)
          setKitDetails(null)
        }
      } else {
        const errorData = await response.json()
        showNotification(errorData.message || 'Error al eliminar kit', 'error')
      }
    } catch (error) {
      console.error('Error deleting kit row:', error)
      showNotification('Error al eliminar kit', 'error')
    }
  }

  const handleSearchChange = async (searchTerm) => {
    setKitSearch(searchTerm)
    await fetchKits(searchTerm)
  }

  return (
    <div className="h-full flex gap-6">
      {/* Panel izquierdo - Lista de kits */}
      <div className="w-80 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Kits</h2>
            <button
              onClick={handleAddKit}
              className="btn-secondary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nuevo Kit
            </button>
          </div>

          <input
            type="text"
            placeholder="Buscar kits..."
            value={kitSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {kitListLoading ? (
            <div className="p-4 text-center text-gray-500">Cargando kits...</div>
          ) : kits.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No hay kits disponibles</div>
          ) : (
            <div className="p-2">
              {kits.map((kit) => (
                <div
                  key={kit.name}
                  onClick={() => setSelectedKit(kit.name)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedKit === kit.name
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium text-gray-900">{extractItemCodeDisplay(kit.name || kit.new_item_code || kit.item_code)}</div>
                  <div className="text-sm text-gray-600">{
                    (kit.new_item_code && kit.new_item_code !== kit.name)
                      ? extractItemCodeDisplay(kit.new_item_code)
                      : (kit.description || kit.item_name || kit.parent_item?.item_name || '')
                  }</div>
                  <div className="flex items-center justify-between mt-1 text-xs text-gray-500">
                    <div>{kit.items?.length || 0} componentes</div>
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-right text-gray-700">Disponibles: {kit.available_qty ?? 0}</div>
                      <button
                        title={`Eliminar kit ${kit.name}`}
                        onClick={(e) => handleDeleteKitRow(kit.name, e)}
                        className="p-1 rounded hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panel derecho - Detalles del kit */}
        <KitDetailsPanel
        selectedKit={selectedKit}
        kitDetails={kitDetails}
          onDeleteKit={handleDeleteKit}
        onSaveKit={saveKit}
          inventoryItems={availableItems}
          itemGroups={itemGroups}
          brands={brands}
          createBrand={createBrand}
          createItemGroup={createItemGroup}
        showNotification={showNotification}
        savingKit={savingKit}
        setSavingKit={setSavingKit}
      />

      <ConfirmDialog />
    </div>
  )
}
