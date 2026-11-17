import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/noise.js';

const _target = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** Chase camera with speed FOV, carve roll and landing shake. */
export class ChaseCamera {
  constructor(camera, terrain = null) {
    this.camera = camera;
    this.terrain = terrain;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.roll = 0;
    this.fov = 62;
    this.menuAngle = 0.6;
    this.shake = 0;
    this.initialized = false;
  }

  snap(skier) {
    this.yaw = skier.heading;
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this.pos.set(skier.x - fx * 8.2, skier.y + 3.1, skier.z - fz * 8.2);
    this.look.set(skier.x + fx * 8, skier.y + 1.1, skier.z + fz * 8);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.initialized = true;
  }

  update(dt, skier, { menu = false } = {}) {
    const cam = this.camera;
    if (menu) {
      this.menuAngle += dt * 0.16;
      const r = 5.6;
      const a = this.menuAngle;
      _pos.set(
        skier.x + Math.sin(a) * r,
        skier.y + 1.55 + Math.sin(a * 0.7) * 0.18,
        skier.z + Math.cos(a) * r
      );
      this.pos.lerp(_pos, 1 - Math.exp(-3 * dt));
      _look.set(skier.x + Math.sin(a) * 0.2, skier.y + 1.15, skier.z - 1.2);
      this.look.lerp(_look, 1 - Math.exp(-5 * dt));
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      this.fov = damp(this.fov, 52, 4, dt);
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
      return;
    }

    // camera yaw trails the skier's heading a little for a natural swing
    let dy = skier.heading - this.yaw;
    if (!isFinite(dy)) dy = 0;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // wrap to [-π, π] without loops
    this.yaw += dy * (1 - Math.exp(-7 * dt));
    if (!isFinite(this.yaw)) this.yaw = skier.heading || 0;

    const speed = skier.speed;
    // the reference framing: a longer lens further back and higher, so the
    // chibi rider sits small in a wide field of snow with the gates ahead
    const tuck = clamp(skier.tuckAmt ?? 0, 0, 1);
    // portrait phones see a very narrow horizontal slice: open the lens and
    // calm the sideways offset so the rider stays in frame
    const narrow = clamp(1.0 / Math.max(0.4, cam.aspect), 1, 1.6);
    const portrait = narrow > 1.2;
    const side = skier.edge * 0.55 / narrow;
    const dist = (5.7 + speed * 0.055 + tuck * 0.2) * (portrait ? 0.86 : Math.min(1.12, narrow * 0.95));
    const height = (2.35 + speed * 0.012 - tuck * 0.12) * (portrait ? 0.86 : 1);
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    _pos.set(
      skier.x - fx * dist - Math.cos(this.yaw) * side,
      skier.y + height,
      skier.z - fz * dist + Math.sin(this.yaw) * side
    );

    // landing shake
    if (skier.shake > 0.001) {
      const s = skier.shake * 0.16;
      _pos.x += (Math.random() - 0.5) * s;
      _pos.y += (Math.random() - 0.5) * s * 0.8;
    }
    this.pos.lerp(_pos, 1 - Math.exp(-17 * dt));
    // never let the camera sink under the snow surface
    if (this.terrain) {
      const gh = this.terrain.heightAt(this.pos.x, this.pos.z) + 0.95;
      if (this.pos.y < gh) this.pos.y = gh;
    }
    _look.set(
      skier.x + fx * (10 + speed * 0.12) / narrow,
      skier.y + 1.0 - speed * 0.004,
      skier.z + fz * (11 + speed * 0.1) / narrow
    );
    this.look.lerp(_look, 1 - Math.exp(-19 * dt));
    if (this.terrain) {
      const gh = this.terrain.heightAt(this.look.x, this.look.z) + 0.9;
      if (this.look.y < gh) this.look.y = gh;
    }

    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);

    // carve roll and speed fov; the tuck opens the lens for real speed feel
    const rollTarget = -skier.edge * 0.045;
    this.roll = damp(this.roll, rollTarget, 6, dt);
    cam.rotateZ(this.roll);
    const fovTarget = Math.min(88, (54 + clamp(speed, 0, 34) * 0.22 + Math.abs(skier.edge) * 1.5 + tuck * 3) * Math.min(narrow, 1.22));
    this.fov = damp(this.fov, fovTarget, 3.2, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
