// ====================================================================
//  AuroraBeat Server — 本地HTTP服务器
//  对标 Mineradio 架构：所有网易云API调用通过本地HTTP服务器
//  Electron主进程启动此服务器，渲染进程通过fetch调用
// ====================================================================
const {
  search,
  cloudsearch,
  search_hot_detail,
  song_detail,
  song_url,
  song_url_v1,
  login_status,
  logout,
  user_account,
  user_playlist,
  like: like_song,
  likelist,
  playlist_detail,
  playlist_track_all,
  personalized,
  recommend_resource,
  recommend_songs,
  lyric,
  lyric_new,
} = require('NeteaseCloudMusicApi');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.AURORA_PORT || 0; // 0 = 自动选端口
const HOST = '127.0.0.1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const COOKIE_FILE = path.join(process.env.APPDATA || process.env.HOME || __dirname, 'aurorabeat-cookie.txt');

let userCookie = '';
try { if (fs.existsSync(COOKIE_FILE)) userCookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim(); } catch {}

function saveCookie(c) {
  userCookie = normalizeCookieHeader(c) || (typeof c === 'string' ? c.trim() : '');
  try { fs.writeFileSync(COOKIE_FILE, userCookie, 'utf8'); } catch {}
}

function clearCookie() {
  userCookie = '';
  try { fs.unlinkSync(COOKIE_FILE); } catch {}
}

// ========== Cookie 工具 ==========
function collectCookieInput(input, picked) {
  if (input == null) return;
  if (typeof input === 'object' && !Array.isArray(input)) {
    Object.keys(input).forEach(key => {
      const value = input[key];
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        if (!picked.has(key)) picked.set(key, value.value);
      } else if (typeof value !== 'object') {
        if (!picked.has(key)) picked.set(key, value);
      }
    });
    return;
  }
  String(input).split(/\r?\n/).forEach(line => {
    line.split(';').forEach(part => {
      const raw = String(part || '').trim();
      const idx = raw.indexOf('=');
      if (idx <= 0) return;
      const key = raw.slice(0, idx);
      if (!picked.has(key)) picked.set(key, raw.slice(idx + 1));
    });
  });
}

function normalizeCookieHeader(input) {
  const picked = new Map();
  collectCookieInput(input, picked);
  return Array.from(picked.entries())
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

// ========== HTTP 工具 ==========
function sendJSON(res, data, status) {
  const body = JSON.stringify(data);
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data) || {}); } catch { resolve({}); }
    });
  });
}

// ========== 业务逻辑 ==========
function mapArtists(arr) {
  return (arr || []).filter(Boolean).map(a => ({ id: a.id || 0, name: a.name || '' }));
}

function mapSongRecord(s) {
  s = s || {};
  const artists = mapArtists(s.ar || s.artists);
  const album = s.al || s.album || {};
  return {
    id: s.id,
    name: s.name || '',
    artist: artists.map(a => a.name).join(' / '),
    artists,
    album: album.name || '',
    cover: (album.picUrl || album.coverUrl || '').replace(/^http:/, 'https:'),
    duration: s.dt || s.duration || 0,
    fee: s.fee || 0,
  };
}

function mapPlaylist(pl, tag) {
  pl = pl || {};
  return {
    id: pl.id || pl.resourceId || pl.creativeId,
    name: pl.name || pl.title || '',
    cover: pl.picUrl || pl.coverImgUrl || pl.coverUrl || '',
    trackCount: pl.trackCount || pl.songCount || 0,
    playCount: pl.playCount || 0,
    creator: (pl.creator && pl.creator.nickname) || pl.creator?.name || '',
    tag: tag || '',
  };
}

function normalizeLoginInfo(profile, account) {
  profile = profile || {};
  account = account || {};
  const userId = profile.userId || profile.user_id || profile.id || account.userId || account.id || '';
  if (!userId && userId !== 0) return { loggedIn: false };
  return {
    loggedIn: true,
    userId: String(userId),
    nickname: profile.nickname || profile.userName || '网易云用户',
    avatar: profile.avatarUrl || profile.avatar || '',
  };
}

async function getLoginInfo() {
  if (!userCookie) return { loggedIn: false };
  try {
    const st = await login_status({ cookie: userCookie, timestamp: Date.now() });
    const body = st.body || {};
    const data = body.data || body;
    const info = normalizeLoginInfo(data.profile || body.profile, data.account || body.account);
    if (info.loggedIn) return info;
  } catch (e) {
    console.warn('[Login] login_status failed:', e.message);
  }
  try {
    const acc = await user_account({ cookie: userCookie, timestamp: Date.now() });
    const body = acc.body || {};
    const info = normalizeLoginInfo(body.profile, body.account);
    if (info.loggedIn) return info;
    return { loggedIn: false, hasCookie: !!userCookie };
  } catch (e) {
    console.warn('[Login] account check failed:', e.message);
    return { loggedIn: false, hasCookie: !!userCookie };
  }
}

async function handleSearch(keywords, limit) {
  const result = await cloudsearch({ keywords, limit, cookie: userCookie });
  const songs = result.body?.result?.songs || [];
  let mapped = songs.map(mapSongRecord);
  // 补齐缺失封面
  const missing = mapped.filter(s => !s.cover).map(s => s.id);
  if (missing.length) {
    try {
      const dd = await song_detail({ ids: missing.join(','), cookie: userCookie });
      const arr = dd.body?.songs || [];
      const idToPic = {};
      arr.forEach(s => {
        const pic = s.al?.picUrl || s.album?.picUrl || '';
        if (pic) idToPic[s.id] = pic.replace(/^http:/, 'https:');
      });
      mapped = mapped.map(s => s.cover ? s : { ...s, cover: idToPic[s.id] || '' });
    } catch {}
  }
  return mapped;
}

async function handleSongUrl(id, quality) {
  // 按用户选择的音质优先，找不到则逐级降级
  const qualityFallbackMap = {
    hires: ['hires', 'lossless', 'exhigh', 'standard'],
    lossless: ['lossless', 'exhigh', 'standard'],
    exhigh: ['exhigh', 'standard'],
    standard: ['standard'],
  };
  const levels = quality && qualityFallbackMap[quality] ? qualityFallbackMap[quality] : ['exhigh', 'standard', 'lossless'];
  let trialFallback = null;
  for (const level of levels) {
    try {
      let result;
      try {
        result = await song_url_v1({ id, level, cookie: userCookie });
      } catch {
        result = await song_url({ id, cookie: userCookie });
      }
      const d = result.body?.data?.[0];
      if (!d) continue;
      const url = d.url;
      const freeTrial = d.freeTrialInfo;
      if (url && !freeTrial) {
        return { url: url.replace(/^http:/, 'https:'), trial: false, playable: true, level };
      }
      if (url && freeTrial && !trialFallback) {
        trialFallback = { url: url.replace(/^http:/, 'https:'), trial: true, playable: true, level };
      }
    } catch (e) {
      console.warn('[SongUrl]', level, 'failed:', e.message);
    }
  }
  if (trialFallback) return trialFallback;
  return { url: null, playable: false };
}

async function handleDiscoverHome() {
  const info = await getLoginInfo();
  if (!info.loggedIn) {
    // 未登录也返回推荐歌单（无需cookie）
    try {
      const r = await personalized({ limit: 10, timestamp: Date.now() });
      const playlists = (r.body?.result || []).map(pl => mapPlaylist(pl, '推荐歌单')).filter(pl => pl.id).slice(0, 10);
      return { loggedIn: false, playlists, dailySongs: [] };
    } catch {
      return { loggedIn: false, playlists: [], dailySongs: [] };
    }
  }
  const tasks = await Promise.allSettled([
    personalized({ limit: 10, cookie: userCookie, timestamp: Date.now() }),
    recommend_songs({ cookie: userCookie, timestamp: Date.now() }),
  ]);
  const playlists = tasks[0].status === 'fulfilled'
    ? (tasks[0].value?.body?.result || []).map(pl => mapPlaylist(pl, '推荐歌单')).filter(pl => pl.id).slice(0, 10)
    : [];
  const dailySongs = tasks[1].status === 'fulfilled'
    ? (tasks[1].value?.body?.data?.dailySongs || tasks[1].value?.body?.data?.recommend || []).map(mapSongRecord).filter(s => s.id).slice(0, 20)
    : [];
  return { loggedIn: true, user: info, playlists, dailySongs };
}

// ========== HTTP Server ==========
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}`);
  const pn = url.pathname;

  try {
    // ========== 静态文件服务（vendor 目录，用于 music-tempo 库加载）==========
    if (pn.startsWith('/vendor/')) {
      // 打包后 vendor 在 dist/vendor（与 server.js 同级或上级），开发时在 public/vendor
      const candidates = [
        path.join(__dirname, 'dist', pn),              // 打包后（server.js 与 dist 同级）
        path.join(__dirname, 'public', pn),            // 开发时
        path.join(__dirname, '..', 'dist', pn),        // 备选
      ];
      let filePath = null;
      for (const c of candidates) {
        try { if (fs.existsSync(c) && fs.statSync(c).isFile()) { filePath = c; break; } } catch {}
      }
      if (!filePath) { res.writeHead(404); res.end('Not found'); return; }
      try {
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === '.js' ? 'application/javascript' : 'application/octet-stream';
        const data = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(data);
        return;
      } catch (e) {
        res.writeHead(500); res.end('Server error'); return;
      }
    }

    // ========== 搜索 ==========
    if (pn === '/api/search') {
      const kw = url.searchParams.get('keywords') || '';
      const limit = parseInt(url.searchParams.get('limit') || '30');
      const songs = await handleSearch(kw, limit);
      sendJSON(res, { songs });
      return;
    }

    // ========== v3.6.0 A2: 热搜榜（搜索框聚焦时展示） ==========
    if (pn === '/api/search/hot') {
      try {
        const r = await search_hot_detail({ cookie: userCookie });
        const list = (r.body?.data || []).map(h => ({
          searchWord: h.searchWord,
          score: h.score,
          content: h.content || '',
        })).slice(0, 15);
        sendJSON(res, { hots: list });
      } catch (e) {
        sendJSON(res, { hots: [], error: String(e?.message || e) });
      }
      return;
    }

    // ========== 歌曲URL ==========
    if (pn === '/api/song/url') {
      const id = url.searchParams.get('id');
      const quality = url.searchParams.get('quality') || '';
      if (!id) { sendJSON(res, { error: 'Missing id' }, 400); return; }
      const info = await getLoginInfo();
      const result = await handleSongUrl(id, quality);
      sendJSON(res, { ...result, loggedIn: info.loggedIn });
      return;
    }

    // ========== 歌词 ==========
    if (pn === '/api/lyric') {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing id', lyric: '' }, 400); return; }
      let body = {};
      try {
        if (typeof lyric_new === 'function') {
          const r = await lyric_new({ id, cookie: userCookie, timestamp: Date.now() });
          body = r.body || {};
        }
      } catch {}
      if (!(body.lrc?.lyric || body.yrc?.lyric)) {
        try {
          const r = await lyric({ id, cookie: userCookie, timestamp: Date.now() });
          body = r.body || body;
        } catch {}
      }
      sendJSON(res, {
        lyric: body.lrc?.lyric || '',
        tlyric: body.tlyric?.lyric || '',
        yrc: body.yrc?.lyric || '',
      });
      return;
    }

    // ========== 登录: 保存cookie ==========
    if (pn === '/api/login/cookie') {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeCookieHeader(raw);
      if (!normalized.includes('MUSIC_U')) {
        sendJSON(res, { loggedIn: false, error: 'INVALID_COOKIE' }, 400);
        return;
      }
      saveCookie(normalized);
      const info = await getLoginInfo();
      sendJSON(res, { ...info, saved: true });
      return;
    }

    // ========== 登录状态 ==========
    if (pn === '/api/login/status') {
      const info = await getLoginInfo();
      sendJSON(res, info);
      return;
    }

    // ========== 登出 ==========
    if (pn === '/api/logout') {
      try { await logout({ cookie: userCookie }); } catch {}
      clearCookie();
      sendJSON(res, { ok: true });
      return;
    }

    // ========== 用户歌单 ==========
    if (pn === '/api/user/playlists') {
      const info = await getLoginInfo();
      if (!info.loggedIn) { sendJSON(res, { loggedIn: false, playlists: [] }); return; }
      const limit = Math.max(12, Math.min(100, parseInt(url.searchParams.get('limit') || '50')));
      const r = await user_playlist({ uid: info.userId, limit, cookie: userCookie, timestamp: Date.now() });
      const list = (r.body?.playlist || []).map(pl => ({
        id: pl.id,
        name: pl.name,
        cover: pl.coverImgUrl || '',
        trackCount: pl.trackCount || 0,
        creator: pl.creator?.nickname || '',
      }));
      sendJSON(res, { loggedIn: true, playlists: list });
      return;
    }

    // ========== 歌单歌曲 ==========
    if (pn === '/api/playlist/tracks') {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing id', tracks: [] }, 400); return; }
      let rawTracks = [];
      let meta = { id, name: '', cover: '', trackCount: 0 };
      try {
        const all = await playlist_track_all({ id, limit: 500, offset: 0, cookie: userCookie, timestamp: Date.now() });
        rawTracks = all.body?.songs || all.body?.tracks || [];
      } catch (e) {
        console.warn('[PlaylistTracks] fallback to detail:', e.message);
        try {
          const detail = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
          const pl = detail.body?.playlist || {};
          meta = { id: pl.id || id, name: pl.name || '', cover: pl.coverImgUrl || '', trackCount: pl.trackCount || 0 };
          rawTracks = pl.tracks || [];
        } catch (e2) {
          console.error('[PlaylistTracks] detail also failed:', e2.message);
        }
      }
      const tracks = rawTracks.map(mapSongRecord).filter(t => t.id);
      if (!meta.trackCount) meta.trackCount = tracks.length;
      sendJSON(res, { playlist: meta, tracks });
      return;
    }

    // ========== 发现页 ==========
    if (pn === '/api/discover/home') {
      const data = await handleDiscoverHome();
      sendJSON(res, data);
      return;
    }

    // ========== 喜欢歌曲 ==========
    if (pn === '/api/song/like') {
      const body = await readRequestBody(req);
      const id = body.id;
      // v3.2.9: 健壮解析 like —— 处理布尔/字符串/数字各种类型
      // body.like 可能是: true/false(布尔), "true"/"false"(字符串), 1/0(数字), "1"/"0"
      const rawLike = body.like;
      const like = !(rawLike === false || rawLike === 'false' || rawLike === 0 || rawLike === '0' || rawLike === undefined);
      if (!id) { sendJSON(res, { error: 'Missing id' }, 400); return; }
      const info = await getLoginInfo();
      if (!info.loggedIn) { sendJSON(res, { error: 'LOGIN_REQUIRED' }, 401); return; }
      // 网易云 like 接口必选参数是 id（歌曲id），不是 trackId
      // 之前误用 trackId 导致网易返回 400 Bad Request
      const songId = typeof id === 'number' ? id : parseInt(String(id), 10);
      if (!Number.isFinite(songId)) {
        sendJSON(res, { ok: false, error: `Invalid id (not numeric): ${id}` });
        return;
      }
      console.log('[Like] request params:', { id: songId, like, rawLike, cookieLen: userCookie.length });
      try {
        // v3.3.1: NeteaseCloudMusicApi 的 like 函数用 query.like == 'false'（字符串比较）判断
        // 传布尔 false 会被当作 true（变成添加喜欢），所以必须传字符串 "false" 才能取消
        const r = await like_song({ id: songId, like: like ? 'true' : 'false', cookie: userCookie, timestamp: Date.now() });
        console.log('[Like] netease response:', JSON.stringify(r?.body || r));
        // 网易 API 即使 HTTP 200 也可能在 body 里返回 code != 200
        const code = r?.body?.code ?? r?.code;
        if (code !== undefined && code !== 200) {
          console.error('[Like] netease rejected:', JSON.stringify(r?.body || r));
          sendJSON(res, { ok: false, error: `netease code ${code}: ${r?.body?.msg || r?.body?.message || r?.msg || ''}`, raw: r?.body || r });
          return;
        }
        sendJSON(res, { ok: true, liked: like, raw: r?.body || r });
      } catch (e) {
        // 健壮处理：e 可能是 Error / 字符串 / 对象 / 无 message 的异常
        const errStr = (e instanceof Error) ? e.message
          : (typeof e === 'string') ? e
          : (e && typeof e === 'object') ? (e.message || e.msg || JSON.stringify(e))
          : String(e);
        console.error('[Like] error:', errStr, e?.stack || '', e);
        sendJSON(res, { ok: false, error: errStr, raw: e?.body || (typeof e === 'object' ? e : { value: e }) });
      }
      return;
    }

    // ========== 喜欢列表 ==========
    if (pn === '/api/song/like/check') {
      const info = await getLoginInfo();
      if (!info.loggedIn) { sendJSON(res, { loggedIn: false, liked: {} }); return; }
      try {
        const r = await likelist({ uid: info.userId, cookie: userCookie, timestamp: Date.now() });
        const likedIds = (r.body?.ids || []).map(String);
        const liked = {};
        likedIds.forEach(id => { liked[id] = true; });
        sendJSON(res, { loggedIn: true, liked });
      } catch (e) {
        console.error('[Likelist] error:', e.message);
        sendJSON(res, { loggedIn: true, liked: {} });
      }
      return;
    }

    // ========== 封面代理 ==========
    if (pn === '/api/cover') {
      const coverUrl = url.searchParams.get('url');
      if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end('Invalid url');
        return;
      }
      try {
        const resp = await fetch(coverUrl, { headers: { 'User-Agent': UA, 'Referer': 'https://music.163.com/' } });
        const ct = resp.headers.get('content-type') || 'image/jpeg';
        res.writeHead(resp.status, {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'public, max-age=86400',
        });
        const reader = resp.body.getReader();
        while (true) {
          const c = await reader.read();
          if (c.done) break;
          res.write(c.value);
        }
        res.end();
      } catch (e) {
        res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
        res.end('Fetch failed');
      }
      return;
    }

    // ========== 音频代理（解决CORS）==========
    if (pn === '/api/audio') {
      const audioUrl = url.searchParams.get('url');
      if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end('Invalid url');
        return;
      }
      try {
        // 转发浏览器的 Range 请求，支持进度条 seek
        const upstreamHeaders = {
          'User-Agent': UA,
          'Referer': 'https://music.163.com/',
          'Cookie': userCookie || '',
        };
        if (req.headers.range) {
          upstreamHeaders['Range'] = req.headers.range;
        }
        const resp = await fetch(audioUrl, {
          headers: upstreamHeaders,
          redirect: 'follow',
        });
        const ct = resp.headers.get('content-type') || 'audio/mpeg';
        const cl = resp.headers.get('content-length') || '';
        const cr = resp.headers.get('content-range') || '';
        const upstreamStatus = resp.status;
        const headers = {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        };
        if (cl) headers['Content-Length'] = cl;
        if (cr) headers['Content-Range'] = cr;
        res.writeHead(upstreamStatus, headers);
        const reader = resp.body.getReader();
        while (true) {
          const c = await reader.read();
          if (c.done) break;
          res.write(c.value);
        }
        res.end();
      } catch (e) {
        console.error('[Audio Proxy] error:', e.message);
        res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
        res.end('Proxy failed');
      }
      return;
    }

    // ========== 本地视频流（自定义背景视频，支持 Range 请求）==========
    if (pn === '/api/local-video') {
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end('Missing path');
        return;
      }
      try {
        fs.stat(filePath, (err, stats) => {
          if (err || !stats.isFile()) {
            res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
            res.end('File not found');
            return;
          }
          const fileSize = stats.size;
          const range = req.headers.range;
          const ext = path.extname(filePath).slice(1).toLowerCase();
          const mimeMap = { mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo' };
          const ct = mimeMap[ext] || 'application/octet-stream';
          if (range) {
            const m = range.match(/bytes=(\d*)-(\d*)/);
            const start = m && m[1] ? parseInt(m[1]) : 0;
            const end = m && m[2] ? parseInt(m[2]) : fileSize - 1;
            const chunkSize = end - start + 1;
            const stream = fs.createReadStream(filePath, { start, end });
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize,
              'Content-Type': ct,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            });
            stream.pipe(res);
          } else {
            res.writeHead(200, {
              'Content-Length': fileSize,
              'Content-Type': ct,
              'Accept-Ranges': 'bytes',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            });
            fs.createReadStream(filePath).pipe(res);
          }
        });
      } catch (e) {
        res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
        res.end('Stream failed');
      }
      return;
    }

    // ========== v3.7.0 AI 代理（通义千问 Qwen-Turbo，兼容 OpenAI 格式）==========
    // 前端通过 body.apiKey 传 API Key，server 转发到阿里云百炼
    // 每天免费 100 万 tokens（Qwen-Turbo），新用户送 7000 万 tokens（180 天）
    if (pn === '/api/ai/chat') {
      const body = await readRequestBody(req);
      const apiKey = (body.apiKey || '').trim();
      if (!apiKey) {
        sendJSON(res, { error: 'NO_API_KEY', message: '请先在设置中配置 AI API Key' }, 401);
        return;
      }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!messages.length) {
        sendJSON(res, { error: 'EMPTY_MESSAGES' }, 400);
        return;
      }
      const model = body.model || 'qwen-turbo';
      const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
      const maxTokens = body.maxTokens || 1024;
      try {
        const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
          }),
        });
        const aiData = await aiRes.json();
        if (!aiRes.ok) {
          console.warn('[AI] upstream error:', aiRes.status, JSON.stringify(aiData));
          sendJSON(res, {
            error: 'AI_REQUEST_FAILED',
            message: aiData.error?.message || aiData.message || `上游 HTTP ${aiRes.status}`,
            status: aiRes.status,
          }, 502);
          return;
        }
        const content = aiData.choices?.[0]?.message?.content || '';
        sendJSON(res, { content, usage: aiData.usage, model: aiData.model });
      } catch (e) {
        console.error('[AI] chat proxy error:', e.message);
        sendJSON(res, { error: 'AI_PROXY_ERROR', message: e.message }, 500);
      }
      return;
    }

    // ========== 健康检查 ==========
    if (pn === '/api/health') {
      sendJSON(res, { ok: true, hasCookie: !!userCookie });
      return;
    }

    // 404
    sendJSON(res, { error: 'Not Found' }, 404);
  } catch (err) {
    console.error('[Server]', pn, err);
    sendJSON(res, { error: err.message }, 500);
  }
});

// 导出启动函数
let serverInstance = null;
function startServer(callback) {
  serverInstance = server.listen(PORT, HOST, () => {
    const actualPort = serverInstance.address().port;
    console.log('[AuroraBeat] Server running on port', actualPort);
    if (callback) callback(actualPort);
  });
  return serverInstance;
}

function stopServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

// 直接运行时自动启动
if (require.main === module) {
  startServer();
}

module.exports = { startServer, stopServer };