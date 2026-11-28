import { AIR_TIME_SCALE, toGame, toReal } from '../config';
import { bearing, DEG, gauss } from '../math';
import { AIR_SIGHT, Flight } from './air';
import { Ship } from './ship';
import type { Side, World } from './world';

/** What a contact is reported to be. Scouts often got it wrong. */
export type Reported = 'carrier' | 'battleship' | 'cruiser' | 'destroyer';
export const REPORTED_SHORT: Record<Reported, string> = { carrier: 'CV', battleship: 'BB', cruiser: 'CA', destroyer: 'DD' };

/** The last known position of one enemy ship, as this side knows it. */
export interface Contact {
  ship: Ship;
  x: number; z: number;
  heading: number;
  /** Game time of the sighting (not of the report). */
  time: number;
  type: Reported;
  /** Seen right now by our ships or aircraft close by; otherwise a report or a last-seen position. */
  exact: boolean;
}

/** Ships sight large ships at about 30 km real in daylight; destroyers at about 70% of that. */
const SHIP_SIGHT = toGame(30_000);
/** Aircraft close enough to be part of the tactical picture (game m). */
const AIR_CLOSE = toGame(15_000);
/** Ships see aircraft at about 25 km real; air-search radar at about 120 km real (above 300 m). */
const SEE_AIR = toGame(25_000);
const RADAR_AIR = toGame(120_000);

const TRUE_TYPE: Record<string, Reported> = { CV: 'carrier', BB: 'battleship', CA: 'cruiser', CL: 'cruiser', DD: 'destroyer' };
/** How scouts misreport: true type to chances of each reported type. */
const MISREPORT: Record<Reported, [Reported, number][]> = {
  carrier: [['carrier', 0.75], ['battleship', 0.15], ['cruiser', 0.1]],
  battleship: [['battleship', 0.65], ['carrier', 0.2], ['cruiser', 0.15]],
  cruiser: [['cruiser', 0.6], ['battleship', 0.2], ['destroyer', 0.2]],
  destroyer: [['destroyer', 0.55], ['cruiser', 0.45]],
};
function misreport(t: Reported): Reported {
  let r = Math.random();
  for (const [k, p] of MISREPORT[t]) { if ((r -= p) < 0) return k; }
  return t;
}

interface Pending { at: number; from: Flight; items: Contact[] }

/**
 * One side's picture of the enemy. Anything within sight of its own ships, or close to its own
 * aircraft, is known exactly and at once. Scouts further out send reports that arrive a few
 * minutes late, with the position off by several kilometres and the ship types sometimes wrong.
 */
export class Intel {
  contacts = new Map<Ship, Contact>();
  seenShips = new Set<Ship>();
  seenFlights = new Set<Flight>();
  private pending: Pending[] = [];
  private lastReport = new Map<string, number>();
  private t = 0;
  constructor(public side: Side) {}

  update(w: World, dt: number) {
    this.t += dt; if (this.t < 2) return; this.t = 0;
    const own = w.ships.filter(s => s.side === this.side && s.alive);
    const air = w.air.flights.filter(f => f.side === this.side && f.n > 0 && f.state !== 'forming');
    const enemy = w.ships.filter(s => s.side !== this.side && (s.alive || s.sinkT < 300));
    this.seenShips.clear();
    for (const e of enemy) {
      const k = e.c.type === 'DD' ? 0.7 : 1;
      if (own.some(s => Math.hypot(s.x - e.x, s.z - e.z) < SHIP_SIGHT * k) || air.some(f => Math.hypot(f.x - e.x, f.z - e.z) < AIR_CLOSE)) {
        this.seenShips.add(e);
        this.contacts.set(e, { ship: e, x: e.x, z: e.z, heading: e.heading, time: w.time, type: TRUE_TYPE[e.c.type], exact: true });
      } else { const c = this.contacts.get(e); if (c) c.exact = false; }
    }
    // scouts and strikes further out report what they see, late and not quite right
    for (const f of air) {
      if (f.mission === 'cap') continue;
      const items: Contact[] = [];
      for (const e of enemy) {
        if (!e.alive || this.seenShips.has(e) || Math.hypot(f.x - e.x, f.z - e.z) > AIR_SIGHT) continue;
        const key = `${f.id}:${e.c.id}:${e.name}`;
        if (w.time - (this.lastReport.get(key) ?? -1e9) < 900) continue;
        this.lastReport.set(key, w.time);
        const err = toGame(5000);
        items.push({ ship: e, x: e.x + gauss() * err, z: e.z + gauss() * err, heading: e.heading + gauss() * 20 * DEG, time: w.time, type: misreport(TRUE_TYPE[e.c.type]), exact: false });
      }
      // coding, transmitting and plotting the report: 5-15 minutes of real time
      if (items.length) this.pending.push({ at: w.time + (300 + Math.random() * 600) * AIR_TIME_SCALE, from: f, items });
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.at > w.time) continue;
      this.pending.splice(i, 1);
      // a scout shot down soon after sighting may not have got her report off
      if (p.from.n <= 0 && Math.random() < 0.3) continue;
      for (const c of p.items) if (!this.seenShips.has(c.ship)) this.contacts.set(c.ship, c);
      if (this.side === 'player') w.log(this.describe(w, p), 'own');
    }
    for (const [s, c] of this.contacts) if (w.time - c.time > 4 * 3600) this.contacts.delete(s);
    // aircraft: radar on our ships, eyes on our ships and aircraft
    this.seenFlights.clear();
    const radar = own.filter(s => s.c.airRadar && s.radarSet?.status !== 'destroyed');
    for (const e of w.air.flights) {
      if (e.side === this.side || e.n <= 0) continue;
      if (radar.some(s => e.alt > 300 && Math.hypot(s.x - e.x, s.z - e.z) < RADAR_AIR)
        || own.some(s => Math.hypot(s.x - e.x, s.z - e.z) < SEE_AIR)
        || air.some(f => Math.hypot(f.x - e.x, f.z - e.z) < AIR_CLOSE)) this.seenFlights.add(e);
    }
  }

  private describe(w: World, p: Pending) {
    const counts = new Map<Reported, number>();
    for (const c of p.items) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    const order: Reported[] = ['carrier', 'battleship', 'cruiser', 'destroyer'];
    const what = order.filter(k => counts.has(k)).map(k => `${counts.get(k)} ${k}${counts.get(k)! > 1 ? 's' : ''}`).join(', ');
    const ref = w.ships.find(s => s.side === this.side && s.alive && s.air) ?? w.ships.find(s => s.side === this.side && s.alive);
    const cx = p.items.reduce((a, c) => a + c.x, 0) / p.items.length, cz = p.items.reduce((a, c) => a + c.z, 0) / p.items.length;
    const where = ref ? `, ${Math.round(toReal(Math.hypot(cx - ref.x, cz - ref.z)) / 1852)} nm, bearing ${String(Math.round(((bearing(ref.x, ref.z, cx, cz) / DEG) % 360 + 360) % 360)).padStart(3, '0')}° from ${ref.name.replace(/^USS /, '')}` : '';
    return `${p.from.label} reports: ${what}${where} (sighted ${Math.round((w.time - p.items[0].time) / 60)} min ago)`;
  }
}
