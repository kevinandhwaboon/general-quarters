import { SHELL_LABEL, ShellType } from './data/guns';
import { KONGO, NORTH_CAROLINA, SOUTH_DAKOTA } from './data/ships';
import { bearing, clamp, DEG, dir, wrap } from './math';
import { Overlay } from './render/overlay';
import { Renderer3D } from './render/renderer';
import { Ship, TELEGRAPH } from './sim/ship';
import { EnemyMode, World } from './sim/world';
import { Hud } from './ui/hud';

const $ = (id: string) => document.getElementById(id)!;
const mapEl = $('map'), glCanvas = $('gl') as HTMLCanvasElement, ovCanvas = $('ov') as HTMLCanvasElement;

const world = new World();
/** The player's ships, in the order they are numbered (keys 1-9). */
let fleet: Ship[] = [];
/** Selected player ships. The first living one is the primary: the panels show it. */
let selection: Ship[] = [];
const r3 = new Renderer3D(glCanvas, world);
const overlay = new Overlay(ovCanvas, r3, world);
let speed = 1, paused = false, follow = false;

const alive = (ss: Ship[]) => ss.filter(s => s.alive);
const enemies = () => world.ships.filter(s => s.side === 'enemy');
const primary = () => alive(selection)[0] ?? alive(fleet)[0] ?? fleet[0];
/** The enemy the panels describe: the primary's target, or the nearest enemy to it. */
const focusTarget = () => { const p = primary(), t = p.fc.target; return t && t.alive ? t : world.nearestEnemy(p) ?? enemies()[0] ?? null; };
/** Ships that receive orders. */
const ordered = () => alive(selection);
const shortName = (s: Ship) => s.name.replace(/^USS /, '');
const names = (ss: Ship[]) => ss.length === 1 ? ss[0].name : ss.map(shortName).join(', ');

const hud = new Hud(world, { fleet: () => fleet, selection: () => selection, primary, target: focusTarget });

/** The trial: Washington leading South Dakota in column at full speed, Kirishima about 20 km (real) away on the bow. */
function setup() {
  world.ships.length = 0; world.shells.length = 0; world.salvos.clear(); world.events.length = 0; world.time = 0;
  const lead = world.add(new Ship(NORTH_CAROLINA, 'USS Washington', 'player', 0, 0, 45));
  // 600 m astern in game distance, about 2 km real-equivalent
  const [fx, fz] = dir(45 * DEG);
  const second = world.add(new Ship(SOUTH_DAKOTA, 'USS South Dakota', 'player', -fx * 600, -fz * 600, 45));
  const kirishima = world.add(new Ship(KONGO, 'Kirishima', 'enemy', 3800, -4600, 250));
  fleet = [lead, second];
  for (const s of fleet) { s.telegraph = 4; s.speed = 0.85 * s.maxSpeed; }
  kirishima.telegraph = 1;
  for (const s of world.ships) s.histT = 0;
  selection = [...fleet];
  hud.pushLog('Kirishima sighted fine on the starboard bow. Both battleships selected: click her to open fire.', 'own');
}
setup();
for (const s of world.ships) r3.addShip(s);
fitAll(true);

function fitAll(instant = false) {
  const ss = alive(world.ships).length ? alive(world.ships) : world.ships;
  const xs = ss.map(s => s.x), zs = ss.map(s => s.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2 + 300;
  const W = clamp(Math.hypot(x1 - x0, z1 - z0) * 1.7, 3000, 40000);
  if (instant) Object.assign(r3.view, { cx, cz, W, anim: null }); else r3.view.anim = { cx, cz, W };
}

function resize() {
  const rect = mapEl.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  r3.resize(Math.max(200, rect.width), Math.max(200, rect.height));
  overlay.resize(Math.max(200, rect.width), Math.max(200, rect.height), dpr);
}
new ResizeObserver(resize).observe(mapEl);
resize();

/* ---------- selection ---------- */
function select(ships: Ship[], add = false) {
  const pick = alive(ships);
  if (!pick.length) return;
  if (!add) selection = pick;
  else if (pick.length === 1 && selection.includes(pick[0])) { if (selection.length > 1) selection = selection.filter(s => s !== pick[0]); }
  else selection = [...selection, ...pick.filter(s => !selection.includes(s))];
}
/** Sunk ships drop out of the selection; if nothing is left, the next living ship is selected. */
function pruneSelection() {
  if (selection.every(s => s.alive)) return;
  selection = alive(selection);
  if (!selection.length && alive(fleet).length) selection = [alive(fleet)[0]];
}

/* ---------- orders (to every selected ship) ---------- */
function engage(target?: Ship) {
  const ss = ordered(); if (!ss.length) return;
  const byTarget = new Map<Ship, Ship[]>();
  for (const s of ss) {
    const t = target && target.alive ? target : world.nearestEnemy(s);
    if (!t) continue;
    s.fc.assign(t);
    byTarget.set(t, [...(byTarget.get(t) ?? []), s]);
  }
  for (const [t, group] of byTarget) hud.pushLog(`${names(group)}: commence firing on ${t.name}`);
}
function steer(delta: number) { for (const s of ordered()) { s.waypoint = null; s.course = wrap((s.course ?? s.heading) + delta * DEG); } }
function steady() { for (const s of ordered()) { s.waypoint = null; s.course = s.heading; } }
function telegraph(i: number) { for (const s of ordered()) s.telegraph = clamp(i, 0, TELEGRAPH.length - 1); }
function stepTelegraph(d: number) { telegraph(primary().telegraph + d); }
function setShell(k: ShellType) {
  const ss = ordered().filter(s => s.shellType !== k); if (!ss.length) return;
  for (const s of ss) s.setShellType(k);
  hud.pushLog(`${names(ss)}: load ${SHELL_LABEL[k]}`);
}
function toggleShell() { setShell(primary().shellType === 'ap' ? 'he' : 'ap'); }
function toggleHold() {
  const ss = ordered(); if (!ss.length) return;
  const hold = !ss.every(s => s.holdFire);
  for (const s of ss) s.holdFire = hold;
  hud.pushLog(`${names(ss)}: ${hold ? 'hold fire' : 'weapons free'}`);
}
function turnToBeam() {
  const ss = ordered().filter(s => s.fc.target?.alive || world.nearestEnemy(s)); if (!ss.length) return;
  for (const s of ss) {
    // put the target on the nearer beam so every turret bears
    const t = s.fc.target?.alive ? s.fc.target : world.nearestEnemy(s)!;
    const rel = wrap(bearing(s.x, s.z, t.x, t.z) - s.heading);
    const want = rel >= 0 ? 90 * DEG : -90 * DEG;
    s.waypoint = null; s.course = wrap(s.heading + rel - want);
  }
  hud.pushLog(`${names(ss)}: turning to bring the target abeam`);
}
/** Move order: the group keeps its shape around the clicked point (formations come later). */
function moveTo(x: number, z: number) {
  const ss = ordered(); if (!ss.length) return;
  const cx = ss.reduce((a, s) => a + s.x, 0) / ss.length, cz = ss.reduce((a, s) => a + s.z, 0) / ss.length;
  for (const s of ss) s.waypoint = { x: x + s.x - cx, z: z + s.z - cz };
}

document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.tel) telegraph(+b.dataset.tel);
  const c = b.dataset.cmd;
  if (c === 'port') steer(-10); else if (c === 'stbd') steer(10); else if (c === 'steady') steady();
  else if (c === 'target') engage(); else if (c === 'hold') toggleHold();
  else if (c === 'beam') turnToBeam();
  if (b.dataset.sp !== undefined) {
    const v = +b.dataset.sp; if (v === 0) paused = !paused; else { paused = false; speed = v; }
    document.querySelectorAll<HTMLButtonElement>('#speed .tbtn').forEach(x => { const sp = +x.dataset.sp!; x.classList.toggle('on', sp === 0 ? paused : !paused && sp === speed); });
  }
  if (b.dataset.mode) {
    world.enemyMode = b.dataset.mode as EnemyMode;
    document.querySelectorAll<HTMLButtonElement>('#enemyMode .tbtn').forEach(x => x.classList.toggle('on', x === b));
    if (world.enemyMode !== 'idle') for (const s of enemies()) s.course = s.heading;
  }
  if (b.dataset.view) {
    follow = b.dataset.view === 'follow';
    document.querySelectorAll<HTMLButtonElement>('.vb[data-view]').forEach(x => x.classList.toggle('on', x === b));
    const p = primary(), t = focusTarget();
    if (b.dataset.view === 'all') fitAll();
    else if (b.dataset.view === 'own') r3.view.anim = { cx: p.x, cz: p.z + 60, W: 1600 };
    else if (b.dataset.view === 'target' && t) r3.view.anim = { cx: t.x, cz: t.z + 60, W: 1600 };
  }
  if (b.id === 'reset') location.reload();
  if (b.id === 'panelBtn') {
    const main = $('main'), on = main.classList.toggle('nopanel');
    b.textContent = on ? 'Show panel' : 'Hide panel'; b.setAttribute('aria-expanded', String(!on));
    requestAnimationFrame(resize);
  }
});
($('returnFire') as HTMLInputElement).addEventListener('change', e => {
  world.enemyReturnFire = (e.target as HTMLInputElement).checked;
  if (!world.enemyReturnFire) for (const s of enemies()) s.fc.assign(null);
});

// panels are redrawn several times a second, so act on press rather than on click
document.addEventListener('pointerdown', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-shell], button[data-pick]');
  if (!b) return;
  if (b.dataset.shell) setShell(b.dataset.shell as ShellType);
  if (b.dataset.pick) select([fleet[+b.dataset.pick]], e.shiftKey);
});
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).closest('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'w') stepTelegraph(1); else if (k === 's') stepTelegraph(-1);
  else if (k === 'a') steer(-10); else if (k === 'd') steer(10);
  else if (k === 'f') toggleShell();
  else if (k === 't') engage(); else if (k === 'h') toggleHold();
  else if (k === 'q') select(fleet);
  else if (/^Digit[1-9]$/.test(e.code) && fleet[+e.code.slice(5) - 1]) select([fleet[+e.code.slice(5) - 1]], e.shiftKey);
  else if (k === ' ') { e.preventDefault(); paused = !paused; }
});

/* ---------- map input ----------
 * Mouse: left-click selects or engages, left-drag draws a selection box, right-click orders
 * (move, or engage an enemy), right- or middle-drag pans. Touch: tap selects or engages,
 * drag pans, long-press orders a move.
 */
type Drag = { x: number; y: number; cx: number; cz: number; moved: boolean; mode: 'box' | 'pan'; button: number; shift: boolean };
let drag: Drag | null = null, lastPointer = 'mouse';
function shipAt(mx: number, my: number): Ship | null {
  let best: Ship | null = null, bd = 1e9;
  for (const s of world.ships) {
    const p = r3.project(s.x, s.z), d = Math.hypot(p.x - mx, p.y - my);
    const lim = Math.max(18, s.c.L * s.vs / r3.metresPerPixel * 0.55);
    if (d < lim && d < bd) { bd = d; best = s; }
  }
  return best;
}
const local = (e: PointerEvent | MouseEvent) => { const r = ovCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function order(mx: number, my: number) {
  const s = shipAt(mx, my);
  if (s && s.side === 'enemy') { engage(s); return; }
  const g = r3.ground(mx, my);
  moveTo(g.x, g.z);
}
ovCanvas.addEventListener('pointerdown', e => {
  lastPointer = e.pointerType;
  if (e.button > 2) return;
  const mode = e.button === 0 && e.pointerType === 'mouse' ? 'box' : 'pan';
  drag = { x: e.clientX, y: e.clientY, cx: r3.view.cx, cz: r3.view.cz, moved: false, mode, button: e.button, shift: e.shiftKey };
  ovCanvas.setPointerCapture(e.pointerId);
  if (e.button === 1) e.preventDefault();
});
ovCanvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
  if (!drag.moved) return;
  if (drag.mode === 'pan') { follow = false; r3.view.anim = null; r3.view.cx = drag.cx - dx * r3.metresPerPixel; r3.view.cz = drag.cz - dy * r3.metresPerPixel / Math.sin(56 * DEG); }
  else { const a = local(e), r = ovCanvas.getBoundingClientRect(); overlay.box = { x0: drag.x - r.left, y0: drag.y - r.top, x1: a.x, y1: a.y }; }
});
ovCanvas.addEventListener('pointerup', e => {
  if (!drag) return;
  const p = local(e);
  if (!drag.moved) {
    if (drag.button === 0) {
      const s = shipAt(p.x, p.y);
      if (s && s.side === 'player') select([s], drag.shift || e.shiftKey);
      else if (s && s.side === 'enemy') engage(s);
    } else if (drag.button === 2) order(p.x, p.y);
  } else if (drag.mode === 'box' && overlay.box) {
    const b = overlay.box, x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const inside = alive(fleet).filter(s => { const q = r3.project(s.x, s.z); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; });
    if (inside.length) select(inside, drag.shift || e.shiftKey);
  }
  overlay.box = null;
  drag = null;
});
ovCanvas.addEventListener('pointercancel', () => { overlay.box = null; drag = null; });
ovCanvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  // a long press on a touch screen is the move order; mouse right-clicks are handled on pointerup
  if (lastPointer !== 'mouse') { drag = null; const p = local(e); order(p.x, p.y); }
});
ovCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const { x: mx, y: my } = local(e);
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
  pruneSelection();
  const p = primary();
  if (follow) { r3.view.cx += (p.x - r3.view.cx) * 0.1; r3.view.cz += (p.z + 60 - r3.view.cz) * 0.1; }
  r3.update(rdt, simDt);
  hud.consumeEvents();
  world.events.length = 0;
  estT -= rdt;
  if (estT <= 0) { estT = 0.5; hud.estimate = world.estimate(p); overlay.estimate = hud.estimate; }
  r3.render();
  overlay.draw(selection, p);
  uiT -= rdt;
  if (uiT <= 0) {
    uiT = 0.25; hud.render();
    $('readout').innerHTML = `View <b>${(r3.view.W / 1000 / 0.3).toFixed(0)} km</b> of range across · ships drawn ×<b>${r3.shipScale().toFixed(1)}</b>`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
