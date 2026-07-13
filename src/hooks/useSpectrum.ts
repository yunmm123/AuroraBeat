import { useEffect, useRef } from 'react';
import { usePlayer } from '../hooks/usePlayer';

/**
 * v3.2.2 频谱可视化 hook（6 色渐变：从封面阴影→中暗→主→副→中亮→高光）
 * 在底部播放栏上方渲染居中镜像频谱条
 * - 6 色渐变（按亮度从底到顶），呈现封面完整色彩构成
 * - 去掉顶部白高光，降低透明度，柔和融入背景
 * - 对数采样 + 居中镜像 + 峰值保持（缓慢下落，避免闪烁）
 *
 * v3.8.6: 新增 wave 模式（流体波浪）—— 用频谱数据驱动平滑贝塞尔曲线
 *   比柱状图更柔和沉浸，适合"流体波浪"可视化模式
 */
export function useSpectrum(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  mode: 'spectrum' | 'wave' = 'spectrum',
) {
  const player = usePlayer();
  const rafRef = useRef<number>(0);
  const peakRef = useRef<Float32Array>(new Float32Array(64)); // 峰值保持（缓慢下落）
  // wave 模式专用：保存上一帧平滑值用于插值，避免抖动
  const waveSmoothRef = useRef<Float32Array>(new Float32Array(128));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const BAR_COUNT = 64;
    let freqData: Uint8Array | null = null;

    // 从 CSS 变量读取封面色（visual engine 每帧写入 --cover-tint / --cover-accent）
    const readCssColor = (varName: string, fallback: [number, number, number]): [number, number, number] => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      const m = v.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m) return [+m[1], +m[2], +m[3]];
      const hex = v.match(/^#([0-9a-f]{6})$/i);
      if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
      return fallback;
    };

    // v3.8.6 性能优化：颜色缓存，每 15 帧（约 250ms）才重新读 CSS 变量，避免每帧 6 次 getComputedStyle 导致布局抖动
    let colorCache: {
      tint: [number, number, number]; accent: [number, number, number];
      highlight: [number, number, number]; midlight: [number, number, number];
      middark: [number, number, number]; shadow: [number, number, number];
    } | null = null;
    let colorCacheFrame = 0;
    let frameCount = 0;
    const refreshColors = () => {
      colorCache = {
        tint: readCssColor('--cover-tint', [0, 245, 212]),
        accent: readCssColor('--cover-accent', [200, 168, 122]),
        highlight: readCssColor('--cover-highlight', [244, 232, 208]),
        midlight: readCssColor('--cover-midlight', [216, 184, 144]),
        middark: readCssColor('--cover-middark', [58, 66, 82]),
        shadow: readCssColor('--cover-shadow', [10, 12, 18]),
      };
      colorCacheFrame = frameCount;
    };

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      frameCount++;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // 每 15 帧刷新一次颜色缓存
      if (!colorCache || frameCount - colorCacheFrame >= 15) refreshColors();
      const cc = colorCache!;
      const [tr, tg, tb] = cc.tint;
      const [ar, ag, ab] = cc.accent;
      const [hr, hg, hb] = cc.highlight;
      const [mr, mg, mb] = cc.midlight;
      const [dr, dg, db] = cc.middark;
      const [sr, sg, sb] = cc.shadow;

      const analyser = player.getAnalyser();
      if (!analyser) return;
      if (!freqData || freqData.length !== analyser.frequencyBinCount) {
        freqData = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(freqData as any);

      // 对数采样：低频密集，高频稀疏，更符合听觉
      const bins = freqData.length;
      const samples: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const t = i / (BAR_COUNT - 1);
        const idx = Math.floor(Math.pow(t, 1.8) * (bins * 0.7));
        samples.push((freqData[Math.min(bins - 1, idx)] || 0) / 255);
      }

      if (mode === 'wave') {
        // === v3.8.6 流体波浪模式 ===
        // 用更密集的采样点（128）构造平滑波形，贝塞尔曲线连接
        const WAVE_POINTS = 128;
        const wavePts: number[] = [];
        for (let i = 0; i < WAVE_POINTS; i++) {
          const t = i / (WAVE_POINTS - 1);
          const idx = Math.floor(Math.pow(t, 1.5) * (bins * 0.6));
          wavePts.push((freqData[Math.min(bins - 1, idx)] || 0) / 255);
        }

        // 时间相位（让波形持续向前流动）
        const now = performance.now() * 0.001;
        const midY = h * 0.55;

        // 平滑插值（保留上一帧 70%，避免高频抖动）
        const smooth = waveSmoothRef.current;
        if (smooth.length !== WAVE_POINTS) {
          waveSmoothRef.current = new Float32Array(WAVE_POINTS);
        }
        for (let i = 0; i < WAVE_POINTS; i++) {
          const target = wavePts[i];
          const prev = smooth[i] || 0;
          smooth[i] = prev * 0.7 + target * 0.3;
        }

        // 主波浪：上波形 + 下镜像（两层层叠）
        const drawWave = (yOffset: number, ampMul: number, alpha: number, lineW: number) => {
          ctx.beginPath();
          for (let i = 0; i < WAVE_POINTS; i++) {
            const x = (i / (WAVE_POINTS - 1)) * w;
            // 叠加两个正弦相位让波形更有机
            const phase = now * 1.2 + i * 0.08;
            const amp = (smooth[i] * 0.7 + Math.sin(phase) * 0.05 + Math.sin(phase * 1.7) * 0.03) * h * 0.6 * ampMul;
            const y = midY + yOffset + amp;
            if (i === 0) ctx.moveTo(x, y);
            else {
              // 使用 quadraticCurveTo 平滑连接
              const prevX = ((i - 1) / (WAVE_POINTS - 1)) * w;
              const cpx = (prevX + x) / 2;
              const cpy = midY + yOffset + ((smooth[i - 1] + smooth[i]) / 2) * h * 0.6 * ampMul;
              ctx.quadraticCurveTo(cpx, cpy, x, y);
            }
          }
          // 闭合到底部形成填充
          ctx.lineTo(w, h);
          ctx.lineTo(0, h);
          ctx.closePath();

          // 6 色垂直渐变填充（与频谱保持一致）
          const grad = ctx.createLinearGradient(0, midY - h * 0.3, 0, h);
          grad.addColorStop(0, `rgba(${hr},${hg},${hb},${alpha * 0.85})`);
          grad.addColorStop(0.2, `rgba(${mr},${mg},${mb},${alpha * 0.75})`);
          grad.addColorStop(0.4, `rgba(${ar},${ag},${ab},${alpha * 0.65})`);
          grad.addColorStop(0.6, `rgba(${tr},${tg},${tb},${alpha * 0.55})`);
          grad.addColorStop(0.8, `rgba(${dr},${dg},${db},${alpha * 0.4})`);
          grad.addColorStop(1, `rgba(${sr},${sg},${sb},${alpha * 0.15})`);
          ctx.fillStyle = grad;
          ctx.fill();

          // 顶部高亮线
          ctx.beginPath();
          for (let i = 0; i < WAVE_POINTS; i++) {
            const x = (i / (WAVE_POINTS - 1)) * w;
            const phase = now * 1.2 + i * 0.08;
            const amp = (smooth[i] * 0.7 + Math.sin(phase) * 0.05 + Math.sin(phase * 1.7) * 0.03) * h * 0.6 * ampMul;
            const y = midY + yOffset + amp;
            if (i === 0) ctx.moveTo(x, y);
            else {
              const prevX = ((i - 1) / (WAVE_POINTS - 1)) * w;
              const cpx = (prevX + x) / 2;
              const cpy = midY + yOffset + ((smooth[i - 1] + smooth[i]) / 2) * h * 0.6 * ampMul;
              ctx.quadraticCurveTo(cpx, cpy, x, y);
            }
          }
          ctx.strokeStyle = `rgba(${hr},${hg},${hb},${alpha * 0.6})`;
          ctx.lineWidth = lineW;
          ctx.stroke();
        };

        // 三层叠加：底层最大半透明，中层中等，顶层细线
        drawWave(-h * 0.18, 1.0, 0.35, 1.2);
        drawWave(0, 0.75, 0.55, 1.5);
        drawWave(h * 0.12, 0.5, 0.85, 1.8);
        return;
      }

      // === 默认柱状频谱模式 ===
      // 居中镜像布局
      const gap = 2;
      const barW = Math.max(1.5, (w / 2 - gap * BAR_COUNT / 2) / (BAR_COUNT / 2));
      const midX = w / 2;
      const baseY = h;

      // 峰值保持 + 衰减
      for (let j = 0; j < BAR_COUNT; j++) {
        const target = samples[j];
        const prev = peakRef.current[j];
        if (target >= prev) peakRef.current[j] = target;
        else peakRef.current[j] = prev * 0.92;
      }

      for (let j = 0; j < BAR_COUNT; j++) {
        const v = peakRef.current[j];
        const barH = Math.max(1.5, v * h * 0.88);
        const xLeft = midX - (j + 1) * (barW + gap) + gap;
        const xRight = midX + j * (barW + gap);

        for (const x of [xLeft, xRight]) {
          // 6 色渐变（按亮度从底到顶）：shadow→midDark→tint→accent→midLight→highlight
          // 呈现封面完整色彩构成，从底到顶由暗到亮自然过渡，柔和融入背景不抢戏
          const grad = ctx.createLinearGradient(0, baseY, 0, baseY - barH);
          grad.addColorStop(0, `rgba(${sr},${sg},${sb},0.30)`);
          grad.addColorStop(0.2, `rgba(${dr},${dg},${db},0.45)`);
          grad.addColorStop(0.4, `rgba(${tr},${tg},${tb},0.55)`);
          grad.addColorStop(0.6, `rgba(${ar},${ag},${ab},0.65)`);
          grad.addColorStop(0.8, `rgba(${mr},${mg},${mb},0.72)`);
          grad.addColorStop(1, `rgba(${hr},${hg},${hb},0.80)`);
          ctx.fillStyle = grad;
          const r = Math.min(barW / 2, 2);
          ctx.beginPath();
          ctx.moveTo(x, baseY);
          ctx.lineTo(x, baseY - barH + r);
          ctx.quadraticCurveTo(x, baseY - barH, x + r, baseY - barH);
          ctx.lineTo(x + barW - r, baseY - barH);
          ctx.quadraticCurveTo(x + barW, baseY - barH, x + barW, baseY - barH + r);
          ctx.lineTo(x + barW, baseY);
          ctx.closePath();
          ctx.fill();
        }
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [player, canvasRef, mode]);
}
