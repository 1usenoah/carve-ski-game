import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/noise.js';
import { PISTE_HALF, START_Z } from '../scene/terrain.js';

const G = 9.81;

/* ─────────────────────────────────────────────────────────────
 * Carving model, rebuilt to the CarveMania reference numbers
 *
 * The reference does not solve a g·tan(edge)/v arc: it drives the heading
 * straight from the steering input at a *capped yaw rate* (turn-iV6w0XvTb
 * exports CARVE_G, TURN_CAP, STEER_IN/OUT, GRIP and the SG class values:
 * ceiling 22.5 m/s, carveG 1.5, turnRateCap 1.1). Because the yaw rate is
 * capped and speed-independent until high speed, a full hold turns the same
 * shape at 15 m/s and at 22 m/s — the reference's famous "it just goes round
 * the pole". Our previous arc collapsed with speed (R ∝ v²), so the 28-gate
 * course became unskiable above ~80 km/h.
 *
 *   steer   : linear rate-limited input (in 9.5/s, out 8.5/s) — press and the
 *             edge is there, release and the arc keeps its shape a beat longer
 *   omega   : steer · min(TURN_CAP, CARVE_G·lively·g / max(v,4))
 *   lively  : 1 → 1.4 as speed builds (the reference's `lively` factor)
 *   speed   : gravity along the fall line − quadratic drag − gLoad turn cost
 *   edge    : the visual roll, 0.9·gLoad/(1+0.28·gLoad²), as in the reference
 * ───────────────────────────────────────────────────────────── */
const TUNE = {
  CARVE_G: 1.95,        // yaw-rate coefficient (per g of lateral load)
  TURN_CAP: 1.55,       // rad/s hard cap — the "easy corner" guarantee
  STEER_IN: 9.5,        // 1/s, how fast a press reaches full lock
  STEER_OUT: 8.5,       // 1/s, how fast it unwinds (keeps the arc alive)
  TUCK_TURN: 0.62,      // the aero tuck turns less
  BRAKE_TURN: 1.35,     // braking pivots the ski
  CEILING: 22.5,        // m/s the course is set for (reference SG)
  TUCK_BONUS: 4.0,      // m/s extra the tuck adds
  DRAG: 0.0044,         // quadratic drag (terminal ≈ 24.5 m/s)
  DRAG_TUCK: 0.0036,
  MU_GLIDE: 0.28,       // base snow friction (m/s²)
  TURN_COST: 0.055,     // speed lost per (m/s · rad/s) of lateral load
  BRAKE_DECEL: 6.2,
  EDGE_DAMP: 4.0,       // visual roll settles in ~0.25 s
  ASSIST_MAX: 0.16,     // rad/s of automatic line help at most
};

const _n = new THREE.Vector3();

export class SkierPhysics {
  constructor(terrain, def) {
    this.terrain = terrain;
    this.def = def;
    this.rails = (terrain.rails ?? def.rails ?? []).map((r) => {
      const dir = new THREE.Vector2(Math.sin(r.yaw), -Math.cos(r.yaw));
      return { ...r, dir, top: 0, halfLen: r.len / 2 };
    });
    this.assist = null;
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
    this.gLoad = 0;
    this.assisted = false;
    this.assistLat = 0;
  }

  get forward() {
    return new THREE.Vector2(Math.sin(this.heading), -Math.cos(this.heading));
  }

  get hadAir() {
    return this.airborne || this.airTime > 0;
  }

  /**
   * input: { left, right, axis, tuck, brake, jump, allowJump }
   * `axis` (-1..1) is the analog steering from a touch drag; it replaces the
   * digital left/right flags when it is displaced.
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
    const steerTarget = analog !== null && Math.abs(analog) > 0.001 ? analog : digital;

    // ── steering: rate-limited both ways, no dead zone, no snap-back ──
    const pressing = Math.abs(steerTarget) > Math.abs(this.steer);
    const rate = (pressing ? TUNE.STEER_IN : TUNE.STEER_OUT) * dt;
    this.steer += clamp(steerTarget - this.steer, -rate, rate);
    this.tuck = !!input.tuck;
    this.tuckAmt = damp(this.tuckAmt ?? 0, this.tuck ? 1 : 0, 5.0, dt);
    this.brake = !!input.brake && !this.airborne;

    const fx = Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const v = Math.max(0, this.speed);
    const tuckK = this.tuckAmt ?? 0;

    // ── yaw rate: capped, speed-independent until the cap stops binding ──
    let omega = 0;
    if (!this.airborne) {
      const lively = clamp(Math.sqrt(v / (0.6 * TUNE.CEILING)), 1, 1.4);
      let yaw = Math.min(TUNE.TURN_CAP, (TUNE.CARVE_G * lively * G) / Math.max(v, 4));
      yaw *= 1 - (1 - TUNE.TUCK_TURN) * tuckK;
      if (this.brake) yaw *= TUNE.BRAKE_TURN;
      omega = this.steer * yaw;
      // the reference's gate assist: a line that would just miss the pole is
      // eased onto it, never more than a hand's width
      const aid = this.lineAssist(dt, fx, fz);
      omega += aid;
      this.heading += omega * dt;
    } else {
      const yaw = Math.min(TUNE.TURN_CAP, (TUNE.CARVE_G * G) / Math.max(v, 4));
      this.spinVel = damp(this.spinVel, this.steer * 4.2 + omega * 0.3, 3.5, dt);
      this.spin += this.spinVel * dt;
      this.grab = damp(this.grab, this.tuck ? 1 : 0, 6, dt);
      omega = this.spinVel * 0.25;
    }
    this.gLoad = clamp((Math.abs(omega) * v) / G, 0, 5);

    // ── speed: gravity, drag, the price of a loaded edge ──
    const slope = t.slopeAlong(this.x, this.z, Math.sin(this.heading), -Math.cos(this.heading));
    if (!this.airborne) {
      const drive = G * slope * (1 + 0.1 * tuckK) + 0.4 * tuckK;
      const dragK = TUNE.DRAG + (TUNE.DRAG_TUCK - TUNE.DRAG) * tuckK;
      const drag = dragK * v * v + TUNE.MU_GLIDE * (1 - 0.28 * tuckK) + (this.brake ? TUNE.BRAKE_DECEL : 0);
      const turnCost = TUNE.TURN_COST * v * Math.abs(omega);
      const railDrag = this.rail ? 0.9 : 0;
      this.speed += (drive - drag - turnCost - railDrag) * dt;
      this.speed = clamp(this.speed, 0, 32);
      if (!Number.isFinite(this.speed)) this.speed = 0;
    } else {
      this.speed -= this.speed * 0.03 * dt;
    }

    // ── edge: what the body and the skis roll to (reference skate curve) ──
    const gL = this.gLoad;
    const roll = 0.9 * (gL / (1 + 0.28 * gL * gL));
    const edgeTarget = this.airborne ? this.edge * 0.6 : Math.sign(this.steer) * Math.min(0.95, roll);
    this.edge = damp(this.edge, edgeTarget, TUNE.EDGE_DAMP, dt);
    if (!Number.isFinite(this.edge)) this.edge = 0;

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
      this.steer *= 0.9;
    }

    // ── rails: lock on, ride, pop off the end ──
    this.updateRail(dt);

    // ── vertical: ground follow, launch, land ──
    const groundY = t.heightAt(this.x, this.z);
    if (!this.airborne && !this.rail) {
      const drop = this.y - groundY;
      if (drop > 0.55 && this.speed > 5) {
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
      if (this.y <= groundY) this.land(groundY);
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

  /**
   * The reference's gentle line help: predicts where the skier would cross the
   * next gate's plane and, inside a narrow window, nudges the yaw so a turn
   * that would just graze the pole still clears it. Costs nothing, feels like
   * the ski simply found the line.
   */
  lineAssist(dt, fx, fz) {
    const a = this.assist;
    this.assisted = false;
    this.assistLat = 0;
    if (!a || this.brake || Math.abs(this.steer) < 0.22 || this.speed < 5) return 0;
    const toPlane = (a.tx - this.x) * a.d.x + (a.tz - this.z) * a.d.z;
    if (toPlane < 2 || toPlane > 22) return 0;
    const along = fx * a.d.x + fz * a.d.z;
    if (along < 0.35) return 0;
    const time = toPlane / Math.max(3, this.speed * along);
    const px = this.x + fx * this.speed * time;
    const pz = this.z + fz * this.speed * time;
    const pred = (px - a.tx) * a.u.x + (pz - a.tz) * a.u.z;
    const want = pred < 0.55 ? 0.55 : a.width - 0.45;
    const err = want - pred;
    if (Math.abs(err) < 0.04 || Math.abs(err) > 2.2) return 0;
    const rate = clamp((err / Math.max(0.25, time)) * 0.35 / Math.max(6, this.speed), -TUNE.ASSIST_MAX, TUNE.ASSIST_MAX);
    if (!Number.isFinite(rate)) return 0;
    this.assisted = Math.abs(rate) > 0.005;
    this.assistLat = err;
    return rate;
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
    this.speed *= clamp(1 - impact * 0.012, 0.74, 1);
    this.spinVel = 0;
    this.grab = 0;
    this.spin = 0;
  }

  updateRail(dt) {
    const t = this.terrain;
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
        this.steer *= 0.4;
      }
      const r = on.r;
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
