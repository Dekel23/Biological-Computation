import { describe, expect, it } from 'vitest'
import { parseSms, splitMessages } from '../smsParser'

const TODAY = '2026-11-11'
const parse = (text, sender) => parseSms(text, { sender, today: TODAY })

describe('parseSms – card charges', () => {
  it('reads a Hebrew Isracard-style charge', () => {
    expect(parse('ישראכרט: בכרטיסך המסתיים ב-1234 אושרה עסקה ב-11/11 בסך 52.00 ש"ח בבית העסק ארומה תל אביב.')).toMatchObject({
      type: 'debit', amount: 52, currency: 'ILS', amountILS: 52, merchant: 'ארומה תל אביב', last4: '1234', date: '2026-11-11', issuer: 'Isracard',
    })
  })

  it('reads a Max-style charge with the merchant after ב-', () => {
    expect(parse('MAX: אושרה עסקה בכרטיס 5678 ב-WOLT בסך 89.90 ₪ בתאריך 10/11/26')).toMatchObject({
      type: 'debit', amount: 89.9, merchant: 'WOLT', last4: '5678', date: '2026-11-10', issuer: 'Max',
    })
  })

  it('reads a Google Pay (digital wallet) charge', () => {
    expect(parse('Max: עסקה בארנק דיגיטלי Google Pay בכרטיס 5678 בבית העסק SUPER-PHARM בסך 45.90 ש"ח')).toMatchObject({
      type: 'debit', amount: 45.9, merchant: 'SUPER-PHARM', last4: '5678',
    })
  })

  it('converts foreign currency and keeps dotted merchant names', () => {
    expect(parse('Isracard: Purchase of USD 12.99 at NETFLIX.COM approved on card ending 1234')).toMatchObject({
      type: 'debit', amount: 12.99, currency: 'USD', amountILS: 48.06, merchant: 'NETFLIX.COM', last4: '1234',
    })
  })

  it('uses the sender to name the issuer', () => {
    expect(parse('אושרה עסקה בסך 18 ₪ בבית העסק קופיקס', 'Isracard').issuer).toBe('Isracard')
  })

  it('does not mistake an amount like 10.11 for a date', () => {
    expect(parse('עסקה בסך 10.11 ש"ח בבית העסק AM PM')).toMatchObject({ amount: 10.11, date: TODAY })
  })
})

describe('parseSms – credits and bank messages', () => {
  it('reads a refund as a credit', () => {
    expect(parse('ישראכרט: בוצע זיכוי בכרטיסך המסתיים ב-1234 בסך 30.00 ש"ח מבית העסק ZARA.')).toMatchObject({
      type: 'credit', amount: 30, merchant: 'ZARA',
    })
  })

  it('reads a bank debit and ignores the balance amount', () => {
    expect(parse('אוצר החייל: בוצע חיוב בחשבונך בסך 4,800.00 ש"ח - שכר דירה. יתרה: 1,200.00 ש"ח')).toMatchObject({
      type: 'debit', amount: 4800, merchant: 'שכר דירה', issuer: 'Otsar HaHayal',
    })
  })

  it('reads a salary deposit as a credit', () => {
    expect(parse('אוצר החייל: הופקדו לחשבונך 13,950.00 ש"ח משכורת')).toMatchObject({ type: 'credit', amount: 13950 })
  })
})

describe('parseSms – messages that are not payments', () => {
  it.each([
    ['code', 'קוד האימות לעסקה בסך 120.00 ש"ח באתר AMAZON הוא 483920'],
    ['code', 'Your Isracard verification code for a purchase of USD 20.00 is 551203'],
    ['declined', 'Max: עסקה בסך 300 ₪ בכרטיס 5678 סורבה'],
    ['no_amount', 'אוצר החייל: יתרת חשבונך 5,230.12 ש"ח'],
    ['no_amount', 'שלום, מה נשמע?'],
    ['empty', '   '],
  ])('ignores (%s): %s', (reason, text) => {
    expect(parse(text)).toEqual({ type: 'ignore', reason })
  })
})

describe('splitMessages', () => {
  it('splits on blank lines', () => {
    expect(splitMessages('עסקה בסך 10 ₪ בבית העסק א\n\nעסקה בסך 20 ₪ בבית העסק ב')).toHaveLength(2)
  })
  it('splits one-per-line only when every line has an amount', () => {
    expect(splitMessages('עסקה בסך 10 ₪ בבית העסק א\nעסקה בסך 20 ₪ בבית העסק ב')).toHaveLength(2)
    expect(splitMessages('ישראכרט: אושרה עסקה\nבסך 52 ₪ בבית העסק ארומה')).toHaveLength(1)
  })
})
