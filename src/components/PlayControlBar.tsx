import { motion, AnimatePresence } from 'framer-motion'
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  Mic2,
  Settings,
  Sparkles,
} from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useState, useRef, useEffect } from 'react'

interface PlayControlBarProps {
  onPlayToggle: () => void
}

export default function PlayControlBar({ onPlayToggle }: PlayControlBarProps) {
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    playMode,
    toggleMute,
    setVolume,
    setPlayMode,
    setCurrentTime,
    toggleLyrics,
    toggleQueue,
    toggleSettings,
    showLyrics,
    showQueue,
    audioFeatures,
  } = usePlayerStore()
  
  const progressRef = useRef<HTMLDivElement>(null)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  
  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return
    const rect = progressRef.current.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const newTime = percent * duration
    setCurrentTime(newTime)
  }
  
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value))
  }
  
  const cyclePlayMode = () => {
    const modes: Array<'sequence' | 'shuffle' | 'single' | 'loop'> = ['sequence', 'shuffle', 'single', 'loop']
    const currentIndex = modes.indexOf(playMode)
    const nextIndex = (currentIndex + 1) % modes.length
    setPlayMode(modes[nextIndex])
  }
  
  const getPlayModeIcon = () => {
    switch (playMode) {
      case 'shuffle': return <Shuffle size={18} />
      case 'single': return <Repeat1 size={18} />
      case 'loop': return <Repeat size={18} />
      default: return <Repeat size={18} />
    }
  }
  
  const waveformBars = 32
  const barHeights = Array.from({ length: waveformBars }, (_, i) => {
    if (!audioFeatures) return 0.2
    const idx = Math.floor(i * (audioFeatures.spectrum.length / waveformBars))
    return Math.max(0.1, Math.min(1, (audioFeatures.spectrum[idx] + 100) / 80))
  })
  
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.2 }}
      className="pointer-events-auto p-4"
    >
      <div className="glass-panel rounded-2xl p-4 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex-shrink-0 flex items-center justify-center overflow-hidden">
            <motion.div
              animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              className="w-full h-full flex items-center justify-center"
            >
              <Sparkles size={24} className="text-white/80" />
            </motion.div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <div className="min-w-0">
                <div className="text-white font-medium text-sm truncate">
                  {currentSong?.title || '未播放'}
                </div>
                <div className="text-white/60 text-xs truncate">
                  {currentSong?.artist || '暂无歌曲'}
                </div>
              </div>
              <div className="flex items-center gap-2 text-white/50 text-xs">
                <span>{formatTime(currentTime)}</span>
                <span>/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
            
            <div
              ref={progressRef}
              onClick={handleProgressClick}
              className="progress-bar h-1.5 rounded-full cursor-pointer group"
            >
              <div
                className="progress-fill rounded-full"
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              >
                <div className="absolute inset-0 flex items-center justify-between px-1">
                  {barHeights.map((height, i) => (
                    <div
                      key={i}
                      className="w-0.5 bg-white/30 rounded-full"
                      style={{ height: `${height * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={cyclePlayMode}
              className={`w-10 h-10 rounded-full glass-button flex items-center justify-center transition-colors ${
                playMode !== 'sequence' ? 'text-purple-400' : 'text-white/60 hover:text-white'
              }`}
            >
              {getPlayModeIcon()}
            </button>
            
            <button
              onClick={() => usePlayerStore.getState().prevSong()}
              className="w-10 h-10 rounded-full glass-button flex items-center justify-center text-white/80 hover:text-white"
            >
              <SkipBack size={20} fill="currentColor" />
            </button>
            
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onPlayToggle}
              className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/30 pulse-glow"
            >
              {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
            </motion.button>
            
            <button
              onClick={() => usePlayerStore.getState().nextSong()}
              className="w-10 h-10 rounded-full glass-button flex items-center justify-center text-white/80 hover:text-white"
            >
              <SkipForward size={20} fill="currentColor" />
            </button>
            
            <div className="relative">
              <button
                onClick={toggleMute}
                onMouseEnter={() => setShowVolumeSlider(true)}
                className="w-10 h-10 rounded-full glass-button flex items-center justify-center text-white/60 hover:text-white"
              >
                {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              
              <AnimatePresence>
                {showVolumeSlider && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    onMouseLeave={() => setShowVolumeSlider(false)}
                    className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 glass-panel rounded-xl p-3 w-32"
                  >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-full accent-purple-500"
                    />
                    <div className="text-center text-white/60 text-xs mt-1">
                      {Math.round(volume * 100)}%
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          
          <div className="w-px h-10 bg-white/10" />
          
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLyrics}
              className={`w-10 h-10 rounded-full glass-button flex items-center justify-center transition-colors ${
                showLyrics ? 'text-purple-400' : 'text-white/60 hover:text-white'
              }`}
            >
              <Mic2 size={18} />
            </button>
            
            <button
              onClick={toggleQueue}
              className={`w-10 h-10 rounded-full glass-button flex items-center justify-center transition-colors ${
                showQueue ? 'text-purple-400' : 'text-white/60 hover:text-white'
              }`}
            >
              <ListMusic size={18} />
            </button>
            
            <button
              onClick={toggleSettings}
              className="w-10 h-10 rounded-full glass-button flex items-center justify-center text-white/60 hover:text-white"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
