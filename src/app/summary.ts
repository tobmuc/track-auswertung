import type { Glide, Thermal, Wind } from '../core';

/**
 * Best glide: highest ratio among glides of at least 1.5 km that lost at least 100 m.
 * Shorter or flatter glides happen in lift and give meaningless ratios (1:100+).
 */
export function bestGlide(glides: Glide[]): Glide | null {
  return glides
    .filter((g) => g.ratio != null && g.distanceKm >= 1.5 && g.loss >= 100)
    .reduce<Glide | null>((a, g) => (!a || g.ratio! > a.ratio! ? g : a), null);
}

/**
 * Strongest wind of a thermal with at least 4 full circles; the circle fit of 1–3 circles
 * is too noisy for a maximum (single outliers of 30+ km/h in light wind).
 */
export function maxWind(thermals: Thermal[]): Wind | null {
  return thermals
    .filter((t) => t.wind && (t.core?.length ?? 0) >= 4)
    .map((t) => t.wind!)
    .reduce<Wind | null>((a, w) => (!a || w.speedKmh > a.speedKmh ? w : a), null);
}

/** Height gained in all thermals together */
export const thermalGain = (thermals: Thermal[]) => thermals.reduce((a, t) => a + t.gain, 0);
