import * as THREE from 'three';
import { Nation, ShipClass } from '../data/ships';
import { DEG, lerp } from '../math';
import { deckHeight, halfBeam, hullProfile } from '../sim/hull';
import { BOX, CYL, CYL6, Kit, SPH, TURRET, vertexColourMaterial } from './kit';

export const PALETTE: Record<Nation, { hull: number; sup: number; deck: number; dark: number; boot: number; mast: number; win: number; boat: number; flight: number }> = {
  usn: { hull: 0x5f6a75, sup: 0x6a7580, deck: 0x4f5a66, dark: 0x262b30, boot: 0x1d1d1f, mast: 0x9aa3aa, win: 0x171b1f, boat: 0xb9b8b0, flight: 0x505b66 },
  ijn: { hull: 0x7a8187, sup: 0x868d93, deck: 0x7a553c, dark: 0x26292d, boot: 0x44292a, mast: 0x737a80, win: 0x171b1f, boat: 0xb0aea4, flight: 0x8f7352 },
};

function hullGeometry(c: ShipClass, p: typeof PALETTE['usn']): THREE.BufferGeometry {
  const N = 40, L = c.L, B = c.B / 2, fine = c.fine ?? 0.6, tum = c.tumble ?? 1;
  const rows: { x: number; r: [number, number][] }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = -1 + 2 * i / N, dy = deckHeight(c, t);
    rows.push({ x: t * L / 2, r: [[-0.9, hullProfile(t * 1.035, fine) * B * (c.bulge ? 0.97 : 0.94)], [1.1, hullProfile(t * 1.025, fine) * B], [c.fb * 0.5, hullProfile(t * 1.012, fine) * B * (c.bulge ? 0.94 : 1)], [dy, hullProfile(t, fine) * B * tum]] });
  }
  const P: number[] = [], Co: number[] = [];
  const cols = [new THREE.Color(p.boot), new THREE.Color(p.hull), new THREE.Color(p.hull)], cd = new THREE.Color(p.deck);
  const tri = (a: number[], b: number[], c2: number[], col: THREE.Color) => { P.push(...a, ...b, ...c2); for (let k = 0; k < 3; k++) Co.push(col.r, col.g, col.b); };
  const quad = (a: number[], b: number[], c2: number[], d: number[], col: THREE.Color) => { tri(a, b, c2, col); tri(a, c2, d, col); };
  for (let i = 0; i < N; i++) {
    const A = rows[i], Bq = rows[i + 1];
    for (const sd of [-1, 1]) for (let k = 0; k < 3; k++)
      quad([A.x, A.r[k][0], sd * A.r[k][1]], [Bq.x, Bq.r[k][0], sd * Bq.r[k][1]], [Bq.x, Bq.r[k + 1][0], sd * Bq.r[k + 1][1]], [A.x, A.r[k + 1][0], sd * A.r[k + 1][1]], cols[k]);
    const a = A.r[3], b = Bq.r[3];
    quad([A.x, a[0], -a[1]], [Bq.x, b[0], -b[1]], [Bq.x, b[0], b[1]], [A.x, a[0], a[1]], cd);
  }
  const s0 = rows[0];
  for (let k = 0; k < 3; k++) quad([s0.x, s0.r[k][0], -s0.r[k][1]], [s0.x, s0.r[k][0], s0.r[k][1]], [s0.x, s0.r[k + 1][0], s0.r[k + 1][1]], [s0.x, s0.r[k + 1][0], -s0.r[k + 1][1]], cols[1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Co, 3));
  g.computeVertexNormals();
  return g;
}

function floatplane(): THREE.BufferGeometry {
  const k = new Kit(), c = 0x9ea6ac, L = 10.2, S = 11.6;
  k.add(CYL, c, [-0.3, 0, 0], [0, 0, -Math.PI / 2], [0.66, L * 0.82, 0.66]);
  k.add(BOX, c, [L * 0.1, -0.25, 0], 0, [S * 0.15, 0.22, S]);
  k.add(BOX, c, [-L * 0.42, 0.12, 0], 0, [1.3, 0.14, S * 0.36]);
  k.add(BOX, c, [-L * 0.44, 0.75, 0], 0, [1.4, 1.5, 0.16]);
  k.add(BOX, c, [0.4, -1.7, 0], 0, [7, 0.8, 0.9]);
  return k.build();
}

export interface ShipModel {
  root: THREE.Group;
  inner: THREE.Group;
  turrets: THREE.Group[];
  fireAnchors: THREE.Object3D;
}

export function buildShipModel(c: ShipClass): ShipModel {
  const p = PALETTE[c.nation];
  const root = new THREE.Group(), inner = new THREE.Group();
  root.add(inner);
  const k = new Kit(), lines: number[] = [];
  const dAt = (x: number) => deckHeight(c, x / (c.L / 2));
  k.add(hullGeometry(c, p), null);
  for (const sd of [-1, 1]) k.add(BOX, p.dark, [c.L * 0.44, dAt(c.L * 0.44) - 1.4, sd * halfBeam(c, c.L * 0.44) * 0.98], 0, [1.6, 1.2, 0.3]);
  for (let i = 0; i < 6; i++) { const x = lerp(-c.L * 0.42, c.L * 0.4, i / 5); k.add(BOX, p.dark, [x, dAt(x) + 0.15, halfBeam(c, x) * 0.6 * (i % 2 ? 1 : -1)], 0, [2.2, 0.3, 1.6]); }
  const fd = c.flightDeck;
  if (fd) {
    // hangar sides, the open gallery under the deck edge, then the flight deck itself
    const y0 = dAt(fd.x), top = y0 + fd.y;
    k.add(BOX, p.sup, [fd.x, y0 + (fd.y - 0.6) / 2, 0], 0, [fd.l * 0.9, fd.y - 0.6, c.B * 0.86]);
    k.add(BOX, p.dark, [fd.x, top - 1.7, 0], 0, [fd.l * 0.92, 1.3, c.B * 0.9]);
    k.add(BOX, p.flight, [fd.x, top - 0.3, 0], 0, [fd.l, 0.6, fd.w]);
    for (const ex of [0.3, 0, -0.32]) k.add(BOX, p.dark, [fd.x + fd.l * ex, top + 0.02, 0], 0, [12, 0.05, 12]);
    k.add(BOX, 0xd8d8d0, [fd.x, top + 0.04, 0], 0, [fd.l * 0.94, 0.04, 0.5]);
    for (const sd of [-1, 1]) k.add(BOX, 0xd8d8d0, [fd.x - fd.l * 0.47, top + 0.04, sd * fd.w * 0.3], 0, [3, 0.04, 0.4]);
    if (c.nation === 'ijn') { k.add(BOX, 0xe8e6de, [fd.x + fd.l * 0.42, top + 0.05, 0], 0, [10, 0.04, 10]); k.add(CYL, 0xb8302a, [fd.x + fd.l * 0.42, top + 0.08, 0], 0, [3.5, 0.04, 3.5]); }
  }
  for (const b of c.boxes) {
    const y0 = dAt(b.x) + b.y0, h = b.y1 - b.y0;
    k.add(BOX, b.c ?? p.sup, [b.x, y0 + h / 2, b.z ?? 0], 0, [b.l, h, b.w]);
    if (b.win) k.add(BOX, p.win, [b.x, y0 + h - 0.9, b.z ?? 0], 0, [b.l + 0.25, 0.75, b.w + 0.25]);
    if (b.wing) k.add(BOX, p.sup, [b.x + b.l * 0.2, y0 + h - 0.25, b.z ?? 0], 0, [b.l * 0.3, 0.45, b.w + b.wing * 2]);
    if (h > 3) k.add(BOX, p.sup, [b.x, y0 + h + 0.1, b.z ?? 0], 0, [b.l * 0.96, 0.25, b.w * 0.96]);
  }
  // fire-control director on top of the bridge
  if (c.nation === 'usn') {
    const top = c.boxes.reduce((a, b) => (b.x > 0 && b.y1 > a.y1 ? b : a), c.boxes[0]);
    const y = dAt(top.x) + top.y1, d = Math.min(1, c.B / 24, top.w / 6), z = top.z ?? 0; // destroyers and islands carry a smaller director
    k.add(BOX, p.sup, [top.x, y + 1.6 * d, z], 0, [5 * d, 3.2 * d, 5 * d]);
    k.add(BOX, p.dark, [top.x - 0.5 * d, y + 2.6 * d, z], 0, [1.2 * d, 0.8 * d, 9 * d]);
    k.add(BOX, p.mast, [top.x, y + 3.8 * d, z], 0, [1.4 * d, 1.6 * d, 4.5 * d]);
  }
  for (const f of c.funnels) {
    const y0 = dAt(f.x) + (f.y0 ?? 1.5), rk = (f.rake ?? 0) * DEG, fz = f.z ?? 0;
    const at = (u: number): [number, number] => [f.x - Math.sin(rk) * f.h * u, y0 + Math.cos(rk) * f.h * u];
    let [x1, y1] = at(0.5); k.add(CYL, p.sup, [x1, y1, fz], [0, 0, rk], [f.r, f.h, f.r * 0.74]);
    [x1, y1] = at(1); k.add(CYL, p.dark, [x1, y1 - 0.5, fz], [0, 0, rk], [f.r * 1.04, 1.2, f.r * 0.77]); k.add(CYL, 0x111111, [x1, y1 + 0.12, fz], [0, 0, rk], [f.r * 0.8, 0.05, f.r * 0.56]);
    if (f.plat) { [x1, y1] = at(0.62); k.add(CYL, p.sup, [x1, y1, fz], [0, 0, rk], [f.r + 1.5, 0.35, f.r * 0.74 + 1.5]); for (const sd of [-1, 1]) k.add(CYL6, p.dark, [x1, y1 + 0.8, fz + sd * (f.r * 0.74 + 0.9)], 0, [0.55, 1.1, 0.55]); }
    [x1, y1] = at(0.5); k.add(CYL6, p.sup, [x1 - f.r - 0.5, y1, fz + 0.8], [0, 0, rk], [0.32, f.h * 0.95, 0.32]);
  }
  for (const m0 of c.masts) {
    const m = m0, y0 = dAt(m.x) + (m.y0 ?? 0), top = y0 + m.h;
    const mk = new Kit();
    if (m.k === 'pole') { mk.add(CYL6, p.mast, [m.x, y0 + m.h / 2, 0], 0, [0.35, m.h, 0.35]); mk.add(BOX, p.mast, [m.x, y0 + m.h * 0.72, 0], 0, [0.3, 0.3, m.h * 0.35]); mk.add(BOX, p.mast, [m.x, y0 + m.h * 0.55, 0], 0, [2, 0.3, 2]); }
    else if (m.k === 'tower') {
      mk.add(CYL6, p.mast, [m.x, y0 + m.h * 0.45, 0], 0, [1.2, m.h * 0.9, 1.2]);
      for (const f of [0.45, 0.65, 0.8]) mk.add(BOX, p.mast, [m.x, y0 + m.h * f, 0], 0, [3.5 - f * 2, 0.35, 5 - f * 2]);
      mk.add(BOX, p.mast, [m.x, y0 + m.h * 0.88, 0], 0, [0.3, 0.3, 9]);
      mk.add(BOX, p.dark, [m.x + 0.6, y0 + m.h * 0.93, 0], 0, [0.3, 1.8, 3.2]); // radar antenna
      mk.add(CYL6, p.mast, [m.x, top + 2, 0], 0, [0.22, 5, 0.22]);
    } else if (m.k === 'tripod') {
      mk.rod([m.x, y0, 0], [m.x, top, 0], 0.65, p.mast).rod([m.x - 8, y0, -3.6], [m.x, top - 3, 0], 0.45, p.mast).rod([m.x - 8, y0, 3.6], [m.x, top - 3, 0], 0.45, p.mast);
      mk.add(BOX, p.mast, [m.x, top - 1.2, 0], 0, [7, 0.4, 7]); mk.add(BOX, p.mast, [m.x, top + 1.4, 0], 0, [5, 2.8, 5]); mk.add(BOX, p.win, [m.x, top + 2.1, 0], 0, [5.2, 0.7, 5.2]); mk.add(CYL6, p.mast, [m.x, top + 5, 0], 0, [0.25, 5, 0.25]);
    } else if (m.k === 'cage') {
      const N = 18, r0 = 4.4, r1 = 2.5, yA = y0, yB = top - 2.5;
      for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI; for (const sg of [-1, 1]) { const a2 = a + sg * 1.15; lines.push(m.x + Math.cos(a) * r0, yA, Math.sin(a) * r0, m.x + Math.cos(a2) * r1, yB, Math.sin(a2) * r1); } }
      mk.add(CYL, p.mast, [m.x, yB + 2.6, 0], 0, [3.2, 3.4, 3.2]);
    } else {
      const lv = 8;
      mk.add(CYL6, p.sup, [m.x, y0 + m.h * 0.44, 0], 0, [2.2, m.h * 0.88, 2.2]);
      for (let i = 0; i < lv; i++) { const f = i / (lv - 1), y = y0 + f * m.h * 0.9, l = lerp(11, 4, f), w = lerp(13, 5, f); mk.add(BOX, p.sup, [m.x - f * 1.5, y + 0.5, 0], 0, [l, 1, w]); if (i % 2 || i > lv - 3) mk.add(BOX, p.win, [m.x - f * 1.5, y + 1.3, 0], 0, [l * 0.82, 0.7, w * 0.82]); }
      mk.add(BOX, p.dark, [m.x - 1, top + 0.5, 0], 0, [1.6, 0.9, 11]); mk.add(CYL6, p.mast, [m.x - 1.5, top + 5, 0], 0, [0.28, 8, 0.28]);
    }
    k.add(mk.build(), null, [0, 0, m.z ?? 0]);
  }
  if (c.cas) { const { n, x0, x1, y } = c.cas; for (let i = 0; i < n; i++) { const x = lerp(x0, x1, i / (n - 1 || 1)); for (const sd of [-1, 1]) { const z = halfBeam(c, x) * sd, yy = dAt(x) + y; k.add(BOX, p.dark, [x, yy, z], 0, [2.8, 1.5, 0.4]); k.add(CYL6, p.dark, [x + 0.6, yy, z + sd * 2.2], [sd * Math.PI / 2, 0, 0], [0.2, 4.4, 0.2]); } } }
  for (const a of c.secondaries ?? []) for (const sd of [-1, 1]) {
    const y = dAt(a.x) + a.y;
    k.add(TURRET, p.sup, [a.x, y + 1.2, sd * a.z], 0, [5, 2.4, 4.2]);
    for (const dz of [-0.7, 0.7]) k.add(CYL6, p.dark, [a.x + 4.4, y + 1.4, sd * a.z + dz], [0, 0, -Math.PI / 2 + 0.12], [0.16, 5.5, 0.16]);
  }
  for (const bx of c.boats ?? []) for (const sd of [-1, 1]) { const y = dAt(bx) + 4.6; k.add(SPH, p.boat, [bx, y, sd * c.B * 0.27], 0, [5, 0.9, 1.4]); k.add(BOX, p.dark, [bx, y - 0.6, sd * c.B * 0.27], 0, [3, 0.5, 0.3]); }
  for (const cr of c.cranes ?? []) { const y = dAt(cr.x); k.add(CYL6, p.mast, [cr.x, y + 5, cr.z], 0, [0.55, 10, 0.55]); k.rod([cr.x, y + 3, cr.z], [cr.x + cr.dx, y + 11, cr.z + cr.dz], 0.32, p.mast); }
  const fp = floatplane();
  for (const cat of c.catapults ?? []) { const y = dAt(cat.x) + 0.8; k.add(BOX, p.dark, [cat.x, y, cat.z], [0, cat.r, 0], [18, 0.6, 1.1]); k.add(fp, null, [cat.x + 1, y + 2, cat.z], [0, cat.r, 0]); }

  const mesh = new THREE.Mesh(k.build(), vertexColourMaterial);
  mesh.castShadow = mesh.receiveShadow = true;
  inner.add(mesh);
  if (lines.length) {
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    inner.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: p.mast })));
  }
  const turrets = c.turrets.map(tu => {
    const sc = tu.s ?? 1, g = new THREE.Group(), dy = dAt(tu.x), bh = Math.max(0.5, tu.h - dy);
    const bk = new Kit(); bk.add(CYL, p.sup, [0, -bh / 2, 0], 0, [3.6 * sc, bh, 3.6 * sc]);
    const tk = new Kit(); tk.add(TURRET, p.sup, [0.4 * sc, 1.5 * sc, 0], 0, [9.4 * sc, 3 * sc, 8 * sc]); tk.add(BOX, p.dark, [-2.4 * sc, 2.4 * sc, 0], 0, [1.2 * sc, 0.8 * sc, (8 + 3 * sc) * sc]);
    const bl = c.gun.barrelM;
    for (let j = 0; j < tu.guns; j++) { const z = (j - (tu.guns - 1) / 2) * 2.35 * sc; tk.add(CYL6, p.dark, [3 * sc + bl / 2, 1.45 * sc, z], [0, 0, -Math.PI / 2], [0.26 * sc + 0.08, bl, 0.26 * sc + 0.08]); tk.add(CYL6, p.dark, [3 * sc + 0.9, 1.45 * sc, z], [0, 0, -Math.PI / 2], [0.6 * sc, 1.8, 0.6 * sc]); }
    const tm = new THREE.Mesh(tk.build(), vertexColourMaterial), bm = new THREE.Mesh(bk.build(), vertexColourMaterial);
    tm.castShadow = bm.castShadow = true;
    g.add(tm, bm);
    g.position.set(tu.x, tu.h, 0);
    g.rotation.y = tu.fwd ? 0 : Math.PI;
    inner.add(g);
    return g;
  });
  const fireAnchors = new THREE.Object3D();
  inner.add(fireAnchors);
  return { root, inner, turrets, fireAnchors };
}
