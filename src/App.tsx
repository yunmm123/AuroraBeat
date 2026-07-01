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
// Three.js 视觉引擎 v2.1 — 减法重做，克制美学
// 核心一句话：少，但每一帧都呼吸。从"数量震撼"转向"质感说话"。
//   1. 单一柔光核心体（IcosahedronGeometry + fbm 位移 + 菲涅尔辉光）—— 唯一焦点
//   2. 背景慢速色域流动（全屏 quad 正交，fbm UV 偏移，替代 raymarch 体积云）
//   3. 少量精致粒子（800 颗，非 26 万；curl noise 缓慢漂移 + beat 径向冲出）
//   4. 克制后处理：UnrealBloom(threshold 0.85) + RGBShift + FilmGrain + Vignette + ACES
// 节拍真正驱动视觉：beat 触发核心体蓄力收缩→弹开 + bloom spike + 色差脉冲
// 节拍检测：RealtimeKickDetector（时域RMS + 自适应阈值）
// 封面取色：K-Means 主色 tint + 副色 accent，驱动 shader 色调
// ====================================================================

// ashima/webgl-noise simplex noise（共享 GLSL 片段，核心体位移用）
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
    // v2.1 克制版基础 scene/camera/renderer
    // ==================================================================
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 6.0);
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    // ACES tone mapping（OutputPass 末段应用，避免过曝白斑）
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    // 上限 2，省 FXAA
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 封面主色（K-Means 提取，驱动 tint + accent 双色）
    const tintColor = new THREE.Color('#7a8fa6');
    const accentColor = new THREE.Color('#c8a87a');
    // 核心体固定主色（低饱和暖橙金 #E8B27A + 奶油金辉光 #F4D4A8）
    const coreColor = new THREE.Color('#E8B27A');
    const glowColor = new THREE.Color('#F4D4A8');

    // 软核点纹理 — 高斯 sprite，粒子用
    const makeDotTexture = () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const ctx = cv.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.15)');
      g.addColorStop(0.80, 'rgba(255,255,255,0.02)');
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
    // 元素2 — 背景慢速色域流动（全屏 quad，正交相机，替代 raymarch 体积云）
    // 封面 tint + accent 双色径向渐变 + fbm 噪声缓慢 UV 偏移，12-20s 循环，大幅压暗
    // ==================================================================
    const bgUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uBeat: { value: 0 }, uAlpha: { value: 0 },
      uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
      uAspect: { value: window.innerWidth / window.innerHeight },
    };
    const bgFS = `
      uniform float uTime, uBass, uBeat, uAlpha, uAspect;
      uniform vec3 uTintColor, uAccentColor;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        float t = uTime * 0.05; // ~20s 慢循环
        // fbm 噪声缓慢 UV 偏移
        float n1 = fbm(vec3(p * 1.4, t));
        vec2 q = p + vec2(n1, fbm(vec3(p * 1.4 + 5.2, t * 0.8))) * 0.28;
        // 双色径向渐变（tint 冷 + accent 暖）
        float r1 = length(q - vec2(-0.18, 0.12));
        float r2 = length(q - vec2(0.22, -0.16));
        float g1 = smoothstep(0.75, 0.05, r1);
        float g2 = smoothstep(0.65, 0.03, r2);
        vec3 col = uTintColor * 0.16 * g1 + uAccentColor * 0.13 * g2;
        // bass 微提亮
        col += uAccentColor * uBass * 0.05;
        // beat 微高光
        col += uTintColor * uBeat * 0.04;
        // 大幅压暗（×0.25）做背景
        col *= 0.25;
        // 深处基底 #0B0E14 近黑深蓝灰
        col += vec3(0.043, 0.055, 0.078);
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
    // 元素1 — 单个柔光核心体（唯一焦点）
    // IcosahedronGeometry(1.4, 6) + fbm 顶点位移（低频大形变）+ bass 膨胀 + beat 脉冲
    // fragment：菲涅尔边缘辉光 + 核心色 #E8B27A + 位移大处偏 #F4D4A8 + 封面 tint 混入
    // 克制：base 色系数低（0.3-0.4），不刺眼；呼吸 4000-6000ms，beat 蓄力收缩→弹开
    // ==================================================================
    const coreUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 },
      uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
      uCoreColor: { value: coreColor }, uGlowColor: { value: glowColor },
    };
    const coreVS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vDisp;
      ${NOISE_GLSL}
      void main() {
        vec3 pos = position;
        float t = uTime * 0.15;
        // fbm 低频大形变位移
        float n = fbm(pos * 0.8 + vec3(t, t * 0.7, t * 0.5));
        float n2 = fbm(pos * 1.6 + vec3(-t * 0.5, t * 0.3, -t * 0.4));
        // bass 膨胀 + beat 脉冲
        float disp = n * 0.16 + n2 * 0.05 + uBass * 0.22 + uBeat * 0.10;
        pos += normal * disp;
        vDisp = disp;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `;
    const coreFS = `
      uniform vec3 uTintColor, uAccentColor, uCoreColor, uGlowColor;
      uniform float uBeat, uBass, uMid;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vDisp;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        // base 色系数低 0.3-0.4，避免中心过亮
        vec3 base = uCoreColor * 0.36;
        // 位移大处偏 #F4D4A8 奶油金
        base = mix(base, uGlowColor * 0.5, smoothstep(0.06, 0.26, vDisp));
        // 封面 tint 混入（克制 0.25）
        base = mix(base, uTintColor * 0.4, 0.25);
        // 菲涅尔边缘辉光
        vec3 rim = uGlowColor * fres * (1.0 + uBeat * 0.8);
        vec3 col = base * (0.5 + uBass * 0.3) + rim * (0.85 + uBeat * 0.6);
        // beat 微闪白（克制 0.15）
        col = mix(col, vec3(1.0), uBeat * 0.15);
        // 整体压低避免过曝
        col *= 0.86;
        gl_FragColor = vec4(col, 1.0);
      }
    `;
    const coreMat = new THREE.ShaderMaterial({
      uniforms: coreUniforms, vertexShader: coreVS, fragmentShader: coreFS,
      transparent: false,
    });
    const coreGeo = new THREE.IcosahedronGeometry(1.4, 6);
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    // ==================================================================
    // 元素3 — 少量精致粒子（800 颗，非 26 万）
    // THREE.Points + ShaderMaterial，CPU 初始化球壳分布，shader curl noise 缓慢漂移
    // 分层：核心体周围微光尘埃 500 + 远景星点 300；beat 沿径向冲出（0.6 上限）
    // ==================================================================
    const PCOUNT = 800;
    const particleGeo = new THREE.BufferGeometry();
    const basePos = new Float32Array(PCOUNT * 3);
    const seeds = new Float32Array(PCOUNT);
    const sizes = new Float32Array(PCOUNT);
    for (let i = 0; i < PCOUNT; i++) {
      const r1 = hhash(i * 3 + 1), r2 = hhash(i * 3 + 2), r4 = hhash(i * 5 + 7);
      // 前 500 颗核心体周围微光尘埃，后 300 颗远景星点
      const isFar = i >= 500;
      const R = isFar ? (5.0 + r1 * 2.5) : (2.2 + r1 * 1.3);
      const theta = r2 * Math.PI * 2;
      const phi = Math.acos(2 * r4 - 1);
      basePos[i * 3]     = R * Math.sin(phi) * Math.cos(theta);
      basePos[i * 3 + 1] = R * Math.sin(phi) * Math.sin(theta) * 0.85;
      basePos[i * 3 + 2] = R * Math.cos(phi) * 0.75;
      seeds[i] = hhash(i * 7 + 13);
      sizes[i] = isFar ? (0.3 + hhash(i * 11 + 5) * 0.8) : (0.6 + hhash(i * 11 + 5) * 1.6);
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(basePos, 3));
    particleGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    particleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const particleUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uAlpha: { value: 0 }, uPixel: { value: renderer.getPixelRatio() },
      uIntensity: { value: intensity }, uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
      uDotTex: { value: dotTexture },
    };
    const particleVS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat, uPixel, uIntensity;
      attribute float aSeed, aSize;
      varying float vBeat, vDepth, vSeed, vBass;
      ${NOISE_GLSL}
      // curl noise：取 noise 梯度的旋度，无散度流场（缓慢漂移用）
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
        vec3 pos = position;
        // curl noise 缓慢漂移（低强度）
        float t = uTime * 0.1;
        vec3 flow = curlNoise(pos * 0.3 + t) * 0.3;
        pos += flow;
        // bass 径向轻微膨胀
        float r = length(pos);
        vec3 dir = r > 0.001 ? pos / r : normalize(pos + vec3(0.001));
        pos += dir * uBass * 0.3;
        // beat 沿径向冲出（克制，0.6 上限）
        pos += dir * uBeat * 0.6;
        vBeat = uBeat; vSeed = aSeed; vBass = uBass;
        vDepth = clamp(r / 7.0, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        // intensity 控制可见度/大小衰减：低强度压低 size
        float intensityScale = mix(0.4, 1.0, clamp((uIntensity - 0.2) / 1.3, 0.0, 1.0));
        gl_PointSize = aSize * (1.0 + uTreble * 0.6 + uBeat * 0.5) * uPixel * (180.0 / max(-mv.z, 0.1)) * intensityScale;
      }
    `;
    const particleFS = `
      uniform sampler2D uDotTex;
      uniform float uBass, uMid, uTreble, uBeat, uIntensity;
      uniform vec3 uTintColor, uAccentColor;
      varying float vBeat, vDepth, vSeed, vBass;
      void main() {
        vec4 tex = texture2D(uDotTex, gl_PointCoord);
        if (tex.a < 0.02) discard;
        // tint + accent 混色
        vec3 col = mix(uTintColor, uAccentColor, clamp(vBass * 0.6 + vSeed * 0.4 - vDepth * 0.2, 0.0, 1.0));
        // beat 闪白（0.3 上限）
        col = mix(col, vec3(1.0), vBeat * 0.3);
        col *= (1.0 + vBeat * 0.8 + vBass * 0.3);
        // intensity 控制 alpha 衰减
        float intensityScale = mix(0.4, 1.0, clamp((uIntensity - 0.2) / 1.3, 0.0, 1.0));
        float fogFade = mix(1.0, 0.4, vDepth * 0.7);
        gl_FragColor = vec4(col, tex.a * fogFade * 0.6 * intensityScale);
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
    // 元素4 — 克制后处理
    // RenderPass(bg + main) + UnrealBloom(threshold 0.85) + RGBShift + FilmGrain + Vignette + ACES
    // 砍掉 BokehPass（CSS blur 做歌词景深）/ FXAA（pixelRatio 上限 2）/ Godrays / SSR
    // ==================================================================
    const composer = new EffectComposer(renderer);
    // 背景层先渲染（正交相机，独立 scene）到 composer render target
    const bgRenderPass = new RenderPass(bgScene, bgCamera);
    composer.addPass(bgRenderPass);
    // 主 scene 渲染叠加其上（不清屏，保留背景）
    const mainRenderPass = new RenderPass(scene, camera);
    mainRenderPass.clear = false;
    composer.addPass(mainRenderPass);
    // Bloom 高阈值 0.85 —— 只让核心体边缘/辉光发光，非满屏太阳
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7, 0.5, 0.85, // strength 0.7, radius 0.5, threshold 0.85
    );
    composer.addPass(bloomPass);
    // RGBShift 0.001 常驻，beat 脉冲 0.003
    const rgbShiftPass = new ShaderPass(RGBShiftShader);
    rgbShiftPass.uniforms.amount.value = 0.001;
    composer.addPass(rgbShiftPass);
    // FilmPass 0.12 颗粒（电影感 + 抗 banding）
    const filmPass = new FilmPass(0.12, 0.012, 648, false);
    composer.addPass(filmPass);
    // Vignette
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset.value = 1.1;
    vignettePass.uniforms.darkness.value = 1.05;
    composer.addPass(vignettePass);
    // ACES tone mapping + color space
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);

    // 入场渐显
    gsap.to(bgUniforms.uAlpha, { value: 1, duration: 1.8, ease: 'power2.out' });
    gsap.to(particleUniforms.uAlpha, { value: 1, duration: 2.2, ease: 'power2.out', delay: 0.5 });

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let beatAnalyser: AnalyserNode | null = null;
    let timeBuf: Float32Array | null = null;
    let smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
    let beatPulse = 0, bloomKick = 0, shiftKick = 0;
    let beatTime = 1.0; // 距上次 beat 的时间（s），初始大值无影响
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
      coreUniforms.uTime.value += dt;
      particleUniforms.uTime.value += dt;
      beatTime += dt;

      if (analyser && freqData && player.isPlaying) {
        analyser.getByteFrequencyData(freqData as any);
        const bands = sampleFrequencyBands(freqData, analyser.context.sampleRate, analyser.fftSize);
        if (beatAnalyser && timeBuf) {
          beatAnalyser.getFloatTimeDomainData(timeBuf as any);
          const isBeat = beatDetector.update(timeBuf);
          if (isBeat) {
            beatPulse = 1;
            bloomKick = Math.max(bloomKick, bands.bass * 0.5 + 0.3);
            shiftKick = 1;
            beatTime = 0; // 重置蓄力释放计时
            beatCount++;
          }
        }
        // 音频平滑（mix 0.15 阻尼，避免闪烁）
        smoothBass = smoothLerp(smoothBass, bands.bass, 0.15);
        smoothMid = smoothLerp(smoothMid, bands.mid, 0.15);
        smoothTreb = smoothLerp(smoothTreb, bands.treble, 0.18);
        smoothEnergy = smoothLerp(smoothEnergy, bands.level, 0.15);
      } else {
        smoothBass *= 0.94; smoothMid *= 0.94; smoothTreb *= 0.94; smoothEnergy *= 0.94;
      }

      // beat 脉冲指数衰减（蓄力-释放感）
      beatPulse *= Math.pow(0.08, dt);
      bloomKick *= Math.pow(0.12, dt);
      shiftKick *= Math.pow(0.15, dt);

      // === 核心体呼吸 + 蓄力释放 ===
      // 慢呼吸 ~4.5s 循环 scale 1.0→1.04→1.0
      const breath = 1.0 + Math.sin(coreUniforms.uTime.value * 1.4) * 0.02;
      // 蓄力释放：beat 瞬间收缩 -4%，随后弹开 +6%（指数衰减）
      const anticip = -0.04 * Math.exp(-beatTime * 8.0);
      const release = 0.06 * beatTime * Math.exp(-beatTime * 4.0);
      coreMesh.scale.setScalar(breath + anticip + release);

      // === 更新所有层 uniforms ===
      coreUniforms.uBass.value = smoothBass;
      coreUniforms.uMid.value = smoothMid;
      coreUniforms.uTreble.value = smoothTreb;
      coreUniforms.uBeat.value = beatPulse;

      bgUniforms.uBass.value = smoothBass;
      bgUniforms.uBeat.value = beatPulse;

      particleUniforms.uBass.value = smoothBass;
      particleUniforms.uMid.value = smoothMid;
      particleUniforms.uTreble.value = smoothTreb;
      particleUniforms.uBeat.value = beatPulse;

      // === 后处理动态：beat 冲击 ===
      // bloom strength 0.7→1.1（~1.5x），drop 时弹开
      bloomPass.strength = 0.7 + bloomKick * 0.4;
      // RGBShift 0.001 常驻，beat 脉冲 0.003
      rgbShiftPass.uniforms.amount.value = 0.001 + shiftKick * 0.002;

      // === 相机极缓漂移（幅度 0.1，非 0.25，避免眩晕） ===
      camera.position.x = Math.sin(now * 0.00006) * 0.10;
      camera.position.y = Math.cos(now * 0.00005) * 0.07;
      camera.position.z = 6.0;
      camera.lookAt(0, 0, 0);

      // 调试信息
      (window as any).__beatDebug = {
        count: beatCount, beat: beatPulse, bass: smoothBass,
        mid: smoothMid, treble: smoothTreb, bloom: bloomPass.strength,
        particles: PCOUNT,
      };
      // 同步 CSS 变量驱动沉浸式歌词（beat 脉冲 + 封面色辉光）
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--beat-pulse', String(beatPulse));
      rootStyle.setProperty('--cover-tint',
        `rgb(${(tintColor.r * 255) | 0},${(tintColor.g * 255) | 0},${(tintColor.b * 255) | 0})`);
      rootStyle.setProperty('--cover-accent',
        `rgb(${(accentColor.r * 255) | 0},${(accentColor.g * 255) | 0},${(accentColor.b * 255) | 0})`);

      // 背景层先渲染（正交），composer 渲染主 scene 叠加
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
    };
    window.addEventListener('resize', onResize);

    // 封面主色 K-Means 提取（保留现有逻辑，驱动 tint + accent 双色）
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

    engineRef.current = { particleUniforms, coreUniforms, bgUniforms, updateCover, renderer, scene };

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      particleGeo.dispose(); particleMat.dispose();
      coreGeo.dispose(); coreMat.dispose();
      bgGeo.dispose(); bgMat.dispose();
      dotTexture.dispose();
      composer.dispose();
      renderer.dispose();
      delete (window as any).__updateCover;
      delete (window as any).__beatDebug;
    };
  }, []);

  // 强度切换：v2.1 shader 里用 uIntensity 控制 alpha/size 衰减，不重建粒子
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

  // v2.1 行级隧道式歌词：仅渲染当前行前后各 5 行（虚拟窗口，避免 DOM 过多）
  const VISIBLE_RANGE = 5;
  const visibleLines = useMemo(() => {
    if (player.lyrics.length === 0) return [] as { idx: number; text: string; offset: number }[];
    const active = activeLyricIdx < 0 ? 0 : activeLyricIdx;
    const start = Math.max(0, active - VISIBLE_RANGE);
    const end = Math.min(player.lyrics.length, active + VISIBLE_RANGE + 1);
    const arr: { idx: number; text: string; offset: number }[] = [];
    for (let i = start; i < end; i++) {
      arr.push({ idx: i, text: player.lyrics[i].text || '', offset: i - active });
    }
    return arr;
  }, [activeLyricIdx, player.lyrics]);

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
          <span className="text-[9px] text-[#00f5d4]/70 ml-1.5 font-mono">v2.1.0</span>
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

      {/* 主内容：沉浸式歌词舞台（行级隧道式，克制高级） */}
      <div className="absolute inset-0 z-30 flex flex-col pt-11 pointer-events-none">
        {/* 舞台歌词（沉浸式主界面） */}
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
          {player.currentSong && player.showLyrics ? (
            <div className="lyrics-tunnel" ref={lyricsRef}>
              {player.lyricsLoading && player.lyrics.length === 0 && (
                <div className="text-center text-white/25 text-sm">加载歌词中...</div>
              )}
              {player.lyrics.length === 0 && !player.lyricsLoading && (
                <div className="text-center text-white/15 text-sm">暂无歌词</div>
              )}
              {visibleLines.map((line) => (
                <div
                  key={line.idx}
                  ref={line.offset === 0 ? activeLyricRef : null}
                  className="lyric-line"
                  data-offset={line.offset}
                >
                  {line.text || '♪'}
                </div>
              ))}
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
