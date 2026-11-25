import { KN, toReal } from '../config';
import { ShipClass, TurretDef } from '../data/ships';
import { bearing, clamp, DEG, dir, gauss, wrap } from '../math';

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

  constructor(private ship: Ship) {}

  assign(t: Ship | null) {
    this.target = t;
    this.salvos = 0; this.hits = 0; this.straddles = 0; this.last = null;
    if (!t) return;
    const real = toReal(Math.hypot(t.x - this.ship.x, t.z - this.ship.z));
    const s0 = this.ship.c.fc.rangeErr0 * real / Math.max(0.35, this.ship.director);
    this.er = gauss() * s0;
    this.ed = gauss() * s0 * 0.25;
    this.sig = s0;
    [this.vx, this.vz] = [0, 0];
  }

  /** Spotting: after a salvo lands the crew corrects the solution. */
  spot() {
    const t = this.target; if (!t) return;
    const real = toReal(Math.hypot(t.x - this.ship.x, t.z - this.ship.z));
    const keep = this.ship.c.fc.spotKeep + (1 - this.ship.director) * 0.3;
    const floor = 0.0035 * real * (this.ship.radar ? 0.7 : 1) / Math.max(0.35, this.ship.director);
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
  radar: boolean;
  turrets: TurretState[];
  fc: FireControl;
  holdFire = false;
  salvoWait = 0;
  /** Wake breadcrumbs. */
  hist: { x: number; z: number; h: number; t: number }[] = [];
  histT = 0;
  /** Visual enlargement currently applied (set by the renderer). */
  vs = 1;

  constructor(c: ShipClass, name: string, side: 'player' | 'enemy', x: number, z: number, headingDeg: number) {
    this.c = c; this.name = name; this.side = side; this.x = x; this.z = z; this.heading = headingDeg * DEG;
    this.hp = c.hp;
    this.radar = c.nation === 'usn';
    this.turrets = c.turrets.map(def => ({ def, rel: restAngle(def), reload: 0, alive: true, jam: 0 }));
    this.fc = new FireControl(this);
    this.course = this.heading;
  }

  get maxSpeed() { return this.c.maxKn * KN; }

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

    const floodLoss = Math.min(0.6, this.flooding * 0.05);
    const target = TELEGRAPH[this.telegraph].f * this.maxSpeed * this.engines * (1 - floodLoss) * (1 - 0.22 * Math.abs(this.rudder));
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
