import { motion } from 'framer-motion'
import { usePlayerStore } from '@/store/playerStore'
import { SkipBack, SkipForward, Disc3, Music } from 'lucide-react'

export default function NowPlayingView() {
  const { currentSong, isPlaying, currentTime, duration, audioFeatures } = usePlayerStore()

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  if (!currentSong) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="w-32 h-32 mx-auto mb-6 rounded-full bg-white/5 flex items-center justify-center">
            <Music size={48} className="text-white/20" />
          </div>
          <div className="text-white/30 text-2xl font-light">
            上传音乐开始体验
          </div>
        </motion.div>
      </div>
    )
  }

  const beatPulse = audioFeatures?.beatIntensity ?? 0

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="flex flex-col items-center gap-6"
      >
        {/* Album Art */}
        <div className="relative">
          {/* Outer glow ring */}
          <motion.div
            className="absolute -inset-4 rounded-full opacity-40"
            style={{
              background: `conic-gradient(from 0deg, transparent, var(--color-primary), var(--color-accent), transparent)`,
            }}
            animate={{
              rotate: 360,
              scale: [1, 1 + beatPulse * 0.05, 1],
            }}
            transition={{
              rotate: { duration: 12, repeat: Infinity, ease: 'linear' },
              scale: { duration: 0.5, repeat: Infinity, ease: 'easeInOut' },
            }}
          />

          {/* Second glow ring */}
          <motion.div
            className="absolute -inset-8 rounded-full opacity-20"
            style={{
              background: `conic-gradient(from 180deg, transparent, var(--color-accent), var(--color-primary), transparent)`,
            }}
            animate={{
              rotate: -360,
              scale: [1, 1 + beatPulse * 0.08, 1],
            }}
            transition={{
              rotate: { duration: 20, repeat: Infinity, ease: 'linear' },
              scale: { duration: 0.7, repeat: Infinity, ease: 'easeInOut' },
            }}
          />

          {/* Album art circle */}
          <motion.div
            className="relative w-48 h-48 rounded-full overflow-hidden shadow-2xl"
            style={{
              boxShadow: `0 0 60px rgba(139, 92, 246, 0.3), 0 0 120px rgba(99, 102, 241, 0.15)`,
            }}
            animate={{
              rotate: isPlaying ? 360 : 0,
            }}
            transition={{
              rotate: {
                duration: 20,
                repeat: Infinity,
                ease: 'linear',
              },
            }}
          >
            {currentSong.cover ? (
              <img
                src={currentSong.cover}
                alt={currentSong.album}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-600 to-indigo-800 flex items-center justify-center">
                <Disc3 size={56} className="text-white/40" />
              </div>
            )}
          </motion.div>

          {/* Center dot */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white/80 shadow-lg z-10" />
        </div>

        {/* Song Info */}
        <div className="text-center">
          <motion.h2
            key={currentSong.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold text-white mb-1 max-w-md truncate"
          >
            {currentSong.title}
          </motion.h2>
          <motion.p
            key={currentSong.id + '-artist'}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-white/60 text-lg mb-1"
          >
            {currentSong.artist}
          </motion.p>
          {currentSong.album && currentSong.album !== '未知专辑' && (
            <motion.p
              key={currentSong.id + '-album'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-white/40 text-sm"
            >
              {currentSong.album}
            </motion.p>
          )}
        </div>

        {/* Progress Bar */}
        <div className="w-80">
          <div className="progress-bar h-1.5 rounded-full cursor-pointer group">
            <motion.div
              className="progress-fill rounded-full"
              style={{ width: `${progress}%` }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.1, ease: 'linear' }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-white/40 text-xs">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => usePlayerStore.getState().prevSong()}
            className="w-12 h-12 rounded-full glass-button flex items-center justify-center text-white/80 hover:text-white transition-colors"
          >
            <SkipBack size={22} fill="currentColor" />
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              const store = usePlayerStore.getState()
              if (store.currentSong?.url) {
                store.setIsPlaying(!store.isPlaying)
              }
            }}
            className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/30 pulse-glow"
            style={{
              boxShadow: `0 0 30px rgba(139, 92, 246, 0.5), 0 0 60px rgba(139, 92, 246, 0.2)`,
            }}
          >
            {isPlaying ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="6" height="16" rx="1" />
                <rect x="14" y="4" width="6" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="ml-1">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => usePlayerStore.getState().nextSong()}
            className="w-12 h-12 rounded-full glass-button flex items-center justify-center text-white/80 hover:text-white transition-colors"
          >
            <SkipForward size={22} fill="currentColor" />
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}