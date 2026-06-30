// ====================================================================
//  Netease Cloud Music API Handler
//  使用 NeteaseCloudMusicApi npm 包直接调用网易云API
//  - 搜索 / 歌曲URL / 歌词 / 封面
//  - 扫码登录 / cookie持久化
//  - 用户歌单 / 每日推荐 / 私人FM
// ====================================================================
import { ipcMain } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'

// 网易云API函数（动态导入以支持CJS模块）
let neteaseApi: any = null
let cookiePath = ''
let qrKey = ''
let currentCookie = ''

function getApi() {
  if (!neteaseApi) {
    try {
      neteaseApi = require('NeteaseCloudMusicApi')
    } catch {
      console.error('[NeteaseHandler] Failed to load NeteaseCloudMusicApi')
      return null
    }
  }
  return neteaseApi
}

function getCookiePath(): string {
  if (!cookiePath) {
    cookiePath = path.join(process.env.APPDATA || process.env.HOME || __dirname, 'aurorabeat-netease-cookie.txt')
  }
  return cookiePath
}

function loadCookie(): string {
  try {
    const p = getCookiePath()
    if (fs.existsSync(p)) {
      currentCookie = fs.readFileSync(p, 'utf-8').trim()
      return currentCookie
    }
  } catch {
    // ignore
  }
  return ''
}

function saveCookie(cookie: string) {
  try {
    fs.writeFileSync(getCookiePath(), cookie, 'utf-8')
    currentCookie = cookie
  } catch {
    // ignore
  }
}

// 通用API调用封装
async function callApi(apiName: string, params: Record<string, any> = {}) {
  const api = getApi()
  if (!api) return { ok: false, error: 'API not loaded' }

  const isLoginApi = apiName.startsWith('login_')
  const fullParams: Record<string, any> = { ...params }
  
  if (isLoginApi) {
    // Login APIs: do NOT pass cookie or realIP to avoid device environment risk detection
    delete fullParams.cookie
  } else {
    const cookie = params.cookie || currentCookie || loadCookie()
    if (cookie) {
      fullParams.cookie = cookie
    }
    fullParams.realIP = '116.25.146.177'
  }

  try {
    const result = await api[apiName](fullParams)
    if (result.body?.cookie) {
      saveCookie(result.body.cookie)
    }
    return { ok: true, ...result.body }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

export function registerNeteaseHandlers() {
  // 加载已有cookie
  loadCookie()

  // ========== 搜索 ==========
  ipcMain.handle('netease:search', async (_e, keyword: string, limit = 30, offset = 0) => {
    const res = await callApi('cloudsearch', { keywords: keyword, limit, offset, type: 1 })
    if (!res.ok) return res
    const songs = (res.result?.songs || []).map((s: any) => ({
      id: String(s.id),
      title: s.name || '',
      artist: (s.ar || []).map((a: any) => a.name).join(' / '),
      album: s.al?.name || '',
      cover: (s.al?.picUrl || '').replace(/^http:/, 'https:'),
      duration: (s.dt || 0) / 1000,
      url: '',
      source: 'netease' as const,
      quality: mapQuality(s),
      albumId: String(s.al?.id || ''),
    }))
    return { ok: true, songs, total: res.result?.songCount || 0 }
  })

  // ========== 歌曲URL ==========
  ipcMain.handle('netease:songUrl', async (_e, id: string, quality: string = 'standard') => {
    const levelMap: Record<string, string> = {
      standard: 'standard',
      high: 'higher',
      lossless: 'lossless',
      hires: 'hires',
    }
    const level = levelMap[quality] || 'standard'
    const res = await callApi('song_url_v1', { id, level })
    const data = res?.data?.[0]
    if (data?.url) {
      return { ok: true, url: data.url.replace(/^http:/, 'https:'), playable: true }
    }
    // 降级尝试
    const res2 = await callApi('song_url', { id })
    const data2 = res2?.data?.[0]
    if (data2?.url) {
      return { ok: true, url: data2.url.replace(/^http:/, 'https:'), playable: data2.freeTrialInfo ? false : true }
    }
    return { ok: false, url: '', playable: false }
  })

  // ========== 歌词 ==========
  ipcMain.handle('netease:lyric', async (_e, id: string) => {
    const res = await callApi('lyric_new', { id })
    if (res?.lrc?.lyric) {
      return { ok: true, lrc: res.lrc.lyric, tlyric: res.tlyric?.lyric || '' }
    }
    return { ok: false, lrc: '', tlyric: '' }
  })

  // ========== 扫码登录 ==========
  ipcMain.handle('netease:qrKey', async () => {
    const res = await callApi('login_qr_key', {})
    if (res?.data?.unikey) {
      qrKey = res.data.unikey
      return { ok: true, key: qrKey }
    }
    return { ok: false, error: 'Failed to get QR key' }
  })

  ipcMain.handle('netease:qrCreate', async (_e, key: string) => {
    const res = await callApi('login_qr_create', { key, qrimg: true })
    if (res?.data?.qrimg) {
      return { ok: true, qrimg: res.data.qrimg }
    }
    return { ok: false, error: 'Failed to create QR' }
  })

  ipcMain.handle('netease:qrCheck', async (_e, key: string) => {
    const res = await callApi('login_qr_check', { key })
    return { ok: true, code: res.code || 801, message: res.message || '', cookie: res.cookie || '' }
  })

  // ========== 登录状态 ==========
  ipcMain.handle('netease:loginStatus', async () => {
    const cookie = loadCookie()
    if (!cookie) return { ok: false, loggedIn: false }
    const res = await callApi('login_status', {})
    // 802 = 未登录
    if (res.code === 802 || res.code === 801) {
      return { ok: true, loggedIn: false }
    }
    const profile = res?.data?.profile || res?.profile
    return {
      ok: true,
      loggedIn: true,
      user: profile ? {
        userId: String(profile.userId || ''),
        nickname: profile.nickname || '',
        avatarUrl: profile.avatarUrl || '',
      } : null,
    }
  })

  // ========== 用户歌单 ==========
  ipcMain.handle('netease:userPlaylist', async (_e, uid: string) => {
    const res = await callApi('user_playlist', { uid })
    if (!res.ok) return res
    const playlists = (res.playlist || []).map((p: any) => ({
      id: String(p.id),
      name: p.name || '',
      cover: (p.coverImgUrl || '').replace(/^http:/, 'https:'),
      trackCount: p.trackCount || 0,
      playCount: p.playCount || 0,
      creator: p.creator?.nickname || '',
      description: p.description || '',
    }))
    return { ok: true, playlists }
  })

  // ========== 歌单详情 ==========
  ipcMain.handle('netease:playlistDetail', async (_e, id: string, limit = 50, offset = 0) => {
    const res = await callApi('playlist_track_all', { id, limit, offset })
    if (!res.ok) return res
    const songs = (res.songs || []).map((s: any) => ({
      id: String(s.id),
      title: s.name || '',
      artist: (s.ar || []).map((a: any) => a.name).join(' / '),
      album: s.al?.name || '',
      cover: (s.al?.picUrl || '').replace(/^http:/, 'https:'),
      duration: (s.dt || 0) / 1000,
      url: '',
      source: 'netease' as const,
      quality: mapQuality(s),
      albumId: String(s.al?.id || ''),
    }))
    return { ok: true, songs, total: res.total || songs.length }
  })

  // ========== 每日推荐 ==========
  ipcMain.handle('netease:recommendSongs', async () => {
    const res = await callApi('recommend_songs', {})
    if (!res.ok) return res
    const songs = (res.data?.dailySongs || []).map((s: any) => ({
      id: String(s.id),
      title: s.name || '',
      artist: (s.ar || []).map((a: any) => a.name).join(' / '),
      album: s.al?.name || '',
      cover: (s.al?.picUrl || '').replace(/^http:/, 'https:'),
      duration: (s.dt || 0) / 1000,
      url: '',
      source: 'netease' as const,
      quality: mapQuality(s),
      albumId: String(s.al?.id || ''),
    }))
    return { ok: true, songs }
  })

  // ========== 推荐歌单 ==========
  ipcMain.handle('netease:recommendPlaylists', async () => {
    const res = await callApi('recommend_resource', {})
    if (!res.ok) return res
    const playlists = (res.recommend || []).map((p: any) => ({
      id: String(p.id),
      name: p.name || '',
      cover: (p.picUrl || '').replace(/^http:/, 'https:'),
      trackCount: p.trackCount || 0,
      playCount: p.playCount || 0,
      creator: p.creator?.nickname || '',
    }))
    return { ok: true, playlists }
  })

  // ========== 歌手热门歌曲 ==========
  ipcMain.handle('netease:artistTopSongs', async (_e, artistId: string) => {
    const res = await callApi('artist_top_song', { id: artistId })
    if (!res.ok) return res
    const songs = (res.songs || []).slice(0, 50).map((s: any) => ({
      id: String(s.id),
      title: s.name || '',
      artist: (s.ar || []).map((a: any) => a.name).join(' / '),
      album: s.al?.name || '',
      cover: (s.al?.picUrl || '').replace(/^http:/, 'https:'),
      duration: (s.dt || 0) / 1000,
      url: '',
      source: 'netease' as const,
      quality: mapQuality(s),
      albumId: String(s.al?.id || ''),
    }))
    return { ok: true, songs }
  })

  // ========== 歌曲详情(批量) ==========
  ipcMain.handle('netease:songDetail', async (_e, ids: string[]) => {
    const res = await callApi('song_detail', { ids: ids.join(',') })
    if (!res.ok) return res
    const songs = (res.songs || []).map((s: any) => ({
      id: String(s.id),
      title: s.name || '',
      artist: (s.ar || []).map((a: any) => a.name).join(' / '),
      album: s.al?.name || '',
      cover: (s.al?.picUrl || '').replace(/^http:/, 'https:'),
      duration: (s.dt || 0) / 1000,
      url: '',
      source: 'netease' as const,
      quality: mapQuality(s),
      albumId: String(s.al?.id || ''),
    }))
    return { ok: true, songs }
  })

  console.log('[NeteaseHandler] Registered all IPC handlers')
}

function mapQuality(s: any): 'standard' | 'high' | 'lossless' | 'hires' {
  const maxBr = s.h?.br || s.m?.br || s.l?.br || 0
  if (maxBr >= 999000) return 'hires'
  if (maxBr >= 320000) return 'lossless'
  if (maxBr >= 128000) return 'high'
  return 'standard'
}