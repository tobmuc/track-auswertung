import { analyzeFlight, detectFlight } from './flight';
import { analyzeHike } from './hike';
import { buildSeries } from './series';
import type { Analysis, Range, Segment, Sport, Track } from './types';
import type { PolarChoice } from './polars';

const MIN_HIKE_S = 10 * 60;
const MIN_HIKE_GAIN = 100;

/**
 * Splits the given tracks into hike and flight segments and computes their statistics.
 * One file may contain hike + flight (split at launch); a hike GPX plus a flight IGC also works.
 */
export function analyzeTracks(tracks: Track[], sportHint?: Sport, polar?: PolarChoice): Analysis {
  const segments: Segment[] = [];
  const sorted = [...tracks].filter((t) => t.points.length > 1).sort((a, b) => a.points[0].t - b.points[0].t);

  for (const track of sorted) {
    const pts = track.points;
    const all: Range = { start: 0, end: pts.length - 1 };
    const fine = buildSeries(pts, all, 5);
    const flight = sportHint === 'hiking' ? null : detectFlight(pts, fine);

    if (!flight) {
      segments.push(hikeSegment(track, all));
      continue;
    }
    if (flight.start > 0) {
      const pre: Range = { start: 0, end: flight.start };
      const dur = (pts[pre.end].t - pts[0].t) / 1000;
      const gain = pts[pre.end].alt - Math.min(...pts.slice(0, pre.end + 1).map((p) => p.alt));
      if (dur >= MIN_HIKE_S && gain >= MIN_HIKE_GAIN) segments.push(hikeSegment(track, pre));
    }
    const series = buildSeries(pts, flight, 5);
    segments.push({ kind: 'flight', track, range: flight, series, flight: analyzeFlight(pts, flight, series, polar ?? null, track.glider) });
  }

  const hikes = segments.filter((s) => s.kind === 'hike');
  const flights = segments.filter((s) => s.kind === 'flight');
  let sport: Sport;
  if (sportHint) sport = sportHint;
  else if (flights.length && hikes.length) sport = 'hikefly';
  else if (flights.length) sport = flights[0].track.gliderType === 'HG' ? 'hanggliding' : 'paragliding';
  else sport = 'hiking';

  const first = sorted[0]?.points[0];
  return {
    sport,
    date: first ? new Date(first.t).toISOString().slice(0, 10) : '',
    segments,
    hike: hikes[0]?.hike,
    flight: flights.sort((a, b) => (b.flight!.airtimeS - a.flight!.airtimeS))[0]?.flight,
  };
}

function hikeSegment(track: Track, range: Range): Segment {
  const series = buildSeries(track.points, range, 30);
  return { kind: 'hike', track, range, series, hike: analyzeHike(track.points, range, series) };
}
