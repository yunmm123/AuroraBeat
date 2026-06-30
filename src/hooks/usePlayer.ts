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

  const setAnalyserReadyHandler = useCallback((fn: (analyser: AnalyserNode) => void) => {
    playerCore.setAnalyserReadyHandler(fn);
  }, []);

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
    setQueue,
    addToQueue,
    addSongsToQueue,
    removeFromQueue,
    clearQueue,
    getAnalyser,
    setAnalyserReadyHandler,
  };
}
