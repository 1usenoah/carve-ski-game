import { clamp, damp } from '../core/noise.js';

/**
 * Fully procedural Web Audio soundtrack: wind that follows speed, snow that
 * scrapes under the edge, gate chimes, countdown and landings. No audio files.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.enabled = true;
    this.lastGate = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.enabled = false;
      return;
    }
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    // --- noise source shared by wind and snow ---
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    windSrc.start();

    const carveSrc = ctx.createBufferSource();
    carveSrc.buffer = buf;
    carveSrc.loop = true;
    this.carveFilter = ctx.createBiquadFilter();
    this.carveFilter.type = 'bandpass';
    this.carveFilter.frequency.value = 2600;
    this.carveFilter.Q.value = 1.1;
    this.carveGain = ctx.createGain();
    this.carveGain.gain.value = 0;
    carveSrc.connect(this.carveFilter).connect(this.carveGain).connect(this.master);
    carveSrc.start();

    // low rumble of the ski base on packed snow
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = buf;
    rumbleSrc.loop = true;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 140;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumbleSrc.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);
    rumbleSrc.start();

    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  /** Called every frame with the skier state. */
  update(skier) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const speed = skier.speed;
    const sp = clamp(speed / 32, 0, 1);
    this.windGain.gain.setTargetAtTime(0.02 + sp * sp * 0.24, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(320 + sp * 1500, t, 0.15);
    const carveAmt = skier.airborne ? 0 : clamp((Math.abs(skier.edge) * 1.3 + 0.15) * (speed / 22), 0, 1);
    this.carveGain.gain.setTargetAtTime(carveAmt * 0.16, t, 0.08);
    this.carveFilter.frequency.setTargetAtTime(1900 + speed * 55, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(skier.airborne ? 0 : 0.05 + sp * 0.12, t, 0.1);
  }

  tone(freq, dur = 0.16, type = 'sine', vol = 0.22, slideTo = null) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  burst(dur = 0.22, cutoff = 900, vol = 0.25) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.3), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  gate(perfect = false) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGate < 0.15) return;
    this.lastGate = now;
    this.tone(perfect ? 1320 : 990, 0.13, 'sine', 0.2);
    this.tone(perfect ? 1980 : 1480, 0.2, 'triangle', 0.09);
  }

  countdown(step) {
    this.tone(step === 0 ? 1046 : 660, step === 0 ? 0.42 : 0.14, 'square', 0.12);
  }

  land(impact) {
    const v = clamp(impact / 9, 0.15, 1);
    this.burst(0.16 + v * 0.16, 700 + v * 500, 0.12 + v * 0.2);
    this.tone(72 + v * 26, 0.22, 'sine', 0.08 + v * 0.14, 48);
  }

  jump() {
    this.burst(0.14, 1400, 0.1);
  }

  click() {
    this.tone(880, 0.05, 'triangle', 0.06);
  }

  buy() {
    this.tone(660, 0.1, 'triangle', 0.1);
    setTimeout(() => this.tone(990, 0.14, 'triangle', 0.1), 80);
    setTimeout(() => this.tone(1320, 0.18, 'sine', 0.1), 160);
  }

  finish() {
    this.tone(523, 0.18, 'triangle', 0.12);
    setTimeout(() => this.tone(784, 0.2, 'triangle', 0.12), 130);
    setTimeout(() => this.tone(1046, 0.5, 'sine', 0.13), 260);
  }
}
