import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHandleItemChange } from '../invoiceModalHandlers.js'
import { calculateItemAmount } from '../invoiceModalCalculations.js'
import { addItemsFromAssociatedInvoices, createHandleUnpaidInvoiceSelection } from '../invoiceModalCreditNotes.js'

describe('InvoiceModal handlers', () => {
  describe('createHandleItemChange', () => {
    it('keeps qty positive and recalculates amount', () => {
      let state = {
        invoice_type: 'Nota de Crédito',
        items: [
          { qty: '2', rate: '10.00', discount_amount: '0.00', iva_percent: '0.00', amount: '20.00' }
        ]
      }

      const setFormData = (updater) => { state = updater(state) }
      const handler = createHandleItemChange(setFormData)

      handler(0, 'qty', '-3')

      expect(state.items[0].qty).toBe('3')
      // amount should be qty * rate = 3 * 10 = 30.00
      expect(parseFloat(state.items[0].amount)).toBeCloseTo(30.00, 2)
    })
  })

  describe('addItemsFromAssociatedInvoices', () => {
    beforeEach(() => {
      // reset mocks
      vi.restoreAllMocks()
    })

    it('imports items with positive qty and negative rate/amount for credit notes', async () => {
      // Mock invoice details
      const invoiceDetails = {
        items: [
          { item_code: 'ITEM1', item_name: 'Item 1', description: 'Desc', warehouse: 'W', cost_center: 'C', uom: 'Unidad', qty: 2, rate: 100.0, amount: 200.0, iva_percent: 21.0, account: 'ACCT' }
        ]
      }

      // Prepare a fetchWithAuth mock that returns the invoice details
      const fetchWithAuthMock = vi.fn(async (endpoint) => ({ ok: true, json: async () => ({ success: true, data: invoiceDetails }) }))

      let state = {
        items: [ { item_code: '', item_name: '', description: '', qty: '1', rate: '0.00', amount: '0.00' } ]
      }

      const setFormData = (updater) => { state = updater(state) }
      const showNotification = vi.fn()

      const selectedInvoices = [{ name: 'INV-1', amount: 200 }]

      await addItemsFromAssociatedInvoices(selectedInvoices, fetchWithAuthMock, setFormData, showNotification)

      // After import, items should include the invoice item
      expect(state.items.length).toBeGreaterThan(0)
      const imported = state.items.find(i => i.item_code === 'ITEM1' || i.original_invoice === 'INV-1') || state.items[1]

      // qty should be positive
      expect(parseFloat(imported.qty)).toBeGreaterThan(0)
      // rate should be negative to reflect credit
      expect(parseFloat(imported.rate)).toBeLessThan(0)
      // amount should be negative
      expect(parseFloat(imported.amount)).toBeLessThan(0)
    })
  })

  describe('createHandleUnpaidInvoiceSelection', () => {
    it('selecting a conciliation group uses signed outstanding amounts and sets credit_note_total to net', () => {
      // invoices: three positive and one negative so abs sum > net
      const unpaidInvoices = [
        { name: 'INV-1', outstanding_amount: '100000', custom_conciliation_id: 'CONC-1' },
        { name: 'INV-2', outstanding_amount: '90000', custom_conciliation_id: 'CONC-1' },
        { name: 'INV-3', outstanding_amount: '46235', custom_conciliation_id: 'CONC-1' },
        { name: 'INV-4', outstanding_amount: '-38115', custom_conciliation_id: 'CONC-1' }
      ]

      let state = { selected_unpaid_invoices: [], credit_note_total: '0.00' }
      const setFormData = (updater) => { state = updater(state) }
      const showNotification = vi.fn()

      const handler = createHandleUnpaidInvoiceSelection(setFormData, unpaidInvoices, showNotification)

      handler('CONC|CONC-1', true)

      // After selection, we should have 4 selected invoices
      expect(state.selected_unpaid_invoices.length).toBe(4)

      // Net (signed) sum: 100000 + 90000 + 46235 - 38115 = 198120
      expect(state.credit_note_total).toBe('198120.00')
    })

    it('when selecting a conciliation in payments, the applied total equals the conciliation net', () => {
      const unpaidInvoices = [
        { name: 'INV-A', outstanding_amount: '68970.00', custom_conciliation_id: 'CONC-1' },
        { name: 'INV-B', outstanding_amount: '-30250.00', custom_conciliation_id: 'CONC-1' },
        { name: 'INV-C', outstanding_amount: '211750.00', custom_conciliation_id: 'CONC-1' },
        { name: 'INV-D', outstanding_amount: '-42350.00', custom_conciliation_id: 'CONC-1' }
      ]

      // Simulate the PaymentModal invoiceSelections initial state
      const prev = {}
      unpaidInvoices.forEach(inv => {
        prev[inv.name] = { selected: false, saldo_aplicado: 0, saldo_anterior: parseFloat(inv.outstanding_amount) }
      })

      // Simulate selecting the conciliation group (CONC|CONC-1)
      const groupInvoices = unpaidInvoices.filter(inv => inv.custom_conciliation_id === 'CONC-1')
      const updated = {}
      Object.entries(prev).forEach(([k, v]) => {
        updated[k] = { ...v, selected: false, saldo_aplicado: 0, saldo: v.saldo_anterior }
      })
      groupInvoices.forEach(inv => {
        const key = inv.name
        const parsed = parseFloat(inv.outstanding_amount) || 0
        updated[key] = { ...updated[key], selected: true, saldo_aplicado: parsed, saldo: 0 }
      })

      const selected_unpaid_invoices = Object.entries(updated).filter(([k, s]) => s.selected).map(([k, s]) => ({ name: k, amount: s.saldo_aplicado || 0 }))
      const credit_note_total = Math.abs(Object.values(updated).reduce((sum, s) => sum + (s.selected ? (parseFloat(s.saldo_aplicado) || 0) : 0), 0))

      // Group net: 68970 - 30250 + 211750 - 42350 = 208120
      expect(selected_unpaid_invoices.length).toBe(4)
      expect(credit_note_total).toBe(208120)
    })
  })
})
