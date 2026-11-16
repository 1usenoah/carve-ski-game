import * as THREE from 'three';
import { fbm2 } from '../core/noise.js';

// ─────────────────────────────────────────────────────────────
// Procedural snow textures (no external assets required)
// ─────────────────────────────────────────────────────────────

function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return { c, ctx: c.getContext('2d') };
}

/** Fine groomed-cordoroy normal map: parallel corduroy lanes + micro sastrugi. */
export function makeCorduroyNormal(size = 256, lanes = 26) {
  const { c, ctx } = canvas2d(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const bump = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // rounded corduroy ridges running down the fall line (v axis)
      const lane = Math.sin(u * Math.PI * 2 * lanes + Math.sin(v * 9.1) * 0.16) * 0.5 + 0.5;
      const ridge = Math.pow(lane, 1.15);
      // micro sastrugi / wind ripples
      const micro =
        fbm2(u * 38, v * 6, 3) * 0.55 + valueNoiseUv(u * 220, v * 12) * 0.45;
      bump[y * size + x] = ridge * 0.62 + micro * 0.38;
    }
  }
  const at = (x, y) => bump[((y + size) % size) * size + ((x + size) % size)];
  const strength = 0.55;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = Math.round((nx * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function valueNoiseUv(x, y) {
  return fbm2(x, y, 1);
}

/** Albedo texture: groomer lanes, corduroy grain and a little sparkle. */
export function makeSnowAlbedo(size = 512) {
  const { c, ctx } = canvas2d(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // wide groomer passes (every ~3.2 m on a 24 m tile)
      const pass = Math.sin(u * Math.PI * 2 * 7.5 + 0.6) * 0.5 + 0.5;
      // fine corduroy (every ~22 cm)
      const lane = Math.sin(u * Math.PI * 2 * 108 + Math.sin(v * 11.0) * 0.25) * 0.5 + 0.5;
      const grain = fbm2(u * 90, v * 90, 3);
      let val = 0.958 + pass * 0.012 + lane * 0.012 + (grain - 0.5) * 0.022;
      // sparkle specks
      if (grain > 0.86) val += 0.05;
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, val * 255);
      d[i + 1] = Math.min(255, val * 256);
      d[i + 2] = Math.min(255, val * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Roughness/brightness variation for the packed snow. */
export function makeSnowRoughness(size = 256) {
  const { c, ctx } = canvas2d(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const lane = Math.sin(u * Math.PI * 2 * 30 + Math.sin(v * 9.1) * 0.16) * 0.5 + 0.5;
      const n = fbm2(u * 16, v * 16, 4);
      const val = 0.66 + lane * 0.06 + n * 0.24;
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(val * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Soft round sprite used for snow spray / glitter / glow billboards. */
export function makeSoftDot(size = 64) {
  const { c, ctx } = canvas2d(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.75)');
  g.addColorStop(0.72, 'rgba(255,255,255,.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Snow spray puff sprite: slightly feathered, with a little grain. */
export function makePuff(size = 96) {
  const { c, ctx } = canvas2d(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,.95)');
  g.addColorStop(0.45, 'rgba(240,248,255,.55)');
  g.addColorStop(0.78, 'rgba(226,240,255,.12)');
  g.addColorStop(1, 'rgba(226,240,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** B-net (orange safety fence) alpha/color texture. */
export function makeBnetTexture(w = 128, h = 64) {
  const { c, ctx } = canvas2d(128);
  c.width = w;
  c.height = h;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f08328');
  g.addColorStop(0.5, '#d9641a');
  g.addColorStop(1, '#a84a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // woven mesh holes
  ctx.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < h; y += 5) {
    for (let x = (y / 5) % 2 ? 2.5 : 0; x < w; x += 5) {
      ctx.beginPath();
      ctx.arc(x + 1.6, y + 2, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  // top and bottom hem
  ctx.fillStyle = '#ffb15c';
  ctx.fillRect(0, 0, w, 3);
  ctx.fillStyle = '#a83f06';
  ctx.fillRect(0, h - 3, w, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Banner texture with text, used on the start/finish arches. */
export function makeTargetZoneTexture(color = '#5ef0d8') {
  const s = 256;
  const { c, ctx } = canvas2d(s);
  c.width = s;
  c.height = s;
  ctx.clearRect(0, 0, s, s);
  const cy = s * 0.5;
  const ringR = s * 0.155;
  for (const cx of [s * 0.16, s * 0.84]) {
    // soft halo
    const g = ctx.createRadialGradient(cx, cy, ringR * 0.2, cx, cy, ringR * 1.5);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR * 1.5, 0, Math.PI * 2);
    ctx.fill();
    // crisp ring
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    // aiming ticks
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR * 1.16, a - 0.12, a + 0.12);
      ctx.stroke();
    }
  }
  // dashed crossbar showing the gate line
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(s * 0.18, cy);
  ctx.lineTo(s * 0.82, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  // centre chevron pointing downhill
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, cy + s * 0.13);
  ctx.lineTo(s * 0.45, cy + s * 0.055);
  ctx.lineTo(s * 0.55, cy + s * 0.055);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Banner texture with text, used on the start/finish arches. */

export function makeBannerTexture(text, sub, { bg = '#0b2237', accent = '#5ef0d8', dark = '#04121d' } = {}) {
  const w = 1024;
  const h = 192;
  const { c, ctx } = canvas2d(w);
  c.width = w;
  c.height = h;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, dark);
  g.addColorStop(0.5, bg);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // diagonal stripes on the ends
  for (let i = -1; i < 14; i++) {
    ctx.fillStyle = i % 2 ? accent : '#0e2c44';
    ctx.beginPath();
    ctx.moveTo(i * 26, 0);
    ctx.lineTo(i * 26 + 16, 0);
    ctx.lineTo(i * 26 - 20, h);
    ctx.lineTo(i * 26 - 36, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.save();
  ctx.fillStyle = 'rgba(3,12,20,.72)';
  ctx.fillRect(180, 18, w - 360, h - 36);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(180, 18, w - 360, h - 36);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 68px "Rajdhani", "Noto Sans KR", sans-serif';
  ctx.fillText(text, w / 2, h / 2 - 10);
  ctx.fillStyle = accent;
  ctx.font = '700 24px "Rajdhani", "Noto Sans KR", sans-serif';
  ctx.fillText(sub, w / 2, h / 2 + 52);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Pass-zone decal for the snow under a gate: pole rings + dashed crossbar. */
