import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeTracks, parseTrack } from '../src/core';

const FILE = 'fixtures/2026-09-17-XTR-E820273A2ED6-01.IGC';

describe.skipIf(!existsSync(FILE))('Fahrt durch die Luft 17.09.2026', () => {
  const f = analyzeTracks([parseTrack(FILE, readFileSync(FILE, 'utf8'))]).flight!;
  it('schätzt Trimmfahrt und beschleunigte Phasen plausibel', () => {
    const a = f.airspeed!;
    console.log('Trimm', a.trimKmh.toFixed(1), 'max20', a.max20sKmh.toFixed(1), 'ausgewertet', (a.evaluatedS / 60).toFixed(0), 'min', 'beschl.', (a.acceleratedS / 60).toFixed(0), 'min', a.phases.length, 'Phasen',
      'Gegenwind', a.accelShareHeadwind?.toFixed(2), 'Rückenwind', a.accelShareTailwind?.toFixed(2));
    console.log(a.phases.slice(0, 6).map((p) => `${p.durationS.toFixed(0)}s ${p.airKmh.toFixed(0)}km/h ${p.vario.toFixed(1)}m/s wind${p.windAlongKmh.toFixed(0)}`).join(' | '));
    expect(a.trimKmh).toBeGreaterThan(28);
    expect(a.trimKmh).toBeLessThan(48);
    expect(a.max20sKmh).toBeGreaterThan(a.trimKmh);
    expect(a.max20sKmh).toBeLessThan(75);
    expect(f.glides.filter((g) => g.airKmh != null).length).toBeGreaterThan(5);
  });
});
