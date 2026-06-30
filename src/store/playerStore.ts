import { create } from 'zustand'
import type { Song, Playlist, PlayMode, AudioFeatures, VisualEffectType, Theme } from '@/types'
import { themes } from '@/utils/themes'
import { getAllAudioFiles, saveAudioFile, deleteAudioFile, type StoredAudio } from '@/utils/audioDB'
import { searchLyricsFromUfanv, parseLrc, type LyricLine } from '@/services/lyricsApi'
import { kugouSearchLyric, kugouGetLyricById } from '@/services/kugouApi'

// Global audio controller - set by App.tsx on mount
let audioController: {
  play: () => void
  pause: () => void
  loadSong: (url: string, autoplay: boolean) => void
} | null = null

export function setAudioController(ctrl: typeof audioController) {
  audioController = ctrl
}

interface PlayerState {
  currentSong: Song | null
  isPlaying: boolean
  isLoading: boolean
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
  
  // Actions - these are called by UI and control audio through the controller
  setCurrentSong: (song: Song | null) => void
  setIsPlaying: (playing: boolean) => void  // Only called by audio event handlers
  setIsLoading: (loading: boolean) => void
  togglePlay: () => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setPlayMode: (mode: PlayMode) => void
  setPlaybackRate: (rate: number) => void
  nextSong: () => void
  prevSong: () => void
  setQueue: (songs: Song[], startIndex?: number, autoplay?: boolean) => void
  
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
  playSongAtIndex: (index: number) => void
  addToRecent: (song: Song) => void
  refreshLyrics: () => void
  loadFromDB: () => Promise<void>
  
  // KuGou Music actions
  toggleKugou: () => void
  setKugouUserInfo: (info: { uid: string; token: string; nickname: string } | null) => void
  
  // Netease Music actions
  toggleNetease: () => void
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

// Resolve the actual play URL for cloud songs
async function resolveSongUrl(song: Song): Promise<string> {
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

// Update song URL in queue and currentSong after async resolution
function updateSongUrl(songId: string, url: string) {
  const state = usePlayerStore.getState()
  const updatedQueue = [...state.queue]
  let foundIndex = -1
  for (let i = 0; i < updatedQueue.length; i++) {
    if (updatedQueue[i].id === songId) {
      updatedQueue[i] = { ...updatedQueue[i], url }
      foundIndex = i
      break
    }
  }
  const isCurrent = state.currentSong?.id === songId
  const updatedCurrent = isCurrent && state.currentSong ? { ...state.currentSong, url } : state.currentSong
  
  usePlayerStore.setState({
    queue: updatedQueue,
    currentSong: updatedCurrent,
  })
  
  // If this is the current song and audio controller exists, load it
  if (isCurrent && audioController && url) {
    audioController.loadSong(url, true)
  }
}

async function loadLyricsForSong(trackName: string, artistName: string, duration?: number, hash?: string, songId?: string, source?: string) {
  if (isPureMusic(trackName, artistName)) {
    usePlayerStore.setState({ 
      lyrics: [{ time: 0, text: '♪ 纯音乐 ♪' }], 
      lyricsLoading: false 
    })
    return
  }
  
  const keyword = artistName ? `${trackName} ${artistName}` : trackName
  
  // Try netease lyric first if it's a netease song
  if (source === 'netease' && songId) {
    try {
      const neteaseLyric = await window.electronAPI?.netease?.lyric(songId)
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
    // ufanv failed
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
    // kugou failed
  }
  
  // Fallback: try netease even for non-netease songs
  if (source !== 'netease' && (window as any).currentNeteaseSongId) {
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

// Switch to a song - sets state and initiates loading
function switchToSong(song: Song, queue: Song[], index: number) {
  const { addToRecent } = usePlayerStore.getState()
  addToRecent(song)
  
  // Store netease song id for lyric fallback
  if (song.source === 'netease') {
    (window as any).currentNeteaseSongId = song.id
  } else {
    (window as any).currentNeteaseSongId = undefined
  }
  
  // Update queue with current song's URL if available
  let newQueue = [...queue]
  if (song.url && newQueue[index] && !newQueue[index].url) {
    newQueue[index] = { ...newQueue[index], url: song.url }
  }
  
  // Set state - but DON'T set isPlaying directly! Let audio events handle it.
  usePlayerStore.setState({
    queue: newQueue,
    queueIndex: index,
    currentSong: song,
    isLoading: true,
    currentTime: 0,
    duration: 0,
    lyrics: [],
    lyricsLoading: true,
  })
  
  // Load lyrics
  const trackName = song.title.replace(/\.[^.]+$/, '')
  const artistName = song.artist !== '未知艺术家' ? song.artist : ''
  const songHash = (song as any).hash || ''
  loadLyricsForSong(trackName, artistName, song.duration, songHash, song.id, song.source)
  
  // Load and play the song
  if (song.url) {
    audioController?.loadSong(song.url, true)
  } else if (song.source === 'kugou' || song.source === 'netease') {
    // Need to resolve URL first
    resolveSongUrl(song).then(url => {
      if (url) {
        // Verify we're still on the same song
        const currentId = usePlayerStore.getState().currentSong?.id
        if (currentId === song.id) {
          updateSongUrl(song.id, url)
        }
      } else {
        usePlayerStore.setState({ isLoading: false })
      }
    }).catch(() => {
      usePlayerStore.setState({ isLoading: false })
    })
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: null,
  isPlaying: false,
  isLoading: false,
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
  
  showLyrics: true,
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
  
  lyrics: [],
  lyricsLoading: false,
  
  showKugou: false,
  kugouUserInfo: null,
  
  showNetease: false,
  
  recentSongs: [],
  
  // These setters are called by AUDIO EVENT HANDLERS ONLY
  setCurrentSong: (song) => set({ currentSong: song }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  
  togglePlay: () => {
    const { isPlaying, currentSong } = get()
    if (!currentSong?.url) return
    if (audioController) {
      if (isPlaying) {
        audioController.pause()
      } else {
        audioController.play()
      }
    }
  },
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
      audioController?.loadSong(get().currentSong?.url || '', true)
      return
    } else {
      nextIndex = (queueIndex + 1) % queue.length
    }
    switchToSong(queue[nextIndex], queue, nextIndex)
  },
  
  prevSong: () => {
    const { queue, queueIndex } = get()
    if (queue.length === 0) return
    const prevIndex = queueIndex === 0 ? queue.length - 1 : queueIndex - 1
    switchToSong(queue[prevIndex], queue, prevIndex)
  },
  
  setQueue: (songs, startIndex = 0, autoplay = false) => {
    set({ 
      queue: songs, 
      queueIndex: startIndex,
      currentSong: songs[startIndex] || null,
      currentTime: 0,
    })
    if (autoplay && songs[startIndex]) {
      switchToSong(songs[startIndex], songs, startIndex)
    }
  },
  
  setPlaylists: (playlists) => set({ playlists }),
  setCurrentPlaylist: (playlist) => {
    const current = get().currentPlaylist
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
    })
    // Auto-set queue and play first added song if nothing was playing
    if (state.queue.length === 0 && newSongs.length > 0) {
      set({
        queue: newSongs,
        currentSong: newSongs[0],
        queueIndex: 0,
      })
    }
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
    let newQueue: Song[] = []
    let newIndex = 0
    
    if (queue && queue.length > 0) {
      newQueue = queue
      newIndex = Math.max(0, queue.findIndex(s => s.id === song.id))
      if (newIndex === -1) newIndex = 0
    } else {
      newQueue = [song]
      newIndex = 0
    }
    
    switchToSong(song, newQueue, newIndex)
  },
  
  playSongAtIndex: (index) => {
    const { queue } = get()
    if (index < 0 || index >= queue.length) return
    switchToSong(queue[index], queue, index)
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
    
    loadLyricsForSong(trackName, artistName, currentSong.duration, songHash, currentSong.id, currentSong.source)
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
  
  toggleKugou: () => set({ showKugou: !get().showKugou }),
  setKugouUserInfo: (info) => set({ kugouUserInfo: info }),
  
  toggleNetease: () => set({ showNetease: !get().showNetease }),
}))
