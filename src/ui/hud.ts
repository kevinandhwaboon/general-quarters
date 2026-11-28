import { KN, toReal } from '../config';
import { GunSpec, SHELL_LABEL, ShellType } from '../data/guns';
import { ShipClass } from '../data/ships';
import { bearing, clamp, DEG, deg3, hms, interp, km, wrap } from '../math';
import { Zone, ZONE_LABEL } from '../sim/combat';
import { hullProfile } from '../sim/hull';
import { STATE_LABEL } from '../sim/air';
import { Formation, FORMATION_LABEL } from '../sim/formation';
import { canBear, isAA, isSecondary, Mount, mountBears, Ship, TELEGRAPH } from '../sim/ship';
import { World } from '../sim/world';

const $ = (id: string) => document.getElementById(id)!;
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const ZONE_COLOUR: Record<Zone, string> = {
  belt: '#ff5f55', upperSide: '#ff9a6a', deck: '#f2b23e', ends: '#7d8b96', endsDeck: '#5d6a74',
  turretFace: '#b99dff', turretRoof: '#8f73e0', conning: '#47d7c1', superstructure: '#a9c4d6', funnel: '#6c7f8e',
};

type Estimate = ReturnType<World['estimate']>;

function beltEffective(c: ShipClass, aspect: number, fall: number) {
  // horizontal angle between shell path and the side normal is (90° - |aspect|)
  const h = Math.PI / 2 - Math.abs(Math.asin(Math.sin(Math.abs(aspect))));
  const i = c.armour.beltIncl * DEG;
  // shell direction relative to the plate: horizontal component cos(fall)*cos(h), vertical sin(fall)
  const cos = clamp(Math.cos(fall) * Math.cos(h) * Math.cos(i) - Math.sin(fall) * Math.sin(i), 0.02, 1);
  return { eff: c.armour.belt / cos, obl: Math.acos(cos) };
}
function deckEffective(c: ShipClass, fall: number) {
  const cos = clamp(Math.sin(fall), 0.02, 1);
  return { eff: c.armour.deck / cos, obl: Math.acos(cos) };
}

/** Real-range band (km) where this armour defeats that gun at the given aspect. */
export function immuneZone(c: ShipClass, gun: GunSpec, aspect: number): [number, number] | null {
  let lo: number | null = null, hi: number | null = null;
  for (let r = 3; r <= gun.maxRangeKm; r += 0.25) {
    const fall = interp(gun.fallDeg, r) * DEG, pen = interp(gun.penNormal, r);
    const b = beltEffective(c, aspect, fall), d = deckEffective(c, fall);
    const beltHolds = pen < b.eff || b.obl > 65 * DEG, deckHolds = pen < d.eff || d.obl > 65 * DEG;
    if (beltHolds && deckHolds) { if (lo === null) lo = r; hi = r; }
  }
  return lo === null || hi === null ? null : [lo, hi];
}

/** What the HUD reads from the game: the player's ships, the selection, the ship the panels show and its target. */
export interface HudSource {
  fleet: () => Ship[];
  /** Ships the player commands directly, in numbered order (screen escorts excluded). */
  units: () => Ship[];
  formations: () => Formation[];
  selection: () => Ship[];
  primary: () => Ship;
  target: () => Ship | null;
}

export class Hud {
  private logLines: { t: number; text: string; cls: string }[] = [];
  private actx: CanvasRenderingContext2D;
  estimate: Estimate = null;
  constructor(private world: World, private src: HudSource) {
    this.actx = ($('aspect') as HTMLCanvasElement).getContext('2d')!;
    $('telegraph').innerHTML = TELEGRAPH.map((t, i) => `<button class="cmd" data-tel="${i}">${t.key}</button>`).join('');
  }

  consumeEvents() {
    for (const e of this.world.events) if (e.type === 'log') this.logLines.push({ t: this.world.time, text: e.text, cls: e.cls });
    if (this.logLines.length > 7) this.logLines.splice(0, this.logLines.length - 7);
  }
  pushLog(text: string, cls = 'own') { this.logLines.push({ t: this.world.time, text, cls }); if (this.logLines.length > 7) this.logLines.shift(); }

  render() {
    $('clock').textContent = hms(this.world.time);
    $('log').innerHTML = this.logLines.map(l => `<div class="ln ${l.cls}"><span class="t">${hms(l.t)}</span>${l.text}</div>`).join('');
    const s = this.src.primary(), t = this.src.target(), sel = this.src.selection().filter(o => o.alive);
    this.renderFleet(sel, s);
    this.renderFormation(sel, s);
    this.renderAir(s);
    this.renderOwn(s);
    document.querySelectorAll<HTMLButtonElement>('[data-tel]').forEach(b => b.classList.toggle('on', +b.dataset.tel! === s.telegraph));
    document.querySelector('[data-cmd="hold"]')!.classList.toggle('on', sel.length > 0 && sel.every(o => o.holdFire));
    document.querySelector('[data-cmd="target"]')!.classList.toggle('on', !!s.fc.target?.alive);
    this.renderFc(s, this.estimate);
    this.renderAnalysis(s, t);
  }

  /** Squadron list, grouped by formation: line ships, a summary of each screen, then independent ships. Rows select on press. */
  private renderFleet(sel: Ship[], primary: Ship) {
    const fleet = this.src.fleet(), units = this.src.units(), forms = this.src.formations(), all = this.world.formations;
    const row = (s: Ship) => {
      const f = clamp(s.hp / s.c.hp, 0, 1), col = f > 0.6 ? css('--good') : f > 0.3 ? css('--accent') : css('--foe');
      const tgt = s.fc.target && s.fc.target.alive ? `→ ${s.fc.target.name}` : 'no target';
      const st = !s.alive ? (s.magazine ? 'blown up' : 'sinking') : `${(s.speed / KN).toFixed(0)} kn · ${s.holdFire ? '<span class="warn">hold fire</span>' : tgt}`;
      const cls = `unit${sel.includes(s) ? ' on' : ''}${s === primary && sel.length > 1 ? ' pri' : ''}${s.alive ? '' : ' dead'}`;
      const n = units.indexOf(s);
      return `<button class="${cls}" data-pick="${fleet.indexOf(s)}"${s.alive ? '' : ' disabled'} title="${s.c.label}"><kbd>${n >= 0 && n < 9 ? n + 1 : ''}</kbd><span class="nm">${s.name.replace(/^USS /, '')}</span><span class="hpb"><i style="width:${Math.round(f * 100)}%;background:${col}"></i></span><span class="st">${st}</span></button>`;
    };
    let html = '';
    for (const f of forms) {
      const live = f.screen.filter(s => s.alive), hurt = live.filter(s => s.hp < s.c.hp * 0.6).length;
      const classes = [...new Set(live.map(s => s.c.label.split('-')[0]))].map(c => `${live.filter(s => s.c.label.startsWith(c)).length} ${c}`).join(', ');
      html += `<button class="fhead" data-fsel="${all.indexOf(f)}" title="Select the whole line">${FORMATION_LABEL[f.type]} · guide ${f.guide.name.replace(/^USS /, '')}</button>`;
      html += f.line.map(row).join('');
      if (f.screen.length) html += `<div class="screen"><span>Screen: ${live.length} DD${classes ? ` (${classes})` : ''}${hurt ? ` · <span class="warn">${hurt} damaged</span>` : ''}</span>${live.length ? `<button class="mini" data-fcmd="detach" data-f="${all.indexOf(f)}" title="Send one destroyer off on her own">Detach one</button>` : ''}</div>`;
    }
    const free = units.filter(s => !forms.some(f => f.has(s)));
    if (free.length) html += (forms.length ? '<div class="fhead static">Independent</div>' : '') + free.map(row).join('');
    const note = sel.length > 1
      ? `<b>${sel.length} ships selected.</b> Orders go to all of them; the panels below show <b>${primary.name}</b>.`
      : 'Click a ship or press its number to select it. <b>Shift</b> adds or removes, <b>Q</b> selects all, drag a box, or double-click a ship for her whole line.';
    $('fleet').innerHTML = `<div class="units">${html}</div><div class="note">${note}</div>`;
  }

  /** Formation panel: the primary's formation (or how to make one), with lit buttons for its type and turn mode. */
  private renderFormation(sel: Ship[], primary: Ship) {
    const f = this.world.formationOf(primary);
    document.querySelectorAll<HTMLButtonElement>('[data-form]').forEach(b => b.classList.toggle('on', !!f && b.dataset.form === f.type));
    const tb = document.querySelector<HTMLButtonElement>('[data-fcmd="turn"]');
    if (tb) tb.firstElementChild!.textContent = f && f.turn === 'together' ? 'Turn together' : 'Turn in succession';
    const freeDD = sel.filter(s => s.c.type === 'DD' && !this.world.formationOf(s));
    const rejoin = freeDD.length && this.world.formations.some(o => o.guide.side === 'player') ? `<button class="mini" data-fcmd="rejoin">Rejoin screen</button>` : '';
    if (!f) { $('formInfo').innerHTML = `<div class="note">${primary.name} is steaming independently. Select two or more ships and choose a formation; destroyers go to the screen.</div>${rejoin}`; return; }
    const guideSel = sel.includes(f.guide);
    const role = f.guide === primary ? 'guide' : f.screen.includes(primary) ? 'screen' : `${f.line.indexOf(primary) + 1} in line`;
    const lag = f.members.filter(s => s !== f.guide && s.alive && f.stationError(s) > 0.5 * f.interval).length;
    const heavy = f.line.some(s => s.c.type !== 'DD');
    $('formInfo').innerHTML = `<dl class="stats">
        <dt>${FORMATION_LABEL[f.type]}</dt><dd>${primary.name.replace(/^USS /, '')}: ${role}</dd>
        <dt>Formation speed</dt><dd>${(f.guide.speed / KN).toFixed(1)} kn · max ${(f.maxSpeed / KN).toFixed(1)}</dd>
        <dt>Standard distance</dt><dd>${heavy ? '1,000' : '500'} yd</dd>
        <dt>Off station</dt><dd class="${lag ? 'warn' : ''}">${lag ? `${lag} closing up` : 'none'}</dd></dl>
      <div class="note">${guideSel ? (f.turn === 'succession' && f.type === 'column' ? 'Helm orders turn the column in succession: each ship turns where the guide turned.' : 'Helm orders turn every ship together; a column becomes a line of bearing until you re-form.')
        : `Movement orders to ${primary.name} take her out of the formation. Select the guide to manoeuvre it.`}</div>${rejoin}`;
  }

  /** Air operations for the primary ship if she is a carrier: deck, wind, aircraft, CAP, orders and flights. */
  private renderAir(s: Ship) {
    const panel = document.querySelector<HTMLElement>('details[data-k="air"]')!;
    const any = this.world.ships.some(o => o.side === 'player' && o.air);
    panel.hidden = !any;
    if (!any) return;
    const cs = s.air;
    if (!cs) { $('air').innerHTML = `<div class="note">Select a carrier to run air operations.</div>`; return; }
    if (!s.alive) { $('air').innerHTML = `<div class="note bad">${s.name} is sinking. Her aircraft in the air will divert to another carrier if one can take them.</div>`; return; }
    const wod = this.world.windOverDeck(s), f = this.world.formationOf(s), canSteer = !f || f.guide === s;
    const deckCls = cs.status === 'ready' ? 'ok' : cs.status.startsWith('flight deck') || cs.status.startsWith('fires') ? 'bad' : cs.status.startsWith('waiting') ? 'warn' : '';
    const rows = cs.stock.map(st => `<tr><td>${st.type.short}<span class="sub2">${st.type.role === 'fighter' ? 'fighter' : st.type.role === 'dive' ? 'dive bomber' : 'torpedo bomber'}</span></td><td>${st.ready}</td><td>${st.hangar}</td><td>${st.airborne}</td><td class="${st.lost ? 'bad' : ''}">${st.lost}</td></tr>`).join('');
    const flights = this.world.air.flights.filter(o => o.home === s && o.n > 0 && o.mission !== 'cap');
    const capN = this.world.air.capStrength(s);
    const fl = flights.map(o => `<div class="flt"><span>${o.label}</span><span class="st">${o.n} · ${STATE_LABEL[o.state]} · fuel ${Math.round(o.fuel)} km</span>${o.state !== 'return' && o.state !== 'holding' ? `<button class="mini" data-recall="${o.id}">Recall</button>` : '<span></span>'}</div>`).join('');
    $('air').innerHTML = `<dl class="stats">
        <dt>Flight deck</dt><dd class="${deckCls}">${cs.status}</dd>
        <dt>Wind over deck</dt><dd class="${wod.ok ? 'ok' : 'warn'}">${Math.round(wod.kn)} kn · ${Math.round(Math.abs(wod.rel) / DEG)}° ${wod.rel > 0 ? 'stbd' : 'port'} of the bow</dd>
        ${s.evading ? '<dt>Helm</dt><dd class="warn">evading air attack</dd>' : ''}
      </dl>
      ${wod.ok ? '' : `<div class="tip">Aircraft can only take off and land into a wind of 18 knots or more, within 25° of the bow.${canSteer ? '' : ` ${f!.guide.name} guides the formation: turn her.`}</div>`}
      <table class="calc air"><tr class="sub"><td>Aircraft</td><td>Ready</td><td>Hangar</td><td>Aloft</td><td>Lost</td></tr>${rows}</table>
      <div class="grid g3">
        <button class="cmd${!wod.ok && (cs.queue.length || this.world.air.flights.some(o => o.home === s && o.state === 'holding')) ? ' on' : ''}" data-air="wind" title="Steer ${canSteer ? 'her' : 'the formation guide'} into the wind for flight operations">Into wind</button>
        <button class="cmd" data-air="search" title="Then click the map in the direction to search">Search ▸</button>
        <button class="cmd" data-air="strike" title="Then click a contact or a point on the map">Strike ▸</button>
      </div>
      <div class="caprow"><span>Combat air patrol</span>${[0, 4, 8, 12].map(n => `<button class="mini${cs.capTarget === n ? ' on' : ''}" data-cap="${n}">${n}</button>`).join('')}<span class="st">${capN} up</span></div>
      ${cs.queue.length ? `<div class="note">Deck queue: ${cs.queue.map(o => o.label).join('; ')}</div>` : ''}
      ${fl ? `<div class="sub">Flights</div>${fl}` : ''}`;
  }

  /** Radar chip: fitted or not, and how long until a knocked-out set is repaired. */
  private radarChip(s: Ship) {
    const r = s.radarSet;
    if (!r) return '<span class="chip warn">Optical only</span>';
    if (r.status === 'ok') return '<span class="chip ok">FC radar</span>';
    if (r.status === 'down') return `<span class="chip bad" title="Damage control is repairing it; optical fire control until then">Radar down ${Math.ceil(r.repair)} s</span>`;
    return '<span class="chip bad">Radar destroyed</span>';
  }

  /** Chip for a group of mounts: working of total, with how many are being repaired. */
  private mountChip(s: Ship, label: string, f: (m: Mount) => boolean, title: string) {
    const n = s.mountCount(f);
    if (!n.total) return '';
    const cls = n.ok === n.total ? 'ok' : n.ok >= n.total * 0.6 ? 'warn' : 'bad';
    return `<span class="chip ${cls}" title="${title}">${label} ${n.ok}/${n.total}${n.down ? ` · ${n.down} repairing` : ''}</span>`;
  }

  private systemsHtml(s: Ship) {
    return this.radarChip(s)
      + this.mountChip(s, 'Secondary', isSecondary, 'Secondary mounts working (both sides). They will engage ships in range on their own.')
      + this.mountChip(s, 'AA', isAA, 'AA mounts working (heavy, medium and light). They will engage aircraft in range on their own.');
  }

  private renderOwn(s: Ship) {
    const f = s.hp / s.c.hp, pct = Math.round(clamp(f, 0, 1) * 100);
    const chip = (txt: string, cls: string) => `<span class="chip ${cls}">${txt}</span>`;
    const tur = s.turrets.map((tu, i) => chip(`T${i + 1}`, !tu.alive ? 'bad' : tu.jam > 0 ? 'warn' : 'ok')).join('');
    $('own').innerHTML = `<h2>${s.name}</h2><div class="cls">${s.c.label}</div>
      <div class="hp"><div class="bar"><i style="width:${pct}%;background:${f > 0.6 ? css('--good') : f > 0.3 ? css('--accent') : css('--foe')}"></i></div><span>${pct}%</span></div>
      <dl class="stats">
        <dt>Speed</dt><dd>${(s.speed / KN).toFixed(1)} kn · ${TELEGRAPH[s.telegraph].key}</dd>
        <dt>Course</dt><dd>${deg3(s.heading)}${s.course !== null && Math.abs(wrap(s.course - s.heading)) > 2 * DEG ? ' → ' + deg3(s.course) : ''}</dd>
        <dt>Rudder</dt><dd class="${s.rudderJam !== null ? 'bad' : ''}">${s.rudderJam !== null ? 'JAMMED ' : ''}${Math.round(Math.abs(s.rudder) * 35)}° ${s.rudder > 0.02 ? 'stbd' : s.rudder < -0.02 ? 'port' : ''}</dd>
        <dt>Turn rate</dt><dd class="${Math.abs(s.turnRate) / DEG > 0.4 ? 'warn' : ''}">${(s.turnRate / DEG).toFixed(2)}°/s</dd>
      </dl>
      <div class="chips">${tur}${chip('Director ' + Math.round(s.director * 100) + '%', s.director > 0.8 ? 'ok' : s.director > 0.4 ? 'warn' : 'bad')}${this.systemsHtml(s)}${chip('Engines ' + Math.round(s.engines * 100) + '%', s.engines > 0.8 ? 'ok' : s.engines > 0.5 ? 'warn' : 'bad')}${chip('Fires ' + s.fires, s.fires ? 'bad' : 'ok')}${chip('Flooding ' + s.flooding, s.flooding ? 'bad' : 'ok')}</div>`;
  }

  /** Shell selector with rounds left; the button for the ordered type is lit. */
  private ammoHtml(s: Ship) {
    const types: ShellType[] = ['ap', 'he'];
    const desc: Record<ShellType, string> = { ap: 'armour-piercing: for armoured targets', he: 'high explosive: superstructure, fires, light ships' };
    const btns = types.map(k => {
      const n = s.ammo[k], full = s.c.ammo[k];
      const cls = n === 0 ? 'bad' : n < full * 0.2 ? 'warn' : '';
      return `<button class="cmd${s.shellType === k ? ' on' : ''}" data-shell="${k}" title="${desc[k]}"><span>${SHELL_LABEL[k]}</span><span class="n ${cls}">${n}/${full}</span></button>`;
    }).join('');
    const changing = s.turrets.some(tu => tu.alive && (tu.hoist || (tu.loaded && tu.loaded !== s.shellType)));
    const empty = s.ammo[s.shellType] === 0;
    return `<div class="ammo">${btns}</div>
      ${empty ? `<div class="tip">${SHELL_LABEL[s.shellType]} magazines are empty. Change shell type to keep firing.</div>`
        : changing ? `<div class="note">Changing to ${SHELL_LABEL[s.shellType]}: turrets fire the rounds already loaded and in the hoists first.</div>` : ''}`;
  }

  /** Secondary battery: engages the nearest enemy ship in range on its own. */
  private secHtml(s: Ship) {
    const sec = s.c.sec; if (!sec) return '';
    const fc = s.secFc, t = fc.target;
    const n = s.mountCount(isSecondary);
    let state: string;
    if (s.secAmmo <= 0) state = '<span class="bad">out of ammunition</span>';
    else if (s.holdFire) state = '<span class="warn">holding fire</span>';
    else if (!t) state = `no enemy within ${sec.gun.maxRangeKm.toFixed(1)} km`;
    else {
      const rel = wrap(bearing(s.x, s.z, t.x, t.z) - s.heading);
      const bears = s.mounts.filter(m => isSecondary(m) && m.status === 'ok' && mountBears(m, rel)).length;
      state = `engaging ${t.name} at ${km(toReal(Math.hypot(t.x - s.x, t.z - s.z)))} · <span class="${bears ? '' : 'warn'}">${bears} mount${bears === 1 ? '' : 's'} bearing</span>`;
    }
    const last = t && fc.last ? ` · last salvo ${fc.last.text}` : '';
    return `<div class="sub">Secondaries · ${sec.gun.name}, HE</div>
      <div class="note">${state}${last}</div>
      <dl class="stats"><dt>Mounts working</dt><dd>${n.ok} of ${n.total}${n.down ? ` · ${n.down} repairing` : ''}</dd>
        <dt>Rounds</dt><dd class="${s.secAmmo < sec.ammo * 0.2 ? 'warn' : ''}">${s.secAmmo} / ${sec.ammo}</dd>
        <dt>Salvos · hits</dt><dd>${fc.salvos} · ${fc.hits}</dd></dl>`;
  }

  private renderFc(s: Ship, est: Estimate) {
    const fc = s.fc, t = fc.target;
    if (!s.turrets.length) { $('fc').innerHTML = `<div class="note">${s.name} has no main battery; her guns are for anti-aircraft and close defence.</div>${this.secHtml(s)}`; return; }
    if (!t || !t.alive) { $('fc').innerHTML = `${this.ammoHtml(s)}<div class="note">${t && !t.alive ? 'Target destroyed. ' : ''}No target. Click the enemy ship or press <b>T</b> to engage. <b>F</b> changes shell type.</div>${this.secHtml(s)}`; return; }
    const d = Math.hypot(t.x - s.x, t.z - s.z), real = toReal(d);
    const q = fc.quality();
    const rows = s.turrets.map((tu, i) => {
      const rel = wrap(bearing(s.x, s.z, t.x, t.z) - s.heading);
      const bears = canBear(tu.def, rel);
      const st = !tu.alive ? '<span class="bad">destroyed</span>' : !tu.loaded ? '<span class="bad">no rounds</span>' : tu.jam > 0 ? `<span class="warn">jammed ${Math.ceil(tu.jam)} s</span>` : !bears ? '<span class="warn">masked</span>' : tu.blocked ? `<span class="warn" title="A friendly ship is in the line of fire">blocked: ${tu.blocked.name.replace(/^USS /, '')}</span>` : tu.reload > 0 ? `loading ${Math.ceil(tu.reload)} s` : '<span class="ok">ready</span>';
      const fill = tu.alive ? 1 - tu.reload / s.c.gun.reload : 0;
      const ld = tu.alive && tu.loaded ? `<span class="ld${tu.loaded !== s.shellType ? ' warn' : ''}" title="loaded${tu.hoist ? `; ${SHELL_LABEL[tu.hoist]} still in the hoist` : ''}">${SHELL_LABEL[tu.loaded]}${tu.hoist ? '+' : ''}</span>` : '<span class="ld">—</span>';
      return `<div class="tur"><span>Turret ${i + 1}</span><div class="rl"><i style="width:${Math.round(clamp(fill, 0, 1) * 100)}%"></i></div>${ld}<span class="st">${st}</span></div>`;
    }).join('');
    const lastCls = fc.last ? (fc.last.kind === 'hit' ? 'bad' : fc.last.kind === 'straddle' ? 'warn' : '') : '';
    let zoneHtml = '';
    if (est && est.hits > 0) {
      const entries = Object.entries(est.zones).sort((a, b) => b[1] - a[1]) as [Zone, number][];
      zoneHtml = `<div class="note">Where hits would land at this angle and range:</div><div class="zones">${entries.map(([z, n]) => `<i style="width:${(n / est.hits * 100).toFixed(1)}%;background:${ZONE_COLOUR[z]}" title="${ZONE_LABEL[z]}"></i>`).join('')}</div>
        <div class="legend">${entries.map(([z, n]) => `<span style="--c:${ZONE_COLOUR[z]}">${ZONE_LABEL[z]} ${Math.round(n / est.hits * 100)}%</span>`).join('')}</div>`;
    }
    const turning = Math.abs(s.turnRate) / DEG > 0.4;
    $('fc').innerHTML = `${this.ammoHtml(s)}<dl class="stats">
        <dt>Target</dt><dd>${t.name}</dd>
        <dt>Range</dt><dd>${km(real)}</dd>
        <dt>Guns bearing</dt><dd class="${est && est.guns < est.total ? 'warn' : ''}">${est ? `${est.guns} of ${est.total}` : '—'}</dd>
        <dt>Solution error (1σ)</dt><dd>± ${Math.round(fc.sig)} m</dd></dl>
      <div class="qbar"><i style="width:${Math.round(q * 100)}%"></i></div>
      <dl class="stats">
        <dt>Last salvo</dt><dd class="${lastCls}">${fc.last ? fc.last.text : 'none yet'}</dd>
        <dt>Salvos · straddles · hits</dt><dd>${fc.salvos} · ${fc.straddles} · ${fc.hits}</dd>
        <dt>Hit chance per shell</dt><dd class="warn">${est ? (est.pHit * 100).toFixed(1) + '%' : '—'}</dd>
        <dt>Expected hits per salvo</dt><dd>${est ? (est.pHit * est.guns).toFixed(2) : '—'}</dd>
        <dt>…that ${s.shellType === 'he' ? 'burst inside' : 'penetrate'}</dt><dd>${est ? (est.pPen * est.guns).toFixed(2) : '—'}</dd></dl>
      ${zoneHtml}
      <div class="turrets">${rows}</div>
      ${this.secHtml(s)}
      ${turning ? '<div class="tip">You are turning. The director loses its solution while the ship swings; steady up before the next salvo.</div>' : ''}`;
  }

  private renderAnalysis(s: Ship, t: Ship | null) {
    if (!t) { $('tgtHead').innerHTML = '<div class="note">No enemy ships in contact.</div>'; $('tgtCalc').innerHTML = ''; return; }
    const d = Math.hypot(t.x - s.x, t.z - s.z), realKm = toReal(d) / 1000;
    const g = s.c.gun, eg = t.c.gun;
    const fall = interp(g.fallDeg, realKm) * DEG, pen = interp(g.penNormal, realKm);
    const aspect = wrap(bearing(t.x, t.z, s.x, s.z) - t.heading); // where we sit relative to the target's bow
    const myAspect = wrap(bearing(s.x, s.z, t.x, t.z) - s.heading);
    const a = Math.round(Math.abs(aspect) / DEG), word = a < 25 ? 'bow-on' : a > 155 ? 'stern-on' : a > 60 && a < 120 ? 'broadside' : 'angled';
    const b = beltEffective(t.c, aspect, fall), dk = deckEffective(t.c, fall);
    const res = (eff: number, obl: number) => obl > 65 * DEG ? '<span class="pill amb">ricochet</span>' : pen >= eff ? '<span class="pill red">penetrates</span>' : '<span class="pill grn">holds</span>';
    const efall = interp(eg.fallDeg, realKm) * DEG, epen = interp(eg.penNormal, realKm);
    const mb = beltEffective(s.c, myAspect, efall), md = deckEffective(s.c, efall);
    const eres = (eff: number, obl: number) => obl > 65 * DEG ? '<span class="pill amb">ricochet</span>' : epen >= eff ? '<span class="pill red">penetrated</span>' : '<span class="pill grn">holds</span>';
    const myZone = immuneZone(s.c, eg, myAspect), theirZone = immuneZone(t.c, g, aspect);
    const zt = (z: [number, number] | null) => (z ? `${z[0].toFixed(1)}–${z[1].toFixed(1)} km` : 'none');
    $('tgtHead').innerHTML = `<h2>${t.name}</h2><div class="cls">${t.c.label} · ${t.alive ? (t.speed / KN).toFixed(0) + ' kn' : 'sinking'}</div>
      <div class="chips">${this.systemsHtml(t)}<span class="chip ${t.director > 0.8 ? 'ok' : t.director > 0.4 ? 'warn' : 'bad'}">Director ${Math.round(t.director * 100)}%</span></div>`;
    $('tgtCalc').innerHTML = `<table class="calc">
      <tr><td>Target aspect</td><td>${a}° · ${word}</td></tr>
      <tr><td>Angle of fall at ${km(realKm * 1000)}</td><td>${(fall / DEG).toFixed(1)}°</td></tr>
      <tr><td>Our AP penetration (normal)</td><td>${Math.round(pen)} mm</td></tr>
      <tr><td>Our HE (${g.he.name}) bursts behind</td><td>up to ${g.he.penMm} mm</td></tr>
      <tr><td>Their belt ${t.c.armour.belt} mm → effective</td><td>${Math.round(b.eff)} mm ${res(b.eff, b.obl)}</td></tr>
      <tr><td>Their deck ${t.c.armour.deck} mm → effective</td><td>${Math.round(dk.eff)} mm ${res(dk.eff, dk.obl)}</td></tr>
      <tr class="sub"><td colspan="2">Your exposure to their ${eg.name}</td></tr>
      <tr><td>Your belt ${s.c.armour.belt} mm (${s.c.armour.beltIncl}° inclined)</td><td>${Math.round(mb.eff)} mm ${eres(mb.eff, mb.obl)}</td></tr>
      <tr><td>Your deck ${s.c.armour.deck} mm</td><td>${Math.round(md.eff)} mm ${eres(md.eff, md.obl)}</td></tr>
      <tr><td>Your immune zone at this angle</td><td>${zt(myZone)}</td></tr>
      <tr><td>Their immune zone vs your guns</td><td>${zt(theirZone)}</td></tr></table>
      <p class="note">Immune zone: the band of range where neither belt nor deck can be penetrated. Closer in, shells go through the belt; further out, they plunge through the deck.</p>`;
    this.drawAspect(s, t, aspect, b.eff < pen && b.obl < 65 * DEG);
  }

  private drawAspect(s: Ship, t: Ship, aspect: number, beltPen: boolean) {
    const g = this.actx, c = g.canvas, w = c.width, h = c.height;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0b1d2b'; g.fillRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.6;
    g.strokeStyle = css('--accent'); g.fillStyle = css('--accent'); g.lineWidth = 3; g.setLineDash([10, 8]);
    g.beginPath(); g.moveTo(cx, 22); g.lineTo(cx, cy - 66); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(cx, cy - 50); g.lineTo(cx - 10, cy - 70); g.lineTo(cx + 10, cy - 70); g.closePath(); g.fill();
    g.font = '600 22px "Barlow Condensed", sans-serif'; g.textAlign = 'left'; g.fillText(`Fire from ${s.name}`, cx + 16, 34);
    g.save(); g.translate(cx, cy);
    // the shell arrives from the top of the canvas; rotate the hull by its aspect
    g.rotate(-aspect - Math.PI / 2);
    const Lp = w * 0.5, Bp = Lp * t.c.B / t.c.L * 1.5, fine = t.c.fine ?? 0.6;
    g.beginPath();
    for (let i = 0; i <= 40; i++) { const u = -1 + 2 * i / 40; g.lineTo(u * Lp / 2, -hullProfile(u, fine) * Bp / 2); }
    for (let i = 40; i >= 0; i--) { const u = -1 + 2 * i / 40; g.lineTo(u * Lp / 2, hullProfile(u, fine) * Bp / 2); }
    g.closePath(); g.fillStyle = '#34424f'; g.fill();
    const [c0, c1] = t.c.armour.citadel.map(x => x / t.c.L * Lp);
    g.strokeStyle = beltPen ? css('--foe') : css('--good'); g.lineWidth = 5;
    g.beginPath(); g.moveTo(c0, -Bp / 2); g.lineTo(c1, -Bp / 2); g.moveTo(c0, Bp / 2); g.lineTo(c1, Bp / 2); g.stroke();
    g.setLineDash([5, 4]); g.lineWidth = 2; g.strokeStyle = 'rgba(255,95,85,.8)'; g.strokeRect(c0 + 6, -Bp * 0.3, c1 - c0 - 12, Bp * 0.6); g.setLineDash([]);
    for (const tu of t.c.turrets) { g.fillStyle = '#5f6c78'; g.beginPath(); g.arc(tu.x / t.c.L * Lp, 0, 6 * (tu.s ?? 1), 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(221,228,232,.8)'; g.beginPath(); g.moveTo(Lp / 2 + 16, 0); g.lineTo(Lp / 2 + 3, -7); g.lineTo(Lp / 2 + 3, 7); g.closePath(); g.fill();
    g.restore();
    g.font = '500 17px "IBM Plex Mono", monospace'; g.fillStyle = css('--text'); g.textAlign = 'left';
    g.fillText(`aspect ${Math.round(Math.abs(aspect) / DEG)}° ${aspect < 0 ? 'port' : 'starboard'}`, 16, h - 20);
    g.textAlign = 'right'; g.fillStyle = beltPen ? css('--foe') : css('--good'); g.fillText(beltPen ? 'belt: penetrable' : 'belt: holds', w - 16, h - 20);
  }
}

