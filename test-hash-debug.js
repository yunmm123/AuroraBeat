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
  
  // 测试榜单歌曲
  console.log('=== 榜单歌曲字段检查 ===')
  const rankRes = await callApi('rank_audio', { rankid: 8888, page: 1, pagesize: 3 })
  const songs = rankRes?.data?.songlist || []
  
  for (let i = 0; i < Math.min(3, songs.length); i++) {
    const s = songs[i]
    console.log(`\n歌曲${i+1}: ${s.songname}`)
    console.log('  顶层字段:', Object.keys(s).sort().join(', '))
    console.log('  hash (顶层):', s.hash || '(无)')
    console.log('  audio_id:', s.audio_id)
    console.log('  audio_info.hash_128:', s.audio_info?.hash_128 || '(无)')
    console.log('  album_audio_id:', s.album_audio_id)
    
    // 测试用 audio_id 当 hash 的结果
    console.log('\n  测试1: 用 audio_id 当hash (错误做法):')
    try {
      const urlRes1 = await callApi('song_url', {
        hash: s.audio_id,
        album_id: s.album_id,
        album_audio_id: s.album_audio_id,
      })
      const hasUrl = Array.isArray(urlRes1?.url) && urlRes1.url.length > 0
      console.log('    有URL?', hasUrl, 'errcode:', urlRes1?.errcode, 'error_code:', urlRes1?.error_code)
    } catch (e) {
      console.log('    异常:', e.message.substring(0, 80))
    }
    
    // 测试用 hash_128 当 hash 的结果
    if (s.audio_info?.hash_128) {
      console.log('\n  测试2: 用 audio_info.hash_128 (正确做法):')
      try {
        const urlRes2 = await callApi('song_url', {
          hash: s.audio_info.hash_128,
          album_id: s.album_id,
          album_audio_id: s.album_audio_id,
        })
        const hasUrl = Array.isArray(urlRes2?.url) && urlRes2.url.length > 0
        const isPay = urlRes2?.priv_status === 0 || urlRes2?.fail_process?.length > 0
        console.log('    有URL?', hasUrl, '付费?', isPay)
      } catch (e) {
        console.log('    异常:', e.message.substring(0, 80))
      }
    }
  }
}

test().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
