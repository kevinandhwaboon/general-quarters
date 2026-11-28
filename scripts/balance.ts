// Headless balance check: Washington engages Kirishima; reports hit rate and time to sink.
import { ShellType } from '../src/data/guns';
import { FLETCHER, KONGO, NORTH_CAROLINA, SOUTH_DAKOTA } from '../src/data/ships';
import { Formation, FormationType } from '../src/sim/formation';
import { DEG, dir } from '../src/math';
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

// Squadron: Washington leading South Dakota in column (600 m game, about 2 km real, apart) against
// Kirishima at about 12 km, both sides firing. Kirishima engages the nearest ship.
{
  const N = 12; let len = 0, eSunk = 0, wSunk = 0, sdSunk = 0;
  const mainHits = { w: 0, sd: 0, onW: 0, onSD: 0 }, secHits = { w: 0, sd: 0 };
  for (let i = 0; i < N; i++) {
    const w = new World(); w.enemyMode = 'steam'; w.enemyReturnFire = true;
    const [fx, fz] = dir(135 * DEG);
    const wa = w.add(new Ship(NORTH_CAROLINA, 'Washington', 'player', 0, 0, 135));
    const sd = w.add(new Ship(SOUTH_DAKOTA, 'South Dakota', 'player', -fx * 600, -fz * 600, 135));
    const e = w.add(new Ship(KONGO, 'Kirishima', 'enemy', 3600 * 0.637, -3600 * 0.771, 250));
    for (const p of [wa, sd]) { p.telegraph = 4; p.speed = p.maxSpeed * 0.85; p.fc.assign(e); }
    let t = 0;
    for (; t < 1200 && (wa.alive || sd.alive) && e.alive; t += 0.1) {
      w.step(0.1);
      for (const ev of w.events) {
        if (ev.type !== 'hit') continue;
        const sec = ev.shell.turret < 0, by = ev.shell.shooter;
        if (by === wa) sec ? secHits.w++ : mainHits.w++;
        else if (by === sd) sec ? secHits.sd++ : mainHits.sd++;
        else if (!sec) ev.shell.target === wa ? mainHits.onW++ : mainHits.onSD++;
      }
      w.events.length = 0;
    }
    len += t; if (!e.alive) eSunk++; if (!wa.alive) wSunk++; if (!sd.alive) sdSunk++;
  }
  const f = (n: number) => (n / N).toFixed(1);
  console.log(`squadron 2v1 12 km: fight ${Math.round(len / N)} s  main hits W ${f(mainHits.w)} SD ${f(mainHits.sd)}  5-in hits W ${f(secHits.w)} SD ${f(secHits.sd)}  Kirishima's 14-in hits on W ${f(mainHits.onW)} SD ${f(mainHits.onSD)}  sunk K ${eSunk}/${N} W ${wSunk}/${N} SD ${sdSunk}/${N}`);
}

// Formations: two battleships and four destroyers forming up from a loose start, a 90-degree turn
// in succession and together, and how much fire the screen and the column mask.
{
  const make = (type: FormationType) => {
    const w = new World();
    const [fx, fz] = dir(45 * DEG);
    const a = w.add(new Ship(NORTH_CAROLINA, 'W', 'player', 0, 0, 45));
    const b = w.add(new Ship(SOUTH_DAKOTA, 'SD', 'player', -fx * 600 + 200, -fz * 600, 45));
    const dds = [0, 1, 2, 3].map(i => w.add(new Ship(FLETCHER, 'DD' + i, 'player', -300 + i * 150, 300, 45)));
    for (const s of w.ships) { s.telegraph = 4; s.speed = 10; }
    const f = new Formation(type, [a, b], dds); w.formations.push(f);
    return { w, f, a, b };
  };
  const run = (w: World, secs: number) => { for (let i = 0; i < secs * 10; i++) w.step(0.1); w.events.length = 0; };
  const errs = (f: Formation) => f.members.filter(s => s !== f.guide).map(s => Math.round(f.stationError(s))).join('/');
  for (const type of ['column', 'bearing', 'circle'] as FormationType[]) {
    const { w, f } = make(type); run(w, 180);
    console.log(`formation ${type.padEnd(7)}: station errors after 3 min (SD, DD x4) ${errs(f)} m`);
  }
  for (const mode of ['succession', 'together'] as const) {
    const { w, f, a, b } = make('column'); f.turn = mode; run(w, 240);
    const kx = a.x, kz = a.z; a.course = a.heading + 90 * DEG;
    let worst = 0, knuckle = Infinity;
    for (let i = 0; i < 3000; i++) { w.step(0.1); worst = Math.max(worst, f.stationError(b)); knuckle = Math.min(knuckle, Math.hypot(b.x - kx, b.z - kz)); }
    console.log(`turn 90 ${mode.padEnd(10)}: SD worst station error ${Math.round(worst)} m, passes ${Math.round(knuckle)} m from the guide's turning point, errors after 5 min ${errs(f)} m`);
  }
  // masking: guns able to fire as the target bearing moves from dead ahead to the beam
  const { w, f, a, b } = make('column'); run(w, 300);
  const out: string[] = [];
  for (const rel of [0, 15, 30, 60, 90]) {
    const [tx, tz] = dir(a.heading + rel * DEG), e = new Ship(KONGO, 'K', 'enemy', a.x + tx * 4500, a.z + tz * 4500, 0);
    w.ships.push(e); a.fc.assign(e); b.fc.assign(e); for (const s of f.screen) s.fc.assign(e);
    w.step(0.1); w.events.length = 0;
    out.push(`${rel}°: W ${a.turrets.filter(t => !t.blocked).length}/3 SD ${b.turrets.filter(t => !t.blocked).length}/3`);
    w.ships.pop(); w.shells.length = 0; w.salvos.clear();
  }
  console.log(`masking (turrets not blocked by friends, target at bearing off the bow): ${out.join('  ')}`);
}
