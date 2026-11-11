/**
 * Turns a bank / credit-card SMS into a payment.
 *
 * Israeli card companies text on every charge, digital-wallet (Google Pay) charges
 * included. Formats differ between issuers and change over time, so this parser keys
 * on the parts every such message has – an amount with a currency, transaction
 * words, usually a merchant and the card's last 4 digits – rather than on one exact
 * template. Anything it can't read confidently is ignored, never guessed.
 */
import { todayISO } from './dates'

export const FX_TO_ILS = { ILS: 1, USD: 3.7, EUR: 4.0, GBP: 4.7 }

const CURRENCY_ALIASES = [
  [/^(₪|ש"ח|ש״ח|שח|שקל(?:ים)?|nis|ils)$/i, 'ILS'],
  [/^(\$|usd|דולר(?:ים)?)$/i, 'USD'],
  [/^(€|eur|euro|יורו)$/i, 'EUR'],
  [/^(£|gbp|ליש"ט|פאונד)$/i, 'GBP'],
]
const CUR = `₪|ש"ח|ש״ח|שח|שקלים|שקל|NIS|ILS|\\$|USD|דולר|€|EUR|יורו|£|GBP`
const NUM = `\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?`
const MONEY_RE = new RegExp(`(?:(${CUR})\\s?(${NUM})|(${NUM})\\s?(${CUR})(?![\\p{L}]))`, 'giu')
const BARE_AMOUNT_RE = new RegExp(`(?:בסך|בסכום|סכום(?: של)?|amount(?: of)?|total)\\s*:?\\s*(${NUM})`, 'giu')

const IGNORE_RULES = [
  // One-time passwords for online purchases (3-D Secure) also mention an amount – never log them.
  ['code', /(קוד|code|סיסמ|password|otp|אימות|verification)/i, (t) => /\b\d{4,8}\b/.test(t)],
  ['declined', /(סורב|נדח|לא אושר|לא בוצע|declined|denied|rejected|failed)/i],
]
const CREDIT_RE = /(זיכוי|זוכה|בוטל|ביטול|החזר|הופקד|הפקדה|העברה נכנסת|משכורת|refund|credit(?!\s*card)|reversal|deposit|received)/i
const DEBIT_RE = /(עסק(?:ה|ת)|חיוב|חויב|רכישה|תשלום|משיכ|שולם|בוצע|אושר|purchase|charge|charged|transaction|payment|spent|withdraw|paid|approved)/i
const BALANCE_WORDS = /(יתר|balance|מסגרת|limit|available|זמין|ניצול)/i
const AMOUNT_CUE = /(בסך|בסכום|סכום|amount|total|of|על)\s*:?\s*$/i

const ISSUERS = [
  ['Isracard', /(isracard|ישראכרט)/i],
  ['Amex', /(american express|amex|אמריקן אקספרס|אמקס)/i],
  ['Max', /(\bmax\b(?!\s*stock)|מקס(?!\s*סטוק))/i],
  ['Cal', /(visa cal|\bcal\b|כאל)/i],
  ['Otsar HaHayal', /(otsar|אוצר החייל|אוצר-החייל)/i],
]

function currencyOf(token) {
  const t = token.trim()
  for (const [re, code] of CURRENCY_ALIASES) if (re.test(t)) return code
  return 'ILS'
}

function toNumber(s) {
  return Number(String(s).replace(/,/g, ''))
}

/** Every money mention, scored so the transaction amount beats balances and limits. */
function amountCandidates(text) {
  const out = []
  for (const m of text.matchAll(MONEY_RE)) {
    const value = toNumber(m[2] ?? m[3])
    const currency = currencyOf(m[1] ?? m[4])
    out.push({ value, currency, index: m.index, marked: true })
  }
  for (const m of text.matchAll(BARE_AMOUNT_RE)) {
    const start = m.index + m[0].lastIndexOf(m[1])
    if (!out.some((c) => Math.abs(c.index - start) < 6)) out.push({ value: toNumber(m[1]), currency: 'ILS', index: start, marked: false })
  }
  for (const c of out) {
    const before = text.slice(Math.max(0, c.index - 22), c.index)
    c.score = (c.marked ? 1 : 0) + (AMOUNT_CUE.test(before) ? 3 : 0) - (BALANCE_WORDS.test(before) ? 6 : 0)
  }
  return out.filter((c) => c.value > 0).sort((a, b) => b.score - a.score || a.index - b.index)
}

function findLast4(text) {
  const m = /(?:המסתיים|המסתיימת|מסתיים|שמספרו|ending(?:\s+in)?|card(?:\s+no\.?)?|כרטיס(?:ך|כם)?(?:\s+מספר)?|\*{2,})\D{0,8}(\d{4})(?!\d)/i.exec(text)
  return m ? m[1] : null
}

function findDate(text, today) {
  // dd/mm[/yy] or dd.mm.yy – a lone "10.11" is an amount, not a date.
  const m = /(?<![\d.,])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d.])|(?<![\d.,])(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?!\d)/.exec(text)
  if (!m) return today
  const day = Number(m[1] ?? m[4])
  const month = Number(m[2] ?? m[5])
  const yearPart = m[3] ?? m[6]
  if (day < 1 || day > 31 || month < 1 || month > 12) return today
  let year = yearPart ? Number(yearPart) : Number(today.slice(0, 4))
  if (year < 100) year += 2000
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  // "11/11" with no year in early January means last year.
  if (!yearPart && iso > today) return `${year - 1}${iso.slice(4)}`
  return iso
}

const MERCHANT_STOP = String.raw`(?=\s+(?:בסך|בסכום|בתאריך|תאריך|בשעה|ב-?\d|על\s+סך|on\b|for\b|at\s+\d|amount|approved|אושר)|\s*[,;:\n(]|\.(?=\s|$)|\s+-\s|$)`
const MERCHANT_PATTERNS = [
  new RegExp(String.raw`(?:בבית\s+ה?עסק|בית\s+ה?עסק|שם\s+בית\s+העסק|אצל|merchant|at)\s*:?\s+(.+?)${MERCHANT_STOP}`, 'iu'),
  new RegExp(String.raw`(?:עסקה|רכישה|חיוב|תשלום|purchase|payment)\s+(?:ב|ב-|in\s+)(?!סך|כרטיס|חשבו[ןנ]|ארנק|\d)(.+?)${MERCHANT_STOP}`, 'iu'),
  new RegExp(String.raw`(?:^|\s)ב-(?!\d|סך|כרטיס|חשבו[ןנ])([^\s,.].*?)${MERCHANT_STOP}`, 'iu'),
  // Bank style: "... בסך 4,800.00 ש"ח - שכר דירה"
  new RegExp(String.raw`\s-\s(?!\d)(.+?)${MERCHANT_STOP}`, 'iu'),
]

function cleanMerchant(raw) {
  if (!raw) return null
  let s = raw.replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim()
  s = s.replace(new RegExp(`\\s*(${CUR})?\\s*(${NUM})\\s*(${CUR})?$`, 'iu'), '').trim()
  if (!s || /^\d+$/.test(s) || s.length < 2) return null
  return s.slice(0, 60)
}

function findMerchant(text) {
  for (const re of MERCHANT_PATTERNS) {
    const m = re.exec(text)
    const merchant = m && cleanMerchant(m[1])
    if (merchant && !/^(כרטיס|card|סך|הסך)/i.test(merchant)) return merchant
  }
  return null
}

function findIssuer(text, sender) {
  for (const [name, re] of ISSUERS) if (re.test(sender || '') || re.test(text)) return name
  return null
}

/**
 * @returns {{type: 'debit'|'credit'|'ignore', reason?: string, amount?: number, currency?: string,
 *   amountILS?: number, merchant?: string|null, last4?: string|null, date?: string, issuer?: string|null}}
 */
export function parseSms(text, { sender = '', today = todayISO() } = {}) {
  const raw = String(text || '').replace(/[‎‏‪-‮]/g, '').trim()
  if (!raw) return { type: 'ignore', reason: 'empty' }
  for (const [reason, re, extra] of IGNORE_RULES) {
    if (re.test(raw) && (!extra || extra(raw))) return { type: 'ignore', reason }
  }
  const [best] = amountCandidates(raw)
  if (!best || best.score < 0) return { type: 'ignore', reason: 'no_amount' }

  const credit = CREDIT_RE.test(raw)
  if (!credit && !DEBIT_RE.test(raw)) return { type: 'ignore', reason: 'not_a_payment' }

  const amountILS = Math.round(best.value * (FX_TO_ILS[best.currency] ?? 1) * 100) / 100
  return {
    type: credit ? 'credit' : 'debit',
    amount: best.value,
    currency: best.currency,
    amountILS,
    merchant: findMerchant(raw),
    last4: findLast4(raw),
    date: findDate(raw, today),
    issuer: findIssuer(raw, sender),
  }
}

/**
 * Split a pasted block into messages: blank lines separate messages; without blank
 * lines, it is one message per line only when every line has its own amount.
 */
export function splitMessages(block) {
  const text = String(block || '').replace(/\r/g, '').trim()
  if (!text) return []
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
  if (paragraphs.length > 1) return paragraphs
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.length > 1 && lines.every((l) => amountCandidates(l).length) ? lines : [text]
}
