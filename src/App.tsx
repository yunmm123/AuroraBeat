import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayer } from './hooks/usePlayer';
import type { Song, NeteaseUser } from './types';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { sampleFrequencyBands, smoothLerp } from './core/beatDetector';
import { useSpectrum } from './hooks/useSpectrum';
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
// Three.js 视觉引擎 v3.1.17 — 节拍绽放光晕 + 频谱环 + 远景星尘 + 自然粒子点缀
// 单层架构（正交相机，单 PlaneGeometry(2,2) + ShaderMaterial）+ 35 颗粒子点缀：
//   远景星尘（~144 颗）：网格 hash 生成位置/亮度/闪烁相位，静态不互动不节拍
//     极小极暗铺满背景增加纵深，偏白偏冷融入夜空；区别于前景 35 颗粒子（大/互动/节拍亮）
//   节拍绽放光晕（圆环外围花瓣）：6 瓣角度调制 + 节拍膨胀消散 + 静止低亮可见
//     与频谱环同心，比冲击波更柔和弥散，花瓣形区别于均匀环；自然不生硬，不抢戏
//   节拍冲击波（4 层回响，弱化辅助）：onBeat 时 FIFO 替换最旧，从中心扩散
//     速度 0.15/0.20/0.25/0.30 形成回响层次，exp 衰减柔和环，亮度系数 0.18（弱化让位绽放光晕）
//   自然粒子点缀（35 颗）：value noise 驱动漂浮 + 鼠标附近轻微聚集 + 节拍微微亮
//     additive blending，软发光圆点，CPU 更新，z=1 前景 renderOrder=2
//   频谱环（弱化辅助）：uFreqTex 极坐标采样，低亮度系数
//   彗星椭圆拖尾（20 点）：椭圆长轴沿鼠标方向，速度越快越长轴；头亮(accent)尾暗(tint)
//   鼠标光斑（三层柔光）+ 点击涟漪 + 拖拽探头 + vignette + grain + ACES
// 封面色 K-Means tint + accent 驱动色彩；CSS 变量联动歌词
// 节拍驱动：蓄能池 energy + ADSR 包络 env（无阶跃，流动响应）
// 节拍检测：离线预分析（Spectral Flux + DP）+ realtime fallback（beatDetector.ts）
// 封面取色：K-Means 主色 tint + 副色 accent，驱动色彩
// ====================================================================

// 轻量 hash + 2D value noise（保证 shader 编译通过 + 性能，无 simplex）

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
    // 单层全屏 shader quad（正交相机），无粒子、无体积云
    // ==================================================================
    const scene = new THREE.Scene();
    // 单层 mesh 放 z=0，near=-1/far=1 足够
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    // 错误兜底：WebGL 上下文创建失败时提示用户
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: false, powerPreference: 'high-performance' });
    } catch (e) {
      console.error('[Visual] WebGL context creation failed:', e);
      return;
    }
    if (!renderer.getContext()) {
      console.error('[Visual] WebGL context is null after creation');
      return;
    }
    renderer.setClearColor(0x000000, 0);
    // toneMapping 交给 OutputPass 做，避免双重 tonemapping 导致画面过暗
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    // 上限 2，省 FXAA
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 封面主色（K-Means 提取，驱动 tint + accent 双色 → 流光色彩）
    const tintColor = new THREE.Color('#7a8fa6');
    const accentColor = new THREE.Color('#c8a87a');

    // ==================================================================
    // 渐变流光 shader（全屏 quad）
    // 多条流动光带 + fbm 显隐呼吸 + 中心 sheen 高光 + 频谱环辅助
    // + 彗星椭圆拖尾 + 鼠标光斑 + 涟漪 + 节拍响应；封面色 tint/accent 驱动
    // ==================================================================
    const RIPPLE_MAX = 3;
    // v3.1.7: 真实 FFT 频谱纹理——传给 shader 做极坐标频谱环（音频驱动形态，非封面色）
    const FREQ_BINS = 128;
    const freqTexData = new Uint8Array(FREQ_BINS * 4);
    const freqTex = new THREE.DataTexture(freqTexData, FREQ_BINS, 1, THREE.RGBAFormat);
    freqTex.needsUpdate = true;
    freqTex.minFilter = THREE.LinearFilter;
    freqTex.magFilter = THREE.LinearFilter;
    const uniforms = {
      uTime: { value: 0 },
      uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uEnergy: { value: 0 }, uEnv: { value: 0 },
      uAlpha: { value: 0 }, uIntensity: { value: intensity },
      uTint: { value: tintColor }, uAccent: { value: accentColor },
      uMouseUV: { value: new THREE.Vector2(0.5, 0.5) },
      uMouseStrength: { value: 0 },
      uMouseVel: { value: new THREE.Vector2(0, 0) },        // 鼠标速度向量（彗星椭圆拉伸方向）
      uCamPan: { value: new THREE.Vector2(0, 0) },          // 拖拽探头偏移
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uFreqTex: { value: freqTex },
      // 彗星拖尾轨迹（20 个历史位置 uv.xy + time.z + active.w）
      // 用单独 vec4 代替数组 uniform（避免 GLSL ES 1.00 数组 uniform 驱动兼容问题）
      uTrail0: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail1: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail2: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail3: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail4: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail5: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail6: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail7: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail8: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail9: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail10: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail11: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail12: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail13: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail14: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail15: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail16: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail17: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail18: { value: new THREE.Vector4(0, 0, -10, 0) },
      uTrail19: { value: new THREE.Vector4(0, 0, -10, 0) },
      // 涟漪（3 个，单独 vec4）
      uRipple0: { value: new THREE.Vector4(0, 0, -10, 0) },
      uRipple1: { value: new THREE.Vector4(0, 0, -10, 0) },
      uRipple2: { value: new THREE.Vector4(0, 0, -10, 0) },
      // 节拍冲击波（4 层回响，vec4(x, y, startTime, intensity)）；onBeat 时 FIFO 替换最旧
      uShock0: { value: new THREE.Vector4(0, 0, -10, 0) },
      uShock1: { value: new THREE.Vector4(0, 0, -10, 0) },
      uShock2: { value: new THREE.Vector4(0, 0, -10, 0) },
      uShock3: { value: new THREE.Vector4(0, 0, -10, 0) },
    };
    const fieldFS = `
      precision highp float;
      uniform float uTime, uBass, uMid, uTreble, uEnergy, uEnv, uAlpha, uIntensity, uMouseStrength;
      uniform vec3 uTint, uAccent;
      uniform vec2 uMouseUV, uMouseVel, uCamPan, uResolution;
      uniform vec4 uRipple0, uRipple1, uRipple2;
      uniform vec4 uShock0, uShock1, uShock2, uShock3;   // 节拍冲击波（x, y, startTime, intensity）
      uniform vec4 uTrail0, uTrail1, uTrail2, uTrail3, uTrail4, uTrail5, uTrail6, uTrail7;
      uniform vec4 uTrail8, uTrail9, uTrail10, uTrail11, uTrail12, uTrail13, uTrail14, uTrail15;
      uniform vec4 uTrail16, uTrail17, uTrail18, uTrail19;
      uniform sampler2D uFreqTex;
      varying vec2 vUv;

      // hash + 2D value noise（轻量，保证编译通过 + 性能）
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      // fbm 最多 4 octave
      float fbm(vec2 p){
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.0; a *= 0.5; }
        return v;
      }

      vec3 aces(vec3 x) {
        const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
        return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
      }

      void main() {
        vec2 uv = vUv + uCamPan;            // 拖拽探头偏移
        vec2 centered = uv - 0.5;
        float r = length(centered) * 2.0;
        float ang = atan(centered.y, centered.x);

        // 鼠标影响
        float mDist = distance(uv, uMouseUV);
        float mSpeed = length(uMouseVel);

        // 深色底（带之间透出，不铺满）
        vec3 col = vec3(0.03, 0.04, 0.07);

        // === 远景星尘（网格 hash 生成，~144 颗静态闪烁，纵深背景不抢戏）===
        // 每格一颗星，hash 决定位置/亮度/闪烁相位；极小极暗铺满背景增加纵深
        // 不互动不节拍，区别于前景 35 颗粒子（大/互动/节拍亮）；偏白偏冷融入夜空
        vec2 sGrid = uv * 12.0;
        vec2 sGid = floor(sGrid);
        vec2 sGf = fract(sGrid);
        vec2 sOff = vec2(hash(sGid), hash(sGid + 17.3));
        float sD = distance(sGf, sOff);
        float sTw = hash(sGid + 5.7);
        float sTwinkle = 0.6 + 0.4 * sin(uTime * (0.4 + sTw * 1.2) + sTw * 6.28);
        float sBright = hash(sGid + 9.1);
        float sStar = exp(-sD * 90.0) * sTwinkle * (0.3 + sBright * 0.7);
        col += vec3(0.70, 0.75, 0.85) * sStar * 0.18;

        // === 节拍冲击波（4 层回响，从中心扩散，柔和 exp 衰减环）===
        // uShock0~3: vec4(x, y, startTime, intensity)；速度 0.15 + index*0.05 形成回响层次
        // 4 个展开的 if（避免数组循环）；超过 3 秒自动失效（w=0）
        float shockSum = 0.0;
        // shock0（速度 0.15，最慢）
        { float age = uTime - uShock0.z;
          if (uShock0.w > 0.0 && age >= 0.0 && age <= 3.0) {
            float radius = age * 0.15;
            float dr = distance(uv, uShock0.xy) - radius;
            shockSum += exp(-abs(dr) * 8.0) * exp(-age * 1.2) * uShock0.w;
          } }
        // shock1（速度 0.20）
        { float age = uTime - uShock1.z;
          if (uShock1.w > 0.0 && age >= 0.0 && age <= 3.0) {
            float radius = age * 0.20;
            float dr = distance(uv, uShock1.xy) - radius;
            shockSum += exp(-abs(dr) * 8.0) * exp(-age * 1.2) * uShock1.w;
          } }
        // shock2（速度 0.25）
        { float age = uTime - uShock2.z;
          if (uShock2.w > 0.0 && age >= 0.0 && age <= 3.0) {
            float radius = age * 0.25;
            float dr = distance(uv, uShock2.xy) - radius;
            shockSum += exp(-abs(dr) * 8.0) * exp(-age * 1.2) * uShock2.w;
          } }
        // shock3（速度 0.30，最快）
        { float age = uTime - uShock3.z;
          if (uShock3.w > 0.0 && age >= 0.0 && age <= 3.0) {
            float radius = age * 0.30;
            float dr = distance(uv, uShock3.xy) - radius;
            shockSum += exp(-abs(dr) * 8.0) * exp(-age * 1.2) * uShock3.w;
          } }
        col += uAccent * shockSum * 0.18;   // 亮度系数 0.18（弱化，让位绽放光晕）

        // === 频谱环（弱化辅助：uFreqTex 极坐标采样，低亮度，不抢戏）===
        float aRot = ang + uTime * 0.15;
        float normA = fract((aRot + 3.14159) / 6.28318);
        float freq = texture2D(uFreqTex, vec2(normA, 0.5)).r;
        float freqM = texture2D(uFreqTex, vec2(1.0 - normA, 0.5)).r;
        float freqAvg = (freq + freqM) * 0.5;
        float breath = 1.0 + uEnv * 0.20 + uBass * 0.10;
        float ringR = 0.40 * breath + freqAvg * 0.40;
        float ringW = 0.018 + uEnergy * 0.012;
        float specRing = exp(-pow((r - ringR) / ringW, 2.0)) * (0.3 + freqAvg * 0.5);
        col += uAccent * specRing * 0.45;

        // === 节拍绽放光晕（圆环外围花瓣，节拍绽放膨胀消散，自然不抢戏）===
        // 与频谱环同心，6 瓣角度调制（区别于冲击波均匀环）；比冲击波更柔和弥散
        // 节拍时半径随 energy 缓慢膨胀 + 亮度随 env 冲击消散；静止时低亮基础可见（不看不见）
        float bloomR = ringR + 0.07 + uEnergy * 0.05;     // 节拍外膨胀（energy 慢释放，自然消散）
        float bloomW = 0.05 + uEnv * 0.03;                // 节拍时变宽
        float petal = 0.65 + 0.35 * sin(ang * 6.0 + uTime * 0.25);  // 6 瓣花瓣缓慢旋转
        float bloom = exp(-pow((r - bloomR) / bloomW, 2.0)) * petal;
        bloom *= (0.15 + uEnv * 0.25);                    // 静止 0.15 可见 + 节拍增亮
        col += mix(uTint, uAccent, 0.5) * bloom * 0.25;   // tint/accent 混合，与圆环纯 accent 区分

        // === 点击涟漪（3 个，展开）===
        float age0 = uTime - uRipple0.z;
        if (uRipple0.w > 0.5 && age0 >= 0.0 && age0 <= 2.5)
          col += uAccent * sin(distance(uv, uRipple0.xy) * 30.0 - age0 * 8.0) * exp(-age0 * 1.5) * 0.10;
        float age1 = uTime - uRipple1.z;
        if (uRipple1.w > 0.5 && age1 >= 0.0 && age1 <= 2.5)
          col += uAccent * sin(distance(uv, uRipple1.xy) * 30.0 - age1 * 8.0) * exp(-age1 * 1.5) * 0.10;
        float age2 = uTime - uRipple2.z;
        if (uRipple2.w > 0.5 && age2 >= 0.0 && age2 <= 2.5)
          col += uAccent * sin(distance(uv, uRipple2.xy) * 30.0 - age2 * 8.0) * exp(-age2 * 1.5) * 0.10;

        // === 鼠标光斑（弱化柔化，融入背景不抢戏）===
        // v3.1.17: 降低亮度系数 + 大范围混白降饱和 + 内核缩小，避免 accent 色大面积铺开突兀
        float mouseGlow = exp(-mDist * 3.5) * (0.20 + uMouseStrength * 0.3);
        col += mix(uTint, vec3(0.6, 0.62, 0.68), 0.5) * mouseGlow * 0.30;
        float mouseMid = exp(-mDist * 12.0) * (0.25 + uMouseStrength * 0.4);
        col += mix(uTint, uAccent, 0.3) * mouseMid * 0.20;
        float mouseCore = exp(-mDist * 60.0) * (0.40 + uMouseStrength * 0.3);
        col += vec3(mouseCore * 0.25);

        // === 彗星椭圆拖尾（20 个，展开）===
        // 椭圆长轴沿鼠标移动方向，短轴垂直；速度越快越长轴
        // 头部 uTrail0（最新，亮 accent）→ 尾部 uTrail19（最旧，暗 tint），透明度递减
        float angM = atan(uMouseVel.y, uMouseVel.x);
        float cm = cos(angM), sm = sin(angM);
        float longAxis = 0.02 + mSpeed * 0.15;
        float shortAxis = 0.015;
        // trail0（头部，最新）
        { vec2 d = uv - uTrail0.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail0.z;
          if (uTrail0.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,0.0/20.0)*glow*(1.0 - 0.0/20.0*0.5); } }
        // trail1
        { vec2 d = uv - uTrail1.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail1.z;
          if (uTrail1.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,1.0/20.0)*glow*(1.0 - 1.0/20.0*0.5); } }
        // trail2
        { vec2 d = uv - uTrail2.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail2.z;
          if (uTrail2.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,2.0/20.0)*glow*(1.0 - 2.0/20.0*0.5); } }
        // trail3
        { vec2 d = uv - uTrail3.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail3.z;
          if (uTrail3.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,3.0/20.0)*glow*(1.0 - 3.0/20.0*0.5); } }
        // trail4
        { vec2 d = uv - uTrail4.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail4.z;
          if (uTrail4.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,4.0/20.0)*glow*(1.0 - 4.0/20.0*0.5); } }
        // trail5
        { vec2 d = uv - uTrail5.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail5.z;
          if (uTrail5.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,5.0/20.0)*glow*(1.0 - 5.0/20.0*0.5); } }
        // trail6
        { vec2 d = uv - uTrail6.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail6.z;
          if (uTrail6.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,6.0/20.0)*glow*(1.0 - 6.0/20.0*0.5); } }
        // trail7
        { vec2 d = uv - uTrail7.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail7.z;
          if (uTrail7.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,7.0/20.0)*glow*(1.0 - 7.0/20.0*0.5); } }
        // trail8
        { vec2 d = uv - uTrail8.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail8.z;
          if (uTrail8.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,8.0/20.0)*glow*(1.0 - 8.0/20.0*0.5); } }
        // trail9
        { vec2 d = uv - uTrail9.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail9.z;
          if (uTrail9.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,9.0/20.0)*glow*(1.0 - 9.0/20.0*0.5); } }
        // trail10
        { vec2 d = uv - uTrail10.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail10.z;
          if (uTrail10.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,10.0/20.0)*glow*(1.0 - 10.0/20.0*0.5); } }
        // trail11
        { vec2 d = uv - uTrail11.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail11.z;
          if (uTrail11.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,11.0/20.0)*glow*(1.0 - 11.0/20.0*0.5); } }
        // trail12
        { vec2 d = uv - uTrail12.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail12.z;
          if (uTrail12.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,12.0/20.0)*glow*(1.0 - 12.0/20.0*0.5); } }
        // trail13
        { vec2 d = uv - uTrail13.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail13.z;
          if (uTrail13.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,13.0/20.0)*glow*(1.0 - 13.0/20.0*0.5); } }
        // trail14
        { vec2 d = uv - uTrail14.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail14.z;
          if (uTrail14.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,14.0/20.0)*glow*(1.0 - 14.0/20.0*0.5); } }
        // trail15
        { vec2 d = uv - uTrail15.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail15.z;
          if (uTrail15.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,15.0/20.0)*glow*(1.0 - 15.0/20.0*0.5); } }
        // trail16
        { vec2 d = uv - uTrail16.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail16.z;
          if (uTrail16.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,16.0/20.0)*glow*(1.0 - 16.0/20.0*0.5); } }
        // trail17
        { vec2 d = uv - uTrail17.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail17.z;
          if (uTrail17.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,17.0/20.0)*glow*(1.0 - 17.0/20.0*0.5); } }
        // trail18
        { vec2 d = uv - uTrail18.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail18.z;
          if (uTrail18.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,18.0/20.0)*glow*(1.0 - 18.0/20.0*0.5); } }
        // trail19（尾部，最旧）
        { vec2 d = uv - uTrail19.xy; vec2 dr = vec2(d.x*cm - d.y*sm, d.x*sm + d.y*cm); float age = uTime - uTrail19.z;
          if (uTrail19.w > 0.5 && age >= 0.0 && age <= 0.8) { float ed = sqrt((dr.x/longAxis)*(dr.x/longAxis) + (dr.y/shortAxis)*(dr.y/shortAxis)); float glow = exp(-ed*3.0)*exp(-age*2.5); col += mix(uAccent,uTint,19.0/20.0)*glow*(1.0 - 19.0/20.0*0.5); } }

        // Vignette
        float vignette = smoothstep(1.5, 0.25, length(uv - 0.5) * 1.3);
        col *= vignette;

        // 简化 bloom
        float brightness = dot(col, vec3(0.299, 0.587, 0.114));
        col += col * smoothstep(0.5, 0.9, brightness) * (0.3 + uEnergy * 0.4);

        // film grain
        col += (hash(uv * uResolution + uTime) - 0.5) * 0.04;

        float inten = mix(0.5, 1.0, clamp((uIntensity - 0.2) / 1.3, 0.0, 1.0));
        col *= inten;

        col = aces(col);
        col = pow(col, vec3(1.0 / 2.2));
        gl_FragColor = vec4(col, uAlpha);
      }
    `;
    const fieldMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: fieldFS, transparent: true, depthWrite: false, depthTest: false,
    });
    const fieldGeo = new THREE.PlaneGeometry(2, 2);
    const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
    fieldMesh.position.z = 0;          // 单层：z=0
    fieldMesh.frustumCulled = false;
    scene.add(fieldMesh);

    // ==================================================================
    // 自然粒子点缀（35 颗，CPU 更新 + 软发光点 shader）
    // 少量点缀：value noise 驱动漂浮 + 鼠标附近轻微聚集 + 节拍微微亮一下
    // additive blending，z=1 前景（renderOrder=2，在拖尾之下、频谱环之上）
    // ==================================================================
    const PARTICLE_COUNT = 35;
    const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    const particleSizes = new Float32Array(PARTICLE_COUNT);
    const particleBrightness = new Float32Array(PARTICLE_COUNT);
    const particleColorMix = new Float32Array(PARTICLE_COUNT);
    const particlePhase = new Float32Array(PARTICLE_COUNT);   // noise 驱动的相位（每颗独立）
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 2.0;       // x ∈ [-1, 1]
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 2.0;   // y ∈ [-1, 1]
      particlePositions[i * 3 + 2] = 0.5;                            // z（前景，安全可见）
      particleSizes[i] = 0.5 + Math.random() * 1.5;                  // 0.5x ~ 2x
      particleBrightness[i] = 0.3 + Math.random() * 0.3;             // 0.3 ~ 0.6（低亮度）
      particleColorMix[i] = Math.random();                           // tint→accent 随机偏移
      particlePhase[i] = Math.random() * 100.0;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('aSize', new THREE.BufferAttribute(particleSizes, 1));
    particleGeo.setAttribute('aBrightness', new THREE.BufferAttribute(particleBrightness, 1));
    particleGeo.setAttribute('aColorMix', new THREE.BufferAttribute(particleColorMix, 1));
    // 粒子 uniforms：uTint/uAccent 共享 field uniforms 的 Color 对象（gsap 同步更新）
    const particleUniforms = {
      uBeatPulse: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uTint: { value: tintColor },
      uAccent: { value: accentColor },
    };
    const particleVS = `
      attribute float aSize;
      attribute float aBrightness;
      attribute float aColorMix;
      uniform float uBeatPulse;
      uniform float uPixelRatio;
      uniform vec3 uTint, uAccent;
      varying float vBrightness;
      varying vec3 vColor;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // 大小随亮度脉动 + 节拍时微微变大（不爆发）
        float pulse = 1.0 + uBeatPulse * 0.15;
        gl_PointSize = aSize * 22.0 * pulse * uPixelRatio;
        vBrightness = aBrightness * (1.0 + uBeatPulse * 0.4);
        vColor = mix(uTint, uAccent, aColorMix);
      }
    `;
    const particleFS = `
      precision highp float;
      varying float vBrightness;
      varying vec3 vColor;
      void main() {
        vec2 cp = gl_PointCoord - 0.5;
        float d = length(cp);
        if (d > 0.5) discard;
        // 软发光圆点：核心亮，边缘 exp 衰减
        float glow = exp(-d * 5.5);
        gl_FragColor = vec4(vColor * glow * vBrightness, glow * 0.5);
      }
    `;
    const particleMat = new THREE.ShaderMaterial({
      uniforms: particleUniforms,
      vertexShader: particleVS,
      fragmentShader: particleFS,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const particleMesh = new THREE.Points(particleGeo, particleMat);
    particleMesh.renderOrder = 2;         // 前景，在拖尾（field shader）之下
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    // value noise（CPU 端，驱动粒子速度方向，连续无突变，自然漂浮感）
    const pHash = (x: number, y: number) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const pNoise = (x: number, y: number) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const a = pHash(ix, iy);
      const b = pHash(ix + 1, iy);
      const c = pHash(ix, iy + 1);
      const d = pHash(ix + 1, iy + 1);
      return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
    };

    // shader 编译错误检测：在 animate 首次 render 后进行（renderer.compile 是惰性的）
    renderer.compile(scene, camera);

    // ==================================================================
    // 单 pass 直接渲染——所有效果（bloom/vignette/grain/RGBShift/ACES）都在 shader 内完成
    // 彻底移除 EffectComposer，避免后处理链的 HDR renderTarget / OutputPass 兼容问题导致黑屏
    // ==================================================================

    // 入场渐显（场域渐显）+ fallback 确保 uAlpha 不卡在 0
    gsap.to(uniforms.uAlpha, { value: 1, duration: 1.8, ease: 'power2.out' });

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
    // === v2.3 视觉响应：蓄能池 energy + ADSR 包络 env（保留，无阶跃） ===
    //   energy：低通积累，驱动后处理(bloom/rgbShift) + 持续型 uniform(场域密度)
    //   env：ADSR 包络，驱动节拍型 uniform（场域微暖）；平滑趋近，无任何瞬时阶跃
    let energy = 0;
    let env = 0;
    let envPhase: 'idle' | 'att' | 'dec' | 'sus' | 'rel' = 'idle';
    let envT = 0;
    const bpmInit = player.getBpm() || 120;
    let beatInterval = 60 / bpmInit;       // BPM 可能分析完成后才拿到，onBeat 内刷新
    const A = 0.05, D = 0.15, S = 0.55;    // ADSR attack/decay(秒) 与 sustain 电平
    let prevTime = performance.now();
    let beatCount = 0;
    let shaderChecked = false;   // v3.1.10: 首次 render 后检测一次 shader 编译

    // === 歌词协同状态（场域与歌词 1+1=3） ===
    //   lyricPulse：歌词切换时注入微小能量脉冲（场域应答）
    //   lyricDensity：0=间奏(场域更活跃) 1=密集副歌(场域收敛让歌词主导)
    let prevActiveLyricIdx = -1;
    let lyricPulse = 0;
    let lyricDensity = 0.5;

    // === 鼠标交互状态（精美：移动搅动 + 点击波纹 + 拖拽探头 + 流体推动 + 拖尾光迹） ===
    const mouseUV = new THREE.Vector2(0.5, 0.5);
    const mouseUVTarget = new THREE.Vector2(0.5, 0.5);
    let mouseVelocity = 0;
    let mouseStrength = 0;
    // v3.1.8: 鼠标速度向量（方向 + 幅度），用于 shader 里的流体推动
    const mouseVelVec = new THREE.Vector2(0, 0);
    const mouseVelVecTarget = new THREE.Vector2(0, 0);
    let lastPointerX = 0, lastPointerY = 0, lastPointerT = 0;
    let isDragging = false;
    let dragDeltaX = 0, dragDeltaY = 0;
    const ripples: { uv: THREE.Vector2; time: number }[] = [];
    // v3.1.12: 彗星拖尾轨迹（FIFO，20 个历史位置；头部最新亮 accent，尾部最旧暗 tint）
    const TRAIL_MAX = 20;
    const trail: { uv: THREE.Vector2; time: number }[] = [];
    let lastTrailTime = 0;

    // === 节拍来源：player.onBeat（离线预分析为主，realtime 为 fallback） ===
    //   v3.1.4: 强节拍响应——energy 注入 25% + 慢释放 0.80，让节拍冲击持续可见
    // v3.1.13: 节拍冲击波状态（4 槽位 FIFO 循环替换最旧）+ 粒子亮度脉冲
    const SHOCK_MAX = 4;
    const shocks: { t: number; intensity: number }[] = [];
    for (let i = 0; i < SHOCK_MAX; i++) shocks.push({ t: -10, intensity: 0 });
    let shockWriteIdx = 0;   // 环形写入指针（每次写最旧的槽位）
    const shockUniforms = [uniforms.uShock0, uniforms.uShock1, uniforms.uShock2, uniforms.uShock3];
    let particleBeatPulse = 0;   // 粒子节拍亮度脉冲（0.3 秒衰减回正常）
    const offBeat = player.onBeat((time: number) => {
      const impulse = 0.7 + smoothBass * 0.3;
      energy = energy * 0.75 + impulse * 0.25;   // 注入 25%（强节拍响应）
      envPhase = 'att'; envT = 0;                 // 触发 ADSR
      beatCount++;
      const curBpm = player.getBpm();
      if (curBpm > 0) beatInterval = 60 / curBpm;
      // v3.1.13: 节拍冲击波 FIFO（4 槽位循环替换最旧）+ 粒子亮度脉冲
      // 中心 0.5,0.5 + 当前时间 + bass 强度作为 intensity
      const shockIntensity = 0.5 + smoothBass * 0.5;
      shocks[shockWriteIdx] = { t: uniforms.uTime.value, intensity: shockIntensity };
      shockWriteIdx = (shockWriteIdx + 1) % SHOCK_MAX;
      for (let i = 0; i < SHOCK_MAX; i++) {
        (shockUniforms[i].value as THREE.Vector4).set(0.5, 0.5, shocks[i].t, shocks[i].intensity);
      }
      particleBeatPulse = 1.0;   // 粒子亮度临时提升（animate 里 0.3 秒衰减回正常）
    });

    // 可视化频谱仍用 AnalyserNode（v2.2 删了 crossOrigin，频谱不再静默）
    const setupAnalysers = () => {
      const a = player.getAnalyser();
      if (a && !analyser) { analyser = a; freqData = new Uint8Array(a.frequencyBinCount); }
    };
    player.setAnalyserReadyHandler?.(setupAnalysers);
    setTimeout(setupAnalysers, 500);

    // === 鼠标事件（移动流体推动 + 点击波纹 + 拖拽探头 + 拖尾光迹） ===
    const onPointerMove = (e: PointerEvent) => {
      const nowMs = performance.now();
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      const dtMs = Math.max(1, nowMs - lastPointerT);
      // 鼠标速度（像素/ms），低通跟随
      const speed = Math.sqrt(dx * dx + dy * dy) / dtMs;
      mouseVelocity = mouseVelocity * 0.7 + speed * 0.3;
      // v3.1.8: 鼠标速度向量（归一化方向 * 幅度），用于 shader 流体推动
      // y 翻转（WebGL UV 原点在左下）
      const newUvx = e.clientX / window.innerWidth;
      const newUvy = 1.0 - e.clientY / window.innerHeight;
      // 速度向量：方向 * 速度幅度，clamp 到合理范围
      const velScale = Math.min(speed * 0.15, 0.5);
      const dirLen = Math.sqrt(dx * dx + dy * dy) || 1;
      mouseVelVecTarget.set((dx / dirLen) * velScale, -(dy / dirLen) * velScale);
      lastPointerX = e.clientX; lastPointerY = e.clientY; lastPointerT = nowMs;
      mouseUVTarget.set(newUvx, newUvy);
      // v3.1.12: 彗星拖尾——移动时每 20ms 记录一个位置（更密，长拖尾感）
      if (nowMs - lastTrailTime > 20 && speed > 0.05) {
        trail.push({ uv: new THREE.Vector2(newUvx, newUvy), time: nowMs });
        if (trail.length > TRAIL_MAX) trail.shift();
        lastTrailTime = nowMs;
      }
      // 拖拽：累积相机微移偏移（探头感，非轨道）
      if (isDragging) {
        dragDeltaX += dx * 0.0003;
        dragDeltaY -= dy * 0.0003;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      // 仅 canvas 自身接收事件时触发（UI 元素由更高 z-index 拦截）
      if (e.target !== canvasRef.current) return;
      isDragging = true;
      lastPointerX = e.clientX; lastPointerY = e.clientY; lastPointerT = performance.now();
      // 涟漪：记录 uv + 时间戳（shader 里从该点向外波动扩散）
      const uvx = e.clientX / window.innerWidth;
      const uvy = 1.0 - e.clientY / window.innerHeight;
      ripples.push({ uv: new THREE.Vector2(uvx, uvy), time: performance.now() });
      if (ripples.length > RIPPLE_MAX) ripples.shift();
    };
    const onPointerUp = () => { isDragging = false; };
    const onPointerLeaveWin = () => { isDragging = false; mouseVelocity *= 0.3; };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    canvasRef.current?.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('blur', onPointerLeaveWin);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - prevTime) / 1000, 0.05);
      prevTime = now;
      uniforms.uTime.value += dt;
      // uAlpha fallback：确保不卡在 0（gsap 万一没执行也能渐显）
      if (uniforms.uAlpha.value < 0.999) {
        uniforms.uAlpha.value = Math.min(1, uniforms.uAlpha.value + dt * 0.6);
      }

      if (analyser && freqData && player.isPlaying) {
        analyser.getByteFrequencyData(freqData as any);
        const bands = sampleFrequencyBands(freqData, analyser.context.sampleRate, analyser.fftSize);
        // 音频平滑（mix 0.15 阻尼，避免闪烁）
        smoothBass = smoothLerp(smoothBass, bands.bass, 0.15);
        smoothMid = smoothLerp(smoothMid, bands.mid, 0.15);
        smoothTreb = smoothLerp(smoothTreb, bands.treble, 0.18);
        smoothEnergy = smoothLerp(smoothEnergy, bands.level, 0.15);
        // v3.1.7: 把 FFT 数据写入纹理，传给 shader 做极坐标频谱环
        // 对数采样 128 个 bin，低频密集高频稀疏，写入 RGBA 的 R 通道（0~255）
        const fb = freqData.length;
        for (let i = 0; i < FREQ_BINS; i++) {
          const tt = i / (FREQ_BINS - 1);
          const idx = Math.floor(Math.pow(tt, 1.7) * (fb * 0.65));
          const v = (freqData[Math.min(fb - 1, idx)] || 0);
          freqTexData[i * 4] = v;
          freqTexData[i * 4 + 1] = v;
          freqTexData[i * 4 + 2] = v;
          freqTexData[i * 4 + 3] = 255;
        }
        freqTex.needsUpdate = true;
      } else {
        smoothBass *= 0.94; smoothMid *= 0.94; smoothTreb *= 0.94; smoothEnergy *= 0.94;
        // 暂停时频谱纹理缓慢衰减
        for (let i = 0; i < FREQ_BINS * 4; i += 4) {
          freqTexData[i] = Math.floor(freqTexData[i] * 0.92);
          freqTexData[i + 1] = freqTexData[i];
          freqTexData[i + 2] = freqTexData[i];
        }
        freqTex.needsUpdate = true;
      }

      // === v2.3 蓄能池慢释放 + ADSR 包络（保留，平滑趋近，无阶跃） ===
      energy *= Math.pow(0.80, dt);   // 慢释放（节拍间 energy 保持可见）
      envT += dt;
      let envTarget = 0;
      if (envPhase === 'att') { envTarget = 1.0; if (envT >= A) { envPhase = 'dec'; envT = 0; } }
      else if (envPhase === 'dec') { envTarget = S; if (envT >= D) { envPhase = 'sus'; envT = 0; } }
      else if (envPhase === 'sus') { envTarget = S; if (envT >= beatInterval * 0.55) { envPhase = 'rel'; envT = 0; } }
      else if (envPhase === 'rel') { envTarget = 0.0; if (envT >= beatInterval * 0.45) { envPhase = 'idle'; } }
      const envK = (envPhase === 'att') ? 1 - Math.exp(-dt / 0.012) : 1 - Math.exp(-dt / 0.08);
      env += (envTarget - env) * envK;

      // === 歌词协同：监测 activeLyricIdx 变化（场域应答 + 间奏/密集判定） ===
      const lyrics = player.lyrics;
      const curTime = player.currentTime;
      let curActiveIdx = -1;
      for (let i = 0; i < lyrics.length; i++) {
        if (curTime >= lyrics[i].time - 0.3) curActiveIdx = i; else break;
      }
      if (curActiveIdx !== prevActiveLyricIdx && curActiveIdx >= 0) {
        // 歌词切换 → 注入微小能量脉冲（场域微微"应答"）
        energy = energy * 0.92 + 0.18 * 0.08;
        lyricPulse = 1.0;
        // 间奏/密集判定：相邻歌词时间差
        if (prevActiveLyricIdx >= 0 && prevActiveLyricIdx < lyrics.length && curActiveIdx < lyrics.length) {
          const dtLyric = lyrics[curActiveIdx].time - lyrics[prevActiveLyricIdx].time;
          if (dtLyric > 8) {
            // 间奏：场域更活跃（bloom 目标值提高）
            lyricDensity = Math.max(0, lyricDensity - 0.25);
          } else if (dtLyric < 2) {
            // 密集副歌：场域收敛（让歌词主导）
            lyricDensity = Math.min(1, lyricDensity + 0.15);
          } else {
            // 正常：缓慢回归中性
            lyricDensity += (0.5 - lyricDensity) * 0.2;
          }
        }
        prevActiveLyricIdx = curActiveIdx;
      }
      // 间奏持续（无歌词切换或距上一句 > 8s）：lyricDensity 缓慢趋向 0（场域活跃）
      if (curActiveIdx >= 0 && curActiveIdx < lyrics.length) {
        const sinceLast = curTime - lyrics[curActiveIdx].time;
        const hasNext = curActiveIdx < lyrics.length - 1;
        const nextDist = hasNext ? lyrics[curActiveIdx + 1].time - curTime : 999;
        if (sinceLast > 8 && nextDist > 3) {
          lyricDensity += (0 - lyricDensity) * (1 - Math.exp(-dt / 4));
        }
      }
      lyricPulse *= Math.pow(0.4, dt);   // 衰减

      // === 鼠标交互更新（低延迟，精美） ===
      // mouseUV lerp 0.08 平滑跟随鼠标
      mouseUV.x += (mouseUVTarget.x - mouseUV.x) * (1 - Math.exp(-dt / 0.12));
      mouseUV.y += (mouseUVTarget.y - mouseUV.y) * (1 - Math.exp(-dt / 0.12));
      uniforms.uMouseUV.value.copy(mouseUV);
      // 鼠标速度→搅动强度（min(vel*0.08, 0.8)）
      const mouseTarget = Math.min(mouseVelocity * 0.08, 0.8);
      mouseStrength += (mouseTarget - mouseStrength) * (1 - Math.exp(-dt / 0.15));
      uniforms.uMouseStrength.value = mouseStrength;
      // v3.1.8: 鼠标速度向量 lerp 平滑，静止时衰减归零（流体推动方向）
      mouseVelVec.x += (mouseVelVecTarget.x - mouseVelVec.x) * (1 - Math.exp(-dt / 0.2));
      mouseVelVec.y += (mouseVelVecTarget.y - mouseVelVec.y) * (1 - Math.exp(-dt / 0.2));
      uniforms.uMouseVel.value.copy(mouseVelVec);
      mouseVelVecTarget.multiplyScalar(Math.pow(0.05, dt));  // 静止时目标归零
      // 静止时 mouseVelocity 衰减 → uMouseStrength 归零，云雾回归自然
      mouseVelocity *= Math.pow(0.1, dt);
      // 拖拽相机微移：lerp 平滑跟随累积偏移，松手后缓慢回中（探头感）
      const camPan = uniforms.uCamPan.value as THREE.Vector2;
      camPan.x += (dragDeltaX - camPan.x) * (1 - Math.exp(-dt / 0.3));
      camPan.y += (dragDeltaY - camPan.y) * (1 - Math.exp(-dt / 0.3));
      dragDeltaX *= Math.pow(0.05, dt);
      dragDeltaY *= Math.pow(0.05, dt);
      // 涟漪 age 更新，超过 2.5s 移除（FIFO）
      for (let i = ripples.length - 1; i >= 0; i--) {
        if ((now - ripples[i].time) / 1000 > 2.5) ripples.splice(i, 1);
      }
      // 同步涟漪到 3 个单独 vec4 uniform（避免数组 uniform 兼容问题）
      const rippleUniforms = [uniforms.uRipple0, uniforms.uRipple1, uniforms.uRipple2];
      for (let i = 0; i < RIPPLE_MAX; i++) {
        if (i < ripples.length) {
          const r = ripples[i];
          (rippleUniforms[i].value as THREE.Vector4).set(r.uv.x, r.uv.y, r.time / 1000, 1);
        } else {
          (rippleUniforms[i].value as THREE.Vector4).set(0, 0, -10, 0);
        }
      }
      // v3.1.12: 彗星拖尾 age 更新，超过 0.8s 移除，同步到 20 个 vec4 uniform
      // 反序映射：uTrail0 = 最新点（彗星头部，亮 accent），uTrail19 = 最旧点（尾部，暗 tint）
      for (let i = trail.length - 1; i >= 0; i--) {
        if ((now - trail[i].time) / 1000 > 0.8) trail.splice(i, 1);
      }
      const trailUniforms = [uniforms.uTrail0, uniforms.uTrail1, uniforms.uTrail2, uniforms.uTrail3,
        uniforms.uTrail4, uniforms.uTrail5, uniforms.uTrail6, uniforms.uTrail7, uniforms.uTrail8,
        uniforms.uTrail9, uniforms.uTrail10, uniforms.uTrail11, uniforms.uTrail12, uniforms.uTrail13,
        uniforms.uTrail14, uniforms.uTrail15, uniforms.uTrail16, uniforms.uTrail17, uniforms.uTrail18,
        uniforms.uTrail19];
      for (let i = 0; i < TRAIL_MAX; i++) {
        // trail 数组：[0]=最旧，[len-1]=最新；uTrail{i} 想要第 i 新（i=0 最新）
        const trailIdx = trail.length - 1 - i;
        if (trailIdx >= 0) {
          const tr = trail[trailIdx];
          (trailUniforms[i].value as THREE.Vector4).set(tr.uv.x, tr.uv.y, tr.time / 1000, 1);
        } else {
          (trailUniforms[i].value as THREE.Vector4).set(0, 0, -10, 0);
        }
      }

      // v3.1.13: 自然粒子点缀 CPU 更新（35 颗，开销极小）
      // value noise 驱动速度方向（连续漂浮）+ 鼠标附近轻微聚集（系数 0.02）+ 边界包裹
      const mouseWorldX = mouseUV.x * 2.0 - 1.0;   // [0,1] → [-1,1] 世界坐标
      const mouseWorldY = mouseUV.y * 2.0 - 1.0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const px = particlePositions[i * 3];
        const py = particlePositions[i * 3 + 1];
        // value noise 驱动速度方向（连续无突变，自然漂浮感）
        const n = pNoise(px * 0.6 + particlePhase[i], py * 0.6 + particlePhase[i] * 1.3);
        const angle = n * Math.PI * 4.0;
        const speed = 0.04;
        let vx = Math.cos(angle) * speed;
        let vy = Math.sin(angle) * speed;
        // 鼠标附近轻微聚集（距离 < 0.25 时给一点向鼠标的力，系数 0.02，很弱）
        const dx = mouseWorldX - px;
        const dy = mouseWorldY - py;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 0.0625 && dist2 > 0.0001) {   // 0.25^2 = 0.0625
          const dist = Math.sqrt(dist2);
          vx += (dx / dist) * 0.02;
          vy += (dy / dist) * 0.02;
        }
        particlePositions[i * 3] = px + vx * dt;
        particlePositions[i * 3 + 1] = py + vy * dt;
        // 边界包裹（飞出从另一边回来）
        if (particlePositions[i * 3] > 1.05) particlePositions[i * 3] = -1.05;
        if (particlePositions[i * 3] < -1.05) particlePositions[i * 3] = 1.05;
        if (particlePositions[i * 3 + 1] > 1.05) particlePositions[i * 3 + 1] = -1.05;
        if (particlePositions[i * 3 + 1] < -1.05) particlePositions[i * 3 + 1] = 1.05;
      }
      particleGeo.attributes.position.needsUpdate = true;
      // 粒子节拍亮度脉冲衰减（0.3 秒衰减回正常）
      particleBeatPulse = Math.max(0, particleBeatPulse - dt / 0.3);
      particleUniforms.uBeatPulse.value = particleBeatPulse;

      // === 更新所有 uniforms（全部读 energy/env，无瞬时阶跃） ===
      uniforms.uBass.value = smoothBass;
      uniforms.uMid.value = smoothMid;
      uniforms.uTreble.value = smoothTreb;
      uniforms.uEnergy.value = energy;
      uniforms.uEnv.value = env;

      // === v3.1.13: 单层 shader + 35 颗自然粒子点缀（CPU 更新）===
      // 拖拽探头 uCamPan 已在上方同步；其余效果（薄纱/冲击波/频谱环/拖尾/光斑/涟漪）由 shader 完成

      // 调试信息
      (window as any).__beatDebug = {
        count: beatCount, beat: env, energy: energy, bass: smoothBass,
        mid: smoothMid, treble: smoothTreb,
        ripples: ripples.length, mouse: mouseStrength,
        renderMode: 'single-flow',
        uAlpha: uniforms.uAlpha.value,
      };
      // 同步 CSS 变量驱动沉浸式歌词（beat 脉冲 + 封面色辉光）— 用平滑 env（节拍包络）
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--beat-pulse', String(env));
      rootStyle.setProperty('--cover-tint',
        `rgb(${(tintColor.r * 255) | 0},${(tintColor.g * 255) | 0},${(tintColor.b * 255) | 0})`);
      rootStyle.setProperty('--cover-accent',
        `rgb(${(accentColor.r * 255) | 0},${(accentColor.g * 255) | 0},${(accentColor.b * 255) | 0})`);
      rootStyle.setProperty('--lyric-active', curActiveIdx >= 0 ? '1' : '0');

      renderer.render(scene, camera);

      // v3.1.13: 首次 render 后检测 shader 编译状态（renderer.compile 是惰性的，真正编译在首次 render）
      // 单层架构 + 粒子材质：检测 fieldMat 与 particleMat
      if (!shaderChecked) {
        shaderChecked = true;
        const gl2 = renderer.getContext() as WebGLRenderingContext | null;
        const mats: [string, any][] = [['field', fieldMat], ['particle', particleMat]];
        let failed = false;
        let failLog = '';
        for (const [name, mat] of mats) {
          const prog = mat.program;
          const glProg = prog?.program || prog;
          if (gl2 && glProg && gl2.isProgram(glProg)) {
            const linked = gl2.getProgramParameter(glProg, gl2.LINK_STATUS);
            if (!linked) {
              failed = true;
              failLog += `[${name}] LINK: ` + (gl2.getProgramInfoLog(glProg) || 'unknown') + '\n';
              const shs = gl2.getAttachedShaders(glProg);
              if (shs) for (const sh of shs) {
                if (!gl2.getShaderParameter(sh, gl2.COMPILE_STATUS)) {
                  failLog += '  COMPILE: ' + (gl2.getShaderInfoLog(sh) || '') + '\n';
                }
              }
            }
          }
        }
        if (failed) {
          console.error('[Visual] Shader LINK/COMPILE FAILED:\n', failLog);
          // 在画面上显示错误（帮助远程诊断，不再静默黑屏）
          const dbg = document.createElement('div');
          dbg.id = 'shader-err';
          dbg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:rgba(20,0,0,.92);color:#ff6b6b;padding:20px 28px;font:13px/1.5 monospace;max-width:80vw;max-height:80vh;overflow:auto;white-space:pre-wrap;border:1px solid #ff6b6b;border-radius:8px;pointer-events:none';
          dbg.textContent = 'Shader 编译失败:\n\n' + failLog + '\n请把此信息发给开发者';
          document.body.appendChild(dbg);
        } else {
          console.log('[Visual] field shader linked OK ✓ (single layer)');
        }
      }
    };
    animate();

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      (uniforms.uResolution.value as THREE.Vector2).set(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    // 封面主色 K-Means 提取（保留现有逻辑，驱动 tint + accent 双色 → 流光色彩）
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

    engineRef.current = { uniforms, updateCover, renderer, scene };

    return () => {
      cancelAnimationFrame(animId);
      offBeat();
      window.removeEventListener('resize', onResize);
      // 鼠标事件清理
      window.removeEventListener('pointermove', onPointerMove);
      canvasRef.current?.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('blur', onPointerLeaveWin);
      // 几何/材质清理（fieldMat 单层 + v3.1.13 粒子系统）
      fieldGeo.dispose(); fieldMat.dispose();
      particleGeo.dispose(); particleMat.dispose();
      renderer.dispose();
      delete (window as any).__updateCover;
      delete (window as any).__beatDebug;
    };
  }, []);

  // 强度切换：v3.1 shader 用 uIntensity 控制亮度系数，不重建场景
  useEffect(() => {
    const eng = engineRef.current;
    if (eng?.uniforms) eng.uniforms.uIntensity.value = intensity;
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
// 节拍调试显示（按需开关，不常驻）— v2.2 增加 BPM 与分析状态
// ====================================================================
const BeatDebugOverlay: React.FC<{ visible: boolean; bpm: number; analyzing: boolean }> = ({ visible, bpm, analyzing }) => {
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
  const statusText = analyzing
    ? '— 分析中...'
    : (bpm > 0 ? '已分析' : '未分析');
  const statusColor = analyzing ? '#ffd23f' : (bpm > 0 ? '#0f0' : '#888');
  return (
    <div className="absolute top-16 left-4 z-[55] bg-black/70 text-green-400 font-mono text-xs px-3 py-2 rounded pointer-events-none">
      <div>BEAT COUNT: {info.count}</div>
      <div>BPM: {bpm > 0 ? bpm.toFixed(1) : '—'} <span style={{ color: statusColor }}>[{statusText}]</span></div>
      <div>ENV: {(info.beat || 0).toFixed(3)} / ENERGY: {(info.energy || 0).toFixed(3)}</div>
      <div>BASS: {(info.bass || 0).toFixed(3)} / MID: {(info.mid || 0).toFixed(3)} / TREBLE: {(info.treble || 0).toFixed(3)}</div>
      <div>BLOOM: {(info.bloom || 0).toFixed(2)}</div>
      <div style={{ color: info.count > 0 ? '#0f0' : '#888' }}>
        {info.count > 0 ? '✓ 卡点触发中' : (analyzing ? '— 分析中' : '— 等待节拍')}
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
  const [isDraggingProgress, setDraggingProgress] = useState(false);   // v3.1.5: 进度条拖拽态
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null); // 拖拽预览时间
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);            // v3.1.5: 频谱画布
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
  useSpectrum(spectrumCanvasRef);   // v3.1.5: 底部播放栏上方频谱

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
  // v3.1 色彩呼吸场域主角：当前行前后各 4 行（过去行被雾吞没，未来行虚化）
  const VISIBLE_RANGE = 4;
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
      {/* Three.js 视觉画布（接收鼠标交互：拖拽轨道 + 点击涟漪；UI 层 z-30+ 拦截控件） */}
      <canvas ref={canvasRef} className="absolute inset-0 z-10" />
      {/* 节拍调试显示（按需，默认关闭） */}
      <BeatDebugOverlay visible={showDebug} bpm={player.bpm} analyzing={player.beatAnalyzing} />
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
          <span className="text-[9px] text-[#00f5d4]/70 ml-1.5 font-mono">v{__APP_VERSION__}</span>
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
            <div className="lyrics-field" ref={lyricsRef}>
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

        {/* v3.1.5: 底部播放栏上方频谱可视化（居中镜像，封面色渐变） */}
        <div className="spectrum-wrap">
          <canvas ref={spectrumCanvasRef} className="spectrum-canvas" />
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
              <span className="text-[10px] text-white/35 w-10 text-right font-mono">{formatTime(player.duration > 0 ? seekPreviewTime ?? player.currentTime : player.currentTime)}</span>
              <div
                className={`flex-1 progress-track ${isDraggingProgress ? 'is-dragging' : ''}`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const seekTo = (clientX: number) => {
                    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                    setSeekPreviewTime(ratio * (player.duration || 0));
                    return ratio;
                  };
                  seekTo(e.clientX);
                  setDraggingProgress(true);
                  const onMove = (ev: PointerEvent) => { seekTo(ev.clientX); };
                  const onUp = (ev: PointerEvent) => {
                    const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                    player.seekRatio(ratio);
                    setDraggingProgress(false);
                    setSeekPreviewTime(null);
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                  };
                  window.addEventListener('pointermove', onMove);
                  window.addEventListener('pointerup', onUp);
                }}
              >
                <div className="progress-fill" style={{ width: `${(player.duration > 0 ? ((seekPreviewTime ?? player.currentTime) / player.duration) * 100 : 0)}%` }} />
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
            <div className="text-[10px] font-bold tracking-[0.1em] text-white/25 uppercase mb-2">视觉强度</div>
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
