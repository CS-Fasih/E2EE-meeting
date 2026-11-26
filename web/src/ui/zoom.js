// Zoom and pan for someone else's shared screen: + / − buttons, fit,
// full screen, mouse wheel, pinch, drag to move, double-click to toggle.
// Only changes how the picture is shown on this device.

import { h } from './dom.js';
import { icon } from './icons.js';
import { platform } from '../lib/platform.js';

const MIN = 1;
const MAX = 6;
const STEP = 1.25;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * @param {{el: HTMLElement, video: HTMLVideoElement}} tile
 * @param {() => boolean} isMain whether this tile is the big one on stage
 */
export function attachZoom(tile, isMain) {
  const z = { scale: 1, x: 0, y: 0 };
  const level = h('button', { class: 'zoom-level', type: 'button', title: 'Reset zoom', 'aria-label': 'Reset zoom' }, '100%');
  const outBtn = h('button', { class: 'zoom-btn', type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out' }, icon('zoomOut'));
  const inBtn = h('button', { class: 'zoom-btn', type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in' }, icon('zoomIn'));
  const canFs = document.fullscreenEnabled && platform.kind !== 'android';
  const fsBtn = canFs
    ? h('button', { class: 'zoom-btn', type: 'button', title: 'Full screen', 'aria-label': 'Full screen' }, icon('expand'))
    : null;
  const bar = h('div', { class: 'zoom-ctl', role: 'toolbar', 'aria-label': 'Zoom the shared screen' }, outBtn, level, inBtn, fsBtn);
  tile.el.appendChild(bar);
  tile.el.classList.add('zoomable');

  const apply = (animate = true) => {
    const r = tile.el.getBoundingClientRect();
    const maxX = (r.width * (z.scale - 1)) / 2;
    const maxY = (r.height * (z.scale - 1)) / 2;
    z.x = clamp(z.x, -maxX, maxX);
    z.y = clamp(z.y, -maxY, maxY);
    tile.video.classList.toggle('zoom-anim', animate);
    tile.video.style.transform = z.scale === 1 ? '' : `translate(${z.x.toFixed(1)}px, ${z.y.toFixed(1)}px) scale(${z.scale.toFixed(3)})`;
    level.textContent = Math.round(z.scale * 100) + '%';
    tile.el.classList.toggle('zoomed', z.scale > 1);
    outBtn.disabled = z.scale <= MIN;
    inBtn.disabled = z.scale >= MAX;
  };

  // Zoom around a point given as an offset from the tile's centre.
  const zoomTo = (next, cx = 0, cy = 0, animate = true) => {
    next = clamp(next, MIN, MAX);
    const k = next / z.scale;
    z.x = cx - (cx - z.x) * k;
    z.y = cy - (cy - z.y) * k;
    z.scale = next;
    if (next === MIN) z.x = z.y = 0;
    apply(animate);
  };

  const offset = (clientX, clientY) => {
    const r = tile.el.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2];
  };

  const stop = (e) => e.stopPropagation();
  bar.addEventListener('pointerdown', stop);
  bar.addEventListener('dblclick', stop);
  inBtn.addEventListener('click', () => zoomTo(z.scale * STEP));
  outBtn.addEventListener('click', () => zoomTo(z.scale / STEP));
  level.addEventListener('click', () => zoomTo(1));
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement === tile.el) document.exitFullscreen().catch(() => {});
      else tile.el.requestFullscreen().catch(() => {});
    });
  }
  const onFs = () => {
    if (!fsBtn) return;
    const on = document.fullscreenElement === tile.el;
    fsBtn.replaceChild(icon(on ? 'shrink' : 'expand'), fsBtn.firstChild);
    fsBtn.title = fsBtn.ariaLabel = on ? 'Exit full screen' : 'Full screen';
    requestAnimationFrame(() => apply(false));
  };
  document.addEventListener('fullscreenchange', onFs);

  // Mouse wheel / trackpad pinch (which arrives as ctrl+wheel).
  tile.el.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey || isMain() || document.fullscreenElement === tile.el)) return;
      e.preventDefault();
      const [cx, cy] = offset(e.clientX, e.clientY);
      zoomTo(z.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), cx, cy, false);
    },
    { passive: false },
  );

  tile.el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const [cx, cy] = offset(e.clientX, e.clientY);
    zoomTo(z.scale > 1 ? 1 : 2.5, cx, cy);
  });

  // Drag to move, two fingers to pinch.
  const pointers = new Map();
  let pinch = null;
  tile.el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tile.el.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: z.scale };
    }
  });
  tile.el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const [cx, cy] = offset((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomTo(pinch.scale * (d / pinch.d), cx, cy, false);
    } else if (z.scale > 1) {
      z.x += dx;
      z.y += dy;
      apply(false);
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  tile.el.addEventListener('pointerup', end);
  tile.el.addEventListener('pointercancel', end);

  apply(false);
  return {
    apply: () => apply(false),
    reset: () => zoomTo(1, 0, 0, false),
    destroy: () => document.removeEventListener('fullscreenchange', onFs),
  };
}
