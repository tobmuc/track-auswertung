<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { analyzeRecord } from '../app/analysis';
import { db } from '../app/db';
import { groundProfile, type GroundProfile } from '../app/ground';
import { i18n, t } from '../app/i18n';
import { loadPois, selectPois, type Poi } from '../app/pois';
import type { ActivityRecord, ActivityResult } from '../app/types';
import { makePlan, type Plan } from '../three/director';
import { buildModel, type Model } from '../three/model';
import { canEncodeVideo, exportMp4, FrameRenderer } from '../three/render';
import { FlightScene } from '../three/scene';
import GliderPreview from './GliderPreview.vue';
import { decodeAudioFile, renderSoundtrack, SoundPlayer, type MusicStyle } from '../three/audio';
import { GLIDER_PRESETS, gliderChoice, PATTERN_LABEL, resetDesign, type GliderPresetId } from '../three/gliderDesigns';
import { loadTerrain, loadTexture, MAP_SOURCES, paddedBounds, type Kk7Overlay, type MapSourceId, type Terrain, type TerrainTexture } from '../three/terrain';
import { track as trackEvent } from '../app/analytics';
import { COMPANION_COLORS, companionOffset, type Companion } from '../three/companions';
import { baseAt, loadCloudBase, M_PER_K_SPREAD, type CloudBaseSeries } from '../app/weather';

const props = defineProps<{ id: number }>();
const FPS = 30;

const rec = shallowRef<ActivityRecord | null>(null);
const res = shallowRef<ActivityResult | null>(null);
const terrain = shallowRef<Terrain | null>(null);
const progress = ref<{ label: string; done: number; total: number } | null>({ label: 'Analysiere Track', done: 0, total: 0 });
const error = ref('');
const ground = shallowRef<GroundProfile | null>(null);
/** selected POIs in the local frame; empty until loaded */
let pois: (Poi & { x: number; z: number; ground: number })[] = [];
const poiStatus = ref('');

const opt = reactive({
  format: '9:16' as '9:16' | '16:9',
  quality: 1080 as 720 | 1080,
  durationS: 60,
  texture: 'esri' as MapSourceId | 'relief',
  exaggeration: 1.2,
  camDistance: 1,
  gliderSize: 1,
  /** factor on the bank angle of the glider model, 1 = as measured */
  bankScale: 1,
  highlights: true,
  thermals: true,
  drift: true,
  glides: true,
  curtain: true,
  wind: true,
  contours: false,
  kk7Thermals: false,
  kk7Skyways: false,
  pois: true,
  particles: true,
  pilotStyle: 'glider' as 'glider' | 'firefly' | 'both',
  hud: true,
  panelOpacity: 0.72,
  windOpacity: 0.6,
  music: 'cinematic' as MusicStyle,
  musicVolume: 0.6,
  vario: true,
  varioVolume: 0.5,
  startPing: true,
  climbThreshold: 0.2,
  sinkThreshold: -2.5,
  decisions: true,
  profile: true,
  /** minutes until the track fades out, 0 = keep */
  fadeMin: 0,
  triggers: true,
  clouds: true,
  cloudMode: 'api' as 'api' | 'flight' | 'manual',
  cloudManual: 2500,
  sunShadows: true,
  sunInfo: true,
  sunHourOffset: 0,
  /** other day for the sun ('' = flight date) */
  sunDate: '',
});

// --- further pilots in the same area
interface OtherActivity { id: number; title: string; date: string; sameDay: boolean }
const others = ref<OtherActivity[]>([]);
/** selected further flights with their colour and glider */
const companionSel = reactive<{ id: number; color: string; preset: GliderPresetId }[]>([]);
let companions: Companion[] = [];
const companionStatus = ref('');

// --- cloud base
const cloudSeries = shallowRef<CloudBaseSeries | null>(null);
const cloudStatus = ref('');

const box = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
const frame = ref(0);
const playing = ref(false);
const exporting = ref(false);
const fullscreen = ref(false);
const videoUrl = ref('');
/** bumped when the POIs arrive, since they change the picture without a setting */
const poiVersion = ref(0);
/** everything that changes the exported video; compared with the state of the last export */
const settingsKey = computed(() =>
  JSON.stringify([opt, gliderChoice.preset, gliderChoice.designs, i18n.lang, poiVersion.value, soundFileName.value, companionSel, !!cloudSeries.value]),
);
const exportedKey = ref('');
const outdated = computed(() => !!videoUrl.value && exportedKey.value !== settingsKey.value);
const encodeOk = canEncodeVideo();
let abort: AbortController | null = null;

let model: Model | null = null;
let scene: FlightScene | null = null;
const plan = shallowRef<Plan | null>(null);
let preview: FrameRenderer | null = null;

const exportSize = computed(() => {
  const s = opt.quality;
  const l = Math.round((s * 16) / 9 / 2) * 2;
  return opt.format === '9:16' ? { w: s, h: l } : { w: l, h: s };
});

onMounted(async () => {
  try {
    rec.value = (await db.activities.get(props.id)) ?? null;
    if (!rec.value) throw new Error(t('Aktivität nicht gefunden'));
    res.value = await analyzeRecord(rec.value);
    const tl = res.value.timeline;
    await loadTerrainFor([tl]);
    void listOthers();
    // precise ground for height above ground (same source as the dashboard); the mesh stays Terrarium
    try {
      ground.value = await groundProfile(`${props.id}:${rec.value.files.map((f) => f.text.length).join(',')}`, tl, (label, done, total) => (progress.value = { label, done, total }));
    } catch {
      ground.value = null;
    }
    model = buildModel(res.value, terrain.value!, ground.value?.ground);
    await applyTexture();
    // POIs and the cloud base come from the internet and may be slow: the scene is rebuilt once they arrive
    loadPoisFor();
    void loadCloudSeries();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    progress.value = null;
  }
});

/** Terrain around all given tracks (main flight plus further pilots) */
async function loadTerrainFor(tracks: { lat: Float64Array; lon: Float64Array }[]) {
  const lat = Float64Array.from(tracks.flatMap((x) => Array.from(x.lat)));
  const lon = Float64Array.from(tracks.flatMap((x) => Array.from(x.lon)));
  progress.value = { label: 'Lade Höhenmodell', done: 0, total: 1 };
  terrain.value = await loadTerrain(paddedBounds(lat, lon, 0.45, 10000), {
    onProgress: (done, total) => (progress.value = { label: 'Lade Höhenmodell', done, total }),
  });
}

async function listOthers() {
  const all = await db.activities.toArray();
  const day = rec.value?.date;
  others.value = all
    .filter((a) => a.id !== props.id && a.summary?.sport !== 'hiking')
    .map((a) => ({ id: a.id!, title: a.title, date: a.date, sameDay: a.date === day }))
    .sort((a, b) => Number(b.sameDay) - Number(a.sameDay) || b.date.localeCompare(a.date));
}

function toggleCompanion(id: number, on: boolean) {
  const k = companionSel.findIndex((c) => c.id === id);
  if (on && k < 0) {
    const used = new Set(companionSel.map((c) => c.color));
    const presets = Object.keys(GLIDER_PRESETS) as GliderPresetId[];
    companionSel.push({
      id,
      color: COMPANION_COLORS.find((c) => !used.has(c)) ?? COMPANION_COLORS[companionSel.length % COMPANION_COLORS.length],
      preset: presets[(companionSel.length + 1) % presets.length],
    });
  } else if (!on && k >= 0) companionSel.splice(k, 1);
}

let compToken = 0;
/** Analyses the selected flights; reloads the terrain when one of them leaves the current area */
async function setupCompanions() {
  if (!res.value || !terrain.value || !rec.value) return;
  const token = ++compToken;
  companionStatus.value = companionSel.length ? t('Lade weitere Flüge …') : '';
  try {
    const loaded = await Promise.all(companionSel.map(async (sel) => {
      const r = await db.activities.get(sel.id);
      if (!r) throw new Error(t('Aktivität nicht gefunden'));
      return { sel, rec: r, res: await analyzeRecord(r) };
    }));
    if (token !== compToken) return;
    const b = terrain.value.bounds;
    const inside = loaded.every(({ res: r }) => r.timeline.lat.every((la, i) => la > b.south && la < b.north && r.timeline.lon[i] > b.west && r.timeline.lon[i] < b.east));
    if (!inside) {
      await loadTerrainFor([res.value.timeline, ...loaded.map((x) => x.res.timeline)]);
      if (token !== compToken) return;
      // the precise ground profile belongs to the main track and stays valid
      model = buildModel(res.value, terrain.value!, ground.value?.ground);
      textures.clear();
    }
    companions = loaded.map(({ sel, rec: r, res: cr }) => {
      const cm = buildModel(cr, terrain.value!);
      return { id: sel.id, name: cr.pilot || r.title, color: sel.color, design: { ...gliderChoice.designs[sel.preset] }, model: cm, ...companionOffset(model!, cm) };
    });
    const shifted = companions.filter((c) => c.aligned).map((c) => c.name);
    companionStatus.value = shifted.length ? `${t('Nicht gleichzeitig geflogen, am Start ausgerichtet')}: ${shifted.join(', ')}` : '';
    if (!inside) {
      await applyTexture();
      loadPoisFor();
    } else rebuildScene();
  } catch (e) {
    if (token === compToken) companionStatus.value = `${t('Fehler')}: ${e instanceof Error ? e.message : e}`;
  }
}

/** Hourly cloud base at the launch from archived temperature and dew point */
async function loadCloudSeries() {
  const m = model;
  if (!m || cloudSeries.value || !opt.clouds || opt.cloudMode !== 'api') return;
  const tl = m.res.timeline;
  cloudStatus.value = t('Lade Temperatur und Taupunkt …');
  try {
    cloudSeries.value = await loadCloudBase(tl.lat[m.launchIdx], tl.lon[m.launchIdx], tl.t[m.launchIdx]);
    cloudStatus.value = '';
    rebuildScene();
  } catch (e) {
    cloudStatus.value = `${t('Wetterdaten nicht verfügbar, Basis aus dem Flug geschätzt')} (${e instanceof Error ? e.message : e})`;
  }
}

/** Highest thermal top + 100 m: the pilot usually stops climbing a little below the base */
const flightBase = computed(() => {
  void plan.value;
  const tops = model?.thermals.map((th) => th.topAlt) ?? [];
  return tops.length ? Math.max(...tops) + 100 : null;
});

function cloudBaseFn(): ((t: number) => number) | null {
  if (!opt.clouds) return null;
  if (opt.cloudMode === 'manual') return () => opt.cloudManual;
  const s = cloudSeries.value;
  if (opt.cloudMode === 'api' && s) return (tt) => baseAt(s, tt);
  const fb = flightBase.value;
  return fb == null ? null : () => fb;
}

/** Cloud base at the time of the highest point, for the settings panel */
const cloudInfo = computed(() => {
  const s = cloudSeries.value;
  const m = model;
  if (!s || !m || !plan.value) return '';
  let top = m.launchIdx;
  for (let i = m.launchIdx; i <= m.landingIdx; i++) if (m.alt[i] > m.alt[top]) top = i;
  const tt = m.res.timeline.t[top];
  let k = 0;
  for (let j = 1; j < s.t.length; j++) if (Math.abs(s.t[j] - tt) < Math.abs(s.t[k] - tt)) k = j;
  return `${Math.round(baseAt(s, tt))} m · T ${s.temp[k].toFixed(1)} °C, Td ${s.dew[k].toFixed(1)} °C ${t('auf')} ${Math.round(s.elevation)} m (${s.source})`;
});

let poiToken = 0;
async function loadPoisFor() {
  const T = terrain.value;
  const m = model;
  if (!T || !m) return;
  const token = ++poiToken;
  poiStatus.value = t('Lade Orte und Gipfel …');
  try {
    const raw = await loadPois(T.bounds, i18n.lang);
    if (token !== poiToken) return;
    const local = raw
      .map((p) => {
        const [x, z] = T.frame.toXZ(p.lat, p.lon);
        return { ...p, x, z, ground: T.heightAt(x, z) };
      })
      .filter((p) => p.x > T.minX && p.x < T.maxX && p.z > T.minZ && p.z < T.maxZ);
    const track: { x: number; z: number }[] = [];
    for (let i = 0; i < m.n; i += Math.max(1, Math.floor(m.n / 400))) track.push({ x: m.x[i], z: m.z[i] });
    pois = selectPois(local, track, Math.max(T.maxX - T.minX, T.maxZ - T.minZ));
    poiVersion.value++;
    poiStatus.value = `${pois.length} ${t('von')} ${raw.length} ${t('Orten (Wikidata / OpenStreetMap)')}`;
    rebuildScene();
  } catch (e) {
    if (token === poiToken) poiStatus.value = `${t('Orte nicht verfügbar')}: ${e instanceof Error ? e.message : e}`;
  }
}

/** Loaded map textures per source and kk7 overlay combination, so switching back is instant */
const textures = new Map<string, TerrainTexture>();
let textureToken = 0;

function currentOverlays(): Kk7Overlay[] {
  const out: Kk7Overlay[] = [];
  if (opt.kk7Skyways) out.push('skyways');
  if (opt.kk7Thermals) out.push('thermals');
  return out;
}
function texKey() {
  return `${opt.texture}:${currentOverlays().join(',')}`;
}

async function applyTexture() {
  if (!terrain.value) return;
  const source = opt.texture;
  const overlays = currentOverlays();
  const key = texKey();
  const token = ++textureToken;
  if (source !== 'relief' && !textures.has(key)) {
    const label = `${t('Lade Karte')}: ${t(MAP_SOURCES[source].label)}`;
    progress.value = { label, done: 0, total: 1 };
    try {
      textures.set(key, await loadTexture(terrain.value, source, { overlays, onProgress: (done, total) => (progress.value = { label, done, total }) }));
    } finally {
      if (token === textureToken) progress.value = null;
    }
  }
  if (token !== textureToken) return; // a newer selection won
  progress.value = null;
  rebuildScene();
}

function rebuildScene() {
  if (!model) return;
  scene?.dispose();
  scene = new FlightScene(model, {
    texture: opt.texture === 'relief' ? null : (textures.get(texKey()) ?? null),
    exaggeration: opt.exaggeration,
    gliderSize: opt.gliderSize,
    bankScale: opt.bankScale,
    glider: { ...gliderChoice.designs[gliderChoice.preset] },
    pilotStyle: opt.pilotStyle,
    windOpacity: opt.windOpacity,
    pois,
    companions,
    fadeMin: opt.fadeMin,
    sun: sunSettings(),
    cloudBase: cloudBaseFn(),
    layers: {
      thermals: opt.thermals, drift: opt.drift, glides: opt.glides, curtain: opt.curtain, wind: opt.wind, contours: opt.contours || opt.texture === 'relief',
      pois: opt.pois, particles: opt.particles, triggers: opt.triggers, clouds: opt.clouds,
    },
  });
  rebuildPlan();
}

function rebuildPlan() {
  if (!model || !scene) return;
  const keepU = plan.value ? frame.value / plan.value.frames.length : 0;
  plan.value = makePlan(model, {
    durationS: opt.durationS,
    fps: FPS,
    highlights: opt.highlights,
    camDistance: opt.camDistance,
    exaggeration: opt.exaggeration,
    aspect: opt.format === '9:16' ? 9 / 16 : 16 / 9,
  });
  frame.value = Math.round(keepU * (plan.value.frames.length - 1));
  planVersion++;
  preview?.dispose();
  preview = new FrameRenderer(scene, model, plan.value, hudOpts(), canvas.value);
  resize();
}

function sunSettings() {
  return { shadows: opt.sunShadows, info: opt.sunInfo, hourOffset: opt.sunHourOffset, date: opt.sunDate };
}

function hudOpts() {
  return {
    title: rec.value?.title ?? '', enabled: opt.hud, decisions: opt.decisions, profile: opt.profile, panelOpacity: opt.panelOpacity,
    sun: sunSettings(), cloudBase: cloudBaseFn(), companions,
  };
}

function resize() {
  if (!preview || !box.value) return;
  const ar = opt.format === '9:16' ? 9 / 16 : 16 / 9;
  const maxW = fullscreen.value ? window.innerWidth : box.value.clientWidth;
  const maxH = fullscreen.value ? window.innerHeight - 64 : Math.min(window.innerHeight - 140, 900);
  let w = maxW;
  let h = w / ar;
  if (h > maxH) { h = maxH; w = h * ar; }
  canvas.value!.style.width = `${w}px`;
  canvas.value!.style.height = `${h}px`;
  // render preview at a reduced resolution, HUD scales with it
  const scale = Math.min(1.5, window.devicePixelRatio || 1);
  preview.setSize(Math.round(w * scale), Math.round(h * scale));
  draw();
}

function draw() {
  if (preview && !exporting.value) preview.render(frame.value);
}

// --- soundtrack: rendered offline per plan and sound settings, played in sync with the preview
let planVersion = 0;
let soundFile: AudioBuffer | null = null;
const soundFileName = ref('');
let track: { key: string; buf: Promise<AudioBuffer> } | null = null;
const player = new SoundPlayer();
const soundOn = computed(() => opt.vario || opt.startPing || opt.music !== 'none');

function soundtrack(): Promise<AudioBuffer> | null {
  if (!model || !plan.value || !soundOn.value) return null;
  const key = JSON.stringify([planVersion, opt.music, opt.musicVolume, opt.vario, opt.varioVolume, opt.startPing, opt.climbThreshold, opt.sinkThreshold, soundFileName.value]);
  if (track?.key !== key) {
    track = {
      key,
      buf: renderSoundtrack(model, plan.value, {
        music: opt.music,
        musicVolume: opt.musicVolume,
        vario: opt.vario,
        varioVolume: opt.varioVolume,
        climbThreshold: opt.climbThreshold,
        sinkThreshold: opt.sinkThreshold,
        startPing: opt.startPing,
        file: soundFile,
      }),
    };
  }
  return track.buf;
}

async function startSound() {
  const p = soundtrack();
  if (!p) return;
  const buf = await p;
  if (playing.value) player.play(buf, frame.value / FPS);
}

async function pickSoundFile(list: FileList | null) {
  const f = list?.[0];
  if (!f) return;
  try {
    soundFile = await decodeAudioFile(f);
    soundFileName.value = f.name;
    opt.music = 'file';
  } catch (e) {
    error.value = `${t('Audiodatei nicht lesbar')}: ${e instanceof Error ? e.message : e}`;
  }
}

/** Slider moved: keep the sound in sync while playing */
function onSeek() {
  if (playing.value) void startSound();
}

let raf = 0;
let lastTs = 0;
function loop(ts: number) {
  if (!playing.value || !plan.value) return;
  if (lastTs) {
    const adv = ((ts - lastTs) / 1000) * FPS;
    frame.value = Math.min(plan.value.frames.length - 1, frame.value + adv);
    if (frame.value >= plan.value.frames.length - 1) {
      playing.value = false;
      player.stop();
    }
  }
  lastTs = ts;
  draw();
  raf = requestAnimationFrame(loop);
}
function togglePlay() {
  if (!plan.value) return;
  if (!playing.value && frame.value >= plan.value.frames.length - 1) frame.value = 0;
  playing.value = !playing.value;
  lastTs = 0;
  if (playing.value) {
    raf = requestAnimationFrame(loop);
    void startSound();
  } else player.stop();
}

async function startExport() {
  if (!scene || !model || !plan.value || !preview) return;
  playing.value = false;
  player.stop();
  exporting.value = true;
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value);
  videoUrl.value = '';
  const key = settingsKey.value;
  abort = new AbortController();
  // reuse the preview renderer: one WebGL context, textures already uploaded, frames visible while rendering
  const r = preview;
  r.hud = hudOpts();
  try {
    const { w, h } = exportSize.value;
    progress.value = { label: 'Erzeuge Tonspur', done: 0, total: 0 };
    const audio = await soundtrack();
    const blob = await exportMp4(r, w, h, (done, total) => (progress.value = { label: 'Rendere Video', done, total }), abort.signal, audio);
    videoUrl.value = URL.createObjectURL(blob);
    exportedKey.value = key;
    trackEvent('video_export', { format: opt.format, quality: opt.quality, music: opt.music, companions: companionSel.length });
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') error.value = e instanceof Error ? e.message : String(e);
  } finally {
    exporting.value = false;
    progress.value = null;
    abort = null;
    resize();
  }
}

const fileName = computed(() => `${(rec.value?.title ?? 'flug').replace(/[^\wäöüÄÖÜ-]+/g, '_')}_${opt.format.replace(':', 'x')}.mp4`);

const timeLabel = computed(() => {
  const s = Math.floor(frame.value / FPS);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} / ${Math.floor(opt.durationS / 60)}:${String(opt.durationS % 60).padStart(2, '0')}`;
});

watch(() => [opt.texture, opt.kk7Thermals, opt.kk7Skyways], applyTexture);
const design = computed(() => gliderChoice.designs[gliderChoice.preset]);
// colour pickers fire continuously while dragging: rebuild at most every 150 ms
let gliderTimer = 0;
watch(gliderChoice, () => {
  clearTimeout(gliderTimer);
  gliderTimer = window.setTimeout(rebuildScene, 150);
}, { deep: true });
watch(() => [opt.exaggeration, opt.windOpacity, opt.particles, opt.thermals, opt.drift, opt.glides, opt.pois, opt.pilotStyle, opt.curtain, opt.wind, opt.contours, opt.gliderSize, opt.bankScale,
  opt.fadeMin, opt.triggers, opt.clouds, opt.cloudMode, opt.cloudManual, opt.sunShadows, opt.sunHourOffset, opt.sunDate], rebuildScene);
watch(() => [opt.clouds, opt.cloudMode], () => void loadCloudSeries());
watch(() => companionSel.map((c) => [c.id, c.color, c.preset]), () => void setupCompanions(), { deep: true });
watch(() => [opt.durationS, opt.highlights, opt.camDistance, opt.format], rebuildPlan);
watch(() => [opt.hud, opt.decisions, opt.profile, opt.panelOpacity, opt.sunInfo], () => {
  if (preview) preview.hud = hudOpts();
  draw();
});
watch(() => [opt.format, fullscreen.value], () => requestAnimationFrame(resize));
watch(frame, () => { if (!playing.value) draw(); });
// changed sound settings while playing: re-render and continue at the current position
watch(() => [opt.music, opt.musicVolume, opt.vario, opt.varioVolume, opt.startPing, opt.climbThreshold, opt.sinkThreshold], () => {
  if (playing.value) void startSound();
  else player.stop();
});
// scene labels are baked into textures: rebuild them in the new language (POI names too)
watch(() => i18n.lang, () => {
  rebuildScene();
  loadPoisFor();
});
const onResize = () => resize();
onMounted(() => window.addEventListener('resize', onResize));
onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  cancelAnimationFrame(raf);
  player.dispose();
  abort?.abort();
  preview?.dispose();
  scene?.dispose();
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value);
});
</script>

<template>
  <div class="video-view">
    <header class="head">
      <a :href="`#/a/${id}`" class="back">‹ {{ rec?.title ?? t('Aktivität') }}</a>
      <h1>{{ t('3D-Flugvideo') }}</h1>
    </header>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="body">
      <section ref="box" class="stage" :class="{ full: fullscreen }">
        <div v-if="progress" class="progress panel">
          <div>{{ t(progress.label) }} …</div>
          <div v-if="progress.total" class="bar"><i :style="{ width: `${(progress.done / progress.total) * 100}%` }" /></div>
          <div v-if="progress.total" class="muted">{{ progress.done }} / {{ progress.total }}</div>
          <button v-if="exporting" @click="abort?.abort()">{{ t('Abbrechen') }}</button>
        </div>
        <canvas ref="canvas" class="preview" :class="{ hidden: !plan }" />
        <div v-if="plan" class="transport">
          <button class="primary" :disabled="exporting" @click="togglePlay">{{ playing ? t('Anhalten') : t('Abspielen') }}</button>
          <input v-model.number="frame" type="range" min="0" :max="plan.frames.length - 1" step="1" :disabled="exporting" @input="onSeek" />
          <span class="muted time">{{ timeLabel }}</span>
          <button @click="fullscreen = !fullscreen">{{ fullscreen ? t('Schliessen') : t('Vollbild') }}</button>
        </div>
        <div v-if="plan" class="style-switch seg" role="group" :aria-label="t('Darstellung im Flug')">
          <button :class="{ active: opt.pilotStyle === 'glider' }" :disabled="exporting" @click="opt.pilotStyle = 'glider'">🪂 {{ t('Schirm') }}</button>
          <button :class="{ active: opt.pilotStyle === 'firefly' }" :disabled="exporting" @click="opt.pilotStyle = 'firefly'">✨ {{ t('Glühwürmchen') }}</button>
          <button :class="{ active: opt.pilotStyle === 'both' }" :disabled="exporting" @click="opt.pilotStyle = 'both'">🪂✨ {{ t('Beides') }}</button>
        </div>
        <div v-if="videoUrl && !fullscreen" class="result panel" :class="{ stale: outdated }">
          <p v-if="outdated" class="stale-note">
            {{ t('Einstellungen geändert. Dieses Video zeigt noch den alten Stand.') }}
            <button class="primary" :disabled="exporting || !encodeOk" @click="startExport">{{ t('Video neu erstellen') }}</button>
          </p>
          <video :src="videoUrl" controls playsinline />
          <a class="download btn" :class="{ primary: !outdated }" :href="videoUrl" :download="fileName">{{ t('MP4 speichern') }}{{ outdated ? ` (${t('alter Stand')})` : '' }}</a>
        </div>
      </section>

      <aside class="settings panel">
        <fieldset>
          <legend>{{ t('Format') }}</legend>
          <div class="seg">
            <button :class="{ active: opt.format === '9:16' }" @click="opt.format = '9:16'">9:16 Reel/Story</button>
            <button :class="{ active: opt.format === '16:9' }" @click="opt.format = '16:9'">16:9 YouTube</button>
          </div>
          <label>{{ t('Länge') }}: {{ opt.durationS }} s
            <input v-model.number="opt.durationS" type="range" min="30" max="180" step="5" />
          </label>
          <label>{{ t('Qualität') }}
            <select v-model.number="opt.quality"><option :value="1080">Full HD</option><option :value="720">{{ t('HD (schneller)') }}</option></select>
          </label>
          <label class="check"><input v-model="opt.highlights" type="checkbox" /> {{ t('Start, beste Thermiken, höchsten Punkt und Landung langsamer zeigen') }}</label>
        </fieldset>
        <fieldset>
          <legend>{{ t('Gelände') }}</legend>
          <label>{{ t('Karte') }}
            <select v-model="opt.texture" :disabled="exporting">
              <option v-for="(s, k) in MAP_SOURCES" :key="k" :value="k">{{ t(s.label) }}</option>
              <option value="relief">{{ t('Gips-Relief (ohne Karte)') }}</option>
            </select>
          </label>
          <label>{{ t('Überhöhung') }}: ×{{ opt.exaggeration.toFixed(1) }}
            <input v-model.number="opt.exaggeration" type="range" min="1" max="2" step="0.1" />
          </label>
          <label>{{ t('Kameradistanz') }}: ×{{ opt.camDistance.toFixed(1) }}
            <input v-model.number="opt.camDistance" type="range" min="0.4" max="2.5" step="0.1" />
          </label>
          <label>{{ t('Grösse Gleitschirm') }}: ×{{ opt.gliderSize.toFixed(1) }}
            <input v-model.number="opt.gliderSize" type="range" min="0.5" max="3" step="0.1" />
          </label>
          <label>{{ t('Querlage überhöhen') }}: ×{{ opt.bankScale.toFixed(1) }}{{ opt.bankScale === 1 ? ` (${t('wie gemessen')})` : '' }}
            <input v-model.number="opt.bankScale" type="range" min="1" max="2.5" step="0.1" />
            <small class="muted">{{ t('Nur die Darstellung des Schirms; die Datenleiste zeigt weiter die gemessene Querlage.') }}</small>
          </label>
          <label v-if="opt.texture !== 'relief'" class="check"><input v-model="opt.contours" type="checkbox" /> {{ t('Höhenlinien') }}</label>
          <label v-if="opt.texture !== 'relief'" class="check" :title="t('Wo Thermik häufig ausgelöst wird, aus Hunderttausenden Flügen (thermal.kk7.ch)')"><input v-model="opt.kk7Thermals" type="checkbox" :disabled="exporting" /> {{ t('Thermik-Hotspots') }} (kk7.ch)</label>
          <label v-if="opt.texture !== 'relief'" class="check" :title="t('Wo Piloten häufig im Geradeausflug unterwegs sind (thermal.kk7.ch)')"><input v-model="opt.kk7Skyways" type="checkbox" :disabled="exporting" /> {{ t('Skyways') }} (kk7.ch)</label>
        </fieldset>
        <fieldset>
          <legend>{{ t('Schirm') }}</legend>
          <GliderPreview :design="design" />
          <label>{{ t('Darstellung im Flug') }}
            <select v-model="opt.pilotStyle" :disabled="exporting">
              <option value="glider">{{ t('Gleitschirm-Modell') }}</option>
              <option value="firefly">{{ t('Glühwürmchen (Lichtpunkt mit Leuchtspur)') }}</option>
              <option value="both">{{ t('Beides') }}</option>
            </select>
          </label>
          <label>{{ t('Modell') }}
            <select v-model="gliderChoice.preset" :disabled="exporting">
              <option v-for="(d, k) in GLIDER_PRESETS" :key="k" :value="k as GliderPresetId">{{ t(d.name) }}</option>
            </select>
          </label>
          <label>{{ t('Muster') }}
            <select v-model="design.pattern" :disabled="exporting">
              <option v-for="(l, k) in PATTERN_LABEL" :key="k" :value="k">{{ t(l) }}</option>
            </select>
          </label>
          <div class="colors">
            <label>{{ t('Farbe') }} 1<input v-model="design.a" type="color" /></label>
            <label>{{ t('Farbe') }} 2<input v-model="design.b" type="color" /></label>
            <label>{{ t('Farbe') }} 3<input v-model="design.c" type="color" /></label>
            <label>{{ t('Farbe') }} 4<input v-model="design.d" type="color" /></label>
            <label>{{ t('Eintritt') }}<input v-model="design.leadingEdge" type="color" /></label>
            <label>{{ t('Unterseite') }}<input v-model="design.bottom" type="color" /></label>
            <label>{{ t('Gurtzeug') }}<input v-model="design.harness" type="color" /></label>
            <label>{{ t('Helm') }}<input v-model="design.helmet" type="color" /></label>
          </div>
          <p class="muted small">{{ design.cells }} {{ t('Zellen') }} · {{ t('Streckung') }} {{ design.aspect.toFixed(2) }} · {{ t('Farben angenähert') }}
            <button class="link" @click="resetDesign(gliderChoice.preset)">{{ t('zurücksetzen') }}</button></p>
        </fieldset>
        <fieldset>
          <legend>{{ t('Weitere Piloten') }}</legend>
          <p v-if="!others.length" class="muted small">{{ t('Keine weiteren Flüge gespeichert. Weitere IGC-Dateien in der Übersicht importieren.') }}</p>
          <div v-else class="others">
            <div v-for="a in others" :key="a.id" class="other">
              <label class="check">
                <input type="checkbox" :checked="companionSel.some((c) => c.id === a.id)" :disabled="exporting" @change="toggleCompanion(a.id, ($event.target as HTMLInputElement).checked)" />
                <span>{{ a.title }} <span class="muted">· {{ a.date }}{{ a.sameDay ? ` · ${t('gleicher Tag')}` : '' }}</span></span>
              </label>
              <template v-for="c in companionSel.filter((x) => x.id === a.id)" :key="c.id">
                <div class="other-opts">
                  <input v-model="c.color" type="color" :title="t('Farbe der Flugspur')" />
                  <select v-model="c.preset" :disabled="exporting">
                    <option v-for="(d, k) in GLIDER_PRESETS" :key="k" :value="k as GliderPresetId">{{ t(d.name) }}</option>
                  </select>
                </div>
              </template>
            </div>
          </div>
          <p v-if="companionStatus" class="muted small">{{ companionStatus }}</p>
        </fieldset>
        <fieldset>
          <legend>{{ t('Sonne & Wolken') }}</legend>
          <label class="check"><input v-model="opt.sunShadows" type="checkbox" /> {{ t('Schattenwurf nach Sonnenstand (Schirm und Berge)') }}</label>
          <label class="check"><input v-model="opt.sunInfo" type="checkbox" :disabled="!opt.hud" /> {{ t('Sonnenstand und Einstrahlung einblenden') }}</label>
          <label>{{ t('Tageszeit verschieben') }}: {{ opt.sunHourOffset > 0 ? '+' : '' }}{{ opt.sunHourOffset }} h
            <input v-model.number="opt.sunHourOffset" type="range" min="-6" max="6" step="0.5" />
          </label>
          <label>{{ t('Anderes Datum (Jahreszeit)') }}
            <span class="pair"><input v-model="opt.sunDate" type="date" /><button v-if="opt.sunDate" @click="opt.sunDate = ''">{{ t('Flugtag') }}</button></span>
          </label>
          <label class="check"><input v-model="opt.clouds" type="checkbox" /> {{ t('Cumulus an der Wolkenbasis über den Thermiken') }}</label>
          <label>{{ t('Wolkenbasis') }}
            <select v-model="opt.cloudMode" :disabled="!opt.clouds">
              <option value="api">{{ t('Berechnet aus Temperatur-Archiv (Open-Meteo)') }}</option>
              <option value="flight">{{ t('Aus dem Flug (höchste Thermik + 100 m)') }}</option>
              <option value="manual">{{ t('Manuell') }}</option>
            </select>
          </label>
          <label v-if="opt.cloudMode === 'manual'">{{ opt.cloudManual }} m
            <input v-model.number="opt.cloudManual" type="range" min="800" max="5000" step="50" :disabled="!opt.clouds" />
          </label>
          <p v-if="opt.clouds" class="muted small">
            <template v-if="opt.cloudMode === 'api' && cloudInfo">{{ t('Basis') }} {{ cloudInfo }}. {{ t('Formel') }}: {{ t('Höhe') }} + {{ M_PER_K_SPREAD }} m × (T − Td).</template>
            <template v-if="flightBase"> {{ t('Höchste Thermik im Flug') }}: {{ Math.round(flightBase - 100) }} m.</template>
            {{ cloudStatus }}
          </p>
        </fieldset>
        <fieldset>
          <legend>{{ t('Ton') }}</legend>
          <label>{{ t('Musik') }}
            <select v-model="opt.music" :disabled="exporting">
              <option value="none">{{ t('Keine') }}</option>
              <option value="ambient">{{ t('Ambient (ruhig, Flächen)') }}</option>
              <option value="cinematic">{{ t('Cinematic (Puls, steigert sich)') }}</option>
              <option value="chill">{{ t('Chill (E-Piano, Beat)') }}</option>
              <option value="lofi">{{ t('Lo-Fi Hip-Hop (Jazz-Akkorde, Vinyl)') }}</option>
              <option value="synthwave">{{ t('Synthwave (80er, Arpeggio, treibend)') }}</option>
              <option value="house">{{ t('Deep House (Four-on-the-floor, pumpend)') }}</option>
              <option value="dnb">{{ t('Liquid Drum & Bass (schnell, luftig)') }}</option>
              <option value="file" :disabled="!soundFileName">{{ t('Eigene Datei') }}{{ soundFileName ? `: ${soundFileName}` : '' }}</option>
            </select>
          </label>
          <label>{{ t('Eigene Musikdatei (mp3, wav, ogg)') }}
            <input type="file" accept="audio/*" @change="pickSoundFile(($event.target as HTMLInputElement).files)" />
          </label>
          <label>{{ t('Lautstärke Musik') }}: {{ Math.round(opt.musicVolume * 100) }} %
            <input v-model.number="opt.musicVolume" type="range" min="0" max="1" step="0.05" :disabled="opt.music === 'none'" />
          </label>
          <label class="check"><input v-model="opt.startPing" type="checkbox" /> {{ t('Startsound beim Abheben') }}</label>
          <label class="check"><input v-model="opt.vario" type="checkbox" /> {{ t('Vario-Töne nach Steigen und Sinken') }}</label>
          <label>{{ t('Lautstärke Vario') }}: {{ Math.round(opt.varioVolume * 100) }} %
            <input v-model.number="opt.varioVolume" type="range" min="0" max="1" step="0.05" :disabled="!opt.vario" />
          </label>
          <label>{{ t('Piepsen ab') }}: +{{ opt.climbThreshold.toFixed(1) }} m/s · {{ t('Sinkton ab') }}: {{ opt.sinkThreshold.toFixed(1) }} m/s
            <span class="pair">
              <input v-model.number="opt.climbThreshold" type="range" min="0" max="1" step="0.1" :disabled="!opt.vario" />
              <input v-model.number="opt.sinkThreshold" type="range" min="-5" max="-1" step="0.5" :disabled="!opt.vario" />
            </span>
          </label>
          <p class="muted small">{{ t('Die Musik wird hier erzeugt und ist frei von Rechten Dritter (GEMA-frei). Bei eigenen Dateien bist du für die Rechte verantwortlich.') }}</p>
        </fieldset>
        <fieldset>
          <legend>{{ t('Lern-Ebenen') }}</legend>
          <label class="check"><input v-model="opt.thermals" type="checkbox" /> {{ t('Thermiktrichter mit Steigwert') }}</label>
          <label class="check"><input v-model="opt.drift" type="checkbox" :disabled="!opt.thermals" /> {{ t('Trichter-Versatz durch Wind (Drift der Kreismittelpunkte)') }}</label>
          <label class="check"><input v-model="opt.triggers" type="checkbox" :disabled="!opt.thermals" /> {{ t('Thermik-Auslöser: Achse bis zum Boden verlängert') }}</label>
          <label>{{ t('Flugspur verblasst nach') }}: {{ opt.fadeMin ? `${opt.fadeMin} min` : t('nie') }}
            <input v-model.number="opt.fadeMin" type="range" min="0" max="30" step="1" />
          </label>
          <p v-if="opt.fadeMin" class="muted small">{{ t('Thermikkreise bleiben stehen, am Schluss wird die ganze Spur gezeigt.') }}</p>
          <label class="check"><input v-model="opt.glides" type="checkbox" /> {{ t('Gleitzahl auf Gleitstrecken (ab 2 km)') }}</label>
          <label class="check"><input v-model="opt.particles" type="checkbox" /> {{ t('Luftströmung in starken Thermiken und beim Steigen im Geradeausflug') }}</label>
          <label class="check"><input v-model="opt.pois" type="checkbox" /> {{ t('Gipfel, Hütten und Orte mit Infotafel') }}</label>
          <p v-if="opt.pois && poiStatus" class="muted small">{{ poiStatus }}</p>
          <label class="check"><input v-model="opt.curtain" type="checkbox" /> {{ t('Höhe über Grund (rot < 150 m)') }}</label>
          <p v-if="ground" class="muted small">{{ t('Höhe über Grund') }}: {{ ground.label }} ({{ t('Quelle im Dashboard wählbar') }})</p>
          <label class="check"><input v-model="opt.wind" type="checkbox" /> {{ t('Windpfeil aus der Drift') }}</label>
          <label class="check"><input v-model="opt.decisions" type="checkbox" /> {{ t('Entscheidungen (Thermik verlassen, Suche)') }}</label>
          <label class="check"><input v-model="opt.hud" type="checkbox" /> {{ t('Einblendungen (Daten, Windrose)') }}</label>
          <label class="check"><input v-model="opt.profile" type="checkbox" :disabled="!opt.hud" /> {{ t('Höhenprofil im Bild') }}</label>
          <label>{{ t('Deckkraft Einblendungen') }}: {{ Math.round(opt.panelOpacity * 100) }} %
            <input v-model.number="opt.panelOpacity" type="range" min="0" max="1" step="0.05" :disabled="!opt.hud" />
          </label>
          <label>{{ t('Deckkraft Windpfeil') }}: {{ Math.round(opt.windOpacity * 100) }} %
            <input v-model.number="opt.windOpacity" type="range" min="0.1" max="1" step="0.05" :disabled="!opt.wind" />
          </label>
        </fieldset>
        <button class="primary big" :disabled="!plan || exporting || !encodeOk" @click="startExport">
          {{ exporting ? t('Video wird erstellt …') : `${t(videoUrl ? 'Video neu erstellen' : 'Video erstellen')} (${exportSize.w}×${exportSize.h})` }}
        </button>
        <p v-if="!encodeOk" class="error">{{ t('Dieser Browser kann keine Videos erzeugen (WebCodecs fehlt). Chrome, Edge oder Safari ab 17 können es.') }}</p>
        <p class="muted small">{{ t('Das Video wird Bild für Bild im Browser gerendert, nichts verlässt deinen Rechner.') }} {{ t('Gelände') }}: Terrain Tiles (AWS)<template v-if="opt.texture !== 'relief'">, {{ t('Karte') }}: {{ MAP_SOURCES[opt.texture].attribution }}<template v-if="opt.kk7Thermals || opt.kk7Skyways">, thermal.kk7.ch (CC BY-NC-SA 4.0)</template></template>.</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.video-view { max-width: 1400px; margin: 0 auto; padding: 20px 20px 40px; }
.head { margin-bottom: 16px; }
.back { color: var(--muted); text-decoration: none; font-size: 14px; }
.head h1 { font-size: 26px; margin-top: 4px; }
.body { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: start; }
.stage { display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 0; position: relative; }
.stage.full { position: fixed; inset: 0; z-index: 50; background: #000; justify-content: center; padding: 0 16px; }
.preview { border-radius: var(--radius); background: #000; display: block; }
.preview.hidden { visibility: hidden; height: 0; }
.progress { padding: 24px; width: min(420px, 100%); display: flex; flex-direction: column; gap: 10px; text-align: center; }
.bar { height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); }
.transport { display: flex; gap: 12px; align-items: center; width: 100%; max-width: 900px; }
.transport input { flex: 1; accent-color: var(--accent); }
.time { font-variant-numeric: tabular-nums; font-size: 13px; }
.result { padding: 16px; display: flex; flex-direction: column; gap: 12px; align-items: center; }
.result video { max-height: 60vh; max-width: 100%; border-radius: 8px; }
.result.stale video { opacity: 0.55; }
.stale-note { margin: 0; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center; color: #ffca28; font-size: 14px; text-align: center; }
.settings { padding: 16px; display: flex; flex-direction: column; gap: 14px; position: sticky; top: 72px; min-width: 0; }
fieldset { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
legend { font-size: var(--fs-2); font-weight: 700; font-variation-settings: var(--wide); color: var(--snow); margin-bottom: 8px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
label.check { flex-direction: row; align-items: flex-start; gap: 8px; }
label input[type=range] { accent-color: var(--accent); }
.seg { display: flex; gap: 6px; }
.seg button { flex: 1; font-size: 13px; }
.style-switch { width: 100%; max-width: 900px; }
.big { padding: 12px; font-size: 15px; }
.pair { display: flex; gap: 8px; }
.pair input { flex: 1; min-width: 0; }
.colors { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.colors label { font-size: 12px; color: var(--muted); }
.colors input[type=color] { width: 100%; height: 28px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }
button.link { background: none; border: none; padding: 0 4px; color: var(--accent); cursor: pointer; font-size: 12px; }
.small { font-size: 12px; margin: 0; }
.others { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; }
.other { display: flex; flex-direction: column; gap: 6px; }
.other-opts { display: flex; gap: 8px; padding-left: 24px; }
.other-opts input[type=color] { width: 40px; height: 28px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; flex: none; }
.other-opts select { flex: 1; min-width: 0; }
.error { color: #ff6b6b; }
@media (max-width: 1000px) { .body { grid-template-columns: 1fr; } .settings { position: static; } }
</style>
