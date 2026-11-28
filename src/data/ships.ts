import { A6M, AircraftType, B5N, D3A, F4F, SBD, TBD } from './aircraft';
import { GunSpec, GUN_127_40_T89, GUN_127_50_T3, GUN_14IN_45_T41, GUN_16IN_45_MK6, GUN_5IN_38_MK12, GUN_6IN_50_41, ShellType } from './guns';

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
export interface FunnelDef { x: number; r: number; h: number; y0?: number; rake?: number; plat?: boolean; /** Offset to starboard (carrier islands). */ z?: number; }
export interface MastDef { x: number; h: number; k: 'pole' | 'tripod' | 'cage' | 'pagoda' | 'tower'; y0?: number; z?: number; }

/** A carrier's flight deck: centre and length along the hull, width, and height of its surface above the hull deck (m). */
export interface FlightDeckDef { x: number; l: number; w: number; y: number; }

/** A carrier's air group and the pace of her deck. */
export interface CarrierDef {
  group: { type: AircraftType; n: number }[];
  /** Seconds between aircraft taking off, and between aircraft landing. */
  launchS: number;
  recoverS: number;
  /** Seconds to fuel and arm one aircraft in the hangar. */
  prepS: number;
}

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
  type: 'CV' | 'BB' | 'CA' | 'CL' | 'DD';
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
  /** Fraction of a torpedo's effect absorbed by side protection (bulges, torpedo bulkheads). */
  torpedoProtection?: number;
  /** Air-search radar (detects aircraft at long range). */
  airRadar?: boolean;
  /** Carriers: air group and deck operations. */
  air?: CarrierDef;
  flightDeck?: FlightDeckDef;
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
  torpedoProtection: 0.5, airRadar: true,
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

/**
 * South Dakota class, as USS South Dakota (BB-57) in November 1942. Shorter than North Carolina with
 * a single funnel faired into a compact superstructure, an internal belt inclined at 19 degrees and
 * eight twin 5-inch mounts (she was fitted as a flagship; her sisters had ten). Armour from the usual
 * published figures (belt 12.2 in on 0.875 in STS, deck about 5.75 in, turret face 18 in); AA fit
 * and magazine loadout are placeholders.
 */
export const SOUTH_DAKOTA: ShipClass = {
  id: 'southdakota', label: 'South Dakota-class battleship', nation: 'usn', type: 'BB',
  L: 207, B: 33, fb: 8, sheer: 0.38, fine: 0.55, tumble: 0.94,
  maxKn: 27.5, tacticalDiameter: 640, accel: 0.07, hp: 150,
  armour: { belt: 310, beltIncl: 19, beltTop: 2.4, beltBottom: -3.6, citadel: [-58, 66], upperSide: 22, deck: 146, ends: 25, turretFace: 457, turretRoof: 184, conning: 406, superstructure: 16 },
  gun: GUN_16IN_45_MK6,
  ammo: { ap: 540, he: 360 }, // 9 guns, about 100 rounds per gun
  turrets: [
    { x: 57, h: 11, fwd: true, guns: 3, s: 1.35, maxRel: 150 },
    { x: 42, h: 15, fwd: true, guns: 3, s: 1.35, maxRel: 150 },
    { x: -56, h: 11, fwd: false, guns: 3, s: 1.35, minRel: 30 },
  ],
  fc: { rangeErr0: 0.006, spotKeep: 0.45, label: 'Mk 38 director + Mk 3 fire-control radar' },
  sec: { gun: GUN_5IN_38_MK12, gunsPerMount: 2, ammo: 5600, fc: { rangeErr0: 0.012, spotKeep: 0.5, label: 'Mk 37 directors + Mk 4 radar' } }, // 16 guns, about 350 rounds per gun
  crew: 'New ship, radar-equipped',
  torpedoProtection: 0.5, airRadar: true,
  boxes: [
    { x: 2, l: 60, w: 24, y0: 0, y1: 4.5 },
    { x: 22, l: 16, w: 15, y0: 4.5, y1: 10, win: true, wing: 3, part: 'conning' },
    { x: 21, l: 12, w: 12, y0: 10, y1: 15, win: true },
    { x: 20, l: 8, w: 8, y0: 15, y1: 19, win: true },
    { x: -6, l: 18, w: 14, y0: 4.5, y1: 9 },
    { x: -20, l: 12, w: 12, y0: 4.5, y1: 9.5, win: true },
  ],
  funnels: [{ x: -2, r: 4.4, h: 12.5, y0: 4.5, plat: true }],
  masts: [{ x: 14, h: 38, k: 'tower', y0: 4.5 }, { x: -14, h: 20, k: 'pole', y0: 9 }],
  secondaries: [{ x: 18, z: 10.5, y: 4.5 }, { x: 6, z: 12, y: 0 }, { x: -6, z: 12, y: 0 }, { x: -18, z: 10.5, y: 4.5 }],
  secondaryRole: 'dp',
  radar: true,
  // late 1942: quadruple 40 mm Bofors and a large number of 20 mm Oerlikons (approximate)
  aa: [{ k: 'medium', label: '40 mm quad', x: [30, -30] }, { k: 'light', label: '20 mm', x: [74, 36, 28, 12, -12, -26, -36, -46, -70, -80] }],
  boats: [-12, -26],
  cranes: [{ x: -88, z: 0, dx: -7, dz: 6 }],
  catapults: [{ x: -91, z: 7, r: 0.35 }, { x: -91, z: -7, r: -0.35 }],
};

/**
 * Fletcher-class destroyer, late 1942. Five single 5-inch/38 mounts under a Mk 37 director with
 * radar; half-inch plating over the machinery and little else. Torpedoes are not modelled yet.
 * AA fit and magazine loadout are placeholders.
 */
export const FLETCHER: ShipClass = {
  id: 'fletcher', label: 'Fletcher-class destroyer', nation: 'usn', type: 'DD',
  L: 115, B: 12, fb: 4.2, sheer: 0.5, fine: 0.5, tumble: 0.96,
  maxKn: 36.5, tacticalDiameter: 700, accel: 0.12, hp: 14,
  armour: { belt: 13, beltIncl: 0, beltTop: 1.5, beltBottom: -2, citadel: [-25, 25], upperSide: 13, deck: 13, ends: 8, turretFace: 6, turretRoof: 6, conning: 10, superstructure: 6 },
  gun: GUN_5IN_38_MK12,
  ammo: { ap: 250, he: 1500 }, // 5 guns, about 350 rounds per gun: semi-armour-piercing and AA common
  turrets: [
    { x: 40, h: 5.6, fwd: true, guns: 1, s: 0.55, maxRel: 150 },
    { x: 31, h: 7.4, fwd: true, guns: 1, s: 0.55, maxRel: 145 },
    { x: -22, h: 8.6, fwd: false, guns: 1, s: 0.55, minRel: 40 },
    { x: -34, h: 7.2, fwd: false, guns: 1, s: 0.55, minRel: 35 },
    { x: -46, h: 4.6, fwd: false, guns: 1, s: 0.55, minRel: 30 },
  ],
  fc: { rangeErr0: 0.012, spotKeep: 0.5, label: 'Mk 37 director + Mk 4 radar' },
  crew: 'Trained, radar-equipped',
  torpedoProtection: 0, airRadar: true,
  boxes: [
    { x: 20, l: 13, w: 9, y0: 0, y1: 3 },
    { x: 21, l: 8, w: 8, y0: 3, y1: 6, win: true, wing: 1.5 },
    { x: 0, l: 22, w: 7, y0: 0, y1: 2.4 },
    { x: -30, l: 16, w: 7, y0: 0, y1: 2.6, win: true },
  ],
  funnels: [{ x: 7, r: 1.7, h: 6.5, y0: 2.4, rake: 4 }, { x: -6, r: 1.7, h: 6, y0: 2.4, rake: 4 }],
  masts: [{ x: 16, h: 14, k: 'pole', y0: 6 }],
  radar: true,
  // late 1942: a twin 40 mm aft and four 20 mm (approximate; early ships had a quadruple 1.1-inch)
  aa: [{ k: 'medium', label: '40 mm twin', x: [-14] }, { k: 'light', label: '20 mm', x: [14, -40] }],
};

/**
 * Yorktown class, as USS Yorktown (CV-5) in mid-1942. Unarmoured flight and hangar decks, a 4-inch
 * belt and 1.5-inch protective deck over the machinery, eight single 5-inch/38 in gallery mounts
 * and a CXAM air-search radar. Air group as at Midway (approximate); AA fit approximate.
 */
export const YORKTOWN: ShipClass = {
  id: 'yorktown', label: 'Yorktown-class carrier', nation: 'usn', type: 'CV',
  L: 251, B: 25.4, fb: 9, sheer: 0.12, fine: 0.62, tumble: 1,
  maxKn: 32.5, tacticalDiameter: 750, accel: 0.07, hp: 90,
  armour: { belt: 102, beltIncl: 0, beltTop: 2, beltBottom: -2.5, citadel: [-60, 70], upperSide: 10, deck: 38, ends: 10, turretFace: 0, turretRoof: 0, conning: 102, superstructure: 10 },
  gun: GUN_5IN_38_MK12,
  ammo: { ap: 0, he: 0 },
  turrets: [],
  fc: { rangeErr0: 0.015, spotKeep: 0.55, label: 'Mk 33 directors' },
  sec: { gun: GUN_5IN_38_MK12, gunsPerMount: 1, ammo: 3200, fc: { rangeErr0: 0.015, spotKeep: 0.55, label: 'Mk 33 directors' } },
  crew: 'Trained, radar-equipped',
  torpedoProtection: 0.25, airRadar: true,
  air: { group: [{ type: F4F, n: 25 }, { type: SBD, n: 37 }, { type: TBD, n: 13 }], launchS: 20, recoverS: 30, prepS: 40 },
  flightDeck: { x: -2, l: 240, w: 26, y: 8 },
  boxes: [
    { x: 14, l: 34, w: 6, y0: 8.6, y1: 13, z: 11.5 },
    { x: 18, l: 14, w: 5.5, y0: 13, y1: 17, z: 11.5, win: true, wing: 1.5, part: 'conning' },
    { x: 19, l: 8, w: 5, y0: 17, y1: 20, z: 11.5, win: true },
  ],
  funnels: [{ x: 3, r: 4.2, h: 9, y0: 13, z: 11.5 }],
  masts: [{ x: 22, h: 14, k: 'tower', y0: 20, z: 11.5 }],
  secondaries: [{ x: 74, z: 13.5, y: 6.5 }, { x: 64, z: 13.5, y: 6.5 }, { x: -74, z: 13.5, y: 6.5 }, { x: -84, z: 13, y: 6.5 }],
  secondaryRole: 'dp',
  // mid-1942: four quadruple 1.1-inch and about twenty-four 20 mm (approximate)
  aa: [{ k: 'medium', label: '1.1-inch quad', x: [40, -12] }, { k: 'light', label: '20 mm', x: [100, 88, 50, 30, -4, -30, -50, -64, -94, -104, -112, 110] }],
};

/**
 * Shōkaku class, as Shōkaku at Coral Sea, May 1942. Wooden flight deck over an unarmoured hangar,
 * a belt up to 165 mm over the magazines (46 mm over the machinery), funnels trunked down the
 * starboard side, eight twin 12.7 cm high-angle mounts and triple 25 mm. No radar yet. Air group
 * approximate.
 */
export const SHOKAKU: ShipClass = {
  id: 'shokaku', label: 'Shōkaku-class carrier', nation: 'ijn', type: 'CV',
  L: 257.5, B: 26, fb: 9, sheer: 0.12, fine: 0.6, tumble: 1,
  maxKn: 34.2, tacticalDiameter: 800, accel: 0.07, hp: 95,
  armour: { belt: 120, beltIncl: 20, beltTop: 2, beltBottom: -3, citadel: [-70, 75], upperSide: 10, deck: 65, ends: 10, turretFace: 0, turretRoof: 0, conning: 10, superstructure: 10 },
  gun: GUN_127_40_T89,
  ammo: { ap: 0, he: 0 },
  turrets: [],
  fc: { rangeErr0: 0.02, spotKeep: 0.6, label: 'Type 94 high-angle directors' },
  crew: 'Veteran',
  torpedoProtection: 0.3,
  air: { group: [{ type: A6M, n: 21 }, { type: D3A, n: 27 }, { type: B5N, n: 18 }], launchS: 18, recoverS: 30, prepS: 40 },
  flightDeck: { x: -4, l: 242, w: 29, y: 8 },
  boxes: [
    { x: 54, l: 14, w: 5, y0: 8.6, y1: 13, z: 12, win: true, part: 'conning' },
    { x: 55, l: 8, w: 4.5, y0: 13, y1: 16, z: 12, win: true },
  ],
  funnels: [{ x: 4, r: 2.4, h: 3, y0: 4.5, z: 14.5 }, { x: -6, r: 2.4, h: 3, y0: 4.5, z: 14.5 }],
  masts: [{ x: 52, h: 9, k: 'pole', y0: 16, z: 12 }],
  secondaries: [{ x: 92, z: 13.5, y: 6 }, { x: 74, z: 13.5, y: 6 }, { x: -74, z: 13.5, y: 6 }, { x: -92, z: 13, y: 6 }],
  secondaryRole: 'haa',
  aa: [{ k: 'light', label: '25 mm triple', x: [82, 52, 22, -22, -52, -82] }],
};

/**
 * Kagerō-class destroyer, 1942. Three twin 12.7 cm/50 low-angle mounts, optical fire control,
 * no radar; torpedoes not modelled yet. AA fit approximate.
 */
export const KAGERO: ShipClass = {
  id: 'kagero', label: 'Kagerō-class destroyer', nation: 'ijn', type: 'DD',
  L: 118.5, B: 10.8, fb: 4.4, sheer: 0.55, fine: 0.5, tumble: 0.96,
  maxKn: 35, tacticalDiameter: 700, accel: 0.12, hp: 13,
  armour: { belt: 0, beltIncl: 0, beltTop: 1.5, beltBottom: -2, citadel: [-25, 25], upperSide: 6, deck: 6, ends: 6, turretFace: 3, turretRoof: 3, conning: 6, superstructure: 6 },
  gun: GUN_127_50_T3,
  ammo: { ap: 180, he: 720 }, // 6 guns, about 150 rounds per gun
  turrets: [
    { x: 42, h: 6.2, fwd: true, guns: 2, s: 0.7, maxRel: 150 },
    { x: -30, h: 7.8, fwd: false, guns: 2, s: 0.7, minRel: 35 },
    { x: -42, h: 5, fwd: false, guns: 2, s: 0.7, minRel: 30 },
  ],
  fc: { rangeErr0: 0.02, spotKeep: 0.6, label: 'Type 94 director, optical' },
  crew: 'Veteran',
  torpedoProtection: 0,
  boxes: [
    { x: 26, l: 10, w: 8, y0: 0, y1: 3 },
    { x: 26, l: 7, w: 7, y0: 3, y1: 5.6, win: true, wing: 1.2 },
    { x: 0, l: 30, w: 6, y0: 0, y1: 2 },
    { x: -22, l: 10, w: 6, y0: 0, y1: 2.6, win: true },
  ],
  funnels: [{ x: 9, r: 1.8, h: 6, y0: 2, rake: 8 }, { x: -6, r: 1.6, h: 5.5, y0: 2, rake: 8 }],
  masts: [{ x: 19, h: 12, k: 'tripod', y0: 5.6 }, { x: -16, h: 9, k: 'pole', y0: 2.6 }],
  aa: [{ k: 'light', label: '25 mm twin', x: [-2] }],
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
  torpedoProtection: 0.35,
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

export const CLASSES: Record<string, ShipClass> = { northcarolina: NORTH_CAROLINA, southdakota: SOUTH_DAKOTA, fletcher: FLETCHER, kongo: KONGO, yorktown: YORKTOWN, shokaku: SHOKAKU, kagero: KAGERO };
