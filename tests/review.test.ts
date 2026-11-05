import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeTracks, parseTrack } from '../src/core';

const FILE = 'fixtures/2026-09-17-XTR-E820273A2ED6-01.IGC';

describe.skipIf(!existsSync(FILE))('Flugbewertung 17.09.2026', () => {
  const f = analyzeTracks([parseTrack(FILE, readFileSync(FILE, 'utf8'))]).flight!;
  it('findet Stärken und Verbesserungen mit Daten', () => {
    const r = f.review;
    const fmt = (x: typeof r.good[number]) => `${x.topic} ${Math.round(f.launchTime / 1000) && ''}${Object.entries(x.v).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' ')}`;
    console.log('GUT\n' + r.good.map(fmt).join('\n'));
    console.log('BESSER\n' + r.improve.map(fmt).join('\n'));
    expect(r.good.length).toBeGreaterThan(1);
    expect(r.improve.length).toBeGreaterThan(0);
    for (const x of [...r.good, ...r.improve]) {
      expect(x.start).toBeGreaterThanOrEqual(0);
      expect(x.end).toBeGreaterThanOrEqual(x.start);
      for (const v of Object.values(x.v)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
