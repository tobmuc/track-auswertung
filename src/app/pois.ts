/**
 * Points of interest (peaks, huts, passes, lakes, villages) around a flight.
 * Primary source: Wikidata (free, CORS, names in DE/EN, number of Wikipedia articles as a
 * measure of how well known a place is). Fallback: OpenStreetMap via the Overpass API.
 * Google Places is not used: it needs a billed API key and its terms forbid caching the data.
 * Results are cached in IndexedDB per area and language.
 */
import { db } from './db';
import type { Lang } from './i18n';

export type PoiKind = 'peak' | 'hut' | 'pass' | 'lake' | 'town';

export interface Poi {
  name: string;
  lat: number;
  lon: number;
  /** elevation from the source, m; null = unknown (take it from the terrain) */
  ele: number | null;
  kind: PoiKind;
  /** number of Wikipedia articles (Wikidata) — how well known the place is */
  links: number;
}

export interface PoiBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const WD_TYPES: Record<string, PoiKind> = {
  Q8502: 'peak', // mountain
  Q207326: 'peak', // summit
  Q182676: 'hut', // mountain hut
  Q133056: 'pass', // mountain pass
  Q23397: 'lake', // lake
  Q3957: 'town', // town
  Q532: 'town', // village
};

async function fromWikidata(b: PoiBounds, lang: Lang): Promise<Poi[]> {
  const langs = lang === 'en' ? 'en,de,mul' : 'de,en,mul';
  const q = `SELECT ?item ?itemLabel ?coord ?ele ?type ?links WHERE {
  SERVICE wikibase:box { ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${b.west} ${b.south})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${b.east} ${b.north})"^^geo:wktLiteral . }
  VALUES ?type { ${Object.keys(WD_TYPES).map((k) => `wd:${k}`).join(' ')} }
  ?item wdt:P31 ?type .
  ?item wikibase:sitelinks ?links .
  OPTIONAL { ?item wdt:P2044 ?ele . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${langs}". }
} LIMIT 4000`;
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  type B = Record<string, { value: string } | undefined>;
  const rows = ((await res.json()) as { results: { bindings: B[] } }).results.bindings;
  const byItem = new Map<string, Poi>();
  for (const r of rows) {
    const name = r.itemLabel?.value ?? '';
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord?.value ?? '');
    // items without a label in any of the languages come back as their Q-id
    if (!m || !name || /^Q\d+$/.test(name)) continue;
    const id = r.item!.value;
    if (byItem.has(id)) continue;
    const ele = r.ele ? Number(r.ele.value) : NaN;
    byItem.set(id, {
      name,
      lon: Number(m[1]),
      lat: Number(m[2]),
      ele: Number.isFinite(ele) && ele > -500 && ele < 9000 ? ele : null,
      kind: WD_TYPES[r.type!.value.split('/').pop()!],
      links: Number(r.links?.value ?? 0),
    });
  }
  return [...byItem.values()];
}

export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function fromOsm(b: PoiBounds, lang: Lang): Promise<Poi[]> {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:25];(
  node["natural"="peak"]["name"](${bb});
  node["tourism"="alpine_hut"]["name"](${bb});
  node["mountain_pass"="yes"]["name"](${bb});
  node["place"~"^(town|village)$"]["name"](${bb});
);out body 3000;`;
  let lastErr: unknown;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const els = ((await res.json()) as { elements: { lat: number; lon: number; tags: Record<string, string> }[] }).elements;
      return els.map((e) => {
        const tg = e.tags;
        const kind: PoiKind = tg.natural === 'peak' ? 'peak' : tg.tourism === 'alpine_hut' ? 'hut' : tg.mountain_pass ? 'pass' : 'town';
        const ele = Number.parseFloat(tg.ele ?? '');
        return {
          name: tg[`name:${lang}`] ?? tg.name,
          lat: e.lat,
          lon: e.lon,
          ele: Number.isFinite(ele) ? ele : null,
          kind,
          // no article count in OSM: a Wikipedia/Wikidata link at least marks known places
          links: tg.wikipedia || tg.wikidata ? 5 : 0,
        };
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** POIs in the area, from cache, Wikidata or OpenStreetMap (in that order) */
export async function loadPois(b: PoiBounds, lang: Lang): Promise<Poi[]> {
  const r = (v: number) => v.toFixed(3);
  const key = `${lang}|${r(b.west)},${r(b.south)},${r(b.east)},${r(b.north)}`;
  const hit = await db.pois.get(key);
  if (hit) return hit.pois;
  let pois: Poi[];
  try {
    pois = await fromWikidata(b, lang);
  } catch {
    pois = await fromOsm(b, lang);
  }
  await db.pois.put({ key, pois, createdAt: Date.now() });
  return pois;
}

const KIND_WEIGHT: Record<PoiKind, number> = { peak: 1, hut: 0.9, pass: 0.7, lake: 0.6, town: 0.6 };

/**
 * The few POIs worth a label: well known (Wikipedia articles), high, and near the track.
 * Huts, passes, lakes and villages only count close to the track; labels keep a minimum distance.
 * xz: local metres of each POI; track: decimated local track points.
 */
export function selectPois<T extends Poi & { x: number; z: number; ground: number }>(
  pois: T[],
  track: { x: number; z: number }[],
  extentM: number,
  max = 14,
): T[] {
  const near = (p: T) => {
    let d = Infinity;
    for (const q of track) d = Math.min(d, Math.hypot(p.x - q.x, p.z - q.z));
    return d;
  };
  const maxEle = Math.max(1, ...pois.map((p) => p.ele ?? p.ground));
  const scored = pois
    .map((p) => {
      const d = near(p);
      if (p.kind !== 'peak' && d > 4000) return null;
      const known = 1 + Math.log1p(p.links);
      const high = p.kind === 'peak' ? 0.5 + (p.ele ?? p.ground) / maxEle : 1;
      const prox = 1 / (1 + (d / Math.max(3000, extentM * 0.08)) ** 2);
      return { p, s: KIND_WEIGHT[p.kind] * known * high * (0.3 + prox) };
    })
    .filter((v): v is { p: T; s: number } => v != null)
    .sort((a, b) => b.s - a.s);
  const minGap = Math.max(1500, extentM * 0.05);
  const out: T[] = [];
  for (const { p } of scored) {
    if (out.length >= max) break;
    if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < minGap)) continue;
    out.push(p);
  }
  return out;
}
