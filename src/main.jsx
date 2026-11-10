import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// First, so embed mode is set before anything renders.
import './data/embed.js'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
