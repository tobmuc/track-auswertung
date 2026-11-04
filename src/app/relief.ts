/**
 * Relief map from open data only: colours by elevation (green valleys, brown slopes, white peaks) and
 * hillshading from the Terrarium elevation tiles, with water, main roads and borders from OpenStreetMap.
 * Used as a texture in the 3D video and as a base map in the dashboard.
 */
import { db } from './db';
import { OVERPASS } from './pois';

/** Elevation (m) → colour, for the hypsometric tint */
export const RELIEF_STOPS: [number, string][] = [
  [0, '#6f9e4f'],
  [500, '#8fb25a'],
  [1000, '#b4c46c'],
  [1500, '#c9b77a'],
  [1900, '#b8915f'],
  [2300, '#9f7b5e'],
  [2700, '#a89e95'],
  [3200, '#d7d3cf'],
  [3800, '#ffffff'],
];

const STOP_RGB = RELIEF_STOPS.map(([h, c]) => [h, parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] as const);

export function reliefColor(h: number): [number, number, number] {
  const s = STOP_RGB;
  if (h <= s[0][0]) return [s[0][1], s[0][2], s[0][3]];
  for (let i = 1; i < s.length; i++) {
    if (h <= s[i][0]) {
      const f = (h - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return [0, 1, 2].map((k) => s[i - 1][k + 1] + (s[i][k + 1] - s[i - 1][k + 1]) * f) as [number, number, number];
    }
  }
  const l = s[s.length - 1];
  return [l[1], l[2], l[3]];
}

/**
 * Colours a height grid in place: hypsometric tint times a hillshade (light from the north-west,
 * plus a softer one from the west so south-east slopes do not go flat). `pixelM` = grid spacing in metres;
 * `amount` scales the shading (the 3D scene lights the terrain itself, so it needs less).
 */
export function shadeRelief(heights: Float32Array, w: number, h: number, pixelM: number, out: Uint8ClampedArray, amount = 1) {
  const at = (x: number, y: number) => heights[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const lights = [
    { x: -Math.SQRT1_2 * Math.cos(Math.PI / 4), y: -Math.SQRT1_2 * Math.cos(Math.PI / 4), z: Math.sin(Math.PI / 4), w: 0.7 },
    { x: -Math.cos(Math.PI / 5), y: 0, z: Math.sin(Math.PI / 5), w: 0.3 },
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dzdx = (at(x + 1, y) - at(x - 1, y)) / (2 * pixelM);
      const dzdy = (at(x, y + 1) - at(x, y - 1)) / (2 * pixelM);
      // surface normal; image y grows southwards
      const nl = Math.hypot(dzdx, dzdy, 1);
      const nx = -dzdx / nl, ny = -dzdy / nl, nz = 1 / nl;
      let shade = 0;
      for (const l of lights) shade += l.w * Math.max(0, nx * l.x + ny * l.y + nz * l.z);
      // flat ground (shade ≈ 0.68) stays at its own colour, slopes away from the light darken
      const k = 1 + amount * (Math.min(1.25, 0.3 + shade) - 0.98);
      const c = reliefColor(at(x, y));
      const i = (y * w + x) * 4;
      out[i] = c[0] * k;
      out[i + 1] = c[1] * k;
      out[i + 2] = c[2] * k;
      out[i + 3] = 255;
    }
  }
}

export type OsmKind = 'water' | 'river' | 'road' | 'border';

export interface OsmLine {
  kind: OsmKind;
  /** road class rank 0 (motorway) … 3 (secondary) */
  rank: number;
  /** [lon, lat] pairs; water areas are closed rings */
  coords: [number, number][];
}

interface OverpassEl {
  type: 'way' | 'relation';
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

const ROAD_RANK: Record<string, number> = { motorway: 0, trunk: 1, primary: 2, secondary: 3 };

/** Joins open ways into closed rings where their ends meet (lakes mapped as multipolygons) */
function rings(parts: [number, number][][]): [number, number][][] {
  const open = parts.filter((p) => p.length > 1);
  const out: [number, number][][] = [];
  const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  while (open.length) {
    let ring = open.shift()!;
    for (let grown = true; grown && !same(ring[0], ring[ring.length - 1]);) {
      grown = false;
      for (let k = 0; k < open.length; k++) {
        const p = open[k];
        const end = ring[ring.length - 1];
        if (same(end, p[0])) ring = ring.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) ring = ring.concat([...p].reverse().slice(1));
        else continue;
        open.splice(k, 1);
        grown = true;
        break;
      }
    }
    out.push(ring);
  }
  return out;
}

function parse(els: OverpassEl[]): OsmLine[] {
  const out: OsmLine[] = [];
  const pts = (g: { lat: number; lon: number }[]) => g.filter(Boolean).map((p) => [p.lon, p.lat] as [number, number]);
  for (const e of els) {
    const tg = e.tags ?? {};
    if (e.type === 'relation') {
      const outer = (e.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => pts(m.geometry!));
      for (const r of rings(outer)) out.push({ kind: 'water', rank: 0, coords: r });
      continue;
    }
    if (!e.geometry) continue;
    const coords = pts(e.geometry);
    if (tg.highway) out.push({ kind: 'road', rank: ROAD_RANK[tg.highway] ?? 3, coords });
    else if (tg.waterway) out.push({ kind: 'river', rank: 0, coords });
    else if (tg.natural === 'water') out.push({ kind: 'water', rank: 0, coords });
    // ways of the boundary relations often carry no tags of their own
    else out.push({ kind: 'border', rank: tg.admin_level === '2' ? 0 : 1, coords });
  }
  return out;
}

/** Lakes, rivers, main roads and country/region borders in the bounds; cached in IndexedDB */
export async function loadOsmLines(b: { west: number; south: number; east: number; north: number }): Promise<OsmLine[]> {
  const key = [b.west, b.south, b.east, b.north].map((v) => v.toFixed(3)).join(',');
  const cached = await db.osm.get(key);
  if (cached) return cached.lines;
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  // every statement carries the bounding box: the recursion way(r) would otherwise fetch every
  // border way of whole countries and time out
  const q = `[out:json][timeout:55];
(
  way["waterway"="river"](${bb});
  way["natural"="water"](${bb});
  way["highway"~"^(motorway|trunk|primary|secondary)$"](${bb});
);
out geom;
relation["natural"="water"](${bb});
out geom;
relation["boundary"="administrative"]["admin_level"~"^(2|4)$"](${bb});
way(r)(${bb});
out geom;`;
  let lastErr: unknown;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const lines = parse(((await res.json()) as { elements: OverpassEl[] }).elements);
      await db.osm.put({ key, lines, createdAt: Date.now() });
      return lines;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Draws the OSM lines onto a canvas; `project` maps [lon, lat] to canvas pixels, `px` = line width unit */
export function drawOsm(g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, lines: OsmLine[], project: (c: [number, number]) => [number, number], px: number) {
  const path = (coords: [number, number][]) => {
    g.beginPath();
    coords.forEach((c, k) => {
      const [x, y] = project(c);
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
  };
  g.lineJoin = g.lineCap = 'round';
  g.fillStyle = '#7fb3dc';
  g.strokeStyle = '#5b97c9';
  g.lineWidth = px;
  for (const l of lines) if (l.kind === 'water') { path(l.coords); g.fill(); g.stroke(); }
  g.strokeStyle = '#5b97c9';
  g.lineWidth = 1.6 * px;
  for (const l of lines) if (l.kind === 'river') { path(l.coords); g.stroke(); }
  for (const l of lines) {
    if (l.kind !== 'road') continue;
    g.strokeStyle = l.rank <= 1 ? 'rgba(255,236,170,.95)' : 'rgba(255,255,255,.85)';
    g.lineWidth = (2.6 - 0.45 * l.rank) * px;
    path(l.coords);
    g.stroke();
  }
  g.setLineDash([4 * px, 3 * px]);
  for (const l of lines) {
    if (l.kind !== 'border') continue;
    g.strokeStyle = l.rank === 0 ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.6)';
    g.lineWidth = (l.rank === 0 ? 2.2 : 1.4) * px;
    path(l.coords);
    g.stroke();
  }
  g.setLineDash([]);
}
