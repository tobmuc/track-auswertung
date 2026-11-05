<script setup lang="ts">
import { liveQuery } from 'dexie';
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
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
/** flight list in the top bar */
const menuOpen = ref(false);
const BUILD = __BUILD__;
const buildDate = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(BUILD.date));
const buildTitle = `Version ${BUILD.version}, Build ${BUILD.build}, Commit ${BUILD.commit}, ${new Date(BUILD.date).toLocaleString()}`;
const demoVideo = `${import.meta.env.BASE_URL}demo/demo-flug.mp4`;
const demoPoster = `${import.meta.env.BASE_URL}demo/demo-flug.jpg`;

const sub = liveQuery(() => db.activities.orderBy('date').reverse().toArray()).subscribe((list) => (activities.value = list));
onUnmounted(() => sub.unsubscribe());

const current = computed(() => activities.value.find((a) => a.id === currentId.value));

function readRoute() {
  const m = /^#\/a\/(\d+)(\/3d)?/.exec(location.hash);
  currentId.value = m ? Number(m[1]) : null;
  view.value = m?.[2] ? '3d' : 'stats';
  menuOpen.value = false;
  window.scrollTo(0, 0);
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false;
}
onMounted(() => {
  readRoute();
  window.addEventListener('hashchange', readRoute);
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  window.removeEventListener('hashchange', readRoute);
  window.removeEventListener('keydown', onKey);
});

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
/** one line per flight: sport, distance, airtime */
function facts(a: ActivityRecord) {
  const s = a.summary;
  if (!s) return '';
  return [t(SPORT_LABEL[s.sport]), s.xcKm ? km(s.xcKm, 1) : '', s.airtimeS ? dur(s.airtimeS) : ''].filter(Boolean).join(', ');
}
</script>

<template>
  <div class="app" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="onDrop">
    <header class="top">
      <a class="mark" href="#/">Track-Auswertung</a>
      <div class="flights">
        <button class="flights-btn" :aria-expanded="menuOpen" aria-controls="flight-menu" @click="menuOpen = !menuOpen">
          <span class="flights-label">{{ current?.title ?? t('Deine Flüge') }}</span>
          <span class="count" :aria-label="`${activities.length} ${t('Aktivitäten')}`">{{ activities.length }}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
        </button>
        <nav v-if="menuOpen" id="flight-menu" class="menu" :aria-label="t('Aktivitäten')">
          <a v-for="a in activities" :key="a.id" :href="`#/a/${a.id}`" :aria-current="a.id === currentId ? 'page' : undefined">
            <strong>{{ a.title }}</strong>
            <span>{{ facts(a) }}</span>
          </a>
          <p v-if="!activities.length" class="empty">{{ t('Noch keine Aktivitäten.') }}</p>
        </nav>
      </div>
      <div class="top-actions">
        <button class="primary" :disabled="importing" @click="fileInput?.click()">
          {{ importing ? t('Analysiere …') : t('Track laden') }}
        </button>
        <span class="lang" role="group" aria-label="Sprache / language">
          <button :aria-pressed="i18n.lang === 'de'" @click="i18n.lang = 'de'">DE</button>
          <button :aria-pressed="i18n.lang === 'en'" @click="i18n.lang = 'en'">EN</button>
        </span>
      </div>
      <input ref="fileInput" type="file" accept=".igc,.gpx" multiple hidden @change="onPick" />
    </header>
    <div v-if="menuOpen" class="scrim" @click="menuOpen = false" />

    <main>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <VideoView v-if="currentId && view === '3d'" :id="currentId" :key="`3d-${currentId}`" />
      <ActivityView v-else-if="currentId" :id="currentId" :key="currentId" />
      <section v-else class="welcome">
        <div class="stage">
          <video :src="demoVideo" :poster="demoPoster" autoplay muted loop playsinline preload="auto" aria-hidden="true" />
          <div class="stage-text">
            <h1>{{ t('Dein Flug, wie er war.') }}</h1>
            <p>{{ t('Zieh deinen Track hierher und sieh deine Thermiken, deine Gleitstrecken und deine Kreise im Gelände, in dem du geflogen bist. Mit einem Klick wird daraus ein 3D-Video für Instagram und YouTube.') }}</p>
            <p class="stage-note">{{ t('Im Video: 81 km Strecke, 4 h 17 min Flug, in 30 Sekunden.') }}</p>
          </div>
        </div>

        <div class="intro">
          <div class="drop" :class="{ over: dragging }" role="button" tabindex="0" :aria-label="t('Track laden')"
            @click="fileInput?.click()" @keydown.enter.prevent="fileInput?.click()" @keydown.space.prevent="fileInput?.click()">
            <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
              <path d="M4 30 14 16l7 9 5-6 10 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              <path d="M20 4v13m-5-5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
            <div>
              <h2>{{ t('Track laden') }}</h2>
              <p>{{ t('IGC aus dem Vario oder GPX von Uhr/Handy hierher ziehen oder klicken.') }}</p>
              <p class="muted">{{ t('Hike & Fly: Aufstieg (GPX) und Flug (IGC) zusammen auswählen, oder eine Datei mit beidem.') }}</p>
            </div>
          </div>

          <div v-if="activities.length" class="recent">
            <h2>{{ t('Deine Flüge') }}</h2>
            <ul>
              <li v-for="a in activities.slice(0, 8)" :key="a.id">
                <a :href="`#/a/${a.id}`"><strong>{{ a.title }}</strong> <span class="muted">{{ facts(a) }}</span></a>
              </li>
            </ul>
          </div>

          <dl class="what">
            <div><dt>{{ t('Auswertung') }}</dt><dd>{{ t('XC-Wertung nach XContest, FAI, FFVL und XC League; Thermiken mit Steigen und Versatz, Gleitstrecken mit Gleitzahl, Kreisdurchmesser, Querlage und Zentrieren.') }}</dd></div>
            <div><dt>{{ t('Fahrt durch die Luft') }}</dt><dd>{{ t('Aus Grundgeschwindigkeit und Wind: Trimmfahrt, wann du beschleunigt hast und ob bei Gegenwind mehr als bei Rückenwind.') }}</dd></div>
            <div><dt>{{ t('3D-Video') }}</dt><dd>{{ t('Hoch- oder Querformat, Sonnenstand mit Schatten, Wolkenbasis, mehrere Piloten, Musik ohne GEMA.') }}</dd></div>
            <div><dt>{{ t('Privat') }}</dt><dd>{{ t('Deine Tracks bleiben in deinem Browser. Nichts wird hochgeladen.') }}</dd></div>
          </dl>
        </div>
      </section>
    </main>

    <footer class="foot">
      <span>{{ t('Alle Daten bleiben lokal im Browser (IndexedDB).') }}</span>
      <button v-if="analyticsAvailable" class="link" @click="resetConsent">{{ t('Statistik-Einstellungen') }}</button>
      <a class="version" :title="buildTitle" :href="`https://github.com/tobmuc/track-auswertung/commit/${BUILD.commit.replace('+', '')}`" target="_blank" rel="noopener">v{{ BUILD.version }}, Build {{ BUILD.build }}, {{ BUILD.commit }}, {{ buildDate }}</a>
    </footer>

    <div v-if="analyticsAvailable && consent.choice === null" class="consent" role="dialog" :aria-label="t('Statistik-Einstellungen')">
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
.app { min-height: 100vh; display: flex; flex-direction: column; }

/* top bar: name, flight switcher, one action */
.top {
  position: sticky; top: 0; z-index: 30; height: 56px; display: flex; align-items: center; gap: 16px;
  padding: 0 20px; background: rgba(27, 36, 33, .94); border-bottom: 1px solid var(--rule);
  backdrop-filter: blur(6px);
}
.mark { color: var(--snow); text-decoration: none; font-weight: 750; font-size: var(--fs-3); font-variation-settings: var(--wide); white-space: nowrap; }
.flights { position: relative; min-width: 0; flex: 0 1 360px; }
.flights-btn { display: flex; align-items: center; gap: 8px; width: 100%; background: transparent; border-color: var(--rule); }
.flights-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; }
.count { font-size: var(--fs-1); color: var(--lichen); }
.menu {
  position: absolute; top: calc(100% + 6px); left: 0; width: min(420px, calc(100vw - 32px)); max-height: 70vh; overflow: auto;
  background: var(--ground-2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 6px; z-index: 40;
  box-shadow: 0 18px 40px rgba(0, 0, 0, .45);
}
.menu a { display: flex; flex-direction: column; padding: 8px 10px; border-radius: 4px; color: var(--snow); text-decoration: none; }
.menu a span { font-size: var(--fs-1); color: var(--lichen); }
.menu a:hover { background: var(--ground-3); }
.menu a[aria-current="page"] { box-shadow: inset 3px 0 var(--lift); }
.empty { margin: 8px 10px; color: var(--lichen); }
.scrim { position: fixed; inset: 0; z-index: 25; }
.top-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.lang { display: flex; }
.lang button { padding: 4px 8px; font-size: var(--fs-1); background: transparent; border-color: var(--rule); border-radius: 0; }
.lang button:first-child { border-radius: 4px 0 0 4px; }
.lang button:last-child { border-radius: 0 4px 4px 0; border-left: none; }
.lang button[aria-pressed="true"] { background: var(--snow); color: var(--ground); border-color: var(--snow); }

main { flex: 1; min-width: 0; }
.error { color: #ff9b8a; margin: 16px 20px; }

/* welcome: the demo flight is the stage, text sits in the sky */
.stage { position: relative; height: min(72vh, 680px); overflow: hidden; background: #000; }
.stage video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.stage-text {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 120px max(20px, calc((100vw - 1120px) / 2)) 32px;
  background: linear-gradient(to top, rgba(27, 36, 33, .92), rgba(27, 36, 33, 0));
}
.stage-text h1 { font-size: var(--fs-5); line-height: 1.05; max-width: 22ch; text-wrap: balance; }
.stage-text p { max-width: 58ch; margin: 12px 0 0; font-size: var(--fs-3); }
.stage-text .stage-note { font-size: var(--fs-1); color: var(--lichen); }

.intro { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px 56px; }
.drop {
  grid-column: 1 / -1; display: flex; gap: 20px; align-items: center; padding: 28px; cursor: pointer;
  border: 1.5px dashed var(--control-line); border-radius: var(--radius); color: var(--lift);
}
.drop:hover, .drop.over { border-color: var(--lift); background: var(--ground-2); }
.drop h2 { color: var(--snow); font-size: var(--fs-4); }
.drop p { margin: 4px 0 0; color: var(--snow); }
.drop p.muted { color: var(--lichen); }
.recent h2, .what dt { font-size: var(--fs-3); }
.recent ul { list-style: none; padding: 0; margin: 12px 0 0; }
.recent li { border-top: 1px solid var(--rule); }
.recent a { display: block; padding: 10px 0; color: var(--snow); text-decoration: none; }
.recent a:hover strong { text-decoration: underline; }
.what { margin: 0; display: grid; gap: 18px; }
.recent + .what { grid-column: 2; }
.what dt { font-weight: 700; font-variation-settings: var(--wide); }
.what dd { margin: 4px 0 0; color: var(--lichen); max-width: 52ch; }

.foot {
  display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; padding: 18px 20px 24px;
  border-top: 1px solid var(--rule); font-size: var(--fs-1); color: var(--lichen);
}
.version { color: var(--lichen); text-decoration: none; margin-left: auto; }
.version:hover { text-decoration: underline; }
button.link { background: none; border: none; padding: 0; color: var(--lichen); text-decoration: underline; cursor: pointer; font-size: var(--fs-1); min-height: 0; }

.consent {
  position: fixed; left: 16px; right: 16px; bottom: 16px; max-width: 560px; margin: 0 auto; z-index: 100;
  padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 14px;
  background: var(--ground-2); border: 1px solid var(--rule); border-radius: var(--radius); box-shadow: 0 8px 30px rgba(0, 0, 0, .5);
}
.consent p { margin: 0; }
.consent-buttons { display: flex; gap: 8px; justify-content: flex-end; }
.drag-overlay {
  position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; font-size: var(--fs-4); font-weight: 700;
  background: rgba(27, 36, 33, .85); border: 3px dashed var(--lift); pointer-events: none;
}

@media (max-width: 800px) {
  .top { gap: 10px; padding: 0 12px; }
  .mark { display: none; }
  .flights { flex: 1; }
  .top-actions { gap: 6px; }
  /* the landscape video stays whole on a phone; the text moves below it */
  .stage { height: auto; background: var(--ground); }
  .stage video { position: static; height: auto; aspect-ratio: 16 / 9; }
  .stage-text { position: static; padding: 20px 16px 4px; background: none; }
  .stage-text p { font-size: var(--fs-2); }
  .intro { grid-template-columns: 1fr; padding: 24px 16px 40px; gap: 32px; }
  .recent + .what { grid-column: auto; }
  .drop { padding: 20px; align-items: flex-start; }
  .version { margin-left: 0; }
}
</style>
