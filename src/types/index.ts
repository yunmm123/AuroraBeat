export interface Song {
  id: string
  title: string
  name?: string
  artist: string
  album: string
  cover: string
  duration: number
  url: string
  source: 'local' | 'netease'
  path?: string
  size?: number
  fee?: number
}

export interface LyricsLine {
  time: number
  text: string
  translation?: string
}

export type LyricLine = LyricsLine

export interface Playlist {
  id: string
  name: string
  cover: string
  songs: Song[]
  source: 'local' | 'netease'
}

export type PlayMode = 'sequence' | 'shuffle' | 'single'

export interface NeteaseUser {
  userId: string
  nickname: string
  avatar: string
}