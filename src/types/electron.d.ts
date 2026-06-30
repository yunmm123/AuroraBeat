export {}

declare global {
  interface Window {
    electronAPI?: {
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<boolean>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
      }
      app: {
        getPath: (name: string) => Promise<string>
      }
      lyrics: {
        searchUfanv: (query: string) => Promise<string | null>
      }
      kugou: {
        invoke: (channel: string, ...args: any[]) => Promise<any>
      }
      netease: {
        search: (keyword: string, limit?: number, offset?: number) => Promise<{ ok: boolean; songs: any[]; total: number }>
        songUrl: (id: string, quality?: string) => Promise<{ ok: boolean; url: string; playable: boolean }>
        lyric: (id: string) => Promise<{ ok: boolean; lrc: string; tlyric: string }>
        qrKey: () => Promise<{ ok: boolean; key: string }>
        qrCreate: (key: string) => Promise<{ ok: boolean; qrimg: string }>
        qrCheck: (key: string) => Promise<{ ok: boolean; code: number; message: string; cookie: string }>
        loginStatus: () => Promise<{ ok: boolean; loggedIn: boolean; user: any }>
        userPlaylist: (uid: string) => Promise<{ ok: boolean; playlists: any[] }>
        playlistDetail: (id: string, limit?: number, offset?: number) => Promise<{ ok: boolean; songs: any[]; total: number }>
        recommendSongs: () => Promise<{ ok: boolean; songs: any[] }>
        recommendPlaylists: () => Promise<{ ok: boolean; playlists: any[] }>
        artistTopSongs: (artistId: string) => Promise<{ ok: boolean; songs: any[] }>
        songDetail: (ids: string[]) => Promise<{ ok: boolean; songs: any[] }>
      }
      auth: {
        saveKugou: (uid: string, token: string, nickname: string) => Promise<boolean>
        saveNetease: (userId: string, nickname: string, avatarUrl: string) => Promise<boolean>
      }
      onAuthRestored: (callback: (data: any) => void) => void
      onKugouReady: (callback: () => void) => void
      onPlaybackToggle: (callback: () => void) => void
      onPlaybackNext: (callback: () => void) => void
      onPlaybackPrev: (callback: () => void) => void
      onWindowFocus: (callback: () => void) => void
      onWindowBlur: (callback: () => void) => void
    }
  }
}
