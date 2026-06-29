import { motion } from 'framer-motion'
import { Music3, ChevronLeft, Upload } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useRef } from 'react'
import type { Song } from '@/types'

export default function PlaylistSidebar() {
  const { 
    playlists, 
    showPlaylist, 
    togglePlaylist, 
    setCurrentPlaylist, 
    currentPlaylist, 
    activeCategory,
    setActiveCategory,
    addLocalSongs, 
    playSong,
    localSongs,
  } = usePlayerStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    
    const songs: Song[] = Array.from(files).map((file, i) => ({
      id: `local-${Date.now()}-${i}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      artist: '未知艺术家',
      album: '本地音乐',
      cover: '',
      duration: 0,
      url: URL.createObjectURL(file),
      source: 'local' as const,
    }))
    
    addLocalSongs(songs)
    if (songs.length > 0) {
      playSong(songs[0])
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }
  
  if (!showPlaylist) {
    return (
      <div className="w-0 pointer-events-auto">
        <motion.button
          initial={{ x: -10, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          onClick={togglePlaylist}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-8 h-16 glass-panel rounded-r-xl flex items-center justify-center text-white/60 hover:text-white z-20"
        >
          <ChevronLeft size={18} className="rotate-180" />
        </motion.button>
      </div>
    )
  }
  
  return (
    <motion.div
      initial={{ x: -300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -300, opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      className="w-64 h-full glass-panel m-4 mr-0 rounded-2xl p-4 flex flex-col pointer-events-auto overflow-hidden"
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-white font-semibold text-lg">音乐库</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-8 h-8 rounded-lg glass-button flex items-center justify-center text-white/60 hover:text-white"
          title="添加本地音乐"
        >
          <Upload size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>
      
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <span className="text-white/60 text-xs font-medium uppercase tracking-wider">我的歌单</span>
        </div>
        
        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1">
          {playlists.map((playlist, index) => (
            <motion.div
              key={playlist.id}
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => setCurrentPlaylist(playlist)}
              className={`p-2 rounded-xl cursor-pointer transition-all ${
                currentPlaylist?.id === playlist.id 
                  ? 'bg-white/10' 
                  : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex-shrink-0 flex items-center justify-center">
                  <Music3 size={16} className="text-white/80" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">
                    {playlist.name}
                  </div>
                  <div className="text-white/50 text-xs">
                    {playlist.songs.length} 首歌
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      
      <button
        onClick={togglePlaylist}
        className="mt-4 w-full py-2 rounded-lg glass-button text-white/60 text-sm hover:text-white"
      >
        收起侧边栏
      </button>
    </motion.div>
  )
}
