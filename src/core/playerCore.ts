import type { Song, LyricsLine } from '../types';

export type PlayMode = 'list' | 'single' | 'shuffle';

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
  };
  private listeners: Set<Listener> = new Set();
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private progressRaf: number | null = null;
  private onTimeUpdate: ((time: number) => void) | null = null;
  private onAnalyserReady: ((analyser: AnalyserNode) => void) | null = null;

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
    this.audio.crossOrigin = 'anonymous';
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
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.gainNode = this.audioContext.createGain();
      this.source = this.audioContext.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);
      this.gainNode.gain.value = 1;
      if (this.onAnalyserReady && this.analyser) {
        this.onAnalyserReady(this.analyser);
      }
    } catch (e) {
      console.warn('[PlayerCore] AudioContext init failed:', e);
    }
  }

  private startProgressLoop() {
    this.stopProgressLoop();
    const tick = () => {
      if (!this.audio || this.audio.paused) return;
      this.state.currentTime = this.audio.currentTime;
      this.state.duration = this.audio.duration || this.state.duration;
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.state.currentTime);
      }
      this.notify();
      this.progressRaf = requestAnimationFrame(tick);
    };
    this.progressRaf = requestAnimationFrame(tick);
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

  async resolveSongUrl(song: Song): Promise<string | null> {
    // Blob URL 直接返回
    if (song.url && song.url.startsWith('blob:')) return song.url;
    // HTTP URL 直接返回
    if (song.url && song.url.startsWith('http')) return song.url;
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
    // 网易云歌曲通过本地服务器获取URL
    if (song.source === 'netease' && this.serverPort) {
      try {
        const res = await fetch(`${this.apiBase}/api/song/url?id=${song.id}`);
        const data = await res.json();
        if (data.url) return data.url;
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
      this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration || time));
      this.state.currentTime = this.audio.currentTime;
      this.notify();
    }
  }

  seekRatio(ratio: number) {
    if (this.audio && this.audio.duration) {
      this.seek(ratio * this.audio.duration);
    }
  }

  setVolume(vol: number) {
    const v = Math.max(0, Math.min(1, vol));
    this.state.volume = v;
    if (this.audio) this.audio.volume = v;
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
}

export const playerCore = new PlayerCore();
