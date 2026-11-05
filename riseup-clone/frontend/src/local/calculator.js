/**
 * On-device port of backend/services/calculator.py.
 *
 *   free_to_spend = total_income − fixed_expenses − variable_expenses
 *
 * Income falls back to the expected monthly income until the salary lands, planned
 * fixed costs are reserved before they're charged, and cash uses an envelope rule
 * (max(withdrawn, logged)) so ATM withdrawals and logged cash spends don't double count.
 */
import { daysInMonth, fromISO, monthBounds, round2, shiftMonth, todayISO } from './dates'

export function computeBottomLine(state, month = null, today = todayISO()) {
  const [first, last] = monthBounds(month, today)
  const isCurrent = first <= today && today <= last
  const isFuture = today < first
  const user = state.user
  const cats = Object.fromEntries(state.categories.map((c) => [c.id, c]))
  const txs = state.transactions.filter((tx) => tx.date >= first && tx.date <= last)
  const budgets = Object.fromEntries(state.budgets.map((b) => [b.category_id, b.monthly_limit]))

  let actualIncome = 0
  let withdrawnCash = 0
  let loggedCash = 0
  const spentByCat = {}
  const dailyVariable = {}
  const dailyWithdrawn = {}
  const dailyLoggedCash = {}
  const add = (obj, k, v) => {
    obj[k] = (obj[k] || 0) + v
  }

  for (const tx of txs) {
    const cat = cats[tx.category_id]
    if (tx.amount > 0) {
      if (cat.is_income) actualIncome += tx.amount
      else add(spentByCat, tx.category_id, -tx.amount) // refund reduces that category's spend
      continue
    }
    const spend = -tx.amount
    if (cat.key === 'cash' && tx.source === 'bank') {
      withdrawnCash += spend
      add(dailyWithdrawn, tx.date, spend)
      continue
    }
    add(spentByCat, tx.category_id, spend)
    if (tx.source === 'cash') {
      loggedCash += spend
      add(dailyLoggedCash, tx.date, spend)
    }
    if (!cat.is_fixed) add(dailyVariable, tx.date, spend)
  }

  const plannedByCat = {}
  for (const fe of state.fixedExpenses) add(plannedByCat, fe.category_id, fe.amount)

  const spentIds = Object.keys(spentByCat).map(Number)
  const fixedActual = spentIds.filter((id) => cats[id].is_fixed).reduce((s, id) => s + spentByCat[id], 0)
  let fixedTotal = 0
  const fixedIds = new Set([...Object.keys(plannedByCat).map(Number), ...spentIds.filter((id) => cats[id].is_fixed)])
  for (const id of fixedIds) {
    // For past months only what was actually charged counts.
    const plan = isCurrent || isFuture ? plannedByCat[id] || 0 : 0
    fixedTotal += Math.max(spentByCat[id] || 0, plan)
  }

  const variableCategorised = spentIds.filter((id) => !cats[id].is_fixed).reduce((s, id) => s + spentByCat[id], 0)
  const unallocatedCash = Math.max(0, withdrawnCash - loggedCash)
  const variableTotal = variableCategorised + unallocatedCash

  const expected = user.expected_monthly_income || 0
  const incomeIsProjected = (isCurrent || isFuture) && expected > actualIncome
  const totalIncome = incomeIsProjected ? expected : actualIncome
  const free = totalIncome - fixedTotal - variableTotal

  const [year, mon] = first.split('-').map(Number)
  const dim = daysInMonth(year, mon)
  let daysLeft
  let elapsed
  if (isCurrent) {
    daysLeft = Math.round((fromISO(last) - fromISO(today)) / 86400000) + 1
    elapsed = Number(today.slice(8))
  } else if (isFuture) {
    daysLeft = dim
    elapsed = 0
  } else {
    daysLeft = 0
    elapsed = dim
  }
  const dailyAllowance = daysLeft && free > 0 ? free / daysLeft : 0

  const forecastVariable = isCurrent && elapsed ? variableTotal + (variableTotal / elapsed) * (daysLeft - 1) : variableTotal
  const forecastFree = totalIncome - fixedTotal - forecastVariable

  let status
  if (free < 0) status = 'over'
  else if (totalIncome && forecastFree < 0) status = 'tight'
  else if (totalIncome && forecastFree < 0.1 * totalIncome) status = 'ok'
  else status = 'great'

  const categories = []
  if (unallocatedCash) {
    const cashCat = state.categories.find((c) => c.key === 'cash')
    add(spentByCat, cashCat.id, unallocatedCash)
  }
  const catIds = new Set([...Object.keys(spentByCat), ...Object.keys(plannedByCat), ...Object.keys(budgets)].map(Number))
  for (const id of catIds) {
    const cat = cats[id]
    if (!cat || cat.is_income) continue
    const amount = spentByCat[id] || 0
    const limit = budgets[id] ?? null
    categories.push({
      key: cat.key, name_en: cat.name_en, name_he: cat.name_he, icon: cat.icon, color: cat.color,
      is_fixed: cat.is_fixed, amount: round2(amount), planned: round2(plannedByCat[id] || 0),
      budget: limit, budget_used_pct: limit ? Math.round((1000 * amount) / limit) / 10 : null,
    })
  }
  categories.sort((a, b) => b.amount - a.amount)

  // Cumulative variable spend vs. an even pace that ends the month at zero free-to-spend.
  const effectiveDay = isCurrent ? today : isFuture ? null : last
  const variableBudget = Math.max(0, totalIncome - fixedTotal)
  const series = []
  let running = 0
  let cumWithdrawn = 0
  let cumLogged = 0
  for (let d = 1; d <= dim; d++) {
    const date = `${first.slice(0, 8)}${String(d).padStart(2, '0')}`
    const point = { day: d, date, ideal: round2((variableBudget * d) / dim), actual: null }
    if (effectiveDay && date <= effectiveDay) {
      running += dailyVariable[date] || 0
      cumWithdrawn += dailyWithdrawn[date] || 0
      cumLogged += dailyLoggedCash[date] || 0
      point.actual = round2(running + Math.max(0, cumWithdrawn - cumLogged))
    }
    series.push(point)
  }

  return {
    month: first.slice(0, 7), currency: user.currency,
    total_income: round2(totalIncome), actual_income: round2(actualIncome), income_is_projected: incomeIsProjected,
    fixed_expenses: round2(fixedTotal), fixed_actual: round2(fixedActual), fixed_pending: round2(fixedTotal - fixedActual),
    variable_expenses: round2(variableTotal), unallocated_cash: round2(unallocatedCash), free_to_spend: round2(free),
    days_in_month: dim, days_left: daysLeft, daily_allowance: round2(dailyAllowance),
    forecast_variable: round2(forecastVariable), forecast_free_to_spend: round2(forecastFree), status,
    categories, daily_series: series,
  }
}

/** Income vs. expenses for the last `months` months (oldest first). */
export function monthlyTrend(state, months = 6, today = todayISO()) {
  const currentFirst = `${today.slice(0, 7)}-01`
  const out = []
  for (let delta = -(months - 1); delta <= 0; delta++) {
    const first = shiftMonth(currentFirst, delta)
    const bl = computeBottomLine(state, first.slice(0, 7), today)
    out.push({
      month: bl.month,
      income: bl.actual_income,
      expenses: round2(bl.fixed_actual + bl.variable_expenses),
      net: round2(bl.actual_income - bl.fixed_actual - bl.variable_expenses),
    })
  }
  return out
}
