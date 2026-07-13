import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import DesktopLyricsView from './DesktopLyricsView'
import './index.css'

// v3.8.6: 桌面悬浮歌词窗口（独立透明窗口，hash = #desktop-lyrics）渲染极简视图
const isDesktopLyrics = window.location.hash === '#desktop-lyrics'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDesktopLyrics ? <DesktopLyricsView /> : <App />}
  </React.StrictMode>,
)
