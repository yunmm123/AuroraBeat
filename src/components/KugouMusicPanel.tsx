import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Play, Music, User, ListMusic, Trophy, Radio,
  Disc3, ChevronRight, ChevronLeft, Loader2, LogIn, Heart,
  TrendingUp, Headphones, X, AlertCircle, RefreshCw
} from 'lucide-react'
import {
  kugouSearch, kugouSongUrl, kugouSearchHot,
  kugouTopSong, kugouRankList, kugouRankAudio,
  kugouRecommendSongs, kugouUserPlaylist,
  kugouPlaylistTrackAllNew
} from '@/services/kugouApi'
import type { Song } from '@/types'

interface KugouMusicPanelProps {
  onClose: () => void
  onPlaySong: (song: Song) => void
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
  const audioInfo = raw.audio_info || raw.audioInfo || {}
  
  let hash = ''
  if (audioInfo.hash_128) hash = audioInfo.hash_128
  else if (audioInfo.hash) hash = audioInfo.hash
  else if (raw.Hash) hash = raw.Hash
  else if (raw.hash) hash = raw.hash
  else if (raw.hash_128) hash = raw.hash_128
  
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
  const [activeTab, setActiveTab] = useState<'discover' | 'rank' | 'user'>('discover')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KugouSongItem[]>([])
  const [hotKeywords, setHotKeywords] = useState<string[]>([])
  const [topSongs, setTopSongs] = useState<KugouSongItem[]>([])
  const [rankList, setRankList] = useState<any[]>([])
  const [recommendSongs, setRecommendSongs] = useState<KugouSongItem[]>([])
  const [userPlaylists, setUserPlaylists] = useState<any[]>([])
  const [playlistTracks, setPlaylistTracks] = useState<KugouSongItem[]>([])
  const [currentPlaylistName, setCurrentPlaylistName] = useState('')
  const [loading, setLoading] = useState(false)
  const [playingHash, setPlayingHash] = useState('')
  const [apiError, setApiError] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [selectedRankId, setSelectedRankId] = useState('')
  const [selectedRankName, setSelectedRankName] = useState('')
  const [rankSongs, setRankSongs] = useState<KugouSongItem[]>([])
  const [rankPage, setRankPage] = useState(1)
  const [rankHasMore, setRankHasMore] = useState(true)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('')
  const [selectedPlaylistName, setSelectedPlaylistName] = useState('')
  const [playlistPage, setPlaylistPage] = useState(1)
  const [playlistHasMore, setPlaylistHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [playErrorMsg, setPlayErrorMsg] = useState('')

  useEffect(() => {
    loadDiscoverData()
  }, [])

  useEffect(() => {
    if (activeTab === 'user' && userInfo) {
      loadUserPlaylists()
    }
  }, [activeTab, userInfo])

  async function loadDiscoverData() {
    setLoading(true)
    setApiError(false)
    try {
      const [hotRes, topRes, rankRes, recommendRes] = await Promise.allSettled([
        kugouSearchHot(),
        kugouTopSong(),
        kugouRankList(),
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
      // Rank list — structure: data.info[] with rankid, rankname, intro
      if (rankRes.status === 'fulfilled') {
        const ranks = rankRes.value?.data?.info || rankRes.value?.data?.list || []
        if (ranks.length > 0) {
          setRankList(ranks.slice(0, 12))
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
      const rawList = extractSongList(res)
      if (rawList.length === 0 && (res?.error_code || res?.errcode)) {
        setSearchError(true)
      }
      setSearchResults(rawList.map(normalizeSong))
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
      const rawList = extractSongList(res)
      if (rawList.length === 0 && (res?.error_code || res?.errcode)) {
        setSearchError(true)
      }
      setSearchResults(rawList.map(normalizeSong))
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
        }
        onPlaySong(kugouSong)
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

  async function handleRankClick(rank: any) {
    const n = normalizePlaylist(rank)
    if (!n.id) return
    setSelectedRankId(n.id)
    setSelectedRankName(n.name || '榜单')
    setRankSongs([])
    setRankPage(1)
    setRankHasMore(true)
    setLoading(true)
    try {
      const res = await kugouRankAudio(n.id, 1)
      const rawList = extractSongList(res)
      setRankSongs(rawList.map(normalizeSong))
      if (rawList.length < 30) setRankHasMore(false)
    } catch {
      // ignore
    }
    setLoading(false)
  }
  
  async function loadMoreRankSongs() {
    if (!selectedRankId || !rankHasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const nextPage = rankPage + 1
      const res = await kugouRankAudio(selectedRankId, nextPage)
      const rawList = extractSongList(res)
      if (rawList.length > 0) {
        setRankSongs(prev => [...prev, ...rawList.map(normalizeSong)])
        setRankPage(nextPage)
      }
      if (rawList.length < 30) setRankHasMore(false)
    } catch {
      // ignore
    }
    setLoadingMore(false)
  }

  function handleRankBack() {
    setSelectedRankId('')
    setSelectedRankName('')
    setRankSongs([])
    setRankPage(1)
    setRankHasMore(true)
  }

  async function handleOpenPlaylist(playlist: any) {
    setLoading(true)
    const n = normalizePlaylist(playlist)
    const listId = String(playlist.listid || playlist.specialid || playlist.id || n.id || '')
    setSelectedPlaylistId(listId)
    setSelectedPlaylistName(n.name || '歌单')
    setPlaylistTracks([])
    setPlaylistPage(1)
    setPlaylistHasMore(true)
    try {
      const uid = userInfo?.uid
      const token = userInfo?.token
      const res = await kugouPlaylistTrackAllNew(listId, 1, uid, token)
      const rawList = extractSongList(res)
      setPlaylistTracks(rawList.map(normalizeSong))
      if (rawList.length < 30) setPlaylistHasMore(false)
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

  function formatDuration(seconds: number): string {
    if (!seconds) return '--:--'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const tabs = [
    { id: 'discover' as const, label: '发现', icon: Disc3 },
    { id: 'rank' as const, label: '榜单', icon: Trophy },
    { id: 'user' as const, label: '我的', icon: User },
  ]

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="w-[90vw] max-w-[1200px] h-[80vh] rounded-2xl overflow-hidden flex flex-col" style={{ background: '#0d0d1a', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 25px 60px rgba(0,0,0,0.8)' }}>
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ background: 'linear-gradient(90deg, rgba(59,130,246,0.15), rgba(147,51,234,0.15))', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6, #9333ea)' }}>
              <Music size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">酷狗音乐</h2>
              <p className="text-white/50 text-xs">海量音乐，随心畅听</p>
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
              <button onClick={onLoginClick} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:scale-105" style={{ background: 'linear-gradient(90deg, #3b82f6, #9333ea)', boxShadow: '0 4px 15px rgba(147,51,234,0.4)' }}>
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
        <div className="px-6 py-3 flex-shrink-0">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索歌曲、歌手、专辑..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-white text-sm placeholder:text-white/40 focus:outline-none transition-colors"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </div>
            <button onClick={handleSearch} disabled={loading} className="px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50" style={{ background: 'linear-gradient(90deg, #9333ea, #a855f7)' }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : '搜索'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-6 gap-1 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSearchResults([]) }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'text-purple-400' : 'text-white/50 hover:text-white/80'
              }`}
              style={activeTab === tab.id ? { borderBottom: '2px solid #a855f7' } : {}}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 relative" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
          {playErrorMsg && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-lg text-white text-sm shadow-lg" style={{ background: 'rgba(239,68,68,0.9)' }}>
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
                    <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors" style={{ background: playingHash === song.Hash ? 'rgba(168,85,247,0.2)' : 'transparent' }}
                      onMouseEnter={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                      onMouseLeave={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        {playingHash === song.Hash ? (
                          <div className="flex gap-0.5 items-end h-4">
                            <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '60%' }} />
                            <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.2s' }} />
                            <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0.4s' }} />
                          </div>
                        ) : <Play size={14} className="text-white/60" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                        <div className="text-white/50 text-xs truncate">{song.SingerName}</div>
                      </div>
                      <div className="text-white/40 text-xs">{formatDuration(song.Duration || 0)}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Discover Tab */}
            {activeTab === 'discover' && searchResults.length === 0 && !apiError && !loading && (
              <motion.div key="discover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {hotKeywords.length > 0 && (
                  <div>
                    <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><TrendingUp size={16} className="text-orange-400" />热搜榜</h3>
                    <div className="flex flex-wrap gap-2">
                      {hotKeywords.map((kw, i) => (
                        <button key={i} onClick={() => handlePlayHotKeyword(kw)} className="px-3 py-1.5 rounded-lg text-white/80 text-xs transition-colors hover:bg-white/20" style={{ background: 'rgba(255,255,255,0.08)' }}>{kw}</button>
                      ))}
                    </div>
                  </div>
                )}
                {topSongs.length > 0 && (
                  <div>
                    <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><Headphones size={16} className="text-blue-400" />新歌速递</h3>
                    <div className="space-y-1">
                      {topSongs.slice(0, 10).map((song, i) => (
                        <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors" style={{ background: playingHash === song.Hash ? 'rgba(168,85,247,0.2)' : 'transparent' }}
                          onMouseEnter={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                          onMouseLeave={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                          <span className="w-6 text-center text-white/40 text-sm font-medium">{i + 1}</span>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            {playingHash === song.Hash ? (
                              <div className="flex gap-0.5 items-end h-4">
                                <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '60%' }} />
                                <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.2s' }} />
                                <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0.4s' }} />
                              </div>
                            ) : <Play size={14} className="text-white/60" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                            <div className="text-white/50 text-xs truncate">{song.SingerName}</div>
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
                        <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors" style={{ background: playingHash === song.Hash ? 'rgba(168,85,247,0.2)' : 'transparent' }}
                          onMouseEnter={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                          onMouseLeave={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                          <span className="w-6 text-center text-white/40 text-sm font-medium">{i + 1}</span>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            <Play size={14} className="text-white/60" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                            <div className="text-white/50 text-xs truncate">{song.SingerName}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* Rank Tab */}
            {activeTab === 'rank' && searchResults.length === 0 && !apiError && !loading && (
              <motion.div key="rank" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {selectedRankId ? (
                  <div>
                    <button onClick={handleRankBack} className="flex items-center gap-2 text-white/60 hover:text-white mb-4 text-sm">
                      <ChevronLeft size={16} />返回榜单列表
                    </button>
                    <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><Trophy size={16} className="text-yellow-400" />{selectedRankName}</h3>
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2" onScroll={(e) => {
                      const target = e.target as HTMLDivElement
                      const bottom = target.scrollHeight - target.scrollTop - target.clientHeight
                      if (bottom < 100) loadMoreRankSongs()
                    }}>
                      {rankSongs.map((song: KugouSongItem, idx: number) => (
                        <div key={song.Hash || idx} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors group" style={{ background: 'rgba(255,255,255,0.03)' }}
                          onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'}
                          onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'}>
                          <div className="w-6 text-center text-sm text-white/30 flex-shrink-0">{idx + 1}</div>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            {playingHash === song.Hash ? <Loader2 size={14} className="text-purple-400 animate-spin" /> : <Play size={14} className="text-white/60 group-hover:text-purple-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                            <div className="text-white/50 text-xs truncate">{song.SingerName}</div>
                          </div>
                        </div>
                      ))}
                      {loadingMore && (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 size={18} className="text-white/40 animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><Trophy size={16} className="text-yellow-400" />排行榜</h3>
                    {rankList.length === 0 ? (
                      <div className="text-white/40 text-center py-8">暂无榜单数据</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {rankList.map((rank: any) => {
                          const n = normalizePlaylist(rank)
                          return (
                            <div key={n.id || rank.rankid} onClick={() => handleRankClick(rank)} className="p-4 rounded-xl cursor-pointer transition-colors group" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'}
                              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'}>
                              <div className="text-white text-sm font-medium truncate group-hover:text-purple-400 transition-colors">{rank.rankname}</div>
                              <div className="text-white/40 text-xs mt-1 truncate">{rank.intro || '热门榜单'}</div>
                            </div>
                          )
                        })}
                      </div>
                    )}
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
                            <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors" style={{ background: playingHash === song.Hash ? 'rgba(168,85,247,0.2)' : 'transparent' }}
                              onMouseEnter={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                              onMouseLeave={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                              <span className="w-6 text-center text-white/40 text-sm">{i + 1}</span>
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
                                {playingHash === song.Hash ? <Loader2 size={14} className="text-purple-400 animate-spin" /> : <Play size={14} className="text-white/60" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-white text-sm font-medium truncate">{song.SongName}</div>
                                <div className="text-white/50 text-xs truncate">{song.SingerName}</div>
                              </div>
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
                        <div className="flex items-center gap-3 mb-6 p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #a855f7, #3b82f6)' }}>
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
                                <div key={keyId} onClick={() => handleOpenPlaylist(pl)} className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'}
                                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'}>
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
      </div>
    </div>
  )
}
