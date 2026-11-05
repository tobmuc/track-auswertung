import type { ActivityResult } from '../app/types';
import type { Glide, Thermal, Wind } from '../core';
import type { Terrain } from './terrain';

/** Track in the local 3D frame plus derived values the scene, director and HUD share */
/** timeline mode code for circling (see app/colors.ts) */
const CIRCLING = 4;

export interface Model {
  res: ActivityResult;
  terrain: Terrain;
  n: number;
  x: Float64Array;
  z: Float64Array;
  /** altitude m MSL (not exaggerated) */
  alt: Float64Array;
  /** terrain mesh height under each point (m MSL) */
  ground: Float64Array;
  /** height above ground; from the precise ground profile when one is given, else from the mesh */
  agl: Float64Array;
  /** cumulative distance in km */
  dist: Float64Array;
  isHike: Uint8Array;
  /** exitWobble: roll/pitch amplitude (rad) of the shake when leaving the thermal, larger in crosswind */
  /** entry: first timeline index of the circling that leads into the thermal (start is its lowest point) */
  thermals: (Thermal & { idx: number; entry: number; exitClimb: number; exitWobble: number })[];
  glides: Glide[];
  winds: Wind[];
  launchIdx: number;
  landingIdx: number;
  /** unit direction of travel (x east, z south) per point */
  hx: Float32Array;
  hz: Float32Array;
  /** bank angle in radians per point, positive = right turn */
  bank: Float32Array;
  /** pitch in radians per point, positive = nose up (wing pitches back entering lift, surges leaving it) */
  pitch: Float32Array;
}

export function buildModel(res: ActivityResult, terrain: Terrain, precise?: Float32Array): Model {
  const tl = res.timeline;
  const n = tl.t.length;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const ground = new Float64Array(n);
  const dist = new Float64Array(n);
  const isHike = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    [x[i], z[i]] = terrain.frame.toXZ(tl.lat[i], tl.lon[i]);
    ground[i] = terrain.heightAt(x[i], z[i]);
    isHike[i] = res.segments[tl.seg[i]].kind === 'hike' ? 1 : 0;
    if (i > 0) dist[i] = dist[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]) / 1000;
  }
  const alt = Float64Array.from(tl.alt);
  // hike points are on the ground: avoid GPS altitude noise sinking them into the terrain
  for (let i = 0; i < n; i++) if (isHike[i]) alt[i] = Math.max(alt[i], ground[i] + 2);
  const agl = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const g = precise?.length === n && precise[i] === precise[i] ? precise[i] : ground[i];
    agl[i] = tl.alt[i] - g;
  }

  const thermals = res.segments
    .flatMap((s) => s.thermals)
    .map((t, idx) => {
      // climb in the last 60 s before leaving the thermal — the "decision" value
      let j = t.end;
      while (j > t.start && tl.t[t.end] - tl.t[j] < 60_000) j--;
      const dt = (tl.t[t.end] - tl.t[j]) / 1000;
      // entry: where the track starts circling in this thermal. The thermal itself is measured from
      // its lowest point, which often comes only after the first centring turns
      let entry = t.start;
      for (;;) {
        while (entry > 0 && tl.mode[entry - 1] === CIRCLING) entry--;
        // short straight bits between turns (re-centring) still belong to the same thermal
        let k = entry - 1;
        while (k > 0 && tl.mode[k] !== CIRCLING && tl.t[entry] - tl.t[k] < 20_000) k--;
        if (k > 0 && tl.mode[k] === CIRCLING && tl.t[entry] - tl.t[k] < 20_000) entry = k;
        else break;
      }
      return { ...t, idx, entry, exitClimb: dt > 0 ? (tl.alt[t.end] - tl.alt[j]) / dt : t.avgClimb };
    })
    .sort((a, b) => a.start - b.start);

  const flightSeg = res.segments.find((s) => s.kind === 'flight');
  const winds = res.flight?.winds ?? [];
  const { hx, hz, bank } = attitude(tl.t, x, z, tl.speed, windSeries(tl.t, winds, res.flight?.wind ?? null));
  const pitch = pitchSeries(tl.t, tl.vario, tl.speed);
  const withWobble = thermals.map((th) => {
    // crosswind = wind component across the heading when leaving the thermal
    const w = th.wind ?? th.drift ?? windAtT(winds, tl.t[th.end]);
    let cross = 0;
    if (w) {
      const to = ((w.fromDeg + 180) * Math.PI) / 180;
      const heading = Math.atan2(hx[th.end], -hz[th.end]);
      cross = Math.abs(Math.sin(to - heading)) * w.speedKmh;
    }
    // base shake from leaving the lift, plus crosswind and the strength of the thermal edge
    const exitWobble = Math.min(0.35, 0.05 + 0.012 * cross + 0.03 * Math.max(0, th.avgClimb));
    return { ...th, exitWobble };
  });
  return {
    pitch,
    hx,
    hz,
    bank,
    res,
    terrain,
    n,
    x,
    z,
    alt,
    ground,
    agl,
    dist,
    isHike,
    thermals: withWobble,
    glides: res.segments.flatMap((s) => s.glides ?? []).sort((a, b) => a.start - b.start),
    winds,
    launchIdx: flightSeg ? flightSeg.offset : 0,
    landingIdx: flightSeg ? flightSeg.offset + flightSeg.length - 1 : n - 1,
  };
}

/**
 * Wind per point in the local frame (x east, z south), m/s, as the air moves: mean of the circle winds
 * within ±5 minutes, else the flight's mean wind. null when the flight has no wind estimate.
 */
export function windSeries(t: Float64Array, winds: Wind[], mean: Wind | null): { wx: Float32Array; wz: Float32Array } | null {
  if (!winds.length && !mean) return null;
  const n = t.length;
  const wx = new Float32Array(n);
  const wz = new Float32Array(n);
  const vec = (w: Wind) => {
    const to = ((w.fromDeg + 180) * Math.PI) / 180;
    const v = w.speedKmh / 3.6;
    return [Math.sin(to) * v, -Math.cos(to) * v] as const;
  };
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    while (a < winds.length && winds[a].t < t[i] - 300_000) a++;
    while (b < winds.length && winds[b].t <= t[i] + 300_000) b++;
    let sx = 0, sz = 0;
    for (let k = a; k < b; k++) { const [vx, vz] = vec(winds[k]); sx += vx; sz += vz; }
    if (b > a) { wx[i] = sx / (b - a); wz[i] = sz / (b - a); }
    else if (mean) { const [vx, vz] = vec(mean); wx[i] = vx; wz[i] = vz; }
  }
  return { wx, wz };
}

/**
 * Heading from positions ±3 s around each point; bank from the coordinated-turn relation
 * tan(φ) = v·ω / g with v = airspeed: ground velocity minus wind. With ground speed instead, the bank
 * would swing within every circle (fast downwind, slow upwind). Smoothed over ±4 s, limited to ±55°.
 */
export function attitude(t: Float64Array, x: Float64Array, z: Float64Array, speedKmh: Float64Array, wind?: { wx: Float32Array; wz: Float32Array } | null) {
  const n = t.length;
  const hx = new Float32Array(n);
  const hz = new Float32Array(n);
  const yaw = new Float64Array(n);
  let a = 0, b = 0;
  let px = 0, pz = -1;
  for (let i = 0; i < n; i++) {
    while (t[i] - t[a] > 3000) a++;
    while (b < n - 1 && t[b + 1] - t[i] <= 3000) b++;
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const len = Math.hypot(dx, dz);
    if (len > 3) { px = dx / len; pz = dz / len; }
    hx[i] = px;
    hz[i] = pz;
    yaw[i] = Math.atan2(px, pz);
  }
  // unwrap yaw for the turn rate (compare raw angles; the unwrapped one may be many turns away)
  let prevRaw = yaw[0];
  for (let i = 1; i < n; i++) {
    const raw = yaw[i];
    let d = raw - prevRaw;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    yaw[i] = yaw[i - 1] + d;
    prevRaw = raw;
  }
  const raw = new Float64Array(n);
  a = 0; b = 0;
  for (let i = 0; i < n; i++) {
    while (t[i] - t[a] > 2000) a++;
    while (b < n - 1 && t[b + 1] - t[i] <= 2000) b++;
    const dt = (t[b] - t[a]) / 1000;
    const omega = dt > 0 ? (yaw[b] - yaw[a]) / dt : 0;
    let v = speedKmh[i] / 3.6;
    if (wind && dt > 0) {
      // airspeed from the wind triangle over the same ±2 s
      const gx = (x[b] - x[a]) / dt;
      const gz = (z[b] - z[a]) / dt;
      v = Math.hypot(gx - wind.wx[i], gz - wind.wz[i]);
    }
    // compass-clockwise (right) turns decrease yaw = atan2(x, z) in this frame
    raw[i] = Math.max(-0.96, Math.min(0.96, Math.atan((v * -omega) / 9.81)));
  }
  const bank = new Float32Array(n);
  a = 0; b = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    while (b < n && t[b] - t[i] <= 4000) sum += raw[b++];
    while (t[i] - t[a] > 4000) sum -= raw[a++];
    bank[i] = sum / (b - a);
  }
  return { hx, hz, bank };
}

/**
 * Pitch from the change of climb rate and speed: entering lift the wing pitches back (nose up),
 * leaving it the wing surges forward; braking/accelerating does the opposite. Smoothed ±3 s, ±20°.
 */
export function pitchSeries(t: Float64Array, vario: Float64Array, speedKmh: Float64Array): Float32Array {
  const n = t.length;
  const raw = new Float64Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    while (t[i] - t[a] > 2000) a++;
    while (b < n - 1 && t[b + 1] - t[i] <= 2000) b++;
    const dt = (t[b] - t[a]) / 1000;
    if (dt <= 0) continue;
    const dVario = (vario[b] - vario[a]) / dt;
    const dSpeed = (speedKmh[b] - speedKmh[a]) / 3.6 / dt;
    raw[i] = 0.45 * dVario - 0.2 * dSpeed;
  }
  const out = new Float32Array(n);
  a = 0; b = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    while (b < n && t[b] - t[i] <= 3000) sum += raw[b++];
    while (t[i] - t[a] > 3000) sum -= raw[a++];
    out[i] = Math.max(-0.35, Math.min(0.35, sum / (b - a)));
  }
  return out;
}

function windAtT(winds: Wind[], t: number): Wind | null {
  let w: Wind | null = null;
  for (const x of winds) {
    if (x.t <= t) w = x;
    else break;
  }
  return w ?? winds[0] ?? null;
}

/** Linear interpolation of a series at a fractional index */
export function lerpAt(a: ArrayLike<number>, fi: number): number {
  const i = Math.min(a.length - 1, Math.max(0, Math.floor(fi)));
  const f = fi - i;
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * f : a[i];
}

/** Last measured wind at or before time t */
export function windAt(m: Model, t: number): Wind | null {
  let w: Wind | null = null;
  for (const x of m.winds) {
    if (x.t <= t) w = x;
    else break;
  }
  return w;
}
