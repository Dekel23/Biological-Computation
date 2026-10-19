import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, notifyDataChanged } from '../api'
import { useApi } from '../hooks/useApi'
import { formatDateTime, parseWhatsAppMarkup } from '../utils/format'
import { ErrorState, LoadingBlock, Spinner, useToast } from './ui'

const EXAMPLES = [
  'I spent 50 on coffee',
  'הוצאתי 50 שקל על קפה',
  '120 groceries at Shufersal',
  'חמישים שקל פלאפל',
  'how much can I spend?',
  'כמה נשאר?',
  'budget coffee 300',
  'סיכום',
  'got paid 500',
  'undo',
  'help',
]

function Markup({ text }) {
  return parseWhatsAppMarkup(text).map((part, i) =>
    part.type === 'bold' ? (
      <strong key={i}>{part.value}</strong>
    ) : part.type === 'italic' ? (
      <em key={i}>{part.value}</em>
    ) : (
      <span key={i}>{part.value}</span>
    ),
  )
}

function Bubble({ message, lang }) {
  const { t } = useTranslation()
  const inbound = message.direction === 'in'
  const proactive = ['weekly_summary', 'budget_alert', 'free_to_spend'].includes(message.kind)
  return (
    <li className={`flex ${inbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          inbound ? 'rounded-ee-md bg-[#d9fdd3] text-[#111b21]' : 'rounded-es-md bg-white text-[#111b21]'
        }`}
      >
        {proactive && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#008069]">
            🔔 {t(`bot.kinds.${message.kind}`)}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words" dir="auto">
          <Markup text={message.body} />
        </p>
        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
          {message.transaction_id && inbound && <span title={t('bot.logged')}>🧾</span>}
          <span className="num">{formatDateTime(message.created_at, lang)}</span>
          {!inbound && <span className={message.status === 'failed' ? 'text-bad' : 'text-[#53bdeb]'}>{message.status === 'failed' ? '!' : '✓✓'}</span>}
        </p>
      </div>
    </li>
  )
}

export default function WhatsAppSimulator() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const toast = useToast()
  const { data: messages, error, reload, setData } = useApi(() => api.botMessages(), [])
  const { data: status } = useApi(() => api.botStatus(), [])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [proactiveBusy, setProactiveBusy] = useState(null)
  const scroller = useRef(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (body) => {
    const value = body.trim()
    if (!value || sending) return
    setSending(true)
    setText('')
    // Optimistic bubble while the bot thinks.
    const temp = { id: `tmp-${Date.now()}`, direction: 'in', kind: 'inbound', body: value, status: 'received', created_at: new Date().toISOString() }
    setData((prev) => [...(prev ?? []), temp])
    try {
      const res = await api.botSend(value)
      setData((prev) => [...(prev ?? []).filter((m) => m.id !== temp.id), ...res.messages])
      if (res.transaction || res.intent === 'set_budget' || res.intent === 'undo') notifyDataChanged()
    } catch (err) {
      setData((prev) => (prev ?? []).filter((m) => m.id !== temp.id))
      setText(value)
      toast(err.message, 'error')
    } finally {
      setSending(false)
    }
  }

  const proactive = async (kind) => {
    setProactiveBusy(kind)
    try {
      const sent = await api.botProactive(kind)
      if (!sent.length) toast(t('bot.noAlerts'))
      setData((prev) => [...(prev ?? []), ...sent])
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setProactiveBusy(null)
    }
  }

  const clear = async () => {
    await api.botClear()
    setData([])
  }

  if (error && !messages) return <ErrorState error={error} onRetry={reload} />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t('bot.title')}</h1>
          <p className="text-xs text-muted">
            {t('bot.subtitle')} ·{' '}
            <span className={status?.mode === 'live' ? 'text-good' : ''}>{t(`bot.mode.${status?.mode ?? 'simulated'}`)}</span>
          </p>
        </div>
        <button className="text-xs font-medium text-muted hover:text-bad" onClick={clear}>
          {t('bot.clear')}
        </button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-line shadow-card">
        <div className="flex items-center gap-3 bg-[#008069] px-4 py-3 text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg" aria-hidden>
            💸
          </span>
          <div className="leading-tight">
            <p className="font-semibold">{t('app.name')}</p>
            <p className="text-xs opacity-80">{sending ? '…' : 'online'}</p>
          </div>
        </div>

        <div ref={scroller} className="h-[calc(100dvh-26rem)] min-h-[16rem] overflow-y-auto bg-[#efeae2] p-3 dark:bg-[#0b141a]">
          {!messages && <LoadingBlock />}
          {messages && !messages.length && <p className="mx-auto mt-10 max-w-xs text-center text-sm text-[#667781]">{t('bot.empty')}</p>}
          <ul className="space-y-2">
            {messages?.map((m) => (
              <Bubble key={m.id} message={m} lang={lang} />
            ))}
          </ul>
        </div>

        <form
          className="flex items-center gap-2 border-t border-line bg-card p-2"
          onSubmit={(e) => {
            e.preventDefault()
            send(text)
          }}
        >
          <input
            className="input flex-1 rounded-full"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('bot.placeholder')}
            dir="auto"
            maxLength={1000}
            aria-label={t('bot.placeholder')}
            enterKeyHint="send"
          />
          <button
            type="submit"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#008069] text-white disabled:opacity-50"
            disabled={!text.trim() || sending}
            aria-label={t('bot.send')}
          >
            {sending ? <Spinner className="border-white/40 border-t-white" /> : <span className="rtl:-scale-x-100">➤</span>}
          </button>
        </form>
      </section>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">{t('bot.examples')}</p>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" dir="auto" onClick={() => send(ex)} disabled={sending}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      <section className="card p-4">
        <h2 className="section-title mb-3">{t('bot.proactive')}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            ['weekly_summary', '🗓️', t('bot.weekly')],
            ['free_to_spend', '💸', t('bot.freeToSpend')],
            ['budget_alerts', '🎯', t('bot.budgets')],
          ].map(([kind, icon, label]) => (
            <button key={kind} className="btn-ghost justify-start" onClick={() => proactive(kind)} disabled={proactiveBusy !== null}>
              {proactiveBusy === kind ? <Spinner className="h-4 w-4" /> : icon} {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
