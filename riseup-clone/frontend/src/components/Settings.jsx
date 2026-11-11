import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, IS_LOCAL, notifyDataChanged } from '../api'
import { LANGUAGES } from '../i18n'
import { useApi } from '../hooks/useApi'
import { useCategories } from '../hooks/useCategories'
import { notificationsSupported, requestNotificationPermission } from '../local/phoneNotify'
import { categoryName, formatDateTime, formatMoney } from '../utils/format'
import { CategoryIcon, ErrorState, LoadingBlock, Toggle, useToast } from './ui'
import AutoPayments from './AutoPayments'

export default function Settings() {
  const { t } = useTranslation()
  const { data: settings, error, reload, setData } = useApi(() => api.settings(), [])

  if (error && !settings) return <ErrorState error={error} onRetry={reload} />
  if (!settings) return <LoadingBlock />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
      {IS_LOCAL && <AutoPayments />}
      {IS_LOCAL && <YourData />}
      <ProfileForm settings={settings} onSaved={setData} />
      <Notifications settings={settings} onSaved={setData} />
      <Budgets currency={settings.currency} />
      <FixedExpenses currency={settings.currency} />
      <BankAccounts />
    </div>
  )
}

function ProfileForm({ settings, onSaved }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [form, setForm] = useState(settings)
  const [busy, setBusy] = useState(false)
  useEffect(() => setForm(settings), [settings])
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const saved = await api.updateSettings({
        name: form.name.trim(),
        phone: form.phone ? form.phone : null,
        language: form.language,
        currency: form.currency,
        expected_monthly_income: Number(form.expected_monthly_income) || 0,
      })
      onSaved(saved)
      if (saved.language !== i18n.resolvedLanguage) i18n.changeLanguage(saved.language)
      toast(t('settings.saved'))
      notifyDataChanged()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card space-y-3 p-4" onSubmit={submit}>
      <h2 className="section-title">{t('settings.profile')}</h2>
      <div>
        <label className="label" htmlFor="s-name">{t('settings.name')}</label>
        <input id="s-name" className="input" required maxLength={120} dir="auto" value={form.name} onChange={set('name')} />
      </div>
      {!IS_LOCAL && (
        <div>
          <label className="label" htmlFor="s-phone">{t('settings.phone')}</label>
          <input id="s-phone" className="input num w-full text-start" type="tel" inputMode="tel" dir="ltr" value={form.phone ?? ''} onChange={set('phone')} />
          <p className="mt-1 text-xs text-muted">{t('settings.phoneHelp')}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="s-lang">{t('settings.language')}</label>
          <select id="s-lang" className="input" value={form.language} onChange={set('language')}>
            {Object.entries(LANGUAGES).map(([code, conf]) => (
              <option key={code} value={code}>
                {conf.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="s-cur">{t('settings.currency')}</label>
          <select id="s-cur" className="input" value={form.currency} onChange={set('currency')}>
            {['ILS', 'USD', 'EUR', 'GBP'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="s-income">{t('settings.income')}</label>
        <input id="s-income" className="input" type="number" inputMode="decimal" min="0" step="1" value={form.expected_monthly_income} onChange={set('expected_monthly_income')} />
        <p className="mt-1 text-xs text-muted">{t('settings.incomeHelp')}</p>
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? t('common.saving') : t('common.save')}
      </button>
    </form>
  )
}

function Notifications({ settings, onSaved }) {
  const { t } = useTranslation()
  const toast = useToast()
  const update = async (field, value) => {
    onSaved({ ...settings, [field]: value })
    try {
      onSaved(await api.updateSettings({ [field]: value }))
    } catch (err) {
      onSaved(settings)
      toast(err.message, 'error')
    }
  }
  return (
    <section className="card divide-y divide-line/60 px-4 pt-3">
      <h2 className="section-title pb-1">💬 {t(IS_LOCAL ? 'settings.notificationsLocal' : 'settings.notifications')}</h2>
      <Toggle id="n-weekly" label={t('settings.weekly')} help={t('settings.weeklyHelp')} checked={settings.weekly_summary_enabled} onChange={(v) => update('weekly_summary_enabled', v)} />
      <Toggle id="n-alerts" label={t('settings.alerts')} help={t('settings.alertsHelp')} checked={settings.budget_alerts_enabled} onChange={(v) => update('budget_alerts_enabled', v)} />
      <Toggle id="n-daily" label={t('settings.daily')} help={t('settings.dailyHelp')} checked={settings.daily_update_enabled} onChange={(v) => update('daily_update_enabled', v)} />
      {IS_LOCAL && notificationsSupported() && <PhoneNotificationsToggle />}
    </section>
  )
}

function PhoneNotificationsToggle() {
  const { t } = useTranslation()
  const toast = useToast()
  const { data: enabled, setData } = useApi(() => api.phoneNotifications(), [])
  const change = async (value) => {
    if (value) {
      const permission = await requestNotificationPermission()
      if (permission !== 'granted') {
        toast(t('settings.notifyBlocked'), 'error')
        return
      }
    }
    setData(value)
    await api.setPhoneNotifications(value)
  }
  return <Toggle id="n-phone" label={t('settings.phoneNotify')} help={t('settings.phoneNotifyHelp')} checked={!!enabled} onChange={change} />
}

/** Phone mode: backups, start fresh, demo data. Everything lives only on this device. */
function YourData() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const fileInput = useRef(null)
  const lang = i18n.resolvedLanguage === 'he' ? 'he' : 'en'

  const afterReplace = async () => {
    const settings = await api.settings()
    if (settings.language !== i18n.resolvedLanguage) i18n.changeLanguage(settings.language)
    toast(t('settings.done'))
    notifyDataChanged()
  }

  const download = async () => {
    const data = await api.exportBackup()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bottom-line-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const restore = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await api.importBackup(JSON.parse(await file.text()))
      await afterReplace()
      toast(t('settings.imported'))
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const startFresh = async () => {
    if (!window.confirm(t('settings.startFreshConfirm'))) return
    await api.startFresh({ name: '', language: lang })
    await afterReplace()
  }

  const loadDemo = async () => {
    if (!window.confirm(t('settings.loadDemoConfirm'))) return
    await api.loadDemo({ language: lang })
    await afterReplace()
  }

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="section-title">📱 {t('settings.data')}</h2>
        <p className="text-xs text-muted">{t('settings.dataHelp')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary" onClick={download}>
          ⬇ {t('settings.exportBackup')}
        </button>
        <button className="btn-ghost" onClick={() => fileInput.current?.click()}>
          ⬆ {t('settings.importBackup')}
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={restore} />
      </div>
      <div className="border-t border-line/60 pt-3">
        <button className="btn w-full text-bad hover:bg-bad/10" onClick={startFresh}>
          {t('settings.startFresh')}
        </button>
        <p className="mt-1 text-center text-xs text-muted">{t('settings.startFreshHelp')}</p>
        <button className="mt-2 w-full text-center text-xs font-medium text-brand" onClick={loadDemo}>
          {t('settings.loadDemo')}
        </button>
      </div>
    </section>
  )
}

function Budgets({ currency }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const toast = useToast()
  const { list } = useCategories()
  const { data: budgets, reload } = useApi(() => api.budgets(), [])
  const [newKey, setNewKey] = useState('')
  const [newLimit, setNewLimit] = useState('')

  const available = list.filter((c) => !c.is_income && !c.is_fixed && !budgets?.some((b) => b.category.key === c.key))

  const save = async (key, limit) => {
    try {
      await api.upsertBudget(key, Number(limit))
      reload()
      notifyDataChanged()
    } catch (err) {
      toast(err.message, 'error')
    }
  }
  const remove = async (id) => {
    await api.deleteBudget(id)
    reload()
    notifyDataChanged()
  }

  return (
    <section className="card p-4">
      <h2 className="section-title">🎯 {t('settings.budgets')}</h2>
      <p className="mb-3 text-xs text-muted">{t('settings.budgetsHelp')}</p>
      <ul className="space-y-2">
        {budgets?.map((b) => (
          <li key={b.id} className="flex items-center gap-3">
            <CategoryIcon category={b.category} size="sm" />
            <span className="flex-1 text-sm font-medium">{categoryName(b.category, lang)}</span>
            <input
              className="input w-28 py-1.5 text-end"
              type="number"
              min="1"
              defaultValue={b.monthly_limit}
              aria-label={`${t('settings.limit')} – ${categoryName(b.category, lang)}`}
              onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== b.monthly_limit && save(b.category.key, e.target.value)}
            />
            <button className="p-2 text-muted hover:text-bad" onClick={() => remove(b.id)} aria-label={t('common.delete')}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <form
          className="mt-3 flex gap-2 border-t border-line/60 pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (newKey && Number(newLimit) > 0) {
              save(newKey, newLimit)
              setNewKey('')
              setNewLimit('')
            }
          }}
        >
          <select className="input flex-1" value={newKey} onChange={(e) => setNewKey(e.target.value)} required aria-label={t('tx.category')}>
            <option value="">{t('settings.addBudget')}…</option>
            {available.map((c) => (
              <option key={c.key} value={c.key}>
                {c.icon} {categoryName(c, lang)}
              </option>
            ))}
          </select>
          <input
            className="input w-24"
            type="number"
            min="1"
            required
            placeholder={formatMoney(0, { lang, currency }).replace(/0/g, '')}
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            aria-label={t('settings.limit')}
          />
          <button className="btn-primary px-3" aria-label={t('settings.addBudget')}>
            +
          </button>
        </form>
      )}
    </section>
  )
}

function FixedExpenses({ currency }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const toast = useToast()
  const { list } = useCategories()
  const { data: items, reload } = useApi(() => api.fixedExpenses(), [])
  const fixedCats = list.filter((c) => c.is_fixed)
  const blank = { name: '', amount: '', category_key: '', day_of_month: 1 }
  const [form, setForm] = useState(blank)

  const add = async (e) => {
    e.preventDefault()
    try {
      await api.createFixedExpense({ ...form, amount: Number(form.amount), day_of_month: Number(form.day_of_month) })
      setForm(blank)
      reload()
      notifyDataChanged()
    } catch (err) {
      toast(err.message, 'error')
    }
  }
  const remove = async (id) => {
    await api.deleteFixedExpense(id)
    reload()
    notifyDataChanged()
  }

  return (
    <section className="card p-4">
      <h2 className="section-title">📌 {t('settings.fixed')}</h2>
      <p className="mb-3 text-xs text-muted">{t('settings.fixedHelp')}</p>
      <ul className="space-y-2">
        {items?.map((fe) => (
          <li key={fe.id} className="flex items-center gap-3">
            <CategoryIcon category={fe.category} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium"><bdi>{fe.name}</bdi></p>
              <p className="text-xs text-muted">
                {categoryName(fe.category, lang)} · {t('settings.onDay', { day: fe.day_of_month })}
              </p>
            </div>
            <span className="num text-sm font-medium">{formatMoney(fe.amount, { lang, currency })}</span>
            <button className="p-2 text-muted hover:text-bad" onClick={() => remove(fe.id)} aria-label={t('common.delete')}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form className="mt-3 grid grid-cols-2 gap-2 border-t border-line/60 pt-3" onSubmit={add}>
        <input className="input col-span-2" required maxLength={120} dir="auto" placeholder={t('settings.fixedName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className="input" required value={form.category_key} onChange={(e) => setForm({ ...form, category_key: e.target.value })} aria-label={t('tx.category')}>
          <option value="">{t('tx.category')}…</option>
          {fixedCats.map((c) => (
            <option key={c.key} value={c.key}>
              {c.icon} {categoryName(c, lang)}
            </option>
          ))}
        </select>
        <input className="input" type="number" min="1" step="0.01" required placeholder={t('tx.amount')} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          {t('settings.dayOfMonth')}
          <input className="input w-20" type="number" min="1" max="31" required value={form.day_of_month} onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} />
        </label>
        <button className="btn-primary">+ {t('settings.addFixed')}</button>
      </form>
    </section>
  )
}

function BankAccounts() {
  const { t, i18n } = useTranslation()
  const { data: accounts } = useApi(() => api.accounts(), [])
  if (IS_LOCAL && !accounts?.length) return null
  return (
    <section className="card p-4">
      <h2 className="section-title">🏦 {t('settings.banks')}</h2>
      <p className="mb-3 text-xs text-muted">🔒 {t('settings.readOnly')}</p>
      <ul className="space-y-2">
        {accounts?.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded-xl bg-sunken px-3 py-2 text-sm">
            <span>
              {a.bank_name} <span className="num text-muted">•••• {a.account_mask}</span>
            </span>
            <span className="text-xs text-muted">
              {t('settings.lastSync', { when: a.last_synced_at ? formatDateTime(a.last_synced_at, i18n.language) : t('settings.never') })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
