import { motion } from 'framer-motion'
import { Heart, Clock, Music3, Folder, Plus, ChevronLeft } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'

export default function PlaylistSidebar() {
  const { playlists, showPlaylist, togglePlaylist, setCurrentPlaylist, currentPlaylist } = usePlayerStore()
  
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
        <button className="w-8 h-8 rounded-lg glass-button flex items-center justify-center text-white/60 hover:text-white">
          <Plus size={18} />
        </button>
      </div>
      
      <div className="space-y-1 mb-6">
        <SidebarItem icon={<Heart size={18} />} label="我喜欢" count={128} active />
        <SidebarItem icon={<Clock size={18} />} label="最近播放" count={50} />
        <SidebarItem icon={<Music3 size={18} />} label="全部音乐" count={1024} />
        <SidebarItem icon={<Folder size={18} />} label="本地音乐" count={256} />
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

function SidebarItem({ icon, label, count, active }: { icon: React.ReactNode; label: string; count: number; active?: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
      active ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
    }`}>
      <div className={active ? 'text-purple-400' : ''}>{icon}</div>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <span className="text-xs text-white/40">{count}</span>
    </div>
  )
}
