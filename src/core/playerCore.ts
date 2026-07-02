import type { Song, LyricsLine, YrcWord } from '../types';
import { analyzeTrackBeats } from './beatAnalyzer';
import { RealtimeKickDetector } from './beatDetector';

export type PlayMode = 'list' | 'single' | 'shuffle';
export type AudioQuality = 'standard' | 'exhigh' | 'lossless' | 'hires';

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
}

type Listener = (state: PlayerState) => void;

class PlayerCore {
  private audio: HTMLAudioElement | null = null;
  private trackSwitchToken = 0;
  private serverPort = 0;
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
  };
  private listeners: Set<Listener> = new Set();
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private beatAnalyser: AnalyserNode | null = null;
  private beatLowpass: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private progressRaf: number | null = null;
  private onTimeUpdate: ((time: number) => void) | null = null;
  private onAnalyserReady: ((analyser: AnalyserNode) => void) | null = null;
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
    this.initAudio();
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
      // 可视化支路（进 destination 出声）：source → analyser → gainNode → destination
      this.source.connect(this.analyser);
      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
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
      if (song.source === 'netease' && this.serverPort) {
        const res = await fetch(`${this.apiBase}/api/lyric?id=${song.id}`);
        const data = await res.json();
        lrc = data.lyric || '';
      } else if (song.source === 'local') {
        const result = await (window as any).electronAPI?.searchLyrics?.(song.title || song.name || '', song.artist);
        lrc = result?.lyric || '';
      }
      return this.parseLyrics(lrc);
    } catch (e) {
      console.error('[PlayerCore] fetchLyrics error:', e);
      return [];
    }
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
        if (!data.ok) {
          console.warn('[PlayerCore] toggleLike sync failed (kept local):', data.error);
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
}

export const playerCore = new PlayerCore();
