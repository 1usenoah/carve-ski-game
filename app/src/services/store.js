import { MAPS } from '../scene/maps.js';

export { MAPS };

/**
 * Skins (rider outfits) and the shop catalog. Colours are plain strings so
 * they can go straight into materials and the UI swatches.
 */
export const SKINS = [
  {
    id: 'classic',
    kind: 'skin',
    name: 'Classic Alpine',
    price: 0,
    desc: '레드 재킷과 화이트 스키. 카브의 기본.',
    jacket: '#c8343f',
    jacketDark: '#8f1f2b',
    pants: '#1b2436',
    helmet: '#eef4ff',
    goggles: '#ffb347',
    ski: '#f4f9ff',
    accent: '#5ef0d8',
    glove: '#17202a',
    boot: '#141923',
    swatch: 'linear-gradient(140deg,#c8343f,#8f1f2b 55%,#eef4ff)',
  },
  {
    id: 'neon',
    kind: 'skin',
    name: 'Neon Cyber',
    price: 2.99,
    desc: '형광 라임 라인과 매트 블랙. 야간 파크용.',
    jacket: '#16202b',
    jacketDark: '#0b1118',
    pants: '#0d141b',
    helmet: '#101820',
    goggles: '#b6ff3d',
    ski: '#0f1720',
    accent: '#b6ff3d',
    glove: '#0b1118',
    boot: '#0b1118',
    swatch: 'linear-gradient(140deg,#16202b,#0b1118 55%,#b6ff3d)',
  },
  {
    id: 'crimson',
    kind: 'skin',
    name: 'Crimson Pro',
    price: 3.99,
    desc: '딥 크림슨 + 구리 고글. 월드컵 다운힐 무드.',
    jacket: '#8e1b2c',
    jacketDark: '#5c0f1c',
    pants: '#241a20',
    helmet: '#2b1a1e',
    goggles: '#ff884d',
    ski: '#1b1418',
    accent: '#ff6b5c',
    glove: '#1a1116',
    boot: '#1a1116',
    swatch: 'linear-gradient(140deg,#8e1b2c,#5c0f1c 55%,#ff884d)',
  },
  {
    id: 'golden',
    kind: 'skin',
    name: 'Golden Legend',
    price: 4.99,
    desc: '골드 재킷과 샴페인 스키. 리더보드 1위의 색.',
    jacket: '#f3b53d',
    jacketDark: '#b9821f',
    pants: '#2a2418',
    helmet: '#ffd873',
    goggles: '#ffef9f',
    ski: '#2a2418',
    accent: '#ffe08a',
    glove: '#20180c',
    boot: '#20180c',
    swatch: 'linear-gradient(140deg,#f3b53d,#b9821f 55%,#fff3c4)',
  },
];

export const CATALOG = [...SKINS, ...MAPS];
export const skinById = (id) => SKINS.find((s) => s.id === id) ?? SKINS[0];

const KEY = 'carve.store.v2';

/**
 * Test-payment store. Ownership is granted locally so the shop flow can be
 * played end to end; purchase() is the single integration point for a real
 * payment backend (see README).
 */
export class StoreService {
  constructor() {
    this.state = this.load();
    this.listeners = [];
  }

  load() {
    const base = {
      owned: ['classic', 'larchwood'],
      skin: 'classic',
      map: 'larchwood',
      credits: 0,
    };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      return {
        ...base,
        ...parsed,
        owned: Array.from(new Set([...(parsed.owned ?? []), 'classic', 'larchwood'])),
      };
    } catch {
      return base;
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* private mode — keep the session state only */
    }
    this.listeners.forEach((fn) => fn(this.state));
  }

  onChange(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  isOwned(id) {
    return this.state.owned.includes(id);
  }

  grant(id) {
    if (!this.isOwned(id)) this.state.owned.push(id);
    this.save();
  }

  /** TEST PAYMENT: simulates a gateway round trip, then grants the item. */
  async purchase(id) {
    const item = CATALOG.find((i) => i.id === id);
    if (!item) throw new Error('unknown item');
    if (this.isOwned(id)) return { ok: true, alreadyOwned: true };
    await new Promise((r) => setTimeout(r, 550));
    this.grant(id);
    if (item.kind === 'skin') this.state.skin = id;
    if (item.kind === 'map') this.state.map = id;
    this.save();
    return { ok: true, id, price: item.price, test: true };
  }

  equip(id) {
    const item = CATALOG.find((i) => i.id === id);
    if (!item) return false;
    if (!this.isOwned(id)) return false;
    if (item.kind === 'skin') this.state.skin = id;
    else this.state.map = id;
    this.save();
    return true;
  }

  get skin() {
    return skinById(this.state.skin);
  }

  get mapId() {
    return this.state.map;
  }
}
