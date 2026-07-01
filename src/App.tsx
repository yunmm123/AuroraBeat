import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayer } from './hooks/usePlayer';
import type { Song, NeteaseUser } from './types';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { RealtimeKickDetector, sampleFrequencyBands, smoothLerp } from './core/beatDetector';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader';

type Panel = 'home' | 'search' | 'library' | 'playlist';
type Mood = 'calm' | 'energetic' | 'melancholy' | 'romantic' | 'dark';

// 音质选项
const QUALITY_OPTIONS = [
  { value: 'standard' as const, label: '标准' },
  { value: 'exhigh' as const, label: '极高' },
  { value: 'lossless' as const, label: '无损' },
  { value: 'hires' as const, label: 'Hi-Res' },
];
const QUALITY_LABELS: Record<string, string> = { standard: '标准', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' };

const MOOD_COLORS: Record<Mood, { primary: string; secondary: string; bg: string }> = {
  calm: { primary: '#00f5d4', secondary: '#2442ff', bg: '#0a1a1a' },
  energetic: { primary: '#ff6b35', secondary: '#ffd23f', bg: '#1a0a0a' },
  melancholy: { primary: '#4a90d9', secondary: '#7b68ee', bg: '#0a0a1a' },
  romantic: { primary: '#ff5e8a', secondary: '#ff8fab', bg: '#1a0a12' },
  dark: { primary: '#9d4edd', secondary: '#5a189a', bg: '#08090B' },
};

// ====================================================================
// Three.js 视觉引擎 v2.0 — 大改重写，充分发挥 5060 性能
// 视觉密度五件套（联网研究 Shadertoy 顶级音频 shader + projectM/MilkDrop）：
//   A. GPUComputationRenderer 百万级 GPGPU 粒子（curl noise 流场 + 音频力场，ping-pong 零拷贝）
//   B. Raymarched KIFS 分形核（nimitz/Fractal music 风格，domain warping + 8 次 abs() 折叠 + 体积 glow）
//   C. 体积音频云背景（FBM 噪声 raymarch，bass 驱动密度，替代纯黑）
//   D. 全套电影后处理：Bokeh 景深 + UnrealBloom HDR + RGBShift + FilmGrain + Vignette + FXAA + ACES
//   E. MilkDrop per-frame 预设引擎（参数随时间演化 + 预设间 800ms blend，视觉永不重复）
//   F. 3D 频谱柱阵列（InstancedMesh 128 柱径向，加性混合发光）
// 节拍真正驱动视觉：beat 触发粒子径向冲出 + 分形核爆炸 + bloom spike + 色差脉冲 + 景深推近
// 节拍检测：lowpass(150Hz)+smoothing=0 专用链路 + 时域RMS + 自适应阈值
// 封面取色：K-Means 主色 tint + 副色 accent，驱动所有 shader 色调
// ====================================================================

// ashima/webgl-noise simplex noise（共享 GLSL 片段）
const NOISE_GLSL = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
    m=m*m;
    return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*snoise(p); p*=2.0; a*=0.5; } return v; }
`;

function useVisualEngine(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  player: any,
  intensity: number,
  enabled: boolean,
) {
  const engineRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // ==================================================================
    // 基础 scene/camera/renderer
    // ==================================================================
    const scene = new THREE.Scene();
    // 带色相近黑底（蓝调黑），避免纯黑扁平
    scene.fog = new THREE.FogExp2(0x07080e, 0.02);
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 6.5);
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    // ACES tone mapping 避免 WebGL 过曝白斑
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 封面主色（K-Means 提取，驱动所有 shader 色调）
    const tintColor = new THREE.Color('#7a8fa6');
    const accentColor = new THREE.Color('#c8a87a');

    // 软核点纹理 — 高斯 sprite，粒子用
    const makeDotTexture = () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const ctx = cv.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.20)');
      g.addColorStop(0.80, 'rgba(255,255,255,0.03)');
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      return tex;
    };
    const dotTexture = makeDotTexture();

    // hash 函数（粒子初始分布用）
    const hhash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

    // ==================================================================
    // 模块E — MilkDrop per-frame 预设引擎
    // 参数对象 + 3 个预设方程组 + 800ms blend 切换，视觉永不重复
    // ==================================================================
    const presetParams = {
      zoom: 1.0, rot: 0.0, warp: 0.0, hueShift: 0.0, decay: 0.98,
      warpScale: 1.0, sym: 0.0, push: 0.0, glow: 0.4,
    };
    type PresetOut = Partial<typeof presetParams>;
    type PresetFn = (t: number, bass: number, mid: number, treble: number, beat: number) => PresetOut;
    // 预设0：nimitz Plasma Globe — 球状等离子，bass 驱动 zoom 脉冲
    const preset0: PresetFn = (t, bass, mid, treble, beat) => ({
      zoom: 0.96 + 0.05 * Math.sin(t * 0.7) + bass * 0.14 + beat * 0.06,
      rot: 0.03 * Math.sin(t * 0.45) + mid * 0.10,
      warp: 0.12 + 0.06 * Math.sin(t * 0.31) + beat * 0.35,
      hueShift: 0.06 * Math.sin(t * 0.22) + treble * 0.05,
      decay: 0.97 + 0.02 * Math.sin(t * 0.15),
      warpScale: 1.0 + 0.3 * Math.sin(t * 0.5),
      sym: 0.0,
      push: beat * 0.5,
      glow: 0.4 + bass * 0.3,
    });
    // 预设1：Kali Fractal — 分形地形，mid 驱动折叠
    const preset1: PresetFn = (t, bass, mid, treble, beat) => ({
      zoom: 1.02 - 0.04 * Math.sin(t * 0.33) + mid * 0.10,
      rot: -0.04 * Math.sin(t * 0.6) + bass * 0.06,
      warp: 0.20 + 0.10 * Math.sin(t * 0.4) + beat * 0.4,
      hueShift: -0.08 + 0.04 * Math.sin(t * 0.18),
      decay: 0.96,
      warpScale: 1.4 + 0.5 * Math.sin(t * 0.27),
      sym: 0.5 + 0.3 * Math.sin(t * 0.2),
      push: beat * 0.7,
      glow: 0.5 + treble * 0.4,
    });
    // 预设2：Fractal Music — 旋涡，treble 驱动高速旋转
    const preset2: PresetFn = (t, bass, mid, treble, beat) => ({
      zoom: 0.94 + 0.06 * Math.sin(t * 1.1) + bass * 0.18,
      rot: 0.08 * Math.sin(t * 0.9) + treble * 0.20,
      warp: 0.08 + 0.04 * Math.sin(t * 0.7) + beat * 0.25,
      hueShift: 0.12 * Math.sin(t * 0.35),
      decay: 0.975,
      warpScale: 0.8 + 0.4 * Math.sin(t * 0.6 + 1.0),
      sym: 0.8,
      push: beat * 0.6,
      glow: 0.6 + mid * 0.3,
    });
    const presetFns: PresetFn[] = [preset0, preset1, preset2];
    let curPresetIdx = 0;
    let prevPresetIdx = 0;
    let presetBlend = 1.0; // 0→1 lerp from prev to cur
    let presetSwitchTimer = 0;
    const PRESET_INTERVAL = 18.0; // 秒，自动切换预设
    const presetKeys = ['zoom', 'rot', 'warp', 'hueShift', 'decay', 'warpScale', 'sym', 'push', 'glow'] as const;
    // 把方程输出写入 presetParams，支持 blend
    const applyPreset = (a: PresetOut, b: PresetOut, k: number) => {
      for (const key of presetKeys) {
        const av = (a as any)[key] ?? presetParams[key];
        const bv = (b as any)[key] ?? presetParams[key];
        (presetParams as any)[key] = av + (bv - av) * k;
      }
    };

    // ==================================================================
    // 模块C — 体积音频云背景（FBM raymarch 全屏层，正交相机）
    // bass 驱动密度 + 封面色染色 + beat 提亮，替代纯黑底
    // ==================================================================
    const bgUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uAlpha: { value: 0 },
      uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
      uAspect: { value: window.innerWidth / window.innerHeight },
      uPresetZoom: { value: 1.0 }, uPresetRot: { value: 0.0 }, uPresetWarp: { value: 0.0 },
      uPresetHue: { value: 0.0 }, uPresetGlow: { value: 0.4 },
    };
    const bgFS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat, uAlpha, uAspect;
      uniform float uPresetZoom, uPresetRot, uPresetWarp, uPresetHue, uPresetGlow;
      uniform vec3 uTintColor, uAccentColor;
      varying vec2 vUv;
      ${NOISE_GLSL}
      // hue 旋转矩阵（预设 hueShift 用）
      vec3 hueShift(vec3 c, float h) {
        const vec3 k = vec3(0.57735);
        float cosA = cos(h * 6.2831);
        return c * cosA + cross(k, c) * sin(h * 6.2831) + k * dot(k, c) * (1.0 - cosA);
      }
      void main() {
        vec2 uv = vUv;
        vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
        float t = uTime * 0.05;
        // 预设缩放/旋转
        float zoom = uPresetZoom;
        float ang = uPresetRot;
        mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
        // 体积云 raymarch：沿 z 步进 32 步采样 fbm
        vec3 ro = vec3(0.0, 0.0, -3.0);
        vec3 rd = normalize(vec3(p * zoom, 1.0));
        rd.xy = R * rd.xy;
        vec3 col = vec3(0.0);
        float trans = 0.0;
        const int STEPS = 32;
        for (int i = 0; i < STEPS; i++) {
          vec3 sp = ro + rd * (float(i) * 0.18 + trans);
          sp.xy = R * sp.xy;
          float dens = fbm(sp * 0.6 + vec3(t, t * 0.7, 0.0) + uPresetWarp * 0.5);
          dens = smoothstep(0.35, 0.85, dens);
          dens *= (0.5 + uBass * 1.2); // bass 驱动密度
          vec3 c = mix(uTintColor * 0.35, uAccentColor * 0.55, dens);
          col += c * dens * 0.05;
          trans += 0.18;
        }
        col = hueShift(col, uPresetHue);
        // beat 整体提亮 + 暖色高光
        col += uAccentColor * uBeat * 0.20;
        col *= (1.0 + uPresetGlow * 0.3 + uBass * 0.25);
        // 边缘暗角聚焦
        float vig = smoothstep(1.3, 0.25, length(p));
        col *= mix(0.35, 1.0, vig);
        // 避免纯黑：基底 ambient
        col += uTintColor * 0.04 + vec3(0.01, 0.012, 0.02);
        gl_FragColor = vec4(col, uAlpha);
      }
    `;
    const bgMat = new THREE.ShaderMaterial({
      uniforms: bgUniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: bgFS, transparent: true, depthWrite: false, depthTest: false,
    });
    const bgGeo = new THREE.PlaneGeometry(2, 2);
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.frustumCulled = false;
    const bgScene = new THREE.Scene();
    const bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    bgScene.add(bgMesh);

    // ==================================================================
    // 模块B — Raymarched KIFS 分形核（全屏 quad 挂到相机前方）
    // nimitz 风格：domain warping + 8 次 abs() 折叠 + 距离场 + 体积 glow
    // bass 驱动位移，mid 驱动旋转，high 驱动 boiling，beat 触发爆炸
    // ==================================================================
    const fractalUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uAlpha: { value: 0 },
      uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
      uPresetWarp: { value: 0.0 }, uPresetPush: { value: 0.0 }, uPresetSym: { value: 0.0 },
      uPresetWarpScale: { value: 1.0 },
    };
    const fractalVS = `
      varying vec2 vUv;
      varying vec3 vRayDir;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // 从相机到片元的视线方向（世界空间）
        vRayDir = normalize(wp.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;
    const fractalFS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat, uAlpha;
      uniform float uPresetWarp, uPresetPush, uPresetSym, uPresetWarpScale;
      uniform vec3 uTintColor, uAccentColor;
      varying vec2 vUv;
      varying vec3 vRayDir;
      ${NOISE_GLSL}

      // KIFS 距离场：8 次 abs() 折叠 + domain warping
      // 参考 nimitz Plasma Globe / Fractal music
      float kifsDE(vec3 p, out float foldCount) {
        // domain warping（流体感）
        float t = uTime * 0.3;
        vec3 q = p;
        float warpAmt = 0.15 + uMid * 0.25 + uPresetWarp * 0.3;
        q.x += snoise(q * 0.8 + t) * warpAmt;
        q.y += snoise(q * 0.8 + t + 11.3) * warpAmt;
        q.z += snoise(q * 0.8 + t + 47.7) * warpAmt;
        p = q;
        // mid 驱动旋转
        float ang = uTime * (0.15 + uMid * 0.4);
        float c = cos(ang), s = sin(ang);
        p.xz = mat2(c, -s, s, c) * p.xz;
        float sym = 1.0 + uPresetSym * 2.0;
        // 8 次 abs() 折叠（KIFS 核心）
        float scale = 1.8 + uBass * 0.4 + uPresetWarpScale * 0.3;
        float de = 1e9;
        float mr = 0.0;
        for (int i = 0; i < 8; i++) {
          p = abs(p) - vec3(0.55, 0.5, 0.5) * sym * 0.3;
          p.xy = mat2(c, -s, s, c) * p.xy;
          p *= scale;
          // 球面化避免发散
          p /= dot(p, p) + 0.001;
          float d = (length(p) - 1.2) / scale;
          de = min(de, d);
          mr += 1.0;
        }
        foldCount = mr / 8.0;
        return de * 0.5;
      }

      // 体积 glow 累积
      vec3 volumetricGlow(vec3 ro, vec3 rd) {
        vec3 col = vec3(0.0);
        float trans = 0.0;
        const int VSTEPS = 24;
        for (int i = 0; i < VSTEPS; i++) {
          vec3 sp = ro + rd * (float(i) * 0.12 + trans);
          float fc;
          float d = kifsDE(sp, fc);
          float glow = exp(-abs(d) * 8.0) * 0.08;
          vec3 c = mix(uAccentColor * 0.6, uTintColor * 0.8, fc);
          col += c * glow * (1.0 + uBass * 0.8 + uBeat * 1.2);
          trans += 0.12;
        }
        return col;
      }

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vRayDir);
        // beat 爆炸式扩张：相机向分形推进
        ro += rd * uPresetPush * 0.8;
        // raymarch
        float t = 0.0;
        float minD = 1e9;
        bool hit = false;
        const int STEPS = 96;
        for (int i = 0; i < STEPS; i++) {
          vec3 sp = ro + rd * t;
          float fc;
          float d = kifsDE(sp, fc);
          minD = min(minD, d);
          if (d < 0.002) { hit = true; break; }
          if (t > 12.0) break;
          t += d * (0.85 + uTreble * 0.1); // treble 增加步长抖动
        }
        vec3 col = vec3(0.0);
        if (hit) {
          // 数值法线
          vec2 e = vec2(0.0015, 0.0);
          float fc1, fc2;
          vec3 hitP = ro + rd * t;
          vec3 n = normalize(vec3(
            kifsDE(hitP + e.xyy, fc1) - kifsDE(hitP - e.xyy, fc2),
            kifsDE(hitP + e.yxy, fc1) - kifsDE(hitP - e.yxy, fc2),
            kifsDE(hitP + e.yyx, fc1) - kifsDE(hitP - e.yyx, fc2)
          ));
          float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
          float fc;
          kifsDE(hitP, fc);
          vec3 base = mix(uTintColor * 0.5, uAccentColor * 0.9, fc);
          vec3 rim = mix(vec3(0.8, 0.85, 0.95), uAccentColor, 0.4) * fres;
          col = base * (0.4 + uBass * 0.4) + rim * (0.6 + uBeat * 1.0);
          // high 频 boiling 表面噪声
          col += vec3(snoise(hitP * 8.0 + uTime * 4.0)) * uTreble * 0.15;
          // beat 闪白
          col = mix(col, vec3(1.0), uBeat * 0.25);
        }
        // 体积 glow 累积（无论是否命中都加）
        col += volumetricGlow(ro, rd);
        // glow halo（最近距离）
        col += uAccentColor * exp(-minD * 2.5) * (0.3 + uBeat * 0.8);
        // 控制中心亮度避免过曝
        col *= 0.65;
        gl_FragColor = vec4(col, uAlpha * (hit ? 0.92 : 0.78 + exp(-minD * 3.0) * 0.2));
      }
    `;
    const fractalMat = new THREE.ShaderMaterial({
      uniforms: fractalUniforms, vertexShader: fractalVS, fragmentShader: fractalFS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, depthTest: false,
    });
    const fractalGeo = new THREE.PlaneGeometry(2, 2);
    const fractalQuad = new THREE.Mesh(fractalGeo, fractalMat);
    fractalQuad.frustumCulled = false;
    // 把 quad 挂到相机前方，按 FOV 缩放填满视野
    const fractalDist = 4.0;
    const fractalHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * fractalDist;
    const fractalWidth = fractalHeight * camera.aspect;
    fractalQuad.scale.set(fractalWidth / 2, fractalHeight / 2, 1);
    fractalQuad.position.set(0, 0, -fractalDist);
    camera.add(fractalQuad);
    scene.add(camera);

    // ==================================================================
    // 模块A — GPGPU 百万级粒子（curl noise 流场 + 音频力场）
    // GPUComputationRenderer ping-pong 零拷贝纹理，512×512=262144 粒子
    // ==================================================================
    const TEX_W = 512, TEX_H = 512;
    const PCOUNT = TEX_W * TEX_H;
    const gpuCompute = new GPUComputationRenderer(TEX_W, TEX_H, renderer);
    gpuCompute.setDataType(THREE.FloatType);

    // 初始化位置（球壳分布）与速度纹理
    const initPosTex = gpuCompute.createTexture();
    const initVelTex = gpuCompute.createTexture();
    {
      const posArr = initPosTex.image.data as unknown as Float32Array;
      const velArr = initVelTex.image.data as unknown as Float32Array;
      for (let i = 0; i < PCOUNT; i++) {
        const r1 = hhash(i * 3 + 1), r2 = hhash(i * 3 + 2), r4 = hhash(i * 5 + 7);
        const R = 4.0;
        const radius = R * (0.6 + 0.4 * Math.cbrt(r1));
        const theta = r2 * Math.PI * 2;
        const phi = Math.acos(2 * r4 - 1);
        posArr[i * 4]     = radius * Math.sin(phi) * Math.cos(theta);
        posArr[i * 4 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.75;
        posArr[i * 4 + 2] = radius * Math.cos(phi) * 0.65;
        posArr[i * 4 + 3] = 1.0;
        velArr[i * 4]     = 0; velArr[i * 4 + 1] = 0; velArr[i * 4 + 2] = 0; velArr[i * 4 + 3] = 1.0;
      }
    }

    // 速度 compute shader：curl noise 流场 + bass 径向力 + beat 爆裂 + 阻尼 + 限速
    const velComputeFS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat;
      ${NOISE_GLSL}
      // curl noise：取 noise 梯度的旋度，无散度流场
      vec3 curlNoise(vec3 p) {
        const float e = 0.1;
        vec3 dx = vec3(e, 0.0, 0.0);
        vec3 dy = vec3(0.0, e, 0.0);
        vec3 dz = vec3(0.0, 0.0, e);
        float p_x0 = snoise(p - dx), p_x1 = snoise(p + dx);
        float p_y0 = snoise(p - dy), p_y1 = snoise(p + dy);
        float p_z0 = snoise(p - dz), p_z1 = snoise(p + dz);
        float x = p_y1 - p_y0 - (p_z1 - p_z0);
        float y = p_z1 - p_z0 - (p_x1 - p_x0);
        float z = p_x1 - p_x0 - (p_y1 - p_y0);
        return normalize(vec3(x, y, z) + 1e-5);
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec3 pos = texture2D(texturePosition, uv).xyz;
        vec3 vel = texture2D(textureVelocity, uv).xyz;
        float t = uTime * (0.15 + uMid * 0.3);
        // curl noise 流场漂移
        vec3 flow = curlNoise(pos * 0.25 + t) * (0.6 + uMid * 1.2);
        vel += flow * 0.08;
        // bass 径向吸引（蓄力）
        float dist = length(pos);
        vec3 dir = dist > 0.001 ? pos / dist : normalize(pos + vec3(0.001));
        vel += dir * (-uBass * 0.4);
        // beat 爆裂：沿径向冲出
        vel += dir * uBeat * (3.0 + uBass * 4.0);
        // 中心引力回拉（防止逃逸）
        vel -= pos * 0.012;
        // treble 高频抖动
        vel += curlNoise(pos * 1.5 + t * 3.0) * uTreble * 0.6;
        // 阻尼
        vel *= 0.94;
        // 限速
        float speed = length(vel);
        float maxSpd = 2.5 + uBeat * 6.0;
        if (speed > maxSpd) vel = vel * (maxSpd / speed);
        gl_FragColor = vec4(vel, 1.0);
      }
    `;
    // 位置 compute shader：速度积分 + 球壳回归
    const posComputeFS = `
      uniform float uTime, uBass, uBeat;
      void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec3 pos = texture2D(texturePosition, uv).xyz;
        vec3 vel = texture2D(textureVelocity, uv).xyz;
        pos += vel * 0.05;
        // 软球壳回归：超出 5.5 拉回
        float r = length(pos);
        if (r > 5.5) pos = pos * (5.5 / r) * 0.98;
        // bass 时整体膨胀
        pos *= 1.0 + uBass * 0.002;
        gl_FragColor = vec4(pos, 1.0);
      }
    `;

    const posVariable = gpuCompute.addVariable('texturePosition', posComputeFS, initPosTex);
    const velVariable = gpuCompute.addVariable('textureVelocity', velComputeFS, initVelTex);
    gpuCompute.setVariableDependencies(posVariable, [posVariable, velVariable]);
    gpuCompute.setVariableDependencies(velVariable, [posVariable, velVariable]);
    posVariable.material.uniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uBeat: { value: 0 },
    };
    velVariable.material.uniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 }, uBeat: { value: 0 },
    };
    const gpuInitErr = gpuCompute.init();
    if (gpuInitErr) console.error('[GPGPU] init error:', gpuInitErr);

    // 渲染 geometry：每粒子 1 顶点 + reference uv 取 ping-pong 纹理
    const particleGeo = new THREE.BufferGeometry();
    const dummyPos = new Float32Array(PCOUNT * 3);
    const refs = new Float32Array(PCOUNT * 2);
    const seeds = new Float32Array(PCOUNT);
    const sizes = new Float32Array(PCOUNT);
    for (let i = 0; i < PCOUNT; i++) {
      const col = i % TEX_W, row = Math.floor(i / TEX_W);
      refs[i * 2]     = (col + 0.5) / TEX_W;
      refs[i * 2 + 1] = (row + 0.5) / TEX_H;
      seeds[i] = hhash(i * 7 + 13);
      sizes[i] = 0.4 + hhash(i * 11 + 5) * 1.8;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3));
    particleGeo.setAttribute('reference', new THREE.BufferAttribute(refs, 2));
    particleGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    particleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const particleUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uAlpha: { value: 0 }, uPixel: { value: renderer.getPixelRatio() },
      uIntensity: { value: intensity }, uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
      texturePosition: { value: null as THREE.Texture | null },
      textureVelocity: { value: null as THREE.Texture | null },
      uDotTex: { value: dotTexture },
    };
    const particleVS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat, uPixel, uAlpha, uIntensity;
      uniform sampler2D texturePosition;
      attribute vec2 reference;
      attribute float aSeed, aSize;
      varying float vBeat, vAlpha, vDepth, vSeed, vBass;
      void main() {
        // 从 GPGPU 位置纹理采样
        vec3 pos = texture2D(texturePosition, reference).xyz;
        vBeat = uBeat; vAlpha = uAlpha; vSeed = aSeed; vBass = uBass;
        vDepth = clamp(length(pos) / 5.5, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        // intensity 控制可见度/大小衰减：低强度压低 size
        float intensityScale = mix(0.45, 1.0, clamp((uIntensity - 0.2) / 1.3, 0.0, 1.0));
        gl_PointSize = aSize * (1.0 + uTreble * 1.4 + uBeat * 1.0) * uPixel * (240.0 / max(-mv.z, 0.1)) * intensityScale;
      }
    `;
    const particleFS = `
      uniform sampler2D uDotTex;
      uniform float uBass, uMid, uTreble, uBeat, uAlpha, uIntensity;
      uniform vec3 uTintColor, uAccentColor;
      varying float vBeat, vDepth, vAlpha, vSeed, vBass;
      void main() {
        vec4 tex = texture2D(uDotTex, gl_PointCoord);
        if (tex.a < 0.02) discard;
        // 染色：bass 偏暖 accent，treble 偏冷 tint
        vec3 col = mix(uTintColor, uAccentColor, clamp(vBass * 0.8 + vSeed * 0.3 - vDepth * 0.2, 0.0, 1.0));
        col = mix(col, vec3(0.7, 0.85, 1.0), vDepth * 0.3 * uTreble);
        // beat 闪白
        col = mix(col, vec3(1.0), vBeat * 0.5);
        col *= (1.0 + vBeat * 1.4 + uTreble * 0.35 + vBass * 0.4);
        // intensity 控制 alpha 衰减
        float intensityScale = mix(0.4, 1.0, clamp((uIntensity - 0.2) / 1.3, 0.0, 1.0));
        float fogFade = mix(1.0, 0.35, vDepth * 0.7);
        gl_FragColor = vec4(col, tex.a * uAlpha * fogFade * 0.7 * intensityScale);
      }
    `;
    const particleMat = new THREE.ShaderMaterial({
      uniforms: particleUniforms, vertexShader: particleVS, fragmentShader: particleFS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    particles.frustumCulled = false;
    scene.add(particles);

    // ==================================================================
    // 模块F — 3D 频谱柱阵列（InstancedMesh 128 柱径向，加性混合发光）
    // ==================================================================
    const BAR_COUNT = 128;
    const barGeo = new THREE.BoxGeometry(1, 1, 1);
    const barMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const barMesh = new THREE.InstancedMesh(barGeo, barMat, BAR_COUNT);
    barMesh.frustumCulled = false;
    const barMatrix = new THREE.Matrix4();
    const barScale = new THREE.Matrix4();
    const barTrans = new THREE.Matrix4();
    const barColor = new THREE.Color();
    const barFreq = new Float32Array(BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      const a = (i / BAR_COUNT) * Math.PI * 2;
      const r = 5.5;
      barMatrix.makeRotationY(0);
      barMatrix.setPosition(Math.cos(a) * r, -1.5, Math.sin(a) * r);
      barMesh.setMatrixAt(i, barMatrix);
      barColor.setHSL(i / BAR_COUNT, 0.7, 0.55);
      barMesh.setColorAt(i, barColor);
    }
    barMesh.instanceMatrix.needsUpdate = true;
    if (barMesh.instanceColor) barMesh.instanceColor.needsUpdate = true;
    scene.add(barMesh);

    // ==================================================================
    // 模块D — 全套电影后处理
    // Bokeh 景深 + UnrealBloom HDR + RGBShift + FilmGrain + Vignette + FXAA + ACES
    // ==================================================================
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bokehPass = new BokehPass(scene, camera, {
      focus: 6.5, aperture: 0.0018, maxblur: 0.012,
    });
    composer.addPass(bokehPass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.9, 0.6, 0.85, // strength 0.9, radius 0.6, threshold 0.85（只让高亮区发光）
    );
    composer.addPass(bloomPass);
    const rgbShiftPass = new ShaderPass(RGBShiftShader);
    rgbShiftPass.uniforms.amount.value = 0.0015; // 常驻极小，beat 脉冲到 0.004
    composer.addPass(rgbShiftPass);
    const filmPass = new FilmPass(0.15, 0.012, 648, false); // 胶片颗粒抗 banding
    composer.addPass(filmPass);
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset.value = 1.1;
    vignettePass.uniforms.darkness.value = 1.05;
    composer.addPass(vignettePass);
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.uniforms.resolution.value.set(
      1 / (window.innerWidth * renderer.getPixelRatio()),
      1 / (window.innerHeight * renderer.getPixelRatio())
    );
    composer.addPass(fxaaPass);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);

    // 入场渐显
    gsap.to(bgUniforms.uAlpha, { value: 1, duration: 1.5, ease: 'power2.out' });
    gsap.to(fractalUniforms.uAlpha, { value: 1, duration: 1.8, ease: 'power2.out', delay: 0.3 });
    gsap.to(particleUniforms.uAlpha, { value: 1, duration: 2.0, ease: 'power2.out', delay: 0.5 });

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let beatAnalyser: AnalyserNode | null = null;
    let timeBuf: Float32Array | null = null;
    let smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
    let beatPulse = 0, bloomKick = 0, shiftKick = 0, bokehKick = 0;
    let prevTime = performance.now();

    // === 节拍检测：RealtimeKickDetector（时域RMS + 自适应阈值 mean+k·std + 去抖） ===
    const beatDetector = new RealtimeKickDetector({
      sensitivity: 1.5, historySize: 43, minBeatIntervalMs: 220,
    });
    let beatCount = 0;

    const setupAnalysers = () => {
      const a = player.getAnalyser();
      if (a && !analyser) { analyser = a; freqData = new Uint8Array(a.frequencyBinCount); }
      const ba = player.getBeatAnalyser();
      if (ba && !beatAnalyser) { beatAnalyser = ba; timeBuf = new Float32Array(ba.fftSize); }
    };
    player.setAnalyserReadyHandler?.(setupAnalysers);
    setTimeout(setupAnalysers, 500);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - prevTime) / 1000, 0.05);
      prevTime = now;
      bgUniforms.uTime.value += dt;
      fractalUniforms.uTime.value += dt;
      particleUniforms.uTime.value += dt;
      posVariable.material.uniforms.uTime.value += dt;
      velVariable.material.uniforms.uTime.value += dt;

      if (analyser && freqData && player.isPlaying) {
        analyser.getByteFrequencyData(freqData as any);
        const bands = sampleFrequencyBands(freqData, analyser.context.sampleRate, analyser.fftSize);
        if (beatAnalyser && timeBuf) {
          beatAnalyser.getFloatTimeDomainData(timeBuf as any);
          const isBeat = beatDetector.update(timeBuf);
          if (isBeat) {
            beatPulse = 1;
            bloomKick = Math.max(bloomKick, bands.bass * 0.6 + 0.25);
            shiftKick = 1;
            bokehKick = 1;
            beatCount++;
          }
        }
        // 音频平滑（mix 0.18 阻尼，避免闪烁）
        smoothBass = smoothLerp(smoothBass, bands.bass, 0.18);
        smoothMid = smoothLerp(smoothMid, bands.mid, 0.18);
        smoothTreb = smoothLerp(smoothTreb, bands.treble, 0.22);
        smoothEnergy = smoothLerp(smoothEnergy, bands.level, 0.18);
        // 频谱柱数据采样
        for (let i = 0; i < BAR_COUNT; i++) {
          const fi = Math.floor((i / BAR_COUNT) * (freqData.length * 0.6));
          const v = freqData[fi] / 255;
          barFreq[i] = smoothLerp(barFreq[i], v, 0.25);
        }
      } else {
        smoothBass *= 0.94; smoothMid *= 0.94; smoothTreb *= 0.94; smoothEnergy *= 0.94;
        for (let i = 0; i < BAR_COUNT; i++) barFreq[i] *= 0.94;
      }

      // beat 脉冲指数衰减（蓄力-释放感）
      beatPulse *= Math.pow(0.08, dt);
      bloomKick *= Math.pow(0.12, dt);
      shiftKick *= Math.pow(0.15, dt);
      bokehKick *= Math.pow(0.18, dt);

      // === MilkDrop 预设引擎演化 ===
      presetSwitchTimer += dt;
      if (presetSwitchTimer > PRESET_INTERVAL && presetBlend >= 1.0) {
        prevPresetIdx = curPresetIdx;
        curPresetIdx = (curPresetIdx + 1) % presetFns.length;
        presetBlend = 0;
        presetSwitchTimer = 0;
      }
      const curP = presetFns[curPresetIdx](bgUniforms.uTime.value, smoothBass, smoothMid, smoothTreb, beatPulse);
      if (presetBlend < 1.0) {
        const prevP = presetFns[prevPresetIdx](bgUniforms.uTime.value, smoothBass, smoothMid, smoothTreb, beatPulse);
        presetBlend = Math.min(1.0, presetBlend + dt / 0.8); // 800ms blend
        applyPreset(prevP, curP, presetBlend);
      } else {
        applyPreset(curP, curP, 1.0);
      }

      // === 更新所有层 uniforms ===
      bgUniforms.uBass.value = smoothBass;
      bgUniforms.uMid.value = smoothMid;
      bgUniforms.uTreble.value = smoothTreb;
      bgUniforms.uBeat.value = beatPulse;
      bgUniforms.uPresetZoom.value = presetParams.zoom;
      bgUniforms.uPresetRot.value = presetParams.rot;
      bgUniforms.uPresetWarp.value = presetParams.warp;
      bgUniforms.uPresetHue.value = presetParams.hueShift;
      bgUniforms.uPresetGlow.value = presetParams.glow;

      fractalUniforms.uBass.value = smoothBass;
      fractalUniforms.uMid.value = smoothMid;
      fractalUniforms.uTreble.value = smoothTreb;
      fractalUniforms.uBeat.value = beatPulse;
      fractalUniforms.uPresetWarp.value = presetParams.warp;
      fractalUniforms.uPresetPush.value = presetParams.push;
      fractalUniforms.uPresetSym.value = presetParams.sym;
      fractalUniforms.uPresetWarpScale.value = presetParams.warpScale;

      particleUniforms.uBass.value = smoothBass;
      particleUniforms.uMid.value = smoothMid;
      particleUniforms.uTreble.value = smoothTreb;
      particleUniforms.uBeat.value = beatPulse;

      posVariable.material.uniforms.uBass.value = smoothBass;
      posVariable.material.uniforms.uBeat.value = beatPulse;
      velVariable.material.uniforms.uBass.value = smoothBass;
      velVariable.material.uniforms.uMid.value = smoothMid;
      velVariable.material.uniforms.uTreble.value = smoothTreb;
      velVariable.material.uniforms.uBeat.value = beatPulse;

      // === GPGPU compute（更新粒子位置/速度） ===
      gpuCompute.compute();
      particleUniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(posVariable).texture;
      particleUniforms.textureVelocity.value = gpuCompute.getCurrentRenderTarget(velVariable).texture;

      // === 频谱柱更新（径向布局 + 动态拉伸 + HSL 着色） ===
      for (let i = 0; i < BAR_COUNT; i++) {
        const a = (i / BAR_COUNT) * Math.PI * 2;
        const r = 5.5;
        const h = 0.05 + barFreq[i] * 3.5;
        barScale.makeScale(0.08, h, 0.08);
        barTrans.makeTranslation(Math.cos(a) * r, h / 2 - 1.5, Math.sin(a) * r);
        barMatrix.multiplyMatrices(barTrans, barScale);
        barMesh.setMatrixAt(i, barMatrix);
        barColor.setHSL(i / BAR_COUNT, 0.75, 0.45 + barFreq[i] * 0.3);
        barMesh.setColorAt(i, barColor);
      }
      barMesh.instanceMatrix.needsUpdate = true;
      if (barMesh.instanceColor) barMesh.instanceColor.needsUpdate = true;

      // === 后处理动态：beat 冲击 ===
      bloomPass.strength = 0.9 + bloomKick * 0.7;
      rgbShiftPass.uniforms.amount.value = 0.0015 + shiftKick * 0.0025;
      // bokeh focus 随 bass/beat 推近
      bokehPass.uniforms.focus.value = 6.5 - smoothBass * 1.5 - bokehKick * 1.0;
      bokehPass.uniforms.aperture.value = 0.0018 + bokehKick * 0.0015;

      // === 相机缓漂 + beat 微推近（克制避免眩晕） ===
      camera.position.x = Math.sin(now * 0.00006) * 0.18;
      camera.position.y = Math.cos(now * 0.00005) * 0.12;
      camera.position.z = 6.5 - beatPulse * 0.3;
      camera.lookAt(0, 0, 0);

      // 调试信息
      (window as any).__beatDebug = {
        count: beatCount, beat: beatPulse, bass: smoothBass,
        mid: smoothMid, treble: smoothTreb, bloom: bloomPass.strength,
        preset: curPresetIdx, particles: PCOUNT,
      };
      // 同步 CSS 变量驱动沉浸式歌词（beat 脉冲 + 封面色辉光）
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--beat-pulse', String(beatPulse));
      rootStyle.setProperty('--cover-tint',
        `rgb(${(tintColor.r * 255) | 0},${(tintColor.g * 255) | 0},${(tintColor.b * 255) | 0})`);
      rootStyle.setProperty('--cover-accent',
        `rgb(${(accentColor.r * 255) | 0},${(accentColor.g * 255) | 0},${(accentColor.b * 255) | 0})`);

      // 先渲染背景层（正交相机，独立 scene），再 composer 渲染主 scene
      renderer.autoClear = false;
      renderer.render(bgScene, bgCamera);
      composer.render();
    };
    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
      bloomPass.resolution.set(window.innerWidth, window.innerHeight);
      bgUniforms.uAspect.value = window.innerWidth / window.innerHeight;
      // 重新计算 fractal quad 填满视野
      const fh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * fractalDist;
      const fw = fh * camera.aspect;
      fractalQuad.scale.set(fw / 2, fh / 2, 1);
      fxaaPass.uniforms.resolution.value.set(
        1 / (window.innerWidth * renderer.getPixelRatio()),
        1 / (window.innerHeight * renderer.getPixelRatio())
      );
    };
    window.addEventListener('resize', onResize);

    // 封面主色 K-Means 提取（驱动 tint + accent 双色）
    const updateCover = (coverUrl: string) => {
      if (!coverUrl) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const size = 80;
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const ctx = cv.getContext('2d')!;
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        // K-Means 简化版：选两个对比度最高的色（主色 tint + 副色 accent）
        try {
          const src = ctx.getImageData(0, 0, size, size).data;
          // 量化到 16 色桶
          const buckets: Record<string, { r: number; g: number; b: number; n: number; sat: number; lum: number }> = {};
          for (let i = 0; i < src.length; i += 4) {
            const r = src[i], g = src[i + 1], b = src[i + 2];
            const qr = r >> 4, qg = g >> 4, qb = b >> 4;
            const key = `${qr},${qg},${qb}`;
            if (!buckets[key]) {
              const max = Math.max(r, g, b), min = Math.min(r, g, b);
              buckets[key] = { r: 0, g: 0, b: 0, n: 0, sat: (max - min) / 255, lum: (r * 0.299 + g * 0.587 + b * 0.114) / 255 };
            }
            const bk = buckets[key];
            bk.r += r; bk.g += g; bk.b += b; bk.n++;
          }
          const arr = Object.values(buckets).map(bk => ({
            r: bk.r / bk.n, g: bk.g / bk.n, b: bk.b / bk.n,
            sat: bk.sat, lum: bk.lum, n: bk.n,
          }));
          // 主色：像素数 × 饱和度 排序，避开过暗过亮
          const candidates = arr.filter(a => a.lum > 0.12 && a.lum < 0.85).sort((a, b) => (b.n * b.sat) - (a.n * a.sat));
          if (candidates.length > 0) {
            const main = candidates[0];
            const mainCol = new THREE.Color(main.r / 255, main.g / 255, main.b / 255);
            gsap.to(tintColor, { r: mainCol.r, g: mainCol.g, b: mainCol.b, duration: 1.5, ease: 'power2.inOut' });
            // 副色：与主色色相距离最远的候选
            let accent = candidates[0];
            let maxDist = -1;
            for (const c of candidates.slice(0, 8)) {
              const dr = c.r - main.r, dg = c.g - main.g, db = c.b - main.b;
              const d = dr * dr + dg * dg + db * db;
              if (d > maxDist) { maxDist = d; accent = c; }
            }
            const accentCol = new THREE.Color(accent.r / 255, accent.g / 255, accent.b / 255);
            gsap.to(accentColor, { r: accentCol.r, g: accentCol.g, b: accentCol.b, duration: 1.5, ease: 'power2.inOut' });
          }
        } catch {}
      };
      img.onerror = () => {};
      img.src = coverUrl;
    };
    (window as any).__updateCover = updateCover;
    const coverUrl = player.currentSong?.cover;
    if (coverUrl) updateCover(coverUrl);

    engineRef.current = { particleUniforms, fractalUniforms, bgUniforms, updateCover, renderer, scene };

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      gpuCompute.dispose();
      particleGeo.dispose(); particleMat.dispose();
      fractalGeo.dispose(); fractalMat.dispose();
      bgGeo.dispose(); bgMat.dispose();
      barGeo.dispose(); barMat.dispose();
      dotTexture.dispose();
      composer.dispose();
      renderer.dispose();
      delete (window as any).__updateCover;
      delete (window as any).__beatDebug;
    };
  }, []);

  // 强度切换：v2.0 GPGPU 粒子数量固定（512×512=26万），强度改为控制粒子活跃度/可见度
  // 在 shader 里用 uIntensity 控制 alpha/size 衰减，避免重建纹理
  useEffect(() => {
    const eng = engineRef.current;
    if (eng?.particleUniforms) eng.particleUniforms.uIntensity.value = intensity;
  }, [intensity]);

  // 媒体上传时隐藏特效 canvas，清除后恢复
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.opacity = enabled ? '1' : '0';
      canvasRef.current.style.transition = 'opacity 0.6s ease';
    }
  }, [enabled]);

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
// 节拍调试显示（按需开关，不常驻）
// ====================================================================
const BeatDebugOverlay: React.FC<{ visible: boolean }> = ({ visible }) => {
  const [info, setInfo] = React.useState<any>({ count: 0, beat: 0, bass: 0, mid: 0, treble: 0, bloom: 0 });
  React.useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      const d = (window as any).__beatDebug;
      if (d) setInfo(d);
    }, 100);
    return () => clearInterval(id);
  }, [visible]);
  if (!visible) return null;
  return (
    <div className="absolute top-16 left-4 z-[55] bg-black/70 text-green-400 font-mono text-xs px-3 py-2 rounded pointer-events-none">
      <div>BEAT COUNT: {info.count}</div>
      <div>BEAT PULSE: {(info.beat || 0).toFixed(3)}</div>
      <div>BASS: {(info.bass || 0).toFixed(3)} / MID: {(info.mid || 0).toFixed(3)} / TREBLE: {(info.treble || 0).toFixed(3)}</div>
      <div>BLOOM: {(info.bloom || 0).toFixed(2)}</div>
      <div style={{ color: info.count > 0 ? '#0f0' : '#888' }}>
        {info.count > 0 ? '✓ 卡点触发中' : '— 等待节拍'}
      </div>
    </div>
  );
};

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
  const [intensity, setIntensity] = useState(0.85);
  const [showDebug, setShowDebug] = useState(false);
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

  // 媒体上传时关闭全部特效
  const visualEnabled = !customBg && !customVideo;
  useVisualEngine(canvasRef, player, intensity, visualEnabled);

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
      {/* 多层光斑渐变背景（封面主色+副色径向光斑漂移，替代纯黑） */}
      {!customBg && !customVideo && (
        <div
          className="absolute inset-0 z-0"
          style={{
            background: `
              radial-gradient(ellipse 60% 50% at 22% 28%, ${moodColors.primary}22 0%, transparent 55%),
              radial-gradient(ellipse 55% 45% at 78% 72%, ${moodColors.secondary}1f 0%, transparent 55%),
              radial-gradient(ellipse 70% 60% at 50% 50%, ${moodColors.primary}10 0%, transparent 70%),
              linear-gradient(135deg, ${moodColors.bg} 0%, #050507 100%)
            `,
            opacity: 0.9,
          }}
        />
      )}
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
      {/* 节拍调试显示（按需，默认关闭） */}
      <BeatDebugOverlay visible={showDebug} />
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
          <span className="text-[9px] text-[#00f5d4]/70 ml-1.5 font-mono">v2.0.0</span>
          <span className="text-[10px] text-white/20 ml-2">{mood}</span>
        </div>
        <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button onClick={() => setShowDebug(!showDebug)} className={`glass-btn w-[38px] h-[30px] flex items-center justify-center ${showDebug ? '!text-[#00f5d4]' : ''}`} title="节拍调试">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>
          </button>
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

      {/* 主内容：沉浸式歌词舞台（Spotify 全屏大字风格） */}
      <div className="absolute inset-0 z-30 flex flex-col pt-11 pointer-events-none">
        {/* 舞台歌词（沉浸式主界面） */}
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
          {player.currentSong && player.showLyrics ? (
            <div className="w-full max-w-3xl h-[70vh] overflow-y-auto px-8 pointer-events-auto lyric-stage" ref={lyricsRef} style={{ scrollbarWidth: 'none' }}>
              <div className="flex flex-col items-center justify-center py-[28vh]">
                {player.lyricsLoading && player.lyrics.length === 0 && <div className="text-center text-white/25 text-sm py-8">加载歌词中...</div>}
                {player.lyrics.length === 0 && !player.lyricsLoading && <div className="text-center text-white/15 text-sm py-8">暂无歌词</div>}
                {player.lyrics.map((line, i) => {
                  const isActive = i === activeLyricIdx;
                  const dist = Math.abs(i - activeLyricIdx);
                  // 无字级时间戳：基于行起始与下一行时间，按字符数等分模拟逐字推进
                  const lineStart = line.time;
                  const nextStart = i + 1 < player.lyrics.length ? player.lyrics[i + 1].time : lineStart + 4;
                  const lineDur = Math.max(0.1, nextStart - lineStart);
                  let prog = 0;
                  if (isActive) prog = Math.max(0, Math.min(1, (player.currentTime - lineStart) / lineDur));
                  else if (i < activeLyricIdx) prog = 1;
                  const text = line.text || '♪';
                  const chars = Array.from(text);
                  // 高能量词估算：长词（>=4 字）拉伸 + 高能段（prog 中段）放大
                  const energyBoost = isActive ? Math.max(0, 1 - Math.abs(prog - 0.5) * 2) * 0.12 : 0;
                  return (
                    <div
                      key={i}
                      ref={isActive ? activeLyricRef : null}
                      className={`lyric-line${isActive ? ' lyric-line--current' : i < activeLyricIdx ? ' lyric-line--past' : ' lyric-line--future'}`}
                      style={{
                        opacity: isActive ? 1 : Math.max(0.12, 0.5 - dist * 0.12),
                        // 当前句整体随 beat 缩放脉冲
                        transform: isActive ? `scale(${1 + energyBoost + (typeof window !== 'undefined' ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--beat-pulse')) || 0) * 0.04 : 0)})` : undefined,
                      }}
                    >
                      {chars.map((ch, ci) => {
                        // 每字填充分数：prog * chars.length - ci，clamp 0..1
                        const w = isActive
                          ? Math.max(0, Math.min(1, prog * chars.length - ci))
                          : (i < activeLyricIdx ? 1 : 0);
                        const isSpace = ch === ' ';
                        const isLongWord = chars.length >= 4;
                        // 当前正唱的字（部分填充）触发 active 态：流光 + glow + 缩放脉冲
                        const isActiveWord = isActive && w > 0.001 && w < 0.999;
                        return (
                          <span
                            key={ci}
                            className={`lyric-word${isActiveWord ? ' lyric-word--active' : w >= 0.999 ? ' lyric-word--sung' : ' lyric-word--unsung'}${isLongWord && isActive ? ' lyric-word--elongated' : ''}`}
                            style={{ ['--w' as any]: w.toFixed(3) }}
                          >
                            {isSpace ? '\u00A0' : ch}
                          </span>
                        );
                      })}
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
