import { formatTime } from '../core/noise.js';

const $ = (id) => document.getElementById(id);

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
      progFill: $('progFill'),
      progTxt: $('progTxt'),
      bestTime: $('bestTime'),
      equippedText: $('equippedText'),
      metaMap: $('metaMap'),
      metaMode: $('metaMode'),
      hudMode: $('hudMode'),
      hudCourse: $('hudCourse'),
      resMedal: $('resMedal'),
      resTitle: $('resTitle'),
      resMode: $('resMode'),
      resTime: $('resTime'),
      resBest: $('resBest'),
      resDiff: $('resDiff'),
      resClean: $('resClean'),
      resTop: $('resTop'),
      btnMute: $('btnMute'),
      btnShopHud: $('btnShopHud'),
    };
    this.judgeTimer = null;
    this.lastJudge = 0;
  }

  setLoading(p, note) {
    this.el.loadFill.style.width = `${Math.round(p * 100)}%`;
    if (note) this.el.loadNote.textContent = note;
  }

  showLoader() {
    this.el.loader.classList.remove('hidden', 'done');
    this.el.loadFill.style.width = '6%';
  }

  hideLoader() {
    this.el.loader.classList.add('done');
    setTimeout(() => this.el.loader.classList.add('hidden'), 700);
  }

  showTitle(v = true) {
    this.el.title.classList.toggle('hidden', !v);
  }

  showHUD(v = true) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  showResult(v = true) {
    this.el.result.classList.toggle('hidden', !v);
  }

  showPause(v = true) {
    this.el.pause.classList.toggle('hidden', !v);
  }

  showShop(v = true) {
    this.el.shop.classList.toggle('hidden', !v);
  }

  showTouch(v = true) {
    this.el.touch.classList.toggle('hidden', !v);
  }

  setTitleInfo({ best, mapName, skinName, mode }) {
    this.el.bestTime.textContent = best ? formatTime(best) : '--:--.--';
    this.el.equippedText.innerHTML = `${skinName} · <em>${mapName}</em>`;
    this.el.metaMap.textContent = mapName;
    this.el.metaMode.textContent = mode;
  }

  setRunInfo(mode, course) {
    this.el.hudMode.textContent = mode.toUpperCase();
    this.el.hudCourse.textContent = course.toUpperCase();
    this.el.splitWrap.style.display = mode === 'race' ? '' : 'none';
  }

  showGateCounter(v) {
    const el = this.el.gateNow?.parentElement;
    if (el) el.style.display = v ? '' : 'none';
  }

  setGate(i, total) {
    this.el.gateNow.textContent = String(Math.min(i, total)).padStart(2, '0');
    this.el.gateTotal.textContent = String(total).padStart(2, '0');
  }

  setTime(t, bestSplit = null) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t * 100) % 100);
    this.el.timeMain.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.el.timeMs.textContent = `.${String(cs).padStart(2, '0')}`;
    if (bestSplit != null) {
      const d = t - bestSplit;
      this.el.splitVal.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
      this.el.splitVal.className = d <= 0 ? 'ok' : '';
    }
  }

  setSpeed(kmh) {
    const v = Math.round(kmh);
    this.el.speedVal.textContent = String(v);
    const p = Math.min(1, v / 130);
    this.el.speedRing.style.strokeDashoffset = String(201 - 201 * p);
  }

  setAirtime(t) {
    if (t > 0.25) {
      this.el.airBadge.classList.remove('hidden');
      this.el.airBadge.textContent = `AIRTIME ${t.toFixed(1)}s`;
    } else {
      this.el.airBadge.classList.add('hidden');
    }
  }

  setProgress(p) {
    const v = Math.max(0, Math.min(1, p));
    this.el.progFill.style.width = `${v * 100}%`;
    this.el.progTxt.textContent = `${Math.round(v * 100)}%`;
  }

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
    const labelEl = document.getElementById('resCleanK');
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
