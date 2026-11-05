import type { AirspeedStats } from './airspeed';
import type { FlightReview } from './review';
export type Sport = 'paragliding' | 'hikefly' | 'hanggliding' | 'hiking';

/** One GPS fix. Times in ms since epoch (UTC), altitudes in m MSL. */
export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  /** GPS altitude (m MSL) */
  alt: number;
  /** Pressure altitude if the logger recorded one */
  palt: number | null;
}

export interface Track {
  source: 'igc' | 'gpx';
  fileName: string;
  points: TrackPoint[];
  pilot?: string;
  glider?: string;
  gliderType?: 'PG' | 'HG' | string;
  logger?: string;
  /** Raw IGC text, needed for XC scoring */
  raw?: string;
}

/** Inclusive index range into a point array */
export interface Range {
  start: number;
  end: number;
}

export type HikeMode = 'up' | 'down' | 'flat' | 'break';
export type FlightMode = 'climb' | 'glide' | 'circling' | 'sink';

export interface Circling extends Range {
  /** +1 right (clockwise), -1 left */
  dir: 1 | -1;
  circles: number;
  gain: number;
  durationS: number;
}

/** One full 360° turn */
export interface CircleStat {
  /** mid time, ms */
  t: number;
  /** mean altitude over the turn, m */
  alt: number;
  durationS: number;
  /** +1 right, -1 left */
  dir: 1 | -1;
  /** height gained over the turn / duration, m/s */
  climb: number;
  /** radius relative to the air (wind removed), m */
  radiusM: number;
  /** bank angle from radius and turn time, degrees */
  bankDeg: number;
  /** airspeed from the wind fit, km/h; null when the circle was too irregular */
  airspeedKmh: number | null;
  /** index into FlightStats.thermals, -1 when the circling gained too little */
  thermal: number;
}

export interface Thermal extends Range {
  gain: number;
  avgClimb: number;
  durationS: number;
  baseAlt: number;
  topAlt: number;
  lat: number;
  lon: number;
  /** Wind from the circle fit of the ground-speed vectors */
  wind?: Wind;
  /**
   * Thermal core: centre of every full circle (mean position over one turn).
   * With centred circles the centres drift with the air mass, so they trace the tilted thermal.
   */
  core?: CorePoint[];
  /** Wind from the drift of the circle centres over time (needs ≥ 3 circles) */
  drift?: Wind;
}

export interface CorePoint {
  lat: number;
  lon: number;
  alt: number;
  t: number;
}

/** Straight flight between circling phases */
export interface Glide extends Range {
  durationS: number;
  distanceKm: number;
  /** height lost (negative = gained height while gliding) */
  loss: number;
  /** distance / loss over ground; null when no height was lost */
  ratio: number | null;
  /** glide ratio relative to the air mass (wind removed), when wind is known */
  airRatio: number | null;
  avgSpeedKmh: number;
  /** average vertical speed m/s */
  avgVario: number;
  /** mean airspeed (wind triangle), km/h, when wind is known */
  airKmh?: number;
  /** wind along the glide: + tailwind, − headwind, km/h */
  windAlongKmh?: number;
}

export interface Wind {
  /** Direction the wind blows FROM, degrees */
  fromDeg: number;
  speedKmh: number;
  alt: number;
  t: number;
}

export interface HikeStats {
  distanceKm: number;
  gain: number;
  loss: number;
  durationS: number;
  recordedS: number;
  movingS: number;
  breaksS: number;
  avgSpeedKmh: number;
  avgAscentMh: number;
  highest: number;
  lowest: number;
  startAlt: number;
  endAlt: number;
  /** Gaps in the recording that were bridged */
  gaps: { durationS: number; distanceKm: number; gain: number }[];
  modeShare: Record<HikeMode, number>;
}

export interface FlightStats {
  launchIdx: number;
  landingIdx: number;
  launchTime: number;
  landingTime: number;
  airtimeS: number;
  trackLengthKm: number;
  launchToLandingKm: number;
  minAlt: number;
  maxAlt: number;
  launchAlt: number;
  landingAlt: number;
  maxGainAboveLaunch: number;
  totalClimb: number;
  totalDescent: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  avgGlideRatio: number | null;
  bestGlide60s: number | null;
  bestClimb30s: number;
  worstSink30s: number;
  avgClimbInThermals: number | null;
  timeCirclingS: number;
  timeClimbingInThermalsS: number;
  timeNotCirclingS: number;
  timeStrongSinkS: number;
  circlesLeft: number;
  circlesRight: number;
  circlingLeftS: number;
  circlingRightS: number;
  avgTimePerCircleS: number | null;
  circlings: Circling[];
  /** every full turn, in time order */
  circles: CircleStat[];
  thermals: Thermal[];
  glides: Glide[];
  /** airspeed and accelerated flight, null without enough straight flight with a wind estimate */
  airspeed: Omit<AirspeedStats, 'air'> | null;
  /** what went well and where there was likely room for improvement */
  review: FlightReview;
  winds: Wind[];
  wind: Wind | null;
  modeShare: Record<FlightMode, number>;
}

export interface ScorePoint {
  lat: number;
  lon: number;
  idx: number;
}

export interface XcScore {
  rules: string;
  type: string;
  code: string;
  /** Scored distance after closing penalty, km */
  distanceKm: number;
  points: number;
  multiplier: number;
  turnpoints: ScorePoint[];
  closing?: { in: ScorePoint; out: ScorePoint; km: number };
  start?: ScorePoint;
  finish?: ScorePoint;
  optimal: boolean;
}

/** Per-point derived series used for colouring and charts */
export interface Series {
  /** seconds since first point */
  s: Float64Array;
  /** smoothed altitude (m MSL) */
  alt: Float64Array;
  /** vertical speed m/s (smoothed) */
  vario: Float64Array;
  /** ground speed km/h (smoothed) */
  speed: Float64Array;
  /** cumulative distance km */
  dist: Float64Array;
}

export interface Segment {
  kind: 'hike' | 'flight';
  track: Track;
  range: Range;
  series: Series;
  hike?: HikeStats;
  flight?: FlightStats;
}

export interface Analysis {
  sport: Sport;
  date: string;
  segments: Segment[];
  hike?: HikeStats;
  flight?: FlightStats;
}
