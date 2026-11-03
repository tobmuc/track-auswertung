/**
 * Ground elevation along the track, for height above ground (AGL).
 * Sources:
 *  - terrarium: AWS Terrarium tiles (no key, ~30 m in the Alps, coarser elsewhere)
 *  - opentopo: OpenTopography Global DEM API (COP30, SRTM, NASADEM …), needs a free API key.
 *    Fetched in 0.25° tiles along the track only and cached in IndexedDB.
 *  - file: DEM files imported by the user (.asc AAIGrid, .hgt SRTM, .tif GeoTIFF)
 * Points not covered by the chosen source fall back to Terrarium.
 */
import { fromArrayBuffer } from 'geotiff';
import { reactive, watch } from 'vue';
import { db } from './db';
import { i18n, t } from './i18n';
import type { ActivityResult, Timeline } from './types';

export type GroundSource = 'terrarium' | 'opentopo' | 'file';

export const OPENTOPO_DEMS = {
  COP30: 'Copernicus GLO-30 (30 m)',
  NASADEM: 'NASADEM (30 m)',
  SRTMGL1: 'SRTM GL1 (30 m)',
  AW3D30: 'ALOS World 3D (30 m)',
  COP90: 'Copernicus GLO-90 (90 m)',
  SRTMGL3: 'SRTM GL3 (90 m)',
} as const;
export type OpenTopoDem = keyof typeof OPENTOPO_DEMS;

export const SOURCE_LABEL: Record<GroundSource, string> = {
  terrarium: 'Terrain Tiles (AWS)',
  opentopo: 'OpenTopography',
  file: 'Eigene DEM-Dateien',
};

const STORE_KEY = 'ground-settings';
function loadSettings() {
  const d = { source: 'terrarium' as GroundSource, dem: 'COP30' as OpenTopoDem, apiKey: '' };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
  } catch {
    return d;
  }
}
/** Shared, persisted ground settings (dashboard and 3D video use the same) */
export const groundSettings = reactive(loadSettings());
watch(groundSettings, (s) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode: keep in memory */
  }
});

/** Regular lat/lon grid, row 0 = north edge, cell centres at west + (i + .5)·cell */
export interface DemGrid {
  west: number;
  north: number;
  /** cell size in degrees (x, y) */
  dx: number;
  dy: number;
  ncols: number;
  nrows: number;
  data: Float32Array;
}

export function sampleGrid(g: DemGrid, lat: number, lon: number): number {
  const fx = (lon - g.west) / g.dx - 0.5;
  const fy = (g.north - lat) / g.dy - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > g.ncols - 0.5 || fy > g.nrows - 0.5) return NaN;
  const x = Math.min(g.ncols - 1.001, Math.max(0, fx));
  const y = Math.min(g.nrows - 1.001, Math.max(0, fy));
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const ax = x - ix;
  const ay = y - iy;
  const k = iy * g.ncols + ix;
  const d = g.data;
  const v = d[k] * (1 - ax) * (1 - ay) + d[k + 1] * ax * (1 - ay) + d[k + g.ncols] * (1 - ax) * ay + d[k + g.ncols + 1] * ax * ay;
  // nodata (−9999, −32768) or NaN anywhere in the cell → unknown
  return v > -1000 ? v : NaN;
}

// ---------------------------------------------------------------- parsers

/** ESRI ASCII grid (.asc), e.g. OpenTopography "AAIGrid" downloads */
export function parseAsc(text: string): DemGrid {
  const head: Record<string, number> = {};
  let pos = 0;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    const line = text.slice(pos, nl < 0 ? undefined : nl).trim();
    const m = /^([a-z_]+)\s+(-?[\d.eE+-]+)$/i.exec(line);
    if (!m) break;
    head[m[1].toLowerCase()] = Number(m[2]);
    pos = nl + 1;
  }
  const ncols = head.ncols;
  const nrows = head.nrows;
  const cell = head.cellsize;
  if (!ncols || !nrows || !cell) throw new Error(t('Keine gültige ASCII-Grid-Datei (.asc)'));
  const nodata = head.nodata_value ?? -9999;
  const data = new Float32Array(ncols * nrows);
  let k = 0;
  const re = /-?[\d.]+(?:[eE][+-]?\d+)?/g;
  re.lastIndex = pos;
  for (let m = re.exec(text); m && k < data.length; m = re.exec(text)) {
    const v = Number(m[0]);
    data[k++] = v === nodata ? -32768 : v;
  }
  const west = head.xllcorner ?? head.xllcenter - cell / 2;
  const south = head.yllcorner ?? head.yllcenter - cell / 2;
  return { west, north: south + nrows * cell, dx: cell, dy: cell, ncols, nrows, data };
}

/** SRTM .hgt (big-endian int16, 1° tile named like N46E007.hgt, 1201² or 3601² samples) */
export function parseHgt(buf: ArrayBuffer, name: string): DemGrid {
  const m = /([NS])(\d{2})([EW])(\d{3})/i.exec(name);
  if (!m) throw new Error(t('HGT-Dateiname muss die Kachel enthalten, z. B. N46E007.hgt'));
  const lat = Number(m[2]) * (m[1].toUpperCase() === 'S' ? -1 : 1);
  const lon = Number(m[4]) * (m[3].toUpperCase() === 'W' ? -1 : 1);
  const n = Math.round(Math.sqrt(buf.byteLength / 2));
  const view = new DataView(buf);
  const data = new Float32Array(n * n);
  for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, false);
  // samples sit on the grid lines: treat them as cell centres of a grid half a cell larger
  const cell = 1 / (n - 1);
  return { west: lon - cell / 2, north: lat + 1 + cell / 2, dx: cell, dy: cell, ncols: n, nrows: n, data };
}

/** GeoTIFF in geographic coordinates (EPSG:4326), as delivered by OpenTopography */
export async function parseTiff(buf: ArrayBuffer): Promise<DemGrid> {
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  let [west, , , north] = img.getBoundingBox();
  const [rx, ry] = img.getResolution();
  if (Math.abs(rx) > 1) throw new Error(t('GeoTIFF muss in Grad (WGS84) vorliegen'));
  // PixelIsPoint (e.g. Copernicus DEM): the tie point is a cell centre, not the cell corner
  if (img.getGeoKeys()?.GTRasterTypeGeoKey === 2) {
    west -= Math.abs(rx) / 2;
    north += Math.abs(ry) / 2;
  }
  const ncols = img.getWidth();
  const nrows = img.getHeight();
  const nodata = img.getGDALNoData();
  const [band] = (await img.readRasters({ samples: [0] })) as unknown as ArrayLike<number>[];
  const data = Float32Array.from(band, (v) => (v === nodata ? -32768 : v));
  return { west, north, dx: Math.abs(rx), dy: Math.abs(ry), ncols, nrows, data };
}

export async function parseDemFile(file: File): Promise<DemGrid> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.asc')) return parseAsc(await file.text());
  if (name.endsWith('.hgt')) return parseHgt(await file.arrayBuffer(), file.name);
  if (name.endsWith('.tif') || name.endsWith('.tiff')) return parseTiff(await file.arrayBuffer());
  throw new Error(t('Unterstützt: .asc (ASCII-Grid), .hgt (SRTM), .tif (GeoTIFF, WGS84)'));
}

// ---------------------------------------------------------------- OpenTopography

/** Tile size for API requests; aligned to the grid so tiles are shared between flights */
const OT_TILE = 0.25;

async function openTopoTile(dem: OpenTopoDem, apiKey: string, tx: number, ty: number): Promise<DemGrid> {
  const key = `${dem}/${tx}/${ty}`;
  const hit = await db.dem.get(key);
  if (hit) return hit.grid;
  const south = ty * OT_TILE;
  const west = tx * OT_TILE;
  const url =
    `https://portal.opentopography.org/API/globaldem?demtype=${dem}` +
    `&south=${south}&north=${south + OT_TILE}&west=${west}&east=${west + OT_TILE}&outputFormat=GTiff&API_Key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  // errors come back as text with status 200 or 4xx
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  const isTiff = (head[0] === 0x49 && head[1] === 0x49) || (head[0] === 0x4d && head[1] === 0x4d);
  if (!res.ok || !isTiff) {
    const msg = new TextDecoder().decode(buf.slice(0, 300)).replace(/<[^>]+>/g, ' ').trim();
    throw new Error(`OpenTopography: ${msg || res.statusText}`);
  }
  const grid = await parseTiff(buf);
  await db.dem.put({ key, grid, createdAt: Date.now() });
  return grid;
}

// ---------------------------------------------------------------- Terrarium

const TERRARIUM_Z = 12;
const terrariumTiles = new Map<string, Promise<Float32Array | null>>();

function terrariumTile(x: number, y: number): Promise<Float32Array | null> {
  const k = `${x}/${y}`;
  let p = terrariumTiles.get(k);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TERRARIUM_Z}/${x}/${y}.png`);
        if (!res.ok) return null;
        const bmp = await createImageBitmap(await res.blob());
        const c = new OffscreenCanvas(256, 256);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, 256, 256).data;
        const h = new Float32Array(256 * 256);
        for (let i = 0; i < h.length; i++) h[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        return h;
      } catch {
        return null;
      }
    })();
    terrariumTiles.set(k, p);
  }
  return p;
}

function mercPx(lat: number, lon: number): [number, number] {
  const n = 256 * 2 ** TERRARIUM_Z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

async function terrariumAt(lats: ArrayLike<number>, lons: ArrayLike<number>, idx: number[], out: Float32Array, onTile: (done: number, total: number) => void) {
  const need = new Set<string>();
  for (const i of idx) {
    const [px, py] = mercPx(lats[i], lons[i]);
    // bilinear sampling may reach into the neighbour tile
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) need.add(`${Math.floor((px + dx) / 256)}/${Math.floor((py + dy) / 256)}`);
  }
  let done = 0;
  const tiles = new Map<string, Float32Array | null>();
  await Promise.all(
    [...need].map(async (k) => {
      const [x, y] = k.split('/').map(Number);
      tiles.set(k, await terrariumTile(x, y));
      onTile(++done, need.size);
    }),
  );
  const at = (gx: number, gy: number) => {
    const t = tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
    return t ? t[(gy % 256) * 256 + (gx % 256)] : NaN;
  };
  for (const i of idx) {
    const [px, py] = mercPx(lats[i], lons[i]);
    const x = px - 0.5;
    const y = py - 0.5;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    out[i] = at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) + at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
  }
}

// ---------------------------------------------------------------- ground along the track

export interface GroundProfile {
  /** ground elevation m MSL per timeline point (NaN = unknown) */
  ground: Float32Array;
  /** what was actually used, e.g. "OpenTopography COP30" or "… + Terrain Tiles (AWS)" */
  label: string;
  warning?: string;
}

export type Progress = (label: string, done: number, total: number) => void;

const profileCache = new Map<string, Promise<GroundProfile>>();

/** Ground under every timeline point for the current settings (cached per activity + settings) */
export function groundProfile(cacheKey: string, tl: Timeline, onProgress?: Progress): Promise<GroundProfile> {
  const s = { ...groundSettings };
  const key = `${cacheKey}|${s.source}|${s.source === 'opentopo' ? s.dem : ''}|${i18n.lang}`;
  let p = profileCache.get(key);
  if (!p) {
    p = computeGround(tl, s, onProgress);
    p.catch(() => profileCache.delete(key));
    profileCache.set(key, p);
  }
  return p;
}

/** Forget cached profiles, e.g. after importing DEM files */
export function clearGroundCache() {
  profileCache.clear();
}

async function computeGround(tl: Timeline, s: typeof groundSettings, onProgress?: Progress): Promise<GroundProfile> {
  const n = tl.t.length;
  const ground = new Float32Array(n).fill(NaN);
  let label: string = SOURCE_LABEL.terrarium;
  let warning: string | undefined;

  if (s.source === 'opentopo') {
    label = `OpenTopography ${s.dem}`;
    if (!s.apiKey) {
      warning = t('Kein OpenTopography-API-Key eingetragen – verwende Terrain Tiles (AWS).');
    } else {
      const tiles = new Map<string, number[]>();
      for (let i = 0; i < n; i++) {
        const k = `${Math.floor(tl.lon[i] / OT_TILE)}/${Math.floor(tl.lat[i] / OT_TILE)}`;
        let list = tiles.get(k);
        if (!list) tiles.set(k, (list = []));
        list.push(i);
      }
      let done = 0;
      const keys = [...tiles.keys()];
      const errors: string[] = [];
      onProgress?.(`${t('Lade Höhenmodell')} ${s.dem} (OpenTopography)`, 0, keys.length);
      // the API is slow (~10 s per tile): a few requests in parallel
      const queue = [...keys];
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          for (let k = queue.shift(); k; k = queue.shift()) {
            const [tx, ty] = k.split('/').map(Number);
            try {
              const g = await openTopoTile(s.dem, s.apiKey, tx, ty);
              for (const i of tiles.get(k)!) ground[i] = sampleGrid(g, tl.lat[i], tl.lon[i]);
            } catch (e) {
              errors.push(e instanceof Error ? e.message : String(e));
            }
            onProgress?.(`${t('Lade Höhenmodell')} ${s.dem} (OpenTopography)`, ++done, keys.length);
          }
        }),
      );
      if (errors.length) warning = `${errors.length} ${t('von')} ${keys.length} ${t('Kacheln fehlen')} (${errors[0]}). ${t('Lücken mit Terrain Tiles (AWS) gefüllt.')}`;
    }
  } else if (s.source === 'file') {
    label = t(SOURCE_LABEL.file);
    const files = await db.demFiles.toArray();
    if (!files.length) warning = t('Keine DEM-Dateien importiert – verwende Terrain Tiles (AWS).');
    // finest grid first
    files.sort((a, b) => a.grid.dx - b.grid.dx);
    for (let i = 0; i < n; i++) {
      for (const f of files) {
        const v = sampleGrid(f.grid, tl.lat[i], tl.lon[i]);
        if (!Number.isNaN(v)) {
          ground[i] = v;
          break;
        }
      }
    }
  }

  const missing: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isNaN(ground[i])) missing.push(i);
  if (missing.length) {
    if (missing.length < n) {
      label += ` + ${SOURCE_LABEL.terrarium}`;
      if (s.source === 'file' && !warning) warning = `${Math.round((missing.length / n) * 100)} % ${t('des Tracks liegen ausserhalb der DEM-Dateien – dort Terrain Tiles (AWS).')}`;
    } else label = SOURCE_LABEL.terrarium;
    await terrariumAt(tl.lat, tl.lon, missing, ground, (d, tot) => onProgress?.(t('Lade Terrain Tiles'), d, tot));
  }
  return { ground, label, warning };
}

// ---------------------------------------------------------------- statistics

export interface AglStats {
  minAgl: number;
  maxAgl: number;
  avgAgl: number;
  /** time below 150 m AGL, excluding the first and last minute (launch, landing approach) */
  lowS: number;
  launchGround: number;
  landingGround: number;
  /** GPS altitude at landing minus ground: an offset hint for the altimeter / GPS */
  landingOffset: number;
}

export const LOW_AGL = 150;

export function aglStats(res: ActivityResult, ground: Float32Array): AglStats | null {
  const seg = res.segments.find((s) => s.kind === 'flight');
  if (!seg) return null;
  const tl = res.timeline;
  const a = seg.offset;
  const b = seg.offset + seg.length - 1;
  let min = Infinity, max = -Infinity, sum = 0, w = 0, low = 0;
  for (let i = a + 1; i <= b; i++) {
    const g = ground[i];
    if (Number.isNaN(g)) continue;
    const agl = tl.alt[i] - g;
    const dt = (tl.t[i] - tl.t[i - 1]) / 1000;
    const inner = tl.t[i] - tl.t[a] > 60_000 && tl.t[b] - tl.t[i] > 60_000;
    if (inner) {
      min = Math.min(min, agl);
      if (agl < LOW_AGL) low += dt;
    }
    max = Math.max(max, agl);
    sum += agl * dt;
    w += dt;
  }
  if (!w) return null;
  return {
    minAgl: Number.isFinite(min) ? min : 0,
    maxAgl: max,
    avgAgl: sum / w,
    lowS: low,
    launchGround: ground[a],
    landingGround: ground[b],
    landingOffset: tl.alt[b] - ground[b],
  };
}
