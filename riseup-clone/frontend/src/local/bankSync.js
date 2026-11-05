/**
 * Mock read-only Open Banking provider (port of backend/services/bank_sync.py).
 * Output is deterministic per (account, day), so re-syncs are de-duplicated by external_id.
 */
import { Categorizer } from './categorizer'
import { addDays, todayISO } from './dates'

// (merchant, mcc, min, max, weight) – Hebrew & English descriptors as on Israeli statements.
const CARD_MERCHANTS = [
  ['שופרסל דיל', '5411', 70, 340, 7],
  ['RAMI LEVY SHIVUK HASHIKMA', '5411', 110, 420, 4],
  ['ויקטורי סניף 14', '5411', 60, 300, 4],
  ['AM PM DIZENGOFF', '5499', 15, 90, 5],
  ['ארומה תל אביב', '5814', 14, 48, 8],
  ['COFIX 223', '5814', 6, 22, 6],
  ['LANDWER CAFE', '5812', 45, 140, 3],
  ['WOLT', '5812', 55, 160, 6],
  ['תן ביס', '5814', 35, 80, 4],
  ['MOSES RESTAURANT', '5812', 120, 340, 2],
  ["ג'ירף נורדאו", '5812', 90, 260, 2],
  ['GOLDA ICE CREAM', '5814', 18, 45, 2],
  ['RAV KAV ONLINE', '4111', 30, 100, 4],
  ['GETT TAXI', '4121', 25, 85, 3],
  ['פנגו חניה', '7523', 8, 30, 3],
  ['פז YELLOW', '5541', 180, 330, 3],
  ['SONOL', '5542', 150, 300, 2],
  ['סופר-פארם', '5912', 25, 210, 4],
  ['MACCABI HEALTHCARE', '8011', 20, 120, 1],
  ['ZARA AZRIELI', '5651', 120, 480, 2],
  ['ALIEXPRESS', '5999', 25, 160, 3],
  ['AMAZON MKTPLACE', '5999', 60, 320, 2],
  ['ACE חומרי בניין', '5200', 40, 260, 1],
  ['סינמה סיטי גלילות', '7832', 45, 140, 2],
  ['STEAM PURCHASE', '5818', 30, 120, 1],
  ['צומת ספרים', '5942', 50, 130, 1],
  ['חנות הפרחים של רינה', '5992', 60, 180, 1],
  ['MINI MARKET HAYARKON', null, 12, 70, 2],
]
const CARD_SUBSCRIPTIONS = [
  [3, 'NETFLIX.COM', '4899', 54.9],
  [7, 'SPOTIFY P1A2B3', '5815', 23.9],
  [12, 'APPLE.COM/BILL', '5818', 11.9],
  [1, 'HOLMES PLACE', '7997', 199.0],
]
const ACCOUNT_RECURRING = [
  [1, 'שכר דירה - העברה', '6513', -4800, 0],
  [5, 'הראל ביטוח', '6300', -265, 0],
  [5, 'AYALON CAR INSURANCE', '6300', -158, 0],
  [10, 'משכורת - חברת הייטק בעמ', null, 13950, 150],
  [15, 'חברת החשמל', '4900', -390, 90],
  [16, 'PARTNER COMMUNICATIONS', '4814', -99, 0],
  [20, 'מי אביבים', '4900', -145, 35],
]

/** Small seeded PRNG (cyrb53 hash → mulberry32) with the bits of `random` we need. */
function seededRandom(seed) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  let a = (Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)) >>> 0
  const random = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const weighted = (items, weights) => {
    let r = random() * weights.reduce((s, w) => s + w, 0)
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]
      if (r < 0) return items[i]
    }
    return items[items.length - 1]
  }
  return {
    random,
    uniform: (lo, hi) => lo + (hi - lo) * random(),
    choice: (items) => items[Math.floor(random() * items.length)],
    weighted,
  }
}

export class MockOpenBankingProvider {
  constructor(account) {
    this.account = account
    const name = account.bank_name.toLowerCase()
    this.isCard = name.includes('card') || name.includes('isracard')
  }

  day(iso, today) {
    const rng = seededRandom(`${this.account.id}:${this.account.account_mask}:${iso}`)
    const dom = Number(iso.slice(8))
    const txs = []
    const add = (merchant, mcc, amount) =>
      txs.push({
        external_id: `mock-${this.account.id}-${iso}-${txs.length}`,
        date: iso, amount: Math.round(amount * 100) / 100, merchant, mcc, description: null,
      })

    if (this.isCard) {
      for (const [d, merchant, mcc, base] of CARD_SUBSCRIPTIONS) {
        if (dom !== d) continue
        // Demo a price increase for the Subscription Radar on the most recent cycles.
        const amount = merchant.startsWith('NETFLIX') && iso >= addDays(today, -45) ? 64.9 : base
        add(merchant, mcc, -amount)
      }
      const weekday = new Date(`${iso}T12:00:00`).getDay()
      const weekend = weekday === 5 || weekday === 6 // Fri/Sat in Israel
      const count = rng.weighted([0, 1, 2, 3], weekend ? [2, 4, 4, 2] : [3, 5, 3, 1])
      for (let i = 0; i < count; i++) {
        const [merchant, mcc, lo, hi] = rng.weighted(CARD_MERCHANTS, CARD_MERCHANTS.map((m) => m[4]))
        add(merchant, mcc, -rng.uniform(lo, hi))
      }
    } else {
      for (const [d, merchant, mcc, base, jitter] of ACCOUNT_RECURRING) {
        if (dom === d) add(merchant, mcc, base + rng.uniform(-jitter, jitter))
      }
      if (rng.random() < 0.04) add('משיכת מזומן כספומט', '6011', -rng.choice([100, 200, 300]))
      if (rng.random() < 0.07) {
        const friend = rng.choice(['Noa', 'יוסי', 'Amit', 'מיכל'])
        if (rng.random() < 0.5) add(`BIT transfer to ${friend}`, '4829', -rng.uniform(30, 250))
        else add(`bit from ${friend}`, null, rng.uniform(30, 200))
      }
    }
    return txs
  }

  fetchTransactions(since, until, today = todayISO()) {
    const out = []
    for (let d = since; d <= until; d = addDays(d, 1)) out.push(...this.day(d, today))
    return out
  }
}

/** Pull new transactions for one account into `state`. Returns the created transactions. */
export function syncAccount(state, account, nextId, { since = null, until = null, today = todayISO() } = {}) {
  until = until || today
  // Re-fetch the last synced day too: today's transactions may still be arriving.
  since = since || account.synced_until || addDays(today, -90)
  const known = new Set(state.transactions.filter((tx) => tx.external_id).map((tx) => tx.external_id))
  const categorizer = new Categorizer(state)
  const created = []
  for (const bt of new MockOpenBankingProvider(account).fetchTransactions(since, until, today)) {
    if (known.has(bt.external_id)) continue
    const tx = {
      id: nextId('tx'), account_id: account.id, ...bt, source: 'bank',
      category_id: null, category_source: 'default', category_confidence: 0, created_at: new Date().toISOString(),
    }
    categorizer.apply(tx)
    state.transactions.push(tx)
    created.push(tx)
  }
  account.last_synced_at = new Date().toISOString()
  account.synced_until = account.synced_until && account.synced_until > until ? account.synced_until : until
  return created
}
