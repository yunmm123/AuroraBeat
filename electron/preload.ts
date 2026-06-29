import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
  app: {
    getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  },
  lyrics: {
    searchUfanv: (query: string) => ipcRenderer.invoke('lyrics:searchUfanv', query),
  },
  onPlaybackToggle: (callback: () => void) => {
    ipcRenderer.on('playback:toggle', callback)
  },
  onPlaybackNext: (callback: () => void) => {
    ipcRenderer.on('playback:next', callback)
  },
  onPlaybackPrev: (callback: () => void) => {
    ipcRenderer.on('playback:prev', callback)
  },
  onWindowFocus: (callback: () => void) => {
    ipcRenderer.on('window:focus', callback)
  },
  onWindowBlur: (callback: () => void) => {
    ipcRenderer.on('window:blur', callback)
  },
})
