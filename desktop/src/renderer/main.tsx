// The window's entry: draws the overview (App.tsx) from the preload's window.overview.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../preload/api.ts'
import { App } from './App.tsx'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={window.overview} />
  </StrictMode>
)
