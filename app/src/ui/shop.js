import { CATALOG, MAPS, SKINS } from '../services/store.js';

const $ = (id) => document.getElementById(id);

/** Renders the skin / map shop and handles test purchases and equipping. */
export class ShopUI {
  constructor(store, { onEquip, onBuy, onClose } = {}) {
    this.store = store;
    this.onEquip = onEquip;
    this.onBuy = onBuy;
    this.onClose = onClose;
    this.mount();
    this.store.onChange(() => this.render());
  }

  mount() {
    this.skinGrid = $('skinGrid');
    this.mapGrid = $('mapGrid');
    this.skinGrid.addEventListener('click', (e) => this.click(e));
    this.mapGrid.addEventListener('click', (e) => this.click(e));
    this.render();
  }

  async click(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'equip') {
      this.store.equip(id);
      this.onEquip?.(id);
      this.render();
    } else if (action === 'buy') {
      btn.disabled = true;
      btn.textContent = '결제 중…';
      try {
        await this.store.purchase(id);
        this.onBuy?.(id);
      } catch {
        btn.textContent = '실패';
      }
      this.render();
    }
  }

  card(item) {
    const owned = this.store.isOwned(item.id);
    const equipped =
      (item.kind === 'skin' && this.store.state.skin === item.id) ||
      (item.kind === 'map' && this.store.state.map === item.id);
    const price = item.price === 0 ? 'FREE' : `$${item.price.toFixed(2)}`;
    const action = owned
      ? equipped
        ? '<button class="btn small" disabled>장착됨</button>'
        : `<button class="btn small primary" data-action="equip" data-id="${item.id}">장착</button>`
      : `<button class="btn small primary" data-action="buy" data-id="${item.id}">테스트 결제</button>`;
    const swatch = item.kind === 'skin'
      ? item.swatch
      : `linear-gradient(140deg, ${item.sky.zenith}, ${item.sky.horizon} 70%, ${item.snow.color})`;
    const label = item.kind === 'skin' ? 'RIDER SKIN' : 'ALPINE MAP';
    return `
      <div class="item ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}">
        <div class="swatch" style="background:${swatch}"><span>${label}</span></div>
        <div class="body">
          <div class="name">${item.name}</div>
          <div class="desc">${item.desc ?? item.blurb ?? ''}</div>
          <div class="foot">
            <div class="price ${item.price === 0 ? 'free' : ''}">${price}</div>
            ${action}
          </div>
        </div>
      </div>`;
  }

  render() {
    this.skinGrid.innerHTML = SKINS.map((s) => this.card(s)).join('');
    this.mapGrid.innerHTML = MAPS.map((m) => this.card(m)).join('');
    const count = this.store.state.owned.length;
    const note = document.querySelector('.shop-note b');
    if (note) note.textContent = `보유 ${count}/${CATALOG.length} · 결제 연동 지점:`;
  }
}
