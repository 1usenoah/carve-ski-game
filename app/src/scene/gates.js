import * as THREE from 'three';
import { clamp } from '../core/noise.js';
import { FINISH_Z, PISTE_HALF } from './terrain.js';

/* ─────────────────────────────────────────────────────────────
 * FIS giant-slalom / super-G gates
 *
 * One gate is not a single pair of poles. Per the FIS ICR (901.2.1,
 * 1001.3.1) a downhill, super-G or giant-slalom gate is made of TWO flag
 * sets — four poles and two panels of about 0.75 × 0.5 m whose lower edge
 * hangs about a metre above the snow:
 *
 *        inside / TURNING gate          outside gate
 *            (2 poles + panel)   ⇠ 4–8 m ⇢  (2 poles + panel)
 *
 * The racer rounds the turning-pole set on its outside (shoulder on the
 * panel, cross-blocking), crosses the gate line between the two sets and
 * leaves for the next gate. Consecutive gates alternate red / blue.
 *
 * The course is set the way a WC course setter does it: a rhythmic swing
 * of 34–41 m long turns with long / medium / short turns and delayed
 * gates, the turning poles 16–22 m apart across the fall line.
 * ───────────────────────────────────────────────────────────── */

const GATE_RED = 0xd6303f;
const GATE_BLUE = 0x2a5bd7;

const PANEL_W = 1.15;        // reference panel: a wide cloth flag
const PANEL_H = 0.68;
const PANEL_BOTTOM = 1.05;   // lower edge ≈1 m above the snow
const POLE_H = 1.92;         // ≈1.9 m poles
const POLE_GAP = 0.95;       // the two poles of one flag set (the panel spans them)
const SG_WIDTH = 8.0;        // turning pole → outside pole (reference SG gateWidth)

const PASS_INSIDE = 1.05;    // how far inside the turning pole still counts
const PASS_OUTSIDE = 1.25;   // how far past the outside pole still counts
const RIDE_OFF = 0.9;        // the painted line runs this far outside the pole

/* The course is set with the reference's own Super-G numbers: each entry is
 * [gap along the fall line, offset of the turning pole from the centre line,
 * drift of the centre line]. These are the Larchwood + Plateau runs from
 * carvemania's course data, so the rhythm — long 43–45 m sweepers, tighter
 * 33–38 m turns, drifts of a few metres — is the reference rhythm. */
const REF_LAYOUT = [
  [39, 5.5, -1.5], [38.5, 6.5, -2], [41.5, 7, 2.5], [39.5, 7.5, 3],
  [37.5, 7, 1.5], [43, 6.5, -2], [39.5, 7, -2.5], [39.5, 5.5, -1.5],
  [43.5, 5, 2], [41.5, 5.5, 3.5], [38.5, 6.5, -0.5], [45, 7, -2.5],
  [45, 7.5, -0.5], [33.5, 7, 2.5], [44.5, 6.5, 0], [42.5, 6, 0],
  [40, 7, 1], [44, 6.5, 2.5], [38.5, 6, -2], [42, 7.5, 1.5],
  [40, 6.5, -1], [43.5, 7, 2], [39, 6, 0], [41, 6.8, -1.5],
];

/* ─────────────────────────────────────────────────────────────
 * Textures
 * ───────────────────────────────────────────────────────────── */

/** Printed gate panel: solid FIS cloth with a white sleeve hem. */
function gatePanelTexture(hex, label) {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = hex;
  g.fillRect(0, 0, 240, 160);
  // woven cloth shading towards the hanging hem
  const grad = g.createLinearGradient(0, 0, 0, 160);
  grad.addColorStop(0, 'rgba(255,255,255,0.14)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 240, 160);
  // stitched white hem top and bottom
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillRect(0, 0, 240, 11);
  g.fillRect(0, 149, 240, 11);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 11, 240, 2);
  g.fillRect(0, 147, 240, 2);
  // course name, rotated like the printed panels on a WC gate
  g.save();
  g.translate(120, 80);
  g.rotate(-Math.PI / 2);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 26px "Rajdhani", "Arial Black", sans-serif';
  g.fillText(label, 0, 2);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Sprayed blue course dye: soft, broken edges like a paint can on snow. */
function makeDyeTexture(rgb = [34, 82, 190]) {
  const W = 256;
  const H = 32;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const v = Math.abs(y / (H - 1) - 0.5) * 2; // 0 centre → 1 edge
    for (let x = 0; x < W; x++) {
      // periodic along the length so the tile wraps cleanly
      const u = (x / W) * Math.PI * 2;
      const wob =
        0.5 +
        0.24 * Math.sin(u * 2 + 0.7) +
        0.16 * Math.sin(u * 5 + 2.1) +
        0.10 * Math.sin(u * 11 + 4.3);
      const edge = 0.80 + 0.44 * wob;          // sprayed edge, not a ruler line
      let a = clamp(1 - Math.pow(v / edge, 2.1), 0, 1);
      a *= 0.72 + 0.28 * wob;                  // uneven paint load
      if (v > edge - 0.12) a *= 0.55 + 0.45 * wob; // speckled fringe
      const i = (y * W + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

/** Double chevron pointing +X, painted on the snow toward the next gate. */
function makeChevronTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.96)';
  g.lineWidth = 15;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const ox of [-20, 20]) {
    g.beginPath();
    g.moveTo(64 + ox - 20, 30);
    g.lineTo(64 + ox + 20, 64);
    g.lineTo(64 + ox - 20, 98);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Cloth panel that sags between its two poles. */
function makePanelGeometry(w, h, sag = 0.055) {
  const geo = new THREE.PlaneGeometry(w, h, 8, 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = x / (w * 0.5);            // -1 .. 1 across
    const t = (y + h * 0.5) / h;        // 0 hem .. 1 sleeve
    const belly = 1 - u * u;
    pos.setY(i, y - sag * (1 - t) * belly);
    pos.setZ(i, 0.028 * belly * (1 - t));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ─────────────────────────────────────────────────────────────
 * Ribbons (dye lines)
 * ───────────────────────────────────────────────────────────── */

function ribbonGeometry(samples, width, { tile = 7, lift = 0.035 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  let run = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const nx = -tz;
    const nz = tx;
    if (i > 0) run += Math.hypot(p.x - samples[i - 1].x, p.z - samples[i - 1].z);
    const hw = width * 0.5;
    pos.push(p.x - nx * hw, p.y + lift, p.z - nz * hw);
    pos.push(p.x + nx * hw, p.y + lift, p.z + nz * hw);
    uv.push(run / tile, 0, run / tile, 1);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geo;
}

/* ─────────────────────────────────────────────────────────────
 * The reference's painted line is not a continuous stripe: it is a run of
 * soft, rounded dashes — a light blue powder mark about 2 m long with a 2 m
 * gap — laid along the ideal arc. This builds those quads in one geometry.
 * ───────────────────────────────────────────────────────────── */

function makeDashTexture() {
  const W = 64;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = 30;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(2 + r * 0, 2 + r);
  g.arcTo(W - 2, 2, W - 2, H - 2, r);
  g.arcTo(W - 2, H - 2, 2, H - 2, r);
  g.arcTo(2, H - 2, 2, 2, r);
  g.arcTo(2, 2, W - 2, 2, r);
  g.closePath();
  g.fill();
  // a slightly ragged edge, like powder sprayed on snow
  const img = g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!img.data[i + 3]) continue;
      const n = Math.sin(x * 1.7 + y * 0.9) * 0.5 + Math.sin(y * 2.3) * 0.5;
      img.data[i + 3] = Math.round(Math.min(255, img.data[i + 3] * (0.82 + 0.18 * n)));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function dashGeometry(samples, width, { dash = 2.1, gap = 1.85, lift = 0.045 } = {}) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-5) continue;
    segs.push({ a, b, l, s0: total });
    total += l;
  }
  const at = (s, out) => {
    let seg = segs[segs.length - 1];
    for (let i = 0; i < segs.length; i++) {
      if (s <= segs[i].s0 + segs[i].l) { seg = segs[i]; break; }
    }
    const u = clamp((s - seg.s0) / seg.l, 0, 1);
    out.x = seg.a.x + (seg.b.x - seg.a.x) * u;
    out.z = seg.a.z + (seg.b.z - seg.a.z) * u;
    out.y = seg.a.y + (seg.b.y - seg.a.y) * u;
    const tl = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z) || 1;
    out.nx = -(seg.b.z - seg.a.z) / tl;
    out.nz = (seg.b.x - seg.a.x) / tl;
    return out;
  };
  const pos = [];
  const uv = [];
  const idx = [];
  const p = { x: 0, y: 0, z: 0, nx: 0, nz: 0 };
  const hw = width * 0.5;
  let k = 0;
  for (let s = 0; s < total - 0.3; s += dash + gap) {
    const s1 = Math.min(total, s + dash);
    if (s1 - s < 0.25) break;
    const n = Math.max(2, Math.ceil((s1 - s) / 0.65));
    for (let j = 0; j <= n; j++) {
      at(s + ((s1 - s) * j) / n, p);
      pos.push(p.x - p.nx * hw, p.y + lift, p.z - p.nz * hw);
      pos.push(p.x + p.nx * hw, p.y + lift, p.z + p.nz * hw);
      uv.push(0, j / n, 1, j / n);
    }
    for (let j = 0; j < n; j++) {
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      k += 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return geo;
}

function dyeMaterial(map, opacity, color = 0xffffff) {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  });
}

/* ─────────────────────────────────────────────────────────────
 * One flag set: two hinged poles with a panel hung between them.
 * The whole set tips over at its base when a skier clips the panel,
 * then springs back with a wobble — exactly how a GS gate behaves.
 * ───────────────────────────────────────────────────────────── */

class FlagSet {
  constructor(gate, mesh, base, yaw, side) {
    this.gate = gate;
    this.group = mesh;            // hinge pivot, origin at the snow
    this.base = base;             // world position of the hinge
    this.yaw = yaw;
    this.side = side;             // 'turn' | 'outside'
    this.bend = 0;                // radians pushed downhill (+)
    this.bendVel = 0;
    this.sway = 0;                // radians pushed sideways
    this.swayVel = 0;
    this.cooldown = 0;
    this.poles = 2;
    this.panel = null;
    this.hitPoint = new THREE.Vector3();
    // world position of each pole base (the hinge never moves the base)
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    this.poleWorld = [-POLE_GAP / 2, POLE_GAP / 2].map(
      (lx) => new THREE.Vector3(base.x + cs * lx, base.y, base.z - sn * lx)
    );
    this.hitPoint.set(base.x, base.y + PANEL_BOTTOM + PANEL_H * 0.5, base.z);
  }

  /** Distance in the ground plane from a point to this flag's panel. */
  distTo(x, z) {
    const [a, b] = this.poleWorld;
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const wx = x - a.x;
    const wz = z - a.z;
    const len2 = vx * vx + vz * vz || 1;
    const t = clamp((wx * vx + wz * vz) / len2, 0, 1);
    return Math.hypot(wx - vx * t, wz - vz * t);
  }

  /** Spawn the spring: the panel is shoved downhill, a little to the side. */
  impact(force, sideKick) {
    this.bendVel += 18.5 * force;
    this.swayVel += clamp(sideKick * 4.0, -3.2, 3.2) * force;
    this.cooldown = 0.30;
  }

  update(dt, time = 0) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    // 2.4 Hz spring, lightly damped: clipped → over it goes → wobble → back
    const k = 228;
    const c = 5.4;
    this.bendVel += (-k * this.bend - c * this.bendVel) * dt;
    this.bend = clamp(this.bend + this.bendVel * dt, -0.15, 1.25);
    this.swayVel += (-k * 0.8 * this.sway - c * 0.9 * this.swayVel) * dt;
    this.sway = clamp(this.sway + this.swayVel * dt, -0.8, 0.8);
    // local +Z faces up the hill, so a downhill tip is a negative X rotation.
    // A slow wind breathe keeps the cloth alive the way the reference panels
    // hang and drift on their poles.
    const phase = (this.gate.index ?? 0) * 1.37 + (this.side === 'outside' ? 0.9 : 0);
    const wind = Math.sin(time * 1.35 + phase) * 0.018 + Math.sin(time * 2.9 + phase * 2.1) * 0.008;
    this.group.rotation.x = -this.bend + wind * 0.6;
    this.group.rotation.z = this.sway + wind;
  }

  reset() {
    this.bend = this.bendVel = this.sway = this.swayVel = 0;
    this.cooldown = 0;
    this.group.rotation.set(0, this.yaw, 0);
  }
}

/* ─────────────────────────────────────────────────────────────
 * The course
 * ───────────────────────────────────────────────────────────── */

export class Gates {
  constructor(scene, terrain, def, count = 28, options = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.def = def;
    this.count = count;
    this.onHit = options.onHit ?? null;
    this.group = new THREE.Group();
    this.dyeGroup = new THREE.Group();
    scene.add(this.group, this.dyeGroup);
    this.time = 0;
    this.list = [];
    this.current = 0;
    this.passed = [];
    this.guidePoints = [];
    this.panelTex = {
      red: gatePanelTexture('#dc1f28', (def.short ?? 'CARVE').slice(0, 12)),
      blue: gatePanelTexture('#1747e0', (def.short ?? 'CARVE').slice(0, 12)),
    };
    this.dyeTex = makeDyeTexture();
    this.chevronTex = makeChevronTexture();
    this.layout();
    this.buildDye();
    this.build();
  }

  /* ── course setter ───────────────────────────────────────── */

  layout() {
    const t = this.terrain;
    const n = this.count;
    const zFirst = -54;
    const zLast = FINISH_Z + 66;
    const rows = [];
    for (let i = 0; i < n - 1; i++) rows.push(REF_LAYOUT[i % REF_LAYOUT.length]);
    const gapSum = rows.reduce((a, b) => a + b[0], 0);
    const scale = (zFirst - zLast) / gapSum;

    const zs = [zFirst];
    for (let i = 0; i < n - 1; i++) zs.push(zs[i] - rows[i][0] * scale);

    const apex = zs.map((z, i) => {
      const [, offset, drift] = REF_LAYOUT[i % REF_LAYOUT.length];
      const side = i % 2 === 0 ? 1 : -1;
      return { z, x: t.centerX(z) + drift + side * offset, side, offset, drift };
    });

    const gates = [];
    for (let i = 0; i < n; i++) {
      const a = apex[i];
      const prev = apex[Math.max(0, i - 1)];
      const next = apex[Math.min(n - 1, i + 1)];
      // line of travel through the gate: from the previous turning pole to the next
      let wx = next.x - prev.x;
      let wz = next.z - prev.z;
      const wl = Math.hypot(wx, wz) || 1;
      wx /= wl;
      wz /= wl;
      // right-hand side of that direction; the gate opens on the side the
      // turning pole sits, which is how the reference sets every gate
      const rx = -wz;
      const rz = wx;
      const ux = rx * a.side;
      const uz = rz * a.side;
      const width = SG_WIDTH;
      // approach direction, for the diagonal face of the panels
      let ax = a.x - prev.x;
      let az = a.z - prev.z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;

      gates.push({
        index: i,
        z: a.z,
        apexX: a.x,
        cx: t.centerX(a.z),
        side: a.side,
        // turning pole sits on the race line; the gate line runs outward
        tx: a.x,
        tz: a.z,
        ox: a.x + ux * width,
        oz: a.z + uz * width,
        width,
        w: { x: wx, z: wz },
        u: { x: ux, z: uz },
        heading: Math.atan2(wx, -wz),
        yaw: Math.atan2(-ax, -az),
        colorIndex: i % 2 === 0 ? 0 : 1,
        color: new THREE.Color(i % 2 === 0 ? GATE_RED : GATE_BLUE),
        judged: false,
        missedGate: false,
      });
    }
    this.course = gates;
  }

  /* ── blue dye: the sprayed race line and the course-side guides ── */

  buildDye() {
    const t = this.terrain;
    const pts = this.course;

    /* Hermite spline through the turning poles with the gate tangents, which
     * is what a setter paints: the arc arriving at, and leaving, each apex. */
    const line = [];
    const first = pts[0];
    const last = pts[pts.length - 1];
    // the paint runs just outside the turning pole: it is the ski track, and
    // the panel is what the shoulder clips on the way past
    const apexOf = (g) => new THREE.Vector3(g.tx + g.u.x * RIDE_OFF, 0, g.tz + g.u.z * RIDE_OFF);
    // run-in from the start and out to the finish, on the centre line
    const zIn = first.z + 64;
    const xIn = t.centerX(zIn);
    const firstApex = apexOf(first);
    const inSteps = Math.max(8, Math.round(Math.abs(zIn - first.z) / 1.6));
    for (let s = 0; s <= inSteps; s++) {
      const u = s / inSteps;
      const z = zIn + (first.z - zIn) * u;
      const x = xIn + (firstApex.x - xIn) * u * u * (3 - 2 * u);
      line.push(new THREE.Vector3(x, t.heightAt(x, z), z));
    }

    for (let i = 1; i < pts.length; i++) {
      const g = pts[i];
      const prev = pts[i - 1];
      const p0 = apexOf(g);
      const prevApex = apexOf(prev);
      const dist = p0.clone().sub(prevApex).length() || 1;
      // Hermite tangents along the line of travel at each gate
      const mStart = new THREE.Vector3(prev.w.x, 0, prev.w.z).multiplyScalar(dist * 0.62);
      const mEnd = new THREE.Vector3(g.w.x, 0, g.w.z).multiplyScalar(dist * 0.62);
      const steps = Math.max(6, Math.round(dist / 1.4));
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        const x = h00 * prevApex.x + h10 * mStart.x + h01 * p0.x + h11 * mEnd.x;
        const z = h00 * prevApex.z + h10 * mStart.z + h01 * p0.z + h11 * mEnd.z;
        line.push(new THREE.Vector3(x, t.heightAt(x, z), z));
      }
    }

    const zOut = last.z - 60;
    const xOut = t.centerX(zOut);
    const stepsOut = 34;
    const lastApex = apexOf(last);
    for (let s = 1; s <= stepsOut; s++) {
      const u = s / stepsOut;
      const z = last.z + (zOut - last.z) * u;
      const x = lastApex.x + (xOut - lastApex.x) * u;
      line.push(new THREE.Vector3(x, t.heightAt(x, z), z));
    }
    this.guidePoints = line;

    // the painted race line: the reference's run of soft blue dashes
    const dashMat = new THREE.MeshBasicMaterial({
      map: makeDashTexture(),
      color: 0x9cb8ec,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.dashMat = dashMat;
    const dyeLine = new THREE.Mesh(dashGeometry(line, 0.62, { dash: 2.2, gap: 1.7, lift: 0.16 }), dashMat);
    dyeLine.renderOrder = 7;
    dyeLine.frustumCulled = false;
    this.dyeGroup.add(dyeLine);
    this.dyeLine = dyeLine;

    // a fainter wide swath under the dashes, the way the crew double-sprays
    const halo = new THREE.Mesh(ribbonGeometry(line, 1.5, { lift: 0.1, tile: 6.5 }), dyeMaterial(this.dyeTex, 0.08));
    halo.renderOrder = 5;
    halo.frustumCulled = false;
    this.dyeGroup.add(halo);

    // course-side guides down both edges of the piste
    for (const side of [-1, 1]) {
      const edge = [];
      for (let z = 24; z >= FINISH_Z + 16; z -= 9) {
        const x = t.centerX(z) + side * (PISTE_HALF - 2.6);
        edge.push(new THREE.Vector3(x, t.heightAt(x, z), z));
      }
      const m = new THREE.Mesh(ribbonGeometry(edge, 0.26, { tile: 9 }), dyeMaterial(this.dyeTex, 0.4));
      m.renderOrder = 6;
      m.frustumCulled = false;
      this.dyeGroup.add(m);
    }
  }

  /* ── gates ───────────────────────────────────────────────── */

  build() {
    const t = this.terrain;
    const poleGeo = new THREE.CylinderGeometry(0.027, 0.031, POLE_H, 8);
    poleGeo.translate(0, POLE_H * 0.5, 0);
    const bandGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.18, 8);
    const baseGeo = new THREE.CylinderGeometry(0.09, 0.13, 0.035, 10);
    const panelGeo = makePanelGeometry(PANEL_W, PANEL_H);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a3442, roughness: 0.45, metalness: 0.45 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1b2330, roughness: 0.85, metalness: 0.1 });

    for (const g of this.course) {
      g.y = t.heightAt(g.tx, g.tz);
      const tint = g.colorIndex === 0 ? GATE_RED : GATE_BLUE;
      const tex = g.colorIndex === 0 ? this.panelTex.red : this.panelTex.blue;
      const bandMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.2 });
      const panelMat = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0.0,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(tint),
        emissiveIntensity: 0.10,
      });

      const flags = [];
      for (const [side, px, pz] of [
        ['turn', g.tx, g.tz],
        ['outside', g.ox, g.oz],
      ]) {
        const pivot = new THREE.Group();
        pivot.position.set(px, t.heightAt(px, pz), pz);
        pivot.rotation.y = g.yaw;

        const foot = new THREE.Mesh(baseGeo, baseMat);
        foot.position.y = 0.017;
        pivot.add(foot);

        for (const lx of [-POLE_GAP / 2, POLE_GAP / 2]) {
          const pole = new THREE.Mesh(poleGeo, poleMat);
          pole.position.x = lx;
          pole.castShadow = true;
          pivot.add(pole);

          const band = new THREE.Mesh(bandGeo, bandMat);
          band.position.set(lx, POLE_H - 0.20, 0);
          pivot.add(band);
        }

        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(0, PANEL_BOTTOM + PANEL_H * 0.5, 0.012);
        panel.castShadow = true;
        pivot.add(panel);

        this.group.add(pivot);
        const flag = new FlagSet(g, pivot, pivot.position.clone(), g.yaw, side);
        flag.panel = panel;
        flags.push(flag);
      }
      g.flags = flags;
      g.turnFlag = flags[0];
      g.outFlag = flags[1];

      // blue dye across the gate line, turning pole → outside pole
      const segs = [];
      const N = 6;
      for (let s = 0; s <= N; s++) {
        const u = s / N;
        const x = g.tx + (g.ox - g.tx) * u;
        const z = g.tz + (g.oz - g.tz) * u;
        segs.push(new THREE.Vector3(x, t.heightAt(x, z), z));
      }
      const gl = new THREE.Mesh(ribbonGeometry(segs, 0.34, { tile: 5, lift: 0.04 }), dyeMaterial(this.dyeTex, 0.95));
      gl.renderOrder = 7;
      this.dyeGroup.add(gl);
      g.gateLine = gl;

      // chevron painted on the snow: which way the line leaves this gate
      const nxt = this.course[Math.min(this.course.length - 1, g.index + 1)];
      let dx = nxt.tx - g.tx;
      let dz = nxt.tz - g.tz;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const chevH = new THREE.Group();
      const chev = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 1.3),
        new THREE.MeshBasicMaterial({
          map: this.chevronTex,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          toneMapped: false,
          color: 0x2a5ccd,
          polygonOffset: true,
          polygonOffsetFactor: -7,
          polygonOffsetUnits: -7,
        })
      );
      chev.rotation.x = -Math.PI / 2; // lie flat, arrows along local +X
      chevH.add(chev);
      const ax = g.tx + dx * 2.7;
      const az = g.tz + dz * 2.7;
      chevH.position.set(ax, t.heightAt(ax, az) + 0.045, az);
      chevH.rotation.y = Math.atan2(-dz, dx); // point down the exit of the turn
      chev.renderOrder = 8;
      this.dyeGroup.add(chevH);
      g.chevron = chev;

      // the ring that flashes when the gate is judged
      const flash = new THREE.Mesh(
        new THREE.TorusGeometry(g.width * 0.5, 0.075, 6, 40),
        new THREE.MeshBasicMaterial({
          color: tint,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      flash.rotation.x = Math.PI / 2;
      flash.position.set(g.tx + g.u.x * g.width * 0.5, g.y + 0.06, g.tz + g.u.z * g.width * 0.5);
      this.group.add(flash);
      g.flash = flash;
      g.flashT = 0;

      // turning-pole marker: a soft ring at the inside pole the line hugs
      const mark = new THREE.Mesh(
        new THREE.RingGeometry(0.34, 0.62, 20),
        new THREE.MeshBasicMaterial({
          color: tint,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        })
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(g.tx, t.heightAt(g.tx, g.tz) + 0.05, g.tz);
      mark.renderOrder = 9;
      this.dyeGroup.add(mark);
      g.mark = mark;

      this.list.push(g);
    }
    this.highlightNext();
  }

  /* ── judgement ───────────────────────────────────────────── */

  /**
   * Did the skier's movement this frame take them across the gate line?
   * The line runs from the turning pole to the outside pole; crossing it
   * anywhere between the two is a gate, anywhere else is a missed gate.
   */
  judgeStep(prevX, prevZ, x, z) {
    const g = this.list[this.current];
    if (!g) return null;
    const tp = (prevX - g.tx) * g.w.x + (prevZ - g.tz) * g.w.z; // negative = up the hill
    const tc = (x - g.tx) * g.w.x + (z - g.tz) * g.w.z;
    if (!(tp <= 0 && tc > 0)) {
      // already behind the gate plane without ever being in front of it
      if (tp > 0 && tc > 0 && !g.judged) return this.judge(g, -1, x, z, 'NEVER CROSSED THE GATE LINE');
      return null;
    }
    const f = clamp(tp / (tp - tc), 0, 1);
    const px = prevX + (x - prevX) * f;
    const pz = prevZ + (z - prevZ) * f;
    const s = (px - g.tx) * g.u.x + (pz - g.tz) * g.u.z;
    return this.judge(g, s, px, pz);
  }

  judge(g, s, px, pz, forcedReason = null) {
    // `s` is metres outward from the turning pole. The reference lets a ski
    // brush the pole (one metre inside still counts) and gives a metre of
    // slack past the outside pole, so only a real cut or a real wide miss is
    // a penalty.
    const clear = s;
    const inGate = clear >= -PASS_INSIDE && s <= g.width + PASS_OUTSIDE && !forcedReason;
    let label;
    let tone;
    let clean = false;
    let missed = false;
    let reason = null;

    if (!inGate) {
      missed = true;
      label = 'MISSED GATE';
      tone = 'wide';
      reason = forcedReason ?? (clear < 0 ? 'CUT INSIDE THE TURNING POLE' : 'OUTSIDE THE GATE LINE');
    } else if (clear < 0) {
      label = 'BRUSHED THE POLE';
      tone = 'tight';
      clean = true;
    } else if (clear < 0.40) {
      label = 'APEX PERFECT';
      tone = 'perfect';
      clean = true;
    } else if (clear < 1.7) {
      label = 'CLEAN LINE';
      tone = 'clean';
      clean = true;
    } else if (clear < 3.4) {
      label = 'TIGHT CARVE';
      tone = 'tight';
    } else {
      label = 'WIDE LINE';
      tone = 'wide';
    }

    g.judged = true;
    g.missedGate = missed;
    g.accuracy = s;
    g.label = label;
    g.reason = reason;
    g.flashT = 1;
    if (missed) {
      g.flash.material.color.setHex(0xff2a2a);
    }
    this.passed.push({ index: g.index, s, label, missed });
    this.current = g.index + 1;
    if (this.current < this.list.length) this.highlightNext();
    return { gate: g, s, missed, reason, label, tone, clean, x: px, z: pz };
  }

  /** Keep the turning pole the player must hug next lit up. */
  highlightNext() {
    for (const g of this.list) {
      if (g.mark) g.mark.material.opacity = 0.22;
    }
    const n = this.list[this.current];
    if (n && n.mark) n.mark.material.opacity = 0.6;
  }

  /** World point on the race line at gate i (its turning pole). */
  apexPoint(g, out = new THREE.Vector3()) {
    const y = this.terrain.heightAt(g.tx, g.tz) + 0.09;
    return out.set(g.tx, y, g.tz);
  }

  reset() {
    this.current = 0;
    this.passed = [];
    for (const g of this.list) {
      g.judged = false;
      g.missedGate = false;
      g.accuracy = null;
      g.flashT = 0;
      g.flash.material.opacity = 0;
      g.flash.material.color.copy(g.color);
      for (const f of g.flags) f.reset();
    }
    this.highlightNext();
  }

  /* ── per-frame ───────────────────────────────────────────── */

  update(dt, skier = null) {
    this.time += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4.2);

    for (const g of this.list) {
      for (const f of g.flags) f.update(dt, this.time);
      if (g.mark) {
        const target = g.index === this.current ? 0.45 + 0.35 * pulse : g.index < this.current ? 0.12 : 0.22;
        g.mark.material.opacity += (target - g.mark.material.opacity) * Math.min(1, dt * 8);
        g.mark.scale.setScalar(g.index === this.current ? 1 + 0.06 * pulse : 1);
      }
      if (g.flashT > 0) {
        g.flashT = Math.max(0, g.flashT - dt * 1.7);
        const k = 1 - g.flashT;
        g.flash.scale.setScalar(0.88 + k * 0.42);
        g.flash.material.opacity = g.flashT * 0.75;
      }
    }

    if (skier && !skier.airborne) this.checkPoleHits(skier);
  }

  /** The panel takes the hit: the flag set tips from its base and springs back. */
  checkPoleHits(skier) {
    const speed = Math.abs(skier.speed);
    if (speed < 3.5) return;
    for (const g of this.list) {
      if (Math.abs(g.tz - skier.z) > 6) continue;
      for (const f of g.flags) {
        if (f.cooldown > 0) continue;
        const d = f.distTo(skier.x, skier.z);
        if (d > 1.20) continue;
        const near = 1 - d / 1.20;
        const force = clamp(speed / 16, 0.45, 1.7) * (0.55 + near);
        // shove to the side the skier came from
        const sideKick = (skier.x - f.base.x) * 0.5 + (skier.z - f.base.z) * 0.15;
        f.impact(force, sideKick);
        this.onHit?.(f.hitPoint.clone(), g, f, force);
      }
    }
  }

  /** Structured gate data for the verification suite. */
  debug() {
    return {
      count: this.list.length,
      current: this.current,
      passed: this.passed.length,
      widthRange: [
        +Math.min(...this.list.map((g) => g.width)).toFixed(2),
        +Math.max(...this.list.map((g) => g.width)).toFixed(2),
      ],
      gates: this.list.map((g) => ({
        i: g.index,
        z: +g.z.toFixed(1),
        colour: g.colorIndex === 0 ? 'red' : 'blue',
        width: +g.width.toFixed(2),
        poles: g.flags.reduce((n, f) => n + f.poles, 0),
        panels: g.flags.length,
        turningPole: { x: +g.tx.toFixed(2), z: +g.tz.toFixed(1) },
        outsidePole: { x: +g.ox.toFixed(2), z: +g.oz.toFixed(1) },
        apexOffset: +(g.tx - g.cx).toFixed(2),
        judged: g.judged,
        missed: g.missedGate,
        s: g.accuracy == null ? null : +g.accuracy.toFixed(2),
        label: g.label ?? null,
        reason: g.reason ?? null,
      })),
    };
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.dyeGroup);
    for (const grp of [this.group, this.dyeGroup]) {
      grp.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
  }
}
