<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { colorBucket, type ColorMode } from '../app/colors';
import { clock, m, kmh, signed } from '../app/format';
import type { ActivityResult } from '../app/types';
import { i18n, locale, t } from '../app/i18n';

const props = defineProps<{ result: ActivityResult; colorMode: ColorMode; hoverIdx: number | null; ground?: Float32Array }>();
const emit = defineEmits<{ hover: [idx: number | null] }>();

const canvas = ref<HTMLCanvasElement>();
const box = ref<HTMLDivElement>();
const tip = ref<{ x: number; text: string[] } | null>(null);
const PAD = { l: 52, r: 12, t: 12, b: 26 };
let ro: ResizeObserver | null = null;

function extent() {
  const tl = props.result.timeline;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < tl.alt.length; i++) { lo = Math.min(lo, tl.alt[i]); hi = Math.max(hi, tl.alt[i]); }
  const gr = props.ground;
  if (gr?.length) for (let i = 0; i < gr.length; i++) if (gr[i] === gr[i]) lo = Math.min(lo, gr[i]);
  const step = niceStep((hi - lo) / 4);
  return { t0: tl.t[0], t1: tl.t[tl.t.length - 1], lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= raw) ?? 10 * p;
}

function draw() {
  const c = canvas.value;
  if (!c || !box.value) return;
  const W = box.value.clientWidth;
  const H = 200;
  const dpr = window.devicePixelRatio || 1;
  c.width = W * dpr; c.height = H * dpr;
  c.style.width = `${W}px`; c.style.height = `${H}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  const tl = props.result.timeline;
  const { t0, t1, lo, hi, step } = extent();
  const pw = W - PAD.l - PAD.r;
  const ph = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * pw;
  const y = (a: number) => PAD.t + (1 - (a - lo) / (hi - lo)) * ph;

  // grid + altitude axis
  g.font = '11px system-ui';
  g.fillStyle = '#8b98a8';
  g.strokeStyle = '#2a3441';
  g.lineWidth = 1;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let a = lo; a <= hi + 0.1; a += step) {
    g.beginPath(); g.moveTo(PAD.l, y(a) + 0.5); g.lineTo(W - PAD.r, y(a) + 0.5); g.stroke();
    g.fillText(new Intl.NumberFormat(locale()).format(a), PAD.l - 6, y(a));
  }
  // time axis
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const hourMs = 3600e3;
  const spanH = (t1 - t0) / hourMs;
  const tickMs = (spanH > 8 ? 2 : spanH > 2 ? 1 : 0.5) * hourMs;
  for (let t = Math.ceil(t0 / tickMs) * tickMs; t <= t1; t += tickMs) {
    g.fillText(clock(t, props.result.timeZone), x(t), H - PAD.b + 6);
  }

  // coloured columns, one per pixel column (last point wins)
  const isHike = (i: number) => props.result.segments[tl.seg[i]].kind === 'hike';
  let lastPx = -1;
  for (let i = 0; i < tl.t.length; i++) {
    const px = Math.round(x(tl.t[i]));
    if (px === lastPx) continue;
    if (i > 0 && tl.seg[i] !== tl.seg[i - 1]) {
      // gap between hike and flight: hatched
      const xa = x(tl.t[i - 1]);
      g.save();
      g.strokeStyle = '#3a4554';
      for (let k = Math.floor(xa); k < px; k += 4) { g.beginPath(); g.moveTo(k, y(lo)); g.lineTo(k + 8, y(hi)); g.stroke(); }
      g.restore();
      g.setLineDash([4, 4]);
      g.strokeStyle = '#cfd8dc';
      g.beginPath(); g.moveTo(xa, y(tl.alt[i - 1])); g.lineTo(px, y(tl.alt[i])); g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = colorBucket(props.colorMode, tl.mode[i], tl.vario[i], tl.speed[i], isHike(i));
    const top = y(tl.alt[i]);
    g.fillRect(px, top, 1.5, y(lo) - top);
    lastPx = px;
  }
  // terrain under the track
  const gr = props.ground;
  if (gr?.length === tl.t.length) {
    g.fillStyle = '#4a3d31';
    g.beginPath();
    let open = false;
    let firstX = 0;
    let lastX = 0;
    const close = () => {
      if (!open) return;
      g.lineTo(lastX, y(lo)); g.lineTo(firstX, y(lo)); g.closePath();
      open = false;
    };
    let lastGx = -1;
    for (let i = 0; i < tl.t.length; i++) {
      const X = x(tl.t[i]);
      if (gr[i] !== gr[i] || (i > 0 && tl.seg[i] !== tl.seg[i - 1])) { close(); if (gr[i] !== gr[i]) continue; }
      if (Math.round(X) === lastGx && open) continue;
      lastGx = Math.round(X);
      if (!open) { g.moveTo(X, y(lo)); g.lineTo(X, y(gr[i])); firstX = X; open = true; }
      else g.lineTo(X, y(gr[i]));
      lastX = X;
    }
    close();
    g.fill();
    // ridge line on top of the terrain
    g.strokeStyle = '#c8a97e';
    g.lineWidth = 1.2;
    g.beginPath();
    let pen = false;
    for (let i = 0; i < tl.t.length; i += 2) {
      if (gr[i] !== gr[i] || (i > 0 && tl.seg[i] !== tl.seg[i - 1])) { pen = false; continue; }
      if (pen) g.lineTo(x(tl.t[i]), y(gr[i]));
      else { g.moveTo(x(tl.t[i]), y(gr[i])); pen = true; }
    }
    g.stroke();
  }

  // outline
  g.strokeStyle = 'rgba(255,255,255,.85)';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i < tl.t.length; i++) {
    const X = x(tl.t[i]);
    if (i === 0 || tl.seg[i] !== tl.seg[i - 1]) g.moveTo(X, y(tl.alt[i]));
    else g.lineTo(X, y(tl.alt[i]));
  }
  g.stroke();

  if (props.hoverIdx != null) {
    const X = x(tl.t[props.hoverIdx]);
    g.strokeStyle = '#fff';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(X, PAD.t); g.lineTo(X, y(lo)); g.stroke();
    g.fillStyle = '#ff8a3d';
    g.beginPath(); g.arc(X, y(tl.alt[props.hoverIdx]), 4, 0, Math.PI * 2); g.fill();
  }
}

function onMove(e: MouseEvent) {
  const tl = props.result.timeline;
  const rect = canvas.value!.getBoundingClientRect();
  const { t0, t1 } = extent();
  const t = t0 + ((e.clientX - rect.left - PAD.l) / (rect.width - PAD.l - PAD.r)) * (t1 - t0);
  if (t < t0 || t > t1) return onLeave();
  let lo = 0, hi = tl.t.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tl.t[mid] < t) lo = mid + 1; else hi = mid; }
  emit('hover', lo);
}
function onLeave() {
  emit('hover', null);
}

watch(() => props.hoverIdx, (i) => {
  draw();
  if (i == null) { tip.value = null; return; }
  const tl = props.result.timeline;
  const rect = canvas.value!.getBoundingClientRect();
  const { t0, t1 } = extent();
  const X = PAD.l + ((tl.t[i] - t0) / (t1 - t0)) * (rect.width - PAD.l - PAD.r);
  const hike = props.result.segments[tl.seg[i]].kind === 'hike';
  tip.value = {
    x: X,
    text: [
      clock(tl.t[i], props.result.timeZone),
      m(tl.alt[i]),
      hike ? signed(tl.vario[i] * 3600, 'm/h') : signed(tl.vario[i], 'm/s', 1),
      kmh(tl.speed[i]),
      ...(props.ground?.length && props.ground[i] === props.ground[i] && !hike ? [`${m(tl.alt[i] - props.ground[i])} ${t('über Grund')}`] : []),
    ],
  };
});
watch(() => [props.colorMode, props.ground, i18n.lang], draw);
onMounted(() => {
  draw();
  ro = new ResizeObserver(draw);
  ro.observe(box.value!);
});
onUnmounted(() => ro?.disconnect());
</script>

<template>
  <div ref="box" class="profile" @mousemove="onMove" @mouseleave="onLeave">
    <canvas ref="canvas" role="img" :aria-label="t('Höhenprofil')" />
    <div v-if="tip" class="tip" :style="{ left: `${tip.x}px` }">
      <span v-for="t in tip.text" :key="t">{{ t }}</span>
    </div>
  </div>
</template>

<style scoped>
.profile { position: relative; cursor: crosshair; }
canvas { display: block; }
.tip {
  position: absolute; top: 4px; transform: translateX(-50%); pointer-events: none; white-space: nowrap;
  display: flex; gap: 8px; padding: 3px 8px; border-radius: 6px; font-size: 12px;
  background: rgba(13, 17, 23, .9); border: 1px solid var(--line);
}
</style>
