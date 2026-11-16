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
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _hand = new THREE.Vector3();

function limbGeometry(radius, length, radial = 10) {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 5, radial);
  geo.translate(0, -length / 2, 0);
  return geo;
}

/** Tapered jacket: wide chest, narrow waist. */
function jacketGeometry() {
  const geo = new THREE.CapsuleGeometry(0.142, 0.32, 8, 18);
  const p = geo.attributes.position;
  const h = 0.325;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = clamp((y + h) / (2 * h), 0, 1);
    const f = 0.84 + 0.42 * smooth(t, 0.18, 0.7) - 0.3 * smooth(t, 0.88, 1);
    p.setX(i, p.getX(i) * f);
    p.setZ(i, p.getZ(i) * f * 0.72);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function smooth(x, a, b) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function skiGeometry() {
  const geo = new THREE.BoxGeometry(0.1, 0.02, 1.66, 1, 1, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z < -0.52) {
      const t = (-z - 0.52) / 0.31;
      p.setY(i, p.getY(i) + t * t * 0.19);
    } else if (z > 0.7) {
      const t = (z - 0.7) / 0.13;
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
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f6fbff';
  ctx.fillRect(0, 0, 128, 160);
  ctx.fillStyle = '#0d1a26';
  ctx.font = '900 86px "Rajdhani", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num, 64, 88);
  ctx.fillStyle = '#c8343f';
  ctx.fillRect(0, 0, 128, 14);
  ctx.fillRect(0, 146, 128, 14);
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
  g.addColorStop(0, 'rgba(10,26,46,.55)');
  g.addColorStop(0.55, 'rgba(12,30,52,.26)');
  g.addColorStop(1, 'rgba(12,30,52,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Jointed skier: helmet, goggles, jacket, gloves, poles, angulated knees,
 * boots and carving skis. The legs are solved with 2-bone IK so the boots stay
 * on the skis while the body tips into the arc.
 */
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
    const jacketMat = this.mat(s.jacket, { roughness: 0.48, metalness: 0.03 });
    const jacketDark = this.mat(s.jacketDark ?? s.pants, { roughness: 0.58 });
    const pantsMat = this.mat(s.pants, { roughness: 0.66 });
    const pantsDark = this.mat(new THREE.Color(s.pants).multiplyScalar(0.7), { roughness: 0.7 });
    const helmetMat = this.mat(s.helmet, { roughness: 0.2, metalness: 0.4 });
    const goggleMat = this.mat(s.goggles, {
      roughness: 0.08,
      metalness: 0.65,
      emissive: s.goggles,
      emissiveIntensity: 0.6,
    });
    const gloveMat = this.mat(s.glove ?? 0x121820, { roughness: 0.72 });
    const bootMat = this.mat(s.boot ?? 0x14181f, { roughness: 0.42, metalness: 0.25 });
    const skiMat = this.mat(s.ski, { roughness: 0.22, metalness: 0.35 });
    const skiAccent = this.mat(s.accent, {
      roughness: 0.3,
      emissive: s.accent,
      emissiveIntensity: 0.5,
    });
    const poleMat = this.mat(0xa8b4c0, { roughness: 0.25, metalness: 0.85 });
    const skinMat = this.mat(0xe6b28c, { roughness: 0.82 });
    const darkMat = this.mat(0x0a0d12, { roughness: 0.85 });
    this.materials = { jacketMat, jacketDark, pantsMat, helmetMat, goggleMat, skiAccent };

    // ── contact shadow blob (keeps the rider planted on the snow) ──
    if (!this.ghost) {
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 0.72),
        new THREE.MeshBasicMaterial({
          map: contactShadowTexture(),
          transparent: true,
          depthWrite: false,
          opacity: 0.75,
          toneMapped: false,
        })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0.06, 0.018, 0.02);
      shadow.renderOrder = 6;
      this.root.add(shadow);
      this.shadowBlob = shadow;
    }

    // ── skis ──
    const skiGeo = skiGeometry();
    this.skis = [];
    this.boots = [];
    for (const side of [-1, 1]) {
      const ski = new THREE.Group();
      const plate = new THREE.Mesh(skiGeo, skiMat);
      ski.add(plate);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.004, 1.22), skiAccent);
      stripe.position.set(0, 0.013, 0.06);
      ski.add(stripe);
      const binding = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.3), darkMat);
      binding.position.set(0, 0.035, 0.02);
      ski.add(binding);
      for (const edge of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.018, 1.56), poleMat);
        e.position.set(edge * 0.05, -0.004, 0);
        ski.add(e);
      }
      ski.position.set(side * 0.145, 0.012, 0);
      this.root.add(ski);
      this.skis.push(ski);

      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.175, 0.3), bootMat);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.142, 0.022, 0.05), skiAccent);
      buckle.position.set(0, 0.05, -0.08);
      boot.add(buckle);
      const buckle2 = buckle.clone();
      buckle2.position.z = 0.02;
      boot.add(buckle2);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.11, 10), bootMat);
      cuff.position.set(0, 0.115, 0.02);
      boot.add(cuff);
      boot.position.set(side * 0.145, 0.115, 0.02);
      this.root.add(boot);
      this.boots.push(boot);
    }

    // ── legs ──
    this.thighs = [];
    this.shins = [];
    this.thighGeo = limbGeometry(0.094, 0.46, 10);
    this.shinGeo = limbGeometry(0.071, 0.44, 10);
    for (let i = 0; i < 2; i++) {
      const thigh = new THREE.Mesh(this.thighGeo, pantsMat);
      const shin = new THREE.Mesh(this.shinGeo, pantsMat);
      thigh.castShadow = shin.castShadow = true;
      this.root.add(thigh, shin);
      this.thighs.push(thigh);
      this.shins.push(shin);
    }

    // ── upper body ──
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.122, 0.09, 5, 12), pantsMat);
    this.pelvis.scale.set(1.02, 1, 0.82);
    this.body.add(this.pelvis);

    this.torso = new THREE.Mesh(jacketGeometry(), jacketMat);
    this.body.add(this.torso);

    // jacket hem + zipper + chest stripe
    this.hem = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.148, 0.07, 14), jacketDark);
    this.body.add(this.hem);
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.34, 0.01), darkMat);
    this.body.add(zip);
    this.zip = zip;
    this.chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.028, 0.012), skiAccent);
    this.body.add(this.chestStripe);

    // race bib on the back (chase camera sees this)
    const bib = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.25),
      this.mat(0xffffff, { roughness: 0.7 })
    );
    if (!this.ghost) bib.material.map = numberTexture('07');
    bib.position.set(0, 0.05, 0.135);
    bib.rotation.y = Math.PI;
    this.body.add(bib);
    this.bib = bib;

    // collar + neck
    this.collar = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.126, 0.09, 12), jacketDark);
    this.body.add(this.collar);
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.09, 8), skinMat);
    this.body.add(this.neck);

    // shoulder caps
    this.shoulderPads = [];
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), jacketMat);
      pad.scale.set(1, 0.9, 0.95);
      this.body.add(pad);
      this.shoulderPads.push(pad);
    }

    // ── head ──
    this.head = new THREE.Group();
    this.body.add(this.head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.096, 16, 12), skinMat);
    face.scale.set(0.92, 1.05, 0.96);
    this.head.add(face);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.124, 20, 15, 0, Math.PI * 2, 0, Math.PI * 0.66),
      helmetMat
    );
    helmet.position.y = 0.018;
    helmet.scale.set(1, 1.05, 1.06);
    this.head.add(helmet);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.014, 6, 22), darkMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.028;
    this.head.add(rim);
    const goggleFrame = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.07, 0.055), darkMat);
    goggleFrame.position.set(0, 0.012, -0.088);
    this.head.add(goggleFrame);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.172, 0.052, 0.022), goggleMat);
    lens.position.set(0, 0.014, -0.116);
    this.head.add(lens);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.121, 0.013, 6, 20), darkMat);
    strap.rotation.x = Math.PI / 2;
    strap.position.y = 0.012;
    this.head.add(strap);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skinMat);
    chin.scale.set(1, 0.8, 0.9);
    chin.position.set(0, -0.085, -0.03);
    this.head.add(chin);

    // ── arms ──
    this.arms = [];
    this.upperGeo = limbGeometry(0.06, 0.3, 9);
    this.foreGeo = limbGeometry(0.052, 0.28, 9);
    for (const side of [-1, 1]) {
      const upper = new THREE.Mesh(this.upperGeo, jacketMat);
      const fore = new THREE.Mesh(this.foreGeo, jacketDark);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), gloveMat);
      hand.scale.set(1, 0.85, 1.2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.008, 1.16, 6), poleMat);
      pole.geometry.translate(0, -0.58, 0);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.014, 0.12, 6), darkMat);
      pole.add(grip);
      const basket = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.01, 5, 10), darkMat);
      basket.rotation.x = Math.PI / 2;
      basket.position.y = -0.98;
      pole.add(basket);
      upper.castShadow = fore.castShadow = true;
      this.body.add(upper, fore, hand, pole);
      this.arms.push({ side, upper, fore, hand, pole, upperLen: 0.3, foreLen: 0.28 });
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

  /** state: { lean: + = carve right, crouch, steer, air, grab, speed, land } */
  update(dt, state) {
    this.time += dt;
    const moving = clamp((state.speed ?? 0) / 18, 0, 1);
    this.leanSmooth = damp(this.leanSmooth, state.lean, 15, dt);
    this.crouchSmooth = damp(this.crouchSmooth, state.crouch, 9, dt);
    this.landSquash = Math.max(0, this.landSquash - dt * 3.2);
    if (state.land) this.landSquash = 1;

    const L = this.leanSmooth;                    // > 0 → leaning right
    const crouch = clamp(this.crouchSmooth, 0, 1);
    const squash = this.landSquash * 0.14;
    const air = clamp(state.air ?? 0, 0, 1);
    this.airTuck = damp(this.airTuck, air, 6, dt);

    const cosL = Math.cos(L);
    const sinL = Math.sin(L);
    // tuck: 0 = normal stance, 1 = flat-out aero crouch
    const tuck = clamp((crouch - 0.4) / 0.6, 0, 1);
    const tuckEase = tuck * tuck * (3 - 2 * tuck);
    this.tuckAmt = tuckEase;
    // ~82° of forward pitch at full tuck: chest almost level with the snow
    const pitch = 0.14 + crouch * 0.34 + tuckEase * 0.95 + this.airTuck * 0.3;
    const twist = clamp(-L * 0.3, -0.26, 0.26);

    // ── hips: angulated, only slightly displaced toward the inside ──
    const hipY = 0.98 - crouch * 0.14 - tuckEase * 0.34 - squash - this.airTuck * 0.05;
    const hipTilt = L * 0.34;
    const hips = _hips.set(
      Math.sin(hipTilt) * hipY * 0.72,
      Math.cos(hipTilt) * hipY,
      0.02 + crouch * 0.05 + tuckEase * 0.09
    );

    // ── shoulders: torso pitched forward and tipped deep into the arc ──
    const torsoLen = 0.47;
    const sy = torsoLen * Math.cos(pitch);
    const sz = -torsoLen * Math.sin(pitch);
    const shoulders = _shoulders.set(
      hips.x + sy * sinL + Math.sin(twist) * 0.015,
      hips.y + sy * cosL,
      hips.z + sz
    );

    // torso mesh spans hips → shoulders
    _dir.subVectors(shoulders, hips);
    const torsoDist = _dir.length();
    this.torso.position.copy(hips).addScaledVector(_dir, 0.5);
    this.torso.quaternion.setFromUnitVectors(UP, _dir.clone().normalize());
    this.torso.scale.set(1, torsoDist / 0.6, 1);

    this.pelvis.position.copy(hips);
    this.pelvis.position.y -= 0.03;
    this.pelvis.rotation.z = L * 0.3;

    this.hem.position.copy(hips);
    this.hem.position.y -= 0.07;
    this.hem.rotation.z = L * 0.32;

    // torso-local frame: up = _dir, back = away from the chest
    const back = _back.set(0, Math.sin(pitch), Math.cos(pitch)).normalize();
    back.applyAxisAngle(_zAxis, L);
    const chest = _chest.copy(hips).addScaledVector(_dir, torsoDist * 0.62);
    this.zip.position.copy(chest).addScaledVector(back, -0.1);
    this.zip.quaternion.setFromUnitVectors(_zAxis, _neg.copy(back).negate());
    this.chestStripe.position.copy(chest).addScaledVector(back, -0.102).addScaledVector(_dir, -0.04);
    this.chestStripe.quaternion.copy(this.zip.quaternion);
    this.bib.position.copy(hips).addScaledVector(_dir, torsoDist * 0.6).addScaledVector(back, 0.104);
    this.bib.quaternion.setFromUnitVectors(_zAxis, back);

    // ── head: positioned on the shoulders, counter-tilted slightly ──
    const headPos = _c.copy(shoulders);
    headPos.y += 0.1 - tuckEase * 0.088;
    headPos.z += -0.005 - tuckEase * 0.07;
    this.head.position.copy(headPos);
    // in the tuck the torso is nearly horizontal, so the neck lifts the face
    // back up to look down the course instead of into the snow
    this.head.rotation.set(
      pitch * 0.3 - this.airTuck * 0.1 - tuckEase * 0.74,
      -twist * 0.7 + Math.sin(this.time * 1.3) * 0.02 * moving,
      -L * 0.42
    );
    this.neck.position.copy(shoulders).addScaledVector(_dir, 0.035);
    this.neck.position.y += 0.02;
    this.collar.position.copy(shoulders);
    this.collar.rotation.z = L * 0.5;

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.shoulderPads[i].position.set(
        shoulders.x + side * 0.135 * cosL,
        shoulders.y + side * 0.135 * sinL - 0.05,
        shoulders.z + 0.005
      );
    }

    // ── legs: 2-bone IK, boots stay planted on the skis ──
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const hip = this.hipPos[i].set(
        hips.x + side * 0.1 * cosL,
        hips.y + side * 0.1 * sinL - 0.04,
        hips.z + 0.01
      );
      const ankleY = 0.17 + this.airTuck * 0.3;
      const ankleZ = 0.02 - this.airTuck * 0.14;
      const ankle = this.anklePos[i].set(side * 0.145, ankleY, ankleZ);

      const a = 0.46;
      const b = 0.44;
      _dir.subVectors(ankle, hip);
      const d = Math.max(0.0001, _dir.length());
      _dir.multiplyScalar(1 / d);
      const dC = Math.min(d, a + b - 0.004);
      const along = (a * a - b * b + dC * dC) / (2 * dC);
      const hgt = Math.sqrt(Math.max(0.0004, a * a - along * along));
      _fwd.set(0, 0, -1);
      _perp.copy(_fwd).addScaledVector(_dir, -_fwd.dot(_dir)).normalize();
      const knee = this.kneePos[i]
        .copy(hip)
        .addScaledVector(_dir, along)
        .addScaledVector(_perp, hgt);
      // knees angle toward the inside of the turn
      knee.x += Math.sign(L) * 0.03 * Math.abs(L);

      this.placeLimb(this.thighs[i], hip, knee);
      this.shins[i].position.copy(knee);
      _b.subVectors(ankle, knee).normalize();
      this.shins[i].quaternion.setFromUnitVectors(DOWN, _b);
    }

    // ── skis & boots roll onto the carving edge ──
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const ski = this.skis[i];
      const steer = state.steer ?? 0;
      ski.rotation.z = -L * 0.82;
      ski.rotation.y = -steer * 0.05 * side;
      ski.position.y = 0.012 + Math.abs(Math.sin(L)) * 0.018 + this.airTuck * 0.22;
      ski.rotation.x = -this.airTuck * 0.3;
      const boot = this.boots[i];
      boot.position.y = 0.115 + Math.abs(Math.sin(L)) * 0.01 + this.airTuck * 0.2;
      boot.rotation.z = -L * 0.7;
      boot.rotation.y = ski.rotation.y * 0.7;
      boot.position.z = 0.02 - this.airTuck * 0.1;
    }

    // ── arms & poles ──
    const grab = state.grab ?? 0;
    const reach = clamp(0.5 + crouch * 0.5 - this.airTuck * 0.15, 0, 1);
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      const side = arm.side;
      const shoulder = this.shoulderPos[i].set(
        shoulders.x + side * 0.15 * cosL,
        shoulders.y + side * 0.15 * sinL - 0.05,
        shoulders.z + 0.005
      );

      // upper arm hangs down, slightly forward, elbows soft — and in the tuck
      // the elbows pull in against the ribs, forearms level in front of the chest
      _dir.set(side * (0.3 + 0.12 * (1 - crouch)), -0.92, -0.24 - reach * 0.3).normalize();
      _dir.applyAxisAngle(_zAxis, L * 0.45);
      _t1.set(side * 0.18, -0.88, -0.16).normalize();
      _dir.lerp(_t1, tuckEase * 0.92).normalize();
      const elbow = _a.copy(shoulder).addScaledVector(_dir, arm.upperLen);
      this.placeLimb(arm.upper, shoulder, elbow);

      // forearm reaches forward for the pole plant
      _b.set(side * 0.14, -0.72, -0.62 - reach * 0.12).normalize();
      _b.applyAxisAngle(_zAxis, L * 0.4);
      _t2.set(side * 0.06, -0.2, -0.98).normalize();
      _b.lerp(_t2, tuckEase * 0.92).normalize();
      if (grab > 0.01) {
        _b.lerp(_neg.set(side * 0.5, -1.0, -0.2).normalize(), grab);
      }
      const hand = _hand.copy(elbow).addScaledVector(_b, arm.foreLen);
      arm.fore.position.copy(elbow);
      arm.fore.quaternion.setFromUnitVectors(DOWN, _b);
      arm.hand.position.copy(hand);
      arm.hand.rotation.set(_b.z * 0.7, 0, -_b.x * 0.7);

      // pole trails back under the arm; in the tuck it lies flat along the body
      arm.pole.position.copy(hand);
      _b.set(side * 0.12, 0.2 + crouch * 0.1, 1.0).normalize();
      if (tuckEase > 0.001) {
        _t2.set(side * 0.05, 0.03, 1.0).normalize();
        _b.lerp(_t2, tuckEase).normalize();
      }
      _b.applyAxisAngle(_zAxis, L * 0.35);
      arm.pole.quaternion.setFromUnitVectors(DOWN, _b);
    }

    // contact shadow leans with the rider
    if (this.shadowBlob) {
      this.shadowBlob.position.x = 0.02 + L * 0.4;
      this.shadowBlob.material.opacity = this.airTuck > 0.02 ? 0.3 : 0.75;
      this.shadowBlob.scale.setScalar(1 - this.airTuck * 0.25);
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
    this.tailL.set(-0.145, 0.03, 0.78).applyMatrix4(this.root.matrixWorld);
    this.tailR.set(0.145, 0.03, 0.78).applyMatrix4(this.root.matrixWorld);
    this.tipL.set(-0.145, 0.03, -0.8).applyMatrix4(this.root.matrixWorld);
    this.tipR.set(0.145, 0.03, -0.8).applyMatrix4(this.root.matrixWorld);
  }
}
