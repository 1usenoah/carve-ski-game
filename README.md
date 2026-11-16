# Carve Rush — WebGL 3D Ski Game Prototype

A single-file 3D ski prototype built with **Three.js (WebGL)**. Everything — renderer, physics-lite slope logic, UI, shop — lives in one `index.html`, so you can open it directly in a browser or host it as a static page.

- **Play (GitHub Pages ready):** open `index.html` in a browser, or enable Pages on this repo (Settings → Pages → Deploy from branch → `main` / root)
- **Stack:** Three.js `0.160.0` via CDN import map, ES modules, no build step, no dependencies to install
- **Requires internet:** Three.js is loaded from `unpkg.com`; offline play is not supported

## Modes

| Mode | Description |
| --- | --- |
| **Race** | Timed course with gates. Pass gates, beat your best time, race against a saved ghost of your previous run. Medals (gold/silver/bronze) are awarded by finish time. |
| **Park** | Free-ride park run focused on tricks and airtime instead of gates and the clock. |

## Controls

**Keyboard** — `←` `→` carve · `↑` tuck/accelerate · `↓` brake · `Space` jump · `Esc` pause · `S` shop
**Touch** — on-screen touch pad (left/right carve, tuck, brake, jump)

## Shop structure (skins & maps)

The shop is built as a thin service layer over a catalog, so it can be swapped for a real payment backend without touching the game code.

```js
const SKINS = [
  { id:'classic', kind:'skin', name:'Classic Alpine',   price:0    },
  { id:'neon',    kind:'skin', name:'Neon Cyber',       price:2.99 },
  { id:'crimson', kind:'skin', name:'Crimson Pro',      price:3.99 },
  { id:'golden',  kind:'skin', name:'Golden Legend',    price:4.99 },
];

const MAPS = [
  { id:'larchwood', kind:'map', name:'Larchwood Super-G',        price:0    },
  { id:'glacier',   kind:'map', name:'Glacier Black Diamond',    price:4.99 },
  { id:'midnight',  kind:'map', name:'Midnight Neon Park',       price:5.99 },
];
```

- **Catalog:** every purchasable item is `{ id, kind, name, price }` with `kind` being `skin` or `map`. One free default skin and one free default map are included.
- **StoreService** (`purchase(id)`, `isOwned(id)`, `equip(id)`): currently a **test payment** flow that grants the unlock and persists it to `localStorage` (`carve.store.v1`). For production, replace the body of `purchase()` with a server-created Stripe PaymentIntent / 토스페이먼츠 payment, call `grant(id)` from the payment-confirm callback, and resolve `isOwned()` from a server-side entitlement response.
- **LeaderboardService** (`getBest`, `submit`, `getTop`, `getGhost`, `saveGhost`): best-time, top-5, and ghost-replay storage. Currently a synchronous `localStorage` demo (`carve.lb.v1`); switching to Supabase means making the four methods `async` and adding `await` in `startRun` / `finishRun`.
- **Equipped state:** `equipped.skin` / `equipped.map` decide which skin and course load at start, and the currently equipped map is highlighted on the title screen.

## Prototype status

This is a prototype: physics are lightweight, the shop uses mock payments, and rankings are local-only. The service boundaries (`StoreService`, `LeaderboardService`) are marked in the source as the intended integration points for real payments and a shared leaderboard.
