import { motion } from 'framer-motion'
import { Minus, Square, X, User, Search } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useState } from 'react'
import Tooltip from './Tooltip'

export default function TitleBar() {
  const { currentSong, toggleSettings, toggleSearch, showSearch } = usePlayerStore()
  const [isMaximized, setIsMaximized] = useState(false)
  
  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.window.minimize()
    }
  }
  
  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.window.maximize().then((maximized: boolean) => {
        setIsMaximized(maximized)
      })
    }
  }
  
  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.window.close()
    }
  }
  
  return (
    <motion.div
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="h-14 flex items-center justify-between px-4 pointer-events-auto title-bar-drag"
      style={{
        background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%)',
      }}
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <span className="font-semibold text-white/90 text-sm">AuroraBeat</span>
      </div>
      
      <div className="flex-1 max-w-md mx-8">
        {currentSong && (
          <div className="text-center">
            <div className="text-white font-medium text-sm truncate">
              {currentSong.title}
            </div>
            <div className="text-white/60 text-xs truncate">
              {currentSong.artist}
            </div>
          </div>
        )}
      </div>
      
      <div className="flex items-center gap-2 title-bar-no-drag">
        <Tooltip text="搜索" position="bottom">
          <button
            onClick={toggleSearch}
            className={`w-9 h-9 rounded-full glass-button flex items-center justify-center transition-colors ${
              showSearch ? 'text-purple-400' : 'text-white/70 hover:text-white'
            }`}
          >
            <Search size={18} />
          </button>
        </Tooltip>
        
        <Tooltip text="设置" position="bottom">
          <button 
            onClick={toggleSettings}
            className="w-9 h-9 rounded-full glass-button flex items-center justify-center text-white/70 hover:text-white"
          >
            <User size={18} />
          </button>
        </Tooltip>
        
        <div className="w-px h-6 bg-white/10 mx-2" />
        
        <Tooltip text="最小化" position="bottom">
          <button
            onClick={handleMinimize}
            className="w-9 h-9 rounded-full glass-button flex items-center justify-center text-white/70 hover:text-white hover:bg-yellow-500/20"
          >
            <Minus size={16} />
          </button>
        </Tooltip>
        
        <Tooltip text={isMaximized ? '还原' : '最大化'} position="bottom">
          <button
            onClick={handleMaximize}
            className="w-9 h-9 rounded-full glass-button flex items-center justify-center text-white/70 hover:text-white hover:bg-green-500/20"
          >
            <Square size={14} />
          </button>
        </Tooltip>
        
        <Tooltip text="关闭" position="bottom">
          <button
            onClick={handleClose}
            className="w-9 h-9 rounded-full glass-button flex items-center justify-center text-white/70 hover:text-white hover:bg-red-500/30"
          >
            <X size={16} />
          </button>
        </Tooltip>
      </div>
    </motion.div>
  )
}
