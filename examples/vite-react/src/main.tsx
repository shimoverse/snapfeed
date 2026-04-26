import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FeedbackProvider, FeedbackButton } from 'snapfeed'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <FeedbackProvider
      appName="Vite Demo"
      hotkey="ctrl+shift+f"
      position="bottom-right"
      theme="auto"
      accentColor="#D4714B"
      autoScreenshot
      enableInProduction={false}
      apiUrl="/api/feedback"
    >
      <App />
      <FeedbackButton />
    </FeedbackProvider>
  </StrictMode>,
)
