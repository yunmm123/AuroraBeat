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
// Three.js 视觉引擎 v3 — 高级美感重做
// 设计参考（联网研究）：
//   - Apple Music 流光背景：多份封面副本 + twist 扭曲 + 高斯模糊（fragment shader）
//   - HAS Fluid Blob / SDF smin：多球有机融合做能量核（替代生硬 wireframe）
//   - Spotify/网易云取色驱动：K-Means 主色提取驱动整页色调
//   - codrops 双壳球：实体 + backside fresnel halo
//   - staging 原则：一次一个焦点，背景低频缓动，主体 beat 触发式
// 后处理修正（避免"丑"）：
//   - bloom threshold 0.9（不再全屏泛白过曝）
//   - RGBShift 0.002 极小且仅 beat 脉冲
//   - ACES tone mapping + 删除常驻 Afterimage（拖尾易俗气）
// 节拍检测：lowpass(150Hz)+smoothing=0 专用链路 + 时域RMS + 自适应阈值
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
    const scene = new THREE.Scene();
    // 带色相的近黑底（蓝调黑），避免纯黑扁平
    scene.fog = new THREE.FogExp2(0x07080e, 0.028);
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 6.5);
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    // ACES tone mapping 是避免 WebGL 过曝白斑的关键
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 封面主色（K-Means 提取，驱动整页色调）
    const tintColor = new THREE.Color('#7a8fa6');
    const accentColor = new THREE.Color('#c8a87a'); // 副色（暖调高光）

    // 点纹理 — 高斯软核 sprite，景深尘埃用
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

    // ==================================================================
    // 层1 背景：Apple Music 风格流光全屏 shader
    // 多份封面副本 + twist 扭曲 + 高斯模糊（逆向自 Apple Music Metal shader）
    // 无封面时回退到 tint 色 + 程序化噪声流光
    // ==================================================================
    const bgUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uBeat: { value: 0 },
      uAlpha: { value: 0 },
      uTintColor: { value: tintColor },
      uAccentColor: { value: accentColor },
      uCoverTex: { value: null as THREE.Texture | null },
      uHasCover: { value: 0 },
      uAspect: { value: window.innerWidth / window.innerHeight },
    };
    const bgFS = `
      uniform float uTime, uBass, uBeat, uAlpha, uHasCover, uAspect;
      uniform vec3 uTintColor, uAccentColor;
      uniform sampler2D uCoverTex;
      varying vec2 vUv;
      ${NOISE_GLSL}
      // Apple Music 风格 twist：在 offset 半径内对坐标施加旋转，角度随距离平方衰减
      vec2 twist(vec2 p, vec2 offset, float radius, float angle) {
        vec2 d = p - offset;
        float dist = length(d);
        float t = angle * (1.0 - clamp(dist/radius, 0.0, 1.0) * clamp(dist/radius, 0.0, 1.0));
        float c = cos(t), s = sin(t);
        return offset + mat2(c, -s, s, c) * d;
      }
      void main() {
        vec2 uv = vUv;
        vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
        float t = uTime * 0.08;
        vec3 col = vec3(0.0);
        if (uHasCover > 0.5) {
          // 多份封面副本 + twist + 高斯模糊
          vec2 offs[4];
          offs[0] = vec2( 0.35, 0.3); offs[1] = vec2(-0.35,-0.3);
          offs[2] = vec2(-0.3, 0.35); offs[3] = vec2( 0.3,-0.35);
          float angs[4];
          angs[0]=0.8; angs[1]=-0.7; angs[2]=0.6; angs[3]=-0.5;
          for (int i = 0; i < 4; i++) {
            vec2 tp = twist(p, offs[i], 0.9, angs[i] + uBass * 0.4);
            vec2 suv = tp / vec2(uAspect, 1.0) + 0.5;
            suv = clamp(suv, vec2(0.02), vec2(0.98));
            // 多次采样模拟高斯模糊
            vec3 s = vec3(0.0); float wsum = 0.0;
            for (int x = -2; x <= 2; x++) {
              for (int y = -2; y <= 2; y++) {
                vec2 o = vec2(float(x), float(y)) * 0.012;
                float w = 1.0 / (1.0 + float(x*x + y*y));
                s += texture2D(uCoverTex, suv + o).rgb * w;
                wsum += w;
              }
            }
            s /= wsum;
            col += s * 0.25;
          }
          col = mix(col, col * uTintColor * 1.6, 0.35);
          // 大幅压暗做背景，前景主角才突出
          col *= 0.32;
        } else {
          // 无封面：tint 色 + fbm 流光
          float n = fbm(vec3(p * 1.8, t)) * 0.5 + 0.5;
          float n2 = fbm(vec3(p * 0.8 + 5.0, t * 0.6)) * 0.5 + 0.5;
          col = mix(uTintColor * 0.18, uAccentColor * 0.12, n);
          col += vec3(0.02, 0.025, 0.04) * n2;
          col *= 0.6;
        }
        // bass 命中时整体轻微提亮 + 流光加速
        col *= 1.0 + uBass * 0.25;
        // beat 闪一下暖色高光
        col += uAccentColor * uBeat * 0.15;
        // 边缘暗角增强焦点
        float vig = smoothstep(1.2, 0.3, length(p));
        col *= mix(0.5, 1.0, vig);
        gl_FragColor = vec4(col, uAlpha);
      }
    `;
    const bgMat = new THREE.ShaderMaterial({
      uniforms: bgUniforms, vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: bgFS, transparent: true, depthWrite: false, depthTest: false,
    });
    const bgGeo = new THREE.PlaneGeometry(2, 2);
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.frustumCulled = false;
    // 用单独的正交相机渲染背景，不受主相机影响
    const bgScene = new THREE.Scene();
    const bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    bgScene.add(bgMesh);

    // ==================================================================
    // 层2 主体：SDF 能量核（多球 smin 有机融合 + 菲涅尔 + beat 脉冲）
    // 参考 HAS Fluid Blob：bass→融合度，mid→漂移，high→粗糙度
    // 替代生硬 wireframe icosahedron，做"流体有机"的高级感
    // ==================================================================
    const coreUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uAlpha: { value: 0 },
      uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
    };
    // 用高细分 IcosahedronGeometry + 顶点 shader 位移模拟 SDF 有机融合
    // （完整 raymarch 在 WebGL 略重，顶点位移性价比更高且 5060 完全够）
    const coreVS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat;
      varying vec3 vNormal;
      varying vec3 vPos;
      varying float vDisp, vBeat;
      ${NOISE_GLSL}
      // 多球 smin 有机融合位移：3 个噪声中心模拟 3 个球融合
      float blobField(vec3 p, float merge) {
        float k = mix(0.6, 1.4, merge); // bass 增大 k 越融合
        float d1 = length(p - vec3(0.0));
        float d2 = length(p - vec3(0.55 + uMid*0.3, 0.2, -0.15));
        float d3 = length(p - vec3(-0.45, -0.3 + uMid*0.2, 0.2));
        // smin
        float h1 = clamp(0.5 + 0.5*(d2-d1)/k, 0.0, 1.0);
        float m12 = mix(d2, d1, h1) - k*h1*(1.0-h1);
        float h2 = clamp(0.5 + 0.5*(d3-m12)/k, 0.0, 1.0);
        return mix(d3, m12, h2) - k*h2*(1.0-h2);
      }
      void main() {
        vNormal = normal;
        vPos = position;
        vBeat = uBeat;
        vec3 p = position;
        float t = uTime * 0.3;
        // 域扭曲（domain warping）：先扭曲采样坐标再算场，更"流体"
        vec3 warp = vec3(
          snoise(p * 1.2 + t),
          snoise(p * 1.2 + t + 31.0),
          snoise(p * 1.2 + t + 73.0)
        ) * (0.15 + uMid * 0.35);
        p += warp;
        // smin 融合位移：把单位球表面按到 blobField 的 1.0 等值面
        float f = blobField(p, uBass);
        float disp = (1.0 - f) - 1.0; // 越接近其他球，位移越大（凸起）
        disp *= (0.4 + uBass * 0.5);
        // treble 高频细节抖动
        disp += snoise(p * 6.0 + t * 3.0) * uTreble * 0.08;
        // beat 脉冲膨胀（明显跟节拍，0.35 让膨胀可见）
        float inflate = 1.0 + uBass * 0.15 + uBeat * 0.35;
        vDisp = disp;
        vec3 newPos = position * inflate + normal * disp;
        // 重新计算法线（近似：用位移梯度）
        vNormal = normalize(normal + warp * 0.5);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
      }
    `;
    const coreFS = `
      uniform float uBass, uBeat, uAlpha, uMid;
      uniform vec3 uTintColor, uAccentColor;
      varying vec3 vNormal;
      varying float vDisp, vBeat;
      varying vec3 vPos;
      void main() {
        // PBR 风格菲涅尔：边缘高光（Schlick 近似）
        vec3 viewDir = normalize(cameraPosition - vPos);
        float fres = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 3.0);
        // 主体色：tint 冷色 + 位移大处偏 accent 暖色（情绪张力）
        vec3 base = mix(uTintColor * 0.35, uAccentColor * 0.6, clamp(vDisp * 1.5 + 0.3, 0.0, 1.0));
        // 边缘 fresnel 高光（白偏暖），降亮度避免刺眼
        vec3 rim = mix(vec3(0.7, 0.75, 0.85), uAccentColor, 0.3) * fres * (0.8 + uBass * 0.9);
        vec3 col = base * (0.32 + uBass * 0.25) + rim * 0.7;
        // beat 闪白（克制，0.2 上限，避免刺眼）
        col = mix(col, vec3(0.85), vBeat * 0.2);
        gl_FragColor = vec4(col, uAlpha * (0.82 + fres * 0.08));
      }
    `;
    const coreGeo = new THREE.IcosahedronGeometry(1.4, 7); // 高细分
    const coreMat = new THREE.ShaderMaterial({
      uniforms: coreUniforms, vertexShader: coreVS, fragmentShader: coreFS,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    // 内层 halo（backside fresnel 辉光球，codrops 双壳方案）
    const haloUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uBeat: { value: 0 },
      uAlpha: { value: 0 }, uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
    };
    const haloFS = `
      uniform float uBass, uBeat, uAlpha;
      uniform vec3 uTintColor, uAccentColor;
      varying vec3 vNormal, vPos;
      varying float vBeat;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPos);
        float fres = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 3.5);
        vec3 col = mix(uTintColor, uAccentColor, 0.3) * fres * (1.2 + uBass * 1.0 + vBeat * 1.8);
        gl_FragColor = vec4(col, uAlpha * fres * (0.55 + vBeat * 0.2));
      }
    `;
    const haloVS = `
      uniform float uBass, uBeat;
      varying vec3 vNormal, vPos;
      varying float vBeat;
      void main() {
        vNormal = normal; vPos = position; vBeat = uBeat;
        float inflate = 1.0 + uBass * 0.18 + uBeat * 0.12;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position * inflate, 1.0);
      }
    `;
    const haloGeo = new THREE.SphereGeometry(1.55, 64, 64);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: haloUniforms, vertexShader: haloVS, fragmentShader: haloFS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    scene.add(halo);

    // ==================================================================
    // 层3 前景：景深尘埃粒子（加性混合 sprite，high 频段闪烁，bass 径向爆发）
    // 球壳分布，数量由 intensity 滑块控制（500~8000），不抢主体焦点
    // ==================================================================
    const hhash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const particleUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uDotTex: { value: dotTexture }, uAlpha: { value: 0 },
      uPixel: { value: renderer.getPixelRatio() }, uIntensity: { value: intensity },
      uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
    };
    const particleVS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat, uPixel, uAlpha, uIntensity;
      attribute float aSeed, aSize;
      varying float vBeat, vAlpha, vDepth, vSeed;
      ${NOISE_GLSL}
      void main() {
        vBeat = uBeat; vAlpha = uAlpha; vSeed = aSeed;
        vec3 pos = position;
        // curl noise 缓慢漂移（低强度，背景感）
        float t = uTime * (0.1 + uMid * 0.3);
        vec3 flow = vec3(
          snoise(pos * 0.25 + t),
          snoise(pos * 0.25 + t + 31.4),
          snoise(pos * 0.25 + t + 73.2)
        );
        pos += flow * (0.2 + uMid * 0.6);
        // bass 径向轻微膨胀
        pos *= 1.0 + uBass * 0.15;
        // beat 爆裂：沿径向冲出（克制，0.8 上限）
        float dist = length(pos);
        vec3 dir = dist > 0.001 ? pos / dist : normalize(pos + vec3(0.001));
        pos += dir * uBeat * (0.8 + aSeed * 1.2);
        vDepth = clamp(length(pos) / 5.0, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        // treble 驱动闪烁大小
        gl_PointSize = aSize * (1.0 + uTreble * 1.2 + uBeat * 0.8) * uPixel * (220.0 / max(-mv.z, 0.1));
      }
    `;
    const particleFS = `
      uniform sampler2D uDotTex;
      uniform float uBass, uTreble, uBeat, uAlpha;
      uniform vec3 uTintColor, uAccentColor;
      varying float vBeat, vDepth, vAlpha, vSeed;
      void main() {
        vec4 tex = texture2D(uDotTex, gl_PointCoord);
        if (tex.a < 0.02) discard;
        // 低饱和 tint 色 + 少量 accent 闪烁
        vec3 col = mix(uTintColor, uAccentColor, vSeed * 0.4);
        col = mix(col, vec3(1.0), vBeat * 0.4);
        col *= (1.0 + vBeat * 1.2 + uTreble * 0.3);
        float fogFade = mix(1.0, 0.4, vDepth * 0.7);
        gl_FragColor = vec4(col, tex.a * uAlpha * fogFade * 0.7);
      }
    `;
    // 计算粒子数量：intensity 0.2→500, 1.5→8000
    const calcPCount = (v: number) => Math.floor(500 + (v - 0.2) / 1.3 * 7500);
    let particles: THREE.Points | null = null;
    let pGeo: THREE.BufferGeometry | null = null;
    let particleMat: THREE.ShaderMaterial | null = null;
    const buildParticles = (count: number) => {
      if (particles) { scene.remove(particles); pGeo?.dispose(); }
      const positions = new Float32Array(count * 3);
      const seeds = new Float32Array(count);
      const sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const r1 = hhash(i * 3 + 1), r2 = hhash(i * 3 + 2), r4 = hhash(i * 5 + 7);
        const R = 4.2;
        const radius = R * (0.7 + 0.3 * Math.cbrt(r1));
        const theta = r2 * Math.PI * 2;
        const phi = Math.acos(2 * r4 - 1);
        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.7;
        positions[i * 3 + 2] = radius * Math.cos(phi) * 0.6;
        seeds[i] = r1;
        sizes[i] = 0.4 + r2 * 1.6;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      pGeo = geo;
      if (!particleMat) {
        particleMat = new THREE.ShaderMaterial({
          uniforms: particleUniforms, vertexShader: particleVS, fragmentShader: particleFS,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
      }
      const p = new THREE.Points(geo, particleMat);
      p.frustumCulled = false;
      scene.add(p);
      particles = p;
    };
    buildParticles(calcPCount(intensity));

    // 入场渐显
    gsap.to(bgUniforms.uAlpha, { value: 1, duration: 1.5, ease: 'power2.out' });
    gsap.to(coreUniforms.uAlpha, { value: 1, duration: 1.8, ease: 'power2.out', delay: 0.3 });
    gsap.to(haloUniforms.uAlpha, { value: 1, duration: 1.8, ease: 'power2.out', delay: 0.4 });
    gsap.to(particleUniforms.uAlpha, { value: 1, duration: 2.0, ease: 'power2.out', delay: 0.5 });

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let beatAnalyser: AnalyserNode | null = null;
    let timeBuf: Float32Array | null = null;
    let smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
    let beatPulse = 0, bloomKick = 0, shiftKick = 0;
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

    // === 后处理链（修正参数）：Bloom(threshold 0.9) + RGBShift(0.002) + Vignette + FilmGrain + Output ===
    // 删除常驻 Afterimage（拖尾易俗气）；bloom threshold 拉高避免过曝
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.85, 0.5, 0.9, // strength 0.85, radius 0.5, threshold 0.9（只让高亮区发光）
    );
    composer.addPass(bloomPass);
    const rgbShiftPass = new ShaderPass(RGBShiftShader);
    rgbShiftPass.uniforms.amount.value = 0.0018; // 极小，节拍时脉冲到 0.004
    composer.addPass(rgbShiftPass);
    const filmPass = new FilmPass(0.18, 0.015, 648, false); // 轻微胶片颗粒掩盖 banding
    composer.addPass(filmPass);
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset.value = 1.1;
    vignettePass.uniforms.darkness.value = 1.05;
    composer.addPass(vignettePass);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - prevTime) / 1000, 0.05);
      prevTime = now;
      bgUniforms.uTime.value += dt;
      coreUniforms.uTime.value += dt;
      haloUniforms.uTime.value += dt;
      particleUniforms.uTime.value += dt;

      if (analyser && freqData && player.isPlaying) {
        analyser.getByteFrequencyData(freqData as any);
        const bands = sampleFrequencyBands(freqData, analyser.context.sampleRate, analyser.fftSize);
        if (beatAnalyser && timeBuf) {
          beatAnalyser.getFloatTimeDomainData(timeBuf as any);
          const isBeat = beatDetector.update(timeBuf);
          if (isBeat) {
            beatPulse = 1;
            bloomKick = Math.max(bloomKick, bands.bass * 0.6 + 0.2);
            shiftKick = 1;
            beatCount++;
          }
        }
        // 音频平滑（mix 0.1 阻尼，避免闪烁）
        smoothBass = smoothLerp(smoothBass, bands.bass, 0.18);
        smoothMid = smoothLerp(smoothMid, bands.mid, 0.18);
        smoothTreb = smoothLerp(smoothTreb, bands.treble, 0.22);
        smoothEnergy = smoothLerp(smoothEnergy, bands.level, 0.18);
      } else {
        smoothBass *= 0.94; smoothMid *= 0.94; smoothTreb *= 0.94; smoothEnergy *= 0.94;
      }

      // beat 脉冲指数衰减（蓄力-释放感）
      beatPulse *= Math.pow(0.08, dt);
      bloomKick *= Math.pow(0.12, dt);
      shiftKick *= Math.pow(0.15, dt);

      // 统一更新所有层 uniform
      bgUniforms.uBass.value = smoothBass;
      bgUniforms.uBeat.value = beatPulse;
      coreUniforms.uBass.value = smoothBass;
      coreUniforms.uMid.value = smoothMid;
      coreUniforms.uTreble.value = smoothTreb;
      coreUniforms.uBeat.value = beatPulse;
      haloUniforms.uBass.value = smoothBass;
      haloUniforms.uBeat.value = beatPulse;
      particleUniforms.uBass.value = smoothBass;
      particleUniforms.uMid.value = smoothMid;
      particleUniforms.uTreble.value = smoothTreb;
      particleUniforms.uBeat.value = beatPulse;

      // 后处理动态：beat 时 bloom 轻微冲高 + 色差瞬间脉冲
      bloomPass.strength = 0.85 + bloomKick * 0.6;
      rgbShiftPass.uniforms.amount.value = 0.0018 + shiftKick * 0.0022;

      // 相机极缓漂移 + beat 微推近（克制，避免眩晕）
      camera.position.x = Math.sin(now * 0.00006) * 0.15;
      camera.position.y = Math.cos(now * 0.00005) * 0.1;
      camera.position.z = 6.5 - beatPulse * 0.25;
      camera.lookAt(0, 0, 0);

      // 核心缓慢旋转（mid 驱动）
      core.rotation.y += dt * (0.12 + smoothMid * 0.3);
      core.rotation.x += dt * 0.04;
      halo.rotation.y -= dt * 0.08;

      // 调试信息
      (window as any).__beatDebug = {
        count: beatCount, beat: beatPulse, bass: smoothBass,
        mid: smoothMid, treble: smoothTreb, bloom: bloomPass.strength,
      };

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
        // 同时把封面作为背景纹理
        try {
          const coverTex = new THREE.CanvasTexture(cv);
          coverTex.minFilter = THREE.LinearFilter; coverTex.magFilter = THREE.LinearFilter;
          if (bgUniforms.uCoverTex.value) (bgUniforms.uCoverTex.value as THREE.Texture).dispose();
          bgUniforms.uCoverTex.value = coverTex;
          bgUniforms.uHasCover.value = 1;
        } catch {}

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

    engineRef.current = { particleUniforms, coreUniforms, haloUniforms, bgUniforms, updateCover, renderer, scene, buildParticles, calcPCount };

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      pGeo?.dispose(); particleMat?.dispose();
      coreGeo.dispose(); coreMat.dispose();
      haloGeo.dispose(); haloMat.dispose();
      bgGeo.dispose(); bgMat.dispose();
      if (bgUniforms.uCoverTex.value) (bgUniforms.uCoverTex.value as THREE.Texture).dispose();
      dotTexture.dispose();
      composer.dispose();
      renderer.dispose();
      delete (window as any).__updateCover;
      delete (window as any).__beatDebug;
    };
  }, []);

  // 强度切换：动态重建粒子数量
  useEffect(() => {
    const eng = engineRef.current;
    if (eng?.buildParticles && eng?.calcPCount) {
      eng.buildParticles(eng.calcPCount(intensity));
    }
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
          <span className="text-[9px] text-[#00f5d4]/70 ml-1.5 font-mono">v1.3.0</span>
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
            <div className="w-full max-w-3xl h-[70vh] overflow-y-auto px-8 pointer-events-auto spotify-lyrics" ref={lyricsRef} style={{ scrollbarWidth: 'none' }}>
              <div className="flex flex-col items-center justify-center py-[28vh]">
                {player.lyricsLoading && player.lyrics.length === 0 && <div className="text-center text-white/25 text-sm py-8">加载歌词中...</div>}
                {player.lyrics.length === 0 && !player.lyricsLoading && <div className="text-center text-white/15 text-sm py-8">暂无歌词</div>}
                {player.lyrics.map((line, i) => {
                  const isActive = i === activeLyricIdx;
                  const dist = Math.abs(i - activeLyricIdx);
                  const state = isActive ? 'is-current' : i < activeLyricIdx ? 'is-past' : 'is-future';
                  return (
                    <div
                      key={i}
                      ref={isActive ? activeLyricRef : null}
                      className={`spline ${state}`}
                      style={{ opacity: isActive ? 1 : Math.max(0.12, 0.5 - dist * 0.12) }}
                    >
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
