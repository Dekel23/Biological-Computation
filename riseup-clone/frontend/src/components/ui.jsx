import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { formatMonth } from '../utils/format'

export function Spinner({ className = '' }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand ${className}`}
    />
  )
}

export function LoadingBlock() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted">
      <Spinner /> {t('common.loading')}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  const { t } = useTranslation()
  return (
    <div className="card mx-auto my-8 max-w-sm p-6 text-center">
      <div className="mb-2 text-3xl">😕</div>
      <p className="font-medium">{t('common.error')}</p>
      {error?.message && <p className="mt-1 text-sm text-muted">{error.message}</p>}
      {onRetry && (
        <button className="btn-primary mt-4" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

export function CategoryIcon({ category, size = 'md' }) {
  const dims = size === 'sm' ? 'h-8 w-8 text-base' : size === 'lg' ? 'h-12 w-12 text-2xl' : 'h-10 w-10 text-lg'
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-xl ${dims}`}
      style={{ backgroundColor: `${category?.color ?? '#94a3b8'}22` }}
    >
      {category?.icon ?? '📦'}
    </span>
  )
}

/** Mobile bottom sheet; becomes a centered dialog on wider screens. */
export function Sheet({ open, onClose, title, children }) {
  const { t } = useTranslation()
  const panel = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label={t('common.close')} className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="animate-sheet relative max-h-[88vh] w-full max-w-app overflow-y-auto rounded-t-3xl bg-card p-5 pb-safe shadow-xl outline-none sm:rounded-3xl sm:pb-5"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded-full p-2 text-muted hover:bg-sunken" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Toggle({ checked, onChange, label, help, id }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {help && <span className="block text-xs text-muted">{help}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-line transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40" />
        {/* Logical inset so the knob starts on the reading side and slides correctly in RTL. */}
        <span className="absolute start-1 top-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
      </span>
    </label>
  )
}

export function MonthSwitcher({ month, onChange, maxMonth }) {
  const { t, i18n } = useTranslation()
  const canNext = !maxMonth || month < maxMonth
  const shift = (delta) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-sunken p-1">
      <button className="h-8 w-8 rounded-full hover:bg-card" onClick={() => shift(-1)} aria-label={t('common.prevMonth')}>
        <span className="inline-block rtl:rotate-180">‹</span>
      </button>
      <span className="min-w-[7.5rem] text-center text-sm font-medium">{formatMonth(month, i18n.language)}</span>
      <button
        className="h-8 w-8 rounded-full hover:bg-card disabled:opacity-30"
        onClick={() => shift(1)}
        disabled={!canNext}
        aria-label={t('common.nextMonth')}
      >
        <span className="inline-block rtl:rotate-180">›</span>
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------- toasts */
const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)
  const show = useCallback((message, tone = 'info') => {
    clearTimeout(timer.current)
    setToast({ message, tone, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), 3500)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4" aria-live="polite">
          <div
            key={toast.id}
            className={`animate-sheet pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${
              toast.tone === 'error' ? 'bg-bad text-white' : 'bg-ink text-surface'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
