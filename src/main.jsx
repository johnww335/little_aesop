import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { log, warn } from './lib/logger'

const devStoryMode = import.meta.env.VITE_DEV_STORY_MODE
log('App', 'Environment', {
  VITE_DEV_STORY_MODE: devStoryMode,
  imageGeneration: devStoryMode === 'true' ? 'PLACEHOLDERS (dev mode)' : 'GPT Image (production mode)',
})
if (devStoryMode === 'true') {
  warn('App', '⚠️  VITE_DEV_STORY_MODE=true — stories will use placeholder images, not GPT Image')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
