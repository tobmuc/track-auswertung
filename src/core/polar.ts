/**
 * Glider polar: sink rate over airspeed, fitted as a parabola s(v) = a·v² + b·v + c through measured
 * or published points (v in m/s, s positive = sinking, m/s).
 *
 * Used for
 * - netto vario: vertical motion of the air = measured vario + polar sink at the flown airspeed
 * - speed to fly (MacCready) with wind: the airspeed that minimises the time per distance including the
 *   time to climb back the height lost, 1/(v+w) · (1 + (s(v) − n)/mc)
 * - best glide over the ground in wind (mc → 0): maximise (v + w)/(s(v) − n)
 */

export interface Polar {
  /** 'quad': s = a·v² + b·v + c (fitted through points); 'korner': s = a·v³ + b/v (Korner 2026) */
  form: 'quad' | 'korner';
  a: number;
  b: number;
  c: number;
  /** speed range covered by the points, m/s */
  vMin: number;
  vMax: number;
}

/** Least-squares parabola through the points; speeds scaled by sqrt(weight ratio) when weights are given */
export function fitPolar(points: [number, number][], weightKg?: number, refWeightKg?: number): Polar {
  const k = weightKg && refWeightKg ? Math.sqrt(weightKg / refWeightKg) : 1;
  const pts = points.map(([kmh, s]) => [(kmh / 3.6) * k, s * k] as const);
  // normal equations for s = a v² + b v + c
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (const [v, s] of pts) {
    s0 += 1; s1 += v; s2 += v * v; s3 += v ** 3; s4 += v ** 4;
    t0 += s; t1 += s * v; t2 += s * v * v;
  }
  const M = [[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]];
  const r = [t2, t1, t0];
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(M);
  const col = (i: number) => det(M.map((row, j) => row.map((x, q) => (q === i ? r[j] : x))));
  const vs = pts.map((p) => p[0]);
  return { form: 'quad', a: col(0) / d, b: col(1) / d, c: col(2) / d, vMin: Math.min(...vs), vMax: Math.max(...vs) };
}

/** Polar sink at airspeed v (m/s), positive = sinking */
export const sinkAt = (p: Polar, v: number) => (p.form === 'korner' ? p.a * v ** 3 + p.b / v : p.a * v * v + p.b * v + p.c);

/** Korner form from the study's coefficients (positive a, b); range in km/h */
export function kornerPolar(a: number, b: number, fromKmh: number, toKmh: number): Polar {
  return { form: 'korner', a, b, c: 0, vMin: fromKmh / 3.6, vMax: toKmh / 3.6 };
}

/** Best glide in still air: v with the highest v/s(v) inside the polar's range */
export function bestGlide(p: Polar): { v: number; ratio: number; sink: number } {
  return optimise(p, (v) => v / sinkAt(p, v));
}

/** Minimum sink in the polar's range */
export function minSink(p: Polar): { v: number; sink: number } {
  let best = { v: p.vMin, sink: sinkAt(p, p.vMin) };
  for (let v = p.vMin; v <= p.vMax; v += 0.05) {
    const s = sinkAt(p, v);
    if (s < best.sink) best = { v, sink: s };
  }
  return best;
}

/**
 * Speed to fly. windAlong: + tailwind, m/s. netto: vertical air motion, + rising, m/s.
 * mc: expected climb in the next thermal, m/s; mc ≤ 0.05 gives best glide over the ground.
 * Returns the airspeed and the time per metre at that speed (s/m).
 */
export function speedToFly(p: Polar, windAlong: number, netto: number, mc: number): { v: number; timePerM: number } {
  const res = optimise(p, (v) => -timePerMetre(p, v, windAlong, netto, mc));
  return { v: res.v, timePerM: timePerMetre(p, res.v, windAlong, netto, mc) };
}

/**
 * Time per metre of track including the climb needed to win back the height lost (MacCready).
 * With mc → 0 the time term vanishes and only the glide matters; we then use a tiny mc so the
 * function still prefers the better glide.
 */
export function timePerMetre(p: Polar, v: number, windAlong: number, netto: number, mc: number): number {
  const ground = v + windAlong;
  if (ground <= 0.5) return Infinity;
  const loss = Math.max(0, sinkAt(p, v) - netto);
  const m = Math.max(0.05, mc);
  return (1 + loss / m) / ground;
}

function optimise(p: Polar, f: (v: number) => number): { v: number; ratio: number; sink: number } {
  let bv = p.vMin, bf = -Infinity;
  for (let v = p.vMin; v <= p.vMax + 1e-9; v += 0.05) {
    const x = f(v);
    if (x > bf) { bf = x; bv = v; }
  }
  return { v: bv, ratio: bv / sinkAt(p, bv), sink: sinkAt(p, bv) };
}
