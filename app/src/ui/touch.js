/** Touch pad: mirrors the keyboard input flags. */
export class TouchControls {
  constructor(input, onChange) {
    this.input = input;
    this.onChange = onChange;
    this.bind('tLeft', 'left');
    this.bind('tRight', 'right');
    this.bind('tTuck', 'tuck');
    this.bind('tBrake', 'brake');
    this.bind('tJump', 'jump');
  }

  get isTouch() {
    return (
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0
    );
  }

  bind(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => {
      e.preventDefault();
      this.input[key] = true;
      el.classList.add('on');
      this.onChange?.(key, true);
    };
    const off = (e) => {
      e.preventDefault();
      this.input[key] = false;
      el.classList.remove('on');
      this.onChange?.(key, false);
    };
    el.addEventListener('touchstart', on, { passive: false });
    el.addEventListener('touchend', off, { passive: false });
    el.addEventListener('touchcancel', off, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', off);
    el.addEventListener('mouseleave', off);
  }
}
