// ====================================================================
// 实时节拍检测（参考 p5.PeakDetect 动态cutoff算法）
// 原理：低频能量 + 动态阈值（命中后抬高再衰减）+ 上升沿 + 冷却
// 比统计法更可靠：cutoff 会自动适应音量，安静段不误触发
// ====================================================================

export interface BeatDetectorOptions {
  threshold?: number;      // 基础灵敏度门限（归一化能量 0~1），低于此值不触发
  decayRate?: number;      // 动态 cutoff 衰减率（每帧），越小衰减越快
  cutoffMult?: number;     // 命中后 cutoff 抬高倍数 = energy * cutoffMult
  framesPerPeak?: number;  // 命中后冷却帧数，期间不再触发
}

export class RealtimeBeatDetector {
  private cutoff = 0;              // 动态阈值，命中后抬高再衰减
  private prevEnergy = 0;          // 上一帧能量（上升沿检测）
  private framesSincePeak = 0;     // 距上次命中的帧数
  private threshold: number;
  private decayRate: number;
  private cutoffMult: number;
  private framesPerPeak: number;

  onBeat?: (energy: number) => void;

  constructor(opts: BeatDetectorOptions = {}) {
    // 默认值来自 p5.PeakDetect 实测，对流行/电子乐底鼓敏感
    this.threshold = opts.threshold ?? 0.35;
    this.decayRate = opts.decayRate ?? 0.95;
    this.cutoffMult = opts.cutoffMult ?? 1.5;
    this.framesPerPeak = opts.framesPerPeak ?? 18; // ~0.3s @60fps，避免过密
  }

  /**
   * 在 RAF 循环中调用
   * @param energy 归一化低频能量 0~1（建议 20-150Hz kick 区）
   * @returns 是否检测到节拍
   */
  update(energy: number): boolean {
    let isBeat = false;
    // 三个条件：高于基础门限 + 高于动态cutoff + 高于上一帧（上升沿）
    if (energy > this.threshold && energy > this.cutoff && energy > this.prevEnergy) {
      this.cutoff = energy * this.cutoffMult; // 抬高阈值，防连击
      this.framesSincePeak = 0;
      isBeat = true;
      this.onBeat?.(energy);
    } else {
      // 冷却期内不衰减，过后才开始衰减（让连续鼓点不会误触）
      if (this.framesSincePeak <= this.framesPerPeak) {
        this.framesSincePeak++;
      } else {
        this.cutoff *= this.decayRate;
        this.cutoff = Math.max(this.cutoff, this.threshold);
      }
    }
    this.prevEnergy = energy;
    return isBeat;
  }

  /** 重置状态（切歌时调用） */
  reset() {
    this.cutoff = 0;
    this.prevEnergy = 0;
    this.framesSincePeak = this.framesPerPeak + 1;
  }
}

// ====================================================================
// 分频段能量采样（bass/mid/treble）—— 喂给 shader uniform
// 参考 audioreactivevisuals.com 的频段划分
// ====================================================================
export interface AudioBands {
  bass: number;    // 20-150Hz（底鼓/贝斯）
  mid: number;     // 150-2000Hz（人声/主旋律）
  treble: number;  // 2000-12000Hz（高音/镲片）
  level: number;   // 整体能量
}

export function sampleFrequencyBands(
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
): AudioBands {
  const bins = freqData.length;
  const nyquist = sampleRate / 2;
  const hzPerBin = nyquist / bins;
  const idx = (hz: number) => Math.min(bins - 1, Math.floor(hz / hzPerBin));

  const bEnd = idx(150);
  const mEnd = idx(2000);
  const tEnd = idx(12000);

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

// 一阶低通平滑（避免抖动，保留冲击感）
export function smoothLerp(prev: number, target: number, factor: number): number {
  return prev + (target - prev) * factor;
}
