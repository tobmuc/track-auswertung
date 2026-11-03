import * as THREE from 'three';
import type { Plan } from './director';
import { windAt, type Model } from './model';

/**
 * Windy-style air flow streaks where the air visibly lifts:
 *  - strong thermals: streaks spiralling up the (drifting) thermal core
 *  - climbing in straight flight (ridge soaring, convergence): streaks flowing with the wind and upwards along the track
 * Motion runs in video time, so it looks natural however fast the time lapse is; each zone fades in
 * shortly before the pilot gets there and fades out a few seconds after.
 */

interface Zone {
  kind: 'thermal' | 'straight';
  start: number;
  end: number;
  strength: number;
  /** spawn: returns position for particle seed s at life phase u (0..1), in world units (y already exaggerated) */
  at: (seed: Seed, u: number, tau: number) => [number, number, number];
  count: number;
  /** life cycle length in video seconds */
  cycle: number;
  color: THREE.Color;
  frames?: [number, number];
}

interface Seed {
  a: number;
  b: number;
  c: number;
  phase: number;
}

const STREAK_S = 0.35; // streak length in video seconds

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Straight climbing phases: flight mode "climb" (not circling) for ≥ 30 s with ≥ 0.6 m/s on average */
function straightClimbs(m: Model): { start: number; end: number; climb: number }[] {
  const tl = m.res.timeline;
  const out: { start: number; end: number; climb: number }[] = [];
  let s = -1;
  let lastClimb = -1;
  for (let i = 0; i <= m.n; i++) {
    const climbing = i < m.n && tl.mode[i] === 5 && !m.isHike[i];
    if (climbing) {
      if (s < 0) s = i;
      lastClimb = i;
    }
    // bridge short interruptions (≤ 10 s)
    const gapOver = s >= 0 && (i === m.n || (!climbing && tl.t[i] - tl.t[lastClimb] > 10_000));
    if (gapOver) {
      const dur = (tl.t[lastClimb] - tl.t[s]) / 1000;
      const climb = dur > 0 ? (m.alt[lastClimb] - m.alt[s]) / dur : 0;
      if (dur >= 30 && climb >= 0.6) out.push({ start: s, end: lastClimb, climb });
      s = -1;
    }
  }
  return out.sort((a, b) => b.climb - a.climb).slice(0, 10);
}

export class LiftParticles {
  readonly object: THREE.LineSegments;
  private zones: Zone[] = [];
  private seeds: Seed[][] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private planRef: Plan | null = null;

  constructor(private m: Model, ex: number, ext: number) {
    const R = Math.max(80, ext * 0.003) * 1.3;
    // --- strong thermals (and at most the 10 best)
    const strong = [...m.thermals].filter((t) => t.avgClimb >= 1.2).sort((a, b) => b.avgClimb * b.gain - a.avgClimb * a.gain).slice(0, 10);
    for (const th of strong) {
      const [x0, z0] = m.terrain.frame.toXZ(th.lat, th.lon);
      const core = (th.core ?? []).map((c) => {
        const [x, z] = m.terrain.frame.toXZ(c.lat, c.lon);
        return { x, z, alt: c.alt };
      });
      const axis = (alt: number): [number, number] => {
        if (core.length < 2) return [x0, z0];
        let lo = core[0], hi = core[core.length - 1];
        for (const c of core) {
          if (c.alt <= alt && c.alt > lo.alt) lo = c;
          if (c.alt >= alt && c.alt < hi.alt) hi = c;
        }
        const f = hi.alt > lo.alt ? Math.max(0, Math.min(1, (alt - lo.alt) / (hi.alt - lo.alt))) : 0;
        return [lo.x + (hi.x - lo.x) * f, lo.z + (hi.z - lo.z) * f];
      };
      const spin = 0.9 + 0.2 * th.avgClimb;
      this.zones.push({
        kind: 'thermal',
        start: th.start,
        end: th.end,
        strength: th.avgClimb,
        count: Math.round(110 + 30 * Math.min(4, th.avgClimb)),
        cycle: Math.max(3, 9 - th.avgClimb),
        color: new THREE.Color('#ffe7b0'),
        at: (s, u, tau) => {
          const alt = th.baseAlt - 60 + (th.topAlt - th.baseAlt + 160) * u;
          const [ax, az] = axis(alt);
          // radius widens towards the top like the funnel
          const r = R * (0.25 + 0.75 * s.b) * (0.6 + 0.5 * u);
          const ang = s.a * Math.PI * 2 + tau * spin;
          return [ax + Math.cos(ang) * r, alt * ex, az + Math.sin(ang) * r];
        },
      });
    }
    // --- straight climbs: air flowing with the wind and upwards along the track
    for (const sc of straightClimbs(m)) {
      const w = windAt(m, m.res.timeline.t[sc.start]) ?? m.res.flight?.wind ?? null;
      let fx: number, fz: number;
      if (w && w.speedKmh >= 5) {
        const to = ((w.fromDeg + 180) * Math.PI) / 180;
        fx = Math.sin(to);
        fz = -Math.cos(to);
      } else {
        const dx = m.x[sc.end] - m.x[sc.start];
        const dz = m.z[sc.end] - m.z[sc.start];
        const l = Math.hypot(dx, dz) || 1;
        fx = dx / l;
        fz = dz / l;
      }
      const len = Math.max(400, R * 4);
      this.zones.push({
        kind: 'straight',
        start: sc.start,
        end: sc.end,
        strength: sc.climb,
        count: 180,
        cycle: 4,
        color: new THREE.Color('#d6f1ff'),
        at: (s, u) => {
          // spawn somewhere along the climbing stretch, a little below and beside the track
          const k = Math.round(sc.start + (sc.end - sc.start) * s.a);
          const side = (s.b - 0.5) * R * 3;
          const below = -R * 1.8 * s.c;
          const x = m.x[k] + fx * (u - 0.5) * len + -fz * side;
          const z = m.z[k] + fz * (u - 0.5) * len + fx * side;
          const y = (m.alt[k] + below + u * R * 1.6 * Math.min(2, sc.climb)) * ex;
          return [x, y, z];
        },
      });
    }

    let total = 0;
    this.zones.forEach((zn, zi) => {
      const r = rng(9001 + zi * 7919);
      this.seeds.push(Array.from({ length: zn.count }, () => ({ a: r(), b: r(), c: r(), phase: r() })));
      total += zn.count;
    });
    this.pos = new Float32Array(total * 6);
    this.col = new Float32Array(total * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.object = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
  }

  get empty() {
    return this.zones.length === 0;
  }

  /** Video frame at which the pilot enters each lift zone, with its strength (m/s) */
  entries(plan: Plan): { frame: number; strength: number }[] {
    this.framesFor(plan);
    return this.zones.map((z) => ({ frame: z.frames![0], strength: z.strength }));
  }

  /** frame range per zone, from the plan (when the pilot enters/leaves) */
  private framesFor(plan: Plan) {
    if (this.planRef === plan) return;
    this.planRef = plan;
    const f = plan.frames;
    const first = (fi: number) => {
      const k = f.findIndex((x) => x.phase === 'play' && x.fi >= fi);
      return k < 0 ? f.length - 1 : k;
    };
    for (const z of this.zones) z.frames = [first(z.start), first(z.end)];
  }

  update(frameNo: number, plan: Plan, visible: boolean) {
    this.object.visible = visible && !this.empty;
    if (!this.object.visible) return;
    this.framesFor(plan);
    const fps = plan.fps;
    const tau = frameNo / fps;
    let o = 0;
    this.zones.forEach((z, zi) => {
      const [f0, f1] = z.frames!;
      // fade in 1.5 s before the pilot arrives, fade out 5 s after leaving
      const before = (f0 - frameNo) / fps;
      const after = (frameNo - f1) / fps;
      const vis = Math.max(0, Math.min(1, 1 - before / 1.5, 1 - after / 5));
      const bright = vis * Math.min(1, 0.35 + 0.18 * z.strength);
      for (const s of this.seeds[zi]) {
        if (bright <= 0) {
          this.pos.fill(0, o, o + 6);
          this.col.fill(0, o, o + 6);
          o += 6;
          continue;
        }
        const u1 = (tau / z.cycle + s.phase) % 1;
        const u0 = Math.max(0, u1 - STREAK_S / z.cycle);
        const p1 = z.at(s, u1, tau);
        const p0 = z.at(s, u0, tau - STREAK_S);
        this.pos.set(p0, o);
        this.pos.set(p1, o + 3);
        // fade at the start and end of each particle's life; tail darker than head (additive = transparent)
        const life = Math.sin(Math.PI * u1);
        const head = bright * life;
        this.col[o] = z.color.r * head * 0.15;
        this.col[o + 1] = z.color.g * head * 0.15;
        this.col[o + 2] = z.color.b * head * 0.15;
        this.col[o + 3] = z.color.r * head;
        this.col[o + 4] = z.color.g * head;
        this.col[o + 5] = z.color.b * head;
        o += 6;
      }
    });
    const g = this.object.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}
