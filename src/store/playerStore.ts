import { create } from 'zustand'
import type { Song, Playlist, PlayMode, AudioFeatures, VisualEffectType, Theme } from '@/types'
import { themes } from '@/utils/themes'
import { getAllAudioFiles, saveAudioFile, deleteAudioFile, type StoredAudio } from '@/utils/audioDB'
import { searchLyrics, parseSyncedLyrics, type LyricLine } from '@/services/lyricsApi'

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
  activeCategory: string | null
  
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
  dbLoading: boolean
  
  // Lyrics
  lyrics: LyricLine[]
  lyricsLoading: boolean
  
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
  setActiveCategory: (category: string | null) => void
  
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
  removeLocalSong: (id: string) => void
  setSearchQuery: (query: string) => void
  playSong: (song: Song) => void
  loadFromDB: () => Promise<void>
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
  currentSong: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.75,
  isMuted: false,
  playMode: 'sequence',
  playbackRate: 1,
  queue: [],
  queueIndex: 0,
  
  playlists: [
    {
      id: 'all',
      name: '全部音乐',
      cover: '',
      songs: [],
      source: 'local',
    },
  ],
  currentPlaylist: null,
  activeCategory: null,
  
  audioFeatures: null,
  visualEffect: 'lyrics',
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
  dbLoading: true,
  
  // Lyrics
  lyrics: [],
  lyricsLoading: false,
  
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
    if (queue.length === 0) return
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
    if (queue.length === 0) return
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
  setCurrentPlaylist: (playlist) => set({ currentPlaylist: playlist, activeCategory: null }),
  setActiveCategory: (category) => set({ activeCategory: category, currentPlaylist: null }),
  
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
  
  addLocalSongs: async (songs) => {
    const state = get()
    const newSongs = [...state.localSongs, ...songs]
    
    for (const song of songs) {
      const file = await fetch(song.url).then(r => r.blob()).then(b => new File([b], song.title + '.mp3'))
      await saveAudioFile({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        fileName: song.title,
        file,
      })
    }
    
    const allPlaylist = state.playlists.find(p => p.id === 'all')
    set({
      localSongs: newSongs,
      playlists: state.playlists.map(p =>
        p.id === 'all' ? { ...p, songs: newSongs } : p
      ),
      queue: state.queue.length === 0 ? newSongs : state.queue,
      currentSong: state.currentSong || newSongs[0] || null,
    })
  },
  
  removeLocalSong: async (id) => {
    await deleteAudioFile(id)
    const state = get()
    const newLocal = state.localSongs.filter(s => s.id !== id)
    set({
      localSongs: newLocal,
      playlists: state.playlists.map(p =>
        p.id === 'all' ? { ...p, songs: newLocal } : p
      ),
    })
  },
  
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
    set({ currentSong: song, isPlaying: true, currentTime: 0, lyrics: [], lyricsLoading: true })
    
    // Auto-fetch lyrics from lrclib.net
    const trackName = song.title.replace(/\.[^.]+$/, '') // remove file extension
    const artistName = song.artist !== '未知艺术家' ? song.artist : ''
    const albumName = song.album !== '本地音乐' ? song.album : ''
    
    searchLyrics(trackName, artistName, albumName, song.duration).then((result) => {
      if (result?.syncedLyrics) {
        const lines = parseSyncedLyrics(result.syncedLyrics)
        set({ lyrics: lines, lyricsLoading: false })
      } else if (result?.plainLyrics) {
        // No timestamps, split by lines
        const lines = result.plainLyrics.split('\n').filter(l => l.trim()).map((text, i) => ({
          time: i * 3, // estimate 3 seconds per line
          text: text.trim(),
        }))
        set({ lyrics: lines, lyricsLoading: false })
      } else {
        set({ lyricsLoading: false })
      }
    }).catch(() => {
      set({ lyricsLoading: false })
    })
  },
  
  loadFromDB: async () => {
    try {
      const stored = await getAllAudioFiles()
      const songs: Song[] = stored.map(s => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        cover: '',
        duration: s.duration,
        url: URL.createObjectURL(s.file),
        source: 'local' as const,
      }))
      set({
        localSongs: songs,
        dbLoading: false,
        playlists: [{
          id: 'all',
          name: '全部音乐',
          cover: '',
          songs,
          source: 'local',
        }],
        queue: songs,
        currentSong: songs[0] || null,
      })
    } catch {
      set({ dbLoading: false })
    }
  },
}))
