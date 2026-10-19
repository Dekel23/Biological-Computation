import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, notifyDataChanged } from '../api'
import { useApi } from '../hooks/useApi'
import { categoryName, currentMonth, formatCompact, formatDate, formatMoney, formatMonth } from '../utils/format'
import { CategoryIcon, ErrorState, LoadingBlock, MonthSwitcher, Spinner, useToast } from './ui'

// Status chips sit on the brand gradient: white pill, status carried by icon + label + ink colour.
const STATUS_STYLE = {
  great: { cls: 'text-good', icon: '✓' },
  ok: { cls: 'text-ink', icon: '!' },
  tight: { cls: 'text-ink', icon: '⚠' },
  over: { cls: 'text-bad', icon: '✕' },
}

/** Chart colours come from CSS tokens so light/dark mode stay in sync with the theme. */
function useChartColors() {
  const read = () => {
    const css = getComputedStyle(document.documentElement)
    const v = (name) => css.getPropertyValue(name).trim()
    return {
      series1: v('--chart-series-1'),
      series2: v('--chart-series-2'),
      reference: v('--chart-reference'),
      grid: v('--chart-grid'),
      axis: v('--chart-axis'),
      surface: v('--chart-surface'),
    }
  }
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setColors(read())
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return colors
}

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [month, setMonth] = useState(currentMonth())
  const { data, error, loading, reload } = useApi(() => api.summary(month), [month])

  if (error && !data) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <LoadingBlock />

  const bl = data.bottom_line
  const cur = data.user.currency
  const money = (v, opts) => formatMoney(v, { lang, currency: cur, ...opts })

  return (
    <div className="space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('dashboard.greeting', { name: data.user.name })}</h1>
        <MonthSwitcher month={month} onChange={setMonth} maxMonth={currentMonth()} />
      </div>

      <HeroCard bl={bl} money={money} month={month} />
      <SyncButton />
      <Highlights highlights={data.highlights} money={money} />
      <SpendingChart bl={bl} money={money} />
      <CategoryBreakdown categories={bl.categories} money={money} />
      <TrendChart trend={data.trend} money={money} />
    </div>
  )
}

function HeroCard({ bl, money, month }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const status = STATUS_STYLE[bl.status]
  const negative = bl.free_to_spend < 0

  return (
    <section className="card overflow-hidden">
      <div className="bg-gradient-to-br from-brand to-brand/80 p-5 text-brand-ink">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm opacity-90">
              {t('dashboard.freeToSpend')} {t('dashboard.inMonth', { month: formatMonth(month, lang, { month: 'long' }) })}
            </p>
            <p className="mt-1 text-5xl font-semibold tracking-tight">
              <span className="num">{money(bl.free_to_spend)}</span>
            </p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold ${status.cls}`}>
            <span aria-hidden>{status.icon}</span>
            {t(`dashboard.status.${bl.status}`)}
          </span>
        </div>
        <p className="mt-2 text-sm opacity-90">
          {bl.days_left > 0
            ? negative
              ? t('dashboard.status.over')
              : t('dashboard.perDay', { amount: money(bl.daily_allowance), count: bl.days_left })
            : t('dashboard.monthClosed')}
        </p>
      </div>

      <dl className="divide-y divide-line/70 px-5">
        <Row
          label={t('dashboard.income')}
          value={money(bl.total_income)}
          note={bl.income_is_projected ? `${t('dashboard.expected')} · ${money(bl.actual_income)} ✓` : null}
          sign="+"
        />
        <Row
          label={t('dashboard.fixed')}
          value={money(bl.fixed_expenses)}
          note={bl.fixed_pending > 0 ? t('dashboard.pendingFixed', { amount: money(bl.fixed_pending) }) : null}
          sign="−"
        />
        <Row
          label={t('dashboard.variable')}
          value={money(bl.variable_expenses)}
          note={bl.unallocated_cash > 0 ? t('dashboard.unallocatedCash', { amount: money(bl.unallocated_cash) }) : null}
          sign="−"
        />
        <div className="flex items-center justify-between py-3 text-sm">
          <span className="text-muted">{t('dashboard.formula')}</span>
          <span className={`num font-semibold ${negative ? 'text-bad' : ''}`}>{money(bl.free_to_spend)}</span>
        </div>
        {bl.days_left > 0 && (
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <dt className="text-sm font-medium">🔮 {t('dashboard.forecast')}</dt>
              <dd className="text-xs text-muted">{t('dashboard.forecastHint')}</dd>
            </div>
            <span className={`num text-base font-semibold ${bl.forecast_free_to_spend < 0 ? 'text-bad' : 'text-good'}`}>
              {money(bl.forecast_free_to_spend)}
            </span>
          </div>
        )}
      </dl>
    </section>
  )
}

function Row({ label, value, note, sign }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div>
        <dt className="text-sm font-medium">{label}</dt>
        {note && <dd className="text-xs text-muted">{note}</dd>}
      </div>
      <span className="num text-base font-medium">
        <span className="text-muted">{sign} </span>
        {value}
      </span>
    </div>
  )
}

function SyncButton() {
  const { t } = useTranslation()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const sync = async () => {
    setBusy(true)
    try {
      const res = await api.syncBank()
      toast(t('dashboard.synced', { count: res.created }))
      notifyDataChanged()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className="btn-ghost w-full" onClick={sync} disabled={busy}>
      {busy ? <Spinner className="h-4 w-4" /> : '🏦'} {busy ? t('dashboard.syncing') : t('dashboard.sync')}
    </button>
  )
}

function Highlights({ highlights, money }) {
  const { t } = useTranslation()
  const items = []
  if (highlights.subscriptions_monthly > 0) {
    items.push({ icon: '🔁', text: t('dashboard.subscriptions', { amount: money(highlights.subscriptions_monthly) }), to: '/goals' })
  }
  highlights.price_hikes.forEach((h) =>
    items.push({ icon: '🔔', text: t('dashboard.priceHike', { merchant: h.merchant, pct: Math.round(h.price_change_pct) }), to: '/goals' }),
  )
  if (highlights.goals_required_monthly > 0) {
    items.push({
      icon: '🎯',
      text: `${t('dashboard.goalsNeed', { amount: money(highlights.goals_required_monthly) })} · ${
        highlights.goals_affordable ? t('dashboard.goalsOk') : t('dashboard.goalsShort')
      }`,
      to: '/goals',
    })
  }
  if (!items.length) return null
  return (
    <section className="card p-4">
      <h2 className="section-title mb-2">💡 {t('dashboard.highlights')}</h2>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i}>
            <Link to={item.to} className="flex items-start gap-3 rounded-xl p-2 text-sm hover:bg-sunken">
              <span aria-hidden>{item.icon}</span>
              <span className="flex-1">{item.text}</span>
              <span className="text-muted rtl:rotate-180" aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ charts */
function ChartTooltip({ active, payload, label, formatLabel, money }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{formatLabel(label)}</div>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined)
        .map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-ink-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
            <span>{p.name}</span>
            <span className="num ms-auto font-medium text-ink">{money(p.value)}</span>
          </div>
        ))}
    </div>
  )
}

function Legend({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className={item.bar ? 'rounded-sm' : 'rounded-full'}
            style={{ backgroundColor: item.color, height: item.bar ? 10 : 3, width: item.bar ? 10 : 16 }}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

function ChartCard({ title, description, legend, table, children }) {
  const { t } = useTranslation()
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="section-title">{title}</h2>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        <button className="shrink-0 text-xs font-medium text-brand hover:underline" onClick={() => setShowTable((s) => !s)}>
          {showTable ? t('dashboard.hideTable') : t('dashboard.showTable')}
        </button>
      </div>
      {legend}
      <div className="mt-2">{showTable ? table : children}</div>
    </section>
  )
}

function SpendingChart({ bl, money }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const rtl = i18n.dir() === 'rtl'
  const c = useChartColors()
  const data = bl.daily_series
  const fmtDay = (iso) => formatDate(iso, lang, { day: 'numeric', month: 'short' })
  const compact = (v) => formatCompact(v, lang)

  const table = (
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs text-muted">
          <tr>
            <th className="py-1 text-start font-medium">{t('dashboard.day')}</th>
            <th className="py-1 text-end font-medium">{t('dashboard.actual')}</th>
            <th className="py-1 text-end font-medium">{t('dashboard.idealPace')}</th>
          </tr>
        </thead>
        <tbody>
          {data.filter((d) => d.actual !== null).map((d) => (
            <tr key={d.date} className="border-t border-line/60">
              <td className="py-1">{fmtDay(d.date)}</td>
              <td className="num py-1 text-end">{money(d.actual)}</td>
              <td className="num py-1 text-end text-muted">{money(d.ideal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <ChartCard
      title={t('dashboard.spendChart')}
      description={t('dashboard.spendChartDesc')}
      legend={<Legend items={[{ label: t('dashboard.actual'), color: c.series1 }, { label: t('dashboard.idealPace'), color: c.reference }]} />}
      table={table}
    >
      <div className="h-56" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
            <XAxis
              dataKey="date"
              reversed={rtl}
              tickFormatter={(iso) => Number(iso.slice(8))}
              interval="preserveStartEnd"
              minTickGap={16}
              tick={{ fill: c.axis, fontSize: 11 }}
              axisLine={{ stroke: c.grid }}
              tickLine={false}
            />
            <YAxis
              orientation={rtl ? 'right' : 'left'}
              tickFormatter={compact}
              width={40}
              tick={{ fill: c.axis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<ChartTooltip formatLabel={fmtDay} money={money} />}
              cursor={{ stroke: c.axis, strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="ideal"
              name={t('dashboard.idealPace')}
              stroke={c.reference}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: c.reference, stroke: c.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="actual"
              name={t('dashboard.actual')}
              stroke={c.series1}
              strokeWidth={2}
              fill={c.series1}
              fillOpacity={0.1}
              connectNulls={false}
              dot={false}
              activeDot={{ r: 5, fill: c.series1, stroke: c.surface, strokeWidth: 2 }}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

function TrendChart({ trend, money }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const rtl = i18n.dir() === 'rtl'
  const c = useChartColors()
  const fmtMonth = (m) => formatMonth(m, lang, { month: 'short' })
  const fmtMonthLong = (m) => formatMonth(m, lang)

  const table = (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted">
        <tr>
          <th className="py-1 text-start font-medium">{t('dashboard.month')}</th>
          <th className="py-1 text-end font-medium">{t('dashboard.incomeSeries')}</th>
          <th className="py-1 text-end font-medium">{t('dashboard.expensesSeries')}</th>
        </tr>
      </thead>
      <tbody>
        {trend.map((row) => (
          <tr key={row.month} className="border-t border-line/60">
            <td className="py-1">{fmtMonthLong(row.month)}</td>
            <td className="num py-1 text-end">{money(row.income)}</td>
            <td className="num py-1 text-end">{money(row.expenses)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <ChartCard
      title={t('dashboard.trendChart')}
      description={t('dashboard.trendChartDesc')}
      legend={
        <Legend
          items={[
            { label: t('dashboard.incomeSeries'), color: c.series1, bar: true },
            { label: t('dashboard.expensesSeries'), color: c.series2, bar: true },
          ]}
        />
      }
      table={table}
    >
      <div className="h-52" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="month"
              reversed={rtl}
              tickFormatter={fmtMonth}
              tick={{ fill: c.axis, fontSize: 11 }}
              axisLine={{ stroke: c.grid }}
              tickLine={false}
            />
            <YAxis
              orientation={rtl ? 'right' : 'left'}
              tickFormatter={(v) => formatCompact(v, lang)}
              width={40}
              tick={{ fill: c.axis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<ChartTooltip formatLabel={fmtMonthLong} money={money} />} cursor={{ fill: c.grid, opacity: 0.6 }} />
            <Bar dataKey="income" name={t('dashboard.incomeSeries')} fill={c.series1} radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="expenses" name={t('dashboard.expensesSeries')} fill={c.series2} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

/* -------------------------------------------------------------- categories */
function CategoryBreakdown({ categories, money }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const rows = useMemo(() => categories.filter((c) => c.amount > 0 || c.budget), [categories])
  const max = Math.max(1, ...rows.map((c) => Math.max(c.amount, c.budget ?? 0)))

  return (
    <section className="card p-4">
      <h2 className="section-title mb-3">{t('dashboard.categories')}</h2>
      {!rows.length && <p className="text-sm text-muted">{t('dashboard.noSpending')}</p>}
      <ul className="space-y-3">
        {rows.map((cat) => {
          const pct = cat.budget_used_pct
          const over = pct !== null && pct > 100
          const meterColor = pct === null ? 'bg-brand' : pct >= 100 ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-brand'
          const width = cat.budget ? Math.min(100, (cat.amount / cat.budget) * 100) : (cat.amount / max) * 100
          return (
            <li key={cat.key}>
              <Link to={`/transactions?category=${cat.key}`} className="flex items-center gap-3 rounded-xl hover:bg-sunken/60">
                <CategoryIcon category={cat} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium">
                      {categoryName(cat, lang)}
                      {cat.is_fixed && <span className="ms-2 rounded bg-sunken px-1.5 py-0.5 text-[10px] text-muted">{t('dashboard.fixedTag')}</span>}
                    </span>
                    <span className="num shrink-0 font-medium">{money(cat.amount)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
                    <div className={`h-full rounded-full ${meterColor}`} style={{ width: `${Math.max(width, 2)}%` }} />
                  </div>
                  {cat.budget && (
                    <div className={`mt-1 flex justify-between text-[11px] ${over ? 'font-medium text-bad' : 'text-muted'}`}>
                      <span>
                        {over ? '⚠ ' : pct >= 80 ? '! ' : ''}
                        {over
                          ? t('dashboard.overBudget', { amount: money(cat.amount - cat.budget) })
                          : t('dashboard.budgetOf', { limit: money(cat.budget) })}
                      </span>
                      <span className="num">{Math.round(pct)}%</span>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
