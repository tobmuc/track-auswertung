<script setup lang="ts">
import { computed } from 'vue';
import * as F from '../app/format';
import { t } from '../app/i18n';
import type { ActivityResult } from '../app/types';
import type { Finding } from '../core';

const props = defineProps<{ result: ActivityResult }>();
const emit = defineEmits<{ select: [idx: number] }>();

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
    <p class="note">{{ t('Grundlage sind nur die Messwerte des Tracks: Steigen pro Vollkreis, Fahrt aus dem Winddreieck, Tagesschnitt des Steigens. Die Zeitangaben sind grobe Schätzungen. Gründe wie Gelände, Luftraum oder eine geplante Route sieht die Auswertung nicht. Ein Klick zeigt den Abschnitt auf Karte und Profil.') }}</p>
  </section>
</template>

<style scoped>
.review > h2 { padding-top: 18px; border-top: 1px solid var(--rule); margin-bottom: 6px; }
.lead { margin: 0 0 18px; font-size: var(--fs-3); }
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
.note { font-size: var(--fs-1); color: var(--lichen); margin: 14px 0 0; max-width: 90ch; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
</style>
