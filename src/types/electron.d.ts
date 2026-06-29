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
      onKugouReady: (callback: () => void) => void
      onPlaybackToggle: (callback: () => void) => void
      onPlaybackNext: (callback: () => void) => void
      onPlaybackPrev: (callback: () => void) => void
      onWindowFocus: (callback: () => void) => void
      onWindowBlur: (callback: () => void) => void
    }
  }
}
