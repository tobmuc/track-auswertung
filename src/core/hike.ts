import { distM } from './geo';
import { gainLoss } from './series';
import type { HikeMode, HikeStats, Range, Series, TrackPoint } from './types';

const GAP_S = 120;
const STILL_KMH = 0.8;
const MIN_BREAK_S = 120;
const UP_MH = 150;

/** Per-point walking mode (relative to the series) */
export function hikeModes(s: Series, breaks: Uint8Array): HikeMode[] {
  const modes: HikeMode[] = [];
  for (let i = 0; i < s.s.length; i++) {
    if (breaks[i]) modes.push('break');
    else {
      const mh = s.vario[i] * 3600;
      modes.push(mh > UP_MH ? 'up' : mh < -UP_MH ? 'down' : 'flat');
    }
  }
  return modes;
}

/** Marks points that belong to a stationary stretch of at least MIN_BREAK_S */
export function breakMask(s: Series): Uint8Array {
  const n = s.s.length;
  const mask = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    if (s.speed[i] >= STILL_KMH) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && s.speed[j + 1] < STILL_KMH && s.s[j + 1] - s.s[j] < GAP_S) j++;
    if (s.s[j] - s.s[i] >= MIN_BREAK_S) mask.fill(1, i, j + 1);
    i = j + 1;
  }
  return mask;
}

/** Hike statistics. Expects a series built with a wide window (±30 s) */
export function analyzeHike(pts: TrackPoint[], r: Range, s: Series): HikeStats {
  const n = r.end - r.start + 1;
  const last = n - 1;
  const gaps: HikeStats['gaps'] = [];
  let gapS = 0;
  for (let i = 1; i < n; i++) {
    const dt = s.s[i] - s.s[i - 1];
    if (dt > GAP_S) {
      const p = pts[r.start + i - 1];
      const q = pts[r.start + i];
      gaps.push({ durationS: dt, distanceKm: distM(p.lat, p.lon, q.lat, q.lon) / 1000, gain: Math.max(0, q.alt - p.alt) });
      gapS += dt;
    }
  }
  const brk = breakMask(s);
  const modes = hikeModes(s, brk);
  const modeTime: Record<HikeMode, number> = { up: 0, down: 0, flat: 0, break: 0 };
  for (let i = 1; i < n; i++) {
    const dt = s.s[i] - s.s[i - 1];
    if (dt > GAP_S) continue;
    modeTime[modes[i]] += dt;
  }
  const altRaw = Array.from({ length: n }, (_, i) => pts[r.start + i].alt);
  const [gain, loss] = gainLoss(s.alt, 0, last, 5);
  const durationS = s.s[last];
  const recordedS = durationS - gapS;
  const breaksS = modeTime.break;
  const movingS = recordedS - breaksS;
  return {
    distanceKm: s.dist[last],
    gain,
    loss,
    durationS,
    recordedS,
    movingS,
    breaksS,
    avgSpeedKmh: durationS > 0 ? (s.dist[last] / durationS) * 3600 : 0,
    avgAscentMh: modeTime.up > 0 ? gain / (modeTime.up / 3600) : 0,
    highest: Math.max(...altRaw),
    lowest: Math.min(...altRaw),
    startAlt: s.alt[0],
    endAlt: s.alt[last],
    gaps,
    modeShare: modeTime,
  };
}
