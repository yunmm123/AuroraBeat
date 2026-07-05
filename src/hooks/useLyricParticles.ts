import { useEffect, useRef } from 'react';

// ============================================================
//  v3.3.7: 歌词粒子溶解/重组系统（重做版）
//  参考 lumitree kinetic typography 的 "Particle text dissolve" 方案
//  参考 juejin 烟花文字的像素级拆解
//
//  核心改进：
//  1. 粒子数大幅增加（每行 600-1200），密度足够看清字形
//  2. 同一组粒子承担"溶解+重组"——旧字位置出发→溶解飘散→
//     中途自然过渡到新字目标位置→聚合成新字
//     （而非旧字一组粒子飘散、新字另一组粒子飞入的割裂感）
//  3. 弹性插值（spring）：粒子向目标移动用缓动而非匀速，
//     到达后轻微回弹，避免生硬
//  4. Perlin 风噪声扰动：粒子运动叠加轻微噪声流动，
//     避免直线冲刺的机械感
//  5. 粒子尺寸小(1-2px)但发光半径大(4-8px)，
//     多层叠加形成"粒子云"效果，看清字形的轮廓
// ============================================================

interface Particle {
  // 当前位置
  x: number; y: number;
  // 速度（用于弹簧/阻尼）
  vx: number; vy: number;
  // 旧字位置（出生点，溶解阶段从这里出发）
  ox: number; oy: number;
  // 新字位置（目标点，重组阶段聚拢到这里）
  tx: number; ty: number;
  // 配色（封面色调色板里随机一色）
  r: number; g: number; b: number;
  // 大小
  size: number;
  // 阶段：'dissolve' 溶解飘散 / 'gather' 聚拢重组
  phase: 'dissolve' | 'gather';
  // 阶段进度计时器（秒）
  t: number;
  // 阶段持续时间
  dissolveDur: number;
  gatherDur: number;
  // 个体相位偏移（避免整齐划一）
  delay: number;
  // 噪声相位（持续漂移用）
  noisePhase: number;
  // 透明度（出生淡入 + 死亡淡出）
  alpha: number;
  // 是否存活
  alive: boolean;
}

// 采样文字像素：返回字所占像素的视口坐标数组
// 旧版 step=5 太稀疏，新版 step=3 提高密度
function sampleTextPixels(
  text: string,
  rect: DOMRect,
  fontSize: number,
  fontWeight: number,
  fontFamily: string,
  step: number = 3
): { x: number; y: number }[] {
  if (!text || text.length === 0) return [];
  const off = document.createElement('canvas');
  const pad = 24;
  const w = Math.ceil(rect.width) + pad * 2;
  const h = Math.ceil(rect.height) + pad * 2;
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.fillStyle = '#fff';
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const data = ctx.getImageData(0, 0, w, h).data;
  const pts: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 30) {
        pts.push({
          x: rect.left + (x - pad),
          y: rect.top + (y - pad),
        });
      }
    }
  }
  return pts;
}

// 读取 CSS 变量颜色
function readCssColor(varName: string, fallback: [number, number, number]): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!v) return fallback;
  const m = v.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  return fallback;
}

// 一维平滑噪声（伪 Perlin，足够自然）
function noise1d(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin((i + 1) * 12.9898) * 43758.5453;
  const fa = a - Math.floor(a);
  const fb = b - Math.floor(b);
  // 平滑插值（smoothstep）
  const t = f * f * (3 - 2 * f);
  return fa * (1 - t) + fb * t;
}

export function useLyricParticles(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  lyricRef: React.RefObject<HTMLDivElement>,
  activeIdx: number,
  text: string,
  isPlaying: boolean
) {
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const lastIdxRef = useRef<number>(-1);
  const lastTextRef = useRef<string>('');
  const lastTimeRef = useRef<number>(0);
  const beatPulseRef = useRef<number>(0);

  // 监听 --beat-pulse 变化（CSS 变量无法直接读每帧，用 MutationObserver 不实时，
  // 改用：每帧从文档样式读取一次——但 getComputedStyle 每帧调用有性能损耗，
  // 这里改为：监听一次设置初始值，主渲染循环里也直接调 setBeatPulse 不可能（跨文件）
  // 折中：每帧读取，但只读 --beat-pulse（单属性，开销可接受）
  useEffect(() => {
    const interval = setInterval(() => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--beat-pulse').trim();
      const n = parseFloat(v);
      if (!isNaN(n)) beatPulseRef.current = n;
    }, 50);  // 20Hz 读取足够（节拍包络本身变化不快）
    return () => clearInterval(interval);
  }, []);

  // 触发溶解+重组：当 activeIdx 变化（且非首次）
  useEffect(() => {
    if (activeIdx === lastIdxRef.current) return;
    const isFirst = lastIdxRef.current === -1;
    lastIdxRef.current = activeIdx;

    if (isFirst || !lyricRef.current || !canvasRef.current) {
      lastTextRef.current = text;
      return;
    }
    const oldText = lastTextRef.current;
    lastTextRef.current = text;
    if (!oldText) return;

    const canvas = canvasRef.current;
    const lyricEl = lyricRef.current;
    if (!canvas || !lyricEl) return;

    const rect = lyricEl.getBoundingClientRect();
    const style = getComputedStyle(lyricEl);
    const fontSize = parseFloat(style.fontSize) || 48;
    const fontWeight = parseInt(style.fontWeight) || 800;
    const fontFamily = style.fontFamily || 'sans-serif';

    // 高密度采样（step=3）
    const oldPts = sampleTextPixels(oldText, rect, fontSize, fontWeight, fontFamily, 3);
    const newPts = sampleTextPixels(text, rect, fontSize, fontWeight, fontFamily, 3);

    // 封面色作为粒子颜色
    const tint = readCssColor('--cover-tint', [0, 245, 212]);
    const accent = readCssColor('--cover-accent', [200, 168, 122]);
    const midLight = readCssColor('--cover-midlight', [216, 184, 144]);
    const highlight = readCssColor('--cover-highlight', [244, 232, 208]);
    const palette = [tint, accent, midLight, highlight];

    // 核心改进：同一组粒子承担溶解+重组
    // 旧字采样点数 = N1, 新字采样点数 = N2
    // 粒子数取 max(N1, N2)
    // 每个粒子的出生点 = 旧字采样点（循环索引），目标点 = 新字采样点（循环索引）
    // 这样旧字每个像素位置都有粒子飞出，飞向新字每个像素位置
    const count = Math.max(oldPts.length, newPts.length, 400);
    const maxParticles = Math.min(count, 1200);  // 上限 1200 保证性能

    const newParticles: Particle[] = [];
    for (let i = 0; i < maxParticles; i++) {
      // 旧字采样点（循环取，若新字比旧字多则重复旧字采样点）
      const oldP = oldPts[i % Math.max(1, oldPts.length)];
      // 新字采样点（循环取）
      const newP = newPts[i % Math.max(1, newPts.length)];

      // 初始位置 = 旧字位置 + 小随机偏移
      const sx = oldP.x + (Math.random() - 0.5) * 4;
      const sy = oldP.y + (Math.random() - 0.5) * 4;

      const color = palette[Math.floor(Math.random() * palette.length)];

      // 阶段时长：错落分布让粒子分批溶解/聚拢，避免整齐
      const dissolveDur = 0.5 + Math.random() * 0.4;   // 0.5-0.9s
      const gatherDur = 0.7 + Math.random() * 0.5;     // 0.7-1.2s
      const delay = Math.random() * 0.25;              // 0-250ms 错落启动

      newParticles.push({
        x: sx, y: sy,
        vx: 0, vy: 0,
        ox: oldP.x, oy: oldP.y,
        tx: newP.x, ty: newP.y,
        r: color[0], g: color[1], b: color[2],
        size: 0.8 + Math.random() * 1.4,    // 0.8-2.2px
        phase: 'dissolve',
        t: -delay,
        dissolveDur,
        gatherDur,
        delay,
        noisePhase: Math.random() * 100,
        alpha: 0,  // 出生时透明，溶解阶段淡入
        alive: true,
      });
    }

    particlesRef.current.push(...newParticles);
  }, [activeIdx, text, lyricRef, canvasRef]);

  // RAF 渲染循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    };
    resize();
    window.addEventListener('resize', resize);

    const dpr = window.devicePixelRatio || 1;
    lastTimeRef.current = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const ps = particlesRef.current;
      if (ps.length === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // 加法混合
      ctx.globalCompositeOperation = 'lighter';

      const beat = beatPulseRef.current;
      const alive: Particle[] = [];

      for (const p of ps) {
        if (!p.alive) continue;

        p.t += dt;
        // 延迟期：未启动，跳过更新
        if (p.t < 0) { alive.push(p); continue; }

        if (p.phase === 'dissolve') {
          // 溶解阶段：从旧字位置向外飘散
          // 进度 0-1
          const progress = Math.min(1, p.t / p.dissolveDur);
          // 淡入（前 20% 时间淡入，后 30% 时间准备进入 gather）
          if (progress < 0.2) {
            p.alpha = progress / 0.2;
          } else {
            p.alpha = 1;
          }

          // 向外扩散：速度方向 = 从旧字中心向外
          // 简化为：给一个随机方向的初始速度 + 噪声扰动
          if (p.t < 0.05) {
            // 赋初速（从旧字位置向外）
            const cx = (p.ox);
            const cy = (p.oy);
            // 用粒子位置相对旧字重心的方向
            const dx = p.x - cx;
            const dy = p.y - cy;
            const len = Math.sqrt(dx * dx + dy * dy) + 0.001;
            const speed = 60 + Math.random() * 120;
            p.vx = (dx / len) * speed + (Math.random() - 0.5) * 40;
            p.vy = (dy / len) * speed + (Math.random() - 0.5) * 40;
          }

          // 噪声扰动（持续漂移，避免直线冲刺的机械感）
          p.noisePhase += dt * 1.5;
          const nx = (noise1d(p.noisePhase) - 0.5) * 60 * dt;
          const ny = (noise1d(p.noisePhase + 100) - 0.5) * 60 * dt;
          p.vx += nx;
          p.vy += ny;

          // 速度阻尼
          p.vx *= 0.94;
          p.vy *= 0.94;

          // 轻微重力（向下飘）
          p.vy += 20 * dt;

          p.x += p.vx * dt;
          p.y += p.vy * dt;

          // 阶段切换：溶解时间到 → 进入 gather，目标改为新字位置
          if (progress >= 1) {
            p.phase = 'gather';
            p.t = 0;
            // 保留当前速度，让粒子从当前位置缓动到新字位置
          }
        } else {
          // gather 阶段：缓动聚拢到新字目标位置
          const progress = Math.min(1, p.t / p.gatherDur);

          // 弹性插值（spring）：朝目标加速 + 阻尼
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          // 弹簧力（系数越大聚拢越快）
          const spring = 12;
          const damping = 4;
          p.vx += dx * spring * dt;
          p.vy += dy * spring * dt;
          p.vx *= Math.max(0, 1 - damping * dt);
          p.vy *= Math.max(0, 1 - damping * dt);

          // 噪声扰动（轻微，避免直线感）
          p.noisePhase += dt * 0.8;
          const nx = (noise1d(p.noisePhase + 50) - 0.5) * 20 * dt;
          const ny = (noise1d(p.noisePhase + 150) - 0.5) * 20 * dt;
          p.vx += nx;
          p.vy += ny;

          p.x += p.vx * dt;
          p.y += p.vy * dt;

          // 后 30% 时间淡出（聚拢完成后字本身已经显示，粒子作为"光晕"消融）
          if (progress > 0.7) {
            p.alpha = Math.max(0, 1 - (progress - 0.7) / 0.3);
          } else {
            p.alpha = 1;
          }

          // 到达后死亡
          if (progress >= 1) {
            p.alive = false;
            continue;
          }
        }

        if (p.alpha <= 0) continue;

        // 绘制：小核心 + 大光晕（多层径向渐变叠加，形成"云雾"感）
        const alpha = p.alpha;
        // 节拍来时光晕扩大
        const beatMul = 1 + beat * 0.4;
        const glowR = p.size * 3.5 * beatMul;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        grad.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${alpha * 0.95})`);
        grad.addColorStop(0.3, `rgba(${p.r},${p.g},${p.b},${alpha * 0.4})`);
        grad.addColorStop(0.7, `rgba(${p.r},${p.g},${p.b},${alpha * 0.1})`);
        grad.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();

        alive.push(p);
      }
      particlesRef.current = alive;

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [canvasRef, isPlaying]);
}
