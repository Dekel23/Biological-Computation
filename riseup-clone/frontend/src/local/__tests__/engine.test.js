// Parity tests: the same cases as backend/tests, run against the on-device engine.
import { describe, expect, it } from 'vitest'
import { computeBottomLine } from '../calculator'
import { Categorizer, matchKeyword, merchantKey, normalize } from '../categorizer'
import { detectSubscriptions, goalsOverview } from '../insights'
import { parseMessage } from '../nlpParser'
import { handleInbound } from '../bot'
import { demoState, emptyState, makeNextId } from '../seed'
import { syncAccount } from '../bankSync'

const cat = (state, key) => state.categories.find((c) => c.key === key)

function fresh() {
  const state = emptyState({ name: 'Test' })
  state.user.expected_monthly_income = 10000
  return { state, nextId: makeNextId(state) }
}

function addTx(state, nextId, key, amount, { date = '2026-03-05', source = 'bank', merchant = 'x' } = {}) {
  const tx = { id: nextId('tx'), date, amount, merchant, category_id: cat(state, key).id, source, category_source: 'keyword', category_confidence: 0.85, created_at: new Date().toISOString() }
  state.transactions.push(tx)
  return tx
}

describe('categorizer', () => {
  it('normalizes Hebrew', () => {
    expect(normalize('שָׁלוֹם')).toBe(normalize('שלומ'))
    expect(normalize('סופר-פארם')).toBe('סופר פארמ')
    expect(normalize("קפה ג'ו")).toBe('קפה גו')
  })

  it('builds merchant keys', () => {
    expect(merchantKey('COFIX 223')).toBe('cofix')
    expect(merchantKey('שופרסל בע"מ סניף 12')).toBe('שופרסל')
    expect(merchantKey('012')).toBe('012')
  })

  it.each([
    ['ארומה תל אביב', 'coffee'], ['AROMA ESPRESSO BAR', 'coffee'], ['בקפה', 'coffee'], ['שופרסל דיל', 'groceries'],
    ['RAMI LEVY SHIVUK', 'groceries'], ['סופר-פארם', 'health'], ['NETFLIX.COM', 'subscriptions'], ['פז YELLOW', 'fuel'],
    ['רב קו', 'transport'], ['WOLT', 'restaurants'], ['משכורת חודש מאי', 'salary'],
  ])('keyword %s → %s', (text, key) => expect(matchKeyword(text)).toBe(key))

  it('needs word boundaries for short latin keywords', () => expect(matchKeyword('TENANT SERVICES')).not.toBe('fuel'))

  it('falls back to MCC and defaults; keeps income in income categories', () => {
    const { state } = fresh()
    const c = new Categorizer(state)
    expect(c.categorize("ג'ירף נורדאו", -120, '5812')).toMatchObject({ key: 'restaurants', source: 'mcc' })
    expect(c.categorize('חנות הפרחים של רינה', -80, '5992')).toMatchObject({ key: 'other', source: 'default' })
    expect(c.categorize('Unknown payer', 500).key).toBe('other_income')
    expect(c.categorize('bit from Noa', 120).key).toBe('other_income')
    expect(c.categorize('BIT transfer to Noa', -120).key).toBe('transfers')
  })

  it('learns from overrides, never touching manual choices', () => {
    const { state, nextId } = fresh()
    const a = addTx(state, nextId, 'other', -80, { merchant: 'חנות הפרחים של רינה' })
    const b = addTx(state, nextId, 'other', -80, { merchant: 'חנות הפרחים של רינה' })
    const manual = addTx(state, nextId, 'kids', -80, { merchant: 'חנות הפרחים של רינה' })
    manual.category_source = 'user'
    const c = new Categorizer(state)
    expect(c.learn('חנות הפרחים של רינה', 'shopping', nextId)).toBe(2)
    expect([a, b].map((tx) => tx.category_id)).toEqual([cat(state, 'shopping').id, cat(state, 'shopping').id])
    expect(manual.category_id).toBe(cat(state, 'kids').id)
    expect(c.categorize('חנות הפרחים של רינה סניף 2', -50).key).toBe('shopping')
    expect(c.categorize('חנות הפרחים של רינא', -50)).toMatchObject({ key: 'shopping', source: 'fuzzy_rule' })
  })
})

describe('parser', () => {
  const TODAY = '2026-03-15'
  it.each([
    ['I spent 50 on coffee', 'expense', 50, 'coffee', 'en'],
    ['הוצאתי 50 שקל על קפה', 'expense', 50, 'קפה', 'he'],
    ['120 groceries', 'expense', 120, 'groceries', 'en'],
    ['₪1,250.50 ikea', 'expense', 1250.5, 'ikea', 'en'],
    ['paid 2k for rent', 'expense', 2000, 'rent', 'en'],
    ['fifty on lunch', 'expense', 50, 'lunch', 'en'],
    ['two thousand five hundred for a laptop', 'expense', 2500, 'laptop', 'en'],
    ['חמישים שקל פלאפל', 'expense', 50, 'פלאפל', 'he'],
    ['שלוש מאות וחמישים על סופר', 'expense', 350, 'סופר', 'he'],
    ['אלפיים וחמש מאות שכר דירה', 'expense', 2500, 'שכר דירה', 'he'],
    ['got paid 3000', 'income', 3000, null, 'en'],
    ['קיבלתי 200 החזר', 'income', 200, null, 'he'],
    ['budget coffee 300', 'set_budget', 300, 'coffee', 'en'],
    ['תקציב קפה 300', 'set_budget', 300, 'קפה', 'he'],
  ])('%s', (text, intent, amount, description, language) => {
    const p = parseMessage(text, 'en', TODAY)
    expect(p).toMatchObject({ intent, amount, language })
    if (description !== null) expect(p.description).toBe(description)
  })

  it.each([
    ['how much can I spend?', 'balance'], ['כמה נשאר?', 'balance'], ['summary', 'summary'], ['סיכום שבועי', 'summary'],
    ['budget', 'budget'], ['goals', 'goals'], ['undo', 'undo'], ['ביטול', 'undo'], ['?', 'help'], ['blah blah', 'unknown'],
  ])('command %s', (text, intent) => expect(parseMessage(text, 'en', TODAY).intent).toBe(intent))

  it('handles yesterday and merchants', () => {
    const p = parseMessage('paid 89.90 at Super Pharm yesterday', 'en', TODAY)
    expect(p.txDate).toBe('2026-03-14')
    expect(p.merchant).toBe('Super Pharm')
  })
})

describe('calculator', () => {
  const TODAY = '2026-03-11'
  it('computes free to spend', () => {
    const { state, nextId } = fresh()
    state.user.expected_monthly_income = 0
    addTx(state, nextId, 'salary', 12000, { date: '2026-03-10' })
    addTx(state, nextId, 'rent', -4000, { date: '2026-03-01' })
    addTx(state, nextId, 'groceries', -1000)
    addTx(state, nextId, 'coffee', -100)
    const bl = computeBottomLine(state, '2026-03', TODAY)
    expect(bl).toMatchObject({ total_income: 12000, fixed_expenses: 4000, variable_expenses: 1100, free_to_spend: 6900, days_left: 21 })
  })

  it('reserves planned fixed costs and projects income', () => {
    const { state, nextId } = fresh()
    state.fixedExpenses.push({ id: 1, name: 'Rent', amount: 4000, category_id: cat(state, 'rent').id, day_of_month: 1 })
    state.fixedExpenses.push({ id: 2, name: 'Ins', amount: 300, category_id: cat(state, 'insurance').id, day_of_month: 1 })
    addTx(state, nextId, 'insurance', -320)
    const bl = computeBottomLine(state, '2026-03', TODAY)
    expect(bl).toMatchObject({ income_is_projected: true, total_income: 10000, fixed_expenses: 4320, fixed_pending: 4000 })
  })

  it('does not double count cash', () => {
    const { state, nextId } = fresh()
    addTx(state, nextId, 'cash', -500)
    addTx(state, nextId, 'coffee', -30, { source: 'cash' })
    addTx(state, nextId, 'restaurants', -70, { source: 'cash' })
    expect(computeBottomLine(state, '2026-03', TODAY)).toMatchObject({ variable_expenses: 500, unallocated_cash: 400 })
    addTx(state, nextId, 'groceries', -600, { source: 'cash' })
    const bl = computeBottomLine(state, '2026-03', TODAY)
    expect(bl).toMatchObject({ variable_expenses: 700, unallocated_cash: 0 })
    expect(bl.daily_series[10].actual).toBe(700)
  })
})

describe('insights, bot and demo data', () => {
  it('detects a subscription price hike and ignores irregular merchants', () => {
    const { state, nextId } = fresh()
    ;[54.9, 54.9, 54.9, 64.9].forEach((amount, i) =>
      addTx(state, nextId, 'subscriptions', -amount, { date: `2026-0${3 + i}-03`, merchant: 'NETFLIX.COM' }),
    )
    for (const d of ['2026-05-02', '2026-05-10', '2026-05-13', '2026-05-26', '2026-06-10']) addTx(state, nextId, 'other', -40, { date: d, merchant: 'Random Kiosk' })
    const radar = detectSubscriptions(state, 200, '2026-06-20')
    expect(radar.items.map((s) => s.merchant)).toEqual(['NETFLIX.COM'])
    expect(radar.price_hikes[0].price_change_pct).toBe(18.2)
  })

  it('logs bot expenses in either language and sends alerts in that language', () => {
    const { state, nextId } = fresh()
    state.budgets.push({ id: 1, category_id: cat(state, 'coffee').id, monthly_limit: 100 })
    const he = handleInbound(state, nextId, 'הוצאתי 120 שקל על קפה')
    expect(he.transaction).toMatchObject({ amount: -120, source: 'cash', category_id: cat(state, 'coffee').id })
    expect(he.reply.body).toContain('נרשם')
    expect(he.alerts).toHaveLength(1)
    expect(he.alerts[0].body).toContain('חרגת')
    const en = handleInbound(state, nextId, 'I spent 40 on groceries')
    expect(en.reply.body).toContain('Logged')
    handleInbound(state, nextId, 'undo')
    expect(state.transactions).toHaveLength(1)
  })

  it('builds a realistic demo and re-syncs without duplicates', () => {
    const today = '2026-10-19'
    const state = demoState({ today })
    expect(state.transactions.length).toBeGreaterThan(300)
    const bl = computeBottomLine(state, null, today)
    expect(bl.free_to_spend).toBeGreaterThan(0)
    expect(detectSubscriptions(state, 200, today).price_hikes.map((h) => h.merchant)).toContain('NETFLIX.COM')
    expect(goalsOverview(state, today).items).toHaveLength(2)
    const before = state.transactions.length
    state.accounts.forEach((a) => syncAccount(state, a, makeNextId(state), { since: '2026-10-01', until: today, today }))
    expect(state.transactions.length).toBe(before)
  })
})
