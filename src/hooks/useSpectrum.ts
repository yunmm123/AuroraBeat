import { useEffect, useRef } from 'react';
import { usePlayer } from '../hooks/usePlayer';

/**
 * v3.2.0 频谱可视化 hook（重做：自然融合，不抢戏也不看不见）
 * 在底部播放栏上方渲染居中镜像频谱条
 * - tint→accent 双色渐变（与主界面 shader 双色调一致，无彩虹）
 * - 去掉顶部白高光，降低透明度，柔和融入背景
 * - 对数采样 + 居中镜像 + 峰值保持（缓慢下落，避免闪烁）
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

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const [tr, tg, tb] = readCssColor('--cover-tint', [0, 245, 212]);
      const [ar, ag, ab] = readCssColor('--cover-accent', [200, 168, 122]);

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
        const barH = Math.max(1.5, v * h * 0.88);
        const xLeft = midX - (j + 1) * (barW + gap) + gap;
        const xRight = midX + j * (barW + gap);

        for (const x of [xLeft, xRight]) {
          // tint→accent 双色渐变（与主界面 shader 双色调一致，无彩虹）
          // 底部 tint 低透明 → 顶部 accent 高透明，柔和融入背景不抢戏
          const grad = ctx.createLinearGradient(0, baseY, 0, baseY - barH);
          grad.addColorStop(0, `rgba(${tr},${tg},${tb},0.22)`);
          grad.addColorStop(0.6, `rgba(${tr},${tg},${tb},0.50)`);
          grad.addColorStop(1, `rgba(${ar},${ag},${ab},0.70)`);
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
  }, [player, canvasRef]);
}
