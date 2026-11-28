import { toReal } from '../config';
import { bearing, DEG } from '../math';
import type { Side, World } from './world';

export interface CarrierAIOptions {
  /** Where the enemy is expected: the centre of the first search (rad). */
  searchBearing: number;
  searchArc?: number;
  searchN?: number;
  /** Fighters kept on patrol. */
  cap?: number;
  /** Distance (nm) the AI closes to before holding off. */
  keepNm?: number;
}

/**
 * A carrier admiral for either side, playing under the same fog as the player: search where the
 * enemy is expected, keep fighters overhead, strike the best carrier report as soon as there is
 * one in range, turn into the wind for flight operations and otherwise close the distance.
 */
export class CarrierAI {
  private t = 0;
  private searched = -1e9;
  private lastStrike = -1e9;
  private firstContact = -1;
  constructor(public side: Side, public opts: CarrierAIOptions) {}

  update(w: World, dt: number) {
    this.t += dt; if (this.t < 5) return; this.t = 0;
    const intel = w.intel[this.side];
    const contacts = [...intel.contacts.values()].filter(c => w.time - c.time < 5400);
    if (contacts.length && this.firstContact < 0) this.firstContact = w.time;
    const carriers = contacts.filter(c => c.type === 'carrier');
    const pool = carriers.length ? carriers : this.firstContact >= 0 && w.time - this.firstContact > 1800 ? contacts : [];
    const pick = pool.sort((a, b) => b.time - a.time)[0] ?? null;
    for (const cv of w.ships) {
      const cs = cv.air;
      if (cv.side !== this.side || !cs || !cv.alive) continue;
      cs.capTarget = this.opts.cap ?? 8;
      if (w.time - this.searched > 4 * 3600 && !cs.queue.length) {
        if (!w.air.orderSearch(cv, this.opts.searchBearing, this.opts.searchN ?? 4, this.opts.searchArc ?? 100 * DEG)) this.searched = w.time;
      }
      const striking = w.air.flights.some(f => f.home === cv && f.mission === 'strike' && f.n > 0 && f.weapon) || cs.queue.some(o => o.flights.some(f => f.mission === 'strike'));
      if (pick && !striking && w.time - this.lastStrike > 1200 && cs.ready('dive') + cs.ready('torpedo') >= 6) {
        const nm = toReal(Math.hypot(pick.x - cv.x, pick.z - cv.z)) / 1852;
        const reach = Math.max(...cs.stock.filter(s => s.type.role !== 'fighter' && s.ready > 0).map(s => s.type.radiusNm));
        // dead reckoning: where the contact should be now if she held her course at about 20 knots
        const age = w.time - pick.time, [hx, hz] = [Math.sin(pick.heading), -Math.cos(pick.heading)], v = 20 * 0.5144;
        const px = pick.x + hx * v * age, pz = pick.z + hz * v * age;
        if (nm < reach * 0.95 && w.air.orderStrike(cv, px, pz, { heading: pick.heading, kn: 20 }) !== 'No attack aircraft ready.') this.lastStrike = w.time;
      }
      // steering, for a carrier that guides her own formation or steams alone
      const f = w.formationOf(cv);
      if (f && f.guide !== cv) continue;
      const busy = cs.queue.length > 0 || w.air.flights.some(o => o.home === cv && o.state === 'holding');
      cv.waypoint = null; cv.telegraph = 4;
      if (busy) { cv.course = w.wind.from; continue; }
      const goal = pick ? bearing(cv.x, cv.z, pick.x, pick.z) : this.opts.searchBearing;
      const far = !pick || toReal(Math.hypot(pick.x - cv.x, pick.z - cv.z)) / 1852 > (this.opts.keepNm ?? 160);
      cv.course = far ? goal : w.wind.from;
    }
  }
}
