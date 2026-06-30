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
  Disc3,
} from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useState, useRef } from 'react'
import Tooltip from './Tooltip'

interface PlayControlBarProps {
  onPlayToggle: () => void
  onSeek?: (time: number) => void
}

export default function PlayControlBar({ onPlayToggle, onSeek }: PlayControlBarProps) {
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
    if (onSeek) {
      onSeek(newTime)
    } else {
      setCurrentTime(newTime)
    }
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

  const getPlayModeLabel = () => {
    switch (playMode) {
      case 'shuffle': return '随机播放'
      case 'single': return '单曲循环'
      case 'loop': return '列表循环'
      default: return '顺序播放'
    }
  }
  
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const beatIntensity = audioFeatures?.beatIntensity ?? 0
  
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.2 }}
      className="pointer-events-auto p-3"
    >
      <div className="glass-panel rounded-2xl p-3 backdrop-blur-2xl border-white/10"
        style={{
          background: 'rgba(15, 15, 25, 0.6)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        }}
      >
        {/* Progress bar - full width above */}
        <div className="px-2 mb-2">
          <div
            ref={progressRef}
            onClick={handleProgressClick}
            className="progress-bar h-1.5 rounded-full cursor-pointer group"
            style={{ background: 'rgba(255, 255, 255, 0.06)' }}
          >
            <div
              className="h-full rounded-full relative overflow-hidden"
              style={{ width: `${progress}%` }}
            >
              <div 
                className="absolute inset-0 rounded-full"
                style={{
                  background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent), #ec4899)',
                }}
              />
              {/* Glow effect on progress */}
              <div 
                className="absolute inset-0 rounded-full blur-sm opacity-60"
                style={{
                  background: 'linear-gradient(90deg, var(--color-primary), var(--color-accent))',
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Album art thumbnail */}
          <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-purple-500/30 to-pink-500/30 border border-white/10">
            {currentSong?.cover ? (
              <img src={currentSong.cover} alt="" className="w-full h-full object-cover" />
            ) : (
              <motion.div
                animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                className="w-full h-full flex items-center justify-center"
              >
                <Disc3 size={20} className="text-white/30" />
              </motion.div>
            )}
          </div>
          
          {/* Song info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-white font-medium text-sm truncate">
                  {currentSong?.title || '未播放'}
                </div>
                <div className="text-white/50 text-xs truncate">
                  {currentSong?.artist || '暂无歌曲'}
                </div>
              </div>
              <div className="flex items-center gap-2 text-white/40 text-xs ml-4">
                <span>{formatTime(currentTime)}</span>
                <span className="text-white/20">/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>
          
          {/* Controls */}
          <div className="flex items-center gap-1.5">
            <Tooltip text={getPlayModeLabel()} position="top">
              <button
                onClick={cyclePlayMode}
                className={`w-9 h-9 rounded-full glass-button flex items-center justify-center transition-colors ${
                  playMode !== 'sequence' ? 'text-purple-400' : 'text-white/50 hover:text-white'
                }`}
              >
                {getPlayModeIcon()}
              </button>
            </Tooltip>
            
            <Tooltip text="上一首" position="top">
              <button
                onClick={() => usePlayerStore.getState().prevSong()}
                className="w-9 h-9 rounded-full glass-button flex items-center justify-center text-white/70 hover:text-white"
              >
                <SkipBack size={18} fill="currentColor" />
              </button>
            </Tooltip>
            
            {/* Play button with glow */}
            <Tooltip text={isPlaying ? '暂停' : '播放'} position="top">
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={onPlayToggle}
                className="w-12 h-12 rounded-full flex items-center justify-center text-white relative"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                  boxShadow: `0 0 ${20 + beatIntensity * 15}px rgba(139, 92, 246, 0.5), 0 0 ${40 + beatIntensity * 30}px rgba(236, 72, 153, 0.2)`,
                }}
                animate={{
                  boxShadow: isPlaying
                    ? `0 0 ${20 + beatIntensity * 15}px rgba(139, 92, 246, 0.5), 0 0 ${40 + beatIntensity * 30}px rgba(236, 72, 153, 0.2)`
                    : '0 0 20px rgba(139, 92, 246, 0.3), 0 0 40px rgba(236, 72, 153, 0.1)',
                }}
              >
                {isPlaying ? (
                  <Pause size={24} fill="currentColor" />
                ) : (
                  <Play size={24} fill="currentColor" className="ml-0.5" />
                )}
              </motion.button>
            </Tooltip>
            
            <Tooltip text="下一首" position="top">
              <button
                onClick={() => usePlayerStore.getState().nextSong()}
                className="w-9 h-9 rounded-full glass-button flex items-center justify-center text-white/70 hover:text-white"
              >
                <SkipForward size={18} fill="currentColor" />
              </button>
            </Tooltip>
            
            <div className="relative">
              <Tooltip text={isMuted || volume === 0 ? '取消静音' : '音量'} position="top">
                <button
                  onClick={toggleMute}
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  className="w-9 h-9 rounded-full glass-button flex items-center justify-center text-white/50 hover:text-white"
                >
                  {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </Tooltip>
              
              <AnimatePresence>
                {showVolumeSlider && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    onMouseLeave={() => setShowVolumeSlider(false)}
                    className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 glass-panel rounded-xl p-3 w-32"
                    style={{
                      background: 'rgba(20, 20, 30, 0.8)',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                    }}
                  >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-full accent-purple-500"
                      style={{
                        background: `linear-gradient(90deg, var(--color-primary) ${volume * 100}%, rgba(255,255,255,0.1) ${volume * 100}%)`,
                        height: '4px',
                        borderRadius: '2px',
                        appearance: 'none',
                        cursor: 'pointer',
                      }}
                    />
                    <div className="text-center text-white/50 text-xs mt-1">
                      {Math.round(volume * 100)}%
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          
          {/* Divider */}
          <div className="w-px h-8 bg-white/8" />
          
          {/* Right side buttons */}
          <div className="flex items-center gap-1">
            <Tooltip text={showLyrics ? '隐藏歌词' : '显示歌词'} position="top">
              <button
                onClick={toggleLyrics}
                className={`w-9 h-9 rounded-full glass-button flex items-center justify-center transition-colors ${
                  showLyrics ? 'text-purple-400' : 'text-white/50 hover:text-white'
                }`}
              >
                <Mic2 size={16} />
              </button>
            </Tooltip>
            
            <Tooltip text={showQueue ? '隐藏队列' : '播放队列'} position="top">
              <button
                onClick={toggleQueue}
                className={`w-9 h-9 rounded-full glass-button flex items-center justify-center transition-colors ${
                  showQueue ? 'text-purple-400' : 'text-white/50 hover:text-white'
                }`}
              >
                <ListMusic size={16} />
              </button>
            </Tooltip>
            
            <Tooltip text="设置" position="top">
              <button
                onClick={toggleSettings}
                className="w-9 h-9 rounded-full glass-button flex items-center justify-center text-white/50 hover:text-white"
              >
                <Settings size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </motion.div>
  )
}