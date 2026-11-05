import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeTracks, bands, centring, climbHistogram, parseTrack } from '../src/core';

const FILE = 'fixtures/2026-09-17-XTR-E820273A2ED6-01.IGC';

describe.skipIf(!existsSync(FILE))('Kreisformen 17.09.2026', () => {
  // the body runs even when the block is skipped: read the file only if it is there
  const f = existsSync(FILE) ? analyzeTracks([parseTrack(FILE, readFileSync(FILE, 'utf8'))]).flight! : (null as never);
  it('liefert plausible Kreise', () => {
    const c = f.circles;
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    console.log('Kreise', c.length, 'Radius', med(c.map((x) => x.radiusM)).toFixed(0), 'm, Querlage', med(c.map((x) => x.bankDeg)).toFixed(0), '°, Zeit', med(c.map((x) => x.durationS)).toFixed(0), 's');
    expect(c.length).toBeGreaterThan(50);
    expect(med(c.map((x) => x.radiusM))).toBeGreaterThan(15);
    expect(med(c.map((x) => x.radiusM))).toBeLessThan(80);
    expect(med(c.map((x) => x.bankDeg))).toBeGreaterThan(15);
    expect(med(c.map((x) => x.bankDeg))).toBeLessThan(60);
    expect(c.filter((x) => x.thermal >= 0).length).toBeGreaterThan(c.length * 0.6);
  });
  it('verteilt Steigen, Höhen und Zentrieren', () => {
    const hist = climbHistogram(f.circles);
    const total = f.circles.reduce((a, c) => a + c.durationS, 0);
    expect(hist.reduce((a, b) => a + b.s, 0)).toBeCloseTo(total, 3);
    const alt = bands(f.circles, (c) => c.alt, 250);
    expect(alt.length).toBeGreaterThan(3);
    const ce = centring(f.circles);
    expect(ce.length).toBeGreaterThan(5);
    const done = ce.filter((x) => x.centredAfterS != null);
    console.log('zentriert nach (s)', done.map((x) => x.centredAfterS!.toFixed(0)).join(' '));
    expect(done.length).toBeGreaterThan(3);
  });
});

describe('Hilfsfunktionen', () => {
  const mk = (climb: number, thermal = 0, t = 0) => ({ t, alt: 1000 + climb * 100, durationS: 20, dir: 1 as const, climb, radiusM: 40, bankDeg: 35, airspeedKmh: 36, thermal });
  it('zentriert nach der ersten Runde mit 80 % des besten Steigens', () => {
    const cs = [mk(0.5, 0, 10e3), mk(1.2, 0, 30e3), mk(2.0, 0, 50e3), mk(2.1, 0, 70e3), mk(1.9, 0, 90e3)];
    const [c] = centring(cs);
    expect(c.best).toBeCloseTo(2.0);
    expect(c.centredTurn).toBe(3);
    expect(c.centredAfterS).toBeCloseTo(60);
  });
});
