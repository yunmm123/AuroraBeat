import { motion, AnimatePresence } from 'framer-motion'
import { usePlayerStore } from '@/store/playerStore'
import { useEffect, useState } from 'react'

interface LyricLine {
  time: number
  text: string
}

// Mock lyrics for demo (in real app, parse from LRC file)
const mockLyrics: LyricLine[] = [
  { time: 0, text: '♪ 音乐开始 ' },
  { time: 5, text: '在星空下漫步' },
  { time: 10, text: '感受夜的温柔' },
  { time: 15, text: '旋律在心中流淌' },
  { time: 20, text: '时光静静停留' },
  { time: 25, text: '每一个音符' },
  { time: 30, text: '都是心灵的诉说' },
  { time: 35, text: '让梦随风飘远' },
  { time: 40, text: '在这美好的夜晚' },
  { time: 45, text: '与你共舞' },
  { time: 50, text: '直到黎明到来' },
]

export default function LyricsVisual() {
  const { currentSong, currentTime, isPlaying } = usePlayerStore()
  const [currentLyricIndex, setCurrentLyricIndex] = useState(0)

  useEffect(() => {
    if (!isPlaying || !currentSong) return
    
    // Find current lyric line based on currentTime
    let index = 0
    for (let i = 0; i < mockLyrics.length; i++) {
      if (currentTime >= mockLyrics[i].time) {
        index = i
      } else {
        break
      }
    }
    setCurrentLyricIndex(index)
  }, [currentTime, isPlaying, currentSong])

  if (!currentSong) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-white/30 text-2xl font-light">
          上传音乐开始体验
        </div>
      </div>
    )
  }

  // Show 5 lines: 2 previous, current, 2 next
  const visibleLyrics = []
  for (let i = -2; i <= 2; i++) {
    const idx = currentLyricIndex + i
    if (idx >= 0 && idx < mockLyrics.length) {
      visibleLyrics.push({
        ...mockLyrics[idx],
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
