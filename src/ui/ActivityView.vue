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
  if ('sport' in patch || 'rules' in patch) {
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
  if (r.flight) parts.push(`${t('Flug')} ${F.clock(r.flight.launchTime, tz.value)}–${F.clock(r.flight.landingTime, tz.value)}`);
  return parts.join(' · ');
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

const hikeGroups = computed<Group[]>(() => {
  const h = hike.value;
  if (!h) return [];
  return [
    { title: t('Strecke'), rows: [[t('Distanz'), F.km(h.distanceKm)], [t('Höhengewinn'), F.signed(h.gain, 'm')], [t('Abstieg'), F.signed(-h.loss, 'm')], [t('Ø Geschwindigkeit'), F.kmh(h.avgSpeedKmh)], [t('Ø Aufstieg'), `${F.num(h.avgAscentMh)} m/h`]] },
    { title: t('Höhe'), rows: [[t('Höchster Punkt'), F.msl(h.highest)], [t('Tiefster Punkt'), F.msl(h.lowest)], [t('Starthöhe'), F.msl(h.startAlt)], [t('Endhöhe'), F.msl(h.endAlt)]] },
    { title: t('Zeit'), rows: [[t('Gesamt'), F.dur(h.durationS)], [t('Aufgezeichnet'), F.dur(h.recordedS)], [t('In Bewegung'), F.dur(h.movingS)], [t('Pausen'), F.dur(h.breaksS)]] },
  ];
});

const flightGroups = computed<Group[]>(() => {
  const f = flight.value;
  const s = res.value?.score;
  if (!f) return [];
  const wind = f.wind ? `${compass(f.wind.fromDeg)} ${F.num(f.wind.speedKmh)} km/h` : '–';
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
        [t('Bestes Gleiten'), best ? `${F.glide(best.ratio)} · ${F.km(best.distanceKm, 1)}` : '–']],
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
      rows: [[t('Kreise links / rechts'), `${f.circlesLeft} / ${f.circlesRight}`], [t('Kreisen links | rechts'), leftPct == null ? '–' : `${leftPct} % | ${100 - leftPct} %`],
        [t('Thermiken'), String(f.thermals.length)], [t('Ø Zeit pro Kreis'), f.avgTimePerCircleS ? `${F.num(f.avgTimePerCircleS)} s` : '–'], [t('Wind (aus Kreisen)'), wind],
        [t('Max. Wind'), maxW ? `${compass(maxW.fromDeg)} ${F.num(maxW.speedKmh)} km/h` : '–']],
    },
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
  <div v-else-if="error" class="state error">{{ error }}</div>
  <article v-else-if="rec && res" class="activity">
    <header class="head">
      <div class="title">
        <input class="title-input" :value="rec.title" @change="update({ title: ($event.target as HTMLInputElement).value })" />
        <div class="meta">
          <select :value="rec.sport ?? ''" @change="update({ sport: (($event.target as HTMLSelectElement).value || undefined) as Sport | undefined })">
            <option value="">{{ t('Automatisch') }} ({{ t(F.SPORT_LABEL[res.sport]) }})</option>
            <option v-for="(l, k) in F.SPORT_LABEL" :key="k" :value="k">{{ t(l) }}</option>
          </select>
          <span>{{ startTime ? F.dateLong(startTime, tz) : '' }}</span>
          <span class="muted">{{ places }}</span>
          <span v-if="res.glider" class="muted">· {{ res.glider }}</span>
          <span class="muted">· {{ tz }}</span>
        </div>
      </div>
      <div class="actions">
        <select v-if="res.flight" :value="rec.rules" :title="t('Wertungsregeln')" @change="update({ rules: ($event.target as HTMLSelectElement).value as RuleSet })">
          <option value="XContest">XContest</option>
          <option value="FAI">FAI</option>
          <option value="FFVL">FFVL</option>
          <option value="XCLeague">XCLeague</option>
        </select>
        <a :href="`#/a/${id}/3d`"><button class="primary">{{ t('3D-Video') }}</button></a>
        <button @click="remove">{{ t('Löschen') }}</button>
      </div>
    </header>

    <section class="kpis">
      <div v-for="[l, v] in kpis" :key="l" class="kpi panel">
        <div class="label">{{ l }}</div>
        <div class="value">{{ v }}</div>
      </div>
    </section>

    <section class="panel mapcard">
      <TrackMap :result="res" :color-mode="colorMode" :hover-idx="hoverIdx" :score="selectedScore" @hover="hoverIdx = $event" />
      <div class="profile-head">
        <div class="seg">
          <button :class="{ active: colorMode === 'mode' }" @click="colorMode = 'mode'">{{ t('Phasen') }}</button>
          <button :class="{ active: colorMode === 'vario' }" @click="colorMode = 'vario'">{{ t('Steigen') }}</button>
          <button :class="{ active: colorMode === 'speed' }" @click="colorMode = 'speed'">{{ t('Speed') }}</button>
        </div>
        <div v-if="res.score" class="seg">
          <span class="muted">{{ t('Wertung:') }}</span>
          <button :class="{ active: scoreCode === 'best' }" @click="scoreCode = 'best'">{{ t('Beste') }}</button>
          <button v-for="(sc, code) in res.score.byCode" :key="code" :class="{ active: scoreCode === code }" @click="scoreCode = code">
            {{ t(F.SCORE_LABEL[code]) }}
          </button>
        </div>
      </div>
      <ProfileChart :result="res" :color-mode="colorMode" :hover-idx="hoverIdx" :ground="ground?.ground" @hover="hoverIdx = $event" />
      <div class="legend">
        <span v-for="x in legend" :key="x.l"><i :style="{ background: x.c }" />{{ x.l }}</span>
        <span v-if="selectedScore" class="score-info">
          {{ t(F.SCORE_LABEL[selectedScore.code] ?? selectedScore.type) }}: <strong>{{ F.km(selectedScore.distanceKm) }}</strong> · {{ F.num(selectedScore.points, 2) }} P
          (×{{ selectedScore.multiplier }}<template v-if="selectedScore.closing">, {{ t('Schlusslücke') }} {{ F.km(selectedScore.closing.km) }}</template>)
          <template v-if="!selectedScore.optimal"> · {{ t('nicht optimal (Zeitlimit)') }}</template>
        </span>
      </div>
    </section>

    <section class="shares">
      <div v-if="res.hike" class="panel share">
        <div class="label">{{ t('Zeit beim Wandern') }}</div>
        <div class="bar"><i v-for="s in shares('hike')" :key="s.label" :style="{ width: `${s.pct}%`, background: s.color }" /></div>
        <div class="share-legend"><span v-for="s in shares('hike')" :key="s.label"><i :style="{ background: s.color }" />{{ s.label }} {{ Math.round(s.pct) }} % · {{ s.time }}</span></div>
      </div>
      <div v-if="res.flight" class="panel share">
        <div class="label">{{ t('Zeit in der Luft') }}</div>
        <div class="bar"><i v-for="s in shares('flight')" :key="s.label" :style="{ width: `${s.pct}%`, background: s.color }" /></div>
        <div class="share-legend"><span v-for="s in shares('flight')" :key="s.label"><i :style="{ background: s.color }" />{{ s.label }} {{ Math.round(s.pct) }} % · {{ s.time }}</span></div>
      </div>
      <div v-if="res.flight" class="panel share">
        <div class="label">{{ t('Kreise links / rechts') }}</div>
        <div class="bar">
          <i :style="{ width: `${F.pct(res.flight.circlingLeftS, res.flight.timeCirclingS).replace(' %', '')}%`, background: '#4fc3f7' }" />
          <i :style="{ flex: 1, background: '#ff8a3d' }" />
        </div>
        <div class="share-legend">
          <span><i style="background:#4fc3f7" />{{ t('Links') }} {{ res.flight.circlesLeft }} {{ t('Kreise') }} · {{ F.dur(res.flight.circlingLeftS) }}</span>
          <span><i style="background:#ff8a3d" />{{ t('Rechts') }} {{ res.flight.circlesRight }} {{ t('Kreise') }} · {{ F.dur(res.flight.circlingRightS) }}</span>
        </div>
      </div>
    </section>

    <section v-if="hikeGroups.length" class="panel block hike">
      <h2>{{ t('Aufstieg') }} <span class="muted">{{ F.dur(res.hike!.durationS) }}</span></h2>
      <div class="groups">
        <div v-for="g in hikeGroups" :key="g.title" class="group">
          <div class="label">{{ g.title }}</div>
          <dl><template v-for="[l, v] in g.rows" :key="l"><dt>{{ l }}</dt><dd>{{ v }}</dd></template></dl>
        </div>
      </div>
      <p v-for="(gap, i) in res.hike!.gaps" :key="i" class="note">
        {{ t('Keine Aufzeichnung während') }} {{ F.dur(gap.durationS) }} {{ t('(Uhr pausiert?): Lücke mit') }} {{ F.km(gap.distanceKm) }} {{ t('und') }} {{ F.signed(gap.gain, 'm') }} {{ t('überbrückt.') }}
      </p>
    </section>

    <section v-if="flightGroups.length" class="panel block flight">
      <h2>{{ t('Flug') }} <span class="muted">{{ F.dur(res.flight!.airtimeS) }}</span></h2>
      <div class="groups">
        <div v-for="g in flightGroups" :key="g.title" class="group">
          <div class="label">{{ g.title }}</div>
          <dl><template v-for="[l, v] in g.rows" :key="l"><dt>{{ l }}</dt><dd>{{ v }}</dd></template></dl>
        </div>
      </div>
    </section>

    <section v-if="res.flight" class="panel block">
      <h2>{{ t('Höhe über Grund') }}</h2>
      <GroundPanel :label="ground?.label" :warning="ground?.warning" :progress="groundProgress" @changed="loadGround" />
    </section>

    <section v-if="glides.length" class="panel block">
      <h2 class="with-seg">{{ t('Gleitstrecken') }} <span class="muted">{{ glides.length }} {{ t('ab 1 km') }}</span>
        <span class="seg">
          <button :class="{ active: glideSort === 'time' }" @click="glideSort = 'time'">{{ t('Zeit') }}</button>
          <button :class="{ active: glideSort === 'dist' }" @click="glideSort = 'dist'">{{ t('Distanz') }}</button>
          <button :class="{ active: glideSort === 'ratio' }" @click="glideSort = 'ratio'">{{ t('Gleitzahl') }}</button>
        </span>
      </h2>
      <div class="scroll">
        <table>
          <thead><tr><th>{{ t('Zeit') }}</th><th>{{ t('Dauer') }}</th><th>{{ t('Distanz') }}</th><th>{{ t('Höhe') }}</th><th>{{ t('Gleitzahl') }}</th><th :title="t('ohne Windeinfluss (Wind aus den Kreisen)')">{{ t('GZ Luft') }}</th><th>{{ t('Ø Speed') }}</th><th>{{ t('Ø Sinken') }}</th></tr></thead>
          <tbody>
            <tr v-for="g in glidesSorted" :key="g.start" @mouseenter="hoverIdx = (g.start + g.end) >> 1" @mouseleave="hoverIdx = null">
              <td>{{ F.clock(res.timeline.t[g.start], tz) }}</td>
              <td>{{ F.dur(g.durationS) }}</td>
              <td>{{ F.km(g.distanceKm, 1) }}</td>
              <td>{{ F.signed(-g.loss, 'm') }}</td>
              <td class="strong">{{ g.ratio != null ? F.glide(g.ratio) : t('Höhe gewonnen') }}</td>
              <td>{{ F.glide(g.airRatio) }}</td>
              <td>{{ F.kmh(g.avgSpeedKmh, 0) }}</td>
              <td>{{ F.vario(g.avgVario) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="thermals.length" class="panel block">
      <h2>{{ t('Stärkste Thermiken') }}</h2>
      <table>
        <thead><tr><th>{{ t('Zeit') }}</th><th>{{ t('Basis → Top') }}</th><th>{{ t('Gewinn') }}</th><th>{{ t('Ø Steigen') }}</th><th>{{ t('Dauer') }}</th><th>{{ t('Wind (Kreise)') }}</th><th :title="t('Wind aus dem Versatz der Kreismittelpunkte')">{{ t('Wind (Drift)') }}</th><th :title="t('Versatz des Thermikkerns vom untersten zum obersten Kreis')">{{ t('Versatz') }}</th></tr></thead>
        <tbody>
          <tr v-for="th in thermals" :key="th.start" @mouseenter="hoverIdx = th.start" @mouseleave="hoverIdx = null">
            <td>{{ F.clock(res.timeline.t[th.start], tz) }}</td>
            <td>{{ F.num(th.baseAlt) }} → {{ F.num(th.topAlt) }} m</td>
            <td>{{ F.signed(th.gain, 'm') }}</td>
            <td>{{ F.vario(th.avgClimb) }}</td>
            <td>{{ F.dur(th.durationS) }}</td>
            <td>{{ th.wind ? `${compass(th.wind.fromDeg)} ${F.num(th.wind.speedKmh)} km/h` : '–' }}</td>
            <td>{{ th.drift ? `${compass(th.drift.fromDeg)} ${F.num(th.drift.speedKmh)} km/h` : '–' }}</td>
            <td>{{ coreOffset(th) ?? '–' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </article>
</template>

<style scoped>
.state { padding: 48px; text-align: center; color: var(--muted); }
.state.error { color: #ff6b6b; }
.activity { display: flex; flex-direction: column; gap: 16px; max-width: 1200px; margin: 0 auto; }
.head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.title-input { font-size: 28px; font-weight: 800; background: transparent; border: 1px solid transparent; padding: 2px 6px; margin-left: -6px; width: min(640px, 100%); }
.title-input:hover, .title-input:focus { border-color: var(--line); outline: none; }
.meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 6px; font-size: 14px; }
.actions { display: flex; gap: 8px; align-items: flex-start; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.kpi { padding: 14px 16px; }
.kpi .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
.mapcard { overflow: hidden; }
.profile-head { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 10px 12px 0; }
.seg { display: flex; gap: 4px; align-items: center; font-size: 13px; }
.seg button { padding: 3px 10px; font-size: 13px; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; padding: 4px 12px 12px; font-size: 12px; color: var(--muted); align-items: center; }
.legend i, .share-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.score-info { margin-left: auto; color: var(--text); }
.shares { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.share { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: var(--panel-2); }
.bar i { display: block; height: 100%; }
.share-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--muted); }
.block { padding: 18px 20px; }
.block h2 { font-size: 18px; margin-bottom: 14px; }
.block.hike { box-shadow: inset 4px 0 var(--hike); }
.block.flight { box-shadow: inset 4px 0 var(--flight); }
.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px 28px; }
.group .label { color: var(--accent); margin-bottom: 6px; }
dl { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; margin: 0; font-size: 14px; }
dt { color: var(--muted); }
dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.note { font-size: 13px; color: var(--muted); margin: 14px 0 0; }
table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
th { text-align: left; font-weight: 500; color: var(--muted); font-size: 12px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td { padding: 6px 8px; border-bottom: 1px solid var(--line); }
tbody tr:hover { background: var(--panel-2); }
td.strong { font-weight: 700; }
.with-seg { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.with-seg .seg { margin-left: auto; font-weight: 400; }
.scroll { max-height: 420px; overflow: auto; }
.scroll thead th { position: sticky; top: 0; background: var(--panel); }
@media (max-width: 800px) { .title-input { font-size: 22px; } table { font-size: 12px; } }
</style>
