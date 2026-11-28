import { KN, toReal } from '../config';
import { ShellType } from '../data/guns';
import { ShipClass, TurretDef } from '../data/ships';
import { bearing, clamp, DEG, dir, gauss, wrap } from '../math';
import { CarrierState } from './carrier';

export const TELEGRAPH = [
  { key: 'Astern', f: -0.3 },
  { key: 'Stop', f: 0 },
  { key: 'Slow', f: 0.33 },
  { key: 'Half', f: 0.6 },
  { key: 'Full', f: 0.85 },
  { key: 'Flank', f: 1 },
];

export interface TurretState {
  def: TurretDef;
  /** Current training angle relative to the bow (rad, + starboard). */
  rel: number;
  reload: number;
  alive: boolean;
  /** Seconds the turret stays jammed after a non-penetrating hit. */
  jam: number;
  /** Shell type in the guns now; null when the magazine for the selected type is empty. */
  loaded: ShellType | null;
  /** Old-type rounds still in the hoist after a change of shell type; fired before the new type. */
  hoist: ShellType | null;
  /** Friendly ship in this turret's line of fire (it holds fire), or null. */
  blocked: Ship | null;
}

/** A secondary mount covers its own side, from 20 degrees off the bow to 20 degrees off the stern. */
export function mountBears(m: { side: 1 | -1 }, rel: number): boolean {
  const a = Math.abs(rel) / DEG;
  return Math.sign(rel) === m.side && a >= 20 && a <= 160;
}

/** A turret can only bear inside its arc; aft turrets measure from the stern. */
export function canBear(t: TurretDef, rel: number): boolean {
  const a = Math.abs(rel) / DEG;
  return t.fwd ? a <= (t.maxRel ?? 150) : a >= (t.minRel ?? 30);
}
export const restAngle = (t: TurretDef) => (t.fwd ? 0 : Math.PI);

/**
 * The director's firing solution. `er` and `ed` are the true errors of the mean point of impact
 * along and across the line of fire (metres). `sig` is what the crew believes the error to be.
 */
export class FireControl {
  target: Ship | null = null;
  er = 0;
  ed = 0;
  sig = 0;
  salvos = 0;
  hits = 0;
  straddles = 0;
  last: { text: string; kind: 'over' | 'short' | 'straddle' | 'hit' | 'wide' } | null = null;
  /** Smoothed estimate of the target's velocity (the director's rate solution). */
  vx = 0;
  vz = 0;

  /** 'main' uses the main-battery director; 'sec' the secondary directors (not damaged separately yet). */
  constructor(private ship: Ship, private battery: 'main' | 'sec' = 'main') {}

  private get def() { return this.battery === 'main' ? this.ship.c.fc : this.ship.c.sec!.fc; }
  private get director() { return this.battery === 'main' ? this.ship.director : 1; }

  assign(t: Ship | null) {
    this.target = t;
    this.salvos = 0; this.hits = 0; this.straddles = 0; this.last = null;
    if (!t) return;
    const real = toReal(Math.hypot(t.x - this.ship.x, t.z - this.ship.z));
    const s0 = this.def.rangeErr0 * real / Math.max(0.35, this.director);
    this.er = gauss() * s0;
    this.ed = gauss() * s0 * 0.25;
    this.sig = s0;
    [this.vx, this.vz] = [0, 0];
  }

  /** Spotting: after a salvo lands the crew corrects the solution. */
  spot() {
    const t = this.target; if (!t) return;
    const real = toReal(Math.hypot(t.x - this.ship.x, t.z - this.ship.z));
    const keep = this.def.spotKeep + (1 - this.director) * 0.3;
    const floor = 0.0035 * real * (this.ship.radar ? 0.7 : 1) / Math.max(0.35, this.director);
    this.er = this.er * keep + gauss() * floor;
    this.ed = this.ed * keep + gauss() * floor * 0.3;
    this.sig = Math.hypot(this.sig * keep, floor);
  }

  update(dt: number) {
    const t = this.target; if (!t) return;
    const tau = this.ship.radar ? 10 : 18;
    const k = 1 - Math.exp(-dt / tau);
    const [tx, tz] = dir(t.heading);
    // the rate solution is smoothed and noisy: it lags behind any change of course or speed
    const noise = (this.ship.radar ? 0.5 : 1.1) * Math.sqrt(dt);
    this.vx += (tx * t.speed - this.vx) * k + gauss() * noise * 0.1;
    this.vz += (tz * t.speed - this.vz) * k + gauss() * noise * 0.1;
    // own manoeuvring disturbs the director
    const turn = Math.abs(this.ship.turnRate) / DEG;
    if (turn > 0.4) {
      const real = toReal(Math.hypot(t.x - this.ship.x, t.z - this.ship.z));
      const grow = (turn - 0.4) * 0.0012 * real * dt;
      this.er += gauss() * grow;
      this.ed += gauss() * grow * 0.4;
      this.sig = Math.hypot(this.sig, grow);
    }
  }

  /** 0..1, how good the solution is relative to the target's size. */
  quality(): number {
    const t = this.target; if (!t) return 0;
    return clamp(1 - this.sig / 400, 0, 1);
  }
}

export type MountKind = 'sec' | 'dp' | 'haa' | 'maa' | 'laa';
export const MOUNT_LABEL: Record<MountKind, string> = { sec: 'secondary', dp: 'dual-purpose', haa: 'heavy AA', maa: 'medium AA', laa: 'light AA' };

/** A system that can be put out of action by splinters and blast, then repaired by damage control. */
export interface SystemState {
  status: 'ok' | 'down' | 'destroyed';
  /** Seconds until a 'down' system is back in action. */
  repair: number;
}

export interface Mount extends SystemState {
  kind: MountKind;
  label: string;
  /** Position along the hull (m from amidships, + forward) and side (+1 starboard, -1 port). */
  x: number;
  side: 1 | -1;
  /** Seconds until a secondary mount can fire again. */
  reload: number;
}

export const isSecondary = (m: Mount) => m.kind === 'sec' || m.kind === 'dp';
export const isAA = (m: Mount) => m.kind !== 'sec';

/** Build the secondary and AA mounts of a class, one per side at each listed position. */
function buildMounts(c: ShipClass): Mount[] {
  const out: Mount[] = [];
  const add = (kind: MountKind, label: string, x: number) => { for (const side of [1, -1] as const) out.push({ kind, label, x, side, status: 'ok', repair: 0, reload: 0 }); };
  const role = c.secondaryRole ?? 'dp';
  for (const m of c.secondaries ?? []) add(role, role === 'dp' ? '5-inch mount' : '12.7 cm AA mount', m.x);
  if (c.cas) for (let i = 0; i < c.cas.n; i++) add('sec', '6-inch casemate', c.cas.x0 + (c.cas.x1 - c.cas.x0) * i / (c.cas.n - 1 || 1));
  for (const g of c.aa ?? []) for (const x of g.x) add(g.k === 'medium' ? 'maa' : 'laa', g.label, x);
  return out;
}

export class Ship {
  readonly c: ShipClass;
  name: string;
  side: 'player' | 'enemy';
  x: number; z: number; heading: number;
  speed = 0;
  turnRate = 0;
  rudder = 0;
  telegraph = 4;
  course: number | null = null;
  waypoint: { x: number; z: number } | null = null;
  /** Exact speed ordered by a formation (m/s), overriding the telegraph; null when steaming independently. */
  speedOrder: number | null = null;
  hp: number;
  fires = 0;
  flooding = 0;
  /** Side the ship lists toward: +1 starboard, -1 port. */
  listSide = 1;
  alive = true;
  sinkT = 0;
  magazine = false;
  engines = 1;
  rudderJam: number | null = null;
  director = 1;
  /** Fire-control radar set, or null if none is fitted. */
  radarSet: SystemState | null;
  mounts: Mount[];
  turrets: TurretState[];
  fc: FireControl;
  /** Secondary battery fire control: picks its own target among enemy ships in range. */
  secFc: FireControl;
  /** Secondary HE rounds left. */
  secAmmo: number;
  /** Seconds the secondaries have waited for slow mounts before firing a partial salvo. */
  secWait = 0;
  holdFire = false;
  /** Main-battery shell type ordered by the player. */
  shellType: ShellType = 'ap';
  /** Main-battery rounds left in the magazines. */
  ammo: Record<ShellType, number>;
  salvoWait = 0;
  /** Wake breadcrumbs. */
  hist: { x: number; z: number; h: number; t: number }[] = [];
  histT = 0;
  /** Taking evasive action under air attack (the captain's own helm orders). */
  evading = false;
  /** Carriers: deck and air group; null for other ships. */
  air: CarrierState | null;
  /** Visual enlargement currently applied (set by the renderer). */
  vs = 1;

  constructor(c: ShipClass, name: string, side: 'player' | 'enemy', x: number, z: number, headingDeg: number) {
    this.c = c; this.name = name; this.side = side; this.x = x; this.z = z; this.heading = headingDeg * DEG;
    this.hp = c.hp;
    this.radarSet = c.radar ? { status: 'ok', repair: 0 } : null;
    this.mounts = buildMounts(c);
    this.ammo = { ...c.ammo };
    this.turrets = c.turrets.map(def => ({ def, rel: restAngle(def), reload: 0, alive: true, jam: 0, loaded: 'ap' as ShellType, hoist: null, blocked: null }));
    this.fc = new FireControl(this);
    this.secFc = new FireControl(this, 'sec');
    this.secAmmo = c.sec?.ammo ?? 0;
    this.air = c.air ? new CarrierState(c.air) : null;
    this.course = this.heading;
    // destroyers' 5-inch guns cannot hurt armour, so they start with HE
    if (c.type === 'DD') this.loadAll('he');
  }

  /** Radar fitted and working. */
  get radar() { return this.radarSet?.status === 'ok'; }

  /** Working and total counts for a group of mounts. */
  mountCount(f: (m: Mount) => boolean) {
    const ms = this.mounts.filter(f);
    return { ok: ms.filter(m => m.status === 'ok').length, down: ms.filter(m => m.status === 'down').length, total: ms.length };
  }

  get maxSpeed() { return this.c.maxKn * KN; }
  /** Best speed the ship can make now, after machinery damage and flooding. */
  get achievableSpeed() { return this.maxSpeed * this.engines * (1 - Math.min(0.6, this.flooding * 0.05)); }

  /**
   * Order a change of shell type. Each turret still fires the round in its guns and the one already
   * in the hoist, so the change takes effect after one or two salvos.
   */
  setShellType(k: ShellType) {
    if (k === this.shellType) return;
    this.shellType = k;
    for (const tu of this.turrets) {
      if (tu.loaded === k) tu.hoist = null;
      else if (tu.loaded) tu.hoist = tu.loaded;
    }
  }

  /** Start with every turret loaded with one type (a scenario can load the wrong one). */
  loadAll(k: ShellType) {
    this.shellType = k;
    for (const tu of this.turrets) { tu.loaded = this.ammo[k] > 0 ? k : null; tu.hoist = null; }
  }

  /** What a turret loads after firing: the hoist round first, then the ordered type if any is left. */
  reloadTurret(tu: TurretState) {
    if (tu.hoist && this.ammo[tu.hoist] > 0) { tu.loaded = tu.hoist; tu.hoist = null; return; }
    tu.hoist = null;
    tu.loaded = this.ammo[this.shellType] > 0 ? this.shellType : null;
  }

  update(dt: number) {
    if (!this.alive) {
      this.speed = Math.max(0, this.speed - 0.4 * dt);
      this.sinkT += dt;
      const [dx, dz] = dir(this.heading);
      this.x += dx * this.speed * dt; this.z += dz * this.speed * dt;
      return;
    }
    let want = this.heading;
    if (this.waypoint) {
      want = bearing(this.x, this.z, this.waypoint.x, this.waypoint.z);
      if (Math.hypot(this.waypoint.x - this.x, this.waypoint.z - this.z) < 250) { this.course = want; this.waypoint = null; }
    } else if (this.course !== null) want = this.course;
    const err = wrap(want - this.heading);
    let cmd = clamp(err / (20 * DEG), -1, 1);
    if (this.rudderJam !== null) cmd = this.rudderJam;
    this.rudder += clamp(cmd - this.rudder, -0.3 * dt, 0.3 * dt);
    const maxRate = this.speed / (this.c.tacticalDiameter / 2);
    this.turnRate += (this.rudder * maxRate - this.turnRate) * Math.min(1, dt * 0.5);
    this.heading = wrap(this.heading + this.turnRate * dt);

    const target = (this.speedOrder !== null ? Math.min(this.speedOrder, this.achievableSpeed) : TELEGRAPH[this.telegraph].f * this.achievableSpeed) * (1 - 0.22 * Math.abs(this.rudder));
    this.speed += clamp(target - this.speed, -this.c.accel * 1.5 * dt, this.c.accel * dt);
    const [dx, dz] = dir(this.heading);
    this.x += dx * this.speed * dt; this.z += dz * this.speed * dt;
  }

  /** Displacement over the next T seconds at the current course and speed. */
  vxPred(T: number) { return dir(this.heading)[0] * this.speed * T; }
  vzPred(T: number) { return dir(this.heading)[1] * this.speed * T; }

  /** Visible list in radians (for rendering). */
  get listAngle() {
    const base = Math.min(0.14, this.flooding * 0.018) * this.listSide;
    return this.alive ? base : base + Math.min(0.5, this.sinkT * 0.004) * this.listSide;
  }
}
