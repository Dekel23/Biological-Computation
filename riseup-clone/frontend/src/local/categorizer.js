/**
 * On-device port of backend/services/categorizer.py.
 *
 * Resolution order (first hit wins):
 *   1. user_rule  – learned pattern equals / is contained in the merchant (1.0 / 0.95)
 *   2. keyword    – bilingual keyword dictionary, longest keyword wins (0.85)
 *   3. mcc        – merchant category code (0.7)
 *   4. fuzzy_rule – similarity to a learned pattern >= 0.82 (ratio * 0.9)
 *   5. default    – other / other_income (0)
 */

const HEBREW_RE = /[֐-׿]/
const NIQQUD_RE = /[֑-ׇ]/g
const FINAL_LETTERS = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }
const HEBREW_PREFIXES = 'בהוכלמש'
const WORD = '\\p{L}\\p{N}_'

export const KEYWORDS = {
  salary: ['salary', 'payroll', 'wage', 'wages', 'paycheck', 'משכורת', 'שכר עבודה', 'תלוש'],
  other_income: [
    'refund', 'transfer from', 'bit from', 'paybox from', 'dividend', 'interest', 'החזר', 'זיכוי',
    'העברה מ', 'ביטוח לאומי', 'קצבה', 'מענק', 'בונוס', 'bonus', 'gift received', 'got paid', 'received',
  ],
  rent: ['rent', 'landlord', 'שכר דירה', 'שכירות', 'דמי שכירות'],
  utilities: [
    'electric', 'electricity', 'israel electric', 'iec', 'חברת החשמל', 'חשמל', 'water', 'מי אביבים',
    'תאגיד מים', 'מים', 'arnona', 'ארנונה', 'municipality', 'עירייה', 'עיריית', 'bezeq', 'בזק',
    'partner', 'פרטנר', 'cellcom', 'סלקום', 'pelephone', 'פלאפון', 'hot mobile', 'golan telecom',
    'גולן טלקום', '012', '019', 'supergas', 'סופרגז', 'amisragas', 'אמישראגז', 'pazgas', 'פזגז', 'internet',
    'ועד בית', 'phone bill',
  ],
  insurance: [
    'insurance', 'ביטוח', 'harel', 'הראל', 'migdal', 'מגדל', 'clal', 'כלל ביטוח', 'phoenix', 'הפניקס',
    'menora', 'מנורה', 'ayalon', 'איילון', 'direct insurance', 'ביטוח ישיר', 'aig', '9 million', 'ליברה', 'libra',
  ],
  loans: ['loan', 'mortgage', 'הלוואה', 'משכנתא', 'החזר הלוואה', 'credit line'],
  subscriptions: [
    'netflix', 'נטפליקס', 'spotify', 'ספוטיפיי', 'apple.com/bill', 'apple com bill', 'icloud', 'itunes',
    'google one', 'google storage', 'youtube premium', 'disney', 'disney+', 'amazon prime', 'chatgpt', 'openai',
    'dropbox', 'adobe', 'microsoft 365', 'office 365', 'yes tv', 'hot tv', 'סלקום tv', 'partner tv',
    'next tv', 'gym', 'holmes place', 'הולמס פלייס', 'מנוי', 'subscription', 'patreon',
  ],
  groceries: [
    'groceries', 'grocery', 'supermarket', 'supermarkt', 'shufersal', 'שופרסל', 'rami levy', 'רמי לוי',
    'victory', 'ויקטורי', 'yochananof', 'יוחננוף', 'osher ad', 'אושר עד', 'tiv taam', 'טיב טעם',
    'mega', 'מגה', 'am pm', 'ampm', 'איי אם פי אם', 'carrefour', 'קרפור', 'yenot bitan', 'יינות ביתן',
    'hatzi hinam', 'חצי חינם', 'machsanei hashuk', 'מחסני השוק', 'super yuda', 'סופר יודה', 'מכולת',
    'סופרמרקט', 'סופר', 'ירקות', 'פירות', 'שוק', 'market', 'vegetables', 'bakery', 'מאפייה',
  ],
  restaurants: [
    'restaurant', 'מסעדה', 'wolt', 'וולט', '10bis', 'תן ביס', 'cibus', 'סיבוס', 'mcdonald', 'mcdonalds',
    'מקדונלדס', 'burger', 'בורגר', 'pizza', 'פיצה', 'domino', 'דומינו', 'kfc', 'sushi', 'סושי', 'shawarma',
    'שווארמה', 'falafel', 'פלאפל', 'humus', 'hummus', 'חומוס', 'lunch', 'dinner', 'breakfast', 'ארוחה',
    'ארוחת צהריים', 'ארוחת ערב', 'ארוחת בוקר', 'japanika', "ג'פניקה", 'food', 'אוכל', 'takeaway',
  ],
  coffee: [
    'coffee', 'קפה', 'cafe', 'café', 'קפה קפה', 'aroma', 'ארומה', 'cofix', 'קופיקס', 'starbucks',
    'landwer', 'לנדוור', 'greg', 'גרג', 'cafe joe', "קפה ג'ו", 'arcaffe', 'ארקפה', 'espresso', 'אספרסו',
    'latte', 'לאטה', 'cappuccino', "קפוצ'ינו", 'נס קפה', 'הפוך',
  ],
  transport: [
    'rav kav', 'rav-kav', 'רב קו', 'רב-קו', 'moovit', 'מוביט', 'gett', 'גט טקסי', 'uber', 'yango', 'taxi',
    'מונית', 'monit', 'israel railways', 'רכבת ישראל', 'רכבת', 'train', 'egged', 'אגד', 'dan bus', 'דן',
    'metropoline', 'מטרופולין', 'kavim', 'קווים', 'bus', 'אוטובוס', 'pango', 'פנגו', 'cellopark',
    'סלופארק', 'parking', 'חניה', 'חנייה', 'ahuzat hof', 'אחוזת חוף', 'kvish 6', 'כביש 6', 'toll',
    'scooter', 'bird', 'lime',
  ],
  fuel: [
    'fuel', 'gas station', 'petrol', 'דלק', 'paz', 'פז', 'delek', 'sonol', 'סונול', 'ten', 'טן', 'dor alon',
    'דור אלון', 'yellow', 'יילו', 'תדלוק', 'בנזין', 'סולר',
  ],
  health: [
    'pharmacy', 'בית מרקחת', 'super-pharm', 'super pharm', 'סופר-פארם', 'סופר פארם', 'be pharm', 'גוד פארם',
    'good pharm', 'clalit', 'כללית', 'maccabi', 'מכבי', 'meuhedet', 'מאוחדת', 'leumit', 'לאומית',
    'doctor', 'רופא', 'dentist', 'רופא שיניים', 'שיניים', 'clinic', 'מרפאה', 'hospital', 'בית חולים',
    'optic', 'אופטיקה', 'medicine', 'תרופות', 'תרופה',
  ],
  shopping: [
    'shopping', 'קניות', 'zara', 'זארה', 'h&m', 'castro', 'קסטרו', 'fox', 'פוקס', 'renuar', 'רנואר',
    'terminal x', 'טרמינל איקס', 'amazon', 'אמזון', 'aliexpress', 'עלי אקספרס', 'ikea', 'איקאה',
    'ace', 'אייס', 'home center', 'הום סנטר', 'ksp', 'bug', 'באג', 'ivory', 'איבורי', 'shein', 'שיין',
    'clothes', 'בגדים', 'shoes', 'נעליים', 'electronics', 'max stock', 'מקס סטוק', 'גולף', 'golf',
  ],
  entertainment: [
    'cinema', 'movie', 'movies', 'סרט', 'קולנוע', 'cinema city', 'סינמה סיטי', 'yes planet', 'יס פלאנט',
    'lev cinema', 'eventim', 'leaan', 'לאן', 'tickets', 'כרטיסים', 'הופעה', 'concert', 'theater', 'תיאטרון',
    'steam', 'playstation', 'xbox', 'nintendo', 'bar', 'בר', 'pub', 'פאב', 'club', 'מועדון', 'escape room',
    'חדר בריחה', 'bowling', 'באולינג',
  ],
  education: [
    'university', 'אוניברסיטה', 'college', 'מכללה', 'udemy', 'coursera', 'course', 'קורס', 'tuition',
    'שכר לימוד', 'books', 'ספרים', 'steimatzky', 'סטימצקי', 'tzomet sfarim', 'צומת ספרים', 'school', 'בית ספר',
    'lesson', 'שיעור', 'חוג',
  ],
  kids: [
    'daycare', 'גן ילדים', 'גן', 'מעון', 'צהרון', 'babysitter', 'בייביסיטר', 'toys', 'צעצועים',
    'toys r us', 'טויס אר אס', 'shilav', 'שילב', 'diapers', 'חיתולים', 'kids', 'ילדים',
  ],
  cash: ['atm', 'cash withdrawal', 'כספומט', 'משיכת מזומן', 'משיכה מכספומט', 'מזומן'],
  transfers: ['bit', 'ביט', 'paybox', 'פייבוקס', 'pepper pay', 'transfer to', 'העברה ל'],
  card_bill: [
    'ישראכרט', 'isracard', 'מקס איט', 'max it', 'לאומי קארד', 'leumi card', 'כאל', 'visa cal', 'אמריקן אקספרס',
    'american express', 'דיינרס', 'diners', 'חיוב כרטיס', 'כרטיסי אשראי', 'כרטיס אשראי',
  ],
}

export const MCC_MAP = {
  5411: 'groceries', 5422: 'groceries', 5441: 'groceries', 5451: 'groceries', 5499: 'groceries',
  5462: 'coffee',
  5812: 'restaurants', 5813: 'entertainment', 5814: 'restaurants',
  5541: 'fuel', 5542: 'fuel', 5983: 'fuel',
  4111: 'transport', 4112: 'transport', 4121: 'transport', 4131: 'transport', 4784: 'transport', 7523: 'transport',
  4900: 'utilities', 4814: 'utilities', 4816: 'utilities', 9311: 'utilities',
  4899: 'subscriptions', 5815: 'subscriptions', 5817: 'subscriptions', 5818: 'subscriptions', 7997: 'subscriptions',
  6300: 'insurance', 6381: 'insurance',
  5912: 'health', 8011: 'health', 8021: 'health', 8062: 'health', 8099: 'health', 8043: 'health',
  5311: 'shopping', 5651: 'shopping', 5661: 'shopping', 5691: 'shopping', 5699: 'shopping',
  5732: 'shopping', 5942: 'education', 5945: 'kids', 5200: 'shopping', 5712: 'shopping', 5999: 'shopping',
  7832: 'entertainment', 7922: 'entertainment', 7991: 'entertainment', 7994: 'entertainment', 7996: 'entertainment',
  8211: 'education', 8220: 'education', 8299: 'education', 8351: 'kids',
  6011: 'cash', 6010: 'cash',
  6513: 'rent',
  4829: 'transfers',
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function containsHebrew(text) {
  return !!text && HEBREW_RE.test(text)
}

/** Canonical lowercase form used for all matching (both scripts). */
export function normalize(text) {
  if (!text) return ''
  let s = String(text).normalize('NFKC').replace(NIQQUD_RE, '').toLowerCase()
  s = s.replace(/[ךםןףץ]/g, (ch) => FINAL_LETTERS[ch])
  // Unify the apostrophe/quote variants used for geresh & gershayim.
  s = s.replace(/["'`׳״’‘“”]/g, '')
  s = s.replace(new RegExp(`[^${WORD}&+/.\\u0590-\\u05FF]+`, 'gu'), ' ')
  // Drop stray dots at token edges ("netflix.com" keeps its inner dot).
  return s
    .split(/\s+/)
    .map((tok) => tok.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .join(' ')
}

const NOISE_TOKENS = new Set(
  ['ltd', 'inc', 'llc', 'co', 'com', 'il', 'www', 'the', 'branch', 'store', 'סניף', 'בעמ', 'בע', 'מ'].map(normalize),
)

/** Normalised merchant identity: drops noise words and branch/terminal numbers. */
export function merchantKey(merchant) {
  const tokens = normalize(merchant).split(' ').filter((t) => t && !NOISE_TOKENS.has(t))
  const meaningful = tokens.filter((t) => !/^\d+$/.test(t))
  return (meaningful.length ? meaningful : tokens).join(' ')
}

function keywordRegex(kw) {
  const e = escapeRe(kw)
  if (containsHebrew(kw)) return new RegExp(`(?:^|\\s)[${HEBREW_PREFIXES}]?${e}(?=\\s|$)`, 'u')
  return new RegExp(`(?<![${WORD}])${e}(?![${WORD}])`, 'u')
}

const KEYWORD_INDEX = Object.entries(KEYWORDS)
  .flatMap(([key, words]) =>
    words.map((w) => normalize(w)).filter(Boolean).map((norm) => ({ re: keywordRegex(norm), len: norm.length, key })),
  )
  .sort((a, b) => b.len - a.len)

/** Category key of the most specific keyword in `text`; `accept` filters candidates. */
export function matchKeyword(text, accept) {
  const norm = normalize(text)
  if (!norm) return null
  for (const { re, key } of KEYWORD_INDEX) {
    if ((!accept || accept(key)) && re.test(norm)) return key
  }
  return null
}

/** difflib.SequenceMatcher(None, a, b).ratio() – Ratcliff/Obershelp similarity. */
export function similarity(a, b) {
  if (!a.length && !b.length) return 1
  const matches = (aLo, aHi, bLo, bHi) => {
    let best = 0
    let bestI = aLo
    let bestJ = bLo
    let prev = new Array(bHi - bLo + 1).fill(0)
    for (let i = aLo; i < aHi; i++) {
      const cur = new Array(bHi - bLo + 1).fill(0)
      for (let j = bLo; j < bHi; j++) {
        if (a[i] === b[j]) {
          const len = prev[j - bLo] + 1
          cur[j - bLo + 1] = len
          if (len > best) {
            best = len
            bestI = i - len + 1
            bestJ = j - len + 1
          }
        }
      }
      prev = cur
    }
    if (!best) return 0
    return best + matches(aLo, bestI, bLo, bestJ) + matches(bestI + best, aHi, bestJ + best, bHi)
  }
  return (2 * matches(0, a.length, 0, b.length)) / (a.length + b.length)
}

export class Categorizer {
  static FUZZY_THRESHOLD = 0.82

  constructor(state) {
    this.state = state
    this.byKey = Object.fromEntries(state.categories.map((c) => [c.key, c]))
    this.byId = Object.fromEntries(state.categories.map((c) => [c.id, c]))
    this._rules = null
  }

  get rules() {
    if (!this._rules) {
      this._rules = [...this.state.rules]
        .sort((x, y) => y.hits - x.hits)
        .map((r) => ({ pattern: r.pattern, key: this.byId[r.category_id].key }))
    }
    return this._rules
  }

  categoryId(key) {
    return this.byKey[key].id
  }

  fitsDirection(key, amount) {
    const cat = this.byKey[key]
    if (!cat) return false
    if (amount === null || amount === undefined) return true
    return cat.is_income === amount > 0
  }

  categorize(merchant, amount = null, mcc = null, description = null) {
    const key = merchantKey(merchant)
    const fits = (k) => this.fitsDirection(k, amount)

    if (key) {
      for (const r of this.rules) if (r.pattern === key && fits(r.key)) return { key: r.key, confidence: 1, source: 'user_rule' }
      for (const r of this.rules) {
        if (r.pattern.length < 3 || !fits(r.key)) continue
        const inKey = new RegExp(`(?<![${WORD}])${escapeRe(r.pattern)}(?![${WORD}])`, 'u').test(key)
        const inPattern = new RegExp(`(?<![${WORD}])${escapeRe(key)}(?![${WORD}])`, 'u').test(r.pattern)
        if (inKey || inPattern) return { key: r.key, confidence: 0.95, source: 'user_rule' }
      }
    }

    for (const text of [merchant, description]) {
      const k = matchKeyword(text, fits)
      if (k) return { key: k, confidence: 0.85, source: 'keyword' }
    }

    const mccKey = mcc ? MCC_MAP[Number(mcc)] : null
    if (mccKey && fits(mccKey)) return { key: mccKey, confidence: 0.7, source: 'mcc' }

    if (key) {
      let bestRatio = 0
      let bestKey = null
      for (const r of this.rules) {
        const ratio = similarity(key, r.pattern)
        if (ratio > bestRatio && fits(r.key)) {
          bestRatio = ratio
          bestKey = r.key
        }
      }
      if (bestKey && bestRatio >= Categorizer.FUZZY_THRESHOLD) {
        return { key: bestKey, confidence: Math.round(bestRatio * 0.9 * 1000) / 1000, source: 'fuzzy_rule' }
      }
    }
    return { key: amount !== null && amount > 0 ? 'other_income' : 'other', confidence: 0, source: 'default' }
  }

  /** Categorise a transaction object in place (never overrides a manual choice). */
  apply(tx) {
    if (tx.category_source === 'user' && tx.category_id) return
    const res = this.categorize(tx.merchant, tx.amount, tx.mcc, tx.description)
    tx.category_id = this.categoryId(res.key)
    tx.category_source = res.source
    tx.category_confidence = res.confidence
  }

  /** Remember the user's choice for `merchant`; returns how many other transactions changed. */
  learn(merchant, categoryKey, nextId, applyToExisting = true) {
    const pattern = merchantKey(merchant)
    if (!pattern) return 0
    const category = this.byKey[categoryKey]
    const rule = this.state.rules.find((r) => r.pattern === pattern)
    if (rule) {
      rule.hits = rule.category_id === category.id ? rule.hits + 1 : 1
      rule.category_id = category.id
    } else {
      this.state.rules.push({ id: nextId('rule'), pattern, category_id: category.id, hits: 1 })
    }
    this._rules = null

    let updated = 0
    if (applyToExisting) {
      for (const tx of this.state.transactions) {
        if (tx.category_source === 'user' || tx.category_id === category.id) continue
        if (merchantKey(tx.merchant) === pattern && this.fitsDirection(categoryKey, tx.amount)) {
          tx.category_id = category.id
          tx.category_source = 'user_rule'
          tx.category_confidence = 1
          updated += 1
        }
      }
    }
    return updated
  }
}
