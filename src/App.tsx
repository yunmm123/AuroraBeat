import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { VisualEngine } from '@/visuals/VisualEngine'
import { AudioAnalyzer } from '@/audio/AudioAnalyzer'
import TitleBar from '@/components/TitleBar'
import PlaylistSidebar from '@/components/PlaylistSidebar'
import PlayControlBar from '@/components/PlayControlBar'
import LyricsVisual from '@/components/LyricsVisual'
import SongListPanel from '@/components/SongListPanel'
import QueuePanel from '@/components/QueuePanel'
import SettingsPanel from '@/components/SettingsPanel'
import SearchPanel from '@/components/SearchPanel'
import KugouMusicPanel from '@/components/KugouMusicPanel'
import NeteaseMusicPanel from '@/components/NeteaseMusicPanel'
import KugouLogin from '@/components/KugouLogin'
import { applyTheme } from '@/utils/themes'

function App() {
  const visualContainerRef = useRef<HTMLDivElement>(null)
  const visualEngineRef = useRef<VisualEngine | null>(null)
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const userSeekingRef = useRef(false)
  const [webglAvailable, setWebglAvailable] = useState(true)
  const [showKugouLogin, setShowKugouLogin] = useState(false)
  
  const { 
    currentTheme, 
    visualEffect, 
    setAudioFeatures,
    isPlaying,
    currentTime,
    setCurrentTime,
    setDuration,
    volume,
    isMuted,
    setIsPlaying,
    currentSong,
    currentPlaylist,
    renderQuality,
    loadFromDB,
    showKugou,
    toggleKugou,
    kugouUserInfo,
    setKugouUserInfo,
    showNetease,
    toggleNetease,
  } = usePlayerStore()

  // Load songs from IndexedDB on mount
  useEffect(() => {
    loadFromDB()
  }, [])
  
  useEffect(() => {
    applyTheme(currentTheme)
  }, [currentTheme])
  
  // Initialize visual engine
  useEffect(() => {
    if (!visualContainerRef.current) return
    
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      if (!gl) {
        setWebglAvailable(false)
        console.warn('WebGL not available, using fallback background')
        return
      }
      
      visualEngineRef.current = new VisualEngine(visualContainerRef.current)
      visualEngineRef.current.start()
      visualEngineRef.current.setQuality(renderQuality)
      
      visualEngineRef.current.setColors(
        currentTheme.primary,
        currentTheme.secondary,
        currentTheme.accent
      )
    } catch (e) {
      console.error('Failed to initialize visual engine:', e)
      setWebglAvailable(false)
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      visualEngineRef.current?.destroy()
      audioAnalyzerRef.current?.destroy()
    }
  }, [])

  // Update render quality
  useEffect(() => {
    if (visualEngineRef.current) {
      visualEngineRef.current.setQuality(renderQuality)
    }
  }, [renderQuality])
  
  useEffect(() => {
    if (visualEngineRef.current) {
      visualEngineRef.current.setColors(
        currentTheme.primary,
        currentTheme.secondary,
        currentTheme.accent
      )
    }
  }, [currentTheme])
  
  useEffect(() => {
    if (visualEngineRef.current) {
      visualEngineRef.current.setEffect(visualEffect)
    }
  }, [visualEffect])
  
  // Audio element setup
  useEffect(() => {
    const audio = new Audio()
    audioElementRef.current = audio
    audio.crossOrigin = 'anonymous'
    
    const initAudio = async () => {
      audioAnalyzerRef.current = new AudioAnalyzer()
      try {
        await audioAnalyzerRef.current.init(audio)
      } catch (e) {
        console.log('Audio analyzer init delayed')
      }
    }
    initAudio()
    
    // Main animation loop - uses REAL audio data when playing, demo when idle
    let time = 0
    const animationLoop = () => {
      if (!visualEngineRef.current) {
        animationFrameRef.current = requestAnimationFrame(animationLoop)
        return
      }
      
      time += 0.016
      
      let features
      
      // When playing and analyzer is ready, use real audio data
      if (audioAnalyzerRef.current && isPlaying && currentSong?.url) {
        features = audioAnalyzerRef.current.analyze()
      } else {
        // Demo/idle animation with gentle movement
        const simulatedSpectrum = new Float32Array(1024)
        const simulatedWaveform = new Float32Array(2048)
        
        const baseBass = 0.3 + Math.sin(time * 1.5) * 0.15
        const beat = Math.sin(time * 3 * Math.PI) > 0.95 ? 1 : 0
        const bass = Math.min(1, baseBass + beat * 0.3)
        
        const mid = 0.25 + Math.sin(time * 1.2 + 1) * 0.15
        const treble = 0.15 + Math.sin(time * 2 + 2) * 0.1 + Math.random() * 0.05
        
        for (let i = 0; i < 1024; i++) {
          const freq = i / 1024
          let value = 0
          if (freq < 0.1) {
            value = bass * (1 - freq * 5)
          } else if (freq < 0.5) {
            value = mid * (0.5 + Math.sin(freq * 20 + time) * 0.5)
          } else {
            value = treble * (0.3 + Math.random() * 0.7) * (1 - (freq - 0.5) * 2)
          }
          simulatedSpectrum[i] = (value * 80 - 100) as number
        }
        
        for (let i = 0; i < 2048; i++) {
          const t = i / 2048
          simulatedWaveform[i] = Math.sin(t * Math.PI * 20 + time * 10) * 0.2 * bass
            + Math.sin(t * Math.PI * 50 + time * 15) * 0.1 * mid
        }
        
        features = {
          bpm: 80,
          beatIntensity: beat * 0.5 + bass * 0.2,
          lowFrequency: bass,
          midFrequency: mid,
          highFrequency: treble,
          spectrum: simulatedSpectrum,
          waveform: simulatedWaveform,
          isBeat: beat > 0.5,
          mood: 'electronic' as const,
        }
      }
      
      setAudioFeatures(features)
      visualEngineRef.current.updateAudio(features)
      
      animationFrameRef.current = requestAnimationFrame(animationLoop)
    }
    animationFrameRef.current = requestAnimationFrame(animationLoop)
    
    return () => {
      audio.pause()
      audio.src = ''
    }
  }, [])
  
  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.volume = isMuted ? 0 : volume
    }
    if (audioAnalyzerRef.current) {
      audioAnalyzerRef.current.setVolume(isMuted ? 0 : volume)
    }
  }, [volume, isMuted])
  
  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.ontimeupdate = () => {
        setCurrentTime(audioElementRef.current!.currentTime)
      }
      audioElementRef.current.ondurationchange = () => {
        setDuration(audioElementRef.current!.duration)
      }
      audioElementRef.current.onended = () => {
        usePlayerStore.getState().nextSong()
      }
    }
  }, [])

  // Load new song when currentSong changes
  useEffect(() => {
    if (!audioElementRef.current || !currentSong?.url) return
    const audio = audioElementRef.current
    audio.src = currentSong.url
    audio.load()
    if (isPlaying) {
      audio.play().catch(() => {})
    }
  }, [currentSong?.url])

  // Handle play/pause
  useEffect(() => {
    if (!audioElementRef.current) return
    if (isPlaying) {
      audioElementRef.current.play().catch(() => {})
    } else {
      audioElementRef.current.pause()
    }
  }, [isPlaying])
  
  const handlePlayToggle = () => {
    if (!currentSong?.url) return
    setIsPlaying(!isPlaying)
  }

  const handleSeek = (time: number) => {
    if (audioElementRef.current) {
      audioElementRef.current.currentTime = time
      setCurrentTime(time)
    }
  }
  
  return (
    <div className="w-full h-full relative overflow-hidden">
      {webglAvailable ? (
        <div 
          ref={visualContainerRef} 
          className="absolute inset-0 z-0"
        />
      ) : (
        <div className="absolute inset-0 z-0">
          <div 
            className="w-full h-full"
            style={{
              background: `radial-gradient(ellipse at center, ${currentTheme.primary}20 0%, ${currentTheme.background} 70%)`,
            }}
          />
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl" 
              style={{ background: currentTheme.primary, opacity: 0.3 }} />
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl"
              style={{ background: currentTheme.accent, opacity: 0.3 }} />
          </div>
        </div>
      )}
      
      <div className="absolute inset-0 z-10 flex flex-col pointer-events-none">
        <TitleBar />
        
        <div className="flex-1 flex overflow-hidden pointer-events-none">
          <PlaylistSidebar />
          
          <div className="flex-1 relative pointer-events-auto">
            {currentPlaylist ? <SongListPanel /> : <LyricsVisual />}
          </div>
          
          <QueuePanel />
        </div>
        
        <PlayControlBar onPlayToggle={handlePlayToggle} onSeek={handleSeek} />
      </div>
      
      <SettingsPanel />
      <SearchPanel />
      
      {/* KuGou Music Panel */}
      {showKugou && (
        <KugouMusicPanel
          onClose={toggleKugou}
          onPlaySong={(song) => {
            usePlayerStore.getState().playSong(song)
          }}
          userInfo={kugouUserInfo}
          onLoginClick={() => setShowKugouLogin(true)}
          onLogout={() => setKugouUserInfo(null)}
        />
      )}
      
      {/* Netease Music Panel */}
      {showNetease && (
        <NeteaseMusicPanel onClose={toggleNetease} />
      )}
      
      {/* KuGou Login Modal */}
      {showKugouLogin && (
        <KugouLogin
          onClose={() => setShowKugouLogin(false)}
          onLoginSuccess={(info) => {
            setKugouUserInfo(info)
            setShowKugouLogin(false)
          }}
        />
      )}
    </div>
  )
}

export default App
