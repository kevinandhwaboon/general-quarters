import { KN } from '../config';
import { bearing, clamp, DEG, dir, wrap } from '../math';
import { Ship, TELEGRAPH } from './ship';

export type FormationType = 'column' | 'bearing' | 'circle';
export type TurnMode = 'succession' | 'together';

export const FORMATION_LABEL: Record<FormationType, string> = { column: 'Column', bearing: 'Line of bearing', circle: 'Circle' };

/**
 * Interval between ships in a line, in ship lengths bow to bow. Spacing inside a formation is
 * half-compressed (docs/DESIGN.md §2): real 500-1,000 yd intervals would put ships almost touching
 * at RANGE_SCALE, so ships keep about 2.5 lengths, which the UI shows as standard distance.
 */
export const INTERVAL_L = 2.5;
/** Screen distance from the guide in game metres: about 4,000 yd real, compressed like range. */
export const SCREEN_DIST = 1100;
/** Inner ring of a circular disposition, in intervals from the guide. */
const INNER_RING = 1.2;
/** Speed held in reserve so that ships can catch up with their stations. */
const RESERVE = 1.5 * KN;
/** Further than this many intervals from station, a ship steams straight for it at full speed. */
const CLOSING = 2.5;
/** Track breadcrumb spacing (m). */
const CRUMB = 15;

/** A station as an offset from the guide: f forward, r to starboard, in the formation's axis frame. */
interface Offset { f: number; r: number }

/**
 * A group of ships manoeuvring together. The guide (line[0]) takes the player's helm and speed
 * orders; every other ship keeps station on it by adjusting course and speed. Destroyers in the
 * screen are stationed ahead of (column, line of bearing) or around (circle) the guide.
 */
export class Formation {
  type: FormationType;
  /** Heavy ships in order; line[0] is the guide. */
  line: Ship[];
  /** Escorts, stationed and fighting on their own. */
  screen: Ship[];
  /** Reference bearing (rad) for stations. Follows the guide only for a column turning in succession. */
  axis: number;
  turn: TurnMode = 'succession';
  /** Line of bearing: direction the line extends from the guide, relative to the axis (rad). */
  lineBearing = 135 * DEG;
  /** The guide's recent track, newest first (for turns in succession). */
  private track: { x: number; z: number }[] = [];

  constructor(type: FormationType, line: Ship[], screen: Ship[]) {
    this.type = type; this.line = line; this.screen = screen;
    this.axis = line[0].heading;
    this.resetTrack();
  }

  get guide() { return this.line[0]; }
  get members() { return [...this.line, ...this.screen]; }
  has(s: Ship) { return this.line.includes(s) || this.screen.includes(s); }
  /** Bow-to-bow interval for the line, from its longest ship. */
  get interval() { return INTERVAL_L * Math.max(...this.line.map(s => s.c.L)); }
  /** Uses the guide's track, so ships turn where the guide turned. */
  get followsTrack() { return this.type === 'column' && this.turn === 'succession'; }

  /** Fastest speed the formation can hold: its slowest ship, less a reserve for station-keeping. */
  get maxSpeed() {
    const others = this.members.filter(s => s !== this.guide).map(s => s.achievableSpeed - RESERVE);
    return Math.max(0, Math.min(this.guide.achievableSpeed, ...others));
  }

  /** Re-form on the guide's present course: stations swing to the new axis, the track starts afresh. */
  reform() { this.axis = this.guide.heading; this.resetTrack(); }

  setTurn(m: TurnMode) { if (m !== this.turn) { this.turn = m; this.reform(); } }

  private resetTrack() {
    const g = this.guide, [fx, fz] = dir(g.heading), len = this.interval * (this.line.length + 1);
    this.track = [];
    for (let s = 0; s <= len; s += CRUMB) this.track.push({ x: g.x - fx * s, z: g.z - fz * s });
  }

  private offset(s: Ship): Offset {
    const k = this.line.indexOf(s), I = this.interval;
    if (k >= 0) {
      if (this.type === 'column') return { f: -k * I, r: 0 };
      if (this.type === 'bearing') return { f: k * I * Math.cos(this.lineBearing), r: k * I * Math.sin(this.lineBearing) };
      const n = this.line.length - 1, a = (90 + 360 * (k - 1) / n) * DEG;
      return { f: Math.cos(a) * I * INNER_RING, r: Math.sin(a) * I * INNER_RING };
    }
    const j = this.screen.indexOf(s), m = this.screen.length;
    // circle: evenly round the guide; otherwise an arc ahead, 60 degrees either side of the axis
    const a = this.type === 'circle' ? 360 * j / m * DEG : (m === 1 ? 0 : -60 + 120 * j / (m - 1)) * DEG;
    return { f: Math.cos(a) * SCREEN_DIST, r: Math.sin(a) * SCREEN_DIST };
  }

  /** Where a member should be now, and the heading it should hold there. */
  station(s: Ship): { x: number; z: number; h: number } {
    const g = this.guide, k = this.line.indexOf(s);
    if (k > 0 && this.followsTrack) return this.alongTrack(k * this.interval);
    const o = this.offset(s), [fx, fz] = dir(this.axis);
    // starboard of a bearing b is dir(b + 90°) = (-fz, fx)
    return { x: g.x + fx * o.f - fz * o.r, z: g.z + fz * o.f + fx * o.r, h: g.heading };
  }

  /** The point on the guide's track a given distance astern of the guide, and the track's heading there. */
  private alongTrack(dist: number) {
    let px = this.guide.x, pz = this.guide.z, left = dist;
    for (const q of this.track) {
      const d = Math.hypot(q.x - px, q.z - pz);
      if (d >= left && d > 0) { const f = left / d; return { x: px + (q.x - px) * f, z: pz + (q.z - pz) * f, h: bearing(q.x, q.z, px, pz) }; }
      left -= d; px = q.x; pz = q.z;
    }
    // past the end of the recorded track: extend it straight
    const n = this.track.length, a = this.track[Math.max(0, n - 2)] ?? { x: this.guide.x, z: this.guide.z }, b = this.track[n - 1] ?? a;
    const h = n >= 2 ? bearing(b.x, b.z, a.x, a.z) : this.guide.heading, [fx, fz] = dir(h);
    return { x: px - fx * left, z: pz - fz * left, h };
  }

  /** Distance of a member from its station (m). */
  stationError(s: Ship) { const st = this.station(s); return Math.hypot(st.x - s.x, st.z - s.z); }

  /**
   * One step: drop ships that cannot keep up, record the guide's track, hold the guide to the
   * formation's speed and steer every other ship to its station. Returns log lines.
   */
  update(): string[] {
    const log = this.prune();
    if (!this.line.length) return log;
    const g = this.guide;
    const last = this.track[0];
    if (!last || Math.hypot(g.x - last.x, g.z - last.z) >= CRUMB) {
      this.track.unshift({ x: g.x, z: g.z });
      const keep = Math.ceil(this.interval * (this.line.length + 1) / CRUMB) + 4;
      if (this.track.length > keep) this.track.length = keep;
    }
    if (this.followsTrack) this.axis = g.heading;
    g.speedOrder = Math.min(TELEGRAPH[g.telegraph].f * g.maxSpeed, this.maxSpeed);
    for (const s of this.members) if (s !== g) this.keepStation(s);
    return log;
  }

  private keepStation(s: Ship) {
    const st = this.station(s), g = this.guide;
    const ex = st.x - s.x, ez = st.z - s.z, dist = Math.hypot(ex, ez);
    s.waypoint = null;
    if (dist > CLOSING * this.interval) {
      // closing a distant station: straight for it, as fast as she can go
      s.course = bearing(s.x, s.z, st.x, st.z);
      s.speedOrder = s.achievableSpeed;
      return;
    }
    const [hx, hz] = dir(st.h);
    const along = ex * hx + ez * hz;
    // steer for a point ahead of the station (pure pursuit), so the ship slides onto it
    const look = Math.max(300, 2 * s.c.L);
    s.course = bearing(s.x, s.z, st.x + hx * look, st.z + hz * look);
    // speed up or ease off in proportion to how far ahead of or behind station she is
    s.speedOrder = clamp(g.speed + along * 0.01, 0.25 * g.speed, s.achievableSpeed);
  }

  /** Ships that are sunk, have a jammed rudder or cannot keep up fall out of line. */
  private prune(): string[] {
    const log: string[] = [];
    const slowest = Math.min(...this.members.map(s => s.maxSpeed));
    const out = (s: Ship) => !s.alive || s.rudderJam !== null || s.achievableSpeed < 0.75 * slowest;
    for (const s of this.members.filter(out)) {
      const wasGuide = s === this.guide;
      this.remove(s);
      if (s.alive) log.push(`${s.name} falls out of the formation${s.rudderJam !== null ? ' (steering)' : ' (cannot keep up)'}`);
      if (wasGuide && this.line.length) log.push(`${this.guide.name} takes over as guide`);
    }
    return log;
  }

  /** Take a ship out of the formation. She carries on at her present course and speed. */
  remove(s: Ship) {
    const wasGuide = s === this.guide;
    this.line = this.line.filter(o => o !== s);
    this.screen = this.screen.filter(o => o !== s);
    release(s, wasGuide);
    if (wasGuide && this.line.length) {
      const g = this.guide;
      g.telegraph = s.telegraph; g.course = s.course ?? s.heading; g.waypoint = s.waypoint;
    }
  }

  /** True when there is nothing left to keep together. */
  get empty() { return !this.line.length || this.line.length + this.screen.length < 2; }

  dissolve() { for (const s of this.members) release(s, s === this.guide); this.line = []; this.screen = []; }
}

/**
 * Back to independent steaming on the present course. The guide keeps the telegraph the player set;
 * the others take the setting nearest their present speed.
 */
function release(s: Ship, keepTelegraph: boolean) {
  if (s.speedOrder === null) return;
  s.speedOrder = null;
  s.course = s.course ?? s.heading;
  if (keepTelegraph) return;
  const f = s.speed / s.maxSpeed;
  let best = 1;
  TELEGRAPH.forEach((t, i) => { if (t.f >= 0 && Math.abs(t.f - f) < Math.abs(TELEGRAPH[best].f - f)) best = i; });
  s.telegraph = best;
}
