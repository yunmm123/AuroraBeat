import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayer } from './hooks/usePlayer';
import type { Song } from './types';
import * as THREE from 'three';

type Panel = 'home' | 'search' | 'library' | 'playlist';
type Provider = 'kugou' | 'netease';

const App: React.FC = () => {
  const player = usePlayer();
  const [panel, setPanel] = useState<Panel>('home');
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchProvider, setSearchProvider] = useState<Provider>('kugou');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [ranks, setRanks] = useState<any[]>([]);
  const [viewingPlaylist, setViewingPlaylist] = useState<Song[]>([]);
  const [viewingPlaylistName, setViewingPlaylistName] = useState('');
  const [neteaseLoggedIn, setNeteaseLoggedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [bgColor, setBgColor] = useState('#08090B');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLDivElement>(null);

  const electron = (window as any).electronAPI;

  // ========== Three.js Particles ==========
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 30;
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const count = 1200;
    const pos = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const r = 20 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      pos[i3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i3 + 2] = r * Math.cos(phi);
      const c = new THREE.Color().setHSL(0.45 + Math.random() * 0.25, 0.7, 0.5 + Math.random() * 0.3);
      cols[i3] = c.r; cols[i3 + 1] = c.g; cols[i3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.15, vertexColors: true, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const particles = new THREE.Points(geo, mat);
    scene.add(particles);

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let dataArr: any = null;
    const setupAnalyser = () => {
      const a = player.getAnalyser();
      if (a && !analyser) { analyser = a; dataArr = new Uint8Array(analyser.frequencyBinCount) as any; }
    };
    player.setAnalyserReadyHandler(setupAnalyser);
    setTimeout(setupAnalyser, 500);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = Date.now() * 0.0005;
      particles.rotation.y = t * 0.2;
      particles.rotation.x = t * 0.1;
      if (analyser && dataArr && player.isPlaying) {
        analyser.getByteFrequencyData(dataArr);
        const bass = dataArr.slice(0, 20).reduce((a: number, b: number) => a + b, 0) / 20 / 255;
        mat.opacity = 0.35 + bass * 0.45;
        mat.size = 0.12 + bass * 0.18;
        particles.scale.setScalar(1 + bass * 0.25);
        camera.position.x = Math.sin(t) * bass * 2;
        camera.position.y = Math.cos(t * 0.7) * bass * 2;
      } else {
        mat.opacity = 0.3; mat.size = 0.12; particles.scale.setScalar(1);
      }
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', onResize); geo.dispose(); mat.dispose(); renderer.dispose(); };
  }, [player.isPlaying]);

  // ========== Cover color extraction ==========
  useEffect(() => {
    if (!player.currentSong?.cover) { setBgColor('#08090B'); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        if (!ctx) return;
        c.width = 50; c.height = 50;
        ctx.drawImage(img, 0, 0, 50, 50);
        const d = ctx.getImageData(0, 0, 50, 50).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        r = Math.floor(r / n * 0.25); g = Math.floor(g / n * 0.22); b = Math.floor(b / n * 0.30);
        setBgColor(`rgb(${Math.max(r, 6)}, ${Math.max(g, 6)}, ${Math.max(b, 10)})`);
      } catch { setBgColor('#08090B'); }
    };
    img.onerror = () => setBgColor('#08090B');
    img.src = player.currentSong.cover;
  }, [player.currentSong?.cover]);

  // ========== Lyrics scroll ==========
  useEffect(() => {
    if (activeLyricRef.current && lyricsRef.current && showLyrics) {
      const container = lyricsRef.current;
      const active = activeLyricRef.current;
      const cr = container.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      const offset = ar.top - cr.top - cr.height / 2 + ar.height / 2;
      container.scrollBy({ top: offset, behavior: 'smooth' });
    }
  }, [player.currentTime, showLyrics]);

  // ========== Media keys ==========
  useEffect(() => {
    if (!electron) return;
    const u1 = electron.onPlaybackToggle(() => player.togglePlay());
    const u2 = electron.onPlaybackNext(() => player.next());
    const u3 = electron.onPlaybackPrev(() => player.prev());
    return () => { u1?.(); u2?.(); u3?.(); };
  }, [player]);

  // ========== Init ==========
  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    if (!electron) return;
    try {
      const [ranksRes, plRes] = await Promise.allSettled([
        electron.kugouRankList?.() ?? Promise.resolve(null),
        electron.kugouRecommendSongs?.() ?? Promise.resolve(null),
      ]);
      if (ranksRes.status === 'fulfilled' && ranksRes.value) {
        const d = ranksRes.value?.data?.info?.[0]?.songs?.list || ranksRes.value?.data?.rank?.list || ranksRes.value?.data?.list || [];
        setRanks(Array.isArray(d) ? d.slice(0, 10) : []);
      }
      if (plRes.status === 'fulfilled' && plRes.value) {
        const d = plRes.value?.data?.list || plRes.value?.data?.lists || [];
        setPlaylists(Array.isArray(d) ? d.slice(0, 12) : []);
      }
    } catch {}
    // Check login
    try {
      const status = await electron.neteaseLoginStatus?.();
      if (status?.loggedIn) { setNeteaseLoggedIn(true); setUserInfo(status.user); }
    } catch {}
    electron.onAuthRestored?.((data: any) => {
      if (data.netease) { setNeteaseLoggedIn(true); setUserInfo(data.netease); }
    });
  };

  // ========== Search ==========
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !electron) return;
    setSearching(true);
    try {
      let songs: Song[] = [];
      if (searchProvider === 'kugou') {
        const r = await electron.kugouSearch(searchQuery, 1, 50);
        const list = r?.data?.lists || r?.data?.info || [];
        songs = list.map((s: any) => ({
          id: s.hash || s.FileHash || String(s.Audioid || s.id || Math.random()),
          title: s.SongName || s.songName || s.name || s.filename || '未知',
          artist: s.SingerName || s.singerName || s.singer?.name || s.artist || '未知',
          album: s.AlbumName || s.albumName || s.album?.name || '',
          cover: s.AlbumCover || s.albumCover || s.img || '',
          duration: (s.Duration || s.duration || s.time_length || 0) / (s.Duration > 1000 ? 1000 : 1),
          url: '', source: 'kugou' as const,
          hash: s.Hash || s.hash || s.FileHash,
          albumId: s.AlbumID || s.albumId || s.album_id,
        }));
      } else {
        const r = await electron.neteaseSearch(searchQuery, 50);
        songs = (r?.songs || []).map((s: any) => ({
          id: String(s.id), title: s.name || s.title || '未知',
          artist: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
          album: s.al?.name || s.al?.album?.name || '',
          cover: (s.al?.picUrl || '').replace(/^http:/, 'https:'),
          duration: (s.dt || 0) / 1000, url: '', source: 'netease' as const,
        }));
      }
      setSearchResults(songs);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [searchQuery, searchProvider, electron]);

  // ========== Playlist ==========
  const openPlaylist = async (listId: string, name: string) => {
    if (!electron?.kugouPlaylistTrackAllNew) return;
    setPanel('playlist'); setViewingPlaylistName(name); setViewingPlaylist([]);
    try {
      const r = await electron.kugouPlaylistTrackAllNew(listId, 1, 500);
      const list = r?.data?.list || r?.data?.songs || r?.data?.info || [];
      const songs: Song[] = list.map((s: any, i: number) => ({
        id: s.hash || s.FileHash || String(s.Audioid || s.id || i),
        title: s.SongName || s.songName || s.name || s.filename || '未知',
        artist: s.SingerName || s.singerName || s.singer?.name || s.artist || '未知',
        album: s.AlbumName || s.albumName || s.album?.name || '',
        cover: s.AlbumCover || s.albumCover || s.img || '',
        duration: (s.Duration || s.duration || s.time_length || 0) / (s.Duration > 1000 ? 1000 : 1),
        url: '', source: 'kugou' as const,
        hash: s.Hash || s.hash || s.FileHash,
        albumId: s.AlbumID || s.albumId || s.album_id,
      }));
      setViewingPlaylist(songs);
    } catch {}
  };

  const openRank = async (rankId: string, rankName: string) => {
    if (!electron?.kugouRankAudio) return;
    setPanel('playlist'); setViewingPlaylistName(rankName); setViewingPlaylist([]);
    try {
      const r = await electron.kugouRankAudio(rankId, 1);
      const list = r?.data?.songs?.list || r?.data?.list || r?.data?.info || [];
      const songs: Song[] = list.map((s: any, i: number) => ({
        id: s.hash || s.FileHash || String(s.Audioid || s.id || i),
        title: s.SongName || s.songName || s.name || s.filename || '未知',
        artist: s.SingerName || s.singerName || s.singer?.name || s.artist || '未知',
        album: s.AlbumName || s.albumName || s.album?.name || '',
        cover: s.AlbumCover || s.albumCover || s.img || '',
        duration: (s.Duration || s.duration || s.time_length || 0) / (s.Duration > 1000 ? 1000 : 1),
        url: '', source: 'kugou' as const,
        hash: s.Hash || s.hash || s.FileHash,
        albumId: s.AlbumID || s.albumId || s.album_id,
      }));
      setViewingPlaylist(songs);
    } catch {}
  };

  const playIndex = (songs: Song[], index: number) => player.playTrackAt(index, songs);
  const addToQueue = (songs: Song[]) => player.addSongsToQueue(songs);

  const importLocal = async () => {
    const files = await electron?.selectLocalFiles?.();
    if (files?.length) {
      const songs: Song[] = files.map((f: any) => ({ ...f, title: f.title || f.name }));
      player.queue.length === 0 ? playIndex(songs, 0) : addToQueue(songs);
    }
  };

  const loginNetease = async () => {
    const r = await electron?.neteaseOpenLoginWindow?.();
    if (!r?.ok) return;
    if (r.cookie) await electron?.saveNeteaseAuth?.('', '网易云用户', '', r.cookie);
    const status = await electron?.neteaseLoginStatus?.();
    if (status?.loggedIn) { setNeteaseLoggedIn(true); setUserInfo(status.user || { nickname: '网易云用户' }); }
  };

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  const activeLyricIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < player.lyrics.length; i++) {
      if (player.currentTime >= player.lyrics[i].time - 0.3) idx = i; else break;
    }
    return idx;
  }, [player.currentTime, player.lyrics]);

  const playModeIcon = player.playMode === 'single' ? '1' : player.playMode === 'shuffle' ? '⇄' : '↻';

  // ========== RENDER ==========
  return (
    <div className="fixed inset-0 overflow-hidden text-white select-none font-sans" style={{ background: bgColor, transition: 'background 1.2s ease' }}>
      {/* Album blur bg */}
      {player.currentSong?.cover && (
        <div className="absolute inset-0 z-0" style={{
          backgroundImage: `url(${player.currentSong.cover})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          filter: 'blur(120px) brightness(0.18) saturate(1.5)',
          transform: 'scale(1.4)', opacity: 0.85,
        }} />
      )}

      {/* Three.js canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 z-10 pointer-events-none" />

      {/* Gradient overlay */}
      <div className="absolute inset-0 z-20 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.45) 100%)' }} />

      {/* Titlebar */}
      <div className="absolute top-0 left-0 right-0 h-11 z-50 flex items-center justify-between px-4 title-bar-drag">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'linear-gradient(135deg, #00f5d4, #2442ff)' }} />
          <span className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">Aurora</span>
        </div>
        <div className="flex items-center gap-1.5 title-bar-no-drag">
          <button onClick={() => electron?.window?.minimize?.()} className="glass-btn w-[38px] h-[30px] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="6" width="8" height="1" fill="currentColor"/></svg>
          </button>
          <button onClick={() => electron?.window?.maximize?.()} className="glass-btn w-[38px] h-[30px] flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button onClick={() => electron?.window?.close?.()} className="glass-btn w-[38px] h-[30px] flex items-center justify-center hover:!bg-red-500/80">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="absolute inset-0 z-30 flex flex-col pt-11">
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-[220px] flex flex-col px-3 py-4 gap-0.5 border-r border-white/[0.04] bg-black/20 backdrop-blur-xl">
            <div className="text-[10px] font-bold tracking-[0.12em] text-white/25 uppercase px-3 mb-2">导航</div>
            {[
              { id: 'home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: '首页' },
              { id: 'search', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', label: '搜索' },
              { id: 'library', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', label: '我的音乐' },
            ].map((item) => {
              const isActive = panel === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setPanel(item.id as Panel); setViewingPlaylist([]); }}
                  className={`sidebar-tab ${isActive ? 'active' : ''}`}
                >
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d={item.icon} />
                  </svg>
                  <span>{item.label}</span>
                </button>
              );
            })}
            <div className="mt-4" />
            <button onClick={importLocal} className="sidebar-tab">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>
              <span>导入本地</span>
            </button>
            <div className="flex-1" />
            {/* Login */}
            <div className="px-2 py-3">
              {neteaseLoggedIn ? (
                <div className="flex items-center gap-2 px-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-xs font-bold">{(userInfo?.nickname || 'U')[0]}</div>
                  <div className="flex-1 min-w-0"><div className="text-xs font-medium truncate">{userInfo?.nickname || '已登录'}</div><div className="text-[10px] text-white/30">网易云</div></div>
                </div>
              ) : (
                <button onClick={loginNetease} className="login-btn w-full">登录网易云</button>
              )}
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Home panel */}
            {panel === 'home' && (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Hero */}
                <div className="relative min-h-[200px] rounded-[28px] overflow-hidden border border-white/[0.06] bg-gradient-to-br from-[#12151a]/70 to-[#08090d]/80 backdrop-blur-2xl p-8 flex items-center">
                  <div>
                    <div className="text-[10px] font-bold tracking-[0.14em] text-[#00f5d4]/70 uppercase mb-3">Welcome</div>
                    <div className="text-[42px] font-bold leading-none tracking-tight mb-3">AuroraBeat</div>
                    <div className="text-sm text-white/50 max-w-md">私人视觉音乐播放器 · 搜索或导入一首歌即可播放，登录后同步歌单</div>
                    <div className="flex gap-3 mt-5">
                      <button onClick={() => setPanel('search')} className="h-9 px-5 rounded-full bg-white text-black text-xs font-semibold hover:shadow-lg hover:shadow-white/20 transition-all">开始探索</button>
                      <button onClick={importLocal} className="h-9 px-5 rounded-full border border-white/15 text-white/70 text-xs font-medium hover:bg-white/5 hover:text-white transition-all">导入音乐</button>
                    </div>
                  </div>
                </div>

                {/* Playlists */}
                {playlists.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-[13px] font-bold text-white/80 tracking-[0.04em]">推荐歌单</div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {playlists.slice(0, 6).map((pl: any, i: number) => {
                        const id = pl.specialid || pl.listid || pl.id;
                        const name = pl.specialname || pl.name || pl.title || '歌单';
                        const img = pl.img || pl.cover || pl.pic || '';
                        return (
                          <button key={i} onClick={() => id && openPlaylist(String(id), name)} className="home-card group">
                            <div className="home-card-label">Playlist</div>
                            <div className="home-card-title truncate">{name}</div>
                            <div className="home-card-sub">点击查看全部歌曲</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Ranks */}
                {ranks.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-[13px] font-bold text-white/80 tracking-[0.04em]">音乐榜单</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {ranks.slice(0, 6).map((rank: any, i: number) => {
                        const id = rank.rankid || rank.id || rank.bannerurl?.match(/rank\/(\d+)/)?.[1];
                        const name = rank.rankname || rank.name || '榜单';
                        const img = rank.imgurl || rank.cover || rank.bannerurl || '';
                        return (
                          <button
                            key={i}
                            onClick={() => id && openRank(String(id), name)}
                            className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] hover:border-[#00f5d4]/20 transition-all text-left"
                          >
                            <div className="w-14 h-14 rounded-xl flex-shrink-0 bg-cover bg-center" style={{ backgroundImage: img ? `url(${img})` : 'linear-gradient(135deg, #00f5d433, #2442ff33)' }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{name}</div>
                              <div className="text-[11px] text-white/40 mt-1">点击查看</div>
                            </div>
                            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/20"><path d="M5 2l7 5-7 5"/></svg>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Playlist view */}
            {panel === 'playlist' && viewingPlaylist.length > 0 && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-4 px-6 py-4 border-b border-white/[0.04]">
                  <button onClick={() => setPanel('home')} className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all">←</button>
                  <h2 className="text-lg font-bold">{viewingPlaylistName}</h2>
                  <span className="text-xs text-white/30">{viewingPlaylist.length} 首</span>
                  <button onClick={() => playIndex(viewingPlaylist, 0)} className="ml-auto px-5 py-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-sm hover:shadow-lg hover:shadow-cyan-500/25 transition-all">播放全部</button>
                  <button onClick={() => addToQueue(viewingPlaylist)} className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium transition-all">加入队列</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {viewingPlaylist.map((song, i) => {
                    const isCurrent = player.currentSong?.id === song.id;
                    return (
                      <div key={song.id + i} className={`queue-item ${isCurrent ? 'current' : ''} px-6`} onClick={() => playIndex(viewingPlaylist, i)}>
                        <div className={`w-5 text-center text-xs ${isCurrent ? 'text-[#00f5d4]' : 'text-white/20'}`}>{isCurrent && player.isPlaying ? '♪' : i + 1}</div>
                        <div className="flex-1 min-w-0"><div className={`text-sm truncate ${isCurrent ? 'text-[#00f5d4] font-medium' : 'text-white/85'}`}>{song.title}</div></div>
                        <div className="w-36 text-xs text-white/35 truncate">{song.artist}</div>
                        <div className="w-12 text-xs text-white/25 text-right">{formatTime(song.duration)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Search panel */}
            {panel === 'search' && (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                <div className="flex gap-3 mb-4">
                  <div className="flex-1 search-box">
                    <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/25 mr-3 flex-shrink-0" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input
                      className="search-input"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder="搜索歌曲、歌手..."
                    />
                  </div>
                  <div className="flex rounded-full bg-white/[0.04] border border-white/[0.08] p-1">
                    {(['kugou', 'netease'] as Provider[]).map((p) => (
                      <button key={p} onClick={() => setSearchProvider(p)}
                        className={`px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.04em] transition-all ${searchProvider === p ? 'bg-white/[0.12] text-white' : 'text-white/40 hover:text-white/70'}`}>
                        {p === 'kugou' ? '酷狗' : '网易云'}
                      </button>
                    ))}
                  </div>
                  <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
                    className="px-6 py-3 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-sm hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                    {searching ? '搜索中' : '搜索'}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {searchResults.length === 0 && !searching && (
                    <div className="flex flex-col items-center justify-center h-60 text-white/25">
                      <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                      <div className="text-sm">输入关键词搜索音乐</div>
                    </div>
                  )}
                  {searchResults.map((song, i) => {
                    const isCurrent = player.currentSong?.id === song.id;
                    return (
                      <div key={song.id + i} className="search-result-item" onClick={() => player.playSong(song, searchResults)}>
                        {song.cover ? (
                          <div className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${song.cover})` }} />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center flex-shrink-0 text-white/20">♪</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className={`text-[13px] font-medium truncate ${isCurrent ? 'text-[#00f5d4]' : 'text-white/90'}`}>{song.title}</div>
                          <div className="text-[11px] text-white/35 truncate">{song.artist}</div>
                        </div>
                        <div className="text-[11px] text-white/25 w-12 text-right">{formatTime(song.duration)}</div>
                        <div className="text-[9px] px-2 py-0.5 rounded-full bg-white/[0.05] text-white/25 border border-white/[0.06]">{song.source === 'kugou' ? '酷狗' : '网易云'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Library panel */}
            {panel === 'library' && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="text-[13px] font-bold text-white/80 mb-4">播放列表</div>
                {player.queue.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-80 text-white/25">
                    <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    <div className="text-sm">暂无播放记录</div>
                    <div className="text-xs mt-2 text-white/15">从首页或搜索开始播放音乐</div>
                  </div>
                ) : (
                  player.queue.map((song, i) => {
                    const isCurrent = i === player.currentIndex;
                    return (
                      <div key={song.id + i} className={`queue-item ${isCurrent ? 'current' : ''}`} onClick={() => player.playTrackAt(i)}>
                        <div className={`w-5 text-center text-xs ${isCurrent ? 'text-[#00f5d4]' : 'text-white/20'}`}>{isCurrent && player.isPlaying ? '♪' : i + 1}</div>
                        {song.cover && <div className="w-9 h-9 rounded-lg bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${song.cover})` }} />}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm truncate ${isCurrent ? 'text-[#00f5d4] font-medium' : 'text-white/85'}`}>{song.title}</div>
                          <div className="text-[11px] text-white/35 truncate">{song.artist}</div>
                        </div>
                        <div className="text-[11px] text-white/25 w-12 text-right">{formatTime(song.duration)}</div>
                        <button onClick={(e) => { e.stopPropagation(); player.removeFromQueue(i); }} className="w-6 h-6 rounded-lg text-white/15 hover:text-red-400 hover:bg-red-500/10 transition-all flex items-center justify-center text-sm">×</button>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Center lyrics overlay */}
            {player.currentSong && showLyrics && panel === 'home' && (
              <div className="absolute left-0 right-0 top-0 bottom-24 flex items-center justify-center pointer-events-none">
                <div ref={lyricsRef} className="w-full max-w-2xl h-80 overflow-y-auto px-8 pointer-events-auto" style={{ scrollbarWidth: 'none' }}>
                  <div className="space-y-3 py-28">
                    {player.lyricsLoading && player.lyrics.length === 0 && (
                      <div className="text-center text-white/25 text-sm py-8">加载歌词中...</div>
                    )}
                    {player.lyrics.length === 0 && !player.lyricsLoading && (
                      <div className="text-center text-white/15 text-sm py-8">暂无歌词</div>
                    )}
                    {player.lyrics.map((line, i) => {
                      const isActive = i === activeLyricIdx;
                      return (
                        <div key={i} ref={isActive ? activeLyricRef : null}
                          className={`lyrics-line ${isActive ? 'active' : i < activeLyricIdx ? 'past' : 'future'}`}>
                          {line.text || '♪'}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!player.currentSong && panel === 'home' && (
              <div className="absolute left-0 right-0 top-0 bottom-24 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-5xl mb-5 opacity-30">🎧</div>
                  <div className="text-xl font-light text-white/40">选择一首歌开始播放</div>
                  <div className="text-sm text-white/25 mt-2">从首页浏览歌单，或使用搜索找到你喜欢的音乐</div>
                </div>
              </div>
            )}
          </div>

          {/* Queue panel */}
          {showQueue && (
            <div className="w-[300px] border-l border-white/[0.04] bg-black/30 backdrop-blur-xl flex flex-col">
              <div className="p-4 flex items-center justify-between border-b border-white/[0.04]">
                <div className="text-sm font-semibold">播放队列 ({player.queue.length})</div>
                <button onClick={() => setShowQueue(false)} className="w-7 h-7 rounded-lg hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center">×</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {player.queue.map((song, i) => {
                  const isCurrent = i === player.currentIndex;
                  return (
                    <div key={song.id + i} className={`queue-item ${isCurrent ? 'current' : ''}`} onClick={() => player.playTrackAt(i)}>
                      <div className={`w-5 text-center text-xs ${isCurrent ? 'text-[#00f5d4]' : 'text-white/20'}`}>{isCurrent && player.isPlaying ? '♪' : i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs truncate ${isCurrent ? 'text-[#00f5d4] font-medium' : 'text-white/75'}`}>{song.title}</div>
                        <div className="text-[10px] text-white/25 truncate">{song.artist}</div>
                      </div>
                    </div>
                  );
                })}
                {player.queue.length === 0 && <div className="text-center text-white/15 text-xs py-12">队列为空</div>}
              </div>
            </div>
          )}
        </div>

        {/* Bottom control bar */}
        <div className="h-24 px-6 border-t border-white/[0.04] bg-black/40 backdrop-blur-xl flex items-center gap-6">
          {/* Song info */}
          <div className="flex items-center gap-4 w-[260px] flex-shrink-0">
            {player.currentSong?.cover ? (
              <div className="w-14 h-14 rounded-xl bg-cover bg-center flex-shrink-0 shadow-lg" style={{ backgroundImage: `url(${player.currentSong.cover})` }} />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-white/[0.04] flex items-center justify-center text-2xl flex-shrink-0">🎵</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{player.currentSong?.title || '未播放'}</div>
              <div className="text-[11px] text-white/35 truncate">{player.currentSong?.artist || '选择一首歌开始'}</div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-1 flex flex-col items-center gap-2 max-w-2xl mx-auto">
            <div className="flex items-center gap-3">
              <button onClick={player.togglePlayMode} className="control-btn" title={player.playMode === 'single' ? '单曲循环' : player.playMode === 'shuffle' ? '随机播放' : '列表循环'}>
                <span className="text-[13px] font-bold">{playModeIcon}</span>
              </button>
              <button onClick={player.prev} className="control-btn">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
              </button>
              <button onClick={player.togglePlay} className="play-btn">
                {player.isLoading ? (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : player.isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>
              <button onClick={player.next} className="control-btn">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
              </button>
              <button onClick={() => setShowLyrics(!showLyrics)} className={`control-btn ${showLyrics ? 'active' : ''}`} title="歌词">
                <span className="text-[14px] font-bold">词</span>
              </button>
            </div>

            {/* Progress */}
            <div className="flex items-center gap-3 w-full">
              <span className="text-[10px] text-white/35 w-10 text-right font-mono">{formatTime(player.currentTime)}</span>
              <div className="flex-1 progress-track" onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                player.seekRatio((e.clientX - rect.left) / rect.width);
              }}>
                <div className="progress-fill" style={{ width: `${player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0}%` }} />
              </div>
              <span className="text-[10px] text-white/35 w-10 font-mono">{formatTime(player.duration)}</span>
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3 w-[260px] justify-end flex-shrink-0">
            <div className="flex items-center gap-2">
              <button className="control-btn" onClick={() => player.setVolume(player.volume === 0 ? 0.8 : 0)}>
                {player.volume === 0 ? '🔇' : player.volume < 0.5 ? '🔉' : '🔊'}
              </button>
              <input type="range" min="0" max="1" step="0.01" value={player.volume} onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                className="w-20 accent-[#00f5d4] opacity-50 hover:opacity-100 transition-opacity" />
            </div>
            <button onClick={() => setShowQueue(!showQueue)} className={`control-btn ${showQueue ? 'active' : ''}`}>
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;