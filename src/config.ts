/**
 * Scale settings.
 *
 * Ships keep their true dimensions. Distances between ships are compressed:
 * one game metre of separation stands for 1 / RANGE_SCALE real metres.
 * All ballistics (fall angle, penetration, dispersion) are looked up at the
 * real-equivalent range, so a 6 km game range behaves like a 20 km real one.
 */
export const RANGE_SCALE = 0.3;

/** Shell flight times are shortened by this factor so salvos resolve at RTS pace. */
export const FLIGHT_TIME_SCALE = 0.35;

/** Largest visual enlargement applied to ships when zoomed out. */
export const SHIP_VIS_MAX = 3;

/** Knots to metres per second. */
export const KN = 0.5144;

export const toReal = (gameMetres: number) => gameMetres / RANGE_SCALE;
export const toGame = (realMetres: number) => realMetres * RANGE_SCALE;
