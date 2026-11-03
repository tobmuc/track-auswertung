<script setup lang="ts">
import { liveQuery } from 'dexie';
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { analyzeRecord } from '../app/analysis';
import { db } from '../app/db';
import { i18n, t } from '../app/i18n';
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
      <p class="muted foot">{{ t('Alle Daten bleiben lokal im Browser (IndexedDB).') }}</p>
    </aside>

    <main>
      <p v-if="error" class="error">{{ error }}</p>
      <VideoView v-if="currentId && view === '3d'" :id="currentId" :key="`3d-${currentId}`" />
      <ActivityView v-else-if="currentId" :id="currentId" :key="currentId" />
      <section v-else class="welcome">
        <div class="drop panel" :class="{ over: dragging }" @click="fileInput?.click()">
          <h1>{{ t('Track laden') }}</h1>
          <p>{{ t('IGC aus dem Vario oder GPX von Uhr/Handy hierher ziehen oder klicken.') }}</p>
          <p class="muted">{{ t('Hike & Fly: Aufstieg (GPX) und Flug (IGC) zusammen auswählen, oder eine Datei mit beidem.') }}</p>
        </div>
      </section>
    </main>
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
.welcome { display: grid; place-items: center; min-height: 70vh; }
.drop { padding: 64px; text-align: center; cursor: pointer; border-style: dashed; max-width: 560px; }
.drop.over { border-color: var(--accent); }
.drop h1 { margin-bottom: 12px; }
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
.brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lang { display: flex; gap: 2px; }
.lang button { padding: 2px 7px; font-size: 11px; }
</style>
