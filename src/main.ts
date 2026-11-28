import { SHELL_LABEL, ShellType } from './data/guns';
import { toGame, toReal } from './config';
import { FLETCHER, KAGERO, KONGO, NORTH_CAROLINA, SHOKAKU, SOUTH_DAKOTA, YORKTOWN } from './data/ships';
import { bearing, clamp, DEG, dir, wrap } from './math';
import { Overlay } from './render/overlay';
import { Renderer3D } from './render/renderer';
import { CarrierAI } from './sim/carrierAI';
import { Formation, FORMATION_LABEL, FormationType } from './sim/formation';
import { Ship, TELEGRAPH } from './sim/ship';
import { EnemyMode, World } from './sim/world';
import { Hud } from './ui/hud';

const $ = (id: string) => document.getElementById(id)!;
const mapEl = $('map'), glCanvas = $('gl') as HTMLCanvasElement, ovCanvas = $('ov') as HTMLCanvasElement;

const world = new World();
/** The player's ships. */
let fleet: Ship[] = [];
/** Selected player ships. The first living one is the primary: the panels show it. */
let selection: Ship[] = [];
const r3 = new Renderer3D(glCanvas, world);
const overlay = new Overlay(ovCanvas, r3, world);
let speed = 1, paused = false, follow = false;

const alive = (ss: Ship[]) => ss.filter(s => s.alive);
const enemies = () => world.ships.filter(s => s.side === 'enemy');
const seen = (s: Ship) => world.visibleTo('player', s);
const primary = () => alive(selection)[0] ?? alive(fleet)[0] ?? fleet[0];
/** Nearest enemy ship the player can see. */
const nearestSeen = (p: Ship) => enemies().filter(s => s.alive && seen(s)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] ?? null;
/** The enemy the panels describe: the primary's target, or the nearest enemy in sight. */
const focusTarget = () => { const p = primary(), t = p.fc.target; return t && t.alive && seen(t) ? t : nearestSeen(p); };
/** Ships that receive orders. */
const ordered = () => alive(selection);
/** Ships the player commands directly, in the order they are numbered (keys 1-9): everything but screen escorts. */
const units = () => fleet.filter(s => !world.formationOf(s)?.screen.includes(s));
const inScreen = (s: Ship) => !!world.formationOf(s)?.screen.includes(s);
const shortName = (s: Ship) => s.name.replace(/^USS /, '');
const names = (ss: Ship[]) => ss.length === 1 ? ss[0].name : ss.map(shortName).join(', ');

const hud = new Hud(world, { fleet: () => fleet, units, formations: () => world.formations.filter(f => f.guide.side === 'player'), selection: () => selection, primary, target: focusTarget });

const SCENARIO = new URLSearchParams(location.search).get('scenario') === 'gunnery' ? 'gunnery' : 'carrier';
($('scenario') as HTMLSelectElement).value = SCENARIO;
($('scenario') as HTMLSelectElement).addEventListener('change', e => { location.search = `?scenario=${(e.target as HTMLSelectElement).value}`; });

/** A task group: the guide and her screen in formation, everyone on station. */
function taskGroup(guide: Ship, screen: Ship[], type: FormationType) {
  const f = new Formation(type, [guide], screen);
  world.formations.push(f);
  for (const s of screen) { const st = f.station(s); s.x = st.x; s.z = st.z; }
  for (const s of [guide, ...screen]) { s.telegraph = 4; s.speed = 0.85 * guide.maxSpeed; }
  return f;
}

/**
 * Squadron trial: Washington leading South Dakota in column at full speed with four destroyers
 * screening ahead, Kirishima about 20 km (real) away on the bow.
 */
function setupGunnery() {
  $('opName').textContent = 'Squadron trial'; $('opSub').textContent = 'Washington, South Dakota and screen vs Kirishima';
  const lead = world.add(new Ship(NORTH_CAROLINA, 'USS Washington', 'player', 0, 0, 45));
  const second = world.add(new Ship(SOUTH_DAKOTA, 'USS South Dakota', 'player', 0, 0, 45));
  const screen = ['USS Fletcher', "USS O'Bannon", 'USS Nicholas', 'USS Radford'].map(n => world.add(new Ship(FLETCHER, n, 'player', 0, 0, 45)));
  const kirishima = world.add(new Ship(KONGO, 'Kirishima', 'enemy', 3800, -4600, 250));
  fleet = [lead, second, ...screen];
  const f = new Formation('column', [lead, second], screen);
  world.formations.push(f);
  for (const s of fleet) { if (s !== lead) { const st = f.station(s); s.x = st.x; s.z = st.z; } s.telegraph = 4; s.speed = 0.85 * lead.maxSpeed; }
  kirishima.telegraph = 1;
  selection = [lead, second];
  hud.pushLog('Kirishima sighted fine on the starboard bow. Battleships in column, destroyers screening ahead. Click her to open fire.', 'own');
}

/**
 * Carrier trial: Yorktown and four destroyers against Shōkaku and four, somewhere 150-190 nm to
 * the north-west. Neither side knows where the other is; a patrol plane's report two hours old
 * gives the player a rough idea.
 */
function setupCarrier() {
  $('opName').textContent = 'Carrier trial'; $('opSub').textContent = 'Yorktown and screen vs Shōkaku · find her first';
  document.querySelector<HTMLElement>('.test')!.style.display = 'none';
  world.fog = true; world.enemyControl = 'ai'; world.wind = { from: 120 * DEG, kn: 14 };
  const yk = world.add(new Ship(YORKTOWN, 'USS Yorktown', 'player', 0, 0, 300));
  const usdd = ['USS Fletcher', "USS O'Bannon", 'USS Nicholas', 'USS Radford'].map(n => world.add(new Ship(FLETCHER, n, 'player', 0, 0, 300)));
  taskGroup(yk, usdd, 'circle');
  const brg = (300 + Math.random() * 60) * DEG, R = toGame((150 + Math.random() * 40) * 1852), [bx, bz] = dir(brg);
  const sk = world.add(new Ship(SHOKAKU, 'Shōkaku', 'enemy', bx * R, bz * R, 140));
  const ijdd = ['Isokaze', 'Urakaze', 'Tanikaze', 'Hamakaze'].map(n => world.add(new Ship(KAGERO, n, 'enemy', bx * R, bz * R, 140)));
  taskGroup(sk, ijdd, 'circle');
  world.ais = [new CarrierAI('enemy', { searchBearing: brg + Math.PI + (Math.random() - 0.5) * 0.5, searchN: 6 })];
  // a patrol plane's sighting two hours ago, well off the true position
  const err = toGame(60_000), ex = bx * R + (Math.random() - 0.5) * err, ez = bz * R + (Math.random() - 0.5) * err;
  world.intel.player.contacts.set(sk, { ship: sk, x: ex, z: ez, heading: 140 * DEG, time: -2 * 3600, type: 'carrier', exact: false });
  fleet = [yk, ...usdd];
  selection = [yk];
  const nm = Math.round(toReal(Math.hypot(ex, ez)) / 1852), b3 = String(Math.round(((Math.atan2(ex, -ez) / DEG) % 360 + 360) % 360)).padStart(3, '0');
  hud.pushLog(`A patrol plane reported an enemy carrier two hours ago, ${nm} nm away on bearing ${b3}°. Search for her (Search, then click the map), then strike.`, 'own');
  hud.pushLog('Yorktown keeps eight fighters on combat air patrol. Flight operations need her heading into the wind.', 'own');
}

function setup() {
  world.ships.length = 0; world.shells.length = 0; world.salvos.clear(); world.events.length = 0; world.time = 0; world.formations.length = 0;
  if (SCENARIO === 'gunnery') setupGunnery(); else setupCarrier();
  for (const s of world.ships) s.histT = 0;
}
setup();
for (const s of world.ships) r3.addShip(s);
// ?debug exposes the world for automated browser tests
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { gq: { world, r3, select: (s: Ship[]) => { selection = s; } } });
if (SCENARIO === 'carrier') {
  // open zoomed out over the task group and the old report
  const c = [...world.intel.player.contacts.values()][0];
  Object.assign(r3.view, { cx: c.x / 2, cz: c.z / 2, W: clamp(Math.hypot(c.x, c.z) * 1.6, 20_000, 300_000), anim: null });
} else fitAll(true);

function fitAll(instant = false) {
  const vis = world.ships.filter(seen), ss = alive(vis).length ? alive(vis) : vis;
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

/** Clicking a screen escort selects her formation's guide; Alt-click selects the escort herself. */
const pickable = (s: Ship, alt: boolean) => !alt && inScreen(s) ? world.formationOf(s)!.guide : s;

/* ---------- orders (to every selected ship) ---------- */
/**
 * Ships that take a movement order. A guide takes it for her whole formation, and members whose
 * guide is also selected simply follow. A member ordered on her own leaves the formation.
 */
function movers(): Ship[] {
  const ss = ordered(), out: Ship[] = [], left: Ship[] = [];
  for (const s of ss) {
    const f = world.formationOf(s);
    if (!f || f.guide === s) { out.push(s); continue; }
    if (ss.includes(f.guide)) continue;
    f.remove(s); left.push(s); out.push(s);
  }
  if (left.length) hud.pushLog(`${names(left)} ${left.length === 1 ? 'leaves' : 'leave'} the formation`);
  pruneFormations();
  return out;
}
function pruneFormations() { world.formations = world.formations.filter(f => { if (f.empty) { f.dissolve(); return false; } return true; }); }

function engage(target?: Ship) {
  const ss = ordered(); if (!ss.length) return;
  const byTarget = new Map<Ship, Ship[]>();
  for (const s of ss) {
    const t = target && target.alive ? target : nearestSeen(s);
    if (!t) continue;
    s.fc.assign(t);
    byTarget.set(t, [...(byTarget.get(t) ?? []), s]);
  }
  for (const [t, group] of byTarget) hud.pushLog(`${names(group)}: commence firing on ${t.name}`);
}
function steer(delta: number) { for (const s of movers()) { s.waypoint = null; s.course = wrap((s.course ?? s.heading) + delta * DEG); } }
function steady() { for (const s of movers()) { s.waypoint = null; s.course = s.heading; } }
function telegraph(i: number) { for (const s of movers()) s.telegraph = clamp(i, 0, TELEGRAPH.length - 1); }
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
  const ss = movers().filter(s => s.fc.target?.alive || nearestSeen(s)); if (!ss.length) return;
  for (const s of ss) {
    // put the target on the nearer beam so every turret bears
    const t = s.fc.target?.alive ? s.fc.target : nearestSeen(s)!;
    const rel = wrap(bearing(s.x, s.z, t.x, t.z) - s.heading);
    const want = rel >= 0 ? 90 * DEG : -90 * DEG;
    s.waypoint = null; s.course = wrap(s.heading + rel - want);
  }
  hud.pushLog(`${names(ss)}: turning to bring the target abeam`);
}
/** Move order: the group keeps its shape around the clicked point (formations come later). */
function moveTo(x: number, z: number) {
  const ss = movers(); if (!ss.length) return;
  const cx = ss.reduce((a, s) => a + s.x, 0) / ss.length, cz = ss.reduce((a, s) => a + s.z, 0) / ss.length;
  for (const s of ss) s.waypoint = { x: x + s.x - cx, z: z + s.z - cz };
}

/* ---------- formations ---------- */
/** The ships a formation order covers: a selected guide brings her whole formation. */
function shipsToForm(): Ship[] {
  const set = new Set<Ship>();
  for (const s of ordered()) { const f = world.formationOf(s); (f && f.guide === s ? alive(f.members) : [s]).forEach(m => set.add(m)); }
  return [...set];
}
/** Line of bearing stepped back on the side away from the enemy, so the line never masks its own fire. */
function awaySide(g: Ship) {
  const t = g.fc.target?.alive ? g.fc.target : nearestSeen(g);
  return t && wrap(bearing(g.x, g.z, t.x, t.z) - g.heading) > 0 ? -135 * DEG : 135 * DEG;
}
function form(type: FormationType) {
  const ships = shipsToForm();
  const same = world.formations.find(f => alive(f.members).length === ships.length && ships.every(s => f.has(s)));
  if (same) {
    same.type = type; if (type === 'bearing') same.lineBearing = awaySide(same.guide);
    same.reform();
    hud.pushLog(`${same.guide.name}: form ${FORMATION_LABEL[type].toLowerCase()}`);
    return;
  }
  if (ships.length < 2) { hud.pushLog('Select two or more ships to form up.'); return; }
  for (const s of ships) world.formationOf(s)?.remove(s);
  pruneFormations();
  let line = ships.filter(s => s.c.type !== 'DD'), screen = ships.filter(s => s.c.type === 'DD');
  if (!line.length) { line = screen; screen = []; }
  const g = line.includes(primary()) ? primary() : line[0], [hx, hz] = dir(g.heading);
  // the rest of the line in order astern of the guide
  const ahead = (s: Ship) => (s.x - g.x) * hx + (s.z - g.z) * hz;
  line = [g, ...line.filter(s => s !== g).sort((a, b) => ahead(b) - ahead(a))];
  const f = new Formation(type, line, screen);
  if (type === 'bearing') f.lineBearing = awaySide(g);
  world.formations.push(f);
  if (!selection.includes(g)) selection = [g, ...selection];
  hud.pushLog(`${FORMATION_LABEL[type]} formed on ${g.name}: ${line.length} in line${screen.length ? `, ${screen.length} screening` : ''}`);
}
/** Formations whose guide is selected. */
const selectedFormations = () => world.formations.filter(f => ordered().includes(f.guide));
function breakFormation() {
  const done: string[] = [];
  for (const s of ordered()) {
    const f = world.formationOf(s); if (!f) continue;
    if (f.guide === s) { f.dissolve(); done.push(`${s.name}: formation dissolved`); }
    else { f.remove(s); done.push(`${s.name} leaves the formation`); }
  }
  pruneFormations();
  done.forEach(t => hud.pushLog(t));
}
function reform() { for (const f of selectedFormations()) { f.reform(); hud.pushLog(`${f.guide.name}: re-form on the guide's course`); } }
function toggleTurn() {
  for (const f of selectedFormations()) { f.setTurn(f.turn === 'succession' ? 'together' : 'succession'); hud.pushLog(`${f.guide.name}: turns ${f.turn === 'succession' ? 'in succession' : 'together'}`); }
}
/** Send one destroyer from the screen on her own; she is selected. */
function detach(f: Formation) {
  const dd = f.screen.find(s => s.alive); if (!dd) return;
  f.remove(dd); pruneFormations();
  selection = [dd];
  hud.pushLog(`${dd.name} detached from the screen`);
}
/** Selected destroyers steaming independently rejoin the nearest formation's screen. */
function rejoin() {
  for (const s of ordered().filter(o => o.c.type === 'DD' && !world.formationOf(o))) {
    const fs = world.formations.filter(f => f.guide.side === s.side);
    const f = fs.sort((a, b) => Math.hypot(a.guide.x - s.x, a.guide.z - s.z) - Math.hypot(b.guide.x - s.x, b.guide.z - s.z))[0];
    if (!f) { hud.pushLog('No formation to rejoin.'); return; }
    f.screen.push(s); selection = selection.filter(o => o !== s);
    hud.pushLog(`${s.name} rejoins ${f.guide.name}'s screen`);
  }
  pruneSelection();
}

/* ---------- air operations ---------- */
let pending: { kind: 'search' | 'strike'; carrier: Ship } | null = null;
function setPending(p: typeof pending) { pending = p; overlay.pending = p; ovCanvas.style.cursor = p ? 'cell' : ''; }
/** Steer a carrier (or the guide of her formation) into the wind for flight operations. */
function intoWind(cv: Ship) {
  const f = world.formationOf(cv), g = f ? f.guide : cv;
  g.waypoint = null; g.course = world.wind.from;
  hud.pushLog(`${g.name}: turning into the wind`);
}
/** Carry out a search or strike order at a point on the map (or a contact or ship near it). */
function airOrder(mx: number, my: number) {
  if (!pending) return;
  const cv = pending.carrier, kind = pending.kind;
  setPending(null);
  if (!cv.alive || !cv.air) return;
  const gp = r3.ground(mx, my);
  let tx = gp.x, tz = gp.z, track: { heading: number; kn: number } | undefined;
  const ship = shipAt(mx, my);
  const contact = [...world.intel.player.contacts.values()].filter(c => !c.exact).find(c => { const p = r3.project(c.x, c.z); return Math.hypot(p.x - mx, p.y - my) < 22; });
  if (ship && ship.side === 'enemy') { tx = ship.x; tz = ship.z; track = { heading: ship.heading, kn: ship.speed / 0.5144 }; }
  else if (contact) {
    // dead reckoning from the report: where she should be now at about 20 knots
    const age = world.time - contact.time, v = 20 * 0.5144, [hx, hz] = dir(contact.heading);
    tx = contact.x + hx * v * Math.min(age, 3600); tz = contact.z + hz * v * Math.min(age, 3600); track = { heading: contact.heading, kn: 20 };
  }
  if (kind === 'search') {
    const err = world.air.orderSearch(cv, bearing(cv.x, cv.z, tx, tz), 6, 90 * DEG);
    hud.pushLog(err ? `${cv.name}: ${err}` : `${cv.name}: search ordered, six aircraft across 90° centred on ${String(Math.round(((bearing(cv.x, cv.z, tx, tz) / DEG) % 360 + 360) % 360)).padStart(3, '0')}°`, err ? '' : 'own');
  } else {
    const msg = world.air.orderStrike(cv, tx, tz, track);
    const queued = cv.air.queue.some(o => o.flights.some(f => f.mission === 'strike' && f.n === 0));
    if (queued) hud.pushLog(`${cv.name}: strike ordered${track ? ' on the contact' : ''}, ${Math.round(toReal(Math.hypot(tx - cv.x, tz - cv.z)) / 1852)} nm out`, 'own');
    if (msg) hud.pushLog(`${cv.name}: ${msg}`, queued ? 'own' : '');
  }
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
const PRESS = 'button[data-shell], button[data-pick], button[data-fsel], button[data-form], button[data-fcmd], button[data-air], button[data-cap], button[data-recall]';
function press(b: HTMLButtonElement, shift: boolean) {
  const cv = primary();
  if (b.dataset.air === 'wind' && cv.air) intoWind(cv);
  if ((b.dataset.air === 'search' || b.dataset.air === 'strike') && cv.air && cv.alive) setPending(pending?.kind === b.dataset.air ? null : { kind: b.dataset.air, carrier: cv });
  if (b.dataset.cap && cv.air) { cv.air.capTarget = +b.dataset.cap; hud.pushLog(`${cv.name}: combat air patrol of ${b.dataset.cap} fighters`); }
  if (b.dataset.recall) { const f = world.air.flights.find(o => o.id === +b.dataset.recall!); if (f) { world.air.recall(f); hud.pushLog(`${f.label}: recalled`); } }
  if (b.dataset.shell) setShell(b.dataset.shell as ShellType);
  if (b.dataset.pick) select([fleet[+b.dataset.pick]], shift);
  if (b.dataset.fsel) { const f = world.formations[+b.dataset.fsel]; if (f) select(f.line, shift); }
  if (b.dataset.form) form(b.dataset.form as FormationType);
  const c = b.dataset.fcmd;
  if (c === 'turn') toggleTurn(); else if (c === 'reform') reform(); else if (c === 'break') breakFormation(); else if (c === 'rejoin') rejoin();
  else if (c === 'detach') { const f = world.formations[+b.dataset.f!]; if (f) detach(f); }
}
document.addEventListener('pointerdown', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(PRESS);
  if (b && e.button === 0) press(b, e.shiftKey);
});
// keyboard activation (Enter or Space on a focused button) arrives as a click with no pointer
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(PRESS);
  if (b && e.detail === 0) press(b, e.shiftKey);
});
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).closest('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'w') stepTelegraph(1); else if (k === 's') stepTelegraph(-1);
  else if (k === 'a') steer(-10); else if (k === 'd') steer(10);
  else if (k === 'f') toggleShell();
  else if (k === 't') engage(); else if (k === 'h') toggleHold();
  else if (k === 'q') select(units());
  else if (k === 'c') form('column'); else if (k === 'b') form('bearing'); else if (k === 'o') form('circle');
  else if (k === 'r') reform(); else if (k === 'v') toggleTurn(); else if (k === 'x') breakFormation();
  else if (/^Digit[1-9]$/.test(e.code) && units()[+e.code.slice(5) - 1]) select([units()[+e.code.slice(5) - 1]], e.shiftKey);
  else if (k === 'escape') setPending(null);
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
    if (!seen(s)) continue;
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
  overlay.mouse = local(e);
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
  if (!drag.moved && pending) {
    if (drag.button === 0) airOrder(p.x, p.y); else setPending(null);
  } else if (!drag.moved) {
    if (drag.button === 0) {
      const s = shipAt(p.x, p.y);
      if (s && s.side === 'player') select([pickable(s, e.altKey)], drag.shift || e.shiftKey);
      else if (s && s.side === 'enemy') engage(s);
    } else if (drag.button === 2) order(p.x, p.y);
  } else if (drag.mode === 'box' && overlay.box) {
    const b = overlay.box, x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const inside = alive(units()).filter(s => { const q = r3.project(s.x, s.z); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; });
    if (inside.length) select(inside, drag.shift || e.shiftKey);
  }
  overlay.box = null;
  drag = null;
});
// double-click a ship to select her whole formation
ovCanvas.addEventListener('dblclick', e => {
  const p = local(e), s = shipAt(p.x, p.y);
  if (!s || s.side !== 'player') return;
  const f = world.formationOf(s);
  if (f) select(f.line, e.shiftKey);
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
  r3.view.W = clamp(r3.view.W * Math.exp(e.deltaY * 0.0013), 500, 700_000);
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
    const across = toReal(r3.view.W);
    $('readout').innerHTML = `View <b>${across > 100_000 ? Math.round(across / 1852) + ' nm' : (across / 1000).toFixed(0) + ' km'}</b> across · ships drawn ×<b>${r3.shipScale().toFixed(1)}</b>`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
