import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthGate } from './AuthGate'
import './styles.css'
import './import.css'
import './auth.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const hadController = Boolean(navigator.serviceWorker.controller)
    let refreshing = false

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return
      refreshing = true
      window.location.reload()
    })

    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      updateViaCache: 'none',
    }).then((registration) => {
      void registration.update()

      // Een app die lang openstaat controleert bij terugkeer ook op een nieuwe
      // release. Dit raakt alleen het kleine serviceworkerbestand, niet Supabase.
      window.addEventListener('focus', () => {
        void registration.update()
      })
    })
  })
}
