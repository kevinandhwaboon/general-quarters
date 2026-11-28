import type { AircraftType } from '../data/aircraft';
import type { CarrierDef } from '../data/ships';
import type { Flight } from './air';

/** Aircraft of one type belonging to a carrier, by state. */
export interface PlaneStock {
  type: AircraftType;
  /** Fuelled and armed, ready to launch. */
  ready: number;
  /** Aboard but not ready: just landed, or waiting to be fuelled and armed. */
  hangar: number;
  /** In the air, including aircraft queued to take off. */
  airborne: number;
  lost: number;
}

/** Aircraft waiting to take off as one or more flights (a strike launches as one flight per type). */
export interface LaunchOrder { flights: Flight[]; label: string; }

/** The state of a carrier's deck and air group. */
export class CarrierState {
  stock: PlaneStock[];
  queue: LaunchOrder[] = [];
  launchT = 0;
  recoverT = 0;
  prepT = 0;
  /** Seconds until the flight deck can be used again (0: operational). */
  deckRepair = 0;
  /** Fighters to keep on combat air patrol over this carrier. */
  capTarget = 8;
  /** A torpedo hit has started aviation fuel leaking: vapour can explode (Lexington, Taihō). */
  avgasLeak = false;
  /** What the deck is doing, for the UI. */
  status = '';

  constructor(public def: CarrierDef) {
    this.stock = def.group.map(g => ({ type: g.type, ready: g.n, hangar: 0, airborne: 0, lost: 0 }));
  }

  get deckOk() { return this.deckRepair <= 0; }
  stockOf(t: AircraftType) {
    let s = this.stock.find(o => o.type === t);
    if (!s) { s = { type: t, ready: 0, hangar: 0, airborne: 0, lost: 0 }; this.stock.push(s); }
    return s;
  }
  ready(role: AircraftType['role']) { return this.stock.filter(s => s.type.role === role).reduce((a, s) => a + s.ready, 0); }
  /** Aircraft spotted for launch but not yet off the deck. */
  get queued() { return this.queue.reduce((a, o) => a + o.flights.reduce((b, f) => b + f.planned - f.n, 0), 0); }
  /** Fuelled and armed aircraft aboard, ready or spotted for launch. */
  get armedAboard() { return this.stock.reduce((a, s) => a + s.ready, 0) + this.queued; }
  /**
   * How many fuelled and armed aircraft a bomb in the hangar can set off. Aircraft spotted for
   * launch or being re-armed count fully; ready aircraft stowed in the hangar count in part. US
   * carriers drained fuel lines and stowed aircraft unarmed under attack; the Japanese carriers at
   * Midway were caught re-arming.
   */
  hazard(nation: 'usn' | 'ijn') {
    const rearming = this.prepT > 0 && this.stock.some(s => s.hangar > 0) ? 4 : 0;
    return (this.queued + rearming + 0.3 * this.stock.reduce((a, s) => a + s.ready, 0)) * (nation === 'usn' ? 0.4 : 1);
  }
  get aboard() { return this.armedAboard + this.stock.reduce((a, s) => a + s.hangar, 0); }

  /** Aircraft destroyed aboard, deck park first. Returns how many were lost. */
  destroyAboard(n: number): number {
    let left = Math.round(n);
    for (const key of ['ready', 'hangar'] as const) {
      for (const s of [...this.stock].sort(() => Math.random() - 0.5)) {
        const k = Math.min(left, s[key]);
        s[key] -= k; s.lost += k; left -= k;
        if (!left) break;
      }
      if (!left) break;
    }
    return Math.round(n) - left;
  }
}
