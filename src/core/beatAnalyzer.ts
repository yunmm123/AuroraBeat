// ====================================================================
// 离线节拍分析 v2.3 — Spectral Flux 多频段融合 + 自适应峰值 +
//   间隔直方图(70-180 优先) + Ellis DP beat tracking + Hampel 后处理
//
// 流程：fetch → decodeAudioData → mono 混合
//       → (a) OfflineAudioContext lowpass(150Hz) 取 bass RMS 包络（bass 段验证）
//       → (b) 原始 mono PCM 上 STFT(frame=1024, hop=512, Hann)
//             → 三频段 Spectral Flux 融合 ODF
//               bass 30-150Hz(0.55) + low-mid 150-500Hz(0.25) + high-mid 2-5kHz(0.20)
//       → 减均值(1s 跑动基线) + 轻低通平滑 + 归一化
//       → 自适应阈值 mean+1.5σ(0.5s 窗) 峰值检测
//       → 间隔直方图(5BPM 桶, 优先 70-180, 落区间外再八度折叠) → τ_p
//       → Ellis 2007 简化 DP beat tracking → 全局最优 beats[]
//       → Hampel 中位数 ± k*MAD 离群修正
//       → 全曲覆盖（首尾按 τ_p 回填/推算）
//
// 为什么 Spectral Flux 比 RMS 准：
//   RMS 区分不了"持续音变响"和"新音符起拍"；Spectral Flux 只累加正差分，
//   专捕频谱新增成分（onset），底鼓瞬态不再被持续贝斯淹没。
// 多频段：低通 150Hz 把底鼓+贝斯+人声低频一锅端，底鼓被淹没；STFT 在原始
//   buffer 上做，bass 段独立取 30-150Hz bins，high-mid 段校正 onset 位置。
//
// 接口不变：analyzeTrackBeats(audioUrl): Promise<BeatAnalysisResult>
// 失败时返回空 beats + bpm=0，playerCore 自动回退 realtime(beatDetector.ts)。
// 每首歌首次分析约 400-900ms，分析完缓存。仅分析前 90s（足够定 BPM）。
// ====================================================================

export interface BeatAnalysisResult {
  bpm: number;
  beats: number[];   // 每拍时间戳（秒），覆盖全曲
  energy: number[];  // 每拍能量（0~1，超出分析段的为 0）
}

// 单首歌缓存（按 url），切歌时复用避免重复解码
const beatCache = new Map<string, BeatAnalysisResult>();

const MIN_GAP = 0.2;            // 节拍间隔合理下限（秒）→ BPM ≤ 300
const MAX_GAP = 2.0;            // 节拍间隔合理上限（秒）→ BPM ≥ 30
const ANALYSIS_SECONDS = 90;    // 只分析前 90s，长歌不卡
const FFT_SIZE = 1024;          // STFT 帧长（~23ms @44.1k）
const HOP_SIZE = 512;           // STFT 帧移（50% overlap）
const MIN_BEAT_GAP = 0.22;      // 峰值去重最小间隔（秒）
// 三频段（Hz）
const BASS_LO = 30, BASS_HI = 150;
const LOWMID_LO = 150, LOWMID_HI = 500;
const HIGHMID_LO = 2000, HIGHMID_HI = 5000;
// 融合权重（bass 主驱动，high-mid 校正 onset 位置）
const W_BASS = 0.55, W_LOWMID = 0.25, W_HIGHMID = 0.20;
const PEAK_K = 1.5;             // 自适应阈值 k（mean + k*std）
const PEAK_WIN = 0.5;           // 自适应阈值滑窗（秒）
const TEMPO_LO = 70, TEMPO_HI = 180; // 八度优先区间
const HAMPEL_K = 3.0;           // Hampel 离群阈值（中位数 ± k*MAD）
const DP_ALPHA = 0.8;           // DP 转移代价权重（onset 与等间隔的平衡）

// ---------- 工具：迭代 radix-2 FFT（in-place, n 必须 2 的幂） ----------
function fft(re: Float32Array, im: Float32Array, n: number) {
  // 位反转重排
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  // 蝶形运算
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1, curI = 0;
      for (let k = 0; k < half; k++) {
        const aR = re[i + k], aI = im[i + k];
        const bR = re[i + k + half], bI = im[i + k + half];
        const tR = curR * bR - curI * bI;
        const tI = curR * bI + curI * bR;
        re[i + k] = aR + tR; im[i + k] = aI + tI;
        re[i + k + half] = aR - tR; im[i + k + half] = aI - tI;
        const nR = curR * wr - curI * wi;
        const nI = curR * wi + curI * wr;
        curR = nR; curI = nI;
      }
    }
  }
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 离线节拍分析主入口。
 * @param audioUrl 已通过本地代理的音频 URL（/api/audio，带 ACAO:*）
 */
export async function analyzeTrackBeats(audioUrl: string): Promise<BeatAnalysisResult> {
  const cached = beatCache.get(audioUrl);
  if (cached) return cached;

  // 1. fetch → arrayBuffer
  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(`fetch audio failed: ${resp.status}`);
  const arrayBuffer = await resp.arrayBuffer();

  // 2. decodeAudioData（用临时 AudioContext，不复用播放用的，避免干扰）
  const Ctx: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) throw new Error('AudioContext unavailable');
  const decodeCtx = new Ctx();
  let buffer: AudioBuffer;
  try {
    buffer = await decodeCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    // 个别浏览器会 detach ArrayBuffer，复制一份重试
    const copy = await (await fetch(audioUrl)).arrayBuffer();
    buffer = await decodeCtx.decodeAudioData(copy);
  }
  const sampleRate = buffer.sampleRate;
  const fullDuration = buffer.duration || (buffer.length / sampleRate);
  decodeCtx.close();

  // 3. 多声道混合为单声道（STFT 在原始 mono 上做，才能拿到 high-mid 频段）
  const chCount = Math.max(1, buffer.numberOfChannels);
  const monoLen = buffer.length;
  const analysisLen = Math.min(monoLen, Math.floor(ANALYSIS_SECONDS * sampleRate));
  const monoData = new Float32Array(analysisLen);
  for (let ch = 0; ch < chCount; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < analysisLen; i++) monoData[i] += d[i] / chCount;
  }

  // 4. (a) 低通 150Hz 路径：取 bass RMS 包络，用于 bass 段 onset 验证
  //        （低通隔离底鼓/贝斯；RMS 包络反映 bass 能量强度，gate 掉无 bass 的假 onset）
  const offline = new OfflineAudioContext(1, analysisLen, sampleRate);
  const lpBuffer = offline.createBuffer(1, analysisLen, sampleRate);
  lpBuffer.getChannelData(0).set(monoData);
  const src = offline.createBufferSource();
  src.buffer = lpBuffer;
  const lowpass = offline.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 150;
  lowpass.Q.value = 1;
  src.connect(lowpass);
  lowpass.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  const lpPcm = rendered.getChannelData(0);

  const hopTime = HOP_SIZE / sampleRate; // 秒/帧
  const T = Math.max(0, Math.floor((analysisLen - FFT_SIZE) / HOP_SIZE) + 1);

  // bass RMS 包络（每 hop 一个 RMS，与 STFT 帧对齐），归一化
  const bassRms = new Float32Array(T);
  let maxRms = 0;
  for (let f = 0; f < T; f++) {
    const off = f * HOP_SIZE;
    let sum = 0;
    const n = Math.min(HOP_SIZE, lpPcm.length - off);
    for (let i = 0; i < n; i++) sum += lpPcm[off + i] * lpPcm[off + i];
    const r = n > 0 ? Math.sqrt(sum / n) : 0;
    bassRms[f] = r;
    if (r > maxRms) maxRms = r;
  }
  if (maxRms > 0) for (let f = 0; f < T; f++) bassRms[f] /= maxRms;

  // 5. (b) STFT 多频段 Spectral Flux
  //    频段 bin 区间（基于原始 mono，未低通）
  const binsPerHz = FFT_SIZE / sampleRate;
  const kBassLo = Math.max(1, Math.round(BASS_LO * binsPerHz));
  const kBassHi = Math.min(FFT_SIZE / 2, Math.round(BASS_HI * binsPerHz));
  const kLowMidLo = Math.max(kBassHi + 1, Math.round(LOWMID_LO * binsPerHz));
  const kLowMidHi = Math.min(FFT_SIZE / 2, Math.round(LOWMID_HI * binsPerHz));
  const kHighMidLo = Math.max(kLowMidHi + 1, Math.round(HIGHMID_LO * binsPerHz));
  const kHighMidHi = Math.min(FFT_SIZE / 2, Math.round(HIGHMID_HI * binsPerHz));

  // Hann 窗
  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const halfN = FFT_SIZE / 2;
  let yPrev: Float32Array | null = null; // 上一帧 log 压缩幅度谱（半谱）

  const odf = new Float32Array(T);
  for (let f = 0; f < T; f++) {
    const off = f * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = monoData[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im, FFT_SIZE);
    // 半谱 log 压缩幅度 Y = log(1 + |X|)
    const y = new Float32Array(halfN + 1);
    for (let k = 0; k <= halfN; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      y[k] = Math.log(1 + mag);
    }
    if (yPrev) {
      // 三频段正差分累加
      let fluxBass = 0, fluxLowMid = 0, fluxHighMid = 0;
      for (let k = kBassLo; k <= kBassHi; k++) {
        const d = y[k] - yPrev[k];
        if (d > 0) fluxBass += d;
      }
      for (let k = kLowMidLo; k <= kLowMidHi; k++) {
        const d = y[k] - yPrev[k];
        if (d > 0) fluxLowMid += d;
      }
      for (let k = kHighMidLo; k <= kHighMidHi; k++) {
        const d = y[k] - yPrev[k];
        if (d > 0) fluxHighMid += d;
      }
      // bass 段验证：无 bass 能量时削弱 bass flux（gate），抑制人声低频假 onset
      const bassGate = 0.6 + 0.4 * bassRms[f];
      fluxBass *= bassGate;
      odf[f] = W_BASS * fluxBass + W_LOWMID * fluxLowMid + W_HIGHMID * fluxHighMid;
    }
    yPrev = y;
  }

  // 6. ODF 后处理：减 1s 跑动基线（去 DC/慢漂） + 轻低通平滑 + 归一化
  if (T > 0) {
    const baseWin = Math.max(1, Math.round(1.0 / hopTime));
    const csum = new Float64Array(T + 1);
    for (let f = 0; f < T; f++) csum[f + 1] = csum[f] + odf[f];
    for (let f = 0; f < T; f++) {
      const lo = Math.max(0, f - baseWin);
      const hi = Math.min(T, f + baseWin + 1);
      const base = (csum[hi] - csum[lo]) / (hi - lo);
      odf[f] = Math.max(0, odf[f] - base);
    }
    // one-pole 低通平滑（消除毛刺）
    let smooth = 0;
    for (let f = 0; f < T; f++) {
      smooth = smooth + 0.5 * (odf[f] - smooth);
      odf[f] = smooth;
    }
    // 归一化到 max=1
    let maxO = 0;
    for (let f = 0; f < T; f++) if (odf[f] > maxO) maxO = odf[f];
    if (maxO > 0) for (let f = 0; f < T; f++) odf[f] /= maxO;
  }

  // 7. 自适应阈值峰值检测（mean + k*std，0.5s 滑窗，替代固定多阈值）
  const peaks: number[] = [];
  if (T > 2) {
    const pkWin = Math.max(1, Math.round(PEAK_WIN / hopTime));
    const minFrameGap = Math.max(1, Math.round(MIN_BEAT_GAP / hopTime));
    for (let f = 1; f < T - 1; f++) {
      const v = odf[f];
      if (v <= 0) continue;
      const lo = Math.max(0, f - pkWin);
      const hi = Math.min(T, f + pkWin + 1);
      let sum = 0, sum2 = 0, cnt = 0;
      for (let g = lo; g < hi; g++) { sum += odf[g]; sum2 += odf[g] * odf[g]; cnt++; }
      const mean = sum / cnt;
      const variance = Math.max(0, sum2 / cnt - mean * mean);
      const std = Math.sqrt(variance);
      const thr = mean + PEAK_K * std;
      if (v < thr) continue;
      if (!(v >= odf[f - 1] && v > odf[f + 1])) continue; // 局部极大
      let tooClose = false;
      for (const p of peaks) {
        if (Math.abs(p - f) < minFrameGap) { tooClose = true; break; }
      }
      if (!tooClose) peaks.push(f);
    }
  }

  // 8. 间隔直方图（5BPM 桶）→ BPM，八度校正"优先 70-180，落区间外再倍频折叠"
  const hist = new Map<number, { count: number; sum: number }>();
  for (let i = 1; i < peaks.length; i++) {
    const gap = (peaks[i] - peaks[i - 1]) * hopTime;
    if (gap < MIN_GAP || gap > MAX_GAP) continue;
    const rawBpm = 60 / gap; // 30~300
    const bucket = Math.floor(rawBpm / 5) * 5;
    const e = hist.get(bucket) || { count: 0, sum: 0 };
    e.count++; e.sum += rawBpm;
    hist.set(bucket, e);
  }
  let bpm = 0;
  let bestCount = 0;
  for (const e of hist.values()) {
    if (e.count > bestCount) { bestCount = e.count; bpm = e.sum / e.count; }
  }
  if (bpm > 0 && (bpm < TEMPO_LO || bpm > TEMPO_HI)) {
    while (bpm < TEMPO_LO) bpm *= 2;
    while (bpm > TEMPO_HI) bpm /= 2;
  }
  // fallback：直方图为空时用中位间隔估 BPM
  if (bpm <= 0 && peaks.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const g = (peaks[i] - peaks[i - 1]) * hopTime;
      if (g >= MIN_GAP && g <= MAX_GAP) gaps.push(g);
    }
    if (gaps.length) {
      let fb = 60 / median(gaps);
      while (fb < TEMPO_LO) fb *= 2;
      while (fb > TEMPO_HI) fb /= 2;
      bpm = fb;
    }
  }

  // 9. Ellis 2007 简化 DP beat tracking（替代首峰按 BPM 机械推算，避免漂移）
  //    C*(t) = O(t) + max_τ{ α*F(t-τ, τ_p) + C*(τ) }, F(Δt,τ_p) = -(log(Δt)-log(τ_p))²
  let dpBeats: number[] = [];
  if (bpm > 0 && T > 0) {
    const tauP = 60 / bpm; // 先验周期（秒）
    const logTauP = Math.log(tauP);
    const minLag = Math.max(1, Math.round((tauP * 0.5) / hopTime));
    const maxLag = Math.max(minLag + 1, Math.round((tauP * 2.0) / hopTime));
    const C = new Float64Array(T);
    const back = new Int32Array(T).fill(-1);
    for (let t = 0; t < T; t++) {
      let bestVal = 0;      // 0 = 无前驱（开新序列）
      let bestPrev = -1;
      const lagLimit = Math.min(maxLag, t);
      for (let lag = minLag; lag <= lagLimit; lag++) {
        const prev = t - lag;
        if (prev < 0) break;
        const dt = lag * hopTime;
        const trans = DP_ALPHA * -((Math.log(dt) - logTauP) ** 2);
        const val = trans + C[prev];
        if (val > bestVal) { bestVal = val; bestPrev = prev; }
      }
      C[t] = odf[t] + bestVal;
      back[t] = bestPrev;
    }
    // 末段取 argmax C 回溯（全局最优 beats）
    let tEnd = 0, cMax = -Infinity;
    const startSearch = Math.max(0, T - maxLag);
    for (let t = startSearch; t < T; t++) {
      if (C[t] > cMax) { cMax = C[t]; tEnd = t; }
    }
    const trace: number[] = [];
    let cur = tEnd;
    while (cur >= 0) {
      trace.push(cur * hopTime);
      cur = back[cur];
    }
    trace.reverse();
    dpBeats = trace;
  }

  // 10. 全曲覆盖：DP beats 前后按 τ_p 回填/推算
  let beats: number[] = [];
  if (bpm > 0 && dpBeats.length > 0) {
    const tauP = 60 / bpm;
    const pre: number[] = [];
    let p = dpBeats[0] - tauP;
    while (p >= 0) { pre.push(p); p -= tauP; }
    pre.reverse();
    const post: number[] = [];
    let q = dpBeats[dpBeats.length - 1] + tauP;
    while (q <= fullDuration) { post.push(q); q += tauP; }
    beats = [...pre, ...dpBeats, ...post]
      .filter(t => t >= 0 && t <= fullDuration + 0.001)
      .map(t => Math.round(t * 1000) / 1000);
    beats.sort((a, b) => a - b);
  }

  // 11. Hampel 后处理：相邻 beat 间隔中位数 ± k*MAD 离群修正
  if (beats.length >= 3 && bpm > 0) {
    const tauP = 60 / bpm;
    const intervals: number[] = [];
    for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
    const med = median(intervals);
    const mad = median(intervals.map(x => Math.abs(x - med)));
    if (mad > 0) {
      for (let i = 1; i < beats.length; i++) {
        const iv = beats[i] - beats[i - 1];
        if (Math.abs(iv - med) > HAMPEL_K * mad) {
          beats[i] = Math.round((beats[i - 1] + tauP) * 1000) / 1000; // 用 prevBeat + τ_p 修正
        }
      }
    }
  }

  // 12. 每拍能量（取该拍 ODF 值，归一化后；超出分析段的为 0）
  const beatEnergy: number[] = beats.map(bt => {
    const fi = Math.round(bt / hopTime);
    return fi >= 0 && fi < T ? odf[fi] : 0;
  });

  const result: BeatAnalysisResult = {
    bpm: bpm > 0 ? Math.round(bpm * 10) / 10 : 0,
    beats,
    energy: beatEnergy,
  };
  beatCache.set(audioUrl, result);
  console.log('[beatAnalyzer] 分析完成: BPM', result.bpm,
    'ODF帧', T, 'onset峰值', peaks.length, 'DP节拍', dpBeats.length,
    '全曲节拍', beats.length, '时长', fullDuration.toFixed(1) + 's');
  return result;
}

export function getCachedBeats(audioUrl: string): BeatAnalysisResult | null {
  return beatCache.get(audioUrl) || null;
}

export function clearBeatCache() {
  beatCache.clear();
}
