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

/**
 * Deck operations (launch, recovery, fuelling and arming) and deck repairs take this fraction of
 * their real time. Ships and aircraft move at real speed over compressed distances, so they
 * cover the map 1 / RANGE_SCALE times faster than in reality; work on deck keeps the same pace.
 */
export const AIR_TIME_SCALE = RANGE_SCALE;

/** Largest visual enlargement applied to ships when zoomed out. */
export const SHIP_VIS_MAX = 3;

/** Knots to metres per second. */
export const KN = 0.5144;

export const toReal = (gameMetres: number) => gameMetres / RANGE_SCALE;
export const toGame = (realMetres: number) => realMetres * RANGE_SCALE;
