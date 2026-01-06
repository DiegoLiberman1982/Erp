import API_ROUTES from '../../../apiRoutes'

// Helpers for Sales Price List frontend fetches

export async function fetchSalesKits(fetchWithAuth, company) {
  try {
    const params = company ? `?company=${encodeURIComponent(company)}` : ''
    const url = `${API_ROUTES.salesPriceListKits}${params}`
    console.log('fetchSalesKits: Fetching kits from', url)
    const response = await fetchWithAuth(url)
    console.log('fetchSalesKits: Response status', response.status)
    if (response.ok) {
      const data = await response.json()
      return data.data || []
    } else {
      console.error('fetchSalesKits: Response not ok', response.status, response.statusText)
      return []
    }
  } catch (error) {
    console.error('fetchSalesKits: Error fetching kits', error)
    return []
  }
}

export async function fetchSalesPriceListDetails(fetchWithAuth, priceListName, itemType = null, company = null) {
  try {
    if (!priceListName) return null
    let url = `${API_ROUTES.salesPriceList}${encodeURIComponent(priceListName)}`
    const params = []
    if (itemType) params.push(`item_type=${encodeURIComponent(itemType)}`)
    if (company) params.push(`company=${encodeURIComponent(company)}`)
    if (params.length > 0) {
      url += `?${params.join('&')}`
    }
    console.log('fetchSalesPriceListDetails: Fetching price list details from', url)
    const response = await fetchWithAuth(url)
    console.log('fetchSalesPriceListDetails: Response status', response.status)
    if (response.ok) {
      const data = await response.json()
      return data
    } else {
      console.error('fetchSalesPriceListDetails: Response not ok', response.status, response.statusText)
      return null
    }
  } catch (error) {
    console.error('fetchSalesPriceListDetails: Error fetching details', error)
    return null
  }
}
