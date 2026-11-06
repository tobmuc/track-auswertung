<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { analyzeRecord } from '../app/analysis';
import { MODE_COLORS, MODE_LABELS, VARIO_STOPS, SPEED_STOPS, type ColorMode } from '../app/colors';
import { db } from '../app/db';
import * as F from '../app/format';
import { i18n, t } from '../app/i18n';
import { bestGlide, maxWind, thermalGain as gainSum } from '../app/summary';
import { aglStats, groundProfile, groundSettings, LOW_AGL, type GroundProfile } from '../app/ground';
import type { ActivityRecord, ActivityResult } from '../app/types';
import type { RuleSet, Sport, XcScore } from '../core';
import { compass } from '../core/geo';
import GroundPanel from './GroundPanel.vue';
import ProfileChart from './ProfileChart.vue';
import TrackMap from './TrackMap.vue';
import ThermalCircles from './ThermalCircles.vue';
import FlightReview from './FlightReview.vue';
import { ACCEL_DELTA_KMH, centring, meanOf, type Centring } from '../core';

const props = defineProps<{ id: number }>();

const rec = shallowRef<ActivityRecord | null>(null);
const res = shallowRef<ActivityResult | null>(null);
const loading = ref(true);
const error = ref('');
const colorMode = ref<ColorMode>('mode');
const hoverIdx = ref<number | null>(null);
const scoreCode = ref<'best' | 'od' | 'tri' | 'fai'>('best');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    rec.value = (await db.activities.get(props.id)) ?? null;
    if (!rec.value) throw new Error(t('Aktivität nicht gefunden'));
    res.value = await analyzeRecord(rec.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
  loadGround();
}
load();

const ground = shallowRef<GroundProfile | null>(null);
const groundProgress = ref<{ label: string; done: number; total: number } | null>(null);
let groundToken = 0;
async function loadGround() {
  const r = res.value;
  if (!r || !rec.value) return;
  const token = ++groundToken;
  groundProgress.value = { label: 'Lade Gelände', done: 0, total: 0 };
  try {
    const g = await groundProfile(`${props.id}:${rec.value.files.map((f) => f.text.length).join(',')}`, r.timeline, (label, done, total) => {
      if (token === groundToken) groundProgress.value = { label, done, total };
    });
    if (token === groundToken) ground.value = g;
  } catch (e) {
    if (token === groundToken) ground.value = { ground: new Float32Array(0), label: '', warning: e instanceof Error ? e.message : String(e) };
  } finally {
    if (token === groundToken) groundProgress.value = null;
  }
}
watch(() => [groundSettings.source, groundSettings.dem, groundSettings.apiKey, i18n.lang], loadGround);
const agl = computed(() => (res.value && ground.value?.ground.length ? aglStats(res.value, ground.value.ground) : null));

async function update(patch: Partial<ActivityRecord>) {
  if (!rec.value) return;
  await db.activities.update(props.id, patch);
  rec.value = { ...rec.value, ...patch };
  if ('sport' in patch || 'rules' in patch || 'polar' in patch) {
    res.value = await analyzeRecord(rec.value);
    await db.activities.update(props.id, {
      summary: { ...rec.value.summary!, sport: res.value.sport, xcKm: res.value.score?.best.distanceKm },
    });
  }
}
async function remove() {
  if (!confirm(t('Aktivität wirklich löschen?'))) return;
  await db.activities.delete(props.id);
  location.hash = '#/';
}

const tz = computed(() => res.value?.timeZone ?? 'UTC');
const hike = computed(() => res.value?.hike);
const flight = computed(() => res.value?.flight);
const selectedScore = computed<XcScore | undefined>(() => {
  const s = res.value?.score;
  if (!s) return undefined;
  return scoreCode.value === 'best' ? s.best : s.byCode[scoreCode.value];
});
const startTime = computed(() => res.value?.timeline.t[0]);

const places = computed(() => {
  const r = res.value;
  if (!r) return '';
  const parts: string[] = [];
  if (r.hike) parts.push(`${t('Aufstieg')} ${F.dur(r.hike.durationS)}`);
  if (r.flight) parts.push(`${t('Flug')} ${F.clock(r.flight.launchTime, tz.value)}-${F.clock(r.flight.landingTime, tz.value)}`);
  return parts.join(', ');
});

const kpis = computed(() => {
  const r = res.value;
  if (!r) return [];
  const out: [string, string][] = [];
  if (r.flight) {
    out.push([t('XC-Distanz'), F.km(r.score?.best.distanceKm)]);
    if (r.score) out.push([t('XContest-Punkte'), `${F.num(r.score.best.points, 2)} P`]);
    out.push([t('Airtime'), F.dur(r.flight.airtimeS)]);
    out.push([t('Max. Höhe'), F.m(r.flight.maxAlt)]);
  }
  if (r.hike) {
    out.push([t('Aufstieg zu Fuss'), F.signed(r.hike.gain, 'm')]);
    if (!r.flight) {
      out.push([t('Distanz'), F.km(r.hike.distanceKm)]);
      out.push([t('Zeit'), F.dur(r.hike.durationS)]);
      out.push([t('Höchster Punkt'), F.m(r.hike.highest)]);
    }
  }
  return out;
});

type Group = { title: string; rows: [string, string][] };

/** jump to a point: marker on map and profile, map back into view */
function showAt(idx: number) {
  hoverIdx.value = idx;
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/** title and readout cover the lower part of the map */
const heroPad = window.matchMedia('(max-width: 800px)').matches ? 170 : 230;

/** "80.80 km" → ["80.80", "km"]; values without a trailing unit stay whole ("4h 17m") */
function splitUnit(v: string): [string, string] {
  const m = /^(.*\d)\s+([^\d\s]+)$/.exec(v);
  return m ? [m[1], m[2]] : [v, ''];
}

const hikeGroups = computed<Group[]>(() => {
  const h = hike.value;
  if (!h) return [];
  return [
    { title: t('Strecke'), rows: [[t('Distanz'), F.km(h.distanceKm)], [t('Höhengewinn'), F.signed(h.gain, 'm')], [t('Abstieg'), F.signed(-h.loss, 'm')], [t('Ø Geschwindigkeit'), F.kmh(h.avgSpeedKmh)], [t('Ø Aufstieg'), `${F.num(h.avgAscentMh)} m/h`]] },
    { title: t('Höhe'), rows: [[t('Höchster Punkt'), F.msl(h.highest)], [t('Tiefster Punkt'), F.msl(h.lowest)], [t('Starthöhe'), F.msl(h.startAlt)], [t('Endhöhe'), F.msl(h.endAlt)]] },
    { title: t('Zeit'), rows: [[t('Gesamt'), F.dur(h.durationS)], [t('Aufgezeichnet'), F.dur(h.recordedS)], [t('In Bewegung'), F.dur(h.movingS)], [t('Pausen'), F.dur(h.breaksS)]] },
  ];
});

/** circle shape figures for the summary (same values as in "Thermik & Kreisformen") */
const circleRows = computed<[string, string][]>(() => {
  const cs = flight.value?.circles ?? [];
  if (cs.length < 5) return [];
  const done = centring(cs).filter((c) => c.centredAfterS != null).map((c) => c.centredAfterS!).sort((a, b) => a - b);
  return [
    [t('Ø Kreisdurchmesser'), F.m(meanOf(cs, (c) => 2 * c.radiusM))],
    [t('Ø Querlage'), `${F.num(meanOf(cs, (c) => c.bankDeg))}°`],
    [t('Ø Steigen im Kreis'), F.vario(meanOf(cs, (c) => c.climb))],
    [t('Zentriert nach (Median)'), done.length ? `${F.num(done[done.length >> 1])} s` : '-'],
  ];
});

const flightGroups = computed<Group[]>(() => {
  const f = flight.value;
  const s = res.value?.score;
  if (!f) return [];
  const wind = f.wind ? `${compass(f.wind.fromDeg)} ${F.num(f.wind.speedKmh)} km/h` : '-';
  const thermalGain = gainSum(f.thermals);
  const best = bestGlide(res.value?.segments.flatMap((sg) => sg.glides) ?? []);
  const maxW = maxWind(f.thermals);
  const leftPct = f.timeCirclingS > 0 ? Math.round((f.circlingLeftS / f.timeCirclingS) * 100) : null;
  return [
    {
      title: t('Distanz'),
      rows: [
        ...(s?.byCode.od ? [[t('Freie Strecke'), F.km(s.byCode.od.distanceKm)] as [string, string]] : []),
        ...(s?.byCode.tri ? [[t('Flaches Dreieck'), F.km(s.byCode.tri.distanceKm)] as [string, string]] : []),
        ...(s?.byCode.fai ? [[t('FAI-Dreieck'), F.km(s.byCode.fai.distanceKm)] as [string, string]] : []),
        [t('Tracklänge'), F.km(f.trackLengthKm, 1)],
        [t('Start → Landung'), F.km(f.launchToLandingKm)],
      ],
    },
    {
      title: t('Höhe'),
      rows: [[t('Min. Höhe'), F.msl(f.minAlt)], [t('Max. Höhe'), F.msl(f.maxAlt)], [t('Starthöhe'), F.msl(f.launchAlt)], [t('Landehöhe'), F.msl(f.landingAlt)],
        [t('Max. Überhöhung Start'), F.m(f.maxGainAboveLaunch)], [t('Gesamtsteigen'), F.signed(f.totalClimb, 'm')], [t('Gesamtsinken'), F.signed(-f.totalDescent, 'm')]],
    },
    ...(agl.value
      ? [{
          title: t('Höhe über Grund'),
          rows: [[t('Min. über Grund'), F.m(agl.value.minAgl)], [t('Max. über Grund'), F.m(agl.value.maxAgl)], [t('Ø über Grund'), F.m(agl.value.avgAgl)],
            [t(`Unter ${LOW_AGL} m über Grund`), F.dur(agl.value.lowS)], [t('Gelände Start / Landeplatz'), `${F.num(agl.value.launchGround)} / ${F.num(agl.value.landingGround)} m`],
            [t('Track über Boden bei Landung'), F.signed(agl.value.landingOffset, 'm')]] as [string, string][],
        }]
      : []),
    {
      title: t('Speed & Gleiten'),
      rows: [[t('Ø Speed'), F.kmh(f.avgSpeedKmh)], [t('Max. Speed'), F.kmh(f.maxSpeedKmh)], [t('Ø Gleitzahl (Gleitphasen)'), F.glide(f.avgGlideRatio)], [t('Beste Gleitzahl (60 s)'), F.glide(f.bestGlide60s)],
        [t('Bestes Gleiten'), best ? `${F.glide(best.ratio)}, ${F.km(best.distanceKm, 1)}` : '-']],
    },
    {
      title: t('Vario'),
      rows: [[t('Bestes Steigen (30 s)'), F.vario(f.bestClimb30s)], [t('Stärkstes Sinken (30 s)'), F.vario(f.worstSink30s)], [t('Ø Steigen in Thermik'), F.vario(f.avgClimbInThermals)],
        [t('Erkurbelte Höhe'), F.signed(thermalGain, 'm')]],
    },
    {
      title: t('Zeit'),
      rows: [[t('Kreisen'), `${F.dur(f.timeCirclingS)} (${F.pct(f.timeCirclingS, f.airtimeS)})`], [t('Steigen in Thermik'), `${F.dur(f.timeClimbingInThermalsS)} (${F.pct(f.timeClimbingInThermalsS, f.airtimeS)})`],
        [t('Nicht kreisend'), `${F.dur(f.timeNotCirclingS)} (${F.pct(f.timeNotCirclingS, f.airtimeS)})`], [t('Starkes Sinken (< −2 m/s)'), `${F.dur(f.timeStrongSinkS)} (${F.pct(f.timeStrongSinkS, f.airtimeS)})`]],
    },
    {
      title: t('Kreisen'),
      rows: [[t('Kreise links / rechts'), `${f.circlesLeft} / ${f.circlesRight}`], [t('Kreisen links | rechts'), leftPct == null ? '-' : `${leftPct} % | ${100 - leftPct} %`],
        [t('Thermiken'), String(f.thermals.length)], [t('Ø Zeit pro Kreis'), f.avgTimePerCircleS ? `${F.num(f.avgTimePerCircleS)} s` : '-'], [t('Wind (aus Kreisen)'), wind],
        [t('Max. Wind'), maxW ? `${compass(maxW.fromDeg)} ${F.num(maxW.speedKmh)} km/h` : '-'],
        ...circleRows.value],
    },
    ...(f.airspeed
      ? [{
          title: t('Fahrt durch die Luft'),
          rows: [
            [t('Trimmfahrt (geschätzt)'), F.kmh(f.airspeed.trimKmh, 0)],
            [t('Max. Fahrt (20 s)'), F.kmh(f.airspeed.max20sKmh, 0)],
            [t('Beschleunigt'), `${F.dur(f.airspeed.acceleratedS)} (${F.pct(f.airspeed.acceleratedS, f.airspeed.evaluatedS)} ${t('des Geradeausflugs')})`],
            [t('Beschleunigte Phasen'), `${f.airspeed.phases.length}, ${t('längste')} ${F.dur(Math.max(0, ...f.airspeed.phases.map((p) => p.durationS)))}`],
            [t('Beschleunigt bei Gegenwind'), f.airspeed.accelShareHeadwind == null ? '-' : `${Math.round(f.airspeed.accelShareHeadwind * 100)} %`],
            [t('Beschleunigt bei Rückenwind'), f.airspeed.accelShareTailwind == null ? '-' : `${Math.round(f.airspeed.accelShareTailwind * 100)} %`],
          ] as [string, string][],
        }]
      : []),
  ];
});

function shares(kind: 'hike' | 'flight') {
  const r = res.value;
  if (!r) return [];
  const src = kind === 'hike' ? r.hike?.modeShare : r.flight?.modeShare;
  if (!src) return [];
  const keys = kind === 'hike' ? ['up', 'down', 'flat', 'break'] : ['circling', 'climb', 'glide', 'sink'];
  const offset = kind === 'hike' ? 0 : 4;
  const total = keys.reduce((a, k) => a + (src as Record<string, number>)[k], 0);
  return keys.map((k, i) => {
    const v = (src as Record<string, number>)[k];
    return { label: t(MODE_LABELS[offset + i]), color: MODE_COLORS[offset + i], pct: total ? (v / total) * 100 : 0, time: F.dur(v) };
  });
}

const thermals = computed(() =>
  [...(res.value?.segments.flatMap((s) => s.thermals) ?? [])].sort((a, b) => b.gain - a.gain).slice(0, 12),
);

/** centring and circle size per thermal, keyed by the thermal object of the flight segment */
const thermalCircles = computed(() => {
  const r = res.value;
  const seg = r?.segments.find((s) => s.kind === 'flight');
  const map = new Map<object, Centring>();
  if (!r?.flight?.circles || !seg) return map;
  for (const c of centring(r.flight.circles)) if (seg.thermals[c.thermal]) map.set(seg.thermals[c.thermal], c);
  return map;
});
function circleCell(th: object) {
  const c = thermalCircles.value.get(th);
  return c ? `${F.num(2 * c.meanRadiusM)} m, ${F.num(c.meanBankDeg)}°` : '-';
}
function centredCell(th: object) {
  const c = thermalCircles.value.get(th);
  return c?.centredAfterS != null ? `${F.num(c.centredAfterS)} s` : '-';
}

const glides = computed(() => res.value?.segments.flatMap((s) => s.glides).filter((g) => g.distanceKm >= 1) ?? []);
const glideSort = ref<'time' | 'dist' | 'ratio'>('time');
const glidesSorted = computed(() => {
  const g = [...glides.value];
  if (glideSort.value === 'dist') g.sort((a, b) => b.distanceKm - a.distanceKm);
  if (glideSort.value === 'ratio') g.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
  return g;
});
/** horizontal offset of the thermal core from the lowest to the highest circle */
function coreOffset(t: { core?: { lat: number; lon: number; alt: number }[] }) {
  const c = t.core;
  if (!c || c.length < 2) return null;
  const lo = c.reduce((a, p) => (p.alt < a.alt ? p : a), c[0]);
  const hi = c.reduce((a, p) => (p.alt > a.alt ? p : a), c[0]);
  const k = Math.cos((lo.lat * Math.PI) / 180);
  const dx = (hi.lon - lo.lon) * 111_320 * k;
  const dy = (hi.lat - lo.lat) * 111_320;
  const d = Math.hypot(dx, dy);
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return `${F.num(d)} m ${compass(bearing)}`;
}

const legend = computed(() => {
  if (colorMode.value === 'mode') {
    const kinds = new Set(res.value?.segments.map((s) => s.kind));
    return MODE_LABELS.map((l, i) => ({ l: t(l), c: MODE_COLORS[i] })).filter((_, i) => (i < 4 ? kinds.has('hike') : kinds.has('flight')));
  }
  const stops = colorMode.value === 'vario' ? VARIO_STOPS : SPEED_STOPS;
  return stops.map(([v, c]) => ({ l: colorMode.value === 'vario' ? F.signed(v, 'm/s', 1) : `${v} km/h`, c }));
});

watch(() => props.id, load);
</script>

<template>
  <div v-if="loading" class="state">{{ t('Analysiere Track … (XC-Optimierung kann einige Sekunden dauern)') }}</div>
  <div v-else-if="error" class="state error" role="alert">{{ error }}<br /><a class="btn back" href="#/">{{ t('Zur Startseite') }}</a></div>
  <article v-else-if="rec && res" class="activity">
    <section class="hero">
      <TrackMap :result="res" :color-mode="colorMode" :hover-idx="hoverIdx" :score="selectedScore" :pad-bottom="heroPad" @hover="hoverIdx = $event" />
      <div class="hero-text">
        <h1 class="sr-only">{{ rec.title }}</h1>
        <input class="title-input" :aria-label="t('Titel der Aktivität')" :value="rec.title" @change="update({ title: ($event.target as HTMLInputElement).value })" />
        <p class="hero-meta">
          {{ startTime ? F.dateLong(startTime, tz) : '' }}<template v-if="places">, {{ places }}</template><template v-if="res.glider">, {{ res.glider }}</template>
        </p>
        <dl class="readout">
          <div v-for="[l, v] in kpis" :key="l">
            <dt>{{ l }}</dt>
            <dd>{{ splitUnit(v)[0] }}<small v-if="splitUnit(v)[1]">{{ splitUnit(v)[1] }}</small></dd>
          </div>
        </dl>
      </div>
    </section>

    <div class="tools wrap">
      <select :aria-label="t('Sportart')" :value="rec.sport ?? ''" @change="update({ sport: (($event.target as HTMLSelectElement).value || undefined) as Sport | undefined })">
        <option value="">{{ t('Automatisch') }} ({{ t(F.SPORT_LABEL[res.sport]) }})</option>
        <option v-for="(l, k) in F.SPORT_LABEL" :key="k" :value="k">{{ t(l) }}</option>
      </select>
      <select v-if="res.flight" :value="rec.rules" :title="t('Wertungsregeln')" :aria-label="t('Wertungsregeln')" @change="update({ rules: ($event.target as HTMLSelectElement).value as RuleSet })">
        <option value="XContest">XContest</option>
        <option value="FAI">FAI</option>
        <option value="FFVL">FFVL</option>
        <option value="XCLeague">XCLeague</option>
      </select>
      <select v-model="F.timeSettings.utc" :aria-label="t('Zeitzone')" :title="t('Varios und IGC-Dateien zeichnen in UTC auf.')">
        <option :value="false">{{ t('Ortszeit') }} ({{ tz }}, {{ F.utcOffset(tz, startTime ?? 0) }})</option>
        <option :value="true">UTC</option>
      </select>
      <a class="btn primary video-btn" :href="`#/a/${id}/3d`">{{ t('3D-Video erstellen') }}</a>
      <button @click="remove">{{ t('Flug löschen') }}</button>
    </div>

    <FlightReview v-if="res.flight" class="wrap" :result="res" :polar-id="rec.polar?.id ?? ''" @select="showAt" @polar="(id) => update({ polar: id ? { id } : undefined })" />

    <section class="wrap profile">
      <div class="profile-head">
        <div class="seg" role="group" :aria-label="t('Färbung')">
          <span class="muted">{{ t('Färbung') }}</span>
          <button :aria-pressed="colorMode === 'mode'" @click="colorMode = 'mode'">{{ t('Phasen') }}</button>
          <button :aria-pressed="colorMode === 'vario'" @click="colorMode = 'vario'">{{ t('Steigen') }}</button>
          <button :aria-pressed="colorMode === 'speed'" @click="colorMode = 'speed'">{{ t('Speed') }}</button>
        </div>
        <div v-if="res.score" class="seg" role="group" :aria-label="t('Wertung:')">
          <span class="muted">{{ t('Wertung:') }}</span>
          <button :aria-pressed="scoreCode === 'best'" @click="scoreCode = 'best'">{{ t('Beste') }}</button>
          <button v-for="(sc, code) in res.score.byCode" :key="code" :aria-pressed="scoreCode === code" @click="scoreCode = code">
            {{ t(F.SCORE_LABEL[code]) }}
          </button>
        </div>
      </div>
      <ProfileChart :result="res" :color-mode="colorMode" :hover-idx="hoverIdx" :ground="ground?.ground" @hover="hoverIdx = $event" />
      <div class="legend">
        <span v-for="x in legend" :key="x.l"><i :style="{ background: x.c }" />{{ x.l }}</span>
        <span v-if="selectedScore" class="score-info">
          {{ t(F.SCORE_LABEL[selectedScore.code] ?? selectedScore.type) }}: <strong>{{ F.km(selectedScore.distanceKm) }}</strong>, {{ F.num(selectedScore.points, 2) }} P
          (×{{ selectedScore.multiplier }}<template v-if="selectedScore.closing">, {{ t('Schlusslücke') }} {{ F.km(selectedScore.closing.km) }}</template>)
          <template v-if="!selectedScore.optimal">, {{ t('nicht optimal (Zeitlimit)') }}</template>
        </span>
      </div>
    </section>

    <section class="shares wrap">
      <div v-if="res.hike" class="share">
        <div class="label">{{ t('Zeit beim Wandern') }}</div>
        <div class="bar"><i v-for="s in shares('hike')" :key="s.label" :style="{ width: `${s.pct}%`, background: s.color }" /></div>
        <div class="share-legend"><span v-for="s in shares('hike')" :key="s.label"><i :style="{ background: s.color }" />{{ s.label }} {{ Math.round(s.pct) }} %, {{ s.time }}</span></div>
      </div>
      <div v-if="res.flight" class="share">
        <div class="label">{{ t('Zeit in der Luft') }}</div>
        <div class="bar"><i v-for="s in shares('flight')" :key="s.label" :style="{ width: `${s.pct}%`, background: s.color }" /></div>
        <div class="share-legend"><span v-for="s in shares('flight')" :key="s.label"><i :style="{ background: s.color }" />{{ s.label }} {{ Math.round(s.pct) }} %, {{ s.time }}</span></div>
      </div>
      <div v-if="res.flight" class="share">
        <div class="label">{{ t('Kreise links / rechts') }}</div>
        <div class="bar">
          <i :style="{ width: `${F.pct(res.flight.circlingLeftS, res.flight.timeCirclingS).replace(' %', '')}%`, background: 'var(--sky)' }" />
          <i :style="{ flex: 1, background: 'var(--lift)' }" />
        </div>
        <div class="share-legend">
          <span><i style="background: var(--sky)" />{{ t('Links') }} {{ res.flight.circlesLeft }} {{ t('Kreise') }}, {{ F.dur(res.flight.circlingLeftS) }}</span>
          <span><i style="background: var(--lift)" />{{ t('Rechts') }} {{ res.flight.circlesRight }} {{ t('Kreise') }}, {{ F.dur(res.flight.circlingRightS) }}</span>
        </div>
      </div>
    </section>

    <section v-if="hikeGroups.length" class="block wrap hike">
      <h2>{{ t('Aufstieg') }} <span class="muted">{{ F.dur(res.hike!.durationS) }}</span></h2>
      <div class="groups">
        <div v-for="g in hikeGroups" :key="g.title" class="group">
          <h3>{{ g.title }}</h3>
          <dl><template v-for="[l, v] in g.rows" :key="l"><dt>{{ l }}</dt><dd>{{ v }}</dd></template></dl>
        </div>
      </div>
      <p v-for="(gap, i) in res.hike!.gaps" :key="i" class="note">
        {{ t('Keine Aufzeichnung während') }} {{ F.dur(gap.durationS) }} {{ t('(Uhr pausiert?): Lücke mit') }} {{ F.km(gap.distanceKm) }} {{ t('und') }} {{ F.signed(gap.gain, 'm') }} {{ t('überbrückt.') }}
      </p>
    </section>

    <section v-if="flightGroups.length" class="block wrap flight">
      <h2>{{ t('Flug') }} <span class="muted">{{ F.dur(res.flight!.airtimeS) }}</span></h2>
      <div class="groups">
        <div v-for="g in flightGroups" :key="g.title" class="group">
          <h3>{{ g.title }}</h3>
          <dl><template v-for="[l, v] in g.rows" :key="l"><dt>{{ l }}</dt><dd>{{ v }}</dd></template></dl>
        </div>
      </div>
    </section>

    <section v-if="res.flight" class="block wrap">
      <h2>{{ t('Höhe über Grund') }}</h2>
      <GroundPanel :label="ground?.label" :warning="ground?.warning" :progress="groundProgress" @changed="loadGround" />
    </section>

    <section v-if="glides.length" class="block wrap">
      <h2 class="with-seg">{{ t('Gleitstrecken') }} <span class="muted">{{ glides.length }} {{ t('ab 1 km') }}</span>
        <span class="seg">
          <button :aria-pressed="glideSort === 'time'" @click="glideSort = 'time'">{{ t('Zeit') }}</button>
          <button :aria-pressed="glideSort === 'dist'" @click="glideSort = 'dist'">{{ t('Distanz') }}</button>
          <button :aria-pressed="glideSort === 'ratio'" @click="glideSort = 'ratio'">{{ t('Gleitzahl') }}</button>
        </span>
      </h2>
      <div class="scroll">
        <table>
          <thead><tr><th>{{ t('Zeit') }}</th><th>{{ t('Dauer') }}</th><th>{{ t('Distanz') }}</th><th>{{ t('Höhe') }}</th><th>{{ t('Gleitzahl') }}</th><th :title="t('ohne Windeinfluss (Wind aus den Kreisen)')">{{ t('GZ Luft') }}</th><th>{{ t('Ø Speed') }}</th><th :title="t('Fahrt durch die Luft aus Winddreieck (Wind aus den Kreisen)')">{{ t('Fahrt Luft') }}</th><th :title="t('Wind entlang der Strecke: + Rückenwind, − Gegenwind')">{{ t('Wind ±') }}</th><th>{{ t('Ø Sinken') }}</th></tr></thead>
          <tbody>
            <tr v-for="g in glidesSorted" :key="g.start" @mouseenter="hoverIdx = (g.start + g.end) >> 1" @mouseleave="hoverIdx = null">
              <td>{{ F.clock(res.timeline.t[g.start], tz) }}</td>
              <td>{{ F.dur(g.durationS) }}</td>
              <td>{{ F.km(g.distanceKm, 1) }}</td>
              <td>{{ F.signed(-g.loss, 'm') }}</td>
              <td class="strong">{{ g.ratio != null ? F.glide(g.ratio) : t('Höhe gewonnen') }}</td>
              <td>{{ F.glide(g.airRatio) }}</td>
              <td>{{ F.kmh(g.avgSpeedKmh, 0) }}</td>
              <td :class="{ accel: g.airKmh != null && flight?.airspeed && g.airKmh >= flight.airspeed.trimKmh + ACCEL_DELTA_KMH }">{{ g.airKmh != null ? F.kmh(g.airKmh, 0) : '-' }}</td>
              <td>{{ g.windAlongKmh != null ? F.signed(g.windAlongKmh, 'km/h') : '-' }}</td>
              <td>{{ F.vario(g.avgVario) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="thermals.length" class="block wrap">
      <h2>{{ t('Stärkste Thermiken') }}</h2>
      <div class="scroll-x">
      <table>
        <thead><tr><th>{{ t('Zeit') }}</th><th>{{ t('Basis → Top') }}</th><th>{{ t('Gewinn') }}</th><th>{{ t('Ø Steigen') }}</th><th>{{ t('Dauer') }}</th><th>{{ t('Wind (Kreise)') }}</th><th :title="t('Wind aus dem Versatz der Kreismittelpunkte')">{{ t('Wind (Drift)') }}</th><th :title="t('Versatz des Thermikkerns vom untersten zum obersten Kreis')">{{ t('Versatz') }}</th><th :title="t('Ø Kreisdurchmesser relativ zur Luft und Querlage')">{{ t('Ø Kreis') }}</th><th :title="t('Zeit vom Einflug bis zum ersten Kreis mit 80 % des besten Steigens')">{{ t('Zentriert') }}</th></tr></thead>
        <tbody>
          <tr v-for="th in thermals" :key="th.start" @mouseenter="hoverIdx = th.start" @mouseleave="hoverIdx = null">
            <td>{{ F.clock(res.timeline.t[th.start], tz) }}</td>
            <td>{{ F.num(th.baseAlt) }} → {{ F.num(th.topAlt) }} m</td>
            <td>{{ F.signed(th.gain, 'm') }}</td>
            <td>{{ F.vario(th.avgClimb) }}</td>
            <td>{{ F.dur(th.durationS) }}</td>
            <td>{{ th.wind ? `${compass(th.wind.fromDeg)} ${F.num(th.wind.speedKmh)} km/h` : '-' }}</td>
            <td>{{ th.drift ? `${compass(th.drift.fromDeg)} ${F.num(th.drift.speedKmh)} km/h` : '-' }}</td>
            <td>{{ coreOffset(th) ?? '-' }}</td>
            <td>{{ circleCell(th) }}</td>
            <td>{{ centredCell(th) }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </section>

    <ThermalCircles v-if="res.flight" class="wrap" :result="res" :title="rec?.title ?? ''" />
  </article>
</template>

<style scoped>
.state { padding: 64px 20px; text-align: center; color: var(--lichen); }
.state.error { color: #ff9b8a; }
.activity { display: flex; flex-direction: column; gap: 40px; padding-bottom: 48px; }

/* the map is the stage; title and readout sit on the terrain */
.hero { position: relative; }
.hero :deep(.map) { height: min(70vh, 660px); border-radius: 0; }
.hero :deep(.controls) { top: 12px; left: max(12px, calc((100vw - 1120px) / 2)); }
.hero-text {
  position: absolute; left: 0; right: 0; bottom: 0; pointer-events: none;
  padding: 96px max(20px, calc((100vw - 1120px) / 2)) 22px;
  background: linear-gradient(to top, rgba(20, 28, 25, .9) 0%, rgba(20, 28, 25, .55) 55%, rgba(20, 28, 25, 0) 100%);
}
.hero-text > * { pointer-events: auto; }
.title-input {
  font-size: var(--fs-display); font-weight: var(--w-strong); font-variation-settings: var(--wide); letter-spacing: -0.02em;
  background: transparent; border: 1px solid transparent; border-radius: var(--r-control); padding: 0 6px; margin-left: -7px;
  width: min(900px, 100%); color: var(--snow); text-shadow: 0 1px 8px rgba(13, 19, 17, .6);
}
.title-input:hover { border-color: rgba(241, 240, 234, .35); }
.hero-meta { margin: 4px 0 18px; color: var(--snow); opacity: .85; }
.readout { display: flex; flex-wrap: wrap; gap: 8px 36px; margin: 0; }
.readout div { display: flex; flex-direction: column-reverse; }
.readout dt { color: var(--snow); opacity: .78; font-size: var(--fs-1); }
.readout dd { margin: 0; font-size: var(--fs-5); line-height: 1.1; font-weight: var(--w-strong); font-variation-settings: 'wdth' 125; }
.readout small { font-size: var(--fs-2); font-weight: var(--w-medium); margin-left: 4px; opacity: .85; }

.wrap { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 20px; }
.tools { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: -16px; }
.tools .tz { font-size: var(--fs-1); }
.video-btn { margin-left: auto; }
.back { margin-top: 14px; }

.profile-head { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px 20px; margin-bottom: 8px; }
.seg { display: flex; gap: 4px; align-items: center; font-size: var(--fs-1); flex-wrap: wrap; }
.seg .muted { margin-right: 4px; }
.seg button { padding: 3px 10px; font-size: var(--fs-1); background: transparent; border-color: var(--rule); }
.seg button[aria-pressed="true"] { background: var(--snow); color: var(--ground); border-color: var(--snow); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding-top: 6px; font-size: var(--fs-1); color: var(--lichen); align-items: center; }
.legend i, .share-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.score-info { margin-left: auto; color: var(--snow); }

.shares { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px 40px; }
.share { display: flex; flex-direction: column; gap: 8px; }
.bar { display: flex; height: 8px; border-radius: 1px; overflow: hidden; background: var(--ground-3); }
.bar i { display: block; height: 100%; }
.share-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: var(--fs-1); color: var(--lichen); }

/* sections: a heading and a hairline, no boxes */
.block > h2 { padding-top: 18px; border-top: 1px solid var(--rule); margin-bottom: 18px; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.block > h2 .muted { font-size: var(--fs-2); font-weight: 400; font-variation-settings: normal; }
.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 28px 44px; }
.group h3 { font-size: var(--fs-2); margin-bottom: 8px; }
dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; margin: 0; font-size: 14px; }
.group dl > dt, .group dl > dd { padding-bottom: 6px; border-bottom: 1px solid var(--rule); }
dt { color: var(--lichen); }
dd { margin: 0; text-align: right; font-weight: var(--w-medium); }
.note { font-size: var(--fs-1); color: var(--lichen); margin: 14px 0 0; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-weight: 500; color: var(--lichen); font-size: var(--fs-1); padding: 6px 8px; border-bottom: 1px solid var(--control-line); white-space: nowrap; }
td { padding: 7px 8px; border-bottom: 1px solid var(--rule); }
tbody tr:hover { background: var(--ground-2); }
td.strong { font-weight: var(--w-strong); }
td.accel { color: var(--lift); font-weight: var(--w-medium); }
.with-seg .seg { margin-left: auto; font-weight: 400; font-variation-settings: normal; }
.scroll { max-height: 440px; overflow: auto; }
.scroll-x { overflow-x: auto; }
.scroll thead th { position: sticky; top: 0; background: var(--ground); }
@media (max-width: 800px) {
  .activity { gap: 32px; }
  .hero :deep(.map) { height: 62vh; }
  .hero :deep(.controls) { left: 12px; }
  .hero-text { padding: 72px 16px 16px; }
  .title-input { font-size: 21px; font-variation-settings: normal; }
  .hero-meta { margin-bottom: 12px; font-size: var(--fs-1); }
  .readout { gap: 6px 22px; }
  .readout dd { font-size: 24px; }
  .wrap { padding: 0 16px; }
  .tools { margin-top: -12px; }
  .video-btn { margin-left: 0; flex: 1 1 100%; order: -1; }
  table { font-size: var(--fs-1); }
  .scroll { overflow-x: auto; }
}
</style>
