import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './i18n'
import './index.css'
import App from './App'
import { IS_LOCAL } from './api'

const Router = IS_LOCAL ? HashRouter : BrowserRouter

// Service worker: precaches the app shell and auto-updates in the background.
registerSW({ immediate: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
)
