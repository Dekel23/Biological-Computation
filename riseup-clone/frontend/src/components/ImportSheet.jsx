import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, notifyDataChanged } from '../api'
import { splitMessages } from '../local/smsParser'
import { readStatementFile, tableToRows } from '../local/statementImport'
import { formatDate, formatMoney } from '../utils/format'
import { Sheet, Spinner, useToast } from './ui'

const ACCOUNT_SUGGESTIONS = ['Isracard', 'Max', 'Amex', 'Otsar HaHayal']

/** Guess the account from the file name, e.g. "max_transactions.xlsx" → Max. */
function guessLabel(fileName, kind) {
  const n = fileName.toLowerCase()
  if (/isracard|ישראכרט/.test(n)) return 'Isracard'
  if (/\bmax|מקס/.test(n)) return 'Max'
  if (/amex|אמריקן/.test(n)) return 'Amex'
  if (/otsar|אוצר/.test(n) || kind === 'bank') return 'Otsar HaHayal'
  return ''
}

export default function ImportSheet({ open, onClose }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('file')
  return (
    <Sheet open={open} onClose={onClose} title={t('importer.title')}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-sm">
        {[
          ['file', t('importer.tabFile')],
          ['sms', t('importer.tabSms')],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg py-2 font-medium ${tab === key ? 'bg-card shadow-sm' : 'text-muted'}`}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'file' ? <FileImport onDone={onClose} /> : <PasteMessages onDone={onClose} />}
    </Sheet>
  )
}

function FileImport({ onDone }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const toast = useToast()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [kind, setKind] = useState('card')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const parsed = useMemo(() => {
    if (!file) return null
    const parts = file.tables.map((table) => tableToRows(table, kind))
    return { rows: parts.flatMap((p) => p.rows), skipped: parts.reduce((s, p) => s + p.skipped, 0) }
  }, [file, kind])

  const pick = async (e) => {
    const chosen = e.target.files?.[0]
    e.target.value = ''
    if (!chosen) return
    setBusy(true)
    try {
      const result = await readStatementFile(await chosen.arrayBuffer(), chosen.name)
      setFile(result)
      setKind(result.kind)
      setLabel(guessLabel(chosen.name, result.kind))
    } catch (err) {
      setFile(null)
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.importStatement({ rows: parsed.rows, label: label || (kind === 'bank' ? 'Bank' : 'Card') })
      toast(t('importer.imported', res))
      notifyDataChanged()
      onDone()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">{t('importer.fileHelp')}</p>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept=".xlsx,.xls,.csv,.html,.htm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={pick}
      />
      <button className="btn-ghost w-full" onClick={() => input.current?.click()} disabled={busy}>
        {busy && !file ? <Spinner className="h-4 w-4" /> : '📄'} {busy && !file ? t('importer.reading') : t('importer.pick')}
      </button>

      {file && !parsed.rows.length && <p className="rounded-xl bg-bad/10 p-3 text-sm text-bad">{t('importer.noTables')}</p>}

      {file && parsed.rows.length > 0 && (
        <>
          <div className="rounded-xl bg-sunken p-3 text-sm">
            <p className="font-medium">
              <bdi>{t('importer.found', { count: parsed.rows.length, file: file.fileName })}</bdi>
            </p>
            {parsed.skipped > 0 && <p className="text-xs text-muted">{t('importer.skipped', { count: parsed.skipped })}</p>}
          </div>

          <div>
            <span className="label">{t('importer.kind')}</span>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-sm">
              {[
                ['card', t('importer.kindCard')],
                ['bank', t('importer.kindBank')],
              ].map(([key, text]) => (
                <button key={key} onClick={() => setKind(key)} className={`rounded-lg py-2 font-medium ${kind === key ? 'bg-card shadow-sm' : 'text-muted'}`} aria-pressed={kind === key}>
                  {text}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="imp-label">{t('importer.label')}</label>
            <input id="imp-label" className="input" dir="auto" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-2">
              {ACCOUNT_SUGGESTIONS.map((name) => (
                <button key={name} className={`chip ${label === name ? 'chip-active' : ''}`} onClick={() => setLabel(name)}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">{t('importer.preview')}</span>
            <ul className="divide-y divide-line/60 rounded-xl border border-line text-sm">
              {parsed.rows.slice(0, 5).map((row, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate">
                    <span className="text-muted">{formatDate(row.date, lang)} · </span>
                    <bdi>{row.merchant}</bdi>
                  </span>
                  <span className={`num shrink-0 font-medium ${row.amount > 0 ? 'text-good' : ''}`}>
                    {formatMoney(row.amount, { lang, decimals: 2, signed: row.amount > 0 })}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <button className="btn-primary w-full" onClick={submit} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : null}
            {t('importer.importN', { count: parsed.rows.length })}
          </button>
        </>
      )}
    </div>
  )
}

function PasteMessages({ onDone }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const count = splitMessages(text).length

  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.logSmsBatch(text)
      toast(t('importer.smsDone', res))
      notifyDataChanged()
      onDone()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">{t('importer.smsHelp')}</p>
      <textarea
        className="input min-h-[10rem]"
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('importer.smsPlaceholder')}
      />
      <button className="btn-primary w-full" onClick={submit} disabled={!count || busy}>
        {t('importer.logN')} {count > 0 && `(${count})`}
      </button>
    </div>
  )
}
