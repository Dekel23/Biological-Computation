/** On-device bot conversation handler – port of backend/services/bot.py. */
import { computeBottomLine } from './calculator'
import { Categorizer, matchKeyword, normalize } from './categorizer'
import { todayISO } from './dates'
import { goalsOverview } from './insights'
import { categoryName, money, monthName, t } from './messages'
import { parseMessage } from './nlpParser'
import { buildBalanceMessage, buildWeeklySummary, checkBudgetAlerts, sendMessage } from './notifications'

/** Resolve a category from free text: explicit names first, then keywords. */
export function findCategory(state, text, wantIncome = false) {
  if (!text) return null
  const norm = normalize(text)
  const cats = state.categories.filter((c) => c.is_income === wantIncome)
  for (const cat of [...cats].sort((a, b) => b.name_en.length - a.name_en.length)) {
    for (const name of [cat.name_en, cat.name_he, cat.key.replace('_', ' ')]) {
      const n = normalize(name)
      if (n && (n === norm || ` ${norm} `.includes(` ${n} `))) return cat
    }
  }
  const key = matchKeyword(text, (k) => cats.some((c) => c.key === k))
  return cats.find((c) => c.key === key) ?? null
}

const amountText = (v, cur) => money(v, cur, v % 1 ? 2 : 0)

export function handleInbound(state, nextId, text, today = todayISO()) {
  const { user } = state
  const parsed = parseMessage(text, user.language, today)
  const lang = parsed.language
  const cur = user.currency
  const inbound = {
    id: nextId('msg'), direction: 'in', kind: 'inbound', body: text, status: 'received',
    transaction_id: null, created_at: new Date().toISOString(),
  }
  state.messages.push(inbound)
  const free = () => money(computeBottomLine(state, null, today).free_to_spend, cur)
  const reply = (body, txId = null) => sendMessage(state, nextId, body, 'reply', txId)

  if (parsed.intent === 'expense' || parsed.intent === 'income') {
    const income = parsed.intent === 'income'
    const categorizer = new Categorizer(state)
    const amount = income ? parsed.amount : -parsed.amount
    const merchant = (parsed.merchant || parsed.description || (income ? 'Income' : 'Cash expense')).slice(0, 160)
    let res = categorizer.categorize(merchant, amount, null, parsed.description)
    if (res.source === 'default') {
      const explicit = findCategory(state, parsed.description, income)
      if (explicit) res = { key: explicit.key, source: 'keyword', confidence: 0.8 }
    }
    const tx = {
      id: nextId('tx'), account_id: null, external_id: null, date: parsed.txDate, amount, merchant, mcc: null,
      description: parsed.raw, source: income ? 'manual' : 'cash', category_id: categorizer.categoryId(res.key),
      category_source: res.source, category_confidence: res.confidence, created_at: new Date().toISOString(),
    }
    state.transactions.push(tx)
    inbound.transaction_id = tx.id
    const cat = categorizer.byKey[res.key]
    const merchantPart =
      parsed.merchant && normalize(parsed.merchant) !== normalize(categoryName(cat, lang)) ? ` · ${parsed.merchant}` : ''
    const body = t(lang, income ? 'income_logged' : 'expense_logged', {
      amount: amountText(parsed.amount, cur), icon: cat.icon, category: categoryName(cat, lang),
      merchant: merchantPart, when: parsed.txDate < today ? t(lang, 'yesterday') : '', free: free(),
    })
    const out = reply(body, tx.id)
    const alerts = income ? [] : checkBudgetAlerts(state, nextId, lang, today)
    return { parsed, inbound, reply: out, transaction: tx, alerts }
  }

  let body
  switch (parsed.intent) {
    case 'set_budget': {
      const cat = findCategory(state, parsed.description)
      if (!cat) {
        body = t(lang, 'budget_unknown_category')
        break
      }
      const budget = state.budgets.find((b) => b.category_id === cat.id)
      if (budget) budget.monthly_limit = parsed.amount
      else state.budgets.push({ id: nextId('budget'), category_id: cat.id, monthly_limit: parsed.amount })
      body = t(lang, 'budget_set', { icon: cat.icon, category: categoryName(cat, lang), amount: money(parsed.amount, cur) })
      break
    }
    case 'balance':
      body = buildBalanceMessage(state, lang, today)
      break
    case 'summary':
      body = buildWeeklySummary(state, lang, today)
      break
    case 'budget': {
      const bl = computeBottomLine(state, null, today)
      const lines = [t(lang, 'budget_header', { month: monthName(bl.month, lang) })]
      for (const ct of bl.categories) {
        if (!ct.budget) continue
        const pct = ct.budget_used_pct || 0
        lines.push(t(lang, 'budget_line', {
          flag: pct >= 100 ? '🔴' : pct >= 80 ? '🟠' : '🟢', icon: ct.icon, category: categoryName(ct, lang),
          spent: money(ct.amount, cur), limit: money(ct.budget, cur), pct: Math.round(pct),
        }))
      }
      body = lines.length > 1 ? lines.join('\n') : t(lang, 'no_budgets')
      break
    }
    case 'goals': {
      const overview = goalsOverview(state, today)
      body = overview.items.length
        ? [t(lang, 'goals_header'), ...overview.items.map((g) => t(lang, 'goal_line', {
            emoji: g.emoji, name: g.name, saved: money(g.saved_amount, cur), target: money(g.target_amount, cur),
            pct: Math.round(g.progress_pct),
            need: g.required_monthly ? t(lang, 'goal_need', { monthly: money(g.required_monthly, cur) }) : '',
          }))].join('\n')
        : t(lang, 'no_goals')
      break
    }
    case 'undo': {
      const loggedIds = new Set(state.messages.filter((m) => m.direction === 'in' && m.transaction_id).map((m) => m.transaction_id))
      const last = state.transactions
        .filter((tx) => loggedIds.has(tx.id))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))[0]
      if (!last) {
        body = t(lang, 'undo_nothing')
        break
      }
      const cat = state.categories.find((c) => c.id === last.category_id)
      state.transactions = state.transactions.filter((tx) => tx.id !== last.id)
      for (const m of state.messages) if (m.transaction_id === last.id) m.transaction_id = null
      body = t(lang, 'undo_done', {
        amount: amountText(Math.abs(last.amount), cur), category: categoryName(cat, lang), merchant: last.merchant, free: free(),
      })
      break
    }
    case 'help':
      body = t(lang, 'help', { name: user.name || (lang === 'he' ? 'חבר/ה' : 'there') })
      break
    default:
      body = t(lang, 'unknown')
  }
  return { parsed, inbound, reply: reply(body), transaction: null, alerts: [] }
}
