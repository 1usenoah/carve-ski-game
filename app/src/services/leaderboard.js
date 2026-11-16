const KEY = 'carve.lb.v2';

/** Local best times, medals and ghost replays per map + mode. */
export class LeaderboardService {
  constructor() {
    this.data = this.load();
  }

  load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}') || {};
    } catch {
      return {};
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore quota / private mode */
    }
  }

  slot(mapId, mode) {
    const k = `${mapId}:${mode}`;
    this.data[k] = this.data[k] ?? { best: null, runs: [], ghost: null };
    return this.data[k];
  }

  getBest(mapId, mode = 'race') {
    return this.slot(mapId, mode).best;
  }

  getRuns(mapId, mode = 'race') {
    return this.slot(mapId, mode).runs;
  }

  submit(mapId, mode, time, extra = {}) {
    const s = this.slot(mapId, mode);
    const prevBest = s.best;
    s.runs.push({ time, at: Date.now(), ...extra });
    s.runs.sort((a, b) => a.time - b.time);
    s.runs = s.runs.slice(0, 5);
    if (prevBest == null || time < prevBest) s.best = time;
    this.save();
    return { best: s.best, isBest: prevBest == null || time < prevBest, prevBest };
  }

  saveGhost(mapId, mode, samples) {
    const s = this.slot(mapId, mode);
    s.ghost = { samples, at: Date.now() };
    this.save();
  }

  getGhost(mapId, mode) {
    return this.slot(mapId, mode).ghost?.samples ?? null;
  }
}
