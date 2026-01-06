// supplierHandlers.js - Handlers para operaciones con proveedores

import API_ROUTES from '../../apiRoutes'

/**
 * Obtiene la abreviatura de la compañía activa
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @returns {Promise<string|null>} Abreviatura de la compañía o null si falla
 */
const getCompanyAbbr = async (fetchWithAuth) => {
  try {
    const response = await fetchWithAuth('/api/active-company')
    if (response.ok) {
      const data = await response.json()
      return data.data?.company_details?.abbr || null
    }
    return null
  } catch (error) {
    console.error('Error obteniendo abreviatura de compañía:', error)
    return null
  }
}

/**
 * Agrega la sigla de compañía al nombre del proveedor para enviar al backend
 * @param {string} supplierName - Nombre del proveedor sin sigla
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @param {string|null} companyAbbr - Abreviatura de compañía ya conocida (opcional)
 * @returns {Promise<string>} Nombre del proveedor con sigla agregada
 */
export const addCompanyAbbrToSupplier = async (supplierName, fetchWithAuth, companyAbbr = null) => {
  if (!supplierName) return supplierName

  const abbr = companyAbbr ?? await getCompanyAbbr(fetchWithAuth)
  if (abbr && !supplierName.includes(` - ${abbr}`)) {
    return `${supplierName} - ${abbr}`
  }
  return supplierName
}

/**
 * Remueve la sigla de compañía del nombre del proveedor (para mostrar en UI)
 * @param {string} supplierName - Nombre del proveedor que puede contener sigla
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @returns {Promise<string>} Nombre del proveedor sin sigla
 */
export const removeCompanyAbbrFromSupplier = async (supplierName, fetchWithAuth) => {
  if (!supplierName) return supplierName

  const companyAbbr = await getCompanyAbbr(fetchWithAuth)
  if (companyAbbr && supplierName.endsWith(` - ${companyAbbr}`)) {
    return supplierName.replace(` - ${companyAbbr}`, '')
  }
  return supplierName
}

/**
 * Prepara datos de proveedor para enviar al backend agregando siglas donde sea necesario
 * @param {object} supplierData - Datos del proveedor
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @returns {Promise<object>} Datos del proveedor con siglas agregadas
 */
export const prepareSupplierDataForBackend = async (supplierData, fetchWithAuth) => {
  const preparedData = { ...supplierData }

  // Agregar sigla al nombre del proveedor si existe
  if (preparedData.supplier_name) {
    preparedData.supplier_name = await addCompanyAbbrToSupplier(preparedData.supplier_name, fetchWithAuth)
  }

  // Agregar sigla al nombre del contacto si existe
  if (preparedData.contacto) {
    preparedData.contacto = await addCompanyAbbrToSupplier(preparedData.contacto, fetchWithAuth)
  }

  // supplier_group debe enviarse exactamente como Link válido de ERPNext.
  // No agregamos ABBR acá para evitar romper links como "All Supplier Groups".
  if (!preparedData.supplier_group) {
    delete preparedData.supplier_group
  }

  return preparedData
}

/**
 * Valida un CUIT (Código Único de Identificación Tributaria) argentino
 * @param {string} cuit - CUIT a validar (solo números)
 * @returns {boolean} true si es válido, false si no
 */
const validateCuit = (cuit) => {
  // Verificar que sea una cadena de exactamente 11 dígitos
  if (!/^\d{11}$/.test(cuit)) {
    return false
  }

  // Algoritmo de validación del dígito verificador
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let sum = 0

  for (let i = 0; i < 10; i++) {
    sum += parseInt(cuit[i]) * multipliers[i]
  }

  const remainder = sum % 11
  const checkDigit = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder

  return parseInt(cuit[10]) === checkDigit
}

/**
 * Obtiene datos de AFIP para un CUIT específico
 * @param {string} cuit - CUIT a consultar (11 dígitos)
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
const getAfipData = async (cuit, fetchWithAuth) => {
  try {
    const response = await fetchWithAuth(`${API_ROUTES.afipData}${cuit}`)

    if (response.ok) {
      const data = await response.json()
      return data
    } else {
      const errorData = await response.json().catch(() => ({ message: 'Error desconocido' }))
      return {
        success: false,
        error: errorData.message || `Error HTTP ${response.status}`
      }
    }
  } catch (error) {
    console.error('Error al consultar AFIP:', error)
    return {
      success: false,
      error: 'Error de conexión con el servicio de AFIP'
    }
  }
}

/**
 * Agrega un nuevo proveedor
 * @param {function} setters - Objeto con setters necesarios
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @param {function} fetchSupplierGroupDetails - Función para obtener detalles del grupo
 * @param {object} activeCompanyDetails - Detalles de la compañía activa
 * @param {array} supplierGroups - Grupos de proveedores disponibles
 * @param {array} availableExpenseAccounts - Cuentas de gasto disponibles
 * @param {array} paymentTermsTemplates - Templates de términos de pago
 * @param {array} taxTemplates - Templates de impuestos
 * @param {array} availablePriceLists - Listas de precios disponibles
 */
export const handleAddSupplier = async (setters, fetchWithAuth, fetchSupplierGroupDetails, activeCompanyDetails, supplierGroups, availableExpenseAccounts, paymentTermsTemplates, taxTemplates, availablePriceLists) => {
  const { setSelectedSupplier, setIsEditingSupplier, setEditedSupplierData, setSupplierTab } = setters

  // Los datos necesarios ya se pasan como parámetros, no necesitamos cargarlos aquí

  // Usar los grupos pasados como parámetro
  let supplierGroupsData = supplierGroups

  console.log('DEBUG handleAddSupplier: supplierGroupsData:', supplierGroupsData)
  console.log('DEBUG handleAddSupplier: supplierGroupsData.length:', supplierGroupsData.length)

  // Obtener el grupo por defecto (único grupo hoja disponible preferido)
  // Sólo usar grupos hoja (is_group === 0). Si no hay grupos hoja, dejar vacío para forzar selección manual.
  const leafGroups = supplierGroupsData.filter(g => g.is_group === 0)
  // If there is exactly one supplier group (leaf), auto-select it — this is a sensible default
  // but only when there's exactly one group available.
  const defaultGroup = leafGroups.length === 1 ? leafGroups[0].supplier_group_name : ''

  // Cargar valores por defecto del grupo si hay un grupo único
  let defaultValues = {}
  if (supplierGroupsData.length === 1) {
    console.log('DEBUG handleAddSupplier: Solo hay un grupo, cargando valores por defecto')
    const groupDetails = await fetchSupplierGroupDetails(defaultGroup)
    console.log('DEBUG handleAddSupplier: groupDetails obtenidos:', groupDetails)
    if (groupDetails) {
      if (groupDetails.default_price_list) {
        defaultValues.custom_default_price_list = groupDetails.default_price_list
        console.log('DEBUG handleAddSupplier: custom_default_price_list del grupo:', groupDetails.default_price_list)
      }
      if (groupDetails.payment_terms) {
        defaultValues.payment_terms = groupDetails.payment_terms
        console.log('DEBUG handleAddSupplier: payment_terms del grupo:', groupDetails.payment_terms)
      }
      if (groupDetails.accounts && groupDetails.accounts.length > 0) {
        console.log('DEBUG handleAddSupplier: groupDetails.accounts:', groupDetails.accounts)
        const expenseAccount = groupDetails.accounts.find(acc => acc.account)
        console.log('DEBUG handleAddSupplier: expenseAccount encontrado:', expenseAccount)
        if (expenseAccount && availableExpenseAccounts) {
          console.log('DEBUG handleAddSupplier: expenseAccount.account:', expenseAccount.account)
          console.log('DEBUG handleAddSupplier: availableExpenseAccounts:', availableExpenseAccounts.map(acc => ({ name: acc.name, account_name: acc.account_name })))
          // Buscar la cuenta correspondiente en availableExpenseAccounts por account_name
          // Extraer el nombre de la cuenta del formato "2.1.01.00 - Proveedores Nacionales - MS"
          const accountNameFromGroup = expenseAccount.account.split(' - ')[1] // "Proveedores Nacionales"
          const matchingAccount = availableExpenseAccounts.find(acc => acc.account_name === accountNameFromGroup)
          console.log('DEBUG handleAddSupplier: matchingAccount encontrado:', matchingAccount)
          if (matchingAccount) {
            defaultValues.default_expense_account = matchingAccount.name
            console.log('DEBUG handleAddSupplier: Asignando default_expense_account:', matchingAccount.name)
          } else {
            console.log('DEBUG handleAddSupplier: No se encontró matchingAccount para:', expenseAccount.account)
          }
        }
      }
    }
  } else {
    console.log('DEBUG handleAddSupplier: No hay un grupo único, no se cargan valores por defecto automáticamente')
  }

  setSelectedSupplier('new')
  setIsEditingSupplier(true)
  setSupplierTab('general')
  const finalData = {
    supplier_name: '',
    supplier_details: '', // Nombre comercial
    supplier_group: defaultGroup,
    website: '',
    email: '',
    phone: '',
    address: '',
    contacto: '',
    default_payable_account: activeCompanyDetails?.default_payable_account || '',
    default_expense_account: defaultValues.default_expense_account || activeCompanyDetails?.default_expense_account || '',
    fecha_alta: '',
    ciudad: '',
    codigo_postal: '',
    provincia: '',
    pais: 'Argentina',
    tax_id: '',
    custom_condicion_iva: '',
    custom_default_iva_compras: activeCompanyDetails?.custom_default_iva_compras || '',
    custom_default_price_list: defaultValues.custom_default_price_list || '',
    payment_terms: defaultValues.payment_terms || '',
    discount_percentage: '',
    porcentaje_iva: '',
    transporter: ''
  }
  console.log('DEBUG handleAddSupplier: Final data being sent to setEditedSupplierData:', finalData)
  console.log('DEBUG handleAddSupplier: defaultValues applied:', defaultValues)
  console.log('DEBUG handleAddSupplier: activeCompanyDetails?.default_payable_account:', activeCompanyDetails?.default_payable_account)
  console.log('DEBUG handleAddSupplier: activeCompanyDetails?.default_expense_account:', activeCompanyDetails?.default_expense_account)
  setEditedSupplierData(finalData)
}

/**
 * Edita un proveedor existente
 * @param {object} supplierDetails - Detalles del proveedor
 * @param {object} supplierAddresses - Direcciones del proveedor
 * @param {function} setters - Objeto con setters necesarios
 * @param {object} activeCompanyDetails - Detalles de la compañía activa
 */
export const handleEditSupplier = async (supplierDetails, supplierAddresses, setters, activeCompanyDetails, fetchSupplierGroupDetails, availableExpenseAccounts, supplierGroups = []) => {
  const { setIsEditingSupplier, setEditedSupplierData } = setters

  if (!supplierDetails) return

  // Obtener la dirección fiscal para cargar sus datos
  const fiscalAddress = supplierAddresses.find(address =>
    address.address_type === 'Billing' ||
    address.address_type === 'Dirección Fiscal' ||
    (address.address_type === 'Other' && address.custom_type === 'Fiscal')
  )

  setIsEditingSupplier(true)

  // Cargar valores por defecto del grupo si no existen en el proveedor
  let defaultValues = {}
  if (supplierDetails.supplier_group) {
    const groupDetails = await fetchSupplierGroupDetails(supplierDetails.supplier_group)
    if (groupDetails) {
      console.log('Detalles del grupo obtenidos para edición:', groupDetails)
      // Solo aplicar valores por defecto si el proveedor no tiene valores propios
      if (!supplierDetails.payment_terms && groupDetails.payment_terms) {
        defaultValues.payment_terms = groupDetails.payment_terms
        console.log('Aplicando payment_terms del grupo en edición:', groupDetails.payment_terms)
      }
      if (!supplierDetails.custom_default_price_list && groupDetails.default_price_list) {
        defaultValues.custom_default_price_list = groupDetails.default_price_list
        console.log('Aplicando custom_default_price_list del grupo en edición:', groupDetails.default_price_list)
      }
      // Para la cuenta de gastos, aplicar la del grupo si no tiene una cuenta específica
      if (!supplierDetails.default_expense_account && groupDetails.accounts && groupDetails.accounts.length > 0) {
        const expenseAccount = groupDetails.accounts.find(acc => acc.account)
        if (expenseAccount && availableExpenseAccounts) {
          // Buscar la cuenta correspondiente en availableExpenseAccounts por account_name
          const accountNameFromGroup = expenseAccount.account.split(' - ')[1] // "Proveedores Nacionales"
          const matchingAccount = availableExpenseAccounts.find(acc => acc.account_name === accountNameFromGroup)
          if (matchingAccount) {
            defaultValues.default_expense_account = matchingAccount.name
            console.log('Aplicando default_expense_account del grupo en edición:', matchingAccount.name)
          }
        }
      }
    }
  }

  // Map supplier_group to a valid leaf group if possible, otherwise empty so user must pick
  let mappedSupplierGroup = ''
  const existingGroup = supplierDetails.supplier_group || ''

  if (existingGroup) {
    // If supplierGroups list provided, try to find a leaf that matches the stored value
    if (Array.isArray(supplierGroups) && supplierGroups.length > 0) {
      // exact match on supplier_group_name or name and leaf
      const found = supplierGroups.find(g => (g.supplier_group_name === existingGroup || g.name === existingGroup) && Number(g.is_group) === 0)
      if (found) {
        mappedSupplierGroup = found.supplier_group_name
      } else {
        // If stored group is parent, find a single child leaf with this as parent
        const child = supplierGroups.find(g => Number(g.is_group) === 0 && (g.parent_supplier_group === existingGroup || g.old_parent === existingGroup))
        if (child) mappedSupplierGroup = child.supplier_group_name
        // otherwise leave empty so user can choose one
      }
    } else {
      // without supplierGroups info, keep original value (best-effort)
      mappedSupplierGroup = existingGroup
    }
  }

  setEditedSupplierData({
    supplier_name: supplierDetails.supplier_name || supplierDetails.name,
    supplier_details: supplierDetails.supplier_details || '', // Nombre comercial
    // If mapping failed (e.g., stored group is a parent like 'All Supplier Groups'), set empty so user must pick
    supplier_group: mappedSupplierGroup || '',
    website: supplierDetails.website || '',
    email: supplierDetails.email || '',
    phone: supplierDetails.phone || '',
    address: fiscalAddress?.address_line1 || supplierDetails.address || '',
    contacto: supplierDetails.contacto || '',
    default_payable_account: supplierDetails.default_payable_account || defaultValues.default_payable_account || activeCompanyDetails?.default_payable_account || '',
    default_expense_account: supplierDetails.default_expense_account || activeCompanyDetails?.default_expense_account || '',
    fecha_alta: supplierDetails.creation ? new Date(supplierDetails.creation).toISOString().split('T')[0] : '',
    ciudad: fiscalAddress?.city || supplierDetails.ciudad || '',
    codigo_postal: fiscalAddress?.pincode || supplierDetails.codigo_postal || '',
    provincia: fiscalAddress?.state || supplierDetails.provincia || '',
    pais: fiscalAddress?.country || supplierDetails.pais || 'Argentina',
    tax_id: supplierDetails.tax_id || '',
    custom_condicion_iva: supplierDetails.custom_condicion_iva || '',
    custom_default_iva_compras: supplierDetails.custom_default_iva_compras || activeCompanyDetails?.custom_default_iva_compras || '',
    custom_default_price_list: supplierDetails.custom_default_price_list || defaultValues.custom_default_price_list || '',
    payment_terms: supplierDetails.payment_terms || defaultValues.payment_terms || '',
    discount_percentage: supplierDetails.discount_percentage || '',
    porcentaje_iva: supplierDetails.porcentaje_iva || '',
    transporter: supplierDetails.transporter || ''
  })
}

/**
 * Cancela la edición de un proveedor
 * @param {function} setters - Objeto con setters necesarios
 */
export const handleCancelEdit = (setters) => {
  const { setIsEditingSupplier, setEditedSupplierData } = setters
  setIsEditingSupplier(false)
  setEditedSupplierData({})
}

/**
 * Maneja cambios en los campos de edición
 * @param {string} field - Campo que cambió
 * @param {*} value - Nuevo valor
 * @param {function} setters - Objeto con setters necesarios
 * @param {function} fetchSupplierGroupDetails - Función para obtener detalles del grupo
 * @param {object} activeCompanyDetails - Detalles de la compañía activa
 */
export const handleEditChange = async (field, value, setters, fetchSupplierGroupDetails, activeCompanyDetails) => {
  const { setEditedSupplierData } = setters

  // Primero actualizar el campo
  const newData = {
    ...setters.editedSupplierData,
    [field]: value
  }

  // Si se cambia el grupo de proveedor, cargar valores por defecto del grupo si faltan
  if (field === 'supplier_group' && value) {
    const groupDetails = await fetchSupplierGroupDetails(value)
    if (groupDetails) {
      console.log('Detalles del grupo de proveedores obtenidos:', groupDetails)
      // Setear valores por defecto del grupo solo si no existen
      if (!newData.payment_terms && groupDetails.payment_terms) {
        newData.payment_terms = groupDetails.payment_terms
        console.log('Aplicando payment_terms del grupo:', groupDetails.payment_terms)
      }
      if (!newData.custom_default_price_list && groupDetails.default_price_list) {
        newData.custom_default_price_list = groupDetails.default_price_list
        console.log('Aplicando custom_default_price_list del grupo:', groupDetails.default_price_list)
      }
      // La cuenta de gastos del grupo prevalece sobre la de la compañía si no tiene
      if (groupDetails.accounts && groupDetails.accounts.length > 0) {
        const expenseAccount = groupDetails.accounts.find(acc => acc.account)
        if (expenseAccount) {
          // Buscar la cuenta correspondiente en availableExpenseAccounts por account_name
          // Extraer el nombre de la cuenta del formato "4.1.1.01.00 - Gastos de Servicios - MS"
          const accountNameFromGroup = expenseAccount.account.split(' - ')[1] // "Gastos de Servicios"
          // Para proveedores, usamos cuentas de gasto (expense accounts)
          if (setters.availableExpenseAccounts) {
            const matchingAccount = setters.availableExpenseAccounts.find(acc => acc.account_name === accountNameFromGroup)
            if (matchingAccount) {
              newData.default_expense_account = matchingAccount.name
              console.log('Aplicando default_expense_account del grupo:', matchingAccount.name)
            } else {
              console.log('No se encontró cuenta correspondiente para:', expenseAccount.account)
            }
          }
        }
      }
    }
  }

  setEditedSupplierData(newData)
}

/**
 * Busca datos de AFIP por CUIT
 * @param {string} cuit - CUIT a buscar
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @param {function} setters - Objeto con setters necesarios
 * @param {function} showNotification - Función para mostrar notificaciones
 */
export const handleSearchAfip = async (cuit, fetchWithAuth, setters, showNotification) => {
  const { setConsultingAfip, setEditedSupplierData } = setters

  if (!cuit || !cuit.trim()) {
    showNotification('Por favor ingrese un CUIT', 'error')
    return
  }

  // Limpiar el CUIT y validar
  const cleanCuit = cuit.replace(/[-\s]/g, '')
  if (!validateCuit(cleanCuit)) {
    showNotification('El CUIT ingresado no es válido', 'error')
    return
  }

  setConsultingAfip(true)

  try {
    const result = await getAfipData(cleanCuit, fetchWithAuth)

    if (result.success) {
      const afipData = result.data

      // Parsear la dirección completa para separar componentes
      let parsedAddress = ''
      let parsedCity = afipData.localidad || '' // Usar directamente la localidad de AFIP
      let parsedPostalCode = afipData.codigo_postal || ''
      let parsedProvince = afipData.provincia || ''

      if (afipData.address) {
        // La dirección viene como: "DIRECCIÓN, LOCALIDAD, PROVINCIA, CP: CODIGO_POSTAL"
        const addressParts = afipData.address.split(', ')

        if (addressParts.length >= 1) {
          parsedAddress = addressParts[0].trim() // Primera parte es la dirección
        }

        // Si no tenemos localidad específica, intentar extraerla de la dirección
        if (!parsedCity && addressParts.length >= 2) {
          // Buscar si hay CP: en alguna parte
          const cpIndex = addressParts.findIndex(part => part.includes('CP:'))
          if (cpIndex !== -1) {
            // Extraer código postal si no lo tenemos
            if (!parsedPostalCode) {
              const cpPart = addressParts[cpIndex]
              const cpMatch = cpPart.match(/CP:\s*(\d+)/)
              if (cpMatch) {
                parsedPostalCode = cpMatch[1]
              }
            }

            // La ciudad es la parte inmediatamente antes del CP
            if (cpIndex > 1) {
              parsedCity = addressParts[cpIndex - 1].trim()
            }
          } else if (addressParts.length >= 2) {
            // No hay CP, la segunda parte podría ser ciudad o ciudad,provincia
            const secondPart = addressParts[1].trim()
            // Si contiene coma, tomar solo la primera parte como ciudad
            parsedCity = secondPart.split(',')[0].trim()
          }
        }

        // Extraer código postal si no lo tenemos
        if (!parsedPostalCode) {
          const cpPart = addressParts.find(part => part.includes('CP:'))
          if (cpPart) {
            const cpMatch = cpPart.match(/CP:\s*(\d+)/)
            if (cpMatch) {
              parsedPostalCode = cpMatch[1]
            }
          }
        }
      }

      // Llenar automáticamente los campos con los datos de AFIP
      // Solo actualizar los campos relacionados con AFIP, manteniendo los demás intactos
      setEditedSupplierData(prevData => ({
        ...prevData,
        supplier_name: afipData.business_name || afipData.name,
        tax_id: cleanCuit,
        custom_condicion_iva: afipData.tax_condition,
        address: parsedAddress,
        ciudad: parsedCity,
        codigo_postal: parsedPostalCode,
        provincia: parsedProvince,
        custom_personeria: afipData.personeria || '',
        custom_pais: afipData.pais || ''
      }))
      showNotification('Datos de AFIP cargados exitosamente', 'success')
    } else {
      showNotification(result.error, 'error')
    }
  } catch (error) {
    console.error('Error al consultar AFIP:', error)
    showNotification('Error al consultar AFIP', 'error')
  } finally {
    setConsultingAfip(false)
  }
}

/**
 * Crea un nuevo proveedor
 * @param {object} editedSupplierData - Datos del proveedor a crear
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @param {function} setters - Objeto con setters necesarios
 * @param {function} showNotification - Función para mostrar notificaciones
 */
export const handleCreateSupplier = async (editedSupplierData, fetchWithAuth, setters, showNotification) => {
  const { setSavingSupplier, setIsEditingSupplier, setSelectedSupplier, fetchSuppliers } = setters

  console.log('handleCreateSupplier called', { editedSupplierData })

  if (!editedSupplierData.supplier_name) {
    showNotification('El nombre del proveedor es requerido', 'error')
    return
  }

  try {
    setSavingSupplier(true)

    // Preparar datos agregando siglas antes de enviar al backend
    const preparedData = await prepareSupplierDataForBackend(editedSupplierData, fetchWithAuth)

    const response = await fetchWithAuth(`${API_ROUTES.suppliers}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ supplier: preparedData }),
    })

    console.log('Response received:', response)

    // Verificar si response es un Response object
    if (response && typeof response.json === 'function') {
      if (response.ok) {
        const data = await response.json()
        console.log('Success data:', data)
        showNotification('Proveedor creado exitosamente', 'success')
        setIsEditingSupplier(false)
        setSelectedSupplier(data.supplier.name)
        fetchSuppliers()

        // Si hay datos de dirección en el formulario, intentar crear/actualizar la dirección fiscal
        // para el proveedor recién creado. Requiere que el caller proporcione fetchSupplierAddresses
        if (setters.fetchSupplierAddresses && (editedSupplierData.address || editedSupplierData.ciudad || editedSupplierData.codigo_postal || editedSupplierData.provincia || editedSupplierData.pais)) {
          try {
            console.log('Attempting to save fiscal address after create for', data.supplier.name)
            await handleSaveFiscalAddress(data.supplier.name, editedSupplierData, fetchWithAuth, { fetchSupplierAddresses: setters.fetchSupplierAddresses, supplierAddresses: setters.supplierAddresses || [] }, showNotification)
          } catch (e) {
            console.error('Failed to save fiscal address during create:', e)
          }
        }
      } else {
        try {
          const errorData = await response.json()
          console.log('Error data:', errorData)
          showNotification(errorData.message || 'Error al crear el proveedor', 'error')
        } catch (jsonError) {
          console.error('Error parsing error response:', jsonError)
          showNotification(`Error al crear el proveedor (${response.status})`, 'error')
        }
      }
    } else {
      // Si response no es un Response object, asumir que es el data directo
      console.log('Response is not a Response object:', response)
      if (response && response.supplier) {
        showNotification('Proveedor creado exitosamente', 'success')
        setIsEditingSupplier(false)
        setSelectedSupplier(response.supplier.name)
        fetchSuppliers()
      } else {
        showNotification('Respuesta inesperada del servidor', 'error')
      }
    }
  } catch (error) {
    console.error('Error creating supplier:', error)
    showNotification('Error al crear el proveedor', 'error')
  } finally {
    setSavingSupplier(false)
  }
}

/**
 * Guarda cambios en un proveedor existente
 * @param {string} selectedSupplier - Proveedor seleccionado
 * @param {object} editedSupplierData - Datos editados del proveedor
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @param {function} setters - Objeto con setters necesarios
 * @param {function} showNotification - Función para mostrar notificaciones
 */
export const handleSaveSupplier = async (selectedSupplier, editedSupplierData, fetchWithAuth, setters, showNotification) => {
  const { setSavingSupplier, setIsEditingSupplier, fetchSuppliers, fetchSupplierDetails } = setters

  if (!selectedSupplier) return

  try {
    setSavingSupplier(true)
    const url = selectedSupplier === 'new' ? '/api/suppliers' : `/api/suppliers/${selectedSupplier}`
    const method = selectedSupplier === 'new' ? 'POST' : 'PUT'

    // Preparar datos agregando siglas antes de enviar al backend
    const preparedData = await prepareSupplierDataForBackend(editedSupplierData, fetchWithAuth)

    // Preparar los datos a enviar
    const dataToSend = { ...preparedData }
    // No enviar fecha_alta (es de solo lectura - campo creation de ERPNext)
    delete dataToSend.fecha_alta

    const response = await fetchWithAuth(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ supplier: dataToSend }),
    })

    if (response.ok) {
      const data = await response.json()
      showNotification('Proveedor guardado exitosamente', 'success')
      setIsEditingSupplier(false)
      fetchSuppliers()

      // Determine saved supplier name (in case we created a new one)
      const savedSupplierName = selectedSupplier === 'new' ? (data?.supplier?.name || '') : selectedSupplier

      // If the caller provided the fetchSupplierAddresses setter and we have address data, save fiscal address
      if (setters.fetchSupplierAddresses && (preparedData.address || preparedData.ciudad || preparedData.codigo_postal || preparedData.provincia || preparedData.pais)) {
        try {
          console.log('Attempting to save fiscal address after save for', savedSupplierName)
          await handleSaveFiscalAddress(savedSupplierName, editedSupplierData, fetchWithAuth, { fetchSupplierAddresses: setters.fetchSupplierAddresses, supplierAddresses: setters.supplierAddresses || [] }, showNotification)
        } catch (e) {
          console.error('Failed to save fiscal address during save:', e)
        }
      }

      // If we created a new supplier, and caller provided setSelectedSupplier, set it so UI selects new record
      if (selectedSupplier === 'new' && savedSupplierName && setters.setSelectedSupplier) {
        try { setters.setSelectedSupplier(savedSupplierName) } catch (e) { /* ignore */ }
      }

      if (savedSupplierName) {
        fetchSupplierDetails(savedSupplierName)
      }
    } else {
      const errorData = await response.json()
      showNotification(errorData.message || 'Error al guardar el proveedor', 'error')
    }
  } catch (error) {
    console.error('Error saving supplier:', error)
    showNotification('Error al guardar el proveedor', 'error')
  } finally {
    setSavingSupplier(false)
  }
}

/**
 * Elimina un proveedor
 * @param {string} selectedSupplier - Proveedor a eliminar
 * @param {object} supplierDetails - Detalles del proveedor
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @param {function} setters - Objeto con setters necesarios
 * @param {function} showNotification - Función para mostrar notificaciones
 */
export const handleDeleteSupplier = async (selectedSupplier, supplierDetails, fetchWithAuth, setters, showNotification) => {
  const { setSelectedSupplier, setSupplierDetails, fetchSuppliers, showConfirmModal } = setters

  if (!selectedSupplier) return

  showConfirmModal(
    'Eliminar Proveedor',
    `¿Estás seguro de que quieres eliminar el proveedor "${supplierDetails?.supplier_name || selectedSupplier}"? Esta acción no se puede deshacer.`,
    async () => {
      try {
        const response = await fetchWithAuth(`/api/suppliers/${selectedSupplier}`, {
          method: 'DELETE',
        })

        if (response.ok) {
          showNotification('Proveedor eliminado exitosamente', 'success')
          setSelectedSupplier(null)
          setSupplierDetails(null)
          fetchSuppliers()
        } else {
          const errorData = await response.json()
          showNotification(errorData.message || 'Error al eliminar el proveedor', 'error')
        }
      } catch (error) {
        console.error('Error deleting supplier:', error)
        showNotification('Error al eliminar el proveedor', 'error')
      }
    },
    null,
    'danger'
  )
}

/**
 * Obtiene la dirección fiscal de un proveedor
 * @param {array} supplierAddresses - Direcciones del proveedor
 * @returns {object|null} Dirección fiscal o null si no existe
 */
export const getFiscalAddress = (supplierAddresses) => {
  return supplierAddresses.find(address =>
    address.address_type === 'Billing' ||
    address.address_type === 'Dirección Fiscal' ||
    (address.address_type === 'Other' && address.custom_type === 'Fiscal')
  )
}

/**
 * Guarda la dirección fiscal de un proveedor
 * @param {string} selectedSupplier - Proveedor seleccionado
 * @param {object} editedSupplierData - Datos editados del proveedor
 * @param {function} fetchWithAuth - Función para hacer requests autenticados
 * @param {function} setters - Objeto con setters necesarios
 * @param {function} showNotification - Función para mostrar notificaciones
 */
export const handleSaveFiscalAddress = async (selectedSupplier, editedSupplierData, fetchWithAuth, setters, showNotification) => {
  const { fetchSupplierAddresses } = setters

  try {
    const fiscalAddress = getFiscalAddress(setters.supplierAddresses || [])
    if (fiscalAddress) {
      // Actualizar dirección fiscal existente
      const response = await fetchWithAuth(`/api/suppliers/${selectedSupplier}/addresses/${fiscalAddress.name}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Normalize address_type to ERPNext enum value 'Billing' to avoid validation errors
          address: {
            ...fiscalAddress,
            address_type: 'Billing',
            address_line1: editedSupplierData.address,
            city: editedSupplierData.ciudad,
            pincode: editedSupplierData.codigo_postal,
            state: editedSupplierData.provincia,
            country: editedSupplierData.pais,
          }
        }),
      })

      if (response.ok) {
        showNotification('Dirección fiscal actualizada', 'success')
        fetchSupplierAddresses(selectedSupplier)
      } else {
        showNotification('Error al actualizar dirección fiscal', 'error')
      }
    } else {
      // Crear nueva dirección fiscal
      const response = await fetchWithAuth(`/api/suppliers/${selectedSupplier}/addresses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Use ERPNext standard enum for billing addresses
          address: {
            address_type: 'Billing',
            address_title: 'Dirección Fiscal',
            address_line1: editedSupplierData.address,
            city: editedSupplierData.ciudad,
            pincode: editedSupplierData.codigo_postal,
            state: editedSupplierData.provincia,
            country: editedSupplierData.pais,
            custom_type: 'Fiscal'
          }
        }),
      })

      if (response.ok) {
        showNotification('Dirección fiscal creada', 'success')
        fetchSupplierAddresses(selectedSupplier)
      } else {
        showNotification('Error al crear dirección fiscal', 'error')
      }
    }
  } catch (error) {
    console.error('Error saving fiscal address:', error)
    showNotification('Error al guardar dirección fiscal', 'error')
  }
}
