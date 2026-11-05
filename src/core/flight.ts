import { angleDiff, bearingDeg, distM, localXY } from './geo';
import { airspeedStats } from './airspeed';
import { reviewFlight } from './review';
import { resolvePolar, type PolarChoice } from './polars';
import { gainLoss, windowRate } from './series';
import type { CircleStat, Circling, CorePoint, FlightMode, FlightStats, Glide, Range, Series, Thermal, TrackPoint, Wind } from './types';

const AIRBORNE_KMH = 12;
const AIRBORNE_VARIO = 1.5;
const MIN_FLIGHT_S = 60;
const MERGE_GAP_S = 180;

/**
 * Finds the main flight in a track: the longest run of "airborne" fixes
 * (ground speed or vertical speed clearly above walking) after merging short pauses.
 */
export function detectFlight(pts: TrackPoint[], series: Series): Range | null {
  const n = pts.length;
  const runs: Range[] = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const air = series.speed[i] > AIRBORNE_KMH || Math.abs(series.vario[i]) > AIRBORNE_VARIO;
    if (air && start < 0) start = i;
    if ((!air || i === n - 1) && start >= 0) {
      const end = air ? i : i - 1;
      const last = runs[runs.length - 1];
      if (last && series.s[start] - series.s[last.end] < MERGE_GAP_S) last.end = end;
      else runs.push({ start, end });
      start = -1;
    }
  }
  let best: Range | null = null;
  for (const r of runs) {
    const dur = series.s[r.end] - series.s[r.start];
    if (dur >= MIN_FLIGHT_S && (!best || dur > series.s[best.end] - series.s[best.start])) best = r;
  }
  return best;
}

/** Unwrapped heading (degrees) per point, from neighbours ±1 */
function unwrappedHeading(pts: TrackPoint[], r: Range): Float64Array {
  const n = r.end - r.start + 1;
  const H = new Float64Array(n);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const a = pts[r.start + Math.max(0, i - 1)];
    const b = pts[r.start + Math.min(n - 1, i + 1)];
    const moved = distM(a.lat, a.lon, b.lat, b.lon) > 1;
    const h = moved ? bearingDeg(a.lat, a.lon, b.lat, b.lon) : prev;
    if (Number.isNaN(prev)) H[i] = Number.isNaN(h) ? 0 : h;
    else H[i] = H[i - 1] + angleDiff(prev, Number.isNaN(h) ? prev : h);
    prev = Number.isNaN(h) ? prev : h;
  }
  return H;
}

const TURN_RATE = 6; // deg/s — slower than one circle per minute is not circling
const TURN_WIN = 10; // ±s
const MIN_TURN = 300; // deg — a circling phase must contain at least most of a full circle

/** Circling phases inside a flight. Indices are relative to the flight's series. */
export function detectCircling(pts: TrackPoint[], r: Range, s: Series): { circlings: Circling[]; heading: Float64Array } {
  const H = unwrappedHeading(pts, r);
  const n = H.length;
  const sign = new Int8Array(n);
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    while (s.s[i] - s.s[a] > TURN_WIN) a++;
    while (b + 1 < n && s.s[b + 1] - s.s[i] <= TURN_WIN) b++;
    const dt = s.s[b] - s.s[a];
    const rate = dt > 0 ? (H[b] - H[a]) / dt : 0;
    sign[i] = rate > TURN_RATE ? 1 : rate < -TURN_RATE ? -1 : 0;
  }
  const raw: { start: number; end: number; dir: 1 | -1 }[] = [];
  for (let i = 0; i < n; i++) {
    if (!sign[i]) continue;
    const dir = sign[i] as 1 | -1;
    let j = i;
    while (j + 1 < n && sign[j + 1] === dir) j++;
    const last = raw[raw.length - 1];
    if (last && last.dir === dir && s.s[i] - s.s[last.end] <= 8) last.end = j;
    else raw.push({ start: i, end: j, dir });
    i = j;
  }
  const circlings: Circling[] = [];
  for (const c of raw) {
    const turn = Math.abs(H[c.end] - H[c.start]);
    if (turn < MIN_TURN) continue;
    circlings.push({
      start: c.start,
      end: c.end,
      dir: c.dir,
      circles: Math.max(1, Math.round(turn / 360)),
      gain: s.alt[c.end] - s.alt[c.start],
      durationS: s.s[c.end] - s.s[c.start],
    });
  }
  return { circlings, heading: H };
}

/**
 * Wind from one circle: ground velocity vectors of a circle at constant airspeed lie on a
 * circle whose centre is the wind vector. Kåsa least-squares circle fit.
 */
function windFromCircle(pts: TrackPoint[], off: number, from: number, to: number): { vx: number; vy: number; airspeed: number } | null {
  const vs: [number, number][] = [];
  const ref = pts[off + from];
  for (let i = from; i < to; i++) {
    const p = pts[off + i];
    const q = pts[off + i + 1];
    const dt = (q.t - p.t) / 1000;
    if (dt <= 0 || dt > 5) continue;
    const [x1, y1] = localXY(p.lat, p.lon, ref.lat, ref.lon);
    const [x2, y2] = localXY(q.lat, q.lon, ref.lat, ref.lon);
    vs.push([(x2 - x1) / dt, (y2 - y1) / dt]);
  }
  if (vs.length < 8) return null;
  // Solve [x y 1]·[D E F]ᵀ = -(x²+y²) in least squares
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sz = 0, sxz = 0, syz = 0;
  const N = vs.length;
  for (const [x, y] of vs) {
    const z = x * x + y * y;
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    sz += z; sxz += x * z; syz += y * z;
  }
  const M = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, N],
  ];
  const rhs = [-sxz, -syz, -sz];
  const sol = solve3(M, rhs);
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (r2 <= 0) return null;
  const airspeed = Math.sqrt(r2);
  if (airspeed < 4 || airspeed > 30) return null;
  // residual check: reject badly shaped circles
  let res = 0;
  for (const [x, y] of vs) res += (Math.hypot(x - cx, y - cy) - airspeed) ** 2;
  if (Math.sqrt(res / N) > airspeed * 0.35) return null;
  return { vx: cx, vy: cy, airspeed };
}

function solve3(A: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-9) return null;
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / d);
}

function toWind(vx: number, vy: number, alt: number, t: number): Wind {
  // (vx, vy) is where the air moves TO (east, north); "from" is opposite
  const toDeg = (Math.atan2(vx, vy) * 180) / Math.PI;
  return { fromDeg: (toDeg + 180 + 360) % 360, speedKmh: Math.hypot(vx, vy) * 3.6, alt, t };
}

export function analyzeFlight(pts: TrackPoint[], r: Range, s: Series, polarChoice: PolarChoice | null = null, glider?: string): FlightStats {
  const n = r.end - r.start + 1;
  const last = n - 1;
  const { circlings, heading } = detectCircling(pts, r, s);

  // winds, one per full circle; plus the centre of every full circle
  const winds: Wind[] = [];
  const circleWinds: { i: number; vx: number; vy: number }[] = [];
  const centres: (CorePoint & { i: number })[] = [];
  const circles: (CircleStat & { i: number })[] = [];
  for (const c of circlings) {
    let i0 = c.start;
    for (let i = c.start + 1; i <= c.end; i++) {
      if (Math.abs(heading[i] - heading[i0]) >= 360) {
        const w = windFromCircle(pts, r.start, i0, i);
        const mid = (i0 + i) >> 1;
        if (w) {
          winds.push(toWind(w.vx, w.vy, s.alt[mid], pts[r.start + mid].t));
          circleWinds.push({ i: mid, vx: w.vx, vy: w.vy });
        }
        const ce = circleCentre(pts, r.start, s, i0, i);
        if (ce) centres.push({ ...ce, i: mid });
        const cs = circleStat(pts, r.start, s, i0, i, c.dir, w?.airspeed ?? null);
        if (cs) circles.push({ ...cs, thermal: -1, i: mid });
        i0 = i;
      }
    }
  }
  let wind: Wind | null = null;
  if (circleWinds.length) {
    const vx = circleWinds.reduce((a, w) => a + w.vx, 0) / circleWinds.length;
    const vy = circleWinds.reduce((a, w) => a + w.vy, 0) / circleWinds.length;
    const lastW = winds[winds.length - 1];
    wind = toWind(vx, vy, lastW.alt, lastW.t);
  }

  // thermals: circling phases closer than 60 s merged, at least 30 m gained
  const thermals: Thermal[] = [];
  let group: Circling[] = [];
  /** whole span of each thermal's circling group, including straight bits between its circling phases */
  const thermalSpans: [number, number][] = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0].start;
    const end = group[group.length - 1].end;
    let lo = start;
    let hi = start;
    for (let i = start; i <= end; i++) {
      if (s.alt[i] > s.alt[hi]) hi = i;
    }
    for (let i = start; i <= hi; i++) if (s.alt[i] < s.alt[lo]) lo = i;
    const gain = s.alt[hi] - s.alt[lo];
    const dur = s.s[hi] - s.s[lo];
    if (gain >= 30 && dur > 0) {
      for (const ci of circles) if (ci.i >= start && ci.i <= end) ci.thermal = thermals.length;
      thermalSpans.push([start, end]);
      const ws = circleWinds.filter((w) => w.i >= start && w.i <= end);
      const core = centres.filter((c) => c.i >= start && c.i <= end).map(({ i: _, ...c }) => c);
      const mid = pts[r.start + ((lo + hi) >> 1)];
      thermals.push({
        start: lo,
        end: hi,
        gain,
        avgClimb: gain / dur,
        durationS: dur,
        baseAlt: s.alt[lo],
        topAlt: s.alt[hi],
        lat: mid.lat,
        lon: mid.lon,
        wind: ws.length
          ? toWind(ws.reduce((a, w) => a + w.vx, 0) / ws.length, ws.reduce((a, w) => a + w.vy, 0) / ws.length, s.alt[hi], mid.t)
          : undefined,
        core: core.length ? core : undefined,
        drift: driftWind(core),
      });
    }
    group = [];
  };
  for (const c of circlings) {
    const prev = group[group.length - 1];
    if (prev && s.s[c.start] - s.s[prev.end] > 60) flush();
    group.push(c);
  }
  flush();

  // per-point classification
  const inCircle = new Uint8Array(n);
  for (const c of circlings) inCircle.fill(1, c.start, c.end + 1);
  const inThermal = new Uint8Array(n);
  for (const [a, b] of thermalSpans) inThermal.fill(1, a, b + 1);
  const modeTime: Record<FlightMode, number> = { climb: 0, glide: 0, circling: 0, sink: 0 };
  let strongSink = 0;
  for (let i = 1; i < n; i++) {
    const dt = s.s[i] - s.s[i - 1];
    const v = s.vario[i];
    const mode: FlightMode = inCircle[i] ? 'circling' : v > 0.5 ? 'climb' : v < -2 ? 'sink' : 'glide';
    modeTime[mode] += dt;
    if (v < -2) strongSink += dt;
  }

  // glides: non-circling stretches
  let glideDist = 0;
  let glideLoss = 0;
  const glides: Glide[] = [];
  let gs = -1;
  for (let i = 0; i <= n; i++) {
    // straight flight between thermals; re-centring inside a thermal is part of the thermal
    const straight = i < n && !inCircle[i] && !inThermal[i];
    if (straight && gs < 0) gs = i;
    if (!straight && gs >= 0) {
      const ge = i - 1;
      const loss = s.alt[gs] - s.alt[ge];
      const durS = s.s[ge] - s.s[gs];
      const distKm = s.dist[ge] - s.dist[gs];
      if (durS >= 30 && loss > 20) {
        glideDist += distKm * 1000;
        glideLoss += loss;
      }
      if (durS >= 30 && distKm >= 0.3) {
        const w = windNear(circleWinds, (gs + ge) >> 1);
        const air = w ? airDistanceM(pts, r.start, gs, ge, w.vx, w.vy) : null;
        glides.push({
          start: gs,
          end: ge,
          durationS: durS,
          distanceKm: distKm,
          loss,
          ratio: loss > 5 ? (distKm * 1000) / loss : null,
          airRatio: air != null && loss > 5 ? air / loss : null,
          avgSpeedKmh: (distKm / durS) * 3600,
          avgVario: -loss / durS,
        });
      }
      gs = -1;
    }
  }
  // airspeed from the wind triangle, per glide and accelerated phases
  const air = airspeedStats(pts, r.start, s, glides, (i) => windNear(circleWinds, i));
  if (air) {
    for (const g of glides) {
      let sa = 0, sw = 0, c = 0;
      const w = windNear(circleWinds, (g.start + g.end) >> 1);
      for (let i = g.start; i <= g.end; i++) if (air.air[i] === air.air[i]) { sa += air.air[i]; c++; }
      if (c && w) {
        // wind along the straight line of the glide
        const p = pts[r.start + g.start];
        const q = pts[r.start + g.end];
        const [dx, dy] = localXY(q.lat, q.lon, p.lat, p.lon);
        const d = Math.hypot(dx, dy);
        if (d > 0) sw = ((w.vx * dx + w.vy * dy) / d) * 3.6;
        g.airKmh = sa / c;
        g.windAlongKmh = sw;
      }
    }
  }

  let bestGlide: number | null = null;
  {
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (j < n && s.s[j] - s.s[i] < 60) j++;
      if (j >= n) break;
      const loss = s.alt[i] - s.alt[j];
      if (loss < 30) continue;
      const ratio = ((s.dist[j] - s.dist[i]) * 1000) / loss;
      if (bestGlide == null || ratio > bestGlide) bestGlide = ratio;
    }
  }

  const altRaw = Array.from({ length: n }, (_, i) => pts[r.start + i].alt);
  const [totalClimb, totalDescent] = gainLoss(s.alt, 0, last, 5);
  const [bestClimb30s, worstSink30s] = windowRate(s.s, s.alt, 30);
  const circlingS = circlings.reduce((a, c) => a + c.durationS, 0);
  const thermalS = thermals.reduce((a, t) => a + t.durationS, 0);
  const thermalGain = thermals.reduce((a, t) => a + t.gain, 0);
  const left = circlings.filter((c) => c.dir < 0);
  const right = circlings.filter((c) => c.dir > 0);
  const nCircles = circlings.reduce((a, c) => a + c.circles, 0);
  const airtimeS = s.s[last];
  const p0 = pts[r.start];
  const p1 = pts[r.end];
  const launchAlt = s.alt[0];
  const maxAlt = Math.max(...altRaw);

  const avgClimbInThermals = thermalS > 0 ? thermalGain / thermalS : null;
  const polar = resolvePolar(polarChoice, glider);
  const review = reviewFlight({ pts, off: r.start, s, thermals, circles, glides, airspeed: air, avgClimbInThermals, polar: polar.polar });

  return {
    review,
    polar: polar.info,
    launchIdx: r.start,
    landingIdx: r.end,
    launchTime: p0.t,
    landingTime: p1.t,
    airtimeS,
    trackLengthKm: s.dist[last],
    launchToLandingKm: distM(p0.lat, p0.lon, p1.lat, p1.lon) / 1000,
    minAlt: Math.min(...altRaw),
    maxAlt,
    launchAlt,
    landingAlt: s.alt[last],
    maxGainAboveLaunch: Math.max(0, maxAlt - launchAlt),
    totalClimb,
    totalDescent,
    avgSpeedKmh: airtimeS > 0 ? (s.dist[last] / airtimeS) * 3600 : 0,
    maxSpeedKmh: Math.max(...s.speed),
    avgGlideRatio: glideLoss > 0 ? glideDist / glideLoss : null,
    bestGlide60s: bestGlide,
    bestClimb30s,
    worstSink30s,
    avgClimbInThermals,
    timeCirclingS: circlingS,
    timeClimbingInThermalsS: thermalS,
    timeNotCirclingS: airtimeS - circlingS,
    timeStrongSinkS: strongSink,
    circlesLeft: left.reduce((a, c) => a + c.circles, 0),
    circlesRight: right.reduce((a, c) => a + c.circles, 0),
    circlingLeftS: left.reduce((a, c) => a + c.durationS, 0),
    circlingRightS: right.reduce((a, c) => a + c.durationS, 0),
    avgTimePerCircleS: nCircles ? circlingS / nCircles : null,
    circlings,
    circles: circles.map(({ i: _, ...c }) => c),
    thermals,
    glides,
    airspeed: air ? (({ air: _, ...rest }) => rest)(air) : null,
    winds,
    wind,
    modeShare: modeTime,
  };
}

const G = 9.81;

/**
 * Size and steepness of one full turn. The radius is taken relative to the air: with the airspeed
 * from the wind fit r = v·T / 2π; without it, from the path flown relative to the ground (slightly
 * off in wind, but the wind adds as much on one side as it takes on the other).
 * Bank from a coordinated turn: tan φ = v² / (g·r) = 4π²·r / (g·T²).
 */
function circleStat(
  pts: TrackPoint[], off: number, s: Series, from: number, to: number, dir: 1 | -1, airspeed: number | null,
): Omit<CircleStat, 'thermal'> | null {
  const T = s.s[to] - s.s[from];
  if (T < 8 || T > 120) return null;
  let path = 0;
  let sa = 0;
  for (let i = from; i < to; i++) {
    const p = pts[off + i];
    const q = pts[off + i + 1];
    path += distM(p.lat, p.lon, q.lat, q.lon);
    sa += ((s.alt[i] + s.alt[i + 1]) / 2) * (s.s[i + 1] - s.s[i]);
  }
  const v = airspeed ?? path / T;
  const radiusM = (v * T) / (2 * Math.PI);
  if (radiusM < 5 || radiusM > 400) return null;
  const mid = pts[off + ((from + to) >> 1)];
  return {
    t: mid.t,
    alt: sa / T,
    durationS: T,
    dir,
    climb: (s.alt[to] - s.alt[from]) / T,
    radiusM,
    bankDeg: (Math.atan((4 * Math.PI ** 2 * radiusM) / (G * T * T)) * 180) / Math.PI,
    airspeedKmh: airspeed != null ? airspeed * 3.6 : null,
  };
}

/**
 * Centre of one full circle: time-weighted mean position over the turn.
 * Flying a centred circle at constant airspeed, the motion relative to the air averages out
 * over one turn, so the mean is where the circle centre was at mid-time (it drifts with the air).
 */
function circleCentre(pts: TrackPoint[], off: number, s: Series, from: number, to: number): CorePoint | null {
  const ref = pts[off + from];
  let sx = 0, sy = 0, sa = 0, st = 0, sw = 0;
  for (let i = from; i < to; i++) {
    const p = pts[off + i];
    const q = pts[off + i + 1];
    const dt = (q.t - p.t) / 1000;
    if (dt <= 0 || dt > 10) continue;
    const [x1, y1] = localXY(p.lat, p.lon, ref.lat, ref.lon);
    const [x2, y2] = localXY(q.lat, q.lon, ref.lat, ref.lon);
    sx += ((x1 + x2) / 2) * dt;
    sy += ((y1 + y2) / 2) * dt;
    sa += ((s.alt[i] + s.alt[i + 1]) / 2) * dt;
    st += ((p.t + q.t) / 2) * dt;
    sw += dt;
  }
  if (sw < 10) return null;
  const x = sx / sw;
  const y = sy / sw;
  const k = Math.cos((ref.lat * Math.PI) / 180);
  return {
    lat: ref.lat + (y / 6371008.8) * (180 / Math.PI),
    lon: ref.lon + (x / (6371008.8 * k)) * (180 / Math.PI),
    alt: sa / sw,
    t: st / sw,
  };
}

/** Wind from the drift of circle centres: least-squares velocity of the centre positions over time */
export function driftWind(core: CorePoint[]): Wind | undefined {
  if (core.length < 3) return undefined;
  const span = (core[core.length - 1].t - core[0].t) / 1000;
  if (span < 60) return undefined;
  const ref = core[0];
  const t0 = core.reduce((a, c) => a + c.t, 0) / core.length;
  let stt = 0, stx = 0, sty = 0;
  for (const c of core) {
    const [x, y] = localXY(c.lat, c.lon, ref.lat, ref.lon);
    const dt = (c.t - t0) / 1000;
    stt += dt * dt;
    stx += dt * x;
    sty += dt * y;
  }
  // time is centred (Σdt = 0), so the slope needs no intercept term
  const vx = stx / stt;
  const vy = sty / stt;
  if (Math.hypot(vx, vy) > 25) return undefined;
  const top = core.reduce((a, c) => (c.alt > a.alt ? c : a), core[0]);
  return toWind(vx, vy, top.alt, top.t);
}

/** Average of the circle winds closest in time (index distance) to point i */
function windNear(ws: { i: number; vx: number; vy: number }[], i: number): { vx: number; vy: number } | null {
  if (!ws.length) return null;
  const near = [...ws].sort((a, b) => Math.abs(a.i - i) - Math.abs(b.i - i)).slice(0, 4);
  return { vx: near.reduce((a, w) => a + w.vx, 0) / near.length, vy: near.reduce((a, w) => a + w.vy, 0) / near.length };
}

/** Distance flown relative to the air mass: ground displacement minus wind drift, step by step */
function airDistanceM(pts: TrackPoint[], off: number, from: number, to: number, wx: number, wy: number): number {
  let d = 0;
  for (let i = from; i < to; i++) {
    const p = pts[off + i];
    const q = pts[off + i + 1];
    const dt = (q.t - p.t) / 1000;
    const [x, y] = localXY(q.lat, q.lon, p.lat, p.lon);
    d += Math.hypot(x - wx * dt, y - wy * dt);
  }
  return d;
}
