/**
 * On-device port of backend/services/nlp_parser.py – bilingual (English / Hebrew)
 * parser for bot messages such as "I spent 50 on coffee" or "הוצאתי 50 שקל על קפה".
 */
import { containsHebrew, normalize } from './categorizer'
import { addDays } from './dates'

const EN_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000,
}
const HE_NUMBERS_RAW = {
  אחד: 1, אחת: 1, שניים: 2, שתיים: 2, שני: 2, שתי: 2, שלוש: 3, שלושה: 3, שלושת: 3,
  ארבע: 4, ארבעה: 4, ארבעת: 4, חמש: 5, חמישה: 5, חמשת: 5, שש: 6, שישה: 6, ששת: 6,
  שבע: 7, שבעה: 7, שבעת: 7, שמונה: 8, שמונת: 8, תשע: 9, תשעה: 9, תשעת: 9, עשר: 10,
  עשרה: 10, עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50, שישים: 60, שבעים: 70,
  שמונים: 80, תשעים: 90, מאה: 100, מאות: 100, מאתיים: 200, אלף: 1000, אלפים: 1000, אלפיים: 2000,
}
const HE_NUMBERS = Object.fromEntries(Object.entries(HE_NUMBERS_RAW).map(([k, v]) => [normalize(k), v]))
const MULTIPLIER_100 = new Set(['hundred', normalize('מאות')])
const MULTIPLIER_1000 = new Set(['thousand', normalize('אלף'), normalize('אלפים')])
const CONNECTORS = new Set(['and', 'ו'])

const AMOUNT_RE =
  /(?<pre>[₪$€])?\s?(?<![\d.,])(?<int>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<dec>\d{1,2}))?(?!\d)\s?(?<suffix>[kK](?![\p{L}\p{N}_])|אלף)?/gu

const CURRENCY_WORDS = ['₪', '$', '€', 'nis', 'ils', 'shekel', 'shekels', 'sheqel', 'שקל', 'שקלים', 'שח', 'ש״ח', 'ש"ח']
const FILLER_WORDS = [
  'i', 'ive', "i've", 'im', 'just', 'spent', 'spend', 'spending', 'paid', 'pay', 'bought', 'buy', 'purchased',
  'on', 'for', 'at', 'in', 'a', 'an', 'the', 'some', 'today', 'yesterday', 'me', 'my', 'worth', 'of', 'got',
  'and', 'expense', 'cost', 'costs', 'was', 'it', 'to', 'log', 'add', 'cash', 'with',
  'הוצאתי', 'הוצאנו', 'שילמתי', 'שילמנו', 'קניתי', 'קנינו', 'על', 'היום', 'אתמול', 'עלה', 'עלתה', 'עלו',
  'לי', 'של', 'הוצאה', 'את', 'קצת', 'ש', 'ב', 'ל', 'במזומן', 'מזומן', 'סך', 'הכל', 'בערך', 'תרשום', 'תוסיף',
]
const FILLER = new Set([...FILLER_WORDS, ...CURRENCY_WORDS].map(normalize).filter(Boolean))

const INTENT_PHRASES = {
  help: ['help', 'menu', 'commands', 'start', 'hi', 'hello', 'hey', '?', 'עזרה', 'תפריט', 'פקודות', 'שלום', 'היי', 'הי', 'מה אפשר'],
  undo: ['undo', 'delete last', 'remove last', 'cancel last', 'cancel', 'oops', 'ביטול', 'בטל', 'מחק', 'תמחק', 'טעות'],
  balance: [
    'balance', 'free to spend', 'how much can i spend', 'how much left', 'how much is left', 'left to spend',
    'remaining', 'bottom line', 'status', 'כמה נשאר', 'נשאר', 'יתרה', 'מצב', 'שורה תחתונה', 'כמה אפשר', 'כמה מותר',
    'פנוי להוצאה', 'כמה אני יכול', 'כמה אני יכולה',
  ],
  summary: ['summary', 'weekly', 'report', 'this week', 'סיכום', 'דוח', 'דו"ח', 'שבועי', 'השבוע'],
  budget: ['budget', 'budgets', 'תקציב', 'תקציבים'],
  goals: ['goal', 'goals', 'savings', 'saving', 'יעד', 'יעדים', 'חיסכון', 'חסכון'],
}
const INCOME_PHRASES = [
  'received', 'got paid', 'earned', 'income', 'salary', 'bonus', 'refund', 'קיבלתי', 'הרווחתי',
  'הכנסה', 'נכנס', 'נכנסו', 'משכורת', 'בונוס', 'החזר', 'זיכוי',
]
const YESTERDAY = new Set(['yesterday', normalize('אתמול')])

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function phraseRegex(phrase) {
  const norm = normalize(phrase) || phrase
  if (containsHebrew(norm)) return new RegExp(`(?:^|\\s)[בהוכלמש]?${escapeRe(norm)}(?=\\s|$|\\?)`, 'u')
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(norm)}(?![\\p{L}\\p{N}_])`, 'u')
}

const INTENT_RES = Object.fromEntries(Object.entries(INTENT_PHRASES).map(([k, ps]) => [k, ps.map(phraseRegex)]))
const INCOME_RES = INCOME_PHRASES.map(phraseRegex)
const matchesAny = (norm, res) => res.some((re) => re.test(norm))

export function detectLanguage(text, fallback = 'en') {
  if (containsHebrew(text)) return 'he'
  return /[A-Za-z]/.test(text) ? 'en' : fallback
}

function parseDigits(text) {
  let best = null
  for (const m of text.matchAll(AMOUNT_RE)) {
    const { pre, int, dec, suffix } = m.groups
    let value = Number(int.replace(/,/g, ''))
    if (dec) value += Number(`0.${dec}`)
    if (suffix) value *= 1000
    const marked = !!(pre || suffix)
    // Prefer amounts with a currency marker, otherwise the largest number.
    if (!best || (marked && !best.marked) || (marked === best.marked && value > best.value)) {
      best = { value, marked, start: m.index, end: m.index + m[0].length }
    }
  }
  return best
}

function numberWordValue(token) {
  if (token in EN_NUMBERS) return EN_NUMBERS[token]
  if (token in HE_NUMBERS) return HE_NUMBERS[token]
  // Hebrew attached prefix: "וחמישים", "בעשרים", "במאה".
  if (token.length > 2 && 'ובל'.includes(token[0]) && token.slice(1) in HE_NUMBERS) return HE_NUMBERS[token.slice(1)]
  return null
}

/** Longest run of number words, evaluated ("שלוש מאות וחמישים" → 350). */
function parseNumberWords(tokens) {
  let bestValue = null
  let bestIdx = new Set()
  let i = 0
  while (i < tokens.length) {
    if (numberWordValue(tokens[i]) === null) {
      i += 1
      continue
    }
    let total = 0
    let current = 0
    const used = new Set()
    let j = i
    while (j < tokens.length) {
      const tok = tokens[j]
      const value = numberWordValue(tok)
      if (value === null) {
        if (CONNECTORS.has(tok) && j + 1 < tokens.length && numberWordValue(tokens[j + 1]) !== null) {
          used.add(j)
          j += 1
          continue
        }
        break
      }
      const bare = tok in EN_NUMBERS || tok in HE_NUMBERS ? tok : tok.slice(1)
      if (MULTIPLIER_100.has(bare)) current = Math.max(current, 1) * 100
      else if (MULTIPLIER_1000.has(bare)) {
        total += Math.max(current, 1) * 1000
        current = 0
      } else if (value >= 1000) total += value // standalone thousands such as "אלפיים"
      else current += value
      used.add(j)
      j += 1
    }
    if (bestValue === null || used.size > bestIdx.size) {
      bestValue = total + current
      bestIdx = used
    }
    i = j
  }
  return { value: bestValue, used: bestIdx }
}

function extractMerchant(text) {
  const m = /\bat\s+([A-Za-z0-9&'\-. ]+?)(?:\s+(?:for|on|yesterday|today)\b|[,.!?]|$)/i.exec(text)
  return m ? m[1].trim() : null
}

/**
 * @returns {{intent: string, language: string, raw: string, amount: number|null,
 *            description: string|null, merchant: string|null, txDate: string|null}}
 */
export function parseMessage(text, defaultLanguage = 'en', today) {
  const raw = (text || '').trim()
  const parsed = { intent: 'unknown', language: detectLanguage(raw, defaultLanguage), raw, amount: null, description: null, merchant: null, txDate: null }
  if (!raw) return { ...parsed, intent: 'help' }

  const digits = parseDigits(raw)
  let amount = digits ? digits.value : null
  const remainder = digits ? `${raw.slice(0, digits.start)} ${raw.slice(digits.end)}` : raw
  const tokens = normalize(remainder).split(' ').filter(Boolean)
  let usedIdx = new Set()
  if (amount === null) {
    const words = parseNumberWords(tokens)
    amount = words.value || null
    usedIdx = words.used
  }
  const normFull = raw === '?' ? '?' : normalize(raw) || raw.toLowerCase()

  if (amount === null) {
    for (const intent of ['undo', 'balance', 'summary', 'budget', 'goals', 'help']) {
      if (matchesAny(normFull, INTENT_RES[intent])) return { ...parsed, intent }
    }
    return parsed
  }

  if (matchesAny(normFull, INTENT_RES.budget)) parsed.intent = 'set_budget'
  else if (matchesAny(normFull, INCOME_RES)) parsed.intent = 'income'
  else parsed.intent = 'expense'

  parsed.amount = Math.round(amount * 100) / 100
  parsed.txDate = tokens.some((tok) => YESTERDAY.has(tok)) ? addDays(today, -1) : today

  const budgetWords = new Set(INTENT_PHRASES.budget.map(normalize))
  const incomeWords = new Set([...INCOME_PHRASES.filter((w) => !w.includes(' ')).map(normalize), 'paid'])
  const keep = tokens.filter((tok, idx) => {
    if (usedIdx.has(idx) || FILLER.has(tok) || YESTERDAY.has(tok)) return false
    if (parsed.intent === 'set_budget' && budgetWords.has(tok)) return false
    if (parsed.intent === 'income' && incomeWords.has(tok)) return false
    // Hebrew one-letter prefix glued to a filler word, e.g. "בשקלים".
    if (containsHebrew(tok) && tok.length > 2 && 'בלו'.includes(tok[0]) && FILLER.has(tok.slice(1))) return false
    return true
  })
  parsed.description = keep.join(' ').trim() || null
  parsed.merchant = extractMerchant(remainder) || parsed.description
  return parsed
}
