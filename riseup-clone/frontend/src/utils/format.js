import { LANGUAGES } from '../i18n'

const cache = new Map()
function nf(key, factory) {
  if (!cache.has(key)) cache.set(key, factory())
  return cache.get(key)
}

export function localeFor(lang) {
  return (LANGUAGES[lang] ?? LANGUAGES.en).locale
}

/** ₪1,234 – whole shekels unless `decimals` is given. */
export function formatMoney(amount, { lang = 'en', currency = 'ILS', decimals = 0, signed = false } = {}) {
  const value = Number(amount) || 0
  const formatter = nf(`m:${lang}:${currency}:${decimals}:${signed}`, () =>
    new Intl.NumberFormat(localeFor(lang), {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      signDisplay: signed ? 'exceptZero' : 'auto',
    }),
  )
  return formatter.format(value)
}

/** Compact axis ticks: 0 / 1K / 12K. */
export function formatCompact(value, lang = 'en') {
  return nf(`c:${lang}`, () => new Intl.NumberFormat(localeFor(lang), { notation: 'compact', maximumFractionDigits: 1 })).format(value)
}

export function formatPercent(value, lang = 'en') {
  return nf(`p:${lang}`, () => new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 0 })).format(value) + '%'
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatDate(iso, lang = 'en', opts = { day: 'numeric', month: 'short' }) {
  const key = `d:${lang}:${JSON.stringify(opts)}`
  return nf(key, () => new Intl.DateTimeFormat(localeFor(lang), opts)).format(parseISODate(iso))
}

export function formatMonth(month, lang = 'en', opts = { month: 'long', year: 'numeric' }) {
  return formatDate(`${month}-01`, lang, opts)
}

export function formatDateTime(isoDateTime, lang = 'en') {
  return nf(`dt:${lang}`, () =>
    new Intl.DateTimeFormat(localeFor(lang), { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }),
  ).format(new Date(isoDateTime))
}

export function currentMonth() {
  return toISODate(new Date()).slice(0, 7)
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return toISODate(d).slice(0, 7)
}

export function categoryName(category, lang) {
  if (!category) return ''
  return lang === 'he' ? category.name_he : category.name_en
}

/** Light WhatsApp markdown: *bold*, _italic_, line breaks. Returns React-safe segments. */
export function parseWhatsAppMarkup(text) {
  const parts = []
  const re = /(\*[^*\n]+\*|_[^_\n]+_)/g
  let last = 0
  let match
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) })
    const token = match[0]
    parts.push({ type: token[0] === '*' ? 'bold' : 'italic', value: token.slice(1, -1) })
    last = match.index + token.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}
