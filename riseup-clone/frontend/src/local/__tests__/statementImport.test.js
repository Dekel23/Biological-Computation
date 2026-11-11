import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseAmount, parseDate, readStatementFile, tableToRows } from '../statementImport'

const xlsxBuffer = (sheets) => {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

/** Encode text as Windows-1255, the legacy Hebrew code page. */
const cp1255 = (text) =>
  Uint8Array.from([...text].map((ch) => {
    const c = ch.charCodeAt(0)
    return c >= 0x5d0 && c <= 0x5ea ? c - 0x5d0 + 0xe0 : c
  })).buffer

const allRows = (file) => file.tables.flatMap((t) => tableToRows(t, file.kind).rows)

describe('cell parsing', () => {
  it.each([
    ['05/11/2026', '2026-11-05'], ['5.11.26', '2026-11-05'], ['2026-11-05', '2026-11-05'], [46331, '2026-11-05'], ['abc', null], ['', null],
  ])('parseDate(%s)', (input, out) => expect(parseDate(input)).toBe(out))

  it.each([
    ['1,234.50', 1234.5], ['₪ 52', 52], ['52.00-', -52], ['(30.00)', -30], [89.9, 89.9], ['n/a', null], ['', null],
  ])('parseAmount(%s)', (input, out) => expect(parseAmount(input)).toBe(out))
})

describe('readStatementFile', () => {
  it('reads a credit-card export with domestic and foreign sections, preferring the charged ILS amount', async () => {
    const buf = xlsxBuffer({
      'עסקאות': [
        ['פירוט עסקאות לכרטיס 5678'],
        [],
        ['תאריך עסקה', 'שם בית העסק', 'קטגוריה', 'סכום עסקה מקורי', 'סכום חיוב', 'הערות'],
        ['03/11/2026', 'ארומה תל אביב', 'מסעדות', 52, 52, ''],
        ['04/11/2026', 'WOLT', 'מסעדות', 89.9, 89.9, ''],
        ['05/11/2026', 'ZARA', 'אופנה', -120, -120, 'זיכוי'],
        ['', 'סה"כ', '', '', 21.9, ''],
        [],
        [],
        [],
        ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה מקורי', 'סכום חיוב'],
        ['02/11/2026', 'NETFLIX.COM', 'USD 17.99', 66.5],
      ],
    })
    const file = await readStatementFile(buf, 'max.xlsx')
    expect(file.kind).toBe('card')
    expect(file.tables).toHaveLength(2)
    expect(allRows(file)).toEqual([
      { date: '2026-11-03', merchant: 'ארומה תל אביב', amount: -52 },
      { date: '2026-11-04', merchant: 'WOLT', amount: -89.9 },
      { date: '2026-11-05', merchant: 'ZARA', amount: 120 },
      { date: '2026-11-02', merchant: 'NETFLIX.COM', amount: -66.5 },
    ])
  })

  it('reads a bank export with debit / credit columns and ignores the balance', async () => {
    const buf = xlsxBuffer({
      Sheet1: [
        ['תאריך', 'תאריך ערך', 'תיאור', 'אסמכתא', 'חובה', 'זכות', 'יתרה בש"ח'],
        ['01/11/2026', '01/11/2026', 'שכר דירה - העברה', '1001', '4,800.00', '', '9,200.00'],
        ['10/11/2026', '10/11/2026', 'משכורת', '1002', '', '13,950.00', '23,150.00'],
        ['10/11/2026', '10/11/2026', 'ישראכרט', '1003', '3,420.17', '', '19,729.83'],
      ],
    })
    const file = await readStatementFile(buf, 'otsar.xlsx')
    expect(file.kind).toBe('bank')
    expect(allRows(file)).toEqual([
      { date: '2026-11-01', merchant: 'שכר דירה - העברה', amount: -4800 },
      { date: '2026-11-10', merchant: 'משכורת', amount: 13950 },
      { date: '2026-11-10', merchant: 'ישראכרט', amount: -3420.17 },
    ])
  })

  it('reads the HTML ".xls" some banks produce', async () => {
    const html = `<html><body><table>
      <tr><td>תאריך</td><td>תיאור</td><td>חובה</td><td>זכות</td></tr>
      <tr><td>07/11/2026</td><td>שופרסל דיל</td><td>214.30</td><td></td></tr>
    </table></body></html>`
    const file = await readStatementFile(new TextEncoder().encode(html).buffer, 'bank.xls')
    expect(allRows(file)).toEqual([{ date: '2026-11-07', merchant: 'שופרסל דיל', amount: -214.3 }])
  })

  it('reads a Windows-1255 CSV without swapping day and month', async () => {
    const csv = 'תאריך,תיאור,סכום\n05/11/2026,קופיקס,-18.00\n06/11/2026,החזר,25.00\n'
    const file = await readStatementFile(cp1255(csv), 'export.csv')
    expect(file.kind).toBe('card')
    // A single signed column is a bank layout – the user picks "bank" in the preview.
    expect(file.tables.flatMap((t) => tableToRows(t, 'bank').rows)).toEqual([
      { date: '2026-11-05', merchant: 'קופיקס', amount: -18 },
      { date: '2026-11-06', merchant: 'החזר', amount: 25 },
    ])
  })

  it('finds no tables in an unrelated file', async () => {
    const file = await readStatementFile(xlsxBuffer({ S: [['name', 'age'], ['Dana', 30]] }), 'x.xlsx')
    expect(file.tables).toHaveLength(0)
  })
})
