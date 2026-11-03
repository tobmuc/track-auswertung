import { scoringRules, solver } from 'igc-xc-score';
import type { ScorePoint, TrackPoint, XcScore } from './types';

export type RuleSet = 'XContest' | 'FFVL' | 'FAI' | 'XCLeague';

interface LibPoint {
  x: number;
  y: number;
  r: number;
}

interface Rule {
  name: string;
  code: string;
  multiplier: number;
}

const RULES = scoringRules as unknown as Record<RuleSet, Rule[]>;

function toFlight(pts: TrackPoint[], from: number, to: number) {
  const fixes = pts.slice(from, to + 1).map((p) => ({
    timestamp: p.t,
    time: new Date(p.t).toISOString().slice(11, 19),
    latitude: p.lat,
    longitude: p.lon,
    valid: true,
    pressureAltitude: p.palt,
    gpsAltitude: p.alt,
    extensions: {},
    fixAccuracy: null,
    enl: null,
  }));
  return { fixes, date: new Date(pts[from].t).toISOString().slice(0, 10) } as never;
}

/** null when the solver found no valid solution (e.g. no closable triangle, too few fixes) */
function run(flight: never, rules: Rule[], ruleSet: RuleSet, from: number, maxMs: number): XcScore | null {
  const deadline = Date.now() + maxMs;
  const it = solver(flight, rules, { maxcycle: 250 });
  let res = it.next();
  while (!res.done && Date.now() < deadline) res = it.next();
  const best = res.value;
  const info = best?.scoreInfo;
  if (!info || !Number.isFinite(info.distance)) return null;
  const conv = (p: LibPoint): ScorePoint => ({ lat: p.y, lon: p.x, idx: from + p.r });
  const sc = best.opt.scoring as Rule;
  return {
    rules: ruleSet,
    type: sc.name,
    code: sc.code,
    distanceKm: info.distance - (info.penalty ?? 0),
    points: best.score ?? 0,
    multiplier: sc.multiplier,
    turnpoints: (info.tp ?? []).map(conv),
    closing: info.cp ? { in: conv(info.cp.in), out: conv(info.cp.out), km: info.cp.d } : undefined,
    start: info.ep ? conv(info.ep.start) : undefined,
    finish: info.ep ? conv(info.ep.finish) : undefined,
    optimal: !!best.optimal,
  };
}

/**
 * Optimal XC scoring (free distance / flat / FAI triangle) with igc-xc-score (LGPL-3.0).
 * Works for IGC and GPX alike, as the flight is rebuilt from our track points.
 */
export function scoreFlight(pts: TrackPoint[], from: number, to: number, ruleSet: RuleSet = 'XContest', maxMs = 20000): XcScore | null {
  return run(toFlight(pts, from, to), RULES[ruleSet], ruleSet, from, maxMs);
}

export interface ScoreSet {
  best: XcScore;
  /** Best result per discipline (od = free distance, tri = flat triangle, fai = FAI triangle) */
  byCode: Partial<Record<'od' | 'tri' | 'fai', XcScore>>;
}

/** Best overall score plus the best result of each discipline; undefined when nothing could be scored */
export function scoreAll(pts: TrackPoint[], from: number, to: number, ruleSet: RuleSet = 'XContest', maxMs = 20000): ScoreSet | undefined {
  const flight = toFlight(pts, from, to);
  const byCode: ScoreSet['byCode'] = {};
  for (const code of ['od', 'tri', 'fai'] as const) {
    const rules = RULES[ruleSet].filter((r) => r.code === code);
    const sc = rules.length ? run(flight, rules, ruleSet, from, maxMs) : null;
    if (sc) byCode[code] = sc;
  }
  const all = Object.values(byCode);
  if (!all.length) return undefined;
  const best = all.reduce((a, b) => (b!.points > a!.points ? b : a))!;
  return { best, byCode };
}
