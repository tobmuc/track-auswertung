import type { FlightStats, Glide, HikeStats, PolarChoice, RuleSet, ScoreSet, Sport, Thermal, XcPotential } from '../core';

export interface Timeline {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
  vario: Float64Array;
  speed: Float64Array;
  /** 0-3 hike modes (up/down/flat/break), 4-7 flight modes (circling/climb/glide/sink) */
  mode: Uint8Array;
  seg: Uint8Array;
}

export interface SegmentInfo {
  kind: 'hike' | 'flight';
  fileName: string;
  offset: number;
  length: number;
  thermals: Thermal[];
  glides: Glide[];
}

export interface ActivityResult {
  sport: Sport;
  date: string;
  timeZone: string;
  hike?: HikeStats;
  flight?: FlightStats;
  segments: SegmentInfo[];
  glider?: string;
  pilot?: string;
  timeline: Timeline;
  score?: ScoreSet;
  /** what the triangle lacked for a better XContest rating */
  xcPotential?: XcPotential[];
}

export interface WorkerRequest {
  id: number;
  files: { name: string; text: string }[];
  sport?: Sport;
  rules: RuleSet;
  polar?: PolarChoice;
}

export interface ActivityRecord {
  id?: number;
  title: string;
  /** User override; undefined = detect automatically */
  sport?: Sport;
  rules: RuleSet;
  /** glider polar for the review; undefined = from the glider name in the IGC, else a typical one */
  polar?: PolarChoice;
  createdAt: number;
  date: string;
  files: { name: string; text: string }[];
  summary?: {
    sport: Sport;
    xcKm?: number;
    airtimeS?: number;
    maxAlt?: number;
    hikeGain?: number;
    distanceKm?: number;
  };
}
