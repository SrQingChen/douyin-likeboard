<script setup lang="ts">
// 高能冲刺粒子：金色光尘飘落（仅冲刺期间挂载，卸载即停）
import { ref, onMounted, onScopeDispose } from 'vue';

const cv = ref<HTMLCanvasElement | null>(null);
let raf = 0;
let ro: ResizeObserver | null = null;

onMounted(() => {
  const canvas = cv.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 1, H = 1;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  };
  resize();
  ro = new ResizeObserver(resize); ro.observe(canvas);

  const colors = ['#fff6c8', '#ffd76a', '#f4b942', '#ffe9a3', '#ffffff'];
  const parts = Array.from({ length: 70 }, () => ({
    x: Math.random(), y: Math.random(),
    vy: 0.006 + Math.random() * 0.013,
    sway: 0.35 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    size: 1.4 + Math.random() * 3.2,
    color: colors[Math.floor(Math.random() * colors.length)],
    tw: Math.random() * Math.PI * 2,
    spin: 0.05 + Math.random() * 0.12,
  }));

  let last = performance.now();
  const step = (now: number) => {
    const dt = Math.min(34, now - last) / 16.67; last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.y += p.vy * dt;
      p.phase += 0.028 * dt;
      p.tw += 0.11 * dt;
      if (p.y > 1.06) { p.y = -0.06; p.x = Math.random(); }
      const x = p.x * W + Math.sin(p.phase) * p.sway * 16;
      const y = p.y * H;
      const a = 0.30 + 0.65 * (0.5 + 0.5 * Math.sin(p.tw));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.size > 2.6) {
        // 四角星芒
        const s = p.size * 1.5;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(p.tw * p.spin);
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0);
        ctx.quadraticCurveTo(s * 0.18, s * 0.18, 0, s);
        ctx.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0);
        ctx.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
});

onScopeDispose(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
});
</script>

<template>
  <canvas ref="cv" class="absolute inset-0 w-full h-full pointer-events-none z-20" />
</template>
