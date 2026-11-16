import * as THREE from 'three';
import { clamp, fbm2, smoothstep } from '../core/noise.js';
import { makeCorduroyNormal, makeSnowAlbedo, makeSnowRoughness } from './textures.js';

export const SLOPE = 0.3;            // ≈ 16.7° fall line
export const PISTE_HALF = 22;        // groomed piste half-width in metres
export const START_Z = 34;
export const FINISH_Z = -1100;

/**
 * The alpine course. The analytic height function is the single source of
 * truth for both the rendered mesh and the ski physics, so what you see is
 * exactly what you carve on.
 */
export class Terrain {
  constructor(def) {
    this.def = def;
    this.seed = def.seed ?? 3.7;
    // park features are authored as offsets from the course centre line
    this.kickers = (def.kickers ?? []).map((k) => ({ ...k, x: this.centerX(k.z) + (k.xOff ?? 0) }));
    this.rails = (def.rails ?? []).map((r) => ({ ...r, x: this.centerX(r.z) + (r.xOff ?? 0) }));
    this.pisteHalf = PISTE_HALF;
    this._n = new THREE.Vector3();
  }

  /** Lateral meander of the course centre line. */
  centerX(z) {
    return (
      27 * Math.sin(z * 0.0024) +
      9.5 * Math.sin(z * 0.0069 + 1.4) +
      3.4 * Math.sin(z * 0.0171 + 0.6)
    );
  }

  /** d(centerX)/dz — used for the course heading. */
  centerDX(z) {
    return (
      27 * 0.0024 * Math.cos(z * 0.0024) +
      9.5 * 0.0069 * Math.cos(z * 0.0069 + 1.4) +
      3.4 * 0.0171 * Math.cos(z * 0.0171 + 0.6)
    );
  }

  /** Heading (radians, 0 = straight down the fall line / -Z) of the course. */
  headingAt(z) {
    return Math.atan(-this.centerDX(z));
  }

  kickerHeight(x, z) {
    let h = 0;
    for (const k of this.kickers) {
      if (k.rail) continue;
      // dz < 0 on the approach (rider comes from +Z), 0 at the lip
      const dz = k.z - z;
      if (dz > 2 || dz < -k.len) continue;
      const lat = Math.abs(x - k.x);
      if (lat > k.w) continue;
      if (dz > 0) continue;            // past the lip the ground falls away
      const t = clamp(1 + dz / k.len, 0, 1);
      const lateral = 1 - smoothstep(k.w * 0.6, k.w, lat);
      h = Math.max(h, k.h * Math.pow(t, 1.55) * lateral);
    }
    return h;
  }

  /** Terrain height at a world position. */
  heightAt(x, z) {
    const cx = this.centerX(z);
    const d = x - cx;
    const ad = Math.abs(d);
    const base = z * SLOPE;
    const groom = 0.4 * Math.sin(z * 0.052) + 0.24 * Math.cos(x * 0.075 + z * 0.02) + 0.16 * Math.sin(z * 0.21 + x * 0.06) + 0.09 * Math.sin(z * 0.62);
    let y = base + groom * 0.55;

    if (ad > PISTE_HALF) {
      const t = ad - PISTE_HALF;
      const bank = Math.min(0.0095 * t * t, 12);
      const hills =
        (fbm2((x + this.seed * 11) * 0.0105, (z - this.seed * 7) * 0.0105, 4) - 0.5) *
          26 * smoothstep(0, 55, t) +
        (fbm2(x * 0.058, z * 0.058, 3) - 0.5) * 2.4 * smoothstep(0, 16, t);
      y += bank + hills;
    }

    y += this.kickerHeight(x, z);
    return y;
  }

  /** Surface normal via central differences. */
  normalAt(x, z, target = new THREE.Vector3()) {
    const e = 0.9;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    target.set(hL - hR, 2 * e, hD - hU).normalize();
    return target;
  }

  /** Gravity component along a horizontal direction (positive = downhill). */
  slopeAlong(x, z, fx, fz) {
    const e = 2.2;
    const hF = this.heightAt(x + fx * e, z + fz * e);
    const hB = this.heightAt(x - fx * e, z - fz * e);
    return (hB - hF) / (2 * e);
  }

  /** Renders the snowfield mesh with groomed texture and blue shadow tones. */
  build() {
    const group = new THREE.Group();
    group.name = 'terrain';

    const xMin = -520, xMax = 520, zMax = 160, zMin = -2380;
    const nx = 208, nz = 420;
    const geo = new THREE.BufferGeometry();
    const w = nx + 1;
    const heights = new Float32Array(w * (nz + 1));
    const verts = new Float32Array(w * (nz + 1) * 3);
    const uvs = new Float32Array(w * (nz + 1) * 2);
    const colors = new Float32Array(w * (nz + 1) * 3);
    const idx = [];
    const shadow = new THREE.Color(this.def.snow.shadow ?? 0xa9c7e4);
    const lit = new THREE.Color(this.def.snow.color ?? 0xf6fbff);
    const stepX = (xMax - xMin) / nx;
    const stepZ = (zMin - zMax) / nz;

    let p = 0, q = 0, cI = 0;
    for (let j = 0; j <= nz; j++) {
      const z = zMax + stepZ * j;
      for (let i = 0; i <= nx; i++) {
        const x = xMin + stepX * i;
        const y = this.heightAt(x, z);
        heights[j * w + i] = y;
        verts[p++] = x;
        verts[p++] = y;
        verts[p++] = z;
        uvs[q++] = x / 6.5;
        uvs[q++] = z / 6.5;
      }
    }

    const H = (i, j) => heights[clamp(j, 0, nz) * w + clamp(i, 0, nx)];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const y = heights[j * w + i];
        const x = xMin + stepX * i;
        const z = zMax + stepZ * j;
        // Concavity of the groomed surface → bluish shade in hollows,
        // brighter wind-packed crests.
        const c = (H(i - 1, j) + H(i + 1, j) + H(i, j - 1) + H(i, j + 1) - 4 * y) /
          (stepX * stepZ);
        const blue = clamp(c * 26, 0, 1) * 0.55 + fbm2(x * 0.015, z * 0.015, 3) * 0.09;
        const grain = fbm2(x * 0.05, z * 0.05, 3) * 0.09 - 0.045;
        const col = lit.clone().lerp(shadow, blue);
        col.offsetHSL(0, 0, grain);
        colors[cI++] = col.r;
        colors[cI++] = col.g;
        colors[cI++] = col.b;
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * w + i;
        const b = a + 1;
        const c = a + w;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const albedo = makeSnowAlbedo(512);
    albedo.repeat.set(6.5 / 24, 6.5 / 24);
    const normalMap = makeCorduroyNormal(256, 26);
    const roughMap = makeSnowRoughness(256);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: albedo,
      normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: roughMap,
      roughness: 0.7,
      metalness: 0.0,
      envMapIntensity: 0.9,
      dithering: true,
    });
    if (this.def.snow.emissive) {
      mat.emissive = new THREE.Color(this.def.snow.emissive);
      mat.emissiveIntensity = this.def.snow.emissiveIntensity ?? 0.12;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'snowfield';
    group.add(mesh);

    this.mesh = mesh;
    this.group = group;
    return group;
  }
}
