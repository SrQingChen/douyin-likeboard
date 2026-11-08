<script setup lang="ts">
// 结算彩带：canvas 粒子一次性爆发（仅 record/champion 级结算触发）
import { ref, onScopeDispose } from 'vue';

const cv = ref<HTMLCanvasElement | null>(null);
let raf = 0;

function burst() {
  const canvas = cv.value; if (!canvas) return;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr;
  const W = canvas.width, H = canvas.height;
  const colors = ['#ffd76a', '#f472b6', '#818cf8', '#34d399', '#f8fafc'];
  const parts = Array.from({ length: 160 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.28,
    vx: (Math.random() - 0.5) * 14 * dpr,
    vy: (-6 - Math.random() * 9) * dpr,
    w: (4 + Math.random() * 5) * dpr, h: (7 + Math.random() * 6) * dpr,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 1,
  }));
  const t0 = performance.now();
  const step = (now: number) => {
    const dt = Math.min(32, now - t0) / 16;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.32 * dpr; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      p.life -= 0.006 * dt;
      if (p.life > 0 && p.y < H + 20) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }
    if (alive) raf = requestAnimationFrame(step);
    else ctx.clearRect(0, 0, W, H);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(step);
}

defineExpose({ burst });
onScopeDispose(() => cancelAnimationFrame(raf));
</script>

<template>
  <canvas ref="cv" class="absolute inset-0 w-full h-full pointer-events-none z-40" />
</template>
