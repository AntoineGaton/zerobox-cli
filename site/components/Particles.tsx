"use client";

import { useEffect, useRef } from "react";

type Dot = { x: number; y: number; r: number; vx: number; vy: number; a: number; phase: number; speed: number };

/** Pixels of section area per particle, and the most particles one section draws. */
const AREA_PER_DOT = 14000;
const MAX_DOTS = 70;

/**
 * Slow, faint white particles drifting behind a section, like the PS4 home screen.
 * Draws one still frame under prefers-reduced-motion, and pauses while off screen
 * or while the tab is hidden.
 */
export function Particles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots: Dot[] = [];
    let w = 0;
    let h = 0;
    let frame = 0;
    let visible = false;
    let last = 0;

    const spawn = (anywhere: boolean): Dot => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      r: 0.6 + Math.random() ** 3 * 2.6,
      vx: (Math.random() - 0.5) * 6,
      vy: -(3 + Math.random() * 9),
      a: 0.25 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.8,
    });

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(MAX_DOTS, Math.round((w * h) / AREA_PER_DOT));
      dots = Array.from({ length: count }, () => spawn(true));
      draw(0);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        const twinkle = 0.6 + 0.4 * Math.sin(d.phase + (t / 1000) * d.speed);
        const alpha = d.a * twinkle;
        // Soft glow, then a brighter core.
        const glow = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 4);
        glow.addColorStop(0, `rgba(255,255,255,${alpha * 0.35})`);
        glow.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = (t: number) => {
      const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
      last = t;
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y < -10 || d.x < -10 || d.x > w + 10) dots[i] = spawn(false);
      }
      draw(t);
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (still || frame || !visible || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const sizer = new ResizeObserver(resize);
    sizer.observe(canvas);
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    seen.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      sizer.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="particles" aria-hidden="true" />;
}
