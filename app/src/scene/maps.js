// Alpine maps. Everything visual (sky, fog, snow tint, trees) plus the
// park layout is data, so the shop can swap courses without touching code.

export const MAPS = [
  {
    id: 'larchwood',
    name: 'Larchwood Super-G',
    short: 'LARCHWOOD',
    price: 0,
    seed: 3.7,
    blurb: '골든아워의 알프스. 부드러운 압설과 긴 카빙 아치.',
    sky: {
      zenith: '#0d4a88',
      horizon: '#a8cbe9',
      sun: '#fff3d6',
      sunDir: [-0.55, 0.5, 0.66],
      stars: 0,
      cloud: 0.32,
    },
    sun: { color: '#fff4e0', intensity: 3.0, position: [-120, 180, 210] },
    ambient: { sky: '#7fadde', ground: '#b9d4ec', intensity: 0.42 },
    fog: { color: '#cde1f3', density: 0.00024 },
    snow: { color: '#f8fbff', shadow: '#a6c6e6' },
    tree: { density: 1, foliage: '#123a30', snow: '#eef8ff', trunk: '#3a2a20' },
    gateColor: 0x63f5dd,
    gateAlt: 0xff5f8f,
    accent: '#5ef0d8',
    bnet: true,
    rocks: 26,
    kickers: [],
    rails: [],
  },
  {
    id: 'glacier',
    name: 'Glacier Black Diamond',
    short: 'GLACIER',
    price: 4.99,
    seed: 8.3,
    blurb: '고도 3,400m 빙하. 단단한 아이스 설면과 짙은 안개.',
    sky: {
      zenith: '#0a3760',
      horizon: '#9dc2df',
      sun: '#e8f4ff',
      sunDir: [-0.66, 0.46, 0.58],
      stars: 0,
      cloud: 0.4,
    },
    sun: { color: '#eaf4ff', intensity: 2.55, position: [-180, 150, 190] },
    ambient: { sky: '#83aed8', ground: '#b6d2ea', intensity: 0.4 },
    fog: { color: '#c3ddf2', density: 0.0011 },
    snow: { color: '#f2f9ff', shadow: '#9dbfe2' },
    tree: { density: 0.5, foliage: '#0f3038', snow: '#e6f4ff', trunk: '#332c26' },
    gateColor: 0x7fd4ff,
    gateAlt: 0xff7a4d,
    accent: '#7fd4ff',
    bnet: true,
    rocks: 48,
    kickers: [],
    rails: [],
  },
  {
    id: 'midnight',
    name: 'Midnight Neon Park',
    short: 'MIDNIGHT',
    price: 5.99,
    seed: 5.1,
    blurb: '야간 네온 파크. 스타라이트 설면과 형광 게이트.',
    sky: {
      zenith: '#02040f',
      horizon: '#16294a',
      sun: '#cfe4ff',
      sunDir: [0.5, 0.42, 0.62],
      stars: 1,
      cloud: 0.2,
    },
    sun: { color: '#cfe0ff', intensity: 1.5, position: [120, 150, 200] },
    ambient: { sky: '#3c5f96', ground: '#0e1826', intensity: 0.55 },
    fog: { color: '#0c1826', density: 0.0014 },
    snow: { color: '#cfe0f7', shadow: '#4c6a99', emissive: '#132844', emissiveIntensity: 0.35 },
    tree: { density: 1.2, foliage: '#0b1d24', snow: '#cfe4ff', trunk: '#1a1a22' },
    gateColor: 0xff5fd0,
    gateAlt: 0x5ef0d8,
    accent: '#ff5fd0',
    bnet: false,
    rocks: 20,
    // Park features: kickers (open approach from +Z) and rails
    kickers: [
      { xOff: 4, z: -210, w: 15, len: 22, h: 3.4 },
      { xOff: -8, z: -520, w: 17, len: 26, h: 4.2 },
      { xOff: 10, z: -860, w: 14, len: 20, h: 3.0 },
    ],
    rails: [
      { xOff: -14, z: -350, yaw: 0.22, len: 22, h: 0.62, w: 0.14 },
      { xOff: 16, z: -690, yaw: -0.18, len: 18, h: 0.55, w: 0.14 },
    ],
  },
];

export function mapById(id) {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

// Park course for the free map keeps a few mellow features for Race players.
export const PARK_FEATURES_BY_MAP = {
  larchwood: {
    kickers: [
      { xOff: 0, z: -260, w: 16, len: 22, h: 3.0 },
      { xOff: -6, z: -600, w: 16, len: 24, h: 3.4 },
      { xOff: 7, z: -980, w: 15, len: 22, h: 3.2 },
    ],
    rails: [
      { xOff: -11, z: -430, yaw: 0.18, len: 22, h: 0.6, w: 0.14 },
      { xOff: 13, z: -780, yaw: -0.2, len: 20, h: 0.55, w: 0.14 },
    ],
  },
  glacier: {
    kickers: [
      { x: -6, z: -240, w: 13, len: 18, h: 3.0 },
      { x: 12, z: -560, w: 14, len: 22, h: 3.6 },
      { x: -8, z: -900, w: 13, len: 18, h: 2.9 },
    ],
    rails: [
      { x: 14, z: -400, yaw: -0.16, len: 19, h: 0.6, w: 0.14 },
      { x: -15, z: -720, yaw: 0.2, len: 18, h: 0.55, w: 0.14 },
    ],
  },
  midnight: null, // midnight already ships its own park
};
