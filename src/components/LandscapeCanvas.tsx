import { useEffect, useRef } from 'react';
import type { SimStore } from '../store';
import { createClouds, renderLandscapeFrame } from '../landscape/render';
import type { AnimClock, Cloud, Parallax } from '../landscape/render';

export function LandscapeCanvas({ store }: { store: SimStore }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const anim: AnimClock = { time: 0, waterOffset: 0 };
    const parallax: Parallax = { x: 0, y: 0 };
    let clouds: Cloud[] = [];

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = width + 'px';
      canvas!.style.height = height + 'px';
      ctx!.scale(dpr, dpr);
    }

    function onMouseMove(e: MouseEvent) {
      parallax.x = (e.clientX / window.innerWidth - 0.5) * 2;
      parallax.y = (e.clientY / window.innerHeight - 0.5) * 2;
    }

    resize();
    clouds = createClouds(width);
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove);

    let rafId = requestAnimationFrame(function frame() {
      renderLandscapeFrame(ctx!, width, height, store.getSnapshot(), parallax, anim, clouds);
      rafId = requestAnimationFrame(frame);
    });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [store]);

  return <canvas id="landscape-canvas" ref={canvasRef} />;
}
