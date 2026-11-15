import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled locally so the demo never depends on venue Wi-Fi.
import '@fontsource/bricolage-grotesque/latin-500.css'
import '@fontsource/bricolage-grotesque/latin-700.css'
import '@fontsource/bricolage-grotesque/latin-800.css'
import '@fontsource/figtree/latin-400.css'
import '@fontsource/figtree/latin-500.css'
import '@fontsource/figtree/latin-600.css'
import '@fontsource/figtree/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@fontsource/noto-sans-devanagari/devanagari-400.css'
import '@fontsource/noto-sans-devanagari/devanagari-700.css'
import '@fontsource/noto-sans-gurmukhi/gurmukhi-400.css'
import '@fontsource/noto-sans-gurmukhi/gurmukhi-700.css'
import './styles.css'
import './features.css'
import './ai.css'
import './boards.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LangProvider } from './lib/i18n'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </LangProvider>
  </StrictMode>,
)
