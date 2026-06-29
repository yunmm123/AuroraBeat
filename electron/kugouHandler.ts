/**
 * KuGou Music API Handler - runs directly in Electron main process
 * Replaces the subprocess approach to avoid packaging issues
 */

import { net } from 'electron'
import crypto from 'crypto'

const KG_API_BASE = 'https://gateway.kugou.com'
const KG_API_V2 = 'https://complexsearchretry.kugou.com'

function md5(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex')
}

function generateGuid(): string {
  const hex = '0123456789abcdef'
  let guid = ''
  for (let i = 0; i < 32; i++) {
    guid += hex[Math.floor(Math.random() * 16)]
  }
  return guid
}

function buildRequestParams(params: Record<string, any>): URLSearchParams {
  const searchParams = new URLSearchParams()
  // Common params
  searchParams.set('clienttime', String(Math.floor(Date.now() / 1000)))
  searchParams.set('mid', md5(generateGuid()))
  searchParams.set('uuid', generateGuid())
  searchParams.set('dfid', '-')
  searchParams.set('appid', '1014')
  searchParams.set('token', '')
  searchParams.set('userid', '0')
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value))
    }
  })
  return searchParams
}

async function kugouGet(path: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(KG_API_BASE + path)
  const searchParams = buildRequestParams(params)
  url.search = searchParams.toString()
  
  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'GET',
      url: url.toString(),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.kugou.com/',
      }
    })
    
    req.on('response', (response) => {
      let data = ''
      response.on('data', (chunk: Buffer) => { data += chunk.toString() })
      response.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error(`Invalid response from ${path}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function kugouPost(path: string, params: Record<string, any> = {}): Promise<any> {
  const url = KG_API_BASE + path
  const body = new URLSearchParams(buildRequestParams(params)).toString()
  
  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.kugou.com/',
      }
    })
    
    req.on('response', (response) => {
      let data = ''
      response.on('data', (chunk: Buffer) => { data += chunk.toString() })
      response.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error(`Invalid response from ${path}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ============ Search ============
export async function kgSearch(keyword: string, page = 1, pageSize = 30) {
  return kugouGet('/v2/search/songs', { keyword, page, pagesize: pageSize })
}

export async function kgSearchHot() {
  return kugouGet('/api/v3/search/hot_tab')
}

export async function kgSearchDefault() {
  return kugouGet('/api/v3/search/default')
}

// ============ Song URL ============
export async function kgSongUrl(hash: string, albumId?: string) {
  const params: any = { hash, album_id: albumId || '' }
  return kugouGet('/v5/url', params)
}

// ============ Lyrics ============
export async function kgLyric(hash: string, albumId?: string) {
  const params: any = { hash, album_id: albumId || '' }
  return kugouGet('/v1/krc', params)
}

// ============ Login QR ============
export async function kgQrKey() {
  return kugouGet('/v1/qrcode/key')
}

export async function kgQrCreate(key: string) {
  return kugouGet('/v1/qrcode/create', { key, qrimg: true })
}

export async function kgQrCheck(key: string) {
  return kugouGet('/v1/qrcode/check', { key })
}

// ============ Top Songs ============
export async function kgTopSong() {
  return kugouGet('/api/v3/top_song/new')
}

// ============ Rank ============
export async function kgRankList() {
  return kugouGet('/ocean/v6/rank/list')
}

export async function kgRankAudio(rankId: string, page = 1) {
  return kugouGet('/ocean/v6/rank/audio', { rankid: rankId, page })
}

// ============ Recommend ============
export async function kgRecommendSongs() {
  return kugouGet('/api/v3/recommend/song')
}

// ============ FM ============
export async function kgFmClass() {
  return kugouGet('/api/v3/fm/class')
}

export async function kgFmRecommend(classId: string) {
  return kugouGet('/api/v3/fm/recommend', { classid: classId })
}

export async function kgFmSongs(classId: string, songId?: string) {
  const params: any = { classid: classId }
  if (songId) params.songid = songId
  return kugouGet('/api/v3/fm/songs', params)
}

// ============ User ============
export async function kgUserDetail(uid: string, token: string) {
  return kugouGet('/ocean/v6/user/info', { userid: uid, token })
}

export async function kgUserPlaylist(uid: string, token: string, page = 1) {
  return kugouGet('/ocean/v6/playlist/mine', { userid: uid, token, page })
}

// ============ Playlist ============
export async function kgPlaylistDetail(id: string) {
  return kugouGet('/ocean/v6/playlist/info', { playlistid: id })
}

export async function kgPlaylistTrackAll(id: string, page = 1) {
  return kugouGet('/ocean/v6/playlist/song', { playlistid: id, page })
}

// ============ Artist ============
export async function kgArtistDetail(artistId: string) {
  return kugouGet('/ocean/v6/singer/info', { singerid: artistId })
}

export async function kgArtistAudios(artistId: string, page = 1) {
  return kugouGet('/ocean/v6/singer/song', { singerid: artistId, page })
}

// ============ Album ============
export async function kgAlbumDetail(albumId: string) {
  return kugouGet('/ocean/v6/album/info', { albumid: albumId })
}

export async function kgAlbumSongs(albumId: string, page = 1) {
  return kugouGet('/ocean/v6/album/song', { albumid: albumId, page })
}

// ============ Banner ============
export async function kgBanner() {
  return kugouGet('/api/v3/banner')
}

// ============ Scene ============
export async function kgSceneLists() {
  return kugouGet('/api/v3/scene/list')
}

export async function kgSceneAudioList(sceneId: string, page = 1) {
  return kugouGet('/api/v3/scene/audio', { scene_id: sceneId, page })
}

// ============ Radio ============
export async function kgDiantai() {
  return kugouGet('/pc/diantai')
}

// ============ Comment ============
export async function kgCommentMusic(hash: string, page = 1) {
  return kugouGet('/mcomment/v1/cmtlist', { hash, page })
}

// ============ Song Detail ============
export async function kgSongDetail(hash: string) {
  return kugouGet('/v3/song/detail', { hash })
}

// ============ MV ============
export async function kgAudioMv(hash: string) {
  return kugouGet('/kmr/audio/mv', { hash })
}

export async function kgVideoUrl(videoHash: string) {
  return kugouGet('/v1/video/url', { videohash: videoHash })
}

// ============ Health Check ============
export async function kgHealthCheck(): Promise<boolean> {
  try {
    await kgSearchHot()
    return true
  } catch {
    return false
  }
}
