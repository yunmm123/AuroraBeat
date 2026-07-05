import { useEffect, useRef, useState } from 'react';

// ============================================================
//  v3.3.9: 弹簧物理引擎（参考 AMLL spring.ts 实现）
//  基于胡克定律：F = -k*x - c*v
//  相比 CSS cubic-bezier 更自然——有真实物理惯性和回弹
//
//  用法：const [value] = useSpring(target, { stiffness, damping });
//  target 变化时，value 弹簧式过渡到 target
// ============================================================

interface SpringConfig {
  stiffness?: number;   // 刚度（越大越硬，过渡越快）
  damping?: number;     // 阻尼（越大越少振荡）
  mass?: number;         // 质量（越大越迟钝）
  initial?: number;      // 初始值
}

interface SpringState {
  current: number;       // 当前值
  velocity: number;      // 当前速度
}

export function useSpring(target: number, config: SpringConfig = {}): number {
  const { stiffness = 170, damping = 26, mass = 1, initial = 0 } = config;
  const stateRef = useRef<SpringState>({ current: initial, velocity: 0 });
  const targetRef = useRef<number>(target);
  const rafRef = useRef<number>(0);
  const [, force] = useState(0);

  targetRef.current = target;

  useEffect(() => {
    const tick = () => {
      const s = stateRef.current;
      const t = targetRef.current;
      // 胡克定律：F = -k*(current - target) - c*velocity
      const force = -stiffness * (s.current - t) - damping * s.velocity;
      const accel = force / mass;
      s.velocity += accel * (1 / 60);  // 假设 60fps，dt=1/60
      s.current += s.velocity * (1 / 60);
      // 视为已稳定（避免无止境微振荡）
      if (Math.abs(s.current - t) < 0.001 && Math.abs(s.velocity) < 0.001) {
        s.current = t;
        s.velocity = 0;
      }
      force(n => n + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stiffness, damping, mass]);

  return stateRef.current.current;
}
