import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, notifyDataChanged } from '../api'
import { useApi } from '../hooks/useApi'
import { formatDate, formatMoney, toISODate } from '../utils/format'
import { ErrorState, LoadingBlock, Sheet, useToast } from './ui'
import SubscriptionRadar from './SubscriptionRadar'

const STATUS_CLS = {
  on_track: 'bg-good/15 text-good',
  at_risk: 'bg-warn/25 text-ink',
  done: 'bg-good/15 text-good',
  no_deadline: 'bg-sunken text-muted',
  overdue: 'bg-bad/15 text-bad',
}
const STATUS_ICON = { on_track: '✓', at_risk: '⚠', done: '🏆', no_deadline: '∞', overdue: '⏰' }
const EMOJIS = ['🎯', '🛟', '✈️', '🗾', '🏠', '🚗', '💍', '🎓', '💻', '👶', '🏖️', '📈']

export default function GoalsPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const toast = useToast()
  const { data, error, reload, setData } = useApi(() => api.goals(), [])
  const [adding, setAdding] = useState(false)
  const [depositFor, setDepositFor] = useState(null)
  const money = (v) => formatMoney(v, { lang })

  const remove = async (goal) => {
    if (!window.confirm(t('goals.deleteConfirm'))) return
    try {
      await api.deleteGoal(goal.id)
      reload()
      notifyDataChanged()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('goals.title')}</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + {t('goals.add')}
        </button>
      </div>

      {error && !data && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <LoadingBlock />}

      {data && data.items.length > 0 && (
        <section className="card grid grid-cols-2 divide-x divide-line/60 rtl:divide-x-reverse">
          <div className="p-4">
            <p className="text-xs text-muted">{t('goals.surplus')}</p>
            <p className="num mt-1 text-xl font-semibold">{money(data.forecast_surplus)}</p>
          </div>
          <div className="p-4">
            <p className="text-xs text-muted">{t('goals.needs')}</p>
            <p className={`num mt-1 text-xl font-semibold ${data.affordable ? 'text-good' : 'text-bad'}`}>
              {money(data.total_required_monthly)}
              <span className="ms-1 text-xs font-normal text-muted">{t('common.perMonth')}</span>
            </p>
          </div>
          <p className="col-span-2 border-t border-line/60 px-4 py-3 text-sm">
            {data.affordable
              ? `💡 ${t('goals.suggestion', { amount: money(data.suggested_transfer) })}`
              : `⚠ ${t('goals.shortfall', { amount: money(data.total_required_monthly - data.forecast_surplus) })}`}
          </p>
        </section>
      )}

      {data && !data.items.length && <p className="card p-8 text-center text-sm text-muted">{t('goals.empty')}</p>}

      <ul className="space-y-3">
        {data?.items.map((goal) => (
          <li key={goal.id} className="card p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-2xl" aria-hidden>
                {goal.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="truncate font-semibold"><bdi>{goal.name}</bdi></h2>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[goal.status]}`}>
                    <span aria-hidden>{STATUS_ICON[goal.status]}</span>
                    {t(`goals.status.${goal.status}`)}
                  </span>
                </div>
                <p className="num text-sm text-ink-2">
                  {t('goals.progress', { saved: money(goal.saved_amount), target: money(goal.target_amount) })}
                </p>
              </div>
            </div>
            <div
              className="mt-3 h-2.5 overflow-hidden rounded-full bg-brand-soft"
              role="progressbar"
              aria-valuenow={Math.round(goal.progress_pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(goal.progress_pct, 2)}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
              <span>
                {goal.required_monthly > 0 && goal.deadline
                  ? t('goals.required', {
                      amount: money(goal.required_monthly),
                      date: formatDate(goal.deadline, lang, { month: 'short', year: 'numeric' }),
                    })
                  : null}
              </span>
              <span className="num font-medium">{Math.round(goal.progress_pct)}%</span>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary flex-1" onClick={() => setDepositFor({ goal, sign: 1 })}>
                + {t('goals.deposit')}
              </button>
              <button className="btn-ghost" onClick={() => setDepositFor({ goal, sign: -1 })} disabled={!goal.saved_amount}>
                {t('goals.withdraw')}
              </button>
              <button className="btn-ghost text-bad" onClick={() => remove(goal)} aria-label={t('common.delete')}>
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>

      <SubscriptionRadar />

      <GoalSheet
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(overview) => {
          setData(overview)
          setAdding(false)
          notifyDataChanged()
        }}
      />
      <DepositSheet
        target={depositFor}
        onClose={() => setDepositFor(null)}
        onSaved={(overview) => {
          setData(overview)
          setDepositFor(null)
          notifyDataChanged()
        }}
      />
    </div>
  )
}

function GoalSheet({ open, onClose, onSaved }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [form, setForm] = useState({ name: '', emoji: '🎯', target_amount: '', saved_amount: '', deadline: '' })
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const overview = await api.createGoal({
        name: form.name.trim(),
        emoji: form.emoji,
        target_amount: Number(form.target_amount),
        saved_amount: Number(form.saved_amount || 0),
        deadline: form.deadline || null,
      })
      setForm({ name: '', emoji: '🎯', target_amount: '', saved_amount: '', deadline: '' })
      onSaved(overview)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('goals.add')}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <span className="label">{t('goals.emoji')}</span>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((em) => (
              <button
                type="button"
                key={em}
                onClick={() => setForm((f) => ({ ...f, emoji: em }))}
                className={`h-10 w-10 rounded-xl text-xl ${form.emoji === em ? 'bg-brand-soft ring-2 ring-brand' : 'bg-sunken'}`}
                aria-pressed={form.emoji === em}
              >
                {em}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="goal-name">{t('goals.name')}</label>
          <input id="goal-name" className="input" required maxLength={120} dir="auto" placeholder={t('goals.namePlaceholder')} value={form.name} onChange={set('name')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="goal-target">{t('goals.target')}</label>
            <input id="goal-target" className="input" type="number" inputMode="decimal" min="1" step="1" required value={form.target_amount} onChange={set('target_amount')} />
          </div>
          <div>
            <label className="label" htmlFor="goal-saved">{t('goals.saved')}</label>
            <input id="goal-saved" className="input" type="number" inputMode="decimal" min="0" step="1" value={form.saved_amount} onChange={set('saved_amount')} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="goal-deadline">
            {t('goals.deadline')} <span className="text-muted">({t('common.optional')})</span>
          </label>
          <input id="goal-deadline" className="input" type="date" min={toISODate(new Date())} value={form.deadline} onChange={set('deadline')} />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

function DepositSheet({ target, onClose, onSaved }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  if (!target) return null
  const { goal, sign } = target

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const overview = await api.depositGoal(goal.id, sign * Number(amount))
      setAmount('')
      onSaved(overview)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`${goal.emoji} ${sign > 0 ? t('goals.deposit') : t('goals.withdraw')}`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted"><bdi>{goal.name}</bdi></p>
        <div>
          <label className="label" htmlFor="deposit-amount">{t('goals.depositAmount')}</label>
          <input
            id="deposit-amount"
            className="input text-lg"
            type="number"
            inputMode="decimal"
            min="1"
            step="0.01"
            max={sign < 0 ? goal.saved_amount : undefined}
            required
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {sign > 0 && goal.required_monthly > 0 && (
          <button type="button" className="chip" onClick={() => setAmount(String(goal.required_monthly))}>
            {formatMoney(goal.required_monthly)}
          </button>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
