// Headless balance check: Washington engages Kirishima; reports hit rate and time to sink.
import { ShellType } from '../src/data/guns';
import { KONGO, NORTH_CAROLINA } from '../src/data/ships';
import { Ship } from '../src/sim/ship';
import { EnemyMode, World } from '../src/sim/world';

function trial(mode: EnemyMode, startDist: number, broadside: boolean, kind: ShellType = 'ap') {
  const w = new World(); w.enemyMode = mode;
  const p = w.add(new Ship(NORTH_CAROLINA, 'Washington', 'player', 0, 0, broadside ? 135 : 45));
  const e = w.add(new Ship(KONGO, 'Kirishima', 'enemy', startDist * 0.637, -startDist * 0.771, 250));
  p.telegraph = 2; p.speed = p.maxSpeed * 0.33; p.loadAll(kind); p.fc.assign(e);
  let shells = 0, hits = 0, cit = 0;
  for (let t = 0; t < 1800 && e.alive; t += 0.1) {
    w.step(0.1);
    for (const ev of w.events) {
      if (ev.type === 'fire' && ev.ship === p) shells += ev.guns;
      if (ev.type === 'hit' && ev.shell.shooter === p) { hits++; if (ev.result.outcome === 'citadel') cit++; }
    }
    w.events.length = 0;
  }
  return { mode, kind, used: p.c.ammo[kind] - p.ammo[kind], shells, hits, cit, rate: hits / Math.max(1, shells), sunkAt: e.alive ? null : Math.round(w.time) };
}
for (const kind of ['ap', 'he'] as ShellType[]) for (const mode of ['idle', 'steam', 'zigzag'] as EnemyMode[]) {
  const rs = Array.from({ length: 12 }, () => trial(mode, 5300, true, kind));
  const avg = (f: (r: typeof rs[0]) => number) => (rs.reduce((a, r) => a + f(r), 0) / rs.length);
  const sunk = rs.filter(r => r.sunkAt !== null);
  console.log(`${kind.toUpperCase()} ${mode.padEnd(7)} hit rate ${(avg(r => r.rate) * 100).toFixed(1)}%  hits ${avg(r => r.hits).toFixed(1)}  citadels ${avg(r => r.cit).toFixed(1)}  rounds ${avg(r => r.used).toFixed(0)}/${NORTH_CAROLINA.ammo[kind]}  sunk ${sunk.length}/12  avg time to sink ${sunk.length ? Math.round(sunk.reduce((a, r) => a + r.sunkAt!, 0) / sunk.length) + ' s' : '-'}`);
}
