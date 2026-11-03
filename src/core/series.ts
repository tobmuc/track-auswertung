import { distM } from './geo';
import type { Range, Series, TrackPoint } from './types';

/**
 * Derived per-point series for a slice of points.
 * Vario and speed use a centred time window (±halfWinS) so they work for 1 Hz IGC and sparse GPX alike.
 */
export function buildSeries(pts: TrackPoint[], range: Range, halfWinS = 5): Series {
  const n = range.end - range.start + 1;
  const s = new Float64Array(n);
  const alt = new Float64Array(n);
  const vario = new Float64Array(n);
  const speed = new Float64Array(n);
  const dist = new Float64Array(n);
  const t0 = pts[range.start].t;
  const usePressure = pts.slice(range.start, range.end + 1).every((p) => p.palt != null);
  const h = (i: number) => {
    const p = pts[range.start + i];
    return usePressure ? (p.palt as number) : p.alt;
  };

  for (let i = 0; i < n; i++) {
    const p = pts[range.start + i];
    s[i] = (p.t - t0) / 1000;
    if (i > 0) {
      const q = pts[range.start + i - 1];
      dist[i] = dist[i - 1] + distM(q.lat, q.lon, p.lat, p.lon) / 1000;
    }
  }

  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    while (s[i] - s[a] > halfWinS) a++;
    while (b + 1 < n && s[b + 1] - s[i] <= halfWinS) b++;
    const dt = s[b] - s[a];
    if (dt > 0) {
      vario[i] = (h(b) - h(a)) / dt;
      speed[i] = ((dist[b] - dist[a]) / dt) * 3600;
    } else if (i > 0) {
      vario[i] = vario[i - 1];
      speed[i] = speed[i - 1];
    }
  }

  // light altitude smoothing of GPS altitude (±2 s)
  a = 0;
  b = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    while (b < n && s[b] - s[i] <= 2) sum += pts[range.start + b++].alt;
    while (s[i] - s[a] > 2) sum -= pts[range.start + a++].alt;
    alt[i] = sum / (b - a);
  }

  return { s, alt, vario, speed, dist };
}

/** Sum of ups and downs with a dead band, so GPS noise does not inflate totals */
export function gainLoss(values: ArrayLike<number>, from = 0, to = values.length - 1, band = 3): [number, number] {
  let gain = 0;
  let loss = 0;
  let ref = values[from];
  for (let i = from + 1; i <= to; i++) {
    const d = values[i] - ref;
    if (d >= band) {
      gain += d;
      ref = values[i];
    } else if (d <= -band) {
      loss -= d;
      ref = values[i];
    }
  }
  return [gain, loss];
}

/** Index of the first point at or after time t (seconds) — binary search on series.s */
export function indexAt(s: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Best value of (v[j] - v[i]) / (s[j] - s[i]) over windows of exactly `win` seconds.
 * Returns [max, min].
 */
export function windowRate(s: ArrayLike<number>, v: ArrayLike<number>, win: number, from = 0, to = s.length - 1): [number, number] {
  let max = -Infinity;
  let min = Infinity;
  let j = from;
  for (let i = from; i <= to; i++) {
    while (j <= to && s[j] - s[i] < win) j++;
    if (j > to) break;
    const r = (v[j] - v[i]) / (s[j] - s[i]);
    if (r > max) max = r;
    if (r < min) min = r;
  }
  return [max === -Infinity ? 0 : max, min === Infinity ? 0 : min];
}
