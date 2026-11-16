import * as THREE from 'three';
import { clamp } from '../core/noise.js';
import { FINISH_Z } from './terrain.js';

/* ─────────────────────────────────────────────────────────────
 * Racing line guide: a dashed line laid on the snow that swings
 * wide on the approach, clips the gate at its apex and bends
 * back in for the next one — the line a real GS setter paints.
 * ───────────────────────────────────────────────────────────── */

const GUIDE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GUIDE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPeriod;
uniform float uDuty;
void main() {
  // vUv.x runs along the line in metres
  float s = fract((vUv.x + uTime) / uPeriod);
  float dash = smoothstep(0.0, 0.02, s) * smoothstep(uDuty, uDuty - 0.02, s);
  float edge = smoothstep(0.0, 0.24, vUv.y) * smoothstep(1.0, 0.76, vUv.y);
  float a = dash * edge * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

function gatePanelTexture(color, label) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 384);
  // a lighter band top and bottom so the panel reads as a printed gate
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(0, 0, 256, 16);
  g.fillRect(0, 368, 256, 16);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 16, 256, 6);
  g.fillRect(0, 362, 256, 6);
  g.save();
  g.translate(128, 192);
  g.rotate(-Math.PI / 2);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic 900 66px "Rajdhani", "Arial Black", sans-serif';
  g.fillText(label, 0, 4);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Ribbon of the given width following a list of world points. */
function makeGuideMesh(points, width, color, opacity, { period = 2.6, duty = 0.46, speed = 0.5 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  let run = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const px = -tz;
    const pz = tx;
    if (i > 0) run += Math.hypot(p.x - prev.x, p.z - prev.z);
    pos.push(p.x - px * width * 0.5, p.y, p.z - pz * width * 0.5);
    pos.push(p.x + px * width * 0.5, p.y, p.z + pz * width * 0.5);
    uv.push(run, 0, run, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    vertexShader: GUIDE_VERT,
    fragmentShader: GUIDE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uPeriod: { value: period },
      uDuty: { value: duty },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.userData.speed = speed;
  return mesh;
}

/**
 * Race gates.
 *
 * The course is set like a real giant slalom: the gates swing rhythmically
 * left and right of the fall line, each one a pair of printed panels hinged
 * on its poles so a tight line clips them and they spring back. A dashed
 * carving line shows the apex of the next gates.
 */
export class Gates {
  constructor(scene, terrain, def, count = 16, options = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.def = def;
    this.count = count;
    this.onHit = options.onHit ?? null;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.guideGroup = new THREE.Group();
    scene.add(this.guideGroup);
    this.time = 0;
    this.list = [];
    this.current = 0;
    this.passed = [];
    this.halfW = 4.6;
    this.build();
  }

  /** Lateral offset of gate i: a rhythmic GS swing, left then right. */
  offsetFor(i) {
    const side = i % 2 === 0 ? -1 : 1;
    // the swing stays inside what a 69 m gate rhythm can be carved at speed
    const amp = 5.6 + 1.7 * Math.sin(i * 0.62 + 0.9) + 0.8 * Math.sin(i * 1.9 + 0.3);
    const swing = 0.8 + 0.2 * Math.sin(i * 1.35 + 1.7);
    return side * amp * swing;
  }

  build() {
    const t = this.terrain;
    const firstZ = -64;
    const span = firstZ - FINISH_Z;
    const n = this.count;
    const halfW = this.halfW;
    const poleGeo = new THREE.CylinderGeometry(0.045, 0.055, 2.05, 8);
    poleGeo.translate(0, 1.025, 0);
    const footGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.06, 10);
    const panelGeo = new THREE.PlaneGeometry(0.62, 1.42, 1, 1);
    const lineGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    lineGeo.rotateX(-Math.PI / 2);

    const label = (this.def.short ?? 'CARVE').slice(0, 12);
    const texRed = gatePanelTexture('#d8322c', label);
    const texBlue = gatePanelTexture('#1f56c8', label);

    for (let i = 0; i < n; i++) {
      const z = firstZ - (span * i) / (n - 1);
      const cx = t.centerX(z);
      const x = cx + this.offsetFor(i);
      const colorIndex = i % 2 === 0 ? 0 : 1;
      const panelTex = colorIndex === 0 ? texRed : texBlue;
      const tint = colorIndex === 0 ? 0xd8322c : 0x1f56c8;

      const gate = new THREE.Group();
      gate.position.set(x, t.heightAt(x, z), z);
      gate.rotation.y = t.headingAt(z);

      const poles = [];
      for (const side of [-1, 1]) {
        // pivot at the snow: the whole pole tips when it is clipped
        const pivot = new THREE.Group();
        pivot.position.set(side * halfW, 0, 0);
        gate.add(pivot);

        const foot = new THREE.Mesh(footGeo, new THREE.MeshStandardMaterial({
          color: 0x243040, roughness: 0.8, metalness: 0.1,
        }));
        foot.position.y = 0.02;
        pivot.add(foot);

        const pole = new THREE.Mesh(poleGeo, new THREE.MeshStandardMaterial({
          color: 0x1b2431,
          roughness: 0.42,
          metalness: 0.35,
        }));
        pole.castShadow = true;
        pivot.add(pole);

        // the printed panel hangs on the outside face of the pole
        const panel = new THREE.Mesh(panelGeo, new THREE.MeshStandardMaterial({
          map: panelTex,
          color: 0xffffff,
          roughness: 0.62,
          metalness: 0.02,
          side: THREE.DoubleSide,
          emissive: new THREE.Color(tint),
          emissiveIntensity: 0.06,
        }));
        panel.position.set(side * 0.34, 1.12, 0.01);
        panel.rotation.y = side > 0 ? -0.06 : 0.06;
        panel.castShadow = true;
        pivot.add(panel);

        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 8, 6),
          new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5 })
        );
        cap.position.y = 2.05;
        pivot.add(cap);

        poles.push({
          side,
          pivot,
          panel,
          bend: 0,
          bendVel: 0,
          sway: 0,
          swayVel: 0,
          cooldown: 0,
          world: new THREE.Vector3(),
        });
      }

      // gate line painted across the opening
      const line = new THREE.Mesh(
        lineGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
          toneMapped: false,
        })
      );
      line.scale.set(halfW * 2 - 0.3, 1, 0.42);
      line.position.set(0, 0.03, 0);
      line.renderOrder = 3;
      gate.add(line);

      // flash ring, hidden until the gate is passed cleanly
      const flash = new THREE.Mesh(
        new THREE.TorusGeometry(halfW, 0.07, 6, 44),
        new THREE.MeshBasicMaterial({
          color: colorIndex === 0 ? 0xff5a4a : 0x5b9bff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      flash.rotation.x = Math.PI / 2;
      flash.position.y = 0.05;
      gate.add(flash);

      this.group.add(gate);
      this.list.push({
        index: i,
        z,
        x,
        cx,
        halfW,
        y: gate.position.y,
        group: gate,
        poles,
        line,
        flash,
        flashT: 0,
        color: new THREE.Color(tint),
        passed: false,
        accuracy: null,
      });
    }
    this.buildGuide(0);
  }

  /** World point where the racing line clips gate i (near its inside pole). */
  apexPoint(g, out = new THREE.Vector3()) {
    const side = this.offsetFor(g.index) >= 0 ? 1 : -1;
    const x = g.x - side * g.halfW * 0.62;
    return out.set(x, this.terrain.heightAt(x, g.z) + 0.09, g.z);
  }

  /**
   * Dashed carving line through the next few gates. It arrives from the
   * outside, takes the apex at the gate and bends back in for the next turn.
   */
  buildGuide(fromIndex) {
    this.guideGroup.children.slice().forEach((c) => {
      this.guideGroup.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    });
    const t = this.terrain;
    const list = this.list;
    if (!list.length) return;

    const i0 = clamp(fromIndex - 1, 0, list.length - 1);
    const i1 = clamp(fromIndex + 2, 0, list.length - 1);
    if (i1 <= i0) return;

    const pts = [];
    const push = (x, z) => {
      pts.push(new THREE.Vector3(x, t.heightAt(x, z) + 0.09, z));
    };

    // A carved serpentine: brush the inside pole of each gate (the apex), then
    // bow out on the outside of the arc halfway to the next gate and bend
    // back in.  That is the line a course setter paints for a super-G.
    const apexX = (g) => {
      const side = this.offsetFor(g.index) >= 0 ? 1 : -1;
      return g.x - side * g.halfW * 0.62;
    };
    const start = list[i0];
    const sSide = this.offsetFor(start.index) >= 0 ? 1 : -1;
    // entry: the ski arrives from the previous turn, on the far side
    push(apexX(start) - sSide * 2.6, start.z + 17);

    for (let i = i0; i <= i1; i++) {
      const g = list[i];
      push(apexX(g), g.z);
      if (i < i1) {
        const nxt = list[i + 1];
        const sideNext = this.offsetFor(nxt.index) >= 0 ? 1 : -1;
        // bow out on the outside of the arc halfway to the next gate
        push((apexX(g) + apexX(nxt)) * 0.5 + sideNext * 2.0, (g.z + nxt.z) * 0.5);
      }
    }

    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
    const samples = [];
    const N = Math.max(40, (i1 - i0 + 1) * 44);
    for (let i = 0; i <= N; i++) {
      const p = curve.getPoint(i / N);
      p.y = t.heightAt(p.x, p.z) + 0.09;
      samples.push(p);
    }

    const inner = makeGuideMesh(samples, 1.05, new THREE.Color('#4f7fc4'), 0.95, {
      period: 2.2,
      duty: 0.44,
      speed: 1.1,
    });
    const halo = makeGuideMesh(samples, 2.4, new THREE.Color('#5b86c9'), 0.1, {
      period: 2.2,
      duty: 0.5,
      speed: 1.1,
    });
    halo.renderOrder = 4;
    this.guideGroup.add(halo, inner);
    this.guidePoints = samples;
  }

  reset() {
    this.current = 0;
    this.passed = [];
    for (const g of this.list) {
      g.passed = false;
      g.accuracy = null;
      g.flashT = 0;
      g.flash.material.opacity = 0;
      g.line.material.opacity = 0.34;
      for (const p of g.poles) {
        p.bend = p.bendVel = p.sway = p.swayVel = 0;
        p.cooldown = 0;
        p.pivot.rotation.set(0, 0, 0);
      }
    }
    this.buildGuide(0);
  }

  pass(index, lateral) {
    const g = this.list[index];
    if (!g) return null;
    const ratio = Math.abs(lateral) / g.halfW;
    // judged against the racing line, not the middle of the gate: clipping
    // the inside pole is the fast line, so it is what gets rewarded
    const side = this.offsetFor(g.index) >= 0 ? 1 : -1;
    const ideal = -side * g.halfW * 0.62;
    const dev = Math.abs(lateral - ideal);
    let label = 'WIDE LINE';
    let tone = 'wide';
    if (dev < 0.6) {
      label = 'APEX PERFECT';
      tone = 'perfect';
    } else if (dev < 1.8) {
      label = 'CLEAN LINE';
      tone = 'clean';
    } else if (dev < 3.4) {
      label = 'TIGHT CARVE';
      tone = 'tight';
    }
    g.passed = true;
    g.accuracy = ratio;
    g.flashT = 1;
    g.line.material.opacity = 0.08;
    this.passed.push({ index, ratio, label });
    this.current = index + 1;
    if (this.current < this.list.length) this.buildGuide(this.current);
    return { label, tone, ratio, clean: dev < 1.8 };
  }

  gateAtZ(prevZ, z) {
    for (const g of this.list) {
      if (!g.passed && prevZ > g.z && z <= g.z) return g;
    }
    return null;
  }

  /**
   * A skier brushing a pole tips it over; the spring in the pole brings it
   * back with a wobble. Runs every frame during a race.
   */
  update(dt, skier = null) {
    this.time += dt;
    const tt = this.time;

    for (const g of this.list) {
      // ── pole springs ──
      for (const p of g.poles) {
        p.cooldown = Math.max(0, p.cooldown - dt);
        const k = 62;
        const c = 6.6;
        p.bendVel += (-k * p.bend - c * p.bendVel) * dt;
        p.bend = clamp(p.bend + p.bendVel * dt, -0.75, 1.0);
        p.swayVel += (-k * 0.85 * p.sway - c * 0.9 * p.swayVel) * dt;
        p.sway = clamp(p.sway + p.swayVel * dt, -0.9, 0.9);
        p.pivot.rotation.x = p.bend;
        p.pivot.rotation.z = p.sway;
      }

      if (g.flashT > 0) {
        g.flashT = Math.max(0, g.flashT - dt * 1.8);
        const kk = 1 - g.flashT;
        g.flash.scale.setScalar(0.9 + kk * 0.5);
        g.flash.material.opacity = g.flashT * 0.8;
      }
    }

    if (skier && !skier.airborne) this.checkPoleHits(skier);

    this.guideGroup.traverse((o) => {
      if (o.material && o.material.uniforms) {
        o.material.uniforms.uTime.value = tt * (o.userData.speed ?? 0.6);
      }
    });
  }

  checkPoleHits(skier) {
    const speed = Math.abs(skier.speed);
    if (speed < 4) return;
    for (const g of this.list) {
      if (Math.abs(g.z - skier.z) > 5.5) continue;
      for (const p of g.poles) {
        if (p.cooldown > 0) continue;
        p.pivot.getWorldPosition(p.world);
        const dx = skier.x - p.world.x;
        const dz = skier.z - p.world.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1.35 * 1.35) continue;
        const near = 1 - Math.sqrt(d2) / 1.35;
        const force = clamp(speed / 16, 0.35, 1.7) * (0.5 + near);
        // pole tips away from the impact and to the side the ski came from
        p.bendVel += 3.6 * force;
        p.swayVel += clamp(dx * 3.4, -2.6, 2.6) * force * 0.55;
        p.cooldown = 0.35;
        this.onHit?.(p.world.clone(), g, p, force);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.guideGroup);
    for (const grp of [this.group, this.guideGroup]) {
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
