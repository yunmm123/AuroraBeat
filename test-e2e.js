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
      console.log('[OK] 设备注册成功, dfid:', dfid.substring(0, 12) + '...')
      return true
    }
    console.log('[FAIL] 设备注册失败, body:', JSON.stringify(result?.body).substring(0, 200))
    return false
  } catch (e) {
    console.log('[FAIL] 设备注册异常:', e.message)
    return false
  }
}

const SONG_URL_ENDPOINTS = new Set(['song_url', 'song_url_new', 'lyric', 'search_lyric'])

async function callApi(fnName, params = {}) {
  if (SONG_URL_ENDPOINTS.has(fnName)) {
    await ensureDeviceRegistered()
  }
  const userCookie = params.cookie || {}
  params.cookie = { ...getDeviceCookies(), ...userCookie }
  
  try {
    const result = await kugouApi[fnName](params)
    return { success: true, body: result?.body ?? result, status: result?.status }
  } catch (err) {
    if (err && typeof err === 'object' && 'body' in err) {
      return { success: false, body: err.body, status: err.status }
    }
    return { success: false, body: { error_msg: err.message }, status: 500 }
  }
}

async function test() {
  console.log('='.repeat(70))
  console.log('端到端全面测试')
  console.log('='.repeat(70))

  // 1. 设备注册
  console.log('\n[1] 设备注册...')
  const regOk = await ensureDeviceRegistered()

  // 2. top_song (发现页新歌速递)
  console.log('\n[2] top_song (发现页新歌速递)...')
  const topRes = await callApi('top_song')
  console.log('  success:', topRes.success)
  const topData = topRes.body?.data || {}
  const topKeys = Object.keys(topData)
  console.log('  歌曲数量:', topKeys.length)
  if (topKeys.length > 0) {
    const song = topData[topKeys[0]]
    console.log('  第一首:', song.songname, '-', song.author_name)
    console.log('  hash:', song.hash)
    console.log('  album_audio_id:', song.album_audio_id)
    
    // 测试播放
    console.log('\n[2a] top_song 歌曲播放测试...')
    const urlRes = await callApi('song_url', {
      hash: song.hash,
      album_id: song.album_id,
      album_audio_id: song.album_audio_id,
    })
    console.log('  success:', urlRes.success)
    console.log('  errcode:', urlRes.body?.errcode)
    console.log('  error_code:', urlRes.body?.error_code)
    const urls = urlRes.body?.url
    if (Array.isArray(urls)) {
      console.log('  url数量:', urls.length)
      if (urls.length > 0) {
        console.log('  url[0]前60字符:', urls[0].substring(0, 60) + '...')
      }
    } else {
      console.log('  body预览:', JSON.stringify(urlRes.body).substring(0, 200))
    }
    
    // 测试歌词搜索
    console.log('\n[2b] 歌词搜索测试...')
    const keyword = `${song.songname} ${song.author_name}`
    const lyricSearchRes = await callApi('search_lyric', {
      keywords: keyword,
      duration: Math.floor((song.timelength || 0) / 1000),
      hash: song.hash,
    })
    console.log('  success:', lyricSearchRes.success)
    const candidates = lyricSearchRes.body?.candidates || lyricSearchRes.body?.data?.candidates || []
    console.log('  candidates数量:', candidates.length)
    if (candidates.length > 0) {
      console.log('  第一个:', candidates[0].song, '-', candidates[0].singer)
      console.log('  id:', candidates[0].id)
      console.log('  accesskey:', candidates[0].accesskey?.substring(0, 20) + '...')
      
      // 测试获取歌词
      console.log('\n[2c] 获取歌词内容...')
      const lyricRes = await callApi('lyric', {
        id: candidates[0].id,
        accesskey: candidates[0].accesskey,
        fmt: 'lrc',
        decode: true,
      })
      console.log('  success:', lyricRes.success)
      const content = lyricRes.body?.decodeContent || lyricRes.body?.data?.decodeContent || ''
      console.log('  歌词长度:', content.length)
      if (content.length > 0) {
        console.log('  前100字符:', content.substring(0, 100))
      }
    }
  }

  // 3. rank_list + rank_audio (榜单)
  console.log('\n[3] 榜单测试...')
  const rankListRes = await callApi('rank_list')
  console.log('  榜单列表 success:', rankListRes.success)
  const ranks = rankListRes.body?.data?.info || rankListRes.body?.data?.list || []
  console.log('  榜单数量:', ranks.length)
  
  if (ranks.length > 0) {
    const rank = ranks[0]
    console.log('  测试榜单:', rank.rankname, 'rankid:', rank.rankid)
    
    const rankAudioRes = await callApi('rank_audio', { rankid: rank.rankid, page: 1, pagesize: 10 })
    console.log('  rank_audio success:', rankAudioRes.success)
    const songlist = rankAudioRes.body?.data?.songlist || []
    console.log('  歌曲数量:', songlist.length)
    
    if (songlist.length > 0) {
      const rs = songlist[0]
      console.log('  第一首:', rs.songname, '-', rs.author_name)
      console.log('  audio_id:', rs.audio_id)
      console.log('  album_audio_id:', rs.album_audio_id)
      console.log('  audio_info.hash_128:', rs.audio_info?.hash_128)
      console.log('  audio_info.hash_320:', rs.audio_info?.hash_320)
      
      // 测试用 audio_info.hash_128 播放
      console.log('\n[3a] 榜单歌曲播放测试 (用hash_128)...')
      const urlRes = await callApi('song_url', {
        hash: rs.audio_info?.hash_128,
        album_id: rs.album_id,
        album_audio_id: rs.album_audio_id,
      })
      console.log('  success:', urlRes.success)
      console.log('  errcode:', urlRes.body?.errcode)
      const urls = urlRes.body?.url
      if (Array.isArray(urls) && urls.length > 0) {
        console.log('  [OK] 有播放URL!')
      } else {
        console.log('  [FAIL] 无播放URL')
        console.log('  body:', JSON.stringify(urlRes.body).substring(0, 300))
      }
    }
  }

  // 4. 搜索测试
  console.log('\n[4] 搜索测试...')
  const keyword = '周杰伦'
  
  console.log('  [4a] search 接口...')
  const searchRes = await callApi('search', { keywords: keyword, page: 1, pagesize: 10 })
  console.log('    success:', searchRes.success)
  console.log('    error_code:', searchRes.body?.error_code)
  const searchLists = searchRes.body?.data?.lists || []
  console.log('    歌曲数量:', searchLists.length)
  
  console.log('  [4b] search_complex 接口...')
  const scRes = await callApi('search_complex', { keywords: keyword, page: 1, pagesize: 10 })
  console.log('    success:', scRes.success)
  console.log('    body类型:', typeof scRes.body)
  if (typeof scRes.body === 'string') {
    console.log('    前100字符:', scRes.body.substring(0, 100))
    try {
      const jsonStr = scRes.body.replace(/<!--KG_TAG_RES_START-->/, '').replace(/<!--KG_TAG_RES_END-->/, '')
      const parsed = JSON.parse(jsonStr)
      console.log('    解析后 error_code:', parsed.error_code)
      const blocks = parsed.data?.lists || []
      console.log('    blocks数量:', blocks.length)
      const songBlock = blocks.find((b) => b.type === 'song')
      if (songBlock) {
        console.log('    song类型的lists数量:', songBlock.lists?.length || 0)
        if (songBlock.lists?.length > 0) {
          console.log('    第一首:', songBlock.lists[0].SongName || songBlock.lists[0].songname)
          console.log('    hash:', songBlock.lists[0].Hash || songBlock.lists[0].hash)
        }
      }
    } catch (e) {
      console.log('    解析失败:', e.message)
    }
  }
  
  console.log('  [4c] search_mixed 接口...')
  try {
    const smRes = await callApi('search_mixed', { keyword })
    console.log('    success:', smRes.success)
    console.log('    error_code:', smRes.body?.error_code)
  } catch (e) {
    console.log('    接口不存在或异常:', e.message)
  }

  console.log('\n' + '='.repeat(70))
  console.log('测试完成')
  console.log('='.repeat(70))
}

test().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
