import type { Nation } from './ships';

/**
 * Carrier aircraft of 1942. Speeds, radii and loads are approximations from published figures
 * (manufacturer and wartime data as collected by the usual references); air-combat and attack
 * numbers are game calibrations, checked against the outcomes of Coral Sea, Midway and Santa Cruz
 * in scripts/balance.ts.
 */

export type AirRole = 'fighter' | 'dive' | 'torpedo';

export interface Weapon {
  name: string;
  kind: 'bomb' | 'torpedo';
  /** Bombs: thickest deck (mm) the bomb pierces before bursting. */
  penMm: number;
  /** Damage points for a burst inside the ship. */
  damage: number;
  /** Torpedoes: running speed (kn) and the chance that it fails to run or explode. */
  speedKn?: number;
  dud?: number;
}

export interface AircraftType {
  id: string;
  name: string;
  /** Short name for lists and map labels. */
  short: string;
  nation: Nation;
  role: AirRole;
  cruiseKn: number;
  maxKn: number;
  /** Strike radius with a normal load (nautical miles); search radius when scouting. */
  radiusNm: number;
  searchNm?: number;
  weapon: Weapon | null;
  /** Lighter load carried on a search. */
  searchWeapon?: Weapon | null;
  /**
   * Air combat, as expected kills per aircraft per minute of fighting: a fighter against fighters
   * and against bombers, and a bomber's rear gunners against fighters.
   */
  air: { vsFighter: number; vsBomber: number; gunner: number };
  /** Chance that one attack hits a large ship steaming straight and unharassed. */
  attack: number;
  /** Cruising altitude (real metres). */
  altM: number;
  /** Visual: wingspan and length (m), main colour. */
  span: number;
  length: number;
  colour: number;
}

export const BOMB_1000LB: Weapon = { name: '1,000 lb bomb', kind: 'bomb', penMm: 50, damage: 7 };
export const BOMB_500LB: Weapon = { name: '500 lb bomb', kind: 'bomb', penMm: 30, damage: 4 };
export const BOMB_250KG: Weapon = { name: '250 kg bomb', kind: 'bomb', penMm: 40, damage: 4.5 };
/** Mark 13 aircraft torpedo, 1942: slow, and many failed to run or explode. */
export const TORP_MK13: Weapon = { name: 'Mark 13 torpedo', kind: 'torpedo', penMm: 0, damage: 15, speedKn: 33, dud: 0.3 };
/** Type 91 aircraft torpedo: fast and reliable. */
export const TORP_TYPE91: Weapon = { name: 'Type 91 torpedo', kind: 'torpedo', penMm: 0, damage: 17, speedKn: 42, dud: 0.05 };

export const F4F: AircraftType = {
  id: 'f4f', name: 'Grumman F4F-4 Wildcat', short: 'F4F', nation: 'usn', role: 'fighter',
  cruiseKn: 140, maxKn: 275, radiusNm: 175, weapon: null,
  air: { vsFighter: 0.1, vsBomber: 0.22, gunner: 0 }, attack: 0, altM: 5500, span: 11.6, length: 8.8, colour: 0x66788a,
};
export const SBD: AircraftType = {
  id: 'sbd', name: 'Douglas SBD-3 Dauntless', short: 'SBD', nation: 'usn', role: 'dive',
  cruiseKn: 130, maxKn: 220, radiusNm: 200, searchNm: 250, weapon: BOMB_1000LB, searchWeapon: BOMB_500LB,
  air: { vsFighter: 0, vsBomber: 0, gunner: 0.03 }, attack: 0.2, altM: 5000, span: 12.7, length: 10.1, colour: 0x6c7e90,
};
export const TBD: AircraftType = {
  id: 'tbd', name: 'Douglas TBD-1 Devastator', short: 'TBD', nation: 'usn', role: 'torpedo',
  cruiseKn: 110, maxKn: 180, radiusNm: 150, weapon: TORP_MK13,
  air: { vsFighter: 0, vsBomber: 0, gunner: 0.01 }, attack: 0.2, altM: 1000, span: 15.2, length: 10.7, colour: 0x71838f,
};
export const A6M: AircraftType = {
  id: 'a6m', name: 'Mitsubishi A6M2 Zero', short: 'Zero', nation: 'ijn', role: 'fighter',
  cruiseKn: 170, maxKn: 287, radiusNm: 260, weapon: null,
  air: { vsFighter: 0.12, vsBomber: 0.26, gunner: 0 }, attack: 0, altM: 5000, span: 12, length: 9.1, colour: 0xb9b7a2,
};
export const D3A: AircraftType = {
  id: 'd3a', name: 'Aichi D3A1 Val', short: 'Val', nation: 'ijn', role: 'dive',
  cruiseKn: 160, maxKn: 209, radiusNm: 230, weapon: BOMB_250KG,
  air: { vsFighter: 0, vsBomber: 0, gunner: 0.02 }, attack: 0.24, altM: 4500, span: 14.4, length: 10.2, colour: 0xb3b29c,
};
export const B5N: AircraftType = {
  id: 'b5n', name: 'Nakajima B5N2 Kate', short: 'Kate', nation: 'ijn', role: 'torpedo',
  cruiseKn: 140, maxKn: 204, radiusNm: 250, searchNm: 300, weapon: TORP_TYPE91, searchWeapon: null,
  air: { vsFighter: 0, vsBomber: 0, gunner: 0.01 }, attack: 0.38, altM: 3000, span: 15.5, length: 10.3, colour: 0x8e9a82,
};

export const AIRCRAFT: Record<string, AircraftType> = { f4f: F4F, sbd: SBD, tbd: TBD, a6m: A6M, d3a: D3A, b5n: B5N };
