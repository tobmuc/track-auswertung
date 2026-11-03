import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeTracks, parseTrack, scoreFlight } from '../src/core';

const FILE = 'fixtures/2026-09-17-XTR-E820273A2ED6-01.IGC';
const track = parseTrack(FILE, readFileSync(FILE, 'utf8'));

describe('Flug 17.09.2026 (XC Tracer, Kirgistan)', () => {
  const a = analyzeTracks([track]);
  it('erkennt Paragliding ohne Hike-Anteil', () => {
    expect(a.sport).toBe('paragliding');
    expect(a.flight).toBeDefined();
  });
  it('liefert plausible Flugwerte', () => {
    const f = a.flight!;
    console.table({
      airtime: (f.airtimeS / 60).toFixed(0) + ' min', track: f.trackLengthKm.toFixed(1), maxAlt: f.maxAlt, launchAlt: f.launchAlt.toFixed(0),
      landingAlt: f.landingAlt.toFixed(0), climb: f.totalClimb.toFixed(0), descent: f.totalDescent.toFixed(0), avgSpeed: f.avgSpeedKmh.toFixed(1),
      maxSpeed: f.maxSpeedKmh.toFixed(1), glide: f.avgGlideRatio?.toFixed(1), bestGlide: f.bestGlide60s?.toFixed(1), best30: f.bestClimb30s.toFixed(1),
      worst30: f.worstSink30s.toFixed(1), thermalClimb: f.avgClimbInThermals?.toFixed(2), circling: (f.timeCirclingS / 60).toFixed(0) + ' min',
      thermals: f.thermals.length, circlesLR: `${f.circlesLeft}/${f.circlesRight}`, perCircle: f.avgTimePerCircleS?.toFixed(0),
      wind: f.wind && `${f.wind.fromDeg.toFixed(0)}° ${f.wind.speedKmh.toFixed(1)} km/h (${f.winds.length} Kreise)`,
    });
    expect(f.airtimeS / 3600).toBeGreaterThan(4);
    expect(f.trackLengthKm).toBeGreaterThan(100);
    expect(f.thermals.length).toBeGreaterThan(5);
    expect(f.avgClimbInThermals!).toBeGreaterThan(0.5);
  });
  it('XContest-Score liegt nahe an 80.62 km (flaches Dreieck)', () => {
    const f = a.flight!;
    const sc = scoreFlight(track.points, f.launchIdx, f.landingIdx, 'XContest')!;
    console.log(sc.type, sc.distanceKm.toFixed(2), 'km', sc.points.toFixed(2), 'P', 'optimal', sc.optimal);
    expect(sc.type).toBe('Free Triangle');
    expect(Math.abs(sc.distanceKm - 80.62)).toBeLessThan(0.5);
  });
});

describe('Gleitstrecken und Thermik-Drift', () => {
  const f = analyzeTracks([track]).flight!;
  it('liefert Gleitstrecken mit Gleitzahl', () => {
    const long = f.glides.filter((g) => g.distanceKm > 2);
    console.table(long.slice(0, 8).map((g) => ({ km: g.distanceKm.toFixed(1), loss: g.loss.toFixed(0), gz: g.ratio?.toFixed(1), air: g.airRatio?.toFixed(1), kmh: g.avgSpeedKmh.toFixed(0) })));
    expect(long.length).toBeGreaterThan(3);
    const ratios = long.map((g) => g.ratio).filter((r): r is number => r != null);
    const median = ratios.sort((a, b) => a - b)[ratios.length >> 1];
    expect(median).toBeGreaterThan(4);
    expect(median).toBeLessThan(15);
  });
  it('Wind aus der Drift der Kreismittelpunkte passt zum Kreisfit', () => {
    const both = f.thermals.filter((t) => t.drift && t.wind);
    console.table(both.map((t) => ({ alt: t.topAlt.toFixed(0), circles: t.core!.length, drift: `${t.drift!.fromDeg.toFixed(0)}° ${t.drift!.speedKmh.toFixed(1)}`, fit: `${t.wind!.fromDeg.toFixed(0)}° ${t.wind!.speedKmh.toFixed(1)}` })));
    expect(both.length).toBeGreaterThan(3);
    // vector difference between both estimates, median below 8 km/h
    const diffs = both.map((t) => {
      const v = (w: { fromDeg: number; speedKmh: number }) => [Math.sin((w.fromDeg * Math.PI) / 180) * w.speedKmh, Math.cos((w.fromDeg * Math.PI) / 180) * w.speedKmh];
      const [a, b] = [v(t.drift!), v(t.wind!)];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    }).sort((a, b) => a - b);
    expect(diffs[diffs.length >> 1]).toBeLessThan(8);
  });
});
