import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Play, Music, User, ListMusic, Trophy, Radio,
  Disc3, ChevronRight, Loader2, LogIn, Heart,
  TrendingUp, Headphones, X, AlertCircle, RefreshCw
} from 'lucide-react'
import {
  kugouSearch, kugouSongUrl, kugouSearchHot,
  kugouTopSong, kugouRankList,
  kugouFmClass, kugouRecommendSongs, kugouUserPlaylist,
  kugouPlaylistTrackAll
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
  Duration?: number
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

      if (hotRes.status === 'fulfilled' && hotRes.value?.data?.info) {
        const keywords = hotRes.value.data.info.map((i: any) => i.keyword).filter(Boolean)
        if (keywords.length > 0) { setHotKeywords(keywords.slice(0, 10)); anySuccess = true }
      }
      if (topRes.status === 'fulfilled' && topRes.value?.data?.info) {
        const songs = topRes.value.data.info
        if (songs.length > 0) { setTopSongs(songs.slice(0, 20)); anySuccess = true }
      }
      if (rankRes.status === 'fulfilled' && rankRes.value?.data?.list) {
        const ranks = rankRes.value.data.list
        if (ranks.length > 0) { setRankList(ranks.slice(0, 12)); anySuccess = true }
      }
      if (recommendRes.status === 'fulfilled' && recommendRes.value?.data?.info) {
        const songs = recommendRes.value.data.info
        if (songs.length > 0) { setRecommendSongs(songs.slice(0, 20)); anySuccess = true }
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
      const playlists = res?.data?.data || []
      setUserPlaylists(playlists)
    } catch {
      // ignore
    }
    setLoading(false)
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return
    setLoading(true)
    setApiError(false)
    try {
      const res = await kugouSearch(searchQuery.trim())
      const songs = res?.data?.lists || []
      if (songs.length === 0) setApiError(true)
      setSearchResults(songs)
    } catch {
      setApiError(true)
    }
    setLoading(false)
  }

  async function handlePlayHotKeyword(keyword: string) {
    setSearchQuery(keyword)
    setLoading(true)
    setApiError(false)
    try {
      const res = await kugouSearch(keyword)
      const songs = res?.data?.lists || []
      setSearchResults(songs)
    } catch {
      setApiError(true)
    }
    setLoading(false)
  }

  async function handlePlaySong(song: KugouSongItem) {
    setPlayingHash(song.Hash)
    try {
      const urlRes = await kugouSongUrl(song.Hash, song.AlbumID)
      const playUrl = urlRes?.data?.play_url || urlRes?.data?.play_backup_url
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
      }
    } catch {
      console.error('Failed to get song URL')
    }
  }

  async function handleOpenPlaylist(playlist: any) {
    setLoading(true)
    setCurrentPlaylistName(playlist.specialname || playlist.playlistname || '歌单')
    try {
      const res = await kugouPlaylistTrackAll(playlist.id || playlist.specialid)
      const songs = res?.data?.data || []
      setPlaylistTracks(songs)
    } catch {
      // ignore
    }
    setLoading(false)
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
        <div className="flex-1 overflow-y-auto px-6 py-4" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
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
                <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2"><Trophy size={16} className="text-yellow-400" />排行榜</h3>
                {rankList.length === 0 ? (
                  <div className="text-white/40 text-center py-8">暂无榜单数据</div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {rankList.map((rank: any) => (
                      <div key={rank.rankid} className="p-4 rounded-xl cursor-pointer transition-colors group" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'}
                        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'}>
                        <div className="text-white text-sm font-medium truncate group-hover:text-purple-400 transition-colors">{rank.rankname}</div>
                        <div className="text-white/40 text-xs mt-1 truncate">{rank.intro || '热门榜单'}</div>
                      </div>
                    ))}
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
                      <div className="space-y-2">
                        {userPlaylists.map((pl: any) => (
                          <div key={pl.id || pl.specialid} onClick={() => handleOpenPlaylist(pl)} className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'}
                            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'}>
                            <ListMusic size={18} className="text-purple-400" />
                            <div className="flex-1 min-w-0">
                              <div className="text-white text-sm font-medium truncate">{pl.specialname || pl.playlistname}</div>
                              <div className="text-white/40 text-xs">{pl.songcount || 0} 首歌曲</div>
                            </div>
                            <ChevronRight size={16} className="text-white/30" />
                          </div>
                        ))}
                      </div>
                    )}
                    {playlistTracks.length > 0 && (
                      <div className="mt-6">
                        <h3 className="text-white/80 font-medium mb-3">{currentPlaylistName}</h3>
                        <div className="space-y-1">
                          {playlistTracks.map((song, i) => (
                            <div key={song.Hash + i} onClick={() => handlePlaySong(song)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors" style={{ background: playingHash === song.Hash ? 'rgba(168,85,247,0.2)' : 'transparent' }}
                              onMouseEnter={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                              onMouseLeave={(e) => { if (playingHash !== song.Hash) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                              <span className="w-6 text-center text-white/40 text-sm">{i + 1}</span>
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
