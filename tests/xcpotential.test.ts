import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeTracks, parseTrack, scoreAll, xcPotential } from '../src/core';

const FILE = 'fixtures/2026-09-17-XTR-E820273A2ED6-01.IGC';

describe.skipIf(!existsSync(FILE))('Wertungs-Potenzial 17.09.2026', () => {
  it('rechnet aus, was zum geschlossenen Dreieck fehlte', () => {
    const tr = parseTrack(FILE, readFileSync(FILE, 'utf8'));
    const f = analyzeTracks([tr]).flight!;
    const sc = scoreAll(tr.points, f.launchIdx, f.landingIdx, 'XContest', 8000);
    const pot = xcPotential(sc, 'XContest');
    console.log(pot.map((p) => `${p.kind} ${p.from} fehlt ${p.missingKm.toFixed(1)} km, ${p.nowPoints.toFixed(1)} → ${p.newPoints.toFixed(1)} P (×${p.nowMultiplier}→×${p.newMultiplier})`).join('\n'));
    expect(pot.length).toBeGreaterThan(0);
    expect(pot[0].newPoints).toBeGreaterThan(sc!.best.points);
  }, 60000);
});
