import { AIR_TIME_SCALE, KN, toGame, toReal } from '../config';
import type { AircraftType, Weapon } from '../data/aircraft';
import { bearing, clamp, DEG, dir, rnd, wrap } from '../math';
import { AirHit, resolveBomb, resolveTorpedo } from './combat';
import type { LaunchOrder } from './carrier';
import { isAA, MountKind, Ship } from './ship';
import type { Side, World } from './world';

/*
 * The air layer. Aircraft fly at real speeds over compressed distances, like ships, and their fuel
 * is counted in real-equivalent kilometres, so combat radii are historical while flights take a
 * third of the real time (docs/DESIGN.md §3). Altitudes are real metres.
 */

export type Mission = 'search' | 'strike' | 'cap';
export type FlightState = 'forming' | 'outbound' | 'search' | 'attack' | 'return' | 'holding' | 'cap' | 'intercept';

export const STATE_LABEL: Record<FlightState, string> = {
  forming: 'forming up', outbound: 'outbound', search: 'searching', attack: 'attacking', return: 'returning',
  holding: 'waiting to land', cap: 'on patrol', intercept: 'intercepting',
};

/** A strike: one flight per aircraft type, flying to the same point and attacking together. */
/** The aim point drifts along the target's expected track (dead reckoning) at vx, vz (game m/s). */
export interface StrikeGroup { id: number; label: string; flights: Flight[]; tx: number; tz: number; vx: number; vz: number; searchT: number; orbit: number; }

/** Aircraft sight ships at about 40 km real in good weather; in game metres. */
export const AIR_SIGHT = toGame(40_000);
/** Fighters engage within this distance (game m). */
const ENGAGE = 2500;
/** CAP goes after detected raids within this distance of its carrier (game m). */
const INTERCEPT_RADIUS = 30_000;
/** Effective AA ranges against aircraft (real m, slant) and kills per mount per minute of fire. */
const AA_RANGE: Record<MountKind, number> = { sec: 0, dp: 9000, haa: 8000, maa: 3500, laa: 1800 };
const AA_RATE: Record<MountKind, number> = { sec: 0, dp: 0.03, haa: 0.02, maa: 0.035, laa: 0.025 };
/** Fire-control quality of each navy's AA in 1942. */
const AA_CREW = { usn: 1, ijn: 0.8 };
const NM = 1852;

let nextFlight = 1, nextGroup = 1, nextTorp = 1;

export class Flight {
  id = nextFlight++;
  /** Aircraft in the air (planned is how many will take off). */
  n = 0;
  state: FlightState = 'forming';
  x: number; z: number;
  alt = 0;
  heading: number;
  speed = 0;
  /** Fuel left, as real-equivalent kilometres of flying. */
  fuel: number;
  route: { x: number; z: number }[] = [];
  group: StrikeGroup | null = null;
  /** Ship this flight is attacking. */
  target: Ship | null = null;
  /** Raid this CAP flight is going after. */
  intercept: Flight | null = null;
  weapon: Weapon | null;
  /** AA mounts firing at the flight recently (spoils aim). */
  flak = 0;
  /** Seconds until each aircraft releases its bomb or torpedo, once the attack has begun. */
  releases: number[] | null = null;
  results: { hits: number; misses: number; notes: Set<string> } = { hits: 0, misses: 0, notes: new Set() };
  orbit = Math.random() * Math.PI * 2;
  constructor(public side: Side, public home: Ship, public type: AircraftType, public planned: number, public mission: Mission, public label: string, weapon: Weapon | null, fuelKm: number) {
    this.x = home.x; this.z = home.z; this.heading = home.heading; this.weapon = weapon; this.fuel = fuelKm;
  }
  get fighter() { return this.type.role === 'fighter'; }
}

export interface Torpedo { id: number; side: Side; x: number; z: number; x0: number; z0: number; heading: number; speed: number; target: Ship; hit: boolean; eta: number; weapon: Weapon; from: 1 | -1; label: string; }

const rounded = (e: number) => Math.floor(e) + (Math.random() < e % 1 ? 1 : 0);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Running tallies for the balance script and the results screen. */
export interface AirStats { lost: Record<string, number>; byAA: number; byFighters: number; ditched: number; bombHits: number; bombs: number; torpHits: number; torps: number; duds: number; }
const newStats = (): AirStats => ({ lost: {}, byAA: 0, byFighters: 0, ditched: 0, bombHits: 0, bombs: 0, torpHits: 0, torps: 0, duds: 0 });

export class AirOps {
  flights: Flight[] = [];
  torpedoes: Torpedo[] = [];
  stats: Record<Side, AirStats> = { player: newStats(), enemy: newStats() };
  private tick = 0;
  constructor(private w: World) {}

  carriers(side?: Side) { return this.w.ships.filter(s => s.air && (!side || s.side === side)); }

  /* ---------------- orders ---------------- */

  /**
   * Search: single aircraft fly out along evenly spaced bearings across the arc to their search
   * radius, cross over to the next bearing and come home.
   */
  orderSearch(cv: Ship, centre: number, n: number, arc = 90 * DEG): string | null {
    const cs = cv.air; if (!cs || !cv.alive) return 'Not an operational carrier.';
    const scouts = cs.stock.filter(s => s.type.searchNm && s.ready > 0).sort((a, b) => b.ready - a.ready)[0];
    if (!scouts) return 'No search aircraft ready.';
    const k = Math.min(n, scouts.ready), t = scouts.type, R = toGame(t.searchNm! * NM), cross = arc / k * 0.8;
    const flights: Flight[] = [];
    for (let i = 0; i < k; i++) {
      const b = centre - arc / 2 + arc * (i + 0.5) / k;
      const f = new Flight(cv.side, cv, t, 1, 'search', `Search ${Math.round(((b / DEG) % 360 + 360) % 360).toString().padStart(3, '0')}°`, t.searchWeapon ?? null, (2 + cross) * t.searchNm! * NM / 1000 * 1.4);
      const [ax, az] = dir(b), [bx, bz] = dir(b + cross);
      f.route = [{ x: cv.x + ax * R, z: cv.z + az * R }, { x: cv.x + bx * R, z: cv.z + bz * R }];
      flights.push(f);
    }
    scouts.ready -= k; scouts.airborne += k;
    cs.queue.push({ flights, label: `search, ${k} ${t.short}` });
    return null;
  }

  /**
   * Strike: every ready attack aircraft that can reach the point, escorted by the fighters not
   * needed for CAP. Each type flies as its own flight, but the group stays together.
   */
  orderStrike(cv: Ship, tx: number, tz: number, track?: { heading: number; kn: number }): string | null {
    const cs = cv.air; if (!cs || !cv.alive) return 'Not an operational carrier.';
    const nm = toReal(Math.hypot(tx - cv.x, tz - cv.z)) / NM;
    const attack = cs.stock.filter(s => s.type.role !== 'fighter' && s.ready > 0);
    if (!attack.length) return 'No attack aircraft ready.';
    const inRange = attack.filter(s => s.type.radiusNm >= nm);
    if (!inRange.length) return `Target is ${Math.round(nm)} nm away; the longest-ranged attack aircraft reach ${Math.max(...attack.map(s => s.type.radiusNm))} nm.`;
    const capAir = this.capStrength(cv);
    const [vx, vz] = track ? dir(track.heading).map(c => c * track.kn * KN) : [0, 0];
    const group: StrikeGroup = { id: nextGroup++, label: `Strike ${nextGroup - 1}`, flights: [], tx, tz, vx, vz, searchT: 0, orbit: 0 };
    const add = (s: typeof attack[0], n: number) => {
      const f = new Flight(cv.side, cv, s.type, n, 'strike', `${group.label} · ${s.type.short}`, s.type.weapon, 2 * s.type.radiusNm * NM / 1000 * 1.15);
      f.group = group; group.flights.push(f);
      s.ready -= n; s.airborne += n;
    };
    for (const role of ['dive', 'torpedo'] as const) for (const s of inRange) if (s.type.role === role) add(s, s.ready);
    for (const s of cs.stock.filter(o => o.type.role === 'fighter' && o.type.radiusNm >= nm)) {
      const escorts = Math.max(0, s.ready - Math.max(0, cs.capTarget - capAir));
      if (escorts > 0) add(s, escorts);
    }
    cs.queue.push({ flights: group.flights, label: group.label });
    const short = [...attack.filter(s => !inRange.includes(s)), ...cs.stock.filter(s => s.type.role === 'fighter' && s.ready > 0 && s.type.radiusNm < nm)];
    return short.length ? `${short.map(s => s.type.short).join(', ')} stay aboard: the target is beyond their ${short.map(s => s.type.radiusNm).join('/')} nm radius.` : null;
  }

  /** Send a flight (and the rest of its strike) home. */
  recall(f: Flight) {
    for (const o of f.group ? f.group.flights : [f]) if (o.n > 0 || o.state === 'forming') { o.state = 'return'; o.releases = null; o.route = []; }
  }

  /** Fighters on patrol or about to launch for patrol over a carrier. */
  capStrength(cv: Ship) {
    const air = this.flights.filter(f => f.home === cv && f.mission === 'cap' && (f.state === 'cap' || f.state === 'intercept' || f.state === 'forming')).reduce((a, f) => a + f.n, 0);
    const queued = cv.air!.queue.reduce((a, o) => a + o.flights.filter(f => f.mission === 'cap').reduce((b, f) => b + f.planned - f.n, 0), 0);
    return air + queued;
  }

  /* ---------------- simulation ---------------- */

  step(dt: number) {
    for (const cv of this.carriers()) this.deck(cv, dt);
    for (const f of this.flights) this.move(f, dt);
    this.tick += dt;
    while (this.tick >= 1) { this.tick -= 1; this.second(); }
    this.attacks(dt);
    this.runTorpedoes(dt);
    this.flights = this.flights.filter(f => f.n > 0);
  }

  /** Deck operations: repair, launch, recovery, arming, and keeping fighters on patrol. */
  private deck(cv: Ship, dt: number) {
    const cs = cv.air!;
    if (!cv.alive) {
      if (cs.aboard) { cs.queue = []; cs.destroyAboard(cs.aboard); }
      cs.status = 'sinking';
      return;
    }
    cs.deckRepair = Math.max(0, cs.deckRepair - dt * (cv.fires > 0 ? 0.5 : 1));
    if (cs.avgasLeak && Math.random() < dt / (3600 * AIR_TIME_SCALE) * 0.5) {
      cs.avgasLeak = false; cv.fires += 3; cv.hp -= 25; cs.deckRepair += 3600 * AIR_TIME_SCALE;
      this.w.log(`${cv.name}: aviation fuel vapour explodes below decks`, 'crit');
      this.w.events.push({ type: 'magazine', ship: cv });
    }
    const wod = this.w.windOverDeck(cv);
    const deckOk = cs.deckOk && cv.fires < 3;
    const holding = this.flights.filter(f => f.home === cv && f.state === 'holding' && f.n > 0);
    const recovering = holding.length > 0 && (!cs.queue.length || holding.some(f => f.fuel < 150));
    if (deckOk && wod.ok) {
      if (recovering) {
        cs.recoverT -= dt;
        if (cs.recoverT <= 0) { this.land(holding.sort((a, b) => a.fuel - b.fuel)[0], cv); cs.recoverT = cs.def.recoverS * AIR_TIME_SCALE; }
      } else if (cs.queue.length) {
        cs.launchT -= dt;
        if (cs.launchT <= 0) { this.launchOne(cv); cs.launchT = cs.def.launchS * AIR_TIME_SCALE; }
      }
    }
    const busy = recovering || cs.queue.length > 0;
    cs.status = !cs.deckOk ? `flight deck under repair, ${Math.ceil(cs.deckRepair / 60)} min`
      : cv.fires >= 3 ? 'fires on the hangar deck'
      : busy && !wod.ok ? 'waiting to turn into the wind'
      : recovering ? `recovering aircraft (${holding.reduce((a, f) => a + f.n, 0)} waiting)`
      : cs.queue.length ? `launching ${cs.queue[0].label}` : 'ready';
    // fuel and arm aircraft in the hangar, one at a time; fires stop the work
    if (cs.deckOk && cv.fires === 0) {
      cs.prepT -= dt;
      if (cs.prepT <= 0) {
        const s = [...cs.stock].sort((a, b) => (a.type.role === 'fighter' ? 0 : 1) - (b.type.role === 'fighter' ? 0 : 1)).find(o => o.hangar > 0);
        if (s) { s.hangar--; s.ready++; }
        cs.prepT = cs.def.prepS * AIR_TIME_SCALE;
      }
    }
    // keep the combat air patrol up to strength
    // replacements go up in sections of four, not one at a time into the fight
    const short = cs.capTarget - this.capStrength(cv);
    if (short >= Math.min(4, cs.capTarget) && !cs.queue.some(o => o.flights.some(f => f.mission === 'cap'))) {
      const s = cs.stock.filter(o => o.type.role === 'fighter' && o.ready > 0).sort((a, b) => b.ready - a.ready)[0];
      if (s) {
        const n = Math.min(short, s.ready);
        const f = new Flight(cv.side, cv, s.type, n, 'cap', `CAP · ${s.type.short}`, null, 2 * s.type.radiusNm * NM / 1000 * 1.2);
        s.ready -= n; s.airborne += n;
        cs.queue.unshift({ flights: [f], label: `CAP, ${n} ${s.type.short}` });
      }
    }
  }

  private launchOne(cv: Ship) {
    const cs = cv.air!, order: LaunchOrder = cs.queue[0];
    const f = order.flights.find(o => o.n < o.planned);
    if (f) {
      f.n++;
      if (f.n === 1) { f.x = cv.x; f.z = cv.z; f.alt = 50; f.state = 'forming'; this.flights.push(f); }
    }
    if (order.flights.every(o => o.n >= o.planned)) {
      cs.queue.shift();
      for (const o of order.flights) o.state = o.mission === 'cap' ? 'cap' : 'outbound';
      if (cv.side === 'player' && order.flights[0].mission !== 'cap') this.w.log(`${cv.name}: ${order.label} airborne and departing`, 'own');
    }
  }

  private land(f: Flight, cv: Ship) {
    f.n--;
    const s = cv.air!.stockOf(f.type);
    s.airborne--; s.hangar++;
  }

  /** Turn a flight toward a point at a speed, and climb or descend toward an altitude. */
  private fly(f: Flight, tx: number, tz: number, spd: number, alt: number, dt: number) {
    const want = bearing(f.x, f.z, tx, tz), turn = wrap(want - f.heading);
    f.heading = wrap(f.heading + clamp(turn, -0.5 * dt, 0.5 * dt));
    const [dx, dz] = dir(f.heading);
    f.speed = spd;
    f.x += dx * spd * dt; f.z += dz * spd * dt;
    // climb about 9 m/s and descend 25 m/s (90 in a dive) in real time, on the compressed clock
    const k = dt / AIR_TIME_SCALE;
    f.alt += clamp(alt - f.alt, -(f.releases && f.type.role === 'dive' ? 90 : 25) * k, 9 * k);
    f.fuel -= toReal(spd * dt) / 1000;
  }

  private orbitPoint(f: Flight, cx: number, cz: number, r: number, spd: number, dt: number) {
    f.orbit += spd * dt / r;
    return { x: cx + Math.cos(f.orbit + 0.4) * r, z: cz + Math.sin(f.orbit + 0.4) * r };
  }

  private groupSpeed(g: StrikeGroup) { return Math.min(...g.flights.filter(o => o.n > 0).map(o => o.type.cruiseKn)) * KN; }

  private move(f: Flight, dt: number) {
    if (f.n <= 0) return;
    const t = f.type, cruise = t.cruiseKn * KN, home = f.home;
    let p: { x: number; z: number }, spd = cruise, alt = t.altM;
    switch (f.state) {
      case 'forming': p = this.orbitPoint(f, home.x, home.z, 1500, cruise, dt); alt = 800; break;
      case 'outbound':
        if (f.mission === 'search') {
          p = f.route[0] ?? home;
          if (f.route.length && dist(f, p) < 800) f.route.shift();
          if (!f.route.length) f.state = 'return';
        } else if (f.group) { p = { x: f.group.tx, z: f.group.tz }; spd = this.groupSpeed(f.group); }
        else p = home;
        break;
      case 'search': {
        const g = f.group!, r = 4000 + g.searchT * 8;
        p = { x: g.tx + Math.cos(g.orbit) * r, z: g.tz + Math.sin(g.orbit) * r }; spd = this.groupSpeed(g);
        break;
      }
      case 'attack': {
        const T = f.target;
        if (!T) { p = home; break; }
        if (f.fighter && f.group) {
          // escorts stay with the bombers they protect
          const b = f.group.flights.find(o => !o.fighter && o.n > 0 && o.state === 'attack') ?? f.group.flights.find(o => !o.fighter && o.n > 0);
          p = b ? { x: b.x, z: b.z } : T; alt = b ? b.alt + 400 : alt;
          spd = Math.min(t.maxKn * KN * 0.8, b ? Math.max(b.speed, cruise) : cruise);
          break;
        }
        const d = dist(f, T), lead = d / (t.maxKn * KN * 0.8);
        const [hx, hz] = dir(T.heading);
        p = { x: T.x + hx * T.speed * lead * 0.6, z: T.z + hz * T.speed * lead * 0.6 };
        spd = d < 8000 ? t.maxKn * KN * 0.8 : cruise;
        if (t.role === 'torpedo' && d < 9000) alt = 50;
        if (t.role === 'dive' && f.releases) alt = 400;
        break;
      }
      case 'return': p = home; if (dist(f, home) < 2500) f.state = 'holding'; break;
      case 'holding': p = this.orbitPoint(f, home.x, home.z, 2200, cruise, dt); alt = 900; break;
      case 'cap': p = this.orbitPoint(f, home.x, home.z, 4000, cruise, dt); alt = f.side === 'player' ? 4200 : 3000; break;
      case 'intercept': {
        const e = f.intercept!;
        const lead = dist(f, e) / (t.maxKn * KN);
        const [hx, hz] = dir(e.heading);
        p = { x: e.x + hx * e.speed * lead * 0.5, z: e.z + hz * e.speed * lead * 0.5 };
        spd = t.maxKn * KN * 0.9; alt = e.alt + 300;
        break;
      }
    }
    this.fly(f, p.x, p.z, spd, alt, dt);
    if (f.fuel <= 0) {
      this.stats[f.side].ditched += f.n;
      this.remove(f, f.n);
      if (f.side === 'player') this.w.log(`${f.label}: out of fuel, aircraft ditch`, 'crit');
    }
  }

  /** Aircraft lost (shot down or ditched): the home carrier's books are kept straight. */
  private remove(f: Flight, k: number) {
    k = Math.min(k, f.n); if (k <= 0) return;
    f.n -= k;
    const s = f.home.air?.stockOf(f.type);
    if (s) { s.airborne -= k; s.lost += k; }
    this.stats[f.side].lost[f.type.id] = (this.stats[f.side].lost[f.type.id] ?? 0) + k;
    if (f.releases && f.releases.length > f.n) f.releases.length = f.n;
  }

  private shootDown(f: Flight, k: number, cause: 'aa' | 'air') {
    k = Math.min(k, f.n); if (k <= 0) return;
    this.remove(f, k);
    this.stats[f.side][cause === 'aa' ? 'byAA' : 'byFighters'] += k;
    this.w.events.push({ type: 'planeDown', x: f.x, z: f.z, alt: f.alt, side: f.side, n: k });
  }

  /** Once a second: fuel checks, strikes finding their targets, CAP, air combat and AA. */
  private second() {
    const live = this.flights.filter(f => f.n > 0);
    for (const f of live) this.fuelCheck(f);
    const groups = new Set(live.map(f => f.group).filter((g): g is StrikeGroup => !!g));
    for (const g of groups) this.strikeLogic(g);
    this.capLogic(live);
    this.airCombat(live);
    this.antiAircraft(live);
    for (const f of live) f.flak *= 0.5;
  }

  private fuelCheck(f: Flight) {
    // carrier sunk or her deck out of action for longer than the fuel lasts: divert
    if ((f.state === 'return' || f.state === 'holding') && (!f.home.alive || f.home.air!.deckRepair > f.fuel / (f.type.cruiseKn * KN / 0.3 / 1000))) {
      const alt = this.carriers(f.side).filter(c => c.alive && c !== f.home && c.air!.deckOk && toReal(dist(f, c)) / 1000 < f.fuel)
        .sort((a, b) => dist(f, a) - dist(f, b))[0];
      if (alt) {
        const a = f.home.air!.stockOf(f.type), b = alt.air!.stockOf(f.type);
        a.airborne -= f.n; b.airborne += f.n; f.home = alt; f.state = 'return';
        if (f.side === 'player') this.w.log(`${f.label} diverts to ${alt.name}`, 'own');
      }
      return;
    }
    if (!['outbound', 'search', 'cap', 'intercept', 'attack'].includes(f.state) || f.releases) return;
    // the carrier keeps moving while her aircraft are away: keep a generous reserve
    if (f.fuel < toReal(dist(f, f.home)) / 1000 * 1.25 + 60) {
      if (f.side === 'player' && f.mission === 'strike') this.w.log(`${f.label}: fuel low, returning`, 'own');
      f.state = 'return'; f.intercept = null;
    }
  }

  private static PRIORITY: Record<string, number> = { CV: 0, BB: 1, CA: 2, CL: 3, DD: 4 };

  /** A strike looks for ships around its target point and attacks the most valuable one it sees. */
  private strikeLogic(g: StrikeGroup) {
    const lead = g.flights.find(f => f.n > 0); if (!lead) return;
    if (lead.state === 'outbound' && dist(lead, { x: g.tx, z: g.tz }) < 3000) for (const f of g.flights) if (f.state === 'outbound') f.state = 'search';
    // the aim point moves along the target's expected track while the strike is on its way
    if (lead.state === 'outbound' || lead.state === 'search' || lead.state === 'forming') { g.tx += g.vx; g.tz += g.vz; }
    if (lead.state === 'search') { g.searchT += 1; g.orbit += this.groupSpeed(g) / (4000 + g.searchT * 8); }
    if (lead.state !== 'outbound' && lead.state !== 'search') return;
    const seen = this.w.ships.filter(s => s.side !== g.flights[0].side && s.alive && dist(s, lead) < AIR_SIGHT)
      .sort((a, b) => AirOps.PRIORITY[a.c.type] - AirOps.PRIORITY[b.c.type] || (a.air?.deckRepair ?? 0) - (b.air?.deckRepair ?? 0) || dist(a, lead) - dist(b, lead));
    const best = seen[0];
    const worth = best && (best.c.type === 'CV' || best.c.type === 'BB' || (lead.state === 'search' && g.searchT > 300));
    if (!worth) {
      if (lead.state === 'search' && g.searchT > 1500) {
        for (const f of g.flights) if (f.n > 0) f.state = 'return';
        if (lead.side === 'player') this.w.log(`${g.label} finds nothing at the target and turns back`, 'own');
      }
      return;
    }
    const carriers = seen.filter(s => s.c.type === 'CV');
    for (const f of [...g.flights]) {
      if (f.n <= 0) continue;
      f.state = 'attack'; f.target = best;
      // with two carriers in sight and enough dive bombers, split them (Midway)
      if (f.type.role === 'dive' && carriers.length > 1 && f.n >= 6) {
        const half = Math.floor(f.n / 2), o = new Flight(f.side, f.home, f.type, half, f.mission, `${f.label} (2)`, f.weapon, f.fuel);
        Object.assign(o, { n: half, state: 'attack', x: f.x, z: f.z, alt: f.alt, heading: f.heading, group: g, target: carriers[1] });
        f.n -= half; f.planned -= half; g.flights.push(o); this.flights.push(o);
      }
    }
    if (lead.side === 'player') this.w.log(`${g.label} sights the enemy and attacks ${best.name}${carriers.length > 1 ? ` and ${carriers[1].name}` : ''}`, 'hit');
  }

  /** CAP goes after detected raids near its carrier, bombers first. */
  private capLogic(live: Flight[]) {
    for (const f of live) {
      if (f.mission !== 'cap' || (f.state !== 'cap' && f.state !== 'intercept')) continue;
      const intel = this.w.intel[f.side];
      // armed raids (and their escorts) anywhere in reach; spent ones only close to the carrier
      const armed = (e: Flight) => !!e.weapon || (e.fighter && !!e.group?.flights.some(o => o.weapon && o.n > 0));
      const threats = live.filter(e => e.side !== f.side && intel.seenFlights.has(e) && dist(e, f.home) < (armed(e) ? INTERCEPT_RADIUS : 8000))
        .sort((a, b) => (a.fighter ? 1 : 0) - (b.fighter ? 1 : 0) || dist(a, f.home) - dist(b, f.home));
      if (threats.length) { f.state = 'intercept'; f.intercept = threats[0]; }
      else if (f.state === 'intercept') { f.state = 'cap'; f.intercept = null; }
    }
  }

  /**
   * Fighters within reach and at a usable height fight. Escorts go for fighters that threaten their
   * strike; CAP goes for bombers but loses effect while escorts are on it; rear gunners fire back.
   */
  private airCombat(live: Flight[]) {
    const pairs = new Map<Flight, Flight>();
    for (const a of live) {
      if (!a.fighter || a.state === 'forming') continue;
      // escorts stay with their bombers; patrols can dive on raids well below them
      const below = a.mission === 'strike' ? 1500 : 4500;
      const near = live.filter(b => b.side !== a.side && dist(a, b) < ENGAGE && a.alt >= b.alt - 700 && a.alt - b.alt < below)
        .sort((p, q) => dist(a, p) - dist(a, q));
      if (!near.length) continue;
      const t = a.mission === 'strike' ? near.find(b => b.fighter)
        : (a.intercept && near.includes(a.intercept) ? a.intercept : near.find(b => !b.fighter) ?? near[0]);
      if (t) pairs.set(a, t);
    }
    const kills = new Map<Flight, number>();
    const add = (f: Flight, k: number) => kills.set(f, (kills.get(f) ?? 0) + k);
    // rates are per real minute; aircraft cross the compressed map faster, so fights are shorter in game time
    const perS = 1 / (60 * AIR_TIME_SCALE);
    for (const [a, t] of pairs) {
      const on = [...pairs].filter(([b, x]) => x === a && b.fighter), onA = on.reduce((s, [b]) => s + b.n, 0);
      const share = t.fighter ? 1 : a.n / (a.n + 2 * onA);
      add(t, a.n * share * (t.fighter ? a.type.air.vsFighter : a.type.air.vsBomber) * this.w.skill[a.side] * perS);
      // the part of a CAP flight tied up by escorts fights them instead
      for (const [b] of on) if (!t.fighter) add(b, a.n * (1 - share) * a.type.air.vsFighter * this.w.skill[a.side] * perS * b.n / onA);
      if (!t.fighter) add(a, t.n * t.type.air.gunner * this.w.skill[t.side] * perS);
    }
    for (const [f, e] of kills) this.shootDown(f, rounded(e), 'air');
  }

  /** Every working AA mount fires at the nearest enemy flight within its reach. */
  private antiAircraft(live: Flight[]) {
    for (const s of this.w.ships) {
      if (!s.alive) continue;
      const cands = live.filter(f => f.side !== s.side).map(f => ({ f, h: toReal(dist(f, s)), slant: 0 }))
        .map(c => ({ ...c, slant: Math.hypot(c.h, c.f.alt) })).filter(c => c.slant < 9000).sort((a, b) => a.slant - b.slant);
      if (!cands.length) continue;
      const exp = new Map<Flight, number>();
      let heavy = 0;
      for (const m of s.mounts) {
        if (m.status !== 'ok' || !isAA(m)) continue;
        const c = cands.find(c => {
          if (c.slant > AA_RANGE[m.kind]) return false;
          const rel = wrap(bearing(s.x, s.z, c.f.x, c.f.z) - s.heading), a = Math.abs(rel) / DEG;
          return c.h < 1500 || a < 30 || a > 150 || Math.sign(rel) === m.side;
        });
        if (!c) continue;
        const attacking = c.f.state === 'attack' && c.f.target === s ? 1.3 : 1;
        exp.set(c.f, (exp.get(c.f) ?? 0) + AA_RATE[m.kind] * AA_CREW[s.c.nation] * attacking / (60 * AIR_TIME_SCALE));
        c.f.flak += 1;
        if (m.kind === 'dp' || m.kind === 'haa') heavy++;
      }
      for (const [f, e] of exp) {
        this.shootDown(f, rounded(e), 'aa');
        if (heavy && Math.random() < 0.6) this.w.events.push({ type: 'flak', x: f.x, z: f.z, alt: f.alt, n: Math.min(3, Math.ceil(heavy / 4)) });
      }
    }
  }

  private hitChance(f: Flight, t: Ship) {
    const size = clamp(Math.sqrt(t.c.L / 240) * Math.pow(t.c.B / 27, 0.4), 0.3, 1.2);
    const maxRate = Math.max(1e-3, t.speed / (t.c.tacticalDiameter / 2));
    const turn = clamp(Math.abs(t.turnRate) / maxRate, 0, 1);
    let p = f.type.attack * this.w.skill[f.side] * size / (1 + 0.004 * f.flak);
    if (f.type.role === 'dive') p *= 1 - 0.3 * turn;
    else p *= (1 - 0.45 * turn) * (1 - 0.25 * Math.min(1, t.speed / ((f.weapon?.speedKn ?? 40) * KN)));
    return p;
  }

  /** Dive bombers release over about 40 seconds once over the target; torpedo bombers drop low and close. */
  private attacks(dt: number) {
    for (const f of this.flights) {
      if (f.state !== 'attack' || f.n <= 0) continue;
      const g = f.group;
      if (f.fighter) {
        if (!g || !g.flights.some(o => !o.fighter && o.n > 0 && o.weapon && (o.state === 'attack' || o.state === 'outbound' || o.state === 'search'))) f.state = 'return';
        continue;
      }
      let T = f.target;
      if (!T || !T.alive) {
        // the target has gone down: take the next ship in sight, or go home
        T = this.w.ships.filter(s => s.side !== f.side && s.alive && dist(s, f) < AIR_SIGHT).sort((a, b) => AirOps.PRIORITY[a.c.type] - AirOps.PRIORITY[b.c.type] || dist(a, f) - dist(b, f))[0] ?? null;
        f.target = T; f.releases = null;
        if (!T) { f.state = 'return'; continue; }
      }
      const d = dist(f, T);
      if (!f.releases && f.weapon) {
        if (f.type.role === 'dive' && d < 2200) f.releases = Array.from({ length: f.n }, () => rnd(3, 40));
        else if (f.type.role === 'torpedo' && d < 900 && f.alt < 250) f.releases = Array.from({ length: f.n }, () => rnd(0, 18));
      }
      if (!f.releases) continue;
      for (let i = f.releases.length - 1; i >= 0; i--) {
        f.releases[i] -= dt;
        if (f.releases[i] > 0) continue;
        f.releases.splice(i, 1);
        this.release(f, T);
      }
      if (!f.releases.length) {
        f.releases = null; f.weapon = null; f.state = 'return';
        if (f.type.role === 'dive') this.reportAttack(f, T);
      }
    }
  }

  private release(f: Flight, t: Ship) {
    const w = f.weapon!, p = this.hitChance(f, t), st = this.stats[f.side];
    if (w.kind === 'bomb') {
      st.bombs++;
      if (Math.random() < p) {
        st.bombHits++;
        const r = resolveBomb(t, w);
        f.results.hits++; r.notes.forEach(n => { const m = /^(\d+) aircraft destroyed$/.exec(n); f.results.notes.add(m ? `${m[1]} aircraft destroyed#${f.results.hits}` : n); });
        this.w.events.push({ type: 'bomb', ship: t, hit: r, x: t.x, z: t.z });
        this.afterHit(t);
      } else {
        f.results.misses++;
        const a = Math.random() * 2 * Math.PI, r = rnd(25, 110);
        this.w.events.push({ type: 'bomb', ship: t, hit: null, x: t.x + Math.cos(a) * r, z: t.z + Math.sin(a) * r });
      }
      return;
    }
    // torpedo: aimed ahead of the target; whether it will hit is decided at the drop
    st.torps++;
    const ts = (w.speedKn ?? 40) * KN, d = dist(f, t), run = d / ts, [hx, hz] = dir(t.heading);
    const ax = t.x + hx * t.speed * run, az = t.z + hz * t.speed * run;
    const from: 1 | -1 = wrap(bearing(t.x, t.z, f.x, f.z) - t.heading) > 0 ? 1 : -1;
    this.torpedoes.push({ id: nextTorp++, side: f.side, x: f.x, z: f.z, x0: f.x, z0: f.z, heading: bearing(f.x, f.z, ax, az), speed: ts, target: t, hit: Math.random() < p, eta: Math.hypot(ax - f.x, az - f.z) / ts, weapon: w, from, label: f.label });
  }

  private reportAttack(f: Flight, t: Ship) {
    const r = f.results, own = f.side === 'player';
    if (!own && !this.w.visibleTo('player', t) && t.side !== 'player') return;
    const what = `${f.label} attacks ${t.name}: ${r.hits} hit${r.hits === 1 ? '' : 's'} of ${r.hits + r.misses}`;
    // add up the aircraft destroyed aboard rather than listing each hit's count
    let planes = 0;
    const notes = [...r.notes].filter(n => { const m = /^(\d+) aircraft destroyed(#\d+)?$/.exec(n); if (m) { planes += +m[1]; return false; } return true; });
    if (planes) notes.push(`${planes} aircraft destroyed aboard`);
    this.w.log(`${what}${notes.length ? ' · ' + notes.join(', ') : ''}`, r.hits ? (own ? 'hit' : 'crit') : '');
    f.results = { hits: 0, misses: 0, notes: new Set() };
  }

  private afterHit(t: Ship) {
    if (t.alive && t.hp <= 0) { t.alive = false; t.hp = 0; this.w.log(`${t.name} is sinking`, 'crit'); }
  }

  private runTorpedoes(dt: number) {
    for (let i = this.torpedoes.length - 1; i >= 0; i--) {
      const tp = this.torpedoes[i], [dx, dz] = dir(tp.heading);
      tp.x += dx * tp.speed * dt; tp.z += dz * tp.speed * dt; tp.eta -= dt;
      if (tp.eta > 0) continue;
      if (tp.hit && tp.target.alive && tp.eta > -dt * 1.5) {
        const st = this.stats[tp.side];
        if (Math.random() < (tp.weapon.dud ?? 0)) {
          st.duds++;
          if (tp.side === 'player' || tp.target.side === 'player') this.w.log(`Torpedo strikes ${tp.target.name} but fails to explode`, '');
        } else {
          st.torpHits++;
          const r: AirHit = resolveTorpedo(tp.target, tp.weapon, tp.from);
          this.w.events.push({ type: 'torpHit', ship: tp.target, hit: r });
          const own = tp.side === 'player';
          if (own || tp.target.side === 'player' || this.w.visibleTo('player', tp.target)) this.w.log(`${tp.label}: torpedo hits ${tp.target.name} · ${r.notes.join(', ')}`, own ? 'hit' : 'crit');
          this.afterHit(tp.target);
        }
        this.torpedoes.splice(i, 1);
      } else if (tp.eta < -40) this.torpedoes.splice(i, 1);
    }
  }
}
