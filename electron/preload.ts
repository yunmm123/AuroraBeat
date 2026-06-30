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
  kugou: {
    // Generic, guarded invoke for KuGou channels (kg:*)
    invoke: (channel: string, ...args: any[]) => {
      if (typeof channel !== 'string' || !channel.startsWith('kg:')) {
        return Promise.reject(new Error('Invalid kugou channel: ' + channel))
      }
      return ipcRenderer.invoke(channel, ...args)
    },
  },
  netease: {
    search: (keyword: string, limit?: number, offset?: number) => ipcRenderer.invoke('netease:search', keyword, limit, offset),
    songUrl: (id: string, quality?: string) => ipcRenderer.invoke('netease:songUrl', id, quality),
    lyric: (id: string) => ipcRenderer.invoke('netease:lyric', id),
    qrKey: () => ipcRenderer.invoke('netease:qrKey'),
    qrCreate: (key: string) => ipcRenderer.invoke('netease:qrCreate', key),
    qrCheck: (key: string) => ipcRenderer.invoke('netease:qrCheck', key),
    loginStatus: () => ipcRenderer.invoke('netease:loginStatus'),
    userPlaylist: (uid: string) => ipcRenderer.invoke('netease:userPlaylist', uid),
    playlistDetail: (id: string, limit?: number, offset?: number) => ipcRenderer.invoke('netease:playlistDetail', id, limit, offset),
    recommendSongs: () => ipcRenderer.invoke('netease:recommendSongs'),
    recommendPlaylists: () => ipcRenderer.invoke('netease:recommendPlaylists'),
    artistTopSongs: (artistId: string) => ipcRenderer.invoke('netease:artistTopSongs', artistId),
    songDetail: (ids: string[]) => ipcRenderer.invoke('netease:songDetail', ids),
  },
  onKugouReady: (callback: () => void) => {
    ipcRenderer.on('kugou-api:ready', callback)
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
