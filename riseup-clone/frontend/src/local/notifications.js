/** Proactive bot updates on the device – port of backend/services/notifications.py. */
import { ACCOUNT_SOURCES, computeBottomLine } from './calculator'
import { addDays, todayISO } from './dates'
import { detectSubscriptions } from './insights'
import { categoryName, money, monthName, t } from './messages'

export const PROACTIVE_KINDS = new Set(['weekly_summary', 'budget_alert', 'free_to_spend'])

/** Append a bot → user message to the chat. Proactive ones count as unread. */
export function sendMessage(state, nextId, body, kind = 'reply', transactionId = null) {
  const message = {
    id: nextId('msg'), direction: 'out', kind, body, status: 'sent',
    transaction_id: transactionId, created_at: new Date().toISOString(),
  }
  state.messages.push(message)
  if (PROACTIVE_KINDS.has(kind)) state.meta.unread = (state.meta.unread || 0) + 1
  return message
}

function spendBetween(state, start, end) {
  const cats = Object.fromEntries(state.categories.map((c) => [c.id, c]))
  let total = 0
  const byCat = {}
  for (const tx of state.transactions) {
    if (tx.amount >= 0 || tx.date < start || tx.date > end) continue
    const cat = cats[tx.category_id]
    if (cat.is_income || cat.key === 'card_bill' || (cat.key === 'cash' && ACCOUNT_SOURCES.has(tx.source))) continue
    total += -tx.amount
    byCat[tx.category_id] = (byCat[tx.category_id] || 0) - tx.amount
  }
  return { total, byCat }
}

const ddmm = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}`

export function buildWeeklySummary(state, lang = state.user.language, today = todayISO()) {
  const cur = state.user.currency
  const start = addDays(today, -6)
  const { total: spent, byCat } = spendBetween(state, start, today)
  const { total: prev } = spendBetween(state, addDays(start, -7), addDays(start, -1))

  let trend
  if (prev && Math.abs(spent - prev) / prev >= 0.05) {
    const pct = Math.round((100 * Math.abs(spent - prev)) / prev)
    trend = t(lang, spent > prev ? 'trend_up' : 'trend_down', { pct })
  } else trend = t(lang, 'trend_flat')

  const cats = Object.fromEntries(state.categories.map((c) => [c.id, c]))
  const top = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, v], i) => t(lang, 'top_line', { i: i + 1, icon: cats[id].icon, category: categoryName(cats[id], lang), amount: money(v, cur) }))
    .join('\n')

  const bl = computeBottomLine(state, null, today)
  let tip
  if (bl.free_to_spend < 0) tip = t(lang, 'tip_over')
  else if (bl.forecast_free_to_spend < 0) tip = t(lang, 'tip_tight', { forecast: money(Math.abs(bl.forecast_free_to_spend), cur) })
  else tip = t(lang, 'tip_good', { forecast: money(bl.forecast_free_to_spend, cur) })
  for (const hike of detectSubscriptions(state, 200, today).price_hikes.slice(0, 2)) {
    tip += `\n${t(lang, 'price_hike', { merchant: hike.merchant, old: money(hike.previous_amount, cur, 2), new: money(hike.last_amount, cur, 2) })}`
  }

  return t(lang, 'weekly_summary', {
    start: ddmm(start), end: ddmm(today), spent: money(spent, cur), trend, top,
    free: money(bl.free_to_spend, cur), days_left: bl.days_left, daily: money(bl.daily_allowance, cur), tip,
  })
}

export function buildBalanceMessage(state, lang = state.user.language, today = todayISO()) {
  const cur = state.user.currency
  const bl = computeBottomLine(state, null, today)
  return t(lang, 'balance', {
    month: monthName(bl.month, lang), income: money(bl.total_income, cur),
    projected: bl.income_is_projected ? t(lang, 'projected') : '', fixed: money(bl.fixed_expenses, cur),
    variable: money(bl.variable_expenses, cur), free: money(bl.free_to_spend, cur), days_left: bl.days_left,
    daily: money(bl.daily_allowance, cur), forecast: money(bl.forecast_free_to_spend, cur),
  })
}

export function buildDailyUpdate(state, today = todayISO()) {
  const { user } = state
  const { total } = spendBetween(state, today, today)
  const bl = computeBottomLine(state, null, today)
  return t(user.language, 'daily_update', {
    today: money(total, user.currency), month: monthName(bl.month, user.language),
    free: money(bl.free_to_spend, user.currency), daily: money(bl.daily_allowance, user.currency),
  })
}

/** At most one 80% and one 100% alert per budget per month. Returns the messages sent. */
export function checkBudgetAlerts(state, nextId, lang = state.user.language, today = todayISO()) {
  if (!state.user.budget_alerts_enabled) return []
  const bl = computeBottomLine(state, null, today)
  const cats = Object.fromEntries(state.categories.map((c) => [c.key, c]))
  const sent = new Set(state.alertLogs.filter((a) => a.month === bl.month).map((a) => `${a.category_id}:${a.threshold}`))
  const out = []
  for (const ct of bl.categories) {
    if (!ct.budget || ct.budget_used_pct === null) continue
    const cat = cats[ct.key]
    for (const threshold of [100, 80]) {
      if (ct.budget_used_pct < threshold) continue
      if (sent.has(`${cat.id}:${threshold}`)) break // this level (and any lower one) was already announced
      state.alertLogs.push({ category_id: cat.id, month: bl.month, threshold })
      // Crossing 100% implies 80% too; never send a stale 80% alert afterwards.
      if (threshold === 100 && !sent.has(`${cat.id}:80`)) state.alertLogs.push({ category_id: cat.id, month: bl.month, threshold: 80 })
      const body = t(lang, `budget_alert_${threshold}`, {
        pct: Math.round(ct.budget_used_pct), icon: ct.icon, category: categoryName(cat, lang),
        spent: money(ct.amount, state.user.currency), limit: money(ct.budget, state.user.currency),
      })
      out.push(sendMessage(state, nextId, body, 'budget_alert'))
      break
    }
  }
  return out
}
