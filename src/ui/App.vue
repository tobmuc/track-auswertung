<script setup lang="ts">
import { liveQuery } from 'dexie';
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { analyzeRecord } from '../app/analysis';
import { db } from '../app/db';
import { i18n, t } from '../app/i18n';
import { analyticsAvailable, consent, resetConsent, setConsent, track } from '../app/analytics';
import { dateLong, dur, km, SPORT_LABEL } from '../app/format';
import type { ActivityRecord } from '../app/types';
import type { Sport } from '../core';
import ActivityView from './ActivityView.vue';
import VideoView from './VideoView.vue';

const activities = shallowRef<ActivityRecord[]>([]);
const currentId = ref<number | null>(null);
const view = ref<'stats' | '3d'>('stats');
const dragging = ref(false);
const importing = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement>();
const demoVideo = `${import.meta.env.BASE_URL}demo/demo-flug.mp4`;
const demoPoster = `${import.meta.env.BASE_URL}demo/demo-flug.jpg`;

const sub = liveQuery(() => db.activities.orderBy('date').reverse().toArray()).subscribe((list) => (activities.value = list));
onUnmounted(() => sub.unsubscribe());

function readRoute() {
  const m = /^#\/a\/(\d+)(\/3d)?/.exec(location.hash);
  currentId.value = m ? Number(m[1]) : null;
  view.value = m?.[2] ? '3d' : 'stats';
}
onMounted(() => {
  readRoute();
  window.addEventListener('hashchange', readRoute);
});
onUnmounted(() => window.removeEventListener('hashchange', readRoute));

async function importFiles(list: FileList | File[]) {
  const files = [...list].filter((f) => /\.(igc|gpx)$/i.test(f.name));
  if (!files.length) {
    error.value = t('Bitte IGC- oder GPX-Dateien wählen.');
    return;
  }
  error.value = '';
  importing.value = true;
  try {
    const rec: ActivityRecord = {
      title: '',
      rules: 'XContest',
      createdAt: Date.now(),
      date: '',
      files: await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))),
    };
    const res = await analyzeRecord(rec);
    rec.date = res.date;
    rec.title = defaultTitle(res.sport, res.date);
    rec.summary = {
      sport: res.sport,
      xcKm: res.score?.best.distanceKm,
      airtimeS: res.flight?.airtimeS,
      maxAlt: res.flight?.maxAlt ?? res.hike?.highest,
      hikeGain: res.hike?.gain,
      distanceKm: res.hike?.distanceKm,
    };
    const id = await db.activities.add(rec);
    track('track_import', { sport: res.sport, files: files.length });
    location.hash = `#/a/${id}`;
  } catch (e) {
    error.value = `${t('Import fehlgeschlagen')}: ${e instanceof Error ? e.message : e}`;
  } finally {
    importing.value = false;
  }
}

function defaultTitle(sport: Sport, date: string) {
  return `${t(SPORT_LABEL[sport])} ${dateLong(date)}`;
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  if (e.dataTransfer?.files) importFiles(e.dataTransfer.files);
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files) importFiles(input.files);
  input.value = '';
}
</script>

<template>
  <div class="layout" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop">
    <aside class="sidebar">
      <div class="brand">
        <a class="logo" href="#/">track<span>auswertung</span></a>
        <span class="lang" title="Sprache / language">
          <button :class="{ active: i18n.lang === 'de' }" @click="i18n.lang = 'de'">DE</button>
          <button :class="{ active: i18n.lang === 'en' }" @click="i18n.lang = 'en'">EN</button>
        </span>
      </div>
      <button class="primary" :disabled="importing" @click="fileInput?.click()">
        {{ importing ? t('Analysiere …') : t('+ Neue Aktivität') }}
      </button>
      <input ref="fileInput" type="file" accept=".igc,.gpx" multiple hidden @change="onPick" />
      <div class="label list-label">{{ t('Aktivitäten') }}</div>
      <nav class="list">
        <a
          v-for="a in activities"
          :key="a.id"
          :href="`#/a/${a.id}`"
          :class="{ current: a.id === currentId }"
        >
          <strong>{{ a.title }}</strong>
          <span class="muted">
            {{ a.summary ? t(SPORT_LABEL[a.summary.sport]) : '' }}
            <template v-if="a.summary?.xcKm"> · {{ km(a.summary.xcKm, 1) }}</template>
            <template v-if="a.summary?.airtimeS"> · {{ dur(a.summary.airtimeS) }}</template>
          </span>
        </a>
        <p v-if="!activities.length" class="muted empty">{{ t('Noch keine Aktivitäten.') }}</p>
      </nav>
      <p class="muted foot">{{ t('Alle Daten bleiben lokal im Browser (IndexedDB).') }}
        <template v-if="analyticsAvailable"><br /><button class="link" @click="resetConsent">{{ t('Statistik-Einstellungen') }}</button></template>
      </p>
    </aside>

    <main>
      <p v-if="error" class="error">{{ error }}</p>
      <VideoView v-if="currentId && view === '3d'" :id="currentId" :key="`3d-${currentId}`" />
      <ActivityView v-else-if="currentId" :id="currentId" :key="currentId" />
      <section v-else class="welcome">
        <div class="hero">
          <div class="hero-text">
            <p class="kicker">{{ t('Gleitschirm · Hike & Fly · Drachen') }}</p>
            <h1>{{ t('Dein Flug in 3D.') }} <span>{{ t('In einer Minute.') }}</span></h1>
            <p>{{ t('Track hineinziehen: Thermiken, XC-Wertung und Gleitzahlen auf einen Blick, dazu ein 3D-Flugvideo mit Musik für Instagram und YouTube.') }}</p>
            <ul class="chips">
              <li>🏆 {{ t('XC-Wertung') }}</li>
              <li>🌀 {{ t('Thermik-Analyse') }}</li>
              <li>🎬 {{ t('3D-Video als MP4') }}</li>
              <li>🪂 {{ t('Mehrere Piloten') }}</li>
              <li>☀️ {{ t('Sonne & Wolken') }}</li>
              <li>🔒 {{ t('Bleibt auf deinem Gerät') }}</li>
            </ul>
          </div>
          <figure class="demo">
            <video :src="demoVideo" :poster="demoPoster" autoplay muted loop playsinline preload="auto" />
            <figcaption><span class="live" /> {{ t('Beispiel: 81 km XC-Flug, 4 h 17 min im 30-Sekunden-Video') }}</figcaption>
          </figure>
        </div>
        <div class="drop panel" :class="{ over: dragging }" @click="fileInput?.click()">
          <div class="drop-icon">⬆</div>
          <h2>{{ t('Track laden') }}</h2>
          <p>{{ t('IGC aus dem Vario oder GPX von Uhr/Handy hierher ziehen oder klicken.') }}</p>
          <p class="muted">{{ t('Hike & Fly: Aufstieg (GPX) und Flug (IGC) zusammen auswählen, oder eine Datei mit beidem.') }}</p>
        </div>
      </section>
    </main>
    <div v-if="analyticsAvailable && consent.choice === null" class="consent panel" role="dialog" :aria-label="t('Statistik-Einstellungen')">
      <p>{{ t('Darf diese Seite anonyme Nutzungsstatistiken mit Google Analytics erfassen? Dabei werden Cookies gesetzt und Daten an Google übertragen. Deine Tracks bleiben immer lokal in deinem Browser.') }}</p>
      <div class="consent-buttons">
        <button @click="setConsent('denied')">{{ t('Ablehnen') }}</button>
        <button class="primary" @click="setConsent('granted')">{{ t('Zustimmen') }}</button>
      </div>
    </div>
    <div v-if="dragging" class="drag-overlay">{{ t('Dateien loslassen zum Importieren') }}</div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 260px 1fr; min-height: 100vh; }
.sidebar {
  position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 12px;
  padding: 16px; border-right: 1px solid var(--line); background: #0a0e13;
}
.logo { font-weight: 800; font-size: 20px; color: var(--text); text-decoration: none; }
.logo span { color: var(--accent); }
.list-label { margin-top: 12px; }
.list { display: flex; flex-direction: column; gap: 4px; overflow: auto; flex: 1; }
.list a { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 8px; color: var(--text); text-decoration: none; font-size: 14px; }
.list a span { font-size: 12px; }
.list a:hover { background: var(--panel); }
.list a.current { background: var(--panel-2); box-shadow: inset 3px 0 var(--accent); }
.empty, .foot { font-size: 12px; }
main { min-width: 0; padding: 24px; }
.welcome { display: flex; flex-direction: column; gap: 24px; max-width: 1180px; margin: 0 auto; }
.hero { display: grid; grid-template-columns: minmax(260px, 5fr) 7fr; gap: 32px; align-items: center; }
.kicker { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 8px; }
.hero h1 { font-size: clamp(28px, 3.6vw, 44px); line-height: 1.1; margin: 0 0 14px; }
.hero h1 span { color: var(--accent); }
.hero-text > p { color: var(--muted); font-size: 16px; line-height: 1.5; margin: 0 0 18px; }
.chips { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.chips li { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; font-size: 13px; }
.demo { margin: 0; position: relative; border-radius: 14px; overflow: hidden; border: 1px solid var(--line); background: #000; box-shadow: 0 20px 60px rgba(0, 0, 0, .45); }
.demo video { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.demo figcaption {
  position: absolute; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 8px; font-size: 12px;
  background: rgba(10, 14, 19, .72); padding: 5px 10px; border-radius: 999px; backdrop-filter: blur(4px);
}
.live { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.6s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
.drop { padding: 36px; text-align: center; cursor: pointer; border-style: dashed; transition: border-color .15s, background .15s; }
.drop:hover, .drop.over { border-color: var(--accent); background: var(--panel-2); }
.drop h2 { margin: 4px 0 8px; }
.drop p { margin: 4px 0; }
.drop-icon { font-size: 28px; color: var(--accent); }
@media (max-width: 1000px) {
  .hero { grid-template-columns: 1fr; gap: 18px; }
  .demo { order: -1; }
}
@media (prefers-reduced-motion: reduce) { .live { animation: none; } }
.error { color: #ff6b6b; }
.drag-overlay {
  position: fixed; inset: 0; display: grid; place-items: center; font-size: 24px; font-weight: 700;
  background: rgba(13, 17, 23, .8); border: 3px dashed var(--accent); pointer-events: none;
}
@media (max-width: 800px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; }
  main { padding: 16px; }
}
.consent {
  position: fixed; left: 16px; right: 16px; bottom: 16px; max-width: 560px; margin: 0 auto; z-index: 100;
  padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; box-shadow: 0 8px 30px rgba(0, 0, 0, .5);
}
.consent p { margin: 0; }
.consent-buttons { display: flex; gap: 8px; justify-content: flex-end; }
button.link { background: none; border: none; padding: 0; color: var(--muted); text-decoration: underline; cursor: pointer; font-size: 12px; }
.brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lang { display: flex; gap: 2px; }
.lang button { padding: 2px 7px; font-size: 11px; }
</style>
