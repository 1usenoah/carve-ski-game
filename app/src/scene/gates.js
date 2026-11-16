import * as THREE from 'three';
import { clamp } from '../core/noise.js';
import { makeTargetZoneTexture } from './textures.js';
import { FINISH_Z } from './terrain.js';

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
uniform float uSpeed;
void main() {
  float x = vUv.x;
  float dash = fract(x * 2.2 - uTime * uSpeed);
  float a = smoothstep(0.0, 0.10, dash) * smoothstep(0.62, 0.36, dash);
  float edge = smoothstep(0.0, 0.30, vUv.y) * smoothstep(1.0, 0.70, vUv.y);
  float pulse = 0.72 + 0.28 * sin(uTime * 2.6 - x * 8.0);
  gl_FragColor = vec4(uColor * pulse, a * edge * uOpacity);
}`;

function makeRibbon(points, width, color, opacity, speed = 1.2, blending = THREE.AdditiveBlending) {
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
    // perpendicular in the ground plane
    const px = -tz;
    const pz = tx;
    if (i > 0) run += Math.hypot(p.x - prev.x, p.z - prev.z);
    pos.push(p.x - px * width * 0.5, p.y, p.z - pz * width * 0.5);
    pos.push(p.x + px * width * 0.5, p.y, p.z + pz * width * 0.5);
    uv.push(run / 8, 0, run / 8, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.ShaderMaterial({
    vertexShader: GUIDE_VERT,
    fragmentShader: GUIDE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color).convertSRGBToLinear() },
      uOpacity: { value: opacity },
      uSpeed: { value: speed },
    },
    transparent: true,
    depthWrite: false,
    blending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

/**
 * Race gates, pass zones and the glowing carving guide line that links one
 * gate to the next.
 */
export class Gates {
  constructor(scene, terrain, def, count = 16) {
    this.scene = scene;
    this.terrain = terrain;
    this.def = def;
    this.count = count;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.guideGroup = new THREE.Group();
    scene.add(this.guideGroup);
    this.time = 0;
    this.list = [];
    this.current = 0;
    this.passed = [];
    this.build();
  }

  build() {
    const t = this.terrain;
    const firstZ = -70;
    const span = firstZ - FINISH_Z;
    const n = this.count;
    const accent = new THREE.Color(this.def.gateColor);
    const alt = new THREE.Color(this.def.gateAlt ?? this.def.gateColor);
    const red = new THREE.Color('#d93a3a');
    const blue = new THREE.Color('#2b6ee0');
    const zoneTexCyan = makeTargetZoneTexture(`#${accent.getHexString()}`);
    const zoneTexPink = makeTargetZoneTexture(`#${alt.getHexString()}`);

    const poleGeo = new THREE.CylinderGeometry(0.075, 0.095, 2.3, 8);
    poleGeo.translate(0, 1.15, 0);
    const flagGeo = new THREE.PlaneGeometry(1.25, 0.72);
    const ringGeo = new THREE.TorusGeometry(0.5, 0.035, 6, 24);
    ringGeo.rotateX(Math.PI / 2);

    for (let i = 0; i < n; i++) {
      const z = firstZ - (span * i) / (n - 1);
      const cx = t.centerX(z);
      // alternating offsets create the rhythm of the course
      const offset = Math.sin(i * 1.9 + 0.6) * 6.6 + Math.sin(i * 0.7) * 2.2;
      const x = cx + offset;
      const halfW = 5.4;
      const color = i % 2 === 0 ? red : blue;
      const glowColor = i % 2 === 0 ? accent : alt;
      const gate = new THREE.Group();
      gate.position.set(x, t.heightAt(x, z), z);
      gate.rotation.y = t.headingAt(z);

      const poleMat = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.55),
        roughness: 0.35,
        metalness: 0.25,
        emissive: glowColor,
        emissiveIntensity: 0.22,
      });
      const flagMat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.1,
        side: THREE.DoubleSide,
        emissive: color,
        emissiveIntensity: 0.12,
      });
      const glowMat = new THREE.MeshStandardMaterial({
        color: 0x0a0f16,
        emissive: glowColor,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      });
      const poles = [];
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.x = side * halfW;
        pole.castShadow = true;
        pole.receiveShadow = true;
        gate.add(pole);
        poles.push(pole);

        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(side * (halfW - 0.42), 1.72, 0.06);
        flag.rotation.y = side > 0 ? -0.34 : 0.34;
        flag.rotation.z = side * 0.05;
        gate.add(flag);

        const ring = new THREE.Mesh(ringGeo, glowMat);
        ring.position.set(side * halfW, 0.06, 0);
        gate.add(ring);
      }

      // pass target zone on the snow
      const zoneW = halfW * 2 + 1.6;
      const zoneGeo = new THREE.PlaneGeometry(zoneW, 6.5, 8, 3);
      zoneGeo.rotateX(-Math.PI / 2);
      const zp = zoneGeo.attributes.position;
      for (let k = 0; k < zp.count; k++) {
        const lx = zp.getX(k);
        const lz = zp.getZ(k);
        // convert local -> world to hug the terrain
        const wx = x + Math.cos(gate.rotation.y) * lx + Math.sin(gate.rotation.y) * lz;
        const wz = z - Math.sin(gate.rotation.y) * lx + Math.cos(gate.rotation.y) * lz;
        zp.setY(k, this.terrain.heightAt(wx, wz) - gate.position.y + 0.04);
      }
      zoneGeo.computeVertexNormals();
      const zone = new THREE.Mesh(
        zoneGeo,
        new THREE.MeshBasicMaterial({
          map: i % 2 === 0 ? zoneTexCyan : zoneTexPink,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          blending: THREE.NormalBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
      );
      zone.renderOrder = 3;
      gate.add(zone);

      // flash ring, hidden until the gate is passed cleanly
      const flash = new THREE.Mesh(
        new THREE.TorusGeometry(halfW, 0.09, 6, 40),
        new THREE.MeshBasicMaterial({
          color: glowColor.clone().lerp(new THREE.Color(0xffffff), 0.4),
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
        halfW,
        y: gate.position.y,
        group: gate,
        zone,
        flash,
        flashT: 0,
        color: glowColor,
        passed: false,
        accuracy: null,
      });
    }
    this.buildGuide(0);
  }

  /** Glowing dashed line from the upcoming gate to the one after it. */
  buildGuide(fromIndex) {
    // dispose previous geometry
    this.guideGroup.children.slice().forEach((c) => {
      this.guideGroup.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    });
    const t = this.terrain;
    const a = this.list[clamp(fromIndex, 0, this.list.length - 1)];
    const b = this.list[clamp(fromIndex + 1, 0, this.list.length - 1)];
    if (!a || !b || a === b) return;

    const pts = [];
    const steps = 46;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const z = THREE.MathUtils.lerp(a.z, b.z, u);
      const cx = t.centerX(z);
      const straightX = THREE.MathUtils.lerp(a.x, b.x, u);
      // a racing line: blend the gate-to-gate chord with the fall line curve
      const x = THREE.MathUtils.lerp(straightX, cx, 0.55);
      pts.push(new THREE.Vector3(x, t.heightAt(x, z) + 0.13, z));
    }
    const glow = makeRibbon(pts, 3.8, a.color, 0.32, 0.9);
    const core = makeRibbon(pts, 0.72, a.color.clone().lerp(new THREE.Color(0x0a2b33), 0.2), 0.95, 1.6, THREE.NormalBlending);
    core.position.y += 0.004;
    this.guideGroup.add(glow, core);
    this.guide = this.guideGroup;
  }

  /** Resets progress and draws the guide from the start of the course. */
  reset() {
    this.current = 0;
    this.passed = [];
    for (const g of this.list) {
      g.passed = false;
      g.accuracy = null;
      g.flashT = 0;
      g.flash.material.opacity = 0;
      g.zone.material.opacity = 0.72;
    }
    this.buildGuide(0);
  }

  /** Call when a gate has been crossed; returns the judgment. */
  pass(index, lateral) {
    const g = this.list[index];
    if (!g) return null;
    const ratio = Math.abs(lateral) / g.halfW;
    let label = 'WIDE LINE';
    let tone = 'wide';
    if (ratio < 0.16) {
      label = 'PERFECT LINE';
      tone = 'perfect';
    } else if (ratio < 0.42) {
      label = 'CLEAN LINE';
      tone = 'clean';
    } else if (ratio < 0.72) {
      label = 'TIGHT CARVE';
      tone = 'tight';
    }
    g.passed = true;
    g.accuracy = ratio;
    g.flashT = 1;
    g.zone.material.opacity = 0.25;
    this.passed.push({ index, ratio, label });
    this.current = index + 1;
    if (this.current < this.list.length) this.buildGuide(this.current);
    return { label, tone, ratio, clean: ratio < 0.42 };
  }

  gateAtZ(prevZ, z) {
    for (const g of this.list) {
      if (!g.passed && prevZ > g.z && z <= g.z) return g;
    }
    return null;
  }

  update(dt) {
    this.time += dt;
    const tt = this.time;
    for (const g of this.list) {
      g.zone.material.opacity = 0.6 + 0.16 * Math.sin(tt * 2 + g.index);
      if (g.flashT > 0) {
        g.flashT = Math.max(0, g.flashT - dt * 1.8);
        const k = 1 - g.flashT;
        g.flash.scale.setScalar(0.9 + k * 0.5);
        g.flash.material.opacity = g.flashT * 0.85;
      }
    }
    this.guideGroup.traverse((o) => {
      if (o.material && o.material.uniforms) o.material.uniforms.uTime.value = tt;
    });
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.guideGroup);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
