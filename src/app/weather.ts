/**
 * Cloud base from archived surface temperature and dew point (Open-Meteo, ERA5 reanalysis / forecast archive).
 * Rule of thumb for convective cloud base: a rising parcel cools by ~9.8 K/km, its dew point by ~1.8 K/km,
 * so they meet after (T − Td) / 8 K per km ≈ 125 m per kelvin of spread above the measuring point.
 */

export const M_PER_K_SPREAD = 125;

export interface CloudBaseSeries {
  /** unix ms per hour */
  t: number[];
  /** cloud base m MSL per hour */
  base: number[];
  temp: number[];
  dew: number[];
  /** grid elevation the temperatures refer to (m) */
  elevation: number;
  source: string;
}

interface OpenMeteoHourly {
  elevation?: number;
  hourly?: { time: number[]; temperature_2m: (number | null)[]; dew_point_2m: (number | null)[] };
}

/** Cloud base in m MSL from temperature and dew point at a given elevation */
export function cloudBaseFromSpread(tempC: number, dewC: number, elevation: number): number {
  return elevation + M_PER_K_SPREAD * Math.max(0, tempC - dewC);
}

async function query(host: string, lat: number, lon: number, day: string): Promise<CloudBaseSeries | null> {
  const url = `https://${host}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=${day}&end_date=${day}` +
    '&hourly=temperature_2m,dew_point_2m&timeformat=unixtime&timezone=GMT';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const j = (await r.json()) as OpenMeteoHourly;
  const h = j.hourly;
  if (!h || j.elevation == null) return null;
  const out: CloudBaseSeries = { t: [], base: [], temp: [], dew: [], elevation: j.elevation, source: host.split('.')[0] };
  h.time.forEach((s, k) => {
    const T = h.temperature_2m[k];
    const D = h.dew_point_2m[k];
    if (T == null || D == null) return;
    out.t.push(s * 1000);
    out.temp.push(T);
    out.dew.push(D);
    out.base.push(cloudBaseFromSpread(T, D, j.elevation!));
  });
  return out.t.length ? out : null;
}

const KEY = 'cloudbase:';

/** Hourly cloud base for the UTC day of `t` at a point; cached in this browser */
export async function loadCloudBase(lat: number, lon: number, t: number): Promise<CloudBaseSeries> {
  const day = new Date(t).toISOString().slice(0, 10);
  const key = `${KEY}${lat.toFixed(2)},${lon.toFixed(2)},${day}`;
  try {
    const c = localStorage.getItem(key);
    if (c) return JSON.parse(c) as CloudBaseSeries;
  } catch {
    /* private mode */
  }
  // the reanalysis lags a few days behind; recent days come from the forecast archive
  const s = (await query('archive-api.open-meteo.com/v1/archive', lat, lon, day).catch(() => null)) ??
    (await query('historical-forecast-api.open-meteo.com/v1/forecast', lat, lon, day));
  if (!s) throw new Error('keine Temperaturdaten für diesen Tag');
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* quota */
  }
  return s;
}

/** Linear interpolation of the hourly series at time t */
export function baseAt(s: CloudBaseSeries, t: number): number {
  const { t: ts, base } = s;
  if (t <= ts[0]) return base[0];
  for (let k = 1; k < ts.length; k++) {
    if (t <= ts[k]) return base[k - 1] + ((base[k] - base[k - 1]) * (t - ts[k - 1])) / (ts[k] - ts[k - 1]);
  }
  return base[base.length - 1];
}
