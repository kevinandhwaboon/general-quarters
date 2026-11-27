import { FLIGHT_TIME_SCALE, toReal } from '../config';
import { GunSpec, SHELL_LABEL, ShellType } from '../data/guns';
import { bearing, clamp, DEG, dir, gauss, interp, rnd, wrap } from '../math';
import { hitTest, HitResult, Impact, OUTCOME_LABEL, resolveHit, Zone, ZONE_LABEL } from './combat';
import { canBear, FireControl, Mount, mountBears, restAngle, Ship } from './ship';

export interface Shell {
  id: number;
  salvo: number;
  shooter: Ship;
  target: Ship;
  /** Muzzle position at firing. */
  x0: number; y0: number; z0: number;
  /** Where the shell comes down (sea level, world coordinates). */
  lx: number; lz: number;
  dx: number; dz: number;
  fall: number;
  realKm: number;
  t: number;
  T: number;
  apex: number;
  /** Main-battery turret index, or -1 for a secondary mount. */
  turret: number;
  kind: ShellType;
  gun: GunSpec;
}

interface Salvo { id: number; shooter: Ship; fc: FireControl; target: Ship; left: number; along: number[]; hits: number; straddle: boolean; }

export type SimEvent =
  | { type: 'fire'; ship: Ship; turret: number; guns: number; kind: ShellType }
  | { type: 'secFire'; ship: Ship; mount: Mount; guns: number }
  | { type: 'splash'; shell: Shell; x: number; z: number }
  | { type: 'hit'; shell: Shell; result: HitResult }
  | { type: 'log'; text: string; cls: '' | 'hit' | 'crit' | 'own' }
  | { type: 'magazine'; ship: Ship };

export type EnemyMode = 'idle' | 'steam' | 'zigzag';

export class World {
  ships: Ship[] = [];
  shells: Shell[] = [];
  salvos = new Map<number, Salvo>();
  events: SimEvent[] = [];
  time = 0;
  enemyMode: EnemyMode = 'idle';
  enemyReturnFire = false;
  private nextShell = 1;
  private nextSalvo = 1;
  private zigT = new Map<Ship, number>();

  add(s: Ship) { this.ships.push(s); return s; }
  log(text: string, cls: '' | 'hit' | 'crit' | 'own' = '') { this.events.push({ type: 'log', text, cls }); }

  step(dt: number) {
    this.time += dt;
    for (const s of this.ships) {
      if (s.side === 'enemy') this.enemyBrain(s, dt);
      s.update(dt);
      if (this.time - s.histT >= 2.5) { s.hist.unshift({ x: s.x, z: s.z, h: s.heading, t: this.time }); s.histT = this.time; if (s.hist.length > 44) s.hist.pop(); }
      this.damageControl(s, dt);
      if (s.alive) { s.fc.update(dt); this.gunnery(s, dt); this.secondaryGunnery(s, dt); }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t += dt;
      if (sh.t >= sh.T) { this.shells.splice(i, 1); this.land(sh); }
    }
  }

  /** Nearest living ship of the other side, or null. */
  nearestEnemy(s: Ship): Ship | null {
    let best: Ship | null = null, bd = Infinity;
    for (const o of this.ships) {
      if (o.side === s.side || !o.alive) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  private enemyBrain(s: Ship, dt: number) {
    if (!s.alive) return;
    if (this.enemyMode === 'idle') { s.telegraph = 1; }
    else if (this.enemyMode === 'steam') { s.telegraph = 4; }
    else {
      s.telegraph = 4;
      const z = (this.zigT.get(s) ?? 0) - dt;
      this.zigT.set(s, z > 0 ? z : 70);
      if (z <= 0) s.course = wrap((s.course ?? s.heading) + (Math.random() < 0.5 ? -1 : 1) * rnd(30, 50) * DEG);
    }
    s.holdFire = !this.enemyReturnFire;
    // keep shooting at the current target while it floats; otherwise take the nearest
    if (this.enemyReturnFire && !(s.fc.target && s.fc.target.alive)) s.fc.assign(this.nearestEnemy(s));
  }

  private damageControl(s: Ship, dt: number) {
    if (s.fires > 0) { s.hp -= 0.04 * s.fires * dt; if (Math.random() < 0.012 * s.fires * dt) s.fires--; }
    if (s.flooding > 0) { s.hp -= 0.035 * s.flooding * dt; if (Math.random() < 0.004 * dt) s.flooding--; }
    for (const t of s.turrets) if (t.jam > 0) t.jam = Math.max(0, t.jam - dt);
    // damage control brings knocked-out systems back
    if (s.alive) {
      for (const sys of [s.radarSet, ...s.mounts]) {
        if (!sys || sys.status !== 'down') continue;
        sys.repair -= dt;
        if (sys.repair > 0) continue;
        sys.status = 'ok'; sys.repair = 0;
        if (sys === s.radarSet) this.log(`${s.name}: radar back in action`, s.side === 'player' ? 'own' : '');
      }
    }
    if (s.alive && s.hp <= 0) {
      s.alive = false; s.hp = 0;
      this.log(`${s.name} is sinking`, 'crit');
    }
  }

  /** Where the director aims: predicted target position plus the solution error. */
  aimPoint(s: Ship, t: Ship, fc: FireControl = s.fc, gun: GunSpec = s.c.gun) {
    const d = Math.hypot(t.x - s.x, t.z - s.z);
    const realKm = toReal(d) / 1000;
    const T = interp(gun.flightS, realKm) * FLIGHT_TIME_SCALE;
    const px = t.x + fc.vx * T, pz = t.z + fc.vz * T;
    const b = bearing(s.x, s.z, px, pz);
    const [ux, uz] = dir(b), [rx, rz] = dir(b + Math.PI / 2);
    return { x: px + ux * fc.er + rx * fc.ed, z: pz + uz * fc.er + rz * fc.ed, b, T, realKm, ux, uz, rx, rz };
  }

  /** Nearest living enemy ship within the secondary guns' range (real km), or null. */
  secondaryTarget(s: Ship): Ship | null {
    const sec = s.c.sec; if (!sec) return null;
    let best: Ship | null = null, bd = Infinity;
    for (const o of this.ships) {
      if (o.side === s.side || !o.alive) continue;
      const d = toReal(Math.hypot(o.x - s.x, o.z - s.z)) / 1000;
      if (d <= sec.gun.maxRangeKm && d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /**
   * Secondaries engage on their own: the nearest enemy ship in range, with HE, from the mounts on
   * the engaged side. They respect hold fire and fire in salvos so the fall of shot can be spotted.
   */
  private secondaryGunnery(s: Ship, dt: number) {
    const sec = s.c.sec; if (!sec) return;
    for (const m of s.mounts) m.reload = Math.max(0, m.reload - dt);
    const t = s.holdFire || s.secAmmo <= 0 ? null : this.secondaryTarget(s);
    if (t !== s.secFc.target) s.secFc.assign(t);
    if (!t) { s.secWait = 0; return; }
    s.secFc.update(dt);
    const aim = this.aimPoint(s, t, s.secFc, sec.gun);
    const rel = wrap(aim.b - s.heading);
    const bearingMounts = s.mounts.filter(m => (m.kind === 'sec' || m.kind === 'dp') && m.status === 'ok' && mountBears(m, rel));
    const ready = bearingMounts.filter(m => m.reload <= 0);
    if (ready.length === 0) { s.secWait = 0; return; }
    s.secWait += dt;
    if (ready.length < bearingMounts.length && s.secWait < 2) return;
    s.secWait = 0;
    const g = sec.gun, real = aim.realKm * 1000, fall = interp(g.fallDeg, aim.realKm) * DEG;
    const id = this.nextSalvo++;
    const [fx, fz] = dir(s.heading), [rx, rz] = [-fz, fx];
    const jr = gauss() * 0.005 * real, jd = gauss() * 0.0015 * real;
    let n = 0;
    for (const m of ready) {
      const guns = Math.min(sec.gunsPerMount, s.secAmmo);
      if (guns <= 0) break;
      s.secAmmo -= guns;
      m.reload = g.reload * rnd(0.9, 1.15);
      const off = s.c.B / 2 * m.side;
      const mx = s.x + fx * m.x + rx * off, mz = s.z + fz * m.x + rz * off;
      for (let k = 0; k < guns; k++) {
        const ea = jr + gauss() * g.dispRange * real, ed = jd + gauss() * g.dispDeflection * real;
        const lx = aim.x + aim.ux * ea + aim.rx * ed, lz = aim.z + aim.uz * ea + aim.rz * ed;
        const [dx, dz] = dir(bearing(mx, mz, lx, lz));
        this.shells.push({ id: this.nextShell++, salvo: id, shooter: s, target: t, x0: mx, y0: s.c.fb + 3, z0: mz, lx, lz, dx, dz, fall, realKm: aim.realKm,
          t: 0, T: aim.T * rnd(0.98, 1.02), apex: Math.hypot(lx - mx, lz - mz) * Math.tan(fall) * 0.35 + 30, turret: -1, kind: 'he', gun: g });
        n++;
      }
      this.events.push({ type: 'secFire', ship: s, mount: m, guns });
    }
    if (n === 0) return;
    s.secFc.salvos++;
    this.salvos.set(id, { id, shooter: s, fc: s.secFc, target: t, left: n, along: [], hits: 0, straddle: false });
  }

  private gunnery(s: Ship, dt: number) {
    const t = s.fc.target && s.fc.target.alive ? s.fc.target : null;
    const g = s.c.gun;
    const aim = t ? this.aimPoint(s, t) : null;
    const inRange = !!aim && aim.realKm <= g.maxRangeKm;
    let bearingCount = 0, ready: number[] = [];
    s.turrets.forEach((tu, i) => {
      tu.reload = Math.max(0, tu.reload - dt);
      if (!tu.alive) return;
      // an empty turret loads as soon as rounds of the ordered type are available
      if (!tu.loaded) { s.reloadTurret(tu); if (tu.loaded) tu.reload = Math.max(tu.reload, g.reload); }
      const relT = aim ? wrap(aim.b - s.heading) : null;
      const bears = relT !== null && canBear(tu.def, relT);
      const want = bears && relT !== null ? relT : restAngle(tu.def);
      // train along the allowed arc only (never through the superstructure)
      const cur = tu.def.fwd ? tu.rel : wrap(tu.rel - Math.PI);
      const goal = tu.def.fwd ? want : wrap(want - Math.PI);
      const max = g.traverseDegS * DEG * dt * (tu.jam > 0 ? 0 : 1);
      const next = cur + clamp(goal - cur, -max, max);
      tu.rel = tu.def.fwd ? next : wrap(next + Math.PI);
      if (bears && inRange) {
        bearingCount++;
        if (Math.abs(goal - next) < 1.2 * DEG && tu.reload <= 0 && tu.jam <= 0 && tu.loaded) ready.push(i);
      }
    });
    if (!t || !aim || !inRange || s.holdFire || ready.length === 0) { s.salvoWait = 0; return; }
    s.salvoWait += dt;
    // fire full salvos; do not wait more than a few seconds for a slow turret
    if (ready.length < bearingCount && s.salvoWait < 4) return;
    s.salvoWait = 0;
    this.fireSalvo(s, t, ready, aim);
  }

  private fireSalvo(s: Ship, t: Ship, turrets: number[], aim: ReturnType<World['aimPoint']>) {
    const g = s.c.gun;
    const real = aim.realKm * 1000;
    const fall = interp(g.fallDeg, aim.realKm) * DEG;
    const id = this.nextSalvo++;
    let n = 0;
    const [fx, fz] = dir(s.heading);
    // salvo-to-salvo wander of the rangekeeper, shared by every shell in this salvo
    const jr = gauss() * 0.004 * real, jd = gauss() * 0.001 * real;
    for (const i of turrets) {
      const tu = s.turrets[i];
      const kind = tu.loaded!;
      const guns = Math.min(tu.def.guns, s.ammo[kind]);
      if (guns <= 0) { tu.loaded = null; continue; }
      s.ammo[kind] -= guns;
      tu.reload = g.reload * rnd(0.95, 1.08);
      s.reloadTurret(tu);
      const mx = s.x + fx * tu.def.x, mz = s.z + fz * tu.def.x;
      for (let k = 0; k < guns; k++) {
        const ea = jr + gauss() * g.dispRange * real, ed = jd + gauss() * g.dispDeflection * real;
        const lx = aim.x + aim.ux * ea + aim.rx * ed, lz = aim.z + aim.uz * ea + aim.rz * ed;
        const b = bearing(mx, mz, lx, lz), [dx, dz] = dir(b);
        this.shells.push({ id: this.nextShell++, salvo: id, shooter: s, target: t, x0: mx, y0: tu.def.h + 2, z0: mz, lx, lz, dx, dz, fall, realKm: aim.realKm,
          t: 0, T: aim.T * rnd(0.98, 1.02), apex: Math.hypot(lx - mx, lz - mz) * Math.tan(fall) * 0.35 + 60, turret: i, kind, gun: g });
        n++;
      }
      this.events.push({ type: 'fire', ship: s, turret: i, guns, kind });
    }
    if (n === 0) return;
    s.fc.salvos++;
    this.salvos.set(id, { id, shooter: s, fc: s.fc, target: t, left: n, along: [], hits: 0, straddle: false });
  }

  private land(sh: Shell) {
    const t = sh.target;
    const imp: Impact | null = t.alive || t.sinkT < 30 ? hitTest(t, sh.lx, sh.lz, sh.dx, sh.dz, sh.fall) : null;
    const sv = this.salvos.get(sh.salvo);
    if (imp) {
      const res = resolveHit(t, imp, sh.gun, sh.realKm, sh.kind);
      this.events.push({ type: 'hit', shell: sh, result: res });
      if (sv) sv.hits++;
      const who = sh.shooter.side === 'player' ? 'hit' : 'crit';
      // secondary hits are frequent and small: log only those that do something
      if (sh.turret >= 0 || res.notes.length) {
        const gun = sh.turret >= 0 ? SHELL_LABEL[sh.kind] : `${Math.round(sh.gun.caliberMm / 25.4)}-inch`;
        const text = `${sh.shooter.name.replace('USS ', '')} → ${t.name.replace('USS ', '')}: ${gun} · ${ZONE_LABEL[imp.zone as Zone]} · ${OUTCOME_LABEL[res.outcome]}${res.notes.length ? ' · ' + res.notes.join(', ') : ''}`;
        this.log(text, res.critical ? 'crit' : who === 'hit' ? 'hit' : '');
      }
      if (res.magazine && t.alive) { t.magazine = true; t.hp = 0; this.events.push({ type: 'magazine', ship: t }); }
      if (t.alive && t.hp <= 0) { t.alive = false; t.hp = 0; this.log(`${t.name} ${t.magazine ? 'has blown up' : 'is sinking'}`, 'crit'); }
    } else {
      this.events.push({ type: 'splash', shell: sh, x: sh.lx, z: sh.lz });
    }
    if (sv) {
      const [ux, uz] = [sh.dx, sh.dz];
      sv.along.push((sh.lx - t.x) * ux + (sh.lz - t.z) * uz);
      sv.left--;
      if (sv.left === 0) this.salvoDone(sv);
    }
  }

  private salvoDone(sv: Salvo) {
    this.salvos.delete(sv.id);
    const fc = sv.fc;
    if (fc.target !== sv.target) return;
    const half = sv.target.c.B / 2 + 20;
    const over = sv.along.filter(a => a > half).length, short = sv.along.filter(a => a < -half).length;
    const mean = sv.along.reduce((a, b) => a + b, 0) / sv.along.length;
    const straddle = over > 0 && short > 0 || sv.hits > 0 && (over > 0 || short > 0);
    fc.hits += sv.hits;
    if (straddle) fc.straddles++;
    fc.last = sv.hits ? { text: `${sv.hits} hit${sv.hits > 1 ? 's' : ''}${straddle ? ' · straddle' : ''}`, kind: 'hit' }
      : straddle ? { text: 'straddle, no hits', kind: 'straddle' }
      : mean > 0 ? { text: `over by ${Math.round(mean)} m`, kind: 'over' }
      : { text: `short by ${Math.round(-mean)} m`, kind: 'short' };
    fc.spot();
  }

  /**
   * Monte Carlo estimate of the next salvo: expected hits and where they would land,
   * using the crew's own uncertainty (sig) rather than the true error.
   */
  estimate(s: Ship, samples = 160) {
    const t = s.fc.target;
    if (!t || !t.alive) return null;
    const aim = this.aimPoint(s, t);
    const g = s.c.gun, real = aim.realKm * 1000, fall = interp(g.fallDeg, aim.realKm) * DEG;
    const zones: Partial<Record<Zone, number>> = {};
    let hits = 0, pens = 0;
    for (let i = 0; i < samples; i++) {
      const mr = gauss() * Math.hypot(s.fc.sig, 0.004 * real), md = gauss() * Math.hypot(s.fc.sig * 0.25, 0.001 * real);
      const ea = mr + gauss() * g.dispRange * real, ed = md + gauss() * g.dispDeflection * real;
      // centred on the predicted position, ignoring the true (unknown) error
      const px = aim.x - aim.ux * s.fc.er - aim.rx * s.fc.ed + aim.ux * ea + aim.rx * ed;
      const pz = aim.z - aim.uz * s.fc.er - aim.rz * s.fc.ed + aim.uz * ea + aim.rz * ed;
      const imp = hitTest(t, px - t.vxPred(aim.T), pz - t.vzPred(aim.T), aim.ux, aim.uz, fall, 3);
      if (imp) {
        hits++; zones[imp.zone] = (zones[imp.zone] ?? 0) + 1;
        const eff = imp.plate / Math.max(Math.cos(imp.obliquity), 0.05);
        // AP: defeats the plate without glancing off. HE: blows through and bursts inside.
        if (s.shellType === 'he' ? eff <= g.he.penMm : interp(g.penNormal, aim.realKm) >= eff && imp.obliquity < 65 * DEG) pens++;
      }
    }
    const guns = s.turrets.reduce((a, tu) => a + (tu.alive && tu.loaded && canBear(tu.def, wrap(aim.b - s.heading)) ? Math.min(tu.def.guns, s.ammo[tu.loaded]) : 0), 0);
    const total = s.turrets.reduce((a, tu) => a + tu.def.guns, 0);
    return { pHit: hits / samples, pPen: pens / samples, zones, hits, guns, total, aim, fall };
  }
}

