import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MiniPlayer from './MiniPlayer'
import './index.css'

// v3.5.0 B4: 迷你模式 — hash=#mini 时渲染迷你窗口
const isMini = window.location.hash === '#/mini' || window.location.hash === '#mini'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isMini ? <MiniPlayer /> : <App />}
  </React.StrictMode>,
)
