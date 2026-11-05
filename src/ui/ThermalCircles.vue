<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import * as F from '../app/format';
import { i18n, locale, t } from '../app/i18n';
import type { ActivityResult } from '../app/types';
import { bands, CENTRED_SHARE, centring, climbHistogram, meanOf, type CircleStat } from '../core';

const props = defineProps<{ result: ActivityResult; title: string }>();

// same values as the tokens in style.css (canvas cannot read CSS variables cheaply)
const LEFT = '#8ccbe6'; // sky
const RIGHT = '#f0c24b'; // lift
const GRID = '#34423d';
const MUTED = '#aab4ab';
const TEXT = '#f1f0ea';
const BG = '#1b2421';
/** one accent: climb in lift yellow, sink in sky blue, strength as opacity */
const climbColor = (v: number) => (v < 0 ? `rgba(140, 203, 230, ${Math.min(1, 0.45 + -v / 4)})` : `rgba(240, 194, 75, ${Math.min(1, 0.35 + v / 4)})`);

type ChartId = 'hist' | 'size' | 'alt' | 'time' | 'centre';
const charts: { id: ChartId; title: string; hint: string }[] = [
  { id: 'hist', title: 'Verteilung der Steigwerte', hint: 'Zeit beim Kreisen je Steigwert, pro Vollkreis gemessen' },
  { id: 'size', title: 'Kreisdurchmesser und Steigen', hint: 'Jeder Punkt ein Vollkreis: blau links, orange rechts gekreist' },
  { id: 'alt', title: 'Steigen nach Höhe', hint: 'Ø Steigen je 250-m-Band, Balkenlänge = Zeit beim Kreisen' },
  { id: 'time', title: 'Steigen nach Tageszeit', hint: 'Ø Steigen je halbe Stunde, Punkte = einzelne Kreise' },
  { id: 'centre', title: 'Zentrieren', hint: 'Steigen Kreis für Kreis ab Einflug: dünn je Thermik, dick der Schnitt' },
];

const circles = computed<CircleStat[]>(() => props.result.flight?.circles ?? []);
const tz = computed(() => props.result.timeZone);
const cen = computed(() => centring(circles.value));
const totalS = computed(() => circles.value.reduce((a, c) => a + c.durationS, 0));

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : null);

const kpis = computed(() => {
  const cs = circles.value;
  const done = cen.value.filter((c) => c.centredAfterS != null);
  const left = cs.filter((c) => c.dir < 0);
  const right = cs.filter((c) => c.dir > 0);
  const diam = (l: CircleStat[]) => F.m(meanOf(l, (c) => 2 * c.radiusM));
  return [
    [t('Vollkreise'), `${cs.length}`, `${left.length} ${t('links')}, ${right.length} ${t('rechts')}`],
    [t('Ø Durchmesser'), diam(cs), `${t('links')} ${diam(left)}, ${t('rechts')} ${diam(right)}`],
    [t('Ø Querlage'), `${F.num(meanOf(cs, (c) => c.bankDeg))}°`, `${t('Ø Kreiszeit')} ${F.num(meanOf(cs, (c) => c.durationS))} s`],
    [t('Ø Steigen im Kreis'), F.vario(meanOf(cs, (c) => c.climb)), `${t('bester Kreis')} ${F.vario(cs.length ? Math.max(...cs.map((c) => c.climb)) : null)}`],
    [
      t('Zentriert nach'),
      done.length ? `${F.num(median(done.map((c) => c.centredAfterS!)))} s` : '–',
      done.length ? `${t('Median')}, ${t('Kreis')} ${F.num(median(done.map((c) => c.centredTurn!)))}` : '',
    ],
  ];
});

/** Diameter class with the best climb: time-weighted climb per 10-m class with at least 3 circles */
const bestSize = computed(() => {
  const b = bands(circles.value, (c) => 2 * c.radiusM, 10).filter((x) => x.n >= 3);
  return b.length ? b.reduce((a, x) => (x.climb > a.climb ? x : a)) : null;
});

// ---------- drawing ----------
interface Box { x: number; y: number; w: number; h: number }
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= raw) ?? 10 * p;
}
function axisY(g: CanvasRenderingContext2D, b: Box, lo: number, hi: number, fmt: (v: number) => string) {
  const step = niceStep((hi - lo) / 4);
  g.font = '11px system-ui';
  g.fillStyle = MUTED;
  g.strokeStyle = GRID;
  g.lineWidth = 1;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  const y = (v: number) => b.y + (1 - (v - lo) / (hi - lo)) * b.h;
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    g.beginPath();
    g.moveTo(b.x, Math.round(y(v)) + 0.5);
    g.lineTo(b.x + b.w, Math.round(y(v)) + 0.5);
    g.stroke();
    g.fillText(fmt(Math.abs(v) < 1e-9 ? 0 : v), b.x - 6, y(v));
  }
  return y;
}
function axisX(g: CanvasRenderingContext2D, b: Box, lo: number, hi: number, fmt: (v: number) => string, step?: number) {
  const st = step ?? niceStep((hi - lo) / 6);
  g.font = '11px system-ui';
  g.fillStyle = MUTED;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const x = (v: number) => b.x + ((v - lo) / (hi - lo)) * b.w;
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) g.fillText(fmt(v), x(v), b.y + b.h + 6);
  return x;
}
function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'left', color = MUTED) {
  g.font = '11px system-ui';
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, y);
}
const nf1 = (v: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v);
const nf0 = (v: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(v);
const dot = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
};
const climbRange = (vs: number[]) => [Math.floor(Math.min(0, ...vs)), Math.ceil(Math.max(1, ...vs))] as const;

function draw(id: ChartId, g: CanvasRenderingContext2D, W: number, H: number) {
  const cs = circles.value;
  if (!cs.length) return;
  const b: Box = { x: 48, y: 16, w: W - 48 - 12, h: H - 16 - 30 };

  if (id === 'hist') {
    const hist = climbHistogram(cs, 0.5);
    const maxMin = Math.max(...hist.map((h) => h.s)) / 60;
    const y = axisY(g, b, 0, maxMin * 1.15, nf1);
    const lo = hist[0].lo;
    const hi = hist[hist.length - 1].lo + 0.5;
    const x = axisX(g, b, lo, hi, nf1, hi - lo > 6 ? 1 : 0.5);
    for (const h of hist) {
      g.fillStyle = climbColor(h.lo + 0.25);
      g.fillRect(x(h.lo) + 1, y(h.s / 60), Math.max(1, x(h.lo + 0.5) - x(h.lo) - 2), y(0) - y(h.s / 60));
      if (h.s / totalS.value >= 0.04) label(g, `${Math.round((h.s / totalS.value) * 100)} %`, (x(h.lo) + x(h.lo + 0.5)) / 2, y(h.s / 60) - 4, 'center', TEXT);
    }
    const mean = meanOf(cs, (c) => c.climb)!;
    g.strokeStyle = TEXT;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(x(mean), b.y);
    g.lineTo(x(mean), b.y + b.h);
    g.stroke();
    g.setLineDash([]);
    // mean label at the top right of the plot, clear of the bar labels
    label(g, `Ø ${nf1(mean)} m/s - - -`, b.x + b.w, b.y - 4, 'right', TEXT);
    label(g, 'min', 6, b.y - 4);
    label(g, 'm/s', W - 12, H - 2, 'right');
  } else if (id === 'size') {
    const ds = cs.map((c) => 2 * c.radiusM);
    const dLo = Math.max(0, Math.floor(Math.min(...ds) / 20) * 20);
    const dHi = Math.ceil(Math.max(...ds) / 20) * 20;
    const [vLo, vHi] = climbRange(cs.map((c) => c.climb));
    const y = axisY(g, b, vLo, vHi, nf1);
    const x = axisX(g, b, dLo, dHi, nf0);
    const bs = bestSize.value;
    if (bs) {
      g.fillStyle = 'rgba(255,255,255,.07)';
      g.fillRect(x(bs.lo), b.y, x(bs.lo + 10) - x(bs.lo), b.h);
      const right = x(bs.lo + 10) + 150 < W;
      label(g, `${t('bestes Steigen')} ${nf0(bs.lo)}–${nf0(bs.lo + 10)} m`, right ? x(bs.lo + 10) + 4 : x(bs.lo) - 4, b.y + 10, right ? 'left' : 'right', TEXT);
    }
    for (const c of cs) {
      g.fillStyle = c.dir < 0 ? LEFT : RIGHT;
      g.globalAlpha = c.thermal >= 0 ? 0.85 : 0.35;
      dot(g, x(2 * c.radiusM), y(c.climb), 3);
    }
    g.globalAlpha = 1;
    label(g, 'm/s', 6, b.y - 4);
    label(g, `${t('Durchmesser')} m`, W - 12, H - 2, 'right');
  } else if (id === 'alt') {
    const bs = bands(cs, (c) => c.alt, 250);
    const maxS = Math.max(...bs.map((x) => x.s));
    const bx: Box = { ...b, x: 56, w: W - 56 - 150 };
    const rowH = bx.h / bs.length;
    g.font = '11px system-ui';
    g.textBaseline = 'middle';
    bs.forEach((band, k) => {
      const yy = bx.y + bx.h - (k + 1) * rowH;
      const w = Math.max(2, (band.s / maxS) * bx.w);
      g.fillStyle = climbColor(band.climb);
      g.fillRect(bx.x, yy + 2, w, Math.max(1, rowH - 4));
      g.fillStyle = MUTED;
      g.textAlign = 'right';
      g.fillText(nf0(band.lo), bx.x - 6, yy + rowH);
      g.fillStyle = TEXT;
      g.textAlign = 'left';
      g.fillText(`${band.climb >= 0 ? '+' : ''}${nf1(band.climb)} m/s, ${F.dur(band.s)}`, bx.x + w + 6, yy + rowH / 2);
    });
    g.fillStyle = MUTED;
    g.textAlign = 'right';
    g.fillText(nf0(bs[bs.length - 1].lo + 250), bx.x - 6, bx.y);
    label(g, 'm', 6, b.y - 4);
  } else if (id === 'time') {
    const HALF = 1800e3;
    const bs = bands(cs, (c) => c.t, HALF);
    const t0 = bs[0].lo;
    const t1 = bs[bs.length - 1].lo + HALF;
    const [vLo, vHi] = climbRange(cs.map((c) => c.climb));
    const y = axisY(g, b, vLo, vHi, nf1);
    const x = (v: number) => b.x + ((v - t0) / (t1 - t0)) * b.w;
    g.font = '11px system-ui';
    g.fillStyle = MUTED;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const tick = (t1 - t0) / HALF > 12 ? 2 * HALF : HALF;
    for (let v = Math.ceil(t0 / tick) * tick; v <= t1; v += tick) g.fillText(F.clock(v, tz.value), x(v), b.y + b.h + 6);
    for (const band of bs) {
      g.fillStyle = climbColor(band.climb);
      g.globalAlpha = 0.6;
      const top = y(Math.max(0, band.climb));
      const bot = y(Math.min(0, band.climb));
      g.fillRect(x(band.lo) + 2, top, x(band.lo + HALF) - x(band.lo) - 4, Math.max(1, bot - top));
    }
    g.fillStyle = TEXT;
    g.globalAlpha = 0.5;
    for (const c of cs) dot(g, x(c.t), y(c.climb), 1.8);
    g.globalAlpha = 1;
    label(g, 'm/s', 6, b.y - 4);
  } else if (id === 'centre') {
    const list = cen.value.filter((c) => c.circles.length >= 3);
    if (!list.length) return;
    const N = Math.min(15, Math.max(3, ...list.map((c) => c.circles.length)));
    const [vLo, vHi] = climbRange(list.flatMap((c) => c.circles.slice(0, N).map((x) => x.climb)));
    const y = axisY(g, b, vLo, vHi, nf1);
    const x = axisX(g, b, 1, N, nf0, N > 10 && b.w < 500 ? 2 : 1);
    g.lineWidth = 1.2;
    for (const c of list) {
      g.strokeStyle = MUTED;
      g.globalAlpha = 0.35;
      g.beginPath();
      c.circles.slice(0, N).forEach((p, k) => (k ? g.lineTo(x(k + 1), y(p.climb)) : g.moveTo(x(k + 1), y(p.climb))));
      g.stroke();
    }
    g.globalAlpha = 1;
    // mean per turn number, over the thermals that still had that turn
    const mean: [number, number][] = [];
    for (let k = 0; k < N; k++) {
      const v = list.filter((c) => c.circles.length > k).map((c) => c.circles[k].climb);
      if (v.length >= 2) mean.push([k + 1, v.reduce((a, q) => a + q, 0) / v.length]);
    }
    g.strokeStyle = RIGHT;
    g.lineWidth = 3;
    g.beginPath();
    mean.forEach(([k, v], i) => (i ? g.lineTo(x(k), y(v)) : g.moveTo(x(k), y(v))));
    g.stroke();
    g.lineWidth = 1;
    g.fillStyle = RIGHT;
    for (const [k, v] of mean) dot(g, x(k), y(v), 3);
    label(g, 'm/s', 6, b.y - 4);
    label(g, t('Kreis Nr. ab Einflug'), W - 12, H - 2, 'right');
  }
}

// ---------- canvases ----------
const boxes: Partial<Record<ChartId, HTMLDivElement>> = {};
const canvases: Partial<Record<ChartId, HTMLCanvasElement>> = {};
const CHART_H = 240;
function render() {
  for (const c of charts) {
    const cv = canvases[c.id];
    const bx = boxes[c.id];
    if (!cv || !bx) continue;
    const W = bx.clientWidth;
    if (!W) continue;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr;
    cv.height = CHART_H * dpr;
    cv.style.width = `${W}px`;
    cv.style.height = `${CHART_H}px`;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, CHART_H);
    draw(c.id, g, W, CHART_H);
  }
}
let ro: ResizeObserver | null = null;
onMounted(() => {
  render();
  ro = new ResizeObserver(() => render());
  Object.values(boxes).forEach((b) => b && ro!.observe(b));
});
onUnmounted(() => ro?.disconnect());
watch(() => [props.result, i18n.lang], () => requestAnimationFrame(render));

/** Chart as PNG with title, flight name and a source line */
function savePng(id: ChartId) {
  const c = charts.find((x) => x.id === id)!;
  const W = 1200, CH = 560, top = 86, bottom = 40, s = 2, k = 1.5;
  const cv = document.createElement('canvas');
  cv.width = W * s;
  cv.height = (top + CH + bottom) * s;
  const g = cv.getContext('2d')!;
  g.scale(s, s);
  g.fillStyle = BG;
  g.fillRect(0, 0, W, top + CH + bottom);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = TEXT;
  g.font = '700 26px system-ui';
  g.fillText(t(c.title), 24, 40);
  g.fillStyle = MUTED;
  g.font = '15px system-ui';
  g.fillText(`${props.title}, ${t(c.hint)}`, 24, 66);
  g.save();
  g.translate(12, top);
  g.scale(k, k);
  draw(id, g, (W - 24) / k, CH / k);
  g.restore();
  g.fillStyle = MUTED;
  g.font = '13px system-ui';
  g.textAlign = 'right';
  g.fillText('tobmuc.github.io/track-auswertung', W - 20, top + CH + 26);
  cv.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(props.title || 'flug').replace(/[^\wäöüÄÖÜ-]+/g, '_')}_${id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
</script>

<template>
  <section v-if="circles.length >= 5" class="block circles">
    <h2>{{ t('Thermik & Kreisformen') }}</h2>
    <div class="ckpis">
      <div v-for="k in kpis" :key="k[0]" class="ckpi">
        <div class="value">{{ k[1] }}</div>
        <div class="name">{{ k[0] }}</div>
        <div class="muted sub">{{ k[2] }}</div>
      </div>
    </div>
    <div class="charts">
      <figure v-for="c in charts" :key="c.id" :class="['chart', c.id]">
        <figcaption>
          <strong>{{ t(c.title) }}</strong>
          <button class="png" :title="t('Diagramm als PNG speichern')" :aria-label="`${t('Diagramm als PNG speichern')}: ${t(c.title)}`" @click="savePng(c.id)">⤓ PNG</button>
        </figcaption>
        <div :ref="(el) => { if (el) boxes[c.id] = el as HTMLDivElement }" class="cbox">
          <canvas role="img" :aria-label="`${t(c.title)}: ${t(c.hint)}`" :ref="(el) => { if (el) canvases[c.id] = el as HTMLCanvasElement }" />
        </div>
        <p class="muted hint">{{ t(c.hint) }}</p>
      </figure>
    </div>
    <p class="note">
      {{ t('Durchmesser relativ zur Luft (Wind herausgerechnet) aus Eigengeschwindigkeit und Kreiszeit, Querlage daraus berechnet.') }}
      {{ t('„Zentriert“: erster Kreis mit mindestens {p} % des besten Steigens der Thermik.').replace('{p}', String(Math.round(CENTRED_SHARE * 100))) }}
    </p>
  </section>
</template>

<style scoped>
.circles > h2 { padding-top: 18px; border-top: 1px solid var(--rule); margin-bottom: 18px; }
.ckpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px 32px; margin-bottom: 28px; }
.ckpi .value { font-size: 28px; font-weight: 700; line-height: 1.1; font-variation-settings: 'wdth' 125; }
.ckpi .name { font-size: var(--fs-2); margin-top: 2px; }
.ckpi .sub { font-size: var(--fs-1); }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: 20px 26px; }
.chart { margin: 0; min-width: 0; }
.chart.centre { grid-column: 1 / -1; }
figcaption { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 14px; }
.png { padding: 2px 9px; font-size: 12px; }
.cbox { width: 100%; }
canvas { display: block; }
.hint { font-size: 12px; margin: 4px 0 0; }
.note { font-size: 13px; color: var(--muted); margin: 16px 0 0; }
</style>
