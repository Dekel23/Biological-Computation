/** On-device port of backend/services/insights.py: Subscription Radar + Savings Goals. */
import { computeBottomLine } from './calculator'
import { merchantKey } from './categorizer'
import { addDays, daysBetween, monthsUntil, round2, todayISO } from './dates'

const CADENCES = [
  ['weekly', 6, 8],
  ['monthly', 26, 35],
  ['quarterly', 84, 98],
  ['yearly', 350, 380],
]
const EXCLUDED = new Set(['cash', 'transfers'])

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const pstdev = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const cadenceFor = (interval) => CADENCES.find(([, lo, hi]) => lo <= interval && interval <= hi)?.[0] ?? null

export function detectSubscriptions(state, lookbackDays = 200, today = todayISO()) {
  const cats = Object.fromEntries(state.categories.map((c) => [c.id, c]))
  const since = addDays(today, -lookbackDays)
  const groups = {}
  const rows = state.transactions
    .filter((tx) => tx.amount < 0 && tx.date >= since && !EXCLUDED.has(cats[tx.category_id].key))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
  for (const tx of rows) {
    const key = merchantKey(tx.merchant)
    if (key) (groups[key] ||= []).push(tx)
  }

  const found = []
  for (const [key, txs] of Object.entries(groups)) {
    // Collapse same-day split charges into one.
    const byDay = {}
    for (const tx of txs) byDay[tx.date] = (byDay[tx.date] || 0) - tx.amount
    const days = Object.keys(byDay).sort()
    if (days.length < 2) continue
    const intervals = days.slice(1).map((d, i) => daysBetween(days[i], d))
    const medInterval = median(intervals)
    const cadence = cadenceFor(medInterval)
    // Two charges a year apart are enough for a yearly plan; anything more frequent needs three.
    if (!cadence || (cadence !== 'yearly' && days.length < 3)) continue
    if (intervals.some((i) => Math.abs(i - medInterval) > Math.max(3, 0.2 * medInterval))) continue

    const amounts = days.map((d) => byDay[d])
    const earlier = amounts.slice(0, -1)
    const base = median(earlier)
    const variation = mean(earlier) ? pstdev(earlier) / mean(earlier) : 0
    if (variation > 0.2) continue
    const lastAmount = amounts[amounts.length - 1]
    let changePct = base ? Math.round((1000 * (lastAmount - base)) / base) / 10 : 0
    if (Math.abs(changePct) > 60) continue // probably not the same product
    const fixedPrice = variation < 0.02
    // A "price change" only makes sense for fixed-price plans, not metered bills.
    if (!fixedPrice || Math.abs(changePct) < 3) changePct = 0

    const lastDate = days[days.length - 1]
    const monthlyCost = (lastAmount * 30.44) / medInterval
    const cat = cats[txs[txs.length - 1].category_id]
    found.push({
      merchant: txs[txs.length - 1].merchant,
      merchant_key: key,
      category_key: cat.key,
      category_icon: cat.icon,
      category_name_en: cat.name_en,
      category_name_he: cat.name_he,
      is_fixed_category: cat.is_fixed,
      cadence,
      interval_days: round2(medInterval),
      occurrences: days.length,
      last_amount: round2(lastAmount),
      previous_amount: round2(base),
      price_change_pct: changePct,
      fixed_price: fixedPrice,
      last_date: lastDate,
      next_expected: addDays(lastDate, Math.round(medInterval)),
      monthly_cost: round2(monthlyCost),
      yearly_cost: round2(monthlyCost * 12),
      active: daysBetween(lastDate, today) <= medInterval * 1.5,
    })
  }

  found.sort((a, b) => b.monthly_cost - a.monthly_cost)
  const active = found.filter((s) => s.active)
  const subs = active.filter((s) => s.category_key === 'subscriptions')
  const sum = (xs, k) => round2(xs.reduce((t, s) => t + s[k], 0))
  return {
    items: found,
    total_monthly: sum(active, 'monthly_cost'),
    total_yearly: sum(active, 'yearly_cost'),
    subscriptions_monthly: sum(subs, 'monthly_cost'),
    subscriptions_yearly: sum(subs, 'yearly_cost'),
    price_hikes: active.filter((s) => s.price_change_pct > 0),
  }
}

export function goalsOverview(state, today = todayISO()) {
  const forecastSurplus = Math.max(0, computeBottomLine(state, null, today).forecast_free_to_spend)
  let totalRequired = 0
  const items = [...state.goals]
    .sort((a, b) => a.id - b.id)
    .map((g) => {
      const remaining = Math.max(0, g.target_amount - g.saved_amount)
      const pct = g.target_amount ? Math.round((1000 * g.saved_amount) / g.target_amount) / 10 : 0
      let monthsLeft
      let required
      let status
      if (remaining === 0) [monthsLeft, required, status] = [0, 0, 'done']
      else if (!g.deadline) [monthsLeft, required, status] = [null, 0, 'no_deadline']
      else if (g.deadline < today) [monthsLeft, required, status] = [0, remaining, 'overdue']
      else {
        monthsLeft = monthsUntil(g.deadline, today)
        required = Math.ceil(remaining / monthsLeft)
        status = 'pending'
      }
      totalRequired += required
      return {
        id: g.id, name: g.name, emoji: g.emoji, target_amount: g.target_amount, saved_amount: g.saved_amount,
        remaining: round2(remaining), progress_pct: Math.min(pct, 100), deadline: g.deadline || null,
        months_left: monthsLeft, required_monthly: required, status,
      }
    })

  const affordable = forecastSurplus >= totalRequired
  for (const item of items) if (item.status === 'pending') item.status = affordable ? 'on_track' : 'at_risk'
  return {
    items,
    total_required_monthly: round2(totalRequired),
    forecast_surplus: round2(forecastSurplus),
    affordable,
    suggested_transfer: round2(Math.min(forecastSurplus, totalRequired)),
  }
}
