import { useState, useEffect, useCallback } from 'react';
import { playerCore, type PlayerState, type PlayMode } from '../core/playerCore';
import type { Song } from '../types';

export function usePlayer() {
  const [state, setState] = useState<PlayerState>(playerCore.getState());

  useEffect(() => {
    return playerCore.subscribe(setState);
  }, []);

  const playSong = useCallback((song: Song, queue?: Song[]) => {
    return playerCore.playSong(song, queue);
  }, []);

  const playTrackAt = useCallback((index: number, queue?: Song[]) => {
    return playerCore.playTrackAt(index, queue);
  }, []);

  const togglePlay = useCallback(() => {
    return playerCore.togglePlay();
  }, []);

  const next = useCallback(() => {
    playerCore.next();
  }, []);

  const prev = useCallback(() => {
    playerCore.prev();
  }, []);

  const seek = useCallback((time: number) => {
    playerCore.seek(time);
  }, []);

  const seekRatio = useCallback((ratio: number) => {
    playerCore.seekRatio(ratio);
  }, []);

  const setVolume = useCallback((vol: number) => {
    playerCore.setVolume(vol);
  }, []);

  const setPlayMode = useCallback((mode: PlayMode) => {
    playerCore.setPlayMode(mode);
  }, []);

  const togglePlayMode = useCallback(() => {
    playerCore.togglePlayMode();
  }, []);

  const toggleLyrics = useCallback(() => {
    playerCore.toggleLyrics();
  }, []);

  const setQuality = useCallback((quality: any) => {
    playerCore.setQuality(quality);
  }, []);

  const setQueue = useCallback((queue: Song[]) => {
    playerCore.setQueue(queue);
  }, []);

  const addToQueue = useCallback((song: Song) => {
    playerCore.addToQueue(song);
  }, []);

  const addSongsToQueue = useCallback((songs: Song[]) => {
    playerCore.addSongsToQueue(songs);
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    playerCore.removeFromQueue(index);
  }, []);

  const clearQueue = useCallback(() => {
    playerCore.clearQueue();
  }, []);

  const getAnalyser = useCallback(() => {
    return playerCore.getAnalyser();
  }, []);

  const getBeatAnalyser = useCallback(() => {
    return playerCore.getBeatAnalyser();
  }, []);

  const setAnalyserReadyHandler = useCallback((fn: (analyser: AnalyserNode) => void) => {
    playerCore.setAnalyserReadyHandler(fn);
  }, []);

  const getCurrentAudioUrl = useCallback(() => playerCore.getCurrentAudioUrl(), []);
  const getCurrentTime = useCallback(() => playerCore.getCurrentTime(), []);

  // v2.2: 订阅节拍事件（来源：离线预分析为主，realtime 为 fallback）。bpm 已通过 state 暴露。
  const onBeat = useCallback((fn: (time: number) => void) => playerCore.onBeat(fn), []);
  const getBpm = useCallback(() => playerCore.getBpm(), []);

  const setServerPort = useCallback((port: number) => {
    playerCore.setServerPort(port);
  }, []);

  const isLiked = useCallback((songId: string) => playerCore.isLiked(songId), []);
  const toggleLike = useCallback((song: Song) => playerCore.toggleLike(song), []);
  const fetchLikedList = useCallback(() => playerCore.fetchLikedList(), []);

  // v3.5.0 A4: 播放历史
  const clearHistory = useCallback(() => playerCore.clearHistory(), []);

  // v3.5.0 B3: 歌词偏移微调
  const getLyricOffset = useCallback(() => playerCore.getLyricOffset(), []);
  const adjustLyricOffset = useCallback((delta: number) => playerCore.adjustLyricOffset(delta), []);
  const resetLyricOffset = useCallback(() => playerCore.resetLyricOffset(), []);

  // v3.6.0 A2: 搜索历史
  const pushSearchHistory = useCallback((k: string) => playerCore.pushSearchHistory(k), []);
  const clearSearchHistory = useCallback(() => playerCore.clearSearchHistory(), []);

  // v3.6.0 B1: 自定义快捷键
  const setShortcut = useCallback((actionId: string, code: string) => playerCore.setShortcut(actionId, code), []);
  const resetShortcuts = useCallback(() => playerCore.resetShortcuts(), []);

  // v3.7.1 AI: 通用 OpenAI 兼容配置（API Key + Base URL + Model）
  const setAiConfig = useCallback((opts: { apiKey?: string; baseUrl?: string; model?: string }) => playerCore.setAiConfig(opts), []);
  const clearAiConfig = useCallback(() => playerCore.clearAiConfig(), []);

  return {
    ...state,
    playSong,
    playTrackAt,
    togglePlay,
    next,
    prev,
    seek,
    seekRatio,
    setVolume,
    setPlayMode,
    togglePlayMode,
    toggleLyrics,
    setQuality,
    setQueue,
    addToQueue,
    addSongsToQueue,
    removeFromQueue,
    clearQueue,
    getAnalyser,
    getBeatAnalyser,
    setAnalyserReadyHandler,
    getCurrentAudioUrl,
    getCurrentTime,
    onBeat,
    getBpm,
    setServerPort,
    isLiked,
    toggleLike,
    fetchLikedList,
    clearHistory,
    getLyricOffset,
    adjustLyricOffset,
    resetLyricOffset,
    pushSearchHistory,
    clearSearchHistory,
    setShortcut,
    resetShortcuts,
    setAiConfig,
    clearAiConfig,
  };
}
