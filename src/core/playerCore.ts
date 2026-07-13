import type { Song, LyricsLine, YrcWord } from '../types';
import { analyzeTrackBeats } from './beatAnalyzer';
import { RealtimeKickDetector } from './beatDetector';

export type PlayMode = 'list' | 'single' | 'shuffle';
export type AudioQuality = 'standard' | 'exhigh' | 'lossless' | 'hires';

// v3.5.0 A1: 设置持久化 — 重启后恢复音量/音质/播放模式/喜欢歌单/历史/歌词偏移
// v3.6.0 A2/B1: 增加搜索历史 + 快捷键配置持久化
// v3.7.0 AI: 增加 aiApiKey 持久化（通义千问 Qwen-Turbo）
// v3.7.1 AI: 改为通用 OpenAI 兼容协议，新增 aiBaseUrl + aiModel，可自由切换模型
const STORAGE_KEY = 'aurorabeat:settings:v1';
const HISTORY_MAX = 50;
const LYRIC_OFFSET_MAX = 5; // ±5s 上限，超出视为异常
const SEARCH_HISTORY_MAX = 10;

// v3.6.0 B1: 默认快捷键映射（用户可在设置面板自定义）
export const DEFAULT_SHORTCUTS: Record<string, string> = {
  'play/pause': 'Space',
  'next': 'MediaTrackNext',
  'prev': 'MediaTrackPrevious',
  'volume-up': 'ArrowUp',
  'volume-down': 'ArrowDown',
  'mute': 'KeyM',
  'like': 'KeyL',
  'toggle-lyrics': 'KeyK',
  'toggle-queue': 'KeyQ',
};

// v3.7.1 AI: 默认配置（通义千问 Qwen-Turbo，每天免费 100 万 tokens）
// v3.8.0 AI: 默认模型升级为 qwen3.5-omni-plus-2026-03-15（全模态，支持文本/图像/音频/视频输入）
// 用户可在设置中切换为任意 OpenAI 兼容服务（DeepSeek / OpenAI / Moonshot / 智谱 GLM 等）
export const DEFAULT_AI_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_AI_MODEL = 'qwen3.5-omni-plus-2026-03-15';

interface PersistedSettings {
  volume: number;
  quality: AudioQuality;
  playMode: PlayMode;
  likedSongs: string[];
  history: Song[];
  lyricOffsets: Record<string, number>;
  searchHistory: string[];        // v3.6.0 A2: 搜索词历史
  shortcuts: Record<string, string>; // v3.6.0 B1: 自定义快捷键
  aiApiKey: string;              // v3.7.0 AI: API Key
  aiBaseUrl: string;             // v3.7.1 AI: OpenAI 兼容服务 Base URL
  aiModel: string;               // v3.7.1 AI: 模型名
  playStats: Record<string, number>; // 听歌统计：key=songId, value=播放秒数累积
}

function loadSettings(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function saveSettings(s: PersistedSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

export interface PlayerState {
  queue: Song[];
  currentIndex: number;
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playMode: PlayMode;
  lyrics: LyricsLine[];
  lyricsLoading: boolean;
  showLyrics: boolean;
  likedSongs: Set<string>;
  quality: AudioQuality;
  bpm: number;            // 离线分析得出的 BPM（0 = 未分析）
  beatAnalyzing: boolean; // 离线节拍分析进行中
  isSeeking: boolean;     // v3.1.5: seek 进行中（拖拽进度条时）
  history: Song[];        // v3.5.0 A4: 最近播放历史
  searchHistory: string[];   // v3.6.0 A2: 搜索词历史
  shortcuts: Record<string, string>; // v3.6.0 B1: 自定义快捷键
  aiApiKey: string;          // v3.7.0 AI: API Key
  aiBaseUrl: string;         // v3.7.1 AI: OpenAI 兼容服务 Base URL
  aiModel: string;           // v3.7.1 AI: 模型名
  playStats: Record<string, number>; // 听歌统计：key=songId, value=播放秒数累积
}

type Listener = (state: PlayerState) => void;

class PlayerCore {
  private audio: HTMLAudioElement | null = null;
  private trackSwitchToken = 0;
  private serverPort = 0;
  // v3.5.0 A1: 持久化设置（启动时加载，notify 时自动保存）
  private persisted: PersistedSettings = {
    volume: 0.8,
    quality: 'exhigh',
    playMode: 'list',
    likedSongs: [],
    history: [],
    lyricOffsets: {},
    searchHistory: [],
    shortcuts: { ...DEFAULT_SHORTCUTS },
    aiApiKey: '',
    aiBaseUrl: DEFAULT_AI_BASE_URL,
    aiModel: DEFAULT_AI_MODEL,
    playStats: {},
  };
  private lyricOffset = 0; // v3.5.0 B3: 当前歌曲的歌词偏移（秒）
  private state: PlayerState = {
    queue: [],
    currentIndex: -1,
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    playMode: 'list',
    lyrics: [],
    lyricsLoading: false,
    showLyrics: true,
    likedSongs: new Set(),
    quality: 'exhigh' as AudioQuality,
    bpm: 0,
    beatAnalyzing: false,
    isSeeking: false,
    history: [],
    searchHistory: [],
    shortcuts: { ...DEFAULT_SHORTCUTS },
    aiApiKey: '',
    aiBaseUrl: DEFAULT_AI_BASE_URL,
    aiModel: DEFAULT_AI_MODEL,
    playStats: {},
  };
  private listeners: Set<Listener> = new Set();
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private beatAnalyser: AnalyserNode | null = null;
  private beatLowpass: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  // v3.8.6: EQ 均衡器（5 段 peaking filter，默认 gain=0 即不影响声音）
  private eqFilters: BiquadFilterNode[] = [];
  // v3.8.6: 空间音效（StereoPanner，默认 0 = 居中）
  private spatialPanner: StereoPannerNode | null = null;
  private progressRaf: number | null = null;
  private onTimeUpdate: ((time: number) => void) | null = null;
  private onAnalyserReady: ((analyser: AnalyserNode) => void) | null = null;
  // 听歌统计去抖：记录上次保存时间（毫秒），每 10 秒存一次
  private lastSaveTime = 0;
  // 当前音频 URL（用于离线节拍分析）
  private currentAudioUrl: string | null = null;
  // === v2.2 节拍系统：离线预分析为主，realtime 为 fallback ===
  private beats: number[] = [];                          // 离线分析得到的节拍时间戳数组
  private nextBeatIdx = 0;                               // 下一个待触发的节拍索引
  private beatListeners: Set<(time: number) => void> = new Set();
  public bpm: number = 0;                                // 当前 BPM
  // realtime fallback（离线分析失败时用）
  private realtimeKick: RealtimeKickDetector | null = null;
  private rtTimeBuf: Float32Array | null = null;

  constructor() {
    // v3.5.0 A1: 启动时加载持久化设置
    const loaded = loadSettings();
    if (loaded.volume != null) {
      this.persisted.volume = loaded.volume;
      this.state.volume = loaded.volume;
    }
    if (loaded.quality) {
      this.persisted.quality = loaded.quality;
      this.state.quality = loaded.quality;
    }
    if (loaded.playMode) {
      this.persisted.playMode = loaded.playMode;
      this.state.playMode = loaded.playMode;
    }
    if (loaded.likedSongs) {
      this.persisted.likedSongs = loaded.likedSongs;
      this.state.likedSongs = new Set(loaded.likedSongs);
    }
    if (loaded.history) {
      this.persisted.history = loaded.history;
      this.state.history = loaded.history;
    }
    if (loaded.lyricOffsets) {
      this.persisted.lyricOffsets = loaded.lyricOffsets;
    }
    // v3.6.0 A2: 加载搜索历史
    if (loaded.searchHistory) {
      this.persisted.searchHistory = loaded.searchHistory;
      this.state.searchHistory = loaded.searchHistory;
    }
    // v3.6.0 B1: 加载自定义快捷键（合并默认值，缺的用默认）
    if (loaded.shortcuts) {
      this.persisted.shortcuts = { ...DEFAULT_SHORTCUTS, ...loaded.shortcuts };
      this.state.shortcuts = { ...DEFAULT_SHORTCUTS, ...loaded.shortcuts };
    }
    // v3.7.0 AI: 加载通义千问 API Key
    if (typeof loaded.aiApiKey === 'string') {
      this.persisted.aiApiKey = loaded.aiApiKey;
      this.state.aiApiKey = loaded.aiApiKey;
    }
    // v3.7.1 AI: 加载 Base URL + Model（缺省用默认值，兼容 v3.7.0 老数据）
    if (typeof loaded.aiBaseUrl === 'string' && loaded.aiBaseUrl) {
      this.persisted.aiBaseUrl = loaded.aiBaseUrl;
      this.state.aiBaseUrl = loaded.aiBaseUrl;
    }
    if (typeof loaded.aiModel === 'string' && loaded.aiModel) {
      this.persisted.aiModel = loaded.aiModel;
      this.state.aiModel = loaded.aiModel;
    }
    // 加载听歌统计（key=songId, value=播放秒数累积）
    if (loaded.playStats) {
      this.persisted.playStats = loaded.playStats;
      this.state.playStats = loaded.playStats;
    }

    this.initAudio();
    // 应用持久化的音量到 audio 元素（gainNode 还没创建）
    if (this.audio) this.audio.volume = this.state.volume;
    // 获取服务器端口
    (window as any).electronAPI?.getServerPort?.().then((port: number) => {
      this.serverPort = port;
    });
  }

  setServerPort(port: number) {
    this.serverPort = port;
  }

  private get apiBase() {
    return `http://127.0.0.1:${this.serverPort}`;
  }

  private initAudio() {
    if (this.audio) return;
    this.audio = new Audio();
    // v2.2: 删除 crossOrigin='anonymous'。同源代理（/api/audio 已带 ACAO:*）不需要它，
    // 设置反而会触发跨端口 CORS 校验导致 MediaElementAudioSourceNode 静默输出 0（频谱全 0）。
    this.audio.preload = 'auto';

    this.audio.addEventListener('play', () => {
      this.state.isPlaying = true;
      this.state.isLoading = false;
      this.startProgressLoop();
      this.notify();
    });

    this.audio.addEventListener('pause', () => {
      this.state.isPlaying = false;
      this.stopProgressLoop();
      this.notify();
    });

    this.audio.addEventListener('waiting', () => {
      this.state.isLoading = true;
      this.notify();
    });

    this.audio.addEventListener('canplay', () => {
      this.state.isLoading = false;
      this.state.duration = this.audio?.duration || 0;
      this.notify();
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.state.duration = this.audio?.duration || 0;
      this.notify();
    });

    this.audio.addEventListener('ended', () => {
      this.handleEnded();
    });

    // v3.1.5: seek 完成后清除 seeking 状态，同步真实 currentTime
    this.audio.addEventListener('seeked', () => {
      if (this.audio) {
        this.state.isSeeking = false;
        this.state.currentTime = this.audio.currentTime;
        this.notify();
      }
    });

    // v3.1.5: duration 变化时（流式音频可能延迟解析）同步 state
    this.audio.addEventListener('durationchange', () => {
      if (this.audio && isFinite(this.audio.duration)) {
        this.state.duration = this.audio.duration;
        this.notify();
      }
    });

    this.audio.addEventListener('error', (e) => {
      console.error('[PlayerCore] Audio error:', e);
      this.state.isLoading = false;
      this.notify();
      this.tryNextOnError();
    });

    this.audio.volume = this.state.volume;
  }

  private ensureAudioContext() {
    if (this.audioContext || !this.audio) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new Ctx();
      this.source = this.audioContext.createMediaElementSource(this.audio);
      // 可视化频谱 analyser（保留平滑，画面流畅）
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.58;
      // 节拍检测专用链路：source → lowpass(150Hz) → beatAnalyser(smoothing=0)
      // 低通隔离底鼓/贝斯频段；smoothing=0 保留瞬态；用 getFloatTimeDomainData 算 RMS
      // 修复根因：之前用高 smoothing(0.58) analyser 做节拍，瞬态被抹平导致上升沿失效
      this.beatLowpass = this.audioContext.createBiquadFilter();
      this.beatLowpass.type = 'lowpass';
      this.beatLowpass.frequency.value = 150;
      this.beatLowpass.Q.value = 1;
      this.beatAnalyser = this.audioContext.createAnalyser();
      this.beatAnalyser.fftSize = 1024;
      this.beatAnalyser.smoothingTimeConstant = 0;
      // v2.2: realtime 节拍检测作为离线分析失败的 fallback（crossOrigin 已删，频谱不再静默）
      this.realtimeKick = new RealtimeKickDetector({
        sensitivity: 1.5, historySize: 43, minBeatIntervalMs: 220,
      });
      this.rtTimeBuf = new Float32Array(this.beatAnalyser.fftSize);
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.state.volume;
      // v3.8.6: EQ 均衡器（5 段 peaking filter，默认 gain=0 即不影响声音）
      const eqFreqs = [60, 250, 1000, 4000, 12000];
      this.eqFilters = eqFreqs.map(freq => {
        const f = this.audioContext!.createBiquadFilter();
        f.type = 'peaking';
        f.frequency.value = freq;
        f.Q.value = 1.0;
        f.gain.value = 0;  // 默认 0dB，不改变声音
        return f;
      });
      // v3.8.6: 空间音效（StereoPanner，默认 0 = 居中）
      this.spatialPanner = this.audioContext.createStereoPanner();
      this.spatialPanner.pan.value = 0;
      // 可视化支路（进 destination 出声）：
      // source → analyser → eq[0..4] → gainNode → spatialPanner → destination
      this.source.connect(this.analyser);
      let prevNode: AudioNode = this.analyser;
      this.eqFilters.forEach(f => { prevNode.connect(f); prevNode = f; });
      prevNode.connect(this.gainNode);
      this.gainNode.connect(this.spatialPanner);
      this.spatialPanner.connect(this.audioContext.destination);
      // 节拍分析支路（不进 destination，避免双重发声）：source → lowpass → beatAnalyser
      this.source.connect(this.beatLowpass);
      this.beatLowpass.connect(this.beatAnalyser);
      if (this.onAnalyserReady && this.analyser) {
        this.onAnalyserReady(this.analyser);
      }
    } catch (e) {
      console.warn('[PlayerCore] AudioContext init failed:', e);
    }
  }

  getBeatAnalyser(): AnalyserNode | null {
    return this.beatAnalyser;
  }

  // 获取当前音频 URL（用于离线节拍分析）
  getCurrentAudioUrl(): string | null {
    return this.currentAudioUrl;
  }

  // 获取当前播放时间（直接从 audio 元素读取，比 state 更精确）
  getCurrentTime(): number {
    return this.audio?.currentTime || 0;
  }

  private startProgressLoop() {
    this.stopProgressLoop();
    const tick = () => {
      if (!this.audio || this.audio.paused) return;
      this.state.currentTime = this.audio.currentTime;
      this.state.duration = this.audio.duration || this.state.duration;
      // === v2.2 节拍派发 ===
      this.dispatchBeats(this.state.currentTime);
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.state.currentTime);
      }
      this.notify();
      this.progressRaf = requestAnimationFrame(tick);
    };
    this.progressRaf = requestAnimationFrame(tick);
  }

  /**
   * 节拍派发：离线分析有结果时查表跟随；否则用 realtime fallback。
   * 只触发距 currentTime 150ms 内的节拍，避免快进时连发。
   */
  private dispatchBeats(t: number) {
    if (this.beats.length > 0) {
      // 离线预分析路径：查表
      while (this.nextBeatIdx < this.beats.length && this.beats[this.nextBeatIdx] <= t) {
        const beatTime = this.beats[this.nextBeatIdx];
        if (t - beatTime < 0.15) {
          this.beatListeners.forEach(fn => fn(beatTime));
        }
        this.nextBeatIdx++;
      }
    } else if (this.beatAnalyser && this.realtimeKick && this.rtTimeBuf) {
      // realtime fallback：离线分析失败/未完成时用 lowpass 时域 RMS 检测
      this.beatAnalyser.getFloatTimeDomainData(this.rtTimeBuf as any);
      const isBeat = this.realtimeKick.update(this.rtTimeBuf);
      if (isBeat) {
        this.beatListeners.forEach(fn => fn(t));
      }
    }
  }

  /** 异步离线节拍分析：fetch+decodeAudioData+lowpass+峰值检测。失败则保持 realtime fallback。 */
  private async startBeatAnalysis(url: string, token: number) {
    this.state.beatAnalyzing = true;
    this.notify();
    try {
      const result = await analyzeTrackBeats(url);
      if (token !== this.trackSwitchToken) return; // 切歌了，丢弃结果
      if (result.beats.length > 0 && result.bpm > 0) {
        this.beats = result.beats;
        this.bpm = result.bpm;
        this.state.bpm = result.bpm;
        // 同步 nextBeatIdx 到当前播放位置（分析可能比播放启动晚）
        const t = this.audio?.currentTime || 0;
        this.nextBeatIdx = 0;
        while (this.nextBeatIdx < this.beats.length && this.beats[this.nextBeatIdx] <= t) {
          this.nextBeatIdx++;
        }
      }
    } catch (e) {
      console.warn('[PlayerCore] 离线节拍分析失败，回退 realtime 检测:', e);
    } finally {
      if (token === this.trackSwitchToken) {
        this.state.beatAnalyzing = false;
        this.notify();
      }
    }
  }

  private stopProgressLoop() {
    if (this.progressRaf !== null) {
      cancelAnimationFrame(this.progressRaf);
      this.progressRaf = null;
    }
  }

  private handleEnded() {
    if (this.state.playMode === 'single') {
      if (this.audio) {
        this.audio.currentTime = 0;
        this.audio.play().catch(() => {});
      }
    } else {
      this.next();
    }
  }

  private tryNextOnError() {
    if (this.state.queue.length > 1) {
      setTimeout(() => this.next(), 300);
    }
  }

  private notify() {
    // v3.5.0 A1: 每次状态变化自动同步 persisted 并写入 localStorage
    this.persisted.volume = this.state.volume;
    this.persisted.quality = this.state.quality;
    this.persisted.playMode = this.state.playMode;
    this.persisted.likedSongs = Array.from(this.state.likedSongs);
    this.persisted.history = this.state.history;
    this.persisted.searchHistory = this.state.searchHistory;
    this.persisted.shortcuts = this.state.shortcuts;
    this.persisted.aiApiKey = this.state.aiApiKey;
    this.persisted.aiBaseUrl = this.state.aiBaseUrl;
    this.persisted.aiModel = this.state.aiModel;
    saveSettings(this.persisted);
    this.listeners.forEach((l) => l({ ...this.state }));
  }

  getState(): PlayerState {
    return { ...this.state };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }

  setTimeUpdateHandler(fn: (time: number) => void) {
    this.onTimeUpdate = fn;
  }

  setAnalyserReadyHandler(fn: (analyser: AnalyserNode) => void) {
    this.onAnalyserReady = fn;
    if (this.analyser) fn(this.analyser);
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  // v3.8.6: EQ 均衡器（5 段 BiquadFilter）
  getEqFilters(): BiquadFilterNode[] {
    return this.eqFilters;
  }

  // v3.8.6: 空间音效控制
  setSpatialAudio(enabled: boolean) {
    if (!this.spatialPanner || !this.audioContext) return;
    // 开启时应用轻微的左右声道摆动（模拟空间感）
    // 简单实现：开启时 pan 在 -0.3 到 0.3 之间缓慢摆动；关闭时 pan=0
    if (enabled) {
      // 用 LFO 模拟空间感：通过 setValueCurveAtTime 或简单的定时器摆动
      // 最简实现：开启时设为 0.25（偏右一点模拟现场感），实际空间感由后续 LFO 增强
      this.spatialPanner.pan.setTargetAtTime(0.25, this.audioContext.currentTime, 0.1);
    } else {
      this.spatialPanner.pan.setTargetAtTime(0, this.audioContext.currentTime, 0.1);
    }
  }

  /** 订阅节拍事件，返回取消订阅函数。节拍来源：离线预分析为主，realtime 为 fallback */
  onBeat(fn: (time: number) => void): () => void {
    this.beatListeners.add(fn);
    return () => this.beatListeners.delete(fn);
  }

  /** 当前 BPM（离线分析结果，0 = 未分析） */
  getBpm(): number {
    return this.bpm;
  }

  async resolveSongUrl(song: Song): Promise<string | null> {
    // Blob URL / data URL 直接返回
    if (song.url && (song.url.startsWith('blob:') || song.url.startsWith('data:'))) return song.url;
    // 本地文件通过 Electron 读取为 data URL
    if (song.url && song.url.startsWith('file://')) {
      try {
        const dataUrl = await (window as any).electronAPI?.readLocalFile?.(song.url);
        return dataUrl || null;
      } catch (e) {
        console.error('[PlayerCore] read local file error:', e);
        return null;
      }
    }
    // 网易云歌曲通过本地服务器获取URL，再走音频代理（解决CORS）
    if (song.source === 'netease' && this.serverPort) {
      try {
        const res = await fetch(`${this.apiBase}/api/song/url?id=${song.id}&quality=${this.state.quality}`);
        const data = await res.json();
        if (data.url) {
          // 通过本地服务器代理音频流（Mineradio同款 /api/audio?url=...）
          return `${this.apiBase}/api/audio?url=${encodeURIComponent(data.url)}`;
        }
        console.warn('[PlayerCore] No URL for song', song.id, data);
      } catch (e) {
        console.error('[PlayerCore] resolveSongUrl error:', e);
      }
    }
    return null;
  }

  async fetchLyrics(song: Song): Promise<LyricsLine[]> {
    try {
      let lrc = '';
      let yrc = '';
      let tlyric = ''; // v3.5.0 A3: 翻译歌词
      if (song.source === 'netease' && this.serverPort) {
        const res = await fetch(`${this.apiBase}/api/lyric?id=${song.id}`);
        const data = await res.json();
        lrc = data.lyric || '';
        yrc = data.yrc || '';
        tlyric = data.tlyric || '';
      } else if (song.source === 'local') {
        const result = await (window as any).electronAPI?.searchLyrics?.(song.title || song.name || '', song.artist);
        lrc = result?.lyric || '';
      }
      // v3.3.8: 优先用 yrc（逐字时间戳），无 yrc 时降级到 lrc（行级时间戳）
      const yrcLines = yrc ? this.parseYrc(yrc) : [];
      if (yrcLines.length > 0) {
        // v3.5.0 A3: yrc 行也尝试附上翻译（按时间戳匹配）
        if (tlyric) this.mergeTranslations(yrcLines, tlyric);
        return yrcLines;
      }
      const lrcLines = this.parseLyrics(lrc);
      // v3.5.0 A3: lrc 行附上翻译
      if (tlyric) this.mergeTranslations(lrcLines, tlyric);
      return lrcLines;
    } catch (e) {
      console.error('[PlayerCore] fetchLyrics error:', e);
      return [];
    }
  }

  /**
   * v3.5.0 A3: 把翻译歌词按时间戳合并到主歌词行
   * 翻译行时间戳与主行时间戳一致时附到 translation 字段
   */
  private mergeTranslations(lines: LyricsLine[], tlyric: string): void {
    if (!tlyric || lines.length === 0) return;
    const tMap = new Map<number, string>();
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
    for (const line of tlyric.split('\n')) {
      const text = line.replace(timeRegex, '').trim();
      if (!text) continue;
      let match;
      timeRegex.lastIndex = 0;
      while ((match = timeRegex.exec(line)) !== null) {
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
        const t = parseInt(match[1]) * 60 + parseInt(match[2]) + ms / 1000;
        tMap.set(t, text);
      }
    }
    // 模糊匹配：找最接近的时间戳（容差 0.5s）
    for (const line of lines) {
      if (tMap.has(line.time)) {
        line.translation = tMap.get(line.time);
        continue;
      }
      let best: { dt: number; text: string } | null = null;
      for (const [t, text] of tMap) {
        const dt = Math.abs(t - line.time);
        if (dt < 0.5 && (!best || dt < best.dt)) best = { dt, text };
      }
      if (best) line.translation = best.text;
    }
  }

  /**
   * v3.3.8: 解析网易云 yrc 逐字歌词
   * 格式示例:
   *   [offset:0]
   *   [320,5000](320,500,0)我(820,500,0)爱(1320,500,0)你
   *   [行起始ms,行持续ms](字起始ms,字持续ms,0)字...
   * 每行第一个 [a,b] 是整行时间区间，后面每个 (startMs,durMs,0)字 是一个字的时间
   * 时间戳由网易云官方保证，与音频完全同步
   */
  private parseYrc(yrcString: string): LyricsLine[] {
    if (!yrcString) return [];
    const lines = yrcString.split('\n');
    const result: LyricsLine[] = [];
    // 字正则：(startMs, durMs, 任意)字
    const wordRegex = /\((\d+),(\d+),\d+\)([^\(\)\[\]]*)/g;

    for (const line of lines) {
      // 行时间戳正则：[startMs, durMs]
      const lineMatch = line.match(/^\[(\d+),(\d+)\]/);
      if (!lineMatch) continue;
      const lineStartMs = parseInt(lineMatch[1]);
      const lineStart = lineStartMs / 1000;

      // 提取所有字
      const words: YrcWord[] = [];
      let wordMatch;
      wordRegex.lastIndex = 0;
      let text = '';
      while ((wordMatch = wordRegex.exec(line)) !== null) {
        const startMs = parseInt(wordMatch[1]);
        const durMs = parseInt(wordMatch[2]);
        const wordText = wordMatch[3] || '';
        if (wordText) {
          words.push({
            text: wordText,
            startMs,
            durationMs: durMs,
          });
          text += wordText;
        }
      }

      if (text) {
        result.push({ time: lineStart, text, words });
      }
    }
    return result.sort((a, b) => a.time - b.time);
  }

  private parseLyrics(lrcString: string): LyricsLine[] {
    if (!lrcString) return [];
    const lines = lrcString.split('\n');
    const result: LyricsLine[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

    for (const line of lines) {
      const text = line.replace(timeRegex, '').trim();
      if (!text) continue;
      let match;
      timeRegex.lastIndex = 0;
      while ((match = timeRegex.exec(line)) !== null) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
        const time = minutes * 60 + seconds + ms / 1000;
        result.push({ time, text });
      }
    }
    return result.sort((a, b) => a.time - b.time);
  }

  async playTrackAt(index: number, queue?: Song[]): Promise<boolean> {
    const token = ++this.trackSwitchToken;
    const useQueue = queue || this.state.queue;

    if (index < 0 || index >= useQueue.length) return false;

    this.initAudio();
    if (!this.audio) return false;

    this.state.isLoading = true;
    this.state.queue = useQueue;
    this.state.currentIndex = index;
    this.state.currentSong = useQueue[index];
    this.state.currentTime = 0;
    this.state.lyrics = [];
    this.state.lyricsLoading = true;
    // v2.2: 切歌时重置节拍系统
    this.beats = [];
    this.nextBeatIdx = 0;
    this.bpm = 0;
    this.state.bpm = 0;
    this.state.beatAnalyzing = false;
    this.realtimeKick?.reset();
    this.notify();

    try {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;

      const song = useQueue[index];

      let url: string | null = song.url;
      if (!url || (!url.startsWith('http') && !url.startsWith('blob:') && !url.startsWith('file:'))) {
        url = await this.resolveSongUrl(song);
      }

      if (token !== this.trackSwitchToken) return false;

      if (!url) {
        this.state.isLoading = false;
        this.notify();
        if (useQueue.length > 1) {
          setTimeout(() => this.next(), 500);
        }
        return false;
      }

      if (song.source === 'local') {
        this.state.currentSong = { ...song, url };
        const idx = this.state.queue.findIndex((s) => s.id === song.id);
        if (idx >= 0) this.state.queue[idx] = this.state.currentSong!;
      }

      this.state.lyricsLoading = true;
      this.notify();

      this.fetchLyrics(song).then((lyrics) => {
        if (token === this.trackSwitchToken) {
          this.state.lyrics = lyrics;
          this.state.lyricsLoading = false;
          this.notify();
        }
      });

      this.audio.src = url;
      this.audio.load();
      this.currentAudioUrl = url;

      // v2.2: 异步离线节拍分析（不阻塞播放，分析期间 UI 显示"分析中"，realtime fallback 兜底）
      this.startBeatAnalysis(url, token);

      this.audio.onended = () => {
        if (token !== this.trackSwitchToken) return;
        this.handleEnded();
      };

      this.audio.onerror = () => {
        if (token !== this.trackSwitchToken) return;
        this.state.isLoading = false;
        this.notify();
        this.tryNextOnError();
      };

      this.ensureAudioContext();
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }

      await this.audio.play();

      if (token === this.trackSwitchToken) {
        this.state.isLoading = false;
        // v3.5.0 A4: 加入播放历史（去重，最多 50）
        this.pushHistory(song);
        // v3.5.0 B3: 加载该歌曲的持久化歌词偏移
        this.loadLyricOffsetForSong(song);
        this.notify();
        return true;
      }
      return false;
    } catch (e) {
      console.error('[PlayerCore] playTrackAt error:', e);
      if (token === this.trackSwitchToken) {
        this.state.isLoading = false;
        this.notify();
      }
      return false;
    }
  }

  async playSong(song: Song, queue?: Song[]): Promise<boolean> {
    const useQueue = queue && queue.length > 0 ? queue : [song];
    const index = useQueue.findIndex((s) => s.id === song.id);
    return this.playTrackAt(index >= 0 ? index : 0, useQueue);
  }

  async togglePlay(): Promise<boolean> {
    if (!this.audio) {
      if (this.state.currentIndex >= 0 && this.state.queue.length > 0) {
        return this.playTrackAt(this.state.currentIndex);
      }
      return false;
    }

    try {
      this.ensureAudioContext();
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this.audio.paused || this.audio.ended) {
        if (!this.audio.src && this.state.currentIndex >= 0) {
          return this.playTrackAt(this.state.currentIndex);
        }
        await this.audio.play();
        return true;
      } else {
        this.audio.pause();
        return false;
      }
    } catch (e) {
      console.error('[PlayerCore] togglePlay error:', e);
      return false;
    }
  }

  pause() {
    this.audio?.pause();
  }

  play() {
    this.audio?.play().catch(() => {});
  }

  next() {
    if (!this.state.queue.length) return;
    let nextIndex: number;
    if (this.state.playMode === 'shuffle') {
      nextIndex = Math.floor(Math.random() * this.state.queue.length);
    } else {
      nextIndex = (this.state.currentIndex + 1) % this.state.queue.length;
    }
    this.playTrackAt(nextIndex);
  }

  prev() {
    if (!this.state.queue.length) return;
    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    const prevIndex = (this.state.currentIndex - 1 + this.state.queue.length) % this.state.queue.length;
    this.playTrackAt(prevIndex);
  }

  seek(time: number) {
    if (this.audio) {
      // v3.1.5: 处理流式音频 duration=Infinity/NaN 的情况
      // 浏览器会自动 clamp 到 seekable 范围，无需手动限制（手动 min 在 NaN 时会失败）
      const dur = this.audio.duration;
      let target = Math.max(0, time);
      if (isFinite(dur) && dur > 0) {
        target = Math.min(target, dur);
      } else if (isFinite(this.state.duration) && this.state.duration > 0) {
        // duration 未知时用 state.duration（来自 canplay/loadedmetadata）兜底
        target = Math.min(target, this.state.duration);
      }
      try {
        this.audio.currentTime = target;
      } catch (e) {
        console.warn('[PlayerCore] seek failed:', e);
      }
      this.state.currentTime = target;
      this.state.isSeeking = true;
      // v2.2: seek 后重新对齐节拍索引，避免连发或漏拍
      this.nextBeatIdx = 0;
      while (this.nextBeatIdx < this.beats.length && this.beats[this.nextBeatIdx] <= target) {
        this.nextBeatIdx++;
      }
      this.notify();
    }
  }

  seekRatio(ratio: number) {
    // v3.1.5: 优先用 audio.duration，Infinity/NaN 时 fallback 到 state.duration
    if (!this.audio) return;
    const dur = isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : (isFinite(this.state.duration) ? this.state.duration : 0);
    if (dur > 0) {
      this.seek(Math.max(0, Math.min(1, ratio)) * dur);
    }
  }

  setVolume(vol: number) {
    const v = Math.max(0, Math.min(1, vol));
    this.state.volume = v;
    // GainNode 平滑过渡 — Mineradio同款
    if (this.gainNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setTargetAtTime(v, now, 0.025);
    }
    if (this.audio) this.audio.volume = this.gainNode ? 1 : v;
    this.notify();
  }

  setPlayMode(mode: PlayMode) {
    this.state.playMode = mode;
    this.notify();
  }

  togglePlayMode() {
    const modes: PlayMode[] = ['list', 'single', 'shuffle'];
    const idx = modes.indexOf(this.state.playMode);
    this.setPlayMode(modes[(idx + 1) % modes.length]);
  }

  toggleLyrics() {
    this.state.showLyrics = !this.state.showLyrics;
    this.notify();
  }

  setQuality(quality: AudioQuality) {
    this.state.quality = quality;
    this.notify();
  }

  setQueue(queue: Song[]) {
    this.state.queue = queue;
    if (this.state.currentIndex >= queue.length) {
      this.state.currentIndex = queue.length - 1;
      this.state.currentSong = queue.length > 0 ? queue[queue.length - 1] : null;
    }
    this.notify();
  }

  addToQueue(song: Song) {
    this.state.queue = [...this.state.queue, song];
    this.notify();
  }

  addSongsToQueue(songs: Song[]) {
    this.state.queue = [...this.state.queue, ...songs];
    this.notify();
  }

  // v3.8.1: 插入到当前播放歌曲之后并立即播放（用于 AI 歌单"插队播放"语义）
  // 插入位置 = currentIndex + 1，原队列后续歌曲顺延，立即切到这首歌
  insertNext(song: Song) {
    if (this.state.currentIndex < 0 || this.state.currentIndex >= this.state.queue.length) {
      // 没有当前歌曲，直接加到末尾并播放
      this.state.queue = [...this.state.queue, song];
      this.playTrackAt(this.state.queue.length - 1, this.state.queue);
      return;
    }
    const insertIdx = this.state.currentIndex + 1;
    const newQueue = [...this.state.queue];
    newQueue.splice(insertIdx, 0, song);
    this.state.queue = newQueue;
    // 立即切到插入的歌曲播放
    this.playTrackAt(insertIdx, newQueue);
  }

  // v3.8.1: 替换整个队列并播放指定歌曲（用于 AI 歌单"全部播放"语义）
  replaceQueueAndPlay(songs: Song[], startIndex = 0) {
    if (!songs.length) return;
    this.state.queue = songs;
    this.playTrackAt(startIndex, songs);
  }

  removeFromQueue(index: number) {
    if (index < 0 || index >= this.state.queue.length) return;
    const newQueue = [...this.state.queue];
    newQueue.splice(index, 1);
    this.state.queue = newQueue;
    if (index === this.state.currentIndex) {
      if (newQueue.length === 0) {
        this.audio?.pause();
        this.state.currentIndex = -1;
        this.state.currentSong = null;
        this.state.isPlaying = false;
      } else {
        const newIdx = Math.min(index, newQueue.length - 1);
        this.playTrackAt(newIdx, newQueue);
        return;
      }
    } else if (index < this.state.currentIndex) {
      this.state.currentIndex--;
    }
    this.notify();
  }

  clearQueue() {
    this.audio?.pause();
    this.state.queue = [];
    this.state.currentIndex = -1;
    this.state.currentSong = null;
    this.state.isPlaying = false;
    this.state.isLoading = false;
    this.state.currentTime = 0;
    this.state.duration = 0;
    this.state.lyrics = [];
    this.notify();
  }

  isLiked(songId: string): boolean {
    return this.state.likedSongs.has(songId);
  }

  setLikedSongs(ids: string[]) {
    this.state.likedSongs = new Set(ids);
    this.notify();
  }

  async toggleLike(song: Song): Promise<boolean> {
    const liked = this.state.likedSongs.has(song.id);
    // 乐观更新：先立即更新本地状态，让点击有反馈（不阻塞 UI）
    const newSet = new Set(this.state.likedSongs);
    if (liked) newSet.delete(song.id);
    else newSet.add(song.id);
    this.state.likedSongs = newSet;
    this.notify();
    // 无服务器：仅本地收藏
    if (!this.serverPort) return !liked;
    // 有服务器：异步同步到网易云，失败时仅警告不回退（保持本地操作结果）
    // 这样网络波动/网易限制不会让用户操作白费，下次启动会从 likelist 重新同步真实状态
    (async () => {
      try {
        const res = await fetch(`${this.apiBase}/api/song/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: song.id, like: !liked }),
        });
        const data = await res.json();
        console.log('[PlayerCore] toggleLike response: HTTP', res.status, 'body:', JSON.stringify(data));
        if (!data.ok) {
          // 打印完整 data，避免 error 字段为 undefined 被省略时丢失线索
          console.warn('[PlayerCore] toggleLike sync failed (kept local):', { error: data.error, raw: data.raw, full: data });
        } else {
          console.log('[PlayerCore] toggleLike sync ok:', data.raw || '');
          // v3.3.0: 取消红心后延迟验证——3秒后查 likelist 确认网易是否真取消
          if (liked) {
            setTimeout(async () => {
              try {
                const vRes = await fetch(`${this.apiBase}/api/song/like/check`);
                const vData = await vRes.json();
                const stillLiked = vData.liked && vData.liked[String(song.id)];
                console.log('[PlayerCore] toggleLike verify after 3s:', {
                  songId: song.id,
                  expected: false,           // 期望: 已取消(不在列表)
                  actualStillLiked: stillLiked,
                  match: stillLiked === false,
                });
                // 如果网易实际没取消，强制同步真实状态
                if (stillLiked) {
                  console.warn('[PlayerCore] toggleLike: netease did NOT unlike, syncing real state');
                  const realSet = new Set(Object.keys(vData.liked));
                  this.state.likedSongs = realSet;
                  this.notify();
                }
              } catch (e) {
                console.warn('[PlayerCore] toggleLike verify error:', e);
              }
            }, 3000);
          }
        }
      } catch (e) {
        console.warn('[PlayerCore] toggleLike network error (kept local):', e);
      }
    })();
    return !liked;
  }

  async fetchLikedList(): Promise<string[]> {
    if (!this.serverPort) return [];
    try {
      const res = await fetch(`${this.apiBase}/api/song/like/check`);
      const data = await res.json();
      if (data.loggedIn && data.liked) {
        const ids = Object.keys(data.liked);
        this.state.likedSongs = new Set(ids);
        this.notify();
        return ids;
      }
    } catch (e) {
      console.error('[PlayerCore] fetchLikedList error:', e);
    }
    return [];
  }

  // ============================================================
  // v3.5.0 A4: 最近播放历史
  // ============================================================
  /** 添加到历史（去重，最多 50 首） */
  private pushHistory(song: Song) {
    const filtered = this.state.history.filter(s => s.id !== song.id);
    filtered.unshift(song);
    if (filtered.length > HISTORY_MAX) filtered.length = HISTORY_MAX;
    this.state.history = filtered;
  }

  clearHistory() {
    this.state.history = [];
    this.notify();
  }

  // ============================================================
  // v3.5.0 B3: 歌词时间偏移微调（按歌保存）
  // ============================================================
  /** 获取当前歌曲的歌词偏移（秒，正=歌词延后，负=提前） */
  getLyricOffset(): number {
    return this.lyricOffset;
  }

  /** 调整当前歌曲的歌词偏移（delta 秒，clamp 到 ±5s） */
  adjustLyricOffset(delta: number) {
    this.setLyricOffset(this.lyricOffset + delta);
  }

  /** 直接设置当前歌曲的歌词偏移 */
  setLyricOffset(offset: number) {
    const clamped = Math.max(-LYRIC_OFFSET_MAX, Math.min(LYRIC_OFFSET_MAX, offset));
    this.lyricOffset = clamped;
    const song = this.state.currentSong;
    if (song) {
      this.persisted.lyricOffsets[song.id] = clamped;
      this.notify();
    }
  }

  /** 重置当前歌曲的歌词偏移为 0 */
  resetLyricOffset() {
    this.setLyricOffset(0);
  }

  /** 切歌时加载该歌曲的持久化偏移（无则 0） */
  private loadLyricOffsetForSong(song: Song | null) {
    if (!song) {
      this.lyricOffset = 0;
      return;
    }
    this.lyricOffset = this.persisted.lyricOffsets[song.id] || 0;
  }

  // ============================================================
  // v3.6.0 A2: 搜索历史
  // ============================================================
  /** 添加搜索词到历史（去重，最多 10 条） */
  pushSearchHistory(keyword: string) {
    const k = keyword.trim();
    if (!k) return;
    const filtered = this.state.searchHistory.filter(s => s !== k);
    filtered.unshift(k);
    if (filtered.length > SEARCH_HISTORY_MAX) filtered.length = SEARCH_HISTORY_MAX;
    this.state.searchHistory = filtered;
    this.notify();
  }

  clearSearchHistory() {
    this.state.searchHistory = [];
    this.notify();
  }

  // ============================================================
  // v3.6.0 B1: 自定义快捷键
  // ============================================================
  /** 设置某个动作的快捷键（actionId → 键码，如 'Space' / 'KeyL'） */
  setShortcut(actionId: string, code: string) {
    this.state.shortcuts = { ...this.state.shortcuts, [actionId]: code };
    this.notify();
  }

  /** 重置快捷键为默认 */
  resetShortcuts() {
    this.state.shortcuts = { ...DEFAULT_SHORTCUTS };
    this.notify();
  }

  // ============================================================
  // v3.7.1 AI: 通用 OpenAI 兼容配置（API Key + Base URL + Model）
  // 兼容通义千问 / DeepSeek / OpenAI / Moonshot / 智谱 GLM 等
  // ============================================================
  /** 设置 AI 配置（任一字段可省略，省略的字段保持不变） */
  setAiConfig(opts: { apiKey?: string; baseUrl?: string; model?: string }) {
    if (typeof opts.apiKey === 'string') this.state.aiApiKey = opts.apiKey.trim();
    if (typeof opts.baseUrl === 'string') this.state.aiBaseUrl = opts.baseUrl.trim();
    if (typeof opts.model === 'string') this.state.aiModel = opts.model.trim();
    this.notify();
  }

  /** 清空 AI 配置（保留 baseUrl/model 默认值） */
  clearAiConfig() {
    this.state.aiApiKey = '';
    this.notify();
  }

  // ============================================================
  // 听歌统计：累计每首歌的播放秒数
  // ============================================================
  /** 累加播放时间到 playStats（去抖：每 10 秒 saveSettings 一次，避免频繁写 localStorage） */
  addPlayTime(songId: string, seconds: number) {
    if (!songId || seconds <= 0) return;
    // 累加到 state
    const cur = this.state.playStats[songId] || 0;
    this.state.playStats = { ...this.state.playStats, [songId]: cur + seconds };
    // 同步到 persisted（保证其他 notify 调用保存的值正确，引用赋值开销可忽略）
    this.persisted.playStats = this.state.playStats;
    // 去抖：距上次保存超过 10 秒才真正写 localStorage
    const now = Date.now();
    if (now - this.lastSaveTime >= 10000) {
      saveSettings(this.persisted);
      this.lastSaveTime = now;
    }
    // 通知监听器（手动派发，不调用 notify 以免每次都 saveSettings）
    this.listeners.forEach((l) => l({ ...this.state }));
  }

  /** 获取当前听歌统计（返回副本，外部修改不影响内部状态） */
  getPlayStats(): Record<string, number> {
    return { ...this.state.playStats };
  }

  /** 清空听歌统计 */
  clearPlayStats() {
    this.state.playStats = {};
    this.persisted.playStats = {};
    this.lastSaveTime = 0; // 重置去抖，下次 addPlayTime 立即保存
    this.notify();
  }
}

export const playerCore = new PlayerCore();
