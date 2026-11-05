import { localXY } from './geo';
import type { Glide, Series, TrackPoint } from './types';

/**
 * Airspeed from the wind triangle: ground velocity (GPS) minus wind velocity = velocity through the air.
 * The wind comes from the circle fits of the thermals nearest in time, so it is an estimate: wind can
 * change with height and time between the thermal and the glide. Only straight flight is evaluated.
 */

export interface AirPhase {
  /** inclusive indices relative to the flight */
  start: number;
  end: number;
  durationS: number;
  /** mean airspeed, km/h */
  airKmh: number;
  groundKmh: number;
  /** mean vertical speed, m/s (negative = sinking) */
  vario: number;
  /** wind along the track, km/h: positive = tailwind, negative = headwind */
  windAlongKmh: number;
}

export interface AirspeedStats {
  /** estimated trim speed: lower-third airspeed of straight flight, km/h */
  trimKmh: number;
  /** highest airspeed held for 20 s, km/h */
  max20sKmh: number;
  /** straight flight with a wind estimate, s */
  evaluatedS: number;
  /** time flown at least ACCEL_DELTA above trim, s */
  acceleratedS: number;
  /** accelerated phases of at least MIN_PHASE_S */
  phases: AirPhase[];
  /** share of accelerated time in headwind (< −5 km/h) and tailwind (> +5 km/h) glides */
  accelShareHeadwind: number | null;
  accelShareTailwind: number | null;
  /** airspeed per flight point, km/h; NaN while circling or without wind */
  air: Float32Array;
}

export const ACCEL_DELTA_KMH = 6;
const MIN_PHASE_S = 20;
const HALF_WIN_S = 5;

type WindAt = (i: number) => { vx: number; vy: number } | null;

export function airspeedStats(pts: TrackPoint[], off: number, s: Series, glides: Glide[], windAt: WindAt): AirspeedStats | null {
  const n = s.s.length;
  const air = new Float32Array(n).fill(NaN);
  const along = new Float32Array(n).fill(NaN);
  const ground = new Float32Array(n).fill(NaN);
  for (const g of glides) {
    const w = windAt((g.start + g.end) >> 1);
    if (!w) continue;
    let a = g.start;
    let b = g.start;
    for (let i = g.start; i <= g.end; i++) {
      while (s.s[i] - s.s[a] > HALF_WIN_S) a++;
      while (b < g.end && s.s[b + 1] - s.s[i] <= HALF_WIN_S) b++;
      const dt = s.s[b] - s.s[a];
      if (dt < 2 * HALF_WIN_S * 0.6) continue;
      const p = pts[off + a];
      const q = pts[off + b];
      const [x, y] = localXY(q.lat, q.lon, p.lat, p.lon);
      const gx = x / dt;
      const gy = y / dt;
      const gs = Math.hypot(gx, gy);
      if (gs < 1) continue;
      air[i] = Math.hypot(gx - w.vx, gy - w.vy) * 3.6;
      ground[i] = gs * 3.6;
      // wind component along the direction of travel
      along[i] = ((w.vx * gx + w.vy * gy) / gs) * 3.6;
    }
  }
  const vals: number[] = [];
  let evaluatedS = 0;
  for (let i = 1; i < n; i++) {
    if (air[i] === air[i]) {
      vals.push(air[i]);
      evaluatedS += s.s[i] - s.s[i - 1];
    }
  }
  if (vals.length < 60 || evaluatedS < 300) return null;
  vals.sort((p, q) => p - q);
  const trimKmh = vals[Math.floor(vals.length / 3)];
  const limit = trimKmh + ACCEL_DELTA_KMH;

  // accelerated phases: above the limit, short dips (≤ 6 s) bridged
  const phases: AirPhase[] = [];
  const close = (i: number, j: number) => {
    const dur = s.s[j] - s.s[i];
    if (dur >= MIN_PHASE_S) {
      let sa = 0, sg = 0, sw = 0, c = 0;
      for (let t = i; t <= j; t++) {
        if (air[t] !== air[t]) continue;
        sa += air[t]; sg += ground[t]; sw += along[t]; c++;
      }
      phases.push({
        start: i,
        end: j,
        durationS: dur,
        airKmh: sa / c,
        groundKmh: sg / c,
        vario: (s.alt[j] - s.alt[i]) / dur,
        windAlongKmh: sw / c,
      });
    }
  };
  let start = -1;
  let lastAbove = -1;
  for (let t = 0; t < n; t++) {
    if (air[t] >= limit) {
      if (start < 0) start = t;
      lastAbove = t;
    } else if (start >= 0 && (air[t] !== air[t] || s.s[t] - s.s[lastAbove] > 6)) {
      // circling or no wind ends a phase at once; short dips below the limit (≤ 6 s) are bridged
      close(start, lastAbove);
      start = -1;
    }
  }
  if (start >= 0) close(start, lastAbove);

  // max airspeed held for 20 s (sliding mean over valid points)
  let max20sKmh = 0;
  {
    let a = 0, sum = 0, cnt = 0;
    for (let b = 0; b < n; b++) {
      if (air[b] === air[b]) { sum += air[b]; cnt++; }
      while (s.s[b] - s.s[a] > 20) {
        if (air[a] === air[a]) { sum -= air[a]; cnt--; }
        a++;
      }
      // only windows that are (almost) fully covered by straight flight
      if (s.s[b] - s.s[a] >= 18 && cnt >= (b - a + 1) * 0.8 && cnt > 0) max20sKmh = Math.max(max20sKmh, sum / cnt);
    }
  }

  // acceleration by wind situation
  let accHead = 0, totHead = 0, accTail = 0, totTail = 0, acceleratedS = 0;
  for (let t = 1; t < n; t++) {
    if (air[t] !== air[t]) continue;
    const dt = s.s[t] - s.s[t - 1];
    const acc = air[t] >= limit;
    if (acc) acceleratedS += dt;
    if (along[t] < -5) { totHead += dt; if (acc) accHead += dt; }
    if (along[t] > 5) { totTail += dt; if (acc) accTail += dt; }
  }
  return {
    trimKmh,
    max20sKmh,
    evaluatedS,
    acceleratedS,
    phases,
    accelShareHeadwind: totHead >= 120 ? accHead / totHead : null,
    accelShareTailwind: totTail >= 120 ? accTail / totTail : null,
    air,
  };
}
