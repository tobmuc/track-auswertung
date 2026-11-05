import { fitPolar, kornerPolar, type Polar } from './polar';
import { KORNER, KORNER_CLASSES, type KornerRow } from './polarData';

/**
 * Polar presets from Korner (2026): still-air sink estimated from 86,000 XContest flights in the Valais.
 * Model rows are used as they are; class presets are the flight-weighted mean of the models of a class
 * (EN-D uses the study's own class row). Pilot weights are the mix in the logs, so a heavy or light
 * pilot sits somewhat off the curve.
 */

export interface PolarPreset {
  id: string;
  label: string;
  cls: string;
  /** model name as in the study (lower case), empty for class presets */
  model: string;
  a: number;
  b: number;
  /** speed range: data window start to the 99th-percentile airspeed of the logs, km/h */
  fromKmh: number;
  toKmh: number;
  /** end of the data window; beyond it the curve is extended */
  windowToKmh: number;
  flights: number;
}

const SOURCE = 'Korner 2026, aus XContest-Flügen im Wallis';

function classPreset(cls: string, label: string): PolarPreset {
  const own = KORNER_CLASSES.find((r) => r[2] === cls);
  if (own) return fromRow(own, `class-${cls.toLowerCase()}`, label, '');
  const rows = KORNER.filter((r) => r[2] === cls);
  const w = rows.reduce((s, r) => s + r[8], 0);
  const mean = (i: number) => rows.reduce((s, r) => s + Number(r[i]) * r[8], 0) / w;
  return {
    id: `class-${cls.toLowerCase()}`, label, cls, model: '', a: mean(3), b: mean(4),
    fromKmh: Math.round(mean(5)), toKmh: Math.round(mean(7)), windowToKmh: Math.round(mean(6)), flights: w,
  };
}

function fromRow(r: KornerRow, id: string, label: string, model: string): PolarPreset {
  return { id, label, cls: r[2], model, a: r[3], b: r[4], fromKmh: r[5], toKmh: Math.max(r[6], r[7]), windowToKmh: r[6], flights: r[8] };
}

const title = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bP\b/, 'P').replace(/\bDls\b/i, 'DLS').replace(/\bUls\b/i, 'ULS').replace(/\bGt\b/i, 'GT').replace(/\bLm\b/i, 'LM');

export const POLARS: PolarPreset[] = [
  classPreset('A', 'EN-A (Klassenmittel)'),
  classPreset('B', 'EN-B (Klassenmittel)'),
  classPreset('C', 'EN-C (Klassenmittel)'),
  classPreset('D', 'EN-D (Klassenmittel)'),
  classPreset('CCC', 'CCC (Klassenmittel)'),
  ...KORNER.map((r) => fromRow(r, `k-${r[0].replace(/[^a-z0-9]+/g, '-')}`, `${title(r[0])} (${r[2] === 'CCC' ? 'CCC' : `EN-${r[2]}`}, ${r[1] || ''})`.replace(', )', ')'), r[0])),
];

/** short glider IDs some pilots put into the IGC header */
const ALIASES: [RegExp, string][] = [
  [/\boxa\s?3\b/, 'omega x alps 3'],
  [/\boxa\s?2\b/, 'omega x alps 2'],
  [/\bx-?alps\s?3\b/, 'omega x alps 3'],
];

export interface PolarChoice {
  /** preset id, or 'custom' with own points */
  id: string;
  points?: [number, number][];
  weightKg?: number;
  refWeightKg?: number;
}

export interface PolarInfo {
  id: string;
  label: string;
  source: string;
  /** chosen by the user, recognised from the glider name, or the default */
  how: 'chosen' | 'glider-name' | 'default';
  /** km/h: data window and top of the range */
  fromKmh: number;
  windowToKmh: number;
  toKmh: number;
  flights: number;
}

/** Finds the study model behind a glider name such as "Advance Omega X-Alps 3" or "OXA3" */
export function matchGlider(name: string): PolarPreset | undefined {
  let n = name.toLowerCase().replace(/[-_/.]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, model] of ALIASES) if (re.test(n)) n = model;
  let best: PolarPreset | undefined;
  for (const p of POLARS) {
    if (!p.model) continue;
    // whole words, so "zeno" does not match "zeno 2" twice and "ion 6" not "fusion"
    const re = new RegExp(`(^|\\s)${p.model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`);
    if (re.test(n) && (!best || p.model.length > best.model.length)) best = p;
  }
  return best;
}

export function resolvePolar(choice: PolarChoice | null, glider?: string): { polar: Polar; info: PolarInfo } {
  if (choice?.id === 'custom' && choice.points && choice.points.length >= 3) {
    const p = fitPolar(choice.points, choice.weightKg, choice.refWeightKg);
    const kmh = choice.points.map((q) => q[0]);
    return {
      polar: p,
      info: { id: 'custom', label: 'Eigene Polare', source: 'eigene Werte', how: 'chosen', fromKmh: Math.min(...kmh), windowToKmh: Math.max(...kmh), toKmh: Math.max(...kmh), flights: 0 },
    };
  }
  let preset = choice ? POLARS.find((p) => p.id === choice.id) : undefined;
  let how: PolarInfo['how'] = 'chosen';
  if (!preset && glider) {
    preset = matchGlider(glider);
    how = 'glider-name';
  }
  if (!preset) {
    preset = POLARS.find((p) => p.id === 'class-b')!;
    how = 'default';
  }
  return {
    polar: kornerPolar(preset.a, preset.b, preset.fromKmh, preset.toKmh),
    info: { id: preset.id, label: preset.label, source: SOURCE, how, fromKmh: preset.fromKmh, windowToKmh: preset.windowToKmh, toKmh: preset.toKmh, flights: preset.flights },
  };
}
