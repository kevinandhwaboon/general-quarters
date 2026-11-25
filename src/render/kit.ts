import * as THREE from 'three';

/** Shared unit geometries, scaled per part. */
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
export const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 7);
export const SPH = new THREE.SphereGeometry(1, 10, 6);

/** Turret house: box with a sloped face and slightly narrower roof. */
export const TURRET = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y > 0) { z *= 0.88; if (x > 0) x = 0.22; }
    if (x < 0) z *= 0.94;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
})();

type V3 = [number, number, number];
interface Part { geo: THREE.BufferGeometry; color: THREE.Color | null; m: THREE.Matrix4; }

/**
 * Collects many small parts and merges them into one vertex-coloured geometry,
 * so a ship is a handful of draw calls instead of hundreds.
 */
export class Kit {
  private parts: Part[] = [];

  add(geo: THREE.BufferGeometry, color: number | null, pos: V3 = [0, 0, 0], rot: V3 | 0 = 0, scl: V3 = [1, 1, 1]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0])));
    this.parts.push({ geo, color: color === null ? null : new THREE.Color(color), m: new THREE.Matrix4().compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...scl)) });
    return this;
  }

  /** A thin cylinder between two points. */
  rod(a: V3, b: V3, r: number, color: number) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const d = B.clone().sub(A), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.parts.push({ geo: CYL6, color: new THREE.Color(color), m: new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r)) });
    return this;
  }

  build(): THREE.BufferGeometry {
    const gs: [THREE.BufferGeometry, THREE.Color | null][] = [];
    let n = 0;
    for (const p of this.parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.applyMatrix4(p.m);
      if (!g.attributes.normal) g.computeVertexNormals();
      gs.push([g, p.color]);
      n += g.attributes.position.count;
    }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const [g, c] of gs) {
      const cnt = g.attributes.position.count, VC = g.attributes.color as THREE.BufferAttribute | undefined;
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      nor.set(g.attributes.normal.array as Float32Array, o * 3);
      for (let i = 0; i < cnt; i++) {
        const k = (o + i) * 3;
        if (c) { col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
        else if (VC) { col[k] = VC.getX(i); col[k + 1] = VC.getY(i); col[k + 2] = VC.getZ(i); }
      }
      o += cnt;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }
}

export const vertexColourMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
