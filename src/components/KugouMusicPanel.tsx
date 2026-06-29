import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Play, Music, User, ListMusic, Trophy, Radio,
  Disc3, ChevronRight, Loader2, LogIn, LogOut, Heart,
  TrendingUp, Disc, Headphones, X
} from 'lucide-react'
import {
  kugouSearch, kugouSongUrl, kugouSearchHot, kugouSearchDefault,
  kugouTopSong, kugouTopPlaylist, kugouRankList, kugouDiantai,
  kugouFmClass, kugouRecommendSongs, kugouUserPlaylist,
  kugouPlaylistTrackAll, kugouEverydayRecommend
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
  FileSize?: number
  SQFileSize?: number
  HQFileSize?: number
}

export default function KugouMusicPanel({
  onClose, onPlaySong, userInfo, onLoginClick, onLogout
}: KugouMusicPanelProps) {
  const [activeTab, setActiveTab] = useState<'discover' | 'rank' | 'playlist' | 'user'>('discover')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KugouSongItem[]>([])
  const [hotKeywords, setHotKeywords] = useState<string[]>([])
  const [topSongs, setTopSongs] = useState<KugouSongItem[]>([])
  const [rankList, setRankList] = useState<any[]>([])
  const [fmClasses, setFmClasses] = useState<any[]>([])
  const [recommendSongs, setRecommendSongs] = useState<KugouSongItem[]>([])
  const [userPlaylists, setUserPlaylists] = useState<any[]>([])
  const [playlistTracks, setPlaylistTracks] = useState<KugouSongItem[]>([])
  const [currentPlaylistName, setCurrentPlaylistName] = useState('')
  const [loading, setLoading] = useState(false)
  const [playingHash, setPlayingHash] = useState('')

  // Load discover data
  useEffect(() => {
    loadDiscoverData()
  }, [])

  // Load user playlists when switching to user tab
  useEffect(() => {
    if (activeTab === 'user' && userInfo) {
      loadUserPlaylists()
    }
  }, [activeTab, userInfo])

  async function loadDiscoverData() {
    setLoading(true)
    try {
      const [hotRes, topRes, rankRes, fmRes, recommendRes] = await Promise.allSettled([
        kugouSearchHot(),
        kugouTopSong(),
        kugouRankList(),
        kugouFmClass(),
        kugouRecommendSongs(),
      ])

      if (hotRes.status === 'fulfilled') {
        const keywords = hotRes.value?.data?.info?.map((i: any) => i.keyword) || []
        setHotKeywords(keywords.slice(0, 10))
      }

      if (topRes.status === 'fulfilled') {
        const songs = topRes.value?.data?.info || []
        setTopSongs(songs.slice(0, 20))
      }

      if (rankRes.status === 'fulfilled') {
        const ranks = rankRes.value?.data?.list || []
        setRankList(ranks.slice(0, 12))
      }

      if (fmRes.status === 'fulfilled') {
        const classes = fmRes.value?.data?.info || []
        setFmClasses(classes.slice(0, 10))
      }

      if (recommendRes.status === 'fulfilled') {
        const songs = recommendRes.value?.data?.info || []
        setRecommendSongs(songs.slice(0, 20))
      }
    } catch (error) {
      console.error('Failed to load discover data:', error)
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
    } catch (error) {
      console.error('Failed to load user playlists:', error)
    }
    setLoading(false)
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return
    setLoading(true)
    try {
      const res = await kugouSearch(searchQuery.trim())
      const songs = res?.data?.lists || []
      setSearchResults(songs)
    } catch (error) {
      console.error('Search failed:', error)
    }
    setLoading(false)
  }

  async function handlePlayHotKeyword(keyword: string) {
    setSearchQuery(keyword)
    setLoading(true)
    try {
      const res = await kugouSearch(keyword)
      const songs = res?.data?.lists || []
      setSearchResults(songs)
    } catch (error) {
      console.error('Search failed:', error)
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
    } catch (error) {
      console.error('Failed to get song URL:', error)
    }
  }

  async function handleOpenPlaylist(playlist: any) {
    setLoading(true)
    setCurrentPlaylistName(playlist.specialname || playlist.playlistname || '歌单')
    try {
      const res = await kugouPlaylistTrackAll(playlist.id || playlist.specialid)
      const songs = res?.data?.data || []
      setPlaylistTracks(songs)
    } catch (error) {
      console.error('Failed to load playlist:', error)
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
    { id: 'playlist' as const, label: '歌单', icon: ListMusic },
    { id: 'user' as const, label: '我的', icon: User },
  ]

  return (
    <div className="h-full flex flex-col bg-[#0a0a1a]/80 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Music size={16} className="text-white" />
          </div>
          <h2 className="text-white font-medium text-lg">酷狗音乐</h2>
        </div>
        <div className="flex items-center gap-2">
          {userInfo ? (
            <div className="flex items-center gap-2">
              <span className="text-white/70 text-sm">{userInfo.nickname}</span>
              <button
                onClick={onLogout}
                className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                title="退出登录"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={onLoginClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white text-sm transition-colors"
            >
              <LogIn size={14} />
              <span>登录</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-5 py-3">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索歌曲、歌手、专辑..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/10 border border-white/10 text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-purple-500/50 focus:bg-white/15 transition-colors"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : '搜索'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-5 gap-1 border-b border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchResults([]) }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-purple-400 border-purple-400'
                : 'text-white/50 border-transparent hover:text-white/80'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
        <AnimatePresence mode="wait">
          {/* Search Results */}
          {searchResults.length > 0 && (
            <motion.div
              key="search"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <h3 className="text-white/80 font-medium mb-3">搜索结果 ({searchResults.length})</h3>
              <div className="space-y-1">
                {searchResults.map((song, i) => (
                  <div
                    key={song.Hash + i}
                    onClick={() => handlePlaySong(song)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                      playingHash === song.Hash
                        ? 'bg-purple-600/30 border border-purple-500/30'
                        : 'hover:bg-white/10 border border-transparent'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                      {playingHash === song.Hash ? (
                        <div className="flex gap-0.5 items-end h-4">
                          <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '60%' }} />
                          <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.2s' }} />
                          <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0.4s' }} />
                        </div>
                      ) : (
                        <Play size={14} className="text-white/60" />
                      )}
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
          {activeTab === 'discover' && searchResults.length === 0 && (
            <motion.div
              key="discover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Hot Search */}
              {hotKeywords.length > 0 && (
                <div>
                  <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2">
                    <TrendingUp size={16} className="text-orange-400" />
                    热搜榜
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {hotKeywords.map((kw, i) => (
                      <button
                        key={i}
                        onClick={() => handlePlayHotKeyword(kw)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 text-xs transition-colors"
                      >
                        {kw}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Songs */}
              {topSongs.length > 0 && (
                <div>
                  <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2">
                    <Headphones size={16} className="text-blue-400" />
                    新歌速递
                  </h3>
                  <div className="space-y-1">
                    {topSongs.slice(0, 10).map((song, i) => (
                      <div
                        key={song.Hash + i}
                        onClick={() => handlePlaySong(song)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                          playingHash === song.Hash
                            ? 'bg-purple-600/30 border border-purple-500/30'
                            : 'hover:bg-white/10 border border-transparent'
                        }`}
                      >
                        <span className="w-6 text-center text-white/40 text-sm font-medium">{i + 1}</span>
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                          {playingHash === song.Hash ? (
                            <div className="flex gap-0.5 items-end h-4">
                              <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '60%' }} />
                              <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.2s' }} />
                              <div className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: '40%', animationDelay: '0.4s' }} />
                            </div>
                          ) : (
                            <Play size={14} className="text-white/60" />
                          )}
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

              {/* FM Classes */}
              {fmClasses.length > 0 && (
                <div>
                  <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2">
                    <Radio size={16} className="text-green-400" />
                    电台频道
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {fmClasses.map((cls: any) => (
                      <div
                        key={cls.classid}
                        className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-colors"
                      >
                        <div className="text-white text-sm font-medium truncate">{cls.classname}</div>
                        <div className="text-white/40 text-xs mt-1">{cls.intro || '精选电台'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommend */}
              {recommendSongs.length > 0 && (
                <div>
                  <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2">
                    <Heart size={16} className="text-pink-400" />
                    每日推荐
                  </h3>
                  <div className="space-y-1">
                    {recommendSongs.slice(0, 10).map((song, i) => (
                      <div
                        key={song.Hash + i}
                        onClick={() => handlePlaySong(song)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                          playingHash === song.Hash
                            ? 'bg-purple-600/30 border border-purple-500/30'
                            : 'hover:bg-white/10 border border-transparent'
                        }`}
                      >
                        <span className="w-6 text-center text-white/40 text-sm font-medium">{i + 1}</span>
                        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
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
          {activeTab === 'rank' && searchResults.length === 0 && (
            <motion.div
              key="rank"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2">
                <Trophy size={16} className="text-yellow-400" />
                排行榜
              </h3>
              {rankList.length === 0 ? (
                <div className="text-white/40 text-center py-8">暂无榜单数据</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {rankList.map((rank: any) => (
                    <div
                      key={rank.rankid}
                      className="p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-colors group"
                    >
                      <div className="text-white text-sm font-medium truncate group-hover:text-purple-400 transition-colors">
                        {rank.rankname}
                      </div>
                      <div className="text-white/40 text-xs mt-1 truncate">
                        {rank.intro || '热门榜单'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Playlist Tab */}
          {activeTab === 'playlist' && searchResults.length === 0 && (
            <motion.div
              key="playlist"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <h3 className="text-white/80 font-medium mb-3 flex items-center gap-2">
                <ListMusic size={16} className="text-cyan-400" />
                精选歌单
              </h3>
              <div className="text-white/40 text-center py-8">
                歌单功能开发中...
              </div>
            </motion.div>
          )}

          {/* User Tab */}
          {activeTab === 'user' && searchResults.length === 0 && (
            <motion.div
              key="user"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {!userInfo ? (
                <div className="text-center py-12">
                  <User size={48} className="text-white/20 mx-auto mb-4" />
                  <p className="text-white/60 text-lg mb-2">登录酷狗音乐</p>
                  <p className="text-white/40 text-sm mb-6">登录后可以查看你的歌单和收藏</p>
                  <button
                    onClick={onLoginClick}
                    className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors"
                  >
                    扫码登录
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
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
                        <div
                          key={pl.id || pl.specialid}
                          onClick={() => handleOpenPlaylist(pl)}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-colors"
                        >
                          <ListMusic size={18} className="text-purple-400" />
                          <div className="flex-1 min-w-0">
                            <div className="text-white text-sm font-medium truncate">
                              {pl.specialname || pl.playlistname}
                            </div>
                            <div className="text-white/40 text-xs">
                              {pl.songcount || 0} 首歌曲
                            </div>
                          </div>
                          <ChevronRight size={16} className="text-white/30" />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Playlist tracks */}
                  {playlistTracks.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-white/80 font-medium mb-3">{currentPlaylistName}</h3>
                      <div className="space-y-1">
                        {playlistTracks.map((song, i) => (
                          <div
                            key={song.Hash + i}
                            onClick={() => handlePlaySong(song)}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                              playingHash === song.Hash
                                ? 'bg-purple-600/30 border border-purple-500/30'
                                : 'hover:bg-white/10 border border-transparent'
                            }`}
                          >
                            <span className="w-6 text-center text-white/40 text-sm">{i + 1}</span>
                            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
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
  )
}
