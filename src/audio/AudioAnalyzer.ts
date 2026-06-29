import type { AudioFeatures } from '@/types'

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private gainNode: GainNode | null = null
  private bassFilter: BiquadFilterNode | null = null
  private midFilter: BiquadFilterNode | null = null
  private trebleFilter: BiquadFilterNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private audioElement: HTMLAudioElement | null = null
  
  private fftSize = 2048
  private spectrumData: Float32Array<ArrayBuffer> = new Float32Array(1024) as Float32Array<ArrayBuffer>
  private waveformData: Float32Array<ArrayBuffer> = new Float32Array(2048) as Float32Array<ArrayBuffer>
  
  private beatHistory: number[] = []
  private lastBeatTime = 0
  private beatThreshold = 0.6
  private bpmEstimate = 120
  private beatIntensity = 0
  
  private lowFreqEnergy = 0
  private midFreqEnergy = 0
  private highFreqEnergy = 0
  
  private smoothLow = 0
  private smoothMid = 0
  private smoothHigh = 0
  private smoothingFactor = 0.85
  
  constructor() {}
  
  async init(audioElement: HTMLAudioElement): Promise<void> {
    this.audioElement = audioElement
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    
    this.source = this.audioContext.createMediaElementSource(audioElement)
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = this.fftSize
    this.analyser.smoothingTimeConstant = 0.8
    
    this.gainNode = this.audioContext.createGain()
    
    this.bassFilter = this.audioContext.createBiquadFilter()
    this.bassFilter.type = 'lowshelf'
    this.bassFilter.frequency.value = 200
    this.bassFilter.gain.value = 0
    
    this.midFilter = this.audioContext.createBiquadFilter()
    this.midFilter.type = 'peaking'
    this.midFilter.frequency.value = 1000
    this.midFilter.Q.value = 1
    this.midFilter.gain.value = 0
    
    this.trebleFilter = this.audioContext.createBiquadFilter()
    this.trebleFilter.type = 'highshelf'
    this.trebleFilter.frequency.value = 2000
    this.trebleFilter.gain.value = 0
    
    this.source
      .connect(this.bassFilter)
      .connect(this.midFilter)
      .connect(this.trebleFilter)
      .connect(this.analyser)
      .connect(this.gainNode)
      .connect(this.audioContext.destination)
    
    this.spectrumData = new Float32Array(this.analyser.frequencyBinCount)
    this.waveformData = new Float32Array(this.fftSize)
  }
  
  resume(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      return this.audioContext.resume()
    }
    return Promise.resolve()
  }
  
  analyze(): AudioFeatures {
    if (!this.analyser) {
      return this.createEmptyFeatures()
    }
    
    this.analyser.getFloatFrequencyData(this.spectrumData)
    this.analyser.getFloatTimeDomainData(this.waveformData)
    
    this.calculateFrequencyBands()
    this.detectBeat()
    this.estimateBPM()
    
    const mood = this.detectMood()
    
    return {
      bpm: this.bpmEstimate,
      beatIntensity: this.beatIntensity,
      lowFrequency: this.smoothLow,
      midFrequency: this.smoothMid,
      highFrequency: this.smoothHigh,
      spectrum: this.spectrumData.slice() as Float32Array,
      waveform: this.waveformData.slice() as Float32Array,
      isBeat: this.isBeat(),
      mood,
    }
  }
  
  private calculateFrequencyBands() {
    const binCount = this.spectrumData.length
    const sampleRate = this.audioContext?.sampleRate || 44100
    const binSize = sampleRate / this.fftSize
    
    let lowSum = 0
    let midSum = 0
    let highSum = 0
    let lowCount = 0
    let midCount = 0
    let highCount = 0
    
    for (let i = 0; i < binCount; i++) {
      const freq = i * binSize
      const value = this.normalizeDb(this.spectrumData[i])
      
      if (freq < 200) {
        lowSum += value
        lowCount++
      } else if (freq < 2000) {
        midSum += value
        midCount++
      } else if (freq < 20000) {
        highSum += value
        highCount++
      }
    }
    
    this.lowFreqEnergy = lowCount > 0 ? lowSum / lowCount : 0
    this.midFreqEnergy = midCount > 0 ? midSum / midCount : 0
    this.highFreqEnergy = highCount > 0 ? highSum / highCount : 0
    
    this.smoothLow = this.smoothLow * this.smoothingFactor + this.lowFreqEnergy * (1 - this.smoothingFactor)
    this.smoothMid = this.smoothMid * this.smoothingFactor + this.midFreqEnergy * (1 - this.smoothingFactor)
    this.smoothHigh = this.smoothHigh * this.smoothingFactor + this.highFreqEnergy * (1 - this.smoothingFactor)
  }
  
  private normalizeDb(db: number): number {
    const minDb = -100
    const maxDb = 0
    return Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)))
  }
  
  private detectBeat() {
    const currentTime = performance.now() / 1000
    const energy = this.lowFreqEnergy
    
    this.beatHistory.push(energy)
    if (this.beatHistory.length > 60) {
      this.beatHistory.shift()
    }
    
    const avgEnergy = this.beatHistory.reduce((a, b) => a + b, 0) / this.beatHistory.length
    const variance = this.beatHistory.reduce((a, b) => a + Math.pow(b - avgEnergy, 2), 0) / this.beatHistory.length
    const stdDev = Math.sqrt(variance)
    
    const threshold = avgEnergy + stdDev * 1.5
    this.beatIntensity = Math.max(0, (energy - threshold) / (1 - threshold + 0.001))
    
    if (energy > threshold && currentTime - this.lastBeatTime > 0.25) {
      this.lastBeatTime = currentTime
    }
  }
  
  private isBeat(): boolean {
    const currentTime = performance.now() / 1000
    return currentTime - this.lastBeatTime < 0.1
  }
  
  private estimateBPM() {
    if (this.beatHistory.length < 10) return
    
    const peaks: number[] = []
    const avgEnergy = this.beatHistory.reduce((a, b) => a + b, 0) / this.beatHistory.length
    
    for (let i = 2; i < this.beatHistory.length - 2; i++) {
      if (this.beatHistory[i] > avgEnergy * 1.2 &&
          this.beatHistory[i] > this.beatHistory[i - 1] &&
          this.beatHistory[i] > this.beatHistory[i + 1]) {
        peaks.push(i)
      }
    }
    
    if (peaks.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < peaks.length; i++) {
        intervals.push(peaks[i] - peaks[i - 1])
      }
      
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const bpm = (60 / avgInterval) * (60 / 60)
      
      if (bpm >= 60 && bpm <= 200) {
        this.bpmEstimate = this.bpmEstimate * 0.95 + bpm * 0.05
      }
    }
  }
  
  private detectMood(): AudioFeatures['mood'] {
    const low = this.smoothLow
    const mid = this.smoothMid
    const high = this.smoothHigh
    const total = low + mid + high + 0.001
    
    const lowRatio = low / total
    const highRatio = high / total
    const energy = (low + mid + high) / 3
    
    if (energy > 0.6 && lowRatio > 0.4) {
      return 'electronic'
    } else if (energy > 0.5) {
      return 'energetic'
    } else if (highRatio > 0.3 && energy > 0.3) {
      return 'happy'
    } else if (energy < 0.2) {
      return 'calm'
    } else if (mid > high && mid > low) {
      return 'classical'
    } else {
      return 'sad'
    }
  }
  
  setVolume(volume: number) {
    if (this.gainNode) {
      this.gainNode.gain.value = volume
    }
  }
  
  setEqualizer(bands: number[]) {
    if (!this.bassFilter || !this.midFilter || !this.trebleFilter) return
    
    if (bands.length >= 3) {
      this.bassFilter.gain.value = bands[0] * 12
      this.midFilter.gain.value = bands[Math.floor(bands.length / 2)] * 12
      this.trebleFilter.gain.value = bands[bands.length - 1] * 12
    }
  }
  
  private createEmptyFeatures(): AudioFeatures {
    return {
      bpm: 0,
      beatIntensity: 0,
      lowFrequency: 0,
      midFrequency: 0,
      highFrequency: 0,
      spectrum: new Float32Array(1024),
      waveform: new Float32Array(2048),
      isBeat: false,
      mood: 'calm',
    }
  }
  
  getAudioContext(): AudioContext | null {
    return this.audioContext
  }
  
  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }
  
  destroy() {
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }
}
