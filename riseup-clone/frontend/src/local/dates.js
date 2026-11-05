/** Calendar helpers on ISO 'YYYY-MM-DD' strings in the phone's local time zone. */

const pad = (n) => String(n).padStart(2, '0')

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO() {
  return toISO(new Date())
}

export function addDays(iso, days) {
  const d = fromISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

/** Whole days from a to b (b − a). */
export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000)
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/** 'YYYY-MM' (default: month of `today`) → [first ISO, last ISO]. */
export function monthBounds(month, today = todayISO()) {
  const [y, m] = (month || today.slice(0, 7)).split('-').map(Number)
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`]
}

export function shiftMonth(firstISO, delta) {
  const [y, m] = firstISO.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`
}

/** Months between two dates, rounded up when `deadline` falls later in its month (min 1). */
export function monthsUntil(deadline, today) {
  const [dy, dm, dd] = deadline.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let months = (dy - ty) * 12 + (dm - tm)
  if (dd > td) months += 1
  return Math.max(1, months)
}

export const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100
