import { describe, expect, it } from 'vitest';
import { analyzeTracks, parseGPX } from '../src/core';

/** Synthetic GPX: 60 min uphill walk (3 km/h, +600 m), 5 min pause, 20 min flight downhill */
function synthGpx(): string {
  const pts: string[] = [];
  const t0 = Date.parse('2026-09-19T08:00:00Z');
  let lat = 46.5;
  let lon = 7.6;
  let alt = 1800;
  let t = t0;
  const add = () => pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${alt.toFixed(1)}</ele><time>${new Date(t).toISOString()}</time></trkpt>`);
  for (let i = 0; i < 360; i++) { lat += (3000 / 3600 * 10) / 111320; alt += 600 / 360; t += 10_000; add(); }
  for (let i = 0; i < 30; i++) { t += 10_000; add(); }
  for (let i = 0; i < 1200; i++) { lon += (30000 / 3600) / (111320 * Math.cos(lat * Math.PI / 180)); alt -= 1; t += 1000; add(); }
  return `<?xml version="1.0"?><gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

describe('Hike & Fly in einer Datei', () => {
  const a = analyzeTracks([parseGPX('hf.gpx', synthGpx())]);
  it('trennt Aufstieg und Flug', () => {
    expect(a.sport).toBe('hikefly');
    expect(a.segments.map((s) => s.kind)).toEqual(['hike', 'flight']);
  });
  it('misst den Aufstieg', () => {
    expect(a.hike!.gain).toBeGreaterThan(550);
    expect(a.hike!.gain).toBeLessThan(650);
    expect(a.hike!.distanceKm).toBeCloseTo(3, 0);
    expect(a.hike!.breaksS).toBeGreaterThanOrEqual(120);
  });
  it('misst den Flug', () => {
    expect(a.flight!.airtimeS / 60).toBeGreaterThan(18);
    expect(a.flight!.avgSpeedKmh).toBeGreaterThan(25);
    expect(a.flight!.avgGlideRatio!).toBeGreaterThan(7);
  });
});

describe('XC-Wertung ohne gültige Lösung', () => {
  it('bricht bei einem kurzen Gleitflug ohne Dreieck nicht ab', async () => {
    const { scoreAll } = await import('../src/core');
    const a = analyzeTracks([parseGPX('hf.gpx', synthGpx())]);
    const seg = a.segments.find((s) => s.kind === 'flight')!;
    const sc = scoreAll(seg.track.points, seg.range.start, seg.range.end, 'XContest', 1000);
    console.log('score', sc && Object.entries(sc.byCode).map(([k, v]) => `${k} ${v!.distanceKm.toFixed(2)}`));
  }, 20000);
});
