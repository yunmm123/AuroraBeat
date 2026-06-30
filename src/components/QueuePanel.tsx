import { motion, AnimatePresence } from 'framer-motion'
import { X, Music, Play } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'

export default function QueuePanel() {
  const { showQueue, toggleQueue, queue, queueIndex, currentSong } = usePlayerStore()
  
  const handlePlaySong = (index: number) => {
    const song = queue[index]
    if (!song) return
    
    const { playSong } = usePlayerStore.getState()
    // If the song has no URL, we need to pass the full queue
    // and the store will resolve the URL via the effect chain
    if (song.url || song.source === 'local') {
      usePlayerStore.setState({
        currentSong: song,
        queueIndex: index,
        isPlaying: true,
        currentTime: 0,
        lyrics: [],
        lyricsLoading: true,
      })
      // Load lyrics for the selected song
      const trackName = song.title.replace(/\.[^.]+$/, '')
      const artistName = song.artist !== '未知艺术家' ? song.artist : ''
      const songHash = (song as any).hash || ''
      // Trigger lyrics loading
      const { loadLyricsForSong } = usePlayerStore.getState() as any
      if (typeof loadLyricsForSong === 'function') {
        loadLyricsForSong(trackName, artistName, song.duration, songHash)
      }
    } else {
      // For cloud songs without URL, set the song and let the resolveSongUrl handle it
      usePlayerStore.setState({
        currentSong: song,
        queueIndex: index,
        isPlaying: true,
        currentTime: 0,
        lyrics: [],
        lyricsLoading: true,
      })
      // Trigger URL resolution
      const { resolveSongUrl } = (usePlayerStore as any).getState?.()
      if (typeof resolveSongUrl === 'function') {
        resolveSongUrl(song, index)
      }
    }
  }
  
  if (!showQueue) return null
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="w-72 h-full glass-panel m-4 ml-0 rounded-2xl p-4 flex flex-col pointer-events-auto overflow-hidden"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-lg">播放队列</h2>
          <button
            onClick={toggleQueue}
            className="w-8 h-8 rounded-lg glass-button flex items-center justify-center text-white/60 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        
        <div className="text-white/60 text-sm mb-3">
          共 {queue.length} 首歌曲
        </div>
        
        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1">
          {queue.map((song, index) => (
            <motion.div
              key={song.id}
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: index * 0.02 }}
              onClick={() => handlePlaySong(index)}
              className={`p-2 rounded-xl cursor-pointer transition-all ${
                index === queueIndex
                  ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/10'
                  : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex-shrink-0 flex items-center justify-center relative">
                  {index === queueIndex ? (
                    <div className="flex items-end gap-0.5 h-4">
                      <motion.div
                        animate={{ height: ['40%', '100%', '40%'] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: 0 }}
                        className="w-0.5 bg-purple-400 rounded-full"
                        style={{ height: '100%' }}
                      />
                      <motion.div
                        animate={{ height: ['60%', '30%', '60%'] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }}
                        className="w-0.5 bg-pink-400 rounded-full"
                        style={{ height: '60%' }}
                      />
                      <motion.div
                        animate={{ height: ['30%', '80%', '30%'] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: 0.4 }}
                        className="w-0.5 bg-purple-400 rounded-full"
                        style={{ height: '40%' }}
                      />
                    </div>
                  ) : (
                    <Music size={16} className="text-white/50" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${
                    index === queueIndex ? 'text-purple-300' : 'text-white'
                  }`}>
                    {song.title}
                  </div>
                  <div className="text-white/50 text-xs truncate">
                    {song.artist}
                  </div>
                </div>
                <div className="text-white/40 text-xs">
                  {formatTime(song.duration)}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
