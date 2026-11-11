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
  // 两组：中心爆发 + 顶部彩带雨（雨组让庆祝延续 4~6s，不是一闪就没）
  const make = (rain: boolean) => ({
    x: rain ? Math.random() * W : W / 2 + (Math.random() - 0.5) * W * 0.35,
    y: rain ? -20 - Math.random() * H * 0.5 : H * 0.26,
    vx: rain ? (Math.random() - 0.5) * 2 * dpr : (Math.random() - 0.5) * 13 * dpr,
    vy: rain ? (1.0 + Math.random() * 2.4) * dpr : (-4 - Math.random() * 8) * dpr,
    w: (3.5 + Math.random() * 5) * dpr, h: (6 + Math.random() * 6) * dpr,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.22,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 1, rain,
  });
  const parts = [
    ...Array.from({ length: 160 }, () => make(false)),
    ...Array.from({ length: 100 }, () => make(true)),
  ];
  let last = performance.now();
  const step = (now: number) => {
    // 帧间隔（不是距开始时间）——否则 dt 迅速涨到 32，彩带 0.1s 内消失
    const dt = Math.min(32, Math.max(0, now - last)) / 16;
    last = now;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of parts) {
      p.vy += (p.rain ? 0.10 : 0.22) * dpr * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      p.life -= (p.rain ? 0.0018 : 0.003) * dt;
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
