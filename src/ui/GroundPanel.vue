<script setup lang="ts">
import { liveQuery } from 'dexie';
import { onUnmounted, ref, shallowRef } from 'vue';
import { db } from '../app/db';
import { t } from '../app/i18n';
import { clearGroundCache, groundSettings, OPENTOPO_DEMS, parseDemFile, SOURCE_LABEL, type GroundSource } from '../app/ground';

defineProps<{ label?: string; warning?: string; progress?: { label: string; done: number; total: number } | null }>();
const emit = defineEmits<{ changed: [] }>();

const files = shallowRef<{ id?: number; name: string; grid: { dx: number; ncols: number; nrows: number } }[]>([]);
const sub = liveQuery(() => db.demFiles.toArray()).subscribe((l) => (files.value = l));
onUnmounted(() => sub.unsubscribe());
const importError = ref('');
const keyDraft = ref(groundSettings.apiKey);

async function importDem(list: FileList | null) {
  importError.value = '';
  for (const f of list ?? []) {
    try {
      const grid = await parseDemFile(f);
      await db.demFiles.add({ name: f.name, grid, createdAt: Date.now() });
    } catch (e) {
      importError.value = `${f.name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  clearGroundCache();
  emit('changed');
}
async function removeDem(id?: number) {
  if (id == null) return;
  await db.demFiles.delete(id);
  clearGroundCache();
  emit('changed');
}
function saveKey() {
  groundSettings.apiKey = keyDraft.value.trim();
  clearGroundCache();
}
async function clearTiles() {
  await db.dem.clear();
  clearGroundCache();
  emit('changed');
}
const resM = (dx: number) => `${Math.round(dx * 111_320)} m`;
</script>

<template>
  <div class="ground">
    <div class="row">
      <label>{{ t('Gelände für Höhe über Grund') }}
        <select v-model="groundSettings.source">
          <option v-for="(l, k) in SOURCE_LABEL" :key="k" :value="k as GroundSource">{{ t(l) }}</option>
        </select>
      </label>
      <label v-if="groundSettings.source === 'opentopo'">{{ t('Datensatz') }}
        <select v-model="groundSettings.dem">
          <option v-for="(l, k) in OPENTOPO_DEMS" :key="k" :value="k">{{ l }}</option>
        </select>
      </label>
      <label v-if="groundSettings.source === 'opentopo'" class="grow">API-Key
        <span class="key">
          <input v-model="keyDraft" type="password" autocomplete="off" :placeholder="`OpenTopography ${t('API-Key')}`" @keydown.enter="saveKey" />
          <button :disabled="keyDraft.trim() === groundSettings.apiKey" @click="saveKey">{{ t('Übernehmen') }}</button>
        </span>
      </label>
      <label v-if="groundSettings.source === 'file'" class="grow">{{ t('DEM-Dateien (.asc, .hgt, .tif in WGS84)') }}
        <input type="file" multiple accept=".asc,.hgt,.tif,.tiff" @change="importDem(($event.target as HTMLInputElement).files)" />
      </label>
    </div>
    <p v-if="groundSettings.source === 'opentopo'" class="muted small">
      {{ t('Kostenloser Key') }}: <a href="https://portal.opentopography.org/requestService?service=api" target="_blank" rel="noopener">portal.opentopography.org</a>.
      {{ t('Geladen werden nur 0,25°-Kacheln entlang des Tracks (je ~10 s), danach lokal gespeichert.') }}
      <button class="link" @click="clearTiles">{{ t('Gespeicherte Kacheln löschen') }}</button>
    </p>
    <ul v-if="groundSettings.source === 'file' && files.length" class="files">
      <li v-for="f in files" :key="f.id">{{ f.name }} <span class="muted">· {{ f.grid.ncols }}×{{ f.grid.nrows }} · {{ resM(f.grid.dx) }}</span>
        <button class="link" @click="removeDem(f.id)">{{ t('entfernen') }}</button></li>
    </ul>
    <p v-if="importError" class="error small">{{ importError }}</p>
    <div v-if="progress" class="small muted">{{ t(progress.label) }} … {{ progress.total ? `${progress.done} / ${progress.total}` : '' }}</div>
    <p v-else-if="label" class="small muted">{{ t('Quelle') }}: {{ label }}</p>
    <p v-if="warning" class="small warn">{{ warning }}</p>
  </div>
</template>

<style scoped>
.ground { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: flex-end; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
label.grow { flex: 1; min-width: 220px; }
.key { display: flex; gap: 6px; }
.key input { flex: 1; min-width: 0; }
.small { font-size: var(--fs-1); margin: 0; }
.files { margin: 0; padding-left: 18px; font-size: 13px; }
button.link { background: none; border: none; padding: 0 4px; color: var(--accent); cursor: pointer; font-size: var(--fs-1); }
.warn { color: #ffca28; }
.error { color: #ff6b6b; }
</style>
