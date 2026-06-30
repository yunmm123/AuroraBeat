import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayer } from './hooks/usePlayer';
import type { Song, NeteaseUser } from './types';
import * as THREE from 'three';
import { gsap } from 'gsap';

type Panel = 'home' | 'search' | 'library' | 'playlist';
type Preset = 'silk' | 'tunnel' | 'orbit' | 'void' | 'nebula' | 'wallpulse';
type Mood = 'calm' | 'energetic' | 'melancholy' | 'romantic' | 'dark';

// 音质选项
const QUALITY_OPTIONS = [
  { value: 'standard' as const, label: '标准' },
  { value: 'exhigh' as const, label: '极高' },
  { value: 'lossless' as const, label: '无损' },
  { value: 'hires' as const, label: 'Hi-Res' },
];
const QUALITY_LABELS: Record<string, string> = { standard: '标准', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' };

const PRESETS: { id: Preset; name: string; icon: string }[] = [
  { id: 'silk', name: '绽放', icon: '✺' },
  { id: 'tunnel', name: '坍缩', icon: '◉' },
  { id: 'orbit', name: '冲击波', icon: '◎' },
  { id: 'void', name: '闪烁', icon: '✦' },
  { id: 'nebula', name: '漩涡', icon: '◈' },
  { id: 'wallpulse', name: '震颤', icon: '〰' },
];

const MOOD_COLORS: Record<Mood, { primary: string; secondary: string; bg: string }> = {
  calm: { primary: '#00f5d4', secondary: '#2442ff', bg: '#0a1a1a' },
  energetic: { primary: '#ff6b35', secondary: '#ffd23f', bg: '#1a0a0a' },
  melancholy: { primary: '#4a90d9', secondary: '#7b68ee', bg: '#0a0a1a' },
  romantic: { primary: '#ff5e8a', secondary: '#ff8fab', bg: '#1a0a12' },
  dark: { primary: '#9d4edd', secondary: '#5a189a', bg: '#08090B' },
};

// ====================================================================
// Three.js 视觉引擎 — 电影级粒子艺术（联觉配色 + ACES色调 + 6预设）
// 设计原则：60-30-10色彩规则 / 重平滑防闪烁 / 联觉映射(bass=深海色,treble=暖金)
// ====================================================================
function useVisualEngine(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  player: any,
  preset: Preset,
  intensity: number,
) {
  const engineRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05060a, 0.055);
    const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 6.2);
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    // ACES Filmic 色调映射 — 电影级高光压缩，避免过曝发白
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 点纹理 — 高斯软核，电影级柔和发光（避免硬边锯齿）
    const makeDotTexture = () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const ctx = cv.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      // 更平滑的指数衰减，中心亮、边缘极软
      g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
      g.addColorStop(0.12, 'rgba(255,255,255,0.86)');
      g.addColorStop(0.30, 'rgba(255,255,255,0.52)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
      g.addColorStop(0.80, 'rgba(255,255,255,0.04)');
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      return tex;
    };
    const dotTexture = makeDotTexture();
    const coverTex = new THREE.Texture();
    coverTex.minFilter = THREE.LinearFilter; coverTex.magFilter = THREE.LinearFilter;
    // 前一首封面（切歌渐变用，Mineradio同款）
    const prevCoverTex = new THREE.Texture();
    prevCoverTex.minFilter = THREE.LinearFilter; prevCoverTex.magFilter = THREE.LinearFilter;
    // 封面深度/边缘纹理（Mineradio同款 RGBA: depth/edge/fg/lum）
    const edgeTexSize = 64;
    const edgeData = new Uint8Array(edgeTexSize * edgeTexSize * 4);
    const edgeTex = new THREE.DataTexture(edgeData, edgeTexSize, edgeTexSize, THREE.RGBAFormat);
    edgeTex.minFilter = THREE.LinearFilter; edgeTex.magFilter = THREE.LinearFilter;
    edgeTex.needsUpdate = true;
    // 涟漪纹理（Mineradio同款 1×N RGBA FloatType）
    const RIPPLE_MAX = 8;
    const rippleData = new Float32Array(RIPPLE_MAX * 4);
    const rippleTex = new THREE.DataTexture(rippleData, RIPPLE_MAX, 1, THREE.RGBAFormat, THREE.FloatType);
    rippleTex.minFilter = THREE.LinearFilter; rippleTex.magFilter = THREE.LinearFilter;
    rippleTex.needsUpdate = true;
    const ripples: { x: number; y: number; age: number; str: number }[] = [];
    for (let i = 0; i < RIPPLE_MAX; i++) ripples.push({ x: 0, y: 0, age: 999, str: 0 });

    // 粒子几何 — 大量自由粒子，3D 体积内均匀随机分布（非固定形状）
    const GRID = 160;
    const PCOUNT = GRID * GRID;
    const positions = new Float32Array(PCOUNT * 3);
    const uvs = new Float32Array(PCOUNT * 2);
    const rand = new Float32Array(PCOUNT);
    // 稳定的哈希随机（基于索引），保证每帧基础位置一致
    const hhash = (n: number) => {
      let s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let i = 0; i < PCOUNT; i++) {
      // 3D 球形体积分布（均匀）：球内随机点
      const r1 = hhash(i * 3 + 1);
      const r2 = hhash(i * 3 + 2);
      const r3 = hhash(i * 3 + 3);
      const radius = Math.cbrt(r1) * 3.2; // 立方根保证体积均匀
      const theta = r2 * Math.PI * 2;
      const phi = Math.acos(2 * r3 - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      // aUv 仍用于封面采样（基于 xy 投影归一化）
      const u = (positions[i * 3] / 3.2) * 0.5 + 0.5;
      const v = (positions[i * 3 + 1] / 3.2) * 0.5 + 0.5;
      uvs[i * 2] = u; uvs[i * 2 + 1] = v;
      rand[i] = r1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));

    const uniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
      uCoverTex: { value: coverTex },
      uPrevCoverTex: { value: prevCoverTex },
      uEdgeTex: { value: edgeTex },
      uRippleTex: { value: rippleTex },
      uRippleCount: { value: RIPPLE_MAX },
      uHasCover: { value: 0 },
      uHasEdge: { value: 0 },
      uColorMixT: { value: 1 },
      uDotTex: { value: dotTexture },
      uAlpha: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() },
      uIntensity: { value: intensity },
      uPreset: { value: 0 },
      uTintColor: { value: new THREE.Color('#9db8cf') },
      // 鼠标交互 uniform（世界坐标 + 速度 + 按下状态）
      uMouse: { value: new THREE.Vector2(0, 0) },
      uMouseVel: { value: new THREE.Vector2(0, 0) },
      uMouseDown: { value: 0 },
      // 节拍卡点 uniform：uBeat=脉冲值(0-1快衰减), uBeatAge=当前节拍后时长, uBeatCount=累计节拍数
      uBeatAge: { value: 999 },
      uBeatCount: { value: 0 },
      uBeatStrength: { value: 0 },
    };

    const vertexShader = `
      uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uPixel, uAlpha, uIntensity, uPreset;
      uniform sampler2D uCoverTex, uPrevCoverTex, uEdgeTex, uRippleTex;
      uniform float uHasCover, uHasEdge, uColorMixT, uRippleCount;
      uniform vec2 uMouse, uMouseVel;
      uniform float uMouseDown, uBeatAge, uBeatCount, uBeatStrength;
      attribute vec2 aUv;
      attribute float aRand;
      varying float vBright;
      varying float vEdgeBoost;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSourceLum;
      varying float vDepth;
      varying float vBeatGlow;

      #define PI 3.14159265

      vec2 safeCoverUv(vec2 uv) { return clamp(uv, vec2(0.001), vec2(0.999)); }

      // 稳定哈希
      float hash13(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }
      // 3D 值噪声（用于环境漂移）
      float vnoise3(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = hash13(i + vec3(0,0,0));
        float n100 = hash13(i + vec3(1,0,0));
        float n010 = hash13(i + vec3(0,1,0));
        float n110 = hash13(i + vec3(1,1,0));
        float n001 = hash13(i + vec3(0,0,1));
        float n101 = hash13(i + vec3(1,0,1));
        float n011 = hash13(i + vec3(0,1,1));
        float n111 = hash13(i + vec3(1,1,1));
        return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
                   mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
      }

      // 联觉配色：低频→深海蓝绿(冷)，高频→暖金粉(暖)，中频过渡
      vec3 synestheticColor(float bass, float mid, float treble, vec3 coverCol, float hasCover) {
        vec3 deepOcean = vec3(0.04, 0.18, 0.28);
        vec3 midTone = vec3(0.10, 0.55, 0.72);
        vec3 warmHigh = vec3(1.0, 0.62, 0.38);
        vec3 audio = mix(deepOcean, midTone, smoothstep(0.0, 0.5, mid));
        audio = mix(audio, warmHigh, smoothstep(0.3, 0.8, treble) * 0.55);
        vec3 blended = mix(audio, coverCol, hasCover * 0.45);
        // 节拍瞬间注入暖光，制造"心跳"感
        blended += warmHigh * uBeat * 0.25;
        return blended;
      }

      // 弱化鼠标排斥力（仅近距离小幅推开）
      vec3 mouseForceWeak(vec3 mpos) {
        vec3 toMouse = mpos - vec3(uMouse, 0.0);
        float md = length(toMouse);
        float radius = 1.2;
        if (md > radius || md < 0.001) return vec3(0.0);
        float falloff = (1.0 - md / radius) * 0.35; // 弱化
        return normalize(toMouse) * falloff;
      }

      void main() {
        // basePos = 稳定基础位置（3D 体积自由分布，非固定形状）
        vec3 basePos = position;
        float t = uTime;
        float r1 = aRand;
        float r2 = fract(r1 * 7.13);
        float r3 = fract(r2 * 11.91);
        vAlpha = 1.0;
        vEdgeBoost = 0.0;
        vSourceLum = 0.5;
        vDepth = 0.0;
        vBeatGlow = uBeat; // 节拍发光强度，传给 fragment

        // 封面颜色（新旧渐变）
        vec2 cuv = safeCoverUv(aUv);
        vec3 newCol = texture2D(uCoverTex, cuv).rgb;
        vec3 prevCol = texture2D(uPrevCoverTex, cuv).rgb;
        vec3 coverCol = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));
        vSourceLum = dot(coverCol, vec3(0.299, 0.587, 0.114));

        int preset = int(uPreset + 0.5);

        // 环境漂移：所有预设共享的缓慢噪声漂移（避免完全静止）
        // 基于粒子位置和时间，让粒子在基础位置附近轻微浮动
        vec3 drift = vec3(
          vnoise3(basePos * 0.4 + vec3(t * 0.08, 0.0, 0.0)),
          vnoise3(basePos * 0.4 + vec3(0.0, t * 0.08, 0.0)),
          vnoise3(basePos * 0.4 + vec3(0.0, 0.0, t * 0.08))
        ) - 0.5;
        // 低频驱动漂移幅度，高频增加湍流
        drift *= 0.4 + uBass * 0.8 + uTreble * 0.3;

        // 节拍行为：每个粒子有自己的"响应相位"，基于 aRand 错开
        // beatPhase 让粒子行为有时间差，避免整体同步呆板
        float beatPhase = r1 * 0.4; // 0~0.4 的相位差
        float beatT = max(0.0, uBeatAge - beatPhase); // 该粒子的节拍龄
        float beatEnv = exp(-beatT * 4.0) * uBeatStrength; // 节拍包络（快速衰减）
        // 节拍方向（基于粒子哈希，每个粒子有自己的爆发方向）
        vec3 beatDir = normalize(basePos + vec3(0.001));

        vec3 pos = basePos;
        float pointScale = 1.0;
        float brightBoost = 1.0;

        // 默认应用联觉配色
        vColor = synestheticColor(uBass, uMid, uTreble, coverCol, uHasCover);

        if (preset == 0) {
          // === BLOOM 绽放 === 节拍时粒子从中心向外爆发，衰减后回归
          // 爆发距离 = 节拍强度 * 方向，远粒子爆发更猛（视觉冲击）
          float dist = length(basePos);
          float burstMag = beatEnv * (1.0 + dist * 0.3) * 2.5;
          pos = basePos + beatDir * burstMag;
          // 爆发时变亮变大
          brightBoost = 1.0 + beatEnv * 2.5;
          pointScale = 1.0 + beatEnv * 1.8;
          // 爆发时颜色偏暖
          vColor = mix(vColor, vec3(1.0, 0.7, 0.4), beatEnv * 0.6);
        } else if (preset == 1) {
          // === IMPLODE 坍缩 === 节拍时粒子向中心聚拢，衰减后散开
          // 聚拢 = 位置向中心收缩，远粒子收缩更多
          float shrink = 1.0 - beatEnv * 0.7;
          pos = basePos * shrink;
          // 聚拢时核心变亮（密度增加）
          brightBoost = 1.0 + beatEnv * 1.8;
          pointScale = 1.0 + beatEnv * 1.2;
          vColor = mix(vColor, vec3(0.5, 0.8, 1.0), beatEnv * 0.5);
        } else if (preset == 2) {
          // === SHOCKWAVE 冲击波 === 节拍时从中心发出环形冲击波，粒子被波推开后回归
          // 波前半径 = 节拍龄 * 速度
          float waveRadius = beatT * 4.5;
          float dist = length(basePos);
          // 波前附近的粒子被推开（高斯峰）
          float waveFront = exp(-pow((dist - waveRadius) * 1.8, 2.0));
          float push = waveFront * uBeatStrength * 2.0;
          pos = basePos + beatDir * push;
          // 波前粒子变亮
          brightBoost = 1.0 + waveFront * uBeatStrength * 3.0;
          pointScale = 1.0 + waveFront * uBeatStrength * 1.5;
          // 冲击波颜色：波前暖白，内部冷
          vColor = mix(vColor, vec3(1.0, 0.9, 0.7), waveFront * uBeatStrength * 0.7);
        } else if (preset == 3) {
          // === FLASH 闪烁 === 节拍时粒子瞬间放大变亮，像萤火虫同步闪烁
          // 位置基本不动，主要变化大小和亮度
          // 每个粒子有自己的闪烁阈值（部分粒子不闪，增加层次）
          float flashThreshold = r2;
          float flash = step(0.3, flashThreshold) * beatEnv;
          brightBoost = 1.0 + flash * 4.0;
          pointScale = 1.0 + flash * 3.0;
          // 闪烁颜色：暖白
          vColor = mix(vColor, vec3(1.0, 0.95, 0.8), flash * 0.8);
          // 非节拍时粒子有呼吸般的明暗变化
          float breathe = 0.6 + 0.4 * sin(t * 1.2 + r1 * 8.0);
          brightBoost *= 0.5 + breathe * 0.5;
        } else if (preset == 4) {
          // === VORTEX 漩涡 === 节拍时粒子绕中心旋转，旋转量随节拍衰减
          // 旋转角度 = 节拍强度 * (1 + 距离)，远粒子转得更多
          float dist = length(basePos);
          float angle = beatEnv * (2.0 + dist * 0.8) * (r1 > 0.5 ? 1.0 : -1.0); // 随机正反向
          float s = sin(angle), c = cos(angle);
          // 绕 z 轴旋转
          pos.x = basePos.x * c - basePos.y * s;
          pos.y = basePos.x * s + basePos.y * c;
          pos.z = basePos.z;
          brightBoost = 1.0 + beatEnv * 1.5;
          pointScale = 1.0 + beatEnv * 1.0;
          // 漩涡颜色：旋转时偏冷蓝
          vColor = mix(vColor, vec3(0.4, 0.7, 1.0), beatEnv * 0.5);
        } else {
          // === TREMOR 震颤 === 节拍时粒子剧烈随机抖动，衰减后平静
          // 每个粒子有自己的抖动方向（基于哈希），节拍驱动幅度
          vec3 jitterDir = normalize(vec3(
            hash13(basePos + vec3(1.0, 0.0, 0.0)) - 0.5,
            hash13(basePos + vec3(0.0, 1.0, 0.0)) - 0.5,
            hash13(basePos + vec3(0.0, 0.0, 1.0)) - 0.5
          ));
          float tremorMag = beatEnv * 1.2;
          pos = basePos + jitterDir * tremorMag;
          // 高频也驱动持续微抖（非节拍时也有活力）
          pos += jitterDir * uTreble * 0.15;
          brightBoost = 1.0 + beatEnv * 1.8;
          pointScale = 1.0 + beatEnv * 1.3;
          // 震颤颜色：偏暖橙
          vColor = mix(vColor, vec3(1.0, 0.6, 0.3), beatEnv * 0.5);
        }

        // 叠加环境漂移（所有预设共享）
        pos += drift;
        // 弱化鼠标排斥力
        pos += mouseForceWeak(pos);

        // 边缘能量增强（克制）
        float edgeDist = length(aUv - 0.5);
        vEdgeBoost = smoothstep(0.28, 0.5, edgeDist) * uEnergy * 0.5;
        // 亮度：基础 + 低频 + 节拍行为增强，克制上限
        vBright = (0.45 + uBass * 0.35 + uEnergy * 0.12 + r3 * 0.06) * uIntensity * brightBoost;
        // 深度（用于雾化）：基于到中心距离
        vDepth = clamp(length(pos) / 4.0, 0.0, 1.0);

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPos;
        // 点大小：近大远小 + 节拍放大
        gl_PointSize = (1.6 + uBass * 2.2 + uEnergy * 1.0) * pointScale * uPixel * (300.0 / max(-mvPos.z, 0.1));
      }
    `;

    const fragmentShader = `
      uniform sampler2D uDotTex;
      uniform float uAlpha;
      varying float vBright;
      varying float vEdgeBoost;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSourceLum;
      varying float vDepth;
      varying float vBeatGlow;
      // ACES Filmic 近似曲线 — 电影级高光压缩，避免过曝发白
      vec3 acesFilm(vec3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }
      void main() {
        vec4 tex = texture2D(uDotTex, gl_PointCoord);
        if (tex.a < 0.02) discard;
        vec3 col = vColor * vBright;
        // 边缘能量微增亮（克制）
        col = mix(col, col * 1.25 + vec3(0.04), vEdgeBoost * 0.3);
        // 节拍卡点：节拍瞬间增强发光（暖白注入），让卡点视觉冲击明显
        col += vec3(1.0, 0.9, 0.75) * vBeatGlow * 0.4;
        // ACES 色调映射
        col = acesFilm(col * 1.2);
        // 深度雾化：远层粒子稍微淡入背景，增强纵深
        float fogFade = mix(1.0, 0.6, vDepth * 0.6);
        gl_FragColor = vec4(col, tex.a * uAlpha * vAlpha * fogFade);
      }
    `;

    const bloomFragmentShader = `
      uniform sampler2D uDotTex;
      uniform float uAlpha;
      varying float vBright;
      varying float vEdgeBoost;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSourceLum;
      varying float vDepth;
      varying float vBeatGlow;
      vec3 acesFilm(vec3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }
      void main() {
        vec4 tex = texture2D(uDotTex, gl_PointCoord);
        if (tex.a < 0.02) discard;
        vec3 col = vColor * vBright * 1.7;
        // 节拍卡点 bloom 增强
        col += vec3(1.0, 0.9, 0.75) * vBeatGlow * 0.6;
        col = acesFilm(col * 1.3);
        // Mineradio同款 keepBlack: 暗粒子不溢光，避免画面发灰
        float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
        float bloomKeep = 1.0 - keepBlack * 0.92;
        // 平方软化：bloom 层更柔和，避免硬光斑
        float soft = tex.a * tex.a;
        // 节拍时 bloom 更强（卡点光晕）
        float beatBloom = 1.0 + vBeatGlow * 1.2;
        // 深度衰减：远层 bloom 更弱
        float depthFade = mix(1.0, 0.5, vDepth * 0.6);
        gl_FragColor = vec4(col, soft * uAlpha * 0.5 * vAlpha * bloomKeep * depthFade * beatBloom);
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

    gsap.to(uniforms.uAlpha, { value: 1, duration: 1.2, ease: 'power2.out' });

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let beatAnalyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let beatData: Uint8Array | null = null;
    let smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
    let beatPulse = 0;
    // Mineradio同款 peak tracking：低频慢衰减峰值，配合 gamma 归一化让画面在动态范围上更稳定
    let bassPeak = 0.030;
    let prevTime = performance.now();
    let rippleWriteIdx = 0;
    let beatCooldown = 0;
    // === Spectral Flux 节拍检测（比单纯低频更准确，参考 R.P.M. 文章）===
    // 上一帧节拍频谱（用于计算帧间正变化之和 = spectral flux）
    let prevBeatSpectrum: Float32Array | null = null;
    // 滚动历史窗口（用于自适应阈值 = mean + 1.5*stdDev）
    const FLUX_HISTORY_LEN = 43; // 约 0.7s @ 60fps
    const fluxHistory: number[] = new Array(FLUX_HISTORY_LEN).fill(0);
    let fluxHistoryIdx = 0;
    // 上次节拍强度（用于避免极弱节拍触发）
    let lastBeatFlux = 0;
    // 节拍后阈值提升的"不应期"，避免单一峰值反复触发
    let beatRefractory = 0;
    // 电影级缓慢相机漂移（替代抖动），呼吸感而非晃动
    let camDriftX = 0, camDriftY = 0;
    // 鼠标追踪状态（屏幕像素坐标 + 平滑速度）
    let mouseTargetX = window.innerWidth / 2;
    let mouseTargetY = window.innerHeight / 2;
    let smoothMouseVx = 0, smoothMouseVy = 0;

    // 全局鼠标事件：更新目标位置 + 按下状态
    const onMouseMove = (e: PointerEvent) => {
      mouseTargetX = e.clientX;
      mouseTargetY = e.clientY;
    };
    const onMouseDown = () => { uniforms.uMouseDown.value = 1; };
    const onMouseUp = () => { uniforms.uMouseDown.value = 0; };
    window.addEventListener('pointermove', onMouseMove);
    window.addEventListener('pointerdown', onMouseDown);
    window.addEventListener('pointerup', onMouseUp);

    // 触发一次涟漪（点击或强节拍）。u=0.5,v=0.5 为画面中心
    const triggerRipple = (u: number, v: number, str: number) => {
      const r = ripples[rippleWriteIdx];
      r.x = u; r.y = v; r.age = 0; r.str = str;
      rippleWriteIdx = (rippleWriteIdx + 1) % RIPPLE_MAX;
    };
    // 暴露给点击事件
    (window as any).__triggerRipple = triggerRipple;

    const setupAnalysers = () => {
      const a = player.getAnalyser();
      const ba = player.getBeatAnalyser();
      if (a && !analyser) { analyser = a; freqData = new Uint8Array(a.frequencyBinCount); }
      if (ba && !beatAnalyser) { beatData = new Uint8Array(ba.frequencyBinCount); beatAnalyser = ba; }
    };
    player.setAnalyserReadyHandler?.(setupAnalysers);
    setTimeout(setupAnalysers, 500);

    const presetIdx = { silk: 0, tunnel: 1, orbit: 2, void: 3, nebula: 4, wallpulse: 5 };
    uniforms.uPreset.value = presetIdx[preset];

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - prevTime) / 1000, 0.05);
      prevTime = now;
      uniforms.uTime.value += dt;
      beatCooldown = Math.max(0, beatCooldown - dt);

      if (analyser && freqData && beatAnalyser && beatData && player.isPlaying) {
        analyser.getByteFrequencyData(freqData as any);
        beatAnalyser.getByteFrequencyData(beatData as any);
        const len = freqData.length;
        const kickEnd = 7;
        const vocalEnd = Math.min(len, 140);
        const midEnd = Math.min(len, 280);
        let bKick = 0, mInst = 0, tHigh = 0;
        for (let i = 0; i < kickEnd; i++) bKick += freqData[i] / 255;
        for (let i = kickEnd; i < vocalEnd; i++) mInst += freqData[i] / 255;
        for (let i = vocalEnd; i < midEnd; i++) mInst += freqData[i] / 255;
        for (let i = midEnd; i < len; i++) tHigh += freqData[i] / 255;
        bKick /= kickEnd;
        mInst /= Math.max(1, midEnd - kickEnd);
        tHigh /= Math.max(1, len - midEnd);

        // Mineradio同款 peak tracking：低频慢衰减 + 下限钳制，避免静音段把增益拉到 0
        bassPeak = Math.max(bassPeak * 0.994, bKick, 0.030);
        // gamma 归一化：把 bKick 相对 bassPeak 的比例映射到 0~1，使动态范围更稳定
        const bassNorm = Math.pow(Math.min(1, bKick / Math.max(0.05, bassPeak)), 0.7);

        const env = (cur: number, target: number, up: number, down: number) =>
          cur + (target > cur ? up : down) * (target - cur);
        smoothBass = env(smoothBass, Math.min(0.82, bassNorm * 0.85), 0.30, 0.075);
        smoothMid = env(smoothMid, Math.min(0.68, mInst * 0.64), 0.18, 0.06);
        smoothTreb = env(smoothTreb, Math.min(0.56, tHigh * 0.54), 0.18, 0.055);
        smoothEnergy = env(smoothEnergy, Math.min(0.72, (bassNorm + mInst + tHigh) / 3), 0.16, 0.055);

        const bassOnset = Math.max(0, bKick - smoothBass * 0.9);

        // === Spectral Flux 节拍检测（核心节奏卡点算法）===
        // 1) 计算 spectral flux：当前帧相对上一帧的频谱正变化之和（只取增量，即 onset）
        //    使用低频+中频段（kickEnd~midEnd），这是节奏信息最集中的频段
        // 2) 自适应阈值：用过去 ~0.7s 的 flux 滚动均值 + 1.5*标准差
        //    这种自适应方法在不同歌曲/响度下都能稳定工作
        // 3) 触发条件：flux > threshold 且超过不应期（refractory ~250ms）
        // 4) 触发后：uBeatAge=0 / uBeatCount++ / uBeatStrength=flux归一化值
        let flux = 0;
        if (prevBeatSpectrum) {
          // 限制 flux 计算到节奏频段（约 80Hz ~ 2kHz），避免高频抖动误触发
          const fluxStart = kickEnd;
          const fluxEnd = Math.min(midEnd, beatData.length);
          for (let i = fluxStart; i < fluxEnd; i++) {
            const cur = beatData[i] / 255;
            const prev = prevBeatSpectrum[i];
            const diff = cur - prev;
            if (diff > 0) flux += diff; // 只累加正变化（onset）
          }
          // 归一化到频段数量
          flux /= Math.max(1, fluxEnd - fluxStart);
        }
        // 更新历史窗口（写入当前 flux，供下一帧阈值计算）
        fluxHistory[fluxHistoryIdx] = flux;
        fluxHistoryIdx = (fluxHistoryIdx + 1) % FLUX_HISTORY_LEN;
        // 计算均值与标准差
        let fluxMean = 0;
        for (let i = 0; i < FLUX_HISTORY_LEN; i++) fluxMean += fluxHistory[i];
        fluxMean /= FLUX_HISTORY_LEN;
        let fluxVar = 0;
        for (let i = 0; i < FLUX_HISTORY_LEN; i++) {
          const d = fluxHistory[i] - fluxMean;
          fluxVar += d * d;
        }
        const fluxStd = Math.sqrt(fluxVar / FLUX_HISTORY_LEN);
        // 自适应阈值：均值 + 1.5 标准差（文献常用 1.0~2.0，1.5 较平衡）
        const fluxThreshold = fluxMean + fluxStd * 1.5;

        // 复制当前频谱到 prevBeatSpectrum 供下一帧使用
        if (beatData) {
          if (!prevBeatSpectrum || prevBeatSpectrum.length !== beatData.length) {
            prevBeatSpectrum = new Float32Array(beatData.length);
          }
          for (let i = 0; i < beatData.length; i++) prevBeatSpectrum[i] = beatData[i] / 255;
        }

        // 不应期倒计时（避免连续触发）
        beatRefractory = Math.max(0, beatRefractory - dt);

        // 节拍触发判定：flux 超过自适应阈值 + 不应期结束 + 当前 flux 比上次节拍强（避免弱节拍跟随）
        // 同时要求 flux 有绝对强度（>0.02），避免静音段噪声误触发
        const fluxStrength = Math.max(0, flux - fluxThreshold); // 超出阈值的部分
        if (flux > fluxThreshold && beatRefractory <= 0 && flux > 0.02 && flux > lastBeatFlux * 0.45) {
          // 触发节拍卡点行为：重置节拍龄，节拍数 +1，记录节拍强度
          uniforms.uBeatAge.value = 0;
          uniforms.uBeatCount.value += 1;
          // 节拍强度：flux 超出阈值的程度 + 低频强度共同决定，钳制到 0~1
          const strength = Math.min(1, fluxStrength * 6 + bassNorm * 0.3);
          uniforms.uBeatStrength.value = strength;
          lastBeatFlux = flux;
          // 不应期约 250ms（限制最快节拍到 ~240BPM，过滤过高误判）
          beatRefractory = 0.25;
          // beatPulse 用于涟漪/相机推近等次级效果（保留原涟漪触发行为）
          beatPulse = Math.max(beatPulse, Math.min(0.18, fluxStrength * 0.6 + 0.04));
          triggerRipple(0.35 + Math.random() * 0.3, 0.35 + Math.random() * 0.3, Math.min(1, strength));
          beatCooldown = 0.18;
        } else {
          // 节拍强度随时间快速衰减（每个粒子 shader 内也会用 beatEnv 衰减）
          // 这里只对 uBeatStrength 做缓慢清零，实际卡点效果由 uBeatAge 在 shader 里驱动
          uniforms.uBeatStrength.value *= Math.pow(0.5, dt * 2);
        }
        // 节拍龄每帧累加（shader 用它计算 exp(-beatT * 4) 包络）
        uniforms.uBeatAge.value += dt;

        // 兼容旧逻辑：bassOnset 仍可用于次级效果（这里仅作 beatPulse 备份）
        if (bassOnset > 0.075 && bKick > 0.32 && beatCooldown <= 0) {
          beatPulse = Math.max(beatPulse, Math.min(0.12, bassOnset * 0.15));
          beatCooldown = 0.18;
        }
        beatPulse *= Math.pow(0.36, dt);

        uniforms.uBass.value = smoothBass;
        uniforms.uMid.value = smoothMid;
        uniforms.uTreble.value = smoothTreb;
        uniforms.uBeat.value = beatPulse;
        uniforms.uEnergy.value = smoothEnergy;
      } else {
        smoothBass *= 0.91; smoothMid *= 0.91; smoothTreb *= 0.91; smoothEnergy *= 0.91; beatPulse *= 0.82;
        bassPeak *= 0.99;
        // 未播放/无分析器时：节拍龄继续累加（让粒子回归静止），节拍强度衰减
        uniforms.uBeatAge.value += dt;
        uniforms.uBeatStrength.value *= Math.pow(0.5, dt * 2);
        uniforms.uBass.value = smoothBass;
        uniforms.uMid.value = smoothMid;
        uniforms.uTreble.value = smoothTreb;
        uniforms.uBeat.value = beatPulse;
        uniforms.uEnergy.value = smoothEnergy;
      }

      // 更新涟漪 age 并写入 rippleTex（Mineradio 同款 1×N RGBA FloatType）
      for (let i = 0; i < RIPPLE_MAX; i++) {
        const r = ripples[i];
        r.age += dt;
        rippleData[i * 4] = r.x;
        rippleData[i * 4 + 1] = r.y;
        rippleData[i * 4 + 2] = r.age;
        rippleData[i * 4 + 3] = r.str;
      }
      rippleTex.needsUpdate = true;

      // 鼠标平滑追踪 + 速度计算（用于 shader 中的鼠标交互力）
      // 目标：鼠标在屏幕上的位置映射到世界坐标（z=0 平面，约 ±2.4 范围）
      const targetMx = (mouseTargetX / window.innerWidth) * 2.0 - 1.0;
      const targetMy = -((mouseTargetY / window.innerHeight) * 2.0 - 1.0);
      const prevMx = uniforms.uMouse.value.x;
      const prevMy = uniforms.uMouse.value.y;
      // 平滑跟随，避免抖动
      const mouseLerp = Math.min(1, dt * 8);
      const newMx = prevMx + (targetMx * 2.4 - prevMx) * mouseLerp;
      const newMy = prevMy + (targetMy * 2.4 - prevMy) * mouseLerp;
      uniforms.uMouse.value.set(newMx, newMy);
      // 速度 = 位置差 / dt（归一化），用于流场注入
      const vx = (newMx - prevMx) / Math.max(dt, 0.001);
      const vy = (newMy - prevMy) / Math.max(dt, 0.001);
      // 限幅 + 平滑
      smoothMouseVx = smoothMouseVx * 0.7 + Math.max(-3, Math.min(3, vx)) * 0.3;
      smoothMouseVy = smoothMouseVy * 0.7 + Math.max(-3, Math.min(3, vy)) * 0.3;
      uniforms.uMouseVel.value.set(smoothMouseVx, smoothMouseVy);

      // 电影级相机漂移：缓慢跟随鼠标（视差感），+ 节拍微推
      const driftTargetX = uniforms.uMouse.value.x * 0.25 + Math.sin(now * 0.0001) * 0.15 + beatPulse * 0.1;
      const driftTargetY = uniforms.uMouse.value.y * 0.18 + Math.cos(now * 0.00008) * 0.1 + beatPulse * 0.06;
      camDriftX += (driftTargetX - camDriftX) * Math.min(1, dt * 1.5);
      camDriftY += (driftTargetY - camDriftY) * Math.min(1, dt * 1.5);
      camera.position.x = camDriftX;
      camera.position.y = camDriftY;
      camera.position.z = 6.2 - beatPulse * 0.4;

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

        // 切歌渐变：把当前 coverTex 内容拷贝到 prevCoverTex，然后 uColorMixT 从 0 渐变到 1（Mineradio同款）
        if (uniforms.uHasCover.value === 1 && coverTex.image) {
          const prevCv = document.createElement('canvas');
          prevCv.width = prevCv.height = size;
          prevCv.getContext('2d')!.drawImage(coverTex.image as any, 0, 0, size, size);
          prevCoverTex.image = prevCv;
          prevCoverTex.needsUpdate = true;
          uniforms.uColorMixT.value = 0;
          gsap.to(uniforms.uColorMixT, { value: 1, duration: 1.1, ease: 'power2.inOut' });
        } else {
          prevCoverTex.image = cv;
          prevCoverTex.needsUpdate = true;
          uniforms.uColorMixT.value = 1;
        }

        coverTex.image = cv;
        coverTex.needsUpdate = true;
        uniforms.uHasCover.value = 1;

        // 生成 64×64 RGBA 边缘/深度纹理（Mineradio同款启发式：R=depth, G=edge, B=fg, A=lum）
        try {
          const src = ctx.getImageData(0, 0, size, size).data;
          const dst = edgeData;
          const eSz = edgeTexSize;
          // 先降采样到 64×64 的灰度缓冲
          const grayBuf = new Float32Array(eSz * eSz);
          for (let y = 0; y < eSz; y++) {
            for (let x = 0; x < eSz; x++) {
              const sx = Math.floor(x / eSz * size), sy = Math.floor(y / eSz * size);
              const di = (sy * size + sx) * 4;
              grayBuf[y * eSz + x] = (src[di] * 0.299 + src[di + 1] * 0.587 + src[di + 2] * 0.114) / 255;
            }
          }
          for (let y = 0; y < eSz; y++) {
            for (let x = 0; x < eSz; x++) {
              const idx = y * eSz + x;
              const lum = grayBuf[idx];
              // Sobel 边缘
              const xm = x > 0 ? x - 1 : 0, xp = x < eSz - 1 ? x + 1 : eSz - 1;
              const ym = y > 0 ? y - 1 : 0, yp = y < eSz - 1 ? y + 1 : eSz - 1;
              const gx = -grayBuf[ym * eSz + xm] - 2 * grayBuf[y * eSz + xm] - grayBuf[yp * eSz + xm]
                       + grayBuf[ym * eSz + xp] + 2 * grayBuf[y * eSz + xp] + grayBuf[yp * eSz + xp];
              const gy = -grayBuf[ym * eSz + xm] - 2 * grayBuf[ym * eSz + x] - grayBuf[ym * eSz + xp]
                       + grayBuf[yp * eSz + xm] + 2 * grayBuf[yp * eSz + x] + grayBuf[yp * eSz + xp];
              const edgeMag = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 1.6);
              // 中心 mask 深度：距离中心越近深度越大（伪3D凸起）
              const dxn = (x / (eSz - 1) - 0.5) * 2;
              const dyn = (y / (eSz - 1) - 0.5) * 2;
              const radial = Math.sqrt(dxn * dxn + dyn * dyn);
              const depth = Math.max(0, 1 - radial) * 0.7 + lum * 0.3;
              const di4 = idx * 4;
              dst[di4] = Math.round(depth * 255);
              dst[di4 + 1] = Math.round(edgeMag * 255);
              dst[di4 + 2] = Math.round(lum * 255);
              dst[di4 + 3] = 255;
            }
          }
          edgeTex.needsUpdate = true;
          uniforms.uHasEdge.value = 1;

          // 主色提取（保留原有 tint 逻辑）
          let best = { score: -1, r: 143, g: 233, b: 255 };
          for (let y = 0; y < size; y += 8) {
            for (let x = 0; x < size; x += 8) {
              const di = (y * size + x) * 4;
              const r = src[di], g = src[di + 1], b = src[di + 2];
              const lumN = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
              const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
              const score = chroma * 1.6 + (0.5 - Math.abs(lumN - 0.5)) * 0.45;
              if (lumN > 0.08 && lumN < 0.92 && score > best.score) best = { score, r, g, b };
            }
          }
          uniforms.uTintColor.value.setRGB(best.r / 255, best.g / 255, best.b / 255);
        } catch {
          uniforms.uHasEdge.value = 0;
        }
      };
      img.onerror = () => { uniforms.uHasCover.value = 0; };
      img.src = coverUrl;
    };
    (window as any).__updateCover = updateCover;
    const coverUrl = player.currentSong?.cover;
    if (coverUrl) updateCover(coverUrl);

    engineRef.current = { uniforms, updateCover, renderer, scene };

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('pointerdown', onMouseDown);
      window.removeEventListener('pointerup', onMouseUp);
      geo.dispose(); material.dispose(); bloomMaterial.dispose();
      coverTex.dispose(); dotTexture.dispose();
      prevCoverTex.dispose(); edgeTex.dispose(); rippleTex.dispose();
      renderer.dispose();
      delete (window as any).__updateCover;
      delete (window as any).__triggerRipple;
    };
  }, []);

  // 预设切换
  useEffect(() => {
    if (engineRef.current?.uniforms) {
      const presetIdx = { silk: 0, tunnel: 1, orbit: 2, void: 3, nebula: 4, wallpulse: 5 };
      engineRef.current.uniforms.uPreset.value = presetIdx[preset];
    }
  }, [preset]);

  // 强度切换
  useEffect(() => {
    if (engineRef.current?.uniforms) {
      engineRef.current.uniforms.uIntensity.value = intensity;
    }
  }, [intensity]);

  // 封面更新
  useEffect(() => {
    const coverUrl = player.currentSong?.cover;
    if (coverUrl && (window as any).__updateCover) {
      (window as any).__updateCover(coverUrl);
    }
  }, [player.currentSong?.cover]);
}

// ====================================================================
// AI 情绪检测 — 基于歌名/艺术家关键词推断情绪
// ====================================================================
function detectMood(song: Song | null): Mood {
  if (!song) return 'calm';
  const text = `${song.title} ${song.artist}`.toLowerCase();
  if (/love|心|恋|情|玫瑰|moonlight|sweet|kiss|拥抱|温柔|浪漫/.test(text)) return 'romantic';
  if (/rock|燃|fire|power|fight|war|storm|怒|热血|战|break|狂/.test(text)) return 'energetic';
  if (/sad|泪|lonely|夜|rain|哭|伤|离|lost|alone|空|blue|忧/.test(text)) return 'melancholy';
  if (/dark|夜|shadow|death|blood|黑|暗|魔|night|demon|evil/.test(text)) return 'dark';
  return 'calm';
}

// ====================================================================
// 主应用
// ====================================================================
const App: React.FC = () => {
  const player = usePlayer();
  const [panel, setPanel] = useState<Panel>('home');
  const [showQueue, setShowQueue] = useState(false);
  const [showFx, setShowFx] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);
  const [viewingTracks, setViewingTracks] = useState<Song[]>([]);
  const [viewingName, setViewingName] = useState('');
  const [neteaseUser, setNeteaseUser] = useState<NeteaseUser | null>(null);
  const [serverPort, setServerPort] = useState(0);
  const [preset, setPreset] = useState<Preset>('silk');
  const [intensity, setIntensity] = useState(0.85);
  const [customBg, setCustomBg] = useState<string | null>(null);
  const [customVideo, setCustomVideo] = useState<string | null>(null);
  const [gestureHint, setGestureHint] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLDivElement>(null);
  const searchSeqRef = useRef(0);
  const electron = (window as any).electronAPI;
  const gestureHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AI情绪自动主题
  const mood = useMemo(() => detectMood(player.currentSong), [player.currentSong]);
  const moodColors = MOOD_COLORS[mood];
  const bgColor = (customBg || customVideo) ? 'transparent' : moodColors.bg;

  useVisualEngine(canvasRef, player, preset, intensity);

  useEffect(() => {
    electron?.getServerPort?.().then((port: number) => {
      setServerPort(port);
      player.setServerPort?.(port);
    });
  }, []);

  const apiBase = `http://127.0.0.1:${serverPort}`;

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

  // 手势提示气泡
  const showGestureHint = useCallback((text: string) => {
    setGestureHint(text);
    if (gestureHintTimer.current) clearTimeout(gestureHintTimer.current);
    gestureHintTimer.current = setTimeout(() => setGestureHint(null), 1100);
  }, []);

  // 键盘快捷键（沉浸式控制）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.code) {
        case 'Space':
          e.preventDefault(); player.togglePlay(); showGestureHint('播放 / 暂停'); break;
        case 'ArrowRight':
          if (e.shiftKey) { player.next(); showGestureHint('下一首'); }
          else { player.seek(player.currentTime + 5); showGestureHint('+5s'); }
          break;
        case 'ArrowLeft':
          if (e.shiftKey) { player.prev(); showGestureHint('上一首'); }
          else { player.seek(Math.max(0, player.currentTime - 5)); showGestureHint('-5s'); }
          break;
        case 'ArrowUp':
          e.preventDefault(); { const v = Math.min(1, player.volume + 0.05); player.setVolume(v); showGestureHint(`音量 ${Math.round(v * 100)}%`); } break;
        case 'ArrowDown':
          e.preventDefault(); { const v = Math.max(0, player.volume - 0.05); player.setVolume(v); showGestureHint(`音量 ${Math.round(v * 100)}%`); } break;
        case 'KeyL':
          if (player.currentSong) {
            handleLike(player.currentSong);
            showGestureHint('红心');
          }
          break;
        case 'KeyF':
          setShowFx((v) => !v); showGestureHint('FX 面板'); break;
        case 'KeyM':
          player.setVolume(player.volume > 0 ? 0 : 0.8); showGestureHint(player.volume > 0 ? '静音' : '取消静音'); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, showGestureHint]);

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
        // 获取红心列表
        await player.fetchLikedList();
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

  const importCustomBg = async () => {
    const result = await electron?.selectImageFile?.();
    if (result?.path) { setCustomBg(result.path); setCustomVideo(null); }
  };

  const importCustomVideo = async () => {
    const result = await electron?.selectVideoFile?.();
    if (result?.url) { setCustomVideo(result.url); setCustomBg(null); }
  };

  const handleLike = async (song: Song) => {
    await player.toggleLike(song);
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

  // GSAP 列表入场
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current) {
      const items = listRef.current.querySelectorAll('.queue-item, .search-result-item');
      gsap.fromTo(items, { autoAlpha: 0, y: 8, x: -6 }, {
        autoAlpha: 1, y: 0, x: 0, duration: 0.22, stagger: 0.012, ease: 'power2.out', force3D: true,
      });
    }
  }, [searchResults, viewingTracks, panel, player.queue]);

  const isCurrentLiked = player.currentSong ? player.likedSongs.has(player.currentSong.id) : false;

  return (
    <div className="fixed inset-0 overflow-hidden text-white select-none font-sans" style={{ background: bgColor, transition: 'background 1.5s ease' }}>
      {/* 自定义背景图片 */}
      {customBg && <div className="absolute inset-0 z-0 bg-cover bg-center" style={{ backgroundImage: `url(${customBg})`, opacity: 0.3 }} />}
      {/* 自定义背景视频（沉浸式循环静音播放） */}
      {customVideo && (
        <video
          key={customVideo}
          src={customVideo}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover z-0"
          style={{ opacity: 0.35 }}
        />
      )}
      {/* 专辑模糊背景 */}
      {player.currentSong?.cover && !customBg && !customVideo && (
        <div className={`album-bg visible`} style={{ backgroundImage: `url(${player.currentSong.cover})` }} />
      )}
      {/* Three.js 粒子画布 */}
      <canvas ref={canvasRef} className="absolute inset-0 z-10 pointer-events-none" />
      {/* 涟漪点击层：捕获空白区域点击触发涟漪（UI 控件位于更高 z-index，会优先消费自己的点击） */}
      <div
        className="absolute inset-0 z-[15] pointer-events-auto"
        onPointerDown={(e) => {
          const trigger = (window as any).__triggerRipple as ((u: number, v: number, str: number) => void) | undefined;
          if (!trigger) return;
          const u = e.clientX / window.innerWidth;
          const v = 1 - e.clientY / window.innerHeight;
          trigger(u, v, 0.8);
        }}
      />
      {/* 渐变遮罩 */}
      <div className="absolute inset-0 z-20 pointer-events-none" style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.45) 100%)` }} />

      {/* 手势提示气泡 */}
      {gestureHint && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] pointer-events-none">
          <div className="px-5 py-2.5 rounded-full bg-black/55 backdrop-blur-xl border border-[#00f5d4]/25 text-[#00f5d4] text-sm font-semibold tracking-wide" style={{ boxShadow: '0 0 30px rgba(0,245,212,0.25)' }}>
            {gestureHint}
          </div>
        </div>
      )}

      {/* 标题栏 */}
      <div className="absolute top-0 left-0 right-0 h-11 z-50 flex items-center justify-between px-4" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: `linear-gradient(135deg, ${moodColors.primary}, ${moodColors.secondary})` }} />
          <span className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">AuroraBeat</span>
          <span className="text-[10px] text-white/20 ml-2">{mood}</span>
        </div>
        <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button onClick={() => setShowFx(!showFx)} className={`glass-btn w-[38px] h-[30px] flex items-center justify-center ${showFx ? '!text-[#00f5d4]' : ''}`} title="特效面板">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </button>
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

      {/* 主内容：沉浸式歌词舞台（始终显示在底层） */}
      <div className="absolute inset-0 z-30 flex flex-col pt-11 pointer-events-none">
        {/* 舞台歌词（沉浸式主界面） */}
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
          {player.currentSong && player.showLyrics ? (
            <div className="w-full max-w-2xl h-[60vh] overflow-y-auto px-8 pointer-events-auto" ref={lyricsRef} style={{ scrollbarWidth: 'none' }}>
              <div className="space-y-3 py-32">
                {player.lyricsLoading && player.lyrics.length === 0 && <div className="text-center text-white/25 text-sm py-8">加载歌词中...</div>}
                {player.lyrics.length === 0 && !player.lyricsLoading && <div className="text-center text-white/15 text-sm py-8">暂无歌词</div>}
                {player.lyrics.map((line, i) => {
                  const isActive = i === activeLyricIdx;
                  return (
                    <div key={i} ref={isActive ? activeLyricRef : null} className={`lyrics-line ${isActive ? 'active' : i < activeLyricIdx ? 'past' : 'future'}`}>
                      {line.text || '♪'}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-5xl mb-5 opacity-30">🎧</div>
              <div className="text-xl font-light text-white/40">{player.currentSong ? '歌词已隐藏' : '选择一首歌开始播放'}</div>
              {!player.currentSong && (
                <button onClick={() => setShowOverlay(true)} className="mt-6 px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium backdrop-blur-xl border border-white/10 transition-all pointer-events-auto">浏览音乐库</button>
              )}
            </div>
          )}
        </div>

        {/* 底部控制条 */}
        <div className="h-24 px-6 bottom-bar flex items-center gap-6 pointer-events-auto">
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
            {player.currentSong && (
              <button onClick={() => handleLike(player.currentSong!)} className={`w-9 h-9 flex items-center justify-center transition-all ${isCurrentLiked ? 'text-[#ff5e8a]' : 'text-white/30 hover:text-white/60'}`}>
                <svg width="16" height="16" fill={isCurrentLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
              </button>
            )}
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

          <div className="flex items-center gap-3 w-[320px] justify-end flex-shrink-0">
            <div className="flex items-center gap-2">
              <button className="control-btn" onClick={() => player.setVolume(player.volume === 0 ? 0.8 : 0)}>
                {player.volume === 0 ? '🔇' : player.volume < 0.5 ? '🔉' : '🔊'}
              </button>
              <input type="range" min="0" max="1" step="0.01" value={player.volume} onChange={(e) => player.setVolume(parseFloat(e.target.value))} className="w-20" />
            </div>
            {/* 音质选择 */}
            <div className="relative" data-ui>
              <button onClick={() => setShowQualityMenu(!showQualityMenu)} className="control-btn !px-2.5 text-[10px] font-bold tracking-wide" title="音质">
                {QUALITY_LABELS[player.quality] || '极高'}
              </button>
              {showQualityMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowQualityMenu(false)} />
                  <div className="absolute bottom-12 right-0 z-50 w-32 rounded-xl border border-white/[0.08] bg-black/80 backdrop-blur-2xl py-1.5 shadow-2xl">
                    {QUALITY_OPTIONS.map((q) => (
                      <button key={q.value} onClick={() => { player.setQuality(q.value); setShowQualityMenu(false); }} className={`w-full px-4 py-2 text-left text-xs flex items-center justify-between transition-all ${player.quality === q.value ? 'text-[#00f5d4] bg-[#00f5d4]/05' : 'text-white/60 hover:text-white hover:bg-white/05'}`}>
                        <span>{q.label}</span>
                        {player.quality === q.value && <span>✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={() => setShowQueue(!showQueue)} className={`control-btn ${showQueue ? 'active' : ''}`}>
              <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* 二级页面覆盖层（比主界面小一点的窗口式） */}
      {showOverlay && (
        <div className="absolute z-40" style={{ top: '52px', left: '12px', right: '12px', bottom: '100px' }}>
          <div className="w-full h-full rounded-2xl overflow-hidden border border-white/[0.08] shadow-2xl flex" style={{ background: 'rgba(8,9,11,0.85)', backdropFilter: 'blur(40px)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            {/* 侧边栏 */}
            <div className="w-[200px] flex flex-col px-3 py-4 gap-0.5 border-r border-white/[0.04] bg-black/30">
              <div className="flex items-center justify-between px-3 mb-2">
                <div className="text-[10px] font-bold tracking-[0.12em] text-white/25 uppercase">导航</div>
                <button onClick={() => setShowOverlay(false)} className="w-6 h-6 rounded-lg hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center text-sm" title="收起">✕</button>
              </div>
              {[
                { id: 'home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: '首页' },
                { id: 'search', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', label: '搜索' },
                { id: 'library', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', label: '我的音乐' },
              ].map((item) => (
                <button key={item.id} onClick={() => { setPanel(item.id as Panel); setViewingTracks([]); }} className={`sidebar-tab ${panel === item.id ? 'active' : ''}`}>
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
                  {playlists.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-60 text-white/25">
                      <div className="text-sm">登录网易云后显示推荐歌单</div>
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
                        <button onClick={() => { player.playTrackAt(0, viewingTracks); setShowOverlay(false); }} className="ml-auto px-5 py-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-semibold text-sm hover:shadow-lg hover:shadow-cyan-500/25 transition-all">播放全部</button>
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
                        const isLiked = player.likedSongs.has(song.id);
                        return (
                          <div key={song.id + i} className={`queue-item ${isCurrent ? 'current' : ''} px-6 group`} onClick={() => { player.playTrackAt(i, viewingTracks); setShowOverlay(false); }}>
                            <div className={`w-5 text-center text-xs ${isCurrent ? 'text-[#00f5d4]' : 'text-white/20'}`}>{isCurrent && player.isPlaying ? '♪' : i + 1}</div>
                            <div className="flex-1 min-w-0"><div className={`text-sm truncate ${isCurrent ? 'text-[#00f5d4] font-medium' : 'text-white/85'}`}>{song.title}</div></div>
                            <div className="w-36 text-xs text-white/35 truncate">{song.artist}</div>
                            <button onClick={(e) => { e.stopPropagation(); handleLike(song); }} className={`w-6 h-6 flex items-center justify-center transition-all ${isLiked ? 'text-[#ff5e8a]' : 'text-white/15 hover:text-white/50'}`}>
                              <svg width="14" height="14" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                            </button>
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
                      const isLiked = player.likedSongs.has(song.id);
                      return (
                        <div key={song.id + i} className="search-result-item group" onClick={() => { player.playSong(song, searchResults); setShowOverlay(false); }}>
                          {song.cover ? <div className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${song.cover})` }} /> : <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center flex-shrink-0 text-white/20">♪</div>}
                          <div className="flex-1 min-w-0">
                            <div className={`text-[13px] font-medium truncate ${isCurrent ? 'text-[#00f5d4]' : 'text-white/90'}`}>{song.title}</div>
                            <div className="text-[11px] text-white/35 truncate">{song.artist}</div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); handleLike(song); }} className={`w-6 h-6 flex items-center justify-center transition-all ${isLiked ? 'text-[#ff5e8a]' : 'text-white/15 hover:text-white/50'}`}>
                            <svg width="14" height="14" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                          </button>
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
                  <div className="text-[13px] font-bold text-white/80 mb-4">我喜欢</div>
                  {(() => {
                    const likedInQueue = player.queue.filter((s) => player.likedSongs.has(s.id));
                    if (likedInQueue.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center h-40 text-white/25">
                          <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                          <div className="text-sm">点击歌曲旁的红心加入我喜欢</div>
                        </div>
                      );
                    }
                    return likedInQueue.map((song) => {
                      const isCurrent = player.currentSong?.id === song.id;
                      const isLiked = true;
                      return (
                        <div key={song.id} className={`queue-item ${isCurrent ? 'current' : ''}`} onClick={() => { const idx = player.queue.findIndex((s) => s.id === song.id); if (idx >= 0) { player.playTrackAt(idx); setShowOverlay(false); } }}>
                          <div className={`w-5 text-center text-xs ${isCurrent ? 'text-[#00f5d4]' : 'text-[#ff5e8a]'}`}>♥</div>
                          {song.cover && <div className="w-9 h-9 rounded-lg bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${song.cover})` }} />}
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm truncate ${isCurrent ? 'text-[#00f5d4] font-medium' : 'text-white/85'}`}>{song.title}</div>
                            <div className="text-[11px] text-white/35 truncate">{song.artist}</div>
                          </div>
                          <div className="text-[11px] text-white/25 w-12 text-right">{formatTime(song.duration)}</div>
                        </div>
                      );
                    });
                  })()}

                  <div className="text-[13px] font-bold text-white/80 mb-4 mt-8">播放列表</div>
                  {player.queue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-white/25">
                      <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                      <div className="text-sm">暂无播放记录</div>
                    </div>
                  ) : (
                    player.queue.map((song, i) => {
                      const isCurrent = i === player.currentIndex;
                      return (
                        <div key={song.id + i} className={`queue-item ${isCurrent ? 'current' : ''}`} onClick={() => { player.playTrackAt(i); setShowOverlay(false); }}>
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
            </div>
          </div>
        </div>
      )}

      {/* 顶部栏打开音乐库按钮（overlay收起时显示） */}
      {!showOverlay && (
        <button onClick={() => setShowOverlay(true)} className="absolute top-9 left-4 z-50 glass-btn h-[30px] px-3 flex items-center gap-1.5 text-xs" style={{ WebkitAppRegion: 'no-drag' } as any} title="打开音乐库">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          <span>音乐库</span>
        </button>
      )}

      {/* FX 面板（浮动右侧） */}
      {showFx && (
        <div className="absolute z-40 top-14 right-3 bottom-28 w-[280px] rounded-2xl border border-white/[0.06] bg-black/60 backdrop-blur-2xl flex flex-col p-4 gap-4 overflow-y-auto" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">视觉特效</div>
            <button onClick={() => setShowFx(false)} className="w-7 h-7 rounded-lg hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center">×</button>
          </div>

          {/* 粒子预设 */}
          <div>
            <div className="text-[10px] font-bold tracking-[0.1em] text-white/25 uppercase mb-2">粒子预设</div>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => setPreset(p.id)} className={`h-16 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${preset === p.id ? 'border-[#00f5d4]/40 bg-[#00f5d4]/08 text-[#00f5d4]' : 'border-white/08 bg-white/[0.02] text-white/40 hover:bg-white/[0.05]'}`}>
                  <span className="text-lg">{p.icon}</span>
                  <span className="text-[10px]">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 强度滑块 */}
          <div>
            <div className="text-[10px] font-bold tracking-[0.1em] text-white/25 uppercase mb-2">粒子强度</div>
            <div className="flex items-center gap-2">
              <input type="range" min="0.2" max="1.5" step="0.05" value={intensity} onChange={(e) => setIntensity(parseFloat(e.target.value))} className="flex-1" />
              <span className="text-[11px] text-white/40 w-8 text-right font-mono">{intensity.toFixed(2)}</span>
            </div>
          </div>

          {/* AI情绪 */}
          <div>
            <div className="text-[10px] font-bold tracking-[0.1em] text-white/25 uppercase mb-2">AI情绪主题</div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/05">
              <div className="w-3 h-3 rounded-full" style={{ background: moodColors.primary }} />
              <span className="text-xs text-white/60">{mood}</span>
              <span className="text-[10px] text-white/25 ml-auto">自动检测</span>
            </div>
          </div>

          {/* 自定义背景（图片/视频） */}
          <div>
            <div className="text-[10px] font-bold tracking-[0.1em] text-white/25 uppercase mb-2">沉浸背景</div>
            <div className="flex gap-2">
              <button onClick={importCustomBg} className={`flex-1 h-9 rounded-xl border text-xs transition-all ${customBg ? 'border-[#00f5d4]/30 bg-[#00f5d4]/06 text-[#00f5d4]' : 'border-white/08 bg-white/[0.02] text-white/50 hover:bg-white/5'}`}>图片</button>
              <button onClick={importCustomVideo} className={`flex-1 h-9 rounded-xl border text-xs transition-all ${customVideo ? 'border-[#00f5d4]/30 bg-[#00f5d4]/06 text-[#00f5d4]' : 'border-white/08 bg-white/[0.02] text-white/50 hover:bg-white/5'}`}>视频</button>
              {(customBg || customVideo) && <button onClick={() => { setCustomBg(null); setCustomVideo(null); }} className="h-9 px-3 rounded-xl border border-red-500/20 bg-red-500/05 text-xs text-red-400/70 hover:bg-red-500/10 transition-all">清除</button>}
            </div>
            {customVideo && <div className="text-[10px] text-white/25 mt-1.5">视频将循环静音播放</div>}
          </div>
        </div>
      )}

      {/* 播放队列（浮动右侧） */}
      {showQueue && (
        <div className="absolute z-40 top-14 right-3 bottom-28 w-[300px] rounded-2xl border border-white/[0.06] bg-black/60 backdrop-blur-2xl flex flex-col overflow-hidden" style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
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
  );
};

export default App;