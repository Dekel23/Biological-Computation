import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO, addDays } from '../dates'

async function freshApi() {
  vi.resetModules()
  const { localApi } = await import('../localApi')
  await localApi.startFresh({ name: 'Yoav', language: 'he' })
  return localApi
}

const dm = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`
const today = todayISO()

describe('automatic payments (phone mode)', () => {
  beforeEach(async () => {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('bottom-line')
      req.onsuccess = req.onerror = req.onblocked = resolve
    })
  })

  it('logs a card SMS once, categorised by merchant, and ignores codes', async () => {
    const api = await freshApi()
    const sms = `ישראכרט: בכרטיסך המסתיים ב-1234 אושרה עסקה ב-${dm(today)} בסך 52.00 ש"ח בבית העסק ארומה תל אביב.`
    const first = await api.logSms(sms)
    expect(first.status).toBe('logged')
    expect(first.transaction).toMatchObject({ amount: -52, merchant: 'ארומה תל אביב', source: 'sms', account_label: 'Isracard ••1234' })
    expect(first.transaction.category.key).toBe('coffee')
    expect((await api.logSms(sms)).status).toBe('duplicate')
    expect((await api.logSms('קוד האימות לעסקה בסך 120 ש"ח הוא 483920')).status).toBe('ignored')
    expect((await api.transactions()).total).toBe(1)
  })

  it('logs a pasted batch', async () => {
    const api = await freshApi()
    const res = await api.logSmsBatch('Max: עסקה בסך 89.90 ₪ ב-WOLT\n\nMax: עסקה בסך 18 ₪ ב-COFIX\n\nקוד: 123456')
    expect(res).toMatchObject({ logged: 2, ignored: 1, duplicates: 0 })
  })

  it('imports a statement once and pairs rows with SMS-logged charges', async () => {
    const api = await freshApi()
    await api.logSms(`Max: אושרה עסקה בכרטיס 5678 ב-WOLT בסך 89.90 ₪ בתאריך ${dm(today)}`)
    const rows = [
      { date: addDays(today, -1), merchant: 'WOLT TEL AVIV', amount: -89.9 }, // the same charge, a day apart
      { date: today, merchant: 'שופרסל דיל', amount: -214.3 },
      { date: today, merchant: 'קפה קפה', amount: -24 },
      { date: today, merchant: 'קפה קפה', amount: -24 }, // two identical coffees are both real
    ]
    expect(await api.importStatement({ rows, label: 'Max' })).toEqual({ created: 3, duplicates: 1 })
    expect(await api.importStatement({ rows, label: 'Max' })).toEqual({ created: 0, duplicates: 4 })
    const page = await api.transactions()
    expect(page.total).toBe(4)
    expect(page.items.filter((tx) => tx.merchant === 'קפה קפה')).toHaveLength(2)
  })

  it('replaces an SMS’s estimated foreign amount with the billed shekel amount', async () => {
    const api = await freshApi()
    const sms = await api.logSms(`Isracard: Purchase of USD 17.99 at NETFLIX.COM approved on ${dm(today)} on card ending 1234`)
    expect(sms.transaction.amount).toBe(-66.56)
    expect(await api.importStatement({ label: 'Isracard', rows: [{ date: today, merchant: 'NETFLIX.COM', amount: -65.2 }] })).toEqual({ created: 0, duplicates: 1 })
    const page = await api.transactions()
    expect(page.items.map((tx) => tx.amount)).toEqual([-65.2])
  })

  it('does not count the bank’s card-bill payment as spending', async () => {
    const api = await freshApi()
    await api.importStatement({
      label: 'Otsar HaHayal',
      rows: [
        { date: today, merchant: 'ישראכרט', amount: -3420.17 },
        { date: today, merchant: 'משיכת מזומן כספומט', amount: -200 },
      ],
    })
    await api.importStatement({ label: 'Isracard', rows: [{ date: today, merchant: 'שופרסל דיל', amount: -300 }] })
    const { bottom_line: bl } = await api.summary()
    expect(bl.variable_expenses).toBe(500) // groceries 300 + unlogged cash 200, not the 3,420 bill
    expect(bl.categories.map((c) => c.key)).not.toContain('card_bill')
  })

  it('adds the new category to data saved by an older version', async () => {
    let api = await freshApi()
    const backup = await api.exportBackup()
    backup.categories = backup.categories.filter((c) => c.key !== 'card_bill')
    await api.importBackup(backup)
    vi.resetModules()
    api = (await import('../localApi')).localApi
    expect((await api.categories()).map((c) => c.key)).toContain('card_bill')
  })
})
