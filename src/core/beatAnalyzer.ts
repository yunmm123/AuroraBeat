// ====================================================================
// 离线节拍分析 v2.2 — 业界共识做法（参考 chrisguttandin/web-audio-beat-detector、
// killercrush/music-tempo、Joe Sullivan 算法、BeatDetect.js）
//
// 流程：fetch → decodeAudioData → OfflineAudioContext + lowpass(150Hz)
//       → 多阈值峰值检测 → 间隔直方图取 BPM → 节拍时间戳数组
//
// 为什么不用 AnalyserNode 实时检测：
//   1) AnalyserNode 跨端口 MediaElementSource 易被 CORS tainted 静默输出 0
//   2) AnalyserNode 不适合节拍检测（6 个开源项目 0 个用它），离线预分析更稳
//   3) 21ms 抽样窗口 + isRising 判定漏检严重
//
// 本模块对 ArrayBuffer 做 decodeAudioData（不依赖 MediaElementSource），完全绕开 CORS tainted。
// 每首歌首次分析约 300-800ms，分析完缓存，播放时 playerCore 查表跟随。
// 仅分析前 90 秒（足够定 BPM），beats 数组用 BPM 推算覆盖全曲。
// ====================================================================

export interface BeatAnalysisResult {
  bpm: number;
  beats: number[];   // 每拍时间戳（秒），覆盖全曲
  energy: number[];  // 每拍能量（可选，0~1，超出分析段的为 0）
}

// 单首歌缓存（按 url），切歌时复用避免重复解码
const beatCache = new Map<string, BeatAnalysisResult>();

// 节拍间隔合理区间（秒）→ BPM 30~300，后续按八度归一到 70~180
const MIN_GAP = 0.2;
const MAX_GAP = 2.0;
const ANALYSIS_SECONDS = 90; // 只分析前 90s，长歌不卡
const FRAME_SIZE = 1024;     // 能量窗口样本数（~23ms @44.1k）
const MIN_BEAT_GAP = 0.25;   // 同拍去重最小间隔（秒）

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

  // 3. 多声道混合为单声道 Buffer（喂给 OfflineAudioContext 的 source）
  const chCount = Math.max(1, buffer.numberOfChannels);
  const monoLen = buffer.length;
  const analysisLen = Math.min(monoLen, Math.floor(ANALYSIS_SECONDS * sampleRate));
  const offline = new OfflineAudioContext(1, analysisLen, sampleRate);
  const monoBuffer = offline.createBuffer(1, monoLen, sampleRate);
  const monoData = monoBuffer.getChannelData(0);
  for (let ch = 0; ch < chCount; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < monoLen; i++) monoData[i] += d[i] / chCount;
  }

  // 4. createBufferSource → BiquadFilter(lowpass 150Hz Q=1) → destination → startRendering
  const src = offline.createBufferSource();
  src.buffer = monoBuffer;
  const lowpass = offline.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 150;
  lowpass.Q.value = 1;
  src.connect(lowpass);
  lowpass.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();

  // 5. 取低通后 PCM，算能量包络（每 FRAME_SIZE 样本一个 RMS）
  const pcm = rendered.getChannelData(0);
  const numFrames = Math.floor(pcm.length / FRAME_SIZE);
  const energy = new Float32Array(numFrames);
  let maxE = 0;
  for (let f = 0; f < numFrames; f++) {
    const off = f * FRAME_SIZE;
    let sum = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const s = pcm[off + i];
      sum += s * s;
    }
    const e = Math.sqrt(sum / FRAME_SIZE);
    energy[f] = e;
    if (e > maxE) maxE = e;
  }
  if (maxE > 0) {
    for (let f = 0; f < numFrames; f++) energy[f] /= maxE;
  }
  const frameDuration = FRAME_SIZE / sampleRate; // 秒/帧

  // 6. 多阈值峰值检测（0.9→0.3 递降，每阈值找局部极大，跳过 MIN_BEAT_GAP 防同拍）
  const peaks: number[] = []; // 帧索引
  const minFrameGap = MIN_BEAT_GAP / frameDuration;
  const thresholds = [0.9, 0.7, 0.55, 0.42, 0.3];
  for (const thr of thresholds) {
    for (let f = 1; f < numFrames - 1; f++) {
      const e = energy[f];
      if (e < thr) continue;
      if (!(e >= energy[f - 1] && e > energy[f + 1])) continue; // 局部极大
      // 跳过已检测 peak 附近（防同拍）
      let tooClose = false;
      for (const p of peaks) {
        if (Math.abs(p - f) < minFrameGap) { tooClose = true; break; }
      }
      if (!tooClose) peaks.push(f);
    }
  }
  peaks.sort((a, b) => a - b);

  // 7. 间隔直方图（5 BPM 桶），取 count 最多桶的均值作为 BPM
  const hist = new Map<number, { count: number; sum: number }>();
  for (let i = 1; i < peaks.length; i++) {
    const gap = (peaks[i] - peaks[i - 1]) * frameDuration;
    if (gap < MIN_GAP || gap > MAX_GAP) continue;
    let bpm = 60 / gap;
    // 八度归一到 70~180（半时翻倍，倍时减半）
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    const bucket = Math.floor(bpm / 5) * 5;
    const e = hist.get(bucket) || { count: 0, sum: 0 };
    e.count++; e.sum += bpm;
    hist.set(bucket, e);
  }
  let bpm = 0;
  let bestCount = 0;
  for (const e of hist.values()) {
    if (e.count > bestCount) { bestCount = e.count; bpm = e.sum / e.count; }
  }

  // 8. 生成理论节拍序列：从首个 peak 起按 60/BPM 间隔，向前回填 + 向后推算覆盖全曲
  const beats: number[] = [];
  if (bpm > 0 && bestCount > 0) {
    const beatInterval = 60 / bpm;
    const firstPeakTime = peaks.length ? peaks[0] * frameDuration : 0;
    let t = firstPeakTime;
    while (t - beatInterval >= 0) t -= beatInterval; // 向前回填到曲首
    while (t <= fullDuration) {
      if (t >= 0) beats.push(Math.round(t * 1000) / 1000);
      t += beatInterval;
    }
  }

  // 9. 每拍能量（可选）：取该拍帧的能量，超出分析段的为 0
  const beatEnergy: number[] = beats.map(bt => {
    const fi = Math.floor(bt / frameDuration);
    return fi >= 0 && fi < numFrames ? energy[fi] : 0;
  });

  const result: BeatAnalysisResult = {
    bpm: bpm > 0 ? Math.round(bpm * 10) / 10 : 0,
    beats,
    energy: beatEnergy,
  };
  beatCache.set(audioUrl, result);
  console.log('[beatAnalyzer] 分析完成: BPM', result.bpm, '节拍数', beats.length, '时长', fullDuration.toFixed(1) + 's');
  return result;
}

export function getCachedBeats(audioUrl: string): BeatAnalysisResult | null {
  return beatCache.get(audioUrl) || null;
}

export function clearBeatCache() {
  beatCache.clear();
}
