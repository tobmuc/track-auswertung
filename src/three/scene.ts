import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { VARIO_STOPS } from '../app/colors';
import type { Frame, Plan } from './director';
import { lerpAt, windAt, type Model } from './model';
import { sunPosition, sunTime, sunVector, type SunSettings } from './sun';
import type { Terrain, TerrainTexture } from './terrain';
import { buildGlider, GLIDER_SPAN } from './glider';
import type { GliderDesign } from './gliderDesigns';
import type { Poi } from '../app/pois';
import { LiftParticles } from './particles';
import { companionFi, type Companion } from './companions';
import { compass } from '../core/geo';
import type { Thermal } from '../core';
import { t } from '../app/i18n';

export interface SceneOptions {
  /** draped map, or null for the plaster relief */
  texture: TerrainTexture | null;
  exaggeration: number;
  /** opacity of the 3D wind arrow, 0..1 */
  windOpacity: number;
  layers: {
    thermals: boolean; drift: boolean; glides: boolean; curtain: boolean; wind: boolean; contours: boolean; pois: boolean; particles: boolean;
    /** thermal trigger: axis extended down to the ground */
    triggers: boolean;
    /** cumulus at cloud base over the thermals */
    clouds: boolean;
  };
  /** further flights in the same area, each with its own colour and glider */
  companions: Companion[];
  /** minutes after which the track fades out (thermal circles stay); 0 = never */
  fadeMin: number;
  sun: SunSettings;
  /** cloud base m MSL at a main-flight time; null = unknown */
  cloudBase: ((t: number) => number) | null;
  /** Glider size on screen (1 = span = GLIDER_SCREEN × camera distance; never below real size) */
  gliderSize: number;
  /** factor on the drawn bank angle (1 = as measured); the HUD keeps the measured value */
  bankScale?: number;
  glider: GliderDesign;
  /** how the pilot is shown in flight */
  pilotStyle: 'glider' | 'firefly' | 'both';
  /** selected POIs with local position and terrain height */
  pois: (Poi & { x: number; z: number; ground: number })[];
}

const LOW_AGL = 150;
/** glider span as a share of the camera distance at size 1 (≈ 8 % of the picture width in portrait) */
const GLIDER_SCREEN = 0.065;

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
  g.computeVertexNormals();
  return g;
}

/** 0..1 with soft start and end */
const ease = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

/**
 * Soft glowing column: brighter where the surface faces the camera, fading towards the silhouette,
 * the bottom and the top, so it reads as a volume of warm air rather than a hard tube.
 * uGrow (0..1): share of the height drawn at full strength, the rest stays faint.
 */
function softColumnMaterial(color: THREE.Color, opacity: number, y0: number, y1: number, fadeTop = 0.35, fadeBottom = 0.12): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opacity },
      uY0: { value: y0 },
      uY1: { value: y1 },
      uGrow: { value: 1 },
      uFadeTop: { value: fadeTop },
      uFadeBot: { value: fadeBottom },
    },
    // the renderer uses a logarithmic depth buffer: custom shaders need its chunks, or nothing shows
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vY = wp.y;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uOpacity, uY0, uY1, uGrow, uFadeTop, uFadeBot;
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float h = clamp((vY - uY0) / max(1.0, uY1 - uY0), 0.0, 1.0);
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float a = uOpacity * pow(facing, 1.6);
        a *= (uFadeBot > 0.0 ? smoothstep(0.0, uFadeBot, h) : 1.0) * mix(1.0, uFadeTop, smoothstep(0.55, 1.0, h));
        // whole tube shows at once; up to the height the pilot has reached it glows at full strength
        a *= mix(0.4, 1.0, 1.0 - smoothstep(uGrow - 0.06, uGrow, h));
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Sets a uniform fade on everything in a group, remembering each material's own opacity */
function fadeGroup(g: THREE.Object3D, a: number) {
  g.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    if (!mats) return;
    for (const mat of Array.isArray(mats) ? mats : [mats]) {
      if (mat instanceof THREE.ShaderMaterial && mat.uniforms.uOpacity) {
        mat.userData.base ??= mat.uniforms.uOpacity.value;
        mat.uniforms.uOpacity.value = mat.userData.base * a;
      } else {
        mat.userData.base ??= mat.opacity;
        mat.transparent = true;
        mat.opacity = mat.userData.base * a;
      }
    }
  });
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

/**
 * Horizontal drift of the thermal per metre of height (x, z): least squares through the circle
 * centres, else wind speed / climb rate downwind, else vertical. Limited to 2.5 m per metre.
 */
function driftPerMetre(th: Thermal, core: { x: number; z: number; alt: number }[]): [number, number] {
  let sx = 0, sz = 0;
  if (core.length >= 3) {
    const n = core.length;
    const ma = core.reduce((s, c) => s + c.alt, 0) / n;
    const mx = core.reduce((s, c) => s + c.x, 0) / n;
    const mz = core.reduce((s, c) => s + c.z, 0) / n;
    let saa = 0, sax = 0, saz = 0;
    for (const c of core) {
      saa += (c.alt - ma) ** 2;
      sax += (c.alt - ma) * (c.x - mx);
      saz += (c.alt - ma) * (c.z - mz);
    }
    if (saa > 100) { sx = sax / saa; sz = saz / saa; }
  } else {
    const w = th.drift ?? th.wind;
    if (w && th.avgClimb > 0.3) {
      const to = ((w.fromDeg + 180) * Math.PI) / 180;
      const k = w.speedKmh / 3.6 / th.avgClimb;
      sx = Math.sin(to) * k;
      sz = -Math.cos(to) * k;
    }
  }
  const len = Math.hypot(sx, sz);
  return len > 2.5 ? [(sx / len) * 2.5, (sz / len) * 2.5] : [sx, sz];
}

/** Follows the thermal axis down from its lowest point until it meets the terrain */
function findTrigger(T: Terrain, x: number, z: number, alt: number, slope: [number, number]) {
  for (let d = 0; d <= 4000; d += 10) {
    const px = x - slope[0] * d;
    const pz = z - slope[1] * d;
    const h = T.heightAt(px, pz);
    if (alt - d <= h) return { x: px, z: pz, h };
  }
  return { x: x - slope[0] * 4000, z: z - slope[1] * 4000, h: T.heightAt(x - slope[0] * 4000, z - slope[1] * 4000) };
}

/** Slope angle (deg) and the compass direction it faces at a point */
function slopeAt(T: Terrain, x: number, z: number): { angle: number; facing: number } {
  const d = 60;
  const gx = (T.heightAt(x + d, z) - T.heightAt(x - d, z)) / (2 * d);
  const gz = (T.heightAt(x, z + d) - T.heightAt(x, z - d)) / (2 * d);
  // downhill direction (-gx, -gz); z points south, so north = -z
  return { angle: (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI, facing: ((Math.atan2(-gx, gz) * 180) / Math.PI + 360) % 360 };
}

/** Disc lying on the terrain (heights sampled per vertex), slightly lifted to avoid z-fighting */
function drapedDisc(T: Terrain, cx: number, cz: number, r: number, ex: number, seg = 32, rings = 4): THREE.BufferGeometry {
  // the terrain mesh is coarser than the disc: lift with the size so ridges between vertices do not cut into it
  const lift = Math.max(6, r * 0.25) * ex;
  const pos: number[] = [cx, T.heightAt(cx, cz) * ex + lift, cz];
  const index: number[] = [];
  for (let j = 1; j <= rings; j++) {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const x = cx + Math.cos(a) * (r * j) / rings;
      const z = cz + Math.sin(a) * (r * j) / rings;
      pos.push(x, T.heightAt(x, z) * ex + lift, z);
    }
  }
  for (let k = 0; k < seg; k++) index.push(0, 1 + ((k + 1) % seg), 1 + k);
  for (let j = 1; j < rings; j++) {
    const a0 = 1 + (j - 1) * seg, b0 = 1 + j * seg;
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      index.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/** Shared uniforms of all fading tracks: current time and fade duration in seconds since the main launch */
interface FadeUniforms { uNow: { value: number }; uFade: { value: number } }
const FADE_DECL = 'uniform float uNow;\nuniform float uFade;\nvarying float vTime;\n';
// vTime < 0 marks thermal circles, which never fade
const FADE_ALPHA = 'float fadeA = vTime < 0.0 ? 1.0 : 1.0 - smoothstep( uFade * 0.6, uFade, uNow - vTime );\nif ( fadeA < 0.004 ) discard;';

/** Makes a track line fade with age; `times` per point (s), -1 = keep */
function fadeLine(mat: LineMaterial, geo: LineGeometry, times: number[], u: FadeUniforms) {
  const seg = new Float32Array((times.length - 1) * 2);
  for (let k = 0; k < times.length - 1; k++) {
    // a segment touching a thermal keeps both ends, otherwise the varying blends -1 into the age
    const keep = times[k] < 0 || times[k + 1] < 0;
    seg[2 * k] = keep ? -1 : times[k];
    seg[2 * k + 1] = keep ? -1 : times[k + 1];
  }
  const buf = new THREE.InstancedInterleavedBuffer(seg, 2, 1);
  geo.setAttribute('instanceTimeStart', new THREE.InterleavedBufferAttribute(buf, 1, 0));
  geo.setAttribute('instanceTimeEnd', new THREE.InterleavedBufferAttribute(buf, 1, 1));
  mat.transparent = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float instanceTimeStart;\nattribute float instanceTimeEnd;\nvarying float vTime;\n' +
      sh.vertexShader.replace('void main() {', 'void main() {\n\tvTime = ( position.y < 0.5 ) ? instanceTimeStart : instanceTimeEnd;');
    sh.fragmentShader = FADE_DECL + sh.fragmentShader.replace(
      'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
      `${FADE_ALPHA}\n\tgl_FragColor = vec4( diffuseColor.rgb, alpha * fadeA );`,
    );
  };
}

/** Same fade for a mesh with a per-vertex `aTime` attribute (the curtain) */
function fadeMesh(mat: THREE.Material, u: FadeUniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float aTime;\nvarying float vTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTime = aTime;');
    sh.fragmentShader = FADE_DECL + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${FADE_ALPHA}\ngl_FragColor.a *= fadeA;`);
  };
}

/** Small deterministic random generator, so a cloud looks the same in every frame and export */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

let puffTex: THREE.CanvasTexture | null = null;
/** Soft cauliflower puff: a few overlapping round blobs */
function cloudPuffTexture(): THREE.CanvasTexture {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = rng(7);
  for (let k = 0; k < 7; k++) {
    const x = 64 + (r() - 0.5) * 40, y = 64 + (r() - 0.5) * 30, rad = 26 + r() * 22;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,.9)');
    grd.addColorStop(0.6, 'rgba(255,255,255,.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}

/** Cumulus as a cluster of puffs: dome on top, grey flat-ish base at y = 0 of the group */
function buildCloud(R: number, seed: number): { group: THREE.Group; mats: THREE.SpriteMaterial[] } {
  const group = new THREE.Group();
  const tex = cloudPuffTexture();
  const top = new THREE.SpriteMaterial({ map: tex, color: '#ffffff', transparent: true, depthWrite: false });
  const mid = new THREE.SpriteMaterial({ map: tex, color: '#e3e7ee', transparent: true, depthWrite: false });
  const base = new THREE.SpriteMaterial({ map: tex, color: '#a9b2bf', transparent: true, depthWrite: false });
  const r = rng(seed);
  const add = (mat: THREE.SpriteMaterial, x: number, y: number, z: number, s: number) => {
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, y, z);
    sp.scale.setScalar(s);
    sp.renderOrder = 3;
    group.add(sp);
  };
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2, d = R * (0.2 + 0.6 * r());
    add(base, Math.cos(a) * d, R * 0.18, Math.sin(a) * d, R * (0.7 + 0.3 * r()));
  }
  for (let k = 0; k < 12; k++) {
    const a = r() * Math.PI * 2, d = R * 0.75 * Math.sqrt(r());
    const h = R * (0.4 + 0.7 * r() * (1 - d / R));
    add(h > R * 0.7 ? top : mid, Math.cos(a) * d, h, Math.sin(a) * d, R * (0.6 + 0.4 * r()));
  }
  add(top, 0, R * 1.05, 0, R * 0.85);
  return { group, mats: [top, mid, base] };
}

type Ctx2D = CanvasRenderingContext2D & { letterSpacing: string };

/** Map-style POI caption: spaced capitals, elevation below, no box; anchored at its bottom centre */
function poiSprite(name: string, ele: number): THREE.Sprite {
  const scale = 2;
  const c = document.createElement('canvas');
  const g = c.getContext('2d') as Ctx2D;
  const big = '400 30px system-ui, sans-serif';
  const small = '400 21px system-ui, sans-serif';
  const title = name.toUpperCase();
  const sub = `${Math.round(ele)} M`;
  g.font = big;
  g.letterSpacing = '3px';
  const w = Math.ceil(Math.max(g.measureText(title).width, 120)) + 24;
  c.width = w * scale;
  c.height = 84 * scale;
  g.scale(scale, scale);
  g.textAlign = 'center';
  g.shadowColor = 'rgba(0,0,0,.55)';
  g.shadowBlur = 6;
  g.fillStyle = '#ffffff';
  g.font = big;
  g.letterSpacing = '3px';
  g.fillText(title, w / 2, 32);
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.font = small;
  g.letterSpacing = '2px';
  g.fillText(sub, w / 2, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.center.set(0.5, 0);
  sp.userData.aspect = c.width / c.height;
  sp.renderOrder = 9;
  return sp;
}

/** Soft round glow for the firefly */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,250,225,.95)');
  grd.addColorStop(0.35, 'rgba(255,235,170,.35)');
  grd.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
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
  private thermalObjs: {
    group: THREE.Group; label: THREE.Sprite; start: number; end: number; top: number; rim: LineMaterial;
    funnel: THREE.ShaderMaterial; y0: number; y1: number;
  }[] = [];
  /** first video frame at which the timeline index is reached, per index (cached per plan) */
  private frameCache = { plan: null as Plan | null, map: new Map<number, number>() };
  /** wind arrow opacity, eased over video frames */
  private windFade = { frame: -10, a: 0 };
  /** shared material of the thermal rims, width set per frame from the output height */
  private rimMat = new LineMaterial({ vertexColors: true, linewidth: 2, worldUnits: false });
  private glideLabels: { label: THREE.Sprite; end: number }[] = [];
  private poiObjs: { label: THREE.Sprite; stick: THREE.Line; top: THREE.Vector3 }[] = [];
  private firefly: THREE.Sprite;
  private particles: LiftParticles | null = null;
  private trailCore: Line2;
  private trailHalo: Line2;
  private trailCoreMat: LineMaterial;
  private trailHaloMat: LineMaterial;
  private windArrow: THREE.ArrowHelper;
  private ghost: Line2;
  private fade: FadeUniforms = { uNow: { value: 0 }, uFade: { value: 1e9 } };
  private sunLight: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky = { day: new THREE.Color('#b4cfe8'), dusk: new THREE.Color('#e9c6a5'), night: new THREE.Color('#1d2635') };
  private clouds: { group: THREE.Group; mats: THREE.SpriteMaterial[]; R: number; start: number; end: number; center: THREE.Vector3 }[] = [];
  private comps: { c: Companion; idx: number[]; line: Line2; mat: LineMaterial; glider: THREE.Group; tag: THREE.Sprite; drop: THREE.Line }[] = [];
  private triggerLabels: THREE.Sprite[] = [];
  /** attitude smoothed over video frames (the time lapse would otherwise make it jump) */
  private att = { frame: -10, roll: 0, pitch: 0 };
  private ext: number;

  constructor(private m: Model, private o: SceneOptions) {
    const ex = o.exaggeration;
    const T = m.terrain;
    this.ext = Math.max(T.maxX - T.minX, T.maxZ - T.minZ);

    // --- sky, fog, light from the sun position on the flight day
    // haze in sky colour hides the terrain edges in wide shots
    this.scene.background = new THREE.Color('#b4cfe8');
    this.scene.fog = new THREE.Fog('#b4cfe8', this.ext * 0.45, this.ext * 1.25);
    // the light follows the sun over the flight (see updateSun); shadows only on request
    this.sunLight = new THREE.DirectionalLight('#fff6e8', 2.4);
    this.sunLight.castShadow = o.sun.shadows;
    this.sunLight.shadow.mapSize.set(4096, 4096);
    this.sunLight.shadow.bias = -0.0004;
    this.hemi = new THREE.HemisphereLight('#dbe9ff', '#5a5040', 0.9);
    this.scene.add(this.sunLight, this.sunLight.target, this.hemi);

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
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = ground.castShadow = o.sun.shadows;
    this.scene.add(ground);

    // fade times per point: seconds since the main flight's first fix, -1 inside thermals (they stay)
    const t0 = m.res.timeline.t[0];
    const timesFor = (mm: Model, idx: number[], offsetMs: number) => {
      const keep = new Uint8Array(mm.n);
      for (const th of mm.thermals) keep.fill(1, th.start, th.end + 1);
      return idx.map((i) => (keep[i] ? -1 : (mm.res.timeline.t[i] - offsetMs - t0) / 1000));
    };

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
    const times = timesFor(m, this.idx, 0);
    if (o.fadeMin > 0) fadeLine(this.trackMat, lg, times, this.fade);
    this.scene.add(this.track);
    // faint full route for orientation (hidden while the track fades, it would undo the effect)
    const ghostGeo = new LineGeometry();
    ghostGeo.setPositions(positions);
    this.ghostMat = new LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = new Line2(ghostGeo, this.ghostMat);
    this.scene.add(this.ghost);

    // --- curtain from track down to the ground (height above ground; red below 150 m)
    {
      const cp: number[] = [];
      const cc: number[] = [];
      const ct: number[] = [];
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
        const keep = times[k] < 0 || times[k + 1] < 0;
        const ta = keep ? -1 : times[k], tb = keep ? -1 : times[k + 1];
        ct.push(ta, ta, tb, tb, ta, tb);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
      cg.setAttribute('aTime', new THREE.Float32BufferAttribute(ct, 1));
      const cm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
      if (o.fadeMin > 0) fadeMesh(cm, this.fade);
      this.curtain = new THREE.Mesh(cg, cm);
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
          // half the original width: hugs the circles more closely
          return { x: ax, y: alt * ex, z: az, r: r * 0.5 * (0.55 + 0.5 * (k / N)) };
        });
        // soft column of warm air instead of a hard tube
        const funnelMat = softColumnMaterial(color, 0.75, rings[0].y, rings[N].y, 0.6);
        const funnel = new THREE.Mesh(funnelGeometry(rings), funnelMat);
        funnel.renderOrder = 1;
        g.add(funnel);
        const top = rings[N];
        // thin rim with a fixed width on screen (a torus got fat when the camera came close)
        const rim: number[] = [];
        const rimCol: number[] = [];
        for (let k = 0; k <= 48; k++) {
          const a = (k / 48) * Math.PI * 2;
          rim.push(top.x + Math.cos(a) * top.r, top.y, top.z + Math.sin(a) * top.r);
          rimCol.push(color.r, color.g, color.b);
        }
        const rimGeo = new LineGeometry();
        rimGeo.setPositions(rim);
        rimGeo.setColors(rimCol);
        const rimMat = this.rimMat.clone();
        rimMat.transparent = true;
        g.add(new Line2(rimGeo, rimMat));
        const lines = [`+${th.avgClimb.toFixed(1)} m/s`, `+${Math.round(th.gain)} m`];
        if (core.length >= 2) {
          // vertical reference from the base: makes the drift of the core visible
          const base = rings[0];
          const ref = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(base.x, base.y, base.z), new THREE.Vector3(base.x, top.y, base.z)]),
            new THREE.LineDashedMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, dashSize: r * 0.6, gapSize: r * 0.4 }),
          );
          ref.computeLineDistances();
          // circle centres as small dots along the core, fixed size on screen
          const dots = new THREE.Points(
            new THREE.BufferGeometry().setFromPoints(core.map((c) => new THREE.Vector3(c.x, c.alt * ex, c.z))),
            new THREE.PointsMaterial({ color: '#ffffff', size: 5, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }),
          );
          g.add(dots);
          g.add(ref);
          const dx = top.x - base.x;
          const dz = top.z - base.z;
          const off = Math.hypot(dx, dz);
          if (off >= 30) lines.push(`${t('Versatz')} ${Math.round(off)} m ${compass(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360)}`);
        }
        const slope = driftPerMetre(th, core);
        if (o.layers.triggers) {
          // trigger: the axis continued below the lowest circle until it meets the ground
          const base = rings[0];
          const trg = findTrigger(T, base.x, base.z, th.baseAlt, slope);
          const tr = Math.max(40, this.ext * 0.0015);
          const disc = new THREE.Mesh(
            drapedDisc(T, trg.x, trg.z, tr, ex),
            new THREE.MeshBasicMaterial({ color: '#ffb74d', transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
          );
          const spot = new THREE.Mesh(
            drapedDisc(T, trg.x, trg.z, tr * 0.3, ex, 16, 1),
            new THREE.MeshBasicMaterial({ color: '#ff6d00', transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
          );
          disc.renderOrder = spot.renderOrder = 2;
          const axisLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(trg.x, trg.h * ex, trg.z), new THREE.Vector3(base.x, base.y, base.z)]),
            new THREE.LineDashedMaterial({ color: '#ffb74d', transparent: true, opacity: 0.85, dashSize: r * 0.5, gapSize: r * 0.35 }),
          );
          axisLine.computeLineDistances();
          g.add(disc, spot, axisLine);
          // the thermal below the lowest circle: the same tube continued down to the trigger,
          // narrow at the ground and widening upwards like the air bubble rising from it; faint at the
          // ground and joining the funnel without a seam
          const gy = trg.h * ex;
          if (base.y - gy > r) {
            const K = 8;
            const col = new THREE.Mesh(
              funnelGeometry(Array.from({ length: K + 1 }, (_, k) => {
                const f = k / K;
                return { x: trg.x + (base.x - trg.x) * f, y: gy + (base.y - gy) * f, z: trg.z + (base.z - trg.z) * f, r: base.r * (0.25 + 0.75 * f) };
              })),
              softColumnMaterial(color, 0.75, gy, base.y, 1, 0.85),
            );
            col.renderOrder = 1;
            g.add(col);
            funnelMat.uniforms.uFadeBot.value = 0;
          }
          if (labelled.has(th.idx)) {
            const sl = slopeAt(T, trg.x, trg.z);
            const tl = labelSprite([`${t('Auslöser')} ${Math.round(trg.h)} m`, sl.angle >= 5 ? `${t('Hang')} ${Math.round(sl.angle)}° ${compass(sl.facing)}` : t('flach')], '#ffb74d');
            tl.position.set(trg.x, trg.h * ex + r * 1.6, trg.z);
            g.add(tl);
            this.triggerLabels.push(tl);
          }
        }
        if (o.layers.clouds && o.cloudBase) {
          // cumulus where the axis, continued upwards with the same drift, reaches the cloud base
          const cb = Math.max(o.cloudBase(m.res.timeline.t[th.end]), th.topAlt + 50);
          const up = cb - th.topAlt;
          const cx = top.x + slope[0] * up, cz = top.z + slope[1] * up;
          const R = Math.min(900, Math.max(250, 220 + 140 * th.avgClimb + 0.12 * th.gain));
          const cl = buildCloud(R, th.idx + 1);
          cl.group.position.set(cx, cb * ex, cz);
          cl.group.visible = false;
          this.scene.add(cl.group);
          const link = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(top.x, top.y, top.z), new THREE.Vector3(cx, cb * ex, cz)]),
            new THREE.LineDashedMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, dashSize: r * 0.25, gapSize: r * 0.5 }),
          );
          link.computeLineDistances();
          g.add(link);
          lines.push(`${t('Basis')} ${Math.round(cb)} m`);
          this.clouds.push({ ...cl, R, start: th.entry, end: th.end, center: new THREE.Vector3(cx, cb * ex + R * 0.6, cz) });
        }
        const label = labelSprite(lines, `#${color.getHexString()}`);
        label.position.set(top.x, top.y + r * 2.2, top.z);
        label.visible = labelled.has(th.idx);
        g.add(label);
        g.visible = false;
        this.scene.add(g);
        this.thermalObjs.push({ group: g, label, start: th.entry, end: th.end, top: th.topAlt, rim: rimMat, funnel: funnelMat, y0: rings[0].y, y1: rings[N].y });
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

    // --- POIs: thin vertical stick from the ground up to a caption
    if (o.layers.pois) {
      for (const poi of o.pois) {
        const ground = poi.ground * ex;
        // fixed real height: tied to the area size the sticks grew to kilometres on long flights
        const h = 600 * ex;
        const top = new THREE.Vector3(poi.x, ground + h, poi.z);
        const stick = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(poi.x, ground, poi.z), top]),
          new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }),
        );
        const label = poiSprite(poi.name, poi.ele ?? poi.ground);
        label.position.copy(top);
        this.scene.add(stick, label);
        this.poiObjs.push({ label, stick, top });
      }
    }

    // --- air flow streaks in strong thermals and straight climbs
    // zones are also needed without the streaks: the glider rocks when it flies into them
    this.particles = new LiftParticles(m, ex, this.ext);
    if (o.layers.particles) this.scene.add(this.particles.object);

    // --- firefly: glowing point with a comet tail of the last minutes
    this.firefly = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.firefly.renderOrder = 6;
    this.scene.add(this.firefly);
    this.trailCoreMat = new LineMaterial({ vertexColors: true, linewidth: 3, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.trailHaloMat = new LineMaterial({ vertexColors: true, linewidth: 10, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.trailCore = new Line2(new LineGeometry(), this.trailCoreMat);
    this.trailHalo = new Line2(new LineGeometry(), this.trailHaloMat);
    this.trailCore.frustumCulled = false;
    this.trailHalo.frustumCulled = false;
    this.scene.add(this.trailHalo, this.trailCore);

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
    this.glider.traverse((c) => (c.castShadow = o.sun.shadows));
    this.scene.add(this.glider);

    // --- further pilots: own colour for track and name tag, own glider
    for (const c of o.companions) {
      const cm = c.model;
      const idx = decimate(cm);
      const pts: number[] = [];
      for (const i of idx) pts.push(cm.x[i], cm.alt[i] * ex + (cm.isHike[i] ? 3 : 0), cm.z[i]);
      const geo = new LineGeometry();
      geo.setPositions(pts);
      const mat = new LineMaterial({ color: new THREE.Color(c.color).getHex(), linewidth: 3, worldUnits: false });
      if (o.fadeMin > 0) fadeLine(mat, geo, timesFor(cm, idx, c.offsetMs), this.fade);
      const line = new Line2(geo, mat);
      const glider = buildGlider(c.design);
      glider.rotation.order = 'YXZ';
      glider.traverse((x) => (x.castShadow = o.sun.shadows));
      const tag = labelSprite([c.name], c.color);
      tag.center.set(0.5, 0);
      const drop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: c.color, transparent: true, opacity: 0.5 }),
      );
      this.scene.add(line, glider, tag, drop);
      this.comps.push({ c, idx, line, mat, glider, tag, drop });
    }
    this.dropLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }),
    );
    this.scene.add(this.dropLine);

    this.windArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, '#4fc3f7');
    this.windArrow.visible = false;
    for (const mat of [this.windArrow.line.material, this.windArrow.cone.material] as THREE.Material[]) {
      mat.transparent = true;
      mat.opacity = o.windOpacity;
      mat.depthWrite = false;
    }
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

  update(fr: Frame, width: number, height: number, video?: { frameNo: number; plan: Plan }) {
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
    for (const th of this.thermalObjs) {
      th.rim.resolution.set(width, height);
      th.rim.linewidth = Math.max(1.5, height / 540);
    }

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
    const style = this.o.pilotStyle;
    this.pilot.visible = fr.phase !== 'outro' && !flying;
    this.glider.visible = fr.phase !== 'outro' && flying && style !== 'firefly';
    this.updateFirefly(fr, p, camDist, flying && style !== 'glider', video?.frameNo ?? 0, width, height);
    if (this.glider.visible) {
      this.glider.position.copy(p);
      this.glider.scale.setScalar(Math.max(1, (camDist * GLIDER_SCREEN * this.o.gliderSize) / GLIDER_SPAN));
      const hx = lerpAt(m.hx, fi);
      const hz = lerpAt(m.hz, fi);
      // yaw turns +Z (model forward) into the direction of travel, roll banks into the turn,
      // a positive x rotation tips the nose down
      const { roll, pitch } = this.attitude(fi, video);
      this.glider.rotation.set(-pitch, Math.atan2(hx, hz), this.drawnBank(roll));
    }
    const g = lerpAt(m.ground, fi) * ex;
    (this.dropLine.geometry as THREE.BufferGeometry).setFromPoints([p, new THREE.Vector3(p.x, g, p.z)]);
    this.dropLine.visible = this.glider.visible;

    const tNow = lerpAt(m.res.timeline.t, fi);
    // fading track: the whole route comes back for the closing overview
    this.fade.uNow.value = (tNow - m.res.timeline.t[0]) / 1000;
    this.fade.uFade.value = this.o.fadeMin > 0 && !all ? this.o.fadeMin * 60 : 1e9;
    this.ghost.visible = !(this.o.fadeMin > 0 && fr.phase === 'play');
    this.updateSun(fr, tNow, p, g, camDist);
    this.updateCompanions(fr, tNow, width, height, camDist);

    for (const cl of this.clouds) {
      cl.group.visible = all || fi >= cl.start;
      if (!cl.group.visible) continue;
      // the cloud builds up while the pilot climbs in the thermal
      const grow = all ? 1 : Math.min(1, Math.max(0, (fi - cl.start) / Math.max(1, cl.end - cl.start)));
      cl.group.scale.setScalar(0.35 + 0.65 * grow);
      // fade out when the camera comes close, so it never flies blind through a cloud
      const d = this.camera.position.distanceTo(cl.center);
      const a = Math.min(1, Math.max(0, (d - cl.R * 1.2) / (cl.R * 2)));
      const inA = all ? 1 : this.appear(cl.start, fi, 2.5, video);
      for (const mat of cl.mats) mat.opacity = 0.92 * a * inA;
      cl.group.visible = a * inA > 0.01;
    }
    for (const tl of this.triggerLabels) {
      const h = this.camera.position.distanceTo(tl.getWorldPosition(new THREE.Vector3())) * 0.035;
      tl.scale.set(h * tl.userData.aspect, h, 1);
    }

    for (const th of this.thermalObjs) {
      // already stands, faint, while the glider approaches (1.5 s of video before the first turn);
      // at the first turn the glow runs up the whole tube within 0.8 s
      const a = all ? 1 : this.appear(th.start, fi, 0.4, video, 1.5);
      th.group.visible = a > 0.001;
      if (th.group.visible) {
        fadeGroup(th.group, a);
        let grow = 1;
        if (!all && fi < th.end) grow = this.appear(th.start, fi, 0.8, video) * 1.08;
        th.funnel.uniforms.uGrow.value = grow;
      }
      const d = this.camera.position.distanceTo(th.label.position);
      const h = d * 0.045;
      th.label.scale.set(h * th.label.userData.aspect, h, 1);
    }

    if (this.particles && video) this.particles.update(video.frameNo, video.plan, fr.phase === 'play' && this.o.layers.particles);

    for (const poi of this.poiObjs) {
      const d = this.camera.position.distanceTo(poi.top);
      const h = d * 0.055;
      poi.label.scale.set(h * poi.label.userData.aspect, h, 1);
      // fade out far away so the horizon does not fill with captions
      const fade = Math.max(0, Math.min(1, (this.ext * 1.1 - d) / (this.ext * 0.4)));
      (poi.label.material as THREE.SpriteMaterial).opacity = fade;
      (poi.stick.material as THREE.LineBasicMaterial).opacity = 0.85 * fade;
      poi.label.visible = poi.stick.visible = fade > 0.02;
    }

    for (const gl of this.glideLabels) {
      const a = all ? 1 : this.appear(gl.end, fi, 0.8, video);
      gl.label.visible = a > 0.001;
      (gl.label.material as THREE.SpriteMaterial).opacity = a;
      const h = this.camera.position.distanceTo(gl.label.position) * 0.04;
      gl.label.scale.set(h * gl.label.userData.aspect, h, 1);
    }

    const t = m.res.timeline.t[Math.round(fi)];
    const w = this.o.layers.wind ? windAt(m, t) : null;
    const wantWind = !!w && fr.phase === 'play' && !m.isHike[Math.round(fi)];
    const wf = this.windFade;
    if (video && Math.abs(video.frameNo - wf.frame) <= 2) {
      wf.a += ((wantWind ? 1 : 0) - wf.a) * (1 - Math.exp(-Math.abs(video.frameNo - wf.frame) / (0.45 * video.plan.fps)));
    } else wf.a = wantWind ? 1 : 0;
    wf.frame = video?.frameNo ?? wf.frame;
    for (const mat of [this.windArrow.line.material, this.windArrow.cone.material] as THREE.Material[]) mat.opacity = this.o.windOpacity * wf.a;
    if (wantWind && w) {
      const toRad = ((w.fromDeg + 180) % 360) * (Math.PI / 180);
      const dir = new THREE.Vector3(Math.sin(toRad), 0, -Math.cos(toRad));
      const len = camDist * 0.04 * Math.min(3, 0.6 + w.speedKmh / 10);
      this.windArrow.position.copy(p).add(new THREE.Vector3(0, camDist * 0.05, 0)).addScaledVector(dir, -len / 2);
      this.windArrow.setDirection(dir);
      this.windArrow.setLength(len, len * 0.35, len * 0.22);
      this.windArrow.visible = true;
    } else this.windArrow.visible = wf.a > 0.02; // keeps its last place while it fades out
  }

  /**
   * 0..1 fade-in for something that appears when the timeline reaches index idx, over `secs` of video,
   * starting `leadS` seconds of video earlier.
   * Without video frames (single stills) it simply switches.
   */
  private appear(idx: number, fi: number, secs: number, video?: { frameNo: number; plan: Plan }, leadS = 0): number {
    if (!video) return fi >= idx ? 1 : 0;
    if (fi < idx && leadS <= 0) return 0;
    const { plan, frameNo } = video;
    const c = this.frameCache;
    if (c.plan !== plan) {
      c.plan = plan;
      c.map.clear();
    }
    let f = c.map.get(idx);
    if (f == null) {
      const fr = plan.frames;
      let lo = 0, hi = fr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fr[mid].phase === 'intro' || fr[mid].fi < idx) lo = mid + 1;
        else hi = mid;
      }
      f = lo;
      c.map.set(idx, f);
    }
    return ease((frameNo - f + leadS * plan.fps) / (secs * plan.fps));
  }

  /**
   * Light from the sun position at the current flight time (or the what-if time): direction,
   * strength and colour, sky tint, and a shadow frustum that covers the glider and its shadow on the ground.
   */
  private updateSun(fr: Frame, tNow: number, p: THREE.Vector3, groundY: number, camDist: number) {
    const T = this.m.terrain;
    const sun = sunPosition(sunTime(tNow, this.o.sun), T.frame.lat0, T.frame.lon0);
    const el = sun.elevation;
    // light never from below the horizon; a low sun gives long shadows, but not endless ones
    const v = new THREE.Vector3(...sunVector(sun.azimuth, Math.max(4, el)));
    const day = Math.min(1, Math.max(0, (el + 2) / 14));
    const warm = Math.min(1, Math.max(0, 1 - (el - 2) / 18));
    this.sunLight.intensity = 0.25 + 2.3 * day;
    this.sunLight.color.set('#fff6e8').lerp(new THREE.Color('#ffb070'), warm * day);
    this.hemi.intensity = 0.35 + 0.6 * day;
    const sky = this.sky.night.clone().lerp(this.sky.dusk, Math.min(1, day * 1.6)).lerp(this.sky.day, 1 - warm);
    (this.scene.background as THREE.Color).copy(sky);
    this.scene.fog!.color.copy(sky);

    let center: THREE.Vector3;
    let half: number;
    if (fr.phase === 'play') {
      // ground point of the glider's shadow: from the glider along the sun ray down to its ground height
      const s = p.clone().addScaledVector(v, -(p.y - groundY) / v.y);
      center = p.clone().add(s).multiplyScalar(0.5);
      half = Math.max(camDist * 1.8, p.distanceTo(s) / 2 + camDist * 0.6);
    } else {
      center = new THREE.Vector3(...fr.target);
      half = this.ext * 0.4;
    }
    const D = 40000 + half * 2;
    this.sunLight.target.position.copy(center);
    this.sunLight.position.copy(center).addScaledVector(v, D);
    if (this.sunLight.castShadow) {
      const cam = this.sunLight.shadow.camera;
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
      cam.near = D * 0.3;
      cam.far = D * 1.8;
      cam.updateProjectionMatrix();
      this.sunLight.shadow.normalBias = (2 * half) / 4096 * 1.5;
    }
  }

  /** Tracks and gliders of the further pilots at the main flight's current time */
  private updateCompanions(fr: Frame, tNow: number, width: number, height: number, camDist: number) {
    const ex = this.o.exaggeration;
    for (const k of this.comps) {
      const cm = k.c.model;
      k.mat.resolution.set(width, height);
      k.mat.linewidth = Math.max(2, height / 360);
      const cfi = fr.phase === 'intro' ? null : companionFi(k.c, tNow);
      let shown = 0;
      if (fr.phase === 'outro' || (cfi == null && fr.phase === 'play' && tNow + k.c.offsetMs > cm.res.timeline.t[cm.n - 1])) shown = k.idx.length - 1;
      else if (cfi != null) {
        let lo = 0, hi = k.idx.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (k.idx[mid] <= cfi) lo = mid;
          else hi = mid - 1;
        }
        shown = lo;
      }
      (k.line.geometry as LineGeometry).instanceCount = shown;
      const flying = cfi != null && fr.phase === 'play' && !cm.isHike[Math.round(cfi)];
      k.glider.visible = k.tag.visible = k.drop.visible = flying;
      if (!flying) continue;
      const p = new THREE.Vector3(lerpAt(cm.x, cfi), lerpAt(cm.alt, cfi) * ex, lerpAt(cm.z, cfi));
      const d = this.camera.position.distanceTo(p);
      // a pilot right next to the chase camera would cover the whole picture
      if (d < camDist * 0.35) {
        k.glider.visible = k.tag.visible = false;
        continue;
      }
      k.glider.position.copy(p);
      k.glider.scale.setScalar(Math.max(1, (d * GLIDER_SCREEN * this.o.gliderSize) / GLIDER_SPAN));
      k.glider.rotation.set(-lerpAt(cm.pitch, cfi), Math.atan2(lerpAt(cm.hx, cfi), lerpAt(cm.hz, cfi)), this.drawnBank(lerpAt(cm.bank, cfi)));
      const h = d * 0.03;
      k.tag.position.set(p.x, p.y + d * 0.035, p.z);
      k.tag.scale.set(h * k.tag.userData.aspect, h, 1);
      (k.drop.geometry as THREE.BufferGeometry).setFromPoints([p, new THREE.Vector3(p.x, lerpAt(cm.ground, cfi) * ex, p.z)]);
    }
  }

  /** Glow at the pilot plus a fading trail over the last ~4 % of the flight (at least 2 min) */
  private updateFirefly(fr: Frame, p: THREE.Vector3, camDist: number, on: boolean, frameNo: number, width: number, height: number) {
    const show = on && fr.phase === 'play';
    this.firefly.visible = this.trailCore.visible = this.trailHalo.visible = show;
    if (!show) return;
    const m = this.m;
    const ex = this.o.exaggeration;
    // gentle flicker like a firefly
    const flicker = 1 + 0.12 * Math.sin(frameNo * 0.55) + 0.06 * Math.sin(frameNo * 1.7);
    this.firefly.position.copy(p);
    // together with the glider the glow stays small, a big one would outshine the wing
    this.firefly.scale.setScalar(camDist * (this.o.pilotStyle === 'both' ? 0.018 : 0.045) * flicker);
    const t = m.res.timeline.t;
    const fi = fr.fi;
    const now = lerpAt(t, fi);
    const span = Math.max(120_000, (t[m.n - 1] - t[0]) * 0.04);
    const step = Math.max(1, Math.floor(m.n / 6000));
    const sample: number[] = [];
    for (let k = Math.floor(fi); k >= 0 && now - t[k] < span; k -= step) sample.push(k);
    sample.reverse();
    const warm = new THREE.Color('#fff1c1');
    const pts: number[] = [];
    const cols: number[] = [];
    for (const k of sample) {
      // additive blending: darker = more transparent, so the tail fades towards the oldest point
      const a = (1 - (now - t[k]) / span) ** 2;
      pts.push(m.x[k], m.alt[k] * ex, m.z[k]);
      cols.push(warm.r * a, warm.g * a, warm.b * a);
    }
    pts.push(p.x, p.y, p.z);
    cols.push(warm.r, warm.g, warm.b);
    if (pts.length < 6) {
      this.trailCore.visible = this.trailHalo.visible = false;
      return;
    }
    for (const line of [this.trailCore, this.trailHalo]) {
      const g = new LineGeometry();
      g.setPositions(pts);
      g.setColors(cols);
      line.geometry.dispose();
      line.geometry = g;
    }
    this.trailCoreMat.resolution.set(width, height);
    this.trailHaloMat.resolution.set(width, height);
    this.trailCoreMat.linewidth = Math.max(2, height / 360);
    this.trailHaloMat.linewidth = Math.max(6, height / 110);
  }

  /** Bank as drawn: measured bank times the chosen factor, kept below 70° */
  private drawnBank(roll: number) {
    const k = this.o.bankScale ?? 1;
    return Math.max(-1.22, Math.min(1.22, roll * k));
  }

  /** Bank and pitch from the track, low-passed over video frames, plus a damped shake after each thermal exit */
  private attitude(fi: number, video?: { frameNo: number; plan: Plan }): { roll: number; pitch: number } {
    const m = this.m;
    const roll = lerpAt(m.bank, fi);
    const pitch = lerpAt(m.pitch, fi);
    if (!video) return { roll, pitch };
    const { frameNo, plan } = video;
    const a = this.att;
    // sequential frames: follow with inertia; after a jump (scrubbing) start from the target
    if (Math.abs(frameNo - a.frame) <= 2) {
      const k = 1 - Math.exp(-Math.abs(frameNo - a.frame) / 4);
      a.roll += (roll - a.roll) * k;
      a.pitch += (pitch - a.pitch) * k;
    } else {
      a.roll = roll;
      a.pitch = pitch;
    }
    a.frame = frameNo;
    let dRoll = 0;
    let dPitch = 0;
    // flying into rising air (strong thermal, straight climb): the wing rocks left and right
    for (const e of this.particles?.entries(plan) ?? []) {
      const d = (frameNo - e.frame) / plan.fps;
      if (d < 0 || d > 4) continue;
      const amp = Math.min(0.35, 0.12 + 0.06 * e.strength) * Math.exp(-d / 1.3);
      dRoll += amp * Math.sin(2 * Math.PI * 1.1 * d);
      dPitch += amp * 0.25 * Math.sin(2 * Math.PI * 0.8 * d + 1.2);
    }
    plan.thermalExit.forEach((ef, j) => {
      if (ef < 0) return;
      const d = (frameNo - ef) / plan.fps; // seconds of video since the exit
      if (d < 0 || d > 3.5) return;
      const amp = m.thermals[j].exitWobble * Math.exp(-d / 1.1);
      dRoll += amp * Math.sin(2 * Math.PI * 1.4 * d);
      // surge: nose dives first, then pitch oscillation
      dPitch += amp * 0.8 * Math.sin(2 * Math.PI * 1.0 * d + 0.8) - amp * 0.7 * Math.exp(-d / 0.4);
    });
    return { roll: a.roll + dRoll, pitch: a.pitch + dPitch };
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
