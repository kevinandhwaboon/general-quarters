import { SHELL_LABEL, ShellType } from './data/guns';
import { KONGO, NORTH_CAROLINA } from './data/ships';
import { bearing, clamp, DEG, wrap } from './math';
import { Overlay } from './render/overlay';
import { Renderer3D } from './render/renderer';
import { Ship, TELEGRAPH } from './sim/ship';
import { EnemyMode, World } from './sim/world';
import { Hud } from './ui/hud';

const $ = (id: string) => document.getElementById(id)!;
const mapEl = $('map'), glCanvas = $('gl') as HTMLCanvasElement, ovCanvas = $('ov') as HTMLCanvasElement;

let world = new World();
let player!: Ship, enemy!: Ship;
const r3 = new Renderer3D(glCanvas, world);
const overlay = new Overlay(ovCanvas, r3, world);
const hud = new Hud(world, () => player, () => enemy);
let selected: Ship | null = null;
let speed = 1, paused = false, follow = false;

/** The trial: Washington steaming at full speed, Kirishima about 20 km (real) away on her bow. */
function setup() {
  world.ships.length = 0; world.shells.length = 0; world.salvos.clear(); world.events.length = 0; world.time = 0;
  player = world.add(new Ship(NORTH_CAROLINA, 'USS Washington', 'player', 0, 0, 45));
  enemy = world.add(new Ship(KONGO, 'Kirishima', 'enemy', 3800, -4600, 250));
  player.telegraph = 4; player.speed = 0.85 * player.maxSpeed;
  enemy.telegraph = 1;
  for (const s of world.ships) s.histT = 0;
  selected = player;
  hud.pushLog('Kirishima sighted fine on the starboard bow. Click her to open fire.', 'own');
}
setup();
r3.addShip(player); r3.addShip(enemy);
fitBoth(true);

function fitBoth(instant = false) {
  const cx = (player.x + enemy.x) / 2, cz = (player.z + enemy.z) / 2 + 300;
  const W = clamp(Math.hypot(enemy.x - player.x, enemy.z - player.z) * 1.7, 3000, 40000);
  if (instant) Object.assign(r3.view, { cx, cz, W, anim: null }); else r3.view.anim = { cx, cz, W };
}

function resize() {
  const rect = mapEl.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  r3.resize(Math.max(200, rect.width), Math.max(200, rect.height));
  overlay.resize(Math.max(200, rect.width), Math.max(200, rect.height), dpr);
}
new ResizeObserver(resize).observe(mapEl);
resize();

/* ---------- orders ---------- */
function engage() { if (player.alive && enemy.alive) { player.fc.assign(enemy); hud.pushLog(`${player.name}: commence firing on ${enemy.name}`); } }
function steer(delta: number) { player.waypoint = null; player.course = wrap((player.course ?? player.heading) + delta * DEG); }
function telegraph(i: number) { player.telegraph = clamp(i, 0, TELEGRAPH.length - 1); }
function setShell(k: ShellType) {
  if (k === player.shellType) return;
  player.setShellType(k);
  hud.pushLog(`${player.name}: load ${SHELL_LABEL[k]}`);
}
function turnToBeam() {
  // put the target on the nearer beam so every turret bears
  const rel = wrap(bearing(player.x, player.z, enemy.x, enemy.z) - player.heading);
  const want = rel >= 0 ? 90 * DEG : -90 * DEG;
  player.waypoint = null; player.course = wrap(player.heading + rel - want);
  hud.pushLog(`${player.name}: turning to bring the target abeam`);
}

document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.tel) telegraph(+b.dataset.tel);
  if (b.dataset.shell) setShell(b.dataset.shell as ShellType);
  const c = b.dataset.cmd;
  if (c === 'port') steer(-10); else if (c === 'stbd') steer(10); else if (c === 'steady') { player.waypoint = null; player.course = player.heading; }
  else if (c === 'target') engage(); else if (c === 'hold') { player.holdFire = !player.holdFire; hud.pushLog(`${player.name}: ${player.holdFire ? 'hold fire' : 'weapons free'}`); }
  else if (c === 'beam') turnToBeam();
  if (b.dataset.sp !== undefined) {
    const v = +b.dataset.sp; if (v === 0) paused = !paused; else { paused = false; speed = v; }
    document.querySelectorAll<HTMLButtonElement>('#speed .tbtn').forEach(x => { const sp = +x.dataset.sp!; x.classList.toggle('on', sp === 0 ? paused : !paused && sp === speed); });
  }
  if (b.dataset.mode) {
    world.enemyMode = b.dataset.mode as EnemyMode;
    document.querySelectorAll<HTMLButtonElement>('#enemyMode .tbtn').forEach(x => x.classList.toggle('on', x === b));
    if (world.enemyMode !== 'idle') enemy.course = enemy.heading;
  }
  if (b.dataset.view) {
    follow = b.dataset.view === 'follow';
    document.querySelectorAll<HTMLButtonElement>('.vb[data-view]').forEach(x => x.classList.toggle('on', x === b));
    if (b.dataset.view === 'both') fitBoth();
    else if (b.dataset.view === 'own') r3.view.anim = { cx: player.x, cz: player.z + 60, W: 1600 };
    else if (b.dataset.view === 'target') r3.view.anim = { cx: enemy.x, cz: enemy.z + 60, W: 1600 };
  }
  if (b.id === 'reset') location.reload();
  if (b.id === 'panelBtn') {
    const main = $('main'), on = main.classList.toggle('nopanel');
    b.textContent = on ? 'Show panel' : 'Hide panel'; b.setAttribute('aria-expanded', String(!on));
    requestAnimationFrame(resize);
  }
});
($('returnFire') as HTMLInputElement).addEventListener('change', e => { world.enemyReturnFire = (e.target as HTMLInputElement).checked; if (!world.enemyReturnFire) enemy.fc.assign(null); });

// the fire-control panel is redrawn several times a second, so act on press rather than on click
document.addEventListener('pointerdown', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-shell]');
  if (b) setShell(b.dataset.shell as ShellType);
});
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).closest('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'w') telegraph(player.telegraph + 1); else if (k === 's') telegraph(player.telegraph - 1);
  else if (k === 'a') steer(-10); else if (k === 'd') steer(10);
  else if (k === 'f') setShell(player.shellType === 'ap' ? 'he' : 'ap');
  else if (k === 't') engage(); else if (k === 'h') { player.holdFire = !player.holdFire; }
  else if (k === ' ') { e.preventDefault(); paused = !paused; }
});

/* ---------- map input ---------- */
let drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
function shipAt(mx: number, my: number): Ship | null {
  let best: Ship | null = null, bd = 1e9;
  for (const s of world.ships) {
    const p = r3.project(s.x, s.z), d = Math.hypot(p.x - mx, p.y - my);
    const lim = Math.max(18, s.c.L * s.vs / r3.metresPerPixel * 0.55);
    if (d < lim && d < bd) { bd = d; best = s; }
  }
  return best;
}
ovCanvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, cx: r3.view.cx, cz: r3.view.cz, moved: false }; ovCanvas.setPointerCapture(e.pointerId); });
ovCanvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
  if (drag.moved) { follow = false; r3.view.anim = null; r3.view.cx = drag.cx - dx * r3.metresPerPixel; r3.view.cz = drag.cz - dy * r3.metresPerPixel / Math.sin(56 * DEG); }
});
ovCanvas.addEventListener('pointerup', e => {
  if (drag && !drag.moved) {
    const rect = ovCanvas.getBoundingClientRect(), s = shipAt(e.clientX - rect.left, e.clientY - rect.top);
    if (s === player) selected = player;
    else if (s === enemy) engage();
  }
  drag = null;
});
ovCanvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!player.alive) return;
  const rect = ovCanvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
  if (shipAt(mx, my) === enemy) { engage(); return; }
  const g = r3.ground(mx, my);
  player.waypoint = { x: g.x, z: g.z };
});
ovCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = ovCanvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const g1 = r3.ground(mx, my);
  r3.view.anim = null;
  r3.view.W = clamp(r3.view.W * Math.exp(e.deltaY * 0.0013), 500, 60000);
  r3.setCamera();
  const g2 = r3.ground(mx, my);
  r3.view.cx += g1.x - g2.x; r3.view.cz += g1.z - g2.z;
  document.querySelectorAll('.vb[data-view]').forEach(x => x.classList.remove('on'));
}, { passive: false });

/* ---------- loop ---------- */
let last = performance.now(), uiT = 0, estT = 0;
function frame(now: number) {
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  let simDt = 0;
  if (!paused) { let h = rdt * speed; simDt = h; while (h > 0) { const k = Math.min(h, 0.1); world.step(k); h -= k; } }
  if (follow) { r3.view.cx += (player.x - r3.view.cx) * 0.1; r3.view.cz += (player.z + 60 - r3.view.cz) * 0.1; }
  r3.update(rdt, simDt);
  hud.consumeEvents();
  world.events.length = 0;
  estT -= rdt;
  if (estT <= 0) { estT = 0.5; hud.estimate = world.estimate(player); overlay.estimate = hud.estimate; }
  r3.render();
  overlay.draw(selected);
  uiT -= rdt;
  if (uiT <= 0) {
    uiT = 0.25; hud.render();
    $('readout').innerHTML = `View <b>${(r3.view.W / 1000 / 0.3).toFixed(0)} km</b> of range across · ships drawn ×<b>${r3.shipScale().toFixed(1)}</b>`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
