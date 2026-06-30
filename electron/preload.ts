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
  readLocalFile: (filePath: string) => ipcRenderer.invoke('file:readAsBlob', filePath),
  searchLyrics: (title: string, artist: string) => ipcRenderer.invoke('lyrics:search', title, artist),

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

  // 桌面歌词
  openDesktopLyrics: () => ipcRenderer.invoke('desktop-lyrics:open'),
  closeDesktopLyrics: () => ipcRenderer.invoke('desktop-lyrics:close'),
  toggleDesktopLyrics: () => ipcRenderer.invoke('desktop-lyrics:toggle'),
  sendLyricsToDesktop: (data: any) => ipcRenderer.send('desktop-lyrics:update', data),
  onDesktopLyricsState: (cb: (state: boolean) => void) => {
    const listener = (_e: any, state: boolean) => cb(state);
    ipcRenderer.on('desktop-lyrics:state', listener);
    return () => ipcRenderer.removeListener('desktop-lyrics:state', listener);
  },
})