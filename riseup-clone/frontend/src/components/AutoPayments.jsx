import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, notifyDataChanged } from '../api'
import { parseSms } from '../local/smsParser'
import { formatDate, formatMoney } from '../utils/format'
import { useToast } from './ui'

/** The app's own address with an empty ?sms= for MacroDroid to append the message to. */
export function smsLink() {
  return `${window.location.origin}${window.location.pathname}?sms=`
}

export default function AutoPayments() {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const link = smsLink()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt(t('auto.linkLabel'), link)
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="section-title">💳 {t('auto.title')}</h2>
        <p className="text-sm text-ink-2">{t('auto.intro')}</p>
      </div>

      <div className="rounded-xl bg-sunken p-3">
        <p className="mb-2 text-sm font-semibold">{t('auto.androidTitle')}</p>
        <ol className="list-decimal space-y-1.5 ps-5 text-sm text-ink-2">
          <li>{t('auto.step1')}</li>
          <li>{t('auto.step2')}</li>
          <li>{t('auto.step3')}</li>
          <li>{t('auto.step4')}</li>
        </ol>
        <label className="label mt-3" htmlFor="sms-link">{t('auto.linkLabel')}</label>
        <div className="flex gap-2">
          <input id="sms-link" className="input num flex-1 text-start text-xs" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn-primary shrink-0 px-3" onClick={copy}>
            {copied ? t('auto.copied') : t('auto.copy')}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted">📤 {t('auto.shareTip')}</p>
      <SmsTester />
      <p className="text-xs text-muted">
        📄 {t('auto.historyTip')}{' '}
        <Link to="/transactions" className="font-medium text-brand">
          {t('nav.transactions')} ›
        </Link>
      </p>
    </section>
  )
}

function SmsTester() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [text, setText] = useState('')
  const res = text.trim() ? parseSms(text) : null
  return (
    <div>
      <label className="label" htmlFor="sms-test">{t('auto.testTitle')}</label>
      <textarea id="sms-test" className="input min-h-[5rem] text-sm" dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('auto.testPlaceholder')} />
      {res && (
        <div className={`mt-2 rounded-xl p-3 text-sm ${res.type === 'ignore' ? 'bg-sunken text-muted' : 'bg-good/10'}`}>
          <p className="font-semibold">
            {res.type === 'ignore' ? '⛔' : '✅'} {t(`auto.result.${res.type}`)}
            {res.type === 'ignore' && ` – ${t(`auto.reasons.${res.reason}`)}`}
          </p>
          {res.type !== 'ignore' && (
            <p className="mt-1 text-ink-2">
              <span className="num font-medium text-ink">{formatMoney(res.amountILS, { lang, decimals: 2 })}</span>
              {res.currency !== 'ILS' && <span className="num"> ({res.currency} {res.amount})</span>}
              {' · '}
              <bdi>{res.merchant || t('auto.merchantUnknown')}</bdi>
              {res.last4 && <span className="num"> · ••{res.last4}</span>}
              {' · '}
              {formatDate(res.date, lang)}
              {res.issuer && ` · ${res.issuer}`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Read an SMS handed to the app in its address (MacroDroid's ?sms= or the share sheet's ?text=). */
function readIncoming() {
  const { search, hash } = window.location
  const params = new URLSearchParams(search)
  if (search.startsWith('?sms=')) {
    // MacroDroid may not encode the message, so take everything after "sms=" literally –
    // a "#" or "&" inside the SMS must not cut it short.
    let raw = search.slice(5)
    if (hash && !hash.startsWith('#/')) raw += hash
    try {
      raw = decodeURIComponent(raw.replace(/\+/g, '%20'))
    } catch {
      /* already plain text */
    }
    return { text: raw, sender: '', batch: false }
  }
  const shared = [params.get('title'), params.get('text')].filter(Boolean).join('\n')
  return shared ? { text: shared, sender: '', batch: true } : null
}

let handled = false

export function IncomingSms() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || handled) return
    ran.current = true
    handled = true
    const incoming = readIncoming()
    if (!incoming) return
    // Drop the message from the address so a reload doesn't log it again.
    window.history.replaceState(null, '', window.location.pathname)
    navigate('/transactions', { replace: true })
    const run = incoming.batch ? api.logSmsBatch(incoming.text) : api.logSms(incoming.text, incoming.sender)
    run
      .then((res) => {
        if ('results' in res) toast(t('importer.smsDone', res))
        else if (res.status === 'logged') {
          const amount = formatMoney(Math.abs(res.transaction.amount), { lang: i18n.language, decimals: 2 })
          toast(t('incoming.logged', { amount, merchant: res.transaction.merchant }))
        } else if (res.status === 'duplicate') toast(t('incoming.duplicate'))
        else toast(t('incoming.ignored', { reason: t(`auto.reasons.${res.reason}`) }), 'error')
        notifyDataChanged()
      })
      .catch((err) => toast(err.message, 'error'))
  }, [t, i18n, toast, navigate])

  return null
}
