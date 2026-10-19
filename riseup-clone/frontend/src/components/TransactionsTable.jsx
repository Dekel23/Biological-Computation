import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, notifyDataChanged } from '../api'
import { useApi } from '../hooks/useApi'
import { useCategories } from '../hooks/useCategories'
import { categoryName, currentMonth, formatDate, formatMoney, toISODate } from '../utils/format'
import { CategoryIcon, ErrorState, LoadingBlock, MonthSwitcher, Sheet, Spinner, useToast } from './ui'

const SOURCES = ['bank', 'cash', 'manual']

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

export default function TransactionsTable() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [params, setParams] = useSearchParams()
  const [month, setMonth] = useState(params.get('month') || currentMonth())
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const category = params.get('category') || ''
  const q = useDebounced(search)
  const { list: categories, byKey } = useCategories()
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)

  const { data, error, loading, reload } = useApi(
    () => api.transactions({ month, category, q, source, limit: 500 }),
    [month, category, q, source],
  )

  const setCategoryFilter = (key) => {
    const next = new URLSearchParams(params)
    if (key) next.set('category', key)
    else next.delete('category')
    setParams(next, { replace: true })
  }

  const groups = useMemo(() => {
    const out = []
    for (const tx of data?.items ?? []) {
      const last = out[out.length - 1]
      if (last && last.date === tx.date) last.items.push(tx)
      else out.push({ date: tx.date, items: [tx] })
    }
    return out
  }, [data])

  const money = (v, opts) => formatMoney(v, { lang, ...opts })
  const today = toISODate(new Date())
  const yesterday = toISODate(new Date(Date.now() - 864e5))
  const dayLabel = (iso) =>
    iso === today ? t('common.today') : iso === yesterday ? t('common.yesterday') : formatDate(iso, lang, { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('tx.title')}</h1>
        <MonthSwitcher month={month} onChange={setMonth} maxMonth={currentMonth()} />
      </div>

      <div className="space-y-2">
        <input
          type="search"
          className="input"
          placeholder={t('tx.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          dir="auto"
          aria-label={t('tx.search')}
        />
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <button className={`chip ${!source ? 'chip-active' : ''}`} onClick={() => setSource('')}>
            {t('tx.all')}
          </button>
          {SOURCES.map((s) => (
            <button key={s} className={`chip ${source === s ? 'chip-active' : ''}`} onClick={() => setSource(source === s ? '' : s)}>
              {t(`tx.sources.${s}`)}
            </button>
          ))}
          <select
            className={`chip appearance-none pe-6 ${category ? 'chip-active' : ''}`}
            value={category}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label={t('tx.filterCategory')}
          >
            <option value="">{t('tx.filterCategory')}: {t('tx.all')}</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.icon} {categoryName(c, lang)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {data && (
        <p className="flex justify-between text-xs text-muted">
          <span>{t('tx.count', { count: data.total })}</span>
          <span className="num">{t('tx.totals', { income: money(data.income), expenses: money(data.expenses) })}</span>
        </p>
      )}

      {error && !data && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <LoadingBlock />}
      {data && !data.items.length && <p className="card p-8 text-center text-sm text-muted">{t('tx.empty')}</p>}

      <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {groups.map((group) => (
          <section key={group.date} className="card overflow-hidden">
            <h2 className="flex justify-between border-b border-line/60 bg-sunken/50 px-4 py-2 text-xs font-semibold text-ink-2">
              <span>{dayLabel(group.date)}</span>
              <span className="num">{money(group.items.reduce((s, tx) => s + tx.amount, 0), { signed: true })}</span>
            </h2>
            <ul className="divide-y divide-line/60">
              {group.items.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} lang={lang} money={money} onClick={() => setEditing(tx)} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <button
        className="btn-primary fixed bottom-24 end-4 z-30 h-14 w-14 rounded-full p-0 text-2xl shadow-lg md:end-[max(1rem,calc(50%-24.5rem))]"
        onClick={() => setAdding(true)}
        aria-label={t('tx.add')}
      >
        +
      </button>

      <CategorySheet
        tx={editing}
        onClose={() => setEditing(null)}
        categories={categories}
        byKey={byKey}
        onChanged={() => {
          setEditing(null)
          notifyDataChanged()
        }}
      />
      <AddTransactionSheet open={adding} onClose={() => setAdding(false)} categories={categories} />
    </div>
  )
}

function TransactionRow({ tx, lang, money, onClick }) {
  const { t } = useTranslation()
  const income = tx.amount > 0
  const needsCategory = tx.category_source === 'default'
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-sunken/60 md:grid md:grid-cols-[auto_1fr_12rem_8rem]">
        <CategoryIcon category={tx.category} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium"><bdi>{tx.merchant}</bdi></p>
          <p className="truncate text-xs text-muted md:hidden">
            {categoryName(tx.category, lang)}
            {tx.source !== 'bank' && ` · ${t(`tx.sources.${tx.source}`)}`}
          </p>
        </div>
        <div className="hidden text-xs md:block">
          <p className="font-medium text-ink-2">{categoryName(tx.category, lang)}</p>
          <p className={needsCategory ? 'text-bad' : 'text-muted'}>
            {t(`tx.categorySource.${tx.category_source}`)}
            {tx.source !== 'bank' && ` · ${t(`tx.sources.${tx.source}`)}`}
          </p>
        </div>
        <div className="text-end">
          <span className={`num text-sm font-semibold ${income ? 'text-good' : ''}`}>{money(tx.amount, { decimals: 2, signed: income })}</span>
          {needsCategory && (
            <span className="block text-[11px] font-medium text-bad md:hidden">⚠ {t('tx.categorySource.default')}</span>
          )}
        </div>
      </button>
    </li>
  )
}

function CategorySheet({ tx, onClose, categories, onChanged }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const toast = useToast()
  const [learn, setLearn] = useState(true)
  const [busy, setBusy] = useState(null)

  useEffect(() => setLearn(true), [tx?.id])
  if (!tx) return null
  const income = tx.amount > 0
  const options = categories.filter((c) => c.is_income === income)

  const choose = async (key) => {
    setBusy(key)
    try {
      const res = await api.setCategory(tx.id, key, learn)
      toast(learn ? t('tx.learned', { count: res.recategorized, merchant: tx.merchant }) : t('tx.learned_zero'))
      onChanged()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!window.confirm(t('tx.deleteConfirm'))) return
    try {
      await api.deleteTransaction(tx.id)
      onChanged()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  return (
    <Sheet open={!!tx} onClose={onClose} title={t('tx.changeCategory')}>
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-sunken p-3">
        <CategoryIcon category={tx.category} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium"><bdi>{tx.merchant}</bdi></p>
          <p className="text-xs text-muted">
            {formatDate(tx.date, lang, { day: 'numeric', month: 'long', year: 'numeric' })} · {t(`tx.categorySource.${tx.category_source}`)}
            {tx.category_source !== 'user' && tx.category_confidence > 0 && ` (${Math.round(tx.category_confidence * 100)}%)`}
          </p>
        </div>
        <span className="num font-semibold">{formatMoney(tx.amount, { lang, decimals: 2 })}</span>
      </div>

      <label className="mb-4 flex items-center gap-3 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
        <span>{t('tx.learn', { merchant: tx.merchant })}</span>
      </label>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {options.map((c) => {
          const active = c.key === tx.category.key
          return (
            <button
              key={c.key}
              onClick={() => choose(c.key)}
              disabled={busy !== null}
              className={`flex flex-col items-center gap-1 rounded-2xl border p-2.5 text-center text-xs transition ${
                active ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line hover:bg-sunken'
              }`}
            >
              {busy === c.key ? <Spinner /> : <span className="text-xl">{c.icon}</span>}
              <span className="leading-tight">{categoryName(c, lang)}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        {tx.source === 'bank' ? (
          <p className="text-center text-xs text-muted">🔒 {t('tx.readOnly')}</p>
        ) : (
          <button className="btn w-full text-bad hover:bg-bad/10" onClick={remove}>
            {t('common.delete')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

const blankForm = () => ({
  kind: 'expense',
  amount: '',
  merchant: '',
  date: toISODate(new Date()),
  category_key: '',
  description: '',
})

function AddTransactionSheet({ open, onClose, categories }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const toast = useToast()
  const [form, setForm] = useState(blankForm)
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  useEffect(() => {
    if (open) setForm(blankForm())
  }, [open])

  const options = categories.filter((c) => c.is_income === (form.kind === 'income'))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.createTransaction({
        ...form,
        amount: Number(form.amount),
        category_key: form.category_key || null,
        description: form.description || null,
      })
      notifyDataChanged()
      onClose()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('tx.add')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
          {['expense', 'income'].map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setForm((f) => ({ ...f, kind: k, category_key: '' }))}
              className={`rounded-lg py-2 text-sm font-medium ${form.kind === k ? 'bg-card shadow-sm' : 'text-muted'}`}
            >
              {t(`tx.kind.${k}`)}
            </button>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="tx-amount">{t('tx.amount')}</label>
          <input id="tx-amount" className="input num w-full text-start" type="number" inputMode="decimal" min="0.01" step="0.01" required value={form.amount} onChange={set('amount')} />
        </div>
        <div>
          <label className="label" htmlFor="tx-merchant">{t('tx.merchant')}</label>
          <input id="tx-merchant" className="input" required maxLength={160} dir="auto" placeholder={t('tx.merchantPlaceholder')} value={form.merchant} onChange={set('merchant')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="tx-date">{t('tx.date')}</label>
            <input id="tx-date" className="input" type="date" required max={toISODate(new Date())} value={form.date} onChange={set('date')} />
          </div>
          <div>
            <label className="label" htmlFor="tx-category">{t('tx.category')}</label>
            <select id="tx-category" className="input" value={form.category_key} onChange={set('category_key')}>
              <option value="">✨ {t('tx.autoCategory')}</option>
              {options.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.icon} {categoryName(c, lang)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="tx-note">
            {t('tx.note')} <span className="text-muted">({t('common.optional')})</span>
          </label>
          <input id="tx-note" className="input" dir="auto" maxLength={500} value={form.description} onChange={set('description')} />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
