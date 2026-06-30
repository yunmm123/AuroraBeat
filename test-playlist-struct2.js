const crypto = require('crypto')
const path = require('path')

const apiPath = path.join(__dirname, 'kugou-api', 'main.js')
const kugouApi = require(apiPath)

let deviceCookies = null
let deviceRegistered = false

function getDeviceCookies() {
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
  return deviceCookies
}

async function ensureDeviceRegistered() {
  if (deviceRegistered) return true
  try {
    const cookies = getDeviceCookies()
    const result = await kugouApi['register_dev']({ cookie: cookies })
    const dfid = result?.body?.data?.dfid
    if (dfid) {
      deviceCookies.dfid = dfid
      deviceRegistered = true
      return true
    }
    return false
  } catch (e) {
    return false
  }
}

async function callApi(fnName, params = {}) {
  if (['song_url', 'lyric', 'search_lyric'].includes(fnName)) {
    await ensureDeviceRegistered()
  }
  const userCookie = params.cookie || {}
  params.cookie = { ...getDeviceCookies(), ...userCookie }
  
  try {
    const result = await kugouApi[fnName](params)
    return result?.body ?? result
  } catch (err) {
    if (err && typeof err === 'object' && 'body' in err) {
      return err.body
    }
    throw err
  }
}

async function test() {
  await ensureDeviceRegistered()
  
  console.log('=== 测试歌单歌曲结构 ===')
  
  const topPlRes = await callApi('top_playlist', { page: 1, pagesize: 3 })
  console.log('top_playlist error_code:', topPlRes?.error_code)
  const playlists = topPlRes?.data?.info || topPlRes?.data?.list || []
  console.log('歌单数量:', playlists.length)
  
  if (playlists.length > 0) {
    const pl = playlists[0]
    const plId = pl.listid || pl.specialid || pl.id
    console.log('测试歌单:', pl.specialname, 'id:', plId)
    
    // 测试 playlist_track_all
    console.log('\n--- playlist_track_all ---')
    const trackRes = await callApi('playlist_track_all', { id: plId, page: 1, pagesize: 3 })
    console.log('error_code:', trackRes?.error_code)
    
    const tracks = trackRes?.data?.lists || trackRes?.data?.songlist || trackRes?.data?.info || []
    console.log('歌曲数量:', tracks.length)
    
    if (tracks.length > 0) {
      const t = tracks[0]
      console.log('\n第一首歌顶层字段:', Object.keys(t).sort().join(', '))
      console.log('  Hash:', t.Hash || '(无)')
      console.log('  hash:', t.hash || '(无)')
      console.log('  audio_id:', t.audio_id || '(无)')
      console.log('  audio_info?.hash_128:', t.audio_info?.hash_128 || '(无)')
      console.log('  SongName:', t.SongName || t.songname || '(无)')
      console.log('  album_audio_id:', t.album_audio_id || t.AlbumAudioID || '(无)')
    }
    
    // 测试 playlist_track_all_new
    console.log('\n--- playlist_track_all_new ---')
    const trackNewRes = await callApi('playlist_track_all_new', { listid: plId, page: 1, pagesize: 3 })
    console.log('error_code:', trackNewRes?.error_code)
    
    const tracksNew = trackNewRes?.data?.lists || trackNewRes?.data?.songlist || trackNewRes?.data?.info || []
    console.log('歌曲数量:', tracksNew.length)
    
    if (tracksNew.length > 0) {
      const t = tracksNew[0]
      console.log('\n第一首歌顶层字段:', Object.keys(t).sort().join(', '))
      console.log('  Hash:', t.Hash || '(无)')
      console.log('  hash:', t.hash || '(无)')
      console.log('  audio_id:', t.audio_id || '(无)')
      console.log('  audio_info?.hash_128:', t.audio_info?.hash_128 || '(无)')
      console.log('  SongName:', t.SongName || t.songname || '(无)')
      console.log('  album_audio_id:', t.album_audio_id || t.AlbumAudioID || '(无)')
    }
  }
}

test().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
