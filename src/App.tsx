import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayer } from './hooks/usePlayer';
import type { Song, NeteaseUser } from './types';
import * as THREE from 'three';
import { gsap } from 'gsap';

type Panel = 'home' | 'search' | 'library' | 'playlist';

// ====================================================================
// Three.js 封面粒子系统 — 对标 Mineradio ShaderMaterial 粒子
// 粒子网格映射专辑封面，随音频频谱波动
// ====================================================================
function useVisualEngine(canvasRef: React.RefObject<HTMLCanvasElement>, player: any) {
  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 6.6);
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 点纹理
    const makeDotTexture = () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const ctx = cv.getContext('2d')!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
      g.addColorStop(0.00, 'rgba(255,255,255,0.96)');
      g.addColorStop(0.42, 'rgba(255,255,255,0.78)');
      g.addColorStop(0.72, 'rgba(255,255,255,0.22)');
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      return tex;
    };
    const dotTexture = makeDotTexture();

    // 封面纹理
    const coverTex = new THREE.Texture();
    coverTex.minFilter = THREE.LinearFilter; coverTex.magFilter = THREE.LinearFilter;

    // 粒子几何 — grid×grid 平面网格映射封面UV
    const GRID = 128;
    const PCOUNT = GRID * GRID;
    const PLANE_SIZE = 4.8;
    const positions = new Float32Array(PCOUNT * 3);
    const uvs = new Float32Array(PCOUNT * 2);
    const rand = new Float32Array(PCOUNT);
    for (let i = 0; i < PCOUNT; i++) {
      const gx = i % GRID, gy = Math.floor(i / GRID);
      const u = (gx + 0.5) / GRID, v = (gy + 0.5) / GRID;
      const px = gx / (GRID - 1), py = gy / (GRID - 1);
      positions[i * 3] = (px - 0.5) * PLANE_SIZE;
      positions[i * 3 + 1] = (py - 0.5) * PLANE_SIZE;
      positions[i * 3 + 2] = 0;
      uvs[i * 2] = u; uvs[i * 2 + 1] = v;
      rand[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));

    // Uniforms
    const uniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
      uCoverTex: { value: coverTex },
      uHasCover: { value: 0 },
      uDotTex: { value: dotTexture },
      uAlpha: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() },
      uTintColor: { value: new THREE.Color('#9db8cf') },
      uTintStrength: { value: 0 },
    };

    // 顶点 Shader — 粒子随音频波动 + 封面映射
    const vertexShader = `
      uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uPixel, uAlpha;
      uniform sampler2D uCoverTex;
      uniform float uHasCover;
      attribute vec2 aUv;
      attribute float aRand;
      varying float vBright;
      varying float vEdgeBoost;
      varying vec3 vColor;

      void main() {
        vec3 pos = position;
        float t = uTime;
        float r1 = aRand;
        float r2 = fract(r1 * 7.13);
        float r3 = fract(r2 * 11.91);

        // 封面颜色采样
        vec3 coverCol = texture2D(uCoverTex, aUv).rgb;
        vColor = mix(vec3(0.6, 0.75, 0.85), coverCol, uHasCover);

        // Z 位移: 低频驱动大波 + 中频细节 + 高频闪烁
        float bassDisp = sin(pos.x * 1.8 + t * 0.6) * cos(pos.y * 1.6 + t * 0.4) * uBass * 1.2;
        float midDisp = sin(pos.x * 4.0 + t * 1.2) * cos(pos.y * 3.5 + t * 0.9) * uMid * 0.5;
        float trebleJ = sin(pos.x * 8.0 + t * 2.0) * cos(pos.y * 7.0 + t * 1.6) * uTreble * 0.25;
        float bassBreath = sin(t * 0.3 + r1 * 6.28) * uBass * 0.15;
        pos.z = bassDisp + midDisp + trebleJ + bassBreath;

        // 节拍冲击: 粒子向外弹
        float beatKick = uBeat * (0.3 + r2 * 0.4);
        pos.x += sin(r1 * 6.28 + t) * beatKick;
        pos.y += cos(r2 * 6.28 + t) * beatKick;

        // 边缘亮度提升
        float edgeDist = length(aUv - 0.5);
        vEdgeBoost = smoothstep(0.25, 0.5, edgeDist) * uEnergy;
        vBright = 0.55 + uBass * 0.35 + uEnergy * 0.15 + r3 * 0.1;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = (2.0 + uBass * 3.0 + uEnergy * 1.5) * uPixel * (300.0 / -mvPos.z);
      }
    `;

    // 片元 Shader
    const fragmentShader = `
      uniform sampler2D uDotTex;
      uniform float uAlpha;
      varying float vBright;
      varying float vEdgeBoost;
      varying vec3 vColor;

      void main() {
        vec4 tex = texture2D(uDotTex, gl_PointCoord);
        if (tex.a < 0.02) discard;
        vec3 col = vColor * vBright;
        col = mix(col, col * 1.3 + vec3(0.05), vEdgeBoost * 0.35);
        gl_FragColor = vec4(col, tex.a * uAlpha);
      }
    `;

    // Bloom 粒子（加法混合）
    const bloomFragmentShader = `
      uniform sampler2D uDotTex;
      uniform float uAlpha;
      varying float vBright;
      varying float vEdgeBoost;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(uDotTex, gl_PointCoord);
        if (tex.a < 0.02) discard;
        vec3 col = vColor * vBright * 1.6;
        gl_FragColor = vec4(col, tex.a * uAlpha * 0.45);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    const bloomMaterial = new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader: bloomFragmentShader,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geo, material);
    particles.frustumCulled = false; particles.renderOrder = 1;
    scene.add(particles);
    const bloomParticles = new THREE.Points(geo, bloomMaterial);
    bloomParticles.frustumCulled = false; bloomParticles.renderOrder = 0;
    scene.add(bloomParticles);

    // 浮空背景粒子
    const FLOAT_COUNT = 500;
    const floatPos = new Float32Array(FLOAT_COUNT * 3);
    const floatCols = new Float32Array(FLOAT_COUNT * 3);
    for (let i = 0; i < FLOAT_COUNT; i++) {
      const r = 10 + Math.random() * 25;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      floatPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      floatPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      floatPos[i * 3 + 2] = r * Math.cos(phi) - 10;
      const c = new THREE.Color().setHSL(0.45 + Math.random() * 0.25, 0.6, 0.4 + Math.random() * 0.3);
      floatCols[i * 3] = c.r; floatCols[i * 3 + 1] = c.g; floatCols[i * 3 + 2] = c.b;
    }
    const floatGeo = new THREE.BufferGeometry();
    floatGeo.setAttribute('position', new THREE.BufferAttribute(floatPos, 3));
    floatGeo.setAttribute('color', new THREE.BufferAttribute(floatCols, 3));
    const floatMat = new THREE.PointsMaterial({
      size: 0.08, vertexColors: true, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, map: dotTexture,
    });
    const floatParticles = new THREE.Points(floatGeo, floatMat);
    scene.add(floatParticles);

    // fade in
    gsap.to(uniforms.uAlpha, { value: 1, duration: 1.2, ease: 'power2.out' });

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let beatAnalyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let beatData: Uint8Array | null = null;
    let smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
    let beatPulse = 0;
    let prevTime = performance.now();

    const setupAnalysers = () => {
      const a = player.getAnalyser();
      const ba = player.getBeatAnalyser();
      if (a && !analyser) { analyser = a; freqData = new Uint8Array(a.frequencyBinCount); }
      if (ba && !beatAnalyser) { beatAnalyser = ba; beatData = new Uint8Array(ba.frequencyBinCount); }
    };
    player.setAnalyserReadyHandler?.(setupAnalysers);
    setTimeout(setupAnalysers, 500);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - prevTime) / 1000, 0.05);
      prevTime = now;
      uniforms.uTime.value += dt;

      if (analyser && freqData && beatAnalyser && beatData && player.isPlaying) {
        analyser.getByteFrequencyData(freqData as any);
        beatAnalyser.getByteFrequencyData(beatData as any);
        const len = freqData.length;
        // 分频段 — Mineradio同款 kick/vocal/mid/treble
        const kickEnd = 7;  // 60-150Hz
        const vocalEnd = Math.min(len, 140);  // 200-3000Hz
        const midEnd = Math.min(len, 280);  // 3-6kHz
        let bKick = 0, mInst = 0, tHigh = 0, voc = 0;
        for (let i = 0; i < kickEnd; i++) bKick += freqData[i] / 255;
        for (let i = kickEnd; i < vocalEnd; i++) voc += freqData[i] / 255;
        for (let i = vocalEnd; i < midEnd; i++) mInst += freqData[i] / 255;
        for (let i = midEnd; i < len; i++) tHigh += freqData[i] / 255;
        bKick /= kickEnd; voc /= (vocalEnd - kickEnd);
        mInst /= Math.max(1, midEnd - vocalEnd); tHigh /= Math.max(1, len - midEnd);

        // 平滑包络
        const env = (cur: number, target: number, up: number, down: number) =>
          cur + (target > cur ? up : down) * (target - cur);
        smoothBass = env(smoothBass, Math.min(0.82, bKick * 0.78), 0.28, 0.075);
        smoothMid = env(smoothMid, Math.min(0.68, mInst * 0.64), 0.18, 0.06);
        smoothTreb = env(smoothTreb, Math.min(0.56, tHigh * 0.54), 0.18, 0.055);
        smoothEnergy = env(smoothEnergy, Math.min(0.72, (bKick + mInst + tHigh) / 3), 0.16, 0.055);

        // 节拍检测: 低频突变
        const bassOnset = Math.max(0, bKick - smoothBass * 0.9);
        if (bassOnset > 0.075 && bKick > 0.32) {
          beatPulse = Math.max(beatPulse, Math.min(0.15, bassOnset * 0.2));
        }
        beatPulse *= Math.pow(0.36, dt);

        uniforms.uBass.value = smoothBass;
        uniforms.uMid.value = smoothMid;
        uniforms.uTreble.value = smoothTreb;
        uniforms.uBeat.value = beatPulse;
        uniforms.uEnergy.value = smoothEnergy;

        // 节拍驱动相机微抖
        const shake = beatPulse * 0.3;
        camera.position.x = Math.sin(now * 0.001) * shake;
        camera.position.y = Math.cos(now * 0.0007) * shake;
      } else {
        // 衰减
        smoothBass *= 0.91; smoothMid *= 0.91; smoothTreb *= 0.91; smoothEnergy *= 0.91; beatPulse *= 0.82;
        uniforms.uBass.value = smoothBass;
        uniforms.uMid.value = smoothMid;
        uniforms.uTreble.value = smoothTreb;
        uniforms.uBeat.value = beatPulse;
        uniforms.uEnergy.value = smoothEnergy;
      }

      // 粒子旋转
      particles.rotation.y += dt * 0.05;
      particles.rotation.x += dt * 0.02;
      bloomParticles.rotation.copy(particles.rotation);
      floatParticles.rotation.y += dt * 0.01;
      floatMat.opacity = 0.15 + smoothEnergy * 0.25;

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

    // 封面更新函数
    const updateCover = (coverUrl: string) => {
      if (!coverUrl) { uniforms.uHasCover.value = 0; return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const size = 256;
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const ctx = cv.getContext('2d')!;
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        coverTex.image = cv;
        coverTex.needsUpdate = true;
        uniforms.uHasCover.value = 1;
        // 提取主色调
        try {
          const d = ctx.getImageData(0, 0, size, size).data;
          let best = { score: -1, r: 143, g: 233, b: 255 };
          for (let y = 0; y < size; y += 8) {
            for (let x = 0; x < size; x += 8) {
              const di = (y * size + x) * 4;
              const r = d[di], g = d[di + 1], b = d[di + 2];
              const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
              const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
              const score = chroma * 1.6 + (0.5 - Math.abs(lum - 0.5)) * 0.45;
              if (lum > 0.08 && lum < 0.92 && score > best.score) best = { score, r, g, b };
            }
          }
          uniforms.uTintColor.value.setRGB(best.r / 255, best.g / 255, best.b / 255);
          uniforms.uTintStrength.value = 0.5;
        } catch {}
      };
      img.onerror = () => { uniforms.uHasCover.value = 0; };
      img.src = coverUrl;
    };

    // 监听封面变化
    const coverUrl = player.currentSong?.cover;
    if (coverUrl) updateCover(coverUrl);
    (window as any).__updateCover = updateCover;

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      geo.dispose(); material.dispose(); bloomMaterial.dispose();
      floatGeo.dispose(); floatMat.dispose(); coverTex.dispose(); dotTexture.dispose();
      renderer.dispose();
    };
  }, []);

  // 封面变化时更新粒子
  useEffect(() => {
    const coverUrl = player.currentSong?.cover;
    if (coverUrl && (window as any).__updateCover) {
      (window as any).__updateCover(coverUrl);
    }
  }, [player.currentSong?.cover]);
}

// ====================================================================
// 主应用
// ====================================================================
const App: React.FC = () => {
  const player = usePlayer();
  const [panel, setPanel] = useState<Panel>('home');
  const [showQueue, setShowQueue] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);
  const [viewingTracks, setViewingTracks] = useState<Song[]>([]);
  const [viewingName, setViewingName] = useState('');
  const [neteaseUser, setNeteaseUser] = useState<NeteaseUser | null>(null);
  const [serverPort, setServerPort] = useState(0);
  const [bgColor, setBgColor] = useState('#08090B');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLDivElement>(null);
  const searchSeqRef = useRef(0);
  const electron = (window as any).electronAPI;

  useVisualEngine(canvasRef, player);

  // 获取服务器端口
  useEffect(() => {
    electron?.getServerPort?.().then((port: number) => {
      setServerPort(port);
      player.setServerPort?.(port);
    });
  }, []);

  const apiBase = `http://127.0.0.1:${serverPort}`;

  // 封面色提取 → 背景色
  useEffect(() => {
    if (!player.currentSong?.cover) { setBgColor('#08090B'); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d'); if (!ctx) return;
        c.width = 50; c.height = 50; ctx.drawImage(img, 0, 0, 50, 50);
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

  // 歌词滚动
  useEffect(() => {
    if (activeLyricRef.current && lyricsRef.current) {
      const container = lyricsRef.current;
      const active = activeLyricRef.current;
      const cr = container.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      const offset = ar.top - cr.top - cr.height / 2 + ar.height / 2;
      gsap.to(container, { scrollTop: container.scrollTop + offset, duration: 0.4, ease: 'power2.out' });
    }
  }, [player.currentTime]);

  // 媒体键
  useEffect(() => {
    if (!electron) return;
    const u1 = electron.onPlaybackToggle(() => player.togglePlay());
    const u2 = electron.onPlaybackNext(() => player.next());
    const u3 = electron.onPlaybackPrev(() => player.prev());
    return () => { u1?.(); u2?.(); u3?.(); };
  }, []);

  // 初始化
  useEffect(() => {
    if (!serverPort) return;
    checkLogin(); loadHome();
  }, [serverPort]);

  const checkLogin = async () => {
    try {
      const res = await fetch(`${apiBase}/api/login/status`);
      const data = await res.json();
      if (data.loggedIn) {
        setNeteaseUser({ userId: data.userId, nickname: data.nickname, avatar: data.avatar });
        const plRes = await fetch(`${apiBase}/api/user/playlists?limit=50`);
        const plData = await plRes.json();
        if (plData.loggedIn) setUserPlaylists(plData.playlists || []);
      }
    } catch {}
  };

  const loadHome = async () => {
    try {
      const res = await fetch(`${apiBase}/api/discover/home`);
      const data = await res.json();
      setPlaylists(data.playlists || []);
    } catch {}
  };

  // 搜索（带竞态节流 — Mineradio同款 searchRequestSeq）
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !serverPort) return;
    const seq = ++searchSeqRef.current;
    setSearching(true);
    try {
      const res = await fetch(`${apiBase}/api/search?keywords=${encodeURIComponent(searchQuery)}&limit=30`);
      if (seq !== searchSeqRef.current) return;
      const data = await res.json();
      const songs: Song[] = (data.songs || []).map((s: any) => ({
        id: String(s.id), title: s.name || '未知', artist: s.artist || '未知',
        album: s.album || '', cover: s.cover || '', duration: (s.duration || 0) / 1000,
        url: '', source: 'netease' as const,
      }));
      setSearchResults(songs);
    } catch { if (seq === searchSeqRef.current) setSearchResults([]); }
    finally { if (seq === searchSeqRef.current) setSearching(false); }
  }, [searchQuery, serverPort]);

  const openPlaylist = async (id: string, name: string) => {
    setPanel('playlist'); setViewingName(name); setViewingTracks([]);
    try {
      const res = await fetch(`${apiBase}/api/playlist/tracks?id=${id}`);
      const data = await res.json();
      const songs: Song[] = (data.tracks || []).map((s: any) => ({
        id: String(s.id), title: s.name || '未知', artist: s.artist || '未知',
        album: s.album || '', cover: s.cover || '', duration: (s.duration || 0) / 1000,
        url: '', source: 'netease' as const,
      }));
      setViewingTracks(songs);
    } catch {}
  };

  const loginNetease = async () => {
    const result = await electron?.neteaseOpenLogin?.();
    if (!result?.ok) return;
    await new Promise(r => setTimeout(r, 300));
    await checkLogin(); await loadHome();
  };

  const logoutNetease = async () => {
    await electron?.neteaseClearLogin?.();
    setNeteaseUser(null); setUserPlaylists([]);
    await loadHome();
  };

  const importLocal = async () => {
    const files = await electron?.selectLocalFiles?.();
    if (files?.length) {
      const songs: Song[] = files.map((f: any) => ({ ...f, title: f.title || f.name }));
      player.queue.length === 0 ? player.playTrackAt(0, songs) : player.addSongsToQueue(songs);
    }
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

  // GSAP: 列表项入场动画
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current) {
      const items = listRef.current.querySelectorAll('.queue-item, .search-result-item');
      gsap.fromTo(items, { autoAlpha: 0, y: 8, x: -6 }, {
        autoAlpha: 1, y: 0, x: 0, duration: 0.22, stagger: 0.012, ease: 'power2.out', force3D: true,
      });
    }
  }, [searchResults, viewingTracks, panel, player.queue]);

  return (
    <div className="fixed inset-0 overflow-hidden text-white select-none font-sans" style={{ background: bgColor, transition: 'background 1.2s ease' }}>
      {/* 专辑模糊背景 — Mineradio同款 #album-bg */}
      {player.currentSong?.cover && (
        <div className={`album-bg visible`} style={{ backgroundImage: `url(${player.currentSong.cover})` }} />
      )}

      {/* Three.js 粒子画布 */}
      <canvas ref={canvasRef} className="absolute inset-0 z-10 pointer-events-none" />

      {/* 渐变遮罩 */}
      <div className="absolute inset-0 z-20 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.45) 100%)' }} />

      {/* 标题栏 */}
      <div className="absolute top-0 left-0 right-0 h-11 z-50 flex items-center justify-between px-4" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'linear-gradient(135deg, #00f5d4, #2442ff)' }} />
          <span className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">AuroraBeat</span>
        </div>
        <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button onClick={() => electron?.minimize?.()} className="glass-btn w-[38px] h-[30px] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="6" width="8" height="1" fill="currentColor"/></svg>
          </button>
          <button onClick={() => electron?.maximize?.()} className="glass-btn w-[38px] h-[30px] flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button onClick={() => electron?.close?.()} className="glass-btn w-[38px] h-[30px] flex items-center justify-center hover:!bg-red-500/80">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>

      {/* 主内容 */}
      <div className="absolute inset-0 z-30 flex flex-col pt-11">
        <div className="flex-1 flex overflow-hidden">
          {/* 侧边栏 */}
          <div className="w-[220px] flex flex-col px-3 py-4 gap-0.5 border-r border-white/[0.04] bg-black/20 backdrop-blur-xl">
            <div className="text-[10px] font-bold tracking-[0.12em] text-white/25 uppercase px-3 mb-2">导航</div>
            {[
              { id: 'home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: '首页' },
              { id: 'search', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', label: '搜索' },
              { id: 'library', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', label: '我的音乐' },
            ].map((item) => (
              <button key={item.id} onClick={() => { setPanel(item.id as Panel); setViewingTracks([]); }}
                className={`sidebar-tab ${panel === item.id ? 'active' : ''}`}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d={item.icon} /></svg>
                <span>{item.label}</span>
              </button>
            ))}

            {userPlaylists.length > 0 && (
              <>
                <div className="text-[10px] font-bold tracking-[0.12em] text-white/25 uppercase px-3 mt-4 mb-2">我的歌单</div>
                {userPlaylists.slice(0, 15).map((pl: any) => (
                  <button key={pl.id} onClick={() => openPlaylist(String(pl.id), pl.name)} className="sidebar-tab">
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13M9 9l12-2" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                    <span className="truncate">{pl.name}</span>
                  </button>
                ))}
              </>
            )}

            <div className="flex-1" />
            <button onClick={importLocal} className="sidebar-tab">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>
              <span>导入本地</span>
            </button>

            <div className="px-2 py-3">
              {neteaseUser ? (
                <div className="flex items-center gap-2 px-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-xs font-bold">{(neteaseUser.nickname || 'U')[0]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{neteaseUser.nickname}</div>
                    <button onClick={logoutNetease} className="text-[10px] text-white/30 hover:text-red-400">退出登录</button>
                  </div>
                </div>
              ) : (
                <button onClick={loginNetease} className="login-btn w-full">登录网易云</button>
              )}
            </div>
          </div>

          {/* 内容区 */}
          <div className="flex-1 flex flex-col overflow-hidden relative" ref={listRef}>
            {/* 首页 */}
            {panel === 'home' && (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="relative min-h-[200px] rounded-[28px] overflow-hidden border border-white/[0.06] bg-gradient-to-br from-[#12151a]/70 to-[#08090d]/80 backdrop-blur-2xl p-8 flex items-center">
                  <div>
                    <div className="text-[10px] font-bold tracking-[0.14em] text-[#00f5d4]/70 uppercase mb-3">Welcome</div>
                    <div className="text-[42px] font-bold leading-none tracking-tight mb-3">AuroraBeat</div>
                    <div className="text-sm text-white/50 max-w-md">沉浸式音乐播放器 · 搜索或导入一首歌即可播放</div>
                    <div className="flex gap-3 mt-5">
                      <button onClick={() => setPanel('search')} className="h-9 px-5 rounded-full bg-white text-black text-xs font-semibold hover:shadow-lg hover:shadow-white/20 transition-all">开始探索</button>
                      <button onClick={importLocal} className="h-9 px-5 rounded-full border border-white/15 text-white/70 text-xs font-medium hover:bg-white/5 hover:text-white transition-all">导入音乐</button>
                    </div>
                  </div>
                </div>
                {playlists.length > 0 && (
                  <div>
                    <div className="text-[13px] font-bold text-white/80 tracking-[0.04em] mb-4">推荐歌单</div>
                    <div className="grid grid-cols-3 gap-3">
                      {playlists.map((pl: any, i: number) => (
                        <button key={i} onClick={() => pl.id && openPlaylist(String(pl.id), pl.name)} className="home-card group">
                          <div className="home-card-label">Playlist</div>
                          <div className="home-card-title truncate">{pl.name}</div>
                          <div className="home-card-sub">{pl.trackCount || 0} 首</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 歌单详情 */}
            {panel === 'playlist' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center gap-4 px-6 py-4 border-b border-white/[0.04]">
                  <button onClick={() => setPanel('home')} className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all">←</button>
                  <h2 className="text-lg font-bold">{viewingName}</h2>
                  <span className="text-xs text-white/30">{viewingTracks.length} 首</span>
                  {viewingTracks.length > 0 && (
                    <>
                      <button onClick={() => player.playTrackAt(0, viewingTracks)} className="ml-auto px-5 py-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-sm hover:shadow-lg hover:shadow-cyan-500/25 transition-all">播放全部</button>
                      <button onClick={() => player.addSongsToQueue(viewingTracks)} className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium transition-all">加入队列</button>
                    </>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {viewingTracks.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-white/20 text-sm">加载中...</div>
                  ) : (
                    viewingTracks.map((song, i) => {
                      const isCurrent = player.currentSong?.id === song.id;
                      return (
                        <div key={song.id + i} className={`queue-item ${isCurrent ? 'current' : ''} px-6`} onClick={() => player.playTrackAt(i, viewingTracks)}>
                          <div className={`w-5 text-center text-xs ${isCurrent ? 'text-[#00f5d4]' : 'text-white/20'}`}>{isCurrent && player.isPlaying ? '♪' : i + 1}</div>
                          <div className="flex-1 min-w-0"><div className={`text-sm truncate ${isCurrent ? 'text-[#00f5d4] font-medium' : 'text-white/85'}`}>{song.title}</div></div>
                          <div className="w-36 text-xs text-white/35 truncate">{song.artist}</div>
                          <div className="w-12 text-xs text-white/25 text-right">{formatTime(song.duration)}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* 搜索 */}
            {panel === 'search' && (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                <div className="flex gap-3 mb-4">
                  <div className="flex-1 search-box">
                    <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/25 mr-3 flex-shrink-0" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input className="search-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="搜索歌曲、歌手..." />
                  </div>
                  <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-6 py-3 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-sm hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all">{searching ? '搜索中' : '搜索'}</button>
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
                        {song.cover ? <div className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${song.cover})` }} /> : <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center flex-shrink-0 text-white/20">♪</div>}
                        <div className="flex-1 min-w-0">
                          <div className={`text-[13px] font-medium truncate ${isCurrent ? 'text-[#00f5d4]' : 'text-white/90'}`}>{song.title}</div>
                          <div className="text-[11px] text-white/35 truncate">{song.artist}</div>
                        </div>
                        <div className="text-[11px] text-white/25 w-12 text-right">{formatTime(song.duration)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 我的音乐 */}
            {panel === 'library' && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="text-[13px] font-bold text-white/80 mb-4">播放列表</div>
                {player.queue.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-80 text-white/25">
                    <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    <div className="text-sm">暂无播放记录</div>
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

            {/* 舞台歌词 — Mineradio同款渐变文字 + 居中 */}
            {player.currentSong && player.showLyrics && panel === 'home' && (
              <div className="absolute left-0 right-0 top-0 bottom-24 flex items-center justify-center pointer-events-none stage-lyrics-container">
                <div ref={lyricsRef} className="w-full max-w-2xl h-80 overflow-y-auto px-8 pointer-events-auto" style={{ scrollbarWidth: 'none' }}>
                  <div className="space-y-3 py-28">
                    {player.lyricsLoading && player.lyrics.length === 0 && <div className="text-center text-white/25 text-sm py-8">加载歌词中...</div>}
                    {player.lyrics.length === 0 && !player.lyricsLoading && <div className="text-center text-white/15 text-sm py-8">暂无歌词</div>}
                    {player.lyrics.map((line, i) => {
                      const isActive = i === activeLyricIdx;
                      return (
                        <div key={i} ref={isActive ? activeLyricRef : null} className={`lyrics-line ${isActive ? 'active' : i < activeLyricIdx ? 'past' : 'future'}`}>{line.text || '♪'}</div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {!player.currentSong && panel === 'home' && (
              <div className="absolute left-0 right-0 top-0 bottom-24 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-5xl mb-5 opacity-30">🎧</div>
                  <div className="text-xl font-light text-white/40">选择一首歌开始播放</div>
                </div>
              </div>
            )}
          </div>

          {/* 播放队列 */}
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

        {/* 底部控制条 — Mineradio同款玻璃 */}
        <div className="h-24 px-6 bottom-bar flex items-center gap-6">
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
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : player.isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>
              <button onClick={player.next} className="control-btn">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
              </button>
              <button onClick={player.toggleLyrics} className={`control-btn ${player.showLyrics ? 'active' : ''}`} title="歌词">
                <span className="text-[14px] font-bold">词</span>
              </button>
            </div>

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

          <div className="flex items-center gap-3 w-[260px] justify-end flex-shrink-0">
            <div className="flex items-center gap-2">
              <button className="control-btn" onClick={() => player.setVolume(player.volume === 0 ? 0.8 : 0)}>
                {player.volume === 0 ? '🔇' : player.volume < 0.5 ? '🔉' : '🔊'}
              </button>
              <input type="range" min="0" max="1" step="0.01" value={player.volume} onChange={(e) => player.setVolume(parseFloat(e.target.value))} className="w-20" />
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