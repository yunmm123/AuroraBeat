import { motion, AnimatePresence } from 'framer-motion'
import { usePlayerStore } from '@/store/playerStore'
import { useEffect, useState } from 'react'
import { Music3, Loader2 } from 'lucide-react'

export default function LyricsVisual() {
  const { currentSong, currentTime, isPlaying, lyrics, lyricsLoading } = usePlayerStore()
  const [currentLyricIndex, setCurrentLyricIndex] = useState(0)

  useEffect(() => {
    if (!isPlaying || !currentSong || lyrics.length === 0) return
    
    // Find current lyric line based on currentTime
    let index = 0
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        index = i
      } else {
        break
      }
    }
    setCurrentLyricIndex(index)
  }, [currentTime, isPlaying, currentSong, lyrics])

  if (!currentSong) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-white/30 text-2xl font-light">
          上传音乐开始体验
        </div>
      </div>
    )
  }

  // Show loading state
  if (lyricsLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-white/40 animate-spin" />
          <div className="text-white/40 text-lg">正在搜索歌词...</div>
        </div>
      </div>
    )
  }

  // No lyrics found - show song info
  if (lyrics.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <Music3 size={48} className="text-white/20 mx-auto mb-4" />
          <div className="text-white/60 text-2xl font-medium mb-2">{currentSong.title}</div>
          <div className="text-white/40 text-lg">{currentSong.artist}</div>
        </div>
      </div>
    )
  }

  // Show 5 lines: 2 previous, current, 2 next
  const visibleLyrics = []
  for (let i = -2; i <= 2; i++) {
    const idx = currentLyricIndex + i
    if (idx >= 0 && idx < lyrics.length) {
      visibleLyrics.push({
        ...lyrics[idx],
        offset: i,
        isActive: i === 0,
      })
    }
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      <div className="relative w-full max-w-4xl h-96 flex flex-col items-center justify-center">
        <AnimatePresence mode="popLayout">
          {visibleLyrics.map((lyric) => (
            <motion.div
              key={`${lyric.time}-${lyric.text}`}
              initial={{ 
                opacity: 0,
                y: lyric.offset > 0 ? 100 : -100,
                scale: lyric.isActive ? 0.8 : 1,
              }}
              animate={{ 
                opacity: lyric.isActive ? 1 : 0.3,
                y: lyric.offset * 60,
                scale: lyric.isActive ? 1.2 : 0.9,
                filter: lyric.isActive ? 'blur(0px)' : 'blur(2px)',
              }}
              exit={{ 
                opacity: 0,
                y: lyric.offset < 0 ? 100 : -100,
              }}
              transition={{ 
                duration: 0.6,
                ease: [0.4, 0, 0.2, 1],
              }}
              className={`absolute text-center ${
                lyric.isActive 
                  ? 'text-white text-4xl font-bold' 
                  : 'text-white/60 text-2xl font-light'
              }`}
              style={{
                textShadow: lyric.isActive 
                  ? '0 0 20px rgba(139, 92, 246, 0.8), 0 0 40px rgba(139, 92, 246, 0.4)' 
                  : 'none',
              }}
            >
              {lyric.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
