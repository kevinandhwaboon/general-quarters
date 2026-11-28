/**
 * Naval gun data. Tables are indexed by REAL range in km.
 * Values are approximations from published range tables (NavWeaps-style);
 * they are good enough for gameplay and should be refined later.
 */
/** Main-battery shell types the player can choose between. */
export type ShellType = 'ap' | 'he';
export const SHELL_LABEL: Record<ShellType, string> = { ap: 'AP', he: 'HE' };

/** High-explosive (HC / common) shell: thin wall, large burster, bursts on contact. */
export interface HeSpec {
  name: string;
  /** Thickest plate (mm, struck at right angles) the shell can blow through before bursting. */
  penMm: number;
  /** Damage points for a burst inside the hull; bursts against armour do a fraction of this. */
  damage: number;
}

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
  /** HE shell. Ballistics are taken from the AP tables (close enough for gameplay). */
  he: HeSpec;
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
  // 16 in Mark 13 HC: about 1,016 kg with a ~70 kg burster (about 7%)
  he: { name: 'Mark 13 HC', penMm: 80, damage: 9 },
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
  // Type 0 common (HE): about 625 kg
  he: { name: 'Type 0 common', penMm: 65, damage: 7 },
};

/** Plates thinner than this do not arm the fuse of an AP shell: it passes straight through. */
export const fuseThreshold = (g: GunSpec) => g.caliberMm / 6;

/**
 * US 5 in/38 Mark 12 (twin Mark 28 mounts), firing 25 kg AA common at surface targets.
 * Range table approximate (NavWeaps-style); 15.9 km at 45 degrees.
 */
export const GUN_5IN_38_MK12: GunSpec = {
  name: '5 in/38 Mark 12',
  caliberMm: 127,
  shellKg: 25,
  muzzleVelocity: 792,
  reload: 4.5,
  maxRangeKm: 15.9,
  penNormal: [[0, 180], [5, 95], [10, 55], [13, 42], [15.9, 35]],
  fallDeg: [[0, 0], [5, 4.5], [10, 14], [13, 24], [15.9, 45]],
  flightS: [[0, 0], [5, 7.5], [10, 20], [13, 32], [15.9, 52]],
  dispRange: 0.009,
  dispDeflection: 0.003,
  damage: 1.4,
  barrelM: 4.8,
  traverseDegS: 25,
  he: { name: '5 in AA common', penMm: 12, damage: 0.8 },
};

/** IJN 15.2 cm/50 41st Year Type in casemates (elevation raised to 30 degrees in the reconstruction). */
export const GUN_6IN_50_41: GunSpec = {
  name: '15.2 cm/50 41st Year Type',
  caliberMm: 152,
  shellKg: 45.4,
  muzzleVelocity: 850,
  reload: 10,
  maxRangeKm: 19,
  penNormal: [[0, 230], [5, 140], [10, 85], [15, 55], [19, 45]],
  fallDeg: [[0, 0], [5, 3.5], [10, 11], [15, 22], [19, 32]],
  flightS: [[0, 0], [5, 7], [10, 17], [15, 32], [19, 46]],
  dispRange: 0.012,
  dispDeflection: 0.0035,
  damage: 2.4,
  barrelM: 7.6,
  traverseDegS: 10,
  he: { name: '15.2 cm common', penMm: 18, damage: 1.2 },
};

/**
 * IJN 12.7 cm/50 3rd Year Type in Type C twin destroyer mounts (low-angle, 55 degrees maximum).
 * Range table approximate; 18.4 km at 45 degrees.
 */
export const GUN_127_50_T3: GunSpec = {
  name: '12.7 cm/50 3rd Year Type',
  caliberMm: 127,
  shellKg: 23,
  muzzleVelocity: 910,
  reload: 6,
  maxRangeKm: 18.4,
  penNormal: [[0, 200], [5, 105], [10, 62], [15, 40], [18.4, 34]],
  fallDeg: [[0, 0], [5, 4], [10, 12], [15, 26], [18.4, 45]],
  flightS: [[0, 0], [5, 7], [10, 17], [15, 33], [18.4, 50]],
  dispRange: 0.009,
  dispDeflection: 0.003,
  damage: 1.3,
  barrelM: 6.4,
  traverseDegS: 10,
  he: { name: '12.7 cm common', penMm: 12, damage: 0.75 },
};

/** IJN 12.7 cm/40 Type 89 high-angle gun (carrier and cruiser AA); used only against aircraft here. */
export const GUN_127_40_T89: GunSpec = {
  name: '12.7 cm/40 Type 89',
  caliberMm: 127,
  shellKg: 23,
  muzzleVelocity: 720,
  reload: 4,
  maxRangeKm: 14.8,
  penNormal: [[0, 170], [5, 85], [10, 48], [14.8, 32]],
  fallDeg: [[0, 0], [5, 5], [10, 16], [14.8, 45]],
  flightS: [[0, 0], [5, 8], [10, 21], [14.8, 50]],
  dispRange: 0.01,
  dispDeflection: 0.0035,
  damage: 1.3,
  barrelM: 5.1,
  traverseDegS: 12,
  he: { name: '12.7 cm HA common', penMm: 12, damage: 0.75 },
};
