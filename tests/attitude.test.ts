import { describe, expect, it } from 'vitest';
import { attitude } from '../src/three/model';

/** Circle of radius 50 m at 10 m/s in the local frame (x east, z south), clockwise or counter-clockwise seen from above */
function circle(clockwise: boolean) {
  const n = 120;
  const t = new Float64Array(n);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const speed = new Float64Array(n).fill(36);
  for (let i = 0; i < n; i++) {
    const a = (i / 31.4) * 2 * Math.PI * (clockwise ? 1 : -1); // one circle ≈ 31 s
    t[i] = i * 1000;
    // north = -z: clockwise from above means N → E → S → W
    x[i] = 50 * Math.sin(a);
    z[i] = -50 * Math.cos(a);
  }
  return attitude(t, x, z, speed);
}

describe('Schräglage aus der Kurve', () => {
  it('Rechtskurve → positive Schräglage, ≈ atan(v²/(g·r))', () => {
    const { bank } = circle(true);
    const expected = Math.atan(100 / (9.81 * 50));
    expect(bank[60]).toBeGreaterThan(0);
    expect(bank[60]).toBeCloseTo(expected, 1);
  });
  it('Linkskurve → negative Schräglage', () => {
    expect(circle(false).bank[60]).toBeLessThan(0);
  });
  it('Kurs zeigt in Flugrichtung', () => {
    const { hx, hz } = circle(true);
    // at i = 0 the pilot is due north of the centre flying clockwise → heading east
    expect(hx[2]).toBeGreaterThan(0.8);
    expect(Math.abs(hz[2])).toBeLessThan(0.6);
  });
});

describe('Ausrichtung des Schirm-Modells (wie in scene.ts)', () => {
  it('Rechtskurve Richtung Osten: rechte Flügelspitze liegt im Süden und tiefer', async () => {
    const THREE = await import('three');
    const o = new THREE.Object3D();
    o.rotation.order = 'YXZ';
    o.rotation.set(0, Math.atan2(1, 0), 0.4); // heading east (+x), bank 0.4 rad right
    o.updateMatrixWorld();
    // model faces +Z, so its right wing tip is at -X
    const right = new THREE.Vector3(-5, 0, 0).applyMatrix4(o.matrixWorld);
    const nose = new THREE.Vector3(0, 0, 1).applyMatrix4(o.matrixWorld);
    expect(nose.x).toBeGreaterThan(0.9); // flying east
    expect(right.z).toBeGreaterThan(0); // right of east is south (+z)
    expect(right.y).toBeLessThan(0); // banked into the turn
  });
});
