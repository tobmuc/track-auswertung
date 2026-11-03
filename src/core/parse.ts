import IGCParser from 'igc-parser';
import type { Track, TrackPoint } from './types';

export function parseTrack(fileName: string, text: string): Track {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.igc') || /^A[A-Z0-9]{3}/.test(text.trimStart())) return parseIGC(fileName, text);
  if (lower.endsWith('.gpx') || text.includes('<gpx')) return parseGPX(fileName, text);
  throw new Error(`Unbekanntes Dateiformat: ${fileName}`);
}

export function parseIGC(fileName: string, text: string): Track {
  const igc = IGCParser.parse(text, { lenient: true });
  const points: TrackPoint[] = [];
  for (const f of igc.fixes) {
    if (!f.valid && f.gpsAltitude == null) continue;
    const prev = points[points.length - 1];
    if (prev && f.timestamp <= prev.t) continue;
    points.push({
      t: f.timestamp,
      lat: f.latitude,
      lon: f.longitude,
      alt: f.gpsAltitude ?? f.pressureAltitude ?? 0,
      palt: f.pressureAltitude && f.pressureAltitude !== 0 ? f.pressureAltitude : null,
    });
  }
  return {
    source: 'igc',
    fileName,
    points,
    pilot: igc.pilot ?? undefined,
    // many loggers only write "PG"/"HG" as glider type; then the glider ID is more telling
    glider: [igc.gliderType, igc.registration].find((g) => g && !/^(PG|HG|none)$/i.test(g.trim())) ?? undefined,
    gliderType: /^\s*(HG|hang)/i.test(igc.gliderType ?? '') ? 'HG' : 'PG',
    logger: igc.loggerType ?? undefined,
    raw: text,
  };
}

/** Minimal GPX parser (regex based so it runs in Node, browser and workers alike) */
export function parseGPX(fileName: string, text: string): Track {
  const points: TrackPoint[] = [];
  const re = /<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lat = parseFloat(/lat="([^"]+)"/.exec(m[1])?.[1] ?? 'NaN');
    const lon = parseFloat(/lon="([^"]+)"/.exec(m[1])?.[1] ?? 'NaN');
    const ele = parseFloat(/<ele>([^<]+)<\/ele>/.exec(m[2])?.[1] ?? 'NaN');
    const time = /<time>([^<]+)<\/time>/.exec(m[2])?.[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !time) continue;
    const t = Date.parse(time);
    const prev = points[points.length - 1];
    if (prev && t <= prev.t) continue;
    points.push({ t, lat, lon, alt: Number.isFinite(ele) ? ele : (prev?.alt ?? 0), palt: null });
  }
  const name = /<trk>[\s\S]*?<name>([^<]*)<\/name>/.exec(text)?.[1];
  return { source: 'gpx', fileName: name ? `${fileName}` : fileName, points };
}
