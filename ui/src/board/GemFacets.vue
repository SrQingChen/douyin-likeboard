<script setup lang="ts">
// 透明宝石行背景：共享高度场 → 逐面 3D 法线 → 平面着色 + 朝光边倒角高光。
// 作者模式（color='rainbow'）颜色按「左上→右下」的对角波缓慢推进：
// 右下晶面比左上晶面滞后 LAG 个周期，所以看起来是颜色逐格流过去。
import { onMounted, onScopeDispose, ref, watch } from 'vue';

const props = defineProps<{ seed: string; color: string }>();

type Pt = { x: number; y: number; z: number };
type Facet = {
  pts: Pt[]; bevel: Pt[];
  cx: number; cy: number; d: number; r: number; cell: number;
  nx: number; ny: number; nz: number; bright: number;
};

// 统一光源：从左上斜向照来（3D）；2D 分量用于选择朝光边
const LIGHT = { x: -0.45, y: -0.65, z: 0.62 };
const LIGHT2 = { x: -0.45, y: -0.65 };

const cv = ref<HTMLCanvasElement | null>(null);
let ro: ResizeObserver | null = null;
let raf = 0;
let running = false;
let lastDraw = 0;
let t0 = 0;
let W = 1, H = 1;
let facets: Facet[] = [];
const reduceMotion = typeof window !== 'undefined'
  && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const CYCLE_MS = 16000;   // 颜色波完整循环
const LAG = 0.30;         // 右下角相对左上角滞后一个周期的比例
const HUE_START = 150;    // 翠绿起点
const HUE_WOBBLE = 14;    // 色相推进速度的平滑扰动（度）

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const seedPhase = (hash('author-phase') % 360) * Math.PI / 180;
const rngOf = (a: number) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 265, s: 80, l: 60 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 不规则抖动网格 + 共享高度场（连续曲面）→ 三角/四边形晶面。
 *  每个晶面的亮度由该面的 3D 法线与光源夹角决定（平面着色），
 *  相邻面共享顶点，所以明暗分布有连续、可预期的起伏规律。 */
function buildGeometry(w: number, h: number, seed: string): Facet[] {
  const R = rngOf(hash(seed));
  const cols = clamp(Math.round(w / 54), 6, 18);
  const rows = clamp(Math.round(h / 20), 2, 4);
  const cellW = w / cols, cellH = h / rows;
  const amp = Math.min(cellW, cellH) * 0.62;

  // 粗控制点高度场（双线性 + smoothstep），保证起伏是连续的，而不是每面随机
  const CX = 5, CY = 3;
  const coarse: number[][] = [];
  for (let j = 0; j <= CY; j++) {
    const row: number[] = [];
    for (let i = 0; i <= CX; i++) row.push(R() * 2 - 1);
    coarse.push(row);
  }
  const heightAt = (u: number, v: number) => {
    const fx = u * CX, fy = v * CY;
    const i = Math.min(CX - 1, Math.floor(fx)), j = Math.min(CY - 1, Math.floor(fy));
    const tx = fx - i, ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = coarse[j][i], b = coarse[j][i + 1], c = coarse[j + 1][i], d = coarse[j + 1][i + 1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };

  const pts: Pt[][] = [];
  for (let j = 0; j <= rows; j++) {
    const row: Pt[] = [];
    for (let i = 0; i <= cols; i++) {
      const edge = i === 0 || i === cols || j === 0 || j === rows;
      const jx = edge ? 0 : (R() - 0.5) * cellW * 0.86;
      const jy = edge ? 0 : (R() - 0.5) * cellH * 0.86;
      const z = heightAt(i / cols, j / rows) * amp + (R() - 0.5) * amp * 0.62;
      row.push({ x: (i / cols) * w + jx, y: (j / rows) * h + jy, z });
    }
    pts.push(row);
  }

  const out: Facet[] = [];
  const push = (poly: Pt[]) => {
    const cx = poly.reduce((s, q) => s + q.x, 0) / poly.length;
    const cy = poly.reduce((s, q) => s + q.y, 0) / poly.length;
    // Newell 法线（对非平面四边形也稳定）
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const bright = clamp(nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z, 0, 1);
    out.push({
      pts: poly, cx, cy,
      d: ((cx / Math.max(1, w - 1)) + (cy / Math.max(1, h - 1))) / 2,
      bevel: poly.map(q => ({ x: cx + (q.x - cx) * 0.78, y: cy + (q.y - cy) * 0.78, z: q.z })),
      r: R(), cell: Math.min(cellW, cellH),
      nx, ny, nz, bright,
    });
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i], d = pts[j + 1][i + 1];
      // 约 1/3 的格子整块成四边形：晶面大小有变化，避免均匀网格的“碎玻璃”感
      if (R() < 0.34) push([a, b, d, c]);
      else if (R() > 0.5) { push([a, b, d]); push([a, d, c]); }
      else { push([a, b, c]); push([b, d, c]); }
    }
  }
  return out;
}

/** 作者彩虹：完整 360° 闭环 + 正弦速度扰动；p=0/1 颜色与导数连续。 */
function hueAt(p: number): number {
  const h = HUE_START + 360 * p + HUE_WOBBLE * Math.sin(2 * Math.PI * 3 * p + seedPhase);
  return ((h % 360) + 360) % 360;
}
function facetHsl(f: Facet, phase: number): { h: number; s: number; l: number } {
  if (props.color === 'rainbow') {
    let p = (phase - f.d * LAG) % 1;
    if (p < 0) p += 1;
    return { h: hueAt(p), s: 86 + f.r * 4, l: 58 + f.r * 4 };
  }
  const c = hexToHsl(props.color);
  return {
    h: (c.h + (f.r - 0.5) * 4 + 360) % 360,
    s: clamp(c.s + (f.r - 0.5) * 4, 50, 94),
    l: clamp(c.l + (f.r - 0.5) * 4, 42, 68),
  };
}

function draw(ts: number) {
  const c = cv.value;
  if (!c) return;
  try {
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const rainbow = props.color === 'rainbow';
    const phase = rainbow ? (((ts - t0) / CYCLE_MS) % 1 + 1) % 1 : 0;
    const baseHue = rainbow ? hueAt(phase) : hexToHsl(props.color).h;

    // 1) 宝石基底：保留透明通道，边缘带色、中心暗（衬白字）
    const bg = ctx.createLinearGradient(0, 0, W * 0.8, H);
    bg.addColorStop(0, `hsla(${baseHue.toFixed(1)}, 74%, 26%, 0.42)`);
    bg.addColorStop(0.45, 'rgba(5, 9, 20, 0.34)');
    bg.addColorStop(1, `hsla(${((baseHue + 35) % 360).toFixed(1)}, 72%, 20%, 0.30)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 2) 左上光源的整体柔光
    const lg = ctx.createRadialGradient(W * 0.16, -H * 0.15, 0, W * 0.16, -H * 0.15, Math.max(W, H) * 0.8);
    lg.addColorStop(0, 'rgba(255,255,255,0.15)');
    lg.addColorStop(0.4, 'rgba(255,255,255,0.04)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);

    // 3) 逐晶面：按法线亮度做平面着色；只给朝光边加柔和倒角高光
    for (const f of facets) {
      const hsl = facetHsl(f, phase);
      const bright = f.bright;                       // 0（背光）..1（正对光源）
      const light = clamp(hsl.l + (bright - 0.58) * 38, 38, 80);
      const alpha = 0.14 + 0.34 * bright;

      ctx.beginPath();
      ctx.moveTo(f.pts[0].x, f.pts[0].y);
      for (let i = 1; i < f.pts.length; i++) ctx.lineTo(f.pts[i].x, f.pts[i].y);
      ctx.closePath();
      // 平面着色：同一晶面内基本均匀，亮度/不透明度由法线决定
      ctx.fillStyle = `hsla(${hsl.h.toFixed(1)}, ${hsl.s.toFixed(1)}%, ${light.toFixed(1)}%, ${alpha.toFixed(3)})`;
      ctx.fill();

      // 内斜面：亮面偏白、暗面偏黑（仍是低对比，不作为轮廓线）
      const bevelAlpha = bright >= 0.55
        ? 0.025 + (bright - 0.55) * 0.09
        : 0.02 + (0.55 - bright) * 0.05;
      ctx.beginPath();
      ctx.moveTo(f.bevel[0].x, f.bevel[0].y);
      for (let i = 1; i < f.bevel.length; i++) ctx.lineTo(f.bevel[i].x, f.bevel[i].y);
      ctx.closePath();
      ctx.fillStyle = bright >= 0.55
        ? `rgba(255,255,255,${bevelAlpha.toFixed(3)})`
        : `rgba(0,0,0,${bevelAlpha.toFixed(3)})`;
      ctx.fill();

      // 朝光边：只用最受光的一条边，两端渐隐，形成倒角高光
      const n = f.pts.length;
      let best = -1, bestLit = 0;
      for (let i = 0; i < n; i++) {
        const a = f.pts[i], b = f.pts[(i + 1) % n];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        let nx = -(b.y - a.y), ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        if (nx * (mx - f.cx) + ny * (my - f.cy) < 0) { nx = -nx; ny = -ny; }
        const lit = nx * LIGHT2.x + ny * LIGHT2.y;
        if (lit > bestLit) { bestLit = lit; best = i; }
      }
      if (best >= 0 && bestLit > 0.18 && bright > 0.42) {
        const a = f.pts[best], b = f.pts[(best + 1) % n];
        const strength = Math.min(0.30, 0.05 + bright * 0.18 + (bestLit - 0.18) * 0.10);
        const gEdge = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gEdge.addColorStop(0, 'rgba(255,255,255,0)');
        gEdge.addColorStop(0.5, `rgba(255,255,255,${strength.toFixed(3)})`);
        gEdge.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.lineCap = 'round';
        ctx.strokeStyle = gEdge;
        ctx.lineWidth = 2.0;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

        const gCore = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gCore.addColorStop(0, 'rgba(255,255,255,0)');
        gCore.addColorStop(0.5, `rgba(255,255,255,${Math.min(0.42, strength * 1.6).toFixed(3)})`);
        gCore.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = gCore;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.restore();

        // 色散只跟受光边走，且很淡
        if (bright > 0.72 && f.r > 0.5) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          ctx.lineWidth = 0.7;
          ctx.strokeStyle = 'rgba(90,220,255,0.08)';
          ctx.translate(-0.8, 0.2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,90,200,0.06)';
          ctx.translate(1.6, -0.4); ctx.stroke();
          ctx.restore();
        }
      }

      // 高光点：只给最亮的面，位置朝光源方向偏，形成规律的反光
      if (bright > 0.84 && f.r > 0.55) {
        const gx = f.cx + LIGHT2.x * f.cell * 0.28;
        const gy = f.cy + LIGHT2.y * f.cell * 0.28;
        const radius = Math.max(8, f.cell * 0.55);
        const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
        rg.addColorStop(0, 'rgba(255,255,255,0.30)');
        rg.addColorStop(0.3, 'rgba(255,255,255,0.08)');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = rg;
        ctx.fillRect(gx - radius, gy - radius, radius * 2, radius * 2);
        ctx.restore();
      }
    }

    // 4) 顶部柔光：统一整体光感，弱化晶面割裂
    const bloom = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    bloom.addColorStop(0, 'rgba(255,255,255,0.10)');
    bloom.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, W, H * 0.5);

    // 5) 斜向镜面光带（与颜色波同方向）
    const sh = ctx.createLinearGradient(0, 0, W * 0.95, H);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(0.40, 'rgba(255,255,255,0.045)');
    sh.addColorStop(0.52, 'rgba(255,255,255,0.015)');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, W, H);

    // 6) 底部内阴影：压住底边保证白字可读
    const bs = ctx.createLinearGradient(0, H * 0.42, 0, H);
    bs.addColorStop(0, 'rgba(0,0,0,0)');
    bs.addColorStop(1, 'rgba(0,0,0,0.40)');
    ctx.fillStyle = bs;
    ctx.fillRect(0, H * 0.42, W, H * 0.58);
  } catch (e) {
    console.warn('gem draw failed', e);
  }
}

function resize() {
  const c = cv.value;
  if (!c) return;
  const rect = c.getBoundingClientRect();
  W = Math.max(1, Math.round(rect.width));
  H = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  facets = buildGeometry(W, H, props.seed);
  draw(performance.now());
}

function loop(now: number) {
  if (!running) return;
  if (now - lastDraw >= 32) { lastDraw = now; draw(now); }
  raf = requestAnimationFrame(loop);
}
function start() {
  if (running || props.color !== 'rainbow' || reduceMotion) return;
  running = true; t0 = performance.now(); lastDraw = 0;
  raf = requestAnimationFrame(loop);
}
function stop() {
  running = false;
  cancelAnimationFrame(raf); raf = 0;
}

onMounted(() => {
  resize();
  ro = new ResizeObserver(() => resize());
  if (cv.value) ro.observe(cv.value);
  start();
  if (!running) draw(performance.now());
});
onScopeDispose(() => { stop(); ro?.disconnect(); });
watch(() => [props.seed, props.color], () => { stop(); resize(); start(); });
</script>

<template>
  <div class="gem-facets" aria-hidden="true">
    <canvas ref="cv" class="gem-canvas" />
    <span class="gem-sheen" />
  </div>
</template>

<style scoped>
.gem-facets {
  position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none;
  filter: saturate(1.08) contrast(1.03);
}
.gem-canvas { width: 100%; height: 100%; display: block; filter: blur(0.35px); }
/* 斜向镜面光带：与颜色波同方向（左上→右下） */
.gem-sheen {
  position: absolute; inset: -55% -75%;
  background: linear-gradient(125deg,
    transparent 40%, rgba(255,255,255,0.14) 49%, rgba(255,255,255,0.03) 55%, transparent 64%);
  transform: translate3d(-42%, -8%, 0);
  animation: gemSheen 7.6s ease-in-out infinite;
  mix-blend-mode: screen;
}
@keyframes gemSheen {
  0%, 12% { transform: translate3d(-42%, -8%, 0); }
  58%, 100% { transform: translate3d(42%, 8%, 0); }
}
</style>
