/**
 * KuGou Music API Handler - runs in Electron main process.
 *
 * Uses the kugou-api library (main.js) programmatically — no HTTP server needed.
 * The library handles all request signing, cookie management, and QR code generation.
 */

import { app } from 'electron'
import path from 'path'
import crypto from 'crypto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kugouApi: any = null
let loadError: string | null = null

/**
 * Load the kugou-api library (main.js) at runtime.
 * Uses eval('require') so the bundler (rollup/vite) doesn't try to resolve
 * and bundle kugou-api into dist-electron — it must be loaded from disk
 * because it has its own node_modules with axios, crypto-js, qrcode, etc.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadKugouApi(): any {
  if (kugouApi) return kugouApi
  if (loadError) throw new Error(loadError)

  try {
    const apiPath = app.isPackaged
      ? path.join(process.resourcesPath, 'kugou-api', 'main.js')
      : path.join(__dirname, '..', 'kugou-api', 'main.js')

    // eval('require') prevents static analysis by the bundler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dynamicRequire = eval('require')
    kugouApi = dynamicRequire(apiPath)
    console.log('[KuGouAPI] Library loaded from', apiPath)
    return kugouApi
  } catch (e) {
    loadError = `Failed to load KuGou API library: ${(e as Error).message}`
    console.error('[KuGouAPI]', loadError)
    throw new Error(loadError)
  }
}

/**
 * Device cookies — generated once, injected into every API call.
 * This replaces the cookie injection that server.js middleware would do
 * when running kugou-api as an HTTP server. Without these, the KuGou API
 * rejects requests with "Parameter Error" (error_code: 152).
 */
let deviceCookies: Record<string, string> | null = null
let deviceRegistered = false

function getDeviceCookies(): Record<string, string> {
  if (deviceCookies) return deviceCookies

  const guidRaw = crypto.randomUUID()
  const guidHash = crypto.createHash('md5').update(guidRaw).digest('hex')
  const mid = BigInt('0x' + guidHash).toString()
  const chars = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const dev = Array.from({ length: 10 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
  const webglHash = BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString()

  deviceCookies = {
    KUGOU_API_MID: mid,
    KUGOU_API_GUID: guidHash,
    KUGOU_API_DEV: dev,
    KUGOU_API_MAC: '02:00:00:00:00:00',
    KUGOU_API_WEBGL: webglHash,
  }
  console.log('[KuGouAPI] Device cookies generated')
  return deviceCookies
}

async function ensureDeviceRegistered(): Promise<void> {
  if (deviceRegistered) return
  
  try {
    const api = loadKugouApi()
    const cookies = getDeviceCookies()
    const result = await api['register_dev']({ cookie: cookies })
    const dfid = result?.body?.data?.dfid
    if (dfid && deviceCookies) {
      deviceCookies.dfid = dfid
      deviceRegistered = true
      console.log('[KuGouAPI] Device registered, dfid:', dfid.substring(0, 8) + '...')
    }
  } catch (e) {
    console.warn('[KuGouAPI] Device registration failed, continuing anyway')
  }
}

/**
 * Call a kugou-api module function and return its response body.
 *
 * kugou-api functions return { status, body, cookie, headers } on success,
 * but REJECT with the same shape ({ status: 502, body, ... }) when the KuGou
 * server returns an error (error_code !== 0). We catch that rejection and
 * still return `body` so the frontend can read error_code / error_msg and
 * show a friendly message instead of an unhandled IPC error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SONG_URL_ENDPOINTS = new Set(['song_url', 'song_url_new', 'song_climax', 'kmr_audio_mv', 'video_url', 'lyric', 'search_lyric'])

async function callApi(fnName: string, params: Record<string, any> = {}): Promise<any> {
  const api = loadKugouApi()
  if (typeof api[fnName] !== 'function') {
    throw new Error(`KuGou API function not found: ${fnName}`)
  }
  
  if (SONG_URL_ENDPOINTS.has(fnName)) {
    await ensureDeviceRegistered()
  }
  
  const userCookie = params.cookie || {}
  params.cookie = { ...getDeviceCookies(), ...userCookie }

  try {
    const result = await api[fnName](params)
    return result?.body ?? result
  } catch (err: any) {
    if (err && typeof err === 'object' && 'body' in err) {
      console.warn(`[KuGouAPI] ${fnName} returned error:`, err.body?.error_code || err.body?.errcode, err.body?.error_msg || '')
      return err.body
    }
    throw err
  }
}

// ============ Search ============
export async function kgSearch(keyword: string, page = 1, pageSize = 30) {
  let body = await callApi('search', { keywords: keyword, page, pagesize: pageSize })
  // Always try complex search as fallback to get more results
  let complex = await callApi('search_complex', { keywords: keyword, page, pagesize: pageSize })
  if (typeof complex === 'string') {
    try {
      const jsonStr = complex
        .replace(/<!--KG_TAG_RES_START-->/g, '')
        .replace(/<!--KG_TAG_RES_END-->/g, '')
      complex = JSON.parse(jsonStr)
    } catch {
      complex = { error_code: -1, data: { lists: [] } }
    }
  }
  if (complex?.data?.lists && Array.isArray(complex.data.lists)) {
    const songBlock = complex.data.lists.find((b: any) => b.type === 'song')
    if (songBlock && songBlock.lists && songBlock.lists.length > 0) {
      body = {
        ...complex,
        data: {
          ...complex.data,
          lists: songBlock.lists || [],
        },
      }
    }
  }
  return body
}

export async function kgSearchHot() {
  return callApi('search_hot')
}

export async function kgSearchDefault() {
  return callApi('search_default')
}

export async function kgSearchSuggest(keyword: string) {
  return callApi('search_suggest', { keyword })
}

export async function kgSearchComplex(keyword: string, page = 1) {
  return callApi('search_complex', { keyword, page })
}

// ============ Song URL ============
export async function kgSongUrl(hash: string, albumId?: string, albumAudioId?: string, uid?: string, token?: string) {
  const cookie: Record<string, string> = {}
  if (uid) cookie.userid = uid
  if (token) cookie.token = token
  
  const body = await callApi('song_url', { 
    hash, 
    album_id: albumId || 0,
    album_audio_id: albumAudioId || 0,
    cookie,
  })
  
  let playUrl = ''
  if (Array.isArray(body?.url) && body.url.length > 0) {
    playUrl = body.url[0]
  } else if (Array.isArray(body?.backupUrl) && body.backupUrl.length > 0) {
    playUrl = body.backupUrl[0]
  }
  
  return {
    ...body,
    play_url: playUrl,
    data: {
      play_url: playUrl,
      hash: body?.hash || hash,
      file_name: body?.fileName || '',
      time_length: body?.timeLength || 0,
      bit_rate: body?.bitRate || 0,
    }
  }
}

// ============ Lyrics ============
export async function kgLyric(hash: string, albumId?: string) {
  const songInfo = await callApi('song_url', { hash, album_id: albumId || 0 })
  const lyricId = songInfo?.data?.lyric_id || songInfo?.data?.[0]?.lyric_id
  const accesskey = songInfo?.data?.accesskey || songInfo?.data?.[0]?.accesskey
  if (!lyricId || !accesskey) return null
  return callApi('lyric', { id: lyricId, accesskey, fmt: 'lrc', decode: true })
}

export async function kgSearchLyric(keyword: string, duration?: number, hash?: string) {
  return callApi('search_lyric', { keywords: keyword, duration: duration || 0, hash: hash || '' })
}

export async function kgGetLyricById(id: string, accesskey: string) {
  return callApi('lyric', { id, accesskey, fmt: 'lrc', decode: true })
}

// ============ Login (QR Code) ============
export async function kgQrKey() {
  // type: 'web' uses appid 1014 for web QR login
  return callApi('login_qr_key', { type: 'web' })
}

export async function kgQrCreate(key: string) {
  // qrimg: true generates a base64 PNG data URL via the qrcode library
  return callApi('login_qr_create', { key, qrimg: true })
}

export async function kgQrCheck(key: string) {
  return callApi('login_qr_check', { key })
}

// ============ User ============
export async function kgUserDetail(uid: string, token: string) {
  return callApi('user_detail', { userid: uid, cookie: { userid: uid, token } })
}

export async function kgUserPlaylist(uid: string, token: string, page = 1) {
  return callApi('user_playlist', { userid: uid, cookie: { userid: uid, token }, page })
}

// ============ Playlist ============
export async function kgPlaylistDetail(id: string) {
  return callApi('playlist_detail', { id })
}

export async function kgPlaylistTrackAll(id: string, page = 1) {
  return callApi('playlist_track_all', { id, page })
}

export async function kgPlaylistTrackAllNew(listId: string, page = 1, uid?: string, token?: string) {
  const cookie: Record<string, string> = {}
  if (uid) cookie.userid = uid
  if (token) cookie.token = token
  return callApi('playlist_track_all_new', { listid: listId, page, cookie })
}

// ============ Rank ============
export async function kgRankList() {
  return callApi('rank_list')
}

export async function kgRankAudio(rankId: string, page = 1) {
  return callApi('rank_audio', { rankid: rankId, page })
}

// ============ Recommend ============
export async function kgRecommendSongs() {
  return callApi('recommend_songs')
}

export async function kgPersonalFm(token: string) {
  return callApi('personal_fm', { cookie: { token } })
}

export async function kgEverydayRecommend(token: string) {
  return callApi('everyday_recommend', { cookie: { token } })
}

// ============ Artist ============
export async function kgArtistDetail(artistId: string) {
  return callApi('artist_detail', { singerid: artistId })
}

export async function kgArtistAudios(artistId: string, page = 1) {
  return callApi('artist_audios', { singerid: artistId, page })
}

// ============ Album ============
export async function kgAlbumDetail(albumId: string) {
  return callApi('album_detail', { albumid: albumId })
}

export async function kgAlbumSongs(albumId: string, page = 1) {
  return callApi('album_songs', { albumid: albumId, page })
}

// ============ Top / New ============
export async function kgTopSong() {
  return callApi('top_song')
}

export async function kgTopAlbum() {
  return callApi('top_album')
}

export async function kgTopPlaylist(tag?: string, page = 1) {
  return callApi('top_playlist', { tag, page })
}

// ============ FM ============
export async function kgFmClass() {
  return callApi('fm_class')
}

export async function kgFmRecommend(classId: string) {
  return callApi('fm_recommend', { classid: classId })
}

export async function kgFmSongs(classId: string, songId?: string) {
  return callApi('fm_songs', { classid: classId, songid: songId })
}

// ============ Comment ============
export async function kgCommentMusic(hash: string, page = 1) {
  return callApi('comment_music', { hash, page })
}

// ============ Banner ============
export async function kgBanner() {
  return callApi('yueku_banner')
}

// ============ Scene ============
export async function kgSceneLists() {
  return callApi('scene_lists')
}

export async function kgSceneAudioList(sceneId: string, page = 1) {
  return callApi('scene_audio_list', { scene_id: sceneId, page })
}

// ============ Radio ============
export async function kgDiantai() {
  return callApi('pc_diantai')
}

// ============ Song Detail / Climax ============
export async function kgSongDetail(hash: string) {
  return callApi('song_url', { hash })
}

export async function kgSongClimax(hash: string) {
  return callApi('song_climax', { hash })
}

// ============ MV ============
export async function kgAudioMv(hash: string) {
  return callApi('kmr_audio_mv', { hash })
}

export async function kgVideoUrl(videoHash: string) {
  return callApi('video_url', { videohash: videoHash })
}

// ============ Health Check ============
export async function kgHealthCheck(): Promise<boolean> {
  try {
    // search_hot is a lightweight endpoint that reliably succeeds with device cookies
    const body = await callApi('search_hot')
    return body?.status === 1
  } catch {
    return false
  }
}
