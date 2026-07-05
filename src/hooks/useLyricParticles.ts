import { useEffect, useRef } from 'react';

// ============================================================
//  v3.3.6: 歌词粒子解构/聚合系统（B 方案）
//  - 歌词切换时：旧字 → 粒子向外飘散（解构）
//                粒子从外部飞向新字位置 → 聚合成字（聚合）
//  - 粒子颜色取自封面色（tint/accent/midLight 三色随机）
//  - 加法混合（lighter）让多层叠加更亮
//  - 像素采样：离屏 canvas 渲染相同字体 → getImageData 采样
// ============================================================

interface Particle {
  x: number; y: number;          // 当前位置（视口坐标）
  vx: number; vy: number;        // 速度
  tx: number; ty: number;        // 目标位置（聚合用，解构粒子无目标）
  life: number;                  // 0..1，0 = 死亡，1 = 新生
  maxLife: number;               // 寿命（秒）
  size: number;
  r: number; g: number; b: number;  // 颜色
  phase: 'scatter' | 'gather';  // 解构 / 聚合
  delay: number;                 // 延迟启动（秒）
  arrived: boolean;              // 聚合粒子是否到达目标
}

// 采样文字像素：返回字所占像素的视口坐标数组
function sampleTextPixels(
  text: string,
  rect: DOMRect,
  fontSize: number,
  fontWeight: number,
  fontFamily: string,
  step: number = 4
): { x: number; y: number }[] {
  if (!text || text.length === 0) return [];
  const off = document.createElement('canvas');
  // 离屏 canvas 尺寸 = 歌词 DOM 尺寸（多行换行时也匹配）
  const pad = 20;
  const w = Math.ceil(rect.width) + pad * 2;
  const h = Math.ceil(rect.height) + pad * 2;
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  if (!ctx) return [];
  ctx.fillStyle = '#fff';
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 离屏 canvas 中心绘制
  ctx.fillText(text, w / 2, h / 2);
  const data = ctx.getImageData(0, 0, w, h).data;
  const pts: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 30) {
        // 转视口坐标：rect 中心 + 像素偏移 - pad
        pts.push({
          x: rect.left + (x - pad),
          y: rect.top + (y - pad),
        });
      }
    }
  }
  return pts;
}

// 读取 CSS 变量颜色，回退默认值
function readCssColor(varName: string, fallback: [number, number, number]): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!v) return fallback;
  const m = v.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  return fallback;
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

  // 触发解构+聚合：当 activeIdx 变化（且非首次）
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

    // 采样旧字像素（用旧 DOM 状态——但此时 DOM 已切到新字，需用缓存矩形）
    // 实际：歌词 DOM 是同一个元素（key=line.idx 变化触发重渲染），切换瞬间
    // getBoundingClientRect 反映的是新字。但旧字位置就是歌词容器中心，
    // 新字位置也是歌词容器中心（始终居中），所以两者位置一致。
    const rect = lyricEl.getBoundingClientRect();
    const style = getComputedStyle(lyricEl);
    const fontSize = parseFloat(style.fontSize) || 48;
    const fontWeight = parseInt(style.fontWeight) || 800;
    const fontFamily = style.fontFamily || 'sans-serif';

    // 采样旧字像素（解构粒子来源）
    const oldPts = sampleTextPixels(oldText, rect, fontSize, fontWeight, fontFamily, 5);
    // 采样新字像素（聚合粒子目标）
    const newPts = sampleTextPixels(text, rect, fontSize, fontWeight, fontFamily, 5);

    // 封面色作为粒子颜色
    const tint = readCssColor('--cover-tint', [0, 245, 212]);
    const accent = readCssColor('--cover-accent', [200, 168, 122]);
    const midLight = readCssColor('--cover-midlight', [216, 184, 144]);
    const palette = [tint, accent, midLight];

    // 限制粒子总数（性能）
    const maxParticles = 180;
    const scatterCount = Math.min(oldPts.length, maxParticles);
    const gatherCount = Math.min(newPts.length, maxParticles);

    const newParticles: Particle[] = [];

    // 解构粒子：从旧字位置出发，向外随机方向飘散
    for (let i = 0; i < scatterCount; i++) {
      const p = oldPts[i];
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 120;
      const color = palette[Math.floor(Math.random() * palette.length)];
      newParticles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        tx: 0, ty: 0,
        life: 1,
        maxLife: 0.8 + Math.random() * 0.6,   // 0.8-1.4 秒
        size: 1.2 + Math.random() * 2.4,
        r: color[0], g: color[1], b: color[2],
        phase: 'scatter',
        delay: Math.random() * 0.15,           // 0-150ms 错落启动，自然
        arrived: false,
      });
    }

    // 聚合粒子：从远处随机位置飞向新字像素位置
    for (let i = 0; i < gatherCount; i++) {
      const target = newPts[i];
      // 起点在目标周围 200-400px 随机方向
      const angle = Math.random() * Math.PI * 2;
      const dist = 200 + Math.random() * 200;
      const sx = target.x + Math.cos(angle) * dist;
      const sy = target.y + Math.sin(angle) * dist;
      const color = palette[Math.floor(Math.random() * palette.length)];
      newParticles.push({
        x: sx,
        y: sy,
        vx: 0, vy: 0,
        tx: target.x,
        ty: target.y,
        life: 1,
        maxLife: 0.6 + Math.random() * 0.4,   // 0.6-1.0 秒聚合
        size: 1.0 + Math.random() * 2.0,
        r: color[0], g: color[1], b: color[2],
        phase: 'gather',
        delay: Math.random() * 0.2,            // 0-200ms 错落
        arrived: false,
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
      canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
      canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
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
      // 加法混合
      ctx.globalCompositeOperation = 'lighter';

      const alive: Particle[] = [];
      for (const p of ps) {
        // 延迟启动
        if (p.delay > 0) {
          p.delay -= dt;
          alive.push(p);
          continue;
        }

        if (p.phase === 'scatter') {
          // 解构：位置 += 速度，速度衰减，透明度递减
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          // 略微受重力影响（向下飘）+ 阻尼
          p.vy += 30 * dt;
          p.vx *= 0.96;
          p.vy *= 0.96;
          p.life -= dt / p.maxLife;
        } else {
          // 聚合：向目标 lerp，到达后衰减
          const dx = p.tx - p.x;
          const dy = p.ty - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 3) {
            p.arrived = true;
          }
          if (p.arrived) {
            p.life -= dt / 0.25;  // 到达后 0.25 秒淡出
          } else {
            // 速度随距离递减（缓动），自然聚拢
            const speed = 280 + dist * 1.5;
            p.x += (dx / dist) * speed * dt;
            p.y += (dy / dist) * speed * dt;
          }
        }

        if (p.life <= 0) continue;

        // 绘制：发光圆点
        const alpha = Math.max(0, Math.min(1, p.life));
        const radius = p.size * (0.6 + alpha * 0.4);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3);
        grad.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${alpha * 0.9})`);
        grad.addColorStop(0.4, `rgba(${p.r},${p.g},${p.b},${alpha * 0.4})`);
        grad.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 3, 0, Math.PI * 2);
        ctx.fill();

        alive.push(p);
      }
      particlesRef.current = alive;

      // 不播放时缓慢清空（避免暂停后粒子残留）
      if (!isPlaying && alive.length === 0) {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [canvasRef, isPlaying]);
}
