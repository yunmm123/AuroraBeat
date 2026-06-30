import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Play, Music, User, ListMusic, Disc3, Heart,
  ChevronLeft, Loader2, LogIn, X, RefreshCw, Radio,
} from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/types'

interface NeteaseSong {
  id: string
  title: string
  artist: string
  album: string
  cover: string
  duration: number
  url: string
  source: 'netease'
  quality?: 'standard' | 'high' | 'lossless' | 'hires'
  albumId?: string
}

interface NeteasePlaylist {
  id: string
  name: string
  cover: string
  trackCount: number
  playCount: number
  creator: string
  description?: string
}

interface NeteaseUser {
  userId: string
  nickname: string
  avatarUrl: string
}

type TabType = 'discover' | 'search' | 'user'

export default function NeteaseMusicPanel({ onClose }: { onClose: () => void }) {
  const { playSong, currentSong } = usePlayerStore()
  const [activeTab, setActiveTab] = useState<TabType>('discover')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NeteaseSong[]>([])
  const [loading, setLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [playingId, setPlayingId] = useState('')
  const [error, setError] = useState('')
  const [playErrorMsg, setPlayErrorMsg] = useState('')

  // Login
  const [showLogin, setShowLogin] = useState(false)
  const [qrImg, setQrImg] = useState('')
  const [qrKey, setQrKey] = useState('')
  const [loginStatus, setLoginStatus] = useState<'waiting' | 'scanning' | 'expired' | 'loggedIn'>('waiting')
  const [userInfo, setUserInfo] = useState<NeteaseUser | null>(null)
  const [checkingLogin, setCheckingLogin] = useState(false)

  // Discover
  const [recommendPlaylists, setRecommendPlaylists] = useState<NeteasePlaylist[]>([])
  const [recommendSongs, setRecommendSongs] = useState<NeteaseSong[]>([])

  // User playlists
  const [userPlaylists, setUserPlaylists] = useState<NeteasePlaylist[]>([])

  // Playlist detail
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('')
  const [selectedPlaylistName, setSelectedPlaylistName] = useState('')
  const [playlistTracks, setPlaylistTracks] = useState<NeteaseSong[]>([])
  const [playlistPage, setPlaylistPage] = useState(1)
  const [playlistHasMore, setPlaylistHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check login status on mount
  useEffect(() => {
    checkLoginStatus()
    loadDiscover()
  }, [])

  // Load user playlists when logged in
  useEffect(() => {
    if (activeTab === 'user' && userInfo) {
      loadUserPlaylists()
    }
  }, [activeTab, userInfo])

  async function checkLoginStatus() {
    setCheckingLogin(true)
    try {
      const res = await window.electronAPI?.netease?.loginStatus()
      if (res?.ok && res.loggedIn && res.user) {
        setUserInfo(res.user)
        // Save auth data for persistence
        window.electronAPI?.auth?.saveNetease(
          res.user.userId,
          res.user.nickname,
          res.user.avatarUrl
        )
      }
    } catch {
      // ignore
    }
    setCheckingLogin(false)
  }

  async function loadDiscover() {
    setLoading(true)
    try {
      const [playlistsRes, songsRes] = await Promise.all([
        window.electronAPI?.netease?.recommendPlaylists(),
        window.electronAPI?.netease?.recommendSongs(),
      ])
      if (playlistsRes?.ok) setRecommendPlaylists(playlistsRes.playlists || [])
      if (songsRes?.ok) setRecommendSongs(songsRes.songs || [])
    } catch {
      setError('加载失败，请重试')
    }
    setLoading(false)
  }

  async function loadUserPlaylists() {
    if (!userInfo) return
    try {
      const res = await window.electronAPI?.netease?.userPlaylist(userInfo.userId)
      if (res?.ok) setUserPlaylists(res.playlists || [])
    } catch {
      // ignore
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return
    setSearchLoading(true)
    setError('')
    try {
      const res = await window.electronAPI?.netease?.search(searchQuery.trim(), 30)
      if (res?.ok) {
        setSearchResults(res.songs || [])
        if (res.songs?.length === 0) setError('未找到相关歌曲')
      } else {
        setError('搜索失败，请重试')
      }
    } catch {
      setError('搜索失败，请重试')
    }
    setSearchLoading(false)
  }

  async function handlePlaySong(song: NeteaseSong) {
    setPlayingId(song.id)
    setPlayErrorMsg('')
    try {
      // 先获取歌曲URL
      const urlRes = await window.electronAPI?.netease?.songUrl(song.id, song.quality || 'standard')
      if (urlRes?.ok && urlRes.url) {
        const fullSong: Song = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        cover: song.cover || '',
        duration: song.duration || 0,
        url: urlRes.url,
        source: 'netease',
        quality: song.quality,
        albumId: song.albumId,
      }
        // Build queue from current context
        let queue: Song[] = []
        if (selectedPlaylistId && playlistTracks.length > 0) {
          queue = playlistTracks.map(s => ({
            id: s.id,
            title: s.title,
            artist: s.artist,
            album: s.album,
            cover: s.cover || '',
            duration: s.duration || 0,
            url: '',
            source: 'netease' as const,
            quality: s.quality,
            albumId: s.albumId,
          }))
        } else if (searchResults.length > 0) {
          queue = searchResults.map(s => ({
            id: s.id,
            title: s.title,
            artist: s.artist,
            album: s.album,
            cover: s.cover || '',
            duration: s.duration || 0,
            url: '',
            source: 'netease' as const,
            quality: s.quality,
            albumId: s.albumId,
          }))
        } else if (recommendSongs.length > 0) {
          queue = recommendSongs.map(s => ({
            id: s.id,
            title: s.title,
            artist: s.artist,
            album: s.album,
            cover: s.cover || '',
            duration: s.duration || 0,
            url: '',
            source: 'netease' as const,
            quality: s.quality,
            albumId: s.albumId,
          }))
        }
        playSong(fullSong, queue.length > 0 ? queue : undefined)
      } else {
        setPlayErrorMsg('无法获取播放地址，可能需要登录')
        setTimeout(() => setPlayErrorMsg(''), 3000)
      }
    } catch {
      setPlayErrorMsg('播放失败')
      setTimeout(() => setPlayErrorMsg(''), 3000)
    }
    setPlayingId('')
  }

  // ========== QR Login ==========
  async function startQrLogin() {
    setShowLogin(true)
    setLoginStatus('waiting')
    try {
      const keyRes = await window.electronAPI?.netease?.qrKey()
      if (!keyRes?.ok || !keyRes.key) {
        setLoginStatus('expired')
        return
      }
      setQrKey(keyRes.key)
      const imgRes = await window.electronAPI?.netease?.qrCreate(keyRes.key)
      if (imgRes?.ok && imgRes.qrimg) {
        setQrImg(imgRes.qrimg)
        startQrPolling(keyRes.key)
      }
    } catch {
      setLoginStatus('expired')
    }
  }

  function startQrPolling(key: string) {
    if (qrTimerRef.current) clearInterval(qrTimerRef.current)
    qrTimerRef.current = setInterval(async () => {
      try {
        const res = await window.electronAPI?.netease?.qrCheck(key)
        if (res?.ok) {
          if (res.code === 800) setLoginStatus('expired')
          else if (res.code === 802) setLoginStatus('scanning')
          else if (res.code === 803) {
            setLoginStatus('loggedIn')
            if (qrTimerRef.current) clearInterval(qrTimerRef.current)
            setTimeout(() => {
              setShowLogin(false)
              checkLoginStatus()
            }, 1500)
          }
        }
      } catch {
        // ignore
      }
    }, 2000)
  }

  function closeLogin() {
    setShowLogin(false)
    setQrImg('')
    setQrKey('')
    setLoginStatus('waiting')
    if (qrTimerRef.current) clearInterval(qrTimerRef.current)
  }

  // ========== Playlist Detail ==========
  async function handleOpenPlaylist(playlist: NeteasePlaylist) {
    setLoading(true)
    setSelectedPlaylistId(playlist.id)
    setSelectedPlaylistName(playlist.name)
    setPlaylistTracks([])
    setPlaylistPage(1)
    setPlaylistHasMore(true)
    try {
      const res = await window.electronAPI?.netease?.playlistDetail(playlist.id, 50, 0)
      if (res?.ok) {
        setPlaylistTracks(res.songs || [])
        if ((res.songs?.length || 0) < 50) setPlaylistHasMore(false)
      }
    } catch {
      // ignore
    }
    setLoading(false)
  }

  async function loadMorePlaylistSongs() {
    if (!selectedPlaylistId || !playlistHasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const nextPage = playlistPage + 1
      const offset = nextPage * 50
      const res = await window.electronAPI?.netease?.playlistDetail(selectedPlaylistId, 50, offset)
      if (res?.ok && res.songs?.length > 0) {
        setPlaylistTracks(prev => [...prev, ...res.songs])
        setPlaylistPage(nextPage)
      }
      if ((res?.songs?.length || 0) < 50) setPlaylistHasMore(false)
    } catch {
      // ignore
    }
    setLoadingMore(false)
  }

  function handlePlaylistBack() {
    setSelectedPlaylistId('')
    setSelectedPlaylistName('')
    setPlaylistTracks([])
    setPlaylistPage(1)
    setPlaylistHasMore(true)
  }

  function formatDuration(seconds: number): string {
    if (!seconds) return '--:--'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(16px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          onClick={(e) => e.stopPropagation()}
          className="w-[900px] h-[650px] rounded-2xl flex flex-col overflow-hidden relative"
          style={{
            background: 'linear-gradient(145deg, rgba(26,26,46,0.97) 0%, rgba(22,33,62,0.98) 40%, rgba(15,15,35,0.99) 100%)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.7), 0 0 150px rgba(236,65,65,0.12), 0 0 60px rgba(236,65,65,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {/* Ambient glow decorations */}
          <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full blur-3xl opacity-25 pointer-events-none animate-pulse" style={{ background: 'radial-gradient(circle, rgba(236,65,65,0.4), transparent 70%)', animationDuration: '4s' }} />
          <div className="absolute top-1/3 -right-16 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none animate-pulse" style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.35), transparent 70%)', animationDuration: '5s', animationDelay: '1s' }} />
          <div className="absolute -bottom-16 left-1/4 w-56 h-56 rounded-full blur-3xl opacity-15 pointer-events-none animate-pulse" style={{ background: 'radial-gradient(circle, rgba(236,65,65,0.3), transparent 70%)', animationDuration: '6s', animationDelay: '2s' }} />
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 flex-shrink-0 relative z-10" style={{ background: 'linear-gradient(180deg, rgba(236,65,65,0.15), rgba(236,65,65,0.04), rgba(15,15,30,0))', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #ec4141, #e83030, #c62f2f)', boxShadow: '0 4px 25px rgba(236,65,65,0.5), 0 0 30px rgba(236,65,65,0.2)' }}>
                  <Music size={18} className="text-white" />
                </div>
                <span className="text-white font-semibold text-lg tracking-tight">网易云音乐</span>
              </div>
              {/* Tabs */}
              <div className="flex items-center gap-1 ml-6 p-1 rounded-lg relative" style={{ background: 'rgba(255,255,255,0.05)' }}>
                {[
                  { key: 'discover' as TabType, label: '发现', icon: Disc3 },
                  { key: 'search' as TabType, label: '搜索', icon: Search },
                  { key: 'user' as TabType, label: '我的', icon: User },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm transition-all duration-300 relative ${
                      activeTab === key
                        ? 'text-white'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                    style={activeTab === key ? { background: 'rgba(236,65,65,0.25)' } : {}}
                  >
                    <Icon size={14} />
                    {label}
                    {activeTab === key && (
                      <motion.div
                        layoutId="neteaseActiveTab"
                        className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full"
                        style={{ background: 'linear-gradient(90deg, #ec4141, #f472b6)', boxShadow: '0 0 10px rgba(236,65,65,0.5)' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {userInfo ? (
                <div className="flex items-center gap-2">
                  <img src={userInfo.avatarUrl} alt="" className="w-7 h-7 rounded-full" />
                  <span className="text-white/70 text-sm">{userInfo.nickname}</span>
                </div>
              ) : (
                <button
                  onClick={startQrLogin}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-white text-sm transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #ec4141, #e83030)', boxShadow: '0 4px 20px rgba(236,65,65,0.4)' }}
                >
                  <LogIn size={14} />
                  登录
                </button>
              )}
              <button onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all duration-200">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(236,65,65,0.3) transparent' }}>
            {playErrorMsg && (
              <div className="mb-4 px-4 py-2.5 rounded-xl text-white text-sm shadow-lg backdrop-blur-md" style={{ background: 'rgba(239,68,68,0.85)', border: '1px solid rgba(239,68,68,0.3)' }}>
                {playErrorMsg}
              </div>
            )}

            {/* Search Tab */}
            {activeTab === 'search' && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder="搜索歌曲、歌手..."
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl text-white text-sm outline-none transition-all duration-300"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' }}
                    />
                  </div>
                  <button
                    onClick={handleSearch}
                    disabled={searchLoading}
                    className="px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95 disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #ec4141, #e83030)', boxShadow: '0 4px 20px rgba(236,65,65,0.4)' }}
                  >
                    {searchLoading ? <Loader2 size={16} className="animate-spin" /> : '搜索'}
                  </button>
                </div>
                {error && <div className="text-white/40 text-center py-8">{error}</div>}
                {searchResults.length > 0 && (
                  <div className="space-y-1">
                    {searchResults.map((song, i) => (
                      <div
                        key={song.id}
                        onClick={() => handlePlaySong(song)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group"
                        style={{ 
                          background: playingId === song.id ? 'rgba(236,65,65,0.15)' : 'transparent',
                          borderLeft: playingId === song.id ? '3px solid #ec4141' : '3px solid transparent',
                          transition: 'all 0.25s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (playingId !== song.id) {
                            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                            ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid #ec4141'
                            ;(e.currentTarget as HTMLElement).style.backdropFilter = 'blur(8px)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (playingId !== song.id) {
                            (e.currentTarget as HTMLElement).style.background = 'transparent'
                            ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid transparent'
                            ;(e.currentTarget as HTMLElement).style.backdropFilter = 'none'
                          }
                        }}
                      >
                        <span className="w-6 text-center text-white/30 text-sm">{i + 1}</span>
                        <img src={song.cover} alt="" className="w-10 h-10 rounded-lg object-cover" />
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm font-medium truncate">{song.title}</div>
                          <div className="text-white/35 text-xs truncate">{song.artist}</div>
                        </div>
                        <span className="text-white/25 text-xs">{formatDuration(song.duration)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!searchQuery && !error && searchResults.length === 0 && (
                  <div className="text-white/30 text-center py-12">
                    <Search size={48} className="mx-auto mb-4 opacity-30" />
                    <p>输入关键词搜索网易云音乐</p>
                  </div>
                )}
              </div>
            )}

            {/* Discover Tab */}
            {activeTab === 'discover' && !selectedPlaylistId && (
              <div>
                {loading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 size={24} className="text-white/40 animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* 每日推荐歌曲 */}
                    {recommendSongs.length > 0 && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-white/80 font-medium flex items-center gap-2">
                            <Heart size={16} className="text-red-400" />每日推荐
                          </h3>
                          <button
                            onClick={() => {
                              const songs = recommendSongs.map(s => ({
                                ...s, source: 'netease' as const, url: ''
                              }))
                              if (songs.length > 0) {
                                playSong(songs[0], songs)
                              }
                            }}
                            className="flex items-center gap-1 px-3 py-1 rounded-lg text-white text-xs font-medium transition-all duration-200 hover:scale-105 hover:shadow-lg"
                            style={{ background: 'linear-gradient(135deg, #ec4141, #e83030)', boxShadow: '0 2px 12px rgba(236,65,65,0.3)' }}
                          >
                            <Play size={12} />播放全部
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {recommendSongs.slice(0, 10).map((song, i) => (
                            <div
                              key={song.id}
                              onClick={() => handlePlaySong(song)}
                              className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer group transition-all duration-200"
                              style={{ 
                                background: 'transparent',
                                borderLeft: '3px solid transparent',
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                                ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid #ec4141'
                                ;(e.currentTarget as HTMLElement).style.backdropFilter = 'blur(8px)'
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLElement).style.background = 'transparent'
                                ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid transparent'
                                ;(e.currentTarget as HTMLElement).style.backdropFilter = 'none'
                              }}
                            >
                              <span className="text-white/25 text-sm w-5">{i + 1}</span>
                              <img src={song.cover} alt="" className="w-9 h-9 rounded-md object-cover" />
                              <div className="min-w-0 flex-1">
                                <div className="text-white text-sm truncate">{song.title}</div>
                                <div className="text-white/35 text-xs truncate">{song.artist}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 推荐歌单 */}
                    {recommendPlaylists.length > 0 && (
                      <div>
                        <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2">
                          <Radio size={16} className="text-purple-400" />推荐歌单
                        </h3>
                        <div className="grid grid-cols-4 gap-4">
                          {recommendPlaylists.map((pl) => (
                            <div
                              key={pl.id}
                              onClick={() => handleOpenPlaylist(pl)}
                              className="cursor-pointer group transition-all duration-300 hover:scale-[1.03]"
                            >
                              <div className="relative mb-2 overflow-hidden rounded-xl" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                                <img src={pl.cover} alt="" className="w-full aspect-square object-cover group-hover:scale-110 transition-transform duration-500" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center" style={{ backdropFilter: 'blur(0px)' }}>
                                  <Play size={32} className="text-white opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0" />
                                </div>
                              </div>
                              <div className="text-white text-sm truncate group-hover:text-red-400 transition-colors">{pl.name}</div>
                              <div className="text-white/35 text-xs">{pl.trackCount}首</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!loading && recommendSongs.length === 0 && recommendPlaylists.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-20 text-white/30">
                        <Music size={48} className="mb-4 opacity-30" />
                        <p>登录后获取个性化推荐</p>
                        <button onClick={startQrLogin} className="mt-4 px-6 py-2 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95" style={{ background: 'linear-gradient(135deg, #ec4141, #e83030)', boxShadow: '0 4px 20px rgba(236,65,65,0.4)' }}>
                          立即登录
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Playlist Detail */}
            {selectedPlaylistId && (
              <div>
                <button onClick={handlePlaylistBack} className="flex items-center gap-2 text-white/50 hover:text-white mb-4 text-sm transition-colors duration-200">
                  <ChevronLeft size={16} />返回
                </button>
                <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2">
                  <ListMusic size={16} className="text-red-400" />{selectedPlaylistName}
                </h3>
                <div className="space-y-1 max-h-[55vh] overflow-y-auto pr-2" onScroll={(e) => {
                  const target = e.target as HTMLDivElement
                  const bottom = target.scrollHeight - target.scrollTop - target.clientHeight
                  if (bottom < 100) loadMorePlaylistSongs()
                }}>
                  {playlistTracks.map((song, i) => (
                    <div
                      key={song.id + i}
                      onClick={() => handlePlaySong(song)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group"
                      style={{ 
                        background: playingId === song.id ? 'rgba(236,65,65,0.15)' : 'transparent',
                        borderLeft: playingId === song.id ? '3px solid #ec4141' : '3px solid transparent',
                        transition: 'all 0.25s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (playingId !== song.id) {
                          (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                          ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid #ec4141'
                          ;(e.currentTarget as HTMLElement).style.backdropFilter = 'blur(8px)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (playingId !== song.id) {
                          (e.currentTarget as HTMLElement).style.background = 'transparent'
                          ;(e.currentTarget as HTMLElement).style.borderLeft = '3px solid transparent'
                          ;(e.currentTarget as HTMLElement).style.backdropFilter = 'none'
                        }
                      }}
                    >
                      <span className="w-6 text-center text-white/30 text-sm">{i + 1}</span>
                      <img src={song.cover} alt="" className="w-9 h-9 rounded-lg object-cover" />
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium truncate">{song.title}</div>
                        <div className="text-white/35 text-xs truncate">{song.artist}</div>
                      </div>
                      <span className="text-white/25 text-xs">{formatDuration(song.duration)}</span>
                    </div>
                  ))}
                  {loadingMore && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={18} className="text-white/40 animate-spin" />
                    </div>
                  )}
                  {playlistTracks.length === 0 && !loading && (
                    <div className="text-white/40 text-center py-8">暂无歌曲</div>
                  )}
                </div>
              </div>
            )}

            {/* My Tab */}
            {activeTab === 'user' && !selectedPlaylistId && (
              <div>
                {!userInfo ? (
                  <div className="flex flex-col items-center justify-center py-20 text-white/30">
                    <User size={48} className="mb-4 opacity-30" />
                    <p>登录后查看我的歌单</p>
                    <button onClick={startQrLogin} className="mt-4 px-6 py-2 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95" style={{ background: 'linear-gradient(135deg, #ec4141, #e83030)', boxShadow: '0 4px 20px rgba(236,65,65,0.4)' }}>
                      立即登录
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-3 mb-6 p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(4px)' }}>
                      <img src={userInfo.avatarUrl} alt="" className="w-12 h-12 rounded-full" />
                      <div>
                        <div className="text-white font-medium">{userInfo.nickname}</div>
                        <div className="text-white/40 text-sm">网易云音乐用户</div>
                      </div>
                    </div>
                    {userPlaylists.length > 0 ? (
                      <div className="grid grid-cols-4 gap-4">
                        {userPlaylists.map((pl) => (
                          <div
                            key={pl.id}
                            onClick={() => handleOpenPlaylist(pl)}
                            className="cursor-pointer group transition-all duration-300 hover:scale-[1.03]"
                          >
                            <div className="relative mb-2 overflow-hidden rounded-xl" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                              <img src={pl.cover} alt="" className="w-full aspect-square object-cover group-hover:scale-110 transition-transform duration-500" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
                                <Play size={32} className="text-white opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0" />
                              </div>
                            </div>
                            <div className="text-white text-sm truncate group-hover:text-red-400 transition-colors">{pl.name}</div>
                            <div className="text-white/35 text-xs">{pl.trackCount}首</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-white/40 text-center py-8">暂无歌单</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* QR Login Modal */}
        <AnimatePresence>
          {showLogin && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="fixed inset-0 z-[60] flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.8)' }}
            >
              <div className="bg-[#1a1a2e] rounded-2xl p-8 w-[380px] text-center" style={{ border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 80px rgba(236,65,65,0.1)' }}>
                <h3 className="text-white text-lg font-semibold mb-2">网易云音乐扫码登录</h3>
                <p className="text-white/40 text-sm mb-6">请使用网易云音乐APP扫描二维码</p>

                {qrImg ? (
                  <div className="relative inline-block mb-4">
                    <img src={qrImg} alt="QR Code" className="w-52 h-52 rounded-xl" style={{ background: 'white', padding: 8 }} />
                    {loginStatus === 'expired' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl">
                        <div className="text-white text-center">
                          <p className="mb-2">二维码已过期</p>
                          <button onClick={startQrLogin} className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg text-white text-sm transition-all duration-200 hover:scale-105" style={{ background: 'linear-gradient(135deg, #ec4141, #e83030)', boxShadow: '0 2px 12px rgba(236,65,65,0.3)' }}>
                            <RefreshCw size={14} />刷新
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center w-52 h-52 mx-auto mb-4">
                    <Loader2 size={32} className="text-white/40 animate-spin" />
                  </div>
                )}

                <div className="text-white/50 text-sm mb-4">
                  {loginStatus === 'waiting' && '等待扫码...'}
                  {loginStatus === 'scanning' && '已扫码，请在手机上确认'}
                  {loginStatus === 'loggedIn' && '登录成功！'}
                </div>

                <button onClick={closeLogin} className="text-white/40 hover:text-white text-sm transition-colors">
                  取消
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  )
}