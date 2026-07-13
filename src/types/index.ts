export interface Song {
  id: string
  title: string
  name?: string
  artist: string
  album: string
  cover: string
  duration: number
  url: string
  source: 'local' | 'netease' | 'kugou'
  path?: string
  size?: number
  fee?: number
  // v3.8.6 酷狗源字段（kugou-api 需要的额外标识，其他源为空）
  hash?: string       // 酷狗歌曲 hash
  audioId?: string    // 酷狗 audio_id
  albumId?: string    // 酷狗 album_id（注意是字符串）
}

export interface YrcWord {
  text: string
  startMs: number
  durationMs: number
}

export interface LyricsLine {
  time: number
  text: string
  translation?: string
  words?: YrcWord[]
}

export type LyricLine = LyricsLine

export interface Playlist {
  id: string
  name: string
  cover: string
  songs: Song[]
  source: 'local' | 'netease' | 'kugou'
}

export type PlayMode = 'sequence' | 'shuffle' | 'single'

export interface NeteaseUser {
  userId: string
  nickname: string
  avatar: string
}