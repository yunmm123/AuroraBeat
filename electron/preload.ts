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

  selectLocalFiles: () => ipcRenderer.invoke('dialog:selectLocalFiles'),
  readLocalFile: (path: string) => ipcRenderer.invoke('file:readAsBlob', path),
  searchLyrics: (title: string, artist: string) => ipcRenderer.invoke('lyrics:search', title, artist),

  kugouGetSongUrl: (hash: string, albumId?: string) => ipcRenderer.invoke('kg:songUrl', hash, albumId),
  kugouGetLyric: (hash: string, albumId?: string) => ipcRenderer.invoke('kg:lyric', hash, albumId),
  kugouSearch: (keyword: string, page?: number, pageSize?: number) => ipcRenderer.invoke('kg:search', keyword, page, pageSize),
  kugouPlaylistTrackAllNew: (listId: string, page?: number, pageSize?: number) => ipcRenderer.invoke('kg:playlistTrackAllNew', listId, page, undefined, undefined, pageSize),
  kugouRankList: () => ipcRenderer.invoke('kg:rankList'),
  kugouRankAudio: (rankId: string, page?: number) => ipcRenderer.invoke('kg:rankAudio', rankId, page),
  kugouUserPlaylist: (uid: string, token: string, page?: number) => ipcRenderer.invoke('kg:userPlaylist', uid, token, page),
  kugouRecommendSongs: () => ipcRenderer.invoke('kg:recommendSongs'),
  kugouQrKey: () => ipcRenderer.invoke('kg:qrKey'),
  kugouQrCreate: (key: string) => ipcRenderer.invoke('kg:qrCreate', key),
  kugouQrCheck: (key: string) => ipcRenderer.invoke('kg:qrCheck', key),
  kugouLoginStatus: () => ipcRenderer.invoke('kg:loginStatus'),

  neteaseGetSongUrl: (id: string) => ipcRenderer.invoke('netease:songUrl', id),
  neteaseGetLyric: (id: string) => ipcRenderer.invoke('netease:lyric', id),
  neteaseSearch: (keyword: string, limit?: number, offset?: number) => ipcRenderer.invoke('netease:search', keyword, limit, offset),
  neteaseRecommendSongs: () => ipcRenderer.invoke('netease:recommendSongs'),
  neteaseRecommendPlaylists: () => ipcRenderer.invoke('netease:recommendPlaylists'),
  neteaseLoginStatus: () => ipcRenderer.invoke('netease:loginStatus'),
  neteaseUserPlaylist: (uid: string) => ipcRenderer.invoke('netease:userPlaylist', uid),
  neteasePlaylistDetail: (id: string, limit?: number, offset?: number) => ipcRenderer.invoke('netease:playlistDetail', id, limit, offset),
  neteaseOpenLoginWindow: () => ipcRenderer.invoke('netease:openLoginWindow'),

  saveKugouAuth: (uid: string, token: string, nickname: string, avatar?: string) => ipcRenderer.invoke('auth:saveKugou', uid, token, nickname, avatar),
  saveNeteaseAuth: (userId: string, nickname: string, avatarUrl: string, cookie?: string) => ipcRenderer.invoke('auth:saveNetease', userId, nickname, avatarUrl, cookie),
  getAuth: () => ipcRenderer.invoke('auth:get'),
  clearAuth: (provider?: string) => ipcRenderer.invoke('auth:clear', provider),

  onAuthRestored: (callback: (data: any) => void) => {
    ipcRenderer.on('auth:restored', (_e, data) => callback(data))
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
})
