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
  let shells = 0, hits = 0, cit = 0, knocks = 0, secHits = 0;
  for (let t = 0; t < 1800 && e.alive; t += 0.1) {
    w.step(0.1);
    for (const ev of w.events) {
      if (ev.type === 'fire' && ev.ship === p) shells += ev.guns;
      if (ev.type === 'hit' && ev.shell.shooter === p && ev.shell.turret < 0) secHits++;
      else if (ev.type === 'hit' && ev.shell.shooter === p) { hits++; if (ev.result.outcome === 'citadel') cit++; if (ev.result.notes.some(n => n.includes('knocked out'))) knocks++; }
    }
    w.events.length = 0;
  }
  const destroyed = e.mounts.filter(m => m.status === 'destroyed').length;
  return { mode, kind, secHits, secUsed: p.c.sec!.ammo - p.secAmmo, knocks, destroyed, mounts: e.mounts.length, used: p.c.ammo[kind] - p.ammo[kind], shells, hits, cit, rate: hits / Math.max(1, shells), sunkAt: e.alive ? null : Math.round(w.time) };
}
for (const kind of ['ap', 'he'] as ShellType[]) for (const mode of ['idle', 'steam', 'zigzag'] as EnemyMode[]) {
  const rs = Array.from({ length: 12 }, () => trial(mode, 5300, true, kind));
  const avg = (f: (r: typeof rs[0]) => number) => (rs.reduce((a, r) => a + f(r), 0) / rs.length);
  const sunk = rs.filter(r => r.sunkAt !== null);
  console.log(`${kind.toUpperCase()} ${mode.padEnd(7)} hit rate ${(avg(r => r.rate) * 100).toFixed(1)}%  hits ${avg(r => r.hits).toFixed(1)}  citadels ${avg(r => r.cit).toFixed(1)}  mount-hits ${avg(r => r.knocks).toFixed(1)}  destroyed ${avg(r => r.destroyed).toFixed(1)}/${rs[0].mounts}  5-in hits ${avg(r => r.secHits).toFixed(0)}/${avg(r => r.secUsed).toFixed(0)}  rounds ${avg(r => r.used).toFixed(0)}/${NORTH_CAROLINA.ammo[kind]}  sunk ${sunk.length}/12  avg time to sink ${sunk.length ? Math.round(sunk.reduce((a, r) => a + r.sunkAt!, 0) / sunk.length) + ' s' : '-'}`);
}

// Close duel at about 12 km real, both sides firing: what the secondaries add.
{
  const N = 12; let pSec = 0, eSec = 0, pMounts = 0, eMounts = 0, radarDown = 0, pSunk = 0, eSunk = 0, len = 0;
  for (let i = 0; i < N; i++) {
    const w = new World(); w.enemyMode = 'steam'; w.enemyReturnFire = true;
    const p = w.add(new Ship(NORTH_CAROLINA, 'Washington', 'player', 0, 0, 135));
    const e = w.add(new Ship(KONGO, 'Kirishima', 'enemy', 3600 * 0.637, -3600 * 0.771, 250));
    p.telegraph = 4; p.speed = p.maxSpeed * 0.85; p.fc.assign(e);
    let t = 0;
    for (; t < 1200 && p.alive && e.alive; t += 0.1) {
      w.step(0.1);
      if (p.radarSet && p.radarSet.status !== 'ok') radarDown += 0.1;
      for (const ev of w.events) if (ev.type === 'hit' && ev.shell.turret < 0) { if (ev.shell.shooter === p) pSec++; else eSec++; }
      w.events.length = 0;
    }
    len += t;
    pMounts += p.mounts.filter(m => m.status !== 'ok').length; eMounts += e.mounts.filter(m => m.status !== 'ok').length;
    if (!p.alive) pSunk++; if (!e.alive) eSunk++;
  }
  console.log(`duel 12 km: fight ${Math.round(len / N)} s  secondary hits W→K ${(pSec / N).toFixed(1)}  K→W ${(eSec / N).toFixed(1)}  mounts out at end W ${(pMounts / N).toFixed(1)}/${NORTH_CAROLINA.secondaries!.length * 2 + 24}  K ${(eMounts / N).toFixed(1)}/28  Washington radar down ${Math.round(radarDown / N)} s  sunk W ${pSunk}/${N} K ${eSunk}/${N}`);
}
