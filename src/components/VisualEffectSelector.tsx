import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ChevronUp, ChevronDown } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useState } from 'react'
import type { VisualEffectType } from '@/types'

export default function VisualEffectSelector() {
  const { visualEffect, setVisualEffect } = usePlayerStore()
  const [expanded, setExpanded] = useState(false)
  
  const effects: { id: VisualEffectType; name: string; icon: string }[] = [
    { id: 'particles', name: '星河粒子', icon: '✨' },
    { id: 'fluid', name: '流体光影', icon: '🌊' },
    { id: 'geometry', name: '几何律动', icon: '💎' },
    { id: 'waveform', name: '波形可视化', icon: '📊' },
    { id: 'nebula', name: '频谱星云', icon: '🌌' },
  ]
  
  const currentEffect = effects.find(e => e.id === visualEffect)
  
  return (
    <div className="absolute top-4 right-4 z-10">
      <AnimatePresence mode="wait">
        {expanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="glass-panel rounded-2xl p-3 backdrop-blur-xl"
          >
            <div className="flex items-center justify-between mb-3 px-2">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-purple-400" />
                <span className="text-white font-medium text-sm">视觉效果</span>
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="w-6 h-6 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60"
              >
                <ChevronUp size={14} />
              </button>
            </div>
            
            <div className="space-y-1">
              {effects.map((effect) => (
                <motion.button
                  key={effect.id}
                  whileHover={{ x: 4 }}
                  onClick={() => {
                    setVisualEffect(effect.id)
                    setExpanded(false)
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
                    visualEffect === effect.id
                      ? 'bg-gradient-to-r from-purple-500/30 to-pink-500/20 text-white'
                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="text-lg">{effect.icon}</span>
                  <span className="text-sm font-medium">{effect.name}</span>
                  {visualEffect === effect.id && (
                    <div className="ml-auto w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="collapsed"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setExpanded(true)}
            className="glass-panel rounded-full pl-3 pr-4 py-2 backdrop-blur-xl flex items-center gap-2 hover:bg-white/10 transition-all"
          >
            <span className="text-lg">{currentEffect?.icon}</span>
            <span className="text-white text-sm font-medium">{currentEffect?.name}</span>
            <ChevronDown size={14} className="text-white/60" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
