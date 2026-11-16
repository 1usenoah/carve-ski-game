import { formatTime } from '../core/noise.js';

const $ = (id) => document.getElementById(id);

/** Splits a race time into "40.400" style course-setter targets. */
function target(t) {
  if (t == null) return '--';
  return t.toFixed(3);
}

export class HUD {
  constructor() {
    this.el = {
      loader: $('loader'),
      loadFill: $('loadFill'),
      loadNote: $('loadNote'),
      title: $('title'),
      hud: $('hud'),
      result: $('result'),
      shop: $('shop'),
      pause: $('pause'),
      touch: $('touch'),
      toasts: $('toasts'),
      timeMain: $('timeMain'),
      timeMs: $('timeMs'),
      gateNow: $('gateNow'),
      gateTotal: $('gateTotal'),
      gateChip: $('gateChip'),
      splitVal: $('splitVal'),
      splitWrap: $('splitWrap'),
      speedVal: $('speedVal'),
      speedRing: $('speedRing'),
      airBadge: $('airBadge'),
      judge: $('judge'),
      judgeMain: $('judgeMain'),
      judgeSub: $('judgeSub'),
      countdown: $('countdown'),
      goFlash: $('goFlash'),
      bestTime: $('bestTime'),
      equippedText: $('equippedText'),
      metaMap: $('metaMap'),
      metaMode: $('metaMode'),
      hudMode: $('hudMode'),
      hudCourse: $('hudCourse'),
      setterPanel: $('setterPanel'),
      tGold: $('tGold'),
      tSilver: $('tSilver'),
      tBronze: $('tBronze'),
      tBest: $('tBest'),
      hudHint: $('hudHint'),
      speedlines: $('speedlines'),
      resMedal: $('resMedal'),
      resTitle: $('resTitle'),
      resMode: $('resMode'),
      resTime: $('resTime'),
      resBest: $('resBest'),
      resDiff: $('resDiff'),
      resClean: $('resClean'),
      resTop: $('resTop'),
      btnMute: $('btnMute'),
    };
    this.hintTimer = null;
  }

  setLoading(p, note) {
    if (this.el.loadFill) this.el.loadFill.style.width = `${Math.round(p * 100)}%`;
    if (note && this.el.loadNote) this.el.loadNote.textContent = note;
  }

  showLoader() {
    this.el.loader.classList.remove('hidden', 'done');
    if (this.el.loadFill) this.el.loadFill.style.width = '6%';
  }

  hideLoader() {
    this.el.loader.classList.add('done');
    setTimeout(() => this.el.loader.classList.add('hidden'), 700);
  }

  showTitle(v = true) { this.el.title.classList.toggle('hidden', !v); }
  showHUD(v = true) { this.el.hud.classList.toggle('hidden', !v); }
  showResult(v = true) { this.el.result.classList.toggle('hidden', !v); }
  showPause(v = true) { this.el.pause.classList.toggle('hidden', !v); }
  showShop(v = true) { this.el.shop.classList.toggle('hidden', !v); }
  showTouch(v = true) { this.el.touch.classList.toggle('hidden', !v); }

  setTitleInfo({ best, mapName, skinName, mode }) {
    this.el.bestTime.textContent = best ? formatTime(best) : '--:--.--';
    this.el.equippedText.innerHTML = `${skinName} · <em>${mapName}</em>`;
    this.el.metaMap.textContent = mapName.toUpperCase();
    this.el.metaMode.textContent = mode;
  }

  setRunInfo(mode, course) {
    this.el.hudMode.textContent = mode === 'race' ? 'RACE' : 'PARK';
    this.el.hudCourse.textContent = course.toUpperCase();
    this.el.splitWrap.style.display = mode === 'race' ? '' : 'none';
    this.el.setterPanel.style.display = mode === 'race' ? '' : 'none';
    document.body.classList.toggle('race', mode === 'race');
    document.body.classList.toggle('park', mode !== 'race');
    this.setHint(
      mode === 'race'
        ? 'HOLD <kbd>↑</kbd> TO TUCK · <kbd>←</kbd><kbd>→</kbd> TO STEER'
        : 'HOLD <kbd>↑</kbd> TO TUCK · <kbd>SPACE</kbd> TO JUMP'
    );
  }

  /** The "Course Setter" panel: the times the course asks you to beat. */
  setCourseTargets({ gold, silver, bronze, best }) {
    if (this.el.tGold) this.el.tGold.textContent = target(gold);
    if (this.el.tSilver) this.el.tSilver.textContent = target(silver);
    if (this.el.tBronze) this.el.tBronze.textContent = target(bronze);
    if (this.el.tBest) this.el.tBest.textContent = best ? target(best) : '—';
  }

  setHint(html) {
    if (!this.el.hudHint) return;
    this.el.hudHint.innerHTML = html;
    this.el.hudHint.classList.remove('fade');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.el.hudHint.classList.add('fade'), 6000);
  }

  showGateCounter(v) {
    if (this.el.gateChip) this.el.gateChip.style.display = v ? '' : 'none';
  }

  setGate(i, total) {
    this.el.gateNow.textContent = String(Math.min(i, total)).padStart(2, '0');
    this.el.gateTotal.textContent = String(total).padStart(2, '0');
  }

  /** Big race clock; `bestSplit` shows live +/- against your own best. */
  setTime(t, bestSplit = null) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t * 100) % 100);
    this.el.timeMain.textContent = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}.${String(cs).padStart(2, '0')}`;
    this.el.timeMs.textContent = m > 0 ? `${String(cs).padStart(2, '0')}` : '';
    if (bestSplit != null) {
      const d = t - bestSplit;
      this.el.splitVal.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
      this.el.splitVal.style.color = d <= 0 ? '#63e6a0' : '#ff9d9d';
    }
  }

  setSpeed(kmh) {
    const v = Math.round(kmh);
    this.el.speedVal.textContent = String(v);
    if (this.el.speedRing) this.el.speedRing.style.width = `${Math.min(100, (v / 140) * 100)}%`;
  }

  setAirtime(t) {
    if (t > 0.25) {
      this.el.airBadge.classList.remove('hidden');
      this.el.airBadge.textContent = `AIRTIME ${t.toFixed(1)}s`;
    } else {
      this.el.airBadge.classList.add('hidden');
    }
  }

  /** Tuck strength drives the speed-line overlay. */
  setTuck(amount, speed = 0) {
    const a = Math.max(0, Math.min(1, amount)) * Math.min(1, Math.max(0, (speed - 12) / 26));
    if (this.el.speedlines) this.el.speedlines.style.opacity = (a * 0.12).toFixed(3);
  }

  /** Kept for the progress read-out in the old layout (no longer drawn). */
  setProgress() {}

  countdown(text, tone = 'normal') {
    const el = this.el.countdown;
    el.textContent = text;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
    if (tone === 'go') {
      const f = this.el.goFlash;
      f.classList.remove('on');
      void f.offsetWidth;
      f.classList.add('on');
    }
  }

  judge({ label, tone, sub }) {
    const el = this.el.judge;
    this.el.judgeMain.textContent = label;
    this.el.judgeSub.textContent = sub ?? '';
    el.className = '';
    void el.offsetWidth;
    el.classList.add('show', tone);
  }

  toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  setMuted(m) {
    this.el.btnMute.textContent = m ? '🔇' : '🔊';
    this.el.btnMute.classList.toggle('off', m);
  }

  showResultData({ medal, title, mode, time, best, diff, clean, total, topSpeed, cleanLabel, extra }) {
    const labelEl = $('resCleanK');
    if (labelEl) labelEl.textContent = cleanLabel ?? 'CLEAN LINES';
    this.el.resMedal.textContent = medal ?? '🏔️';
    this.el.resTitle.textContent = title;
    this.el.resMode.textContent = mode;
    this.el.resTime.textContent = formatTime(time);
    this.el.resBest.textContent = best ? formatTime(best) : '--:--.--';
    if (diff == null) {
      this.el.resDiff.textContent = '--';
      this.el.resDiff.className = 'v';
    } else {
      this.el.resDiff.textContent = `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}s`;
      this.el.resDiff.className = `v ${diff <= 0 ? 'good' : 'bad'}`;
    }
    this.el.resClean.textContent = total != null ? `${clean} / ${total}` : String(clean);
    this.el.resTop.textContent = extra ?? `${Math.round(topSpeed)} km/h`;
    this.showResult(true);
  }
}
