import { h } from './dom.js';
import { URDU_WORDMARK } from './urdu-wordmark.js';

// The mark: a pointed arch (the doorway of a baithak) with a lattice star.
export const MARK_SVG = `<svg viewBox="0 0 40 48" width="30" height="36" aria-hidden="true">
  <path class="m-body" d="M3 46V21C3 11 12 5 20 2c8 3 17 9 17 19v25z"/>
  <g class="m-star">
    <rect x="14.5" y="21.5" width="11" height="11"/>
    <path d="M20 19.2 27.8 27 20 34.8 12.2 27z"/>
  </g>
</svg>`;

export function wordmark() {
  const mark = h('span', { class: 'mark', html: MARK_SVG });
  const ur = h('span', { class: 'wordmark-ur', lang: 'ur', 'aria-hidden': 'true', html: URDU_WORDMARK });
  return h('div', { class: 'wordmark' }, mark, h('span', { class: 'wordmark-en' }, 'Baithak'), ur);
}
