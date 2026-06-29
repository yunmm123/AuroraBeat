export interface Song {
  id: string
  title: string
  artist: string
  album: string
  cover: string
  duration: number
  url: string
  source: 'local' | 'kugou'
  quality?: 'standard' | 'high' | 'lossless' | 'hires'
  lyrics?: LyricLine[]
}

export interface LyricLine {
  time: number
  text: string
  translation?: string
}

export interface Playlist {
  id: string
  name: string
  cover: string
  songs: Song[]
  source: 'local' | 'kugou'
}

export interface AudioFeatures {
  bpm: number
  beatIntensity: number
  lowFrequency: number
  midFrequency: number
  highFrequency: number
  spectrum: Float32Array
  waveform: Float32Array
  isBeat: boolean
  mood: 'energetic' | 'calm' | 'sad' | 'happy' | 'electronic' | 'classical'
}

export type VisualEffectType = 'particles' | 'fluid' | 'geometry' | 'waveform' | 'nebula'

export interface Theme {
  id: string
  name: string
  primary: string
  secondary: string
  accent: string
  background: string
  surface: string
  text: string
  textSecondary: string
}

export type PlayMode = 'sequence' | 'shuffle' | 'single' | 'loop'

export interface EqualizerPreset {
  name: string
  gains: number[]
}

export interface KugouUser {
  id: string
  nickname: string
  avatar: string
  isVip: boolean
}
