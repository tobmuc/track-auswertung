import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeTracks, parseTrack } from '../src/core';
import { localXY } from '../src/core/geo';
import { attitude, windSeries } from '../src/three/model';

const FILE = 'fixtures/2026-09-17-XTR-E820273A2ED6-01.IGC';

describe.skipIf(!existsSync(FILE))('Querlage aus dem Track', () => {
  it('ist mit Fahrt durch die Luft gleichmässiger als mit Grundgeschwindigkeit', () => {
    const tr = parseTrack(FILE, readFileSync(FILE, 'utf8'));
    const a = analyzeTracks([tr]);
    const seg = a.segments.find((s) => s.kind === 'flight')!;
    const f = seg.flight!;
    const pts = tr.points.slice(seg.range.start, seg.range.end + 1);
    const n = pts.length;
    const t = new Float64Array(n), x = new Float64Array(n), z = new Float64Array(n), sp = new Float64Array(n);
    pts.forEach((p, i) => {
      const [e, nn] = localXY(p.lat, p.lon, pts[0].lat, pts[0].lon);
      t[i] = p.t; x[i] = e; z[i] = -nn; sp[i] = seg.series.speed[i];
    });
    const ground = attitude(t, x, z, sp).bank;
    const air = attitude(t, x, z, sp, windSeries(t, f.winds, f.wind)).bank;
    // inside full circles: mean |bank| and the spread within each circle
    const stat = (b: Float32Array) => {
      let sum = 0, cnt = 0, spread = 0, circ = 0;
      for (const c of f.circlings) {
        const v = Array.from(b.slice(c.start + 10, c.end - 10)).map((q) => Math.abs(q) * 57.3);
        if (v.length < 20) continue;
        const m = v.reduce((p, q) => p + q, 0) / v.length;
        sum += m * v.length; cnt += v.length;
        spread += Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / v.length); circ++;
      }
      return { mean: sum / cnt, spread: spread / circ };
    };
    const g = stat(ground), w = stat(air);
    console.log(`Grund: Ø ${g.mean.toFixed(1)}°, Schwankung ${g.spread.toFixed(1)}° | Luft: Ø ${w.mean.toFixed(1)}°, Schwankung ${w.spread.toFixed(1)}°`);
    expect(w.spread).toBeLessThan(g.spread);
  });
});
