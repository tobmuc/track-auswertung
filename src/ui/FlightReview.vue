<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { groundProfile } from '../app/ground';
import * as F from '../app/format';
import { t } from '../app/i18n';
import type { ActivityResult, Timeline } from '../app/types';
import { POLARS, type Finding, type XcPotential } from '../core';
import { compass } from '../core/geo';

const props = defineProps<{ result: ActivityResult; polarId: string }>();
const emit = defineEmits<{ select: [idx: number]; polar: [id: string] }>();

const polarInfo = computed(() => props.result.flight?.polar);
const classes = POLARS.filter((p) => !p.model);
const models = [...POLARS.filter((p) => p.model)].sort((a, b) => a.label.localeCompare(b.label));
/** a recommendation beyond the speeds the polar has data for */
const beyond = (kmhValue: number) => polarInfo.value && kmhValue > polarInfo.value.windowToKmh + 1;

const review = computed(() => props.result.flight?.review);
const offset = computed(() => props.result.segments.find((s) => s.kind === 'flight')?.offset ?? 0);
const tz = computed(() => props.result.timeZone);

const ms = (v: number) => F.vario(v);
const sec = (v: number) => (v >= 90 ? F.dur(v) : `${Math.round(v)} s`);
const m = (v: number) => F.m(v);
const kmh = (v: number) => F.kmh(v, 0);

/** Fills {name} placeholders in a translated sentence */
function fill(text: string, vals: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vals[k] ?? `{${k}}`);
}

function clockOf(f: Finding) {
  const tl = props.result.timeline.t;
  const a = tl[Math.min(tl.length - 1, offset.value + f.start)];
  const b = tl[Math.min(tl.length - 1, offset.value + f.end)];
  return `${F.clock(a, tz.value)}–${F.clock(b, tz.value)}`;
}

/** Title and sentence for one finding; numbers come straight from the measured values */
function describe(f: Finding): { title: string; text: string; whole: boolean } {
  const v = f.v;
  const time = clockOf(f);
  switch (f.topic) {
    case 'late-exit':
      return { whole: false, title: t('Zu lange im schwachen Teil gekurbelt'), text: fill(t('{time}: Die letzten {turns} Kreise bis {top} brachten nur {tail}. Bestes Steigen in diesem Bart {best}, Tagesschnitt {day}. {tailS} für {gain}; früher weiterfliegen hätte grob {lost} gespart.'), {
        time, turns: String(v.turns), top: m(v.topM), tail: ms(v.tailClimbMs), best: ms(v.bestMs), day: ms(v.dayMs), tailS: sec(v.tailS), gain: m(v.tailGainM), lost: sec(v.lostS) }) };
    case 'slow-centring':
      return { whole: false, title: t('Langsam zentriert'), text: fill(t('{time}: {turns} Kreise und {centred}, bis der Bart stand. Vorher {before}, danach {after}. Grob {lost} verloren.'), {
        time, turns: String(v.turns), centred: sec(v.centredS), before: ms(v.beforeMs), after: ms(v.afterMs), lost: sec(v.lostS) }) };
    case 'weak-thermal':
      return { whole: false, title: t('Schwache Thermik genommen'), text: fill(t('{time}: Im Schnitt {climb}, der Tagesschnitt lag bei {day}. {dur} für {gain}. Mit dem Tagesschnitt wären es grob {lost} weniger gewesen. Richtig war es, wenn du dort tief warst.'), {
        time, climb: ms(v.climbMs), day: ms(v.dayMs), dur: sec(v.durS), gain: m(v.gainM), lost: sec(v.lostS) }) };
    case 'headwind-trim':
      return { whole: false, title: t('Bei Gegenwind nicht beschleunigt'), text: fill(t('{time}: {dist} gegen {head} Gegenwind mit {air} Fahrt (Trimm {trim}), über Grund {ground}. Mit 8 km/h mehr Fahrt grob {saved} schneller, solange die Gleitzahl über Grund hält.'), {
        time, dist: F.km(v.distKm, 1), head: kmh(v.headKmh), air: kmh(v.airKmh), trim: kmh(v.trimKmh), ground: kmh(v.groundKmh), saved: sec(v.savedS) }) };
    case 'sink-trim':
      return { whole: false, title: t('Im Sinken nicht beschleunigt'), text: fill(t('{time}: {dist} mit {sink} Sinken bei {air} Fahrt (Trimm {trim}). Durch sinkende Luft schneller fliegen kostet weniger Höhe; grob {saved} schneller.'), {
        time, dist: F.km(v.distKm, 1), sink: F.vario(-v.sinkMs), air: kmh(v.airKmh), trim: kmh(v.trimKmh), saved: sec(v.savedS) }) };
    case 'circle-size':
      return { whole: true, title: t('Engere Kreise stiegen besser'), text: fill(t('Kreise bis {tight} Durchmesser: {tightMs}. Kreise ab {wide}: {wideMs}. In weiten Kreisen warst du {wideS} unterwegs; enger kreisen hätte grob {lost} gebracht.'), {
        tight: m(v.tightD), wide: m(v.wideD), tightMs: ms(v.tightMs), wideMs: ms(v.wideMs), wideS: sec(v.wideS), lost: sec(v.lostS) }) };
    case 'stf-slow':
    case 'stf-fast':
      return { whole: false, title: t(f.topic === 'stf-slow' ? 'Langsamer als die Sollfahrt' : 'Schneller als die Sollfahrt'), text: fill(t('{time}: {dist} mit {air} Fahrt. Nach der Polare wären {opt} besser gewesen (Wind {wind}, Luftmasse {netto}, nächster Bart {mc}). Grob {lost} Unterschied, gerechnet bis zum Wiederaufkurbeln der Höhe.'), {
        time, dist: F.km(v.distKm, 1), air: kmh(v.airKmh), opt: kmh(v.optKmh), wind: F.signed(v.windKmh, 'km/h'), netto: F.vario(v.nettoMs), mc: ms(v.mcMs), lost: sec(v.lostS) })
        + (beyond(v.optKmh) ? ' ' + fill(t('Über {w} hat die Polare keine Messdaten mehr, dort ist sie fortgeschrieben.'), { w: kmh(polarInfo.value!.windowToKmh) }) : '') };
    case 'stf-good':
      return { whole: false, title: t('Gleitstrecke nach Sollfahrt'), text: fill(t('{time}: {dist} mit {air} Fahrt, die Polare empfiehlt {opt} (Wind {wind}, Luftmasse {netto}, nächster Bart {mc}).'), {
        time, dist: F.km(v.distKm, 1), air: kmh(v.airKmh), opt: kmh(v.optKmh), wind: F.signed(v.windKmh, 'km/h'), netto: F.vario(v.nettoMs), mc: ms(v.mcMs) }) };
    case 'polar-sink':
      return { whole: true, title: t('Mehr Sinken als die Polare'), text: fill(t('In Trimmfahrt ({trim}) sankst du im Median {measured}, die Polare sagt {polar}. Ein Teil davon ist sinkende Luft zwischen den Bärten. Zeigt sich der Unterschied über viele Flüge, lohnt ein Blick auf Gurtzeug und Beinsack, Startgewicht und eine ruhige Bremsstellung.'), {
        trim: kmh(v.trimKmh), measured: F.vario(-v.measuredMs), polar: F.vario(-v.polarMs) }) };
    case 'polar-ok':
      return { whole: true, title: t('Sinken wie die Polare'), text: fill(t('In Trimmfahrt ({trim}) sankst du im Median {measured}, die Polare sagt {polar}.'), {
        trim: kmh(v.trimKmh), measured: F.vario(-v.measuredMs), polar: F.vario(-v.polarMs) }) };
    case 'best-thermal':
      return { whole: false, title: t('Stärkster Bart'), text: fill(t('{time}: {climb} im Schnitt, {gain} Höhengewinn bis {top}. Der Tagesschnitt lag bei {day}.'), {
        time, climb: ms(v.climbMs), gain: m(v.gainM), top: m(v.topM), day: ms(v.dayMs) }) };
    case 'best-glide':
      return { whole: false, title: t('Bester Gleitflug'), text: fill(t('{time}: Gleitzahl {ratio} über {dist} bei {loss} Höhenverlust, gegenüber der Luft {air}.'), {
        time, ratio: F.glide(v.ratio), dist: F.km(v.distKm, 1), loss: m(v.lossM), air: F.glide(v.airRatio) }) };
    case 'fast-centring':
      return { whole: false, title: t('Schnell zentriert'), text: fill(t('{time}: Nach {centred} stand der Bart, danach {gain} mit {climb} im Schnitt.'), {
        time, centred: sec(v.centredS), gain: m(v.gainM), climb: ms(v.climbMs) }) };
    case 'speed-to-fly':
      return { whole: true, title: t('Nach Sollfahrt geflogen'), text: fill(t('Bei Gegenwind {head} % der Zeit beschleunigt, bei Rückenwind {tail} %. Insgesamt {accel} beschleunigt.'), {
        head: String(Math.round(v.headPct)), tail: String(Math.round(v.tailPct)), accel: F.dur(v.accelS) }) };
    case 'fastest-leg':
      return { whole: false, title: t('Schnellste halbe Stunde'), text: fill(t('{time}: {dist} Luftlinie in 30 Minuten, das sind {kmh} im Schnitt.'), {
        time, dist: F.km(v.distKm, 1), kmh: kmh(v.kmh) }) };
  }
}

const good = computed(() => (review.value?.good ?? []).map((f) => ({ f, ...describe(f) })));
const improve = computed(() => (review.value?.improve ?? []).map((f) => ({ f, ...describe(f) })));
const potentialS = computed(() => (review.value?.improve ?? []).reduce((a, f) => a + (f.v.lostS ?? f.v.savedS ?? 0), 0));

// ---------- turnpoints and rating: what the triangle lacked, checked against height and terrain
interface CloseCheck {
  /** last thermal before the end of the track */
  topM: number;
  topClock: string;
  /** straight line from there to the closing point */
  distKm: number;
  groundTargetM: number;
  maxGroundM: number;
  /** distance the height would have carried at the flight's average glide, arriving 200 m above ground */
  reachKm: number;
  glide: number;
  bearing: string;
}
const xc = computed(() => props.result.xcPotential ?? []);
const closeCheck = ref<CloseCheck | null>(null);

/** Bearing from a to b in degrees */
function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

watchEffect(async () => {
  const close = xc.value.find((p) => p.kind === 'close');
  const res = props.result;
  const glide = res.flight?.avgGlideRatio;
  closeCheck.value = null;
  if (!close?.out || !close.target || !glide) return;
  const tl = res.timeline;
  // last thermal that ended before the track reached the closing-out point
  const ths = res.segments.flatMap((sg) => sg.thermals).filter((th) => th.end <= close.out!.idx);
  const last = ths[ths.length - 1];
  if (!last) return;
  const from = { lat: tl.lat[last.end], lon: tl.lon[last.end] };
  const to = close.target;
  // ground along the straight line, 60 samples
  const N = 60;
  const line = { t: new Float64Array(N), lat: new Float64Array(N), lon: new Float64Array(N) } as unknown as Timeline;
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    line.lat[i] = from.lat + (to.lat - from.lat) * f;
    line.lon[i] = from.lon + (to.lon - from.lon) * f;
  }
  try {
    const g = await groundProfile(`xc-close:${from.lat.toFixed(4)},${from.lon.toFixed(4)}>${to.lat.toFixed(4)},${to.lon.toFixed(4)}`, line);
    const ground = [...g.ground].filter((v) => v === v);
    if (!ground.length) return;
    const km = Math.hypot((to.lat - from.lat) * 111.32, (to.lon - from.lon) * 111.32 * Math.cos((from.lat * Math.PI) / 180));
    const groundTarget = g.ground[N - 1];
    closeCheck.value = {
      topM: last.topAlt,
      topClock: F.clock(tl.t[last.end], tz.value),
      distKm: km,
      groundTargetM: groundTarget,
      maxGroundM: Math.max(...ground),
      reachKm: Math.max(0, ((last.topAlt - groundTarget - 200) * glide) / 1000),
      glide,
      bearing: compass(bearingDeg(from, to)),
    };
  } catch {
    closeCheck.value = null;
  }
});

function describeXc(p: XcPotential): { title: string; text: string } {
  const pts = (v: number) => `${F.num(v, 1)} P`;
  if (p.kind === 'close') {
    let text = fill(t('Die Lücke zum Start des Dreiecks war {gap} lang, erlaubt sind 5 % des Umfangs. Es fehlten {miss}. Geschlossen zählt das Dreieck ×{m2} statt ×{m1}: etwa {new} statt {now}.'), {
      gap: F.km(p.gapKm ?? 0, 1), miss: F.km(p.missingKm, 1), m1: String(p.nowMultiplier), m2: String(p.newMultiplier), new: pts(p.newPoints), now: pts(p.nowPoints) });
    const c = closeCheck.value;
    if (c) {
      text += ' ' + fill(t('Vom letzten Bart (Top {top} um {clock}) bis zum Schliesspunkt waren es {dist} Richtung {dir}; das Gelände dort liegt auf {ground}, unterwegs bis {max}. Mit deiner mittleren Gleitzahl {glide} hätte die Höhe für {reach} gereicht, mit 200 m Reserve über Grund.'), {
        top: F.m(c.topM), clock: c.topClock, dist: F.km(c.distKm, 1), dir: c.bearing, ground: F.m(c.groundTargetM), max: F.m(c.maxGroundM), glide: F.glide(c.glide), reach: F.km(c.reachKm, 1) });
      text += ' ' + (c.reachKm >= c.distKm
        ? t('Die Höhe hätte gereicht: Der Schlussgleiter hätte Richtung Startplatz gehen können.')
        : c.reachKm < 0.5
          ? fill(t('Der letzte Bart endete nur {diff} über dem Gelände am Schliesspunkt. Für die Strecke zurück hätte es mindestens einen weiteren Bart gebraucht.'), { diff: F.m(c.topM - c.groundTargetM) })
          : fill(t('Es fehlte also noch ein Bart, etwa {more} vor dem Ziel.'), { more: F.km(c.distKm - c.reachKm, 1) }));
    }
    return { title: t('Dreieck schliessen'), text };
  }
  return {
    title: t('FAI-Dreieck'),
    text: fill(t('Der kürzeste Schenkel hatte {share} % des Umfangs, nötig sind 28 %. Mit {miss} mehr auf diesem Schenkel wäre es ein FAI-Dreieck mit ×{m2}: etwa {new} statt {now}.'), {
      share: String(Math.round((p.shortestShare ?? 0) * 100)), miss: F.km(p.missingKm, 1), m2: String(p.newMultiplier), new: pts(p.newPoints), now: pts(p.nowPoints) }),
  };
}
const xcItems = computed(() => xc.value.map((p) => ({ p, ...describeXc(p) })));

function pick(f: Finding, whole: boolean) {
  if (whole) return;
  emit('select', offset.value + ((f.start + f.end) >> 1));
}
</script>

<template>
  <section v-if="review && (good.length || improve.length)" class="review">
    <h2>{{ t('Flugbewertung') }}</h2>
    <p class="lead">
      <template v-if="improve.length">{{ fill(t('{n} Abschnitte mit Potenzial, zusammen grob {time}. {g} Stärken.'), { n: String(improve.length), time: F.dur(potentialS), g: String(good.length) }) }}</template>
      <template v-else>{{ t('Keine auffälligen Schwächen gefunden.') }}</template>
    </p>
    <p v-if="polarInfo" class="polar">
      <label>
        {{ t('Polare') }}
        <select :value="polarId" @change="emit('polar', ($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('Automatisch') }} ({{ polarInfo.how === 'glider-name' ? polarInfo.label : t('EN-B (Klassenmittel)') }})</option>
          <optgroup :label="t('Klassen')"><option v-for="p in classes" :key="p.id" :value="p.id">{{ t(p.label) }}</option></optgroup>
          <optgroup :label="t('Schirme')"><option v-for="p in models" :key="p.id" :value="p.id">{{ p.label }}</option></optgroup>
        </select>
      </label>
      <span class="muted">{{ fill(t('{how}. Quelle: {src}, {n} Flüge, Messbereich {from} bis {to}.'), {
        how: polarInfo.how === 'glider-name' ? t('Aus dem Schirmnamen im IGC erkannt') : polarInfo.how === 'chosen' ? t('Von dir gewählt') : t('Schirm nicht erkannt, Klassenmittel EN-B'),
        src: polarInfo.source, n: String(polarInfo.flights), from: kmh(polarInfo.fromKmh), to: kmh(polarInfo.windowToKmh) }) }}</span>
    </p>
    <div class="cols">
      <div>
        <h3>{{ t('Gut gelaufen') }}</h3>
        <ul>
          <li v-for="x in good" :key="x.f.topic + x.f.start">
            <button class="item" :disabled="x.whole" @click="pick(x.f, x.whole)">
              <strong>{{ x.title }}</strong>
              <span>{{ x.text }}</span>
            </button>
          </li>
        </ul>
      </div>
      <div>
        <h3>{{ t('Potenzial') }}</h3>
        <ul>
          <li v-for="x in improve" :key="x.f.topic + x.f.start">
            <button class="item" :disabled="x.whole" @click="pick(x.f, x.whole)">
              <strong>{{ x.title }}</strong>
              <span>{{ x.text }}</span>
            </button>
          </li>
          <li v-if="!improve.length" class="none">{{ t('Nichts, was nach den Regeln auffällt.') }}</li>
        </ul>
      </div>
    </div>
    <div v-if="xcItems.length" class="xc">
      <h3>{{ t('Wendepunkte und Wertung') }}</h3>
      <ul>
        <li v-for="x in xcItems" :key="x.p.kind + x.p.from" class="xc-item">
          <strong>{{ x.title }}</strong>
          <span>{{ x.text }}</span>
        </li>
      </ul>
    </div>
    <p class="note">{{ t('Grundlage sind nur die Messwerte des Tracks: Steigen pro Vollkreis, Fahrt aus dem Winddreieck, Tagesschnitt des Steigens. Die Zeitangaben sind grobe Schätzungen. Gründe wie Gelände, Luftraum oder eine geplante Route sieht die Auswertung nicht. Ein Klick zeigt den Abschnitt auf Karte und Profil.') }}</p>
  </section>
</template>

<style scoped>
.review > h2 { padding-top: 18px; border-top: 1px solid var(--rule); margin-bottom: 6px; }
.lead { margin: 0 0 10px; font-size: var(--fs-3); }
.polar { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin: 0 0 20px; font-size: var(--fs-1); }
.polar label { display: flex; gap: 8px; align-items: center; color: var(--snow); }
.polar select { max-width: 280px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 48px; }
h3 { font-size: var(--fs-2); margin-bottom: 8px; }
.cols > div:first-child h3 { color: var(--sky); }
.cols > div:last-child h3 { color: var(--lift); }
ul { list-style: none; margin: 0; padding: 0; }
li { border-top: 1px solid var(--rule); }
.item {
  display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; padding: 10px 0;
  background: none; border: none; border-radius: 0; color: var(--snow); line-height: 1.45;
}
.item:not(:disabled):hover strong { text-decoration: underline; }
.item:disabled { cursor: default; opacity: 1; }
.item span { color: var(--lichen); font-size: 14px; }
.none { padding: 10px 0; color: var(--lichen); }
.xc { margin-top: 28px; }
.xc h3 { color: var(--snow); }
.xc-item { display: flex; flex-direction: column; gap: 3px; padding: 10px 0; max-width: 90ch; }
.xc-item span { color: var(--lichen); font-size: 14px; }
.note { font-size: var(--fs-1); color: var(--lichen); margin: 14px 0 0; max-width: 90ch; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
</style>
