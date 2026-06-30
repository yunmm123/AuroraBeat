import { motion, AnimatePresence } from 'framer-motion'
import { usePlayerStore } from '@/store/playerStore'
import { useEffect, useState, useMemo } from 'react'
import { Music3, Loader2, RefreshCw } from 'lucide-react'
import type { LyricLine } from '@/types'

export default function LyricsVisual() {
  const { currentSong, currentTime, isPlaying, lyrics, lyricsLoading, refreshLyrics } = usePlayerStore()
  const [currentLyricIndex, setCurrentLyricIndex] = useState(0)

  useEffect(() => {
    if (!isPlaying || !currentSong || lyrics.length === 0) return
    
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

  // Calculate progress within current lyric line
  const currentLyric = lyrics[currentLyricIndex]
  const nextLyric = lyrics[currentLyricIndex + 1]
  const lyricProgress = useMemo(() => {
    if (!currentLyric || !nextLyric) return 0
    const start = currentLyric.time
    const end = nextLyric.time
    if (end <= start) return 0
    return Math.min(1, Math.max(0, (currentTime - start) / (end - start)))
  }, [currentTime, currentLyric, nextLyric])

  if (!currentSong) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-white/30 text-2xl font-light">
          上传音乐开始体验
        </div>
      </div>
    )
  }

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

  if (lyrics.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
        <div className="text-center">
          <Music3 size={48} className="text-white/20 mx-auto mb-4" />
          <div className="text-white/60 text-2xl font-medium mb-2">{currentSong.title}</div>
          <div className="text-white/40 text-lg mb-6">{currentSong.artist}</div>
          <button
            onClick={refreshLyrics}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glass-button text-white/70 hover:text-white transition-colors"
          >
            <RefreshCw size={16} />
            <span>刷新歌词</span>
          </button>
        </div>
      </div>
    )
  }

  // Show 7 lines: 3 previous, current, 3 next
  const visibleLyrics: Array<LyricLine & { offset: number; isActive: boolean }> = []
  for (let i = -3; i <= 3; i++) {
    const idx = currentLyricIndex + i
    if (idx >= 0 && idx < lyrics.length) {
      visibleLyrics.push({
        ...lyrics[idx],
        offset: i,
        isActive: i === 0,
      })
    }
  }

  // Split current lyric into words for karaoke highlighting
  const currentText = currentLyric?.text || ''
  const words = currentText.split(/(\s+)/g)
  const highlightedWordCount = Math.floor(lyricProgress * words.length)

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-auto overflow-hidden">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-purple-900/10 via-transparent to-indigo-900/10" />
      
      <div className="relative w-full max-w-4xl h-[32rem] flex flex-col items-center justify-center">
        <AnimatePresence mode="popLayout">
          {visibleLyrics.map((lyric) => {
            const distance = Math.abs(lyric.offset)
            const isActive = lyric.isActive
            
            return (
              <motion.div
                key={`${lyric.time}-${lyric.text}`}
                initial={{ 
                  opacity: 0,
                  y: lyric.offset > 0 ? 80 : -80,
                }}
                animate={{ 
                  opacity: isActive ? 1 : Math.max(0.15, 0.6 - distance * 0.15),
                  y: lyric.offset * 52,
                  scale: isActive ? 1.15 : 0.9 - distance * 0.03,
                  filter: isActive ? 'blur(0px)' : `blur(${1 + distance * 0.5}px)`,
                }}
                exit={{ 
                  opacity: 0,
                  y: lyric.offset < 0 ? 80 : -80,
                }}
                transition={{ 
                  duration: 0.5,
                  ease: [0.4, 0, 0.2, 1],
                }}
                className={`absolute text-center max-w-2xl px-8 ${
                  isActive 
                    ? 'text-white' 
                    : 'text-white/40'
                }`}
              >
                {isActive ? (
                  <div className="text-4xl font-bold leading-relaxed">
                    {words.map((word, wi) => {
                      const isHighlighted = wi < highlightedWordCount
                      return (
                        <span
                          key={wi}
                          className={`transition-colors duration-200 ${
                            isHighlighted
                              ? 'text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-white to-pink-300'
                              : 'text-white/50'
                          }`}
                          style={{
                            textShadow: isHighlighted
                              ? '0 0 30px rgba(139, 92, 246, 0.5), 0 0 60px rgba(236, 72, 153, 0.3)'
                              : 'none',
                          }}
                        >
                          {word}
                        </span>
                      )
                    })}
                  </div>
                ) : (
                  <div 
                    className={`${distance <= 1 ? 'text-2xl' : 'text-xl'} font-light`}
                    style={{
                      textShadow: distance <= 1 
                        ? '0 0 10px rgba(139, 92, 246, 0.2)' 
                        : 'none',
                    }}
                  >
                    {lyric.text}
                  </div>
                )}
                
                {/* Translation line */}
                {lyric.translation && isActive && (
                  <div className="text-white/40 text-lg mt-1 font-light italic">
                    {lyric.translation}
                  </div>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
        
        {/* Lyric progress indicator on active line */}
        {currentLyric && nextLyric && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-48">
            <motion.div
              className="h-0.5 rounded-full bg-gradient-to-r from-purple-500/50 to-pink-500/50"
              style={{ width: `${lyricProgress * 100}%` }}
              animate={{ width: `${lyricProgress * 100}%` }}
              transition={{ duration: 0.1, ease: 'linear' }}
            />
          </div>
        )}
      </div>
    </div>
  )
}