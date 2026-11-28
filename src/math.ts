export const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Wrap an angle to (-PI, PI]. */
export function wrap(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** World axes: x east, z south. Bearings are clockwise from north (-z), in radians. */
export const bearing = (x1: number, z1: number, x2: number, z2: number) => Math.atan2(x2 - x1, -(z2 - z1));
export const dir = (b: number): [number, number] => [Math.sin(b), -Math.cos(b)];

/** Standard normal sample (Box-Muller). */
export function gauss(): number {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

/** Linear interpolation in a sorted [x, y] table, clamped at both ends. */
export function interp(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

export const deg3 = (r: number) => String(Math.round(((r / DEG) % 360 + 360) % 360) % 360).padStart(3, '0') + '°';
export const hms = (t: number) => {
  t = Math.floor(t) % 86400;
  return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(v => String(v).padStart(2, '0')).join(':');
};
export const km = (m: number) => (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';

/** Distance from point (px, pz) to the segment a-b. */
export function pointSegDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/** Shortest distance between segments a-b and c-d (0 if they cross). */
export function segSegDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const cross = (ox: number, oz: number, px: number, pz: number, qx: number, qz: number) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
  const d1 = cross(ax, az, bx, bz, cx, cz), d2 = cross(ax, az, bx, bz, dx, dz), d3 = cross(cx, cz, dx, dz, ax, az), d4 = cross(cx, cz, dx, dz, bx, bz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pointSegDist(ax, az, cx, cz, dx, dz), pointSegDist(bx, bz, cx, cz, dx, dz), pointSegDist(cx, cz, ax, az, bx, bz), pointSegDist(dx, dz, ax, az, bx, bz));
}
