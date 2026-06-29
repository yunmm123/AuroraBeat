import { create } from 'zustand'
import type { Song, Playlist, PlayMode, AudioFeatures, VisualEffectType, Theme } from '@/types'
import { themes } from '@/utils/themes'

interface PlayerState {
  currentSong: Song | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  playMode: PlayMode
  playbackRate: number
  queue: Song[]
  queueIndex: number
  
  playlists: Playlist[]
  currentPlaylist: Playlist | null
  
  audioFeatures: AudioFeatures | null
  visualEffect: VisualEffectType
  autoVisualEffect: boolean
  
  currentTheme: Theme
  darkMode: boolean
  
  showLyrics: boolean
  showPlaylist: boolean
  showQueue: boolean
  showSettings: boolean
  
  equalizerGains: number[]
  equalizerEnabled: boolean
  bassBoost: number
  surroundEnabled: boolean
  
  renderQuality: 'low' | 'medium' | 'high' | 'ultra'
  showSearch: boolean
  localSongs: Song[]
  searchQuery: string
  searchResults: Song[]
  
  setCurrentSong: (song: Song | null) => void
  setIsPlaying: (playing: boolean) => void
  togglePlay: () => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setPlayMode: (mode: PlayMode) => void
  setPlaybackRate: (rate: number) => void
  nextSong: () => void
  prevSong: () => void
  setQueue: (songs: Song[], startIndex?: number) => void
  
  setPlaylists: (playlists: Playlist[]) => void
  setCurrentPlaylist: (playlist: Playlist | null) => void
  
  setAudioFeatures: (features: AudioFeatures) => void
  setVisualEffect: (effect: VisualEffectType) => void
  setAutoVisualEffect: (auto: boolean) => void
  
  setTheme: (theme: Theme) => void
  toggleDarkMode: () => void
  
  toggleLyrics: () => void
  togglePlaylist: () => void
  toggleQueue: () => void
  toggleSettings: () => void
  toggleSearch: () => void
  
  setEqualizerGains: (gains: number[]) => void
  setEqualizerEnabled: (enabled: boolean) => void
  setBassBoost: (value: number) => void
  setSurroundEnabled: (enabled: boolean) => void
  setRenderQuality: (quality: 'low' | 'medium' | 'high' | 'ultra') => void
  addLocalSongs: (songs: Song[]) => void
  setSearchQuery: (query: string) => void
  playSong: (song: Song) => void
}

const mockSong: Song = {
  id: 'demo-1',
  title: 'Aurora Dreams',
  artist: 'Synthwave Orchestra',
  album: 'Neon Horizons',
  cover: '',
  duration: 245,
  url: '',
  source: 'local',
  quality: 'lossless',
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: mockSong,
  isPlaying: false,
  currentTime: 0,
  duration: 245,
  volume: 0.75,
  isMuted: false,
  playMode: 'sequence',
  playbackRate: 1,
  queue: [mockSong],
  queueIndex: 0,
  
  playlists: [
    {
      id: 'favorites',
      name: '我喜欢',
      cover: '',
      songs: [mockSong],
      source: 'local',
    },
    {
      id: 'recent',
      name: '最近播放',
      cover: '',
      songs: [mockSong],
      source: 'local',
    },
    {
      id: 'local',
      name: '本地音乐',
      cover: '',
      songs: [],
      source: 'local',
    },
  ],
  currentPlaylist: null,
  
  audioFeatures: null,
  visualEffect: 'particles',
  autoVisualEffect: true,
  
  currentTheme: themes[0],
  darkMode: true,
  
  showLyrics: false,
  showPlaylist: true,
  showQueue: false,
  showSettings: false,
  
  equalizerGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  equalizerEnabled: false,
  bassBoost: 0,
  surroundEnabled: false,
  
  renderQuality: 'high',
  showSearch: false,
  localSongs: [],
  searchQuery: '',
  searchResults: [],
  
  setCurrentSong: (song) => set({ currentSong: song }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  togglePlay: () => set({ isPlaying: !get().isPlaying }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
  toggleMute: () => set({ isMuted: !get().isMuted }),
  setPlayMode: (mode) => set({ playMode: mode }),
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  nextSong: () => {
    const { queue, queueIndex, playMode } = get()
    let nextIndex = queueIndex
    if (playMode === 'shuffle') {
      nextIndex = Math.floor(Math.random() * queue.length)
    } else if (playMode === 'single') {
      nextIndex = queueIndex
    } else {
      nextIndex = (queueIndex + 1) % queue.length
    }
    set({ queueIndex: nextIndex, currentSong: queue[nextIndex], currentTime: 0 })
  },
  prevSong: () => {
    const { queue, queueIndex } = get()
    const prevIndex = queueIndex === 0 ? queue.length - 1 : queueIndex - 1
    set({ queueIndex: prevIndex, currentSong: queue[prevIndex], currentTime: 0 })
  },
  setQueue: (songs, startIndex = 0) => set({ 
    queue: songs, 
    queueIndex: startIndex,
    currentSong: songs[startIndex] || null,
    currentTime: 0,
  }),
  
  setPlaylists: (playlists) => set({ playlists }),
  setCurrentPlaylist: (playlist) => set({ currentPlaylist: playlist }),
  
  setAudioFeatures: (features) => set({ audioFeatures: features }),
  setVisualEffect: (effect) => set({ visualEffect: effect }),
  setAutoVisualEffect: (auto) => set({ autoVisualEffect: auto }),
  
  setTheme: (theme) => set({ currentTheme: theme }),
  toggleDarkMode: () => set({ darkMode: !get().darkMode }),
  
  toggleLyrics: () => set({ showLyrics: !get().showLyrics }),
  togglePlaylist: () => set({ showPlaylist: !get().showPlaylist }),
  toggleQueue: () => set({ showQueue: !get().showQueue }),
  toggleSettings: () => set({ showSettings: !get().showSettings }),
  toggleSearch: () => set({ showSearch: !get().showSearch }),
  
  setEqualizerGains: (gains) => set({ equalizerGains: gains }),
  setEqualizerEnabled: (enabled) => set({ equalizerEnabled: enabled }),
  setBassBoost: (value) => set({ bassBoost: value }),
  setSurroundEnabled: (enabled) => set({ surroundEnabled: enabled }),
  setRenderQuality: (quality) => set({ renderQuality: quality }),
  addLocalSongs: (songs) => set((state) => ({
    localSongs: [...state.localSongs, ...songs],
    playlists: state.playlists.map(p =>
      p.id === 'local' ? { ...p, songs: [...p.songs, ...songs] } : p
    ),
  })),
  setSearchQuery: (query) => {
    const q = query.toLowerCase()
    const allSongs = [
      ...get().queue,
      ...get().localSongs,
      ...get().playlists.flatMap(p => p.songs),
    ]
    const unique = new Map<string, Song>()
    allSongs.forEach(s => {
      if (!unique.has(s.id)) unique.set(s.id, s)
    })
    const results = q
      ? Array.from(unique.values()).filter(s =>
          s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.album.toLowerCase().includes(q)
        )
      : []
    set({ searchQuery: query, searchResults: results })
  },
  playSong: (song) => {
    set({ currentSong: song, isPlaying: true, currentTime: 0 })
  },
}))
