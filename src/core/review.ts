import { centring } from './circles';
import { localXY } from './geo';
import type { AirspeedStats } from './airspeed';
import type { CircleStat, Glide, Series, Thermal, TrackPoint } from './types';

/**
 * Flight review: sections that went well and sections with likely room for improvement.
 * Every finding carries the time range and the measured values it is based on; the wording is left
 * to the UI. Estimates of lost time are rough and labelled as such there. The rules only use what the
 * track shows: they cannot see the pilot's reasons (low over terrain, airspace, a planned route).
 */

export type FindingTopic =
  // room for improvement
  | 'late-exit' // kept circling in the weak top part of a thermal
  | 'slow-centring' // many turns before the climb settled
  | 'weak-thermal' // took a thermal far below the day's average
  | 'headwind-trim' // long headwind glide flown at trim speed
  | 'sink-trim' // long sinking glide flown at trim speed
  | 'circle-size' // wider circles climbed worse than tighter ones
  // went well
  | 'best-thermal'
  | 'best-glide'
  | 'fast-centring'
  | 'speed-to-fly'
  | 'fastest-leg';

export interface Finding {
  kind: 'good' | 'improve';
  topic: FindingTopic;
  /** flight-relative point indices */
  start: number;
  end: number;
  /** for ranking: estimated seconds lost (improve) or a strength score (good) */
  score: number;
  /** measured values the text is built from (units in the key: S seconds, M metres, Ms m/s, Kmh km/h) */
  v: Record<string, number>;
}

export interface FlightReview {
  improve: Finding[];
  good: Finding[];
  /** reference values of this flight */
  dayClimbMs: number | null;
}

interface Input {
  pts: TrackPoint[];
  off: number;
  s: Series;
  thermals: Thermal[];
  circles: CircleStat[];
  glides: Glide[];
  airspeed: AirspeedStats | null;
  avgClimbInThermals: number | null;
}

export function reviewFlight(x: Input): FlightReview {
  const { pts, off, s, thermals, circles, glides, airspeed } = x;
  const n = s.s.length;
  const t0 = pts[off].t;
  /** flight index of a time in ms */
  const idxAt = (t: number) => {
    let lo = 0, hi = n - 1;
    const ts = (t - t0) / 1000;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (s.s[m] < ts) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const day = x.avgClimbInThermals;
  const improve: Finding[] = [];
  const good: Finding[] = [];
  const cen = centring(circles);

  // ---- thermals: late exit, slow centring, weak thermals, best thermal, fast centring
  for (const c of cen) {
    const th = thermals[c.thermal];
    if (!th || c.circles.length < 3 || c.best <= 0) continue;
    const cs = c.circles;
    const first = idxAt(cs[0].t - (cs[0].durationS * 1000) / 2);
    const last = idxAt(cs[cs.length - 1].t + (cs[cs.length - 1].durationS * 1000) / 2);

    // late exit: trailing turns below half the thermal's best climb
    let k = cs.length;
    while (k > 0 && cs[k - 1].climb < 0.5 * c.best) k--;
    const tail = cs.slice(k);
    const tailS = tail.reduce((a, q) => a + q.durationS, 0);
    if (day && tail.length >= 2 && tailS >= 60) {
      const tailGain = tail.reduce((a, q) => a + q.climb * q.durationS, 0);
      const tailClimb = tailGain / tailS;
      if (tailClimb < 0.6 * day) {
        const lost = tailS - Math.max(0, tailGain) / day;
        if (lost >= 30) {
          improve.push({
            kind: 'improve', topic: 'late-exit', start: idxAt(tail[0].t - (tail[0].durationS * 1000) / 2), end: last, score: lost,
            v: { tailS, tailGainM: tailGain, tailClimbMs: tailClimb, bestMs: c.best, dayMs: day, turns: tail.length, lostS: lost, topM: th.topAlt },
          });
        }
      }
    }

    // slow centring
    if (c.centredAfterS != null && c.centredTurn != null && c.centredTurn >= 3 && c.centredAfterS >= 60) {
      const before = cs.slice(0, c.centredTurn - 1);
      const gainBefore = before.reduce((a, q) => a + q.climb * q.durationS, 0);
      const after = cs.slice(c.centredTurn - 1);
      const afterS = after.reduce((a, q) => a + q.durationS, 0);
      const afterClimb = afterS ? after.reduce((a, q) => a + q.climb * q.durationS, 0) / afterS : c.best;
      const beforeS = before.reduce((a, q) => a + q.durationS, 0);
      const beforeClimb = beforeS ? gainBefore / beforeS : 0;
      const lost = beforeS - Math.max(0, gainBefore) / Math.max(0.3, afterClimb);
      // a thermal that simply gets stronger higher up is not a centring problem
      const reallyWeakBefore = beforeClimb < 0.6 * afterClimb && (day == null || beforeClimb < day);
      // weak thermals are reported as such, not twice
      const weakThermal = day != null && th.avgClimb < 0.5 * day;
      if (lost >= 30 && reallyWeakBefore && !weakThermal) {
        improve.push({
          kind: 'improve', topic: 'slow-centring', start: first, end: idxAt(cs[c.centredTurn - 1].t), score: lost,
          v: { centredS: c.centredAfterS, turns: c.centredTurn, beforeMs: beforeS ? gainBefore / beforeS : 0, afterMs: afterClimb, lostS: lost, baseM: th.baseAlt },
        });
      }
    }
    if (c.centredAfterS != null && c.centredTurn != null && c.centredTurn <= 2 && th.gain >= 200) {
      good.push({ kind: 'good', topic: 'fast-centring', start: first, end: last, score: th.gain / Math.max(10, c.centredAfterS), v: { centredS: c.centredAfterS, gainM: th.gain, climbMs: th.avgClimb } });
    }

    // weak thermal taken although the day offered more
    if (day && th.avgClimb < 0.5 * day && th.gain >= 100 && th.durationS >= 120) {
      const lost = th.durationS - th.gain / day;
      if (lost >= 60) {
        improve.push({
          kind: 'improve', topic: 'weak-thermal', start: th.start, end: th.end, score: lost * 0.6,
          v: { climbMs: th.avgClimb, dayMs: day, gainM: th.gain, durS: th.durationS, lostS: lost, baseM: th.baseAlt },
        });
      }
    }
  }

  // best thermal: highest average climb with a real height gain
  const bestTh = thermals.filter((t) => t.gain >= 250).sort((a, b) => b.avgClimb - a.avgClimb)[0];
  if (bestTh) {
    good.push({
      kind: 'good', topic: 'best-thermal', start: bestTh.start, end: bestTh.end, score: 1000 + bestTh.avgClimb,
      v: { climbMs: bestTh.avgClimb, gainM: bestTh.gain, durS: bestTh.durationS, topM: bestTh.topAlt, dayMs: day ?? 0 },
    });
  }

  // ---- glides: headwind or sink at trim speed, best glide
  if (airspeed) {
    const trim = airspeed.trimKmh;
    for (const g of glides) {
      if (g.airKmh == null || g.windAlongKmh == null || g.durationS < 120) continue;
      const atTrim = g.airKmh < trim + 3;
      const groundKmh = g.avgSpeedKmh;
      // what 8 km/h more airspeed would save over this distance, without changing anything else
      const saved = (g.distanceKm / Math.max(5, groundKmh) - g.distanceKm / Math.max(5, groundKmh + 8)) * 3600;
      if (atTrim && g.windAlongKmh <= -8) {
        improve.push({
          kind: 'improve', topic: 'headwind-trim', start: g.start, end: g.end, score: saved,
          v: { headKmh: -g.windAlongKmh, airKmh: g.airKmh, trimKmh: trim, groundKmh, distKm: g.distanceKm, durS: g.durationS, ratio: g.ratio ?? 0, savedS: saved },
        });
      } else if (atTrim && g.avgVario <= -1.8) {
        improve.push({
          kind: 'improve', topic: 'sink-trim', start: g.start, end: g.end, score: saved * 0.8,
          v: { sinkMs: -g.avgVario, airKmh: g.airKmh, trimKmh: trim, distKm: g.distanceKm, durS: g.durationS, savedS: saved },
        });
      }
    }
    if (airspeed.accelShareHeadwind != null && airspeed.accelShareTailwind != null && airspeed.accelShareHeadwind > airspeed.accelShareTailwind + 0.1) {
      good.push({
        kind: 'good', topic: 'speed-to-fly', start: 0, end: n - 1, score: 500 + airspeed.accelShareHeadwind,
        v: { headPct: airspeed.accelShareHeadwind * 100, tailPct: airspeed.accelShareTailwind * 100, accelS: airspeed.acceleratedS },
      });
    }
  }
  const bestGlide = glides.filter((g) => g.distanceKm >= 3 && g.ratio != null && g.loss > 100).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];
  if (bestGlide) {
    good.push({
      kind: 'good', topic: 'best-glide', start: bestGlide.start, end: bestGlide.end, score: 900 + (bestGlide.ratio ?? 0),
      v: { ratio: bestGlide.ratio ?? 0, airRatio: bestGlide.airRatio ?? 0, distKm: bestGlide.distanceKm, lossM: bestGlide.loss, airKmh: bestGlide.airKmh ?? 0, windKmh: bestGlide.windAlongKmh ?? 0 },
    });
  }

  // ---- circle size: tight circles climbed clearly better than wide ones
  {
    const inTh = circles.filter((c) => c.thermal >= 0);
    if (inTh.length >= 30) {
      const sorted = [...inTh].sort((a, b) => a.radiusM - b.radiusM);
      const third = Math.floor(sorted.length / 3);
      const mean = (l: CircleStat[]) => l.reduce((a, c) => a + c.climb * c.durationS, 0) / l.reduce((a, c) => a + c.durationS, 0);
      const tight = sorted.slice(0, third);
      const wide = sorted.slice(-third);
      const ct = mean(tight), cw = mean(wide);
      if (ct - cw >= 0.3) {
        const wideS = wide.reduce((a, c) => a + c.durationS, 0);
        const lost = wideS * (1 - cw / ct);
        improve.push({
          kind: 'improve', topic: 'circle-size', start: 0, end: n - 1, score: lost * 0.7,
          v: { tightD: 2 * tight[tight.length - 1].radiusM, wideD: 2 * wide[0].radiusM, tightMs: ct, wideMs: cw, wideS, lostS: lost },
        });
      }
    }
  }

  // ---- fastest 30 minutes: straight-line progress
  {
    const WIN = 1800;
    let best = 0, bi = 0, bj = 0, j = 0;
    for (let i = 0; i < n; i++) {
      while (j < n - 1 && s.s[j] - s.s[i] < WIN) j++;
      if (s.s[j] - s.s[i] < WIN * 0.95) break;
      const p = pts[off + i], q = pts[off + j];
      const [dx, dy] = localXY(q.lat, q.lon, p.lat, p.lon);
      const d = Math.hypot(dx, dy);
      if (d > best) { best = d; bi = i; bj = j; }
    }
    if (best > 5000) {
      good.push({ kind: 'good', topic: 'fastest-leg', start: bi, end: bj, score: 800 + best / 1000, v: { distKm: best / 1000, kmh: best / 1000 / ((s.s[bj] - s.s[bi]) / 3600) } });
    }
  }

  improve.sort((a, b) => b.score - a.score);
  good.sort((a, b) => b.score - a.score);
  // at most two findings of the same topic, so one pattern does not fill the summary
  const cap = (l: Finding[], max: number) => {
    const seen = new Map<string, number>();
    return l.filter((f) => {
      const c = (seen.get(f.topic) ?? 0) + 1;
      seen.set(f.topic, c);
      return c <= 2;
    }).slice(0, max);
  };
  return { improve: cap(improve, 6), good: cap(good, 5), dayClimbMs: day };
}
