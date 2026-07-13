export {}

declare global {
  interface Window {
    electronAPI?: {
      // 窗口控制
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>

      // 服务器端口
      getServerPort: () => Promise<number>

      // 网易云登录
      neteaseOpenLogin: () => Promise<{ ok: boolean; cookie?: string; reused?: boolean }>
      neteaseClearLogin: () => Promise<{ ok: boolean }>

      // v3.8.6 酷狗登录（独立，与网易云互不影响）
      kugouOpenLogin: () => Promise<{ ok: boolean; cookie?: string; reused?: boolean }>
      kugouClearLogin: () => Promise<{ ok: boolean }>

      // 本地文件
      selectLocalFiles: () => Promise<any[]>
      selectImageFile: () => Promise<{ path: string }>
      selectVideoFile: () => Promise<{ url: string; path: string }>
      readLocalFile: (filePath: string) => Promise<string>
      searchLyrics: (title: string, artist: string) => Promise<{ lyric: string } | null>

      // 媒体键
      onPlaybackToggle: (cb: () => void) => () => void
      onPlaybackNext: (cb: () => void) => () => void
      onPlaybackPrev: (cb: () => void) => () => void

      // 桌面歌词
      openDesktopLyrics: () => Promise<any>
      closeDesktopLyrics: () => Promise<any>
      toggleDesktopLyrics: () => Promise<{ open: boolean }>
      sendLyricsToDesktop: (data: { text: string; progress: number }) => void
      onDesktopLyricsState: (cb: (state: boolean) => void) => () => void
    }
  }
}
