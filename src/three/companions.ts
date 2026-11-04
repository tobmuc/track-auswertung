import type { GliderDesign } from './gliderDesigns';
import type { Model } from './model';

/** Another flight shown in the same area, in its own colour and with its own glider */
export interface Companion {
  id: number;
  name: string;
  color: string;
  design: GliderDesign;
  model: Model;
  /** companion time = main flight time + offsetMs; 0 when both flew at the same time */
  offsetMs: number;
  /** true when the flights did not overlap and were aligned at launch instead */
  aligned: boolean;
}

/** Colours for further pilots, chosen to stand apart from the vario colours of the main track */
export const COMPANION_COLORS = ['#e040fb', '#00e5ff', '#ffd600', '#ff5252', '#76ff03', '#ff9100', '#536dfe', '#ffffff'];

/** Same time if the flights overlap, else both launches at the same moment */
export function companionOffset(main: Model, other: Model): { offsetMs: number; aligned: boolean } {
  const a = main.res.timeline.t;
  const b = other.res.timeline.t;
  const overlap = Math.min(a[main.n - 1], b[other.n - 1]) - Math.max(a[0], b[0]);
  if (overlap > 0) return { offsetMs: 0, aligned: false };
  return { offsetMs: b[other.launchIdx] - a[main.launchIdx], aligned: true };
}

/** Fractional index of the companion at main-flight time t; null before its first or after its last fix */
export function companionFi(c: Companion, t: number): number | null {
  const ts = c.model.res.timeline.t;
  const tc = t + c.offsetMs;
  const n = c.model.n;
  if (tc < ts[0] || tc > ts[n - 1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= tc) lo = mid;
    else hi = mid;
  }
  const span = ts[hi] - ts[lo];
  return lo + (span > 0 ? (tc - ts[lo]) / span : 0);
}
