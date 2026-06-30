// ====================================================================
// 离线节拍分析（参考 Mineradio 架构）
// 流程：fetch 完整音频 → decodeAudioData → music-tempo 分析 → beats 时间戳数组
// 在主线程执行（不用 Worker，避免 Electron file:// 协议下的 Worker blob 跨域问题）
// 每首歌首次分析需 1-3 秒，分析完缓存
// ====================================================================

export interface BeatMap {
  songId: string;
  beats: number[];      // 节拍时间点数组（秒）
  tempo: number;        // BPM
  duration: number;     // 歌曲时长（秒）
}

const beatMapCache = new Map<string, BeatMap>();
let musicTempoLoaded = false;

// 加载 music-tempo 库（UMD 格式，挂载到 window.MusicTempo）
async function ensureMusicTempo(): Promise<any> {
  if (musicTempoLoaded && (window as any).MusicTempo) return (window as any).MusicTempo;
  // 尝试多个可能的 URL（适配 dev server / 生产 / Electron file://）
  const candidates = [
    '/vendor/music-tempo.min.js',
    './vendor/music-tempo.min.js',
  ];
  // 如果有本地服务器，也尝试通过服务器加载
  const serverPort = (window as any).__serverPort;
  if (serverPort) candidates.push(`http://127.0.0.1:${serverPort}/vendor/music-tempo.min.js`);
  let loadedSource: string | null = null;
  for (const url of candidates) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const text = await resp.text();
        if (text && text.length > 100) { loadedSource = text; break; }
      }
    } catch (e) { /* 尝试下一个 */ }
  }
  if (!loadedSource) throw new Error('无法加载 music-tempo 库');
  // 用动态 script 标签执行 UMD 库（它会挂载到 window.MusicTempo）
  // 比 eval 更兼容 CSP
  const blob = new Blob([loadedSource], { type: 'application/javascript' });
  const scriptUrl = URL.createObjectURL(blob);
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.onload = () => { resolve(); };
    script.onerror = () => reject(new Error('script load error'));
    document.head.appendChild(script);
    // UMD 库同步执行，onload 时已挂载完成
    setTimeout(() => resolve(), 100);
  });
  URL.revokeObjectURL(scriptUrl);
  musicTempoLoaded = true;
  const C = (window as any).MusicTempo;
  if (!C) throw new Error('MusicTempo 加载后仍未定义');
  return C;
}

// 规范化节拍时间点（过滤过近的节拍，参考 Mineradio normalizeMusicTempoBeats）
function normalizeBeats(times: number[], duration: number): number[] {
  if (!times || !times.length) return [];
  const sorted = times
    .filter(t => isFinite(t) && t >= 0.05 && (!duration || t < duration - 0.05))
    .sort((a, b) => a - b);
  if (sorted.length < 4) return sorted;
  // 计算中位数间隔
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap >= 0.20 && gap <= 1.20) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0;
  const minGap = medianGap && medianGap < 0.42 ? Math.min(0.44, medianGap * 1.65) : 0.36;
  // 去除过近的节拍
  const out: number[] = [];
  let last = -10;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] - last >= minGap) {
      out.push(sorted[i]);
      last = sorted[i];
    }
  }
  return out;
}

// 分析音频节拍（主入口）
// audioUrl: 音频文件 URL（已通过本地代理，无 CORS 问题）
export async function analyzeBeats(audioUrl: string, songId: string, duration: number): Promise<BeatMap | null> {
  // 缓存命中
  const cached = beatMapCache.get(songId);
  if (cached) return cached;

  try {
    // 1) 加载 music-tempo 库
    const MusicTempo = await ensureMusicTempo();

    // 2) fetch 完整音频
    const resp = await fetch(audioUrl);
    if (!resp.ok) throw new Error('fetch audio failed: ' + resp.status);
    const ab = await resp.arrayBuffer();

    // 3) decodeAudioData（用临时 AudioContext，不复用播放用的）
    const DecodeCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!DecodeCtx) throw new Error('AudioContext unavailable');
    const dc = new DecodeCtx();
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      dc.decodeAudioData(ab.slice(0), resolve, reject);
    }).catch(e => { console.warn('[beatAnalyzer] decode failed:', e); return null; });
    dc.close?.();
    if (!buffer) return null;

    // 4) 多声道混合为单声道
    const channels = buffer.numberOfChannels;
    const len = buffer.length;
    const mono = new Float32Array(len);
    const chDataList: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) chDataList.push(buffer.getChannelData(ch));
    const chScale = 1 / Math.max(1, channels);
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let ci = 0; ci < channels; ci++) sum += chDataList[ci][i] * chScale;
      mono[i] = sum;
    }

    // 5) music-tempo 分析（主线程，会阻塞 1-3 秒）
    // 参数（参考 Mineradio）：
    //   bufferSize: 2048 (FFT 窗口)
    //   hopSize: ~10ms (帧移)
    //   minBeatInterval: 0.36s (最快 ~166BPM)
    //   maxBeatInterval: 0.95s (最慢 ~63BPM)
    const mt = new MusicTempo(mono, {
      bufferSize: 2048,
      hopSize: Math.max(128, Math.round(buffer.sampleRate * 0.010)),
      timeStep: 0.010,
      minBeatInterval: 0.36,
      maxBeatInterval: 0.95,
      expiryTime: 8,
    });

    // 6) 规范化节拍时间点
    const beats = normalizeBeats(mt.beats || [], duration || buffer.duration);
    const beatMap: BeatMap = {
      songId,
      beats,
      tempo: mt.tempo || 0,
      duration: duration || buffer.duration,
    };
    beatMapCache.set(songId, beatMap);
    console.log('[beatAnalyzer] 分析完成:', songId, 'BPM:', beatMap.tempo.toFixed(1), '节拍数:', beats.length);
    return beatMap;
  } catch (e) {
    console.warn('[beatAnalyzer] analyzeBeats error:', e);
    return null;
  }
}

export function getCachedBeatMap(songId: string): BeatMap | null {
  return beatMapCache.get(songId) || null;
}

export function clearBeatMapCache() {
  beatMapCache.clear();
}
