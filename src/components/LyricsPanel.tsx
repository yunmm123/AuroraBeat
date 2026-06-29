import { motion, AnimatePresence } from 'framer-motion'
import { X, Maximize2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useState, useEffect } from 'react'

export default function LyricsPanel() {
  const { showLyrics, toggleLyrics, currentSong, currentTime } = usePlayerStore()
  const [fullscreen, setFullscreen] = useState(false)
  
  const mockLyrics = [
    { time: 0, text: '♪ 音乐前奏 ♪' },
    { time: 10, text: '在这寂静的夜晚' },
    { time: 15, text: '星光洒满了天边' },
    { time: 20, text: '你的笑容如晨曦般温暖' },
    { time: 25, text: '照亮我前行的方向' },
    { time: 30, text: '穿越时空的旋律' },
    { time: 35, text: '连接着你我的心' },
    { time: 40, text: '让我们一起唱响' },
    { time: 45, text: '这首属于我们的歌' },
    { time: 50, text: '♪ 间奏 ♪' },
    { time: 60, text: '极光在夜空中舞动' },
    { time: 65, text: '像是命运的安排' },
    { time: 70, text: '每一个音符都在诉说' },
    { time: 75, text: '我们的故事' },
    { time: 80, text: '让音乐带走所有忧愁' },
    { time: 85, text: '只留下美好的回忆' },
    { time: 90, text: '在这绚烂的时刻' },
    { time: 95, text: '我们与音乐共舞' },
    { time: 100, text: '♪ 副歌 ♪' },
    { time: 105, text: 'Aurora 照亮夜空' },
    { time: 110, text: 'Beat 跳动的节奏' },
    { time: 115, text: '让我们沉浸在' },
    { time: 120, text: '这美妙的旋律中' },
    { time: 125, text: 'Aurora 心中的光' },
    { time: 130, text: 'Beat 生命的律动' },
    { time: 135, text: '音乐是我们' },
    { time: 140, text: '永恒的信仰' },
  ]
  
  const getCurrentLyricIndex = () => {
    for (let i = mockLyrics.length - 1; i >= 0; i--) {
      if (currentTime >= mockLyrics[i].time) {
        return i
      }
    }
    return 0
  }
  
  const currentIndex = getCurrentLyricIndex()
  
  if (!showLyrics) return null
  
  if (fullscreen) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
          style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(10px)' }}
        >
          <button
            onClick={() => setFullscreen(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full glass-panel flex items-center justify-center text-white/60 hover:text-white"
          >
            <X size={20} />
          </button>
          
          <div className="text-center px-8 max-w-4xl">
            {mockLyrics.slice(Math.max(0, currentIndex - 1), currentIndex + 3).map((line, i) => {
              const actualIndex = Math.max(0, currentIndex - 1) + i
              const isActive = actualIndex === currentIndex
              const offset = i - 1
              
              return (
                <motion.div
                  key={actualIndex}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{
                    opacity: isActive ? 1 : 0.4,
                    y: 0,
                    scale: isActive ? 1.1 : 1,
                  }}
                  transition={{ duration: 0.5 }}
                  className="my-4"
                  style={{
                    transform: `translateY(${offset * 10}px)`,
                  }}
                >
                  <span
                    className={`text-4xl font-bold ${
                      isActive
                        ? 'bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent'
                        : 'text-white/50'
                    }`}
                    style={{
                      textShadow: isActive ? '0 0 40px rgba(167, 139, 250, 0.5)' : 'none',
                    }}
                  >
                    {line.text}
                  </span>
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      </AnimatePresence>
    )
  }
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="absolute left-1/2 bottom-32 -translate-x-1/2 z-20 pointer-events-auto"
      >
        <div className="glass-panel rounded-2xl px-6 py-4 backdrop-blur-xl min-w-96 max-w-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-white/60 text-xs">歌词</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFullscreen(true)}
                className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white"
              >
                <Maximize2 size={14} />
              </button>
              <button
                onClick={toggleLyrics}
                className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          
          <div className="text-center space-y-1 overflow-hidden h-20">
            {currentIndex > 0 && (
              <div className="text-white/40 text-sm truncate">
                {mockLyrics[currentIndex - 1].text}
              </div>
            )}
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="text-white font-medium text-lg truncate bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent"
            >
              {mockLyrics[currentIndex]?.text || ''}
            </motion.div>
            {currentIndex < mockLyrics.length - 1 && (
              <div className="text-white/40 text-sm-sm truncate">
                {mockLyrics[currentIndex + 1]?.text || ''}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
