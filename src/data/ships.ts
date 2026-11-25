import { GunSpec, GUN_14IN_45_T41, GUN_16IN_45_MK6, GUN_5IN_38_MK12, GUN_6IN_50_41, ShellType } from './guns';

export type Nation = 'usn' | 'ijn';

export interface TurretDef {
  /** Position along the hull from amidships (m, + forward). */
  x: number;
  /** Height of the turret base above the waterline (m). */
  h: number;
  /** Faces forward at rest. */
  fwd: boolean;
  guns: number;
  /** Visual size multiplier. */
  s?: number;
  /** Arc limits as |relative bearing| in degrees: forward turrets fire up to maxRel, aft turrets from minRel. */
  minRel?: number;
  maxRel?: number;
}

export interface BoxDef { x: number; l: number; w: number; y0: number; y1: number; win?: boolean; wing?: number; z?: number; c?: number; part?: 'superstructure' | 'conning'; }
export interface FunnelDef { x: number; r: number; h: number; y0?: number; rake?: number; plat?: boolean; }
export interface MastDef { x: number; h: number; k: 'pole' | 'tripod' | 'cage' | 'pagoda' | 'tower'; y0?: number; }

export interface Armour {
  /** Main belt thickness (mm) and inclination (deg, top leaning outward). */
  belt: number;
  beltIncl: number;
  /** Belt extent above and below the waterline (m). */
  beltTop: number;
  beltBottom: number;
  /** Citadel extent along the hull (m from amidships). */
  citadel: [number, number];
  /** Upper side above the belt, inside the citadel. */
  upperSide: number;
  deck: number;
  /** Bow and stern plating and decks outside the citadel. */
  ends: number;
  turretFace: number;
  turretRoof: number;
  conning: number;
  superstructure: number;
}

export interface FireControlDef {
  /** Initial error of the firing solution, as a fraction of real range (1 sigma). */
  rangeErr0: number;
  /** Fraction of the remaining error kept after spotting one salvo (lower is better). */
  spotKeep: number;
  /** Description shown in the UI. */
  label: string;
}

export interface ShipClass {
  id: string;
  label: string;
  nation: Nation;
  type: 'BB' | 'CA' | 'CL' | 'DD';
  L: number; B: number; fb: number;
  sheer?: number; fine?: number; tumble?: number; bulge?: boolean;
  maxKn: number;
  /** Tactical diameter at full rudder (m). */
  tacticalDiameter: number;
  /** m/s^2 */
  accel: number;
  hp: number;
  armour: Armour;
  gun: GunSpec;
  /** Main-battery rounds carried, by shell type. Semi-realistic placeholders (about 90-100 rounds per gun). */
  ammo: Record<ShellType, number>;
  turrets: TurretDef[];
  fc: FireControlDef;
  /** Secondary battery: the gun, guns per mount, HE rounds carried for all of it, and its fire control. */
  sec?: { gun: GunSpec; gunsPerMount: number; ammo: number; fc: FireControlDef };
  crew: string;
  // visuals
  boxes: BoxDef[];
  funnels: FunnelDef[];
  masts: MastDef[];
  /** Secondary mounts, one per side at each position (also drawn). */
  secondaries?: { x: number; z: number; y: number }[];
  /** 'dp': dual-purpose (US 5-inch/38, counts as secondary and heavy AA); 'haa': AA only (IJN 12.7 cm). */
  secondaryRole?: 'dp' | 'haa';
  /** Light and medium AA guns: positions along the hull, one mount per side at each. Not drawn yet. */
  aa?: { k: 'medium' | 'light'; label: string; x: number[] }[];
  /** Fitted with fire-control radar. */
  radar?: boolean;
  boats?: number[];
  cranes?: { x: number; z: number; dx: number; dz: number }[];
  catapults?: { x: number; z: number; r: number }[];
  cas?: { n: number; x0: number; x1: number; y: number };
}

/** North Carolina class, as USS Washington (BB-56) in November 1942. */
export const NORTH_CAROLINA: ShipClass = {
  id: 'northcarolina', label: 'North Carolina-class battleship', nation: 'usn', type: 'BB',
  L: 222, B: 33, fb: 8.2, sheer: 0.35, fine: 0.58, tumble: 0.94,
  maxKn: 28, tacticalDiameter: 680, accel: 0.07, hp: 160,
  armour: { belt: 305, beltIncl: 15, beltTop: 2.6, beltBottom: -3.4, citadel: [-66, 72], upperSide: 38, deck: 140, ends: 25, turretFace: 406, turretRoof: 178, conning: 373, superstructure: 16 },
  gun: GUN_16IN_45_MK6,
  ammo: { ap: 540, he: 360 }, // 9 guns, about 100 rounds per gun
  turrets: [
    { x: 62, h: 11, fwd: true, guns: 3, s: 1.35, maxRel: 150 },
    { x: 47, h: 15, fwd: true, guns: 3, s: 1.35, maxRel: 150 },
    { x: -62, h: 11, fwd: false, guns: 3, s: 1.35, minRel: 30 },
  ],
  fc: { rangeErr0: 0.006, spotKeep: 0.45, label: 'Mk 38 director + Mk 3 fire-control radar' },
  sec: { gun: GUN_5IN_38_MK12, gunsPerMount: 2, ammo: 7000, fc: { rangeErr0: 0.012, spotKeep: 0.5, label: 'Mk 37 directors + Mk 4 radar' } }, // 20 guns, about 350 rounds per gun
  crew: 'Trained, radar-equipped',
  boxes: [
    { x: 4, l: 74, w: 24, y0: 0, y1: 4.5 },
    { x: 26, l: 18, w: 16, y0: 4.5, y1: 10, win: true, wing: 3, part: 'conning' },
    { x: 26, l: 13, w: 12, y0: 10, y1: 15, win: true },
    { x: 25, l: 8, w: 8, y0: 15, y1: 19, win: true },
    { x: -26, l: 16, w: 13, y0: 4.5, y1: 10, win: true },
  ],
  funnels: [{ x: 6, r: 3.6, h: 13, y0: 4.5, plat: true }, { x: -10, r: 3.4, h: 12, y0: 4.5 }],
  masts: [{ x: 21, h: 40, k: 'tower', y0: 4.5 }, { x: -30, h: 24, k: 'pole', y0: 10 }],
  secondaries: [{ x: 20, z: 10.5, y: 4.5 }, { x: 10, z: 12, y: 0 }, { x: -2, z: 12, y: 0 }, { x: -14, z: 12, y: 0 }, { x: -24, z: 10.5, y: 4.5 }],
  secondaryRole: 'dp',
  radar: true,
  // late 1942: four quadruple 1.1-inch and about twenty 20 mm Oerlikons (approximate)
  aa: [{ k: 'medium', label: '1.1-inch quad', x: [30, -32] }, { k: 'light', label: '20 mm', x: [80, 44, 36, 16, 4, -8, -20, -40, -52, -80] }],
  boats: [-2, -18],
  cranes: [{ x: -95, z: 0, dx: -8, dz: 6 }],
  catapults: [{ x: -96, z: 7, r: 0.35 }, { x: -96, z: -7, r: -0.35 }],
};

/** Kongō class after reconstruction, as Kirishima in November 1942. */
export const KONGO: ShipClass = {
  id: 'kongo', label: 'Kongō-class fast battleship', nation: 'ijn', type: 'BB',
  L: 222, B: 31, fb: 8, sheer: 0.45, fine: 0.6, tumble: 0.88, bulge: true,
  maxKn: 30, tacticalDiameter: 720, accel: 0.07, hp: 115,
  armour: { belt: 203, beltIncl: 0, beltTop: 2.2, beltBottom: -2.8, citadel: [-80, 80], upperSide: 152, deck: 90, ends: 25, turretFace: 254, turretRoof: 152, conning: 254, superstructure: 12 },
  gun: GUN_14IN_45_T41,
  ammo: { ap: 480, he: 240 }, // 8 guns, about 90 rounds per gun
  turrets: [
    { x: 76, h: 10.6, fwd: true, guns: 2, s: 1.22, maxRel: 150 },
    { x: 63, h: 13.8, fwd: true, guns: 2, s: 1.22, maxRel: 150 },
    { x: -42, h: 12.4, fwd: false, guns: 2, s: 1.22, minRel: 40 },
    { x: -74, h: 10.4, fwd: false, guns: 2, s: 1.22, minRel: 30 },
  ],
  fc: { rangeErr0: 0.018, spotKeep: 0.55, label: 'Type 94 director, optical rangefinders' },
  sec: { gun: GUN_6IN_50_41, gunsPerMount: 1, ammo: 2100, fc: { rangeErr0: 0.03, spotKeep: 0.65, label: 'casemates, local and group control' } }, // 14 guns, about 150 rounds per gun
  crew: 'Veteran',
  boxes: [{ x: -2, l: 72, w: 22, y0: 0, y1: 4 }, { x: -56, l: 12, w: 10, y0: 0, y1: 5, win: true }, { x: 40, l: 12, w: 12, y0: 4, y1: 9, part: 'conning' }],
  funnels: [{ x: 13, r: 4, h: 13, y0: 4, rake: 8, plat: true }, { x: -16, r: 3.6, h: 11.5, y0: 4, rake: 8 }],
  masts: [{ x: 38, h: 40, k: 'pagoda', y0: 4 }, { x: -30, h: 22, k: 'tripod', y0: 4 }],
  cas: { n: 7, x0: 34, x1: -34, y: -2.6 },
  secondaries: [{ x: 0, z: 9, y: 4 }, { x: -24, z: 9, y: 4 }],
  secondaryRole: 'haa',
  // ten twin 25 mm mounts (approximate)
  aa: [{ k: 'light', label: '25 mm twin', x: [24, 10, -2, -20, -32] }],
  boats: [2, -6],
  catapults: [{ x: -92, z: 0, r: 0.3 }],
};

export const CLASSES: Record<string, ShipClass> = { northcarolina: NORTH_CAROLINA, kongo: KONGO };
