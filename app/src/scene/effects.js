import * as THREE from 'three';
import { clamp } from '../core/noise.js';

const SPRAY_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * 200.0 / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const SPRAY_FRAG = /* glsl */ `
varying float vAlpha;
uniform vec3 uColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.08, r) * vAlpha;
  gl_FragColor = vec4(uColor, a);
}`;

class ParticlePool {
  constructor(scene, max, { size = 0.16, color = '#eaf6ff', blending = THREE.NormalBlending, gravity = 7.2 } = {}) {
    this.max = max;
    this.gravity = gravity;
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.cursor = 0;
    this.baseSize = size;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, max);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERT,
      fragmentShader: SPRAY_FRAG,
      uniforms: { uColor: { value: new THREE.Color(color).convertSRGBToLinear() } },
      transparent: true,
      depthWrite: false,
      blending,
      toneMapped: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
    this.geo = geo;
  }

  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = 0.9;
  }

  update(dt, wind = 0) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const i3 = i * 3;
      this.vel[i3 + 1] -= this.gravity * dt;
      this.vel[i3] *= 1 - 1.6 * dt;
      this.vel[i3 + 2] *= 1 - 1.6 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.pow(t, 0.7) * 0.95;
      this.size[i] = this.baseSize * (1.4 - t * 0.6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.points.material.dispose();
    this.points.parent?.remove(this.points);
  }
}

const TRAIL_VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const TRAIL_FRAG = /* glsl */ `
varying float vAlpha;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
}`;

/** Two crisp ski tracks carved into the snow behind the rider. */
class Trail {
  constructor(scene, color, maxPoints = 420) {
    this.max = maxPoints;
    this.samples = [];
    this.last = null;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(maxPoints * 2 * 3);
    this.alphas = new Float32Array(maxPoints * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    const idx = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color).convertSRGBToLinear() },
        uOpacity: { value: 0.85 },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    geo.setDrawRange(0, 0);
  }

  push(x, y, z, nx, nz, halfWidth, strength) {
    this.samples.push({ x, y, z, nx, nz, halfWidth, strength });
    if (this.samples.length > this.max) this.samples.shift();
  }

  rebuild() {
    const n = this.samples.length;
    geo_draw(this.geo, n);
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const o = i * 6;
      this.positions[o] = s.x - s.nx * s.halfWidth;
      this.positions[o + 1] = s.y;
      this.positions[o + 2] = s.z - s.nz * s.halfWidth;
      this.positions[o + 3] = s.x + s.nx * s.halfWidth;
      this.positions[o + 4] = s.y;
      this.positions[o + 5] = s.z + s.nz * s.halfWidth;
      const age = (n - i) / this.max;
      const a = clamp(1 - age * 1.1, 0, 1) * s.strength;
      this.alphas[i * 2] = a;
      this.alphas[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear() {
    this.samples.length = 0;
    this.last = null;
    this.rebuild();
  }

  dispose() {
    this.geo.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

function geo_draw(geo, n) {
  geo.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
}

export class Effects {
  constructor(scene, terrain, def) {
    this.scene = scene;
    this.terrain = terrain;
    this.def = def;
    this.spray = new ParticlePool(scene, 1100, { size: 0.1, color: '#f4fbff' });
    this.mist = new ParticlePool(scene, 200, {
      size: 0.42,
      color: '#e8f4ff',
      gravity: 0.6,
      blending: THREE.NormalBlending,
    });
    this.sparks = new ParticlePool(scene, 260, {
      size: 0.1,
      color: '#9dfff0',
      gravity: 2.0,
      blending: THREE.AdditiveBlending,
    });
    this.leftTrail = new Trail(scene, def.id === 'midnight' ? '#2f4d7d' : '#6f95bf');
    this.rightTrail = new Trail(scene, def.id === 'midnight' ? '#2f4d7d' : '#6f95bf');
    this.sprayAcc = 0;
    this.mistAcc = 0;
    this._tmp = new THREE.Vector3();
    this.lastPos = null;
  }

  /** Snow spray thrown from the tails while carving hard. */
  carve(sprayAmount, skier, rider) {
    const { edge, speed, airborne } = skier;
    if (airborne || speed < 3 || Math.abs(edge) < 0.12) return;
    const rate = Math.abs(edge) * speed * 0.55;
    this.sprayAcc += rate * 0.016 * 60;
    const dirSign = -Math.sign(edge);
    const fx = Math.sin(skier.heading);
    const fz = -Math.cos(skier.heading);
    const rx = Math.cos(skier.heading);
    const rz = Math.sin(skier.heading);
    const n = Math.min(18, Math.floor(this.sprayAcc));
    for (let i = 0; i < n; i++) {
      this.sprayAcc -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const tail = side > 0 ? rider.tailR : rider.tailL;
      const spread = Math.random();
      const vx = rx * dirSign * (1.6 + spread * 4.2) + fx * (0.6 + Math.random() * 2.2) + (Math.random() - 0.5) * 1.2;
      const vz = rz * dirSign * (1.6 + spread * 4.2) + fz * (0.6 + Math.random() * 2.2) + (Math.random() - 0.5) * 1.2;
      const vy = 0.7 + Math.random() * 2.8 + Math.abs(edge) * 1.6;
      this.spray.emit(
        tail.x + (Math.random() - 0.5) * 0.25,
        tail.y + 0.05,
        tail.z + (Math.random() - 0.5) * 0.25,
        vx, vy, vz,
        0.045 + Math.random() * 0.075,
        0.45 + Math.random() * 0.55
      );
    }
    // low, slow powder cloud when the edge bites hard
    this.mistAcc += Math.abs(edge) * speed * 0.07;
    if (this.mistAcc > 1) {
      this.mistAcc = 0;
      const tail = rider.tailR;
      this.mist.emit(
        tail.x + (Math.random() - 0.5) * 0.6,
        tail.y + 0.2,
        tail.z + (Math.random() - 0.5) * 0.6,
        rx * dirSign * 0.8 + fx * 0.5,
        0.4 + Math.random() * 0.5,
        rz * dirSign * 0.8 + fz * 0.5,
        0.35 + Math.random() * 0.45,
        0.5 + Math.random() * 0.45
      );
    }
  }

  /** Snow and a plastic crack when a gate pole is clipped. */
  poleHit(pos, force = 1) {
    const n = Math.round(10 + force * 12);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.2 + Math.random() * 2.6) * (0.6 + force * 0.4);
      this.spray.emit(
        pos.x + (Math.random() - 0.5) * 0.3,
        pos.y + 0.5 + Math.random() * 1.3,
        pos.z + (Math.random() - 0.5) * 0.3,
        Math.cos(a) * sp,
        1.4 + Math.random() * 2.6,
        Math.sin(a) * sp,
        0.05 + Math.random() * 0.09,
        0.35 + Math.random() * 0.45
      );
    }
    for (let i = 0; i < 4; i++) {
      this.mist.emit(
        pos.x + (Math.random() - 0.5) * 0.8,
        pos.y + 0.4 + Math.random() * 0.7,
        pos.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 2.4,
        0.5 + Math.random(),
        (Math.random() - 0.5) * 2.4,
        0.35 + Math.random() * 0.4,
        0.4 + Math.random() * 0.4
      );
    }
    this.sparks.points.material.uniforms.uColor.value.setRGB(1, 1, 1);
    for (let i = 0; i < 6; i++) {
      this.sparks.emit(
        pos.x, pos.y + 1.1, pos.z,
        (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3,
        0.05, 0.25
      );
    }
  }

  /** Bright sparks and a puff of snow when a gate is passed cleanly. */
  gateBurst(pos, color, count = 26) {
    const c = new THREE.Color(color);
    this.sparks.points.material.uniforms.uColor.value.copy(c).convertSRGBToLinear();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 2.4 + Math.random() * 4.2;
      this.sparks.emit(
        pos.x + Math.cos(a) * 0.4,
        pos.y + 0.25 + Math.random() * 1.4,
        pos.z + Math.sin(a) * 0.4,
        Math.cos(a) * sp,
        2.2 + Math.random() * 4.4,
        Math.sin(a) * sp,
        0.06 + Math.random() * 0.1,
        0.4 + Math.random() * 0.5
      );
    }
    for (let i = 0; i < 14; i++) {
      this.mist.emit(
        pos.x + (Math.random() - 0.5) * 2,
        pos.y + 0.3 + Math.random() * 0.8,
        pos.z + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 3,
        0.6 + Math.random() * 1.6,
        (Math.random() - 0.5) * 3,
        0.5 + Math.random() * 0.6,
        0.5 + Math.random() * 0.4
      );
    }
  }

  landing(pos, impact) {
    const n = Math.min(26, 8 + Math.floor(impact * 3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3.5;
      this.spray.emit(
        pos.x, pos.y + 0.06, pos.z,
        Math.cos(a) * sp,
        0.8 + Math.random() * 2.2,
        Math.sin(a) * sp,
        0.08 + Math.random() * 0.12,
        0.4 + Math.random() * 0.5
      );
    }
    this.mist.emit(pos.x, pos.y + 0.2, pos.z, 0, 0.5, 0, 1.6, 0.5);
  }

  /** Records the two ski tracks; call every frame with the ski contact lines. */
  trail(skier, strength = 1) {
    const heading = skier.heading;
    const nx = Math.cos(heading);
    const nz = Math.sin(heading);
    const hw = 0.045;
    const off = 0.145;
    const y = this.terrain.heightAt(skier.x, skier.z) + 0.03;
    const last = this.lastPos;
    if (!last || Math.hypot(skier.x - last.x, skier.z - last.z) > 0.55) {
      const s = clamp(strength, 0, 1);
      const px = skier.x + nx * -off;
      const pz = skier.z + nz * -off;
      this.leftTrail.push(px, y, pz, nx, nz, hw, s);
      const qx = skier.x + nx * off;
      const qz = skier.z + nz * off;
      this.rightTrail.push(qx, y, qz, nx, nz, hw, s);
      this.lastPos = { x: skier.x, z: skier.z };
      this.leftTrail.rebuild();
      this.rightTrail.rebuild();
    }
  }

  clearTrails() {
    this.leftTrail.clear();
    this.rightTrail.clear();
    this.lastPos = null;
  }

  update(dt) {
    this.spray.update(dt);
    this.mist.update(dt);
    this.sparks.update(dt);
  }

  dispose() {
    this.spray.dispose();
    this.mist.dispose();
    this.sparks.dispose();
    this.leftTrail.dispose();
    this.rightTrail.dispose();
  }
}
