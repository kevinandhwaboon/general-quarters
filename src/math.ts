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
