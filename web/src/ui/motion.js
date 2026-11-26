// Motion: ripples, screen transitions, enter/exit helpers and drag-to-dismiss.
// Everything respects the system "reduce motion" setting.

import { platform } from '../lib/platform.js';

const reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reduced = () => !!(reducedQuery && reducedQuery.matches);

export const EASE = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  decel: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  accel: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
};

const RIPPLE_HOSTS =
  '.btn, .ctl, .icon-btn, .menu-item, .tab, .round-btn, .device-pill, .theme-option, .source, .code-chip, .secure-chip, .pj-code, .m-action, .person-row-btn';

/** Material-style touch ripple on buttons, installed once for the whole app. */
export function installRipple() {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (reduced() || e.button > 0) return;
      const host = e.target.closest(RIPPLE_HOSTS);
      if (!host || host.disabled) return;
      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      let wrap = host.querySelector(':scope > .ripple-wrap');
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.className = 'ripple-wrap';
        host.appendChild(wrap);
      }
      const dot = document.createElement('span');
      dot.className = 'ripple';
      dot.style.width = dot.style.height = size + 'px';
      dot.style.left = e.clientX - rect.left - size / 2 + 'px';
      dot.style.top = e.clientY - rect.top - size / 2 + 'px';
      wrap.appendChild(dot);
      dot.addEventListener('animationend', () => dot.remove());
    },
    { passive: true },
  );
}

/** Runs a screen change, then eases the new screen in. Synchronous, so callers can use the new view at once. */
export function swapView(change, root = document.getElementById('app')) {
  change();
  if (reduced() || !root || !root.animate) return;
  root.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
    duration: 340,
    easing: EASE.decel,
  });
}

/** Fades and lifts children into place one after another. */
export function stagger(elements, { delay = 60, start = 0 } = {}) {
  if (reduced()) return;
  [...elements].forEach((el, i) => {
    if (!el) return;
    el.classList.add('enter');
    el.style.setProperty('--i', String(i + start));
    el.style.setProperty('--stagger', delay + 'ms');
    el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
  });
}

/** Animates an element out and removes it. */
export function leave(el, keyframes, duration = 180) {
  if (!el || !el.isConnected) return Promise.resolve();
  if (reduced() || !el.animate) {
    el.remove();
    return Promise.resolve();
  }
  const anim = el.animate(keyframes || [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }], {
    duration,
    easing: EASE.accel,
    fill: 'forwards',
  });
  return anim.finished.then(
    () => el.remove(),
    () => el.remove(),
  );
}

/**
 * FLIP: call before a layout change with the elements to track, then call the
 * returned function after the change to glide them to their new places.
 */
export function measure(elements) {
  if (reduced()) return () => {};
  const first = new Map();
  for (const el of elements) if (el.isConnected) first.set(el, el.getBoundingClientRect());
  return () => {
    for (const [el, f] of first) {
      if (!el.isConnected) continue;
      const l = el.getBoundingClientRect();
      if (!l.width || !l.height || !f.width || !f.height) continue;
      const dx = f.left - l.left;
      const dy = f.top - l.top;
      const sx = f.width / l.width;
      const sy = f.height / l.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      el.animate(
        [
          { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: 'top left', transform: 'none' },
        ],
        { duration: 340, easing: EASE.standard },
      );
    }
  };
}

/**
 * Lets a bottom sheet be dragged down to close it.
 * @param {HTMLElement} sheet the element that moves
 * @param {HTMLElement} handle where the drag starts
 * @param {() => void} onDismiss
 */
export function dragToDismiss(sheet, handle, onDismiss) {
  let startY = 0;
  let dy = 0;
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    dy = 0;
    sheet.style.transition = 'none';
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    if (dy > Math.min(140, sheet.offsetHeight * 0.25)) {
      onDismiss();
    } else {
      sheet.style.transform = '';
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/** Short vibration on Android for important taps (no permission needed). */
export function haptic(kind = 'tap') {
  platform.haptic(kind);
}
