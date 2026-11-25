import * as THREE from 'three';
import { SHIP_VIS_MAX } from '../config';
import { clamp, dir, lerp, rnd } from '../math';
import { Ship } from '../sim/ship';
import { SimEvent, World } from '../sim/world';
import { Effects, texGlow, texWater } from './effects';
import { buildShipModel, ShipModel } from './shipModel';

export const PITCH = 56 * Math.PI / 180;
const WN = 44, WAKE_LIFE = 110;

export interface ViewState { cx: number; cz: number; W: number; anim: { cx: number; cz: number; W: number } | null; }

interface ShipVis { ship: Ship; model: ShipModel; wake: THREE.Mesh; fires: THREE.Sprite[]; }
export interface FallMark { x: number; z: number; t: number; hit: boolean; target: Ship; shooter: Ship; }

export class Renderer3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 1_000_000);
  readonly view: ViewState = { cx: 0, cz: 0, W: 9000, anim: null };
  readonly effects: Effects;
  readonly falls: FallMark[] = [];
  width = 800; height = 600;
  private sun: THREE.DirectionalLight;
  private sunDir = new THREE.Vector3(0.75, 0.6, 0.28).normalize();
  private sea: THREE.Mesh;
  private vis = new Map<Ship, ShipVis>();
  private shellSprites = new Map<number, THREE.Sprite>();
  private v3 = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private wakeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });

  constructor(canvas: HTMLCanvasElement, private world: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x174a6c);
    this.scene.add(new THREE.AmbientLight(0xd4e0ec, 1.45), new THREE.HemisphereLight(0xc4dcf2, 0x1c3f58, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff0d6, 3.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    texWater.repeat.set(3000, 3000);
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(800_000, 800_000), new THREE.MeshLambertMaterial({ color: 0x1e5f88, map: texWater }));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.receiveShadow = true;
    this.scene.add(this.sea);
    this.effects = new Effects(this.scene);
  }

  addShip(ship: Ship) {
    const model = buildShipModel(ship.c);
    this.scene.add(model.root);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WN * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(WN * 8), 4));
    const idx: number[] = []; for (let i = 0; i < WN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const wake = new THREE.Mesh(g, this.wakeMat); wake.frustumCulled = false; wake.renderOrder = 1;
    this.scene.add(wake);
    this.vis.set(ship, { ship, model, wake, fires: [] });
  }

  resize(w: number, h: number) {
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.setCamera();
  }

  get metresPerPixel() { return this.view.W / this.width; }
  shipScale() { return clamp(this.view.W / 2500, 1, SHIP_VIS_MAX); }

  setCamera() {
    const v = this.view, H = v.W * this.height / this.width, D = 300_000;
    Object.assign(this.camera, { left: -v.W / 2, right: v.W / 2, top: H / 2, bottom: -H / 2 });
    this.camera.position.set(v.cx, D * Math.sin(PITCH), v.cz + D * Math.cos(PITCH));
    this.camera.lookAt(v.cx, 0, v.cz);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const S = clamp(Math.max(v.W, H / Math.sin(PITCH)) * 0.62, 600, 60000), sc = this.sun.shadow.camera;
    Object.assign(sc, { left: -S, right: S, top: S, bottom: -S, near: 100, far: 300000 });
    sc.updateProjectionMatrix();
    this.sun.target.position.set(v.cx, 0, v.cz);
    this.sun.position.set(v.cx + this.sunDir.x * 100000, this.sunDir.y * 100000, v.cz + this.sunDir.z * 100000);
    this.sun.target.updateMatrixWorld();
  }

  /** World point to screen pixels. */
  project(x: number, z: number, y = 0) {
    this.v3.set(x, y, z).project(this.camera);
    return { x: (this.v3.x + 1) / 2 * this.width, y: (1 - this.v3.y) / 2 * this.height, ok: Math.abs(this.v3.x) < 1.1 && Math.abs(this.v3.y) < 1.1 };
  }
  /** Screen pixels to a point on the sea surface. */
  ground(sx: number, sy: number) {
    this.ray.setFromCamera(new THREE.Vector2(sx / this.width * 2 - 1, -(sy / this.height) * 2 + 1), this.camera);
    const out = new THREE.Vector3(); this.ray.ray.intersectPlane(this.plane, out); return out;
  }
  /** Where something near a ship is drawn, given that the ship is drawn enlarged. */
  displayNear(target: Ship, x: number, z: number) {
    const d = Math.hypot(x - target.x, z - target.z);
    if (d > 1200) return { x, z };
    const k = lerp(target.vs, 1, clamp((d - 600) / 600, 0, 1));
    return { x: target.x + (x - target.x) * k, z: target.z + (z - target.z) * k };
  }

  update(rdt: number, simDt: number) {
    const v = this.view;
    if (v.anim) {
      const a = v.anim, k = 1 - Math.exp(-rdt * 4.5);
      v.cx = lerp(v.cx, a.cx, k); v.cz = lerp(v.cz, a.cz, k); v.W = Math.exp(lerp(Math.log(v.W), Math.log(a.W), k));
      if (Math.abs(v.W - a.W) / a.W < 0.002 && Math.hypot(v.cx - a.cx, v.cz - a.cz) < v.W * 0.001) v.anim = null;
    }
    this.setCamera();
    for (const e of this.world.events) this.onEvent(e);
    this.updateShips(rdt);
    this.updateShells();
    this.effects.update(simDt > 0 ? rdt : 0);
    const map = (this.sea.material as THREE.MeshLambertMaterial).map!;
    map.offset.x += rdt * 0.004; map.offset.y += rdt * 0.0025;
    const now = this.world.time;
    for (let i = this.falls.length - 1; i >= 0; i--) if (now - this.falls[i].t > 40) this.falls.splice(i, 1);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  private updateShips(rdt: number) {
    const s0 = this.shipScale();
    for (const sv of this.vis.values()) {
      const s = sv.ship, m = sv.model;
      let nd = 1e9;
      for (const o of this.world.ships) if (o !== s) nd = Math.min(nd, Math.hypot(o.x - s.x, o.z - s.z));
      const want = Math.min(s0, Math.max(1, 0.8 * nd / s.c.L));
      s.vs = lerp(s.vs, want, 1 - Math.exp(-rdt * 5));
      const bk = 1 + 0.35 * clamp((s.vs - 1) / 2, 0, 1);
      const settle = s.alive ? 0 : Math.min(s.magazine ? 30 : 14, s.sinkT * (s.magazine ? 0.6 : 0.06));
      m.root.position.set(s.x, -settle * s.vs, s.z);
      m.root.rotation.y = Math.PI / 2 - s.heading;
      m.root.scale.set(s.vs, s.vs * bk, s.vs * bk);
      const tt = performance.now() / 1000 + s.x * 0.001;
      m.inner.rotation.x = Math.sin(tt * 0.8) * 0.008 + s.listAngle;
      m.inner.rotation.z = Math.sin(tt * 0.55) * 0.004 + (s.alive ? 0 : Math.min(0.06, s.sinkT * 0.0006));
      m.root.visible = !(s.magazine && s.sinkT > 60) && !(!s.alive && s.sinkT > 200);
      s.turrets.forEach((tu, i) => { m.turrets[i].rotation.y = -tu.rel; m.turrets[i].rotation.z = tu.alive ? 0 : -0.06; });
      // fires
      const nf = Math.min(5, s.fires + (s.alive ? 0 : 2));
      while (sv.fires.length < nf) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color: 0xff7a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.position.set(rnd(-0.35, 0.35) * s.c.L, s.c.fb + rnd(4, 10), rnd(-3, 3)); m.inner.add(sp); sv.fires.push(sp);
      }
      while (sv.fires.length > nf) { const sp = sv.fires.pop()!; m.inner.remove(sp); sp.material.dispose(); }
      sv.fires.forEach((sp, i) => sp.scale.setScalar(24 * (0.75 + 0.25 * Math.sin(tt * 9 + i * 2) + 0.1 * Math.sin(tt * 23 + i))));
      if (nf && m.root.visible && Math.random() < rdt * nf * 1.2) {
        const wp = new THREE.Vector3(); sv.fires[0].getWorldPosition(wp);
        this.effects.add('bsmoke', wp.x, wp.y, wp.z, 70 * s.vs);
      }
      this.updateWake(sv);
    }
  }

  private updateWake(sv: ShipVis) {
    const s = sv.ship, m = sv.wake;
    m.visible = s.speed > 0.4 && sv.model.root.visible;
    if (!m.visible) return;
    const sc = s.vs, half = s.c.L / 2 * sc, now = this.world.time;
    const pts = [{ x: s.x, z: s.z, h: s.heading, t: now }, ...s.hist];
    const P = (m.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const Cc = (m.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array;
    const spd = clamp(s.speed / 7, 0, 1);
    for (let i = 0; i < WN; i++) {
      const p = pts[Math.min(i, pts.length - 1)], [dx, dz] = dir(p.h);
      const sx = p.x - dx * half * 0.9, sz = p.z - dz * half * 0.9, age = now - p.t;
      const w = (s.c.B * 0.38 + age * 0.14) * sc, nx = -dz, nz = dx;
      P.set([sx + nx * w, 0.5, sz + nz * w, sx - nx * w, 0.5, sz - nz * w], i * 6);
      const a = (i >= pts.length ? 0 : 0.36 * Math.pow(clamp(1 - age / WAKE_LIFE, 0, 1), 1.6) * spd) * (i === 0 ? 0.6 : 1);
      Cc.set([0.9, 0.95, 1, a, 0.9, 0.95, 1, a], i * 8);
    }
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.attributes.color.needsUpdate = true;
  }

  private muzzle(ship: Ship, turret: number) {
    const vis = this.vis.get(ship); if (!vis) return null;
    const g = vis.model.turrets[turret], p = new THREE.Vector3(); g.getWorldPosition(p);
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion()));
    const len = (ship.c.gun.barrelM + 4) * ship.vs;
    return { p: p.clone().addScaledVector(ax, len), ax };
  }

  private updateShells() {
    const seen = new Set<number>();
    const mpp = this.metresPerPixel;
    for (const sh of this.world.shells) {
      seen.add(sh.id);
      let sp = this.shellSprites.get(sh.id);
      if (!sp) {
        sp = this.effects.sprite(texGlow, sh.shooter.side === 'player' ? 0xffd38a : 0xffb27a, true, 1);
        const mz = this.muzzle(sh.shooter, sh.turret);
        sp.userData = mz ? { x: mz.p.x, y: mz.p.y, z: mz.p.z } : { x: sh.x0, y: sh.y0, z: sh.z0 };
        this.shellSprites.set(sh.id, sp);
      }
      const u = clamp(sh.t / sh.T, 0, 1), s0 = sp.userData as { x: number; y: number; z: number };
      const end = this.displayNear(sh.target, sh.lx, sh.lz);
      sp.position.set(lerp(s0.x, end.x, u), lerp(s0.y, 2, u) + sh.apex * 4 * u * (1 - u), lerp(s0.z, end.z, u));
      sp.scale.setScalar(Math.max(7 * mpp, 18));
    }
    for (const [id, sp] of this.shellSprites) if (!seen.has(id)) { this.scene.remove(sp); sp.material.dispose(); this.shellSprites.delete(id); }
  }

  private onEvent(e: SimEvent) {
    const mpp = this.metresPerPixel;
    if (e.type === 'fire') {
      const mz = this.muzzle(e.ship, e.turret); if (!mz) return;
      this.effects.add('flash', mz.p.x, mz.p.y, mz.p.z, Math.max(55 * e.ship.vs, 12 * mpp));
      this.effects.add('gunsmoke', mz.p.x + mz.ax.x * 20, mz.p.y + 4, mz.p.z + mz.ax.z * 20, Math.max(90 * e.ship.vs, 16 * mpp));
    } else if (e.type === 'splash') {
      const t = e.shell.target, d = this.displayNear(t, e.x, e.z);
      this.effects.add('splash', d.x, 0, d.z, Math.max(70 * Math.min(t.vs, 2), 14 * mpp) * (e.shell.shooter.c.gun.caliberMm / 406));
      this.falls.push({ x: e.x, z: e.z, t: this.world.time, hit: false, target: t, shooter: e.shell.shooter });
    } else if (e.type === 'hit') {
      const t = e.shell.target, vis = this.vis.get(t); if (!vis) return;
      const imp = e.result.impact, p = vis.model.inner.localToWorld(new THREE.Vector3(imp.u, imp.y, imp.v));
      const big = e.result.outcome === 'citadel' || e.result.outcome === 'penetration';
      this.effects.add('boom', p.x, p.y, p.z, Math.max((big ? 90 : 45) * t.vs, (big ? 16 : 9) * mpp));
      if (big) this.effects.add('bsmoke', p.x, p.y + 8, p.z, 80 * t.vs);
      if (e.result.outcome === 'ricochet' || e.result.outcome === 'overpen') this.effects.add('splash', p.x + rnd(-20, 20), 0, p.z + rnd(-20, 20), 40 * Math.min(t.vs, 2));
      this.falls.push({ x: e.shell.lx, z: e.shell.lz, t: this.world.time, hit: true, target: t, shooter: e.shell.shooter });
    } else if (e.type === 'magazine') {
      const t = e.ship;
      this.effects.add('big', t.x, 60, t.z, 900 * t.vs);
      for (let i = 0; i < 8; i++) this.effects.add('bsmoke', t.x + rnd(-80, 80) * t.vs, rnd(40, 200) * t.vs, t.z + rnd(-80, 80) * t.vs, rnd(300, 520) * t.vs);
    }
  }
}
