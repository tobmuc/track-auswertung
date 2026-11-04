import type { CircleStat } from './types';

/** Time-weighted climb distribution: seconds spent per climb bin (bin = [lo, lo + w)) */
export function climbHistogram(circles: CircleStat[], w = 0.5): { lo: number; s: number }[] {
  if (!circles.length) return [];
  let lo = Infinity, hi = -Infinity;
  for (const c of circles) { lo = Math.min(lo, c.climb); hi = Math.max(hi, c.climb); }
  const b0 = Math.floor(Math.max(lo, -3) / w);
  const b1 = Math.floor(Math.min(hi, 8) / w);
  const bins = Array.from({ length: b1 - b0 + 1 }, (_, k) => ({ lo: (b0 + k) * w, s: 0 }));
  for (const c of circles) {
    const k = Math.min(b1, Math.max(b0, Math.floor(c.climb / w))) - b0;
    bins[k].s += c.durationS;
  }
  return bins;
}

export interface Band {
  /** lower edge: altitude in m or time in ms */
  lo: number;
  /** time-weighted mean climb, m/s */
  climb: number;
  /** time spent circling in the band */
  s: number;
  n: number;
}

/** Mean climb per band of `width` over key(c) (altitude or time) */
export function bands(circles: CircleStat[], key: (c: CircleStat) => number, width: number): Band[] {
  const map = new Map<number, Band>();
  for (const c of circles) {
    const lo = Math.floor(key(c) / width) * width;
    const b = map.get(lo) ?? { lo, climb: 0, s: 0, n: 0 };
    b.climb += c.climb * c.durationS;
    b.s += c.durationS;
    b.n++;
    map.set(lo, b);
  }
  return [...map.values()].map((b) => ({ ...b, climb: b.climb / b.s })).sort((a, b) => a.lo - b.lo);
}

export interface Centring {
  thermal: number;
  circles: CircleStat[];
  /** best climb of two consecutive turns, m/s */
  best: number;
  /** climb of the first turn */
  first: number;
  /**
   * Seconds from entering the thermal until a turn reaches 80 % of the best climb,
   * null when the thermal has fewer than 3 turns
   */
  centredAfterS: number | null;
  /** turns needed for that */
  centredTurn: number | null;
  meanRadiusM: number;
  meanBankDeg: number;
}

export const CENTRED_SHARE = 0.8;

/** How quickly each thermal was centred: climb per turn from entry */
export function centring(circles: CircleStat[]): Centring[] {
  const by = new Map<number, CircleStat[]>();
  for (const c of circles) {
    if (c.thermal < 0) continue;
    const l = by.get(c.thermal) ?? [];
    l.push(c);
    by.set(c.thermal, l);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([thermal, cs]) => {
    // best of two consecutive turns, so one lucky turn does not set the bar
    let best = cs[0].climb;
    for (let k = 1; k < cs.length; k++) best = Math.max(best, Math.min(cs[k - 1].climb, cs[k].climb));
    if (cs.length === 1) best = cs[0].climb;
    let centredTurn: number | null = null;
    if (cs.length >= 3 && best > 0) {
      const k = cs.findIndex((c) => c.climb >= CENTRED_SHARE * best);
      if (k >= 0) centredTurn = k + 1;
    }
    const t0 = cs[0].t - (cs[0].durationS * 1000) / 2;
    const tc = centredTurn != null ? cs[centredTurn - 1].t + (cs[centredTurn - 1].durationS * 1000) / 2 : null;
    return {
      thermal,
      circles: cs,
      best,
      first: cs[0].climb,
      centredAfterS: tc != null ? (tc - t0) / 1000 : null,
      centredTurn,
      meanRadiusM: cs.reduce((a, c) => a + c.radiusM, 0) / cs.length,
      meanBankDeg: cs.reduce((a, c) => a + c.bankDeg, 0) / cs.length,
    };
  });
}

/** Time-weighted mean of f over the circles */
export function meanOf(circles: CircleStat[], f: (c: CircleStat) => number): number | null {
  let a = 0, w = 0;
  for (const c of circles) { a += f(c) * c.durationS; w += c.durationS; }
  return w ? a / w : null;
}
