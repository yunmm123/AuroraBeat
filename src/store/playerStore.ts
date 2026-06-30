import { create } from 'zustand'
import type { Song, Playlist, PlayMode, AudioFeatures, VisualEffectType, Theme } from '@/types'
import { themes } from '@/utils/themes'
import { getAllAudioFiles, saveAudioFile, deleteAudioFile, type StoredAudio } from '@/utils/audioDB'
import { searchLyricsFromUfanv, parseLrc, parseSongFilename, type LyricLine } from '@/services/lyricsApi'
import { kugouSearchLyric, kugouGetLyricById } from '@/services/kugouApi'

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
  
  // KuGou Music
  showKugou: boolean
  kugouUserInfo: { uid: string; token: string; nickname: string } | null
  
  // Netease Music
  showNetease: boolean
  
  // Recent play history
  recentSongs: Song[]
  
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
  playSong: (song: Song, queue?: Song[]) => void
  addToRecent: (song: Song) => void
  refreshLyrics: () => void
  loadFromDB: () => Promise<void>
  
  // KuGou Music actions
  toggleKugou: () => void
  setKugouUserInfo: (info: { uid: string; token: string; nickname: string } | null) => void
  
  // Netease Music actions
  toggleNetease: () => void
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

function calcSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const sa = a.toLowerCase().trim()
  const sb = b.toLowerCase().trim()
  if (sa === sb) return 1
  let matches = 0
  for (const ch of sa) {
    if (sb.includes(ch)) matches++
  }
  return matches / Math.max(sa.length, sb.length)
}

function pickBestLyricCandidate(
  candidates: any[],
  trackName: string,
  artistName: string,
  duration?: number
): any | null {
  if (!candidates || candidates.length === 0) return null
  
  const targetName = trackName.toLowerCase().trim()
  const targetArtist = artistName.toLowerCase().trim()
  
  let best = candidates[0]
  let bestScore = -1
  
  for (const c of candidates) {
    const cName = (c.song || c.songname || c.name || '').toLowerCase().trim()
    const cArtist = (c.singer || c.artist || c.author_name || '').toLowerCase().trim()
    const cDuration = c.duration || c.timelength || 0
    
    let score = 0
    score += calcSimilarity(targetName, cName) * 0.5
    if (targetArtist && cArtist) {
      score += calcSimilarity(targetArtist, cArtist) * 0.3
    }
    if (duration && cDuration) {
      const durDiff = Math.abs(duration - Math.floor(cDuration / 1000))
      if (durDiff <= 5) score += 0.2
      else if (durDiff <= 10) score += 0.1
    }
    
    if (targetName && cName.includes(targetName)) score += 0.1
    if (targetArtist && cArtist.includes(targetArtist)) score += 0.1
    
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  
  return best
}

function isPureMusic(trackName: string, artistName: string): boolean {
  const combined = `${trackName} ${artistName}`.toLowerCase()
  const keywords = ['纯音乐', 'instrumental', 'inst.', 'pure music', '轻音乐', '钢琴曲', '纯享版', '无歌词', '伴奏', 'beat']
  return keywords.some(k => combined.includes(k))
}

// Resolve the actual play URL for cloud songs. Returns the URL string or empty string.
// Used by nextSong/prevSong to resolve URL before setting state.
async function resolveSongUrlSync(song: Song): Promise<string> {
  if (song.source === 'kugou') {
    const hash = (song as any).hash
    const albumId = (song as any).albumId
    const albumAudioId = (song as any).albumAudioId
    if (hash) {
      try {
        const urlRes = await window.electronAPI?.kugou?.invoke('kg:songUrl', hash, albumId, albumAudioId)
        let playUrl = ''
        if (urlRes?.play_url) playUrl = urlRes.play_url
        else if (urlRes?.data?.play_url) playUrl = urlRes.data.play_url
        else if (Array.isArray(urlRes?.url) && urlRes.url.length > 0) playUrl = urlRes.url[0]
        if (playUrl) return playUrl
      } catch (e) {
        console.error('Failed to resolve kugou song URL:', e)
      }
    }
  }
  if (song.source === 'netease') {
    try {
      const urlRes = await window.electronAPI?.netease?.songUrl(song.id, song.quality || 'standard')
      if (urlRes?.ok && urlRes.url) return urlRes.url
    } catch (e) {
      console.error('Failed to resolve netease song URL:', e)
    }
  }
  return ''
}

async function loadLyricsForSong(trackName: string, artistName: string, duration?: number, hash?: string) {
  if (isPureMusic(trackName, artistName)) {
    usePlayerStore.setState({ 
      lyrics: [{ time: 0, text: '♪ 纯音乐 ♪' }], 
      lyricsLoading: false 
    })
    return
  }
  
  const keyword = artistName ? `${trackName} ${artistName}` : trackName
  
  try {
    const ufanvText = await searchLyricsFromUfanv(trackName, artistName)
    if (ufanvText) {
      const lines = parseLrc(ufanvText)
      if (lines.length > 0) {
        usePlayerStore.setState({ lyrics: lines, lyricsLoading: false })
        return
      }
    }
  } catch {
    // ufanv failed, try kugou
  }
  
  try {
    const searchRes = await kugouSearchLyric(keyword, duration, hash)
    const candidates = searchRes?.candidates || searchRes?.data?.candidates || []
    if (candidates.length > 0) {
      const best = pickBestLyricCandidate(candidates, trackName, artistName, duration)
      if (best?.id && best?.accesskey) {
        const lyricRes = await kugouGetLyricById(String(best.id), best.accesskey)
        const lrcContent = lyricRes?.decodeContent || lyricRes?.data?.decodeContent || ''
        if (lrcContent) {
          const lines = parseLrc(lrcContent)
          if (lines.length > 0) {
            usePlayerStore.setState({ lyrics: lines, lyricsLoading: false })
            return
          }
        }
      }
    }
  } catch {
    // kugou failed too
  }
  
  // Try netease lyric if we have netease song id
  if ((window as any).currentNeteaseSongId) {
    try {
      const neteaseLyric = await window.electronAPI?.netease?.lyric((window as any).currentNeteaseSongId)
      if (neteaseLyric?.ok && neteaseLyric.lrc) {
        const lines = parseLrc(neteaseLyric.lrc)
        if (lines.length > 0) {
          usePlayerStore.setState({ lyrics: lines, lyricsLoading: false })
          return
        }
      }
    } catch {
      // ignore
    }
  }
  
  usePlayerStore.setState({ lyrics: [], lyricsLoading: false })
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
  
  // KuGou Music
  showKugou: false,
  kugouUserInfo: null,
  
  // Netease Music
  showNetease: false,
  
  // Recent play history
  recentSongs: [],
  
  setCurrentSong: (song) => set({ currentSong: song }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  togglePlay: () => set({ isPlaying: !get().isPlaying }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
  toggleMute: () => set({ isMuted: !get().isMuted }),
  setPlayMode: (mode) => set({ playMode: mode }),
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  nextSong: async () => {
    const { queue, queueIndex, playMode } = get()
    if (queue.length === 0) return
    let nextIndex = queueIndex
    if (playMode === 'shuffle') {
      nextIndex = Math.floor(Math.random() * queue.length)
    } else if (playMode === 'single') {
      set({ currentTime: 0 })
      return
    } else {
      nextIndex = (queueIndex + 1) % queue.length
    }
    let nextSong = queue[nextIndex]
    
    // Resolve URL before setting state to avoid race conditions
    if (!nextSong.url && (nextSong.source === 'kugou' || nextSong.source === 'netease')) {
      const resolvedUrl = await resolveSongUrlSync(nextSong)
      if (resolvedUrl) {
        nextSong = { ...nextSong, url: resolvedUrl }
        const updatedQueue = [...queue]
        updatedQueue[nextIndex] = nextSong
        set({ queue: updatedQueue })
      }
    }
    
    set({ queueIndex: nextIndex, currentSong: nextSong, isPlaying: true, currentTime: 0, lyrics: [], lyricsLoading: true })
    
    const trackName = nextSong.title.replace(/\.[^.]+$/, '')
    const artistName = nextSong.artist !== '未知艺术家' ? nextSong.artist : ''
    const songHash = (nextSong as any).hash || ''
    loadLyricsForSong(trackName, artistName, nextSong.duration, songHash)
  },
  prevSong: async () => {
    const { queue, queueIndex } = get()
    if (queue.length === 0) return
    const prevIndex = queueIndex === 0 ? queue.length - 1 : queueIndex - 1
    let prevSong = queue[prevIndex]
    
    // Resolve URL before setting state to avoid race conditions
    if (!prevSong.url && (prevSong.source === 'kugou' || prevSong.source === 'netease')) {
      const resolvedUrl = await resolveSongUrlSync(prevSong)
      if (resolvedUrl) {
        prevSong = { ...prevSong, url: resolvedUrl }
        const updatedQueue = [...queue]
        updatedQueue[prevIndex] = prevSong
        set({ queue: updatedQueue })
      }
    }
    
    set({ queueIndex: prevIndex, currentSong: prevSong, isPlaying: true, currentTime: 0, lyrics: [], lyricsLoading: true })
    
    const trackName = prevSong.title.replace(/\.[^.]+$/, '')
    const artistName = prevSong.artist !== '未知艺术家' ? prevSong.artist : ''
    const songHash = (prevSong as any).hash || ''
    loadLyricsForSong(trackName, artistName, prevSong.duration, songHash)
  },
  setQueue: (songs, startIndex = 0) => set({ 
    queue: songs, 
    queueIndex: startIndex,
    currentSong: songs[startIndex] || null,
    currentTime: 0,
  }),
  
  setPlaylists: (playlists) => set({ playlists }),
  setCurrentPlaylist: (playlist) => {
    const current = get().currentPlaylist
    // Toggle: clicking same playlist again closes it
    if (current?.id === playlist?.id) {
      set({ currentPlaylist: null })
    } else {
      set({ currentPlaylist: playlist, activeCategory: null })
    }
  },
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
  
  playSong: (song, queue) => {
    const { addToRecent } = get()
    addToRecent(song)
    
    let newQueue: Song[] = []
    let newIndex = 0
    
    if (queue && queue.length > 0) {
      newQueue = queue
      newIndex = Math.max(0, queue.findIndex(s => s.id === song.id))
      if (newIndex === -1) newIndex = 0
      // Update the current song's URL in the queue if it has one
      if (song.url && newQueue[newIndex] && !newQueue[newIndex].url) {
        newQueue[newIndex] = { ...newQueue[newIndex], url: song.url }
      }
    } else {
      newQueue = [song]
      newIndex = 0
    }
    
    set({ 
      queue: newQueue,
      queueIndex: newIndex,
      currentSong: song, 
      isPlaying: true, 
      currentTime: 0, 
      lyrics: [], 
      lyricsLoading: true 
    })
    
    const trackName = song.title.replace(/\.[^.]+$/, '')
    const artistName = song.artist !== '未知艺术家' ? song.artist : ''
    const songHash = (song as any).hash || ''
    
    // Store netease song id for lyric fallback
    if (song.source === 'netease') {
      (window as any).currentNeteaseSongId = song.id
    } else {
      (window as any).currentNeteaseSongId = undefined
    }
    
    loadLyricsForSong(trackName, artistName, song.duration, songHash)
  },
  
  addToRecent: (song) => {
    const { recentSongs } = get()
    const filtered = recentSongs.filter(s => s.id !== song.id)
    const newRecent = [song, ...filtered].slice(0, 100)
    set({ recentSongs: newRecent })
  },
  
  refreshLyrics: () => {
    const { currentSong } = get()
    if (!currentSong) return
    
    set({ lyrics: [], lyricsLoading: true })
    
    const trackName = currentSong.title.replace(/\.[^.]+$/, '')
    const artistName = currentSong.artist !== '未知艺术家' ? currentSong.artist : ''
    const songHash = (currentSong as any).hash || ''
    
    loadLyricsForSong(trackName, artistName, currentSong.duration, songHash)
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
  
  // KuGou Music actions
  toggleKugou: () => set({ showKugou: !get().showKugou }),
  setKugouUserInfo: (info) => set({ kugouUserInfo: info }),
  
  // Netease Music actions
  toggleNetease: () => set({ showNetease: !get().showNetease }),
}))
