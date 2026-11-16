import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, fbm2, mulberry32, smoothstep } from '../core/noise.js';
import { makeBannerTexture, makeBnetTexture, makePuff } from './textures.js';
import { PISTE_HALF, START_Z, FINISH_Z } from './terrain.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────
// Distant alpine ranges: three layered silhouettes that always sit on the
// horizon around the player, tinted with atmospheric perspective.
// ─────────────────────────────────────────────────────────────
function makeRidge({
  radius, base, amp, seed, nearColor, farColor, rockColor, snowColor,
  segments = 240, snowline = 0.52, forest = true,
}) {
  const pos = [];
  const col = [];
  const idx = [];
  const nColor = new THREE.Color(nearColor);
  const fColor = new THREE.Color(farColor);
  const rColor = new THREE.Color(rockColor);
  const sColor = new THREE.Color(snowColor);
  const forestColor = new THREE.Color(rockColor).multiplyScalar(0.55);
  const ROWS = 6;
  const sunAz = Math.atan2(-0.55, -0.66);

  const heightAt = (a) => {
    const n1 = fbm2(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7 - seed, 4);
    const n2 = fbm2(Math.cos(a) * 5.3 - seed, Math.sin(a) * 5.3 + seed, 4);
    const n3 = fbm2(Math.cos(a) * 13.7 + seed * 3, Math.sin(a) * 13.7, 3);
    const spike = Math.pow(Math.abs(Math.sin(a * 7.3 + seed)), 3.2) * 0.45;
    const spike2 = Math.pow(Math.abs(Math.sin(a * 17.1 - seed * 2)), 4.0) * 0.2;
    return base + amp * (n1 * 0.4 + n2 * 0.24 + n3 * 0.1 + spike + spike2);
  };

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const h = heightAt(a);
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    // uneven snow line so the rock band is not a straight stripe
    const sl = clamp(snowline + (fbm2(a * 9.1 + seed, 3.3, 2) - 0.5) * 0.28, 0.2, 0.9);
    for (let r = 0; r < ROWS; r++) {
      const t = r / (ROWS - 1);
      const y = -420 + (h + 420) * Math.pow(t, 1.15);
      pos.push(x, y, z);
      let c;
      if (t < sl * 0.55) {
        c = rColor.clone().lerp(forestColor, forest ? 0.55 : 0.2).lerp(nColor, t);
      } else if (t < sl) {
        c = rColor.clone().lerp(nColor, 0.35 + t * 0.4);
      } else {
        const k = clamp((t - sl) / (1 - sl), 0, 1);
        c = sColor.clone().lerp(rColor, (1 - k) * 0.55).lerp(fColor, 0.12);
      }
      c.lerp(fColor, 0.12 + (radius / 4000) * 0.35);
      // sun-facing faces read brighter, shaded faces deeper
      const shade = 0.82 + 0.22 * Math.max(0, Math.cos(a - sunAz));
      c.multiplyScalar(shade);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * ROWS;
    const b = (i + 1) * ROWS;
    for (let r = 0; r < ROWS - 1; r++) {
      idx.push(a + r, a + r + 1, b + r, b + r, a + r + 1, b + r + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: true,
  });
  return new THREE.Mesh(g, m);
}

// ─────────────────────────────────────────────────────────────
// Conifer instancing
// ─────────────────────────────────────────────────────────────
function coniferGeometry(palette) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.17, 1.7, 5, 1);
  trunk.translate(0, 0.85, 0);
  colorize(trunk, new THREE.Color(palette.trunk));
  parts.push(trunk);

  const tiers = [
    { r: 1.55, h: 2.7, y: 1.5, snow: 0.55 },
    { r: 1.2, h: 2.35, y: 3.0, snow: 0.5 },
    { r: 0.85, h: 2.0, y: 4.35, snow: 0.45 },
    { r: 0.5, h: 1.5, y: 5.5, snow: 0.4 },
  ];
  const green = new THREE.Color(palette.foliage);
  const snow = new THREE.Color(palette.snow);
  for (const t of tiers) {
    const cone = new THREE.ConeGeometry(t.r, t.h, 7, 2);
    cone.translate(0, t.y + t.h * 0.5, 0);
    // vertical gradient: snow settled on the upper surfaces
    const p = cone.attributes.position;
    const colors = [];
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const local = (y - t.y) / t.h;
      const band = fbm2(p.getX(i) * 1.7, p.getZ(i) * 1.7 + y * 0.8, 2);
      const w = clamp(smoothstep(0.62, 1.0, local + band * 0.35) * (0.35 + t.snow), 0, 0.92);
      c.copy(green).lerp(snow, w);
      colors.push(c.r, c.g, c.b);
    }
    cone.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    parts.push(cone);
  }
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}

function colorize(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// ─────────────────────────────────────────────────────────────
export class World {
  constructor(scene, terrain, def) {
    this.scene = scene;
    this.terrain = terrain;
    this.def = def;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.dynamic = new THREE.Group(); // follows the player (ridges, sky)
    scene.add(this.dynamic);
    this.rand = mulberry32(def.seed * 1000 + 17);
    this.time = 0;
    this.buildLights();
    this.buildRidges();
    this.buildTrees();
    this.buildBnet();
    this.buildArches();
    this.buildRocks();
    this.buildParkFeatures();
  }

  buildLights() {
    const def = this.def;
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(def.ambient.sky),
      new THREE.Color(def.ambient.ground),
      def.ambient.intensity
    );
    this.group.add(hemi);

    const sunDir = new THREE.Vector3(...def.sky.sunDir).normalize();
    const sun = new THREE.DirectionalLight(new THREE.Color(def.sun.color), def.sun.intensity);
    sun.position.copy(sunDir).multiplyScalar(180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 480;
    const s = 55;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.045;
    this.group.add(sun);
    this.group.add(sun.target);
    this.sun = sun;
    this.sunDir = sunDir;

    // cool bounce from the snow, opposite the sun — keeps shadows readable
    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.35);
    fill.position.set(-sunDir.x * 100, 60, -sunDir.z * 100);
    this.group.add(fill);
  }

  buildRidges() {
    const def = this.def;
    const night = def.id === 'midnight';
    this.ridges = new THREE.Group();
    this.ridges.add(
      makeRidge({
        radius: 1750,
        base: 40,
        amp: 380,
        seed: 2.3,
        nearColor: night ? '#16243a' : '#4d6c8b',
        farColor: def.sky.horizon,
        rockColor: night ? '#0d1626' : '#2c4661',
        snowColor: night ? '#26374f' : '#a7c3dc',
        segments: 200,
      })
    );
    this.ridges.add(
      makeRidge({
        radius: 2700,
        base: 70,
        amp: 430,
        seed: 5.7,
        nearColor: night ? '#122036' : '#6b89a8',
        farColor: def.sky.horizon,
        rockColor: night ? '#0b1220' : '#43607c',
        snowColor: night ? '#2e415c' : '#bdd3e6',
        segments: 190,
      })
    );
    this.ridges.add(
      makeRidge({
        radius: 3800,
        base: 120,
        amp: 480,
        seed: 9.1,
        nearColor: def.sky.horizon,
        farColor: def.sky.horizon,
        rockColor: def.sky.horizon,
        snowColor: night ? '#374a68' : '#cfdfef',
        segments: 170,
      })
    );
    this.ridges.traverse((o) => {
      if (o.isMesh) {
        o.receiveShadow = false;
        o.castShadow = false;
        o.renderOrder = -50;
      }
    });
    this.dynamic.add(this.ridges);
  }

  buildTrees() {
    const def = this.def;
    const rand = this.rand;
    const geo = coniferGeometry(def.tree);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    });
    const placements = [];
    const zStart = 150;
    const zEnd = -2320;
    const lane = 8.5;
    for (let z = zStart; z > zEnd; z -= lane) {
      for (const side of [-1, 1]) {
        // a band of trees just outside the B-net, then clusters further out
        const nearBand = 2.5 + rand() * 13;
        const farBand = rand() < 0.6 ? 18 + rand() * 110 : null;
        const bands = [nearBand, farBand];
        for (const b of bands) {
          if (b == null) continue;
          if (rand() > 0.8 * def.tree.density + 0.16) continue;
          const x = this.terrain.centerX(z) + side * (PISTE_HALF + 6 + b);
          const y = this.terrain.heightAt(x, z) - 0.25;
          const scale = 0.85 + rand() * 1.15;
          placements.push({ x, y, z, scale, rot: rand() * Math.PI * 2 });
        }
      }
    }
    const inst = new THREE.InstancedMesh(geo, mat, placements.length);
    placements.forEach((p, i) => {
      _e.set(0, p.rot, 0);
      _q.setFromEuler(_e);
      _s.set(p.scale, p.scale * (0.9 + rand() * 0.3), p.scale);
      _m.compose(_v.set(p.x, p.y, p.z), _q, _s);
      inst.setMatrixAt(i, _m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.frustumCulled = true;
    this.trees = inst;
    this.group.add(inst);

    // wider hillside forest so the valley sides are never bare snow
    const hill = [];
    for (let i = 0; i < 2200; i++) {
      const z = 140 - rand() * 2300;
      const side = rand() < 0.5 ? -1 : 1;
      const off = PISTE_HALF + 20 + Math.pow(rand(), 0.7) * 380;
      const x = this.terrain.centerX(z) + side * off;
      const y = this.terrain.heightAt(x, z);
      if (y > 400) continue;
      hill.push({ x, y, z, scale: 0.7 + rand() * 1.5, rot: rand() * Math.PI * 2 });
    }
    const inst2 = new THREE.InstancedMesh(geo, mat, hill.length);
    hill.forEach((p, i) => {
      _e.set(0, p.rot, 0);
      _q.setFromEuler(_e);
      _s.set(p.scale, p.scale * (0.9 + rand() * 0.3), p.scale);
      _m.compose(_v.set(p.x, p.y - 0.2, p.z), _q, _s);
      inst2.setMatrixAt(i, _m);
    });
    inst2.instanceMatrix.needsUpdate = true;
    inst2.castShadow = false;
    inst2.receiveShadow = true;
    this.group.add(inst2);

    this.treeCount = placements.length + hill.length;
  }

  buildBnet() {
    if (!this.def.bnet) return;
    const tex = makeBnetTexture();
    tex.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0.05,
      transparent: false,
      color: 0xd8dde2,
    });
    const zStart = 40;
    const zEnd = FINISH_Z - 30;
    const step = 2.2;
    const off = PISTE_HALF + 2.0;
    for (const side of [-1, 1]) {
      const pos = [];
      const uv = [];
      const idx = [];
      let run = 0;
      let row = 0;
      for (let z = zStart; z >= zEnd; z -= step) {
        const x = this.terrain.centerX(z) + side * off;
        const y = this.terrain.heightAt(x, z);
        pos.push(x, y, z, x, y + 1.02, z);
        uv.push(run / 2.4, 0, run / 2.4, 1);
        if (row > 0) {
          const a = (row - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
        run += step;
        row++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // posts
    const postGeo = new THREE.CylinderGeometry(0.045, 0.055, 1.3, 6);
    postGeo.translate(0, 0.65, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.6, metalness: 0.4 });
    const posts = [];
    for (let z = zStart; z >= zEnd; z -= 14) {
      for (const side of [-1, 1]) {
        const x = this.terrain.centerX(z) + side * off;
        posts.push({ x, y: this.terrain.heightAt(x, z), z });
      }
    }
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    posts.forEach((p, i) => {
      _m.compose(_v.set(p.x, p.y, p.z), _q.identity(), _s.set(1, 1, 1));
      postMesh.setMatrixAt(i, _m);
    });
    postMesh.instanceMatrix.needsUpdate = true;
    this.group.add(postMesh);
  }

  buildArches() {
    this.arches = [];
    const mk = (z, title, sub, accent) => {
      const g = new THREE.Group();
      const cx = this.terrain.centerX(z);
      const y = this.terrain.heightAt(cx, z);
      const span = PISTE_HALF * 1.62;
      const legMat = new THREE.MeshStandardMaterial({
        color: 0x1b2a3a,
        roughness: 0.42,
        metalness: 0.55,
      });
      const legGeo = new THREE.BoxGeometry(1.5, 9, 1.5);
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(side * span, 4.5, 0);
        leg.castShadow = true;
        leg.receiveShadow = true;
        g.add(leg);
        const foot = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 0.5, 3.6),
          new THREE.MeshStandardMaterial({ color: 0x0f1a26, roughness: 0.7 })
        );
        foot.position.set(side * span, 0.25, 0);
        g.add(foot);
      }
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(span * 2 + 3, 1.1, 1.2),
        legMat
      );
      beam.position.y = 9.6;
      beam.castShadow = true;
      g.add(beam);

      const bannerTex = makeBannerTexture(title, sub, { accent });
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(span * 1.55, 3.0),
        new THREE.MeshStandardMaterial({
          map: bannerTex,
          roughness: 0.6,
          metalness: 0.1,
          emissive: new THREE.Color(accent),
          emissiveIntensity: 0.18,
          emissiveMap: bannerTex,
          side: THREE.DoubleSide,
        })
      );
      banner.position.set(0, 11.4, 0);
      g.add(banner);
      // hanging side flags
      const flagMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(accent),
        roughness: 0.75,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.25,
      });
      for (const side of [-1, 1]) {
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 6), flagMat);
        flag.position.set(side * (span - 2.6), 6.1, 0.2);
        g.add(flag);
      }
      g.position.set(cx, y, z);
      const heading = this.terrain.headingAt(z);
      g.rotation.y = heading;
      this.group.add(g);
      this.arches.push(g);
      return g;
    };
    mk(START_Z - 12, 'CARVE RUSH', 'START · 16 GATES', this.def.accent);
    mk(FINISH_Z, 'FINISH', 'CARVE RUSH 2.0', '#ffcf5c');
  }

  /** Rails and kicker lip markers for Park mode. */
  buildParkFeatures() {
    const def = this.def;
    const metal = new THREE.MeshStandardMaterial({ color: 0xd7e2ee, metalness: 0.92, roughness: 0.22 });
    const neon = new THREE.MeshStandardMaterial({
      color: 0x0a1a1e, emissive: new THREE.Color(def.accent ?? '#5ef0d8'), emissiveIntensity: 1.6, roughness: 0.4,
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x26313c, metalness: 0.55, roughness: 0.45 });
    for (const r of this.terrain.rails ?? def.rails ?? []) {
      const g = new THREE.Group();
      const y = this.terrain.heightAt(r.x, r.z);
      g.position.set(r.x, y + r.h, r.z);
      g.rotation.y = r.yaw;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, r.len), metal);
      beam.castShadow = true;
      g.add(beam);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, r.len - 0.3), neon);
      strip.position.y = 0.055;
      g.add(strip);
      for (const t of [-0.34, 0.34]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, r.h + 0.05, 6), postMat);
        post.position.set(0, -r.h / 2, t * r.len);
        g.add(post);
      }
      this.group.add(g);
    }
    // kicker lip markers: two small flags either side of the take-off
    const flagMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ff7a2f'), roughness: 0.7, emissive: new THREE.Color('#ff7a2f'), emissiveIntensity: 0.25, side: THREE.DoubleSide,
    });
    const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5);
    for (const k of this.terrain.kickers ?? def.kickers ?? []) {
      if (k.rail) continue;
      for (const side of [-1, 1]) {
        const x = k.x + side * (k.w * 0.92);
        const y = this.terrain.heightAt(x, k.z + 0.4);
        const pole = new THREE.Mesh(poleGeo, postMat);
        pole.position.set(x, y + 0.55, k.z + 0.4);
        this.group.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34), flagMat);
        flag.position.set(x + side * 0.25, y + 1.0, k.z + 0.4);
        flag.rotation.y = side > 0 ? -0.5 : 0.5;
        this.group.add(flag);
      }
    }
  }

  buildRocks() {
    const rand = this.rand;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x5c6673,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    });
    const n = this.def.rocks ?? 20;
    const inst = new THREE.InstancedMesh(geo, mat, n);
    let placed = 0;
    for (let i = 0; i < n * 6 && placed < n; i++) {
      const z = 100 - rand() * 2300;
      const side = rand() < 0.5 ? -1 : 1;
      const x = this.terrain.centerX(z) + side * (PISTE_HALF + 6 + rand() * 80);
      const y = this.terrain.heightAt(x, z);
      const sc = 1.2 + rand() * 4.2;
      _e.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6);
      _q.setFromEuler(_e);
      _m.compose(_v.set(x, y + sc * 0.15, z), _q, _s.set(sc, sc * 0.75, sc));
      inst.setMatrixAt(placed++, _m);
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = false;
    inst.receiveShadow = true;
    this.group.add(inst);

    // snow caps on the bigger rocks
    const capGeo = new THREE.IcosahedronGeometry(1, 0);
    const capMat = new THREE.MeshStandardMaterial({
      color: this.def.snow.color,
      roughness: 0.9,
      flatShading: true,
    });
    const caps = new THREE.InstancedMesh(capGeo, capMat, n);
    for (let i = 0; i < placed; i++) {
      inst.getMatrixAt(i, _m);
      _m.decompose(_v, _q, _s);
      _m.compose(
        _v.clone().setY(_v.y + _s.y * 0.42),
        _q,
        _s.clone().multiplyScalar(0.78).setY(_s.y * 0.42)
      );
      caps.setMatrixAt(i, _m);
    }
    caps.count = placed;
    caps.instanceMatrix.needsUpdate = true;
    this.group.add(caps);
  }

  /** Follows the player: horizon ridges and the shadow frustum. */
  update(dt, camPos, playerPos) {
    this.time += dt;
    this.ridges.position.set(camPos.x, -40, camPos.z);
    this.sun.position.copy(playerPos).addScaledVector(this.sunDir, 190);
    this.sun.target.position.copy(playerPos);
    this.sun.target.updateMatrixWorld();
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.dynamic);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}
