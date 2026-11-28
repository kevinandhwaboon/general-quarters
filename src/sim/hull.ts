import { ShipClass } from '../data/ships';

/** Half-width profile of a hull at normalised position t in [-1 (stern), 1 (bow)]. */
export function hullProfile(t: number, fine: number): number {
  if (t > 0.1) { const u = (t - 0.1) / 0.9; return Math.pow(Math.max(0, 1 - u * u), fine); }
  if (t < -0.55) { const u = (-0.55 - t) / 0.45; return 1 - 0.5 * u * u; }
  return 1;
}

/** Height of the weather deck above the waterline at normalised position t. */
export function deckHeight(c: ShipClass, t: number): number {
  const sheer = c.sheer ?? 0.45;
  return c.fb + (t > 0.25 ? Math.pow((t - 0.25) / 0.75, 1.7) * c.fb * sheer : 0) + (t < -0.85 ? (-0.85 - t) / 0.15 * 0.4 : 0);
}

/** Half beam at deck level, x in metres from amidships. */
export const halfBeam = (c: ShipClass, x: number) => hullProfile(x / (c.L / 2), c.fine ?? 0.6) * c.B / 2 * (c.tumble ?? 1);
/** Half beam at the waterline (wider for bulged hulls). */
export const halfBeamWL = (c: ShipClass, x: number) => hullProfile(x / (c.L / 2) * 1.025, c.fine ?? 0.6) * c.B / 2;

export type Part = 'hull' | 'superstructure' | 'conning' | 'turret' | 'funnel';

/**
 * Highest solid point of the ship at local position (u along, v across), used for hit testing.
 * Returns the height and which part occupies that column.
 */
export function columnAt(c: ShipClass, u: number, v: number): { h: number; part: Part; turret: number } | null {
  const hb = Math.max(halfBeam(c, u), halfBeamWL(c, u));
  if (Math.abs(u) > c.L / 2 || Math.abs(v) > hb) return null;
  const deck = deckHeight(c, u / (c.L / 2));
  let best = { h: deck, part: 'hull' as Part, turret: -1 };
  c.turrets.forEach((t, i) => {
    const r = 6.5 * (t.s ?? 1);
    if (Math.hypot(u - t.x, v) < r) { const top = t.h + 3.2 * (t.s ?? 1); if (top > best.h) best = { h: top, part: 'turret', turret: i }; }
  });
  for (const b of c.boxes) {
    if (Math.abs(u - b.x) < b.l / 2 && Math.abs(v - (b.z ?? 0)) < b.w / 2) {
      const top = deckHeight(c, b.x / (c.L / 2)) + b.y1;
      if (top > best.h) best = { h: top, part: b.part ?? 'superstructure', turret: -1 };
    }
  }
  const fd = c.flightDeck;
  if (fd && Math.abs(u - fd.x) < fd.l / 2 && Math.abs(v) < fd.w / 2) {
    const top = deckHeight(c, fd.x / (c.L / 2)) + fd.y;
    if (top > best.h) best = { h: top, part: 'superstructure', turret: -1 };
  }
  for (const f of c.funnels) {
    if (Math.hypot(u - f.x, v - (f.z ?? 0)) < f.r) { const top = deckHeight(c, f.x / (c.L / 2)) + (f.y0 ?? 1.5) + f.h; if (top > best.h) best = { h: top, part: 'funnel', turret: -1 }; }
  }
  return best;
}
