import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // 服务器端口
  getServerPort: () => ipcRenderer.invoke('get-server-port'),

  // 网易云登录
  neteaseOpenLogin: () => ipcRenderer.invoke('netease:openLogin'),
  neteaseClearLogin: () => ipcRenderer.invoke('netease:clearLogin'),

  // 本地文件
  selectLocalFiles: () => ipcRenderer.invoke('dialog:selectLocalFiles'),
  selectImageFile: () => ipcRenderer.invoke('dialog:selectImageFile'),
  selectVideoFile: () => ipcRenderer.invoke('dialog:selectVideoFile'),
  readLocalFile: (filePath: string) => ipcRenderer.invoke('file:readAsBlob', filePath),
  searchLyrics: (title: string, artist: string) => ipcRenderer.invoke('lyrics:search', title, artist),
  // v3.7.0: 在系统浏览器打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // 媒体键
  onPlaybackToggle: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('playback:toggle', listener)
    return () => ipcRenderer.removeListener('playback:toggle', listener)
  },
  onPlaybackNext: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('playback:next', listener)
    return () => ipcRenderer.removeListener('playback:next', listener)
  },
  onPlaybackPrev: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('playback:prev', listener)
    return () => ipcRenderer.removeListener('playback:prev', listener)
  },

  // v3.8.6: 桌面悬浮歌词
  toggleDesktopLyrics: (enabled: boolean) => ipcRenderer.invoke('desktop-lyrics:toggle', enabled),
  updateDesktopLyrics: (text: string, translation: string, isPlaying: boolean) => ipcRenderer.invoke('desktop-lyrics:update', text, translation, isPlaying),
  setDesktopLyricsPosition: (x?: number, y?: number) => ipcRenderer.invoke('desktop-lyrics:position', x, y),
  onDesktopLyricsReady: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('desktop-lyrics:ready', listener)
    return () => ipcRenderer.removeListener('desktop-lyrics:ready', listener)
  },
  // 桌面歌词窗口接收主进程转发的歌词更新
  onDesktopLyricsUpdate: (cb: (data: { text: string; translation: string; isPlaying: boolean }) => void) => {
    const listener = (_e: unknown, data: { text: string; translation: string; isPlaying: boolean }) => cb(data)
    ipcRenderer.on('desktop-lyrics:lyric-update', listener)
    return () => ipcRenderer.removeListener('desktop-lyrics:lyric-update', listener)
  },
})