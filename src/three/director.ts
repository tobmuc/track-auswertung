import { lerpAt, type Model } from './model';

export interface DirectorOptions {
  durationS: number;
  fps: number;
  /** Slow down at launch, the strongest thermals, the highest point and landing */
  highlights: boolean;
  /** Camera distance factor (1 = default) */
  camDistance: number;
  exaggeration: number;
  /** width / height of the output; portrait needs the overview farther away */
  aspect: number;
}

export type Phase = 'intro' | 'play' | 'outro';

export interface Frame {
  phase: Phase;
  /** fractional timeline index */
  fi: number;
  cam: [number, number, number];
  target: [number, number, number];
  /** 0..1 progress inside intro/outro */
  u: number;
}

export interface Plan {
  frames: Frame[];
  fps: number;
  /** first frame at which each thermal (by order in model.thermals) is entered / left */
  thermalEnter: number[];
  thermalExit: number[];
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

export function makePlan(m: Model, o: DirectorOptions): Plan {
  const total = Math.round(o.durationS * o.fps);
  const introN = Math.round((o.durationS >= 60 ? 3.5 : 2.5) * o.fps);
  const outroN = Math.round((o.durationS >= 60 ? 5 : 3.5) * o.fps);
  const playN = Math.max(2, total - introN - outroN);
  const t = m.res.timeline.t;
  const n = m.n;

  // --- time warp: cumulative weights per timeline index
  const w = new Float64Array(n);
  const hi = new Float64Array(n).fill(1);
  if (o.highlights) {
    const mark = (from: number, to: number, f: number) => {
      for (let i = Math.max(0, from); i <= Math.min(n - 1, to); i++) hi[i] = Math.max(hi[i], f);
    };
    const around = (i: number, s: number) => {
      let a = i, b = i;
      while (a > 0 && t[i] - t[a] < s * 1000) a--;
      while (b < n - 1 && t[b] - t[i] < s * 1000) b++;
      return [a, b] as const;
    };
    mark(...around(m.launchIdx, 45), 3);
    mark(...around(m.landingIdx, 45), 3);
    let top = m.launchIdx;
    for (let i = m.launchIdx; i <= m.landingIdx; i++) if (m.alt[i] > m.alt[top]) top = i;
    mark(...around(top, 30), 2.5);
    [...m.thermals].sort((a, b) => b.gain - a.gain).slice(0, 3).forEach((th) => mark(th.start, th.end, 2.2));
  }
  for (let i = 1; i < n; i++) {
    const dt = (t[i] - t[i - 1]) / 1000;
    const base = m.isHike[i] ? 0.35 : 1;
    w[i] = w[i - 1] + dt * base * hi[i];
  }
  const W = w[n - 1];
  const fiAt = (u: number) => {
    const target = u * W;
    let lo = 0, up = n - 1;
    while (lo < up) {
      const mid = (lo + up) >> 1;
      if (w[mid] < target) lo = mid + 1;
      else up = mid;
    }
    if (lo === 0) return 0;
    const span = w[lo] - w[lo - 1];
    return lo - 1 + (span > 0 ? (target - w[lo - 1]) / span : 0);
  };

  // --- smoothed travel direction per index; frozen while circling
  const dirX = new Float64Array(n);
  const dirZ = new Float64Array(n);
  let a = 0, b = 0;
  let px = 0, pz = -1;
  const mode = m.res.timeline.mode;
  for (let i = 0; i < n; i++) {
    while (t[i] - t[a] > 25_000) a++;
    while (b < n - 1 && t[b + 1] - t[i] <= 25_000) b++;
    if (mode[i] !== 4) {
      const dx = m.x[b] - m.x[a];
      const dz = m.z[b] - m.z[a];
      const len = Math.hypot(dx, dz);
      if (len > 50) { px = dx / len; pz = dz / len; }
    }
    dirX[i] = px;
    dirZ[i] = pz;
  }

  const ext = Math.max(m.terrain.maxX - m.terrain.minX, m.terrain.maxZ - m.terrain.minZ);
  const baseDist = Math.min(4500, Math.max(700, ext * 0.05)) * o.camDistance;
  const ex = o.exaggeration;
  const pos = (fi: number): [number, number, number] => [lerpAt(m.x, fi), lerpAt(m.alt, fi) * ex, lerpAt(m.z, fi)];
  const clampAbove = (p: [number, number, number]) => {
    const g = m.terrain.heightAt(p[0], p[2]) * ex + 120;
    if (p[1] < g) p[1] = g;
    return p;
  };
  /** Raises the camera until no ridge hides the pilot */
  const clearView = (c: [number, number, number], p: [number, number, number], d: number) => {
    for (let tries = 0; tries < 8; tries++) {
      let blocked = false;
      for (let s = 1; s < 12; s++) {
        const f = s / 12;
        const x = c[0] + (p[0] - c[0]) * f;
        const z = c[2] + (p[2] - c[2]) * f;
        const y = c[1] + (p[1] - c[1]) * f;
        if (m.terrain.heightAt(x, z) * ex + 40 > y) { blocked = true; break; }
      }
      if (!blocked) return c;
      c[1] += d * 0.25;
    }
    return c;
  };

  const frames: Frame[] = [];
  // chase camera for the play phase, smoothed over video frames
  const chase: Frame[] = [];
  let cam: [number, number, number] | null = null;
  let tgt: [number, number, number] | null = null;
  const k = 1 - Math.exp(-1 / (1.2 * o.fps)); // time constant ≈ 1.2 s video
  for (let f = 0; f < playN; f++) {
    const fi = fiAt(f / (playN - 1));
    const i = Math.round(fi);
    const p = pos(fi);
    const circling = mode[i] === 4;
    const d = baseDist * (circling ? 1.35 : 1);
    const side = circling ? 0.55 : 0.2;
    const hx = dirX[i], hz = dirZ[i];
    const want: [number, number, number] = clearView(clampAbove([
      p[0] - hx * d + -hz * d * side,
      p[1] + d * 0.7,
      p[2] - hz * d + hx * d * side,
    ]), p, d);
    const look: [number, number, number] = [p[0] + hx * d * 0.1, p[1] - d * 0.32, p[2] + hz * d * 0.1];
    if (!cam || !tgt) { cam = want; tgt = look; }
    else {
      cam = cam.map((c, j) => c + (want[j] - c) * k) as [number, number, number];
      tgt = tgt.map((c, j) => c + (look[j] - c) * Math.min(1, k * 2.5)) as [number, number, number];
      clampAbove(cam);
    }
    chase.push({ phase: 'play', fi, cam: [...cam], target: [...tgt], u: f / (playN - 1) });
  }

  // overview pose around the track's bounding box (not the padded terrain, whose edges would show)
  let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity, hSum = 0;
  for (let i = 0; i < n; i++) {
    tx0 = Math.min(tx0, m.x[i]); tx1 = Math.max(tx1, m.x[i]);
    tz0 = Math.min(tz0, m.z[i]); tz1 = Math.max(tz1, m.z[i]);
    hSum += m.ground[i];
  }
  const cx = (tx0 + tx1) / 2;
  const cz = (tz0 + tz1) / 2;
  const midH = (hSum / n) * ex;
  const trackExt = Math.max(tx1 - tx0, tz1 - tz0, 3000);
  const fit = o.aspect < 1 ? 1 / o.aspect ** 0.75 : 1;
  const overview = (angle: number, scale = fit): Frame['cam'] => [
    cx + Math.sin(angle) * trackExt * 0.65 * scale,
    midH + trackExt * 0.85 * scale,
    cz + Math.cos(angle) * trackExt * 0.65 * scale,
  ];
  const center: Frame['target'] = [cx, midH, cz];

  for (let f = 0; f < introN; f++) {
    const u = ease(f / Math.max(1, introN - 1));
    const from = overview(-0.5);
    const to = chase[0];
    frames.push({
      phase: 'intro',
      fi: 0,
      cam: from.map((c, j) => c + (to.cam[j] - c) * u) as Frame['cam'],
      target: center.map((c, j) => c + (to.target[j] - c) * u) as Frame['target'],
      u: f / Math.max(1, introN - 1),
    });
  }
  frames.push(...chase);
  const last = chase[chase.length - 1];
  const a0 = Math.atan2(last.cam[0] - cx, last.cam[2] - cz);
  for (let f = 0; f < outroN; f++) {
    const u = f / Math.max(1, outroN - 1);
    const e = ease(Math.min(1, u * 2.5));
    const orbit = overview(a0 + u * 1.2, fit * 0.95);
    frames.push({
      phase: 'outro',
      fi: n - 1,
      cam: last.cam.map((c, j) => c + (orbit[j] - c) * e) as Frame['cam'],
      target: last.target.map((c, j) => c + (center[j] - c) * e) as Frame['target'],
      u,
    });
  }

  const thermalEnter = m.thermals.map((th) => frames.findIndex((fr) => fr.phase === 'play' && fr.fi >= th.start));
  const thermalExit = m.thermals.map((th) => frames.findIndex((fr) => fr.phase === 'play' && fr.fi >= th.end));
  return { frames, fps: o.fps, thermalEnter, thermalExit };
}
