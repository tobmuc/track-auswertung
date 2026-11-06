<script setup lang="ts">
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { colorBucket, type ColorMode } from '../app/colors';
import type { ActivityResult } from '../app/types';
import type { XcScore } from '../core';
import { i18n, t } from '../app/i18n';
import { loadOsmLines, RELIEF_STOPS, type OsmLine } from '../app/relief';

// in the bundled build maplibre would look for its worker next to our own chunk, where it is not;
// the ?url import makes Vite ship the file and gives us its real address
maplibregl.setWorkerUrl(workerUrl);

const props = defineProps<{
  result: ActivityResult;
  colorMode: ColorMode;
  hoverIdx: number | null;
  score?: XcScore;
  /** space kept free at the bottom when fitting the track (text over the map), px */
  padBottom?: number;
}>();
const emit = defineEmits<{ hover: [idx: number | null] }>();

const BASEMAPS = {
  satellite: {
    label: 'Satellit',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxzoom: 18,
  },
  sentinel: {
    label: 'Sentinel-2',
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg'],
    attribution: 'Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0)',
    maxzoom: 14,
  },
  topo: {
    label: 'Topo',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap',
    maxzoom: 17,
  },
  osm: {
    label: 'Strasse',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap',
    maxzoom: 19,
  },
} as const;
/** kk7 asks every request to name the site; its check wants a domain with a dot */
const KK7_SRC = encodeURIComponent(location.hostname.includes('.') ? location.hostname : 'track-auswertung.localhost');
type Basemap = keyof typeof BASEMAPS | 'relief';
/** layers of the relief map: colours and hillshade from the elevation tiles, OSM lines on top */
const RELIEF_LAYERS = ['relief-color', 'relief-shade', 'osm-water', 'osm-river', 'osm-road', 'osm-border'];

const el = ref<HTMLDivElement>();
const basemap = ref<Basemap>('satellite');
const terrain = ref(false);
const labels = ref(false);
/** kk7 thermal maps (thermal.kk7.ch, M. von Känel, CC BY-NC-SA 4.0): hotspot probability and skyways */
const kk7 = reactive({ thermals: false, skyways: false });
let map: maplibregl.Map | null = null;
let marker: maplibregl.Marker | null = null;
let loaded = false;

/** Layer visibility from the buttons; before 'load' the style is not ready, the load handler applies it */
function applyVisibility() {
  if (!map || !loaded) return;
  for (const k of Object.keys(BASEMAPS)) map.setLayoutProperty(`base-${k}`, 'visibility', k === basemap.value ? 'visible' : 'none');
  for (const id of RELIEF_LAYERS) map.setLayoutProperty(id, 'visibility', basemap.value === 'relief' ? 'visible' : 'none');
  if (basemap.value === 'relief') void loadOsm();
  map.setLayoutProperty('labels', 'visibility', labels.value ? 'visible' : 'none');
  map.setLayoutProperty('kk7-thermals', 'visibility', kk7.thermals ? 'visible' : 'none');
  map.setLayoutProperty('kk7-skyways', 'visibility', kk7.skyways ? 'visible' : 'none');
}

function style(): StyleSpecification {
  const sources: StyleSpecification['sources'] = {};
  for (const [k, b] of Object.entries(BASEMAPS)) {
    sources[k] = { type: 'raster', tiles: [...b.tiles], tileSize: 256, attribution: b.attribution, maxzoom: b.maxzoom };
  }
  sources.labels = {
    type: 'raster',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    attribution: 'Esri, HERE',
  };
  sources.dem = {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 14,
    attribution: 'Terrain Tiles (Mapzen/AWS)',
  };
  // own source for the relief: MapLibre advises against sharing one DEM source between terrain and hillshade
  sources.demRelief = { ...sources.dem, attribution: 'Terrain Tiles (Mapzen/AWS)' };
  for (const [id, max] of [['thermals', 12], ['skyways', 13]] as const) {
    sources[`kk7-${id}`] = {
      type: 'raster', scheme: 'tms', tileSize: 256, maxzoom: max,
      tiles: [`https://thermal.kk7.ch/tiles/${id}_all_all/{z}/{x}/{y}.png?src=${KK7_SRC}`],
      attribution: '<a href="https://thermal.kk7.ch" target="_blank">thermal.kk7.ch</a> <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank">CC BY-NC-SA</a>',
    };
  }
  sources.osm = { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© OpenStreetMap' };
  const rv = basemap.value === 'relief' ? ('visible' as const) : ('none' as const);
  return {
    version: 8,
    sources,
    layers: [
      ...Object.keys(BASEMAPS).map((k) => ({
        id: `base-${k}`,
        type: 'raster' as const,
        source: k,
        layout: { visibility: k === basemap.value ? ('visible' as const) : ('none' as const) },
      })),
      {
        id: 'relief-color', type: 'color-relief' as const, source: 'demRelief', layout: { visibility: rv },
        paint: { 'color-relief-color': ['interpolate', ['linear'], ['elevation'], ...RELIEF_STOPS.flat()] as never },
      },
      {
        id: 'relief-shade', type: 'hillshade' as const, source: 'demRelief', layout: { visibility: rv },
        paint: { 'hillshade-shadow-color': '#3a2d22', 'hillshade-highlight-color': 'rgba(255,255,255,0.35)', 'hillshade-exaggeration': 0.5, 'hillshade-illumination-direction': 315 },
      },
      { id: 'osm-water', type: 'fill' as const, source: 'osm', filter: ['==', ['get', 'kind'], 'water'], layout: { visibility: rv },
        paint: { 'fill-color': '#7fb3dc', 'fill-outline-color': '#5b97c9' } },
      { id: 'osm-river', type: 'line' as const, source: 'osm', filter: ['==', ['get', 'kind'], 'river'], layout: { visibility: rv },
        paint: { 'line-color': '#5b97c9', 'line-width': 1.6 } },
      { id: 'osm-road', type: 'line' as const, source: 'osm', filter: ['==', ['get', 'kind'], 'road'], layout: { visibility: rv, 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['case', ['<=', ['get', 'rank'], 1], 'rgba(255,236,170,.95)', 'rgba(255,255,255,.85)'], 'line-width': ['-', 2.6, ['*', 0.45, ['get', 'rank']]] } },
      { id: 'osm-border', type: 'line' as const, source: 'osm', filter: ['==', ['get', 'kind'], 'border'], layout: { visibility: rv },
        paint: { 'line-color': 'rgba(255,255,255,.9)', 'line-width': ['case', ['==', ['get', 'rank'], 0], 2.2, 1.4], 'line-dasharray': [4, 3] } },
      { id: 'kk7-skyways', type: 'raster' as const, source: 'kk7-skyways', layout: { visibility: kk7.skyways ? ('visible' as const) : ('none' as const) },
        paint: { 'raster-opacity': 0.8 } },
      { id: 'kk7-thermals', type: 'raster' as const, source: 'kk7-thermals', layout: { visibility: kk7.thermals ? ('visible' as const) : ('none' as const) },
        paint: { 'raster-opacity': 0.75 } },
      { id: 'labels', type: 'raster' as const, source: 'labels', layout: { visibility: labels.value ? ('visible' as const) : ('none' as const) } },
    ],
  };
}

let osmLoading = false;
/** OSM water, roads and borders around the track, loaded once the relief map is first shown */
async function loadOsm() {
  if (osmLoading || !map) return;
  osmLoading = true;
  const tl = props.result.timeline;
  let w = 180, e = -180, s = 90, n = -90;
  for (let i = 0; i < tl.t.length; i++) {
    w = Math.min(w, tl.lon[i]); e = Math.max(e, tl.lon[i]);
    s = Math.min(s, tl.lat[i]); n = Math.max(n, tl.lat[i]);
  }
  const mx = Math.max(0.05, (e - w) * 0.25), my = Math.max(0.04, (n - s) * 0.25);
  try {
    const lines: OsmLine[] = await loadOsmLines({ west: w - mx, east: e + mx, south: s - my, north: n + my });
    const features = lines.map((l): GeoJSON.Feature => ({
      type: 'Feature',
      properties: { kind: l.kind, rank: l.rank },
      geometry: l.kind === 'water' ? { type: 'Polygon', coordinates: [l.coords] } : { type: 'LineString', coordinates: l.coords },
    }));
    (map?.getSource('osm') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  } catch (err) {
    console.warn('OSM lines for the relief map not available', err);
    osmLoading = false;
  }
}

function trackGeoJSON(): GeoJSON.FeatureCollection {
  const tl = props.result.timeline;
  const n = tl.t.length;
  const features: GeoJSON.Feature[] = [];
  const connectors: GeoJSON.Feature[] = [];
  let coords: [number, number][] = [];
  let color = '';
  const isHike = (i: number) => props.result.segments[tl.seg[i]].kind === 'hike';
  const push = () => {
    if (coords.length > 1) features.push({ type: 'Feature', properties: { c: color }, geometry: { type: 'LineString', coordinates: coords } });
  };
  for (let i = 0; i < n; i++) {
    const p: [number, number] = [tl.lon[i], tl.lat[i]];
    if (i > 0 && tl.seg[i] !== tl.seg[i - 1]) {
      push();
      connectors.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [coords[coords.length - 1], p] } });
      coords = [];
    }
    const c = colorBucket(props.colorMode, tl.mode[i], tl.vario[i], tl.speed[i], isHike(i));
    if (c !== color && coords.length) {
      coords.push(p);
      push();
      coords = [p];
    } else coords.push(p);
    color = c;
  }
  push();
  return { type: 'FeatureCollection', features: [...features, ...connectors.map((f) => ({ ...f, properties: { connector: true } }))] };
}

function scoreGeoJSON(): GeoJSON.FeatureCollection {
  const sc = props.score;
  if (!sc) return { type: 'FeatureCollection', features: [] };
  const tp = sc.turnpoints.map((p) => [p.lon, p.lat] as [number, number]);
  const features: GeoJSON.Feature[] = [];
  if (sc.code === 'od') {
    const line = [sc.start, ...sc.turnpoints, sc.finish].filter(Boolean).map((p) => [p!.lon, p!.lat]);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
  } else if (tp.length) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...tp, tp[0]] } });
    if (sc.closing) {
      features.push({
        type: 'Feature',
        properties: { closing: true },
        geometry: { type: 'LineString', coordinates: [[sc.closing.in.lon, sc.closing.in.lat], [sc.closing.out.lon, sc.closing.out.lat]] },
      });
    }
  }
  sc.turnpoints.forEach((p, i) =>
    features.push({ type: 'Feature', properties: { label: `TP${i + 1}` }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }),
  );
  return { type: 'FeatureCollection', features };
}

function thermalGeoJSON(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = props.result.segments.flatMap((s) =>
    s.thermals.map((t) => ({
      type: 'Feature' as const,
      properties: { gain: t.gain, label: `+${t.avgClimb.toFixed(1)}` },
      geometry: { type: 'Point' as const, coordinates: [t.lon, t.lat] },
    })),
  );
  return { type: 'FeatureCollection', features };
}

function endpointsGeoJSON(): GeoJSON.FeatureCollection {
  const tl = props.result.timeline;
  const features: GeoJSON.Feature[] = props.result.segments.flatMap((s) => {
    const a = s.offset;
    const b = s.offset + s.length - 1;
    const isFlight = s.kind === 'flight';
    return [
      { type: 'Feature' as const, properties: { label: isFlight ? 'Start' : 'Aufbruch', kind: s.kind }, geometry: { type: 'Point' as const, coordinates: [tl.lon[a], tl.lat[a]] } },
      { type: 'Feature' as const, properties: { label: isFlight ? 'Landung' : 'Ziel', kind: s.kind }, geometry: { type: 'Point' as const, coordinates: [tl.lon[b], tl.lat[b]] } },
    ];
  });
  return { type: 'FeatureCollection', features };
}

function fit() {
  const tl = props.result.timeline;
  let w = 180, s = 90, e = -180, nn = -90;
  for (let i = 0; i < tl.t.length; i++) {
    w = Math.min(w, tl.lon[i]); e = Math.max(e, tl.lon[i]);
    s = Math.min(s, tl.lat[i]); nn = Math.max(nn, tl.lat[i]);
  }
  map?.fitBounds([[w, s], [e, nn]], { padding: { top: 60, left: 40, right: 60, bottom: 40 + (props.padBottom ?? 0) }, duration: 0 });
}

onMounted(() => {
  map = new maplibregl.Map({ container: el.value!, style: style(), attributionControl: { compact: true }, maxPitch: 80,
    // the map spans the page: the wheel scrolls the page, Ctrl+wheel or two fingers move the map
    cooperativeGestures: true,
    locale: i18n.lang === 'de' ? {
      'CooperativeGesturesHandler.WindowsHelpText': 'Strg + Mausrad zoomt die Karte',
      'CooperativeGesturesHandler.MacHelpText': '⌘ + Mausrad zoomt die Karte',
      'CooperativeGesturesHandler.MobileHelpText': 'Mit zwei Fingern die Karte bewegen',
    } : undefined });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'top-right');
  fit();
  map.on('load', () => {
    if (!map) return;
    loaded = true;
    applyVisibility();
    if (terrain.value) applyTerrain(true);
    map.addSource('track', { type: 'geojson', data: trackGeoJSON() });
    map.addSource('score', { type: 'geojson', data: scoreGeoJSON() });
    map.addSource('thermals', { type: 'geojson', data: thermalGeoJSON() });
    map.addSource('ends', { type: 'geojson', data: endpointsGeoJSON() });
    map.addLayer({ id: 'score-line', type: 'line', source: 'score', filter: ['==', '$type', 'LineString'],
      paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
    map.addLayer({ id: 'track-casing', type: 'line', source: 'track', filter: ['!has', 'connector'],
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0d1311', 'line-width': 5, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'track-line', type: 'line', source: 'track', filter: ['!has', 'connector'],
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': 3 } });
    map.addLayer({ id: 'connector', type: 'line', source: 'track', filter: ['has', 'connector'],
      paint: { 'line-color': '#cfd8dc', 'line-width': 2, 'line-dasharray': [1, 2] } });
    map.addLayer({ id: 'thermals', type: 'circle', source: 'thermals',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'gain'], 30, 4, 1000, 12], 'circle-color': '#ffb300',
        'circle-opacity': 0.35, 'circle-stroke-color': '#ffb300', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'tp', type: 'circle', source: 'score', filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#0d1311', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'ends', type: 'circle', source: 'ends',
      paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'kind'], 'hike', '#8bc34a', '#ff8a3d'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    // hover on track → nearest timeline index
    map.on('mousemove', 'track-line', (e: MapLayerMouseEvent) => emit('hover', nearest(e.lngLat.lng, e.lngLat.lat)));
    map.on('mouseleave', 'track-line', () => emit('hover', null));
  });
  const dot = document.createElement('div');
  dot.className = 'hover-dot';
  marker = new maplibregl.Marker({ element: dot });
});

function nearest(lon: number, lat: number): number {
  const tl = props.result.timeline;
  const k = Math.cos((lat * Math.PI) / 180);
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < tl.t.length; i++) {
    const d = ((tl.lon[i] - lon) * k) ** 2 + (tl.lat[i] - lat) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

onUnmounted(() => map?.remove());

watch(() => props.colorMode, () => (map?.getSource('track') as GeoJSONSource | undefined)?.setData(trackGeoJSON()));
watch(() => props.score, () => (map?.getSource('score') as GeoJSONSource | undefined)?.setData(scoreGeoJSON()));
watch(() => props.hoverIdx, (i) => {
  if (!map || !marker) return;
  if (i == null) marker.remove();
  else marker.setLngLat([props.result.timeline.lon[i], props.result.timeline.lat[i]]).addTo(map);
});
watch([basemap, labels, () => kk7.thermals, () => kk7.skyways], applyVisibility);
watch(terrain, applyTerrain);
function applyTerrain(on: boolean) {
  if (!map || !loaded) return;
  map.setTerrain(on ? { source: 'dem', exaggeration: 1.3 } : null);
  map.easeTo({ pitch: on ? 60 : 0, duration: 800 });
}
</script>

<template>
  <div class="wrap">
    <div ref="el" class="map" />
    <div class="controls">
      <button v-for="(b, k) in BASEMAPS" :key="k" :class="{ active: basemap === k }" :aria-pressed="basemap === k" @click="basemap = k">{{ t(b.label) }}</button>
      <button :class="{ active: basemap === 'relief' }" :aria-pressed="basemap === 'relief'" @click="basemap = 'relief'">{{ t('Relief') }}</button>
      <button :class="{ active: labels }" :aria-pressed="labels" @click="labels = !labels">{{ t('Beschriftung') }}</button>
      <button :class="{ active: terrain }" :aria-pressed="terrain" @click="terrain = !terrain">{{ t('3D-Gelände') }}</button>
      <button :class="{ active: kk7.thermals }" :aria-pressed="kk7.thermals" :title="t('Wo Thermik häufig ausgelöst wird, aus Hunderttausenden Flügen (thermal.kk7.ch)')" @click="kk7.thermals = !kk7.thermals">{{ t('Thermik-Hotspots') }}</button>
      <button :class="{ active: kk7.skyways }" :aria-pressed="kk7.skyways" :title="t('Wo Piloten häufig im Geradeausflug unterwegs sind (thermal.kk7.ch)')" @click="kk7.skyways = !kk7.skyways">{{ t('Skyways') }}</button>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; }
.map { height: 460px; border-radius: var(--radius) var(--radius) 0 0; overflow: hidden; }
.controls { position: absolute; top: 10px; left: 10px; right: 60px; display: flex; flex-wrap: wrap; gap: 6px; }
.controls button { padding: 4px 10px; font-size: 13px; background: rgba(27, 36, 33, .82); border-color: rgba(241, 240, 234, .28); backdrop-filter: blur(4px); }
.controls button.active { background: var(--snow); color: var(--ground); border-color: var(--snow); }
:global(.hover-dot) {
  width: 14px; height: 14px; border-radius: 50%; background: var(--snow); border: 3px solid var(--accent);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, .35);
}
@media (max-width: 800px) {
  .map { height: 340px; }
  /* one scrollable row of map buttons, so they do not cover the map */
  .controls { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; right: 52px; }
  .controls button { flex: 0 0 auto; }
}
</style>
