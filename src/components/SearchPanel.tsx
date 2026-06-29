import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Music3, Play } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'

export default function SearchPanel() {
  const { showSearch, toggleSearch, searchQuery, searchResults, setSearchQuery, playSong } = usePlayerStore()

  if (!showSearch) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-40 flex items-start justify-center pt-20 pointer-events-auto"
        style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(5px)' }}
        onClick={(e) => e.target === e.currentTarget && toggleSearch()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: -20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: -20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="glass-panel rounded-3xl w-[600px] max-h-[500px] overflow-hidden backdrop-blur-xl"
        >
          <div className="flex items-center gap-3 p-4 border-b border-white/10">
            <Search size={20} className="text-white/50 ml-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索歌曲、歌手、专辑..."
              autoFocus
              className="flex-1 bg-transparent text-white text-lg outline-none placeholder-white/30"
            />
            <button
              onClick={toggleSearch}
              className="w-8 h-8 rounded-full glass-button flex items-center justify-center text-white/60 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="overflow-y-auto max-h-[400px] p-2">
            {searchQuery === '' && (
              <div className="text-center py-12 text-white/40">
                <Search size={48} className="mx-auto mb-4 opacity-30" />
                <p>输入关键词搜索本地音乐</p>
              </div>
            )}

            {searchQuery !== '' && searchResults.length === 0 && (
              <div className="text-center py-12 text-white/40">
                <Music3 size={48} className="mx-auto mb-4 opacity-30" />
                <p>没有找到相关歌曲</p>
              </div>
            )}

            {searchResults.map((song, i) => (
              <motion.div
                key={song.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => { playSong(song); toggleSearch() }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer hover:bg-white/5 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center flex-shrink-0">
                  <Music3 size={16} className="text-white/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{song.title}</div>
                  <div className="text-white/50 text-xs truncate">{song.artist} - {song.album}</div>
                </div>
                <Play size={16} className="text-white/0 group-hover:text-white/60 transition-colors" />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
