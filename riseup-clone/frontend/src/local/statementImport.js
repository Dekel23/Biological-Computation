/**
 * Reads transaction history exported from a bank or credit-card website
 * (Excel .xlsx / .xls, the HTML ".xls" some banks produce, or CSV) and turns it
 * into rows the app can import.
 *
 * Exports differ between banks, so instead of one fixed layout this finds every
 * table in the file by its header row (Hebrew or English column names), works
 * out which column holds the date, description and amount, and reads the rows
 * under it. Card companies often put several tables in one file (domestic and
 * foreign charges), which is why more than one table per sheet is supported.
 */
import { toISO } from './dates'

const norm = (v) =>
  String(v ?? '')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/["'״׳]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// Earlier entries win when a table has several matching columns.
const HEADERS = {
  date: [/^תאריך (ה)?עסקה/, /^תאריך (ה)?רכישה/, /^תאריך ערך/, /^תאריך$/, /^transaction date/, /^date$/, /^תאריך/],
  description: [/שם בית (ה)?עסק/, /^בית (ה)?עסק/, /^תיאור/, /^פרטים/, /^הפעולה/, /^סוג (ה)?פעולה/, /^merchant/, /^description/, /^details/, /^payee/],
  // Card exports: the charged ILS amount beats the original-currency amount.
  amount: [/^סכום (ה)?חיוב/, /^חיוב בש.?ח/, /^סכום בש.?ח/, /^סכום$/, /^סכום (ה)?עסקה/, /^charge(d)? amount/, /^amount/, /^סכום/],
  debit: [/^חובה/, /^debit/, /^withdrawal/, /^משיכה/],
  credit: [/^זכות/, /^credit$/, /^deposit/, /^הפקדה/],
}
const SKIP_DESCRIPTION = /(סה.?כ|^total|יתרה|^balance)/i

function matchColumn(cells, patterns, taken) {
  for (const re of patterns) {
    const idx = cells.findIndex((c, i) => !taken.has(i) && c && re.test(c) && !/יתרה|balance/.test(c))
    if (idx !== -1) return idx
  }
  return -1
}

/** Header row → column mapping, or null if the row isn't a transactions header. */
function headerMapping(row) {
  const cells = row.map(norm)
  const taken = new Set()
  const pick = (key) => {
    const idx = matchColumn(cells, HEADERS[key], taken)
    if (idx !== -1) taken.add(idx)
    return idx
  }
  const date = pick('date')
  const description = pick('description')
  const debit = pick('debit')
  const credit = pick('credit')
  const amount = pick('amount')
  if (date === -1 || description === -1) return null
  if (amount === -1 && debit === -1 && credit === -1) return null
  return { date, description, amount, debit, credit }
}

/** Excel serial number, Date, or a dd/mm/yyyy-style string → ISO date (or null). */
export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toISO(value)
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    // Excel's day 0 is 1899-12-30.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(value).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s.split(/\s/)[0])
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  let year = Number(m[3])
  if (year < 100) year += 2000
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 1,234.50 / ₪ 52 / 52.00- / (52.00) → number, or null. */
export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let s = String(value).replace(/[‎‏‪-‮\s]/g, '').replace(/(₪|ש"ח|ש״ח|nis|ils|\$|€|£)/gi, '').replace(/,/g, '')
  let sign = 1
  if (/^\(.*\)$/.test(s)) {
    sign = -1
    s = s.slice(1, -1)
  }
  if (s.endsWith('-')) {
    sign = -sign
    s = s.slice(0, -1)
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null
  return sign * Number(s)
}

/** Find every transactions table in a sheet's rows (arrays of cells). */
export function detectTables(rows, sheetName = '') {
  const tables = []
  let current = null
  let blanks = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    const mapping = headerMapping(row)
    if (mapping) {
      current = { sheet: sheetName, headerRow: i, headers: row.map((c) => String(c ?? '').trim()), mapping, rows: [] }
      tables.push(current)
      blanks = 0
      continue
    }
    if (!current) continue
    if (row.every((c) => c === null || c === undefined || String(c).trim() === '')) {
      if (++blanks >= 3) current = null // a long gap ends the table
      continue
    }
    blanks = 0
    current.rows.push(row)
  }
  return tables.filter((t) => t.rows.length)
}

/** Bank exports have debit/credit columns; card exports list charges as positive amounts. */
export function guessKind(tables) {
  return tables.some((t) => t.mapping.debit !== -1 || t.mapping.credit !== -1) ? 'bank' : 'card'
}

/**
 * Table rows → { date, merchant, amount } with expenses negative.
 * `kind` 'card': positive amounts are charges. 'bank': a single amount column is
 * already signed, or debit/credit columns give the direction.
 */
export function tableToRows(table, kind) {
  const { date, description, amount, debit, credit } = table.mapping
  const out = []
  let skipped = 0
  for (const row of table.rows) {
    const iso = parseDate(row[date])
    const merchant = String(row[description] ?? '').replace(/\s+/g, ' ').trim()
    let value = null
    if (debit !== -1 || credit !== -1) {
      const d = debit !== -1 ? parseAmount(row[debit]) : null
      const c = credit !== -1 ? parseAmount(row[credit]) : null
      if (d) value = -Math.abs(d)
      else if (c) value = Math.abs(c)
    } else if (amount !== -1) {
      const a = parseAmount(row[amount])
      if (a !== null) value = kind === 'card' ? -a : a
    }
    if (!iso || !value || !merchant || SKIP_DESCRIPTION.test(merchant)) {
      skipped += 1
      continue
    }
    out.push({ date: iso, merchant: merchant.slice(0, 160), amount: Math.round(value * 100) / 100 })
  }
  return { rows: out, skipped }
}

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Older Israeli bank exports are in Windows-1255 (Hebrew).
    return new TextDecoder('windows-1255').decode(bytes)
  }
}

/** Parse a picked file into tables. SheetJS is loaded only when a file is imported. */
export async function readStatementFile(arrayBuffer, fileName = '') {
  const XLSX = await import('xlsx')
  const bytes = new Uint8Array(arrayBuffer)
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b // .xlsx
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf // legacy .xls
  // raw: keep CSV/HTML text as written – SheetJS would otherwise read 05/11 as May 11.
  // Excel dates stay day numbers (no cellDates) so no time zone can shift them.
  const workbook =
    isZip || isOle
      ? XLSX.read(bytes, { type: 'array', raw: true })
      : XLSX.read(decodeText(bytes), { type: 'string', raw: true })
  const tables = workbook.SheetNames.flatMap((name) =>
    detectTables(XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }), name),
  )
  return { fileName, tables, kind: guessKind(tables) }
}
