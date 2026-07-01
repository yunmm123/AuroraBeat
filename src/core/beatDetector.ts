// 实时底鼓节拍检测 —— 时域 RMS + 自适应阈值 + 去抖
// 参考：realtime-bpm-analyzer（低通 150Hz + 峰值 + 去抖）、music-tempo OnsetDetection（自适应阈值）
// 关键修复：之前用高 smoothing(0.58) 的频域 analyser 做节拍，dB 压缩 + 瞬态被抹平导致上升沿失效
// 正确做法：专用 lowpass(150Hz) → analyser(smoothing=0) → getFloatTimeDomainData 算 RMS（真线性能量）
//
// 数据流：playerCore 的 beatAnalyser 已经过 lowpass(150Hz) + smoothing=0
// 这里接收其时域样本，算 RMS，用滑动窗口 mean+k·std 自适应阈值 + 220ms 去抖

export interface KickDetectorOptions {
  /** 自适应阈值系数：threshold = mean + k * std。越大越严，默认 1.5 */
  sensitivity?: number;
  /** 历史窗口帧数（约 0.7s @60fps），默认 43 */
  historySize?: number;
  /** 最小命中间隔(ms)，防止一个底鼓多次触发。默认 220 */
  minBeatIntervalMs?: number;
  /** 触发后阈值抬升倍数（debounce），默认 1.3 */
  cutoffBoost?: number;
  /** 触发后阈值按此系数衰减回自适应值，默认 0.92 */
  cutoffDecay?: number;
  /** 噪声门：RMS 低于此值直接忽略，默认 0.01 */
  noiseFloor?: number;
}

export interface BeatEvent {
  energy: number;     // 命中时的 RMS（0~1 线性能量）
  strength: number;   // 相对阈值超出倍数
}

/**
 * 实时节拍检测器。
 * 每帧调用 update(timeDomainData)，传入 beatAnalyser.getFloatTimeDomainData 的结果。
 * 内部维护滑动窗口算自适应阈值，命中时回调 onBeat。
 */
export class RealtimeKickDetector {
  private history: number[] = [];
  private prevRms = 0;
  private cutoff = 0;
  private lastBeatTime = 0;
  private readonly opts: Required<KickDetectorOptions>;
  public onBeat: (e: BeatEvent) => void = () => {};

  constructor(options: KickDetectorOptions = {}) {
    const o = { ...options } as Required<KickDetectorOptions>;
    o.sensitivity       ??= 1.5;
    o.historySize       ??= 43;
    o.minBeatIntervalMs ??= 220;
    o.cutoffBoost       ??= 1.3;
    o.cutoffDecay       ??= 0.92;
    o.noiseFloor        ??= 0.01;
    this.opts = o;
  }

  /**
   * 每帧调用一次。传入 beatAnalyser.getFloatTimeDomainData(buf) 的 buf。
   * 返回是否命中节拍。
   */
  update(timeBuf: Float32Array): boolean {
    // 瞬时 bass 能量 = RMS（线性能量，绕开 dB 压缩与 smoothing）
    let sumSq = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const s = timeBuf[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / timeBuf.length);

    // 噪声门：静音段不触发
    if (rms < this.opts.noiseFloor) {
      this.prevRms = rms;
      return false;
    }

    // 维护滑动窗口，算自适应阈值 mean + k*std
    this.history.push(rms);
    if (this.history.length > this.opts.historySize) this.history.shift();

    let mean = 0;
    for (const v of this.history) mean += v;
    mean /= this.history.length;

    let variance = 0;
    for (const v of this.history) variance += (v - mean) * (v - mean);
    const std = Math.sqrt(variance / this.history.length);

    const threshold = Math.max(mean + this.opts.sensitivity * std, this.cutoff);

    // 命中判定：RMS 超过自适应阈值 + 上升沿 + 去抖
    const now = performance.now();
    const isRising = rms > this.prevRms;
    const notTooSoon = now - this.lastBeatTime > this.opts.minBeatIntervalMs;

    let isBeat = false;
    if (rms > threshold && isRising && notTooSoon) {
      this.lastBeatTime = now;
      this.cutoff = rms * this.opts.cutoffBoost; // 抬升门槛防连击
      isBeat = true;
      this.onBeat({ energy: rms, strength: rms / Math.max(threshold, 1e-6) });
    } else {
      // 门槛缓慢衰减回 0，让后续节拍有机会触发
      this.cutoff *= this.opts.cutoffDecay;
    }

    this.prevRms = rms;
    return isBeat;
  }

  reset() {
    this.history = [];
    this.prevRms = 0;
    this.cutoff = 0;
    this.lastBeatTime = 0;
  }
}

export interface AudioBands {
  bass: number; mid: number; treble: number; level: number;
}

/**
 * 分频段能量采样（用频域数据，给可视化频谱柱用）。
 * 注意：这是 dB 压缩后的 0~255，仅用于可视化，不用于节拍检测。
 */
export function sampleFrequencyBands(
  freqData: Uint8Array, sampleRate: number, fftSize: number
): AudioBands {
  const bins = freqData.length;
  const nyquist = sampleRate / 2;
  const hzPerBin = nyquist / bins;
  const idx = (hz: number) => Math.min(bins - 1, Math.floor(hz / hzPerBin));
  const bEnd = idx(150), mEnd = idx(2000), tEnd = idx(12000);
  let bass = 0, mid = 0, treble = 0;
  for (let i = 0; i < bEnd; i++) bass += freqData[i];
  for (let i = bEnd; i < mEnd; i++) mid += freqData[i];
  for (let i = mEnd; i < tEnd; i++) treble += freqData[i];
  return {
    bass: bass / (bEnd * 255),
    mid: mid / Math.max(1, (mEnd - bEnd) * 255),
    treble: treble / Math.max(1, (tEnd - mEnd) * 255),
    level: (bass + mid + treble) / Math.max(1, tEnd * 255),
  };
}

/** 一阶低通平滑：避免抖动但保留冲击感 */
export function smoothLerp(prev: number, target: number, factor: number): number {
  return prev + (target - prev) * factor;
}
