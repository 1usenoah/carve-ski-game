import * as THREE from 'three';
import { clamp, damp } from '../core/noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _hips = new THREE.Vector3();
const _shoulders = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _back = new THREE.Vector3();
const _neg = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _hand = new THREE.Vector3();

/* ─────────────────────────────────────────────────────────────
 * RIDER — CarveMania proportions
 *
 * The reference skier is a chibi: a big round helmet that is about a third
 * of the body height, a short round jacket, short padded legs held close
 * together and long thin skis. Measured off the reference frames (run_b /
 * run_c at 1280×720) the rider is ~1.3 m to the top of the helmet, the
 * helmet is 0.41 m across, the jacket ~0.33 m wide and the skis 1.5 m.
 * ───────────────────────────────────────────────────────────── */

const HEAD_R = 0.205;
const HIP_Y = 0.53;
const TORSO_LEN = 0.36;
const ANKLE_Y = 0.175;
const SKI_LEN = 1.52;
const SKI_OFF = 0.115;
const THIGH = 0.19;
const SHIN = 0.18;

function limbGeometry(radius, length, radial = 10) {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 5, radial);
  geo.translate(0, -length / 2, 0);
  return geo;
}

function smooth(x, a, b) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Puffy round jacket: barrel chest, tapered waist, chibi-wide. */
function jacketGeometry(r = 0.145, h = TORSO_LEN) {
  const geo = new THREE.CapsuleGeometry(r, h, 8, 20);
  const p = geo.attributes.position;
  const half = h * 0.5 + r;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = clamp((y + half) / (2 * half), 0, 1);
    const f = 0.92 + 0.2 * smooth(t, 0.18, 0.66) - 0.24 * smooth(t, 0.88, 1);
    p.setX(i, p.getX(i) * f);
    p.setZ(i, p.getZ(i) * f * 0.8);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function skiGeometry() {
  const geo = new THREE.BoxGeometry(0.1, 0.022, SKI_LEN, 1, 1, 14);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z < -0.45) {
      const t = (-z - 0.45) / 0.31;
      p.setY(i, p.getY(i) + t * t * 0.17);
      p.setX(i, p.getX(i) * (1 - t * 0.3));
    } else if (z > 0.66) {
      const t = (z - 0.66) / 0.1;
      p.setY(i, p.getY(i) + t * t * 0.05);
    }
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function numberTexture(num = '07') {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7fbff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#d6303f';
  ctx.fillRect(0, 0, 128, 18);
  ctx.fillStyle = '#0d1a26';
  ctx.font = '900 72px "Rajdhani", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num, 64, 78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(10,26,46,.5)');
  g.addColorStop(0.55, 'rgba(12,30,52,.22)');
  g.addColorStop(1, 'rgba(12,30,52,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Rider {
  constructor(skin, { ghost = false } = {}) {
    this.skin = skin;
    this.ghost = ghost;
    this.root = new THREE.Group();
    this.root.name = ghost ? 'ghost-rider' : 'rider';
    this.time = 0;
    this.landSquash = 0;
    this.airTuck = 0;
    this.leanSmooth = 0;
    this.crouchSmooth = 0;
    this.steerSmooth = 0;
    this.plantSwing = 0;
    this.plantVel = 0;
    this.build();
  }

  mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.roughness ?? 0.55,
      metalness: opts.metalness ?? 0.08,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      flatShading: !!opts.flat,
      transparent: this.ghost,
      opacity: this.ghost ? 0.3 : 1,
      depthWrite: !this.ghost,
    });
  }

  build() {
    const s = this.skin;
    const jacketMat = this.mat(s.jacket, { roughness: 0.5, metalness: 0.03 });
    const jacketDark = this.mat(s.jacketDark ?? s.jacket, { roughness: 0.58 });
    const pantsMat = this.mat(s.pants, { roughness: 0.6 });
    const pantsDark = this.mat(new THREE.Color(s.pants).multiplyScalar(0.78), { roughness: 0.66 });
    const helmetMat = this.mat(s.helmet, { roughness: 0.28, metalness: 0.22 });
    const trimMat = this.mat(s.trim ?? s.accent ?? 0xd6303f, { roughness: 0.42, metalness: 0.08 });
    const goggleMat = this.mat(s.goggles, {
      roughness: 0.08,
      metalness: 0.55,
      emissive: s.goggles,
      emissiveIntensity: 0.25,
    });
    const gloveMat = this.mat(s.glove ?? 0x141a22, { roughness: 0.72 });
    const bootMat = this.mat(s.boot ?? 0x14181f, { roughness: 0.45, metalness: 0.2 });
    const skiMat = this.mat(s.ski, { roughness: 0.24, metalness: 0.3 });
    const accentMat = this.mat(s.accent, { roughness: 0.3, emissive: s.accent, emissiveIntensity: 0.2 });
    const poleMat = this.mat(s.pole ?? 0xf2c230, { roughness: 0.3, metalness: 0.5 });
    const darkMat = this.mat(0x0b0e14, { roughness: 0.8 });
    this.materials = { jacketMat, jacketDark, pantsMat, helmetMat, goggleMat, accentMat };

    // ── contact shadow ──
    if (!this.ghost) {
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.6),
        new THREE.MeshBasicMaterial({
          map: contactShadowTexture(),
          transparent: true,
          depthWrite: false,
          opacity: 0.7,
          toneMapped: false,
        })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0.04, 0.016, 0.03);
      shadow.renderOrder = 6;
      this.root.add(shadow);
      this.shadowBlob = shadow;
    }

    // ── skis ── long, thin, dark with red flashes
    const skiGeo = skiGeometry();
    this.skis = [];
    this.boots = [];
    for (const side of [-1, 1]) {
      const ski = new THREE.Group();
      const plate = new THREE.Mesh(skiGeo, skiMat);
      ski.add(plate);
      for (const z of [0.52, -0.5]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.006, 0.26), accentMat);
        stripe.position.set(0, 0.012, z);
        ski.add(stripe);
      }
      const binding = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.042, 0.24), darkMat);
      binding.position.set(0, 0.031, 0.02);
      ski.add(binding);
      ski.position.set(side * SKI_OFF, 0.012, 0);
      this.root.add(ski);
      this.skis.push(ski);

      const boot = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.22), bootMat);
      shell.position.y = 0.062;
      boot.add(shell);
      const toe = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.07, 0.07), bootMat);
      toe.position.set(0, 0.036, -0.13);
      boot.add(toe);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.107, 0.014, 0.026), accentMat);
      buckle.position.set(0, 0.092, -0.03);
      boot.add(buckle);
      boot.position.set(side * SKI_OFF, 0.02, 0.01);
      this.root.add(boot);
      this.boots.push(boot);
    }

    // ── legs (padded red pants) ──
    this.thighs = [];
    this.shins = [];
    this.thighGeo = limbGeometry(0.076, THIGH + 0.05, 12);
    this.shinGeo = limbGeometry(0.06, SHIN + 0.05, 12);
    for (let i = 0; i < 2; i++) {
      const thigh = new THREE.Mesh(this.thighGeo, pantsMat);
      const shin = new THREE.Mesh(this.shinGeo, pantsDark);
      thigh.castShadow = shin.castShadow = true;
      this.root.add(thigh, shin);
      this.thighs.push(thigh);
      this.shins.push(shin);
    }

    // ── body: pelvis, jacket, hem, bib ──
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), pantsMat);
    this.pelvis.scale.set(1.25, 0.95, 1.02);
    this.body.add(this.pelvis);

    this.torso = new THREE.Mesh(jacketGeometry(), jacketMat);
    this.body.add(this.torso);

    this.hem = new THREE.Mesh(new THREE.CylinderGeometry(0.138, 0.148, 0.05, 16), jacketDark);
    this.body.add(this.hem);

    const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), this.mat(0xffffff, { roughness: 0.7 }));
    if (!this.ghost) bib.material.map = numberTexture('07');
    this.body.add(bib);
    this.bib = bib;

    this.collar = new THREE.Mesh(new THREE.CylinderGeometry(0.076, 0.104, 0.07, 12), jacketDark);
    this.body.add(this.collar);

    // ── head: big round yellow helmet with red bands ──
    this.head = new THREE.Group();
    this.body.add(this.head);

    const skinHead = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 14), this.mat(0xe8b494, { roughness: 0.85 }));
    skinHead.scale.set(0.95, 0.9, 0.9);
    skinHead.position.set(0, -0.085, 0.02);
    this.head.add(skinHead);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(HEAD_R, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.97),
      helmetMat
    );
    helmet.position.y = 0.008;
    helmet.scale.set(1, 1.02, 1.03);
    this.head.add(helmet);

    // red band running front → over the crown → back
    const crownBand = new THREE.Mesh(
      new THREE.TorusGeometry(HEAD_R * 0.995, 0.027, 8, 32, Math.PI),
      trimMat
    );
    crownBand.rotation.y = Math.PI / 2;
    crownBand.position.y = 0.008;
    this.head.add(crownBand);

    // red ring around the helmet just above the goggles
    const ringBand = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 0.95, 0.026, 8, 32), trimMat);
    ringBand.rotation.x = Math.PI / 2;
    ringBand.position.y = -0.036;
    this.head.add(ringBand);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 0.9, 0.018, 6, 26), darkMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.075;
    this.head.add(rim);

    // chin strap under the helmet
    const chin = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 6, 20, Math.PI), darkMat);
    chin.rotation.set(Math.PI / 2, 0, Math.PI);
    chin.position.set(0, -0.16, 0.01);
    this.head.add(chin);

    // goggles: a dark visor sector across the front only (−Z)
    const VISOR = Math.PI * 0.5;
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.203, 0.203, 0.1, 24, 1, true, Math.PI - VISOR, VISOR * 2),
      goggleMat
    );
    lens.position.set(0, -0.045, 0);
    this.head.add(lens);
    for (const dy of [0.056, -0.056]) {
      const frame = new THREE.Mesh(
        new THREE.CylinderGeometry(0.206, 0.206, 0.016, 24, 1, true, Math.PI - VISOR, VISOR * 2),
        darkMat
      );
      frame.position.set(0, -0.045 + dy, 0);
      this.head.add(frame);
    }

    // ── arms: short sleeves out to the sides, red gloves, yellow poles ──
    this.arms = [];
    this.upperGeo = limbGeometry(0.055, 0.19, 10);
    this.foreGeo = limbGeometry(0.048, 0.17, 10);
    this.shoulderPads = [];
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), jacketMat);
      this.body.add(pad);
      this.shoulderPads.push(pad);

      const upper = new THREE.Mesh(this.upperGeo, jacketMat);
      const fore = new THREE.Mesh(this.foreGeo, jacketDark);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), gloveMat);
      hand.scale.set(0.95, 0.9, 1.15);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0065, 0.92, 6), poleMat);
      pole.geometry.translate(0, -0.46, 0);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.013, 0.09, 6), darkMat);
      pole.add(grip);
      const basket = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 5, 10), darkMat);
      basket.rotation.x = Math.PI / 2;
      basket.position.y = -0.8;
      pole.add(basket);
      upper.castShadow = fore.castShadow = true;
      this.body.add(upper, fore, hand, pole);
      this.arms.push({ side, upper, fore, hand, pole, upperLen: 0.19, foreLen: 0.17 });
    }

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !this.ghost;
        o.receiveShadow = false;
      }
    });

    this.hipPos = [new THREE.Vector3(), new THREE.Vector3()];
    this.kneePos = [new THREE.Vector3(), new THREE.Vector3()];
    this.anklePos = [new THREE.Vector3(), new THREE.Vector3()];
    this.shoulderPos = [new THREE.Vector3(), new THREE.Vector3()];
  }

  place(rootPos, heading) {
    this.root.position.copy(rootPos);
    this.root.rotation.y = heading;
  }

  /** state: { lean, crouch, steer, air, grab, speed, land } */
  update(dt, state) {
    this.time += dt;
    const moving = clamp((state.speed ?? 0) / 16, 0, 1);
    this.leanSmooth = damp(this.leanSmooth, clamp(state.lean ?? 0, -1.2, 1.2), 11, dt);
    this.crouchSmooth = damp(this.crouchSmooth, clamp(state.crouch ?? 0, 0, 1), 8, dt);
    this.steerSmooth = damp(this.steerSmooth, clamp(state.steer ?? 0, -1, 1), 12, dt);
    this.landSquash = Math.max(0, this.landSquash - dt * 3.2);
    if (state.land) this.landSquash = 1;

    const L = this.leanSmooth;                    // > 0 → turning right
    const crouch = clamp(this.crouchSmooth, 0, 1);
    const squash = this.landSquash * 0.1;
    const air = clamp(state.air ?? 0, 0, 1);
    this.airTuck = damp(this.airTuck, air, 6, dt);
    this.tuckAmt = clamp((crouch - 0.45) / 0.55, 0, 1);
    const tuck = this.tuckAmt * this.tuckAmt * (3 - 2 * this.tuckAmt);

    // pole plant: the wrists drive a swing every time the edge changes
    this.plantVel += (-70 * this.plantSwing - 9 * this.plantVel) * dt;
    this.plantSwing += this.plantVel * dt;
    if (Math.abs(this.steerSmooth) > 0.55 && Math.abs(L) > 0.3) {
      this.plantVel += Math.sign(L) * 0.9 * dt * moving;
    }

    // ── hips and shoulders: angulated, weight shifted into the arc ──
    const hipY = HIP_Y - crouch * 0.07 - tuck * 0.19 - squash - this.airTuck * 0.02;
    const hips = _hips.set(L * 0.1, hipY, 0.012 + crouch * 0.025 + tuck * 0.04);

    const pitch = 0.12 + crouch * 0.24 + tuck * 0.56 + this.airTuck * 0.14;
    const torsoLen = TORSO_LEN * 0.96;
    const shoulders = _shoulders.set(
      hips.x + L * 0.095,
      hips.y + torsoLen * Math.cos(pitch),
      hips.z - torsoLen * Math.sin(pitch)
    );

    _dir.subVectors(shoulders, hips);
    const torsoDist = _dir.length();
    const torsoDir = _dir.clone().normalize();
    this.torso.position.copy(hips).addScaledVector(torsoDir, torsoDist * 0.5);
    this.torso.quaternion.setFromUnitVectors(UP, torsoDir);
    this.torso.scale.set(1, torsoDist / (TORSO_LEN + 0.29), 1);
    this.torso.rotateZ(-L * 0.22);

    this.pelvis.position.copy(hips);
    this.pelvis.position.y -= 0.015;
    this.pelvis.rotation.z = -L * 0.3;

    this.hem.position.copy(hips).addScaledVector(torsoDir, 0.07);
    this.hem.quaternion.copy(this.torso.quaternion);
    this.hem.rotateZ(-L * 0.22);

    // bib on the back, seen by the chase camera
    const back = _back.set(0, Math.sin(pitch), Math.cos(pitch)).normalize();
    back.applyAxisAngle(_zAxis, -L * 0.24);
    const chest = _chest.copy(hips).addScaledVector(torsoDir, torsoDist * 0.6);
    this.bib.position.copy(chest).addScaledVector(back, 0.156);
    this.bib.quaternion.setFromUnitVectors(_zAxis, back);

    // ── head: big helmet rides above the shoulders, counter-tilted ──
    const headPos = _c.copy(shoulders);
    headPos.y += 0.185 - tuck * 0.05;
    headPos.z += -0.01 - tuck * 0.03;
    headPos.x += L * 0.03;
    this.head.position.copy(headPos);
    this.head.rotation.set(
      0.05 + crouch * 0.1 + tuck * 0.55 - this.airTuck * 0.1 + Math.sin(this.time * 1.7) * 0.02 * moving,
      -L * 0.18 + this.steerSmooth * 0.06,
      -L * 0.26
    );
    this.collar.position.copy(shoulders).addScaledVector(torsoDir, -0.012);
    this.collar.quaternion.copy(this.torso.quaternion);

    // shoulder pads sit on the jacket
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.shoulderPads[i].position.set(
        shoulders.x + side * 0.135,
        shoulders.y - 0.03,
        shoulders.z + 0.008
      );
    }

    // ── legs: 2-bone IK, boots stay on the skis, knees angle into the arc ──
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const hip = this.hipPos[i].set(
        hips.x + side * 0.085,
        hips.y - 0.03,
        hips.z + 0.008
      );
      const ankle = this.anklePos[i].set(
        side * SKI_OFF,
        ANKLE_Y + this.airTuck * 0.14,
        0.015 - this.airTuck * 0.05
      );

      _dir.subVectors(ankle, hip);
      const d = Math.max(0.0001, _dir.length());
      _dir.multiplyScalar(1 / d);
      const dC = Math.min(d, THIGH + SHIN - 0.004);
      const along = (THIGH * THIGH - SHIN * SHIN + dC * dC) / (2 * dC);
      const hgt = Math.sqrt(Math.max(0.0004, THIGH * THIGH - along * along));
      _fwd.set(0, 0, -1);
      _perp.copy(_fwd).addScaledVector(_dir, -_fwd.dot(_dir)).normalize();
      const knee = this.kneePos[i]
        .copy(hip)
        .addScaledVector(_dir, along)
        .addScaledVector(_perp, hgt);
      // the inside knee drives across, the outside leg extends
      knee.x += side * -Math.sign(L) * 0.025 * Math.min(1, Math.abs(L));
      knee.z -= 0.01 * Math.abs(L);

      this.placeLimb(this.thighs[i], hip, knee);
      this.shins[i].position.copy(knee);
      _b.subVectors(ankle, knee).normalize();
      this.shins[i].quaternion.setFromUnitVectors(DOWN, _b);
    }

    // ── skis roll onto the edge; the outside ski leads ──
    const edgeRoll = clamp(L * 0.85 + this.steerSmooth * 0.12, -0.95, 0.95);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const ski = this.skis[i];
      const outside = Math.sign(edgeRoll) === side ? 1 : 0;
      ski.rotation.z = -edgeRoll * (0.75 + 0.25 * outside);
      ski.rotation.y = -this.steerSmooth * 0.05 * side;
      ski.rotation.x = -this.airTuck * 0.28;
      ski.position.y = 0.012 + Math.abs(Math.sin(edgeRoll)) * 0.02 + this.airTuck * 0.14;
      ski.position.z = outside ? -edgeRoll * 0.04 : 0;
      const boot = this.boots[i];
      boot.position.y = 0.02 + Math.abs(Math.sin(edgeRoll)) * 0.012 + this.airTuck * 0.12;
      boot.rotation.z = -edgeRoll * 0.8;
      boot.rotation.y = ski.rotation.y * 0.6;
      boot.rotation.x = ski.rotation.x * 0.5;
    }

    // ── arms: held out for balance, inside hand drops, outside hand lifts ──
    const grab = state.grab ?? 0;
    const spread = 0.5 + 0.14 * (1 - crouch) - tuck * 0.16;
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      const side = arm.side;
      const shoulder = this.shoulderPos[i].set(
        shoulders.x + side * 0.135,
        shoulders.y - 0.035,
        shoulders.z + 0.006
      );

      // out to the side, elbows soft, slightly forward of the chest
      const out = spread * (1 - tuck * 0.6);
      _dir.set(side * out, -0.75 - 0.1 * (1 - crouch), -0.16).normalize();
      _dir.x -= Math.sign(L) * Math.abs(L) * 0.26 * (side === Math.sign(L) ? 1 : 0.2);
      _dir.y += side * L * 0.2;
      _dir.applyAxisAngle(_zAxis, -L * 0.35);
      const elbow = _a.copy(shoulder).addScaledVector(_dir.normalize(), arm.upperLen);
      this.placeLimb(arm.upper, shoulder, elbow);

      // forearm points forward-down to the basket
      _b.set(side * (0.4 + 0.16 * (1 - crouch)), -0.55 - 0.35 * crouch, -0.35 - 0.25 * crouch).normalize();
      _b.x -= Math.sign(L) * Math.abs(L) * 0.26 * (side === Math.sign(L) ? 1 : 0.2);
      _b.y += side * L * 0.22 + this.plantSwing * 0.06;
      _b.applyAxisAngle(_zAxis, -L * 0.3);
      _b.normalize();
      // in the aero tuck both forearms pull in flat along the jacket
      _t2.set(side * 0.2, -0.1, 0.96).normalize();
      _b.lerp(_t2, tuck * 0.85).normalize();
      if (grab > 0.01) _b.lerp(_neg.set(side * 0.5, -1.0, -0.2).normalize(), grab);
      const hand = _hand.copy(elbow).addScaledVector(_b, arm.foreLen);
      arm.fore.position.copy(elbow);
      arm.fore.quaternion.setFromUnitVectors(DOWN, _b);
      arm.hand.position.copy(hand);
      arm.hand.rotation.set(_b.z * 0.6, 0, -_b.x * 0.6);

      // pole trails back and down under the hand, tip lifts in a turn
      arm.pole.position.copy(hand);
      _b.set(side * 0.22, -0.42 + Math.abs(L) * 0.18 - tuck * 0.3, 0.88).normalize();
      _b.applyAxisAngle(_zAxis, -L * 0.45);
      arm.pole.quaternion.setFromUnitVectors(DOWN, _b);
    }

    if (this.shadowBlob) {
      this.shadowBlob.position.x = 0.02 + L * 0.25;
      this.shadowBlob.material.opacity = this.airTuck > 0.02 ? 0.26 : 0.66;
      this.shadowBlob.scale.setScalar(1 - this.airTuck * 0.22);
    }

    this.updateTails();
  }

  placeLimb(mesh, from, to) {
    mesh.position.copy(from);
    _c.subVectors(to, from).normalize();
    mesh.quaternion.setFromUnitVectors(DOWN, _c);
  }

  updateTails() {
    this.root.updateMatrixWorld(true);
    if (!this.tailL) {
      this.tailL = new THREE.Vector3();
      this.tailR = new THREE.Vector3();
      this.tipL = new THREE.Vector3();
      this.tipR = new THREE.Vector3();
    }
    this.tailL.set(-SKI_OFF, 0.03, 0.72).applyMatrix4(this.root.matrixWorld);
    this.tailR.set(SKI_OFF, 0.03, 0.72).applyMatrix4(this.root.matrixWorld);
    this.tipL.set(-SKI_OFF, 0.03, -0.74).applyMatrix4(this.root.matrixWorld);
    this.tipR.set(SKI_OFF, 0.03, -0.74).applyMatrix4(this.root.matrixWorld);
  }
}
