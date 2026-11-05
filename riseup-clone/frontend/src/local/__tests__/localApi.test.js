import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Each test gets a fresh module (and so a fresh in-memory queue) over the same IndexedDB.
async function loadApi() {
  vi.resetModules()
  return (await import('../localApi')).localApi
}

describe('localApi (phone mode)', () => {
  beforeEach(async () => {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('bottom-line')
      req.onsuccess = req.onerror = req.onblocked = resolve
    })
  })

  it('seeds demo data on first launch and persists changes across reloads', async () => {
    let api = await loadApi()
    const summary = await api.summary()
    expect(summary.demo).toBe(true)
    expect(summary.bank_accounts).toBe(2)

    const res = await api.botSend('הוצאתי 50 שקל על קפה')
    expect(res.transaction.category.key).toBe('coffee')

    api = await loadApi() // simulates closing and reopening the app
    const page = await api.transactions({ source: 'cash' })
    expect(page.items.map((tx) => tx.amount)).toContain(-50)
  })

  it('rejects invalid input with server-style errors', async () => {
    const api = await loadApi()
    await expect(api.createTransaction({ amount: 0, merchant: 'x', kind: 'expense' })).rejects.toThrow('greater than 0')
    const tx = await api.createTransaction({ amount: 30, merchant: 'Aroma', kind: 'expense' })
    await expect(api.setCategory(tx.id, 'salary')).rejects.toThrow('does not match')
    const bankTx = (await api.transactions({ source: 'bank' })).items[0]
    await expect(api.deleteTransaction(bankTx.id)).rejects.toThrow('read-only')
  })

  it('starts fresh, restores a backup and keeps it after reload', async () => {
    let api = await loadApi()
    await api.createGoal({ name: 'Car', target_amount: 12000 })
    const backup = await api.exportBackup()

    await api.startFresh({ name: 'Yoav', language: 'he' })
    let summary = await api.summary()
    expect(summary).toMatchObject({ demo: false, bank_accounts: 0 })
    expect(summary.user).toMatchObject({ name: 'Yoav', language: 'he' })
    expect((await api.transactions()).total).toBe(0)

    await api.importBackup(backup)
    api = await loadApi()
    expect((await api.goals()).items.map((g) => g.name)).toContain('Car')
    await expect(api.importBackup({ hello: 'world' })).rejects.toThrow('not a Bottom Line backup')
  })

  it('runs scheduled jobs once: weekly summary after Sunday 09:00, daily update after 20:30', async () => {
    const api = await loadApi()
    await api.updateSettings({ daily_update_enabled: true })
    const backup = await api.exportBackup()
    backup.created_at = '2020-01-01T00:00:00.000Z' // the app existed before the last Sunday
    await api.importBackup(backup)

    const evening = new Date()
    evening.setHours(21, 0, 0, 0)
    const first = await api.runDueJobs(evening)
    const kinds = first.sent.map((m) => m.kind)
    expect(kinds).toContain('weekly_summary')
    expect(kinds).toContain('free_to_spend')
    const again = await api.runDueJobs(evening)
    expect(again.sent.filter((m) => m.kind !== 'budget_alert')).toHaveLength(0)
    expect(await api.unread()).toBeGreaterThan(0)
  })
})
