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
      accentColor="#B85A36"
      autoScreenshot
      enableInProduction={false}
      apiUrl="/api/feedback"
    >
      <App />
      <FeedbackButton />
    </FeedbackProvider>
  </StrictMode>,
)
