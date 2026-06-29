import { motion, AnimatePresence } from 'framer-motion'
import { Music3, Play, Clock } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/types'

function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SongListPanel() {
  const { currentPlaylist, currentSong, playSong, isPlaying } = usePlayerStore()

  const songs: Song[] = currentPlaylist?.songs || []

  if (!currentPlaylist) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-0 overflow-y-auto scrollbar-thin p-8"
      >
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-6 mb-8">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Music3 size={32} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">{currentPlaylist.name}</h1>
              <p className="text-white/50 mt-1">{songs.length} 首歌曲</p>
            </div>
          </div>

          {songs.length === 0 ? (
            <div className="text-center py-20">
              <Music3 size={48} className="text-white/20 mx-auto mb-4" />
              <p className="text-white/40 text-lg">暂无歌曲</p>
              <p className="text-white/30 text-sm mt-2">点击左侧上传按钮添加本地音乐</p>
            </div>
          ) : (
            <div className="space-y-1">
              {songs.map((song, index) => {
                const isActive = currentSong?.id === song.id
                return (
                  <motion.div
                    key={song.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.03 }}
                    onClick={() => playSong(song)}
                    className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all group ${
                      isActive
                        ? 'bg-white/10'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="w-8 text-center">
                      {isActive && isPlaying ? (
                        <div className="flex items-center justify-center gap-0.5">
                          <span className="w-0.5 h-3 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                          <span className="w-0.5 h-4 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                          <span className="w-0.5 h-2 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                        </div>
                      ) : (
                        <span className="text-white/40 text-sm group-hover:hidden">{index + 1}</span>
                      )}
                      <Play size={14} className="text-white hidden group-hover:block mx-auto" />
                    </div>

                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center flex-shrink-0">
                      <Music3 size={14} className="text-white/60" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${isActive ? 'text-purple-300' : 'text-white'}`}>
                        {song.title}
                      </div>
                      <div className="text-white/40 text-xs truncate">{song.artist}</div>
                    </div>

                    <div className="text-white/30 text-xs flex items-center gap-1">
                      <Clock size={12} />
                      {formatDuration(song.duration)}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
