<script setup lang="ts">
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { colorBucket, type ColorMode } from '../app/colors';
import type { ActivityResult } from '../app/types';
import type { XcScore } from '../core';
import { t } from '../app/i18n';

const props = defineProps<{
  result: ActivityResult;
  colorMode: ColorMode;
  hoverIdx: number | null;
  score?: XcScore;
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
type Basemap = keyof typeof BASEMAPS;

const el = ref<HTMLDivElement>();
const basemap = ref<Basemap>('satellite');
const terrain = ref(false);
const labels = ref(false);
let map: maplibregl.Map | null = null;
let marker: maplibregl.Marker | null = null;
let loaded = false;

/** Layer visibility from the buttons; before 'load' the style is not ready, the load handler applies it */
function applyVisibility() {
  if (!map || !loaded) return;
  for (const k of Object.keys(BASEMAPS)) map.setLayoutProperty(`base-${k}`, 'visibility', k === basemap.value ? 'visible' : 'none');
  map.setLayoutProperty('labels', 'visibility', labels.value ? 'visible' : 'none');
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
      { id: 'labels', type: 'raster' as const, source: 'labels', layout: { visibility: labels.value ? ('visible' as const) : ('none' as const) } },
    ],
  };
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
  map?.fitBounds([[w, s], [e, nn]], { padding: 40, duration: 0 });
}

onMounted(() => {
  map = new maplibregl.Map({ container: el.value!, style: style(), attributionControl: { compact: true }, maxPitch: 80 });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
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
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'track-line', type: 'line', source: 'track', filter: ['!has', 'connector'],
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': 3 } });
    map.addLayer({ id: 'connector', type: 'line', source: 'track', filter: ['has', 'connector'],
      paint: { 'line-color': '#cfd8dc', 'line-width': 2, 'line-dasharray': [1, 2] } });
    map.addLayer({ id: 'thermals', type: 'circle', source: 'thermals',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'gain'], 30, 4, 1000, 12], 'circle-color': '#ffb300',
        'circle-opacity': 0.35, 'circle-stroke-color': '#ffb300', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'tp', type: 'circle', source: 'score', filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#000', 'circle-stroke-width': 2 } });
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
watch([basemap, labels], applyVisibility);
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
      <button v-for="(b, k) in BASEMAPS" :key="k" :class="{ active: basemap === k }" @click="basemap = k">{{ t(b.label) }}</button>
      <button :class="{ active: labels }" @click="labels = !labels">{{ t('Beschriftung') }}</button>
      <button :class="{ active: terrain }" @click="terrain = !terrain">{{ t('3D-Gelände') }}</button>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; }
.map { height: 460px; border-radius: var(--radius) var(--radius) 0 0; overflow: hidden; }
.controls { position: absolute; top: 10px; left: 10px; right: 60px; display: flex; flex-wrap: wrap; gap: 6px; }
.controls button { padding: 4px 10px; font-size: 13px; background: rgba(13, 17, 23, .85); }
.controls button.active { background: var(--accent); }
:global(.hover-dot) {
  width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 3px solid var(--accent);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, .35);
}
@media (max-width: 800px) { .map { height: 340px; } }
</style>
