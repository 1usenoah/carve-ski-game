import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/noise.js';
import { PISTE_HALF, START_Z } from '../scene/terrain.js';

const G = 9.81;
const MAX_EDGE = 1.12;          // ~64° of edge angle
const STEER_DAMP = 9.6;         // how fast the steering input reaches full lock
const EDGE_DAMP = 9.0;          // how fast the ski rolls onto its edge
const TUCK_DAMP = 5.0;          // body drop into the aero tuck
const _n = new THREE.Vector3();

/**
 * Carving ski physics. The edge angle builds up progressively, which makes the
 * arc feel heavy and readable rather than snappy: turn rate ∝ g·tan(edge)/v.
 */
export class SkierPhysics {
  constructor(terrain, def) {
    this.terrain = terrain;
    this.def = def;
    this.rails = (terrain.rails ?? def.rails ?? []).map((r) => {
      const dir = new THREE.Vector2(Math.sin(r.yaw), -Math.cos(r.yaw));
      return { ...r, dir, top: 0, halfLen: r.len / 2 };
    });
    this.reset();
  }

  reset(z = START_Z - 22) {
    const t = this.terrain;
    this.x = t.centerX(z);
    this.z = z;
    this.y = t.heightAt(this.x, this.z);
    this.vy = 0;
    this.speed = 0;
    this.heading = t.headingAt(z);
    this.edge = 0;
    this.steer = 0;
    this.airborne = false;
    this.airTime = 0;
    this.spin = 0;
    this.spinVel = 0;
    this.grab = 0;
    this.landImpact = 0;
    this.landedThisFrame = false;
    this.rail = null;
    this.railTime = 0;
    this.totalAir = 0;
    this.bestAir = 0;
    this.spinTotal = 0;
    this.tuck = false;
    this.tuckAmt = 0;
    this.brake = false;
    this.maxSpeed = 0;
    this.distance = 0;
    this.prevGround = this.y;
    this.surface = 'snow';
    this.shake = 0;
    this.kickerBoost = 0;
  }

  get forward() {
    return new THREE.Vector2(Math.sin(this.heading), -Math.cos(this.heading));
  }

  get hadAir() {
    return this.airborne || this.airTime > 0;
  }

  /**
   * input: { left, right, axis, tuck, brake, jump, allowJump }
   * `axis` (-1..1) is the analog steering from a touch drag; when it is
   * present it replaces the digital left/right flags.
   */
  update(dt, input) {
    const t = this.terrain;
    // safety net: never let a bad frame poison the simulation
    if (!Number.isFinite(this.x) || !Number.isFinite(this.z) || !Number.isFinite(this.heading)) {
      const z = START_Z - 22;
      this.x = t.centerX(z);
      this.z = z;
      this.y = t.heightAt(this.x, z);
      this.heading = t.headingAt(z);
      this.speed = 0;
      this.vy = 0;
      this.airborne = false;
    }
    this.landedThisFrame = false;
    const digital = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const analog = Number.isFinite(input.axis) ? clamp(input.axis, -1, 1) : null;
    const steerInput = analog !== null && Math.abs(analog) > 0.001 ? analog : digital;
    // a stick that is already displaced bites its edge sooner, a released one
    // unwinds a touch slower so the arc keeps its shape
    const releasing = Math.abs(steerInput) < Math.abs(this.steer);
    this.steer = damp(this.steer, steerInput, releasing ? STEER_DAMP * 0.62 : STEER_DAMP, dt);
    this.tuck = !!input.tuck;
    this.tuckAmt = damp(this.tuckAmt ?? 0, this.tuck ? 1 : 0, TUCK_DAMP, dt);
    this.brake = !!input.brake && !this.airborne;

    // ── edge angle builds progressively, but answers the stick at once ──
    let edgeTarget = this.steer * MAX_EDGE;
    if (this.airborne) edgeTarget *= 0.35;
    if (this.brake) edgeTarget = 0;
    this.edge = damp(this.edge, edgeTarget, this.airborne ? 3.4 : EDGE_DAMP, dt);
    if (!Number.isFinite(this.edge)) this.edge = 0;

    // ── carve: heading changes at g·tan(edge)/v ──
    let omega = (G * Math.tan(this.edge)) / Math.max(this.speed, 3.4);
    omega = clamp(omega, -1.7, 1.7);
    if (!this.airborne) {
      this.heading += omega * dt;
    } else {
      this.spinVel = damp(this.spinVel, this.steer * 5.4 + omega * 0.4, 3.5, dt);
      this.spin += this.spinVel * dt;
      this.grab = damp(this.grab, this.tuck ? 1 : 0, 6, dt);
    }

    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);

    // ── gravity down the fall line, drag, edge scrub ──
    const slope = t.slopeAlong(this.x, this.z, fx, fz);
    if (!this.airborne) {
      // in the tuck the chest is flat, the poles are under the arms and the
      // rider keeps gravity: a clear, felt acceleration bonus
      const tuckK = this.tuckAmt ?? 0;
      const grav = G * slope * (1 + 0.12 * tuckK);
      const dragK = 0.003 - 0.0008 * tuckK;
      const drag = dragK * this.speed * this.speed + 0.28 - 0.1 * tuckK + (this.brake ? 6.2 : 0);
      const scrub = Math.abs(this.edge) * this.speed * 0.021 * (1 - 0.45 * tuckK);
      const railDrag = this.rail ? 0.9 : 0;
      this.speed += (grav + 0.35 * tuckK - drag - scrub - railDrag) * dt;
      this.speed = clamp(this.speed, 0, 34);
      if (!Number.isFinite(this.speed)) this.speed = 0;
    } else {
      this.speed -= this.speed * 0.045 * dt; // a little air drag
    }

    // ── integrate position ──
    const step = this.speed * dt;
    this.x += fx * step;
    this.z += fz * step;
    this.distance += step;

    // stay inside the resort: soft walls beyond the safety net
    const cx = t.centerX(this.z);
    const limit = PISTE_HALF + 1.2;
    if (Math.abs(this.x - cx) > limit) {
      this.x = cx + Math.sign(this.x - cx) * limit;
      this.speed *= 0.99;
      this.edge *= 0.9;
    }

    // ── rails: lock on, ride, pop off the end ──
    this.updateRail(dt);

    // ── vertical: ground follow, launch, land ──
    const groundY = t.heightAt(this.x, this.z);
    if (!this.airborne && !this.rail) {
      const drop = this.y - groundY;
      if (drop > 0.55 && this.speed > 5) {
        // the ground fell away under us (kicker lip / roll-over)
        this.airborne = true;
        const riseSlope = t.slopeAlong(this.x, this.z, fx, fz);
        this.vy = clamp(-riseSlope * this.speed * 0.72, 1.2, 10.5);
        this.airTime = 0;
        this.spinVel = 0;
      } else {
        this.y = lerp(this.y, groundY, 1 - Math.exp(-26 * dt));
        this.prevGround = groundY;
      }
    } else if (this.airborne) {
      this.vy -= G * 1.06 * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      this.totalAir += dt;
      this.bestAir = Math.max(this.bestAir, this.airTime);
      if (this.y <= groundY) {
        this.land(groundY);
      }
    }

    // ── jump: park only, race runs have no jump at all ──
    if (input.jump && input.allowJump !== false && !this.airborne && !this.rail && this.speed > 2) {
      this.airborne = true;
      this.vy = 6.4 + this.speed * 0.055;
      this.airTime = 0;
      this.spinVel = this.steer * 3.2;
      this.y += 0.02;
      this.jumped = true;
    } else {
      this.jumped = false;
    }

    this.maxSpeed = Math.max(this.maxSpeed, this.speed);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    return this;
  }

  land(groundY) {
    const impact = Math.abs(this.vy);
    this.y = groundY;
    this.vy = 0;
    this.airborne = false;
    this.airTime = 0;
    this.landedThisFrame = true;
    this.landImpact = impact;
    this.shake = Math.min(1, impact / 8);
    this.speed *= clamp(1 - impact * 0.014, 0.7, 1);
    this.spinVel = 0;
    this.grab = 0;
    // clean up spin to the nearest half turn so the rider faces forward again
    this.spin = 0;
  }

  updateRail(dt) {
    const t = this.terrain;
    // find a rail we could be riding
    let on = null;
    for (const r of this.rails) {
      const rx = this.x - r.x;
      const rz = this.z - r.z;
      const along = rx * r.dir.x + rz * r.dir.y;
      const lat = Math.abs(-rx * r.dir.y + rz * r.dir.x);
      const top = t.heightAt(r.x, r.z) + r.h;
      if (Math.abs(along) < r.halfLen + 1.2 && lat < 1.5 && Math.abs(this.y - top) < 0.85) {
        on = { r, along, lat, top };
        break;
      }
    }
    if (on) {
      if (!this.rail) {
        this.rail = on.r;
        this.railTime = 0;
        this.y = on.top;
        this.vy = 0;
        this.airborne = false;
        this.speed = Math.max(this.speed, 9);
        this.edge *= 0.4;
      }
      const r = on.r;
      // stay locked on the rail line
      this.x = lerp(this.x, r.x + r.dir.x * on.along, 1 - Math.exp(-9 * dt));
      this.z = lerp(this.z, r.z + r.dir.y * on.along, 1 - Math.exp(-9 * dt));
      this.y = on.top;
      this.speed = clamp(this.speed * (1 - 0.02 * dt) + G * 0.18 * dt, 0, 30);
      this.heading = damp(this.heading, Math.atan2(r.dir.x, -r.dir.y), 8, dt);
      this.railTime += dt;
      if (Math.abs(on.along) > r.halfLen + 1.0) {
        this.rail = null;
        this.airborne = true;
        this.vy = 1.6;
        this.y += 0.05;
      }
    } else if (this.rail) {
      this.rail = null;
      this.airborne = true;
      this.vy = 1.4;
    }
  }
}
