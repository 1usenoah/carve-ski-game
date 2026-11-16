import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // keep the dome pinned to the far plane
}`;

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uStars;
uniform float uCloud;
uniform float uTime;

float hash31(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}

void main() {
  vec3 d = normalize(vDir);
  float t = pow(clamp(d.y, 0.0, 1.0), 0.28);
  vec3 col = mix(uHorizon, uZenith, t);
  // thin pale haze right above the horizon
  col = mix(col, uHorizon * 1.04, smoothstep(0.06, 0.0, d.y));

  // ground haze below the horizon
  float below = clamp(-d.y * 2.4, 0.0, 1.0);
  col = mix(col, uHorizon * 0.9, below * 0.85);

  // sun disc + atmospheric glow
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 900.0) * 6.0;
  col += uSunColor * pow(sd, 9.0) * 0.22;
  col += uSunColor * pow(sd, 2.0) * 0.05;

  // high cirrus bands
  if (uCloud > 0.001) {
    vec3 cp = d / max(d.y, 0.06);
    float c = noise3(cp * 1.6 + vec3(uTime * 0.004, 0.0, 0.0));
    c = smoothstep(0.62, 0.98, c) * smoothstep(0.12, 0.55, d.y);
    col = mix(col, mix(uHorizon, vec3(1.0), 0.45), c * uCloud * 0.3);
  }

  // stars for the night course
  if (uStars > 0.001) {
    vec3 sp = floor(d * 420.0);
    float r = hash31(sp);
    float star = smoothstep(0.9982, 1.0, r) * uStars;
    float tw = 0.75 + 0.25 * sin(uTime * 2.2 + r * 60.0);
    col += vec3(0.85, 0.92, 1.0) * star * tw * smoothstep(-0.02, 0.28, d.y);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

/** Sky dome + image based lighting generated from the map palette. */
export class Sky {
  constructor(def) {
    this.def = def;
    const s = def.sky;
    this.uniforms = {
      uZenith: { value: new THREE.Color(s.zenith).convertSRGBToLinear() },
      uHorizon: { value: new THREE.Color(s.horizon).convertSRGBToLinear() },
      uSunColor: { value: new THREE.Color(s.sun).convertSRGBToLinear() },
      uSunDir: { value: new THREE.Vector3(...s.sunDir) },
      uStars: { value: s.stars ?? 0 },
      uCloud: { value: s.cloud ?? 0.4 },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 40, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
  }

  update(camera, dt) {
    this.uniforms.uTime.value += dt;
    this.group.position.copy(camera.position);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Builds a small equirectangular environment map out of the same palette. */
export function makeEnvironment(renderer, def) {
  const w = 512;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const s = def.sky;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, s.zenith);
  g.addColorStop(0.45, s.horizon);
  g.addColorStop(0.5, s.horizon);
  g.addColorStop(0.56, def.snow.color);
  g.addColorStop(1, def.snow.shadow);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // sun blob — equirect x from atan2(z,x), y from asin(-y)
  const dir = new THREE.Vector3(...s.sunDir).normalize();
  const u = ((Math.atan2(dir.z, dir.x) + Math.PI) / (Math.PI * 2)) * w;
  const v = ((Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) + Math.PI / 2) / Math.PI) * h;
  const rg = ctx.createRadialGradient(u, h - v, 0, u, h - v, 60);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.2, 'rgba(255,250,235,.85)');
  rg.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
  return env;
}
