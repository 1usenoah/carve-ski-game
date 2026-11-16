/**
 * Touch controls — the way the game is played on a phone:
 *
 *   • drag / slide left-right anywhere on the snow to carve, proportionally
 *   • or press and hold the left / right half of the screen to steer that way
 *   • swipe down to brake (and hold the BRAKE pill to scrub speed)
 *   • hold the CROUCH pill for the aero tuck
 *
 * The pad writes the same `input` object as the keyboard, plus `input.axis`
 * (-1…1) so the physics can follow a drag smoothly.
 */
export class TouchControls {
  constructor(input) {
    this.input = input;
    this.pointerId = null;
    this.dragMode = null;
    this.btn = { tuck: false, brake: false };
    this.origin = { x: 0, y: 0 };
    this.last = { x: 0, y: 0 };
    this.surface = document.getElementById('tSurface');
    this.bindSurface();
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
    this.dragMode = null;
    this.input.axis = null;
    this.input.left = false;
    this.input.right = false;
    this.input.brake = this.btn.brake;
    const el = document.getElementById('tSurface');
    el?.classList.remove('dragging', 'braking');
    document.getElementById('tHint')?.classList.remove('fade');
  }

  bindSurface() {
    const el = this.surface;
    if (!el) return;
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (this.pointerId !== null) return;
        this.pointerId = e.pointerId;
        this.dragMode = 'hold';
        this.origin.x = e.clientX;
        this.origin.y = e.clientY;
        this.last.x = e.clientX;
        this.last.y = e.clientY;
        // pressing a side of the screen steers that way straight away
        this.input.left = e.clientX < window.innerWidth * 0.5;
        this.input.right = !this.input.left;
        el.classList.add('dragging');
      },
      { passive: true }
    );
    el.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId !== this.pointerId) return;
        this.last.x = e.clientX;
        this.last.y = e.clientY;
        const dx = e.clientX - this.origin.x;
        const dy = e.clientY - this.origin.y;
        if (this.dragMode === 'hold' && Math.abs(dx) > 13) this.dragMode = 'drag';
        if (this.dragMode === 'hold' && dy > 64 && Math.abs(dx) < 70) {
          this.dragMode = 'brake';
          this.input.left = this.input.right = false;
          this.input.brake = true;
          el.classList.add('braking');
        }
        if (this.dragMode === 'drag') {
          this.input.left = this.input.right = false;
          this.input.axis = Math.max(-1, Math.min(1, dx / 76));
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

  bind(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      this.btn[key] = true;
      this.input[key] = true;
      el.classList.add('on');
      if (key === 'brake') this.input.brake = true;
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
