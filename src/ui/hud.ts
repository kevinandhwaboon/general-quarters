import { KN, toReal } from '../config';
import { GunSpec, SHELL_LABEL, ShellType } from '../data/guns';
import { ShipClass } from '../data/ships';
import { bearing, clamp, DEG, deg3, hms, interp, km, wrap } from '../math';
import { Zone, ZONE_LABEL } from '../sim/combat';
import { hullProfile } from '../sim/hull';
import { canBear, Ship, TELEGRAPH } from '../sim/ship';
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

export class Hud {
  private logLines: { t: number; text: string; cls: string }[] = [];
  private actx: CanvasRenderingContext2D;
  estimate: Estimate = null;
  constructor(private world: World, private getPlayer: () => Ship, private getEnemy: () => Ship) {
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
    const s = this.getPlayer(), t = this.getEnemy();
    this.renderOwn(s);
    document.querySelectorAll<HTMLButtonElement>('[data-tel]').forEach(b => b.classList.toggle('on', +b.dataset.tel! === s.telegraph));
    document.querySelector('[data-cmd="hold"]')!.classList.toggle('on', s.holdFire);
    document.querySelector('[data-cmd="target"]')!.classList.toggle('on', s.fc.target === t);
    this.renderFc(s, this.estimate);
    this.renderAnalysis(s, t);
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
      <div class="chips">${tur}${chip('Director ' + Math.round(s.director * 100) + '%', s.director > 0.8 ? 'ok' : s.director > 0.4 ? 'warn' : 'bad')}${chip(s.radar ? 'FC radar' : 'Optical only', s.radar ? 'ok' : 'warn')}${chip('Engines ' + Math.round(s.engines * 100) + '%', s.engines > 0.8 ? 'ok' : s.engines > 0.5 ? 'warn' : 'bad')}${chip('Fires ' + s.fires, s.fires ? 'bad' : 'ok')}${chip('Flooding ' + s.flooding, s.flooding ? 'bad' : 'ok')}</div>`;
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

  private renderFc(s: Ship, est: Estimate) {
    const fc = s.fc, t = fc.target;
    if (!t || !t.alive) { $('fc').innerHTML = `${this.ammoHtml(s)}<div class="note">${t && !t.alive ? 'Target destroyed. ' : ''}No target. Click the enemy ship or press <b>T</b> to engage. <b>F</b> changes shell type.</div>`; return; }
    const d = Math.hypot(t.x - s.x, t.z - s.z), real = toReal(d);
    const q = fc.quality();
    const rows = s.turrets.map((tu, i) => {
      const rel = wrap(bearing(s.x, s.z, t.x, t.z) - s.heading);
      const bears = canBear(tu.def, rel);
      const st = !tu.alive ? '<span class="bad">destroyed</span>' : !tu.loaded ? '<span class="bad">no rounds</span>' : tu.jam > 0 ? `<span class="warn">jammed ${Math.ceil(tu.jam)} s</span>` : !bears ? '<span class="warn">masked</span>' : tu.reload > 0 ? `loading ${Math.ceil(tu.reload)} s` : '<span class="ok">ready</span>';
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
      ${turning ? '<div class="tip">You are turning. The director loses its solution while the ship swings; steady up before the next salvo.</div>' : ''}`;
  }

  private renderAnalysis(s: Ship, t: Ship) {
    if (!t) return;
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
    $('tgtHead').innerHTML = `<h2>${t.name}</h2><div class="cls">${t.c.label} · ${t.alive ? (t.speed / KN).toFixed(0) + ' kn' : 'sinking'}</div>`;
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

