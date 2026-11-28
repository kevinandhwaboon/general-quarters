import * as THREE from 'three';
import { rnd } from '../math';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export const texGlow = canvasTexture(64, 64, g => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.25, 'rgba(255,255,255,.75)'); r.addColorStop(.6, 'rgba(255,255,255,.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
});
export const texSplash = canvasTexture(64, 128, g => {
  for (let i = 0; i < 80; i++) {
    const y = rnd(10, 124), spread = (1 - y / 128) * 10 + 6 + (y / 128) * 14;
    const x = 32 + rnd(-spread, spread) * (0.4 + y / 128 * 0.7), r = rnd(4, 10) * (0.5 + y / 128);
    const gr = g.createRadialGradient(x, y, 0, x, y, r), a = 0.18 + 0.5 * (y / 128);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
});
export const texSmoke = canvasTexture(64, 64, g => {
  for (let i = 0; i < 14; i++) {
    const x = rnd(18, 46), y = rnd(18, 46), r = rnd(10, 20), gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }
});
export const texWater = canvasTexture(256, 256, (g, w, h) => {
  const img = g.createImageData(w, h);
  const waves = [[3, 1, 0], [1, 4, 1.3], [5, -2, 2.1], [7, 3, .4], [-2, 9, 2.9], [11, 5, 1.7], [-6, 13, .8], [15, -9, 2.4]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; waves.forEach(([a, b, p], i) => { v += Math.sin(2 * Math.PI * (a * x + b * y) / 256 + p) / (1 + i * 0.45); });
    v /= 3.6; const crest = Math.max(0, v - 0.55) * 2.2, k = (x + y * w) * 4, base = 0.82 + v * 0.1 + crest * 0.45;
    img.data[k] = Math.min(255, base * 235); img.data[k + 1] = Math.min(255, base * 245); img.data[k + 2] = Math.min(255, base * 255); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
});
texWater.wrapS = texWater.wrapT = THREE.RepeatWrapping;
texWater.anisotropy = 8;

type Kind = 'flash' | 'boom' | 'big' | 'splash' | 'smoke' | 'bsmoke' | 'gunsmoke' | 'flak';
const LIFE: Record<Kind, number> = { flash: 0.3, boom: 1, big: 3.2, splash: 4, smoke: 7, bsmoke: 18, gunsmoke: 6, flak: 2.6 };

interface Fx { kind: Kind; sp: THREE.Sprite; age: number; size: number; }

export class Effects {
  private list: Fx[] = [];
  constructor(private scene: THREE.Scene) {}

  sprite(tex: THREE.Texture, color: number, additive: boolean, opacity: number) {
    const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity });
    const s = new THREE.Sprite(m); this.scene.add(s); return s;
  }

  add(kind: Kind, x: number, y: number, z: number, size: number) {
    let sp: THREE.Sprite;
    if (kind === 'flash') sp = this.sprite(texGlow, 0xffc27a, true, 1);
    else if (kind === 'boom' || kind === 'big') sp = this.sprite(texGlow, 0xff8a3a, true, 1);
    else if (kind === 'splash') { sp = this.sprite(texSplash, 0xf2f7ff, false, 0.95); sp.center.set(0.5, 0.02); }
    else sp = this.sprite(texSmoke, kind === 'bsmoke' ? 0x2a2b2e : kind === 'gunsmoke' ? 0xc9c6bd : kind === 'flak' ? 0x3a3631 : 0xa9adb1, false, 0.5);
    sp.position.set(x, y, z);
    this.list.push({ kind, sp, age: 0, size });
    this.update(0);
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.age += dt;
      const a = f.age, L = LIFE[f.kind], s = f.size, m = f.sp.material;
      if (a >= L) { this.scene.remove(f.sp); m.dispose(); this.list.splice(i, 1); continue; }
      if (f.kind === 'flash') { f.sp.scale.setScalar(s * (1 + a * 5)); m.opacity = 1 - a / L; }
      else if (f.kind === 'boom' || f.kind === 'big') { f.sp.scale.setScalar(s * (0.5 + a * 1.8)); m.opacity = 1 - a / L; }
      else if (f.kind === 'splash') { const h = s * Math.min(1, a / 0.6); f.sp.scale.set(s * 0.34 * (1 + a * 0.35), h, 1); m.opacity = a < 1.6 ? 0.93 : 0.93 * (1 - (a - 1.6) / (L - 1.6)); }
      else if (f.kind === 'flak') { f.sp.scale.setScalar(s * (0.5 + a * 0.5)); m.opacity = 0.75 * (1 - a / L); }
      else {
        f.sp.scale.setScalar(s * (0.8 + a * (f.kind === 'bsmoke' ? 0.16 : 0.3)));
        f.sp.position.y += dt * s * 0.07; f.sp.position.x -= dt * s * 0.05; f.sp.position.z += dt * s * 0.02;
        m.opacity = (f.kind === 'bsmoke' ? 0.62 : f.kind === 'gunsmoke' ? 0.5 : 0.35) * (1 - a / L);
      }
    }
  }
}
