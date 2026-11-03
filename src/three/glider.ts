import * as THREE from 'three';
import { GLIDER_PRESETS, patternAt, type GliderDesign } from './gliderDesigns';

/**
 * Procedural paraglider: arched canopy with cells, lines, risers and a pilot in a pod harness.
 * Real-world size in metres (span ≈ 11 m, pilot at the origin), facing +Z, up +Y.
 */
const ARC_R = 6.2; // canopy arc radius
const ARC_HALF = 62 * (Math.PI / 180); // half opening angle → projected span ≈ 11 m
const LINE_H = 7.4; // pilot → top of canopy
/** centre chord at aspect ratio 5.3; higher aspect ratios get a narrower chord for the same span */
const CHORD = 2.7;
const REF_ASPECT = 5.3;

/** Point on the canopy: s ∈ [-1, 1] across the span, c ∈ [0, 1] leading → trailing edge, side ±1 top/bottom */
function canopyPoint(s: number, c: number, side: 1 | -1, centreChord: number = CHORD): THREE.Vector3 {
  const a = s * ARC_HALF;
  const taper = 1 - 0.38 * s * s; // tips have less chord
  const chord = centreChord * taper;
  // thin airfoil: thickness peaks at 25 % chord
  const t = 0.16 * chord * Math.sqrt(Math.max(0, c)) * (1 - c) * 1.6;
  const off = side > 0 ? t : -t * 0.25;
  const r = ARC_R + off;
  const center = LINE_H - ARC_R;
  return new THREE.Vector3(Math.sin(a) * r, center + Math.cos(a) * r, chord * (0.35 - c) - 0.35 * s * s);
}

export function buildGlider(design: GliderDesign = GLIDER_PRESETS.classic): THREE.Group {
  const g = new THREE.Group();
  const CELLS = Math.max(12, Math.round(design.cells));
  const chordC = CHORD * (REF_ASPECT / Math.max(3, design.aspect));

  // --- canopy: top and bottom skin with cell stripes via vertex colours
  const SPAN_N = CELLS * 2;
  const cA = new THREE.Color(design.a);
  const cB = new THREE.Color(design.b);
  const cC = new THREE.Color(design.c ?? design.b);
  const cD = new THREE.Color(design.d ?? design.c ?? design.b);
  const cLE = new THREE.Color(design.leadingEdge);
  const cBottom = new THREE.Color(design.bottom);
  const CH_N = 10;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const side of [1, -1] as const) {
    const base = pos.length / 3;
    for (let i = 0; i <= SPAN_N; i++) {
      const s = -1 + (2 * i) / SPAN_N;
      const cell = Math.min(CELLS - 1, Math.floor(((s + 1) / 2) * CELLS));
      for (let j = 0; j <= CH_N; j++) {
        const c = j / CH_N;
        const p = canopyPoint(s, c, side, chordC);
        pos.push(p.x, p.y, p.z);
        const slot = patternAt(design, s, c, cell);
        const k = side < 0 ? cBottom : c < 0.06 ? cLE : slot === 'a' ? cA : slot === 'b' ? cB : slot === 'c' ? cC : cD;
        // darken rib lines slightly so the cells read
        const rib = (i % 2 === 0 ? 0.92 : 1) * (side > 0 ? 1 : 0.85);
        col.push(k.r * rib, k.g * rib, k.b * rib);
      }
    }
    for (let i = 0; i < SPAN_N; i++) {
      for (let j = 0; j < CH_N; j++) {
        const a = base + i * (CH_N + 1) + j;
        const b = a + CH_N + 1;
        if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const canopy = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0, side: THREE.DoubleSide }),
  );
  g.add(canopy);

  // --- lines: from the lower surface (A/B/C rows) to the two risers
  const riserL = new THREE.Vector3(0.24, 1.05, 0.12);
  const riserR = new THREE.Vector3(-0.24, 1.05, 0.12);
  const lines: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const s = -1 + (2 * i) / 12;
    const riser = s >= 0 ? riserL : riserR;
    for (const c of [0.1, 0.4, 0.75, 0.98]) {
      const p = canopyPoint(s * 0.97, c, -1, chordC);
      // cascade: lines join half way, like real gallery lines
      const mid = p.clone().lerp(riser, 0.55);
      mid.x *= 1.05;
      lines.push(p.x, p.y, p.z, mid.x, mid.y, mid.z, mid.x, mid.y, mid.z, riser.x, riser.y, riser.z);
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  g.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: '#d8d8d8', transparent: true, opacity: 0.45 })));

  // risers down to the carabiners
  const riserGeo = new THREE.BufferGeometry().setFromPoints([
    riserL, new THREE.Vector3(0.2, 0.35, 0.05),
    riserR, new THREE.Vector3(-0.2, 0.35, 0.05),
  ]);
  g.add(new THREE.LineSegments(riserGeo, new THREE.LineBasicMaterial({ color: '#111' })));

  // --- pilot in a pod harness, reclined, legs forward
  const harnessMat = new THREE.MeshStandardMaterial({ color: design.harness, roughness: 0.8 });
  const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.15, 6, 12), harnessMat);
  pod.rotation.x = Math.PI / 2 - 0.35; // lying back ~20°
  pod.position.set(0, 0.05, 0.42);
  pod.scale.set(1.15, 1, 0.95);
  g.add(pod);
  // seat back / airbag fairing behind the pilot
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), harnessMat);
  back.scale.set(1, 1.2, 1.4);
  back.position.set(0, 0.1, -0.35);
  g.add(back);
  // torso
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 0.42, 6, 10),
    new THREE.MeshStandardMaterial({ color: '#3d5a80', roughness: 0.8 }),
  );
  torso.rotation.x = -0.35;
  torso.position.set(0, 0.45, -0.12);
  g.add(torso);
  // helmet
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: design.helmet, roughness: 0.4 }));
  helmet.position.set(0, 0.85, -0.05);
  g.add(helmet);
  // arms up to the brakes
  const armMat = new THREE.LineBasicMaterial({ color: '#3d5a80' });
  g.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.2, 0.6, -0.05), new THREE.Vector3(0.24, 1.0, 0.1),
        new THREE.Vector3(-0.2, 0.6, -0.05), new THREE.Vector3(-0.24, 1.0, 0.1),
      ]),
      armMat,
    ),
  );
  return g;
}

/** Projected span of the model in metres, for scaling */
export const GLIDER_SPAN = 2 * Math.sin(ARC_HALF) * ARC_R;
