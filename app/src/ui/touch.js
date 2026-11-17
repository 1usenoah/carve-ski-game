/**
 * Touch controls — the reference scheme, on a phone:
 *
 *   • hold the left or right half of the screen → carve that way (the two big
 *     arrow pads at the bottom are the visible hint of that)
 *   • or drag horizontally anywhere → the same axis, proportionally
 *   • CROUCH pill → aero tuck, BRAKE pill → scrub speed
 *
 * There is deliberately no swipe-down brake: in the old pad a drag that
 * drifted downwards turned into a hockey stop mid-turn, which is exactly what
 * made the gates feel impossible. Every gesture now only ever steers.
 *
 * The pad writes the same `input` object as the keyboard.
 */
export class TouchControls {
  constructor(input) {
    this.input = input;
    this.pointerId = null;
    this.mode = null;                 // 'hold' | 'drag'
    this.btn = { tuck: false, brake: false };
    this.origin = { x: 0, y: 0 };
    this.surface = document.getElementById('tSurface');
    this.padEl = { left: document.getElementById('tLeft'), right: document.getElementById('tRight') };
    this.bindSurface();
    this.bindSteerPad('tLeft', 'left');
    this.bindSteerPad('tRight', 'right');
    this.bind('tTuck', 'tuck');
    this.bind('tBrake', 'brake');
    this.bind('tJump', 'jump');
    window.addEventListener('pointerup', () => this.release(), { passive: true });
    window.addEventListener('pointercancel', () => this.release(), { passive: true });
  }

  get isTouch() {
    return (
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0
    );
  }

  /** Clears everything this pad owns. */
  release() {
    this.pointerId = null;
    this.mode = null;
    this.input.axis = null;
    this.input.left = false;
    this.input.right = false;
    this.input.brake = this.btn.brake;
    this.surface?.classList.remove('dragging');
    this.padEl.left?.classList.remove('on');
    this.padEl.right?.classList.remove('on');
  }

  setSide(side) {
    this.input.axis = null;
    this.input.left = side === 'left';
    this.input.right = side === 'right';
    this.padEl.left?.classList.toggle('on', side === 'left');
    this.padEl.right?.classList.toggle('on', side === 'right');
  }

  bindSurface() {
    const el = this.surface;
    if (!el) return;
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (this.pointerId !== null) return;
        this.pointerId = e.pointerId;
        this.mode = 'hold';
        this.origin.x = e.clientX;
        this.origin.y = e.clientY;
        el.classList.add('dragging');
        // pressing a side of the screen steers that way straight away
        this.setSide(e.clientX < window.innerWidth * 0.5 ? 'left' : 'right');
      },
      { passive: true }
    );
    el.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId !== this.pointerId) return;
        const dx = e.clientX - this.origin.x;
        // a clear horizontal drag turns into proportional steering; the thumb
        // can also just stay where it is and keep holding a side
        if (Math.abs(dx) > 24) this.mode = 'drag';
        if (this.mode === 'drag') {
          this.input.left = false;
          this.input.right = false;
          this.padEl.left?.classList.remove('on');
          this.padEl.right?.classList.remove('on');
          this.input.axis = Math.max(-1, Math.min(1, dx / 72));
        }
      },
      { passive: true }
    );
    const end = (e) => {
      if (e.pointerId !== undefined && e.pointerId !== this.pointerId) return;
      this.release();
    };
    el.addEventListener('pointerup', end, { passive: true });
    el.addEventListener('pointercancel', end, { passive: true });
    el.addEventListener('pointerleave', end, { passive: true });
  }

  /** The two visible arrow pads: pressing one steers that way, holding keeps it. */
  bindSteerPad(id, side) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.pointerId = e.pointerId;
        this.mode = 'pad';
        this.setSide(side);
        el.classList.add('on');
      },
      { passive: false }
    );
    const off = (e) => {
      if (e.pointerId !== undefined && this.pointerId !== null && e.pointerId !== this.pointerId) return;
      this.release();
    };
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }

  bind(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.btn[key] = true;
      this.input[key] = true;
      el.classList.add('on');
      if (key === 'brake') this.input.brake = true;
      if (key === 'tuck') {
        this.input.axis = null;
        this.input.left = this.input.right = false;
        this.padEl.left?.classList.remove('on');
        this.padEl.right?.classList.remove('on');
      }
    };
    const off = (e) => {
      e.preventDefault();
      this.btn[key] = false;
      el.classList.remove('on');
      this.input[key] = this.btn[key];
      if (key === 'brake') this.input.brake = false;
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }
}
