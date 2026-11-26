import { h, initials } from './dom.js';

// Same colour for the same name on every screen, so people are easy to tell apart.
const COLORS = ['#1a73e8', '#e8710a', '#188038', '#d93025', '#9334e6', '#12867d', '#c5221f', '#b06000', '#1967d2', '#a142f4'];

export function colorFor(name) {
  let h32 = 2166136261;
  for (const ch of String(name || '')) {
    h32 ^= ch.codePointAt(0);
    h32 = Math.imul(h32, 16777619);
  }
  return COLORS[Math.abs(h32) % COLORS.length];
}

export function avatar(name, cls = 'avatar') {
  return h('span', { class: cls, style: { '--av': colorFor(name) } }, initials(name));
}

export function paintAvatar(el, name) {
  el.textContent = initials(name);
  el.style.setProperty('--av', colorFor(name));
}
