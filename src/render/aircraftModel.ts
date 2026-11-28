import * as THREE from 'three';
import type { AircraftType } from '../data/aircraft';
import { BOX, CYL, CYL6, Kit } from './kit';

/**
 * A carrier aircraft built from its type: fuselage, cowling, wings, tail, canopy and national
 * markings, with the bomb or torpedo it carries. Local frame as for ships: x forward, y up,
 * z to starboard; true size in metres.
 */
export function buildAircraftGeometry(t: AircraftType): THREE.BufferGeometry {
  const k = new Kit(), L = t.length, S = t.span, c = t.colour, dark = 0x24282c, glass = 0x1c2a34;
  const along: [number, number, number] = [0, 0, -Math.PI / 2];
  k.add(CYL, c, [0, 0, 0], along, [L * 0.065, L * 0.86, L * 0.065]);
  k.add(CYL, dark, [L * 0.44, 0, 0], along, [L * 0.072, L * 0.09, L * 0.072]);
  k.add(BOX, c, [L * 0.1, -L * 0.035, 0], 0, [L * 0.18, L * 0.022, S]);
  k.add(BOX, c, [-L * 0.4, L * 0.015, 0], 0, [L * 0.1, L * 0.016, S * 0.36]);
  k.add(BOX, c, [-L * 0.42, L * 0.075, 0], 0, [L * 0.11, L * 0.14, L * 0.016]);
  const fighter = t.role === 'fighter';
  k.add(BOX, glass, [fighter ? L * 0.06 : -L * 0.02, L * 0.065, 0], 0, [fighter ? L * 0.15 : L * 0.34, L * 0.05, L * 0.065]);
  for (const sd of [-1, 1]) {
    if (t.nation === 'ijn') k.add(CYL, 0xb8302a, [L * 0.1, -L * 0.022, sd * S * 0.36], 0, [S * 0.05, 0.04, S * 0.05]);
    else { k.add(CYL, 0x23324a, [L * 0.1, -L * 0.022, sd * S * 0.36], 0, [S * 0.05, 0.04, S * 0.05]); k.add(CYL6, 0xe8e8e2, [L * 0.1, -L * 0.019, sd * S * 0.36], 0, [S * 0.028, 0.04, S * 0.028]); }
  }
  if (t.weapon?.kind === 'torpedo') k.add(CYL, 0x5d6266, [L * 0.05, -L * 0.1, 0], along, [0.27, 5.4, 0.27]);
  else if (t.weapon?.kind === 'bomb') k.add(CYL, 0x3b3f42, [L * 0.08, -L * 0.09, 0], along, [0.25, 1.9, 0.25]);
  return k.build();
}
