import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayer } from './hooks/usePlayer';
import type { Song } from './types';
import * as THREE from 'three';

type Panel = 'discover' | 'library' | 'search' | 'settings';
type Provider = 'kugou' | 'netease';

const App: React.FC = () => {
  const player = usePlayer();
  const [activePanel, setActivePanel] = useState<Panel>('discover');
  const [queueOpen, setQueueOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchProvider, setSearchProvider] = useState<Provider>('kugou');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [kugouPlaylists, setKugouPlaylists] = useState<any[]>([]);
  const [kugouRanks, setKugouRanks] = useState<any[]>([]);
  const [currentPlaylistSongs, setCurrentPlaylistSongs] = useState<Song[]>([]);
  const [currentPlaylistName, setCurrentPlaylistName] = useState('');
  const [viewingPlaylist, setViewingPlaylist] = useState(false);
  const [neteaseLoggedIn, setNeteaseLoggedIn] = useState(false);
  const [kugouLoggedIn, setKugouLoggedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [bgColor, setBgColor] = useState('#0a0a12');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLDivElement>(null);

  const electron = (window as any).electronAPI;

  // ========== Three.js Particle Visualization ==========
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 30;
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const particleCount = 1500;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      const radius = 20 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);
      const hue = 0.45 + Math.random() * 0.25;
      const color = new THREE.Color().setHSL(hue, 0.7, 0.5 + Math.random() * 0.3);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
      sizes[i] = Math.random() * 2 + 0.5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let dataArray: any = null;

    const setupAnalyser = () => {
      const a = player.getAnalyser();
      if (a && !analyser) {
        analyser = a;
        dataArray = new Uint8Array(analyser.frequencyBinCount) as any;
      }
    };
    player.setAnalyserReadyHandler(setupAnalyser);
    setTimeout(setupAnalyser, 500);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const time = Date.now() * 0.0005;
      particles.rotation.y = time * 0.2;
      particles.rotation.x = time * 0.1;

      if (analyser && dataArray && player.isPlaying) {
        analyser.getByteFrequencyData(dataArray);
        const bass = dataArray.slice(0, 20).reduce((a: number, b: number) => a + b, 0) / 20 / 255;
        const mid = dataArray.slice(20, 100).reduce((a: number, b: number) => a + b, 0) / 80 / 255;
        material.opacity = 0.4 + bass * 0.5;
        material.size = 0.12 + bass * 0.2;
        const scale = 1 + bass * 0.3;
        particles.scale.setScalar(scale);
        camera.position.x = Math.sin(time) * mid * 2;
        camera.position.y = Math.cos(time * 0.7) * mid * 2;
      } else {
        material.opacity = 0.35;
        material.size = 0.12;
        particles.scale.setScalar(1);
      }

      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [player.isPlaying, player.getAnalyser, player.setAnalyserReadyHandler]);

  // ========== Extract dominant color from cover ==========
  useEffect(() => {
    if (!player.currentSong?.cover) {
      setBgColor('#0a0a12');
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = 50;
        canvas.height = 50;
        ctx.drawImage(img, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        r = Math.floor(r / count * 0.3);
        g = Math.floor(g / count * 0.25);
        b = Math.floor(b / count * 0.35);
        setBgColor(`rgb(${Math.max(r, 8)}, ${Math.max(g, 8)}, ${Math.max(b, 14)})`);
      } catch (e) {
        setBgColor('#0a0a12');
      }
    };
    img.onerror = () => setBgColor('#0a0a12');
    img.src = player.currentSong.cover;
  }, [player.currentSong?.cover]);

  // ========== Scroll lyrics to active line ==========
  useEffect(() => {
    if (activeLyricRef.current && lyricsContainerRef.current && player.showLyrics) {
      const container = lyricsContainerRef.current;
      const active = activeLyricRef.current;
      const containerRect = container.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const offset = activeRect.top - containerRect.top - containerRect.height / 2 + activeRect.height / 2;
      container.scrollBy({ top: offset, behavior: 'smooth' });
    }
  }, [player.currentTime, player.showLyrics]);

  // ========== Media keys ==========
  useEffect(() => {
    if (!electron) return;
    const unsubToggle = electron.onPlaybackToggle(() => player.togglePlay());
    const unsubNext = electron.onPlaybackNext(() => player.next());
    const unsubPrev = electron.onPlaybackPrev(() => player.prev());
    return () => {
      unsubToggle?.();
      unsubNext?.();
      unsubPrev?.();
    };
  }, [player]);

  // ========== Load initial data ==========
  useEffect(() => {
    loadKugouRanks();
    loadKugouRecommend();
    checkAuth();
  }, []);

  const checkAuth = async () => {
    if (!electron) return;
    const auth = await electron.getAuth?.();
    if (auth?.kugou) {
      setKugouLoggedIn(true);
      setUserInfo(auth.kugou);
    }
    if (auth?.netease) {
      setNeteaseLoggedIn(true);
      setUserInfo(auth.netease);
    }
    electron.onAuthRestored?.((data: any) => {
      if (data.kugou) { setKugouLoggedIn(true); setUserInfo(data.kugou); }
      if (data.netease) { setNeteaseLoggedIn(true); setUserInfo(data.netease); }
    });
  };

  const loadKugouRanks = async () => {
    if (!electron?.kugouRankList) return;
    try {
      const result = await electron.kugouRankList();
      const ranks = result?.data?.info?.[0]?.songs?.list || result?.data?.rank?.list || result?.data?.list || [];
      setKugouRanks(Array.isArray(ranks) ? ranks.slice(0, 10) : []);
    } catch (e) { console.warn('Load ranks failed:', e); }
  };

  const loadKugouRecommend = async () => {
    if (!electron?.kugouRecommendSongs) return;
    try {
      const result = await electron.kugouRecommendSongs();
      const lists = result?.data?.list || result?.data?.lists || [];
      if (Array.isArray(lists)) {
        setKugouPlaylists(lists.slice(0, 12));
      }
    } catch (e) { console.warn('Load recommend failed:', e); }
  };

  // ========== Search ==========
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !electron) return;
    setSearching(true);
    try {
      let songs: Song[] = [];
      if (searchProvider === 'kugou') {
        const result = await electron.kugouSearch(searchQuery, 1, 50);
        const lists = result?.data?.lists || result?.data?.info || [];
        songs = lists.map((s: any) => ({
          id: s.hash || s.FileHash || String(s.Audioid || s.id || Math.random()),
          title: s.SongName || s.songName || s.name || s.filename || '未知歌曲',
          artist: s.SingerName || s.singerName || s.singer?.name || s.artist || '未知艺术家',
          album: s.AlbumName || s.albumName || s.album?.name || '',
          cover: s.AlbumCover || s.albumCover || s.img || '',
          duration: (s.Duration || s.duration || s.time_length || 0) / (s.Duration > 1000 ? 1000 : 1),
          url: s.PlayUrl || s.playUrl || s.url || '',
          source: 'kugou' as const,
          hash: s.Hash || s.hash || s.FileHash,
          albumId: s.AlbumID || s.albumId || s.album_id,
        }));
      } else {
        const result = await electron.neteaseSearch(searchQuery, 50);
        songs = (result?.songs || []).map((s: any) => ({
          id: String(s.id),
          title: s.name || s.title || '未知歌曲',
          artist: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
          album: s.al?.album?.name || s.al?.name || '',
          cover: (s.al?.picUrl || '').replace(/^http:/, 'https:'),
          duration: (s.dt || 0) / 1000,
          url: '',
          source: 'netease' as const,
        }));
      }
      setSearchResults(songs);
    } catch (e) {
      console.error('Search failed:', e);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchProvider, electron]);

  // ========== Playlist ==========
  const openKugouPlaylist = async (listId: string, name: string) => {
    if (!electron?.kugouPlaylistTrackAllNew) return;
    setViewingPlaylist(true);
    setCurrentPlaylistName(name);
    setCurrentPlaylistSongs([]);
    try {
      const result = await electron.kugouPlaylistTrackAllNew(listId, 1, 500);
      const list = result?.data?.list || result?.data?.songs || result?.data?.info || [];
      const songs: Song[] = list.map((s: any, i: number) => ({
        id: s.hash || s.FileHash || String(s.Audioid || s.id || i),
        title: s.SongName || s.songName || s.name || s.filename || '未知歌曲',
        artist: s.SingerName || s.singerName || s.singer?.name || s.artist || '未知艺术家',
        album: s.AlbumName || s.albumName || s.album?.name || '',
        cover: s.AlbumCover || s.albumCover || s.img || '',
        duration: (s.Duration || s.duration || s.time_length || 0) / (s.Duration > 1000 ? 1000 : 1),
        url: s.PlayUrl || s.playUrl || s.url || '',
        source: 'kugou' as const,
        hash: s.Hash || s.hash || s.FileHash,
        albumId: s.AlbumID || s.albumId || s.album_id,
      }));
      setCurrentPlaylistSongs(songs);
    } catch (e) {
      console.error('Load playlist failed:', e);
    }
  };

  const openRank = async (rankId: string, rankName: string) => {
    if (!electron?.kugouRankAudio) return;
    setViewingPlaylist(true);
    setCurrentPlaylistName(rankName);
    setCurrentPlaylistSongs([]);
    try {
      const result = await electron.kugouRankAudio(rankId, 1);
      const list = result?.data?.songs?.list || result?.data?.list || result?.data?.info || [];
      const songs: Song[] = list.map((s: any, i: number) => ({
        id: s.hash || s.FileHash || String(s.Audioid || s.id || i),
        title: s.SongName || s.songName || s.name || s.filename || '未知歌曲',
        artist: s.SingerName || s.singerName || s.singer?.name || s.artist || '未知艺术家',
        album: s.AlbumName || s.albumName || s.album?.name || '',
        cover: s.AlbumCover || s.albumCover || s.img || '',
        duration: (s.Duration || s.duration || s.time_length || 0) / (s.Duration > 1000 ? 1000 : 1),
        url: s.PlayUrl || s.playUrl || s.url || '',
        source: 'kugou' as const,
        hash: s.Hash || s.hash || s.FileHash,
        albumId: s.AlbumID || s.albumId || s.album_id,
      }));
      setCurrentPlaylistSongs(songs);
    } catch (e) {
      console.error('Load rank failed:', e);
    }
  };

  const playSongs = (songs: Song[], index: number = 0) => {
    if (songs.length === 0) return;
    player.playTrackAt(index, songs);
  };

  const addSongs = (songs: Song[]) => {
    player.addSongsToQueue(songs);
  };

  const importLocal = async () => {
    if (!electron?.selectLocalFiles) return;
    const files = await electron.selectLocalFiles();
    if (files?.length > 0) {
      const songs: Song[] = files.map((f: any) => ({ ...f, title: f.title || f.name }));
      if (player.queue.length === 0) {
        playSongs(songs, 0);
      } else {
        addSongs(songs);
      }
    }
  };

  const openNeteaseLogin = async () => {
    if (!electron?.neteaseOpenLoginWindow) return;
    const result = await electron.neteaseOpenLoginWindow();
    if (!result?.ok) return;
    // 等待 auth:restored 事件写入完成
    await new Promise(r => setTimeout(r, 500));
    const auth = await electron.getAuth?.();
    if (auth?.netease) {
      setNeteaseLoggedIn(true);
      setUserInfo(auth.netease);
    } else {
      // 再试一次（可能事件还没写完）
      await new Promise(r => setTimeout(r, 1000));
      const auth2 = await electron.getAuth?.();
      if (auth2?.netease) {
        setNeteaseLoggedIn(true);
        setUserInfo(auth2.netease);
      }
    }
  };

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const activeLyricIndex = useMemo(() => {
    if (!player.lyrics.length) return -1;
    let idx = 0;
    for (let i = 0; i < player.lyrics.length; i++) {
      if (player.currentTime >= player.lyrics[i].time - 0.3) idx = i;
      else break;
    }
    return idx;
  }, [player.currentTime, player.lyrics]);

  const playModeIcon = player.playMode === 'single' ? '🔂' : player.playMode === 'shuffle' ? '🔀' : '🔁';
  const playModeLabel = player.playMode === 'single' ? '单曲循环' : player.playMode === 'shuffle' ? '随机播放' : '列表循环';

  return (
    <div ref={containerRef} className="fixed inset-0 overflow-hidden text-white select-none" style={{ background: bgColor, transition: 'background 1.2s ease' }}>
      {/* Album blur background */}
      {player.currentSong?.cover && (
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${player.currentSong.cover})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(100px) brightness(0.25) saturate(1.8)',
            transform: 'scale(1.5)',
            opacity: 0.8,
          }}
        />
      )}

      {/* Canvas particles */}
      <canvas ref={canvasRef} className="absolute inset-0 z-10 pointer-events-none" />

      {/* Gradient overlays */}
      <div className="absolute inset-0 z-20 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.5) 100%)' }} />

      {/* Title bar */}
      <div className="absolute top-0 left-0 right-0 h-10 z-50 flex items-center justify-between px-4" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ background: 'linear-gradient(135deg, #00f5d4, #2442ff)' }} />
          <span className="text-xs font-semibold tracking-widest opacity-60 uppercase">AuroraBeat</span>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button onClick={() => electron?.window?.minimize?.()} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-all text-white/50 hover:text-white">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="6" width="8" height="1" fill="currentColor"/></svg>
          </button>
          <button onClick={() => electron?.window?.maximize?.()} className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition-all text-white/50 hover:text-white">
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button onClick={() => electron?.window?.close?.()} className="w-8 h-8 rounded-lg hover:bg-red-500/80 flex items-center justify-center transition-all text-white/50 hover:text-white">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="absolute inset-0 z-30 flex flex-col pt-10">
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-56 flex flex-col p-4 gap-1 border-r border-white/5 backdrop-blur-xl bg-black/20">
            <div className="text-[10px] font-bold tracking-widest text-white/30 uppercase mb-2 px-3">导航</div>
            {[
              { id: 'discover', icon: '✨', label: '发现' },
              { id: 'library', icon: '🎵', label: '我的音乐' },
              { id: 'search', icon: '🔍', label: '搜索' },
              { id: 'settings', icon: '⚙️', label: '设置' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => { setActivePanel(item.id as Panel); setViewingPlaylist(false); }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all text-left
                  ${activePanel === item.id
                    ? 'bg-white/10 text-white shadow-lg'
                    : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
              >
                <span className="text-base">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            ))}

            <div className="mt-6">
              <button
                onClick={importLocal}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/50 hover:text-white/80 hover:bg-white/5 transition-all text-left"
              >
                <span className="text-base">📂</span>
                <span className="font-medium">导入本地音乐</span>
              </button>
            </div>

            <div className="flex-1" />

            {/* Login status */}
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              {neteaseLoggedIn || kugouLoggedIn ? (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-xs font-bold">
                    {userInfo?.nickname?.[0] || 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{userInfo?.nickname || '已登录'}</div>
                    <div className="text-[10px] text-white/40">{neteaseLoggedIn ? '网易云' : '酷狗'}</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[10px] text-white/40">登录以同步歌单</div>
                  <button onClick={openNeteaseLogin} className="w-full py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-red-500/80 to-pink-500/80 hover:from-red-500 hover:to-pink-500 transition-all">
                    网易云登录
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Discover panel */}
            {activePanel === 'discover' && !viewingPlaylist && (
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <div>
                  <h2 className="text-xl font-bold mb-4">推荐歌单</h2>
                  <div className="grid grid-cols-4 gap-4">
                    {kugouPlaylists.map((pl: any, i: number) => {
                      const id = pl.specialid || pl.listid || pl.id;
                      const name = pl.specialname || pl.name || pl.title || '歌单';
                      const img = pl.img || pl.cover || pl.pic || '';
                      return (
                        <button
                          key={i}
                          onClick={() => id && openKugouPlaylist(String(id), name)}
                          className="group text-left"
                        >
                          <div className="aspect-square rounded-2xl overflow-hidden relative mb-2">
                            <div
                              className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110"
                              style={{ backgroundImage: img ? `url(${img.startsWith('http') ? img : 'https://imge.kugou.com/stdmusic/' + img})` : 'linear-gradient(135deg, #00f5d422, #2442ff22)' }}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center text-black">
                                <svg width="20" height="20" viewBox="0 0 20 20"><path d="M6 4l12 6-12 6V4z" fill="currentColor"/></svg>
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-medium truncate">{name}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {kugouRanks.length > 0 && (
                  <div>
                    <h2 className="text-xl font-bold mb-4">音乐榜单</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {kugouRanks.slice(0, 6).map((rank: any, i: number) => {
                        const id = rank.rankid || rank.id || rank.bannerurl?.match(/rank\/(\d+)/)?.[1];
                        const name = rank.rankname || rank.name || '榜单';
                        const img = rank.imgurl || rank.cover || rank.bannerurl || '';
                        return (
                          <button
                            key={i}
                            onClick={() => id && openRank(String(id), name)}
                            className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-left"
                          >
                            <div
                              className="w-14 h-14 rounded-lg flex-shrink-0 bg-cover bg-center"
                              style={{ backgroundImage: img ? `url(${img})` : 'linear-gradient(135deg, #f4d28a33, #ff536733)' }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{name}</div>
                              <div className="text-xs text-white/40">点击查看全部歌曲</div>
                            </div>
                            <div className="text-white/30">→</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Playlist view */}
            {viewingPlaylist && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 flex items-center gap-4 border-b border-white/5">
                  <button onClick={() => setViewingPlaylist(false)} className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all">
                    ←
                  </button>
                  <h2 className="text-lg font-bold">{currentPlaylistName}</h2>
                  {currentPlaylistSongs.length > 0 && (
                    <>
                      <button
                        onClick={() => playSongs(currentPlaylistSongs, 0)}
                        className="ml-auto px-5 py-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-sm hover:shadow-lg hover:shadow-cyan-500/25 transition-all"
                      >
                        播放全部
                      </button>
                      <button
                        onClick={() => addSongs(currentPlaylistSongs)}
                        className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium transition-all"
                      >
                        添加到队列
                      </button>
                    </>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {currentPlaylistSongs.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-white/30 text-sm">加载中...</div>
                  ) : (
                    currentPlaylistSongs.map((song, i) => {
                      const isCurrent = player.currentSong?.id === song.id;
                      return (
                        <div
                          key={song.id + i}
                          className={`flex items-center gap-4 px-6 py-2.5 hover:bg-white/5 transition-all cursor-pointer group
                            ${isCurrent ? 'bg-cyan-500/10' : ''}`}
                          onClick={() => playSongs(currentPlaylistSongs, i)}
                        >
                          <div className={`w-6 text-center text-xs ${isCurrent ? 'text-cyan-400' : 'text-white/30 group-hover:text-white/50'}`}>
                            {isCurrent && player.isPlaying ? '♪' : i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm truncate ${isCurrent ? 'text-cyan-400 font-medium' : 'text-white/90'}`}>{song.title}</div>
                          </div>
                          <div className="w-40 text-xs text-white/40 truncate">{song.artist}</div>
                          <div className="w-14 text-xs text-white/30 text-right">{formatTime(song.duration)}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Library panel */}
            {activePanel === 'library' && !viewingPlaylist && (
              <div className="flex-1 overflow-y-auto p-6">
                <h2 className="text-xl font-bold mb-4">我的音乐</h2>
                {player.queue.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-80 text-white/30">
                    <div className="text-5xl mb-4">🎶</div>
                    <div className="text-sm">暂无播放记录</div>
                    <div className="text-xs mt-2 text-white/20">从发现页或搜索开始播放音乐</div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {player.queue.map((song, i) => {
                      const isCurrent = i === player.currentIndex;
                      return (
                        <div
                          key={song.id + i}
                          className={`flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/5 transition-all cursor-pointer group
                            ${isCurrent ? 'bg-cyan-500/10' : ''}`}
                          onClick={() => player.playTrackAt(i)}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0
                            ${isCurrent ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-white/30 group-hover:text-white/50'}`}>
                            {isCurrent && player.isPlaying ? '♪' : i + 1}
                          </div>
                          {song.cover && (
                            <div className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${song.cover})` }} />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm truncate ${isCurrent ? 'text-cyan-400 font-medium' : 'text-white/90'}`}>{song.title}</div>
                            <div className="text-xs text-white/40 truncate">{song.artist}</div>
                          </div>
                          <div className="text-xs text-white/30 w-14 text-right">{formatTime(song.duration)}</div>
                          <button
                            onClick={(e) => { e.stopPropagation(); player.removeFromQueue(i); }}
                            className="w-7 h-7 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Search panel */}
            {activePanel === 'search' && !viewingPlaylist && (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                <div className="flex gap-3 mb-4">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder="搜索歌曲、歌手..."
                      className="w-full px-5 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-cyan-500/50 focus:bg-white/10 outline-none text-sm placeholder:text-white/30 transition-all"
                    />
                  </div>
                  <div className="flex rounded-xl bg-white/5 p-1">
                    {(['kugou', 'netease'] as Provider[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setSearchProvider(p)}
                        className={`px-4 py-2 rounded-lg text-xs font-medium transition-all
                          ${searchProvider === p ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'}`}
                      >
                        {p === 'kugou' ? '酷狗' : '网易云'}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleSearch}
                    disabled={searching || !searchQuery.trim()}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-sm hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {searching ? '搜索中' : '搜索'}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {searchResults.length === 0 && !searching && (
                    <div className="flex flex-col items-center justify-center h-60 text-white/30">
                      <div className="text-4xl mb-3">🔍</div>
                      <div className="text-sm">输入关键词搜索音乐</div>
                    </div>
                  )}
                  {searchResults.map((song, i) => {
                    const isCurrent = player.currentSong?.id === song.id;
                    return (
                      <div
                        key={song.id + i}
                        className={`flex items-center gap-4 px-4 py-2.5 hover:bg-white/5 transition-all cursor-pointer group
                          ${isCurrent ? 'bg-cyan-500/10' : ''}`}
                        onClick={() => player.playSong(song, searchResults)}
                      >
                        <div className={`w-6 text-center text-xs ${isCurrent ? 'text-cyan-400' : 'text-white/30 group-hover:text-white/50'}`}>
                          {isCurrent && player.isPlaying ? '♪' : i + 1}
                        </div>
                        {song.cover && (
                          <div className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${song.cover})` }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm truncate ${isCurrent ? 'text-cyan-400 font-medium' : 'text-white/90'}`}>{song.title}</div>
                          <div className="text-xs text-white/40 truncate">{song.artist}</div>
                        </div>
                        <div className="text-xs text-white/30 w-14 text-right">{formatTime(song.duration)}</div>
                        <div className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/30">
                          {song.source === 'kugou' ? '酷狗' : '网易云'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Settings panel */}
            {activePanel === 'settings' && !viewingPlaylist && (
              <div className="flex-1 overflow-y-auto p-6">
                <h2 className="text-xl font-bold mb-6">设置</h2>
                <div className="space-y-6 max-w-lg">
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-sm font-medium mb-3">播放模式</div>
                    <div className="flex gap-2">
                      {[{ v: 'list', l: '列表循环' }, { v: 'single', l: '单曲循环' }, { v: 'shuffle', l: '随机播放' }].map((m) => (
                        <button
                          key={m.v}
                          onClick={() => player.setPlayMode(m.v as any)}
                          className={`px-4 py-2 rounded-lg text-xs font-medium transition-all
                            ${player.playMode === m.v ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-white/50 hover:text-white/80 border border-transparent'}`}
                        >
                          {m.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-sm font-medium mb-3">音量</div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={player.volume}
                      onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                      className="w-full accent-cyan-400"
                    />
                    <div className="text-xs text-white/40 mt-1">{Math.round(player.volume * 100)}%</div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/5 border border-white/5">
                    <div className="text-sm font-medium mb-3">歌词显示</div>
                    <button
                      onClick={() => player.toggleLyrics()}
                      className={`px-4 py-2 rounded-lg text-xs font-medium transition-all
                        ${player.showLyrics ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-white/50'}`}
                    >
                      {player.showLyrics ? '歌词已显示' : '歌词已隐藏'}
                    </button>
                  </div>
                  <button
                    onClick={() => player.clearQueue()}
                    className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/30 transition-all"
                  >
                    清空播放队列
                  </button>
                </div>
              </div>
            )}

            {/* Center lyrics stage (when playing) */}
            {player.currentSong && player.showLyrics && (activePanel === 'discover' || activePanel === 'library') && !viewingPlaylist && (
              <div className="absolute left-56 right-0 top-10 bottom-24 flex items-center justify-center pointer-events-none">
                <div
                  ref={lyricsContainerRef}
                  className="w-full max-w-2xl h-80 overflow-y-auto px-8 pointer-events-auto scroll-smooth"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                  <style>{`.no-scrollbar::-webkit-scrollbar{display:none}`}</style>
                  <div className="space-y-3 py-32">
                    {player.lyricsLoading && player.lyrics.length === 0 && (
                      <div className="text-center text-white/30 text-sm py-8">加载歌词中...</div>
                    )}
                    {player.lyrics.length === 0 && !player.lyricsLoading && (
                      <div className="text-center text-white/20 text-sm py-8">暂无歌词</div>
                    )}
                    {player.lyrics.map((line, i) => {
                      const isActive = i === activeLyricIndex;
                      return (
                        <div
                          key={i}
                          ref={isActive ? activeLyricRef : null}
                          className={`text-center transition-all duration-500 leading-relaxed
                            ${isActive
                              ? 'text-white text-2xl font-bold scale-105 drop-shadow-lg'
                              : i < activeLyricIndex
                                ? 'text-white/25 text-base'
                                : 'text-white/40 text-lg'}`}
                        >
                          {line.text || '♪'}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Center play prompt when nothing playing */}
            {!player.currentSong && activePanel === 'discover' && !viewingPlaylist && (
              <div className="absolute left-56 right-0 top-10 bottom-24 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-6xl mb-6 opacity-40">🎧</div>
                  <div className="text-xl font-light text-white/50">选择一首歌开始播放</div>
                  <div className="text-sm text-white/30 mt-2">从发现页浏览歌单，或使用搜索找到你喜欢的音乐</div>
                </div>
              </div>
            )}
          </div>

          {/* Queue panel */}
          {queueOpen && (
            <div className="w-80 border-l border-white/5 backdrop-blur-xl bg-black/30 flex flex-col">
              <div className="p-4 flex items-center justify-between border-b border-white/5">
                <div className="text-sm font-semibold">播放队列 ({player.queue.length})</div>
                <button onClick={() => setQueueOpen(false)} className="w-7 h-7 rounded-lg hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center">×</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {player.queue.map((song, i) => {
                  const isCurrent = i === player.currentIndex;
                  return (
                    <div
                      key={song.id + i}
                      className={`flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 cursor-pointer transition-all
                        ${isCurrent ? 'bg-cyan-500/10' : ''}`}
                      onClick={() => player.playTrackAt(i)}
                    >
                      <div className={`w-5 text-center text-xs ${isCurrent ? 'text-cyan-400' : 'text-white/20'}`}>
                        {isCurrent && player.isPlaying ? '♪' : i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs truncate ${isCurrent ? 'text-cyan-400 font-medium' : 'text-white/80'}`}>{song.title}</div>
                        <div className="text-[10px] text-white/30 truncate">{song.artist}</div>
                      </div>
                    </div>
                  );
                })}
                {player.queue.length === 0 && (
                  <div className="text-center text-white/20 text-xs py-12">队列为空</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom control bar */}
        <div className="h-24 px-6 border-t border-white/5 backdrop-blur-xl bg-black/40 flex items-center gap-6">
          {/* Current song info */}
          <div className="flex items-center gap-4 w-72 flex-shrink-0">
            {player.currentSong?.cover ? (
              <div className="w-14 h-14 rounded-xl bg-cover bg-center flex-shrink-0 shadow-lg" style={{ backgroundImage: `url(${player.currentSong.cover})` }} />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center text-2xl flex-shrink-0">🎵</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{player.currentSong?.title || '未播放'}</div>
              <div className="text-xs text-white/40 truncate">{player.currentSong?.artist || '选择一首歌开始'}</div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-1 flex flex-col items-center gap-2 max-w-2xl mx-auto">
            <div className="flex items-center gap-4">
              <button
                onClick={player.togglePlayMode}
                title={playModeLabel}
                className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all text-sm"
              >
                {playModeIcon}
              </button>
              <button onClick={player.prev} className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-all">
                <svg width="18" height="18" viewBox="0 0 18 18"><path d="M14 3L6 9l8 6V3zM4 3v12" fill="currentColor"/></svg>
              </button>
              <button
                onClick={() => player.togglePlay()}
                className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-white/20"
              >
                {player.isLoading ? (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : player.isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 18 18"><rect x="4" y="3" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="10.5" y="3" width="3.5" height="12" rx="1" fill="currentColor"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18"><path d="M5 3l10 6-10 6V3z" fill="currentColor"/></svg>
                )}
              </button>
              <button onClick={player.next} className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-all">
                <svg width="18" height="18" viewBox="0 0 18 18"><path d="M4 3l8 6-8 6V3zM14 3v12" fill="currentColor"/></svg>
              </button>
              <button
                onClick={() => player.toggleLyrics()}
                title={player.showLyrics ? '隐藏歌词' : '显示歌词'}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all text-sm
                  ${player.showLyrics ? 'bg-cyan-500/20 text-cyan-400' : 'hover:bg-white/10 text-white/50 hover:text-white'}`}
              >
                词
              </button>
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-3 w-full">
              <span className="text-[10px] text-white/40 w-10 text-right font-mono">{formatTime(player.currentTime)}</span>
              <div
                className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden group cursor-pointer relative"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  player.seekRatio(ratio);
                }}
              >
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full transition-all relative"
                  style={{ width: `${player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0}%` }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg" />
                </div>
              </div>
              <span className="text-[10px] text-white/40 w-10 font-mono">{formatTime(player.duration)}</span>
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3 w-72 justify-end flex-shrink-0">
            <div className="flex items-center gap-2 group/vol">
              <button className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all">
                {player.volume === 0 ? '🔇' : player.volume < 0.5 ? '🔉' : '🔊'}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={player.volume}
                onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                className="w-20 accent-cyan-400 opacity-60 group-hover/vol:opacity-100 transition-opacity"
              />
            </div>
            <button
              onClick={() => setQueueOpen(!queueOpen)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all
                ${queueOpen ? 'bg-cyan-500/20 text-cyan-400' : 'hover:bg-white/10 text-white/50 hover:text-white'}`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16">
                <path d="M2 4h12M2 8h8M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
