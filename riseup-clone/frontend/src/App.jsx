import { useEffect } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, notifyDataChanged } from './api'
import { LANGUAGES } from './i18n'
import { useOnline } from './hooks/useApi'
import { CategoriesProvider } from './hooks/useCategories'
import { ToastProvider } from './components/ui'
import Dashboard from './components/Dashboard'
import TransactionsTable from './components/TransactionsTable'
import WhatsAppSimulator from './components/WhatsAppSimulator'
import GoalsPage from './components/GoalsPage'
import Settings from './components/Settings'

const NAV = [
  { to: '/', key: 'home', icon: HomeIcon, end: true },
  { to: '/transactions', key: 'transactions', icon: ListIcon },
  { to: '/bot', key: 'bot', icon: ChatIcon },
  { to: '/goals', key: 'goals', icon: TargetIcon },
  { to: '/settings', key: 'settings', icon: GearIcon },
]

export function LanguageToggle() {
  const { t, i18n } = useTranslation()
  const current = i18n.resolvedLanguage === 'he' ? 'he' : 'en'
  const next = current === 'he' ? 'en' : 'he'
  const toggle = () => {
    i18n.changeLanguage(next)
    // Keep the bot's proactive messages in the same language as the app.
    api.updateSettings({ language: next }).then(notifyDataChanged).catch(() => {})
  }
  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-sunken"
      aria-label={t('lang.switchTo', { lang: LANGUAGES[next].label })}
      lang={next}
    >
      <GlobeIcon />
      {LANGUAGES[next].label}
    </button>
  )
}

function Header() {
  const { t } = useTranslation()
  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-line/60 bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-app items-center justify-between px-4 pb-3">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div className="leading-tight">
            <div className="font-semibold">{t('app.name')}</div>
            <div className="text-xs text-muted">{t('app.tagline')}</div>
          </div>
        </div>
        <LanguageToggle />
      </div>
    </header>
  )
}

function BottomNav() {
  const { t } = useTranslation()
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur" aria-label="Main">
      <ul className="mx-auto grid max-w-app grid-cols-5">
        {NAV.map(({ to, key, icon: Icon, end }) => (
          <li key={key}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition ${
                  isActive ? 'text-brand' : 'text-muted hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`rounded-full px-4 py-1 transition ${isActive ? 'bg-brand-soft' : ''}`}>
                    <Icon />
                  </span>
                  {t(`nav.${key}`)}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function OfflineBanner() {
  const online = useOnline()
  const { t } = useTranslation()
  if (online) return null
  return <div className="bg-warn/20 px-4 py-2 text-center text-xs font-medium text-ink">{t('common.offline')}</div>
}

export default function App() {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage === 'he' ? 'he' : 'en'
  const dir = LANGUAGES[lang].dir

  // The language picked on this device wins; tell the server so bot messages match.
  useEffect(() => {
    api
      .settings()
      .then((s) => s.language !== lang && api.updateSettings({ language: lang }).then(notifyDataChanged))
      .catch(() => {})
    // Only on start-up: later switches go through LanguageToggle / Settings.
  }, [])

  return (
    // Mirrors <html dir> (set by i18n.js) so a language switch re-renders the whole tree
    // with the right direction; Tailwind's rtl: variants resolve against the nearest [dir].
    <div dir={dir} lang={lang} className="min-h-screen">
      <ToastProvider>
        <CategoriesProvider>
          <Header />
          <OfflineBanner />
          <main className="mx-auto max-w-app px-4 pb-28 pt-4">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/transactions" element={<TransactionsTable />} />
              <Route path="/bot" element={<WhatsAppSimulator />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <BottomNav />
        </CategoriesProvider>
      </ToastProvider>
    </div>
  )
}

/* ---------------------------------------------------------------- icons */
function svgProps() {
  return { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
}
function HomeIcon() {
  return <svg {...svgProps()}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></svg>
}
function ListIcon() {
  return <svg {...svgProps()}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
}
function ChatIcon() {
  return <svg {...svgProps()}><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12Z" /></svg>
}
function TargetIcon() {
  return <svg {...svgProps()}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>
}
function GearIcon() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  )
}
function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  )
}
