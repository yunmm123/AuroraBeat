import type { Song, Playlist, KugouUser } from '@/types'

const KUGOU_API_BASE = 'https://api.kugou.com'
const CLIENT_ID = 'your_client_id'
const CLIENT_SECRET = 'your_client_secret'
const REDIRECT_URI = 'aurorabeat://callback'

export class KugouService {
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiry: number | null = null
  private user: KugouUser | null = null
  
  constructor() {
    this.loadTokens()
  }
  
  private loadTokens() {
    try {
      const accessToken = localStorage.getItem('kugou_access_token')
      const refreshToken = localStorage.getItem('kugou_refresh_token')
      const tokenExpiry = localStorage.getItem('kugou_token_expiry')
      
      if (accessToken) this.accessToken = accessToken
      if (refreshToken) this.refreshToken = refreshToken
      if (tokenExpiry) this.tokenExpiry = parseInt(tokenExpiry)
    } catch (e) {
      console.error('Failed to load Kugou tokens:', e)
    }
  }
  
  private saveTokens() {
    try {
      if (this.accessToken) localStorage.setItem('kugou_access_token', this.accessToken)
      if (this.refreshToken) localStorage.setItem('kugou_refresh_token', this.refreshToken)
      if (this.tokenExpiry) localStorage.setItem('kugou_token_expiry', this.tokenExpiry.toString())
    } catch (e) {
      console.error('Failed to save Kugou tokens:', e)
    }
  }
  
  async loginWithQRCode(): Promise<{ qrUrl: string; qrKey: string }> {
    try {
      const response = await fetch(`${KUGOU_API_BASE}/app/qrcode/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID }),
      })
      
      if (!response.ok) throw new Error('Failed to generate QR code')
      
      const data = await response.json()
      return {
        qrUrl: data.qr_url,
        qrKey: data.qr_key,
      }
    } catch (e) {
      console.error('QR code login error:', e)
      throw e
    }
  }
  
  async checkQRCodeStatus(qrKey: string): Promise<'pending' | 'scanned' | 'confirmed' | 'expired'> {
    try {
      const response = await fetch(`${KUGOU_API_BASE}/app/qrcode/check?qr_key=${qrKey}`)
      const data = await response.json()
      
      if (data.status === 'confirmed' && data.access_token) {
        this.accessToken = data.access_token
        this.refreshToken = data.refresh_token
        this.tokenExpiry = Date.now() + data.expires_in * 1000
        this.saveTokens()
        await this.fetchUserInfo()
      }
      
      return data.status
    } catch (e) {
      console.error('QR code status check error:', e)
      return 'pending'
    }
  }
  
  async loginWithPassword(username: string, password: string): Promise<void> {
    try {
      const response = await fetch(`${KUGOU_API_BASE}/app/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          username,
          password,
          grant_type: 'password',
        }),
      })
      
      if (!response.ok) throw new Error('Login failed')
      
      const data = await response.json()
      this.accessToken = data.access_token
      this.refreshToken = data.refresh_token
      this.tokenExpiry = Date.now() + data.expires_in * 1000
      this.saveTokens()
      await this.fetchUserInfo()
    } catch (e) {
      console.error('Password login error:', e)
      throw e
    }
  }
  
  async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false
    
    try {
      const response = await fetch(`${KUGOU_API_BASE}/app/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: this.refreshToken,
          grant_type: 'refresh_token',
        }),
      })
      
      if (!response.ok) return false
      
      const data = await response.json()
      this.accessToken = data.access_token
      this.tokenExpiry = Date.now() + data.expires_in * 1000
      this.saveTokens()
      return true
    } catch (e) {
      console.error('Token refresh error:', e)
      return false
    }
  }
  
  private async ensureValidToken(): Promise<boolean> {
    if (!this.accessToken) return false
    
    if (this.tokenExpiry && Date.now() > this.tokenExpiry - 300000) {
      return this.refreshAccessToken()
    }
    
    return true
  }
  
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const valid = await this.ensureValidToken()
    if (!valid) throw new Error('Not authenticated')
    
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${this.accessToken}`)
    headers.set('Content-Type', 'application/json')
    
    let retries = 3
    while (retries > 0) {
      try {
        const response = await fetch(`${KUGOU_API_BASE}${endpoint}`, {
          ...options,
          headers,
        })
        
        if (response.status === 401) {
          const refreshed = await this.refreshAccessToken()
          if (refreshed) {
            headers.set('Authorization', `Bearer ${this.accessToken}`)
            retries--
            continue
          }
        }
        
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`)
        }
        
        return await response.json()
      } catch (e) {
        retries--
        if (retries === 0) throw e
        await new Promise(r => setTimeout(r, 1000))
      }
    }
    
    throw new Error('Max retries exceeded')
  }
  
  async fetchUserInfo(): Promise<KugouUser> {
    try {
      const data = await this.request<any>('/app/user/info')
      this.user = {
        id: data.user_id,
        nickname: data.nickname,
        avatar: data.avatar,
        isVip: data.is_vip,
      }
      return this.user
    } catch (e) {
      console.error('Failed to fetch user info:', e)
      throw e
    }
  }
  
  async searchSongs(keyword: string, page = 1, pageSize = 20): Promise<{ songs: Song[]; total: number }> {
    try {
      const data = await this.request<any>(
        `/app/search/song?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pageSize}`
      )
      
      const songs: Song[] = data.list.map((item: any) => ({
        id: item.hash,
        title: item.songname,
        artist: item.singername,
        album: item.album_name,
        cover: item.img || '',
        duration: item.duration,
        url: '',
        source: 'kugou',
        quality: 'high',
      }))
      
      return { songs, total: data.total }
    } catch (e) {
      console.error('Search error:', e)
      return { songs: [], total: 0 }
    }
  }
  
  async getSongUrl(songHash: string, quality: 'standard' | 'high' | 'lossless' = 'high'): Promise<string> {
    try {
      const data = await this.request<any>(
        `/app/song/url?hash=${songHash}&quality=${quality}`
      )
      return data.url || ''
    } catch (e) {
      console.error('Get song URL error:', e)
      return ''
    }
  }
  
  async getSongLyrics(songHash: string): Promise<{ time: number; text: string }[]> {
    try {
      const data = await this.request<any>(`/app/song/lyric?hash=${songHash}`)
      return this.parseLRC(data.lrc || '')
    } catch (e) {
      console.error('Get lyrics error:', e)
      return []
    }
  }
  
  private parseLRC(lrc: string): { time: number; text: string }[] {
    const lines = lrc.split('\n')
    const result: { time: number; text: string }[] = []
    
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
    
    for (const line of lines) {
      const matches = [...line.matchAll(timeRegex)]
      const text = line.replace(timeRegex, '').trim()
      
      if (!text) continue
      
      for (const match of matches) {
        const minutes = parseInt(match[1])
        const seconds = parseInt(match[2])
        const milliseconds = match[3].length === 2 
          ? parseInt(match[3]) * 10 
          : parseInt(match[3])
        
        const time = minutes * 60 + seconds + milliseconds / 1000
        result.push({ time, text })
      }
    }
    
    return result.sort((a, b) => a.time - b.time)
  }
  
  async getUserPlaylists(): Promise<Playlist[]> {
    try {
      const data = await this.request<any>('/app/playlist/list')
      
      return data.list.map((item: any): Playlist => ({
        id: item.specialid,
        name: item.specialname,
        cover: item.imgurl || '',
        songs: [],
        source: 'kugou',
      }))
    } catch (e) {
      console.error('Get playlists error:', e)
      return []
    }
  }
  
  async getPlaylistSongs(playlistId: string): Promise<Song[]> {
    try {
      const data = await this.request<any>(`/app/playlist/songs?specialid=${playlistId}`)
      
      return data.list.map((item: any): Song => ({
        id: item.hash,
        title: item.songname,
        artist: item.singername,
        album: item.album_name,
        cover: item.img || '',
        duration: item.duration,
        url: '',
        source: 'kugou',
        quality: 'high',
      }))
    } catch (e) {
      console.error('Get playlist songs error:', e)
      return []
    }
  }
  
  async getFavoriteSongs(): Promise<Song[]> {
    return this.getPlaylistSongs('favorite')
  }
  
  async getPlayHistory(): Promise<Song[]> {
    try {
      const data = await this.request<any>('/app/user/playhistory')
      
      return data.list.map((item: any): Song => ({
        id: item.hash,
        title: item.songname,
        artist: item.singername,
        album: item.album_name,
        cover: item.img || '',
        duration: item.duration,
        url: '',
        source: 'kugou',
        quality: 'high',
      }))
    } catch (e) {
      console.error('Get play history error:', e)
      return []
    }
  }
  
  getUser(): KugouUser | null {
    return this.user
  }
  
  isLoggedIn(): boolean {
    return !!this.accessToken
  }
  
  logout(): void {
    this.accessToken = null
    this.refreshToken = null
    this.tokenExpiry = null
    this.user = null
    
    try {
      localStorage.removeItem('kugou_access_token')
      localStorage.removeItem('kugou_refresh_token')
      localStorage.removeItem('kugou_token_expiry')
    } catch (e) {
      console.error('Logout error:', e)
    }
  }
}

export const kugouService = new KugouService()
