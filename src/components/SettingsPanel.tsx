import { motion, AnimatePresence } from 'framer-motion'
import { X, Palette, Volume2, Music, Monitor, Keyboard } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { themes } from '@/utils/themes'
import { useState } from 'react'

export default function SettingsPanel() {
  const { 
    showSettings, 
    toggleSettings, 
    currentTheme, 
    setTheme,
    equalizerEnabled,
    setEqualizerEnabled,
    bassBoost,
    setBassBoost,
    surroundEnabled,
    setSurroundEnabled,
    equalizerGains,
    setEqualizerGains,
    renderQuality,
    setRenderQuality,
  } = usePlayerStore()
  
  const [activeTab, setActiveTab] = useState<'visual' | 'audio' | 'general'>('visual')
  
  const eqBands = ['32Hz', '64Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz']
  
  if (!showSettings) return null
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-40 flex items-center justify-center pointer-events-auto"
        style={{ background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(5px)' }}
        onClick={(e) => e.target === e.currentTarget && toggleSettings()}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="glass-panel rounded-3xl w-[800px] max-h-[80vh] overflow-hidden backdrop-blur-xl"
        >
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <h2 className="text-2xl font-bold text-white">设置</h2>
            <button
              onClick={toggleSettings}
              className="w-10 h-10 rounded-full glass-button flex items-center justify-center text-white/60 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="flex">
            <div className="w-48 p-4 border-r border-white/10 space-y-1">
              <SettingsTab
                icon={<Palette size={18} />}
                label="视觉效果"
                active={activeTab === 'visual'}
                onClick={() => setActiveTab('visual')}
              />
              <SettingsTab
                icon={<Volume2 size={18} />}
                label="音效设置"
                active={activeTab === 'audio'}
                onClick={() => setActiveTab('audio')}
              />
              <SettingsTab
                icon={<Monitor size={18} />}
                label="主题外观"
                active={activeTab === 'general'}
                onClick={() => setActiveTab('general')}
              />
            </div>
            
            <div className="flex-1 p-6 overflow-y-auto scrollbar-thin max-h-[60vh]">
              {activeTab === 'visual' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-white font-semibold mb-4">渲染质量</h3>
                    <p className="text-white/50 text-sm mb-4">
                      调节粒子数量和渲染精度，影响视觉效果细腻程度
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {(['low', 'medium', 'high', 'ultra'] as const).map((quality) => {
                        const labels: Record<string, string> = { low: '低', medium: '中', high: '高', ultra: '极致' }
                        const desc: Record<string, string> = { 
                          low: '1000粒子', 
                          medium: '2500粒子', 
                          high: '5000粒子', 
                          ultra: '10000粒子' 
                        }
                        return (
                          <button
                            key={quality}
                            onClick={() => setRenderQuality(quality)}
                            className={`py-3 rounded-xl text-sm transition-all ${
                              renderQuality === quality
                                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                                : 'glass-button text-white/70'
                            }`}
                          >
                            <div className="font-medium">{labels[quality]}</div>
                            <div className="text-xs opacity-70 mt-1">{desc[quality]}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'audio' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                      <Music size={20} className="text-purple-400" />
                      均衡器
                    </h3>
                    
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-white/80 text-sm">启用均衡器</span>
                      <button
                        onClick={() => setEqualizerEnabled(!equalizerEnabled)}
                        className={`w-12 h-6 rounded-full transition-all ${
                          equalizerEnabled ? 'bg-gradient-to-r from-purple-500 to-pink-500' : 'bg-white/20'
                        }`}
                      >
                        <motion.div
                          animate={{ x: equalizerEnabled ? 24 : 2 }}
                          className="w-5 h-5 bg-white rounded-full shadow-lg"
                        />
                      </button>
                    </div>
                    
                    <div className="glass-panel rounded-2xl p-4">
                      <div className="flex justify-between items-end h-32 gap-2">
                        {eqBands.map((band, i) => (
                          <div key={band} className="flex-1 flex flex-col items-center">
                            <input
                              type="range"
                              min="-12"
                              max="12"
                              value={equalizerGains[i] || 0}
                              onChange={(e) => {
                                const newGains = [...equalizerGains]
                                newGains[i] = parseFloat(e.target.value) / 12
                                setEqualizerGains(newGains)
                              }}
                              className="w-full h-24 accent-purple-500"
                              style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                              disabled={!equalizerEnabled}
                            />
                            <span className="text-white/50 text-xs mt-2">{band}</span>
                          </div>
                        ))}
                      </div>
                      
                      <div className="flex gap-2 mt-4 flex-wrap">
                        {['流行', '摇滚', '古典', '电子', '人声', '爵士', '重置'].map((preset) => (
                          <button
                            key={preset}
                            className="px-3 py-1.5 rounded-lg text-xs glass-button text-white/70 hover:text-white"
                            disabled={!equalizerEnabled}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-white font-semibold mb-4">音效增强</h3>
                    
                    <div className="space-y-4">
                      <div className="glass-panel rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-white/80 text-sm">低音增强</span>
                          <span className="text-purple-400 text-sm font-medium">
                            {Math.round(bassBoost * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={bassBoost}
                          onChange={(e) => setBassBoost(parseFloat(e.target.value))}
                          className="w-full accent-purple-500"
                        />
                      </div>
                      
                      <div className="glass-panel rounded-2xl p-4 flex items-center justify-between">
                        <div>
                          <div className="text-white/80 text-sm">3D环绕音效</div>
                          <div className="text-white/50 text-xs mt-1">模拟空间环绕效果</div>
                        </div>
                        <button
                          onClick={() => setSurroundEnabled(!surroundEnabled)}
                          className={`w-12 h-6 rounded-full transition-all ${
                            surroundEnabled ? 'bg-gradient-to-r from-purple-500 to-pink-500' : 'bg-white/20'
                          }`}
                        >
                          <motion.div
                            animate={{ x: surroundEnabled ? 24 : 2 }}
                            className="w-5 h-5 bg-white rounded-full shadow-lg"
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'general' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                      <Palette size={20} className="text-purple-400" />
                      主题配色
                    </h3>
                    
                    <div className="grid grid-cols-3 gap-3">
                      {themes.map((theme) => (
                        <motion.button
                          key={theme.id}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setTheme(theme)}
                          className={`p-4 rounded-2xl text-center transition-all ${
                            currentTheme.id === theme.id
                              ? 'ring-2 ring-purple-500'
                              : ''
                          }`}
                          style={{ background: theme.surface }}
                        >
                          <div className="flex justify-center gap-1 mb-2">
                            <div
                              className="w-6 h-6 rounded-full"
                              style={{ background: theme.primary }}
                            />
                            <div
                              className="w-6 h-6 rounded-full"
                              style={{ background: theme.accent }}
                            />
                          </div>
                          <div className="text-sm font-medium text-white">
                            {theme.name}
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                      <Keyboard size={20} className="text-purple-400" />
                      快捷键
                    </h3>
                    
                    <div className="glass-panel rounded-2xl divide-y divide-white/10">
                      {[
                        { key: 'Space', action: '播放/暂停' },
                        { key: '← / →', action: '上一首/下一首' },
                        { key: '↑ / ↓', action: '音量增减' },
                        { key: 'M', action: '静音' },
                        { key: 'L', action: '歌词' },
                        { key: 'Esc', action: '关闭面板' },
                      ].map((item) => (
                        <div key={item.key} className="flex items-center justify-between py-3 px-4">
                          <span className="text-white/80 text-sm">{item.action}</span>
                          <kbd className="px-2 py-1 rounded-lg bg-white/10 text-white/70 text-xs font-mono">
                            {item.key}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function SettingsTab({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
        active
          ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/10 text-white'
          : 'text-white/60 hover:bg-white/5 hover:text-white'
      }`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}
