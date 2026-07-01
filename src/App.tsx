import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayer } from './hooks/usePlayer';
import type { Song, NeteaseUser } from './types';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { sampleFrequencyBands, smoothLerp } from './core/beatDetector';
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
// Three.js 视觉引擎 v3.0 — 四层异质架构（跳出粒子范式）
// 核心一句话：主体-环境-氛围-交互四层异质，每一层都呼吸，鼠标即手指搅动空间。
//   层1 主体：液态变形核心（IcosahedronGeometry(1.6,7) + fbm 位移 + domain warping
//             + 菲涅尔金属辉光 + 鼠标局部扭曲 + 点击涟漪）—— 画面绝对焦点
//   层2 环境：体积星云深渊背景（全屏 quad，FBM 密度 + 封面色染色 + 鼠标 domain warp）
//   层3 氛围：屏幕空间体积光束（径向模糊 ShaderPass，从核心辐射 god rays）
//   层4 交互：鼠标移动扭曲空间 + 点击涟漪 + 拖拽相机轨道（惯性衰减）
//   后处理：GodRays + UnrealBloom(strength 0.7+energy*0.3, threshold 0.7) + RGBShift + FilmGrain + Vignette + ACES
// 节拍驱动：保留 v2.3 蓄能池 energy + ADSR 包络 env，所有 uniform 走低通流动响应（无闪烁）
// 节拍检测：离线预分析（beatAnalyzer.ts，Spectral Flux + DP）+ realtime fallback（beatDetector.ts）
// 封面取色：K-Means 主色 tint + 副色 accent，驱动核心金属色 + 星云染色 + 光束色
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
    // v3.0 基础 scene/camera/renderer（保留 v2.x 配置）
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
    // 核心体辉光色（奶油金 #F4D4A8）
    const glowColor = new THREE.Color('#F4D4A8');

    // ==================================================================
    // 层2 — 体积星云深渊背景（全屏 quad，正交相机，FBM 密度 + 封面色染色 + 鼠标 domain warp）
    // 用 2D FBM + 深度感模拟体积云（不做真 raymarch），营造无限纵深
    // ==================================================================
    const bgUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uBeat: { value: 0 }, uAlpha: { value: 0 },
      uTreble: { value: 0 },
      uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
      uAspect: { value: window.innerWidth / window.innerHeight },
      uMouseUV: { value: new THREE.Vector2(0.5, 0.5) },
      uMouseStrength: { value: 0 },
    };
    const bgFS = `
      uniform float uTime, uBass, uBeat, uAlpha, uAspect, uTreble, uMouseStrength;
      uniform vec3 uTintColor, uAccentColor;
      uniform vec2 uMouseUV;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        vec2 uv = vUv;
        vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
        // 鼠标 domain warping：鼠标附近像被手指搅动
        float mDist = distance(uv, uMouseUV);
        vec2 mWarp = vec2(
          snoise(vec3(p * 2.0, uTime * 0.1)),
          snoise(vec3(p * 2.0 + 17.3, uTime * 0.1))
        ) * uMouseStrength * 0.15 * smoothstep(0.5, 0.0, mDist);
        p += mWarp;
        // FBM 星云密度（多层叠加，沿 z 缓慢演化模拟体积感）
        float t = uTime * 0.05;
        float density = fbm(vec3(p * 1.5, t));
        density += 0.5 * fbm(vec3(p * 3.0 + 5.2, t * 0.8));
        density = smoothstep(-0.2, 0.9, density);
        density = pow(density, 1.5) * (0.6 + uBeat * 0.5);
        // 深空基底色 + 封面色染色
        vec3 deepSpace = mix(vec3(0.018, 0.025, 0.05), uTintColor * 0.25, 0.35);
        vec3 nebulaCol = mix(deepSpace, uAccentColor * 0.55, density);
        // 远景星点闪烁（高频驱动，稀疏高亮）
        float stars = pow(max(snoise(vec3(uv * 200.0, uTime * 0.2)), 0.0), 12.0);
        stars += 0.5 * pow(max(snoise(vec3(uv * 350.0 + 50.0, uTime * 0.3)), 0.0), 18.0);
        nebulaCol += vec3(stars) * (0.6 + uTreble * 0.8);
        // bass 微辉光（节拍时星云亮起）
        nebulaCol += uAccentColor * uBass * 0.08;
        // 整体压暗做背景（×0.4），保留纵深
        nebulaCol *= 0.4;
        gl_FragColor = vec4(nebulaCol * uAlpha, uAlpha);
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
    // 层1 — 液态变形核心（画面绝对焦点）
    // IcosahedronGeometry(1.6, 7) 高细分 + fbm 顶点位移 + domain warping
    // 低频驱动大形变，中频漂移，高频表面沸腾；节拍 onset 触发爆发性形变（ADSR env）
    // fragment：菲涅尔金属辉光 + 封面色驱动金属色 + 位移大处偏热色
    // 鼠标交互：移动时附近局部扭曲，点击产生涟漪波纹沿表面扩散
    // ==================================================================
    const RIPPLE_MAX = 5;
    const coreUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uEnergy: { value: 0 }, uIntensity: { value: intensity },
      uTintColor: { value: tintColor }, uAccentColor: { value: accentColor },
      uGlowColor: { value: glowColor },
      uMousePos: { value: new THREE.Vector3(999, 999, 999) },
      uMouseStrength: { value: 0 },
      uRipples: { value: Array.from({ length: RIPPLE_MAX }, () => new THREE.Vector4(0, 0, 0, -10)) },
      uRippleCount: { value: 0 },
    };
    const coreVS = `
      uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uMouseStrength;
      uniform vec3 uMousePos;
      uniform vec4 uRipples[5];
      uniform int uRippleCount;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vDisp;
      ${NOISE_GLSL}
      // 鼠标点击涟漪：从点击点向外衰减的圆形波纹
      float rippleEffect(vec3 pos) {
        float total = 0.0;
        for (int i = 0; i < 5; i++) {
          if (i >= uRippleCount) break;
          vec4 r = uRipples[i];
          float age = uTime - r.w;
          if (age < 0.0 || age > 2.0) continue;
          float d = distance(pos, r.xyz);
          float wave = sin(d * 7.0 - age * 14.0) * exp(-d * 1.2) * exp(-age * 1.6);
          total += wave * 0.12;
        }
        return total;
      }
      void main() {
        vec3 pos = position;
        float t = uTime * 0.15;
        // 整体膨胀：bass + env 驱动
        float inflate = 1.0 + uBass * 0.25 + uBeat * 0.15;
        // domain warping：用 noise 偏移采样坐标，产生液态流动感
        float warpAmt = 0.35 + uEnergy * 0.35;
        vec3 warped = pos + vec3(
          snoise(pos * 1.5 + vec3(t, 0.0, 0.0)),
          snoise(pos * 1.5 + vec3(0.0, t, 31.4)),
          snoise(pos * 1.5 + vec3(0.0, 73.2, t))
        ) * warpAmt;
        // fbm 多层叠加位移：低频大形变 + 中频细节
        float n = fbm(warped * (1.1 + uMid * 0.4) + vec3(t * 0.8, t * 0.6, t * 0.4));
        float n2 = fbm(warped * 2.8 + vec3(-t * 0.5, t * 0.3, -t * 0.4)) * 0.3;
        float disp = (n + n2) * (0.32 + uBass * 0.4 + uBeat * 0.3);
        // 高频驱动表面细节沸腾
        disp += snoise(pos * 6.0 + t * 2.0) * uTreble * 0.06;
        // 鼠标局部扭曲：鼠标位置附近增加位移
        float mDist = distance(pos, uMousePos);
        float mouseWarp = exp(-mDist * 2.0) * uMouseStrength * 0.3;
        disp += mouseWarp;
        // 涟漪：鼠标点击产生的波纹沿表面扩散
        disp += rippleEffect(pos);
        vec3 newPos = pos * inflate + normal * disp;
        vDisp = disp;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(newPos, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `;
    const coreFS = `
      uniform vec3 uTintColor, uAccentColor, uGlowColor;
      uniform float uBeat, uBass, uEnergy, uIntensity;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vDisp;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        // 金属感：菲涅尔混色（封面 tint → accent），假 env 反射近似
        vec3 metalCol = mix(uTintColor, uAccentColor, fres);
        // base 色系数低 0.4，避免中心过亮
        vec3 col = metalCol * (0.40 + uEnergy * 0.30);
        // 边缘菲涅尔辉光
        col += uGlowColor * fres * (0.55 + uEnergy * 0.80);
        // 节拍时偏向辉光色（非瞬白，幅度 0.1）
        col = mix(col, uGlowColor, uBeat * 0.10);
        // 位移大处偏热色（金色→暖橙）
        col = mix(col, col * vec3(1.4, 0.85, 0.5), clamp(vDisp * 1.8, 0.0, 0.55));
        // 整体压低避免过曝
        col *= 0.92;
        // intensity 控制可见度
        float a = mix(0.5, 1.0, clamp((uIntensity - 0.2) / 1.3, 0.0, 1.0));
        gl_FragColor = vec4(col * a, 1.0);
      }
    `;
    const coreMat = new THREE.ShaderMaterial({
      uniforms: coreUniforms, vertexShader: coreVS, fragmentShader: coreFS,
      transparent: false,
    });
    const coreGeo = new THREE.IcosahedronGeometry(1.6, 7);
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    // ==================================================================
    // 层3 — 屏幕空间体积光束（后处理 ShaderPass，径向模糊从核心辐射 god rays）
    // 低频驱动明灭，节拍驱动脉冲；光束色用封面暖色
    // ==================================================================
    const GodRaysShader = {
      uniforms: {
        tDiffuse: { value: null },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uBeamIntensity: { value: 0.0 },
        uBeat: { value: 0.0 },
        uBeamColor: { value: new THREE.Color(0xffd9a0) },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uCenter;
        uniform float uBeamIntensity, uBeat;
        uniform vec3 uBeamColor;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec2 dir = vUv - uCenter;
          float decay = 1.0;
          vec3 col = vec3(0.0);
          const int SAMPLES = 32;
          for (int i = 0; i < SAMPLES; i++) {
            vec2 sampleUv = vUv - dir * (float(i) * 0.012);
            col += texture2D(tDiffuse, sampleUv).rgb * decay;
            decay *= 0.93;
          }
          col /= float(SAMPLES);
          float beam = uBeamIntensity * (0.4 + uBeat * 0.6);
          gl_FragColor = vec4(base.rgb + col * uBeamColor * beam, 1.0);
        }
      `,
    };

    // ==================================================================
    // 后处理链：RenderPass(bg+main) + GodRays + UnrealBloom + RGBShift + FilmGrain + Vignette + ACES
    // ==================================================================
    const composer = new EffectComposer(renderer);
    // 背景层先渲染（正交相机，独立 scene）到 composer render target
    const bgRenderPass = new RenderPass(bgScene, bgCamera);
    composer.addPass(bgRenderPass);
    // 主 scene 渲染叠加其上（不清屏，保留背景）
    const mainRenderPass = new RenderPass(scene, camera);
    mainRenderPass.clear = false;
    composer.addPass(mainRenderPass);
    // 层3 光束（径向模糊从核心辐射）
    const godRaysPass = new ShaderPass(GodRaysShader);
    composer.addPass(godRaysPass);
    // Bloom threshold 0.7 —— 核心边缘/辉光发光，energy 低通驱动 strength（峰值 ~1.0）
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.70, 0.55, 0.70, // strength 0.7, radius 0.55, threshold 0.7
    );
    composer.addPass(bloomPass);
    // RGBShift 0.0008 常驻 + energy*0.0006 低通
    const rgbShiftPass = new ShaderPass(RGBShiftShader);
    rgbShiftPass.uniforms.amount.value = 0.0008;
    composer.addPass(rgbShiftPass);
    // FilmPass 0.1 颗粒（电影感 + 抗 banding）
    const filmPass = new FilmPass(0.1, 0.012, 648, false);
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

    // 入场渐显（背景渐显，核心体即时显现）
    gsap.to(bgUniforms.uAlpha, { value: 1, duration: 1.8, ease: 'power2.out' });

    let animId: number;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
    // === v2.3 视觉响应：蓄能池 energy + ADSR 包络 env（保留，无阶跃） ===
    //   energy：低通积累，驱动后处理(bloom/rgbShift) + 持续型 uniform(bg/godRays)
    //   env：ADSR 包络，驱动核心体等节拍型 uniform；平滑趋近，无任何瞬时阶跃
    let energy = 0;
    let env = 0;
    let envPhase: 'idle' | 'att' | 'dec' | 'sus' | 'rel' = 'idle';
    let envT = 0;
    const bpmInit = player.getBpm() || 120;
    let beatInterval = 60 / bpmInit;       // BPM 可能分析完成后才拿到，onBeat 内刷新
    const A = 0.05, D = 0.15, S = 0.55;    // ADSR attack/decay(秒) 与 sustain 电平
    let prevTime = performance.now();
    let beatCount = 0;

    // === 层4 鼠标交互状态（低延迟反馈） ===
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    const mousePos = new THREE.Vector3(999, 999, 999);
    const mouseUV = new THREE.Vector2(0.5, 0.5);
    let mouseVelocity = 0;
    let mouseStrength = 0;
    let lastPointerX = 0, lastPointerY = 0, lastPointerT = 0;
    let isDragging = false;
    let orbitTheta = 0, orbitPhi = 0;
    let velTheta = 0, velPhi = 0;
    const ripples: { pos: THREE.Vector3; time: number }[] = [];

    // === 节拍来源：player.onBeat（离线预分析为主，realtime 为 fallback） ===
    //   保留 v2.3：onBeat "注入能量 + 触发包络"，不阶跃赋值。
    const offBeat = player.onBeat((time: number) => {
      const impulse = 0.5 + smoothBass * 0.5;
      energy = energy * 0.92 + impulse * 0.08;   // 注入非赋值（低通积累）
      envPhase = 'att'; envT = 0;                 // 触发 ADSR
      beatCount++;
      const curBpm = player.getBpm();
      if (curBpm > 0) beatInterval = 60 / curBpm;
    });

    // 可视化频谱仍用 AnalyserNode（v2.2 删了 crossOrigin，频谱不再静默）
    const setupAnalysers = () => {
      const a = player.getAnalyser();
      if (a && !analyser) { analyser = a; freqData = new Uint8Array(a.frequencyBinCount); }
    };
    player.setAnalyserReadyHandler?.(setupAnalysers);
    setTimeout(setupAnalysers, 500);

    // === 层4 鼠标事件（移动扭曲空间 + 点击涟漪 + 拖拽相机轨道） ===
    const onPointerMove = (e: PointerEvent) => {
      const nowMs = performance.now();
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      const dtMs = Math.max(1, nowMs - lastPointerT);
      // 鼠标速度（像素/ms），低通跟随
      const speed = Math.sqrt(dx * dx + dy * dy) / dtMs;
      mouseVelocity = mouseVelocity * 0.7 + speed * 0.3;
      lastPointerX = e.clientX; lastPointerY = e.clientY; lastPointerT = nowMs;
      // 更新 mouseUV（0~1，y 翻转）
      mouseUV.set(e.clientX / window.innerWidth, 1.0 - e.clientY / window.innerHeight);
      bgUniforms.uMouseUV.value.copy(mouseUV);
      // raycast 到核心球面，取本地坐标用于 shader 鼠标扭曲
      mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, camera);
      const hits = raycaster.intersectObject(coreMesh);
      if (hits.length > 0) {
        coreMesh.worldToLocal(mousePos.copy(hits[0].point));
      } else {
        mousePos.set(999, 999, 999);
      }
      coreUniforms.uMousePos.value.copy(mousePos);
      // 拖拽：更新相机轨道角度
      if (isDragging) {
        velTheta = -dx * 0.005;
        velPhi = dy * 0.005;
        orbitTheta += velTheta;
        orbitPhi += velPhi;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      // 仅 canvas 自身接收事件时触发（UI 元素由更高 z-index 拦截）
      if (e.target !== canvasRef.current) return;
      isDragging = true;
      lastPointerX = e.clientX; lastPointerY = e.clientY; lastPointerT = performance.now();
      // 涟漪：raycast 点击点到核心表面，记录本地坐标 + 时间戳
      mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, camera);
      const hits = raycaster.intersectObject(coreMesh);
      if (hits.length > 0) {
        const p = new THREE.Vector3();
        coreMesh.worldToLocal(p.copy(hits[0].point));
        ripples.push({ pos: p, time: performance.now() });
        if (ripples.length > RIPPLE_MAX) ripples.shift();
      }
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
      bgUniforms.uTime.value += dt;
      coreUniforms.uTime.value += dt;

      if (analyser && freqData && player.isPlaying) {
        analyser.getByteFrequencyData(freqData as any);
        const bands = sampleFrequencyBands(freqData, analyser.context.sampleRate, analyser.fftSize);
        // 音频平滑（mix 0.15 阻尼，避免闪烁）
        smoothBass = smoothLerp(smoothBass, bands.bass, 0.15);
        smoothMid = smoothLerp(smoothMid, bands.mid, 0.15);
        smoothTreb = smoothLerp(smoothTreb, bands.treble, 0.18);
        smoothEnergy = smoothLerp(smoothEnergy, bands.level, 0.15);
      } else {
        smoothBass *= 0.94; smoothMid *= 0.94; smoothTreb *= 0.94; smoothEnergy *= 0.94;
      }

      // === v2.3 蓄能池慢释放 + ADSR 包络（保留，平滑趋近，无阶跃） ===
      energy *= Math.pow(0.55, dt);   // 慢释放
      envT += dt;
      let envTarget = 0;
      if (envPhase === 'att') { envTarget = 1.0; if (envT >= A) { envPhase = 'dec'; envT = 0; } }
      else if (envPhase === 'dec') { envTarget = S; if (envT >= D) { envPhase = 'sus'; envT = 0; } }
      else if (envPhase === 'sus') { envTarget = S; if (envT >= beatInterval * 0.55) { envPhase = 'rel'; envT = 0; } }
      else if (envPhase === 'rel') { envTarget = 0.0; if (envT >= beatInterval * 0.45) { envPhase = 'idle'; } }
      const envK = (envPhase === 'att') ? 1 - Math.exp(-dt / 0.012) : 1 - Math.exp(-dt / 0.08);
      env += (envTarget - env) * envK;

      // === 核心体呼吸 + 包络驱动缩放（1.0→1.08 非对称，无瞬变） ===
      const breath = 1.0 + Math.sin(coreUniforms.uTime.value * 1.4) * 0.02;
      coreMesh.scale.setScalar(breath + env * 0.08);

      // === 层4 鼠标交互更新（低延迟） ===
      // 鼠标速度→扭曲强度（低通跟随）
      const mouseTarget = Math.min(mouseVelocity * 0.12, 1.0);
      mouseStrength += (mouseTarget - mouseStrength) * (1 - Math.exp(-dt / 0.15));
      // 涟漪 age 更新，超过 2s 移除（FIFO）
      for (let i = ripples.length - 1; i >= 0; i--) {
        if ((now - ripples[i].time) / 1000 > 2.0) ripples.splice(i, 1);
      }
      // 同步涟漪 uniform（xyz=点击点本地坐标, w=startTime 秒）
      const rippleArr = coreUniforms.uRipples.value as THREE.Vector4[];
      for (let i = 0; i < RIPPLE_MAX; i++) {
        if (i < ripples.length) {
          const r = ripples[i];
          rippleArr[i].set(r.pos.x, r.pos.y, r.pos.z, r.time / 1000);
        } else {
          rippleArr[i].set(0, 0, 0, -10);
        }
      }
      coreUniforms.uRippleCount.value = ripples.length;

      // === 更新所有层 uniforms（全部读 energy/env，无瞬时阶跃） ===
      coreUniforms.uBass.value = smoothBass;
      coreUniforms.uMid.value = smoothMid;
      coreUniforms.uTreble.value = smoothTreb;
      coreUniforms.uBeat.value = env;
      coreUniforms.uEnergy.value = energy;
      coreUniforms.uMouseStrength.value = mouseStrength;

      bgUniforms.uBass.value = smoothBass;
      bgUniforms.uBeat.value = energy;
      bgUniforms.uTreble.value = smoothTreb;
      bgUniforms.uMouseStrength.value = mouseStrength;

      // 层3 光束：energy 驱动明灭，封面 accent 染色，bass 驱动基础强度
      godRaysPass.uniforms.uBeat.value = energy;
      (godRaysPass.uniforms.uBeamColor.value as THREE.Color).copy(accentColor);
      godRaysPass.uniforms.uBeamIntensity.value = 0.15 + smoothBass * 0.5;
      godRaysPass.uniforms.uCenter.value.set(0.5, 0.5);

      // === 后处理低通跟随（禁止瞬时赋值） ===
      // bloom 峰值 ~1.0（0.70 常驻 + energy*0.30），400ms 低通达峰
      const bloomTarget = 0.70 + energy * 0.30;
      bloomPass.strength += (bloomTarget - bloomPass.strength) * (1 - Math.exp(-dt / 0.4));
      // RGBShift 峰值 ~0.0014（0.0008 常驻 + energy*0.0006），250ms 低通
      const shiftTarget = 0.0008 + energy * 0.0006;
      rgbShiftPass.uniforms.amount.value += (shiftTarget - rgbShiftPass.uniforms.amount.value) * (1 - Math.exp(-dt / 0.25));

      // === 相机轨道（拖拽惯性 + 自动慢漂移） ===
      // 自动慢漂移（叠加到 orbit 角度）
      orbitTheta += dt * 0.02;
      // 惯性衰减（拖拽松手后缓慢停止）
      orbitTheta += velTheta;
      orbitPhi += velPhi;
      velTheta *= Math.pow(0.02, dt);
      velPhi *= Math.pow(0.02, dt);
      orbitPhi = Math.max(-0.5, Math.min(0.5, orbitPhi));
      const camR = 6.0 + energy * 0.02;
      camera.position.set(
        Math.sin(orbitTheta) * Math.cos(orbitPhi) * camR,
        Math.sin(orbitPhi) * camR,
        Math.cos(orbitTheta) * Math.cos(orbitPhi) * camR,
      );
      camera.lookAt(0, 0, 0);

      // 调试信息
      (window as any).__beatDebug = {
        count: beatCount, beat: env, energy: energy, bass: smoothBass,
        mid: smoothMid, treble: smoothTreb, bloom: bloomPass.strength,
        ripples: ripples.length, mouse: mouseStrength,
      };
      // 同步 CSS 变量驱动沉浸式歌词（beat 脉冲 + 封面色辉光）— 用平滑 energy
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--beat-pulse', String(energy));
      rootStyle.setProperty('--cover-tint',
        `rgb(${(tintColor.r * 255) | 0},${(tintColor.g * 255) | 0},${(tintColor.b * 255) | 0})`);
      rootStyle.setProperty('--cover-accent',
        `rgb(${(accentColor.r * 255) | 0},${(accentColor.g * 255) | 0},${(accentColor.b * 255) | 0})`);

      // 背景层先渲染（正交），composer 渲染主 scene 叠加 + 光束 + bloom
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

    engineRef.current = { coreUniforms, bgUniforms, godRaysPass, updateCover, renderer, scene };

    return () => {
      cancelAnimationFrame(animId);
      offBeat();
      window.removeEventListener('resize', onResize);
      // 层4 鼠标事件清理
      window.removeEventListener('pointermove', onPointerMove);
      canvasRef.current?.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('blur', onPointerLeaveWin);
      // 几何/材质清理（粒子/halo/线已删除）
      coreGeo.dispose(); coreMat.dispose();
      bgGeo.dispose(); bgMat.dispose();
      composer.dispose();
      renderer.dispose();
      delete (window as any).__updateCover;
      delete (window as any).__beatDebug;
    };
  }, []);

  // 强度切换：v3.0 core shader 用 uIntensity 控制核心体可见度，不重建场景
  useEffect(() => {
    const eng = engineRef.current;
    if (eng?.coreUniforms) eng.coreUniforms.uIntensity.value = intensity;
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
          <span className="text-[9px] text-[#00f5d4]/70 ml-1.5 font-mono">v3.0.0</span>
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
