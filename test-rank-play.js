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
  console.log('测试榜单前15首歌有多少能播放...')
  
  await ensureDeviceRegistered()
  
  const rankRes = await callApi('rank_audio', { rankid: 8888, page: 1, pagesize: 15 })
  const songs = rankRes?.data?.songlist || []
  console.log('榜单歌曲数:', songs.length)
  
  let playableCount = 0
  let vipCount = 0
  let errorCount = 0
  
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i]
    const hash = s.audio_info?.hash_128 || ''
    try {
      const urlRes = await callApi('song_url', {
        hash,
        album_id: s.album_id,
        album_audio_id: s.album_audio_id,
      })
      const hasUrl = Array.isArray(urlRes?.url) && urlRes.url.length > 0
      const isVip = urlRes?.priv_status === 0 || urlRes?.fail_process?.length > 0
      
      if (hasUrl) {
        playableCount++
        console.log(`  [${i+1}] ✅ ${s.songname} - ${s.author_name}`)
      } else if (isVip) {
        vipCount++
        console.log(`  [${i+1}] 💰 ${s.songname} - ${s.author_name} (付费/VIP)`)
      } else {
        errorCount++
        console.log(`  [${i+1}] ❌ ${s.songname} - ${s.author_name} (其他错误)`)
      }
    } catch (e) {
      errorCount++
      console.log(`  [${i+1}] ❌ ${s.songname} - 异常: ${e.message.substring(0, 50)}`)
    }
  }
  
  console.log(`\n结果: ${playableCount}首可播放, ${vipCount}首付费, ${errorCount}首错误`)
}

test().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
