const BASE = import.meta.env.VITE_API_BASE || '/api'

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : `Request failed (${status})`)
    this.status = status
    this.detail = detail
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(BASE + path, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
    })
  }
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.detail
    throw new ApiError(res.status, Array.isArray(detail) ? detail.map((d) => d.msg).join(', ') : detail)
  }
  return data
}

export const api = {
  summary: (month) => request('/dashboard/summary', { params: { month } }),
  categories: () => request('/categories'),

  transactions: (params) => request('/transactions', { params }),
  createTransaction: (body) => request('/transactions', { method: 'POST', body }),
  setCategory: (id, categoryKey, learn = true) =>
    request(`/transactions/${id}/category`, { method: 'PATCH', body: { category_key: categoryKey, learn } }),
  deleteTransaction: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),

  accounts: () => request('/bank/accounts'),
  syncBank: () => request('/bank/sync', { method: 'POST' }),

  settings: () => request('/settings'),
  updateSettings: (body) => request('/settings', { method: 'PUT', body }),
  budgets: () => request('/budgets'),
  upsertBudget: (categoryKey, monthlyLimit) =>
    request('/budgets', { method: 'PUT', body: { category_key: categoryKey, monthly_limit: monthlyLimit } }),
  deleteBudget: (id) => request(`/budgets/${id}`, { method: 'DELETE' }),
  fixedExpenses: () => request('/fixed-expenses'),
  createFixedExpense: (body) => request('/fixed-expenses', { method: 'POST', body }),
  deleteFixedExpense: (id) => request(`/fixed-expenses/${id}`, { method: 'DELETE' }),

  goals: () => request('/goals'),
  createGoal: (body) => request('/goals', { method: 'POST', body }),
  updateGoal: (id, body) => request(`/goals/${id}`, { method: 'PATCH', body }),
  depositGoal: (id, amount) => request(`/goals/${id}/deposit`, { method: 'POST', body: { amount } }),
  deleteGoal: (id) => request(`/goals/${id}`, { method: 'DELETE' }),
  subscriptions: () => request('/insights/subscriptions'),

  botStatus: () => request('/whatsapp/status'),
  botMessages: () => request('/whatsapp/messages'),
  botSend: (text) => request('/whatsapp/simulate', { method: 'POST', body: { text } }),
  botProactive: (kind) => request(`/whatsapp/proactive/${kind}`, { method: 'POST' }),
  botClear: () => request('/whatsapp/messages', { method: 'DELETE' }),
}

/** Lightweight cross-screen invalidation: screens refetch when data they show changes. */
const listeners = new Set()
export function onDataChanged(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function notifyDataChanged() {
  listeners.forEach((fn) => fn())
}
