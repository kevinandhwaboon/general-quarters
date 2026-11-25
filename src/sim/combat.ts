import { fuseThreshold, GunSpec, ShellType } from '../data/guns';
import { DEG, clamp, dir, interp } from '../math';
import { columnAt, Part } from './hull';
import { Mount, Ship, SystemState } from './ship';

export type Zone = 'belt' | 'upperSide' | 'deck' | 'ends' | 'endsDeck' | 'turretFace' | 'turretRoof' | 'conning' | 'superstructure' | 'funnel';
export const ZONE_LABEL: Record<Zone, string> = {
  belt: 'main belt', upperSide: 'upper side', deck: 'armoured deck', ends: 'bow/stern side', endsDeck: 'bow/stern deck',
  turretFace: 'turret face', turretRoof: 'turret roof', conning: 'conning tower', superstructure: 'superstructure', funnel: 'funnel',
};

export interface Impact {
  /** Local coordinates: u along the hull (+ forward), v across (+ starboard), y height above water. */
  u: number; v: number; y: number;
  zone: Zone;
  turret: number;
  /** Angle between the shell path and the plate normal (rad). */
  obliquity: number;
  plate: number;
}

/**
 * Trace the last part of the shell's path back from its landing point and find the first solid
 * part of the target it passes through. Returns null for a miss.
 * dx, dz: horizontal unit vector of travel. fall: angle of fall (rad).
 */
export function hitTest(t: Ship, lx: number, lz: number, dx: number, dz: number, fall: number, step = 1.5): Impact | null {
  const c = t.c;
  const tanF = Math.max(Math.tan(fall), 0.02);
  const smax = Math.min(700, 48 / tanF);
  const [fx, fz] = dir(t.heading);
  let prev: ReturnType<typeof columnAt> = null;
  let prevAbove = false;
  for (let s = smax; s >= 0; s -= step) {
    const px = lx - dx * s, pz = lz - dz * s, py = s * tanF;
    const ox = px - t.x, oz = pz - t.z;
    const u = ox * fx + oz * fz, v = -ox * fz + oz * fx;
    const col = columnAt(c, u, v);
    if (col && py <= col.h) {
      const fromTop = !!prev && prevAbove && prev.part === col.part && prev.turret === col.turret;
      return classify(t, u, v, py, col.part, col.turret, fromTop, dx, dz, fall);
    }
    prev = col; prevAbove = !!col;
  }
  return null;
}

function classify(t: Ship, u: number, v: number, y: number, part: Part, turret: number, fromTop: boolean, dx: number, dz: number, fall: number): Impact {
  const a = t.c.armour;
  const inCit = u >= a.citadel[0] && u <= a.citadel[1];
  // shell direction (unit) in world space
  const sx = dx * Math.cos(fall), sy = -Math.sin(fall), sz = dz * Math.cos(fall);
  // outward horizontal normal of the side that was struck
  const [fx, fz] = dir(t.heading);
  const rx = -fz, rz = fx; // starboard
  const side = v >= 0 ? 1 : -1;
  const hx = rx * side, hz = rz * side;
  const obl = (nx: number, ny: number, nz: number) => Math.acos(clamp(-(sx * nx + sy * ny + sz * nz), 0, 1));
  const top = obl(0, 1, 0);
  const flank = obl(hx, 0, hz);
  let zone: Zone, plate: number, obliquity: number;
  if (part === 'turret') {
    if (fromTop) { zone = 'turretRoof'; plate = a.turretRoof; obliquity = top; }
    else {
      const tx = t.c.turrets[turret].x;
      const nu = u - tx, nv = v, n = Math.hypot(nu, nv) || 1;
      const wx = (nu * fx + nv * rx) / n, wz = (nu * fz + nv * rz) / n;
      zone = 'turretFace'; plate = a.turretFace; obliquity = obl(wx, 0, wz);
    }
  } else if (part === 'conning') { zone = 'conning'; plate = a.conning; obliquity = fromTop ? top : flank; }
  else if (part === 'superstructure') { zone = 'superstructure'; plate = a.superstructure; obliquity = fromTop ? top : flank; }
  else if (part === 'funnel') { zone = 'funnel'; plate = a.superstructure; obliquity = flank; }
  else if (fromTop) { zone = inCit ? 'deck' : 'endsDeck'; plate = inCit ? a.deck : a.ends; obliquity = top; }
  else if (inCit && y <= a.beltTop) {
    zone = 'belt'; plate = a.belt;
    const i = a.beltIncl * DEG; // top leans outward: the plate faces outward and down
    obliquity = obl(hx * Math.cos(i), -Math.sin(i), hz * Math.cos(i));
  } else if (inCit) { zone = 'upperSide'; plate = a.upperSide; obliquity = flank; }
  else { zone = 'ends'; plate = a.ends; obliquity = flank; }
  return { u, v, y, zone, turret, obliquity, plate };
}

/** Seconds damage control needs to bring a system back; fires on board slow the work. */
const repairTime = (t: Ship) => (60 + Math.random() * 120) * (1 + 0.15 * t.fires);

/**
 * Splinters and blast from a burst near the upper deck or superstructure. Rolls against the
 * radar and every secondary or AA mount close to the burst. power is 1 for an HE burst and lower
 * for an AP shell that only punches through. Returns notes for the log; true if anything important.
 */
export function splinterSystems(t: Ship, imp: Impact, power: number, notes: string[]): boolean {
  const high = imp.zone === 'superstructure' || imp.zone === 'conning' || imp.zone === 'funnel';
  if (!high && imp.y < t.c.fb - 2.5) return false; // low on the hull: the upper deck is sheltered
  let important = false;
  const knock = (sys: SystemState, p: number): 'down' | 'destroyed' | null => {
    if (sys.status === 'destroyed' || Math.random() >= p) return null;
    if (Math.random() < 0.25) { sys.status = 'destroyed'; sys.repair = 0; return 'destroyed'; }
    sys.status = 'down'; sys.repair = Math.max(sys.repair, repairTime(t)); return 'down';
  };
  // radar aerials sit high on the main mast or tower
  if (t.radarSet && high && imp.y > 12) {
    const mast = t.c.masts.reduce((a, m) => (m.h > a.h ? m : a), t.c.masts[0]);
    if (mast && Math.abs(imp.u - mast.x) < 25) {
      const r = knock(t.radarSet, 0.35 * power);
      if (r) { notes.push(r === 'destroyed' ? 'radar destroyed' : 'radar out of action'); important = true; }
    }
  }
  const side = Math.abs(imp.v) < 3 ? 0 : imp.v > 0 ? 1 : -1;
  const hitMounts: Mount[] = [];
  for (const m of t.mounts) {
    const d = Math.abs(m.x - imp.u);
    if (d > 12 || (side !== 0 && m.side !== side)) continue;
    const r = knock(m, 0.55 * power * (1 - d / 14));
    if (r) hitMounts.push(m);
  }
  if (hitMounts.length) {
    const byLabel = new Map<string, number>();
    for (const m of hitMounts) byLabel.set(m.label, (byLabel.get(m.label) ?? 0) + 1);
    notes.push([...byLabel].map(([l, n]) => `${n > 1 ? n + ' × ' : ''}${l}`).join(', ') + ' knocked out');
    important ||= hitMounts.some(m => m.kind !== 'laa');
  }
  return important;
}

export type Outcome = 'ricochet' | 'defeated' | 'overpen' | 'penetration' | 'citadel' | 'burst';

export interface HitResult {
  impact: Impact;
  outcome: Outcome;
  effective: number;
  pen: number;
  damage: number;
  notes: string[];
  critical: boolean;
  magazine: boolean;
}

/** Armour check and damage for one shell. realKm is the real-equivalent range. */
export function resolveHit(t: Ship, imp: Impact, gun: GunSpec, realKm: number, kind: ShellType = 'ap'): HitResult {
  return kind === 'he' ? resolveHE(t, imp, gun) : resolveAP(t, imp, gun, realKm);
}

function resolveAP(t: Ship, imp: Impact, gun: GunSpec, realKm: number): HitResult {
  const pen = interp(gun.penNormal, realKm);
  const cos = Math.cos(imp.obliquity);
  const effective = imp.plate / Math.max(cos, 0.05);
  const notes: string[] = [];
  let outcome: Outcome; let damage = 0; let critical = false; let magazine = false;
  const deg = imp.obliquity / DEG;
  const ricochetP = deg >= 70 ? 1 : deg >= 60 ? (deg - 60) / 10 : 0;
  const a = t.c.armour;
  if (Math.random() < ricochetP && imp.plate >= fuseThreshold(gun)) { outcome = 'ricochet'; damage = gun.damage * 0.02; }
  else if (pen < effective) {
    outcome = 'defeated'; damage = gun.damage * 0.06;
    if (imp.zone === 'turretFace' || imp.zone === 'turretRoof') { const tu = t.turrets[imp.turret]; if (tu.alive) { tu.jam = Math.max(tu.jam, 25); notes.push(`turret ${imp.turret + 1} jammed`); } }
  } else if (imp.plate < fuseThreshold(gun)) {
    outcome = 'overpen'; damage = gun.damage * 0.1;
    if (imp.y < 1.6 && (imp.zone === 'ends' || imp.zone === 'upperSide')) { t.flooding += 1; t.listSide = imp.v >= 0 ? 1 : -1; notes.push('holed at the waterline'); }
    if (imp.zone === 'funnel' && Math.random() < 0.3) { t.engines = Math.max(0.4, t.engines - 0.08); notes.push('uptakes damaged'); }
    if (imp.zone === 'superstructure' && imp.y > 18 && Math.random() < 0.25) { t.director = Math.max(0.2, t.director - 0.4); notes.push('director hit'); critical = true; }
    if (splinterSystems(t, imp, 0.35, notes)) critical = true;
  } else {
    // armed fuse: the shell detonates inside
    if (imp.zone === 'turretFace' || imp.zone === 'turretRoof') {
      outcome = 'penetration'; damage = gun.damage * 0.6; critical = true;
      const tu = t.turrets[imp.turret];
      if (tu.alive) { tu.alive = false; notes.push(`turret ${imp.turret + 1} destroyed`); }
      if (Math.random() < 0.05) { magazine = true; notes.push('flash fire reached the magazine'); }
    } else if (imp.zone === 'belt' || imp.zone === 'deck') {
      outcome = 'citadel'; damage = gun.damage; critical = true;
      const nearMag = t.c.turrets.some(tt => Math.abs(imp.u - tt.x) < 14);
      const r = Math.random();
      if (nearMag && r < 0.06) { magazine = true; notes.push('MAGAZINE DETONATION'); }
      else if (Math.abs(imp.u) < 40 && r < 0.45) { t.engines = Math.max(0.15, t.engines - 0.3); notes.push(Math.random() < 0.5 ? 'boiler room hit' : 'engine room hit'); }
      else if (imp.u < a.citadel[0] + 12 && r < 0.5) { t.rudderJam = Math.random() < 0.5 ? 0.6 : -0.6; notes.push('steering gear hit, rudder jammed'); }
      else if (imp.zone === 'belt' && imp.y < 1.2) { t.flooding += 2; t.listSide = imp.v >= 0 ? 1 : -1; notes.push('flooding'); }
      else notes.push('heavy internal damage');
      if (Math.random() < 0.35) { t.fires++; notes.push('fire'); }
    } else if (imp.zone === 'conning') {
      outcome = 'penetration'; damage = gun.damage * 0.4; critical = true;
      if (Math.random() < 0.4) { t.director = Math.max(0.2, t.director - 0.5); notes.push('command and director spaces hit'); }
      if (Math.random() < 0.25) { t.rudderJam = Math.random() < 0.5 ? 0.4 : -0.4; notes.push('helm lost, rudder jammed'); }
    } else {
      outcome = 'penetration'; damage = gun.damage * 0.35;
      if (splinterSystems(t, imp, 0.6, notes)) critical = true;
      if (Math.random() < 0.4) { t.fires++; notes.push('fire'); }
      if (imp.y < 1.6) { t.flooding += 1; t.listSide = imp.v >= 0 ? 1 : -1; notes.push('flooding'); }
    }
  }
  t.hp -= damage;
  t.fires = Math.min(t.fires, 8);
  return { impact: imp, outcome, effective, pen, damage, notes, critical, magazine };
}

/**
 * HE shell: an instantaneous fuse, so it bursts on whatever it strikes first. Plates thinner than
 * the shell can blow through are holed and it bursts behind them; against real armour it bursts
 * outside, wrecking fittings and starting fires but not reaching the machinery or magazines.
 * Damage to systems (radar, secondaries, AA) with repair timers comes in the next step.
 */
function resolveHE(t: Ship, imp: Impact, gun: GunSpec): HitResult {
  const he = gun.he;
  const effective = imp.plate / Math.max(Math.cos(imp.obliquity), 0.05);
  const inside = effective <= he.penMm;
  const notes: string[] = [];
  let outcome: Outcome; let damage: number; let critical = false; const magazine = false;
  const a = t.c.armour;
  // blast and splinter effects scale with the burster: a 5-inch shell does about half of what a 16-inch does
  const k = clamp(gun.caliberMm / 300, 0.3, 1);
  const fire = (p: number) => { if (Math.random() < p * k) { t.fires++; notes.push('fire'); } };
  if (splinterSystems(t, imp, k, notes)) critical = true;
  switch (imp.zone) {
    case 'superstructure':
      outcome = 'penetration'; damage = he.damage * 0.3;
      if (imp.y > 14 && Math.random() < 0.4 * k) { t.director = Math.max(0.2, t.director - 0.3); notes.push('director damaged'); critical = true; }
      fire(0.5);
      break;
    case 'funnel':
      outcome = 'penetration'; damage = he.damage * 0.2;
      // uptakes wrecked: boiler draught suffers; armoured ships keep most of their speed
      if (Math.random() < 0.45 * k) { t.engines = Math.max(inside && a.belt < he.penMm ? 0.3 : 0.6, t.engines - 0.08); notes.push('uptakes damaged'); }
      fire(0.25);
      break;
    case 'conning':
      outcome = inside ? 'penetration' : 'burst'; damage = he.damage * (inside ? 0.4 : 0.1);
      if (Math.random() < (inside ? 0.5 : 0.15) * k) { t.director = Math.max(0.2, t.director - (inside ? 0.4 : 0.15)); notes.push('bridge hit, director damaged'); critical ||= inside; }
      break;
    case 'turretFace': case 'turretRoof': {
      outcome = 'burst'; damage = he.damage * 0.08;
      const tu = t.turrets[imp.turret];
      if (tu.alive && Math.random() < 0.4 * k) { tu.jam = Math.max(tu.jam, 20); notes.push(`turret ${imp.turret + 1} jammed`); }
      break;
    }
    case 'belt': case 'deck':
      if (inside) {
        // a thin-skinned ship: the burst reaches the machinery spaces
        outcome = 'citadel'; damage = he.damage * 0.8; critical = true;
        const r = Math.random();
        if (Math.abs(imp.u) < 40 && r < 0.5) { t.engines = Math.max(0.15, t.engines - 0.3); notes.push(Math.random() < 0.5 ? 'boiler room hit' : 'engine room hit'); }
        else if (imp.y < 1.2) { t.flooding += 1; t.listSide = imp.v >= 0 ? 1 : -1; notes.push('flooding'); }
        fire(0.5);
      } else { outcome = 'burst'; damage = he.damage * 0.06; fire(0.1); }
      break;
    default: // upper side, bow and stern
      if (inside) {
        outcome = 'penetration'; damage = he.damage * 0.35;
        if (imp.y < 1.6) { t.flooding += 1; t.listSide = imp.v >= 0 ? 1 : -1; notes.push('holed at the waterline'); }
        else if (imp.zone === 'ends' && imp.u < a.citadel[0] && Math.random() < 0.25 * k) { t.rudderJam = Math.random() < 0.5 ? 0.4 : -0.4; notes.push('steering damaged, rudder jammed'); critical = true; }
        fire(0.45);
      } else { outcome = 'burst'; damage = he.damage * 0.08; fire(0.15); }
  }
  t.hp -= damage;
  t.fires = Math.min(t.fires, 8);
  return { impact: imp, outcome, effective, pen: he.penMm, damage, notes, critical, magazine };
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  ricochet: 'ricochet', defeated: 'armour held', overpen: 'over-penetration', penetration: 'penetration', citadel: 'CITADEL', burst: 'burst on armour',
};
