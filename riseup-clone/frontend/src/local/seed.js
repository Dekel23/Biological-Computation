/** Category catalogue and starting states (demo or empty). Port of backend/services/seed.py. */
import { syncAccount } from './bankSync'
import { addDays, todayISO } from './dates'

export const SCHEMA_VERSION = 1

// key, English, Hebrew, icon, colour, is_fixed, is_income
const DEFAULT_CATEGORIES = [
  ['salary', 'Salary', 'משכורת', '💼', '#16a34a', false, true],
  ['other_income', 'Other income', 'הכנסה אחרת', '💰', '#22c55e', false, true],
  ['rent', 'Rent', 'שכר דירה', '🏠', '#7c3aed', true, false],
  ['utilities', 'Bills & utilities', 'חשבונות', '💡', '#8b5cf6', true, false],
  ['insurance', 'Insurance', 'ביטוחים', '🛡️', '#6366f1', true, false],
  ['loans', 'Loans', 'הלוואות', '🏦', '#4f46e5', true, false],
  ['subscriptions', 'Subscriptions', 'מנויים', '🔁', '#a855f7', true, false],
  ['groceries', 'Groceries', 'סופרמרקט', '🛒', '#0ea5e9', false, false],
  ['restaurants', 'Eating out', 'אוכל בחוץ', '🍽️', '#f97316', false, false],
  ['coffee', 'Coffee', 'קפה', '☕', '#b45309', false, false],
  ['transport', 'Transport', 'תחבורה', '🚌', '#0891b2', false, false],
  ['fuel', 'Fuel', 'דלק', '⛽', '#0e7490', false, false],
  ['health', 'Health', 'בריאות', '💊', '#e11d48', false, false],
  ['shopping', 'Shopping', 'קניות', '🛍️', '#db2777', false, false],
  ['entertainment', 'Entertainment', 'בילויים', '🎬', '#f59e0b', false, false],
  ['education', 'Education', 'לימודים', '🎓', '#14b8a6', false, false],
  ['kids', 'Kids', 'ילדים', '🧸', '#ec4899', false, false],
  ['transfers', 'Transfers', 'העברות', '↔️', '#64748b', false, false],
  ['cash', 'Cash withdrawal', 'משיכת מזומן', '🏧', '#78716c', false, false],
  ['other', 'Other', 'אחר', '📦', '#94a3b8', false, false],
]

export function defaultCategories() {
  return DEFAULT_CATEGORIES.map(([key, name_en, name_he, icon, color, is_fixed, is_income], i) => ({
    id: i + 1, key, name_en, name_he, icon, color, is_fixed, is_income, sort_order: i,
  }))
}

export function makeNextId(state) {
  return (kind) => {
    state.nextId[kind] = (state.nextId[kind] || 0) + 1
    return state.nextId[kind]
  }
}

/** A blank state for real use: categories only, no bank accounts, no demo data. */
export function emptyState({ language = 'en', name = '' } = {}) {
  return {
    version: SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    nextId: {},
    user: {
      name, phone: null, language, currency: 'ILS', expected_monthly_income: 0,
      weekly_summary_enabled: true, budget_alerts_enabled: true, daily_update_enabled: false,
    },
    categories: defaultCategories(),
    accounts: [],
    transactions: [],
    rules: [],
    budgets: [],
    alertLogs: [],
    fixedExpenses: [],
    goals: [],
    messages: [],
    meta: { demo: false, unread: 0, lastWeekly: null, lastDaily: null, phoneNotifications: false },
  }
}

/** The demo household ("Dana") with ~6 months of mock bank history. */
export function demoState({ language = 'en', today = todayISO(), historyDays = 185 } = {}) {
  const he = language === 'he'
  const state = emptyState({ language, name: he ? 'דנה' : 'Dana' })
  state.meta.demo = true
  state.user.expected_monthly_income = 14500
  const nextId = makeNextId(state)
  const cat = (key) => state.categories.find((c) => c.key === key).id

  state.accounts = [
    { id: nextId('account'), bank_name: 'Bank Hapoalim (mock)', account_mask: '4821', last_synced_at: null, synced_until: null },
    { id: nextId('account'), bank_name: 'Isracard (mock)', account_mask: '7710', last_synced_at: null, synced_until: null },
  ]
  state.fixedExpenses = [
    [he ? 'שכר דירה' : 'Rent', 4800, 'rent', 1],
    [he ? 'חשמל, מים וטלפון' : 'Electricity, water & phone', 650, 'utilities', 15],
    [he ? 'ביטוח בריאות ורכב' : 'Health & car insurance', 420, 'insurance', 5],
    [he ? 'סטרימינג וחדר כושר' : 'Streaming & gym', 290, 'subscriptions', 3],
  ].map(([name, amount, key, day]) => ({ id: nextId('fixed'), name, amount, category_id: cat(key), day_of_month: day }))
  state.budgets = [
    ['groceries', 2200], ['restaurants', 900], ['coffee', 250], ['shopping', 800], ['entertainment', 400],
  ].map(([key, limit]) => ({ id: nextId('budget'), category_id: cat(key), monthly_limit: limit }))
  state.goals = [
    { id: nextId('goal'), name: he ? 'קרן חירום' : 'Emergency fund', emoji: '🛟', target_amount: 30000, saved_amount: 11200, deadline: addDays(today, 365) },
    { id: nextId('goal'), name: he ? 'טיול ליפן' : 'Trip to Japan', emoji: '🗾', target_amount: 18000, saved_amount: 4500, deadline: addDays(today, 240) },
  ]
  for (const account of state.accounts) {
    syncAccount(state, account, nextId, { since: addDays(today, -historyDays), until: today, today })
  }
  return state
}
