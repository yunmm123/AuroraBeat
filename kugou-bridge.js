// ====================================================================
// AuroraBeat 酷狗桥接层 — 隔离酷狗所有状态/调用
//
// 隔离原则（用户要求"不要互相影响"）：
// - 独立 cookie 文件 aurorabeat-kugou-cookie.txt（不碰网易云 cookie 文件）
// - 独立设备指纹文件 aurorabeat-kugou-device.json
// - 所有函数都在本文件，不污染 server.js / main.ts 的网易云逻辑
//
// URL 获取策略（三层降级）：
// 1. wwwapi.kugou.com/yy/index.php r=play/getdata（酷狗网页播放器同款接口，带登录 cookie）
//    — 这是用户 SVIP 能拿高音质的主路径
// 2. kugou-api 库的 song_url（带 Android 签名，作为兜底）
// 3. 128 试听（无登录也能用）
// ====================================================================

const path = require('path');
const fs = require('fs');
const axios = require(path.join(__dirname, 'kugou-api', 'node_modules', 'axios'));

// kugou-api 库（仅用于签名版 song_url 兜底，搜索和歌词走更简单的 web 接口）
let kugouApi = null;
let kugouUtil = null;
try {
  kugouApi = require(path.join(__dirname, 'kugou-api', 'main.js'));
  kugouUtil = require(path.join(__dirname, 'kugou-api', 'util', 'util.js'));
} catch (e) {
  console.warn('[Kugou] kugou-api 库加载失败，将仅使用 web 接口:', e.message);
}

// ========== 持久化文件（与网易云完全独立）==========
const COOKIE_FILE = path.join(process.env.APPDATA || process.env.HOME || __dirname, 'aurorabeat-kugou-cookie.txt');
const DEVICE_FILE = path.join(process.env.APPDATA || process.env.HOME || __dirname, 'aurorabeat-kugou-device.json');

// ========== 设备指纹（kugou-api 库需要的 KUGOU_API_MID 等）==========
let deviceFingerprint = null;
function loadDeviceFingerprint() {
  if (deviceFingerprint) return deviceFingerprint;
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      deviceFingerprint = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
      if (deviceFingerprint?.guid && deviceFingerprint?.mid) return deviceFingerprint;
    }
  } catch {}
  if (!kugouUtil) {
    deviceFingerprint = { guid: '', mid: '', dev: '', mac: '02:00:00:00:00:00', webgl: '' };
    return deviceFingerprint;
  }
  const guid = kugouUtil.getGuid();
  const mid = kugouUtil.calculateMid(guid);
  deviceFingerprint = {
    guid,
    mid,
    dev: kugouUtil.randomString(24).toUpperCase(),
    mac: '02:00:00:00:00:00',
    webgl: kugouUtil.generateWebGLHash(),
  };
  try { fs.writeFileSync(DEVICE_FILE, JSON.stringify(deviceFingerprint), 'utf8'); } catch {}
  return deviceFingerprint;
}

// ========== 用户登录 cookie ==========
let userCookie = '';
try {
  if (fs.existsSync(COOKIE_FILE)) userCookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim();
} catch {}

function saveCookie(c) {
  userCookie = (typeof c === 'string' ? c.trim() : '');
  try { fs.writeFileSync(COOKIE_FILE, userCookie, 'utf8'); } catch {}
}
function clearCookie() {
  userCookie = '';
  try { fs.unlinkSync(COOKIE_FILE); } catch {}
}
function parseCookieStr(str) {
  const obj = {};
  String(str || '').split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i <= 0) return;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (k) obj[k] = v;
  });
  return obj;
}
// 构造 kugou-api 库所需的完整 cookie（用户 cookie + 设备指纹）
function buildApiCookie() {
  const user = parseCookieStr(userCookie);
  const dev = loadDeviceFingerprint();
  return { ...user, KUGOU_API_MID: dev.mid, KUGOU_API_GUID: dev.guid, KUGOU_API_DEV: dev.dev, KUGOU_API_MAC: dev.mac, KUGOU_API_WEBGL: dev.webgl };
}
// 构造给 axios 用的 Cookie 字符串（用户登录态 + kg_mid 用于反爬）
function buildCookieHeader() {
  const user = parseCookieStr(userCookie);
  // 如果用户 cookie 里没有 kg_mid，生成一个伪 kg_mid（不影响登录态）
  if (!user.kg_mid) {
    const crypto = require('crypto');
    user.kg_mid = crypto.randomBytes(16).toString('hex');
  }
  return Object.entries(user).map(([k, v]) => `${k}=${v}`).join('; ');
}
function hasLogin() {
  return /(^|;)\s*token=/.test(userCookie) && /(^|;)\s*userid=/.test(userCookie);
}

// ====================================================================
// 搜索：msearchcdn.kugou.com/api/v3/search/song（无需签名，验证可用）
// 返回 [{ id, name, artist, album, cover, hash, albumId, audioId, duration, source:'kugou' }]
// ====================================================================
async function searchSongs(keywords, limit = 30) {
  const r = await axios.get('http://msearchcdn.kugou.com/api/v3/search/song', {
    params: { keyword: keywords, page: 1, pagesize: limit, showtype: 10 },
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
    timeout: 8000,
  });
  const list = r.data?.data?.info || [];
  return list.filter(Boolean).map((s, i) => ({
    id: `kg-${s.audio_id || s.id || `${i}-${(s.hash || '').slice(0, 8)}`}`,
    hash: s.hash || '',
    audioId: String(s.audio_id || 0),
    name: (s.songname || '').replace(/<[^>]+>/g, '').trim(),
    artist: (s.singername || '').replace(/<[^>]+>/g, '').replace(/、/g, '/').trim(),
    album: (s.album_name || '').trim(),
    albumId: String(s.album_id || 0),
    cover: (s.albumpic || s.image || '').replace(/^http:/, 'https:'),
    duration: s.duration || 0,
    source: 'kugou',
  })).filter(s => s.hash);
}

// ====================================================================
// 取播放 URL：三层降级
//   1. wwwapi.kugou.com/yy/index.php r=play/getdata（网页播放器同款，带登录 cookie）
//      SVIP 登录后可返回 flac/super 等高音质 URL
//   2. kugou-api 库 song_url（带 Android 签名）
//   3. 失败返回 null
// ====================================================================
async function getSongUrl(hash, albumId, audioId) {
  // 策略 1：web 接口（主路径，SVIP 登录后返回高音质）
  try {
    const r = await axios.get('https://wwwapi.kugou.com/yy/index.php', {
      params: { r: 'play/getdata', hash, album_id: albumId || 0, _: Date.now() },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Cookie: buildCookieHeader(),
        Referer: 'https://www.kugou.com/',
      },
      timeout: 8000,
    });
    const d = r.data?.data || {};
    if (d.play_url) {
      return { url: d.play_url.replace(/^http:/, 'https:'), quality: d.quality_type || 'unknown', trial: !!d.is_free_part, playable: true, img: d.img, lyrics: d.lyrics || '' };
    }
    if (d.play_backup_url) {
      return { url: d.play_backup_url.replace(/^http:/, 'https:'), quality: d.quality_type || 'unknown', trial: !!d.is_free_part, playable: true, img: d.img, lyrics: d.lyrics || '' };
    }
  } catch (e) {
    console.warn('[Kugou] play/getdata failed:', e?.message || e);
  }
  // 策略 2：kugou-api 库签名版（兜底）
  if (kugouApi) {
    try {
      const r = await kugouApi.song_url({ hash, album_audio_id: Number(audioId || 0), cookie: buildApiCookie() });
      const url = r.body?.url?.find(u => u.url)?.url;
      if (url) return { url: url.replace(/^http:/, 'https:'), quality: '128', trial: false, playable: true };
    } catch (e) {
      console.warn('[Kugou] song_url fallback failed:', e?.error_code || e?.message || e);
    }
  }
  return { url: null, playable: false };
}

// ====================================================================
// 歌词：lyrics.kugou.com（无需签名）
// ====================================================================
async function getLyrics(hash) {
  try {
    // step1: 搜索歌词
    const r = await axios.get('https://lyrics.kugou.com/search', {
      params: { ver: 1, man: 'yes', client: 'mobi', hash },
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
      timeout: 6000,
    });
    const candidates = r.data?.candidates || [];
    if (!candidates.length) return { lyric: '' };
    const c = candidates[0];
    // step2: 下载歌词
    const dl = await axios.get('https://lyrics.kugou.com/download', {
      params: { ver: 1, client: 'mobi', id: c.id, accesskey: c.accesskey, fmt: 'lrc', charset: 'utf8' },
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36' },
      timeout: 6000,
    });
    let lyric = '';
    if (dl.data?.content) {
      try { lyric = Buffer.from(dl.data.content, 'base64').toString('utf8'); } catch {}
    }
    return { lyric };
  } catch (e) {
    console.warn('[Kugou] lyric failed:', e?.message || e);
    return { lyric: '' };
  }
}

// ====================================================================
// 登录态校验：读 cookie 里 userid/token/vip_type/vip_token
// 不调远端接口（避免触发风控），直接从 cookie 解析
// ====================================================================
function getLoginInfo() {
  const c = parseCookieStr(userCookie);
  if (!c.token || !c.userid) return { loggedIn: false };
  // 酷狗 vip_type: 1=普通VIP, 6=SVIP豪华版, 7=音乐人
  const vipType = Number(c.vip_type || 0);
  return {
    loggedIn: true,
    userid: c.userid,
    nickname: '酷狗用户' + c.userid.slice(-4),
    avatar: '',
    vipType,
    isSvip: vipType >= 6,
    hasVipToken: !!c.vip_token,
  };
}

module.exports = {
  searchSongs,
  getSongUrl,
  getLyrics,
  getLoginInfo,
  saveCookie,
  clearCookie,
  hasLogin,
  parseCookieStr,
};
