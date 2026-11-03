import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { VARIO_STOPS } from '../app/colors';
import type { Frame } from './director';
import { lerpAt, windAt, type Model } from './model';
import { sunPosition } from './sun';
import type { TerrainTexture } from './terrain';
import { buildGlider, GLIDER_SPAN } from './glider';
import type { GliderDesign } from './gliderDesigns';
import { compass } from '../core/geo';
import { t } from '../app/i18n';

export interface SceneOptions {
  /** draped map, or null for the plaster relief */
  texture: TerrainTexture | null;
  exaggeration: number;
  layers: { thermals: boolean; drift: boolean; glides: boolean; curtain: boolean; wind: boolean; contours: boolean };
  /** Glider size on screen (1 = span ≈ 5 % of the camera distance; never below real size) */
  gliderSize: number;
  glider: GliderDesign;
}

const LOW_AGL = 150;

function varioColor(v: number): THREE.Color {
  const s = VARIO_STOPS;
  if (v <= s[0][0]) return new THREE.Color(s[0][1]);
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const f = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return new THREE.Color(s[i - 1][1]).lerp(new THREE.Color(s[i][1]), f);
    }
  }
  return new THREE.Color(s[s.length - 1][1]);
}

/** Point indices used for line/curtain geometry: at most every 2 s, at most ~8000 points */
function decimate(m: Model): number[] {
  const t = m.res.timeline.t;
  const span = (t[m.n - 1] - t[0]) / 1000;
  const step = Math.max(2, span / 8000) * 1000;
  const idx = [0];
  for (let i = 1; i < m.n; i++) if (t[i] - t[idx[idx.length - 1]] >= step || i === m.n - 1) idx.push(i);
  return idx;
}

/** Open tube through rings (centre + radius), used for the thermal funnel */
function funnelGeometry(rings: { x: number; y: number; z: number; r: number }[], seg = 28): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  for (const rg of rings) {
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pos.push(rg.x + Math.cos(a) * rg.r, rg.y, rg.z + Math.sin(a) * rg.r);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let k = 0; k < seg; k++) {
      const a = j * (seg + 1) + k;
      const b = a + seg + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/**
 * Thermal axis as horizontal position over altitude, from the circle centres (local metres).
 * Centres are smoothed (±1 neighbour) and made monotonic in altitude; outside the measured range
 * the axis is held at the end values. Without centres the axis is vertical at (x0, z0).
 */
function thermalAxis(core: { x: number; z: number; alt: number }[], x0: number, z0: number) {
  const pts: { x: number; z: number; alt: number }[] = [];
  for (let i = 0; i < core.length; i++) {
    const a = core[Math.max(0, i - 1)], b = core[i], c = core[Math.min(core.length - 1, i + 1)];
    const p = { x: (a.x + 2 * b.x + c.x) / 4, z: (a.z + 2 * b.z + c.z) / 4, alt: b.alt };
    if (!pts.length || p.alt > pts[pts.length - 1].alt + 5) pts.push(p);
  }
  return (alt: number): [number, number] => {
    if (!pts.length) return [x0, z0];
    if (alt <= pts[0].alt) return [pts[0].x, pts[0].z];
    for (let i = 1; i < pts.length; i++) {
      if (alt <= pts[i].alt) {
        const f = (alt - pts[i - 1].alt) / (pts[i].alt - pts[i - 1].alt);
        return [pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, pts[i - 1].z + (pts[i].z - pts[i - 1].z) * f];
      }
    }
    const l = pts[pts.length - 1];
    return [l.x, l.z];
  };
}

function labelSprite(lines: string[], color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const scale = 2;
  c.width = 260 * scale;
  c.height = (24 + lines.length * 30) * scale;
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.fillStyle = 'rgba(13,17,23,.78)';
  g.beginPath();
  g.roundRect(0, 0, 260, c.height / scale, 10);
  g.fill();
  g.fillStyle = color;
  g.fillRect(0, 0, 6, c.height / scale);
  g.fillStyle = '#fff';
  g.font = '600 22px system-ui, sans-serif';
  lines.forEach((l, i) => g.fillText(l, 18, 34 + i * 30));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.userData.aspect = c.width / c.height;
  s.renderOrder = 10;
  return s;
}

export class FlightScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 20, 2_000_000);
  private track: Line2;
  private trackMat: LineMaterial;
  private ghostMat: LineMaterial;
  private curtain: THREE.Mesh;
  private idx: number[];
  private pilot: THREE.Group;
  private glider: THREE.Group;
  private dropLine: THREE.Line;
  private thermalObjs: { group: THREE.Group; label: THREE.Sprite; start: number; top: number }[] = [];
  private glideLabels: { label: THREE.Sprite; end: number }[] = [];
  private windArrow: THREE.ArrowHelper;
  private ext: number;

  constructor(private m: Model, private o: SceneOptions) {
    const ex = o.exaggeration;
    const T = m.terrain;
    this.ext = Math.max(T.maxX - T.minX, T.maxZ - T.minZ);

    // --- sky, fog, light from the sun position on the flight day
    // haze in sky colour hides the terrain edges in wide shots
    this.scene.background = new THREE.Color('#b4cfe8');
    this.scene.fog = new THREE.Fog('#b4cfe8', this.ext * 0.45, this.ext * 1.25);
    const mid = m.res.timeline.t[Math.floor(m.n / 2)];
    const sun = sunPosition(mid, T.frame.lat0, T.frame.lon0);
    const el = Math.max(12, sun.elevation) * (Math.PI / 180);
    const az = sun.azimuth * (Math.PI / 180);
    const light = new THREE.DirectionalLight('#fff6e8', 2.4);
    light.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(100000);
    this.scene.add(light, new THREE.HemisphereLight('#dbe9ff', '#5a5040', 0.9));

    // --- terrain mesh
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(T.nx * T.nz * 3);
    for (let j = 0; j < T.nz; j++) {
      for (let i = 0; i < T.nx; i++) {
        const k = j * T.nx + i;
        pos[k * 3] = T.minX + ((T.maxX - T.minX) * i) / (T.nx - 1);
        pos[k * 3 + 1] = T.heights[k] * ex;
        pos[k * 3 + 2] = T.minZ + ((T.maxZ - T.minZ) * j) / (T.nz - 1);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < T.nz - 1; j++) {
      for (let i = 0; i < T.nx - 1; i++) {
        const a = j * T.nx + i;
        index.push(a, a + T.nx, a + 1, a + 1, a + T.nx, a + T.nx + 1);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (o.texture) geo.setAttribute('uv', new THREE.BufferAttribute(o.texture.uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();

    let mat: THREE.MeshStandardMaterial;
    if (o.texture) {
      const tex = new THREE.CanvasTexture(o.texture.canvas as unknown as HTMLCanvasElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: '#f1ede4', roughness: 0.95, metalness: 0 });
    }
    if (o.layers.contours) this.addContours(mat, o.texture ? 200 : 100, ex);
    this.scene.add(new THREE.Mesh(geo, mat));

    // --- track (vario coloured), revealed progressively via instanceCount
    this.idx = decimate(m);
    const tl = m.res.timeline;
    const positions: number[] = [];
    const colors: number[] = [];
    for (const i of this.idx) {
      positions.push(m.x[i], m.alt[i] * ex + (m.isHike[i] ? 3 : 0), m.z[i]);
      const c = m.isHike[i] ? new THREE.Color('#8bc34a') : varioColor(tl.vario[i]);
      colors.push(c.r, c.g, c.b);
    }
    const lg = new LineGeometry();
    lg.setPositions(positions);
    lg.setColors(colors);
    this.trackMat = new LineMaterial({ vertexColors: true, linewidth: 4, worldUnits: false });
    this.track = new Line2(lg, this.trackMat);
    this.track.computeLineDistances();
    this.scene.add(this.track);
    // faint full route for orientation
    const ghostGeo = new LineGeometry();
    ghostGeo.setPositions(positions);
    this.ghostMat = new LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, opacity: 0.35, depthWrite: false });
    this.scene.add(new Line2(ghostGeo, this.ghostMat));

    // --- curtain from track down to the ground (height above ground; red below 150 m)
    {
      const cp: number[] = [];
      const cc: number[] = [];
      const white = new THREE.Color('#ffffff');
      const red = new THREE.Color('#ff3b30');
      for (let k = 0; k < this.idx.length - 1; k++) {
        const a = this.idx[k], b = this.idx[k + 1];
        const ya = m.alt[a] * ex, yb = m.alt[b] * ex;
        const ga = m.ground[a] * ex, gb = m.ground[b] * ex;
        cp.push(m.x[a], ya, m.z[a], m.x[a], ga, m.z[a], m.x[b], yb, m.z[b], m.x[b], yb, m.z[b], m.x[a], ga, m.z[a], m.x[b], gb, m.z[b]);
        const low = m.agl[a] < LOW_AGL && !m.isHike[a];
        const col = m.isHike[a] ? new THREE.Color('#8bc34a') : low ? red : white;
        for (let v = 0; v < 6; v++) cc.push(col.r, col.g, col.b);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
      this.curtain = new THREE.Mesh(
        cg,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.curtain.visible = o.layers.curtain;
      this.scene.add(this.curtain);
    }

    // --- thermal funnels: follow the drifting core (circle centres) when enabled
    if (o.layers.thermals) {
      const r = Math.max(80, this.ext * 0.003);
      // labels only for the strongest thermals, otherwise they pile up
      const labelled = new Set([...m.thermals].sort((a, b) => b.gain - a.gain).slice(0, 8).map((t) => t.idx));
      for (const th of m.thermals) {
        const g = new THREE.Group();
        const color = varioColor(th.avgClimb);
        const [x, z] = m.terrain.frame.toXZ(th.lat, th.lon);
        const core = o.layers.drift && th.core && th.core.length >= 2
          ? th.core.map((c) => { const [cx, cz] = m.terrain.frame.toXZ(c.lat, c.lon); return { x: cx, z: cz, alt: c.alt }; })
          : [];
        const axis = thermalAxis(core, x, z);
        const N = 16;
        const rings = Array.from({ length: N + 1 }, (_, k) => {
          const alt = th.baseAlt + ((th.topAlt - th.baseAlt) * k) / N;
          const [ax, az] = axis(alt);
          return { x: ax, y: alt * ex, z: az, r: r * (0.55 + 0.5 * (k / N)) };
        });
        const funnel = new THREE.Mesh(
          funnelGeometry(rings),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
        );
        g.add(funnel);
        const top = rings[N];
        const ring = new THREE.Mesh(new THREE.TorusGeometry(top.r, r * 0.06, 6, 32), new THREE.MeshBasicMaterial({ color }));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(top.x, top.y, top.z);
        g.add(ring);
        const lines = [`+${th.avgClimb.toFixed(1)} m/s`, `+${Math.round(th.gain)} m`];
        if (core.length >= 2) {
          // vertical reference from the base: makes the drift of the core visible
          const base = rings[0];
          const ref = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(base.x, base.y, base.z), new THREE.Vector3(base.x, top.y, base.z)]),
            new THREE.LineDashedMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, dashSize: r * 0.6, gapSize: r * 0.4 }),
          );
          ref.computeLineDistances();
          // circle centres as small dots along the core
          const dotGeo = new THREE.SphereGeometry(r * 0.12, 8, 6);
          const dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 });
          for (const c of core) {
            const d = new THREE.Mesh(dotGeo, dotMat);
            d.position.set(c.x, c.alt * ex, c.z);
            g.add(d);
          }
          g.add(ref);
          const dx = top.x - base.x;
          const dz = top.z - base.z;
          const off = Math.hypot(dx, dz);
          if (off >= 30) lines.push(`${t('Versatz')} ${Math.round(off)} m ${compass(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360)}`);
        }
        const label = labelSprite(lines, `#${color.getHexString()}`);
        label.position.set(top.x, top.y + r * 2.2, top.z);
        label.visible = labelled.has(th.idx);
        g.add(label);
        g.visible = false;
        this.scene.add(g);
        this.thermalObjs.push({ group: g, label, start: th.start, top: th.topAlt });
      }
    }

    // --- glide ratio labels on the longer glides
    if (o.layers.glides) {
      const long = m.glides.filter((gl) => gl.ratio != null && gl.distanceKm >= 2 && !m.isHike[gl.start]);
      const shown = new Set([...long].sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 12));
      for (const gl of long) {
        if (!shown.has(gl)) continue;
        const mid = (gl.start + gl.end) >> 1;
        const label = labelSprite([`${t('GZ')} 1:${gl.ratio!.toFixed(1)}`, `${gl.distanceKm.toFixed(1)} km · −${Math.round(gl.loss)} m`], '#4fc3f7');
        label.position.set(m.x[mid], m.alt[mid] * ex + Math.max(60, this.ext * 0.004), m.z[mid]);
        label.visible = false;
        this.scene.add(label);
        this.glideLabels.push({ label, end: gl.end });
      }
    }

    // --- pilot marker + drop line
    this.pilot = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), new THREE.MeshBasicMaterial({ color: '#ff8a3d' }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.8, 20, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }));
    this.pilot.add(dot, halo);
    this.pilot.renderOrder = 5;
    this.scene.add(this.pilot);
    // in flight the dot is replaced by a paraglider that follows heading and bank
    this.glider = buildGlider(o.glider);
    this.glider.rotation.order = 'YXZ';
    this.scene.add(this.glider);
    this.dropLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }),
    );
    this.scene.add(this.dropLine);

    this.windArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, '#4fc3f7');
    this.windArrow.visible = false;
    this.scene.add(this.windArrow);
  }

  /** Contour lines in the fragment shader, from world height */
  private addContours(mat: THREE.MeshStandardMaterial, interval: number, ex: number) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uInterval = { value: interval * ex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;\nuniform float uInterval;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          float c = vH / uInterval;
          float w = fwidth(c);
          float line = 1.0 - smoothstep(0.0, w * 1.2, min(fract(c), 1.0 - fract(c)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.32, 0.26, 0.2), line * 0.35);`,
        );
    };
  }

  update(fr: Frame, width: number, height: number) {
    const m = this.m;
    const ex = this.o.exaggeration;
    const fi = fr.fi;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(...fr.cam);
    this.camera.lookAt(...fr.target);
    this.trackMat.resolution.set(width, height);
    this.trackMat.linewidth = Math.max(2.5, height / 300);
    this.ghostMat.resolution.set(width, height);
    this.ghostMat.linewidth = Math.max(1.5, height / 600);

    // reveal track/curtain up to the current point
    const all = fr.phase === 'outro';
    let k = this.idx.length - 1;
    if (!all) {
      let lo = 0;
      while (lo < k) {
        const mid = (lo + k + 1) >> 1;
        if (this.idx[mid] <= fi) lo = mid;
        else k = mid - 1;
      }
      k = lo;
    }
    (this.track.geometry as LineGeometry).instanceCount = Math.max(0, fr.phase === 'intro' ? 0 : k);
    this.curtain.geometry.setDrawRange(0, Math.max(0, fr.phase === 'intro' ? 0 : k) * 6);

    const p = new THREE.Vector3(lerpAt(m.x, fi), lerpAt(m.alt, fi) * ex, lerpAt(m.z, fi));
    const camDist = this.camera.position.distanceTo(p);
    const s = camDist * 0.006;
    const i = Math.round(fi);
    const flying = !m.isHike[i];
    this.pilot.position.copy(p);
    this.pilot.scale.setScalar(s);
    this.pilot.visible = fr.phase !== 'outro' && !flying;
    this.glider.visible = fr.phase !== 'outro' && flying;
    if (this.glider.visible) {
      this.glider.position.copy(p);
      this.glider.scale.setScalar(Math.max(1, (camDist * 0.05 * this.o.gliderSize) / GLIDER_SPAN));
      const hx = lerpAt(m.hx, fi);
      const hz = lerpAt(m.hz, fi);
      // yaw turns +Z (model forward) into the direction of travel, roll banks into the turn
      this.glider.rotation.set(0, Math.atan2(hx, hz), lerpAt(m.bank, fi));
    }
    const g = lerpAt(m.ground, fi) * ex;
    (this.dropLine.geometry as THREE.BufferGeometry).setFromPoints([p, new THREE.Vector3(p.x, g, p.z)]);
    this.dropLine.visible = this.glider.visible;

    for (const th of this.thermalObjs) {
      th.group.visible = all || fi >= th.start;
      const d = this.camera.position.distanceTo(th.label.position);
      const h = d * 0.045;
      th.label.scale.set(h * th.label.userData.aspect, h, 1);
    }

    for (const gl of this.glideLabels) {
      gl.label.visible = all || fi >= gl.end;
      const h = this.camera.position.distanceTo(gl.label.position) * 0.04;
      gl.label.scale.set(h * gl.label.userData.aspect, h, 1);
    }

    const t = m.res.timeline.t[Math.round(fi)];
    const w = this.o.layers.wind ? windAt(m, t) : null;
    if (w && fr.phase === 'play' && !m.isHike[Math.round(fi)]) {
      const toRad = ((w.fromDeg + 180) % 360) * (Math.PI / 180);
      const dir = new THREE.Vector3(Math.sin(toRad), 0, -Math.cos(toRad));
      const len = camDist * 0.04 * Math.min(3, 0.6 + w.speedKmh / 10);
      this.windArrow.position.copy(p).add(new THREE.Vector3(0, camDist * 0.05, 0)).addScaledVector(dir, -len / 2);
      this.windArrow.setDirection(dir);
      this.windArrow.setLength(len, len * 0.35, len * 0.22);
      this.windArrow.visible = true;
    } else this.windArrow.visible = false;
  }

  dispose() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
        (x as THREE.MeshBasicMaterial).map?.dispose();
        x.dispose();
      });
    });
  }
}
