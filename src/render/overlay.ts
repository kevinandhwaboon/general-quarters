import { toGame, toReal } from '../config';
import { bearing, clamp, DEG, dir, km, wrap } from '../math';
import { canBear, Ship } from '../sim/ship';
import { World } from '../sim/world';
import { Renderer3D } from './renderer';

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** 2D layer drawn over the 3D view: selection, fire-control aids, labels and the scale bar. */
export class Overlay {
  private ctx: CanvasRenderingContext2D;
  private C = { friend: css('--friend'), foe: css('--foe'), acc: css('--accent'), text: css('--text'), good: css('--good'), muted: css('--muted') };
  dpr = 1;
  /** Result of the most recent hit estimate, shown on the target line. */
  estimate: { pHit: number; guns: number; total: number } | null = null;
  /** Selection box being dragged, in canvas pixels. */
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private r: Renderer3D, private world: World) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number) { this.dpr = dpr; this.canvas.width = w * dpr; this.canvas.height = h * dpr; }

  private label(t: string, x: number, y: number, col: string, font = '600 12px "Barlow Condensed", sans-serif', align: CanvasTextAlign = 'center') {
    const g = this.ctx; g.font = font; g.textAlign = align; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = 'rgba(4,9,14,.82)'; g.strokeText(t, x, y); g.fillStyle = col; g.fillText(t, x, y);
  }
  private ring(x: number, z: number, r: number, n = 64) { const pts = []; for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; pts.push(this.r.project(x + Math.cos(a) * r, z + Math.sin(a) * r)); } return pts; }
  private path(pts: { x: number; y: number }[], close = false) { const g = this.ctx; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); if (close) g.closePath(); }

  draw(selection: Ship[], primary: Ship) {
    const g = this.ctx, r = this.r, W = r.width, H = r.height, mpp = r.metresPerPixel, C = this.C;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, W, H);

    if (primary.alive && selection.includes(primary)) {
      // maximum gun range of the primary
      const s = primary, gun = s.c.gun;
      g.strokeStyle = 'rgba(242,178,62,.28)'; g.setLineDash([4, 7]); g.lineWidth = 1;
      this.path(this.ring(s.x, s.z, toGame(gun.maxRangeKm * 1000), 120), true); g.stroke(); g.setLineDash([]);
      const rp = r.project(s.x + toGame(gun.maxRangeKm * 1000) * Math.cos(-0.9), s.z + toGame(gun.maxRangeKm * 1000) * Math.sin(-0.9));
      if (rp.ok) this.label(`${gun.name} · max range ${gun.maxRangeKm} km`, rp.x, rp.y, 'rgba(242,178,62,.7)', '500 11px "Barlow Condensed", sans-serif');
    }
    // stations of selected formations: a small diamond where each ship should be, joined to her if she is off station
    for (const f of this.world.formations) {
      if (!selection.includes(f.guide)) continue;
      for (const m of f.members) {
        if (m === f.guide || !m.alive) continue;
        const st = f.station(m), q = r.project(st.x, st.z), p = r.project(m.x, m.z);
        if (!q.ok) continue;
        g.strokeStyle = 'rgba(71,215,193,.55)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(q.x, q.y - 5); g.lineTo(q.x + 5, q.y); g.lineTo(q.x, q.y + 5); g.lineTo(q.x - 5, q.y); g.closePath(); g.stroke();
        if (Math.hypot(st.x - m.x, st.z - m.z) > 0.25 * f.interval) { g.setLineDash([2, 4]); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); g.setLineDash([]); }
      }
    }
    for (const s of selection) {
      if (!s.alive) continue;
      const isPrimary = s === primary;
      // course / waypoint
      const sp = r.project(s.x, s.z);
      if (s.waypoint) {
        const wp = r.project(s.waypoint.x, s.waypoint.z);
        g.strokeStyle = 'rgba(71,215,193,.8)'; g.setLineDash([6, 5]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(sp.x, sp.y); g.lineTo(wp.x, wp.y); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(wp.x, wp.y, 6, 0, Math.PI * 2); g.stroke();
      } else if (s.course !== null) {
        const [dx, dz] = dir(s.course), L = Math.max(1500, 120 * mpp), q = r.project(s.x + dx * L, s.z + dz * L);
        g.strokeStyle = 'rgba(71,215,193,.55)'; g.setLineDash([3, 6]); g.lineWidth = 1.3; g.beginPath(); g.moveTo(sp.x, sp.y); g.lineTo(q.x, q.y); g.stroke(); g.setLineDash([]);
      }
      const t = s.fc.target;
      if (!t || !t.alive) continue;
      const d = Math.hypot(t.x - s.x, t.z - s.z);
      if (isPrimary) {
        // the arc where each number of guns bears
        const tb = wrap(bearing(s.x, s.z, t.x, t.z) - s.heading) / DEG, tr = Math.round(tb / 3) * 3;
        for (let a = tr - 45; a < tr + 45; a += 3) {
          const rel = (a + 1.5) * DEG;
          const n = s.turrets.reduce((k, tu) => k + (tu.alive && canBear(tu.def, rel) ? tu.def.guns : 0), 0), tot = s.turrets.reduce((k, tu) => k + tu.def.guns, 0);
          const pts = []; for (let k = 0; k <= 3; k++) { const [dx, dz] = dir(s.heading + (a + k) * DEG); pts.push(r.project(s.x + dx * d, s.z + dz * d)); }
          this.path(pts); g.strokeStyle = n === tot ? 'rgba(242,178,62,.85)' : n > 0 ? 'rgba(242,178,62,.42)' : 'rgba(242,178,62,.14)'; g.lineWidth = n === tot ? 3 : 2; g.stroke();
        }
      }
      const a = r.project(s.x, s.z), b = r.project(t.x, t.z);
      g.strokeStyle = isPrimary ? 'rgba(255,95,85,.75)' : 'rgba(255,95,85,.45)'; g.lineWidth = 1.5; g.setLineDash([7, 5]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      const e = isPrimary ? this.estimate : null;
      this.label(`${km(toReal(d))}${e ? ` · ${e.guns}/${e.total} guns · ${(e.pHit * 100).toFixed(0)}% per shell` : ''}`, a.x + (b.x - a.x) * (isPrimary ? 0.5 : 0.35), a.y + (b.y - a.y) * (isPrimary ? 0.5 : 0.35) - 12,
        isPrimary ? C.acc : 'rgba(242,178,62,.7)', isPrimary ? '600 12.5px "Barlow Condensed", sans-serif' : '500 11.5px "Barlow Condensed", sans-serif');
    }

    // fall of shot from the last salvos
    const now = this.world.time;
    for (const f of this.r.falls) {
      const age = now - f.t, al = clamp(1 - age / 40, 0, 1);
      const p = this.r.displayNear(f.target, f.x, f.z), q = r.project(p.x, p.z);
      g.strokeStyle = f.hit ? `rgba(255,95,85,${al})` : f.shooter.side === 'player' ? `rgba(255,255,255,${0.85 * al})` : `rgba(255,190,120,${0.85 * al})`;
      g.lineWidth = 1.5; g.beginPath(); g.moveTo(q.x - 3, q.y - 3); g.lineTo(q.x + 3, q.y + 3); g.moveTo(q.x + 3, q.y - 3); g.lineTo(q.x - 3, q.y + 3); g.stroke();
    }

    // ships
    for (const s of this.world.ships) {
      const own = s.side === 'player', col = own ? C.friend : C.foe;
      const p = r.project(s.x, s.z); if (!p.ok) continue;
      const [hx, hz] = dir(s.heading), hl = s.c.L / 2 * s.vs;
      const pb = r.project(s.x + hx * hl, s.z + hz * hl), ps = r.project(s.x - hx * hl, s.z - hz * hl);
      const y = Math.max(pb.y, ps.y, p.y + 10) + 14;
      if (s.alive && selection.includes(s)) {
        this.path(this.ring(s.x, s.z, Math.max(s.c.L * 0.62 * s.vs, 10 * mpp), 40), true);
        g.strokeStyle = C.friend; g.globalAlpha = s === primary ? 1 : 0.6; g.lineWidth = s === primary ? 2 : 1.5; g.stroke(); g.globalAlpha = 1;
      }
      this.label(s.name, p.x, y, col, '600 12.5px "Barlow Condensed", sans-serif');
      if (s.alive) {
        const w = 40, yy = y + 11; g.fillStyle = 'rgba(4,9,14,.8)'; g.fillRect(p.x - w / 2 - 1, yy - 1, w + 2, 4);
        const f = s.hp / s.c.hp; g.fillStyle = f > 0.6 ? C.good : f > 0.3 ? C.acc : C.foe; g.fillRect(p.x - w / 2, yy, w * clamp(f, 0, 1), 2);
      } else this.label(s.magazine ? 'blown up' : 'sinking', p.x, y + 13, C.foe, '500 11px "Barlow Condensed", sans-serif');
    }

    // selection box
    if (this.box) {
      const b = this.box;
      g.fillStyle = 'rgba(71,215,193,.08)'; g.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      g.strokeStyle = C.friend; g.lineWidth = 1; g.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }

    // scale bar, labelled in real-equivalent distance
    const bars = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const want = toReal(W * 0.14 * mpp);
    const bl = bars.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
    const bpx = toGame(bl) / mpp, bx = W - bpx - 16, by = H - 22;
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by - 5); g.lineTo(bx, by); g.lineTo(bx + bpx, by); g.lineTo(bx + bpx, by - 5); g.stroke();
    this.label(`${bl >= 1000 ? bl / 1000 + ' km' : bl + ' m'} range`, bx + bpx / 2, by - 11, '#fff', '500 11px "IBM Plex Mono", monospace');
  }
}
