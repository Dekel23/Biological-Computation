/**
 * Phone mode: the same API the screens use in server mode (src/api.js), implemented
 * on the device. Responses have the same shapes as the FastAPI backend.
 */
import { ApiError } from '../apiError'
import { syncAccount } from './bankSync'
import { handleInbound } from './bot'
import { computeBottomLine, monthlyTrend } from './calculator'
import { Categorizer } from './categorizer'
import { daysBetween, monthBounds, round2, toISO, todayISO } from './dates'
import { hashString } from './hash'
import { detectSubscriptions, goalsOverview } from './insights'
import { buildBalanceMessage, buildDailyUpdate, buildWeeklySummary, checkBudgetAlerts, sendMessage } from './notifications'
import { demoState, emptyState, ensureCategories, makeNextId } from './seed'
import { parseSms, splitMessages } from './smsParser'
import { createQueue, readState, requestPersistence, validateBackup } from './store'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP']
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

function initialLanguage() {
  try {
    return localStorage.getItem('lang') === 'he' ? 'he' : 'en'
  } catch {
    return 'en'
  }
}

const queue = createQueue(async () => {
  const saved = await readState()
  if (saved) return ensureCategories(saved)
  requestPersistence()
  return demoState({ language: initialLanguage() })
})

const read = (fn) => queue.run((state) => clone(fn(state)))
const write = (fn) => queue.run((state) => clone(fn(state, makeNextId(state))), { mutate: true })

/* ------------------------------------------------------------- helpers */
function categoryOut(state, id) {
  const c = state.categories.find((cat) => cat.id === id)
  return { id: c.id, key: c.key, name_en: c.name_en, name_he: c.name_he, icon: c.icon, color: c.color, is_fixed: c.is_fixed, is_income: c.is_income }
}

function txOut(state, tx) {
  return {
    id: tx.id, date: tx.date, amount: tx.amount, merchant: tx.merchant, description: tx.description ?? null,
    mcc: tx.mcc ?? null, source: tx.source, category_source: tx.category_source,
    category_confidence: tx.category_confidence, category: categoryOut(state, tx.category_id), account_id: tx.account_id ?? null,
    account_label: tx.account_label ?? null,
  }
}

function getCategory(state, key) {
  const cat = state.categories.find((c) => c.key === key)
  if (!cat) throw new ApiError(422, `Unknown category '${key}'`)
  return cat
}

function checkMonth(month) {
  if (month && !MONTH_RE.test(month)) throw new ApiError(422, 'month must be YYYY-MM')
  return month || null
}

function positive(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new ApiError(422, `${field} must be greater than 0`)
  return n
}

function syncAll(state, nextId) {
  let created = 0
  const accounts = state.accounts.map((account) => {
    const txs = syncAccount(state, account, nextId)
    created += txs.length
    return { account_id: account.id, created: txs.length }
  })
  if (created) checkBudgetAlerts(state, nextId)
  return { accounts, created }
}

/**
 * The same payment arriving twice: once by SMS on the day, once in a statement import.
 * Same direction, same amount (within 5% when the SMS was in a foreign currency),
 * dates at most 3 days apart, and not already paired with another one.
 */
function findCounterpart(state, { amount, date, foreign }, source) {
  return state.transactions.find(
    (tx) =>
      tx.source === source && !tx.paired && Math.sign(tx.amount) === Math.sign(amount) &&
      Math.abs(daysBetween(tx.date, date)) <= 3 &&
      (foreign || tx.foreign
        ? Math.abs(Math.abs(tx.amount) - Math.abs(amount)) <= 0.05 * Math.abs(amount)
        : Math.abs(tx.amount - amount) < 0.01),
  )
}

function logOneSms(state, nextId, text, sender) {
  const parsed = parseSms(text, { sender })
  if (parsed.type === 'ignore') return { status: 'ignored', reason: parsed.reason }
  const smsHash = hashString(text.replace(/\s+/g, ' ').trim())
  if (state.transactions.some((tx) => tx.sms_hash === smsHash)) return { status: 'duplicate' }

  const amount = parsed.type === 'debit' ? -parsed.amountILS : parsed.amountILS
  const foreign = parsed.currency !== 'ILS'
  const twin = findCounterpart(state, { amount, date: parsed.date, foreign }, 'import')
  if (twin) {
    twin.paired = true
    twin.sms_hash = smsHash
    return { status: 'duplicate', transaction: txOut(state, twin) }
  }

  const card = parsed.issuer ? `${parsed.issuer}${parsed.last4 ? ` ••${parsed.last4}` : ''}` : parsed.last4 ? `••${parsed.last4}` : null
  const merchant = parsed.merchant || card || 'Card payment'
  const tx = {
    id: nextId('tx'), account_id: null, external_id: null, date: parsed.date, amount: round2(amount), merchant,
    mcc: null, description: foreign ? `${parsed.currency} ${parsed.amount} (≈)` : null, source: 'sms', account_label: card,
    sms_hash: smsHash, foreign, category_id: null, category_source: 'default', category_confidence: 0,
    created_at: new Date().toISOString(),
  }
  // Categorise on the merchant only: the SMS text names the card company, which is not what was bought.
  const categorizer = new Categorizer(state)
  const res = categorizer.categorize(merchant, tx.amount)
  Object.assign(tx, { category_id: categorizer.categoryId(res.key), category_source: res.source, category_confidence: res.confidence })
  state.transactions.push(tx)
  return { status: 'logged', transaction: txOut(state, tx) }
}

/* ----------------------------------------------------------- the API */
export const localApi = {
  summary: (month) =>
    read((state) => {
      const subs = detectSubscriptions(state)
      const goals = goalsOverview(state)
      return {
        user: { name: state.user.name, currency: state.user.currency, language: state.user.language },
        bottom_line: computeBottomLine(state, checkMonth(month)),
        trend: monthlyTrend(state, 6),
        highlights: {
          subscriptions_monthly: subs.subscriptions_monthly,
          recurring_monthly: subs.total_monthly,
          price_hikes: subs.price_hikes.slice(0, 3),
          goals_required_monthly: goals.total_required_monthly,
          goals_affordable: goals.affordable,
        },
        bank_accounts: state.accounts.length,
        demo: !!state.meta.demo,
      }
    }),
  categories: () => read((state) => [...state.categories].sort((a, b) => a.sort_order - b.sort_order).map((c) => categoryOut(state, c.id))),

  transactions: ({ month, category, q, source, limit = 200, offset = 0 } = {}) =>
    read((state) => {
      const [first, last] = monthBounds(checkMonth(month))
      const catId = category ? getCategory(state, category).id : null
      const needle = (q || '').trim().toLowerCase()
      const rows = state.transactions
        .filter(
          (tx) =>
            tx.date >= first && tx.date <= last && (!catId || tx.category_id === catId) && (!source || tx.source === source) &&
            (!needle || tx.merchant.toLowerCase().includes(needle) || (tx.description || '').toLowerCase().includes(needle)),
        )
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
      return {
        items: rows.slice(offset, offset + limit).map((tx) => txOut(state, tx)),
        total: rows.length,
        income: round2(rows.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0)),
        expenses: round2(-rows.filter((tx) => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0)),
      }
    }),

  createTransaction: (body) =>
    write((state, nextId) => {
      const merchant = String(body.merchant || '').trim()
      if (!merchant) throw new ApiError(422, 'merchant must not be blank')
      const amount = round2(body.kind === 'income' ? positive(body.amount, 'amount') : -positive(body.amount, 'amount'))
      const tx = {
        id: nextId('tx'), account_id: null, external_id: null, date: body.date || todayISO(), amount, merchant: merchant.slice(0, 160),
        mcc: null, description: body.description || null, source: 'manual', category_id: null,
        category_source: 'default', category_confidence: 0, created_at: new Date().toISOString(),
      }
      if (body.category_key) {
        const cat = getCategory(state, body.category_key)
        if (cat.is_income !== amount > 0) throw new ApiError(422, 'Category does not match income/expense')
        Object.assign(tx, { category_id: cat.id, category_source: 'user', category_confidence: 1 })
      } else {
        new Categorizer(state).apply(tx)
      }
      state.transactions.push(tx)
      if (amount < 0) checkBudgetAlerts(state, nextId)
      return txOut(state, tx)
    }),

  setCategory: (id, categoryKey, learn = true) =>
    write((state, nextId) => {
      const tx = state.transactions.find((x) => x.id === id)
      if (!tx) throw new ApiError(404, 'Transaction not found')
      const cat = getCategory(state, categoryKey)
      if (cat.is_income !== tx.amount > 0) throw new ApiError(422, 'Category does not match income/expense')
      Object.assign(tx, { category_id: cat.id, category_source: 'user', category_confidence: 1 })
      const recategorized = learn ? new Categorizer(state).learn(tx.merchant, cat.key, nextId) : 0
      checkBudgetAlerts(state, nextId)
      return { transaction: txOut(state, tx), learned: learn, recategorized }
    }),

  deleteTransaction: (id) =>
    write((state) => {
      const tx = state.transactions.find((x) => x.id === id)
      if (!tx) throw new ApiError(404, 'Transaction not found')
      if (tx.source === 'bank') throw new ApiError(409, 'Bank transactions are read-only')
      // Deleting one half of an SMS/statement pair frees the other to pair again.
      if (tx.sms_hash) for (const other of state.transactions) if (other !== tx && other.sms_hash === tx.sms_hash) other.paired = false
      state.transactions = state.transactions.filter((x) => x.id !== id)
      for (const m of state.messages) if (m.transaction_id === id) m.transaction_id = null
      return null
    }),

  accounts: () => read((state) => state.accounts),
  syncBank: () => write((state, nextId) => syncAll(state, nextId)),

  settings: () => read((state) => state.user),
  updateSettings: (body) =>
    write((state) => {
      const next = { ...state.user }
      for (const [field, value] of Object.entries(body)) {
        if (field === 'name') {
          if (value === null || value === undefined) continue
          if (!String(value).trim()) throw new ApiError(422, 'name must not be blank')
          next.name = String(value).trim().slice(0, 120)
        } else if (field === 'language') {
          if (!['en', 'he'].includes(value)) throw new ApiError(422, 'language must be en or he')
          next.language = value
        } else if (field === 'currency') {
          if (!CURRENCIES.includes(value)) throw new ApiError(422, 'Unsupported currency')
          next.currency = value
        } else if (field === 'expected_monthly_income') {
          const n = Number(value)
          if (!Number.isFinite(n) || n < 0) throw new ApiError(422, 'Expected income must be 0 or more')
          next.expected_monthly_income = n
        } else if (field === 'phone') {
          next.phone = value || null
        } else if (field in next && typeof next[field] === 'boolean') {
          next[field] = !!value
        }
      }
      state.user = next
      return state.user
    }),

  budgets: () =>
    read((state) =>
      state.budgets
        .map((b) => ({ id: b.id, category: categoryOut(state, b.category_id), monthly_limit: b.monthly_limit }))
        .sort((a, b) => state.categories.find((c) => c.id === a.category.id).sort_order - state.categories.find((c) => c.id === b.category.id).sort_order),
    ),
  upsertBudget: (categoryKey, monthlyLimit) =>
    write((state, nextId) => {
      const cat = getCategory(state, categoryKey)
      if (cat.is_income) throw new ApiError(422, 'Budgets apply to expense categories only')
      const limit = positive(monthlyLimit, 'monthly_limit')
      let budget = state.budgets.find((b) => b.category_id === cat.id)
      if (budget) budget.monthly_limit = limit
      else state.budgets.push((budget = { id: nextId('budget'), category_id: cat.id, monthly_limit: limit }))
      return { id: budget.id, category: categoryOut(state, cat.id), monthly_limit: limit }
    }),
  deleteBudget: (id) =>
    write((state) => {
      state.budgets = state.budgets.filter((b) => b.id !== id)
      return null
    }),

  fixedExpenses: () =>
    read((state) =>
      [...state.fixedExpenses]
        .sort((a, b) => a.day_of_month - b.day_of_month)
        .map((fe) => ({ id: fe.id, name: fe.name, amount: fe.amount, day_of_month: fe.day_of_month, category: categoryOut(state, fe.category_id) })),
    ),
  createFixedExpense: (body) =>
    write((state, nextId) => {
      const cat = getCategory(state, body.category_key)
      if (!cat.is_fixed) throw new ApiError(422, 'Choose a fixed-expense category (rent, bills, ...)')
      const name = String(body.name || '').trim()
      if (!name) throw new ApiError(422, 'name must not be blank')
      const day = Math.min(31, Math.max(1, Math.round(Number(body.day_of_month) || 1)))
      const fe = { id: nextId('fixed'), name: name.slice(0, 120), amount: positive(body.amount, 'amount'), category_id: cat.id, day_of_month: day }
      state.fixedExpenses.push(fe)
      return { ...fe, category: categoryOut(state, cat.id) }
    }),
  deleteFixedExpense: (id) =>
    write((state) => {
      state.fixedExpenses = state.fixedExpenses.filter((fe) => fe.id !== id)
      return null
    }),

  goals: () => read((state) => goalsOverview(state)),
  createGoal: (body) =>
    write((state, nextId) => {
      const name = String(body.name || '').trim()
      if (!name) throw new ApiError(422, 'name must not be blank')
      const saved = Number(body.saved_amount || 0)
      if (!Number.isFinite(saved) || saved < 0) throw new ApiError(422, 'saved_amount must be 0 or more')
      state.goals.push({
        id: nextId('goal'), name: name.slice(0, 120), emoji: body.emoji || '🎯',
        target_amount: positive(body.target_amount, 'target_amount'), saved_amount: saved, deadline: body.deadline || null,
      })
      return goalsOverview(state)
    }),
  updateGoal: (id, body) =>
    write((state) => {
      const goal = state.goals.find((g) => g.id === id)
      if (!goal) throw new ApiError(404, 'Goal not found')
      if (body.target_amount !== undefined) goal.target_amount = positive(body.target_amount, 'target_amount')
      if (body.name) goal.name = String(body.name).trim().slice(0, 120)
      if (body.emoji) goal.emoji = body.emoji
      if ('deadline' in body) goal.deadline = body.deadline || null
      return goalsOverview(state)
    }),
  depositGoal: (id, amount) =>
    write((state) => {
      const goal = state.goals.find((g) => g.id === id)
      if (!goal) throw new ApiError(404, 'Goal not found')
      const delta = Number(amount)
      if (!Number.isFinite(delta) || delta === 0) throw new ApiError(422, 'amount must not be zero')
      const next = round2(goal.saved_amount + delta)
      if (next < 0) throw new ApiError(422, 'Cannot withdraw more than is saved')
      goal.saved_amount = next
      return goalsOverview(state)
    }),
  deleteGoal: (id) =>
    write((state) => {
      state.goals = state.goals.filter((g) => g.id !== id)
      return null
    }),
  subscriptions: () => read((state) => detectSubscriptions(state)),

  botStatus: () => Promise.resolve({ mode: 'local' }),
  botMessages: () => read((state) => state.messages.slice(-100)),
  botSend: (text) =>
    write((state, nextId) => {
      const value = String(text || '').trim()
      if (!value) throw new ApiError(422, 'Message must not be empty')
      const res = handleInbound(state, nextId, value.slice(0, 1000))
      return {
        intent: res.parsed.intent, language: res.parsed.language, amount: res.parsed.amount,
        messages: [res.inbound, res.reply, ...res.alerts],
        transaction: res.transaction ? txOut(state, res.transaction) : null,
      }
    }),
  botProactive: (kind) =>
    write((state, nextId) => {
      if (kind === 'weekly_summary') return [sendMessage(state, nextId, buildWeeklySummary(state), 'weekly_summary')]
      if (kind === 'free_to_spend') return [sendMessage(state, nextId, buildBalanceMessage(state), 'free_to_spend')]
      if (kind === 'budget_alerts') return checkBudgetAlerts(state, nextId)
      throw new ApiError(422, `Unknown update '${kind}'`)
    }),
  botClear: () =>
    write((state) => {
      state.messages = []
      state.meta.unread = 0
      return null
    }),

  /* ------------------------------------------- automatic payments */
  /** Log one bank/card SMS (from the phone's automation or the share sheet). */
  logSms: (text, sender = '') =>
    write((state, nextId) => {
      const res = logOneSms(state, nextId, String(text || '').slice(0, 2000), sender)
      if (res.status === 'logged' && res.transaction.amount < 0) checkBudgetAlerts(state, nextId)
      return res
    }),

  /** Log a pasted block of several messages. */
  logSmsBatch: (block) =>
    write((state, nextId) => {
      const results = splitMessages(block).slice(0, 500).map((text) => ({ text, ...logOneSms(state, nextId, text, '') }))
      if (results.some((r) => r.status === 'logged')) checkBudgetAlerts(state, nextId)
      const count = (status) => results.filter((r) => r.status === status).length
      return { results, logged: count('logged'), duplicates: count('duplicate'), ignored: count('ignored') }
    }),

  /**
   * Import statement rows ({date, merchant, amount} with expenses negative) under an
   * account label such as "Max" or "Otsar HaHayal". Re-importing the same file adds nothing.
   */
  importStatement: ({ rows, label }) =>
    write((state, nextId) => {
      const account = String(label || 'Import').trim().slice(0, 40) || 'Import'
      const known = new Set(state.transactions.filter((tx) => tx.external_id).map((tx) => tx.external_id))
      const seen = {}
      const categorizer = new Categorizer(state)
      let created = 0
      let duplicates = 0
      for (const row of rows) {
        const base = `${account}|${row.date}|${row.amount}|${row.merchant}`
        seen[base] = (seen[base] || 0) + 1
        const externalId = `imp-${hashString(`${base}|${seen[base]}`)}`
        if (known.has(externalId)) {
          duplicates += 1
          continue
        }
        const tx = {
          id: nextId('tx'), account_id: null, external_id: externalId, date: row.date, amount: row.amount,
          merchant: row.merchant, mcc: null, description: null, source: 'import', account_label: account,
          category_id: null, category_source: 'default', category_confidence: 0, created_at: new Date().toISOString(),
        }
        const twin = findCounterpart(state, tx, 'sms')
        if (twin) {
          // Already logged from its SMS: keep that one, now confirmed by the statement.
          twin.paired = true
          twin.external_id = externalId
          if (twin.category_source === 'default') {
            twin.merchant = row.merchant
            categorizer.apply(twin)
          }
          known.add(externalId)
          duplicates += 1
          continue
        }
        categorizer.apply(tx)
        state.transactions.push(tx)
        known.add(externalId)
        created += 1
      }
      if (created) checkBudgetAlerts(state, nextId)
      return { created, duplicates }
    }),

  /* ---------------------------------------------- phone-mode extras */
  unread: () => read((state) => state.meta.unread || 0),
  markRead: () =>
    write((state) => {
      state.meta.unread = 0
      return null
    }),
  setPhoneNotifications: (enabled) =>
    write((state) => {
      state.meta.phoneNotifications = !!enabled
      return null
    }),
  phoneNotifications: () => read((state) => !!state.meta.phoneNotifications),

  /** Scheduled work the server would do: bank sync, weekly summary, daily update. */
  runDueJobs: (now = new Date()) =>
    write((state, nextId) => {
      const today = todayISO()
      const sent = []
      if (state.accounts.some((a) => !a.synced_until || a.synced_until < today)) {
        const before = state.messages.length
        syncAll(state, nextId)
        sent.push(...state.messages.slice(before))
      }
      // Weekly summary: the most recent Sunday 09:00 that has passed (Israeli week starts Sunday).
      const sunday = new Date(now)
      sunday.setHours(9, 0, 0, 0)
      sunday.setDate(sunday.getDate() - sunday.getDay())
      if (sunday > now) sunday.setDate(sunday.getDate() - 7)
      const sundayISO = toISO(sunday)
      if (state.user.weekly_summary_enabled && (state.meta.lastWeekly || '') < sundayISO && new Date(state.created_at) < sunday) {
        sent.push(sendMessage(state, nextId, buildWeeklySummary(state), 'weekly_summary'))
      }
      if ((state.meta.lastWeekly || '') < sundayISO) state.meta.lastWeekly = sundayISO
      // Daily free-to-spend after 20:30.
      const evening = new Date(now)
      evening.setHours(20, 30, 0, 0)
      if (state.user.daily_update_enabled && now >= evening && state.meta.lastDaily !== today) {
        sent.push(sendMessage(state, nextId, buildDailyUpdate(state), 'free_to_spend'))
        state.meta.lastDaily = today
      }
      return { sent, phoneNotifications: !!state.meta.phoneNotifications }
    }),

  exportBackup: () => read((state) => state),
  importBackup: async (data) => {
    const state = ensureCategories(validateBackup(data))
    await queue.replace(state)
    return null
  },
  startFresh: async ({ name, language }) => {
    await queue.replace(emptyState({ name: name || '', language }))
    return null
  },
  loadDemo: async ({ language }) => {
    await queue.replace(demoState({ language }))
    return null
  },
}
