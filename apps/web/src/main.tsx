import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import './styles.css'

const root = document.getElementById('root')

// Keep the self-contained build free of an otherwise automatic `/favicon.ico`
// request. The mark is inline, so the local-first app has no external asset.
const icon = document.createElement('link')
icon.rel = 'icon'
icon.href =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#e2f3ed"/><path d="M14 32h36M32 14v36" stroke="#7eaa9b" stroke-width="3"/><circle cx="22" cy="22" r="8" fill="#173247"/><circle cx="42" cy="42" r="8" fill="#fffdf5" stroke="#aebdb7" stroke-width="2"/><circle cx="32" cy="32" r="5" fill="#087e69"/></svg>',
  )
document.head.append(icon)

if (!root) throw new Error('Application root is missing')

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
