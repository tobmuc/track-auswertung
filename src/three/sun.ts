const RAD = Math.PI / 180;

/** Approximate solar azimuth (deg from north, clockwise) and elevation (deg) — NOAA low-precision formulas */
export function sunPosition(t: number, lat: number, lon: number): { azimuth: number; elevation: number } {
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = (t - start) / 86400000;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const g = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqt + 4 * lon;
  const ha = (tst / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(phi) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(phi) * Math.sin(zen))))) / RAD;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { azimuth: az, elevation: 90 - zen / RAD };
}

/** How the sun is simulated in the 3D video */
export interface SunSettings {
  /** shadow of glider and mountains from the sun position */
  shadows: boolean;
  /** shift of the time of day in hours (what-if: same flight earlier or later) */
  hourOffset: number;
  /** other day "YYYY-MM-DD" (season); '' = flight date */
  date: string;
  /** sun panel in the overlays */
  info: boolean;
}

/** Time used for the sun: flight time, moved to another day and/or shifted in time of day */
export function sunTime(t: number, s: Pick<SunSettings, 'hourOffset' | 'date'>): number {
  let out = t;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.date);
  if (m) {
    const d = new Date(t);
    out = Date.UTC(+m[1], +m[2] - 1, +m[3], d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  }
  return out + s.hourOffset * 3_600_000;
}

/** Unit vector towards the sun in the local frame (x east, y up, z south) */
export function sunVector(azimuth: number, elevation: number): [number, number, number] {
  const el = elevation * RAD;
  const az = azimuth * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/**
 * Clear-sky irradiance (W/m²): direct beam from the air mass (Kasten–Young, Meinel attenuation),
 * plus a diffuse share of 10 %. `cosIncidence` = cos of the angle between sun and surface normal.
 */
export function irradiance(elevation: number, cosIncidence: number): number {
  if (elevation <= 0) return 0;
  const am = 1 / (Math.sin(elevation * RAD) + 0.50572 * (elevation + 6.07995) ** -1.6364);
  const dni = 1361 * 0.7 ** (am ** 0.678);
  return dni * Math.max(0, cosIncidence) + 0.1 * dni;
}
