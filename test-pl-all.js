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
  
  const topPlRes = await callApi('top_playlist', { page: 1, pagesize: 3 })
  const playlists = topPlRes?.data?.special_list || []
  
  if (playlists.length > 0) {
    const pl = playlists[0]
    const plId = pl.specialid
    console.log('歌单ID:', plId)
    
    // 测试 playlist_track_all (旧接口)
    console.log('\n--- playlist_track_all ---')
    try {
      const res = await callApi('playlist_track_all', { id: plId, page: 1, pagesize: 3 })
      console.log('error_code:', res?.error_code)
      console.log('data keys:', Object.keys(res?.data || {}))
      const d = res?.data
      if (d) {
        for (const k of Object.keys(d)) {
          if (Array.isArray(d[k]) && d[k].length > 0) {
            console.log(`  ${k}: ${d[k].length}项`)
            if (k.includes('list') || k.includes('song') || k.includes('track')) {
              const t = d[k][0]
              console.log('  第一首hash:', t.Hash || t.hash || t.audio_id || '(无)')
              console.log('  第一首歌名:', t.SongName || t.songname || '(无)')
              console.log('  完整预览:', JSON.stringify(t).substring(0, 200))
            }
          }
        }
      }
    } catch (e) {
      console.log('异常:', e.message.substring(0, 100))
    }
    
    // 测试 playlist_detail
    console.log('\n--- playlist_detail ---')
    try {
      const res = await callApi('playlist_detail', { id: plId })
      console.log('error_code:', res?.error_code)
      console.log('data keys:', Object.keys(res?.data || {}))
    } catch (e) {
      console.log('异常:', e.message.substring(0, 100))
    }
  }
}

test().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
