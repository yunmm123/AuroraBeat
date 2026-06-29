import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { VisualEngine } from '@/visuals/VisualEngine'
import { AudioAnalyzer } from '@/audio/AudioAnalyzer'
import TitleBar from '@/components/TitleBar'
import PlaylistSidebar from '@/components/PlaylistSidebar'
import PlayControlBar from '@/components/PlayControlBar'
import LyricsPanel from '@/components/LyricsPanel'
import QueuePanel from '@/components/QueuePanel'
import SettingsPanel from '@/components/SettingsPanel'
import VisualEffectSelector from '@/components/VisualEffectSelector'
import SearchPanel from '@/components/SearchPanel'
import { applyTheme } from '@/utils/themes'

function App() {
  const visualContainerRef = useRef<HTMLDivElement>(null)
  const visualEngineRef = useRef<VisualEngine | null>(null)
  const audioAnalyzerRef = useRef<AudioAnalyzer | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const demoIntervalRef = useRef<number | null>(null)
  const [webglAvailable, setWebglAvailable] = useState(true)
  const [demoMode, setDemoMode] = useState(true)
  
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
  } = usePlayerStore()
  
  useEffect(() => {
    applyTheme(currentTheme)
  }, [currentTheme])
  
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
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current)
      }
      visualEngineRef.current?.destroy()
      audioAnalyzerRef.current?.destroy()
    }
  }, [])
  
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
  
  useEffect(() => {
    if (!demoMode) return
    
    let time = 0
    const demoAnimation = () => {
      if (!isPlaying || !visualEngineRef.current) {
        animationFrameRef.current = requestAnimationFrame(demoAnimation)
        return
      }
      
      time += 0.016
      
      const simulatedSpectrum = new Float32Array(1024)
      const simulatedWaveform = new Float32Array(2048)
      
      const baseBass = 0.5 + Math.sin(time * 2) * 0.3 + Math.sin(time * 0.5) * 0.2
      const beat = Math.sin(time * 4 * Math.PI) > 0.9 ? 1 : 0
      const bass = Math.min(1, baseBass + beat * 0.5)
      
      const mid = 0.4 + Math.sin(time * 1.5 + 1) * 0.3 + Math.sin(time * 3) * 0.1
      const treble = 0.3 + Math.sin(time * 2.5 + 2) * 0.3 + Math.random() * 0.1
      
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
        simulatedWaveform[i] = Math.sin(t * Math.PI * 20 + time * 10) * 0.3 * bass
          + Math.sin(t * Math.PI * 50 + time * 15) * 0.2 * mid
          + Math.sin(t * Math.PI * 100 + time * 20) * 0.1 * treble
      }
      
      const features = {
        bpm: 120,
        beatIntensity: beat * 0.8 + bass * 0.2,
        lowFrequency: bass,
        midFrequency: mid,
        highFrequency: treble,
        spectrum: simulatedSpectrum,
        waveform: simulatedWaveform,
        isBeat: beat > 0.5,
        mood: 'electronic' as const,
      }
      
      setAudioFeatures(features)
      
      if (visualEngineRef.current) {
        visualEngineRef.current.updateAudio(features)
      }
      
      animationFrameRef.current = requestAnimationFrame(demoAnimation)
    }
    
    animationFrameRef.current = requestAnimationFrame(demoAnimation)
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isPlaying, demoMode, setAudioFeatures])
  
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
    
    const updateAnalysis = () => {
      if (audioAnalyzerRef.current && isPlaying && !demoMode) {
        const features = audioAnalyzerRef.current.analyze()
        setAudioFeatures(features)
        
        if (visualEngineRef.current) {
          visualEngineRef.current.updateAudio(features)
        }
      }
      animationFrameRef.current = requestAnimationFrame(updateAnalysis)
    }
    animationFrameRef.current = requestAnimationFrame(updateAnalysis)
    
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

  useEffect(() => {
    if (!audioElementRef.current || !currentSong?.url) return
    const audio = audioElementRef.current
    audio.src = currentSong.url
    audio.load()
    if (isPlaying) {
      audio.play().catch(() => {})
    }
  }, [currentSong?.url])
  
  const handlePlayToggle = async () => {
    if (demoMode) {
      setIsPlaying(!isPlaying)
      return
    }
    
    if (!audioElementRef.current || !audioAnalyzerRef.current) return
    
    await audioAnalyzerRef.current.resume()
    
    if (isPlaying) {
      audioElementRef.current.pause()
      setIsPlaying(false)
    } else {
      try {
        await audioElementRef.current.play()
        setIsPlaying(true)
      } catch (e) {
        console.log('Play failed, using demo mode')
        setDemoMode(true)
        setIsPlaying(true)
      }
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
            <VisualEffectSelector />
          </div>
          
          <QueuePanel />
        </div>
        
        <PlayControlBar onPlayToggle={handlePlayToggle} />
      </div>
      
      <LyricsPanel />
      <SettingsPanel />
      <SearchPanel />
    </div>
  )
}

export default App
