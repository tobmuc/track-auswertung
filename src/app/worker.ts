/// <reference lib="webworker" />
import tzlookup from 'tz-lookup';
import { analyzeTracks, parseTrack, scoreAll } from '../core';
import { breakMask, hikeModes } from '../core/hike';
import type { PolarChoice, RuleSet, Sport } from '../core';
import type { ActivityResult, Timeline, WorkerRequest } from './types';

/** Mode codes shared with colours.ts */
const HIKE_CODE = { up: 0, down: 1, flat: 2, break: 3 } as const;
const FLIGHT_CODE = { circling: 4, climb: 5, glide: 6, sink: 7 } as const;

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, files, sport, rules, polar } = ev.data;
  try {
    self.postMessage({ id, result: analyze(files, sport, rules, polar) });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};

function analyze(files: { name: string; text: string }[], sport: Sport | undefined, rules: RuleSet, polar?: PolarChoice): ActivityResult {
  const tracks = files.map((f) => parseTrack(f.name, f.text));
  const analysis = analyzeTracks(tracks, sport, polar);

  // flat timeline over all segments for map and profile
  let n = 0;
  for (const s of analysis.segments) n += s.range.end - s.range.start + 1;
  const tl: Timeline = {
    t: new Float64Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    alt: new Float64Array(n),
    vario: new Float64Array(n),
    speed: new Float64Array(n),
    mode: new Uint8Array(n),
    seg: new Uint8Array(n),
  };
  let k = 0;
  const segOffsets: number[] = [];
  analysis.segments.forEach((seg, si) => {
    segOffsets.push(k);
    const len = seg.range.end - seg.range.start + 1;
    let modes: number[];
    if (seg.kind === 'hike') {
      modes = hikeModes(seg.series, breakMask(seg.series)).map((m) => HIKE_CODE[m]);
    } else {
      const inCircle = new Uint8Array(len);
      for (const c of seg.flight!.circlings) inCircle.fill(1, c.start, c.end + 1);
      modes = Array.from({ length: len }, (_, i) => {
        const v = seg.series.vario[i];
        return inCircle[i] ? FLIGHT_CODE.circling : v > 0.5 ? FLIGHT_CODE.climb : v < -2 ? FLIGHT_CODE.sink : FLIGHT_CODE.glide;
      });
    }
    for (let i = 0; i < len; i++, k++) {
      const p = seg.track.points[seg.range.start + i];
      tl.t[k] = p.t;
      tl.lat[k] = p.lat;
      tl.lon[k] = p.lon;
      tl.alt[k] = seg.series.alt[i];
      tl.vario[k] = seg.series.vario[i];
      tl.speed[k] = seg.series.speed[i];
      tl.mode[k] = modes[i];
      tl.seg[k] = si;
    }
  });

  const flightSeg = analysis.segments.find((s) => s.kind === 'flight' && s.flight === analysis.flight);
  let score: ReturnType<typeof scoreAll>;
  try {
    score = flightSeg && analysis.flight ? scoreAll(flightSeg.track.points, flightSeg.range.start, flightSeg.range.end, rules) : undefined;
  } catch (e) {
    // a scoring failure must not block the import: the activity is shown without XC score
    console.warn('XC-Wertung fehlgeschlagen', e);
    score = undefined;
  }
  // score indices are track indices; convert to timeline indices
  if (score && flightSeg) {
    const off = segOffsets[analysis.segments.indexOf(flightSeg)] - flightSeg.range.start;
    for (const sc of [score.best, ...Object.values(score.byCode)]) {
      for (const p of [...sc!.turnpoints, sc!.start, sc!.finish, sc!.closing?.in, sc!.closing?.out]) if (p) p.idx += off;
    }
  }

  const first = analysis.segments[0]?.track.points[analysis.segments[0].range.start];
  const timeZone = first ? tzlookup(first.lat, first.lon) : 'UTC';

  return {
    sport: analysis.sport,
    date: analysis.date,
    timeZone,
    hike: analysis.hike,
    flight: analysis.flight,
    segments: analysis.segments.map((s, i) => ({
      kind: s.kind,
      fileName: s.track.fileName,
      offset: segOffsets[i],
      length: s.range.end - s.range.start + 1,
      // circling/thermal indices are relative to the segment: make them timeline-absolute
      thermals: s.flight?.thermals.map((t) => ({ ...t, start: t.start + segOffsets[i], end: t.end + segOffsets[i] })) ?? [],
      glides: s.flight?.glides.map((g) => ({ ...g, start: g.start + segOffsets[i], end: g.end + segOffsets[i] })) ?? [],
    })),
    glider: analysis.segments.find((s) => s.track.glider)?.track.glider,
    pilot: analysis.segments.find((s) => s.track.pilot)?.track.pilot,
    timeline: tl,
    score,
  };
}
