/**
 * Terrain model from web tiles:
 *  - elevation: AWS Terrarium tiles (h = R*256 + G + B/256 - 32768)
 *  - texture: one of MAP_SOURCES draped over it (loaded separately), or a shaded plaster relief
 * Everything lives in a local metric frame: x = east, z = -north (three.js convention), y = up.
 */

import { drawOsm, loadOsmLines, shadeRelief } from '../app/relief';

const R = 6378137;
const RAD = Math.PI / 180;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export class LocalFrame {
  readonly kx: number;
  readonly ky = RAD * R;
  constructor(readonly lat0: number, readonly lon0: number) {
    this.kx = RAD * R * Math.cos(lat0 * RAD);
  }
  /** [x (east m), z (-north m)] */
  toXZ(lat: number, lon: number): [number, number] {
    return [(lon - this.lon0) * this.kx, -(lat - this.lat0) * this.ky];
  }
  toLatLon(x: number, z: number): [number, number] {
    return [this.lat0 - z / this.ky, this.lon0 + x / this.kx];
  }
}

/** Fractional global pixel coordinates of Web Mercator at zoom z (256 px tiles) */
function mercPx(lat: number, lon: number, z: number): [number, number] {
  const n = 256 * 2 ** z;
  const s = Math.sin(lat * RAD);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

interface Mosaic {
  z: number;
  x0: number; // first tile x
  y0: number;
  w: number; // pixels
  h: number;
  canvas: OffscreenCanvas;
}

async function loadImage(url: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

/** Picks the largest zoom where the bounds need at most `maxTiles` tiles across */
function pickZoom(b: Bounds, maxTiles: number, maxZoom: number): number {
  for (let z = maxZoom; z > 1; z--) {
    const [x0, y0] = mercPx(b.north, b.west, z);
    const [x1, y1] = mercPx(b.south, b.east, z);
    if (Math.max(x1 - x0, y1 - y0) / 256 <= maxTiles) return z;
  }
  return 2;
}

type TileUrl = (z: number, x: number, y: number) => string;

async function mosaic(b: Bounds, z: number, url: TileUrl | TileUrl[], onTile: () => void): Promise<Mosaic> {
  const layers = Array.isArray(url) ? url : [url];
  const [px0, py0] = mercPx(b.north, b.west, z);
  const [px1, py1] = mercPx(b.south, b.east, z);
  const x0 = Math.floor(px0 / 256);
  const y0 = Math.floor(py0 / 256);
  const x1 = Math.floor(px1 / 256);
  const y1 = Math.floor(py1 / 256);
  const w = (x1 - x0 + 1) * 256;
  const h = (y1 - y0 + 1) * 256;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const jobs: Promise<void>[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      // layers of one tile are drawn in order (base first, then overlays)
      jobs.push(
        Promise.all(layers.map((u) => loadImage(u(z, tx, ty)))).then((imgs) => {
          for (const img of imgs) if (img) ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256, 256, 256);
          onTile();
        }),
      );
    }
  }
  await Promise.all(jobs);
  return { z, x0, y0, w, h, canvas };
}

export interface TerrainOptions {
  /** vertices along the longer side */
  resolution?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface Terrain {
  frame: LocalFrame;
  bounds: Bounds;
  /** extent in local metres */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  nx: number;
  nz: number;
  /** heights (m MSL) row-major, row = z index (north → south) */
  heights: Float32Array;
  minH: number;
  maxH: number;
  heightAt(x: number, z: number): number;
}

/** Map image draped over the terrain */
export interface TerrainTexture {
  source: MapSourceId;
  canvas: OffscreenCanvas;
  /** uv of each terrain vertex into the canvas */
  uv: Float32Array;
}

const DEM_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const ESRI_IMAGERY: TileUrl = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const sub = (x: number, y: number) => 'abc'[(x + y) % 3];

export const MAP_SOURCES = {
  esri: { label: 'Satellit (Esri)', layers: [ESRI_IMAGERY], maxZoom: 17, attribution: 'Esri, Maxar, Earthstar Geographics' },
  esriLabels: {
    label: 'Satellit + Beschriftung',
    layers: [
      ESRI_IMAGERY,
      (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${z}/${y}/${x}`,
      (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
    ],
    maxZoom: 16,
    attribution: 'Esri, Maxar, Earthstar Geographics, HERE',
  },
  sentinel: {
    label: 'Sentinel-2 (wolkenfrei)',
    layers: [(z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${z}/${y}/${x}.jpg`],
    // 10 m pixels: beyond z14 there is no more detail
    maxZoom: 14,
    attribution: 'Sentinel-2 cloudless 2023 by EOX (CC BY-NC-SA 4.0)',
  },
  topo: {
    label: 'OpenTopoMap',
    layers: [(z, x, y) => `https://${sub(x, y)}.tile.opentopomap.org/${z}/${x}/${y}.png`],
    maxZoom: 15,
    attribution: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap',
  },
  osm: {
    label: 'OpenStreetMap',
    layers: [(z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`],
    maxZoom: 15,
    attribution: '© OpenStreetMap',
  },
  shaded: {
    label: 'Relief (Höhenfarben + OSM)',
    // computed here from the elevation tiles, see reliefTexture
    layers: [],
    maxZoom: 14,
    attribution: 'Terrain Tiles (AWS), © OpenStreetMap',
    generated: true,
  },
} satisfies Record<string, { label: string; layers: TileUrl[]; maxZoom: number; attribution: string; generated?: boolean }>;

export type MapSourceId = keyof typeof MAP_SOURCES;

function tileCount(b: Bounds, z: number) {
  const [x0, y0] = mercPx(b.north, b.west, z);
  const [x1, y1] = mercPx(b.south, b.east, z);
  return (Math.floor(x1 / 256) - Math.floor(x0 / 256) + 1) * (Math.floor(y1 / 256) - Math.floor(y0 / 256) + 1);
}

/** Loads a map mosaic for the terrain and computes the uv of every terrain vertex into it */
export async function loadTexture(
  t: Terrain,
  source: MapSourceId,
  opts: { textureTiles?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<TerrainTexture> {
  const src = MAP_SOURCES[source];
  const z = pickZoom(t.bounds, opts.textureTiles ?? 16, src.maxZoom);
  const total = tileCount(t.bounds, z);
  let done = 0;
  const m = 'generated' in src
    ? await reliefTexture(t.bounds, z, () => opts.onProgress?.(++done, total))
    : await mosaic(t.bounds, z, src.layers, () => opts.onProgress?.(++done, total));
  const uv = new Float32Array(t.nx * t.nz * 2);
  for (let j = 0; j < t.nz; j++) {
    const zz = t.minZ + ((t.maxZ - t.minZ) * j) / (t.nz - 1);
    for (let i = 0; i < t.nx; i++) {
      const x = t.minX + ((t.maxX - t.minX) * i) / (t.nx - 1);
      const [lat, lon] = t.frame.toLatLon(x, zz);
      const [sx, sy] = mercPx(lat, lon, m.z);
      const k = j * t.nx + i;
      uv[k * 2] = (sx - m.x0 * 256) / m.w;
      uv[k * 2 + 1] = 1 - (sy - m.y0 * 256) / m.h;
    }
  }
  return { source, canvas: m.canvas, uv };
}

/**
 * Relief map at zoom z: elevation tiles coloured by height and hillshaded, then OSM water, roads and
 * borders drawn on top (left out when Overpass is not reachable).
 */
async function reliefTexture(b: Bounds, z: number, onTile: () => void): Promise<Mosaic> {
  const m = await mosaic(b, z, DEM_URL, onTile);
  const g = m.canvas.getContext('2d')!;
  const img = g.getImageData(0, 0, m.w, m.h);
  const px = img.data;
  const h = new Float32Array(m.w * m.h);
  for (let i = 0; i < h.length; i++) h[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  const midLat = (b.north + b.south) / 2;
  // the 3D scene adds its own sun lighting: a light touch of shading is enough
  shadeRelief(h, m.w, m.h, (2 * Math.PI * R * Math.cos(midLat * RAD)) / (256 * 2 ** z), px, 0.45);
  g.putImageData(img, 0, 0);
  try {
    const lines = await loadOsmLines(b);
    drawOsm(g, lines, ([lon, lat]) => {
      const [x, y] = mercPx(lat, lon, z);
      return [x - m.x0 * 256, y - m.y0 * 256];
    }, Math.max(1, m.w / 2500));
  } catch (e) {
    console.warn('OSM overlay for the relief map not available', e);
  }
  return m;
}

export async function loadTerrain(b: Bounds, opts: TerrainOptions = {}): Promise<Terrain> {
  const res = opts.resolution ?? 384;
  const demZ = Math.min(pickZoom(b, 10, 13), 13);
  const total = tileCount(b, demZ);
  let done = 0;
  const dem = await mosaic(b, demZ, DEM_URL, () => opts.onProgress?.(++done, total));

  const demPx = dem.canvas.getContext('2d')!.getImageData(0, 0, dem.w, dem.h).data;
  const demH = new Float32Array(dem.w * dem.h);
  for (let i = 0; i < demH.length; i++) {
    demH[i] = demPx[i * 4] * 256 + demPx[i * 4 + 1] + demPx[i * 4 + 2] / 256 - 32768;
  }
  const sampleDem = (lat: number, lon: number) => {
    const [gx, gy] = mercPx(lat, lon, dem.z);
    const x = Math.min(dem.w - 1.001, Math.max(0, gx - dem.x0 * 256 - 0.5));
    const y = Math.min(dem.h - 1.001, Math.max(0, gy - dem.y0 * 256 - 0.5));
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const i = iy * dem.w + ix;
    return (
      demH[i] * (1 - fx) * (1 - fy) + demH[i + 1] * fx * (1 - fy) + demH[i + dem.w] * (1 - fx) * fy + demH[i + dem.w + 1] * fx * fy
    );
  };

  const frame = new LocalFrame((b.north + b.south) / 2, (b.east + b.west) / 2);
  const [minX, minZ] = frame.toXZ(b.north, b.west);
  const [maxX, maxZ] = frame.toXZ(b.south, b.east);
  const aspect = (maxX - minX) / (maxZ - minZ);
  const nx = aspect >= 1 ? res : Math.max(16, Math.round(res * aspect));
  const nz = aspect >= 1 ? Math.max(16, Math.round(res / aspect)) : res;
  const heights = new Float32Array(nx * nz);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < nz; j++) {
    const z = minZ + ((maxZ - minZ) * j) / (nz - 1);
    for (let i = 0; i < nx; i++) {
      const x = minX + ((maxX - minX) * i) / (nx - 1);
      const [lat, lon] = frame.toLatLon(x, z);
      const h = sampleDem(lat, lon);
      const k = j * nx + i;
      heights[k] = h;
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  }

  const heightAt = (x: number, z: number) => {
    const fi = Math.min(nx - 1.001, Math.max(0, ((x - minX) / (maxX - minX)) * (nx - 1)));
    const fj = Math.min(nz - 1.001, Math.max(0, ((z - minZ) / (maxZ - minZ)) * (nz - 1)));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const fx = fi - i;
    const fz = fj - j;
    const k = j * nx + i;
    return (
      heights[k] * (1 - fx) * (1 - fz) + heights[k + 1] * fx * (1 - fz) + heights[k + nx] * (1 - fx) * fz + heights[k + nx + 1] * fx * fz
    );
  };

  return { frame, bounds: b, minX, maxX, minZ, maxZ, nx, nz, heights, minH, maxH, heightAt };
}

/** Track bounds plus margin (fraction of the larger side, at least minMarginM metres) */
export function paddedBounds(lats: ArrayLike<number>, lons: ArrayLike<number>, margin = 0.15, minMarginM = 3000): Bounds {
  let west = 180, east = -180, south = 90, north = -90;
  for (let i = 0; i < lats.length; i++) {
    west = Math.min(west, lons[i]); east = Math.max(east, lons[i]);
    south = Math.min(south, lats[i]); north = Math.max(north, lats[i]);
  }
  const midLat = (north + south) / 2;
  const mLat = (north - south) * R * RAD;
  const mLon = (east - west) * R * RAD * Math.cos(midLat * RAD);
  const pad = Math.max(Math.max(mLat, mLon) * margin, minMarginM);
  const dLat = pad / (R * RAD);
  const dLon = pad / (R * RAD * Math.cos(midLat * RAD));
  return { west: west - dLon, east: east + dLon, south: south - dLat, north: north + dLat };
}
