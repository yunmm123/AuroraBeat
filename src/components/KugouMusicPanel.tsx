import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Play, Music, User, ListMusic, Radio,
  Disc3, ChevronRight, ChevronLeft, Loader2, LogIn, Heart,
  TrendingUp, Headphones, X, AlertCircle, RefreshCw
} from 'lucide-react'
import {
  kugouSearch, kugouSongUrl, kugouSearchHot,
  kugouTopSong,
  kugouRecommendSongs, kugouUserPlaylist,
  kugouPlaylistTrackAllNew
} from '@/services/kugouApi'
import type { Song } from '@/types'

interface KugouMusicPanelProps {
  onClose: () => void
  onPlaySong: (song: Song, queue?: Song[]) => void
  userInfo: { uid: string; token: string; nickname: string } | null
  onLoginClick: () => void
  onLogout: () => void
}

interface KugouSongItem {
  Hash: string
  SongName: string
  SingerName: string
  AlbumName?: string
  AlbumID?: string
  AlbumAudioID?: string
  Duration?: number
}

function normalizePlaylist(raw: any): { id: string; name: string; songCount: number; intro?: string; cover?: string } {
  const id = String(raw.id || raw.specialid || raw.rankid || raw.listid || raw.global_collection_id || '')
  const name = raw.specialname || raw.playlist_name || raw.playlistname || raw.rankname ||
    raw.title || raw.name || raw.list_name || ''
  const songCount = Number(raw.songcount || raw.song_count || raw.play_count || raw.count ||
    raw.song_num || raw.total || raw.songlist_size || 0)
  const intro = raw.intro || raw.desc || raw.description || ''
  const cover = raw.imgurl || raw.cover || raw.pic || raw.album_img_9 || raw.img_9 || ''
  return { id, name, songCount, intro, cover }
}

function extractPlaylistList(body: any): any[] {
  const d = body?.data
  if (!d) return []
  if (Array.isArray(d.info)) return d.info
  if (Array.isArray(d.list)) return d.list
  if (Array.isArray(d.entries)) return d.entries
  if (Array.isArray(d.special_list)) return d.special_list
  if (Array.isArray(d.theme_list)) return d.theme_list
  if (Array.isArray(d)) return d
  // try data.data
  if (Array.isArray(d.data)) return d.data
  if (d.data && Array.isArray(d.data.info)) return d.data.info
  if (d.data && Array.isArray(d.data.list)) return d.data.list
  return []
}

function extractSongList(body: any): any[] {
  const d = body?.data
  if (!d) return []
  
  if (Array.isArray(d)) return d
  if (Array.isArray(d.lists)) return d.lists
  if (Array.isArray(d.songlist)) return d.songlist
  if (Array.isArray(d.song_list)) return d.song_list
  if (Array.isArray(d.list)) return d.list
  if (Array.isArray(d.info)) return d.info
  if (d.audios && Array.isArray(d.audios)) return d.audios
  if (d.songs && Array.isArray(d.songs)) return d.songs
  if (d.rank_songs && Array.isArray(d.rank_songs)) return d.rank_songs
  if (d.rank_audio && Array.isArray(d.rank_audio)) return d.rank_audio
  
  const keys = Object.keys(d)
  if (keys.length > 0 && keys.every(k => !isNaN(Number(k)))) {
    const arr: any[] = []
    for (const k of keys) {
      if (d[k] && typeof d[k] === 'object') {
        arr.push(d[k])
      }
    }
    if (arr.length > 0) return arr
  }
  
  if (d.data) {
    if (Array.isArray(d.data)) return d.data
    if (Array.isArray(d.data.lists)) return d.data.lists
    if (Array.isArray(d.data.songlist)) return d.data.songlist
    if (Array.isArray(d.data.list)) return d.data.list
  }
  
  return []
}

function normalizeSong(raw: any): KugouSongItem {
  const audioInfo = raw.audio_info || raw.audioInfo || raw.audioInfo || {}
  
  let hash = ''
  if (audioInfo.hash_128) hash = audioInfo.hash_128
  else if (audioInfo.hash) hash = audioInfo.hash
  else if (raw.Hash) hash = raw.Hash
  else if (raw.hash) hash = raw.hash
  else if (raw.hash_128) hash = raw.hash_128
  else if (raw.SQFileHash) hash = raw.SQFileHash
  else if (raw.sqfilehash) hash = raw.sqfilehash
  else if (raw.FileHash) hash = raw.FileHash
  else if (raw.filehash) hash = raw.filehash
  else if (raw.HQFileHash) hash = raw.HQFileHash
  else if (raw.hqfilehash) hash = raw.hqfilehash
  // For search_complex results, hash might be in a nested structure
  if (!hash && raw.songData) {
    hash = raw.songData.Hash || raw.songData.hash || raw.songData.hash_128 || ''
  }
  if (!hash && raw.trans_param?.hash) hash = raw.trans_param.hash
  
  const songName = raw.SongName || raw.songname || raw.song_name || raw.name || 
    raw.filename || raw.title || audioInfo.songname || ''
  
  const singer = raw.SingerName || raw.singername || raw.author_name || raw.artist || raw.singer ||
    (raw.authors?.[0]?.author_name) || raw.artists?.[0]?.name || 
    raw.show_author_name || ''
  
  const albumName = raw.AlbumName || raw.album_name || raw.albumname || raw.album || 
    raw.album_info?.album_name || ''
  
  const albumId = String(raw.AlbumID || raw.album_id || raw.albumid || 
    raw.album_audio_id || raw.album_info?.album_id || '')
  
  const albumAudioId = String(raw.album_audio_id || raw.albumAudioId || 
    raw.album_info?.album_audio_id || '')
  
  let duration = raw.Duration || raw.duration || raw.timelength || raw.length || 0
  if (!duration && audioInfo.duration_128) duration = Math.floor(audioInfo.duration_128 / 1000)
  if (!duration && audioInfo.duration) duration = Math.floor(audioInfo.duration / 1000)
  
  return {
    Hash: String(hash),
    SongName: songName,
    SingerName: singer,
    AlbumName: albumName,
    AlbumID: albumId,
    AlbumAudioID: albumAudioId,
    Duration: duration,
  }
}

export default function KugouMusicPanel({
  onClose, onPlaySong, userInfo, onLoginClick, onLogout
}: KugouMusicPanelProps) {
  const [activeTab, setActiveTab] = useState<'discover' | 'user'>('discover')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KugouSongItem[]>([])
  const [hotKeywords, setHotKeywords] = useState<string[]>([])
  const [topSongs, setTopSongs] = useState<KugouSongItem[]>([])
  const [recommendSongs, setRecommendSongs] = useState<KugouSongItem[]>([])
  const [userPlaylists, setUserPlaylists] = useState<any[]>([])
  const [playlistTracks, setPlaylistTracks] = useState<KugouSongItem[]>([])
  const [currentPlaylistName, setCurrentPlaylistName] = useState('')
  const [loading, setLoading] = useState(false)
  const [playingHash, setPlayingHash] = useState('')
  const [apiError, setApiError] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('')
  const [selectedPlaylistName, setSelectedPlaylistName] = useState('')
  const [playlistPage, setPlaylistPage] = useState(1)
  const [playlistHasMore, setPlaylistHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [playErrorMsg, setPlayErrorMsg] = useState('')

  useEffect(() => {
    loadDiscoverData()
  }, [])

  async function handleRefreshDiscover() {
    await loadDiscoverData()
  }

  useEffect(() => {
    if (activeTab === 'user' && userInfo) {
      loadUserPlaylists()
    }
  }, [activeTab, userInfo])

  async function loadDiscoverData() {
    setLoading(true)
    setApiError(false)
    try {
      const [hotRes, topRes, recommendRes] = await Promise.allSettled([
        kugouSearchHot(),
        kugouTopSong(),
        kugouRecommendSongs(),
      ])

      let anySuccess = false

      // Hot search keywords — structure: data.list[].keywords[].keyword
      if (hotRes.status === 'fulfilled') {
        const list = hotRes.value?.data?.list || []
        const tab = list[0] || {}
        const keywords = (tab.keywords || []).map((k: any) => k.keyword || k.word || '').filter(Boolean)
        if (keywords.length > 0) {
          setHotKeywords(keywords.slice(0, 10))
          anySuccess = true
        }
      }
      // Top/new songs — structure: data is a direct array (data[0].songname)
      if (topRes.status === 'fulfilled') {
        const rawList = extractSongList(topRes.value)
        if (rawList.length > 0) {
          setTopSongs(rawList.map(normalizeSong).slice(0, 20))
          anySuccess = true
        }
      }
      // Recommend songs — structure: data.song_list[]
      if (recommendRes.status === 'fulfilled') {
        const songList = extractSongList(recommendRes.value)
        if (songList.length > 0) {
          setRecommendSongs(songList.map(normalizeSong).slice(0, 20))
          anySuccess = true
        }
      }

      if (!anySuccess) {
        setApiError(true)
      }
    } catch {
      setApiError(true)
    }
    setLoading(false)
  }

  async function loadUserPlaylists() {
    if (!userInfo) return
    setLoading(true)
    try {
      const res = await kugouUserPlaylist(userInfo.uid, userInfo.token)
      const rawList = extractPlaylistList(res)
      // Keep raw objects for handleOpenPlaylist, but normalize for display
      setUserPlaylists(rawList)
    } catch {
      // ignore
    }
    setLoading(false)
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return
    setLoading(true)
    setSearchError(false)
    setSearchResults([])
    try {
      const res = await kugouSearch(searchQuery.trim())
      let rawList = extractSongList(res)
      if (rawList.length === 0) {
        // If primary search gave no results, try complex search
        const complexRes = await window.electronAPI?.kugou?.invoke('kg:searchComplex', searchQuery.trim())
        if (complexRes) {
          rawList = extractSongList(complexRes)
          // For complex search, songs are often in data.lists[].info
          if (rawList.length === 0 && complexRes?.data?.lists && Array.isArray(complexRes.data.lists)) {
            rawList = []
            for (const list of complexRes.data.lists) {
              if (Array.isArray(list.info)) {
                rawList.push(...list.info)
              }
            }
          }
        }
      }
      setSearchResults(rawList.map(normalizeSong))
      // Only show error if we really got zero results after both attempts
      if (rawList.length === 0) {
        setSearchError(true)
      }
    } catch {
      setSearchError(true)
    }
    setLoading(false)
  }

  async function handlePlayHotKeyword(keyword: string) {
    setSearchQuery(keyword)
    setLoading(true)
    setSearchError(false)
    setSearchResults([])
    try {
      const res = await kugouSearch(keyword)
      let rawList = extractSongList(res)
      if (rawList.length === 0) {
        const complexRes = await window.electronAPI?.kugou?.invoke('kg:searchComplex', keyword)
        if (complexRes) {
          rawList = extractSongList(complexRes)
          if (rawList.length === 0 && complexRes?.data?.lists && Array.isArray(complexRes.data.lists)) {
            rawList = []
            for (const list of complexRes.data.lists) {
              if (Array.isArray(list.info)) {
                rawList.push(...list.info)
              }
            }
          }
        }
      }
      setSearchResults(rawList.map(normalizeSong))
      if (rawList.length === 0) {
        setSearchError(true)
      }
    } catch {
      setSearchError(true)
    }
    setLoading(false)
  }

  async function handlePlaySong(song: KugouSongItem) {
    if (!song.Hash) {
      setPlayErrorMsg('歌曲信息不完整，无法播放')
      setTimeout(() => setPlayErrorMsg(''), 3000)
      return
    }
    setPlayingHash(song.Hash)
    setPlayErrorMsg('')
    try {
      const urlRes = await kugouSongUrl(
        song.Hash,
        song.AlbumID,
        song.AlbumAudioID,
        userInfo?.uid,
        userInfo?.token
      )
      let playUrl = ''
      if (urlRes?.play_url) {
        playUrl = urlRes.play_url
      } else if (urlRes?.data?.play_url) {
        playUrl = urlRes.data.play_url
      } else if (Array.isArray(urlRes?.url) && urlRes.url.length > 0) {
        playUrl = urlRes.url[0]
      } else if (Array.isArray(urlRes?.backupUrl) && urlRes.backupUrl.length > 0) {
        playUrl = urlRes.backupUrl[0]
      }
      
      if (playUrl) {
        const kugouSong: Song = {
          id: song.Hash,
          title: song.SongName,
          artist: song.SingerName,
          album: song.AlbumName || '酷狗音乐',
          duration: song.Duration || 0,
          url: playUrl,
          cover: '',
          source: 'kugou' as const,
          hash: song.Hash,
          albumId: song.AlbumID,
          albumAudioId: song.AlbumAudioID,
        }
        
        // 根据当前上下文构建播放队列
        let queue: Song[] = []
        if (selectedPlaylistId) {
          queue = playlistTracks.map(s => normalizeToSong(s))
        } else if (searchResults.length > 0) {
          queue = searchResults.map(s => normalizeToSong(s))
        } else if (topSongs.length > 0 && topSongs.some(s => s.Hash === song.Hash)) {
          // Playing from "新歌速递" section
          queue = topSongs.map(s => normalizeToSong(s))
        } else if (recommendSongs.length > 0 && recommendSongs.some(s => s.Hash === song.Hash)) {
          // Playing from "每日推荐" section
          queue = recommendSongs.map(s => normalizeToSong(s))
        }
        
        onPlaySong(kugouSong, queue.length > 0 ? queue : undefined)
        onClose()
      } else {
        const isPay = urlRes?.priv_status === 0 || 
          (Array.isArray(urlRes?.fail_process) && urlRes.fail_process.length > 0) ||
          urlRes?.errcode === 20028
        console.warn('No play URL found for song:', song.SongName, isPay ? '(付费/VIP)' : '', urlRes)
        setPlayErrorMsg(isPay ? '该歌曲为付费歌曲，暂不支持播放' : '无法获取播放地址，请稍后重试')
        setTimeout(() => setPlayErrorMsg(''), 3000)
      }
    } catch (e) {
      console.error('Failed to get song URL:', e)
      setPlayErrorMsg('播放失败，请检查网络连接')
      setTimeout(() => setPlayErrorMsg(''), 3000)
    } finally {
      setPlayingHash('')
    }
  }

  async function handleOpenPlaylist(playlist: any) {
    setLoading(true)
    const n = normalizePlaylist(playlist)
    const listId = String(playlist.listid || playlist.specialid || playlist.id || n.id || '')
    setSelectedPlaylistId(listId)
    setSelectedPlaylistName(n.name || '歌单')
    setPlaylistTracks([])
    setPlaylistPage(1)
    setPlaylistHasMore(false) // Load all at once, disable pagination
    try {
      const uid = userInfo?.uid
      const token = userInfo?.token
      // Load all tracks at once with a large page size
      const res = await kugouPlaylistTrackAllNew(listId, 1, uid, token, 500)
      const rawList = extractSongList(res)
      setPlaylistTracks(rawList.map(normalizeSong))
    } catch {
      // ignore
    }
    setLoading(false)
  }

  function handlePlaylistBack() {
    setSelectedPlaylistId('')
    setSelectedPlaylistName('')
    setPlaylistTracks([])
    setPlaylistPage(1)
    setPlaylistHasMore(true)
  }
  
  async function loadMorePlaylistSongs() {
    if (!selectedPlaylistId || !playlistHasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const nextPage = playlistPage + 1
      const uid = userInfo?.uid
      const token = userInfo?.token
      const res = await kugouPlaylistTrackAllNew(selectedPlaylistId, nextPage, uid, token)
      const rawList = extractSongList(res)
      if (rawList.length > 0) {
        setPlaylistTracks(prev => [...prev, ...rawList.map(normalizeSong)])
        setPlaylistPage(nextPage)
      }
      if (rawList.length < 30) setPlaylistHasMore(false)
    } catch {
      // ignore
    }
    setLoadingMore(false)
  }

  function normalizeToSong(song: KugouSongItem): Song {
    return {
      id: song.Hash,
      title: song.SongName,
      artist: song.SingerName,
      album: song.AlbumName || '酷狗音乐',
      duration: song.Duration || 0,
      url: '', // URL will be resolved when played
      cover: '',
      source: 'kugou' as const,
      hash: song.Hash,
      albumId: song.AlbumID,
      albumAudioId: song.AlbumAudioID,
    }
  }

  function formatDuration(seconds: number): string {
    if (!seconds) return '--:--'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const tabs = [
    { id: 'discover' as const, label: '发现', icon: Disc3 },
    { id: 'user' as const, label: '我的', icon: User },
  ]

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(16px)' }}>
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-[90vw] max-w-[1200px] h-[80vh] rounded-2xl overflow-hidden flex flex-col relative"
        style={{
          background: 'linear-gradient(145deg, rgba(26,26,46,0.97) 0%, rgba(22,33,62,0.98) 40%, rgba(15,15,35,0.99) 100%)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.7), 0 0 150px rgba(139,92,246,0.12), 0 0 60px rgba(99,102,241,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {/* Ambient glow decorations */}
        <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full blur-3xl opacity-25 pointer-events-none animate-pulse" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.5), transparent 70%)', animationDuration: '4s' }} />
        <div className="absolute top-1/3 -right-16 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none animate-pulse" style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.4), transparent 70%)', animationDuration: '5s', animationDelay: '1s' }} />
        <div className="absolute -bottom-16 left-1/4 w-56 h-56 rounded-full blur-3xl opacity-15 pointer-events-none animate-pulse" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.4), transparent 70%)', animationDuration: '6s', animationDelay: '2s' }} />
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 relative z-10" style={{ background: 'linear-gradient(180deg, rgba(139,92,246,0.18), rgba(99,102,241,0.06), rgba(15,15,30,0))', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1, #a855f7)', boxShadow: '0 4px 25px rgba(139,92,246,0.5), 0 0 40px rgba(99,102,241,0.2)' }}>
              <Music size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg tracking-tight">酷狗音乐</h2>
              <p className="text-white/40 text-xs">海量音乐，随心畅听</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {userInfo ? (
              <div className="flex items-center gap-3 rounded-xl px-4 py-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #a855f7, #ec4899)' }}>
                  <User size={16} className="text-white" />
                </div>
                <span className="text-white text-sm font-medium">{userInfo.nickname}</span>
                <button onClick={onLogout} className="px-3 py-1 rounded-lg text-white/60 hover:text-white text-xs transition-colors hover:bg-white/10">退出</button>
              </div>
            ) : (
              <button onClick={onLoginClick} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7)', boxShadow: '0 4px 20px rgba(139,92,246,0.45)' }}>
                <LogIn size={16} />
                <span>扫码登录</span>
              </button>
            )}
            <button onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/60 hover:text-white transition-colors hover:bg-white/10">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3 flex-shrink-0 relative z-10">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索歌曲、歌手、专辑..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none transition-all duration-300"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' }}
              />
            </div>
            <button onClick={handleSearch} disabled={loading} className="px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 disabled:opacity-50 hover:shadow-xl hover:scale-105 active:scale-95" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', boxShadow: '0 4px 20px rgba(139,92,246,0.4)' }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : '搜索'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-6 gap-1 flex-shrink-0 relative z-10" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSearchResults([]) }}
              className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-all duration-300 relative ${
                activeTab === tab.id ? 'text-purple-300' : 'text-white/35 hover:text-white/70'
              }`}
            >
              <tab.icon size={15} />
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full"
                  style={{ background: 'linear-gradient(90deg, #8b5cf6, #6366f1, #a855f7)', boxShadow: '0 0 12px rgba(139,92,246,0.5)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 relative" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(139,92,246,0.3) transparent' }}>
          {playErrorMsg && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2.5 rounded-xl text-white text-sm shadow-xl backdrop-blur-md" style={{ background: 'rgba(239,68,68,0.85)', border: '1px solid rgba(239,68,68,0.3)' }}>
              {playErrorMsg}
            </div>
          )}
          <AnimatePresence mode="wait">
            {/* API Error */}
            {apiError && searchResults.length === 0 && (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-20">
                <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: 'rgba(239,68,68,0.15)' }}>
                  <AlertCircle size={40} className="text-red-400" />
                </div>
                <h3 className="text-white text-xl font-semibold mb-2">酷狗音乐服务未连接</h3>
                <p className="text-white/50 text-center mb-6 max-w-md text-sm">API 服务启动失败，请重启应用后重试</p>
                <div className="flex gap-3">
                  <button onClick={loadDiscoverData} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-colors hover:bg-white/10" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    <RefreshCw size={16} /> 重试
                  </button>
                  <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-white/70 text-sm font-medium transition-colors hover:bg-white/10" style={{ background: 'rgba(255,255,255,0.05)' }}>关闭</button>
                </div>
              </motion.div>
            )}

            {/* Loading */}
            {loading && searchResults.length === 0 && !apiError && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-20">
                <Loader2 size={48} className="text-purple-400 animate-spin mb-4" />
                <p className="text-white/60 text-lg">正在加载...</p>
              </motion.div>
            )}

            {/* Search Error */}
            {searchError && searchResults.length === 0 && !loading && !apiError && (
              <motion.div key="search-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'rgba(251,191,36,0.15)' }}>
                  <AlertCircle size={32} className="text-yellow-400" />
                </div>
                <h3 className="text-white text-lg font-semibold mb-2">搜索失败</h3>
                <p className="text-white/50 text-center mb-4 max-w-sm text-sm">搜索服务暂时不可用，请稍后重试</p>
                <button onClick={handleSearch} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-colors hover:bg-white/10" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <RefreshCw size={16} /> 重新搜索
                </button>
              </motion.div>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h3 className="text-white/80 font-medium mb-3">搜索结果 ({searchResults.length})</h3>
                <div className="space-y-1">
                  {searchResults.map((song, i) => (
                    <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group"
                      style={{ 
                        background: playingHash === song.Hash ? 'rgba(139,92,246,0.2)' : 'transparent',
                        borderLeft: playingHash === song.Hash ? '3px solid #8b5cf6' : '3px solid transparent',
                        transition: 'all 0.25s ease',
                      }}
                      onMouseEnter={(e) => { 
                        if (playingHash !== song.Hash) {
                          (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                          ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid #8b5cf6'
                          ;(e.currentTarget as HTMLElement).style.backdropFilter = 'blur(8px)'
                        }
                      }}
                      onMouseLeave={(e) => { 
                        if (playingHash !== song.Hash) {
                          (e.currentTarget as HTMLElement).style.background = 'transparent'
                          ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid transparent'
                          ;(e.currentTarget as HTMLElement).style.backdropFilter = 'none'
                        }
                      }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        {playingHash === song.Hash ? (
                          <div className="flex gap-0.5 items-end h-4">
                            <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '60%' }} />
                            <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.2s' }} />
                            <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0.4s' }} />
                          </div>
                        ) : <Play size={14} className="text-white/40 group-hover:text-purple-400 transition-colors" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                        <div className="text-white/35 text-xs truncate">{song.SingerName}</div>
                      </div>
                      <div className="text-white/25 text-xs">{formatDuration(song.Duration || 0)}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Discover Tab */}
            {activeTab === 'discover' && searchResults.length === 0 && !apiError && !loading && (
              <motion.div key="discover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-white/80 font-medium flex items-center gap-2">
                    <Radio size={16} className="text-purple-400" />发现音乐
                  </h3>
                  <button
                    onClick={handleRefreshDiscover}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white/60 text-xs hover:text-white hover:bg-white/10 transition-all"
                  >
                    <RefreshCw size={14} />刷新
                  </button>
                </div>
                {hotKeywords.length > 0 && (
                  <div>
                    <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><TrendingUp size={16} className="text-orange-400" />热搜榜</h3>
                    <div className="flex flex-wrap gap-2">
                      {hotKeywords.map((kw, i) => (
                        <button key={i} onClick={() => handlePlayHotKeyword(kw)} className="px-3 py-1.5 rounded-lg text-white/70 text-xs transition-all duration-200 hover:bg-white/15 hover:text-white hover:scale-105" style={{ background: 'rgba(255,255,255,0.06)' }}>{kw}</button>
                      ))}
                    </div>
                  </div>
                )}
                {topSongs.length > 0 && (
                  <div>
                    <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><Headphones size={16} className="text-blue-400" />新歌速递</h3>
                    <div className="space-y-1">
                      {topSongs.slice(0, 10).map((song, i) => (
                        <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group"
                          style={{ 
                            background: playingHash === song.Hash ? 'rgba(139,92,246,0.2)' : 'transparent',
                            borderLeft: playingHash === song.Hash ? '3px solid #8b5cf6' : '3px solid transparent',
                            transition: 'all 0.25s ease',
                          }}
                          onMouseEnter={(e) => { 
                            if (playingHash !== song.Hash) {
                              (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                              ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid #8b5cf6'
                              ;(e.currentTarget as HTMLElement).style.backdropFilter = 'blur(8px)'
                            }
                          }}
                          onMouseLeave={(e) => { 
                            if (playingHash !== song.Hash) {
                              (e.currentTarget as HTMLElement).style.background = 'transparent'
                              ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid transparent'
                              ;(e.currentTarget as HTMLElement).style.backdropFilter = 'none'
                            }
                          }}>
                          <span className="w-6 text-center text-white/30 text-sm font-medium">{i + 1}</span>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            {playingHash === song.Hash ? (
                              <div className="flex gap-0.5 items-end h-4">
                                <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '60%' }} />
                                <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.2s' }} />
                                <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0.4s' }} />
                              </div>
                            ) : <Play size={14} className="text-white/40 group-hover:text-purple-400 transition-colors" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                            <div className="text-white/35 text-xs truncate">{song.SingerName}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {recommendSongs.length > 0 && (
                  <div>
                    <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><Heart size={16} className="text-pink-400" />每日推荐</h3>
                    <div className="space-y-1">
                      {recommendSongs.slice(0, 10).map((song, i) => (
                        <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group"
                          style={{ 
                            background: playingHash === song.Hash ? 'rgba(139,92,246,0.2)' : 'transparent',
                            borderLeft: playingHash === song.Hash ? '3px solid #8b5cf6' : '3px solid transparent',
                            transition: 'all 0.25s ease',
                          }}
                          onMouseEnter={(e) => { 
                            if (playingHash !== song.Hash) {
                              (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                              ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid #8b5cf6'
                              ;(e.currentTarget as HTMLElement).style.backdropFilter = 'blur(8px)'
                            }
                          }}
                          onMouseLeave={(e) => { 
                            if (playingHash !== song.Hash) {
                              (e.currentTarget as HTMLElement).style.background = 'transparent'
                              ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid transparent'
                              ;(e.currentTarget as HTMLElement).style.backdropFilter = 'none'
                            }
                          }}>
                          <span className="w-6 text-center text-white/30 text-sm font-medium">{i + 1}</span>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            <Play size={14} className="text-white/40 group-hover:text-pink-400 transition-colors" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                            <div className="text-white/35 text-xs truncate">{song.SingerName}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* User Tab */}
            {activeTab === 'user' && searchResults.length === 0 && !apiError && !loading && (
              <motion.div key="user" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {!userInfo ? (
                  <div className="text-center py-12">
                    <User size={48} className="text-white/20 mx-auto mb-4" />
                    <p className="text-white/60 text-lg mb-2">登录酷狗音乐</p>
                    <p className="text-white/40 text-sm mb-6">登录后可以查看你的歌单和收藏</p>
                    <button onClick={onLoginClick} className="px-6 py-2.5 rounded-xl text-white font-medium transition-all hover:scale-105" style={{ background: 'linear-gradient(90deg, #9333ea, #a855f7)' }}>扫码登录</button>
                  </div>
                ) : (
                  <div>
                    {selectedPlaylistId ? (
                      <div>
                        <button onClick={handlePlaylistBack} className="flex items-center gap-2 text-white/60 hover:text-white mb-4 text-sm">
                          <ChevronLeft size={16} />返回歌单列表
                        </button>
                        <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><ListMusic size={16} className="text-purple-400" />{selectedPlaylistName}</h3>
                        <div className="space-y-1 max-h-[55vh] overflow-y-auto pr-2" onScroll={(e) => {
                          const target = e.target as HTMLDivElement
                          const bottom = target.scrollHeight - target.scrollTop - target.clientHeight
                          if (bottom < 100) loadMorePlaylistSongs()
                        }}>
                          {playlistTracks.map((song, i) => (
                            <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group"
                              style={{ 
                                background: playingHash === song.Hash ? 'rgba(139,92,246,0.2)' : 'transparent',
                                borderLeft: playingHash === song.Hash ? '3px solid #8b5cf6' : '3px solid transparent',
                                transition: 'all 0.25s ease',
                              }}
                              onMouseEnter={(e) => { 
                                if (playingHash !== song.Hash) {
                                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                                  ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid #8b5cf6'
                                  ;(e.currentTarget as HTMLElement).style.backdropFilter = 'blur(8px)'
                                }
                              }}
                              onMouseLeave={(e) => { 
                                if (playingHash !== song.Hash) {
                                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                                  ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid transparent'
                                  ;(e.currentTarget as HTMLElement).style.backdropFilter = 'none'
                                }
                              }}>
                              <span className="w-6 text-center text-white/30 text-sm">{i + 1}</span>
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                                {playingHash === song.Hash ? <Loader2 size={14} className="text-purple-400 animate-spin" /> : <Play size={14} className="text-white/40 group-hover:text-purple-400 transition-colors" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                                <div className="text-white/35 text-xs truncate">{song.SingerName}</div>
                              </div>
                              <div className="text-white/25 text-xs">{formatDuration(song.Duration || 0)}</div>
                            </div>
                          ))}
                          {loadingMore && (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 size={18} className="text-white/40 animate-spin" />
                            </div>
                          )}
                          {playlistTracks.length === 0 && (
                            <div className="text-white/40 text-center py-8">该歌单暂无歌曲</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(4px)' }}>
                          <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1, #a855f7)', boxShadow: '0 4px 20px rgba(139,92,246,0.4)' }}>
                            <User size={24} className="text-white" />
                          </div>
                          <div>
                            <div className="text-white font-medium">{userInfo.nickname}</div>
                            <div className="text-white/40 text-sm">酷狗音乐用户</div>
                          </div>
                        </div>
                        <h3 className="text-white/80 font-medium mb-3">我的歌单</h3>
                        {userPlaylists.length === 0 ? (
                          <div className="text-white/40 text-center py-8">暂无歌单</div>
                        ) : (
                          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-2">
                            {userPlaylists.map((pl: any, idx: number) => {
                              const n = normalizePlaylist(pl)
                              const keyId = n.id || pl.listid || pl.specialid || `pl-${idx}`
                              return (
                                <div key={keyId} onClick={() => handleOpenPlaylist(pl)} className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-300 hover:scale-[1.01] group"
                                  style={{ 
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    backdropFilter: 'blur(4px)',
                                  }}
                                  onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
                                    ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(139,92,246,0.3)'
                                    ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(139,92,246,0.08)'
                                  }}
                                  onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
                                    ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'
                                    ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                                  }}>
                                  <ListMusic size={18} className="text-purple-400" />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-white text-sm font-medium truncate">{n.name || '未命名歌单'}</div>
                                    <div className="text-white/40 text-xs">{n.songCount || 0} 首歌曲</div>
                                  </div>
                                  <ChevronRight size={16} className="text-white/30" />
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
