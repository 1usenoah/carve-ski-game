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
    this.pos.set(skier.x - fx * 7.4, skier.y + 3.2, skier.z - fz * 7.4);
    this.look.set(skier.x + fx * 6, skier.y + 1.3, skier.z + fz * 6);
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
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * (1 - Math.exp(-7 * dt));

    const speed = skier.speed;
    const dist = 4.7 + speed * 0.04;
    const height = 2.55 + speed * 0.012;
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    _pos.set(
      skier.x - fx * dist - Math.cos(this.yaw) * skier.edge * 1.1,
      skier.y + height,
      skier.z - fz * dist + Math.sin(this.yaw) * skier.edge * 1.1
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
      const gh = this.terrain.heightAt(this.pos.x, this.pos.z) + 1.15;
      if (this.pos.y < gh) this.pos.y = gh;
    }
    _look.set(
      skier.x + fx * (6 + speed * 0.12),
      skier.y + 1.25 - speed * 0.004,
      skier.z + fz * (7.5 + speed * 0.11)
    );
    this.look.lerp(_look, 1 - Math.exp(-19 * dt));
    if (this.terrain) {
      const gh = this.terrain.heightAt(this.look.x, this.look.z) + 0.9;
      if (this.look.y < gh) this.look.y = gh;
    }

    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);

    // carve roll and speed fov
    const rollTarget = -skier.edge * 0.15;
    this.roll = damp(this.roll, rollTarget, 6, dt);
    cam.rotateZ(this.roll);
    const fovTarget = 58 + clamp(speed, 0, 40) * 0.6 + skier.edge * 2.5;
    this.fov = damp(this.fov, fovTarget, 3.2, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
