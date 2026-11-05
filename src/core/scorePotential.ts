import { distM } from './geo';
import type { ScoreSet } from './score';
import type { ScorePoint, XcScore } from './types';

/**
 * What a flown triangle lacked for a better rating (XContest rules): closing the gap to ≤ 5 % of the
 * perimeter (flat 1.2 → 1.4, FAI 1.4 → 1.6), or a shortest leg of ≥ 28 % for an FAI triangle.
 * Distances follow XContest: triangle distance = perimeter − closing gap.
 */
export interface XcPotential {
  kind: 'close' | 'fai';
  from: XcScore['code'];
  nowPoints: number;
  newPoints: number;
  nowMultiplier: number;
  newMultiplier: number;
  perimeterKm: number;
  /** km that had to be flown in addition (close: towards the closing point; fai: on the shortest leg) */
  missingKm: number;
  gapKm?: number;
  shortestShare?: number;
  /** close: where the track ended up (closing out) and where it had to get to (closing in) */
  out?: ScorePoint;
  target?: ScorePoint;
}

const CLOSED = 0.05;
const FAI_SHARE = 0.28;
const MULT = { tri: { open: 1.2, closed: 1.4 }, fai: { open: 1.4, closed: 1.6 } } as const;

const legKm = (a: ScorePoint, b: ScorePoint) => distM(a.lat, a.lon, b.lat, b.lon) / 1000;

export function xcPotential(score: ScoreSet | undefined, rules: string): XcPotential[] {
  if (!score || rules !== 'XContest') return [];
  const out: XcPotential[] = [];
  for (const code of ['tri', 'fai'] as const) {
    const sc = score.byCode[code];
    if (!sc || sc.turnpoints.length !== 3) continue;
    const [a, b, c] = sc.turnpoints;
    const legs = [legKm(a, b), legKm(b, c), legKm(c, a)];
    const P = legs[0] + legs[1] + legs[2];
    const gap = sc.closing?.km ?? 0;
    const closed = gap <= CLOSED * P + 1e-6;
    // close the triangle
    if (!closed && sc.closing) {
      const newGap = CLOSED * P;
      const m = MULT[code].closed;
      out.push({
        kind: 'close', from: code, nowPoints: sc.points, nowMultiplier: sc.multiplier, newMultiplier: m,
        newPoints: (P - newGap) * m, perimeterKm: P, missingKm: gap - newGap, gapKm: gap,
        out: sc.closing.out, target: sc.closing.in,
      });
    }
    // make a flat triangle FAI
    if (code === 'tri') {
      const s = Math.min(...legs);
      const share = s / P;
      if (share < FAI_SHARE && share > 0.15) {
        const extra = (FAI_SHARE * P - s) / (1 - FAI_SHARE);
        const m = closed ? MULT.fai.closed : MULT.fai.open;
        const newPts = (P + extra - gap) * m;
        if (newPts > sc.points) {
          out.push({ kind: 'fai', from: code, nowPoints: sc.points, nowMultiplier: sc.multiplier, newMultiplier: m, newPoints: newPts, perimeterKm: P, missingKm: extra, shortestShare: share });
        }
      }
    }
  }
  // only what beats the current best result
  return out.filter((p) => p.newPoints > score.best.points + 0.5).sort((x, y) => y.newPoints - x.newPoints);
}
