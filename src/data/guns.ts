/**
 * Naval gun data. Tables are indexed by REAL range in km.
 * Values are approximations from published range tables (NavWeaps-style);
 * they are good enough for gameplay and should be refined later.
 */
export interface GunSpec {
  name: string;
  caliberMm: number;
  shellKg: number;
  muzzleVelocity: number;
  /** Seconds between rounds per gun. */
  reload: number;
  maxRangeKm: number;
  /** Penetration of a plate struck at right angles (mm) by range. */
  penNormal: [number, number][];
  /** Angle of fall (degrees) by range. */
  fallDeg: [number, number][];
  /** Time of flight (s, real) by range. */
  flightS: [number, number][];
  /** Per-shell dispersion as a fraction of real range: along the line of fire and across it. */
  dispRange: number;
  dispDeflection: number;
  /** Damage points for a hit that detonates inside the ship. */
  damage: number;
  /** Length of a barrel in metres (visual). */
  barrelM: number;
  /** Turret traverse in degrees per second. */
  traverseDegS: number;
}

export const GUN_16IN_45_MK6: GunSpec = {
  name: '16 in/45 Mark 6',
  caliberMm: 406,
  shellKg: 1225,
  muzzleVelocity: 701,
  reload: 30,
  maxRangeKm: 33.7,
  penNormal: [[0, 800], [5, 700], [10, 610], [15, 530], [20, 460], [25, 400], [30, 350], [33.7, 320]],
  fallDeg: [[0, 0], [5, 2.6], [10, 7], [15, 12.5], [20, 19], [25, 27], [30, 36], [33.7, 45]],
  flightS: [[0, 0], [5, 7.5], [10, 16], [15, 26], [20, 37], [25, 50], [30, 65], [33.7, 78]],
  dispRange: 0.0068,
  dispDeflection: 0.0017,
  damage: 14,
  barrelM: 18,
  traverseDegS: 4,
};

export const GUN_14IN_45_T41: GunSpec = {
  name: '36 cm/45 Type 41',
  caliberMm: 356,
  shellKg: 673.5,
  muzzleVelocity: 775,
  reload: 35,
  maxRangeKm: 35.4,
  penNormal: [[0, 600], [5, 525], [10, 450], [15, 385], [20, 330], [25, 285], [30, 245], [35.4, 215]],
  fallDeg: [[0, 0], [5, 2.2], [10, 6.5], [15, 11.5], [20, 18], [25, 26], [30, 35], [35.4, 44]],
  flightS: [[0, 0], [5, 7], [10, 15], [15, 24], [20, 35], [25, 47], [30, 62], [35.4, 78]],
  dispRange: 0.0075,
  dispDeflection: 0.002,
  damage: 9,
  barrelM: 16,
  traverseDegS: 3,
};

/** Plates thinner than this do not arm the fuse of an AP shell: it passes straight through. */
export const fuseThreshold = (g: GunSpec) => g.caliberMm / 6;
