import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useApi } from '../hooks/useApi'
import { formatDate, formatMoney } from '../utils/format'
import { CategoryIcon, LoadingBlock } from './ui'

export default function SubscriptionRadar() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { data } = useApi(() => api.subscriptions(), [])
  const [scope, setScope] = useState('subscriptions')
  const money = (v, decimals = 0) => formatMoney(v, { lang, decimals })
  const arrow = i18n.dir() === 'rtl' ? '←' : '→'

  if (!data) return <LoadingBlock />
  const items = data.items.filter((s) => scope === 'all' || s.category_key === 'subscriptions')
  const monthly = scope === 'all' ? data.total_monthly : data.subscriptions_monthly
  const yearly = scope === 'all' ? data.total_yearly : data.subscriptions_yearly

  return (
    <section className="card overflow-hidden">
      <div className="p-4">
        <h2 className="section-title">📡 {t('radar.title')}</h2>
        <p className="text-xs text-muted">{t('radar.subtitle')}</p>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-sm">
          {[
            ['subscriptions', t('radar.subscriptionsOnly')],
            ['all', t('radar.allRecurring')],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setScope(key)}
              className={`rounded-lg py-1.5 font-medium ${scope === key ? 'bg-card shadow-sm' : 'text-muted'}`}
              aria-pressed={scope === key}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-brand-soft p-3">
            <p className="text-xs text-ink-2">{t('radar.monthly')}</p>
            <p className="num text-lg font-semibold">{money(monthly)}</p>
          </div>
          <div className="rounded-xl bg-brand-soft p-3">
            <p className="text-xs text-ink-2">{t('radar.yearly')}</p>
            <p className="num text-lg font-semibold">{money(yearly)}</p>
          </div>
        </div>
      </div>

      {!items.length && <p className="px-4 pb-4 text-sm text-muted">{t('radar.empty')}</p>}
      <ul className="divide-y divide-line/60 border-t border-line/60">
        {items.map((s) => (
          <li key={s.merchant_key} className={`flex items-center gap-3 px-4 py-3 ${s.active ? '' : 'opacity-60'}`}>
            <CategoryIcon
              category={{ icon: s.category_icon, color: s.price_change_pct > 0 ? '#d03b3b' : '#5b3fd4' }}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium"><bdi>{s.merchant}</bdi></p>
              <p className="text-xs text-muted">
                {t(`radar.cadence.${s.cadence}`)} ·{' '}
                {s.active ? t('radar.next', { date: formatDate(s.next_expected, lang) }) : t('radar.inactive')}
                {!s.fixed_price && ` · ${t('radar.variable')}`}
              </p>
              {s.price_change_pct > 0 && (
                <p className="text-xs font-medium text-bad">
                  {t('radar.priceUp', { pct: s.price_change_pct })} ({money(s.previous_amount, 2)} {arrow} {money(s.last_amount, 2)})
                </p>
              )}
              {s.price_change_pct < 0 && (
                <p className="text-xs font-medium text-good">{t('radar.priceDown', { pct: Math.abs(s.price_change_pct) })}</p>
              )}
            </div>
            <div className="text-end">
              <p className="num text-sm font-semibold">{money(s.last_amount, 2)}</p>
              <p className="num text-[11px] text-muted">
                {money(s.yearly_cost)} / {t('radar.yearly')}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
