import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { clamp, damp } from './core/noise.js';
import { Terrain, START_Z, FINISH_Z } from './scene/terrain.js';
import { MAPS, mapById, PARK_FEATURES_BY_MAP } from './scene/maps.js';
import { World } from './scene/world.js';
import { Sky, makeEnvironment } from './scene/sky.js';
import { Gates } from './scene/gates.js';
import { Effects } from './scene/effects.js';
import { Rider } from './scene/rider.js';
import { ChaseCamera } from './scene/camera.js';
import { SkierPhysics } from './physics/skier.js';
import { AudioEngine } from './audio/audio.js';
import { StoreService, skinById } from './services/store.js';
import { LeaderboardService } from './services/leaderboard.js';
import { HUD } from './ui/hud.js';
import { ShopUI } from './ui/shop.js';
import { TouchControls } from './ui/touch.js';

// ─────────────────────────────────────────────────────────────
// Renderer / scene
// ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 7000);
camera.position.set(0, 6, 14);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.42,
  0.55,
  1.05
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// light colour grade: gentle contrast, saturation lift and a soft vignette
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.06 },
    uSat: { value: 1.12 },
    uVignette: { value: 0.26 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast; uniform float uSat; uniform float uVignette;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = (c - 0.5) * uContrast + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      float d = length(vUv - 0.5) * 1.38;
      c *= 1.0 - uVignette * smoothstep(0.35, 1.0, d);
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);
if (renderer.capabilities.isWebGL2) {
  composer.renderTarget1.samples = 4;
  composer.renderTarget2.samples = 4;
}

const store = new StoreService();
const leaderboard = new LeaderboardService();
const hud = new HUD();
const audio = new AudioEngine();
const input = { left: false, right: false, axis: null, tuck: false, brake: false, jump: false, allowJump: true };
const touch = new TouchControls(input);
const chase = new ChaseCamera(camera);

const BUILD = 'v2.2.0';

// FIS giant-slalom set: 28 gates over the 1 km piste, turning poles 16–22 m
// apart across the fall line, 34–41 m between gates.
const GATE_COUNT = 28;

// Medal times the course setter aimed at.
const TARGETS = { gold: 66, silver: 74, bronze: 84 };
const S = {
  state: 'loading',           // loading | menu | countdown | running | paused | result
  runMode: 'race',
  time: 0,
  penalty: 0,
  cdT: 0,
  cdLast: 99,
  prevZ: START_Z,
  prevX: 0,
  clean: 0,
  missed: 0,
  gateIndex: 0,
  frozen: false,
  quality: 'high',
  bestAtStart: null,
  ghostSamples: null,
  ghostRec: [],
  ghostAcc: 0,
  park: { air: 0, bestAir: 0, rail: 0, spin: 0, tricks: 0, score: 0 },
  lastStateTime: 0,
};
const ctx = {
  def: null,
  terrain: null,
  world: null,
  gates: null,
  effects: null,
  sky: null,
  rider: null,
  ghost: null,
  physics: null,
  env: null,
  group: new THREE.Group(),
};
scene.add(ctx.group);

const raf = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const envCache = new Map();

// ─────────────────────────────────────────────────────────────
// World assembly
// ─────────────────────────────────────────────────────────────
function effectiveDef(mapId, mode) {
  const base = mapById(mapId);
  const park = PARK_FEATURES_BY_MAP[mapId];
  if (mode === 'park' && park) {
    return { ...base, kickers: park.kickers, rails: park.rails, bnet: false };
  }
  return base;
}

function disposeWorld() {
  if (ctx.gates) { ctx.gates.dispose(); ctx.gates = null; }
  if (ctx.effects) { ctx.effects.dispose(); ctx.effects = null; }
  if (ctx.world) { ctx.world.dispose(); ctx.world = null; }
  if (ctx.terrain) {
    ctx.terrain.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    scene.remove(ctx.terrain.group);
    ctx.terrain = null;
  }
  if (ctx.sky) { ctx.sky.dispose(); scene.remove(ctx.sky.group); ctx.sky = null; }
  if (ctx.rider) { scene.remove(ctx.rider.root); ctx.rider = null; }
  if (ctx.ghost) { scene.remove(ctx.ghost.root); ctx.ghost = null; }
  ctx.env = null;
  if (ctx.physics) ctx.physics = null;
}

async function buildWorld(mapId, mode, { silent = false } = {}) {
  disposeWorld();
  const def = effectiveDef(mapId, mode);
  ctx.def = def;

  if (!silent) hud.setLoading(0.18, 'CARVING THE PISTE…');
  await raf();
  const terrain = new Terrain(def);
  ctx.terrain = terrain;
  scene.add(terrain.build());

  if (!silent) hud.setLoading(0.5, 'PLANTING THE LARCH FOREST…');
  await raf();
  ctx.world = new World(scene, terrain, def);

  if (!silent) hud.setLoading(0.72, 'SETTING THE GATES…');
  await raf();
  ctx.effects = new Effects(scene, terrain, def);

  scene.fog = new THREE.FogExp2(new THREE.Color(def.fog.color), def.fog.density);
  if (!envCache.has(def.id)) envCache.set(def.id, makeEnvironment(renderer, def));
  scene.environment = envCache.get(def.id);
  scene.environmentIntensity = 0.45;
  ctx.env = scene.environment;
  ctx.sky = new Sky(def);
  scene.add(ctx.sky.group);

  if (mode === 'race') {
    ctx.gates = new Gates(scene, terrain, def, GATE_COUNT, {
      onHit: (pos, gate, pole, force) => {
        ctx.effects?.poleHit(pos, force);
        audio.gateHit(force);
      },
    });
  }

  ctx.physics = new SkierPhysics(terrain, def);
  chase.terrain = terrain;
  ctx.builtMode = mode;
  ctx.builtMap = mapId;
  ctx.rider = new Rider(store.skin);
  scene.add(ctx.rider.root);

  if (!silent) hud.setLoading(0.92, 'WAXING THE SKIS…');
  await raf();

  placeMenu();
  S.state = 'menu';
  hud.setLoading(1, 'READY');
  updateTitleInfo();
}

function updateTitleInfo() {
  const def = ctx.def;
  hud.setTitleInfo({
    best: leaderboard.getBest(def.id, 'race'),
    mapName: def.name,
    skinName: store.skin.name,
    mode: S.runMode.toUpperCase(),
  });
}

function placeMenu() {
  const p = ctx.physics;
  p.reset();
  if (ctx.gates) ctx.gates.reset();
  ctx.rider.root.visible = true;
  ctx.rider.place(new THREE.Vector3(p.x, p.y, p.z), p.heading);
  ctx.rider.update(0.016, { lean: 0, crouch: 0.22, steer: 0, air: 0, speed: 0, grab: 0 });
  chase.snap(p);
  chase.menuAngle = 0.42;
  if (ctx.ghost) ctx.ghost.root.visible = false;
  if (ctx.effects) ctx.effects.clearTrails();
}

// ─────────────────────────────────────────────────────────────
// Run flow
// ─────────────────────────────────────────────────────────────
async function startRun(mode = S.runMode) {
  audio.init();
  if (ctx.builtMode !== mode || ctx.builtMap !== store.state.map) {
    hud.showTitle(false);
    hud.setLoading(0.2, mode === 'park' ? 'BUILDING THE PARK…' : 'BUILDING THE COURSE…');
    hud.showLoader?.();
    await buildWorld(store.state.map, mode, { silent: true });
    hud.hideLoader();
    S.runMode = mode;
    S.state = 'menu';
  }
  S.runMode = mode;
  input.allowJump = mode === 'park';
  input.jump = false;
  input.axis = null;
  S.time = 0;
  S.penalty = 0;
  S.clean = 0;
  S.missed = 0;
  S.gateIndex = 0;
  S.cdT = 3.0;
  S.cdLast = 99;
  S.prevZ = START_Z;
  S.prevX = ctx.physics.x;
  S.bestAtStart = leaderboard.getBest(ctx.def.id, 'race');
  S.ghostRec = [];
  S.ghostAcc = 0;
  S.park = { air: 0, bestAir: 0, rail: 0, spin: 0, tricks: 0, score: 0 };

  const p = ctx.physics;
  p.reset();
  if (ctx.gates) ctx.gates.reset();
  ctx.effects.clearTrails();
  ctx.rider.place(new THREE.Vector3(p.x, p.y, p.z), p.heading);
  chase.snap(p);

  // ghost replay
  if (ctx.ghost) {
    scene.remove(ctx.ghost.root);
    ctx.ghost = null;
  }
  const ghostSamples = mode === 'race' ? leaderboard.getGhost(ctx.def.id, 'race') : null;
  S.ghostSamples = ghostSamples;
  if (ghostSamples && ghostSamples.length > 1) {
    ctx.ghost = new Rider(skinById(store.state.skin), { ghost: true });
    ctx.ghost.root.visible = true;
    scene.add(ctx.ghost.root);
    S.ghostIdx = 0;
  }

  hud.showTitle(false);
  hud.showResult(false);
  hud.showShop(false);
  hud.showHUD(true);
  hud.setRunInfo(mode, mode === 'race' ? ctx.def.name : `${ctx.def.name} · PARK`);
  hud.setCourseTargets({
    gold: TARGETS.gold,
    silver: TARGETS.silver,
    bronze: TARGETS.bronze,
    best: leaderboard.getBest(ctx.def.id, 'race'),
  });
  hud.setTime(0);
  hud.setSpeed(0);
  hud.setAirtime(0);
  hud.setProgress(0);
  hud.setGate(0, mode === 'race' ? GATE_COUNT : 0);
  hud.showGateCounter(mode === 'race');
  if (touch.isTouch || window.innerWidth < 820) hud.showTouch(true);
  S.state = 'countdown';
  hud.countdown('3');
  audio.countdown(3);
}

function finishRun() {
  S.state = 'result';
  const time = S.time + S.penalty;
  const mode = S.runMode;
  const def = ctx.def;
  if (mode === 'race') {
    const prevBest = leaderboard.getBest(def.id, 'race');
    const res = leaderboard.submit(def.id, mode, time, { clean: S.clean, missed: S.missed });
    if (res.isBest || !leaderboard.getGhost(def.id, mode)) {
      leaderboard.saveGhost(def.id, mode, S.ghostRec);
    }
    const best = res.best;
    let medal = '🏔️';
    let title = 'FINISHED';
    if (time <= TARGETS.gold) { medal = '🥇'; title = 'GOLD MEDAL'; }
    else if (time <= TARGETS.silver) { medal = '🥈'; title = 'SILVER MEDAL'; }
    else if (time <= TARGETS.bronze) { medal = '🥉'; title = 'BRONZE MEDAL'; }
    else if (time <= TARGETS.bronze + 14) { medal = '🎖️'; title = 'FINISHER'; }
    hud.showResultData({
      medal,
      title,
      mode: `${mode.toUpperCase()} · ${def.name}`,
      time,
      best,
      diff: prevBest == null ? null : time - prevBest,
      clean: S.clean,
      total: GATE_COUNT - S.missed,
      topSpeed: ctx.physics.maxSpeed * 3.6,
    });
    audio.finish();
    updateTitleInfo();
  } else {
    const score = Math.round(S.park.bestAir * 220 + S.park.spin * 1.6 + S.park.rail * 180 + S.park.tricks * 40);
    leaderboard.submit(def.id, 'park', -score, { score });
    hud.showResultData({
      medal: '🎿',
      title: 'PARK SESSION',
      mode: `PARK · ${def.name}`,
      time: S.time,
      best: null,
      diff: null,
      cleanLabel: 'TRICKS',
      clean: S.park.tricks,
      total: null,
      topSpeed: ctx.physics.maxSpeed * 3.6,
      extra: `AIR ${S.park.bestAir.toFixed(1)}s · SPIN ${Math.round(S.park.spin)}° · RAIL ${S.park.rail.toFixed(1)}s`,
    });
    audio.finish();
  }
  hud.showHUD(false);
  hud.showTouch(false);
  hud.setTuck(0, 0);
  S.state = 'result';
}

function toMenu() {
  S.state = 'menu';
  placeMenu();
  hud.showResult(false);
  hud.showHUD(false);
  hud.showTouch(false);
  hud.setTuck(0, 0);
  hud.showTitle(true);
  updateTitleInfo();
}

function pauseRun(force) {
  if (S.state === 'running' || S.state === 'countdown') {
    S.state = 'paused';
    hud.showPause(true);
  } else if (S.state === 'paused' && force === false) {
    S.state = 'running';
    hud.showPause(false);
  }
}

function resumeRun() {
  if (S.state !== 'paused') return;
  S.state = 'running';
  hud.showPause(false);
  hud.showShop(false);
  last = performance.now();
}

// ─────────────────────────────────────────────────────────────
// Simulation
// ─────────────────────────────────────────────────────────────
const tmpV = new THREE.Vector3();

function tick(dt) {
  const t = ctx.terrain;
  if (!t) return;
  // the world can be mid-rebuild (mode / map switch): hold the frame, the
  // render loop keeps running while the new piste is assembled
  if (!ctx.physics || !ctx.rider) return;
  ctx.sky?.update(camera, dt);

  if (S.state === 'menu' || S.state === 'result') {
    if (ctx.rider) {
      ctx.rider.place(new THREE.Vector3(ctx.physics.x, ctx.physics.y, ctx.physics.z), ctx.physics.heading);
      ctx.rider.update(dt, { lean: 0, crouch: 0.24, steer: 0, air: 0, speed: 0.4, grab: 0 });
    }
    if (ctx.effects) ctx.effects.update(dt);
    chase.update(dt, ctx.physics, { menu: true });
    ctx.world?.update(dt, camera.position, ctx.physics);
    if (ctx.gates) ctx.gates.update(dt);
    return;
  }

  if (S.state === 'paused') {
    ctx.world?.update(0, camera.position, ctx.physics);
    return;
  }

  if (S.state === 'countdown') {
    S.cdT -= dt;
    const n = Math.ceil(S.cdT);
    if (n !== S.cdLast && n >= 1 && n <= 3) {
      S.cdLast = n;
      hud.countdown(String(n));
      audio.countdown(n);
    }
    if (S.cdT <= 0) {
      S.state = 'running';
      hud.countdown('GO');
      audio.countdown(0);
      ctx.physics.speed = 5.2;
    }
    if (ctx.gates) ctx.gates.update(dt);
    ctx.effects?.update(dt);
    chase.update(dt, ctx.physics);
    ctx.world.update(dt, camera.position, ctx.physics);
    return;
  }

  if (S.state !== 'running') return;

  const p = ctx.physics;
  S.time += dt;
  const prevZ = S.prevZ;
  const prevX = S.prevX;
  if (S.autopilot) autopilotInput(p);
  p.update(dt, input);
  S.prevZ = p.z;
  S.prevX = p.x;

  // ── gates ──
  // A gate is passed when the skier crosses the gate line between the
  // turning pole (inside, the one they brush) and the outside pole.
  if (ctx.gates) {
    const res = ctx.gates.judgeStep(prevX, prevZ, p.x, p.z);
    if (res) {
      const g = res.gate;
      S.gateIndex = ctx.gates.current;
      if (res.missed) {
        S.missed += 1;
        S.penalty += 2;
        hud.judge({ label: 'MISSED GATE', tone: 'wide', sub: `${res.reason} · +2.00s` });
        audio.tone(220, 0.3, 'sawtooth', 0.1);
      } else {
        if (res.clean) S.clean += 1;
        hud.judge({
          label: res.label,
          tone: res.tone,
          sub: `${res.s.toFixed(2)} m off the turning pole`,
        });
        audio.gate(res.tone === 'perfect');
        ctx.effects.gateBurst(tmpV.set(g.tx, g.y + 0.4, g.tz), g.color, res.clean ? 30 : 16);
        if (res.clean) p.speed += 0.4;
      }
      hud.setGate(S.gateIndex, GATE_COUNT);
    }
  }
  hud.setProgress((START_Z - p.z) / (START_Z - FINISH_Z));

  // ── rider pose ──
  const airT = p.airborne ? 1 : 0;
  const crouch = p.tuck ? 1 : p.brake ? 0.45 : 0.28 + clamp(Math.abs(p.edge) * 0.25, 0, 0.25);
  ctx.rider.place(new THREE.Vector3(p.x, p.y, p.z), p.heading + p.spin);
  ctx.rider.update(dt, {
    lean: p.edge,
    crouch,
    steer: p.steer,
    air: airT,
    grab: p.grab,
    speed: p.speed,
    land: p.landedThisFrame,
  });

  // ── snow spray & tracks ──
  if (!p.airborne && !p.rail) {
    ctx.effects.carve(Math.abs(p.edge) * p.speed, p, ctx.rider);
    ctx.effects.trail(p, clamp(0.35 + Math.abs(p.edge) * 0.85, 0, 1));
  }
  if (p.landedThisFrame) {
    ctx.effects.landing(tmpV.set(p.x, p.y, p.z), p.landImpact);
    audio.land(p.landImpact);
    if (S.runMode === 'park') {
      S.park.air += p.bestAir;
      S.park.bestAir = Math.max(S.park.bestAir, p.bestAir);
      if (p.bestAir > 0.45) S.park.tricks += 1;
      p.bestAir = 0;
    }
  }
  if (p.jumped) audio.jump();
  ctx.effects.update(dt);

  if (p.rail) {
    S.park.rail += dt;
    S.park.spin += Math.abs(p.spinVel) * dt * (180 / Math.PI) * 0.1;
  }

  // ── ghost recording ──
  S.ghostAcc += dt;
  if (S.runMode === 'race' && S.ghostAcc > 1 / 12) {
    S.ghostAcc = 0;
    S.ghostRec.push({
      t: S.time,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      h: +p.heading.toFixed(3),
      l: +p.edge.toFixed(2),
      c: +crouch.toFixed(2),
      a: p.airborne ? 1 : 0,
    });
    if (S.ghostRec.length > 1600) S.ghostRec.shift();
  }
  updateGhost();

  // ── hud ──
  hud.setTime(S.time + S.penalty, S.bestAtStart != null && S.time > 0.2 ? S.bestAtStart : null);
  hud.setSpeed(p.speed * 3.6);
  hud.setAirtime(p.airborne ? p.airTime : 0);
  hud.setTuck(p.tuckAmt ?? 0, p.speed);
  audio.update(p);

  chase.update(dt, p);
  ctx.world.update(dt, camera.position, p);
  ctx.gates?.update(dt, p);

  if (p.z <= FINISH_Z) finishRun();
}

/** Test-only autopilot: follows the dashed racing line so screenshots show real lines. */
function autopilotInput(p) {
  let tx;
  let tz;
  const gp = ctx.gates?.guidePoints;
  if (gp && gp.length > 6) {
    // pure pursuit along the carved line: nearest sample, then look ahead by
    // a distance along the line so uneven sampling can't collapse the target
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < gp.length; i++) {
      const d = (gp[i].x - p.x) ** 2 + (gp[i].z - p.z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    let ti = bi;
    let run = 0;
    const reach = 5.6 + p.speed * 0.17;
    while (ti < gp.length - 1 && run < reach) {
      run += Math.hypot(gp[ti + 1].x - gp[ti].x, gp[ti + 1].z - gp[ti].z);
      ti++;
    }
    tx = gp[ti].x;
    tz = gp[ti].z;
  } else {
    const g = ctx.gates?.list[ctx.gates.current];
    if (g) {
      tx = g.tx;
      tz = g.tz;
    } else {
      tz = p.z - 55;
      tx = ctx.terrain.centerX(tz);
    }
  }
  const dx = tx - p.x;
  const dz = tz - p.z;
  const want = Math.atan2(dx, -dz);
  let err = want - p.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  input.axis = clamp(err * 3.9, -1, 1);
  input.left = input.right = false;
  input.tuck = Math.abs(err) < 0.13;
  // scrub speed when the next arc needs more edge than the ski can hold
  let vmax = 34;
  const gp2 = ctx.gates?.guidePoints;
  if (gp2 && gp2.length > 12) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < gp2.length; i++) {
      const d = (gp2[i].x - p.x) ** 2 + (gp2[i].z - p.z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    const a = gp2[bi];
    const b = gp2[Math.min(gp2.length - 1, bi + 22)];
    if (b && a) {
      const ds = Math.hypot(b.x - a.x, b.z - a.z);
      const ha = Math.atan2(a.x - p.x, -(a.z - p.z));
      const hb = Math.atan2(b.x - a.x, -(b.z - a.z));
      let dh = hb - ha;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const R = Math.abs(dh) > 0.02 ? ds / Math.abs(dh) : 400;
      vmax = Math.sqrt(23.4 * Math.max(6, R));
    }
  }
  input.brake = p.speed > vmax * 1.03;
}

function updateGhost() {
  if (!ctx.ghost || !S.ghostSamples) return;
  const sm = S.ghostSamples;
  const t = S.time;
  let i = S.ghostIdx ?? 0;
  while (i < sm.length - 2 && sm[i + 1].t < t) i++;
  S.ghostIdx = i;
  const a = sm[i];
  const b = sm[Math.min(i + 1, sm.length - 1)];
  if (!a) return;
  const span = Math.max(0.0001, b.t - a.t);
  const u = clamp((t - a.t) / span, 0, 1);
  const x = a.x + (b.x - a.x) * u;
  const y = a.y + (b.y - a.y) * u;
  const z = a.z + (b.z - a.z) * u;
  const h = a.h + (b.h - a.h) * u;
  const lean = a.l + (b.l - a.l) * u;
  const crouch = a.c + (b.c - a.c) * u;
  ctx.ghost.root.visible = true;
  ctx.ghost.place(new THREE.Vector3(x, y, z), h);
  ctx.ghost.update(0.016, { lean, crouch, steer: 0, air: a.a, speed: 18, grab: 0 });
}

// ─────────────────────────────────────────────────────────────
// Render loop
// ─────────────────────────────────────────────────────────────
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;

function renderFrame() {
  composer.render();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.frozen) {
    return; // automation froze the sim: render only on demand
  }
  acc += dtReal;
  let guard = 0;
  while (acc >= STEP && guard++ < 6) {
    tick(STEP);
    acc -= STEP;
  }
  renderFrame();
}

// ─────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────
const keyMap = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'tuck',
  KeyW: 'tuck',
  ShiftLeft: 'tuck',
  ShiftRight: 'tuck',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'jump',
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (S.state === 'running' || S.state === 'countdown') pauseRun();
    else if (S.state === 'paused') resumeRun();
    return;
  }
  if (e.code === 'KeyM') {
    toggleMute();
    return;
  }
  if (e.code === 'KeyP' || e.code === 'KeyO') {
    if (S.state === 'running') openShop();
    return;
  }
  if (S.state === 'menu' && (e.code === 'Enter')) {
    startRun(S.runMode);
    return;
  }
  const k = keyMap[e.code];
  if (!k) return;
  e.preventDefault();
  // Race runs have no jump at all: Space is simply not an input there
  if (k === 'jump' && S.runMode === 'race') return;
  input[k] = true;
  audio.init();
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.code];
  if (!k) return;
  input[k] = false;
});

window.addEventListener('blur', () => {
  input.left = input.right = input.tuck = input.brake = input.jump = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.state === 'running') pauseRun();
});

// ─────────────────────────────────────────────────────────────
// UI wiring
// ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function toggleMute() {
  audio.init();
  audio.setMuted(!audio.muted);
  hud.setMuted(audio.muted);
}

const shop = new ShopUI(store, {
  onEquip: async (id) => {
    audio.click();
    const item = store.state.owned.includes(id);
    if (!item) return;
    if (store.state.map !== ctx.def.id || store.state.skin !== ctx.rider.skin.id) {
      await applyEquipment();
    }
    updateTitleInfo();
  },
  onBuy: async (id) => {
    audio.buy();
    const m = MAPS.find((x) => x.id === id);
    hud.toast(m ? `${m.name} 잠금 해제 (테스트 결제)` : '스킨 잠금 해제 (테스트 결제)');
    if (S.state === 'menu') await applyEquipment();
  },
  onClose: () => {
    hud.showShop(false);
  },
});

async function applyEquipment() {
  if (S.state === 'running' || S.state === 'countdown') return;
  hud.toast('장비 적용 중…');
  await buildWorld(store.state.map, S.runMode, { silent: true });
  S.state = 'menu';
  placeMenu();
  hud.showTitle(true);
  hud.showHUD(false);
  hud.showResult(false);
  hud.showShop(true);
  updateTitleInfo();
}

$('btnRace').onclick = () => { audio.init(); audio.click(); startRun('race'); };
$('btnPark').onclick = () => { audio.init(); audio.click(); startRun('park'); };
$('btnShopTitle').onclick = () => { audio.click(); openShop(); };
$('btnShopHud').onclick = () => { audio.click(); openShop(); };
$('btnShopClose').onclick = () => { audio.click(); closeShop(); };
$('btnHelp').onclick = () => {
  audio.click();
  hud.toast(
    touch.isTouch
      ? '화면을 좌우로 드래그해 카빙 · 아래로 스와이프하면 브레이크 · CROUCH 홀드'
      : '← → 카빙 · ↑/SHIFT 턱 · ↓ 브레이크 · ESC 일시정지 · M 음소거'
  );
};
const fullBtn = $('btnFull');
if (fullBtn) {
  fullBtn.onclick = () => {
    audio.click();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };
}
$('btnPause').onclick = () => { audio.click(); pauseRun(); };
$('btnResume').onclick = () => { audio.click(); resumeRun(); };
$('btnRestart').onclick = () => { audio.click(); hud.showPause(false); startRun(S.runMode); };
$('btnQuit').onclick = () => { audio.click(); hud.showPause(false); toMenu(); };
$('btnRetry').onclick = () => { audio.click(); startRun(S.runMode); };
$('btnToTitle').onclick = () => { audio.click(); toMenu(); };
$('btnMute').onclick = () => { audio.click(); toggleMute(); };

let shopPaused = false;
function openShop() {
  audio.click();
  shopPaused = S.state === 'running' || S.state === 'countdown';
  if (shopPaused) pauseRun();
  hud.showShop(true);
}
function closeShop() {
  hud.showShop(false);
  if (shopPaused && S.state === 'paused') resumeRun();
  shopPaused = false;
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
});

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────
async function boot() {
  try {
    hud.setLoading(0.06, 'BUILDING ALPINE WORLD…');
    await raf();
    await buildWorld(store.state.map, S.runMode);
    hud.setLoading(1, 'READY');
    await raf();
    hud.hideLoader();
    hud.showTitle(true);
    hud.showHUD(false);
    setTimeout(() => {
      if (S.state === 'menu') {
        hud.toast(
          touch.isTouch
            ? '좌우로 드래그해 카빙하세요'
            : '← → 로 카빙, ↑ 턱 (RACE에는 점프 없음)'
        );
      }
    }, 1200);
    requestAnimationFrame(frame);
  } catch (err) {
    console.error('boot failed', err);
    hud.setLoading(1, 'LOAD ERROR — SEE CONSOLE');
  }
}

// Test / automation hooks (used by the Playwright verification suite)
window.__carve = {
  build: BUILD,
  _dbg: { scene, renderer, camera, ctx, composer, bloom },
  camDebug: () => ({
    cam: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
    look: [+chase.look.x.toFixed(2), +chase.look.y.toFixed(2), +chase.look.z.toFixed(2)],
    yaw: +chase.yaw.toFixed(2),
    heading: +ctx.physics.heading.toFixed(2),
    ground: +ctx.terrain.heightAt(camera.position.x, camera.position.z).toFixed(2),
    rider: [+ctx.rider.root.position.x.toFixed(2), +ctx.rider.root.position.y.toFixed(2), +ctx.rider.root.position.z.toFixed(2)],
    fov: +camera.fov.toFixed(1),
  }),
  riderDebug: () => ({
    hip: ctx.rider.hipPos.map((v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]),
    knee: ctx.rider.kneePos.map((v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]),
    ankle: ctx.rider.anklePos.map((v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]),
    root: [+ctx.rider.root.position.x.toFixed(2), +ctx.rider.root.position.y.toFixed(2), +ctx.rider.root.position.z.toFixed(2)],
    torso: [+ctx.rider.torso.position.x.toFixed(2), +ctx.rider.torso.position.y.toFixed(2), +ctx.rider.torso.position.z.toFixed(2)],
    lean: +ctx.rider.leanSmooth.toFixed(2),
    crouch: +ctx.rider.crouchSmooth.toFixed(2),
  }),
  get ready() {
    return S.state !== 'loading';
  },
  mode: () => S.state,
  state: () => ({
    mode: S.state,
    runMode: S.runMode,
    time: +(S.time + S.penalty).toFixed(3),
    x: +ctx.physics.x.toFixed(2),
    y: +ctx.physics.y.toFixed(2),
    z: +ctx.physics.z.toFixed(2),
    speed: +(ctx.physics.speed * 3.6).toFixed(1),
    edge: +ctx.physics.edge.toFixed(2),
    steer: +ctx.physics.steer.toFixed(2),
    tuck: +(ctx.physics.tuckAmt ?? 0).toFixed(2),
    crouch: +ctx.rider.crouchSmooth.toFixed(2),
    airborne: ctx.physics.airborne,
    gate: ctx.gates ? ctx.gates.current : 0,
    gateTotal: ctx.gates ? ctx.gates.list.length : 0,
    gates: ctx.gates ? ctx.gates.debug().gates.slice(0, 3) : null,
    clean: S.clean,
    missed: S.missed,
    lean: +ctx.rider.leanSmooth.toFixed(2),
    map: ctx.def?.id,
    jumpVisible: (() => {
      const el = document.getElementById('tJump');
      return el ? getComputedStyle(el).display !== 'none' : null;
    })(),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  }),
  start: (mode) => startRun(mode ?? S.runMode),
  menu: () => toMenu(),
  advance: (seconds) => {
    const n = Math.max(1, Math.round(seconds / STEP));
    for (let i = 0; i < n; i++) tick(STEP);
    renderFrame();
    return window.__carve.state();
  },
  freeze: (v = true) => {
    S.frozen = !!v;
  },
  setInput: (obj) => Object.assign(input, obj),
  inputState: () => ({ ...input }),
  autopilot: (on) => {
    S.autopilot = !!on;
    return S.autopilot;
  },
  setSpeed: (v) => {
    if (ctx.physics) ctx.physics.speed = v;
  },
  teleport: (z, dx = 0) => {
    const p = ctx.physics;
    p.z = z;
    p.x = ctx.terrain.centerX(z) + dx;
    p.y = ctx.terrain.heightAt(p.x, p.z);
    p.heading = ctx.terrain.headingAt(z);
    S.prevZ = z + 1;
    S.prevX = p.x;
    chase.snap(p);
    return window.__carve.state();
  },
  gateDebug: () => (ctx.gates ? ctx.gates.debug() : null),
  openShop: () => { openShop(); return true; },
  closeShop: () => { closeShop(); return true; },
  finish: () => finishRun(),
  quality: (lvl = 'low') => {
    S.quality = lvl;
    bloom.enabled = lvl !== 'low';
    renderer.setPixelRatio(lvl === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    return lvl;
  },
  audioEnabled: () => audio.ready,
  /** Static inspection camera for visual checks (not used by the game). */
  inspect: ({ dist = 3.2, az = 0.9, h = 1.1, fov = 38, look = 0.95 } = {}) => {
    const p = ctx.physics;
    const x = p.x + Math.sin(az) * dist;
    const z = p.z + Math.cos(az) * dist;
    camera.position.set(x, ctx.terrain.heightAt(x, z) + h, z);
    camera.fov = fov;
    camera.up.set(0, 1, 0);
    camera.lookAt(p.x, p.y + look, p.z);
    camera.updateProjectionMatrix();
    renderFrame();
    return true;
  },
  render: () => { renderFrame(); renderFrame(); return true; },
  poseRider: ({ lean = 0, crouch = 0.28, air = 0, steer = 0, grab = 0, speed = 20, settle = 1.2 } = {}) => {
    const p = ctx.physics;
    ctx.rider.place(new THREE.Vector3(p.x, p.y, p.z), p.heading);
    const steps = Math.max(1, Math.round(settle / 0.04));
    for (let i = 0; i < steps; i++) {
      ctx.rider.update(0.04, { lean, crouch, air, steer, grab, speed, land: false });
    }
    renderFrame();
    return { lean: ctx.rider.leanSmooth, crouch: ctx.rider.crouchSmooth, tuck: ctx.rider.tuckAmt };
  },
};

boot();
