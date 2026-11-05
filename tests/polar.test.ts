import { describe, expect, it } from 'vitest';
import { bestGlide, fitPolar, minSink, sinkAt, speedToFly } from '../src/core';

// a made-up but typical EN-C polar: trim 38 km/h at 1.1 m/s, min sink 0.95, top 56 km/h at 2.1 m/s
const P = fitPolar([[32, 1.0], [38, 1.1], [47, 1.45], [56, 2.1]]);

describe('Polare', () => {
  it('passt eine Parabel durch die Punkte', () => {
    expect(sinkAt(P, 38 / 3.6)).toBeCloseTo(1.1, 1);
    expect(sinkAt(P, 56 / 3.6)).toBeCloseTo(2.1, 1);
  });
  it('findet beste Gleitzahl und geringstes Sinken', () => {
    const g = bestGlide(P);
    const s = minSink(P);
    expect(g.ratio).toBeGreaterThan(8.5);
    expect(g.ratio).toBeLessThan(11);
    expect(s.v).toBeLessThan(g.v);
  });
  it('fliegt bei Gegenwind und Sinken schneller, bei Rückenwind und Steigen langsamer', () => {
    const calm = speedToFly(P, 0, 0, 1.5).v;
    expect(speedToFly(P, -4, 0, 1.5).v).toBeGreaterThan(calm);
    expect(speedToFly(P, 0, -1.5, 1.5).v).toBeGreaterThan(calm);
    expect(speedToFly(P, 4, 0, 1.5).v).toBeLessThanOrEqual(calm);
    expect(speedToFly(P, 0, 0.8, 1.5).v).toBeLessThanOrEqual(calm);
    // higher MacCready setting = faster
    expect(speedToFly(P, 0, 0, 3).v).toBeGreaterThan(speedToFly(P, 0, 0, 0.5).v);
  });
});
