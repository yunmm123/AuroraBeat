import { useEffect, useRef } from 'react';
import { usePlayer } from '../hooks/usePlayer';

/**
 * v3.1.5 频谱可视化 hook
 * 在底部播放栏上方渲染居中镜像频谱条
 * - 从 analyser 取频域数据，对数采样为 64 条
 * - 居中向两侧对称展开（镜像），底部对齐向上生长
 * - 颜色用封面色 tint→accent 渐变（从 visual engine 写入的 CSS 变量读取），顶部高光
 * - 峰值保持 + 缓慢下落，避免闪烁
 */
export function useSpectrum(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const player = usePlayer();
  const rafRef = useRef<number>(0);
  const peakRef = useRef<Float32Array>(new Float32Array(64)); // 峰值保持（缓慢下落）

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

    // RGB → HSL（用于基于封面色相做彩虹渐变）
    const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0; const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h *= 60;
      }
      return [h, s, l];
    };

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const [tr, tg, tb] = readCssColor('--cover-tint', [0, 245, 212]);
      // v3.1.6: 彩色渐变——以封面 tint 色相为中心，±45° 色相旋转，形成围绕封面色的彩虹
      const [baseHue] = rgbToHsl(tr, tg, tb);

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
        const barH = Math.max(1.5, v * h * 0.92);
        const xLeft = midX - (j + 1) * (barW + gap) + gap;
        const xRight = midX + j * (barW + gap);

        // 每个 bar 的色相：以 baseHue 为中心，按位置 ±45° 旋转
        const hueOffset = (j / (BAR_COUNT - 1)) * 90 - 45;
        const hue = (baseHue + hueOffset + 360) % 360;

        for (const x of [xLeft, xRight]) {
          // 彩色渐变：底部深色（同色相低明度）→ 顶部亮色（同色相高明度）
          const grad = ctx.createLinearGradient(0, baseY, 0, baseY - barH);
          grad.addColorStop(0, `hsla(${hue}, 75%, 40%, 0.6)`);
          grad.addColorStop(0.5, `hsla(${hue}, 80%, 55%, 0.88)`);
          grad.addColorStop(1, `hsla(${hue}, 85%, 68%, 0.98)`);
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

          // 顶部白色高光
          if (v > 0.15) {
            ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, v * 0.7)})`;
            ctx.fillRect(x, baseY - barH, barW, 1.2);
          }
        }
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [player, canvasRef]);
}

